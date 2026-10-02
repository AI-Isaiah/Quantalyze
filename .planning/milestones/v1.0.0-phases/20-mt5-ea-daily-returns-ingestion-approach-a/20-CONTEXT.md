# Phase 20: MT5 EA daily-returns ingestion (Approach A) - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning
**Mode:** Smart-discuss, grounded in the autoplan Phase 3 Eng test strategy (`20-TEST-STRATEGY.md`) — grey areas were pre-resolved by that spec (Eng findings E1–E9, A1), so accept/override gating was skipped per the autonomous directive.

<domain>
## Phase Boundary

Deliver the MetaTrader 5 (MT5) Expert Advisor that exports a strategy's
daily-return series as a `date,daily_return` CSV conforming to the **existing**
`daily_returns` CSV ingestion contract — so MT5 strategies feed the same
CSV → analytics → factsheet pipeline that Phase 19.1 shipped, with **no new
ingestion code**.

In scope:
- The MQL5 EA source under `tools/mt5/*.mq5` (net-new) that computes a daily
  total-equity return series and writes the CSV.
- A test harness that pins the EA's **output contract** with checked-in golden
  CSV fixtures asserted through the existing Python suite (T1–T13).
- A read-only **security static-check** on the EA source (T16).

Explicitly NOT automatable here (gated on a one-time manual demo-account
reconcile): the MQL5 balance-deal classification (E5) and restart-state (A1).
The daily-return math runs in MQL5 under Wine and has **no CI harness** — the
strategy is to pin the contract + test the ingestion/KPI interpretation in CI,
and validate the EA itself by hand on a demo account (T14/T15).

</domain>

<decisions>
## Implementation Decisions

### Output contract & format (E1, E7)
- CSV schema: `date,daily_return`; fractional returns (0.0123 = 1.23%); no
  `currency` column required.
- Blank/absent currency column validates OK (T8). A `currency=EUR` (non-USD)
  file HARD-FAILS — USD-only is deliberate, documented (T9).
- Auto-÷100 percent-form detection must NOT misfire on a realistic fractional
  series — `info_flags == []` for fractional input (T7).

### Flow vs return classification (E4, E5)
- Deposits/withdrawals are NOT returns: a deposit-day shows the trading return,
  never a cash spike (T2 — the #1 test); a withdrawal-day return excludes the
  outflow (T3).
- Swap/commission are costs INCLUDED in the return, not netted as flows (T10).
- CREDIT/CHARGE/CORRECTION balance deals are classified per the documented
  excluded-vs-included table (T11).
- Intraday-flow (deposit at 09:00 then trades) follows the chosen convention;
  day flagged if approximate (T4 — taste).

### Equity basis & calendar (E2, E3, E8)
- Daily return tracks total equity INCLUDING floating PnL of overnight open
  positions, not balance (T6).
- **Calendar = DENSE calendar-daily (one row per calendar day) — REVISED
  2026-06-14 per user correction ("the exchanges trade on all days of the year");
  this SUPERSEDES the interim "sparse @252" revision.** The venues are crypto
  (OKX/Bybit, 24/7/365), so every calendar day is a real trading day with a real
  equity-based return — there are NO artificial weekend zeros. (The red-team's C1
  −16.9% measurement injected synthetic weekend zeros, which do not occur for a
  365-day market; that premise was false for this product.) The EA emits one row
  per calendar day; gaps just mean fewer rows (validator requires
  strictly-increasing unique dates — no densification, no rejection).
- **Annualization = the EXISTING `compute_all_metrics` path UNCHANGED (quantstats
  `periods=252`).** Binding comparability constraint: EVERY displayed strategy KPI
  in the product is computed by `compute_all_metrics` with the 252 default — the
  crypto trades-path (`analytics_runner.py:1584`) AND the CSV/MT5 path (`:2027`).
  MT5 must use the identical path so Sharpe/vol/CAGR are apples-to-apples on the
  ranking page. Plumbing `periods=365` for MT5 alone would inflate its Sharpe
  ~×1.20 vs equivalent crypto strategies → ranking distortion. NO production
  annualization change. T1/T5 oracle KPIs are computed on the DENSE series at the
  live pipeline's 252 (assert what `compute_all_metrics` actually produces; for a
  small/steady fixture the expected Sharpe/vol stays hand-checkable).
