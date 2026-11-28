---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
verified: 2026-11-28T12:20:00Z
status: passed
score: 4/4 success criteria verified; all three PRs merged, applied and read back on TEST and PROD
verified_at_sha: c98e3d68ecf423eb34608fad621f79b7b554ca34
drift_subjects:
  - src/lib/factsheet/by-basis-projection.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/app/api/keys/validate-and-encrypt/route.ts
  - supabase/migrations/20261127120000_client_role_statement_timeout_pin.sql
  - supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql
  - supabase/migrations/20261127220000_strategy_analytics_anon_column_revoke.sql
  - supabase/migrations/20261127220100_api_keys_insert_fence.sql
  - supabase/tests/test_client_role_timeouts.sql
  - supabase/tests/test_strategy_analytics_anon_grants.sql
  - supabase/tests/test_api_keys_user_id_immutable.sql
  - supabase/tests/test_insert_api_key_rpc.sql
  - supabase/tests/test_api_keys_insert_not_client_writable.sql
  - e2e/helpers/seed-test-project.ts
  - scripts/seed-full-app-demo.ts
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "After PR-C (#1415, migration 20261127220100) merges: confirm apply-test succeeded and the PROD apply ran, then read back on PROD (marker query first) that trigger api_keys_insert_writer_fence exists on public.api_keys (tgtype 7, tgenabled O), its function enforce_api_keys_insert_writer_fence is SECURITY INVOKER, and the ledger holds 20261127220100. Confirm the post-apply baseline re-dump merged and Vercel Production for the PR-C merge sha is success."
    expected: "Fence trigger present and enabled on PROD; a direct service_role insert is refused 42501 and the three postgres-owned writers (insert_api_key, create_wizard_strategy, add_wizard_composite_key) still insert; connect-a-key still works on production."
    why_human: "PR-C is open and not merged at verification time. SC2 half (ii) is verified in code and on a local lane, but it cannot be observed on PROD until the merge applies it. Post-merge read-back is an orchestrator/human step, not a code gap."
---

# Phase 243: DBBACKSTOP Verification Report

