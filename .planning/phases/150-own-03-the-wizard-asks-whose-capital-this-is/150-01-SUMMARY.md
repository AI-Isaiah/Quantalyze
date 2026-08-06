---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
plan: 01
subsystem: database
tags: [migration, trigger, rls, invariant, own-03, d-03-a, money-path]
status: checkpoint-blocked
requires: []
provides:
  - "public.strategies.capital_ownership TEXT NULL (CHECK own_capital|team_review, constraint strategies_capital_ownership_check)"
  - "public.guard_allocation_requires_own_capital() — SECURITY DEFINER trigger fn"
  - "trg_portfolio_strategies_own_capital_only — BEFORE INSERT ON public.portfolio_strategies"
  - "public.flip_capital_ownership_to_team_review(uuid) RETURNS TABLE (removed_positions integer, updated_strategies integer)"
affects:
  - "every portfolio_strategies INSERT path repo-wide (routes, client-direct, seed, raw PostgREST)"
tech-stack:
  added: []
  patterns:
    - "DROP-then-ADD CHECK constraint idiom (20260716130000 analog)"
    - "self-verifying DO block at migration tail (pg_get_constraintdef / information_schema.triggers / pg_get_functiondef)"
    - "plain PL/pgSQL DO-block DB tests under psql -v ON_ERROR_STOP=1 (house convention; pgTAP is NOT installed)"
key-files:
  created:
    - supabase/migrations/20260806120000_strategies_capital_ownership.sql
    - supabase/tests/test_capital_ownership_column.sql
    - supabase/tests/test_capital_ownership_allocation_guard.sql
  modified: []
decisions:
  - "Trigger function is SECURITY DEFINER — under INVOKER the mark lookup is RLS-filtered and the unconditional team_review arm goes blind (Rule 2)"
  - "DB tests are plain PL/pgSQL DO blocks, not pgTAP — the extension is not installed and 0/53 existing files use plan/ok/finish (Rule 11)"
  - "Added structural case 7c pinning the flip RPC's auth.uid() predicates — RLS masks their removal, so the behavioural arm alone is blind (measured, ledger M6)"
metrics:
  tasks_completed: 1
  tasks_total: 2
  commits: 2
  mutations_run: 7
  mutations_caught: 7
  completed: 2026-08-06
---

# Phase 150 Plan 01: Capital-Ownership Mark + D-03-A Allocation Invariant Summary

The OWN-03 ownership mark now exists at the database tier as a nullable, un-backfilled
`strategies.capital_ownership` column, with the D-03-A hard invariant enforced by a
`BEFORE INSERT` trigger on `portfolio_strategies` that holds against every insert path
including the two shipped browser-direct writes, plus a single-transaction mark-flip RPC
that closes the stranded-position hole.

**Status: Task 1 complete and committed. Task 2 is a BLOCKING human-action checkpoint —
the migration is NOT applied anywhere yet.**

## What Was Built

**`supabase/migrations/20260806120000_strategies_capital_ownership.sql`** — five parts:

1. Header carrying all six required decisions: D-04 strategy-level storage; nullable /
   no-default / no-backfill and why a default would fabricate a claim about Black Swan,
   Alpha Centauri and Arctic Fox; three display states vs two logic states; the D-03-A
   predicate rationale naming the three third-party paths it preserves; why no RLS change
   is needed; and the conscious acceptance that the mark is publicly readable on published
   rows via the `strategies_read` splat. Also records the re-base grep (zero prior art).
2. `ADD COLUMN IF NOT EXISTS capital_ownership TEXT` + `COMMENT ON COLUMN` + pre-flight
   `DO` block + DROP-then-ADD `strategies_capital_ownership_check`.
3. `guard_allocation_requires_own_capital()` + `trg_portfolio_strategies_own_capital_only`,
   `BEFORE INSERT` only.
4. `flip_capital_ownership_to_team_review(uuid)` — DELETE the caller's positions then
   UPDATE the mark, one plpgsql body = one transaction. `SECURITY INVOKER`, explicit
   `auth.uid()` predicates, `REVOKE ALL ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated`.
5. Self-verifying `DO` block asserting the CHECK members, the column's nullability with no
   default, that the trigger fires on the INSERT event and **no other**, that both D-03-A
   arms are present in the function body, and that the RPC exists.

**Two DB test files** encoding the eight required behaviours plus two additions (2c and 7c,
below).

## Key Decisions

### 1. The trigger function is `SECURITY DEFINER` (deviation — Rule 2)

The plan specified the trigger function as "plpgsql, `SET search_path`" without naming a
security context. Written as `SECURITY INVOKER` (the default, and what the cited analog
`guard_strategies_publish_transition` uses), the guard's own lookups are RLS-filtered by
the *inserting* session. `strategies_read` is `status='published' OR user_id=auth.uid()`,
so an authenticated caller inserting a position for **another owner's unpublished
`team_review` strategy** reads zero rows, leaves `v_mark` NULL, and passes the guard.

