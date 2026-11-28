---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
scope: plan 10 (PR-C), diff 8df1e762f..HEAD excluding .planning
round: 1
reviewed: 2026-11-28T00:00:00Z
depth: deep
files_reviewed: 13
files_reviewed_list:
  - TODOS.md
  - scripts/baseline-content-drift-check.mjs
  - scripts/dump-sql-functions.ts
  - scripts/mutation-floors.mjs
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - supabase/migrations/20261127220100_api_keys_insert_fence.sql
  - supabase/migrations/down/20261127220100-rollback.sql
  - supabase/schema/functions/enforce_api_keys_insert_writer_fence.sql
  - supabase/tests/test_api_keys_exchange_not_user_writable.sql
  - supabase/tests/test_api_keys_insert_not_client_writable.sql
  - supabase/tests/test_insert_api_key_rpc.sql
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
  necessity: 0
status: issues_found
---

# Phase 243 plan 10 (PR-C): Code Review Report, round 1

**Reviewed:** 2026-11-28
**Depth:** deep
**Files Reviewed:** 13
**Status:** issues_found (2 MEDIUM, 0 HIGH/CRITICAL)

## Summary

The fence is correct as built. A SECURITY INVOKER BEFORE INSERT ROW trigger with a `current_user IN ('postgres','supabase_admin')` allow-list does what the header says. Inside the three postgres-owned SECURITY DEFINER writers, `current_user` is postgres, so those inserts pass. A direct service_role, authenticated, anon or unknown-role insert is refused with 42501. The verify block reads only the catalogue, and the rollback is symmetric.

What I re-measured on the tree, not taken from the SUMMARY:

- **Census.** `node scripts/mutation-runner/run.mjs --parse-only` prints `coverage: files 101/128`, `arms: 0/1132/0`, `No static defects`. Old arms for the insert gate: 1, 3, 4. New arms: 1, 3, 2s, 2a, 2b, 2c, 2w, 4, so 3 -> 8. The exchange gate goes 4 -> 5. Total +6, which matches `ARMS_FLOOR` 1132. `FILES_FLOOR` 101 still holds. `mutation-runner-floors`, `mutation-annotation-parser`, `gate-family-meta` and `baseline-content-drift-allowlist` pass: 280 tests.
- **Drift bookkeeping.** `node scripts/baseline-content-drift-check.mjs` prints `functions compared 151 — MATCH 147, DRIFT 3, SNAPSHOT_MISSING 1`, `findings 1`. The one finding is exactly `SNAPSHOT_MISSING enforce_api_keys_insert_writer_fence/0`, and the 3 DRIFT rows are the 3 allowlisted ones. `npx tsx scripts/dump-sql-functions.ts --check` prints `snapshot is current (149 functions)`, and DRIFT-05 (a) agrees with 1 ratcheted disagreement. VAC-04 (`prod-body-drift-check.sh`) passes a function that is new and absent from PROD by design, at the ":ZERO bodies compared — all ... new" branch. I found no second red source.
- **Lints.** `lint-sql-gates` reports 0 findings. `lint-migration-data-dependence` reports 0 NEW. `lint-app-guc` reports 0 findings.
- **Remaining client-role `api_keys` inserts.** None remain in src, e2e, scripts, tests, tools, analytics-service, supabase/functions or supabase/tests:
  - TS/JS/Py: no code `.from/.table("api_keys").insert|upsert`. The only hits are comments and one in-memory fake (`test_walletoffset_probe.py:1756`). No REST POST to `/rest/v1/api_keys`. The seeds use `insert_api_key`: `seed-test-project.ts:123`, `live-db.ts:168` and `seed-full-app-demo.ts:1587`.
  - SQL corpus: I ran a role-tracking scan over every `INSERT INTO [public.]api_keys` in `supabase/tests`. The only inserts under a non-postgres role are the deliberate ones in the two fence-aware gates: the 2a, 2c and 5 probes, and the 5c scrub half with the fence disabled. The other flagged lines were `ON CONFLICT ... SET role = EXCLUDED.role`, which are false positives.
  - The psycopg live tests, the `*-sql-exec` vitest clusters and the pg-lane all connect as `postgres` (`initdb -U postgres`, `psql -U postgres`), so they pass the allow-list.
