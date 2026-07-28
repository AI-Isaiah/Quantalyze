---
phase: 52-per-surface-application-allocator-journey
plan: 02
subsystem: allocations-surface
tags: [container-queries, tabular-nums, fluid-type, loading-skeleton, error-boundary, truncation, unstable_retry, design-tokens]

# Dependency graph
requires:
  - phase: 49-fluid-type-token-spine
    provides: "the eight fluid --text-* tier utilities (text-micro/caption/small/body) the raw-px migration lands on"
  - phase: 50-primitive-refresh
    provides: "the StrategyTable @container idiom + the Skeleton/Button primitives the KpiStrip migration and route files assemble from"
  - phase: 52-01
    provides: "the frozen-spine git-delta guard + the container-query tabular-nums alignment contract this plan keeps green"
provides:
  - "allocations page shell raised to fluid-fill max-w-[1920px] (APPLY-01 / TYPE-03)"
  - "KpiStrip migrated to @container (inline-size) with tabular-nums preserved (TYPE-04) — appended to the 52-01 CONTAINER_MIGRATED registry's live coverage"
  - "route-level loading.tsx (KPI-anchor skeleton) + error.tsx (digest-only, unstable_retry) for /allocations (STATE-01 / STATE-02)"
  - "the three named allocations clips recovered (AlertBanner / SavedScenariosList / ScenarioComposer) and the 7 named files raw-px-zero (TYPE-02 / DS-04 prep for 52-07)"
