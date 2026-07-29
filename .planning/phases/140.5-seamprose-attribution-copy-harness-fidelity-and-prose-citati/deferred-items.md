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
