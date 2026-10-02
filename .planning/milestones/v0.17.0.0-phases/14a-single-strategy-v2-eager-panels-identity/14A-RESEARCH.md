# Phase 14a: Single-Strategy v2 — Eager Panels + Identity - Research

**Researched:** 2026-04-29
**Domain:** Next.js 16 App Router + Recharts identity + IntersectionObserver scaffold + Vitest/Playwright test infra
**Confidence:** HIGH (codebase patterns verified, Next.js 16.2 docs read locally, Recharts tick-prop semantics verified via official source)

## Summary

Phase 14a is a route-shipping phase, not a research-heavy domain investigation. Every architectural decision is locked by `14A-CONTEXT.md` and the approved `14A-UI-SPEC.md`. The remaining research surface is **codebase-pattern verification** — confirming that the patterns the spec assumes (flag handling, Recharts tick spread, IntersectionObserver stubbing in JSDOM, server-component test boundaries, Supabase path-extraction) actually behave as documented in the existing code, and surfacing the small set of frictions that will surprise the planner if not noted up front.

Five frictions matter: (1) Vitest's `include` glob is `src/**/*.test.{ts,tsx}` and **excludes** the spec-mandated `tests/a11y/` and `tests/visual/` paths — config edit required. (2) Playwright `testDir` is `./e2e` (project root), not `tests/e2e/` — the spec's `tests/e2e/strategy-v2-partial-data.spec.ts` path conflicts with project precedent, and is at the planner's discretion to follow either. (3) Next.js 16.2 ships `unstable_retry()` as the **preferred** error-boundary recovery API; UI-SPEC §5.5 specifies `reset()` (also still available, but no longer the documented default) — minor flag for the planner. (4) Recharts' `tick={objectLiteral}` is shallow-merged into internal SVG `<text>` props; `fontVariantNumeric: "tabular-nums"` IS valid as a React inline style on SVG `<text>` and resolves via the camelCase→kebab-case React mapping — `CHART_TICK_STYLE` will work as designed. (5) `EquityCurve` uses `lightweight-charts` (not Recharts), so its color mapping is hardcoded hex (`#0D9488` strategy series; `#94A3B8` benchmark) inside `createChart()`/`addSeries()` calls — `CHART_TICK_STYLE` does NOT apply here, but the DESIGN-01 audit (`#0D9488` → `CHART_ACCENT`) does, and lightweight-charts has its own `layout.textColor` for axis ticks (already `#64748B` ✓).

