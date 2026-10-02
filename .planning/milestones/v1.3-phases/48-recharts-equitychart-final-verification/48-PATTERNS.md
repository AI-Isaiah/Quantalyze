# Phase 48: Recharts + EquityChart + Final Verification - Pattern Map

**Mapped:** 2026-06-28
**Files analyzed:** 9 new/modified (1 new shim + its test, 18 chart edits via 1 representative analog, 1 EquityChart edit, 1 new e2e spec, 1 extended e2e spec, 1 folded e2e spec, 1 new lhci config, 1 CI workflow edit, 1 new UAT doc)
**Analogs found:** 9 / 9 (every file has a named live analog — this is a retrofit/verification phase wiring existing primitives)

> **Orientation for the planner:** This phase invents almost no new logic. Each new file mirrors an *already-shipped, already-tested* primitive. The two hard constraints are **byte-identity** (desktop must not change) and **CI-actually-runs** (FLOW-01 dual-wiring). Wherever a pattern below shows a desktop arm, that arm must reproduce today's behavior exactly.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/components/charts/TouchTooltip.tsx` (NEW) | component (chart shim) | request-response (render-time prop injection) | `src/components/charts/chart-tokens.ts` (shared chart util) + `src/hooks/useBreakpoint.ts` (the gate) | role-match (no existing wrapper-shim; closest is a shared chart module) |
| `src/components/charts/TouchTooltip.test.tsx` (NEW) | test (component) | request-response | `src/hooks/useTapPin.test.ts` (mock-a-hook unit test) + existing per-chart `.test.tsx` | role-match |
| 18 Recharts charts (MODIFY `<Tooltip>`→`<TouchTooltip>`) | component | request-response | `src/components/charts/RollingMetrics.tsx` (representative LineChart `<Tooltip formatter contentStyle>`) + `src/components/portfolio/CompositionDonut.tsx` (PieChart/Cell variant) | exact |
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` (MODIFY) | component (hand-rolled SVG) | event-driven (pointer) | `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` `YearCalendarCanvas` (the live `useTapPin` wiring onto a hand-rolled surface) | exact |
| `e2e/axe-app-wide.spec.ts` (NEW) | test (e2e) | request-response (route × viewport matrix) | `e2e/reflow-sweep.spec.ts` (route-loop) + `e2e/composer-axe.spec.ts` (axe harness + serious/critical filter + seed/login) | exact (composite) |
| `e2e/target-size.spec.ts` (MODIFY) | test (e2e) | request-response | the Phase-47 coarse-emulation block already in this same file (L58-177) | exact (self-analog) |
| `e2e/reflow-sweep-authed.spec.ts` (MODIFY — rotate-stability fold) | test (e2e) | event-driven (console/pageerror listeners) | `e2e/composer-axe.spec.ts` seed+login idiom; `page.on("console")` listener pattern (Assumption A5) | role-match |
| `lighthouserc.json` (NEW) | config | batch (CI perf budget) | RESEARCH.md Pattern 4 + the CI build-artifact-restore job (`ci.yml` L1040-1059) | role-match (no existing lhci; the closest is the e2e job's start-server shape) |
| `.github/workflows/ci.yml` (MODIFY — axe wiring + `lighthouse-mobile` job) | config (CI) | batch | seeded MA-8 list (L1252-1266) + unseeded list (L1059) + e2e job structure (L1040-1109) | exact |
| `package.json` (MODIFY — `@lhci/cli` devDep) | config | n/a | existing devDependencies block | exact |
| `.planning/phases/48-.../48-HUMAN-UAT.md` (NEW) | doc | n/a | `.planning/phases/47-.../47-HUMAN-UAT.md` | exact |

---

## Pattern Assignments

### `src/components/charts/TouchTooltip.tsx` (component, request-response) — NEW

**Analog:** `src/components/charts/chart-tokens.ts` (shared chart module convention) + `src/hooks/useBreakpoint.ts` (the gate) + RESEARCH.md Pattern 1 (verified Recharts API).

**Imports pattern** — every Recharts chart file already starts with `"use client"` then a named `recharts` import; the shim follows the same convention (see `RollingMetrics.tsx:1-12`):
```tsx
"use client";
import { Tooltip } from "recharts";
import type { ComponentProps } from "react";
import { useBreakpoint } from "@/hooks/useBreakpoint";
```

**The breakpoint gate** — copy the EXACT mobile predicate already used at the live `useTapPin` call site (`HeatmapPanels.tsx:263`) so the project has ONE spelling of "is mobile":
```tsx
// HeatmapPanels.tsx:263 — the canonical spelling to mirror:
const isMobile = useBreakpoint() === "mobile";
```

**Core pattern** (the whole shim — RESEARCH.md Pattern 1, derived from `node_modules/recharts/types/component/Tooltip.d.ts`):
```tsx
type TooltipProps = ComponentProps<typeof Tooltip>;

