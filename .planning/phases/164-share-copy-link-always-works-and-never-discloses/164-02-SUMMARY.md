---
phase: 164-share-copy-link-always-works-and-never-discloses
plan: 02
subsystem: database
tags: [share, rls, migration, generation-counter, gdpr, frozen-spine-guard]
status: paused-at-checkpoint
requires:
  - "164-CONTEXT.md D-02 (HMAC + stored generation counter, never a token at rest)"
  - "164-CONTEXT.md D-05 (narrow the phase-29 guard, never rename the migration)"
  - "164-CONTEXT.md D-07 (bounded constant-time token scan, revisit threshold)"
provides:
  - "public.strategy_shares — one owner-scoped row per strategy holding the share generation counter"
  - "public.create_strategy_share(uuid) -> integer — atomic mint-or-reuse (SECURITY INVOKER)"
  - "public.revoke_strategy_share(uuid) -> integer — atomic revoked_at stamp + generation bump (SECURITY INVOKER)"
  - "supabase/tests/test_strategy_shares_rls.sql — the RLS/grant/state-machine gate (RED until TEST hand-apply)"
  - "FORBIDDEN_MIGRATION_RE narrowed to /scenario/i — scenario spine still frozen, strategy_shares passes"
  - "both RPC names under MUTATING_RPC_NAMES so the 164-03 routes fall under the audit law"
affects:
  - "plan 164-03 (routes that call both RPCs)"
  - "plan 164-04/05 (token derivation + recipient lane read the generation counter)"
  - "Phase 164.1 (must treat the guard narrowing as the already-done 164 slice)"
tech-stack:
  added: []
  patterns:
    - "generation-counter share model (re-derivable token) instead of hash-at-rest"
    - "full UNIQUE(strategy_id) + reactivate-in-place, not the scenario spine's partial unique"
    - "apply-time body-shape self-asserts on CREATE OR REPLACE function definitions"
key-files:
  created:
    - supabase/migrations/20260827120000_strategy_shares_generation_model.sql
    - supabase/tests/test_strategy_shares_rls.sql
    - supabase/schema/functions/create_strategy_share.sql
    - supabase/schema/functions/revoke_strategy_share.sql
    - .planning/phases/164-share-copy-link-always-works-and-never-discloses/deferred-items.md
  modified:
    - src/__tests__/phase-29-frozen-spine-guards.test.ts
    - src/__tests__/audit-coverage.test.ts
    - src/lib/gdpr-export-manifest.ts
    - scripts/check-gdpr-export-coverage.ts
decisions:
  - "REVOKE DELETE ON strategy_shares FROM authenticated — a client delete discards the counter, so the next mint restarts at generation 1 and resurrects every revoked token"
  - "GDPR manifest entry DEFERRED to the post-apply types regeneration; the coverage hook is left deliberately RED rather than silenced with EXCLUDED_TABLES"
  - "Added a partial index on (strategy_id, generation) WHERE revoked_at IS NULL for D-07's bounded scan, with the 1,000-active-row revisit threshold recorded in the migration"
  - "No rollback file — the supabase/migrations/down/ convention lapsed after 20260714090000; manual undo is documented in the migration header instead"
metrics:
  duration: ~22 min
  completed: 2026-08-27
  tasks_completed: 2
  tasks_total: 3
actuals:
  tokens: 63000
  tasks: 2
  commits: 2
---

# Phase 164 Plan 02: strategy_shares generation model Summary

**Status: PAUSED at the Task 3 `gate="blocking-human"` checkpoint.** Tasks 1 and 2 are
complete and committed. The migration has been applied to NOTHING.

Per-strategy factsheet sharing gets a storage layer that stores no secret: `strategy_shares`
holds `(strategy_id, generation, revoked_at)` and the token is derived in Node as
`HMAC(SHARE_TOKEN_SECRET, strategy_id || generation)`, so reuse is re-derivable (Copy Link
returns the same url until revoked) and revocation is one atomic `generation + 1` that kills
every previously-copied link at once.

## What was built

### Task 1 — guard narrowing + migration (commit `eec612b1c`)

