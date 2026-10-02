# Phase 52: Per-Surface Application — Allocator Journey - Research

**Researched:** 2026-06-29
**Domain:** Frontend responsive/state/boundary conformance — Next 16 RSC, React 19, Tailwind v4 container queries, recharts 3, on 7 high-traffic allocator surfaces
**Confidence:** HIGH

## Summary

This is a **per-surface CONFORMANCE phase**, not a new-capability phase. Every "what library" question is already answered by the installed stack: Next 16.2.9, React 19.2.7, Tailwind v4.3.1 (container queries built into core — no plugin), recharts 3.9.0. No new packages are installed, so the legitimacy gate is N/A (table below records the verification). The entire phase is CSS/chrome/layout/route-file work applied across allocations, scenario composer, risk, factsheet, discovery, compare(+Bridge widgets), and single-strategy — while seven frozen islands stay structurally untouched and the SCENARIO-05 / BODY-02 math invariants stay green.

The four technical unknowns the planner needs resolved are all answered with HIGH confidence from authoritative in-repo sources: (1) **Container queries** — Tailwind v4 `@container` is built into core (verified: container-query machinery present in `node_modules/tailwindcss` bundle; `@tailwindcss/container-queries` plugin correctly absent), and the codebase already has a working precedent in `StrategyTable.tsx` (`className="@container"` on the `ResponsiveTable` scroll region + `@max-3xl:hidden` on collapsible columns). (2) **loading.tsx/error.tsx** — Next 16 conventions confirmed from `node_modules/next/dist/docs/`; the key Next-16-specific detail is `error.tsx` now receives `unstable_retry` (added v16.2.0) and the existing `src/app/(dashboard)/error.tsx` is already on the new signature — new error files must mirror it. (3) **Frozen-island safety** — adding a route-level `loading.tsx`/`error.tsx` does NOT RSC-ify any island (they wrap the existing page in Suspense/error boundaries without touching the client subtree); the `phase-29/30-frozen-spine-guards.test.ts` git-delta guards plus `e2e/svg-chart-parity.spec.ts` byte-goldens are the existing teeth that catch a math/byte regression. (4) **Bridge vs compare** — RESOLVED: "Bridge" is **not a route**; it is the `BridgeWidget`/`BridgeDrawer`/`BridgeOutcomeBanner` family living inside `src/app/(dashboard)/allocations/components/` (cream-family identity), backed by `/api/bridge`. `/compare` is the side-by-side comparison route. The phase touches both, but they are different surfaces.

**Primary recommendation:** Plan this as a **strangler, one surface per wave**, each independently verifiable against the existing reflow/axe/frozen-spine gates. For each surface: (a) migrate raw `text-[Npx]` → `--text-*` tiers and flip `quantalyze/no-raw-font-px` to `error` for that file glob; (b) introduce `@container` on the surface's varying-width components following the `StrategyTable` idiom (preserving `tabular-nums`); (c) raise/verify the max-width to fluid-fill ~1920 (data surfaces only); (d) fix the surface's accidental clips per the truncation audit; (e) add the missing `loading.tsx`/`error.tsx` modeled on the factsheet fidelity bar. Treat composer/factsheet as chrome-only.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Route-level loading skeleton (`loading.tsx`) | Frontend Server (RSC) | — | Server Component by default; streams Suspense fallback while the RSC page awaits server-fetch. No client JS. |
| Route-level error boundary (`error.tsx`) | Browser / Client | — | Next requires `"use client"` on error boundaries (React error boundaries are class/client constructs). |
| Container-query responsiveness (`@container`) | Browser / Client (CSS) | — | Pure CSS layout containment + container-query variants; evaluated by the browser, no JS, no server. |
| Fluid type (`--text-*` clamp) | Browser / Client (CSS) | — | `clamp()` re-evaluated by the browser on zoom (WCAG 1.4.4); tokens defined in `globals.css @theme`. |
| Ultra-wide max-width fill | Frontend Server (page wrapper) | Browser (CSS) | Page-level `max-w-[…] mx-auto` set on the RSC page shell; the fluid fill is CSS. |
| Truncation / no-clip treatment | Browser / Client (CSS + `title=`) | — | `break-words min-w-0` wrap or `title=` recovery — DOM/CSS only. |
| Honest degenerate state branches | Frontend Server (data shape) | Browser (render) | The branch DECISION is server-side (payload shape: 0/1 strategy, <10 days); the render is a neutral `EmptyStateCard`. |
| Scenario blend / factsheet math | **FROZEN ISLAND — no tier change** | — | `scenario.ts`/`compute.ts`/Worker stay exactly where they are; SCENARIO-05/BODY-02 forbid moving them. |

## Standard Stack

