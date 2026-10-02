# Phase 47: Hand-Rolled SVG Charts (touch + legibility + portrait) - Pattern Map

**Mapped:** 2026-06-27
**Files analyzed:** 17 (2 new src + 1 new e2e spec + 1 new snapshot dir + 11 in-place chart edits + 2 in-place gate edits)
**Analogs found:** 17 / 17 (every file has a concrete in-repo analog — this is a retrofit, not greenfield)

> **Retrofit invariant (governs every assignment below):** this phase edits LOCKED, already-shipped charts
> over a FROZEN compute engine. Every new mobile branch MUST gate behind `bp === "mobile"`; the desktop
> branch returns today's EXACT constants so the desktop golden/SSR HTML stays byte-identical. The
> `useBreakpoint` server snapshot is `"desktop"`, so SSR + the desktop branch are the same render. NEVER
> recompute a series/metric/domain (charts read precomputed payload/props). NEVER touch
> `TimeSeriesChart.tsx`, `scenario.ts`, `compute.ts`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/hooks/useTapPin.ts` (NEW) | hook | event-driven | `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` L44-379 (tap-detect core) | role+flow (extract) |
| `src/hooks/useTapPin.test.ts` (NEW) | test | event-driven | `src/hooks/useBreakpoint.test.ts` | exact (hook unit-test) |
| `src/app/factsheet/[id]/v2/AnalyticalPanels.tsx` (EDIT) | component | transform (render-only) | self L55-130 + `ResponsiveChartFrame` + `useBreakpoint` | exact |
| `src/app/factsheet/[id]/v2/DistributionPanels.tsx` (EDIT) | component | transform | `AnalyticalPanels.tsx` (sibling raw-svg) | exact |
| `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` (EDIT) | component | event-driven (hover→tap) | self L334-436 (canvas hover) + `useTapPin` | exact |
| `src/app/factsheet/[id]/v2/SignaturePanels.tsx` (EDIT) | component | transform | `AnalyticalPanels.tsx` | exact |
| `src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx` (EDIT) | component | transform | `AnalyticalPanels.tsx` | exact |
| `src/app/factsheet/[id]/v2/HistogramChart.tsx` (EDIT) | component | transform | `AnalyticalPanels.tsx` | exact |
| `src/app/factsheet/[id]/v2/MasterBrush.tsx` (EDIT) | component | transform (+ conditional tap) | `AnalyticalPanels.tsx` + `useTapPin` | exact |
| `src/components/charts/DailyHeatmap.tsx` (EDIT) | component | event-driven (`<title>`→tap) | self L195 (`<title>`) + `useTapPin` | exact |
| `src/components/charts/ReturnQuantiles.tsx` (EDIT) | component | transform | `AnalyticalPanels.tsx` + `ResponsiveChartFrame` | role-match |
| `src/components/charts/Sparkline.tsx` (EDIT) | component | transform | `AnalyticalPanels.tsx` | role-match (likely NO-OP) |
| `src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx` (EDIT) | component | transform (`role=img`) | self L46+ + `useBreakpoint` | exact |
| `e2e/svg-chart-parity.spec.ts` (NEW) | test (e2e) | request-response (snapshot) | `e2e/reflow-sweep-authed.spec.ts` | exact (seeded MA-8 template) |
| `e2e/__snapshots__/svg-chart-parity.spec.ts/` (NEW) | test fixture | file-I/O (golden) | — (no baselined dir exists) | no analog (see below) |
| `e2e/target-size.spec.ts` (EDIT) | test (e2e) | request-response | self + `assertTargetSizes` (`e2e/helpers/reflow.ts`) | exact |
| `.github/workflows/ci.yml` (EDIT) | config | — | self L1252-1264 (MA-8 list) | exact |

**MonteCarloBandChart unit test (executor-discretion, recommended):** an additive Vitest component snapshot
under `src/app/(dashboard)/allocations/components/` — analog `src/components/charts/DailyHeatmap.test.tsx`
(props-only render + structural assertions). This is the workaround for Pitfall 4 (the seeded allocator has
0 positions → MonteCarloBandChart never renders on the seeded route).

## Shared Patterns

### Tap-vs-drag + pin-toggle gesture (the `useTapPin` extraction)
**Source:** `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` (the ONLY existing encoding of the exact
slop/time/toggle/leave semantics). Extract the CORE; do NOT lift the pan/zoom machinery (it is
line-chart-specific). **Do NOT edit TimeSeriesChart** — it must stay byte-identical (its parity behavior is
guarded by `src/components/ResponsiveChartFrame.test.tsx`).
**Apply to:** the 3 firm tap-reveal charts (StreakDistributionPanel, DailyReturnsHeatmap, DailyHeatmap) +
conditional MasterBrush. NOT the no-hover charts.

Exact mechanics to generalize (verbatim from the source):

```tsx
// State + refs — TimeSeriesChart.tsx:44-52
const [crossIdx, setCrossIdx] = useState<number | null>(null);
const [pinned, setPinned] = useState(false);
const tapInfoRef = useRef<{ x: number; y: number; t: number; type: string } | null>(null);
const movedRef = useRef(false);

