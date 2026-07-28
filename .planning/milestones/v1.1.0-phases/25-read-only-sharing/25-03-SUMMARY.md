---
phase: 25-read-only-sharing
plan: 03
subsystem: api
tags: [share-link, scenario, react, supabase, rls, rate-limit, audit, gdpr, vitest]

# Dependency graph
requires:
  - phase: 25-01
    provides: "scenario_shares table (owner RLS, one-active partial unique index) + get_shared_scenario RPC + database.types Row/Insert"
  - phase: 25-02
    provides: "mintShareToken()/hashShareToken() — 256-bit random token + stored-hash discipline"
  - phase: 23
    provides: "scenario/saved route conventions (withAllocatorAuth, B15 limiter ordering, redacted envelope, NO_STORE_HEADERS, 0-rows->404), SavedScenariosList row-action + role=alert mutation-failure pattern, scenario.* audit family"
provides:
  - "POST /api/allocator/scenario/share — mint token, pre-revoke prior active, owner-scoped insert (hash only), return full share URL"
  - "POST /api/allocator/scenario/share/revoke — owner-scoped revoked_at UPDATE (never DELETE), 0-rows->404"
  - "SavedScenariosList per-row Share/Copy link/Revoke state machine (none -> Share -> copied -> active -> revoke)"
  - "scenario.share + scenario.share.revoke audit actions (TS union + Python parity list)"
  - "scenario_shares registered in the GDPR export manifest (direct, created_by)"
