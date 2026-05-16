# PR #182 specialist-review apply queue (take 2) — 2026-05-16

Worktree: `quantalyze-worktrees/sql-migrations-safety`
Branch: `chore/sql-migrations-safety-2026-05-16`

## Specialist counts (raw)
- code-reviewer: 10 (2 HIGH conf-9/8 + 8 MED conf-8)
- security: 5 (1 CRITICAL conf-9, 1 MED conf-7, 2 LOW conf-5/6, 1 INFO conf-6)
- data-migration: 8 (1 CRITICAL conf-9, 1 HIGH conf-8, 2 MED conf-7/8, 3 LOW conf-6/7/8)
- pr-test-analyzer: 12 (6 HIGH conf-8/9/10, 5 MED conf-6/7/8, 1 LOW conf-4)
- performance: 6 (1 HIGH conf-8, 2 MED conf-7/8, 3 LOW conf-6/7)
- red-team: 11 (3 HIGH conf-8/8/9, 5 MED conf-7/7/8/8/8, 2 LOW conf-7/7, 1 challenge MED conf-8)

## Dedup: CRITICAL
**APPLY-CRITICAL-1 — service_role REVOKE / trigger interaction**
- code-reviewer HIGH conf-9 (mig 160700 L104-L150)
- security MED conf-7 elevated by exposure
- data-migration CRITICAL conf-9 (mig 160700 L104-L149)
- pr-test-analyzer HIGH conf-9 (mig 160700 L41-L150 — zero behavioral test coverage for reject path; will fire on direct service_role INSERT)
**Three specialists confirm = 1 CRITICAL finding.** Service_role direct INSERTs into match_decisions for bridge_recommended/voluntary_add will fail with 42501.
Fix: ADD migration `20260516170000_match_decisions_visibility_check_secdef_fix.sql` — GRANT EXECUTE on `_assert_strategy_visible_to_allocator(uuid,uuid)` to `service_role, authenticated` (Option B — matches 160100 sanitize_user GRANT pattern, less privilege risk than SECDEF on trigger).

