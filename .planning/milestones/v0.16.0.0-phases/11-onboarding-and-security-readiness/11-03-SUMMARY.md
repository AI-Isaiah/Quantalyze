---
phase: 11-onboarding-and-security-readiness
plan: 03
subsystem: analytics-onboarding-funnel
tags:
  - posthog-server
  - onboarding-funnel
  - cohort-attribution
  - single-fire-marker
  - non-blocking-analytics
  - python-rpc-stamp
requires:
  - "supabase/migrations/084_first_api_key_added_trigger.sql (live in production — Plan 01)"
  - "src/lib/analytics/usage-events.ts (existing trackUsageEventServer wrapper)"
  - "src/lib/supabase/admin.ts (existing createAdminClient — service-role JWT)"
  - "src/app/api/allocator/scenario/commit/route.ts (Phase 10 — outcome insert site)"
  - "src/app/api/match/decisions/holding/route.ts (Phase 09 — outcome insert site)"
  - "analytics-service/services/job_worker.py run_poll_allocator_positions_job (existing post-success hook)"
provides:
  - "USAGE_EVENTS extended with 5 onboarding-funnel event names (signup, first_api_key_added, first_sync_success, first_bridge_surfaced, first_outcome_recorded)"
  - "FUNNEL_STEP map (1..5 ordinals per D-14) + OnboardingMarker type"
  - "src/lib/analytics/onboarding-funnel.ts — 5 server-only helpers (maybeEmitSignup, maybeEmitOnboardingEvent, maybeEmitFirstBridgeSurfaced, stampOutcomeMarker, isoWeekString)"
  - "MARKER_KEY map normalizing first_outcome_at vs first_outcome_recorded source/event split"
  - "/allocations Server Component: 5 readers fired in parallel via Promise.allSettled per request"
  - "scenario-commit + match-decisions/holding: stampOutcomeMarker(admin, user.id) after success — non-blocking"
  - "analytics-service Python worker: stamp_first_sync_success RPC call after first persist — non-blocking"
affects:
  - "src/lib/admin/usage-metrics.ts (DAILY_FUNNEL_EVENTS narrowed — D-13 events live on a separate cohort dashboard)"
tech-stack:
  added: []
  patterns:
    - "Single-fire marker pattern (mirrors session_count from migration 053): source side stamps `${marker}_at`; reader side stamps `${marker}_emitted_at` after fire"
    - "At-least-once analytics emission (Pitfall 3): if emitted_at UPDATE fails, next request re-fires; PostHog dedupes by (distinct_id + event + properties) — T-11-22 disposition"
    - "Server-side PostHog via posthog-node (D-13 LOCKED) — no client-side duplication, server-only guard"
    - "Promise.allSettled for parallel non-blocking analytics on the host request — failures isolated, total latency = max not sum"
    - "MARKER_KEY normalization map — separates source-side metadata key (first_outcome_at) from funnel event name (first_outcome_recorded)"
key-files:
  created:
    - "src/lib/analytics/onboarding-funnel.ts (5 helpers + MARKER_KEY map + isoWeekString)"
    - "src/lib/analytics/onboarding-funnel.test.ts (14 unit tests)"
    - "analytics-service/tests/test_job_worker_first_sync_marker.py (2 pytest cases)"
  modified:
    - "src/lib/analytics/usage-events-types.ts (USAGE_EVENTS extended +5; FUNNEL_STEP map; OnboardingMarker type)"
    - "src/lib/admin/usage-metrics.ts (Rule 3 fix — DAILY_FUNNEL_EVENTS narrowed to original 5)"
    - "src/app/(dashboard)/allocations/page.tsx (5 readers in parallel via Promise.allSettled)"
    - "src/app/api/allocator/scenario/commit/route.ts (stampOutcomeMarker on success)"
    - "src/app/api/match/decisions/holding/route.ts (stampOutcomeMarker on success)"
    - "analytics-service/services/job_worker.py (stamp_first_sync_success RPC after audit emission)"
    - "src/app/api/allocator/scenario/commit/route.test.ts (server-only + onboarding-funnel + admin mocks)"
    - "src/app/api/match/decisions/holding/route.test.ts (server-only + onboarding-funnel mocks)"
    - "src/app/api/match/decisions/holding/route.admin-rls.regression-1.test.ts (server-only + onboarding-funnel mocks)"
