---
phase: 154-wizcont-stale-wizard-continuity-no-stale-screens
plan: 03
subsystem: database
tags: [postgres, supabase, migration, ddl, partial-unique-index, security-definer, rls, idempotency, wizard]

# Dependency graph
requires:
  - phase: 153.6-parity-the-fixes-that-only-landed-on-one-path
    provides: "migration 20260811210000 — the LATEST create_wizard_strategy body (attested_venue stamp, PR #675), the scrub-trigger pattern, and the aborting post-verify form this plan re-bases on and clones"
  - phase: 140.4-seamrim
    provides: "20260728120000 — the transactional-not-CONCURRENTLY rule, the pre-flight duplicate census form, and the tenant-leading partial-UNIQUE precedent"
provides:
  - "api_keys.venue_account_id — non-secret, venue-confirmed account identity (MT5 broker login today), NULL for venues that expose none"
  - "api_keys_user_exchange_venue_account_uniq — tenant-leading partial UNIQUE, the DB half of WIZCONT-02's 'one fence, two keys'"
  - "api_keys_scrub_venue_account_id — SECURITY INVOKER BEFORE INSERT trigger making the identity unwritable by clients"
  - "create_wizard_strategy 12-parameter signature (p_venue_account_id TEXT DEFAULT NULL), exactly one overload"
  - "supabase/tests/test_api_keys_venue_identity_uniq.sql — the CI SQL gate pinning all of the above"
