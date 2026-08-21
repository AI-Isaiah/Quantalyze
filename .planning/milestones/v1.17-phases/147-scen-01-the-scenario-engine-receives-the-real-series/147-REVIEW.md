---
phase: 147-scen-01-the-scenario-engine-receives-the-real-series
reviewed: 2026-08-05T06:22:46Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - src/lib/factsheet/resolve-series.ts
  - src/lib/factsheet/allocator-portfolio-payload.ts
  - src/lib/closed-sets.ts
  - src/lib/closed-sets.series-state.test.ts
  - src/lib/queries.ts
  - src/lib/queries.my-allocation.test.ts
  - src/app/api/strategies/[id]/returns/route.ts
  - src/app/api/strategies/[id]/returns/route.test.ts
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/app/api/og/factsheet/[id]/route.test.tsx
  - src/app/scenario-share/[token]/page.tsx
  - src/app/scenario-share/[token]/page.test.tsx
  - src/app/scenario-share/[token]/share-resolve.ts
  - src/app/scenario-share/[token]/share-resolve.test.ts
  - src/app/(dashboard)/allocations/components/CoverageStateChip.tsx
  - src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/lib/mandate-gates.test.ts
  - src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts
  - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
  - src/__tests__/phase-147-series-resolution-guards.test.ts
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
status: issues_found
---

# Phase 147: Code Review Report

**Reviewed:** 2026-08-05T06:22:46Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Reviewed the four reader-site fixes (returns route, OG route, `getMyAllocationDashboard`, scenario-share page + resolve layer), the extracted leaf resolver, the `series_state` closed-set + discriminator, the composer's chip/note/hydration additions, and the structural grep-gate. I cross-checked the differencing math against the actual analytics-service writer (`metrics.py`: `returns_series = (1+returns_for_chart).cumprod()`, then `cap_data_points(…, 5000)` keep-most-recent), traced the BYPASSRLS sibling reads on the public share page, and traced the composer's lazy-fetch/hydration lifecycle (per-id abort map, stable `useCallback([])`, purge-on-remove — no cross-abort or refetch loop found).

**Money path:** the differencing itself is correct (verified against hand-computed ratios; the wealth index is never forwarded raw; direct-first precedence is pinned at all four sites). **Security:** the share page's two admin-transport sibling reads are bounded by construction to the RPC's own id output (`.in("strategy_id", seriesIds)` where `seriesIds` derives from `row.series`, which the SECURITY DEFINER RPC published-gates at read time); the raw wealth index never crosses to the client; the returns route's `series_state`/`created_at` reads fire only after the existing 404 existence gate and neither raw column ships (T-147-10 pinned by test). The widened two-table allow-list in `page.test.tsx` (flagged for review by 147-03) is sound: the mock's `from()` still throws on any third table, the projections and id-bounds are asserted call-by-call, and the omission of a `status` filter on the `strategy_analytics` read is correctly justified (no `status` column there; ids pre-gated in the RPC).

**No blockers.** The two warnings are (1) a test-fidelity gap on the money-path parity oracle — every wealth-index fixture carries a 1.0 base anchor the production writer never persists, so the "identical projection" claim over-promises what production data delivers — and (2) a cross-section double-labeling contradiction the new chip states introduce against the pre-existing auto-excluded group. Per the founder blast-radius bar (2026-07-29), neither clears the blocking threshold; both are logged here for fix-phase triage.

## Warnings

### WR-01: Wealth-index test fixtures are anchored at 1.0 — a shape the production writer never persists; the CSV↔analytics parity oracle over-promises

**Status:** FIXED — commit `a079638f` (2026-08-05). One production-shaped companion oracle per surface (`R12b` returns route, `O1c` OG route, `SC1b-share` share-resolve, page.test.tsx production-parity test), each pinning N stored points → N−1 returns, day-one absent, start date +1. The share-resolve "1.0 on day 0" writer comment corrected; the byte-identical parity assertion re-scoped as an anchored-fixture property with the companion pinning `analyticsHtml !== csvHtml` on production shape.
**File:** `src/app/scenario-share/[token]/page.test.tsx:208-216` (also `src/app/scenario-share/[token]/share-resolve.test.ts:913-929`, `src/app/api/strategies/[id]/returns/route.test.ts` (`WEALTH_INDEX`), `src/app/api/og/factsheet/[id]/route.test.tsx:170-175`)
**Issue:** The production `returns_series` is `(1 + returns).cumprod()` over the returns' own date index (`analytics-service/services/metrics.py:654,775-778`) — its FIRST element is `(1 + r_0)` at day 0, with **no prepended 1.0 base row** (the codebase itself documents this: `metrics.py:1250-1257` "a `(1+r).cumprod()` series whose first value is `(1 + r_0)` … day-0-exclusion semantics"). Every Phase-147 fixture instead prepends an explicit `{value: 1}` anchor one day earlier, so differencing recovers ALL N returns. On production data the resolver yields N−1 returns and **permanently drops day-one's return** (and shifts the derived `start_date` one day later). The code comments acknowledge the N−1 semantics honestly — and dropping day one is arguably the SAFE choice, since `cap_data_points` (`transforms.py:395-399`) truncates to the most recent 5000 points, making blind base-1.0 recovery unsafe on a truncated curve. But:
- `page.test.tsx:412` asserts `analyticsHtml === csvHtml` byte-for-byte ("the two fixtures carry identical economics by construction") — a parity that production data cannot deliver: an analytics-only leg will differ from its CSV twin by one daily return, one series-length count (`metrics.n`), and one start date.
- `share-resolve.test.ts:914-917`'s comment states the analytics-service writes "1.0 on day 0" — factually wrong about the writer.

