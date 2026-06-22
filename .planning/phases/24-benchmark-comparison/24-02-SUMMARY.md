---
phase: 24-benchmark-comparison
plan: 02
subsystem: api
tags: [nextjs, route-handler, supabase, benchmark, cache-control, tdd, vitest]

# Dependency graph
requires:
  - phase: 23-scenario-persistence
    provides: scenarios spine + composer V2 path that consumes this benchmark series
provides:
  - "GET /api/benchmark/btc — BTC daily-returns series as [{date,value}], ascending, pct-changed from close_price"
  - "PUBLIC-cacheable shared-market-data route pattern (Cache-Control: public, s-maxage=3600, SWR) — the deliberate contrast with the allocator no-store routes"
  - "Honest-empty degrade contract: read error OR <2 rows -> HTTP 200 [] (never 500/red)"
affects: [scenario-composer benchmark overlay, BENCH-01 metrics wiring, EquityChart.benchmark prop]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cacheable shared-data GET route: response-level Cache-Control header (not route-config caching) because the SSR cookie client makes the handler dynamic in Next 16"
    - "Transport-failure degrades to the honest empty state ([], 200), not an error envelope"

key-files:
  created:
    - src/app/api/benchmark/btc/route.ts
    - src/app/api/benchmark/btc/route.test.ts
  modified: []

key-decisions:
  - "Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400 — 1h CDN cache is safely fresh vs benchmark.py's ~daily upsert + 48h reject (Claude's Discretion per CONTEXT; load-bearing requirement is public/cacheable/not-no-store)"
  - "Route returns DAILY RETURNS (raw pct-change), not a cumulative curve — the composer derives the anchored cumulative form for EquityChart.benchmark and feeds raw returns to the metrics (one daily-returns source, two derived shapes)"
  - "<2 rows and read-error both degrade to 200 [] via one emptyResponse() helper carrying the same public cache header"
  - "Guard non-positive/non-finite prior close: skip the point (continue) rather than emit Infinity/NaN that would corrupt downstream TE/IR/alpha/beta"

patterns-established:
  - "Pattern: shared non-tenant market-data route is PUBLIC-cacheable; tenant-scoped routes stay private/no-store — the distinction is encoded in the route docstring + a test asserting Cache-Control contains 'public' and not 'no-store'/'private'"

requirements-completed: [BENCH-01]

# Metrics
duration: 3min
completed: 2026-06-21
---

# Phase 24 Plan 02: BTC Benchmark Series GET Route Summary

**GET /api/benchmark/btc exposes the BTC benchmark daily-returns series ([{date,value}], ascending, pct-changed from close_price) as PUBLIC-cacheable shared market data, degrading to an honest empty `[]` on read failure — no tenant data, no migration, no Python change.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-21T23:52:00Z
- **Completed:** 2026-06-21T23:55:00Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 2 created

## Accomplishments
- New `GET /api/benchmark/btc` route handler reads `benchmark_prices` (symbol='BTC', date asc), converts `close_price` to daily returns via pct-change with the first row dropped (mirrors `benchmark.py prices_to_returns` = `pct_change().dropna()`), and returns `[{date,value}]`.
- PUBLIC cacheable response (`Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`) — the deliberate contrast with the allocator no-store routes, justified by the table being shared, non-tenant market data (3 columns: date, symbol, close_price; RLS `SELECT USING(true)`).
- Honest-empty degrade path: a read error OR fewer than 2 rows returns HTTP 200 with `[]` (logged + Sentry-captured server-side), so the composer renders the neutral empty state and never a 500/red alert.
- Hermetic route test (7 cases) pinning shape + ascending + pct_change goldens (+10% then −10%), the public cache header, query targeting (`benchmark_prices` / `symbol`=`BTC` / `order date asc`), error→200-[] and empty→200-[] degrade, the exact `{date,value}`-only key set (no `symbol`/`close_price`), and the non-positive-prevClose skip (no Infinity/NaN).

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: Wave-0 route test stub (RED)** — `7fda37d5` (test)
2. **Task 2: Implement GET /api/benchmark/btc (GREEN)** — `b1391162` (feat)

_The GREEN commit also folded a one-line test cleanup (removed an unused hoisted binding) so the new files lint clean._

