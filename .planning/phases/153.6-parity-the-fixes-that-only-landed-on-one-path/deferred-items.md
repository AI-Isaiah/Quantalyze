# Phase 153.6 — deferred / out-of-scope discoveries

Items found while executing this phase that are **not** caused by the phase's own changes.
Per the executor scope boundary: logged, not fixed.

---

## DEF-153.6-02-A — `AllocationsTabs.scenario-state-preservation.test.tsx` fails locally

**Found during:** plan 153.6-02, Task 3 (full-suite verification)

**Symptom**
```
× adding + toggling a strategy in Scenario, leaving to Overview, and re-entering preserves
  the draft (survives unmount/remount via localStorage)
  error: 'TypeError: Failed to parse URL from /api/allocator/scenario/saved'
  TestingLibraryElementError: Unable to find an element by: [data-testid="kpi-strip-mock"]
```

**Why it is out of scope — measured, not assumed**

1. The three wizard components this plan touched were changed in **comments only**
   (`git diff <base>..HEAD -- <the three .tsx files>` filtered to non-comment lines returns
   empty), so they cannot have altered runtime behaviour.
2. The only production module this plan actually changed is
   `src/lib/wizard/validate-budget.ts`. Restoring that file to its base revision
   (`git checkout <base> -- src/lib/wizard/validate-budget.ts`) and re-running the failing
   spec reproduces the **identical** failure. It is pre-existing on this branch's base.
3. Not the known Node-version split either — reproduced under both local Node 25 and
   `PATH=/opt/homebrew/opt/node@22/bin` (Node 22.22.1), the CI toolchain.

**Likely cause (unverified)** — the spec does not stub `fetch`, so
`/api/allocator/scenario/saved` is fetched as a **relative** URL under the node/jsdom
environment, which undici rejects. It presumably passes in CI only when a global fetch stub
leaks in from a sibling file in the same shard, which would make it an oracle-independence
problem in that spec rather than a product defect.

**Owner:** not this phase. Add to root `TODOS.md` at milestone close.
