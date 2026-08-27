# Phase 164 — execution evidence (2026-08-27)

> Gate condition 6 (`red-team/SYNTHESIS.md:270-287`): *"Every one of the above executed against a
> real PostgreSQL instance, with the run output in the plan — not asserted in prose."*
>
> This file is that output. Before today, **none of these three files had ever been run.**

Harness: `pg-harness/run.sh` — PostgreSQL 16.13 (Homebrew, aarch64-apple-darwin25), throwaway
cluster, TCP on 127.0.0.1, `initdb` per run. ⛔ Nothing was applied to TEST or PROD.

---

## 1. What ran, and what came back

| File | Result |
|---|---|
| `supabase/migrations/20260827120000_strategy_shares_generation_model.sql` | **APPLIED** — all four self-verification `DO` blocks emitted their NOTICEs |
| `supabase/migrations/20260827130000_sanitize_user_revoke_strategy_shares.sql` | **APPLIED** — STEP 2 `DO` block green |
| `supabase/tests/test_strategy_shares_rls.sql` | **`ALL 101 ARMS EXECUTED`**, exit 0 |

The gate's own closing sentinel, verbatim:

```
NOTICE:  test_strategy_shares_rls: ALL 101 ARMS EXECUTED (SHAPE 1, SHAPE 1b, SHAPE 1c, SHAPE 2a,
… SANITIZE 1a, SANITIZE 1b, SANITIZE 1c, SANITIZE 1d, SANITIZE 1e, SANITIZE 1f).
Observed generation sequence: {1,1,2,2,2,3}
```

`{1,1,2,2,2,3}` is the intended state machine observed end to end: mint at 1 → **reuse returns the
same 1** (SHARE-01) → revoke advances to 2 → re-mint reuses 2 without resetting (so the new link
differs from every old one) → a second revoke reaches 3.

The file ends in `ROLLBACK` by construction; nothing it seeded persists.

## 2. The arms can fail — measured, not assumed

**Migration `20260827130000` (DRIFT-02 arms).** Three mutations, because two were not enough:

| Mutation | Result |
|---|---|
| body `DELETE` re-pointed at the VIEW — *the real DRIFT-02 bug* | **RED**, arm 1 |
| body `DELETE` removed entirely | **RED**, arm 1 |
| legacy `DELETE` kept **and** a view-named `DELETE` added alongside | **RED**, arm 2 |
| unmutated | **GREEN** |

⭐ The third mutation exists because mutations 1 and 2 abort on arm 1 before arm 2 is ever
evaluated. Without it, arm 2 would have been **a test that cannot fail**, inside a file whose entire
subject is a check that failed to check.

**The 101-arm gate.** Mutated the RLS policy `USING (created_by = auth.uid())` → `USING (true)` — a
straight cross-tenant leak:

```
migration apply (mutated):  APPLIED   ← the migration's own DO blocks do NOT catch this
gate:                       ERROR: TEST FAILED (TENANT 4a): tenant B sees 2 strategy_shares rows,
                                   expected 0 — CROSS-TENANT LEAK through the USING clause
restore:                    GREEN, ALL 101 ARMS EXECUTED, {1,1,2,2,2,3}
```

⚠️ **Finding, low severity, not blocking.** The migration self-verifies grants, ACLs, RPC body
shape, trigger presence and the trigger's five rules — but it performs **zero** checks on the RLS
policy predicate (`grep -c 'pg_policies|polqual|pg_get_expr'` → 0). `USING (true)` applies cleanly.
The gate covers it (TENANT 4a), so the class is not open — but the two layers are asymmetric, and
the migration is the layer that runs on PROD. Booked as a candidate for 164.1 alongside `PROC-01`.

## 3. Honest limits — what this does NOT prove

- `pg-harness/01-*.sql` and `02-*.sql` are **stand-ins**: only the columns the FKs, policies, RPCs
  and the `sanitize_user` body actually name. The real `profiles` / `strategies` / `auth.users`
  carry their own RLS, constraints and triggers that are absent here.
- The objects **under test** are the real ones, straight from the migration files — the table, the
  trigger, the grants, the policies, both RPCs. That is the part this run exercises for real.
- Nothing here proves behaviour against the production schema. **The TEST hand-apply is still
  owed**, and remains the 164-02 blocking-human checkpoint.
- One run was lost to a **harness** defect of my own: `auth.uid()` cast to `json` *before*
  `NULLIF`, and `set_config(..., NULL, true)` leaves the empty string rather than NULL (measured),
  so `''::jsonb` raised 22P02 — which surfaced as a plausible-looking gate failure in
  SERVICE-ROLE 2b. Recorded because a fixture bug that mimics a real finding is exactly the failure
  mode an unrun harness cannot have and a run one can.

## 4. Reproducing

```bash
.planning/phases/164-share-copy-link-always-works-and-never-discloses/pg-harness/run.sh
```

Verified end-to-end from a clean `initdb` on a second port before this file was written.
Promoting the harness to `scripts/` plus a CI lane is `PROC-01`'s implementation, routed to
Phase 164.1 — this copy is the evidence, not the standard.
