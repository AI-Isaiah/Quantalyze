# Deferred items — out-of-scope discoveries (Phase 164.8.4, Plan 05)

Per the executor's SCOPE BOUNDARY rule: issues discovered during execution that are
NOT directly caused by the current task's own changes are logged here, not fixed.

## 1. `supabase-migrate.yml`'s two ci.yml/test-restore-copied blocks were never
   re-synced after Plan 02's redaction consolidation

**Found during:** Plan 05, Task 2's own verify loop — running the wider test suite
(not just `test-restore-workflow-wiring.test.ts`) to check for collateral breakage
from the Task 2 workflow edit.

**Measurement:** `npx vitest run src/__tests__/supabase-migrate-test-first.test.ts`
fails 2 of 33 tests:
- `cross-file: the mutex protocol is ci.yml's, byte for byte, in all THREE
  workflows > the acquire suffix is identical across ci.yml, the restore workflow
  and this one`
- `` `Which database am I on` — the only thing between this job and the wrong
  database > the step is byte-identical to test-restore-from-baseline.yml's copy,
  as its comment claims ``

Both compare `supabase-migrate.yml`'s own copies of the mutex-acquire redaction
block and the "Which database am I on" marker-check step against `ci.yml`'s and
`test-restore-from-baseline.yml`'s versions respectively. Phase 164.8.4 Plan 02
converted `ci.yml`'s and `test-restore-from-baseline.yml`'s inline `sed -E -e …`
redaction chains to reference the shared `scripts/redact-psql-stderr.sed`
(workspace-rooted), but `supabase-migrate.yml` — a THIRD file carrying
byte-identical copies of both blocks, per this repo's own AGENTS.md/CLAUDE.md
convention of syncing the mutex protocol across all three workflows — was not in
Plan 02's declared `files_modified` and was not updated to match.

**Confirmed pre-existing, not caused by this plan:** re-measured by temporarily
restoring both `.github/workflows/test-restore-from-baseline.yml` and
`src/__tests__/test-restore-workflow-wiring.test.ts` to their state at this
plan's Task 1 commit (`c823fabd`, i.e. before any of Plan 05 Task 2's edits) via
`git show HEAD:<path> > <path>`, byte-verified against a `cp` backup with `cmp`
before and after, and re-running `supabase-migrate-test-first.test.ts` — the same
2 failures reproduce identically at that commit. The files were then restored from
the `cp` backup and verified byte-identical with `cmp` again.

**Why this is out of scope for Plan 05:** this plan's `files_modified` is
`scripts/derive-restore-channels.sh`, `.github/workflows/test-restore-from-baseline.yml`
(staging step only) and `src/__tests__/test-restore-workflow-wiring.test.ts`. Neither
Plan 05 nor Task 2 touches `supabase-migrate.yml` or its redaction/marker-check
blocks — the drift is inherited from Plan 02's scope, not introduced here.

**Suggested remedy (not actioned here):** re-sync `supabase-migrate.yml`'s
mutex-acquire and "Which database am I on" step bodies to reference
`scripts/redact-psql-stderr.sed` the same way Plan 02 did for `ci.yml` and
`test-restore-from-baseline.yml`. Routes to a future phase per this repo's
deferral discipline (CLAUDE.md: "every deferral must name a phase via
`/gsd-phase --edit`") — left to the orchestrator/founder to route since Plan 05 has
no authority to open a new phase.
