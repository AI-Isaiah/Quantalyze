# PR #182 Retro Audit — Deferred Findings Rationale

This document records the rationale for each finding from the PR #182
retroactive audit that was deliberately NOT closed in this follow-up PR
(`fix/pr182-audit-followup-2026-05-17`).

Source artifacts (read-only references):
- `/Users/helios-mammut/claude-projects/quantalyze/.review/retro-audit-pr182.migration-reviewer.jsonl`
- `/Users/helios-mammut/claude-projects/quantalyze/.review/retro-audit-pr182.rls-policy-auditor.jsonl`

Closed items live in `FIX-REPORT.md`. This file holds the deferral
rationale per item, grouped by category.

---

## Category A — Bad shape shipped but already corrected by a later migration in the SAME PR (already applied)

For each of these, the bad shape was a real flaw in the migration-as-written
but is NOT a live gap in prod because a later migration in PR #182 (also
applied) supersedes it. The only failure mode would be a rollback of the
corrective migration alone — not a normal operational path. Folding the
correction into the original migration would require editing an applied
migration, which is forbidden per migration-reviewer invariant #11.

### F5 — migration-reviewer HIGH #2 (conf 7): `20260516160700` REVOKE service_role bad-shape
- **Bad shape:** `20260516160700` REVOKEd EXECUTE on
  `_assert_strategy_visible_to_allocator` FROM service_role + authenticated;
  the BEFORE INSERT trigger fires under service_role for the two
  admin-client routes -> 42501 production-break.
- **Currently in prod:** `20260516170000` STEP 2 re-GRANTs EXECUTE to
  service_role; both routes work end-to-end (verified by the existing
  `outcomes-join-rls.test.ts` + this PR's new visibility-trigger test
  Scope 4).
- **Why deferred:** No active live gap. Rollback-only risk. Editing
  `20260516160700` is forbidden.

### F6 — migration-reviewer MED #3 (conf 8): `20260516160700` trigger missing search_path
- **Bad shape:** `_match_decisions_visibility_check` lacked
  `SET search_path = public, pg_catalog`. All `public.*` references
  inside were schema-qualified so the immediate attack surface was
  closed, but convention drift from the 89-prior-migration norm.
- **Currently in prod:** `20260516170000` STEP 3 replaces the trigger
  function WITH `SET search_path`.
- **Why deferred:** No active live gap.

### F7 — migration-reviewer MED #4 (conf 8): `20260516160800` bare ::numeric casts
- **Bad shape:** `_validate_scenario_diff` has three bare `::numeric`
  casts without BEGIN/EXCEPTION wrapper. Non-numeric input raises
  SQLSTATE 22P02, not the contracted 22023.
- **Currently in prod:** `20260516170600` wraps casts in BEGIN/EXCEPTION
  with the correct SQLSTATE.
- **Why deferred:** No active live gap.

### F8 — migration-reviewer MED #5 (conf 8): `20260516160800` _validate_scenario_diff missing search_path
- **Bad shape:** `_validate_scenario_diff` lacked `SET search_path`.
- **Currently in prod:** `20260516170600` adds it.
- **Why deferred:** No active live gap.

### F12 — rls-policy-auditor HIGH #2 (conf 8): `20260516160700` orphan-org widening
- **Bad shape:** helper returned TRUE for zero-members orphan orgs —
  any allocator could commit voluntary_add/bridge_recommended against
  strategies in orphan orgs.
- **Currently in prod:** `20260516170000` STEP 1 fails-closed on orphan
  org (returns FALSE).
- **Why deferred:** No active live gap. This PR's new test Scope 3
  (`match-decisions-visibility-trigger-rls.test.ts`) regression-pins
  the fail-closed behavior.

### F13 — rls-policy-auditor HIGH #3 (conf 9): `20260516160700` REVOKE service_role production-breaker
- Same root as F5 (different lens — RLS rather than migration shape).
- **Currently in prod:** `20260516170000` STEP 2 corrects.
- **Why deferred:** No active live gap. This PR's new test Scope 4
  regression-pins the service_role INSERT happy path.

