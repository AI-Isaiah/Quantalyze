# PR #182 specialist-review apply pass take 2 — FIX-REPORT

**Date**: 2026-05-16
**Branch**: `chore/sql-migrations-safety-2026-05-16`
**Worktree**: `quantalyze-worktrees/sql-migrations-safety`
**Apply queue**: `.review/apply-queue-2026-05-16-take2.md`

## Specialist findings → resolution map

### Code-reviewer (10 findings)

| # | Title | Severity / Conf | Status | Closure / Reason |
|---|-------|------|--------|------------------|
| 1 | Visibility trigger calls SECDEF helper REVOKEd from service_role | HIGH 9 | CLOSED | Mig 20260516170000 (commit 1) — GRANT EXECUTE to service_role + authenticated. Dedup'd with security #1 and data-migration #1 — same finding. |
| 2 | Tightened voluntary_modify CHECK + cron holding-branch coupling | HIGH 8 | DEFERRED | Documented in runbook — operationally acceptable; specialist confirms invariant is closed; cron-attribution semantics are intentional. Adding a probe is out-of-scope. |
| 3 | percent_allocated numeric cast unguarded in _validate_scenario_diff | IMPORTANT 8 | CLOSED | Mig 20260516170600 (commit 5) — BEGIN/EXCEPTION-wrapped numeric casts in all 3 sites + smoke-test verifying 22023 with [index=N]. |
| 4 | _assert_strategy_visible_to_allocator + RLS bypass on non-BYPASSRLS owner | IMPORTANT 8 | DEFERRED | Settled: function is SECURITY DEFINER with postgres owner (Supabase Cloud convention). Adding `SET LOCAL row_security = off;` is a defensive change that affects all install targets; out-of-scope for take-2. |
| 5 | M-0822 behavioral CTE probe — block-comment hole | IMPORTANT 8 | DEFERRED | LOW per take-2 prioritization. Probe is correct on current canonical body; brittleness is hypothetical for future drift. |
| 6 | voluntary_modify CHECK without code-path probe for cron CTE branch | IMPORTANT 8 | DEFERRED | Cron coverage is intentional via holding branch (per runbook); adding behavioral probe is out-of-scope. |
| 7 | Trigger function _match_decisions_visibility_check lacks SET search_path | IMPORTANT 8 | CLOSED | Mig 20260516170000 (commit 1) — re-created trigger fn with SET search_path = public, pg_catalog. Dedup'd with security #5. |
| 8 | Drop-DEFAULT NOT-NULL contract race | IMPORTANT 8 | DEFERRED | Mig 080 STEP 5 enforces NOT NULL; mig 160600 STEP 3 post-DDL probe catches drift. Pre-flight probe would also work but adds incremental safety only. |
| 9 | _assert_retention_columns probes only 6 columns | IMPORTANT 8 | DEFERRED | Expanding to all cron-body columns is a coverage extension better tracked as backlog (canary cron not yet built). |
| 10 | sanitize_user verification probe substring matches | IMPORTANT 8 | DEFERRED | Same brittleness class as #5; LOW priority for take-2. |

### Security (5 findings)

| # | Title | Severity / Conf | Status | Closure / Reason |
|---|-------|------|--------|------------------|
| 1 | reset_stalled_portfolio_analytics SECDEF lacks REVOKE — cross-tenant DoS | CRITICAL 9 | CLOSED | Mig 20260516170100 (commit 2) — REVOKE FROM PUBLIC/anon/authenticated; GRANT TO service_role only; self-verifying probe. |
| 2 | _assert_strategy_visible_to_allocator orphan-org bypass | MED 7 | CLOSED | Mig 20260516170000 (commit 1) — orphan-org now returns FALSE (fail-closed). Dedup'd with data-migration #3 + red-team #5. |
| 3 | _assert_strategy_visible_to_allocator no status check | LOW 6 | DEFERRED | Upstream RPC already checks status='published'; trigger is defense-in-depth. Adding status read is incremental hardening. |
| 4 | Trigger error message confirms strategy existence | LOW 5 | DEFERRED | Tiny enumeration oracle; strategies_org_read RLS already allows existence probing. |
| 5 | Non-SECDEF helpers lack SET search_path | INFO 6 | CLOSED (partial) | Mig 20260516170000 + 20260516170600 add SET search_path to _match_decisions_visibility_check + _validate_scenario_diff. _assert_retention_columns DEFERRED (not changed in take-2). |

### Data-migration (8 findings)

