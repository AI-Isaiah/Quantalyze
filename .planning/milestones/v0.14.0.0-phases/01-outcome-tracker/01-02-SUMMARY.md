---
phase: 01-outcome-tracker
plan: 02
subsystem: api-routes
tags: [api, supabase, rls, queries, vitest, bridge-outcomes, audit]

requires:
  - "01-01"
provides:
  - POST /api/bridge/outcome — CSRF → auth → rate-limit → Zod → eligibility check → upsert → audit
  - POST /api/bridge/outcome/dismiss — CSRF → auth → rate-limit → Zod → upsert TTL dismissal → audit
  - getMyAllocationDashboard extended with eligible_for_outcome + existing_outcome per strategy row
  - bridge-outcomes-rls.test.ts — live-DB RLS integration test (5 cases, HAS_LIVE_DB gated)
affects:
  - 01-03 (banner UI consumes eligible_for_outcome + existing_outcome from getMyAllocationDashboard)
  - 01-04 (cron reads bridge_outcomes.needs_recompute — no API dependency)

tech-stack:
  added: []
  patterns:
    - "CSRF → auth → rate-limit → Zod superRefine → DB upsert → inline audit (within 60 lines)"
    - "insert-vs-update discrimination: created_at === updated_at = insert (bridge_outcome.record); diverged = update (bridge_outcome.update)"
    - "Promise.all fan-out pattern extended with 3 new admin selects for eligibility"
    - "Server-side eligibility Set/Map post-processing: sentAsIntroSet, existingOutcomesByStrategy Map, activeDismissalSet"
    - "live-DB RLS tests: it.skipIf(!HAS_LIVE_DB) + advertiseLiveDbSkipReason pattern"

key-files:
  created:
    - src/app/api/bridge/outcome/route.ts
    - src/app/api/bridge/outcome/route.test.ts
    - src/app/api/bridge/outcome/dismiss/route.ts
    - src/app/api/bridge/outcome/dismiss/route.test.ts
    - src/__tests__/bridge-outcomes-rls.test.ts
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts

key-decisions:
  - "insert-vs-update distinguished by comparing inserted.created_at === inserted.updated_at (OQ3 default — no extra round-trip; trigger on UPDATE flips updated_at)"
  - "No admin client in user-facing routes — RLS WITH CHECK (allocator_id = auth.uid()) is the auth boundary; no createAdminClient import"
  - "Dismiss route skips eligibility check — non-eligible dismiss is harmless no-op; getMyAllocationDashboard eligibility gates banner visibility"
  - "ExistingBridgeOutcome exported as named type from queries.ts for reuse by Plan 01-03 UI components"
  - "Mock buildChain extended with .gt() no-op + bridge_outcome_dismissals rowsFor() that filters expired rows in test runtime — matches production .gt('expires_at', nowIso) semantics"
  - "Test fixtures require allocator_id + decision fields to pass through the eq() filters in the mock chain"

requirements-completed: [OUTCOME-01, OUTCOME-02, OUTCOME-04, OUTCOME-05]

duration: 100min
completed: 2026-04-18T07:41:21Z
---

# Phase 01 Plan 02: API Routes + Queries Fan-Out Summary

**POST /api/bridge/outcome + /dismiss routes with CSRF/auth/rate-limit/Zod/audit pipeline; getMyAllocationDashboard extended with eligible_for_outcome + existing_outcome via 3 admin fan-out selects; live-DB RLS test with 5 policy assertions**

## Performance

- **Duration:** ~100 min
- **Started:** ~2026-04-18T06:00:00Z
- **Completed:** 2026-04-18T07:41:21Z
- **Tasks:** 4 of 4
- **Files created/modified:** 7

## Accomplishments

### Task 1: POST /api/bridge/outcome route + tests
- Created `src/app/api/bridge/outcome/route.ts`: CSRF → auth → rate-limit → Zod (with cross-field `superRefine`) → `match_decisions` eligibility JOIN → upsert on `(allocator_id, strategy_id)` → inline audit
- Insert-vs-update discrimination via `created_at === updated_at` comparison (no extra round-trip)
- 8 test cases: TC1 happy allocated, TC2 happy rejected, TC3 upsert-update→update-audit, TC4 401, TC5 403 NOT_ELIGIBLE, TC6a/TC6b 400 Zod, TC7 429 — all green
- audit-coverage.test.ts sentinel: PASS

### Task 2: POST /api/bridge/outcome/dismiss route + tests
- Created `src/app/api/bridge/outcome/dismiss/route.ts`: same preamble, 24h TTL upsert on `bridge_outcome_dismissals`, `bridge_outcome.dismiss` audit
- Rate-limit key: `bridge_outcome_dismiss:${user.id}`
- 3 test cases: TC1 happy dismiss, TC2 401, TC3 429 — all green
- audit-coverage.test.ts sentinel: PASS (still green with new route)

