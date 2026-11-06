---
phase: 159-rank-public-ranking-integrity
plan: 05
subsystem: analytics
tags: [quantstats, pandas, python, money-math, sharpe, sortino, drawdown, rank]

requires:
  - phase: 114-backbone-sharpe-vol
    provides: "sharpe_vol_status_from_backbone — the already-closed inline-pandas path whose mechanism and docblock discipline D-04 mandates mirroring"
provides:
  - "compute_all_metrics is free of the quantstats _prepare_returns / _prepare_prices price-detection heuristic at every call site (kwarg arm + P114 inline arm)"
  - "Honestly-signed headline sharpe/sortino and an honest max_drawdown for all-non-negative return series — the ranked, publicly-served KPIs"
  - "A measured in-env kwarg matrix for quantstats 0.0.81, including one behavioural divergence (cvar) the signature does not reveal"
  - "Per-site benign-series parity oracles against LIVE quantstats 0.0.81 for all 10 closed sites plus the full drawdown series"
  - "An executable region gate (inspect.getsource) that goes RED if any quantstats call in compute_all_metrics loses its closure"
affects: [159-01-census, 159-06-blend-annualization, ranking, strategy_analytics, factsheet]

actuals:
  tokens: 12116
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "P114 inline-pandas mirror: when a quantstats function offers no prepare_returns= kwarg, reimplement its documented math inline with a cited-source docblock rather than forking or pinning quantstats"
    - "Measured-not-cited kwarg verification: an in-env inspect.signature sweep PLUS a behavioural probe, because a kwarg can exist and still not be honoured transitively"
    - "Source-scan exclusion pins: a quantstats call exempted from a gate is justified by a test that scans the installed source, not by a comment"

key-files:
  created: []
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/tests/test_metrics.py

key-decisions:
  - "cvar moved from the kwarg arm to the inline arm: quantstats 0.0.81 advertises prepare_returns= on cvar but conditional_value_at_risk drops it before computing its internal VaR threshold, producing a MIXED basis (guessed threshold, raw tail) that is worse than either — measured, not inferred"
  - "NaN convention for the risk statistics is pandas skipna (matching the P114 path), NOT _prepare_returns' fillna(0); the drawdown/wealth-curve path keeps fillna(0) because a cumulative product cannot skip a gap day"
  - "The max_drawdown baseline is pinned at 1.0 instead of reproducing quantstats' _get_baseline_value ladder, which can only misfire on a wealth curve this code builds with base 1.0"
  - "qs.stats.drawdown_details is deliberately left without the kwarg (it consumes the underwater curve, not returns, and touches neither preparer) and the region gate excludes it BY NAME, pinned by a source scan rather than trust"
  - "Scope held to compute_all_metrics per the plan; compute_qstats_scalars and _rolling_alpha_beta are enumerated as an open residual rather than half-closed, because their scalars route TRANSITIVELY through the guessing primitives and cannot be closed by kwargs"

patterns-established:
  - "Shuffle invariance as a formula-free heuristic detector: order-independent statistics (Sharpe, volatility, tail ratio, VaR, CVaR) must survive a permutation of the daily returns; quantstats' bogus pct_change re-read is order-DEPENDENT, so a shuffle exposes it without restating any implementation formula"
  - "When a fix removes a fault class, the test rows that injected that fault become rows that cannot fail — convert them to pin the surviving contract instead of deleting them silently"

requirements-completed: [RANK-05]