affects: [52-07, 54-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "KpiStrip @container migration mirrors the StrategyTable idiom: bare @container host (inline-size, never size-containment), @-prefixed column variants, font-mono+tabular-nums kept on every numeric cell"
    - "route error.tsx = dashboard error.tsx shape verbatim: unstable_retry (Next 16.2.0, not reset), console.error tagged in useEffect, DIGEST-ONLY render (never the raw error text — ASVS V7)"
    - "match-layout loading.tsx with a single DOMINANT anchor (KPI strip), assembled from the shared Skeleton primitive, closed by an sr-only role=status liveness hint"
    - "clip recovery by classification: prose → wrap (break-words min-w-0); table-aligned → single-line + title= (never relocate)"
    - "raw text-[Npx] → named --text-* tier (10/11px→text-micro, 12px→text-caption, 14px→text-body); inline font hexes → text-* color tokens"

key-files:
  created:
    - "src/app/(dashboard)/allocations/loading.tsx"
    - "src/app/(dashboard)/allocations/error.tsx"
    - "src/app/(dashboard)/allocations/loading.test.tsx"
    - "src/app/(dashboard)/allocations/error.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/page.tsx"
    - "src/app/(dashboard)/allocations/components/KpiStrip.tsx"
    - "src/app/(dashboard)/allocations/components/KpiStrip.test.tsx"
    - "src/app/(dashboard)/allocations/components/AlertBanner.tsx"
    - "src/app/(dashboard)/allocations/components/SavedScenariosList.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/HoldingsTable.tsx"
    - "src/app/(dashboard)/allocations/components/StressVarSection.tsx"
    - "src/app/(dashboard)/allocations/components/MonteCarloSection.tsx"
    - "src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx"

key-decisions:
  - "Surface-wide px-zero grep (Task 3 AC #4) is unsatisfiable as written: allocations/ contains the FROZEN EquityChart island (4 px sites, guard RED if edited) + 16 orphan files outside files_modified. Auto-selected the planner's named-files scope (the <interfaces> intent + the objective's '52-07 owns the error ratchet'); orphans stay non-blocking lint warnings, logged to deferred-items.md."
  - "KpiStrip migrated with bare @container (inline-size) NOT @container-size (Pitfall 1 — size containment collapses block size to 0); @sm:/@lg: column variants replace the old sm:/lg: viewport breakpoints."
  - "error.tsx renders error.digest ONLY, never the raw error text — ASVS V7 / T-52-05 (Next strips RSC messages in prod; rendering them would defeat that on a client-thrown error)."
  - "AlertBanner clip fixed by WRAP (break-words min-w-0, prose), ScenarioComposer clip by single-line + title= (table-aligned <li>) — classification-driven per the truncation audit, never relocate a clip."

patterns-established:
  - "A container-query migration on a numeric strip MUST keep font-mono+tabular-nums on every value cell, asserted by an extended consumer test, so the fluid --text-* tier never raggeds a column (52-01 tabular-nums contract stays green)."
  - "When a surface-wide acceptance grep collides with a frozen-island lock, scope to the plan's declared files_modified + <interfaces> set and defer the orphans with an explicit hand-off note to the lint-ratchet owner (52-07)."

requirements-completed: [APPLY-01, TYPE-02, TYPE-03, TYPE-04, STATE-01, STATE-02, BP-01]

# Metrics
duration: 13min
completed: 2026-06-29
---

# Phase 52 Plan 02: Allocations Dashboard to the v1.4 Bar Summary

**The allocations anchor surface is brought to the v1.4 bar: the page shell fluid-fills to 1920, KpiStrip migrates to `@container` (inline-size, tabular-nums preserved), route-level `loading.tsx` (KPI-anchor skeleton) + digest-only `error.tsx` (`unstable_retry`) land with render tests, the three named clips recover full text, and the 7 named files go raw-px-zero — all with the frozen islands at zero diff.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-06-29T11:17:10Z
- **Completed:** 2026-06-29T11:29:58Z
- **Tasks:** 3 completed
- **Files:** 14 (4 created, 10 modified)

## Accomplishments

- **APPLY-01 / TYPE-03 / TYPE-04 (Task 1)** — `page.tsx` shell raised `max-w-[1280px]` → fluid-fill `max-w-[1920px] mx-auto` (auth gate + `getMyAllocationDashboard` kept in the page, Pitfall 5). `KpiStrip` grid migrated from `sm:`/`lg:` viewport breakpoints to a bare `@container` (inline-size) host with `@sm:`/`@lg:` column variants, so a strip dropped into the ~380px metrics rail stops thinking it is at desktop width. `font-mono … tabular-nums` kept on every numeric value cell (Pitfall 2). `KpiStrip.test.tsx` extended with `@container`-host + `@`-prefixed-variant + per-value-cell tabular-nums assertions; warmup/scenario/container-contract suites stay green.
- **STATE-01 / STATE-02 / ASVS V7 (Task 2)** — `loading.tsx` (RSC, no client directive): match-layout skeleton at `mx-auto max-w-[1920px]` with the KPI strip as the **dominant anchor** (full-width 4-cell `@container` grid above an equity-chart placeholder + holdings rows), assembled from the shared `Skeleton` primitive, closed by an `sr-only role="status" aria-live="polite"` liveness hint. `error.tsx` mirrors `(dashboard)/error.tsx` verbatim — `unstable_retry` (Next 16.2.0, not `reset`), tagged `console.error` in `useEffect`, the UI-SPEC copy, and **digest-only** rendering (`error.digest` shown, raw error text never). Both carry render tests (`loading.test.tsx`, `error.test.tsx`) inside the blocking coverage gate.
- **TYPE-02 / DS-04 prep (Task 3)** — the three named clips recovered: AlertBanner critical-alert message now wraps (`break-words min-w-0`), SavedScenariosList scenario name `truncate`→`break-words`, ScenarioComposer constituent name stays single-line + `title={strategyNames[id] ?? id}`. The 7 named files migrated raw `text-[Npx]` onto `--text-*` tiers (10/11px→`text-micro`, 12px→`text-caption`, 14px→`text-body`) and AlertBanner's inline `#1A1A2E`/`#A3A3A3`/`#DC2626` font hexes onto `text-text-primary`/`text-text-muted`/`text-negative` tokens. Those 7 files are now raw-px-zero. Frozen-spine guard stays green.

## Task Commits

1. **Task 1: page-shell fluid-fill 1920 + KpiStrip @container migration** — `44c3d00e` (feat)
2. **Task 2: route loading.tsx + error.tsx with tests** — `96915302` (feat)
3. **Task 3: fix 3 named clips + migrate named-file raw px** — `a7e70742` (feat)

## Files Created/Modified

**Created:**
- `loading.tsx` — RSC match-layout skeleton, KPI-anchor 4-cell @container grid, sr-only role=status liveness.
- `error.tsx` — digest-only client boundary, unstable_retry, dashboard-error shape.
- `loading.test.tsx` / `error.test.tsx` — render-test contracts (coverage gate).

**Modified:**
- `page.tsx` — shell 1280→1920 (1-line className).
- `KpiStrip.tsx` — @container grid migration + label text-[10px]→text-micro.
- `KpiStrip.test.tsx` — @container + tabular-nums assertions.
- `AlertBanner.tsx` — message wrap + full px/hex migration.
- `SavedScenariosList.tsx` — name span truncate→break-words.
- `ScenarioComposer.tsx` — :2779 span only: title= + text-[12px]→text-caption.
- `HoldingsTable.tsx` (7) / `StressVarSection.tsx` (4) / `MonteCarloSection.tsx` (3) / `OpenPositionsTable.tsx` (2) — text-[Npx]→text-micro.

## Verification

- `npx vitest run` over the full allocations surface + `phase-52-container-tabular-nums` + `phase-52-frozen-spine-guards` → **102 test files, 1207 tests passed**. No regression anywhere on the surface.
- KpiStrip (15) / warmup / container-contract / loading (3) / error (5) suites all green.
- Frozen-spine guard (9 tests) green — `scenario.ts`, `factsheet/compute.ts`, `EquityChart.tsx`, `TouchTooltip.tsx`, `useTapPin.ts`, `useBreakpoint.ts`, the MC worker, the FactsheetProvider all zero-diff.
- `npx tsc --noEmit` — no errors in any touched file.
- Lint — the 7 migrated files + the 4 route files produce **0 errors, 0 warnings**. (ScenarioComposer retains 17 pre-existing `no-raw-font-px` warnings on its non-:2779 out-of-scope sites — non-blocking; the ratchet to `error` is 52-07's.)

## Acceptance Criteria

**Task 1:** `max-w-[1920px]` count 1, `max-w-[1280px]` 0 in page.tsx; `@container` ≥1 and `@container-size` 0 in KpiStrip; `tabular-nums` count 5 (unchanged); all 3 vitest files exit 0; `redirect("/login")` + `getMyAllocationDashboard` present. ✓
**Task 2:** all 4 files exist + vitest 0; loading.tsx has no client directive + `role="status"`; error.tsx has `"use client"` + `unstable_retry` + 0 `error.message` renders; error.test asserts `retry).toHaveBeenCalled`. ✓
**Task 3:** AlertBanner `break-words`/`title=` ≥1 AND `text-[14px]`/`#1A1A2E` 0; SavedScenariosList name span `break-words`; ScenarioComposer `title=` ≥1 at :2779 + `text-[12px]` gone there; the 7 named files raw-px-zero; frozen-spine guard exits 0. ✓ — **except AC #4 (surface-wide grep == 0): see Deviations.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 7 / Rule 4 — Scope conflict, auto-resolved] Task-3 surface-wide px-zero grep is unsatisfiable as written**
- **Found during:** Task 3.
- **Issue:** Task 3's verify command + AC #4 demand `grep -rn "text-\[Npx\]" "src/app/(dashboard)/allocations/" == 0` (the WHOLE tree), but (a) the plan's `<interfaces>` block + `files_modified` name a NARROW 7-file scope, and (b) `allocations/` also contains the **FROZEN** `widgets/performance/EquityChart.tsx` island (4 px sites) — editing it turns the 52-frozen-spine guard RED, which is Task 3's OTHER verify. The two verify halves are mutually exclusive. A further 16 orphan files carry raw px and are owned by no 52 plan (52-03..06 own compare/discovery/strategy/factsheet, not allocations/widgets/ or the page-level tabs).
- **Fix:** Auto-selected the recommended option — scope the px migration to the 7 named files (the planner's clear intent; consistent with the objective: "the `no-raw-font-px=error` ratchet for this glob lands in 52-07"). The 7 named files are now raw-px-zero; the orphans remain non-blocking lint **warnings** (0 errors today) and are logged with a precise hand-off in `deferred-items.md` so 52-07's glob excludes the frozen island (and a follow-up owns the orphans) before flipping to `error`.
- **Files modified:** scope decision only (no extra code); `deferred-items.md` created.
- **Commit:** `a7e70742` (the scope note is in the commit body).

No auth gates. No package installs (CSS/route-file/chrome only — T-52-SC accept).

## Threat Surface

All four threat-register mitigations honored: the `redirect("/login")` auth gate is intact (T-52-04, asserted); `error.tsx` is digest-only (T-52-05, asserted no `error.message`); the ScenarioComposer `title=` exposes only the already-rendered constituent name (T-52-06); the frozen islands are zero-diff (T-52-07, guard green). No new security surface introduced.

## Known Stubs

None. All three tasks ship complete, wired behavior. The orphan raw-px sites (deferred-items.md) are pre-existing chrome outside this plan's declared scope, not stubs introduced here — they render correctly today as lint-warning-level raw px and block nothing until 52-07's ratchet.

## Self-Check: PASSED

- Files: all 4 created files + the 10 modified files + this SUMMARY exist on disk.
- Commits: `44c3d00e`, `96915302`, `a7e70742` all present in git log.
- `.planning/` is gitignored (local-only, per PR #530) — the SUMMARY is written to disk but not committed; the three `feat(...)` commits are the complete code deliverable.
