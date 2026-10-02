# Phase 21: Surfacing, Correlation & Honest Projection - Research

**Researched:** 2026-06-21
**Domain:** Next.js 16 App Router brownfield UI extension (React 19 client components, in-house design system, Vitest + Testing Library)
**Confidence:** HIGH (all findings are direct codebase reads with file:line citations; no external library research required)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Surfacing placement & labeling (accepted as recommended):**
- Own-book Scenario tab: add a **visible "Scenario" tab to the `AllocationsTabs` tablist**; keep the `?tab=scenario` deep-link working.
- Strategy Sandbox link: **sidebar entry in the allocator nav group**, below Allocations/Discovery.
- Role gating: **allocator-only** — managers and admins see no Sandbox entry (gate on profile role, server-checked, not just hidden).
- Sandbox labeling: title **"Strategy Sandbox"** + an **"Example universe" badge** (use the DESIGN.md badge token).

**Correlation heatmap presentation (user-adjusted):**
- **Extract a shared `<CorrelationHeatmap>` presentational component now.** CORRECTION (ratified via UI-SPEC, Rule 7): the component **already exists** at `src/components/portfolio/CorrelationHeatmap.tsx` and is already consumed by `/scenarios` — so the work is a **promotion + truncation-removal**, not a from-scratch build. **Use the existing component's WCAG-audited correlation-SIGN palette (teal-diversifying / orange-concentrated), NOT `palette.ts`.** Scope it to a **presentational** component (matrix + labels + legend); keep data computation per-surface. Do not refactor the Risk-tab matrix or `/scenarios` data paths in this phase (parallel-agent collision risk).
- **>10 strategies: show ALL, scrollable — no truncation** (supersedes CORR-04). Keep the heatmap readable at large N via a scroll container.
- **"Avg |ρ|" = mean of off-diagonal absolute pairwise correlations**, computed once and reused by both the heatmap caption and the KPI strip (reconcile the KPI strip label to "Avg |ρ|").
- **Empty state: <2 active strategies OR <10 overlapping days** → honest empty state. Never a 1×1 grid, never a fabricated number. Copy names the reason (need ≥2 strategies with ≥10 overlapping days).

**Projection honesty framing (accepted as recommended):**
- Persistent **"PROJECTED — hypothetical, not your live book"** badge/banner on the projection panel header (always visible, not a tooltip).
- Coverage caveat shows **N overlapping days AND the shortest-history strategy name**.
- **Neuter-check regression test**: assert no `ingestSource:"api"` builder and no peer/allocator-percentile panel renders on a hypothetical blend; the test must FAIL if a peer panel is ever wired into the scenario projection.
- Framing applies to **both** the own-book Scenario composer **and** the `/scenarios` Strategy Sandbox projection.

### Claude's Discretion
- Exact badge component / token selection from DESIGN.md, scroll-container styling, and the precise empty-state copy are at Claude's discretion within the above constraints.

### Deferred Ideas (OUT OF SCOPE)
- Consolidating the 3 correlation surfaces' DATA paths (Risk-tab matrix / scenario / `/scenarios`) — out of scope; this phase extracts only a **presentational** heatmap component.
- Rolling / time-varying correlation (SCEN-V2-04) — v2.
- Benchmark correlation — Phase 24.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SURF-01 | Visible Scenario tab in dashboard tablist; `?tab=scenario` deep-link preserved | `AllocationsTabs.tsx` — add `"scenario"` to `VISIBLE_TAB_KEYS` (line 246) + `keyboardKeys` array (line 443). All other plumbing (`TAB_KEYS`, `TAB_LABELS`, `parseTab`, `KNOWN_TAB_RAW`, tabpanel) already exists. |
| SURF-02 | Strategy Sandbox link in sidebar (allocator group) | `Sidebar.tsx` — add a `NavItem` to `workspaceItems` (line 58-66), gated on `isAllocator`. New `BeakerIcon` via the existing inline-SVG factory pattern. |
| SURF-03 | Role-gated allocator-only; server-checked | Role source of truth: `(dashboard)/layout.tsx:45` (`isAllocator = role === 'allocator' \|\| role === 'both'`). Server gate already enforced at `scenarios/page.tsx:50-52`. Sidebar hide is defense-in-depth. |
| CORR-01 | Pairwise correlation heatmap, de-aliased labels | `CorrelationHeatmap.tsx` exists; wire `strategyNames` from `deAliased.strategies[].name`. Composer must MOUNT it (currently does not). |
| CORR-02 | Honest empty state (<2 strategies OR <10 overlapping days) | Engine already returns `correlation_matrix: null` for both degenerate cases (`scenario.ts:140-156`, `:192-208`). Heatmap empty-state gate at `:151` must be extended. |
| CORR-03 | Single-sourced "Avg \|ρ\|" (caption ↔ KPI strip agree) | Engine produces `avg_pairwise_correlation` as off-diagonal absolute mean (`scenario.ts:399-400`). KpiStrip label "Avg ρ" at `KpiStrip.tsx:416` → relabel to "Avg \|ρ\|". Pass ONE value to both. |
| CORR-04 | (SUPERSEDED by show-all) | Remove `pickTopTenByAvgCorr` (`CorrelationHeatmap.tsx:128-149`). Do NOT render a "showing top 10" disclosure. |
| IMPACT-01 | Persistent "PROJECTED" framing + coverage caveat on BOTH surfaces | Composer header `:995`; caveat slot pattern at `:1050-1061` (`scenario-leverage-caveat`). Sandbox header `ScenarioBuilder.tsx:266`. |
| IMPACT-02 | Neuter-check: no peer/percentile panel on a hypothetical blend | Existing "R3 guard" at `ScenarioComposer.test.tsx:2163-2186` is the exact model; strengthen + add to the Sandbox. `PercentileRankBadge` is the panel to assert ABSENT. |
</phase_requirements>

## Summary