**The phase-29 guard, narrowed (D-05).** `FORBIDDEN_MIGRATION_RE` went from
`/scenario|share/i` to `/scenario/i` at
`src/__tests__/phase-29-frozen-spine-guards.test.ts:141`. All four names in the guard's own
locked set — `scenarios`, `scenario_shares`, `get_shared_scenario`, `create_scenario_share` —
contain the substring "scenario", so the `share` alternative was redundant for the locked set
while false-positiving on `strategy_shares`. The migration filename was **not** renamed to
dodge the substring.

**The migration** `supabase/migrations/20260827120000_strategy_shares_generation_model.sql`
(timestamp sorts after the previous latest, `20260826150000`):

| Piece | Shape |
|---|---|
| Table | `id`, `strategy_id UUID NOT NULL UNIQUE REFERENCES strategies ON DELETE CASCADE`, `created_by UUID NOT NULL REFERENCES profiles ON DELETE CASCADE`, `generation INTEGER NOT NULL DEFAULT 1 CHECK (>= 1)`, `created_at`, `revoked_at`. RLS enabled. **No token column of any kind.** |
| Unique | FULL `UNIQUE (strategy_id)`, not the scenario spine's partial index — the row IS the counter, so reactivation mutates in place |
| RLS | `strategy_shares_owner FOR ALL TO authenticated USING (created_by = auth.uid())`, `WITH CHECK (created_by = auth.uid() AND EXISTS (…strategies s WHERE s.id = strategy_shares.strategy_id AND s.user_id = auth.uid()))` — the CR-01 owner-coherence clause |
| Grants | `REVOKE ALL … FROM PUBLIC, anon`; `REVOKE DELETE … FROM authenticated`; explicit `GRANT SELECT, INSERT, UPDATE TO authenticated` and `GRANT ALL TO service_role` |
| Index | `strategy_shares_active_idx ON (strategy_id, generation) WHERE revoked_at IS NULL` — index-only scan for D-07's bounded token scan; revisit threshold **1,000 active rows** recorded in the header |
| `create_strategy_share(uuid) → integer` | SECURITY INVOKER, `SET search_path = public, pg_temp`. Single `INSERT … ON CONFLICT (strategy_id) DO UPDATE SET revoked_at = NULL RETURNING generation`. Never touches `generation`, `created_by` or `created_at` on reactivation |
| `revoke_strategy_share(uuid) → integer` | SECURITY INVOKER, same search_path. Single `UPDATE … SET revoked_at = now(), generation = generation + 1 WHERE strategy_id = $1 AND revoked_at IS NULL`, returns `ROW_COUNT`. Zero rows = convergence, mapped to 404 by the route |

There is **no SECURITY DEFINER reader** in this design (SQL cannot compute the HMAC — no
pgcrypto), so no anon-EXECUTE question arises. Both functions use `CREATE OR REPLACE`; the
re-base-on-latest-definition rule is satisfied vacuously — `grep` over
`supabase/migrations/` returns no earlier definition of either name.

Three apply-time self-assert blocks:
- `_assert_no_public_execute` for both RPCs (called, not redefined);
- body-shape: the atomic `generation = generation + 1` bump is present, the
  `revoked_at IS NULL` predicate is present, no `DELETE FROM`, the mint never assigns
  `generation`, neither function is `prosecdef`, and both pin `search_path`;
- an `information_schema` probe pinning the column set exactly, so a future `ALTER` adding a
  `token`/`token_hash` column fails the apply.

**Audit law.** Both RPC names added to `MUTATING_RPC_NAMES` in
`src/__tests__/audit-coverage.test.ts` with per-name rationale, so the 164-03 routes that call
them fall under the audit gate (the SEC-03 lesson already recorded in that list).

**Snapshot.** `scripts/dump-sql-functions.ts` regenerated → 117 functions;
`--check` clean.

### Task 2 — the SQL gate (commit `b6102a703`)

`supabase/tests/test_strategy_shares_rls.sql`, house PL/pgSQL style (no pgTAP, no psql
meta-commands, `BEGIN … ROLLBACK`, `auth.users` pre-clean by email). Assertion groups:

