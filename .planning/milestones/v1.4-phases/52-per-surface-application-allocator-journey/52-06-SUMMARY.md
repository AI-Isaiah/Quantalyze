---
phase: 52-per-surface-application-allocator-journey
plan: 06
subsystem: factsheet
tags: [container-queries, fluid-type-tiers, tabular-nums, frozen-spine, chrome-only, factsheet]

# Dependency graph
requires:
  - phase: 52-per-surface-application-allocator-journey
    plan: 01
    provides: "the frozen-spine git-delta guard + the container-query tabular-nums alignment contract this plan's migration keeps green"
  - phase: 49-fluid-type-token-spine
    provides: "the fluid --text-* clamp tiers (hero/page-title/h2/h3/body/small/caption/micro) the factsheet chrome migrates onto"
  - phase: 50-primitive-refresh
    provides: "the StrategyTable @container idiom (50-06) the KPI strip + StreakDistribution panel mirror"
provides:
  - "factsheet KPI strip on @container (column count keys off the strip's OWN width, not the viewport) with tabular-nums + the legit KPI-label clip preserved"
  - "factsheet v2 chrome raw-text-[Npx]-zero on all 10 non-frozen panel/view files (ready for the 52-07 lint ratchet) EXCEPT the chart-exempt SVG internals"
  - "byte-identity proof that the chrome migration RSC-ified / perturbed NONE of the 8 frozen islands (52+29+30 frozen-spine guards green, no svg golden rebaselined)"