affects: [25-04, recipient-share-page, scenario-sharing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generate-then-store-hash: raw token externalised exactly once (the 200 body URL), only sha256 hash persisted"
    - "Pre-revoke-on-regenerate: generate clears any prior active share (revoked_at IS NULL) so the one-active partial unique index never trips"
    - "Active-share state derived from row data (has_active_share) — no per-row probe fetch; local override after a mutation"

key-files:
  created:
    - src/app/api/allocator/scenario/share/route.ts
    - src/app/api/allocator/scenario/share/route.test.ts
    - src/app/api/allocator/scenario/share/revoke/route.ts
    - src/app/api/allocator/scenario/share/revoke/route.test.ts
  modified:
    - src/app/(dashboard)/allocations/components/SavedScenariosList.tsx
    - src/app/(dashboard)/allocations/components/SavedScenariosList.test.tsx
    - src/lib/audit.ts
    - analytics-service/services/audit.py
    - src/lib/gdpr-export-manifest.ts
    - scripts/check-gdpr-export-coverage.ts
    - src/lib/api/limiter-ordering.test.ts

key-decisions:
  - "Validate scenario_id with codebase-canonical isUuid (UUID_RE), NOT zod v4 .uuid() — zod 4 enforces RFC-4122 variant bits and rejects legitimate Postgres-shaped ids"
  - "Read NEXT_PUBLIC_APP_URL per-request (not at module load) so the share origin reflects the running env and is testable"
  - "Copy link re-generates (pre-revoke + mint) to obtain a fresh URL — the list never holds the raw token, which is only ever returned by the generate route"
  - "Emit scenario.share / scenario.share.revoke audit events (no token/draft content); @audit-skip the pre-revoke as an internal step of generate"
  - "Register scenario_shares as a GDPR direct user-owned table (created_by), erasure via ON DELETE CASCADE — mirrors the scenarios allowlist"

patterns-established:
  - "Honest copied badge: 'Link copied!' (role=status) fires ONLY on a real clipboard success; both-paths-fail -> role=alert 'Copy failed' (ShareableLink audit-#43)"
  - "onMutated-not-on-failure: generate/revoke failure renders role=alert 'Couldn't …' and does NOT fire onMutated (T_SL7b/T_SL7c)"

requirements-completed: [SHARE-01, SHARE-03]

# Metrics
duration: ~80min
completed: 2026-06-22
---

# Phase 25 Plan 03: Read-Only Sharing (allocator routes + Share UX) Summary

**Allocator-side scenario sharing: a generate route that mints a 256-bit token, pre-revokes any prior active share, and persists only its sha256 hash (raw URL returned once); an owner-scoped revoke route that sets revoked_at (never DELETE, 0-rows->404); and a SavedScenariosList per-row Share/Copy link/Revoke state machine with honest copied/failure states.**

## Performance

- **Duration:** ~80 min
- **Tasks:** 2 (+1 deviation-fix commit)
- **Files modified:** 11 (4 created, 7 modified)

## Accomplishments
- `POST /api/allocator/scenario/share` — mints via `mintShareToken()`, pre-revokes any active share for the scenario, owner-scoped insert of `{ scenario_id, created_by: user.id, token_hash }`, returns `{ url }` built from `NEXT_PUBLIC_APP_URL`. The raw token is externalised exactly once.
- `POST /api/allocator/scenario/share/revoke` — owner-scoped `revoked_at = now()` UPDATE (never DELETE), 0-rows -> 404 (no existence oracle), malformed uuid -> 400 first.
- `SavedScenariosList` Share affordance: none -> Share (accent primary); active -> Copy link (secondary) + Revoke (danger); inline Revoke confirm (not a modal) with autoFocus; "Link copied!" (role=status) fires only on a real clipboard success; generate/revoke failure -> role=alert "Couldn't …" + onMutated not fired.
- Both routes wired into the B15 limiter-ordering, audit-coverage, and GDPR export-coverage closed-by-construction gates.

## Task Commits

1. **Task 1: generate + revoke routes + route tests** - `0e6c971f` (feat) — 25 route tests (hash-not-raw, created_by-from-auth, pre-revoke, 400/404/503/429, no-store).
2. **Task 2: SavedScenariosList Share affordance + state-machine tests** - `1d7b2eb1` (feat) — 8 new component tests (T_SH_UI1..8) mirroring T_SL7b/T_SL7c + ShareableLink audit-#43.
3. **Deviation-fix: wire routes into coverage gates** - `d7373bef` (fix) — B15 + audit (TS+Python) + GDPR manifest.

_Both feature tasks were TDD (RED route/component tests written + observed failing, then GREEN)._

## Files Created/Modified
- `src/app/api/allocator/scenario/share/route.ts` - POST generate (mint, pre-revoke, insert hash, return URL).
- `src/app/api/allocator/scenario/share/route.test.ts` - generate route tests.
- `src/app/api/allocator/scenario/share/revoke/route.ts` - POST revoke (revoked_at UPDATE, 0-rows->404).
- `src/app/api/allocator/scenario/share/revoke/route.test.ts` - revoke route tests.
- `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` - per-row Share/Copy link/Revoke state machine; new optional `has_active_share` row field.
- `src/app/(dashboard)/allocations/components/SavedScenariosList.test.tsx` - +8 Share/Copy/Revoke tests.
- `src/lib/audit.ts` - `scenario.share` + `scenario.share.revoke` AuditAction literals + entity-type map.
- `analytics-service/services/audit.py` - same two literals on the Python parity list (TS<->Python parity test stays green).
- `src/lib/gdpr-export-manifest.ts` - `scenario_shares` direct user-owned table (created_by), sorted before `scenarios`.
- `scripts/check-gdpr-export-coverage.ts` - `scenario_shares` SANITIZE_PARITY_ALLOWLIST (CASCADE erasure).
- `src/lib/api/limiter-ordering.test.ts` - both routes classified CANONICAL.

## Decisions Made
- **isUuid over zod v4 `.uuid()`:** This Next.js ships zod 4, whose `.uuid()` enforces RFC-4122 version/variant bits and rejected legitimate Postgres-shaped ids (and the test fixtures). Switched to the codebase-canonical `isUuid`/`UUID_RE` used by `saved/[id]/route.ts` (Rule 11 conformance + Rule 3 unblock).
- **Per-request NEXT_PUBLIC_APP_URL:** reading the env inside the handler (not at module load) makes the share origin reflect the running env and avoids a module-load capture that broke under the test's per-test env set.
- **Copy link re-generates:** the list never holds the raw token (it is only returned by the generate route). "Copy link" calls the generate route again, which pre-revokes + mints a fresh link, so the copied URL always works.
- **Audit emit, not skip, for the user-facing events:** `scenario.share`/`scenario.share.revoke` follow the saved-route privacy posture (metadata carries no token/draft content). The pre-revoke inside generate is `@audit-skip`-ped (an internal step of the single generate gesture).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] zod v4 `.uuid()` rejected valid scenario ids**
- **Found during:** Task 1 (route tests)
- **Issue:** The plan's `z.string().uuid()` body schema returned 400 for every valid `scenario_id` — zod 4's `.uuid()` enforces RFC-4122 version/variant bits, which `gen_random_uuid()`-shaped ids and the test fixtures don't all satisfy.
- **Fix:** Validate via `z.string().refine(isUuid, …)` using the codebase-canonical `isUuid` (UUID_RE), matching `saved/[id]/route.ts`.
- **Files modified:** `share/route.ts`, `share/revoke/route.ts`
- **Verification:** all 25 route tests green.
- **Committed in:** `0e6c971f`

