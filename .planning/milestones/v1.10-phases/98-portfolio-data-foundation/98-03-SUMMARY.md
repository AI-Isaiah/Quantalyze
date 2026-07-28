---
phase: 98-portfolio-data-foundation
plan: 03
subsystem: api
tags: [allocator-holdings, exposure, rls, supabase, read-layer, vitest, tdd]

# Dependency graph
requires:
  - phase: 98-portfolio-data-foundation
    provides: allocator_holdings owner-RLS table + locked data-shape decisions (D-P1/D-P2/D-P3/D-P7)
provides:
  - "src/lib/portfolio-exposure.ts — server-only, owner-scoped, secretless read layer over allocator_holdings"
  - "getLatestExposureSnapshot (PI-01): latest-asof slices at the (holding_type, venue, symbol, side) grain with gross + signed net"
  - "getNetExposureSeries (PI-02): signed net + gross per existing asof, interior gaps marked (missingSegments shape)"
  - "getAllocationSeries (PI-03): per-venue gross weights per asof, zero-gross asof skipped into a gap"
  - "computeAsofGaps: pure exported UTC gap detector"
affects: [phase-99, portfolio-widgets, exposure-by-asset-class, net-exposure-over-time, allocation-over-time]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-scoped USER-client read (createClient from @/lib/supabase/server) + explicit .eq(allocator_id) defence-in-depth over RLS; admin client never imported"
    - "Secretless six-column allow-list projection; raw-payload/key columns never selected"
    - "Honest-empty (null snapshot / empty series) + no-zero-fill marked gaps mirroring factsheet missingSegments"
    - "Pure-helper aggregation composed over one fetch; capturing thenable Supabase-server mock for arg-level assertions"

key-files:
  created:
    - src/lib/portfolio-exposure.ts
    - src/lib/portfolio-exposure.test.ts
  modified: []

key-decisions:
  - "D-P1: holding_type is the primary exposure class; snapshot exposes the raw (holding_type, venue, symbol, side) grain, display label deferred to Phase 99"
  - "D-P2: net exposure is SIGNED (short => -value_usd); both net and gross returned"
  - "D-P3: allocation weights are per-VENUE with gross denominators (no strategy linkage exists); zero-gross asof skipped, not NaN"
  - "D-P7: honest-empty null snapshot / empty series; gaps marked, never zero-filled"
  - "730-day .gte cap: a >730-day-stale allocator reads as honest-empty (W4 edge case, documented in module header)"

patterns-established:
  - "portfolio-exposure.ts read layer: the Phase 99 data contract for all three exposure widgets"

requirements-completed: [PI-01, PI-02, PI-03]

# Metrics
duration: ~20min
completed: 2026-07-12
---

# Phase 98 Plan 03: Portfolio Exposure Read Foundation Summary

**A server-only, owner-scoped, secretless read layer over `allocator_holdings` that hands Phase 99's three widgets their data — holding_type-primary exposure slices, signed net + gross series, per-venue allocation weights, honest-empty and coverage-mask-consistent — with zero new dependencies and zero UI.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-12T10:40:00Z
- **Completed:** 2026-07-12T10:45:00Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both created)

## Accomplishments
- Delivered `src/lib/portfolio-exposure.ts` (284 lines): `getLatestExposureSnapshot`, `getNetExposureSeries`, `getAllocationSeries`, and the pure exported `computeAsofGaps`, implementing the locked D-P1/D-P2/D-P3/D-P7 data shapes exactly.
- Owner-RLS boundary enforced end-to-end: USER `createClient`, explicit `.eq("allocator_id", userId)`, six-column secretless projection, 730-day `.gte("asof")` cap; the admin client is never imported (asserted both by a throwing `vi.mock` and a source-level fs check).
- Signed-net truth (D-P2): a hedged book (long 300 + short 100) reads net 200 / gross 450 across the mixed-book fixture; no-zero-fill gap marking mirrors the factsheet `missingSegments` shape.
- TDD RED→GREEN proven offline: 17/17 vitest passing, `tsc --noEmit` exit 0, eslint clean on both files.

