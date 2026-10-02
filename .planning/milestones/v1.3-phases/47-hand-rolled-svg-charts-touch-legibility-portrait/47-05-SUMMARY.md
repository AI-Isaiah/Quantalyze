---
phase: 47-hand-rolled-svg-charts-touch-legibility-portrait
plan: 05
subsystem: verification
tags: [playwright, e2e, golden-snapshots, target-size, wcag-2.5.5, wcag-1.4.4, flow-01, ci, coverage-ratchet, frozen-math, byte-identity, pointer-coarse]

# Dependency graph
requires:
  - phase: 47-02
    provides: "no-hover SVG panels RCF-wrapped + mobile-tuned; desktop literals pinned (StreakDist/EndOfYear/Quantile/Correlation/Signatures/Histogram/MasterBrush byte-identical desktop branch)"
  - phase: 47-03
    provides: "the 3 tap-reveal charts (StreakDistribution / DailyReturnsHeatmap / DailyHeatmap) with useTapPin + pointer-coarse-only >=44px hit rects — what the extended target-size gate measures"
  - phase: 47-04
    provides: "ReturnQuantiles + MonteCarloBandChart mobile-tuned; their desktop byte-identity is Vitest (NOT a Playwright golden — Pitfall 4, 0-grid/0-position seeded route)"
  - phase: 44 (primitives)
    provides: "assertTargetSizes / assertNoReflow helpers (MIN_TARGET_PX=44); seedStrategyWithHistory; the reflow-sweep-authed seeded-route template; ci.yml MA-8 seeded list"
provides:
  - "Fresh e2e/svg-chart-parity.spec.ts — desktop byte-identity goldens (no-recompute proof, CHART-03) + 320px portrait snapshots (CHART-02 legibility floor + CHART-03 portrait) for the in-scope hand-rolled SVG factsheet panels on the seeded /factsheet/[id]/v2 route"
  - "Extended e2e/target-size.spec.ts — seeded chart-tap-rect >=44px case at 320px under emulated pointer:coarse (DailyReturnsHeatmap calendar surface + StreakDistribution per-bar coarse rects); the existing UNSEEDED /security legal-footer case left byte-identical"
  - "FLOW-01 dual-wiring: both new gates have a HAS_SEED_ENV self-skip (place 2) AND are added to the ci.yml MA-8 seeded playwright list (place 1); dead strategy-v2-chart-parity.spec.ts left in place"
  - "e2e/__snapshots__/svg-chart-parity.spec.ts/README.md — bake-on-first-seeded-CI-run discipline (no placeholder PNGs committed; goldens bake desktop-first, Pitfall 2)"
affects:
  - "Phase 48 (final verification): the desktop goldens baked here are the byte-identity baseline; the dead Recharts spec stays for Phase 48 to rewrite"

# Tech tracking
tech-stack:
  added: []  # zero net-new npm deps (locked constraint)
  patterns:
    - "Seeded SVG-chart parity spec on the REAL panel mount route (/factsheet/[id]/v2 via FactsheetView), not the plan's literal /strategy/[id]/v2 (a different StrategyV2Shell panel family whose in-scope charts the seed data-suppresses) — corrected by import-tracing the mount points (Rule 1)"
    - "Per-panel anchor = role=img + aria-label-prefix regex scoped under #factsheet-main; toHaveScreenshot(panel) only after the anchor is visible → fails loud on a blank/sub-banner page (Pitfall 5), never a vacuous golden"
    - "pointer:coarse emulation via test.use({ hasTouch:true, isMobile:true }) so the Phase-47-03 `pointer-coarse:`-only tap-target layer (display:none on fine pointer) becomes measurable — the faithful >=44px touch hit-rect assertion (measuring it on a fine pointer would skip the layer → the assertTargetSizes >=1-measured false-green guard would fire)"
    - "Goldens bake on the first seeded CI run (or local --update-snapshots with test-Supabase env); a committed README documents the desktop-first bake order (Pitfall 2) — NO placeholder/empty PNGs committed (that would be a false-green)"

key-files:
  created:
    - e2e/svg-chart-parity.spec.ts
    - e2e/__snapshots__/svg-chart-parity.spec.ts/README.md
  modified:
    - e2e/target-size.spec.ts
    - .github/workflows/ci.yml