- **Writer set.** Only `insert_api_key`, `create_wizard_strategy` and `add_wizard_composite_key` carry an `INSERT INTO api_keys`, both in `supabase/schema/functions/` and in `baseline.sql`. All three are SECURITY DEFINER.
- **Arm 2c probe.** `format('GRANT %I TO %I', ..., current_user)` grants membership to the session user by name. That is semantically what `GRANT ... TO CURRENT_USER` meant, so the fix changes no assertion. The probe role reaches the fence before RLS WITH CHECK: BEFORE triggers run first, and `api_keys_insert_writer_fence` sorts ahead of `api_keys_scrub_attested_venue`. If the deny-list mutation lets it pass the fence, it fails at RLS or at another layer, and both branches still raise `TEST FAILED (2c)`. Everything rolls back, the role included.
- **Arms 2a, 2b, 2w and `5c fence restored`.** Each mutation reddens its own arm first. 2b's `current_setting('role') = 'none'` mutation is valid because SECURITY DEFINER does not change the `role` GUC, so the mutated fence refuses the writer only under the client role.
- The three vitest suites that failed in my broad run (planning-hygiene, sql-mutation-scope-step, local-stack-lane-wiring) were 5 s timeouts and a leftover scratch worktree. They pass on re-run with `--testTimeout=120000` (166/166).

The two MEDIUMs are about gate arms. One pins a grant the fence made dead, under a message this diff rewrote and got wrong. The other leaves two of the three writers unproven against the fence.

## Warnings

### WR-01 (MEDIUM): arm 6's service_role-INSERT positive now pins a dead grant, under an OUTAGE message this diff rewrote with a false mechanism

**File:** `supabase/tests/test_api_keys_insert_not_client_writable.sql:582-585`. The message was rewritten in this diff; it is `+436` in the gate's diff hunk.

**Issue:** Since the fence, a `service_role` INSERT on `api_keys` is refused 42501 whatever its grant, and arm 2a proves exactly that. The three writers are postgres-owned SECURITY DEFINER functions, so the privilege check on their INSERT runs against **postgres**, not service_role. The `INSERT` grant to `service_role` therefore no longer enables any path. Arm 6 still raises `OUTAGE (6)` if it is missing, and the new message gives a wrong cause: "EVERY connect-a-key is broken ... because the audited writers (insert_api_key and the wizard RPCs) all run as service_role requests. REMEDY: GRANT INSERT ON public.api_keys TO service_role".

Consequences:

- (a) The gate fails CI with a false outage diagnosis on the correct follow-up hardening, `REVOKE INSERT ON public.api_keys FROM service_role`, which would add a privilege-layer refusal in front of the fence.
- (b) The remedy it prints tells the operator to re-grant a privilege the threat model wants gone.
- (c) The arm claims to be the anti-vacuity check that tells "the browser's door is shut" apart from "connect-a-key is broken". That job now belongs to 2b, which actually calls a writer. This half of arm 6 tests the wrong thing.

**Fix:** Delete the `service_role` INSERT positive from arm 6, and point its anti-vacuity role at 2b in the arm-6 header and in the `Assertion 6 OK` notice. Keep the `authenticated` DELETE positive. If keeping the grant is meant to stay a recorded decision rather than an invariant, write it as a comment, not as a raise. The minimal edit:

```sql
-    IF NOT has_table_privilege('service_role', 'public.api_keys', 'INSERT') THEN
-      RAISE EXCEPTION
-        'OUTAGE (6): service_role lacks INSERT on api_keys — ... REMEDY: GRANT INSERT ON public.api_keys TO service_role;';
-    END IF;
+    -- Since Phase 243 plan 10 the service_role INSERT grant enables nothing (the fence
+    -- refuses every service_role INSERT, and the writers' INSERT is checked against their
+    -- owner, postgres). Connect-a-key's positive is arm 2b, which calls the writer.
```

Update header invariant 6 (lines 86-90) and the `Assertion 6 OK` notice (line 590) in the same edit. Arm 6 has no `RED-UNDER-M` twin, so the census does not move.

### WR-02 (MEDIUM): the fence makes the writers' SECURITY DEFINER mode and postgres ownership load-bearing for connect-a-key, but only `insert_api_key` is proven admitted; `create_wizard_strategy` and `add_wizard_composite_key` are never exercised under a client role on the fenced lane

**File:** `supabase/tests/test_api_keys_insert_not_client_writable.sql:375-420` (2b covers `insert_api_key` only) and `:472-495` (2w pins names only).

