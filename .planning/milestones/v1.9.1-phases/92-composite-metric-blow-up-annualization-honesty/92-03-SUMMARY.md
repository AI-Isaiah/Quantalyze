---
phase: 92-composite-metric-blow-up-annualization-honesty
plan: 03
subsystem: analytics-metrics-dq
tags: [HARD-04, insufficient_window, cagr, annualization, data_quality_flags, composite, factsheet, value-invariant]

# Dependency graph
requires:
  - phase: 92-composite-metric-blow-up-annualization-honesty
    plan: 02
    provides: "pnl_dominated_guard NaN-breaks the exploded day, leaving a legitimately-short retained suffix that this flag now catches (the un-fixed short-window over-annualization class 92-02 deferred here)"
provides:
  - "MIN_ANNUALIZATION_DAYS=90 + insufficient_window computed at BOTH metrics.py CAGR sites, returned on a MetricsResult FIELD (never a metrics_json key)"
  - "Lift into strategy_analytics.data_quality_flags at BOTH callers: composite merged_flags (drop-stale heal) + single-key DataQualityFlags (present-only additive)"
  - "User-visible DQ caveat on the two existing surfaces: wizard composite-preview amber Data quality block + factsheet hero-strip caveat"
affects: [composite-factsheet, wizard-sync-preview, analytics_runner, job_worker, metrics]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DQ annotation on a MetricsResult FIELD, not a metrics_json key — avoids the strategy_analytics column-spread hazard (analytics_runner :1925/:2373, job_worker :3386/:3506/:3595)"
    - "Drop-stale heal-on-re-stitch mirror of mtm_gated_reason in the composite merged_flags block"
    - "Present-only additive single-key lift OUTSIDE NAV_TWR_GUARD_KEYS → never promotes computation_status"
    - "Strict server-truth `=== true` coercion at both TS parsers so malformed dqf renders nothing (T-92-05)"

key-files:
  created: []
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/services/job_worker.py
    - analytics-service/services/analytics_runner.py
    - analytics-service/tests/test_metrics.py
    - analytics-service/tests/test_stitch_composite_job.py
    - analytics-service/tests/test_analytics_runner.py
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/types.ts
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/lib/factsheet/composite-read-path.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx

key-decisions:
  - "MIN_ANNUALIZATION_DAYS = 90 (strict `<`, founder-tunable like FLOW_DOM_RATIO/PNL_DOM_RATIO): exactly-90-day span → NOT flagged, 89 → flagged."
  - "The flag rides a MetricsResult field, NOT a metrics_json key — a new top-level key would become an unknown strategy_analytics upsert column (PostgREST failure) and mutate every full-dict golden (planner-verified spread hazard)."
  - "Deliberately NOT a NAV_TWR_GUARD_KEYS member → never promotes computation_status; a young-but-clean account stays exact-string 'complete' (avoids factsheet-wide blast radius, roadmap Pitfall #12)."
  - "No flow-heavy trigger needed at the CAGR site: a flow-/P&L-dominated window already breaks the chain upstream (flow_dominated_guard/pnl_dominated_guard), shortening the retained _cagr_index suffix so the elapsed-days rule fires on the trustworthy window (research §d, decision 2)."

requirements-completed: [HARD-04]

# Metrics
duration: ~90min
completed: 2026-07-11
---

# Phase 92 Plan 03: `insufficient_window` DQ flag (HARD-04) Summary

**A short-lived / flow-heavy annualization window is now HONESTLY FLAGGED (`insufficient_window` in `data_quality_flags`) instead of silently over-annualizing CAGR — stamped at both `metrics.py` CAGR sites via a `MetricsResult` field with the CAGR value byte-identical (value-invariant HARD-04 hard rule), lifted at BOTH callers (composite `merged_flags` with drop-stale healing + single-key `DataQualityFlags` present-only additive, neither promoting `computation_status`), and rendered to the user through the two EXISTING DQ-caveat surfaces (wizard composite-preview amber block + factsheet hero strip). Closes #67.**

## Performance

- **Duration:** ~90 min
- **Completed:** 2026-07-11
- **Tasks:** 3/3
- **Files modified:** 13 (3 analytics source, 3 analytics tests, 4 frontend source, 3 frontend tests)

## Accomplishments

