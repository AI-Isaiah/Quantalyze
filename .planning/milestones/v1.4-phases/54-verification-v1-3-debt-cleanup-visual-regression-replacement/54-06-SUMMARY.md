---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 06
subsystem: testing
tags: [playwright, e2e, axe, reflow, visual-regression, toHaveScreenshot, wcag, ultra-wide, 2560, golden-pending]

# Dependency graph
requires:
  - phase: 52-allocator-journey
    provides: "the 2560 ultra-wide authed reflow block (reflow-sweep-authed.spec.ts:289-354) and the deferred svg-chart-parity golden harness this plan folds the 2560 rows into"
  - phase: 48-mobile-adaptive
    provides: "the axe VIEWPORTS matrix + the public/authed reflow sweep scaffolding extended to 2560 here"
provides:
  - "2560 ultra-wide row in the axe VIEWPORTS matrix (fans every public/authed/embedded scan to 2560)"
  - "App-wide 2560 reflow sweep — public unseeded describe + authed additive-fold (all allocator-reachable routes, no /admin)"
  - "2560 svg-chart-parity tolerance goldens, green-by-skip via the WR-02 golden-pending guard (bake deferred)"
affects: [54-08-VERIFY-02, milestone-v1.4-close, future-golden-bake]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "VERIFY-01 matrix-row widening: one VIEWPORTS const entry fans out to every for-loop-iterated scan (axe) without per-loop edits"
    - "Additive-fold (Pattern 2): a 2560 describe/test inside an already-MA-8-wired + HAS_SEED_ENV-gated host spec needs NO new FLOW-01 wiring"
    - "Green-by-skip tolerance goldens: a new toHaveScreenshot test inside the WR-02-guarded describe inherits the golden-pending skip — lands green without baking PNGs"

key-files:
  created: []
  modified:
    - "e2e/axe-app-wide.spec.ts — third VIEWPORTS entry { w: 2560, h: 1440, name: 'ultrawide' }"
    - "e2e/reflow-sweep.spec.ts — new UNSEEDED public 2560 ultra-wide describe over PUBLIC_ROUTES"
    - "e2e/reflow-sweep-authed.spec.ts — ULTRAWIDE_ROUTES widened from the allocator subset to the app-wide allocator-reachable set"
    - "e2e/svg-chart-parity.spec.ts — new 2560 ultra-wide tolerance-golden test (per-panel 0.02 / full-page 0.05 / threshold 0.2), green-by-skip"
    - "e2e/__snapshots__/svg-chart-parity.spec.ts/README.md — documents the *-ultrawide-2560.png goldens + the step-3 bake command"

key-decisions:
  - "Authed/embedded axe 2560 rows stay HAS_SEED_ENV-gated (NOT un-skipped here) — un-skipping into the seeded MA-8 job is VERIFY-02's work in Plan 54-08; this plan only widens the matrix the public rows run at."
  - "ULTRAWIDE_ROUTES widened to all /allocations tabs + both wizard entries + authed /security + /compare — the same freshly-seeded-allocator reachability the 320px AUTHED_ROUTES sweep already proves; /admin excluded (role-redirect false-green), /discovery/[slug] omitted (needs a bridge seed for a stable anchor)."
  - "svg 2560 golden landed as a test INSIDE the existing WR-02-guarded describe so it inherits both describe-level skips (HAS_SEED_ENV + golden-pending) — green-by-skip with zero extra guard wiring. NO PNGs committed, NO --update-snapshots run (54-CONTEXT Out-of-Scope lock)."

patterns-established:
  - "Matrix-row widening over for-loop-iterated VIEWPORTS const (axe) — one row, every scan"
  - "Additive-fold into an already-wired seeded host spec — no new FLOW-01 wiring"
  - "WR-02 green-by-skip for tolerance goldens — bake is a deliberate deferred CI commit, never a blind --update-snapshots"

requirements-completed: [VERIFY-01, VERIFY-04]

# Metrics
duration: ~25min
completed: 2026-06-30
---

# Phase 54 Plan 06: Ultra-wide (2560) axe/reflow rows + tolerance-golden harness Summary

