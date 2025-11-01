"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

// TODO: 接入真实后端时，请改用统一的数据请求封装（如 apiClient 或自定义 hook），方便落地鉴权与错误处理。
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

// FeedRow 负责呈现单条成交记录，包含来源、方向、价格与盈亏信息。
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

// CompletedPanel 展示最近成交流水，来自 /api/trades/recent，可替换为真实撮合记录。
function CompletedPanel() {
  const { data } = useSWR("/api/trades/recent", fetcher, { suspense: false, refreshInterval: 5000 });
  const trades = data?.trades ?? [];

  if (!trades.length) {
    return <div className="text-xs text-neutral-500">暂无成交记录。</div>;
  }

  return (
    <div className="space-y-3">
      {trades.map((trade, idx) => {
        const sideType = String(trade.side ?? "LONG").toUpperCase();
        const entryPrice = trade.entry_price ?? trade.price ?? null;
        const exitPrice = trade.exit_price ?? entryPrice;
        const quantity = trade.quantity ?? null;
        const notionalStart = entryPrice != null && quantity != null ? entryPrice * quantity : null;
        const notionalEnd = exitPrice != null && quantity != null ? exitPrice * quantity : null;
        const pnl = trade.realized_net_pnl ?? 0;

        return (
          <FeedRow
            key={`${trade.model_id}-${idx}`}
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
              notionalStart: formatCurrency(Math.abs(notionalStart)),
              notionalEnd: formatCurrency(Math.abs(notionalEnd)),
              holding: trade.holding_time ?? "—",
              pnl: `${pnl >= 0 ? "+" : "-"}US$${Math.abs(pnl).toFixed(2)}`,
            }}
          />
        );
      })}
    </div>
  );
}

