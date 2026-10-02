# Phase 44: Foundation Primitives & Verification Gates - Research

**Researched:** 2026-06-27
**Domain:** Responsive UI primitives (React 19 / Next.js 16 App Router) + bespoke CI accessibility gates (Playwright + Vitest source-scan)
**Confidence:** HIGH — every claim is anchored on read-of-source in this repo or local `node_modules/next/dist/docs`; no external/library guesses required.

## Summary

Phase 44 is pure plumbing: build three shared responsive primitives once (`useBreakpoint`, `ResponsiveTable`, `ResponsiveChartFrame`) and stand up three bespoke CI gates (320px reflow, 44px target-size, zoom-meta source-scan) **before** the surface work in phases 45–48. Every hard constraint is already pinned by the success criteria; the research job is to map each criterion onto the exact existing pattern in this codebase so the planner emits "mirror file X" tasks, not "design from scratch" tasks.

The codebase already contains every pattern this phase needs — it just hasn't been generalized: `useMediaQuery` (the SSR-safe `useSyncExternalStore` hook `useBreakpoint` wraps), `TimeSeriesChart` (the live viewBox+`preserveAspectRatio`+`w-full` recipe `ResponsiveChartFrame` extracts), `demo-public.spec.ts` lines 309-349 (the live `scrollWidth > innerWidth` reflow check to formalize into a reusable helper with the SC#1 visible-anchor + ≤1px slop additions), `chart-accessibility-layer.test.ts` (the exact whole-codebase Vitest source-grep guard the zoom-meta gate should clone), and `Button.tsx` / `pointer-coarse:` classes (the 44px target-size convention already in use). The FLOW-01 dual-wiring sites are concrete: the unseeded Playwright list at `ci.yml:1059` and the seed-gated list at `ci.yml:1252-1262`, each spec also gated by its own `HAS_SEED_ENV` const.

**Primary recommendation:** Anchor the phase-44 reflow + target-size gates on the **unseeded public `/security` route** (renders real content with no auth/seed — `e2e/security-page.spec.ts` proves it), wire them into the **unseeded** `ci.yml:1059` list (NOT the seed-gated list — phase 44 only needs "runnable against any route + proven-executing"; phases 46/48 run them app-wide on seeded routes). Make the zoom-meta guard a **Vitest source-grep test in `tests/visual/`** (mirrors `chart-accessibility-layer.test.ts`) so it runs unconditionally in the `frontend-test` + `frontend-coverage` jobs with zero ci.yml edits and zero seed gate.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `useBreakpoint` (viewport class read) | Browser / Client (`"use client"`) | Frontend Server (SSR snapshot `'desktop'`) | `matchMedia` is browser-only; the SSR snapshot is a constant returned server-side so hydration matches the desktop-first server render |
| `ResponsiveTable` (overflow container + sr-only hint) | Browser / Client (presentational) | — | Pure CSS/markup wrapper; no data, no server concern |
| `ResponsiveChartFrame` (SVG viewBox recipe) | Browser / Client (presentational) | — | Encapsulates SVG attributes + CSS; charts already render client-side |
| Root `viewport` export | Frontend Server (SSR `<head>`) | — | Next.js App Router emits `<meta name="viewport">` server-side from the `viewport` export |
| Reflow / target-size gate | CI / Test harness (Playwright headless Chromium) | — | Runtime DOM measurement against a running server |
| zoom-meta source-scan gate | CI / Test harness (Vitest source grep) | — | Static source analysis, no runtime; runs in the existing vitest jobs |

## User Constraints (from CONTEXT.md)

### Locked Decisions
The CONTEXT.md `## Decisions` records this as a **Claude's-Discretion infrastructure phase** — all implementation choices are at Claude's discretion, guided by ROADMAP success criteria, DESIGN.md, and existing codebase conventions. The hard constraints are pinned by the four success criteria (verbatim below). The locked **verification gate design** (from CONTEXT.md) is:

- Reflow gate anchors its assertion on a **visible content element** so it can't false-green on a blank page; **≤1px slop** on `scrollWidth <= clientWidth` at a **320px CSS width**.
- Target-size gate measures interactive elements at **≥44px** (WCAG 2.5.8 / `pointer-coarse`).
- zoom-meta guard is a **source scan** (not runtime) — fails on `maximum-scale` / `user-scalable=no` anywhere in a `viewport` export or `<meta name="viewport">`.
- **FLOW-01:** every new gate added to BOTH `HAS_SEED_ENV` (where seed-gated) AND the explicit `ci.yml` spec list, or it silently never runs (burned twice — must be proven to execute in CI).

### Claude's Discretion
Minor presentational choices decided at plan time against DESIGN.md: scroll-hint wording, default chart aspect ratio, gate route selection.

### Deferred Ideas (OUT OF SCOPE)
None — phase scope is fixed by the four success criteria. **Applying** primitives to real surfaces is phases 45 (nav), 46 (reflow), 47 (SVG charts touch), 48 (Recharts + app-wide axe + perf budget). Phase 44 builds and tests the primitives + gates; it does NOT wrap any real surface.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| A11Y-02 | Bespoke CI gates cover what axe structurally can't — a 320px reflow check (`scrollWidth <= clientWidth`), a zoom-meta grep guard (fails on `maximumScale`/`userScalable:false`), a 44px target-size measurement, and a mobile keyboard/focus check. | This phase delivers the reflow gate (helper + spec), the zoom-meta Vitest grep guard, the 44px target-size measurement gate, and the zoom-permissive root viewport. The **mobile keyboard/focus check** clause of A11Y-02's text is split to Phase 48 per REQUIREMENTS.md traceability (A11Y-01/03 → 48); phase 44 owns the reflow + target-size + zoom-meta trio. Confirm scope split with planner: REQUIREMENTS.md maps A11Y-02 → Phase 44, and the SC#4 list names exactly "reflow / target-size / zoom-meta" — the keyboard/focus check is NOT a phase-44 success criterion. |

## Standard Stack