That makes the plan's own must-have — "RAISEs when the strategy is marked team_review
(UNCONDITIONALLY — SC 2b literally)" — false for exactly the rows an attacker would
choose. `SECURITY DEFINER` is the root-cause fix. It is safe here: the function takes no
arguments, performs no writes, only ever RAISEs, and its grants are revoked from PUBLIC,
`anon` and `authenticated` so it is not invocable via PostgREST. The divergence from the
analog is deliberate and documented in the migration header §(d.2) — that analog is
INVOKER *because* it keys on `current_user`; this one has no such dependency.

Pinned by allocation-guard **case 2c**, which first proves the caller genuinely cannot
`SELECT` the fixture strategy (so the case cannot pass vacuously) and then proves the
guard fires anyway.

### 2. DB tests are plain PL/pgSQL, not pgTAP (deviation — Rule 11)

The plan and RESEARCH both say "pgTAP" and the plan asks for "plan/ok/finish". **pgTAP is
not installed in this project.** Zero of the 53 existing `supabase/tests/test_*.sql` files
use `plan()`/`ok()`/`finish()`; there is no `CREATE EXTENSION pgtap` anywhere in
`supabase/` or `.github/`. The house convention — stated verbatim in
`test_strategies_private_owner_isolation.sql:38-44` — is plain `DO $$ ... $$` with
`RAISE EXCEPTION` on failure and `RAISE NOTICE` on pass, run by the CI `sql-tests` loop
under `psql -v ON_ERROR_STOP=1`. The new files match that. Discovery by the
`supabase/tests/test_*.sql` glob and the fail-the-job semantics are identical, so the
plan's verify command and CI wiring are unaffected.

### 3. Added structural case 7c to cover a hole the behavioural test cannot see

