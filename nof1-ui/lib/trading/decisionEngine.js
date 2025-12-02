/**
 * ============================================================================
 * 决策引擎 - AI 交易决策核心处理模块
 * ============================================================================
 * 
 * 功能说明:
 * 1. 协调整个 AI 决策流程: 构建提示词 → 调用 LLM → 解析决策 → 执行交易
 * 2. 支持人工审核和自动执行两种模式
 * 3. 记录所有决策历史到数据库 (agent_logs 表)
 * 4. 实时日志输出到浏览器控制台
 * 
 * 主要导出:
 * - runDecisionCycle(): 执行完整的决策周期
 * 
 * 决策流程:
 * 1. 加载模型配置 (包括提示词模板)
 * 2. 构建提示词替换变量 (市场数据、持仓信息等)
 * 3. 填充提示词模板中的占位符 (如 {market_state_text})
 * 4. 调用 LLM API 获取决策
 * 5. 解析 JSON 格式的决策数据
 * 6. 根据模型配置决定是否立即执行或等待人工审核
 * 7. 记录日志并更新模型运行时间
 * 
 * ============================================================================
 */

import {
  createPendingDecision,
  getAgentModelById,
  getTrackedSymbols,
  insertAgentLog,
  markModelAutoRun,
  updatePendingDecisionStatus,
} from "../data/dataRepository.js";
import { buildPromptReplacements } from "../llm/promptBuilder.js";
import { callLLM } from "../llm/llmClient";
import { applyDecisionSet } from "./decisionExecutor.js";
import { logger } from "../infrastructure/logManager.js";

// ============================================================================
// 工具函数
// ============================================================================

/** 匹配提示词模板中的占位符 (如 {market_state_text}) */
const TOKEN_REGEX = /\{([a-zA-Z0-9_]+)\}/g;
const DECISION_SYMBOL_KEYS = ["symbol", "coin", "asset", "ticker", "pair"];

/**
 * 填充提示词模板中的占位符
 * 
 * 示例:
 *   输入: "当前时间: {current_time}, 市场数据: {market_state_text}"
 *   替换: { current_time: "2025-11-09", market_state_text: "BTC价格..." }
 *   输出: "当前时间: 2025-11-09, 市场数据: BTC价格..."
 * 
 * @param {string} template - 包含占位符的模板字符串
 * @param {Object} replacements - 替换键值对 { 占位符名: 实际值 }
 * @returns {string} 填充后的字符串
 */
function fillTemplate(template = "", replacements = {}) {
  if (!template) return "";
  return template.replace(TOKEN_REGEX, (_match, key) => {
    // 如果替换对象中有这个键，使用其值；否则保留原占位符
    if (Object.prototype.hasOwnProperty.call(replacements, key)) {
      return replacements[key] ?? "";
    }
    return _match; // 未找到对应键时保留原样 (如 {unknown_var})
  });
}

/**
 * 从 LLM 返回的文本中提取 JSON 对象
 * 
 * ⚠️ 已废弃：llmClient.js 现在直接返回 decisions 字段（已解析的对象）
 * 保留此函数仅用于向后兼容或特殊情况
 * 
 * 支持三种场景:
 * 1. 纯 JSON 字符串: '{"decisions": {...}}'
 * 2. 包含其他文本: '推理过程...{"decisions": {...}}...后续说明'
 * 3. 解析失败: 返回空对象 {}
 * 
 * @param {string} text - LLM 返回的文本内容
 * @returns {Object} 解析出的 JSON 对象
 * @deprecated 使用 llmResult.decisions 替代
 */
function extractJsonPayload(text) {
  if (!text) return {};
  try {
    // 尝试直接解析整个文本
    return JSON.parse(text);
  } catch (error) {
    // 如果失败，尝试提取第一个 JSON 对象 (支持文本混合场景)
    const match = text.match(/\{[\s\S]+\}/); // 匹配大括号包裹的内容
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (err) {
        return {}; // 提取后仍无法解析，返回空对象
      }
    }
    return {}; // 未找到 JSON 结构
  }
}

