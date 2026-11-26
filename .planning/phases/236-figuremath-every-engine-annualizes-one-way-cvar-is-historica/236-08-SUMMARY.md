---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 08
subsystem: parity-oracle
tags: [parity, oracle, cagr, sharpe, twr, fig-02, proof-01]
requires: [236-04, 236-05, 236-06, 236-10, 236-11]
provides:
  - "annualization_parity_vectors.json: four closed-form vectors (24/7 crypto, weekday gaps, broken-chain suffix, emptied stretch) read by both languages"
  - "test_annualization_parity.py: 37 arms over five Python engines"
  - "annualization-parity.test.ts: 63 arms over six TS engines"
affects: [236-09]
key-files:
  created:
    - analytics-service/tests/fixtures/annualization_parity_vectors.json
    - analytics-service/tests/test_annualization_parity.py
    - src/__tests__/annualization-parity.test.ts
  modified: []
decisions:
  - "computeScenario (twr, cagr at 5 decimals; sharpe at 3) and sampleBasisRatios (sharpe at 3) round their own output, so rtol 1e-9 cannot hold against them. They are compared for EXACT equality with the oracle rounded the same way, behind a guard arm that the oracle is further from a rounding tie than the derived float bound. The tolerance was not widened and no toBeCloseTo was used"
  - "The holding-compare entry measured is analyzeSignedReturns (sharpe and cumulative_return), not analyzePriceSeries, which drops any return across a non-adjacent day and so breaks by design on the weekday and emptied vectors"
  - "The shared return-stats sharpe that sample-basis-ratios calls has its own unrounded arm at the full 1e-9, so the rounded arm is not the only coverage of that math"
metrics:
  completed: 2026-11-25
status: complete
actuals:
  tokens: 9400
  tasks: 2
  commits: 2
plan_head_before: a5c546583e3b9610a50f06986d362561e32b2baf
plan_head_after: 584999adbb803e74e1e1abbb69b982dec843c301
---

# Phase 236 Plan 08: independent-oracle parity across every engine Summary

Every engine in both languages reports the same CAGR, Sharpe and TWR for the same series: eleven engine entry points agree with one closed-form oracle on four vectors, within rtol 1e-9 and atol 0 (exact equality for the three that publish rounded figures). No engine disagreement was found.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 428ebceec | The shared fixture and the Python half: five Python engines on four vectors |
| 2 | 584999adb | The TS half: six TS engines on the same fixture, the broken-chain input arms |

## The vectors

Series: the repeating pair [+0.02, -0.01] over an even `n`, phase 0. Mean 0.005, sample sd 0.015 * sqrt(n/(n-1)), Sharpe = 0.005 / sd * sqrt(P), TWR = (1.02 * 0.99)^(n/2) - 1, CAGR = (1 + TWR)^(365/span) - 1. Expected numbers were computed once by a scratch script importing nothing from the repo, never from an engine, and written into the JSON with the derivation in each vector's `_comment`.

| Vector | n | P | span (days) | What it exercises | Sharpe | TWR | CAGR |
|---|---|---|---|---|---|---|---|
| crypto_24_7 | 730 | 365 | 729 | consecutive calendar days | 6.3639610306789285 | 34.148655830681676 | 4.943122124984882 |
| weekday_gaps | 520 | 252 | 725 | weekends have no row, span != n-1 (519) | 5.286412190337966 | 11.623949642874052 | 2.5842215917455342 |
| broken_chain_suffix | 300 | 365 | 299 | 200-day prefix of [+0.05, -0.02], ONE NaN day, then the 300-day suffix; only the suffix is the oracle | 6.3577016578611465 | 3.3182218831474293 | 4.964025507878934 |
| emptied_stretch | 400 | 365 | 499 | 100 calendar days with no row between obs 200 and 201; chain not broken; span includes the stretch (Q1) | 6.360359004542643 | 6.031909485752926 | 3.1648819275271673 |

No vector uses an unknown-class leg. The clock is taken through the production mapping by class (`blend_periods_per_year(["crypto"])` and `(["traditional"])` in Python, `annualizationPeriods` and `blendPeriodsPerYear([{ asset_class }])` in TS), and an arm asserts each equals the fixture's literal P.

## Engines compared (all GREEN)