**APPLY-CRITICAL-2 — reset_stalled_portfolio_analytics PUBLIC EXECUTE**
- security CRITICAL conf-9 (mig 20260516122247 L25-L57 — already merged via PR #184)
Fix: ADD migration `20260516170100_reset_stalled_portfolio_analytics_revoke_public.sql` — REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT TO service_role; add `_assert_no_public_execute` self-verifier.

## Dedup: HIGH conf ≥7
**APPLY-HIGH-1 — NOT VALID v2 CHECKs lack VALIDATE follow-up**
- data-migration HIGH conf-8 (mig 160400 L88-L102 + 160500)
Fix: ADD migration `20260516170200_match_decisions_constraint_validate.sql` — VALIDATE both constraints (wrapped in DO/EXCEPTION to surface violator count cleanly).

**APPLY-HIGH-2 — DELETE on notification_dispatches seq-scans**
- red-team HIGH conf-9 (mig 160100 L158)
Fix: ADD migration `20260516170300_notification_dispatches_recipient_email_idx.sql` using CREATE INDEX CONCURRENTLY (no BEGIN/COMMIT wrapper).

**APPLY-HIGH-3 — CREATE INDEX on portfolio_analytics without CONCURRENTLY**
- performance HIGH conf-8 (mig 20260516122247 already merged via PR #184)
Fix: ADD migration `20260516170400_portfolio_analytics_computing_idx_concurrently.sql` — DROP existing blocking index + CREATE INDEX CONCURRENTLY (no BEGIN/COMMIT wrapper).

**APPLY-HIGH-4 — 23502 regression timebomb in bridge-outcome-cron tests**
- pr-test-analyzer HIGH conf-10 (mig 160600 L60-L61 vs bridge-outcome-cron.test.ts L134, bridge-outcome-cron-holding.test.ts L237/L326/L382)
Fix: EDIT 4 test sites in `src/__tests__/bridge-outcome-cron*.test.ts` to include `kind: 'bridge_recommended'` field.

**APPLY-HIGH-5 — sanitize_user verification regex brittleness**
- red-team HIGH conf-8 (mig 160100 L256-L275)
Fix: NEW migration `20260516170500_sanitize_user_verification_robustness.sql` that re-installs sanitize_user verification with schema-prefix-tolerant regexes. (CANNOT edit 160100 itself per hard rule.)

**APPLY-HIGH-6 — Vercel rollback re-opens 23502 surface**
- red-team HIGH conf-8 (mig 160600 L60-L62)
Fix: DOCUMENT in `docs/runbooks/sql-migrations-coverage-2026-05-16.md`. Operational, not code.

## Dedup: MED conf ≥8
**APPLY-MED-1 — _validate_scenario_diff numeric cast 22P02 leak**
- code-reviewer MED conf-8 (mig 160800 L103/L118/L144)
- red-team MED conf-8 (same finding)
Fix: NEW migration `20260516170600_validate_scenario_diff_numeric_cast_hardening.sql` CREATE OR REPLACE FUNCTION with BEGIN/EXCEPTION guarded numeric casts.

**APPLY-MED-2 — SET search_path on non-SECDEF helpers**
- code-reviewer MED conf-8 (mig 160700 L114-L134 _match_decisions_visibility_check)
- security INFO conf-6 (same + 160200 + 160800)
Fix: Part of `20260516170000` — re-create trigger fn with SET search_path. Also part of `20260516170600` for _validate_scenario_diff.

**APPLY-MED-3 — orphan-org bypass / privacy backdoor**
- data-migration MED conf-7
- security MED conf-7
- red-team MED conf-7
Fix: Tighten orphan-org branch. Part of `20260516170000` — re-create helper with stricter orphan handling: return FALSE for orphan-org by default (fail closed).

**APPLY-MED-4 — Stale test_sanitize_user_hardening.sql Test 3 inverted polarity**
- pr-test-analyzer MED conf-7 (supabase/tests/test_sanitize_user_hardening.sql L194-L196)
Fix: EDIT `supabase/tests/test_sanitize_user_hardening.sql` Test 3 to assert PRESENCE not absence (+ add M-0796 PRESENT assertion).

**APPLY-MED-5 — Sequential ALTER TABLE lock-acquisition race**
- red-team MED conf-8 (160400/500/600 each takes EXCLUSIVE; lock_timeout=5s)
DEFER: bumping lock_timeout or merging into one tx are both invasive. The retry semantics with lock_timeout=5s are operationally acceptable. Document in runbook.

**APPLY-MED-6 — _validate_scenario_diff dead code (not wired)**
- pr-test-analyzer HIGH conf-9 (zero coverage AND not invoked)
DEFER for wiring (out of scope), but APPLY-MED-1 fix here improves the contract correctness if/when wired. Tests at supabase/tests level: defer.

## NOT applied (LOWER conf or settled overrides)
- search_path TO '' override: NOT APPLIED (settled per user override; codebase convention is `public, pg_catalog`).
- match_decisions visibility GUC escape hatch (red-team MED conf-8): DEFER — not exercised by any current code path; over-engineering.
- frozen_post_sanitize column (red-team MED conf-7): DEFER — new column on organizations needs separate PR scope.
- Supabase preview-branch order (red-team challenge MED conf-8): DOCUMENT only; per main+preview separation no concurrent apply.
- 23514 admin route remap to 409 (red-team MED conf-7): DEFER — not in SQL migrations scope; new PR for routes.
- COUNT(*) → EXISTS optimization (performance LOW conf-6): DEFER per LOW conf.
- 160300 STEP 3 block-comment hole (code-reviewer + red-team LOW conf-7): DEFER per LOW conf.
- 160300 STEP 1 bootstrap (data-migration LOW conf-7): DEFER per LOW conf.
- 160100 second-sanitize PII gap (data-migration LOW conf-6): DEFER per LOW conf.
- SET LOCAL lock_timeout (data-migration LOW conf-8): DEFER — Supabase migration-runner-per-file isolates session.
- 161000 - 122247 lock_timeout (performance MED conf-7): DEFER — index migration goes CONCURRENTLY (no tx wrapper). 121000 data_quality column add lock_timeout: DEFER (idempotent metadata-only).
- _assert_retention_columns service_role GRANT (performance LOW conf-6): DEFER (canary cron not yet built).

## Commit plan
1. `chore(audit-2026-05-07): SQL migrations — apply CRITICAL service_role REVOKE fix (new migration 20260516170000)` — closes APPLY-CRITICAL-1 + APPLY-MED-2 (search_path on trigger fn) + APPLY-MED-3 (orphan-org tightening)
2. `chore(audit-2026-05-07): SQL migrations — apply CRITICAL reset_stalled_portfolio_analytics REVOKE (new migration 20260516170100)` — APPLY-CRITICAL-2
3. `chore(audit-2026-05-07): SQL migrations — apply HIGH (CONCURRENTLY index, VALIDATE CONSTRAINT, notification_dispatches idx)` — APPLY-HIGH-1 + APPLY-HIGH-2 + APPLY-HIGH-3
4. `chore(audit-2026-05-07): SQL migrations — apply HIGH test fixes (bridge-outcome-cron 23502 timebomb + kind defaults + sanitize_user verification regex)` — APPLY-HIGH-4 + APPLY-HIGH-5 + APPLY-MED-4
5. `chore(audit-2026-05-07): SQL migrations — apply MED specialist findings (numeric cast hardening, runbook doc)` — APPLY-MED-1 + APPLY-HIGH-6 docs
6. `docs(audit-2026-05-07): SQL migrations — proper-specialist apply pass FIX-REPORT`
