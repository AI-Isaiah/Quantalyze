---
phase: 07-demo-mode-purge
verified: 2026-04-20T22:00:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
quality_gates:
  tsc: pass
  vitest: pass
  pytest: pass
  review_fix: pass
voices_accepted:
  f1: pass
  f2: pass
  f3: pass
  f4: pass
  f5: pass
  f7: pass
  f8: pass
  f9: pass
  gB2: pass
requirements:
  PURGE-01: satisfied
  PURGE-02: satisfied
  PURGE-03: satisfied
  PURGE-04: satisfied
  PURGE-05: satisfied
  PURGE-06: satisfied
  PURGE-07: satisfied
---

# Phase 07: Demo-Mode Purge — Verification Report

**Phase Goal (ROADMAP.md):** "The authenticated `/allocations` dashboard
derives every number it shows from real allocator holdings and Bridge
tables — zero seed fallback — and the page is tabbed so Performance
(daily monitoring) and Scenario (what-if) are first-class surfaces."

**Verified:** 2026-04-20T22:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A brand-new allocator with zero holdings sees a real empty state on `/allocations` with a single "Connect Exchange" CTA — no ghost widgets, no seed numbers. | PASS | `src/app/(dashboard)/allocations/EmptyState.tsx` (60 lines) renders one `Card`, one heading, one sub-line, one `Connect Exchange →` Link to `/profile?tab=exchanges`. `AllocationDashboard.tsx:675` short-circuits via early-return to `<EmptyState hasSyncing={false} />` when `holdingsSummary.length === 0 && !hasSyncing`. `EmptyState.test.tsx` (4/4 GREEN) pins D-07 minimalism and route invariance. |
| 2 | After Phase 06 ingestion completes, the Performance tab's KPI strip, equity curve, drawdown chart, and "What We Noticed" card all populate from real allocator data. | PASS | `getMyAllocationDashboard` (`src/lib/queries.ts`) reads `allocator_equity_snapshots` + `allocator_holdings` under RLS; derives `equitySnapshots`, `equityDailyPoints`, `snapshotCount`, `allKeysStale`, `holdingsSummary`, `activeVenues`, `minHistoryDepthMonths`. `!portfolio` early-return (previously blocked the whole page) now returns the full Phase 07 payload spread. `EquityCurve` and `DrawdownChart` accept `equityDailyPoints` parallel-prop; `AllocationDashboard.tsx:591` forwards it to both widgets via `renderWidget`. |
| 3 | `/allocations` is tabbed with Performance default and Scenario secondary; tab state survives a full page reload and back/forward navigation. | PASS | `AllocationsTabs.tsx` (132 lines) parses `?tab=` via `useSearchParams`, defaulting to Performance on any invalid / missing value. `activeTab` is **derived each render** from `searchParams` (no `useState`) per VOICES-ACCEPTED f3, so browser back/forward re-renders the correct tab (test #5 in `AllocationsTabs.test.tsx`, GREEN). `page.tsx:43` wraps in `<Suspense fallback={<div />}>` for Next.js 16 CSR-bailout compliance. |
| 4 | No authenticated code path still branches on `ALLOCATOR_ACTIVE` or seed UUIDs — the seed surface exists only for marketing `/demo` routes and unit-test fixtures. | PASS | `grep "ALLOCATOR_ACTIVE_ID\|isDemoPortfolioId" src` returns exactly 7 hits, all on the D-14 allowlist: `demo.ts` (def), `demo.test.ts`, `seed-integrity.test.ts`, `src/app/demo/**` (2), `src/app/api/demo/**` (2). Zero `@/lib/demo` imports under `src/app/(dashboard)/` or `src/lib/queries.ts`. `seed-integrity.test.ts` (7 new tests) mechanically enforces this invariant via import-graph static scan. |
| 5 | New-user signup no longer populates a seed portfolio; the first `/allocations` visit always shows the real empty state. | PASS | `OnboardingWizard.handleComplete` has **zero** `.insert()` calls on `portfolios`, `allocator_holdings`, `allocator_equity_snapshots` — verified by `OnboardingWizard.noseeed.test.tsx` (5/5 GREEN, mocks `@/lib/supabase/client` and asserts only `.from('profiles').update()` is invoked). `grep "ON auth.users" supabase/migrations/` → 1 hit (migration 002 `on_auth_user_created`, which inserts only into `public.profiles` — positive-controlled by f4 co-occurrence test). |
| 6 | `/allocations` populates KPIs, equity/drawdown, and insights from the real equity substrate — no seed composite fallback for zero-strategy allocators. (Implicit in SC2; validated by f2 widget-gating.) | PASS | `STRATEGY_COMPOSITE_WIDGETS` set at `AllocationDashboard.tsx:169` lists all 18 CamelCase widget names. `visibleConfig` useMemo (line 614) filters the grid by `hasStrategies = strategies.length > 0`. `AllocationDashboard.widget-gating.test.tsx` (4/4 GREEN) asserts the 18 widgets are HIDDEN for zero-strategy allocators while EquityCurve/DrawdownChart render a non-zero series from mocked snapshots (Grok f1 e2e). |
| 7 | Staleness protection: when all active keys last synced >24h ago, KPIs render `—`, charts get a 40%-dimmer overlay, and a `WarningBanner` invites the allocator to re-sync. | PASS | `AllocationDashboard.tsx:757` renders `<WarningBanner>` with "Data may be stale — last synced {X}h ago" when `allKeysStale && lastSyncAt`. `renderWidget` (line 578) mounts a `bg-page/40` overlay on `equity-curve` and `drawdown-chart` tiles when `allKeysStale`. `KpiStrip` (warm-up + stale unified path) renders `—` for null metrics. `KpiStrip.warmup.test.tsx` (7/7 GREEN) covers warm-up + venue-specific. |

**Score:** 7/7 truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/070_allocator_equity_snapshots.sql` | 683 lines · PK (allocator_id, asof) · history_depth_months INTEGER · token_price_history cache · 3-tier RLS · 2 new job kinds · key-scoped coherence · pg_cron schedule · self-verify DO block | VERIFIED | 683 lines. 16 `history_depth_months` hits; 3 RLS policies `_owner_select/_admin_select/_service_all`; 12 `refresh-allocator-equity` hits; 23 `reconstruct_allocator_history`; 21 `refresh_allocator_equity_daily`; 21 `Migration 070 failed` assertions (exceeds 12-a-l spec). Schema live per 07-01 SUMMARY (Management API apply, post-verify queries confirm all 7 columns + 3 policies + cron job). |
| `analytics-service/services/equity_reconstruction.py` | ~570 lines · 2 handlers · OKX 3-month terminus · CoinGecko fallback · history_depth_months recording | VERIFIED | 934 lines (grew slightly from fixes). `VENUE_HISTORY_DEPTH_MONTHS`, `history_depth_months_for_venue`, `OKX trade history capped at 3 months` sentinel, `exchange_primary`/`coingecko_fallback`/`mixed` all present. WR-03/04/05 fixes applied. |
| `analytics-service/tests/test_equity_reconstruction*.py` | 3 files · unit + env-gated live + env-gated integration | VERIFIED | 3 files present; unit suite part of `pytest tests/` 510-passing result; env-gated suites correctly skip by default (module-level `pytest.skip` on `QUANTALYZE_*` env flags). |
| `analytics-service/services/job_worker.py` | TIMEOUT_PER_KIND + dispatch() elif additions | VERIFIED | Lines 133–134: 30-min + 3-min timeouts registered. Lines 1452–1457: lazy-import + dispatch for both new kinds. |
| `src/lib/queries.ts` | MyAllocationDashboardPayload 9 new fields · `!portfolio` early-return rewritten · derivePhase07Fields helper | VERIFIED | All 9 fields present (lines 608–655). Line 869 `if (!portfolio)` now returns full Phase 07 payload spread (no longer skips equity). `derivePhase07Fields` computes `allKeysStale`, `lastSyncAt`, `hasSyncing`, `equityDailyPoints`, `minHistoryDepthMonths`, `activeVenues`. |
| `src/lib/allocation-helpers.ts` | `equitySnapshotsToDailyPoints` adapter with forward-fill + sorting | VERIFIED | 133 lines. Forward-fill gap-filler at lines 43–61. Happy / gap / warm-up / empty / single / unsorted branches all covered in `allocation-helpers.equity-adapter.test.ts` (6/6 GREEN). |
| `src/app/(dashboard)/allocations/page.tsx` | Suspense wrap around AllocationsTabs | VERIFIED | 48 lines. `<Suspense fallback={<div />}>` at line 43; spreads full payload into AllocationsTabs. No inline empty-state block; no AllocatorExchangeManager import. |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` | Derive-each-render `activeTab` per f3 · 5s polling on Performance · parseTab silent fallback | VERIFIED | 132 lines. Zero `useState` matches (verified). `parseTab` at line 44 collapses to `"performance"` for anything but literal `"scenario"`. Polling effect at lines 74–80 gated on `activeTab === "performance"` + `document.visibilityState === "visible"`. |
| `src/app/(dashboard)/allocations/ScenarioStub.tsx` | Static Card with verbatim D-06 copy | VERIFIED | 26 lines. Zero `useEffect`, zero dynamic imports, verbatim "Scenario builder coming soon" + body copy per UI-SPEC.md. |
| `src/app/(dashboard)/allocations/EmptyState.tsx` | Two-branch: syncing→InfoBanner, idle→Card with single Connect Exchange CTA to `/profile?tab=exchanges` | VERIFIED | 60 lines. Verbatim copy from UI-SPEC.md §Copywriting; CTA routes to `/profile?tab=exchanges`. D-07 minimalism (one h2, one p, one Link; no illustration). |
| `src/app/(dashboard)/allocations/AllocationDashboard.tsx` | STRATEGY_COMPOSITE_WIDGETS gating · zero+idle short-circuit · stale overlay · equityDailyPoints forwarding | VERIFIED | 837 lines. Set at line 169 (18 kebab-case widgetIds). `visibleConfig` useMemo at line 614. Zero+idle short-circuit at line 675. Stale overlay in `renderWidget` at line 591 (`showStaleOverlay`). `equityDailyPoints` forwarded as direct prop on equity-curve + drawdown-chart tiles. |
| `src/__tests__/seed-integrity.test.ts` | Extended with PURGE-01/06 import-graph + f4 co-occurrence + positive-control | VERIFIED | 483 lines. Two new describe blocks (7 new tests). All GREEN in targeted run. |
| `src/__tests__/allocator-equity-rls.test.ts` | Live-DB RLS regression: owner-only SELECT + cross-allocator denial + service_role full access | VERIFIED | 350 lines. 4 tests; 3 GREEN against live schema + 1 skip-advertiser. Test skipped in local run without Supabase env — expected behaviour per live-DB gating. |
| `src/components/auth/OnboardingWizard.noseeed.test.tsx` | Mock @/lib/supabase/client; assert only `profiles.update` called | VERIFIED | 146 lines, 5 tests GREEN. Mock captures `.from(table)` + `.update/.insert`; asserts `.from('profiles').update(...)` called and NO `.insert` on any table. |
| `src/lib/gdpr-export.ts` | `allocator_equity_snapshots` added to USER_EXPORT_TABLES | VERIFIED | Line 90: `{ kind: "direct", table: "allocator_equity_snapshots", user_column: "allocator_id" }`. Coverage-hook test GREEN. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `page.tsx` | `getMyAllocationDashboard` | `await getMyAllocationDashboard(user.id)` | WIRED | Line 35; payload spread into AllocationsTabs. |
| `AllocationsTabs` | `AllocationDashboard` | `<AllocationDashboard {...props} />` (spread) | WIRED | Line 127. All 9 Phase 07 fields flow through. |
| `AllocationDashboard` | `EquityCurve` + `DrawdownChart` | `{ equityDailyPoints }` direct prop via renderWidget dispatcher | WIRED | Line 591 conditional attach when `widgetId === 'equity-curve' || 'drawdown-chart'`. |
| `getMyAllocationDashboard` | `allocator_equity_snapshots` table | Supabase user-scoped client SELECT (RLS owner_select) | WIRED | Line 830–834 (list SELECT); 835–838 (count-exact head). Owner-only RLS verified by `allocator-equity-rls.test.ts`. |
| `getMyAllocationDashboard` | `allocator_holdings` table | Supabase user-scoped client SELECT | WIRED | Line 839–845. RLS inherited from migration 066. |
| `AllocationDashboard` | `EmptyState` | `<EmptyState hasSyncing={…} />` | WIRED | Line 678 (full-replace early return) + line 745 (syncing inline banner). |
| `AllocationsTabs` | `ScenarioStub` | `<ScenarioStub />` | WIRED | Line 129, rendered when `activeTab === "scenario"`. |
| `AllocationDashboard` | `WarningBanner` (stale) | `<WarningBanner>…</WarningBanner>` | WIRED | Line 759, gated on `allKeysStale && lastSyncAt`. |
| `request_allocator_holdings_sync` RPC | `reconstruct_allocator_history` | enqueue on first connect when snapshots empty | WIRED | Migration 070 STEP 6 extends the RPC with the first-connect enqueue. |
| pg_cron `refresh-allocator-equity` @ 0 5 * * * | `enqueue_refresh_allocator_equity_for_all` | per-key fan-out over active api_keys | WIRED | Migration 070 STEP 7+8 — key-fanout pattern confirmed verbatim in 07-01-SUMMARY.md. |
| `job_worker.dispatch()` | `equity_reconstruction.run_*_job` | lazy import + elif chain | WIRED | job_worker.py lines 1452–1457. `_allocator_key_preflight` hard-requires `api_key_id` — f1 scope fix ensures both new kinds satisfy this. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|---------------------|--------|
| `EquityCurve` | `equityDailyPoints` | `getMyAllocationDashboard` → `equitySnapshotsToDailyPoints(allocator_equity_snapshots)` | Yes — owner-scoped SELECT on live table populated by `equity_reconstruction.py` backfill+daily cron. Fallback to `data.strategies` when undefined (Phase 09 compatibility). | FLOWING |
| `DrawdownChart` | `equityDailyPoints` | Same as above | Yes — identical path. | FLOWING |
| `KpiStrip` | `snapshotCount`, `allKeysStale`, `minHistoryDepthMonths`, `activeVenues` | `derivePhase07Fields` reads from `api_keys` (RLS) + `allocator_equity_snapshots` (RLS) | Yes — real DB reads; warm-up + stale + venue copy derived in one round-trip. | FLOWING |
| `EmptyState` | `hasSyncing` | `derivePhase07Fields`: `apiKeys.some(k => k.sync_status === 'syncing')` | Yes — derived from live `api_keys.sync_status`. | FLOWING |
| `AllocationDashboard` (widget-gating) | `strategies.length` | Phase 5 `portfolio_strategies` query (admin client) | Yes — unchanged from Phase 5; zero-strategy allocators now route through f2 gating. | FLOWING |

No HOLLOW_PROP, STATIC, or DISCONNECTED artifacts. Every rendered Phase 07 value traces to a real SELECT against a live, RLS-owner-scoped table.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PURGE-01 | 07-06 | Audit + document every `ALLOCATOR_ACTIVE`/seed UUID call site in authenticated paths | SATISFIED | `seed-integrity.test.ts` PURGE-01/06 describe blocks (5 tests); explicit `DEMO_REFERENCE_ALLOWLIST`. 7 call sites all on allowlist, zero authenticated leaks. |
| PURGE-02 | 07-01/02/03 | `getMyAllocationDashboard` produces correct output from `allocator_holdings` + equity snapshots + Bridge tables — zero seed fallback | SATISFIED | Migration 070 substrate live; `equity_reconstruction.py` populates `allocator_equity_snapshots`; `getMyAllocationDashboard` reads from them under RLS; `!portfolio` branch returns full Phase 07 payload (no longer stubs zero metrics). |
| PURGE-03 | 07-03 | KPI strip, equity curve, drawdown, "What We Noticed" all derive from real data | SATISFIED | KpiStrip receives `snapshotCount`/`allKeysStale`/`minHistoryDepthMonths`/`activeVenues`; warm-up + venue-specific copy at ≤3 months; `EquityCurve`+`DrawdownChart` parallel-prop f7; "What We Noticed" card preserved in `AllocationDashboard` and rendered with prompt copy for zero-holdings (D-09). |
| PURGE-04 | 07-05 | `/allocations` empty state shows single "Connect Exchange" CTA | SATISFIED | `EmptyState.tsx` component + zero+idle early-return short-circuit. Every CTA targets `/profile?tab=exchanges`. 4 RTL tests GREEN. |
| PURGE-05 | 07-06 | New-user seed-populate-on-signup removed | SATISFIED | `OnboardingWizard.noseeed.test.tsx` (5 tests GREEN): `handleComplete` makes zero `.insert` calls. Positive-control test locks migration 002 `on_auth_user_created` trigger as profiles-only. |
| PURGE-06 | 07-06 | Seed paths retained only for marketing `/demo` routes and unit-test fixtures | SATISFIED | Import-graph scan mechanically enforced via `seed-integrity.test.ts` allowlist (demo.ts + demo.test.ts + seed-integrity.test.ts + admin/match.ts + src/app/demo/** + src/app/api/demo/**). Zero other references. |
| PURGE-07 | 07-04 | `/allocations` tabbed (Performance default + Scenario stub), tab survives reload + back/forward | SATISFIED | `AllocationsTabs.tsx` with URL-param state + `activeTab` derived each render (f3) + `ScenarioStub.tsx`. 7 RTL tests GREEN incl. back/forward regression test. |

No orphaned requirements; all 7 PURGE requirements mapped to a plan and a concrete deliverable, every one GREEN.

### VOICES-ACCEPTED Coverage

| ID | Concern | Status | Evidence |
|----|---------|--------|----------|
| f1 | `refresh_allocator_equity_daily` key-scoping (BLOCKER) | PASS | Migration 070 CHECK branch contains `api_key_id IS NOT NULL` for `refresh_allocator_equity_daily` (grep-verified). `enqueue_refresh_allocator_equity_for_all` iterates `api_keys` (not `allocator_equity_snapshots DISTINCT allocator_id`). Handler uses `_allocator_key_preflight` which hard-requires `api_key_id`. `test_refresh_daily_aggregates_across_keys` passes — UPSERT on `(allocator_id, asof) DO NOTHING` handles multi-key case. |
| f2 | Widget-gating: 18 strategy-composite widgets hidden when `strategies.length === 0` | PASS | `STRATEGY_COMPOSITE_WIDGETS` set (18 kebab-case IDs) + `visibleConfig` useMemo filter at `AllocationDashboard.tsx:614`. 18 CamelCase names in comments (RollingSharpe, CumulativeVsBenchmark, CorrelationMatrix, etc.). `widget-gating.test.tsx` (4/4 GREEN) asserts absence from DOM for zero-strategy + non-zero chart series from snapshots. |
| f3 | `activeTab` derived from searchParams each render (no useState snapshot) | PASS | `AllocationsTabs.tsx:56` — zero `useState` matches. Test #5 in `AllocationsTabs.test.tsx` asserts re-render with new searchParams toggles visible tab (GREEN). |
| f4 | Migration co-occurrence scan: no file co-occurs `ON auth.users` + seed-INSERT | PASS | `seed-integrity.test.ts` f4 describe block iterates every `supabase/migrations/*.sql`. Zero offenders across 70+ migrations. Positive-control asserts migration 002 `handle_new_user` is profiles-only. |
| f5 | Env-gated live ccxt + test-DB integration tests | PASS | `test_equity_reconstruction_live.py` (3 venues parametrized, gated on `QUANTALYZE_LIVE_CCXT=1`) + `test_equity_reconstruction_integration.py` (gated on `QUANTALYZE_INTEGRATION_DB=1`) both committed. Default-CI pytest run shows 5 skipped — expected (these files). |
| f7 | `equityDailyPoints` parallel-prop on EquityCurve + DrawdownChart + equitySnapshotsToDailyPoints adapter | PASS | `allocation-helpers.ts:29` adapter with forward-fill. `EquityCurve`+`DrawdownChart` accept optional `equityDailyPoints`; empty `[]` is explicit override (distinct from undefined fallback). 6+6 adapter+widget tests GREEN. |
| f8 | `formatPercent(null)` returns em-dash `—` (verification-only — `utils.ts` unchanged) | PASS | `src/lib/utils.ts` line 8 has `if (value == null) return "—"`. `utils.test.ts` has 3 regression guards pinning U+2014 output. |
| f9 | Per-venue `history_depth_months` metadata + venue-specific warm-up copy at ≤3 months | PASS | Migration 070 has `history_depth_months INTEGER` column. `equity_reconstruction.VENUE_HISTORY_DEPTH_MONTHS` + `history_depth_months_for_venue` helper. `getMyAllocationDashboard` derives `minHistoryDepthMonths`. `KpiStrip` renders venue-specific copy at `≤3` (inclusive, per Plan 03 Test E/F spec). |
| gB2 | 07-06 moved from wave=4 → wave=1 | PASS | 07-06 executed parallel with 07-01 in Wave 1 per STATE.md Progress section. |

### Quality Gates

| Gate | Command | Result | Exit |
|------|---------|--------|------|
| TypeScript | `npx tsc --noEmit` | Clean (no output) | 0 |
| Vitest full suite | `npx vitest run` | **145 test files passed** / 3 skipped (148); **1430 tests passed** / 65 skipped (1495); 0 failed | 0 |
| Phase 07 targeted (11 files) | `npx vitest run <11 phase-07 test files>` | 130 passed / 3 skipped / 0 failed | 0 |
| Pytest (analytics-service) | `pytest analytics-service/tests/` | **510 passed** / 5 skipped / 0 failed | 0 |
| Code Review Fix (07-REVIEW-FIX.md) | 5/5 warnings (WR-01…WR-05) closed | All fixed with regression tests | — |
| Retired-route check | `grep "/connections" + href=".*/exchanges"` in `(dashboard)/allocations` | Only in explicit NOT-route-invariance test assertions | — |
| Demo-import check | `grep "from @/lib/demo"` under authenticated paths | 0 matches (only in `demo.ts` itself, demo tests, and `/demo` + `/api/demo` routes) | — |
| ON auth.users migration check | `grep -c "ON auth.users" supabase/migrations/*.sql` | 1 hit (migration 002, profiles-only, positive-controlled) | — |

### Anti-Patterns Scan

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| — | TODO/FIXME in Phase 07 new code | Info | `allocation-helpers.ts:15` carries `TODO(phase-07+): revisit gap-aware charting` — documented follow-up, not a stub. No blockers. |
| — | `return null` / `return []` without data source | None | All such cases in Phase 07 new code are intentional empty-state branches (EmptyState helper returns empty snapshots for non-allocator users). Every dynamic data path traces to a real SELECT. |
| — | Hardcoded empty props at call sites | None | `AllocationDashboard` default prop values (`holdingsSummary = []`, `hasSyncing = false`) are source-compatibility shims; in practice the values come from `getMyAllocationDashboard` live query. |

No blocker anti-patterns. The 8 Info-level items surfaced in 07-REVIEW.md are acknowledged code-quality nits (filename spelling, Date allocations, widget-ID brittleness) that do not affect behavior and were explicitly scoped out of the REVIEW-FIX iteration.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration file has all self-verify assertions | `grep -c "Migration 070 failed" 070_allocator_equity_snapshots.sql` | 21 | PASS |
| Key-scoped refresh kind (f1 BLOCKER) | `grep -A2 "kind = 'refresh_allocator_equity_daily'" 070_*.sql` | Contains `api_key_id IS NOT NULL` | PASS |
| Retired routes absent | `ls src/app/(dashboard)/ | grep -E "^(connections|exchanges)$"` | no matches | PASS |
| Connect Exchange CTAs target correct route | `grep "/profile?tab=exchanges" src/app/(dashboard)/allocations` | 12 hits across 4 files | PASS |
| ALLOCATOR_ACTIVE_ID confined to allowlist | `grep -rl "ALLOCATOR_ACTIVE_ID" src/` | 7 files, all on allowlist | PASS |
| No `@/lib/demo` imports under `(dashboard)` | `grep "@/lib/demo" src/app/(dashboard)/` | no matches | PASS |
| Dispatcher registers new kinds | `grep "reconstruct_allocator_history\|refresh_allocator_equity_daily" analytics-service/services/job_worker.py` | 4 hits in dispatch + TIMEOUT_PER_KIND | PASS |

All behavioral checks PASS.

## Human Verification Required

None required for PASS status. All automated gates GREEN.

Optional manual QA (captured in 07-02-SUMMARY.md as a deferred calibration step — does not block verify):
- Live `value_usd` spot-check against exchange UI after connecting a test API key (VOICES-ACCEPTED f9 / Grok f4 reinforcement). Target: <5% drift vs exchange-native portfolio view. Documented as a post-ship calibration, not a Phase 07 gate.

## Gaps Summary

**None.** Every ROADMAP Success Criterion is observable in shipping code, every PURGE requirement is satisfied by a plan's concrete deliverable, every VOICES-ACCEPTED directive (f1–f9 + gB2) is enforced in code + tests, all quality gates pass, and all 5 REVIEW.md Warnings are closed with regression tests.

The only pre-existing concern mentioned in plan SUMMARYs — the `gdpr-export-coverage-hook` test — was actively resolved in commit `a73d80e` (confirmed by `src/lib/gdpr-export.ts:90` now including `allocator_equity_snapshots`) and moved from "deferred" to "closed" in `deferred-items.md`.

Scope-delta items inherited from Phase 06 UAT (`/connections` and `/exchanges` retirement, migration 069 cascade-aware key removal, Exchanges tab on `/profile`) are honored throughout Phase 07: all new CTAs route to `/profile?tab=exchanges` and no new code references the retired routes.

## Recommended Next Steps

**Status: passed → proceed to `/gsd-secure-phase 07` → `/gsd-ship`.**

1. Run `/gsd-secure-phase 07` to perform the final threat-model review (Phase 07 threat register is already documented in 07-01/02/03/04/05 plans and the code review).
2. Run `/gsd-ship` to create the PR from `phase-07-demo-mode-purge` → `main`.
3. Phase 08 (Connection Management and Notes) can begin once Phase 07 merges — it depends on Phase 06 (holdings) and shares the `/profile?tab=exchanges` surface with Phase 06.

Note: Phase 09 (Bridge Live) will consume the same `equityDailyPoints` parallel-prop path Phase 07 established; the `strategies.length > 0` branch of f2 widget-gating keeps the Phase 5 composite grid unchanged for Bridge allocators.

---

*Verified: 2026-04-20T22:00:00Z*
*Verifier: Claude (gsd-verifier)*
