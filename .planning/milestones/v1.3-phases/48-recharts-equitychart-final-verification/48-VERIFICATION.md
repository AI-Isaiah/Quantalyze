---
phase: 48-recharts-equitychart-final-verification
verified: 2026-06-28T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Recharts tap-to-pin on a real phone — Line, Bar, Pie families (authed)"
    expected: "On iOS Safari + Android Chrome signed in as an allocator: tapping a Recharts chart point reveals AND pins the tooltip (trigger=click on mobile); tooltip stays active after finger-lift; tapping a different position moves the reveal. Desktop hover path byte-identical (trigger=hover)."
    why_human: "Headless browsers cannot hydrate authed pages on this project (reference_browse_no_hydrate_authed). The TouchTooltip trigger unit test proves the ternary is correct; the real-device tap confirms the Recharts runtime honors trigger=click ergonomically."
  - test: "EquityChart tap-pin on a real phone — reveal, pin, re-tap toggle, ≥44px ergonomics"
    expected: "On the Overview EquityChart: tapping the curve reveals AND pins the crosshair+dot+value; the pin survives finger-lift (pointerleave); a re-tap within ~3 indices toggles the pin off; tapping elsewhere moves the pin; no auto-dismiss timer. Hit-area feels comfortable at the coarse ≥44px floor."
    why_human: "useTapPin render-level tests (EquityChart.touch.test.tsx) probe the hook wiring against a synthetic JSDOM; real-device confirms the pointer-event semantics work ergonomically with iOS/Android touch stacks."
  - test: "No horizontal overflow at 320px on a real narrow phone (authed surfaces)"
    expected: "On /allocations and every tab, the onboarding wizard, and /security at a 320px viewport: no horizontal page scrollbar, no clipped content. Charts, tables, and EquityChart all reflow."
    why_human: "Automated reflow-sweep-authed and all-columns guards prove scrollWidth geometry headlessly; on-glass confirmation rules out any device-specific font-metric or viewport meta edge case."
  - test: "No ResizeObserver-loop console error + stable memory on rotate (authed)"
    expected: "Rotating portrait->landscape->portrait on /allocations produces no 'ResizeObserver loop completed with undelivered notifications' console error and no runaway memory growth across repeated rotations."
    why_human: "Automated rotate-stability assertion in reflow-sweep-authed.spec.ts asserts this headlessly. Real-device confirmation rules out hardware-accelerated rotation timing differences that JSDOM and Playwright viewport-resize cannot replicate."
---

# Phase 48: Recharts / EquityChart Final Verification

**Phase Goal:** Close out the most-touched, touch-weakest, highest-regression-risk chart family (19 Recharts files + the 2277-LOC live-book EquityChart) with touch parity — informed by the SVG pass and NOT a rewrite — then make "v1.3 done" falsifiable with the combined app-wide gate matrix, a mobile performance budget, and a real-device authed sign-off.

**Verified:** 2026-06-28
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 18 Recharts charts route mobile taps through `TouchTooltip` (`trigger="click"`) and keep desktop as `trigger="hover"` | VERIFIED | `grep -l "TouchTooltip"` returns all 18 target files; each has 2 occurrences (import + JSX). `TouchTooltip.tsx` L36: `const trigger = useBreakpoint() === "mobile" ? "click" : "hover"`. 4/4 unit tests pass. |
| 2 | `EquityChart` tap-to-pin is wired via `useTapPin` with `epochIndexFromPx` shared helper and pin-first reveal precedence (`tap.selectedIdx ?? hoverIdx`) | VERIFIED | `EquityChart.tsx` L1238: `const reveal = tap.selectedIdx ?? hoverIdx`. 8 `useTapPin` occurrences, 13 `epochIndexFromPx` occurrences. L1506: `pointer-coarse:min-h-[44px]`. L1509: `ref={tap.setChartEl}`. 7/7 touch tests pass (including 2 render-level integration tests added in WR-02 fix). |
| 3 | App-wide axe WCAG-AA CI gate covers all primary routes, dual-wired into both seeded and unseeded CI lists (FLOW-01) | VERIFIED | `e2e/axe-app-wide.spec.ts` has 20 tests. `grep "axe-app-wide" .github/workflows/ci.yml` returns 4 lines: L1068 comment, L1073 unseeded entry, L1280 seeded MA-8 entry, L1293 comment. 10/10 public unseeded tests PASS; 10 seeded/authed tests self-skip correctly without `HAS_SEED_ENV`. |
| 4 | Mobile perf budget is enforced by a blocking `lighthouse-mobile` CI job (`lighthouserc.json`, `minScore: 0.60`, `formFactor: "mobile"`, no `TEST_SUPABASE_*` secrets) | VERIFIED | `lighthouserc.json`: `formFactor: mobile`, no invalid `preset`, `minScore: 0.60`, 5 public URLs. `grep "lighthouse-mobile" .github/workflows/ci.yml` returns 6 lines including job definition and aggregator `needs:`. `grep "TEST_SUPABASE" lighthouse-mobile` job section: 0 matches (only 2 security-rationale comments). |
| 5 | All automated phase-gate guards held un-weakened: coverage ratchet, frozen-spine, accessibilityLayer grep, svg-chart-parity self-skips | VERIFIED | `npm run typecheck` exits 0. `npm run lint` exits 0, 0 errors. `npm run test:coverage` exits 0; actuals: Lines 84.99 / Stmts 82.83 / Fns 78.71 / Branches 75.47 — all above thresholds 82/80/74/72. Frozen-spine: 5/5 pass. accessibilityLayer: 2/2 pass. svg-chart-parity: self-skips loudly (no false-green goldens). |

