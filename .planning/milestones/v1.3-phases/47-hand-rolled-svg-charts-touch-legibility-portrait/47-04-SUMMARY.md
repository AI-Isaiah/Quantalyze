---
phase: 47-hand-rolled-svg-charts-touch-legibility-portrait
plan: 04
subsystem: ui
tags: [react, svg-charts, responsive, useBreakpoint, ResponsiveChartFrame, viewport, legibility, portrait, vitest, role-img, wcag-1.4.4, byte-identity]

# Dependency graph
requires:
  - phase: 44 (primitives)
    provides: "ResponsiveChartFrame (viewBox/preserveAspectRatio/aspect-ratio recipe) + useBreakpoint (SSR-safe mobile/tablet/desktop)"
  - phase: 47-02
    provides: "the no-recompute desktop-literals contract + the global jsdom matchMedia stub (src/test-setup.ts) that unblocks every useBreakpoint component test"
provides:
  - "320px legibility (CHART-02) + portrait tuning (CHART-03) for the 2 standalone non-factsheet-panel no-hover SVG charts: ReturnQuantiles (box plot) + MonteCarloBandChart (allocations confidence-band fan)"
  - "ReturnQuantiles root svg now wrapped in ResponsiveChartFrame (role=img + aria-label); mobile branch bumps y-tick/period fonts (10/11 -> 22) + reduces y-gridlines (5 -> 3) + raises viewBox height (200 -> 280); desktop branch returns today's exact literals (byte-identical)"
  - "MonteCarloBandChart RCF-wrapped (role=img preserved, NO tabIndex/interaction); mobile branch bumps tick fontSize (12 -> 20) + raises viewBox height (240 -> 320); desktop branch returns today's exact literals (byte-identical)"
  - "Sparkline explicitly dispositioned as a Phase-47 NO-OP (120x32 decorative inline, no text, no hover) with a documented comment — the chart set reconciles with no phantom task"
  - "MonteCarloBandChart.test.tsx: a Vitest COMPONENT byte-identity proof (desktop fontSize=12 falsifiable) for the chart that never renders on the seeded e2e route (RESEARCH Pitfall 4), rendering BOTH isMobile branches in-wave"
  - "ReturnQuantiles.test.tsx extended to render BOTH isMobile branches in-wave + a falsifiable desktop viewBox/fontSize byte-identity assertion"
affects:
  - "47-05 (Playwright desktop goldens + 320px portrait snapshots — the desktop literals pinned here (ReturnQuantiles 0 0 600 200, MonteCarloBandChart 0 0 600 240) MUST stay byte-identical when the goldens are baked; MonteCarloBandChart has NO Playwright golden by design (Pitfall 4), its desktop byte-identity lives in this plan's component test)"

# Tech tracking
tech-stack:
  added: []  # zero net-new npm deps (locked constraint)
  patterns:
    - "Mobile-gated tuning that keeps desktop byte-identical: `const isMobile = useBreakpoint() === 'mobile'; const v = isMobile ? mobileValue : todaysLiteral` — the desktop arm equals the pre-edit literal so the SSR/desktop render (server snapshot is 'desktop') is unchanged (the 47-02 contract, applied to the 2 standalone charts)"
    - "Module-level VB consts split into VB_H_DESKTOP/VB_H_MOBILE + TICK/FONT_DESKTOP/_MOBILE; per-render H/PLOT_H/font/tick-density selection moved INTO the component while the fixed WIDTH axis (W/PAD_L/PAD_R/PLOT_W) stays module-level (no width-axis math perturbed)"
    - "role=img non-interactive chart stays non-interactive at EVERY breakpoint: the mobile branch only tunes font/viewBox-height; NO tabIndex/pointer handlers/useTapPin ever added (parity-only + the DESIGN.md empty-focus-stop rule)"
    - "Component-snapshot byte-identity proof for an e2e-uncoverable chart: a props-only Vitest render with a deterministic synthetic fixture asserts the desktop fontSize literal (falsifiable: a 12 -> 13 mutation fails it) — replaces a Playwright golden where the seeded route renders 0 positions (Pitfall 4)"