This is a **pure brownfield UI extension** of an already-shipped, frozen scenario engine. Every capability the phase requires is realized in existing code; the work is surfacing it, mounting one existing component in one new place, removing one truncation function, relabeling one string, and adding two honesty surfaces plus a guard test. **Zero new packages.** The stack is Next.js 16 App Router (client components), React 19, TypeScript 5, in-house Tailwind v4 design system, Vitest 4 + Testing Library.

The single most important finding the planner must internalize: **the engine math is correct and frozen — do not touch `scenario.ts`.** It already (a) returns `correlation_matrix: null` for both empty-state triggers (<10 overlapping days at `:192`, no active strategies at `:140`), (b) computes `avg_pairwise_correlation` as the off-diagonal absolute mean (`:392-400`), and (c) de-aliases multi-venue duplicates before correlation via `scenario-dealias.ts`. The Phase 21 changes live entirely in the **presentational and wiring** layer. The CONTEXT "extract a shared component" instruction is satisfied by the fact that `CorrelationHeatmap.tsx` is ALREADY shared (consumed by `ScenarioBuilder.tsx:435` AND `portfolios/[id]/page.tsx:308`); the genuinely-new consumer is the **own-book `ScenarioComposer`, which does NOT render a heatmap today** (verified: zero `CorrelationHeatmap` import in that file).

The second critical finding: the **IMPACT-02 neuter-check already exists** as the "R3 guard" (`ScenarioComposer.test.tsx:2163-2186`). It is a proven "prove it fails when neutered" guard that asserts `factsheet-allocator`, `factsheet-signatures`, and `/percentile/i` are ABSENT while a positive control (`kpi-strip-mock`) confirms the projection rendered. Phase 21 extends this pattern (add `PercentileRankBadge` assertion; replicate for the Sandbox) rather than inventing a convention.

**Primary recommendation:** Treat `scenario.ts` and `scenario-dealias.ts` as read-only. Make all changes in `AllocationsTabs.tsx` (1 visible-tab wiring), `Sidebar.tsx` (1 nav item + 1 icon), `CorrelationHeatmap.tsx` (remove truncation, extend empty-state gate, add caption), `ScenarioComposer.tsx` (mount heatmap + PROJECTED badge + coverage caveat), `ScenarioBuilder.tsx` (PROJECTED badge + caveat), and `KpiStrip.tsx` (relabel "Avg ρ" → "Avg |ρ|"). Compute "Avg |ρ|" ONCE per surface (it already exists as `scenarioMetrics.avg_pairwise_correlation`) and pass it to both the caption and the strip.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Visible Scenario tab (SURF-01) | Frontend Server (SSR shell) → Client (tab state) | — | `AllocationsTabs` is `"use client"`; tab state derives from `useSearchParams()` each render. URL is the state. |
| Sidebar Sandbox link (SURF-02) | Client (Sidebar render) | API/Backend (role gate) | Link visibility is client; the security boundary is the server route gate at `scenarios/page.tsx`. |
| Role gating (SURF-03) | API/Backend (server route + RSC layout) | Client (sidebar hide = defense-in-depth) | `(dashboard)/layout.tsx` computes `isAllocator` server-side; `scenarios/page.tsx` re-checks before the admin-client read. Client hide is NOT the boundary. |
| Correlation compute (CORR-01/03) | Client (engine `computeScenario`) | — | Pure client-side math in `scenario.ts`, runs in the browser on every recompute. No server involvement. Frozen. |
| Correlation render + empty state (CORR-01/02) | Client (presentational `CorrelationHeatmap`) | — | Pure presentational React component. |
| De-aliased labels (CORR-01) | Client (`scenario-dealias` + `.name`) | — | Pure TS transform, runs client-side before the engine. |
| Projection honesty framing (IMPACT-01) | Client (composer + builder JSX) | — | Static informative copy in two client components. |
| Neuter-check guard (IMPACT-02) | Test layer (Vitest + Testing Library) | — | Component-render guard; not a runtime surface. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | ^16.2.3 | App Router framework | Already the project framework. [VERIFIED: package.json] |
| react | 19.2.4 | UI runtime (client components) | Already pinned. [VERIFIED: package.json] |
| react-dom | 19.2.4 | DOM renderer | Already pinned. [VERIFIED: package.json] |
| typescript | ^5 | Types | Already pinned. [VERIFIED: package.json] |

