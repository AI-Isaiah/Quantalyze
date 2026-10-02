# Phase 21: Surfacing, Correlation & Honest Projection - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the already-built scenario draft engine **reachable, honestly correlated, and
unambiguously hypothetical**. Three slices:

1. **Surfacing (SURF-01..03)** — the own-book Scenario tab is reachable from the
   visible dashboard tablist (not only `?tab=scenario`), and the example-universe
   Strategy Sandbox is reachable from the sidebar for allocators only.
2. **Correlation (CORR-01..04)** — a pairwise correlation heatmap of the scenario's
   strategies, de-aliased labels, honest empty states, single-sourced "Avg |ρ|".
3. **Projection honesty (IMPACT-01..02)** — persistent "PROJECTED — hypothetical"
   framing with coverage caveats, and a hard lock against peer-ranking a what-if blend.

Builds on the shipped engine (`scenario.ts`, `ScenarioComposer`, `useScenarioState`).
No persistence, sharing, stress, monte-carlo, optimizer, or benchmark here (Phases 23-28).

</domain>

<decisions>
## Implementation Decisions

### Surfacing placement & labeling (accepted as recommended)
- Own-book Scenario tab: add a **visible "Scenario" tab to the `AllocationsTabs` tablist**; keep the `?tab=scenario` deep-link working.
- Strategy Sandbox link: **sidebar entry in the allocator nav group**, below Allocations/Discovery.
- Role gating: **allocator-only** — managers and admins see no Sandbox entry (gate on profile role, server-checked, not just hidden).
- Sandbox labeling: title **"Strategy Sandbox"** + an **"Example universe" badge** (use the DESIGN.md badge token), so it is never confused with the own-book Scenario tab.

### Correlation heatmap presentation (user-adjusted)
- **Heatmap implementation: extract a shared `<CorrelationHeatmap>` presentational component now** (user override of the default "scenario-local only"). **CORRECTION (ratified via UI-SPEC, Rule 7):** the component **already exists** at `src/components/portfolio/CorrelationHeatmap.tsx` and is already consumed by `/scenarios` — so the work is a **promotion + truncation-removal**, not a from-scratch build. **Use the existing component's WCAG-audited correlation-SIGN palette (teal-diversifying / orange-concentrated), NOT `palette.ts`** — `palette.ts` is a return-MAGNITUDE scale and would render diversifying (negative) ρ as alarming red, which is semantically wrong. Scope it to a **presentational** component (matrix + labels + legend) reused by the scenario surface; keep data computation per-surface. ⚠️ Mind the parallel-agent collision risk PROJECT.md flags for correlation-surface code-motion — do not also refactor the Risk-tab matrix or `/scenarios` data paths in this phase; presentational promotion only.
- **>10 strategies: show ALL, scrollable — no truncation** (user override of the default top-10). ⚠️ **This supersedes CORR-04** ("discloses it shows the 10 most-correlated"). Planner: re-frame CORR-04 — with show-all there is no truncation to disclose, so the "10 most-correlated" disclosure is moot; ensure the heatmap stays readable at large N via a scroll container (and keep cell labels legible). Document this requirement reconciliation in the plan.
- **"Avg |ρ|" = mean of off-diagonal absolute pairwise correlations**, computed once and reused by both the heatmap caption and the KPI strip (single source — reconcile the KPI strip's label to "Avg |ρ|").
- **Empty state: <2 active strategies OR <10 overlapping days** → honest empty state. Never a 1×1 grid, never a fabricated number. Copy should name the reason (need ≥2 strategies with ≥10 overlapping days).

### Projection honesty framing (accepted as recommended)
- Persistent **"PROJECTED — hypothetical, not your live book"** badge/banner on the projection panel header (always visible, not a tooltip).
- Coverage caveat shows **N overlapping days AND the shortest-history strategy name**.
- **Neuter-check regression test**: assert no `ingestSource:"api"` builder and no peer/allocator-percentile panel renders on a hypothetical blend; the test must FAIL if a peer panel is ever wired into the scenario projection.
- Framing applies to **both** the own-book Scenario composer **and** the `/scenarios` Strategy Sandbox projection.

### Claude's Discretion
- Exact badge component / token selection from DESIGN.md, scroll-container styling, and the precise empty-state copy are at Claude's discretion within the above constraints.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` — the dashboard tablist; SURF-01 adds the visible Scenario tab here.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` + `hooks/useScenarioState.ts` + `lib/scenario-state.ts` — the live composer/draft state (rehydratable; localStorage-backed).
- `src/lib/scenario.ts` (+ `scenario.test.ts` SCENARIO-05 regression pins) — the frozen client-side engine; 252-day annualization convention honored.
- `src/lib/scenario-dealias.ts` (+ test) — de-aliased strategy names for CORR-01 labeling.
- `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` + `palette.ts` — existing WCAG-audited heatmap palette + render pattern to source the shared `<CorrelationHeatmap>` from.
- `src/app/(dashboard)/scenarios/` + `src/components/scenarios/ScenarioBuilder.tsx` — the example-universe Strategy Sandbox surface (SURF-02/03).
- `KpiStrip` (`components/KpiStrip.scenario.test.tsx`) — the "Avg |ρ|" reconciliation point (CORR-03).

### Established Patterns
- Next.js 16 App Router (read `node_modules/next/dist/docs/` before route/cache code), React client components, TypeScript.
- No-invented-data invariant: degenerate inputs render honest empty states (already enforced in the scenario engine; extend to correlation).
- Role gating via profile role (allocator/strategy-manager/admin); server-checked.
- DESIGN.md governs all visual decisions (palette, typography, spacing, badge tokens).

### Integration Points
- Dashboard tablist (`AllocationsTabs`) for the Scenario tab.
- Sidebar nav (allocator group) for the Strategy Sandbox link.
- ScenarioComposer projection area + `/scenarios` Sandbox for the honesty framing.

</code_context>

<specifics>
## Specific Ideas

- Use the existing `CorrelationHeatmap.tsx` correlation-sign palette (do not invent a new color scale, and do NOT swap in `palette.ts` — see the corrected heatmap decision above).
- Reconcile the KPI strip correlation label to "Avg |ρ|" so there is exactly one correlation number with one definition across the scenario surface.
- The neuter-check test is the durable lock for IMPACT-02 — model it on the project's existing "prove it fails when neutered" guard convention.

</specifics>

<deferred>
## Deferred Ideas

- Consolidating the 3 correlation surfaces' DATA paths (Risk-tab matrix / scenario / `/scenarios`) — out of scope (PROJECT.md code-motion deferral); this phase extracts only a **presentational** heatmap component.
- Rolling / time-varying correlation (SCEN-V2-04) — v2.
- Benchmark correlation — Phase 24.

</deferred>
