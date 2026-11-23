# Phase 225: ONEACCOUNTONCE - Research

**Researched:** 2026-11-23
**Domain:** account identity on `api_keys` (Postgres unique index and marker trigger, Next route handlers, Python poll stamper), one-time PROD data deletion
**Confidence:** HIGH on code paths and the DB mechanics (read at HEAD, with one PG16 probe); MEDIUM on the PROD deletion checkpoint (designed from the FK graph in `supabase/schema/baseline.sql`, which the orchestrator must re-verify live); LOW only where tagged `[ASSUMED]`

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Copied from `225-CONTEXT.md` `## Implementation Decisions`. Founder rulings Q1-Q5 and the confirmed manifest are locked.

**Carried forward from Phase 167.1.2 CONTEXT (archived at .planning/milestones/v1.20-phases/167.1.2-*/167.1.2-CONTEXT.md)**
- D-01 (founder 2026-09-24, "Refuse a second key"): the refusal reuses the partial unique index `api_keys_user_exchange_venue_account_uniq`. No second index, because a duplicate index makes `pgConstraintName` ambiguous. The worker never disconnects or deletes a key on its own. Phase 225's Q5 ruling overrides the delete half, for same-owner duplicates only, as a one-time founder-confirmed operation (see the deviation record below).
- D-04: two members of one composite whose windows do not overlap are a key rotation (`composite_member`), not a duplicate. Unchanged. Composites are out of scope here.
- D-18 (founder 2026-09-27): a WORKING key is `is_active AND disconnected_at IS NULL AND (sync_status IS NULL OR sync_status NOT IN ('revoked','sign_in_failed','error'))`.
- D-23 (founder 2026-10-11, "Say so"): a key whose account matches one of the user's OWN unfinished drafts is refused with a message naming that draft ("finish or delete it first"). It is never a silent `deduped` that drops the new key. This is CONN-01. Out of scope: the same-wizard-session resume fence, which returns the caller's own session pair.
- D-25 (founder 2026-10-11, "Fix"): an MT5 key whose sign-in keeps failing never holds its account's holder slot; a working key on the same account takes it. This is MT5D-08.

**Failing holder vs the new refusal (Q1)**
- Admit the working key. The founder's 2026-11-23 answer: "Admit working key (Recommended)".
  - When the live same-owner key that holds an account is NOT working (D-18), a newly connected working key for that account is admitted and takes the slot (`venue_account_id`).
  - The failing key gives up the slot and is marked `duplicate` pointing at the working key, and is named on its key card. Nothing is auto-disconnected.
  - When the holder IS working, the new key is refused by name.
  - Reversibility: costly.

**MT5 identity includes the broker server (Q2, CONN-03)**
- Add a separate plaintext column. The founder's 2026-11-23 answer: "Separate server column (Recommended)".
  - The new nullable column is `api_keys.venue_server`, holding the normalised broker server text. `venue_account_id` stays the bare MT5 login.
  - Uniqueness moves to (user_id, exchange, venue_account_id, coalesce(venue_server, '')). The index keeps its name `api_keys_user_exchange_venue_account_uniq` and keeps both predicates: `venue_account_id IS NOT NULL` and live-only (`disconnected_at IS NULL`).
  - A key not yet backfilled matches on login alone, as today, so the half-done state errs toward refusing. (See Finding F-3: this sentence is true of the APP fences, not of the index. The plan must build the wildcard into the fences.)
  - Connect routes write the server from the request. The daily poll, which already decrypts the credentials, backfills older keys.
  - The backfill uses no data-reading `DO` guard; `scripts/lint-migration-data-dependence.mjs` refuses one.
  - Rollout runs in steps through the one serial migration lane: column first, then the writers and the backfill, then the index change.
  - The server name is stored in plaintext. Founder: yes, it is not a credential.
  - Reversibility: one-way. A separate column was chosen over rewriting `venue_account_id` because 155.2's account check (`docs/runbooks/mt5-parity/capture-keymap.sql`, `mt5_parity_report.report_account_matches`) hashes the bare login stored in `venue_account_id`.

**What the share link between two users is (Q3, ONCE-02, ONCE-04)**
- Same identity is the link. For two different users, an equal stamped identity (same exchange, same `venue_account_id`, same server for MT5) IS the share link. `src/lib/discovery/shared-account-partners.ts` already reads it that way.
  - There is no cross-owner marker. The `ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER` refusal stays, with no tenant-boundary change.
  - ONCE-04 therefore means: every live key's identity is stamped, so a shared login is always visible. A test drives the stamping in `account_identity.py` for that case.
  - Reversibility: costly.

**Composite add-key path (Q4)**
- OUT of scope, under the founder's milestone ruling F-2 ("Forget about conposites"). `add_wizard_composite_key` keeps writing no identity, and composite duplicates stay mark-only. No edit to `src/app/api/strategies/composite/add-key/route.ts` or to the composite RPC.

**Same-owner duplicates already stored (Q5, ONCE-03), a DEVIATION FROM THE STANDING DATA RULE**
- The founder's answer, 2026-11-23, verbatim: "Delete all duplicate keys. So same key in one accused twice. Delete also all associated factsheet, data etc. One key can be used over several accounts. Imagine one team sharing the key if their master account with several allocator. Of course each allocator should be able to generate a factsheet"
- Meaning: same-owner duplicates are DELETED (the duplicate key plus its associated strategies, factsheets and derived data). Cross-user sharing of one key or account stays fully supported and each user keeps their own factsheet.
- Deviation record: this explicitly overrides the standing rule "keep data; disconnect, never delete" (founder memory) and the "never deletes" half of D-01, for same-owner duplicates only. Recorded in CONTEXT and the ROADMAP `### Phase 225` section.
- How it runs: (1) a read-only PROD census produces an exact deletion manifest; (2) the founder confirms the permanent deletion before it runs; (3) it runs once, through existing product paths or RPCs where they exist (for example `delete_allocator_api_key`), respecting the deletion-cascade guards (`quantalyze.sanitize_in_progress` where applicable) and never inside a migration's data-reading `DO` block.
- Manifest confirmed (founder, 2026-11-23, "Yes, delete all (Recommended)"): exactly 13 same-owner duplicate keys (7 deribit, 1 mt5, 5 okx; all disconnected; 5 owners; no holder, no live key, no cross-owner key, none of 155.2's k1, k10 or k3) and the 2 strategies on them (1 published okx, 1 private mt5 on 155.2's k2), with all dependent rows. Key dependents at census: allocator_holdings 2470, csv_daily_returns 1599, compute_jobs 99, api_key_nav_marks 28, mt5_server_clock_readings 11, key_permission_audit 9. Strategy dependents at census: strategy_analytics 2, strategy_analytics_series 24, csv_daily_returns 272, trades 125, positions 9, position_snapshots 15, funding_fees 285, match_candidates 119, compute_jobs 57, reconciliation_reports 132, strategy_verifications 2.
- The deletion step re-runs the census immediately before deleting. If the set differs in any way (more keys, a key now live or a holder, a 155.2 key appearing), it STOPS and reports instead of deleting. The SUMMARY records before and after counts verbatim.
- Path: `delete_allocator_api_key(p_api_key_id, p_cascade_holdings => true)` per key, in the owner's context. Then the product's strategy-delete path for the 2 strategies, because `strategies.api_key_id` is ON DELETE SET NULL. Respect any cascade guards.
- Reversibility: one-way. Permanent deletion of PROD rows.

**Decided autonomously (CONTEXT)**
- Tests: an exchange key and an MT5 login are each refused for the same owner, and a different-owner test proves the cross-user share still connects with the identity link intact.
- MT5D-08: the working-holder rule lives in the stamper holder lookup and the stamp or marker swap in `analytics-service/services/account_identity.py`, using the D-18 predicate.
- Refusal copy: follow the existing `wizardErrors.ts` code and copy patterns, naming the existing key or draft by exchange plus nickname.
- Seam: the per-owner refusal is carried by create-with-key (wizard, draft arm included) and validate-and-encrypt (allocator Exchanges page); the composite path is excluded by Q4.

### Claude's Discretion
- How the census queries are shaped and in what order the deletion runs, within the confirmed manifest.

### Deferred Ideas (OUT OF SCOPE)
- Composite add-key identity stamping and refusal: out, under milestone ruling F-2.
- CONN-02 (rotated-password reconnect) and CONN-04 (orphaned-key copy): Phase 228 KEYANSWERS.
- Server-qualifying the cross-user readers (`shared-account-partners.ts`, the fingerprint `venue_norm`): HOLDINGSTRUTH reads, after S4 settles. Login-only grouping across two brokers over-groups, which is the safe direction.
</user_constraints>

<phase_requirements>
## Phase Requirements

Texts from `.planning/REQUIREMENTS.md` (lines 67, 135, 137, 171-174).

| ID | Description | Research Support |
|----|-------------|------------------|
| ONCE-01 | Connecting a key, or saving a draft, whose account identity matches a key the same owner already holds is refused with a named reason, in the wizard and in the API, for both an exchange key and an MT5 login. | The same-owner refusal already exists for live holders with a strategy (`VENUE_ALREADY_CONNECTED`, `KEY_ORPHANED`, `KEY_VENUE_ALREADY_CONNECTED`). What is new is the draft arm (CONN-01) and the Q1 carve-out for a failing holder. Sections F-1, F-2, "Per-owner refusal", "Validation Architecture". |
| ONCE-02 | The same account connected by two different users stays allowed and keeps its share link; a strategy-linked key that also sits in an allocator book is unaffected. | Index leads with `user_id`; every resolver read is `.eq("user_id", ...)`; `_find_live_holder` filters by `user_id`. The tests to pin it are in "Validation Architecture". |
| ONCE-03 | Every same-owner duplicate already stored on PROD is counted read-only and brought to the founder, and once the phase ships no strategy publishes another key's numbers under its own name. | Sections "ONCE-03 deletion checkpoint design" (census, single-transaction stop-on-difference delete, owner-context idiom, FK blockers) and Open Questions. |
| ONCE-04 | Two keys that share a login always carry a share link. | Under Q3 the link is equal stamped identity. Stamping coverage and its exclusions (sFOX, inactive keys, failed polls) are in "ONCE-04 coverage". |
| CONN-01 | Connecting a key that matches the user's own draft never answers a silent `200 deduped`. The answer names what was stored. | Four `deduped` emitters exist in `create-with-key/route.ts`; two are rewritten, two stay. Section F-2. |
| CONN-03 | MT5 account identity includes the broker server, so the same login on two servers never collides. The backfill uses no data-reading `DO` guard. | Sections F-3 through F-7 (column, writers, wizard RPC parameter, backfill reach, index, sequencing). The backfill CANNOT be SQL: the server lives only in ciphertext. |
| MT5D-08 | An MT5 key whose sign-in keeps failing cannot claim an account's holder slot. | Section F-8 (one service-role SECURITY DEFINER swap function shared by the connect routes and the stamper; marker-trigger ordering). |
</phase_requirements>

## Summary

The same-owner refusal at the database already exists and works: `api_keys_user_exchange_venue_account_uniq` makes a second live key on one (owner, exchange, account) a 23505, and both connect routes map it to a named 409. What this phase adds is narrower than the requirement text suggests: (1) the `venueMatch.kind === "draft"` arms stop answering a silent `200 deduped` (CONN-01); (2) a working key may take the slot from a failing same-owner holder (Q1 / MT5D-08), which needs an atomic multi-row write that neither PostgREST client can do, so one service-role SECURITY DEFINER function is required; (3) MT5 identity gains a server column and the unique index gains a `coalesce(venue_server,'')` member (CONN-03); (4) a one-time, founder-confirmed deletion of the 13 stored duplicates run by the orchestrator through MCP SQL (ONCE-03).

