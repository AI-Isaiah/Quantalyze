---
phase: 52-per-surface-application-allocator-journey
plan: 07
subsystem: ui
tags: [eslint, strangler-ratchet, no-raw-font-px, fluid-type, dashboard-chrome, max-width, allocator-journey, frozen-spine]

# Dependency graph
requires:
  - phase: 52-per-surface-application-allocator-journey
    plan: 02
    provides: "allocations surface migrated to --text-* tiers (clean per-file set) + page-level max-w-[1920px] that this plan uncaps"
  - phase: 52-per-surface-application-allocator-journey
    plan: 03
    provides: "compare/** + CompareTable.tsx raw-px-clean + the max-w-7xl-caps-1920 chrome observation logged in deferred-items.md"
  - phase: 52-per-surface-application-allocator-journey
    plan: 04
    provides: "discovery/** + StrategyGrid.tsx raw-px-clean + page-level max-w-[1920px]"
  - phase: 52-per-surface-application-allocator-journey
    plan: 05
    provides: "strategy/[id]/** raw-px-clean"
  - phase: 52-per-surface-application-allocator-journey
    plan: 06
    provides: "factsheet v2 chrome raw-px-clean on the non-frozen/non-chart panel files"
  - phase: 52-per-surface-application-allocator-journey
    plan: 01
    provides: "the frozen-spine git-delta guard (kept green) + the FROZEN_ISLANDS list (EquityChart never-migrate)"
provides:
  - "no-raw-font-px=error on every GREP-PROVEN-CLEAN phase-52 allocator-journey surface/file (compare/discovery/strategy globs + CompareTable/StrategyGrid + 15 clean allocations files + 13 clean factsheet files)"
  - "DashboardChrome wide-variant: allocator routes (/allocations,/compare,/discovery/*) fluid-fill to max-w-[1920px] while all other dashboard routes keep max-w-7xl — uncapping the page-level 1920 caps 52-02/03/04 set"
  - "orphan raw-px debt list (18 allocations + 7 factsheet files, incl. frozen EquityChart + chart-internal SVG) recorded in deferred-items.md for Phase 53/54"