affects: [52-07, 54-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "factsheet KPI strip @container migration: bare inline-size `@container` host + `@5xl:grid-cols-9/-7` (the old lg: ~1024px viewport breakpoint expressed as a container width), grid-cols-3 kept as the container-narrow fallback (Pitfall 1 — no size-containment)"
    - "raw text-[Npx] -> --text-* tier mapping for the factsheet chrome: 9/10/11px -> micro, 12px -> caption, 13px -> small, 14px -> body, H1 28/36/44 -> page-title (Instrument Serif)"
    - "SVG-internal fontSize/coordinate props left byte-identical (math/coordinate-adjacent); only HTML className text sizes migrated"

key-files:
  created:
    - "src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx"
  modified:
    - "src/app/factsheet/[id]/v2/FactsheetView.tsx"
    - "src/app/factsheet/[id]/v2/AnalyticalPanels.tsx"
    - "src/app/factsheet/[id]/v2/DistributionPanels.tsx"
    - "src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx"
    - "src/app/factsheet/[id]/v2/SignaturePanels.tsx"
    - "src/app/factsheet/[id]/v2/HeatmapPanels.tsx"
    - "src/app/factsheet/[id]/v2/BatchDPanels.tsx"
    - "src/app/factsheet/[id]/v2/ComparatorPicker.tsx"
    - "src/app/factsheet/[id]/v2/not-found.tsx"
    - "src/app/factsheet/[id]/v2/error.tsx"
    - "src/__tests__/phase-52-container-tabular-nums.test.tsx"
    - "src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx"

key-decisions:
  - "KPI strip uses `@5xl:grid-cols-9/-7` (≈64rem container width) to mirror the prior `lg:` (~1024px viewport) step-up point, keeping `grid-cols-3` as the container-narrow base — a bare inline-size @container (size-containment would collapse the strip's block size to 0, Pitfall 1)."
  - "KPI VALUE cells migrated `text-[15px]/[20px]/[22px]` onto `text-h2` (20->24 clamp) — the closest fluid tier preserving the prominent ~20-22px desktop metric scale + growing toward 1920; KPI LABEL `text-[9px]/[10px]` onto `text-micro`, keeping its legitimate text-ellipsis bounded-label clip (:647)."
  - "H1 `text-[28px]/[36px]/[44px]` -> `text-page-title` per the plan's explicit mapping (matches the sibling discovery [strategyId] H1 from 52-05), keeping the existing Instrument Serif."
  - "DistributionPanels is a PURE type-pass — its only grid is a fixed 5-col quantile row (not a viewport-variant breakpoint), so no container was added; the Task-2a @container requirement is satisfied by AnalyticalPanels' StreakDistributionPanel."
  - "CrossSignature/Signature panels: type-pass only — their md:grid-cols-2 grids render in the full-width body Signatures section, not a width-varying rail, so no container migration (dominant work is the type-pass per the plan)."
  - "error.tsx is a TYPE-PASS ONLY: the live signature is the standard `reset: () => void` (NOT unstable_retry — the unstable_retry boundary is the (dashboard)/error.tsx sibling from 52-05). reset signature intact, digest-only (never renders error.message)."

patterns-established:
  - "A className-only chrome migration that touches a test's pinned raw-px assertion updates the TEST to the migrated tier (preserving the test's INTENT — e.g. PEER-02 plain-vs-italic), never the source-back to raw px."

requirements-completed: [APPLY-01, TYPE-02, TYPE-04, STATE-02, BP-01]

# Metrics
duration: 18min
completed: 2026-06-29
---

# Phase 52 Plan 06: Factsheet Surface (Chrome/Layout Only) Summary

**The factsheet `/factsheet/[id]/v2` surface (the frozen-island-rich one) is brought to the v1.4 bar chrome-only: the KPI strip is now its own `@container` context (columns reflow on its OWN width via `@5xl:grid-cols-9/-7`, not `lg:`), all 10 non-frozen panel/view files are raw-`text-[Npx]`-zero on the `--text-*` tier spine, the ~1440 measure is kept, and the byte-identity gate proves the chrome work RSC-ified / perturbed NONE of the 8 frozen islands.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-29T14:03Z
- **Completed:** 2026-06-29T14:21Z
- **Tasks:** 4 completed (T1 TDD, T2a, T2b, T3 verification gate)
- **Files modified:** 13 (1 test created, 10 source + 2 tests modified)

## Accomplishments

- **Task 1 (TYPE-04 / TYPE-02 / APPLY-01) — FactsheetView KPI strip @container + fluid-type, TDD.** RED test (`FactsheetView.kpistrip.test.tsx`) asserts the strip carries `@container` and steps columns by `@`-prefixed variants (not `lg:grid-cols-9`), keeps `font-mono tabular-nums whitespace-nowrap` on every VALUE cell + the legit `text-ellipsis` LABEL clip (:647), and pins `max-w-[1440px]` (not raised to 1920). GREEN: the strip became a bare inline-size `@container` grid with `@5xl:grid-cols-9/-7` (the old ~1024px `lg:` step expressed as a container width) + `grid-cols-3` container-narrow fallback; all ~27 raw `text-[Npx]` in FactsheetView migrated onto `--text-*` tiers (micro/caption/small/h2, H1 -> page-title). Appended `FactsheetKpiStrip` to the `CONTAINER_MIGRATED` registry.
- **Task 2a (TYPE-04 / APPLY-01) — AnalyticalPanels + DistributionPanels.** StreakDistributionPanel's figure is now `@container`; the two-histogram split keys off the panel's OWN width (`@2xl:grid-cols-2`, was `sm:grid-cols-2`), preserving the single-column-when-narrow touch hit-rect scale (CR-01) — `useBreakpoint`/`useTapPin` (frozen islands) untouched. All raw `text-[Npx]` in both files migrated onto tiers; SVG `fontSize` coordinate props left as-is (math-adjacent). DistributionPanels is a pure type-pass (its only grid is a fixed 5-col quantile row).
- **Task 2b (TYPE-04 / APPLY-01 / ASVS V7) — remaining panels + ComparatorPicker + not-found/error.** All raw `text-[Npx]` migrated onto tiers across CrossSignature/Signature/Heatmap/BatchD panels, ComparatorPicker, not-found, error. error.tsx is a type-pass ONLY — its `reset` signature is intact and it never renders `error.message` (digest-only). No new containers (these render full-width).
- **Task 3 (BP-01 / SCENARIO-05 / BODY-02) — verification gate (no source edits).** The 52 + 29 + 30 frozen-spine guards + `scenario.test.ts` exit 0 (53 tests); zero frozen-island file in the phase delta; `AllocationsTabs.tsx` untouched (0 in delta — owned by 52-02); the svg-chart-parity goldens are unchanged and no `--update-snapshots` was ever run.

## Task Commits

1. **Task 1 RED — failing KPI-strip @container + fluid-type test** — `8003196b` (test)
2. **Task 1 GREEN — FactsheetView KPI strip @container + fluid tiers** — `791a54cb` (feat)
3. **Task 2a — AnalyticalPanels + DistributionPanels chrome -> tiers + @container** — `d8c75018` (feat)
4. **Task 2b — type-pass remaining panels + ComparatorPicker/not-found/error** — `b2d57e49` (feat)

Task 3 is verification-only (no source edits) — its deliverable is the green frozen-spine gate documented here, not a commit.

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2/" phase-52/29/30-frozen-spine-guards scenario.test.ts phase-52-container-tabular-nums` → **18 files / 172 tests passed**.
- Task 1 verify: `FactsheetBody.degenerate` + `phase-52-container-tabular-nums` + `phase-52-frozen-spine` + the new `FactsheetView.kpistrip` → green (RED proven first: Test 1 + Test 2 failed before the migration, naming `expected 0 to be greater than 0`).
- Task 2a verify (NOTE — substituted command, see below): `tap-charts-viewport.test.tsx` + `no-hover-panels-viewport.test.tsx` + `FactsheetBody.degenerate.test.tsx` + `phase-52-frozen-spine` → green.
- Task 2b verify: `BatchDPanels.ownbook` + `BatchDPanels.peer-scenario` + `ComparatorPicker` + `phase-52-frozen-spine` → green.
- Task 3 verify: `phase-52 + phase-29 + phase-30 frozen-spine-guards` + `scenario.test.ts` → **53 tests passed**.
- `npx eslint` on all 10 migrated source files → **0 errors** (no `no-raw-font-px` violations). `npx tsc --noEmit` → **no errors in the v2 factsheet files**.

### Substituted Task-2a verify command (acceptance NOTE honored)

The plan's Task-2a `<verify>` names `AnalyticalPanels.test.tsx` / `DistributionPanels.test.tsx`, which **do not exist**. Per the acceptance NOTE ("run the nearest existing panel render test that imports them … and record the substituted command"), I substituted the two existing specs that mount these panels:
`npx vitest run "src/app/factsheet/[id]/v2/tap-charts-viewport.test.tsx" "src/app/factsheet/[id]/v2/no-hover-panels-viewport.test.tsx" "src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx" src/__tests__/phase-52-frozen-spine-guards.test.ts` — green (4 files / 62 tests). The FactsheetBody.degenerate matrix mounts StreakDistributionPanel + the Distribution panels through the real body; tap-charts/no-hover-panels render them at viewport.

### svg-chart-parity goldens (Task 3 acceptance)

- **No golden touched:** no snapshot/golden/`.png` file appears in the phase git delta; the working tree carries no modified snapshot artifact.
- **No `--update-snapshots`** was run at any point in this plan.
- **Why the per-panel SVG goldens cannot drift:** they scope to the chart `<svg>` (`getByRole("img", …)` on `ResponsiveChartFrame`); this plan changed only HTML `className` text sizes around the charts + one `@container` grid host — the SVG-internal `fontSize`/coordinate props and all compute are byte-identical, so the no-recompute boundary was not crossed.
- The spec is seed-gated (`HAS_SEED_ENV` needs `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY`) and runs in CI's seeded MA-8 job at the phase gate, not locally (no network/seeded DB in the sandbox). The one `full-page-desktop.png` golden captures `#factsheet-main` and will reflect the *intended* typography-tier refresh (10/11px raw -> the 10->11 `--text-micro` clamp etc.) — to be confirmed at the CI phase gate; do NOT re-baseline reflexively.

## Acceptance Criteria

- **Task 1:** `@container` >= 1 (3, incl. live class); `@container-size` = 0; `lg:grid-cols-9` absent; `tabular-nums` = 5 (>= prior); `text-ellipsis` present (2); `max-w-[1440px]` = 1; FactsheetView raw `text-[Npx]` = **0**; the 3 vitest files exit 0. ✓
- **Task 2a:** raw `text-[Npx]` across AnalyticalPanels + DistributionPanels = **0**; `@container` sum = 3 (>= 1, all in AnalyticalPanels); `@container-size` = 0; substituted vitest exits 0. ✓
- **Task 2b:** raw `text-[Npx]` across all 7 files = **0**; `error.message` = 0; `unstable_retry` unchanged (0 -> 0, the standard `reset` signature was never on unstable_retry); `@container-size` = 0; vitest exits 0. ✓
- **Task 3:** the 52+29+30 frozen-spine + scenario.test.ts exit 0; frozen-island grep in delta = 0; `AllocationsTabs.tsx` grep in delta = 0; svg goldens unchanged + no `--update-snapshots`. ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Updated a test that pinned the OLD raw-px class on a migrated file**
- **Found during:** Task 2b (BatchDPanels migration)
- **Issue:** `BatchDPanels.peer-scenario.test.tsx:130` asserted the scenario-blend disclosure carried `text-[10px]`; migrating BatchDPanels' raw px onto `text-micro` (the explicit plan action) made that literal assertion fail.
- **Fix:** Updated the assertion to `text-micro`, preserving the test's INTENT (the PEER-02 scenario disclosure is plain, non-italic, muted — distinct from the api path's italic footnote). Added a comment noting the 52-06 / TYPE-04 migration. Did NOT revert the source to raw px.
- **Files modified:** `src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx`
- **Commit:** `b2d57e49`

