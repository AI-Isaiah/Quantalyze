---
phase: 29-unified-composer-spine
plan: "01"
subsystem: api/strategies
tags: [unify-04, rls, lazy-fetch, scoped-read, redaction, tdd]
requires:
  - "RLS analytics_read policy (published-or-owned) on strategy_analytics"
  - "withAllocatorAuth role gate; withPublishedOnly published predicate"
  - "src/lib/portfolio-math-utils.DailyPoint shape"
provides:
  - "GET /api/strategies/[id]/returns — scoped lazy daily_returns supply for catalog adds"
  - "ReturnsResponse wire contract ({ daily_returns: DailyPoint[] })"
affects:
  - "Plan 29-04 composer wiring (addedReturnsById lazy map consumer)"
tech-stack:
  added: []
  patterns:
    - "RLS createClient() + withPublishedOnly existence-probe (NEVER service-role bypass)"
    - "isUuid-first 400 before auth/rate-limit (B15 ordering)"
    - "static 500 envelope + captureToSentry redaction (raw Postgres error never forwarded)"
    - "one-id-per-call scope (no unbounded analytics pull)"
key-files:
  created:
    - "src/app/api/strategies/[id]/returns/route.ts"
    - "src/app/api/strategies/[id]/returns/route.test.ts"
  modified: []
decisions:
  - "Lazy-fetch-on-add via scoped GET route (29-RESEARCH measured: SSR-lift = ~87KB gzip on every load vs ~7KB lazy per actual add); closes the gap for BOTH verified + example adds at once"
  - "RLS createClient() — analytics_read permits published reads (verified live anon 200), so no service-role bypass needed (LOCKED exit gate T-29-01/04)"
  - "404 (not 403) on unpublished/cross-tenant/missing — no existence oracle"
  - "Honest empty []: absent row / NULL / non-array collapses to [] (warm-up-gated out), never a fabricated flat series (Pitfall 4)"
metrics:
  duration: "~4 min"
  completed: "2026-06-23"
  tasks: 2
  files: 2
  commits: 2
---

# Phase 29 Plan 01: Scoped Lazy Daily-Returns Route Summary

A scoped `GET /api/strategies/[id]/returns` route that supplies one published strategy's `daily_returns` series under the RLS-scoped server client — the data-supply backbone for UNIFY-04 that lets a catalog-added strategy actually move the composer's projection (closing the book-only-payload gap for both verified and example adds, the H-0133 / example-add data gap).

## What Was Built

- **`src/app/api/strategies/[id]/returns/route.ts`** — `export const runtime = "nodejs"`; async `GET(req, ctx)` with `RouteCtx = { params: Promise<{ id: string }> }`. Flow:
  1. `await ctx.params` → `isUuid(id)` → 400 `{ error: "Invalid strategy id" }` + `NO_STORE_HEADERS`, **before** auth and rate-limit (B15 — a structurally-bad id never burns a token).
  2. Delegate to `withAllocatorAuth(...)(req)` (403 for non-allocator/both, upstream of any DB query).
  3. Per-user rate-limit `checkLimit(userActionLimiter, \`returns:${user.id}\`)` → 429 + `Retry-After` (503 on misconfigured limiter).
  4. `createClient()` (RLS) → published-existence probe `withPublishedOnly(supabase.from("strategies").select("id").eq("id", id)).maybeSingle()` → 404 `{ error: "Not found" }` on no row (no existence leak; covers unpublished + cross-tenant + missing).
  5. `supabase.from("strategy_analytics").select("daily_returns").eq("strategy_id", id).maybeSingle()`; on error → `console.error` + `captureToSentry(error, { tags: { route: "api/strategies/returns" } })` + static 500 `{ error: "Failed to load returns" }` (raw Postgres error never forwarded).
  6. `Array.isArray(raw) ? raw : []` → 200 `{ daily_returns }` + `NO_STORE_HEADERS`.
  - Exports a `ReturnsResponse` wire contract so `daily_returns` cannot be renamed/dropped silently.

- **`src/app/api/strategies/[id]/returns/route.test.ts`** — 9 non-vacuous cases (8 behaviors; the honest-empty case is split into absent-row + non-array). STATE-driven supabase mock copied from `browse/route.test.ts` (`vi.mock("server-only")`, `vi.hoisted(STATE)`, `from("profiles")` role arm for end-to-end `withAllocatorAuth`, `captureSpy`), extended with a `from("strategies")` existence-probe arm (records `observedFilters.status` so the `withPublishedOnly` predicate is observable, plus `strategiesEqId`) and a `from("strategy_analytics")` series arm (with an `analyticsQueryError` arm for the 500 path). A `strategiesQueried` short-circuit flag proves the 400/403 paths never touch the catalog.

## Test Coverage (all GREEN)

