---
phase: 164-share-copy-link-always-works-and-never-discloses
plan: 06
subsystem: database
tags: [postgres, trigger, plpgsql, gdpr, bigint-overflow, migration, sql-gate, mutation-testing]

# Dependency graph
requires:
  - phase: 164-share-copy-link-always-works-and-never-discloses
    provides: "164-02 created strategy_shares, the monotonic-generation trigger and the SQL gate this plan amends IN PLACE"
provides:
  - "The N1 closure: an UPDATE may advance `generation` by AT MOST ONE, so the BIGINT ceiling is unreachable by construction"
  - "A BEFORE INSERT branch that FORCES `generation := 1` and `nonce := gen_random_uuid()`, binding roles that grants cannot reach"
  - "Six new gate arms (N1 1a/1b/1c, N1 2a/2b, N1 3a) and the re-derived CI floors that count them"
affects: [164-02, 164-03, sanitize_user Art. 17 erasure, revoke_strategy_share]

actuals:
  tokens: 0        # executed out-of-band during the 164 fix rounds; SUMMARY written post-hoc from measurement
  tasks: 3
  commits: 0       # the work rode in on the fix-round commits, not on a plan-scoped commit

tech-stack:
  added: []
  patterns:
    - "Amend-the-create rather than patch-after: legal ONLY when re-measured as applied nowhere (PROD table absent, PROD ledger 0 rows, TEST absent)"
    - "A source-shape self-verification block INSIDE the migration, so a lost rule aborts the apply instead of silently shipping"
    - "Two-layer mutation testing: one mutation that deletes the rule (catches the source check) and one that KEEPS the matched text but changes the behaviour (catches the arm)"

key-files:
  created: []
  modified:
    - supabase/migrations/20260827120000_strategy_shares_generation_model.sql
    - supabase/schema/functions/strategy_shares_enforce_monotonic_generation.sql
    - supabase/tests/test_strategy_shares_rls.sql
    - .github/workflows/ci.yml

key-decisions:
  - "Trigger widened to BEFORE INSERT OR UPDATE. A column grant cannot bind service_role (GRANT ALL + BYPASSRLS) and service_role is on this feature's hot path, so the INSERT pin is the only control that reaches it"
  - "The INSERT branch forces BOTH MAC inputs. Forcing the counter alone leaves the nonce caller-supplied and vice versa; both are needed for a destroyed-and-recreated row to land in a token space DISJOINT from every token that row ever issued"
  - "Rule (6) is ordered LAST, after rule (1) has refused every decrease — the two together pin the counter to 'stay, or advance by exactly one'"
  - "N2 deliberately NOT in scope (founder ruling 2026-08-27): it does not reproduce, and the prescribed remedy (SELECT … FOR UPDATE, rewriting arm (i-b)) would have REMOVED a guard and created a counter-inflation bug"
  - "SUMMARY written post-hoc rather than re-executing the plan. Every deliverable was re-measured at HEAD on 2026-08-28 before this file was written; re-running the plan would have re-authored code that already exists"

patterns-established:
  - "A mutation that the source-shape check catches proves the CHECK, not the ARM. To prove the arm, mutate so the regex still matches: `:= 1` -> `:= 1987654321`, `+ 1` -> `+ 1000000`, `:= gen_random_uuid()` -> `:= NEW.nonce`"

requirements-completed: [SHARE-03]