This is a zero-new-dependency phase. Everything needed is already installed.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | ^16.2.3 [VERIFIED: package.json] | `Viewport` type + `viewport` export for `<meta name="viewport">` | App Router native API; confirmed in `node_modules/next/dist/docs/.../generate-viewport.md` |
| `react` / `react-dom` | 19.2.4 [VERIFIED: package.json] | `useSyncExternalStore` for the SSR-safe hook | Already used by `useMediaQuery` |
| `@playwright/test` | ^1.59.1 [VERIFIED: package.json] | reflow + target-size e2e gates | Existing e2e harness (`playwright.config.ts`, 37 specs) |
| `vitest` | ^4.1.2 [VERIFIED: package.json] | zoom-meta source-scan guard + primitive unit tests | Existing unit harness; `tests/visual/` already in `include` glob |
| `@vitest/coverage-v8` | ^4.1.5 [VERIFIED: package.json] | coverage ratchet | `frontend-coverage` job; thresholds in `vitest.config.ts:73-78` |
| `tailwindcss` + `@tailwindcss/postcss` | ^4 [VERIFIED: package.json] | `overflow-x-auto`, `w-full`, breakpoint utilities | CSS-first config (NO `tailwind.config.*`; `@theme inline` in `src/app/globals.css`) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@axe-core/playwright` | ^4.11.2 [VERIFIED: package.json] | (existing) the 5 axe specs the bespoke gates sit BESIDE | Do NOT touch in phase 44; phase 48 extends axe app-wide (A11Y-01) |

**Installation:** None. `npm install` adds nothing this phase. [VERIFIED: all packages already in package.json; no new install required.]

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tailwind default breakpoints (sm 640 / md 768 / lg 1024) | Custom `--breakpoint-*` tokens in `@theme inline` | No custom breakpoint tokens exist today (`globals.css` `@theme` has colors/fonts/spacing/radius only — verified). `useBreakpoint` should expose the Tailwind v4 defaults so its values match the CSS utilities phases 45-48 apply. Don't invent new breakpoints. |
| Vitest source-grep guard for zoom-meta | tsx script + ci.yml step (like `schema:functions:check`) | The Vitest test (mirroring `chart-accessibility-layer.test.ts`) runs unconditionally in `frontend-test` + `frontend-coverage` with NO ci.yml edit, NO seed gate, and is gated by the `frontend` aggregator. Strictly less wiring + less FLOW-01 risk. Recommend Vitest. The tsx-script alternative (attach to `frontend-policy` job alongside `check-banned-packages.mjs`) is only needed if the guard must run outside the vitest pool. |

## Package Legitimacy Audit

> No external packages are installed in this phase. Audit not required.

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs)
**Packages flagged as suspicious [SUS]:** none (no installs)

## Architecture Patterns

### System Architecture Diagram

```
                          PHASE 44 DELIVERABLES (two independent tracks)

  TRACK A — PRIMITIVES (src/)                    TRACK B — GATES (e2e/ + tests/ + ci.yml)
  ───────────────────────────                    ────────────────────────────────────────

  useMediaQuery (EXISTS)                          demo-public.spec.ts:309-349 (EXISTS,
  src/hooks/useMediaQuery.ts                        reflow precedent — innerWidth, no
    │ useSyncExternalStore                          slop, no visible-anchor)
    │ getServerSnapshot → false                          │ formalize + harden
    ▼                                                     ▼
  useBreakpoint (NEW)  ──server snapshot──▶ 'desktop'   e2e/helpers/reflow.ts (NEW)
  src/hooks/useBreakpoint.ts                              ├─ assertNoReflow(page, {anchor})
    │ thin wrapper, 2-pass mount                          └─ assertTargetSizes(page, {sel})
    │ no hydration mismatch                                      │
    ▼                                                            ▼
  unit test (NEW) ──▶ branches covered            e2e/reflow.spec.ts (NEW)
                                                    e2e/target-size.spec.ts (NEW)
  TimeSeriesChart (EXISTS)                          │ goto('/security') 320px CSS
  factsheet/[id]/v2/TimeSeriesChart.tsx             │ visible-element anchor + ≤1px slop
    │ <svg viewBox preserveAspectRatio              │ HAS_SEED_ENV const (false→unseeded)
    │   className="block w-full" style={aspect}>          │
    │ extract the frame  ─────────────▶                   ▼ FLOW-01 dual-wire
    ▼                                              .github/workflows/ci.yml:1059
  ResponsiveChartFrame (NEW)                         (unseeded list) ── ADD both specs
  src/components/ResponsiveChartFrame.tsx                  │
    │ TimeSeriesChart ADOPTS it                            │ proven-execution:
    │ (parity stays byte-identical)                        ▼ CI log shows N passed (not skipped)
    ▼
  unit test (NEW)                                  chart-accessibility-layer.test.ts (EXISTS)
                                                   tests/visual/*.test.ts
  ResponsiveTable (NEW)                              │ whole-codebase source grep
  src/components/ResponsiveTable.tsx                 │ clone the walk()+regex pattern
    │ <div overflow-x-auto> + <span sr-only>              ▼
    ▼                                              tests/visual/viewport-zoom-meta.test.ts (NEW)
  unit test (NEW)                                    │ greps src/** for maximumScale /
                                                     │ userScalable:false / maximum-scale /
  layout.tsx (EXISTS, no viewport export)            │ user-scalable=no in viewport/meta
  src/app/layout.tsx                                 ▼ runs in frontend-test + frontend-coverage
    │ ADD: export const viewport: Viewport          (gated by `frontend` aggregator, no seed,
    ▼   = { width:'device-width', initialScale:1 }    no ci.yml edit)
  zoom-permissive (no maximumScale, no
  userScalable:false)
```

### Recommended Project Structure
```
src/
├── hooks/
│   ├── useMediaQuery.ts          # EXISTS — do not modify
│   └── useBreakpoint.ts          # NEW — thin wrapper, "use client"
├── components/
│   ├── ResponsiveTable.tsx       # NEW — overflow-x-auto + sr-only hint
│   └── ResponsiveChartFrame.tsx  # NEW — viewBox/preserveAspectRatio/w-full
└── app/
    └── layout.tsx                # EXISTS — ADD `export const viewport`

e2e/
├── helpers/
│   └── reflow.ts                 # NEW — assertNoReflow + assertTargetSizes
├── reflow.spec.ts                # NEW — anchors on /security, 320px, ≤1px slop
└── target-size.spec.ts          # NEW — 44px measurement on /security

tests/
└── visual/
    └── viewport-zoom-meta.test.ts  # NEW — clone of chart-accessibility-layer.test.ts

src/  (co-located unit tests, per repo convention — vitest include `src/**/*.test.{ts,tsx}`)
├── hooks/useBreakpoint.test.ts
├── components/ResponsiveTable.test.tsx
└── components/ResponsiveChartFrame.test.tsx
```
**Convention note:** Unit tests in this repo are **co-located** next to source (`src/**/*.test.{ts,tsx}` is the vitest include glob — `vitest.config.ts:26`), e.g. `ComparatorPicker.test.tsx` next to `ComparatorPicker.tsx`. Whole-codebase grep guards live in `tests/visual/` (e.g. `chart-accessibility-layer.test.ts`). a11y/contrast assertions live in `tests/a11y/`. Follow both placements.

