# Phase 140.4 — deferred items (out-of-scope discoveries)

Per the executor scope boundary: discovered, NOT fixed, logged here.

---

## DEF-140.4-A — four test files 5 s-timeout-flake under Node 22 on a loaded machine

**Found by:** plan `140.4-02`, during the mandated CI-parity run
(`PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run`).

**Files:**
- `src/__tests__/contracts/contracts-registry.test.ts` — `[B25] … resolves every quantalyze rule to "error" for a representative src file`
- `src/__tests__/gdpr-export.test.ts` — `enforces EXPORT_SIZE_CAP_BYTES …` and `binary-search trimmer packs optimally … (I3)`
- `src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx` — `adding + toggling a strategy in Scenario …`
- `src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx` — `T_WIN_SAVE1 …`

**Failure mode:** every one is `Error: Test timed out in 5000ms`, **not** an assertion
failure. The Node 22 full run took **602 s** against the Node 25 full run's **152 s** on the
same tree — a 4x contention factor, because several worktrees were executing concurrently.

**Proven out of scope, not merely assumed.** The four files were re-run under Node 22 with
**none of plan 02's files in the run at all** and three of the four still failed
(`ScenarioComposer.save` passed that time, which is itself the load-dependence signature).
Plan 02's diff touches only the three `SyncPreviewStep*` files and none of these four imports
them. Plan 02's own fence is **22 files / 311 tests green under Node 22**.

**Also observed, same cause:** one Vitest `Unhandled Error` —
`ReferenceError: window is not defined` from a leaked 2000 ms `setTimeout` in
`src/app/(dashboard)/allocations/components/SavedScenariosList.tsx:241`
(`setTimeout(() => setCopiedShareId(null), 2000)`) firing after its jsdom environment tore
down. A real latent teardown bug in that component's copy-confirmation timer — it needs a
cleanup on unmount — but it is outside plan 02's fence and is **not** caused by it.

**Recommended owner:** the phase gate, or whichever plan next touches
`SavedScenariosList.tsx`. Raising `testTimeout` would mask the contention rather than fix the
leak, so the `SavedScenariosList` cleanup is the item with real content here.