export function TouchTooltip(props: TooltipProps) {
  // mobile → tap-to-show/pin; tablet+desktop → hover (byte-identical to today).
  // SSR + first client paint render "desktop" → "hover" (Pitfall 1 — by design).
  const trigger = useBreakpoint() === "mobile" ? "click" : "hover";
  return <Tooltip trigger={trigger} {...props} />;
}
```
- `trigger` default is `"hover"` and `trigger="click"` "shows after clicking and stays active" (`Tooltip.d.ts` L168-175). Desktop arm reproduces the default exactly → byte-identical.
- Spread `{...props}` AFTER `trigger` so a caller could override (none do today — all 18 pass only `formatter` + `contentStyle`).
- **Do NOT** read the breakpoint during SSR or force single-pass (Pitfall 1 — re-introduces hydration mismatch). `useBreakpoint` is SSR-safe two-pass by design (`useBreakpoint.ts:18-30`).

---

### `src/components/charts/TouchTooltip.test.tsx` (test, component) — NEW

**Analog:** `src/hooks/useTapPin.test.ts` (the mock-a-hook unit-test idiom) — Wave 0 gap per RESEARCH §Validation L552.

**Core pattern:** mock `useBreakpoint`, render `<TouchTooltip>` inside a minimal chart, assert the rendered `<Tooltip trigger>` is `"click"` on the mobile arm and `"hover"` (or default) on the desktop arm. Must cover BOTH branches of the ternary — the coverage ratchet (branches 72) needs the new viewport conditional covered (RESEARCH §Project Constraints L470).
```tsx
// Mirror the per-chart test convention; mock the single gate:
vi.mock("@/hooks/useBreakpoint", () => ({ useBreakpoint: vi.fn() }));
// arm 1: mockReturnValue("mobile")  → expect trigger="click"
// arm 2: mockReturnValue("desktop") → expect trigger="hover"  (byte-identical proof)
// + assert formatter/contentStyle props spread through unchanged.
```

---

### 18 Recharts charts (component, request-response) — MODIFY `<Tooltip>` → `<TouchTooltip>`

**Primary analog:** `src/components/charts/RollingMetrics.tsx` (representative LineChart).
**Secondary analog (Cell/Pie variant):** `src/components/portfolio/CompositionDonut.tsx`.

**The exact `<Tooltip>` usage today** (`RollingMetrics.tsx:157-160`) — this is the one-token swap target:
```tsx
<Tooltip
  contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
  formatter={(v, name) => [Number(v).toFixed(2), labelFor(String(name))]}
/>
```
Becomes:
```tsx
<TouchTooltip
  contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
  formatter={(v, name) => [Number(v).toFixed(2), labelFor(String(name))]}