**Primary recommendation:** Plan as 6 small surfaces in dependency order — **(a)** chart-tokens extension + DESIGN-01 hex audit on `EquityCurve`; **(b)** `getStrategyDetailV2` server function in `src/lib/queries.ts`; **(c)** `useStrategyUiV2Flag` reader (mirror `widget-state-flag.ts`); **(d)** the 5 new strategy-v2 components + the route at `src/app/strategy/[id]/v2/page.tsx` + `error.tsx`; **(e)** the 4 test files (2 Vitest + 1 type-scale grep + 1 Playwright); **(f)** chrome — `package.json` removal, PR template, DESIGN.md decisions log entries. Wave the test files with their components.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Route mounting (`/strategy/[id]/v2`) | Frontend Server (RSC) | — | Public async server component, mirrors v1 at `src/app/strategy/[id]/page.tsx`; Next.js 16 App Router file convention |
| `strategy.ui_v2` flag read | Browser / Client | Frontend Server (SSR-default OFF) | URL param + localStorage are browser-only; SSR returns the safe default to avoid hydration mismatch |
| Path-extracted scalars (Panel 1–3 eager) | API / Backend (Supabase RPC + JSONB ops) | Frontend Server (consumer in queries.ts) | Path-extraction (`metrics_json -> 'key'`) happens in Postgres; TS layer just wraps the row select |
| 7-panel scrollable shell | Frontend Server (RSC) | — | Plain server-rendered HTML; no interactivity at the shell level |
| KPI strip / Panel 1 cells | Frontend Server (RSC) | — | Read-only display of pre-fetched scalars |
| Segmented control + chart toggle (Panel 2) | Browser / Client | — | Stateful, requires `"use client"`; sibling-mounted EquityCurve / DrawdownChart |
| IntersectionObserver scaffold (Panels 4–7) | Browser / Client | — | DOM API; SSR-guarded with `typeof IntersectionObserver === "undefined"` short-circuit |
| Error boundary (`error.tsx`) | Browser / Client | — | Next.js 16 requires `"use client"` for error files |
| WCAG-AA chart-axis contrast test | Test / Vitest+JSDOM | — | Pure unit test; no runtime impact |
| Partial-data history bands | Test / Playwright | API / Backend (synthetic fixture) | Wired via `page.route()` mocks OR seeded test strategy in Supabase (planner's discretion) |
| `@nivo/boxplot` removal | Build / Bundle | — | `npm uninstall` + verified-zero-imports grep + `npm run build` size delta |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Route topology & flag default (KPI-01):**
- `/strategy/[id]/v2` ships under `src/app/strategy/[id]/v2/page.tsx` — public, mirrors v1 factsheet route
- `strategy.ui_v2` localStorage flag default = OFF in Phase 14a (flips ON in 14b)
- URL override `?strategy_v2=on|off` allowed
- Discovery integration `/discovery/[slug]/[strategyId]` punted to Phase 14b

**Eager panel scope (KPI-02..05, KPI-22, KPI-23a):**
- Panel 1 (Overview): 6 cards eager from `strategies` row + `metrics_json` aggregates via `getStrategyDetailV2`
- Panel 2 (Headline+Equity): 6-cell KPI strip eager; segmented control with **Cum + Underwater eager**, Rolling Sharpe + Log Returns rendered disabled (`aria-disabled="true"` + tooltip "Available in Phase 14b"); BTC overlay default-ON
- Panel 3 (Drawdown): full-width DrawdownChart + WorstDrawdowns table; reuse as-is, no v2 fork
- Panels 4–7: white-card placeholders with literal "Loading…" copy + `data-panel-status="placeholder"` attribute, mounted lazily via IntersectionObserver
- Partial-data states: panels 1–3 each render documented "Awaiting more data (need ≥X days)" copy when relevant `metrics_json` keys are null; layout shape preserved (no panel-hiding)
- History bands tested: 7 / 30 / 90 / 365 days via Playwright synthetic fixtures

**Identity baseline (DESIGN-01..03, A11Y-01, CLEANUP-01):**
- Extend `src/components/charts/chart-tokens.ts` with `CHART_TICK_STYLE = { fontFamily: CHART_FONT_MONO, fontSize: 12, fontVariantNumeric: "tabular-nums", fill: CHART_AXIS_TICK }` (12px per UI-SPEC §2 4-size consolidation, NOT 11px)
- Reuse existing `CHART_AXIS_TICK = #64748B` (4.85:1 contrast on white — confirmed in `chart-tokens.ts:13`)
- WCAG-AA contrast test at `tests/a11y/chart-contrast.test.ts` (Vitest + JSDOM): asserts `getContrastRatio(CHART_AXIS_TICK, "#FFFFFF") >= 4.5` and grep-forbids `#94A3B8` / `#718096` as text fill on any axis label / tick / legend rendered inside `/strategy/[id]/v2`
- Bundle hygiene: `npm uninstall @nivo/boxplot` (~80KB gzipped); `ReturnQuantiles.tsx` is hand-rolled SVG with no boxplot dep — verified by grep
- DESIGN.md decisions log entry: stamp UC#7 7-panel density-rule deviation AND v2 4-size/2-weight type contract
- `.github/PULL_REQUEST_TEMPLATE.md` extended with per-chart identity checklist (or new `.github/PULL_REQUEST_TEMPLATE/strategy-v2.md` — Claude's discretion)

**Test infrastructure:**
- New `tests/a11y/` directory — `chart-contrast.test.ts`
- New `tests/visual/` directory — `strategy-v2-panel-count.test.ts`, `strategy-v2-tabular-nums.test.ts` (recommended), `strategy-v2-type-scale.test.ts`
- Partial-data history bands via Playwright at `tests/e2e/strategy-v2-partial-data.spec.ts` (UI-SPEC) — but project precedent is `e2e/` (Playwright `testDir: "./e2e"`); see Pitfall 2
- Decision recorded: success-criterion paths win over "co-locate next to source" convention

**Backend wiring (METRICS-15 path-extraction completion):**
- New `getStrategyDetailV2(strategyId)` in `src/lib/queries.ts` — reads scalars from `metrics_json -> 'key'` paths above-the-fold for Panels 1–3
- Leaves existing `getStrategyDetail` untouched (consumed by v1)
- Lazy panel hook: new `src/hooks/useLazyPanelMetrics.ts` wraps IntersectionObserver + `fetchStrategyLazyMetrics` (consumer already shipped Plan 12-08); 14a uses placeholder-only lifecycle (`fetchOnIntersect: false`)

### Claude's Discretion

- Component file layout under `src/components/strategy-v2/` (file names: `StrategyV2Shell.tsx`, `OverviewPanel.tsx`, `HeadlineMetricsPanel.tsx`, `DrawdownPanel.tsx`, `LazyPanelPlaceholder.tsx`, `PartialDataBanner.tsx`, `SegmentedControl.tsx`)
- Whether segmented control mounts/hides EquityCurve + DrawdownChart as siblings or swaps on toggle (BTC overlay default-ON contract holds across switches)
- Whether `useLazyPanelMetrics` ships as a true hook or passthrough scaffold (emits `status='ready'` immediately)
- Vitest config approach (extend `include` array vs separate config)
- PR template extension method (existing file edit vs new strategy-v2.md template)

### Deferred Ideas (OUT OF SCOPE)

- Panel 2 Rolling Sharpe + Log Returns toggle bodies (only Cum + Underwater eager in 14a)
- Bodies for panels 4–7 (Returns Distribution / Rolling / Trade & Exposure)
- Trade Mix maker/taker close-out (KPI-17 — gated on Phase 12 audit, deferred)
- DailyHeatmap SVG/Canvas fallback (Panel 4)
- axe-core CI integration on the full route (A11Y-02 lands in 14b)
- Full keyboard navigation across 7 panels (A11Y-03 lands in 14b)
- `/discovery/[slug]/[strategyId]` nested integration
- Multi-benchmark correlation matrix (UC#6 descope to Sprint 13+)
- Mobile-responsive polish, PDF presskit, universal v2 adoption, CI-gated bundle-size assertion

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KPI-01 | Open `/strategy/[id]/v2` (or v1 with localStorage flag toggling swap); flag mirrors `allocations.ui_v2` at `AllocationsTabs.tsx:111` | `widget-state-flag.ts` shows the canonical 3-tier URL>localStorage>SSR-default reader; `AllocationsTabs.tsx:225-243` shows the SSR-stable two-pass mount pattern that avoids hydration mismatch |
| KPI-02 | Panel 1 Overview row (Exchanges/Types/Subtypes/Markets/Leverage/Avg DTO) | All 6 fields exist on `Strategy` (types.ts:42-47); `avg_daily_turnover` is the field for "Avg DTO"; Empty cells render `—` em-dash |
| KPI-03 | Panel 2 6-cell KPI strip (Cum/CAGR/Sharpe/Sortino/Max DD/Vol) | All 6 scalars top-level on `StrategyAnalytics` (types.ts:95-101) — already path-extracted in v1's `extractAnalytics()`; getStrategyDetailV2 just selects them |
| KPI-04 | Equity vs BTC overlay segmented control with BTC default-ON (DIFF-03) | EquityCurve has built-in `showBenchmark` state (line 18, default `true`); needs new `hideBenchmarkToggle` prop OR Panel 2 lifts the checkbox out of EquityCurve internals |
| KPI-05 | Full-width DrawdownChart + Worst 5 table | DrawdownChart + WorstDrawdowns reused as-is; `metrics_json.drawdown_episodes` already populated by Python `metrics.py:316` — Worst 5 will show real data on 30+ day fixtures |
| KPI-22 | 7-panel scrollable shell + IntersectionObserver scaffold | Canonical IntersectionObserver pattern at `AllocationDashboardV2.tsx:147-188` with SSR-safe `typeof === "undefined"` guard; JSDOM stub at `AllocationDashboardV2.widget-gating.test.tsx:113-124` |
| KPI-23a | Per-panel partial-data states for panels 1–3 | UI-SPEC §4 fully specifies copy + thresholds; banners replace body region only, panel header + outer card unchanged |
| DESIGN-01 | Identity audit on every v2 chart | `EquityCurve.tsx:39,45,87` hardcodes `#0D9488` (forbidden) — DESIGN-01 audit replaces with `CHART_ACCENT` (`#1B6B5A`); 1-line edit per hex, no fork |
| DESIGN-02 | tabular-nums on numeric cells / axis ticks via `CHART_TICK_STYLE` | Recharts merges `tick={obj}` into `<text>` props; React maps `fontVariantNumeric` → SVG `font-variant-numeric` correctly; verified valid SVG2 attribute |
| DESIGN-03 | DESIGN.md decisions log entry + PR template addition | DESIGN.md decisions log lives at line 126-136, well-formed table format; no `.github/PULL_REQUEST_TEMPLATE.md` exists yet (must create) |
| A11Y-01 | All chart axis text uses `CHART_AXIS_TICK = #64748B` (≥4.5:1 contrast); never `#718096` (3.94:1) or `#94A3B8` (2.85:1) as text fill | Existing `chart-tokens.ts` already has `CHART_AXIS_TICK = #64748B`; no chart in `src/components/charts/` currently uses `#718096` or `#94A3B8` as a tick/text fill (verified via grep — see Pitfall 4) |
| CLEANUP-01 | `npm uninstall @nivo/boxplot` (~80KB saved); verify zero imports | `grep -r "@nivo/boxplot" src/ tests/` returns ZERO matches today (verified). Safe to uninstall; ReturnQuantiles.tsx is hand-rolled SVG |

## Standard Stack

### Core (already in `package.json` — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| `next` | ^16.2.3 | App Router, RSC, error/loading file conventions | Project's framework; v16.2 introduced `unstable_retry` for error boundaries |
| `react` / `react-dom` | 19.2.4 | RSC + client components | Project standard; React 19 stable |
| `recharts` | ^3.8.1 | Drawdown chart, RollingMetrics (already), tick spread target for `CHART_TICK_STYLE` | Already wired in `DrawdownChart.tsx`, `RollingMetrics.tsx`, `CorrelationWithBenchmark.tsx`, `YearlyReturns.tsx`, etc. |
| `lightweight-charts` | ^5.1.0 | EquityCurve (existing) | Already wired for `EquityCurve.tsx`; Tradinglib lightweight charting; NOT touched by `CHART_TICK_STYLE` (different API) |
| `@supabase/ssr` + `@supabase/supabase-js` | ^0.10.0 / ^2.101.1 | Server-side data fetching via `createClient()` from `src/lib/supabase/server.ts` | Project pattern; mirrored from v1 `getPublicStrategyDetail` |
| `vitest` | ^4.1.2 | Unit/component tests | Existing test runner — config at `vitest.config.ts` |
| `@playwright/test` | ^1.59.1 | E2E partial-data history bands | Existing E2E lane — config at `playwright.config.ts`, `testDir: "./e2e"` |
| `@testing-library/react` | ^16.3.2 | JSDOM render + queries | Existing test pattern at `src/test-setup.ts` |

### To Remove

| Library | Version | Action | Verification |
|---|---|---|---|
| `@nivo/boxplot` | ^0.99.0 | `npm uninstall @nivo/boxplot` | `grep -r "@nivo/boxplot" src/ tests/` returns 0 matches today (verified); `ReturnQuantiles.tsx` is hand-rolled SVG with zero `@nivo` imports |

### Version verification

`@nivo/boxplot` is the only package action. Confirmed unused via codebase grep — no version verification needed because it's being removed, not added.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│                                                                     │
│  GET /strategy/[id]/v2  ─────┐                                      │
│                              │                                      │
│  ?strategy_v2=on|off  ───────┼──┐                                   │
│                              │  │                                   │
└──────────────────────────────┼──┼──────────────────────────────────┘
                               │  │
                               ▼  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend Server (Next.js 16 RSC)                                   │
│                                                                     │
│  src/app/strategy/[id]/v2/page.tsx (async server component)         │
│       │                                                             │
│       ├── await params (Next 15+ promise pattern)                   │
│       ├── getStrategyDetailV2(id)  ────────┐                        │
│       │                                    │                        │
│       └── render <StrategyV2Shell> ─┐      │                        │
│            │                        │      │                        │
│            ├── <header>             │      │                        │
│            ├── <OverviewPanel>      │ EAGER│                        │
│            ├── <HeadlineMetricsPanel│ ─────┤                        │
│            │     "use client"       │      │                        │
│            │     ├── KPI strip      │      │                        │
│            │     ├── <SegmentedControl>    │                        │
│            │     └── <EquityCurve> | <DrawdownChart>                │
│            ├── <DrawdownPanel>      │      │                        │
│            ├── <LazyPanelPlaceholder p4..7>│ — IntersectionObserver │
│            └── <Disclaimer>         │      │                        │
│                                            │                        │
│  src/app/strategy/[id]/v2/error.tsx        │ — boundary             │
│       "use client" + unstable_retry        │                        │
│                                            │                        │
└────────────────────────────────────────────┼────────────────────────┘
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  API / Backend (Supabase Postgres)                                  │
│                                                                     │
│  strategies (row)              strategy_analytics (row, JSONB)      │
│       └── strategy_types[]            ├── cumulative_return         │
│       └── subtypes[]                  ├── cagr / sharpe / sortino   │
│       └── markets[]                   ├── max_drawdown / volatility │
│       └── supported_exchanges[]       ├── returns_series            │
│       └── leverage_range              ├── drawdown_series           │
│       └── avg_daily_turnover          └── metrics_json (JSONB)      │
│                                              ├── drawdown_episodes  │
│                                              ├── equity_series_1y   │
│                                              ├── btc_benchmark_…    │
│                                              └── …other scalars     │
│                                                                     │
│  fetch_strategy_lazy_metrics(strategy_id, panel_id) ── (14b only)   │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 14a additions only)

```
src/
├── app/
│   └── strategy/
│       └── [id]/
│           └── v2/
│               ├── page.tsx              ← server component, generateMetadata + notFound
│               ├── error.tsx             ← "use client", unstable_retry / reset CTA
│               └── page.test.tsx         ← optional sibling, render contract test
├── components/
│   └── strategy-v2/
│       ├── StrategyV2Shell.tsx           ← server component, 7 sections
│       ├── OverviewPanel.tsx             ← server component (6 cells)
│       ├── HeadlineMetricsPanel.tsx      ← "use client" (segmented control + chart)
│       ├── DrawdownPanel.tsx             ← server (DrawdownChart is already client)
│       ├── LazyPanelPlaceholder.tsx      ← "use client" (IntersectionObserver)
│       ├── PartialDataBanner.tsx         ← server (shared banner copy)
│       ├── SegmentedControl.tsx          ← "use client"
│       └── *.test.tsx                    ← co-located component tests
├── components/charts/
│   └── chart-tokens.ts                   ← extend with CHART_TICK_STYLE
├── hooks/
│   └── useLazyPanelMetrics.ts            ← IntersectionObserver hook
└── lib/
    ├── queries.ts                        ← extend with getStrategyDetailV2
    └── strategy-ui-v2-flag.ts            ← new flag reader

tests/                                     ← NEW top-level dirs (deviation documented)
├── a11y/
│   └── chart-contrast.test.ts
├── visual/
│   ├── strategy-v2-panel-count.test.ts
│   ├── strategy-v2-tabular-nums.test.ts (optional/recommended)
│   └── strategy-v2-type-scale.test.ts
└── e2e/
    └── strategy-v2-partial-data.spec.ts  ← OR keep in existing `e2e/` per project precedent

.github/
└── PULL_REQUEST_TEMPLATE.md              ← NEW (no template exists today)
                                            OR
.github/PULL_REQUEST_TEMPLATE/
├── default.md
└── strategy-v2.md                        ← Claude's discretion per CONTEXT.md
```

### Pattern 1: Public route async server component (mirrors v1)

**What:** Pages are async server components in App Router. `params` is a Promise (Next 15+); must `await` it. Public routes live under `src/app/strategy/...` (no `(dashboard)` parens prefix).

**When to use:** Page-level data fetch from Supabase before render.

**Example:**
```tsx
// Source: src/app/strategy/[id]/page.tsx (v1 reference)
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) return { title: "Strategy Not Found | Quantalyze" };
  return {
    title: `${result.strategy.name} — v2 | Quantalyze`,
    description: /* ... */,
  };
}

export default async function StrategyV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) notFound();
  return <StrategyV2Shell {...result} />;
}
```

**Source verification:** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` — confirms `params: Promise<...>` pattern in v15+; `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` confirms the metadata pattern.

### Pattern 2: SSR-safe localStorage flag reader

**What:** Three-tier precedence — URL > localStorage > SSR-safe default. Returns the safe default during SSR (avoids hydration mismatch); the actual flag value is read on the client only after mount.

**When to use:** Any client-side preference flag that needs to be readable without leaking through SSR.

**Example:**
```ts
// Source: src/lib/widget-state-flag.ts (canonical pattern)

export const STRATEGY_UI_V2_STORAGE_KEY = "strategy.ui_v2";
export const STRATEGY_UI_V2_URL_OVERRIDE = "strategy_v2";

export interface StrategyUiV2Options {
  search?: string; // for unit-testability
}

export function isStrategyUiV2Enabled(opts?: StrategyUiV2Options): boolean {
  // SSR-safe default OFF (Phase 14a). Flips to ON in 14b.
  if (typeof window === "undefined") return false;

  const search = opts?.search ?? window.location.search;
  const params = new URLSearchParams(search);
  const override = params.get(STRATEGY_UI_V2_URL_OVERRIDE);
  if (override === "v2" || override === "true" || override === "on") return true;
  if (override === "off" || override === "false") return false;

  try {
    const raw = window.localStorage.getItem(STRATEGY_UI_V2_STORAGE_KEY);
    return raw === "true";
  } catch {
    return false;
  }
}
```

**Hydration-safe consumption (mirrored from `AllocationsTabs.tsx:225-243`):**

```tsx
// Inside a "use client" component:
const [isV2, setIsV2] = useState<boolean>(/* SSR-stable default — same as server */);
useEffect(() => {
  /* eslint-disable react-hooks/set-state-in-effect */
  if (isStrategyUiV2Enabled() === true) setIsV2(true);
  /* eslint-enable react-hooks/set-state-in-effect */
}, []);
```

The two-pass mount pattern is **required** when the flag default differs from what the user has stored — without it, SSR renders one tree and client renders another, triggering a hydration warning.

**Caveat (14a):** Phase 14a's role for the flag is purely "should v1 redirect to v2?" — and the answer is **never** in 14a. The flag reader exists; the redirect logic is deferred to 14b. This means the flag reader can be shipped without any consumer in 14a, OR the planner can wire a no-op consumer (e.g., in `src/app/strategy/[id]/page.tsx` v1 wrapper that reads the flag but never redirects). **Recommendation:** ship the reader + its unit test; defer the consumer wiring to 14b. This keeps 14a's blast radius minimal.

### Pattern 3: IntersectionObserver hook (SSR-guarded)

**What:** Wrap `IntersectionObserver` in a hook that short-circuits on the server (`typeof IntersectionObserver === "undefined"`) and disconnects on unmount.

**When to use:** Lazy-mounting panel placeholders below the fold.

**Example (canonical pattern from `AllocationDashboardV2.tsx:147-188`):**

```ts
// src/hooks/useLazyPanelMetrics.ts
"use client";
import { useEffect, useRef, useState } from "react";

export type LazyStatus = "idle" | "loading" | "error" | "ready";
export type LazyPanelId = "panel4" | "panel5" | "panel6" | "panel7";

export interface UseLazyPanelMetricsOptions {
  rootMargin?: string; // default "200px"
  fetchOnIntersect?: boolean; // 14a default = false
}

export function useLazyPanelMetrics<T = unknown>(
  panelId: LazyPanelId,
  opts: UseLazyPanelMetricsOptions = {},
): { ref: (node: HTMLElement | null) => void; data: T | null; status: LazyStatus } {
  const [status, setStatus] = useState<LazyStatus>("idle");
  const [data, setData] = useState<T | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const ref = (node: HTMLElement | null) => {
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // SSR or test environment without polyfill — emit ready immediately.
      setStatus("ready");
      return;
    }
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          // 14a: placeholder-only, no fetch.
          setStatus("ready");
          observerRef.current?.unobserve(entry.target);
          // 14b: if (opts.fetchOnIntersect) { setStatus("loading"); fetchStrategyLazyMetrics(...) ... }
        }
      },
      { rootMargin: opts.rootMargin ?? "200px" },
    );
    observerRef.current.observe(node);
  };

  return { ref, data, status };
}
```

**JSDOM testing requires a stub** (canonical at `AllocationDashboardV2.widget-gating.test.tsx:113-124`):

```ts
beforeEach(() => {
  if (typeof globalThis.IntersectionObserver === "undefined") {
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});
```

**Recommendation:** Add the IntersectionObserver stub to `src/test-setup.ts` (next to the existing ResizeObserver stub at line 16-22) so all v2 component tests inherit it. Alternative is per-test stub — Pattern is established but the global path is cleaner.

### Pattern 4: Recharts `tick` spread for `CHART_TICK_STYLE`

**What:** Recharts' `<XAxis tick={obj}>` accepts an object that's shallow-merged into the internally-calculated tick props on the underlying SVG `<text>` element. React converts camelCase keys (`fontFamily`, `fontSize`, `fontVariantNumeric`, `fill`) into the corresponding kebab-case SVG/CSS attributes.

**When to use:** Every Recharts XAxis/YAxis in v2 panel charts.

**Example (today's verbose pattern — must be replaced):**
```tsx
// src/components/charts/DrawdownChart.tsx:25-39 — CURRENT (verbose)
<XAxis
  dataKey="date"
  tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
  /* ... */
/>
<YAxis
  tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
  /* ... */
/>
```

**Phase 14a target:**
```tsx
import { CHART_TICK_STYLE } from "./chart-tokens";

<XAxis dataKey="date" tick={CHART_TICK_STYLE} /* ... */ />
<YAxis tick={CHART_TICK_STYLE} /* ... */ />
```

**Source verification:**
- Recharts API doc (recharts.github.io) confirms `tick` accepts an object that's "merged into the internally calculated tick props"
- React inline-style spec confirms `fontVariantNumeric: "tabular-nums"` is a valid camelCase key on SVG `<text>` elements; resolves to `font-variant-numeric: tabular-nums` in the rendered DOM
- MDN font-variant-numeric documentation confirms `tabular-nums` is broadly supported on text elements (including SVG `<text>`)

**Pitfall 14 mitigation note:** the underlying problem is that SVG `<text>` does NOT inherit `font-variant-numeric` from a CSS class on a parent (e.g., a Tailwind `tabular-nums` utility on a wrapper div). Setting it as an attribute / inline style on the `<text>` element directly DOES work. `CHART_TICK_STYLE` solves this by inlining the property at the leaf.

**EquityCurve has a different surface:** `EquityCurve.tsx` uses `lightweight-charts`, NOT Recharts. Its tick text is configured via `createChart({ layout: { textColor: "#64748B", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 } })` (line 24-31). `CHART_TICK_STYLE` does NOT apply to EquityCurve — the Pitfall 14 spread test should grep only Recharts charts. EquityCurve's identity audit is separate (DESIGN-01 line-item: replace `'JetBrains Mono', monospace` with `var(--font-mono)` to match `CHART_FONT_MONO`, and replace `#0D9488` strategy/crosshair colors with `CHART_ACCENT`).

### Pattern 5: Server-component testing via wrapper extraction

**What:** Async server components are awkward to mount in JSDOM (Supabase + auth + async). Existing project precedent: extract the deterministic-render contract into a wrapper test that mounts the *client* component(s) with synthetic props.

**When to use:** Any test that needs to assert DOM structure on a page that is itself an async server component.

**Example (canonical at `src/app/strategy/[id]/page.test.tsx`):**

```tsx
// The page is an async server component that depends on Supabase and is
// awkward to mount in jsdom. We validate the contract with a minimal wrapper.
describe("/strategy/[id] — insertion contract", () => {
  it("StrategyNoteCard renders between sparkline-card and CTA-card", () => {
    const { container } = render(
      <div>
        <div data-testid="sparkline-card">sparkline</div>
        <StrategyNoteCard strategyId="x" initialContent="" initialLastSavedAt={null} />
        <div data-testid="cta-card">cta</div>
      </div>,
    );
    /* ... assert DOM order ... */
  });
});
```

**Implication for `tests/visual/strategy-v2-panel-count.test.ts`:**

The spec wants a JSDOM render asserting "exactly 7 `<section data-panel>`". Two viable approaches:

**(A)** Mock `getStrategyDetailV2` and render `<StrategyV2Shell>` directly with the mock's return shape. Requires `<StrategyV2Shell>` to be a server component that takes its data as a fully-resolved prop (it is, per UI-SPEC §6).

**(B)** Build a thin test wrapper that mounts the same 7 `<section>` elements `<StrategyV2Shell>` would mount, and assert count + `aria-label` + `data-panel-status`.

**Recommendation:** Approach (A). `<StrategyV2Shell>` is a synchronous server component (no `await`s in its body — it just maps panel data into JSX); React Testing Library's `render()` can handle it directly without the `await` ceremony. The fixture is a single object literal matching the `getStrategyDetailV2` return shape. This is the most direct way to satisfy the success criterion.

### Pattern 6: Recharts test mocking (ResponsiveContainer)

**What:** Recharts' `<ResponsiveContainer>` measures its parent and collapses to zero size in JSDOM. Mock it so render tests have a positive viewport.

**When to use:** Any test that mounts a Recharts chart in JSDOM (DrawdownChart, eventually any panel that wraps a Recharts chart).

**Example (canonical at `CorrelationWithBenchmark.test.tsx:11-23`):**
```tsx
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 240 }}>{children}</div>
    ),
  };
});
```

This pattern is borrowed from `allocations/widgets/attribution/attribution.test.tsx` per the comment header — it's project-canonical. Phase 14a's `tests/a11y/chart-contrast.test.ts` may or may not need it depending on how the assertion is structured (grep-based assertions don't need a mounted DOM; JSDOM-rendered axis-text fill assertions DO).

### Pattern 7: Path-extraction over `metrics_json`

**What:** Read scalars off the JSONB `metrics_json` column with Postgres path-extraction operators (`->`, `->>`) so individual keys travel without TOAST decompressing the whole blob.

**When to use:** Above-the-fold scalars (Panel 1–3 eager). For heavy series (Panel 4–7) the `fetch_strategy_lazy_metrics` SECURITY DEFINER RPC handles the sibling table.

**Example (Phase 14a target shape):**
```ts
// src/lib/queries.ts — new getStrategyDetailV2

export interface StrategyV2Detail {
  strategy: Strategy;
  panel1: {
    supported_exchanges: string[];
    strategy_types: string[];
    subtypes: string[];
    markets: string[];
    leverage_range: string | null;
    avg_daily_turnover: number | null;
  };
  panel2Headline: {
    cumulative_return: number | null;
    cagr: number | null;
    sharpe: number | null;
    sortino: number | null;
    max_drawdown: number | null;
    volatility: number | null;
  };
  panel2Equity: {
    series: { date: string; value: number }[] | null;
    btc_overlay: { date: string; value: number }[] | null;
  };
  panel3: {
    drawdown_series: { date: string; value: number }[] | null;
    drawdown_episodes: ServerEpisode[] | null;
  };
  lazyKeys: ("panel4" | "panel5" | "panel6" | "panel7")[];
  history_days: number; // for partial-data threshold checks
}

export async function getStrategyDetailV2(strategyId: string): Promise<StrategyV2Detail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("strategies")
    .select(`
      *,
      strategy_analytics (
        cumulative_return, cagr, sharpe, sortino, max_drawdown, volatility,
        returns_series,
        drawdown_series,
        metrics_json
      )
    `)
    .eq("id", strategyId)
    .eq("status", "published")
    .single();
  if (error || !data) return null;
  /* ...build StrategyV2Detail by reading metrics_json keys: equity_series_1y, drawdown_episodes, btc_benchmark_returns... */
}
```

**Note:** The METRICS-15 acceptance criterion (`p95 < 50ms`) is inherited from Phase 12. The `select` shape above only reads scalars + 2 series + the `metrics_json` column — TOAST decompression is bounded. If `metrics_json` is >800KB at p99.9, Phase 12's kill-switch already cut over heavy keys to `strategy_analytics_series` (migration 088), so above-the-fold reads remain fast.

**Available `metrics_json` keys (verified via `analytics-service/services/metrics.py`):** `equity_series_1y`, `drawdown_episodes`, `btc_benchmark_returns` (per H-D in migration 087), `var_1d_95`, `cvar`, `mtd`, `ytd`, `best_day`, `worst_day`, `three_month`, `best_month`, `worst_month`, `var_1m_99`, `gini`, `omega`, `gain_pain`, `tail_ratio`, `skewness`, `kurtosis`, `smart_sharpe`, `treynor`, etc. Phase 14a only needs `equity_series_1y`, `drawdown_episodes`, and the BTC benchmark (path-extracted via the existing benchmark fetch helper that v1 already uses for the sparkline).

### Anti-Patterns to Avoid

- **Reading the flag inline during render in a server component:** `if (typeof window !== "undefined" && localStorage.getItem(...))` inside JSX returns true on client, false on server, triggers hydration mismatch. Use the two-pass mount pattern above.
- **Using a CSS utility class for tabular-nums on Recharts axes:** The `<text>` SVG element does not inherit `font-variant-numeric` from a parent CSS class. **MUST** set `fontVariantNumeric` in the `tick` object directly. This is Pitfall 14.
- **Using `disabled` attribute on the disabled segmented control buttons:** UI-SPEC §8 specifies `aria-disabled="true"` (NOT `disabled`) so the button stays focusable for screen-reader announcement of the "Available in Phase 14b" tooltip. The click handler must short-circuit on `aria-disabled` instead of relying on the browser's disabled gate.
- **Forking `EquityCurve` or `DrawdownChart`:** Reuse as-is. The DESIGN-01 audit edits the existing files in place (1-line replacements per hardcoded hex). Forking creates a maintenance debt that 14b will inherit.
- **Hardcoding `text-[11px]` anywhere in v2 panels:** UI-SPEC §6 forbids it; `tests/visual/strategy-v2-type-scale.test.ts` greps for it. Use `text-xs` (12px) and `CHART_TICK_STYLE` (12px) only.
- **Using `font-medium` (500), `font-light` (300), or `font-bold` (700) anywhere in v2 panels:** UI-SPEC §6 forbids these. Allowed weights: `font-normal` (400) and `font-semibold` (600) only. The same type-scale test enforces it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Strategy detail page mounting | New custom page wrapper | Existing v1 pattern (mirror `src/app/strategy/[id]/page.tsx`) | Already-validated SSR + metadata + notFound flow |
| LocalStorage feature flag | Custom 3-tier reader from scratch | Mirror `widget-state-flag.ts` exactly (already canonical) | Two-pass mount + URL override + SSR safety solved already |
| Equity / drawdown / worst-5 widgets | New v2 chart components | Existing `EquityCurve` / `DrawdownChart` / `WorstDrawdowns` reused as-is | Already-tested, identity-audit only (DESIGN-01) — no fork |
| Recharts ResponsiveContainer in tests | Custom mock | Project-canonical mock at `CorrelationWithBenchmark.test.tsx:15-23` | Solved; copy-paste |
| IntersectionObserver loop | New IO class | Pattern at `AllocationDashboardV2.tsx:147-188` | SSR-safe, MutationObserver-backed (handles dynamic insertion) |
| WCAG luminance / contrast ratio | Hand-rolled algorithm | `polished` package OR a 12-line WCAG 2.0 luminance helper | Either works; `polished` is npm-installable but adds a dep — recommend hand-roll inline since it's a 12-line function and the test is the only consumer |
| Server-component test harness | Async test runner with Supabase mock | Wrapper-extraction pattern at `src/app/strategy/[id]/page.test.tsx` | Mount the underlying client/server JSX with synthetic data; skip the page's async wrapper |

**Key insight:** Phase 14a is almost entirely a composition phase — every chart, every flag pattern, every test stub already has a canonical implementation in the codebase. The novelty is the *7-panel shell + the partial-data banner copy + the disabled segmented buttons + the new `CHART_TICK_STYLE` token*, none of which require new infrastructure.

## Runtime State Inventory

This is a feature-shipping phase, not a rename / refactor / migration. No runtime state migration required. Explicit "none" answers per category:

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | None — `getStrategyDetailV2` reads existing `metrics_json` keys populated by Phase 12; no migration | none |
| Live service config | None — no n8n / Datadog / Tailscale / Cloudflare config touched | none |
| OS-registered state | None — no Task Scheduler / pm2 / systemd / launchd entries | none |
| Secrets/env vars | None — no new env vars; reuses existing Supabase service-role keys (already in production) | none |
| Build artifacts | One — `node_modules/@nivo/boxplot` will be removed by `npm uninstall`; `npm install` re-resolves the lockfile cleanly | run `npm install` after the `package.json` edit to regenerate `package-lock.json` |

## Common Pitfalls

### Pitfall 1: Vitest `include` glob excludes new top-level `tests/` dirs

**What goes wrong:** New test files at `tests/a11y/chart-contrast.test.ts`, `tests/visual/*.test.ts` are silently skipped by `vitest run` because the existing config restricts to `src/**/*.test.{ts,tsx}`.

**Why it happens:** `vitest.config.ts:9` declares `include: ["src/**/*.test.{ts,tsx}"]` — a hard scope.

**How to avoid:** Extend the `include` array (Claude's discretion per CONTEXT.md):
```ts
include: [
  "src/**/*.test.{ts,tsx}",
  "tests/a11y/**/*.test.ts",
  "tests/visual/**/*.test.ts",
],
```

**Warning sign:** `npm test` exits 0 but reports zero tests run from the new files. Always confirm by adding a deliberately-failing assertion to a new test during development to ensure the runner picks it up.

### Pitfall 2: Playwright `testDir` is `./e2e`, not `./tests/e2e`

**What goes wrong:** UI-SPEC §9 specifies `tests/e2e/strategy-v2-partial-data.spec.ts`, but `playwright.config.ts:4` declares `testDir: "./e2e"`. A spec at the new path is invisible to `npm run test:e2e` until either the path is adjusted or the config's `testDir` is extended.

**Why it happens:** Existing project precedent puts E2E specs at top-level `e2e/` (10 specs already there). The UI-SPEC's `tests/e2e/` is an aspirational reorganization that hasn't happened.

**How to avoid:** Choose ONE of:
- **(A)** Ship the spec at `e2e/strategy-v2-partial-data.spec.ts` (matches existing precedent, no config change). UI-SPEC's path is a soft-recommendation; CONTEXT.md does not lock it. **Recommended.**
- **(B)** Change `playwright.config.ts:4` to `testDir: "./tests/e2e"` AND move all 10 existing specs. Out of scope for 14a (would touch unrelated phases' tests).
- **(C)** Add a second test directory via Playwright projects. Overkill.

**Recommendation:** (A). Document the deviation from UI-SPEC in PR description. The success criterion is "the spec runs in CI"; the path is implementation detail.

**Warning sign:** Spec exists, file structure looks right, but `npx playwright test` reports "No tests found".

### Pitfall 3: Next.js 16.2 prefers `unstable_retry()` over `reset()` in error.tsx

**What goes wrong:** UI-SPEC §5.5 specifies the Reload-strategy CTA calls `reset()`. The Next.js 16.2 docs (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`) state that `unstable_retry` is the preferred recovery API, and `reset` is described as "in most cases, you should use `unstable_retry()` instead." Both APIs still exist; `reset()` is not deprecated, but `unstable_retry()` is the modern path.

**Why it happens:** The UI-SPEC was drafted before the `unstable_retry` API consolidation; the spec still uses Next 14/15 era language.

**How to avoid:** Use `unstable_retry()` for the primary CTA — the user-facing copy stays "Reload strategy" (verb + noun, copy contract preserved); only the underlying handler changes. This satisfies the UI-SPEC's *behavioral* contract (re-fetch + re-render the segment) and is closer to the current Next.js documented best practice.

```tsx
// src/app/strategy/[id]/v2/error.tsx
"use client";
import Link from "next/link";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div /* ... */>
      <h2>We couldn&apos;t load this strategy</h2>
      <p>Something went wrong loading the v2 view. Reload strategy, or fall back to the v1 factsheet.</p>
      <button onClick={() => unstable_retry()}>Reload strategy</button>
      <Link href={`/strategy/${/* strategyId from params */}`}>Open v1 factsheet</Link>
    </div>
  );
}
```

**Note:** Surface this as a non-blocking question in `/gsd-plan-phase`. If the locked CONTEXT.md decision genuinely requires `reset()` (e.g., to avoid the new API while it's still tagged `unstable_`), that's defensible and the planner should defer to the lock. **Recommendation:** prefer `unstable_retry` on Next 16.2 stability grounds, document the deviation from UI-SPEC §5.5 in the plan.

**Warning sign:** TypeScript may flag the destructured `unstable_retry` if the React types haven't caught up; add a one-line type annotation per the docs example.

### Pitfall 4: The forbidden colors (`#94A3B8`, `#718096`) MIGHT already appear in non-v2 charts

**What goes wrong:** A11Y-01 forbids `#94A3B8` and `#718096` as text-fill colors on axis labels / ticks / legends in `/strategy/[id]/v2`. The grep test must scope to `src/components/strategy-v2/**/*.tsx` (NOT all of `src/`). A naïve grep will hit `src/components/charts/EquityCurve.tsx:87` (BTC benchmark *stroke*, which is allowed and intentional) and produce a false positive.

**Why it happens:** Recharts' `tick` object uses the `fill` key (which is the text color); but `lightweight-charts` and Recharts-stroke colors also use these hex values for legitimate stroke purposes (BTC benchmark line is `#94A3B8`).

**How to avoid:** The grep regex must be scoped to `tick={` / `fill: "#94A3B8"` / `fill: "#718096"` patterns (NOT bare hex matching), AND scoped to v2 panel files only. Even better: render the v2 page in JSDOM, query `<text>` elements, and assert their `fill` attribute is `#64748B` or unset (UI-SPEC §9 line 798c approach). Mixing the grep + JSDOM query gives belt-and-suspenders coverage.

**Verified today:** `grep -rn "fill: \"#718096\"\|fill: \"#94A3B8\"" src/components/charts/` returns ZERO matches. The v2 panel components don't exist yet, so the test starts in a known-good state. The risk is only that future edits *introduce* a violation.

**Warning sign:** The contrast test passes locally but fails on CI because a different developer's editor stripped the unicode em-dash and replaced it with a plain dash that didn't break anything but the grep regex caught a substring it shouldn't have. Use anchored regex.

### Pitfall 5: SSR-stable initial state for the segmented control

**What goes wrong:** If the segmented control's default-active button is computed from `useState(initialKey)` where `initialKey` reads from URL or localStorage, the SSR HTML and client hydration disagree, triggering a hydration warning.

**Why it happens:** UI-SPEC §5.2 says "Cumulative active by default". This is fine if the default is hard-coded. But if the planner adds URL-state or localStorage-persistence for the active button (a natural extension), the same two-pass mount pattern from Pattern 2 above must apply.

**How to avoid:** In Phase 14a, the active button state is component-local + reset-on-mount (no URL or localStorage persistence — UI-SPEC does not require it). `useState<"cumulative"|"underwater">("cumulative")` is the right default; no flag involvement.

### Pitfall 6: `text-sm` is forbidden but used in `WorstDrawdowns.tsx:83,91`

**What goes wrong:** UI-SPEC §6 type-scale lint says `text-sm` is "Avoid in v2". But `WorstDrawdowns.tsx` (reused as-is per CONTEXT.md and UI-SPEC §6) currently uses `text-sm` for the depth cell and the empty-state copy.

**Why it happens:** The reused component predates the v2 type contract. The UI-SPEC's grep is scoped to `src/components/strategy-v2/**/*.tsx` (NOT `src/components/charts/`), so the existing `text-sm` is intentionally out of scope.

**How to avoid:** **Don't lint reused components against the v2 contract.** The `tests/visual/strategy-v2-type-scale.test.ts` glob must be exactly `src/components/strategy-v2/**/*.tsx` — no globbing of `src/components/charts/` reused components. The DESIGN-01 audit checklist on the PR template covers chart-level identity; the type-scale test covers panel-level layout.

**Warning sign:** A reasonable code-review reviewer says "but `WorstDrawdowns` is rendered in v2 — shouldn't it follow the v2 type contract?" The answer: no, it's a reused component with its own type-scale that isn't being v2-forked. The PR template per-chart identity checklist covers chart-level identity (DESIGN-01); v2 type-scale enforcement is layout-component-only.

### Pitfall 7: `isUiV2` two-pass-mount eslint rule

**What goes wrong:** The hydration-safe `useEffect(() => { if (loadFlag()) setState(true); }, [])` pattern triggers `react-hooks/set-state-in-effect`. UI-SPEC §0 references this as a flagged pattern.

**Why it happens:** The eslint rule (project-internal) catches setState-in-effect because it usually indicates a derived-state bug. Here it's intentional (one-shot post-mount localStorage read).

**How to avoid:** Use the existing project-canonical eslint-disable inline comment exactly as in `AllocationsTabs.tsx:240-242`:
```ts
useEffect(() => {
  /* eslint-disable react-hooks/set-state-in-effect */
  if (loadFlag()) setUiV2(true);
  /* eslint-enable react-hooks/set-state-in-effect */
}, []);
```

This is the canonical project pattern; copy-paste from the precedent.

### Pitfall 8: `getStrategyDetail` returns `EMPTY_ANALYTICS` on missing analytics; v2 should NOT

**What goes wrong:** v1's `getStrategyDetail` (`queries.ts:296`) falls back to `{ ...EMPTY_ANALYTICS, strategy_id }` when no analytics row exists. v2 partial-data banners need to *distinguish* "no analytics row" from "analytics row exists but key is null". Falling back to EMPTY_ANALYTICS would cause the partial-data banner to render the wrong copy.

**Why it happens:** v1's contract was "always render the page; analytics-pending shows a generic notice". v2's contract per UI-SPEC §4 is per-panel partial-data signaling.

**How to avoid:** `getStrategyDetailV2` should NOT fall back to EMPTY_ANALYTICS. Return `panel2Headline.cumulative_return: null` (etc.) when the source is missing OR when `computation_status !== "complete"`. The panel components inspect `null` vs. number to decide between "render value" / "render `—`" / "render partial-data banner".

**Warning sign:** Panel 2 KPI strip renders `0.0%` for every cell on a 7-day fixture instead of the partial-data banner. Symptom of EMPTY_ANALYTICS leaking through.

### Pitfall 9: `EquityCurve` `lightweight-charts` color hardcodes — DESIGN-01 audit scope

**What goes wrong:** `EquityCurve.tsx` is `lightweight-charts`-based, NOT Recharts. Its colors are hardcoded INSIDE `createChart()` and `addSeries()` calls (lines 27, 39, 45, 87). The hex values are:
- Line 28 `textColor: "#64748B"` ← already correct (CHART_AXIS_TICK)
- Line 29 `fontFamily: "'JetBrains Mono', monospace"` ← stale; should be `var(--font-mono)` (currently Geist Mono)
- Line 30 `fontSize: 11` ← UI-SPEC says 12; minor
- Line 39, 40 `labelBackgroundColor: "#0D9488"` ← stale; should be `CHART_ACCENT` `#1B6B5A`
- Line 45 `color: "#0D9488"` ← strategy series, MUST be `CHART_ACCENT`
- Line 87 `color: "#94A3B8"` ← BTC benchmark stroke; CORRECT (the muted-as-stroke contract)

**Why it happens:** The component predates `chart-tokens.ts`; never had its identity audited.

**How to avoid:** DESIGN-01 audit task lists each line-item as a separate edit. ONE PR. Replace literals with imports from `chart-tokens.ts`. Don't fork.

### Pitfall 10: `PR template path conflict` — multiple PR templates require directory layout

**What goes wrong:** No `.github/PULL_REQUEST_TEMPLATE.md` exists today (verified). The CONTEXT.md offers Claude's discretion: edit a non-existent file vs. create `.github/PULL_REQUEST_TEMPLATE/strategy-v2.md`.

**Why it happens:** GitHub recognizes either:
- **(A)** A single `.github/PULL_REQUEST_TEMPLATE.md` (or `pull_request_template.md`) — applied to all PRs.
- **(B)** A directory `.github/PULL_REQUEST_TEMPLATE/` containing multiple templates, selected via `?template=strategy-v2.md` query string on the PR creation URL.

**How to avoid:** **Recommendation:** Create the single-file `.github/PULL_REQUEST_TEMPLATE.md` with the per-chart identity checklist as one section among others (Title, Summary, Test plan, Identity audit checklist). Single template applies to every PR — keeps DESIGN-03 enforcement automatic on all chart-touching PRs, not just opt-in. Phase 14b can revisit if multi-template selection becomes valuable.

## Code Examples

### Recharts `<XAxis>` with `CHART_TICK_STYLE` (DESIGN-02)

```tsx
// Source: extension of src/components/charts/chart-tokens.ts + DrawdownChart.tsx pattern
import { CHART_TICK_STYLE } from "./chart-tokens";

<XAxis
  dataKey="date"
  tick={CHART_TICK_STYLE}
  tickLine={false}
  axisLine={{ stroke: CHART_BORDER }}
  tickFormatter={(d: string) => d.slice(5)}
  interval="preserveStartEnd"
/>
```

### Server-component page with metadata + notFound

```tsx
// Source: mirror of src/app/strategy/[id]/page.tsx (v1)
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStrategyDetailV2 } from "@/lib/queries";
import { StrategyV2Shell } from "@/components/strategy-v2/StrategyV2Shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) return { title: "Strategy Not Found | Quantalyze" };
  return {
    title: `${result.strategy.name} — v2 | Quantalyze`,
    description: `${result.strategy.name} — Verified quantitative strategy on Quantalyze.`,
  };
}

export default async function StrategyV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) notFound();
  return <StrategyV2Shell {...result} />;
}
```

### Error boundary with `unstable_retry` (Next 16.2 preferred)

```tsx
// src/app/strategy/[id]/v2/error.tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-base font-semibold text-text-primary mb-2">
          We couldn&apos;t load this strategy
        </h2>
        <p className="text-xs text-text-muted mb-4">
          Something went wrong loading the v2 view. Reload strategy, or fall back to the v1 factsheet.
        </p>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded-md bg-card border border-accent text-accent px-4 py-2 text-xs font-semibold"
          >
            Reload strategy
          </button>
          {/* Linking back to v1 — strategy id from the URL via usePathname or window.location */}
          <Link
            href="/"
            className="rounded-md border border-border text-text-secondary px-4 py-2 text-xs"
          >
            Open v1 factsheet
          </Link>
        </div>
      </div>
    </div>
  );
}
```

**Note:** The "Open v1 factsheet" Link's href needs the strategy id. Since `error.tsx` doesn't receive `params`, derive it from `window.location.pathname` (client-only, fine for an error boundary). Alternative: throw the strategy id into the error message and parse it out. Recommend: `usePathname()` from `next/navigation` and split on `/`.

### Disabled segmented button (UI-SPEC §3 / §5.2)

```tsx
<button
  type="button"
  aria-disabled="true"
  title="Available in Phase 14b"
  className="rounded-md border border-border bg-surface text-text-muted opacity-60 cursor-not-allowed px-3 py-1.5 text-xs"
  onClick={(e) => e.preventDefault()}
>
  Rolling Sharpe
</button>
```

**aria-disabled NOT disabled:** UI-SPEC §8 — keeps the button focusable for screen-reader announcement; the click handler short-circuits.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `error.tsx` recovery via `reset()` | `error.tsx` recovery via `unstable_retry()` (preferred) | Next.js 16.2 | UI-SPEC §5.5 specifies `reset()`; Pitfall 3 recommends `unstable_retry()` |
| Sync `params` prop | Promise-wrapped `params` requiring `await` | Next.js 15.0-RC | All v2 page handlers MUST `await params` |
| Boxplot via `@nivo/boxplot` (~80KB) | Hand-rolled SVG `ReturnQuantiles` | Phase 12-? | CLEANUP-01 just removes the dead dep; component already migrated |
| `CHART_FONT_MONO = "JetBrains Mono"` (legacy) | `CHART_FONT_MONO = var(--font-mono)` resolves to Geist Mono | Phase 11 (DESIGN.md decision 2026-04-06) | EquityCurve still has the literal "'JetBrains Mono', monospace" — DESIGN-01 audit fixes |

**Deprecated/outdated:**
- `text-[11px]`, `text-[13px]`, `font-medium`, `font-light`, `font-bold` Tailwind classes inside `src/components/strategy-v2/**/*.tsx` — type-scale grep test enforces 4-size / 2-weight contract per UI-SPEC §6
- `tick={{ fontSize, fill, fontFamily }}` verbose object literals in v2 panel charts — replaced by `tick={CHART_TICK_STYLE}` spread

## Project Constraints (from CLAUDE.md / AGENTS.md)

The following are extracted from `./CLAUDE.md` and `./AGENTS.md`. The planner MUST verify compliance.

- **AGENTS.md:** "This is NOT the Next.js you know. This version has breaking changes. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code." This research already pulled `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`, `error.md`, `loading.md` and `04-functions/generate-metadata.md`. The planner should re-read each before drafting concrete code in tasks.
- **DESIGN.md authority:** "Always read DESIGN.md before making any visual or UI decisions. All font choices, colors, spacing, and aesthetic direction are defined there. Do not deviate without explicit user approval." UI-SPEC §0 already locks the v2 4-size / 2-weight subset; Phase 14a's identity baseline ALIGNS with DESIGN.md (see DESIGN.md decisions log for the new entries to be stamped).
- **Banned packages (CLAUDE.md):** `axios`, `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai`. **None used in Phase 14a.** Phase 14a removes `@nivo/boxplot` (legitimate cleanup, not banned).
- **Simplicity First:** Phase 14a does NOT introduce new abstractions; reuses 7 existing components (EquityCurve / DrawdownChart / WorstDrawdowns / VerifiedBadge / Disclaimer / chart-tokens / widget-state-flag pattern). The 7 new strategy-v2 components are layout-shells that read pre-fetched data and dispatch to existing widgets. No new lib, no new hooks beyond the IntersectionObserver wrapper.
- **Plan Mode default:** This is a 12-REQ phase with 6 distinct surfaces. Plan-mode is required.
- **Subagent strategy:** Each new component (StrategyV2Shell, OverviewPanel, HeadlineMetricsPanel, DrawdownPanel, LazyPanelPlaceholder, PartialDataBanner, SegmentedControl) is a small, focused unit suitable for isolation in a subagent. The 4 test files (chart-contrast, panel-count, type-scale, partial-data e2e) are likewise small and isolatable.
- **Subagent branch protection:** Every subagent prompt must include "DO NOT run `git checkout`, `git pull`, or any branch-switching command. Stay on the current branch." Per memory `feedback_subagent_branch_protection`.

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Vitest 4.1.2 (unit/component) + Playwright 1.59.1 (E2E) |
| Config files | `vitest.config.ts`, `playwright.config.ts` (both at repo root) |
| Quick run command | `npm test -- src/components/strategy-v2/` (component tests) |
| Full suite command | `npm test && npm run test:e2e` |
| Type-check | `npm run typecheck` |
| Build gate | `npm run build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| KPI-01 | Public route mounts; flag default OFF | unit (Vitest) | `npm test -- src/lib/strategy-ui-v2-flag.test.ts` | ❌ Wave 0 — new file |
| KPI-02 | Panel 1 6-cell row renders all 6 fields with `—` for null | component (Vitest) | `npm test -- src/components/strategy-v2/OverviewPanel.test.tsx` | ❌ Wave 0 |
| KPI-03 | Panel 2 KPI strip renders 6 cells with sign coloring | component (Vitest) | `npm test -- src/components/strategy-v2/HeadlineMetricsPanel.test.tsx` | ❌ Wave 0 |
| KPI-04 | Segmented control: Cum / Underwater toggle; Rolling Sharpe + Log Returns disabled with aria-disabled and tooltip | component (Vitest) | `npm test -- src/components/strategy-v2/HeadlineMetricsPanel.test.tsx` | ❌ Wave 0 |
| KPI-04 | BTC overlay default-ON renders both with and without benchmark | component (Vitest) | same | ❌ Wave 0 |
| KPI-05 | Panel 3 renders DrawdownChart + WorstDrawdowns full-width | component (Vitest) | `npm test -- src/components/strategy-v2/DrawdownPanel.test.tsx` | ❌ Wave 0 |
| KPI-22 | Exactly 7 `<section data-panel>` elements | visual (Vitest+JSDOM) | `npm test -- tests/visual/strategy-v2-panel-count.test.ts` | ❌ Wave 0 |
| KPI-22 | IntersectionObserver scaffold mounts placeholders | component (Vitest) | `npm test -- src/components/strategy-v2/LazyPanelPlaceholder.test.tsx` | ❌ Wave 0 |
| KPI-23a | 7 / 30 / 90 / 365-day fixtures render expected panel-1-3 partial-data states | E2E (Playwright) | `npm run test:e2e -- e2e/strategy-v2-partial-data.spec.ts` | ❌ Wave 0 |
| DESIGN-01 | Identity audit (white card / accent / muted / 1px gridlines / no Plotly chrome) | manual via PR template checklist | (PR review) | n/a |
| DESIGN-02 | tabular-nums on every v2 axis tick | visual grep (Vitest) | `npm test -- tests/visual/strategy-v2-tabular-nums.test.ts` | ❌ Wave 0 (recommended) |
| DESIGN-02 | 4-size / 2-weight type contract enforced | visual grep (Vitest) | `npm test -- tests/visual/strategy-v2-type-scale.test.ts` | ❌ Wave 0 |
| DESIGN-03 | DESIGN.md decisions log entries stamped + PR template extended | manual | (file presence diff) | n/a |
| A11Y-01 | Chart axis text always uses `CHART_AXIS_TICK = #64748B` (≥4.5:1 contrast); never `#94A3B8` / `#718096` as text fill | a11y unit (Vitest+JSDOM) | `npm test -- tests/a11y/chart-contrast.test.ts` | ❌ Wave 0 |
| CLEANUP-01 | `@nivo/boxplot` removed; `npm run build` exits 0; bundle size delta logged | manual + `npm run build` | (PR diff + build artifact) | n/a |

### Sampling Rate

- **Per task commit:** `npm test -- src/components/strategy-v2/<file>` (the relevant component test) + `npm run typecheck`
- **Per wave merge:** `npm test` (full Vitest suite — visual + a11y + co-located tests)
- **Phase gate:** `npm test && npm run test:e2e && npm run build` all green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` — extend `include` to cover `tests/a11y/**` and `tests/visual/**`
- [ ] `src/test-setup.ts` — add `IntersectionObserver` stub next to existing `ResizeObserver` stub (recommended global path)
- [ ] `tests/a11y/chart-contrast.test.ts` — covers A11Y-01
- [ ] `tests/visual/strategy-v2-panel-count.test.ts` — covers KPI-22 hard count
- [ ] `tests/visual/strategy-v2-type-scale.test.ts` — covers DESIGN-02 4-size/2-weight contract
- [ ] `tests/visual/strategy-v2-tabular-nums.test.ts` — covers DESIGN-02 spread enforcement (recommended)
- [ ] `e2e/strategy-v2-partial-data.spec.ts` — covers KPI-23a (4 fixtures)
- [ ] `src/lib/strategy-ui-v2-flag.test.ts` — mirror `widget-state-flag.test.ts`
- [ ] `src/components/strategy-v2/HeadlineMetricsPanel.test.tsx` — covers KPI-03, KPI-04
- [ ] `src/components/strategy-v2/OverviewPanel.test.tsx` — covers KPI-02
- [ ] `src/components/strategy-v2/DrawdownPanel.test.tsx` — covers KPI-05
- [ ] `src/components/strategy-v2/LazyPanelPlaceholder.test.tsx` — covers KPI-22 placeholder lifecycle
- [ ] `src/components/strategy-v2/SegmentedControl.test.tsx` — covers disabled-button click no-op + tooltip presence

## Security Domain

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | Public route, no auth gate |
| V3 Session Management | no | No session state introduced |
| V4 Access Control | yes | Strategy visibility = `status='published'` predicate (mirrored from v1 `getPublicStrategyDetail`); private strategies return null → `notFound()` |
| V5 Input Validation | yes | `params.id` is a UUID; Supabase's `.eq("id", strategyId)` parameter-binds (no SQL injection); URL override `?strategy_v2=` accepts a small whitelist of values, defaults to off on malformed input (mirroring `widget-state-flag.ts`) |
| V6 Cryptography | no | No new crypto; reuses Supabase's existing TLS + RLS |
| V7 Error Handling | yes | `error.tsx` is a Client Component; production-mode errors are scrubbed by Next.js (digest only); `error.message` only forwarded for client-thrown errors per `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:106-115` |
| V8 Data Protection | yes | No new data exposure; `getStrategyDetailV2` reads only fields v1 already exposes via `getPublicStrategyDetail` and the `metrics_json` keys for `published` strategies (already public) |
| V13 API + Web Service | yes | No new API endpoint; route is RSC-rendered HTML |

### Known Threat Patterns for Next.js 16 + Supabase

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Hydration-leak of internal state via flag default mismatch | I (Information disclosure) | Two-pass mount per Pattern 2; SSR returns the safe default |
| URL parameter injection via `?strategy_v2=…` | T (Tampering) | Whitelist values: `on`, `true`, `v2`, `off`, `false`; anything else falls through to localStorage. Pattern verified in `widget-state-flag.ts:48-54` |
| Cross-tier disclosure (private strategy via direct UUID) | I | Server-side `eq("status", "published")` gate; `notFound()` (404) returned for non-published — no leak of strategy existence beyond what v1 already does |
| Error message leak in production | I | Next.js production-mode `error.tsx` automatically scrubs server-thrown error messages, exposes only `error.digest` (per Next 16.2 docs) |
| RSC props serialization of secrets | I | `getStrategyDetailV2` returns only data already public via v1; no service-role-only fields ever cross the RSC boundary |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node 20+ | Build / Vitest / Playwright | ✓ | per devEngines | — |
| `next` | Page handler / metadata / error.tsx | ✓ | ^16.2.3 (in `package.json`) | — |
| `react` / `react-dom` | All components | ✓ | 19.2.4 | — |
| `recharts` | DrawdownChart in v2 panels | ✓ | ^3.8.1 | — |
| `lightweight-charts` | EquityCurve | ✓ | ^5.1.0 | — |
| `@supabase/ssr` + `@supabase/supabase-js` | `getStrategyDetailV2` | ✓ | ^0.10.0 / ^2.101.1 | — |
| `vitest` + `@testing-library/react` | All Vitest tests | ✓ | ^4.1.2 / ^16.3.2 | — |
| `@playwright/test` | E2E partial-data spec | ✓ | ^1.59.1 | — |
| Phase 12 `metrics_json` schema (post-METRICS-15) | `getStrategyDetailV2` path-extraction | ✓ | shipped via migrations 087+088 | — |
| `equity_series_1y` populated by `metrics.py` | Panel 2 chart fixtures | ✓ | shipped Phase 12 | — |

**No missing dependencies.** All infrastructure for Phase 14a is shipped by Phase 12 + the existing project setup.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `getStrategyDetailV2` can compose its return shape from a single `select *, strategy_analytics(*)` row + path-extraction over `metrics_json` (no separate sibling-table read needed for Panels 1–3) | Pattern 7 / Architecture | If the equity series is too large to live in `metrics_json` post-cutover, the read joins the sibling table. Phase 12's H-D states `equity_series_1y` STAYS in `metrics_json` — verified — so this assumption holds for known data shapes. Risk: a future strategy with >5y daily history pushes `equity_series_1y` beyond the 1MB ceiling and triggers cutover. Mitigation: kill-switch ALREADY moves heavy keys to sibling table; query falls back to lazy fetch via `fetchStrategyLazyMetrics`. Phase 14a is OK on current data. |
| A2 | `unstable_retry` is the API the planner should adopt over `reset()` (Pitfall 3) | Pitfall 3 / Pattern 1 | UI-SPEC §5.5 says `reset()`. If user prefers spec compliance, `reset()` works too — both are documented in Next.js 16.2. Either is correct; my recommendation is `unstable_retry` on currency grounds. |
| A3 | Single PR template at `.github/PULL_REQUEST_TEMPLATE.md` (Pitfall 10) is preferred over multi-template directory | Pitfall 10 | If the project later wants a per-template URL, must migrate to directory. Low-cost migration. Single file is the simplest start. |
| A4 | Playwright spec lives at `e2e/strategy-v2-partial-data.spec.ts` (project precedent), NOT `tests/e2e/` (UI-SPEC) (Pitfall 2) | Pitfall 2 | Spec at the wrong path = silent zero-tests. Recommendation in this research is path (A); planner can override with config change if a `tests/e2e/` reorg is desired. |
| A5 | The `tests/visual/strategy-v2-tabular-nums.test.ts` test (UI-SPEC §9 line 800) is RECOMMENDED but optional — UI-SPEC marks it "(NEW — recommended)" | Validation Architecture | If skipped, the type-scale test still catches forbidden literals. tabular-nums grep is a belt-and-suspenders extra. Low risk if dropped. |
| A6 | The `error.tsx` "Open v1 factsheet" Link derives strategy id from `usePathname()` rather than props (Code Examples / error.tsx) | Code Examples | Next.js error boundaries don't pass route params; deriving from pathname is the standard pattern. Alternative: read `window.location.pathname` directly. Both work in client components. |
| A7 | The 7-day partial-data fixture for Panel 2 KPI strip renders the partial-data banner (need ≥30 days) but the equity chart renders the strategy series (need ≥7 days) | UI-SPEC §4 / Pitfall 8 | Per UI-SPEC §4 partial-data thresholds — this is the documented contract. If the planner mis-implements thresholds, the e2e spec catches it. |
| A8 | The partial-data Playwright spec uses `page.route()` to intercept the Supabase server-side call OR seeds a test strategy in the Supabase test DB (Validation Architecture / Pitfall 2) | Validation Architecture | RSC pages don't intercept easily via Playwright `page.route()` because the data fetch happens server-side BEFORE the response is sent. **Likely approach:** seed 4 test strategies (one per history band) in the Supabase test database, deterministically named, fetched by id from the spec. This is how the existing E2E suite likely already operates. Verifying the existing pattern is a Plan-phase task, not a research task. |

**A1–A8 are the explicit assumed claims in this research.** All other claims are verified against codebase reads or local Next.js 16.2 docs.

## Open Questions

1. **Playwright E2E spec path: `e2e/` (project precedent) or `tests/e2e/` (UI-SPEC §9)?**
   - What we know: Playwright `testDir: "./e2e"` ships 10 specs. UI-SPEC requests new path.
   - What's unclear: Is the `tests/e2e/` rename intentional or aspirational?
   - Recommendation: Use `e2e/strategy-v2-partial-data.spec.ts`; document deviation from UI-SPEC §9 in PR description. Cost of moving 10 specs is high; cost of writing one new spec at the existing path is zero. (Pitfall 2.)

2. **`error.tsx` recovery: `unstable_retry()` (Next 16.2 preferred) or `reset()` (UI-SPEC §5.5)?**
   - What we know: Both APIs exist in Next.js 16.2; `unstable_retry` is the docs-recommended path; `reset()` is described as "in most cases, you should use `unstable_retry()` instead."
   - What's unclear: Whether the UI-SPEC's choice of `reset()` was deliberate (e.g., to avoid the `unstable_` prefix) or a pre-Next-16.2 default.
   - Recommendation: Use `unstable_retry()`. Surface as a non-blocking note. (Pitfall 3.)

3. **Partial-data Playwright fixture mechanism: seeded test strategies vs. `page.route()` mocks?**
   - What we know: RSC pages fetch data server-side; client `page.route()` doesn't intercept the server-to-Supabase call.
   - What's unclear: Does the existing Phase 13 E2E suite (the "Playwright CI lane that Phase 13 added" per CONTEXT.md) provide a pattern? Existing specs at `e2e/discovery-hide-examples-default.spec.ts`, `e2e/discovery-prefs-isolation.spec.ts` likely show the answer.
   - Recommendation: Plan-phase task: read `e2e/discovery-*.spec.ts` to discover the existing E2E data-fixture pattern, mirror it.

4. **PR template: edit `.github/PULL_REQUEST_TEMPLATE.md` (creating it) vs. multi-template directory?**
   - What we know: No template exists today (verified). Both options are valid GitHub conventions.
   - What's unclear: Project preference — but no precedent exists, so the decision is fresh.
   - Recommendation: Single file `.github/PULL_REQUEST_TEMPLATE.md`. (Pitfall 10.)

5. **Should the IntersectionObserver stub move to `src/test-setup.ts` (global) or stay per-test?**
   - What we know: ResizeObserver IS stubbed globally in `src/test-setup.ts:16-22`; IntersectionObserver IS stubbed per-test in `AllocationDashboardV2.widget-gating.test.tsx:113-124`.
   - What's unclear: Whether the per-test pattern was deliberate (e.g., different tests want different stub behavior) or just the path of least resistance.
   - Recommendation: Move the stub to `src/test-setup.ts` for consistency with ResizeObserver. Phase 14a's component tests all want the same minimal-stub behavior.

## Sources

### Primary (HIGH confidence)

- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` — Next.js 16.2 page conventions, async params, generateMetadata
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` — Next.js 16.2 error.tsx, `unstable_retry` vs `reset`, version 16.2.0 release note
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md` — Next.js loading conventions
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` — generateMetadata signature
- `package.json` — verified versions of `next` (^16.2.3), `react` (19.2.4), `recharts` (^3.8.1), `@nivo/boxplot` (^0.99.0 — to remove)
- `src/lib/widget-state-flag.ts` — canonical 3-tier flag pattern + SSR-safe default (lines 1-65)
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx:111-243` — canonical hydration-safe two-pass mount + flag-rollback pattern
- `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx:147-188` — canonical IntersectionObserver pattern with SSR guard + MutationObserver
- `src/app/(dashboard)/allocations/AllocationDashboardV2.widget-gating.test.tsx:113-124` — canonical IntersectionObserver JSDOM stub
- `src/app/strategy/[id]/page.tsx` — v1 public route pattern (the mirror)
- `src/app/strategy/[id]/page.test.tsx` — server-component test wrapper pattern
- `src/components/charts/chart-tokens.ts` — existing tokens (CHART_ACCENT, CHART_AXIS_TICK = #64748B, CHART_FONT_MONO, CHART_TOOLTIP_STYLE)
- `src/components/charts/EquityCurve.tsx` — lightweight-charts component, hardcoded `#0D9488` to be DESIGN-01 audited
- `src/components/charts/DrawdownChart.tsx` — Recharts component, current verbose `tick={{ fontSize: 11, ... }}` pattern
- `src/components/charts/CorrelationWithBenchmark.test.tsx:11-23` — canonical Recharts ResponsiveContainer mock for JSDOM
- `src/components/charts/WorstDrawdowns.tsx` — Panel 3 reused-as-is component
- `src/lib/queries.ts:214-300` (`getPublicStrategyDetail`, `getStrategyDetail`) — base query pattern
- `src/lib/queries.ts:301-372` (`fetchStrategyLazyMetrics` + `LazyMetricsPanelId`) — Phase 12 consumer (14a does NOT invoke; 14b does)
- `src/lib/types.ts:35-117` — `Strategy` and `StrategyAnalytics` shapes; verified Panel 1 + KPI strip fields exist
- `vitest.config.ts` — current `include: ["src/**/*.test.{ts,tsx}"]` (must extend)
- `playwright.config.ts` — `testDir: "./e2e"` (UI-SPEC's `tests/e2e/` is at variance)
- `src/test-setup.ts` — current global stubs (only ResizeObserver; need to add IntersectionObserver)
- `analytics-service/services/metrics.py:316,378-379` — verified `metrics_json["drawdown_episodes"]` populated; `cumulative_return`, `cagr` written
- `supabase/migrations/087_strategy_analytics_series.sql:48` — verified H-D contract: `equity_series_1y` stays in `metrics_json`
- `DESIGN.md:126-136` — existing decisions log format (table-style)
- `.planning/REQUIREMENTS.md:27-89` — verified the 12 phase requirement IDs
- `.planning/STATE.md:50-55` — Phase 14a depends on Phase 12 (verified COMPLETE 10/10)

### Secondary (MEDIUM confidence)

- WebFetch on `https://recharts.github.io/en-US/api/XAxis/` — confirmed `tick` prop accepts an object that's "merged into the internally calculated tick props"; specific keys not enumerated but SVG `<text>` attributes (including `fontVariantNumeric` per React's camelCase convention) work
- WebSearch on font-variant-numeric in SVG / React inline styles — confirmed `fontVariantNumeric: "tabular-nums"` is a valid React inline style key, applied directly as the SVG `font-variant-numeric` presentation attribute

### Tertiary (LOW confidence)

- None. Every claim is grounded in either local code, local Next.js docs, or a verified web source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package is already in `package.json`; no version verification needed for additions because there are no additions; only `@nivo/boxplot` removal.
- Architecture: HIGH — every pattern (RSC page, error.tsx, IntersectionObserver, flag, Recharts mock, server-component-test) has a canonical project precedent.
- Pitfalls: HIGH — Pitfalls 1, 2, 4, 6, 9, 10 verified by direct codebase grep; Pitfall 3 verified by Next.js 16.2 local docs; Pitfalls 5, 7, 8 derived from documented patterns.
- Validation Architecture: HIGH — vitest.config.ts and playwright.config.ts inspected; gaps are concrete and small.
- Security Domain: HIGH — public route, no new auth/data surface beyond what v1 exposes.

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (30 days — codebase patterns are stable post-Phase-12; Next.js 16.2 is current LTS branch)