### Supporting (test + existing in-repo modules — NOT new installs)
| Module | Path | Purpose | When to Use |
|--------|------|---------|-------------|
| `computeScenario` | `@/lib/scenario` | Frozen engine: metrics + correlation_matrix + avg_pairwise_correlation | Already invoked in composer (`:589`) and builder (`:201`). Read-only. |
| `collapseAliasedHoldingStrategies` | `@/lib/scenario-dealias` | Multi-venue de-aliasing before correlation | Already invoked in composer (`:579`). Read-only. |
| `CorrelationHeatmap` | `@/components/portfolio/CorrelationHeatmap` | Presentational heatmap | Mount in composer (NEW); already in builder. |
| `KpiStrip` | `@/app/(dashboard)/allocations/components/KpiStrip` | KPI strip incl. "Avg ρ" cell | Relabel cell; single-source value. |
| Vitest | ^4.1.2 | Test runner | All unit/component tests. [VERIFIED: package.json] |
| @testing-library/react | ^16.3.2 | Component render/query | `render`, `screen.queryBy*`, `not.toBeInTheDocument()`. [VERIFIED: package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing existing `CorrelationHeatmap` palette | Importing `factsheet/v2/palette.ts` | REJECTED by UI-SPEC + CONTEXT: `palette.ts` is a return-MAGNITUDE scale (red=negative return); applying it to correlation would render diversifying (negative ρ) as alarming red — semantically inverted. Keep the correlation-SIGN palette. |
| Show-all scrollable heatmap | Top-10 truncation (current `pickTopTenByAvgCorr`) | REJECTED: user override — show all, scroll. Removing truncation is the requirement. |

**Installation:** None. Phase 21 installs zero packages.

## Package Legitimacy Audit

> This phase installs **no external packages**. All work uses existing in-repo modules and already-pinned dependencies.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | N/A — no installs |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

slopcheck was not run because no package installation occurs in this phase. If the planner discovers a net-new dependency need (it should not), gate it behind a `checkpoint:human-verify` task and run the Package Legitimacy Gate before install.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────────┐
   OWN-BOOK SCENARIO      │  (dashboard)/layout.tsx  [RSC, server]       │
   (allocator's holdings) │  reads profiles.role → isAllocator/isAdmin   │
                          │  → DashboardChrome → Sidebar (SURF-02/03)    │
                          └───────────────┬─────────────────────────────┘
                                          │ props: isAllocator
                          ┌───────────────▼─────────────────────────────┐
                          │  AllocationsTabs.tsx  ["use client"]         │
                          │  activeTab = parseTab(searchParams.tab)      │
                          │  VISIBLE_TAB_KEYS  ──(SURF-01: add scenario)─┤
                          │  ?tab=scenario  ──────────────────────────►  │
                          └───────────────┬─────────────────────────────┘
                                          │ activeTab==="scenario"
                          ┌───────────────▼─────────────────────────────┐
                          │  ScenarioComposer.tsx  ["use client"]        │
   payload.holdings ─────►│  adapter → collapseAliasedHoldingStrategies  │
   (live baseline)        │         → computeScenario (FROZEN engine)    │
                          │  scenarioMetrics{ correlation_matrix,        │
                          │     avg_pairwise_correlation, n, ... }       │
                          │  ┌─ <h2>Scenario</h2>                        │
                          │  ├─ [NEW] PROJECTED badge (IMPACT-01)        │
                          │  ├─ <KpiStrip> "Avg |ρ|" (CORR-03 relabel)   │
                          │  ├─ [NEW] coverage caveat (IMPACT-01)        │
                          │  ├─ <EquityChart> / <DrawdownChart>          │
                          │  └─ [NEW MOUNT] <CorrelationHeatmap>         │
                          │        strategyNames ← deAliased[].name      │
                          │        correlationMatrix ← scenarioMetrics   │
                          └──────────────────────────────────────────────┘

   STRATEGY SANDBOX       ┌──────────────────────────────────────────────┐
   (example universe)     │  scenarios/page.tsx  [RSC, force-dynamic]    │
                          │  ★ROLE GATE: isAllocator else redirect("/")  │ (SURF-03 boundary)
                          │  → admin client → strategy universe          │
                          └───────────────┬──────────────────────────────┘
                          ┌───────────────▼──────────────────────────────┐
                          │  ScenarioBuilder.tsx  ["use client"]         │
                          │  computeScenario (same FROZEN engine)        │
                          │  ┌─ [NEW] "Example universe" badge (SURF-02) │
                          │  ├─ [NEW] PROJECTED badge (IMPACT-01)        │
                          │  ├─ MetricCard "Avg |corr|" → relabel "|ρ|"  │
                          │  ├─ [NEW] coverage caveat (IMPACT-01)        │
                          │  └─ <CorrelationHeatmap> (ALREADY mounted)   │
                          └──────────────────────────────────────────────┘

   SHARED PRESENTATIONAL  ┌──────────────────────────────────────────────┐
                          │  CorrelationHeatmap.tsx  ["use client"]      │
                          │  [REMOVE] pickTopTenByAvgCorr (show ALL)     │ (CORR-04 superseded)
                          │  [EXTEND] empty-state gate: <2 OR <10 days   │ (CORR-02)
                          │  [ADD] "Avg |ρ|" caption (single-sourced)    │ (CORR-03)
                          │  KEEP correlation-SIGN palette (teal/orange) │
                          └──────────────────────────────────────────────┘
```

### Recommended file-touch set (NOT new structure — brownfield)
```
src/app/(dashboard)/allocations/
  AllocationsTabs.tsx                 # SURF-01: visible tab + keyboard nav
  components/
    ScenarioComposer.tsx              # IMPACT-01 badge+caveat, CORR-01 heatmap mount, CORR-03 single-source
    KpiStrip.tsx                      # CORR-03 relabel "Avg ρ" → "Avg |ρ|"
src/components/
  layout/Sidebar.tsx                  # SURF-02/03: allocator-only Sandbox link + BeakerIcon
  portfolio/CorrelationHeatmap.tsx    # CORR-01/02/04: remove truncation, extend empty state, add caption
  scenarios/ScenarioBuilder.tsx       # SURF-02 badge, IMPACT-01 badge+caveat, CORR-03 relabel
```

### Pattern 1: Visible-tab wiring (SURF-01)
**What:** `scenario` is already a full `TabKey` with label, parse-case, panel, and ARIA wiring. It is excluded from exactly TWO arrays: the visible strip and the keyboard-nav walk.
**When to use:** SURF-01 only.
**Example:**
```typescript
// Source: AllocationsTabs.tsx:246 — add "scenario" to the visible strip
const VISIBLE_TAB_KEYS: readonly TabKey[] = [
  "overview", "holdings", "outcomes", "mandate", "risk",
  // ADD: "scenario"
] as const;

// Source: AllocationsTabs.tsx:443 — keyboard nav walks VISIBLE_TAB_KEYS, so
// adding scenario above ALSO fixes arrow-nav reach (no separate change needed
// unless the Tweaks-hidden filter at :444 needs a scenario branch — it does not).
const keyboardKeys = outcomesHidden
  ? VISIBLE_TAB_KEYS.filter((k) => k !== "outcomes")
  : VISIBLE_TAB_KEYS;
```
**Note:** Active/inactive styling already uses `TAB_BUTTON_ACTIVE` / `TAB_BUTTON_INACTIVE` (`:312-315`) — `border-accent text-accent` active. The render loop (`:554`) maps over `VISIBLE_TAB_KEYS`, so the button appears automatically. `?tab=scenario` deep-link already works via `parseTab` (`:288`). The "+ Allocation" header button (`:632`) already routes to scenario via `changeTab("scenario")` — do not regress it.

### Pattern 2: Role-gated sidebar nav item (SURF-02/03)
**What:** Nav items are pushed onto `workspaceItems` inside conditional blocks keyed on role booleans.
**When to use:** SURF-02/03.
**Example:**
```typescript
// Source: Sidebar.tsx:58-66 — "My Allocation" is pushed under showsAllocatorWorkspace
// (= isAllocator || isAdmin). For the Sandbox, CONTEXT says "managers AND admins
// see no Sandbox entry" → gate on isAllocator ONLY (exclude admin-only).
const workspaceItems: NavItem[] = [];
if (showsAllocatorWorkspace) {
  workspaceItems.push({ label: "My Allocation", href: "/allocations", icon: PortfolioIcon, badge: flaggedCount });
}
// ADD — note the DISTINCT gate. showsAllocatorWorkspace is true for admins too;
// the Sandbox must use isAllocator directly per CONTEXT.
if (isAllocator) {
  workspaceItems.push({ label: "Strategy Sandbox", href: "/scenarios", icon: BeakerIcon });
}
```
**Icon factory pattern (Sidebar.tsx:247-316):**
```typescript
// All icons are 16px-viewBox inline SVG, 1.5px stroke, currentColor.
function BeakerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h4M6.5 2v4L3 12.5A1 1 0 003.9 14h8.2a1 1 0 00.9-1.5L9.5 6V2" />
    </svg>
  );
}
```
**Role source of truth:** `(dashboard)/layout.tsx:45` — `isAllocator = profile?.role === "allocator" || profile?.role === "both"`. Flows `layout → DashboardChrome (:100-106) → Sidebar`. The same boolean is re-derived server-side at `scenarios/page.tsx:50-52` (the actual security boundary).

### Pattern 3: Mounting the existing heatmap with de-aliased labels (CORR-01)
**What:** The composer already computes `scenarioMetrics` from de-aliased strategies; it just doesn't render a heatmap. Build a `strategyNames` map the same way `ScenarioBuilder` does.
**When to use:** CORR-01 (composer mount).
**Example:**
```typescript
// Source: ScenarioBuilder.tsx:206-210 — the strategyNames pattern
const strategyNames = useMemo(() => {
  const out: Record<string, string> = {};
  for (const s of deAliased.strategies) out[s.id] = s.name; // de-aliased name = CORR-01 label
  return out;
}, [deAliased.strategies]);

