---
phase: 73-pure-nav-twr-core
plan: 03
subsystem: testing
tags: [python, pandas, numpy, parity, twr, classifier, acc-01]

# Dependency graph
requires:
  - phase: 73-02
    provides: "metrics.py TWR-05 calendar-clock CAGR/Calmar split (the 365/252 factor this primitive detects)"
provides:
  - "services/parity_diff.py — reusable old-vs-new return-Series diff + delta-bucket classifier (classify_delta)"
  - "Four exported bucket-label constants (UNCHANGED / REANNUALIZATION / FLOW_MOVED / UNEXPLAINED) + BUCKET_LABELS frozenset + REANNUALIZATION_FACTOR"
  - "tests/test_parity_diff.py — one synthetic-series test per bucket + fail-closed/tolerance/consistency edges"
affects: [78-golden-parity, acc-01, phase-74-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure classifier primitive: typing + pandas + numpy only; labels as importable module constants (Phase 78 imports, never restates literals)"
    - "Fail-closed taxonomy: a movement matching no known bucket is 'unexplained', reached only by explicit non-match"
    - "External has_flows signal disambiguates a moved series (flow_moved vs regression) — reannualization changes scalars, not the series"

key-files:
  created:
    - analytics-service/services/parity_diff.py
    - analytics-service/tests/test_parity_diff.py
  modified: []

key-decisions:
  - "classify_delta accepts a keyword-only has_flows signal: a moved series is flow_moved iff the account is known to carry flows, else unexplained (fail-closed). Reannualization never moves the series, so movement + flows is unambiguous."
  - "Reannualization detection checks the CAGR shift against (1+old_cagr)**(365/252)-1 and, when Calmar is supplied on both sides, verifies Calmar shifted consistently (shared |max_dd| basis). CAGR-only is sufficient when Calmar is absent."
  - "Series-unchanged uses pandas.testing.assert_series_equal (rtol) — the plan's named primitive; a differing index counts as changed."

patterns-established:
  - "Delta-bucket classifier taxonomy for the Phase 78 golden old-vs-new parity gate, built early as isolated infrastructure (RESEARCH Open Question 2)."

requirements-completed: []  # ACC-01 GATES/COMPLETES in Phase 78 — this plan delivers only the reusable primitive, not the requirement.

# Metrics
duration: 15min
completed: 2026-07-05
---

# Phase 73 Plan 03: parity_diff Delta-Bucket Classifier Summary

**Pure old-vs-new return-Series diff classifier (`classify_delta`) that assigns each account delta to exactly one Phase 78 bucket — unchanged / reannualization / flow_moved / unexplained — with a fail-closed default.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-05T20:15:00Z
- **Completed:** 2026-07-05T20:30:00Z
- **Tasks:** 1 (TDD: RED test → GREEN impl)
- **Files modified:** 2 created

## Accomplishments
- `classify_delta(old_returns, new_returns, *, old_metrics, new_metrics, has_flows, rtol, ...)` returns exactly one of four fixed bucket labels.
- The four bucket labels + `BUCKET_LABELS` frozenset + `REANNUALIZATION_FACTOR` (365/252) are exported as module constants so Phase 78 imports them rather than restating string literals.
- 11 synthetic-series tests pass in the CI-3.12 venv (one per bucket plus tolerance, fail-closed, arbitrary-metric-shift, and Calmar-consistency edges); the new module ships at **92% line coverage** (well above the blocking 80% gate).
- Pure and I/O-free: imports are `typing` + `pandas` + `numpy` only (import-scan acceptance criterion green).

## Task Commits

TDD task — three-part cycle (no refactor needed):

1. **Task 1 (RED): failing classifier tests** - `3f348bcf` (test)
2. **Task 1 (GREEN): parity_diff classifier** - `653e993d` (feat)

**Plan metadata:** (final docs commit — this SUMMARY + STATE + ROADMAP)

## Files Created/Modified
- `analytics-service/services/parity_diff.py` - The pure `classify_delta` primitive + bucket-label constants + reannualization/series-diff helpers.
- `analytics-service/tests/test_parity_diff.py` - Synthetic-series unit tests, one per bucket + edges.

## Decisions Made
- **`has_flows` disambiguates a moved series.** Reannualization changes only the scalar CAGR/Calmar, not the return series; so a moved series is either an honest flow-driven move (flow-heavy account) or a regression (flow-less account that must NOT have moved). Those are indistinguishable from the series alone, so the caller (the Phase 78 harness, which knows each account's flow status) passes `has_flows`. This is the honest, non-speculative signal — not a heuristic re-derivation of returns.
- **Reannualization checks Calmar consistency when present.** `calmar = cagr / |max_dd|` and `|max_dd|` is unchanged when the series is unchanged, so a genuine reannualization shifts Calmar to `expected_cagr * old_calmar / old_cagr`. A CAGR that reannualizes but a Calmar that does not → `unexplained` (pinned by `test_reannualization_requires_calmar_consistency`).
- **Fail-closed default.** `unexplained` is reached only by explicit non-match, never by silent fallthrough — a misclassified regression sneaking through as `unchanged` is the T-73-04 harm class this gate exists to catch.

## Deviations from Plan

None - plan executed exactly as written. Scope held to the primitive: no multi-venue panel, no real-account fixtures, no live run (all Phase 78). ACC-01 deliberately left uncompleted (it gates/completes in Phase 78).

## Issues Encountered
None. The local Python 3.14 pandas SIGSEGV was avoided as instructed — every test ran against the CI-matching 3.12 venv.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The reusable comparison primitive is ready for the Phase 78 golden old-vs-new parity harness to import (`from services.parity_diff import classify_delta, BUCKET_LABELS, ...`).
- Phase 74's wiring has a ready comparison tool for its zero-flow byte-identity checks.
- ACC-01 remains OPEN by design — it gates and completes in Phase 78 when the panel + live run consume this primitive.

## Self-Check: PASSED

- `analytics-service/services/parity_diff.py` — FOUND
- `analytics-service/tests/test_parity_diff.py` — FOUND
- Commit `3f348bcf` (test RED) — FOUND
- Commit `653e993d` (feat GREEN) — FOUND

---
*Phase: 73-pure-nav-twr-core*
*Completed: 2026-07-05*
