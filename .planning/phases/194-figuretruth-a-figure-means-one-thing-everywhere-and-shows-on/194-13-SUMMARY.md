---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 13
subsystem: analytics-producer
tags: [trust-05, d-11, d-15, sharpe-lift, optimizer, match-engine]

requires:
  - phase: 194-02
    provides: MIN_ANNUALIZATION_OBS and the stored record_observations the readers gate on
  - phase: 194-03
    provides: the TS twins recordClears / gateAnnualized the Python functions mirror
provides:
  - "ONE_YEAR_DAYS, record_clears, blend_gate_crypto, annualization_state, sharpe_lift_gate in services/metrics.py"
  - "sharpe_lift_span_days, sharpe_lift_state, sharpe_lift_failing_record on every optimizer suggestion"
  - "sharpe_lift_span_days and sharpe_lift_state in match fit components, raw_components and score_breakdown raw"
  - "gated optimizer narrative sentence and gated match 'Lifts portfolio Sharpe' reason"
affects: [194-22, 194.1]

actuals:
  tokens: 14000
  tasks: 3
  commits: 3

plan_head_before: fca247c41efed58d44dd1316c303cac7dc00df2f
plan_head_after: eb836950d7dc6b7f8c952721ec9863b5de247b65

tech-stack:
  added: []
  patterns: ["one shared gate helper (sharpe_lift_gate) used by both producers", "expected spans computed from the fixture's own dates in the test"]

key-files:
  created:
    - analytics-service/tests/test_figure_gate_span.py
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/services/portfolio_optimizer.py
    - analytics-service/services/match_engine.py
    - analytics-service/tests/test_portfolio_optimizer.py
    - analytics-service/tests/test_match_engine.py
    - analytics-service/tests/fixtures/match_engine_v2_golden.json
    - analytics-service/tests/fixtures/e2_match_score_golden.json

key-decisions:
  - "A-194-D11-05: the match reason text is produced here, so it is gated once at its source; 194.1 renders what this emits."
  - "Score, stored sharpe_lift and ordering are untouched: the gate is a display rule (asserted)."

requirements-completed: []  # TRUST-05 closes with the display plans (22) that read these keys

duration: 1 session (3 task commits)
completed: 2026-11-07
status: complete
---

# Phase 194 Plan 13: One lift span and a D-15 verdict at the producer Summary

**Every optimizer suggestion and every match fit component now says how long the window behind its Sharpe lift is and whether the two records it compares clear D-15's minimum, and Python's own two sentences about a lift (the portfolio narrative and the match reason) follow that verdict; the stored lift and the ranking are unchanged.**

## Accomplishments

- `metrics.py`: `ONE_YEAR_DAYS = 365`, `record_clears` (TS `recordClears`), `blend_gate_crypto` (TS `blendPeriodsPerYear`: any crypto OR unknown leg is crypto), `annualization_state` (TS `gateAnnualized` over two records), and `sharpe_lift_gate`, the one helper that turns the candidate's index, the book's index and the aligned index into `(span, state, failing_record)`. Both producers call it, so the two cannot drift.
- `find_improvement_candidates`: each suggestion carries `sharpe_lift_span_days` (int, calendar days of the aligned window), `sharpe_lift_state` and `sharpe_lift_failing_record` (`span_days`, `observations`, `crypto` of the failing record, the shorter when both fail; None unless withheld). Candidate crypto comes from `periods_per_year_for_asset_class`, the book's from `blend_gate_crypto`.
- `generate_narrative`: withheld drops the recommendation sentence before the M-0904 warning branch (no warning is logged); short appends ", measured over N days of overlap, under one year" (thousands separator); full or no state is byte-identical.
- `match_engine`: the two keys are in `_empty_pf_components` (None), `_compute_portfolio_fit_components`, `raw_components` and `score_breakdown["raw"]`; `_generate_reasons` drops the lift reason when withheld and says "Lifts portfolio Sharpe by +0.30 over 60 days of overlap, under one year" when short.

## RED proofs (neuter from a byte backup, restored after each, cmp-verified)

