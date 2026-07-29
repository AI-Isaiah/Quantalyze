# Phase 140.5 — deferred items

Out-of-scope discoveries logged during execution. Nothing here was fixed.

---

## DEF-140.5-A — `strategy-review/route.test.ts` is flaky on an UNTOUCHED tree

**Found by:** 140.5-01, while measuring the pre-change baseline at `6e63f263`.
**Status:** OPEN. Not caused by this phase; not fixed by it.

**Measured, on the untouched base commit, no edits present:**

| run | command | result |
|---|---|---|
| 1 | `npx vitest run` | **1 failed** — 720 passed \| 19 skipped (740 files); 10051 passed \| 287 skipped |
| 2 | `npx vitest run` (identical command, same tree) | **0 failed** — 721 passed \| 19 skipped (740); 10052 passed \| 287 skipped |
| 3 | `npx vitest run src/app/api/admin/strategy-review/route.test.ts` (isolated) | **39 passed** |

The failing case, run 1:

```
FAIL src/app/api/admin/strategy-review/route.test.ts >
  POST /api/admin/strategy-review — C-0060 TOCTOU re-check >
  checkStrategyGate throwing StrategyGateUnevaluableError -> 503, no publish UPDATE
AssertionError: expected 200 to be 503
```

**Why it matters to this milestone, and why it is NOT this plan's to fix.**

⭐ The documented baseline — `721 / 10052 / 287 / 0`, carried through `140.5-CONTEXT.md`
§6b, `140.5-VALIDATION.md` and every plan in the phase — **is green on run 2 of 2 and red on
run 1 of 2 on the same untouched tree.** Every plan in this phase is asked to compare a
post-change full-suite run against that figure. A single run of a flaky suite cannot tell a
regression from this flake, which is precisely the ordering-dependence class the phase's own
harness work exists to close.

The mechanism is NOT the one 140.5-01 closed. The case installs a throwing `vi.doMock` for
`@/lib/strategyGate` and then drives the route; the suite's `beforeEach` re-asserts a
non-throwing `vi.doMock` and calls `vi.resetModules()`. The 200 says the route under test
resolved a `strategyGate` module without the throwing factory — a module-registry / mock-timing
race, not a leaked global or a leaked env var. `unstubGlobals` and the env snapshot do not
touch it, and the full suite was green on both Nodes with them landed.

**What a fix needs (not attempted here):** establish whether the async `vi.doMock` factory
(`await vi.importActual` inside it) is resolved before the route's dynamic import under worker
contention, and if not, hoist the actual import out of the factory. Until then, treat a single
red run of this ONE case as unproven rather than as a regression — **and re-run before
concluding**, exactly as `DEF-140.4-A` already instructs for the four load-dependent 5s
timeouts.

---

## DEF-140.5-B — three suites go red under MACHINE LOAD, on an otherwise-green tree

**Found by:** 140.5-03, while triaging full-suite reds against the documented baseline.
**Status:** OPEN as a *measurement hazard*, not as a code defect. **Proven NOT caused by
140.5-03.** ⭐ **The final gates are FULLY GREEN on both Nodes** — see the closing note.

**Affected, in observed order:** `AllocationsTabs.scenario-state-preservation.test.tsx` (2
cases), `src/__tests__/contracts/contracts-registry.test.ts` (5 s timeout),
`src/__tests__/gdpr-export.test.ts` (5 s timeout), `FactsheetBody.basis.test.tsx` (5 s timeout).

Both cases in the file fail:

```
FAIL src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx
  > adding + toggling a strategy in Scenario, leaving to Overview, and re-entering
    preserves the draft (survives unmount/remount via localStorage)
  > a fresh draft (no persisted state, no prior edit) re-enters Scenario cleanly with
    read-only holdings (no spurious mismatch across mounts)
TestingLibraryElementError: Unable to find an element by: [data-testid="kpi-strip-mock"]
```

**How it was attributed, because "not mine" is a claim that needs a receipt.**

`AllocationsTabs.tsx` imports `ContributionWizardOverlay` **statically and unmocked**, and that
reaches `WizardClient` → `ConnectKeyStep` / `MultiKeyConnectStep` / `SubmitStep` — every
production file this plan edits. So the file IS in this plan's module graph and the question is
not answerable by inspection.

It was answered by execution instead. With this plan's work committed, the FOUR production
files were restored to their `0210c0ad` (wave-1 base) contents with
`git checkout 0210c0ad -- <files>` — safe because the work was already committed, so no
uncommitted edit could be destroyed — and the file **failed identically, 2 of 2 cases**. The
base versions were then restored with `git checkout HEAD -- <files>` and
`git status --porcelain` proven empty. ⭐ **The failure reproduces with every 140.5-03
production change reverted, so it is inherited, not caused.**

**⭐ THE ACTUAL CAUSE, established afterwards: MACHINE LOAD, and it is the thing to write down.**

Three waves of this phase ran full suites concurrently in parallel worktrees. Measured
`load average: 48.33 52.24 55.10`, and full-suite wall time inflated from the documented
~100 s to **267–453 s**. Under that load:

- the failing SET varied run to run (run 1: four files; run 2: a different five; run 3: two),
  which is the signature of contention rather than a defect;
- every failure was a 5 s `testTimeout` or a render that had not settled;
- `AllocationsTabs` passed once and failed three times *at the same commit*.

**On a QUIET machine both Nodes are 100% green** — Node 22 (v22.22.1) and Node 25 both report
`725 passed | 19 skipped (744 files) · 10116 passed | 287 skipped | 0 failed`, in 110 s and
125 s respectively. Nothing in this list is a real red.

**The obligation this leaves, and it is the point of the entry.** `140.5-VALIDATION.md` tells
every plan to compare a post-change full-suite run against `721 / 10052 / 287 / 0`. Under
parallel-wave execution that comparison **cannot distinguish a regression from contention**,
and `DEF-140.5-A` already says the baseline is not deterministically green for a different
reason. Two independent reasons now. ⇒ **A full-suite red observed while sibling waves are
running is UNPROVEN until re-run on a quiet machine**, and the cheap discriminator is wall
time: a run over ~200 s is contended and its reds should not be believed.

**Recorded for the next triager, because it looks like a real bug and is not:** the console
under the `AllocationsTabs` failure shows
`TypeError: Failed to parse URL from /api/allocator/scenario/saved` — a relative URL reaching
undici rather than jsdom's fetch. That error is present on the green runs too; it is handled,
and it is not the failure.

