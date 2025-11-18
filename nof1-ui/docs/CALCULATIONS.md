# FINAI Calculation Reference

This document catalogs every place in the repository that performs
non‑trivial numeric calculations. Use it as a guide when auditing logic or
adding new metrics.

---

## 1. Trading Engine & Risk Management

| Location | What is calculated | Notes |
| --- | --- | --- |
| `lib/decisionExecutor.js` | `applyDecisionSet` computes notional (`price * quantity * leverage`), required margin (`notional / leverage`), available balance checks, and wallet/equity snapshots. | Wallet balance is treated as total cash; initial margins are tracked separately via `summarizeMarginAccount`. |
| `lib/decisionExecutor.js` | `closeOpenTrades` evaluates realized PnL for each position (`(exitPrice - entryPrice) * qty * leverage * direction`), holding time, and releases historical margin. | Returned `releasedMargin` is used when recalculating available balances after closing a trade. |
| `lib/decisionExecutor.js` | `summarizeMarginAccount` aggregates `totalUnrealized`, `totalInitialMargin`, wallet balance, equity (`wallet + unrealized`), and available balance (`wallet - IM`). | Used by both execution flow and mark-to-market snapshots. |

## 2. Automated Exit Enforcement & Mark-To-Market

| Location | What is calculated | Notes |
| --- | --- | --- |
| `lib/dataRepository.js` | `enforceExitTargets` (recently added) walks every open position, compares `current_price` with `take_profit` / `stop_loss`, and programmatically closes trades via `closeOpenTrades`. | Handles both long & short logic and accumulates realized deltas for the wallet. |
| `lib/dataRepository.js` | `markToMarketAllModels` fetches all tradable accounts, optionally flushes forced exits (`enforceExitTargets`), recomputes wallet + equity via `summarizeMarginAccount`, and appends `agent_account_timeseries` records. | This is triggered by `autoRunner` every market loop. |
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
   - Unrealized/realized PnL omit funding payments, maker/taker fees, and
     liquidation costs, overstating strategy performance.
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
   - Funding rates are imported but never applied to account balances. Fix #3
     must incorporate these cashflows.

Each bullet should be backed by code changes plus regression tests before the
simulator can be treated as a faithful Binance perpetual replica.
