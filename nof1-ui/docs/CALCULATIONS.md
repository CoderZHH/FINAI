# FINAI Calculation Reference

This document catalogs every place in the repository that performs
non‑trivial numeric calculations. Use it as a guide when auditing logic or
adding new metrics.

---

## 1. Trading Engine & Risk Management

| Location | What is calculated | Notes |
| --- | --- | --- |
| `lib/decisionExecutor.js` | `applyDecisionSet` computes notional (`|price * quantity|`), required margin (`notional / leverage`), applies taker fees, and runs per-symbol margin locks (isolated vs cross) before updating wallet/equity snapshots. | Wallet balance is treated as total cash; initial margins and per-symbol buckets come from `summarizeMarginAccount`. |
| `lib/decisionExecutor.js` | `closeOpenTrades` evaluates realized PnL for each position (`(exitPrice - entryPrice) * qty * leverage * direction`), holding time, releases historical margin, and accrues taker fees. | Returned fees are deducted from wallet balance inside execution / mark-to-market flows. |
| `lib/dataRepository.js` | `summarizeMarginAccount` aggregates `totalUnrealized`, `totalInitialMargin`, wallet balance, equity (`wallet + unrealized`), available balance (`wallet - IM`), and per-symbol isolated margin buckets. | Execution flows consume the per-symbol map to enforce isolated-vs-cross margin checks. |

## 2. Automated Exit Enforcement & Mark-To-Market

| Location | What is calculated | Notes |
| --- | --- | --- |
| `lib/dataRepository.js` | `enforceExitTargets` (recently added) walks every open position, compares `current_price` with `take_profit` / `stop_loss`, and programmatically closes trades via `closeOpenTrades` (fees included). | Handles both long & short logic and accumulates realized deltas for the wallet. |
| `lib/dataRepository.js` | `markToMarketAllModels` fetches all tradable accounts, optionally flushes forced exits (`enforceExitTargets`), settles funding cashflows (based on config), recomputes wallet + equity via `summarizeMarginAccount`, and appends `agent_account_timeseries` records. | Driven by `autoRunner` market loop; funding metadata (`last_settlement_ts`) is stored per account. |
| `lib/dataRepository.js` | `getPositionsSnapshot` and `getOpenPositionsGrouped` calculate per-model totals such as unrealized PnL and notional. | `mapTradeRowToPosition` also computes leverage-normalized notional, current price, and unrealized PnL while normalizing for short positions. |

## 3. Historical Market Import

| Location | What is calculated | Notes |
| --- | --- | --- |
| `scripts/get_market.js` | Collects Binance futures data and computes EMA (1m / 4h), MACD, RSI, ATR, SMA values, funding rate histories, and open interest time series. | The script aligns time windows, smooths with `technicalindicators`, and writes both the latest snapshot and long-form history into Postgres. |

## 4. Prompt Builder Metrics

| Location | What is calculated | Notes |
| --- | --- | --- |
| `lib/promptBuilder.js` | `formatMarketSection` assembles per-symbol metrics (current price, EMA, MACD, RSI, open interest, funding rate) alongside compact min/HTF series. | Helper utilities (`formatNumber`, `formatSeries`, `takeLast`) control rounding and output length. |
| `lib/promptBuilder.js` | `buildPositionStateText` derives account snapshots, unrealized PnL, Sharpe ratios, wins, margin usage, and per-position leverage & exit plan details for the LLM prompt. | Inputs come from `getRuntimeAccount`, `getOpenPositions`, and previously described calculations. |

## 5. UI Data Transformations

| Location | What is calculated | Notes |
| --- | --- | --- |
| `components/ChartPanel.js` | `deriveChartData` buckets timestamps (currently rounded to 1 s), merges per-model equity into a single series, and converts dollar vs. percent view modes. | Also computes legend metadata and per-model summary cards (PnL = latest − starting). |
| `components/ChartInner.js` | ECharts configuration calculates global min/max to auto-scale the Y axis, sets per-series colours (hard coded BTC/LLM palette), and renders custom end labels (`buildEndLabelConfig`) with model icons + live equity values. | `getSeriesColor` maps `display_icon` → RGB; crosshair hover logic finds nearest data point by comparing pointer value with each series. |
| `components/RightFeed.js` | Formats positions (direction, leverage, size, PnL) and calculates aggregates like “未实现盈亏” and “账户净值” for display. | Relies on backend-provided `latest_equity`, `available_cash`, `total_unrealized_pnl`. |

