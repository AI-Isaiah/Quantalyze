---
phase: 163-harden-fail-safe-closed-and-loud
plan: 08
subsystem: infra
tags: [resilient-fetch, undici, abortcontroller, react, wizard, seam, vitest]

requires:
  - phase: 141-seam-retry-loop
    provides: the bounded retry loop, `readDependencyBody`'s clone-only peek, and the capability-check idiom the body cancel copies
  - phase: 153.4-wizard-wait
    provides: the id-keyed `abortControllersRef` / `abortReasonsRef` pair, `handleStopWaiting`, and the signal-capturing fetch double the SEC-06 cases reuse
provides:
  - "`cancelAbandonedBody` — a total, capability-checked release for the ONE retry exit that abandons a real Response"
  - "`doRemove` aborts the removed panel's in-flight credential POST by identity, reason \"user\""
  - "Two rewritten comments that no longer record a closed gap as an open deferral"
  - "A measured falsifier for the `vi.fn`-suppresses-unhandled-rejection trap"
affects: [seam retry work, wizard connect-key surfaces, any future abort/cancellation plumbing]

actuals:
  tokens: 8300
  tasks: 2
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Capability ladder for a structural response surface — absent member, non-object, non-callable, sync throw and rejected promise are all shrugs"
    - "Abort reason written BEFORE the abort and ONLY when a controller exists to consume it"

key-files:
  created: []
  modified:
    - src/lib/resilient-fetch.ts
    - src/lib/resilient-fetch.retry.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx

key-decisions:
  - "The body cancel is a helper with a full capability ladder, not the plan's `res.body?.cancel().catch()` sketch — the sketch throws on a present body whose `cancel` is missing or not callable, and both shapes were measured RED"
  - "The ref maps are NOT cleaned inside `doRemove` (plan deviation): the validate's catch reads the reason a microtask later, so a synchronous delete is indistinguishable from never writing it and reds the funnel with SERVICE_UNREACHABLE"
  - "The abort reason is written only when a controller exists, so no entry is left for a `finally` that will never run"
  - "`pendingWaitFocusRef` is deliberately NOT set on removal — there is no control left to focus and a stale id would steal focus later"

patterns-established:
  - "Mutation ledgers in test docstrings name every mutation AND the direction observed, including mutations that were run and came back GREEN"
  - "A spy is not a neutral observer of promise handling: `vi.fn` attaches its own handler to a returned promise and silently suppresses `unhandledRejection`"

requirements-completed: [OPS-10, SEC-06]

coverage:
  - id: D1
    description: "The seam retry loop cancels the abandoned counting-status response body before retrying, capability-checked so bare `{ ok, status }` fixtures degrade instead of throwing"
    requirement: OPS-10
    verification:
      - kind: unit
        ref: "src/lib/resilient-fetch.retry.test.ts#[SEAM-06 / OPS-10] the abandoned counting-status body is CANCELLED"
        status: pass
      - kind: unit
        ref: "npx vitest run src/lib/resilient-fetch.retry.test.ts src/lib/resilient-fetch.test.ts src/lib/resilient-fetch.wiring.test.ts (180 passed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Removing a wizard panel mid-validate aborts that panel's in-flight credential-carrying POST, resolved by panel identity, with abort reason \"user\" so the removal never reaches the seam funnel as a failure"
    requirement: SEC-06
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx#⭐ [163 / SEC-06] removing a panel mid-validate aborts ITS credential-carrying POST"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx#⭐ [163 / SEC-06] removing a DIFFERENT panel leaves the validating one on the wire"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx#⭐ [163 / SEC-06] a REORDERED panel's removal aborts the request IT started"
        status: pass
    human_judgment: false
  - id: D3
    description: "The two comments that recorded the panel-removal gap as a deliberate deferral are rewritten to quote and refute their superseded claims"
    requirement: SEC-06
    verification: []
    human_judgment: true
    rationale: "Prose truthfulness against the code it sits beside is not machine-checkable; a reader has to confirm the rewritten paragraphs describe what the code now does and do not over-claim server-side cancellation."

duration: 35min
completed: 2026-08-26
status: complete
---

# Phase 163 Plan 08: Fail-safe request plumbing (OPS-10, SEC-06) Summary

**The seam retry loop now releases the one response body it abandons, and removing a wizard panel mid-validate aborts that panel's credential-carrying POST by identity — both proven RED under seven named mutations, one of which exposed a spy that was suppressing the very rejection it was asked to observe.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-26T12:08Z
- **Completed:** 2026-08-26T12:40Z
- **Tasks:** 2
- **Files modified:** 4 (555 insertions, 10 deletions)

## Accomplishments