decisions:
  - "MARKER_KEY map introduced to normalize first_outcome_at (source key) vs first_outcome_recorded (event name). Plan must_haves specify both verbatim — the map keeps the helper signature single-pathed and avoids string-concat branching."
  - "DAILY_FUNNEL_EVENTS narrowed to the 5 original Sprint-5 events. The new D-13 funnel events live on a separate cohort-funnel dashboard surface keyed on funnel_step + funnel_event_name properties — they are not columns of DailyFunnelRow."
  - "maybeEmitFirstBridgeSurfaced acts as both source side AND reader side (no upstream marker writer for 'bridge first surfaced' — flagged-holdings count is computed at render time). The first_bridge_surfaced_at stamp is written for audit symmetry with the other markers."
  - "All 5 helpers swallow PostHog/admin update failures via console.warn. T-11-22 in plan threat model accepts the at-least-once duplicate-fire risk; PostHog dedupes by (distinct_id + event + properties)."
  - "Promise.allSettled wraps all 5 reader calls in /allocations/page.tsx — single helper failure does not cascade. Steady-state cost is metadata reads only (each helper short-circuits on already-emitted before any PostHog or admin call)."
  - "ZERO new dependencies added — neither posthog-python (Python worker uses RPC + Next-side reader) nor anything else. RESEARCH §Don't-Hand-Roll honored."
metrics:
  duration: "~14 minutes"
  completed: "2026-04-26T22:14:00Z"
  task_count: 3
  file_count: 10
  test_count: 16
---

# Phase 11 Plan 03: PostHog Onboarding-Funnel Wiring Summary

**One-liner:** Wires the 5 PostHog onboarding-funnel events (signup → first_api_key_added → first_sync_success → first_bridge_surfaced → first_outcome_recorded) end-to-end via server-side `posthog-node`, single-fire markers on `auth.users.raw_user_meta_data`, a Python-worker RPC for `first_sync_success`, and route-side stamps for `first_outcome_recorded` — all non-blocking, zero new dependencies, with cohort_week_iso attribution per D-14.

## Scope

ONBOARD-05 — PostHog event wiring for the onboarding funnel. Plan 01 shipped the source-side primitives (Postgres trigger for `first_api_key_added_at`, SECURITY DEFINER RPC `stamp_first_sync_success` — both LIVE in production via Supabase MCP). Plan 03 ships the readers (Next.js server component side that fires PostHog when markers first appear), the symmetric write paths for `first_outcome_recorded` (called by the existing scenario-commit + match-decisions routes), the `signup` first-request emitter, the `first_bridge_surfaced` source+reader at render time, and the Python-worker RPC call.

## The 5 Events

| # | Event | Funnel Step | Source-side stamp | Reader fire site | Distinct ID |
|---|-------|-------------|-------------------|------------------|-------------|
| 1 | `signup` | 1 | maybeEmitSignup (this module — first authenticated /allocations request per user) | /allocations Server Component | `user.id` (server-derived) |
| 2 | `first_api_key_added` | 2 | Postgres trigger `api_keys_stamp_first_added` (migration 084 — LIVE) | /allocations Server Component | `user.id` |
| 3 | `first_sync_success` | 3 | Python worker `stamp_first_sync_success` RPC after first `persist_allocator_holdings` | /allocations Server Component | `user.id` |
| 4 | `first_bridge_surfaced` | 4 | maybeEmitFirstBridgeSurfaced (this module — when `flaggedHoldings.length > 0` first time) | /allocations Server Component (source = reader) | `user.id` |
| 5 | `first_outcome_recorded` | 5 | `stampOutcomeMarker` called by `POST /api/allocator/scenario/commit` AND `POST /api/match/decisions/holding` after successful insert | /allocations Server Component | `user.id` |