**Issue:** Before this migration, a wizard writer re-declared SECURITY INVOKER, or re-owned to a role outside the allow-list, still worked, because service_role held INSERT and BYPASSRLS. Under the fence the same change makes the trigger see `current_user = service_role` and refuse every wizard connect. That breaks the single-key wizard at `src/app/api/strategies/create-with-key/route.ts:2242` and the composite add-key at `src/app/api/strategies/composite/add-key/route.ts:528`. Both are user-facing.

Nothing in the corpus would catch it:

- 2b calls only `insert_api_key`.
- 2w compares `proname` only, not `prosecdef` or `proowner`.
- Every corpus call of `create_wizard_strategy(` / `add_wizard_composite_key(` runs either as postgres or as `authenticated` expecting a denial. A role-tracking scan confirmed this for `test_api_keys_exchange_not_user_writable.sql:737/781/856/893`, `test_api_keys_venue_identity_uniq.sql:890/925/1007` and `test_csv_finalize_double_submit.sql:369`. Under postgres the fence admits the call even when the function is INVOKER.
- No gate pins `prosecdef` for these two functions. The `prosecdef` pins that exist cover `create_wizard_strategy_for_key`, which does not insert `api_keys`, and the scrub trigger.
- The live-DB lane's `wizard-rpcs-live-db` already carries six ledgered failures, according to the SUMMARY's own reading.

**Fix:** Turn 2w from a name set into a (name, mode, owner) set. This is one catalogue assertion and needs no new fixture. Its existing `sql` twin still reddens it.

```sql
SELECT string_agg(DISTINCT p.proname || ':' || p.prosecdef::text || ':' || pg_get_userbyid(p.proowner),
                  ', ' ORDER BY p.proname || ':' || p.prosecdef::text || ':' || pg_get_userbyid(p.proowner))
  INTO v_writers
  ...;
-- want: 'add_wizard_composite_key:true:postgres, create_wizard_strategy:true:postgres, insert_api_key:true:postgres'
```

Adding a twinned edit arm that flips one wizard writer to `SECURITY INVOKER` would prove the bite. Check first that the migration's own post-verify does not abort that apply, which is the same trap the header notes for 2b. If it does, use a `sql` step: `ALTER FUNCTION public.create_wizard_strategy(...) SECURITY INVOKER`.

## Info

### IN-01: arm 2w's regex misses quoted identifiers, and the recorded limit understates the blind spot

**File:** `supabase/tests/test_api_keys_insert_not_client_writable.sql:475-477, 488-489`

`insert\s+into\s+(public\.)?api_keys\y` does not match `INSERT INTO "api_keys"` or `INSERT INTO public."api_keys"`. The recorded limit says the fence "still refuses such a function unless postgres owns it". In this repo every migration-created function is postgres-owned, and `restore-test-from-baseline.sh` treats a non-postgres owner as an anomaly. So a SECURITY DEFINER inserter that 2w cannot see (dynamic SQL, quoted identifier) passes the fence in practice. Widen the regex to `insert\s+into\s+("?public"?\s*\.\s*)?"?api_keys"?\y` and reword the limit as "a postgres-owned DEFINER function invisible to this arm passes the fence".

### IN-02: the `api_keys.attested_venue` column comment still describes a service-role direct INSERT as possible