| Language | Engine | Metrics | Input |
|---|---|---|---|
| Python | `compute_all_metrics` | sharpe, cagr, cumulative_return | the whole chain (it cuts at the break itself) |
| Python | `portfolio_optimizer._compute_sharpe` (match path) | sharpe | the clean suffix |
| Python | `sharpe_vol_status_from_backbone` (portfolio-analytics path) | sharpe, status `ok` | the clean suffix |
| Python | `cumulative_twr_segmented` | twr | the whole chain |
| Python | `total_return_from_equity` | twr | an equity series with a 1.0 base point the day before the first observation |
| TS | `compute()` | sharpe, cagr, cum_ret | the post-break suffix |
| TS | `computeScenario` (single leg, weight 1) | sharpe, cagr, twr | the suffix; exact equality at the engine's published precision |
| TS | `computeOgHeadline` (computed path, no stored row) | sharpe, cagr | the suffix |
| TS | the shared `return-stats` `sharpe` under sample-basis-ratios | sharpe, unrounded | the suffix |
| TS | `sampleBasisRatios` | sharpe; exact equality at 3 decimals | the suffix |
| TS | holding-compare-adapter `analyzeSignedReturns` | sharpe, cumulative_return | the suffix |

Counts: pytest `37 passed` (PY086), vitest `63 passed` (Node 22.22.1). Also run and green: `annualization-census.test.ts` and `figure-gate-census.test.ts` (18 passed), `test_annualization_census.py` (16 passed), `tsc --noEmit` (no output), `eslint` on the new test (no output).

## Tolerance

Stated in both headers. Every engine evaluates the same closed forms, so a difference is float summation order. The mean of n terms carries at most n * eps = 4.4e-13 (n <= 2000). The sample sd halves that. A Sharpe is a quotient of two such quantities (about 1e-12). The wealth ratio is a product of n factors (n * eps). CAGR raises it to 365/span, exponent at most 365/299 = 1.22, times the (1 + T)/T factor of subtracting 1 (T >= 3.3, so 1.31): conservative total 5.3e-12 for every metric. rtol 1e-9 is more than 100x that bound and far below any convention move (ddof 0 shifts a Sharpe by 1/(2(n-1)), 6.9e-4 at n = 730; 252 for 365 by a factor 1.2). The tolerance was not set by running an engine and was never edited.

## PROOF-01 (verbatim)

Order run: (a), (c), (b). Each: byte backup taken to the scratchpad, neutered copy in place, tests RED with the named arm, `cp` from the backup, `cmp` (no output on a mismatch; `RESTORED cmp OK` printed on a match), then GREEN.

**(a) one engine moved to 252 for the crypto vector.** `src/lib/factsheet/compute.ts`, line 188, `periodsPerYear` replaced by `periodsPerYear: 252` in the Sharpe call.
```
     × sharpe [crypto_24_7] 6ms
     × sharpe [broken_chain_suffix] 1ms
     × sharpe [emptied_stretch] 1ms
 FAIL  |jsdom| src/__tests__/annualization-parity.test.ts > compute() (the factsheet engine) > sharpe [crypto_24_7]
AssertionError: CONVENTION DIVERGENCE: engine=compute() metric=sharpe vector=crypto_24_7: got 5.2878770632094705, the closed-form oracle says 6.3639610306789285 (rtol=1e-9, atol=0; the tolerance is never widened): expected false to be true // Object.is equality
 Test Files  1 failed (1)
      Tests  3 failed | 60 passed (63)
RESTORED cmp OK
```
The weekday vector (P = 252) stays GREEN, as it must.

**(c) the TS input helper fed the full chain.** `tsEngineInput` in the test file, the suffix replaced by the full chain with the break day dropped.
```
     × [suffix-input] the TS input starts the day after the break and is exactly the suffix long 5ms
     × sharpe [broken_chain_suffix] 2ms
     × cagr [broken_chain_suffix] 2ms
     × twr(cum_ret) [broken_chain_suffix] 1ms
     ... (13 failed in all, every one on broken_chain_suffix)
AssertionError: first date of the TS input is the post-break date: expected '2023-01-01' to be '2023-07-21' // Object.is equality
AssertionError: CONVENTION DIVERGENCE: engine=compute() metric=cagr vector=broken_chain_suffix: got 22.44741520841127, the closed-form oracle says 4.964025507878934 (rtol=1e-9, atol=0; the tolerance is never widened): expected false to be true // Object.is equality
AssertionError: CONVENTION DIVERGENCE: engine=compute() metric=twr(cum_ret) vector=broken_chain_suffix: got 74.30822823860103, the closed-form oracle says 3.3182218831474293 (rtol=1e-9, atol=0; the tolerance is never widened): expected false to be true // Object.is equality
 Test Files  1 failed (1)
      Tests  13 failed | 50 passed (63)
RESTORED cmp OK
```
The suffix-input arm is the first failure. The arm `[full-chain-is-not-the-suffix]`, which feeds the full chain on purpose, stays GREEN under this neuter, as it must.

