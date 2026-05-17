# PR #182 Retro Audit Follow-up — Fix Report

**Branch:** `fix/pr182-audit-followup-2026-05-17`
**Base:** `origin/main` @ `2fd79ffe` (v0.22.40.28 fix(ci-retro): close ~8 HIGH retroactive specialist findings on PR #188 fix-content)
**Version:** 0.22.40.28 -> 0.22.40.29
**Task:** #57 — close actionable findings from the retroactive migration-reviewer + rls-policy-auditor audits of PR #182.

## Summary

Threshold-filtered (CRITICAL / HIGH conf>=7 / MED conf>=8 / LOW conf>=9)
retroactive findings on PR #182 turned up 15 total items (9 from
migration-reviewer, 6 from rls-policy-auditor). This PR closes the 3
items that represent an active live gap or test gap (+ 1 self-review
perf companion); the other 6 are explicitly deferred with documented
rationale in `follow-up-pr-findings.md`.

All 20 PR #182 migrations are applied to prod (supabase-migrate run
25972386247 SUCCESS on 2026-05-17). Per migration-reviewer invariant
#11 ("edit-applied-migration prohibition"), ALL fixes ship as NEW
corrective migrations, NOT edits to applied files.

## Findings catalogue + decisions

Sources:
- `/Users/helios-mammut/claude-projects/quantalyze/.review/retro-audit-pr182.migration-reviewer.jsonl` (9 findings)
- `/Users/helios-mammut/claude-projects/quantalyze/.review/retro-audit-pr182.rls-policy-auditor.jsonl` (6 findings)

| ID | Source | Sev/Conf | File | Disposition |
|----|--------|----------|------|-------------|
| F1 | rls-policy HIGH #1 | HIGH/8 | `20260516170000` GRANT EXECUTE to authenticated (probe-oracle) | APPLIED — commit `ec475bcd` |
| F2 | rls-policy HIGH #4 | HIGH/8 | test gap: visibility-trigger leak scopes uncovered | APPLIED — commit `928e2555` |
| F3 | migration-rev MED #8 | MED/8 | `20260516160100` GDPR recipient_email case-sensitivity | APPLIED — commit `a2adba3b` |
| F3b | self-review perf companion | n/a | functional index on `LOWER(recipient_email)` for sanitize_user perf parity | APPLIED — commit `9ad4a397` |
| F4 | migration-rev HIGH #1 | HIGH/8 | `20260516170400` CONCURRENTLY in-tx split | DEFERRED — Task #47 |
| F5 | migration-rev HIGH #2 | HIGH/7 | `20260516160700` REVOKE service_role bad-shape | DEFERRED — corrected by 170000 in prod |
| F6 | migration-rev MED #3 | MED/8 | `20260516160700` trigger missing search_path | DEFERRED — corrected by 170000 in prod |
| F7 | migration-rev MED #4 | MED/8 | `20260516160800` bare ::numeric casts | DEFERRED — corrected by 170600 in prod |
| F8 | migration-rev MED #5 | MED/8 | `20260516160800` _validate_scenario_diff missing search_path | DEFERRED — corrected by 170600 in prod |
| F9 | migration-rev MED #6 | MED/8 | `20260516170000` GRANT EXECUTE to authenticated | CLOSED by F1 (same root cause) |
| F10 | migration-rev MED #7 | MED/8 | `20260516160200` _assert_retention_columns over-restrictive ACL | DEFERRED — no live impact |
| F11 | migration-rev MED #9 | MED/8 | `20260516170400` DROP+CONCURRENTLY planner-blind window | DEFERRED — Task #47 (CONCURRENTLY split covers this) |
| F12 | rls-policy HIGH #2 | HIGH/8 | `20260516160700` orphan-org widening bad-shape | DEFERRED — corrected by 170000 in prod |
| F13 | rls-policy HIGH #3 | HIGH/9 | `20260516160700` REVOKE service_role production-breaker | DEFERRED — corrected by 170000 in prod |
| F14 | rls-policy MED #5 | MED/8 | `20260516160700` trigger search_path drift | DEFERRED — corrected by 170000 in prod |
| F15 | rls-policy MED #6 | MED/8 | `20260516170100` PUBLIC EXECUTE leak window (one-time, closed) | DEFERRED — historical, leak window closed at deploy |