**File:** `supabase/schema/baseline.sql:14169` (PROD's live comment). This diff does not change it.

The comment says "a service-role client doing a plain INSERT INTO api_keys writes this column UNSCRUBBED ... it does NOT stop a service-role direct INSERT". After this migration that is no longer true on PROD, and the comment is what a reader of the catalogue sees. A refreshed comment could ride on the next migration that touches `api_keys`.

### IN-03: a line-number citation into the re-shaped gate went stale

**File:** `scripts/restore-test-from-baseline.sh:586-587`

It cites `test_api_keys_insert_not_client_writable.sql:240` for the "a DISABLED trigger scrubs nothing" text, which now sits at about `:276`. This is the `[164.7-CITATION-DRIFT-01]` class. Cite by arm (`arm 3`) instead.

---

_Reviewed: 2026-11-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Other lanes on the plan 10 diff (2026-11-28)
- migration-reviewer: CLEAN (0 findings; data-dependence lint 0 NEW; drift bookkeeping re-measured: one expected `SNAPSHOT_MISSING enforce_api_keys_insert_writer_fence/0` until the post-apply re-dump).
- rls-policy-auditor: migration CLEAN; **RLS-M1 (MEDIUM)** arm 2w's writer-set regex misses quoted identifiers (`"public"."api_keys"`), `MERGE INTO`, `INSERT INTO ONLY` and BEGIN ATOMIC bodies (prosqlbody); a future postgres-owned SECDEF inserter in one of those spellings would escape the census. Same defect as the code reviewer's IN-01.
- silent-failure-hunter: 0 MEDIUM+ (no production client-role inserter left; LOW tail recorded: regex spellings, replica mode unmeasured, lock_timeout retry, dead pre-revoke branch).
- Orchestrator PROD read (marker first, 2026-11-27): the only functions whose body inserts into api_keys are insert_api_key, create_wizard_strategy and add_wizard_composite_key, all postgres-owned SECURITY DEFINER.
- Disposition: WR-01, WR-02 and RLS-M1 go to one gsd-code-fixer round (all in test_api_keys_insert_not_client_writable.sql).

## Fix round 1 (2026-11-28)

All three findings were fixed in `supabase/tests/test_api_keys_insert_not_client_writable.sql`. The gate is the only source file touched, apart from the census moves below.

- **WR-01: fixed, commit `80ccd15ab`.** Arm 6 no longer asserts that `service_role` holds INSERT on `api_keys`. Its header (invariant 6), its inline comment and the `Assertion 6 OK` notice now point at arm 2b as the INSERT-side anti-vacuity positive. The `authenticated` DELETE positive is kept. The false "writers run as service_role" OUTAGE message is gone.
- **WR-02: fixed, commit `7625a2fad`. Logic assertion, requires human verification.** A new arm `2w-m` compares `proname:prosecdef:owner` for the writer set against `add_wizard_composite_key:true:postgres, create_wizard_strategy:true:postgres, insert_api_key:true:postgres`. Its twinned mutation is a `sql` step that runs `ALTER FUNCTION public.create_wizard_strategy(...13 args) SECURITY INVOKER`. The runner reports it `RED (identity ok)`, with 2w still green first. The mode and owner check could not live in arm 2w itself: arm ids must be unique per file and each twin must redden its own id first.
- **RLS-M1: fixed, commit `fe51497d4`. Logic assertion, requires human verification.**
  - 2w now reads `pg_get_functiondef` (comment-stripped, aggregates skipped via `CASE prokind IN ('f','p')`) instead of `prosrc`, so BEGIN ATOMIC bodies (empty `prosrc`) are read.
  - A new arm `2w-q` requires the set found with the widened regex `(insert|merge)\s+into\s+(only\s+)?("?public"?\s*\.\s*)?"?api_keys\y"?` to equal 2w's plain-spelling set.
  - Its twin creates a function inserting into `"public"."api_keys"`.
  - Spot checks, not committed: a `BEGIN ATOMIC` rogue goes RED under 2w, and a `MERGE INTO ONLY public.api_keys` rogue goes RED under 2w-q.
  - The recorded limit is reworded: dynamic SQL and non-SQL/plpgsql inserters stay invisible, and a postgres-owned SECURITY DEFINER function invisible to the arm passes the fence.
- **Census, commit `4ffdff757`.** ARMS_FLOOR 1132 -> 1134 (+2 `sql`-step arms, so `stepsSeen` and `needles.length` do not move). FILES_FLOOR stays 101. `ci.yml` is untouched: this file declares no `ALL N ARMS EXECUTED` sentinel, so it is not in the sentinel derivation table.

Verification (pg-lane, main checkout of this worktree): `lint-sql-gates` 0 findings, `--parse-only` `arms: 0/1134/0` with no static defects, and the `--file` diagnostic run of the gate printed baseline exit 0 and 10/10 arms `RED (identity ok)`. The four census suites (295 tests, `--testTimeout=240000`), `npx tsc --noEmit` and `npm run lint` all pass.

## Round 2 (2026-11-28): re-review of the fix commits

**Scope:** `git diff 95eeff0bd HEAD -- . ':!.planning'`, which covers commits `80ccd15ab`, `7625a2fad`, `fe51497d4` and `4ffdff757` (5 files: the gate, `scripts/mutation-floors.mjs` and three census suites).
**Reviewer:** Claude (gsd-code-reviewer), deep.
**Verdict:** clean at MEDIUM+. 0 critical, 0 warning, 4 info. All three round-1 findings are closed.

### Verdicts on the round-1 findings

- **WR-01: CLOSED.** Arm 6 no longer raises `OUTAGE (6)` when service_role lacks INSERT. The false "writers run as service_role" cause and the `GRANT INSERT ... TO service_role` remedy are gone. Header invariant 6, the arm-6 comment and the `Assertion 6 OK` notice all point at 2b as the INSERT-side positive. The `authenticated` DELETE positive is kept. Arm 6 had no twin, so the census does not move. One residue is recorded as IN-R2-01 below; it does not reopen the finding.
- **WR-02: CLOSED.** Arm 2w-m pins `name:prosecdef:owner` over the writer set against `add_wizard_composite_key:true:postgres, create_wizard_strategy:true:postgres, insert_api_key:true:postgres`. I checked that this holds on the shipped catalogue. All three are `SECURITY DEFINER` with an explicit `OWNER TO "postgres"` in `supabase/schema/baseline.sql` (lines 1119, 4063 and 8293). The 13-argument signature in the twin's `ALTER FUNCTION` matches baseline line 4063 exactly.
- **RLS-M1: CLOSED.** Arm 2w now reads comment-stripped `pg_get_functiondef`. Arm 2w-q requires the widened set (`(insert|merge) into [only] ["public".]"api_keys"`) to equal the plain-spelling set. The plain regex is a subset of the widened one, so the `FILTER` inside the widened `WHERE` computes exactly the old plain set.

### What I re-measured myself (not taken from the fixer's notes)

- **Each twin reddens its own arm first.** `node scripts/mutation-runner/run.mjs --file supabase/tests/test_api_keys_insert_not_client_writable.sql` printed baseline exit 0, then **10/10 arms `RED (identity ok)`** (1, 3, 2s, 2a, 2b, 2c, 2w, 2w-q, 2w-m, 4), then restore exit 0, with `arms: 10/10/0`, `biting: 10` and `lane-invocations: 10`. That covers the two fixes the fixer flagged "requires human verification" (2w-q, 2w-m).
- **Spelling coverage**, on a throwaway PG 16.13 cluster with fixture functions:
  - The plain set caught a plpgsql writer, a procedure, and two BEGIN ATOMIC writers. One of those was written as `"public"."api_keys"`; the deparser emits it as `INSERT INTO api_keys`, so the plain regex sees it.
  - The widened set also caught `MERGE INTO ONLY public.api_keys`, `INSERT INTO "api_keys"`, `INSERT INTO public . "api_keys"` and `INSERT INTO "public"."api_keys"`.
  - Prose in `--` and `/* */` comments was ignored.
  - `INSERT INTO ONLY` is a **syntax error** in PostgreSQL, so of the ONLY forms only `MERGE INTO ONLY` is real. The `(only\s+)?` group is harmless, so nobody needs to chase an INSERT form.
- **No extra writers on the shipped schema.** I ran both regexes, after the comment strip, over all 150 function definitions in `baseline.sql`. Each matched exactly the three audited writers. No migration newer than the dump defines an inserter (the fence migration only names the writers in comments).
- **`pg_get_functiondef` cannot error here.** In PostgreSQL's `pg_get_functiondef`, the only `ereport(ERROR)` is for `prokind = 'a'`, and an unknown oid returns NULL. Empirically, `pg_get_functiondef` returned for all **4204 non-aggregate rows** of `pg_proc` on PG16, with these extensions installed: `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `pg_trgm`, `hstore`, `citext`, `plperl` with its transforms, `pltcl`, `dblink`, `postgres_fdw` and about 20 more. Those rows covered languages c (891), internal (3198), sql, plpgsql, window (15) and a procedure.
  - ⚠️ **The schema filter does NOT protect the call. The `CASE prokind` guard does.** `EXPLAIN VERBOSE` shows the subquery pulled up and the body qual pushed into the `Seq Scan on pg_proc` filter, so it is evaluated BEFORE the hash join that drops `pg_catalog` and `information_schema`. `pg_get_functiondef` therefore runs on every `pg_proc` row, catalogue included, and the aggregate `CASE` is the one thing standing between the arm and `"x" is an aggregate function`. Do not remove or narrow that `CASE` on the assumption that the namespace filter shields it.
  - ⚠️ **Unmeasured on the Supabase image (17.6.1.113).** A local stack on `:54422` showed up briefly, but it belonged to another session and was gone before my query ran (connection refused on both tries). The claim for the local-stack, TEST and PROD catalogue rests on the source argument above, not on a run there. CI's `sql-tests` (local-stack lane) is the first real measurement on that shape. The fixer's own verification was on the pg-lane only.
- **Lint R2 still holds:** `node scripts/lint-sql-gates.mjs` reports 128 files, 0 findings, and the self-test is OK (7 rules). The comment-strip idiom wraps the `pg_get_functiondef` result before either regex sees it.
- **Census:** `--parse-only` prints `arms: 0/1134/0` and `coverage: files 101/128` with no static defects. `ARMS_FLOOR = 1134`. `mutation-runner-floors`, `mutation-annotation-parser` and `gate-family-meta` gave **3 files, 262 tests passed** (`--testTimeout=240000`). I did NOT re-run the fourth census suite, `npx tsc --noEmit` or `npm run lint`; for those the fixer's reading (295 tests across four suites) stands unverified by me.
- Source is untouched: `git status --porcelain` was empty after the mutation run.

### Info (record only, per the LOW/Info rule; not for TODOS.md)

#### IN-R2-01: arm 2a still needs service_role to hold INSERT, so the arm-6 comment's rationale is incomplete

**File:** `supabase/tests/test_api_keys_insert_not_client_writable.sql:380-384` (2a's message check), `:104` (header invariant 6) and the new arm-6 comment (`:648-655`).

Arm 2a requires the refusal text to start with `api_keys: INSERT refused for role service_role`. After `REVOKE INSERT ON public.api_keys FROM service_role`, the executor's privilege check refuses the probe with `permission denied for table api_keys` before any BEFORE ROW trigger runs. 2a then fails with "another layer refused it and the fence is not what is being tested". That diagnosis is truthful, so WR-01 stays closed: no false outage, no wrong remedy. But the new arm-6 comment says the grant "enables no path" and that pinning it "would fail CI on the correct hardening". The hardening still fails CI, at 2a, and the grant is load-bearing for 2a's probe. Whoever lands that REVOKE must re-shape 2a too, for example by running the direct-insert probe under a throwaway role granted INSERT, the way 2c does.

#### IN-R2-02: same-name writers collapse in all three census arms

**File:** same gate, the 2w/2w-q/2w-m `SELECT`.

All three aggregate `DISTINCT proname`, or `proname:prosecdef:owner`. A second postgres-owned SECURITY DEFINER inserter that reuses an audited name (an overload, or the same name in another schema) leaves all three strings unchanged. Overloads in `public` are already pinned to exactly one each by `test_insert_api_key_rpc.sql` arm R4 and `test_api_keys_venue_identity_uniq.sql` (create_wizard_strategy at about `:282`, add_wizard_composite_key at about `:336`). Only a same-name function in a non-public schema escapes. Aggregating `p.oid::regprocedure::text` would close it.

#### IN-R2-03: the widened regex is case-insensitive over quoted identifiers

`~*` with `"?api_keys"?` also matches `"API_KEYS"`, which is a different table. I confirmed this on the PG16 fixture (`w_q4`). It fails safe (a false red, never a false green) and no such table exists.

#### IN-R2-04: header line 40 still lists the replacement arms as "2s, 2a, 2b, 2c and 2w"

`:40` reads "replaced by arms 2s, 2a, 2b, 2c and 2w below". Line 49 lists the full set including 2w-q and 2w-m, so a reader is not misled about the arm count. The sentence is lineage for what replaced the Phase 160 arm 2. Cosmetic.

---

_Round 2 reviewed: 2026-11-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Round 2, other lanes and the orchestrator's lane run (2026-11-28)
- rls-policy-auditor re-audit: CLEAN (RLS-M1 closed, 0 findings).
- Orchestrator local-stack run (Supabase image 17.6.1.113, both 20261127220000 and 20261127220100 replayed): test_api_keys_insert_not_client_writable exit 0 with `Assertion 2w OK`, `2w-q OK`, `2w-m OK`; test_api_keys_exchange_not_user_writable, test_insert_api_key_rpc, test_api_keys_user_id_immutable and test_strategy_analytics_anon_grants all exit 0. Live files under the fence: insert-api-key-rpc-live, anon-strategies-live-probe, sec-005-live-probe, gdpr-export: 84 passed, 2 skipped (house HAS_INTROSPECTION skips). This closes the round-2 reviewer's "not measured on the Supabase image" gap.
