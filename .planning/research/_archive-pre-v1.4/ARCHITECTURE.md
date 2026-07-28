# Architecture Research

**Domain:** App-wide responsive / mobile / WCAG-AA retrofit of an existing Next.js 16 App Router app (Quantalyze v1.3)
**Researched:** 2026-06-27
**Confidence:** HIGH (every claim grounded in a read of the live repo; no greenfield speculation)

## Executive Finding (read this first)

**v1.3 is a retrofit, not a build-out. The hard parts are already done.** The codebase already
contains, working and wired:

- A complete **mobile navigation shell** — `DashboardChrome.tsx` already renders `MobileTopBar`
  (hamburger), `MobileSidebarDrawer`, and `MobileNav` (bottom tab bar), with the desktop `Sidebar`
  hidden behind `hidden md:block` and `pb-16 md:pb-0` bottom-nav clearance. The drawer/topbar/nav
  trio is NOT a stub at the chrome level.
- The **gold-standard responsive chart pattern** — the factsheet `TimeSeriesChart.tsx` + `MasterBrush.tsx`
  are already fully responsive (`viewBox` + `preserveAspectRatio="xMidYMid meet"` + `className="block w-full"`
  + CSS `aspectRatio`), already touch-native (`onPointer*` gestures, `touch-pan-y`, tap-to-pin crosshair,
  44px+ touch hit-targets via `HANDLE_HIT_W` and `pointer-coarse:` variants).
- A correct **SSR-safe breakpoint hook** — `src/hooks/useMediaQuery.ts` uses `useSyncExternalStore`
  with a `false` server snapshot (no hydration mismatch).

So the milestone is **(a) applying patterns that already exist in three places to the ~40 surfaces that
don't yet have them, and (b) closing concrete reflow gaps** (overflow-x tables, the desktop-oriented
`AllocationsTabs` strip, the stub `MobileNav.TABS` list, Recharts touch weakness, 320px/400%-zoom audit).
The frozen math engine (`src/lib/scenario.ts`) is genuinely never touched — it imports a single TYPE and
emits arrays of numbers. There is no math/render coupling to break.

## Standard Architecture

### The Responsive Layer Stack (where breakpoint logic lives)

