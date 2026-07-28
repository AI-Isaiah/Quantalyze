# Phase 42 — Deferred / Out-of-Scope Items

## Out-of-scope test failures discovered during 42-03 execution

### Frozen-spine guards (phases 29–32) red against the v1.2.1 baseline — PRE-EXISTING, NOT caused by 42-03

**Failing files (4):**
- `src/__tests__/phase-29-frozen-spine-guards.test.ts`
- `src/__tests__/phase-30-frozen-spine-guards.test.ts`
- `src/__tests__/phase-31-frozen-spine-guards.test.ts`
- `src/__tests__/phase-32-frozen-spine-guards.test.ts`

**Failing assertion (all four):**
> exit gate (frozen engine SCENARIO-05): `src/lib/scenario.ts` is zero-diff vs baseline

**Root cause (out-of-scope for plan 42-03):**
These are milestone **v1.2** (Allocator Cohesion) frozen-spine exit-gate guards. Each
computes the git delta between the guard baseline (`git merge-base origin/main HEAD`,
which currently resolves to `e5e4f3d2` — the **v1.2.1** milestone tag) and HEAD, and
asserts `src/lib/scenario.ts` has ZERO diff. The v1.2 milestone was a unification/wiring
milestone with a FROZEN projection engine.

`src/lib/scenario.ts` has a 12-line diff vs that baseline, introduced by commit
**`4bcedb12` `fix(41): CR-01/WR-01..04/IN-01`** — a **Phase 41** edit that hoisted the
`"2022-01-01"` magic string into an exported `DEFAULT_INCLUDE_FROM` constant (a
no-behavior-change refactor; the SCENARIO-05 252-day ann_basis math is untouched). This
diff is present at HEAD~3 (before any 42-03 commit) — the guards were already red when
plan 42-03 began.

**Plan 42-03 did NOT touch `src/lib/scenario.ts`** (verified: `git diff HEAD~3 HEAD --
src/lib/scenario.ts` is empty). 42-03 only added `src/lib/scenario.peer-basis.test.ts`
(a new test file) and edited factsheet/payload/test files.

**Disposition:** Out of scope per the executor SCOPE BOUNDARY rule (only auto-fix issues
directly caused by the current task). Logged, not fixed. The correct resolution is a
v1.2-milestone-lifecycle decision (these guards belong to a shipped milestone; a v1.2.2
engine edit that is a deliberate, reviewed change should re-baseline or retire the v1.2
frozen-spine guards). That decision belongs to the milestone owner / a dedicated
phase-41-or-later bookkeeping task, not plan 42-03.

### Note: local vitest worker-startup contention flake

A full `npm run test:coverage` run also surfaced 5 *non-deterministic* "Failed to start
forks worker / Timeout waiting for worker to respond" errors in UNRELATED files
(`wizard-errors-shape.test.ts`, `allocator-holdings-rls.test.ts`, etc.). These are the
known local CPU-contention flake (MEMORY: `vitest --no-file-parallelism` restores green);
they did NOT reproduce on a serial re-run of the touched-area suites (179/179 green) and
are not real failures.