coverage:
  - id: D1
    description: "An owner cannot move `generation` by more than +1 in a single UPDATE — the counter can never be driven toward the BIGINT ceiling"
    requirement: SHARE-03
    verification:
      - kind: integration
        ref: "pg-harness run 2026-08-28, PostgreSQL 16 throwaway cluster: ALL 103 ARMS EXECUTED, exit 0 (arms N1 1a ceiling-jump refused, N1 1b +2 refused, N1 1c +1 accepted)"
        status: pass
      - kind: other
        ref: "mutation slipping past the source check: `OLD.generation + 1` -> `OLD.generation + 1000000` (still matches the v-e regex) -> TEST FAILED (N1 1b)"
        status: pass
    human_judgment: false
  - id: D2
    description: "`generation` is 1 on every INSERT regardless of who inserts, enforced by a trigger and not only by a column grant (R3)"
    requirement: SHARE-03
    verification:
      - kind: integration
        ref: "pg-harness 2026-08-28: arm N1 2a — a service_role INSERT naming generation = 987654321 lands at 1"
        status: pass
      - kind: other
        ref: "mutation `NEW.generation := 1` deleted -> migration ABORTS at self-verification (v-d); mutation `:= 1987654321` (regex still matches) -> TEST FAILED (OWNER 1b) — caught upstream of N1 2a, recorded honestly"
        status: pass
    human_judgment: false
  - id: D3
    description: "The nonce is FORCED on INSERT too, so a delete-and-recreate cannot rebuild the pre-revoke (nonce, generation, live) triple"
    requirement: SHARE-03
    verification:
      - kind: integration
        ref: "pg-harness 2026-08-28: arm N1 2b — a service_role INSERT naming a recorded nonce stores a different, server-generated value"
        status: pass
      - kind: other
        ref: "mutation `:= gen_random_uuid()` -> `:= NEW.nonce` (no-op, regex `NEW\\.nonce\\s*:=` still matches) -> TEST FAILED (N1 2b), its OWN arm and no other"
        status: pass
    human_judgment: false
  - id: D4
    description: "GDPR Art. 17 erasure is non-abortable BY CONSTRUCTION: overflow is unreachable, so `sanitize_user` cannot fail on `generation + 1`"
    requirement: SHARE-03
    verification:
      - kind: integration
        ref: "pg-harness 2026-08-28: arms N1 3a and SANITIZE 1a-1f execute against the real sanitize_user body; observed generation sequence {1,1,2,2,2,3}"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both intended writers still work and mint-or-reuse still does NOT touch generation"
    requirement: SHARE-01
    verification:
      - kind: integration
        ref: "pg-harness 2026-08-28: REVOKE 1a-2b, REACTIVATE 1a-1g green; revoke_strategy_share.sql:66 and sanitize_user.sql:147 both `generation = generation + 1`; create_strategy_share names generation only in its OUT signature"
        status: pass
    human_judgment: false
  - id: D6
    description: "Every new gate arm carries a RED-UNDER annotation, and the closing sentinel's roster matches the ci.yml arm count exactly"
    requirement: SHARE-03
    verification:
      - kind: other
        ref: "33 RED-UNDER annotations in test_strategy_shares_rls.sql; sentinel names exactly 103 arms; ci.yml roster row 103 + 16, ARMS_FLOOR=166 = 9+6+10+10+8+4+103+16"
        status: pass
      - kind: unit
        ref: "src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts — 18 passed (re-derives the roster from the corpus)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The amend-in-place licence still holds: these objects exist in no applied database"
    requirement: SHARE-03
    verification: []
    human_judgment: true
    rationale: "The licence was measured on 2026-08-27 (PROD strategy_shares absent, PROD ledger 0 rows, TEST absent) and re-asserted before the fix rounds. It expires the moment PR #720 lands and the migration auto-applies to PROD. A human should re-confirm PROD is still untouched immediately before merging, because after that no further in-place amendment is legal."
---

# 164-06 — N1 closed at the root: the counter cannot be driven to the ceiling

## Why this SUMMARY is post-hoc

The plan's work was carried out during Phase 164's fix rounds rather than through
a plan-scoped executor run, so `164-06-PLAN.md` sat with no SUMMARY and GSD read
the phase as `implementation_complete: false`. Rather than re-execute a plan whose
code is already at HEAD, every must-have was **re-measured on 2026-08-28** and this
file records those measurements. Nothing here is taken from the plan's intent.

## What was measured

| must-have | evidence |
|---|---|
| bounded increment | `20260827120000…sql:564`, rule (6), ordered after rule (1) |
| INSERT pin | `:513-516` — `TG_OP = 'INSERT'` forces `generation := 1` and `nonce := gen_random_uuid()` |
| trigger shape | `:621` `BEFORE INSERT OR UPDATE ON strategy_shares` |
| schema mirror in sync | `supabase/schema/functions/strategy_shares_enforce_monotonic_generation.sql` carries both |
| gate arms | 103 named in the closing sentinel; 33 `RED-UNDER` annotations |
| CI floors | `ci.yml:1738-1739` `SENTINEL_FLOOR=8`, `ARMS_FLOOR=166` |
| whole gate runs | `pg-harness/run.sh` on PostgreSQL 16, throwaway cluster → **ALL 103 ARMS EXECUTED**, exit 0 |

## The mutation finding worth keeping

Deleting any of the three new rules does **not** exercise the gate arms — the
migration's own source-shape self-verification block aborts the apply first. All
three deletions were run and all three aborted at `Migration 164-02 verification
failed`, which proves the *self-check*, not the *arms*.

To reach the arms the mutation has to keep the text the regex matches while
changing the behaviour. Three such mutations were run:

| mutation | still matches | result |
|---|---|---|
| `NEW.generation := 1` → `:= 1987654321` | `NEW\.generation\s*:=\s*1` | **RED — OWNER 1b** |
| `NEW.nonce := gen_random_uuid()` → `:= NEW.nonce` | `NEW\.nonce\s*:=` | **RED — N1 2b** |
| `OLD.generation + 1` → `+ 1000000` | `\+\s*1` | **RED — N1 1b** |

Two land on their own arms. The forced-counter mutation is caught **upstream** by
`OWNER 1b`, not by `N1 2a` — recorded rather than smoothed over, because it means
`N1 2a` has not been observed as the first detector of its own property. The class
is caught either way; the attribution is not what the arm's name implies.

The migration file was restored from a byte backup after every mutation and
verified by shasum `3ccaf9ee` — the same bytes that produced the green run.