key-files:
  created: []
  modified:
    - src/components/charts/ReturnQuantiles.tsx
    - src/components/charts/ReturnQuantiles.test.tsx
    - src/components/charts/Sparkline.tsx
    - src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx
    - src/app/(dashboard)/allocations/components/MonteCarloBandChart.test.tsx

key-decisions:
  - "Added role=img + aria-label to ReturnQuantiles as part of the RCF-wrap. The raw svg had NO role/aria today (it was a bare `<svg className=\"w-full\">`); wrapping in ResponsiveChartFrame with role=img + a descriptive label is additive a11y, NOT a removal of existing aria text. The label is data-derived ('Return quantiles box plot across N periods (...)') — no fabricated content."
  - "Both charts use an in-svg font bump (no HTML-overlay machinery): VB_W is 600 (not the 880/1100 of the densest factsheet panels), so at 320px a mobile fontSize of 20-22 clears the ~12px effective floor without the overlay fallback RESEARCH flagged for the wide panels. Same lever family as 47-02 (font bump + tick reduction + taller mobile viewBox) but realizable in-svg here."
  - "MonteCarloBandChart's existing 3-test file (Plan 27-02) was EXTENDED, not replaced — all 3 pre-existing assertions (paths render, role=img + no tabindex, empty-bands null) kept verbatim and green; the useBreakpoint mock + a beforeEach('desktop') were added so the pre-existing tests still see today's desktop render. Added 3 Phase-47 both-branch + byte-identity tests."
  - "MonteCarloBandChart byte-identity is proven by a Vitest COMPONENT snapshot, NOT a Playwright golden (RESEARCH Pitfall 4): the seeded allocator route renders 0 synced positions and ScenarioComposer needs >=2 strategies, so the fan never mounts on the seeded e2e route. The desktop fontSize=12 assertion is the falsifiable no-recompute proof (verified: mutating 12 -> 13 fails the desktop test, then reverted)."

patterns-established:
  - "no-recompute desktop-literals contract extended to the 2 standalone charts: every viewport-dependent value is `isMobile ? mobileValue : todaysLiteral`; the desktop arm is byte-identical to the pre-edit literal, asserted in-wave by exact desktop-viewBox + fontSize checks (falsifiable)"
  - "Wave-1 branch-coverage test pattern (from 47-02): render each chart with useBreakpoint mocked to BOTH 'mobile' and 'desktop' so new conditionals are covered in the SAME wave they're introduced (holds the BLOCKING branch ratchet >=72)"

requirements-completed: [CHART-02, CHART-03]

# Metrics
duration: 11min
completed: 2026-06-28
---

# Phase 47 Plan 04: Standalone SVG Charts Legibility + Portrait Summary