coverage:
  - id: D1
    description: "Headline sharpe/sortino no longer route through quantstats' price-detection heuristic; an all-winning series reports a non-negative Sharpe"
    requirement: "RANK-05"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_metrics.py#test_rank05_all_winning_series_has_non_negative_sharpe_and_sortino"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_metrics.py#test_rank05_headline_sharpe_sortino_do_not_call_quantstats"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every remaining quantstats call site in compute_all_metrics is closed — kwarg arm where the kwarg is honoured, P114 inline mirror where it is not"
    requirement: "RANK-05"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_metrics.py#test_rank05_no_unclosed_quantstats_call_survives_in_compute_all_metrics"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_metrics.py#test_rank05_all_winning_series_has_zero_drawdown"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_metrics.py#test_rank05_all_winning_series_has_no_pain"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_metrics.py#test_rank05_order_independent_statistics_survive_a_shuffle"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every replaced or kwarg'd site is anchored by a benign-series parity oracle against live quantstats 0.0.81 (10 scalar sites + the full drawdown series)"
    requirement: "RANK-05"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_metrics.py#test_rank05_every_closed_site_matches_live_quantstats_on_a_benign_series (10 parameterized ids)"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_metrics.py#test_rank05_drawdown_series_matches_live_quantstats_on_a_benign_series"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_metrics.py#test_rank05_benign_mixed_sign_series_matches_live_quantstats"
        status: pass
    human_judgment: false
  - id: D4
    description: "The full analytics-service suite and mypy --strict are green with zero golden/parity fixture movement"
    requirement: "RANK-05"
    verification:
      - kind: integration
        ref: "cd analytics-service && python3 -m pytest -q  ->  5215 passed, 89 skipped"
        status: pass
      - kind: other
        ref: "cd analytics-service && python3 -m mypy --strict services/metrics.py  ->  Success: no issues found"
        status: pass
      - kind: other
        ref: "git diff <base>..HEAD --name-only -- 'analytics-service/requirements*.txt' 'tests/fixtures/**' '*golden*'  ->  empty"
        status: pass
    human_judgment: false
  - id: D5
    description: "Residual RANK-05 surface OUTSIDE compute_all_metrics (compute_qstats_scalars, _rolling_alpha_beta, the greeks benchmark leg) enumerated and deliberately scoped out rather than half-closed"
    verification: []
    human_judgment: true
    rationale: "A scoping judgement, not a testable outcome. A human must confirm that leaving these open — with the measured evidence that four of them cannot be closed by a kwarg at all — is the right call versus expanding this plan. Nothing in the code asserts the scope boundary is correct."

duration: 40 min
completed: 2026-08-21
status: complete
---

# Phase 159 Plan 05: RANK-05 quantstats Price-Detection Closure Summary

**The quantstats `_prepare_returns` / `_prepare_prices` price-detection heuristic is dead across `compute_all_metrics` — five sites closed with `prepare_returns=False`, six mirrored inline from cited 0.0.81 source (P114 pattern), one proven exempt by source scan — turning a `-4.35` Sharpe and a `-99.7%` drawdown on an all-winning account into honest values.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-08-21T10:52Z (approx — first commit 11:13:17Z)
- **Completed:** 2026-08-21T11:31:24Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Closed RANK-05 on the strategy-analytics KPI writer: no series shape can be silently re-read as prices anywhere in `compute_all_metrics`.
- Reproduced the defect first-hand before fixing it, and pinned the closure with economic invariants that are RED against the unfixed pipeline (verified by re-running the new tests against the pre-fix `metrics.py`).
- Found and recorded a behavioural divergence from the research matrix that a signature sweep alone would have missed: `cvar`'s `prepare_returns=` kwarg is not honoured transitively.
- Full analytics-service suite (5215 passed / 89 skipped) and `mypy --strict` green with **zero** golden or parity fixture movement — no adjudication was required and no fixture byte moved.

## Task Commits

1. **Task 1 (tracer, TDD): A1 kwarg re-verification + headline sharpe/sortino inline mirror** — `76d3dde0` (fix)
2. **Task 2: close the remaining call sites — kwarg arm + inline arm** — `aa06e86e` (fix)
3. **Task 3: parity/golden adjudication + full gate** — *no commit: the gates produced zero fixture movement and zero failures, so there was nothing to change.* Results recorded below.

## Files Created/Modified

- `analytics-service/services/metrics.py` — every `qs.stats` call in `compute_all_metrics` closed; each inline replacement carries a P114-style defect docblock citing the quantstats 0.0.81 source it mirrors.
- `analytics-service/tests/test_metrics.py` — new RANK-05 section (economic invariants, per-site live-quantstats parity, shuffle invariance, executable region gate, source-scan exclusion pin); two pre-existing tests rewritten to pin their contracts against the new mechanism.

---

## 1. Measured in-env kwarg matrix (assumption A1)

Run from `analytics-service/` **before any edit**. `quantstats.__version__ = 0.0.81`, `pandas.__version__ = 3.0.1`.