function stringifyForStorage(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    return String(payload);
  }
}

function parseDecisionEntries(payload) {
  let raw = payload;
  if (typeof raw === "string" && raw.trim().length) {
    try {
      raw = JSON.parse(raw);
    } catch (error) {
      logger.warn("decisionEngine", "LLM 返回 JSON 解析失败", { error: error.message });
      raw = null;
    }
  }

  if (Array.isArray(raw)) {
    return raw.filter(Boolean);
  }

  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.decisions)) {
      return raw.decisions.filter(Boolean);
    }
    if (raw.decisions && typeof raw.decisions === "object") {
      return Object.entries(raw.decisions).map(([symbol, value]) => ({
        symbol,
        ...(value ?? {}),
      }));
    }
    return Object.entries(raw).map(([symbol, value]) => ({
      symbol,
      ...(value ?? {}),
    }));
  }

  return [];
}

function normalizeDecisionMap(payload) {
  const entries = parseDecisionEntries(payload);
  const normalized = {};

  entries.forEach((item) => {
    if (!item || typeof item !== "object") return;
    let symbolCandidate = null;
    for (const key of DECISION_SYMBOL_KEYS) {
      if (typeof item[key] === "string" && item[key].trim()) {
        symbolCandidate = item[key].trim();
        break;
      }
    }
    if (!symbolCandidate) return;
    const symbol = symbolCandidate.toUpperCase();
    normalized[symbol] = {
      ...item,
      symbol,
    };
  });

  return { entries, map: normalized };
}

// ============================================================================
// 核心决策周期函数
// ============================================================================

/**
 * 执行完整的 AI 决策周期
 * 
 * 功能:
 * 1. 加载模型配置和提示词模板
 * 2. 构建实时市场数据和账户信息
 * 3. 填充提示词模板中的动态变量
 * 4. 调用 LLM API 获取交易决策
 * 5. 解析和规范化决策数据
 * 6. 根据模型设置执行或提交审核
 * 7. 记录完整日志到数据库
 * 
 * @param {string} modelId - 模型唯一标识符 (如 'gpt-5-aggressive')
 * @param {Object} options - 可选配置
 * @param {boolean} options.persist - 是否持久化到数据库 (默认 true)
 * @param {string} options.source - 决策来源标识 (默认 'auto_cycle')
 *   可选值: 'auto_cycle' (定时任务), 'manual_trigger' (手动触发), 'test' (测试)
 * @param {string[]} options.symbols - 交易对列表 (可选，默认使用全局追踪列表)
 * 
 * @returns {Promise<Object>} 决策执行结果
 *   - prompt: 发送给 LLM 的用户提示词
 *   - response: LLM 完整响应对象 { text, reasoning, raw }
 *   - decisions: 规范化的决策映射 { 'BTC': {...}, 'ETH': {...} }
 *   - pending: 待审核记录 (如果需要人工审核)
 *   - execution: 执行结果 (如果自动执行)
 * 
 * @throws {Error} 当模型不存在或提示词为空时抛出错误
 * 
 * 工作流程详解:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ 1. 准备阶段                                                      │
 * │    - 从数据库加载模型配置 (包括 API Key 和提示词模板)           │
 * │    - 构建动态替换变量 (市场数据、持仓、账户余额等)              │
 * │    - 填充系统提示词和用户提示词中的占位符                       │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ 2. LLM 调用阶段                                                  │
 * │    - 发送完整提示词到 DeepSeek/OpenAI API                       │
 * │    - 测量响应时间 (Date.now)                                    │
 * │    - 记录请求和响应到浏览器控制台                               │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ 3. 决策解析阶段                                                  │
 * │    - 提取 JSON 格式的决策数据                                   │
 * │    - 规范化决策字段 (signal, quantity, leverage 等)             │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ 4. 执行/审核分支                                                 │
 * │    ┌─── human_review_required = true ───┐                       │
 * │    │ - 创建待审核记录 (pending_decisions)                        │
 * │    │ - 状态设为 'pending'                                        │
 * │    │ - 记录到 agent_logs                                        │
 * │    └──────────────────────────────────────                      │
 * │    ┌─── human_review_required = false ──┐                       │
 * │    │ - 立即执行交易 (调用 applyDecisionSet)                     │
 * │    │ - 状态设为 'approved'                                       │
 * │    │ - 记录执行结果和账户快照                                   │
 * │    └──────────────────────────────────────                      │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ 5. 清理阶段                                                      │
 * │    - 更新模型的 last_auto_run_at 和 next_auto_run_at           │
 * │    - 返回完整结果给调用方                                       │
 * └─────────────────────────────────────────────────────────────────┘
 */