key-decisions:
  - "ROUTE CORRECTION (Rule 1): targeted /factsheet/[id]/v2 (FactsheetView) for the parity goldens + the chart-tap-rect target-size case, NOT the plan's literal /strategy/[id]/v2. Import-tracing proved /strategy/[id]/v2 renders StrategyV2Shell (OverviewPanel/HeadlineMetricsPanel/.../ReturnsDistributionPanel) — a DIFFERENT panel family — and the only in-scope charts it would show (DailyHeatmap + ReturnQuantiles via ReturnsDistributionPanel) are data-suppressed by seedStrategyWithHistory (return_quantiles=null, daily_returns_grid never seeded). The in-scope Phase-47 hand-rolled SVG panels (StreakDistribution/BootstrapCI/EndOfYear/Quantile/Correlation×2/Histogram/MasterBrush/DailyReturnsHeatmap) mount via FactsheetView, which serves /factsheet/[id]/v2 (published-gated; the seed sets status:'published'). Using the plan's literal route would have produced empty/sub-banner goldens — a false-green."
  - "No placeholder golden PNGs committed (locked critical constraint). The seed env (TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) is ABSENT locally (verified), so the seeded route cannot be rendered here. Committing hand-written/empty PNGs would be a false-green. Instead: the spec self-skips without seed env (verified: 2 skipped, no false pass), is FLOW-01 wired, and a README documents the bake-on-first-seeded-CI-run flow + the desktop-first bake order (Pitfall 2)."
  - "Coarse-pointer emulation for the tap-rect gate: the Plan-03 hit targets are `hidden pointer-coarse:block` rects / `pointer-coarse:min-h-[44px]` div — display:none / un-floored on Playwright's default fine pointer. test.use({ hasTouch:true, isMobile:true }) makes Chromium report pointer:coarse so the gate measures the real touch layer; the DailyReturnsHeatmap calendar div (always-rendered role=img) is the primary stable target, StreakDistribution coarse rects the secondary."
  - "target-size.spec.ts listed in BOTH ci.yml lists: its unseeded /security case keeps its unseeded entry (~L1059); its new seeded chart cases need the MA-8 list to actually run seeded (they self-skip in the unseeded run). Documented inline in ci.yml."

patterns-established:
  - "Verify the REAL mount route by import-tracing before authoring a seeded golden spec — a plan's named route can be a different panel family or data-suppressed by the seed; a route mistake bakes a vacuous golden (false-green)."
  - "When the seed env is absent locally, never fabricate goldens — self-skip + FLOW-01 wire + document bake-on-first-CI; the spec is correct, the goldens are deferred, and no false-green is committed."

requirements-completed: [CHART-01a, CHART-02, CHART-03]

# Metrics
duration: 38min
completed: 2026-06-28
---

# Phase 47 Plan 05: SVG Chart Parity + Target-Size Gate + FLOW-01 Wiring Summary

**Stood up the falsifiable verification for the whole of Phase 47: a fresh seeded `e2e/svg-chart-parity.spec.ts` that bakes DESKTOP byte-identity goldens (the no-recompute proof, CHART-03) AND 320px PORTRAIT snapshots (CHART-02 legibility floor + CHART-03 portrait) for the in-scope hand-rolled SVG factsheet panels; an extension to `e2e/target-size.spec.ts` asserting the tap-reveal charts' coarse hit-rects ≥44px at 320px (CHART-01a); and FLOW-01 dual-wiring both gates into the ci.yml MA-8 seeded list — with the corrected route (`/factsheet/[id]/v2`, the real FactsheetView mount point, not the plan's literal `/strategy/[id]/v2` whose in-scope charts the seed suppresses), no placeholder PNGs committed (the seed env is absent locally so goldens bake on the first seeded CI run), the dead Recharts spec left for Phase 48, and the coverage ratchet (lines 84.85 / stmts 82.68 / fns 78.66 / branches 75.33, all ≥ thresholds) + SCENARIO-05 + BODY-02 + metrics-parity all green and un-weakened.**

## Performance

- **Duration:** ~38 min
- **Completed:** 2026-06-28
- **Tasks:** 3
- **Files created:** 2 · **Files modified:** 2

## Accomplishments

