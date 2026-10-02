---
phase: 48-recharts-equitychart-final-verification
reviewed: 2026-06-28T00:00:00Z
depth: standard
files_reviewed: 37
files_reviewed_list:
  - .github/workflows/ci.yml
  - .gitignore
  - DESIGN.md
  - e2e/axe-app-wide.spec.ts
  - e2e/helpers/seed-test-project.ts
  - e2e/reflow-sweep-authed.spec.ts
  - e2e/target-size.spec.ts
  - lighthouserc.json
  - package.json
  - src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx
  - src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx
  - src/app/(dashboard)/allocations/widgets/performance/EquityChart.touch.test.tsx
  - src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx
  - src/app/(dashboard)/allocations/widgets/risk/RiskDecomposition.tsx
  - src/app/(dashboard)/allocations/widgets/risk/TailRisk.tsx
  - src/app/demo/layout.tsx
  - src/app/for-quants/page.tsx
  - src/app/page.tsx
  - src/app/security/page.tsx
  - src/components/charts/CorrelationWithBenchmark.tsx
  - src/components/charts/DrawdownChart.tsx
  - src/components/charts/NetGrossExposureChart.tsx
  - src/components/charts/ReturnHistogram.tsx
  - src/components/charts/RollingAlphaBetaChart.tsx
  - src/components/charts/RollingMetrics.test.tsx
  - src/components/charts/RollingMetrics.tsx
  - src/components/charts/RollingSortinoChart.tsx
  - src/components/charts/RollingVolatilityChart.tsx
  - src/components/charts/TouchTooltip.test.tsx
  - src/components/charts/TouchTooltip.tsx
  - src/components/charts/TurnoverChart.tsx
  - src/components/charts/YearlyReturns.tsx
  - src/components/portfolio/AttributionBar.tsx
  - src/components/portfolio/CompositionDonut.test.tsx
  - src/components/portfolio/CompositionDonut.tsx
  - src/components/portfolio/RiskAttribution.tsx
  - src/components/strategy/CompareEquityOverlay.tsx
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 48: Code Review Report

**Reviewed:** 2026-06-28
**Depth:** standard
**Files Reviewed:** 37
**Status:** issues_found

## Summary

Phase 48 closes the v1.3 mobile-adaptive milestone: touch parity for the 18
Recharts charts (`<Tooltip>` → `<TouchTooltip>`), additive `useTapPin`
integration on the hand-rolled `EquityChart`, an app-wide axe WCAG matrix, a
mobile Lighthouse perf budget, and public-route a11y remediation.

**Every locked invariant in the phase intent was verified to hold:**

- **Desktop byte-identity (Recharts):** `TouchTooltip` resolves the desktop arm
  to `trigger="hover"` — Recharts' own default — via the SSR-safe `useBreakpoint`
  (all-false server snapshot → `"desktop"`, no hydration mismatch). All 18 chart
  swaps are shape-identical (same axes, formatters, `contentStyle`, data shape);
  `accessibilityLayer={false}` is retained on every chart root (15 inline +
  source-grep guard at `tests/visual/chart-accessibility-layer.test.ts` still
  green). No chart passes a `trigger`/`cursor`/`defaultIndex` override.
- **EquityChart desktop path:** `handleMove`'s clamp+epoch+`nearestIndex` chain
  was extracted into the shared pure `epochIndexFromPx` helper (NOT a behavioral
  change — the `n===0→null`, `n===1→0`, clamp, and binary-search arms are
  logically identical, proven by `EquityChart.touch.test.tsx`'s independent
  oracle). `pointerToIndex` reuses the SAME helper → parity-by-construction. The
  ResizeObserver path, projection `useMemo` keying, and the warm-up early-return
  are undisturbed. `useTapPin` is hoisted above the `!projection` early-return
  (rules-of-hooks); `pointerToIndex` guards `if (!projection) return null` and
  `count` falls back to `0`, so the warming-up render is a harmless no-op. The
  null-guard in `pointerToIndex` is sound.
- **axe-app-wide.spec.ts:** standalone routes (public + authed) stay STRICT
  (`expect(violations).toEqual([])`); ONLY the embedded composer factsheet uses a
  post-analyze `serious+critical` filter. NO axe rule is disabled — `buildAxe`
  uses `withTags([wcag2a, wcag2aa, best-practice])` with no `.disableRules()`.
  FLOW-01 dual-wire confirmed: spec appears in the ci.yml UNSEEDED public list
  (L1073) AND the seeded MA-8 list (L1280); the authed/embedded describes carry
  `HAS_SEED_ENV` self-skip.