- **OPS-10** — `cancelAbandonedBody` releases the abandoned response at the single retry exit that walks away from a real `Response`. `readDependencyBody` peeks through `res.clone()` and only on 503, so on every counting status the original body was left unconsumed and undici kept buffering it until the attempt signal fired.
- **SEC-06** — `doRemove` aborts the removed panel's in-flight `POST /api/strategies/composite/add-key` (which carries `api_key`, `api_secret` and `passphrase`) via the id-keyed controller map, with the abort reason set to `"user"` before the abort so the validate's catch cannot classify a user's action as an outage.
- Both superseded comments rewritten in the same commits, each quoting the sentence it retires and refuting it. The `"the abort buys nothing"` paragraph is refuted on the reasoning, not the facts — both its premises are still true; the conclusion drawn from them was not.
- Seven mutations run and recorded, in both directions per fix, so neither change can be silently neutered.

## Task Commits

1. **Task 1 (RED): OPS-10 failing cases** — `2500f16` (test)
2. **Task 1 (GREEN): capability-checked body cancel** — `8b34089` (feat)
3. **Task 2 (RED): SEC-06 failing cases** — `eadc291` (test)
4. **Task 2 (GREEN): identity-keyed abort + both comment rewrites** — `b615451` (feat)

Each `test(...)` commit's tree carries the tests without the fix, so the RED gate is a real property of that commit and not only a claim in a docstring.

## Files Created/Modified

- `src/lib/resilient-fetch.ts` — `cancelAbandonedBody` helper beside `hasContractualWait`; called once, inside the `!lastAttempt && !hasContractualWait` branch above its `continue`.
- `src/lib/resilient-fetch.retry.test.ts` — new `[SEAM-06 / OPS-10]` block: the cancel spy, two negative controls (neither fall-through exit cancels the response the caller receives), three degradation cases, and a fail-fast case pinning the cancel inside the retry branch.
- `.../wizard/steps/MultiKeyConnectStep.tsx` — `doRemove` reworked on the `handleStopWaiting` analog; the interval docblock's WR-03 paragraph and the CR-04 deferral sentence both rewritten.
- `.../wizard/steps/MultiKeyConnectStep.test.tsx` — three SEC-06 cases added inside the existing 153.4 wait harness (it already owns the signal-capturing fetch double and the `wizardErrorCalls()` funnel oracle), plus a `stepErrorLogs` helper.

## RED proof — what was run, and what came back

**OPS-10 (`resilient-fetch`)**