## 6. Ancillary Calculations

| Location | Calculations | Notes |
| --- | --- | --- |
| `lib/decisionEngine.js` | Timing metrics for decision cycles (latency logging) and optional risk summarization before calling the LLM. | No financial math, but establishes the cadence for `applyDecisionSet`. |
| `lib/autoRunner.js` | Feeds mark-to-market cadence and logs metrics such as symbols updated per loop. | The actual maths reside in `markToMarketAllModels`. |
| `scripts/reset-db.js` | Defines numeric precision and constraints for tables such as `trades` (ensures columns exist for stop loss/take profit). | Important when checking calculations that depend on schema fields. |

---

### How to use this reference
1. **Risk / Equity bugs:** start at §1 and §2 (trading engine & mark-to-market).
2. **Indicator / prompt issues:** inspect §3 & §4 calculations for rounding or data completeness.
3. **UI discrepancies:** trace the numbers rendered in §5 back through the backend snapshot(s).
4. **Schema changes:** ensure any new calculations are reflected both in prompt builder output and chart snapshots—see §6 for table definitions.

If you add a new metric, update this document with the module, formulas, and data flow so future audits can follow the same map.

---

## 7. Known Gaps vs. Binance Perpetual Math (Must Fix)

The following discrepancies are currently unresolved. Treat all simulator
metrics as non-Binance-compliant until these are fixed in code.

1. **Notional should not scale with leverage**  
   - Current logic uses `price * quantity * leverage`. True Binance notional is
     simply `price * quantity`; leverage only affects required margin.
2. **Initial/Maintenance margin uses `1 / leverage`**  
   - Binance relies on tiered IMR/MMR tables per symbol/size. Without those,
     positions that would be rejected or instantly liquidated appear viable.
3. **PnL ignores funding and fees**  
   - Maker/taker fees now reduce wallet balance in execution and forced exits,
     but funding still needs to affect unrealized/realized splits more
     precisely (current implementation applies a simple wallet delta every 8 h).
4. **Wallet / equity / available balance semantics mismatch**  
   - Wallet should include realized PnL + funding/fees but exclude unrealized
     PnL. Available balance should be `wallet − positionMargin`. Per-position
     IM/MM locks and funding adjustments are not modeled yet.
5. **Mark-price liquidation logic missing**  
   - Forced exits only occur via stop-loss/stop-profit. Binance requires
     mark-price-based liquidation against IMR/MMR plus ADL handling.
6. **Mark price vs. last price**  
   - UPnL and equity use the sampled last trade price. Binance risk uses mark
     price, so fast spikes can cause real margin calls that our simulator never
     triggers.
7. **Funding data unused**  
   - Funding rates are imported and a configurable settlement (real vs fixed)
     now adjusts wallet balances, but this is still a simplified model (no ADL,
     no mark-price interplay). The final Binance behaviour is not yet matched.

Each bullet should be backed by code changes plus regression tests before the
simulator can be treated as a faithful Binance perpetual replica.

---

## 8. Configuration Surfaces (Manual vs. UI)

Some exchange behaviours require user-tunable parameters. The table below
describes what must be manually configured today, where it should live in the
UI, and how the engine should consume it.

### 8.1 Margin Mode (per symbol)

```jsonc
{
  "symbols": {
    "BTCUSDT": { "margin_mode": "isolated" },
    "ETHUSDT": { "margin_mode": "cross" }
  }
}
```

- **Configuration surface**: global simulator Settings page（“市场 / 风险”卡片）。模型管理界面只读。
- **Model management**: read-only badge; editing belongs to the Settings view
  because one symbol’s margin mode affects all strategies.
- **Runtime constraint**: `/api/sim-config` 拒绝对仍有持仓或挂单的 symbol 切换模式（通过 `hasOpenPositionsForSymbol` 判断）。
- **Risk logic**: liquidation/margin formulas branch on
  `cfg.symbols[symbol].margin_mode`. Isolated uses per-position margin buckets;
  cross uses wallet balance as a shared pool.

### 8.2 Fee Rates (maker / taker)

```jsonc
{
  "fees": {
    "default": { "maker": 0.0002, "taker": 0.0004 },
    "BTCUSDT": { "maker": 0.00018, "taker": 0.00036 }
  }
}
```

- **Configuration surface**: Settings 页面 “手续费” 卡片显示默认值与特定交易对的覆盖值。
- **Fill handling**: `notional = fill_price * |qty|`, fee = `notional *
  getFeeRate(symbol, liquidity)`. Deduct from `wallet_balance` immediately and
  book under `realized_pnl_fee`.  
  - Maker/taker choice should come from execution semantics (e.g., IOC vs.
    resting order fills).
