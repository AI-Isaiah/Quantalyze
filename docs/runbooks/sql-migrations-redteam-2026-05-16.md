# SQL Migrations Safety — Red-Team Pass (2026-05-16)

Adversarial scenarios for the 9 new `20260516*_*.sql` migrations.

## Scenario 1 — Concurrent apply (two replicas)

**Setup**: Two migration runner replicas race to apply
`20260516160400_match_decisions_bridge_recommended_xor.sql` simultaneously.

**Risk**: Replica A drops the old CHECK; Replica B sees it's already gone
and skips DROP. Replica B then tries to ADD v2 first — succeeds. Replica
A's subsequent ADD v2 hits the `IF NOT EXISTS` guard inside the DO
block and skips. Both finish cleanly.

**Verdict**: SAFE. The DO-block IF EXISTS / IF NOT EXISTS guards make
each statement idempotent. The two-statement DROP + ADD pattern is
not atomic across replicas but the operations are commutative.

**Mitigation already in code**: every DDL in this migration is wrapped
in DO block existence guards.

---

## Scenario 2 — Replay (migration runs twice after a crash)

**Setup**: Migration runner crashes mid-way through a file. Resumes
and replays the entire file.

**Risk per file**:

| File | Replay safety |
|------|--------------|
| `20260516160000_data_deletion_requests_state_check.sql` | SAFE — DO-block IF NOT EXISTS guard on the ADD CONSTRAINT |
| `20260516160100_sanitize_user_purge_notification_dispatches.sql` | SAFE — CREATE OR REPLACE function (preserves ACL) |
| `20260516160200_retention_crons_schema_drift_probe.sql` | SAFE — CREATE OR REPLACE function, REVOKE is no-op |
| `20260516160300_match_decisions_kind_enum_idempotency.sql` | SAFE — read-only assertion + DO-block IF NOT EXISTS for CREATE TYPE |
| `20260516160400_match_decisions_bridge_recommended_xor.sql` | SAFE — DO-block existence guards on DROP + ADD |
| `20260516160500_match_decisions_voluntary_modify_check.sql` | SAFE — same pattern as 160400 |
| `20260516160600_match_decisions_drop_kind_default.sql` | SAFE — ALTER ... DROP DEFAULT is idempotent |
| `20260516160700_commit_scenario_batch_strategy_visibility.sql` | SAFE — CREATE OR REPLACE function + DROP TRIGGER IF EXISTS + CREATE TRIGGER |
| `20260516160800_commit_scenario_batch_diff_schema.sql` | SAFE — CREATE OR REPLACE function |

**Verdict**: All 9 migrations replay-safe.

---

## Scenario 3 — Old-enum-consumer pre-dates kind enum

**Setup**: A long-running compute worker connected before the latest
deploy still has a cached pg_proc / pg_type catalog and tries to
insert into match_decisions using only the pre-Phase-10 columns
(strategy_id, decision, decided_by — no `kind`).

**Risk**: After `20260516160600_match_decisions_drop_kind_default.sql`
strips the DEFAULT, the INSERT will fail with `23502 not_null_violation`
on the `kind` column. The worker either:
  (a) raises uncaught → worker restarts → reads fresh catalog → succeeds with kind set
  (b) catches and silently retries → infinite loop

