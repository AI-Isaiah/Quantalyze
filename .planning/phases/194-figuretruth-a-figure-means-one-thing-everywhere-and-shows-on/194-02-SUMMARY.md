---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 02
subsystem: analytics-producer, factsheet-engine
tags: [trust-04, d-02, d-03, d-15, var-cvar, calendar-windows, cross-language-parity]

requires:
  - phase: 194-01
    provides: the SC-1 reading naming the 6M, 3M, VaR and CVaR mismatches
provides:
  - "historical VaR/CVaR (`_historical_var_cvar`, `historicalVarCvar`) as the one definition in producer and engine"
  - "calendar 3M/6M windows (91/182 days) in the producer, `_record_covers_window` port of `recordCoversWindow`"
  - "`metrics_json.figure_defs_version = 2` and `metrics_json.record_observations`; `MIN_ANNUALIZATION_OBS = 60`"
  - "`figure_parity_vectors.json` read by pytest and vitest"
affects: [194-03, 194-04, 194-07, 194-09]

actuals:
  tokens: 18400
  tasks: 3
  commits: 3

plan_head_before: 96909797772ff8f6ade9c63890a7f8c67d2b6202
plan_head_after: 9f85c00dcea00ad1216777c580326e3fac1660d1

tech-stack:
  added: []
  patterns: ["hand-derived shared JSON oracle read by both pytest and vitest", "Python constants pinned by a vitest that reads the .py file as text"]

key-files:
  created:
    - analytics-service/tests/fixtures/figure_parity_vectors.json
    - analytics-service/tests/test_figure_parity.py
    - src/lib/figure-parity.test.ts
    - .planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/deferred-items.md
  modified:
    - analytics-service/services/metrics.py
    - src/lib/return-stats.ts
    - src/lib/factsheet/compute.ts
    - analytics-service/tests/test_metrics.py
    - analytics-service/tests/test_metrics_headline_suffix.py
    - analytics-service/tests/fixtures/golden_252d_expected.json
    - src/__tests__/metrics-parity.test.ts
    - src/lib/factsheet/compute.arithmetic-buckets.test.ts
    - src/lib/factsheet/compute.metrics.test.ts

key-decisions:
  - "D-02 and D-03 hold by one definition each, in both languages; the engine's 3M moved from 90 to 91 days (orchestrator constraint 8)."
  - "The producer adds no withholding: `record_observations` is the input D-15 readers gate on."

requirements-completed: []  # TRUST-04 closes with the later code plans; this plan lands D-02/D-03 and the D-15 input

duration: 1 session (3 task commits)
completed: 2026-11-07
status: complete
---

# Phase 194 Plan 02: One VaR/CVaR definition, calendar 3M/6M, stored observation count Summary

**The stored `var_1d_95`/`cvar` are now historical quantiles and the stored 3M/6M are 91/182-day calendar windows, computed by the same rule in `metrics.py` and the factsheet engine and proven equal on one hand-derived JSON fixture that both pytest and vitest read.**

## Accomplishments

