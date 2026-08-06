---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
plan: 01
subsystem: database
tags: [migration, trigger, rls, invariant, own-03, d-03-a, money-path, prod-bugfix, security-definer]
status: checkpoint-blocked
requires: []
provides:
  - "public.strategies.capital_ownership TEXT NULL (CHECK own_capital|team_review, constraint strategies_capital_ownership_check)"
  - "public.guard_allocation_requires_own_capital() — SECURITY DEFINER trigger fn"
  - "trg_portfolio_strategies_own_capital_only — BEFORE INSERT ON public.portfolio_strategies"
  - "public.flip_capital_ownership_to_team_review(uuid) RETURNS TABLE (removed_positions integer, updated_strategies integer)"
  - "public.seed_weight_snapshot_for_portfolio_strategy() / seed_weight_snapshots_for_portfolio() — repaired to SECURITY DEFINER (PROD bug fix, see Deviation 4)"
affects:
  - "every portfolio_strategies INSERT path repo-wide (routes, client-direct, seed, raw PostgREST)"
  - "every authenticated-role INSERT into portfolios and portfolio_strategies — unblocked by the seed-trigger repair (broken in PROD since 2026-04-16)"
tech-stack:
  added: []
  patterns:
    - "DROP-then-ADD CHECK constraint idiom (20260716130000 analog)"
    - "self-verifying DO block at migration tail (pg_get_constraintdef / information_schema.triggers / pg_get_functiondef)"
    - "plain PL/pgSQL DO-block DB tests under psql -v ON_ERROR_STOP=1 (house convention; pgTAP is NOT installed)"
key-files:
  created:
    - supabase/migrations/20260806120000_strategies_capital_ownership.sql
    - supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql
    - supabase/tests/test_capital_ownership_column.sql
    - supabase/tests/test_capital_ownership_allocation_guard.sql
    - supabase/tests/test_weight_snapshot_seed_secdef.sql
    - supabase/schema/functions/guard_allocation_requires_own_capital.sql
    - supabase/schema/functions/flip_capital_ownership_to_team_review.sql
  modified:
    - supabase/schema/functions/seed_weight_snapshot_for_portfolio_strategy.sql
    - supabase/schema/functions/seed_weight_snapshots_for_portfolio.sql
decisions:
  - "Trigger function is SECURITY DEFINER — under INVOKER the mark lookup is RLS-filtered and the unconditional team_review arm goes blind (Rule 2)"
  - "DB tests are plain PL/pgSQL DO blocks, not pgTAP — the extension is not installed and 0/53 existing files use plan/ok/finish (Rule 11)"
  - "Added structural case 7c pinning the flip RPC's auth.uid() predicates — RLS masks their removal, so the behavioural arm alone is blind (measured, ledger M6)"
  - "Repaired the weight_snapshots seed triggers to SECURITY DEFINER rather than adding an INSERT policy — the deny policies are the design; a policy would fix the symptom by deleting the invariant (Rule 1/6, PROD bug live since 2026-04-16)"
metrics:
  tasks_completed: 1
  tasks_total: 2
  commits: 4
  mutations_run: 12
  mutations_caught: 12
  completed: 2026-08-06
---

# Phase 150 Plan 01: Capital-Ownership Mark + D-03-A Allocation Invariant Summary

The OWN-03 ownership mark now exists at the database tier as a nullable, un-backfilled
`strategies.capital_ownership` column, with the D-03-A hard invariant enforced by a
`BEFORE INSERT` trigger on `portfolio_strategies` that holds against every insert path
including the two shipped browser-direct writes, plus a single-transaction mark-flip RPC
that closes the stranded-position hole.

**Status: Task 1 complete and committed. Task 2 (TEST apply) was executed once by the
orchestrator and is NOW PENDING AGAIN — the column test passed against TEST, the
allocation-guard test tripped a pre-existing PRODUCTION defect unrelated to this plan's
own objects, and that defect has been repaired by a second migration
(`20260806130000_seed_weight_snapshot_secdef.sql`) which is not applied anywhere yet.
See "Deviation 4" and "Task 2 — status" below.**

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