// DecisionPanel 呈现待人工确认的 AI 提案，并允许用户编辑后提交到 /api/decisions/confirm。
function DecisionPanel() {
  const { data, mutate } = useSWR("/api/decisions/pending", fetcher, { suspense: false });
  const pending = data?.decisions ?? [];
  const [editing, setEditing] = useState({});
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    const next = Object.fromEntries(pending.map((item) => [item.id, { ...item }]));
    setEditing(next);
  }, [pending]);

  const handleChange = (id, field, value) => {
    setEditing((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
      },
    }));
  };

  const handleConfirm = async (id) => {
    const payload = editing[id];
    if (!payload) return;
    setSavingId(id);
    try {
      await fetch("/api/decisions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await mutate();
    } finally {
      setSavingId(null);
    }
  };

  if (!pending.length) {
    return <div className="text-xs text-neutral-500">暂无需要人工确认的提案。</div>;
  }

  return (
    <div className="space-y-3">
      {pending.map((decision) => {
        const local = editing[decision.id] ?? decision;
        return (
          <div key={decision.id} className="rounded border px-3 py-2 text-[12px] space-y-2">
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>{humanizeModel(decision.modelId)} · {decision.asset}</span>
              <span>{new Date(decision.timestamp).toLocaleString("zh-CN")}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="space-y-1">
                <span>方向</span>
                <select
                  value={local.side}
                  onChange={(event) => handleChange(decision.id, "side", event.target.value)}
                  className="w-full rounded border px-2 py-1"
                >
                  <option value="LONG">做多 LONG</option>
                  <option value="SHORT">做空 SHORT</option>
                </select>
              </label>
              <label className="space-y-1">
                <span>目标价</span>
                <input
                  type="number"
                  value={local.target}
                  onChange={(event) => handleChange(decision.id, "target", Number(event.target.value))}
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="space-y-1">
                <span>止损价</span>
                <input
                  type="number"
                  value={local.stopLoss}
                  onChange={(event) => handleChange(decision.id, "stopLoss", Number(event.target.value))}
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="space-y-1">
                <span>仓位规模</span>
                <input
                  type="number"
                  value={local.size}
                  onChange={(event) => handleChange(decision.id, "size", Number(event.target.value))}
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="space-y-1">
                <span>杠杆倍数</span>
                <input
                  type="number"
                  value={local.leverage ?? 1}
                  onChange={(event) => handleChange(decision.id, "leverage", Number(event.target.value))}
                  className="w-full rounded border px-2 py-1"
                />
              </label>
              <label className="col-span-2 space-y-1">
                <span>决策说明</span>
                <textarea
                  value={local.comment}
                  onChange={(event) => handleChange(decision.id, "comment", event.target.value)}
                  className="w-full rounded border px-2 py-1"
                  rows={3}
                />
              </label>
            </div>
            <button
              onClick={() => handleConfirm(decision.id)}
              className="bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-700"
              disabled={savingId === decision.id}
            >
              {savingId === decision.id ? "提交中…" : "确认修改"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ModelChatPanel 显示 /api/agents/logs 返回的自然语言解释，用于审计与回放。
function ModelChatPanel() {
  const { data } = useSWR("/api/agents/logs", fetcher, { suspense: false, refreshInterval: 8000 });
  const logs = data?.logs ?? [];

  if (!logs.length) {
    return <div className="text-xs text-neutral-500">暂无模型对话。</div>;
  }

  return (
    <div className="space-y-3">
      {logs.map((entry, idx) => (
        <div key={`${entry.model_id}-${idx}`} className="rounded border px-3 py-2 text-[12px] leading-relaxed">
          <div className="flex items-center justify-between text-[11px] text-neutral-500">
            <span>{humanizeModel(entry.model_id)}</span>
            <span>{new Date(entry.timestamp).toLocaleString("zh-CN")}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap">{entry.public_message}</p>
          {entry.positions_summary?.length ? (
            <div className="mt-2 space-y-1 text-[11px] text-neutral-600">
              {entry.positions_summary.map((pos, positionIdx) => (
                <div key={`${entry.model_id}-${pos.symbol}-${positionIdx}`}>
                  <strong>{pos.symbol}</strong>
                  <span className="mx-1 text-neutral-400">·</span>
                  <span>{pos.side} x{pos.leverage}</span>
                  <span className="mx-1 text-neutral-400">·</span>
                  <span>{pos.thesis}</span>
                  {pos.target ? <span className="ml-1 text-neutral-500">目标 {pos.target}</span> : null}
                  {pos.invalidation ? <span className="ml-1 text-neutral-500">失效条件 {pos.invalidation}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
          {entry.risk_notes ? (
            <div className="mt-2 text-[11px] text-amber-600">风险提醒：{entry.risk_notes}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// PositionsPanel 读取 /api/positions/current，展示账户权益、可用保证金与单仓退出计划。
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
            const stopLoss = pos.exit_plan?.stop_loss ?? pos.exit_plan?.stopLoss ?? "—";
            const profitTarget = pos.exit_plan?.profit_target ?? "—";
            const invalidation = pos.exit_plan?.invalidation_condition ?? pos.exit_plan?.invalidation ?? "—";
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
                <div>开仓价 {formatPrice(pos.entry_price)} → 最新价 {formatPrice(pos.current_price)}</div>
                <div>名义敞口 {formatCurrency(pos.notional_usd)}</div>
                <div>
                  退出计划：止盈 {profitTarget} / 止损 {stopLoss}
                  <span className="block text-neutral-500">失效条件：{invalidation}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ProposalPanel 用于批量提交交易申请，调用 /api/proposals/apply。
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
        {submitting ? "提交中…" : "申请交易"}
      </button>
    </div>
  );
}

export default function RightFeed() {
  const [activeTab, setActiveTab] = useState("completed");

  const panel = useMemo(() => {
    switch (activeTab) {
      case "decision":
        return <DecisionPanel />;
      case "modelchat":
        return <ModelChatPanel />;
      case "positions":
        return <PositionsPanel />;
      case "proposal":
        return <ProposalPanel />;
      default:
        return <CompletedPanel />;
    }
  }, [activeTab]);

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded border border-neutral-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">监控面板</h3>
      </div>
      <div className="mt-3 flex w-full gap-0 text-[11px]">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 border border-neutral-200 px-2 py-1.5 transition ${activeTab === tab.key ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="relative mt-3 flex-1 overflow-hidden">
        <div className="h-full flex-1 overflow-y-auto pr-1 space-y-3">{panel}</div>
      </div>
    </aside>
  );
}
