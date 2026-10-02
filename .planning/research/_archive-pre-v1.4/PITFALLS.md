# Pitfalls Research

**Domain:** Retrofitting app-wide responsive / mobile / WCAG-AA onto an existing desktop-first dense-chart financial dashboard (Quantalyze v1.3 — Next.js 16 App Router, hand-rolled D3/SVG + Canvas + Recharts charts, frozen `scenario.ts` math engine)
**Researched:** 2026-06-27
**Confidence:** HIGH (codebase-grounded — every pitfall maps to a real file/guard already in the repo; external claims verified against axe-core/Deque + WCAG docs)

> **How to read this for the roadmap.** v1.3 is structured as four phase-clusters:
> **FOUNDATION** (viewport meta, layout shell, breakpoint tokens, hydration-safe responsive primitive, app-wide axe extension), **SURFACE-BY-SURFACE** (each authed/public route reflows + tables + nav), **CHARTS** (the 7-panel factsheet + heatmaps + composer charts reworked for portrait/touch, presentation-layer-only), **VERIFICATION** (reflow/zoom/touch automated gates + mobile perf budget + real-device authed walkthrough). Each pitfall below names which cluster **owns** prevention so the roadmap can encode the gate at the right phase. The repeating meta-risk: **this is a retrofit, not a greenfield build — every change rides on top of frozen math, a byte-identity factsheet guard, a no-invented-data invariant, and a coverage ratchet. The expensive failures are regressions, not missing features.**

---

## Critical Pitfalls

### Pitfall 1: SSR/hydration mismatch from viewport-branching at render time

**What goes wrong:**
A component reads `window.innerWidth` / `window.matchMedia` / `navigator` during render to pick a mobile vs desktop tree. The server has no viewport, so SSR emits the desktop tree (or throws), the client computes the real viewport, and the two diverge — React throws a hydration error, blanks the subtree, or (worse) silently double-renders with a layout-shift flash. In an App Router RSC tree this also forces otherwise-server components to `"use client"` purely to read viewport, ballooning the client bundle.

**Why it happens:**
The instinctive way to "make it responsive in JS" is `const isMobile = useMediaQuery('(max-width: 640px)')` and branch the JSX. It works in dev (client-only fast refresh) and fails in production SSR. The team will reach for it because the codebase already has `matchMedia`-based components (`DesktopGate.tsx`, `MobileSidebarDrawer.tsx` `md:hidden`).

**How to avoid:**
- **CSS-first responsiveness is the default; JS viewport reads are the exception.** Reflow with Tailwind responsive utilities (`md:`, `lg:`), CSS grid/flex, and container queries — these render identically on server and client, so there is no mismatch and no `"use client"` tax. This is the single most important foundation decision.
- When JS *must* branch on viewport (e.g. swap a data-table for stacked cards, mount a different chart layout), use the **two-pass mount pattern the codebase already proves correct**: initialize state to `null`, render the SSR-stable tree on the first pass, resolve viewport in `useEffect`, upgrade on the second pass. `DesktopGate.tsx:73` (`if (isNarrow === null) return <>{children}</>`) and the documented `strategy.ui_v2` SSR-safe pattern (DESIGN.md 2026-04-29 decision, "SSR branch returns false, two-pass mount via useEffect") are the canonical references — reuse them, do not reinvent.
- Provide **one** shared `useViewport`/`useBreakpoint` hook with the two-pass contract baked in, so 40 surfaces don't each hand-roll (and mis-roll) the mismatch guard.

**Warning signs:**
- A new component imports `useState`/`useEffect` solely to read `innerWidth`.
- Hydration warnings in the Next dev overlay on any retrofitted route.
- A "flash of desktop layout" on mobile first paint.
- A previously-server component sprouts `"use client"` with no interactivity reason.

**Phase to address:** FOUNDATION (establish the CSS-first rule + ship the one two-pass `useBreakpoint` hook before any surface work). Re-verified per-surface in SURFACE-BY-SURFACE.

---

### Pitfall 2: A zoom-blocking viewport meta tag silently fails WCAG 1.4.4 (and axe won't catch it)

**What goes wrong:**
Someone adds `maximum-scale=1` or `user-scalable=no` to the viewport meta (a reflexive "fix" for a layout that breaks under zoom, or copied from a mobile-app template). This disables pinch-zoom and browser zoom on the affected platforms — an outright **WCAG 1.4.4 (Resize Text) failure** — and it is invisible to every automated suite the project runs, because axe-core does not flag it.

**Why it happens:**
When a fixed-px layout breaks under zoom, blocking zoom *looks* like it fixes the symptom. It's a one-line change. Nobody re-reads the meta tag during QA.

**How to avoid:**
- **Audit the root viewport config now.** The current root layout (`src/app/layout.tsx`) has **no** `export const viewport` — Next.js 16's default is `width=device-width, initial-scale=1`, which is zoom-permissive and correct. The pitfall is *introducing* a restriction. Add a guard test (grep/source-scan, in the spirit of `composer-width.test.tsx`) asserting the viewport config never contains `maximum-scale` or `user-scalable=no`. This is a cheap, durable, false-green-proof gate.
- Fix layouts to *survive* zoom (Pitfall 3), never to *prevent* it.

**Warning signs:**
- Any diff touching `export const viewport` or a `<meta name="viewport">`.
- Pinch-zoom does nothing on a real device.

**Phase to address:** FOUNDATION (set + lock the viewport config + add the grep guard). Verified in VERIFICATION.

---

### Pitfall 3: Fixed-px layouts break under 400% zoom / 320px reflow — the user's explicit requirement, and the one axe cannot test

