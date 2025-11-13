"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import CoinBadge from "./CoinBadge";

const fetcher = (url) => fetch(url).then((response) => response.json());

const BASELINE_MODEL_ID = "btc_benchmark";

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
function DecisionPanel() {
  const { data, mutate } = useSWR("/api/decisions/pending", fetcher, {
    refreshInterval: 8000,
  });
  const pending = data?.decisions ?? [];
  const [submitting, setSubmitting] = useState(null);

  const handleAction = async (id, action) => {
    setSubmitting(`${id}:${action}`);
    try {
      await fetch("/api/decisions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision_id: id, action }),
      });
      await mutate();
    } finally {
      setSubmitting(null);
    }
  };

  if (!pending.length) {
    return <div className="text-xs text-neutral-500">暂无需要人工确认的提案</div>;
  }

  return (
    <div className="space-y-3">
      {pending.map((decision) => {
        const entries = Object.entries(decision.decision_blob?.decisions ?? {}).filter(([, value]) => value);
        const reasoning =
          decision.decision_blob?.reasoning ??
          decision.decision_blob?.raw?.choices?.[0]?.message?.reasoning_content ??
          decision.decision_blob?.response_json?.choices?.[0]?.message?.reasoning_content ??
          "";
        const promptText = decision.decision_blob?.prompt_text ?? "";
        const responseText = decision.decision_blob?.response_text ?? "";
        const isFallback = decision.decision_blob?.is_fallback ?? false;

        return (
          <div key={decision.id} className="rounded border px-3 py-2 text-[12px] space-y-2">
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>{decision.model_name ?? humanizeModel(decision.model_id)}</span>
              <span>{new Date(decision.inserted_at).toLocaleString("zh-CN")}</span>
            </div>

            {reasoning && (
              <div className="text-[11px] text-neutral-700 whitespace-pre-wrap leading-relaxed">{reasoning}</div>
            )}

            {isFallback && (
              <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                ⚠️ 当前策略使用了占位或回退结果，请在执行前仔细检查。
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="mt-1 w-full border text-[11px] text-neutral-600">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="px-2 py-1 text-left">币种</th>
                    <th className="px-2 py-1 text-left">信号</th>
                    <th className="px-2 py-1 text-left">数量</th>
                    <th className="px-2 py-1 text-left">杠杆</th>
                    <th className="px-2 py-1 text-left">止盈</th>
                    <th className="px-2 py-1 text-left">止损</th>
                    <th className="px-2 py-1 text-left">风险估算</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([symbol, value]) => (
                    <tr key={symbol} className="border-t">
                      <td className="px-2 py-1 font-medium text-neutral-800">{symbol}</td>
                      <td className="px-2 py-1 uppercase">{value.signal}</td>
                      <td className="px-2 py-1">{formatQuantity(value.quantity)}</td>
                      <td className="px-2 py-1">{value.leverage ?? 1}x</td>
                      <td className="px-2 py-1">{value.profit_target ?? EMPTY_VALUE}</td>
                      <td className="px-2 py-1">{value.stop_loss ?? EMPTY_VALUE}</td>
                      <td className="px-2 py-1">
                        {value.risk_usd != null ? formatCurrency(value.risk_usd) : EMPTY_VALUE}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {promptText && (
              <details className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px]">
                <summary className="cursor-pointer font-semibold text-neutral-600">查看提示词 / 响应</summary>
                <div className="mt-1">
                  <div className="text-neutral-500">提示词：</div>
                  <pre className="mt-1 whitespace-pre-wrap text-neutral-700">{promptText}</pre>
                </div>
                <div className="mt-2">
                  <div className="text-neutral-500">模型回复：</div>
                  <pre className="mt-1 whitespace-pre-wrap text-neutral-700">{responseText}</pre>
                </div>
              </details>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAction(decision.id, "approve")}
                className="rounded bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-400"
                disabled={submitting === `${decision.id}:approve`}
              >
                {submitting === `${decision.id}:approve` ? "确认中..." : "确认执行"}
              </button>
              <button
                onClick={() => handleAction(decision.id, "reject")}
                className="rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-400"
                disabled={submitting === `${decision.id}:reject`}
              >
                {submitting === `${decision.id}:reject` ? "拒绝中..." : "拒绝提案"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** ---------- 模型对话面板 ---------- */
function ModelChatPanel() {
  const { data } = useSWR("/api/agents/logs", fetcher, { refreshInterval: 8000 });
  const logs = data?.logs ?? [];

  if (!logs.length) {
    return <div className="text-xs text-neutral-500">暂无模型对话</div>;
  }

  return (
    <div className="space-y-3">
      {logs.map((entry, index) => {
        const payload = parseResponsePayload(entry.response_json) ?? {};
        const decisions = extractDecisionList(payload);
        const reasoningText =
          payload.reasoning ??
          entry.response_json?.raw?.choices?.[0]?.message?.reasoning_content ??
          entry.response_json?.choices?.[0]?.message?.reasoning_content ??
          entry.cot_trace_summary ??
          "";
        const promptText = entry.prompt_text ?? payload.prompt_text ?? "";
        const responseText = entry.response_text ?? payload.response_text ?? "";
        const headline = entry.public_message || payload.summary || "模型已返回一组决策";
        const timestampLabel = formatTimestamp(entry.timestamp);

        return (
          <details
            key={entry.id ?? `${entry.model_id}-${entry.timestamp}`}
            className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[12px] leading-relaxed shadow-sm"
            open={index === 0}
          >
            <summary className="flex cursor-pointer items-center justify-between text-[11px] text-neutral-500">
              <span className="font-semibold text-neutral-900">{humanizeModel(entry.model_id)}</span>
              <span>{timestampLabel}</span>
            </summary>
            <div className="mt-2 text-neutral-800">{headline}</div>

            <div className="mt-2 space-y-3 border-t border-dashed border-neutral-200 pt-2 text-[11px]">
              {promptText && (
                <div>
                  <div className="font-semibold text-neutral-500">用户提示词</div>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 px-2 py-1 text-neutral-800">
                    {promptText}
                  </pre>
                </div>
              )}
              {reasoningText && (
                <div>
                  <div className="font-semibold text-neutral-500">思考过程</div>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 px-2 py-1 text-neutral-800">
                    {reasoningText}
                  </pre>
                </div>
              )}
              {decisions.length ? (
                <div>
                  <div className="font-semibold text-neutral-500">返回结果</div>
                  <div className="mt-1 space-y-2">
                    {decisions.map((decision, idx) => {
                      const coin = (decision.coin || decision.symbol || `#${idx + 1}`).toUpperCase();
                      const qty = formatQuantity(decision.quantity ?? decision.size);
                      const leverage = decision.leverage != null ? `${decision.leverage}x` : EMPTY_VALUE;
                      const signal = (decision.signal || decision.action || "—").toUpperCase();
                      const justification = decision.justification ?? decision.reason ?? "";
                      return (
                        <div key={`${coin}-${idx}`} className="rounded border border-neutral-200 px-2 py-2">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-800">
                            <span>{coin}</span>
                            <span className="text-neutral-500">{signal}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-neutral-500">
                            <span>数量 {qty}</span>
                            <span>杠杆 {leverage}</span>
                            {decision.risk_usd != null && <span>风险 {formatCurrency(decision.risk_usd)}</span>}
                          </div>
                          {justification && <p className="mt-1 text-[11px] text-neutral-600">{justification}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded border border-neutral-100 bg-neutral-50 px-2 py-1 text-neutral-500">
                  本次回复未生成结构化决策。
                </div>
              )}
              {responseText && (
                <div>
                  <div className="font-semibold text-neutral-500">模型回复（原文）</div>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 px-2 py-1 text-neutral-800">
                    {responseText}
                  </pre>
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** ---------- 持仓概览面板 ---------- */
function PositionsPanel() {
  const { data } = useSWR("/api/positions/current", fetcher, { refreshInterval: 8000 });
  const totals = (data?.accountTotals ?? []).filter(
    (account) => account.model_id !== BASELINE_MODEL_ID
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
              <div>
                <div className="text-[11px] text-neutral-500">模型</div>
                <div className="text-sm font-semibold text-neutral-900">{humanizeModel(account.model_id)}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-neutral-500">账户净值</div>
                <div className="font-mono text-sm font-semibold text-neutral-900">
                  {formatCurrency(account.dollar_equity)}
                </div>
                <div className="text-[10px] text-neutral-500">
                  未实现盈亏 {formatCurrency(account.total_unrealized_pnl)}
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
        {activeTab === "positions" && <PositionsPanel />}
        {activeTab === "completed" && <CompletedPanel />}
        {activeTab === "decision" && <DecisionPanel />}
        {activeTab === "modelchat" && <ModelChatPanel />}
        {activeTab === "proposal" && <ProposalPanel />}
      </div>
    </aside>
  );
}
