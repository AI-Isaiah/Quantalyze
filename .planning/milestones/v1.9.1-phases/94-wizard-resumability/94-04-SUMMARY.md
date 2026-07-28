---
phase: 94-wizard-resumability
plan: 04
subsystem: ui
tags: [react, wizard, stepper, a11y, keyboard-nav, testing]

# Dependency graph
requires:
  - phase: 94-03
    provides: WIZ-05 cachedSnapshot short-circuit (makes a sync_preview revisit inert on return)
provides:
  - Clickable free stepper on the API/composite wizard branch — backward always navigable, forward gated by a completion predicate that mirrors the render guards
  - WizardChrome onStepSelect + stepNavigable seam (navigable cells render as real <button>s; inert <div>s by default ⇒ CSV branch byte-neutral)
  - WizardClient completion predicate (stepCompleted) + handleStepSelect (setStep + persistPointer only)
affects: [wizard-resumability, WIZ-05, composite-onboarding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stepper navigability predicate owned by the state holder (WizardClient), consumed by the presentational shell (WizardChrome) via an optional callback seam — presentational back-compat by construction (absent props ⇒ byte-identical DOM)"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardChrome.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx

key-decisions:
  - "Completion predicate mirrors the review/submit render guards exactly (connect_key⇔strategyId, sync_preview⇔syncSnapshot, metadata/review⇔metadataDraft) so free navigation can never reach a guard-failed blank (T-94-15 / research Pitfall 4)"
  - "handleStepSelect is setStep + persistPointer only — no state clearing, no session regen — so a backward-then-forward round-trip redoes no work (T-94-16)"
  - "CSV branch stays inert this phase: WizardClient passes undefined for both props on source==='csv', WizardChrome renders its original <div> cells byte-for-byte"
  - "No new visual tokens — navigable cells reuse the exact border-accent/text-text-secondary/text-text-muted ladders and the file's existing focus-visible idiom; conforms to DESIGN.md:241 (Enter activates, aria-current='step'), no DESIGN deviation"

patterns-established:
  - "Optional-callback presentational seam: a shell component gains interactivity only when the container wires the callback + predicate; absent ⇒ pre-change DOM (regression-proof back-compat)"

requirements-completed: [WIZ-04]

# Metrics
duration: 8min
completed: 2026-07-11
---

# Phase 94 Plan 04: Clickable Free Stepper (WIZ-04) Summary

**The wizard stepper is now navigable by mouse and keyboard — backward always, forward only to steps whose data prerequisites exist — so an allocator can revisit any completed step and return without redoing work, while forward-skips into a blank are structurally blocked.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-11T23:37:00Z
- **Completed:** 2026-07-11T23:43:00Z
- **Tasks:** 3 completed
- **Files modified:** 4

## Accomplishments
- WizardChrome inert `<div>` step cells become real `<button>`s when navigable, firing `onStepSelect` on click and keyboard Enter (DESIGN.md:241); active + non-navigable cells stay inert, and omitting the seam renders the exact pre-change DOM (CSV branch byte-neutral).
- WizardClient owns a completion predicate (`stepCompleted`) mirroring the review/submit render guards and a `stepNavigable` that allows all backward navigation but gates forward navigation on every lower-ordinal step being complete — blocking a forward skip into a guard-failed blank.
- `handleStepSelect` is `setStep` + `persistPointer` only, so a backward-then-forward round-trip preserves `syncSnapshot`/`metadataDraft` and issues zero network calls (test-pinned).

## Task Commits

Each task was committed atomically:

1. **Task 1: WizardChrome — navigable step cells as real buttons** - `064d711c` (feat)
2. **Task 2: WizardClient — completion predicate + step-select wiring (API branch)** - `f6848d8b` (feat)
3. **Task 3: Stepper component tests (both files)** - `c974b869` (test)

_TDD RED verified for Task 3: neutering `stepNavigable` to always-true (except active) reddens both WIZ-04 WizardClient tests (forward cells wrongly render); reverted before commit._

## Files Created/Modified
- `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx` - Added optional `onStepSelect` + `stepNavigable` props; navigable non-active cells render as `<button type="button" data-testid="wizard-step-{key}">` carrying the identical border/text token ladders + focus-visible idiom; active/non-navigable stay inert `<div>` with `aria-current` on active.
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` - Added `API_STEP_ORDER`, `stepCompleted` (mirrors render guards), `stepNavigable` (backward free / forward gated), and `handleStepSelect` (setStep + persistPointer); wired both props on the API branch, `undefined` on CSV.
- `src/app/(dashboard)/strategies/new/wizard/WizardChrome.test.tsx` - Added `[WIZ-04]` describe: navigable cell is a button firing `onStepSelect` on click AND keyboard Enter (DESIGN.md:241 pinned), active/non-navigable inert with `aria-current`, and zero rail buttons when `onStepSelect` omitted (CSV byte-neutral).
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx` - Added `[94-04]` describe + extended the SyncPreviewStep mock (onComplete trigger) and stubbed MetadataStep/ReviewStep: forward-skip blocked when prerequisites missing (RED under always-true mutation); back-then-forward round-trip issues no refetch (fetch-call delta empty).

## Deviations from Plan

None — plan executed as written. The plan's cited line numbers (render guards at :682/:707) had drifted to :699/:724 in the live file; the predicate was matched against the live guards, which is the plan's explicit intent ("match the live render guards exactly").

## Threat Model Coverage
- **T-94-15 (DoS / client blank-state):** mitigated — `stepNavigable` blocks forward jumps past incomplete steps; test-pinned RED under an always-true mutation.
- **T-94-16 (Tampering / state loss):** mitigated — `handleStepSelect` is `setStep` + `persistPointer` only (no state clear / session regen); acceptance-grepped and round-trip-tested (no refetch).
- **T-94-17 / T-94-18:** accepted per plan (labels/ordinals only; zero new packages).

## Verification
- `npx vitest run "src/app/(dashboard)/strategies/new/wizard"` → 19 files / 189 tests pass.
- `npx tsc --noEmit` → clean.
- `npm run lint` → 0 errors (1 pre-existing, unrelated warning in `EquityChart.tsx`, out of scope).
- No migration; DESIGN.md conformant (no new color/spacing/typography literals; Enter-activation + aria-current pinned).

## Known Stubs
None — the stepper is fully wired on the API branch. The CSV branch intentionally stays inert this phase (WIZ-04 scope is the composite wizard); WizardChrome's optional props make CSV byte-neutral, documented in-code at the render site.

## Self-Check: PASSED
- All 4 modified source files present.
- All 3 task commits present (064d711c, f6848d8b, c974b869).
- SUMMARY.md present.