// pointerdown: record tap-start + capture — TimeSeriesChart.tsx:316-318
tapInfoRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType };
movedRef.current = false;
e.currentTarget.setPointerCapture(e.pointerId);

// pointermove: flip movedRef past the 8px slop — TimeSeriesChart.tsx:226-229
if (tapInfoRef.current) {
  const dx = e.clientX - tapInfoRef.current.x;
  const dy = e.clientY - tapInfoRef.current.y;
  if (dx * dx + dy * dy > 64 /* 8px slop */) movedRef.current = true;
}

// pointerleave: pinned survives, unpinned clears — TimeSeriesChart.tsx:299-303
const onPointerLeave = useCallback(() => { if (!pinned) setCrossIdx(null); }, [pinned]);

// pointerup: the tap-to-pin core — TimeSeriesChart.tsx:356-379
const ti = tapInfoRef.current;
tapInfoRef.current = null;
if (!ti || ti.type !== "touch" || movedRef.current) return;   // touch-only, not-a-drag
if (Date.now() - ti.t > 350) return;                          // < 350ms = tap
const rect = svg.getBoundingClientRect();
const idxF = pixelToIdx(e.clientX, rect);                      // ← CALLER-SUPPLIED mapping (generalize)
if (idxF == null) { setPinned(false); setCrossIdx(null); return; }
const idx = Math.max(0, Math.min(n - 1, Math.round(idxF)));
if (pinned && crossIdx != null && Math.abs(idx - crossIdx) < 3) {
  setPinned(false); setCrossIdx(null);                        // re-tap near pin → un-pin
} else {
  setCrossIdx(idx); setPinned(true);                          // tap → move/pin
}
```

**The generalization point:** `pixelToIdx(clientX, rect)` (`TimeSeriesChart.tsx:208-217`) maps pixel→
fractional x-index for the line chart. The hook abstracts this as a caller-supplied
`pointerToIndex(clientX, clientY, rect): number | null` callback. For a heatmap it returns a cell index, for
a histogram a bar index, for a box-strip a period column. The VALUE the reveal shows stays in the chart
(it reads the precomputed prop array at `selectedIdx`). Suggested hook return:
`{ selectedIdx, pinned, svgRef, onPointerDown, onPointerMove, onPointerUp, onPointerLeave }`.
The constants (`TAP_SLOP=8`/`64`, `TAP_MS=350`, re-tap-threshold `3`) live in the hook.

### Responsive SVG container (wrap every in-scope `<svg>`)
**Source:** `src/components/ResponsiveChartFrame.tsx` (Phase-44 primitive, extracted verbatim FROM
TimeSeriesChart). Props: `width`, `height` (viewBox dims), `className`, `style`, plus all `SVGProps`
passthrough (`role`, `aria-label`, ref, handlers). Emits `viewBox="0 0 W H"` +
`preserveAspectRatio="xMidYMid meet"` + `block w-full` + `aspectRatio`/`maxHeight`/`width:100%`/`height:auto`.
**Apply to:** all 17 panels. Several panels already INLINE this exact style object — replace the inline
`<svg viewBox=... style={{ aspectRatio, maxHeight, width, height }}>` with the component for one SoT.
The clearest example of the duplicated recipe to replace: `AnalyticalPanels.tsx:55-60`:

```tsx
// AnalyticalPanels.tsx:55-60 — the EXACT inline recipe that ResponsiveChartFrame already encodes.
<svg
  viewBox={`0 0 ${VB_W} ${VB_H}`}
  preserveAspectRatio="xMidYMid meet"
  className="block w-full"
  style={{ aspectRatio: `${VB_W} / ${VB_H}`, maxHeight: VB_H, width: "100%", height: "auto" }}
