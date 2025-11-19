"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

export default function SettingsPage() {
  const { data: configData, mutate } = useSWR("/api/sim-config", fetcher);
  const { data: symbolsData } = useSWR("/api/symbols", fetcher);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (configData) {
      setFormState(clone(configData));
    }
  }, [configData]);

  const symbolList = useMemo(() => {
    const fromApi =
      symbolsData?.symbols?.map((s) => s.toUpperCase()) ?? [];
    const fromConfig = Object.keys(formState?.symbols ?? {}).map((s) =>
      s.toUpperCase()
    );
    const merged = new Set([...fromApi, ...fromConfig]);
    return Array.from(merged).sort();
  }, [symbolsData, formState]);

  const feeSymbols = useMemo(() => {
    const overrides = Object.keys(formState?.fees ?? {})
      .filter((key) => key !== "default")
      .map((s) => s.toUpperCase());
    const merged = new Set([...symbolList, ...overrides]);
    return Array.from(merged).sort();
  }, [symbolList, formState]);

  const handleFeeChange = (symbol, field, value) => {
    setFormState((prev) => {
      const next = clone(prev ?? {});
      next.fees = next.fees ?? { default: { maker: 0, taker: 0 } };
      const targetKey = symbol === "default" ? "default" : symbol;
      next.fees[targetKey] = next.fees[targetKey] ?? { maker: 0, taker: 0 };
      next.fees[targetKey][field] = value;
      return next;
    });
  };

  const clearFeeOverride = (symbol) => {
    setFormState((prev) => {
      const next = clone(prev ?? {});
      if (next.fees) {
        delete next.fees[symbol];
      }
      return next;
    });
  };

  const handleFundingChange = (field, value) => {
    setFormState((prev) => {
      const next = clone(prev ?? {});
      next.funding = next.funding ?? {};
      next.funding[field] = value;
      return next;
    });
  };

  const saveConfig = async (label) => {
    if (!formState) return;
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/sim-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formState),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "保存失败");
      }
      setFormState(clone(payload));
      mutate(payload, false);
      setStatus(`${label} 设置已保存`);
    } catch (error) {
      setStatus(error.message || "保存失败");
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(""), 4000);
    }
  };

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
          <h1 className="text-2xl font-semibold text-neutral-900">系统设置</h1>
          <p className="text-sm text-neutral-500">
            配置交易对保证金模式、手续费，以及资金费结算方式。
          </p>
          {status ? (
            <span className="text-sm text-emerald-600">{status}</span>
          ) : null}
        </div>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50"
        >
          返回主界面
        </Link>
      </div>

      <SectionCard
        title="手续费费率"
        description="设置默认 Maker/Taker 费率，以及特定交易对的覆盖值。"
        footer={
          <button
            type="button"
            onClick={() => saveConfig("手续费")}
            disabled={saving}
            className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存手续费设置"}
          </button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-600">默认 Maker（%）</span>
            <input
              type="number"
              step="0.00001"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm"
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
            <span className="text-neutral-600">默认 Taker（%）</span>
            <input
              type="number"
              step="0.00001"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm"
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
        <div className="mt-6 overflow-hidden rounded-xl border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-500">
              <tr>
                <th className="px-4 py-2">Symbol</th>
                <th className="px-4 py-2">Maker</th>
                <th className="px-4 py-2">Taker</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {feeSymbols.map((symbol) => {
                if (symbol === "DEFAULT") return null;
                return (
                  <tr
                    key={symbol}
                    className="border-t border-neutral-200 text-sm text-neutral-700"
                  >
                    <td className="px-4 py-2 font-medium">{symbol}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        step="0.00001"
                        className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                        value={formState.fees?.[symbol]?.maker ?? ""}
                        placeholder={String(
                          formState.fees?.default?.maker ?? 0
                        )}
                        onChange={(event) =>
                          handleFeeChange(
                            symbol,
                            "maker",
                            event.target.value === ""
                              ? ""
                              : Number(event.target.value)
                          )
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        step="0.00001"
                        className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                        value={formState.fees?.[symbol]?.taker ?? ""}
                        placeholder={String(
                          formState.fees?.default?.taker ?? 0
                        )}
                        onChange={(event) =>
                          handleFeeChange(
                            symbol,
                            "taker",
                            event.target.value === ""
                              ? ""
                              : Number(event.target.value)
                          )
                        }
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {formState.fees?.[symbol] ? (
                        <button
                          type="button"
                          onClick={() => clearFeeOverride(symbol)}
                          className="text-xs font-semibold text-rose-600 hover:underline"
                        >
                          清除
                        </button>
                      ) : (
                        <span className="text-xs text-neutral-400">继承默认</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="资金费设置"
        description="开关资金费、选择实时或固定费率模式。"
        footer={
          <button
            type="button"
            onClick={() => saveConfig("资金费")}
            disabled={saving}
            className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存资金费设置"}
          </button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-600">
            <input
              type="checkbox"
              checked={Boolean(formState.funding?.enabled)}
              onChange={(event) =>
                handleFundingChange("enabled", event.target.checked)
              }
              className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
            />
            启用资金费
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-600">模式</span>
            <select
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm"
              value={formState.funding?.mode ?? "real"}
              onChange={(event) =>
                handleFundingChange("mode", event.target.value)
              }
            >
              <option value="real">实时历史费率</option>
              <option value="fixed">固定费率</option>
            </select>
          </label>
        </div>
        <label className="mt-4 block text-sm">
          <span className="text-neutral-600">固定费率（每 8 小时）</span>
          <input
            type="number"
            step="0.00001"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm shadow-sm"
            value={formState.funding?.fixed_rate ?? 0.0001}
            onChange={(event) =>
              handleFundingChange("fixed_rate", Number(event.target.value || 0))
            }
          />
        </label>
      </SectionCard>
    </div>
  );
}
