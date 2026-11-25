---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 01
subsystem: figure-conventions
tags: [annualization, census, cross-language-pin, figure-defs-version]
requires: []
provides:
  - "analytics-service/services/figure_conventions.py and src/lib/figure-conventions.ts: the F-5/F-6 constant set (CALENDAR_DAYS_PER_YEAR 365, SD_DDOF 1, PERIODS_PER_YEAR_CRYPTO 365, PERIODS_PER_YEAR_TRADITIONAL 252, CVAR_MIN_OBS 60)"
  - "cross-language pin (vitest + pytest), exactly-once, failing by constant name"
  - "annualization census in both languages with negative and positive arms and an exact NOT_YET_MIGRATED list"
  - "FIGURE_DEFS_VERSION 3 in metrics.py and figure-gate.ts"
affects: [236-02, 236-03, 236-04, 236-05, 236-09, 236-10]
tech-stack:
  added: []
  patterns: ["text-read cross-language pin (figure-gate.test.ts pattern)", "tree-derived census with comment stripping (TS: hand scanner; Python: tokenize)"]
key-files:
  created:
    - analytics-service/services/figure_conventions.py
    - src/lib/figure-conventions.ts
    - src/lib/figure-conventions.test.ts
    - analytics-service/tests/test_figure_conventions.py
    - src/__tests__/annualization-census.test.ts
    - analytics-service/tests/test_annualization_census.py
  modified:
    - analytics-service/services/metrics.py
    - src/lib/figure-gate.ts
    - analytics-service/tests/test_figure_parity.py
    - analytics-service/tests/fixtures/golden_252d_expected.json
    - src/lib/factsheet/basis-metrics.test.ts
    - src/lib/factsheet/fetch-and-build-payload.test.ts
    - src/app/factsheet/[id]/tearsheet/page.stale-analytics.test.tsx
decisions:
  - "CALENDAR_DAYS_PER_YEAR is an int literal (365) so one regex shape reads every constant; Python callers use it in float arithmetic"
  - "CVAR_MIN_OBS is a separate constant from MIN_ANNUALIZATION_OBS (both 60) so retuning one never moves the other"
  - "golden_252d_expected.json figure_defs_version hand-edited 2 to 3 as a version marker, not a figure; regen_golden.py not run"
metrics:
  duration: "about 1h20m"
  completed: 2026-11-25
status: complete
actuals:
  tokens: 10450
  tasks: 3
  commits: 3
plan_head_before: 694ab6abc2b03605cc627c344dcc90bb88a03ec3
plan_head_after: 312f6cf3a8f253a931c023749699f3260228bc65
---

# Phase 236 Plan 01: FIGUREMATH convention spine Summary

One constant set per language, a cross-language pin, a tree-derived census of every annualizing site, and FIGURE_DEFS_VERSION 3 in both languages; every gate was neutered to RED and restored byte-exact.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 78c3e2b0a | constant modules + vitest/pytest pins (RED first: import unresolved in both, then GREEN 7/7 and 6/6) |
| 2 | 328c9c74a | TS and Python census with negative/positive arms, NOT_YET_MIGRATED |
| 3 | 312f6cf3a | version 2 to 3 in both languages, pinned literals moved, stale-name fix in the census |

Task 1 RED at HEAD, verbatim:
- vitest: `Error: Failed to resolve import "./figure-conventions" from "src/lib/figure-conventions.test.ts". Does the file exist?`
- pytest: `ImportError: cannot import name 'figure_conventions' from 'services'`

## Census as measured (counts are comment-stripped tokens)

TS (`src/`), tokens: `t365_25`, `ddof0`, `disp0` (`dispersion(x, 0)`), `ddof1`, `disp1`, `periodClockDef`.