>
```

**Byte-identity guard:** `ResponsiveChartFrame.test.tsx` pins the EXACT emitted attribute strings and the
class-order (`block w-full` leads). A swap that changes attribute order/class-order fails that test loud.

### Breakpoint-driven tick/font/viewBox selection
**Source:** `src/hooks/useBreakpoint.ts` (returns `"mobile" | "tablet" | "desktop"`; `max-width:639px` →
mobile; SSR snapshot `"desktop"`). Built on `src/hooks/useMediaQuery.ts` (`useSyncExternalStore`,
SSR-snapshot `false`, no setState-in-effect smell).
**Apply to:** all 17 panels for the CHART-02 font-bump + tick-reduction and the CHART-03 taller mobile
viewBox. Canonical mobile-gated tuning (desktop branch = today's literals → golden unchanged):

```tsx
const bp = useBreakpoint();
const isMobile = bp === "mobile";
const vbH      = isMobile ? VB_H_MOBILE : VB_H_DESKTOP;  // desktop = today's literal
const tickFont = isMobile ? 14          : 10;            // desktop = today's literal
const tickCount = isMobile ? 4          : 8;             // desktop = today's literal
return <ResponsiveChartFrame width={VB_W} height={vbH} role="img" aria-label={...}>{/* ... */}</ResponsiveChartFrame>;
```

> **Do NOT add a per-chart `ResizeObserver`** — `useBreakpoint` is the single trigger. Exception: charts
> that ALREADY measure may keep their measure — only `HeatmapPanels.DailyReturnsHeatmap` does (canvas
> `scale` state via `ResizeObserver` at `HeatmapPanels.tsx:267-279`).

### Color tokens (no fresh literals)
**Source:** `src/components/charts/chart-tokens.ts` (literal hex mirrors of `globals.css @theme`). Any hex
in an SVG must come from here or `var(--color-*)`. **Never container-`opacity`** a baked heatmap cell
(alpha-blends fg+text → the 138-violation contrast collapse, PR #108) — use the baked ramp hex directly.
`DailyHeatmap.test.tsx:168-185, 235-260` is the falsifiable guard (asserts `fill-opacity` is `null`).
**Apply to:** all chart edits that touch fills.

### FLOW-01 dual-wiring (the twice-burned trap)
**Source:** `e2e/reflow-sweep-authed.spec.ts` (HAS_SEED_ENV const + `test.skip`) + `ci.yml:1252-1264`
(MA-8 list). A seeded spec must be in BOTH places or it silently never runs.
**Apply to:** the new `e2e/svg-chart-parity.spec.ts` (add to MA-8 list) and any chart-tap-rect target-size
case that lives on a SEEDED route.

```
# ci.yml:1252-1264 — the MA-8 list. Add the new spec here (FLOW-01 place 1):
npx playwright test \
  e2e/onboarding-funnel.spec.ts \
  ... \
  e2e/reflow-sweep-authed.spec.ts \
  e2e/svg-chart-parity.spec.ts \      # <-- ADD
  --timeout 60000