**Added the 2560px ultra-wide row to the axe VIEWPORTS matrix and the public+authed reflow sweep app-wide (VERIFY-01), and landed the svg-chart-parity 2560 tolerance goldens green-by-skip via the WR-02 golden-pending guard — bake deferred, no PNGs committed (VERIFY-04).**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-30
- **Completed:** 2026-06-30
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- VERIFY-01 (axe): one `{ w: 2560, h: 1440, name: "ultrawide" }` VIEWPORTS entry fans every public/authed/embedded axe scan out to 2560 via the three existing for-loops. The 5 public ultrawide rows run unseeded today (inheriting the visible-anchor + HTTP<400 guards); the authed/embedded ultrawide rows stay HAS_SEED_ENV-gated for VERIFY-02 (Plan 54-08).
- VERIFY-01 (reflow): a new UNSEEDED public 2560 describe over PUBLIC_ROUTES (5 routes) + the authed ULTRAWIDE_ROUTES widened from the Phase-52 allocator subset (4 routes) to the app-wide allocator-reachable set (11 routes: all /allocations tabs + both wizard entries + authed /security + /compare). Admin excluded (covered by the static 54-03 test).
- VERIFY-04 (goldens): a new "ultra-wide 2560px" toHaveScreenshot test with the documented tolerances (per-panel maxDiffPixelRatio 0.02 / full-page 0.05 / threshold 0.2), landed green-by-skip — it inherits the describe-level HAS_SEED_ENV + WR-02 golden-pending guards, so it self-skips loudly until a deliberate bake. Verified `1 skipped` locally; 0 PNGs committed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the 2560 row to the axe VIEWPORTS matrix** - `74c06ed5` (test)
2. **Task 2: App-wide 2560 reflow sweep (public unseeded + authed additive-fold)** - `9a8bdf25` (test)
3. **Task 3: Land the tolerance-golden specs green-by-skip (VERIFY-04)** - `afe9c41e` (test)

## Files Created/Modified
- `e2e/axe-app-wide.spec.ts` - Third VIEWPORTS entry (`ultrawide` 2560×1440); the three for-loops fan it out automatically.
- `e2e/reflow-sweep.spec.ts` - New UNSEEDED `reflow sweep @ 2560px ultra-wide — public` describe over PUBLIC_ROUTES.
- `e2e/reflow-sweep-authed.spec.ts` - ULTRAWIDE_ROUTES widened to the app-wide allocator-reachable set (no /admin, no /discovery/[slug]); the host describe stays HAS_SEED_ENV-gated.
- `e2e/svg-chart-parity.spec.ts` - New `ultra-wide 2560px: per-panel tolerance goldens + full page` test inside the WR-02-guarded describe (green-by-skip).
- `e2e/__snapshots__/svg-chart-parity.spec.ts/README.md` - Documents the `*-ultrawide-2560.png` goldens + the step-3 bake command (still deferred).

## CI Wiring (FLOW-01)

No new FLOW-01 wiring was needed — every edit is an additive fold into an already-wired spec:
- **Public 2560 axe + reflow rows** ride the existing ci.yml UNSEEDED list (`… e2e/reflow-sweep.spec.ts e2e/axe-app-wide.spec.ts …`, ci.yml:1073).
- **Authed 2560 reflow rows** ride the existing seeded MA-8 list entry for `e2e/reflow-sweep-authed.spec.ts` (ci.yml:1279) — the host describe is already HAS_SEED_ENV-gated.
- **2560 svg goldens** ride the existing seeded MA-8 list entry for `e2e/svg-chart-parity.spec.ts` (ci.yml:1280) — the describe is already HAS_SEED_ENV + WR-02 gated.
- The axe authed/embedded 2560 rows remain dormant (HAS_SEED_ENV self-skip); wiring `axe-app-wide.spec.ts` into the seeded MA-8 list is deliberately left to VERIFY-02 (Plan 54-08), which owns the hermetic-seeding + teardown work the ci.yml:1293-1309 comment describes.

## Decisions Made
- **Axe authed/embedded 2560 rows NOT un-skipped here** — that is VERIFY-02 (Plan 54-08). This plan widens the matrix only; the public rows go live, the authed/embedded rows stay gated.
- **Authed ULTRAWIDE_ROUTES set** — extended to exactly the routes a bare `seedTestAllocator` reliably renders with a stable visible anchor (the 320px AUTHED_ROUTES reachability set): the seven `/allocations` tabs, both wizard entries (`#wizard-connect-key-heading` / `#wizard-csv-upload-heading`), authed `/security` (`main h1`), and `/compare` (empty-selection `h1`). `/discovery/[slug]` omitted because without a `seedBridgeCandidate` it hits a category empty-state, not a stable content layout. `/admin` excluded per the documented role-redirect false-green rationale (covered by the static `admin-width.test.tsx` from Plan 54-03).
- **Green-by-skip implementation** — the 2560 golden is a test inside the existing WR-02-guarded describe, so it inherits both describe-level `test.skip` guards. No PNGs baked, no `--update-snapshots` run.

