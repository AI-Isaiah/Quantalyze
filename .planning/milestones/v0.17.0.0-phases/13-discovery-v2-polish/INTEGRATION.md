# Phase 13 — Cross-Phase + Cross-User-Role Integration Check

**Date:** 2026-04-28
**Branch:** `feature/v0.17-sprint-13`
**Scope:** Plans 13-01 (Watchlist) / 13-02 (Customize) / 13-04 (Sparkline) / 13-05 (Backfill)

## 1. Per-Role Integration Matrix

Surfaces (columns):
- W = Watchlist (StarToggle, WatchlistTabs, /api/watchlist/[strategyId], getMyWatchlist)
- C = Customize prefs (useDiscoveryPrefs, CustomizeDrawer, localStorage)
- S = Sparkline single-accent (sparklineColor)
- H = Hide-examples default + is_example backfill (migration 091)

| Role             | W                 | C                  | S                | H                          |
|------------------|-------------------|--------------------|------------------|----------------------------|
| Allocator        | INTEGRATED        | INTEGRATED         | INTEGRATED       | PARTIAL (UI ON; data deferred) |
| Strategy-Manager | NOT-APPLICABLE    | NOT-APPLICABLE     | NOT-APPLICABLE   | NOT-APPLICABLE             |
| Admin            | INTEGRATED        | INTEGRATED         | INTEGRATED       | PARTIAL (UI ON; data deferred) |
| Public           | NOT-APPLICABLE    | NOT-APPLICABLE     | NOT-APPLICABLE   | NOT-APPLICABLE             |
| Demo allocator   | INTEGRATED        | INTEGRATED         | INTEGRATED       | PARTIAL (UI ON; data deferred) |

### Notes per role

**Allocator** — `/discovery/[slug]/page.tsx:19-21` performs `auth.getUser()` and redirects to `/login` when null. `userId` is threaded into `StrategyTable` (`page.tsx:56`), which gates `<WatchlistTabs>` and `<StarToggle>` on `userId !== undefined` (`StrategyTable.tsx:330,356,408,536`). Watchlist round-trip is wired Page→server-fetch (`getMyWatchlist`)→`initialWatchedSet`→`StarToggle`→`PUT /api/watchlist/[strategyId]`→`user_favorites` (RLS auth.uid()=user_id, migration 024). `useDiscoveryPrefs(userId, slug)` writes/reads `discovery_view_preferences:{uid}:{slug}` (per-user-keyed).

**Strategy-Manager** — Does not visit `/discovery/*`. Uses `/strategies/*` which does NOT instantiate `StrategyTable` (zero matches in `(dashboard)/strategies/`). No regression risk: Phase 13 components are scoped to `StrategyTable.tsx` and `/browse/[slug]` (which omits `userId`). When `userId === undefined`, `WatchlistTabs`, `StarToggle` column, `CustomizeDrawer`, and `useDiscoveryPrefs` persistence all no-op (`discovery-prefs.ts:93,108`; `StrategyTable.tsx:356-366,536`).

**Admin** — Admins are routed identically through `(dashboard)/discovery/[slug]/page.tsx`. `getUser()` returns the admin's auth.uid. `localStorage` key uses `auth.uid` from the same source — no cross-account drift. RLS on `user_favorites` is per-user (auth.uid()=user_id) — admin's stars are admin's stars. No special-casing required.

**Public (signed-out)** — `proxy.ts:5,44-48` redirects unauthenticated requests to `/login` for any non-public route. `/discovery/*` is NOT in `PUBLIC_ROUTES`. Belt-and-braces: `page.tsx:21` does its own redirect. Public surface is `/browse/[slug]` (`src/app/browse/[slug]/page.tsx`), which calls `<StrategyTable>` WITHOUT `userId` → all Phase 13 surfaces inert. No localStorage key written, no PUT to `/api/watchlist/*` (that route also requires auth — returns 401 at `route.ts:51-53`).

**Demo allocator** — Demo account is a real authenticated allocator (UUID in `src/lib/demo.ts`). Same code path as Allocator. localStorage key includes demo's `auth.uid`. Rate-limit (`mandateAutoSaveLimiter`, 30/min) is keyed on `watchlist:${user.id}` (`route.ts:56`) → per-user, no cross-pollution. `user_favorites` RLS isolates demo data. No additional code path required.

## 2. Cross-Phase Seam Table