**`supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql`** (deviation — see
Deviation 4) — repairs a four-month-old production defect that blocks this plan's positive
control and the whole OWN-03 money path: the two `weight_snapshots` seed trigger functions
are made `SECURITY DEFINER`, with a self-verifying block asserting the repair landed AND
that the three `weight_snapshots` write-deny policies survived intact.

**`supabase/tests/test_weight_snapshot_seed_secdef.sql`** — regression test naming that
invariant directly, so a future revert fails with a message pointing at the real cause
rather than a raw `42501` out of an unrelated table.

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

### Verification of the Deviation-4 repair (second execution pass)

A fresh ephemeral **local Postgres 16** cluster was stood up carrying the *landmine* schema
this time — `weight_snapshots` with its unique-per-day index and all four RLS policies, both
seed trigger functions verbatim from `20260416125431` as `SECURITY INVOKER`, both triggers
installed, and the `anon` / `authenticated` / `service_role` roles. Deliberately stricter
than production on the one axis that matters: the tables and functions are owned by a
**non-superuser, non-`BYPASSRLS`** role, so the DEFINER context's exemption comes from table
ownership alone rather than from a superuser shortcut.

- **RED reproduced independently** — the real
  `test_capital_ownership_allocation_guard.sql`, run unmodified against the INVOKER schema,
  fails on case 1 with the byte-identical error and CONTEXT chain the orchestrator saw on
  TEST (`42501 ... PL/pgSQL function seed_weight_snapshot_for_portfolio_strategy()` inside
  the `portfolio_strategies` INSERT).
- **GREEN after `20260806130000`** — its self-check emits *"seed_weight_snapshot SECURITY
  DEFINER repair verified"*, and **all three** DB test files report ALL PASS:
  `test_capital_ownership_column`, `test_capital_ownership_allocation_guard` (assertions
  unchanged) and the new `test_weight_snapshot_seed_secdef`.
- **REVOKE proven harmless empirically:** after `REVOKE ALL ... FROM PUBLIC, anon,
  authenticated`, `has_function_privilege('authenticated', fn, 'EXECUTE')` is `false` for
  both functions *and* the `authenticated`-role INSERT still fires the trigger and
  succeeds — the direct measurement behind the "trigger firing does not check EXECUTE"
  claim.
- `npx tsx scripts/dump-sql-functions.ts --check` → *"SQL function snapshot is current (107
  functions)"*. The generated diff for the seed function is exactly one added line
  (`SECURITY DEFINER`) plus the source-migration header — the whole point of keeping the
  bodies byte-identical.

#### Rule-9 mutation ledger, second pass — 5 mutations, 5 caught

| # | Mutation | Caught by | Result |
|---|----------|-----------|--------|
| M7 | both seed fns back to `SECURITY INVOKER` | migration self-check 3a | RED at apply — *"public.seed_weight_snapshot_for_portfolio_strategy() is still SECURITY INVOKER — every authenticated INSERT into portfolio_strategies stays broken"* |
| M8 | `ALTER TABLE weight_snapshots FORCE ROW LEVEL SECURITY` | migration self-check 3b | RED at apply — *"the table owner is NOT exempt, so SECURITY DEFINER does not clear the insert-deny policy"* |
| M9 | `DROP POLICY weight_snapshots_insert_deny` | migration self-check 3c | RED at apply — *"expected the 3 weight_snapshots write-deny policies to survive intact, found 2"* |
| M10 | revert **only** the latent fan-out sibling to INVOKER | regression test case 3 | RED — *"public.seed_weight_snapshots_for_portfolio() is SECURITY INVOKER"*. No behavioural case can reach this function; without case 3 the mutation is invisible |
| M11 | apply the **rejected alternative** — an owner-scoped `weight_snapshots` INSERT policy | regression test case 2 | RED — *"an authenticated session wrote weight_snapshots DIRECTLY"*. This mutation makes case 1 pass, which is exactly why case 2 exists |

M10 and M11 are the load-bearing ones: they pin the two properties the obvious test would
have missed — the latent half of the defect class, and the difference between fixing the
bug and deleting the invariant.

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

**4. [Rule 1 — Bug] Repaired a PRODUCTION defect: the `weight_snapshots` seed triggers ran
`SECURITY INVOKER` against a table that denies all client writes**