All 5 events carry properties: `funnel_step` (1..5), `funnel_event_name` (event name string), `cohort_week_iso` (e.g. "2026-W17" — set on first signup, persists through session), `stamped_at` (where applicable), plus the standard server-layer property bag (`source_layer: "server"`, `$host`).

## The 4 Marker Keys + Their Emitted-At Siblings

Stored on `auth.users.raw_user_meta_data` (write-through Supabase Auth admin updateUserById):

| Marker `*_at` (source) | Sentinel `*_emitted_at` (reader) | Set by |
|------------------------|----------------------------------|--------|
| `first_api_key_added_at` | `first_api_key_added_emitted_at` | Trigger writes `*_at`; reader writes `*_emitted_at` |
| `first_sync_success_at` | `first_sync_success_emitted_at` | RPC writes `*_at`; reader writes `*_emitted_at` |
| `first_bridge_surfaced_at` | `first_bridge_surfaced_emitted_at` | Reader writes both atomically |
| `first_outcome_at` | `first_outcome_emitted_at` | Routes write `*_at` (note: the marker key is `first_outcome_at`, not `first_outcome_recorded_at` — MARKER_KEY normalization map handles the source/event name split per CONTEXT D-13) |

Plus signup gets `signup_emitted_at` + `cohort_week_iso` written on the first request per user (signup is special — the marker IS the user's existence in `auth.users`, no separate `*_at` stamp).

## Single-Fire Semantics

`maybeEmitOnboardingEvent` + `maybeEmitSignup` + `maybeEmitFirstBridgeSurfaced`:

```
if (!stampedAt || emittedAt) return false;
await trackUsageEventServer(event, userId, properties);
await admin.auth.admin.updateUserById(userId, { user_metadata: { ..., [`${key}_emitted_at`]: now }});
```

If the `_emitted_at` UPDATE fails, the helper logs `console.warn` and the next request re-fires. **Pitfall 3 / T-11-22 disposition:** this is an at-least-once contract — PostHog dashboards dedupe by `(distinct_id + event + properties)`, so duplicate fires are visible but acceptable.

`stampOutcomeMarker` (called by the two outcome routes) is idempotent on the source side: it reads metadata first via `admin.auth.admin.getUserById`, no-ops when `first_outcome_at` is already set. So even if the user commits multiple outcomes in the same session, the marker is set exactly once; the reader's single-fire sentinel handles the event side.

## Implementation

### Task 1 — onboarding-funnel module + USAGE_EVENTS extension (TDD RED → GREEN)

**RED commit:** `06ae4e9` — failing test file with 14 cases covering single-fire semantics, USAGE_EVENTS extension, FUNNEL_STEP ordinals, isoWeekString boundaries (incl. 2027-W01), non-throwing on admin update failures, idempotency of stampOutcomeMarker.

**GREEN commit:** `ebacf22` — extends `usage-events-types.ts` with 5 new strings + FUNNEL_STEP map + OnboardingMarker type; creates `src/lib/analytics/onboarding-funnel.ts` with the 5 helpers; introduces MARKER_KEY normalization map for the `first_outcome_at` vs `first_outcome_recorded` split.

**Rule 3 blocking-fix:** `src/lib/admin/usage-metrics.ts` was indexing `DailyFunnelRow` by the (now expanded) `UsageEvent` union, causing `npm run typecheck` to fail with `TS7053`. Narrowed to a new local `DAILY_FUNNEL_EVENTS` constant covering only the 5 original Sprint-5 events. Rationale: the new D-13 funnel events live on a separate cohort-funnel dashboard surface keyed on the `funnel_step` + `funnel_event_name` properties — they are not columns of `DailyFunnelRow`. All 8 `usage-metrics.test.ts` tests still green.

### Task 2 — wire 4 readers + Python worker RPC

**Commit:** `83b1438`

**A. /allocations Server Component (Next-side):** After auth + payload fetch, runs all 5 helpers in parallel via `Promise.allSettled`. Each helper short-circuits on already-emitted via the `*_emitted_at` sentinel, so the steady-state cost is metadata reads only (no PostHog or admin writes once the user has progressed through the funnel).

```typescript
const admin = createAdminClient();
await Promise.allSettled([
  maybeEmitSignup(admin, user),
  maybeEmitOnboardingEvent(admin, user, "first_api_key_added"),
  maybeEmitOnboardingEvent(admin, user, "first_sync_success"),
  maybeEmitOnboardingEvent(admin, user, "first_outcome_recorded"),
  maybeEmitFirstBridgeSurfaced(admin, user, payload.flaggedHoldings.length),
]);
```

**B. Python worker (analytics-service/services/job_worker.py):** After the existing `_emit_audit("allocator.holdings.sync_completed", ...)` call in `run_poll_allocator_positions_job`, a new try/except block calls `ctx.supabase.rpc("stamp_first_sync_success", {"p_user_id": allocator_id}).execute()` via `db_execute`. Idempotent (Plan 01 RPC is SECURITY DEFINER and writes only when the marker is absent). Failures log `logger.warning` and the worker still returns DONE — the compute path is independent of analytics stamping. ZERO new pip dependencies.

### Task 3 — stamp first_outcome_at on outcome inserts

**Commit:** `c807679`

Both outcome-recording routes invoke `stampOutcomeMarker(admin, user.id)` AFTER the successful insert/RPC and AFTER the existing audit emission, wrapped in try/catch (non-blocking — analytics failures do not affect the route response or the on-disk outcome row).

- `src/app/api/allocator/scenario/commit/route.ts` — stamp added after the `for (const row of recorded) { logAuditEvent(...) }` loop, just before the `NextResponse.json` return.
- `src/app/api/match/decisions/holding/route.ts` — stamp added after the `logAuditEvent(supabase, ...)` call, just before the `NextResponse.json({ match_decision_id }, { status: 201 })` return. Reuses the existing local `admin` (already created at line 111 for the match_decisions insert).

**Test infra (Rule 3 blocking-fix):** all 3 affected route tests get `vi.mock("server-only", () => ({}))` and `vi.mock("@/lib/analytics/onboarding-funnel", () => ({ stampOutcomeMarker: vi.fn(...) }))` shims so jsdom can resolve the route imports. The scenario-commit test also adds a `vi.mock("@/lib/supabase/admin", ...)` shim since route.ts now imports `createAdminClient`. All 24 existing route tests still green.

## Test Counts

| Suite | Count | Status |
|-------|-------|--------|
| `src/lib/analytics/onboarding-funnel.test.ts` (NEW) | 14 | green |
| `src/lib/analytics/usage-events.test.ts` (existing) | 4 | green |
| `src/lib/admin/usage-metrics.test.ts` (existing) | 8 | green |
| `src/app/api/allocator/scenario/commit/route.test.ts` (existing — added 3 mocks) | 17 | green |
| `src/app/api/match/decisions/holding/route.test.ts` (existing — added 2 mocks) | 5 | green |
| `src/app/api/match/decisions/holding/route.admin-rls.regression-1.test.ts` (existing — added 2 mocks) | 2 | green |
| `analytics-service/tests/test_job_worker_first_sync_marker.py` (NEW) | 2 | green |
| `analytics-service/tests/test_allocator_positions.py` (existing — regression check) | 9 | green |
| `analytics-service/tests/test_audit.py` (existing — regression check) | 9 | green |
| `analytics-service/tests/test_job_worker.py` (existing — regression check) | 27 | green |
| **Total impacted** | **97** | **green** |

The 14 new `onboarding-funnel.test.ts` tests cover the 9 behaviors in the plan (USAGE_EVENTS extension, FUNNEL_STEP, single-fire, no-op when marker absent, no-op when emitted_at present, non-throw on admin error, signup single-fire, stampOutcomeMarker idempotency, isoWeekString) plus 4 bonus cases for `maybeEmitFirstBridgeSurfaced` (no-op flagged=0, source-side stamp + emit on first surface, single-fire on subsequent, ISO-week boundary 2027-W01).

## Verification (per plan §<verification>)

| # | Command | Result |
|---|---------|--------|
| 1 | `npx vitest run src/lib/analytics/onboarding-funnel.test.ts` | exits 0 (14/14 — exceeds the spec's 9 minimum) |
| 2 | `npx vitest run src/app/api/allocator/scenario/commit/route.test.ts src/app/api/match/decisions/holding/route.test.ts src/app/api/match/decisions/holding/route.admin-rls.regression-1.test.ts` | exits 0 (24/24) |
| 3 | `cd analytics-service && pytest tests/test_job_worker_first_sync_marker.py` | exits 0 (2/2) |
| 5 | `npm run typecheck` | passes |
| 6 | `npm run lint` | 0 errors (31 pre-existing warnings — out of scope) |

Manual smoke (§8 / §9) deferred to /qa pass — production verification of PostHog dashboard event ingest happens at the milestone-merge gate.

## Threat Model Compliance

All 7 threat-register entries (T-11-19..T-11-25) are honored verbatim by the implementation:

- **T-11-19 (Tampering — user pre-stamps `*_emitted_at`)**: The helper's check is `if (!stampedAt || emittedAt) return false`. A user who pre-stamps only `*_emitted_at` without `*_at` would prevent the event from firing for themselves once the source side later stamps `*_at` — but the event never spoofs for OTHER users (distinct_id is server-derived). Tampering only DELAYS or PREVENTS the event for the tamperer.
- **T-11-20 (Information Disclosure — PostHog key in client bundle)**: All emission server-side via `trackUsageEventServer`. `import "server-only"` first line of onboarding-funnel.ts — accidental client-bundle inclusion fails the build.
- **T-11-21 (DoS — admin updateUserById latency on /allocations render)**: All 5 helpers run in parallel via `Promise.allSettled`. Total latency = max of 5 (not sum). Each helper short-circuits on already-emitted (no DB call). PostHog flushAt:1 ensures single fire on cold-finish.
- **T-11-22 (Tampering — RPC replay)**: `stamp_first_sync_success` is idempotent (writes only when marker absent). Replay = no-op. PostHog dedupe handles event-side replays.
- **T-11-23 (Repudiation — silent stamp failure)**: try/except logs via `logger.warning`. PostHog funnel will show `first_sync_success` at a slightly delayed timestamp on the next successful sync. Acceptable per Pitfall 3.
- **T-11-24 (Information Disclosure — cohort_week_iso leak)**: Intentional per D-14 — designed for cohort-comparison dashboards. Already disclosed via PostHog's standard `distinctId`/`timestamp` surface. No new leak.
- **T-11-25 (Spoofing — stolen session triggers signup_emitted_at for victim)**: All readers use `auth.getUser()` from the user-scoped Supabase client. Distinct ID derives from `user.id` server-side. Session theft is broader auth concern; this plan does not introduce new vectors.

## Threat Flags

None — plan 03 introduces no new security-relevant surface beyond the threat model entries above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `src/lib/admin/usage-metrics.ts` typecheck failure on USAGE_EVENTS extension**
- **Found during:** Task 1 GREEN — first `npm run typecheck` after extending USAGE_EVENTS.
- **Issue:** `usage-metrics.ts:247` indexed `DailyFunnelRow` (5-column type) with `eventName: UsageEvent`, which after the extension is now a 10-string union. TS7053: `Property 'signup' does not exist on type 'DailyFunnelRow'`.
- **Fix:** Narrowed `UsageEventName` to a new local `DAILY_FUNNEL_EVENTS` 5-string tuple. The new D-13 funnel events live on a separate cohort dashboard surface keyed on `funnel_step` properties — they are not columns of `DailyFunnelRow`. No semantic regression: the existing HogQL query at line 233 already filters to the 5 original events.
- **Files modified:** `src/lib/admin/usage-metrics.ts`
- **Commit:** `ebacf22` (combined with GREEN since the extension and the downstream fix are inseparable)

**2. [Rule 3 — Blocking] Existing route tests fail to load after route.ts imports onboarding-funnel**
- **Found during:** Task 3 — first `npx vitest run` of the existing scenario-commit + match-decisions tests after wiring `stampOutcomeMarker`.
- **Issue:** `import "server-only"` (transitive via the new onboarding-funnel.ts import) throws in jsdom: "This module cannot be imported from a Client Component module."
- **Fix:** Added `vi.mock("server-only", () => ({}))` and `vi.mock("@/lib/analytics/onboarding-funnel", ...)` shims to all 3 affected test files. Scenario-commit test additionally needed `vi.mock("@/lib/supabase/admin", ...)` since route.ts now imports `createAdminClient`. Mirrors the existing mock pattern in `src/lib/analytics/usage-events.test.ts` (which uses `vi.mock("server-only", () => ({}))`).
- **Files modified:** `src/app/api/allocator/scenario/commit/route.test.ts`, `src/app/api/match/decisions/holding/route.test.ts`, `src/app/api/match/decisions/holding/route.admin-rls.regression-1.test.ts`
- **Commit:** `c807679` (combined with Task 3 GREEN)

**3. [Rule 3 — Blocking] Test mock hoist ordering**
- **Found during:** Task 1 GREEN — first `npx vitest run onboarding-funnel.test.ts` after creating the SUT module.
- **Issue:** `vi.mock("./usage-events", () => ({ trackUsageEventServer: trackMock }))` referenced a top-level `const trackMock` — but `vi.mock` is hoisted, so the reference resolved before the const initialized. ReferenceError: Cannot access 'trackMock' before initialization.
- **Fix:** Use `vi.hoisted()` to create the spy before the mock factory runs, mirroring the `POSTHOG_MOCK = vi.hoisted(...)` pattern in `usage-events.test.ts:27`.
- **Files modified:** `src/lib/analytics/onboarding-funnel.test.ts`
- **Commit:** Folded into the RED commit `06ae4e9` ahead of GREEN.

No architectural changes (Rule 4) were required. The plan was exact and the implementation followed it verbatim except for the small marker-key normalization (MARKER_KEY map) that I added to elegantly handle the `first_outcome_at` vs `first_outcome_recorded` split called out in CONTEXT D-13 and the must_haves.

## Authentication Gates

None — the plan executed end-to-end without manual auth gates. Migration 084's RPC + trigger were already LIVE in production (verified via Supabase MCP `apply_migration` per the additional context); Plan 03's readers consume the markers without needing further DB or external auth.

## Self-Check: PASSED

**Files exist:**
- ✓ `src/lib/analytics/onboarding-funnel.ts`
- ✓ `src/lib/analytics/onboarding-funnel.test.ts`
- ✓ `analytics-service/tests/test_job_worker_first_sync_marker.py`

**Modifications grep-verified:**
- ✓ `src/lib/analytics/usage-events-types.ts` contains `signup`, `first_api_key_added`, `first_sync_success`, `first_bridge_surfaced`, `first_outcome_recorded`, `FUNNEL_STEP`, `OnboardingMarker`
- ✓ `src/app/(dashboard)/allocations/page.tsx` contains `Promise.allSettled`, `maybeEmitSignup`, `maybeEmitOnboardingEvent`, `maybeEmitFirstBridgeSurfaced`, `createAdminClient`
- ✓ `src/app/api/allocator/scenario/commit/route.ts` contains `stampOutcomeMarker`, `first_outcome_at`
- ✓ `src/app/api/match/decisions/holding/route.ts` contains `stampOutcomeMarker`, `first_outcome_at`
- ✓ `analytics-service/services/job_worker.py` contains `stamp_first_sync_success` + try/except wrapper

**Commits exist:**
- ✓ `06ae4e9` — RED test
- ✓ `ebacf22` — GREEN funnel module + types extension
- ✓ `83b1438` — Task 2 readers + Python RPC
- ✓ `c807679` — Task 3 outcome marker stamps
