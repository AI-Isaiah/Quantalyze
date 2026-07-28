---
phase: 25-read-only-sharing
plan: 01
subsystem: database
tags: [postgres, supabase, rls, security-definer, share-token, sha256, next16]

# Dependency graph
requires:
  - phase: 23-scenario-persistence
    provides: "scenarios table (allocator_id owner RLS, draft JSONB, schema_version) + the database.types hand-patch precedent + dump-sql-functions snapshot gate"
  - phase: 18-strategy-analytics
    provides: "strategy_analytics.daily_returns + strategies.status='published' RLS predicate"
provides:
  - "scenario_shares table (owner RLS on created_by, REVOKE anon, partial unique index = one active share per scenario)"
  - "get_shared_scenario(p_token_hash TEXT) SECURITY DEFINER read RPC — the SOLE anon/cross-tenant data path, leak-scoped to name/draft/schema_version + addedStrategies[].id published series"
  - "down/ rollback (DROP FUNCTION + DROP TABLE CASCADE)"
  - "hand-patched database.types.ts scenario_shares Row/Insert/Update + guard test"
  - "two-tenant + anon CONTENT-leak + revoke-immediacy SQL test (the honesty proof)"
affects: [25-02-scenario-share-token, 25-03-share-routes, 25-04-recipient-page]

# Tech tracking
tech-stack:
  added: []  # no new packages — all primitives in-tree (Supabase Postgres, pg14 core sha256, Node crypto deferred to 25-02)
  patterns:
    - "Token-scoped SECURITY DEFINER read RPC as the sole anon path (synthesis of mig 117 token-RPC shape + mig 134 _assert_no_public_execute self-verify + mig 87 read-path search_path)"
    - "hash-in-Node (RPC takes precomputed sha256 hex p_token_hash) — no pgcrypto digest extension"
    - "body-shape self-assert DO-block (pg_get_functiondef regex) proving the RPC body keeps the revoke gate + published filter and references no live-book tables"

key-files:
  created:
    - supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql
    - supabase/migrations/down/20260622120000-rollback.sql
    - supabase/tests/test_scenario_shares_rls.sql
    - supabase/schema/functions/get_shared_scenario.sql
  modified:
    - src/lib/database.types.ts
    - src/lib/database.types.test.ts

key-decisions:
  - "hash-in-Node, not hash-in-SQL — RPC signature is get_shared_scenario(p_token_hash TEXT). The repo enables no pgcrypto digest; Plan 25-02 owns the single sha256 digest site."
  - "search_path = public, pg_temp (read-path canon, mig 87 H-B / mig 117 claim RPCs), NOT pg_catalog — surfaced the mig-117 read-vs-mark conflict per CLAUDE Rule 7."
  - "Kept the recommended body-shape self-assert DO-block (action step e) even though its leak-guard RAISE strings name api_keys/portfolios — the plan's blunt whole-file absence grep is in tension with its own action step; the function BODY is clean (verified by extracting CREATE FUNCTION...$$;)."
  - "UUID-shape filter uses the strict 8-4-4-4-12 hyphenated regex (not the loose [0-9a-f-]{36}) so it cannot match a 36-char non-UUID poison ref."
  - "Regenerated supabase/schema/functions/get_shared_scenario.sql — the dump-sql-functions --check CI gate snapshots every CREATE FUNCTION and would fail otherwise."

patterns-established:
  - "Pattern: a new SECURITY DEFINER function MUST be accompanied by a regenerated dump-sql-functions snapshot file or the --check gate red-checks."
  - "Pattern: CONTENT-by-field SQL assertion (no api_key|allocated_amount|account_balance|value_usd in the returned payload) is the only honest proof of a SECURITY DEFINER scope — a 200/row-count passes for the wrong reason."

requirements-completed: [SHARE-02, SHARE-03]

# Metrics
duration: 7min
completed: 2026-06-22
---

# Phase 25 Plan 01: Read-Only Sharing Security Foundation Summary

