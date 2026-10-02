---
phase: 15-csv-unblock
plan: 03
subsystem: ui
tags: [react, typescript, supabase, trust-tier, design-system, vitest]

# Dependency graph
requires:
  - phase: 15-csv-unblock
    provides: strategy_verifications table with trust_tier column (plan 15-01 / migration 093)
  - phase: 15-csv-unblock
    provides: finalize_csv_strategy RPC inserting one strategy_verifications row per CSV strategy (plan 15-02)
provides:
  - "<TrustTierLabel> component (csv_uploaded variant only — Phase 15 v0)"
  - "CSV_UPLOADED_LABEL exported single-source-of-truth string"
  - "Strategy.trust_tier optional client-side projection field"
  - "queries.ts left-join + most-recent verification picker on getStrategyDetail + getStrategiesByCategory"
  - "TrustTierLabel wired into StrategyHeader (factsheet) and StrategyGrid (marketplace tile)"
affects:
  - 17-design-contract (DESIGN-01 / Phase 17 swaps the component internals to a polished outline pill without changing call-sites or the CSV_UPLOADED_LABEL string)
  - 19-unified-backbone (BACKBONE-01 will unify the trust_tier read path across all query functions; Phase 15 only wires the two consumer surfaces)
  - 18-root-cause-fix (FIX-03 metrics_snapshot/fingerprint parity verification will rely on the trust_tier label being readable on the same surface as Verified strategies)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-render label component pattern (no client directive, no hooks) mirroring SyncBadge.tsx"
    - "Client-side projection of joined row data — Supabase left-join + .map()/sort picker hoists the latest verification's trust_tier onto the typed Strategy field, avoiding denormalisation onto the strategies table"
    - "Single-source-of-truth string export pattern (CSV_UPLOADED_LABEL) so Phase 17 can promote the literal to a design token without touching call-sites"

key-files:
  created:
    - src/components/strategy/TrustTierLabel.tsx
    - src/components/strategy/TrustTierLabel.test.tsx
  modified:
    - src/lib/types.ts
    - src/lib/queries.ts
    - src/components/strategy/StrategyHeader.tsx
    - src/components/strategy/StrategyGrid.tsx

key-decisions:
  - "Strategy.trust_tier is a CLIENT-SIDE projection populated by queries.ts after a Supabase left-join on strategy_verifications — there is NO strategies.trust_tier column (locked decision D-04, no denormalisation)"
  - "Phase 15 v0 ships only the csv_uploaded variant of <TrustTierLabel>; api_verified / self_reported / null / undefined return null. Phase 17 / DESIGN-01 fills those in by swapping the component internals (call-sites unchanged)"
  - "Most-recent verification row picker uses created_at DESC sort. Phase 15 has at most one row per strategy_id (finalize_csv_strategy inserts exactly one); the picker is forward-compatible with Phase 19 multi-row scenarios"
  - "Other query functions (fetchStrategyLazyMetrics, getStrategyDetailV2, getPublicStrategyDetail, getFactsheetDetail) intentionally NOT touched in Phase 15 — Phase 19 / BACKBONE will unify the trust_tier read path across all surfaces"

patterns-established:
  - "Trust-tier label: pure render, prop-typed component with a data-trust-tier attribute for visual-regression test targeting and a single-source-of-truth string constant for design-token promotion"
  - "Verification join: SELECT *, strategy_analytics (*), strategy_verifications (trust_tier, status, created_at) → .map() with created_at DESC sort to pick latest → hoist onto typed Strategy.trust_tier"

requirements-completed:
  - CSV-03

# Metrics
duration: 5min
completed: 2026-05-01
---

# Phase 15 Plan 03: TrustTierLabel + Strategy.trust_tier Read-Side Wiring Summary

**`<TrustTierLabel>` component + Strategy.trust_tier optional field + Supabase left-join projection on getStrategyDetail/getStrategiesByCategory + factsheet-header and marketplace-tile call-sites — CSV-onboarded strategies now display "CSV uploaded — verification pending" inline next to the strategy name on both surfaces.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-01T03:25:23Z
- **Completed:** 2026-05-01T03:30:18Z
- **Tasks:** 3 / 3
- **Files created:** 2
- **Files modified:** 4

## Accomplishments