| function | `prepare_returns=` in signature | kwarg actually neutralizes the guess? | arm |
|---|---|---|---|
| `volatility` | YES | YES (measured) | kwarg |
| `sharpe` | **NO** | — | inline |
| `sortino` | **NO** | — | inline |
| `max_drawdown` | **NO** (`_prepare_prices`) | — | inline |
| `to_drawdown_series` | **NO** (`_prepare_prices`) | — | inline |
| `value_at_risk` | YES | YES (measured) | kwarg |
| `cvar` | YES | **NO — kwarg dropped internally** | **inline** |
| `omega` | **NO** | — | inline |
| `gain_to_pain_ratio` | **NO** | — | inline |
| `tail_ratio` | YES | YES (measured) | kwarg |
| `smart_sharpe` | **NO** | — | inline |
| `smart_sortino` | **NO** | — | inline |
| `profit_factor` | YES | YES (measured) | kwarg |
| `greeks` | YES | YES on the strategy leg (measured) | kwarg (+ residual, §5) |
| `drawdown_details` | NO | n/a — calls neither preparer | exempt (source-scanned) |

**Divergence from 159-RESEARCH's matrix — one, and it matters.** The research matrix listed `cvar` as kwarg-closable. The signature agrees. The *behaviour* does not: quantstats 0.0.81's `conditional_value_at_risk` computes its VaR threshold with

```python
var = value_at_risk(returns, sigma, confidence)   # prepare_returns NOT forwarded
c_var = returns[returns < var].values.mean()
```

so `cvar(r, prepare_returns=False)` derives the threshold from the **price-guessed** series while selecting the tail from the **raw** one. Measured on the trigger fixture: `cvar(r, prepare_returns=False)` returned `-0.24153` — exactly the guessed VaR — against the honest `-0.28406`. A kwarg-only sweep would have left this site not merely open but on a *mixed* basis. Measured beats cited; `cvar` was moved to the inline arm.

Everything else in the research matrix was confirmed exactly, including the critical fact that `sharpe`/`sortino` carry no kwarg (Pitfall 3).

## 2. Observed pre-fix RED

Fixture (`_rank05_trigger_series`): 60 business days, day 1 = `+150%`, remaining days a decaying but **always positive** gain (`linspace(0.012, 0.004)`). All-non-negative with `max > 1`, so it trips both guesses; the decaying tail makes the bogus "price" path a downtrend, which is what flips the sign.

| metric | pre-fix | honest reading |
|---|---|---|
| `sharpe` | **-4.3469** | positive — the account never lost a day |
| `sortino` | **-4.2254** | undefined (zero downside) — never negative |
| `volatility` | 1.9983 (≈200% annualized) | ~0.33 on the raw dispersion |
| `max_drawdown` | **-0.9973** | 0.0 — an all-winning series never goes underwater |
| `omega` | 0.0 | undefined (no losses) |
| `gain_pain` | -1.0 | undefined |
| `profit_factor` | 0.0 | undefined / +∞ |
| `smart_sharpe` | -4.1735 | positive |
| `smart_sortino` | -4.0569 | undefined |

RED was observed in both directions, not just asserted:

- **Task 1**, before any edit: `test_rank05_all_winning_series_has_non_negative_sharpe_and_sortino` and `test_rank05_headline_sharpe_sortino_do_not_call_quantstats` both FAILED against the untouched `compute_all_metrics`.
- **Task 2 anti-vacuity drill** (`git checkout 76d3dde0 -- services/metrics.py`, run, restore): all five new Task 2 tests FAILED, with the region gate naming all **12** unclosed calls and the shuffle test showing `volatility` moving from `1.9983` to `302.20` under a pure reordering of the same returns. The benign-parity tests passed in both states — exactly right, since their job is to prove untriggered series do *not* move.

The plan's "neuter drill" is therefore encoded permanently rather than performed once: `test_rank05_headline_sharpe_sortino_do_not_call_quantstats` detonates `qs.stats.sharpe`/`sortino`, and the region-gate test scans `inspect.getsource(compute_all_metrics)`. Either goes RED at the reintroducing commit.

## 3. Per-site NaN-convention decisions

`_prepare_returns` performed `fillna(0)` — counting a gap day as a real 0.00% return. Removing it is a decision, taken per site and documented at the site:

