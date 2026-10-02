---
phase: 100-optimizer-favorites-notes-kpi
plan: 02
subsystem: ui
tags: [react, nextjs, supabase, favorites, optimizer, watchlist, allocations, tdd]

# Dependency graph
requires:
  - phase: 98-portfolio-exposure
    provides: read-layer error discipline (throw-on-PostgREST, owner-scoped RLS client)
  - phase: portfolio-optimizer
    provides: PortfolioOptimizer.tsx (pending/computing/failed/stale states + refresh POST)
provides:
  - "watchlist-read.ts: getFavoritesWithStrategies + getOptimizerPrefetch (owner-scoped reads) with exported FavoriteRow / OptimizerPrefetch contract types for plan 100-04 page wiring"
  - "WatchlistPanel: dense favorites table (recency/name sort, trust-tier group, idempotent bulk-remove with per-row rollback, Suggested cross-link chip, honest-empty)"
  - "OptimizerPanel: thin wrapper reusing PortfolioOptimizer as an honest score-ranked list (never weights/pie) behind a portfolio selector + 0-portfolio gate + footer + tooltips"
  - "PortfolioOptimizer: SC-4-additive narrative title tooltips on its 3 metric labels"
affects: [100-04, allocations page wiring, PI-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Interface-first server-read module: exported types ARE the wave-2 wiring contract"
    - "Injected Supabase client param (not internal createClient) → directly unit-testable reads"
    - "Client-loop over an existing idempotent PUT for bulk mutation with per-row rollback"
    - "Sort-in-the-wrapper to keep a shared component's other mount byte-identical (SC-4)"

key-files:
  created:
    - "src/app/(dashboard)/allocations/lib/watchlist-read.ts"
    - "src/app/(dashboard)/allocations/lib/watchlist-read.test.ts"
    - "src/app/(dashboard)/allocations/components/WatchlistPanel.tsx"
    - "src/app/(dashboard)/allocations/components/WatchlistPanel.test.tsx"
    - "src/app/(dashboard)/allocations/components/OptimizerPanel.tsx"
    - "src/app/(dashboard)/allocations/components/OptimizerPanel.test.tsx"
  modified:
    - "src/components/portfolio/PortfolioOptimizer.tsx"

key-decisions:
  - "portfolios has no updated_at column → default portfolio = most-recently-CREATED (real created_at), not an invented timestamp (Rule 3 deviation)"
  - "trust_tier is derived from the latest strategy_verifications row (locked D-04: no strategies.trust_tier column), mirroring getStrategiesByCategory"
  - "Watchlist name links id-based /factsheet/[id] (the honest strategy-detail route); strategy slug stays in the contract type but is not the link basis"
  - "The Score tooltip (4th) + full metric glossary live in OptimizerPanel; PortfolioOptimizer only gains title attributes on its 3 existing labels (SC-4)"

patterns-established:
  - "Ranking honesty: optimizer suggestions render as a score-desc ranked list; pie/weights/allocation-% forbidden and asserted absent by test"
  - "Bulk mutation = client loop over an idempotent per-id route with optimistic removal + per-row rollback on partial failure"

requirements-completed: [PI-05]

# Metrics
duration: 13min
completed: 2026-07-12
---

# Phase 100 Plan 02: Watchlist + Optimizer panels (PI-05) Summary

**Owner-scoped watchlist-read contract + a dense favorites table (idempotent bulk-remove with per-row rollback) + an honest score-ranked optimizer wrapper reusing PortfolioOptimizer (never weights/pie), with verbatim narrative tooltips and a 0-portfolio gate.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-12T11:51:59Z
- **Completed:** 2026-07-12T12:05:34Z
- **Tasks:** 3 (all TDD RED→GREEN)
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments
- `watchlist-read.ts` — two owner-scoped RLS reads with throw-on-PostgREST discipline; exported `FavoriteRow` / `OptimizerPrefetch` types are the plan-04 wiring contract. Colocated unit test covers both throw paths, the 0-portfolio path, the default-portfolio pick (ordering honored), and empty-favorites — closing the branch ratchet before wave-2.
- `WatchlistPanel` — dense borderless favorites table: recency/name sort, real trust-tier grouping (rowgroups), idempotent bulk-remove (one PUT per selected id) with per-row rollback + `role=status` announcement, per-row star toggle, Suggested cross-link chip, verbatim honest-empty.
- `OptimizerPanel` — thin `next/dynamic` wrapper reusing PortfolioOptimizer; sorts suggestions score-desc in the wrapper (SC-4-safe), 0-portfolio honest gate, portfolio selector (≥2), mandatory footer disclaimer, four verbatim narrative tooltips; scores-not-weights enforced by an absence test.
- `PortfolioOptimizer` — SC-4-additive `title` tooltips on its 3 metric labels only (attribute-only; /portfolios/[id] values/ordering/DOM byte-identical). Existing portfolio suite green (168 tests).

## Task Commits

Each task was committed atomically (TDD: RED test authored, then GREEN implementation in the same task commit):

1. **Task 1: watchlist-read.ts + contract types** - `57949fc5` (feat)
2. **Task 2: WatchlistPanel** - `86352b41` (feat)
3. **Task 3: OptimizerPanel + PortfolioOptimizer tooltips** - `66122c28` (feat)

**Plan metadata:** _this commit_ (docs: complete plan)

## Files Created/Modified
- `src/app/(dashboard)/allocations/lib/watchlist-read.ts` - Owner-scoped favorites + optimizer-prefetch reads; exported contract types.
- `src/app/(dashboard)/allocations/lib/watchlist-read.test.ts` - Branch-heavy unit coverage (throws, 0-portfolio, default-pick, empty).
- `src/app/(dashboard)/allocations/components/WatchlistPanel.tsx` - Dense favorites table with sort/group/bulk-remove.
- `src/app/(dashboard)/allocations/components/WatchlistPanel.test.tsx` - Empty copy, per-id PUT loop, per-row rollback, star toggle.
- `src/app/(dashboard)/allocations/components/OptimizerPanel.tsx` - Honest ranked-list wrapper + selector + gate + footer + tooltips.
- `src/app/(dashboard)/allocations/components/OptimizerPanel.test.tsx` - Ranked order, no-weights absence, footer, tooltips, gate.
- `src/components/portfolio/PortfolioOptimizer.tsx` - Additive `title` tooltips on the 3 metric labels (SC-4).

## Decisions Made
- **Default portfolio = most-recently-created:** `public.portfolios` has no `updated_at` column, so the UI-SPEC's "most recently updated" resolves to the real `created_at`. No timestamp invented.
- **trust_tier from strategy_verifications:** locked decision D-04 — there is no `strategies.trust_tier` column; the latest verification row's tier is picked in JS (mirrors `getStrategiesByCategory` / `getPublicStrategyDetail`).
- **Injected client, not internal `createClient()`:** the reads take `(supabase, userId)` so plan 100-04 passes the page's already-created RLS client and the reads are directly unit-testable.
- **Score tooltip home:** the 4-metric glossary (incl. Score, which PortfolioOptimizer does not render as a cell) lives in OptimizerPanel; PortfolioOptimizer only receives `title` attributes on its 3 existing labels — the SC-4-minimal change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan/UI-SPEC referenced a nonexistent `portfolios.updated_at` column**
- **Found during:** Task 1 (watchlist-read.ts)
- **Issue:** The plan contract type `OptimizerPrefetch.portfolios` and the "default = most recently updated" rule name `updated_at`, but `public.portfolios` has only `created_at` (verified in database.types.ts).
- **Fix:** The contract surfaces the real `created_at`; the default portfolio is the most-recently-created one (`order created_at desc` → `[0]`). Documented in the module header and the unit test proves the ordering pick.
- **Files modified:** src/app/(dashboard)/allocations/lib/watchlist-read.ts (+ test)
- **Verification:** Unit test "(c) picks the MOST-RECENT portfolio as default among ≥2 (seeded out of order)" passes.
- **Committed in:** `57949fc5` (Task 1 commit)

**2. [Rule 1 - Correctness] Watchlist name link is id-based `/factsheet/[id]`, not slug-based**
- **Found during:** Task 2 (WatchlistPanel)
- **Issue:** The favorites `slug` is a STRATEGY slug, but the only slug-based strategy route (`/discovery/[slug]/[strategyId]`) needs a discovery CATEGORY slug that this read does not have. Linking by strategy slug would produce a broken URL.
- **Fix:** Link to the canonical id-based public sheet `/factsheet/${strategy_id}` (the same route StrategyTable/ShareableLink use). `slug` remains in the contract type per the plan.
- **Files modified:** src/app/(dashboard)/allocations/components/WatchlistPanel.tsx (+ test)
- **Verification:** Test asserts the exact `/factsheet/<id>` href.
- **Committed in:** `86352b41` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 correctness)
**Impact on plan:** Both keep the implementation honest against the real schema/routes. No scope creep; contract types unchanged in shape.