- **Task 1 — fresh `e2e/svg-chart-parity.spec.ts`:** Two tests on the seeded `/factsheet/[id]/v2` route — (1) DESKTOP per-panel goldens (`maxDiffPixelRatio: 0.02`) + a full-page golden (`0.05`) = the no-recompute proof (CHART-03); (2) 320px PORTRAIT per-panel snapshots = the legibility floor (CHART-02) + portrait tuning (CHART-03). Each of the 9 in-scope panels (StreakDistribution, BootstrapCI, EndOfYearBars, QuantileBoxPlot, CorrelationStrip, CorrelationsMatrix, Histogram, MasterBrush, DailyReturnsHeatmap) is anchored on its stable `role="img"` + aria-label-prefix under `#factsheet-main` and asserted visible BEFORE any screenshot (fails loud on HTTP≥400 / blank / sub-banner — Pitfall 5). `HAS_SEED_ENV` self-skip (FLOW-01 place 2). Verified: 2 skipped locally, **no false-green**.
- **Task 2 — extended `e2e/target-size.spec.ts`:** A new seeded `test.describe` with `test.use({ hasTouch:true, isMobile:true })` (emulates pointer:coarse) asserts the Plan-03 tap-reveal hit targets measure ≥44px at 320px — the DailyReturnsHeatmap calendar surface (`role=img` + `pointer-coarse:min-h-[44px]`) and the StreakDistribution per-bar coarse `<rect>`s. `HAS_SEED_ENV` self-skip; fails loud on HTTP≥400. The existing UNSEEDED /security legal-footer case is **byte-identical** (verified: still passes locally, no removed assertion lines). `MIN_TARGET_PX=44` NOT lowered (scoped, not weakened).
- **Task 3 — FLOW-01 ci.yml wiring + gates:** Added `e2e/svg-chart-parity.spec.ts` AND `e2e/target-size.spec.ts` to the MA-8 seeded `npx playwright test` list (place 1); the dead `e2e/strategy-v2-chart-parity.spec.ts` is left in place (self-skips; Phase-48). An inline comment documents the dual-placement + the two-place FLOW-01 rule. Ran the BLOCKING gates: `npm run test:coverage` **exit 0** (lines 84.85 / stmts 82.68 / fns 78.66 / branches 75.33 — all ≥ 82/80/74/72, **none lowered, no snapshot blanket-updated**); SCENARIO-05 (`phase-31-frozen-spine-guards`) 5/5; metrics-parity + 3 BODY-02 `FactsheetBody.*` guards 44/44. Source tree clean (Plan 05 touches only e2e/ + ci.yml — zero chart recompute risk). YAML validates.

## Task Commits

1. **Task 1: fresh seeded svg-chart-parity spec — desktop goldens + 320px portrait (FLOW-01 self-skip)** — `3723ebbf` (test)
2. **Task 2: extend target-size gate — chart tap-rects ≥44px at 320px (seeded, coarse)** — `89f6d67d` (test)
3. **Task 3: FLOW-01 wire svg-chart-parity + seeded target-size into MA-8 list** — `e0773989` (ci)

## Files Created/Modified

- `e2e/svg-chart-parity.spec.ts` (NEW) — desktop byte-identity goldens + 320px portrait snapshots for the 9 in-scope SVG panels on the seeded `/factsheet/[id]/v2` route; `HAS_SEED_ENV` self-skip; per-panel role=img anchors; fail-loud HTTP/visibility guards; documented route correction + bake-order discipline.
- `e2e/__snapshots__/svg-chart-parity.spec.ts/README.md` (NEW) — documents that goldens bake on the first seeded CI run (or local `--update-snapshots` with the test-Supabase env), the desktop-first bake order (Pitfall 2), and the "never `--update-snapshots` a desktop golden after tuning" rule. No PNGs committed (avoids a false-green).
- `e2e/target-size.spec.ts` — added a seeded coarse-pointer chart-tap-rect ≥44px describe block (DailyReturnsHeatmap + StreakDistribution); existing UNSEEDED /security case byte-identical.
- `.github/workflows/ci.yml` — added both new specs to the MA-8 seeded list (FLOW-01 place 1); dead spec retained; inline dual-placement comment.

## Decisions Made

