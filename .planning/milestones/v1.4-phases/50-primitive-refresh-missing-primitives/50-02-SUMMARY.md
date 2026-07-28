---
phase: 50-primitive-refresh-missing-primitives
plan: 02
subsystem: ui
tags: [tailwind, fluid-type, design-tokens, primitives, focus-visible, wcag, react]

# Dependency graph
requires:
  - phase: 49-fluid-type-token-spine
    provides: "live --text-* fluid clamp tiers (text-h3/body/small/caption/micro) in globals.css @theme"
  - phase: 50-primitive-refresh-missing-primitives (Plan 50-01)
    provides: "Wave-0 RED lock tests (Button.test.tsx / Modal.test.tsx) + @radix-ui/react-tabs install"
provides:
  - "8 core primitives re-pointed onto the Phase-49 fluid --text-* tier utilities (CSS-only, zero call-site edits)"
  - "Button + Modal-close keyboard-only focus-visible ring (no mouse-click ring)"
  - "Wave-0 Button/Modal lock tests flipped GREEN (the phase type-tier + focus-visible gate)"
affects: [50-03-missing-primitives, 51-nav, 52-surface-migration, 53-surface-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Primitive type refresh = internal Tailwind class swap onto --text-* tier utilities; public prop API byte-identical so consumers inherit for free (UI-01)"
    - "focus-visible: ring on click-to-focus controls (Button/Modal-close) ONLY; field controls keep focus: soft glow (legitimately show on click) — Pitfall 4"

key-files:
  created: []
  modified:
    - src/components/ui/Button.tsx
    - src/components/ui/Modal.tsx
    - src/components/ui/Input.tsx
    - src/components/ui/Textarea.tsx
    - src/components/ui/Select.tsx
    - src/components/ui/Badge.tsx

key-decisions:
  - "Card.tsx left byte-identical (rounded-xl 12px radius deferred to Phase 52/53 per UI-SPEC — changing it is a visible restyle outside the additive/CSS-only contract)"
  - "Skeleton.tsx left byte-identical — bg-border/60 already maps to --color-border and the .animate-pulse reduced-motion freeze is inherited from globals.css:152 (duplicating it is a divergence risk)"
  - "Badge micro variant (text-micro uppercase) NOT added to Badge.tsx — the primitive's public API is frozen (label/type only); the uppercase micro form is a consumer-level concern, only the base text-xs->text-caption swap applies here"

patterns-established:
  - "Token discipline: bare text-sm/text-xs/text-lg/text-base replaced by text-body/text-caption/text-small/text-h3 tier utilities; never bare type sizes in refreshed primitives"

requirements-completed: [UI-01, UI-04]

# Metrics
duration: 4min
completed: 2026-06-29
---

# Phase 50 Plan 02: Core Primitive Token Refresh Summary

**8 core primitives re-pointed onto the Phase-49 fluid `--text-*` tier utilities via CSS-only Tailwind class swaps — public prop APIs byte-identical, plus Button + Modal-close migrated to keyboard-only `focus-visible:` rings — flipping the Wave-0 Button/Modal lock tests GREEN.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-29T01:53:21Z
- **Completed:** 2026-06-29T01:56:54Z
- **Tasks:** 3
- **Files modified:** 6 (2 left intentionally byte-identical: Card, Skeleton)

## Accomplishments
- Button (sm `text-xs`→`text-caption`, md/lg `text-sm`/`text-base`→`text-body`) and Modal title (`text-lg`→`text-h3`) re-pointed onto fluid tiers; the 68 Button importers + all Modal consumers inherit the refresh with zero call-site edits.
- Button base ring + Modal close button migrated `focus:`→`focus-visible:` (ring shows on keyboard/programmatic focus, not mouse click); Modal close button gained a focus ring it previously lacked. Modal stays a native `<dialog>` (no Radix).
- Input/Textarea/Select controls re-pointed (label `text-small font-medium`, control `text-body`, error `text-caption`) while **keeping** their `focus:ring-accent/20` soft glow (fields legitimately show focus on click). Select stays a native `<select>` (no Radix).
- Badge base `text-xs`→`text-caption` with color/status maps frozen verbatim.
- Wave-0 Button/Modal lock tests now GREEN (6/6); the full `src/components/ui/` suite passes all 45 assertions.

## Task Commits

Each task was committed atomically (code only — `.planning/` is gitignored, never staged):

1. **Task 1: Refresh Button + Modal (focus-visible pair)** — `360f273d` (feat)
2. **Task 2: Refresh Input + Textarea + Select (keep soft focus ring)** — `0bb4daa3` (feat)
3. **Task 3: Refresh Badge; confirm Card + Skeleton unchanged** — `9480c21a` (feat)

_Note: Task 1/2 are `tdd="true"` plan tasks, but the RED test contracts already landed in Wave 0 (Plan 50-01, commit `867c706f`). This plan is the GREEN phase — each task's class swaps flip the pre-existing RED locks GREEN. No new test commits were needed (the contracts pre-exist)._

## Files Created/Modified
- `src/components/ui/Button.tsx` — sizeStyles type tiers + base ring `focus:`→`focus-visible:` (8 lines)
- `src/components/ui/Modal.tsx` — title `text-h3`, close button focus-visible ring added; native `<dialog>` preserved (4 lines)
- `src/components/ui/Input.tsx` — label/control/error tiers; soft focus glow preserved (6 lines)
- `src/components/ui/Textarea.tsx` — same control map as Input (6 lines)
- `src/components/ui/Select.tsx` — same control map; native `<select>` preserved (6 lines)
- `src/components/ui/Badge.tsx` — base `text-xs`→`text-caption`; color maps frozen (2 lines)
- `src/components/ui/Card.tsx` — **UNMODIFIED** (rounded-xl deferred to 52/53; verified byte-identical)
- `src/components/ui/Skeleton.tsx` — **UNMODIFIED** (bg-border/60 + aria-hidden + inherited reduced-motion freeze verified; no edit)

## Decisions Made
- **Card untouched:** `rounded-xl` (12px) vs DESIGN.md's 8px is a visible restyle deferred to Phase 52/53. Touching it here would break the additive/CSS-only-no-visual-delta contract. Verified byte-identical with `git diff --quiet`.
- **Skeleton untouched:** `bg-border/60` already resolves to `--color-border` (#E2E8F0, confirmed in globals.css:62), and the `.animate-pulse` reduced-motion freeze is inherited from globals.css:152. Adding a `prefers-reduced-motion` block here would be a divergence risk. Confirm-only, no edit.
- **Badge micro variant not added:** the plan/UI-SPEC freeze Badge's public API (`label`/`type` only). The `text-micro uppercase tracking-wider` form is rendered by consumers, not the primitive — so only the base `text-xs`→`text-caption` swap is in scope.
- **Field controls keep `focus:` (not `focus-visible:`):** per RESEARCH Pitfall 4, fields legitimately show their focus glow on mouse click. Only Button + Modal-close migrate to `focus-visible:`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The 3 "failed" test files in the `src/components/ui/` suite run (`Field.test.tsx`, `Table.test.tsx`, `Tabs.test.tsx`) fail with `Cannot find module './Field' / './Table' / './Tabs'` — these are the Wave-0 RED contracts for primitives **Plan 50-03 builds** (not yet present). They are pre-existing (landed in `867c706f` by Plan 50-01), out of scope for this CSS-refresh plan, and explicitly excluded by the plan's success criteria. All 45 executable assertions pass, including the Button/Modal lock gate. `tsc --noEmit` is clean apart from those same 3 expected module-not-found errors — zero new type errors from this refresh.

## Threat Surface
T-50-02 (Tampering/XSS) mitigation upheld: the refresh touched only className strings — no `dangerouslySetInnerHTML` introduced, React escaping on every text node preserved. T-50-03 (focus indicator spoofing) accepted-with-verify: `focus-visible:` preserves the AA keyboard focus ring (WCAG 2.4.7/1.4.11) — the intentional removal of the mouse-click ring is by design. No new security surface introduced (presentation-only class swaps).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The 8 core primitives now consume the fluid tier spine; the refresh is invisible to consumers (no prop changes). Ready for Plan 50-03 (Tabs/Table/Field NEW primitives — their RED contracts are already in the tree awaiting implementation).
- UI-04 preserved: Modal stays native `<dialog>`, Select stays native `<select>`; no Radix pulled into either.
- v1.3 WCAG-AA floor upheld (Button/Modal keyboard focus rings intact; field focus glow intact).

## Self-Check: PASSED

- SUMMARY.md created and present.
- All 8 primitive sources present (6 modified, Card + Skeleton verified byte-identical).
- All 3 task commits present in git log: `360f273d`, `0bb4daa3`, `9480c21a`.

---
*Phase: 50-primitive-refresh-missing-primitives*
*Completed: 2026-06-29*