**Token-scoped `get_shared_scenario` SECURITY DEFINER read RPC over a revocable `scenario_shares` table (owner RLS + REVOKE anon + one-active-share partial unique index), leak-scoped to name/draft/schema_version + only the draft's `addedStrategies[].id` published series, with a `_assert_no_public_execute` + body-shape self-verify and a two-tenant CONTENT-leak + revoke-immediacy SQL test.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-22T09:37:14Z
- **Completed:** 2026-06-22T09:44:34Z
- **Tasks:** 3
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- `scenario_shares` table: owner RLS (`created_by = auth.uid()`), `REVOKE ALL FROM anon`, partial unique index `scenario_shares_one_active_idx (scenario_id) WHERE revoked_at IS NULL` enforcing at most one active share per scenario, plus a scenario lookup index. No `updated_at`/trigger (Phase-23 no-tracked-function rule).
- `get_shared_scenario(p_token_hash TEXT)` SECURITY DEFINER STABLE RPC: `SET search_path = public, pg_temp`; gates on `token_hash = p_token_hash AND revoked_at IS NULL`; EXPLICIT 4-column return (never `SELECT *`); resolves series ONLY for strict-UUID-shaped `addedStrategies[].id` filtered to `strategies.status = 'published'`; never touches holdings/AUM/api_keys/portfolios.
- Defense-in-depth: `REVOKE ALL … FROM PUBLIC, anon` + `GRANT EXECUTE … TO service_role` (never anon) + `_assert_no_public_execute('public.get_shared_scenario(text)')` self-verify + a body-shape DO-block asserting the revoke gate, the published filter, the search_path, and the absence of api_keys/portfolio_strategies/portfolios.
- `down/20260622120000-rollback.sql` drops the function and the table CASCADE.
- Hand-patched `database.types.ts` `scenario_shares` Row/Insert/Update block + a `SHARE` guard describe block in `database.types.test.ts` (8/8 vitest green, tsc clean, notify_*/scenarios tripwires intact).
- Load-bearing `test_scenario_shares_rls.sql`: CONTENT-by-field (no `api_key|allocated_amount|account_balance|value_usd`), empty-addedStrategies → `series=[]`, unknown token → 0 rows, revoke-immediacy (`revoked_at = now()` → 0 rows), cross-tenant read isolation, anon direct SELECT → 42501, cross-tenant revoke → 0 rows.

## Task Commits

Each task was committed atomically:

1. **Task 1: SQL CONTENT-leak + revoke-immediacy test (Wave-0 RED)** — `c313a355` (test)
2. **Task 2: scenario_shares migration + get_shared_scenario RPC + self-verify + rollback** — `7487e254` (feat) — also carries the regenerated `supabase/schema/functions/get_shared_scenario.sql` snapshot (Rule 3 auto-fix)
3. **Task 3: hand-patch database.types scenario_shares block + guard test** — `84d65d93` (feat)

_Note: Task 1 is the TDD RED commit; the GREEN gate is the migration applying to the test DB in CI's `sql-tests` job (not a local push — see Deviations / migration discipline)._

## Files Created/Modified
- `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql` — table + owner RLS + REVOKE anon + partial unique index + leak-scoped SECURITY DEFINER RPC + PUBLIC-EXECUTE self-verify + body-shape self-assert.
- `supabase/migrations/down/20260622120000-rollback.sql` — DROP FUNCTION + DROP TABLE CASCADE.
- `supabase/tests/test_scenario_shares_rls.sql` — two-tenant + anon CONTENT-leak + revoke-immediacy + cross-tenant-direct-read-denial assertions (plain PL/pgSQL, `test_*.sql` glob).
- `supabase/schema/functions/get_shared_scenario.sql` — generated snapshot (dump-sql-functions gate).
- `src/lib/database.types.ts` — hand-patched `scenario_shares` Tables block.
- `src/lib/database.types.test.ts` — `SHARE` guard describe block mirroring the PERSIST-01 scenarios pin.