- **Found during:** Task 2. The orchestrator applied `20260806120000` to TEST (clean, with
  its self-check green) and ran both DB test files. `test_capital_ownership_column.sql`
  passed. `test_capital_ownership_allocation_guard.sql` failed on **case 1, the positive
  control**, with an error that has nothing to do with any object this plan created:

  ```
  ERROR 42501: new row violates row-level security policy for table "weight_snapshots"
  CONTEXT: SQL statement "INSERT INTO weight_snapshots (...) ON CONFLICT ... DO NOTHING"
           PL/pgSQL function seed_weight_snapshot_for_portfolio_strategy() line 3
           SQL statement "INSERT INTO portfolio_strategies ... VALUES (port_a, strat_a_own, 120000)"
  ```

- **Root cause (two individually-correct migrations, mutually lethal):**
  `20260416125431_rebalance_drift_check_and_trigger.sql:106-156` installed two `AFTER
  INSERT` trigger functions — `seed_weight_snapshot_for_portfolio_strategy()` (on
  `portfolio_strategies`) and `seed_weight_snapshots_for_portfolio()` (on `portfolios`) —
  that write a companion `weight_snapshots` row. Neither declares a security context, so
  both are `SECURITY INVOKER` and their write is evaluated under the RLS of the firing
  session. `20260412094451_weight_snapshots.sql:80-90` denies **all** client writes to
  `weight_snapshots` (`weight_snapshots_insert_deny FOR INSERT WITH CHECK (false)`, plus
  update/delete deny). So since **2026-04-16**, every `authenticated`-role INSERT into
  `portfolio_strategies` has aborted with `42501`. `ON CONFLICT DO NOTHING` does not rescue
  it — RLS `WITH CHECK` is evaluated before conflict resolution. Service-role writes were
  unaffected (BYPASSRLS), which is why nothing surfaced for four months.

- **This is live in PROD, not theoretical.** Two shipped components insert
  `portfolio_strategies` straight from the browser under the user's own JWT —
  `src/components/portfolio/AddToPortfolio.tsx:54` and
  `src/components/portfolio/MigrationWizard.tsx:72` — and both have been dead since
  2026-04-16. Corroborating census on PROD: only 4 `portfolio_strategies` rows with
  `added_at` after 2026-04-16, the most recent 2026-04-26. Catalog state verified live on
  BOTH TEST and PROD: `prosecdef = false` for both functions, deny policies identical.
  This plan's guard test is simply the first automated test ever to insert a
  `portfolio_strategies` row as the `authenticated` role — every prior DB test wrote as the
  seeding role, and the predecessor's local stand-in schema had no `weight_snapshots` table
  at all, which is why the local RED/GREEN pass missed it.

- **Why it could not be deferred (Rule 3, blocking):** with the landmine in place the
  D-03-A guard is unobservable — the insert dies at `42501` before anyone can tell whether
  the guard would have admitted it. Plan 05's allocation route inserts into
  `portfolio_strategies` under the user's context and Wave 2 builds on it, so the phase's
  entire money path is behind this.

- **Fix:** new forward-only migration
  `supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql` making **both** seed
  functions `SECURITY DEFINER` with the pinned `SET search_path = public, pg_catalog` they
  already carried. Bodies re-based on `20260416125431` (verified the only defining
  migration; live TEST bodies match it verbatim) and left **byte-identical except the one
  added line**, so the `supabase/schema/functions/` diff is a single line.

- **Class, not instance.** `seed_weight_snapshots_for_portfolio()` has the identical defect
  and is fixed too, even though its fan-out is *latent* today: the
  `portfolio_strategies.portfolio_id` FK stops a child row pre-dating its parent, so the
  `INSERT ... SELECT` currently returns zero rows on the ordinary path. A restore, a bulk
  load or any deferred-FK path turns it into the same `42501`.