### Notes on plan-vs-reality

- **error.tsx `unstable_retry`:** the plan twice says to "keep the unstable_retry signature." The live factsheet v2 `error.tsx` uses the standard `reset: () => void` (the `unstable_retry` boundary is the `(dashboard)/error.tsx` sibling created in 52-05, per the STATE decision log). I honored the verifiable acceptance criteria (`error.message` = 0, `unstable_retry` count unchanged at 0) and gave error.tsx a pure type-pass — the `reset` signature is intact and the boundary still never leaks the server message.
- **DistributionPanels / CrossSignature / Signature containers:** no new `@container` was added to these — none renders at varying width in a rail (DistributionPanels' only grid is a fixed 5-col quantile row; the Signatures grids render in the full-width body section). The plan's `@container`-sum acceptance for Task 2a is satisfied by AnalyticalPanels' StreakDistributionPanel, and the plan itself says "the dominant work here is the type-pass, not new containers."

### Out-of-scope (not touched)

- `MandatePanels.tsx` (NOT in this plan's `files_modified`) still carries `text-[10px]` and its test still pins that literal — correctly out of scope; left untouched.
- The 4 pre-existing `@typescript-eslint/no-unused-vars` warnings in FactsheetView.tsx (StyleDriftPanel/PeerPercentilePanel imports + a destructured `colorblind`/`darkMode`) are in untouched code — left per the scope boundary.

No package installs (CSS/chrome only, per threat T-52-SC `accept`). No auth gates.

## Known Stubs

None. All 10 source files are complete chrome migrations reading already-computed payload props; no hardcoded empty values, placeholders, or unwired data sources were introduced.

## Threat Surface

No new network endpoints, auth paths, file access, or trust-boundary schema changes — this plan touches only `className`/type on presentation components. The threat register's mitigations were honored: T-52-18 (frozen-island RSC-ification) is proven absent by the Task-3 byte-identity gate; T-52-19 (error.tsx leak) by the digest-only type-pass; T-52-20 (visibility/signature gate) is untouched (no gate lives in a className). No threat flags.

## Self-Check: PASSED

- Files: all created/modified source files + the SUMMARY exist on disk.
- Commits: `8003196b`, `791a54cb`, `d8c75018`, `b2d57e49` all present in git log.
- `.planning/` is gitignored (local-only, per PR #530) — the SUMMARY is written to disk but not committed; the four `test(...)`/`feat(...)` commits are the complete code deliverable.