// Source: ScenarioBuilder.tsx:435 — the consumer call
<CorrelationHeatmap
  correlationMatrix={scenarioMetrics.correlation_matrix}
  strategyNames={strategyNames}
/>
```
`scenarioMetrics.correlation_matrix` is keyed by the SAME de-aliased ids the engine consumed (`scenario.ts:369-398`), so labels and cells align by construction.

### Pattern 4: Honesty badge + caveat slot (IMPACT-01)
**What:** The composer already renders a `text-[11px] text-text-muted` caveat line in the same region (`scenario-leverage-caveat`, `:1050-1061`). The PROJECTED badge and coverage caveat reuse this slot pattern.
**When to use:** IMPACT-01 (both surfaces).
**Example:**
```tsx
// Source: ScenarioComposer.tsx:995 (header) and :1050-1061 (caveat slot pattern)
<h2 className="text-2xl font-semibold text-text-primary">Scenario</h2>
{/* ADD — neutral-outline pill per UI-SPEC §4. NOT bg-accent, NOT warning-amber. */}
<span className="inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted">
  PROJECTED — hypothetical, not your live book
</span>
{/* ADD — coverage caveat (reuse the :1053 caveat typography). Source N + shortest-history
    name from scenarioMetrics.n + the de-aliased strategy with the latest start / fewest days. */}
<p className="mt-2 text-[11px] text-text-muted">
  Projected from {n} overlapping days. Shortest history: {shortestName}. Not a forecast.
