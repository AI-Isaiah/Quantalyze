---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 01
subsystem: api
tags: [factsheet, returns-api, held-rerun, analytics-hold, fact-02]
requires:
  - phase: 190-factsheetqueued
    provides: hasStoredAnalyticsResult, effectiveDataQualityFlags, hasUnboundDerivePrestamp, isRecomputeOverStoredResult
provides:
  - analyticsHold(row) -> { updating, admitted }, the one held-re-run verdict for every FACT-02 surface
  - HELD_RERUN_CACHE_CONTROL
  - returns route holding a pending or computing row over a stored success, with analytics_updating
affects: [237-05, 237-06, 237-07, 237-08, 237-11]
tech-stack:
  added: []
  patterns: ["one shared verdict restating the factsheet resolve stage, never a per-surface status ladder"]
key-files:
  created:
    - src/lib/analytics-hold.ts
    - src/lib/analytics-hold.test.ts
  modified:
    - src/app/api/strategies/[id]/returns/route.ts
    - src/app/api/strategies/[id]/returns/route.test.ts
key-decisions:
  - "analyticsRankable keeps its name in the returns route, bound to hold.admitted, so cagr, sharpe and figure_* uses do not churn"
  - "Composites do not hold on the returns API, matching the factsheet (RESEARCH A6); the helper's composite term is the one line to change if the founder rules otherwise"
requirements-completed: [FACT-02]
status: complete
commits: 2
plan_head_before: 4002cf06e657e1fea49eee74e1048edb2ccad9af
plan_head_after: b0cde4c66b231ddae1f73ec641ea4df492a2eae9
actuals:
  tokens: 6500
  tasks: 2
  commits: 2
---

# Phase 237 Plan 01: analyticsHold and a held re-run on the returns API Summary

**One shared `analyticsHold` verdict restating the factsheet resolve stage's three refusals, and `GET /api/strategies/[id]/returns` now serves a pending or computing row's last-success series and scalars with a boolean `analytics_updating`, reading unit and curve from the effective flags.**

Agent branch: `worktree-agent-a7dfd5a3892afc799`. Re-based to `4002cf06e657e1fea49eee74e1048edb2ccad9af` before any work. Final HEAD is the `plan_head_after` above, plus this SUMMARY's own commit.

## Accomplishments

- `src/lib/analytics-hold.ts`: `analyticsHold(row)` returns `{ updating, admitted }`. `updating` is true only for a pending or computing row that stores a result (`hasStoredAnalyticsResult`) and is not composite on its effective flags. `admitted` is a terminal success without an unbound derive prestamp, or `updating`. Also exports `HoldRow` and `HELD_RERUN_CACHE_CONTROL` (`public, max-age=60, s-maxage=60`, no stale-while-revalidate). Not placed in `stored-analytics-result.ts`, which is dependency-free by header rule. No server-only import.
- Returns route: select now names `cumulative_return` and `computed_at` (RECORD_SCALAR_ALIASES still last); the decision point reads `analyticsHold(analyticsRow)`; `analytics_updating` is on every 200 body and in `ReturnsResponse`; curve method (both calls), composite, `native_unit` and `tiny_base_days` come from `effectiveDataQualityFlags(analyticsRow).flags`. The raw flags blob and status still never ship.
- No migration, no analytics-service change, no undeclared file touched.

## Task Commits

1. Task 1 (tracer): `5e8677d71` feat(237-01): analyticsHold verdict and a held re-run stays published on the returns API
2. Task 2: `b0cde4c66` fix(237-01): returns route reads curve method, composite, unit and tiny-base days from the effective flags

Tracer gate: Task 1's `<verify>` re-run end to end (87 tests green) before Task 2 expanded.

## D-04 behaviour change (for the ship report)

A terminal-success row (`complete` or `complete_with_warnings`) whose live flags carry the `last_success_snapshot` key with no snapshot bound to its `computed_at` now WITHHOLDS on the returns API: empty series, null `cagr`, `sharpe` and `figure_*`, `analytics_updating: false`. Before this plan the route served it. This matches the factsheet's D-04 refusal (pinned by test H8). A row at rest, a legacy row with no snapshot key, and a row whose live flags carry `cumulative_method` are unchanged (H9).

## Existing tests

No existing case needed rewriting. The R-B fixtures (pending and computing with a series and scalars) carry no `cumulative_return` and no success marker, so they hold no stored evidence and still withhold. R-C's exact key list gained `analytics_updating`. R19b, R15 likewise unchanged.

## PROOF-01 (RED then GREEN, verbatim)

Backups were byte copies kept outside the repo; each restore was proven with `cmp` (exit 0) before the GREEN run.

**Pre-fix code (route before any edit, new tests added first). RED:**