- **The deny policies are UNTOUCHED**, and the migration asserts they survived. They are
  the design: `target_weight` / `actual_weight` are derived allocation history and a
  client-writable path would let an allocator fabricate it. `SECURITY DEFINER` is exactly
  the distinction between the database's own bookkeeping write and a client write — the
  same argument `20260806120000` header §(d.2) already makes for the D-03-A guard.
  Alternatives rejected in the header: an owner-scoped INSERT policy (fixes the symptom by
  deleting the invariant), and dropping the seed triggers (silently changes the
  `rebalance_drift` null-target guard's ground truth).

- **The trigger-ACL trap was checked, not assumed.**
  `20260516170000_match_decisions_visibility_check_secdef_fix.sql` documents this project's
  one production-breaking REVOKE incident — a trigger function that `PERFORM`ed a *separate*
  REVOKEd helper, and a nested function CALL *does* check EXECUTE. It does not apply here:
  Postgres checks EXECUTE on a trigger function at `CREATE TRIGGER` time, not at fire time,
  and neither seed body calls another function. Proven empirically on the local cluster —
  `has_function_privilege('authenticated', ...) = false` after the REVOKE while the trigger
  still fires and the insert succeeds.

- **No data backfill is needed.** The failing inserts aborted the whole statement, so no
  `portfolio_strategies` row was ever created without its companion `weight_snapshots` row.
  Service-role writes during the window succeeded on both tables.

- **Files:** `supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql`,
  `supabase/tests/test_weight_snapshot_seed_secdef.sql`,
  `supabase/schema/functions/seed_weight_snapshot_for_portfolio_strategy.sql`,
  `supabase/schema/functions/seed_weight_snapshots_for_portfolio.sql`
- **Commit:** `8a532f01`

**5. [Rule 3 — Blocking] Regenerated the SQL function snapshot; the CI gate was red**

- **Found during:** the Deviation-4 work, running `npx tsx scripts/dump-sql-functions.ts
  --check`.
- **Issue:** commit `99285150` added `guard_allocation_requires_own_capital()` and
  `flip_capital_ownership_to_team_review(uuid)` without running `npm run schema:functions`.
  The `.github/workflows/sql-function-snapshot.yml` `--check` gate is path-triggered on
  `supabase/migrations/**` and reported *"SQL function snapshot is stale (2 file(s))"* — so
  Task 1 as committed would have failed CI.
- **Fix:** regenerated; gate now reports *"SQL function snapshot is current (107
  functions)"*.
- **Files:** `supabase/schema/functions/guard_allocation_requires_own_capital.sql`,
  `supabase/schema/functions/flip_capital_ownership_to_team_review.sql` (new), plus the two
  modified seed snapshots.
- **Commit:** `8a532f01`

**6. [Rule 2 — Missing critical functionality] Added a dedicated regression test for the
Deviation-4 bug**

- **Issue:** `test_capital_ownership_allocation_guard.sql` case 1 *does* redden if the
  SECDEF repair is reverted — but with a raw `42501` naming an unrelated table, which reads
  as "the OWN-03 guard over-blocks" and sends the next reader down the wrong path. It also
  cannot see two things at all: the latent fan-out sibling (no behavioural case reaches
  it), and whether the repair was bought by weakening the deny policies.
- **Fix:** `supabase/tests/test_weight_snapshot_seed_secdef.sql` — four assertions
  (behavioural seed-on-allocation, direct client write still denied, both functions
  `prosecdef` + pinned `search_path`, definer genuinely RLS-exempt). Repo convention:
  every bug gets a regression test that fails without the fix.