```

```tsx
// reflow-sweep-authed.spec.ts:46-48 — the HAS_SEED_ENV self-skip (FLOW-01 place 2):
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
// ...then inside the describe: test.skip(!HAS_SEED_ENV, "...skipping prevents false-green on login/404...");
```

> **Prove it RAN** (not skipped) in a real CI run with `vars.E2E_TEST_DB_CONFIGURED == 'true'` — the
> JOURNEY-03 lesson: a gate only earns trust once it actually executes.

### Frozen-math proof (must stay GREEN, un-weakened)
**Source:** `src/__tests__/phase-31-frozen-spine-guards.test.ts` (SCENARIO-05 = `scenario.ts` git-zero-diff
+ HIDE-DON'T-UNMOUNT) + BODY-02 byte-identity + `compute.ts` parity + the NEW desktop goldens. A red guard
is information (you crossed the frozen boundary), never an obstacle to blanket-update.
**Apply to:** every chart edit — none may touch `scenario.ts`/`compute.ts` or change a desktop render.

## Pattern Assignments

### `src/hooks/useTapPin.ts` (hook, event-driven) — NEW
**Analog:** `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` L44-379 (see Shared Patterns → tap gesture for
the verbatim excerpts). Extract the slop/time/touch-only/re-tap-toggle/pointerleave-survival core; accept a
caller `pointerToIndex` callback; return the handler set + `{ selectedIdx, pinned, svgRef }`. Constants in
the hook. `"use client"`. Do NOT include pan/zoom/wheel.

### `src/hooks/useTapPin.test.ts` (test, event-driven) — NEW
**Analog:** `src/hooks/useBreakpoint.test.ts` — `/** @vitest-environment jsdom */` header, `renderHook` from
`@testing-library/react`, one `it` per BRANCH so the coverage ratchet (branches 72) holds. Branches to
cover (each is a `return` arm of the pointerup core): non-touch pointer → no-op; moved past slop → no-op;
> 350ms → no-op; `idxF == null` → clear; re-tap within threshold → un-pin; tap elsewhere → move/pin;
pointerleave while pinned → survives; pointerleave while unpinned → clears. Mock pointer events / supply a
deterministic `pointerToIndex`. Pattern for branch-per-test: `useBreakpoint.test.ts:86-111`.

### `src/app/factsheet/[id]/v2/AnalyticalPanels.tsx` (component, transform) — EDIT
**Analog:** self (StreakDistributionPanel #1 / StreakHist + BootstrapCIPanel #3). The raw `<svg>` inline
recipe is at L55-60 (replace with `ResponsiveChartFrame`). The per-bar desktop `<title>` value-reveal is at
L98-100 — this is the parity hook into `useTapPin` (cell/bar tap shows the SAME `<title>` text):

```tsx
// AnalyticalPanels.tsx:98-100 — the existing desktop value-reveal (per-bar native <title>).
<rect key={i} x={x + 0.5} y={yPx(c)} width={Math.max(0, barW - 1)} height={h} fill={color} fillOpacity={0.85}>
  <title>{`Length ${i + 1}${i + 1 === maxLen ? "+" : ""}: ${c} streak${c === 1 ? "" : "s"}`}</title>