## SC-4 Boundary Note (PortfolioOptimizer)
The ONLY change to the shared `PortfolioOptimizer.tsx` (which also mounts on `/portfolios/[id]:353`) is the addition of `title` tooltip attributes to its three metric labels ("Sharpe lift", "Corr reduction", "DD improve"), mandated by the UI-SPEC W3 design contract. No metric value, row ordering, computation-state copy, or non-tooltip DOM changed — the full `src/components/portfolio/` suite (168 tests) stays green. The wrapper sorts suggestions score-desc rather than the shared component, so `/portfolios/[id]` ordering is untouched.

## Honesty Gates (all test-enforced)
- Optimizer renders a ranked list sorted by `score` DESC (Alpha 0.9 → Charlie 0.7 → Bravo 0.5 fixture).
- No pie/donut/weight-bar/"allocation %" framing — absence asserted; refresh path is `POST /api/portfolio-optimizer` only (never the weights endpoint — grep gate clean).
- Mandatory footer disclaimer + four verbatim narrative tooltips render.
- Watchlist bulk-remove issues one idempotent PUT per selected id with per-row rollback; honest-empty; grouping is real trust-tier only (no invented asset-class groups).

## Issues Encountered
- PortfolioOptimizer calls `useRouter()`, which needs the app-router context; the OptimizerPanel test mocks `next/navigation` (repo idiom) so the dynamically-mounted component renders.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 100-04 can import `getFavoritesWithStrategies` / `getOptimizerPrefetch` + `FavoriteRow` / `OptimizerPrefetch` and thread `favorites` / `optimizer` props into `page.tsx`'s `Promise.all` (Phase-99 exposure precedent), mounting `WatchlistPanel` + `OptimizerPanel` in `HoldingsTabPanel`.
- No page wiring shipped here by design; the exposure `getMyAllocationDashboard` payload is untouched (SC-4).

## Known Stubs
None — every rendered value flows from real reads/props; empty/degraded states are honest, not fabricated.

## Self-Check: PASSED
- All 6 source/test files present on disk; SUMMARY.md written.
- All 3 task commits present in git history (`57949fc5`, `86352b41`, `66122c28`).
- Full plan suite + portfolio suite green: 192 tests passing; tsc clean; lint 0 errors; `optimize-weights` grep gate clean.
- Note: `.planning/` is gitignored in this repo (local ledger) — SUMMARY/STATE/ROADMAP are not committed by convention.

---
*Phase: 100-optimizer-favorites-notes-kpi*
*Completed: 2026-07-12*