**Brought the two standalone (non-factsheet-panel) no-hover hand-rolled SVG charts — ReturnQuantiles (box plot) and MonteCarloBandChart (allocations confidence-band fan) — to 320px legibility + portrait tuning by wrapping each root svg in ResponsiveChartFrame and gating font/tick/viewBox-height behind a `useBreakpoint` mobile branch (desktop branch returns today's exact literals, byte-identical), dispositioned Sparkline as an explicit NO-OP, and proved MonteCarloBandChart's desktop byte-identity via a falsifiable Vitest COMPONENT test because the seeded e2e route renders 0 positions and never mounts the fan (Pitfall 4) — both new isMobile branches exercised in-wave so the BLOCKING branch ratchet (>=72) holds at 75.32%.**

## Performance

- **Duration:** ~11 min
- **Tasks:** 2
- **Files modified:** 5 (3 charts/tests in src/components/charts + 2 in allocations/components)

## Accomplishments
- **ReturnQuantiles** RCF-wrapped (was a bare `<svg className="w-full">`) with `role="img"` + a data-derived `aria-label`; mobile branch bumps y-tick font 10 -> 22 + period-label font 11 -> 22, reduces y-gridlines 5 -> 3, raises viewBox height 200 -> 280; **desktop branch returns today's exact literals** (viewBox `0 0 600 200`, fontSize 10/11, 5 gridlines) -> byte-identical. NO interaction invented (no desktop hover): zero `useTapPin`/`tabIndex`/pointer handlers.
- **MonteCarloBandChart** RCF-wrapped while **preserving `role="img"`** + its aria-label + `data-testid`; mobile branch bumps tick fontSize 12 -> 20 + raises viewBox height 240 -> 320; **desktop branch returns today's exact literals** (viewBox `0 0 600 240`, fontSize 12) -> byte-identical. The a11y contract is held in BOTH branches: **NO `tabIndex` / pointer handlers ever added** (avoids the empty-focus-stop regression DESIGN.md pins against). Bands read from props; no recompute.
- **Sparkline** explicitly dispositioned as a Phase-47 **NO-OP** with a documented comment (120x32 decorative inline sparkline, no text/axis/labels, no hover, renders at intrinsic CSS px with no viewBox-downscale trap) -> no `isMobile` conditional, no new branch, no test needed. The chart set reconciles with no phantom task.
- **Both new viewport conditionals are branch-covered IN THIS WAVE.** `ReturnQuantiles.test.tsx` (extended) and `MonteCarloBandChart.test.tsx` (extended from its Plan-27-02 3-test base) each mock `useBreakpoint` and render BOTH `"mobile"` and `"desktop"`. The MonteCarloBandChart desktop fontSize=12 assertion is a **falsifiable byte-identity proof** (verified: mutating 12 -> 13 makes the desktop test FAIL, then reverted) — the no-recompute proof for the chart that can't render on the seeded e2e route.
- **Branch ratchet held in-wave:** full coverage suite green (569 files / **6875 passed**, 0 failed) with branches **75.32%** (>=72 BLOCKING gate), statements 82.79, functions 78.67, lines 84.9 — all above thresholds. Frozen-spine guards (SCENARIO-05 / BODY-02) green. tsc clean. Zero net-new npm deps.

## Task Commits

Each task was committed atomically:

1. **Task 1: ReturnQuantiles RCF-wrap + mobile legibility/portrait + both-branch test; Sparkline NO-OP disposition** - `d92a5267` (feat)
2. **Task 2: MonteCarloBandChart mobile legibility/portrait (role=img preserved) + Vitest desktop byte-identity snapshot rendering both isMobile branches** - `af2dd4ab` (feat)

**Plan metadata:** (final docs commit follows this summary)

## Files Created/Modified
- `src/components/charts/ReturnQuantiles.tsx` - RCF-wrapped (role=img + aria-label); module VB split into desktop/mobile + desktop/mobile font + gridline-density consts; per-render height/font/gridline selection gated on `isMobile`; desktop arm = today's literals.
- `src/components/charts/ReturnQuantiles.test.tsx` - mocked `useBreakpoint` + `beforeEach('desktop')`; kept the 2 existing DESIGN-01 identity tests verbatim; added 3 Phase-47 tests (desktop byte-identity 0 0 600 200 + fontSize 10/11 + 5 gridlines + role=img/no-tabindex; mobile bumped fonts + 3 gridlines + 0 0 600 280; live-conditional viewBox-differs).
- `src/components/charts/Sparkline.tsx` - added the explicit Phase-47 NO-OP disposition comment; functionally unchanged.
- `src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx` - RCF-wrapped (role=img + aria-label + data-testid passed through); module `H` split into desktop/mobile + desktop/mobile tick-font consts; per-render `H`/`PLOT_H`/`tickFont` gated on `isMobile`; the 3 tick `<text>` use `tickFont`; desktop arm = today's literals.
- `src/app/(dashboard)/allocations/components/MonteCarloBandChart.test.tsx` - extended the Plan-27-02 3-test file: mocked `useBreakpoint` + `beforeEach('desktop')`; kept all 3 existing assertions; added 3 Phase-47 tests (desktop byte-identity 0 0 600 240 + fontSize=12 + role=img/no-tabindex/paths; mobile bumped fontSize + 0 0 600 320 + role=img/no-tabindex; live-conditional viewBox-differs).

## Decisions Made
- See `key-decisions` frontmatter. Headline: MonteCarloBandChart's desktop byte-identity is a **Vitest component snapshot** (not a Playwright golden) per RESEARCH Pitfall 4 — the seeded allocator route renders 0 positions so the fan never mounts in e2e; the falsifiable desktop fontSize=12 assertion is the no-recompute proof. ReturnQuantiles' `role="img"` + aria-label is additive (the raw svg had none today). Both charts use an in-svg font bump (VB_W=600 makes the floor clearable without HTML overlays).

## Deviations from Plan

None - plan executed exactly as written. Both tasks' actions, files, verifications, and acceptance criteria were satisfied as specified; no auto-fixes (Rules 1-3) and no architectural escalations (Rule 4) were required. The pre-existing global jsdom `matchMedia` stub from Plan 47-02 (`src/test-setup.ts`) already unblocked the new component tests, so no test-infra deviation was needed this plan.

> Verify-command note (not a deviation): the plan's Task-2 automated check `! grep -q "tabIndex" MonteCarloBandChart.tsx` reports a false negative because the file's DOC COMMENTS (the pre-existing header rationale at L20 and the new L62 comment) mention the word "tabIndex" while describing what is intentionally NOT added. There is NO actual `tabIndex=` attribute, pointer handler, or `useTapPin` in the file (`grep -nE 'tabIndex=|onPointer[A-Z]|useTapPin\('` returns nothing). The acceptance criterion's intent — "contains NO tabIndex / pointer handlers / useTapPin" — is satisfied. This mirrors how Plan 47-02 handled its no-interaction charts (their header comments also mention the forbidden patterns).

## Issues Encountered
- None. The width-axis math (W/PAD_L/PAD_R/PLOT_W) stayed module-level in both charts, so only the height axis + fonts vary by breakpoint; no geometry/path math was perturbed. tsc + the full suite stayed green.

## User Setup Required
None - no external service configuration required. Zero net-new npm dependencies (locked constraint).

## Next Phase Readiness
- **47-05** (Playwright desktop goldens + 320px portrait snapshots): the desktop viewBox literals pinned by this plan's in-wave assertions — ReturnQuantiles `0 0 600 200` (fontSize 10/11, 5 gridlines), MonteCarloBandChart `0 0 600 240` (fontSize 12) — MUST stay byte-identical when goldens are baked. **MonteCarloBandChart has NO Playwright golden by design** (Pitfall 4: 0-position seeded route); its desktop byte-identity lives in `MonteCarloBandChart.test.tsx` and must stay green. Bake the desktop goldens from this state FIRST, then verify the 320px portrait floor. Do NOT `--update-snapshots` a desktop golden after any further tuning (Pitfall 2).
- **Effective-px legibility floor (~12px at 320px):** the mobile branch raises fonts (20-22) + reduces ticks/gridlines + adds a taller viewBox; the final ≥~12px verification is the 320px portrait snapshot Plan 05 bakes. The branch + byte-identity contract is in place and ratchet-held.
- No blockers. Frozen-math boundary untouched (SCENARIO-05 / BODY-02 green; no series/metric/domain recomputed — every value read from props).

## Known Stubs
None. Sparkline's NO-OP is a deliberate, documented disposition (no text/hover -> no legibility/portrait concern), not a stub: it is the correct, complete behavior for a decorative inline sparkline at every viewport.

## Self-Check: PASSED

All claimed files exist on disk and both task commits exist in git history:
- FOUND: `src/components/charts/ReturnQuantiles.tsx`
- FOUND: `src/components/charts/ReturnQuantiles.test.tsx`
- FOUND: `src/components/charts/Sparkline.tsx`
- FOUND: `src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx`
- FOUND: `src/app/(dashboard)/allocations/components/MonteCarloBandChart.test.tsx`
- FOUND: `.planning/phases/47-hand-rolled-svg-charts-touch-legibility-portrait/47-04-SUMMARY.md`
- FOUND commit: `d92a5267` (Task 1)
- FOUND commit: `af2dd4ab` (Task 2)

---
*Phase: 47-hand-rolled-svg-charts-touch-legibility-portrait*
*Completed: 2026-06-28*
