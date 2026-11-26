---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 04
subsystem: weight-optimizer-and-xirr
tags: [blend-clock, optimizer, xirr, census, trust-boundary]
requires: [236-03]
provides:
  - "optimizer.py: _annualized_moments(returns, periods_per_year); optimize_weights(..., *, periods_per_year) with no default; TRADING_DAYS deleted"
  - "OptimizeWeightsRequest.periods_per_year: Literal[252, 365], required (422 on missing or out-of-set)"
  - "POST /api/scenario/optimize validates periods_per_year in {252, 365} (400 VALIDATION_FAILED) and forwards it; optimizeScenarioWeights(series, objective, periodsPerYear, tenant)"
  - "WeightOptimizerSection sends blendPeriodsPerYear(strategies); ScenarioComposer passes each leg's asset_class"
  - "portfolio_metrics.compute_mwr: t_years divides by CALENDAR_DAYS_PER_YEAR (365)"
  - "Python census NOT_YET_MIGRATED is now empty"
affects: [236-05, 236-08, 236-09, 236-10]
tech-stack:
  added: []
  patterns: ["pin the threaded value at each hop when the objective is scale-invariant", "stdlib bisection as an independent IRR oracle"]
key-files:
  modified:
    - analytics-service/services/optimizer.py
    - analytics-service/models/schemas.py
    - analytics-service/routers/optimizer.py
    - analytics-service/services/portfolio_metrics.py
    - analytics-service/tests/test_optimizer.py
    - analytics-service/tests/test_optimizer_route.py
    - analytics-service/tests/test_optimizer_parity.py
    - analytics-service/tests/test_dispersion_floor_sites.py
    - analytics-service/tests/test_portfolio_metrics.py
    - analytics-service/tests/test_e2_parity_oracle.py
    - analytics-service/tests/test_annualization_census.py
    - src/lib/analytics-client.ts
    - src/lib/analytics-client.test.ts
    - src/lib/resilient-fetch.wiring.test.ts
    - src/app/api/scenario/optimize/route.ts
    - src/app/api/scenario/optimize/route.test.ts
    - "src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx"
    - "src/app/(dashboard)/allocations/components/WeightOptimizerSection.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
decisions:
  - "The clock is the third positional argument of optimizeScenarioWeights (before the tenant), required, so every caller must state it and a sed-able single-line change covered the 12 existing call sites"
  - "periods_per_year is validated right after objective in the route, with `typeof number` first, so the string \"365\" cannot pass by coercion"
  - "test_optimizer_parity.py pins the shared fixture's trading_days against PERIODS_PER_YEAR_TRADITIONAL (the optimizer owns no clock constant any more); the fixture and the TS twin are untouched"
metrics:
  duration: "about 1h"
  completed: 2026-11-25
status: complete
actuals:
  tokens: 13000
  tasks: 3
  commits: 3
plan_head_before: d2c154532b5d1e318a1fbf94d80d4a153312899d
plan_head_after: ee32361808db96deaa056f7cd040a7873e062e25
---

# Phase 236 Plan 04: optimizer blend clock and XIRR 365 Summary

The weight optimizer annualizes on the blend's frequency clock threaded from the Scenario composer through the route, the analytics client and the pydantic request, and XIRR moves to the named 365-day year with hand-derived pins; each gate was neutered to RED and restored byte-exact.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | d2eedf12e | `_annualized_moments`, required `periods_per_year`, `TRADING_DAYS` deleted, `Literal[252, 365]` request field, router pass-through, every Python caller, optimizer.py leaves `NOT_YET_MIGRATED` |
| 2 | 5ae3bdf0c | route validation (400) and forward, `optimizeScenarioWeights` carries the clock, panel sends `blendPeriodsPerYear`, composer passes `asset_class` |
| 3 | ee3236180 | `t_years / CALENDAR_DAYS_PER_YEAR`, moved XIRR pins, E2 oracle on 365, portfolio_metrics.py leaves `NOT_YET_MIGRATED` |

RED at HEAD. Task 1: collection error `ImportError: cannot import name '_annualized_moments' from 'services.optimizer'`, 7 route cases (`test_the_route_hands_the_request_clock_to_the_optimizer[252|365]`, five `test_the_route_rejects_a_missing_or_out_of_set_clock`), and the S6 constant-column test x 11 params (`TypeError`, 18 failed in all). Task 2: 13 failed (route clock-forward and clock-rejection cases, five `sends the blend clock in the request body` cases) and the composer `WR-01 wiring` test (`classOf["p61-key-A"]` undefined). Task 3: 4 failed (the three XIRR pins and `test_oracle_8_withdrawal_dominant_mwr_includes_terminal`: `assert -27.768007671915175 == 0.0 ± 0.01`).

