---
phase: 75-deribit-dated-flow-adapter-risky
plan: 02
subsystem: analytics
tags: [python, deribit, external-flows, twr, inverse-valuation, finding-c1, risky, pytest, tdd]

# Dependency graph
requires:
  - phase: 75-01
    provides: "ExternalFlow(utc_day_iso, usd_signed) NamedTuple contract + 5 LTP068-shaped synthetic Deribit txn-log fixtures with distinct per-day BTC index constants (42000/45000/41000)"
provides:
  - "services/deribit_txn.py::deribit_dated_external_flows_usd — the ONE honest dated per-UTC-day list[ExternalFlow] producer valuing linear (pass-through) + inverse (same-day settlement index) flows via txn_change_to_usd verbatim; fail-loud LedgerValuationError on a missing inverse index; missing-change fail-loud (W2 option b); count-once by construction (_EXTERNAL_FLOW_TYPES ⊆ INFORMATIONAL_TYPES)"
  - "services/deribit_txn.py::inverse_days_needing_index (extended, Finding C1) — now emits (day, ccy) for inverse _EXTERNAL_FLOW_TYPES quiet days so the crawl fetches their get_delivery_prices settlement index"
affects: [75-03, 75-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One honest valuation path reused by BOTH the realized sum and the dated-flow producer (txn_change_to_usd) — no second inverse converter"
    - "Own same-day index (batch settlement row) ALWAYS wins over the supplemental (get_delivery_prices) index — identical resolution order in txn_rows_to_daily_records and deribit_dated_external_flows_usd so the two paths can never disagree on a day's index"
    - "Single crawl planner (inverse_days_needing_index) feeds BOTH valuers' supplemental_index — extended once to cover cash-bearing AND inverse external-flow quiet days"

key-files:
  created: []
  modified:
    - analytics-service/services/deribit_txn.py
    - analytics-service/tests/test_deribit_txn.py

key-decisions:
  - "deribit_dated_external_flows_usd consults _day_ccy_own_index(rows) FIRST then supplemental_index — NOT the plan's simplified supplemental-only recommended shape. Scenario 2's withdrawal row carries no own index_price (the index is seeded by a separate same-day settlement row), so a supplemental-only producer would fail loud on it and the event-time proof (-0.5*42000=-21000) could not hold. Mirroring the realized path's resolution is the honest fix and keeps the two paths structurally in agreement."
  - "W2 (missing-change): chose option (b) — an EXPLICIT missing-`change` guard in the flow producer that raises LedgerValuationError BEFORE valuation, distinguishing an ABSENT change key (_MISSING sentinel) from a present 0.0. This does NOT touch the shared txn_change_to_usd coalesce (cash-bearing rows rely on `row.get('change',0.0) or 0.0`). Rationale: cheap, flow-local (zero blast radius), and enforces the RISKY-phase fail-loud discipline the plan's action text calls for. A present-null change coalesces to 0.0 and is a harmless no-op skip; only a truly absent key fails loud."
  - "Undatable flow row wrapped as LedgerValuationError (permanent) rather than a bare ValueError — mirrors txn_rows_to_daily_records so the worker's network over-catch never mistakes a structural dating failure for a transient condition."
  - "Finding C1 implemented by BROADENING the existing inverse_days_needing_index type gate (CASH_BEARING_TYPES OR inverse _EXTERNAL_FLOW_TYPES) rather than a sibling planner — per 75-RESEARCH 'Alternatives Considered', so the cash-bearing planner and the flow planner can never disagree on which days already carry an own index. Currency/nonzero/own-index guards left identical."

requirements-completed: [FLOW-02]

# Metrics
duration: 45min
completed: 2026-07-06
---

# Phase 75 Plan 02: Deribit Dated Inverse-Flow Valuation + Finding C1 Summary

**The RISKY core: `deribit_dated_external_flows_usd` — the ONE honest dated per-UTC-day `ExternalFlow` producer that values linear flows as USD pass-through and inverse (BTC/ETH) flows at the same-day `get_delivery_prices` settlement index via `txn_change_to_usd` verbatim (fail-loud when absent, never 1.0/current/dropped) — plus Finding C1 extending `inverse_days_needing_index` so inverse external-flow quiet days get their index fetched.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-06
- **Tasks:** 2 (both TDD RED→GREEN)
- **Files modified:** 2 (0 created)

## Accomplishments

- **Task 1 — `deribit_dated_external_flows_usd(rows, *, supplemental_index=None) -> list[ExternalFlow]`**: converts the in-band `_EXTERNAL_FLOW_TYPES` rows into a dated per-UTC-day flow list. Linear (USDC/USDT/USD/EURR) flows pass through as USD; inverse (BTC/ETH) flows value at `change × same-day settlement index` (own batch index first, else `supplemental_index`), failing loud (`LedgerValuationError`) when neither exists. Reuses `txn_change_to_usd` verbatim — the single honest valuation path; no second inverse converter. The `change` sign is trusted verbatim (a withdrawal → negative `usd_signed`). A missing `change` field fails loud (W2 option b). Returns a sorted `list[ExternalFlow]`.
- **Task 2 — Finding C1**: broadened the `inverse_days_needing_index` type gate from `CASH_BEARING_TYPES`-only to `CASH_BEARING_TYPES` OR inverse `_EXTERNAL_FLOW_TYPES`, so a quiet-day BTC withdrawal (no own same-day index) now has its `(day, "BTC")` emitted → the crawl fetches its settlement index instead of the whole job failing loud downstream. No-regression / own-index-dedupe / linear-exclusion / zero-change-exclusion all preserved.

## Task Commits

Each task committed atomically (TDD RED→GREEN):

1. **Task 1 (RED): failing dated-flow producer proofs** — `a8c85156` (test)
2. **Task 1 (GREEN): deribit_dated_external_flows_usd** — `7cfec662` (feat)
3. **Task 2 (RED): failing Finding C1 proof** — `b745c4d8` (test)
4. **Task 2 (GREEN): inverse_days_needing_index C1 extension** — `83af1a12` (feat)

## Files Modified

- `analytics-service/services/deribit_txn.py` — added `deribit_dated_external_flows_usd` (+ `from services.external_flows import ExternalFlow`); extended `inverse_days_needing_index` type gate for Finding C1 and updated its docstring.
- `analytics-service/tests/test_deribit_txn.py` — +13 mutation-honest tests (8 for the dated producer, 5 for C1) importing the 75-01 fixtures + `ExternalFlow`.

## Decisions Made

- **Own-index-first resolution (not the simplified recommended shape)** — the plan's `<interfaces>` recommended-shape sketch resolves the inverse index from `supplemental_index` only. Scenario 2's withdrawal carries no own `index_price` (a separate settlement row seeds the day's index), so a supplemental-only producer would fail loud on it and the event-time proof (`-0.5×42000=-21000`) could not hold. The producer therefore consults `_day_ccy_own_index(rows)` first then `supplemental_index`, identical to `txn_rows_to_daily_records` — the honest composition, keeping both valuers in lockstep on any day's index.
- **W2 missing-change → option (b)** — explicit `_MISSING`-sentinel guard raising `LedgerValuationError` before valuation, local to the flow producer, leaving the shared `txn_change_to_usd` coalesce untouched. See Deviations for the honest note on what the shared path actually does.
- **C1 via gate-broadening, not a sibling planner** — one planner, one own-index map; the cash-bearing and flow planners can never diverge.

## Deviations from Plan

### W2 (plan-checker warning 2) — honest handling of `txn_change_to_usd`'s missing-`change` coalesce

**Type:** [Rule 2 — correctness/fail-loud discipline] Explicit missing-change guard in the flow producer.

- **Context:** The plan's action text says "do NOT coalesce a missing `change` to 0.0 (schema-drift must fail loud via the existing coercion)". The plan-checker correctly flagged that `txn_change_to_usd` does NOT provide this — it runs `_coerce_float(row.get("change", 0.0) or 0.0, ...)`, which coalesces an ABSENT `change` to `0.0` and does not raise. Claiming a fail-loud guarantee the shared path does not provide would be dishonest.
- **Chosen resolution:** Option (b). Added an explicit `raw_change = row.get("change", _MISSING); if raw_change is _MISSING: raise LedgerValuationError(...)` guard in `deribit_dated_external_flows_usd`, BEFORE valuation. This is flow-local (zero blast radius) and does NOT alter the shared `txn_change_to_usd` coalesce that cash-bearing rows rely on. It mirrors the existing H2 missing-change guard in `txn_rows_to_daily_records` (:559-566). A present-null `change` still coalesces to `0.0` and is a harmless no-op skip; only a truly absent key fails loud. Proven by `test_dated_external_flow_missing_change_fails_loud`.
- **Honest statement of shared-path behavior:** `txn_change_to_usd` itself remains coalesce-on-absent by design; the fail-loud on missing `change` for FLOW rows lives in the producer, not the shared valuer.

### Composition detail (not a behavior deviation)

`deribit_dated_external_flows_usd` consults `_day_ccy_own_index` in addition to `supplemental_index` (see Decisions). This is a faithful realization of the behavior proofs, not a divergence from them — the plan's recommended-shape sketch was a simplification.

## Mutation-Honesty Verification (RISKY proofs)

Every RISKY proof was verified RED under its mutation before/against GREEN:

- **Count-once** — neutering the `INFORMATIONAL_TYPES` skip in `txn_rows_to_daily_records` (so the +50000 deposit leaks into the realized sum) → `test_flow_count_once_excluded_from_realized_sum` RED (confirmed).
- **Event-time value** — valuing the inverse flow at a `1.0` unit price instead of the same-day index → `test_dated_external_flow_sign_and_event_time_value` + `test_flow_linear_vs_inverse_valuation` RED (confirmed).
- **Fail-loud** — the no-index quiet-day withdrawal raises `LedgerValuationError` (proven by fixture scenario 3 having no own/supplemental index).
- **Finding C1** — reverting the extension (restoring the `CASH_BEARING`-only gate) → `test_c1_inverse_flow_quiet_day_needs_index` RED while the CASH_BEARING no-regression proof stays GREEN (confirmed: 1 failed / 4 passed under mutation).

## Known Stubs

None. This plan adds pure valuation/planner logic to `deribit_txn.py`; no data-source wiring, no placeholders. The 75-01 fixtures it consumes are intentional test scaffold (documented in 75-01).

## Threat Flags

None. No new network endpoints, auth paths, file access, or schema changes — the module remains pure/I-O-free (the purity source-scan guard still holds; `services.external_flows` is stdlib+typing only). The two threat-model boundaries (txn-log row → USD F_t; crawl planner → index fetch) are exactly the surface this plan mitigates (T-75-02-VAL / -C1 / -CNT / -SGN all covered by mutation-honest proofs).

## Verification

- `pytest tests/test_deribit_txn.py -q` → **62 passed** (was 49; +13 new) in the CI-3.12 venv.
- **Full analytics suite: 3013 passed, 92 skipped** in the CI-3.12 venv (baseline after 75-01 was 3000/92; +13 new). No new warnings attributable to the change.
- **Coverage on `services/deribit_txn.py`: 86%** across the deribit test suite (≥80% gate held; the new function's branches are covered).

## TDD Gate Compliance

Both tasks followed RED → GREEN with distinct commits:
- Task 1: `test(75-02)` `a8c85156` (import + valuation/count-once RED) → `feat(75-02)` `7cfec662` (GREEN).
- Task 2: `test(75-02)` `b745c4d8` (C1 quiet-day RED) → `feat(75-02)` `83af1a12` (GREEN).
No REFACTOR commits needed (both green first pass after implementation, no cleanup required).

## Next Phase Readiness

- **75-03** can now thread `deribit_dated_external_flows_usd` into the CompletenessReport/core `external_flows` and consult the extended `inverse_days_needing_index` for the crawl's `get_delivery_prices` fetch; the linear-only scalar `deribit_linear_external_flow_usd` remains in place for 75-03 to delete its sole consumer.
- **75-04** acceptance (sub-NAV pure-flow → `r_t==0`; dominating withdrawal → `flow_dominated_guard`) can drive the producer against `pure_flow_no_trade_rows` / `dominating_withdrawal_rows` with the C1-fetched supplemental index.
- No blockers.

---
*Phase: 75-deribit-dated-flow-adapter-risky*
*Completed: 2026-07-06*

## Self-Check: PASSED
Both modified files present; all 4 task commits (a8c85156, 7cfec662, b745c4d8, 83af1a12) in git log; `deribit_dated_external_flows_usd` def present in `deribit_txn.py`.
