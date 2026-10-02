---
phase: 20-mt5-ea-daily-returns-ingestion-approach-a
plan: 02
subsystem: tools

# Dependency graph
requires:
  - phase: 20-mt5-ea-daily-returns-ingestion-approach-a (plan 01)
    provides: the daily_returns CSV output contract (date,daily_return; ISO date; fractional; MAX_INGEST_ROWS=5000) pinned by golden fixtures
provides:
  - tools/mt5/QuantalyzeDailyReturns.mq5 — read-only MQL5 EA exporting a flow-adjusted, equity-based, dense calendar-daily daily_return CSV
  - tools/mt5/README.md — USD-only/deploy/run docs + the concrete numeric T14 reconcile worksheet + T15 restart gates
affects:
  - "20-03 (read-only static-check CI step over tools/mt5/*.mq5 — T16)"
  - "MT5 strategy onboarding (the client-side half of Phase 20)"

# Tech tracking
tech-stack:
  added: []  # NO new packages anywhere (verified — Phase 20 installs zero deps)
  patterns:
    - "MQL5 read-only recorder EA: AccountInfoDouble(ACCOUNT_EQUITY) + HistorySelect/HistoryDeal* + FileOpen/FileWrite/FileMove only; zero trade-mutation API"
    - "Atomic file-state persistence: temp-file + FileMove rename + sentinel/checksum read-validation + fail-loud on corrupt"
    - "Comments deliberately avoid spelling forbidden-token names verbatim so a naive CI grep over the raw source has no comment false-positives"

key-files:
  created:
    - tools/mt5/QuantalyzeDailyReturns.mq5
    - tools/mt5/README.md
  modified: []

key-decisions:
  - "DEAL_TYPE_CORRECTION default = COST (included in return), configurable via CorrectionIsFlow input; rationale: corrections usually adjust trading P&L, erasing a real gain/loss is the worse error (H6)"
  - "Multi-day outage span: snapshot current equity as the close for each elapsed day (the EA cannot reconstruct intraday history for missed days); large resulting moves are flagged via the audit sidecar — never zero-filled"
  - "Documentation comments avoid the literal forbidden tokens (OrderSend/CTrade/.Buy(/etc.) so the Plan 20-03 raw-source CI grep stays clean without needing comment-stripping"

patterns-established:
  - "Read-only money-path EA: only read APIs + file I/O, validated by a raw-source CI grep that scans even comments"
  - "Numeric manual-acceptance worksheet (expected-vs-actual table + ±ε thresholds + per-deal-type tick-table) as the binding gate for logic that has no CI harness"

requirements-completed: [T2, T3, T4, T5, T6, T10, T11, T13]

# Metrics
duration: ~18min
completed: 2026-06-14
---

# Phase 20 Plan 02: MT5 daily-equity-return Expert Advisor Summary

**Read-only MQL5 EA that exports a flow-adjusted, equity-based, dense calendar-daily `date,daily_return` CSV (day-1=0.0 inception, atomic restart state, intraday-flow flag, documented broker-dependent CORRECTION default) plus a README with a concrete numeric T14/T15 acceptance worksheet — the autonomous half is done; T14/T15 remain HUMAN-PENDING.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 2 of 3 autonomous tasks complete; Task 3 is a blocking-human checkpoint (HUMAN-PENDING, cannot run here)
- **Files created:** 2 (`tools/mt5/QuantalyzeDailyReturns.mq5` 667 lines, `tools/mt5/README.md` 276 lines)

## Accomplishments