1. **SHAPE** — column set is exactly the six DDL columns; both RPCs are `SECURITY INVOKER`
   (with a count guard so the loop cannot pass vacuously on zero rows); no PUBLIC EXECUTE.
2. **ANON** — dead at the **grant** layer (42501 on select, and on both RPCs) *and*,
   independently, at the **policy** layer: `SELECT` is granted to `anon` inside the
   rolled-back transaction to prove the policy alone still yields 0 rows, then revoked (with a
   `role_table_grants` check that the revoke took).
3. **TENANT** — the CR-01 clause rejects a cross-tenant mint through the RPC *and* through a
   raw `INSERT` (so the arm pins the policy, not the function body), and rejects a forged
   `created_by`. Cross-tenant read = 0 rows; cross-tenant revoke = 0 rows with the victim's
   counter untouched.
4. **REVOKE** — one call stamps `revoked_at` and advances `generation` by exactly 1; a second
   affects 0 rows and does not inflate further.
5. **REUSE** — re-minting a live share returns the same generation and adds no second row.
6. **REACTIVATION** — minting a revoked row clears `revoked_at`, returns the **advanced**
   generation, and leaves `created_by`/`created_at` untouched.
7. **MONOTONICITY** — `generation` never decreases across
   mint → reuse → revoke → revoke → re-mint → revoke, plus a non-vacuity check that it
   actually advanced (a never-advancing counter would make the loop trivially true).
8. **NO HARD DELETE** — `authenticated` gets 42501 on `DELETE`, pinned to
   `insufficient_privilege` specifically (a 0-row `DELETE` raises nothing, and `WHEN OTHERS`
   would let an unrelated error satisfy the arm).

Positive controls throughout (the owner **can** mint, reuse and revoke) so a
`WITH CHECK (false)` policy cannot satisfy every negative arm while breaking the feature.

**No pre-apply tolerance arm.** `grep -niE 'to_regclass|SKIP'` returns only the header prose
explaining why there is none. Before the hand-apply the file dies at the first reference to
`strategy_shares` with 42P01 and takes the `sql-tests` job down under `ON_ERROR_STOP=1`.

## Anti-vacuity demonstrations