| site | decision | fixture impact |
|---|---|---|
| `sharpe`, `sortino` (inline) | **skipna** — matches the P114 path; a NaN day is not an observation. Sortino's denominator is `count()`, not `len()` | none (all fixtures NaN-free) |
| `volatility`, `value_at_risk`, `tail_ratio`, `profit_factor` (kwarg) | **skipna** — inherited from pandas defaults once `_prepare_returns` is off; keeps them coherent with the headline pair | none |
| `cvar` (inline) | **skipna**, same threshold source as `var_1d_95` | none |
| `omega` (inline) | **identical either way** — `fillna(0)` maps a gap to 0.0, which satisfies neither `> 0` nor `< 0`, exactly like a skipped NaN | none, provably |
| `gain_pain` (inline) | **identical either way** — `resample().sum()` skips NaN; `fillna(0)` contributes 0.0 to the same sums | none, provably |
| `smart_sharpe`, `smart_sortino` (inline) | **skipna via `dropna()`** — the autocorrelation penalty needs a dense array (`np.corrcoef` propagates NaN) | none |
| `max_drawdown`, `to_drawdown_series` (inline) | **`fillna(0)` — UNCHANGED and deliberate.** A cumulative product cannot skip a NaN without truncating every later point; a gap day must carry equity forward. This is exactly what `_prepare_prices` did | none by construction |

A second, smaller consequence of dropping `_prepare_returns` is recorded at the `volatility` site: its `inf → NaN → 0` fill is gone, so a non-finite input now degrades to `None` through `_safe_float` instead of being silently zero-substituted into a finite-looking number. That is fail-soft rather than fabricated (Rule 12).

**One deliberate divergence from quantstats, recorded in code:** `max_drawdown`'s baseline is pinned at `1.0` instead of reproducing `_get_baseline_value`'s ladder (`>1000 → 1e5`, `>10 → 100.0`, else `1.0`). That ladder guesses inception capital from the first price; this code *builds* the wealth curve with base `1.0`, so inception capital is known exactly and the ladder can only misfire — it would fabricate a ~-100% drawdown for an account whose first day gained more than +900%. Benign parity is untouched: the ladder returns `1.0` for every first price ≤ 10.

## 4. Parity tolerances

| oracle | tolerance | sites |
|---|---|---|
| live `qs.stats.<fn>` on a mixed-sign benign series | `rel=1e-9` | volatility, max_drawdown, omega, gain_pain, tail_ratio, profit_factor, smart_sharpe, smart_sortino, var_1d_95, cvar |
| live `qs.stats.sharpe` / `sortino`, 252 **and** 365 clocks | `rel=1e-9` | headline sharpe, sortino |
| live `qs.stats.to_drawdown_series`, point-by-point incl. dates | `abs=1e-12` | drawdown_series |
| order-invariance under permutation | `rel=1e-12` | sharpe, volatility, tail_ratio, var_1d_95, cvar |
| all-winning economic invariants | `abs=1e-12` (drawdown), sign-only elsewhere | max_drawdown, omega, gain_pain, profit_factor, smart_* |

`rel=1e-9` (not exact equality) is the honest tolerance for Sharpe because the P114 form `mean·ppy / (std·√ppy)` is algebraically — not bitwise — identical to quantstats' `mean/std·√ppy`.

## 5. Fixture adjudications

**None required — zero fixtures moved.**

| suite | result |
|---|---|
| `tests/test_metrics_parity.py` | 35 passed |
| `tests/test_accuracy.py` | 16 passed |
| `tests/test_mt5_golden_fixtures.py` | 16 passed |
| `tests/test_teaser_derive_golden.py` | 2 passed |
| `tests/test_metrics.py` | 171 passed |
| **full `python3 -m pytest -q`** | **5215 passed, 89 skipped** |
| `python3 -m mypy --strict services/metrics.py` | Success, 0 new `type: ignore` |