### Pattern 1: SSR-safe `useBreakpoint` (two-pass, server snapshot `'desktop'`)
**What:** A thin wrapper over the existing `useMediaQuery` that returns a breakpoint name. The server snapshot must be `'desktop'` (mirrors `useMediaQuery`'s `getServerSnapshot → false` and the `strategy.ui_v2` SSR-false convention in DESIGN.md decision-log 2026-04-29). Desktop-first server render → no hydration mismatch.
**When to use:** Any phase-45+ component that needs JS-side breakpoint branching (not pure CSS).
**Existing hook signature (verified — `src/hooks/useMediaQuery.ts:13`):**
```typescript
// EXISTS — do not modify
export function useMediaQuery(query: string): boolean
// getSnapshot:        window.matchMedia(query).matches  (browser)
// getServerSnapshot:  () => false                       (SSR — desktop-first)
// implemented with useSyncExternalStore (no setState-in-useEffect)
```
**New wrapper (the minimal shape — Claude's discretion on exact breakpoint enum):**
```typescript
// Source: derived from src/hooks/useMediaQuery.ts (this repo)
"use client";
import { useMediaQuery } from "./useMediaQuery";

// Tailwind v4 DEFAULTS (no custom --breakpoint-* tokens in globals.css @theme):
// sm 640px, md 768px, lg 1024px, xl 1280px, 2xl 1536px.
export type Breakpoint = "mobile" | "tablet" | "desktop";

export function useBreakpoint(): Breakpoint {
  // Each useMediaQuery call self-manages its own getServerSnapshot=false,
  // so on the server BOTH read false → the `else` branch → 'desktop'.
  // No matchMedia on the server; no hydration mismatch.
  const isTablet = useMediaQuery("(min-width: 640px)");   // ≥ sm
  const isDesktop = useMediaQuery("(min-width: 1024px)"); // ≥ lg
  if (isDesktop) return "desktop";
  if (isTablet) return "tablet";
  return "mobile";
}
```
**Critical SSR detail:** because `useMediaQuery`'s `getServerSnapshot` returns `false`, on the server both reads are `false` → falls through to `"mobile"` — NOT `'desktop'`. To honor SC#3's "server snapshot `'desktop'`", the wrapper must **invert the default** so the all-`false` (server) case maps to `desktop`. Two correct options:
1. Query the **inverse** (`max-width`) so SSR `false` means "not narrow" → desktop. e.g. `useMediaQuery("(max-width: 1023px)")` (true=tablet-or-below). On SSR both inverse reads are `false` → neither tablet nor mobile → `desktop`. **This is the recommended shape** — it makes the SSR snapshot fall out as `'desktop'` for free.
2. Or add a dedicated SSR-aware snapshot. Option 1 is simpler and matches the existing primitive.

The planner MUST verify the unit test asserts: (a) SSR render (jsdom with `matchMedia` mocked to throw / undefined-window path) yields `'desktop'`; (b) each of mobile/tablet/desktop branch is exercised so branch coverage holds.

### Pattern 2: `ResponsiveChartFrame` extraction (parity-by-construction)
**What:** Extract the EXACT SVG container recipe from `TimeSeriesChart` into a reusable frame, then have `TimeSeriesChart` adopt the frame so its rendered output is **byte-identical**.
**The exact recipe — verified at `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx:564-580`:**
```tsx
// Source: src/app/factsheet/[id]/v2/TimeSeriesChart.tsx:564-580 (this repo)
<svg
  ref={svgRef}
  viewBox={`0 0 ${VB_W} ${height}`}                 // VB_W = 880 (line 9); height = config.height ?? 280 (line 37)
  preserveAspectRatio="xMidYMid meet"               // line 570 — 'meet' keeps natural aspect, no letterbox
  role="img"
  aria-label={...}
  aria-describedby={...}
  tabIndex={0}
  focusable="true"
  className="block w-full cursor-crosshair touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"  // line 576 — `block w-full` is the load-bearing responsive part
  style={{ aspectRatio: `${VB_W} / ${height}`, maxHeight: height, width: "100%", height: "auto" }}  // line 580
  onPointerMove={...} /* + 6 more handlers */
>
  {children}
</svg>
```
**The reusable subset `ResponsiveChartFrame` should encapsulate** (the responsive-recipe core, NOT the chart-specific interaction handlers/aria):
- `viewBox={`0 0 ${width} ${height}`}` (props: `width`, `height`)
- `preserveAspectRatio="xMidYMid meet"`
- `className="block w-full ..."` (the `block w-full` is the responsive part; allow className passthrough)
- `style={{ aspectRatio: `${width} / ${height}`, maxHeight, width: "100%", height: "auto" }}`
- `ref` forwarding (TimeSeriesChart needs `svgRef` for export/pointer math)
- `children` + all `on*` / aria / tabIndex / role passed through

**Parity-by-construction constraint — CRITICAL FINDING:** The success criterion says "without breaking its parity test." **The named parity test `e2e/strategy-v2-chart-parity.spec.ts` is permanently `test.skip(true, ...)` (verified: `strategy-v2-chart-parity.spec.ts:47-51`)** — it was authored against Recharts/`lightweight-charts` assumptions (`path[stroke="#1B6B5A"]`, `.recharts-cartesian-axis-tick`) that DO NOT match the live SVG `TimeSeriesChart`, its goldens were never baselined, and it targets `/strategy/${id}/v2` while `TimeSeriesChart` lives at the `/factsheet/[id]/v2` route. **It does not actually test `TimeSeriesChart`.** So "don't break the parity test" has two readings the planner must resolve:
1. **Literal:** the skipped spec stays skipped (trivially satisfied — it tests nothing).
2. **Intent:** `TimeSeriesChart`'s rendered SVG output must stay byte-identical after adopting the frame. There is NO live snapshot test enforcing this, so the planner should add a small **structural unit test** (RTL render of `TimeSeriesChart` or a direct `ResponsiveChartFrame` render asserting the exact `viewBox` / `preserveAspectRatio` / `className` / `style.aspectRatio` strings) to make the byte-identity falsifiable. Recommended: assert the frame emits the verbatim attribute strings above, AND that `TimeSeriesChart` still passes its existing co-located tests. Do NOT rely on the dead `strategy-v2-chart-parity.spec.ts` as the guard.

**Safest adoption strategy:** make `ResponsiveChartFrame` a drop-in `<svg>` wrapper that produces the identical DOM, then refactor `TimeSeriesChart`'s `<svg>` to use it. Keep `VB_W=880` and `preserveAspectRatio="xMidYMid meet"` verbatim. Verify by diffing the rendered SVG attributes in a unit test.

### Pattern 3: `ResponsiveTable`
**What:** An `overflow-x-auto` container + a visually-hidden (`sr-only`) scroll hint so screen-reader users know the table scrolls horizontally.
**Existing convention:** `sr-only` is used throughout (e.g. `TimeSeriesChart.tsx:493` `<span ... className="sr-only">`). Tailwind v4 provides `sr-only` natively.
**Shape:**
```tsx
// Source: derived from existing sr-only usage (TimeSeriesChart.tsx:493) + Tailwind v4
export function ResponsiveTable({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={hint ?? "Scrollable table"} tabIndex={0}>
      <span className="sr-only">{hint ?? "Table scrolls horizontally. Swipe or use arrow keys to see more columns."}</span>
      {children}
    </div>
  );
}
```
**DESIGN.md grounding:** Tables have "no outer border, header row with bottom border, hairline row dividers" (DESIGN.md §Component Patterns) and "~44px row height (touch-target compliant)" (DESIGN.md §Spacing). Row height is already touch-compliant — `ResponsiveTable` only adds the scroll affordance, it does NOT restyle the table. Phase 46 (TABLE-01) does the column-reshape work; phase 44 only builds the wrapper. Scroll-hint wording is Claude's discretion (DESIGN.md §9-state-matrix uses `role="status"`/`aria-live` for state, but a static scroll hint is `sr-only` text — confirm wording at plan time).

### Pattern 4: zoom-permissive root `viewport` export (Next 16 App Router)
**What:** `src/app/layout.tsx` currently has NO `viewport` export (verified — only `metadata` + `dynamic = "force-dynamic"`). SC#2 requires an explicit zoom-permissive one.
**Verified API (`node_modules/next/dist/docs/.../generate-viewport.md` + `node_modules/next/dist/lib/metadata/types/extra-types.d.ts:45`):**
```tsx
// Source: node_modules/next/dist/docs/01-app/.../generate-viewport.md:25-33
import type { Viewport } from "next";

// ZOOM-PERMISSIVE — omit maximumScale, omit userScalable:false.
// Emits <meta name="viewport" content="width=device-width, initial-scale=1">.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // DO NOT set maximumScale or userScalable:false — that disables pinch-zoom
  // (WCAG 1.4.4 Resize Text failure) and is exactly what the zoom-meta guard
  // fails on.
};
```
`Viewport` is exported from `next` (re-export of `metadata-interface.d.ts:599`, fields in `extra-types.d.ts:45-54`: `width`, `height`, `initialScale`, `minimumScale`, `maximumScale`, `userScalable`, `viewportFit`, `interactiveWidget`). `viewport` and `metadata` can both be exported from the same segment. **`viewport` export is Server-Components-only** (docs line 17) — `layout.tsx` is already a server component (`async function RootLayout`), so this is fine. The existing `export const dynamic = "force-dynamic"` coexists with `viewport` without issue.

### Anti-Patterns to Avoid
- **Re-deriving the chart recipe per chart:** the whole point of `ResponsiveChartFrame` is to extract ONCE so phases 47/48 wrap, not re-derive (mirrors the v1.2 "build once" intent).
- **Inventing custom breakpoints:** no `--breakpoint-*` tokens exist; use Tailwind v4 defaults so `useBreakpoint` values match the CSS utilities later phases apply.
- **Setting `maximumScale`/`userScalable:false` anywhere:** this is the exact thing the zoom-meta guard fails on, and a WCAG 1.4.4 failure.
- **Anchoring the reflow gate on `<body>` alone:** a blank/404 body has no overflow → false-green. Anchor on a specific visible content element (SC#1).
- **Adding a gate to ci.yml but not the spec's `HAS_SEED_ENV`/skip const (or vice-versa):** the twice-burned FLOW-01 trap → the gate silently never runs.
- **Lowering a coverage threshold or blanket-updating a snapshot to go green** (CLAUDE.md Rule 12 / ROADMAP cross-cutting gate): new viewport conditionals need real branch coverage.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSR-safe media query | A `useState`+`useEffect` mount-detector | Wrap existing `useMediaQuery` (`useSyncExternalStore`) | The repo already solved the "setState-in-useEffect" anti-pattern the React compiler flags; re-deriving risks hydration mismatch |
| Reflow DOM measurement | A bespoke overflow walker per spec | A shared `e2e/helpers/reflow.ts` cloning `demo-public.spec.ts:309-349` | The DOM-walk-to-find-first-offender breadcrumb already exists and is debuggable; generalize it once |
| Source-scan CI guard | A new bash/grep ci.yml step | A Vitest test cloning `tests/visual/chart-accessibility-layer.test.ts` | The `walk()` + per-tag regex + violations-array pattern is proven, runs in existing jobs, needs no ci.yml edit |
| SVG responsive frame | Per-chart inline viewBox math | `ResponsiveChartFrame` extracted from `TimeSeriesChart` | Phases 47/48 wrap 16+ charts; the recipe must live in one place |
| `<meta name="viewport">` | A hand-written `<meta>` in `<head>` | Next.js `viewport` export | App Router emits the meta from the typed export; a hand-written meta would itself trip the zoom-meta guard's `<meta name="viewport">` clause and fragment the source of truth |
| axe-replacement | Trying to make axe test reflow/target-size | Bespoke gates BESIDE axe | axe finds ~57% of WCAG and structurally CANNOT test Reflow 1.4.10 / Resize-Text 1.4.4 / Target-Size 2.5.8 (ROADMAP cross-cutting gate) |

**Key insight:** Every primitive and every gate in this phase has a live, working precedent in this exact codebase. The risk is NOT "how do I build X" — it's "I built X but it silently doesn't run" (FLOW-01) or "I changed TimeSeriesChart's output" (parity). Plan around proving execution and proving byte-identity, not around novel construction.

## Runtime State Inventory

> Phase 44 is a greenfield-primitives + CI-gate phase. No rename/refactor/migration of stored data. The one refactor is the `ResponsiveChartFrame` extraction from `TimeSeriesChart`, which is in-process source only.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore touched. | None |
| Live service config | None — no external service config touched. | None |
| OS-registered state | None — no scheduled tasks / process registrations. | None |
| Secrets/env vars | The gates READ existing CI env (`TEST_SUPABASE_*` / `vars.E2E_TEST_DB_CONFIGURED`) but ADD none. Phase-44 gates are recommended UNSEEDED → they don't even need seed env. | None |
| Build artifacts | `TimeSeriesChart` adopting `ResponsiveChartFrame` is a pure source refactor; `.next/` rebuilds normally in CI. No stale artifact risk. | None |

**Nothing found in any category** — verified: no migrations, no datastore keys, no service config, no OS registrations, no new secrets. The only cross-cutting touch is `ci.yml` (add 2 specs to the unseeded list) + `layout.tsx` (add viewport export) + 3 new `src/` files + 3 new test files + 1 new e2e helper + 2 new e2e specs + 1 new vitest guard.

## Common Pitfalls

### Pitfall 1: FLOW-01 — gate added but never runs (BURNED TWICE)
**What goes wrong:** A new e2e spec self-skips (its `HAS_SEED_ENV`/skip const stays false) OR it's never added to the `ci.yml` playwright list → CI is green but the gate ran zero assertions.
**Why it happens:** The two-tier Playwright structure requires updating BOTH the spec's skip const AND the explicit ci.yml list (`ci.yml:1250-1251` literally says "Adding/removing a seed-gated spec? Update both this list and the e2e/<spec>.spec.ts HAS_SEED_ENV constant"). The v1.2 JOURNEY-03 axe gate caught 3 real bugs ONLY after it actually executed.
**How to avoid:** Phase-44 reflow + target-size gates should be **UNSEEDED** (anchored on public `/security`), so:
- Add `e2e/reflow.spec.ts` + `e2e/target-size.spec.ts` to the **unseeded** list at `ci.yml:1059` (the `auth.spec.ts e2e/smoke.spec.ts ...` line — runs against the placeholder-env build, public routes only).
- Their skip const should be a route-presence/visible-anchor gate (NOT `HAS_SEED_ENV`) so they RUN in the unseeded job (mirror the `demo-public.spec.ts` model, which runs unseeded and is in that list).
**Warning signs / PROVEN-EXECUTION (mandatory per SC#4):** grep the CI run log for the spec name and confirm it shows `N passed` (not `N skipped`). The reflow spec must assert against a visible element so a 404/blank page fails LOUD instead of green. Add an explicit "did this actually run" breadcrumb (the existing precedent at `ci.yml:1205-1221` greps the build to prove a step did real work — mirror that intent: e.g. the spec `expect`s the anchor element visible BEFORE measuring).

### Pitfall 2: False-green reflow on a blank/empty page
**What goes wrong:** A page that 404s or renders an empty `<body>` has `scrollWidth <= clientWidth` trivially → the reflow gate passes against nothing.
**Why it happens:** This is the SAME class of bug the discovery-axe spec already documents (`discovery-axe.spec.ts:1-19` Grok W-02: "running against an unseeded test DB silently passes against a 404 / empty page, giving a false-green on a route axe never actually scanned").
**How to avoid:** SC#1 mandates anchoring on a VISIBLE content element. The helper must `await expect(page.locator(anchorSelector)).toBeVisible()` BEFORE the `scrollWidth` measurement, and fail if the anchor isn't found. For `/security` use the H1 / `article > h1` (verified present — `security-page.spec.ts` asserts "the expected H1 and the three editorial sections").

### Pitfall 3: `useBreakpoint` hydration mismatch
**What goes wrong:** Server renders one breakpoint, client hydrates another → React hydration warning / layout flash.
**Why it happens:** If the hook reads `matchMedia` during the first client render before the two-pass settle, or if the server snapshot doesn't match the desktop-first server HTML.
**How to avoid:** Lean entirely on `useMediaQuery`'s existing `getServerSnapshot → false` + `useSyncExternalStore` (no setState-in-useEffect). Use the **inverse-query shape** (Pattern 1, option 1) so the all-`false` server case → `'desktop'`. This mirrors the blessed `strategy.ui_v2` two-pass SSR-false convention (DESIGN.md decision-log 2026-04-29). Unit-test the SSR path explicitly. The repo has a precedent spec for this exact concern: `e2e/wizard-hydration-probe.spec.ts`.

### Pitfall 4: Breaking `TimeSeriesChart`'s rendered output via the frame extraction
**What goes wrong:** `ResponsiveChartFrame` drops/reorders an SVG attribute (e.g. `focusable="true"`, `tabIndex={0}`, the exact `className` order) → the chart's a11y/keyboard behavior or visual output changes. Note `chart-accessibility-layer.test.ts` and `e2e/strategy-v2-keyboard.spec.ts` (Tab-order) are sensitive to SVG focusability.
**Why it happens:** There is NO live snapshot test on `TimeSeriesChart`'s SVG (the named parity spec is dead — Pitfall finding above), so a regression wouldn't be caught by existing tests.
**How to avoid:** (a) Pass through ALL of `TimeSeriesChart`'s current `<svg>` props (ref, the 7 `on*` handlers, `role`, `aria-label`, `aria-describedby`, `tabIndex`, `focusable`, the full `className`, `style`) via the frame; (b) add a unit test asserting the rendered SVG carries the verbatim `viewBox="0 0 880 280"`, `preserveAspectRatio="xMidYMid meet"`, and `className` containing `block w-full`; (c) keep `VB_W=880` and `height` defaulting to 280 unchanged.

### Pitfall 5: Coverage ratchet trips on new branches
**What goes wrong:** `useBreakpoint`'s 3 branches (mobile/tablet/desktop) or `ResponsiveTable`'s `hint ?? default` branch are uncovered → `frontend-coverage` job fails (thresholds: lines 82 / stmts 80 / fns 74 / **branches 72** — the tightest-relative gate).
**Why it happens:** New primitives add conditionals; the ratchet is set just under measured actual so a real regression trips it.
**How to avoid:** Unit tests must exercise EVERY branch: all 3 breakpoint cases + the SSR case; both `hint` provided/default in `ResponsiveTable`. Never lower a threshold (ROADMAP cross-cutting gate + CLAUDE.md §Test Coverage). The new primitives are small and pure, so 100% branch coverage on them is cheap and lifts the aggregate.

## Code Examples

### Reusable reflow + target-size helper (formalizes `demo-public.spec.ts:309-349`)
```typescript
// Source: derived from e2e/demo-public.spec.ts:309-349 (this repo) + SC#1 hardening
// e2e/helpers/reflow.ts
import { expect, type Page } from "@playwright/test";

/**
 * SC#1 reflow gate: scrollWidth <= clientWidth (≤1px slop) at the current
 * viewport, anchored on a VISIBLE content element so a blank/404 page fails
 * loud instead of false-greening (mirrors discovery-axe Grok W-02).
 */
export async function assertNoReflow(page: Page, anchorSelector: string) {
  // Anchor — fail loud on empty/404 (Pitfall 2).
  await expect(page.locator(anchorSelector).first()).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await expect(async () => {
    const o = await page.evaluate(() => {
      const doc = document.documentElement;
      // clientWidth (not innerWidth) per SC#1 — excludes the scrollbar gutter.
      const slop = doc.scrollWidth - doc.clientWidth;
      if (slop <= 1) return { ok: true as const };
      let culprit: string | null = null;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        if (el.getBoundingClientRect().right > doc.clientWidth + 1) {
          culprit = `${el.tagName}${el.id ? "#" + el.id : ""}`;
          break;
        }
      }
      return { ok: false as const, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, culprit };
    });
    if (!o.ok) throw new Error(`reflow: scrollWidth=${o.scrollWidth} clientWidth=${o.clientWidth} offender=${o.culprit}`);
  }).toPass({ timeout: 5000, intervals: [200, 500, 1000] });
}

/**
 * SC#1 target-size gate: interactive elements measure ≥44px (WCAG 2.5.8).
 * Anchor first so an empty page can't pass with zero elements measured.
 */
export async function assertTargetSizes(page: Page, anchorSelector: string, interactiveSelector = "a, button, [role=button], input, select") {
  await expect(page.locator(anchorSelector).first()).toBeVisible({ timeout: 10_000 });
  const violations = await page.evaluate((sel) => {
    const out: string[] = [];
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // hidden — skip
      if (r.width < 44 || r.height < 44) out.push(`${el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return { measured: els.length, out };
  }, interactiveSelector);
  expect(violations.measured, "no interactive elements measured — anchor/empty-page bug").toBeGreaterThan(0);
  expect(violations.out, "interactive targets below 44px (WCAG 2.5.8)").toEqual([]);
}
```
**Note for planner:** the 44px gate may surface real existing violations on `/security` (e.g. footer links, the `sm` Button variant `px-3 py-1.5` which is intentionally below 44px). Phase 44's job is to make the gate EXIST and RUN; if `/security` has sub-44px targets, either (a) anchor target-size on a route known clean, or (b) scope the selector to a container, or (c) treat the first run as the baseline and let phase 45/46 fix violations. Decide at plan time — SC#1 only requires the gate "exists" and is "runnable against any route", not that the whole app passes it in phase 44. Document the chosen scope so it's not a false-green.

### zoom-meta source-scan guard (clone of `chart-accessibility-layer.test.ts`)
```typescript
// Source: clone of tests/visual/chart-accessibility-layer.test.ts (this repo)
// tests/visual/viewport-zoom-meta.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e === "node_modules" || e === ".next") continue;
      out.push(...walk(full));
    } else if (/\.(tsx?|html)$/.test(e)) out.push(full);
  }
  return out;
}