Four findings change what the plan must prescribe. (a) The index alone does NOT make a half-backfilled state "err toward refusing": under `coalesce(venue_server,'')` a NULL-server row and a server-stamped row with the same login do not collide (probed on PG16 below). The "login-only" behaviour for NULL must be built into the app fences, the stamper pre-check and the reconnect function. (b) The existing SQL gate that pins the index column list stays GREEN after the change and proves nothing (the expression member has attnum 0 and drops out of its join, probed). (c) The server backfill cannot be a SQL backfill: MT5 credentials sit in one ciphertext blob, so the poll is the only reader. (d) There is no product delete path for a non-draft strategy; the only strategy DELETE in `src/` is the wizard-draft route. The deletion step therefore runs `DELETE FROM strategies` under the owner's RLS policy, and its census must be driven from the FK graph, not from the manifest's table list (three tables block the delete; several cascade into other users' rows).

**Primary recommendation:** Ship in four serial steps through the one migration lane: migration A (column, `create_wizard_strategy` 13th parameter, swap function), then one code PR (writers, stamper backfill and swap, draft refusal, wizard copy), then a read-only backfill census, then migration B (index rebuild plus server-aware reconnect). The PROD deletion is an orchestrator-run checkpoint after the code ships and in the 155.2 freeze window the roadmap names; it is a single MCP transaction that asserts the confirmed manifest and aborts on any difference.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-owner uniqueness of live (exchange, account, server) | Database (unique index) | API route fence (cheap pre-validation refusal) | The index is the only race-proof backstop; the route fence exists to refuse before a charged Railway probe and to choose the named code. |
| Named refusal copy and code | API route (code + `strategy_name`) | Browser (`wizardErrors.ts` copy table, `ConnectKeyStep`) | The wire code is the contract; copy lives in one browser-side table. |
| Failing-holder takeover (slot swap) | Database (one SECURITY DEFINER function, service_role only) | Route (connect) and Python poll stamper (heal) | Needs one transaction across several rows with the marker trigger's ordering rules; PostgREST cannot do it. |
| MT5 server capture at connect | API route (request body `passphrase` slot) | Database (`create_wizard_strategy` parameter / direct INSERT) | The server is only in the request at connect; it must land in the same INSERT so the index backstops it. |
| MT5 server backfill for stored keys | Python poll (decrypts credentials) | none | Server exists only inside ciphertext; SQL cannot read it. |
| Identity stamping of stored keys (ONCE-04) | Python poll stamper | Connect routes (stamp at insert) | Daily poll already holds every live key's decrypted session. |
| D-18 working-holder rule | Database function + TS twin + Python twin | none | Four twins must agree (see "Verified in-repo values"). |
| One-time duplicate deletion | Orchestrator MCP SQL (single transaction) | Product RPC `delete_allocator_api_key`, owner RLS for strategies | Executors have no Supabase MCP; destructive PROD act must be auditable. |

## Standard Stack

No new packages are installed. Everything below already exists in the repo.

### Core
| Component | Version / locator | Purpose | Why standard here |
|-----------|-------------------|---------|-------------------|
| Postgres partial unique index `api_keys_user_exchange_venue_account_uniq` | `supabase/migrations/20260812083206_api_keys_venue_account_id.sql:465` | Per-owner account uniqueness | D-01: reuse it, never a second index |
| Marker trigger `api_keys_account_share_same_owner` | `supabase/migrations/20260925120000_api_keys_account_identity.sql:291` | Enforces same-owner, live, unmarked holder, no chains | The swap function must satisfy it |
| `pgConstraintName` | `src/lib/api/pgConstraintName.ts` | Maps a 23505 message to a constraint name (message only, never DETAIL) | Index name must not change |
| `account_identity.py` stamper | `analytics-service/services/account_identity.py` | Poll-time stamp, holder lookup, marker write, audit | Where MT5D-08 and the server backfill land |
| `working_holder_predicate` | `analytics-service/services/allocator_equity_derive.py` | Python twin of D-18 | Import it; never write a fifth copy |
| `isWorkingHolder` / `NOT_WORKING_SYNC_STATUSES` | `src/lib/account-share-note.ts` | TS twin of D-18 | Same |
| vitest, pytest, mypy strict, pg-lane, mutation runner | repo tooling | Gates | PROOF-01 uses them |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `coalesce(venue_server,'')` expression key (locked) | `UNIQUE ... NULLS NOT DISTINCT` over the real column | Same semantics on PG15+, keeps a real column in `indkey` so catalogue assertions are not vacuous. The founder's ruling spells `coalesce`; keep it, and write the catalogue assertion against `indexprs` (F-5). |
| 13th parameter on `create_wizard_strategy` (recommended) | A post-INSERT service-role UPDATE of `venue_server` | UPDATE is non-atomic: the row lands as `(login, '')`, so an existing `(login, 'A')` row does not collide at INSERT and the later UPDATE to `'A'` then 23505s with a half-created draft to compensate. The parameter makes the index the real backstop. |

**Installation:** none.

**Tooling versions measured on the research machine:** Node v25.8.1, Python 3.14.3, pytest 9.0.2, Supabase CLI 2.84.2, `psql` client 18.6, PostgreSQL 16.13 server binaries at `/opt/homebrew/Cellar/postgresql@16/` (used by `scripts/pg-lane/run.sh`). `analytics-service` baseline: `python3 -m pytest tests/test_account_identity_stamper.py -x -q` = 130 passed [VERIFIED: run this session]. `npx vitest run src/lib/account-share-note.test.ts src/lib/api/pgConstraintName.test.ts` = 35 passed [VERIFIED: run this session].

## Package Legitimacy Audit

No external packages are installed by this phase. **Packages removed due to [SLOP] verdict:** none. **Packages flagged as suspicious [SUS]:** none. The two banned packages in the project CLAUDE.md are not relevant to this phase.

## Project Constraints (from CLAUDE.md)

Extracted from the user's global `CLAUDE.md`, the project `CLAUDE.md` and `AGENTS.md`. The planner must verify compliance.

- **Which database am I on:** the CLI in this checkout is linked to PRODUCTION; `current_database()` is `postgres` on both projects. Before any statement that writes, run the marker query (`SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();`). NULL means re-set the marker, do not proceed.
- **Migrations auto-apply to TEST then PROD on merge with no human stop.** Every review (migration-reviewer, rls-policy-auditor) must be clean BEFORE merge. TEST holds the catalogue and no data.
- **No data-reading `DO` guard in a migration** (`scripts/lint-migration-data-dependence.mjs` refuses it with no opt-out). Self-verify is catalogue-only. If a migration lands and refuses on TEST, revert the merge; never edit `supabase-migrate.yml`.
- **Applied migrations are never edited.** Correct forward. Re-base `CREATE OR REPLACE` on the latest definition across all migrations (see "Verified in-repo values" for the latest bodies).
- **Any DROP + re-CREATE of `create_wizard_strategy` must re-issue `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` in the same migration** (header of `20260814120000_wizard_rpcs_revoke_authenticated.sql`, enforced by assertion 5h in `supabase/tests/test_api_keys_exchange_not_user_writable.sql`).
- **The skip-CI trailer tokens never appear in any commit message or PR body**, even to deny them. Every ship writes a CHANGELOG entry and moves `VERSION` and `package.json` as byte-equal 4-digit strings; never `npm version`.
- **TODOS.md holds open work only**: the ship deletes the `TODOS.md` entries it closes (here `167.1.2-MT5-FAILING-HOLDER`, `167.1.2-DRAFT-CLASH-SAYS-SO`, `L4105`) and names them in the CHANGELOG. LOW/Info review survivors are not booked.
- **`verification-drift` rules:** a VERIFICATION uses `verified_at_sha` + `drift_subjects`, never `covered_digest` / `covered_files`; never list `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` in `drift_subjects`.
- **Ship planning guard:** a ship branch must change nothing under `.planning`.
- **Never dispatch a `gsd-*` agent by hand; never `git checkout/restore/stash` on uncommitted work** (neuter and restore uses `cp` from a byte backup, then `cmp`).
- **Tests verify intent and must be able to fail** (neuter, see RED on the named arm, restore byte-exact, GREEN). `grep -a` always. New `supabase/tests` file or arm moves several censuses: grep them all. pytest only from `analytics-service/`; never `importlib.reload` in tests. CI runs mypy strict over `analytics-service/services routers models main*.py sentry_init.py` for every analytics-touching change.
- **Public repo:** no secrets, PROD ids, emails, home paths or account numbers in tracked text; never quote a credential-shaped literal; never quote a search pattern as proof of absence. This file follows that rule.
- **PROD:** reads and writes are authorized by the founder; ask-before-write applies to PROD writes via MCP, one query per call for reads. Executors have no Supabase MCP; the orchestrator runs PROD SQL. Prefer the product's own paths over hand SQL writes.
- **AGENTS.md:** Next.js here differs from training data; read `node_modules/next/dist/docs/` before writing route code. This phase edits existing route handlers only and adds no route file, so the files to read if in doubt are under `node_modules/next/dist/docs/01-app`.
- **DESIGN.md** governs any visual change (the key-card sentence in F-9).
- **Agent-gate hygiene:** the executor brief must name the mypy command and the pre-push checks.
- **Never annualize / invent data / no AI authorship attribution trailers** (founder memory): irrelevant to code here except the no-attribution rule for commits.

## Verified in-repo values

Quoted verbatim from files opened with `Read` this session (or from `grep -n` output of the quoted line). Every value used in a skeleton below appears here.

| Value | Source | Verbatim |
|-------|--------|----------|
| Current index definition | `supabase/migrations/20260812083206_api_keys_venue_account_id.sql:465-467` | `CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq` / `ON public.api_keys (user_id, exchange, venue_account_id)` / `WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL;` |
| Index name constant (TS) | `src/lib/api/pgConstraintName.ts:65-66` | `export const VENUE_IDENTITY_CONSTRAINT =` `"api_keys_user_exchange_venue_account_uniq";` |
| Index name constant (Py) | `analytics-service/services/account_identity.py:176` | `ACCOUNT_IDENTITY_UNIQUE_INDEX: Final = "api_keys_user_exchange_venue_account_uniq"` |
| Marker kinds CHECK | `20260925120000_api_keys_account_identity.sql:121` | `OR account_share_kind IN ('duplicate', 'composite_member'));` |
| Marker trigger firing | `20260925120000_api_keys_account_identity.sql:291-292` | `CREATE TRIGGER api_keys_account_share_same_owner` / `BEFORE INSERT OR UPDATE OF account_shared_with_api_key_id` |
| Trigger refusals | `20260925120000_api_keys_account_identity.sql:224-261` | `'ACCOUNT_SHARE_HOLDER_NOT_FOUND'` ERRCODE `'23503'`; `'ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER'` ERRCODE `'42501'`; `'ACCOUNT_SHARE_HOLDER_NOT_LIVE'` ERRCODE `'55000'`; `'ACCOUNT_SHARE_HOLDER_IS_MARKED'` ERRCODE `'23000'`; `'ACCOUNT_SHARE_KEY_IS_A_HOLDER'` ERRCODE `'23000'` |
| Trigger clears the kind with the holder | same file `:196-205` | `NEW.account_share_kind := NULL;` (when the holder is set NULL and the kind is left unchanged) |
| D-18 SQL twin | `supabase/migrations/20260927180000_working_holder_rule_d18.sql:183-184` | `IF v_is_active AND v_disconnected IS NULL` / `AND (v_sync_status IS NULL OR v_sync_status NOT IN ('revoked', 'sign_in_failed', 'error')) THEN` |
| D-18 TS twin | `src/lib/account-share-note.ts` | `export const NOT_WORKING_SYNC_STATUSES: ReadonlySet<string> = new Set(["revoked","sign_in_failed","error"])` (as three lines) and `isWorkingHolder(holder)` |
| D-18 Py twin | `analytics-service/services/allocator_equity_derive.py:354` | `NOT_WORKING_SYNC_STATUSES: frozenset[str] = frozenset({"revoked", "sign_in_failed", "error"})`; `def working_holder_predicate(key_row: Mapping[str, Any] \| None) -> bool:` |
| Create-with-key own codes | `src/lib/wizardKeyRosters.ts:108-125` | `"DRAFT_ALREADY_EXISTS", "DRAFT_SESSION_COLLISION", "VENUE_ALREADY_CONNECTED", "KEY_ORPHANED", "KEY_VENUE_ALREADY_CONNECTED", "KEY_REUSE_UNAVAILABLE", "RATE_LIMITED", ...` |
| Hand-typed 409 roster | `src/lib/wizardErrors.invariant.test.ts:2336-2343` | `const EXPECTED_409_CODES = ["DRAFT_ALREADY_EXISTS","DRAFT_SESSION_COLLISION","KEY_ORPHANED","KEY_REUSE_UNAVAILABLE","KEY_VENUE_ALREADY_CONNECTED","VENUE_ALREADY_CONNECTED",] as const;` |
| Wizard RPC signature (12 params) | `supabase/schema/functions/create_wizard_strategy.sql:150-163` | `p_wizard_session_id UUID,` / `p_venue_account_id TEXT DEFAULT NULL` ; pinned as `create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)` at `supabase/tests/test_api_keys_venue_identity_uniq.sql:73` |
| Wizard RPC api_keys INSERT | same dump `:290-301` | `attested_venue, venue_account_id` / `p_exchange, NULLIF(btrim(p_venue_account_id), '')` |
| Wizard RPC source migration (latest body) | `supabase/schema/functions/create_wizard_strategy.sql:5` | `-- source migration: 20260814120000_wizard_rpcs_revoke_authenticated.sql` |
| Reconnect source migration (latest body) | `supabase/schema/functions/reconnect_allocator_api_key.sql:5` | `-- source migration: 20260925120000_api_keys_account_identity.sql` ; body's refusal: `AND s.venue_account_id = v_venue_acct` / `RAISE EXCEPTION 'KEY_VENUE_ALREADY_CONNECTED'` |
| Delete RPC | `supabase/schema/functions/delete_allocator_api_key.sql` (source `20261104120000_drop_allocator_equity_snapshots.sql`) | signature `p_api_key_id uuid, p_cascade_holdings boolean DEFAULT false`; `IF v_owner IS NULL OR v_owner <> auth.uid() THEN RAISE EXCEPTION ... USING ERRCODE = '42501'`; grants `TO authenticated, service_role` (`20261104120000...sql:221-222`) |
| FK blockers on key delete | `supabase/schema/baseline.sql:16297` (allocator_holdings) | `... REFERENCES "public"."api_keys"("id") ON DELETE RESTRICT;` ; every other key dependent is `ON DELETE CASCADE`; `strategies_api_key_id_fkey` is `ON DELETE SET NULL` (`:16646`); `api_keys_account_shared_with_api_key_id_fkey` is `ON DELETE SET NULL` (`:16337`) |
| FK blockers on strategy delete | `supabase/schema/baseline.sql:16281-16282, 16515-16516, 16754-16756` | `allocation_events_strategy_id_fkey ... REFERENCES "public"."strategies"("id");` (no action); `match_decisions_original_strategy_id_fkey ... ON DELETE RESTRICT;` ; `verification_requests_legacy` `verification_requests_matched_strategy_id_fkey ... REFERENCES "public"."strategies"("id");` (no action) |
| Strategy delete RLS policy | `supabase/schema/baseline.sql:17510` | `CREATE POLICY "strategies_delete" ON "public"."strategies" FOR DELETE USING (("user_id" = "auth"."uid"()));` |
| Key delete guard | `supabase/schema/functions/enforce_api_keys_published_composite_integrity.sql` | `IF current_setting('quantalyze.sanitize_in_progress', true) = 'on' THEN RETURN OLD;` then refuses when the key is in `strategy_keys` of a `s.status = 'published'` strategy (`foreign_key_violation`) |
| Clock-readings cascade rule | `supabase/schema/functions/enforce_mt5_server_clock_readings_write_once.sql` | `IF pg_trigger_depth() > 1 THEN RETURN OLD;` (a direct DELETE is refused; the key-delete cascade is admitted) |
| Keymap ordinal | `docs/runbooks/mt5-parity/capture-keymap.sql:2` | `SELECT 'k' \|\| row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,` over `WHERE ak.exchange = 'mt5'` |
| Gate floors | `scripts/mutation-floors.mjs` | `export const FILES_FLOOR`, `export const ARMS_FLOOR`, `export const WAIVED_CEILING`. Read by symbol (`grep -nE '^export const (FILES_FLOOR\|ARMS_FLOOR\|WAIVED_CEILING)' scripts/mutation-floors.mjs`); never restate. |

## Architecture Patterns

### System Architecture Diagram

```
CONNECT (wizard)                          CONNECT (allocator Exchanges page)
POST /api/strategies/create-with-key      POST /api/keys/validate-and-encrypt
   |                                          |
   | 1 session fence: same wizard_session_id -> 200 deduped   (KEEP: same-session resume)
   | 2 MT5 only: resolveByVenueIdentity(user, exchange, login, server)        (pre-validateKey)
   |       |-- holder FAILING (D-18)  -> fall through (admit candidate)
   |       |-- holder WORKING + own draft      -> 409 NEW code naming the draft   (CONN-01)
   |       |-- holder WORKING + strategy       -> 409 VENUE_ALREADY_CONNECTED
   |       |-- holder WORKING + orphan         -> 409 KEY_ORPHANED
   |       '-- holder WORKING + composite      -> falls to race arm -> KEY_VENUE_ALREADY_CONNECTED
   | 3 validateKey -> encryptKey (Railway)  [ccxt identity known only here: same resolver, post-validation]
   | 4 INSERT (RPC create_wizard_strategy +p_venue_server | direct insert)
   |       |-- no failing holder: stamped INSERT; 23505 on the index -> race arm re-resolves (same answers as step 2)
   |       '-- failing holder:   INSERT with identity NULL, then swap function (below)
   v
 api_keys  (unique index: user_id, exchange, venue_account_id, coalesce(venue_server,''))
   ^                                    ^
   | marker trigger                     | swap_account_slot(new_key, failing_holder)   [service_role SECURITY DEFINER, ONE transaction]
   |                                    |    called by the route right after INSERT, and by the stamper
POLL (daily, per live key, analytics-service)
   _allocator_key_preflight -> decrypt -> Mt5Session{venue_account_id, server}
   stamp_account_identity(key_row, session)
      MT5: runs BEFORE the fetch;  ccxt: runs on the DONE path
        |-- already stamped: NEW -> backfill venue_server if NULL (server from the session)
        |-- unstamped: pre-check same-owner live holder with wildcard server; holder FAILING & this key WORKING -> swap;
        |              holder WORKING -> mark duplicate (today's path); no holder -> UPDATE stamps id (+server)
        '-- UPDATE 23505 on the index -> holder lookup -> same branch
   After any marker/swap change: enqueue derive_allocator_equity for the owner (existing behaviour)

ONE-TIME (orchestrator, MCP SQL, one transaction)
   marker query -> read-only census -> founder compares to the confirmed manifest
   -> BEGIN; assert census == manifest (RAISE aborts everything); per owner: set claims GUC + SET LOCAL ROLE authenticated;
      DELETE strategies (owner RLS) ; delete_allocator_api_key(key, true) ; RESET ROLE; enqueue recompose ; after-counts; COMMIT
```

### Recommended Project Structure (files that move)

```
supabase/migrations/        # A: column + create_wizard_strategy(13 params) + swap function (+ down file)
                            # B: index rebuild + reconnect_allocator_api_key re-base (+ down file)
supabase/tests/             # edit test_api_keys_venue_identity_uniq.sql (index arm, signature pins);
                            # new test_api_keys_venue_server.sql or new arms (column CHECK, behavioural, swap)
src/app/api/strategies/create-with-key/route.ts      # resolver (+holder health, +server, wildcard), draft arms, p_venue_server, swap call
src/app/api/keys/validate-and-encrypt/route.ts       # insert venue_server, holder pre-check, swap call
src/lib/wizardErrors.ts, src/lib/wizardKeyRosters.ts # one new code, copy, formatKeyError arm, rosters
src/lib/account-share-note.ts                        # the failing-marked-key sentence (F-9), if the founder confirms
src/lib/database.types.ts                            # api_keys Row/Insert/Update + create_wizard_strategy Args + new function
analytics-service/services/account_identity.py       # backfill, wildcard holder, working-holder swap, new outcome tokens
analytics-service/tests/test_account_identity_stamper.py
docs/runbooks/ + src/__tests__/*-exec.test.ts        # the deletion census-and-delete SQL and its executed-on-fixture test
```

### Pattern: one shared swap function, two callers

**What:** `swap_account_slot(p_new_key uuid, p_old_holder uuid)`, SECURITY DEFINER, `SET search_path`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`. It is the only place that writes the slot and the marker together. The connect route calls it after an unstamped INSERT; the stamper calls it when its own stamp meets a failing holder. A swap that fails midway after the connect leaves the new key unstamped and unmarked; the stamper's next poll runs the identical function, so the failure self-heals.

**Order of writes that satisfies both the unique index and the marker trigger** (derived from the trigger quoted above and the index; the function holds `FOR UPDATE` on both rows, locked in `id` order):

1. Assert, inside the function (the DB is authoritative; the route's read is a hint): both keys `user_id` equal; both `disconnected_at IS NULL`; `exchange` equal; old holder carries the `venue_account_id` (and server match under the wildcard rule); old holder is NOT working (D-18) and the new key IS working (D-18); the old holder's `account_shared_with_api_key_id IS NULL`; the pair is not composite members with disjoint windows (that is `composite_member`, not a swap). Any failure raises a named error (a stable token message, like the trigger's) so the caller can map it.
2. If the new key is itself marked (stamper case: it points at the old holder), clear its marker first: `UPDATE ... SET account_shared_with_api_key_id = NULL, account_share_kind = NULL`. Without this, step 4 trips `ACCOUNT_SHARE_HOLDER_IS_MARKED`.
3. Re-point every dependent of the old holder to the new key: `UPDATE api_keys SET account_shared_with_api_key_id = <new> WHERE account_shared_with_api_key_id = <old>`. Without this, step 4 trips `ACCOUNT_SHARE_KEY_IS_A_HOLDER` for any key that names the old holder.
4. On the old holder, in ONE UPDATE: `venue_account_id = NULL` (frees the index slot; a marked key keeps NULL by existing convention) and `account_shared_with_api_key_id = <new>, account_share_kind = 'duplicate'`.
5. Stamp the new key: `venue_account_id = <login>, venue_server = <server>` (and marker NULL). The index now has no competing live row.
6. Return a small status the caller uses to audit (`api_key.account_duplicate_detected` for the old holder, as `_audit_duplicate` does) and to enqueue the owner's `derive_allocator_equity` recompose (existing `_write_marker_and_audit` behaviour).

**When to use:** only when the old holder fails D-18 and the new key passes it. Otherwise the existing refusal / duplicate mark stays.

### Anti-Patterns to Avoid

- **Doing the swap as several PostgREST calls.** No transaction; a concurrent poll of a marked sibling can steal the freed slot between calls.
- **Interpolating the server (or any user text) into a PostgREST `.or("...")` filter string** (TS or Python). The value is user-controlled text (commas, parentheses, dots). Read the few same-login live rows and filter in code with one pure function, unit-tested in both languages.
- **Using `.maybeSingle()` for the wildcard fence.** With NULL-as-wildcard two live rows can match; `maybeSingle` errors on two. Use `.order("created_at").limit(1)` after filtering in code, or take the first working-state row.
- **Restating the D-18 tuple a fifth time.** Reuse `working_holder_predicate` and `isWorkingHolder`; add the new SQL function to the parity test that already reads the migration text.
- **A SQL data backfill of `venue_server`.** Impossible (ciphertext) and a data-reading `DO` guard is refused by the linter.
- **Editing an applied migration** (including its comments).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Constraint-name discrimination of a 23505 | Parsing `details` | `pgConstraintName(error)` (message only) | `details` carries the login; reading it makes a control input client-influenced |
| D-18 working predicate | A new inline tuple | `isWorkingHolder` (TS), `working_holder_predicate` (Py), the SQL tuple | Four twins already pinned by tests |
| Share-kind decision (`duplicate` vs `composite_member`) | New window logic | `_share_kind` in `account_identity.py` (uses `stitch_composite.windows_overlap`) | One canonical overlap predicate |
| Audit of a new duplicate | New audit action | `DUPLICATE_DETECTED_AUDIT_ACTION` via `_audit_duplicate` | Action already in the TS and Py unions with a parity test |
| Hard delete of a key with its dependents | Raw `DELETE FROM api_keys` | `delete_allocator_api_key(key, true)` | Handles the allocator_holdings RESTRICT and the last-key derived-history cascade |
| Owner-context call from SQL | Custom impersonation | the idiom in `supabase/tests/test_api_keys_account_identity.sql` (ACCT-j) and `test_mt5_server_clock_readings.sql` (arm 7a) | Already proven on the lane |
| Throwaway Postgres for an executed SQL gate | Docker | `scripts/pg-lane/run.sh` and the exec-test pattern in `src/__tests__/mt5-parity-capture-sql-exec.test.ts` | Boots a socket-only cluster from `baseline.sql` CREATE TABLE blocks; works with no Docker daemon |

## Findings by research question

### Q1. Every write path that creates or re-stamps an `api_keys` row

| # | Writer | File and locator | Stamps identity today | Phase 225 action |
|---|--------|------------------|-----------------------|------------------|
| W1 | Wizard create (credentials) | `create-with-key/route.ts`: `rpcAdmin.rpc("create_wizard_strategy", {... p_venue_account_id })` (~`:1537-1588`) | MT5: request login (`api_key.trim()`, `:1268`); ccxt: validator `venue_account_id` (`:1405-1407`) | add `p_venue_server` (MT5), holder-health branch, swap call |
| W2 | Wizard reuse stored key | same file, `handleReuseExistingKey` (`:510-760`), `create_wizard_strategy_for_key` | writes no `api_keys` row | none (its `deduped` on `held.kind === "draft"` at `:716-729` STAYS: explicit "use my stored key") |
| W3 | Allocator "Add key" persist arm | `keys/validate-and-encrypt/route.ts:765-777` direct `admin.from("api_keys").insert({...})` | MT5 login / ccxt validator id (`:749-752`) | insert `venue_server` in the same row; holder pre-check; 23505 arm already answers `KEY_VENUE_ALREADY_CONNECTED` (`:796-817`) |
| W4 | Rotate secret (MT5) | `keys/[id]/rotate-secret/route.ts:526-556`, backfills `venue_account_id` from the seam response when the row's is NULL; 23505 retries without it (`:575-582`), else 409 | login only | leave as is: the daily poll backfills the server; a rotate that stamps login-only produces a NULL-server key, which the wildcard rules cover. Do not return the server from `routers/internal.py` rotate (its docstring promises the server is never in the response, T-164.5.3-06). |
| W5 | Reconnect | RPC `reconnect_allocator_api_key` (latest body `20260925120000...sql`, see table above) | clears `disconnected_at`; EXISTS-refuses on equal `(user, exchange, venue_account_id)` | migration B: add the server wildcard to the EXISTS so a different-server key can reconnect |
| W6 | Poll stamper | `account_identity.py`: `_stamp` (`:472-531`), `_find_live_holder` (`:246-268`), `_mark_shared` (`:438-469`), `_write_marker_and_audit` (`:385-435`) | login text from the session (MT5, before the fetch) / one venue call (ccxt, on DONE) | server backfill, wildcard holder pre-check, working-holder swap |
| W7 | Composite add-key | `add_wizard_composite_key` | none | OUT of scope (founder F-2); keep mark-only |

Only W1 and W3 INSERT `api_keys` from application code (grep of `src/` and `analytics-service/` for insert/upsert on `api_keys` finds `validate-and-encrypt/route.ts:767` and the SQL RPCs only).

**The `deduped` emitters in `create-with-key/route.ts` (there are FOUR, not three):**

| # | Locator | Meaning | Disposition |
|---|---------|---------|-------------|
| D1 | `:1203-1217` (`existingDraft` read by `wizard_session_id`) | Same-session resume | KEEP (D-23 explicit carve-out) |
| D2 | `:1280-1299` (`venueMatch.kind === "draft"`, MT5, pre-validateKey) | Different session, same account, own draft | REWRITE as a named 409 (CONN-01) |
| D3 | `:1637-1647` (race arm, `venueMatch.kind === "draft"`) | Same, after the index refused the INSERT | REWRITE, same body and builder as D2 (one builder, as `venueAlreadyConnectedResponse` does, to avoid TWIN-8) |
| D4 | `:716-729` (reuse arm, `held.kind === "draft"`) | User explicitly chose their stored key | KEEP `[ASSUMED]` (not a "connect that matches the user's own draft" in D-23's sense; confirm at plan time) |

Route tests that pin the old behaviour and must flip (`src/app/api/strategies/create-with-key/route.test.ts`): `:1675` "THE BUG: same MT5 login + a DIFFERENT wizard_session_id resolves to the EXISTING row", `:1692` "FAILS TOWARD THE EXISTING ROW: the dedup path issues ZERO writes", `:2084` "ANTI-REGRESSION: a real DRAFT on the same key still dedups", `:2193` "venue-identity constraint + resolvable → 200 deduped with the EXISTING ids", `:2692` "an own DRAFT on the same account → 200 deduped with the EXISTING ids". Tests that stay: `:1544` (session fence), `:4647` (reuse arm).

**Where the per-owner refusal code and copy go.** New wire code (name is the planner's; this file calls it `<NEW_DRAFT_CODE>`), a union member and copy entry in `src/lib/wizardErrors.ts` beside `VENUE_ALREADY_CONNECTED` (copy table entries at `:2595` and `:2877` are the two siblings); `formatKeyError` gains a code-gated naming sentence next to the existing `VENUE_ALREADY_CONNECTED` arm (`:4825-4835`); the body carries `strategy_name` (the existing wire field the wizard already reads for `VENUE_ALREADY_CONNECTED`, `ConnectKeyStep.tsx:1174-1197`) holding the draft's placeholder name, and the exchange comes from the already-passed `context.venue`. The founder's phrase "finish or delete it first" maps to the table's `actions: ["resume_draft", "start_fresh"]` (same as `DRAFT_ALREADY_EXISTS`), which render the resume banner controls. Pins that move with one new code: `CREATE_WITH_KEY_OWN_CODES` (`wizardKeyRosters.ts:108`), `codes409` in the CASES list and `EXPECTED_409_CODES` (`wizardErrors.invariant.test.ts:2196-2200, 2336`), the KEY_ORPHANED-style roster assertions in `wizardKeyRosters.test.ts:52,159-160`, the regex at `wizardErrors.roster-render.test.tsx:430`, the "emitter shape" fixture at `:1038`. The symbol `EXPECTED_TABLE_SIZE` that comments in `route.ts` cite does not exist as code at HEAD (only comments); the real size pins are the ones listed. Emit with `code` FIRST as a literal (`wizardErrors.invariant.test.ts` scanner shape).

`validate-and-encrypt` needs no new code for the exchange-key case: it already answers `KEY_VENUE_ALREADY_CONNECTED` (`:809-816`). It has no draft concept (a direct insert), so ONCE-01 "saving a draft" is only create-with-key.

### F-1. What the refusal already covers (so the plan does not rebuild it)

For a live same-owner holder with a working state, today: strategy past draft → `VENUE_ALREADY_CONNECTED` naming the strategy; no strategy → `KEY_ORPHANED`; composite member only → `KEY_VENUE_ALREADY_CONNECTED`; own draft → silent `deduped` (the gap). ccxt keys reach the same arms only through the 23505 race arm (identity unknown before validation). The partial index is the backstop. The 13 stored duplicates exist because they pre-date identity stamping or came through the composite path (no identity), not because the refusal is missing.

### F-2. The failing-holder carve-out changes the resolver's contract (Q1)

`resolveByVenueIdentity` selects only `id` from `api_keys` (`:221-230`). It must also read `is_active, sync_status, disconnected_at` (admin client, service role, no column-grant problem) and report a new member, e.g. `{ kind: "failing_holder"; holderId }`, decided FIRST. Consequences the plan must carry:

- **The pre-validation MT5 refusal may fire only when the holder is working.** For a failing holder it must fall through to `validateKey` (the new credentials must be proven read-only-valid before they take a slot). The post-`validateKey` call site (ccxt) needs the same pre-RPC resolution, because the INSERT would otherwise 23505 on the failing holder. Recommended: one resolver call after validation for every venue (the identity is known by then), plus the existing pre-validation call for MT5 to keep the cheap early refusal.
- **A failing holder with a strategy is still admitted** (ruling Q1 is explicit). The residue: the failing key's strategy S1 stays on a key now marked `duplicate`, and the new key gets its own strategy S2 on the same account. That is one account under two strategy names. S1 is not publishing fresh numbers while its key fails; if it recovers, see Open Question OQ-2.
- **The new key is "working" by construction** only after `validateKey` succeeded; the swap function re-checks D-18 on the new row (`sync_status` NULL on a fresh key).

### F-3. CONN-03 mechanics: what the index does and does not do (PROBED)

Probe run on PostgreSQL 16.13 this session with the proposed index (`(user_id, exchange, venue_account_id, (COALESCE(venue_server,'')))` partial on `venue_account_id IS NOT NULL AND disconnected_at IS NULL`):

- Three live rows for one owner and login with server `'a'`, NULL and `'b'` all insert successfully. A fourth with NULL server fails: `duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"`. [VERIFIED: PG16 probe]
- `pg_index`: `indnkeyatts = 4`, `indkey = '1 2 3 0'`, `pg_get_expr(indexprs) = COALESCE(venue_server, ''::text)`. [VERIFIED: PG16 probe]
- Therefore a NULL-server (not yet backfilled) key and a server-stamped key on the same login do NOT collide at the index. CONTEXT's "A key not yet backfilled matches on login alone, as today, so the half-done state errs toward refusing" holds only if the APP builds that wildcard. It must live in: (i) `resolveByVenueIdentity` (filter same-login live rows in code; match when either server is NULL or both equal); (ii) the stamper, which must run the wildcard holder lookup BEFORE its stamping UPDATE (today it looks up a holder only AFTER a 23505, which under the new index would no longer fire for a NULL-server legacy holder); (iii) `reconnect_allocator_api_key`'s EXISTS (migration B); (iv) `rotate-secret` needs nothing (it never writes a server).
- The 23505 message still names the constraint, so `pgConstraintName` is unchanged. The DETAIL text now prints `COALESCE(venue_server, ''::text)` and the server value; it is never read or logged (existing rule) and the route's `secrets` array for `scrubSeamError` should include the normalised server.

### F-4. Where the broker server is available, and how the poll gets it

- Connect: the request body `passphrase` slot (`parse_mt5_credentials` docstring: "broker server -> `passphrase`", `analytics-service/services/mt5_validation.py:160-167`). Both TS routes already reject a blank MT5 passphrase before any seam call (`create-with-key/route.ts:1052-1063`, `validate-and-encrypt/route.ts:219-225`), so `passphrase.trim()` is non-empty at the capture point.
- Poll: `_make_mt5_session(api_key, api_secret, passphrase)` (`job_worker.py:1702-1738`) already parses and carries `Mt5Session.server` (a `repr=False` field, `mt5_client.py` dataclass) next to `venue_account_id`. The stamper receives that session as `exchange`. No terminal call is needed.
- Normalisation (recommendation): trim, then lower-case, ASCII intent, cap 128 like the login; `NULLIF` blank to NULL. TS `passphrase.trim().toLowerCase()`, Python `.strip().lower()`, SQL `lower(btrim(...))`. The existing docstring on `mt5_venue_account_id` already records that Python `strip()` and JS `trim()` differ at U+001C-U+001F, U+0085, U+FEFF; MT5 server names are ASCII identifiers in practice, so a parity test with an ASCII-plus-whitespace fixture list is enough. Case-folding is `[ASSUMED]` (see A1): the safe side is to fold, because a wrongly missed duplicate is the failure the phase exists to prevent.
- DB shape (recommendation): `ALTER TABLE ... ADD COLUMN venue_server text NULL` plus a CHECK that mirrors `api_keys_venue_account_id_nonblank`: `venue_server IS NULL OR (btrim(venue_server) <> '' AND char_length(venue_server) <= 128)`. An optional normal-form CHECK (`venue_server = lower(btrim(venue_server))`) turns writer drift into a loud 23514; it is optional because PG `lower()` on non-ASCII is collation-dependent.
- Privilege posture: `api_keys` SELECT for `authenticated` is a named allowlist (`API_KEY_USER_COLUMNS_ARR` in `src/lib/constants.ts`) and INSERT/UPDATE for `authenticated` are revoked, so a new column is service-role-only by default. Do NOT add `venue_server` to `API_KEY_USER_COLUMNS_ARR` and do not GRANT it (no UI reads it). `database.types.ts` is generated and ungranted columns still appear in it; regenerate against the migration (`supabase gen types` on the local stack, which needs Docker) or hand-edit Row/Insert/Update plus the function `Args`, and run `critical-regressions.test.ts` and the GDPR export tests that read it.

### F-5. The index and the gates that pin it

- Migration B re-creates the index under the same name inside one transaction (`DROP INDEX` then `CREATE UNIQUE INDEX`, as `20260812083206` did at `:463-467`; the DROP's ACCESS EXCLUSIVE lock covers the gap). It is strictly finer than the old key, so existing data cannot violate it. Keep `SET lock_timeout = '3s'`.
- `supabase/tests/test_api_keys_venue_identity_uniq.sql` arm 2 builds its column list from `indkey` joined to `pg_attribute` and asserts `ARRAY['user_id','exchange','venue_account_id']` (`:154-163`). After the change that query STILL returns `{user_id,exchange,venue_account_id}` (probed above), so the arm stays GREEN and proves nothing about the new member. The plan must (a) change the assertion to `indnkeyatts = 4` and `pg_get_expr(indexprs, indrelid)` containing `venue_server`, and (b) add behavioural arms: same owner + login + two different servers both insert; same owner + login + same server refused 23505 naming the index; NULL vs NULL refused; two owners with the same login and server both insert. Each carries a `RED-UNDER-M` twin whose `apply` step is a live `sql` step (`DROP INDEX` then recreate the OLD login-only index) so the arm bites. The signature pins at `:73` and the GRANT arm at `:481` move with the 13-parameter RPC (F-6).
- The older migrations' self-verify (`20260812083206:861-960`) asserts the index's column list and aborts a RE-APPLY; it is historical (the migration is applied). Do not edit it. It is also why a migration EDIT could never have been the route to change the index.
- Other literal pins of the old definition: `src/__tests__/accounttruth-census.test.ts:671` (fixture DDL), `scripts/accounttruth-census.mjs:131-148` (comment and the holder-slot rule). Update the fixture and the comment; the census's holder test is login-level, which stays conservative.
- `supabase/schema/baseline.sql` is regenerated by a re-dump, not by this phase; the local-stack lane replays migrations newer than the dump automatically and `supabase/schema/baseline-carried-migrations.txt` records the carried set (last entry at research time: `20261120120000_auth_user_has_password.sql`). A re-dump must regenerate the marker in the same commit (`supabase/schema/BASELINE.md`, `## Regenerating`).
- `npm run schema:functions` regenerates `supabase/schema/functions/*.sql`; CI runs `schema:functions:check`. The migration PR must include the regenerated dumps for `create_wizard_strategy`, `reconnect_allocator_api_key` (B) and the new function.

### F-6. The wizard writer needs the server: pick the 13th parameter

Recommendation: add `p_venue_server TEXT DEFAULT NULL` as the 13th parameter, stored as `NULLIF(lower(btrim(p_venue_server)), '')` in the same INSERT that writes `venue_account_id` (`create_wizard_strategy.sql:290-301`). Reason: the index must be the backstop for the concurrent-connect race and for the case where the app fence read is dark (the fence is deliberately fail-soft, `create-with-key/route.ts:232-257`). A post-INSERT UPDATE cannot be (F alternatives table).

In-repo hazards that come with changing the signature, all of which must be in the plan:
1. `CREATE OR REPLACE` cannot change a parameter list; it mints a sibling overload, and PostgREST then answers PGRST203 to every connect. Gate arm 3 of `test_api_keys_venue_identity_uniq.sql` (`:238-253`) asserts exactly ONE overload. So the migration must `DROP FUNCTION` the 12-parameter signature, then `CREATE` the 13-parameter one.
2. The DROP destroys the ACL and Supabase's default ACL re-grants `anon` and `authenticated` (header of `20260814120000...sql`, point (vi)); re-issue `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION ... TO service_role;` in the same migration. Assertion 5h (`test_api_keys_exchange_not_user_writable.sql`) arms from `pg_get_functiondef` and the live ACL.
3. Re-base on the latest body: source `20260814120000_wizard_rpcs_revoke_authenticated.sql` (the dump header says so). The body keeps the `auth.role() = 'service_role'` gate, the advisory lock and the same-session fence.
4. Deploy order: the route calling `p_venue_server` against a database without it answers PGRST202 for EVERY connect (the hazard the route comments record at `create-with-key/route.ts:1575-1580`). Hence migration A must be applied on PROD before the code PR merges.
5. Test pins that name the 12-argument signature: `test_api_keys_venue_identity_uniq.sql:73` and the arm-4 `apply` statement at `:481`; callers in `test_wizard_session_idempotency.sql`, `test_wizard_composite_fence.sql`, `test_csv_finalize_double_submit.sql`, `test_create_wizard_strategy_for_key.sql`, `test_api_keys_exchange_not_user_writable.sql` (positional 11/12-argument calls still resolve because the new parameter defaults).

`validate-and-encrypt` is a direct INSERT: add `venue_server` to the row object (it is `createAdminClient()`, deliberately untyped, so `tsc` will not catch a typo; unit-test the object).

### F-7. Backfill reach and sequencing

**The backfill is Python, in the poll.** `_stamp` returns `"skipped_already_stamped"` first for a key whose `venue_account_id` is already set (`account_identity.py:488-489`), so stamped MT5 keys never reach any server write today. New behaviour: for an MT5 key whose `venue_server IS NULL` and whose session carries a non-blank server, write `venue_server` (normalised), guarded `.is_("venue_server","null")` like the existing stamp. For an UNSTAMPED MT5 key, write login and server in the same UPDATE (so the index sees the final tuple). A new outcome token (for example `server_backfilled`) extends `StampOutcome` (mypy strict; the Literal is used only in this module and its tests, grep'd).

Reach, measured from the code:
- A key whose session cannot be built (decrypt fails) is never backfilled (`escalate_session_build_failure` already logs it).
- `is_active = false` keys are refused by `_allocator_key_preflight` before any stamp (`job_worker.py:1925-1930`), so they are neither stamped nor backfilled, yet a live (`disconnected_at IS NULL`) inactive key with a stamped login sits INSIDE the index predicate. These keep a NULL server and rely on the wildcard rules.
- Disconnected keys are outside the index and never polled; they keep NULL.
- A backfill UPDATE that 23505s under the new index (only possible after migration B, and only if two live same-login rows pre-existed) is "should be unreachable" (the old index forbade the pair). Log at ERROR with the class and SQLSTATE, never auto-resolve; the census script is the detector.

**Sequencing through the one serial lane** (each migration auto-applies TEST then PROD on merge with no human stop):
1. **Migration A** (PR 1): column + CHECK + COMMENTs; `create_wizard_strategy` 13th parameter with the DROP + ACL pair; `swap_account_slot` function with its ACL; `down/` rollback files per the house convention (`supabase/migrations/down/20260925120000-rollback.sql` is the precedent); regenerated `database.types.ts` and `schema/functions/` dumps; gate edits and new arms. NO index change here. The index is unchanged, so behaviour is unchanged while every `venue_server` is NULL.
2. Confirm A on PROD (`apply` job success on the merge commit), then **PR 2 (code, no migration)**: routes, stamper (backfill, wildcard pre-check, swap), resolver, draft refusal, copy, rosters, tests.
3. **Backfill window and read-only census.** Index-last gate: do NOT build the index until a PROD read-only census shows no live, active MT5 key with a NULL `venue_server` apart from keys the census lists by cause (session cannot be built; inactive). The census also reports any pair of live same-owner MT5 rows with equal login (must be zero). The gate is a plan decision (OQ-3); the research recommendation is "zero live ACTIVE keys with NULL server, or each remaining one named with its cause".
4. **Migration B** (PR 3): index rebuild, `reconnect_allocator_api_key` re-based on `20260925120000` with the server wildcard added to its EXISTS, regenerated dumps, gate and census-fixture updates. Because the new key is strictly finer, B cannot fail on data, and TEST (no data) applies it trivially.
5. The ONCE-03 deletion checkpoint (no code) runs after PR 2 is live. It is independent of migration B.

Can the column and the index be one PR safely? Technically yes (NULL everywhere means the new index equals the old). The recommendation against it is operational: the founder ruled "column first, then writers and backfill, then index", and the index is what ADMITS a same-login different-server key at the DB; before B the old login-only index is the stricter state, which is the safe interim.

### Q3 / F-8. MT5D-08 and Q1: how a working key takes the slot

**Why the failing key holds the slot today.** The MT5 stamp runs before the fetch and reads only the login text from the session (`job_worker.py:14788-14800`); so a key whose sign-in keeps failing still stamps and holds the slot, and a later working key is marked `duplicate` of it via `_find_live_holder` (`account_identity.py:246-268`, which selects only `id`) and `_mark_shared`. `_find_live_holder` has no D-18 filter.

**What changes in the stamper** (`account_identity.py`):
- `_find_live_holder` becomes `_find_live_holders`: select `id, venue_server, is_active, sync_status, disconnected_at, account_shared_with_api_key_id` for same-owner, same-exchange, same-login, live rows other than the stamping key; filter by the wildcard server rule in Python (no `.or_` string); prefer the exact-server match.
- Before the stamping UPDATE (MT5 only needs this; ccxt keeps its after-23505 path because the server is not part of ccxt identity), run the wildcard lookup. If a holder exists: if `working_holder_predicate(holder)` is False and `working_holder_predicate(key_row)` is True and `_share_kind(...)` is `duplicate`, call `swap_account_slot` (new outcome token, for example `swapped_holder`; audit the old holder as a new duplicate with `_audit_duplicate`; recompose enqueue as `_write_marker_and_audit` does). If the holder is working, or both fail, take today's `_mark_shared` path (a failing key marked against a working holder, or two failing keys leaving the incumbent in place, is the stable behaviour).
- A marked key's later polls re-run `_stamp` (its `venue_account_id` stays NULL by design), hit the same branch, and so heal a holder that has started failing since (`_mark_shared`'s "unchanged marker" short-circuit at `:458-462` is where the working check must go in front of).
- Import `working_holder_predicate` from `services.allocator_equity_derive` (it imports `stitch_composite` only, no cycle with `account_identity`; verify with mypy). The stamping key's `sync_status` is the value loaded at preflight; a freshly connected key is NULL (working).

**Parity:** the swap function's D-18 tuple is a FOURTH twin. Extend `src/lib/account-share-note.test.ts` (it reads the D-18 migration text and the function snapshot, `:166-173`) and the Python parity test in `analytics-service/tests/test_derive_allocator_equity_job.py` to read the new function body.

**Existing readers keep working:** marked-key counting goes through the holder only while the holder is working (`COMMENT ON COLUMN api_keys.account_share_kind`, `20260927180000`). After a swap the demoted key is failing and marked against a working holder, so readers count the working one; the owner's recompose is enqueued.

### F-9. The key card cannot currently "name" a failing marked key

Ruling Q1 says the failing key "is named on its key card". `accountShareNote` returns null when the marked key itself is not working (`account-share-note.ts`: `if (!isWorkingHolder(key)) return null;`, the WR-02 rule; pinned in `account-share-note.test.ts`). A demoted failing key therefore shows only its own failing status. Two options for the plan: (a) add a distinct sentence for "marked duplicate of a WORKING holder, key itself not working", with DESIGN.md consulted for the card; or (b) ask the founder to accept WR-02 as the naming. This is OQ-1 and the file recommends (a) as a small, testable change. `[ASSUMED]` copy and placement.

### Q3 design check: the marker trigger and the unique index, together

Both rules from the sources quoted above, restated as the ordering constraint list: the index forbids two live rows with equal `(user_id, exchange, venue_account_id, coalesce(venue_server,''))` where `venue_account_id IS NOT NULL`; the trigger (fires only when the holder column is in the SET list) refuses a holder that is not found, not same-owner, not live, itself marked, or when the marked row is already a holder of another key. The swap order in "Pattern" satisfies all of them. A Python or PostgREST sequence of separate calls would need a window in which the freed slot is takeable by a marked sibling's own poll: that window is the reason for a single function.

### ONCE-04 coverage (Q3: equal stamped identity is the link)

A cross-owner shared login has a "link" exactly when both keys are stamped. Keys that never stamp, and so cannot be linked: sFOX (`D-10`, identity unknowable), keys with `is_active = false` (preflight refuses before the stamp), keys whose session cannot be built, ccxt keys whose polls keep failing (stamp runs on the DONE path only; `escalate_if_unchecked` logs at ERROR after `UNSTAMPED_ESCALATION_DAYS`), and composite members until their first poll. CONTEXT's PROD census (2026-11-23): 0 live same-owner pairs; every live key stamped. The test to write (pytest, `analytics-service/tests/test_account_identity_stamper.py`, beside the existing `test_mt5_collision_marks_the_key_duplicate_and_audits_once` at `:1524`): two unstamped MT5 keys with DIFFERENT `user_id` and the same login and server both stamp, neither gets a marker, and the stamping UPDATEs carry equal `venue_account_id`/`venue_server`; plus the same-owner counterpart marks one. RED neuter: drop the `user_id` filter in the holder lookup (cross-owner marking), or the server write.

### Q5 / ONCE-03 deletion checkpoint design

**Facts that shape it.**
1. **No product delete path exists for a non-draft strategy.** The only `.from("strategies")...delete()` in `src/` is `src/app/api/strategies/draft/[id]/route.ts` and it is filtered to `source = 'wizard' AND status = 'draft'`. The 2 strategies are a published okx and a private mt5, so they are not draft-route eligible. The lowest-level product path is the owner's own RLS: `strategies_delete` lets the owner `DELETE` (policy quoted above). So: `DELETE FROM strategies WHERE id = ... AND user_id = <owner>` run in the owner's context. Both `route.ts` files cited say the dependents cascade through FK ON DELETE CASCADE.
2. **Strategy delete blockers not in the manifest.** `allocation_events` (no action), `match_decisions.original_strategy_id` (RESTRICT) and `verification_requests_legacy.matched_strategy_id` (no action) refuse the delete if any row points at the strategy. `portfolio_strategies`, `user_favorites`, `contact_requests`, `strategy_shares`, `deck_strategies`, `bridge_outcomes`, `bridge_outcome_dismissals`, `match_decisions.strategy_id` CASCADE, and several belong to OTHER users (an allocator who put the published strategy in a portfolio or favourited it). `relationship_documents`, `portfolio_alerts`, `contact_requests.replacement_for` SET NULL. The manifest the founder confirmed lists none of them (they were zero or off the owner's side at census time); the checkpoint must not assume that, so it re-counts every referencing table. **Any nonzero count in an off-manifest table STOPS the run and goes to the founder.**
3. **Strategies before keys.** Deleting a key first fires the FK `SET NULL` UPDATE on `strategies`, which runs the strategies `BEFORE UPDATE` triggers (`guard_strategies_publish_transition_trigger`, `guard_wizard_draft_updates_trigger`, `strategies_reject_sentinel`) against a published row. Deleting the 2 strategies first avoids that path.
4. **Key delete guards.** `api_keys_published_composite_delete_guard` refuses a key linked by `strategy_keys` to a `published` strategy (census it per key; none expected). The `mt5_server_clock_readings_write_once` trigger admits the cascade (depth > 1) and refuses a direct DELETE, so never delete readings directly. NEVER set `quantalyze.sanitize_in_progress` here: it is the GDPR sanitize path's bypass, and using it would disable the composite guard that is protecting the run.
5. **Derived rows linger.** `delete_allocator_api_key` removes `allocator_equity_derived` rows (`equity_curve`, `key_inputs:<id>`) only when the key is the owner's LAST key (`NOT EXISTS (SELECT 1 FROM api_keys WHERE user_id = auth.uid())`). The 5 owners keep their holder keys, so each duplicate's `key_inputs:<id>` row survives. Census `allocator_equity_derived` for those ids; whether to prune them is OQ-4. Either way, enqueue `derive_allocator_equity` per owner after the delete so the owner's curve recomposes without the deleted keys (the existing function `enqueue_compute_job(p_strategy_id => NULL, p_allocator_id => <owner>, p_kind => 'derive_allocator_equity')`, as `_write_marker_and_audit` calls it).
6. **Owner context.** `delete_allocator_api_key` checks `v_owner <> auth.uid()`. The repo idiom (verified, `test_api_keys_account_identity.sql` ACCT-j and `test_mt5_server_clock_readings.sql` arm 7a):

   ```sql
   PERFORM set_config('request.jwt.claims',
     json_build_object('sub', <owner uuid>::text, 'role', 'authenticated')::text, true);
   SET LOCAL ROLE authenticated;          -- 7a does this; ACCT-j calls as the session role with claims only
   PERFORM public.delete_allocator_api_key(<key uuid>, true);
   RESET ROLE;
   PERFORM set_config('request.jwt.claims', NULL, true);
   ```
   The claims GUC is transaction-local (`is_local = true`), so it must be set in the SAME call as the delete. If a runner executed statements as separate transactions, `auth.uid()` would be NULL and the function raises 42501 before writing (fail closed). Whether the Supabase MCP `execute_sql` keeps a multi-statement string in one transaction is `[ASSUMED]` (A2); the design therefore uses one explicit `BEGIN; ... COMMIT;` and treats a 42501 as "stop, nothing was written".

**Recommended checkpoint (orchestrator-run, executors do not have the MCP).**
- Artifacts in the repo (no ids): a `docs/runbooks/` directory with `census.sql` (read-only), `delete.sql` (the single-transaction script taking the confirmed key ids, strategy ids and owner ids as a `VALUES`/array block pasted at run time) and an executed-on-fixture vitest in the pattern of `src/__tests__/mt5-parity-capture-sql-exec.test.ts` (throwaway socket-only cluster, tables cut from `baseline.sql`, no skip gate). The test seeds a miniature of the manifest plus decoys and proves: the script deletes exactly the manifest; it aborts with nothing deleted when (i) an extra key joins the set, (ii) a manifest key is live or is a holder, (iii) an off-manifest dependent exists, (iv) a manifest id is missing. These are the PROOF-01 arms for the destructive step.
- Run order for the orchestrator: (0) marker query, expect the PROD name, STOP if NULL; (1) `census.sql` read-only, one query per MCP call, never chained; (2) founder compares the output to the confirmed manifest (13 keys by exchange: 7/1/5; 5 owners; 2 strategies; the dependents table counts); (3) `delete.sql` in ONE call: `BEGIN;` a marker re-check; a census-equality assertion block that `RAISE EXCEPTION`s on ANY difference (key id set, per-key flags none live / none holder / none in a published composite; strategy set; per-table dependent counts; zero in each off-manifest table; the 155.2 holder keys' row fingerprints unchanged; each owner keeps at least one other key); then per owner the delete order strategies, then keys with `p_cascade_holdings => true`; then re-count the same tables; then per-owner recompose enqueue; `COMMIT;` and print before/after counts. A data-reading `DO` block is allowed here because this is an ad-hoc orchestrator script, not a migration (the linter reads `supabase/migrations/**` only; confirm by reading its path scope at plan time). (4) after: re-run `census.sql` and assert the holders and the 155.2 keys are byte-identical to the before-fingerprint.
- **155.2 coupling.** ROADMAP: this deletion moves MT5 numbers, so it lands before 155.2 plan 12 or after plan 14. Separately, `capture-keymap.sql` numbers ordinals as `row_number()` over ALL MT5 keys ordered by `created_at, id` (`docs/runbooks/mt5-parity/README.md` says disconnected keys are included "so ordinals stay stable", which a hard delete breaks). Deleting the one MT5 duplicate (155.2's k2) renumbers every later MT5 key (k3 becomes k2, k10 becomes k9, and so on) in any capture taken afterwards. The plan 12 recapture must take a fresh keymap and `labels.json` after the deletion, never reuse the sealed ordinals. Add this to the checkpoint's hand-off note.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (TS routes, libs, exec-SQL tests), pytest 9.0.2 (analytics-service), pg-lane + `psql` gates (`supabase/tests/*.sql`), mutation runner (`scripts/mutation-runner/run.mjs`), mypy strict |
| Config files | `vitest.config.ts`, `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` (`[tool.mypy]`), `scripts/mutation-floors.mjs` |
| Quick run (route + libs) | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts src/app/api/keys/validate-and-encrypt/route.test.ts src/lib/account-share-note.test.ts src/lib/wizardKeyRosters.test.ts src/lib/wizardErrors.invariant.test.ts` |
| Quick run (stamper) | `cd analytics-service && python3 -m pytest tests/test_account_identity_stamper.py -x -q` (130 passed at HEAD) |
| Types | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (from `.github/workflows/ci.yml`; the Makefile `typecheck` target runs the same set) |
| One SQL gate | `bash scripts/pg-lane/run.sh --workdir <scratch> --apply <the gate's RED-UNDER-SETUP files> --gate supabase/tests/test_api_keys_venue_identity_uniq.sql` (the apply list is the file's own `RED-UNDER-SETUP` JSON; the new migrations must be appended to it and to every other gate whose behaviour reads the new column or function) |
| Full suite | `npx vitest run`; `cd analytics-service && python3 -m pytest`; `node scripts/mutation-runner/run.mjs`; `npm run lint`; `npm run schema:functions:check` |

Environment notes measured: the Docker daemon is DOWN on the research machine, so the local-stack lane (`scripts/local-stack/run.sh`, used by `sql-tests`) cannot boot; the pg-lane and the exec-on-fixture vitest pattern need only PostgreSQL 16 server binaries, which are installed. Executors that need `supabase gen types --local` need Docker started first.

### Phase Requirements → Test Map

| Req | Behaviour | Test type | Command | Exists | Neuter target for PROOF-01 (named arm first) |
|-----|-----------|-----------|---------|--------|----------------------------------------------|
| ONCE-01 (exchange) | OKX key whose uid a same-owner live key holds is refused 409 `KEY_VENUE_ALREADY_CONNECTED`, uid in no body/log | vitest | `route.test.ts` (existing arm at `:2006`) + new owner-vs-owner arm | partial | drop `.eq("user_id", userId)` in the resolver, expect the cross-owner arm RED |
| ONCE-01 (MT5) | same-owner MT5 login + same server refused by name before `validateKey`, zero writes | vitest | `route.test.ts` new arm beside `:2067` | no (Wave 0) | make the pre-validation arm fall through |
| CONN-01 | own draft on the same account answers the new named 409 with `strategy_name`; session fence still answers `deduped` | vitest | `route.test.ts` flips at `:1675 :1692 :2084 :2193 :2692`, keeps `:1544 :4647` | flips needed | restore `deduped: true` in D2 and D3 |
| ONCE-01 (wizard copy) | new code recognised, copy present, rosters/invariants consistent | vitest | `wizardKeyRosters.test.ts`, `wizardErrors.invariant.test.ts`, `wizardErrors.roster-render.test.tsx`, `ConnectKeyStep.test.tsx` | edits | remove the code from `CREATE_WITH_KEY_OWN_CODES` (UNKNOWN render) |
| ONCE-02 | different owners, same exchange/login/server both connect; each owner's resolver sees only its own rows | vitest + SQL | route test with two user ids; SQL arm inserting for two users | no | weaken the index to drop `user_id` (SQL arm RED), drop the resolver owner filter (route arm RED) |
| ONCE-02 (strategy-linked key in an allocator book) | a key with `strategies.api_key_id` and allocator holdings stays unaffected by a same-owner connect on another account | vitest | route test: second account connects, first untouched | no | n/a (assert zero writes to the first key) |
| ONCE-04 | two keys of different owners with the same login and server both stamp with no marker; same-owner second key marks | pytest | `test_account_identity_stamper.py` new arms | no | remove the `user_id` filter in the holder lookup / drop the server write |
| CONN-03 (index) | same owner + login, servers A and B both live; same server refused 23505 naming the index; NULL vs NULL refused | SQL gate | `test_api_keys_venue_identity_uniq.sql` rewritten arm 2 + new arms | edit | recreate the old login-only index (live `sql` step) |
| CONN-03 (column) | CHECK refuses blank and over-length server; column not in `API_KEY_USER_COLUMNS_ARR`; column ungranted to `authenticated` | SQL gate + vitest | new SQL arm; `sec-005-api-keys-projection.test.ts` | no | drop the CHECK / add the column to the allowlist |
| CONN-03 (writers) | connect writes the normalised server into the same INSERT; routes pass it | vitest | `route.test.ts` for both routes asserting the RPC args / insert row | no | stop sending `p_venue_server` |
| CONN-03 (backfill) | stamped MT5 key with NULL server gets its server written once from the session; unstamped key gets login and server in one UPDATE; no data-reading DO block | pytest + lint | `test_account_identity_stamper.py`; `node scripts/lint-migration-data-dependence.mjs` | no | skip the backfill write |
| CONN-03 (normalisation parity) | TS and Py produce identical bytes for an ASCII+whitespace fixture list | vitest + pytest | one fixture file read by both | no | change one side's fold |
| MT5D-08 (stamper) | failing holder beside working key: working key holds the slot, old holder marked `duplicate`, dependents re-pointed, audit once, recompose enqueued; working holder keeps its slot; both failing leave the incumbent | pytest | `test_account_identity_stamper.py` | no | make `working_holder_predicate` constant, or skip the swap call |
| MT5D-08 (function) | `swap_account_slot` ordering against the real trigger and index: marked new key, holder with dependents, wrong owner, working holder, composite pair each behave per the Pattern; service_role-only ACL | SQL gate | new `supabase/tests/test_swap_account_slot.sql` with `RED-UNDER-M` twins | no | edit the function (drop the re-point UPDATE: `ACCOUNT_SHARE_KEY_IS_A_HOLDER`; drop the marker clear: `ACCOUNT_SHARE_HOLDER_IS_MARKED`) |
| MT5D-08 (connect) | failing same-owner holder: key admitted unstamped then swapped; working holder: refused | vitest | `route.test.ts` for both routes | no | resolver returns "working" always |
| D-18 parity | SQL (including the new function), TS and Py tuples agree | vitest + pytest | `account-share-note.test.ts`; `test_derive_allocator_equity_job.py` | extend | change one tuple member |
| F-9 card sentence | failing marked key with a working holder names the holder; WR-02 otherwise unchanged | vitest | `account-share-note.test.ts`, `AllocatorExchangeManager*.test.tsx` | extend | return null |
| ONCE-03 | census/delete script deletes exactly the manifest on a fixture; aborts untouched on any difference | vitest exec-on-fixture | new `src/__tests__/*-exec.test.ts` modelled on `mt5-parity-capture-sql-exec.test.ts` | no | delete the equality assertion in the script: the "extra key" arm goes RED |
| ONCE-03 (live) | before/after counts and holder fingerprints recorded verbatim | manual, orchestrator | marker query then `census.sql`, `delete.sql` | n/a | n/a (checkpoint, not a gate) |

### Sampling Rate
- **Per task commit:** the quick run lines above for the touched layer, plus `mypy` when Python changed.
- **Per wave merge:** full vitest, full pytest, the touched SQL gates via pg-lane, `npm run lint`, `npm run schema:functions:check`.
- **Phase gate:** the migration PRs pass migration-reviewer and rls-policy-auditor with no MEDIUM+ finding; `sql-mutation` runs every new `RED-UNDER-M` (the push to `main` takes a subset, the nightly takes FULL; a migration no gate lists forces a FULL fallback, so append the new migrations to the relevant `RED-UNDER-SETUP` lists); `node scripts/mutation-runner/run.mjs` exits 0 with `WAIVED_CEILING` untouched.

### Wave 0 Gaps
- [ ] New SQL gate file or arms for the column CHECK, the rewritten index arm and the swap function, with `RED-UNDER` prose plus `RED-UNDER-M` twins.
- [ ] Update every gate that pins the 12-argument `create_wizard_strategy` signature (list in F-6, item 5).
- [ ] The doubled-language normalisation fixture file and its two readers.
- [ ] The census/delete SQL files and their executed-on-fixture vitest.
- [ ] Grep every census a new `supabase/tests` file or arm moves (`scripts/mutation-floors.mjs` symbols, `src/__tests__/mutation-runner-floors.test.ts`, `docs/sql-gate-lineage.md`, any file-count pin) and move them in the same commit; read floors by symbol, never restate.
- [ ] `database.types.ts` regeneration path (needs the Docker local stack, or a documented hand edit).

### PROOF-01 protocol (per gate)
Back up the file to be neutered with `cp <file> <scratch>/<name>.bak`; apply the neuter edit; run the gate and record the RED line with the named arm first; restore with `cp <scratch>/<name>.bak <file>`; `cmp <file> <scratch>/<name>.bak` must print nothing; rerun and record GREEN. Record the edit, command, RED line and GREEN line verbatim in the plan SUMMARY. Never `git checkout`, `git restore` or `git stash` on uncommitted work.

## Common Pitfalls

### Pitfall 1: The probed-green index arm
**What goes wrong:** the existing gate's column-list arm passes after the index gains the expression member, so a later change that DROPS the member would also pass.
**Why:** the join to `pg_attribute` on `attnum` drops `attnum = 0` (probed: `{user_id,exchange,venue_account_id}` for a 4-key index).
**Avoid:** assert `indnkeyatts = 4` and `indexprs` text; add behavioural arms; make the RED twin recreate the OLD index.

### Pitfall 2: The wildcard that nobody wrote
**What goes wrong:** the index treats NULL-server and `'A'` as different accounts, so a legacy NULL-server key and a new server-stamped key on the same login both live, undetected, summed twice.
**Avoid:** wildcard in resolver, stamper pre-check, reconnect EXISTS; unit-test one pure matching function per language with the rows NULL/NULL, NULL/A, A/A, A/B.

### Pitfall 3: Marker-trigger ordering
**What goes wrong:** `ACCOUNT_SHARE_HOLDER_IS_MARKED` (new key already marked) or `ACCOUNT_SHARE_KEY_IS_A_HOLDER` (old holder still has dependents), or a stolen slot between two statements.
**Avoid:** the single function with the exact order in "Pattern", locking both rows in id order.

### Pitfall 4: A swap that "succeeds" on the wrong row
**What goes wrong:** the function trusts the route's read of "failing".
**Avoid:** the function re-evaluates D-18 on both rows and the same-owner/live/exchange facts itself; tests with a working holder expect refusal.

### Pitfall 5: The signature change
**What goes wrong:** an overload (PGRST203), a re-granted `anon`/`authenticated` EXECUTE, or PGRST202 on every connect when code deploys before the migration.
**Avoid:** DROP + CREATE + ACL pair; migration A on PROD before the code PR merges; update the signature pins.

### Pitfall 6: Deleting a published strategy cascades into other users
**What goes wrong:** `portfolio_strategies`, `user_favorites`, `contact_requests` rows of other users vanish, or `allocation_events` / `match_decisions.original_strategy_id` / `verification_requests_legacy` block the delete mid-run.
**Avoid:** FK-graph census with a STOP on any off-manifest count (checkpoint item 2); the whole run in one rolled-back-on-error transaction.

### Pitfall 7: Hash ordinals shifting under the 155.2 harness
See "155.2 coupling". A hard delete of an MT5 key renumbers later ordinals.

### Pitfall 8: Putting the server (or login) in a log, copy, or filter string
The login and server are account identifiers: scrub them with `scrubSeamError(err, [..., venueAccountId, venueServer])`, never interpolate into `.or()`, never read `details`.

### Pitfall 9: An applied-migration comment "fixed" in place
Never. Correct forward in migration B's COMMENT ON INDEX.

## Code Examples

### The pure wildcard match (one per language, same cases in both test files)
```text
same_account(a, b) =
    a.login == b.login
    AND (a.server is NULL OR b.server is NULL OR a.server == b.server)
```
Used by the resolver (TS) and the stamper holder lookup (Python) after reading same-owner, same-exchange, same-login, live rows. `[ASSUMED]` function names; the rule is from CONTEXT Q2 plus F-3.

### The swap function's observable contract
```text
swap_account_slot(p_new_key uuid, p_old_holder uuid) RETURNS void
  raises a stable token message (the trigger's style) for: not found, not same owner, not live,
  exchange mismatch, identity mismatch, holder is working, new key not working, holder is marked,
  composite pair. service_role only.
```
Order of writes: see "Pattern: one shared swap function". Source of the rules: the trigger and index quoted in "Verified in-repo values".

### Owner-context delete (repo idiom, quoted above)
```sql
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', <owner uuid>::text, 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
PERFORM public.delete_allocator_api_key(<key uuid>, true);
RESET ROLE;
```
Source: `supabase/tests/test_mt5_server_clock_readings.sql` arm 7a, `supabase/tests/test_api_keys_account_identity.sql` ACCT-j.

## State of the Art

| Old approach | Current approach | When | Impact |
|--------------|------------------|------|--------|
| MT5 identity = login only (TODOS A-3) | login + server column, index with `coalesce(venue_server,'')` | this phase | same login on two brokers stops colliding |
| Silent `deduped` on own draft | named 409 | this phase (D-23) | the user is told what was stored |
| Failing key can hold the slot | working key takes it | this phase (D-25) | a stuck sign-in no longer blocks the account |
| Same-owner duplicate marked, kept, disconnected | one-time deletion of the 13 stored | this phase (Q5) | records only; going forward the refusal prevents new ones |

**Deprecated/outdated:** the `EXPECTED_TABLE_SIZE` symbol cited in route comments does not exist in code; do not search for it as a pin.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node / npm / vitest | route and lib tests | yes | v25.8.1 / 11.11.0 | none needed |
| Python / pytest / mypy | stamper tests, type gate | yes | 3.14.3 / 9.0.2 / importable | CI pins its own Python |
| PostgreSQL server binaries | pg-lane gates, exec-on-fixture tests | yes | 16.13 (`/opt/homebrew/Cellar/postgresql@16`) | none needed; the lane is PG16-tolerant and CI lane pins 17.6.1.113 |
| Docker daemon | local-stack lane, `supabase gen types --local` | NO (daemon down) | CLI 29.9.2 installed | start Docker for type generation; hand-edit `database.types.ts` otherwise |
| Supabase MCP | PROD checkpoint | orchestrator only | n/a | executors have none; the checkpoint is orchestrator-run |
| `gsd-tools` graphify | n/a | disabled in this repo | n/a | skipped (graph step not applicable) |

**Missing with fallback:** Docker daemon (above).

## Runtime State Inventory

Not a rename/refactor phase. The one-time deletion is a data operation and is specified in its own section. Categories checked for completeness: stored data (13 keys, 2 strategies, dependents: in manifest), live service config (none; Railway env unchanged), OS-registered state (none), secrets/env vars (none; the server is not a secret), build artifacts (none).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard control |
|---------------|---------|------------------|
| V2 Authentication | no | unchanged (`withAuth` session uid; body never supplies a uid) |
| V3 Session Management | no | unchanged |
| V4 Access Control | yes | tenant scoping is `.eq("user_id", userId)` on the admin client (RLS bypass); the swap function is service_role-only with `REVOKE ... FROM PUBLIC, anon, authenticated`, same-owner asserted inside; the delete runs as the owner (`auth.uid()` check inside `delete_allocator_api_key`) |
| V5 Input Validation | yes | server normalised (trim, fold, cap 128, blank to NULL) and CHECKed in the DB; never interpolated into PostgREST filter strings |
| V6 Cryptography | no | the server is plaintext non-credential by founder ruling; credentials stay inside the existing envelope encryption |
| V7 Logging | yes | login and server never logged or put in copy; `scrubSeamError` with per-request secrets including the server; `pgConstraintName` reads `message` only |
| V8 Data Protection | yes | `venue_server` not added to the `authenticated` SELECT allowlist; no new cross-tenant read path |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Cross-tenant slot takeover via the swap function | Elevation of privilege | function asserts both rows share `user_id`; EXECUTE only to service_role; gate with an other-owner decoy |
| Account-existence oracle across tenants | Information disclosure | every resolver read is owner-scoped; refusal copy names only the caller's own strategy/draft; no identity or user id in any body |
| PostgREST filter injection through the server text | Tampering | filter in code, not in an `.or()` string |
| Identity leak through 23505 DETAIL | Information disclosure | message-only constraint parse; scrub with the server value |
| Destructive PROD run on the wrong database | Tampering / repudiation | marker query first; single-transaction stop-on-difference; before/after counts recorded; no GDPR sanitize bypass |
| Forged `venue_server` by a client | Spoofing | INSERT/UPDATE are revoked for `authenticated`; only server code (service role) writes it; `[ASSUMED]` that no client-supplied scrub trigger is needed for it, confirm in the migration review (the sibling `scrub_client_supplied_venue_account_id` exists for `venue_account_id`) |

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | Fold the server to lower case before storing and comparing | F-4 | two case-variants of one server would be treated as different accounts (missed duplicate) |
| A2 | The Supabase MCP `execute_sql` keeps one explicit `BEGIN ... COMMIT` string in a single transaction | Q5 | the claims GUC would not survive; the delete function raises 42501 and writes nothing (fails closed), so the cost is a stalled checkpoint, not a wrong delete |
| A3 | The reuse-arm `deduped` (D4) stays | Q1 table | if the founder meant it too, CONN-01 grows one arm and one test |
| A4 | The failing-marked-key card needs a new sentence (OQ-1) | F-9 | if WR-02 is accepted as the "naming", the sentence is unnecessary |
| A5 | Index-last gate = zero live ACTIVE MT5 keys with NULL server, remaining ones named by cause | F-7 | a stricter gate delays migration B; a looser one is still safe because B only refines |
| A6 | Pruning `allocator_equity_derived` `key_inputs:<id>` rows of the deleted keys is in the founder's "all associated data" | Q5 item 5 / OQ-4 | leaving them is harmless to counts (the recompose rebuilds the curve) but leaves orphan derived rows |
| A7 | `database.types.ts` may be hand-edited when Docker is unavailable | F-4 | a drift test could flag it; the regeneration path is the safer one |
| A8 | The data-dependence linter's path scope is `supabase/migrations/**` only, so an ad-hoc DO block in an orchestrator script is allowed | Q5 | if it also scans `docs/runbooks`, express the assertion as plain SQL (a `SELECT` with `CASE` and a forced division by zero) instead |
| A9 | New code and function names used in this file are placeholders chosen by the planner | throughout | none |

## Open Questions

1. **OQ-1: Where is the demoted key "named on its key card"?**
   - Known: `accountShareNote` returns null for a key that is itself not working (WR-02), which is exactly the demoted key.
   - Unclear: whether the founder wants a new sentence or accepts the existing status display.
   - Recommendation: add one sentence for "marked duplicate of a working holder, key itself not working", read DESIGN.md first; ask the founder only if the planner wants to skip it.
2. **OQ-2: A demoted key that recovers (rotate-secret returns it to idle) becomes a live marked duplicate, possibly with a strategy.**
   - Known: readers count one account through the working holder; the marker is not cleared on recovery.
   - Unclear: whether that live marked key with its own strategy violates the criterion 3 intent ("no strategy publishes another key's numbers under its own name").
   - Recommendation: log it for the founder; do not decide in code. It is the shape the Q1 ruling accepts.
3. **OQ-3: The exact index-last gate (F-7).** Recommendation in A5.
4. **OQ-4: Prune `allocator_equity_derived` rows `key_inputs:<deleted key id>` for the 13 keys?** Recommendation: yes, in the same transaction, listed in the pre-delete census and recorded in the SUMMARY, because the founder said "all associated ... data" and they are regenerable derived rows. Needs the founder's nod if the planner treats it as outside the confirmed manifest.
5. **OQ-5: Do the 2 strategies have off-manifest cross-user dependents?** Only the live census can answer (Q5 item 2). A nonzero count stops the run.

## Sources

### Primary (HIGH confidence: files opened this session)
- `supabase/migrations/20260812083206_api_keys_venue_account_id.sql` (index, self-verify), `20260925120000_api_keys_account_identity.sql` (marker, trigger, reconnect), `20260927180000_working_holder_rule_d18.sql` (D-18), `20260920120000_api_keys_venue_account_id_grant.sql`, `20260814120000_wizard_rpcs_revoke_authenticated.sql` (header and dump), `20261117120000_mt5_server_clock_readings.sql`
- `supabase/schema/functions/{create_wizard_strategy,reconnect_allocator_api_key,delete_allocator_api_key,delete_api_key_if_unreferenced,enforce_api_keys_published_composite_integrity,enforce_mt5_server_clock_readings_write_once}.sql`, `supabase/schema/baseline.sql` (FKs, policy, triggers)
- `supabase/tests/test_api_keys_venue_identity_uniq.sql`, `test_api_keys_account_identity.sql`, `test_mt5_server_clock_readings.sql`
- `src/app/api/strategies/create-with-key/route.ts`, `src/app/api/keys/validate-and-encrypt/route.ts`, `src/app/api/keys/[id]/rotate-secret/route.ts`, `src/app/api/strategies/draft/[id]/route.ts`, `src/lib/{wizardErrors,wizardKeyRosters,account-share-note,constants}.ts`, `src/lib/api/pgConstraintName.ts`
- `analytics-service/services/{account_identity,mt5_validation,allocator_equity_derive,job_worker}.py` (cited ranges), `analytics-service/routers/internal.py` (rotate), `analytics-service/tests/test_account_identity_stamper.py`
- `docs/runbooks/mt5-parity/{capture-keymap.sql,README.md}`, `scripts/{mutation-floors.mjs,lint-migration-data-dependence.mjs,accounttruth-census.mjs}`, `scripts/pg-lane/README.md`
- PG16 probe (index semantics and the `indkey` join), pytest and vitest runs

### Secondary (MEDIUM)
- `.planning/research/v1.22/ARCHITECTURE.md` (S4 row) and `PITFALLS.md` section E (holder rule before the refusal ships)

### Tertiary (LOW)
- None used as authority. No web search was needed; every claim is in-repo.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependencies.
- Architecture (swap function, index, writers): HIGH for the DB rules (read and probed), MEDIUM for the exact function signature (placeholder, planner decides).
- Deletion checkpoint: MEDIUM, FK graph read from the committed baseline (last carried migration `20261120120000`), the orchestrator re-verifies against live PROD `pg_constraint` and `pg_trigger` as part of the census.
- Pitfalls: HIGH.

**Research date:** 2026-11-23
**Valid until:** 2026-12-07, or the first merge touching `create-with-key/route.ts`, `account_identity.py`, or any migration under `supabase/migrations/` that touches `api_keys` (whichever is first)

## RESEARCH COMPLETE
