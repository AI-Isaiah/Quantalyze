---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 13
subsystem: ui
tags: [scenario-composer, my-allocation-payload, held-rerun, analytics-hold, fact-02]
requires:
  - phase: 237-factsheethonest
    provides: "plan 01: analyticsHold (src/lib/analytics-hold.ts); plan 08: addedAnalyticsUpdatingByRef merged map and the S8 row line"
provides:
  - "MyAllocationDashboardPayload strategies[].strategy.analytics_updating, set on every book strategy from analyticsHold(analyticsObj).updating"
  - "the composer's book branch of addedAnalyticsUpdatingByRef reads found.strategy.analytics_updating === true"
affects: [237-11]
tech-stack:
  added: []
  patterns: ["server-side verdict, boolean-only on the wire: evidence columns joined to the embed, destructured away before the payload leaves"]
key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
key-decisions:
  - "analytics_updating lives on strategy (beside series_state), not inside strategy_analytics, so the client-facing strategy_analytics Pick keeps its five columns"
  - "cumulative_return and computed_at are added to the book strategy_analytics embed (analyticsHold needs the stored-result evidence and the snapshot binding instant) and stripped with the existing throwaway-name destructure"
requirements-completed: [FACT-02]
status: complete
commits: 1
plan_head_before: d1bcc15621b27999c2b72cca704fe7660996ac4f
plan_head_after: a98ee5cd67d4b3019b637533ef8ca793f9f1ff1c
actuals:
  tokens: 4600
  tasks: 2
  commits: 1
---

# Phase 237 Plan 13: the Updating line on the composer's book-strategy rows Summary

**getMyAllocationDashboard now decides `analytics_updating` per book strategy with `analyticsHold` and ships only that boolean; the composer's book branch reads it with book-wins precedence, so a held book row prints the same Updating line as a drawer-added row.**

Worktree base: re-based to `d1bcc15621b27999c2b72cca704fe7660996ac4f`, branch `worktree-agent-a31f3996ffa487b2b`.

## What changed

- `src/lib/queries.ts`: the My-allocation `strategy_analytics` embed gains `cumulative_return` and `computed_at`; the strip destructure drops both (`_cr`, `_ca`) beside `computation_status`; `analytics_updating = analyticsHold(analyticsObj).updating` is computed from the unstripped row and set in the payload literal beside `series_state`; the payload type gains `analytics_updating?: boolean` with a docblock.
- `ScenarioComposer.tsx`: the book branch of `addedAnalyticsUpdatingByRef` reads `found.strategy.analytics_updating === true` in place of plan 08's `false`. Lazy and default branches unchanged. The composer calls no census-scanned verdict symbol (only comments name them).
- `scenario-factsheet-payload.ts` is not touched (empty diff against the base), so the blend's own factsheet keeps `analyticsUpdating` false. The only render site of the line remains the row detail note slot; Holdings, the compare panel and the MTD column read nothing new (S8-9 asserts exactly one `data-degrade-id="scenario.analytics-updating"` element in the document).

## Tests added

- `queries.my-allocation.test.ts` (5 cases): truth table (computing or pending over a stored result true; complete, failed, first-ever compute, no finite headline false; composite computing with evidence false; no analytics row false and the key present); the embed selects `cumulative_return` and `computed_at`; the payload carries no `cumulative_return`, `computed_at`, `computation_status`, `data_quality_flags` or `returns_series`, and `strategy_analytics` keys equal the five original columns.
- `ScenarioComposer.test.tsx`: S8-7 rewritten (book false hides a lazy true; the book row's figures are asserted on screen so the absence is the rule's), S8-8 (book true shows the line over a lazy false), S8-9 (book row's line is byte-for-byte the drawer-added row's `outerHTML`, tag P, degrade id, text), S8-10 (book false and book absent show no line).

## PROOF-01

Byte backups with `cp` outside the repo; restored with `cp`; `cmp` proven; then GREEN.

**RED 1 - builder field forced false** (`analyticsHold(analyticsObj).updating && false`), `queries.my-allocation.test.ts`:

```
     × is true for a computing or pending row over a stored success result 7ms
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > getMyAllocationDashboard — Phase 237 FACT-02 analytics_updating (S8b) > is true for a computing or pending row over a stored success result
AssertionError: computing: expected false to be true // Object.is equality
      Tests  1 failed | 251 passed (251 -> 252 total)
```

Restore: `cp backup src/lib/queries.ts`, `cmp` exit 0. GREEN: `Test Files  1 passed (1)  Tests  252 passed (252)`.

Note: the plan expected the composer's book-true case to also fail under this neuter. It does not and cannot: composer tests feed the payload as a fixture and never call the builder. The composer arm is proven by RED 3 below.

**RED 2 - lazy value wins over the book value** (`addedAnalyticsUpdatingById[a.id] ?? found.strategy.analytics_updating === true`), composer `-t "Phase 237 FACT-02 S8"`:

```
     × S8-7 a strategy that is in the book takes the book value, not the lazily fetched one: book false hides a lazy true 335ms
     × S8-8 a strategy that is in the book takes the book value: book true shows the line over a lazy false 367ms
AssertionError: expected <p …(3)></p> to be null
TestingLibraryElementError: Unable to find an element by: [data-testid="scenario-detail-analytics-updating-dddddddd-1111-2222-3333-444444444444"]
 Test Files  1 failed (1)
      Tests  2 failed | 13 passed | 475 skipped (490)
```

**RED 3 - composer book branch forced false** (`found ? false : ...`):

```
     × S8-8 a strategy that is in the book takes the book value: book true shows the line over a lazy false 342ms
     × S8-9 a book-strategy row whose payload says analytics_updating true shows the same element as a drawer-added row, byte for byte 221ms
TestingLibraryElementError: Unable to find an element by: [data-testid="scenario-detail-analytics-updating-dddddddd-1111-2222-3333-444444444444"]
 Test Files  1 failed (1)
      Tests  2 failed | 13 passed | 475 skipped (490)
```

Restore after RED 2 and RED 3: `cp` from the byte backup, `cmp` exit 0 both times.

**GREEN** (all targeted files, `--maxWorkers=3`):

```
 Test Files  5 passed (5)
      Tests  855 passed (855)
```

(`queries.my-allocation.test.ts`, `ScenarioComposer.test.tsx`, `degrade-warnings.test.tsx`, `degrade-warning-scan.test.ts`, `figure-gate-census.test.ts`.)

## Gates

- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 4 warnings, all pre-existing in files this plan does not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`); planning-hygiene, route and domain checks OK. `eslint --no-cache` over the four changed files: no output.
- Acceptance greps: code-line `analyticsHold(` count in queries.ts = 1; code-line `analytics_updating` = 4; `strategy.analytics_updating === true` in the composer = 1.

## Deviations from Plan

None - plan executed as written. The two tasks landed in one commit because Task 2's cases live in the same four files as Task 1's and no source change was needed after the cases went green; the PROOF-01 note above records the one plan-expectation correction (RED 1 cannot turn a composer test red).

## Known Stubs

None.

## Threat Flags

None. T-237-13 (information disclosure) is mitigated by the destructure strip and pinned by the payload-keys test.

## Self-Check: PASSED