- `record_clears` strict `>` at the crypto bound: `FAILED tests/test_figure_gate_span.py::test_record_clears[90-None-True-True]` and `[90-None-False-True]` (2 failed, 22 passed).
- `record_clears` ignoring observations for a non-crypto record: `FAILED ...test_record_clears[200-59-False-False]`, `[84-60-False-True]`, `[None-70-False-True]`, and `test_book_with_unknown_leg_and_70_daily_obs_fails_the_crypto_bound`.
- `blend_gate_crypto` counting None as traditional: `FAILED ...test_blend_gate_crypto_unknown_leg_counts_as_crypto`, `test_blend_clock_asymmetry_is_pinned_not_hidden`, `test_book_with_unknown_leg_and_70_daily_obs_fails_the_crypto_bound` (3 failed, 21 passed).
- Narrative withheld branch removed: `FAILED tests/test_portfolio_optimizer.py::test_narrative_withheld_lift_is_not_quoted_and_logs_no_warning` (1 failed, 29 passed).
- Match reason withheld branch removed: `FAILED tests/test_match_engine.py::test_lift_reason_withheld_is_dropped` (1 failed, 73 passed).

## Recorded for `[194-ENGINE-CONSTANTS]`: the unknown-class asymmetry

`blend_periods_per_year(["traditional", None])` is still 252 (the stored risk clock counts an unknown leg as 252), while `blend_gate_crypto(["traditional", None])` is True (the D-15 gate counts it as crypto, the TS `blendPeriodsPerYear` rule, RANK-06). Both are pinned by `test_blend_clock_asymmetry_is_pinned_not_hidden`. The clock was not changed: that would move stored figures outside D-15's scope.

## Gates

- `pytest tests/test_figure_gate_span.py tests/test_portfolio_optimizer.py`: 48 passed after Task 1; the five narrative-touching files (`test_portfolio_optimizer`, `test_c19_portfolio_fixes`, `test_correlation_residue_sites`, `test_dispersion_floor_sites`, `test_coverage_extras`): 381 passed after Task 2.
- `pytest tests/test_match_engine.py tests/test_match_engine_service.py`: 108 passed.
- Full `pytest` from `analytics-service/`: 14420 passed, 101 skipped, 2 failed. One is the pre-existing `test_xdist_group_is_real` (pytest-xdist not installed). The other was `test_e2_match_score_golden` (the exact-string golden gained the new raw keys); regenerated with `UPDATE_GOLDEN=1` after confirming the diff was only the two new keys, then it passes (3 passed).
- `mypy --strict` as CI runs it: `Success: no issues found in 132 source files`.
- Plan grep gates: `sharpe_lift_span_days` and `sharpe_lift_state` occur 6 times each in `match_engine.py` (required 4); the six named symbols exist.

## Deviations from Plan

**1. [Rule 1 - Plan error] "a 400-day overlap yields 399 and `short`".** 399 days is over one year, so by the plan's own rule (`annualization_state(True, True, 365)` is full) it is `full`. Tests pin 365 records / 364 days `short`, 366 / 365 `full`, and 400 / 399 `full`.

**2. [Rule 3 - Blocking] Two committed goldens pin the exact `raw` key set.** `match_engine_v2_golden.json` and `e2_match_score_golden.json` gained `sharpe_lift_span_days` and `sharpe_lift_state`; the diffs were walked key by key and contain only those two additions (the first golden: both null, screening/empty book; the second: 39 and `withheld` over its 40-day fixture). No score, rank or reason changed.

**3. [Rule 2 - Judgment] The match engine holds no asset class.** `score_candidates` receives no `asset_class` for the book or the candidates, and its Sharpe runs on the fixed default clock. Both records are therefore gated as unknown-class, i.e. on the crypto bound (the TS unknown-leg rule), via `blend_gate_crypto([None])`. This is the stricter direction: a weekday record of 60 observations over under 90 days is withheld here but would clear on the TS side with its real class. Threading `asset_class` through `routers/match.py` is outside this plan's files and was not done; see Known Limits.

## Known Limits

- Suggestions and match reasons stored before this ships carry no state and keep today's text until the optimizer or the match batch next runs (as the plan states).
- Match gating cannot see non-crypto records (deviation 3). A follow-up that selects `asset_class` in the match router and passes it to `_compute_portfolio_fit_components` would let a weekday record be judged on observations. Not booked as a phase; it is a refinement of the conservative direction.
- The book's record in the optimizer and match engine is the book's own joined (dropna) index, so its observation count is the overlap of the legs, the same notion TS uses for a blend.

## Known Stubs

None.

## Threat Flags

None. The new keys are integers and short strings over data the owner already sees (T-194-28, accepted).

## Task Commits

1. **Task 1 (tracer): one lift span and verdict on every optimizer suggestion** - `c4564421c`
2. **Task 2: the narrative sentence follows the lift verdict** - `9a6d59b2d`
3. **Task 3: match_engine emits span and state and gates its reason** - `eb836950d`