**2. [Rule 3 - Blocking] NEXT_PUBLIC_APP_URL captured at module load**
- **Found during:** Task 1 (T_SH5)
- **Issue:** Reading the env into a module-level const captured the unset value before the test set it; the returned URL fell back to localhost.
- **Fix:** Resolve the origin per-request via a `resolveAppUrl()` helper.
- **Files modified:** `share/route.ts`
- **Verification:** T_SH5 green (URL built from the env).
- **Committed in:** `0e6c971f`

**3. [Rule 2/3 - Coverage gates] New routes + scenario_shares tripped three closed-by-construction CI gates**
- **Found during:** per-wave `npm run test:coverage`
- **Issue:** (a) B15 limiter-ordering flagged both routes unclassified; (b) audit-coverage required a `logAuditEvent`/`@audit-skip` for every `.insert/.update`; (c) GDPR export-coverage flagged `scenario_shares` as an unregistered user-owned table.
- **Fix:** (a) classified both CANONICAL; (b) emitted `scenario.share`/`scenario.share.revoke` (new AuditAction literals on the TS union+map AND the Python parity list) + `@audit-skip` on the generate pre-revoke; (c) registered `scenario_shares` as a GDPR direct table + SANITIZE_PARITY_ALLOWLIST (CASCADE erasure), sorted before `scenarios`.
- **Files modified:** `limiter-ordering.test.ts`, `audit.ts`, `analytics-service/services/audit.py`, `gdpr-export-manifest.ts`, `check-gdpr-export-coverage.ts`, both route files.
- **Verification:** full `npm run test:coverage` green (6401 passed, 0 failed); Python `test_audit.py` green (23 passed); coverage 85.51/83.51/77.82/75.88 — all above the 82/80/74/72 ratchet.
- **Committed in:** `d7373bef`

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 coverage-gate/missing-critical)
**Impact on plan:** All auto-fixes were necessary for correctness and for the existing CI gates. The audit + GDPR registrations are correctness requirements the plan's surface implies (the threat model's audit-trail intent). No scope creep — the recipient page (SHARE-02) and migration remain Plan 25-01/25-04 scope.

## Issues Encountered
- The plan's `<behavior>` says active-share state is "derived from row data". The saved-scenarios GET payload does not currently carry a share indicator, and extending that route's query was out of this plan's scope. Resolved by adding an optional `has_active_share?: boolean` to `SavedScenarioListRow` (additive, defaults to none) plus a per-row local override after a successful generate/revoke — no per-row probe fetch, satisfying the constraint. A future plan can populate `has_active_share` from the GET payload.

## Threat Flags
None — no new security surface beyond the plan's `<threat_model>`. The two new routes are owner-scoped under RLS; the only token externalisation (the raw URL) is exactly the one the threat model anticipated.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Generate + revoke routes are live behind `withAllocatorAuth`; the recipient `/scenario-share/[token]` page (SHARE-02) is Plan 25-04 and can consume `hashShareToken(token)` against `get_shared_scenario`.
- Migration `20260622120000` applies at `/land-and-deploy` (not pushed from the plan); `has_active_share` is not yet populated by the saved-scenarios GET — wire it when the recipient page or a follow-up needs the live active flag on load.

## Self-Check: PASSED

- All 4 created code files exist on disk.
- All 3 task commits (`0e6c971f`, `1d7b2eb1`, `d7373bef`) exist in git history.
- 25-03-SUMMARY.md written to disk.

---
*Phase: 25-read-only-sharing*
*Completed: 2026-06-22*
