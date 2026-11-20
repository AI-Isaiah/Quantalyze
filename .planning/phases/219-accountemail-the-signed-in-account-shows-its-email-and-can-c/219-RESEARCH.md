# Phase 219: ACCOUNTEMAIL - Research

**Researched:** 2026-11-19 (HEAD 423eb6f83, worktree off `gsd/phase-219-accountemail`)
**Domain:** Supabase Auth email change (Next.js 16.4.2 app), one SQL migration on `auth.users` / `public.profiles`, SQL gate corpus censuses
**Confidence:** HIGH on repo facts (all read this session), MEDIUM on Supabase hosted-auth behaviour (not testable here, routed to UAT)

<user_constraints>
## User Constraints (from 219-CONTEXT.md)

Verbatim excerpts of the locked decisions; the full text with reasoning is `219-CONTEXT.md` and wins on any difference.

### Locked Decisions
- **D-01** Host: the existing `/profile` page (`src/app/(dashboard)/profile/page.tsx`), inside the existing `ProfileTabs` "Account" tab (`account` key), above `DeleteAccountButton`. No new route.
- **D-02** The displayed email comes from `supabase.auth.getUser()` on the server (the page already calls it), passed to the client component as a prop. NEVER from `profiles.email`.
- **D-03** No sidebar, top bar or header change.
- **D-04** Change flow: a client component calls `supabase.auth.updateUser({ email: next }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=/profile?tab=account` })`, following `ForgotPasswordForm.tsx`'s `window.location.origin` pattern. ... The planner MUST verify that `next=/profile?tab=account` survives `safeNextPath` ... a test pins it. The value needs URL-encoding inside `emailRedirectTo` so the inner `?` is not read as a second query.
- **D-05** Pending and error copy must be correct under EITHER "Secure email change" setting. ... On reload, the server reads `user.new_email` from `getUser()` and shows the same pending line while a change is outstanding. Errors show Supabase's message, except that a same-as-current email is caught client-side before the call. The final wording is fixed in UI-SPEC.md.
- **D-06** (caller decision, option (a)) Add an `AFTER UPDATE OF email ON auth.users` trigger whose function is SECURITY DEFINER with a pinned `search_path`. It sets `profiles.email = NEW.email` for `id = NEW.id` ONLY when `NEW.email IS DISTINCT FROM OLD.email`, and does nothing when `current_setting('quantalyze.sanitize_in_progress', true) = 'on'`. Before writing, re-base on the LATEST `handle_new_user` (`20260520222848_lock_profile_role_at_signup.sql`) and `sanitize_user` definitions across all migrations. Follow repo migration conventions, including `scripts/lint-migration-data-dependence.mjs`: no new data-reading `DO`-block guard. The profiles `reject_sentinel_writes` and `profiles_lock_privileged_cols` triggers must not refuse this update. Reversibility: costly.
- **D-07** (caller decision) In the SAME migration, `REVOKE UPDATE (email) ON public.profiles FROM authenticated` ONLY IF it is proven, by grepping `src/` supabase-js calls and every RPC or SQL function that runs as the invoker, that no client or user-session path writes `profiles.email`. If any such writer exists, do NOT revoke; record it as a finding. If revoked, `test_profiles_privileged_columns_locked.sql` and its pg-lane fixture must be checked for an assertion on the column-grant set. Reversibility: costly.
- **D-08** (caller decision) SQL self-tests under `supabase/tests` in the corpus idiom (SET ROLE, named RAISE arms, RED-UNDER annotations): email change syncs; unchanged email does not write; sanitize GUC on -> no sync; and, if D-07 revokes, `authenticated` cannot UPDATE `profiles.email`. Update every census a new file or arm moves. The test must be shown able to fail: neuter the trigger, see RED, restore from a byte backup (never git checkout/restore/stash).
- **D-09** The review step adds migration-reviewer and rls-policy-auditor, both required clean before merge.
- **D-10** Nothing is applied to TEST or PROD by hand. `supabase-migrate.yml`'s apply-test then PROD apply on merge handles it; every migration review happens before merge.
- **D-11** The ROADMAP goal's "never a direct write" refers to the auth email (`auth.users`). The trigger is the sync mechanism for the derived `profiles.email` copy. Option (b), an app-side write in `/auth/callback`, stays ruled out.
- **D-12** Supabase dashboard settings are NOT code and this phase changes none of them. D-05 keeps the UI copy correct under either double-confirm setting. A rejected redirect allow-list is a manual UAT check, not a code path.

### Claude's Discretion
- Component name and file (for example `src/components/auth/AccountEmailSection.tsx`), its exact layout, and whether the form opens inline or behind a "Change email" button, within UI-SPEC.md.
- Migration filename and function name, following repo timestamp naming.

### Deferred Ideas (OUT OF SCOPE)
- Refactoring transactional send routes to read the auth email instead of `profiles.email`.
- Showing the email in the sidebar or top bar (D-03).
- Whether the `org_invites_*` policies actually error for `authenticated` because they read a column it cannot SELECT.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are assigned (ROADMAP: "Requirements: TBD"). The planner maps plans to decisions D-01..D-12 instead.
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- AGENTS.md: "This is NOT the Next.js you know" - read the relevant guide in `node_modules/next/dist/docs/` before writing Next code. Installed: next 16.4.2 [VERIFIED: node_modules/next/package.json:3]. This phase adds no new Next API (a client component fed props by an existing `force-dynamic` server page); docs dir exists at `node_modules/next/dist/docs/{01-app,02-pages,03-architecture,04-community}`.
- Which-database rule: the Supabase CLI here is linked to PROD. Never run `supabase db push`, `db reset --linked`, `--db-url`. Do not connect to TEST or PROD from research or from executors for this phase (D-10).
- CHANGELOG entry + `VERSION`/`package.json` byte-equal 4-digit bump in the ship commit; never `npm version`; never write the CI-skip tokens in a commit or PR body.
- DESIGN.md governs all UI; UI-SPEC.md is the approved contract for this one.
- TODOS.md: LOW/Info survivors are not booked; a shipping phase deletes the TODOS entries it closes. Review rounds: code-reviewer + silent-failure-hunter + (this phase, D-09) migration-reviewer + rls-policy-auditor.
- Data-integrity gates must be shown able to fail (neuter, see RED, restore from a byte backup). Always `grep -a`. A new supabase/tests file or arm moves several censuses (section below lists them).
- No AI authorship trailers in commits (founder memory 2026-10-20) even though a harness reminder suggests them; the user rule takes precedence.
- Subagents: never act on background work before its completion notification; agents share the git index, so use explicit `git add` paths.

## Summary

The UI half is small and fully specified by CONTEXT and UI-SPEC. The facts the planner still needs are all on the SQL side. The latest `handle_new_user` is `20260520222848_lock_profile_role_at_signup.sql` and the latest `sanitize_user` is `20260827130000_sanitize_user_revoke_strategy_shares.sql`; nothing later redefines either (grep across all 325 migration files). The new trigger never replaces either function, so the re-base duty is met by citing both and changing neither. `auth.users` carries exactly one trigger today (`on_auth_user_created`, created in `20260405061912_rls_policies.sql:82`), so the new trigger is the first AFTER UPDATE one and has no in-repo twin; the closest style template for a trigger function plus hardening is `20261117120000_mt5_server_clock_readings.sql`.

D-07 is provable at HEAD: a re-grep of `src/` and `analytics-service/` finds no client or user-session writer of `profiles.email`. The two client writers (`ProfileForm.tsx`, `OnboardingWizard.tsx`) omit `email`; the two `email` writers are `admin.from("profiles").upsert` in `/api/admin/partner-import` (service_role); and no invoker SQL function sets it (only `sanitize_user` NULLs it, SECURITY DEFINER). The column grant is a COLUMN-level grant (`GRANT UPDATE("email") ON TABLE "public"."profiles" TO "authenticated"`), so a column `REVOKE UPDATE (email)` really removes it, unlike the table-level case the 20260529150000 header warns about. Neither `test_profiles_privileged_columns_locked.sql` nor pg-lane fixture 28 asserts the email column grant, so the revoke moves neither.

The expensive part is the census tail of adding a gate file: a new `supabase/tests` file with the `TEST FAILED (` idiom and no `RED-UNDER` is classed `pending` by the runner, so the new gate must be annotated, which moves FILES_FLOOR/ARMS_FLOOR and about seven pinned assertions. The previous gate addition (commit `357232aff`, Phase 155.1 plan 05) is the exact precedent and its file list is reproduced below.

**Primary recommendation:** ship one migration (new trigger function + trigger + `REVOKE UPDATE (email)`, no `DO` block that reads application tables, plus a `down/` rollback), one new fully-annotated gate file modelled on `test_profiles_privileged_columns_locked.sql` / `test_mt5_server_clock_readings.sql`, and the UI section; then let the failing census tests drive the pin updates.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Show sign-in email | Frontend Server (SSR) | Browser | `profile/page.tsx` already calls `auth.getUser()`; email passed as a prop, never read from `profiles` (D-02) |
| Request an email change | Browser / Client | Supabase Auth | `supabase.auth.updateUser` from the browser client; the app never writes `auth.users` |
| Confirm the change | Supabase Auth + Frontend Server (route handler) | - | Email link -> `/auth/callback` (`exchangeCodeForSession`) -> redirect to `next` |
| Pending-change display | Frontend Server (SSR) | Browser | `user.new_email` read server-side on every load; client holds only the just-sent state |
| `profiles.email` sync | Database | - | AFTER UPDATE OF email trigger on `auth.users` (D-06/D-11), covers dashboard edits too |
| Block client writes to `profiles.email` | Database (privileges) | - | Column REVOKE (D-07); no app code change |

## Standard Stack

No new libraries. Reuse only:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/auth-js` | 2.118.0 [VERIFIED: node_modules/@supabase/auth-js/package.json:3] | `updateUser(attributes, options?)`; `User.new_email?: string` [VERIFIED: node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:410]; `emailRedirectTo?: string` [VERIFIED: same file :562] | Already the project client |
| `next` | 16.4.2 | Server page, route handler | Already installed |
| vitest + @testing-library/react | repo versions | Component and route tests | Existing patterns below |
| PostgreSQL 16 (Homebrew) | `/opt/homebrew/opt/postgresql@16/bin` [VERIFIED: `bash scripts/pg-lane/run.sh --print-pgbin`] | pg-lane gate runs | Existing lane |

**Installation:** none. **Package Legitimacy Audit:** no external packages are installed by this phase, so the gate has nothing to audit (Packages removed: none; flagged SUS: none).

## Architecture Patterns

### System Architecture Diagram

```
Browser (Account tab)                    Supabase Auth (GoTrue)                 Postgres
 AccountEmailSection --updateUser({email}, {emailRedirectTo})--> stores new_email, mails link(s)
        ^                                         |  (user clicks link)
        |                                         v
 /profile?tab=account  <--302-- /auth/callback?next=%2Fprofile%3Ftab%3Daccount&code=...
        ^                         route.ts: exchangeCodeForSession -> redirect(new URL(safeNext, req.url))
        |                                         |
 profile/page.tsx (SSR) <--getUser(): email, new_email--   GoTrue UPDATE auth.users SET email = new
                                                                   |  AFTER UPDATE OF email
                                                                   v
                                          sync trigger fn (SECDEF) -> UPDATE public.profiles SET email = NEW.email
                                          skipped when quantalyze.sanitize_in_progress = 'on'
```

### Recommended file set
```
supabase/migrations/20261119HHMMSS_sync_profile_email_from_auth.sql   # trigger fn + trigger + REVOKE (name at discretion; must sort after 20261117120000)
supabase/migrations/down/20261119HHMMSS-rollback.sql                   # repo convention, 67 files exist
supabase/tests/test_profiles_email_sync.sql                            # new annotated gate
src/components/auth/AccountEmailSection.tsx (+ .test.tsx)
src/components/auth/ProfileTabs.tsx, src/app/(dashboard)/profile/page.tsx   # new props
src/app/auth/callback/route.test.ts                                    # + next=/profile?tab=account pin
```

### Pattern 1: migration shape (follow `20261117120000_mt5_server_clock_readings.sql`)
- No `BEGIN`/`COMMIT` (migration-reviewer invariant 14; Supabase wraps) and `SET LOCAL lock_timeout = '3s';` [VERIFIED: 20261117120000_mt5_server_clock_readings.sql:84-96]. Note `20260827130000` uses explicit `BEGIN;/COMMIT;`; the newer file is the convention to copy.
- Function: `CREATE OR REPLACE FUNCTION public.<name>() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog`. `handle_new_user` is pinned `SET search_path = public, pg_catalog` [VERIFIED: 20260520222848_lock_profile_role_at_signup.sql, last line of the function: `$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;`]. Schema-qualify `public.profiles`.
- Hardening: `REVOKE ALL ON FUNCTION public.<name>() FROM PUBLIC, anon, authenticated;` [VERIFIED: 20261117120000...sql:255]. Supabase default privileges auto-grant EXECUTE on new public functions to anon/authenticated/service_role (this is why `handle_new_user` shows `GRANT ALL ... TO "anon"` at baseline.sql:18309-18311). Revoking is safe for a trigger function because EXECUTE is checked when the trigger is created, not when it fires [ASSUMED: PostgreSQL CREATE TRIGGER docs; the pg-lane gate arm below proves it empirically]. Optionally end with `PERFORM public._assert_no_public_execute('public.<name>()')` (helper from `20260515205431_sec_def_public_execute_guard.sql:70`; it reads `pg_proc`, a catalogue, so the data-dependence lint does not refuse it).
- Trigger: `DROP TRIGGER IF EXISTS ... ON auth.users; CREATE TRIGGER ... AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.<name>();` The only existing auth.users trigger is `on_auth_user_created AFTER INSERT ... EXECUTE FUNCTION handle_new_user()` [VERIFIED: 20260405061912_rls_policies.sql:81-83]. The `postgres` migration role can create a trigger on `auth.users` (that migration is the proof).
- Body (D-06): `IF current_setting('quantalyze.sanitize_in_progress', true) = 'on' THEN RETURN NEW; END IF; IF NEW.email IS DISTINCT FROM OLD.email THEN UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id; END IF; RETURN NEW;`. The `, true` missing-ok form is the repo's own idiom for the GUC [VERIFIED: baseline.sql:4798 `IF current_setting('quantalyze.sanitize_in_progress', true) = 'on' THEN`] and `sanitize_user` sets it with `set_config(..., 'on', true)` (transaction-local) [VERIFIED: 20260827130000_sanitize_user_revoke_strategy_shares.sql: `PERFORM set_config('quantalyze.sanitize_in_progress', 'on', true);`]. Use ONE guard (the function-body IF). Do not also add a `WHEN (OLD.email IS DISTINCT FROM NEW.email)` clause: two redundant guards mask each other and the "unchanged email does not write" arm could not bite when one is neutered.
- Why the trigger does not fight the profiles triggers: the function is SECURITY DEFINER, so `current_user` inside is the owner (`postgres`); `reject_sentinel_writes` returns early unless `current_user IN ('authenticated','anon')` [VERIFIED: baseline.sql:9513-9518] and `prevent_profile_privileged_change` returns early for `postgres` and is `UPDATE OF` the six privileged columns only, which `email` is not [VERIFIED: 20260529150000_lock_profile_privileged_columns.sql:104-106 and baseline.sql:16144].
- `profiles.email` has no UNIQUE constraint or index (only `profiles_pkey`, `idx_profiles_allocator_status`, `idx_profiles_tenant_id`) [VERIFIED: baseline.sql:15284, 15764, 15768 and CREATE TABLE at 13314-13339], so the sync UPDATE cannot raise a unique violation that would abort GoTrue's own transaction.
- Revoke (D-07): `REVOKE UPDATE (email) ON public.profiles FROM authenticated;`. Effective because the current grant is column-level: baseline.sql shows `GRANT UPDATE("email") ON TABLE "public"."profiles" TO "authenticated";` [VERIFIED: baseline.sql:18869] and 20260529150000 §1a revoked the table-level UPDATE and §1b re-granted a column list that includes `email` [VERIFIED: 20260529150000_lock_profile_privileged_columns.sql:73 and :77-79 `GRANT UPDATE ( id, display_name, company, description, email, telegram, ...`]. No later migration re-grants (grep of `GRANT UPDATE|REVOKE UPDATE` on profiles across all migrations returns only 20260512182319 and 20260529150000). Post-condition probe for the migration (catalogue-only, allowed by the lint): `has_column_privilege('authenticated','public.profiles','email','UPDATE')` is false.
- Data-dependence lint: refuses only an anonymous `DO` block that reads an application-schema relation AND raises under a condition derived from the read (R1-R5) [VERIFIED: scripts/lint-migration-data-dependence.mjs header]. There is NO opt-out marker. A self-verifying `DO` block that reads `pg_proc`/`pg_trigger`/`pg_attribute`/`information_schema` only is fine; do not read `public.profiles` rows. Commands: `node scripts/lint-migration-data-dependence.mjs --self-test` (passes here: "5 refusals, red+green each") and `node scripts/lint-migration-data-dependence.mjs`.
- No backfill: F-3 measured 0 of 38 PROD profiles differ; a backfill would also be a data-writing step that behaves differently on empty TEST.

### Anti-Patterns
- Re-defining `handle_new_user` or `sanitize_user` in this migration (not needed; whole-body replaces carry transcription risk, see DRIFT-02 in `20260827130000`).
- A `DO $$ ... SELECT count(*) FROM public.profiles ... RAISE EXCEPTION` guard (refused by the lint, and fails on TEST which is data-empty).
- Writing `profiles.email` from `/auth/callback` (ruled out by D-11).
- Reading `profile.email` for display (D-02).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email change confirmation | A custom token table / own email send | `supabase.auth.updateUser({ email }, { emailRedirectTo })` | Goal text forbids a direct write; GoTrue owns double-confirm |
| Open-redirect guard | A second `next` validator | `safeNextPath` in `src/app/auth/callback/route.ts` | Already audited; test it, do not copy it |
| Pending-change state | A `pending_email` column | `user.new_email` from `auth.getUser()` | Auth is the source of truth |
| Email sync after change | App-side write | The D-06 trigger | Catches dashboard edits and the "final click has no app session" case |

## Common Pitfalls

### 1. Encoded `next` and the allow-list
`safeNextPath` receives `url.searchParams.get("next")`, which URLSearchParams has already percent-decoded, so `next=%2Fprofile%3Ftab%3Daccount` arrives as `/profile?tab=account`. It starts with `/`, not `//`, not `/\`, and char[1] is a letter, so every guard passes; `new URL("/profile?tab=account", req.url)` keeps the query [VERIFIED: src/app/auth/callback/route.ts, `safeNextPath` and the final `NextResponse.redirect(new URL(safeNext, req.url))`]. The unencoded form in D-04's literal text would ALSO arrive intact for `next` only because `?` inside a query value is legal, but UI-SPEC pins `encodeURIComponent`, so use it. Whether Supabase's redirect allow-list matches a URL with a query string is NOT testable here: UAT item.
### 2. Double-confirm first click may not reach the callback with a `code`
Under "Secure email change" the first confirmation is not final. What GoTrue appends to `redirect_to` after that first click (it may carry no `code`/`token_hash`) is [ASSUMED]; the callback then falls to `loginRedirect(req, "Missing verification parameters")` and the user (who IS signed in) lands on `/login?error=...`. Not a code change in this phase's scope (D-12), but the plan should list it as a UAT observation with both settings and the executor should not "fix" the callback speculatively. The PENDING copy in UI-SPEC is still true in either case.
### 3. Gate file with no annotation is `pending` and reds `sql-mutation`
`classifyGateIdiom` returns `pending` for a file whose `RAISE EXCEPTION` carries `TEST FAILED (` and has no `RED-UNDER` [VERIFIED: scripts/mutation-runner/parse.mjs `classifyGateIdiom`]. Runner today prints `pending: 0 idiom file(s)` and `coverage: files 83/110`, `arms: 0/891/0` in `--parse-only` [VERIFIED: ran `node scripts/mutation-runner/run.mjs --parse-only` this session]. Annotate every arm.
### 4. Raises outside the identity idiom make a file `unreachable`
A new file whose raises do not carry `TEST FAILED (` is classed `unreachable` and printed by name (the corpus had 27). That is allowed but unfalsifiable by the runner, which contradicts D-08. Use `TEST FAILED (<arm>):` raises.
### 5. A real-GoTrue stack differs from the pg-lane stub
On the local Supabase stack (`sql-tests` / `frontend-local-stack`) `auth.users` is the real table and `handle_new_user` fires on insert; on the pg-lane it is a fixture stub. The gate must pass on BOTH. Seed users exactly as `test_profiles_privileged_columns_locked.sql` does (INSERT into `auth.users (id, instance_id, email, created_at, updated_at, raw_user_meta_data)`; the trigger creates the profile).
### 6. Idempotent re-run
`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER` (the convention in 20260520222848 and 20260529150000).
### 7. TEST is data-empty, shared and applied first
`apply-test` runs before PROD; the migration must apply on an empty `profiles`. The trigger/REVOKE do not read rows, so it does.

## Writer proof for D-07 (re-proved at HEAD 423eb6f83)

Every writer of `profiles.email` found. None uses the `authenticated` grant:

| # | Writer | Role | Evidence |
|---|--------|------|----------|
| 1 | `admin.from("profiles").upsert({ id, email: row.manager_email, ... })` | service_role | src/app/api/admin/partner-import/route.ts:707-716 |
| 2 | `admin.from("profiles").upsert({ id, email: row.allocator_email, ... })` | service_role | src/app/api/admin/partner-import/route.ts:795-806 |
| 3 | `handle_new_user` INSERT (id, display_name, email, role) | SECDEF/owner | 20260520222848_lock_profile_role_at_signup.sql |
| 4 | `sanitize_user` `UPDATE profiles SET ... email = NULL` | SECDEF, service_role-only EXECUTE | 20260827130000...sql |
| 5 | cleanup self-test `INSERT INTO public.profiles (id, display_name, email, role)` inside a migration DO block | migration owner, rolled back | 20260713120000_cleanup_abandoned_wizard_drafts.sql:188 |
| 6 | test helpers `admin.from("profiles").update({ email })` | admin client | src/__tests__/retention-crons.test.ts:368,455,579,677 |

Client (user-session) `profiles` updates, all email-free: `ProfileForm.tsx` update payload is `display_name, company, description, telegram, website, linkedin` [VERIFIED: src/components/auth/ProfileForm.tsx:40-48]; `OnboardingWizard.tsx` is `company, telegram, website` [VERIFIED: src/components/auth/OnboardingWizard.tsx:47-52]. Other `.from("profiles").update` hits are admin routes writing `preferences_updated_at`, `allocator_status`, `manager_status`. SQL side: every `UPDATE profiles` in migrations (11 files) sets non-email columns or is `sanitize_user`; `20260407164606_perfect_match.sql:37` and `20260530120000_admin_role_mutate.sql` set `is_admin`. `INSERT`/`DELETE` on profiles are revoked from authenticated, so no upsert path exists for a user session. Also no writer in `analytics-service/`, `e2e/`, `tests/` (grep for email + update/upsert/insert/PATCH found none). Conclusion: **the revoke is provable; do it in the same migration** (D-07 condition met). The executor re-runs the grep and pastes the output into the plan SUMMARY/REVIEW: `grep -rnE "\.from\(\s*[\"'\`]profiles[\"'\`]\s*\)" src analytics-service --include='*.ts' --include='*.tsx' --include='*.py' -A8 | grep -E "\.(update|upsert|insert)\("` and `grep -nE "UPDATE\s+(public\.)?profiles" supabase/migrations/*.sql`.

Tests pinning profiles column grants that the revoke could move: `supabase/tests/test_profiles_privileged_columns_locked.sql` asserts (1) a `display_name`/`company` self-edit still works and (2) six privileged columns are refused; it makes NO assertion about the `email` grant [VERIFIED: read in full]. Its RED-UNDER-SETUP lists fixtures 01,02,07,10,12,28 and migrations 20260405061912, 13 (fixture), 20260512182319, 20260529150000, so a new migration is not applied there and cannot move it. `scripts/pg-lane/fixtures/28-fixture-profiles-privileged-columns.sql` only adds stand-in columns (`created_at, preferences_updated_at, tenant_id, manager_status, allocator_status`), no grant assertion [VERIFIED: read in full]. Other `has_column_privilege` users (`test_api_keys_*`, `test_btcusdview_native_balance`, `test_strategy_analytics_trade_fetch_provenance`, `test_strategies_anon_grants`) concern other tables. Net: nothing existing moves; the new gate owns the email-grant assertion.

## SQL self-test idiom (D-08)

- Closest templates: `test_profiles_privileged_columns_locked.sql` (seed an `auth.users` row, forged `request.jwt.claims`, `SET LOCAL ROLE authenticated`, `BEGIN ... EXCEPTION WHEN OTHERS THEN v_raised := true`, `RESET ROLE`, whole file in `BEGIN; ... ROLLBACK;`) and `test_mt5_server_clock_readings.sql` (24 arms, `RED-UNDER:` prose + `RED-UNDER-M:` twin, final `RAISE NOTICE 'ALL 24 ARMS EXECUTED (...)'` sentinel). `test_handle_new_user_role_allowlist.sql` is the only existing auth.users-trigger gate but carries no RED-UNDER, so it is not a good annotation template.
- Annotation grammar: a prose `-- RED-UNDER: <claim>` line, immediately followed by `-- RED-UNDER-M: {"arm":"<id>","apply":[{"kind":"edit","file":"<migration or fixture path>","find":"<exact text>","replace":"<mutated text>","occurrences":1}]}`; markers count only at comment-line start; a file-level `-- RED-UNDER-SETUP: {"apply":[<fixture and migration paths in order>]}` tells the lane what to load; the runner requires the FIRST `TEST FAILED (...)` raised under the mutation to name that arm [VERIFIED: supabase/tests/test_profiles_privileged_columns_locked.sql header and scripts/mutation-runner/GRAMMAR.md]. Arms to author (each its own `TEST FAILED (<id>)` raise and its own twin):
  1. change syncs: UPDATE `auth.users` email as postgres, `profiles.email` equals the new value. Twin: neuter the trigger body (e.g. edit the `UPDATE public.profiles SET email` line out of the migration).
  2. unchanged email does not write: set `profiles.email` to a marker via postgres, `UPDATE auth.users SET email = email`, marker survives. Twin: edit `IS DISTINCT FROM` to `IS NOT NULL`-style always-true.
  3. GUC on suppresses: `set_config('quantalyze.sanitize_in_progress','on',true)` then change auth email, `profiles.email` unchanged. Twin: remove the GUC early-return. Also an arm with the GUC absent proves the skip is conditional (positive control).
  4. revoke bites: `has_column_privilege('authenticated','public.profiles','email','UPDATE')` false AND `SET LOCAL ROLE authenticated; UPDATE public.profiles SET email = 'x' WHERE id = v_uid` raises. Twin: delete the REVOKE line (note: the pg-lane setup must load 20260529150000 so the column grant exists to be revoked, otherwise the arm is vacuous).
  5. authenticated can still edit `display_name` (positive control that the revoke is narrow).
  6. function hardening: not executable by anon/authenticated, `prosecdef`, `proconfig` carries the pinned `search_path` (catalogue read, mirrors arms 9b-9d of the server-clock gate).
  The setup list should mirror `test_profiles_privileged_columns_locked.sql`'s plus the new migration last. `scripts/pg-lane/fixtures/01-fixture-core.sql` supplies the `auth.users` stub; confirm the stub's column set allows `UPDATE ... SET email` and that the trigger fires on it when you author the file.
- Raise only via `RAISE EXCEPTION 'TEST FAILED (<id>): ...'` so the file is idiom (not `unreachable`); end with a sentinel notice only if you also take on the ci.yml sentinel census (optional, see below).

### Every census a new migration plus one new gate file moves (precedent: commit 357232aff, Phase 155.1 plan 05, 33 files)

Run each, read the failure, update the pin, and add a dated CURRENCY note in the house style. Authoritative pins first (all [VERIFIED] present at HEAD this session):

| # | File | What moves | Evidence at HEAD |
|---|------|-----------|------------------|
| 1 | `scripts/mutation-floors.mjs` | `FILES_FLOOR` 83 -> 84; `ARMS_FLOOR` 891 -> 891 + (new twinned arms); `WAIVED_CEILING` stays 0 | :1363, :3480, :3594; `--parse-only` prints `coverage: files 83/110`, `arms: 0/891/0` |
| 2 | `src/__tests__/mutation-annotation-parser.test.ts` | `armsSeen`, `stepsSeen`, `needles.length` (+1 step per twin edit), `corpus.filesTotal` 110 -> 111, `corpus.filesAnnotated` 83 -> 84, and the by-name annotated-file list gains the new file | precedent diff above |
| 3 | `src/__tests__/mutation-runner-floors.test.ts` | independent re-derivation of annotated/total; fails if floor is stale-low | read header; precedent changed 63 lines |
| 4 | `src/__tests__/gate-family-meta.test.ts` | the registry strings `"scripts/mutation-floors.mjs :: FILES_FLOOR=83"` / `ARMS_FLOOR=891` must be re-typed with the new values | precedent diff |
| 5 | `src/__tests__/lint-sql-gates.test.ts` | `expect(res.out).toMatch(/scanned 110 file/)` -> 111 | precedent diff |
| 6 | `scripts/lint-sql-gates.mjs` itself | no list to edit; run `node scripts/lint-sql-gates.mjs` (7 rules) and fix findings in the new file (self-test passes: "7 rules, red+green each") | ran self-test |
| 7 | `scripts/lint-app-guc.mjs` `LINEAGE_ALLOWLIST` | NO change: `DETECT_RE` matches `current_setting(` followed by `'app.`; this phase reads `quantalyze.sanitize_in_progress`, which is not `app.` | read `DETECT_RE` text; confirm with `node scripts/lint-app-guc.mjs --self-test && node scripts/lint-app-guc.mjs` |
| 8 | `scripts/baseline-content-drift-check.mjs` `COMPARED_FLOOR` (136 at the precedent) | +1 for the new public function, if `npm run schema:functions` adds it to `supabase/schema/functions/` | precedent: 135 -> 136 |
| 9 | `scripts/dump-sql-functions.ts` `NAME_SET_RATCHET` | add a dated `snapshot-only` row for the new function (its migration is not on PROD until apply), cleared by the next re-dump | precedent diff |
| 10 | `supabase/schema/functions/<name>.sql` | regenerate with `npm run schema:functions`; verify with `npm run schema:functions:check` | package.json:28-29 |
| 11 | `.github/workflows/ci.yml` + `src/__tests__/drift-check-scripts.test.ts` | ONLY if the new file declares an `ALL N ARMS EXECUTED` sentinel: `SENTINEL_FLOOR` 30 -> 31 and `ARMS_FLOOR` 504 -> 504+N (sum table in the comment), and the pinned `ci.yml still declares SENTINEL_FLOOR=30 and ARMS_FLOOR=504` assertions; `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` re-derives the sentinel set. Recommendation: skip the sentinel to avoid touching ci.yml, UNLESS the arms use `RETURN`/skip paths (then the sentinel is the anti-skip guard and is worth the census). The planner decides; both are valid | precedent diff; the values 30/504 are from the precedent commit, re-read ci.yml before editing |
| 12 | `supabase/schema/baseline-carried-migrations.txt` / `check-baseline-currency.mjs --replay-set` | NO edit: a migration newer than the dump is REPLAYED by the local-stack lane, not "carried". Run `node scripts/check-baseline-currency.mjs --replay-set` and confirm the new migration is printed on the `baseline-replay:` line. Do not re-dump | CLAUDE.md D-F note |
| 13 | `src/__tests__/vac08-ledger-dispositions.test.ts`, `scripts/vac08-ledger-baseline.txt`, `scripts/local-stack/sql-corpus-report.mjs`, `scripts/sql-gate-subset.mjs` | Not moved by the precedent commit. `vac08-ledger-baseline.txt` is EMPTY by design (shrink-only), so do not add a row; VAC-08 in `test-db-drift` will show the migration absent from TEST until `apply-test` runs after merge, which is the accepted by-construction behaviour | CLAUDE.md |
| 14 | `CHANGELOG.md`, `VERSION`, `package.json` | ship-commit bump and entry; name closed TODOS entries (none expected) | CLAUDE.md |

**Tool for the unknowns:** run `npx vitest run src/__tests__/mutation-annotation-parser.test.ts src/__tests__/mutation-runner-floors.test.ts src/__tests__/lint-sql-gates.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/drift-check-scripts.test.ts src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` after adding the gate; each failure message names the number to change. Then `grep -rnE "\b110\b|\b891\b|\b83\b" src/__tests__ scripts` for stragglers (the precedent found them this way).

### Local commands (all runnable on this host)
- Pg-lane works here: `bash scripts/pg-lane/run.sh --self-test` passed 6/6 including a real `pg_cron 1.6` load [VERIFIED: ran it]. Lane binaries: `/opt/homebrew/opt/postgresql@16/bin`.
- Static census: `node scripts/mutation-runner/run.mjs --parse-only` (ran; exit clean, "No static defects").
- One gate on the lane, mutation-checked: `node scripts/mutation-runner/run.mjs --file supabase/tests/<new>.sql` (usage line: `[--fixture-corpus] [--file <gate.sql>] [--arm <ID>] [--subset-from <list>] [--parse-only] [--self-test]`). `--arm <ID>` isolates one twin.
- Plain gate run (no mutation): `bash scripts/pg-lane/run.sh --workdir <scratch-dir> --apply <fixtures and migrations in the file's RED-UNDER-SETUP order> --gate supabase/tests/<new>.sql` [CLI contract from the script header]. Use the scratchpad dir for `--workdir`.
- A FULL runner run needs about 15 GB free (the floors comment says a previous host measured 9 GB free as too little); run subsets locally, CI `sql-mutation` runs the full corpus on the PR head.
- Linters: `node scripts/lint-sql-gates.mjs`, `node scripts/lint-migration-data-dependence.mjs`, `node scripts/lint-app-guc.mjs`, `npm run schema:functions:check`, `node scripts/baseline-content-drift-check.mjs`.
- The `sql-tests` job (private local Supabase stack, real GoTrue) needs docker + the Supabase CLI (`scripts/local-stack/run.sh up`); both exist here (`/usr/local/bin/docker`, `~/.local/bin/supabase`), but the CLI in this checkout is linked to PROD: only the `run.sh` wrapper may be used, never `supabase db push`/`--linked`. Treat the local-stack run as optional locally and rely on CI.
- Neuter-and-restore evidence (D-08): back up the migration with `cp -p` to the scratchpad, mutate via the runner (it mutates COPIES, so the repo file stays pristine) or by hand, run, restore from the byte backup, `cmp` it. Never `git checkout/restore/stash`.

## UI half

- `ProfileTabs` selects the tab with `parseTabParam(searchParams.get("tab"), isAllocator)`; `account` is in `VALID_TAB_KEYS` and is not allocator-only, so `/profile?tab=account` activates the Account tab for every role [VERIFIED: src/components/auth/ProfileTabs.tsx `ALL_TABS`, `ALLOCATOR_ONLY_KEYS = ["mandate","security"]`, `parseTabParam`]. Active tab is derived per render from `useSearchParams` (no local snapshot).
- The account panel is `<TabsContent value="account"><div className="max-w-xl"><DeleteAccountButton /></div></TabsContent>`; UI-SPEC changes it to `max-w-xl space-y-8` with the new section first and a `border-t border-border pt-8` around the delete block.
- `ProfileTabs` props are `{ profile, initialPreferences, isAllocator, exchanges }`; add optional `accountEmail: string | null` and `pendingEmail: string | null` (default null) so existing renders and `ProfileTabs.test.tsx` keep compiling. `profile/page.tsx` already holds `user` from `supabase.auth.getUser()` and is `export const dynamic = "force-dynamic"`; pass `accountEmail={user.email ?? null}` and `pendingEmail={user.new_email ?? null}` [VERIFIED: page.tsx top; `new_email?: string` on the auth-js `User` type]. `profile.email` is present in the `select("*")` row but must NOT be used (D-02).
- `ProfileTabs.test.tsx` mocks `next/navigation` (`useRouter` returns `replace, push, refresh`; `useSearchParams().get('tab')` driven by `searchParamsState.tab`) and `@/lib/supabase/client`; the new section mounts `createClient()` only on submit, but the existing mock `createClient: () => ({from, rpc, channel, removeChannel})` has no `auth`, so a submit-time call is unaffected while render-time use of `auth` would break these tests: only call `createClient()` inside the submit handler (the `ForgotPasswordForm` shape).
- Component test pattern to copy: `ForgotPasswordForm.test.tsx` hoists a `vi.fn()` and `vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { resetPasswordForEmail: mock } }) }))`, renders, `fireEvent.change` on `input[name="email"]`, clicks the button by text, then `await waitFor(...)` and asserts `mock.mock.calls[0]`. For this phase mock `auth.updateUser` the same way and add `next/navigation` `useRouter: () => ({ refresh })` to assert `router.refresh()` after success. Assert: render shows `data-testid="account-email"` text; same-as-current (trim + lowercase) makes NO `updateUser` call and shows `That is already your sign-in email.`; call args are `({ email: next.trim() }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/profile?tab=account")}` })`; success shows the pending panel naming the new address; Supabase error shows its message in `role="alert"` and keeps the input value; empty-message error shows the fallback; thrown error shows `Network error. Please try again.`; `pendingEmail` prop renders the pending panel on first render; null email shows `No sign-in email is set.`. `DeleteAccountButton.test.tsx` exists as the second sibling pattern (read it for its fetch/`role="status"` conventions before writing).
- Callback route test: `src/app/auth/callback/route.test.ts` already drives `GET` with `new NextRequest(url)` and mocks `@/lib/supabase/server` `createClient` with `exchangeCodeForSession`/`verifyOtp` spies. Add: `?code=pkce-abc&next=%2Fprofile%3Ftab%3Daccount` -> redirect `Location` equals `http://localhost:3000/profile?tab=account` (exact, query intact); same for the `token_hash=...&type=email_change` branch. Existing cases at :91, :136, :147, :171 show the shape (open-redirect negatives already pinned).
- Next docs: nothing new is used. Server component reads user via the existing `await createClient()` + `getUser()`; client component receives plain props. No `cookies()`/caching change. If the executor adds any Next API, read the matching guide under `node_modules/next/dist/docs/01-app` first (AGENTS.md).

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Derived `profiles.email` set once at signup | D-06 trigger keeps it in step with `auth.users.email` | Seven send routes and the `org_invites_*` policies stop seeing a stale address after a change |
| Table-wide column write on profiles | Column allowlist grant (20260529150000) plus D-07 removing `email` | A user can no longer self-set the address the invite policies match |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | EXECUTE on a trigger function is checked at CREATE TRIGGER, not at fire time, so revoking it from anon/authenticated cannot break the trigger | Pattern 1 | The sync would silently fail for GoTrue's role; the gate's arm 1 (run through the pg-lane as the superuser) would NOT catch it, so also run arm 1 via the local-stack lane in CI. Mitigation: the pg-lane gate runs as superuser and so cannot prove this; either (a) skip the REVOKE of EXECUTE for the trigger function (leaving the Supabase default grants, as `handle_new_user` does, baseline.sql:18309-18311 and its 20260409133655 header "trigger-only, benign": direct calls fail with "record new is not assigned yet"), or (b) keep the REVOKE and require the gate arm to also pass on the local-stack lane (real `supabase_auth_admin`-style roles) in CI. Planner decides; (a) is the zero-risk choice, (b) matches the server-clock precedent |
| A2 | Under double-confirm the first link click redirects to `redirect_to` without `code`/`token_hash`, hitting "Missing verification parameters" | Pitfall 2 | A UX dead-end on first click; handled as UAT, no code claimed |
| A3 | Supabase's redirect allow-list accepts a `redirect_to` carrying a query string | Pitfall 1 | Falls back to Site URL; D-12 already routes this to manual UAT |
| A4 | GoTrue writes `auth.users.email` (not only `email_change`) on final confirmation, firing the new AFTER UPDATE OF email trigger | Architecture | Trigger would never fire; UAT on TEST after merge: change an email, read `profiles.email` count-only via the founder-authorized path |
| A5 | New migration timestamp only needs to sort after `20261117120000`, the latest file in this checkout | Pattern 1 | Phase 218 may land a migration first; the backdated-migration policy (`migration-policy.yml`) compares against the remote tip: pick a timestamp at ship time, after re-fetching main |

## Open Questions

1. **Sentinel or not?** Declaring `ALL N ARMS EXECUTED` adds ci.yml SENTINEL_FLOOR/ARMS_FLOOR and three test pins to the census. Recommend the sentinel only if any arm can return early. Planner decides.
2. **Does the `auth.users` pg-lane stub accept `UPDATE ... SET email` and fire the new trigger?** Read `scripts/pg-lane/fixtures/01-fixture-core.sql` when authoring; the existing role-allowlist/profile gates insert into the stub, updates are untried here.
3. **PROD "Secure email change" value** was not read (D-12); UAT must try both if the dashboard allows, else record which one was observed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + vitest | UI + census tests | yes | repo node_modules present (715 entries) | - |
| PostgreSQL 16 + pg_cron (pg-lane) | gate runs, mutation twins | yes | 16 at `/opt/homebrew/opt/postgresql@16/bin`, pg_cron 1.6 loaded in self-test | - |
| Docker | local-stack `sql-tests` lane | yes | `/usr/local/bin/docker` (not probed for running state) | rely on CI `sql-tests` |
| Supabase CLI | local-stack wrapper only | yes, linked to PROD | `~/.local/bin/supabase` | never `db push`/`--linked` |
| TEST / PROD DB | none | not used | - | D-10: CI applies on merge |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (jsdom for components), SQL gates via pg-lane, mutation runner |
| Config file | `vitest.config.ts`; `scripts/mutation-floors.mjs`; gate headers carry RED-UNDER-SETUP |
| Quick run command | `npx vitest run src/components/auth/AccountEmailSection.test.tsx src/app/auth/callback/route.test.ts src/components/auth/ProfileTabs.test.tsx` |
| Full suite command | `npm run lint && npm run typecheck && npm test` plus the SQL commands below |

### Decision -> Test Map
| ID | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| D-02/D-05 | email from prop, null-email copy, pending on load | component | `npx vitest run src/components/auth/AccountEmailSection.test.tsx` | Wave 0 |
| D-04 | updateUser args incl. encoded `emailRedirectTo` | component | same file | Wave 0 |
| D-05 | same-as-current guard, error, fallback, network error | component | same file | Wave 0 |
| D-04 | `next=/profile?tab=account` survives the callback (code and token_hash branches) | route | `npx vitest run src/app/auth/callback/route.test.ts` | exists; add cases |
| D-01 | account tab hosts the section above Delete, props plumbed | component | `npx vitest run src/components/auth/ProfileTabs.test.tsx` | exists; extend |
| D-06 | change syncs / unchanged no write / GUC skip | SQL gate | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_profiles_email_sync.sql` | Wave 0 |
| D-07 | `authenticated` cannot UPDATE `profiles.email`, display_name still editable | SQL gate | same | Wave 0 |
| D-07 | writer-proof grep clean | grep | commands in "Writer proof" | n/a |
| D-08 | gate can fail | mutation | runner reports every arm `RED (identity ok)`; plus a hand neuter-restore with `cmp` | Wave 0 |
| D-06 | migration passes lints | static | `node scripts/lint-migration-data-dependence.mjs && node scripts/lint-sql-gates.mjs && node scripts/lint-app-guc.mjs` | exist |
| census | pins updated | vitest | the six-file `npx vitest run` list in the census section | exist; edit |
| D-12 | allow-list, both double-confirm settings, first-click landing | manual UAT | after merge/apply on TEST by the founder | - |

### Sampling Rate
- Per task commit: the quick run command plus the lints relevant to the touched files.
- Per wave merge: the census vitest list, `node scripts/mutation-runner/run.mjs --parse-only`, `npm run schema:functions:check`.
- Phase gate: full vitest suite green, CI `sql-mutation` FULL green on the PR head SHA (bound to the head, with the expected check count), `sql-gate-lint` green.

### Wave 0 Gaps
- [ ] `supabase/tests/test_profiles_email_sync.sql` (annotated, all arms twinned)
- [ ] `src/components/auth/AccountEmailSection.test.tsx`
- [ ] new cases in `route.test.ts` and `ProfileTabs.test.tsx`
- [ ] census pin edits (table above)
- [ ] `supabase/migrations/down/<ts>-rollback.sql`

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth owns the email change and its confirm-by-email flow; the app never writes `auth.users` |
| V3 Session Management | yes | Existing cookie session; callback `exchangeCodeForSession`; no change |
| V4 Access Control | yes | Column REVOKE (D-07) closes the self-set of `profiles.email`; trigger function EXECUTE revoked from anon/authenticated; SECDEF with pinned `search_path` |
| V5 Input Validation | yes | Native `type="email"` plus trim/lowercase same-address guard; server validation is GoTrue's; `safeNextPath` open-redirect guard |
| V6 Cryptography | no | Tokens are GoTrue's |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Open redirect via `next` | Tampering | `safeNextPath` (tested; add the encoded-query case) |
| User self-sets `profiles.email` to match another's org invite | Spoofing/EoP | D-07 column REVOKE + gate arm |
| SECDEF trigger function called directly | EoP | REVOKE EXECUTE from PUBLIC/anon/authenticated; pinned `search_path = public, pg_catalog`; schema-qualified table |
| Trigger fights GDPR erasure | Integrity | GUC `quantalyze.sanitize_in_progress` early return; arm 3 |
| Email enumeration via change form | Info disclosure | Surfaced Supabase message is the contract in UI-SPEC; note GoTrue's own response to an already-registered address is not controlled here [ASSUMED] |
| Public repo | Info disclosure | No real addresses, ids or home paths in tracked text; fixtures use `@quantalyze.test` |

## Sources

### Primary (HIGH confidence, read this session)
- `supabase/migrations/20260520222848_lock_profile_role_at_signup.sql` (latest handle_new_user)
- `supabase/migrations/20260827130000_sanitize_user_revoke_strategy_shares.sql` (latest sanitize_user)
- `supabase/migrations/20260529150000_lock_profile_privileged_columns.sql`, `20260405061912_rls_policies.sql`, `20261117120000_mt5_server_clock_readings.sql`
- `supabase/schema/baseline.sql` (grants, triggers, indexes), `supabase/tests/test_profiles_privileged_columns_locked.sql`, `scripts/pg-lane/fixtures/28-*.sql`
- `scripts/lint-migration-data-dependence.mjs`, `scripts/mutation-runner/{parse,run}.mjs`, `GRAMMAR.md`, `scripts/mutation-floors.mjs`, `scripts/lint-app-guc.mjs`
- `src/app/auth/callback/route.ts` (+ test), `ProfileTabs.tsx` (+ test), `profile/page.tsx`, `ProfileForm.tsx`, `OnboardingWizard.tsx`, `ForgotPasswordForm.test.tsx`
- `git show 357232aff` (census precedent)
- `node_modules/@supabase/auth-js` types (new_email, emailRedirectTo), `package.json` versions

### Secondary / Tertiary
- WebSearch on double-confirm redirect behaviour returned no authoritative statement of the first-click landing (LOW); handled as A2/A3 and UAT.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (nothing new)
- SQL migration and writer proof: HIGH (definitions and grants read at source; A1 flagged)
- Census list: HIGH for items 1-5, 8-10 (precedent diff plus HEAD reads); MEDIUM for 11-13 (conditional, decide at authoring)
- Supabase hosted behaviour (double-confirm landing, allow-list): LOW, UAT

**Research date:** 2026-11-19
**Valid until:** 2026-11-26 for the census numbers (they move with every merged gate or arm: re-run `--parse-only` and re-read the floors at plan time); 30 days for the rest.