| File | Class | Counts | must_use |
|---|---|---|---|
| src/lib/closed-sets.ts | engine | t365_25 1 | CALENDAR_DAYS_PER_YEAR, PERIODS_PER_YEAR_CRYPTO, PERIODS_PER_YEAR_TRADITIONAL |
| src/lib/scenario.ts | engine | ddof1 1, disp1 1 | SD_DDOF |
| src/lib/factsheet/compute.ts | engine | t365_25 1, ddof0 1, disp0 2 (1 exempt: moment, skew/kurtosis) | CALENDAR_DAYS_PER_YEAR, SD_DDOF |
| src/lib/factsheet/og-metrics.ts | engine | ddof0 1 | SD_DDOF |
| src/lib/factsheet/rolling.ts | engine | ddof0 1, disp0 1, ddof1 1, disp1 1 | SD_DDOF |
| src/lib/factsheet/joint.ts | engine | ddof0 1, disp0 3 (2 exempt: degeneracy) | SD_DDOF |
| src/lib/factsheet/bootstrap.ts | engine | ddof0 1 | SD_DDOF |
| src/app/(dashboard)/compare/lib/holding-compare-adapter.ts | engine | ddof0 2, disp0 2 | SD_DDOF |
| src/lib/sample-basis-ratios.ts | engine | ddof1 1 | SD_DDOF |
| src/lib/portfolio-stats.ts | engine | disp1 1 | SD_DDOF |
| src/app/(dashboard)/allocations/lib/scenario-benchmark.ts | engine | ddof1 1 | SD_DDOF |
| src/app/(dashboard)/allocations/lib/book-figures.ts | engine | periodClockDef 1 | PERIODS_PER_YEAR_CRYPTO |
| src/lib/return-stats.ts | definition | ddof0 2 (param type), disp0 4 (degeneracy: pearson and beta cancel the ddof) | none |
| src/lib/figure-conventions.ts | definition | periodClockDef 2 | none |
| scenario-stress.ts, AlphaBetaDecomposition.tsx | degeneracy | disp0 1 each (`sd === 0`) | none |

TS reviewed-token-free (checked to stay so): health-score.ts (consumer), scenario-blend-adapter.ts and scenario-factsheet-payload.ts (consumer), BatchDPanels.tsx and record-length.ts (display), figure-gate.ts (definition: `ONE_YEAR_DAYS` and `coveredDays` are a gate unit, not the CAGR span). The retired blend-panels module named in the L2214 list is a stale name (no such file); `scenario-backbone-gates.test.ts` already guards it and forbids any `src/` mention, so the census does not name it.

Python, tokens: `t365_25`, `ddof0`, `ddof1`, `sqrt_year`, `TRADING_DAYS`, `year_div`, `std_call` (census-only, not forbidden), `np_var_std`.

| File | Class | Counts | must_use |
|---|---|---|---|
| services/metrics.py | engine | std_call 17, sqrt_year 2 (the two smart_* `sqrt(252)`) | CALENDAR_DAYS_PER_YEAR, SD_DDOF, PERIODS_PER_YEAR_CRYPTO, PERIODS_PER_YEAR_TRADITIONAL, CVAR_MIN_OBS |
| services/portfolio_metrics.py | engine | t365_25 1 (XIRR) | CALENDAR_DAYS_PER_YEAR |
| services/portfolio_optimizer.py | engine | std_call 3 | SD_DDOF |
| services/allocated_capital.py | engine | ddof1 1, std_call 1 | SD_DDOF, PERIODS_PER_YEAR_CRYPTO (plan 236-03 records the final choice) |
| services/optimizer.py | engine | std_call 1, TRADING_DAYS 3 | none (negative arm: TRADING_DAYS absent) |
| services/match_engine.py | display | year_div 1 | none |
| services/csv_validator.py | diagnostic | ddof1 1, std_call 1 | none |
| services/dispersion.py, services/portfolio_risk.py | degeneracy | std_call 1, 3 | none |

Python reviewed-token-free: routers/portfolio.py, routers/match.py (consumers), equity_reconstruction.py (no annualizer at HEAD), parity_diff.py and mt5_parity_findings.py (`REANNUALIZATION_FACTOR` is a classifier of past moves), figure_conventions.py.

NOT_YET_MIGRATED at HEAD = every engine file, 12 in TS and 5 in Python, unchanged from the plan's expectation. Each fails at least one arm at HEAD (the exactness test would fail otherwise).

Unknown-leg finding (recorded as a comment in both census files, not as a figure): Python `blend_periods_per_year` maps an unknown leg to 252, TS `blendPeriodsPerYear` maps it to 365 (RANK-06, pinned by test_figure_gate_span.py). No Phase 236 decision covers it. The plan 236-08 parity vectors must not use an unknown leg.