**(b) `_compute_sharpe` on ddof 0.** `analytics-service/services/portfolio_optimizer.py`, line 368, `ddof=SD_DDOF` replaced by `ddof=0`.
```
FAILED tests/test_annualization_parity.py::test_compute_sharpe_the_match_path[crypto_24_7]
FAILED tests/test_annualization_parity.py::test_compute_sharpe_the_match_path[weekday_gaps]
FAILED tests/test_annualization_parity.py::test_compute_sharpe_the_match_path[broken_chain_suffix]
FAILED tests/test_annualization_parity.py::test_compute_sharpe_the_match_path[emptied_stretch]
E   AssertionError: CONVENTION DIVERGENCE: engine=portfolio_optimizer._compute_sharpe metric=sharpe vector=crypto_24_7: got 6.368324391514266, the closed-form oracle says 6.3639610306789285 (rtol=1e-09, atol=0.0; the tolerance is never widened)
4 failed, 33 passed in 7.62s
RESTORED cmp OK
```

**GREEN after all three restores** (all three files byte-equal to HEAD, `git status --short` clean):
```
vitest: Test Files  1 passed (1) / Tests  63 passed (63)
pytest: 37 passed in 12.42s
```

## Deviations from Plan

**1. [Premise gap, no widening] Three TS engines round their own output.** The plan says every engine matches within rtol 1e-9. `computeScenario` publishes `twr` and `cagr` through `toFixed(5)` and `sharpe` through `toFixed(3)`, and `sampleBasisRatios` publishes `sharpe` through `toFixed(3)`: a 1e-9 relative comparison against a rounded number cannot hold, and loosening to the rounding step is the widening the plan forbids. Chosen within CONTEXT's "parity-oracle shape" discretion: exact equality with `Number(oracle.toFixed(k))`, plus a per-vector guard arm that the oracle is further from a rounding tie than `rtol * |oracle|`, so a summation-order difference can never flip the digit. This is stricter than a tolerance on the unrounded value, and a ddof 0 or 252-for-365 move is still caught (at n = 730 a ddof-0 Sharpe moves 4.4e-3, nine times the 5e-4 rounding step). The unrounded math under `sampleBasisRatios` is checked at the full 1e-9 through the shared `return-stats` `sharpe`. `computeScenario`'s `twr`/`cagr`/`sharpe` have no unrounded surface, so those three are checked at published precision only.

**2. [Entry point choice] holding-compare-adapter.** `analyzePriceSeries` takes a price path and keeps only returns across consecutive calendar days, so it drops returns on the weekday and emptied vectors by design (a tested rule of the adapter). `analyzeSignedReturns(returns, periodsPerYear)` is the same math (`dispersion`, `returnStatsSharpe` at `SD_DDOF`) over a return list and reports sharpe and cumulative_return, which are the metrics compared. The adapter reports no CAGR.

**3. [Own test bug, fixed before commit] `blendPeriodsPerYear` argument shape.** The first TS run failed one arm (`expected 365 to be 252`) because I passed strings; the TS helper takes `{ asset_class }` objects and read the strings as an unknown class (365). Fixed in the test. This is the known TS-unknown-leg-is-365 versus Python-unknown-leg-is-252 asymmetry the plan puts out of scope, and no vector carries an unknown class.

**4. [Interpreter] PY086.** The branch pins quantstats 0.0.86 and the shared main-checkout venv has 0.0.81, so a scratch venv was built from the worktree's `requirements.txt` plus `requirements-dev.txt` (`uv venv --python 3.12`, `uv pip install`), `quantstats.__version__ == "0.0.86"` asserted, and used for every pytest. The shared venv was not touched. The path is under the session scratchpad and is written into no tracked file.

## Findings

No engine disagreement. All eleven engine entry points matched the closed-form oracle on all four vectors on the first run, so no divergence is reported. `mypy` strict in CI covers `services/ routers/ models/`, not `tests/`, and no file under those was changed, so it was not re-run.

## Known Stubs

None.

## Threat Flags

None. T-236-17 mitigated (the oracle imports no production helper: generator, loop recompute and closed forms use `math`, `datetime`, `Date` and plain loops, and the constants are written out). T-236-18 mitigated (derived tolerance in both headers, PROOF-01 (a), (b) and (c) show a 252 clock, a ddof-0 engine and a full-chain feed each fail, and no tolerance was edited).

## Self-Check: PASSED

- `analytics-service/tests/fixtures/annualization_parity_vectors.json`: FOUND
- `analytics-service/tests/test_annualization_parity.py`: FOUND
- `src/__tests__/annualization-parity.test.ts`: FOUND (`grep -a -c "1e-9"` = 6, expected >= 1)
- commits 428ebceec and 584999adb are ancestors of HEAD
- `git status --short` after the last restore: clean; no tracked file rewritten by a test run