affects: [154-06, 156-connect-refactor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DROP + CREATE (not CREATE OR REPLACE) for a SQL function signature change, with grants re-issued and single-overload asserted"
    - "post-verify owner-in-scrub-allowlist check, which only has teeth once DROP+CREATE can re-own the function"

key-files:
  created:
    - supabase/migrations/20260812120000_api_keys_venue_account_id.sql
    - supabase/tests/test_api_keys_venue_identity_uniq.sql
    - supabase/schema/functions/scrub_client_supplied_venue_account_id.sql
  modified:
    - supabase/schema/functions/create_wizard_strategy.sql
    - supabase/tests/test_wizard_session_idempotency.sql

key-decisions:
  - "Column is `venue_account_id text` — venue-neutral name, populated only by venues exposing a stable non-secret account id (MT5 alone today)"
  - "DROP + CREATE rather than CREATE OR REPLACE, because a signature change via the latter mints a SECOND overload and PostgREST answers PGRST203 to every connect-a-key call"
  - "Grants re-issued explicitly: DROP destroys the ACL and a fresh function grants EXECUTE to PUBLIC by default, so omitting the REVOKE would be a silent privilege escalation onto a SECURITY DEFINER function"
  - "Scrub trigger YES — a client-writable identity lets a caller evade the dedup for free by inventing an id"
  - "NO coupling CHECK — venue_account_id identifies an account WITHIN a venue, not a second opinion about which venue, so it has no must-equal twin the way attested_venue has `exchange`"
  - "add_wizard_composite_key deliberately NOT touched (TWIN-7): MT5 cannot be a composite member, so the composite path has no identity to stamp"
  - "No backfill: NULL is the correct value for every existing row, and an identity cannot be recovered from ciphertext"

patterns-established:
  - "Signature-change migration: DROP IF EXISTS old signature → CREATE → re-issue REVOKE/GRANT → re-stamp COMMENT → post-verify exactly-one-overload"
  - "Post-verify orders the overload-count check FIRST, because every later read resolves the function by its new signature"

requirements-completed: []

# Metrics
duration: ~35min
completed: 2026-08-12
---

# Phase 154 Plan 03: WIZCONT-02 Database Layer Summary

**A non-secret venue account identity on `api_keys`, fenced by a tenant-leading partial UNIQUE and made client-unwritable by a scrub trigger, with `create_wizard_strategy` re-signed to stamp it — written and gated, deliberately not applied.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-12T06:17Z (approx.)
- **Completed:** 2026-08-12T06:52Z
- **Tasks:** 2 of 3 (Task 3 is orchestrator-owned — see below)
- **Files modified:** 5 (3 created, 2 modified)

## ⛔ Task 3 was NOT started — it is the orchestrator's

Task 3 (`checkpoint:human-action`, gate=blocking) applies the migration to the TEST project
`qmnijlgmdhviwzwfyzlc` via Supabase MCP `apply_migration` and spawns the `migration-reviewer` and
`rls-policy-auditor` agents. Supabase MCP tools are stripped from subagent executors and I cannot
spawn those agents, so I left it unstarted by instruction.

**Nothing in this plan has been executed against any database.** No `supabase db push`, no MCP
apply, no psql. The migration is a file. `psql` is not installed in this worktree, so it has had no
local syntax parse either — the strongest local evidence is that
`scripts/dump-sql-functions.ts` (a quote- and dollar-quote-aware SQL splitter) parsed the file and
extracted the function body correctly, plus a balanced-quote scan over every non-comment line.

**Still owed before this can merge** (⚠️ merging `supabase/migrations/**` to `main`
AUTO-APPLIES to PROD `khslejtfbuezsmvmtsdn`):

1. MCP `apply_migration` to TEST, then run `supabase/tests/test_api_keys_venue_identity_uniq.sql`
   against TEST and observe the PASS notice.
2. Smoke that an 11-named-param `create_wizard_strategy` call still resolves without PGRST203, and
   that a direct authenticated INSERT carrying a `venue_account_id` is scrubbed to NULL.
3. `migration-reviewer` + `rls-policy-auditor` verdicts.

## Accomplishments

### Task 1 — the migration (`497daf59`)

`supabase/migrations/20260812120000_api_keys_venue_account_id.sql`, one transaction, in order:

1. `api_keys.venue_account_id text` + `COMMENT ON COLUMN`. No table GRANT/REVOKE and none needed —
   20260410225608 revoked table-level SELECT in favour of a per-column allowlist, so a new column is
   simply never readable by anon/authenticated. That satisfies the UI-SPEC "never echo it to the
   client" constraint structurally rather than by convention.
2. Pre-flight duplicate census over `(user_id, exchange, venue_account_id) WHERE … IS NOT NULL`,
   aborting with `ERRCODE = 'unique_violation'`. Satisfied **by construction** on day one (new
   column is NULL everywhere, the partial index excludes NULL) — and the header says so rather than
   relying on it silently, per RESEARCH. It is retained for the re-apply / partially-populated case.
3. `CREATE UNIQUE INDEX IF NOT EXISTS api_keys_user_exchange_venue_account_uniq ON public.api_keys
   (user_id, exchange, venue_account_id) WHERE venue_account_id IS NOT NULL` + `COMMENT ON INDEX`
   naming the fail-toward-the-existing-row contract. Transactional, not CONCURRENTLY.
4. `scrub_client_supplied_venue_account_id()` (SECURITY INVOKER, same
   `postgres/service_role/supabase_admin` allowlist) + `api_keys_scrub_venue_account_id`
   BEFORE INSERT trigger.
5. `create_wizard_strategy` — DROP the 11-arg signature, CREATE the 12-arg one, re-issue
   REVOKE/GRANT, re-stamp the COMMENT.
6. Post-verify `DO` block, every arm aborting.

### Task 2 — the CI SQL gate (`9d940d84`)

`supabase/tests/test_api_keys_venue_identity_uniq.sql`, 18 `RAISE EXCEPTION` arms across the five
assertion groups the plan specified. Two donor disciplines carried deliberately:

- **The index column list is read from `pg_index`/`unnest(...) WITH ORDINALITY`, never by
  substring-matching `indexdef`.** The index NAME contains every column name and appears inside its
  own definition text, so `indexdef ILIKE '%exchange%'` passes vacuously even with the column
  dropped from the key. Partiality is asserted twice — structurally (`indpred IS NOT NULL`) and by
  predicate text.
- **The trigger's function is resolved through `pg_trigger.tgfoid`, not by name**, so the
  `prosecdef = false` assertion is about the function actually ATTACHED. A same-named function
  sitting unattached in the schema would prove nothing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] The hermetic SQL-function snapshot gate would have reddened the PR**

