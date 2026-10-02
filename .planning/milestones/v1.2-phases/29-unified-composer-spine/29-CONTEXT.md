# Phase 29: Unified Composer Spine - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — grey areas resolved to recommended defaults per the no-clients-decide-autonomously directive; locked milestone decisions carried in verbatim)

<domain>
## Phase Boundary

Deliver ONE portfolio composer surface. An allocator composes from a blank
slate OR seeded from their live book in the *same* surface, browses verified +
example-universe strategies in one tagged catalog, adds in one gesture (instant
projection recompute via the frozen engine), and saves / reopens / renames /
deletes a *named portfolio* persisted to the existing v1.1.0 `scenarios` store.

This phase is **capability absorption**: the existing rich own-book
`ScenarioComposer` (already hosting save / compare / share / stress / MC /
optimizer) is extended to also support the blank-slate + example-universe
capability that today lives only in the separate `/scenarios` `ScenarioBuilder`.
It does NOT retire `/scenarios` or delete `ScenarioBuilder` — that route
retirement is Phase 32 (which depends on this phase landing first). It does NOT
add factsheet graphs (Phase 30) or collapsible controls (Phase 31).

This is a unification / wiring milestone. ZERO new runtime/dev/Python deps,
ZERO schema change, ONE genuinely-new file in the milestone overall
(`scenario-blend-panels.ts`, which belongs to Phase 30, not here). Reuse the
frozen `scenario.ts` engine and `scenarios` persistence — never rebuild.

</domain>

<decisions>
## Implementation Decisions

### Surface & Routing
- The unified composer is the existing `ScenarioComposer` at
  `/allocations?tab=scenario` (canonical host). It already has the full v1.1.0
  feature set wired (save/compare/share/stress/MC/optimizer) — extend it, do not
  fork a new route.
- Phase 29 makes the composer *support* both entry modes; the `/scenarios`
  `redirect()` and `ScenarioBuilder` delete are explicitly Phase 32 (hard-gated
  on this phase). Do NOT redirect or delete `/scenarios` in this phase.
- Entry mode is chosen via a segmented control at the top of the composer:
  "From my book" (default when a live book exists) / "Blank slate". A blank
  composer is the front door when the allocator has no book.

### Merged Catalog (Browse drawer)
- Extend the existing `/api/strategies/browse` route to additionally surface
  `is_example = true AND status = 'published'` rows in the SAME response as
  verified strategies. One Browse drawer in the composer lists both.
- Example rows carry a clearly-distinct "Example" badge/pill (DESIGN.md token —
  read DESIGN.md before choosing). Verified strategies keep their existing
  treatment.
- **RLS (LOCKED — exit gate):** the browse route keeps the RLS-scoped client +
  `withPublishedOnly` + `displayStrategyName` pseudonymity. It MUST NOT switch to
  `createAdminClient()`. A test asserts an unpublished AND a cross-tenant
  strategy do NOT appear even with `is_example` included, and that example rows
  carry the pseudonymity-safe label.

### Add Gesture & Projection
- Clicking "Add" on a catalog row appends the strategy to the working
  composition and recomputes the projection immediately through the existing
  frozen `computeScenario` engine — no separate confirm step, no second
  annualization convention.
- **Example-universe `daily_returns` plumbing — DEFERRED TO RESEARCH** (the
  roadmap's flagged `--research-phase` decision): SSR-lift the bounded
  `is_example AND published` series into the composer payload vs lazy-fetch the
  series on add. Measure the `is_example AND published` row count, bound the set,
  and lazy the series only if it bloats the SSR payload. Whichever path: the
  fetch is scoped to `is_example = true AND status = 'published'`, never an
  unbounded admin pull (exit gate).

### Save / Reopen Named Portfolio
- **Persistence (LOCKED — exit gate):** reuse the v1.1.0 `scenarios` table
  (JSONB draft + RLS + `schema_version`). NO migration touching `scenarios` /
  `scenario_shares` / `get_shared_scenario` / `create_scenario_share` ships in
  this phase; `test_scenarios_rls.sql` + `test_scenario_shares_rls.sql` stay
  green; the share-RPC body-shape DO-block is untouched.
- Reuse the existing scenario save / list / rename / delete affordances already
  in `ScenarioComposer`. A "named portfolio" IS a saved scenario row. Surface
  the term "portfolio" in the unified-composer UI while persisting to
  `scenarios`.
- **Reopen codec trichotomy (LOCKED — success criterion 3):** reopen honors the
  existing decode trichotomy (ok / readonly / reset) so a drifted draft never
  silently empties. Reuse the existing decode logic; do not weaken it.

### Claude's Discretion
- The exact segmented-control component, badge token, and Browse-drawer layout
  are at the planner/implementer's discretion within DESIGN.md.
- The SSR-lift-vs-lazy-fetch data-plumbing decision is research-driven (see
  above) — resolve it in the plan-phase research pass, not by guessing here.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — the rich
  own-book composer (the unification host). Already wires save/compare/share/
  stress/MC/optimizer.
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` — hosts the composer at
  the `scenario` tab; owns tab state and scenario-state preservation (see its
  `.scenario-state-preservation.test.tsx`).
- `src/components/scenarios/ScenarioBuilder.tsx` — the blank-slate
  example-universe sandbox at `/scenarios` (the capability to absorb; do NOT
  delete this phase). Its `ScenarioBuilder.honesty.test.tsx` holds the IMPACT-02
  peer-rank guard — that coverage must be preserved (its migration onto the
  composer is Phase 32's gate, but the composer must not regress honesty here).
- `src/app/api/strategies/browse/route.ts` (+ `route.test.ts`) — the catalog
  route to extend with `is_example` rows under the same RLS scope.
- `src/lib/scenario.ts` — the frozen engine (`computeScenario`, SCENARIO-05
  pins). Reuse; do not edit.

### Established Patterns
- RLS-scoped Supabase client + `withPublishedOnly` + `displayStrategyName`
  pseudonymity on browse; never `createAdminClient()` on a tenant-facing read.
- `scenarios` persistence (JSONB draft, RLS `scenarios_owner`, `schema_version`)
  with a decode trichotomy (ok / readonly / reset) on reopen.
- 252-day annualization is product-wide; the engine already honors it.

### Integration Points
- Composer host: `/allocations?tab=scenario` (AllocationsTabs).
- Catalog: `/api/strategies/browse`.
- Persistence: existing scenario save/list/rename/delete + `scenarios` table.

</code_context>

<specifics>
## Specific Ideas

- "Named portfolio" terminology in the UI; `scenarios` row underneath (no new
  table, no migration).
- Segmented "From my book" / "Blank slate" entry control.
- Single Browse drawer, verified + example, example badged.

</specifics>

<deferred>
## Deferred Ideas

- `/scenarios` `redirect()` + `ScenarioBuilder` delete + IMPACT-02 guard
  migration onto the composer → **Phase 32** (hard-gated on this phase).
- Factsheet-grade graphs on the blend → **Phase 30**.
- Collapsible / graphs-lead layout → **Phase 31**.
- Bridge → composer continuity + onboarding polish + WCAG-AA audit → **Phase 33**.

</deferred>