- **Model UI**: Optional display of the active tier, but editing remains a
  Settings responsibility.

### 8.3 Funding Controls

```jsonc
{
  "funding": {
    "enabled": true,
    "mode": "real",      // or "fixed"
    "fixed_rate": 0.0001 // only used when mode = "fixed"
  }
}
```

- **Configuration surface**: Settings → “资金费” 卡片。  
  - `enabled=false` → skip funding entirely.  
  - `mode="real"` → use imported Binance funding series.  
  - `mode="fixed"` → override with `fixed_rate` for stress scenarios.
- **Scheduler**: every 8 h (or configurable), call `applyFunding(position,
  rate)` for every open position.  
  - Rate source = market history if `mode="real"`, else the fixed rate.
- **Accounting**: funding adjustments hit `wallet_balance` and
  `realized_pnl_funding`; they do **not** change unrealized PnL.

### 8.4 Unified Config Loader

Load settings once (e.g., `const cfg = loadConfig("sim_config.json");`) and
inject wherever needed:

- Margin logic reads `cfg.symbols[symbol].margin_mode`.
- Order fills query `cfg.fees`.
- Funding scheduler inspects `cfg.funding`.

### 8.5 What not to hard-code

The following inputs must come from Binance data feeds, not from manual config:

- Tiered IMR/MMR schedules and maximum leverage per tier.
- Mark price, last price, funding rate values.
- Tick size, lot size, risk limits/notional caps.

Those belong in the market-data ingestion layer or exchange emulator—not in
Settings or model management.

---

## 9. Insurance Fund & Liquidation Loss Handling (2025‑03 Update)

| Location | What is calculated | Notes |
| --- | --- | --- |
| `scripts/reset-db.js` | Seeds a global `insurance_fund` table (id = 1) with an initial balance of 100 000 USDT whenever the schema is rebuilt. | Table is truncated alongside other runtime tables to keep test runs deterministic. |
| `lib/insuranceFund.js` | Exposes `getInsuranceFundBalance`, `creditInsuranceFund`, and `debitInsuranceFund` helpers. Debits saturate at zero and return `{ debited, remainingBalance }`. | All liquidation logic goes through these helpers—no other module touches the table directly. |
| `lib/liquidationEngine.js` | `runLiquidationCheckForAccount` now reports `requiredLoss`, `coveredByUserMargin`, `coveredByInsurance`, and `adlLoss`. It consumes the insurance fund to cover losses beyond user margin and only flags ADL when both user cash and fund are exhausted. | Isolated positions limit the user cap to per-position margin; cross mode uses `wallet_balance + position_margin`. |
| `lib/adlEngine.js` | `distributeAdlLoss(adlLoss)` ranks profitable accounts by a Binance-style score (profit ratio × leverage proxy) and deducts ADL losses from the highest tier first. Updates `wallet_balance`, `latest_equity`, and `realized_pnl_price`. | Returns `{ distributed, affected[] }` for logging/monitoring. |
| `lib/dataRepository.js` | `markToMarketAllModels` closes liquidated positions, adjusts wallet/margin, and when `details.adlLoss > 0` calls `distributeAdlLoss`, logging the distribution outcome. | Ensures wallet/equity snapshots incorporate forced exits, insurance coverage, and ADL deductions before persisting runtime rows + timeseries. |
| `lib/decisionExecutor.js` | `applyDecisionSet` enforces consistent wallet semantics (`latest_equity = wallet + unrealized`, `available_cash = wallet − position_margin`) so execution and mark-to-market share the same base values after insurance/ADL flows. | Prevents drift between intracycle executions and periodic mark-to-market snapshots. |

### 9.1 Loss Flow Overview

1. **Forced exit** (`markToMarketAllModels` → `runLiquidationCheckForAccount`): compute total liquidation loss and the portion user margin can cover.
2. **Insurance coverage**: `debitInsuranceFund` absorbs remaining loss up to the fund balance, producing `coveredByInsurance`.
3. **ADL spillover**: residual `adlLoss` triggers `distributeAdlLoss`, which deducts from profitable accounts in descending score order.
4. **Persistence**: liquidated accounts update wallet/equity/margin; ADL-affected accounts are updated via `distributeAdlLoss`; timeseries snapshots reflect the post-loss state.