</p>
```
`scenarioMetrics.n` is the overlapping-day count (`scenario.ts:191`). The shortest-history strategy is derivable from `deAliased.strategies` (the one whose `daily_returns` window is shortest within the active set) — compute it where the metrics are computed, do not re-invent a number.

### Pattern 5: Honest empty-state gate extension (CORR-02)
**What:** The engine ALREADY returns `correlation_matrix: null` for both empty triggers, so the heatmap's existing `correlationMatrix == null` guard (`:151`) already covers them END-TO-END for the composer/builder data path. CORR-02 asks the heatmap to additionally name the reason and never render a degenerate grid for the `<2 strategies` case (a 1-strategy matrix is non-null but 1×1).
**When to use:** CORR-02.
**Example:**
```tsx
// Source: CorrelationHeatmap.tsx:151 — current gate (only null/empty)
if (!correlationMatrix || ids.length === 0) { /* empty card */ }
// EXTEND to: ids.length < 2 → render the reason-named empty state (UI-SPEC copy).
// The <10-overlapping-days case already arrives as correlationMatrix===null from
// the engine (scenario.ts:192-208), so it hits the existing null branch — but the
// COPY must name the reason rather than "No correlation data available."
```
**Critical nuance:** The heatmap is presentational and does not know `n` (overlapping days). To name the `<10 days` reason specifically, the **host** (composer/builder) must decide which empty-state copy to show (it has `scenarioMetrics.n`), OR pass `n` / a reason enum into the heatmap. Per UI-SPEC §3, the empty state is in the heatmap; per the "presentational only" constraint, the cleanest split is: host passes an optional `reason` prop (or `overlappingDays`) so the heatmap renders the correct named copy. Planner: decide the prop shape; the engine already distinguishes the two cases by returning `n` alongside `correlation_matrix: null`.

### Anti-Patterns to Avoid
- **Touching `scenario.ts` math.** It is frozen (SCENARIO-05 pins). The correlation, avg-|ρ|, and empty-state thresholds are already correct. Any edit is a regression.
- **Importing `factsheet/v2/palette.ts` into the correlation heatmap.** Wrong semantic (return-magnitude vs correlation-sign). UI-SPEC §Color records this as a ratified divergence from the literal CONTEXT wording.
- **Adding a "showing top 10" disclosure caption.** CORR-04 is superseded by show-all; the disclosure must NOT render.
- **Letting the heatmap compute its own average ρ.** CORR-03 requires ONE value; pass `scenarioMetrics.avg_pairwise_correlation` to both the caption and the strip.
- **Gating the Sandbox link on `showsAllocatorWorkspace`** (which includes admins). CONTEXT requires `isAllocator`-only.
- **Refactoring the Risk-tab matrix or `/scenarios` DATA paths.** Out of scope; parallel-agent collision risk per PROJECT.md. Presentational promotion ONLY.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pairwise correlation math | A new correlation function | `computeScenario().correlation_matrix` (`scenario.ts:369-398`) | Frozen, sample-covariance, n-1, de-aliased, test-pinned. |
| "Avg \|ρ\|" computation | A new mean-abs reducer | `scenarioMetrics.avg_pairwise_correlation` (`scenario.ts:399-400`) | Already the off-diagonal absolute mean; CORR-03 is a relabel + single-source, not a recompute. |
| Multi-venue de-duplication | Manual symbol grouping | `collapseAliasedHoldingStrategies` (`scenario-dealias.ts`) | Already wired in composer (`:579`); prevents fabricated ρ=1.0. |
| Heatmap rendering + WCAG palette | A new color scale / grid | `CorrelationHeatmap.tsx` (existing) | WCAG-audited (CI contrast sweep at `CorrelationHeatmap.test.tsx:179-248`), colorblind-safe, ARIA-complete. |
| Tab state / deep-link | New routing state | `AllocationsTabs` `parseTab` + `searchParams` derivation | URL-as-state already handles back/forward correctly (`:328`). |
| Role gating | New auth check | `(dashboard)/layout.tsx` + `scenarios/page.tsx` gate | Server-checked boundary already exists; sidebar is defense-in-depth. |
| Neuter/ABSENT guard test | New test harness | The "R3 guard" pattern (`ScenarioComposer.test.tsx:2163-2186`) | Proven positive-control + ABSENT-assertion structure. |

**Key insight:** This phase is ~90% wiring of existing, test-pinned primitives. The only genuinely-new logic is (a) deriving the "shortest-history strategy name" for the caveat, and (b) the empty-state reason-routing decision. Everything else is moving, relabeling, or mounting code that already passes CI.

## Runtime State Inventory

> This is NOT a rename/refactor/migration phase — it is an additive UI surfacing phase. No stored data, service config, OS state, secrets, or build artifacts carry a renamed string. The one "relabel" (CORR-03: "Avg ρ" → "Avg |ρ|") is a UI display string with no persistence or wire impact.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified: no DB column, collection, or key is renamed; `avg_pairwise_correlation` field name is unchanged (only its UI LABEL changes). | none |
| Live service config | None — verified: no external service (n8n, Datadog, Tailscale, etc.) references any string this phase changes. | none |
| OS-registered state | None — verified: no Task Scheduler / pm2 / systemd registration touched. | none |
| Secrets/env vars | None — verified: no secret or env var name referenced or changed. | none |
| Build artifacts | None — verified: no package rename, no egg-info, no binary. | none |

**The relabel caveat (CORR-03):** "Avg ρ" → "Avg |ρ|" is a *display-string* change at `KpiStrip.tsx:416`. The existing tests `KpiStrip.scenario.test.tsx` and `KpiStrip.test.tsx` may assert the literal "Avg ρ" string — the planner must update those test expectations in the SAME change (a test will fail on the relabel; that is the expected, correct signal, not a regression). Verify with: `grep -rn "Avg ρ\|Avg ρ" src/.../KpiStrip*.test.tsx` before editing.

## Common Pitfalls

### Pitfall 1: Editing the frozen engine to "add" empty-state or avg-ρ behavior
**What goes wrong:** A planner reads CORR-02/03 and adds threshold or mean logic to `scenario.ts`, breaking `scenario.test.ts` SCENARIO-05 pins.
**Why it happens:** The requirement text reads like new behavior, but the engine already implements it.
**How to avoid:** Confirm `scenario.ts:192` (n<10 → null matrix) and `:399-400` (avg = off-diagonal abs mean) BEFORE planning any engine task. There should be ZERO engine tasks.
**Warning signs:** A task description mentions modifying `computeScenario`, `correlation_matrix`, or `avg_pairwise_correlation` computation.

### Pitfall 2: The composer doesn't render a heatmap today — it's a NEW mount, not an edit
**What goes wrong:** A plan assumes the own-book Scenario tab already shows a correlation heatmap and writes a "modify" task; in reality there is no `CorrelationHeatmap` import in `ScenarioComposer.tsx`.
**Why it happens:** `/scenarios` (the Sandbox) DOES render it, and the two surfaces are easy to conflate.
**How to avoid:** Verified — `grep CorrelationHeatmap ScenarioComposer.tsx` returns nothing. CORR-01 for the composer is a NET-NEW mount: import + build `strategyNames` + render in the `lg:grid-cols-2` region near `:1063` or as a new full-width row.
**Warning signs:** A task says "update the composer's existing heatmap."

### Pitfall 3: Empty-state reason for "<10 days" cannot be derived inside the presentational heatmap
**What goes wrong:** A plan asks the heatmap to print "fewer than 10 overlapping days" but the heatmap only receives `correlationMatrix` + `strategyNames` — it has no `n`.
**Why it happens:** The engine collapses the `<10 days` case to `correlation_matrix: null`, which is indistinguishable inside the heatmap from "no active strategies."
**How to avoid:** Pass `n` (or a reason discriminator) from the host into the heatmap so it picks the correct UI-SPEC copy ("<2 strategies" vs "<10 overlapping days" vs combined fallback). The host has `scenarioMetrics.n`.
**Warning signs:** Empty-state copy logic that has no access to the overlapping-day count.

### Pitfall 4: Truncation removal must also update its tests
**What goes wrong:** Removing `pickTopTenByAvgCorr` (`CorrelationHeatmap.tsx:128-149`) breaks the two truncation tests (`CorrelationHeatmap.test.tsx:100-165`) which assert "10 strategies" survives.
**Why it happens:** Those tests pin the OLD behavior.
**How to avoid:** In the same change, delete/replace those two tests with show-all assertions (e.g. a 12-strategy matrix renders all 12 labels). This is the "test verifies intent" rule — the new intent is show-all.
**Warning signs:** CI red on `CorrelationHeatmap.test.tsx` after the truncation removal.

### Pitfall 5: Admin visibility for the Sandbox link
**What goes wrong:** Reusing `showsAllocatorWorkspace` (= `isAllocator || isAdmin`) shows the Sandbox to admins, violating CONTEXT ("managers AND admins see no Sandbox entry").
**Why it happens:** "My Allocation" uses `showsAllocatorWorkspace`, the obvious copy-paste source.
**How to avoid:** Gate the Sandbox push on `isAllocator` directly. The server route at `scenarios/page.tsx:50-52` ALSO redirects admins-without-allocator-role (only `allocator`/`both` pass) — so a strict `isAllocator` sidebar gate is consistent with the server boundary.
**Warning signs:** Sandbox link visible to an admin-only test user.

## Code Examples

### KpiStrip relabel (CORR-03)
```typescript
// Source: KpiStrip.tsx:416 — current
{ label: "Avg ρ", raw: ..., metricKey: "avg_pairwise_correlation", ... }
// CHANGE label only:
{ label: "Avg |ρ|", raw: ..., metricKey: "avg_pairwise_correlation", ... }
// The VALUE already flows from metrics?.avg_pairwise_correlation (:332) — already
// the off-diagonal absolute mean. To single-source the caption + strip, pass the
// SAME scenarioMetrics.avg_pairwise_correlation to the heatmap caption host.
```

### Engine empty-state proof (CORR-02 — read-only confirmation)
```typescript
// Source: scenario.ts:192-208 — <10 overlapping days returns null matrix
const n = commonDates.length;
if (n < 10) {
  return { n, /* ... */ correlation_matrix: null, avg_pairwise_correlation: null, /* ... */ };
}
// Source: scenario.ts:140-156 — zero active strategies returns null matrix
if (activeIds.length === 0) { return { /* ... */ correlation_matrix: null, /* ... */ }; }
```

### Neuter-check model (IMPACT-02)
```typescript
// Source: ScenarioComposer.test.tsx:2163-2186 — the EXISTING R3 guard to extend
it("R3 guard — the projection renders NO peer/allocator/comparator factsheet panels", () => {
  render(<ScenarioComposer payload={payload} allocatorId={ALLOCATOR_A} allocatorMandate={null} />);
  expect(screen.getByTestId("kpi-strip-mock")).toBeInTheDocument(); // positive control
  expect(document.getElementById("factsheet-allocator")).toBeNull();
  expect(document.getElementById("factsheet-signatures")).toBeNull();
  expect(screen.queryByText(/percentile/i)).toBeNull();
  expect(screen.queryByText(/ranked against peers/i)).toBeNull();
});
// Phase 21 EXTENSION: also assert PercentileRankBadge is absent
// (src/components/strategy/PercentileRankBadge.tsx is the concrete peer panel),
// and REPLICATE the guard for the Strategy Sandbox (ScenarioBuilder).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Scenario tab routable-but-hidden (`?tab=scenario` + "+ Allocation" only) | Visible tab in the strip | Phase 21 (SURF-01) | One-line `VISIBLE_TAB_KEYS` addition. |
| Heatmap truncates to top-10 by avg \|corr\| | Show ALL, scrollable | Phase 21 (CORR-04 superseded) | Remove `pickTopTenByAvgCorr`. |
| KPI strip label "Avg ρ" | "Avg \|ρ\|" | Phase 21 (CORR-03) | Label string + dependent test expectations. |
| Composer shows no correlation surface | Composer mounts `CorrelationHeatmap` | Phase 21 (CORR-01) | New mount. |
| Projection framing implicit | Persistent PROJECTED badge + coverage caveat | Phase 21 (IMPACT-01) | Two new informative surfaces on both composer + builder. |

