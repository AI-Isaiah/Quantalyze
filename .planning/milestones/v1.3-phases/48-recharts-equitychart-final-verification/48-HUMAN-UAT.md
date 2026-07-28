---
status: partial
phase: 48-recharts-equitychart-final-verification
source: [48-VALIDATION.md]
started: 2026-06-28
updated: 2026-06-28
---

## Current Test

[awaiting human real-device authed walkthrough — this is the v1.3 milestone SC#5
sign-off and a DESIGNED deferral (`human_needed`), not a gap. A headless browser
cannot hydrate authed pages (reference_browse_no_hydrate_authed), so the authed
tap-to-pin ergonomics can only be confirmed on a physical phone against
preview/prod after deploy. The automated contract below is fully green.]

## Tests

### 1. Recharts tap-to-pin on a real phone — Line + Bar + Pie families (authed)

expected: On a physical phone (iOS Safari + Android Chrome) signed in as an
allocator with synced positions, on `/allocations` and its tabs:

- **Line family** (e.g. `RollingMetrics` / `RollingVolatilityChart` /
  `CorrelationWithBenchmark` on the Risk/Overview tabs): tapping a point on the
  line **reveals AND pins** the tooltip showing the same value desktop hover
  shows; the tooltip **stays active** after lifting the finger (native
  `trigger="click"`); tapping a different x-position **moves** the reveal.
- **Bar family** (e.g. `TailRisk` / `RiskDecomposition` / `YearlyReturns` /
  `AttributionBar`): tapping a bar **reveals AND pins** that bar's value; it
  stays active after finger-lift. For thin bars/small segments that are hard to
  hit, the **adjacent KPI-cell value** is the documented fallback (we do NOT
  inflate Recharts internals).
- **Pie** (`CompositionDonut` on the Holdings/Overview tab): tapping a donut
  segment **reveals AND pins** that slice's weight; it stays active.

how: sign in as the allocator (or qa-demo on prod); open `/allocations`; switch
tabs (Overview / Holdings / Risk / Outcomes) to reach each chart family; tap and
observe. Confirm desktop is UNCHANGED — on a laptop, hover still shows/hides on
mouse-enter/leave (byte-identical `trigger="hover"`).
result: [pending]

### 2. EquityChart tap-pin on a real phone — reveal, pin, re-tap toggle, ≥44px ergonomics

expected: On the `EquityChart` (the hand-rolled SVG equity curve on the
Overview/Performance widget): tapping the curve **reveals AND pins** the
crosshair + dot + value the desktop mouse-hover shows (same `nearestIndex`
binary-search — a tap pins exactly what hover shows); the pinned reveal
**survives finger-lift** (`pointerleave`); a **re-tap within ~3 indices toggles
the pin off**; a tap elsewhere **moves** the pin; there is **no auto-dismiss
timer**. The tap hit-area feels comfortable (the `pointer-coarse:` ≥44×44px
contract). Desktop mouse path is unchanged.
how: on `/allocations` Overview tab, tap along the equity curve; lift; re-tap the
same spot (should clear); tap a far point (should move). On a laptop, confirm
mouse hover still behaves exactly as before.
result: [pending]

### 3. No horizontal overflow at 320px on a real narrow phone (authed surfaces)

expected: At a 320px-class viewport (smallest phones / 400% zoom), `/allocations`
and every tab, the onboarding wizard, and `/security` show **no horizontal page
scrollbar** and no clipped content — charts, tables, and the EquityChart all
reflow. (The automated `reflow-sweep-authed` + all-columns guards prove the
geometry at 320px; this is the on-glass confirmation.)
how: open the authed surfaces on a narrow phone (or DevTools device mode at
320px) and confirm no sideways scroll on any tab.
result: [pending]

### 4. No ResizeObserver-loop console error + stable memory on rotate (authed)

expected: Rotating the phone portrait -> landscape -> portrait on `/allocations`
(EquityChart's measured-width ResizeObserver re-fires on every rotate) produces
**no "ResizeObserver loop completed with undelivered notifications" console
error** and **no runaway memory growth** across repeated rotations (no leaked
observer/listener). (The automated rotate-stability fold in
`e2e/reflow-sweep-authed.spec.ts` asserts both headlessly; this is the
real-device confirmation that the chart stays stable under real orientation
changes.)
how: with the phone's remote-debug console attached (or via a desktop-attached
device), rotate several times on the Overview tab; watch the console for the RO
loop string and the memory tab for unbounded growth.
result: [pending]

### 5. Final-verify: coverage ratchet held + all frozen-math/byte-identity/parity guards green un-weakened

expected: The automated phase-gate guards are ALL green and NONE was weakened to
go green:

- **Coverage ratchet HELD** (never lowered): `npm run test:coverage` exits 0
  with lines >= 82, statements >= 80, functions >= 74, branches >= 72
  (`vitest.config.ts` thresholds unchanged from CLAUDE.md).
- **Frozen-math (SCENARIO-05)**: `npx vitest run
  src/__tests__/phase-31-frozen-spine-guards.test.ts` green (scenario.ts
  zero-diff — no engine/math touched).
- **accessibilityLayer={false} grep**: `npx vitest run
  tests/visual/chart-accessibility-layer.test.ts` green (the `<Tooltip>` ->
  `<TouchTooltip>` swap did NOT trip the whole-codebase grep; `={false}` stays
  pinned on every chart root).
- **svg-chart-parity goldens**: `npx playwright test e2e/svg-chart-parity.spec.ts`
  **self-skips loudly** (Phase-47 carryover — NOT made false-green, NO
  placeholder goldens baked here).
- **Mobile perf budget**: the `lighthouse-mobile` CI job (lighthouserc.json,
  mobile form-factor, public routes, error-level `minScore` 0.60 seeded from a
  real baseline) runs and passes as a BLOCKING gate.

This item is AUTOMATED and was run at authoring time (see 48-05-SUMMARY.md for
the recorded actuals). It is listed here so the human sign-off confirms the
falsifiable matrix is intact before approving SC#5.
result: [pending — automated guards green at authoring; awaiting human sign-off]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

verification status: **human_needed** — the real-device authed tap-to-pin
walkthrough (items 1-4) is the v1.3 milestone SC#5 sign-off; it can only be
performed on a physical phone against preview/prod after deploy (headless cannot
hydrate authed pages). Item 5 (the final-verify guard matrix) is automated and
green at authoring; it is restated here for the human to confirm before
approving. Type "approved" after the walkthrough passes (or list failing items).

## Gaps

None — all five items are deliberate, designed deferrals. Items 1-4 are the
real-device authed confirmation that headless cannot replicate; the automated
contract underneath them is fully in place and green: the Recharts `TouchTooltip`
trigger unit tests, the EquityChart `useTapPin` touch-path tests, the app-wide
axe matrix (route x {Desktop, mobile 375}), the extended target-size >=44px gate
at 320px on `/allocations`, the reflow-sweep at 320px, the rotate-stability fold,
the `lighthouse-mobile` mobile perf budget, the frozen-spine / accessibilityLayer
/ svg-chart-parity guards, and the coverage ratchet. Item 5 was executed at
authoring time and recorded green in 48-05-SUMMARY.md. This file fulfills the
Phase-47 47-HUMAN-UAT.md carry-forward (its deferred item #2: "real-device authed
walkthrough ... formally Phase 48 SC#5").
