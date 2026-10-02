---
phase: 75-deribit-dated-flow-adapter-risky
plan: 03
subsystem: analytics
tags: [python, deribit, external-flows, twr, f1-deletion, finding-c1, atomic-swap, risky, pytest, tdd]

# Dependency graph
requires:
  - phase: 75-02
    provides: "deribit_dated_external_flows_usd (the honest dated list[ExternalFlow] producer) + inverse_days_needing_index widened by Finding C1 to emit inverse external-flow quiet days"
  - phase: 75-01
    provides: "ExternalFlow(utc_day_iso, usd_signed) contract + 5 LTP068-shaped synthetic Deribit txn-log fixtures"
provides:
  - "services/deribit_ingest.py::CompletenessReport.dated_external_flows — the crawl now accumulates a dated list[ExternalFlow] (net-scalar + saw_unvalued_inverse_flow fields RETIRED), sourced from deribit_dated_external_flows_usd with the SAME supplemental settlement-index map (C1-widened) that feeds txn_rows_to_daily_records"
  - "services/job_worker.py — F1 scalar anchor correction DELETED (its sole consumer); equity flows into combine_realized_and_funding UNADJUSTED; external_flows=_completeness.dated_external_flows threaded so flows feed ONLY the core's F_t term (count-once, no double-correction)"