- **Read-only EA (T2/T3/T5/T6/T10/T11/T13):** reads total equity via `AccountInfoDouble(ACCOUNT_EQUITY)` (incl floating PnL; never `ACCOUNT_BALANCE`); flow-adjusts `daily_return = (equity_close − net_external_flows − prior_close_equity) / prior_close_equity`, excluding BALANCE/CREDIT/CHARGE/BONUS as flows while leaving commission/interest/swap as costs inside the return.
- **Dense calendar-daily (T5):** one real row per calendar day on a 24/7/365 venue, no zero-fill; annualization unchanged downstream at quantstats `periods=252`. (The interim sparse-skip revision was NOT introduced — the venues trade every day.)
- **Day-1 inception (M2):** `daily_return = 0.0` on the first row; never divide-by-zero / ±Inf.
- **Day-rollover via `TimeTradeServer()` date component (T13):** exactly one row per calendar date across a DST boundary.
- **Atomic restart state (A1/M5):** `prior_close_equity` + last server-date persisted via temp-file + `FileMove` rename, with a sentinel header + checksum; corrupt/partial reads FAIL LOUD (disable the timer, refuse to emit); first run seeds from current equity; single-instance lock in `OnInit`.
- **Intraday-flow flag (M3):** flags any day where `|net_external_flows| / prior_close_equity > 0.20` to the audit sidecar + Print log.
- **CORRECTION default (H6):** documented broker-dependent default = COST (configurable), every CORRECTION deal logged to the audit sidecar for T14 confirmation.
- **README:** USD-only rationale, single-instance deploy/compile/attach, CSV+state+audit locations, MAX_INGEST_ROWS=5000 cap (~13.7yr, whole-file hard-reject), CORRECTION caveat, and the concrete numeric **T14** worksheet (day-by-day deposit→overnight→withdrawal→kill+relaunch+sleep with hand-computed expected `daily_return`, expected-vs-actual ±ε table, per-deal-type tick-table, BONUS/CREDIT double-count check, Modified-Dietz intraday note, DST one-row check, calendar-density + date-string eyeballs) + the **T15** kill-mid-write/first-run/restart gates.

## Read-only APIs used (for the upcoming 20-03 static-check sanity-check)

The EA uses ONLY these (no trade-mutation token, no MQL4 name, even in comments):

- **Equity:** `AccountInfoDouble(ACCOUNT_EQUITY)`
- **Deal history:** `HistorySelect`, `HistoryDealsTotal`, `HistoryDealGetTicket`, `HistoryDealGetInteger(..., DEAL_TYPE)`, `HistoryDealGetDouble(..., DEAL_PROFIT)`
- **Time / rollover:** `TimeTradeServer`, `TimeToStruct`, `StructToTime`, `TimeToString`
- **File I/O:** `FileOpen` (FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI / FILE_TXT|FILE_ANSI), `FileWrite`, `FileWriteString`, `FileReadString`, `FileSeek`, `FileClose`, `FileMove`, `FileIsExist`, `FileIsEnding`
- **In-terminal single-instance lock (transient, NOT durable state):** `GlobalVariableCheck/Set/Del`
- **Timer / lifecycle:** `EventSetTimer`, `EventKillTimer`, `OnInit`, `OnTimer`, `OnDeinit`, `OnTick` (empty no-op)
- **Helpers:** `StringReplace`, `StringLen`, `StringGetCharacter`, `DoubleToString`, `StringToDouble`, `StringToInteger`, `MathAbs`, `Print`

Verified clean against the plan grep: zero matches for `OrderSend|OrderSendAsync|CTrade|.Buy(|.Sell(|.PositionOpen(|.PositionClose(|PositionModify|OrderModify|OrderDelete|trade.` and zero MQL4 names (`AccountEquity(|AccountBalance(|OrderSelect(`).

## Task Commits

1. **Task 1: Read-only daily-equity-return EA** — `30cb1fc5` (feat)
2. **Task 2: EA README (USD-only + numeric T14/T15 worksheet)** — `d85789cf` (docs)

**Task 3 (checkpoint:human-verify, gate=blocking-human):** NOT executable in this environment — see "Human Checkpoint" below.

## Files Created

- `tools/mt5/QuantalyzeDailyReturns.mq5` — the read-only Expert Advisor (667 lines, heavily commented because it is money-path code reviewed by a human before it runs; no CI runtime harness).
- `tools/mt5/README.md` — deploy/run + the numeric manual-acceptance worksheet (276 lines).