**Closed:** 3
**Deferred:** 9 (with rationale in `follow-up-pr-findings.md`)
**Covered by other fixes:** 1 (F9 is duplicate root cause of F1)
**Out-of-scope (separate task):** 2 (F4, F11 → Task #47)

## Applied fixes — detail

### F1 — REVOKE EXECUTE on _assert_strategy_visible_to_allocator FROM authenticated (HIGH/8)

**Live gap:** authenticated users could call the SECDEF helper directly
to probe (a) strategy_id UUID existence, (b) owner-scoped vs org-scoped
classification, (c) (strategy_id, user_id) -> org-membership boolean —
bypassing strategies RLS that otherwise hides org-scoped strategy
existence from non-members.

**Fix:** new migration `20260517013000_revoke_probe_oracle_assert_strategy_visible_to_allocator.sql`.
- REVOKE EXECUTE FROM authenticated
- Defensive REVOKE FROM PUBLIC, anon
- GRANT EXECUTE TO service_role re-asserted (the BEFORE INSERT trigger
  fires under service_role for the two PR-182 admin-client routes;
  removing service_role EXECUTE is the CRITICAL-1 bug pattern 170000
  closed)
- Self-verifying DO block asserts authenticated/anon lack EXECUTE +
  service_role has EXECUTE

**Commit:** `ec475bcd`

### F2 — Regression tests for visibility-trigger leak scopes (HIGH/8)

**Test gap:** `src/__tests__/match-decisions-xor-rls.test.ts` covers
the `kind` NOT-NULL contract from PR #182 but zero regression coverage
for the visibility-trigger leak scopes. A future regression
(replacing the trigger function or revoking the GRANT) would land
silently.

**Fix:** new sibling test file
`src/__tests__/match-decisions-visibility-trigger-rls.test.ts`
covering 5 scopes:
1. Cross-org allocator INSERT → 42501
2. In-org allocator INSERT → succeeds
3. Orphan-org strategy INSERT → fails-closed (post-170000 MED-3)
4. service_role direct INSERT → succeeds (CRITICAL-1 regression probe)
5. NULL-org (owner-scoped) strategy INSERT → succeeds (no org gate)

Gated by `HAS_LIVE_DB`; skips gracefully in CI without test-DB
secrets. Uses test-DB Supabase project `qmnijlgmdhviwzwfyzlc` (per
memory `reference_test_supabase_project`).

**Commit:** `928e2555`

### F3 — sanitize_user recipient_email DELETE case-insensitive (MED/8)

**Live gap:** `20260516160100` ships
```
DELETE FROM notification_dispatches WHERE recipient_email = v_target_email;
```
Both columns are TEXT with no canonicalization. RFC 5321 says email
domains are always case-insensitive and local-parts are case-
insensitive in practice. A `User@Example.com` / `user@example.com`
mismatch between `profiles.email` and
`notification_dispatches.recipient_email` would silently miss rows —
breaching the GDPR Art. 17 immediate-erasure invariant the parent
migration claims.

**Fix:** new migration
`20260517013100_sanitize_user_recipient_email_case_insensitive.sql`.
- CREATE OR REPLACE sanitize_user with whole body verbatim from
  20260516160100 EXCEPT the M-0796 DELETE clause changed to
    `WHERE LOWER(recipient_email) = LOWER(v_target_email)`
- Self-verifying DO block asserts the case-insensitive pattern + all
  preservation gates from 20260516160100

**Commit:** `a2adba3b`

### F3b — Functional index on LOWER(recipient_email) (self-review perf companion)

**Self-review concern:** F3's `LOWER(...)` predicate cannot use the
plain B-tree `idx_notification_dispatches_recipient_email` (built by
20260516170300). Without a functional index, every sanitize_user run
inside the advisory lock seq-scans `notification_dispatches` —
re-introducing the perf footgun 20260516170300 closed.

**Fix:** new migration
`20260517013200_notification_dispatches_recipient_email_lower_idx.sql`.
- `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_dispatches_recipient_email_lower
  ON public.notification_dispatches (LOWER(recipient_email))`
- NO-BEGIN/COMMIT migration per invariant #5
- Additive index — plain `recipient_email = ?` callers still use the
  existing plain index

**Commit:** `9ad4a397`

## Verification

- `npx tsc --noEmit` → PASS (no type errors)
- `npx eslint src/__tests__/match-decisions-visibility-trigger-rls.test.ts` → PASS
- `npx vitest run src/__tests__/match-decisions-visibility-trigger-rls.test.ts` → 5 skipped (HAS_LIVE_DB gated, expected without test-DB env)
- `npx vitest run src/__tests__/match-decisions-xor-rls.test.ts` → 8 skipped (regression check on adjacent test file, no break)
- Migration filenames conform to `YYYYMMDDHHMMSS_<snake_name>.sql` pattern
- No LLM template artifacts (`grep -cE '</?(content|invoke|function_calls|antml:|parameter)'` returns 0 on both new migrations)
- No `RAISE EXCEPTION ... || ...` concatenation in new migrations (invariant #21)
- New migrations time-ordered after the existing tip (`20260516170600`)