Ledger mutation M6 (stripping the `auth.uid()` predicate from the flip RPC's UPDATE)
**stayed green**: RLS `strategies_update USING (user_id = auth.uid())` independently
reduces a non-owner flip to zero rows, so case 7b cannot observe the loss. The in-body
predicates are defence-in-depth that matters the moment anyone makes the function
`SECURITY DEFINER` or calls it from a service-role context. Case 7c pins them structurally
via `pg_get_functiondef`. This closes the last blind spot.

## Verification Performed

pgTAP-against-TEST is Task 2 (blocked). To avoid handing the human checkpoint an unproven
migration, an **ephemeral local Postgres 16 cluster** was stood up with a minimal but
faithful stand-in schema (`auth.users`, `auth.uid()`, `profiles`, `strategies`,
`portfolios`, `portfolio_strategies`, the four relevant RLS policies, and the
`anon`/`authenticated`/`service_role` roles). Fixture column shapes were matched to the
inserts already proven green in CI (`test_strategies_private_owner_isolation.sql` for
strategies/profiles/auth.users, `test_get_latest_portfolio_analytics_for_user.sql:156` for
portfolios), and no later migration adds a NOT NULL column to either portfolio table.

- **RED proven** — both files fail against the unmigrated schema:
  `TEST FAILED (1): strategies.capital_ownership does not exist — migration 20260806120000 not applied`
  and `column "capital_ownership" of relation "strategies" does not exist`.
- **GREEN proven** — migration applies cleanly, its self-check emits
  `OWN-03 capital_ownership migration self-check passed`, and both files report ALL PASS.
- **Task 1 automated verify** (the plan's `<verify><automated>` command): PASS.
- Acceptance greps: `BEFORE INSERT ON public.portfolio_strategies` = 1; no line containing
  `BEFORE INSERT` also contains `OR UPDATE` (the literal token appears nowhere in the
  file, so the guard is immune to comment edits in both directions); `FROM portfolios` = 3
  (≥2 required); `ADD COLUMN IF NOT EXISTS capital_ownership TEXT` present with no
  `DEFAULT` and no `NOT NULL`; no backfill UPDATE against existing strategies rows.
- `grep -rln "capital_ownership" supabase/migrations/` → exactly the one new file.
- Every UPDATE/DELETE predicate in both test files was read individually: two fixture-scoped
  UPDATEs naming generated ids, and the two conventional pre-clean `DELETE FROM auth.users`
  statements scoped to this phase's own sentinel emails. No table-wide mutation.

### Rule-9 mutation ledger — 7 semantic mutations, 7 caught

| # | Mutation to the migration | Result |
|---|---|---|
| M1 | trigger fn `SECURITY DEFINER` → `SECURITY INVOKER` | RED — `TEST FAILED (2c): a third-party team_review strategy the caller CANNOT READ became a position — the trigger function is RLS-blind` |
| M2 | predicate → blanket `IS DISTINCT FROM 'own_capital'` (drop the owner-equality conjunct) | RED — case 8a: `strategy <id> cannot become a position: capital_ownership=unmarked`. This is the mutation that would have deleted AddToPortfolio, MigrationWizard and the demo seed |
| M3 | drop the unconditional `team_review` arm | RED — `TEST FAILED (2b): ... the team_review arm is supposed to be UNCONDITIONAL (SC 2b)` |
| M4a | widen the trigger to also fire on the UPDATE event | RED at apply — `OWN-03 migration failed: trg_... fires on 1 non-INSERT event(s) — the alias UPDATE on legacy unmarked rows would break` |
| M4b | same, with the self-verifying block stripped | RED — case 5 (legacy-alias UPDATE) raises out of the trigger |
| M5a | column given `DEFAULT 'team_review'` | RED at apply — `OWN-03 migration failed: capital_ownership must be nullable with no default` |
| M5b | same, with the self-verifying block stripped | RED — `TEST FAILED (3): ... has a column default ('team_review'::text) — a default stamps every legacy strategy with a claim nobody made` |
| M6 | flip RPC UPDATE loses its `auth.uid()` predicate | **Initially GREEN (blind).** Fixed by adding case 7c; now RED — `TEST FAILED (7c)` |

M6 is the honest finding here: the suite had a blind spot, it was measured rather than
assumed, and the fix is committed.

## Deviations from Plan

### Auto-fixed

**1. [Rule 2 — Missing critical functionality] Trigger function made `SECURITY DEFINER`**
- **Found during:** Task 1, while reasoning about which role's RLS applies to the guard's
  own `SELECT`s.
- **Issue:** As `SECURITY INVOKER`, the mark lookup is RLS-filtered by the inserting
  session, so the "unconditional" `team_review` arm silently does not fire for strategies
  the caller cannot read — violating the plan's own must-have and threat T-150-01.
- **Fix:** `SECURITY DEFINER` + revoked grants + header §(d.2) rationale; pinned by
  case 2c with a non-vacuity pre-assertion.
- **Files:** `supabase/migrations/20260806120000_strategies_capital_ownership.sql`,
  `supabase/tests/test_capital_ownership_allocation_guard.sql`
- **Commit:** `99285150` (migration), `5e25495e` (test)

**2. [Rule 11 — Match codebase conventions] Plain PL/pgSQL DO blocks instead of pgTAP**
- **Found during:** Task 1, reading `supabase/tests/` for the harness shape as instructed.
- **Issue:** The plan asks for pgTAP `plan/ok/finish`; the extension is not installed and
  0/53 existing files use it.
- **Fix:** Matched the house convention. CI discovery, exit semantics and the plan's verify
  command are unchanged.
- **Commit:** `5e25495e`

**3. [Rule 2 — Missing critical functionality] Added structural case 7c**
- **Found during:** the mutation ledger (M6 stayed green).
- **Issue:** The flip RPC's explicit `auth.uid()` predicates could be deleted with no test
  reddening, because RLS `USING` masks the behavioural effect.
- **Fix:** Case 7c pins both predicates via `pg_get_functiondef`.
- **Commit:** `5e25495e`

### Not deviations, but recorded

- The migration uses explicit `BEGIN`/`COMMIT` per the plan (the
  `strategies_status_private.sql` analog does the same). MCP `apply_migration` wraps
  statements in its own transaction, so expect a harmless
  "there is already a transaction in progress" WARNING at apply. Not an error.
- MCP `apply_migration` stamps `now()`, so the TEST-side migration timestamp will drift
  from the `20260806120000` filename (MEMORY `feedback_supabase_apply_migration_drift`).
  Expected; record it at apply time.

## Follow-Ups / Watch Items

- **`scripts/seed-full-app-demo.ts` is now trigger-exposed.** Its holdings upserts run via
  the service-role client, which bypasses RLS but **not** the trigger. The plan asserts
  these are all third-party (allocator portfolio × manager strategy) and they were read to
  confirm the shape, but the seed was not executed against a migrated database in this
  plan. If any persona portfolio ever holds a strategy owned by that same persona, the
  seed will start failing with `check_violation` once this migration is applied. Worth a
  seed run after the TEST apply.
- Threat T-150-38 (accepted-with-consequence): a discovery `AddToPortfolio` click on the
  viewer's OWN unmarked/team_review published strategy now raises `23514` and the shipped
  component renders a generic failure. Plan 06 owns the error mapping.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or trust-boundary schema
surface beyond what the plan's `<threat_model>` already registers. `capital_ownership`
being readable by `anon` on published rows is T-150-04, dispositioned `accept` and written
into the migration header as a decision.

## Task 2 — NOT DONE (blocking checkpoint)

The migration exists in `supabase/migrations/` but is **not applied anywhere**. It must be
applied to TEST (`qmnijlgmdhviwzwfyzlc`, never PROD `khslejtfbuezsmvmtsdn`) via Supabase MCP
`apply_migration` from the orchestrator session — MCP tools are stripped from subagents
(upstream anthropics/claude-code#13898) — and then both test files run against TEST with
`psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <file>`.

The local-cluster run above raises confidence that the SQL is correct and the oracles have
teeth, but it is **not** a substitute: it ran against a stand-in schema, not the real TEST
database with its full migration history, its other triggers on `strategies`, and its
shared-tenant row population.

## Self-Check: PASSED

All four claimed files exist on disk; all three claimed commits exist in `git log`
(`5e25495e`, `99285150`, `8c339681`); worktree clean; no file deletions in either task
commit; no truncation (371 / 186 / 488 SQL lines, 234 summary lines).