- **Deferred observation (NOT Phase 20 scope):** real internal inconsistency —
  `equity_reconstruction.compute_sharpe` uses `periods=365` (NEW-C01-15, documented
  correct for calendar-daily crypto) while `compute_all_metrics` (headline KPIs)
  uses 252; for the same crypto strategy these differ ×1.20. Reconciling
  product-wide would re-baseline every displayed KPI — a separate decision,
  surfaced for the user, not fixed here.
- DST boundary day yields exactly one row, correct label, no dup/skip (T13).

### Re-upload & restart semantics (E9, A1)
- Re-upload is full-replace: overlapping/partial re-upload replaces all rows,
  no stale rows, history not truncated (T12).
- Restart-state: after a terminal kill+relaunch, the next day's return uses the
  persisted `prior_close_equity`, not a fresh/zero base (T15).

### Security (CI)
- EA source is read-only: a CI static check greps `tools/mt5/*.mq5` and FAILS on
  any order/trade mutation API
  (`OrderSend|CTrade|PositionClose|PositionModify|OrderModify|OrderDelete|trade\.`) (T16).

### Validation gates (must-pass before any KPI is page-visible)
- T2 (deposit-day), T5 (gap), T14 (manual demo-account reconcile). Without these
  three, a plausible-but-wrong Sharpe can reach an allocator-facing page.

### Claude's Discretion
- Exact fixture file naming/layout and Python test-module organization.
- The dense-calendar zero-fill vs reject choice for T5 (within the test
  strategy's stated options).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (verified present, 2026-06-14)
- `analytics-service/services/csv_validator.py` → `validate_csv(fmt="daily_returns")`
  — the daily-returns format validator the EA output must satisfy.
- `analytics-service/services/ingestion/csv_adapter.py` + `ingestion/adapter.py`
  — existing CSV ingestion adapters.
- `analytics-service/services/analytics_runner.py` → `run_csv_strategy_analytics`
  — CSV → analytics entry point.
- `analytics-service/services/metrics.py` → `compute_all_metrics`
  — KPI computation (Sharpe / vol / CAGR / maxDD).
- `csv_daily_returns` table — persistence target (analytics_runner, job_worker,
  `src/app/api/strategies/csv-finalize/route.ts`).

### Established Patterns
- Golden-fixture + KPI-assertion tests already exist and set the pattern:
  `analytics-service/tests/test_csv_validator*.py`, `test_csv_adapter.py`,
  `test_metrics.py`, `test_metrics_parity.py`. New T1–T13 fixtures follow these.
- pytest with `--cov-fail-under=80` gate (per CLAUDE.md).

### Integration Points
- New `tools/mt5/*.mq5` EA source (net-new directory).
- New golden CSV fixtures + Python ingestion/KPI tests in `analytics-service/tests/`.
- New CI static-check step scanning `tools/mt5/*.mq5` (security).

</code_context>

<specifics>
## Specific Ideas

The authoritative spec is
`.planning/phases/20-mt5-ea-daily-returns-ingestion-approach-a/20-TEST-STRATEGY.md`
(autoplan Phase 3 Eng, 2026-06-14): 16 tests (T1–T16) mapped 1:1 to Eng findings
E1–E9 + A1. Approach A reuses the existing CSV pipeline rather than building a
new ingestion path: the EA emits the format `validate_csv(fmt="daily_returns")`
already accepts, so the only new code is the EA, the golden fixtures + tests, and
the security static-check.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. T14/T15 (manual demo-account
reconcile + restart-state) are EA-side acceptance steps the user runs on a demo
account; they cannot be automated in CI and gate the first live KPI, not this
phase's CI completion.

</deferred>
