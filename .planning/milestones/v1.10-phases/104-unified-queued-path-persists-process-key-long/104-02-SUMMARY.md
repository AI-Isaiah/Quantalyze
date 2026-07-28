---
phase: 104-unified-queued-path-persists-process-key-long
plan: 02
subsystem: analytics
tags: [python, tests, sc-4, basis-series, cash-settlement, byte-identity, boundary-guard]

# Dependency graph
requires:
  - phase: 104-01
    provides: "additive DARK cash_settlement series persist at the single-key broker-derive seam (SERIES-ONLY) + benchmark-identity conventions echo"
provides:
  - "SC-4 dual-run byte-identity regression (cash persist active vs no-opped)"
  - "SC-1 series↔csv_daily_returns round-trip identity + coverage-mask regression"
  - "SC-2/INERT-read/A3 boundary guards (SERIES-ONLY grep gate, no-reader repo scan, single-seam count) — PHASE GUARDS retired deliberately by 105/106"
affects: [105-cash-scalar-cache-of-series, 106-dark-path-route-collapse]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Job-level dual-run SC-4 idiom: run the mocked seam twice (feature on vs no-opped) and dict-compare the captured writes; the ONLY delta is the additive write"
    - "persist_basis_series patched at SOURCE (function-local import) to no-op one basis while another passes through — reproduces the pre-feature seam"
    - "Comment-stripped repo grep gates as PHASE GUARDS (deleted deliberately by the phase that lands the reader)"

key-files:
  created:
    - analytics-service/tests/test_cash_basis_series_sc4.py
  modified: []

key-decisions:
  - "Tests-only plan: ZERO production changes (the two mutation spot-checks were applied then reverted; git diff for the plan is exactly the one new test file)."
  - "Full-suite coverage sweep IS the SC-3 cash golden gate: the cash-pin / golden / basis-series / seam-regression tests are all green and coverage passed at 92.50% (gate 80%)."
  - "One pre-existing UNRELATED failure (Phase-100 audit-taxonomy drift) deferred, not fixed (SCOPE BOUNDARY) — logged to deferred-items.md."

patterns-established:
  - "SC-4 dual-run captures the ENTIRE Phase-104 production delta (the 104-01 benchmark-fetch-hoist drop means the cash series persist is the only remaining delta)."
  - "Each test names — in its docstring — the mutation it kills; two were spot-checked live (Test 1 by leaking a cash_settlement key into the prestamp; Test 6 by adding a .eq(\"kind\",\"cash_settlement\") reader)."

requirements-completed: [BB-01]

# Metrics
duration: ~40min
completed: 2026-07-14
---

# Phase 104 Plan 02: SC-4 proof + boundary guards Summary

**Seven executor-runnable pytest tests pin the four load-bearing Phase-104 guarantees for the additive DARK cash-series persist — SC-4 byte-identity (dual-run), SC-1 series↔csv round-trip + coverage mask, and the SC-2 / INERT-read / A3 boundary guards — all green, with two mutations spot-checked live to prove falsifiability, and zero production changes.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2/2
- **Production files modified:** 0 (tests-only; two mutation spot-checks applied then reverted)
- **Test files created:** 1 (`test_cash_basis_series_sc4.py`, 465 lines, 7 tests)

## Accomplishments

- **Test 1 (SC-4 dual-run byte-identity):** runs the mocked strategy-mode `run_derive_broker_dailies_job` twice on the identical options-book fixture — Run A as-shipped, Run B with `persist_basis_series(basis="cash_settlement")` no-opped (MTM passes through). The `csv_daily_returns` delete+upsert payloads, the FULL `strategy_analytics` prestamp (incl. `metrics_json_by_basis` — no `cash_settlement` key), and the MTM-persist + `enqueue_compute_job` RPCs are dict-equal; the ONLY delta is the additive `cash_settlement` entry in `upsert_strategy_analytics_series_batch`. Plus an explicit no-cash-key invariant on the prestamp (the mutation-target).
- **Test 2 (SC-1 round-trip + mask):** an interior-NaN guard-day fixture; the rebuilt sparse series equals the finite (`pd.notna`) subset via `assert_series_equal(check_exact=True)`; the guard day 2024-05-02 is absent from BOTH the series row and `csv_daily_returns` (identical date sets, bit-equal values); `gap_spans` covers it.
- **Tests 3-4 (conventions):** a Zavara simple/active override echoes `{365, simple, active, BTC}`; a traditional-asset fixture echoes √252 and carries `benchmark: "BTC"` UNCONDITIONALLY even with the MTM-side `get_benchmark_returns` mocked to RAISE (cash derive passes `benchmark_rets=None`). Both hold SC-4 (dual-run non-cash track equal; no cash key leaks).
- **Tests 5-7 (boundary guards):** `analytics_runner.py` has zero non-comment `derive_basis_series`/`basis_series` refs (SC-2); the repo scan finds no non-comment reader pairing `cash_settlement` with `kind`/`strategy_analytics_series` (INERT read); exactly one `basis="cash_settlement"` persist seam exists in `job_worker.py` (A3 honest absence). All are comment-stripped grep gates and documented PHASE GUARDS (105/106 retire them).

