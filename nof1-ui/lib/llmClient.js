import { logger } from "./logManager.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-reasoner";

/** 构建 HTTP 请求头 */
function buildHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * 调用 LLM API 获取交易决策
 */
export async function callLLM({
  provider,
  apiKey,
  apiBaseUrl,
  systemPrompt,
  userPrompt,
  model,
}) {
  // ------------------------------------------------------------------------
  // 构建 API 请求 URL 和负载
  // ------------------------------------------------------------------------
  const baseUrl = apiBaseUrl || DEFAULT_BASE_URL;
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  const payload = {
    model: model || DEFAULT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 65535,
  };

  logger.info("llmClient", "发送 LLM 请求", { url, payload });

  // ------------------------------------------------------------------------
  // 发送请求
  // ------------------------------------------------------------------------
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("llmClient", "LLM 请求失败", {
      status: response.status,
      body: text,
    });
    throw new Error(`LLM request failed ${response.status}: ${text}`);
  }

  // ------------------------------------------------------------------------
  // 解析响应
  // ------------------------------------------------------------------------
  const data = await response.json();
  
  const choice = data.choices?.[0]?.message ?? {};
  choice.content.replace(/^“|”$/g, '"');
  const decisions = JSON.parse(choice.content) ?? {};
  const reasoning = choice.reasoning_content;
  
  logger.info("llmClient", "✅ 收到 LLM 响应", { raw: data, decisions: decisions });

  return {
    decisions: decisions,
    reasoning: reasoning,
    raw: data,
  };
}