**What goes wrong:**
WCAG 1.4.10 (Reflow) requires content to be usable at **320 CSS px wide with no horizontal scrolling** (equivalent to 400% zoom on a 1280px window). Fixed pixel widths, `min-width` on containers, `max-w-[1440px]` composer bodies, fixed-260px sidebars, and wide multi-column grids that don't collapse all produce a horizontal scrollbar or clipped content at that width. This is the headline requirement the user called out — and **axe-core cannot detect it** (axe finds ~57% of WCAG issues automatically and reflow/zoom is explicitly outside that set per Deque).

**Why it happens:**
- The app is desktop-first: DESIGN.md hard-codes `Max content width: 1100px`, `Sidebar width: 260px (fixed)`, `--space-grid-gap: 10px` with breakpoints "baked into WidgetGrid's inline `<style>` at 980px/640px," and the composer body was just widened to `max-w-[1440px]` (v1.2.1, `composer-width.test.tsx`). These are reasonable desktop values that become reflow traps.
- The existing axe gate (`composer-axe.spec.ts`, `discovery-axe.spec.ts`, etc.) is run at the Playwright default desktop viewport (`Desktop Chrome`, `playwright.config.ts:23`). A green axe run gives **false confidence** that the page is accessible — it has never been measured at 320px.

**How to avoid:**
- Add an **automated reflow gate**: a Playwright spec that sets `page.setViewportSize({ width: 320, height: 800 })` (and a second pass at a 400%-zoom-equivalent emulation) on every in-scope route and asserts **no horizontal scroll** — `document.documentElement.scrollWidth <= clientWidth` (allow a 1px sub-pixel slop). This is the falsifiable guard that encodes the user's requirement. Fail loudly on overflow; assert a visible content anchor first so it can't false-green on a blank page (the same anti-false-green idiom `composer-axe.spec.ts` already uses).
- Replace fixed widths with fluid + `max-w-*` (not `width:`/`min-width:`), let grids collapse to single-column under a breakpoint, make the sidebar a drawer below `md` (already exists: `MobileSidebarDrawer.tsx`), and audit every `min-w-*`, fixed `w-[…px]`, and inline `<style>` breakpoint (the WidgetGrid 980/640 inline block is a known hot spot).
- **Tables and charts are the two worst offenders** — handled as their own pitfalls (4, 6, 7).

**Warning signs:**
- A horizontal scrollbar appears anywhere at 320px / 400% zoom.
- Content clips behind the sidebar or off the right edge.
- `composer-width.test.tsx`-style fixed-width literals proliferate without a `max-w` (a cap is fine; a floor is the trap).

**Phase to address:** FOUNDATION owns the reflow gate harness + the fluid-layout shell + sidebar→drawer. SURFACE-BY-SURFACE fixes each route to pass it. VERIFICATION runs it app-wide as a blocking CI gate.

---

### Pitfall 4: Responsive tables that DROP columns silently cross into a no-invented-data honesty violation

**What goes wrong:**
The most common "mobile table" pattern is to hide columns at narrow widths (`hidden md:table-cell`). On a financial dashboard this means a mobile user sees a strategy/holdings/compare table with **columns silently removed** — they're looking at a different, smaller truth than the desktop user, with no indication data was withheld. For a product whose entire identity is **no-invented-data / honest degenerate states** (the LOCKED invariant), *hiding* material columns is the mirror image of *inventing* them: both present a distorted picture as if it were complete. A `ScenarioCompareTable` that drops the Sharpe column on mobile, or a holdings table that drops the revoked-key warning column, is a correctness/honesty regression, not a styling choice.

**Why it happens:**
`hidden md:table-cell` is the path of least resistance and looks clean. The honesty implication is non-obvious because the columns are still "there in the code." The grep already shows `hidden sm:`/`md:hidden`/`truncate` patterns scattered across `ScenarioCompareTable.tsx`, `CorrelationMatrix.tsx`, admin tables, and portfolio pages — exactly the surfaces where dropped data matters.

**How to avoid:**
- **Reflow tables by reshaping, not by deleting.** Approved patterns: (a) horizontal-scroll the table inside a bounded `overflow-x-auto` container *with a visible affordance* (so all columns remain reachable — scrolling is honest, hiding is not); (b) transpose to a stacked "label: value" card list on mobile where **every** field is still present; (c) a genuine, labeled *summary* view with an explicit "view full table" expansion. The rule mirrors DESIGN.md's existing 9-state honesty discipline.
- **Never** use `truncate` or `hidden` on a column carrying a material metric, a warning/status indicator (e.g. revoked-key amber chip), or a value a user would act on, unless the full value is reachable some other way on the same viewport.
- Add a guard for the highest-stakes tables: a test asserting the mobile rendering still contains every column's data (e.g. the compare table's full metric set), so a future `hidden` edit fails loudly.
- This is the one pitfall where responsive work can **regress a LOCKED invariant** — flag it for the roadmap as a risk gate equivalent to the prior milestones' silent-failure gates (IMPACT-02, BODY-02).

**Warning signs:**
- `hidden md:` / `lg:hidden` applied to a `<td>`/`<th>` carrying a number or status.
- Mobile and desktop renders of the same table show a different column count with no "scroll/expand for more" affordance.
- A reviewer can't answer "where does the dropped column's data go on mobile?"

**Phase to address:** SURFACE-BY-SURFACE owns each table's reshape + the honesty guard. The *policy* ("reshape, never drop material data") is a FOUNDATION decision recorded in DESIGN.md so every surface follows it.

---

### Pitfall 5: Hover-only chart tooltips become unreachable on touch — silent data loss on mobile

**What goes wrong:**
Dense factsheet charts surface their precise values through hover tooltips/crosshairs. On touch devices there is no hover — `mouseenter`/`mousemove` either never fire or fire once and stick. A naive port leaves mobile users with a pretty line they **cannot read any value off**. On a factsheet whose whole purpose is precise institutional metrics, that is data loss, and it edges toward the no-invented-data spirit (the value exists but is unreachable, so the chart implies less precision than it has).