- Shipped `<TrustTierLabel>` component (csv_uploaded variant only — Phase 17 fills api_verified + self_reported) with the locked literal "CSV uploaded — verification pending" exported as `CSV_UPLOADED_LABEL` for design-token promotion.
- Extended `Strategy` interface with optional `trust_tier?: 'api_verified' | 'csv_uploaded' | 'self_reported' | null` — a CLIENT-SIDE projection populated by queries.ts after the Supabase left-join, NOT a denormalised column on the strategies table (locked decision D-04).
- Wired `getStrategyDetail()` and `getStrategiesByCategory()` to left-join `strategy_verifications (trust_tier, status, created_at)` and project the most-recent row's `trust_tier` (sorted by `created_at` DESC) onto the typed `Strategy` field.
- Inserted `<TrustTierLabel>` between `<h1>` and the status `<Badge>` in `StrategyHeader` (factsheet header per UI-SPEC §6 row 8) and immediately above `<SyncBadge>` in `StrategyGrid` (marketplace tile per UI-SPEC §6 row 9).
- 7/7 new vitest cases pass for `TrustTierLabel`; 26/26 existing `queries.test.ts` cases still pass (zero regression); 213/213 strategy component tests pass.
- `npx tsc --noEmit` reports zero errors project-wide.

## Task Commits

Each task was committed atomically (Task 1 followed TDD RED → GREEN):

1. **Task 1 (RED): TrustTierLabel failing test** — `c1eeaa5` (test)
2. **Task 1 (GREEN): TrustTierLabel component** — `b6bc781` (feat)
3. **Task 2: Strategy.trust_tier + queries.ts left-join** — `6f1802a` (feat)
4. **Task 3: Wire <TrustTierLabel> into StrategyHeader + StrategyGrid** — `7ed18e2` (feat)

## Files Created/Modified

- `src/components/strategy/TrustTierLabel.tsx` — New pure-render component. Renders a span with `text-xs text-text-muted` when `trustTier === "csv_uploaded"`; returns `null` otherwise. Exports `CSV_UPLOADED_LABEL` constant + `TrustTier` union type. Carries `data-testid="trust-tier-label"` and `data-trust-tier="csv_uploaded"` attributes for test/visual-regression targeting.
- `src/components/strategy/TrustTierLabel.test.tsx` — New vitest spec with 7 cases: csv_uploaded renders the locked text + data attribute; api_verified / self_reported / null / undefined render nothing; CSV_UPLOADED_LABEL is the single source of truth; caller-provided `className` appends to the locked typography classes.
- `src/lib/types.ts` — Added `trust_tier?:` field at the end of the `Strategy` interface with a comment block documenting that it's a client-side projection (no DB column).
- `src/lib/queries.ts` — Extended `getStrategyDetail` SELECT to include `strategy_verifications (trust_tier, status, created_at)`; added a most-recent-by-`created_at` picker that hoists the value onto a new `strategyWithTier: Strategy` object and feeds that into `readDisclosureTier` / `loadManagerIdentity` / the return shape. Same change applied to `getStrategiesByCategory` inside the existing `.map()`.
- `src/components/strategy/StrategyHeader.tsx` — Imported `TrustTierLabel`; inserted `<TrustTierLabel trustTier={strategy.trust_tier} />` between `<h1>` and `<Badge label={strategy.status} type="status" />` in the existing `flex items-center gap-3 mb-2` row.
- `src/components/strategy/StrategyGrid.tsx` — Imported `TrustTierLabel`; inserted `<TrustTierLabel trustTier={s.trust_tier} className="mb-1" />` immediately above the existing `<SyncBadge>` block. The `s` value is typed `StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics }`, so `s.trust_tier` resolves cleanly without a cast — the un-cast preferred form per the plan.

## Decisions Made

- Followed the plan's locked decisions (D-04 no denormalisation; D-06 ship csv_uploaded variant only). No new architectural decisions made.
- Followed the plan's preference for the un-cast `s.trust_tier` form in StrategyGrid over the safe-fallback cast: since Task 2 added `trust_tier?` to the `Strategy` interface and `StrategyWithAnalytics = Strategy & {...}`, the un-cast form types cleanly.
- Used the project's existing `cn(...)` helper from `@/lib/utils` for class composition (matches `SyncBadge.tsx` / `FreshnessBadge.tsx` analogs).

## Deviations from Plan

None — plan executed exactly as written.