- Tracer: one fixture (`var_cvar`, four hand-derived vectors: n=200/k=10, n=37/k=1, n=12/k=0, n=40 with three tied minima) travels `_historical_var_cvar` (Python) and `historicalVarCvar` (TS), both within 1e-12.
- `metrics.py`: `_historical_var_cvar`, `_record_covers_window` (faithful port of `recordCoversWindow`, weekday tolerance and 1 Jan / 25 Dec skip included), `_calendar_window_return`; the 126/63-row tails are gone; `FIGURE_DEFS_VERSION = 2`, `SIX_MONTH_WINDOW_DAYS = 182`, `THREE_MONTH_WINDOW_DAYS = 91`, `MIN_ANNUALIZATION_OBS = 60` (dated D-15 comment naming the TS twin), and every new row carries `figure_defs_version` and `record_observations` (non-NaN headline count).
- `compute.ts`: exported `THREE_MONTH_WINDOW_DAYS = 91` / `SIX_MONTH_WINDOW_DAYS = 182`, var95/cvar95 from `historicalVarCvar`. A vitest reads `metrics.py` as text and pins each window constant (exactly one definition, equal to the TS constant).
- Window vectors (closed form): 400-day record (6M = 1.001^182-1, 3M = 1.001^91-1), 150-day record (6M None), weekday Monday start after a Friday cutoff (covered) vs Tuesday start (not), the 1 January skip (covered from 2 Jan, not from 5 Jan), arithmetic sum.
- D-15 count cases: 59 -> 59, 60 -> 60, chain-broken 100-return series with the break at index 39 -> 60 (computed from the test's own break index).

## The 3 Month cause (asked to be confirmed before locking D-03)

SC-1 read stored 3M = 1.89% against factsheet +21.24% for S1 and called the gap "far larger than the window difference explains". Confirmed from the code: the two paths differ ONLY in the window. Producer: `_bucket_return(headline.tail(63))` (last 63 rows). Engine: `windowReturn(offsetDays(90))` over the same `returns_series` dates (`build-payload.ts` feeds `compute()` the stored daily returns). Same series, same geometric compounding, `headline is returns` on a clean row (`headline_since` null), no overlay or second source for 3M. S1's series is daily 7-day (257 rows over 256 days), so the windows are the last 63 days against the last 90 days: 27 days that the engine includes and the producer drops. Arithmetic from the four SC-1 figures (1.2124 / 1.0189 = 1.190) puts those 27 days at about +19.0%, and the days 91-126 back at about -3.8%; feasible for a 25%-volatility strategy but large, and the code cannot prove it. So the cause of the gap is the window length (63 rows vs 90 days) and nothing else the code shows; the 90 vs 91 question is a one-day sliver on top. Whether days 64-90 back really carry about +19% is a PROD data fact, not a code fact. D-03 stands either way: after this plan both sides compute the same 91-day window by one rule, so the disagreement cannot recur in the producer/engine pair. Confirming the 27-day tranche needs a read-only PROD SELECT that unrolls S1's `returns_series` (no database access was allowed in this plan); it is not needed for D-03 and was not run.

## RED proofs (neuter, byte backup, restore)

- VaR/CVaR, TS: CVaR slice widened by one element in `return-stats.ts` -> `AssertionError: expected -0.07500000000000001 to be close to -0.0775` (`n200_k10_ten_worst`; `n37_k1` also RED); restored, 6 passed.
- VaR/CVaR, Python: same neuter in `metrics.py` -> `FAILED tests/test_figure_parity.py::test_historical_var_cvar_matches_hand_derived_vector[n200_k10_ten_worst]` and `[n37_k1]`; restored, 6 passed.
- 6M: `headline.tail(126)` put back -> `3 failed, 14 passed` (`const_400d_seven_day`, `seven_day_150d_short`, `const_400d_simple_sum`); restored, 17 passed.
- Count: `returns.dropna()` instead of `headline.dropna()` -> `E assert 99 == 60`, `FAILED ...test_record_observations_counts_the_headline_suffix_of_a_chain_broken_series`; restored, 17 passed.
- TS window constant: `THREE_MONTH_WINDOW_DAYS = 90` -> three window vectors and the text-read pin RED; restored.

## Golden file: hand derivation

Input `golden_252d_input.json`: 252 weekday returns, 2025-01-01 .. 2025-12-18, no weekend print. Derived with a script that uses only `json`, `math`, `datetime` (never `compute_all_metrics`; `/private/tmp/.../scratchpad/derive_golden.py`):

- VaR/CVaR: n = 252, k = floor(0.05 x 252) = 12; VaR = sorted[12] = -0.02211952201971554; CVaR = mean(sorted[0:12]) = -0.028192093685001335.
- 3M: cutoff 2025-09-18 (last - 91 d), 65 weekday returns after it, compounded = 0.08730672162017328 (the record starts 2025-01-01, far before the cutoff, so covered).
- 6M: cutoff 2025-06-19 (last - 182 d), 130 returns, compounded = 0.020780202832033634.
- `record_observations` = 252 (the input's own return count).
- Then `test_metrics_parity_full` was run against the file and passed, so the hand values equal what the producer writes to the last digit.

Golden diff: `var_1d_95`, `cvar`, `three_month`, `six_month_return` re-derived, `record_observations` added, and `figure_defs_version: 2` added (see deviation 2). Nothing else changed.

## Task Commits

1. **Task 1 (tracer): one VaR/CVaR definition end to end** - `dbbc95eae`
2. **Task 2: calendar 3M/6M, 91-day engine, observation count** - `a3f53cf14`
3. **Task 3: re-derive pins, golden, full gates** - `9f85c00dc`

## Gates

- `pytest tests/test_figure_parity.py`: 17 passed.
- Full `pytest` (analytics-service/): 14376 passed, 101 skipped, 1 failed. The one failure is `test_xdist_group_is_real` (`unrecognized arguments: -n --dist`; `pytest-xdist` is not installed in this Python; environmental, in `deferred-items.md`).
- `mypy --strict` as CI runs it: `Success: no issues found in 132 source files` (one `no-any-return` in the new window helper was found and fixed).
- `npm run typecheck`: clean. `npm run lint`: 0 errors (2 pre-existing unused-var warnings in files this plan did not touch).
- `npx vitest run src/lib`: 7175 passed, 26 skipped, 2 failed. The 2 are `compute.conventions.test.ts` fixture B and C (`skew` differs in the 17th digit); they fail identically with the 3M constant set back to 90, nothing this plan changed feeds `skew`, logged in `deferred-items.md`. `src/__tests__/metrics-parity.test.ts`: 19 passed.

## Deviations from Plan

**1. [Rule 3 - Blocking] `node_modules` missing in the linked worktree.** Symlinked the main checkout's `node_modules` into the worktree root (gitignored by `/node_modules`, not tracked). The main checkout's `package.json` may lag the branch by a few deps; vitest, tsc and lint all ran green.

**2. [Rule 1 - Bug] Existing pins on the old definitions.** Moving 3M from 90 to 91 days broke `compute.arithmetic-buckets.test.ts` and `compute.metrics.test.ts` (cutoff 2026-04-01 -> 2026-03-31, boundary starts); `src/__tests__/metrics-parity.test.ts` pinned 6M to the last 126 rows; `test_metrics_headline_suffix.py` used a 140-row daily tail that cannot cover a 182-day window (now `tail200`). Each pin was re-derived deliberately (91/182 calendar days), none loosened. Commits `a3f53cf14` and `9f85c00dc`.

**3. [Rule 2 - Missing critical] `figure_defs_version` added to the golden file.** The parity comparator fails on extra keys, so the new marker had to be in `golden_252d_expected.json` too; the plan named only `record_observations`.

**4. `test_qstats_gate.py` not edited.** The plan listed it for a `value_at_risk` call that asserts the stored key comes from quantstats. The `value_at_risk`/`cvar` mentions there are synthetic needle sources for the gate's own self-tests; nothing asserts the stored key. Gate passes unchanged.

**5. Plan verify not literally green.** Task 2's `npx vitest run src/lib/factsheet` and Task 3's `npx vitest run src/lib` exit non-zero only because of the pre-existing `skew` failures above; everything else in them is green.

**6. Window-vector wording.** The plan's "Monday after a Saturday cutoff" cannot occur on 91/182-day windows for a weekday last date (cutoff has the same weekday as the last date), so the vectors use a Friday cutoff with a Monday start (covered) and Tuesday start (not), plus the 1 January skip.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Files exist (`figure_parity_vectors.json`, `test_figure_parity.py`, `figure-parity.test.ts`, `deferred-items.md`); commits `dbbc95eae`, `a3f53cf14`, `9f85c00dc` are ancestors of HEAD.