- **lighthouse-mobile job:** receives NO `TEST_SUPABASE_*` secret (placeholder
  env only); collects PUBLIC routes only; uploads to temporary-public-storage;
  `categories:performance` is error-level @ minScore 0.60 (conservative, below
  measured /demo 0.67). Gated as a blocking check via the `frontend` aggregator's
  `needs` + result loop.
- **Duplicate-`<main>` trap avoided:** root `layout.tsx` renders `{children}`
  with NO shared `<main>`; the landing `/` page owns its own page-local `<main>`,
  `/for-quants` and `/demo` get exactly one `<main>` from their route-group
  layouts, `/security` renders its own. No authed surface nests a second `<main>`.
- **Frozen math untouched:** `scenario.ts` / `compute.ts` / `portfolio-stats` /
  `portfolio-math` are NOT in the diff. No data downsampling. Coverage ratchet
  unchanged (82/80/74/72). lhci pinned at `@lhci/cli@0.15.1`.
- **seedAllocatorBook fixture:** schema assumptions verified against migrations —
  `allocator_equity_snapshots` PK is `(allocator_id, asof)` (matches the upsert
  `onConflict`), `source` defaults `exchange_primary`, the owner-coherence
  trigger requirement (`allocator_id === api_keys.user_id`) is honored. The fixture
  correctly clears `AllocationDashboardV2`'s `holdingsEmpty` gate so the Overview
  EquityChart mounts under `data-testid="overview-equity-curve"`.

The remaining findings are quality/robustness concerns, not correctness or
security defects. No BLOCKER-class issues found.

## Warnings

### WR-01: EquityChart `reveal` precedence is inverted from its own documented precedent

**File:** `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx:1233-1235`
**Issue:** The code computes `const reveal = hoverIdx ?? tap.selectedIdx;`
(mouse-hover wins over the touch pin), but the inline comment claims it "Mirrors
HeatmapPanels' `pinned ?? hovered` precedence." The actual HeatmapPanels code
(`src/app/factsheet/[id]/v2/HeatmapPanels.tsx:455`) is `const reveal = pinnedCell
?? hovered` — **pin wins over hover**, the OPPOSITE order. On pure-touch or
pure-mouse devices this never manifests (one operand is always null). On a HYBRID
touch+mouse device (touchscreen laptop, iPad + trackpad), a user who taps to pin
and then moves the mouse generates `onMouseMove` → sets `hoverIdx` → silently
overrides the pin, defeating the "read the value after lifting the finger"
purpose of pinning. The comment is also actively misleading for a future
maintainer who trusts it.
**Fix:** Match the documented precedent so the pin survives a stray hover, and
keep the comment honest:
```tsx
// Pinned tap (touch) takes precedence over a transient mouse hover —
// mirrors HeatmapPanels' `pinnedCell ?? hovered`.
const reveal = tap.pinned ? tap.selectedIdx : (hoverIdx ?? tap.selectedIdx);
```
(or, minimally, `tap.selectedIdx ?? hoverIdx` if pin-always-wins is acceptable.)
If the current hover-wins behavior is in fact intentional, the FIX is to correct
the comment so it does not claim a precedence it contradicts.

### WR-02: No test exercises the actual `useTapPin` ↔ EquityChart integration

