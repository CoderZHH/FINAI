import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatXAI } from "@langchain/xai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import type { AIMessage, BaseMessage, MessageContent } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import { logger } from "../infrastructure/logManager.js";

// LangChain 驱动的统一 LLM 客户端，支持多个模型提供商。
// 支持的提供商: DeepSeek, OpenAI, Anthropic, Google Gemini, XAI
// DeepSeek 模型支持 reasoning_content，可在 UI 中展示推理过程。

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 60000;

// 每个提供商的默认配置
const PROVIDER_CONFIGS = {
    deepseek: {
        baseUrl: "https://api.deepseek.com/v1",
        defaultModel: "deepseek-reasoner",
    },
    openai: {
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4-turbo-preview",
    },
    anthropic: {
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-3-5-sonnet-20241022",
    },
    google: {
        baseUrl: null, // Google uses SDK, no custom base URL
        defaultModel: "gemini-1.5-pro",
    },
    xai: {
        baseUrl: "https://api.x.ai/v1",
        defaultModel: "grok-beta",
    },
} as const;

type SupportedProvider = keyof typeof PROVIDER_CONFIGS;

// 严格定义单个决策对象以限制模型输出范围并获得更稳定的结构化响应。
const decisionItemSchema = z
    .object({
        signal: z
            .enum(["buy_to_enter", "sell_to_enter", "hold", "close"])
            .describe("交易动作为 buy_to_enter/sell_to_enter/hold/close 之一。"),
        coin: z
            .string()
            .min(1)
            .describe("交易基础符号（大写，且属于 allowed_symbols）。"),
        quantity: z
            .number()
            .nonnegative()
            .describe("下单数量，hold 时需为 0。"),
        leverage: z
            .number()
            .int()
            .min(1)
            .max(20)
            .describe("使用的杠杆（1-20，hold 时为 1）。"),
        profit_target: z
            .number()
            .describe("止盈价，buy 时大于入场价，sell 时小于入场价。"),
        stop_loss: z
            .number()
            .describe("止损价，buy 时小于入场价，sell 时大于入场价。"),
        invalidation_condition: z
            .string()
            .min(5)
            .describe("策略失效条件或重新评估信号。"),
        confidence: z
            .number()
            .min(0)
            .max(1)
            .describe("信心分值，范围 0-1。"),
        risk_usd: z
            .number()
            .nonnegative()
            .describe("本笔交易承担的美元风险暴露。"),
        justification: z
            .string()
            .min(5)
            .max(500)
            .describe("简要中文/英文理由，≤500 字。"),
    })
    .passthrough();

// 顶层 schema 要求模型只返回数组，避免包裹的解释性文字。
const decisionsSchema = z
    .array(decisionItemSchema)
    .min(1)
    .describe("严格 JSON 数组，每个元素对应一个交易决策对象。");

export interface CallLLMRequest {
    provider?: string | null;
    apiKey: string;
    apiBaseUrl?: string | null;
    systemPrompt: string;
    userPrompt: string;
    model?: string | null;
    temperature?: number;
    maxTokens?: number;
}

// 统一的响应对象，暴露决策、可选推理文本以及底层原始消息。
export interface CallLLMResponse {
    decisions: unknown;
    reasoning: string | null;
    raw: {
        id?: string;
        content: MessageContent;
        response_metadata?: unknown;
        usage_metadata?: unknown;
        tool_calls?: unknown;
        finish_reason?: unknown;
    };
}

// 规范化提供商名称
function normalizeProvider(provider?: string | null): SupportedProvider {
    const normalized = (provider?.toLowerCase() || "deepseek") as string;
    
    // 支持多种别名
    if (normalized.includes("deepseek")) return "deepseek";
    if (normalized.includes("openai") || normalized.includes("gpt")) return "openai";
    if (normalized.includes("anthropic") || normalized.includes("claude")) return "anthropic";
    if (normalized.includes("google") || normalized.includes("gemini")) return "google";
    if (normalized.includes("xai") || normalized.includes("grok")) return "xai";
    
    // 默认使用 deepseek
    return "deepseek";
}

// 获取提供商的基础 URL
function getBaseUrl(
    provider: SupportedProvider,
    customBaseUrl?: string | null
): string | null {
    if (customBaseUrl && customBaseUrl.trim().length > 0) {
        return customBaseUrl.replace(/\/$/, "");
    }
    return PROVIDER_CONFIGS[provider].baseUrl;
}

// 获取默认模型名称
function getDefaultModel(provider: SupportedProvider, customModel?: string | null): string {
    if (customModel && customModel.trim().length > 0) {
        return customModel;
    }
    return PROVIDER_CONFIGS[provider].defaultModel;
}

