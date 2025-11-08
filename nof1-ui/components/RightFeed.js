"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";

const fetcher = (url) => fetch(url).then((response) => response.json());

const TAB_CONFIG = [
  { key: "completed", label: "成交记录" },
  { key: "decision", label: "决策确认" },
  { key: "modelchat", label: "模型对话" },
  { key: "positions", label: "持仓概览" },
  { key: "proposal", label: "提出交易" },
];

const MODEL_LABELS = {
  "gpt-5": "GPT 5",
  "claude-sonnet-4-5": "CLAUDE SONNET 4.5",
  "gemini-2-5-pro": "GEMINI 2.5 PRO",
  "grok-4": "GROK 4",
  "deepseek-chat-v3-1": "DEEPSEEK CHAT v3.1",
  "qwen3-max": "QWEN3 MAX",
};

const DECISION_SOURCE_MAP = {
  ai_auto: "AI 自动执行",
  ai_proposed_human_approved: "AI 提案 · 人工批准",
  human_manual: "人工干预",
  ai_consensus: "AI 共识方案",
};

const formatCurrency = (value) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "—";
  return `US$${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
};

const formatPrice = (value) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "—";
  return `US$${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}`;
};

const formatQuantity = (value) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
};

const humanizeModel = (id = "") => MODEL_LABELS[id] ?? id;

function FeedRow({ row }) {
  const sideClass = row.sideType === "SHORT" ? "text-rose-600" : "text-emerald-600";

  return (
    <div className="rounded border border-neutral-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-start justify-between gap-3 text-[12px] text-neutral-700">
        <div className="leading-tight">
          <span className="font-semibold text-emerald-600">{row.model}</span>
          <span className="mx-1 text-neutral-400">·</span>
          <span>{row.action}</span>
          <span className="mx-1 text-neutral-400">·</span>
          <span className={`${sideClass} font-semibold uppercase`}>{row.sideLabel}</span>
          <span className="mx-1 text-neutral-400">·</span>
          <span>标的 {row.asset}</span>
        </div>
        <span className="text-neutral-400 text-[11px] whitespace-nowrap">{row.time}</span>
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-neutral-600">
        <div>价格区间：{row.entryPrice} → {row.exitPrice}</div>
        <div>成交数量：{row.quantity}</div>
        <div>名义价值：{row.notionalStart} → {row.notionalEnd}</div>
        <div>持仓时长：{row.holding}</div>
      </div>
      <div className="mt-2 text-[12px] font-semibold text-neutral-700">
        净盈亏：
        <span className={row.pnl.startsWith("-") ? "text-rose-600" : "text-emerald-600"}>{row.pnl}</span>
      </div>
    </div>
  );
}

function CompletedPanel() {
  const { data } = useSWR("/api/trades/recent", fetcher, { suspense: false, refreshInterval: 5000 });
  const trades = data?.trades ?? [];

  if (!trades.length) {
    return <div className="text-xs text-neutral-500">暂无成交记录。</div>;
  }

  return (
    <div className="space-y-3">
      {trades.map((trade) => {
        const sideType = String(trade.side ?? "LONG").toUpperCase();
        const entryPrice = trade.entry_price ?? trade.price ?? null;
        const exitPrice = trade.exit_price ?? entryPrice;
        const quantity = trade.quantity ?? null;
        const notionalStart = entryPrice != null && quantity != null ? entryPrice * quantity : null;
        const notionalEnd = exitPrice != null && quantity != null ? exitPrice * quantity : null;
        const pnl = trade.realized_net_pnl ?? 0;

        return (
          <FeedRow
            key={trade.id}
            row={{
              model: humanizeModel(trade.model_id),
              action: DECISION_SOURCE_MAP[trade.decision_source] ?? "来源未知",
              sideType,
              sideLabel: sideType === "SHORT" ? "做空" : "做多",
              asset: trade.symbol ?? "—",
              time: trade.exit_human_time ?? "—",
              entryPrice: formatPrice(entryPrice),
              exitPrice: formatPrice(exitPrice),
              quantity: formatQuantity(quantity),
              notionalStart: formatCurrency(notionalStart),
              notionalEnd: formatCurrency(notionalEnd),
              holding: trade.holding_time ?? "—",
              pnl: formatCurrency(pnl),
            }}
          />
        );
      })}
    </div>
  );
}

function DecisionPanel() {
  const { data, mutate } = useSWR("/api/decisions/pending", fetcher, {
    suspense: false,
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
    return <div className="text-xs text-neutral-500">暂无需要人工确认的提案。</div>;
  }

  return (
    <div className="space-y-3">
      {pending.map((decision) => {
        const entries = Object.entries(decision.decision_blob?.decisions ?? {}).filter(([, value]) => value);
        const reasoning = decision.decision_blob?.reasoning ?? "";
        const promptText = decision.decision_blob?.prompt_text ?? "";
        const responseText = decision.decision_blob?.response_text ?? "";
        const isFallback = decision.decision_blob?.is_fallback ?? false;
        return (
          <div key={decision.id} className="rounded border px-3 py-2 text-[12px] space-y-2">
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>{decision.model_name ?? humanizeModel(decision.model_id)}</span>
              <span>{new Date(decision.inserted_at).toLocaleString("zh-CN")}</span>
            </div>
            {reasoning ? (
              <div className="text-[11px] text-neutral-700 whitespace-pre-wrap leading-relaxed">{reasoning}</div>
            ) : null}
            {isFallback ? (
              <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                ⚠️ 当前决策使用了占位或回退结果，请在执行前仔细检查。
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="mt-1 w-full border text-[11px] text-neutral-600">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="px-2 py-1 text-left">资产</th>
                    <th className="px-2 py-1 text-left">信号</th>
                    <th className="px-2 py-1 text-left">数量</th>
                    <th className="px-2 py-1 text-left">杠杆</th>
                    <th className="px-2 py-1 text-left">止盈</th>
                    <th className="px-2 py-1 text-left">止损</th>
                    <th className="px-2 py-1 text-left">风险预算</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([symbol, value]) => (
                    <tr key={symbol} className="border-t">
                      <td className="px-2 py-1 font-medium text-neutral-800">{symbol}</td>
                      <td className="px-2 py-1 uppercase">{value.signal}</td>
                      <td className="px-2 py-1">{formatQuantity(value.quantity)}</td>
                      <td className="px-2 py-1">{value.leverage ?? 1}x</td>
                      <td className="px-2 py-1">{value.profit_target ?? "—"}</td>
                      <td className="px-2 py-1">{value.stop_loss ?? "—"}</td>
                      <td className="px-2 py-1">{value.risk_usd != null ? formatCurrency(value.risk_usd) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {promptText ? (
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
            ) : null}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAction(decision.id, "approve")}
                className="rounded bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-400"
                disabled={submitting === `${decision.id}:approve`}
              >
                {submitting === `${decision.id}:approve` ? "批准中..." : "批准执行"}
              </button>
              <button
                onClick={() => handleAction(decision.id, "reject")}
                className="rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-400"
                disabled={submitting === `${decision.id}:reject`}
              >
                {submitting === `${decision.id}:reject` ? "驳回中..." : "拒绝提案"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModelChatPanel() {
  const { data } = useSWR("/api/agents/logs", fetcher, { suspense: false, refreshInterval: 8000 });
  const logs = data?.logs ?? [];

  if (!logs.length) {
    return <div className="text-xs text-neutral-500">暂无模型对话。</div>;
  }

  return (
    <div className="space-y-3">
      {logs.map((entry) => {
        const hasDetails = entry.prompt_text || entry.response_text;
        return (
          <div
            key={entry.id ?? `${entry.model_id}-${entry.timestamp}`}
            className="rounded border px-3 py-2 text-[12px] leading-relaxed"
          >
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>{humanizeModel(entry.model_id)}</span>
              <span>{new Date(entry.timestamp).toLocaleString("zh-CN")}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap">{entry.public_message}</p>
            {entry.cot_trace_summary ? (
              <div className="mt-2 text-[11px] text-neutral-500">总结：{entry.cot_trace_summary}</div>
            ) : null}
            {hasDetails ? (
              <details className="mt-2 rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px]">
                <summary className="cursor-pointer font-semibold text-neutral-600">查看原始对话</summary>
                {entry.prompt_text ? (
                  <div className="mt-2">
                    <div className="text-neutral-500">提示词：</div>
                    <pre className="mt-1 whitespace-pre-wrap text-neutral-700">{entry.prompt_text}</pre>
                  </div>
                ) : null}
                {entry.response_text ? (
                  <div className="mt-2">
                    <div className="text-neutral-500">模型回复：</div>
                    <pre className="mt-1 whitespace-pre-wrap text-neutral-700">{entry.response_text}</pre>
                  </div>
                ) : null}
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PositionsPanel() {
  const { data } = useSWR("/api/positions/current", fetcher, { suspense: false, refreshInterval: 8000 });
  const totals = data?.accountTotals ?? [];

  if (!totals.length) {
    return <div className="text-xs text-neutral-500">暂无持仓信息。</div>;
  }

  return (
    <div className="space-y-3 text-[12px]">
      {totals.map((account) => (
        <div key={account.model_id} className="rounded border px-3 py-2 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold">{humanizeModel(account.model_id)}</span>
            <span className="text-neutral-500">账户权益 {formatCurrency(account.dollar_equity)}</span>
          </div>
          <div className="flex flex-wrap gap-4 text-[11px] text-neutral-500">
            <span>未实现盈亏 {formatCurrency(account.total_unrealized_pnl)}</span>
            <span>可用保证金 {formatCurrency(account.available_cash)}</span>
          </div>
          {Object.values(account.positions ?? {}).map((pos, index) => {
            const exitPlan = pos.exit_plan ?? {};
            return (
              <div key={`${pos.symbol}-${index}`} className="rounded border px-3 py-2 text-[11px] space-y-1 bg-neutral-50">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {pos.symbol} · {pos.side} x{pos.leverage}
                  </span>
                  <span className={pos.unrealized_pnl >= 0 ? "text-emerald-600" : "text-rose-600"}>
                    {formatCurrency(pos.unrealized_pnl)}
                  </span>
                </div>
                <div>开仓价 {formatPrice(pos.entry_price)} · 最新价 {formatPrice(pos.current_price)}</div>
                <div>名义敞口 {formatCurrency(pos.notional_usd)}</div>
                <div>
                  退出计划：止盈 {exitPlan.profit_target ?? "—"} / 止损 {exitPlan.stop_loss ?? "—"}
                  <span className="block text-neutral-500">失效条件：{exitPlan.invalidation_condition ?? exitPlan.invalidation ?? "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ProposalPanel() {
  const { data } = useSWR("/api/proposals/assets", fetcher, { suspense: false });
  const assets = data?.assets ?? [];
  const [selection, setSelection] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSelection(assets.map((asset) => ({ ...asset, selected: false })));
  }, [assets]);

  const handleToggle = (symbol, checked) => {
    setSelection((prev) => prev.map((item) => (item.symbol === symbol ? { ...item, selected: checked } : item)));
  };

  const handleChange = (symbol, field, value) => {
    setSelection((prev) => prev.map((item) => (item.symbol === symbol ? { ...item, [field]: value } : item)));
  };

  const handleSubmit = async () => {
    const payload = selection.filter((asset) => asset.selected);
    if (!payload.length) return;
    setSubmitting(true);
    try {
      await fetch("/api/proposals/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposals: payload }),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!selection.length) {
    return <div className="text-xs text-neutral-500">暂无可申请的交易标的。</div>;
  }

  return (
    <div className="space-y-3 text-[12px]">
      {selection.map((asset) => (
        <div key={asset.symbol} className="rounded border px-3 py-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <input
              type="checkbox"
              checked={asset.selected}
              onChange={(event) => handleToggle(asset.symbol, event.target.checked)}
              aria-label={`选择 ${asset.symbol}`}
            />
            <span className="font-semibold">{asset.symbol}</span>
            <span className="text-xs text-neutral-500">最新价 {formatPrice(asset.lastPrice)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span>方向</span>
              <select
                value={asset.side}
                onChange={(event) => handleChange(asset.symbol, "side", event.target.value)}
                className="w-full rounded border px-2 py-1"
              >
                <option value="LONG">做多 LONG</option>
                <option value="SHORT">做空 SHORT</option>
              </select>
            </label>
            <label className="space-y-1">
              <span>杠杆倍数</span>
              <input
                type="number"
                value={asset.leverage}
                onChange={(event) => handleChange(asset.symbol, "leverage", Number(event.target.value))}
                className="w-full rounded border px-2 py-1"
              />
            </label>
            <label className="space-y-1">
              <span>名义敞口 (USD)</span>
              <input
                type="number"
                value={asset.notional}
                onChange={(event) => handleChange(asset.symbol, "notional", Number(event.target.value))}
                className="w-full rounded border px-2 py-1"
              />
            </label>
            <label className="space-y-1">
              <span>止损价</span>
              <input
                type="number"
                value={asset.stopLoss}
                onChange={(event) => handleChange(asset.symbol, "stopLoss", Number(event.target.value))}
                className="w-full rounded border px-2 py-1"
              />
            </label>
            <label className="col-span-2 space-y-1">
              <span>申请说明</span>
              <textarea
                value={asset.notes}
                onChange={(event) => handleChange(asset.symbol, "notes", event.target.value)}
                className="w-full rounded border px-2 py-1"
                rows={2}
              />
            </label>
          </div>
        </div>
      ))}
      <button
        onClick={handleSubmit}
        className="rounded bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
        disabled={submitting}
      >
        {submitting ? "提交中..." : "提交所选申请"}
      </button>
    </div>
  );
}

export default function RightFeed() {
  const [activeTab, setActiveTab] = useState("completed");

  return (
    <aside className="flex h-full flex-col border-l border-neutral-200 bg-neutral-50">
      <div className="flex-shrink-0 border-b border-neutral-200">
        <div className="flex">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-3 py-2 text-xs font-semibold ${
                activeTab === tab.key
                  ? "bg-white text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {activeTab === "completed" && <CompletedPanel />}
        {activeTab === "decision" && <DecisionPanel />}
        {activeTab === "modelchat" && <ModelChatPanel />}
        {activeTab === "positions" && <PositionsPanel />}
        {activeTab === "proposal" && <ProposalPanel />}
      </div>
    </aside>
  );
}