**Why it happens:**
The charts were built mouse-first. Recharts' default `Tooltip` is hover-triggered. The hand-rolled `TimeSeriesChart`/`MasterBrush` use pointer events that *can* handle touch but must be explicitly wired for it.

**How to avoid:**
- **Good news — the hand-rolled `TimeSeriesChart` already has a touch-aware crosshair** (`TimeSeriesChart.tsx`: `pinned` state, tap-vs-drag detection via `TAP_SLOP`/`TAP_MS`, `tapInfoRef`, pointer-event math that divides by `rect.width` so it works at any rendered width). The pattern to **propagate** is: tap pins the crosshair so the value stays readable after the finger lifts; tap elsewhere/away clears it. The CHARTS phase must ensure *every* value-bearing chart (Recharts `ResponsiveContainer` panels in `src/components/charts/*`, the heatmaps, the composer charts) gets an equivalent touch affordance — not just the one chart that already has it.
- For Recharts charts, enable touch interaction explicitly (tap-to-show tooltip) and verify it; do not assume the default hover tooltip degrades gracefully.
- Provide a **non-pointer fallback for the most important values** regardless of device: the data-density principle in DESIGN.md already says surface metrics as KPI cells/strips next to the chart, not only in the tooltip. DESIGN.md's 2026-04-30 `accessibilityLayer` decision explicitly relies on "chart data is also surfaced via KPI cells in panel grids" — keep that invariant; it's both the a11y story and the touch story.

**Warning signs:**
- A chart shows no value on tap on a real phone.
- A tooltip appears on first tap and never updates or never clears.
- The only place a precise number lives is a `:hover` tooltip.

**Phase to address:** CHARTS (propagate the pinned-crosshair touch pattern to all value-bearing charts; verify Recharts tap behavior). VERIFICATION includes a touch-interaction check in the real-device walkthrough.

---

### Pitfall 6: Touch targets below 44px — invisible to axe, required by the milestone

**What goes wrong:**
Dense desktop UIs pack 12px icon buttons, tight tab strips, table-row action links, chart legend toggles, and the composer's collapsible controls into small hit areas. WCAG 2.5.8 / the milestone's stated "44px touch targets" require ~44×44px minimum. **axe-core does not reliably test target size** (per Deque, `target-size` is the *one* WCAG 2.2 rule they expect to add, and even that is partial) — so a green axe run says nothing about tap targets. On a financial dashboard the tight legend toggles and table actions are exactly the controls that shrink below 44px.

**Why it happens:**
DESIGN.md is deliberately dense ("tighter than typical SaaS," 10–11px micro labels, 12px captions, `--space-grid-gap: 10px`). Density and 44px targets are in direct tension, and the desktop design optimized for density. Reviewers eyeball "looks tappable" without measuring.

**How to avoid:**
- Set a **minimum hit-area utility** (e.g. a `min-h-11 min-w-11` / pseudo-element hit-expander) applied to every interactive control on touch viewports, decoupling visual size from hit size (a 16px icon can keep its look while its tappable area is 44px).
- Add an **automated target-size check** in Playwright (measure `getBoundingClientRect()` of interactive elements at mobile viewport, assert ≥44px or an expanded hit area) — axe won't do it, so this is a bespoke gate. Scope it to the touch viewport runs.
- Pay special attention to: chart legend mute/toggle, the composer's collapsible compose controls (which fold into the factsheet layout per Phase 43), tab strips, table-row action buttons, and the `MasterBrush` drag handles.

**Warning signs:**
- Two adjacent tap targets are <44px apart or <44px each at mobile width.
- Users "fat-finger" the wrong control on a real device.

**Phase to address:** FOUNDATION provides the hit-area utility + the target-size Playwright check. SURFACE-BY-SURFACE and CHARTS apply it. VERIFICATION runs the check app-wide.

---

### Pitfall 7: Performance collapse on mobile from heavy SVG/Canvas + ResizeObserver re-render storms

**What goes wrong:**
The 7-panel factsheet renders multiple hand-rolled SVG charts (each `TimeSeriesChart` ~880-unit viewBox with per-point geometry), Canvas dual-renderers (`HeatmapPanels`, `DailyHeatmap`), and now a Web Worker Monte-Carlo. On a mid-range phone this causes: (a) jank/long main-thread tasks during scroll and pan; (b) memory pressure from large Canvas backing stores and retained SVG node trees; (c) **ResizeObserver feedback storms** — a responsive chart that resizes on every observed dimension change, where the resize itself nudges layout, can loop or fire dozens of times during an orientation change / drawer open / address-bar collapse, each firing a full chart re-render. The factsheet already uses `ResizeObserver` in `TimeSeriesChart`, `HeatmapPanels`, `MasterBrush`, and many widgets.

**Why it happens:**
- Charts were sized for one desktop width; making them fluid means subscribing to width changes, and the easy wiring (`ResizeObserver` → `setState(width)` → re-render) is exactly the storm pattern.
- The factsheet was a desktop scroll page; nobody profiled it on a throttled mobile CPU.
- Mobile browser chrome (collapsing address bar) fires resize/viewport events the desktop never did.

