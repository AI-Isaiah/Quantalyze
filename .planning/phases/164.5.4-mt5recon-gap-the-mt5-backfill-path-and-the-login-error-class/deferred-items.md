# Deferred items — phase 164.5.4

Out-of-scope discoveries logged during execution. ⛔ Per the executor scope boundary these were
NOT fixed: none is directly caused by the changes of the plan that found it.

---

## [164.5.4-SUITE-TIMEOUT-CONTENTION] the full `npm run test` suite is not green in a parallel worktree

**Found during:** plan 03, task 2 verification (`npm run test`).
**Status:** open, NOT fixed, NOT caused by plan 03.

**MEASURED, twice, in worktree `agent-a412b7aa8f26e6606`:**

| run | test files failed | tests failed | duration |
|---|---|---|---|
| 1 | 8 | 45 | 951 s |
| 2 | 12 | 58 | ~1000 s |

The verdict is **non-deterministic between two runs of the same tree**, which is itself the tell.

**Failure-mode census of run 2 (58 failures):**

| reason | count |
|---|---|
| `Test timed out in 5000ms` | 53 |
| `Test timed out in 30000ms` | 2 |
| `Test timed out in 20000ms` | 1 |
| `AssertionError` (plan-anchor, see below) | 2 |

**56 of 58 are timeouts.** The heaviest offender, `src/__tests__/drift-check-scripts.test.ts`,
still reports 13–14 timeouts when run ENTIRELY ALONE (301 s wall, 581 tests) — these are
subprocess-spawning harness tests measured against a 5 s default while the box is shared with the
other executors of this wave. `scenario-montecarlo.test.ts` failed in the suite and **passes in
isolation**, which is the same story in one file.

**⭐ ATTRIBUTION, measured rather than asserted.** Every one of the 12 failing files was grepped
for `KeyPermissionBadge`, `probe-vocabulary` and `probe_vocabulary`: **0 hits in all 12**. None
imports, scans or reads either file plan 03 changed, and a timeout cannot be produced by a
250-line client-component edit in a file the test never loads. Plan 03's own two files are GREEN
inside the failing suite run and green standing alone (67/67).

⚠️ The plan's own `<verify>` says *"Run this alone — the full suite must not share the box with
another heavy run."* A wave executor **cannot honour that**: it is dispatched concurrently with its
wave siblings by construction. That is a property of parallel dispatch, not of this phase.

---

## [164.5.4-ANCHOR-PENDING-SUMMARY] plan 06 @-references SUMMARYs that do not exist yet

**Found during:** plan 03, task 2 verification.
**Status:** open, NOT fixed, NOT caused by plan 03, and **expected to self-resolve**.

`node scripts/verify-plan-anchors.mjs --pending` exits 1 with exactly two misses, both
`[context-ref-missing]` in `164.5.4-06-PLAN.md`:

- `:64` → `@…/164.5.4-04-SUMMARY.md`
- `:65` → `@…/164.5.4-05-SUMMARY.md`

Plan 06 is a later wave and correctly declares that it reads the summaries of plans 04 and 05.
Those plans have not executed, so the files do not exist yet. The two `AssertionError`s in
`src/__tests__/verify-plan-anchors.test.ts` are this same fact reaching the suite.

⚠️ This clears itself the moment plans 04 and 05 write their SUMMARYs. ⛔ Do NOT "fix" it by
stripping the @-references from plan 06 — they are the correct declaration and removing them would
send that executor in blind.

---

## [164.5.4-SHARED-SCRATCHPAD-COLLISION] parallel executors share one scratchpad directory

**Found during:** plan 03, task 2 commit.
**Status:** worked around in plan 03, NOT fixed. ⚠️ **Real correctness hazard, worth a phase.**

Plan 03 wrote its commit message to `<scratchpad>/msg2.txt` and committed with `git commit -F`.
The commit landed carrying **plan 02's commit message verbatim**
(`test(164.5.4-02): move both EXPECTED_TABLE_SIZE pins…`): the parallel plan-02 executor had
written its own `msg2.txt` to the SAME path between the write and the commit.

The worktrees are isolated; **the scratchpad is not**. Caught only because the message was read
back after committing; amended to the correct text (`01ae6f74`) and the content was never wrong —
but a commit attributed to the wrong plan is exactly the kind of ledger corruption that is
invisible later.

⭐ **Interim rule, applied for the rest of plan 03:** never use a generic scratchpad filename from
a wave executor. Use a plan-scoped, PID-suffixed name (`gsd-<phase>-<plan>-<task>-$$.txt`), and
read the subject line back before and after committing.

---

## [164.5.4-WINDOWS-ROW61-DESYNC] the broken-windows ledger refuses every append

**Found during:** plan 03, SUMMARY step.
**Status:** open, NOT fixed, NOT caused by plan 03. ⛔ **Deliberately not repaired here.**

`gsd-tools windows append` refuses with:

> Ledger table in `.planning/WINDOWS.md` disagrees with the fenced JSON entries (the sole source
> of truth) for row id(s): **61**. … never hand-edit the rendered table.

So plan 03's `unrun-verify` entry for `[164.5.4-SUITE-TIMEOUT-CONTENTION]` above **could not be
recorded in the ledger**, and neither can anyone else's until row 61 is reconciled.

⚠️ Row **61** is the entry `CLAUDE.md` itself names — the gitleaks full-history / skip-trailer
pair. Its rendered table row and its fenced JSON have drifted apart.

**Why plan 03 did not repair it:** `git status .planning/WINDOWS.md` is clean in this worktree, so
the desync is pre-existing; the tool's own message forbids hand-editing the table; and the file is
a SHARED cross-phase ledger being read by wave siblings executing concurrently in other worktrees,
so reconciling it from here invites a conflict on a ledger whose whole value is that it is
trustworthy. It needs one owner on a quiet tree, not a drive-by fix from a parallel executor.