| Case | Behavior |
|------|----------|
| R1 | malformed uuid → 400 before auth/limit; `strategiesQueried===false`, `rateLimitKey===null` |
| R2 | role=manager → 403; `strategiesQueried===false` |
| R3 | probe finds no row → 404 + NO_STORE; filtered on requested id; no `daily_returns` in body |
| R4 | published row with array → 200 + exact series; analytics filtered on `strategy_id` |
| R5 | absent analytics row → 200 + `[]` |
| R5b | non-array `daily_returns` → 200 + `[]` (never fabricated) |
| R6 | DB error → 500 static envelope; raw `error.message` absent; `captureToSentry` with `tags.route==="api/strategies/returns"` |
| R7 | rate-limited → 429 + Retry-After; key `returns:<user.id>` (per-user, not per-id) |
| R8 | non-vacuity: `withPublishedOnly` appended `.eq("status","published")` (observed); RLS createClient is the wired path (200 proves it; no admin mock) |

## Verification

- `npx vitest run "src/app/api/strategies/[id]/returns/route.test.ts"` → 9 passed.
- Sibling suites still green: `browse/route.test.ts` + `saved/[id]/route.test.ts` → 45 passed.
- Acceptance gates: `grep -L createAdminClient` lists the file (token ABSENT — including in comments, reworded to "service-role bypass"); `withPublishedOnly` count 3 (≥1); `runtime = "nodejs"` ===1; redaction tag `route: "api/strategies/returns"` ===1.
- Exit gates: `git diff --exit-code src/lib/scenario.ts` clean (frozen engine untouched); `git status --porcelain supabase/migrations/` empty (no migration); `npx eslint` on both files exit 0 (B25 raw-published-predicate rule satisfied via `withPublishedOnly`).
- `npx tsc --noEmit` reports no errors for the new route.

## Threat Mitigations Applied (29-01 register)

- **T-29-01 (Info Disclosure)** — RLS `createClient()` + `withPublishedOnly` existence probe; unpublished/cross-tenant id → 404, never the series. (Test R3, R8.)
- **T-29-02 (Info Disclosure, DB error)** — `console.error` + `captureToSentry` + static 500 envelope; raw `error.message` never forwarded. (Test R6.)
- **T-29-03 (DoS/enumeration)** — `isUuid` 400 before auth; one-id-per-call; `withAllocatorAuth` + per-user `returns:${user.id}` rate-limit (B15 ordering). (Test R1, R2, R7.)
- **T-29-04 (Elevation)** — only `createClient()` (RLS); the service-role/admin client is structurally absent (grep-asserted in AC + documented in R8). (Test R8.)
- **T-29-SC (supply chain)** — zero installs in this plan's diff (29-RESEARCH: no new deps); none added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Reworded JSDoc to satisfy the literal `createAdminClient` grep exit-gate**
- **Found during:** Task 1 acceptance-criteria check.
- **Issue:** Two JSDoc comments documenting *why the admin client is deliberately avoided* contained the literal token `createAdminClient`. The plan's acceptance criterion (`grep -L createAdminClient ...` must list the file) and the threat-model T-29-04 assertion ("admin client structurally absent (grep-asserted)") are literal substring checks that do not distinguish comments from code — so the documentation produced a false-positive failure (`grep -L` returned empty; `grep -c` returned 2).
- **Fix:** Reworded both comments to "service-role / admin bypass" and "RLS-bypassing service-role client" — preserving the full security intent (RLS-only, never the privileged client) while removing the literal token. No behavioral change.
- **Files modified:** `src/app/api/strategies/[id]/returns/route.ts` (comments only).
- **Commit:** included in `940c4748` (the GREEN commit; the reword happened before staging).

No other deviations — the route and test were composed from the verified `browse/route.ts` (RLS read/redaction/headers) and `saved/[id]/route.ts` (async-params / isUuid-first / inner-wrapper) analogs exactly as the plan and 29-PATTERNS prescribe.

## TDD Gate Compliance

- RED gate: `test(29-01): add failing test for scoped lazy daily_returns route` — `8bd0e46b` (test fails: `Failed to resolve import "./route"`).
- GREEN gate: `feat(29-01): scoped lazy daily_returns route (UNIFY-04 server side)` — `940c4748` (all 9 cases pass).
- REFACTOR: none needed — the route is minimal and matches the analogs.

## Known Stubs

None. The route reads live `strategy_analytics.daily_returns` under RLS; the test drives real chained-builder behavior. No placeholder/empty-value patterns.

## Self-Check: PASSED

- FOUND: `src/app/api/strategies/[id]/returns/route.ts`
- FOUND: `src/app/api/strategies/[id]/returns/route.test.ts`
- FOUND commit: `8bd0e46b` (test/RED)
- FOUND commit: `940c4748` (feat/GREEN)
