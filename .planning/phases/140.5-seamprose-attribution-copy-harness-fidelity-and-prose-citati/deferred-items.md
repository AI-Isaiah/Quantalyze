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

## DEF-140.5-B — TWO more suites are red on the untouched wave-2 base, and NEITHER is DEF-140.5-A

**Found by:** 140.5-02, measuring the pre-change baseline at `0210c0ad` (wave 1 merged).
**Status:** OPEN. Not caused by this plan; not fixed by it. Both are outside 140.5-02's
`files_modified` fence, so the SCOPE BOUNDARY rule forbids touching them here.

**Measured on the untouched base, working tree porcelain-clean, no edits present:**

| run | result |
|---|---|
| 1 (full suite, clean tree) | **2 files failed** — 721 passed \| 19 skipped (742 files); 10077 passed \| 287 skipped \| **2 failed** |

⚠️ The documented wave-2 baseline is **723 passed / 0 failed (742 files) · 10079 passed /
287 skipped / 0 failed**. The measured base is **721 / 2 failed · 10077 / 2 failed** — the
two "missing" passing files are exactly these two.

The two files, each reproduced IN ISOLATION (so neither is worker contention alone):

1. `src/__tests__/contracts/contracts-registry.test.ts`
   → `[B25] eslint-plugin-quantalyze wiring integrity > resolves every quantalyze rule to
   "error" for a representative src file` — **`Error: Test timed out in 5000ms.`**
   Isolated: `1 failed | 55 passed`.
2. `src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx`
   → `TestingLibraryElementError: Unable to find an element by:
   [data-testid="kpi-strip-mock"]` from a `findByTestId` wait, alongside
   `TypeError: Failed to parse URL from /api/allocator/scenario/saved`.
   Isolated: **`2 failed`** (both of its cases) — i.e. it fails HARDER in isolation than in
   the full run, where only one of its two cases failed.

**Both are TIMEOUT-shaped, which is the `DEF-140.4-A` class** (load-dependent 5s timeouts),
not the module-registry race of `DEF-140.5-A`. Neither is
`src/app/api/admin/strategy-review/route.test.ts`.

**Why it matters:** every plan in this phase is asked to compare a post-change full-suite run
against a figure recorded as `0 failed`. That figure does not reproduce on this machine at
this base. A plan that reads its own post-change run as "2 regressions" would be wrong, and a
plan that reads it as "0 failed, as documented" would be reporting a number it did not
measure. **Compare against the MEASURED base (2 failed, these two files), not the recorded
one, and name the files.**

**Not attempted here:** raising the 5s `testTimeout` for these two, or investigating the
`Failed to parse URL` relative-fetch warning in `AllocationsTabs`. Both are out of fence.