## Golden version-marker decision

`golden_252d_expected.json` `metrics_json.metrics_json.figure_defs_version` was hand-edited 2 to 3 and nothing else in the file changed (`git diff`: 1 line). It is a version marker, not a figure; the Python math for the golden's CAGR/Sharpe is unchanged. `regen_golden.py` was not run.

## Pinned literals that meant "the current version" (moved in the version commit)

| File | Old | New | Reason |
|---|---|---|---|
| analytics-service/tests/test_figure_parity.py | `== FIGURE_DEFS_VERSION == 2` | `== FIGURE_DEFS_VERSION` | no literal; the value is pinned across languages by figure-gate.test.ts |
| src/lib/factsheet/basis-metrics.test.ts `stored()` | `figureDefsVersion: 2` | `FIGURE_DEFS_VERSION` | the helper stands for a current-version row (was red under 3) |
| same file | (none) | new case `FIGURE_DEFS_VERSION - 1` falls back to computed figures | T-236-02: a pre-236 v2 row is OLD by construction. The existing `1` case stays: it asserts an old row is OLD |
| src/lib/factsheet/fetch-and-build-payload.test.ts `ALIASES` | `figure_defs_version: 2` | `FIGURE_DEFS_VERSION` | seeded stored row meaning current (was red under 3) |
| src/app/factsheet/[id]/tearsheet/page.stale-analytics.test.tsx | `figure_defs_version: 2` | `FIGURE_DEFS_VERSION` | not red, moved so it cannot go stale at the next bump |

No figure was re-pinned.

## PROOF-01 (byte backups in the scratchpad, restored with cp, verified with cmp)

(a) Neuter: `sed` in `analytics-service/services/figure_conventions.py`: `PERIODS_PER_YEAR_CRYPTO = 365` -> `PERIODS_PER_YEAR_CRYPTO = 366`.
- `npx vitest run src/lib/figure-conventions.test.ts` RED: `× PERIODS_PER_YEAR_CRYPTO agrees across languages` / `AssertionError: PERIODS_PER_YEAR_CRYPTO differs between figure_conventions.py and figure-conventions.ts: expected 366 to be 365` / `Tests  1 failed | 6 passed (7)`
- `pytest tests/test_figure_conventions.py` RED: `AssertionError: PERIODS_PER_YEAR_CRYPTO differs between figure_conventions.py and figure-conventions.ts` / `2 failed, 4 passed`
- `cp` restore, `cmp OK (a)`, GREEN: `Tests  7 passed (7)`.

(b) Neuter: appended `const x = 365.25;` to `src/lib/figure-gate.ts` (a classified token-free file).
- `npx vitest run src/__tests__/annualization-census.test.ts` RED: `× a file reviewed as token-free still exists and has not gained a token` / `+ "src/lib/figure-gate.ts now carries {\"t365_25\":1}: move it to CENSUS"` / `Tests  1 failed | 8 passed (9)`
- `cp` restore, `cmp OK (b)`, GREEN: `Tests  9 passed (9)`.

(c) Neuter: appended `_ = 365.25` to `analytics-service/services/closed_sets.py`.
- `pytest tests/test_annualization_census.py` RED: `E  Left contains one more item: "analytics-service/services/closed_sets.py {'t365_25': 1}"` / `FAILED tests/test_annualization_census.py::TestCensusSet::test_every_token_file_is_classified` / `1 failed, 13 passed`
- `cp` restore, `cmp OK (c)`, GREEN: `14 passed`.

(d) Neuter: `analytics-service/services/metrics.py` `FIGURE_DEFS_VERSION = 3` -> `FIGURE_DEFS_VERSION = 2` alone.
- `npx vitest run src/lib/figure-gate.test.ts` RED: `× MIN_ANNUALIZATION_DAYS, MIN_ANNUALIZATION_OBS and FIGURE_DEFS_VERSION agree` / `AssertionError: expected 2 to be 3` / `Tests  1 failed | 48 passed (49)`
- `cp` restore, `cmp OK (d)`, GREEN: `Tests  49 passed (49)`.