## Deviations from Plan

None - plan executed exactly as written.

The plan's Task 3 left the desktop + 320px golden viewports as-is and added the 2560 row; both desktop and 320px rows were already present, so the 2560 row extends (not replaces) the existing coverage, exactly as the action specified ("Add a 2560 toHaveScreenshot row/describe ... mirroring the existing desktop+320px rows").

## Issues Encountered
None. The @container 2560 trap (RESEARCH Pitfall 3) did not surface as a finding — the new 2560 reflow rows self-skip locally (no dev server / no seed env), so any real same-element host/variant overflow would surface on the next seeded CI run, where the runtime `assertNoReflow` (browser-measured `documentElement.scrollWidth`) catches what jsdom class-string tests false-pass. No slop was widened.

## Known Stubs
None. The tolerance goldens are intentionally un-baked (green-by-skip via the WR-02 guard) — this is a CONTEXT-locked deferral, not a stub: the bake is a deliberate, reviewed per-chart CI commit (`--update-snapshots` is the explicit Out-of-Scope ban). The WR-02 guard flips the gate live automatically the moment PNGs land, with no spec edit.

## Self-Check: PASSED

- Files (all FOUND): `e2e/axe-app-wide.spec.ts`, `e2e/reflow-sweep.spec.ts`, `e2e/reflow-sweep-authed.spec.ts`, `e2e/svg-chart-parity.spec.ts`, `e2e/__snapshots__/svg-chart-parity.spec.ts/README.md`
- Commits (all FOUND): `74c06ed5`, `9a8bdf25`, `afe9c41e`
- 2560 present in all 4 specs; 0 PNGs in the golden dir (green-by-skip); `tsc --noEmit` clean; eslint clean on all 4 specs; the 2560 golden test runs `1 skipped` locally (green-by-skip confirmed).

## Requirement Status (honest, not over-claimed)

This plan's frontmatter lists `requirements: [VERIFY-01, VERIFY-04]`, but neither REQUIREMENTS.md row is marked fully complete here — both have acceptance criteria that span beyond this plan, so they are left **Pending** (CLAUDE.md Rule 12 — fail loud, do not silently claim done):

- **VERIFY-01** — the 2560 row is added to the axe + reflow matrix (this plan's deliverable, DONE). But the requirement's full acceptance ("green app-wide ... the deferred Phase-52 canaries run and pass") additionally needs (a) the axe authed/embedded 2560 rows un-skipped into the seeded MA-8 job — that is VERIFY-02's work in Plan 54-08 — and (b) a green seeded CI run that actually exercises the new authed 2560 reflow + the public 2560 rows. Those run-and-pass on the next seeded CI run, not locally.
- **VERIFY-04** — the tolerance-golden harness is landed (desktop + 320px + 2560, masking/determinism inherited from playwright.config.ts) and lands green-by-skip. But the requirement's "deliberate per-chart re-baseline" (the actual bake) is CONTEXT-locked as deferred, so byte-identity is not yet *replaced* in CI until the bake commit lands. The harness is the enabling deliverable; the bake is the closing step.

The REQUIREMENTS.md VERIFY-01 / VERIFY-04 rows therefore stay **Pending** until 54-08 + the seeded CI run (VERIFY-01) and the deliberate golden bake (VERIFY-04) close them.

## Next Phase Readiness
- VERIFY-01 (2560 row, app-wide axe + reflow) and VERIFY-04 (tolerance goldens, golden portion) are met for ROADMAP success criteria 1 + 4.
- Plan 54-08 (VERIFY-02) is unblocked: it owns un-skipping the axe authed/embedded 2560 rows into the seeded MA-8 job + the discovery-hide-examples-default teardown the ci.yml comment describes.
- The golden bake remains deferred (deliberate, reviewed CI commit) — no blocker for milestone progress.

---
*Phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement*
*Completed: 2026-06-30*