No new packages. The stack is already installed and version-verified below.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.2.9 | App Router, RSC, route-segment files (`loading.tsx`/`error.tsx`) | Already the app framework `[VERIFIED: node_modules/next/package.json]` |
| `react` / `react-dom` | 19.2.7 | RSC + client boundary, keys/memo/hooks | Installed `[VERIFIED: node_modules/react/package.json]` |
| `tailwindcss` | 4.3.1 | `@container` container queries (core), `--text-*` fluid tiers, `cn()` utilities | Container queries built into v4 core — no plugin `[VERIFIED: tailwindcss bundle contains cqw/cqi/container machinery; @tailwindcss/container-queries absent from package.json]` |
| `recharts` | 3.9.0 | `ResponsiveContainer`-based charts (risk, attribution, drawdown, equity) | Installed; ultra-wide fill is a `width="100%"` + aspect concern, not a version concern `[VERIFIED: node_modules/recharts/package.json]` |

### Supporting (existing in-repo primitives — reuse, do not rebuild)
| Asset | Path | Purpose | When to Use |
|-------|------|---------|-------------|
| `Skeleton` / `SkeletonText` / `SkeletonCard` | `src/components/ui/Skeleton.tsx` | Pulse placeholders (already `prefers-reduced-motion`-safe via globals.css) | Assemble every new `loading.tsx` from these — do not hand-roll `animate-pulse` divs |
| `EmptyStateCard` | `src/components/ui/EmptyStateCard.tsx` | Honest-absence card (neutral muted, no `role=alert`/red) | Degenerate states (0/1 strategy, <10 days, watchlist-unavailable) |
| `ResponsiveTable` | `src/components/ResponsiveTable.tsx` | Horizontal-scroll region; doubles as `@container` host (has `scrollRef`+`className`) | Table surfaces under the wider measure; set `className="@container"` here |
| dashboard `error.tsx` | `src/app/(dashboard)/error.tsx` | Reference shape for the new route-level error files (already on `unstable_retry`) | Model new `error.tsx` shape + copy on it |
| factsheet `loading.tsx` | `src/app/factsheet/[id]/v2/loading.tsx` | Fidelity bar for match-layout skeletons (header→KPI strip→body+rail, sr-only `role=status`) | Model new `loading.tsx` fidelity on it |
| `ErrorEnvelope` | `src/components/error/ErrorEnvelope.tsx` | Blocking-error `role="alert"` envelope | In-page blocking errors (not route-level) |
| `StrategyTable` | `src/components/strategy/StrategyTable.tsx` | The working `@container` + `@max-3xl:hidden` precedent | Copy this idiom for new container migrations |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tailwind v4 core `@container` | `@tailwindcss/container-queries` plugin | DON'T — the plugin is the v3 path; v4 has it in core. Installing it is redundant and a supply-chain surface. |
| `@container` (inline-size) | `@container-size` (size container) | Use plain `@container` (inline-size) — these surfaces respond to WIDTH only. `@container-size` opts into block-size containment which can collapse height and is not needed (see Pitfall 1). |
| Match-layout skeletons | Generic gray bars | Bias to match-layout (CONTEXT decision) — factsheet sets the bar; generic bars cause layout jump on content arrival. |

**Installation:** None. `npm install` adds nothing for this phase.

**Version verification (run 2026-06-29):**
```
next 16.2.9 · react 19.2.7 · react-dom 19.2.7 · tailwindcss 4.3.1 · recharts 3.9.0
@tailwindcss/container-queries: NOT PRESENT (correct — built into v4 core)
```
`[VERIFIED: node_modules/*/package.json on this machine]`

## Package Legitimacy Audit

> This phase installs **zero** external packages. No registry/slopcheck pass is required.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | N/A — pure CSS/route-file/chrome work on already-installed deps |

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs)
**Packages flagged as suspicious [SUS]:** none (no installs)

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **AGENTS.md:** This is Next.js 16 with breaking changes — **read `node_modules/next/dist/docs/` before writing any route/cache/RSC code.** Heed deprecation notices. (Honored in this research: loading/error conventions read from local docs.)
- **CLAUDE.md Rule 2 (Simplicity First) / Rule 3 (Surgical Changes):** Per-surface strangler, no big-bang rewrite; touch only the surface in scope each wave; do not "improve" adjacent code.
- **CLAUDE.md Test Coverage gate (blocking CI):** lines 82 / statements 80 / functions 74 / branches 72 (Vitest thresholds in `vitest.config.ts`); the `frontend-coverage` job gates branch protection. New route files (`loading.tsx`/`error.tsx`) should carry the lightweight render tests the existing ones have (e.g. `strategy/[id]/v2/error.test.tsx` precedent) so coverage does not regress.
- **CLAUDE.md DESIGN.md authority:** Read DESIGN.md before any visual decision; where 52-UI-SPEC differs from DESIGN.md, DESIGN.md wins. No new tokens, no new fonts, 2 weights (400/600), accent reserved-for list.
- **Skill routing:** N/A for research; planner/executor should be aware design-review / qa skills exist for verification.

## Architecture Patterns

### System Architecture Diagram (one in-scope surface — generalizes to all 7)

