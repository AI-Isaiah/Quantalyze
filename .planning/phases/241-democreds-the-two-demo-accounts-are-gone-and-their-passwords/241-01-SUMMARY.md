---
phase: 241-democreds-the-two-demo-accounts-are-gone-and-their-passwords
plan: 01
subsystem: records
tags: [security, secrets-scrub, archived-planning, SECR-02]
requires: []
provides:
  - "12 archived planning files with no demo login or password literal"
affects: [241-02]
tech-stack:
  added: []
  patterns: ["latin1 byte-exact role-placeholder scrub with a whole-tree census"]
key-files:
  created: []
  modified:
    - .planning/milestones/v1.20-phases/158-ops-ci-a-merge-means-a-deploy/158-REVIEW.md
    - .planning/milestones/v1.20-phases/164.8-testpreprod-test-becomes-a-real-pre-prod/164.8-04-RESTORE.log
    - .planning/milestones/v0.16.0.0-phases/11-onboarding-and-security-readiness/11-PATTERNS.md
    - .planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/13-01-PLAN.md
    - .planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/13-02-PLAN.md
    - .planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/13-04-PLAN.md
    - .planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/INTEGRATION.md
    - .planning/milestones/v0.15.0.0-phases/06-allocator-api-ingestion/BUGS-FROM-QA.md
    - .planning/milestones/v0.15.0.0-phases/06-allocator-api-ingestion/HANDOFF.md
    - .planning/milestones/v1.0.0-phases/15-csv-unblock/15-06-PLAN.md
    - .planning/milestones/v1.0.0-phases/15-csv-unblock/15-VERIFICATION.md
    - .planning/milestones/v1.0.0-phases/16-diagnostic-spike-observability/16-VERIFICATION.md
decisions:
  - "Placeholder date is the scrub's own UTC execution date, 2026-11-25 (the plan said to use it; the census was measured 2026-11-24)"
metrics:
  duration: "about 10 minutes"
  completed: 2026-11-25
status: complete
actuals:
  tokens: 2500
  tasks: 3
  commits: 3
plan_head_before: 64f809b4449d6fc68e3bdccca724bd3bdfb339f9
plan_head_after: 8e48c3d84f5e4e97ce8eeb12c5c1d5a652285708
---

# Phase 241 Plan 01: Records scrub Summary

All 29 demo login and password literals in the 12 archived planning files are replaced in place by role placeholders, byte-for-byte otherwise; the whole tracked tree now holds a demo literal in exactly one file, the e2e test that plan 02 edits.

## Pre-scrub commit

`64f809b4449d6fc68e3bdccca724bd3bdfb339f9` (plan 02 scans an archive of this commit for its pre-fix RED).

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer) | `9e15fae4e` | 158-REVIEW.md, 164.8-04-RESTORE.log |
| 2 | `aaf3f09b1` | 11-PATTERNS.md, 13-01, 13-02, 13-04 PLANs, INTEGRATION.md |
| 3 | `8e48c3d84` | BUGS-FROM-QA.md, HANDOFF.md, 15-06-PLAN.md, 15-VERIFICATION.md, 16-VERIFICATION.md |

## Per-file replacement counts (printed by the scrub tool)

Task 1:
- 158-REVIEW.md pair-A-password=1 pair-B-login=1 pair-B-password=1
- 164.8-04-RESTORE.log pair-B-login=1
- residual pair-A-login=0 pair-A-password=0 pair-B-login=0 pair-B-password=0

Task 2:
- 11-PATTERNS.md pair-A-login=2 pair-A-password=1
- 13-01-PLAN.md pair-A-login=3 pair-A-password=2
- 13-02-PLAN.md pair-A-login=1 pair-A-password=1
- 13-04-PLAN.md pair-A-login=1 pair-A-password=1
- INTEGRATION.md pair-A-login=1
- residual pair-A-login=0 pair-A-password=0 pair-B-login=0 pair-B-password=0

Task 3:
- BUGS-FROM-QA.md pair-B-login=1
- HANDOFF.md pair-B-login=1
- 15-06-PLAN.md pair-A-login=4 pair-A-password=3
- 15-VERIFICATION.md pair-A-login=1 pair-A-password=1
- 16-VERIFICATION.md pair-B-login=1
- residual pair-A-login=0 pair-A-password=0 pair-B-login=0 pair-B-password=0

Every count equals the plan's census cell. Archive placeholder totals: pair-A-login 13, pair-A-password 10, pair-B-login 5, pair-B-password 1.

## Whole-tree census (after the scrub, over `git ls-files`)

```
pair-A-login src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts 2
pair-A-password src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts 1
```

## Verification

- Each task's automated verify passed (placeholder counts 1111 / 213211111 / 1143111; every diff has equal added and removed lines; 2 / 5 / 5 files per commit).
- `git diff --name-only <pre-scrub sha>..HEAD` lists exactly 12 files.
- Hygiene: `[check-planning-hygiene] OK — 12176 tracked files scanned ...` (rules 1 to 7 OK).
- Gitleaks, range `origin/main..HEAD`: `no leaks found` (12 commits scanned).
- `node scripts/verify-plan-anchors.mjs --pending`: `OK: 19 plan file(s), no stale claims.`
- The plan-anchor precondition passed before Task 1.
- Scratch literal file, loader and scrub tool deleted; `git status --porcelain` clean.

## Deviations from Plan

None. The plan executed as written. Notes:
- The placeholders carry `2026-11-25` (scrub execution date, UTC), per the plan's own instruction to use the execution date.
- 158-REVIEW.md's three replacements sit on one line, so its diff is 1 added / 1 removed.
- The ROADMAP row for this plan was ticked by hand; STATE.md was not touched (owned by other parallel phases).

## Known Stubs

None.

## Ship note

These three commits form the records PR that lands BEFORE the code PR (founder ruling 2026-11-24). They touch only the 12 archived files; the SUMMARY and ROADMAP tick are planning records for the same PR.

## Self-Check: PASSED

All three commit shas resolve in HEAD's history, all 12 files exist, and `commits: 3` was measured from the persisted ledger (`git rev-list --count` from the pre-scrub sha).