## Scale-invariance note (for the reviewer)

`optimize_weights` returns weights only. min_vol minimizes w'Sw and the max_sharpe ratio carries the clock as a constant factor (sqrt(T)), so both objectives are invariant to a positive scale of the covariance and the mean. The change therefore moves no suggested weight beyond solver tolerance; `test_the_clock_moves_no_suggested_weight` pins exactly that (365 vs 252, both objectives, `abs=1e-3`). The decision is locked (CONTEXT A5), so it is implemented in full and the gate pins the threaded value at each hop: `_annualized_moments` scales by exactly the clock (hand mean 0.02 x 365 = 7.3), `optimize_weights` hands its clock to the helper (monkeypatch spy), the router hands `req.periods_per_year` to `optimize_weights` (spy), the route forwards it to the client (mock), and the panel sends `blendPeriodsPerYear(strategies)`.

## Moved XIRR pins (old -> new -> why)

| Test | Old | New | Derivation of the new value |
|---|---|---|---|
| `test_mwr_known_sequence` | 0.15636675 | 0.15625176 | Independent stdlib bisection (200 halvings of [0, 1], no engine import) on `-100000 - 50000/(1+r)^(151/365) + 170000/(1+r)^(364/365) = 0` (day spans 151 and 364). The same bisection with the old year reproduces the old pin 0.15636675, which validates the method. |
| `test_mwr_single_outflow_one_year_exact_irr` | 0.10007186 | 0.10 | Hand-solved: 365 days over 365 is exactly 1, so `1 + r = 110000/100000`, r = 0.10. |
| `test_mwr_terminal_not_double_counted_when_net_cf_nonnegative` | 0.10007181 | 0.10 | Same hand solve (2025-01-01 to 2026-01-01 is 365 days). |
| `test_e2_parity_oracle` oracle 8 | year divisor 365.25 | year divisor 365.0 (literal, shares nothing with the engine constant) | The oracle's NPV at the solved rate must use the engine's year; tolerance `abs=1e-2` unchanged. |

Tolerances were not loosened; `regen_golden.py` was not run.

## PROOF-01 (byte backups in the scratchpad, restored with cp, verified with cmp)

Task 1. Neuter in `services/optimizer.py` `_annualized_moments`:
`ledoit_wolf_shrinkage(returns) * periods_per_year,` / `returns.mean(axis=0) * periods_per_year,` -> `ledoit_wolf_shrinkage(returns) * 252,` / `returns.mean(axis=0) * 252,`.
- `pytest tests/test_optimizer.py -q -p no:cacheprovider` RED: `E         comparison failed` / `FAILED tests/test_optimizer.py::test_annualized_moments_scale_by_the_threaded_clock` / `1 failed, 18 passed`. (The hop spy test stays GREEN under this neuter by design: it pins the argument, and the helper test pins the scaling.)
- `cp` restore, `cmp` OK (`CMP_OK`); GREEN: `19 passed`.

Task 2. Neuter in `src/app/api/scenario/optimize/route.ts`: `periodsPerYear as 252 | 365,` -> `252,` (the route stops forwarding the field).
- `npx vitest run src/app/api/scenario` RED: `FAIL ... forwards periods_per_year=365 to the analytics client unchanged` / `AssertionError: expected 252 to be 365 // Object.is equality` / `Tests  1 failed | 57 passed (58)`.
- `cp` restore, `cmp` OK (`CMP_OK`); GREEN: `Tests  58 passed (58)`.

Task 3. Neuter in `services/portfolio_metrics.py`: `(d - t0).days / CALENDAR_DAYS_PER_YEAR for d, _ in parsed` -> `(d - t0).days / 366 for d, _ in parsed`.
- `pytest tests/test_portfolio_metrics.py tests/test_e2_parity_oracle.py tests/test_annualization_census.py` RED, hand-solved pin first: `FAILED tests/test_portfolio_metrics.py::test_mwr_known_sequence`, `::test_mwr_single_outflow_one_year_exact_irr`, `::test_mwr_terminal_not_double_counted_when_net_cf_nonnegative`, `FAILED tests/test_e2_parity_oracle.py::test_oracle_8_withdrawal_dominant_mwr_includes_terminal`, and the census positive arm names the file: `Left contains one more item: 'analytics-service/services/portfolio_metrics.py: never uses CALENDAR_DAYS_PER_YEAR'` / `FAILED tests/test_annualization_census.py::TestEngineArms::test_positive_arm` / `5 failed, 42 passed`.
- `cp` restore, `cmp` OK (`CMP_OK`); GREEN: `47 passed`.

