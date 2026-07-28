---
phase: 34-asset-class-aware-annualization
plan: 01
subsystem: analytics
tags: [quantstats, annualization, metrics, python, golden-parity, pytest, mypy]

# Dependency graph
requires:
  - phase: 12-backend-metric-contracts
    provides: compute_all_metrics + golden_252d parity fixture + MetricsResult dataclass
provides:
  - "DEFAULT_PERIODS_PER_YEAR = 252 module-level constant (single source of truth for the annualization basis)"
  - "compute_all_metrics(periods_per_year: int = 252) param threaded through every genuine annualization site"
  - "Latent per-asset annualization plumbing: a future divergence is now a one-line call-site change"
  - "test_periods_param_rescales_365 — falsifiable threading guard proving the param actually rescales output"
affects: [phase-35-per-key-dailies, phase-36-overview-reads, phase-37-composer-toggle, equity_reconstruction-convergence-ANNUAL-05]

# Tech tracking
tech-stack:
  added: []  # no new deps — quantstats==0.0.81 already pinned
  patterns:
    - "Single-source annualization constant (mirrors optimizer.py TRADING_DAYS=252)"
    - "Thread the annualization factor, keep the rolling WINDOW length separate"
    - "In-test parametrized recompute as the rescale proof (no new golden_365 fixture — no fixture drift)"

key-files:
  created:
    - .planning/phases/34-asset-class-aware-annualization/34-01-SUMMARY.md
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/tests/test_metrics_parity.py
    - analytics-service/tests/test_metrics.py

key-decisions:
  - "rolling_greeks is NOT an annualization site in quantstats 0.0.81 — its `periods` arg is the rolling WINDOW and rolling alpha is unannualized; only scalar greeks() annualizes alpha (RESEARCH correction)"
  - "info_ratio rescales by sqrt(365/252) NOT linearly — the numerator periods cancels with the TE sqrt(periods) (RESEARCH correction)"
  - "No asset-class resolver built — the =252 default satisfies ANNUAL-02 since both production callers resolve 252 (Rule 2)"
  - "No production caller edited — analytics_runner.py inherits the 252 default"

patterns-established:
  - "DEFAULT_PERIODS_PER_YEAR as the one place the basis lives; every site reads it via the threaded param"
  - "Falsifiable mutation-verified proof: reverting any threaded site to a literal 252 turns the 365-proof RED"

requirements-completed: [ANNUAL-01, ANNUAL-03, ANNUAL-04]

# Metrics
duration: 47min
completed: 2026-06-24
---

# Phase 34 Plan 01: Explicit unified annualization (252) Summary

**Threaded an explicit `periods_per_year: int = 252` through every genuine annualization site in `metrics.py` (backed by one `DEFAULT_PERIODS_PER_YEAR` constant), keeping the default-252 output byte-identical, and added a mutation-verified 365-rescale proof that catches any silent threading hole.**

## Performance

- **Duration:** ~47 min
- **Started:** 2026-06-24T12:57Z (approx)
- **Completed:** 2026-06-24T13:13Z
- **Tasks:** 2
- **Files modified:** 3 (1 production, 2 test)

## Accomplishments

