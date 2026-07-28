---
phase: 38-composer-factsheet-parity-blank-mode-fix
plan: 04
subsystem: allocations/composer-layout
tags: [tailwind, layout, width, factsheet-parity, scope-boundary, source-assertion-test]

# Dependency graph
requires:
  - phase: 38-composer-factsheet-parity-blank-mode-fix (Plan 03)
    provides: "ScenarioFactsheetChart mounted at the composer call sites (the factsheet-grade chart that needs the wider canvas)"
provides:
  - "The whole composer body renders at max-w-[1440px] — the 3 in-scope container literals (ScenarioComposer empty-state + main body, AllocationsTabs loading skeleton) relaxed from 1100 to 1440 so the Plan-03 factsheet chart has room."
  - "composer-width.test.tsx — a source-assertion test pinning BOTH directions: the 3 in-scope literals = 1440 AND the out-of-scope Overview empty-state (AllocationDashboardV2.tsx) stays 1100."
affects: [scenario-tab, composer-layout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Width is a Tailwind utility-class LITERAL (`max-w-[1440px]`), matching the existing arbitrary-value convention — no new design token, no logic."
    - "Layout-literal scope is pinned by a source-text-reading test (readFileSync + className substring assertions), not a render test — JSDOM has no layout engine and cannot distinguish 1100 from 1440 (mirrors the repo's page-server-boundary.test.ts source-scan convention)."

key-files:
  created:
    - "src/app/(dashboard)/allocations/widgets/performance/composer-width.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.tsx"

key-decisions:
  - "Used the literal max-w-[1440px] (not a named token / not max-w-screen-2xl) — matches the explicit success criterion AND the existing arbitrary-value literal convention at every one of these container sites."
  - "Changed the AllocationsTabs.tsx:127 dynamic-import LOADING SKELETON too, even though it is not the binding wrapper — so the skeleton↔loaded width is consistent and there is no flash-narrow when the composer hydrates."
  - "The out-of-scope guard is load-bearing: the test explicitly asserts AllocationDashboardV2.tsx STILL contains max-w-[1100px] (and NOT 1440), so an accidental scope-creep edit on the Overview empty state fails CI (T-38-04-01, Tampering mitigation)."

requirements-completed: [PARITY-02]

# Metrics
duration: ~8min
completed: 2026-06-25
tasks: 1
files: 3
---

# Phase 38 Plan 04: Composer width 1100 → 1440 (PARITY-02) Summary

**The whole scenario composer body now renders at `max-w-[1440px]` so the Plan-03 factsheet-grade chart has room — the 3 in-scope container literals (`ScenarioComposer` empty-state + main body, `AllocationsTabs` loading skeleton) were relaxed from `1100` to `1440`, and a source-assertion test pins both the change (3 = 1440) and the scope boundary (the out-of-scope `AllocationDashboardV2.tsx` Overview empty state STAYS `1100`).**

## What was built

### Task 1 — 3 width-literal edits + `composer-width.test.tsx` (commit `24d719c4`)

Three one-literal edits, located by stable className text (Plan 03's call-site swap had shifted the absolute lines from the plan's stated :1810/:1860 to the live :1813/:1863):

- `ScenarioComposer.tsx` empty-state container (`className="mx-auto max-w-[1100px] py-12"` → `…1440…`) — the `isEmptyState` early-return wrapper.
- `ScenarioComposer.tsx` main composer body (`className="mx-auto flex max-w-[1100px] flex-col"` → `…1440…`) — the BINDING constraint (the live `panel-scenario` tabpanel imposes no max-w of its own; this `<div>` is what caps the composer width).
- `AllocationsTabs.tsx:127` Scenario-tab dynamic-import loading skeleton (`className="mx-auto max-w-[1100px] py-6"` → `…1440…`) — not the binding wrapper, but widened so the skeleton↔loaded width is consistent (no flash-narrow on hydrate).

`AllocationDashboardV2.tsx:157` (the Overview empty state), `demo/layout.tsx`, and `security/page.tsx` were explicitly NOT touched.

New `composer-width.test.tsx` (5 cases, a static source scan — no render, no DOM): it `readFileSync`s each source file and asserts by stable className substrings —
1. the `ScenarioComposer` empty-state container is `max-w-[1440px]` (and the old `…1100… py-12` container class is absent),
2. the `ScenarioComposer` main body is `max-w-[1440px]` (and the old `…flex …1100… flex-col` is absent),
3. `ScenarioComposer.tsx` has exactly 2 × `max-w-[1440px]` and 0 × `max-w-[1100px]`,
4. the `AllocationsTabs` skeleton is `max-w-[1440px]` (exactly 1 occurrence),
5. **out-of-scope guard:** `AllocationDashboardV2.tsx` STILL contains `max-w-[1100px]` (specifically the `mx-auto mt-8 max-w-[1100px] py-12 text-center` Overview class) and does NOT contain `max-w-[1440px]` — so an accidental over-broad edit fails CI.

The test carries a docblock explaining WHY it is a source scan (JSDOM has no layout engine, so a render test reads `getBoundingClientRect()` as zeros and cannot tell 1100 from 1440; the width comes from Tailwind's compiled CSS), mirroring the repo's existing `page-server-boundary.test.ts` source-scan convention.

## Verification

- `npx vitest run ".../composer-width.test.tsx"` → **5 passed** (3 in-scope = 1440; out-of-scope stays 1100, both directions).
- `npx vitest run ".../widgets/performance/"` → **124 passed** (13 files — the new width test + the prior 119 perf-dir suites, all still green: no visual/layout regression).
- `npx vitest run ".../ScenarioComposer.test.tsx" ".../AllocationsTabs.scenario-state-preservation.test.tsx"` → **89 passed** (the swapped composer + the scenario-state-preservation flow unaffected).
- Grep counts: `ScenarioComposer.tsx` = **2** × `max-w-[1440px]`, `AllocationsTabs.tsx` = **1**, `AllocationDashboardV2.tsx` = **1** × `max-w-[1100px]` (out-of-scope literal untouched). All match the acceptance criteria.
- `npx tsc --noEmit` → **clean** (exit 0).
- `npx eslint` on the 3 touched files → **0 errors** (1 pre-existing, out-of-scope warning — see Deviations).

## Deviations from Plan

### Out-of-scope discovery (NOT fixed — logged, per SCOPE BOUNDARY)

**1. Pre-existing unused-import lint warning in AllocationsTabs.tsx**
- **Found during:** Task 1 (eslint on the touched files).
- **Issue:** `AllocationsTabs.tsx:33` imports `trackUsageEventClient`, which is never used (`@typescript-eslint/no-unused-vars` warning).
- **Why not fixed:** PRE-EXISTING and unrelated to this plan's one-line skeleton-width edit (the import is at line 33; my edit is the className at line 127). Confirmed via a stash round-trip that the warning is present on the unmodified code (count 1). It is therefore out of scope per the executor SCOPE BOUNDARY rule (only auto-fix issues DIRECTLY caused by the current task).
- **Action:** Logged to `.planning/phases/38-composer-factsheet-parity-blank-mode-fix/deferred-items.md`. Not committed (local docs).

Otherwise: the plan executed exactly as written (the only adjustment was locating the two `ScenarioComposer` literals by className text at the live :1813/:1863 rather than the plan's stale :1810/:1860, exactly as the plan instructed: "locate by the className text, not the absolute line").

## Threat surface

No new security-relevant surface. Per the plan's threat register: this is a pure Tailwind utility-class literal change — no data, input, auth, or persistence crosses any boundary. `T-38-04-01` (width-literal scope creep) is actively mitigated by the out-of-scope guard in `composer-width.test.tsx`, which pins `AllocationDashboardV2.tsx` at `1100` so an over-broad edit fails CI. `T-38-04-SC` (package installs) — none this plan.

## Known Stubs

None. No placeholder/empty-data paths; this plan only widens existing container literals and adds a source-assertion test over real source files.

## Self-Check: PASSED

- FOUND: `src/app/(dashboard)/allocations/widgets/performance/composer-width.test.tsx`
- FOUND (modified, 2 × max-w-[1440px]): `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
- FOUND (modified, 1 × max-w-[1440px]): `src/app/(dashboard)/allocations/AllocationsTabs.tsx`
- FOUND commit: `24d719c4`

---
*Phase: 38-composer-factsheet-parity-blank-mode-fix*
*Completed: 2026-06-25*