```
                          ┌─────────────────────────────────────────────┐
   Browser navigation ──► │ Route segment  /(dashboard)/allocations       │
                          │                                               │
                          │  error.tsx  ("use client")  ◄── catches ──┐  │
                          │   └─ wraps ▼                               │  │
                          │  loading.tsx (RSC, Suspense fallback)      │  │
                          │   └─ shown while ▼ awaits                   │  │
                          │  page.tsx (RSC, async)                     │  │
                          │   ├─ await supabase.auth.getUser()         │  │
                          │   ├─ await getMyAllocationDashboard(uid) ──┼──┼─► throws → error.tsx
                          │   │     returns payload (shape decides     │  │
                          │   │     degenerate branches: 0/1 strat,    │  │
                          │   │     <10 days, baseline-unknown)        │  │
                          │   └─ renders ▼  (max-w fluid-fill ~1920)   │  │
                          │  AllocationsTabs.tsx ("use client")        │  │
                          │   ├─ useSearchParams (?tab=)               │  │
                          │   ├─ next/dynamic({ssr:false}) tab panels  │  │
                          │   │    ├─ Performance: KpiStrip @container  │  │
                          │   │    │   + EquityChart (FROZEN island)   │  │
                          │   │    │   + BridgeWidget (cream family)   │  │
                          │   │    ├─ ?tab=scenario: ScenarioComposer  │  │
                          │   │    │   (FROZEN: scenario.ts math)      │  │
                          │   │    └─ ?tab=risk: RiskTabPanel          │  │
                          │   │        + CorrelationMatrix (recharts)  │  │
                          │   └─ degenerate → EmptyStateCard (neutral) ┘  │
                          └─────────────────────────────────────────────┘
```
The diagram shows where each phase deliverable attaches: route-file states wrap the page; container queries + fluid type + truncation live on the client render tree; frozen islands sit inside it untouched.

### Recommended per-surface task structure (strangler — repeat per wave)
```
Wave per surface:
  1. Type migration   → raw text-[Npx] → --text-* tiers; flip no-raw-font-px to error for the file glob
  2. Container queries → @container on varying-width components (StrategyTable idiom); preserve tabular-nums
  3. Ultra-wide       → raise/verify max-w toward fluid-fill ~1920 (data surfaces); tune chart aspect/table cols
  4. Truncation       → fix the surface's accidental clips per truncation-audit; never relocate a clip
  5. State files      → add missing loading.tsx/error.tsx modeled on factsheet bar (where the surface is a route)
  6. Verify           → reflow @320/2560, axe, frozen-spine guards, no-raw-font-px error all green for the surface
```

### Pattern 1: Tailwind v4 `@container` migration (the in-repo idiom)
**What:** Mark the containment region with `@container`; use `@max-*:` / `@min-[Npx]:` / `@sm:`…`@7xl:` variants on children. Container queries are **built into Tailwind v4 core** — no plugin.
**When to use:** Any component that renders at varying width inside a parent (KPI strips, 380px metrics-rail cards, factsheet panels, WidgetGrid tiles, table-embedded controls). NOT for genuinely viewport-level decisions (app shell, mobile nav).
**Example (verbatim idiom already shipping in `StrategyTable.tsx`):**
```tsx
// Source: src/components/strategy/StrategyTable.tsx:518,559 (Phase 50-06, in-repo)
<ResponsiveTable className="@container" scrollRef={scrollRef} label="Strategies">
  <table>
    <th className={`px-4 py-3 ${col.collapse ? "@max-3xl:hidden" : ""}`}>{col.label}</th>
    ...
    <td className="px-4 py-3 text-right font-metric tabular-nums @max-3xl:hidden">
      {/* collapsing column — its REAL value relocates into a per-row <details>,
          never a fabricated zero/em-dash (no-invented-data / STATE-02) */}
    </td>
  </table>
</ResponsiveTable>
```
**Container-query reference (Tailwind v4):** `@container` = inline-size container (width only). Named: `@container/main` + `@sm/main:`. Variants: `@3xs`(16rem)…`@7xl`(80rem), `@max-*`, `@min-[475px]:`, stack `@sm:@max-md:` for ranges. `[CITED: tailwindcss.com/docs/responsive-design]`

### Pattern 2: Route-level `loading.tsx` (match-layout skeleton, RSC)
**What:** A Server Component returning a skeleton assembled from the `Skeleton` primitives; auto-wraps the page in `<Suspense>`. Does NOT touch the client subtree → frozen islands stay frozen.
**When to use:** Allocations, compare, single-strategy (the routes missing one).
**Example (the in-repo fidelity bar — model new ones on it):**
```tsx
// Source: src/app/factsheet/[id]/v2/loading.tsx (in-repo — the bar to match)
export default function FactsheetV2Loading() {
  return (
    <article className="mx-auto max-w-[1440px] px-4 ... animate-pulse">
      <header>…header skeleton…</header>
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-9 …">…9 KPI cells…</section>
      <div className="grid lg:grid-cols-[1fr_380px] …">…chart placeholders + right rail…</div>
      <p className="sr-only" role="status" aria-live="polite">
        Loading factsheet — computing analytics.
      </p>
    </article>
  );
}
```
**Note on `animate-pulse` placement:** The factsheet bar puts `animate-pulse` on the **outer RSC shell `<article>`** (a single shared pulse for the whole skeleton) — this is the **accepted wrapper pattern** for an RSC `loading.tsx` shell and is NOT a hand-rolled primitive. The "do NOT hand-roll `animate-pulse` divs" anti-pattern (below) targets bespoke per-element pulse placeholders that should be `Skeleton`/`SkeletonCard` primitives instead; a single `animate-pulse` on the route-shell wrapper that contains `Skeleton` primitives is the sanctioned idiom (matches this factsheet `<article className="… animate-pulse">` analog). Per 52-UI-SPEC, each new skeleton emphasizes ONE dominant anchor: allocations → full-width KPI strip first; compare → multi-column comparison table; single-strategy → page-title + headline-metric block at the narrow measure.