**Deprecated/outdated:**
- `pickTopTenByAvgCorr` (`CorrelationHeatmap.tsx:128-149`): to be REMOVED. Its two tests (`CorrelationHeatmap.test.tsx:100-165`) go with it.
- The "No correlation data available." generic empty-state copy (`CorrelationHeatmap.tsx:153`): to be REPLACED with reason-naming copy per UI-SPEC.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The composer's "shortest-history strategy" for the caveat is derivable from `deAliased.strategies` daily-return windows; no new server field needed. | IMPACT-01 (Pattern 4) | If de-aliased strategies don't carry enough history metadata client-side, the caveat name needs a different source. LOW risk — `daily_returns[]` is present on each `StrategyForBuilder` (`scenario.ts:57`), so the shortest window is computable. |
| A2 | Extending the heatmap empty-state to name the `<10 days` reason requires passing `n`/`reason` from the host (the presentational component lacks it). | CORR-02 (Pattern 5) | If the planner prefers to keep the heatmap data-blind, the host renders the empty state instead and the heatmap only handles the matrix-present case. Either split is valid; flag for the planner's prop-shape decision. |
| A3 | `KpiStrip.scenario.test.tsx` / `KpiStrip.test.tsx` assert the literal "Avg ρ" string and will need updating with the relabel. | Runtime State Inventory | If no test asserts the literal, no test update is needed (relabel is then free). Verify with grep before editing. Confirmed via memory that `KpiStrip.scenario.test.tsx` is "the Avg \|ρ\| reconciliation point." |

## Open Questions (RESOLVED)