**Phase Goal:** An anonymous request reads only named metric keys, an `api_keys` write must belong to its caller (narrowed by founder decision 2026-11-26 to "only the audited writer path can insert, and `user_id` can never be repointed"), and a client role cannot hold a table lock past a timeout.
**Verified:** 2026-11-28 at branch head `c98e3d68e` (worktree `quantalyze-wt-243`, branch `gsd/phase-243-dbbackstop`).
**Status:** passed (re-stated 2026-11-28 by the orchestrator after the PR-C post-merge read-back below). There are zero code gaps. The original verdict was human_needed solely for that read-back.
**Re-verification:** No, initial verification.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An anonymous request reads only the named metric keys a factsheet needs; a test fails on a key outside the pinned alias set (DBACC-01) | VERIFIED | `BY_BASIS_ALIASES` in `src/lib/factsheet/by-basis-projection.ts` is the one literal of 21 `->` aliases. `fetch-and-build-payload.ts:323` and the OG route (`route.tsx:12,238`) both import it. The OG route reads through `createAdminClient()` and no longer puts `metrics_json_by_basis` on its anon embed. A test compares the parsed select against the hand-typed `PINNED_BY_BASIS_ALIAS_NAMES` (21 entries) and fails on an extra or missing key (`by-basis-projection.test.ts:31-34`). Migration `20261127220000` revokes anon's table SELECT/INSERT/UPDATE/DELETE and grants column SELECT on every column except `metrics_json_by_basis`, with a catalogue self-check in the same DO block. Gate `test_strategy_analytics_anon_grants.sql`, run by me on the pg-lane: baseline exit 0, then 7/7 arms RED on their own arm (GRANT 1-4, WRITE 1-2, KEEP 1), then restore exit 0. I found no non-owner anon read of the column left in `src`: the only wildcard embed, `getMyStrategies`, is `.eq("user_id", userId)` and authenticated. Orchestrator PROD read-back: anon cannot SELECT the column, holds no table SELECT or INSERT, and still reads `metrics_json` and `unit_segments`. |
| 2 | A database-level backstop, without `FORCE RLS`, refuses an UPDATE that changes `api_keys.user_id` for every role, and refuses any `api_keys` insert made outside the sanctioned SECDEF writer, including a direct admin-client insert (DBACC-02) | VERIFIED in code, not yet live on PROD (see Human Verification) | Part (i), in PR-A and live on PROD: `api_keys_user_id_immutable` is a BEFORE UPDATE trigger with no column list and a `WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)` clause, over a function that raises unconditionally. Part (ii), on the branch: `20261127220100_api_keys_insert_fence.sql` adds a BEFORE INSERT ROW trigger over a SECURITY INVOKER `current_user IN ('postgres','supabase_admin')` allow-list (a GUC is not used). `FORCE RLS` is not used. The writer `insert_api_key` is SECURITY DEFINER, service_role-only, one overload. `validate-and-encrypt/route.ts:945` calls `admin.rpc("insert_api_key", ...)`. A multi-line scan of `src`, `e2e`, `scripts`, `tests` and `analytics-service` finds no remaining `.from/.table("api_keys").insert/upsert`; the only hits are comments, a fake and an old lineage mention. Seeds moved to the RPC (`insertApiKeyViaRpc` in `e2e/helpers/seed-test-project.ts`, `scripts/seed-full-app-demo.ts`, integration and Python live suites). Gates run by me on the pg-lane: `test_api_keys_insert_not_client_writable` 10/10 arms RED (1, 3, 2s, 2a, 2b, 2c, 2w, 2w-q, 2w-m, 4); `test_api_keys_user_id_immutable` 6/6; `test_insert_api_key_rpc` 9/9. Each had a baseline GREEN and a restore GREEN. The census arm pins the writer set to exactly the three audited functions, with their SECURITY DEFINER mode and postgres owner. |
| 3 | A client role holding UPDATE or DELETE cannot keep a table-wide lock past a set timeout. A recorded TEST measurement comes first (DBACC-03) | VERIFIED | `243-01-MEASUREMENT.md` is recorded before the migration. On TEST, through REST, an anon `LOCK TABLE ... ACCESS EXCLUSIVE` plus `pg_sleep(30)` was cut at 3.20s and 3.87s with SQLSTATE 57014. A concurrent reader was unblocked at release. No idle-in-transaction window was seen. PROD `pg_stat_statements` and 24h logs show no legitimate request near the bounds and 0 "statement timeout" lines. Migration `20261127120000` pins anon 3s and authenticated 8s, with a catalogue-only self-check that also refuses a per-database shadow row. Gate `test_client_role_timeouts.sql`, run by me: baseline GREEN, 6/6 arms RED, restore GREEN. The missing authenticated and service_role TEST arms are an accepted gap by founder decision 2026-11-27 (CONTEXT line 54) and are not counted as a gap here. |
| 4 | PROOF-01: each gate goes RED on a neutered copy with its named arm first, is restored from a byte backup (`cp`, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Each migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane | VERIFIED | The SUMMARYs for plans 02, 03, 04, 05, 06, 07, 09 and 10 carry verbatim RED/GREEN records, with `cmp silent` for the restores (for example 03 lines 122-152, 04 line 118, 06 lines 119-136, 07 lines 130-149, 10 lines 110-122). Plan 08's SUMMARY has no neuter/`cmp` record of its own (it moves seeds, and its proof is the local-stack lane run). `243-REVIEW.md` (PR-A), `243-REVIEW-PRB-R2.md` and `243-REVIEW-PRC-R1.md` each record migration-reviewer CLEAN and rls-policy-auditor CLEAN, including the post-fix re-audit of RLS-M1. The four migrations are serial (`120000`, `120100`, `220000`, `220100`). I re-ran the sibling gates independently, all with RED arms identity-checked (see above). |

**Score:** 4/4 success criteria verified in code. SC2 part (ii) is awaiting PROD application.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `supabase/migrations/20261127120000_client_role_statement_timeout_pin.sql` | VERIFIED | Substantive. Applied on TEST and PROD per the orchestrator. |
| `supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql` | VERIFIED | Applied on TEST and PROD (PR-A #1396, re-dump #1398). |
| `supabase/migrations/20261127220000_strategy_analytics_anon_column_revoke.sql` | VERIFIED | Applied and read back on PROD (PR-B #1405, re-dump #1410). |
| `supabase/migrations/20261127220100_api_keys_insert_fence.sql` and its rollback | VERIFIED on branch | Not yet merged (PR-C #1415). |
| Five SQL gates under `supabase/tests/` | VERIFIED | All reproduced GREEN, and every arm bites RED, by my own run. |
| `src/lib/factsheet/by-basis-projection.ts` plus the pinned-alias test | VERIFIED | WIRED to the payload builder and the OG route. |
| `e2e/helpers/seed-test-project.ts` `insertApiKeyViaRpc`, demo seed, integration and Python seeds | VERIFIED | No direct `api_keys` insert/upsert remains. |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `validate-and-encrypt/route.ts` | `public.insert_api_key` | `admin.rpc("insert_api_key", ...)` at line 945 | WIRED |
| payload builder and OG route | `BY_BASIS_ALIASES` | import and select interpolation | WIRED |
| fence trigger | the three writers | postgres-owned SECDEF, so `current_user` is postgres | WIRED, pinned by gate arms 2w, 2w-q, 2w-m |
| `insert_api_key` | the immutability trigger | same table, UPDATE path | WIRED |

### Data-Flow Trace (Level 4)

The OG route and the payload builder get the 21 alias values from the real `strategy_analytics` row through the service-role client, and `rebuildMetricsJsonByBasis` rebuilds the writer shape. They read a live query, not a static value. The one documented divergence (a basis whose seven values are all null is omitted) is pinned by a test, with 0 PROD rows of that shape.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Fence gate bites on every arm | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_api_keys_insert_not_client_writable.sql` (PGBIN set) | baseline 0, arms 10/10 RED (identity ok), restore 0 | PASS |
| Anon grants gate | same, `test_strategy_analytics_anon_grants.sql` | 7/7 RED, baseline and restore 0 | PASS |
| user_id immutability gate | same, `test_api_keys_user_id_immutable.sql` | 6/6 RED, baseline and restore 0 | PASS |
| Timeout pin gate | same, `test_client_role_timeouts.sql` | 6/6 RED, baseline and restore 0 | PASS |
| Writer RPC gate | same, `test_insert_api_key_rpc.sql` | 9/9 RED, baseline and restore 0 | PASS |
| Alias pin test | `npx vitest run src/lib/factsheet/by-basis-projection.test.ts` | 15 passed | PASS |
| Consumers and census | vitest over the payload builder, OG route directory, `validate-and-encrypt`, `audit-coverage`, `gate-family-meta`, `mutation-runner-floors` | 13 files, 600 tests passed | PASS |

`git status --short` was empty after the mutation runs, so the runner's restore left the tree untouched.

### Probe Execution

No `probe-*.sh` is declared by this phase. Skipped.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| DBACC-01 | Anon reads only named metric keys | SATISFIED | SC1. Live on PROD. |
| DBACC-02 | A DB-level `api_keys` backstop (narrowed 2026-11-26) | SATISFIED in code; PROD application of part (ii) pending | SC2. Part (i) is live. Part (ii) is in PR-C. |
| DBACC-03 | A client role cannot hold a table lock past a timeout | SATISFIED | SC3, with the founder-accepted measurement scope. |

No ORPHANED requirement. REQUIREMENTS.md and ROADMAP.md still show DBACC-01..03 as Pending and the plan rows unticked. Updating them belongs to the `phase complete` step, after the PR-C follow-up.

### Anti-Patterns Found

No TBD, FIXME or XXX markers were introduced in the changed implementation files that I scanned (migrations, `by-basis-projection.ts`, the route and seed helpers). No stubs. Hits on `.insert(` in comments are lineage text.

### Known limits (recorded, not gaps)

- **Role config drift is unwatched.** Nothing compares live `pg_db_role_setting` on TEST or PROD against the pin (stated in the migration header and plan 02's SUMMARY). A dashboard `ALTER ROLE` there would pass unseen until someone re-reads it.
- **Authenticated non-owner read.** `authenticated` keeps table-level SELECT on `metrics_json_by_basis`, so a signed-in non-owner can still read the whole column of a published strategy. It is deferred in CONTEXT and was cited by both rls-policy-auditor passes as the known limit.
- **service_role has no role-level timeout.** Through PostgREST it still inherits `authenticator`'s 8s. The authenticated and service_role TEST arms were accepted as not run (founder 2026-11-27).
- **Fence admits `postgres` and `supabase_admin` by design.** The dashboard SQL editor and migrations can still insert. This is the narrowing the founder accepted.
- **Arm-2a coupling (PR-C review IN-R2-01).** Revoking INSERT from service_role would fail gate arm 2a at the privilege check before the fence is tested. The failure is truthful, but whoever lands that revoke must re-shape arm 2a. Recorded in the PR-C review as Info.

### Human Verification Required

#### 1. PR-C post-merge read-back (pending orchestrator follow-up)

**Test:** After #1415 merges, confirm `apply-test` and the PROD apply of `20261127220100` succeeded. Run the marker query first, then read back on PROD that `api_keys_insert_writer_fence` exists on `public.api_keys` (tgtype 7, tgenabled `O`) and that its function is SECURITY INVOKER with no EXECUTE for anon or authenticated. Confirm the post-apply baseline re-dump merged (it carries one expected `SNAPSHOT_MISSING enforce_api_keys_insert_writer_fence/0` until then) and that the Vercel Production deployment for the merge sha is success.
**Expected:** The trigger is live. A direct service_role insert is refused 42501. A connect-a-key through `/api/keys/validate-and-encrypt` and the wizard writers still succeed.
**Why human:** PR-C is open at verification time. This is delivery state, not a defect in the branch. The deploy order the migration header requires (PR-B's route live before the fence applies) holds: PR-B's Vercel Production deployment of `9c5c414b` is success.

### Gaps Summary

There are no code gaps. Every roadmap success criterion is met by code on the branch, by gates I re-ran with every arm biting, and (for SC1, SC3 and SC2 part (i)) by PROD read-back already taken by the orchestrator. The status is `human_needed` only because the PR-C fence is not yet applied to PROD, so SC2's second half is not observable there yet. Once the read-back above is done, a re-verification, or a `phase complete` decision by the orchestrator, can move the status to `passed`.

---

_Verified: 2026-11-28T12:20:00Z_
_Verifier: Claude (gsd-verifier)_


## Post-merge read-back (orchestrator, 2026-11-28) — the human_verification item, done

- PR-C #1415 merged as squash `416a2efb67e6b725cbe9e08f36a56f635109a37b` (CI 31 pass, the only red the expected stale-baseline `SNAPSHOT_MISSING enforce_api_keys_insert_writer_fence/0` and its `frontend` aggregate).
- Supabase Migrate run `46136704462`: apply-test, apply (PROD), redump-dump and redump-push all success; the re-dump landed on main as `1faea7ab` (v0.133.114.1).
- PROD (marker query first, it named PRODUCTION): ledger holds `20261127220100`; trigger `api_keys_insert_writer_fence` on `public.api_keys`, `tgtype 7`, `tgenabled O`; its function is not SECURITY DEFINER, `proconfig` `search_path=pg_catalog, public`, no anon or authenticated EXECUTE.
- PROD behaviour: `BEGIN; SET LOCAL ROLE service_role; INSERT INTO public.api_keys (...) ...; ROLLBACK;` answered `42501: api_keys: INSERT refused for role service_role: only the audited writer functions may insert (DBACC-02)`; a follow-up count of the probe label read 0 rows.
- TEST (marker query first, it named TEST): ledger holds `20261127220000` and `20261127220100`; the fence trigger is present and enabled; anon cannot SELECT `metrics_json_by_basis`.
- Vercel Production deployment `8128263550` for `416a2efb`: success. The route already writes through `insert_api_key` since PR-B (#1405, deployment `8119670726` success), so connect-a-key never depended on a direct insert when the fence applied.