**Verdict**: ACCEPTABLE — fail-loud is the correct behavior. The
DEFAULT was a back-compat crutch and removing it makes silent
mis-categorization impossible (the audit's H-0960 finding). Documented
in the migration header. Operators must coordinate worker deploys to
include kind=<value> on every INSERT before applying this migration.

**Pre-flight remediation**: The migration's STEP 1 asserts no NULL
kind rows currently exist. If a worker's stale catalog inserts a
NULL-kind row between apply and the assertion, the migration aborts
with a clear error pointing operators to the offending state.

---

## Scenario 4 — RLS-bypass via new helper functions

**Setup**: An attacker with valid `authenticated` JWT discovers the
helper functions:
  * `_assert_strategy_visible_to_allocator` (SECURITY DEFINER)
  * `_match_decisions_visibility_check` (trigger function)
  * `_validate_scenario_diff`
  * `_assert_retention_columns`

**Risk per helper**:

| Helper | Attack surface | Status |
|--------|----------------|--------|
| `_assert_strategy_visible_to_allocator` | SECURITY DEFINER, reads strategies + organization_members. REVOKEd from all app roles. Reachable only via the trigger (which fires when authenticated user INSERTs into match_decisions — the user is already restricted to their own allocator_id by other RLS). | SAFE |
| `_match_decisions_visibility_check` | Trigger function — not directly callable; PG fires it automatically. | SAFE |
| `_validate_scenario_diff` | EXECUTE granted to authenticated + service_role. Pure validation, STABLE, no DML. Even on adversarial input it raises 22023 or no-ops. | SAFE |
| `_assert_retention_columns` | REVOKEd from all app roles. Only callable by postgres (migration runner) and other SECURITY DEFINER helpers. | SAFE |

**Verdict**: SAFE. The most exposed helper (`_validate_scenario_diff`)
is pure validation with no DML and no privilege escalation paths.

---

## Scenario 5 — Rollback of this PR

**Setup**: Operator decides this PR's changes are buggy and wants to
revert.

**Path**: Re-apply prior migrations:
1. `20260515210100_sanitize_user_high_hardening.sql` (restores sanitize_user
   without the notification_dispatches DELETE).
2. Drop the new constraints / triggers / helpers:
   - `ALTER TABLE data_deletion_requests DROP CONSTRAINT data_deletion_requests_state_exclusive;`
   - `ALTER TABLE match_decisions DROP CONSTRAINT match_decisions_kind_bridge_recommended_v2;`
   - `ALTER TABLE match_decisions DROP CONSTRAINT match_decisions_kind_voluntary_modify_v2;`
   - (Re-add the OR-shaped + unconstrained-original_strategy_id CHECKs from mig 080
     if those were previously dropped via the canonical names.)
   - `ALTER TABLE match_decisions ALTER COLUMN kind SET DEFAULT 'bridge_recommended';`
   - `DROP TRIGGER match_decisions_visibility_check ON match_decisions;`
   - `DROP FUNCTION _match_decisions_visibility_check(); DROP FUNCTION _assert_strategy_visible_to_allocator(uuid, uuid); DROP FUNCTION _validate_scenario_diff(jsonb, int); DROP FUNCTION _assert_retention_columns();`

**Verdict**: REVERSIBLE — each new object can be DROPped without cascading
data loss. The XOR tightening (160400) and voluntary_modify tightening
(160500) used `NOT VALID` so existing data is not affected and the
DROP path is a one-statement reversal.

**Documented in**: this PR's `docs/runbooks/sql-migrations-coverage-2026-05-16.md`
and inline comments in each migration's header.

---

## Scenario 6 — XOR pre-flight violator detected mid-deploy

**Setup**: A row with kind='bridge_recommended' AND both originals set
exists on production (the "rare legacy" case ADR-0023 tolerated).

**Path through this PR**:
1. `20260516160400` STEP 1 counts the violator → RAISES NOTICE.
2. STEP 2 ADDs CHECK with `NOT VALID` → succeeds (no validation
   against existing rows).
3. STEP 3 verifies the CHECK is present → succeeds.
4. The migration COMMITs. Existing both-set rows remain in place
   (CHECK is NOT VALID so they're not retroactively rejected).
5. Future INSERTs with both-set will hit the CHECK at write time
   and fail loudly with 23514.

**Verdict**: GRACEFUL DEGRADATION. The migration applies cleanly,
emits NOTICE for ops follow-up, and prevents new violators without
breaking existing data.

---

## Scenario 7 — Trigger fires during sanitize_user

**Setup**: sanitize_user inserts a `match_decisions` row? — actually
NO, sanitize_user DELETEs match_batches but never INSERTs match_decisions.
The new BEFORE INSERT trigger therefore doesn't fire during sanitize.

**Risk**: COMPOSITE — if a parallel admin path inserts a match_decision
while sanitize_user is running for the same user, both transactions can
race. The trigger may raise on either, but neither runs inside the same
tx as sanitize.

**Verdict**: SAFE — no new interaction surface between sanitize and the
trigger.

---

## Scenario 8 — Multi-tenant org_id NULL leakage

**Setup**: strategy A has organization_id = NULL (owner-scoped, single
user). The visibility helper returns TRUE for any allocator.

**Risk**: If a strategy was MEANT to be org-scoped but the
organization_id is unset (data drift), the visibility gate is permissive.
That's the intentional "global publish" semantics — but is it correct?

**Verdict**: ACCEPTABLE — matches the audit narrative ("if 'published'
is meant to be globally visible, this is intentional"). The mitigation
adds defense-in-depth for the EXPLICITLY org-scoped case while
preserving global-publish semantics. A future tighter mode can flip
this by ALTER FUNCTIONing the helper to return FALSE on NULL org_id.

---

## Scenario 9 — Trigger function fails during INSERT — transaction state?

**Setup**: `_match_decisions_visibility_check` raises 42501
insufficient_privilege. What happens to the parent transaction?

**Risk**: BEFORE INSERT trigger raising EXCEPTION aborts the INSERT
and propagates to the caller. If the caller is commit_scenario_batch
mid-loop, the entire RPC transaction rolls back (atomic — desired).
If the caller is send_intro_with_decision, same behavior.

**Verdict**: SAFE — atomic rollback is the desired behavior.

---

## Scenario 10 — _validate_scenario_diff smoke probe in DO block

**Setup**: The verification DO block in `20260516160800` runs
`PERFORM public._validate_scenario_diff(jsonb_build_object('kind', 'voluntary_remove', 'holding_ref', 'okx:spot:BTC-USDT:spot', 'rejection_reason', 'mandate_conflict'), 0);`

**Risk**: If the `match_decision_kind` enum is missing the
'voluntary_remove' value (mig 080 not applied), the cast inside the
helper raises 22P02 invalid_text_representation — but the smoke probe
expects no error. The migration aborts with a confusing error message.

**Verdict**: ACCEPTABLE — if the enum is missing, the prior migration
`20260516160300` would have already raised a clear assertion error
about it. The 160800 file ordering guarantees the enum is verified
before any smoke probe runs.

**Mitigation**: file ordering enforces the chain. The coverage map
documents that 160300 must apply before 160800.

---

## Summary

All 10 scenarios reviewed. **Zero new SQL adversarial paths added.**
The migrations harden existing defects without opening new attack
surfaces. Existing helpers (`_assert_no_public_execute`) are leveraged
where applicable. Pre-flight violator counts + NOT VALID guards make
every change replay-safe and graceful under legacy data.
</content>
</invoke>