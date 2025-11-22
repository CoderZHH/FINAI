# FINAI Calculations / 数学流程说明

This doc explains how every number is produced in the simulator. Formulas are
kept close to Binance perpetual conventions. Where you see “(计算)” logs in the
code, they follow this document.

## 数据来源 & 关键表
- 价格：`market_prices`（Binance futures 最新/mark price，符号统一为 `SYMBOLUSDT`）。
- 风控：`risk_limits`（分级 IMR/MMR/最大杠杆），`sim_settings`（手续费、资金费率、margin 模式等）。
- 账户：`agent_accounts_runtime`（wallet_balance、position_margin、available_cash、starting_equity）。
- 持仓：`trades`（开/平仓、notional、fee、pnl、止盈止损、杠杆）。
- 曲线：`agent_account_timeseries`（折线图数据）。

## 符号规范 / Symbol Rules
- 内部计算与查价：总是使用大写并自动追加 `USDT`（如 `BTC` → `BTCUSDT`）。  
  - Helper：`ensureMarketSymbol(symbol)` 追加后缀；`normalizeSymbol` 用于展示去掉 USDT。
- mark price 获取：`getMarkPrice(symbol)` 先规范符号再查 `market_prices`。

## 账户语义 / Account Semantics
- Wallet (`W`)：纯现金 + 已实现盈亏 + 已计提资金费/手续费，不含未实现盈亏。
- Position margin (`PM`)：占用保证金总额（按分级 IMR 计算）。  
- Available (`AV`)：`W − PM`。  
- Equity (`EQ`)：`W + UPNL`（未实现盈亏）。
- 初始资金：`starting_equity`（建模为 10,000 USDT，创建模型时写入）。

## 开仓流程 / Open Trade
1) 价格与数量  
   - Notional `N = price * |qty|`（不再乘杠杆）。  
2) 分级保证金  
   - 从 `risk_limits` 取该 symbol 的阶梯：按 `N` 找到区间，得 `imr`、`mmr`、`max_leverage`。  
   - Initial margin `IM = N * imr`。  
3) 费用 / Fees  
   - `fee = N * taker_rate(symbol)`（默认 `sim_settings.fees.default.taker`，可被 symbol 覆盖）。  
   - 立即从 `wallet_balance` 扣除 fee。  
4) 账户更新  
   - `position_margin += IM`。  
   - `wallet_balance = wallet_balance_before − fee`。  
   - `available_cash = wallet_balance − position_margin`（执行完写回 runtime 账户）。  
5) 日志  
   - `(计算) decisionExecutor.decision.open` 记录开仓快照：`price, qty, side, notional, IM, fee, wallet`.

## 平仓流程 / Close Trade
- 价格 `p_exit` 来自最新 mark price 或执行价；方向 `dir = +1` (LONG), `-1` (SHORT)。  
- Realized PnL `RPnL = (p_exit − p_entry) * qty * dir`。  
- Exit fee `fee_exit = notional_exit * taker_rate`。  
- Wallet 更新：`wallet_new = wallet_old + RPnL − fee_exit`。  
- 释放保证金：`position_margin -= IM`（原始开仓时锁定的 IM）。  
- 写回 `trades`（关闭该行）、更新 runtime 账户、追加 timeseries。

## 未实现盈亏 / UPNL
- 每次快照由 `mapTradeRowToPosition` 计算：  
  - `mark = getMarkPrice(symbol)`  
  - `UPNL = (mark − entry_price) * qty * dir`  
  - `notional = mark * |qty|`（用于刷新分级显示，但不改历史 IM）。  
- 汇总 `total_unrealized = Σ UPNL`。

## Mark-to-Market 循环 (1s)
触发处：`autoRunner` 市场循环 → `markToMarketAllModels`
1) 刷新价格、更新 BTC 基准。  
2) 对每个模型：  
   - 取最新持仓 → 计算 UPNL。  
   - 汇总账户：  
     - `equity = wallet_balance + total_unrealized`  
     - `available_balance = wallet_balance − position_margin`  
   - 资金费（若开启）：`funding_delta = notional * funding_rate * dir`，直接加到 `wallet_balance` 与已实现 funding。  
   - 强平检查：用 mark price + MMR 判定；如需强平，关闭仓位并走保险/ADL（见后文）。  
   - 记录 `(计算) mtm.account.*` 日志。  
3) 写入 `agent_account_timeseries`：时间戳、equity、wallet、unrealized。

## 风险与强平 / Risk & Liquidation
- 分级 MMR：同 `risk_limits`，区间按最新 notional 匹配。  
- Cross: 检查 `equity <= total_MMR`；Isolated: 按仓位逐个检查 `UPNL + IM − MMR`。  
- 触发强平：  
  1) 计算应亏损 `requiredLoss`。  
  2) 用户保证金覆盖 `coveredByUserMargin`；不足部分向 `insurance_fund` 借 (`coveredByInsurance`)。  
  3) 仍不足则分配 ADL (`adlLoss`)。  
  4) 平仓并更新 wallet/equity/timeseries。

## 资金费 / Funding
- 配置来源：`sim_settings.funding`（enabled, mode=real|fixed, fixed_rate）。  
- 频率：默认 8h；settlement 时逐仓 `funding_delta = notional * rate * dir`。  
- 记账：加到 `wallet_balance` 与 `realized_pnl_funding`，不影响 UPNL。

## 手续费 / Fees
- 来源：`sim_settings.fees.default` + 可选 symbol 覆盖。  
- 开仓扣一次；平仓再扣一次；均直接减 `wallet_balance`。  
- 展示：已实现部分计入 wallet，未在 UPNL 中重复。

## 数据流示意 / Flow
1) Price ingest → `market_prices`  
2) Scheduler → LLM 决策 → `applyDecisionSet` → trades + runtime 更新  
3) MTM 循环 → UPNL/风险/资金费 → runtime + timeseries  
4) UI → 折线图读 `agent_account_timeseries`；卡片读 runtime + positions。

## Logging 规范
- 计算链路统一前缀 `(计算)`，核心节点：  
  - `decisionExecutor.decision.before/open/close`  
  - `positions.mapTradeRowToPosition`  
  - `risk.summarizeMarginAccount`  
  - `mtm.account.start/afterRisk/end`、`mtm.liquidation.*`  
  - `appendAccountTimeseries` 失败会 `logger.error`（包含 model_id）。  
- 建议筛选关键字段：`model_id, symbol, notional, imr/mmr, wallet_balance, equity, available_balance, total_unrealized, funding_delta, fee`.

## 快速公式卡 / Quick Formulas
- Notional: `N = price * |qty|`
- IM: `IM = N * imr_tier`；MM: `MM = N * mmr_tier`
- UPNL: `(mark − entry) * qty * dir`
- RPnL: `(exit − entry) * qty * dir − fee_exit`
- Wallet: `W = W_prev − fee_open + RPnL − fee_exit + funding_realized`
- Equity: `EQ = W + ΣUPNL`
- Available: `AV = W − position_margin`

## 注意事项 / Caveats
- 价格、IMR/MMR 必须用标准化符号（自动补 USDT）；展示再去后缀。  
- Margin locks 调整 `position_margin`，不直接加减钱包；钱包只反映现金与已实现项。  
- 若 UI 显示异常，先对照 runtime 表字段与 `(计算)` 日志，再查 timeseries 是否写入。