export async function runDecisionCycle(modelId, options = {}) {
  // ------------------------------------------------------------------------
  // 步骤 1: 初始化和配置
  // ------------------------------------------------------------------------
  const persist = options.persist !== false;  // 是否持久化 (默认 true)
  const source = options.source ?? "auto_cycle"; // 决策来源标识

  // 从数据库加载模型完整配置 (包括敏感信息如 API Key)
  const model = await getAgentModelById(modelId, { includeSecrets: true });
  if (!model) {
    throw new Error(`Model ${modelId} not found.`);
  }
  const modelSymbols =
    Array.isArray(model.allowed_symbols) && model.allowed_symbols.length
      ? model.allowed_symbols
      : null;

  // ------------------------------------------------------------------------
  // 步骤 2: 构建提示词动态内容
  // ------------------------------------------------------------------------
  // 生成所有占位符的替换值 (市场数据、持仓、账户信息等)
  const replacements = await buildPromptReplacements(model, {
    ...options,
    symbols: options.symbols ?? modelSymbols ?? getTrackedSymbols(),
  });

  // 获取需要分析的交易对列表
  const trackedSymbols = options.symbols ?? modelSymbols ?? getTrackedSymbols();

  // 填充提示词模板中的占位符 (如 {market_state_text} → 实际市场数据)
  const systemPrompt = fillTemplate(model.system_prompt, replacements);
  const userPrompt = fillTemplate(model.user_prompt, replacements);

  // 验证提示词是否为空
  if (!systemPrompt.trim() || !userPrompt.trim()) {
    throw new Error(
      `Model ${model.model_id} 缺少提示词内容，请先在提示词管理中配置模板。`
    );
  }

  // ------------------------------------------------------------------------
  // 步骤 3: 调用 LLM API
  // ------------------------------------------------------------------------
  const cycleStartedAt = Date.now(); // 记录开始时间
  const cycleId = Math.floor(cycleStartedAt / 1000);


  // 发送请求到 LLM API (DeepSeek/OpenAI)
  const llmResult = await callLLM({
    provider: model.provider,
    apiKey: model.api_key,
    apiBaseUrl: model.api_base_url,
    model: model.llm_model,
    systemPrompt,
    userPrompt,
    symbols: trackedSymbols,
  });

  const durationMs = Date.now() - cycleStartedAt; // 计算耗时
  const reasoningContent = llmResult.reasoning ?? null;
  logger.info("decisionEngine", "LLM 请求耗时", { duration_ms: durationMs, cycle_id: cycleId });

  // 如果在请求途中被用户暂停，直接丢弃响应，避免在 UI 中“拒收之后返回的 LLM 请求”
  if (source === "auto_cycle") {
    const latestModel = await getAgentModelById(modelId);
    if (!latestModel?.auto_run_enabled) {
      logger.warn("decisionEngine", "Auto-run paused during cycle; dropping response", {
        model_id: modelId,
      });
      return {
        prompt: userPrompt,
        response: llmResult,
        decisions: {},
        skipped: true,
        reason: "auto_run_paused",
      };
    }
  }

  // ------------------------------------------------------------------------
  // 步骤 4: 解析和规范化决策数据d
  // ------------------------------------------------------------------------
  const parsedPayload = llmResult.decisions;
  logger.info("decisionEngine", "解析决策 payload", { payload: parsedPayload, cycle_id: cycleId });

  const { entries: decisionList, map: decisionsMap } = normalizeDecisionMap(parsedPayload);

  if (!Object.keys(decisionsMap).length) {
    throw new Error("LLM 响应中未找到有效的决策数据，请检查提示词和模型输出格式。");
  }

  const serializedResponse = stringifyForStorage(llmResult.raw ?? parsedPayload);

  // ------------------------------------------------------------------------
  // 步骤 5: 如果不持久化，直接返回结果 (测试模式)
  // ------------------------------------------------------------------------
  if (!persist) {
    return {
      prompt: userPrompt,
      response: llmResult,
      decisions: decisionsMap,
    };
  }

  // ------------------------------------------------------------------------
  // 步骤 7: 持久化决策数据
  // ------------------------------------------------------------------------
  // 构建完整的决策数据包 (用于数据库存储)
  const decisionBlob = {
    prompt_text: userPrompt,              // 用户提示词
    response_text: serializedResponse,    // LLM 原始响应（字符串）
    response_json: llmResult.decisions,   // 原始 JSON决策
    decisions: decisionsMap,              // 决策映射
    decision_list: decisionList,          // 原始数组格式
    reasoning: reasoningContent ?? "", // 推理过程 (DeepSeek 特有)
    replacements,                         // 提示词替换变量 (用于审计)
    source,                               // 决策来源标识
  };

  // 创建待审核/待执行记录
  const initialMessage = model.human_review_required
    ? "Decision requires human approval."
    : "Auto decision executing...";
  const pending = await createPendingDecision(
    model.model_id,
    decisionBlob,
    model.human_review_required ? "pending" : "approved", // 状态: 待审核 或 已批准
    new Date(),
    {
      decision_type: source,
      auto_executed: !model.human_review_required, // 是否自动执行
      public_message: initialMessage,
      cot_trace_summary: model.human_review_required ? "Pending review" : "Awaiting execution result",
      cycle_id: cycleId,
      reasoning_content: reasoningContent,
    }
  );

  // ------------------------------------------------------------------------
  // 步骤 8: 分支处理 - 人工审核 vs 自动执行
  // ------------------------------------------------------------------------
  if (model.human_review_required) {
    // ========== 分支 A: 需要人工审核 ==========
    // 更新模型下次运行时间
    await markModelAutoRun(model.model_id, {
      intervalMinutes: model.auto_run_interval_minutes ?? 5,
    });

    return { prompt: userPrompt, response: llmResult, pending };
  }

  // ========== 分支 B: 自动执行交易 ==========
  // 执行决策集 (发送订单到交易所)
  const execution = await applyDecisionSet(model.model_id, decisionsMap, {
    decisionSource: "ai_auto",
    cycleId,
  });

  // 更新决策状态为已批准并覆盖日志内容
  const updatedPending = await updatePendingDecisionStatus(pending.id, "approved", {
    public_message: "Auto decision executed.",
    cot_trace_summary: `Executed ${execution.executed} trades automatically.`,
    account_value_snapshot: execution.account?.latest_equity ?? null,
    sharpe_snapshot: replacements.sharpe_ratio ?? null,
    response_json: llmResult.decisions,
    decision_blob: decisionBlob,
    reasoning_content: reasoningContent,
  });

  // 更新模型下次运行时间
  await markModelAutoRun(model.model_id, {
    intervalMinutes: model.auto_run_interval_minutes ?? 5,
  });

  // 返回完整结果
  return {
    prompt: userPrompt,
    response: llmResult,
    pending: updatedPending,
    execution,
  };
}