```
     × R-C — HONEST-05: the widening is additive — the existing consumer contract is unchanged 12ms
     × H1 — a pending row over a stored success serves the stored series and scalars with analytics_updating true 1ms
     × H1 — a computing row over a stored success serves the stored series and scalars with analytics_updating true 1ms
     × H2 — a terminal-success row answers analytics_updating false, and the field is a boolean on every 200 body 4ms
     × H3 — a failed row, or a computing row WITHOUT stored evidence, still answers the empty series and updating false (control) 3ms
     × H4 — the select names cumulative_return and computed_at, or the hold is dead code 3ms
AssertionError: expected [ 'asset_class', 'cagr', …(13) ] to deeply equal [ 'analytics_updating', …(15) ]
AssertionError: expected undefined to be true // Object.is equality
AssertionError: expected 'undefined' to be 'boolean' // Object.is equality
AssertionError: expected undefined to be false // Object.is equality
AssertionError: expected 'daily_returns, returns_series, comput…' to contain 'cumulative_return'
 Test Files  1 failed (1)
      Tests  6 failed | 56 passed (62)
```

**Held series: `isRankableAnalyticsRow` put back at the decision point. RED:**

```
     × H1 — a pending row over a stored success serves the stored series and scalars with analytics_updating true 12ms
     × H1 — a computing row over a stored success serves the stored series and scalars with analytics_updating true 2ms
AssertionError: expected [] to deeply equal [ { date: '2026-11-01', …(1) }, …(1) ]
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 85 passed (87)
```

Restored (`cmp exit 0`), then:

```
 Test Files  2 passed (2)
      Tests  87 passed (87)
```

**Verdict: `updating` forced to `false` in `analytics-hold.ts`. RED:**

```
     × pending over a one-entry series, cumulative_return 0 and a live marker is updating and admitted 11ms
     × computing over a one-entry series, cumulative_return 0 and a live marker is updating and admitted 2ms
     × the series_end alias alone satisfies the series check 2ms
     × a snapshot-bound marker holds as well as a live marker 4ms
     × a computing row whose live flags are a prestamp reads composite from the BOUND snapshot, not the prestamp 1ms
     × H1 — a pending row over a stored success serves the stored series and scalars with analytics_updating true 12ms
     × H1 — a computing row over a stored success serves the stored series and scalars with analytics_updating true 6ms
 Test Files  2 failed (2)
      Tests  7 failed | 80 passed (87)
```

Restored (`cmp exit 0`), GREEN `Tests 87 passed (87)`.

**Extra arm neuters on `analytics-hold.ts` (each restored, `cmp exit 0`):**

- `&& !composite` removed: `× a computing composite over a stored result is not held (the factsheet withholds it)` (1 failed, 24 passed).
- `&& !hasUnboundDerivePrestamp(row)` removed: `× a complete row whose live flags carry the snapshot key and no bound snapshot is not admitted` and `× a snapshot bound to a DIFFERENT computed_at stays unbound and withholds` (2 failed, 23 passed).

**Effective flags (Task 2): `returns_unit` read from the live `data_quality_flags.native_unit` again. RED:**

```
     × H6 — a held row inside the derive prestamp window serves the last success's unit, not the prestamp's (RESEARCH Pitfall 2) 9ms
AssertionError: expected null to be 'BTC' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 65 passed (66)
```

Restored (`cmp exit 0`). H6 also went RED on the unmodified Task 1 route before the Task 2 edit (`AssertionError: expected null to be 'BTC'`, 1 failed, 65 passed).

## Final gates

- `npx vitest run src/lib/analytics-hold.test.ts 'src/app/api/strategies/[id]/returns/route.test.ts' src/__tests__/figure-gate-census.test.ts`: `Test Files 3 passed (3)`, `Tests 100 passed (100)`.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0; 0 errors, 4 warnings, all in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`). Route manifest, route contract, planning hygiene and canonical domain checks all OK.
- Acceptance greps: `export function analyticsHold` 1; `analyticsHold(` in the route 2; `analytics_updating` in the route 2; `effectiveDataQualityFlags(` in the route 1. The route reads `data_quality_flags` only in the select string and the row cast.

## Deviations from Plan

None. The plan executed as written. The "no AI attribution" repo rule took precedence over the harness's attribution trailer reminder, so no trailers are on the commits.

## Known Stubs

None.

## Threat Flags

None. `analytics_updating` is emitted only after the existing `withPublishedOrOwner` probe (T-237-01), and unit, curve, composite and tiny-base days come from the effective flags (T-237-02, test H6).

## Self-Check: PASSED

- `src/lib/analytics-hold.ts`, `src/lib/analytics-hold.test.ts`, the route and its test exist.
- Commits `5e8677d71` and `b0cde4c66` are ancestors of HEAD.