| Mechanism | Neutered how | Observed |
|---|---|---|
| Phase-29 exit gate (post-narrowing) | untracked probe `supabase/migrations/99999999999999_probe_scenario_shares_guard.sql` | **RED** — `Offending files: …probe_scenario_shares_guard.sql`; `rm` restored green (probe removed with `rm`, never `git checkout --`) |
| The narrowing was *necessary* | measured both regexes against the real committed delta (`git diff --name-only $(git merge-base origin/main HEAD) HEAD`) | old `/scenario\|share/i` flags `20260827120000_strategy_shares_generation_model.sql`; new `/scenario/i` does not; all four locked-set names still match `/scenario/i` |
| Migration STEP 6 body-shape asserts | each arm run against a deliberately neutered function body (bump removed, predicate removed, `DELETE FROM` substituted, `generation = 1` added to the mint's `DO UPDATE`, `search_path` dropped) | every arm fires on the neutered body and passes on the real one — both directions checked |
| `\M` vs `\m` in the no-DELETE arm | caught during authoring: `\mDELETE\s+FROM\m` demands a word *start* after `FROM`, which never occurs, so the arm would have been silently vacuous | corrected to `\M`; the two-direction check above then passed |
| SQL-gate `RAISE` grammar | a purpose-built placeholder/argument parity checker, itself proven able to fail on a deliberately mismatched statement | 40 `RAISE` statements in the gate and 12 in the migration, 0 mismatches |
| `SECURITY INVOKER` loop in the gate | a `FOR … LOOP` over zero rows passes vacuously | added an explicit `count(*) = 2` guard immediately after it |
| MONOTONICITY loop in the gate | a counter that never moves makes "non-decreasing" trivially true | added an explicit "ended strictly above where it started" assertion |

## Verification

| Check | Result |
|---|---|
| `vitest run src/__tests__/phase-29-frozen-spine-guards.test.ts src/__tests__/audit-coverage.test.ts` | **PASS** (21 passed, 1 skipped) — re-run after both commits, with the migration in the committed delta |
| `tsx scripts/dump-sql-functions.ts --check` | **PASS** — snapshot current (117 functions) |
| `tsc --noEmit -p tsconfig.json` | **PASS** — no output |
| `vitest run src/__tests__/contracts/` | **PASS** (109) — file-scoped runs cannot clear these, so they were run explicitly |
| `vitest run` on the migration-scanning gates (`raise-exception-concat-grammar`, `critical-regressions`, `strategies-published-sole-writer-guard`, `seed-integrity`, `check-planning-hygiene`) | **PASS** (227) |
| `vitest run` GDPR consumers (`gdpr-export`, `gdpr-export-redaction`, `gdpr-export-schema`, `gdpr-export-per-key-dailies`) | **PASS** (100) |
| sql-tests preflight patterns (shell escape, `\copy`) on the new gate | 0 matches |
| `supabase/tests/test_strategy_shares_rls.sql` | **NOT RUN — expected RED until the TEST hand-apply.** No local psql run was attempted; nothing was applied anywhere |

## ⛔ Deliberately RED until the checkpoint's hand-apply

Two gates are red on this branch by design. **Neither is a defect and neither may be
"fixed" by adding a tolerance arm.**

1. **`supabase/tests/test_strategy_shares_rls.sql`** — SKIP-01. Green is reachable only
   through the hand-apply; that is the whole point.
2. **`scripts/check-gdpr-export-coverage.ts`** — exit 1, plus 5 consequent failures in
   `src/__tests__/gdpr-export-coverage-hook.test.ts` (19 passed / 5 failed, **one** root
   cause: the hook exits at the coverage stage so the later stages never emit their
   messages).

   This one was **not anticipated by the plan** and is worth stating precisely. The hook
   greps `supabase/migrations/**`, sees a new user-owned table and demands a
   `USER_EXPORT_TABLES` entry. That entry's `table` field is typed
   `PublicTable = keyof Database["public"]["Tables"]`, and `src/lib/database.types.ts` is
   **generated from the live schema**. Adding the entry before the migration is applied is a
   hard compile error — MEASURED 2026-08-27:

   ```
   src/lib/gdpr-export-manifest.ts(753,3): error TS2322: Type '{ … table: "strategy_shares" … }'
     is not assignable to type 'UserExportTable'. … Did you mean '"strategy_keys"'?
   ```

   So the two CI clocks are structurally out of phase for every new user-owned table, and the
   window closes at the apply. Given the choice between a red `tsc` and a red coverage hook, the
   coverage hook is strictly better: `tsc` red breaks the build and every downstream
   typechecked test, whereas the hook prints the exact remedy. Both sites now carry a
   **PENDING** block spelling out the four-step order of operations, and neither the manifest
   entry nor its `SANITIZE_PARITY_ALLOWLIST` twin was left half-landed (the allowlist's own
   staleness check rejects a key with no matching manifest entry, so they must land together).

   ⛔ **Do not silence this with an `EXCLUDED_TABLES` entry.** That arm means "genuinely not
   exportable" and would drop a user-owned table from every Art. 15 export, permanently and
   silently — the same class of defect as a SKIP-01 tolerance arm.

## Deviations from Plan

### Auto-fixed / added

**1. [Rule 2 — missing critical functionality] `REVOKE DELETE ON strategy_shares FROM authenticated`**
- **Found during:** Task 1, while writing the RLS policy.
- **Issue:** the policy is `FOR ALL`, so an owner could `DELETE` their own share row. That is
  **not** equivalent to revoking: a delete discards the counter, the next
  `create_strategy_share` inserts a fresh row at `generation = 1`, and every token minted at
  generation 1 — including ones the owner explicitly revoked — starts working again. A
  token-resurrection path with no error and no log.
- **Fix:** one `REVOKE DELETE` plus an explicit positive `GRANT SELECT, INSERT, UPDATE` (so the
  outcome does not depend on whatever `ALTER DEFAULT PRIVILEGES` the project happens to carry),
  a `COMMENT ON COLUMN revoked_at` recording it, and a pinned `insufficient_privilege` arm in
  the SQL gate. FK cascades are unaffected — referential actions execute internally without
  consulting the caller's privileges, so `sanitize_user` and account deletion still work.
- **Files:** `supabase/migrations/20260827120000_…sql`, `supabase/tests/test_strategy_shares_rls.sql`
- **Commits:** `eec612b1c`, `b6102a703`

**2. [Rule 2 — performance for the sole public read path] partial index `strategy_shares_active_idx`**
- **Found during:** Task 1. D-07 rules a bounded constant-time scan over active share rows on
  every recipient request; without an index that is a seq scan over a table that only grows
  (revoked rows are retained forever).
- **Fix:** `CREATE INDEX … ON (strategy_id, generation) WHERE revoked_at IS NULL`, mirroring the
  scenario migration's own hot-path-index rationale, with D-07's **1,000 active rows** revisit
  threshold written into the header rather than left implicit.
- **Files/commit:** `supabase/migrations/20260827120000_…sql`, `eec612b1c`

**3. [Rule 3 — blocking issue] GDPR export coverage gate**
- Full account in the "Deliberately RED" section above. Net effect on this plan's scope:
  `src/lib/gdpr-export-manifest.ts` and `scripts/check-gdpr-export-coverage.ts` gained
  comment-only PENDING blocks (neither is in the plan's `files_modified`), and the required
  post-apply follow-up became step 2 of the checkpoint sequence below.

**4. [Rule 1 — bug, caught pre-commit] `\m` where `\M` was needed**
- The migration's no-hard-DELETE body-shape arm was first written
  `v_revoke ~* '\mDELETE\s+FROM\m'`. Postgres `\m` asserts a word *start*; the position after
  `FROM` never is one, so the arm could never fire. Corrected to `\M` and then proven to fire
  on a neutered body. Recorded because it is exactly the "assert that cannot fail" class.

### Documented, not deviated

- **No rollback file.** The `supabase/migrations/down/` convention lapsed after
  `20260714090000` and no 2026-08 migration ships one. Rather than silently omit it, the
  migration header states the convention and gives the manual undo (`DROP FUNCTION` ×2 then
  `DROP TABLE`). The scenario migration's header referenced a rollback file; this one does not
  pretend to.
- **`it` title changed** from "no new scenarios/share migration shipped this phase" to
  "…scenario-spine migration…" so the title matches the narrowed scope. Nothing references it.
- **ROADMAP was not touched** — the required Phase 164.1 cross-reference already exists at
  `.planning/ROADMAP.md:425-431`, so the guard comment cites it rather than duplicating it.
  (STATE.md and ROADMAP.md are the orchestrator's to write, per this agent's brief.)

## Known Stubs

None. Nothing in this plan renders UI or returns placeholder data.

## Threat Flags

None beyond the plan's own `<threat_model>`. The one surface added that the register did not
name — a client-side `DELETE` as a counter-reset path (T-164-05 adjacent, "replay after
revoke") — is closed by deviation 1 above and pinned by the SQL gate.

## Deferred Issues

- **D-164-A** — `scripts/**/*.test.ts` is outside the vitest `INCLUDE` globs, so
  `scripts/check-gdpr-export-coverage.test.ts` (20 KB) has never executed in CI. Measured, out
  of this plan's blast radius, written up in
  `.planning/phases/164-…/deferred-items.md` with the remedy.

## Self-Check: PASSED

- All five created files exist on disk (`ls` verified).
- Both commit hashes resolve in `git log --all` (`eec612b1c`, `b6102a703`).
- No file deletions in either commit (`git diff --diff-filter=D` empty for both).
- `node_modules` symlink present but untracked and uncommitted; `git status` clean after the
  second commit.
- The migration was applied to **nothing**: no `supabase db push`, no `psql` against any
  project, no `uvicorn`, no `.env` touched.