// 根据提供商创建对应的聊天模型实例
function buildChatModel(request: CallLLMRequest): BaseChatModel {
    const provider = normalizeProvider(request.provider);
    const model = getDefaultModel(provider, request.model);
    const temperature = request.temperature ?? DEFAULT_TEMPERATURE;
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;

    const commonConfig = {
        apiKey: request.apiKey,
        model,
        temperature,
        maxRetries: 2,
    };

    switch (provider) {
        case "deepseek": {
            const baseURL = getBaseUrl(provider, request.apiBaseUrl);
            return new ChatDeepSeek({
                ...commonConfig,
                maxTokens,
                configuration: baseURL ? { baseURL } : undefined,
            });
        }

        case "openai": {
            const baseURL = getBaseUrl(provider, request.apiBaseUrl);
            return new ChatOpenAI({
                ...commonConfig,
                maxTokens,
                configuration: baseURL ? { baseURL } : undefined,
            });
        }

        case "anthropic": {
            const baseURL = getBaseUrl(provider, request.apiBaseUrl);
            return new ChatAnthropic({
                ...commonConfig,
                maxTokens,
                ...(baseURL ? { clientOptions: { baseURL } } : {}),
            });
        }

        case "google": {
            // Google 使用 SDK，不需要 baseURL
            return new ChatGoogleGenerativeAI({
                apiKey: request.apiKey,
                model,
                temperature,
                maxOutputTokens: maxTokens,
            });
        }

        case "xai": {
            const baseURL = getBaseUrl(provider, request.apiBaseUrl);
            // XAI 使用类似 OpenAI 的接口
            return new ChatXAI({
                apiKey: request.apiKey,
                model,
                temperature,
                maxTokens,
            });
        }

        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

// LangChain Message 可能是 string、富文本数组等，此处统一提取纯文本内容。
function extractTextFromMessage(message: BaseMessage): string {
    const { content } = message;
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") {
                    return part;
                }
                if (typeof part === "object" && part) {
                    if ("text" in part && typeof part.text === "string") {
                        return part.text;
                    }
                    if ("content" in part && typeof part.content === "string") {
                        return part.content;
                    }
                }
                return "";
            })
            .filter(Boolean)
            .join("\n")
            .trim();
    }
    return "";
}

// DeepSeek 会通过 additional_kwargs / response_metadata 返回推理轨迹，这里尽量还原为字符串。
function extractReasoning(message: AIMessage): string | null {
    const candidate =
        (message.additional_kwargs?.reasoning_content as unknown) ??
        (message.response_metadata as any)?.reasoning_content ??
        null;

    if (!candidate) return null;
    if (typeof candidate === "string") {
        return candidate;
    }
    if (Array.isArray(candidate)) {
        return candidate.map((chunk) => String(chunk ?? "")).join("\n").trim() || null;
    }
    return typeof candidate === "object" ? JSON.stringify(candidate) : null;
}

// 兜底 JSON 解析，避免 StructuredOutputParser 抛错后直接失败。
function tryParseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch (error) {
        return null;
    }
}

export async function callLLM(request: CallLLMRequest): Promise<CallLLMResponse> {
    if (!request.apiKey) {
        throw new Error("LLM apiKey is required to perform a LangChain request.");
    }

    const provider = normalizeProvider(request.provider);

    // 1) 基于 Zod 定义输出结构，LangChain 会直接在提示词里注入 format instructions。
    const parser = StructuredOutputParser.fromZodSchema(decisionsSchema);
    const prompt = ChatPromptTemplate.fromMessages([
        ["system", "{systemPrompt}"],
        [
            "human",
            `{userPrompt}\n\n{formatInstructions}`,
        ],
    ]);

    // 2) 动态拼接系统/用户提示词，并追加严格的 JSON 输出说明。
    const formattedMessages = await prompt.formatMessages({
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        formatInstructions: [
            "严格按照以下 JSON 结构输出，不得包含任何解释、前缀、后缀或 Markdown 代码块。",
            parser.getFormatInstructions(),
            "务必仅返回 JSON 数组文本。",
        ].join("\n"),
    });

    // 3) 构造模型实例（支持多个提供商），随后发送请求。
    const model = buildChatModel(request);

    let response: AIMessage;
    try {
        response = await model.invoke(formattedMessages);
    } catch (error) {
        logger.error("llmClient", "LLM 请求失败", {
            provider,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
    // 4) 将模型响应转换为纯文本，方便后续 JSON 解析。
    const contentText = extractTextFromMessage(response);

    let parsed: unknown;
    try {
        // 优先使用结构化解析，收到非严格 JSON 时再回退。
        parsed = await parser.parse(contentText);
    } catch (error) {
        logger.warn("llmClient", "结构化解析失败，尝试直接 JSON 解析", {
            error: error instanceof Error ? error.message : String(error),
        });
        parsed = tryParseJson(contentText) ?? {};
    }

    let decisions: unknown = parsed;
    if (
        !Array.isArray(decisions) &&
        decisions &&
        typeof decisions === "object" &&
        "decisions" in decisions
    ) {
        decisions = (decisions as Record<string, unknown>).decisions;
    }

    // 如果模型主动输出 reasoning 字段，则优先采用
    const reasoningFromPayload =
        !Array.isArray(parsed) &&
            parsed &&
            typeof parsed === "object" &&
            typeof (parsed as Record<string, unknown>).reasoning === "string"
            ? ((parsed as { reasoning?: string }).reasoning ?? null)
            : null;

    const reasoning = reasoningFromPayload ?? extractReasoning(response);

    const result: CallLLMResponse = {
        decisions: decisions ?? {},
        reasoning,
        raw: {
            id: response.id,
            content: response.content,
            response_metadata: response.response_metadata,
            usage_metadata: response.usage_metadata,
            tool_calls: response.tool_calls,
            finish_reason: response.additional_kwargs?.finish_reason,
        },
    };

    return result;
}