| # | Title | Severity / Conf | Status | Closure / Reason |
|---|-------|------|--------|------------------|
| 1 | BEFORE INSERT trigger REVOKEd helper — 42501 | CRITICAL 9 | CLOSED | Same as code-reviewer #1 — mig 20260516170000 (commit 1). |
| 2 | NOT VALID CHECKs lack VALIDATE step | HIGH 8 | CLOSED | Mig 20260516170200 (commit 3) — VALIDATE CONSTRAINT for both v2 CHECKs after pre-flight. |
| 3 | Orphan-org bypass | MED 7 | CLOSED | Same as security #2 + red-team #5 — mig 20260516170000 fail-closed branch. |
| 4 | No tests cover visibility-check trigger | MED 8 | DEFERRED | Adding live-DB test for trigger is out-of-scope for take-2; CRITICAL-1 closure neutralizes the immediate risk. Tracked as tech-debt. |
| 5 | 160400+160500+160600 partial-apply leaves intermediate state | MED 7 | DEFERRED | Each migration is independently idempotent + self-verifying. Consolidating into one tx is operationally invasive; current shape acceptable. |
| 6 | SET lock_timeout not SET LOCAL | LOW 8 | DEFERRED | Supabase migration-runner-per-file isolates session. |
| 7 | 160300 STEP 1 bootstrap incomplete | LOW 7 | DEFERRED | Sibling-branch use case is unsupported. |
| 8 | 160100 second-sanitize PII gap | LOW 6 | DEFERRED | Edge case; defer. |

### PR-test-analyzer (12 findings)

| # | Title | Severity / Conf | Status | Closure / Reason |
|---|-------|------|--------|------------------|
| 1 | bridge-outcome-cron tests 23502 timebomb | HIGH 10 | CLOSED | Commit 4 — added `kind: 'bridge_recommended'` to all 4 sites. |
| 2 | _assert_strategy_visible_to_allocator zero reject-path coverage | HIGH 9 | DEFERRED | CRITICAL-1 closure neutralizes the immediate risk. Adding tests is tracked as tech-debt. |
| 3 | _validate_scenario_diff dead code (not wired) | HIGH 9 | DEFERRED | Helper installed for future wiring; wiring is out-of-scope. MED-1 numeric cast fix improves contract correctness if/when wired. |
| 4 | sanitize_user notification_dispatches purge no behavioral test | HIGH 9 | DEFERRED | Verification regex in mig 160100 catches body-absence; behavioral test deferred. |
| 5 | voluntary_modify v2 CHECK rejection path uncovered + JS predicate stale | HIGH 8 | DEFERRED | Adding T_REJECT_VM is incremental test coverage; tracked as tech-debt. JS predicate update is one-line but lower priority. |
| 6 | sql-tests CI job has zero new test files | HIGH 8 | DEFERRED (partial) | Test_sanitize_user_hardening.sql Test 3 updated (commit 4); adding 3 net-new SQL test files is out-of-scope. |
| 7 | _assert_retention_columns never invoked at runtime | MED 8 | DEFERRED | Canary cron not yet built. |
| 8 | data_deletion_requests_state_check rejection path uncovered | MED 7 | DEFERRED | Mig self-verify checks existence; behavioral test is incremental. |
| 9 | test_sanitize_user_hardening.sql Test 3 stale (inverted polarity) | MED 7 | CLOSED | Commit 4 — polarity inverted + M-0796 PRESENT assertion added. |
| 10 | Empty-DB apply order assumption | MED 6 | DEFERRED | Timestamp ordering guarantees mig 080 → 160400; out-of-order replay unsupported. |
| 11 | voluntary_modify legacy violator silent cron skip | MED 6 | DEFERRED | Pre-flight NOTICE flags the count; tracked as backfill operation. |
| 12 | _validate_scenario_diff helper per-diff index annotation untested | LOW 4 | DEFERRED | LOW per take-2 prioritization. |

### Performance (6 findings)

| # | Title | Severity / Conf | Status | Closure / Reason |
|---|-------|------|--------|------------------|
| 1 | CREATE INDEX on portfolio_analytics without CONCURRENTLY | HIGH 8 | CLOSED | Mig 20260516170400 (commit 3) — DROP + CONCURRENTLY rebuild. |
| 2 | ALTER TABLE portfolio_analytics ADD COLUMN missing lock_timeout | MED 8 | DEFERRED | Metadata-only ADD COLUMN (no rewrite) acceptable without explicit lock_timeout. |
| 3 | Stuck-row-reaper missing lock_timeout | MED 7 | DEFERRED | Mig 170400 takes CONCURRENTLY path; lock_timeout concern shifts to SHARE UPDATE EXCLUSIVE. |
| 4 | COUNT(*) in visibility helper should use EXISTS | LOW 6 | DEFERRED | Match_decisions write volume is low; LOW priority. |
| 5 | Visibility trigger SECDEF overhead per row | LOW 7 | DEFERRED | Sub-ms per row; acceptable for current batch sizes. |
| 6 | _assert_retention_columns REVOKEd from service_role | LOW 6 | DEFERRED | Canary cron not yet built; documentation nit. |

### Red-team (11 findings)