## Task Commits

1. **Task 1: Failing-first vitest for the exposure read layer** — `0d01ad69` (test)
2. **Task 2: Implement src/lib/portfolio-exposure.ts** — `e3969957` (feat)

_TDD: Task 1 committed the RED spec (module-not-found); Task 2 committed the GREEN implementation._

## Files Created/Modified
- `src/lib/portfolio-exposure.ts` — server-only read layer + pure aggregation helpers; module header documents D-P1/D-P2/D-P3, the no-zero-fill/marked-gap invariant (factsheet anchor), and the W4 >730-day-stale edge case for Phase 99 readers.
- `src/lib/portfolio-exposure.test.ts` — vitest covering all seven behaviour clusters (honest-empty, owner gate + no-admin-import, secretless projection, signed net, latest-asof-only, gap marking + `computeAsofGaps` units, per-venue weights + zero-gross skip). Mocking convention mirrors `src/lib/queries.percentiles.test.ts` (hoisted resolver + thenable capturing chain).

## RED → GREEN Evidence
- **RED (Task 1):** `npx vitest run src/lib/portfolio-exposure.test.ts` failed with `Failed to resolve import "./portfolio-exposure"` — module did not yet exist. Recorded before Task 2.
- **GREEN (Task 2):** `17 passed (17)`.
- **Typecheck:** `npx tsc --noEmit` exit 0 (no portfolio-exposure errors, full-project clean).
- **Lint:** `npx eslint src/lib/portfolio-exposure.ts src/lib/portfolio-exposure.test.ts` clean.
- **Contract greps:** `grep -c "supabase/admin"` = 0; `grep -c "raw_payload\|api_key"` = 0.

## Decisions Made
None beyond the planner-locked D-P1/D-P2/D-P3/D-P7 and gap/cap conventions — implemented as specified.

## Deviations from Plan

None materially — plan executed as written. One in-task mechanism fix worth noting (not a contract change):

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Source-level no-admin check used a non-file URL scheme under vitest**
- **Found during:** Task 2 (first GREEN run)
- **Issue:** The no-admin-import test read the module via `fileURLToPath(new URL("./portfolio-exposure.ts", import.meta.url))`; under vitest's transform `import.meta.url` is not a `file:` URL, throwing `TypeError: The URL must be of scheme file`.
- **Fix:** Read the module via `resolve(process.cwd(), "src/lib/portfolio-exposure.ts")`. Test intent and every assertion unchanged — the CONTRACT was not altered, only the file-path mechanism of one source-level check.
- **Files modified:** src/lib/portfolio-exposure.test.ts
- **Verification:** 17/17 GREEN; the check still fails if `supabase/admin` / `createAdminClient` appears in the module source.
- **Committed in:** `e3969957` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking).
**Impact on plan:** Mechanism-only fix to a test harness path; no scope creep, no contract change.

## Issues Encountered
None — RED and GREEN both landed on the first attempt after the harness path fix.

## User Setup Required
None — no external service configuration, no new dependencies, no migration.

## Next Phase Readiness
Phase 99 can render all three widgets from this module alone: the (holding_type, venue, symbol, side) grain supports asset-class grouping + venue/symbol drill-down; signed net + gross drive Net Exposure Over Time; per-venue weights drive Allocation Over Time; honest-empty and marked gaps are consistent with the factsheet coverage-mask convention. The three locked decisions and the >730-day-stale edge case are documented in the module header for Phase 99 executors. No blockers.

## Self-Check: PASSED
- FOUND: src/lib/portfolio-exposure.ts
- FOUND: src/lib/portfolio-exposure.test.ts
- FOUND: .planning/phases/98-portfolio-data-foundation/98-03-SUMMARY.md
- FOUND commit: 0d01ad69 (test — RED spec)
- FOUND commit: e3969957 (feat — implementation)

---
*Phase: 98-portfolio-data-foundation*
*Completed: 2026-07-12*
