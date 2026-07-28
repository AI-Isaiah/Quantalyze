---
phase: 44-foundation-primitives-verification-gates
verified: 2026-06-27T14:38:00Z
status: human_needed
score: 4/4 must-haves verified (all locally verifiable checks pass; one post-push CI proof outstanding)
overrides_applied: 0
human_verification:
  - test: "Confirm both e2e/reflow.spec.ts and e2e/target-size.spec.ts show 'passed' (not 'skipped') in the CI e2e job log after this branch's first push"
    expected: "The unseeded Playwright job log lists both spec files with 'N passed' — no skipped entries"
    why_human: "FLOW-01 — a gate added but never executed in CI is a false-green (burned twice in this project). The wiring is verified locally (grep, diff, YAML valid, no HAS_SEED_ENV self-skip), and both specs passed locally against a real dev server (2 passed in 9.3s). But the CI-execution proof can only come from an actual CI run. Capture the run URL and excerpt in 44-04-SUMMARY.md once the branch lands."
---

# Phase 44: Foundation Primitives & Verification Gates — Verification Report

**Phase Goal:** Build the highest-leverage shared responsive primitives ONCE and stand up the bespoke CI
verification gates FIRST, so phases 45–48 are continuously checked at 320px / 400% zoom as they land.
**Verified:** 2026-06-27T14:38:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Playwright reflow spec asserts `scrollWidth <= clientWidth` (≤1px slop) at 320px, anchored on a visible element (fail-loud on blank/404), AND a 44px target-size gate exists; both runnable against any route | VERIFIED | `e2e/helpers/reflow.ts` exports `assertNoReflow` (uses `documentElement.clientWidth`, `slop <= 1`, visible-anchor `toBeVisible` guard) and `assertTargetSizes` (44px bar, `measured > 0` false-green guard). `e2e/reflow.spec.ts` sets 320px viewport, navigates `/security`, calls `assertNoReflow(page, "main h1")`. `e2e/target-size.spec.ts` calls `assertTargetSizes(page, "main h1", 'footer nav[aria-label="Legal"] a')` on a documented clean scope. Neither spec has HAS_SEED_ENV self-skip. Falsifiability proven by executor (probing header links fails target-size; non-existent anchor fails reflow loud). |
| 2 | A zoom-meta source-scan guard fails on `maximum-scale`/`user-scalable=no`/`maximumScale`/`userScalable:false` in src/; root `src/app/layout.tsx` has an explicit zoom-permissive `viewport` export | VERIFIED | `tests/visual/viewport-zoom-meta.test.ts` has all 4 FORBIDDEN patterns (regex literals), scans `src/` only via `walk()`, and has an anti-typo falsifiability test (`it("FORBIDDEN patterns still match…")`) proving no pattern is silently dead. `src/app/layout.tsx` exports `const viewport: Viewport = { width: "device-width", initialScale: 1 }` — no `maximumScale`, no `userScalable`. Guard is in `tests/visual/` (outside `src/` scan scope). 17/17 Vitest tests green. |
| 3 | Primitives exist and are unit-tested: `useBreakpoint` (SSR-safe, 'desktop' server snapshot), `ResponsiveTable` (overflow-x-auto + accessible scroll hint), `ResponsiveChartFrame` (viewBox recipe extracted from TimeSeriesChart without changing its output) | VERIFIED | `useBreakpoint.ts` uses inverse max-width queries; test exercises SSR via `renderToStaticMarkup` (real `getServerSnapshot` path → `'desktop'`) plus all 3 client branches. `ResponsiveTable.tsx` has `overflow-x-auto`, `role="region"`, `aria-label` scroll hint (sr-only span intentionally removed per code-review WR-03 — eliminates double-announcement; ROADMAP says "scroll hint", hint is present via aria-label). `ResponsiveChartFrame.tsx` is a `forwardRef` SVG with verbatim `preserveAspectRatio="xMidYMid meet"`, `block w-full`, aspect-ratio style. `TimeSeriesChart.tsx` imports and uses `ResponsiveChartFrame` at line 573 with all 8 props + 7 handlers; no bare `<svg ref={svgRef}` remains. Adoption-parity test pins the verbatim full className. 17/17 tests pass. |
| 4 | Every new gate wired into CI; coverage ratchet held un-lowered | VERIFIED (locally; CI-execution proof is the human item) | `grep` confirms both specs appear exactly once at ci.yml line 1059 (unseeded list), not in the seed-gated list (1252-1262). No other ci.yml change. `vitest.config.ts` thresholds unchanged: lines 82 / statements 80 / functions 74 / branches 72. Zoom-meta runs in `tests/visual/**` glob (zero ci.yml edit needed). Wiring is correct; FLOW-01 proof requires a real CI run. |