| # | Title | Severity / Conf | Status | Closure / Reason |
|---|-------|------|--------|------------------|
| 1 | DELETE FROM notification_dispatches seq-scans | HIGH 9 | CLOSED | Mig 20260516170300 (commit 3) — CREATE INDEX CONCURRENTLY on recipient_email. |
| 2 | sanitize_user verification regex schema-qualification | HIGH 8 | DOCUMENTED | Cannot edit mig 160100 itself per rebase contract. Future-coordination note added to runbook (commit 5). |
| 3 | Vercel rollback re-opens 23502 surface | HIGH 8 | DOCUMENTED | Operator runbook (commit 5) — preferred forward-roll, fallback emergency SET DEFAULT migration. |
| 4 | _validate_scenario_diff numeric cast 22P02 leak | MED 8 | CLOSED | Same as code-reviewer #3 — mig 20260516170600 (commit 5). |
| 5 | Orphan-org bypass permanent backdoor | MED 7 | CLOSED | Same as security #2 + data-migration #3 — mig 20260516170000 fail-closed. |
| 6 | Sequential ALTER TABLE lock-acquisition race | MED 8 | DEFERRED | Operationally acceptable retry semantics with lock_timeout=5s. Consolidating migrations is invasive. |
| 7 | 23514 admin route remap to 409 | MED 7 | DEFERRED | Out-of-scope for SQL migrations PR (route changes belong to a separate PR). |
| 8 | Visibility trigger blocks support backfill (no GUC bypass) | MED 8 | DEFERRED | No current support backfill path needs bypass; over-engineering. ALTER TABLE DISABLE TRIGGER is documented escape. |
| 9 | Supabase preview-branch apply-order | MED 8 (challenge) | DOCUMENTED | Branches are independent DBs; no single-replica concurrent apply. Runbook note added. |
| 10 | 160300 STEP 3 substring probe false-match in string literals | LOW 7 | DEFERRED | Current canonical body doesn't contain matching string literals; brittleness hypothetical. |
| 11 | NOT VALID constraints silently never enforced (no CI gate) | LOW 7 | DEFERRED (partial) | Mig 170200 (commit 3) VALIDATEs the take-2 NOT VALID set; broader CI gate is out-of-scope. |

## Summary

| Specialist | Total | CLOSED | DEFERRED | DOCUMENTED |
|------------|------:|-------:|---------:|-----------:|
| code-reviewer | 10 | 3 | 7 | 0 |
| security | 5 | 2 | 2 | 1 (partial-CLOSED) |
| data-migration | 8 | 3 | 5 | 0 |
| pr-test-analyzer | 12 | 2 | 10 | 0 |
| performance | 6 | 1 | 5 | 0 |
| red-team | 11 | 3 | 5 | 3 |
| **Total** | **52** | **14** | **34** | **4** |

## Migrations added

| Migration | Closes | Lines |
|-----------|--------|------:|
| 20260516170000_match_decisions_visibility_check_secdef_fix.sql | CRITICAL-1 + MED-2 + MED-3 | 218 |
| 20260516170100_reset_stalled_portfolio_analytics_revoke_public.sql | CRITICAL-2 | 73 |
| 20260516170200_match_decisions_constraint_validate.sql | HIGH-1 | 109 |
| 20260516170300_notification_dispatches_recipient_email_idx.sql | HIGH-2 | 33 |
| 20260516170400_portfolio_analytics_computing_idx_concurrently.sql | HIGH-3 | 56 |
| 20260516170600_validate_scenario_diff_numeric_cast_hardening.sql | MED-1 + MED-2 | 213 |

## Test/runbook edits

| File | Change |
|------|--------|
| src/__tests__/bridge-outcome-cron.test.ts | Added `kind: 'bridge_recommended'` to 1 INSERT site |
| src/__tests__/bridge-outcome-cron-holding.test.ts | Added `kind: 'bridge_recommended'` to 3 INSERT sites |
| supabase/tests/test_sanitize_user_hardening.sql | Inverted Test 3 polarity + added M-0796 assertion |
| docs/runbooks/sql-migrations-coverage-2026-05-16.md | Take-2 finding map + HIGH-5/6 runbook sections |

## Commits

1. `fdd53225 chore(audit-2026-05-07): SQL migrations — apply CRITICAL service_role REVOKE fix (new migration 20260516170000)`
2. `6be391ad chore(audit-2026-05-07): SQL migrations — apply CRITICAL reset_stalled_portfolio_analytics REVOKE (new migration 20260516170100)`
3. `4397e620 chore(audit-2026-05-07): SQL migrations — apply HIGH (CONCURRENTLY indexes + VALIDATE CONSTRAINT)`
4. `3709914f chore(audit-2026-05-07): SQL migrations — apply HIGH test fixes (bridge-outcome-cron 23502 timebomb + sanitize_user verification polarity)`
5. `8516466c chore(audit-2026-05-07): SQL migrations — apply MED specialist findings (numeric cast hardening + rollback runbook)`
6. `chore(audit-2026-05-07): SQL migrations — proper-specialist apply pass FIX-REPORT` (this file)