- `DEFAULT_PERIODS_PER_YEAR = 252` single source of truth added near the top of `metrics.py` (mirrors the `optimizer.py:TRADING_DAYS = 252` precedent).
- `compute_all_metrics` gained a typed `periods_per_year: int = DEFAULT_PERIODS_PER_YEAR` keyword-default param, threaded through **8 genuine annualization sites**: scalar `cagr`/`volatility`/`sharpe`/`sortino` (`periods=`), scalar `greeks` alpha (`periods=`), tracking-error `np.sqrt(periods_per_year)`, `info_ratio` `* periods_per_year`, and the three rolling `np.sqrt` helpers (`_rolling_sharpe`/`_rolling_sortino_from_components`/`_rolling_volatility`) plus their thin-wrapper signatures and all call sites inside `compute_all_metrics`.
- Zero `np.sqrt(252)` literals remain in `metrics.py`; the `! grep` guard passes.
- Default-252 output is byte-identical to today — `golden_252d_expected.json` untouched on disk, `test_metrics_parity_full` green, TS oracle (`metrics-parity.test.ts`) green (19/19).
- `test_periods_param_rescales_365` proves the param actually rescales: sqrt-class on golden (`sharpe`/`sortino`/`volatility` × √(365/252)), geometric CAGR with a negative control, and a synthetic aligned benchmark proving `alpha` (linear ×365/252), `info_ratio` (√-scaled), and `beta` (invariant) — closing the greeks-alpha (#5) and info_ratio (#6/#7) holes golden_252d cannot. Mutation-verified RED when a site is reverted.
- `mypy --strict` clean on `metrics.py`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add DEFAULT_PERIODS_PER_YEAR + thread periods_per_year through the annualization sites** — `1ab90333` (feat)
2. **Task 2: Add the parametrized periods_per_year=365 rescale proof + fix stale stub** — `2a56f097` (test)

_Note: TDD plan — Task 1's GREEN gate is the unchanged `test_metrics_parity_full`; Task 2 is the new falsifiable proof. Mutation-verified both directions._

## Files Created/Modified

- `analytics-service/services/metrics.py` — added the constant + param; threaded it through 8 annualization sites and 6 rolling-helper signatures/call sites; documented why `rolling_greeks` (site #8) is deliberately NOT threaded.
- `analytics-service/tests/test_metrics_parity.py` — added `numpy`/`pandas` imports + `test_periods_param_rescales_365` (the real threading guard).
- `analytics-service/tests/test_metrics.py` — fixed the `counting_from_components` monkeypatch stub to forward the new `periods_per_year` kwarg (`**kwargs`).
- `.planning/phases/34-asset-class-aware-annualization/34-01-SUMMARY.md` — this file.

## Decisions Made

- **rolling_greeks (site #8) is NOT an annualization site.** In quantstats 0.0.81 `rolling_greeks(returns, benchmark, periods=252)` uses `periods` as the rolling **window** length, and the source explicitly comments "Calculate rolling alpha (not annualized for rolling version)". The original production call `rolling_greeks(.., window)` was already passing `window` as that arg correctly. Threading `periods_per_year` there would corrupt the rolling-window length, not annualize anything — so it was reverted. Only the **scalar** `greeks()` annualizes alpha (`alpha *= periods`), which is correctly threaded at site #5.
- **info_ratio rescales by √(365/252), not linearly.** `info_ratio = excess.mean()*periods / te` with `te = excess.std()*sqrt(periods)`; the numerator `periods` cancels with the `sqrt(periods)` in TE down to `sqrt(periods)`. The proof asserts the √ ratio (empirically 1.2035, verified < 1e-12).
- **No asset-class resolver** (ANNUAL-02 satisfied by the `=252` default; both production callers resolve 252) and **no production caller edited** — per Rule 2/3 and the plan.
- **`compute_sharpe` / `equity_reconstruction` convergence (ANNUAL-05) is OUT OF SCOPE for this plan** — this plan's frontmatter is `requirements: [ANNUAL-01, ANNUAL-03, ANNUAL-04]` only. `compute_sharpe` was not touched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] rolling_greeks is not an annualization site (RESEARCH error → I introduced a real bug, then root-caused and reverted)**
- **Found during:** Task 1 (running the parity test after threading all sites the RESEARCH listed)
- **Issue:** The RESEARCH (written against a py3.14 quantstats source) claimed `rolling_greeks` annualizes alpha via `periods` and listed it as site #8 to thread. Following that, I added `periods=periods_per_year` to `rolling_greeks(.., window, ...)`, which (a) collided with the existing positional `window` arg → `TypeError: rolling_greeks() got multiple values for argument 'periods'`, breaking `test_metrics_parity_full`, and (b) was conceptually wrong: in quantstats 0.0.81 `rolling_greeks`'s `periods` arg IS the rolling window length and its alpha is explicitly unannualized.
- **Fix:** Reverted the `rolling_greeks` call to its original form, removed the (now-dead) `periods_per_year` param from `_rolling_alpha_beta` and its `_rolling_alpha`/`_rolling_beta` wrappers and the call site, and documented the correction inline. Rolling alpha is unannualized; rolling beta is a unitless ratio — neither has a basis to thread.
- **Files modified:** `analytics-service/services/metrics.py`
- **Verification:** `qs.stats.rolling_greeks` source + docstring inspected directly; `test_metrics_parity_full` green after revert; the 365-proof asserts beta invariance.
- **Committed in:** `1ab90333` (Task 1 commit)

**2. [Rule 1 - Bug] info_ratio rescales by √(365/252), not linearly (RESEARCH error in the proof formula)**
- **Found during:** Task 2 (validating the synthetic-pair rescale before writing the assertion)
- **Issue:** RESEARCH said info_ratio rescales linearly (×365/252). Empirically it rescales by √(365/252) — the numerator `periods` cancels with the `sqrt(periods)` in tracking error.
- **Fix:** Asserted the √ ratio for info_ratio in `test_periods_param_rescales_365` (alpha stays linear; beta invariant). Derived the math and verified empirically (< 1e-9).
- **Files modified:** `analytics-service/tests/test_metrics_parity.py`
- **Verification:** Empirical probe on the synthetic pair matched √(365/252); test green; mutation of the info_ratio site to 252 turns it RED.
- **Committed in:** `2a56f097` (Task 2 commit)

**3. [Rule 1 - Bug] Stale monkeypatch stub broke after the helper gained a kwarg**
- **Found during:** Task 2 (running the full `test_metrics.py` suite)
- **Issue:** `test_rolling_sortino_single_neg_sq_in_compute_all_metrics` monkeypatches `_rolling_sortino_from_components` with `counting_from_components(returns, neg_sq, window)`. After Task 1 the production call site forwards `periods_per_year=...`, so the stub raised `TypeError`.
- **Fix:** Updated the stub to `counting_from_components(returns, neg_sq, window, **kwargs)` and forward `**kwargs` to the real helper — directly caused by the Task 1 signature change; the test's neg_sq-materialized-once assertion is unchanged.
- **Files modified:** `analytics-service/tests/test_metrics.py`
- **Verification:** `test_metrics.py` 160 passed.
- **Committed in:** `2a56f097` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 Rule 1 — two RESEARCH corrections, one test-stub signature fix). All three are RESEARCH/cascade corrections discovered by running the tests, not scope creep. The net effect: 8 genuine annualization sites threaded (not the 9 the RESEARCH listed — rolling_greeks is correctly excluded), with correct proof ratios (info_ratio √-scaled, alpha linear).
**Impact on plan:** No scope change. The plan's objective (visible-at-call-site basis, default unchanged, falsifiable 365 proof) is fully met; the corrections make the implementation match quantstats 0.0.81 reality.

## Issues Encountered

- **Local `pandera` not installed** → `tests/test_mt5_golden_fixtures.py` fails at collection (`ModuleNotFoundError: No module named 'pandera'`). This is a **pre-existing local-env gap unrelated to this change** (the MT5 module imports `services.csv_validator` → `pandera`); CI installs it. Logged to `deferred-items.md`. Not fixed (out of scope — Scope Boundary). The MT5 doc-block refresh the CONTEXT mentions is part of the broader phase, not this plan's `requirements`.
- A pre-existing `git stash@{0}` (WIP on a different branch) was observed and deliberately **not touched** (stash is shared across worktrees; out of scope).

## User Setup Required

None — no external service configuration required. No new dependencies (`quantstats==0.0.81` already pinned), no migrations, no env vars.

## Next Phase Readiness

- **ANNUAL-05 (`equity_reconstruction.compute_sharpe` 365→252 convergence)** is NOT done here — it's a separate scope (this plan covers ANNUAL-01/03/04). A follow-up plan should flip the `compute_sharpe(periods=365)` default to 252, recompute the 4 hand-maintained `expected_sharpe` golden literals (×√(252/365)≈0.8312), and update the 2 cross-check literals. The shared `DEFAULT_PERIODS_PER_YEAR` constant is now available for it to import.
- **MT5 doc-block refresh** (`test_mt5_golden_fixtures.py:21-31`) is a CONTEXT item for the phase, deferred to a later plan; the resolved MT5 basis stays 252.
- The latent `periods_per_year` plumbing is ready: a future per-asset divergence (e.g. crypto 365) is now a one-line call-site change at `analytics_runner.py:1584`/`:2027`, with the 365-proof already validating the path works.

## Self-Check: PASSED

- Created/modified files verified present: `34-01-SUMMARY.md`, `deferred-items.md`, `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics_parity.py`, `analytics-service/tests/test_metrics.py`.
- Task commits verified in git log: `1ab90333` (feat), `2a56f097` (test).
- `golden_252d_expected.json` byte-identical (no git diff). `! grep np.sqrt(252)` passes. `mypy --strict` clean on `metrics.py`. `test_metrics_parity.py` 34 passed; `test_metrics.py` 160 passed; TS oracle 19/19.

---
*Phase: 34-asset-class-aware-annualization*
*Completed: 2026-06-24*