```
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 0 — FROZEN MATH ENGINE  (src/lib/scenario.ts, compute.ts)      │
│  Pure TS. Imports a single `DailyPoint` type. Emits number[] / metrics.│
│  ZERO viewport awareness. NEVER MODIFIED in v1.3. SCENARIO-05 pins.    │
└──────────────────────────────────────────────────────────────────────┘
            │  number[] / ComputedMetrics  (the seam — props only)
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — CSS-FIRST RESPONSIVENESS  (default; ~80% of the work)      │
│  Tailwind v4 responsive utilities (sm: md: lg:), CSS Grid auto-fit,    │
│  container queries (@container) for component-owned reflow,            │
│  flex-wrap, overflow-x-auto, pointer-coarse: touch variants.          │
│  NO JavaScript. NO hydration risk. Renders identically server/client. │
└──────────────────────────────────────────────────────────────────────┘
            │  (escalate ONLY when CSS cannot express the branch)
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — useMediaQuery / useBreakpoint HOOK  (when render BRANCHES)  │
│  src/hooks/useMediaQuery.ts (useSyncExternalStore, SSR snapshot=false).│
│  Use when the component renders STRUCTURALLY DIFFERENT trees by size   │
│  (e.g. table-vs-card, drawer-vs-inline). Server snapshot = desktop-OR  │
│  -mobile-default; two-pass mount upgrades post-hydration.             │
└──────────────────────────────────────────────────────────────────────┘
            │  (escalate ONLY when you need the actual pixel width)
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — ResizeObserver MEASURED WIDTH  (charts that scale by px)    │
│  Two live patterns coexist:                                           │
│   (a) viewBox + preserveAspectRatio  → NO measurement needed          │
│       (TimeSeriesChart, MasterBrush, ReturnQuantiles, DailyHeatmap)   │
│   (b) ResizeObserver → setWidth(px)  → re-scales d3 ranges            │
│       (EquityChart widget: useState(960) initial, RO → measured)      │
│   (c) Recharts <ResponsiveContainer>  → library-internal RO           │
│       (23 widget files: DrawdownChart, RiskDecomposition, …)          │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities (the three chart families — this is the crux)

| Chart family | Sizing mechanism | Responsive today? | Touch today? | v1.3 work |
|--------------|------------------|-------------------|--------------|-----------|
| **Factsheet v2** (`app/factsheet/[id]/v2/TimeSeriesChart.tsx`, `MasterBrush.tsx`) — 20 files | `viewBox` 880×h + `preserveAspectRatio` + `aspectRatio` CSS, `w-full` | ✅ YES (reference impl) | ✅ YES (`onPointer*`, tap-pin, `pointer-coarse:`) | **None / portrait tuning only** — this IS the pattern to copy |
| **Hand-rolled SVG** (`components/charts/*.tsx`) — 16 files (`ReturnQuantiles`, `DailyHeatmap`, `Sparkline`, `DrawdownChart`, …) | `viewBox` W×H + `className="w-full"` (already viewBox-based, fixed px design space) | ✅ Width-responsive (viewBox scales) | ⚠️ PARTIAL — no pointer gestures, no `pointer-coarse:` targets | **Add touch + 44px targets; verify legibility when downscaled to 320px** |
| **Recharts widgets** (`allocations/widgets/**`, `RiskTabPanel`, `OutcomesTabPanel`) — 23 files | `<ResponsiveContainer>` (library RO) | ✅ Width-responsive | ⚠️ WEAK — Recharts tooltip is hover-first; touch is fiddly | **Decide: keep Recharts w/ touch-tooltip workaround, or migrate the highest-traffic ones to the viewBox pattern** |
| **EquityChart widget** (`allocations/widgets/performance/EquityChart.tsx`, 2200+ LOC) | `useState(960)` + `ResizeObserver` → `setWidth(measured)` | ✅ Width-responsive | ⚠️ Custom `onPointer`/`hoverIdx` (desktop-tuned) | **Tune for touch + small width; do NOT rewrite (it's the live-book overview chart)** |

**The seam to protect:** every chart consumes `number[]` / `DailyPoint[]` / `ComputedMetrics` as PROPS.
None compute. The frozen engine boundary is the prop boundary — `scenario.ts` → `compute.ts` →
`buildScenarioFactsheetPayload` / `buildAllocatorPortfolioFactsheetPayload` → chart props. v1.3 touches
only the chart component internals (SVG attributes, pointer handlers, Tailwind classes), never the payload
builders' numeric output.

## Recommended Project Structure (NEW vs MODIFIED)

```
src/
├── hooks/
│   ├── useMediaQuery.ts          # EXISTS — keep (SSR-safe useSyncExternalStore)
│   └── useBreakpoint.ts          # NEW — thin named-breakpoint wrapper over useMediaQuery
│                                 #       (returns 'mobile'|'tablet'|'desktop'; SSR='desktop')
├── components/
│   ├── ui/
│   │   ├── ResponsiveTable.tsx       # NEW — overflow-x-auto wrapper + sr scroll hint;
│   │   │                             #       optional table→card transform at <sm
│   │   ├── ResponsiveChartFrame.tsx  # NEW — the viewBox+aspectRatio+w-full SVG wrapper,
│   │   │                             #       extracted from TimeSeriesChart so SVG charts
│   │   │                             #       stop re-deriving it ad hoc
│   │   └── TouchTooltip.tsx          # NEW (optional) — tap-to-pin tooltip for Recharts/SVG
│   │                                 #       parity with TimeSeriesChart's crosshair-pin
│   └── layout/
│       ├── DashboardChrome.tsx       # MODIFIED — already wires mobile shell; verify full-bleed
│       ├── MobileNav.tsx             # MODIFIED — TABS list is a 3-item STUB; make role-aware
│       ├── MobileSidebarDrawer.tsx   # EXISTS — verify focus-trap + 400% zoom
│       └── MobileTopBar.tsx          # EXISTS — verify 44px hamburger
├── app/
│   ├── (dashboard)/allocations/
│   │   ├── AllocationsTabs.tsx       # MODIFIED — tab strip flex-wraps but is desktop-density;
│   │   │                             #       needs scroll-strip or overflow at <sm
│   │   ├── AllocationDashboardV2.tsx # MODIFIED — verify factsheet grid stacks at <lg
│   │   ├── widgets/performance/
│   │   │   └── EquityChart.tsx       # MODIFIED — touch + small-width tuning (NOT rewrite)
│   │   └── widgets/**                # MODIFIED — Recharts touch tuning per family decision
│   ├── factsheet/[id]/v2/
│   │   ├── TimeSeriesChart.tsx       # REFERENCE — copy its pattern outward; portrait tune only
│   │   ├── MasterBrush.tsx           # REFERENCE — already touch-ready
│   │   └── FactsheetView.tsx         # MODIFIED — panel grid + max-w-[1440px] stack verification
│   └── globals.css                   # MODIFIED — add @container roots if container queries adopted
└── (per-surface page.tsx files)      # MODIFIED — reflow class additions only, no logic change
```

### Structure Rationale

- **`ui/ResponsiveChartFrame.tsx`, `ui/ResponsiveTable.tsx`, `useBreakpoint.ts`** — build the shared
  primitives ONCE so the ~40 surface edits become "wrap + apply classes" not "re-derive the responsive
  recipe 40 times." This is the single highest-leverage decision in the milestone. The frame's recipe
  already exists inside `TimeSeriesChart.tsx` (lines 564-580) — extract it, don't reinvent it.
- **`components/charts/` stays where it is** — these 16 SVG charts are already `viewBox`-responsive;
  the edit is additive (pointer handlers, `pointer-coarse:` classes), so they don't move.
- **No new top-level folders, no new routes, no migrations.** This is a presentation-layer milestone.
  DESIGN.md, RLS, and the analytics service are untouched.

## Architectural Patterns

### Pattern 1: viewBox + preserveAspectRatio (the canonical responsive SVG chart)

**What:** Render the chart in a FIXED design-space coordinate system (e.g. `viewBox="0 0 880 280"`), let
the browser scale it to the container with `className="block w-full"` + CSS `aspectRatio`. No JS measurement.
**When to use:** Any hand-rolled SVG chart. This is the default for new charts and the target for the 16
existing `components/charts/` files.
**Trade-offs:** ✅ Zero hydration risk (server and client emit identical SVG), zero ResizeObserver, font/stroke
scale proportionally. ⚠️ Text scales WITH the chart — at 320px a 880-wide viewBox downscales ~2.75×, so a
10px axis label renders ~3.6 effective px. **This is the one real legibility risk** — mitigate with a
small-viewport `viewBox` swap (narrower design space → larger relative text) OR `vector-effect`/min font
clamps. Verify against WCAG 1.4.4 (resize text) in the reflow audit.

**Example (verbatim recipe already in `TimeSeriesChart.tsx:564-580`):**
```tsx
<svg
  viewBox={`0 0 ${VB_W} ${height}`}
  preserveAspectRatio="xMidYMid meet"
  className="block w-full ... touch-pan-y select-none"
  style={{ aspectRatio: `${VB_W} / ${height}`, maxHeight: height, width: "100%", height: "auto" }}
  onPointerMove={...} onPointerDown={...} onPointerUp={...}  // touch-native
/>
```

### Pattern 2: SSR-safe breakpoint hook with two-pass mount

**What:** `useMediaQuery` / `useBreakpoint` return a deterministic value on the server (`false` /
`'desktop'`), so the SSR HTML and first client render agree byte-for-byte; a post-hydration effect upgrades
to the true viewport. This is the EXACT pattern the codebase already uses for the `allocations.ui_v2` flag
(`AllocationsTabs.tsx:340-361`, `useCrossTabStorage` deferred hydration) and the `strategy.ui_v2` flag
(DESIGN.md 2026-04-29 "SSR-safe two-pass mount" decision).
**When to use:** ONLY when CSS cannot express the branch — i.e. the mobile and desktop trees are structurally
different React (different components, not just different classes). Prefer CSS (`hidden md:block`) for
show/hide; reserve the hook for "render a Drawer instead of an inline panel" cases.
**Trade-offs:** ✅ No hydration mismatch. ⚠️ One frame of "desktop tree then mobile tree" on real mobile
(the two-pass cost) — acceptable for structural swaps, unacceptable for above-the-fold layout (use CSS there).

**Example:**
```tsx
// useBreakpoint.ts (NEW) — named wrapper, SSR snapshot = 'desktop'
export function useBreakpoint(): 'mobile' | 'tablet' | 'desktop' {
  const isMobile = useMediaQuery('(max-width: 639px)');   // < sm
  const isTablet = useMediaQuery('(max-width: 1023px)');  // < lg
  return isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';
}
```

### Pattern 3: CSS-first, escalate-only (the decision rule for "where does breakpoint logic live?")

**What:** A strict escalation ladder — try CSS, then the hook, then ResizeObserver, in that order. Never
reach for JS when a Tailwind utility expresses the intent.
**When to use:** Every responsive decision in the milestone routes through this rule.

| Need | Mechanism | Why |
|------|-----------|-----|
| Show/hide by size | `hidden md:block` / `md:hidden` (CSS) | No JS, no hydration risk. Already used in `DashboardChrome` + `MobileNav` |
| Reflow grid columns | `grid-cols-1 lg:grid-cols-2` (CSS) | Already used in the scenario loading skeleton (`AllocationsTabs.tsx:138`) |
| Component-owned reflow independent of viewport | `@container` queries (CSS) | A widget in a wide vs narrow slot should reflow on ITS width, not the page's |
| Table that can't shrink | `overflow-x-auto` wrapper (CSS) | The `HoldingsTable` gap (see below) |
| Structurally different tree | `useBreakpoint()` (Layer 2) | Only when CSS can't branch React structure |
| Chart that scales by measured px | `ResizeObserver` OR viewBox (Layer 3) | viewBox preferred; RO only for the existing EquityChart pattern |

**Trade-off:** the discipline is the whole value — without it, contributors sprinkle `useMediaQuery` into
layout that should be pure CSS, reintroducing hydration risk the codebase has carefully avoided.

## Data Flow (the frozen-engine boundary, made explicit)

### The render pipeline — where math ends and presentation begins

```
[allocator's book / scenario draft state]
        ↓
src/lib/scenario.ts  ──── FROZEN ──── computeScenario(), toWealth(),        ← LAYER 0
        │                              computeCompositeCurve()                  NEVER touched
        ↓  ComputedMetrics + DailyPoint[]  (pure numbers — the SEAM)           in v1.3
src/lib/factsheet/compute.ts  ──── FROZEN (parity) ──── ComputeResult
        ↓
buildScenarioFactsheetPayload() / buildAllocatorPortfolioFactsheetPayload()  ← payload SHAPING
        ↓  FactsheetPayload  (still pure data)                                  (not modified — output
        ↓                                                                        must stay byte-identical)
FactsheetProvider (context)                                                    ← LAYER 1/2/3 boundary
        ↓
TimeSeriesChart / MasterBrush / FactsheetBody / Recharts widgets              ← PRESENTATION ONLY
        ↓                                                                        v1.3 EDITS LIVE HERE:
SVG viewBox attrs · onPointer handlers · Tailwind classes · pointer-coarse      SVG/CSS/event handlers
```

**The boundary test for any v1.3 change:** "Does this change the numbers the payload builders emit?"
If yes → STOP, it crosses the frozen boundary. If it only changes SVG attributes, CSS classes, event
handlers, or DOM structure → it's in scope. The `composer-width.test.tsx` and `scenario.test.ts`
SCENARIO-05 pins enforce this at CI.

### The one width literal that is NOT a frozen constraint

`max-w-[1440px]` appears in `AllocationsTabs.tsx`, `ScenarioComposer.tsx`, `FactsheetView.tsx`,
`loading.tsx` and is guarded by `composer-width.test.tsx` (PARITY-02: "3 in-scope composer containers
are max-w-[1440px], Overview stays 1100"). **This is a `max-width` container cap, not a fixed render
width** — `mx-auto` already centers it and it collapses fluidly below 1440px. It is responsive-correct
as-is. The PARITY-02 test pins the MAX, not a minimum, so it does NOT block reflow. Do not confuse it with
a hard-coded chart width — there are no hard-coded chart pixel widths that resist reflow (the SVG charts
use viewBox; EquityChart measures; Recharts uses ResponsiveContainer).

## Mobile Navigation Architecture (already 80% built)

```
DashboardChrome.tsx  (client wrapper, reads usePathname)
├── DESKTOP (md+):  <div className="hidden md:block"><Sidebar/></div>  +  main md:ml-[260px]
└── MOBILE (<md):
        ├── <MobileTopBar/>           hamburger → setMenuOpen(true)        [EXISTS]
        ├── <MobileSidebarDrawer/>    slide-out full nav, focus-trapped     [EXISTS]
        └── <MobileNav/>              fixed bottom tab bar, md:hidden        [EXISTS but STUB]
                                      pb-16 clearance on <main>
```

**What's done:** the shell, the drawer, the topbar, the hidden-desktop-sidebar, the bottom-nav clearance,
the full-bleed variant — all present and wired in `DashboardChrome.tsx`.

**What's the gap:** `MobileNav.TABS` is a hard-coded 3-item stub (`Discovery / Strategies / Profile`) that
ignores role (allocator vs manager vs admin) and omits the primary allocator surfaces (`/allocations`,
Bridge, Risk). The `MobileSidebarDrawer` already takes `isAdmin/isAllocator/isManager/populatedSlugs` props,
so the role data flows — `MobileNav` just needs to consume it. This is a small, well-scoped modification,
not a build.

**react-grid-layout is GONE.** The April codebase map lists `react-grid-layout@2.2.3` and a `WidgetGrid`
with 980px/640px inline breakpoints — but `react-grid-layout` is NOT in the current `package.json`, no
`react-grid-layout`/`WidthProvider`/`GridLayout` import exists anywhere in `src/`, and the 980/640 strings
in `globals.css` are now only stale CODE COMMENTS. The allocator dashboard reflows via Tailwind responsive
grid utilities and the factsheet panel layout. **The "is react-grid-layout responsive-capable / does it
need a mobile fallback layout" question is moot — there is no react-grid-layout to make responsive.** Do
not reintroduce it.

## Concrete Reflow Gaps (the falsifiable to-do list)

| Gap | Evidence | Fix |
|-----|----------|-----|
| **Tables overflow at 320px** | `HoldingsTable.tsx` has 3× `<table className="w-full text-sm">` with NO `overflow-x-auto` wrapper and no responsive column hiding | `ResponsiveTable` primitive wraps in `overflow-x-auto`; or hide low-priority columns < sm |
| **MobileNav is a 3-item stub** | `MobileNav.tsx` TABS = Discovery/Strategies/Profile, role-blind | Make role-aware from the props the drawer already receives |
| **Allocations tab strip is desktop-density** | `AllocationsTabs.tsx` strip is `flex-wrap` but 6 tabs + Export + "+ Allocation" in one row wraps awkwardly < sm | Horizontal-scroll tab strip OR overflow menu at < sm |
| **SVG charts lack touch + 44px targets** | `ReturnQuantiles`/`DailyHeatmap`/etc. are viewBox-responsive but have no `onPointer*` and no `pointer-coarse:` | Apply `TimeSeriesChart`'s touch recipe (shared via `ResponsiveChartFrame` or copy) |
| **Recharts touch tooltips weak** | 23 files use `<ResponsiveContainer>` + Recharts `<Tooltip>` (hover-first) | Per-family decision: keep + `pointer-coarse` workaround, or migrate top-traffic to viewBox |
| **SVG text legibility when downscaled** | viewBox charts scale text with the chart; 880→320 ≈ 2.75× shrink | Small-viewport viewBox swap or min font clamp; verify WCAG 1.4.4 |
| **400% zoom / 320px not yet gated** | No reflow e2e exists; axe specs cover violations not reflow | Add a Playwright reflow check at 320px CSS width + 400% zoom (WCAG 1.4.10) |

## Suggested BUILD ORDER (dependency-ordered, charts last because highest-risk)

```
Phase 44  FOUNDATION PRIMITIVES (build once)
          ├─ useBreakpoint.ts (wrap existing useMediaQuery)
          ├─ ResponsiveChartFrame.tsx (extract TimeSeriesChart's viewBox recipe)
          ├─ ResponsiveTable.tsx (overflow-x-auto + scroll hint)
          └─ extend the axe gate + add the 320px/400%-zoom reflow Playwright check
             (gate FIRST so every later phase is verified against it)
                    │ (everything below depends on these)
                    ▼
Phase 45  NAVIGATION SHELL COMPLETION (low risk, high visibility)
          ├─ MobileNav role-awareness (consume drawer's existing props)
          ├─ MobileSidebarDrawer / MobileTopBar 44px + focus-trap + zoom verification
          └─ AllocationsTabs strip → scroll/overflow at < sm
                    │
                    ▼
Phase 46  HIGH-TRAFFIC SURFACE REFLOW (CSS-first, no charts)
          ├─ /allocations Overview + Holdings/Outcomes/Mandate/Risk panels
          ├─ tables → ResponsiveTable
          ├─ Discovery, Single-Strategy, Bridge, public/marketing routes
          └─ loading/empty/error states completeness (DESIGN.md 9-state matrix app-wide)
                    │
                    ▼
Phase 47  HAND-ROLLED SVG CHARTS (medium risk — frozen boundary in play)
          ├─ apply ResponsiveChartFrame touch recipe to components/charts/* (16 files)
          ├─ pointer-coarse 44px targets; small-viewport legibility
          └─ portrait tuning for factsheet 7-panel + correlation heatmaps
                    │
                    ▼
Phase 48  RECHARTS + EQUITYCHART (highest risk — most surfaces, touch-weakest)
          ├─ Recharts family decision + touch-tooltip parity (23 files)
          ├─ EquityChart widget touch + small-width tuning (NO rewrite)
          └─ final app-wide axe + reflow + mobile-perf-budget gate; real-device authed walkthrough
```

**Why this order:**
- **Primitives + the reflow GATE first** — so phases 45-48 are continuously verified against 320px/400%
  instead of discovering reflow breakage at the end. Mirrors how the v1.2 composer-axe gate caught 3 real
  a11y bugs only once it actually ran in CI (MEMORY: JOURNEY-03).
- **Nav before surfaces** — the shell frames every surface; fixing it first means surface work is tested
  inside the real mobile chrome.
- **CSS surfaces before charts** — charts are the highest-risk because they're the only place the frozen
  boundary is near (chart props come from the payload builders) and the only place touch gestures are
  non-trivial. Get the cheap, safe wins (CSS reflow, tables, nav) banked first.
- **Recharts/EquityChart last** — most files (23 + the 2200-LOC EquityChart), touch-weakest, and the
  family-migration decision benefits from the patterns proven in Phase 47.

## Anti-Patterns (specific to this retrofit)

### Anti-Pattern 1: Reaching for useMediaQuery where CSS suffices
**What people do:** `const isMobile = useMediaQuery(...)` then `{isMobile ? <A/> : <B/>}` for a simple
show/hide.
**Why it's wrong:** Reintroduces the hydration-mismatch + two-pass-flash risk the codebase deliberately
designed out (`useSyncExternalStore` server snapshot = `false`). `<A/>` and `<B/>` both ship in the bundle.
**Do this instead:** `<A className="md:hidden"/><B className="hidden md:block"/>`. Reserve the hook for
structurally different React trees only.

### Anti-Pattern 2: "Fixing" the max-w-[1440px] literals as if they block reflow
**What people do:** See `max-w-[1440px]` flagged by a width grep and try to make it responsive / remove it.
**Why it's wrong:** It's a `max-width` cap with `mx-auto` — already fluid below 1440px. It's pinned by
`composer-width.test.tsx` (PARITY-02) for factsheet parity. Removing it breaks the parity test for zero
reflow benefit.
**Do this instead:** Leave it. Reflow happens below the cap automatically.

### Anti-Pattern 3: Rewriting EquityChart for responsiveness
**What people do:** See the 2200-LOC custom-SVG `EquityChart` and decide to "modernize" it to the viewBox
pattern.
**Why it's wrong:** It's the live-book Overview chart, already ResizeObserver-responsive, heavily tested,
and carries Tweaks-context coupling (chartStyle/showBench) + scenario-overlay logic. A rewrite is a huge
regression surface for a chart that already scales.
**Do this instead:** Tune the existing pointer handlers for touch and verify the measured-width path holds
at small widths. Surgical, not structural.

### Anti-Pattern 4: Editing scenario.ts / compute.ts / the payload builders' numeric output
**What people do:** Adjust a value in the payload builder to "make the chart fit mobile."
**Why it's wrong:** Crosses the frozen boundary; trips SCENARIO-05 / composer-width / the parity tests;
violates the no-invented-data invariant.
**Do this instead:** All mobile adaptation happens in the chart component's SVG/CSS/event layer. If a chart
"doesn't fit," change its viewBox/layout, never its data.

## Integration Points

### Internal Boundaries

| Boundary | Communication | v1.3 rule |
|----------|---------------|-----------|
| `scenario.ts` → chart components | Props (`number[]` / `ComputedMetrics`) via payload builders + FactsheetProvider | READ-ONLY across the boundary; edit only the chart side |
| `DashboardChrome` → `MobileNav`/`Drawer`/`Sidebar` | Props (`isAdmin/isAllocator/isManager/populatedSlugs/flaggedCount`) | Already flows; `MobileNav` just needs to consume role |
| `TimeSeriesChart` (reference) → new `ResponsiveChartFrame` | Extract the viewBox+aspectRatio recipe to the shared primitive | Keep `TimeSeriesChart` byte-stable; extract → re-import, or copy-pattern if extraction risks the parity test |
| Tailwind v4 `@theme inline` tokens (`globals.css`) | `--color-*` / `--radius-*` / `--space-grid-gap` | Respect DESIGN.md token conventions (no bare `var(--positive)` — see 2026-05-06 decision); add `@container` roots if container queries adopted |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| FastAPI / Railway analytics | OUT OF SCOPE for v1.3 | No responsive change touches the Python service |
| Supabase / RLS | OUT OF SCOPE | No migration; presentation-only milestone |
| Vercel | Existing CI gates | Extend the axe job app-wide + add the reflow check |

## Confidence Assessment

| Claim | Confidence | Basis |
|-------|------------|-------|
| Mobile nav shell already wired | HIGH | Read `DashboardChrome.tsx` + confirmed `MobileNav/Drawer/TopBar` files exist |
| Factsheet charts already responsive + touch | HIGH | Read `TimeSeriesChart.tsx` (viewBox+aspectRatio+onPointer) + `MasterBrush.tsx` headers |
| Three chart families with distinct sizing | HIGH | Read EquityChart (RO), ReturnQuantiles/TimeSeriesChart (viewBox), DrawdownChart (Recharts) |
| Frozen engine is pure / never crossed | HIGH | `scenario.ts` imports only `DailyPoint` type; 0 non-comment window/DOM/React refs |
| react-grid-layout removed | HIGH | Absent from `package.json`; 0 imports in `src/`; 980/640 are stale comments |
| useMediaQuery is SSR-safe | HIGH | Read the hook (`useSyncExternalStore`, server snapshot `false`) |
| Table overflow gap at 320px | HIGH | `HoldingsTable.tsx` `<table className="w-full">` with no overflow wrapper |
| Recharts touch is the weakest family | MEDIUM | Recharts `<Tooltip>` is hover-first by design; verify per-component during Phase 48 |
| SVG text legibility at 320px is the real risk | MEDIUM | Inferred from viewBox downscale math (880→320 ≈ 2.75×); confirm in the reflow audit |

## Sources

- Live repo reads (HIGH): `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx`, `MasterBrush.tsx`;
  `src/components/layout/DashboardChrome.tsx`, `MobileNav.tsx`; `src/hooks/useMediaQuery.ts`;
  `src/app/(dashboard)/allocations/AllocationsTabs.tsx`, `AllocationDashboardV2.tsx`,
  `widgets/performance/EquityChart.tsx`, `widgets/performance/DrawdownChart.tsx`;
  `src/components/charts/ReturnQuantiles.tsx`; `src/lib/scenario.ts`; `composer-width.test.tsx`;
  `package.json`; `DESIGN.md`; `.planning/PROJECT.md`.
- DESIGN.md decisions (HIGH): SSR-safe two-pass mount (2026-04-29 strategy.ui_v2), Tailwind v4 `--color-*`
  token convention (2026-05-06), 44px touch-target row height, mobile-fallback deferral history (DESIGN-04).
- WCAG references (HIGH): 1.4.10 Reflow (320px), 1.4.4 Resize Text (200%/400% zoom) — the milestone's
  stated verification bar.

---
*Architecture research for: app-wide responsive/mobile/WCAG-AA retrofit (Quantalyze v1.3)*
*Researched: 2026-06-27*