/>
```
Plus an import line `import { TouchTooltip } from "@/components/charts/TouchTooltip";` (relative `./TouchTooltip` for the `src/components/charts/*` siblings).

**PieChart/Cell variant** (`CompositionDonut.tsx:56-59`) — identical swap shape, different formatter; confirms the spread is uniform (only `formatter` + `contentStyle`, never `content=`/`cursor=`):
```tsx
<Tooltip
  formatter={(v, name) => [`${(Number(v) * 100).toFixed(1)}%`, name]}
  contentStyle={{ fontSize: 12, borderColor: "#E2E8F0", borderRadius: 6 }}
/>
```

**The 18-chart list to swap** (verified live, RESEARCH L433-450 / UI-SPEC L186-205). Each keeps its `<LineChart/AreaChart/BarChart/PieChart/ComposedChart accessibilityLayer={false}>` root tag LITERAL and untouched (Pitfall 5):
- `src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx`
- `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx`
- `src/app/(dashboard)/allocations/widgets/risk/RiskDecomposition.tsx`
- `src/app/(dashboard)/allocations/widgets/risk/TailRisk.tsx`
- `src/components/charts/CorrelationWithBenchmark.tsx`
- `src/components/charts/DrawdownChart.tsx`
- `src/components/charts/NetGrossExposureChart.tsx`
- `src/components/charts/ReturnHistogram.tsx`
- `src/components/charts/RollingAlphaBetaChart.tsx`
- `src/components/charts/RollingMetrics.tsx`
- `src/components/charts/RollingSortinoChart.tsx`
- `src/components/charts/RollingVolatilityChart.tsx`
- `src/components/charts/TurnoverChart.tsx`
- `src/components/charts/YearlyReturns.tsx`
- `src/components/portfolio/AttributionBar.tsx`
- `src/components/portfolio/CompositionDonut.tsx`
- `src/components/portfolio/RiskAttribution.tsx`
- `src/components/strategy/CompareEquityOverlay.tsx`

**PARITY-ONLY — DO NOT TOUCH:** `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx`. Its `Sparkline` (`OutcomesWidget.tsx:289-318`) is a hidden-axis `<LineChart>` with **NO `<Tooltip>`** — adding one is an invented interaction the contract forbids (UI-SPEC L207-211). Verify it has no `<Tooltip>` and leave it alone; its value lives in the adjacent `KpiCell` (`OutcomesWidget.tsx:231-286`).

**Per-chart guardrails:**
- **Pitfall 5 (`accessibilityLayer={false}` grep):** the swap touches the `<Tooltip>` element ONLY. Do NOT spread props onto the chart root tag — the grep `tests/visual/chart-accessibility-layer.test.ts` reads the literal `<Tag …>` opening block.
- **Token source:** any hex stays sourced from `chart-tokens.ts` (`CHART_BORDER`, `CHART_TOOLTIP_STYLE`, etc.) — never a fresh literal (DESIGN.md / UI-SPEC Color §).

---

### `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` (component, event-driven) — MODIFY

**Analog:** `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` `YearCalendarCanvas` (L244-542) — the LIVE, shipped example of wiring `useTapPin` onto a hand-rolled surface while keeping the desktop mouse path byte-identical. This is the single best template for the EquityChart touch path.

**Imports pattern** (`HeatmapPanels.tsx:1-9`):
```tsx
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTapPin } from "@/hooks/useTapPin";
// (EquityChart already imports useBreakpoint-adjacent hooks; add useTapPin)
```

**The existing hover math the touch path MUST mirror** (`EquityChart.tsx:1142-1159`, `handleMove`) — leave this byte-identical, reuse its px→epoch→nearestIndex chain in `pointerToIndex`:
```tsx
function handleMove(e: React.MouseEvent<SVGSVGElement>) {
  if (n === 0) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const px = e.clientX - rect.left;
  if (n === 1) { setHoverIdx(0); return; }
  const clampedPx = Math.max(pad.l, Math.min(pad.l + chartW, px));
  const targetEpoch = firstEpochX + ((clampedPx - pad.l) / chartW) * totalMs;
  setHoverIdx(nearestIndex(visibleEpochs, targetEpoch));
}
```

**Core wiring pattern** (RESEARCH Pattern 2; mirrors `HeatmapPanels.tsx:398-451`). Note the analog's `pointerToIndex` returns `null` for an off-grid tap (un-pins) and reuses the SAME coord→payload math as the hover path:
```tsx
// HeatmapPanels.tsx:402-418 — the live useTapPin call shape to copy:
const {
  selectedIdx,
  setChartEl,
  onPointerDown: tapPointerDown,
  onPointerMove: tapPointerMove,
  onPointerUp: tapPointerUp,
  onPointerLeave: tapPointerLeave,
} = useTapPin({
  count: COLS * 7,
  pointerToIndex: (clientX, clientY, rect) => { /* SAME math as the hover path */ },
});
```
For EquityChart, `count: n`, and `pointerToIndex` reuses the `handleMove` clamp+epoch+`nearestIndex` chain (RESEARCH Pattern 2 code block, L253-263).

**Attaching to the EXISTING `<svg>`** (`EquityChart.tsx:1421-1430`) — KEEP the two mouse handlers, ADD the ref + pointer handlers (additive):
```tsx
<svg
  width={width}
  height={height}
  role="img"
  aria-label="Equity chart"
  style={{ display: "block", cursor: "crosshair" }}
  onMouseMove={handleMove}                       // ← BYTE-IDENTICAL, keep
  onMouseLeave={() => setHoverIdx(null)}         // ← BYTE-IDENTICAL, keep
  // ADD: ref={setChartEl} onPointerDown/Move/Up/Leave={tap*}