## Decisions Made

- **CORRECTION default = COST, not flow (H6).** Configurable via the `CorrectionIsFlow` input. Every CORRECTION deal is logged to the audit sidecar so T14 can confirm broker semantics. Rationale documented in both the EA header and the README.
- **Multi-day outage handling.** When the EA was offline for a span, it snapshots the current equity as the close for each elapsed day on the next rollover (it cannot reconstruct intraday history for missed days). Large resulting moves trip the intraday-flow flag rather than being silently absorbed; no zero-fill.
- **Documentation token-avoidance.** Comments describe the forbidden APIs in prose without spelling the exact greppable tokens, so the Plan 20-03 raw-source CI grep (which scans comments too) has no false-positives. This is the root-cause fix for the comment/grep collision (vs. asking 20-03 to strip comments).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Documentation comments tripped the read-only verification grep**
- **Found during:** Task 1 (EA verification)
- **Issue:** The EA's read-only-guarantee and MQL4-avoidance comments spelled the forbidden token names verbatim (`OrderSend`, `CTrade`, `.Buy(`, `AccountEquity()`, etc.). The plan's own acceptance grep — and the upcoming Plan 20-03 CI static-check, which greps the raw source including comments — matched those prose mentions, failing the read-only check on a file that is actually read-only.
- **Fix:** Rewrote the affected comment lines to describe the prohibited APIs in prose without the literal greppable tokens, while keeping the documentation fully clear to a human reviewer. The EA's behavior is unchanged.
- **Files modified:** tools/mt5/QuantalyzeDailyReturns.mq5
- **Verification:** Plan grep now prints `EA_OK`; MQL4-name grep returns exit 1 (no matches).
- **Committed in:** 30cb1fc5 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary so the file passes its own read-only gate and the 20-03 CI grep. No scope creep; behavior unchanged.

## Issues Encountered

None beyond the deviation above. The EA cannot be compiled or run here (no MetaTrader 5 / MetaEditor / Wine / demo account in this environment), as the plan anticipates — its runtime correctness is gated on the manual T14/T15 acceptance, not CI.

## Human Checkpoint — T14/T15 (BLOCKING, status: HUMAN-PENDING)

Task 3 is a `checkpoint:human-verify` with `gate="blocking-human"`. It **cannot run in this environment or the orchestrator** — it requires the user's MT5 terminal under Wine + a demo account. Per the plan's `autonomous: false` design, the autonomous artifacts (EA + README) are complete and the README's numeric reconcile worksheet IS the deliverable for this task. T14/T15 are explicitly **HUMAN-PENDING**:

- **T14 (numeric demo reconcile):** the user runs the scripted Day1→Day4 sequence on a demo account, fills the expected-vs-actual ±ε table, the per-deal-type tick-table (incl ≥1 CORRECTION deal + the BONUS/CREDIT double-count check), and the intraday-flow / DST / calendar-density / date-string checks (worksheet in `tools/mt5/README.md` §5.1).
- **T15 (restart state):** the user verifies the post-restart base is the persisted `prior_close_equity` and exercises a kill-mid-write to confirm fail-loud (README §5.2).

These gate the **first live KPI**, not this phase's CI completion. No KPI from this EA should be trusted until the user approves the worksheet.

## Next Phase Readiness

- The client-side half of Phase 20 is written and committed. Plan **20-03** (the read-only static-check CI step over `tools/mt5/*.mq5`, T16) can proceed against this EA — it is verified clean for the documented denylist.
- **Blocker for first-live-KPI trust (not for phase CI):** the human T14/T15 demo-account acceptance must be run and approved.

## Self-Check: PASSED

---
*Phase: 20-mt5-ea-daily-returns-ingestion-approach-a*
*Plan: 02*
*Completed: 2026-06-14*