> Both questions were resolved during planning (2026-06-21):
> - Q1 → RESOLVED in Plan 21-02 Task 2: `CorrelationHeatmap` receives an optional `overlappingDays?: number` prop so the reason-named empty state lives with the (still presentational) component.
> - Q2 → RESOLVED in Plan 21-02 Task 1: a shared pure helper `shortestHistoryName(strategies)` in `src/lib/scenario-history.ts`, consumed by both composer (21-03) and builder (21-04).

1. **Empty-state ownership: heatmap vs host?** *(RESOLVED — `overlappingDays` prop, Plan 21-02 T2)*
   - What we know: the engine returns `n` alongside `correlation_matrix: null` for the `<10 days` case; the presentational heatmap receives neither `n` nor a reason.
   - What's unclear: whether the planner passes `n`/`reason` into the heatmap (keeps the empty state IN the heatmap per UI-SPEC §3) or renders the empty state in the host.
   - Recommendation: pass an optional `overlappingDays?: number` (or `emptyReason` enum) into `CorrelationHeatmap` so the named copy lives with the component, satisfying UI-SPEC §3 while staying presentational (it receives the reason, doesn't compute it).

2. **Coverage-caveat "shortest history" derivation point.** *(RESOLVED — shared `shortestHistoryName` helper, Plan 21-02 T1)*
   - What we know: caveat needs N overlapping days (`scenarioMetrics.n`) + the shortest-history strategy NAME.
   - What's unclear: whether to compute "shortest history" in the composer, the builder, or a shared helper.
   - Recommendation: compute it adjacent to `scenarioMetrics` in each host (composer + builder) from `deAliased.strategies` / `strategies` — it's a small reduce over each strategy's `daily_returns` length or first date. A tiny shared pure helper (e.g. `shortestHistoryName(strategies)`) keeps both surfaces consistent and is unit-testable; this is the only net-new logic worth a dedicated task.

## Environment Availability

> Skipped — this phase is purely code/config changes with no external tools, services, runtimes, or databases beyond the project's existing toolchain (Node/npm/Next/Vitest already present and in active use, per the green CI baseline). Step 2.6: SKIPPED (no external dependencies identified).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 + @testing-library/react ^16.3.2 (jsdom) [VERIFIED: package.json] |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / statements 80 / functions 74 / branches 72 per CLAUDE.md) |
| Quick run command | `npx vitest run src/components/portfolio/CorrelationHeatmap.test.tsx src/app/\(dashboard\)/allocations/components/KpiStrip.scenario.test.tsx` (scoped) |
| Full suite command | `npm run test:coverage` (full + coverage gate; blocking CI gate per CLAUDE.md) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SURF-01 | Scenario tab appears in the visible tablist + arrow-nav reaches it; `?tab=scenario` still resolves | component | `npx vitest run src/app/\(dashboard\)/allocations/AllocationsTabs.scenario-composer.test.tsx` | ✅ (extend) |
| SURF-02 | Sidebar renders "Strategy Sandbox" → `/scenarios` for `isAllocator`, hidden for manager/admin-only | component | `npx vitest run src/components/layout/Sidebar.*.test.tsx` | ❌ Wave 0 (no Sidebar test yet) |
| SURF-03 | Server route redirects non-allocators (incl. admin-only) BEFORE the admin-client read | RSC unit | `npx vitest run src/app/\(dashboard\)/scenarios/page.role-gate.test.ts` | ✅ (already green; covers boundary) |
| CORR-01 | Composer mounts heatmap; cells/labels render from de-aliased names | component | `npx vitest run src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` | ✅ (extend) |
| CORR-02 | `<2` strategies OR `<10` days → reason-naming empty state, never a 1×1 grid / fabricated number | component | `npx vitest run src/components/portfolio/CorrelationHeatmap.test.tsx` | ✅ (extend gate tests) |
| CORR-03 | Strip label reads "Avg \|ρ\|"; caption value === strip value (single source) | component | `npx vitest run src/app/\(dashboard\)/allocations/components/KpiStrip.scenario.test.tsx` | ✅ (update literal + add agreement test) |
| CORR-04 | Show-all: 12-strategy matrix renders all 12 labels; NO "top 10" disclosure string | component | `npx vitest run src/components/portfolio/CorrelationHeatmap.test.tsx` | ✅ (REPLACE the two truncation tests at :100-165) |
| IMPACT-01 | PROJECTED badge + coverage caveat (N days + shortest name) render on composer AND builder | component | `npx vitest run src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx src/components/scenarios/ScenarioBuilder.*.test.tsx` | ✅ composer / ❌ Wave 0 builder |
| IMPACT-02 | NO peer/percentile/`ingestSource:"api"` panel on the hypothetical blend; positive control present; FAILS if a peer panel is wired in | component (neuter guard) | `npx vitest run src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` | ✅ (extend R3 guard :2163; replicate for builder) |

### Sampling Rate
- **Per task commit:** scoped `npx vitest run <touched-test-file>` (sub-30s).
- **Per wave merge:** `npm run test` across `src/app/(dashboard)/allocations/**`, `src/components/portfolio/**`, `src/components/scenarios/**`, `src/components/layout/**`.
- **Phase gate:** `npm run test:coverage` green (blocking CI gate) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/components/layout/Sidebar.sandbox-link.test.tsx` — covers SURF-02/03 (allocator shows link; manager-only + admin-only hide it). No Sidebar component test exists today.
- [ ] `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` (or `.test.tsx`) — covers IMPACT-01 badge+caveat AND the IMPACT-02 neuter guard for the Sandbox surface. No ScenarioBuilder test file exists today (verified: `src/components/scenarios/*.test.tsx` → no matches).
- [ ] Update (not net-new) `CorrelationHeatmap.test.tsx` — REPLACE the two truncation tests (`:100-165`) with show-all + reason-named empty-state tests.
- [ ] Update `KpiStrip.scenario.test.tsx` — change the "Avg ρ" literal expectation to "Avg |ρ|" and add a caption↔strip single-source agreement assertion.

*Framework is fully installed; no `framework install` Wave-0 step needed.*

## Security Domain

> `security_enforcement` is not present in `.planning/config.json` (absent = enabled). This phase's security surface is narrow but real: it controls visibility of an admin-RLS-bypassed data surface (`/scenarios` uses `createAdminClient()` to read the raw institutional strategy universe).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth flow changed; existing session auth unchanged. |
| V3 Session Management | no | Unchanged. |
| V4 Access Control | **yes** | Server-side role gate at `scenarios/page.tsx:50-52` (`isAllocator` else `redirect("/")`) is the boundary. Sidebar hide is defense-in-depth, NOT the control. The `page.role-gate.test.ts` proves the gate fires before the admin-client read. SURF-03 must NOT weaken this. |
| V5 Input Validation | no | No new user input. Tab value already validated by `parseTab` (silent fallback to overview). |
| V6 Cryptography | no | None. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Direct-navigation to `/scenarios` by a non-allocator (manager/admin-only) to pull RLS-bypassed `daily_returns` + codenames | Information Disclosure | Server route role gate (`scenarios/page.tsx:50-52`) — already in place + test-pinned (`page.role-gate.test.ts`). Phase 21 must keep `isAllocator`/`both` as the only passing roles. |
| False precision / no-invented-data: peer-ranking a hypothetical blend (percentile panel on a what-if) | Tampering (data-integrity / honesty) | IMPACT-02 neuter-check guard — assert `PercentileRankBadge`, `factsheet-allocator`, `factsheet-signatures`, `/percentile/i` ABSENT on the projection. The composer builds from `scenarioMetrics` + `KpiStrip`, never `FactsheetBody` (which hardcodes `ingestSource:"api"`). |
| Fabricated correlation (ρ=1.0 between venue aliases of one exposure) | Tampering (data-integrity) | Already mitigated by `collapseAliasedHoldingStrategies` (`scenario-dealias.ts`) wired into the composer (`:579`) before `computeScenario`. Heatmap inherits the honest matrix. |
| Sidebar hide mistaken for the security boundary | Elevation of Privilege (apparent) | Document explicitly: client hide ≠ control. The server gate is the boundary. SURF-03's "server-checked" requirement is satisfied by the existing route gate, not by the sidebar change. |

## Sources

### Primary (HIGH confidence) — direct codebase reads
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` — tab plumbing (VISIBLE_TAB_KEYS:246, parseTab:279, TAB_LABELS:298, button classes:312, keyboard nav:426, render:554, "+ Allocation":632, tabpanel:703).
- `src/components/portfolio/CorrelationHeatmap.tsx` — palette (PALETTE:51, correlationBg:59, pickTextColor:112), truncation (pickTopTenByAvgCorr:128-149), empty state (:151), grid render (:164-227).
- `src/components/layout/Sidebar.tsx` — buildNavSections (:19), role booleans (:34), workspaceItems (:58-72), NavItemLink (:212), icon factory (:247-316).
- `src/lib/scenario.ts` — engine; empty states (:140, :192), correlation matrix (:369-398), avg_pairwise_correlation (:399-400), StrategyForBuilder (:49-62).
- `src/lib/scenario-dealias.ts` — collapseAliasedHoldingStrategies (:60).
- `src/components/scenarios/ScenarioBuilder.tsx` — strategyNames (:206), heatmap consumer (:435), "Avg |corr|" MetricCard (:284).
- `src/app/(dashboard)/scenarios/page.tsx` — role gate (:45-52), admin-client read (:58).
- `src/app/(dashboard)/scenarios/page.role-gate.test.ts` — SURF-03 boundary test model.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — header (:995), KpiStrip mount (:1036), leverage-caveat slot (:1050), charts (:1063), scenarioMetrics (:588), deAliased (:579).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — R3 neuter guard (:2163-2186), ABSENT-assertion idioms (:602, :998, :2182).
- `src/app/(dashboard)/allocations/components/KpiStrip.tsx` — "Avg ρ" cell (:416), avgRhoValue source (:332), honest-pending copy (:157-159).
- `src/components/portfolio/CorrelationHeatmap.test.tsx` — WCAG contrast sweep (:179-248), truncation tests to remove (:100-165).
- `src/components/layout/DashboardChrome.tsx` — Sidebar render + prop flow (:100-106).
- `src/app/(dashboard)/layout.tsx` — role source of truth (isAllocator:45).
- `DESIGN.md`, `21-UI-SPEC.md`, `21-CONTEXT.md` — design tokens, component contracts, locked decisions.
- `package.json` — version pins (next ^16.2.3, react 19.2.4, vitest ^4.1.2, @testing-library/react ^16.3.2).

### Secondary (MEDIUM confidence)
- `.planning/config.json` — workflow flags (nyquist_validation: true; security_enforcement absent = enabled).
- Project memory (MEMORY.md) — "Scenario leverage + H-0133 shipped" (R4/H-0133 already in `scenario.ts`), "no new deps" for milestone v1.1.0, `KpiStrip.scenario.test.tsx` as the Avg |ρ| reconciliation point.

### Tertiary (LOW confidence)
- None — no external/web sources were needed; this is a self-contained brownfield phase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions read from `package.json`; zero new packages.
- Architecture: HIGH — every integration point read at file:line; data flow traced input→output.
- Pitfalls: HIGH — each pitfall is grounded in a specific existing-code fact (frozen engine, no composer heatmap, presentational empty-state limitation, truncation tests, admin gate).
- Validation: HIGH — test framework and existing test files confirmed; Wave-0 gaps verified by `ls`/grep (no Sidebar or ScenarioBuilder test files exist).
- Security: HIGH — the access-control boundary and its test are read directly; the no-invented-data guard already exists.

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (stable brownfield codebase; re-verify only if `scenario.ts`, `CorrelationHeatmap.tsx`, `AllocationsTabs.tsx`, or `Sidebar.tsx` change before planning — a parallel agent touching correlation-surface code-motion is the documented risk per PROJECT.md).