### Pattern 3: Route-level `error.tsx` (Next 16 — `unstable_retry`)
**What:** `"use client"` error boundary. **Next 16 detail:** the prop is `unstable_retry` (added v16.2.0), NOT `reset`. The existing dashboard `error.tsx` is already on it — mirror its shape and copy.
**Example (the in-repo shape — copy it):**
```tsx
// Source: src/app/(dashboard)/error.tsx (in-repo, already on the v16.2.0 signature)
"use client";
import { useEffect } from "react";
export default function Error({
  error, unstable_retry,
}: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => { console.error("[surface-error]", error); }, [error]);
  return (
    <div>…"Something went wrong" + body + {error.digest && `Error ID: {digest}`}…
      <Button onClick={() => unstable_retry()}>Try again</Button>
    </div>
  );
}
```
`[CITED: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md — Version History: v16.2.0 unstable_retry added]`

### Pattern 4: No-clip treatment (TYPE-02)
**What:** Two standardized treatments. (a) Entity names in cards/lists/headings → **wrap** `break-words min-w-0` (the `ScopedBanner.tsx` reference). (b) Dense table name cells where wrapping breaks `tabular-nums` row alignment → **single-line + `title={fullText}`** (+`aria-label` where AT needs it).
**Example:**
```tsx
// (a) wrap — ScopedBanner.tsx:30 reference pattern
<span className="break-words min-w-0">{strategy.name}</span>
// (b) table-aligned single-line with recovery
<td className="truncate" title={strategy.name}>{strategy.name}</td>
```

### Anti-Patterns to Avoid
- **`@container-size` for width-only layout:** opts into block-size containment → can collapse a panel's height to 0. Use plain `@container` (inline-size).
- **Relocating a clip:** introducing a NEW `truncate`/`line-clamp` without a `title`/tooltip when re-typing onto fluid tiers. This is the exact regression the truncation audit exists to prevent.
- **RSC-ifying a frozen island:** moving `scenario.ts`/`compute.ts`/Worker/`EquityChart` logic to the server, or removing a `"use client"` that an island depends on. Tripped by frozen-spine guards + svg-chart-parity goldens.
- **Snapping `--space-grid-gap` (10px) to 12px:** shifts the 4-col widget grid 6px cumulative, regresses the 980/640 breakpoints (DESIGN.md). Leave at 10px.
- **Hand-rolling bespoke per-element `animate-pulse` divs** where a `Skeleton`/`SkeletonCard` primitive fits. (A single `animate-pulse` on the RSC `loading.tsx` shell wrapper that contains `Skeleton` primitives is the sanctioned pattern — see Pattern 2 note — not a violation.)
- **`title=` on a control that already has accessible text:** double-announces; use `title` only as the recovery affordance for clipped content.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Skeleton placeholders | Custom bespoke per-element `animate-pulse` divs per surface | `Skeleton`/`SkeletonText`/`SkeletonCard` (`src/components/ui/Skeleton.tsx`) — assembled inside the route-shell wrapper (a single `animate-pulse` on that shell is fine) | Already reduced-motion-safe, consistent radius/bg; hand-rolled per-element pulse drifts |
| Error boundary | Custom React error boundary class | Next route `error.tsx` with `unstable_retry` | Framework wires the boundary + digest + retry; a custom one misses streaming/digest |
| Loading fallback wiring | Manual `<Suspense>` around the page | Route `loading.tsx` | Next auto-wraps page+children in Suspense; manual wrapping is redundant & error-prone |
| Container responsiveness | JS width measurement / `ResizeObserver` hooks | CSS `@container` (Tailwind v4 core) | Pure CSS, no JS, no hydration cost, no `useBreakpoint`-style island; the codebase precedent is CSS |
| Honest empty state | Bespoke "no data" markup per surface | `EmptyStateCard` (neutral, no `role=alert`) | One source of the pinned no-alert/no-red tokens; prevents empty≠error drift |
| Horizontal-scroll table region | Custom overflow wrapper | `ResponsiveTable` (also the `@container` host) | Already carries the scroll affordance aria-label + `scrollRef` cue |

**Key insight:** Every "primitive" this phase needs already exists from Phases 49/50. The phase's value is *applying* them per-surface with discipline (no relocation, no island RSC-ification, no token drift), not building anything new.

## Runtime State Inventory