### Task 1 — stamp at both CAGR sites via a MetricsResult field (commit `930eb638`)
- `metrics.py`: `MIN_ANNUALIZATION_DAYS = 90` beside `_CALENDAR_DAYS_PER_YEAR` (:55, founder-tunable comment); `insufficient_window: bool = False` FIELD on `MetricsResult` with a docstring naming the spread hazard.
- Geometric branch (:645-652): `insufficient_window = _elapsed_days < MIN_ANNUALIZATION_DAYS` reusing the ALREADY-computed `_elapsed_days` (degenerate <2-day / no-total_return → True); the `cagr` expression is untouched.
- Simple branch (:589-594): mirror on the (NaN-free-by-contract) full `returns.index` calendar span.
- Threaded into the single `MetricsResult(...)` construction (:1187).
- **Value-unchanged pin (RED-first):** `test_insufficient_window_geometric_short_flagged_value_unchanged` asserts `result["cagr"] == (1+total)**(365/elapsed)-1` on a flagged 30-day window — a fix that clamps/zeroes/NaNs cagr reddens it. Simple-branch mirror asserts `cagr == mean × periods_per_year`.
- **Spread-hazard pin:** `"insufficient_window" not in result.metrics_json` for both flagged and unflagged runs.
- Boundary pin: exactly-90-day span → False, 89 → True.

### Task 2 — lift at both callers, no status promotion, drop-stale on composite (commit `2cd7425f`)
- `job_worker.py` composite `merged_flags` (~:3564): read `cash_metrics_result.insufficient_window` → set/`pop` mirroring the `mtm_gated_reason` drop-stale precedent (a re-stitch past the threshold heals).
- `analytics_runner.py`: `insufficient_window: bool` added to the `DataQualityFlags` TypedDict; present-only additive lift at BOTH compute sites (`run_strategy_analytics` after the `NAV_TWR_GUARD_KEYS` loop; `run_csv_strategy_analytics` after `csv_status`, explicitly not touching `_warned`).
- **Status-invariant pin:** composite `test_insufficient_window_short_composite_stamps_flag_status_unchanged` and single-key `test_insufficient_window_single_key_short_lifts_flag_status_unchanged` both assert `computation_status == "complete"` on a flagged run.
- Drop-stale pin: a ≥90-day re-stitch drops a seeded stale `insufficient_window` while an unrelated `benchmark_unavailable` survives the merge.
- `nav_twr.py` untouched (empty diff) — flag deliberately outside the guard-key registry.

### Task 3 — render through the existing DQ-caveat surfaces, no new component (commit `8a6110fa`)
- `composite-read-path.ts`: widened the `dqf` input type; `dataQuality: { composite: true, insufficientWindow: dqf?.insufficient_window === true }` (strict server-truth coercion).
- `types.ts`: `dataQuality?: { composite: boolean; insufficientWindow?: boolean }` (optional — absent-as-false for stale cache).
- `FactsheetView.tsx`: sibling amber `<p>` reusing the NEW-C20-08 hero-strip pattern (`px-3 sm:px-4 py-2 text-micro font-mono`, borderTop, `var(--color-warning, #B45309)`), gated on `payload.dataQuality?.insufficientWindow === true`; the n<252 client-count caveat left untouched.
- `SyncPreviewStep.tsx`: `insufficientWindow` on `CompositePreviewData` + dq parse (`dq.insufficient_window === true`) + `hasDqCaveat` OR + a `<p>` in the existing amber `role="status"` Data quality block.
- No new UI component created (verified 0 new `.tsx` in the diff). DESIGN.md warning token `#B45309` honored (recoverable-state amber semantics).

## The two required pins + the two render surfaces (per the plan's output requirement)

- **Value-unchanged pin:** `tests/test_metrics.py::TestInsufficientWindowFlag::test_insufficient_window_geometric_short_flagged_value_unchanged` (and the simple-branch mirror) assert `cagr` equals the exact hand formula on a flagged window — the flag is annotation only.
- **Status-invariant pin:** `test_insufficient_window_short_composite_stamps_flag_status_unchanged` (composite) + `test_insufficient_window_single_key_short_lifts_flag_status_unchanged` (single-key) assert `computation_status == "complete"` on a flagged run — the flag never promotes status.
- **Render surface 1 (wizard):** the amber `role="status"` Data quality block in `SyncPreviewStep.tsx` — pinned by `SyncPreviewStep.composite.render.test.tsx` ("renders the insufficient-window DQ caveat").
- **Render surface 2 (factsheet):** the hero-strip caveat in `FactsheetView.tsx` — pinned by `FactsheetView.kpistrip.test.tsx` (server-truth caveat renders when true, absent when false, n=300 isolates it from the n<252 heuristic).

## Acceptance evidence

