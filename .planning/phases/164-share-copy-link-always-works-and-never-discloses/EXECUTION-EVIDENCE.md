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

---

## 5. N1 RE-MEASURED AT HEAD — reproduces, and the severity is now WRONG in SYNTHESIS

A dated blocker is a claim, not a fact. With the real applied schema in front of me, N1 was
re-measured rather than taken on trust. It **reproduces**, and `BIGINT` closed nothing:

```
step 1  mint                                        generation = 1
step 2  owner PATCHes generation = 9223372036854775807   ⛔ ACCEPTED
        (they hold the UPDATE(generation) column grant; the trigger forbids a
         DECREASE only — nothing bounds the increase)
step 3  revoke_strategy_share(sid)                   ⛔ WEDGED  22003 bigint out of range
step 4  sanitize_user(uid)                           ⛔⛔ Art.17 ERASURE ABORTED  22003
```

Step 4 is the one that matters: the GDPR arm runs the same `generation + 1`, so a data subject can
**abort their own erasure** with one PATCH. Confirms the migration header's own warning that
`BIGINT` is headroom, **not** the N1 fix. Gate condition 2 stays open, and 164-06 stays required.

### ⭐ But the recorded severity is overstated, and the nonce is why

`SYNTHESIS.md` calls N1 *"unrecoverable without DDL, or a DELETE that resurrects everything"* and
ranks it the worst item in the corpus. The three operator remedies, measured:

| Remedy (`service_role`) | Result |
|---|---|
| A — stamp `revoked_at` without bumping | ⛔ **BLOCKED** by trigger rule 2 (revocation-must-advance) |
| B — rewind `generation` to a sane value | ⛔ **BLOCKED** by trigger rule 1 (monotonic) |
| C — `DELETE` the row | ✅ **WORKS** — and it does **not** resurrect anything |

C is the correction. The claim that a DELETE "resurrects everything" was true of the pre-nonce
design and was **not re-checked after the nonce landed**. A re-created row draws a fresh
`gen_random_uuid()` nonce, so every previously-minted token is dead rather than revived — link
death, which is the correct outcome for an erasure anyway.

**So N1's true shape at HEAD is:** a data subject can wedge their own Art. 17 erasure until an
operator deletes one row — not *"unrecoverable without DDL, with no operator remedy."* Still a real
defect, still blocking 164-03, still worth closing at the root in 164-06. But it is an availability
bug with a one-statement operator remedy, not the unrecoverable regulatory failure the corpus
records. The stricter framing survived only because nobody re-ran it after the fix that changed it.

---

## 6. N2 DOES NOT REPRODUCE — and the proposed fix would have introduced the bug

Gate condition 3 reads: *"`SELECT … FOR UPDATE` in `revoke_strategy_share`, **and** STEP 6 arm (i-b)
rewritten so it no longer fails the apply when the racy predicate is removed. ⚠️ Until that arm is
rewritten, the durable gate enforces the bug."*

Measured on the live cluster, three interleavings, two concurrent sessions each (session 1 holds
the row lock inside an open transaction for 3s; session 2 arrives 1s in and blocks):

| Race | Result |
|---|---|
| revoke ∥ revoke | A `rows=1`, B **blocks → `rows=0`**; final `generation=2`, revoked. **Converges.** |
| revoke then mint | revoke `rows=1`; mint **blocks → returns gen 3**, live. gen-2 tokens dead, owner holds a fresh link. |
| mint then revoke | mint gen 3; revoke **blocks → `rows=1`** → gen 4, revoked. The just-minted gen-3 token is dead. |

No lost update, no counter inflation beyond +1 per revoke, no resurrection, in any ordering.

**Why there is no race to fix.** Both RPCs are *single statements* — there is no read-then-write
window for a `FOR UPDATE` to protect:

```sql
-- revoke: one UPDATE
UPDATE public.strategy_shares SET revoked_at = now(), generation = generation + 1
 WHERE strategy_id = p_strategy_id AND created_by = auth.uid() AND revoked_at IS NULL;

-- mint: one INSERT
INSERT INTO public.strategy_shares (strategy_id, created_by) VALUES (…)
ON CONFLICT (strategy_id) DO UPDATE SET revoked_at = NULL
RETURNING strategy_shares.generation, strategy_shares.nonce;
```

Under READ COMMITTED the blocked writer takes the row lock, then **re-evaluates its `WHERE` against
the updated row** (EvalPlanQual) — which is exactly why the second revoke matches zero.

### ⛔ The proposed remedy was the actual hazard

`revoked_at IS NULL` is not "the racy predicate" — it **is** the convergence contract, and arm (i-b)
exists precisely to stop anyone deleting it. Rewriting that arm "so the fix can land" would have
removed the guard, and removing the predicate is what would make a double-revoke inflate the
counter. **The arm was not enforcing the bug; the proposed fix was the bug.** Nothing about this was
visible without running it — the reasoning chain is plausible end to end and simply false.

**DECIDED — founder ruling 2026-08-27: N2 dropped, `164-06` is N1-only.** Gate condition 3 is
closed as *not a defect* on this evidence, overriding the corpus's `[M]` severity. ⛔ Re-opening it
requires new measured evidence, not re-reasoning: `revoked_at IS NULL` is a guard and STEP 6 arm
(i-b) protects it, so "adding `FOR UPDATE`" is a regression, not a hardening.

**Limits.** READ COMMITTED only (PostgREST's default; the RPCs set no isolation level). Two
sessions, not N. The three interleavings above, not an exhaustive schedule search.