affects: [53, 54-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scope-corrected strangler ratchet: per-FILE error globs for partially-clean trees (allocations/factsheet) instead of a whole-glob flip, so orphan raw-px files stay at repo-wide warn and CI stays green"
    - "DashboardChrome wide-variant via an isWide regex allow-list mirroring the existing isFullBleed pattern — conditional max-w in the standard shell's content container; non-allocator routes untouched"

key-files:
  created:
    - ".planning/phases/52-per-surface-application-allocator-journey/52-07-SUMMARY.md"
  modified:
    - "eslint.config.mjs"
    - "src/components/layout/DashboardChrome.tsx"
    - "src/components/layout/DashboardChrome.test.tsx"

key-decisions:
  - "SCOPE CORRECTION (user decision 'per-file ratchet + log debt'): did NOT flip allocations/** or factsheet/[id]/v2/** whole globs to error — both trees carry orphan raw-px (incl. the frozen EquityChart + chart-internal SVG), so a whole-glob flip would red CI. Flipped only grep-proven-clean globs + per-file globs."
  - "DashboardChrome wide-variant scoped to the allocator-journey routes ONLY (regex ^/(allocations|compare|discovery)(/|$)); Phase-53 surfaces (portfolios/security/admin/wizard) keep max-w-7xl — do not widen them."
  - "Chart-internal factsheet files (TimeSeriesChart/HistogramChart/MasterBrush) and the frozen EquityChart are EXCLUDED from the error set: chart SVG coordinate math stays exempt (like src/components/charts/** off glob); EquityChart is permanently never-migrate."

patterns-established:
  - "Pattern 1: per-FILE error globs are the correct ratchet granularity when a planner under-scoped a surface migration — grep each candidate file for zero raw text-[Npx] BEFORE adding it, leave the rest at warn + log as debt."
  - "Pattern 2: shell-level fluid-fill widening uses the same regex allow-list idiom as isFullBleed, keeping the widening scope-bounded and one-owner on the shared chrome file."

requirements-completed: [APPLY-01, TYPE-02]

# Metrics
duration: ~10min
completed: 2026-06-29
---

# Phase 52 Plan 07: no-raw-font-px ratchet (scope-corrected) + DashboardChrome wide-variant Summary

**Flipped `no-raw-font-px` to error on the grep-proven-clean phase-52 allocator-journey surfaces (per-file, not whole-glob, because the planner under-scoped the allocations/factsheet migrations) AND added a DashboardChrome `isWide` variant so the allocator routes actually fluid-fill to max-w-[1920px] instead of being clamped by the shell's max-w-7xl.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-29T12:33Z (approx)
- **Completed:** 2026-06-29T12:37Z
- **Tasks:** 3 (2 committed code tasks + 1 gitignored deferred-items log)
- **Files modified:** 3 tracked (eslint.config.mjs, DashboardChrome.tsx, DashboardChrome.test.tsx) + deferred-items.md (gitignored)

## Accomplishments

- **DashboardChrome wide-variant (gap-closure, delivers the user's ultra-wide fluid-fill decision):** added an `isWide` allow-list (`/allocations`, `/compare`, `/discovery/*`) mirroring the existing `isFullBleed` regex. The standard shell's content container now uses `max-w-[1920px]` for those routes and keeps `max-w-7xl` for everything else — uncapping the page-level `max-w-[1920px]` that 52-02/03/04 had set but which the shell's 1280px cap was clamping.
- **Scope-corrected eslint ratchet:** `no-raw-font-px=error` now applies to the verified-clean phase-52 surfaces — `compare/**`, `discovery/**`, `strategy/[id]/**`, `CompareTable.tsx`, `StrategyGrid.tsx`, 15 clean allocations files, and 13 clean factsheet files — without flipping the orphan-bearing whole globs. `npm run lint` exits 0 and the ratchet is proven non-vacuous.
- **Orphan-px debt logged:** 18 allocations + 7 factsheet orphan files (incl. the frozen EquityChart and chart-internal SVG) documented in `deferred-items.md` as Phase 53/54 debt, staying at repo-wide `warn` per the user's decision.
- **Frozen-spine guard kept green (9/9)** — no frozen-island files touched.

## Task Commits

1. **Task A: DashboardChrome wide-variant** - `7c39c9fb` (feat) — `feat(52): DashboardChrome wide-variant — allocator routes fluid-fill to 1920`
2. **Task B: scope-corrected eslint ratchet** - `1d41a12b` (feat) — `feat(52-07): ratchet no-raw-font-px=error for verified-clean phase-52 surfaces`

Task C (deferred-items.md update) needs no commit — `.planning/` is gitignored.

**Plan metadata:** committed with STATE.md/ROADMAP.md in the final docs commit.

## Files Created/Modified

- `src/components/layout/DashboardChrome.tsx` — added `isWide` regex allow-list + conditional `max-w-[1920px]`/`max-w-7xl` content container.
- `src/components/layout/DashboardChrome.test.tsx` — added 5 wide-variant tests (allocations/compare/nested-discovery → 1920; /portfolios → 7xl; /discoveryx regex-boundary → 7xl). 16/16 pass.
- `eslint.config.mjs` — added the phase-52 per-surface/per-file `no-raw-font-px=error` override block (after the design-tokens error block, before the chart `off` block); updated the strangler comment.
- `.planning/phases/52-…/deferred-items.md` (gitignored) — resolved the chrome-cap note + added the "Phase 52 orphan raw-px debt" section.

## Decisions Made

See `key-decisions` frontmatter. Core decision: the original 52-07 plan assumed Wave-2 left `allocations/**` and `factsheet/[id]/v2/**` whole-glob clean; empirical grep proved otherwise (18 + 7 orphan files), so per the user's "per-file ratchet + log debt" directive the ratchet was scope-corrected to per-file/clean-glob granularity. This is the honest application of the strangler (Rule 12 — fail loud rather than red CI or force-migrate frozen/chart code).

## Deviations from Plan

### Scope correction (per explicit user decision — not an auto-fix)

**1. [Plan scope correction] Per-file ratchet instead of whole-glob flip for allocations + factsheet**
- **Found during:** Task B (the eslint ratchet)
- **Issue:** The 52-07 plan directed flipping `src/app/(dashboard)/allocations/**` and `src/app/factsheet/[id]/v2/**` whole globs to error, asserting Wave 2 left them clean. Grep proved 18 allocations files (incl. the FROZEN EquityChart, 4 sites) and 7 factsheet files (incl. chart-internal TimeSeriesChart/HistogramChart/MasterBrush) still carry raw `text-[Npx]`. A whole-glob flip would red CI and/or force-migrate frozen/chart-coordinate code.
- **Fix:** Per the user's "per-file ratchet + log debt" decision, flipped only the grep-proven-clean surface globs (`compare/**`, `discovery/**`, `strategy/[id]/**`), clean component files (`CompareTable.tsx`, `StrategyGrid.tsx`), and 15 + 13 specific clean files as per-file globs. Orphans stay at repo-wide `warn`, logged in deferred-items.md.
- **Files modified:** eslint.config.mjs; deferred-items.md (gitignored)
- **Verification:** `npm run lint` exits 0 (0 errors, 434 warnings = the dirty baseline); non-vacuous proof below; frozen-spine guard green.
- **Committed in:** `1d41a12b`

**2. [Gap-closure — delivers the user's chosen ultra-wide fluid-fill] DashboardChrome wide-variant**
- **Found during:** Task A (the planned gap-closure)
- **Issue:** The shell's `max-w-7xl` (1280px) content cap clamped the page-level `max-w-[1920px]` that 52-02/03/04 set, so the allocator surfaces never visibly fluid-filled past 1280px (logged by the 52-03 executor in deferred-items.md).
- **Fix:** Added `isWide` regex allow-list + conditional `max-w-[1920px]` for allocator routes; all other dashboard routes keep `max-w-7xl`.
- **Files modified:** DashboardChrome.tsx, DashboardChrome.test.tsx
- **Verification:** `npx vitest run src/components/layout/DashboardChrome.test.tsx` → 16/16 pass; grep confirms both `max-w-[1920px]` and `max-w-7xl` present.
- **Committed in:** `7c39c9fb`

---

**Total deviations:** 1 plan scope correction (user-directed) + 1 planned gap-closure.
**Impact on plan:** The scope correction keeps the ratchet honest (Rule 12) and CI green without touching frozen/chart code. The gap-closure delivers the user's ultra-wide fluid-fill decision. No scope creep — both edits are shared/config files only, no surface restyle.

## Non-vacuous proof (Task B)

Temporarily added `const __SCRATCH_RATCHET_PROOF__ = "text-[13px]";` to `src/components/strategy/CompareTable.tsx` (an error-globbed file) → `npm run lint` reported **1 error** at `CompareTable.tsx:10:35` and **exited 1**. Removed the scratch line → lint **exit 0** again, CompareTable back to 0 raw px. This proves the error override is live and would fail CI on a future raw offender in the ratcheted surfaces.

## Config invariants verified

- 2 `no-raw-font-px: error` blocks (design-tokens + the new phase-52 block).
- 2 `no-raw-font-px: off` blocks intact (chart glob `src/components/charts/**` + test files).
- repo-wide `no-raw-font-px: warn` unchanged (eslint.config.mjs line 82).
- chart-internal factsheet SVG files (TimeSeriesChart/HistogramChart/MasterBrush) NOT in the error set → exemption preserved (T-52-21 mitigation honored).

## Issues Encountered

None — the only surprise (orphan-bearing globs) was anticipated by the decision_context and resolved per the user's per-file ratchet directive.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 52 is functionally complete: allocator-journey surfaces fluid-fill to 1920 and their clean files are ratcheted to `no-raw-font-px=error`.
- **Phase 53/54 debt (logged in deferred-items.md):** migrate the 18 allocations orphan files (EXCEPT the frozen EquityChart — never migrate) and 4 factsheet orphan files (MetricsColumn/MandatePanels/StressWindowsPanel/page) onto the `--text-*` tiers, then extend the error globs. The 3 chart-internal factsheet SVG files should stay exempt (consider folding them under a chart `off` glob).
- The frozen-spine guard remains the safety net for the 8 frozen islands.

## Self-Check: PASSED

- FOUND: 52-07-SUMMARY.md, eslint.config.mjs, DashboardChrome.tsx, DashboardChrome.test.tsx
- FOUND commits: 7c39c9fb (Task A), 1d41a12b (Task B)

---
*Phase: 52-per-surface-application-allocator-journey*
*Completed: 2026-06-29*