Cross-checked against the diff rather than asserted: `git diff <base>..HEAD --name-only` limited to `analytics-service/requirements*.txt`, `tests/fixtures/**` and `*golden*` returns **empty**. The whole plan touched exactly two files. This is the expected outcome — every golden and parity fixture is a NaN-free, mixed-sign series, i.e. precisely the population on which the skipna-vs-`fillna(0)` divergence is provably nil and on which neither guess can fire.

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one is the `cvar` reclassification (§1): it is the case the plan anticipated when it wrote "measured beats cited", and it is the reason the A1 re-verification step earned its place.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The Task 2 region gate produced two false positives; refined and made executable**
- **Found during:** Task 2
- **Issue:** The plan's gate — `awk … | grep -E 'qs\.stats\.[a-z_]+\(' | grep -v 'prepare_returns=False'` — flagged (a) `qs.stats.drawdown_details(dd_series)`, which provably carries no price heuristic (it consumes the already-computed underwater curve; neither it nor `remove_outliers` references `_prepare_returns`/`_prepare_prices` in 0.0.81), and (b) a *comment line* quoting `qs.stats.greeks(returns,` in prose. Reimplementing ~55 lines of edge-case drawdown-episode logic to satisfy a proxy gate would have risked introducing a real bug to close an imaginary one.
- **Fix:** Gate refined to skip comment lines (prose cannot invoke anything) and to exclude `drawdown_details` **by name**, with that exclusion pinned by `test_rank05_drawdown_details_is_heuristic_free`, which scans the *installed* quantstats source and goes RED if a future version ever routes it through either preparer. The gate was additionally re-expressed as a test over `inspect.getsource(compute_all_metrics)` so it runs in CI rather than only in a shell one-liner, and is immune to line drift.
- **Verification:** Refined gate exits clean at HEAD; the same test named all 12 unclosed calls when run against pre-Task-2 code.
- **Committed in:** `aa06e86e`

**2. [Rule 1 - Bug] Two existing tests pinned mechanisms the fix retires, and became tests that cannot fail**
- **Found during:** Tasks 1 and 2
- **Issue:** `test_scalar_sortino_passes_mar_as_rf` spied on `qs.stats.sortino`'s `rf` kwarg — a call that no longer happens. `test_compute_all_metrics_inline_qstats_scalar_failures_log_warning` injected faults by detonating `qs.stats.<attr>` for eight scalars, five of which no longer reach quantstats. Left as-is they fail; deleted, real contracts go unpinned; "fixed" by loosening, they become vacuous — the exact failure mode the house rule names.
- **Fix:** The MAR test now pins the *economics* (raising MAR must lower Sortino — RED if MAR is dropped from the inline math) instead of a call signature. The fault-injection table was narrowed from 8 rows to 4, with `cvar`'s row retargeted to `value_at_risk` (the primitive its inline wrapper genuinely calls), and the removed rows replaced by `test_rank05_inlined_scalars_are_failure_soft_without_quantstats`, which asserts both that the inlined scalars survive a detonated quantstats **and** that a real fault inside the inline math (`np.corrcoef`) still degrades that scalar with a named WARNING while its siblings continue.
- **Side effect:** the `smart_*` block was restructured so `_smart_r`/`_smart_penalty` bind before either `try`, preventing a failure in `smart_sharpe` from cascading into `smart_sortino` as a `NameError`.
- **Verification:** 171 passed in `test_metrics.py`; the new failure-soft test is RED against pre-Task-2 code.
- **Committed in:** `76d3dde0`, `aa06e86e`

**3. [Rule 2 - Missing critical] `greeks` closed on the strategy leg only, with the residual recorded at the call site**
- **Found during:** Task 2
- **Issue:** `greeks` was not in the plan's enumerated site list but is a `qs.stats` call inside `compute_all_metrics` ("close EVERY site, not the enumerated list"). It carries the kwarg, but quantstats then runs the *benchmark* through `_prepare_benchmark`, which price-guesses it unconditionally.
- **Fix:** `prepare_returns=False` added (measured to close the strategy leg) and the call collapsed to one source line so the gate can see it. The benchmark-leg residual is documented at the call site and enumerated in §Residual below rather than silently left.
- **Committed in:** `aa06e86e`

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 bug, 1 missing-critical).
**Impact on plan:** No scope creep. Deviations 1 and 2 were forced by the fix retiring mechanisms the existing gates/tests observed; both were resolved by re-pinning the same contracts against the new mechanism rather than by weakening them. Deviation 3 is one extra call site inside the plan's own stated scope.

## Residual — RANK-05 surface deliberately left open (needs a follow-up plan)

The plan scoped this work to `compute_all_metrics`. The same defect class is **still live** elsewhere on the strategy-analytics path, measured and enumerated here so it is visible rather than half-closed:

| location | sites | closable by kwarg? |
|---|---|---|
| `compute_qstats_scalars` (metrics.py) | `recovery_factor`, `kelly_criterion`, `common_sense_ratio`, `cpc_index` | yes — but they need a per-function kwarg map in the `_QSTATS_SINGLE_ARG_SCALARS` dispatch |
| `compute_qstats_scalars` | `ulcer_index`, `ulcer_performance_index`, `probabilistic_ratio`, `serenity_index` | **NO** — no kwarg, and they route *transitively* through the guessing primitives: `ulcer_index → to_drawdown_series`, `probabilistic_ratio → sharpe`/`sortino`, `serenity_index → cvar`/`to_drawdown_series`, `recovery_factor → max_drawdown`. Each needs its own inline mirror |
| `compute_qstats_scalars` | `r_squared` | yes (one kwarg) |
| `_rolling_alpha_beta` | `rolling_greeks` | yes (one kwarg) |
| `compute_all_metrics` → `greeks` | benchmark leg via `_prepare_benchmark` | no — needs `greeks` inlined |

Closing these by kwarg alone would produce a **false** "class closed" claim, since four of them re-enter the heuristic through functions the kwarg cannot reach. That is why the surface was left whole and enumerated rather than partially patched.

**Ledger entry for the orchestrator to file post-merge** (deliberately NOT written from this worktree — `.planning/WINDOWS.md` is shared state and concurrent wave agents appending to its table and JSON block would conflict at merge):

```bash
gsd-tools windows append \
  --kind deviation \
  --phase 159 \
  --file analytics-service/services/metrics.py \
  --description "RANK-05 residual: the quantstats price-detection heuristic is closed in compute_all_metrics but still live in compute_qstats_scalars (8 scalars), _rolling_alpha_beta's rolling_greeks call, and the greeks benchmark leg. Four of the eight (ulcer_index, ulcer_performance_index, probabilistic_ratio, serenity_index) route TRANSITIVELY through to_drawdown_series/sharpe/sortino/cvar and cannot be closed by prepare_returns=False; they need P114 inline mirrors. See 159-05-SUMMARY.md section 'Residual'."
```

## Issues Encountered

- `159-PATTERNS.md`, referenced by the plan's `<context>` and by the executor prompt's required reading, **does not exist** in the phase directory (contents: `159-01..07-PLAN.md`, `159-CONTEXT.md`, `159-DISCUSSION-LOG.md`, `159-RESEARCH.md`, `159-VALIDATION.md`, `COVERAGE.md`). Not blocking: the inline-pandas mirror excerpts it was meant to carry are present verbatim in `159-RESEARCH.md` §RANK-05 and, authoritatively, in `metrics.py`'s `sharpe_vol_status_from_backbone` docblock, both of which were read directly. Worth correcting in the phase artifacts.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- ROADMAP 159 SC-4 **first arm** holds: no series shape can be re-read as prices anywhere in `compute_all_metrics`; the ranked KPIs (`sharpe`, `sortino`, `max_drawdown`, `volatility`) carry honestly-signed values; full suite and `mypy --strict` green with every fixture unmoved.
- SC-4's second arm is RANK-06 (blend RISK annualization), which 159-RESEARCH corrects to a **TypeScript** fix at `src/lib/closed-sets.ts:605-609` — no dependency on this plan.
- **Before `/ship`:** `python3 -m mypy --strict services/metrics.py` must be re-run (house law — the GSD milestone gate runs pytest only). It is green at `aa06e86e`.
- No blockers. One open residual, enumerated above, sized for a follow-up plan.

## Self-Check: PASSED

- Files on disk: `analytics-service/services/metrics.py` FOUND, `analytics-service/tests/test_metrics.py` FOUND, `.planning/phases/159-rank-public-ranking-integrity/159-05-SUMMARY.md` FOUND. No files were claimed as created (this plan modified two existing files).
- Commits reachable: `76d3dde0` FOUND, `aa06e86e` FOUND, `2f44e1dd` FOUND.
- Task 3 claims no commit, and none exists — the gates produced zero failures and zero fixture movement, so there was nothing to change.
- Working tree clean after the Task 2 anti-vacuity drill (`git checkout HEAD -- services/metrics.py` restored the committed file; `git status --short` empty; suite re-run green at 171 passed).
- Prohibition checks re-run against the diff, not asserted: no `requirements*.txt`, no `tests/fixtures/**`, no `*golden*` path in `git diff <base>..HEAD --name-only`; no quantstats pin change and no monkeypatching of quantstats internals in the added lines.
- Known stubs: none. No placeholder, TODO or unwired code path was introduced.

---
*Phase: 159-rank-public-ranking-integrity*
*Completed: 2026-08-21*