**How to avoid:**
- **Lean on the viewBox + `preserveAspectRatio` scaling that `TimeSeriesChart` already uses** (`viewBox="0 0 880 {h}"`, `preserveAspectRatio="xMidYMid meet"`, `width:100%`). Because the SVG scales via CSS, it does **not** need a JS resize→re-render to change pixel width — the browser scales it for free. Prefer this CSS-scaling approach over ResizeObserver-driven re-layout wherever the chart's internal tick/label density doesn't need to change (this also sidesteps most storm risk). Reserve ResizeObserver for cases that genuinely need to recompute tick counts/labels.
- Where ResizeObserver is required: **debounce/coalesce** via `requestAnimationFrame`, guard against no-op width changes (`if (next === prev) return`), and wrap callbacks so a resize can't synchronously trigger a layout that re-fires the observer (the classic loop). Keep the `useDeferredValue`/`React.memo` discipline `TimeSeriesChart` already applies.
- Keep the existing **`IntersectionObserver`-deferred mount of panels 4–7** (DESIGN.md 2026-04-29 UC#7) — it's the load-time budget guard and must survive the responsive rework.
- Establish a **mobile performance budget** (the milestone already calls for one): TTI/INP and main-thread long-task thresholds, measured on a throttled profile, as a VERIFICATION gate. Canvas heatmaps should cap backing-store size to the device pixel ratio × rendered size, not the data resolution.

**Warning signs:**
- Visible jank when panning a chart or rotating the device.
- ResizeObserver callback fires many times per interaction (console-count it).
- Memory grows on each orientation change (Canvas not released).
- A "ResizeObserver loop limit exceeded" console error (the storm's signature).

**Phase to address:** CHARTS owns the per-chart scaling strategy + ResizeObserver discipline. VERIFICATION owns the mobile perf budget gate.

---

### Pitfall 8: Charts whose internal text/density is fixed in viewBox units become illegible on mobile (a 1.4.4 trap axe misses)

**What goes wrong:**
`TimeSeriesChart` lays out axis ticks, tooltips, and labels in **viewBox units** (the 880-wide coordinate space), then scales the whole SVG to the container with `preserveAspectRatio` + `width:100%`. On desktop at ~880px this is crisp. On a 320px phone the entire 880-unit drawing — *including the text* — shrinks to ~36% scale, so a "12px" axis tick renders at ~4–5 effective px and the tooltip text is unreadable. The chart technically "fits" (no horizontal scroll, so Pitfall 3's gate passes) but fails **WCAG 1.4.4 Resize Text** and is practically useless. This is a subtle trap because the reflow gate and axe both pass.

**Why it happens:**
viewBox scaling is the *correct* fix for chart *width* responsiveness (Pitfall 7) — but it scales text proportionally too, which is wrong for legibility. The team will (rightly) adopt viewBox scaling and (wrongly) assume that finishes the job.

**How to avoid:**
- On narrow viewports, **render fewer, larger elements rather than the same dense chart shrunk**: reduce tick count, drop minor gridlines, increase font size in viewBox units (or render labels in real px via an HTML overlay rather than SVG text), and consider a portrait-optimized layout for the densest panels (the milestone explicitly scopes "charts reworked for portrait/touch").
- Where text must stay legible, take it out of the scaled SVG: position labels/tooltips as absolutely-positioned HTML in real CSS px over the chart, so they don't shrink with the viewBox.
- **Presentation-layer only** — changing tick count / label layout / portrait arrangement is rendering; the underlying series and computed metrics from `scenario.ts`/`compute.ts` must be byte-identical (Pitfall 9).
- Add a portrait/mobile snapshot to the existing Playwright chart-parity suite (`strategy-v2-chart-parity.spec.ts`) so the portrait layout is pinned and legibility regressions are visible.

**Warning signs:**
- Axis labels/tooltips are sub-readable on a real phone even though "the chart fits."
- A reviewer zooms the browser to read a chart's own labels.

**Phase to address:** CHARTS.

---

### Pitfall 9: Regressing the FROZEN chart math while reworking the renderer

**What goes wrong:**
"Rework the charts for mobile" tempts edits that cross from presentation into computation: re-deriving a series in the component, re-sampling/downsampling points for mobile "to make it lighter," recomputing a domain or an annualization, or "fixing" a degenerate case inline. Any of these regresses the frozen `scenario.ts` engine (SCENARIO-05 zero-diff), breaks `compute.ts` parity, violates the byte-identity factsheet guard (BODY-02), or fabricates/alters values — a no-invented-data violation.

**Why it happens:**
The math and the render live close together; under "make the chart responsive" pressure it's easy to reach one layer too deep. Downsampling for mobile perf is the most seductive trap because it sounds like a pure-perf win but it *changes the displayed data*.

**How to avoid:**
- **Hard boundary: the responsive rework consumes `scenario.ts`/`compute.ts` output and changes only geometry, layout, scale, ticks, interaction.** No re-derivation of returns/metrics/domains in the chart layer. If a chart needs a value, it reads it from the existing payload (`usePayload()`), never recomputes it.
- The existing guards are the safety net — **keep them passing, don't weaken them**: `scenario.test.ts` SCENARIO-05 zero-diff, the factsheet byte-identity guard (BODY-02), `compute.ts` parity, and the chart-parity snapshots (`strategy-v2-chart-parity.spec.ts`, ±2%/±5%). A responsive change that trips byte-identity is a signal you crossed the line, not a guard to relax.
- If mobile perf demands fewer plotted points, do it as a **render-only decimation that is visually labeled and reversible** (and never on the values a user reads off the crosshair) — but prefer CSS/viewBox scaling (Pitfall 7) which needs no data change at all.
- The composer reuses the REAL `FactsheetBody`/`TimeSeriesChart` under `persist={false}` + `scenarioMode` (v1.2.1/v1.2.2). Responsive edits to those shared components must stay byte-identical for the standalone `/factsheet/[id]` route — the composer-vs-factsheet shared-component reuse is a regression multiplier.

**Warning signs:**
- A chart component imports from `scenario.ts`/`compute.ts` and *calls* a compute function (vs reading a precomputed field).
- `scenario.test.ts` SCENARIO-05 or the byte-identity factsheet guard goes red during chart work.
- A diff touches a `useMemo` that derives a metric inside a chart component.

**Phase to address:** CHARTS (with the frozen-engine guards as the gate; this is the highest-cost regression in the milestone and should be called out as a roadmap risk gate, equal to IMPACT-02/BODY-02 in prior milestones).

---

### Pitfall 10: Mobile-nav a11y — hand-rolled focus traps, missing skip-links, broken drawer focus management

**What goes wrong:**
Mobile nav introduces a drawer/hamburger, a bottom nav, and possibly a collapsed top bar. The classic failures: (a) the drawer doesn't trap focus, so Tab leaks to the page hidden behind the backdrop (WCAG 2.1.2 No Keyboard Trap / focus-order failures); (b) focus isn't moved into the drawer on open or restored to the trigger on close, disorienting keyboard/screen-reader users; (c) no skip-link, so keyboard users must tab through the whole nav on every page; (d) the underlying page isn't `inert`/`aria-hidden`, so screen readers and Tab still reach it; (e) body scroll isn't locked, so the backdrop scrolls the page underneath.

**Why it happens:**
Focus management is fiddly and easy to get subtly wrong; teams hand-roll it. This codebase **already has** a hand-rolled trap in `MobileSidebarDrawer.tsx` — and its own comments record that a **prior audit (2026-05-07 G11.C.2) caught exactly this leak** (`aria-modal="true"` declared but focus never contained). That's both a warning (the trap is hand-rolled and has bitten before) and an asset (the corrected pattern exists).

**How to avoid:**
- **Reuse and extend `MobileSidebarDrawer.tsx`'s corrected pattern** rather than writing new traps per surface: Escape-to-close, Tab/Shift+Tab cycling among focusable descendants, body-scroll lock with restore-on-unmount, initial focus into the drawer, focus restoration to `triggerRef` *only on the close transition* (the `prevOpenRef` WR-03 fix). Any new drawer/sheet/modal in v1.3 (browse drawer, bridge drawer, commit drawer already exist; mobile may add more) must meet the same contract.
- **Harden the trap**: prefer marking the background `inert` (now broadly supported) so the page behind is truly unreachable, rather than relying solely on the JS Tab-cycle. This is more robust than the manual `querySelectorAll(FOCUSABLE_SELECTOR)` cycle, which can miss dynamically-added focusables.
- **Add a skip-link** to main content app-wide (the factsheet `FactsheetView.tsx` already has a skip mechanism per the grep + DESIGN.md UI-SPEC §7.3 — generalize it to the app shell).
- **axe will catch *some* of this** (e.g. `aria-hidden` on focusable content, missing accessible name) but **not** focus-trap correctness, focus-restoration, or skip-link presence — those need the **keyboard e2e** pattern that already exists (`strategy-v2-keyboard.spec.ts`). Add a mobile-drawer keyboard spec asserting Tab containment + restoration.

**Warning signs:**
- Tab from inside the open drawer reaches a link behind the backdrop.
- Focus doesn't return to the hamburger on close.
- No skip-link; keyboard users tab through nav on every route.
- A screen reader reads the page behind the open drawer.

**Phase to address:** FOUNDATION (app-shell drawer + skip-link + the shared trap contract + the keyboard e2e). SURFACE-BY-SURFACE for any per-surface sheets.

---

### Pitfall 11: axe-core false confidence — a green app-wide axe gate hides reflow, zoom, touch-target, and focus-management failures

**What goes wrong:**
The milestone says "extend the WCAG-AA axe gate app-wide," which is correct and necessary — but axe-core finds only **~57% of WCAG issues** (Deque's own figure) and **structurally cannot test** the four things this milestone is *most* about: **1.4.10 Reflow**, **1.4.4 Resize Text / zoom**, **2.5.8 Target Size (touch)**, and **focus-trap/focus-restoration correctness**. The risk is that the team ships green axe across all routes and *believes* the responsive/mobile/a11y goal is met, when the headline requirements were never machine-checked. This is the single most likely way v1.3 "looks done but isn't."

**Why it happens:**
axe is the established, trusted gate (`composer-axe.spec.ts` and four siblings already enforce zero violations). "All axe gates green" reads as "accessible." The gap between what axe covers and what the milestone requires is invisible unless someone names it.

**How to avoid:**
- **Treat the app-wide axe extension as necessary-but-insufficient and pair it, in the roadmap, with the bespoke gates that fill axe's blind spots:**
  - Reflow / no-horizontal-scroll at 320px + 400%-zoom-equivalent (Pitfall 3) — bespoke Playwright.
  - Zoom-not-blocked viewport-meta grep (Pitfall 2).
  - Touch-target ≥44px measurement (Pitfall 6) — bespoke Playwright.
  - Keyboard focus-trap/restoration/skip-link (Pitfall 10) — keyboard e2e.
  - Chart legibility/touch on a real device (Pitfalls 5, 8) — the manual authed walkthrough (headless can't hydrate authed pages — a known, recorded constraint).
- **Run axe at mobile viewport too**, not only the default desktop `Desktop Chrome` (`playwright.config.ts`). Some violations (contrast of reflowed elements, names of mobile-only controls) only appear in the mobile tree. Consider a Playwright mobile project/device.
- **Watch the embedded-factsheet landmark exception.** `composer-axe.spec.ts` already had to filter the composed scan to `serious+critical` because the embedded `FactsheetBody` legitimately nests landmarks under the page `<main>`. As more surfaces embed shared composites responsively, the same "moderate landmark nit on legitimately-nested composite" will recur — handle it the same scoped way (filter impact, never disable the rule), and never let that filtering quietly drop a *real* violation.

**Warning signs:**
- The roadmap's a11y acceptance criterion is "axe passes" with no reflow/zoom/touch/keyboard gate beside it.
- A route is "done" on axe but never measured at 320px or on a phone.

**Phase to address:** VERIFICATION owns the combined gate matrix. FOUNDATION builds the bespoke harnesses so SURFACE-BY-SURFACE has them to run.

---

### Pitfall 12: Large UI churn regresses the coverage ratchet and existing guards

**What goes wrong:**
v1.3 touches dozens of components across every surface. The coverage ratchet (lines 82 / statements 80 / functions 74 / branches 72, `vitest.config.ts`) is a **blocking CI gate**. Responsive refactors add branches (viewport conditionals, new mobile paths) and new components — branch coverage in particular drops fast when you add `isMobile ?` forks without tests. Simultaneously, byte-identity factsheet guards, `composer-width.test.tsx` literals, the `accessibilityLayer` whole-codebase grep guard, the chart-parity snapshots, and the existing axe specs can all break from layout edits — and the team may be tempted to *weaken* a guard (loosen a threshold, snapshot-update without inspecting, scope an axe filter too broadly) to get green.

**Why it happens:**
Large churn + a strict ratchet + many source-scan guards = lots of red, fast. Under ship pressure, lowering a threshold or blanket-updating snapshots is the quick escape — and it silently erodes the protection the prior milestones built. The MEMORY notes already warn that vitest parallel-suite contention causes flakes under load, which compounds the temptation to "just rerun / just lower it."

**How to avoid:**
- **Budget test-writing into every responsive phase**, not as a trailing cleanup. New viewport branches need branch coverage; new mobile components need tests. The ratchet is "a few points under measured actual" by design — keep actual climbing, raise thresholds when durable, **never lower them** to pass.
- **Never weaken a guard to go green.** A red byte-identity / SCENARIO-05 / chart-parity guard is *information* (you regressed math or the factsheet), not an obstacle. Snapshot updates must be inspected, not blanket-accepted. axe impact-filtering must stay `serious+critical`-scoped and per-surface-justified (the composer precedent), never a rule disable.
- **Respect the known flake profile**: the suite has documented parallel-contention flakes under CPU load (`vitest.config.ts` `maxThreads` cap; MEMORY's `--no-file-parallelism` note). Don't misread a contention flake as a real failure and "fix" it by deleting a test or loosening an assertion. Reproduce in isolation before acting.
- Add the **new** v1.3 gates (reflow, target-size, zoom-meta, mobile keyboard, mobile axe, perf budget) to CI deliberately — and remember the FLOW-01 lesson from MEMORY: a new seed-gated e2e must be wired into **both** the `HAS_SEED_ENV`/CI device-list **and** `ci.yml`, or it never actually runs (a false-green by omission).

**Warning signs:**
- A PR lowers a coverage threshold or blanket-updates snapshots.
- Branch coverage drops after adding viewport conditionals.
- A new responsive e2e exists but isn't in `ci.yml` (never runs).
- A guard is disabled/filtered "temporarily."

**Phase to address:** Every phase (test-as-you-go); VERIFICATION owns the final ratchet check + confirming all new gates are CI-wired and the old guards still pass un-weakened.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `useMediaQuery`/`innerWidth` branch in render to pick mobile tree | Fast, reads naturally | Hydration mismatch, forced `"use client"`, bundle bloat (Pitfall 1) | Never at SSR boundary; only inside the shared two-pass hook |
| `maximum-scale=1` / `user-scalable=no` to "fix" zoom-breaking layout | Layout stops overflowing under zoom | WCAG 1.4.4 fail, invisible to axe (Pitfall 2) | Never |
| `hidden md:table-cell` to drop columns on mobile | Clean-looking mobile table in one line | No-invented-data honesty violation; users see a distorted truth (Pitfall 4) | Only for genuinely non-material decoration, never material metrics/status |
| ResizeObserver → `setState(width)` → full re-render per chart | "Responsive" charts quickly | Re-render storms, jank, ResizeObserver loops on mobile (Pitfall 7) | Only with rAF-coalescing + no-op guard; prefer CSS viewBox scaling |
| Downsample chart points "for mobile perf" | Lighter charts | Regresses frozen math / no-invented-data if it changes displayed values (Pitfall 9) | Render-only, labeled, never on read-off values; prefer CSS scaling |
| Hand-roll a focus trap per drawer | Self-contained | Subtle leaks (already bit this repo, G11.C.2); drift across surfaces (Pitfall 10) | Reuse the one corrected `MobileSidebarDrawer` contract; prefer `inert` |
| Blanket snapshot-update / lower a coverage threshold to go green | Unblocks the PR | Silently erodes byte-identity / parity / coverage protection (Pitfall 12) | Never; inspect every snapshot, never lower the ratchet |
| Lean on app-wide axe as the a11y acceptance criterion | One trusted gate | False confidence — misses reflow/zoom/touch/focus (Pitfall 11) | Only paired with the bespoke gates |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Next.js 16 App Router (RSC) | Reading viewport in a server-renderable component → forced `"use client"` + mismatch | CSS-first responsiveness; isolate the one two-pass `useBreakpoint` client hook |
| Recharts (`ResponsiveContainer` panels in `src/components/charts/*`) | Assuming default hover `Tooltip` works on touch | Explicit tap-to-show tooltip + KPI-cell value fallback (Pitfalls 5, 8) |
| Hand-rolled SVG (`TimeSeriesChart`/`MasterBrush`/`Distribution`/`Heatmap`) | New ResizeObserver re-layout per chart | Reuse the existing viewBox + `preserveAspectRatio` CSS scaling; pointer math already width-agnostic |
| Canvas dual-renderers (`HeatmapPanels`, `DailyHeatmap`) | Backing store sized to data resolution → memory blowup on mobile | Size backing store to devicePixelRatio × rendered px; release on unmount |
| Web Worker Monte-Carlo (`montecarlo-runner.ts`) | Spawning/holding the worker on mobile regardless of viewport | Keep worker lifecycle (already client-only); ensure it doesn't block first paint on mobile |
| Playwright (`playwright.config.ts`) | Running axe/e2e only at `Desktop Chrome` | Add a mobile viewport project; run axe + reflow + target-size there too |
| CI (`ci.yml`) | New responsive e2e authored but not added to the CI device/seed list (FLOW-01) | Wire every new gate into both `HAS_SEED_ENV` and `ci.yml`; verify it actually runs |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| ResizeObserver re-render storm | "ResizeObserver loop limit exceeded"; jank on rotate/drawer-open | rAF-coalesce, no-op guard, prefer CSS viewBox scaling | Orientation change / address-bar collapse on mobile |
| 7-panel factsheet all-mounted on a throttled CPU | Long main-thread tasks, slow TTI/INP on mobile | Keep IntersectionObserver-deferred panel 4–7 mount (UC#7); mobile perf budget | Mid-range phone, 4×–6× CPU throttle |
| Canvas backing store at data resolution | Memory grows per orientation change; OOM tab reload | Cap backing store to dpr × rendered size; release on unmount | Large heatmap data on memory-constrained phones |
| Shrinking a dense 880-unit SVG to 320px | Charts "fit" but text illegible (1.4.4) | Reduce tick/label density on narrow; HTML-overlay labels in real px | Any phone-width render of a desktop-dense chart |
| Tooltip re-render on every pointer move | Pan/scrub jank | Keep `useDeferredValue`/`React.memo` discipline already in `TimeSeriesChart` | Series with 1000+ points on slow mobile CPU |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Responsive share-link / shared-scenario layout leaks more than the leak-scoped view | Cross-tenant data exposure on the public shared route | Responsive work touches presentation only; do **not** alter the leak-scoped SECURITY DEFINER share payload or RLS while reflowing the shared scenario page |
| Mobile drawer renders nav items for roles the user lacks | Information disclosure of admin/role surfaces | Keep role gating in `Sidebar`'s props (`isAdmin`/`isAllocator`/`isManager`), already threaded through `MobileSidebarDrawer`; don't bypass on the mobile path |

> Note: v1.3 is presentation-only and adds no new data surface, so domain-security risk is low — the two above are the "don't regress existing privacy guarantees while reflowing" cases, not new attack surface.

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Blocking mobile instead of supporting it (current `DesktopGate.tsx`) | Mobile users hit a wall on the wizard | v1.3 replaces gate-and-block with real reflow; keep the gate's hydration-safe `isNarrow===null` pattern, drop the blocking |
| Hover tooltip is the only place a value lives | Mobile users can't read precise metrics | Pinned-crosshair touch (exists) + KPI-cell value fallback |
| Columns silently dropped on mobile | Mobile user acts on incomplete data | Reshape (scroll/stack/labeled-summary), never hide material data |
| Collapsible composer controls too small to tap | Mis-taps, can't toggle constituents | 44px hit areas decoupled from visual size |
| Desktop-dense charts shrunk to phone | Illegible labels, looks broken/untrustworthy on a *trust-positioned* product | Portrait-optimized, lower-density chart layout |

## "Looks Done But Isn't" Checklist

- [ ] **App-wide axe green:** Often missing reflow/zoom/touch/focus coverage — verify the 320px reflow gate, target-size check, zoom-meta grep, and mobile keyboard spec **all** exist and run in CI (Pitfall 11).
- [ ] **"Responsive" charts:** Often missing touch tooltips and legibility-at-scale — verify a real-device tap shows + pins a value, and labels are readable at 320px (Pitfalls 5, 8).
- [ ] **Mobile tables:** Often missing material columns — verify every dropped column's data is reachable (scroll/stack/expand) on the same viewport (Pitfall 4).
- [ ] **Mobile drawer:** Often missing focus containment/restoration/inert background — verify with a keyboard e2e, not just axe (Pitfall 10).
- [ ] **Frozen math:** Often quietly regressed by a "responsive" chart edit — verify SCENARIO-05, byte-identity factsheet, and chart-parity snapshots are still green and **un-weakened** (Pitfalls 9, 12).
- [ ] **Coverage ratchet:** Often dropped by new viewport branches — verify branch coverage held and no threshold was lowered (Pitfall 12).
- [ ] **New e2e gates:** Often authored but not CI-wired (FLOW-01) — verify each new spec is in `ci.yml` AND its seed list, and actually executed in a CI run (Pitfall 12).
- [ ] **Viewport meta:** Often regressed to block zoom — verify no `maximum-scale`/`user-scalable=no` (Pitfall 2).
- [ ] **Real-device authed walkthrough:** Headless can't hydrate authed pages (recorded constraint) — verify a human signed off on a real phone across the authed surfaces (milestone requirement).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Hydration mismatch from viewport branch | LOW | Convert to CSS-first, or move the branch into the two-pass hook; re-test hydration probe |
| Reflow breaks at 320px on a shipped route | MEDIUM | Reflow gate localizes it per-route; fix fluid widths/grid collapse; the gate prevents re-regression |
| Mobile table dropped a material column | MEDIUM | Reshape to scroll/stack/expand; add the all-columns-present guard so it can't recur |
| Frozen math regressed by a chart edit | HIGH | The byte-identity / SCENARIO-05 / parity guards catch it pre-merge if not weakened — revert the compute-layer reach, keep render-only; if it shipped, treat as a math-correctness incident |
| ResizeObserver storm in production | MEDIUM | Add rAF-coalesce + no-op guard, or switch the chart to CSS viewBox scaling (no observer) |
| Coverage ratchet lowered to ship | MEDIUM | Restore the threshold, backfill tests for the new branches; never leave the ratchet lowered |
| axe-green-but-inaccessible shipped | HIGH | Build the missing bespoke gate (reflow/touch/keyboard), run app-wide, fix the surfaced failures — the cost is the audit you skipped |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase (cluster) | Verification |
|---------|----------------------------|--------------|
| 1. SSR/hydration viewport branch | FOUNDATION (CSS-first rule + two-pass `useBreakpoint`) | No hydration warnings; hydration probe green; no new `"use client"` for viewport |
| 2. Zoom-blocking viewport meta | FOUNDATION (lock viewport config) | Grep guard: no `maximum-scale`/`user-scalable=no`; pinch-zoom works on device |
| 3. Fixed-px reflow break at 320px/400% | FOUNDATION (gate + shell) → SURFACE-BY-SURFACE (fix) | Playwright reflow spec: `scrollWidth<=clientWidth` at 320px on every route |
| 4. Tables drop material data | FOUNDATION (policy in DESIGN.md) → SURFACE-BY-SURFACE (reshape) | All-columns-present test on key tables; reviewer answers "where does the data go?" |
| 5. Hover-only tooltips on touch | CHARTS | Real-device tap shows + pins value on every value-bearing chart |
| 6. Touch targets <44px | FOUNDATION (utility + check) → SURFACE/CHARTS (apply) | Playwright target-size measurement ≥44px at mobile viewport |
| 7. SVG/Canvas perf + ResizeObserver storm | CHARTS | Mobile perf budget gate; no ResizeObserver-loop console error; memory stable on rotate |
| 8. viewBox-fixed text illegible | CHARTS | Portrait snapshot in chart-parity suite; labels readable at 320px |
| 9. Regressed FROZEN math | CHARTS (with frozen-engine guards) | SCENARIO-05 zero-diff, byte-identity factsheet, chart-parity all green |
| 10. Mobile-nav focus trap / skip-link | FOUNDATION (shared drawer contract + skip-link) | Mobile keyboard e2e: Tab contained, focus restored, skip-link present |
| 11. axe false confidence | VERIFICATION (combined gate matrix) | Reflow + target-size + zoom-meta + keyboard + mobile-axe all in CI beside app-wide axe |
| 12. Coverage/guard regression from churn | Every phase (test-as-you-go) → VERIFICATION | Ratchet held (never lowered); all old guards green un-weakened; new gates CI-wired |

## Sources

- Codebase (HIGH — primary): `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` (viewBox 880 + `preserveAspectRatio` scaling, touch pinned-crosshair, `useDeferredValue`/`memo`), `MasterBrush.tsx`/`HeatmapPanels.tsx`/`DistributionPanels.tsx` (hand-rolled SVG/Canvas, ResizeObserver), `src/components/layout/MobileSidebarDrawer.tsx` (hand-rolled focus trap + the recorded G11.C.2 audit fix), `src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx` (matchMedia two-pass `isNarrow===null` pattern + the block-mobile pattern v1.3 replaces), `e2e/composer-axe.spec.ts` + `e2e/helpers/axe.ts` (existing WCAG-AA gate, `serious+critical` embed-filter precedent, anti-false-green anchors), `e2e/strategy-v2-keyboard.spec.ts` / `strategy-v2-chart-parity.spec.ts` (keyboard + chart-parity gate patterns), `playwright.config.ts` (desktop-only viewport), `vitest.config.ts` (coverage ratchet 82/80/74/72), `src/app/(dashboard)/allocations/widgets/performance/composer-width.test.tsx` (source-scan guard idiom + `max-w-[1440px]` fixed-width), `src/components/charts/*` (Recharts `ResponsiveContainer` panels).
- `DESIGN.md` (HIGH): fixed 1100px content / 260px sidebar / `--space-grid-gap:10px` with inline 980/640 breakpoints; 12px/10–11px micro type (44px-target tension); 2026-04-29 SSR-safe two-pass `strategy.ui_v2` decision; 2026-04-30 Recharts `accessibilityLayer` opt-out (chart values surfaced via KPI cells); DESIGN-04 mobile-fallback-deferred history; 9-state honesty matrix.
- `.planning/PROJECT.md` (HIGH): v1.3 milestone scope, LOCKED no-invented-data + no-peer-rank invariants, frozen `scenario.ts`/`compute.ts`, byte-identity/parity guards, "headless can't hydrate authed pages" constraint, app-wide-axe + 320px/400% reflow + mobile-perf-budget + real-device-walkthrough verification plan.
- MEMORY (HIGH, project-specific lessons): FLOW-01 (new seed-gated e2e must be wired into both `HAS_SEED_ENV` and `ci.yml`), vitest parallel-contention flakes (`--no-file-parallelism`), composer-axe `serious+critical` filter for legitimately-nested embedded factsheet landmarks.
- axe-core / Deque (MEDIUM, external-verified): axe finds ~57% of WCAG issues automatically; WCAG 1.4.10 Reflow and 2.5.8 Target Size are not (or only partially) automatable — manual/bespoke testing required. https://www.deque.com/axe/axe-core/ , https://www.deque.com/blog/axe-core-4-5-first-wcag-2-2-support-and-more/ , https://github.com/dequelabs/axe-core
- WCAG 1.4.10 Reflow (MEDIUM): 320 CSS px / 400% zoom no-horizontal-scroll requirement, manual verification. https://dequeuniversity.com/resources/wcag2.1/1.4.10-reflow , https://www.w3.org/WAI/standards-guidelines/act/implementations/axe-core/
- Next.js App Router hydration (MEDIUM): viewport-dependent render → hydration mismatch; CSS-first / two-pass mount fixes. https://nextjs.org/docs/messages/react-hydration-error

---
*Pitfalls research for: app-wide responsive/mobile/WCAG-AA retrofit on a desktop-first dense-chart financial dashboard (Quantalyze v1.3)*
*Researched: 2026-06-27*
