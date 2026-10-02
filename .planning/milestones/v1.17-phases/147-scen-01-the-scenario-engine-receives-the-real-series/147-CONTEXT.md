# Phase 147: SCEN-01 — The scenario engine receives the real series - Context

**Gathered:** 2026-08-04
**Status:** Ready for planning

<domain>
## Phase Boundary

A strategy added to a scenario contributes its actual return series — never silent zeros.
The defect is in the READER, not the writer: `strategy_analytics.daily_returns` has NO
production writer (only demo/e2e seeds populate it; 0/27 real strategies vs 15/15 demo),
while the real series lives in `returns_series` as a wealth index. The composer's returns
route selects only the dead column and collapses every real strategy to `[]` → 0.00
metrics / "0 overlapping days".

In scope: the bare-reader class (three sites), the structural one-mechanism assertion,
and the honest empty/degraded state. Out of scope: any writer/backfill (⛔ fights
migration 087 / decision D-02 — heavy series deliberately moved off `strategy_analytics`,
1MB TOAST ceiling), composer legibility (Phase 152), AUM (Phase 151).

</domain>

<decisions>
## Implementation Decisions

### Fix scope (Area 1)
- Fix ALL THREE bare readers of `strategy_analytics.daily_returns`, not just the composer:
  1. `src/app/api/strategies/[id]/returns/route.ts:221` (the SCEN-01 bug proper)
  2. `src/app/scenario-share/[token]/share-resolve.ts:184` (share recipients see the same zeros)
  3. `src/app/api/og/factsheet/[id]/route.tsx:63` (OG image sparkline)
  Class closure per the standing fix-campaign rule (close the whole class across the surface).
- Differencing stays INSIDE `resolveDailyReturnSeries` (it already differences wealth curves
  via `equityCurveToDailyReturns`). Call sites only widen their select to
  `daily_returns, returns_series` and call the resolver. No new fetch abstraction.

### Structural assertion (Area 2)
- SC2 ("no third mechanism") is enforced by a grep-gate vitest: repo-wide scan that fails
  if any `strategy_analytics` select fetches `daily_returns` without also fetching
  `returns_series` and resolving through `resolveDailyReturnSeries`.
- SC3 differencing regression is a ROUTE-LEVEL test on the composed path: feed an analytics
  row whose `returns_series` starts at exactly 1.0 and assert day one is NOT +100%. This
  tests the wiring (fails if the route stops invoking the resolver), not just the helper —
  per the economic-invariant-oracle testing rule.

### Honest empty state (Area 3)
- A strategy with genuinely no stored series remains ADDABLE to a scenario; its composer
  row shows an explicit no-data state and is excluded from the blend with a visible note
  (matches the existing warm-up gate; fresh keys legitimately sync ~10–15 min).
- Two distinct states derived from `strategy_analytics` status:
  - computing/in-flight → "Syncing — first metrics arrive in ~10–15 min"
  - terminal with no series → "No return series available"
  Never 0.00 metrics with no signal; never a fabricated series.

### Claude's Discretion
- Exact copy wording (within the two-state structure above), test file placement,
  and whether the OG route reuses the resolver directly or via its existing normalize path —
  provided the grep-gate passes and no third mechanism is minted.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveDailyReturnSeries(dailyReturnsRaw, returnsSeriesRaw)` at
  `src/lib/factsheet/allocator-portfolio-payload.ts:51` — tries `daily_returns` first,
  falls back to differencing the wealth index via `equityCurveToDailyReturns`. Has tests
  (`allocator-portfolio-payload.test.ts`, incl. column-drift fallback + null/undefined → []).
  Its docstring names this exact bug.
- `normalizeDailyReturns` (`portfolio-math-utils`) — canonical parser handling array,
  flat-dict, and nested year-keyed record shapes; already used by the returns route.

### Established Patterns
- Both strategy-detail surfaces already resolve correctly:
  `factsheet/[id]/v2/page.tsx:71` and `discovery/[slug]/[strategyId]/page.tsx:65`.
- The returns route already: probes visibility via `withPublishedOrOwner`, redacts
  Postgres errors (T-29-02), normalizes JSONB through `normalizeDailyReturns` (WR-05 guard),
  forwards only the strict `composite` boolean from `data_quality_flags` (T-111-03).
  All of that is preserved; only the select width + resolution change.
- Grep-gate vitest pattern is established in this repo (v1.10 e2e grep-gates; scan src/).

### Integration Points
- Composer blend consumes the returns route response — response SHAPE stays identical
  (differenced daily returns), so no downstream composer change for the happy path.
- Empty-state UI: composer row rendering (scenario composer) — needs the two-state
  pending/terminal distinction; check what status fields the route/row already receive.

</code_context>

<specifics>
## Specific Ideas

- Founder's MT5 strategy must contribute its 136 days (matching stored `csv_daily_returns`
  span), not "0 overlapping days" / 0.00 everywhere — this is the acceptance anchor.
- ⚠️ `returns_series` verified on PROD for `4eab92b0`: starts exactly 1.0, ends 0.7196 —
  shape-identical to `DailyPoint[]`, semantically inverted. Forwarding it raw makes day
  one +100%.
- ⛔ Never backfill `strategy_analytics.daily_returns` — migration 087 (`20260428120919`,
  D-02) deliberately moved heavy series off that table.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