### F14 — rls-policy-auditor MED #5 (conf 8): `20260516160700` trigger search_path drift
- Same root as F6 (different lens).
- **Currently in prod:** `20260516170000` STEP 3 corrects.
- **Why deferred:** No active live gap.

---

## Category B — Separate tracked task (Task #47)

### F4 — migration-reviewer HIGH #1 (conf 8): `20260516170400` CONCURRENTLY in-tx split
- **Bad shape:** Single file mixes explicit BEGIN/COMMIT (DROP INDEX)
  with CREATE INDEX CONCURRENTLY. Fragile under `supabase db push` —
  if the CLI wraps the file in an outer transaction, the CONCURRENTLY
  raises 25001 and half-applies.
- **Why deferred:** Task #47 separately tracks the CONCURRENTLY split.
  Explicitly out-of-scope per the brief.

### F11 — migration-reviewer MED #9 (conf 8): `20260516170400` DROP+CONCURRENTLY planner-blind window
- **Bad shape:** DROP IF EXISTS + CREATE INDEX CONCURRENTLY creates a
  window where the planner has no index — `reset_stalled_portfolio_analytics`
  cron + allocator dashboard reads fall back to seq-scan.
- **Why deferred:** Folded into Task #47's split — when that task
  implements the two-phase pattern (new index under fresh name first
  via CONCURRENTLY, then drop old name in a separate later migration),
  the planner-blind window closes too.

---

## Category C — No live impact, no future hazard

### F10 — migration-reviewer MED #7 (conf 8): `20260516160200` _assert_retention_columns over-restrictive ACL
- **Issue:** Helper is INVOKER + REVOKEd from all app roles. Comment
  claims "intended to be re-callable from a future canary cron"; if
  that cron is added as service_role, it 42501s.
- **Why deferred:** No present caller. If/when a future canary cron is
  built, the migration that adds it can also GRANT EXECUTE TO
  service_role at the same time. Pre-emptively granting EXECUTE for an
  aspirational future use case violates the principle of least
  privilege.
- **Action item:** The fix here is documentation (drop the "future
  canary cron" aspiration from the comment or amend it to reflect the
  current ACL). Either way it's a docs-only change and not worth
  shipping as a standalone migration.

---

## Category D — Historical leak window (closed at deploy)

### F15 — rls-policy-auditor MED #6 (conf 8): `20260516170100` PUBLIC EXECUTE leak window
- **Bad shape:** `reset_stalled_portfolio_analytics` shipped via PR
  #184 with default PUBLIC EXECUTE — cross-tenant UPDATE reaper.
  20260516170100 REVOKEd PUBLIC + GRANTed service_role only.
- **Why deferred:** This was a one-time leak window between PR #184
  deploy and PR #182 deploy. The window closed when PR #182 applied.
  There is no live gap.
- **Forward-looking action item (not this PR):** add a CI/lint check
  or pre-merge specialist gate that REJECTS any
  `CREATE FUNCTION ... SECURITY DEFINER` without an accompanying
  `REVOKE FROM PUBLIC` in the same migration. The 170100 header
  already serves as the cautionary tale. Tracking as backlog item.

---

## Category E — Duplicate root cause already covered

### F9 — migration-reviewer MED #6 (conf 8): `20260516170000` GRANT EXECUTE to authenticated
- Same root cause as rls-policy-auditor HIGH #1 (F1) — both surface
  the SECDEF probe-oracle opened by the GRANT to authenticated. F1 is
  the higher-confidence finding (rls-policy-auditor specifically calls
  out the org-membership probe enumeration). Closed by this PR's
  commit `ec475bcd`.

---

## Summary

| Category | Count |
|----------|-------|
| Bad shape corrected by later same-PR migration | 6 (F5, F6, F7, F8, F12, F13, F14) |
| Separate task (Task #47) | 2 (F4, F11) |
| No live impact + no future hazard | 1 (F10) |
| Historical leak window already closed | 1 (F15) |
| Duplicate root cause covered by applied fix | 1 (F9) |

**Total deferred:** 9 raw items (F5–F8, F10–F15 minus F9 which is duplicate)
**Total covered by other fixes:** 1 (F9 closed via F1)