</rect>
```

**Tasks:** StreakDistributionPanel gets tap-reveal (promote `<title>` to a pinnable reveal via `useTapPin`,
≥44px coarse hit-rect) + legibility (mobile `fontSize` bump from 9; VB_W=440 → ~5.9px effective at 320px) +
portrait (taller mobile VB_H). BootstrapCIPanel: legibility + portrait only (no hover). CalmarByYearPanel is
an HTML `<table>` at L168 — OUT of svg scope. Desktop branch = today's literals.

### `src/app/factsheet/[id]/v2/DistributionPanels.tsx` (component, transform) — EDIT
**Analog:** `AnalyticalPanels.tsx` (sibling raw-svg). Four svg panels: EndOfYearBarsPanel (#4),
QuantileBoxPlotPanel (#5), CorrelationStripPanel (#6, in `overflow-x-auto`), CorrelationsMatrixPanel (#7,
the dense heatmap in `overflow-x-auto` at L427). All NO-hover → legibility + portrait only.
**CHART-03 keep-all-cells (CorrelationsMatrixPanel):** keep ALL cells (no row/col drop), keep the existing
scroll region, rotate/reduce axis labels, bump cell `fontSize`. The 880-wide panels (effective ~3px at
320px) likely need the HTML-overlay real-px label fallback OR aggressive tick-reduction + taller viewBox
(executor call; bake desktop golden first, iterate mobile branch against the 320px portrait snapshot).

### `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` (component, event-driven) — EDIT
**Analog:** self — the canvas hover→`hovered`-state→floating tooltip is the desktop value-reveal to make
tappable. `onPointerMove` cell-lookup at L335-362; tooltip div at L417-436; the ResizeObserver `scale` it
already owns at L267-279. The cell-lookup is the model for `useTapPin`'s `pointerToIndex` callback:

```tsx
// HeatmapPanels.tsx:335-361 — desktop hover cell-lookup (the pointerToIndex pattern to reuse for tap).
const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
  const rect = el.getBoundingClientRect();
  const xPx = (e.clientX - rect.left) / scale;
  const yPx = (e.clientY - rect.top) / scale;
  const wk = Math.floor((xPx - labelW) / (CELL + CELL_GAP));
  const d  = Math.floor((yPx - monthLabelH) / (CELL + CELL_GAP));
  if (wk < 0 || wk >= year.cells.length || d < 0 || d >= 7) { setHovered(null); return; }
  // ...derive iso date + value v from year.cells[wk][d] (precomputed payload — NO recompute)...
  setHovered({ cx, cy, iso, v });
};
```

**Tasks:** DailyReturnsHeatmap (#9) gets tap-reveal (cell → its date+value, pinned via `useTapPin`; MAY keep
its existing canvas ResizeObserver per the locked exception) + legibility (mobile label `fontSize` from 8-9)
+ portrait. MonthlyReturnsHeatmap (#8) is an HTML `<table>` at L57 — OUT of svg scope. Reuse the tooltip div
styling (L417-436) for the pinned reveal — no new accent surface.

### `src/app/factsheet/[id]/v2/SignaturePanels.tsx` & `CrossSignaturePanels.tsx` (component, transform) — EDIT
**Analog:** `AnalyticalPanels.tsx`. SignaturesSection (#10, 880×230, fontSize 10) + CrossSignaturesSection
(#11, 880×200, fontSize 10). Both NO-hover → legibility + portrait only. 880-wide → ~3.3px effective; mobile
`fontSize` bump + fewer ticks + taller mobile viewBox.

### `src/app/factsheet/[id]/v2/HistogramChart.tsx` (component, transform) — EDIT
**Analog:** `AnalyticalPanels.tsx`. **CORRECTED hover inventory: HistogramChart has NO per-bar value reveal**
(only wheel-zoom + double-click — the UI-SPEC's "yes (1 marker)" is empirically false; Pitfall 1). →
legibility + portrait ONLY. Do NOT add tap-reveal. Re-confirm the no-hover gate at plan time.

### `src/app/factsheet/[id]/v2/MasterBrush.tsx` (component, transform + conditional tap) — EDIT
**Analog:** `AnalyticalPanels.tsx` for legibility/portrait; `useTapPin` only IF a value-at-x reveal is judged
in-parity. **Conditional:** its 5 pointer handlers are a brush/scrub DRAG, not a value tooltip — by the
binding parity gate (no desktop value-reveal → no new interaction), lean toward legibility + portrait ONLY
(Open Question 1). Keep the brush behavior intact. 1100×60 → ~2.4px effective (worst offender) — bump
`fontSize`, minimal labels.

### `src/components/charts/DailyHeatmap.tsx` (component, event-driven) — EDIT
**Analog:** self — per-cell `<title>` desktop reveal at L195 (`"2024-03-15: 0.00%"` format, asserted by
`DailyHeatmap.test.tsx:187-194`). Promote `<title>` to a tappable/pinnable reveal via `useTapPin` (SVG
branch) — it already canvas-measures (≤365-cell SVG branch / >365 canvas branch, `SVG_THRESHOLD_CELLS=365`).
**Constraints:** `fontSize` is already at the 12 floor; the real mobile fix is the horizontal scroll region +
larger labels, not a taller viewBox. It IS in the `strategy-v2-type-scale` lint's 6-file list — keep
className strings in the allowed set (SVG numeric `fontSize` props are unaffected by that lint). Keep all
the `DailyHeatmap.test.tsx` assertions (baked-tint fills, no `fill-opacity`, save/restore/clearRect ordering,
font-load gate) GREEN.

### `src/components/charts/ReturnQuantiles.tsx` (component, transform) — EDIT
**Analog:** `AnalyticalPanels.tsx` + `ResponsiveChartFrame`. Box plot (#15), currently raw
`<svg viewBox className="w-full">` NOT on RCF — wrap it. NO-hover → legibility (mobile `fontSize` bump from
10-11; 600-wide → ~4.8-5.3px effective) + portrait only. Existing test: `ReturnQuantiles.test.tsx`.

### `src/components/charts/Sparkline.tsx` (component, transform) — EDIT
**Analog:** `AnalyticalPanels.tsx`. 120×32 inline, NO text, NO hover (#16). **Likely NO-OP** (Open
Question 2) — confirm at plan time and document explicitly as out so the count reconciles without a phantom
task. No `.test.tsx` exists for it today.

### `src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx` (component, transform) — EDIT
**Analog:** self (L46+) + `useBreakpoint`. `role="img"`, deliberately non-interactive (132 LOC, props-only
`bands: MonteCarloBandPoint[]`). NO-hover → legibility (already `fontSize=12`; 600-wide → ~5.8px effective;
mobile bump ~18-20) + portrait only. **Do NOT add `tabIndex`/interaction** — `role=img` is by design;
interaction re-introduces the empty-focus-stop regression DESIGN.md pins against (the Recharts
`accessibilityLayer` bug, see file header L18-22). Imports tokens from `@/components/charts/chart-tokens`.
**Verification (Pitfall 4):** add a Vitest component snapshot (analog `DailyHeatmap.test.tsx`, synthetic
`MonteCarloBandPoint[]` props) — the seeded allocator has 0 positions so it won't render on the seeded
Playwright route.

### `e2e/svg-chart-parity.spec.ts` (test, request-response) — NEW
**Analog:** `e2e/reflow-sweep-authed.spec.ts` (the seeded MA-8 template: `HAS_SEED_ENV` const + `test.skip`,
`seedTestAllocator`/`loginViaForm` in `beforeAll`/`beforeEach`, viewport set per test, HTTP-status fail-loud,
route-specific VISIBLE anchor before measuring). Seed via `seedStrategyWithHistory`
(`e2e/helpers/seed-test-project.ts:306` — the proven seed for `/strategy/[id]/v2?strategy_v2=on`). For
per-panel snapshots reuse the ±2% / ±5% tolerance pattern documented in the dead spec's header
(`strategy-v2-chart-parity.spec.ts:4-11`: `maxDiffPixelRatio: 0.02` per panel, `0.05` full-page). Two
deliverables: (1) DESKTOP byte-identity goldens (the no-recompute proof — bake from `main`-equivalent output
FIRST), (2) 320px PORTRAIT snapshots (CHART-02 legibility floor). FLOW-01-wire (see Shared Patterns).

### `e2e/__snapshots__/svg-chart-parity.spec.ts/` (test fixture, file-I/O) — NEW
**Analog:** none — see "No Analog Found". Committed Playwright goldens; this directory does not exist on any
branch today (the dead spec never baselined). Bake the desktop golden FIRST (pre-tuning output), then add
mobile tuning, then add the 320px portrait golden. NEVER `--update-snapshots` the desktop golden after a
tuning change (Pitfall 2 — that silently loses the no-recompute proof).

### `e2e/target-size.spec.ts` (test, request-response) — EDIT
**Analog:** self + `assertTargetSizes` (`e2e/helpers/reflow.ts:119-165`). Add a chart-tap-rect case
asserting ≥44px hit areas at 320px on the in-scope tap charts. Pattern (verbatim from the existing case):

```tsx
// target-size.spec.ts:40-54 — the existing scoped-selector + anchor + fail-loud pattern to mirror.
await page.setViewportSize({ width: 320, height: 800 });
const res = await page.goto("/security");
if (res && res.status() >= 400) throw new Error(`... HTTP ${res.status()} — cannot run target-size gate`);
await assertTargetSizes(page, "main h1", 'footer nav[aria-label="Legal"] a');
//                              ^anchor (fail-loud)   ^SCOPED selector (do NOT lower MIN_TARGET_PX=44)
```

**Route decision (Pitfall 5 / Assumption A4):** the chart-tap-rect anchor is on the SEEDED
`/strategy/[id]/v2` route (charts only render seeded) → that case belongs in the MA-8 (seeded) list, NOT the
unseeded list at `ci.yml:1059`. Either add the chart case to the new seeded spec, or split a seeded
target-size case out. Do NOT lower `MIN_TARGET_PX=44` — scope the selector instead (`reflow.ts:24-27`).

### `.github/workflows/ci.yml` (config) — EDIT
**Analog:** self L1252-1264 (MA-8 `npx playwright test` list). Add `e2e/svg-chart-parity.spec.ts \` to the
list (FLOW-01 place 1). The MA-8 step already exports the seed env + runs `npm run start` in prod mode;
goldens just need Chromium (already `npx playwright install --with-deps chromium` at L1033).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `e2e/__snapshots__/svg-chart-parity.spec.ts/` | test fixture | file-I/O | NO baselined Playwright golden directory exists in the repo today (`e2e/__snapshots__/` is empty; the named `strategy-v2-chart-parity.spec.ts` goldens were never committed). The planner bakes these from desktop output — there is no prior golden to copy. The TOLERANCE conventions (±2% panel / ±5% page) are documented in the dead spec's header and reused. |

## Superseded / Do-Not-Resurrect

- **`e2e/strategy-v2-chart-parity.spec.ts`** — DEAD (`test.skip(true)` ×2 at L47/55, no goldens dir,
  Recharts/`lightweight-charts`-canvas structural assertions that can never pass against the in-scope SVG
  charts; PR #108 note in its header L37-46). Do NOT revive/re-target it here — author the FRESH
  `e2e/svg-chart-parity.spec.ts` and leave the dead spec to Phase 48 (Rule 7: the CONTEXT.md "extend it"
  premise is empirically false). Reuse ONLY its documented tolerance pattern, not its assertions/route.

## Metadata

**Analog search scope:** `src/app/factsheet/[id]/v2/`, `src/components/charts/`,
`src/app/(dashboard)/allocations/components/`, `src/hooks/`, `src/components/`, `src/__tests__/`, `e2e/`,
`e2e/helpers/`, `.github/workflows/`.
**Files scanned:** ~25 (11 in-scope charts confirmed RCF=0 / useBreakpoint=0 / recharts=0 via grep; 8 analog
files read in full or targeted ranges).
**Pattern extraction date:** 2026-06-27