// Fail on zoom-disabling viewport directives anywhere in src/.
const FORBIDDEN = [
  /maximumScale\s*:/,          // Next Viewport export field
  /userScalable\s*:\s*false/,  // Next Viewport export field
  /maximum-scale\s*=/,         // raw <meta> content
  /user-scalable\s*=\s*no/,    // raw <meta> content
];

describe("zoom-meta guard (A11Y-02 / SC#2) — WCAG 1.4.4 Resize Text", () => {
  it("no zoom-disabling viewport directive anywhere in src/", () => {
    const violations: string[] = [];
    for (const path of walk(SRC_DIR)) {
      const src = readFileSync(path, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(src)) violations.push(`${path.replace(REPO_ROOT + "/", "")}: ${re}`);
      }
    }
    expect(violations, "viewport must never disable pinch-zoom (WCAG 1.4.4)").toEqual([]);
  });
});
```
This runs in `frontend-test` (sharded, `npx vitest run --shard`) AND `frontend-coverage` (full suite) via the `tests/visual/**/*.test.ts` include glob (`vitest.config.ts:28`), both gated by the `frontend` aggregator job. **No ci.yml edit, no seed gate.** Green from the start (no `maximumScale`/`user-scalable` exists anywhere today — verified).

### FLOW-01 dual-wiring sites (the EXACT two places per e2e gate)
```yaml
# .github/workflows/ci.yml — UNSEEDED list (recommended for phase 44), line 1059:
          npx playwright test e2e/auth.spec.ts e2e/smoke.spec.ts e2e/demo-public.spec.ts e2e/demo-founder-view.spec.ts e2e/onboarding-banner-smoke.spec.ts e2e/demo-screenshot.spec.ts e2e/reflow.spec.ts e2e/target-size.spec.ts