See `key-decisions` frontmatter. Headline: the parity goldens + chart-tap-rect case target `/factsheet/[id]/v2` (the verified FactsheetView mount route), NOT the plan's literal `/strategy/[id]/v2` — which import-tracing proved renders a different panel family whose only in-scope charts the seed data-suppresses; using the literal route would have baked a vacuous/empty golden (a false-green). No placeholder golden PNGs were committed because the seed env is absent locally; the spec self-skips, is FLOW-01 wired, and a README documents the bake flow.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the snapshot/target-size route from `/strategy/[id]/v2` to `/factsheet/[id]/v2`**
- **Found during:** Task 1 (tracing where the in-scope panels actually mount)
- **Issue:** The plan's `<action>` + `<key_links>` name `/strategy/[id]/v2?strategy_v2=on` (inherited from the dead Recharts spec + research). Import-tracing showed `/strategy/[id]/v2` renders `StrategyV2Shell` (OverviewPanel / HeadlineMetricsPanel / DrawdownPanel / ReturnsDistributionPanel / RollingMetricsPanel / TradeAndPositionPanel / ExposureAndGreeksPanel) — a SEPARATE panel family. The Phase-47 in-scope hand-rolled SVG panels modified in Plans 02/03 (StreakDistribution, BootstrapCI, EndOfYear, Quantile, Correlation×2, Histogram, MasterBrush, DailyReturnsHeatmap) mount via `FactsheetView`, served by `/factsheet/[id]/v2` (and `/discovery/[slug]/[strategyId]`). Worse, the only in-scope charts `/strategy/[id]/v2` WOULD render (DailyHeatmap + ReturnQuantiles via ReturnsDistributionPanel) are data-suppressed by `seedStrategyWithHistory` (`return_quantiles: null`; `daily_returns_grid` never seeded → DailyHeatmap empty sub-banner). Capturing goldens on the literal route would have produced empty/sub-banner screenshots — a false-green.
- **Fix:** Targeted `/factsheet/[id]/v2` (published-gated; the seed sets `status:"published"`) where the panels actually render with the seed's `returns_series`-derived payload; anchored on each panel's `role="img"` + aria-label.
- **Files modified:** `e2e/svg-chart-parity.spec.ts`, `e2e/target-size.spec.ts` (both documented inline)
- **Commit:** `3723ebbf` (Task 1), `89f6d67d` (Task 2)

**2. [Rule 2 - Missing critical functionality] pointer:coarse emulation for the tap-rect gate**
- **Found during:** Task 2 (measuring the Plan-03 coarse hit-rects)
- **Issue:** The Plan-03 tap targets are `hidden pointer-coarse:block` rects / `pointer-coarse:min-h-[44px]` div — they are `display:none` / un-floored on Playwright's default Desktop Chrome (pointer:fine). A target-size gate run on a fine-pointer context would measure them as 0x0 → skipped → the `assertTargetSizes` "≥1 measured" false-green guard would fire (or measure the wrong layer). Without emulating coarse pointer the gate could not honestly assert the touch hit-rect.
- **Fix:** `test.use({ hasTouch:true, isMobile:true })` makes Chromium report `pointer: coarse`, activating the tap-target layer so the gate measures the real ≥44px touch surface.
- **Files modified:** `e2e/target-size.spec.ts` (documented inline)
- **Commit:** `89f6d67d` (Task 2)

**3. [Rule 3 - Blocking] Added `target-size.spec.ts` to the MA-8 seeded list too**
- **Found during:** Task 3 (ensuring the seeded chart case actually runs seeded)
- **Issue:** `target-size.spec.ts` was only in the UNSEEDED ci.yml list (~L1059). The new SEEDED chart-tap-rect cases self-skip in the unseeded run (HAS_SEED_ENV false), so without a MA-8 entry they would never execute — the FLOW-01 silent-skip trap.
- **Fix:** Added `target-size.spec.ts` to the MA-8 seeded list; its unseeded /security case keeps running via the existing unseeded entry. Documented inline.
- **Files modified:** `.github/workflows/ci.yml`
- **Commit:** `e0773989` (Task 3)

**Total deviations:** 3 auto-fixed (1 bug, 1 missing-critical, 1 blocking). No architectural escalations (Rule 4). The route correction is the substantive one — it is the difference between a real verification and a vacuous golden.

## TDD Gate Compliance

Plan type is `execute` (not a plan-level `tdd` gate); no task carries `tdd="true"`. Tasks 1–2 are `test(...)` commits (the verification artifacts themselves); Task 3 is `ci(...)`. The falsifiability of the parity goldens is structural: a desktop-golden diff is a recompute alarm (the intended RED), and the spec's fail-loud anchors mean a blank/empty page fails rather than passing vacuously. No gate-sequence warning applies.