**File:** `src/app/(dashboard)/allocations/widgets/performance/EquityChart.touch.test.tsx:1-156`
**Issue:** The "touch-path parity" test only exercises the pure exported helpers
(`epochIndexFromPx`, `nearestIndex`) against a hand-rolled oracle. It NEVER
renders `<EquityChart>` and dispatches a synthetic `pointerdown`/`pointerup` to
prove the hook is wired correctly: that `tap.setChartEl` is attached to the svg,
that `count={projection.n}` is plumbed, that `pointerToIndex` subtracts
`rect.left`, that a tap actually pins, and that `reveal` then renders the
crosshair/dot at the pinned index. A regression that (a) forgot
`ref={tap.setChartEl}`, (b) passed a wrong `count`, (c) used the WR-01 wrong
precedence, or (d) dropped one of the `onPointer*` props would NOT be caught by
this test — the helper would still pass in isolation. The phase's falsifiable
claim ("a tap pins exactly what hover reveals") is asserted at the helper level
but not at the component level where the wiring lives.
**Fix:** Add one jsdom integration case rendering `<EquityChart
equityDailyPoints={...}>`, then dispatching a `touch`-type `pointerDown` +
`pointerUp` on the svg (with a stubbed `getBoundingClientRect`) and asserting the
pinned crosshair/dot/tooltip appears at the expected index — and survives a
subsequent `pointerLeave`. This closes the helper-tested-but-call-site-untested
gap (the recurring "testing a fix's helper ≠ testing the call site invokes it"
lesson in this codebase's own history).

### WR-03: `useTapPin.onPointerDown` calls `setPointerCapture` for every pointer type, including mouse on desktop

**File:** `src/hooks/useTapPin.ts:111-131` (consumed by `EquityChart.tsx:1514`)
**Issue:** `onPointerDown` runs `e.currentTarget.setPointerCapture(e.pointerId)`
unconditionally — including for a desktop mouse-down — even though the
tap-to-pin logic in `onPointerUp` only acts when `ti.type === "touch"`. The
desktop hover path uses legacy `onMouseMove` (pointer capture does not redirect
mouse events, only pointer events), so hover keeps working and the desktop
*visual* render is unchanged; this is why the "desktop byte-identical" invariant
still holds for the value-reveal. But capturing the pointer on a plain
mouse-down is an unnecessary behavioral side effect on a surface that previously
had none (it can swallow a `pointerdown` from an unrelated future handler, and
mutates focus/capture state during a click). It is gated behind a `try/catch`,
so it cannot throw — hence WARNING, not BLOCKER. This matches the Phase-47
reference pattern (extracted verbatim from TimeSeriesChart), so it is defensible
as a convention, but the mouse arm does no useful work.
**Fix:** Only capture for touch, mirroring the tap-resolution gate:
```ts
if (e.pointerType === "touch") {
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* … */ }
}
```
This keeps the desktop pointer-event surface completely inert (closer to truly
byte-identical) while preserving the touch capture the pin needs.

## Info

### IN-01: "byte-identical" wording vs the actual `handleMove` refactor

**File:** `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx:1213-1226`
**Issue:** The phase intent's locked invariant phrases the desktop path as
"byte-identical," but `handleMove` was genuinely refactored (the inline chain was
replaced by a call to the shared `epochIndexFromPx`). The behavior/output is
identical (parity-by-construction, proven by the helper test), which is what the
invariant actually protects — but the literal source is not byte-identical. This
is the intended design, not a defect; noting it so the wording is not later
mistaken for a violation.
**Fix:** None required. Optionally reconcile the invariant's wording to
"behaviorally identical / output-identical."

### IN-02: `seedAllocatorBook` writes placeholder ciphertext into `api_key_encrypted`

**File:** `e2e/helpers/seed-test-project.ts:529`
**Issue:** The fixture inserts `api_key_encrypted: "e2e-placeholder-ciphertext"`
directly via the service-role client. The header comment correctly documents that
DB-level read-only validation lives at the wizard submission path (not at INSERT),
so this is intentional and test-only — but a string that is not valid ciphertext
could surprise any future code path that attempts to decrypt an active key for a
seeded allocator (e.g. a sync job triggered during a seeded e2e run). Today no
such path runs in the target-size spec, so this is informational.
**Fix:** None required for the current spec. If a future seeded spec triggers a
decrypt path, gate the seeded key as inactive for that path or write a
round-trippable test ciphertext.

### IN-03: Public axe describe has no seed gate and re-runs in the seeded CI job

**File:** `e2e/axe-app-wide.spec.ts:89-111`
**Issue:** The PUBLIC matrix describe carries no `test.skip`, so it executes in
BOTH the unseeded and the seeded MA-8 CI jobs (10 cases × 2 runs). The file's own
comments document this as "cheap overlap intended," and it is harmless. Noting it
only so the duplicate run count is not later mistaken for a wiring bug.
**Fix:** None required. If runner minutes become a concern, gate the public
describe to the unseeded job only.

---

_Reviewed: 2026-06-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