affects: [75-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic contract swap — the net-scalar producer (deribit_ingest) and its sole consumer (job_worker F1) edited together across two per-task commits so no intermediate committed state references a removed field AND retains its consumer"
    - "One honest flow correction: the equity anchor is UNADJUSTED; the core's backward NAV roll (NAV_{t-1}=NAV_t−pnl_t−F_t) performs the single flow correction — the deleted F1 scalar's second subtraction can never fabricate a day"
    - "The SAME supplemental settlement-index map feeds BOTH the realized valuer and the dated-flow producer, so a quiet-day inverse withdrawal (Finding C1) values instead of sinking the whole job"

key-files:
  created:
    - analytics-service/tests/test_job_worker_deribit.py
  modified:
    - analytics-service/services/deribit_ingest.py
    - analytics-service/tests/test_deribit_ingest.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_broker_dailies.py

key-decisions:
  - "external_flows is pre-initialized to None before the venue branch (typed list[ExternalFlow] | None) and set from _completeness.dated_external_flows ONLY in the deribit branch — the combine_realized_and_funding call is SHARED across all venues, so an unconditional _completeness reference would NameError on the non-deribit path. Non-deribit venues have no dated-flow adapter yet → external_flows=None (unchanged behavior)."
  - "The two obsolete F1-scalar tests (test_deribit_anchor_subtracts_net_external_flow, test_deribit_unvalued_inverse_flow_flags_heuristic) in test_broker_dailies.py were DELETED — they construct CompletenessReport with the removed kwargs and assert the deleted subtraction/degrade-to-DQ behavior. Their honest replacements live in the new test_job_worker_deribit.py."
  - "The now-orphaned deribit_linear_external_flow_usd function is LEFT in deribit_txn.py (its import was removed from deribit_ingest.py; its sole consumer deleted). Scope explicitly forbids touching deribit_txn.py (75-02's file); the dead function is logged as a deferred cleanup, not removed here."

requirements-completed: [FLOW-02]

# Metrics
duration: 40min
completed: 2026-07-06
---

# Phase 75 Plan 03: Deribit Dated-Flow Contract Swap + F1 Deletion Summary

**The atomic contract swap: `CompletenessReport` now carries a dated `list[ExternalFlow]` (net-scalar + `saw_unvalued_inverse_flow` fields retired) accumulated in the crawl via `deribit_dated_external_flows_usd`, the F1 scalar anchor correction (`equity -= net_external_flow_usd`) is DELETED, and the dated flows are threaded into `combine_realized_and_funding` so they feed ONLY the honest core's `F_t` term — count-once, no double-correction, quiet-day inverse withdrawals value via the Finding-C1 supplemental fetch.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-06
- **Tasks:** 2 (both TDD RED→GREEN)
- **Files:** 1 created, 4 modified

## Accomplishments

- **Task 1 — CompletenessReport dated flows + crawl accumulation.** Replaced `CompletenessReport.net_external_flow_usd: float` and `saw_unvalued_inverse_flow: bool` with `dated_external_flows: list[ExternalFlow] = field(default_factory=list)` (importing `ExternalFlow` from `services.external_flows`); `total_return_rows` kept (C2 floor input). The crawl loop's F1 accumulation (`deribit_linear_external_flow_usd(rows)` → net scalar) is replaced with `deribit_dated_external_flows_usd(rows, supplemental_index=supplemental)`, extending a per-crawl dated accumulator. The SAME `supplemental` settlement-index map already built for `txn_rows_to_daily_records` — widened by the 75-02 Finding-C1 extension of `inverse_days_needing_index` to cover inverse external-flow quiet days — feeds the dated producer, so a quiet-day BTC withdrawal values against its same-day `get_delivery_prices` index instead of failing the whole job.
- **Task 2 — F1 deletion + dated-flow threading.** DELETED the F1 block (`if equity is not None and not balance_error: … equity = equity - _completeness.net_external_flow_usd`) — the net-scalar's sole consumer. The equity anchor now flows into `combine_realized_and_funding` UNADJUSTED; the call passes `external_flows=_completeness.dated_external_flows` so the dated list feeds ONLY the core's `F_t` term. The C2 equity-vs-activity floor and both permanent-fail catches (`LedgerValuationError` at the ledger try, `NavReconstructionError` at the combine try) are untouched — an unvaluable inverse flow now fails loud PERMANENT rather than being silently degraded to `balance_error` (the deleted scalar's old behavior).

## Task Commits

Each task committed atomically (TDD RED→GREEN):

1. **Task 1 (RED): dated-flow crawl accumulation + C1 end-to-end proofs** — `e10537cc` (test)
2. **Task 1 (GREEN): CompletenessReport.dated_external_flows + crawl accumulation** — `2d8748bd` (feat)
3. **Task 2 (RED): F1-deletion + threading + no-double-correction proofs** — `e78d597e` (test)
4. **Task 2 (GREEN): delete F1 scalar + thread dated flows into the core** — `e8cf4959` (feat)

## Files Created/Modified

- `analytics-service/services/deribit_ingest.py` — `CompletenessReport` field swap (dated list replaces the two scalars) + docstring; crawl accumulates via `deribit_dated_external_flows_usd`; import swap (`deribit_dated_external_flows_usd` + `ExternalFlow` in, `deribit_linear_external_flow_usd` out).
- `analytics-service/tests/test_deribit_ingest.py` — +5 tests: dated inverse flow with own index, C1 quiet-day flow valuing via fetched index, linear deposit (no fetch), retired-fields field-swap, count-once (flow absent from realized).
- `analytics-service/services/job_worker.py` — F1 block deleted; `external_flows` pre-initialized (typed) then set from `_completeness.dated_external_flows` in the deribit branch; threaded into the combine call.
- `analytics-service/tests/test_job_worker_deribit.py` (NEW) — +5 tests: equity-unadjusted (no F1), dated-flows-threaded, fail-loud-inheritance (LedgerValuationError permanent, combine not called), C2 floor preserved, mutation-honest source-scan (F1 scalar cannot be reintroduced).
- `analytics-service/tests/test_broker_dailies.py` — removed the two obsolete F1-scalar tests (replaced by the new file); left an explanatory marker.

## Decisions Made

- **`external_flows` pre-initialized to `None` before the shared combine call** — the deribit branch sets it from `_completeness.dated_external_flows`; the non-deribit path (which has no `_completeness`) leaves it `None`. An unconditional `_completeness.dated_external_flows` in the shared call would `NameError` on Binance/Bybit/OKX. Behavior for those venues is unchanged (`external_flows=None`).
- **Two obsolete F1 tests deleted, not adapted** — they pinned the exact behavior (net-scalar subtraction + degrade-to-DQ) that FLOW-02 removes; adapting them would be dishonest. Replaced by `test_job_worker_deribit.py` proving the honest wiring.
- **Orphaned `deribit_linear_external_flow_usd` left in place** — scope forbids touching `deribit_txn.py`; the dead function is a deferred cleanup (see below), not a Task-1/2 edit.

## Deviations from Plan

### [Rule 3 — blocking] Obsolete F1 tests in `test_broker_dailies.py` removed

- **Found during:** Task 2 (after the field swap and F1 deletion).
- **Issue:** `test_deribit_anchor_subtracts_net_external_flow` and `test_deribit_unvalued_inverse_flow_flags_heuristic` construct `CompletenessReport(net_external_flow_usd=…)` / `(saw_unvalued_inverse_flow=…)` — kwargs removed in Task 1 — and assert the F1 subtraction / degrade-to-DQ behavior deleted in Task 2. They would error at construction and assert deleted behavior.
- **Fix:** Deleted both, replaced with an explanatory marker pointing to `test_job_worker_deribit.py`. The plan's `files_modified` named `test_job_worker_deribit.py` (new) for the Task-2 proofs; the obsolete tests happened to live in `test_broker_dailies.py`, so that file is touched as a necessary consequence of the atomic swap.
- **Commit:** `e8cf4959` (with the Task-2 GREEN).

### Note (not a behavior deviation): orphaned linear-scalar function

`deribit_linear_external_flow_usd` in `deribit_txn.py` is now dead (import removed from `deribit_ingest.py`; sole consumer F1 deleted). Left in place because scope explicitly forbids touching `deribit_txn.py` (75-02's file). Logged as a deferred cleanup for a future non-RISKY pass.

## Mutation-Honesty Verification (RISKY proofs)

- **Count-once (crawl level)** — `test_crawl_flow_row_count_once_absent_from_realized`: the +50000 deposit flow is absent from realized `daily_records` (only the −5 linear trade fee reaches realized) and present exactly once in `dated_external_flows`. A leak into the realized sum reddens it.
- **C1 end-to-end (revert-proof)** — `test_crawl_c1_quiet_inverse_flow_values_via_settlement_index`: the quiet BTC withdrawal values via the fetched same-day index; reverting the 75-02 C1 extension (so the day is never emitted/fetched) makes the flow producer raise `LedgerValuationError` out of the crawl and the test errors (fail loud).
- **No double-correction (mutation-honest source-scan)** — `test_f1_scalar_region_source_scan`: no active (non-comment) line in `job_worker.py` contains `saw_unvalued_inverse_flow`, `net_external_flow_usd`, or an `equity = equity - …external_flow` pattern. Reintroducing the F1 subtraction reddens it.
- **Equity unadjusted** — `test_equity_anchor_flows_unadjusted_no_f1_subtraction`: the anchor passed to combine equals the RAW 100k, NOT 100k − (−628k) = 728k. Restoring F1 reddens it.
- **Fail-loud inheritance** — `test_no_unvalued_inverse_flow_degrade_to_balance_error`: an unvaluable inverse flow surfaces as permanent `LedgerValuationError` (combine never called), never a silent `balance_error` DQ.

## Known Stubs

None. This plan wires an existing pure producer into the crawl + core and deletes a scalar. No placeholders, no hardcoded empties flowing to UI. The 75-01 fixtures consumed are intentional test scaffold (documented in 75-01).

## Threat Flags

None new. The change stays inside the two threat-model boundaries this plan mitigates (crawl → CompletenessReport dated flows; `_completeness` → combine → core). No new network endpoints, auth paths, file access, or schema changes — the crawl already fetches `get_delivery_prices` (75-02) and `combine_realized_and_funding` already accepts `external_flows` (74-02). T-75-03-DBL / -C1E / -DEG / -C2 are all covered by the mutation-honest proofs above.

## Verification

- `pytest tests/test_deribit_ingest.py` → **52 passed** (+5 new).
- `pytest tests/test_job_worker_deribit.py` → **5 passed** (new file).
- `pytest tests/test_broker_dailies.py` → **31 passed** (−2 obsolete F1 tests removed).
- **Full analytics suite: 3021 passed, 92 skipped** in the CI-3.12 venv (baseline 3013/92; +10 new − 2 removed = +8). No new warnings attributable to the change.
- `mypy --strict services/deribit_ingest.py services/job_worker.py` → **clean**.
- F1 negated grep (`! grep -qE 'equity = equity - .*external_flow|saw_unvalued_inverse_flow'`) → **PASS** (scalar absent).
- Field-swap scan: no code references `CompletenessReport.net_external_flow_usd` / `saw_unvalued_inverse_flow` (remaining hits are the source-scan test assertions + the orphaned function's docstring).

## TDD Gate Compliance

Both tasks followed RED → GREEN with distinct commits:
- Task 1: `test(75-03)` `e10537cc` (AttributeError on `dated_external_flows`, RED) → `feat(75-03)` `2d8748bd` (GREEN, 52 passed).
- Task 2: `test(75-03)` `e78d597e` (F1 present / threading absent / source-scan RED) → `feat(75-03)` `e8cf4959` (GREEN, 5 passed).
No REFACTOR commits needed (both green first pass after implementation).

## Next Phase Readiness

- **75-04** (LTP068 acceptance) can now drive the full crawl → CompletenessReport → combine → core path end-to-end: `pure_flow_no_trade_rows` (sub-NAV → `r_t==0`) and `dominating_withdrawal_rows` (→ `flow_dominated_guard`) flow through `dated_external_flows` with the C1-fetched supplemental index, and the equity anchor is now unadjusted so the core's `F_t` is the single correction the acceptance asserts.
- **Deferred cleanup:** remove the now-dead `deribit_linear_external_flow_usd` from `deribit_txn.py` in a future non-RISKY pass (out of this plan's scope).
- No blockers.

---
*Phase: 75-deribit-dated-flow-adapter-risky*
*Completed: 2026-07-06*

## Self-Check: PASSED
All 5 files present (1 created, 4 modified); all 4 task commits (e10537cc, 2d8748bd, e78d597e, e8cf4959) in git log; `dated_external_flows` present on CompletenessReport; F1 negated grep passes (scalar absent).