## Authentication Gates

None. `/factsheet/[id]/v2` is published-gated (RLS readable for published strategies) — the seed's `status:"published"` strategy renders without a login. The seed env (`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`) is the CI repo-var path, not an interactive auth gate.

## Issues Encountered

- **Seed env absent locally** (verified: both vars unset, no `.env.local` entry). Per the locked critical constraint, no goldens could be honestly baked here without fabricating false-green PNGs. Resolution: the spec self-skips (verified 2 skipped, no false pass), is FLOW-01 wired, and the README documents the bake-on-first-seeded-CI flow. This is the intended deferral, not a defect.

## User Setup Required

None — no external service configuration. Zero net-new npm dependencies (locked constraint).

## Next Phase Readiness

- **FLOW-01 "prove it RAN" follow-up (for the verifier):** the two new gates EXIST + are wired + self-skip cleanly locally. The remaining proof — that `e2e/svg-chart-parity.spec.ts` and the seeded `target-size.spec.ts` chart cases EXECUTE (passed, not skipped) in a real CI run with `vars.E2E_TEST_DB_CONFIGURED == 'true'` — happens on the first seeded CI run, which ALSO bakes + commits the missing goldens (`--update-snapshots`, desktop-first). The verifier should confirm the specs show "passed" (not "skipped") in the seeded MA-8 job log and that desktop goldens were committed (the JOURNEY-03 lesson).
- **Goldens to bake on first seeded run:** `*-desktop.png` FIRST (review diff, commit), THEN `*-portrait-320.png` (Pitfall 2). Never `--update-snapshots` a desktop golden after a tuning change.
- No blockers. Frozen-math boundary untouched (Plan 05 changes only e2e/ + ci.yml; source tree clean; SCENARIO-05 / BODY-02 / metrics-parity green; coverage ratchet held un-lowered).

## Known Stubs

None. The empty `e2e/__snapshots__/svg-chart-parity.spec.ts/` (README only, no PNGs) is a DELIBERATE, documented deferral (goldens bake on the first seeded CI run), not a stub — committing placeholder PNGs would be the false-green the critical constraint forbids. The README names exactly when + how the goldens bake.

## Threat Flags

None. Plan 05 introduces no network endpoint, auth path, file-access pattern, or schema change. It adds two e2e specs (read-only renders of an already-authorized published-strategy payload) + two static spec paths in the ci.yml playwright list. The threat register's mitigations are satisfied: T-47-05-INTEG (desktop goldens are the byte-identity record; SCENARIO-05/BODY-02/compute.ts parity green un-weakened), T-47-05-FALSEGREEN (FLOW-01 dual-wired; self-skip only when seed env absent; fail-loud anchors), T-47-05-RATCHET (coverage thresholds un-lowered, exit 0).

## Self-Check: PASSED

- FOUND: e2e/svg-chart-parity.spec.ts
- FOUND: e2e/__snapshots__/svg-chart-parity.spec.ts/README.md
- FOUND: e2e/target-size.spec.ts
- FOUND: .github/workflows/ci.yml
- FOUND: .planning/phases/47-hand-rolled-svg-charts-touch-legibility-portrait/47-05-SUMMARY.md
- FOUND commit: 3723ebbf (Task 1 — fresh svg-chart-parity spec)
- FOUND commit: 89f6d67d (Task 2 — extended target-size gate)
- FOUND commit: e0773989 (Task 3 — FLOW-01 ci.yml wiring)
- Coverage ratchet exit 0: lines 84.85 / stmts 82.68 / fns 78.66 / branches 75.33 (all ≥ 82/80/74/72; none lowered)
- SCENARIO-05 (phase-31-frozen-spine-guards) 5/5; metrics-parity + 3 BODY-02 FactsheetBody guards 44/44 green
- New spec self-skips with no seed env (2 skipped, no false-green); dead strategy-v2-chart-parity.spec.ts unchanged; MIN_TARGET_PX=44 un-lowered
- ci.yml: svg-chart-parity.spec.ts + target-size.spec.ts in MA-8 list; dead spec retained; YAML valid

---
*Phase: 47-hand-rolled-svg-charts-touch-legibility-portrait*
*Completed: 2026-06-28*
