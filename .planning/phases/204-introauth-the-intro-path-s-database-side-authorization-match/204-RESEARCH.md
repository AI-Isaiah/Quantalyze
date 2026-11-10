# Phase 204: INTROAUTH - Research

**Researched:** 2026-11-10
**Domain:** Postgres RLS (`ALTER POLICY ... WITH CHECK`), function EXECUTE ACLs, the repo's SQL gate / mutation-runner machinery
**Confidence:** HIGH (every in-repo value below was read this session; the pg-lane feasibility was measured on this machine)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### D-01 — Tighten the INSERT policy's `WITH CHECK`; keep direct inserts by the signed-in user (orchestrator default, founder may revisit)
- `ALTER POLICY "contact_requests_insert" ON public.contact_requests WITH CHECK (...)` — keeps the
  policy name, no DROP/CREATE window.
- Rejected alternative: revoke INSERT from `authenticated` and insert via the service role.
  `/api/intro` (`src/app/api/intro/route.ts:188`) inserts with the USER-scoped client, so that
  option forces a route rewrite. The policy change closes every entry point with no app change.

### D-02 — The policy mirrors the route's predicate exactly, no stricter and no looser (orchestrator default, founder may revisit)
The new `WITH CHECK` is the conjunction of:
- `allocator_id = auth.uid()` (unchanged);
- the caller's `profiles` row satisfies `isProfileApproved` (`src/lib/approval.ts`):
  `is_admin` → approved; else role `allocator` needs `allocator_status = 'verified'`, role `both`
  needs `allocator_status = 'verified' AND manager_status = 'verified'`, role `manager` → refused
  by the next bullet, anything else → refused;
- role is `allocator` or `both` (`route.ts:106`) — note this applies to admins too, matching the
  route, which runs the role check after the approval gate;
- an `investor_attestations` row for the caller with `attested_at IS NOT NULL`
  (`route.ts:119-136`).
A policy stricter than the route would turn a legitimate request into the route's 500
(the route maps only 23505 to 409); looser would leave the gap.

### D-03 — Inline `EXISTS` subqueries, no new SECURITY DEFINER helper (orchestrator default, founder may revisit)
- Measured: no SELECT policy on `profiles` (`profiles_read_public`) or `investor_attestations`
  (`attestations_self_read`, `attestations_admin_read`) references `contact_requests`, so there is
  no policy-recursion risk, and the caller can read both of its own rows under RLS.
- No new function means no new ACL to harden, no `database.types.ts` change and no function census
  movement. If execution measures a recursion or visibility problem, a zero-argument helper reading
  `auth.uid()` internally (never a `p_user_id` argument) with anon EXECUTE is the fallback.

### D-04 — Revoke client EXECUTE on the 6-arg `send_intro_with_decision`; no in-body check (orchestrator default, founder may revisit)
- `REVOKE ALL ON FUNCTION public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;`
  `service_role` keeps EXECUTE.
- Measured: the only app caller is `src/app/api/admin/match/send-intro/route.ts:460`, via
  `createAdminClient()` (service role), behind `isAdminUser`. No `scripts/`, `e2e/` or
  `analytics-service/` caller. An in-body `auth.uid()`/admin check would see NULL under the service
  role and break the admin path. The function is not used inside any policy, so the
  "SECDEF helpers in {public} policies need anon EXECUTE" rule does not apply.
- No `CREATE OR REPLACE` — the body is unchanged, so there is nothing to re-base.
- Precedent for the REVOKE shape: `20260409133655_function_execute_hardening.sql`.

### D-05 — Admin-sent intros stay admin-authorized (orchestrator default, founder may revisit)
The SECURITY DEFINER RPC is owned by `postgres` and bypasses RLS, so the admin match path keeps
creating intros for an allocator chosen by the admin, without the D-02 predicate. Requiring the
target allocator to be approved and attested on the admin path would be a product change beyond
this phase's goal.

### D-06 — Migration assertions read the catalogue only
Any `DO` block in the migration asserts on `pg_policies` / `pg_proc.proacl` /
`has_function_privilege`, never on table rows (TEST is schema-only; a data-reading RAISE would
block the PROD apply).

### D-07 — SQL gate in `supabase/tests` with biting `RED-UNDER` annotations
A gate proves: (a) the policy refuses an insert from an unapproved, a non-allocator and an
unattested caller, and admits an approved, attested allocator; (b) `anon` and `authenticated` hold
no EXECUTE on the 6-arg function and `service_role` does. Every new arm carries a `RED-UNDER`
annotation that the mutation runner shows biting. A new gate file moves several censuses
(mutation floors, ratchet tests, lint fixtures): grep them all and move every one.

### D-08 — Public-repo wording rule (binding on every artifact of this phase)
`.planning` is tracked and public. Until the change is live on PROD, no tracked text — commits,
plans, SUMMARYs, migration comments, test and arm names — describes how to misuse the current
policy or function, or states that the live objects are currently open. Describe the change as
hardening the intro path's database-side authorization so it matches `/api/intro`. [One sentence about a
reference-only phase directory is omitted from this copy per the orchestrator's brief; read it in
CONTEXT.md D-08. Its rule: `git add` explicit paths only, and check `git show --stat` after each commit.]

### Claude's Discretion
- Migration filename timestamp (after `20261110120000`), comment wording within D-08, gate file
  name and arm layout, and whether the route's existing comment ("RLS on contact_requests is the
  DB-layer gate") needs any touch (prefer not).

### Deferred Ideas (OUT OF SCOPE)
- `contact_requests_update` and `_read` policies, and the table-level anon grants — not part of
  this phase's goal; not changed.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped to this phase (TBD). The planner should map plans to D-01..D-08 instead.

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01/D-02/D-03 | Policy predicate | Section "Exact current definitions", "Route predicate truth table", measured lane trial |
| D-04/D-05 | Function ACL | Section "Function and ACL", REVOKE precedent |
| D-06 | Catalogue-only assertions | Migration conventions |
| D-07 | Gate + twins | Gate machinery, Census table, Validation Architecture |
| D-08 | Wording | Pitfall 9 |
</phase_requirements>

## Summary

The change is two statements: one `ALTER POLICY ... WITH CHECK` and one `REVOKE`, plus catalogue-only `DO` assertions, one new gate file with biting twins, one new pg-lane stand-in fixture, and a census of about a dozen pinned numbers across eight files (see the Census table; the anti-skip sentinel pair in `ci.yml` is a second floor pair that is easy to miss). No application code, no `baseline.sql`, no `database.types.ts` change is needed.

The biggest planning risk is not the SQL, it is the gate. The `sql-mutation` lane is a plain PostgreSQL 16 cluster with stand-in fixtures, so the gate's setup list must reproduce enough of `profiles`, `investor_attestations`, `contact_requests` and the 6-arg function for the real migration to act on. This research measured a working setup chain locally (no Docker) and found three traps that would each have cost an executor a failed lane run (Pitfalls 1 to 3).

**Primary recommendation:** One migration `supabase/migrations/20261110150000_intro_path_authz_hardening.sql` (ALTER POLICY + REVOKE + catalogue DO block), one rollback in `supabase/migrations/down/`, one gate `supabase/tests/test_contact_requests_insert_intro_authz.sql` whose `RED-UNDER-SETUP` reuses the `test_strategies_private_owner_isolation.sql` fixture chain plus one new fixture `43-fixture-intro-authz-stand-ins.sql`, every twin a `sql` step, then move every row of the Census table (FILES_FLOOR, ARMS_FLOOR, the `gate-family-meta` keys, the parser/floors/lint pins, and the `ci.yml` anti-skip pair if the gate prints an `ALL <n> ARMS EXECUTED` sentinel).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Intro-create authorization (approved, allocator role, attested) | API / Backend (`/api/intro`) | Database / Storage (RLS `WITH CHECK`) | The route stays the UX-facing gate (named codes); the policy is the backstop for every other entry point (D-01) |
| Admin-sent intro | API / Backend (`/api/admin/match/send-intro`, `isAdminUser`) | Database (SECDEF RPC, service_role only after D-04) | Admin authority is enforced in the route; the RPC must not be client-callable |
| Function EXECUTE control | Database / Storage (ACL) | none | ACL is the only control for a SECDEF function; no row policy sees it |

