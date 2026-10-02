---
phase: 94-wizard-resumability
plan: 01
subsystem: api
tags: [nextjs, route-handler, supabase, rls, security, composite, wizard]

# Dependency graph
requires:
  - phase: 91-multi-key-composite
    provides: strategy_keys table + strategy_keys_owner RLS + api_keys owner RLS + owner-coherence trigger
  - phase: 88-onboarding
    provides: set-members POST route (withAuth/isUuid/NO_STORE_HEADERS/uniform-{code} posture mirrored here)
provides:
  - "GET /api/strategies/composite/members?strategy_id=<uuid> — owner-scoped, secretless composite member read"
  - "Load-bearing no-secret-leak route test (5 column names + 5 sentinel values pinned absent)"
  - "api_key_id surfaced in the member read (non-secret UUID) for WIZ-02 secretless resubmit"
affects: [WIZ-02, WIZ-05, wizard-resumability, MultiKeyConnectStep-rehydration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Secretless-by-construction read: enumerated non-secret SELECT + field-by-field response build (never SELECT *, never spread a DB row) + sentinel leak test + grep gate on source"
    - "No-existence-oracle 403: explicit strategies WHERE id=? AND user_id=? guard returns byte-identical 403 for not-found and not-owned"
    - "Type-cast-only workaround for stale generated types: cast the client TYPE to untyped SupabaseClient while keeping the RLS-scoped user-client instance at runtime (preserves RLS, avoids the untyped admin client)"

key-files:
  created:
    - src/app/api/strategies/composite/members/route.ts
    - src/app/api/strategies/composite/members/route.test.ts
  modified: []

key-decisions:
  - "Kept the RLS-scoped user client (createClient) for the strategy_keys read and cast only its TYPE — deliberately NOT the untyped admin client that existing readers use — so strategy_keys_owner + api_keys owner RLS stay enforced as defense-in-depth"
  - "No migration, no new RLS policy, no SECURITY DEFINER RPC (research-verified): existing owner RLS fully covers the read; a DEFINER read is exactly the surface that could leak ciphertext"
  - "verified: true is correct by construction — add-key read-only-validates every key before minting its strategy_keys row, so membership implies verified; no new column"

patterns-established:
  - "Load-bearing security pin: mutation-honesty verified (a ...m row spread turns the leak test RED) then reverted"

requirements-completed: [WIZ-01]

# Metrics
duration: 22min
completed: 2026-07-11
---

# Phase 94 Plan 01: Composite Members GET (WIZ-01) Summary

**Owner-scoped `GET /api/strategies/composite/members` that returns composite draft member metadata (seq, api_key_id, exchange, nickname, active window, verified) and can NEVER serialize the 5 secret/envelope columns — proven by a sentinel leak test that goes RED under a row-spread mutation.**

## Performance

- **Duration:** ~22 min
- **Completed:** 2026-07-11
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments
- New authenticated GET route: enumerated non-secret embedded select + field-by-field response build; includes the non-secret `api_key_id` UUID that WIZ-02's secretless resubmit needs.
- Owner-scoped via `withAuth` + explicit `strategies WHERE id=? AND user_id=?` guard + existing owner RLS (defense in depth); non-owner/nonexistent → uniform 403 `{ code: "UNKNOWN" }` (no existence oracle).
- Load-bearing no-secret-leak route test: plants all 5 secret sentinels on the mocked rows (row-level + embedded `api_keys`) and asserts the serialized 200 body contains NONE of the 5 column names AND none of the 5 sentinel values.
- No migration, no new RLS policy, no RPC; `strategy_keys` read never issued on the 403 path (pinned).

## Task Commits

Each task was committed atomically:

1. **Task 1: owner-scoped secretless members GET route** - `50a8ba6b` (feat)
2. **Task 2: load-bearing no-secret-leak + owner-scope route test** - `80ab9703` (test)

_TDD note: the plan splits the feature into a route task then a test task; the load-bearing leak pin was mutation-honesty verified (spread → RED) then reverted before the test commit._

## Files Created/Modified
- `src/app/api/strategies/composite/members/route.ts` - `GET` handler: withAuth + isUuid 400 guard + ownership probe (403, no oracle) + RLS-scoped enumerated member read + field-by-field secretless response; NO_STORE_HEADERS on every branch.
- `src/app/api/strategies/composite/members/route.test.ts` - 8 tests: leak pin (names + sentinels), 200 shape/ordering, empty membership, non-owner 403 with strategy_keys read never issued, byte-identical not-found/not-owned, 400 on missing/malformed id, NO_STORE_HEADERS on 200 + 403.

## Decisions Made
- Preserved RLS-scoped user client for the `strategy_keys` read (cast the TYPE only), rejecting the codebase's untyped-admin-client pattern for this table because RLS is the security boundary for WIZ-01.
- `verified: true` by construction (no new column); `api_key_id` required in the response for downstream WIZ-02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale generated DB types don't know `strategy_keys`**
- **Found during:** Task 1 (route compile)
- **Issue:** `src/lib/database.types.ts` predates the `20260710120000_strategy_keys.sql` migration, so the typed user client's `.from("strategy_keys")` failed `tsc` (TS2769 / TS2345). Existing readers (finalize-wizard, admin/strategy-review) sidestep this with the UNTYPED admin client — which bypasses RLS and is unacceptable for this security-critical owner-scoped read.
- **Fix:** Cast the client's TYPE to the project's established `as unknown as SupabaseClient` idiom for the `strategy_keys` call only, keeping the RLS-scoped user-client INSTANCE from `createClient()` at runtime (RLS still enforced). Also routed the row cast through `unknown` because the untyped client infers the to-one `api_keys` embed as an array (runtime returns a single object for the `api_key_id → api_keys.id` FK).
- **Files modified:** src/app/api/strategies/composite/members/route.ts
- **Verification:** `npx tsc --noEmit` clean; grep gate = 0 secret column names; RLS runtime behavior unchanged (type-only cast).
- **Committed in:** `50a8ba6b` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Type-only workaround for pre-existing type-drift (tracked under audit-2026-05-07); no runtime/security impact and no scope creep. Root cause (stale `database.types.ts` regeneration) is out of scope for this plan and left untouched.

## Issues Encountered
None beyond the blocking type-drift documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WIZ-01 security foundation is in place: WIZ-02/WIZ-05 can now server-read composite membership (incl. `api_key_id`) to rehydrate a re-mounted `MultiKeyConnectStep` without dropping key state.
- No blockers.

---
*Phase: 94-wizard-resumability*
*Completed: 2026-07-11*

## Self-Check: PASSED
- route.ts, route.test.ts, 94-01-SUMMARY.md all present
- commits 50a8ba6b (feat), 80ab9703 (test) both in git history