| Check | Command | Result |
|-------|---------|--------|
| insufficient_window unit pins | `pytest tests/test_metrics.py -k insufficient_window -q` | 5 passed |
| constant defined + consumed | `grep -c MIN_ANNUALIZATION_DAYS services/metrics.py` | 6 (def + both branch sites) |
| no metrics_json key | `grep -c 'metrics_json\["insufficient_window"\]' services/metrics.py` | 0 |
| golden/parity set | `pytest test_metrics{,_parity,_minigolden} test_golden_parity test_mt5_golden_fixtures -q` | 218 passed |
| composite + single-key lift | `pytest test_stitch_composite_job test_analytics_runner -k insufficient_window -q` | 4 passed |
| job_worker wiring | `grep -c insufficient_window services/job_worker.py` | 4 (≥2 set+pop) |
| analytics_runner wiring | `grep -c insufficient_window services/analytics_runner.py` | 7 (≥3 TypedDict + 2 lifts) |
| nav_twr untouched | `git diff --stat services/nav_twr.py` | empty |
| mypy | `mypy services/{metrics,job_worker,analytics_runner}.py` | Success, 0 issues |
| full analytics suite | `.venv/bin/python -m pytest -q` | 3584 passed, 92 skipped, 0 failed |
| frontend render pins | `vitest run` the 3 files | 40 passed |
| factsheet + wizard suites | `vitest run src/lib/factsheet "…/v2" "…/wizard/steps"` | 360 + 121 passed |
| tsc | `npx tsc --noEmit` | clean (0 errors) |
| lint | `npm run lint` | 0 errors (1 pre-existing EquityChart warning, out of scope) |

## Deviations from Plan

### 1. [Rule 1 — assertion-vs-reality] The "fully clean run" analytics_runner invariant lengthened to a genuinely-sufficient window
- **Found during:** Task 2 (blast-radius scan of `test_analytics_runner.py`).
- **Issue:** `test_consumer_migration_fully_clean_run_status_complete_no_flags` asserted ZERO `data_quality_flags` on a 15-business-day fixture. Under HARD-04 a 15-day (~20-calendar-day) window is NO LONGER "fully clean" — it legitimately carries `insufficient_window`, so the zero-flags assertion broke.
- **Fix:** lengthened the fixture (and its aligned benchmark) to 120 business days (~168 calendar days, clear of 90) so it is GENUINELY clean — preserving the test's binding intent (no spurious flag leak + no status promotion on a clean run) rather than weakening the assertion.
- **Files:** `tests/test_analytics_runner.py`. **Commit:** `2cd7425f`.

### 2. [Rule 1 — contract pin update] MetricsResult dataclass-shape pin extended for the new field
- **Found during:** Task 2.
- **Issue:** `test_metrics_result_dataclass_contract_shape` pins the exact field set `{metrics_json, sibling_kinds}`; the new `insufficient_window` field is a deliberate contract change, so the closed-set assertion reddened.
- **Fix:** updated the pin to `{metrics_json, sibling_kinds, insufficient_window}` with a comment explaining the field-not-key HARD-04 design + `MetricsResult().insufficient_window is False` default assertion.
- **Files:** `tests/test_analytics_runner.py`. **Commit:** `2cd7425f`.

Both are legitimate consequences of the new field, not scope creep — the fixtures/pins encoded pre-HARD-04 assumptions that HARD-04 deliberately changes.

## No data migration / self-heal

No schema change and no data migration. The flag is a boolean on the existing `data_quality_flags` JSONB. A composite that grows past `MIN_ANNUALIZATION_DAYS` DROPS the flag on the next re-stitch (drop-stale); a single-key recompute rebuilds `data_quality_flags` fresh. Live short-window factsheets pick up the flag on their next derive.

## Threat surface scan

No new network endpoints, auth paths, file access, or schema changes. `insufficient_window` is a boolean-only DQ flag (no elapsed-days count or raw magnitude — leak discipline T-73-02/T-92-04); both TS parsers use strict `=== true` coercion so malformed dqf JSON renders nothing (T-92-05); the flag rides a MetricsResult field + JSONB, never the metrics_json column spread (T-92-06). No new packages (T-92-SC not triggered). No threat flags.

## Self-Check: PASSED

- `analytics-service/services/metrics.py` — FOUND (constant + field + both CAGR-site computations + construction).
- `analytics-service/services/job_worker.py` — FOUND (merged_flags set/pop drop-stale).
- `analytics-service/services/analytics_runner.py` — FOUND (TypedDict + both lift sites).
- `src/lib/factsheet/composite-read-path.ts`, `types.ts`, `FactsheetView.tsx`, `SyncPreviewStep.tsx` — FOUND (dqf widen + dataQuality thread + both render surfaces).
- Commit `930eb638` (Task 1) — FOUND.
- Commit `2cd7425f` (Task 2) — FOUND.
- Commit `8a6110fa` (Task 3) — FOUND.
