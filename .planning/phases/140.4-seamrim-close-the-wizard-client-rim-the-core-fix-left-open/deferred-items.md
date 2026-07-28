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

---

## DEF-140.4-B — Vercel plugin recommends Workflow DevKit for `create-with-key`'s retry loop

**Found by:** plan `140.4-13`, via the `PostToolUse` validation hook, which fired on every
route/test file it edited.

**The one recommendation with real content:**
`src/app/api/strategies/create-with-key/route.ts:259` and `:270` — *"Manual retry logic
detected. Use Vercel Workflow DevKit for automatic retries with durable execution."*

**NOT ACTED ON, and the reason is a scope fence, not an oversight.** `140.4-CONTEXT.md` §6
puts retry work out of scope in as many words: *"**Phase 141's retry work.** 141 owns retry;
this phase must not add one."* Adopting Workflow DevKit would also be a **package install**,
and `140.4-VALIDATION.md`'s Wave-0 contract is *"this phase installs ZERO packages"*, verified
at the gate by `git diff <phase base>..HEAD -- package.json package-lock.json` → EMPTY. Plan
13's diff touches neither file. The retry code at those lines is pre-existing and was not
modified by this plan.

**Recommended owner:** Phase 141, which owns retry, together with a package-legitimacy check
on `workflow` before any install.

**The remaining hook firings were noise and are recorded so nobody re-investigates them:** the
hook also reported *"Long-running or polling logic detected in a serverless handler"* against
`src/app/api/**/route.test.ts` files at lines plan 13 never touched — these are **test files**,
not serverless handlers, and the flagged lines are pre-existing fixtures. It also suggested the
`next-cache-components` skill on every `app/**` read; plan 13 adds no caching directive and
`next.config.ts` is explicitly out of its fence.
