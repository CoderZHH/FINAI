"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import clsx from "classnames";
import CoinBadge from "./CoinBadge";
import { resolveModelIcon, normaliseIconValue, DEFAULT_MODEL_ICON } from "../lib/llm/modelIcons";
import dynamic from "next/dynamic";

const fetcher = (url) => fetch(url).then((response) => response.json());

const BASELINE_MODEL_PREFIX = "btc_benchmark";
function isBaselineModelId(modelId) {
  return String(modelId ?? "").startsWith(BASELINE_MODEL_PREFIX);
}
const ChartInner = dynamic(() => import("./ChartInner"), { ssr: false });

function PendingCard({ entry, iconMap, onAction, readOnly = false }) {
  const [expanded, setExpanded] = useState(false);
  const [editText, setEditText] = useState(() => {
    const src =
      entry.decision_blob?.decisions ??
      entry.decision_blob?.response_json ??
      entry.response_json ??
      entry.decision_blob ??
      {};
    try {
      return JSON.stringify(src, null, 2);
    } catch {
      return "";
    }
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const promptText = entry.decision_blob?.prompt_text ?? entry.prompt_text ?? "";
  const decisions =
    entry.decision_blob?.decision_list ??
    entry.decision_blob?.decisions ??
    entry.response_json ??
    [];
  const timestampLabel = entry.created_at
    ? new Date(entry.created_at).toLocaleString("zh-CN")
    : "未记录时间";
  const reasoningText =
    entry.reasoning_content ??
    entry.decision_blob?.reasoning ??
    entry.cot_trace_summary ??
    "";

  const handleAction = async (action) => {
    if (readOnly) {
      setError("游客模式仅可查看，无法提交审核结果");
      return;
    }
    try {
      setSubmitting(true);
      setError("");
      const body = { decision_id: entry.id, action };
      if (action === "approve" && editText?.trim()) {
        body.edited_decisions = JSON.parse(editText);
      }
      const resp = await fetch("/api/decisions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.error) {
        throw new Error(data?.error || "提交失败");
      }
      onAction?.();
    } catch (err) {
      setError(err?.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-3xl border border-white/60 bg-white/60 p-5 shadow-xl shadow-gray-200/40 backdrop-blur-xl transition-all hover:bg-white/80">
      {/* Header Section */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <ModelBadge modelId={entry.model_id} icon={iconMap?.[entry.model_id]} />
          <div>
            <div className="font-bold text-gray-900">{humanizeModel(entry.model_id)}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                待人工审核
              </span>
              <span className="text-[10px] text-gray-400">{timestampLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Decision Preview Cards */}
      {Array.isArray(decisions) && decisions.length > 0 && (
        <div className="mt-4 grid gap-3">
          {decisions.map((decision, idx) => {
            const coin = (decision.coin || decision.symbol || `#${idx + 1}`).toUpperCase();
            const qty = formatQuantity(decision.quantity ?? decision.size);
            const leverage = decision.leverage != null ? `${decision.leverage}x` : EMPTY_VALUE;
            const signal = (decision.signal || decision.action || "—").toUpperCase();
            const justification = decision.justification ?? decision.reason ?? "";
            
            const isBuy = signal.includes("BUY") || signal.includes("LONG");
            const isSell = signal.includes("SELL") || signal.includes("SHORT");
            const signalColor = isBuy ? "text-emerald-600 bg-emerald-50" : isSell ? "text-rose-600 bg-rose-50" : "text-gray-600 bg-gray-50";

            return (
              <div
                key={`${coin}-${idx}`}
                className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white/50 p-3 transition-colors hover:bg-white"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CoinBadge symbol={coin} size={20} />
                    <span className="font-bold text-gray-900">{coin}</span>
                  </div>
                  <span className={clsx("rounded-lg px-2 py-1 text-[10px] font-bold", signalColor)}>
                    {signal}
                  </span>
                </div>
                
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                  <div className="flex flex-col">
                    <span className="text-gray-400">数量</span>
                    <span className="font-medium text-gray-700">{qty}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-gray-400">杠杆</span>
                    <span className="font-medium text-gray-700">{leverage}</span>
                  </div>
                  {decision.risk_usd != null && (
                    <div className="flex flex-col">
                      <span className="text-gray-400">风险</span>
                      <span className="font-medium text-gray-700">{formatCurrency(decision.risk_usd)}</span>
                    </div>
                  )}
                </div>

                {justification && (
                  <div className="mt-2 border-t border-gray-100 pt-2">
                    <p className="text-[10px] leading-relaxed text-gray-500 line-clamp-2">
                      {justification}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Action Bar */}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-gray-100/50 pt-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[11px] font-medium text-gray-500 transition-colors hover:text-gray-900"
        >
          {expanded ? "收起详情" : "查看详情"}
        </button>
        
        <div className="flex items-center gap-2">
          {error && <span className="text-[10px] text-rose-500 animate-pulse">{error}</span>}
          <button
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-[11px] font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300 active:scale-95 disabled:opacity-50"
            onClick={() => handleAction("reject")}
            disabled={readOnly || submitting}
          >
            拒绝
          </button>
          <button
            className="rounded-xl bg-gray-900 px-4 py-2 text-[11px] font-semibold text-white shadow-lg shadow-gray-200 transition-all hover:bg-black hover:-translate-y-0.5 active:scale-95 disabled:opacity-50"
            onClick={() => handleAction("approve")}
            disabled={readOnly || submitting}
          >
            {readOnly ? "游客只读" : submitting ? "提交中..." : "批准执行"}
          </button>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-4 space-y-4 animate-in slide-in-from-top-2 fade-in duration-300">
          {promptText && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">用户提示词</div>
              <div className="max-h-40 overflow-y-auto rounded-xl bg-gray-50/50 p-3 text-[11px] text-gray-600 font-mono leading-relaxed border border-gray-100">
                {promptText}
              </div>
            </div>
          )}
          
          {reasoningText && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">思考过程</div>
              <div className="max-h-60 overflow-y-auto rounded-xl bg-amber-50/30 p-3 text-[11px] text-gray-700 font-mono leading-relaxed border border-amber-100/50">
                {reasoningText}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">编辑 JSON</div>
            <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center border-b border-gray-100 bg-gray-50/50 px-3 py-2">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-400/20"></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-400/20"></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-green-400/20"></div>
                </div>
                <span className="ml-3 text-[10px] font-medium text-gray-400">decisions.json</span>
              </div>
              <div className="flex">
                <div className="w-8 flex-shrink-0 select-none border-r border-gray-100 bg-gray-50/30 py-3 text-center font-mono text-[10px] text-gray-300">
                  {editText.split('\n').map((_, i) => (
                    <div key={i} className="leading-relaxed">{i + 1}</div>
                  ))}
                </div>
                <textarea
                  className="h-48 w-full resize-none border-0 bg-transparent p-3 font-mono text-[11px] leading-relaxed text-gray-600 focus:ring-0 outline-none"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  readOnly={readOnly}
                  spellCheck={false}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



const TAB_CONFIG = [
  { key: "positions", label: "持仓概览" },
  { key: "completed", label: "成交记录" },
  { key: "decision", label: "策略确认" },
  { key: "modelchat", label: "模型对话" },
  { key: "proposal", label: "提出交易" },
];

const MODEL_LABELS = {
  "gpt-5": "GPT 5",
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "gemini-2-5-pro": "Gemini 2.5 Pro",
  "grok-4": "Grok 4",
  "deepseek-chat-v3-1": "DeepSeek Chat v3.1",
  "qwen3-max": "Qwen3 Max",
};

const DECISION_SOURCE_MAP = {
  ai_auto: "AI 自动执行",
  ai_proposed_human_approved: "AI 提案 · 人工确认",
  human_manual: "人工手动",
  ai_consensus: "AI 共识方案",
};

const EMPTY_VALUE = "—";

const formatCurrency = (value) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return EMPTY_VALUE;
  return `US$${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatPrice = (value) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return EMPTY_VALUE;
  return `US$${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}`;
};

const formatQuantity = (value) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return EMPTY_VALUE;
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
};

const formatTimestamp = (ts) => {
  if (!ts) return EMPTY_VALUE;
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleString("zh-CN");
};

const formatDuration = (start, end) => {
  if (!start || !end) return "暂无记录";
  const diff = Math.max(0, end - start);
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
};

const humanizeModel = (id = "") => MODEL_LABELS[id] ?? id;

const parseResponsePayload = (payload) => {
  if (!payload) return null;
  let parsed = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (parsed && typeof parsed.formatted_json === "string") {
    try {
      const structured = JSON.parse(parsed.formatted_json);
      if (!parsed.decisions) {
        parsed.decisions = structured;
      }
    } catch {
      // ignore parse errors
    }
  }
  return parsed;
};

const extractDecisionList = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.decisions)) return payload.decisions;
  if (Array.isArray(payload.decision_list)) return payload.decision_list;
  if (payload.decisions && typeof payload.decisions === "object") {
    return Object.values(payload.decisions);
  }
  return [];
};

const MODEL_COLORS = [
  "bg-emerald-100 text-emerald-700",
  "bg-indigo-100 text-indigo-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-purple-100 text-purple-700",
];

const PROVIDER_DEFAULT_BASE_URL = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  qwen: "https://dashscope.aliyuncs.com",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.ai/v1",
  xai_grok: "https://api.x.ai/v1",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  minimax: "https://api.minimax.io/v1",
  wenxin: "https://api.baidu.com/ernie-bot/v1",
  custom: "",
};

const PROVIDER_ICON_MAP = {
  openai: "icon:gpt",
  deepseek: "icon:deepseek",
  anthropic: "icon:claude",
  gemini: "icon:gemini",
  qwen: "icon:qwen",
  zhipu: "icon:zhipu",
  moonshot: "icon:kimi",
  xai_grok: "icon:grok",
  doubao: "icon:doubao",
  minimax: "icon:minimax",
  wenxin: "icon:wenxin",
  custom: DEFAULT_MODEL_ICON,
};

function inferProviderFromBaseUrl(baseUrl = "") {
  const normalized = baseUrl.trim().toLowerCase();
  if (!normalized) return "custom";
  const match = Object.entries(PROVIDER_DEFAULT_BASE_URL).find(
    ([, url]) => url && url.trim().toLowerCase() === normalized
  );
  return (match?.[0] ?? "custom");
}

function resolveIconForModel(model) {
  const rawIcon = normaliseIconValue(model?.display_icon ?? model?.icon ?? "");
  const provider = inferProviderFromBaseUrl(model?.api_base_url ?? "");
  const providerIcon = PROVIDER_ICON_MAP[provider] || DEFAULT_MODEL_ICON;

  if (!rawIcon) return providerIcon;
  if (rawIcon === DEFAULT_MODEL_ICON && provider && provider !== "openai") {
    return providerIcon;
  }
  return rawIcon;
}

function ModelBadge({ modelId, icon }) {
  const info = icon ? resolveModelIcon(icon) : null;
  const fallbackLabel = humanizeModel(modelId);
  const initial = fallbackLabel?.charAt(0)?.toUpperCase() || "M";
  const color = MODEL_COLORS[Math.abs(modelId?.length ?? 0) % MODEL_COLORS.length];

  if (info?.type === "image") {
    return (
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white shadow">
        <img
          src={info.src}
          alt={info.alt ?? fallbackLabel}
          className="h-full w-full rounded-full object-cover"
        />
      </span>
    );
  }

  if (info?.type === "text") {
    const text = info.text?.slice(0, 2)?.toUpperCase() || initial;
    return (
      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${color}`}>
        {text}
      </span>
    );
  }

  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${color}`}>
      {initial}
    </span>
  );
}

/** ---------- 成交记录面板 ---------- */
function TradeCard({ trade }) {
  const side = String(trade.side ?? "LONG").toUpperCase();
  const sideLabel = side === "SHORT" ? "做空" : "做多";
  const pnl = Number(trade.realized_net_pnl ?? 0);
  const exitPrice = formatPrice(trade.exit_price ?? trade.price);
  const exitTime = trade.exit_time ? formatTimestamp(trade.exit_time) : "未平仓";
  const duration = formatDuration(trade.entry_time, trade.exit_time);
  const sourceLabel = DECISION_SOURCE_MAP[trade.decision_source] ?? "未知来源";

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CoinBadge symbol={trade.symbol} size={24} />
          <div>
            <div className="text-[11px] text-neutral-500">{humanizeModel(trade.model_id)}</div>
            <div className="text-sm font-semibold text-neutral-900">{trade.symbol}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-neutral-500">净盈亏</div>
          <div className={`text-base font-bold ${pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {formatCurrency(pnl)}
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-2xl bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600">
        <div className="flex items-center justify-between">
          <span>方向</span>
          <span className="font-semibold text-neutral-900">{sideLabel}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span>平仓价格</span>
          <span className="font-semibold text-neutral-900">{exitPrice}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span>平仓时间</span>
          <span>{exitTime}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span>持仓时长</span>
          <span>{duration}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-400">
        <span>来源：{sourceLabel}</span>
        <span>建仓时间：{formatTimestamp(trade.entry_time)}</span>
      </div>
    </div>
  );
}

function CompletedPanel() {
  const { data } = useSWR("/api/trades/recent", fetcher, { refreshInterval: 5000 });
  const trades = (data?.trades ?? []).filter((trade) => Boolean(trade.exit_time));

  if (!trades.length) {
    return <div className="text-xs text-neutral-500">暂无成交记录</div>;
  }

  return (
    <div className="space-y-3">
      {trades.map((trade) => (
        <TradeCard key={trade.id} trade={trade} />
      ))}
    </div>
  );
}

/** ---------- 策略确认面板 ---------- */
function DecisionPanel({ readOnly = false }) {
  const { data, mutate } = useSWR("/api/decisions/pending", fetcher, {
    refreshInterval: 8000,
  });
  const pending = data?.decisions ?? [];

  if (!pending.length) {
    return <div className="text-xs text-neutral-500">暂无需要人工确认的提案</div>;
  }

  return (
    <div className="space-y-3">
      {readOnly ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          游客模式下可查看提案详情，但不能批准或拒绝。
        </div>
      ) : null}
      {pending.map((entry) => (
        <PendingCard
          key={entry.id ?? `${entry.model_id}-${entry.timestamp}`}
          entry={entry}
          iconMap={{}}
          onAction={() => mutate()}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

/** ---------- 模型对话面板 ---------- */
function ModelChatPanel({ iconMap = {} }) {
  const { data } = useSWR("/api/agents/logs", fetcher, { refreshInterval: 8000 });
  const logs = data?.logs ?? [];

  if (!logs.length) {
    return <div className="text-xs text-neutral-500">暂无模型对话</div>;
  }

  const InnerSection = ({ title, children }) => (
    <details className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600 transition data-[open=true]:bg-white">
      <summary className="cursor-pointer font-semibold text-neutral-700">{title}</summary>
      <div className="mt-2 text-neutral-700">{children}</div>
    </details>
  );

  return (
    <div className="space-y-3">
      {logs.map((entry, index) => {
        const payload = parseResponsePayload(entry.response_json) ?? {};
        const decisions = extractDecisionList(payload);
        const reasoningText =
          entry.reasoning_content ??
          payload.reasoning ??
          entry.response_json?.raw?.choices?.[0]?.message?.reasoning_content ??
          entry.response_json?.choices?.[0]?.message?.reasoning_content ??
          "";
        const promptText = entry.prompt_text ?? payload.prompt_text ?? "";
        const headline = entry.public_message || payload.summary || "模型已返回一组决策";
        const statusLine = entry.cot_trace_summary || headline;
        const timestampLabel = formatTimestamp(entry.timestamp);

        return (
          <details
            key={entry.id ?? `${entry.model_id}-${entry.timestamp}`}
            className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-[12px] leading-relaxed shadow-sm"
            open={index === 0}
          >
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-[11px] text-neutral-500">
              <div className="flex items-center gap-3">
                <ModelBadge
                  modelId={entry.model_id}
                  icon={iconMap?.[entry.model_id]}
                />
                <div>
                  <div className="font-semibold text-neutral-900">{humanizeModel(entry.model_id)}</div>
                  <div className="text-[11px] text-neutral-500">{statusLine}</div>
                </div>
              </div>
              <span className="whitespace-nowrap text-neutral-400">{timestampLabel}</span>
            </summary>
            <div className="mt-3 space-y-3 border-t border-dashed border-neutral-200 pt-3">
              {promptText && (
                <InnerSection title="用户提示词">
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 px-2 py-1 font-mono text-[11px] text-neutral-800">
                    {promptText}
                  </pre>
                </InnerSection>
              )}
              {reasoningText && (
                <InnerSection title="思考过程">
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 px-2 py-1 font-mono text-[11px] text-neutral-800">
                    {reasoningText}
                  </pre>
                </InnerSection>
              )}
              <InnerSection title="返回结果">
                {decisions.length ? (
                  <div className="space-y-2">
                    {decisions.map((decision, idx) => {
                      const coin = (decision.coin || decision.symbol || `#${idx + 1}`).toUpperCase();
                      const qty = formatQuantity(decision.quantity ?? decision.size);
                      const leverage = decision.leverage != null ? `${decision.leverage}x` : EMPTY_VALUE;
                      const signal = (decision.signal || decision.action || "—").toUpperCase();
                      const justification = decision.justification ?? decision.reason ?? "";
                      return (
                        <div key={`${coin}-${idx}`} className="rounded-xl border border-neutral-200 px-3 py-2 text-[11px]">
                          <div className="flex items-center justify-between font-semibold text-neutral-800">
                            <span>{coin}</span>
                            <span className="text-neutral-500">{signal}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-neutral-500">
                            <span>数量 {qty}</span>
                            <span>杠杆 {leverage}</span>
                            {decision.risk_usd != null && <span>风险 {formatCurrency(decision.risk_usd)}</span>}
                          </div>
                          {justification && (
                            <p className="mt-1 text-[11px] text-neutral-600">{justification}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded border border-neutral-100 bg-neutral-50 px-2 py-2 text-center text-neutral-500">
                    本次回复未生成结构化决策。
                  </div>
                )}
              </InnerSection>
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** ---------- 持仓概览面板 ---------- */
function PositionsPanel({ iconMap }) {
  const { data } = useSWR("/api/positions/current", fetcher, { refreshInterval: 8000 });
  const totals = (data?.accountTotals ?? []).filter(
    (account) => {
      const modelId = String(account?.model_id ?? "");
      const displayName = String(account?.name ?? account?.display_name ?? "")
        .trim()
        .toLowerCase();
      if (isBaselineModelId(modelId)) return false;
      if (displayName === "btc benchmark") return false;
      return true;
    }
  );

  if (!totals.length) {
    return <div className="text-xs text-neutral-500">暂无持仓信息</div>;
  }

  return (
    <div className="space-y-3 text-[12px]">
      {totals.map((account) => {
        const positions = Object.values(account.positions ?? {});
        return (
          <div
            key={account.model_id}
            className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white to-slate-50 px-3 py-3 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ModelBadge
                  modelId={account.model_id}
                  icon={iconMap?.[account.model_id]}
                />
                <div>
                  <div className="text-[11px] text-neutral-500">模型</div>
                  <div className="text-sm font-semibold text-neutral-900">{humanizeModel(account.model_id)}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-neutral-500">账户净值</div>
                <div className="font-mono text-sm font-semibold text-neutral-900">
                  {formatCurrency(account.dollar_equity)}
                </div>
                <div className="text-[10px] text-neutral-500">
                  未实现盈亏 {formatCurrency(account.total_unrealized_pnl)}
                </div>
                <div className="text-[10px] text-neutral-500">
                  累计盈亏 {formatCurrency((account.wallet_balance ?? 0) - (account.starting_equity ?? 0))}
                </div>
              </div>
            </div>

            {positions.length ? (
              <div className="mt-3 space-y-2">
                {positions.map((pos, index) => {
                  const pnlClass = pos.unrealized_pnl >= 0 ? "text-emerald-600" : "text-rose-600";
                  return (
                    <div
                      key={`${account.model_id}-${pos.symbol}-${index}`}
                      className="flex items-center gap-3 rounded-2xl bg-white/85 px-3 py-2 shadow-inner"
                    >
                      <CoinBadge symbol={pos.symbol} size={26} />
                      <div className="flex-1 text-[11px] text-neutral-600">
                        <div className="flex items-center justify-between text-sm font-semibold text-neutral-900">
                          <span>{pos.symbol}</span>
                          <span className={pnlClass}>{formatCurrency(pos.unrealized_pnl)}</span>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-y-1 text-[10px]">
                          <span>方向 {String(pos.side).toUpperCase()} ×{pos.leverage}</span>
                          <span>数量 {formatQuantity(pos.quantity)}</span>
                          <span>开仓价 {formatPrice(pos.entry_price)}</span>
                          <span>最新价 {formatPrice(pos.current_price)}</span>
                          <span>止盈 {pos.take_profit != null ? formatPrice(pos.take_profit) : EMPTY_VALUE}</span>
                          <span>止损 {pos.stop_loss != null ? formatPrice(pos.stop_loss) : EMPTY_VALUE}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-2xl bg-white/70 px-3 py-2 text-[11px] text-neutral-500">
                暂无持仓，等待下一次执行。
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** ---------- 提出交易面板 ---------- */
function ProposalPanel() {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 p-4 text-xs text-neutral-500">
      提案草稿功能开发中，敬请期待。
    </div>
  );
}


export default function RightFeed() {
  const [activeTab, setActiveTab] = useState("positions");
  const { data: meData } = useSWR("/api/auth/me", fetcher, {
    revalidateOnFocus: false,
  });
  const guestMode = Boolean(meData?.user?.guest);
  const { data: modelsData } = useSWR("/api/models?includeSecrets=false", fetcher);
  const iconMap = useMemo(() => {
    const map = {};
    (modelsData?.models ?? []).forEach((model) => {
      map[model.model_id] = resolveIconForModel(model);
    });
    return map;
  }, [modelsData]);

  return (
    <aside className="flex h-full flex-col border-l border-neutral-200 bg-neutral-50">
      <div className="flex-shrink-0 border-b border-neutral-200">
        <div className="flex">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-3 py-2 text-xs font-semibold ${activeTab === tab.key ? "bg-white text-neutral-900" : "text-neutral-500 hover:text-neutral-800"
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {activeTab === "positions" && <PositionsPanel iconMap={iconMap} />}
        {activeTab === "completed" && <CompletedPanel />}
        {activeTab === "decision" && <DecisionPanel readOnly={guestMode} />}
        {activeTab === "modelchat" && <ModelChatPanel iconMap={iconMap} />}
        {activeTab === "proposal" && <ProposalPanel />}
      </div>
    </aside>
  );
}