| Seam                                  | Status     | Evidence |
|---------------------------------------|------------|----------|
| Phase 11 → Phase 13 auth               | INTEGRATED | `route.ts:32,40-41` reuses `assertSameOrigin` from `@/lib/csrf` (Phase 11 contract); inline auth pattern documented as deliberate (Phase 11 `withAuth` does not forward Next 16 dynamic-segment ctx — see route docstring lines 24-27). |
| Phase 11 → Phase 13 rate-limit         | INTEGRATED | `route.ts:33,56-62` reuses `mandateAutoSaveLimiter` + `checkLimit` from `@/lib/ratelimit`; 30/min cap documented in TODOS Open Q #3. |
| Phase 12 → Phase 13 sparkline data     | INTEGRATED | `getStrategiesByCategory` (`queries.ts:173`) selects `strategy_analytics (*)` which includes `sparkline_returns` (verified at `queries.ts:212,453`; `types.ts:104`). `sparklineColor` consumes `number[]`; passes through to `<Sparkline>` (`StrategyTable.tsx:466-469`). Phase 12 `analytics-service` writes to `strategy_analytics_series` but the sparkline path reads `strategy_analytics.sparkline_returns` — independent column, no coupling. |
| 13-02 ↔ 13-05 (defaults × backfill)   | PARTIAL    | `discovery-prefs.ts:42` `hide_examples=true` is live. Migration `091_seed_is_example_backfill.sql` ships in tree but **not pushed to remote** (TODOS lines 47-66 — operator-gated due to remote-side migration drift). For seeded local DBs the cross-plan invariant holds; for production it is mechanically a no-op until the seeder runs (seed_uuid_count_pre_push = 0). |
| 13-01 ↔ Page (userId threading)        | INTEGRATED | `page.tsx:56` → `StrategyTable.userId` → `StrategyGrid.userId` (`StrategyGrid.tsx:27,36,76,139`) → `StarToggle` (gated). |
| 13-02 ↔ StrategyTable (controlled state) | INTEGRATED | `useDiscoveryPrefs(undefined, slug)` no-ops persistence (`discovery-prefs.ts:93,108`). Mirror effect on `prefsHydrated` only (`StrategyTable.tsx:172-181`) — locked per `tasks/lessons.md` "controlled-state regression" guard. |
| 13-04 ↔ Sparkline (single-accent)      | INTEGRATED | `sparklineColor` returns CSS-var only (`sparkline-color.ts:19-25`); regression spec `discovery-sparkline-regression.spec.ts` asserts no SVG mixes `#16A34A` + `#DC2626`. |

## 3. E2E Spec Coverage by Role

| Spec                                          | Role(s) covered     | Mechanism |
|-----------------------------------------------|---------------------|-----------|
| `discovery-watchlist.spec.ts`                  | Allocator           | Hard-coded `matratzentester24@gmail.com` test allocator. |
| `discovery-prefs-isolation.spec.ts`            | Allocator A vs B    | `seedTestAllocator()` → two fresh allocators. test.skip when seed-env not wired. |
| `discovery-sparkline-regression.spec.ts`       | Allocator           | Same hard-coded allocator fixture. |
| `discovery-hide-examples-default.spec.ts`      | Allocator (fresh)   | `seedTestAllocator()`; test.skip when seed-env not wired. |

**Coverage gaps (not necessarily blockers):**
- No spec for **Strategy-Manager** visiting `/discovery/*` — but per layout/role design, no route surfaces watchlist UI to a manager, and no manager-only flow uses `StrategyTable`. NOT-APPLICABLE.
- No spec for **Admin** visiting `/discovery/*`. Mechanically identical to Allocator path; risk = low. Optional gap.
- No spec asserting **Public** redirect from `/discovery/*` to `/login`. Covered by general proxy behavior (existing infra) but a Phase-13-specific assertion does not exist.
- No spec for **Demo** account exercising watchlist. Same code path as Allocator; verifies nothing new about demo plumbing.

## 4. Remediation List

| # | Severity | Item |
|---|----------|------|
| 1 | LOW      | Add a Playwright assertion that signed-out `GET /discovery/crypto-sma` 302s to `/login` (Phase-13-scoped public-redirect proof). |
| 2 | LOW      | Add a smoke test that admin-role auth.uid keys localStorage uniquely vs allocator (proves no shared key collision). |
| 3 | INFO     | Migration 091 push deferred — operator gate (TODOS.md lines 47-93). Does NOT block other phases (data-only, idempotent). The hide-examples UI works locally regardless; the migration is a defensive backfill for production-seeded rows that don't currently exist. |
| 4 | INFO     | Pre-existing TS noEmit error at `route.test.ts:128` (`TS2578: Unused '@ts-expect-error'`) — orthogonal to integration. |
| 5 | NIT      | Strategy-Manager negative spec: assert that visiting `/strategies/*` renders zero `WatchlistTabs`/`StarToggle` (proves no leak); currently relies on absence of import in `(dashboard)/strategies/`. |

## 5. Key Connections Verified

- `getMyWatchlist` (queries.ts:1703) → imported by `(dashboard)/discovery/[slug]/page.tsx:9` → result threaded to `StrategyTable.initialWatchedSet`.
- `PUT /api/watchlist/[strategyId]` → called by `StarToggle.attempt` (`StarToggle.tsx:78`).
- `sparklineColor` → imported by `StrategyTable.tsx:7` → applied at line 468.
- `useDiscoveryPrefs` → imported by `StrategyTable.tsx:26` → invoked at line 155.
- `CustomizeDrawer` → owned by StrategyTable; gated by `userId !== undefined` (line 536).
- `WatchlistTabs` → injected via `StrategyFilters.leadingSlot` only when `userId !== undefined` (lines 356-363).
- Migration 091 UUIDs ↔ seed-demo-data UUIDs ↔ hide-examples spec SEED_UUIDS — all three lists match the canonical `cccccccc-0001-...` set.

## Verdict

**INTEGRATED ACROSS ROLES + PHASES** — with 2 LOW-severity coverage nits and 1 known operator-gated deferral (migration 091 push) that does not block any other phase.
