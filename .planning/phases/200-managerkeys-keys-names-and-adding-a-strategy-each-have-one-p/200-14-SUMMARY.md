---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 14
subsystem: ui-a11y
tags: [wcag-2.5.8, target-size, modal, e2e, playwright, gap-closure]
requires: ["200-13"]
provides:
  - "src/components/ui/Modal.tsx: a 44x44 header Close for every dialog that mounts Modal"
  - "src/__tests__/tap-target-minimums.test.ts: a source pin on the shared Modal Close"
  - "e2e/manager-keys.spec.ts: live assertTargetSizes measurement of the open confirm dialog (320px and 1280px) and the open Rename dialog (320px)"
affects:
  - src/components/ui/Modal.tsx
key-files:
  created: []
  modified:
    - src/components/ui/Modal.tsx
    - src/__tests__/tap-target-minimums.test.ts
    - e2e/manager-keys.spec.ts
decisions:
  - "Size decision (plan Rule 7, followed): the Close is 44x44 (h-11 w-11), not the 32px dismiss idiom, because assertTargetSizes enforces 44px (MIN_TARGET_PX) and its comment forbids lowering the bar."
  - "-my-3 -mr-3 keeps the glyph and header height; no negative left margin, so the box never overlays a wrapped title at 320px."
metrics:
  tasks: 2
  completed: 2026-11-11
  duration: "about 25 min (start time was not clocked)"
status: complete
actuals:
  tokens: 2600
  tasks: 2
  commits: 2
plan_head_before: 477c5fda67c74219f784578d2c321cf6b2a1e78c
plan_head_after: ccf2f45a39371e54a8a493ee6a9e0705c48d3dfe
requirements-completed: [ROUTE-09, ROUTE-10]
coverage:
  - id: D1
    description: "The shared Modal's header Close is 44x44 at 320px and 1280px in the confirm dialog, so every dialog that mounts Modal clears the 24px WCAG 2.5.8 minimum and the 44px e2e bar"
    requirement: ROUTE-09
    verification:
      - kind: e2e
        ref: "e2e/manager-keys.spec.ts#the confirm dialog's controls, its Close included, measure at least 44px at 320px and 1280px"
        status: pass
      - kind: unit
        ref: "src/__tests__/tap-target-minimums.test.ts#Modal header Close"
        status: pass
    human_judgment: false
  - id: D2
    description: "A second dialog (Rename) on the same primitive measures clean at 320px, showing the fix lives in the shared Modal"
    requirement: ROUTE-10
    verification:
      - kind: e2e
        ref: "e2e/manager-keys.spec.ts#the Rename dialog's controls, its Close included, measure at least 44px at 320px (the Modal fix is shared)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Close glyph and header keep their place and Close still refuses writes: the existing Modal and dialog unit tests pass unchanged"
    verification:
      - kind: unit
        ref: "8 dialog unit-test files, 302 tests passed, no edits to them"
        status: pass
    human_judgment: true
    rationale: "No test measures the glyph's pixel position or the header height against the old layout; the -my-3 -mr-3 arithmetic (44 - 2x12 = 20px net, the old glyph height) is reasoned, and the 320px wrap case is not screenshot-compared. A human glance at a dialog header on a phone width settles it."
---

# Phase 200 Plan 14: the shared Modal Close meets the minimum target size, with gates that can fail Summary

The shared `Modal`'s header Close was a bare button around a 20px svg (20x20 at 320px and 1280px) in every dialog. It is now `inline-flex h-11 w-11 shrink-0 items-center justify-center` with `-my-3 -mr-3`, and two gates that were RED on the old primitive now hold it: a source pin in the tap-target scan, and a real-box `assertTargetSizes` measurement of two open dialogs in the seeded panel spec.

## What changed