>
```
- `useTapPin`'s handlers are typed `ReactPointerEvent<SVGSVGElement>` (`useTapPin.ts:79-82`) — the `<svg>` already exists, types line up directly (no `asSvg` cast needed here, unlike the HeatmapPanels div-wrapper case at L442-443).
- `setChartEl` is a callback ref (`useTapPin.ts:107-109`) — react-compiler-safe, no `.current` mutation.

**The reveal site** (`EquityChart.tsx:1589-1640`, the crosshair + dot + tooltip block keyed on `hoverIdx`) — render the SAME reveal when `(hoverIdx ?? tap.selectedIdx)` is set. Mirror the HeatmapPanels `reveal = pinnedCell ?? hovered` precedence (`HeatmapPanels.tsx:455`).

**DO-NOT-TOUCH guardrails (RESEARCH Pitfall 7; UI-SPEC EquityChart contract):**
- **ResizeObserver / measured-width** (`EquityChart.tsx:517-528`, floor 400px) — verify only, no refactor.
- **Projection `useMemo`** keyed on DATA not `hoverIdx` (L652-670 region; the hoist comment at L657-670) — do NOT add `selectedIdx`/`pinned` to its dep array (re-introduces the per-pixel hover regression).
- **Hit target ≥44px** under `pointer-coarse:` — mirror the HeatmapPanels `className="… pointer-coarse:min-h-[44px]"` floor (`HeatmapPanels.tsx:474`); the SVG height already exceeds 44px, the class makes the contract explicit.

---

### `e2e/axe-app-wide.spec.ts` (test, e2e route × viewport matrix) — NEW

**Analog (route-loop):** `e2e/reflow-sweep.spec.ts` (L41-82) — the `{path, anchor}[]` array + `for (const r of ROUTES)` template.
**Analog (axe harness + filter + seed/login):** `e2e/composer-axe.spec.ts`.

**Seed-guard + login helper** (copy verbatim from `composer-axe.spec.ts:54-70`):
```ts
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

