# Deferred Items — Phase 164.1.1.1 Plan 01

Out-of-scope failures observed during `npm test` (Task 3's collateral check), logged rather than
fixed per CLAUDE.md's scope boundary ("only auto-fix issues DIRECTLY caused by the current task's
changes"). None of these files are in this plan's `files_modified` set
(`supabase/tests/test_prod_prober_cadence.sql`, `.github/workflows/ci.yml`,
`src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts`), and both PLAN.md files below were
last touched in commits `db652b13` / `b35bc02f`, which predate this plan's execution session.

## 1. `check-planning-hygiene.test.ts` — ABSOLUTE-HOME-PATH / LOCAL-USERNAME in this phase's own PLAN.md files

`.planning/phases/164.1.1.1-laneonlygates-sql-tests-must-not-run-gates-that-require-a-pg/164.1.1.1-01-PLAN.md`
(lines 172, 269, 339) and
`.planning/phases/164.1.1.1-laneonlygates-sql-tests-must-not-run-gates-that-require-a-pg/164.1.1.1-02-PLAN.md`
(lines 109, 170, 248) contain a local absolute home path and username, flagged by
`src/__tests__/check-planning-hygiene.test.ts`'s "has zero violations at HEAD" scan. These lines
were authored by the planner during `/gsd-plan-phase` (verify-command examples citing an absolute
home-directory path into this checkout), not by this executor. Pre-existing at the plan's starting
commit; this repo is public and `.planning/` is tracked
(`project_repo_is_public_planning_is_tracked.md`), so this is a real finding, just not one this
plan's scope covers.

## 2. `verify-plan-anchors.test.ts` — two failures against "the real tree"

- `--pending prints its scan counts and exits 0 on the real tree` — `res.status` is 1, not 0.
- `R2-W05: the REAL marker in the tree satisfies the tightened rule` — same, plus references
  `164.3-07-PLAN.md`, a different phase entirely, unrelated to this plan's file set.

Both scan the full `.planning/` tree rather than this plan's files specifically, and neither
failure names a file this plan touched. Pre-existing at the plan's starting commit.