- **Task 1 (tracer), commit `fb2f9d232`.** `Modal.tsx` header Close: `-my-3 -mr-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md` plus the existing colour, transition and focus-ring classes, a comment giving the reason; svg, `aria-label="Close"`, `onClick` and header markup unchanged. `tap-target-minimums.test.ts`: a `CONTROLS` entry for the Modal Close and a dated docblock paragraph (Phase 200 gap closure, 2026-11-11). `manager-keys.spec.ts`: the confirm-dialog measurement test (320px and 1280px, opens the confirm and presses Cancel, writes nothing).
- **Task 2, commit `ccf2f45a3`.** The Rename-dialog measurement test (320px, Cancel only, writes nothing).

## RED proof (pre-fix Modal), then GREEN

Pre-fix `Modal.tsx` kept as a byte copy in the scratchpad (`Modal.tsx.pre-fix`); the fixed file as `Modal.tsx.fixed`.

**Vitest RED (Task 1), pre-fix:**

```
 × Modal header Close (shared by every dialog: 44x44 like ui/Button md, glyph held in place by -my-3 -mr-3) carries its min-tap-size class contract 4ms
AssertionError: Modal header Close (shared by every dialog: 44x44 like ui/Button md, glyph held in place by -my-3 -mr-3): expected the source to contain the class literal `inline-flex h-11 w-11 shrink-0 items-center justify-center`. ...
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 9 passed (10)
```

**Playwright RED (Task 1, confirm dialog), pre-fix** (`--grep "Close included"`, the only violation is the Close):

```
  ✘  1 [chromium] › e2e/manager-keys.spec.ts:106:7 › ... › the confirm dialog's controls, its Close included, measure at least 44px at 320px and 1280px (1.9s)
    Error: interactive targets below 44px (WCAG 2.5.8)
    - Expected  - 1
    + Received  + 3
    - Array []
    + Array [
    +   "BUTTON 20x20 \"Close\"",
    + ]
  1 failed
exit=1
```

**Playwright RED (Task 2, Rename dialog), on the restored pre-fix Modal** (`cp Modal.tsx.pre-fix` over the fixed file):

```
  ✘  1 [chromium] › e2e/manager-keys.spec.ts:136:7 › ... › the Rename dialog's controls, its Close included, measure at least 44px at 320px (the Modal fix is shared) (1.4s)
    +   "BUTTON 20x20 \"Close\"",
  1 failed
exit=1
```

Restore: `cp "$SCRATCH/Modal.tsx.fixed" src/components/ui/Modal.tsx`, then `cmp` exit **0**, and `git status --short` on the path empty.