## Decisions Made
- **hash-in-Node over hash-in-SQL.** The RPC takes `p_token_hash TEXT` (a precomputed sha256 hex), not a raw token. Per the plan's objective decision (no pgcrypto `digest` enabled in-tree); Plan 25-02's `scenario-share-token.ts` is the single digest source-of-truth, and the SQL test computes sha256 hex itself via pg14 core `sha256(bytea)` to stand in for the route.
- **`search_path = public, pg_temp` (not pg_catalog).** Surfaced the mig-117 read-vs-mark RPC conflict (CLAUDE Rule 7): the read path canon (mig 87 H-B + mig 117 claim RPCs) uses `public, pg_temp`; the mark RPCs use `public, pg_catalog`. Used the more-recent read-path canon.
- **Strict UUID regex** `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` instead of the plan's illustrative loose `^[0-9a-f-]{36}$`, so a 36-char non-UUID poison ref cannot slip through the addedStrategies extraction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Regenerated the dump-sql-functions snapshot for the new RPC**
- **Found during:** Task 2 (migration authoring)
- **Issue:** `scripts/dump-sql-functions.ts --check` (a blocking CI gate, tech-debt #2) replays every migration and snapshots every `CREATE FUNCTION` to `supabase/schema/functions/<name>.sql`. The new `get_shared_scenario` RPC made the committed snapshot stale (verified: `--check` reported exactly one missing file, `get_shared_scenario.sql` — proving the migration was the only function delta). Without the snapshot, the migration would red-check CI.
- **Fix:** Ran `npm run schema:functions`; the generator wrote `supabase/schema/functions/get_shared_scenario.sql` (92 functions now, was 91); `--check` is current.
- **Files modified:** `supabase/schema/functions/get_shared_scenario.sql` (created)
- **Verification:** `npm run schema:functions:check` → "SQL function snapshot is current (92 functions)."
- **Committed in:** `7487e254` (Task 2 commit)

### Plan-grep vs. action-step conflict (resolved, no code change)

The plan's Task-2 `<verify>` includes `! grep -Eq "api_keys|portfolio_strategies|getMyAllocationDashboard"` over the **whole** migration file, but the plan's `<action>` step (e) explicitly **recommends** a body-shape self-assert DO-block whose leak-guard `RAISE EXCEPTION` strings *name* `api_keys`/`portfolio_strategies`/`portfolios` (that's the guard logic). The two are in direct tension (CLAUDE Rule 7). Resolution: kept the recommended body-shape guard (the stronger, apply-time mechanism) and verified the *intent* precisely — extracted the `CREATE FUNCTION … $$;` body and confirmed it references only `scenario_shares`, `scenarios`, `strategy_analytics`, `strategies` (and `jsonb_array_elements`); no forbidden live-book table. The only occurrences of the forbidden table names in the whole migration are inside the guard's own RAISE messages.

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking) + 1 documented grep-vs-action-step reconciliation (no code change).
**Impact on plan:** The snapshot regen is mandatory for CI green and is standard practice for any new SECURITY DEFINER function. No scope creep.

## Issues Encountered
None — all three tasks completed cleanly. tsc (exit 0) and `vitest run src/lib/database.types.test.ts` (8/8) confirm the type hand-patch is valid and the pre-existing tripwires are intact.

## User Setup Required
None — no external service configuration required. No new secret env var (the stored-hash model needs no HMAC secret; entropy comes from `randomBytes`, deferred to Plan 25-02).

## Next Phase Readiness
- **25-02 (scenario-share-token.ts):** the RPC contract `get_shared_scenario(p_token_hash TEXT)` is locked; 25-02 must compute `sha256(raw)` hex matching what the SQL test computes (`encode(sha256(raw::bytea),'hex')`), and is the single digest source-of-truth.
- **25-03 (share routes):** can type `.from("scenario_shares")` against the new `database.types.ts` block; the generate route should pre-revoke any active share before insert (the partial unique index is the structural backstop); revoke sets `revoked_at = now()`.
- **25-04 (recipient page):** calls `get_shared_scenario` via `createAdminClient` (service_role transport — the RPC is GRANTed to service_role only); must branch on the codec outcome (only `"ok"` renders; `"readonly"`/`"reset"` → honest-absence, the DI-23-01 landmine).

### Build-time vs. deferred verification
The migration is NOT applied during this build (Phase 23/24 discipline — no `supabase db push`). It applies to the TEST project at /ship as the `sql-tests` CI prerequisite, and to PROD at /land via the Supabase Migrate workflow. Build-time proof rested on: tsc clean, `vitest run database.types.test.ts` 8/8, `schema:functions:check` current, and the structural grep gates on the migration/rollback. `test_scenario_shares_rls.sql` goes GREEN once the migration applies to a DB in CI's `sql-tests` job.

---
*Phase: 25-read-only-sharing*
*Completed: 2026-06-22*

## Self-Check: PASSED

- Created files verified present: `test_scenario_shares_rls.sql`, `20260622120000_scenario_shares_and_read_rpc.sql`, `down/20260622120000-rollback.sql`, `schema/functions/get_shared_scenario.sql`, `database.types.ts`, `database.types.test.ts`.
- Commits verified in git log: `c313a355` (test), `7487e254` (feat: migration+rollback+snapshot), `84d65d93` (feat: types+guard).
- Build-time gates green: tsc exit 0; `vitest run database.types.test.ts` 8/8; `schema:functions:check` current (92 functions); migration/rollback structural grep gates pass.
