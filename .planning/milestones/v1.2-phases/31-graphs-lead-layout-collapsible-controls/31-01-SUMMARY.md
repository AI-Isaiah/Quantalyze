---
phase: 31-graphs-lead-layout-collapsible-controls
plan: 01
subsystem: ui
tags: [react, collapsible, details, localStorage, cross-tab, factsheet, refactor]

# Dependency graph
requires:
  - phase: 30
    provides: factsheet-grade graph panels (equity, drawdown, correlation, returns distribution, rolling) that Plan 02 will let lead the composer surface
provides:
  - "Shared, factsheet-agnostic CollapsibleSection disclosure primitive at src/components/ui/CollapsibleSection.tsx"
  - "Neutral open-all event constant COLLAPSIBLE_OPEN_ALL_EVENT (\"collapsible-section:open-all\")"
  - "Optional onToggle?(open: boolean) analytics callback (decoupled from the factsheet's trackFactsheetEvent)"
affects: [31-02 ScenarioComposer collapsible controls, LAYOUT-01, LAYOUT-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lift-and-repoint a shared UI primitive: move verbatim into src/components/ui/, generalize coupling (neutral event constant + injected callback), repoint the sole consumer's import"
    - "Analytics decoupling via an optional onToggle callback instead of a hard tracker import — keeps the primitive surface-agnostic"

key-files:
  created:
    - src/components/ui/CollapsibleSection.tsx
    - src/components/ui/CollapsibleSection.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
  deleted:
    - src/app/factsheet/[id]/v2/CollapsibleSection.tsx
    - src/app/factsheet/[id]/v2/CollapsibleSection.test.tsx

key-decisions:
  - "Kept sentryArea: \"factsheet.section\" string unchanged on the lifted primitive — changing it would alter Sentry attribution and is out of scope"
  - "Kept the default storageKey fallback \"factsheet-collapse:__unused__\" unchanged — the factsheet still passes real keys; Plan 02's composer will pass its own scoped key"
  - "onToggle fires the exact same factsheet_v2_section_toggle event with { section: <id>, open } at each call site, using each section's own id literal to preserve the byte-identical payload"

patterns-established:
  - "Pattern: shared disclosure primitive in src/components/ui, generalized via neutral event + optional onToggle callback"

requirements-completed: [LAYOUT-01]

# Metrics
duration: 4 min
completed: 2026-06-23
---

# Phase 31 Plan 01: Lift + Generalize CollapsibleSection Summary

**Lifted the factsheet `CollapsibleSection` disclosure primitive into `src/components/ui/`, generalized its factsheet coupling (neutral `COLLAPSIBLE_OPEN_ALL_EVENT` + injected `onToggle` analytics callback), and repointed `FactsheetView` with zero behavior change and byte-identical storageKey strings.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-23T16:53:00Z (approx — Task 1 commit 18:54 local)
- **Completed:** 2026-06-23T16:56:51Z
- **Tasks:** 2
- **Files modified:** 3 created/modified + 2 deleted (the move)

## Accomplishments
- Moved the `<details>`-based disclosure primitive verbatim to `src/components/ui/CollapsibleSection.tsx`, preserving every persistence wire (`useCrossTabStorage` + `rawStringCodec`, deferred SSR-safe hydration, no-clobber-on-hydration, debounced persist) and the full `<summary>` markup/class strings (uppercase tracking-wider title, `Hide`/`Show` mono affordance, caret rotation, `min-h-[44px]`, `focus-visible:outline-accent`).
- Generalized two factsheet couplings: renamed `FACTSHEET_OPEN_ALL_EVENT` → `COLLAPSIBLE_OPEN_ALL_EVENT = "collapsible-section:open-all"`, and replaced the hard `import { trackFactsheetEvent }` with an optional `onToggle?(open: boolean): void` prop invoked only on a user-initiated toggle (hydrated && changed).
- Migrated the test to the new path with a neutral event name, dropped the `vi.mock("./factsheet-analytics", ...)`, and added a focused `onToggle` spec proving it fires with the new open boolean on a user toggle and does NOT fire on mount-time default-vs-stored reconciliation. 11/11 pass.
- Repointed `FactsheetView`: import path, ControlBar `resetView` dispatch, and `onToggle` on all 6 sections firing the identical `factsheet_v2_section_toggle` event payload. storageKey strings unchanged (count stayed 6) so existing stored open/closed states survive and the `SignOutButton.test.tsx` purge-key inventory stays accurate (untouched).

## Task Commits

1. **Task 1: Lift + generalize CollapsibleSection into src/components/ui/** - `7d3fb80e` (refactor)
2. **Task 2: Repoint FactsheetView to the lifted primitive** - `94f36e4e` (refactor)

_Git recorded Task 1 as a rename (76% / 70% similarity), confirming a clean move rather than a copy._

## Files Created/Modified
- `src/components/ui/CollapsibleSection.tsx` - Lifted, factsheet-agnostic disclosure primitive; neutral open-all event constant; optional `onToggle` analytics callback.
- `src/components/ui/CollapsibleSection.test.tsx` - Migrated persistence / open-all / no-storageKey tests + new onToggle callback spec, against the new path.
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` - Repointed import to `@/components/ui/CollapsibleSection`, renamed event dispatch, wired `onToggle` on all 6 sections.
- `src/app/factsheet/[id]/v2/CollapsibleSection.tsx` (deleted) / `CollapsibleSection.test.tsx` (deleted) - moved to `src/components/ui/`.

## Decisions Made
- Left `sentryArea: "factsheet.section"` unchanged on the lifted primitive (changing it alters Sentry attribution; out of scope).
- Left the default `storageKey ?? "factsheet-collapse:__unused__"` fallback unchanged (factsheet passes real keys; Plan 02's composer passes its own scoped key).
- Each `onToggle` uses its section's own `id` literal as the analytics `section` field so the `factsheet_v2_section_toggle` payload is byte-identical to the pre-lift hard-coded behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- A plan-level verification grep (`from "./CollapsibleSection"` returns nothing) appeared to "fail" because the **lifted test** at `src/components/ui/CollapsibleSection.test.tsx` legitimately imports its **own co-located sibling** via `./CollapsibleSection`. This is correct — the clause's intent is "no importer still points at the deleted factsheet path," and `FactsheetView` (the factsheet consumer) has 0 stale relative imports. Verified the deleted factsheet primitive is gone and no importer references the old `@/app/factsheet/.../CollapsibleSection` path.

## Authentication Gates
None.

## Verification Results
- `npx vitest run src/components/ui/CollapsibleSection.test.tsx` → 11 passed.
- `npx vitest run "src/app/factsheet"` → 5 files / 40 tests passed (factsheet behavior unchanged).
- `npx tsc --noEmit` → exit 0 (no dangling relative import).
- `grep -rn "FACTSHEET_OPEN_ALL_EVENT" src` → nothing (fully renamed).
- No importer points at the deleted factsheet path; storageKey count in FactsheetView unchanged (6); zero diff to `src/lib/scenario.ts` / `src/lib/scenario.test.ts`; `SignOutButton.test.tsx` untouched.

## Known Stubs
None.

## Threat Flags
None — client-only disclosure UI lift; no new inputs, routes, data flows, auth, or storage-key namespace.

## Next Phase Readiness
- The shared primitive is ready for Plan 02 (`31-02`) to wrap `ScenarioComposer`'s `CompositionList` with a composer-scoped `storageKey` (e.g. `composer-collapse:controls`), passing its own `onToggle` for composer analytics.
- LAYOUT-01's reusable hide-don't-unmount disclosure primitive requirement is satisfied by this lift.

## Self-Check: PASSED

- Created files exist on disk: `src/components/ui/CollapsibleSection.tsx`, `src/components/ui/CollapsibleSection.test.tsx`, `31-01-SUMMARY.md`.
- Task commits present in git: `7d3fb80e` (lift), `94f36e4e` (repoint).

---
*Phase: 31-graphs-lead-layout-collapsible-controls*
*Completed: 2026-06-23*