**Score:** 4/4 truths verified (all locally verifiable checks pass)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `e2e/helpers/reflow.ts` | Exports `assertNoReflow` + `assertTargetSizes` | VERIFIED | 166 lines. Exports both functions. `assertNoReflow` uses `documentElement.clientWidth`, `slop <= 1`, `toPass` with retry intervals, visible-anchor guard. `assertTargetSizes` has `measured > 0` guard, 44px bar, scoped selector support. |
| `e2e/reflow.spec.ts` | 320px reflow gate on `/security` H1, no self-skip | VERIFIED | Sets 320px viewport, navigates `/security`, calls `assertNoReflow(page, "main h1")`. No `HAS_SEED_ENV` guard. Unseeded. |
| `e2e/target-size.spec.ts` | 44px gate on documented clean scope, no self-skip | VERIFIED | Scoped to `footer nav[aria-label="Legal"] a` (LegalFooter legal-nav links, `min-h-[44px]` convention). Documented scope + phase 46/48 deferral in spec header. 44px bar not weakened. No HAS_SEED_ENV guard. |
| `.github/workflows/ci.yml` | Both specs in unseeded Playwright list | VERIFIED | Line 1059: `…e2e/reflow.spec.ts e2e/target-size.spec.ts` appended to unseeded list. Each appears exactly once (`grep -c` returns 1 per file). Not in seed-gated list. |
| `tests/visual/viewport-zoom-meta.test.ts` | 4 forbidden patterns + falsifiability test, in `tests/visual/` | VERIFIED | All 4 patterns present as regex literals. Anti-typo falsifiability `it()` added (code-review IN-01). Scans `src/` only. 3 tests, all green. |
| `src/app/layout.tsx` | `export const viewport: Viewport = { width: "device-width", initialScale: 1 }` | VERIFIED | Lines 44-47. `Viewport` imported from `"next"`. No `maximumScale`, no `userScalable`. No hand-written `<meta name="viewport">`. |
| `src/hooks/useBreakpoint.ts` | SSR-safe, 'desktop' server snapshot, thin wrapper over `useMediaQuery` | VERIFIED | `"use client"`. Exports `Breakpoint` type and `useBreakpoint()`. Inverse max-width queries `(max-width: 639px)` and `(max-width: 1023px)`. Imports from `./useMediaQuery`. |
| `src/hooks/useBreakpoint.test.ts` | SSR-render test + all 3 branches | VERIFIED | 5 tests: real SSR via `renderToStaticMarkup` (proves `getServerSnapshot` path → `'desktop'`), all-false client case, mobile, tablet, desktop. |
| `src/components/ResponsiveTable.tsx` | `overflow-x-auto` + accessible scroll hint | VERIFIED | `overflow-x-auto`, `role="region"`, `aria-label` (hint or default), `tabIndex={0}`. No sr-only span (removed by code-review WR-03 fix — eliminates double-announcement). |
| `src/components/ResponsiveTable.test.tsx` | Both hint branches covered | VERIFIED | 3 tests. Default hint branch + custom hint branch (asserts aria-label differs). Double-announce regression guard (`querySelector(".sr-only")` must be null). Children render test. |
| `src/components/ResponsiveChartFrame.tsx` | `preserveAspectRatio="xMidYMid meet"`, `block w-full`, `forwardRef` | VERIFIED | 60 lines. `forwardRef<SVGSVGElement, …>`. Verbatim `preserveAspectRatio="xMidYMid meet"`. className: `` `block w-full ${className ?? ""}`.trim() ``. Style: `aspectRatio`, `maxHeight`, `width: "100%"`, `height: "auto"`, caller style spread last. |
| `src/components/ResponsiveChartFrame.test.tsx` | Byte-identity assertions + adoption-parity | VERIFIED | 6 tests. `viewBox="0 0 880 280"` exact string. `preserveAspectRatio="xMidYMid meet"` exact string. Style keys asserted. Ref forwarding. Passthrough contract (handlers, aria, tabIndex, focusable, role). Adoption-parity test pins the verbatim full className. |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` | Uses `ResponsiveChartFrame`, no bare `<svg ref={svgRef}` | VERIFIED | Line 8: `import { ResponsiveChartFrame }`. Lines 573-591: `<ResponsiveChartFrame ref={svgRef} width={VB_W} height={height} role="img" aria-label={…} aria-describedby={…} tabIndex={0} focusable="true" className="cursor-crosshair touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onPointerMove={…} … />`. `VB_W = 880` unchanged (line 10). `height = config.height ?? 280` unchanged. No bare `<svg ref={svgRef}`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `e2e/reflow.spec.ts` | `e2e/helpers/reflow.ts` | `import { assertNoReflow }` | WIRED | Line 2: `import { assertNoReflow } from "./helpers/reflow"` |
| `e2e/target-size.spec.ts` | `e2e/helpers/reflow.ts` | `import { assertTargetSizes }` | WIRED | Line 2: `import { assertTargetSizes } from "./helpers/reflow"` |
| `e2e/reflow.spec.ts` | `.github/workflows/ci.yml` | Spec name on unseeded playwright line | WIRED | Line 1059. Single occurrence. Not in seed-gated list. |
| `e2e/target-size.spec.ts` | `.github/workflows/ci.yml` | Spec name on unseeded playwright line | WIRED | Line 1059. Single occurrence. Not in seed-gated list. |
| `tests/visual/viewport-zoom-meta.test.ts` | `src/` (scan target) | `walk(SRC_DIR)` + `readFileSync` | WIRED | Scans `src/` recursively, skips `node_modules`/`.next`. File count smoke-check proves walk is non-empty. |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` | `src/components/ResponsiveChartFrame.tsx` | `import { ResponsiveChartFrame }` at line 8 | WIRED | Used at lines 573 and 876. All SVG props forwarded. |
| `src/hooks/useBreakpoint.ts` | `src/hooks/useMediaQuery.ts` | `import { useMediaQuery }` | WIRED | Line 3. Thin wrapper — does not modify `useMediaQuery`. |

### Data-Flow Trace (Level 4)

Not applicable. All new artifacts are pure presentational / structural (no dynamic data rendering — breakpoint hook reads `window.matchMedia`, primitives render caller-supplied children, tests read filesystem). No data-flow analysis needed.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 4 Vitest test files green | `npx vitest run src/hooks/useBreakpoint.test.ts src/components/ResponsiveTable.test.tsx src/components/ResponsiveChartFrame.test.tsx tests/visual/viewport-zoom-meta.test.ts` | 4 files, 17 tests, all passed, 1.19s | PASS |
| Both specs are in ci.yml unseeded list | `grep -c "e2e/reflow.spec.ts" .github/workflows/ci.yml && grep -c "e2e/target-size.spec.ts" .github/workflows/ci.yml` | 1 and 1 (each appears exactly once on line 1059) | PASS |
| No zoom-disabling directives in src/ | Covered by the zoom-meta Vitest test itself (17/17 green) | Guard passes against current `src/` tree | PASS |
| TimeSeriesChart uses ResponsiveChartFrame | `grep -n "ResponsiveChartFrame" src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` | Lines 8, 565, 573, 876 | PASS |

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files declared in any plan; phase delivers library primitives and CI gates, not a runnable CLI or migration script.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| A11Y-02 | 44-01, 44-02, 44-03, 44-04 | Bespoke CI gates covering what axe cannot: 320px reflow, zoom-meta grep guard, 44px target-size measurement | SATISFIED | All four gates/primitives exist, are substantive, and are wired. 17/17 unit tests pass. Both e2e specs pass locally. ci.yml wired. See SC#1–SC#4 verification above. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No `TODO`, `FIXME`, `TBD`, `XXX`, `HACK`, `PLACEHOLDER`, `return null`, bare empty returns found in any new file. | — | — |

**Debt marker gate:** Clean. No unreferenced debt markers in any file modified by this phase.

**Note on ResponsiveTable sr-only divergence:** The PLAN acceptance criterion required `className="sr-only"` on a child span. The implementation uses `aria-label` only (no sr-only span). This is an intentional a11y improvement applied via the post-execution code review (commit `1d57e603`, WR-03 finding: aria-label + identical sr-only child double-announces to screen readers). The ROADMAP SC#3 requires a "scroll hint" — the hint is present via `aria-label`. The test actively guards the no-double-announce behavior. This is NOT a stub or missing implementation; it is a correct deviation from an overly prescriptive PLAN acceptance criterion, applied before phase closure.

### Human Verification Required

#### 1. FLOW-01 CI Execution Proof

**Test:** After this branch's first CI push, open the GitHub Actions run for the e2e job. In the job log, search for `reflow.spec.ts` and `target-size.spec.ts`.

**Expected:** Both spec files appear in the executed list with `N passed` (e.g., "1 passed (9.3s)"). Neither shows as `skipped`. Record the CI run URL and the log excerpt in `44-04-SUMMARY.md` under the "PROVEN-EXECUTION" section.

**Why human:** A gate added but never executed in CI is a false-green (FLOW-01 — burned twice in this project: v1.2 JOURNEY-03 axe gate and the Phase 33 FLOW-01-class trap). The wiring is verified: both spec names are on the unseeded Playwright list at ci.yml line 1059, neither spec has a HAS_SEED_ENV self-skip, and both passed locally against a real dev server (2 passed in 9.3s). But only a real CI run proves the wiring actually fires in the CI environment. This is the PLAN's own SC#4 acceptance criterion ("PROVEN-EXECUTION in CI") and is explicitly documented as pending-push in 44-04-SUMMARY.md.

### Gaps Summary

No gaps. All locally verifiable must-haves hold:

- SC#1: Reflow gate (`assertNoReflow`, 320px, `clientWidth`, ≤1px slop, visible-anchor) and target-size gate (`assertTargetSizes`, 44px bar, `measured > 0`, scoped selector) both exist, are substantive, are wired to each other and to `/security`, and the e2e specs have no self-skip.
- SC#2: Zoom-meta guard scans `src/` for all 4 forbidden patterns with an anti-typo falsifiability test; root `layout.tsx` has an explicit zoom-permissive viewport export with no `maximumScale` or `userScalable`.
- SC#3: All three primitives exist with substantive implementations. 17/17 unit tests pass, covering SSR path, all breakpoint branches, both hint branches, byte-identity attributes, passthrough contract, and adoption parity. TimeSeriesChart is wired to `ResponsiveChartFrame` with byte-identical output.
- SC#4 (locally): Both specs are on the unseeded ci.yml list (one occurrence each), not on the seed-gated list; no HAS_SEED_ENV self-skip; coverage thresholds unchanged. CI-execution proof is the sole outstanding item (human verification above).

The only outstanding item is the post-push CI-execution proof (FLOW-01), which is correctly classified as `human_needed` per the PLAN's own acceptance gate.

---

_Verified: 2026-06-27T14:38:00Z_
_Verifier: Claude (gsd-verifier)_