### Task 3: getMyAllocationDashboard fan-out + query tests
- Added `ExistingBridgeOutcome` type and `eligible_for_outcome` / `existing_outcome` fields to `MyAllocationDashboardPayload`
- Extended `Promise.all` (4 → 7 entries): `match_decisions(sent_as_intro)`, `bridge_outcomes`, `bridge_outcome_dismissals(.gt("expires_at", nowIso))`
- Post-processing via `sentAsIntroSet`, `existingOutcomesByStrategy` Map, `activeDismissalSet`
- 5 new test cases in `queries.my-allocation.test.ts`: TC1 eligible, TC2 already-outcomed, TC3 snoozed, TC4 expired-dismissal(→eligible), TC5 no-sent_as_intro — all green
- Extended `buildChain` mock with `.gt()` method + `bridge_outcome_dismissals` rowsFor() with runtime expiry filter

### Task 4: Live-DB RLS integration test
- Created `src/__tests__/bridge-outcomes-rls.test.ts` mirroring `audit-log-rls.test.ts` structure
- 5 `it.skipIf(!HAS_LIVE_DB)` tests + 1 unconditional `advertiseLiveDbSkipReason` test
- Test matrix:
  - Test 1: owner SELECT own → 1 row; foreign allocator SELECT → 0 rows
  - Test 2: service-role admin reads all rows across allocators
  - Test 3: spoofed INSERT (allocator_id ≠ auth.uid()) blocked by WITH CHECK
  - Test 4: DELETE on bridge_outcomes returns 0 rows (no DELETE policy)
  - Test 5: dismissal DELETE owner → success; foreign → 0 rows
- Without `HAS_LIVE_DB`: 1 passed, 5 skipped — clean CI

## Test Counts

| Suite | Cases | Status |
|-------|-------|--------|
| route.test.ts (outcome) | 8 | All green |
| dismiss/route.test.ts | 3 | All green |
| queries.my-allocation.test.ts (new) | 5 | All green |
| queries.my-allocation.test.ts (existing) | 7 | Still green |
| bridge-outcomes-rls.test.ts | 5+1 | 5 skipped (no HAS_LIVE_DB), 1 pass |
| audit-coverage.test.ts | 1 | Pass (sentinel) |
| **Total** | **30** | **25 pass, 5 skip** |

## HAS_LIVE_DB Status

`HAS_LIVE_DB` was **not available** during the run (no `SUPABASE_SERVICE_ROLE_KEY` in the executor environment). The 5 live-DB tests skipped cleanly. The migration 059 schema is already live on production Supabase (confirmed in Plan 01-01 Task 3), so the policies being tested are real. Test 4 (delete-denied) and Test 3 (spoof-blocked) match the migration 059 policy definitions exactly.

## Audit-Coverage Sentinel

Result: **PASS** — `logAuditEvent(supabase, ...)` appears within 60 lines of each upsert in both new routes. The audit-coverage.test.ts grep passes after adding both routes to `src/app/api/bridge/`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Mock fixture missing `allocator_id` + `decision` columns**

- **Found during:** Task 3, TC1 test failure
- **Issue:** The `buildChain` mock applies `.eq()` filters from the real fan-out queries — `eq("allocator_id", userId)` and `eq("decision", "sent_as_intro")`. Test fixtures without those fields were filtered out, causing `sentAsIntroSet` to be empty and `eligible_for_outcome` to be false.
- **Fix:** Added `allocator_id` and `decision` fields to all `sentAsIntroDecisions` fixtures; widened the state array type to accept these optional fields.
- **Files modified:** `src/lib/queries.my-allocation.test.ts`
- **Committed in:** `4cbc1ac`

**2. [Rule 1 - Bug] `createClient()` untyped insert resolves to `never` in RLS test**

- **Found during:** Task 4, typecheck
- **Issue:** The `clientA` (created from `@supabase/supabase-js` `createClient` without schema generics) resolved `.insert({...})` payload type to `never`, causing TS2769.
- **Fix:** Added `as never` cast on the spoofed INSERT payload (the actual runtime behavior is correct — the cast only suppresses the untyped-client TS inference).
- **Files modified:** `src/__tests__/bridge-outcomes-rls.test.ts`
- **Committed in:** `f188e8e`

None of the deviations required architectural changes. Both were in-scope test fixes.

## Known Stubs

None — all data flows are wired. The routes upsert real rows; the query fan-out reads real tables; the tests mock at the Supabase client boundary. No placeholders in rendered UI (UI ships in Plan 01-03).

## Threat Flags

None beyond what was already modeled in the plan's threat register (T-01-02-01 through T-01-02-11). No new network endpoints beyond the two specified; no auth paths outside the plan scope; no schema changes outside the plan scope.

## Self-Check: PASSED

- `src/app/api/bridge/outcome/route.ts` — FOUND
- `src/app/api/bridge/outcome/route.test.ts` — FOUND
- `src/app/api/bridge/outcome/dismiss/route.ts` — FOUND
- `src/app/api/bridge/outcome/dismiss/route.test.ts` — FOUND
- `src/lib/queries.ts` — FOUND (modified)
- `src/lib/queries.my-allocation.test.ts` — FOUND (modified)
- `src/__tests__/bridge-outcomes-rls.test.ts` — FOUND
- commit `f39fbda` (Task 1 route+test) — FOUND
- commit `c428647` (Task 2 dismiss route+test) — FOUND
- commit `4cbc1ac` (Task 3 queries fan-out+test) — FOUND
- commit `f188e8e` (Task 4 live-DB RLS test) — FOUND

---
*Phase: 01-outcome-tracker*
*Completed: 2026-04-18T07:41:21Z*