This is exactly the self-referential-oracle class the project's testing feedback flags: the oracle pins the resolver's math against a fixture shaped for the resolver, not against the writer's real output.
**Fix:** Add one companion case per surface using an UNANCHORED, production-shaped index (first element `1 + r_0`), pinning explicitly: N stored points → N−1 returns, day-one return absent, `metrics.n === N−1`. Correct the share-resolve.test comment (the writer emits no day-0 base row). Optionally soften the byte-identical parity assertion to "identical given an anchored curve" or move it to a fixture-labelled variant so the claim matches production.

### WR-02: A syncing/empty added leg is double-labelled with CONTRADICTORY captions — "Syncing … arrive in ~10–15 min" in the main list vs "no data — outside window" in the auto-excluded group

**Status:** FIXED — commit `efb1ef77` (2026-08-05). The `autoExcluded` memo now consults the same merged `addedSeriesStateByRef` map and skips rows whose state ≠ `available` (UI-SPEC §2 copy untouched; non-added rows keep pre-147 behavior). Regression pin `SC4-10` proves a `computing` leg never appears in `scenario-auto-excluded-group` while B's genuine coverage-drop row still renders — verified red without the fix, green with it.
**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:3034-3061` (autoExcluded memo), `:476-488` (coverageDropReason), `:5704-5718` (new chip precedence)
**Issue:** The new chip precedence (147-UI-SPEC §2) carefully guarantees one signal per main-list row, and SC4/UI-SPEC #6 pins that — but only WITHIN the main list. The pre-existing auto-excluded group (`autoExcluded` memo) was not threaded with `series_state`: it admits any SELECTED, not-coverage-eligible strategy whenever a coverage window exists, and an empty-series leg has a `null` span, so `coverageDropReason(null, window)` renders **"no data — outside window"**. Reachable in the exact founder scenario this phase targets (fresh key syncing ~10–15 min, mixed book with a live intersection window): the same strategy renders simultaneously as (a) a main-list row with the amber "Syncing" chip + "First metrics arrive in ~10–15 min — not in the blend yet" and (b) an auto-excluded card claiming "no data — outside window". The two captions contradict — one says data is coming, the other says there is none, and "outside window" is false (there is nothing to be outside a window). Same duplication (consistent copy, but redundant) for the terminal `no-series` state. Numbers are unaffected (the leg contributes nothing either way), so this is a labeling-honesty defect, not a projection defect.
**Fix:** In the `autoExcluded` memo, consult the same merged `series_state` map and skip (or reword) rows whose state is not `available`, e.g.:
```ts
for (const s of engineSet.strategies) {
  if (!engineSet.state.selected[s.id]) continue;
  if (coverageEligible[s.id]) continue;
  // SCEN-01: a row with no series is not "outside the window" — the main
  // list's Syncing / No data chip is its ONE signal (UI-SPEC §2 precedence).
  const st = addedSeriesStateByRef[s.id] ?? "available";
  if (st !== "available") continue;
  …
}
```
plus a test pinning that a `computing` leg never appears in `scenario-auto-excluded-group`.

## Info

_Status: all six ACKNOWLEDGED (2026-08-05) — log-only per the founder blast-radius bar (2026-07-29); deliberately not fixed in the review-fix pass. IN-01/IN-02's latent-trap class is already booked as DEF-147-A/B in TODOS.md._

### IN-01: `daily_returns` payload type is now a guaranteed lie at runtime

**File:** `src/lib/types.ts:327`, `src/lib/queries.ts:1682-1690, 3576-3586`
**Issue:** `StrategyAnalytics.daily_returns` is typed `Record<string, Record<string, number>> | null`, and the dashboard payload's `Pick<StrategyAnalytics, "daily_returns"|…>` inherits it — but post-147 the emitted value is ALWAYS a resolved `DailyPoint[]` (laundered through the `Record<string, unknown>` cast). Consumers survive because they parse via `normalizeBookReturns(raw: unknown)`, but the type now invites a future consumer to `Object.entries()` an array. Same latent-trap class as the DEF-147-B annotations already booked in TODOS.md.
**Fix:** Narrow the payload-side field to `DailyPoint[]` (or `unknown`) in the `MyAllocationDashboardPayload` interface — type-only change.

### IN-02: LAYER A of the grep-gate only sees string-literal `.select()` arguments

**File:** `src/__tests__/phase-147-series-resolution-guards.test.ts:141-162`
**Issue:** `selectPayloads` extracts only quote/template-literal arguments. A future reader using `.select(SOME_CONST)` or a dynamically-built projection naming `daily_returns` is invisible to the repo-wide ban (Layer B would also not cover a brand-new file). Additionally, `getPortfolioStrategies` (`queries.ts:1299-1323`) passes Layer A textually (both columns in the select) while forwarding rows raw with no resolver — currently harmless (0 consumers read `daily_returns`; audit already booked as DEF-147-A/B in TODOS.md), but it demonstrates that "select names both columns" ≠ "surface resolves".
**Fix:** Log-only. If hardening is ever wanted: also scan for `daily_returns` inside exported `*_COLUMNS` constants that feed `.select(`, or extend Layer B when a new consumer of `getPortfolioStrategies` touches series columns.

### IN-03: `equityCurveToDailyReturns` silently bridges filtered gaps and tolerates duplicate dates

**File:** `src/lib/factsheet/resolve-series.ts:18-34`
**Issue:** Non-finite / ≤0 wealth points are filtered out BEFORE differencing, so the ratio spanning a removed point silently compounds across the gap (a corrupt interior point changes neighbouring "daily" returns with no signal). Duplicate-date JSONB is a documented reachable shape (`metrics.py:1268-1270`, `bridge_scoring.py:50`); the array path keeps both duplicates, emitting a ~0% return on a repeated date, which a downstream inner-join/date-map may double-count. Both degrade quietly rather than loudly (Rule 12 tension), but neither fabricates data.
**Fix:** Log-only. Optionally `console.warn` when the filter drops interior points, and de-dupe repeated dates (last-wins) before differencing.

### IN-04: The "Syncing" chip never self-resolves within a session

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1351, 5820-5828`
**Issue:** `series_state` is cached at fetch-settle (and a settled empty `[]` blocks the hydration effect's refetch guard, `addedReturnsById[a.id] === undefined`), and nothing re-polls. The `aria-live="polite"` note promises "First metrics arrive in ~10–15 min", but the chip stays "Syncing" until a remount/refresh (which does re-fetch via the hydration effect — so the staleness is session-bounded). Live region + a promise the UI cannot keep in-place is a mild honesty gap.
**Fix:** Log-only. A future pass could re-fetch `computing`-state ids on an interval or on tab-refocus.

### IN-05: OG card renders the "—" sentinel in red when CAGR is unavailable

**File:** `src/app/api/og/factsheet/[id]/route.tsx:134`
**Issue:** `tone={cagr >= 0 ? "pos" : "neg"}` — `NaN >= 0` is `false`, so the CAGR "—" placeholder renders in `#DC2626` red (Max DD's "—" is hard-red by design too). Absence rendered in the negative color contradicts the DESIGN.md "never red for absence" rule. Pre-existing tone logic; post-147 the blank card is much rarer, but still reachable (both columns null).
**Fix:** `tone={Number.isFinite(cagr) ? (cagr >= 0 ? "pos" : "neg") : undefined}`.

### IN-06: Simple-basis (allocated-capital) strategies get geometrically re-differenced returns

**File:** `src/lib/factsheet/resolve-series.ts:50-57` (interaction with `analytics-service/services/metrics.py:577-587`)
**Issue:** For `cumulative_method="simple"` strategies the persisted curve is `1 + Σr` (arithmetic), so the resolver's ratio differencing yields `r_i / (1 + Σ_{j<i} r_j)` — not the manager's reported daily % `r_i`. The equity curve round-trips exactly (compounding the derived series reproduces the stored curve — the correct investor-experience reading for a scenario), but per-leg vol/Sharpe/correlations computed downstream from the derived series will drift from the strategy's own headline metrics as cumulative return grows. This is inherent to deriving returns from ANY cumulative curve, matches the already-correct factsheet v2 reference behavior, and affects exactly the allocated-capital mandate class (the founder's MT5/Zavara anchor) — worth having on the record.
**Fix:** Log-only; no change recommended (the alternative — persisting true dailies for simple-basis strategies — is the "dailies are canonical" backbone direction, not a phase-147 patch).

---

_Reviewed: 2026-08-05T06:22:46Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