#                                                                                                                                                          ^^^^ ADD these two
```
Each new spec's own skip const (place 2 of 2) — for UNSEEDED specs this is a route/anchor gate, NOT `HAS_SEED_ENV`:
```typescript
// e2e/reflow.spec.ts — runs unseeded; no skip on env (mirrors demo-public.spec.ts)
// (If a spec MUST be seed-gated later, then BOTH the seed-gated ci.yml list at
//  lines 1252-1262 AND a `const HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL
//  && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY` + test.skip(!HAS_SEED_ENV)
//  must be updated together — the twice-burned trap.)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tailwind.config.js` with `theme.screens` | Tailwind v4 CSS-first `@theme inline` in `globals.css` (no JS config) | Tailwind v4 (repo on `^4`) | Breakpoints are the v4 defaults (640/768/1024/1280/1536) unless `--breakpoint-*` tokens are added; none are. `useBreakpoint` exposes the defaults. |
| `metadata.viewport` (deprecated) | Separate `export const viewport: Viewport` | Next 14.0.0 (docs version history) | Viewport MUST be its own export, not a `metadata` field. Repo's `layout.tsx` has neither yet. |
| `useEffect`+`useState` media-query hooks | `useSyncExternalStore` (React 18+, repo on React 19.2.4) | React 18 / repo convention | `useMediaQuery` already uses it; `useBreakpoint` inherits the no-hydration-mismatch guarantee. |
| `window.innerWidth` for overflow | `document.documentElement.clientWidth` (SC#1) | This phase | `clientWidth` excludes the scrollbar gutter; SC#1 specifies `clientWidth` with ≤1px slop, more precise than the existing `demo-public.spec.ts` `innerWidth` check. |

**Deprecated/outdated:**
- The named parity spec `e2e/strategy-v2-chart-parity.spec.ts` is **dead** (`test.skip(true)`, targets Recharts/lightweight-charts, wrong route, no goldens). Do NOT treat it as the `TimeSeriesChart` parity guard. Add a real structural unit test instead.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `useBreakpoint` should expose `mobile`/`tablet`/`desktop` mapped to Tailwind defaults (640/1024 thresholds). The exact enum + thresholds are Claude's discretion (SC#3 only pins "thin wrapper, server snapshot `'desktop'`"). | Pattern 1 | Low — any reasonable enum works; planner/discuss can adjust. Inverse-query shape to get SSR `'desktop'` is the one firm recommendation. |
| A2 | Phase-44 reflow + target-size gates should be UNSEEDED, anchored on `/security`. SC#1 says "runnable against any route" + "anchored on a visible content element"; choosing an unseeded public route minimizes FLOW-01 surface. Phases 46/48 run them app-wide/seeded. | Summary, Pitfall 1 | Medium — if `/security` has sub-44px targets, target-size needs a scoped selector or a different anchor route; reflow on `/security` is safe (it's a simple editorial page). Planner picks final route(s) at plan time. |
| A3 | The zoom-meta guard should be a Vitest source-grep test (not a tsx/ci.yml script). SC#2 says "source-scan CI guard" without prescribing the mechanism; CONTEXT.md says "mirror the existing schema/SQL-function source guards" — but `chart-accessibility-layer.test.ts` is a closer mirror (source grep, not migration replay) and needs no ci.yml edit. | Alternatives Considered, Code Examples | Low — both run in CI and gate the `frontend` aggregator. Vitest is strictly less wiring. If the planner prefers the `schema:functions:check` script+ci.yml shape, both satisfy SC#2. |
| A4 | "Don't break its parity test" (SC#3) is satisfied by keeping the dead spec skipped + adding a real structural unit test for byte-identity. The named spec tests nothing live. | Pattern 2, Pitfall 4 | Medium — if the intent was a NEW visual snapshot of `TimeSeriesChart`, that's a larger task. Recommend the cheap structural unit test; flag for discuss-phase if a pixel snapshot is wanted. |
| A5 | The "mobile keyboard/focus check" clause in A11Y-02's prose is NOT a phase-44 success criterion (SC#4 lists only reflow/target-size/zoom-meta; REQUIREMENTS.md routes A11Y-01/03 to Phase 48). | Phase Requirements table | Low — confirmed by SC#4 wording + traceability table; planner should not add a keyboard gate to phase 44. |

## Open Questions

1. **Target-size gate's first-run scope on the chosen anchor route.**
   - What we know: `/security` renders unseeded; the `sm` Button variant (`px-3 py-1.5`) and footer links may be <44px.
   - What's unclear: whether phase 44 should (a) anchor on a route with all-≥44px targets, (b) scope the selector to a clean container, or (c) baseline current violations and fix in phase 45/46.
   - Recommendation: build the gate + helper, anchor on a clean container OR baseline-and-defer; document the choice so it's not a silent false-green. SC#1 only requires the gate EXIST + be RUNNABLE, not that the app fully passes it this phase.

2. **`ResponsiveChartFrame` byte-identity verification mechanism.**
   - What we know: the named parity spec is dead; there's no live snapshot of `TimeSeriesChart`'s SVG.
   - What's unclear: structural unit assertion (cheap) vs. a new Playwright visual snapshot (heavier, locale/font-hinting flaky per `playwright.config.ts`).
   - Recommendation: structural unit assertion on the exact `viewBox`/`preserveAspectRatio`/`className`/`style.aspectRatio` strings + run `TimeSeriesChart`'s existing co-located tests. Escalate to discuss if a pixel snapshot is desired.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | all builds & tests | ✓ | node 20 (ci.yml) | — |
| `@playwright/test` + chromium | reflow/target-size gates | ✓ | ^1.59.1 | — (CI installs chromium, `ci.yml:1033`) |
| `vitest` + `@vitest/coverage-v8` | zoom-meta guard + unit tests + ratchet | ✓ | ^4.1.2 / ^4.1.5 | — |
| `next` `Viewport` type | root viewport export | ✓ | ^16.2.3 | — (type verified in `node_modules`) |
| Seed env (`TEST_SUPABASE_*`) | seed-gated specs | ✓ (`vars.E2E_TEST_DB_CONFIGURED`) | — | Phase-44 gates are UNSEEDED → do not need it |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — phase 44 adds zero dependencies.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 (jsdom) + Playwright ^1.59.1 (chromium) |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `npx vitest run tests/visual/viewport-zoom-meta.test.ts src/hooks/useBreakpoint.test.ts src/components/ResponsiveTable.test.tsx src/components/ResponsiveChartFrame.test.tsx` |
| Full suite command | `npm test` (vitest) + `npm run test:coverage` (ratchet) + `npx playwright test e2e/reflow.spec.ts e2e/target-size.spec.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| A11Y-02 (reflow) | `scrollWidth <= clientWidth` ≤1px at 320px, visible-anchored | e2e | `npx playwright test e2e/reflow.spec.ts` | ❌ Wave 0 |
| A11Y-02 (target-size) | interactive targets ≥44px | e2e | `npx playwright test e2e/target-size.spec.ts` | ❌ Wave 0 |
| A11Y-02 (zoom-meta) | no `maximumScale`/`userScalable:false` in src | unit (source grep) | `npx vitest run tests/visual/viewport-zoom-meta.test.ts` | ❌ Wave 0 |
| SC#3 (useBreakpoint) | SSR snapshot `'desktop'`, 3 branches | unit | `npx vitest run src/hooks/useBreakpoint.test.ts` | ❌ Wave 0 |
| SC#3 (ResponsiveTable) | `overflow-x-auto` + sr-only hint | unit | `npx vitest run src/components/ResponsiveTable.test.tsx` | ❌ Wave 0 |
| SC#3 (ResponsiveChartFrame) | exact viewBox/preserveAspectRatio/`w-full`; TimeSeriesChart byte-identical | unit | `npx vitest run src/components/ResponsiveChartFrame.test.tsx` | ❌ Wave 0 |
| SC#2 (viewport export) | zoom-permissive `<meta>` emitted | unit/build | covered by zoom-meta guard (negative) + a render/smoke assertion | ❌ Wave 0 |
| SC#4 (ratchet) | coverage thresholds hold | coverage | `npm run test:coverage` | ✅ (existing `frontend-coverage` job) |

### Sampling Rate
- **Per task commit:** the quick run command for the touched primitive/gate.
- **Per wave merge:** `npm test` + `npx playwright test e2e/reflow.spec.ts e2e/target-size.spec.ts`.
- **Phase gate:** full vitest + coverage green (ratchet un-lowered) + a real CI run showing the new e2e gates `passed` (not `skipped`) — the FLOW-01 proven-execution requirement.

### Wave 0 Gaps
- [ ] `e2e/helpers/reflow.ts` — shared `assertNoReflow` + `assertTargetSizes` (formalizes `demo-public.spec.ts:309-349`)
- [ ] `e2e/reflow.spec.ts` — anchors on `/security` H1, 320px, ≤1px slop
- [ ] `e2e/target-size.spec.ts` — 44px measurement (scope decided at plan time)
- [ ] `tests/visual/viewport-zoom-meta.test.ts` — clone of `chart-accessibility-layer.test.ts`
- [ ] `src/hooks/useBreakpoint.test.ts` — SSR `'desktop'` + 3 branches
- [ ] `src/components/ResponsiveTable.test.tsx` — overflow + sr-only hint, both `hint` branches
- [ ] `src/components/ResponsiveChartFrame.test.tsx` — exact attribute strings + TimeSeriesChart adoption parity
- [ ] `ci.yml:1059` — add `e2e/reflow.spec.ts e2e/target-size.spec.ts` to the unseeded list (FLOW-01 place 1)
- [ ] Framework install: none — vitest + playwright + coverage all present

## Security Domain

> `security_enforcement` is not set `false` in config — included for completeness, but this phase has near-zero security surface (presentational primitives + CI gates, no auth/data/crypto).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase-44 gates are unseeded/public; no auth code |
| V3 Session Management | no | none |
| V4 Access Control | no | none |
| V5 Input Validation | no | no user input; source-scan reads only repo files |
| V6 Cryptography | no | none |
| V14 Config | yes (minor) | The `viewport` export + zoom-meta guard ARE a config-hardening control (WCAG 1.4.4 enforcement). No secrets touched. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CI artifact secret leak (Playwright trace embeds `NEXT_PUBLIC_*`) | Information Disclosure | Already mitigated — phase-44 gates run UNSEEDED (placeholder env), and the seed-gated path already skips report upload (`ci.yml:1288-1304`). Keeping phase-44 gates unseeded avoids the leak path entirely. |
| Source-grep guard executing repo content | Tampering | The Vitest guard only `readFileSync`s + regex-tests; it never `eval`s or imports scanned files (mirrors `chart-accessibility-layer.test.ts`). |

## Sources

### Primary (HIGH confidence)
- `src/hooks/useMediaQuery.ts` — exact `useMediaQuery` signature + `useSyncExternalStore` SSR-false snapshot (lines 13-29)
- `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx:9,37,564-580` — the exact viewBox(880)/`preserveAspectRatio="xMidYMid meet"`/`block w-full`/aspectRatio recipe
- `e2e/strategy-v2-chart-parity.spec.ts:47-51` — the named parity spec is `test.skip(true)` (dead; wrong stack/route, no goldens)
- `e2e/demo-public.spec.ts:277-351` — live reflow precedent (`scrollWidth > innerWidth`, 320px, toPass) to formalize
- `e2e/demo-founder-view.spec.ts:80-97` — second reflow precedent (`scrollWidth > innerWidth`)
- `tests/visual/chart-accessibility-layer.test.ts` — the whole-codebase Vitest source-grep guard pattern to clone (walk + regex + violations[])
- `.github/workflows/ci.yml:1059` (unseeded list), `:1252-1262` (seed-gated list), `:1250-1251` (the "update both" instruction), `:1205-1221` (prove-execution precedent), `:580-605` (`frontend` aggregator)
- `vitest.config.ts:25-44` (include globs incl. `tests/visual/**`), `:73-78` (thresholds)
- `src/components/ui/Button.tsx:17-18` — `min-h-[44px]` target-size convention; `pointer-coarse:` usage in `TimeSeriesChart.tsx:975,994`
- `src/app/globals.css:3-128` — `@theme inline` (no `--breakpoint-*` tokens → Tailwind v4 defaults)
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md` — `Viewport` export API (Next 16)
- `node_modules/next/dist/lib/metadata/types/extra-types.d.ts:45-54` — `ViewportLayout` fields (`maximumScale`, `userScalable`, etc.)
- `src/app/layout.tsx` — confirmed NO `viewport` export today; server component; has `dynamic="force-dynamic"`
- `.planning/REQUIREMENTS.md:42-43,75` (A11Y-02 text + Phase-44 mapping); `.planning/ROADMAP.md:117-160` (cross-cutting gates + phase-44 SC); `DESIGN.md` (tables ~44px, sr-only, two-pass SSR-false convention)

### Secondary (MEDIUM confidence)
- `e2e/discovery-axe.spec.ts:1-19` — the "false-green on empty/404 page" lesson (Grok W-02) applied to the reflow visible-anchor requirement

### Tertiary (LOW confidence)
- None — every claim is anchored on read-of-source in this repo or local Next docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all versions verified in package.json
- Architecture (primitives): HIGH — exact source recipes read and quoted with line numbers
- Architecture (gates): HIGH — exact ci.yml wiring sites + a working clone-target identified
- Pitfalls: HIGH — FLOW-01 + false-green + hydration each have a documented in-repo precedent
- Open questions: target-size scope on the anchor route + parity-verification mechanism are the only genuine plan-time decisions

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (stable — internal codebase patterns; Next 16 viewport API stable since v14)