## Standard Stack

No external packages are installed by this phase. Everything is SQL plus existing repo scripts.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| PostgreSQL | 16.13 (Homebrew keg, measured) | pg-lane throwaway cluster for gate + mutation runs | The lane resolves to this keg [VERIFIED: `bash scripts/pg-lane/run.sh --print-pgbin` printed `/opt/homebrew/opt/postgresql@16/bin`; `postgres --version` printed `postgres (PostgreSQL) 16.13 (Homebrew)`] |
| `scripts/pg-lane/run.sh` | repo | boot, apply, gate, destroy | Contract in `scripts/pg-lane/README.md` |
| `scripts/mutation-runner/run.mjs` | repo | proves each twin bites | `--file <gate.sql>` and `--parse-only` exist [VERIFIED: scripts/mutation-runner/run.mjs:4670-4715] |

## Package Legitimacy Audit

No external packages are recommended; audit not applicable. Packages removed: none. Packages flagged SUS: none.

## Exact current definitions (read this session)

### The policy
- Original: `supabase/migrations/20260405061912_rls_policies.sql:47-48`:
  `CREATE POLICY contact_requests_insert ON contact_requests FOR INSERT` / `  WITH CHECK (allocator_id = auth.uid());` [VERIFIED: file read]
- Baseline: `supabase/schema/baseline.sql:16605`:
  `CREATE POLICY "contact_requests_insert" ON "public"."contact_requests" FOR INSERT WITH CHECK (("allocator_id" = "auth"."uid"()));` [VERIFIED: file read]