This is a CSS/chrome/route-file phase with **no data migration, no stored-state rename, no service/OS/secret changes**. Each category verified:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB keys, collection names, or user_ids are touched; degenerate-state branches read existing payload shapes unchanged | none |
| Live service config | None — no n8n/Datadog/Tailscale/Cloudflare config references these surfaces; `/api/bridge` endpoint is unchanged (Bridge is chrome-only here) | none |
| OS-registered state | None — no Task Scheduler/pm2/systemd/launchd registration involves UI surfaces | none |
| Secrets/env vars | None — no secret keys or env var names referenced; route files read no new env | none |
| Build artifacts | None — no package rename; new `loading.tsx`/`error.tsx` are net-new source files, not regenerated artifacts. The one ratchet artifact is the **eslint cache** (`node_modules/.cache/.eslintcache`) which is auto-managed by `npm run lint` | none (cache self-heals) |

**Nothing found in any category — verified by grep across the in-scope file inventory and the integration points listed in CONTEXT.md `<code_context>`.** The only "state" that changes is the `quantalyze/no-raw-font-px` lint level per file glob in `eslint.config.mjs` (config edit, not runtime state).

## Common Pitfalls

### Pitfall 1: `@container-size` collapsing panel height
**What goes wrong:** Using `@container-size` (size container) instead of `@container` (inline-size) applies `container-type: size`, which establishes block-size containment — a panel with no explicit height collapses to 0 because its content height is removed from layout.
**Why it happens:** Confusing the two; copying a snippet that uses `cqh`/`cqb` block units.
**How to avoid:** Use plain `@container` everywhere on these surfaces — they respond to WIDTH only. Only reach for `@container-size` if a deliberate block-size unit is required (none in scope).
**Warning signs:** A panel/card renders at zero height or charts disappear after adding the container class.

### Pitfall 2: `tabular-nums` misalignment after container migration
**What goes wrong:** Columns of numbers drift out of vertical alignment when the container variant changes font tier or column visibility.
**Why it happens:** Fluid `--text-*` tiers change glyph width unless `tabular-nums` is on; a collapsed column (`@max-3xl:hidden`) that wasn't the trailing one leaves a ragged edge.
**How to avoid:** Keep every columnar number on **Geist Mono `tabular-nums`** (UI-SPEC hard rule); collapse columns from the right priority order (the `StrategyTable` `collapse: true` pattern), and relocate the real value into a `<details>` row — never a fabricated em-dash.
**Warning signs:** Right-aligned numeric columns look jagged at a container breakpoint; an axe/visual diff flags shifted cells.

### Pitfall 3: Silently RSC-ifying a frozen island via a "boundary cleanup"
**What goes wrong:** A keys/memo/hook-hygiene refactor (allowed by BP-01) accidentally removes a `"use client"` or hoists island logic to the server; SCENARIO-05/BODY-02 math changes byte output.
**Why it happens:** The islands are deep in the client tree; a "tidy the boundary" edit looks orthogonal (CLAUDE.md Rule 8 trap).
**How to avoid:** Treat the seven listed islands as read-only-structure. Run `src/__tests__/phase-29-frozen-spine-guards.test.ts` (git-delta: `scenario.ts` zero-diff) and `e2e/svg-chart-parity.spec.ts` (byte goldens) as the gate every wave. Note: the phase-29/30 guards key on a phase **baseline merge-base** — a per-phase guard for 52 ships in Wave 0 (plan 52-01) with its own baseline sha (see Open Questions Q2 — RESOLVED).
**Warning signs:** `scenario.test.ts`/factsheet parity test red; a desktop svg-golden diff (means the no-recompute boundary was crossed — investigate, never `--update-snapshots`).