**Vitest GREEN (post-fix):** `Test Files  2 passed (2)`, `Tests  10 passed (10)` (`tap-target-minimums.test.ts` + `Modal.test.tsx`, the Modal entry's test ran and passed; the title-tier and focus-ring pins pass unchanged).

**Playwright GREEN (post-fix, Task 1 test alone):**

```
  ✓  1 [chromium] › e2e/manager-keys.spec.ts:106:7 › ... › the confirm dialog's controls, its Close included, measure at least 44px at 320px and 1280px (1.5s)
  1 passed (2.0s)
```

## Verification evidence (local seeded lane)

Lane: `scripts/local-stack/run.sh up`, `--assert-local-handoff` exit 0, `next dev -p 3100 --hostname 127.0.0.1` (worked, no `localhost` fallback), `CI=1 npx playwright test e2e/manager-keys.spec.ts --reporter=list --retries 0 --timeout 60000`. The full spec, final run on the restored fixed Modal:

```
  ✓   1 [chromium] › e2e/manager-keys.spec.ts:73:7 › ... › Change key… opens the picker, a pick opens the confirm, and nothing is written before Change key (1.9s)
  ✓   2 [chromium] › e2e/manager-keys.spec.ts:106:7 › ... › the confirm dialog's controls, its Close included, measure at least 44px at 320px and 1280px (1.9s)
  ✓   3 [chromium] › e2e/manager-keys.spec.ts:136:7 › ... › the Rename dialog's controls, its Close included, measure at least 44px at 320px (the Modal fix is shared) (1.3s)
  ✓   4 [chromium] › e2e/manager-keys.spec.ts:158:7 › ... › pressing the dialog's Change key re-points the strategy to the picked key (2.6s)
  ✓   5 [chromium] › e2e/manager-keys.spec.ts:191:7 › ... › edit page renders the panel heading and the Profile link (1.2s)
  ✓   6 [chromium] › e2e/manager-keys.spec.ts:200:7 › ... › edit page no longer offers Add Key or Delete (1.1s)
  ✓   7 [chromium] › e2e/manager-keys.spec.ts:211:7 › ... › Add or remove keys opens the Profile API keys tab (1.3s)
  ✓   8 [chromium] › e2e/manager-keys.spec.ts:217:7 › ... › Resync button is visible for the currently linked key (892ms)
  ✓   9 [chromium] › e2e/manager-keys.spec.ts:222:7 › ... › clicking Resync shows syncing state (926ms)
  ✓  10 [chromium] › e2e/manager-keys.spec.ts:243:7 › ... › sync button returns to normal state after completion (1.7s)
  ✓  11 [chromium] › e2e/manager-keys.spec.ts:262:7 › ... › sync failure shows error message (1.1s)
  ✓  12 [chromium] › e2e/manager-keys.spec.ts:283:7 › ... › sync failure with non-JSON response shows service unavailable (1.2s)

  12 passed (17.6s)
exit=0
```

Other checks:

- The eight dialog unit-test files (`Modal.test.tsx`, `tap-target-minimums.test.ts`, `RenameStrategyDialog.test.tsx`, `ApiKeyManager.test.tsx`, `MarkOwnershipDialog.test.tsx`, `ShareableLink.test.tsx`, `AllocateDialog.test.tsx`, `dialog-envelope.invariant.test.ts`): `Test Files  8 passed (8)`, `Tests  302 passed (302)`, none edited, none skipped.
- `npx tsc --noEmit` exit 0. `npm run lint` exit 0 (0 errors, 4 warnings, none in files this plan touched). `npx eslint e2e/manager-keys.spec.ts` exit 0.
- `node scripts/verify-plan-anchors.mjs` on the plan: exit 0 before starting.
- Acceptance greps: `h-11 w-11` literal in `Modal.tsx` 1 (0 at HEAD); `src/components/ui/Modal.tsx` in the tap-target test >= 1 (0 at HEAD); `assertTargetSizes` in the spec >= 2; `Rename dialog` in the spec 1.
- Teardown: dev server killed, nothing on 3100, `run.sh down` exit 0, `run.sh --assert-teardown` exit 0 (`surviving quantalyze containers -> 0`).

## Deviations from Plan

None - plan executed exactly as written.

Housekeeping, not a deviation: `next dev` rewrote `AGENTS.md` on boot. It was never staged; after the server stopped it was restored from `git show HEAD:AGENTS.md`, and `git status --short` is clean. The lane env file was reused from the scratchpad (the keys are the local stack's fixed demo keys, and the boot's `.stack-env` matched), and nothing was written into the repo.

## Known limit, recorded for the orchestrator to book

The whole class (any sub-24px control anywhere, with or without a dialog open) would be caught by adding axe-core's `wcag22aa` tag (rule `target-size`) to `buildAxe`. That re-baselines every axe spec, so it was left outside this gap. It is not booked in `TODOS.md` or the ledger by this plan.

## Known Stubs

None.

## Threat Flags

None. T-200-29 mitigated as planned: the 44px box stays inside the card's 24px padding at top, bottom and right, has no negative left margin, and the e2e tests click Cancel and Change key in the same open dialog after measuring.

## Self-Check: PASSED

- Modified files present: `src/components/ui/Modal.tsx`, `src/__tests__/tap-target-minimums.test.ts`, `e2e/manager-keys.spec.ts`; this SUMMARY.
- Commits present on the branch: `fb2f9d232`, `ccf2f45a3` (measured `git rev-list --count 477c5fda6..HEAD` = 2 before this SUMMARY's own commit).
- STATE.md and ROADMAP.md untouched.