**Score:** 5/5 truths verified (automated portion)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/charts/TouchTooltip.tsx` | Mobile/desktop trigger ternary via `useBreakpoint()` | VERIFIED | Exists, 47 lines, L36 trigger ternary, L37-40 JSX return — substantive, no stubs |
| `src/components/charts/TouchTooltip.test.tsx` | 4 tests: mobile→click, desktop→hover, tablet→hover, props-spread | VERIFIED | 4/4 pass; TS2322 fixed in `4c2c2e9e` (typecheck exits 0 cleanly) |
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` | `useTapPin` wired, `epochIndexFromPx` shared, pin-first reveal, ≥44px coarse, callback ref | VERIFIED | 8 `useTapPin`, 13 `epochIndexFromPx`, L1238 `tap.selectedIdx ?? hoverIdx`, L1506 `pointer-coarse:min-h-[44px]`, L1509 `ref={tap.setChartEl}`, L1517 `onPointerDown={tap.onPointerDown}` |
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.touch.test.tsx` | Touch parity + render-level integration tests; 0 `it.todo` | VERIFIED | 7 tests total (5 parity + 2 render-level added for WR-02); 0 `it.todo`; 4 `nearestIndex` references |
| `e2e/axe-app-wide.spec.ts` | 20 tests: 5 public routes × 2 viewports (strict) + seeded rows + serious+critical embedded | VERIFIED | 20 tests confirmed; `buildAxe` shared harness; no inline rule disables; 10 public pass / 10 seeded self-skip |
| `e2e/target-size.spec.ts` | EquityChart ≥44px coarse-pointer case with `seedAllocatorBook` fixture | VERIFIED | 5 occurrences of `/allocations`; `seedAllocatorBook` present |
| `e2e/reflow-sweep-authed.spec.ts` | Rotate-stability assertion (RO-loop string + heap bounds) | VERIFIED | 6 occurrences of "ResizeObserver loop"; rotate sequence 375×812 → 812×375 confirmed |
| `lighthouserc.json` | `formFactor: "mobile"`, `minScore: 0.60`, 5 public URLs, no `preset` (invalid in LH 12) | VERIFIED | `formFactor: mobile`, `preset: NOT SET`, `minScore: 0.6`, 5 URLs (`/`, `/security`, `/for-quants`, `/browse`, `/demo`), `numberOfRuns: 3` |
| `.github/workflows/ci.yml` (lighthouse-mobile job) | Blocking job, restores build artifact, no `TEST_SUPABASE_*` secrets | VERIFIED | 6 occurrences of `lighthouse-mobile` including job def + aggregator `needs:`; secrets section clean |
| `.planning/phases/48-recharts-equitychart-final-verification/48-HUMAN-UAT.md` | `human_needed` status, 5 pending items | VERIFIED | Exists; `status: partial`; `verification status: human_needed`; 5 pending items; 0 passed |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| 18 Recharts chart files | `TouchTooltip` | `import` + JSX `<TouchTooltip` | VERIFIED | All 18 files: 2 occurrences each (import + usage). `Tooltip` removed from recharts imports where no longer needed. |
| `TouchTooltip` | `useBreakpoint()` | L36 trigger ternary | VERIFIED | `useBreakpoint() === "mobile" ? "click" : "hover"` — SSR-safe two-pass hook |
| `EquityChart` | `useTapPin` | import + `tap.setChartEl`, `tap.onPointerDown`, `tap.selectedIdx` | VERIFIED | 8 `useTapPin` occurrences including callback ref, pointer handler, and selectedIdx access |
| `EquityChart` | `epochIndexFromPx` | shared pure helper, 13 call sites | VERIFIED | Desktop `handleMove` and touch `pointerToIndex` both use `epochIndexFromPx` — parity-by-construction |
| `axe-app-wide.spec.ts` | `ci.yml` unseeded list | FLOW-01 dual-wire | VERIFIED | L1073 unseeded entry present |
| `axe-app-wide.spec.ts` | `ci.yml` seeded MA-8 list | FLOW-01 dual-wire | VERIFIED | L1280 seeded entry present |
| `lighthouserc.json` | `lighthouse-mobile` CI job | `npx lhci autorun` + artifact restore | VERIFIED | Job restores `nextjs-build` artifact, runs `npx lhci autorun`, 0 `TEST_SUPABASE_*` secrets |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `TouchTooltip.tsx` | `trigger` | `useBreakpoint()` SSR-safe two-pass hook | Yes — reads `matchMedia("(max-width:639px)")` at runtime | FLOWING |
| `EquityChart.tsx` | `tap.selectedIdx` | `useTapPin` pointer events on real `<svg>` DOM element | Yes — `epochIndexFromPx` binary-search against real `projection.timestamps` | FLOWING |
| `EquityChart.tsx` | `reveal` | `tap.selectedIdx ?? hoverIdx` — pin-first precedence | Yes — one operand is always the live pointer-event result | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly (TS2322 fixed) | `npm run typecheck` | exit 0 | PASS |
| Lint clean (0 errors) | `npm run lint` | 0 errors, exit 0 | PASS |
| Coverage ratchet held | `npm run test:coverage` | Lines 84.99 / Stmts 82.83 / Fns 78.71 / Branches 75.47 (thresholds: 82/80/74/72) | PASS |
| TouchTooltip unit tests | `npx vitest run src/components/charts/TouchTooltip.test.tsx` | 4/4 pass | PASS |
| accessibilityLayer grep guard | `npx vitest run tests/visual/chart-accessibility-layer.test.ts` | 2/2 pass | PASS |
| Frozen-spine math guard | `npx vitest run src/__tests__/phase-31-frozen-spine-guards.test.ts` | 5/5 pass | PASS |
| EquityChart touch tests | `npx vitest run src/app/(dashboard)/allocations/widgets/performance/EquityChart.touch.test.tsx` | 7/7 pass | PASS |
| Full EquityChart suite | `npx vitest run .../EquityChart` (all test files) | 91/91 pass | PASS |
| Public axe unseeded | `npx playwright test e2e/axe-app-wide.spec.ts` (no seed) | 10/10 pass; 10 seeded rows self-skip | PASS |
| svg-chart-parity self-skips | `npx playwright test e2e/svg-chart-parity.spec.ts` | Self-skips loudly (no goldens baked) — NOT false-green | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files exist for this phase. Phase 48 is a verification/gate phase with all checks expressed as CI jobs and vitest suites, not standalone probe scripts.

---

### Requirements Coverage

| Requirement | Phase | Description | Status | Evidence |
|-------------|-------|-------------|--------|----------|
| CHART-01b | 48 | Every Recharts chart + EquityChart touch-inspectable on phone via explicit tap-to-show/tap-to-pin | SATISFIED | All 18 charts use `TouchTooltip`; `EquityChart` uses `useTapPin` with pin-first reveal; human real-device sign-off is the designed final gate (SC#5) |
| A11Y-01 | 48 | App-wide axe WCAG-AA gate covers all primary routes in CI, FLOW-01 dual-wired | SATISFIED | `axe-app-wide.spec.ts` 20 tests; dual-wired at L1073 (unseeded) and L1280 (seeded) in ci.yml; 10/10 public pass; 4 public routes remediated (commits `bff634e0`–`fbbfc252`) |
| A11Y-03 | 48 | Mobile perf budget: `@lhci/cli` + Lighthouse-mobile CI job, thresholds seeded from baseline | SATISFIED | `@lhci/cli@0.15.1` pinned in package.json; `lighthouserc.json` `minScore: 0.60` (7pts below measured /demo floor 0.67); `lighthouse-mobile` blocking CI job; `formFactor: "mobile"` with explicit screenEmulation (not invalid `preset: "mobile"`) |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `EquityChart.tsx` | (WR-03) | `setPointerCapture` called for mouse events (not just touch) | INFO | Acceptable: try/catch guarded; matches Phase 47 `useTapPin` pattern; mouse events do not have meaningful pointer capture semantics but the guard prevents any throw |

**Note — Review findings disposition:**
- WR-01 (reveal precedence inverted `hoverIdx ?? selectedIdx`): FIXED in commit `e3c156aa` → now correctly `tap.selectedIdx ?? hoverIdx` at L1238
- WR-02 (no render-level integration test for useTapPin wiring): FIXED in commit `e3c156aa` → 2 render-level tests added to `EquityChart.touch.test.tsx`
- WR-03 (setPointerCapture on mouse events): ACCEPTED WARNING — not a blocker, try/catch guarded, no user-visible impact

No `TBD`, `FIXME`, or `XXX` markers found in Phase 48 modified files (debt-marker gate: PASS).

---

### Human Verification Required

These items are DESIGNED deferrals — all automated contracts underneath are fully in place and green. The headless browser on this project cannot hydrate authed pages (`reference_browse_no_hydrate_authed`), so the authed tap-to-pin ergonomics require a physical device.

#### 1. Recharts tap-to-pin on a real phone — Line, Bar, Pie families (authed)

**Test:** On a physical phone (iOS Safari + Android Chrome) signed in as an allocator on `/allocations`: tap a Line chart point → tooltip reveals AND pins AND stays after finger-lift; tap Bar chart → same; tap Pie/donut segment → same. On a laptop, confirm hover still shows/hides on mouse-enter/leave.

**Expected:** `trigger="click"` on mobile pins the tooltip natively; `trigger="hover"` on desktop is byte-identical to pre-phase behavior. For thin bars/small segments, the adjacent KPI-cell value is the documented fallback.

**Why human:** Headless browsers cannot hydrate authed pages on this project. TouchTooltip unit tests prove the ternary; real device confirms Recharts runtime honors `trigger="click"` ergonomically on iOS/Android.

---

#### 2. EquityChart tap-pin on a real phone — reveal, pin, re-tap toggle, ≥44px ergonomics

**Test:** On the `/allocations` Overview tab EquityChart: tap along the equity curve → crosshair+dot+value reveals AND pins; lift finger → pin survives; re-tap same spot (~3 indices) → pin clears; tap far point → pin moves. No auto-dismiss. On a laptop, confirm mouse hover unchanged.

**Expected:** `useTapPin` pointer-event semantics work correctly with iOS/Android touch stacks; ≥44px hit area feels comfortable.

**Why human:** Render-level tests probe the hook against JSDOM; real-device confirms the `pointer-coarse:` CSS and `setPointerCapture` semantics behave correctly on hardware.

---

#### 3. No horizontal overflow at 320px on a real narrow phone (authed)

**Test:** At a 320px-class viewport, open `/allocations` and every tab, the wizard, and `/security`. Confirm no horizontal page scrollbar and no clipped content.

**Expected:** All surfaces reflow cleanly. Charts, tables, and EquityChart reshape without overflow.

**Why human:** Automated `reflow-sweep-authed` + all-columns guards prove scrollWidth geometry headlessly. On-glass confirmation rules out device-specific font-metric or viewport meta edge cases.

---

#### 4. No ResizeObserver-loop console error + stable memory on rotate (authed)

**Test:** With remote-debug console attached, rotate the phone portrait→landscape→portrait on `/allocations` several times. Watch for "ResizeObserver loop completed with undelivered notifications" and unbounded memory growth.

**Expected:** No RO-loop console error. No runaway memory growth. EquityChart stays stable under real orientation changes.

**Why human:** Automated `rotate-stability` fold in `reflow-sweep-authed.spec.ts` asserts this headlessly. Real-device rules out hardware-accelerated rotation timing differences Playwright viewport-resize cannot replicate.

---

### Gaps Summary

No gaps. All 5 must-haves are VERIFIED. The `human_needed` status reflects 4 items that are explicitly DESIGNED deferrals, not implementation failures:

1. Items 1–4 above are real-device authed walkthroughs that headless cannot execute (per documented project limitation). The automated contracts underneath each item are fully green: TouchTooltip trigger tests, useTapPin render-level tests, app-wide axe matrix, target-size gate, reflow-sweep, rotate-stability, lighthouse-mobile budget, frozen-spine, accessibilityLayer, and coverage ratchet.

2. The 8 seeded CI axe rows (`HAS_SEED_ENV`-gated) and the `lighthouse-mobile` CI job first run are proven locally (public axe 10/10 pass; lighthouserc.json values seeded from a measured baseline) but require a real seeded CI environment to produce the CI-run proof. These are the same class of "CI run = human/environment proof" that applies across the v1.3 milestone.

All pre-review warnings (WR-01 reveal precedence, WR-02 missing render-level integration tests) were fixed before this verification ran. No debt markers, no placeholder returns, no orphaned artifacts.

---

_Verified: 2026-06-28_
_Verifier: Claude (gsd-verifier)_
