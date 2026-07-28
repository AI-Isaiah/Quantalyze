# Feature Research

**Domain:** App-wide responsive / mobile / adaptive-UI retrofit of a desktop-first DENSE financial dashboard (Quantalyze v1.3 "Mobile & Adaptive UI") — Next.js 16 App Router, Tailwind v4, frozen `scenario.ts`/`compute.ts` math, LOCKED no-invented-data invariant
**Researched:** 2026-06-27
**Confidence:** HIGH (every gap maps to a real file/class read in the live repo; cross-checked against sibling STACK / ARCHITECTURE / PITFALLS research; external WCAG/axe claims verified)

> **How to read this catalog.** This is a RETROFIT, not a build. Almost nothing here is "invent a feature" — it is "close a gap against infra that already exists." Each item is framed as a **gap-to-close** with the existing surface it rides on, so the v1.3 requirements author can scope per category. The categories map 1:1 to the downstream consumer's request: **Navigation · Tables · Charts · Forms/Wizard · Layout & Reflow · A11y/Verification**. "Table stakes" = what a competent responsive financial dashboard MUST do (penalized if missing); "Differentiators" = honesty-preserving touches that distinguish an *institutional* responsive product from a generic mobile-ified SaaS; "Anti-features" = mobile-looking patterns that would harm a data-dense product or breach the honesty invariant.
>
> **The single most important framing:** the famous "make it mobile" moves — drop columns, downsample charts, block zoom, hide data behind a hover — are all **anti-features here** because they either fabricate a smaller truth (no-invented-data violation) or fail WCAG. The whole milestone is "responsiveness WITHOUT dishonesty."
>
> **Surfaces that are MORE done than the brief implies (verified in this research, do NOT re-propose):** `KpiStrip` already reflows (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`); the composer already uses `CollapsibleSection` + a sticky footer + a fluid `max-w-[1440px]` cap with `py-6 sm:py-10 lg:py-12`; factsheet panels already stack (`grid-cols-1 md:grid-cols-2`); the factsheet `TimeSeriesChart`/`MasterBrush` are already touch-native; the mobile nav shell (TopBar + Drawer + bottom Nav) is already wired. The gaps are concentrated in **tables, chart-touch propagation, nav role-awareness, the wizard block, chart legibility-at-320px, and the verification gates** — not in greenfield layout.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features a competent responsive financial dashboard MUST have. Missing = the product feels broken or untrustworthy on a phone / under zoom. Each is a **gap against existing infra**.

| Feature | Why Expected (gap framing) | Complexity | Dependency on existing surface |
|---------|----------------------------|------------|--------------------------------|
| **Role-aware mobile bottom nav** | `MobileNav.TABS` is a hard-coded 3-item stub (`Discovery / Strategies / Profile`) that ignores role and omits the primary allocator surfaces (`/allocations`, Bridge, Risk). A manager or allocator on mobile literally can't reach their main workspace from the bottom bar. | LOW | `MobileSidebarDrawer` already receives `isAdmin/isAllocator/isManager/populatedSlugs` — `MobileNav` just needs to consume the same props. Pure data-wiring, no new state. |
| **Multi-tab dashboard collapse on small screens** | `AllocationsTabs` strip is `flex-wrap` with 6 tabs + Export + "+ Allocation" in one `border-b` row — it wraps awkwardly below `sm` and the action buttons collide with the tablist. The role-blind tab set must remain *reachable*, not wrapped into chaos. | MEDIUM | Edit the existing tab `<nav role="tablist">` (lines ~545-582). Convert to a **horizontal-scroll tab strip** (preferred — keeps all tabs visible/reachable) OR an overflow menu at `<sm`. Keep the `role="tab"`-only-children a11y fix already in place (JOURNEY-03). |
| **Dense tables reflow without horizontal page-scroll AND without dropping data** | `HoldingsTable` has 3× `<table className="w-full text-sm">` with NO `overflow-x-auto` wrapper → overflows the page at 320px (the WCAG 1.4.10 reflow fail). Admin tables (`ComputeJobsTable`, `AllocatorMatchQueue`, users/intros/usage/deletion-requests) and `ScenarioCompareTable`/`CorrelationMatrix` are the same shape. | MEDIUM | Wrap each in a shared `ResponsiveTable` (overflow-x-auto + visible scroll affordance + sr-only hint). For the *densest* tables, a stacked label:value card transform at `<sm` where **every** field is still present. The table markup already exists; the work is the wrapper + the honest reshape decision per table. |
| **Charts readable & inspectable on a phone (touch tap-to-inspect)** | 16 hand-rolled SVG charts (`ReturnQuantiles`, `DailyHeatmap`, `Sparkline`, drawdown, etc.) are viewBox-responsive but have **no `onPointer*` and no `pointer-coarse:` targets** — no way to read a value on touch. 19 Recharts files use the default **hover** `<Tooltip>` which never fires on touch. Mobile users get a pretty line they can't read a number off — on a factsheet that *is* data loss. | HIGH | Propagate the EXISTING `TimeSeriesChart` recipe (tap-pins-crosshair, `TAP_SLOP`/`TAP_MS`, `pointer-coarse:` 44px hit targets). It already works on the reference chart; the gap is applying it to the other two families. For Recharts: explicit tap-to-show tooltip + the existing KPI-cell value fallback. Frozen-math boundary in play → highest-risk category. |
| **Chart text legible at 320px (lower density, not just shrink)** | viewBox charts scale text WITH the chart: an 880-wide viewBox at 320px ≈ 2.75× shrink → a 12px axis tick renders ~4-5 effective px. The chart "fits" (passes the reflow gate) but fails WCAG 1.4.4 Resize Text and is unreadable. Axe and the reflow gate BOTH pass — silent legibility failure. | HIGH | On narrow viewports, render **fewer, larger** elements: reduce tick count, drop minor gridlines, bump viewBox font, or overlay labels as real-px HTML. Presentation-only — series/metrics from `compute.ts` stay byte-identical. Pin with a portrait snapshot in the existing chart-parity suite. |
| **Reflow correct at 320px CSS width / 400% zoom — no horizontal scroll, nothing clipped** | The milestone's headline requirement (WCAG 1.4.10). Today no reflow gate exists; axe runs only at `Desktop Chrome`. Desktop literals (`Sidebar width: 260px fixed`, `Max content width: 1100px`, `--space-grid-gap: 10px` with inline 980/640 breakpoints) are reflow traps until each route is verified at 320px. | MEDIUM | Sidebar→drawer already exists below `md`. The work is a per-route audit + fixing fluid widths/grid collapse + the automated `scrollWidth <= clientWidth` gate. `max-w-[1440px]` is a *cap* (already fluid below it) — NOT a fix target (see anti-features). |
| **Browser/screen zoom never blocked** | Root `layout.tsx` exports no `viewport` → Next 16 default `width=device-width, initial-scale=1` is zoom-permissive (correct today). The table-stakes work is *keeping* it that way — a reflexive `maximum-scale=1`/`user-scalable=no` "fix" would silently fail WCAG 1.4.4 and axe can't catch it. | LOW | Add an explicit zoom-enabled `export const viewport` for canonicity + a grep CI guard that fails on `maximumScale`/`userScalable:false`. Source-scan guard idiom already used by `composer-width.test.tsx`. |
| **44px touch targets app-wide** | DESIGN.md is deliberately dense (10-11px micro labels, `--space-grid-gap:10px`); the bottom nav, tab strip, table-row actions, chart legend toggles, composer collapse toggles, and `MasterBrush` handles are below 44px on touch. Required by the milestone; axe does NOT test target-size. | MEDIUM | A `min-h-11 min-w-11` / pseudo-element hit-expander utility that decouples visual size from hit size (a 16px icon keeps its look, gets a 44px tap area). Apply across nav, tables, charts. Row height is already ~44px (DESIGN.md), so tables are partly there. |
| **Mobile-drawer focus management (trap / restore / inert / skip-link)** | A drawer needs focus trapped, focus moved in on open + restored to trigger on close, the background `inert`, body-scroll locked, and an app-wide skip-link. `MobileSidebarDrawer` already has a *hand-rolled* trap — and its own comments record a **prior audit (G11.C.2) caught a focus leak** here. Asset + warning. | MEDIUM | Reuse/extend the corrected `MobileSidebarDrawer` contract (Escape-close, Tab-cycle, scroll-lock, `prevOpenRef` restore). Prefer marking background `inert` over the manual cycle. Generalize the factsheet skip-link to the app shell. Verify with a keyboard e2e (axe can't test trap correctness). |
| **Complete loading / empty / error states on every surface** | DESIGN.md defines a 9-state matrix but it was a *wizard-flow* exit gate, not app-wide. As surfaces reflow, the honest degenerate states (no-invented-data empties) must survive — a responsive empty state that renders a blank panel instead of the honest "No candidates yet" is a regression. | MEDIUM | The `ErrorEnvelope` + 9-state discipline already exist; the gap is *applying* the matrix app-wide and verifying empties survive reflow. Tied to the no-invented-data invariant. |
| **Multi-step wizard usable on mobile (replace the hard block)** | `DesktopGate.tsx` currently **blocks** the onboarding/API-key wizard below 640px and captures a save-for-later email. The milestone scope is "truly everything" → the block is itself the gap to remove. | MEDIUM-HIGH | Replace gate-and-block with real single-column reflow of the stepper (keep the `isNarrow===null` two-pass hydration-safe pattern, drop the blocking branch). API-key/passphrase fields, the broker-selector grid, and CSV preview table must reflow. DESIGN.md DESIGN-04 already specced the read-only-review fallback as the seed; v1.3 finishes it to full reflow. |

### Differentiators (Competitive Advantage)

Honesty-preserving, institution-grade touches that distinguish a *trustworthy* responsive financial product from a generic mobile-ified dashboard. Aligned with the Core Value (allocators acting on honest data) and the LOCKED no-invented-data invariant.

| Feature | Value Proposition | Complexity | Dependency / notes |
|---------|-------------------|------------|--------------------|
| **Tap-pins-the-value crosshair (value stays after finger lifts)** | The reference `TimeSeriesChart` already pins on tap so the read-off number persists — most mobile chart libs only show a value *while* touching. Propagating this to all value-bearing charts means an allocator can tap, read, and act without the value vanishing. Directly serves "act on honest data." | (folded into the charts table-stakes work) | The hard part is built (`pinned` state); the differentiator is making it *universal* and consistent across the 3 families + heatmaps. |
| **Honest table reshape: scroll/stack/labeled-summary instead of column-drop** | On a no-invented-data product, a mobile table that keeps EVERY column reachable (via scroll or stack) is a trust signal a competitor's "we hid 4 columns on mobile" table can't match. The reshape *is* the differentiation: institutional users notice when data is withheld. | MEDIUM | Mirrors DESIGN.md's 9-state honesty discipline. A guard test asserting the mobile render still contains every material column (esp. the compare table's metric set + the revoked-key amber chip) makes it durable. |
| **Container-query component-local reflow (factsheet panel inside the capped composer)** | The composer constrains the factsheet to a narrow column at a *wide* viewport — a media query reads the wide viewport and over-renders. Container queries (`@container`, Tailwind v4 core, zero plugin) let a panel reflow on ITS box, not the page's. Charts inside a constrained column lay out correctly. A genuinely better-than-media-query result. | MEDIUM | The composer-vs-standalone factsheet reuse (`persist={false}` + `scenarioMode`) makes this the one place media queries genuinely fail. New capability the repo hasn't used yet — adopt deliberately, not everywhere. |
| **Portrait-tuned chart layouts (not just shrunk)** | The milestone explicitly scopes "charts reworked for portrait/touch." A portrait-optimized 7-panel factsheet / correlation heatmap (lower tick density, taller aspect, reordered legend) reads as *designed for mobile*, not *squeezed onto mobile* — on a trust-positioned product that's the difference between credible and broken. | HIGH | Presentation-only. Pin portrait layouts in the chart-parity snapshot suite so legibility regressions are visible. |
| **Mobile performance budget as a CI gate** | The 7-panel factsheet (multiple SVG charts + Canvas heatmaps + a Web Worker Monte-Carlo) on a throttled mobile CPU risks jank, memory pressure, and ResizeObserver storms. A budgeted, gated mobile perf check (`@lhci/cli` mobile preset on public routes) keeps the institutional product *fast* on a phone — most dashboards never measure this. | MEDIUM | The one net-new tooling area (per STACK research). Standalone LHCI job on public routes (headless can't hydrate authed). Keeps the IntersectionObserver-deferred panel 4-7 mount honest under load. |
| **Sparkline graceful degradation in fluid containers** | `Sparkline` hardcodes `width=120`; in Discovery list rows / watchlist cards on a narrow phone it should fill its (variable) cell, not sit at a fixed 120px and clip or float. A clean fluid sparkline reads as polish. | LOW | Already viewBox-scaled — just pass `width="100%"` and keep the viewBox coordinate system. Cheapest win in the charts category. |

### Anti-Features (Commonly Requested, Often Problematic)

Mobile-looking patterns that **harm a data-dense institutional product** or **breach the LOCKED no-invented-data invariant**. These are the traps the milestone exists to avoid — call them out explicitly in requirements as DO-NOT.

| Anti-Feature | Why Requested (surface appeal) | Why Problematic | Honest Alternative |
|--------------|--------------------------------|-----------------|--------------------|
| **Hide material columns on mobile (`hidden md:table-cell`)** | The path of least resistance for a "clean" mobile table; one line; columns are still "in the code." | **Direct no-invented-data violation.** A mobile user sees a smaller truth (Sharpe dropped, revoked-key warning chip dropped) and may act on incomplete data, with no signal data was withheld. The mirror image of fabricating values. | Reshape, never delete: horizontal-scroll with a visible affordance, stacked label:value card (every field present), or a labeled summary with explicit "view full table." Guard the highest-stakes tables. |
| **`maximum-scale=1` / `user-scalable=no` to "fix" zoom-breaking layout** | Layout stops overflowing under zoom; one-line change; copied from mobile-app templates. | **WCAG 1.4.4 fail**, invisible to axe. Blocks pinch/browser zoom that low-vision users rely on — on an institution-facing product that's an accessibility liability. | Fix layouts to *survive* zoom (reflow at 320px/400%). Add a grep guard that FAILS on these tokens. |
| **Downsample / decimate chart points "for mobile performance"** | Sounds like a pure-perf win; lighter charts scroll smoother. | **Changes the displayed data** → regresses frozen `scenario.ts`/`compute.ts` (SCENARIO-05 zero-diff, byte-identity factsheet guard), and the crosshair would read off a *different* curve than desktop → no-invented-data violation. The most seductive trap. | Prefer CSS/viewBox scaling (needs zero data change). If perf truly demands it, render-only decimation that is labeled, reversible, and never on read-off values — but try viewBox first. |
| **Hover-only tooltips as the sole place a value lives** | The charts were built mouse-first; the default Recharts tooltip is hover. | On touch there's no hover → the precise value is unreachable → the chart *implies less precision than it has* (no-invented-data spirit). | Tap-to-pin crosshair (exists on `TimeSeriesChart`) + KPI-cell value fallback (DESIGN.md already surfaces metrics in cells, not only tooltips). |
| **`useMediaQuery`/`innerWidth` branch in render to pick a mobile tree** | The instinctive "make it responsive in JS"; reads naturally; works in dev. | Hydration mismatch + layout-shift flash in production SSR; forces server components to `"use client"` (bundle bloat). The repo deliberately designed this risk out (`useSyncExternalStore` server snapshot = `false`). | CSS-first (`hidden md:block`) for show/hide; the shared two-pass `useBreakpoint` hook ONLY for structurally different React trees. |
| **"Fixing" the `max-w-[1440px]` composer cap to make it responsive** | A width grep flags it; looks like a fixed width that blocks reflow. | It's a `max-width` cap with `mx-auto` — already fluid below 1440px — and is PINNED by `composer-width.test.tsx` (PARITY-02) for factsheet parity. Removing it breaks the parity test for zero reflow benefit. | Leave it. Reflow happens below the cap automatically. |
| **Rewriting `EquityChart` to the viewBox pattern for "consistency"** | It's a 2200-LOC custom-SVG chart; viewBox looks cleaner. | It's the live-book Overview chart, already ResizeObserver-responsive, heavily tested, with Tweaks-context + scenario-overlay coupling. A rewrite is a huge regression surface for a chart that already scales. | Surgically tune the existing pointer handlers for touch; verify the measured-width path at small widths. Don't restructure. |
| **A bottom-nav / hamburger / mobile component KIT (shadcn, MUI, Chakra)** | Fast way to get "standard mobile patterns." | Imposes its own visual language, fights DESIGN.md's strict industrial system (Instrument Serif / DM Sans / Geist Mono, #1B6B5A, explicit anti-patterns incl. "bubbly uniform border-radius"), and forks the design tokens the a11y token tests pin. | Extend the existing primitives (`Card`, `Button`, `MobileSidebarDrawer`) + Tailwind. Pull a single *headless* unstyled a11y primitive only as a scoped exception, styled from DESIGN.md tokens. |
| **Treating "app-wide axe green" as the a11y acceptance criterion** | Axe is the established trusted gate; "all green" reads as "accessible." | axe finds ~57% of WCAG issues and **structurally cannot test** the four things this milestone is most about: Reflow (1.4.10), Resize Text (1.4.4), Target Size (2.5.8), and focus-trap correctness. Shipping green axe → *believing* responsive is done when the headline reqs were never machine-checked. The likeliest "looks done but isn't." | Pair the app-wide axe extension with bespoke gates: 320px reflow check, target-size measurement, zoom-meta grep, mobile keyboard e2e, and a real-device authed walkthrough. |
| **Carrier-grade "mobile app feel" (pull-to-refresh, swipe-between-tabs, FAB, bottom sheets everywhere)** | Makes the web app feel native; trendy. | Conflicts with an institutional data tool: swipe-between-tabs fights horizontal table scroll; a FAB obscures dense data; gesture ambiguity on a precision product erodes trust. Adds gesture-conflict bugs and a11y complexity for little allocator value. | Conventional reflow + a stable bottom tab bar + tap-to-inspect. Save gestures for where they're unambiguous (the chart crosshair already does this well). |

## Feature Dependencies

```
[Foundation primitives]
    ├──> useBreakpoint (wrap existing useMediaQuery)
    ├──> ResponsiveTable (overflow-x-auto + scroll hint)        ──required by──> [Tables reflow]
    ├──> ResponsiveChartFrame (extract TimeSeriesChart recipe)  ──required by──> [SVG chart touch]
    ├──> 44px hit-area utility                                  ──required by──> [Nav, Tables, Charts targets]
    ├──> zoom-enabled viewport export + grep guard
    └──> reflow gate + target-size gate + mobile axe project    ──verifies──> [every later phase]
                │ (build + the gate FIRST so all surface work is continuously verified)
                ▼
[Navigation shell completion]
    ├──> MobileNav role-awareness ──requires──> drawer's existing role props (already flow)
    ├──> AllocationsTabs scroll/overflow strip
    └──> drawer focus-trap / skip-link hardening ──verified-by──> mobile keyboard e2e
                │ (nav frames every surface → fix before surface work)
                ▼
[High-traffic surface reflow]  (CSS-first, no charts)
    ├──> /allocations Overview + Holdings/Outcomes/Mandate/Risk panels ──requires──> ResponsiveTable
    ├──> Discovery, Single-Strategy, Bridge, public/marketing, admin tables
    ├──> 9-state completeness (honest empties survive reflow)
    └──> wizard de-block ──requires──> two-pass hydration pattern (exists in DesktopGate)
                │
                ▼
[Hand-rolled SVG charts] (16 files) ──requires──> ResponsiveChartFrame + 44px utility
    └──> portrait tuning + 320px legibility
                │
                ▼
[Recharts + EquityChart] (highest risk: 19+ files, touch-weakest)
    ├──> tap-tooltip parity + keep accessibilityLayer={false}
    └──> EquityChart touch tuning (NOT rewrite)
                │
                ▼
[Verification] ──aggregates──> app-wide axe + reflow + target-size + zoom-grep
                              + mobile-keyboard + mobile-perf-budget + real-device walkthrough
```

### Dependency Notes

- **Tables reflow requires `ResponsiveTable` + the 44px utility:** every table edit becomes "wrap + apply classes" instead of re-deriving the recipe ~15 times. Build the primitive once.
- **SVG chart touch requires `ResponsiveChartFrame`:** the touch recipe (`onPointer*`, tap-pin, `pointer-coarse:`) lives inside `TimeSeriesChart` today; extracting it once prevents 16 ad-hoc re-implementations. **Caution:** extract carefully so the reference chart stays byte-stable (its parity test), or copy-the-pattern if extraction risks the snapshot.
- **Nav role-awareness requires nothing new** — the drawer already receives `isAdmin/isAllocator/isManager/populatedSlugs`; `MobileNav` just consumes them. This is why it's LOW complexity despite being table stakes.
- **The reflow / target-size gate must exist BEFORE surface work** (not after) — so phases are continuously verified at 320px/400%, mirroring how the v1.2 composer-axe gate caught 3 real bugs only once it actually ran in CI (MEMORY: JOURNEY-03).
- **Charts depend on (come after) the cheap CSS surface wins** — charts are the only category near the frozen-math boundary and the only place touch gestures are non-trivial; bank the safe wins first.
- **Wizard de-block conflicts with nothing** but reuses the `isNarrow===null` two-pass pattern already in `DesktopGate` — keep the hydration-safety, drop the block.
- **Honest table reshape ENHANCES the no-invented-data invariant** (it's the same honesty discipline applied to a new axis); column-drop CONFLICTS with it.

## MVP Definition

> "MVP" here = the minimum to honestly claim "v1.3: every surface is responsive." Because the milestone scope is explicitly "truly everything," the MVP is broad on *coverage* but ruthless on *not gold-plating* (no native-app gestures, no chart rewrites).

### Launch With (v1.3 core)

- [ ] **Foundation primitives + the reflow/target-size/zoom gates** — built first so everything is verified against 320px/400% as it lands. *Essential: the gate is what makes "responsive" falsifiable rather than eyeballed.*
- [ ] **Role-aware mobile nav + scrollable tab strip** — *Essential: without it a mobile allocator/manager can't reach their workspace; it's the cheapest table-stakes win.*
- [ ] **`ResponsiveTable` + honest reshape of every data table** (Holdings, compare, correlation, admin) — *Essential: tables are the worst reflow offender AND the no-invented-data risk surface.*
- [ ] **All surfaces reflow at 320px / 400% zoom with zoom never blocked** — *Essential: the milestone's headline WCAG requirement.*
- [ ] **Charts touch-inspectable + legible at 320px** (propagate the existing recipe to the 16 SVG + 19 Recharts) — *Essential: a chart you can't read a value off on a phone is data loss on a factsheet product.*
- [ ] **Wizard de-blocked + reflowed** — *Essential: scope is "truly everything," and the gate is a literal wall today.*
- [ ] **App-wide axe + complete 9-state (honest empties survive reflow)** — *Essential: UI-best-practices is the stated bar, and degenerate empties are the no-invented-data guarantee.*
- [ ] **Drawer focus-trap / skip-link verified by keyboard e2e** — *Essential: axe can't test it and the trap has leaked here before.*

### Add After Validation (v1.3.x)

- [ ] **Container-query component-local reflow** — *Trigger: a factsheet panel inside the composer over-renders because a media query read the wide viewport. Adopt where media queries demonstrably fail, not pre-emptively.*
- [ ] **Portrait-tuned (lower-density) chart layouts beyond "fits + legible"** — *Trigger: the real-device walkthrough flags a panel that "fits but reads cramped" in portrait.*
- [ ] **Mobile performance budget gate** — *Trigger: the throttled-CPU walkthrough shows jank on the 7-panel factsheet; then add the LHCI gate. (Can also ship in core if perf risk is judged high.)*

### Future Consideration (v2+)

- [ ] **Native-app gestures (swipe-tabs, pull-to-refresh, bottom sheets)** — *Defer: conflicts with dense-data interaction; only if user research shows allocators want it.*
- [ ] **Dark mode** — *Defer: DESIGN.md explicitly "not planned — institutional finance is light mode." Out of scope.*
- [ ] **Offline / PWA install** — *Defer: no signal allocators use the product offline; large surface for little value.*

## Feature Prioritization Matrix

| Feature (gap-to-close) | User Value | Implementation Cost | Priority |
|------------------------|------------|---------------------|----------|
| Reflow/target-size/zoom GATE built first | HIGH | LOW | P1 |
| Role-aware mobile nav | HIGH | LOW | P1 |
| Zoom-enabled viewport + grep guard | HIGH | LOW | P1 |
| `ResponsiveTable` + honest table reshape | HIGH | MEDIUM | P1 |
| All surfaces reflow at 320px/400% | HIGH | MEDIUM | P1 |
| Scrollable/overflow tab strip | HIGH | MEDIUM | P1 |
| Chart touch tap-to-inspect (3 families) | HIGH | HIGH | P1 |
| Chart legibility at 320px (lower density) | HIGH | HIGH | P1 |
| 44px touch-target utility + apply | HIGH | MEDIUM | P1 |
| Drawer focus-trap / skip-link + keyboard e2e | MEDIUM | MEDIUM | P1 |
| Wizard de-block + reflow | MEDIUM | MEDIUM-HIGH | P1 |
| App-wide axe + 9-state completeness | HIGH | MEDIUM | P1 |
| Sparkline fluid-width degradation | MEDIUM | LOW | P2 |
| Container-query component-local reflow | MEDIUM | MEDIUM | P2 |
| Portrait-tuned chart layouts | MEDIUM | HIGH | P2 |
| Mobile performance budget gate | MEDIUM | MEDIUM | P2 |
| Tap-pins-value crosshair universality | MEDIUM | (folded) | P2 |

**Priority key:** P1 = must have to claim v1.3 done · P2 = should have, add when possible · P3 = future.

## Competitor Feature Analysis

DESIGN.md names the positioning references; how dense-data platforms handle responsive, and Quantalyze's honesty-constrained approach.

| Responsive concern | FactSet / Bloomberg-web (institutional, dense) | Typical crypto/SaaS dashboards (TradeLink, quants.space) | Quantalyze's approach (honesty-constrained) |
|--------------------|------------------------------------------------|----------------------------------------------------------|---------------------------------------------|
| Dense tables on mobile | Horizontal scroll within a bounded region; all columns reachable | Often drop columns / show a "lite" mobile table | **Reshape never drop** — scroll or stack with every material column present (no-invented-data) |
| Charts on touch | Tap-to-inspect crosshair; values pinned; KPI cells beside the chart | Hover tooltips that silently fail on touch | **Propagate the existing tap-pin crosshair** + KPI-cell fallback |
| Zoom / reflow | Survive zoom; reflow to single column | Frequently `user-scalable=no` to avoid layout breakage | **Never block zoom**; reflow at 320px/400%; grep-guarded |
| Multi-tab nav | Scrollable tab strips, persistent | Bottom tab bar (sometimes role-blind) | **Role-aware bottom nav** + scrollable tab strip |
| Visual language on mobile | Restrained, data-first, no decoration | Card-heavy, rounded, decorative | **Keep DESIGN.md industrial system** — no component kit, no bubbly radius |
| Verification | Manual a11y audits | Often none beyond eyeballing | **Bespoke gates** (reflow + target-size + zoom-grep + keyboard) BESIDE axe + real-device walkthrough |

## Sources

- **Live repo reads (HIGH, primary):** `src/components/layout/MobileNav.tsx` (3-item role-blind stub), `MobileSidebarDrawer.tsx`/`MobileTopBar.tsx` (drawer props + sticky), `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` (3× `w-full` tables, no overflow wrapper), `KpiStrip.tsx` (already `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`), `ScenarioComposer.tsx` (CollapsibleSection + sticky footer + `max-w-[1440px]` + `py-6 sm:py-10 lg:py-12`), `AllocationsTabs.tsx` (flex-wrap tablist + JOURNEY-03 a11y fix), `src/app/(dashboard)/strategies/new/wizard/DesktopGate.tsx` (640px hard block + two-pass `isNarrow===null`), `src/app/factsheet/[id]/v2/*` panels (`grid-cols-1 md:grid-cols-2`), `src/components/charts/Sparkline.tsx` (hardcoded `width=120`, viewBox-scaled), chart-family counts (19 Recharts / 39 ResponsiveContainer / 29 components/charts SVG), axe-spec coverage (5 routes only), public routes (`/`, `/demo`, `/for-quants`, `/security`, `/browse`), admin tables (`ComputeJobsTable`, `AllocatorMatchQueue`, users/intros/usage/deletion-requests).
- **Sibling research (HIGH):** `.planning/research/ARCHITECTURE.md` (mobile shell wired, three chart families, frozen-engine seam, reflow-gap list, build order), `PITFALLS.md` (12 pitfalls incl. column-drop honesty violation, hover-only tooltips, viewBox text legibility, axe false-confidence), `STACK.md` (Tailwind v4 container queries core, `@lhci/cli` the only net-new dep, zoom-enabled viewport, Recharts `accessibilityLayer={false}`).
- **`DESIGN.md` (HIGH):** industrial/utilitarian system, 9-state matrix + a11y minimums, ~44px row height, DESIGN-04 mobile-wizard-fallback deferral, "data density > card density," dark-mode-not-planned, anti-patterns list, Recharts accessibilityLayer opt-out.
- **`.planning/PROJECT.md` (HIGH):** v1.3 scope ("truly everything"), LOCKED no-invented-data + no-peer-rank invariants, frozen `scenario.ts`/`compute.ts`, verification bar (app-wide axe + 320px/400% reflow + mobile perf budget + real-device walkthrough).
- **WCAG / axe (MEDIUM, external-verified):** 1.4.10 Reflow (320px/400%, not axe-automatable), 1.4.4 Resize Text, 2.5.8 Target Size; axe finds ~57% of WCAG issues (Deque). https://dequeuniversity.com/resources/wcag2.1/1.4.10-reflow , https://www.deque.com/axe/axe-core/

---
*Feature research for: app-wide responsive/mobile/adaptive-UI retrofit of a dense financial dashboard (Quantalyze v1.3)*
*Researched: 2026-06-27*