### Pitfall 4: Ultra-wide fill making charts/tables read "stretched"
**What goes wrong:** Raising `max-w-[1280px]` to fluid-fill ~1920 stretches a recharts `ResponsiveContainer width="100%"` chart or a 2-column table into a marooned strip of whitespace.
**Why it happens:** `ResponsiveContainer` fills 100% of the new wider parent with the same fixed aspect/height; tables don't add columns just because there's room.
**How to avoid:** Tune chart aspect ratio + axis legibility at the wider measure (recharts `ResponsiveContainer` keeps `width="100%"`; cap or set an explicit max chart width / aspect so the curve doesn't flatten); for tables, let the wider canvas surface MORE columns (un-collapse `@container` columns at `@min-*`) rather than spreading 2 columns across 1920px. "Data density > card density" (DESIGN.md) governs the fill.
**Warning signs:** A 2-column table centered in a sea of white; an equity curve so wide it reads flat.

### Pitfall 5: `loading.tsx` not showing because data is fetched in the layout
**What goes wrong:** A `loading.tsx` never renders its fallback.
**Why it happens:** Next 16: if a **layout** (not the page) accesses uncached/runtime data (`cookies()`, `headers()`, uncached fetch), navigation blocks until the layout finishes and `loading.tsx` shows nothing.
**How to avoid:** Keep server-fetch in `page.tsx` (the allocations/compare/strategy pages already do — `getMyAllocationDashboard`/`getPublicStrategyDetail` are in the page, not the layout). Don't move auth/data fetch up into a layout.
**Warning signs:** Skeleton never appears on slow nav despite a `loading.tsx` existing.
`[CITED: node_modules/next/dist/docs/.../loading.md — "Good to know" layout-data caveat]`

## Code Examples

### Add the missing route files without touching the island (allocations)
```tsx
// src/app/(dashboard)/allocations/loading.tsx  — NEW, RSC, no "use client"
// Models factsheet/[id]/v2/loading.tsx; KPI strip is the dominant anchor.
// animate-pulse lives on the RSC shell wrapper (the sanctioned route-shell pattern,
// matching factsheet's <article className="… animate-pulse">); the Skeleton
// primitives carry the consistent radius/bg.
import { Skeleton } from "@/components/ui/Skeleton";
export default function AllocationsLoading() {
  return (
    <div className="mx-auto max-w-[1920px] px-6 py-6 animate-pulse">
      {/* dominant anchor: full-width 4-cell KPI strip first + largest */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="mt-6 h-[320px] w-full" /> {/* equity chart placeholder */}
      {/* …holdings rows secondary… */}
      <p className="sr-only" role="status" aria-live="polite">
        Loading allocations — computing analytics.
      </p>
    </div>
  );
}
```

### Ratchet the lint to error for a migrated surface (eslint.config.mjs)
```js
// After a surface's raw text-[Npx] → --text-* migration, add a per-glob override
// flipping no-raw-font-px to "error" so a regression red-CIs that surface.
{
  files: ["src/app/(dashboard)/allocations/**"], // the migrated surface
  rules: { "quantalyze/no-raw-font-px": "error" },
},
```
`[CITED: eslint.config.mjs — the existing src/lib/design-tokens/** override is the precedent; comment says "52/53 strangler ratchets the remaining dirty surfaces to error one at a time"]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@tailwindcss/container-queries` plugin (v3) | `@container` built into Tailwind core | Tailwind v4 | No plugin install; `@container`/`@max-*`/`@min-[Npx]` available out of the box `[VERIFIED: v4.3.1 bundle]` |
| `error.tsx` `reset()` prop | `error.tsx` `unstable_retry()` (re-fetches + re-renders) | Next 16.2.0 | New error files use `unstable_retry`; `reset` only for clear-without-refetch. Existing dashboard `error.tsx` already migrated. `[CITED: next docs error.md Version History]` |
| Viewport breakpoints (`md:`/`lg:`) for component layout | CSS container queries (`@container`) | this phase (TYPE-04) | Components respond to their own width, not the viewport — fixes the "mislead" cases (a card in a 380px rail that thinks it's at desktop width) |
| Fixed `max-w-[1280/1440]` | Fluid-fill → ~1920 then center (data surfaces) | this phase (APPLY-01) | Institutional density on ultra-wide; prose pages stay narrow |

**Deprecated/outdated:**
- The `@tailwindcss/container-queries` plugin — do not install; v4 core supersedes it.
- `error.tsx` `reset` as the primary recovery — superseded by `unstable_retry` in Next 16.2.0 (reset retained only for the clear-without-refetch case).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recharts `ResponsiveContainer width="100%"` charts will read "stretched" at ~1920 without aspect tuning, and capping aspect/max-width fixes it | Pitfall 4 | LOW — the fix (aspect/max-width tune) is reversible per-surface; visual verification at 1920 confirms before/after |
| A2 | No new per-phase frozen-spine guard is strictly required because svg-chart-parity goldens + scenario.test.ts already gate the math; a phase-52 git-delta guard is belt-and-suspenders — RESOLVED to ship it in Wave 0 | Pitfall 3 / Open Q2 | LOW — the 52-scoped git-delta guard ships in 52-01 (Wave 0); copies the phase-30 guard, its own baseline sha |

**The Standard Stack, container-query syntax, route-file conventions, bridge-vs-compare resolution, truncation sites, and gate inventory are all VERIFIED or CITED — not assumed.**

## Open Questions (RESOLVED)

1. **Exact fluid-fill mechanism for ~1920 cap.**
   - What we know: data surfaces go from `max-w-[1280/1440]` to fluid-fill ~1920 then center; `max-w-[1920px] mx-auto` is the obvious implementation.
   - What's unclear: whether a hard `max-w-[1920px]` or a `clamp()`-based gutter (e.g. `w-[min(100%-2rem,1920px)]`) reads better beyond 1920; whether the metrics rail stays a fixed 380px or scales.
   - Recommendation: Use `max-w-[1920px] mx-auto px-*` (matches the existing `mx-auto max-w-[…]` idiom across pages); keep the 380px rail fixed (UI-SPEC calls it "fixed-width ~380px rail"). Decide per-surface in planning; verify at 2560.
   - **RESOLVED:** Data surfaces use a hard `max-w-[1920px] mx-auto` page-shell (the `mx-auto max-w-[…]` idiom — see the 52-02/03/04 page-shell wraps); **the 380px metrics rail stays a fixed `380px` per UI-SPEC and does NOT scale.** No `clamp()` gutter — the hard cap + centered gutters beyond 1920 is the chosen mechanism, verified at 2560px by the Wave-0 ultra-wide reflow row.

2. **Does Phase 52 need its own git-delta frozen-spine guard?**
   - What we know: `phase-29/30-frozen-spine-guards.test.ts` are git-delta guards keyed to a phase **baseline merge-base** (with a `FALLBACK_BASE_SHA`); `e2e/svg-chart-parity.spec.ts` byte-goldens + `scenario.test.ts` already catch math/byte drift independent of phase.
   - What's unclear: whether the planner wants a 52-scoped git-delta guard asserting the seven islands are zero-diff (stronger, catches a structural edit even if it happens to not change golden output).
   - Recommendation: Add a cheap 52-scoped guard (copy the phase-30 guard, assert zero-diff on the seven island files, set its own baseline sha). Flag as a Wave-0 task. It's the documented invariant-protection pattern this milestone uses.
   - **RESOLVED:** Yes — the **52-scoped 8-island git-delta frozen-spine guard ships in Wave 0 (plan 52-01)** as `src/__tests__/phase-52-frozen-spine-guards.test.ts` (a copy of the phase-30 guard with its own 52 baseline sha, asserting zero-diff on all 8 frozen islands). Every Wave-2 surface plan runs it in a task `<verify>`, and 52-06 Task 3 runs it alongside the phase-29/30 gates + `scenario.test.ts` + svg-goldens.

3. **Compare vs Bridge — confirmed but worth a one-line plan note.**
   - What we know: RESOLVED — Bridge = the `BridgeWidget`/`BridgeDrawer`/`BridgeOutcomeBanner` family in `allocations/components/` (cream identity, `/api/bridge`), NOT a route. `/compare` is the comparison route.
   - Recommendation: Plan treats `/compare` as the route surface (gets `loading.tsx`/`error.tsx`); the Bridge widgets are chrome-only conformance within the allocations surface wave (cream family preserved, do not bleed onto compare/discovery).

## Environment Availability

> Skipped — no external tools/services/runtimes beyond the already-installed npm stack. This is CSS/route-file/chrome work. All deps verified present in `node_modules` (see Standard Stack version verification). No CLI tools, databases, or services are introduced.

## Validation Architecture

> `workflow.nyquist_validation: true` — section included. Visual/responsive/state correctness across 7 surfaces is exactly the multi-boundary case Nyquist sampling targets.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3 (unit/component, jsdom) + Playwright (e2e, `playwright.config.ts`) |
| Config file | `vitest.config.ts` (with coverage thresholds), `playwright.config.ts` |
| Quick run command | `npx vitest run <path>` (per-file) · `npm run lint` (per-surface no-raw-font-px error) |
| Full suite command | `npm run test` (vitest) · `npm run test:e2e` (playwright) · `npm run test:coverage` (gated CI) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| APPLY-01 | data surfaces fluid-fill → ~1920, no overlap | e2e visual/reflow @2560 | `npx playwright test e2e/reflow-sweep.spec.ts` | ⚠️ exists @320 only; **Wave 0**: add 2560 row |
| TYPE-02 | accidental clips fixed, recovery present; no clip relocated | unit + manual review vs audit | `npx vitest run` + truncation-audit diff | ❌ **Wave 0**: per-surface no-clip assertion (cheap) |
| TYPE-03 | no horizontal scroll 320→2560 | e2e reflow | `npx playwright test e2e/reflow-sweep.spec.ts e2e/reflow-sweep-authed.spec.ts` | ✅ helper `e2e/helpers/reflow.ts`; **Wave 0**: add 2560 viewport |
| TYPE-04 | `@container` responsiveness; `tabular-nums` preserved | unit/component | `npx vitest run <surface>.test.tsx` | ⚠️ `StrategyTable` has tests; **Wave 0**: per-new-container test |
| STATE-01 | route `loading.tsx`/`error.tsx` present & render | component | `npx vitest run src/app/.../{loading,error}.test.tsx` | ⚠️ factsheet/strategy-v2 precedent; **Wave 0**: tests for new files |
| STATE-02 | honest degenerate states (no invented data) | component | `npx vitest run` (existing degenerate tests extended) | ✅ `FactsheetBody.degenerate.test.tsx`, `EmptyState.test.tsx`, KpiStrip warmup |
| BP-01 | RSC/client boundary correct; no island RSC-ified; recompute/Worker/chart work | guard + e2e | `npx vitest run src/__tests__/phase-29-frozen-spine-guards.test.ts` + `npx playwright test e2e/svg-chart-parity.spec.ts e2e/composer-axe.spec.ts` | ✅ frozen-spine guards + svg-goldens; **Wave 0**: 52-scoped guard (Open Q2) |

### Sampling Rate
- **Per task commit:** `npm run lint` (catches raw-font-px regression on the migrated glob) + `npx vitest run <touched file>.test.tsx`
- **Per wave (surface) merge:** `npx vitest run` (full unit) + the surface's `npx playwright test e2e/reflow-sweep*.spec.ts e2e/<surface>-axe.spec.ts` + frozen-spine guard
- **Phase gate:** full `npm run test` + `npm run test:e2e` (reflow + all axe specs + svg-chart-parity goldens) + `npm run test:coverage` green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Extend `e2e/reflow-sweep.spec.ts` (or a new `e2e/reflow-sweep-ultrawide.spec.ts`) with a **2560px** viewport row — current sweep is 320px only; APPLY-01/TYPE-03 ultra-wide is unverified. (App-wide 2560 axe/reflow row formally lands Phase 54, but a cheap in-scope 2560 reflow assertion is worth adding now.)
- [ ] Per-new-`loading.tsx`/`error.tsx` render test (model `strategy/[id]/v2/error.test.tsx`) — coverage gate + STATE-01 proof.
- [ ] Per-new-`@container` component test asserting `tabular-nums` columns stay aligned across the container breakpoint (model `StrategyTable` tests).
- [ ] **52-scoped frozen-spine guard** asserting the seven island files are zero-diff vs the phase baseline (copy `phase-30-frozen-spine-guards.test.ts`, set a 52 baseline sha) — BP-01 belt-and-suspenders (Open Q2).
- [ ] Per-surface no-clip assertion that the audit's accidental-clip sites for that surface now carry a `title=`/wrap (cheap; the app-wide no-clip CI guard is Phase 54, but a scoped check is cheap now).
- [ ] Framework install: none — Vitest + Playwright already configured.

*(No new test framework needed — Vitest + Playwright already cover all requirement boundaries; gaps are net-new assertions on existing infra.)*

## Security Domain

> `security_enforcement` not set to `false` in config → included. This is a presentation-layer phase; the security surface is narrow but two ASVS categories genuinely apply.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Auth unchanged; pages already `redirect("/login")` on no-user (allocations/compare). No auth logic touched. |
| V3 Session Management | no | No session/cookie changes. |
| V4 Access Control | yes (preserve) | Surfaces are auth-gated (`supabase.auth.getUser()` → redirect) and published-gated (`withPublishedOnly`); the conformance work MUST NOT remove a redirect/visibility gate while restyling. RLS/SECDEF unchanged. |
| V5 Input Validation | no (minimal) | No new inputs; `?tab=`/`?ids=` parsing is existing (compare slices to 4 ids). |
| V6 Cryptography | no | None. |
| V7 Error Handling / Info Leakage | yes | `error.tsx` must not leak server error details — Next forwards a generic message + `digest` from Server Components by design; surface only `Error ID: {digest}`, never `error.message` for RSC errors. `[CITED: next error.md — RSC errors show generic message]` |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Server error message leaked in `error.tsx` | Information Disclosure | Show `digest` only; Next already strips RSC error messages in production. Mirror the existing dashboard `error.tsx`. |
| `title={fullText}` exposing data the surface visibility gate hides | Information Disclosure | Apply `title=` only to data already rendered (the clipped string); never pull un-gated fields into a `title`. |
| Removing an auth/published gate during a restyle | Elevation of Privilege | Keep `redirect("/login")` + `withPublishedOnly` exactly; the access-control gates are not part of the visual layer. |

No new attack surface is introduced (no new endpoints, inputs, secrets, or data flows). The v1.3 WCAG-AA floor is a hard constraint but is an accessibility, not security, gate (tracked under the axe specs).

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md` — loading.tsx conventions, layout-data caveat, status codes
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` — error.tsx `unstable_retry` (v16.2.0), RSC error-message stripping, global-error
- In-repo verified code: `src/components/strategy/StrategyTable.tsx` (working `@container` idiom), `src/app/factsheet/[id]/v2/loading.tsx` (skeleton bar), `src/app/(dashboard)/error.tsx` (error shape), `src/components/ui/Skeleton.tsx`, `src/components/ui/EmptyStateCard.tsx`, `src/components/ResponsiveTable.tsx`, `eslint.config.mjs` (no-raw-font-px ratchet), `src/__tests__/phase-29/30-frozen-spine-guards.test.ts`, `e2e/svg-chart-parity.spec.ts`, `e2e/helpers/reflow.ts`, `e2e/reflow-sweep.spec.ts`
- `.planning/audits/truncation-audit.md` — TYPE-02 classification SoT (48 clip sites, 32 accidental)
- `node_modules/*/package.json` — version verification (next 16.2.9, react 19.2.7, tailwindcss 4.3.1, recharts 3.9.0)
- `52-CONTEXT.md` + `52-UI-SPEC.md` — locked decisions + design contract

### Secondary (MEDIUM confidence)
- `tailwindcss.com/docs/responsive-design` (WebFetch) — Tailwind v4 container-query syntax (`@container`, named, `@max-*`/`@min-[Npx]`, built-in-to-core, inline-size vs size caveat) — cross-verified against the v4.3.1 bundle which contains the cq machinery

### Tertiary (LOW confidence)
- none — all claims verified or cited

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified on-machine; no new packages; container queries confirmed in v4 core bundle
- Architecture: HIGH — Next 16 conventions from local docs; every pattern has a working in-repo precedent
- Pitfalls: HIGH — drawn from in-repo gate tests + Tailwind/Next docs caveats, not speculation
- Bridge/compare scope: HIGH — resolved by file inspection (Bridge = widgets in allocations/components, not a route)

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (stable — pinned local deps; re-verify if Next/Tailwind/recharts are bumped)
</content>
</invoke>