async function loginViaForm(page, email, password) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, { timeout: 10000 });
}
```

**Route-loop shape** (mirror `reflow-sweep.spec.ts:41-82`, add a VIEWPORTS inner loop per RESEARCH Pattern 3):
```ts
const PUBLIC_ROUTES: { path: string; anchor: string }[] = [
  { path: "/", anchor: "h1" },
  { path: "/security", anchor: "main h1" },
  { path: "/for-quants", anchor: "main h1" },
  { path: "/browse", anchor: "main h1" },
  { path: "/demo", anchor: "#editorial-hero-headline" },
];
const VIEWPORTS = [
  { w: 1280, h: 800, name: "Desktop" },
  { w: 375, h: 812, name: "mobile" },   // 375 per Assumption A3
];
```

**Axe harness** — reuse `buildAxe(page)` from `./helpers/axe` (already `withTags(["wcag2a","wcag2aa","best-practice"])`, `axe.ts:15-21`). Do NOT introduce a second harness.

**Anti-false-green gate** (every analyze() behind a visible anchor; `reflow-sweep.spec.ts:70-79` + `composer-axe.spec.ts:104-106`):
```ts
const res = await page.goto(r.path);
if (res && res.status() >= 400) throw new Error(`${r.path} HTTP ${res.status()}`);
await expect(page.locator(r.anchor)).toBeVisible({ timeout: 5_000 });
const results = await buildAxe(page).analyze();
expect(results.violations).toEqual([]);   // strict for standalone routes
```

**Embedded-factsheet `serious+critical` filter** (composer/embedded ONLY — copy `composer-axe.spec.ts:208-212`; keep standalone routes STRICT per Assumption A2):
```ts
const blocking = results.violations.filter(
  (v) => v.impact === "serious" || v.impact === "critical",
);
expect(blocking).toEqual([]);
```

**FLOW-01 dual-wire (Pitfall 3 — the load-bearing CI step):** add `e2e/axe-app-wide.spec.ts` to BOTH (a) its own `HAS_SEED_ENV` self-skip [place 2] AND (b) `ci.yml` — authed rows → the seeded MA-8 list (L1252-1266), public rows → the unseeded list (L1059) [place 1]. Prove it RAN in a real CI run.

---

### `e2e/target-size.spec.ts` (test, e2e) — MODIFY (extend)

**Analog:** the Phase-47 coarse-emulation block ALREADY in this file (`target-size.spec.ts:58-177`) — this is a self-analog; mirror its structure exactly for the new EquityChart case.

**The coarse-emulation idiom to copy** (`target-size.spec.ts:89-141`):
```ts
const HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