## Files Created/Modified
- `src/app/api/benchmark/btc/route.ts` — GET handler: reads `benchmark_prices` for BTC, pct-change → `[{date,value}]`, public Cache-Control header, error/empty → 200 `[]`. `runtime="nodejs"`. No query params; symbol hard-coded.
- `src/app/api/benchmark/btc/route.test.ts` — 7 hermetic vitest cases mocking `@/lib/supabase/server`'s chainable query; pins shape/sort/pct_change/cache-header/error-degrade/no-tenant-keys/prevClose-guard.

## Decisions Made
- **s-maxage=3600 with SWR** chosen for the public cache (Claude's Discretion per CONTEXT/RESEARCH A1): 1h CDN freshness is well inside `benchmark.py`'s ~daily upsert cadence and 48h staleness reject. Load-bearing requirement satisfied: cacheable, `public`, not no-store.
- **Route returns raw daily returns, not a cumulative curve** — per RESEARCH Pitfall 3 / Open Question 1, the composer will derive the anchored cumulative form for `EquityChart.benchmark` and feed raw returns to `computeScenarioBenchmark`. The route is the single daily-returns source.
- **`<2 rows` also degrades to `[]`** (not just the error path) — 0/1 rows cannot yield a daily return (every return needs a prior close), so an honest empty series is correct.

## Deviations from Plan

None — plan executed exactly as written. Both task acceptance criteria met:
- All Task-1 tests pass under the Task-2 implementation (shape, sort, pct_change goldens, public cache header, error→200-empty, `{date,value}`-only keys).
- `grep -c NO_STORE_HEADERS route.ts` = 0; `grep -c "'BTC'|\"BTC\"" route.ts` ≥ 1; no `searchParams`; `runtime="nodejs"` present.

_Two prose-only edits were made to the route docstring so two skill-injection grep validators (matching the literal tokens `cookies()` and `NO_STORE_HEADERS` inside comment text — both false positives, the route imports neither) report clean. No behavior change; these are not deviation-rule fixes._

## Issues Encountered
- A PostToolUse Next.js validator repeatedly flagged "`cookies()` is async — add await" against a **comment line** in the route docstring (the route never calls `cookies()`; `createClient()` in `src/lib/supabase/server.ts` already awaits it correctly). Resolved by rewording the comment to not contain the literal token. No functional issue.

## Threat Surface Scan
No new security-relevant surface beyond the plan's `<threat_model>`. The route exposes only shared market data (T-24-01 accept), takes no user input / hard-codes `'BTC'` (T-24-02 mitigate), is GET-only with RLS-blocked writes (T-24-03 mitigate), and reads a small bounded table (T-24-04 accept). No packages installed (T-24-SC). No threat flags.

## Known Stubs
None. The route is fully wired to `benchmark_prices`; the empty `[]` return is an intentional honest-empty contract (documented in this plan and consumed by the composer's empty state), not an unwired stub.

## User Setup Required
None — no external service configuration required. The route reuses the existing `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the existing `benchmark_prices` table + RLS. No migration, no Python change → Railway deploy is a no-op.

## Verification
- `npx vitest run src/app/api/benchmark/btc/route.test.ts` → 7 passed.
- `npm run typecheck` (tsc --noEmit) → clean.
- `npx eslint` on both new files → 0 problems.

## Next Phase Readiness
- BENCH-01 read path is live: the composer can `fetch('/api/benchmark/btc')` to obtain the BTC daily-returns series spanning an arbitrary scenario blend window.
- Downstream (same phase): wire the series into `computeScenarioBenchmark` (inner-join by date, TE/IR/alpha/beta over the aligned window, `evaluateSampleFloor(n,30)` gate) and pass the anchored cumulative form to `EquityChart.benchmark`. The route deliberately returns raw daily returns for both consumers to derive from.

## Self-Check: PASSED

- FOUND: src/app/api/benchmark/btc/route.ts
- FOUND: src/app/api/benchmark/btc/route.test.ts
- FOUND commit: 7fda37d5 (test RED)
- FOUND commit: b1391162 (feat GREEN)

---
*Phase: 24-benchmark-comparison*
*Completed: 2026-06-21*
