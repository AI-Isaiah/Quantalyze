# Phase 100: Optimizer Sleeve + Favorites UX + Notes + KPI Panel - Context

**Gathered:** 2026-07-12
**Status:** Ready for research/planning (design decisions DELEGATED to Fable per user)
**Mode:** Smart discuss — grey areas handed to Fable, not orchestrator-decided.

<domain>
## Phase Boundary
Three demo-hero dashboard improvements (PI-04/05/06): (PI-05) replace the hardcoded 10% favorites sleeve with the REAL optimizer output + favorites sorting/grouping + bulk toggle + KPI narrative tooltips; (PI-04) a **Notes** widget backed by NEW owner-scoped `user_notes` storage (migration); (PI-06) fold the bespoke `PortfolioKPIRow` into the shared-panel pattern. NO exposure widgets (Phase 99, done); NO options-MTM (101/102).
</domain>

<decisions>
## Locked (non-design)
- **PI-04 storage:** `user_notes` ALREADY EXISTS (mig 20260412094453 + 20260421060316; `/api/notes` GET/PATCH + `useNoteAutoSave` + RLS; scopes portfolio|holding|bridge_outcome|strategy). PI-04 = a NEW CONSUMER (Notes widget on /allocations) reusing that infra — NO new table (migration ONLY if a new scope_kind is genuinely needed).
- **SURFACE = /allocations (user decision 2026-07-12):** consolidate favorites + optimizer + Notes + KPI onto the SAME /allocations dashboard as the Phase-99 exposure widgets — one demo-hero surface.
- **PI-05 (reinterpreted — the 10% sleeve was DELETED in v1.6):** render favorites (`user_favorites`/`/api/watchlist`, currently NOT shown on /allocations) + the REAL optimizer's suggestions (`/api/portfolio-optimizer` → `OptimizerSuggestion[]`; note it returns SCORED SUGGESTIONS, not a weight vector — `/api/optimize-weights` is a separate contract) on /allocations, with sort/group/bulk-toggle + KPI narrative tooltips. Replace the ABSENCE, not a stale sleeve. Use the EXISTING optimizer (do NOT build one).
- **PI-06:** fold `PortfolioKPIRow.tsx` (1 consumer: portfolios/[id]/page.tsx:291) into `KpiStrip.tsx` — an ADAPTER not a swap (different metric shapes: MTD vs YTD, AUM). Low blast radius; no-regress to the existing detail page.
- **Invariants:** no-invented-data (honest-empty), SC-4 additive (existing dashboard byte-identical), worker-only decryption (notes carry no secrets), DESIGN.md conformance.

## DELEGATED to Fable (UI researcher UI-SPEC + planner):
- Notes widget UX (edit/save/autosave, markdown vs plain, per-strategy vs per-dashboard scope, empty state).
- Favorites sorting/grouping/bulk-toggle interaction model + KPI narrative tooltip copy.
- Optimizer-sleeve presentation (how the real allocation renders vs the old 10% placeholder).
- Reuse-vs-build for each; DESIGN.md tokens.
</decisions>

<code_context>
## Existing (research to confirm file:line)
- The hardcoded 10% favorites sleeve site; the existing optimizer entrypoint.
- `PortfolioKPIRow` + the shared-panel pattern it should fold into.
- Existing favorites UI + the dashboard page (Phase-99 `page.tsx` now threads `exposure`).
- RLS + migration patterns (allocator_holdings owner-select as the model for `user_notes`).
- DESIGN.md.
</code_context>

<specifics>
- This is the demo-hero surface — favorites-with-real-optimizer + Notes are the "act on it" moment for allocators. Research should surface the optimizer's output shape + whether it's already computed elsewhere.
</specifics>

<deferred>
- Options-MTM (101/102); any new optimizer algorithm.
</deferred>