test.describe("target-size — EquityChart tap-rect @ 320px (seeded)", () => {
  test.use({ hasTouch: true, isMobile: true });   // ← makes Chromium report pointer:coarse
  test.skip(!HAS_SEED_ENV, "…seed env not wired…");

  test("EquityChart tap surface >= 44px at 320px (coarse)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const res = await page.goto("/allocations");   // EquityChart mount-point (vs /factsheet/[id]/v2 for the existing cases)
    if (res && res.status() >= 400) throw new Error(`/allocations HTTP ${res.status()}`);
    // anchor on the chart (fail loud), then assertTargetSizes against the coarse hit-rect
    await assertTargetSizes(page, /* visible anchor */, /* the >=44px tap surface selector */);
  });
});
```
- `assertTargetSizes` from `./helpers/reflow` (`MIN_TARGET_PX=44`) — un-lowered (RESEARCH Don't Hand-Roll).
- The EquityChart `<svg role="img" aria-label="Equity chart">` (`EquityChart.tsx:1425-1426`) is the natural visible anchor; the `pointer-coarse:min-h-[44px]` layer added in the EquityChart edit is the measured surface.
- Authed route → this case is SEEDED; `target-size.spec.ts` is ALREADY in BOTH ci.yml lists (L1059 unseeded /security + L1265 seeded). No new FLOW-01 wiring needed (the spec is already dual-wired); the new `test.describe` self-skips unseeded like the Phase-47 block.

---

### `e2e/reflow-sweep-authed.spec.ts` (test, e2e) — MODIFY (fold rotate-stability)

**Analog:** `e2e/composer-axe.spec.ts` (seed + login on an authed route) + the `page.on("console")` / `pageerror` listener idiom (RESEARCH Assumption A5; already used across e2e specs). This is the CANDIDATE host per RESEARCH §Recommended Structure L217 — planner may pick another existing mobile e2e (`e2e/mobile-drawer-keyboard.spec.ts`).

**Core pattern (fold, do NOT create a new harness — RESEARCH A11Y-03 contract):**
```ts
const consoleErrors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
// rotate: setViewportSize portrait → landscape → portrait
// assert NO "ResizeObserver loop" substring in consoleErrors
expect(consoleErrors.filter((t) => /ResizeObserver loop/i.test(t))).toEqual([]);
// stable memory on rotate (SC#4) — bounded assertion, not a hard byte count
```
- This spec is already in the seeded MA-8 list (`ci.yml:1263`) and already has a `HAS_SEED_ENV` self-skip — an ADDITIVE fold needs NO new FLOW-01 wiring (like the composer-axe GUARD-03 fold, `composer-axe.spec.ts:35-45`).

---

### `lighthouserc.json` (config, batch) — NEW

**Analog:** RESEARCH Pattern 4 (schema from official lighthouse-ci docs) + the CI start-server shape (`ci.yml:1047-1059`).

**Core config** (RESEARCH Pattern 4 — `minScore` is a PLACEHOLDER, seed from a real baseline a few points under measured, Assumption A4 / locked):
```json
{
  "ci": {
    "collect": {
      "startServerCommand": "npm run start",
      "startServerReadyPattern": "ready|started|listening",
      "startServerReadyTimeout": 30000,
      "url": [
        "http://localhost:3000/",
        "http://localhost:3000/security",
        "http://localhost:3000/for-quants",
        "http://localhost:3000/browse",
        "http://localhost:3000/demo"
      ],
      "numberOfRuns": 3,
      "settings": { "preset": "mobile" }
    },
    "assert": {
      "preset": "lighthouse:no-pwa",
      "assertions": { "categories:performance": ["error", { "minScore": 0.70 }] }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}
```
- PUBLIC routes ONLY (locked; no authed URLs → no info-disclosure to temporary-public-storage, Security §).
- `preset:"mobile"` = mobile emulation + throttling. `error`-level = fails the build. `lighthouse:no-pwa` drops PWA audits (not a PWA).
- The `url` list matches the `PUBLIC_ROUTES` paths in `reflow-sweep.spec.ts:41-57` (all confirmed public + reflow-covered).

---

### `.github/workflows/ci.yml` (config, CI) — MODIFY

**Analog (axe wiring):** the seeded MA-8 list (L1252-1266) + the unseeded list (L1059) + the FLOW-01 reminder comment (L1250-1251).
**Analog (new `lighthouse-mobile` job):** the e2e job's build-artifact-restore + start-server block (L1040-1109).

**Existing seeded MA-8 list to extend** (`ci.yml:1252-1266`):
```yaml
npx playwright test \
  e2e/onboarding-funnel.spec.ts \
  e2e/discovery-axe.spec.ts \
  ...
  e2e/composer-axe.spec.ts \
  e2e/svg-chart-parity.spec.ts \
  e2e/target-size.spec.ts \
  --timeout 60000
# Adding/removing a seed-gated spec? Update both this list and
# the e2e/<spec>.spec.ts HAS_SEED_ENV constant.   ← FLOW-01 reminder (L1250-1251)
```
→ add `e2e/axe-app-wide.spec.ts` here (authed rows). Add it to the unseeded list at L1059 too (public rows) — OR keep public rows in the same spec gated to run unseeded; planner decides per Open Question 1.

**New `lighthouse-mobile` job — copy the build-artifact-restore + start-server shape** (`ci.yml:1040-1059`):
```yaml
- name: Download .next + public artifact from frontend-build
  uses: actions/download-artifact@…  # v8.0.1 (same pinned SHA as L1041)
  with: { name: nextjs-build }
- name: lhci autorun
  run: |
    npm run start &
    # wait-for-:3000 loop (copy L1051-1058)
    npx lhci autorun
```
- Do NOT pass `TEST_SUPABASE_*` to this job (public routes; no secret — Security §).
- Reuse the placeholder NEXT_PUBLIC_* env (mirror L1106-1109) — public routes render on placeholder env.
- Pitfall 6: must run against the PRODUCTION `.next` (the restored artifact + `npm run start`), never `next dev`.

---

### `package.json` (config) — MODIFY

**Pattern:** add `"@lhci/cli": "0.15.1"` to `devDependencies` (pin exact — Security §, slopsquat mitigation). Install: `npm install --save-dev @lhci/cli@0.15.1`. Verified legitimate (GoogleChrome org, no postinstall — RESEARCH Package Legitimacy Audit). Planner MAY gate the install behind a `checkpoint:human-verify`.

---

### `.planning/phases/48-.../48-HUMAN-UAT.md` (doc) — NEW

**Analog:** `.planning/phases/47-hand-rolled-svg-charts-touch-legibility-portrait/47-HUMAN-UAT.md` — copy its frontmatter + `## Current Test` / `## Tests` / `## Summary` / `## Gaps` shape exactly.

**Content to cover (UI-SPEC SC#5 / Copywriting §):** real-device authed walkthrough — tap-to-pin works on a Recharts Line + Bar + Pie chart AND on EquityChart (mirror the 47 doc's "tapping a … reveals AND pins … re-tap toggles off; ≥44px hit ergonomics"); no horizontal overflow at 320px; no ResizeObserver-loop console error; stable memory on rotate. Verification ends `human_needed`. The Phase-47 doc's deferred item #2 ("real-device authed walkthrough … formally Phase 48 SC#5") is the carry-forward this file fulfills.

---

## Shared Patterns

### Breakpoint gate (the ONE spelling)
**Source:** `src/hooks/useBreakpoint.ts:25-30` (`mobile` = `max-width:639px`), canonical call `HeatmapPanels.tsx:263` (`useBreakpoint() === "mobile"`).
**Apply to:** `TouchTooltip` (Recharts `trigger`); EquityChart (if reducing tick density at mobile — only if the ~12px floor is breached).
**Do NOT** add an orientation media query (UI-SPEC Portrait §: width breakpoint, not orientation).

### useTapPin gesture core (hand-rolled charts only)
**Source:** `src/hooks/useTapPin.ts` (the hook) + LIVE call site `HeatmapPanels.tsx:398-451` (the wiring template).
**Apply to:** EquityChart ONLY. NEVER to Recharts charts (Recharts owns its own pointer layer — Anti-Pattern, locked).
```ts
// useTapPin.ts:66-83 — the returned surface to wire:
selectedIdx, pinned, setChartEl,
onPointerDown, onPointerMove, onPointerUp, onPointerLeave
```
`setChartEl` is a callback ref (no `.current` mutation, react-compiler-safe, L107-109).

### axe harness (single factory, no second harness)
**Source:** `e2e/helpers/axe.ts:15-21` — `buildAxe(page).withTags(["wcag2a","wcag2aa","best-practice"])`.
**Apply to:** `axe-app-wide.spec.ts` (do NOT introduce jest-axe or a second AxeBuilder config).

### serious+critical scoped filter (embedded factsheet ONLY)
**Source:** `e2e/composer-axe.spec.ts:208-212`.
**Apply to:** the composer/embedded-factsheet rows of `axe-app-wide.spec.ts`. Standalone routes stay STRICT (`expect(results.violations).toEqual([])`, Assumption A2). NEVER disable a rule.

### Anti-false-green visible-anchor gate
**Source:** `reflow-sweep.spec.ts:70-79` (HTTP≥400 throw) + `composer-axe.spec.ts:104-106` (`expect(locator).toBeVisible()` before analyze).
**Apply to:** every analyze()/measure() in `axe-app-wide.spec.ts` and `target-size.spec.ts` (fail loud on blank/404/login chrome — Pitfall 4).

### FLOW-01 dual-wiring (the burned-≥3× lesson)
**Source:** `ci.yml:1250-1251` reminder comment + `composer-axe.spec.ts:54-56` (`HAS_SEED_ENV`) + `reflow-sweep.spec.ts:23-35` (the "two switches" doc-comment).
**Apply to:** `axe-app-wide.spec.ts` — BOTH the spec's `HAS_SEED_ENV` self-skip AND the `ci.yml` Playwright list(s). Prove it RAN in CI (Pitfall 3). `target-size.spec.ts` + `reflow-sweep-authed.spec.ts` are ALREADY dual-wired (additive folds need no new wiring).

### Coverage ratchet (branches 72)
**Source:** `vitest.config.ts:73-77` (lines 82 / stmts 80 / fns 74 / branches 72), measured actual 85.2 / 83.3 / 77.4 / 75.5.
**Apply to:** `TouchTooltip` ternary + EquityChart touch path — both new viewport conditionals need branch coverage. NEVER lower a threshold or blanket-update a snapshot. Run `npm run test:coverage` after; report new actuals.

### Frozen-math / byte-identity / parity guards (verify-only, un-weakened)
**Sources:** `src/__tests__/phase-31-frozen-spine-guards.test.ts` (SCENARIO-05 zero-diff); `tests/visual/chart-accessibility-layer.test.ts` (the `accessibilityLayer={false}` whole-codebase grep — the `<Tooltip>` swap must NOT trip it, Pitfall 5); `e2e/svg-chart-parity.spec.ts` (Phase-47 carryover — self-skips until goldens baked; do NOT make false-green); BODY-02 factsheet byte-identity; existing `EquityChart.test.tsx` + per-chart `.test.tsx` (desktop render byte-identical).
**Apply to:** all 18 chart edits + EquityChart. These are the falsifiable proof of "no rewrite/no recompute."

---

## No Analog Found

None. Every new/modified file maps to a live analog. The two files with the weakest match (`lighthouserc.json`, `TouchTooltip.tsx`) have no exact predecessor in-repo but a strong external/derived pattern:

| File | Role | Data Flow | Note |
|------|------|-----------|------|
| `lighthouserc.json` | config | batch | No existing lhci config (net-new dep). Pattern is RESEARCH Pattern 4 (official lighthouse-ci docs) + the e2e job's start-server shape (`ci.yml:1047-1059`). Seed `minScore` from a baseline run. |
| `TouchTooltip.tsx` | component | request-response | No existing chart-wrapper shim. Pattern is RESEARCH Pattern 1 (verified `Tooltip.d.ts` API) + the canonical `useBreakpoint() === "mobile"` gate from `HeatmapPanels.tsx:263`. |

---

## Metadata

**Analog search scope:** `src/components/charts/`, `src/components/portfolio/`, `src/components/strategy/`, `src/app/(dashboard)/allocations/widgets/**`, `src/app/factsheet/[id]/v2/`, `src/hooks/`, `e2e/`, `e2e/helpers/`, `.github/workflows/`, `.planning/phases/47-*/`.
**Files scanned (read in full or targeted):** `useTapPin.ts`, `useBreakpoint.ts`, `e2e/helpers/axe.ts`, `composer-axe.spec.ts`, `reflow-sweep.spec.ts`, `target-size.spec.ts`, `RollingMetrics.tsx`, `CompositionDonut.tsx`, `HeatmapPanels.tsx`, `OutcomesWidget.tsx`, `EquityChart.tsx` (targeted: L490-549, L1138-1168, L1418-1435, plus grep of handlers/hoverIdx), `chart-tokens.ts`, `ci.yml` (L1040-1109, L1240-1279, job-list grep), `47-HUMAN-UAT.md`. Existence-confirmed net-new: `TouchTooltip.tsx`, `axe-app-wide.spec.ts`, `lighthouserc.json` (all absent — confirmed net-new).
**Pattern extraction date:** 2026-06-28