## Task Commits

1. **Task 1: SC-4 dual-run byte-identity + round-trip + convention fixtures** — `64be3e7c` (test, TDD)
2. **Task 2: boundary guards — SERIES-ONLY grep gate + INERT-read scan + single seam + full-suite golden sweep** — `c8e2c39b` (test, TDD)

_Plan docs live under `.planning/` (gitignored/local) — no metadata commit._

## Mutation Spot-Checks (falsifiability proof)

- **Test 1** — temporarily set the prestamp `metrics_json_by_basis` to `{"mark_to_market": …, "cash_settlement": {"MUTANT": 1}}` in `job_worker.py`: Test 1 RED (the no-cash-key invariant fired). Reverted; `git diff services/job_worker.py` empty.
- **Test 6** — temporarily appended `const MUTANT_READER = query.eq("kind", "cash_settlement");` to `src/lib/types.ts`: Test 6 RED (offender reported at `types.ts:1770`). Reverted via `git checkout --`.

Both mutations left the tree clean (verified `git status`), and the full 7-test file re-ran green after each revert.

## Deviations from Plan

None — plan executed exactly as written. The two production-file touches above were transient mutation spot-checks mandated by the plan's `<done>` criteria, both reverted; the plan's net production diff is zero.

Note on Wave-1 test changes (requested review): the four `test_mtm_single_key.py` wiring assertions updated in 104-01 (deviation #2) were re-read against `d75ee787`. All four are DISAMBIGUATING and, if anything, STRENGTHENED — not weakened:
- `test_mtm_periods_uses_crypto_clock_from_real_select`: `[365]` → `[365, 365]` (now asserts BOTH the MTM and the cash derive annualize on √365; a dropped `asset_class` → `[252, 252]` still reddens).
- `test_single_key_routes_through_shared_derive_and_persists`: keeps the full MTM call-args pins (first call) AND adds that the second persist is `basis="cash_settlement"`.
- `test_single_key_derive_helper_valueerror_degrades_and_heals`: now asserts BOTH persists heal (`result=None`) across `{mark_to_market, cash_settlement}`.
- `test_single_key_not_attempted_heals_series_row`: pins the MTM heal (`result=None`) AND that the cash persist carries a real (non-None) result on a clean derive.
No intent was lost.

## Acceptance-Criteria Results

- `python -m pytest tests/test_cash_basis_series_sc4.py -q` → **7 passed.**
- `python -m pytest --cov --cov-fail-under=80 -q` → **3684 passed, 93 skipped, 1 failed; TOTAL coverage 92.50% (gate 80% reached).** The single failure — `test_audit.py::…::test_action_literal_matches_ts_union` — is a PRE-EXISTING, UNRELATED Phase-100 Python/TS audit-taxonomy drift (`user_note.dashboard.update` in TS but not the Python Literal; introduced by `d45ff646 feat(100-01)`). Out of scope for this tests-only plan; deferred to `deferred-items.md`.
- SC-3 cash golden sweep GREEN in isolation: `test_basis_series.py + test_derive_broker_dailies_dualmode.py + test_mtm_single_key.py + test_cash_basis_series_sc4.py + test_zavara_acceptance.py + test_stitch_composite_job.py` → **157 passed**; keyword `-k 'cash or golden or pin'` → **145 passed, 2 skipped**.
- `git diff --stat 64be3e7c~1 HEAD -- analytics-service src` → **only `analytics-service/tests/test_cash_basis_series_sc4.py` (+465)** — production untouched.
- Manual gate spot-checks: `grep -vE '^\s*#' services/analytics_runner.py | grep -c 'derive_basis_series'` = 0; `grep -vE '^\s*#' services/job_worker.py | grep -c 'basis="cash_settlement"'` = 1.

## Known Stubs

None — this is a tests-only plan pinning the already-shipped 104-01 dark write.

## Self-Check: PASSED

- `analytics-service/tests/test_cash_basis_series_sc4.py` — FOUND
- Commit `64be3e7c` — FOUND
- Commit `c8e2c39b` — FOUND