## Verification

- Python: `tests/test_optimizer.py tests/test_optimizer_route.py tests/test_optimizer_parity.py tests/test_dispersion_floor_sites.py tests/test_limiter_identity.py tests/test_tenant_claim_parsing.py` 251 passed (Task 1); census 16 passed; Task 3 trio 47 passed. Full `analytics-service/tests`: the first 89% of the run (alphabetical) all green before the 580 s cap, and the last 45 files re-run separately: `784 passed, 15 skipped`.
- mypy strict (the CI command) after Task 1 and Task 3: `Success: no issues found in 144 source files`.
- Vitest: `src/app/api/scenario`, the allocations components, `src/lib/analytics-client`, `src/lib/resilient-fetch`, `src/lib/seam*`, `figure-gate-census`, `annualization-census`: 93 files, 2635 passed. `npx tsc --noEmit -p tsconfig.json`: clean.
- Acceptance greps: `grep -a -c '^TRADING_DAYS' optimizer.py` 0; `grep -a -c periods_per_year route.ts` >= 1; `grep -a -c 365.25 portfolio_metrics.py` 0; `grep -a -c CALENDAR_DAYS_PER_YEAR portfolio_metrics.py` 4.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Callers the plan's file list did not name**
- **Found during:** Task 1 and Task 2 (grep of every `optimize_weights` / `optimizeScenarioWeights` caller, as the plan's own "every caller" truth requires)
- **Issue:** `tests/test_optimizer_parity.py` imports the deleted `TRADING_DAYS`; `tests/test_optimizer_route.py` posts bodies without the now-required field; `src/lib/analytics-client.test.ts` (10 calls) and `src/lib/resilient-fetch.wiring.test.ts` (1 call) call `optimizeScenarioWeights` with the old arity (tsc and 422s otherwise).
- **Fix:** parity test pins the fixture's `trading_days` against `PERIODS_PER_YEAR_TRADITIONAL` (fixture and TS twin untouched); route tests send the field and gain clock-forward and clock-rejection cases (422 for missing, 300, 0, 253, "365"); the client tests pass `252` as the new third argument.
- **Files modified:** the four files above.
- **Commits:** d2eedf12e, 5ae3bdf0c.

**2. [Rule 3 - Blocking] Census shrink for optimizer.py moved into Task 1**
- **Issue:** deleting `TRADING_DAYS` changes optimizer.py's recorded token counts, which reddens `test_per_file_counts_equal_recorded` in the Task 1 commit, so the census entry (counts `{"std_call": 1}`, reason) and the `NOT_YET_MIGRATED` removal for optimizer.py landed with Task 1 instead of Task 3. portfolio_metrics.py followed in Task 3 as planned.
- **Commit:** d2eedf12e.

**3. [Rule 3 - Note] PROOF-01 neuter for the route**
- The route neuter replaces the forwarded value with the constant `252` rather than deleting the argument (the third positional parameter is required, so deleting it would fail tsc, not the test). The effect is the same: the route stops forwarding the field.

No architectural changes, no auth gates, no package installs.

## Known limits and notes for later plans

- The Python `NOT_YET_MIGRATED` list is empty after this plan (it held only these two files). Plan 236-09's "asserts it empty" is already satisfied for Python; plan 236-10 has no Python entries left to shrink.
- The route forwards a request-level `periods_per_year` that a forged client could set to 252 on a crypto blend (T-236-09, accepted by plan): it can only change the label of the clock, never the weights (scale invariance).
- `deferred-items.md` entry from 236-01 (`compute.conventions.test.ts` last-digit skew on this machine) is not touched here.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the closed-set field, validated at both boundaries (T-236-09).

## Self-Check: PASSED

- Commits d2eedf12e, 5ae3bdf0c, ee3236180 are ancestors of HEAD.
- Files named in key-files exist (all modified in the three commits).
