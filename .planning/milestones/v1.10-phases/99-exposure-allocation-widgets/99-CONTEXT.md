# Phase 99: Exposure & Allocation Widgets - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning (design decisions DELEGATED to the Fable UI researcher + Fable planner, per user 2026-07-12)
**Mode:** Smart discuss — grey areas NOT auto-decided by the orchestrator; the widget-design forks are handed to Fable.

<domain>
## Phase Boundary

Render the three Portfolio-Intelligence dashboard widgets on the Phase-98 read foundation (`src/lib/portfolio-exposure.ts`): **Exposure by Asset Class** (PI-01), **Net Exposure Over Time** (PI-02), **Allocation Over Time** (PI-03). This is the UI/rendering phase — the data reads already exist. NO new data plumbing, NO optimizer/Notes (Phase 100), NO MTM (101/102). Each widget must render honestly: an allocator with no position data shows an honest empty state; time-series gaps render as MARKED gaps (never a zero-filled flat line), consistent with the factsheet coverage-mask discipline.
</domain>

<decisions>
## Implementation Decisions

### Locked (non-design, from prior phases + invariants)
- **Data source:** the Phase-98 reads ONLY — `getLatestExposureSnapshot` (PI-01), `getNetExposureSeries` (PI-02), `getAllocationSeries` (PI-03). Do NOT re-query `allocator_holdings` directly from the widgets.
- **Auth (rls-auditor carry-forward from Phase 98):** the Server Component consumer MUST supply the `auth.uid()`-derived allocator id to the read helpers (ADR-0022 Layer 2) — the read module takes `userId` as a param and relies on RLS as the backstop, but the caller contract must be honest. Verify the consumer passes the authenticated id, never a client-supplied one.
- **Exposure "class" axis:** `holding_type` (spot/derivative) is the primary class dimension (Phase-98 D-P1 — crypto/traditional is degenerate for an all-crypto book); per-symbol/venue available for drilldown.
- **No-invented-data / honest-empty / marked-gaps** are LOCKED invariants — a widget never fabricates a series or zero-fills a gap.

### DELEGATED to the Fable UI researcher (UI-SPEC) + Fable planner — the user directed these design calls go to Fable, NOT the orchestrator:
- Which existing `src/components/portfolio/` widgets to reuse/adapt (AllocationTimeline, CompositionDonut, AttributionBar, etc.) vs build new, per DESIGN.md.
- Chart type per widget (donut/bar for exposure-by-class; area/line for net-exposure-over-time; stacked-area/streamgraph for allocation-over-time) + how gaps render visually.
- Empty-state copy + visual treatment; loading/skeleton; density; legend/tooltip content.
- Dashboard placement + responsive behavior.
- All must conform to DESIGN.md (read it) — flag any deviation.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase-98 read layer `src/lib/portfolio-exposure.ts`: `getLatestExposureSnapshot`, `getNetExposureSeries`, `getAllocationSeries`, `computeAsofGaps`/`computeCoverageGaps` — typed, honest-empty, gap-marked.
- Rich `src/components/portfolio/` widget library (AllocationTimeline, CompositionDonut, AttributionBar, CorrelationHeatmap, BenchmarkComparison, InsightStrip, …) — the Fable UI researcher decides reuse vs new.
- The factsheet coverage-mask gap-render convention (marked gaps, no zero-fill) to mirror visually.
- DESIGN.md (project design system — MUST read before any visual decision).

### Established Patterns
- Server-Component data reads → props to client widgets; owner-scoped auth at the RSC boundary.
- AGENTS.md: "this is NOT the Next.js you know — read node_modules/next/dist/docs before writing routing/RSC code."

### Integration Points
- The allocator dashboard page (where the widgets mount) — the Fable UI researcher/planner locates the exact page + how it currently renders the placeholders.
</code_context>

<specifics>
## Specific Ideas
- This is THE demo-hero surface (north-star: 10/10 for the cap-intro/pilot-allocator meeting) — the Fable UI researcher should optimize for a compelling, honest allocator dashboard, not just functional widgets.
- The Fable planner must pin the >1000-row pagination live-check carry-forward from Phase 98 (the reads are pagination-fixed but mock-proven; a live large-allocator render is the confirmation).
</specifics>

<deferred>
## Deferred Ideas
- Optimizer sleeve + favorites UX + Notes + KPI panel (Phase 100); options-MTM (101/102).
- Any NEW exposure metric beyond the three widgets.
</deferred>