(e) Neuter: golden `"figure_defs_version": 3,` -> `"figure_defs_version": 2,` alone.
- `pytest tests/test_metrics_parity.py` RED: `AssertionError: metrics_json.metrics_json.figure_defs_version: scalar mismatch (12-sig-digit + 1e-12 epsilon fallback): expected 2, got 3` / `FAILED tests/test_metrics_parity.py::test_metrics_parity_full` / `1 failed, 34 passed`
- `cp` restore, `cmp OK (e)`, GREEN: `35 passed`.

`git status --short` was empty after every restore.

## Verification

- `npx vitest run src/lib src/__tests__/annualization-census.test.ts src/__tests__/metrics-parity.test.ts`: 307 of 308 files pass, 8159 tests pass, 2 fail (see Deferred).
- `pytest tests/test_figure_conventions.py tests/test_annualization_census.py tests/test_metrics.py tests/test_figure_parity.py tests/test_metrics_parity.py`: 346 passed.
- `pytest -k "figure_defs or overlay or parity or golden"` (whole suite): 780 passed, 1 skipped (pre-existing skip, not introduced here).
- CI mypy strict (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 144 source files`.

## Deviations from Plan

**1. [Rule 2 - census precision] Counter refinements (all within the plan's "census mechanism" discretion).**
- TS `disp0`/`disp1` regex allows one level of nested parentheses (`dispersion(a.slice(0, n), 0)`); the plan's `[^()]*` missed the `pearson` calls. Cross-checked against a raw per-line grep: counts agree file for file.
- Added TS token `periodClockDef` (`\w*PERIODS_PER_YEAR\w*\s*=\s*365|252`) because `book-figures.ts` (a plan-named engine) carries none of the plan's tokens and so could not be a census key.
- Python: added `std_call` (census-only) so `portfolio_optimizer.py` (plan-named engine, no other token) is listed, plus `np_var_std` (zero hits); `year_div` carries a lookahead so `/ 365.25` is one hit, not two; files come from `git ls-files --cached --others --exclude-standard` so a new untracked file is seen.
- Added `REVIEWED_NO_TOKEN` maps in both census files for the plan-named files that carry no token (routers, consumers, display files), each asserted to exist and to stay token-free.
- Added `exempt` sub-site records so a single file can hold an engine site and a `moment` / `degeneracy` site (compute.ts, joint.ts) and the negative arm subtracts exactly the exempt count.
- Python census adds three non-plan files by measurement: csv_validator.py (diagnostic), dispersion.py and portfolio_risk.py (degeneracy).

**2. [Rule 1 - own test broke another gate] Stale-name entry removed.** The first TS census listed the retired blend-panels module as a stale name; `scenario-backbone-gates.test.ts` (SC-2) forbids any `src/` mention and went RED. Entry and the `absent` mechanism removed in the version commit; the stale name is now only described in prose without the forbidden token.

**3. [Rule 3 - environment] `npm ci --no-audit --no-fund` ran in the worktree (no node_modules); lockfile untouched.**

## Deferred Issues

- `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C ("compute() with no conventions argument is byte-identical ...") fail on a last-digit float difference of `skew` (`-0.11360716852722537` vs `-0.11360716852722538`, `0.036844507138639` vs `0.036844507138638946`). `compute.ts` and that test are untouched by this plan; the cause is `Math.pow` precision on this machine's Node build. Out of scope; logged in `deferred-items.md`. Not re-pinned.
- A full `src/lib src/__tests__` vitest run launched while pytest ran concurrently showed extra timeouts (`return-stats.single-source.test.ts`, 5000 ms) and two UI failures that all pass in isolation and in the quiet final run. Load-dependent, not caused by this plan.

## Known Stubs

None.

## Threat Flags

None. No new network, auth or file-access surface. T-236-01, T-236-02 and T-236-03 are mitigated and proven by PROOF-01 (a) to (e).

## Self-Check: PASSED

All six created files exist, commits 78c3e2b0a, 328c9c74a and 312f6cf3a are ancestors of HEAD, and `commits: 3` is measured from the plan ledger (`694ab6abc..312f6cf3a`).