- **Guard-test assertions were NOT modified.** They pass as written after the repair.
- **Commit:** `8a532f01`

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
- **The Deviation-4 landmine is a class signal, not a one-off.** The failure mode is "a
  `SECURITY INVOKER` trigger writes to a table whose RLS denies the firing role", and it
  survived four months because no test ever wrote as `authenticated`. A repo-wide sweep for
  other trigger functions that write to deny-policy tables is worth booking in `TODOS.md` —
  out of scope here (the scope boundary is this task's own changes), and the two functions
  in this defect's own class are both fixed.
- **Worth re-running the demo seed after the TEST apply**, now for two reasons: the D-03-A
  trigger (already noted above) and this repair, which changes nothing for the seed's
  service-role writes but is worth confirming end-to-end.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: privilege-context-change | `supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql` | Two pre-existing trigger functions move from `SECURITY INVOKER` to `SECURITY DEFINER`, i.e. their writes now execute with the function owner's privileges. Mitigated in-file and asserted at apply: pinned `SET search_path = public, pg_catalog` on both; both take no arguments and are `RETURNS TRIGGER` so they cannot be called directly; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; neither body calls another function or executes dynamic SQL; both write exactly one derived row whose values come from `NEW` and are hard-coded `NULL`. The blast radius is a single INSERT into `weight_snapshots` — the table the trigger already existed to write. |

The `capital_ownership` column being readable by `anon` on published rows is T-150-04,
dispositioned `accept` and written into the `20260806120000` header as a decision. No new
network endpoint, auth path or file access pattern in either migration.

## Task 2 — status (ORCHESTRATOR-owned, PENDING again)

MCP tools are stripped from subagents (upstream anthropics/claude-code#13898), so every
`apply_migration` and every TEST-DB run in this task belongs to the orchestrator session.

**Done in the first checkpoint pass:**
- `20260806120000_strategies_capital_ownership.sql` applied to TEST
  (`qmnijlgmdhviwzwfyzlc`) — self-check green (column + CHECK + INSERT-scoped trigger + flip
  RPC, nullable with no default, fires on exactly INSERT).
- `test_capital_ownership_column.sql` against TEST → **ALL PASS**.
- `test_capital_ownership_allocation_guard.sql` against TEST → **failed on the Deviation-4
  landmine**, not on any object this plan created.

**Still to do (orchestrator):**
1. Apply `supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql` to TEST
   (`qmnijlgmdhviwzwfyzlc`, never PROD `khslejtfbuezsmvmtsdn`) via MCP `apply_migration`.
   Its self-verifying block fails loud if the repair did not land or if the deny policies
   were disturbed. MCP stamps `now()`, so the TEST-side timestamp will drift from the
   `20260806130000` filename — expected.
2. Re-run all **three** files against TEST:
   ```
   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_capital_ownership_column.sql
   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_capital_ownership_allocation_guard.sql
   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_weight_snapshot_seed_secdef.sql
   ```
   The guard test's assertions are unchanged; case 1 is expected to pass as written.

The local-cluster runs above raise high confidence that the SQL is correct and the oracles
have teeth — the RED reproduction is byte-identical to the TEST failure — but they are
**not** a substitute: they ran against a stand-in schema, not the real TEST database with
its full migration history, its other triggers on `strategies`, and its shared-tenant row
population.

⚠️ **PROD note for whoever merges.** `20260806130000` repairs a defect that is live on PROD
right now. Merging `supabase/migrations/**` to `main` auto-applies to PROD, and in this case
that is the *intent*, not a side effect: it restores `AddToPortfolio` and `MigrationWizard`,
which have been failing for real users since 2026-04-16.

## Self-Check: PASSED

**First pass (Task 1):** all four claimed files exist on disk; commits `5e25495e`,
`99285150` in `git log`; worktree clean; no file deletions in either task commit.

**Second pass (Deviation 4 / continuation):** all seven claimed files exist on disk with no
truncation — `20260806120000` 371 lines, `20260806130000` 355, `test_capital_ownership_column`
186, `test_capital_ownership_allocation_guard` 488 (byte-identical to `5e25495e`, verified
by an empty `git diff --stat supabase/tests/` before staging),
`test_weight_snapshot_seed_secdef` 220, and the two new function snapshots 59 / 55. All four
claimed commits exist in `git log`: `5e25495e`, `99285150`, `aeed57f3`, `8a532f01`. (The
first pass cited `8c339681` for the summary commit; the hash actually in `git log` is
`aeed57f3` — corrected here.) `git diff --diff-filter=D HEAD~1 HEAD` on `8a532f01` reports
no deletions. `npx tsx scripts/dump-sql-functions.ts --check` reports the snapshot current.
No untracked files remain from this pass; the ephemeral Postgres cluster lived entirely in
the session scratchpad, never in the repo.

## Orchestrator close-out (2026-08-06, post-continuation)

Task 2 checkpoint fully discharged by the orchestrator after the continuation pass:

- `20260806120000_strategies_capital_ownership` applied to TEST (qmnijlgmdhviwzwfyzlc) via MCP `apply_migration` — self-verify block passed (column nullable/no-default, CHECK both members, trigger INSERT-scoped, flip RPC present).
- `20260806130000_seed_weight_snapshot_secdef` applied to TEST via MCP `apply_migration` — self-verify block passed (both seed functions DEFINER + pinned search_path, owner exempt, 3 deny policies intact, triggers enabled + INSERT-scoped).
- `test_capital_ownership_column.sql` vs TEST: ALL PASS.
- `test_capital_ownership_allocation_guard.sql` vs TEST: FAILED pre-fix with the predicted 42501 landmine; ALL PASS post-fix, assertions unmodified.
- `test_weight_snapshot_seed_secdef.sql` vs TEST: ALL PASS.

PROD apply happens automatically at merge to main (that is the intent — it repairs the April-2026 AddToPortfolio/MigrationWizard breakage). Watch item from the first pass (seed-full-app-demo persona/holdings shapes) remains open for the phase-end verification.

## rev-2 (2026-08-06) — migration review: two BLOCKING data-integrity findings closed

`20260806120000_strategies_capital_ownership.sql` was amended **IN PLACE**. It has never
been merged, so PROD has never seen it; it exists only on this branch and on TEST (applied
via MCP). Every object in it is written re-runnably (DROP-then-ADD / `CREATE OR REPLACE`)
precisely so it can be re-applied — verified by applying it three times, twice on top of the
pre-fix state, self-check green each time. **The orchestrator must re-apply it to TEST
(`qmnijlgmdhviwzwfyzlc`, never PROD) and re-run the guard test.**
`20260806130000_seed_weight_snapshot_secdef.sql` is untouched.

### F1 (BLOCKING) — the flip RPC deleted a NON-OWNER caller's own position

`flip_capital_ownership_to_team_review()` DELETEd before it checked anything. Its DELETE is
scoped to `portfolios WHERE user_id = auth.uid()` — **the caller's book, not the owner's** —
so caller B invoking `flip(A_strategy)` deleted **B's own position** in it and returned
`(1, 0)` while the mark UPDATE no-oped against `strategies_update`. The function COMMENT and
case 7b both claimed a non-owner call was "a total no-op returning (0, 0)"; that was false
for exactly the caller who held the target. Silent position loss for a bystander.

Fixed with an owner precheck ahead of the DELETE (`SELECT user_id INTO v_owner ...`; NULL or
a different uid returns `(0, 0)` immediately). The RLS reasoning is written into the body:
under SECURITY INVOKER a caller can always read their OWN strategy via `strategies_read`, so
an owner's precheck read never returns NULL, and a non-owner reading a private strategy gets
NULL — which lands on the same correct no-op arm. The statements' `auth.uid()` predicates are
retained as defence in depth; they protect the victim and never the caller, which is exactly
why they could not substitute for the precheck.

### F2 (BLOCKING) — SC 2b was INSERT-only

`strategies_update USING (user_id = auth.uid())` lets the owner PATCH `capital_ownership` to
`'team_review'` straight through PostgREST — no route, no RPC, nothing to intercept it —
stranding every live position. That is the precise hole the flip RPC exists to close,
reachable without ever calling it. A guard callers must volunteer to use is a convention,
not an invariant.

New **part 3b**: `guard_team_review_mark_no_stranded_positions()` +
`trg_strategies_team_review_mark_guard`, `BEFORE UPDATE OF capital_ownership ON
public.strategies`. RAISEs `check_violation` when the mark ENTERS `'team_review'`
(`OLD IS DISTINCT FROM 'team_review'`) while an **owner-scoped** position exists.
D-03-A's conventions throughout: `SECURITY DEFINER`, pinned `search_path = public,
pg_catalog`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `COMMENT` on both function
and trigger.

**Ordering proof (load-bearing).** The RPC DELETEs the owner's positions FIRST and only then
UPDATEs the mark, and after the F1 precheck `auth.uid()` IS the owner — so the set the RPC
deletes is exactly the set this guard counts, the count is 0 by the time the guard fires, and
the sanctioned flip is admitted. Case 7a is unchanged and stays green. Reordering the two
statements was mutated (M16) and fails both behaviourally and at the migration self-check.

**The un-mark seed step still passes, and this was measured rather than reasoned about.** The
guard test's `UPDATE strategies SET capital_ownership = NULL WHERE id = strat_a_legacy` fires
the trigger (it is column-targeted, and triggers fire regardless of the executing role — the
seeding role gets no pass), but NULL is not `'team_review'`, so the guard's `IS NOT DISTINCT
FROM` condition is false and it returns NEW untouched. Mutation M15 (a guard that fires on
any `capital_ownership` UPDATE) reddens on that exact seed line, which is the falsifiable
proof that the statement above is about this code and not about a hoped-for behaviour.

### F3 (advisory) — the accepted narrowing is now written down

After a sanctioned flip, THIRD-PARTY positions survive by design. The column COMMENT said
"NEVER allocatable by anyone", which is narrower at the data layer than stated. Both the
COMMENT and a new header section (g) now say what is actually guaranteed — *never NEWLY
allocatable*: no INSERT can mint a position from a `team_review` strategy for anyone, and the
owner cannot strand their own book by marking one; a row another allocator created BEFORE the
flip is retained. The rationale is recorded so a future reader cannot "close the gap": the
alternative is a cross-tenant DELETE in which one allocator's private bookkeeping silently
rewrites a different allocator's portfolio. Pinned by case 7e.

### Test changes

`supabase/tests/test_capital_ownership_allocation_guard.sql` — five new cases, existing
assertions unmodified. New fixtures: a portfolio owned by B, and one PUBLISHED `own_capital`
strategy of A's held by **both** allocators (the shape that makes "the caller's positions"
and "the owner's positions" distinguishable at all).

| Case | Pins |
|------|------|
| 7d | F1. Non-owner flip where the CALLER holds the target → `(0, 0)`, caller's position survives, owner's mark and position untouched. |
| 7e | F3. Owner's flip → `(1, 1)`, owner's row gone, **third-party row survives**. Doubles as the behavioural ordering proof for part 3b. |
| 7f | F2. Raw `UPDATE ... = 'team_review'` with a live owner position RAISEs and disturbs nothing; the sanctioned RPC then reaches the same end state on the same row, same session. |
| 7g | Positive control for part 3b — transitions to `own_capital` and back to NULL with a live position must SUCCEED. |
| 7h | Structural (7c's twin) — the new guard is `SECURITY DEFINER` with a pinned `search_path`. |

Case 7c's `auth.uid()` threshold moved 2 → 3. The precheck added a third occurrence; at the
old bar the DELETE's or the UPDATE's predicate could be deleted while the precheck alone kept
the count at 2, so 7c would have quietly lost half its teeth **as a side effect of the F1
fix**.

### Verification — ephemeral local Postgres 16, RED → GREEN, both findings

A fresh cluster with a stand-in schema: RLS predicates copied verbatim from
`20260405061912_rls_policies.sql`, tables and functions owned by a **non-superuser,
non-BYPASSRLS** role (so a SECURITY DEFINER function's exemption comes from ownership, not a
superuser shortcut), and both pre-existing `BEFORE UPDATE` triggers on `strategies`
(`guard_strategies_publish_transition`, `guard_wizard_draft_updates`) installed verbatim from
`supabase/schema/functions/` — so the new UPDATE-scoped trigger is proven to coexist with
them rather than in a vacuum.

- **RED (F1), the finding reproduced:** the rev-2 test against the **pre-fix migration at
  HEAD** →
  `TEST FAILED (7d): a NON-OWNER flip on a strategy the CALLER holds affected rows
  (removed=1, updated=0), expected (0, 0)`. (7c reddens first on the same run — the
  behavioural arm was reached with 7c's threshold temporarily relaxed, so both are proven
  independently.)
- **RED (F2):** the amended migration with `trg_strategies_team_review_mark_guard` dropped →
  `TEST FAILED (7f): a raw UPDATE marked a strategy team_review while the owner's position
  was live — the position is now stranded and SC 2b is INSERT-only`.
- **GREEN:** amended migration applies clean, self-check emits *"…INSERT-scoped D-03-A
  trigger + UPDATE-scoped mark-transition guard + flip RPC with owner precheck and
  DELETE-before-UPDATE order"*, and both DB files report ALL PASS
  (`test_capital_ownership_allocation_guard`, `test_capital_ownership_column`).
- **Re-runnability:** applied over the pre-fix state and then a third time — self-check green
  each time, guard test ALL PASS after each.
- `npx tsx scripts/dump-sql-functions.ts --check` → *"SQL function snapshot is current (108
  functions)"* (107 → 108: the new guard). Regenerated with `npm run schema:functions`, so
  the path-triggered `sql-function-snapshot.yml` gate stays green.

**Local-cluster limitation, stated rather than glossed:** the stand-in has no
`weight_snapshots` table or seed triggers, so it cannot re-prove the Deviation-4 landmine.
That is unchanged by this work and already ALL PASS on TEST. The TEST re-apply and re-run
remain the authoritative gate.

#### Rule-9 mutation ledger, rev-2 — 8 mutations, 8 caught

| # | Mutation | Caught by | Result |
|---|----------|-----------|--------|
| M12 | revert the flip RPC to the pre-fix body (no owner precheck) | case 7d | RED — `(removed=1, updated=0)`. This is the F1 finding itself. |
| M13 | `DROP TRIGGER trg_strategies_team_review_mark_guard` | case 7f | RED — the raw UPDATE strands the position. This is the F2 finding itself. |
| M14 | widen part 3b's count from owner-scoped to strategy-wide ("close" F3 at the guard) | case 7e | RED — the OWNER's own flip is refused because a THIRD PARTY holds the strategy. Hostage-taking, caught. |
| M15 | drop the "transition INTO team_review" condition — guard fires on any `capital_ownership` UPDATE | the seed's un-mark step, then 7g | RED on `UPDATE strategies SET capital_ownership = NULL WHERE id = strat_a_legacy`. The measured proof that the seed step's survival is a property of the code. |
| M16 | reorder the flip RPC to UPDATE-before-DELETE | migration self-check 5e, and case 7a behaviourally | RED at apply — *"must DELETE the owner's positions BEFORE it UPDATEs the mark, or trg_strategies_team_review_mark_guard rejects the sanctioned flip"*; with the self-check stripped, the RPC raises 23514 against its own guard. |
| M17 | make the flip's DELETE strategy-wide (the cross-tenant "fix" header (g) forbids) | case 7e (and 7c) | RED — `(removed=2, updated=1)`, expected `(1, 1)`: another allocator's position was destroyed. |
| M18 | drop the trigger's `OF capital_ownership` column target | migration self-check 5f | RED at apply — *"is not column-targeted on capital_ownership (matched 0 column(s))"*. |
| M19 | revert part 3b's guard to `SECURITY INVOKER` | case 7h **only** | RED. **Measured blind spot:** with 7h's `prosecdef` predicate neutered, this mutation leaves the ENTIRE suite GREEN — only the owner can reach the guard today and an owner sees their own book either way. 7h is the M6 lesson applied a second time. |

M19 is the honest finding of this pass: a second piece of defence-in-depth that no
behavioural test could see, found by mutating rather than by assuming, and pinned before it
could be refactored away.

### rev-2 files and commits

- `supabase/migrations/20260806120000_strategies_capital_ownership.sql` (amended in place),
  `supabase/schema/functions/flip_capital_ownership_to_team_review.sql`,
  `supabase/schema/functions/guard_team_review_mark_no_stranded_positions.sql` (new) —
  commit `27cfdd01`
- `supabase/tests/test_capital_ownership_allocation_guard.sql` — commit `ab41d319`

No TS/vitest file was touched (Wave 2 owns those concurrently); no other migration was
touched; `STATE.md` and `ROADMAP.md` were deliberately not updated.

### rev-2 self-check: PASSED

All four claimed files exist on disk with no truncation — migration 613 lines, guard test 764
lines, the two function snapshots present and `--check`-current at 108 functions. Both claimed
commits are in `git log` (`27cfdd01`, `ab41d319`). `git diff --diff-filter=D HEAD~2 HEAD`
reports no deletions. Worktree clean; the ephemeral Postgres cluster lived entirely in the
session scratchpad and never in the repo.

### Orchestrator to-do after rev-2

1. Re-apply `20260806120000_strategies_capital_ownership.sql` to TEST
   (`qmnijlgmdhviwzwfyzlc`) via MCP `apply_migration`. It is re-runnable; the self-verify
   block now also asserts the new trigger's event scope and column target, the flip RPC's
   owner precheck, and its DELETE-before-UPDATE order.
2. Re-run `test_capital_ownership_allocation_guard.sql` against TEST (the column test and the
   weight-snapshot test are unaffected, but re-running all three is cheap).
3. Wave 2 note: any route or client code that marks a strategy `team_review` must go through
   `flip_capital_ownership_to_team_review()`. A direct `UPDATE`/PATCH now returns `23514`
   whenever the owner holds a live position — by design, and the error's HINT names the RPC.
