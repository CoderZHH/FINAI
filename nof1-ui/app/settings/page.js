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
  const { data: configData, mutate } = useSWR("/api/sim-config", fetcher);
  const { data: symbolsData } = useSWR("/api/symbols", fetcher);
  const [formState, setFormState] = useState(null);
  const [savingSection, setSavingSection] = useState(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (configData) {
      setFormState(clone(configData));
    }
  }, [configData]);

  useEffect(() => {
    if (formState && !Array.isArray(formState.risk_limits)) {
      setFormState((prev) => ({ ...prev, risk_limits: [] }));
    }
  }, [formState]);

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

  const saveConfig = async (label, section) => {
    if (!formState) return;
    const payloadToSend = clone(formState);
    if (Array.isArray(payloadToSend.risk_limits)) {
      payloadToSend.risk_limits = payloadToSend.risk_limits
        .map((row) => ({
          ...row,
          symbol: String(row.symbol ?? "").trim().toUpperCase(),
        }))
        .filter((row) => row.symbol);
    }
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
      mutate(responseBody, false);
      setStatus(`${label} 设置已保存`);
    } catch (error) {
      setStatus(error.message || "保存失败");
    } finally {
      setSavingSection(null);
      setTimeout(() => setStatus(""), 4000);
    }
  };

  const handleRiskChange = (index, field, value) => {
    setFormState((prev) => {
      const next = clone(prev ?? {});
      next.risk_limits = Array.isArray(next.risk_limits) ? next.risk_limits : [];
      next.risk_limits[index] = {
        ...(next.risk_limits[index] ?? {
          symbol: "",
          tier: 1,
          notional_cap: 0,
          max_leverage: 1,
          imr: 0,
          mmr: 0,
        }),
        [field]: value,
      };
      return next;
    });
  };

  const addRiskRow = () => {
    setFormState((prev) => {
      const next = clone(prev ?? {});
      next.risk_limits = Array.isArray(next.risk_limits) ? next.risk_limits : [];
      next.risk_limits.push({
        symbol: "",
        tier: (next.risk_limits.at(-1)?.tier ?? 0) + 1,
        notional_cap: 0,
        max_leverage: 1,
        imr: 0,
        mmr: 0,
      });
      return next;
    });
  };

  const removeRiskRow = (index) => {
    setFormState((prev) => {
      const next = clone(prev ?? {});
      next.risk_limits = (next.risk_limits ?? []).filter((_, i) => i !== index);
      return next;
    });
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
            onClick={() => saveConfig("手续费", "fees")}
            disabled={savingSection === "fees"}
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
                <th className="px-4 py-2">
                  <span className="inline-flex items-center gap-1">
                    Symbol <Hint text="交易对，大写，例如 BTCUSDT。" />
                  </span>
                </th>
                <th className="px-4 py-2">
                  <span className="inline-flex items-center gap-1">
                    Maker <Hint text="该交易对的挂单手续费覆盖值。" />
                  </span>
                </th>
                <th className="px-4 py-2">
                  <span className="inline-flex items-center gap-1">
                    Taker <Hint text="该交易对的吃单手续费覆盖值。" />
                  </span>
                </th>
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
        title="风控分层"
        description="为每个交易对配置分级名义上限、最大杠杆与 IMR/MMR。"
        footer={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={addRiskRow}
              className="rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50"
            >
              新增档位
            </button>
            <button
              type="button"
              onClick={() => saveConfig("风控分层", "risk")}
              disabled={savingSection === "risk"}
              className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-700 disabled:opacity-50"
            >
              {savingSection === "risk" ? "保存中..." : "保存分层设置"}
            </button>
          </div>
        }
      >
        <div className="overflow-auto rounded-xl border border-neutral-200">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-500">
              <tr>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    Symbol <Hint text="交易对，大写，例如 BTCUSDT。" />
                  </span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    Tier <Hint text="分层编号，1 为最低阶，越大代表更高名义区间。" />
                  </span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    Notional Cap <Hint text="该层最大名义（USDT），超过则落入下一层。" />
                  </span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    Max Lev <Hint text="该层允许的最大杠杆。" />
                  </span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    IMR <Hint text="初始保证金率，开仓所需（占名义比例）。" />
                  </span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    MMR <Hint text="维持保证金率，低于则触发强平流程。" />
                  </span>
                </th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(formState.risk_limits ?? []).map((row, index) => (
                <tr key={`${row.symbol}-${row.tier}-${index}`} className="border-t border-neutral-200">
                  <td className="px-3 py-2">
                    <input
                      className="w-24 rounded-lg border border-neutral-300 px-2 py-1 text-sm uppercase shadow-sm"
                      value={row.symbol ?? ""}
                      onChange={(event) =>
                        handleRiskChange(index, "symbol", event.target.value.toUpperCase())
                      }
                      placeholder="BTCUSDT"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className="w-16 rounded-lg border border-neutral-300 px-2 py-1 text-sm shadow-sm"
                      value={row.tier ?? 1}
                      min={1}
                      onChange={(event) =>
                        handleRiskChange(index, "tier", Number(event.target.value || 1))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className="w-28 rounded-lg border border-neutral-300 px-2 py-1 text-sm shadow-sm"
                      value={row.notional_cap ?? 0}
                      onChange={(event) =>
                        handleRiskChange(index, "notional_cap", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-sm shadow-sm"
                      value={row.max_leverage ?? 1}
                      onChange={(event) =>
                        handleRiskChange(index, "max_leverage", Number(event.target.value || 1))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.0001"
                      className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-sm shadow-sm"
                      value={row.imr ?? 0}
                      onChange={(event) =>
                        handleRiskChange(index, "imr", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.0001"
                      className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-sm shadow-sm"
                      value={row.mmr ?? 0}
                      onChange={(event) =>
                        handleRiskChange(index, "mmr", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeRiskRow(index)}
                      className="text-xs font-semibold text-rose-600 hover:underline"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {(!formState.risk_limits || formState.risk_limits.length === 0) && (
                <tr className="border-t border-neutral-200">
                  <td colSpan={7} className="px-3 py-4 text-center text-xs text-neutral-500">
                    暂无档位，点击“新增档位”添加。
                  </td>
                </tr>
              )}
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
            onClick={() => saveConfig("资金费", "funding")}
            disabled={savingSection === "funding"}
            className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-700 disabled:opacity-50"
          >
            {savingSection === "funding" ? "保存中..." : "保存资金费设置"}
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
            <span className="inline-flex items-center gap-2">
              启用资金费
              <Hint text="关闭后不计算资金费率，实时/固定设置将被忽略。" />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="inline-flex items-center gap-2 text-neutral-600">
              模式
              <Hint text="实时：使用导入的市场资金费率；固定：使用自定义费率（每 8 小时）。" />
            </span>
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
          <span className="inline-flex items-center gap-2 text-neutral-600">
            固定费率（每 8 小时）
            <Hint text="仅在模式为固定时生效，按 8 小时结算周期应用。" />
          </span>
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
