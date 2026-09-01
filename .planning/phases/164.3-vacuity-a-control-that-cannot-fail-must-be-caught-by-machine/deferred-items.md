# Phase 164.3 — deferred items

Out-of-scope discoveries made during execution. Logged, NOT fixed (scope
boundary: only auto-fix issues directly caused by the current task's changes).

## From plan 02 (VAC-04 / VAC-08 drift gates)

- **`actionlint` SC2001 in `.github/workflows/migration-drift-check.yml`,
  pre-existing.** The untouched "Drift check (db push dry-run)" step uses
  `sed 's/_$//'` where `${var//search/replace}` would do. VERIFIED pre-existing:
  `actionlint` on `git show HEAD:.github/workflows/migration-drift-check.yml`
  reports the identical SC2001 at the same script offset (36:3). Style only, in
  code this plan did not write. Not fixed.