| Mutation | Observed |
|---|---|
| delete the `cancelAbandonedBody(res)` call | 4 RED, incl. `cancel` called 0 times, expected 1 |
| replace the capability ladder with a bare `res.body.cancel()` | 2 RED — `TypeError: Cannot read properties of undefined (reading 'cancel')` and `res.body.cancel is not a function`, each thrown **out of** `resilientFetch` (the site sits past the classification window's catch) |
| drop the `.catch(() => {})` swallow | 1 RED — `Error: stream already errored` leaked to the `unhandledRejection` listener |

**SEC-06 (`MultiKeyConnectStep`)**

| Mutation | Observed |
|---|---|
| delete `controller.abort()` | 2 RED — `signals[0].aborted` false, expected true |
| abort every controller instead of the removed panel's | 2 RED, incl. the sibling assertion |
| drop `abortReasonsRef.set(p.id, "user")` | 2 RED — a `SERVICE_UNREACHABLE` entry in `wizardErrorCalls()` (T-163-22) |
| also delete both ref-map entries inside `doRemove` (the plan's literal instruction) | 2 RED — identical `SERVICE_UNREACHABLE` pollution |

## Decisions Made

- **The capability ladder, not the sketch.** The plan and research both proposed `res.body?.cancel().catch(() => {})`. Optional chaining covers an absent `body` but not a present `body` whose `cancel` is missing, not callable, or returns a non-promise — and this call site is **outside** the classification window's `catch`, so a throw escapes `resilientFetch` entirely and replaces the real upstream verdict with a bookkeeping error. Measured: the unguarded shape reds two degradation cases with a thrown `TypeError`. The helper checks every rung and swallows both sync and async failures — a body we cannot release is not a failure of the request.
- **The cancel lives inside the retry branch, not above it.** The counting-status arm has three exits and only one abandons. A cancel hoisted above the `if` would empty the body of the D-01 fail-fast response and the last-attempt surrender — responses the caller is handed and expected to read. Two negative controls pin this.
- **Reason before abort, and only with a controller.** `abort()` settles the catch that reads the reason map; writing the reason afterwards or not at all lands a healthy removal in the seam funnel. Writing one when no request is in flight would leave an entry no `finally` collects, so the write is guarded on the controller's existence.

## Deviations from Plan

### 1. [Rule 1 — Bug] The plan's ref-map cleanup in `doRemove` was measured to cause the exact threat the plan lists

- **Found during:** Task 2
- **Plan instruction:** *"then DELETE the panel's entries from both ref maps"*, justified by *"the validate's `finally` at :1420 never runs for an unmounted panel — today nothing cleans the maps"*.
- **Issue:** Two things are wrong with that. (a) The premise is false — the `finally` belongs to the async `validatePanel` call, not to the component, so it runs on every outcome whether or not the panel is still mounted, abort included; it already deletes both entries. (b) Acting on it is actively harmful: the validate's catch reads `abortReasonsRef` a **microtask later**, so deleting the reason synchronously is indistinguishable from never writing it. The abort then falls through to the `SERVICE_UNREACHABLE` arm, emitting a `wizard_error` and a `console.error` for a healthy user action. That is **T-163-22** — the abort-reason misclassification the plan's own threat register asks this plan to mitigate.
- **Fix:** No eager deletion. Cleanup stays in `validatePanel`'s `finally`; the reason is written only when a controller exists, so nothing is orphaned.
- **Verification:** The eager-delete shape was implemented and run: 2 RED with a `SERVICE_UNREACHABLE` entry in `wizardErrorCalls()`, identical to omitting the reason entirely. Recorded as mutation 4 in the test docstring and in the `doRemove` docblock.
- **Committed in:** `b615451`

### 2. [Rule 1 — Bug] A test that could not fail, caught mid-plan

- **Found during:** Task 1
- **Issue:** The rejecting-`cancel` degradation case used `vi.fn(() => Promise.reject(...))` and asserted no `unhandledRejection`. Running the `.catch`-removal mutation against it came back **GREEN** — vitest's spy attaches its own handler to a returned promise (to power `toHaveResolved`/`toHaveRejected`), so the rejection was never unhandled and the listener saw nothing. The spy was suppressing the signal the test existed to detect.
- **Fix:** Replaced the spy with a plain closure and a manual call counter. Re-ran the same mutation: RED, with the leaked error in the listener.
- **Verification:** Both runs recorded; the reason is written into the test body and the block docstring so the next author does not reintroduce the spy.
- **Committed in:** `8b34089` (the source is unchanged by this; the correction is in the test)

### 3. [Rule 3 — Blocking] Worktree had no `node_modules`

- **Found during:** Task 1 setup
- **Issue:** GSD worktrees are provisioned without dependencies; `npx vitest` would download a different vitest rather than fail.
- **Fix:** Symlinked the repo's `node_modules` into the worktree. Gitignored, not staged.
- **Committed in:** n/a

---

**Total deviations:** 3 (2 bugs, 1 blocking). **Impact:** deviation 1 changed the implementation away from the plan's literal instruction on measured evidence and is the only behavioural divergence; deviation 2 repaired an anti-vacuity hole before it shipped. No scope creep — the four declared files are the only files touched.

## Issues Encountered

- **A stale cross-reference, non-blocking.** Both rewritten comments said the panel-removal gap was *"Logged in TODOS.md"*. Grepping `TODOS.md` at HEAD finds no such open entry (the two `WR-03` hits are a different item from `150-REVIEW.md`, and a line recording that the 153.7 fix round closed a `WR-03`). The claim was already stale before this plan. No live sentence now points at a nonexistent entry — the phrase survives only inside the quoted-and-refuted text — so nothing needs adding to `TODOS.md`. Flagged because it is the same doc-drift class this plan was asked to close.

## Verification

- `npx vitest run src/lib/resilient-fetch.retry.test.ts src/lib/resilient-fetch.test.ts src/lib/resilient-fetch.wiring.test.ts` — **180 passed**.
- `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx"` — **77 passed**.
- **Full suite** (required — file-scoped runs cannot clear the global contract specs): `npx vitest run` — **806 files passed / 19 skipped, 12,603 tests passed / 281 skipped, 0 failed**.
- `npx tsc --noEmit` — clean.
- `npm run lint` — **0 errors**, 3 warnings, all pre-existing in files this plan did not touch (`ContributionWizardOverlay.tsx`, `EquityChart.tsx`, `SyncPreviewStep.tsx`). Left alone per the scope boundary.

## Known Stubs

None. No placeholder values, no skipped tests, no unrun `<verify>` blocks.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change; both changes narrow existing surface.

The plan's three registered threats are addressed: **T-163-20** (credential POST outliving its removed panel) by the identity-keyed abort, **T-163-21** (unconsumed abandoned bodies) by the single-site cancel, **T-163-22** (abort-reason misclassification) by the reason-before-abort ordering, asserted directly by `wizardErrorCalls()` on all three SEC-06 cases.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Both requirements closed and independently falsifiable. Nothing in this plan is shared with the other Phase 163 plans, so no merge coupling.
- **Boundary restated for whoever picks up cancellation next:** neither connect route reads `request.signal` (re-verified at this edit). The client abort stops the browser listening; the server may still validate, encrypt and store the key. Server-side cancellation remains a recorded non-goal owned elsewhere, and no copy in either file claims otherwise.

## Self-Check: PASSED

- All four modified source/test files present on disk; SUMMARY present.
- All four commit hashes resolve in this worktree's log (`2500f16`, `8b34089`, `eadc291`, `b615451`).
- No file deletions in any commit (`git diff --diff-filter=D` empty across the range).
- No untracked leftovers: `git status --short` shows only the staged plan files.

---
*Phase: 163-harden-fail-safe-closed-and-loud*
*Completed: 2026-08-26*
