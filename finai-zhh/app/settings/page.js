"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";

const fetcher = (url) => fetch(url).then((res) => res.json());
const clone = (value) =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
function SectionCard({ title, description, children, footer }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-neutral-500">{description}</p>
        ) : null}
      </div>
      {children}
      {footer ? <div className="mt-4 flex justify-end">{footer}</div> : null}
    </section>
  );
}

function Hint({ text }) {
  return (
    <span className="group relative ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-500 ring-1 ring-neutral-200 transition hover:bg-neutral-200">
      ?
      <span className="pointer-events-none absolute left-1/2 top-full z-10 hidden w-64 -translate-x-1/2 translate-y-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] text-neutral-700 shadow-lg shadow-neutral-200/70 group-hover:block">
        {text}
      </span>
    </span>
  );
}

export default function SettingsPage() {
  const { data: meData } = useSWR("/api/auth/me", fetcher, {
    revalidateOnFocus: false,
  });
  const { data: configData } = useSWR("/api/sim-config", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    refreshInterval: 0,
  });
  const { data: riskData, mutate: mutateRisk } = useSWR(
    "/api/binance/risk",
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: 0,
    }
  );
  const { data: fundingData, mutate: mutateFunding } = useSWR(
    "/api/binance/funding",
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: 0,
    }
  );
  const [formState, setFormState] = useState(null);
  const [savingSection, setSavingSection] = useState(null);
  const [status, setStatus] = useState("");
  const guestMode = Boolean(meData?.user?.guest);

  useEffect(() => {
    if (configData) {
      setFormState(clone(configData));
    }
  }, [configData]);

  const handleFeeChange = (symbol, field, value) => {
    if (guestMode) return;
    setFormState((prev) => {
      const next = clone(prev ?? {});
      next.fees = next.fees ?? { default: { maker: 0, taker: 0 } };
      const targetKey = symbol === "default" ? "default" : symbol;
      next.fees[targetKey] = next.fees[targetKey] ?? { maker: 0, taker: 0 };
      next.fees[targetKey][field] = value;
      return next;
    });
  };

  const saveConfig = async (label, section) => {
    if (!formState) return;
    if (guestMode) {
      setStatus("游客模式仅可查看，无法保存设置");
      return;
    }
    const payloadToSend = clone(formState);
    setSavingSection(section);
    setStatus("");
    try {
      const response = await fetch("/api/sim-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadToSend),
      });
      const responseBody = await response.json();
      if (!response.ok) {
        throw new Error(responseBody.error || "保存失败");
      }
      setFormState(clone(responseBody));
      setStatus(`${label} 设置已保存`);
    } catch (error) {
      setStatus(error.message || "保存失败");
    } finally {
      setSavingSection(null);
      setTimeout(() => setStatus(""), 4000);
    }
  };

  const riskLimits = riskData?.risk_limits ?? [];
  const fundingRates = fundingData?.funding_rates ?? {};

  const syncFromBinance = async (scope) => {
    if (guestMode) {
      setStatus("游客模式仅可查看，无法同步数据");
      return;
    }
    setStatus(`正在同步 ${scope === "risk" ? "风险分层" : "资金费"}...`);
    try {
      const base = scope === "risk" ? "/api/binance/risk" : "/api/binance/funding";
      const resp = await fetch(base, { method: "POST" });
      const body = await resp.json();
      if (!resp.ok) {
        throw new Error(body?.error || "同步失败，请检查代理/网络");
      }
      if (scope === "risk") {
        await mutateRisk();
        setStatus("已同步风险分层");
      } else {
        await mutateFunding();
        setStatus("已同步资金费");
      }
    } catch (error) {
      setStatus(error?.message || "同步失败");
    } finally {
      setTimeout(() => setStatus(""), 4000);
    }
  };

  const handleSyncRisk = () => syncFromBinance("risk");
  const handleSyncFunding = () => syncFromBinance("funding");

  // 自动同步由 autoRunner 负责；此处不做额外定时。

  if (!formState) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-semibold text-neutral-900">系统设置</h1>
        <p className="mt-4 text-sm text-neutral-500">加载配置中...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-neutral-900">
            系统设置
            <Hint text="集中配置手续费、资金费和风险分层。保存按钮按区块独立，不会互相影响。" />
          </h1>
          <p className="text-sm text-neutral-500">
            配置交易对保证金模式、手续费，以及资金费结算方式。
          </p>
          {status ? (
            <span className="text-sm text-emerald-600">{status}</span>
          ) : null}
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50"
        >
          返回主界面
        </Link>
      </div>
      {guestMode ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          当前为游客模式：设置页仅可查看，不能修改或同步。
        </div>
      ) : null}

      <SectionCard
        title="手续费费率"
        description="设置全局 Maker/Taker 费率（不区分币种）。默认 0.1% / 0.1%。"
        footer={
          <button
            type="button"
            onClick={() => saveConfig("手续费", "fees")}
            disabled={guestMode || savingSection === "fees"}
            className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-700 disabled:opacity-50"
          >
            {savingSection === "fees" ? "保存中..." : "保存手续费设置"}
          </button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="inline-flex items-center gap-2 text-neutral-600">
              默认 Maker（%）
              <Hint text="未覆盖交易对时使用的挂单手续费率（占比）。" />
            </span>
            <input
              type="number"
              step="0.00001"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm"
              disabled={guestMode}
              value={formState.fees?.default?.maker ?? 0}
              onChange={(event) =>
                handleFeeChange(
                  "default",
                  "maker",
                  Number(event.target.value || 0)
                )
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="inline-flex items-center gap-2 text-neutral-600">
              默认 Taker（%）
              <Hint text="未覆盖交易对时使用的吃单手续费率（占比）。" />
            </span>
            <input
              type="number"
              step="0.00001"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm"
              disabled={guestMode}
              value={formState.fees?.default?.taker ?? 0}
              onChange={(event) =>
                handleFeeChange(
                  "default",
                  "taker",
                  Number(event.target.value || 0)
                )
              }
            />
          </label>
        </div>
      </SectionCard>

      <SectionCard
        title="风控分层"
        description="从 Binance 自动同步杠杆分层，以下为只读展示。"
        footer={
          <button
            type="button"
            onClick={handleSyncRisk}
            disabled={guestMode}
            className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-700"
          >
            同步风险分层
          </button>
        }
      >
        <div className="overflow-auto rounded-xl border border-neutral-200">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-500">
              <tr>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Notional Cap</th>
                <th className="px-3 py-2">Max Lev</th>
                <th className="px-3 py-2">IMR</th>
                <th className="px-3 py-2">MMR</th>
              </tr>
            </thead>
            <tbody>
              {(riskLimits ?? []).map((row, index) => (
                <tr key={`${row.symbol}-${row.tier}-${index}`} className="border-t border-neutral-200">
                  <td className="px-3 py-2 font-medium">{row.symbol}</td>
                  <td className="px-3 py-2">{row.tier}</td>
                  <td className="px-3 py-2">{row.notional_cap}</td>
                  <td className="px-3 py-2">{row.max_leverage}</td>
                  <td className="px-3 py-2">{row.imr}</td>
                  <td className="px-3 py-2">{row.mmr}</td>
                </tr>
              ))}
              {!riskLimits?.length && (
                <tr className="border-t border-neutral-200">
                  <td colSpan={6} className="px-3 py-4 text-center text-xs text-neutral-500">
                    暂无数据，点击“同步 Binance 数据”尝试刷新。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="资金费设置"
        description="展示从 Binance 获取的最新资金费率，结果只读。"
        footer={
          <button
            type="button"
            onClick={handleSyncFunding}
            disabled={guestMode}
            className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-700"
          >
            刷新资金费
          </button>
        }
      >
        <div className="overflow-hidden rounded-xl border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-500">
              <tr>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Funding Rate (8h)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(fundingRates).map(([symbol, rate]) => (
                <tr key={symbol} className="border-t border-neutral-200">
                  <td className="px-3 py-2 font-medium">{symbol}</td>
                  <td className="px-3 py-2">{Number(rate ?? 0)}</td>
                </tr>
              ))}
              {!Object.keys(fundingRates).length && (
                <tr className="border-t border-neutral-200">
                  <td colSpan={2} className="px-3 py-4 text-center text-xs text-neutral-500">
                    暂无资金费数据，点击“刷新资金费”同步。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