- **Found during:** Task 1
- **Issue:** `.github/workflows/sql-function-snapshot.yml` (tech-debt #2) replays every migration and
  fails the PR if `supabase/schema/functions/` is stale. Changing `create_wizard_strategy` and adding
  a new function makes it stale by definition. `--check` confirmed: *"missing:
  scrub_client_supplied_venue_account_id.sql / stale: create_wizard_strategy.sql"*.
- **Fix:** ran `npm run schema:functions` and committed the regenerated snapshot.
- **Bonus verification this bought:** the regenerated `create_wizard_strategy.sql` contains **exactly
  one** `CREATE OR REPLACE FUNCTION` with 12 parameters, sourced from `20260812120000`. The gate keys
  functions by `name/argCount` and honours `DROP FUNCTION`, so this is independent evidence that the
  DROP targets the right arity and leaves **no phantom 11-arg overload** — the PGRST203 hazard,
  checked without a database.
- **Files:** `supabase/schema/functions/create_wizard_strategy.sql`,
  `supabase/schema/functions/scrub_client_supplied_venue_account_id.sql`
- **Commit:** `497daf59`

**2. [Rule 1 — Bug] An existing CI SQL gate pins the 11-arg signature and would have errored**

- **Found during:** Task 1
- **Issue:** `supabase/tests/test_wizard_session_idempotency.sql:113,117` calls
  `has_function_privilege(..., 'create_wizard_strategy(uuid,…,uuid)', 'EXECUTE')`. That text form
  matches the DECLARED argument list **exactly and ignores defaults**, so an 11-type string does not
  resolve to a 12-parameter function — it raises `undefined_function`. The gate would have failed
  with a confusing "function does not exist" rather than a grant verdict, and it would have looked
  like a regression in the F6 fence rather than in this plan.
- **Fix:** re-cut both signature strings to the 12-type form, with a comment recording why the type
  list moved and why the positional callers elsewhere did not need to.
- **Verified not-a-wider-break:** the other three SQL tests that *call* the RPC
  (`test_api_keys_exchange_not_user_writable.sql:350`, `test_csv_finalize_double_submit.sql:218`,
  `test_wizard_composite_fence.sql:194,208`) all use **11 positional arguments**, which still resolve
  against a trailing `DEFAULT NULL` parameter. They are untouched and remain correct.
- **Files:** `supabase/tests/test_wizard_session_idempotency.sql`
- **Commit:** `497daf59`

**3. [Rule 2 — Missing critical functionality] Post-verify gained an owner check the donor did not need**

- **Found during:** Task 1
- **Issue:** `20260811210000`'s check (f) asserts `create_wizard_strategy`'s owner is in the scrub
  allowlist, but there it could not actually regress — `CREATE OR REPLACE` **inherits** the owner.
  This migration DROPs and re-creates, so the owner becomes whichever role applies it. If that role
  fell outside the allowlist the failure would be **silent and total**: both scrub triggers fire on
  the RPC's own INSERT, `attested_venue` *and* `venue_account_id` both land NULL, every MT5 finalize
  answers a permanent `KEY_SCOPE_CHECK_UNAVAILABLE`, and the migration reports success.
- **Fix:** carried check (f) forward (owner in allowlist + the allowlist really being the one the
  trigger body enforces) and added a `prosecdef` assertion on the new scrub function, in the
  migration and again in the SQL gate.
- **Commit:** `497daf59`

### Judgement calls recorded rather than deviated

- **No coupling CHECK for `venue_account_id`.** The plan left this open ("decide deliberately and
  record the reasoning either way"). `api_keys_attested_venue_matches_exchange` exists because
  `attested_venue` is an attestation of the *same fact* as `exchange`, so disagreement is incoherent.
  `venue_account_id` identifies an account *within* a venue and has no column it must equal. A CHECK
  here would be cargo-culted shape. The existing CHECK and the existing
  `api_keys_scrub_attested_venue` trigger are untouched, and post-verify (e) asserts the older
  trigger survived so this migration cannot have silently displaced it.
- **Two BEFORE INSERT triggers on one table.** Postgres fires BEFORE ROW triggers alphabetically, so
  `api_keys_scrub_attested_venue` runs first. Order is irrelevant (each clears a different column and
  returns NEW) but it is stated in the header so a future reader need not re-derive it.

## Deferred Issues

**`src/lib/database.types.ts` does not yet carry `p_venue_account_id` — blocking for 154-06, not for
this PR.** The generated Supabase types still describe the 11-parameter RPC. Nothing breaks today
(no TypeScript passes the new parameter yet, and no TS file was touched by this plan), but **154-06
will not typecheck** when it starts sending `p_venue_account_id` until the types are regenerated.
Regeneration reads a live database, so it is genuinely blocked on Task 3 applying the migration to
TEST. Sequence for the orchestrator: Task 3 → regenerate types → 154-06.

## Threat Flags

None. The migration's surface is exactly the threat register's: the scrub trigger discharges
T-154-03-A, `user_id` leading the index discharges T-154-03-B, the triple canary discharges
T-154-03-C, the DROP + single-overload assertion discharges T-154-03-D, and T-154-03-E is discharged
by construction — `api_key_encrypted` appears in the file only inside the re-based RPC body (the
parameter and the INSERT column list) and in two prose warnings, never in an index expression.

One item worth the reviewer's eye, disclosed rather than flagged: **DROP + CREATE destroys the
function ACL**, which is a privilege-escalation surface that did not exist in the donor migration.
It is closed by an explicit `REVOKE ALL … FROM PUBLIC, anon` and asserted in both post-verify and the
external SQL gate, but it is the single most consequential difference between this migration and
`20260811210000` and should be read closely.

## Known Stubs

None. No placeholder values, no unwired data paths — this plan produces DDL and an assertion file
only.

## Requirements

`requirements-completed: []` — **deliberately empty, and this is not an oversight.** The plan's
frontmatter claims `WIZCONT-02`, but two things are outstanding: Task 3 (the blocking TEST-apply and
reviewer gate) has not run, and this plan is only the DB half of "one fence, two keys" — 154-06 wires
the app-layer fence in `create-with-key/route.ts` and the writer that actually supplies the identity.
Marking the requirement complete here would report a capability that does not yet exist end to end.

## Verification

| Check | Result |
|---|---|
| Header cites `20260811210000` as re-base source | 14 references |
| `20260602190000` used as a re-base source | **0** — its 3 mentions are a "do NOT re-base on it" warning, a grant-provenance note, and a migration-history list in a COMMENT |
| `CREATE UNIQUE INDEX` DDL statements | 1 (line 236); the other 3 greps are comments/messages |
| Index lists `user_id` FIRST | yes |
| Partial predicate present | yes, `WHERE venue_account_id IS NOT NULL` |
| `DEFAULT NULL` on `p_venue_account_id` | yes — additive for all existing callers |
| `RAISE EXCEPTION` arms in the migration | 20 (plan floor: 5) |
| `api_key_encrypted` in any index expression | **no** — only the RPC parameter/INSERT column list and two prose warnings |
| SQL gate `RAISE EXCEPTION` arms | 18 (plan floor: 8) |
| SQL gate `WITH ORDINALITY` column-order query | present |
| SQL gate asserts partiality | twice — `indpred IS NOT NULL` and predicate text |
| Snapshot drift gate | `SQL function snapshot is current (111 functions)` |
| Snapshot shows a single 12-arg definition | yes, sourced from `20260812120000` |
| Parser self-test | `SELF-TEST PASS: 11 assertions` |
| Balanced single quotes, all non-comment lines | both files clean |
| Migration executed anywhere | **no** |

## Self-Check: PASSED

Files:
- FOUND: `supabase/migrations/20260812120000_api_keys_venue_account_id.sql`
- FOUND: `supabase/tests/test_api_keys_venue_identity_uniq.sql`
- FOUND: `supabase/schema/functions/scrub_client_supplied_venue_account_id.sql`
- FOUND: `supabase/schema/functions/create_wizard_strategy.sql` (modified)
- FOUND: `supabase/tests/test_wizard_session_idempotency.sql` (modified)

Commits:
- FOUND: `497daf59` — feat(154-03): migration + snapshot + signature re-cut
- FOUND: `9d940d84` — test(154-03): CI SQL gate

No file deletions in either commit. No untracked files left behind. `STATE.md` and `ROADMAP.md` not
modified (orchestrator-owned).