The plan's acceptance grep gate `grep -c '"use client"' returns 0` initially matched a literal occurrence of the string `"use client"` inside a doc comment ("no `"use client"`, no hooks"). This was caught during Task 1 verification and the comment was rephrased ("no client directive, no hooks") so the grep gate returns 0 as required. The component itself was always pure-render (no client directive at file head); only the comment text changed. This is not a deviation from plan intent — it's compliance with the literal grep gate. The change landed inside the same Task 1 GREEN commit (b6bc781).

## Issues Encountered

None. All three tasks executed cleanly:

- Task 1 RED produced the expected import-resolution failure (TrustTierLabel.tsx did not exist yet).
- Task 1 GREEN: 7/7 tests passing on first run.
- Task 2: tsc clean on first run; queries.test.ts 26/26 still passing.
- Task 3: tsc clean on first run; 213/213 strategy component tests passing.

## User Setup Required

None — no external service configuration required. The trust_tier value flows from `strategy_verifications.trust_tier` (table created in plan 15-01 / migration 093) via SQL left-join in queries.ts, projected onto `Strategy.trust_tier` in TypeScript, and rendered via `<TrustTierLabel>`. No env vars, no dashboard config.

## Next Phase Readiness

**Ready for Plan 15-04+** (the remaining plans in Phase 15):

- Plan 15-04 wizard branch can rely on `<TrustTierLabel>` already shipping — strategies created via the CSV path will display "CSV uploaded — verification pending" automatically once `finalize_csv_strategy` (plan 15-02) inserts a `strategy_verifications` row with `trust_tier='csv_uploaded'`.
- Plan 15-06 happy-path E2E can assert the literal text "CSV uploaded — verification pending" appears on `/strategies/[id]` after CSV upload, and on the marketplace tile.
- Plan 15-07 admin status page reads `strategy_verifications` rows directly; this plan does not affect that surface (admin page reads the table, this plan reads via the strategies join).

**Ready for Phase 17 (DESIGN-01):** the component contract is locked. Phase 17 swaps the internals to a polished outline pill (#4A5568 neutral) by editing only `TrustTierLabel.tsx` — call-sites in StrategyHeader / StrategyGrid stay byte-for-byte identical, and the `CSV_UPLOADED_LABEL` constant promotes cleanly to `src/lib/design-tokens/trust-tier.ts`.

**Ready for Phase 19 (BACKBONE):** the `getStrategyDetail` / `getStrategiesByCategory` functions are the only two trust_tier read paths wired in Phase 15. Phase 19 will unify the read path by extending the same left-join projection to `getStrategyDetailV2`, `getPublicStrategyDetail`, and `getFactsheetDetail` (intentionally untouched here per the plan's scope boundary).

## Self-Check: PASSED

- Files created (verified existing on disk):
  - `src/components/strategy/TrustTierLabel.tsx` — FOUND
  - `src/components/strategy/TrustTierLabel.test.tsx` — FOUND
- Files modified (verified by `git log` showing edits in plan commits):
  - `src/lib/types.ts` — committed in 6f1802a
  - `src/lib/queries.ts` — committed in 6f1802a
  - `src/components/strategy/StrategyHeader.tsx` — committed in 7ed18e2
  - `src/components/strategy/StrategyGrid.tsx` — committed in 7ed18e2
- Commits exist (verified via `git log --oneline`):
  - `c1eeaa5` test(15-03): add failing test for TrustTierLabel component — FOUND
  - `b6bc781` feat(15-03): implement TrustTierLabel component (csv_uploaded variant only) — FOUND
  - `6f1802a` feat(15-03): wire Strategy.trust_tier via strategy_verifications left-join — FOUND
  - `7ed18e2` feat(15-03): wire TrustTierLabel into StrategyHeader + StrategyGrid — FOUND
- Branch unchanged: `v1.0.0-api-key-rewrite-15-16`
- STATE.md / ROADMAP.md NOT modified by this agent (verified via `git status --short`).

## TDD Gate Compliance

- Task 1 RED gate: `c1eeaa5` (test commit; vitest fails because component does not exist).
- Task 1 GREEN gate: `b6bc781` (feat commit; 7/7 tests pass).
- No REFACTOR commit was needed — the GREEN implementation already satisfies the locked DESIGN.md typography (`text-xs text-text-muted`) and the SyncBadge.tsx analog pattern.

---
*Phase: 15-csv-unblock*
*Plan: 03*
*Completed: 2026-05-01*