- Command and roles: `cmd = INSERT`, `roles = {public}` (no `TO` clause) [VERIFIED: measured on the lane after applying the real original migration: `contact_requests_insert | INSERT | {public} | (allocator_id = auth.uid())`]. `ALTER POLICY ... WITH CHECK` leaves command and roles alone [ASSUMED: PostgreSQL documented behaviour, not re-fetched; the migration's DO block should assert `cmd = 'INSERT'` after the ALTER so a surprise cannot pass].
- No migration in `supabase/migrations/*.sql` uses `ALTER POLICY` [VERIFIED: `grep -rl "ALTER POLICY" supabase/` listed only three `supabase/tests/*.sql` gate files, e.g. `test_strategy_shares_rls.sql:842` `ALTER POLICY strategy_shares_owner ON strategy_shares USING (...) WITH CHECK (...)` as a twin mutation]. So there is gate precedent, no migration precedent. It is valid on the PROD apply path; the lane trial below ran it successfully.
- `contact_requests_read` is `allocator_id = auth.uid() OR strategy_id IN (...)` (baseline.sql:16607-16609): the route's `.insert(...).select("id")` keeps working because the allocator reads its own row.
- No trigger on `contact_requests` [VERIFIED: `grep` of baseline for `CREATE TRIGGER` on that table returned nothing; matches CONTEXT].

### The columns the new WITH CHECK reads
- `profiles`: `"role" "text" DEFAULT 'manager'::"text" NOT NULL`, `"manager_status" ... NOT NULL`, `"allocator_status" ... NOT NULL`, `"is_admin" boolean DEFAULT false NOT NULL`; checks `profiles_role_check ... ARRAY['manager'::"text", 'allocator'::"text", 'both'::"text"]` and both status checks `ARRAY['newbie', 'pending', 'verified']` (baseline.sql:13047-13061). All four columns are NOT NULL, so SQL NULL cannot occur in production; the predicate must still be null-safe (a missing profile row yields no `EXISTS` match, so it refuses).
- `investor_attestations`: `"user_id" "uuid" NOT NULL, "attested_at" timestamp with time zone DEFAULT "now"() NOT NULL` (baseline.sql:13513-13515). `attested_at` is NOT NULL, so `attested_at IS NOT NULL` is redundant in production but mirrors `route.ts` exactly (D-02); keep it.
- SELECT policies (baseline.sql:16455-16469, 16965): `attestations_self_read ... USING (("auth"."uid"() = "user_id"))`, `attestations_admin_read` (EXISTS on profiles `is_admin`), `attestations_service_role`; `profiles_read_public ... USING ((("id" = "auth"."uid"()) OR true))`. None references `contact_requests`, so no policy recursion [VERIFIED: file read]. A signed-in caller reads its own rows under RLS.
- Table grants (Q1 confirmation, read this session): `investor_attestations` has a TABLE-level `GRANT SELECT,INSERT,REFERENCES,DELETE,UPDATE ... TO "authenticated"` (baseline.sql:18687). `profiles` does NOT: it has table-level `GRANT REFERENCES` only (baseline.sql:18381-18382) and COLUMN-level grants. For `authenticated` the five columns the policy reads are all granted: `GRANT SELECT("id"),UPDATE("id")` (:18388), `GRANT SELECT("role")` (:18432), `GRANT SELECT("manager_status")` (:18437), `GRANT SELECT("allocator_status")` (:18442), `GRANT SELECT("is_admin")` (:18452); `anon` holds the same column SELECTs (:18387, 18431, 18436, 18441, 18451). **Consequence for the plan: the WITH CHECK may read ONLY `id`, `role`, `allocator_status`, `manager_status`, `is_admin` from `profiles`; any other column would raise 42501 at the grant layer for a real caller.** The lane's `01-fixture-core.sql` grants table-level `SELECT ON strategies, profiles TO authenticated`, a WIDER stand-in than the real column grants, so the lane cannot catch a column outside that set; the CI `sql-tests` run on the real dump can. The subquery inside a WITH CHECK runs with the caller's privileges (Pitfall 1).

### Function and ACL
- Definition: `baseline.sql:9996-10054` `CREATE OR REPLACE FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") ... LANGUAGE "plpgsql" SECURITY DEFINER SET "search_path" TO 'public'`, `OWNER TO "postgres"` [VERIFIED].
- Grant lines to re-base on: `baseline.sql:18051-18054` and the original grant statements in `20260419140916_match_decisions_original_strategy.sql:133-134` [VERIFIED]. The migration states the intended end state (client roles hold no EXECUTE, `service_role` does) and the gate asserts it.
- REVOKE precedent: `20260409133655_function_execute_hardening.sql:71` `REVOKE ALL ON FUNCTION send_intro_with_decision(UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;` (5-arg form) then two DO blocks asserting `has_function_privilege('anon'|'authenticated', p.oid, 'EXECUTE')` is false and `service_role` still true, via `pg_proc` join on `proname` [VERIFIED: file read]. Reuse that shape, but key the assertion on the 6-arg `regprocedure`, not just `proname`.
- Only caller: `src/app/api/admin/match/send-intro/route.ts:460` `admin.rpc("send_intro_with_decision", {...})`, admin client (CONTEXT D-04, re-confirmed the call site). `src/__tests__/match-decisions-schema.test.ts:72` calls it with `admin` too (service role). `src/__tests__/audit-coverage.test.ts:384` only lists the name. No `e2e/`, `analytics-service/`, `scripts/` caller [VERIFIED: grep; the only `e2e` hit is a comment in `e2e/match-queue.spec.ts:21`].
- Post-migration ACL measured on the lane with a stand-in function: `{postgres=X/postgres,service_role=X/postgres}` [VERIFIED: lane trial].

### Route predicate truth table (read `src/app/api/intro/route.ts:96-146`, `src/lib/approval.ts`, `src/lib/api/approval-gate.ts`)
Order in the route: auth, `assertProfileApproved` (profile `role, allocator_status, manager_status, is_admin`; `maybeSingle`), then role check `profile.role !== "allocator" && profile.role !== "both"` -> 403, then attestation `attested_at == null` -> 403.

| profile | approved? | role ok? | route outcome |
|---|---|---|---|
| no row | no | | refuse |
| `is_admin`, role `allocator`/`both` | yes (override) | yes | admit if attested |
| `is_admin`, role `manager` | yes | **no** | refuse (role check runs after the gate, applies to admins) |
| role `allocator`, `allocator_status='verified'` | yes | yes | admit if attested |
| role `allocator`, status not verified | no | | refuse |
| role `both`, both verified | yes | yes | admit if attested |
| role `both`, either not verified | no | | refuse |
| role `manager`, `manager_status='verified'` | yes | no | refuse |
| unknown / NULL role | no (`default: return false`) | no | refuse |

Recommended SQL (null-safe; this was run on the lane and gave the expected admit/refuse results for the approved+attested and unapproved cases):

```sql
ALTER POLICY "contact_requests_insert" ON public.contact_requests WITH CHECK (
  allocator_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('allocator', 'both')
      AND (p.is_admin
           OR (p.role = 'allocator' AND p.allocator_status = 'verified')
           OR (p.role = 'both' AND p.allocator_status = 'verified' AND p.manager_status = 'verified')))
  AND EXISTS (
    SELECT 1 FROM public.investor_attestations a
    WHERE a.user_id = auth.uid() AND a.attested_at IS NOT NULL));
REVOKE ALL ON FUNCTION public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
```

Measured lane results with that SQL [VERIFIED: lane trial this session]: approved+attested allocator `INSERT` admitted; unapproved allocator refused with `42501 / new row violates row-level security policy for table "contact_requests"`; `authenticated` calling the RPC refused with `42501 / permission denied for function send_intro_with_decision`.

## Migration conventions

- Latest migration: `supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql` [VERIFIED: `ls`]. Today is 2026-11-10. Recommended new name: `20261110150000_intro_path_authz_hardening.sql` (sorts after, neutral per D-08). Check it against PROD's applied tip at plan time; `migration-policy.yml` blocks backdated additions (workflow header lines 1-12, `ADDED_FILES` at :133).
- Header style: long `-- Migration <ts>: ...` comment block with phase tag, then body. Recent migrations (e.g. `20261106120000_refusalrace_metadata_merge_rpcs.sql`, `20261110120000_...`) carry 0 `BEGIN;`; only `20261107140000` carries one. Supabase is believed to wrap each migration file in a transaction, so omit `BEGIN/COMMIT` [ASSUMED] [VERIFIED: grep -c "BEGIN;" over `2026110*`: 0 for all but `20261107140000` (1)].
- Rollbacks live in `supabase/migrations/down/<ts>-rollback.sql`, are manual, never applied by CI, and are excluded from `migration-policy.yml` (`':(exclude)supabase/migrations/down/**'`, :133) and from the baseline-currency chain (`scripts/check-baseline-currency.mjs:917` `// e.g. down/ - not part of the forward chain`). 61 files exist. Write one (restore original `WITH CHECK (allocator_id = auth.uid())` and the three grants). The rollback header in `down/20261110120000-rollback.sql` is the template, including the "ledger row left in place" paragraph.
- D-06 DO block (catalogue only), suggested assertions: (1) `pg_policies` row for `contact_requests_insert` has `cmd = 'INSERT'` and `with_check` text containing `investor_attestations`, `profiles` and `allocator_id` (substring checks; do not pin the whole normalised text); (2) the 6-arg `regprocedure` exists (so a typo in the signature fails loudly instead of the REVOKE hitting nothing); (3) `has_function_privilege('anon'|'authenticated', oid, 'EXECUTE')` false and `'service_role'` true; (4) no PUBLIC grantee via `aclexplode(coalesce(proacl, acldefault('f', proowner)))` grantee 0. Never SELECT from `contact_requests`, `profiles` or `investor_attestations` rows (TEST is schema-only).
- Do not add `CREATE OR REPLACE FUNCTION`: the body is untouched (D-04), so `npm run schema:functions` output should not change. Verify at execution with `npm run schema:functions:check` (script exists: `package.json` `"schema:functions:check": "tsx scripts/dump-sql-functions.ts --check"`) [expected unchanged: [ASSUMED], not run this session].

## SQL gate machinery

### Gate file structure (analogs read)
- Closest analog for the policy half: `supabase/tests/test_csv_daily_returns_perkey_rls.sql`. Pattern: `BEGIN;` then one `DO $$` block; seed `auth.users` then `profiles ... ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role` (an `auth.users` insert on the lane produces a `profiles` row, so a plain `INSERT INTO profiles` failed with `23505 profiles_pkey` [VERIFIED: lane trial; the mechanism is not traced and is [ASSUMED] to be a trigger from fixture 01/02]); impersonate with `PERFORM set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;`, `RESET ROLE;` before every `RAISE`, and `set_config('request.jwt.claims', NULL, true)` after. Failure line: `RAISE EXCEPTION 'TEST FAILED (Assertion 1): ...'`. Seed strategies with `INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges) VALUES (..., 'published', '{}', '{}', '{}', ARRAY['binance'])` (the idiom already works on both lanes).
- Closest analog for the ACL half: `supabase/tests/test_truncate_revoke_anon_authenticated.sql` (REVOKE migration + catalogue sweep + refusal with SQLSTATE 42501; header comment explains each arm and why).
- Fixture helper already present: `scripts/pg-lane/fixtures/01-fixture-core.sql` defines `public._assert_no_public_execute(text)` (checks PUBLIC EXECUTE through `aclexplode(... acldefault('f', p.proowner))`, grantee 0, raises `insufficient_privilege`) [VERIFIED: file read].

### Annotation syntax (read `scripts/mutation-runner/GRAMMAR.md`)
- Each arm: a prose `-- RED-UNDER: ...` line, then on the next line one single-line JSON `-- RED-UNDER-M: {"arm":"<ID>","apply":[...],"neuter":[{"arm":"<other>"}]}`. `<ID>` must equal the text in `TEST FAILED (<ID>)` and be unique in the file. Markers count only at line start (`^[ \t]*--[ \t]*RED-UNDER...`), so prose that merely mentions them must not start a comment line with the marker.
- Exactly one `-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/...","supabase/migrations/..."]}` per file, one line, ordered apply list (GRAMMAR.md "RED-UNDER-SETUP").
- Step kinds: `edit` (byte-exact find/replace, REQUIRED measured `occurrences`), `insert-after`, `sql` (runs after the migrations, before the gate, via the lane's `--post-apply`). Rule 4: no step may target `scripts/pg-lane/fixtures/**`. Rule 3a: injected text may not contain a `TEST FAILED (` literal. `neuter` suppresses another arm's raise on that arm's lane only. `waiver` exists but `WAIVED_CEILING` is 0 and must stay 0.
- **Recommended: make every twin a `sql` step.** Precedent: `test_csv_daily_returns_perkey_rls.sql` twins are `ALTER POLICY ... USING (false)` / `CREATE POLICY ...`. A migration `edit` would trip the migration's own catalogue DO block and abort the apply (GRAMMAR.md "Shape 2" explains exactly this for GRANTs), so the gate would never run. A `sql` twin mutates the live state after the DO block ran.

### Suggested arm layout and twins (planner may refine; every twin must name its own arm as FIRST failure)
Order matters because a twin is accepted only if its arm is the first `TEST FAILED` the file prints.

| Arm | Asserts | Twin (sql step) | Needs neuter |
|---|---|---|---|
| ACL-PUBLIC | no PUBLIC EXECUTE on the 6-arg function (aclexplode grantee 0). Put this FIRST of the ACL arms | `GRANT EXECUTE ON FUNCTION public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid) TO PUBLIC` | no |
| ACL-ANON | `NOT has_function_privilege('anon', regprocedure, 'EXECUTE')` | `GRANT EXECUTE ... TO anon` | no (ACL-PUBLIC is green) |
| ACL-AUTH | same for `authenticated` | `GRANT EXECUTE ... TO authenticated` | no |
| ACL-SVC | `service_role` still has EXECUTE | `REVOKE EXECUTE ... FROM service_role` | no |
| ACL-CALL | `SET LOCAL ROLE authenticated; PERFORM public.send_intro_with_decision(...)` raises 42501 and the message contains `permission denied for function` | `GRANT EXECUTE ... TO authenticated` | yes: neuter ACL-AUTH |
| POL-ADMIT | approved+attested `allocator` insert admitted | `ALTER POLICY ... WITH CHECK (false)` | no (it is first of the policy arms) |
| POL-BOTH | `both` with both statuses verified, attested: admitted | `ALTER POLICY` with the role list narrowed to `'allocator'` | no |
| POL-ADMIN | `is_admin`, role `allocator`, statuses `newbie`, attested: admitted | `ALTER POLICY` without the `p.is_admin` disjunct | no |
| POL-UNAPPROVED | allocator with `allocator_status` `newbie` or `pending`, attested: refused | `ALTER POLICY` with the approval disjunct removed (owner + role + attestation kept) | no |
| POL-BOTH-HALF | `both` with only `allocator_status` verified, attested: refused | `ALTER POLICY` with the `both` branch relaxed to allocator status only | no |
| POL-MANAGER | role `manager`, `manager_status='verified'`, attested: refused | `ALTER POLICY` that adds a manager-verified approval branch and drops the role conjunct | no |
| POL-ADMIN-MANAGER | `is_admin` with role `manager`: refused (route runs role check after the gate) | `ALTER POLICY` with the role conjunct removed | neuter POL-MANAGER only if the two twins overlap in practice; measure |
| POL-UNATTESTED | approved allocator with no `investor_attestations` row: refused | `ALTER POLICY` with the attestation conjunct removed | no |
| POL-OWNER | an approved attested caller inserting `allocator_id` = another user: refused | `ALTER POLICY` without `allocator_id = auth.uid()` | no |
| POL-ANON | `anon` insert refused (`auth.uid()` NULL) | `ALTER POLICY ... WITH CHECK (true)` | neuter the arms that this bites earlier (measure) |

**Section and parity rules that shape the gate (GRAMMAR.md "The parity gate", :563-):** per file, count of `-- RED-UNDER:` prose lines must equal count of `-- RED-UNDER-M:` twins (a waiver counts as a twin, and `WAIVED_CEILING` is 0). Every `RAISE EXCEPTION 'TEST FAILED (<arm>)...'` is a judged section that needs its twin. Anything that is NOT an arm (precondition checks such as "the table INSERT grant is present", seed checks) must be spelled so the runner does not judge it: precedent is `supabase/tests/test_compute_job_metadata_merge.sql:514`, `RAISE EXCEPTION 'ARM 11 FAILED (control): ...'`, an untwinned control with a different spelling, which the 191 phase's floor commit comment calls out ("arm 11 is an untwinned control raising the ARM x FAILED spelling"). Use that spelling (for example `SETUP CHECK FAILED (control): ...`) for preconditions; never `TEST FAILED (` without a twin. A `RESET ROLE;` immediately before a neutered raise is absorbed with it (GRAMMAR.md "Neuter semantics").

**Lint R1-R3 (read `scripts/lint-sql-gates.mjs:100-163`):** R1 flags any INSERT/UPDATE/DELETE or `SELECT ... INTO` INSIDE an `EXCEPTION WHEN` handler (the handler's subtransaction already rolled back, so the probe confirms nothing); put the post-refusal row count AFTER the `BEGIN ... EXCEPTION ... END` block, and keep the handler to `GET STACKED DIAGNOSTICS` plus a flag assignment. R2 flags `pg_get_functiondef` matched without the comment-strip idiom (avoid `pg_get_functiondef` here: use `has_function_privilege` and `aclexplode`). R3 flags additive arithmetic on a table-read value inside a diagnostic (do not compute `count + 1` in a message). The green/red fixtures live in `scripts/lint-sql-gates-fixtures/` (the R1 green fixture is the shape to copy; not opened this session beyond its name).

Refusal arms must discriminate the layer: grant-layer refusals and RLS refusals are both SQLSTATE `42501`. Read the message and require `row-level security` for policy arms (measured text: `new row violates row-level security policy for table "contact_requests"`) and `permission denied for function` for the RPC arm; also assert up front `has_table_privilege('authenticated', 'public.contact_requests', 'INSERT')` is true so a missing GRANT cannot pass for an RLS refusal (fixture 10's header records this exact vacuity hazard for `strategies`). Each refusal arm should also assert the row count for that caller stays 0. Keep the lint rules in mind: R1 (exception-handler probe: a handler that catches 42501 must discriminate), R2, R3, R4. Run `node scripts/lint-sql-gates.mjs` and `node scripts/lint-sql-gates.mjs --self-test` (self-test prints `lint-sql-gates self-test OK: 7 rules, red+green each.` per CLAUDE.md).

### Local-stack lane compatibility (same file runs there with NO setup list)
`sql-tests` (CI) runs the corpus against a private local Supabase stack with the real dump plus replayed migrations (CLAUDE.md D-F). So the gate must work on the REAL schema too: seed only `allocator_id` and `strategy_id` into `contact_requests` (real table has more columns but all others have defaults or are nullable: `baseline.sql:13228-13250`, `message`, `status DEFAULT 'pending'`, `source DEFAULT 'direct'`, `snapshot_status DEFAULT 'ready'`); use distinct strategies per insert (real table: `ADD CONSTRAINT "contact_requests_allocator_id_strategy_id_key" UNIQUE ("allocator_id", "strategy_id")` at baseline.sql:14710; FKs `contact_requests_allocator_id_fkey ... REFERENCES "public"."profiles"("id") ON DELETE CASCADE` (:15936), `contact_requests_strategy_id_fkey ... REFERENCES "public"."strategies"("id") ON DELETE CASCADE` (:15946), `contact_requests_replacement_for_fkey` (:15941, nullable)); seed `profiles` with `ON CONFLICT`; set status/admin columns as `postgres` (the privileged-column trigger allows `current_user IN ('postgres', 'service_role', 'supabase_admin')`, `20260529150000_lock_profile_privileged_columns.sql:106`). This cannot be run locally (needs Docker, out of scope); its first real run is CI `sql-tests`. Booked residual risk, see Open Question 1.

## pg-lane: what it provides, and the measured recipe

The lane is plain PostgreSQL, no Supabase image. It creates its own `auth` schema, `auth.users`, `auth.uid()` (reads the `request.jwt.claims` GUC), and the roles `anon, authenticated, service_role` through `01-fixture-core.sql`; `07` supplies default privileges (`ALL` on tables, sequences, functions to the three roles for objects created after it); `15` adds `auth.role()`; `12` adds `profiles.is_admin`; `28` adds `profiles.manager_status` / `allocator_status` with their CHECKs [VERIFIED: fixture files read].

Measured chain (a lane run on this machine, exit 0, about 1.3 s) that applies the REAL original policy migration:
`01-fixture-core`, `02-fixture-sanitize-tables`, `03-fixture-compute-jobs`, `07-fixture-supabase-default-privileges`, `12-fixture-profiles-is-admin`, `28-fixture-profiles-privileged-columns`, `10-fixture-strategies-rls-baseline`, [new fixture 43], `supabase/migrations/20260405061912_rls_policies.sql`, then the new migration. (The list of 01,02,03,10 + 20260405061912 is the proven `RED-UNDER-SETUP` of `test_strategies_private_owner_isolation.sql`; fixture 10 creates the stand-in `contact_requests(allocator_id, strategy_id)`, `discovery_categories` and `portfolio_strategies` that migration needs, and drops the narrow `strategies_read` stand-in.)

**New fixture 43** (next free number; existing fixtures run 01 to 42 with two files numbered 36) must, in this order and WITHOUT editing any existing fixture:
1. `ALTER TABLE investor_attestations ADD COLUMN IF NOT EXISTS attested_at TIMESTAMPTZ NOT NULL DEFAULT now();` and `ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT 'stand-in'` (fixture 02 gives the table only `user_id`; the real `version` is `"version" "text" NOT NULL` with NO default, baseline.sql:13516, so the GATE's seeding must insert `(user_id, version)` and must not rely on the stand-in default. The trial insert of `(user_id)` alone worked only because the stand-in lacks `version`).
2. `ALTER TABLE investor_attestations ENABLE ROW LEVEL SECURITY;` and a stand-in `CREATE POLICY attestations_self_read ... USING (auth.uid() = user_id)` mirroring `baseline.sql:16465`.
3. `GRANT SELECT ON investor_attestations TO authenticated;` (Pitfall 1).
4. A stand-in `public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid)` returning `TABLE(contact_request_id uuid, match_decision_id uuid, was_already_sent boolean)`, `SECURITY DEFINER`, created AFTER fixture 07 so default privileges grant the three client roles EXECUTE, then `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` to mirror the baseline ACL shape (`baseline.sql:18051-18054`). Body can be trivial: the ACL arms never execute it past the privilege check, and the real function body is untouched by this phase. (Applying real `20260419140916` is not possible: fixture 40 already gives `match_decisions` the column that migration adds.) State in the fixture header that it is a STAND-IN; the migration under test (the REVOKE) is real.

Lint check for the fixture: R5/R6/R7 walk the apply list; fixture 43 creates no table and one policy name that no later entry creates, so they stay quiet. Run the linter to confirm.

### Can the executor run it locally without Docker? (explicit conclusion)
- (a) **The new gate on the pg-lane: YES.** `pg_ctl`, `initdb`, `psql`, `pg_config` are on PATH (Homebrew, client 18.6), but the lane's `resolve_pgbin` skips a client-only keg and settled on `/opt/homebrew/opt/postgresql@16/bin` (has `postgres`, 16.13). `pg_cron.dylib` is present at `/opt/homebrew/opt/postgresql@16/lib/postgresql/pg_cron.dylib`, and the lane booted with the preload (measured). Docker, the Supabase CLI and `npm install` are not needed. `node_modules` is a symlink to the main checkout, so `node` scripts resolve imports.
- (b) **`node scripts/mutation-runner/run.mjs --file supabase/tests/<new gate>.sql`: YES** (also `--arm <ID>`); `--parse-only` is a static corpus check with no database and printed `coverage: files 80/107` and `arms: 0/815/0` at HEAD; it ended `No static defects`. A FULL `node scripts/mutation-runner/run.mjs` is possible locally but long: README records 486 s at 363 arms; the corpus is now 815 arms at a recorded mean of 1.6 s per arm, so budget tens of minutes [ASSUMED estimate, not run]. CI's `sql-mutation` job is the authoritative full run.
- (c) **The local-stack lane (`scripts/local-stack/run.sh`, `sql-tests`): NO** (Docker + Supabase CLI). The gate's behaviour on the real dump is verified only in CI.
- Disk: `df -h /System/Volumes/Data` showed 11Gi free (above the 3 GB stop line). A lane run cleans its cluster on exit (measured: workdir empty, no postgres left).

## Census: everything a new gate file and its arms move

Baseline at HEAD [VERIFIED: `node scripts/mutation-runner/run.mjs --parse-only` output and file reads]: `coverage: files 80/107`, `arms: 0/815/0` (executed/annotated/waived), `export const FILES_FLOOR = 80;` at `scripts/mutation-floors.mjs:1342`, `export const ARMS_FLOOR = 815;` at `:3411`, `export const WAIVED_CEILING = 0;` at `:3525`. Read these by symbol, never restate in prose elsewhere.

With N new non-waived arms in one new file: files 81/108, arms 815+N.

| # | Site (symbol) | Move | Failure if missed |
|---|---|---|---|
| 1 | `scripts/mutation-floors.mjs` `FILES_FLOOR` | 80 -> 81 (REQUIRED) | `src/__tests__/mutation-runner-floors.test.ts` `RATCHET STALE: ... Raise FILES_FLOOR ... to ...` (message at :768; fails when annotated > floor) |
| 2 | same file `ARMS_FLOOR` | 815 -> 815+N, must EQUAL non-waived twins exactly (REQUIRED) | the same test, `equals the number of NON-WAIVED twins` (`expect(ARMS_FLOOR).toBe(twins - waivers)` at :827); both directions fail. Add the dated lineage comment above the constant like earlier entries |
| 3 | `WAIVED_CEILING` | stays 0; add no waiver | `matches the measured corpus exactly` test |
| 4 | `src/__tests__/gate-family-meta.test.ts` `KNOWN_THRESHOLD_SITES` entries `"scripts/mutation-floors.mjs :: FILES_FLOOR=80"` (line 944) and `"... :: ARMS_FLOOR=815"` (line 945) | rewrite both keys to the new values, same commit as the constant; the trailing comment on each entry is a dated lineage note and is the convention to extend | the registry test fails on a threshold whose key does not match the live constant (the file's header says an exact set in both directions) |
| 5 | `src/__tests__/mutation-annotation-parser.test.ts:3393` `expect(corpus.filesTotal).toBe(107);` | 107 -> 108, add a `CURRENCY` comment line above it (the CURRENCY comment blocks above `:2732` and `:3393` are the convention) | that test's run reads `expected 108 to be 107` |
| 5a | same file, `expect(corpus.filesTotal).toBe(107);` at `:2732` (a SECOND pin of the same number, easy to miss), `expect(corpus.filesAnnotated).toBe(80);` at `:2822`, `expect(armsSeen).toBe(815);` at `:1114` | 107 -> 108 (both `filesTotal` pins), 80 -> 81, 815 -> 815+N | each reads `expected X to be Y` |
| 5b | `src/__tests__/mutation-runner-floors.test.ts:757` `expect(totalAnchored).toBe(815);` (counts prose anchors; the file's comments at :509-620 say this pin is deliberately NOT `ARMS_FLOOR`) | 815 -> 815+N | `expected X to be 815` |
| 5c | `src/__tests__/lint-sql-gates.test.ts:1176` `expect(res.out).toMatch(/scanned 107 file/);` | 107 -> 108 (CURRENCY comment above it, convention at :1170-1175) | self-test output `scanned 108 file(s)` no longer matches |
| 5d | **Anti-skip sentinel census (a SECOND, separate floor pair):** `.github/workflows/ci.yml:5279` `SENTINEL_FLOOR=27  # files declaring a sentinel` and `:5280` `ARMS_FLOOR=430     # 8 + 13 + ...` (a sum comment), pinned by `src/__tests__/drift-check-scripts.test.ts:4821` (`it("ci.yml still declares SENTINEL_FLOOR=27 and ARMS_FLOOR=430 at HEAD"`) and the `grep -ac` pins at `:5096` (`SENTINEL_FLOOR=27`) and `:5107` (`ARMS_FLOOR=430`); `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` re-derives the sentinel-bearing set from the corpus | **Only if the new gate prints a `RAISE NOTICE 'ALL <n> ARMS EXECUTED (...)'` sentinel** (recommended: it is what makes the local-stack run fail loud if the gate silently skips an arm): SENTINEL_FLOOR 27 -> 28 and ci.yml ARMS_FLOOR 430 -> 430+n, where n is the sentinel's own arm count (it may differ from the twin count N when a control is untwinned), add the term to the sum comment, update the three drift-check pins and their CURRENCY comment | the 191 gate commit's own test read `expected 1 to be +0` once ci.yml carried the new floor; contract test red |
| 6 | `scripts/lint-sql-gates.mjs` and `scripts/lint-sql-gates-fixtures/*` | no edit; the new gate and fixture are linted by the corpus scan | `sql-gate-lint` job red only if a rule fires |
| 7 | `scripts/lint-app-guc.mjs` | no edit; the new gate/migration must not use an app-GUC pattern (not needed here) | `sql-gate-lint` |
| 8 | `docs/sql-gate-lineage.md` | history, not a live constant (CLAUDE.md says so); optional | none |
| 9 | `scripts/pg-lane/README.md` fixtures table ("The directory holds four fixtures") | already stale (42 files exist); do NOT chase it | none |

**How this table was derived, and how the executor re-checks it.** Rows 5a-5d were found by opening the diff of the commit that last added a gate file, `a363392ea` (`feat(191): REFUSALRACE PR 1`, added `supabase/tests/test_compute_job_metadata_merge.sql`): its non-planning stat touched `.github/workflows/ci.yml`, `scripts/mutation-floors.mjs`, `src/__tests__/drift-check-scripts.test.ts`, `gate-family-meta.test.ts`, `lint-sql-gates.test.ts`, `mutation-annotation-parser.test.ts`, `mutation-runner-floors.test.ts` (plus function-snapshot files that belong to that phase's new functions and have no analog here: `scripts/baseline-content-drift-check.mjs`, `scripts/dump-sql-functions.ts`, `supabase/schema/functions/*`). Not opened this session: the 194.2 arm-only commit and the remaining grep hits `scripts/local-stack/sql-corpus-report.mjs`, `src/__tests__/local-stack-lane-wiring.test.ts`, `src/__tests__/vac06-mechanism-arms.test.ts`, `ci.yml` beyond :5279-5280 (UNMEASURED: the executor must run `git show --stat a363392ea` and `grep -a -rln "pg-lane/fixtures" src/__tests__ scripts .github` and treat any hit not in this table as a census to move; running `npx vitest run` on the five named test files after the edits is the check, because each stale pin names itself).

The re-derivation in `mutation-runner-floors.test.ts` is a static walk of `supabase/tests/` with its own regexes, so the executor can read the target ARMS_FLOOR from `--parse-only`'s `arms:` annotated figure without a full run, then confirm with the CI `sql-mutation` result.

Subset/scope note: `scripts/mutation-floors.mjs` counts as mutation machinery on a pull request (header of that file), so a PR that raises a floor runs the FULL corpus in `sql-mutation` (20-minute ceiling, never to be raised, CLAUDE.md). The ARMS count is large; keep arms to what D-07 needs.

## Other touchpoints

- **Seed scripts use the service role** [VERIFIED: `scripts/seed-demo-data.ts:664-688` reads `SUPABASE_SERVICE_ROLE_KEY` and builds `createClient(url, serviceKey)`, inserts at `:1177-1187`; `scripts/seed-full-app-demo.ts:1437-1476` builds the `admin` client from the same key and only DELETEs `contact_requests` at `:1292`]. RLS is bypassed, so the tighter policy cannot break them.
- **Other inserters:** the only user-scoped insert is `src/app/api/intro/route.ts:188` (`supabase.from("contact_requests").insert(...)`). `analytics-service/services/job_worker.py` UPDATEs only (CONTEXT; the grep hits in `analytics-service/` are job_worker and tests that do not call the RPC). No `supabase/tests` file inserts `contact_requests` as `authenticated` and none mentions `send_intro_with_decision` [VERIFIED: grep]. `src/lib/database.types.ts` lists the RPC (typed signature only) and an ACL change does not alter generated types [expected no change; [ASSUMED] no regen run].
- **Vitest touching the RPC:** `match-decisions-schema.test.ts:72` (admin client, unaffected), `audit-coverage.test.ts:384` (name list, unaffected). No test pins `has_function_privilege` for this function or the old policy text.
- **`supabase/schema/functions/send_intro_with_decision.sql`**: generated body snapshot, source `20260419140916_...`; unchanged by an ACL-only migration (header says "replayed from supabase/migrations/**", "Canonical current body"). Confirm with `npm run schema:functions:check`.
- **`baseline.sql` / `baseline-carried-migrations.txt`: do not touch.** The local-stack lane replays migrations newer than the dump (CLAUDE.md D-F; `check-baseline-currency.mjs --replay-set` prints them). The ACL-fidelity gate runs BEFORE the replay (`scripts/local-stack/run.sh:420` vs `:434-438`), so a replayed REVOKE does not trip it. A re-dump is not part of this phase.
- **VAC-04 (`migration-drift-check.yml`, `scripts/prod-body-drift-check.sh`)** compares function BODIES for changed migration files that contain `CREATE OR REPLACE FUNCTION` (script header :6; changed-file list built at :610-628). The new migration has no `CREATE FUNCTION`, so there is nothing to compare for an ACL-only change [read of header and changed-file logic only; not executed, [ASSUMED] for edge behaviour]. The workflow's separate "migration set vs applied set" step and `migration-policy.yml` backdate guard still run: choose a timestamp after PROD's tip.
- **More migration-PR checks (read this session):** `migration-policy.yml` runs a SECOND `ADDED_FILES` check at :232 (`git diff --name-only --diff-filter=A "$BASE_SHA"..HEAD -- 'supabase/migrations/*.sql' ':(exclude)supabase/migrations/down/**'`) that links to PROD and compares the new filename's timestamp to the remote tip, so the migration must sort after PROD's tip, not only after the repo's newest file. `supabase-migrate.yml` jobs (after `plan`): `apply-test`, `apply-test-verdict`, `prod-credential-divergence-verdict`, `apply`, then `redump-dump` (needs `apply`, main only) and `redump-pr`: after a PROD apply the pipeline regenerates `baseline.sql` through a bot dump PR, so `baseline.sql` is NOT edited by this phase and the new policy/ACL will appear in that redump. `scripts/baseline-content-drift-check.mjs` compares FUNCTION BODIES only ("No tables, no columns, no policies, no triggers, no grants"), so a policy-plus-REVOKE migration cannot move it: a post-merge baseline-content-drift red is NOT expected (the same file's header states it prints that boundary on every run). `plan-anchor-verify` (CLAUDE.md) re-resolves every `file:line` anchor and named symbol a PENDING PLAN.md asserts, so plans must cite exact lines or symbols, never `~` approximations.
- **PROD auto-apply:** after `apply-test` succeeds the PROD apply runs with no human reviewer (CLAUDE.md "CORRECTED 2026-09-23"). All review (migration-reviewer, rls-policy-auditor) must finish BEFORE merge. `apply-test` runs against schema-only TEST: the D-06 catalogue-only DO block is mandatory, and the policy/REVOKE statements are idempotent-safe there (policy exists in the TEST catalogue copy).
- **The route's existing comment** at `src/app/api/intro/route.ts:97-99` stays untouched (Discretion: prefer not to). No `/api/intro` change.
- **Rollback + CHANGELOG:** every ship needs a CHANGELOG entry (CLAUDE.md). That is the ship step's job, not this phase's plans.

## Architecture Patterns

```
signed-in client ──> /api/intro (approval gate, role, attestation, rate limit)
        │                         │ user-scoped insert
        └─(any other entry)──> PostgREST ──> RLS: contact_requests_insert WITH CHECK
                                                     │ EXISTS profiles / investor_attestations (caller's own rows)
admin UI ──> /api/admin/match/send-intro (isAdminUser) ──service_role──> send_intro_with_decision (SECDEF)
                                                                          │ bypasses RLS by design (D-05)
```

Recommended file additions:
```
supabase/migrations/20261110150000_intro_path_authz_hardening.sql
supabase/migrations/down/20261110150000-rollback.sql
supabase/tests/test_contact_requests_insert_intro_authz.sql
scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql
```
plus edits to `scripts/mutation-floors.mjs`, `src/__tests__/gate-family-meta.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`.

### Anti-Patterns to Avoid
- **A twin that edits the migration text** for the policy conjuncts: trips the migration's own DO block, apply aborts, gate never runs. Use `sql` steps.
- **Mutating or editing an existing fixture** (rule 4 forbids twins targeting fixtures; and an edit would move other gates). New fixture only.
- **Reading data in the migration DO block** (D-06).
- **Counting 42501 as proof of an RLS refusal** without checking the message.
- **A helper function in the policy** (D-03): would add an ACL and census movement; inline `EXISTS` is enough and was measured.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Proving a gate arm can fail | an ad-hoc "I broke it by hand" claim | a `RED-UNDER-M` twin run by `scripts/mutation-runner/run.mjs --file ...` | the runner checks first-failure identity; hand mutation proves nothing durable |
| Impersonating a client | custom session switching | `set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated` as in the csv gate | the lane's `auth.uid()` reads exactly that GUC |
| Asserting PUBLIC has no EXECUTE | custom ACL parsing | `public._assert_no_public_execute(text)` from fixture 01 or `aclexplode(... acldefault('f', proowner))` grantee 0 | handles the owner-default PUBLIC EXECUTE that a NULL `proacl` implies |
| Counting arms for the floor | grep | `node scripts/mutation-runner/run.mjs --parse-only` and the runner's own `biting:` line | grep over-counts (GRAMMAR.md rule 1) |

## Common Pitfalls

### Pitfall 1: lane stand-in table has no client grant
**What goes wrong:** the new WITH CHECK reads `investor_attestations`; fixture 02 creates that table before fixture 07, so `authenticated` holds no privilege on it and the policy subquery raises `42501 permission denied for table investor_attestations`, even for a legitimate caller (measured).
**How to avoid:** fixture 43 adds `GRANT SELECT ON investor_attestations TO authenticated` (the baseline carries those grants, `baseline.sql:18686-18688`).
**Warning signs:** the positive arm fails with a table-permission message rather than a policy message.

### Pitfall 2: auto-created profile row
**What goes wrong:** inserting into `auth.users` creates the `profiles` row on the lane, so a plain `INSERT INTO profiles` raises `23505` (`profiles_pkey`) (measured). **How to avoid:** `INSERT ... ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`, then `UPDATE` the status/admin columns as `postgres`.

### Pitfall 3: stand-in function ACL does not mirror the baseline
**What goes wrong:** a function created before fixture 07 gets PUBLIC EXECUTE by default and none of the client-role grants; the ACL arms then pass or fail for a reason the real function never had. **How to avoid:** create it after 07 and `REVOKE ALL ... FROM PUBLIC` so its pre-migration ACL has the same three client roles as `baseline.sql:18051-18054`, then the REVOKE under test does real work.

### Pitfall 4: 42501 ambiguity (grant layer vs RLS)
Both raise SQLSTATE `42501`. Require the message text (see arm notes) and assert the table INSERT grant first.

### Pitfall 5: twin order and overlap
`ALTER POLICY ... WITH CHECK (true)` reddens every refusal arm; the file reports only the first. Order arms so each twin reddens its own arm first, or add `neuter` fields (GRAMMAR.md "Neuter semantics"). Put the PUBLIC-grantee ACL arm before the anon/authenticated arms, because a `GRANT ... TO PUBLIC` is inherited by both roles.

### Pitfall 6: route maps only 23505
A policy refusal (`42501`) reaches `/api/intro` as a 500 "Failed to create request". The route's own pre-checks refuse earlier with named codes, so this affects only a caller that bypassed them. That is why the policy must not be STRICTER than the route (D-02); the truth table above is the contract.

### Pitfall 7: floors are exact, not "at least"
`ARMS_FLOOR` must equal non-waived twins; `FILES_FLOOR` must equal annotated files. Both directions fail in `mutation-runner-floors.test.ts`; the likely misses are `gate-family-meta.test.ts`, the TWO `filesTotal` pins in `mutation-annotation-parser.test.ts` (`:2732` and `:3393`), `mutation-runner-floors.test.ts:757`, `lint-sql-gates.test.ts:1176` and the `ci.yml:5279-5280` anti-skip pair.

### Pitfall 8: the full mutation run is long
A floors edit makes the PR run FULL. Keep the arm count modest and do not edit any other gate. Do not raise `sql-mutation`'s `timeout-minutes` (declared ceiling, CLAUDE.md).

### Pitfall 9: public-repo wording (D-08)
No migration comment, arm name, prose RED-UNDER text, plan, SUMMARY or commit message may describe how to misuse the current policy or function or call the live state open. Write arm names as `POL-UNAPPROVED`-style neutral labels, comments as "the policy refuses X / admits Y". Do not paste the SQL of an abusive call sequence; the gate only needs "refused" assertions. Commit with explicit `git add` paths and check `git show --stat` after each commit (CONTEXT D-08).

## Code Examples

Policy check seeding (pattern read from `test_csv_daily_returns_perkey_rls.sql:127-129`):
```sql
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
-- INSERT ... then handle 42501 and read MESSAGE_TEXT for 'row-level security'
RESET ROLE;
PERFORM set_config('request.jwt.claims', NULL, true);
```
Measured refusal texts (lane): `new row violates row-level security policy for table "contact_requests"` (policy) and `permission denied for function send_intro_with_decision` (ACL).

Running locally:
```bash
bash scripts/pg-lane/run.sh --workdir <scratch> --apply <fixtures + migrations in order> --gate supabase/tests/test_contact_requests_insert_intro_authz.sql
node scripts/mutation-runner/run.mjs --file supabase/tests/test_contact_requests_insert_intro_authz.sql
node scripts/mutation-runner/run.mjs --parse-only
node scripts/lint-sql-gates.mjs
```

## State of the Art

| Old | Current | Impact |
|---|---|---|
| `REVOKE ... FROM PUBLIC` alone | also revoke from `anon, authenticated` explicitly | per-role default-privilege grants are not PUBLIC entries (documented in the `20260409133655` header) |
| ledger-style "covered_digest" verification | `verified_at_sha` + `drift_subjects` (CLAUDE.md) | applies to this phase's VERIFICATION.md after the verifier runs |

## Runtime State Inventory

Not a rename/refactor. Not applicable. (One note: the migration ledger on TEST/PROD will gain one row automatically; the rollback file leaves the ledger row in place, as the template documents.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ALTER POLICY ... WITH CHECK` leaves the policy command (`INSERT`) and roles (`{public}`) untouched | Exact current definitions | The DO block asserting `cmd = 'INSERT'` would fail the migration loudly; low risk |
| A2 | `npm run schema:functions:check` reports no change after an ACL-only migration | Migration conventions | One extra regen commit |
| A3 | VAC-04 has nothing to compare for a migration without `CREATE FUNCTION` | Other touchpoints | An unexpected red on `migration-drift-check`; the executor reads the PR check |
| A4 | A FULL local mutation run takes tens of minutes at 815 arms | pg-lane section | Planning only; CI is authoritative |
| A5 | `database.types.ts` needs no regeneration | Other touchpoints | A typecheck/drift test would show it |
| A6 | The census is complete beyond the files named in the Census table | Census | A stale pin names itself when the five named vitest files run; unopened hits are listed under the table |
| A7 | An `auth.users` insert on the pg-lane yields the `profiles` row through a fixture trigger | Gate structure | None for the plan: the ON CONFLICT idiom is what the measured run needed |

## Open Questions

1. **Does the gate behave identically on the real dump (local-stack lane)?**
   - Known: the lane chain was measured; seeding uses only `allocator_id`/`strategy_id` and the same strategies idiom the csv gate already runs on both lanes.
   - Unclear: real-schema constraints (FKs on `contact_requests`, any extra NOT NULL I did not trace, `handle_new_user` behaviour on the real stack) cannot be run without Docker.
   - Recommendation: write defensively (ON CONFLICT seeding, distinct strategies, no reliance on stand-in-only columns) and treat the first CI `sql-tests` run as the verification; budget one fixer round.
2. **Exact arm count N and whether any twin pair needs `neuter`.** Measure with `--file` on the pg-lane; the table above is a starting layout.
3. **Migration timestamp vs PROD tip.** Check the PROD ledger tip via the MCP (read-only, marker query first) at plan time so the filename is not backdated.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL server binaries (initdb, pg_ctl, postgres) | pg-lane, mutation runner | yes | 16.13 (`/opt/homebrew/opt/postgresql@16/bin`) | none needed |
| pg_cron library | lane preload | yes | `pg_cron.dylib` present | `scripts/pg-lane/install-pg-cron-macos.sh` |
| psql | lane | yes | 18.6 (client) | |
| node | runner, linters | yes | v25.8.1 | |
| node_modules | vitest, tsx | yes (symlink to main checkout) | | |
| Docker / Supabase local stack | `scripts/local-stack/run.sh` | not used (out of scope) | | gate verified in CI `sql-tests` |
| Disk | lane | 11Gi free | | |

**Missing dependencies with no fallback:** none for the pg-lane work. The local-stack lane is CI-only.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | SQL gate files run by psql on the pg-lane; mutation runner; vitest for the ratchet tests |
| Config file | gate: `RED-UNDER-SETUP` inside the file; vitest: `vitest.config.ts` |
| Quick run command | `bash scripts/pg-lane/run.sh --workdir <scratch> --apply <list> --gate supabase/tests/test_contact_requests_insert_intro_authz.sql` |
| Twin proof | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_contact_requests_insert_intro_authz.sql` |
| Static corpus | `node scripts/mutation-runner/run.mjs --parse-only` |
| Full suite | CI: `sql-tests`, `sql-mutation`, `sql-gate-lint`, `frontend`; local: `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/mutation-annotation-parser.test.ts` |

### Decision to proof map
| Decision | Behavior | Test type | Automated command | File exists? |
|----------|----------|-----------|-------------------|-------------|
| D-01/D-02 | approved+attested allocator and `both`, admin(role allocator) admitted; unapproved, half-approved `both`, manager, admin-manager, unattested, wrong owner, anon refused | SQL gate arms, each with a twin proven RED | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_contact_requests_insert_intro_authz.sql` | Wave 0 (new) |
| D-03 | no recursion, caller reads own rows | the positive arm itself (a recursion or visibility failure raises) | pg-lane gate | Wave 0 |
| D-04 | no PUBLIC/anon/authenticated EXECUTE, service_role keeps it, authenticated call refused | SQL gate ACL arms + twins | same | Wave 0 |
| D-05 | admin path unchanged | existing vitest `match-decisions-schema.test.ts` (admin client) plus the ACL arm that service_role keeps EXECUTE | `npx vitest run src/__tests__/match-decisions-schema.test.ts` (live-DB gated; runs where credentials exist) | exists |
| D-06 | migration DO block reads catalogue only | grep of the migration for table-row reads, plus the DO block applying cleanly on the lane | `grep -nE 'FROM (public\.)?(contact_requests|profiles|investor_attestations)' ` on the migration must hit only the policy text, not a DO block | Wave 0 |
| D-07 | every arm bites; floors exact | mutation runner + ratchet vitest | the three vitest files above | exists |
| D-08 | wording | review: grep the new files and plan/summary text for the live-state phrases; `git show --stat` after each commit lists only intended paths | manual review step in verification | n/a |

Neuter-RED-restore protocol (CLAUDE memory rule): for each twin, the runner already does mutate, RED with identity named, restore, GREEN. Where an executor hand-neuters anything (the policy or an arm), back up the file bytes first (`cp`), never `git checkout/restore/stash` on uncommitted work.

### Sampling Rate
- **Per task commit:** the lane run of the gate plus `--parse-only`.
- **Per wave merge:** `--file` mutation run of the new gate, the three vitest files, `node scripts/lint-sql-gates.mjs`.
- **Phase gate:** CI `sql-tests` (real dump), `sql-mutation` FULL, `sql-gate-lint`, migration-reviewer and rls-policy-auditor clean, before merge (PROD auto-applies after `apply-test`).

### Wave 0 Gaps
- [ ] `supabase/tests/test_contact_requests_insert_intro_authz.sql` (new gate)
- [ ] `scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql`
- [ ] `supabase/migrations/20261110150000_intro_path_authz_hardening.sql` and its `down/` rollback
- [ ] census edits: every row of the Census table (5, 5a-5d included)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | unchanged (Supabase auth) |
| V3 Session Management | no | unchanged |
| V4 Access Control | yes | RLS `WITH CHECK` at the data layer matching the route; EXECUTE ACL on the SECDEF function |
| V5 Input Validation | no | no new inputs; route zod schema unchanged |
| V6 Cryptography | no | none |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Authorization differing between entry points | Elevation of privilege | keep the table policy equal to the route predicate; keep SECDEF writers service_role-only |
| Policy stricter than the route turning valid requests into 500s | Denial of service (self-inflicted) | truth-table parity arms (admit and refuse sides) |
| SECDEF function with a mutable search_path | Tampering | untouched here: body keeps `SET "search_path" TO 'public'` (baseline.sql:9998) |
| RLS refusal masked by a grant-layer 42501 | (test integrity) | discriminate by message text; assert the table INSERT grant first |

## Project Constraints (from CLAUDE.md)
- PROD migrations auto-apply after `apply-test`; every review happens before merge. Migration-reviewer and rls-policy-auditor must be clean.
- Marker query before any statement that writes to a database; this phase does no DB access.
- SQL gate integrity: `sql-mutation`, `sql-gate-lint` (7 rules), `plan-anchor-verify` gate the aggregate; `WAIVED_CEILING` stays 0; floors read by symbol from `scripts/mutation-floors.mjs`, never restated; do not raise `sql-mutation` `timeout-minutes` (20).
- CHANGELOG entry and VERSION/package.json byte-equal at ship; never `npm version`; never write the CI skip tokens in a commit or PR body.
- Verification: use `verified_at_sha` + `drift_subjects`, never `covered_digest` / `covered_files`.
- Public repo: no secrets, PROD ids, home paths; D-08 wording rule.
- AGENTS.md: Next.js has breaking changes; not relevant (no Next code is touched).
- Banned packages: none involved.

## Sources

### Primary (HIGH confidence, files read this session)
- `src/app/api/intro/route.ts:96-196`, `src/lib/approval.ts`, `src/lib/api/approval-gate.ts`
- `supabase/schema/baseline.sql` (policies 16455-16469, 16602-16620, 16965; tables 13047-13061, 13228-13250, 13513-13521; function 9996-10054; ACL 18051-18054, 18686-18688)
- `supabase/migrations/20260405061912_rls_policies.sql:47-60`, `20260409133655_function_execute_hardening.sql`, `20260419140916_match_decisions_original_strategy.sql:120-145`
- `scripts/pg-lane/run.sh`, `README.md`, fixtures 01, 02, 07, 10, 12, 15, 23, 28, 40
- `scripts/mutation-runner/GRAMMAR.md`, `run.mjs` CLI (:4655-4749), `scripts/mutation-floors.mjs`, `src/__tests__/mutation-runner-floors.test.ts`, `gate-family-meta.test.ts`, `mutation-annotation-parser.test.ts`
- `supabase/tests/test_csv_daily_returns_perkey_rls.sql`, `test_truncate_revoke_anon_authenticated.sql`, `test_strategies_private_owner_isolation.sql` (setup list)
- `scripts/seed-demo-data.ts`, `scripts/seed-full-app-demo.ts`, `scripts/local-stack/run.sh` (lines 420-438), `acl-fidelity.mjs` header, `.github/workflows/migration-policy.yml`, `migration-drift-check.yml`, `scripts/prod-body-drift-check.sh` header

### Secondary (MEDIUM)
- PostgreSQL `ALTER POLICY` semantics (A1): general knowledge, not re-fetched; verified indirectly by the lane trial for admit/refuse behaviour.

### Tertiary (LOW)
- Full-run duration estimate (A4).

## Metadata

**Confidence breakdown:**
- Standard stack / policy and ACL shape: HIGH (read plus measured on a real PG16 lane)
- Census list: HIGH (symbols and lines read; baseline counts from `--parse-only`)
- Real-dump behaviour of the new gate: MEDIUM (cannot be run locally)
- Pitfalls: HIGH for 1-3 (measured), MEDIUM for 5 (layout needs a measured pass)

**Research date:** 2026-11-10
**Valid until:** 2026-11-17 (floors and counts move with every gate-adding phase; re-read them by symbol at plan time)
