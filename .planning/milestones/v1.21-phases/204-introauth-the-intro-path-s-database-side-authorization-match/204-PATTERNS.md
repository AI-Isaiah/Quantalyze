# Phase 204: INTROAUTH - Pattern Map

**Mapped:** 2026-11-10
**Files analyzed:** 14 (4 new, 10 census edits)
**Analogs found:** 14 / 14

Scope: hardening the intro path's database-side authorization so it matches `/api/intro`
(one `ALTER POLICY ... WITH CHECK` on `contact_requests_insert`, one `REVOKE` on the 6-arg
`send_intro_with_decision`, a catalogue-only `DO` block, a gate, a stand-in fixture, a rollback,
and the census edits a new gate file moves).

D-08 reminder for the planner: copy the STRUCTURE of the analogs below, never their risk prose.
`20260409133655_function_execute_hardening.sql` carries a long "blast radius" header; this phase's
migration header should say only that it aligns the database-side authorization with `/api/intro`.
No arm name, comment or commit text describes how to misuse a current object or says a live object
is open.

All analog paths below were checked as git-tracked (`git ls-files`); none is a gitignored mirror.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/20261110150000_intro_path_authz_hardening.sql` (new; check timestamp against PROD tip at plan time) | migration | DDL (policy + ACL) | `supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql` (verify block, REVOKE) + `20260409133655_function_execute_hardening.sql` (REVOKE on this exact function, 5-arg form) | role-match (no `ALTER POLICY` migration exists) |
| `supabase/migrations/down/20261110150000-rollback.sql` (new) | migration (rollback) | DDL | `supabase/migrations/down/20261106120000-rollback.sql` | exact |
| `supabase/tests/test_contact_requests_insert_intro_authz.sql` (new) | test (SQL gate) | request-response (impersonated INSERT, ACL probe) | policy half: `supabase/tests/test_csv_daily_returns_perkey_rls.sql`; ACL half: `test_truncate_revoke_anon_authenticated.sql`; sentinel/untwinned control: `test_compute_job_metadata_merge.sql` | exact (two analogs, one per half) |
| `scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql` (new) | fixture (stand-in) | DDL scaffold | `scripts/pg-lane/fixtures/34-fixture-pg-net-stand-in.sql` (stand-in function + header contract), `20-fixture-app-role-helper.sql` (order-robust additive), `28-fixture-profiles-privileged-columns.sql` (additive `ADD COLUMN IF NOT EXISTS`) | role-match |
| `scripts/mutation-floors.mjs` (edit `FILES_FLOOR`, `ARMS_FLOOR`) | config (ratchet) | constant | its own `RAISED ...` comment blocks above each constant | exact |
| `src/__tests__/gate-family-meta.test.ts` (edit 2 keys) | test (census) | constant | commit `a363392ea` diff | exact |
| `src/__tests__/mutation-annotation-parser.test.ts` (edit 6 pins + by-name list) | test (census) | constant | commit `a363392ea` diff | exact |
| `src/__tests__/mutation-runner-floors.test.ts` (edit about 35 sites) | test (census) | constant | commit `a363392ea` diff (about 40 changed lines) | exact |
| `src/__tests__/lint-sql-gates.test.ts` (edit 1 pin) | test (census) | constant | commit `a363392ea` diff | exact |
| `.github/workflows/ci.yml` roster table, `SENTINEL_FLOOR`, `ARMS_FLOOR` (only if the gate prints the sentinel) | config (CI) | constant | commit `a363392ea` diff (22 lines) | exact |
| `src/__tests__/drift-check-scripts.test.ts` (3 pins, only with the sentinel) | test (census) | constant | commit `a363392ea` diff | exact |

No edit needed (measured, see Census): `scripts/local-stack/sql-corpus-report.mjs`,
`src/__tests__/local-stack-lane-wiring.test.ts`, `src/__tests__/vac06-mechanism-arms.test.ts`,
`scripts/lint-sql-gates.mjs`, `scripts/lint-sql-gates-fixtures/*`, `supabase/schema/baseline.sql`,
`supabase/schema/functions/send_intro_with_decision.sql`, `src/lib/database.types.ts`.

---

## Pattern Assignments

### `supabase/migrations/20261110150000_intro_path_authz_hardening.sql` (migration, DDL)

**Analog A (verify-block shape, REVOKE then catalogue check):** `supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql`
**Analog B (REVOKE on this very function, previous signature):** `supabase/migrations/20260409133655_function_execute_hardening.sql`

Conventions (measured): header is a `-- ====` block titled `-- Migration <ts>: <what>.` plus phase tag, then
`WHY`/`WHAT IT DOES` sections; no `BEGIN;`/`COMMIT;` (recent migrations carry none); `STEP n` banner comments;
a closing `-- END OF MIGRATION <ts>` banner.

**REVOKE shape** (`20261106120000_...sql:149-152`; the function is service-role-only, so no GRANT follows):
```sql
REVOKE ALL ON FUNCTION public.mark_compute_job_kept_figures(uuid) FROM PUBLIC, anon, authenticated;
...
REVOKE ALL ON FUNCTION public.retract_ledger_refresh_marker(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retract_ledger_refresh_marker(uuid, text) TO service_role;
```
For this phase: `REVOKE ALL ON FUNCTION public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;`
Use the full 6-arg signature (the 5-arg overload is gone; a wrong signature must fail loudly). Add no `GRANT ... TO service_role`:
service_role keeps its existing grant (baseline.sql:18051-18054); the DO block asserts it still holds EXECUTE.

**Catalogue-only self-verify** (`20261106120000_...sql:158-203`, copy this shape, swap names):
```sql
DO $$
DECLARE
  v_fn_oid OID;
BEGIN
  SELECT p.oid INTO v_fn_oid FROM pg_proc p
   WHERE p.proname = v_name AND p.pronamespace = 'public'::regnamespace;
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261106120000: % function missing', v_name;
  END IF;
  IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '... service_role lacks EXECUTE on % ...', v_name;
  END IF;
  IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '... anon can EXECUTE % ...', v_name;
  END IF;
  IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '... authenticated can EXECUTE % ...', v_name;
  END IF;
  -- PUBLIC (grantee 0) must hold no EXECUTE: the grant list is explicit.
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION '... PUBLIC still holds EXECUTE on % ...', v_name;
  END IF;
  RAISE NOTICE '... (catalogue verified: ...)';
END $$;
```
Key the lookup on `to_regprocedure('public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid)')` instead of `proname`
(Analog B's `proname IN (...)` join at `20260409133655:87-93` would also match a stray overload).

**Policy half (no migration analog; gate analogs use ALTER POLICY only as twins):** use the SQL measured in RESEARCH
("Recommended SQL"). Add a second assertion in the same DO block reading only `pg_policies`
(`cmd = 'INSERT'`, `with_check` containing `investor_attestations`, `profiles`, `allocator_id`; substring checks, never the
whole normalised text). D-06: never SELECT from `contact_requests`, `profiles` or `investor_attestations`.

**Anti-pattern from Analog B to NOT copy:** its header (lines 1-61) enumerates attack capability per function. Replace with
two sentences of intent.

---

### `supabase/migrations/down/20261110150000-rollback.sql` (rollback, DDL)

**Analog:** `supabase/migrations/down/20261106120000-rollback.sql` (53 lines, whole file is the template).

Copy: the `-- ====` header with `WHAT IT UNDOES`, `WHAT ROLLING BACK COSTS`, and the verbatim paragraph "THE MIGRATION LEDGER ROW IS LEFT IN PLACE"
(version number swapped); then
```sql
BEGIN;

SET lock_timeout = '3s';
...statements...
-- Catalogue-only check ...
DO $$ ... RAISE NOTICE 'Rollback 20261106120000: ...'; END $$;

COMMIT;
```
Statements for this phase: `ALTER POLICY "contact_requests_insert" ON public.contact_requests WITH CHECK (allocator_id = auth.uid());`
(the original text, `20260405061912_rls_policies.sql:47-48`) and re-granting the prior function ACL (the three grants recorded at
`20260419140916_match_decisions_original_strategy.sql:133-134` and `baseline.sql:18051-18054`). State in the header that rolling back
restores the earlier authorization and name that as the cost; keep D-08 wording (no "open" language). Note the rollback file keeps
`BEGIN;`/`COMMIT;` even though forward migrations do not.

---

### `supabase/tests/test_contact_requests_insert_intro_authz.sql` (SQL gate, request-response)

**Analog 1 (policy arms):** `supabase/tests/test_csv_daily_returns_perkey_rls.sql`
**Analog 2 (ACL arms, 42501 refusal read AFTER `RESET ROLE`):** `supabase/tests/test_truncate_revoke_anon_authenticated.sql`
**Analog 3 (untwinned control spelling, closing sentinel, BEGIN...ROLLBACK):** `supabase/tests/test_compute_job_metadata_merge.sql`

**Header and setup line** (analog 1, lines 35-54; exactly one `RED-UNDER-SETUP` per file, one line, ordered apply list):
```sql
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/28-fixture-profiles-privileged-columns.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql","supabase/migrations/20260405061912_rls_policies.sql","supabase/migrations/20261110150000_intro_path_authz_hardening.sql"]}
```
(That is the chain RESEARCH measured at exit 0. The `test_strategies_private_owner_isolation.sql:67` setup is the proven base for
01,02,03,10 + `20260405061912`; fixtures 07, 12, 28 supply default privileges and the `profiles` columns. Fixture 43 must sort after 02, 07, 12, 28 and 10.
Fixture 23 is NOT needed: fixture 10 already stands in `contact_requests(allocator_id, strategy_id)`; do not list both.)

**Impersonation idiom** (analog 1, lines 127-129 and 175-189):
```sql
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
...
RESET ROLE;
PERFORM set_config('request.jwt.claims', NULL, true);
```

**Seeding idiom, auth user then profile via ON CONFLICT** (analog 1, lines 83-88; a plain `INSERT INTO profiles` raised 23505 on the lane):
```sql
INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-...@quantalyze.test', now(), now());
INSERT INTO profiles (id, display_name, email, role)
VALUES (uid_a, '...', '...', 'allocator')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
```
Then set `allocator_status` / `manager_status` / `is_admin` as `postgres` (before `SET LOCAL ROLE`); the privileged-column trigger permits
`postgres`. Seed `investor_attestations` with `(user_id, version)` (real `version` has no default). Seed strategies with the analog-1 idiom
(`INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges) VALUES (..., 'published', '{}', '{}', '{}', ARRAY['binance'])`),
one distinct strategy per insert (real table has `UNIQUE (allocator_id, strategy_id)`). Seed only `allocator_id` and `strategy_id` into `contact_requests`.

**Arm + twin annotation shape** (analog 1, lines 142 and 174; every twin a `sql` step so the migration's own DO block never trips):
```sql
  -- RED-UNDER: <prose: what the twin does and why it is a sql step>
  -- RED-UNDER-M: {"arm":"Assertion 2","apply":[{"kind":"sql","stmt":"CREATE POLICY ... "}]}
  ...
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 2): ...';
  END IF;
```
Neuter shape when two arms share a property (analog 1, line 174):
`"neuter":[{"arm":"Assertion 1"}]`. `<ID>` must equal the text inside `TEST FAILED (<ID>)` and be unique. Count of `-- RED-UNDER:` prose lines must equal count of
`-- RED-UNDER-M:` twins. Use RESEARCH's arm table (ACL-PUBLIC first of the ACL arms, then ACL-ANON, ACL-AUTH, ACL-SVC, ACL-CALL, then POL-* arms) as the starting layout; neutral labels only (D-08).

**Refusal-read idiom, R1-safe** (analog 2, lines 253-280: handler records state and SQLSTATE only, the assertion is read AFTER `RESET ROLE`):
```sql
  SET LOCAL ROLE authenticated;
  v_state := NULL; v_sqlstate := NULL; v_msg := NULL;
  BEGIN
    <statement under test>;
  EXCEPTION WHEN OTHERS THEN
    v_state := 'denied'; v_sqlstate := SQLSTATE; v_msg := SQLERRM;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM 'denied' OR v_sqlstate IS DISTINCT FROM '42501' OR v_msg NOT LIKE '%permission denied for ...%' THEN
    RAISE EXCEPTION 'TEST FAILED (ARM): ...';
  END IF;
```
For policy arms require `v_msg LIKE '%row-level security%'` (measured text: `new row violates row-level security policy for table "contact_requests"`);
for the RPC arm `permission denied for function`. Put the post-refusal row-count SELECT AFTER the `END;` (lint R1 forbids reads/writes inside the handler).
Assert `has_table_privilege('authenticated','public.contact_requests','INSERT')` first, spelled as an untwinned control (next bullet), so a missing GRANT cannot pass for an RLS refusal.

**Untwinned precondition spelling** (analog 3, `test_compute_job_metadata_merge.sql:514`):
`RAISE EXCEPTION 'ARM 11 FAILED (control): ...'`. For this gate use e.g. `SETUP CHECK FAILED (control): ...`; never `TEST FAILED (` without a twin.

**Closing sentinel and transaction** (analog 3, lines 89, 583, 586; also the shape the CI anti-skip step reads):
```sql
BEGIN;
...
  RAISE NOTICE 'ALL 13 ARMS EXECUTED (1,2,...,13): <one clause per arm>';
...
ROLLBACK;
```
The anti-skip step reads the FIRST `ALL <n> ARMS EXECUTED` in the file (`grep -aoE ... | head -1`), so no earlier prose mention (header comment, annotation) may contain that phrase. `n` counts every arm that runs, twinned or not.

**Absence is an exception, never a skip** (analog 3, lines 154-157): `IF to_regprocedure('public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid)') IS NULL THEN RAISE EXCEPTION 'TEST FAILED (<arm>): ... must not skip'`.

**ACL helper already in fixture 01:** `public._assert_no_public_execute(text)` (`scripts/pg-lane/fixtures/01-fixture-core.sql:62-75`) checks grantee 0 via `aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))`. The real local-stack lane does not carry it, so inline the `aclexplode` query in the gate (as the migration does) rather than calling the helper.

---

### `scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql` (fixture, DDL scaffold)

**Analog:** `scripts/pg-lane/fixtures/34-fixture-pg-net-stand-in.sql` for the stand-in function plus the header contract; `28-fixture-profiles-privileged-columns.sql` for additive `ADD COLUMN IF NOT EXISTS`; `20-fixture-app-role-helper.sql` for the order-robust statement.

**Header contract to copy** (34, lines 1-52): state it is a STAND-IN not the schema; what it proves and does NOT prove; "NEVER APPLIED TO TEST OR PROD"; "Never a second base: 01-fixture-core.sql remains the only destructive fixture". State that the migration under test (the REVOKE and the policy) is real, and the function body here is trivial.

**Additive column idiom** (28, lines 24-29):
```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ...;
```
Use for `investor_attestations`: `ADD COLUMN IF NOT EXISTS attested_at TIMESTAMPTZ NOT NULL DEFAULT now()` and `ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT 'stand-in'` (fixture 02 creates `investor_attestations (user_id UUID)` only: `02-fixture-sanitize-tables.sql`, the `CREATE TABLE IF NOT EXISTS investor_attestations` line).

**Stand-in function ACL mirroring the baseline.** Create it AFTER fixture 07 so default privileges grant the three client roles EXECUTE, then `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` so the ACL has the same three client roles as `baseline.sql:18051-18054` and the migration's REVOKE does real work. Fixture 07 body, for reference (`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`).

Other required statements (RESEARCH "New fixture 43", measured): `ENABLE ROW LEVEL SECURITY` plus a stand-in `attestations_self_read` policy `USING (auth.uid() = user_id)` on `investor_attestations`; `GRANT SELECT ON investor_attestations TO authenticated` (lane stand-in has no client grant; the real table has one, `baseline.sql:18687`).

**Lint:** R5/R6/R7 walk the apply list for fixture-vs-migration table and policy name clashes. Fixture 43 creates no table and a policy name no later entry creates; confirm with `node scripts/lint-sql-gates.mjs`.

**Rule 4:** no twin may target `scripts/pg-lane/fixtures/**`, and no existing fixture may be edited.

---

### Census edit files (config / test, constant)

**Analog for every row:** commit `a363392ea` (`git show --stat a363392ea`; the last commit that added a gate file). Its non-planning stat touched exactly: `.github/workflows/ci.yml`, `scripts/mutation-floors.mjs`, `src/__tests__/drift-check-scripts.test.ts`, `gate-family-meta.test.ts`, `lint-sql-gates.test.ts`, `mutation-annotation-parser.test.ts`, `mutation-runner-floors.test.ts`. The CURRENCY-comment convention (a dated `-- CURRENCY ...` line above each moved pin, naming the phase and the measured run) applies to every edit below.

See "Census" in Shared Patterns for exact lines.

---

## Shared Patterns

### Catalogue-only assertions (D-06)
**Source:** `supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql:155-203` (verify block titled "CATALOGUE ONLY (no table is read)").
**Apply to:** the forward migration and the rollback. Use `pg_policies`, `pg_proc`, `has_function_privilege`, `aclexplode`; never table rows (TEST is schema-only).

### Twins are `sql` steps, never migration edits
**Source:** `test_csv_daily_returns_perkey_rls.sql:142,156,174,201`; `test_truncate_revoke_anon_authenticated.sql:276`; `test_compute_job_metadata_merge.sql:147` (arm 1 prose: an edit to the migration "would trip the migration's own verify block during the apply and the gate would never run").
**Apply to:** every arm of the new gate. Policy twins use `ALTER POLICY ... WITH CHECK (...)`; ACL twins use `GRANT EXECUTE ... TO <role>` / `REVOKE EXECUTE ... FROM service_role`.

### Impersonation and refusal discrimination
**Source:** `test_csv_daily_returns_perkey_rls.sql:127-129,175-189`; `test_truncate_revoke_anon_authenticated.sql:253-280`.
**Apply to:** all refusal arms. `RESET ROLE` before every `RAISE`; read SQLSTATE and message; 42501 alone cannot tell RLS from the grant layer.

### Census (what a new gate file plus N twinned arms moves)

Baseline at HEAD (measured, `--parse-only`): `coverage: files 80/107`, `arms: 0/815/0`. New gate with N non-waived twins: files 81/108, arms 815+N. `WAIVED_CEILING` stays 0 (no edit). Read floors by symbol, not from prose.

Let `N` = twinned arms (the `-- RED-UNDER-M` count), `n` = the sentinel's arm count (all arms that run, including untwinned controls).

| # | Site (file:line at HEAD) | Current | New | Notes |
|---|---|---|---|---|
| 1 | `scripts/mutation-floors.mjs:1342` `FILES_FLOOR` | 80 | 81 | add a dated `// RAISED 80 -> 81 ...` block above (convention at :1336-1341) |
| 2 | `scripts/mutation-floors.mjs:3411` `ARMS_FLOOR` | 815 | 815+N | same; comment block at :3405-3410 |
| 3 | `src/__tests__/gate-family-meta.test.ts:944` | `"scripts/mutation-floors.mjs :: FILES_FLOOR=80"` | `...=81` | key must equal the live constant; keep trailing lineage comment |
| 4 | `src/__tests__/gate-family-meta.test.ts:945` | `"... :: ARMS_FLOOR=815"` | `...=815+N` | same |
| 5 | `src/__tests__/mutation-annotation-parser.test.ts:1114` | `expect(armsSeen).toBe(815)` | `815+N` | CURRENCY lines at :1109-1113 |
| 6 | same file `:2732` | `expect(corpus.filesTotal).toBe(107)` | 108 | first `filesTotal` pin |
| 7 | same file `:2822` | `expect(corpus.filesAnnotated).toBe(80)` | 81 | |
| 8 | same file `:2823-~2900` (the `corpus.annotatedFiles` `toEqual([...])` by-name list; `test_compute_job_metadata_merge.sql` is at `:2876`, `test_compute_jobs_error_kind_copy_parity.sql` at `:2877`) | 80 names | insert `"test_contact_requests_insert_intro_authz.sql"` in sorted position (after `test_compute_job_metadata_merge.sql` at :2876 and before `test_compute_jobs_error_kind_copy_parity.sql`: check collation, `com` < `con` < `cr`; place by the file's own order) | convention: a `// ADDED <date> (Phase 204 ...)` comment line above the new name |
| 9 | same file `:3393` | `expect(corpus.filesTotal).toBe(107)` | 108 | SECOND `filesTotal` pin; easy to miss |
| 10 | same file `:3438` | `expect(corpus.annotatedFiles).toHaveLength(80)` | 81 | |
| 11 | `src/__tests__/lint-sql-gates.test.ts:1176` | `toMatch(/scanned 107 file/)` | `/scanned 108 file/` | CURRENCY comment convention at :1170-1175 |
| 12 | `src/__tests__/mutation-runner-floors.test.ts:757` | `expect(totalAnchored).toBe(815)` | `815+N` | counts prose anchors; deliberately not `ARMS_FLOOR` |
| 13 | same file GREEN_LOG block `:1825` | `"scope: FULL 80/80 annotated files"` | `81/81` | |
| 14 | `:1844` | `... at most 4 for this run's 80 target file(s) ...` | `81` | inside the `lane-concurrency:` string |
| 15 | `:1886` | `"coverage: files 80/107"` | `81/108` | |
| 16 | `:2193` | `"arms: 815/815/0   (executed/annotated/waived)"` | `815+N` (all three) | |
| 17 | `:2198` | `"biting: 815   (...)"` | `815+N` | |
| 18 | `:2203` | `"lane-invocations: 815 ... independent of the 815 the verdict loop counted; plus 80 baseline / 80 restore leg(s)"` | `815+N` (both) and `81 / 81` | |
| 19 | per-file rows near `:2288` (`"  file test_compute_job_metadata_merge.sql: sections 12 / judged 12 / ..."`) | n/a | add one row `"  file test_contact_requests_insert_intro_authz.sql: sections <S> / judged <S> / annotated <N> / waived 0 / biting <N>"` in sorted position, copied from ONE full lane run | rows must SUM to the aggregate (see :2658-:2763 offsets) |
| 20 | `:2399` | `"per-arm lane time: mean 1.9s over 815 arm run(s)"` | `... mean <x>s over 815+N ...` | take `<x>` from the full run's own line |
| 21 | `:2443` | `toContain("815 arm lane(s) spawned")` | `815+N` | |
| 22 | `:2675` | `"printed 81 per-file row(s) but reported 80 annotated file(s)"` | `82` / `81` | offset +1 kept |
| 23 | `:2758` | `"rows sum to 814 biting arm(s) but the aggregate"` | `814+N` | offset -1 kept |
| 24 | `:2763` | `toContain("reports 815")` | `815+N` | |
| 25 | `:2814`, `:2830` | `/^lane-invocations: 815 /m`; `"executed=815 lane-invocations=0 biting=815"` | `815+N` | |
| 26 | `:2880`, `:2889` | `"lane-invocations: 816 "` replacement; `"executed=815 lane-invocations=816 biting=815"` | `816+N`; `815+N` / `816+N` / `815+N` | |
| 27 | `:2917` | `/^lane-invocations: 815 /m` | `815+N` | |
| 28 | `:2973`, `:3053` | `/^arms: 815\/815\/0 /m` and the template string; `"arms: 0/815/0 "` | `815+N` throughout | |
| 29 | `:3065`, `:3074` | `/^biting: 815 /m` -> `"biting: 816 "`; `"biting (816) exceeds executed (815)"` | `biting: 815+N` -> `816+N`; `(816+N) ... (815+N)` | |
| 30 | `:3116` | `"scope: SUBSET 2/80 annotated files: ..."` | `2/81` | SUBSET_LOG |
| 31 | `:3145` | `"coverage: files 80/107"` | `81/108` | SUBSET_LOG |
| 32 | `:3210` | `toContain("scope: FULL 80/80 annotated files")` | `81/81` | |
| 33 | `:3251` | `toContain("biting arms 815 >= 815")` | `815+N >= 815+N` | |
| 34 | `:3315` | `SUBSET_LOG.replace("scope: SUBSET 2/80 ", "scope: SUBSET 3/80 ")` | `2/81`, `3/81` | |
| 35 | `:3405`, `:3436` | `"scope: FULL 80/80 annotated files (subset fallback: ...)"`; `"printed 2 per-file row(s) but reported 80 annotated file(s)"` | `81/81`; `81` | |
| 36 | `:3545`, `:3553` | `"scope: FULL 80/80 annotated files"` (replace targets, 2 sites per line) | `81/81` | |
| 37 | `.github/workflows/ci.yml` roster rows `:4939-4940` | `#   test_compute_job_metadata_merge.sql            13` / `#   test_create_wizard_strategy_for_key.sql         9` | insert `#   test_contact_requests_insert_intro_authz.sql    <n>` between them, same indent, contiguous block (no prose between rows) | ONLY if the gate prints `ALL <n> ARMS EXECUTED`; table is cross-checked by `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts:553-560` |
| 38 | `ci.yml:5279` `SENTINEL_FLOOR=27  # files declaring a sentinel` | 27 | 28 | |
| 39 | `ci.yml:5280` `ARMS_FLOOR=430     # 8 + 13 + 8 + 11 + 14 + 8 + 8 + 13 + 9 + ...` | 430 | 430+n; insert the `+ <n>` term after the second `13` (the metadata-merge term) to match table order | add a dated `# Re-measured ...` paragraph above (convention at :5214-5272) |
| 40 | `src/__tests__/drift-check-scripts.test.ts:4821` (test title) | `...SENTINEL_FLOOR=27 and ARMS_FLOOR=430...` | `28` / `430+n` | |
| 41 | same file `:5096`, `:5107` | `["-ac", "SENTINEL_FLOOR=27", ...]`; `["-ac", "ARMS_FLOOR=430", ...]` | `28`; `430+n` | add `// RAISED <date> (Phase 204 ...)` line in the comment block above (:5055-5090) |

Rows 13-36 are many literal repeats of the same four numbers (arms, files-total, files-annotated, biting). The commit `a363392ea` diff of `mutation-runner-floors.test.ts` is the authoritative checklist (about 40 changed non-comment lines); RESEARCH's census named only `:757` there, so the planner must treat the whole GREEN_LOG region (`:1819-:2450`) and the RED cases (`:2660-:3560`) as one edit scope. After editing, `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/lint-sql-gates.test.ts src/__tests__/drift-check-scripts.test.ts src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` is the check; each stale pin names itself.

**Confirmed NOT moved (RESEARCH had them "not opened"; grepped this session with `grep -a`):**
- `scripts/local-stack/sql-corpus-report.mjs`: no corpus-size pin (it counts files at run time and prints `sql-corpus: files=...`).
- `src/__tests__/local-stack-lane-wiring.test.ts`: the only `80` hits (`:1349-1426`) are the Python `--cov-fail-under=80`, unrelated; no corpus count.
- `src/__tests__/vac06-mechanism-arms.test.ts`: pins arms of `test_strategy_shares_rls.sql` by name only; no corpus count.
- `ci.yml`: only the roster table and the `SENTINEL_FLOOR`/`ARMS_FLOOR` pair (rows 37-39) tie to the gate set; no other 107/80/815 literal in `ci.yml`.
- `scripts/lint-sql-gates.mjs`, `scripts/lint-sql-gates-fixtures/*`, `scripts/lint-app-guc.mjs`: no edit (scanned by the corpus scan).
- `supabase/tests/*.sql` count is 107 files (matches `filesTotal`); no non-`.sql` files in that directory.
- Fixture census: nothing pins the fixture count or number range (`grep fixtures/4` hits only the gate files and fixture headers themselves). `scripts/pg-lane/README.md` fixture table is already stale; do not chase.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| (migration `ALTER POLICY` statement) | migration | DDL | No migration uses `ALTER POLICY`; only gate files (`test_strategy_shares_rls.sql:842`, `test_csv_daily_returns_perkey_rls.sql:174`) use it as a twin. The statement shape is taken from RESEARCH's "Recommended SQL", measured on the pg-lane. |

## Metadata

**Analog search scope:** `supabase/migrations/` (incl. `down/`), `supabase/tests/`, `scripts/pg-lane/fixtures/`, `scripts/mutation-floors.mjs`, `scripts/local-stack/`, `src/__tests__/` (census files), `.github/workflows/ci.yml`, commit `a363392ea`.
**Files scanned:** about 30 read or grepped.
**Pattern extraction date:** 2026-11-10
