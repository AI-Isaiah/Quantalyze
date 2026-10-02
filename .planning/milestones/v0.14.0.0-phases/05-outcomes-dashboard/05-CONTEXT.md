# Phase 5: Outcomes Dashboard - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Allocators see their own Bridge-outcome history as a widget on the existing My Allocation react-grid-layout dashboard. The widget renders:

1. **KPI strip** (top) — total outcomes, win rate %, avg realized delta (Geist Mono 13px, DASHBOARD-02).
2. **Timeline table** — one row per `bridge_outcomes` entry with columns `Original Strategy | Replacement | Date Recorded | Status | Best Available Delta` (DM Sans 14px body, DASHBOARD-03).
3. **Expanded row detail** — three-column delta comparison (30d / 90d / 180d) with mini sparklines of original vs replacement equity curves diverging (DASHBOARD-04).
4. **Full state matrix** — empty / loading / error / partial (pending-delta) (DASHBOARD-05, -06).

Scope is end-to-end for Phase 5: data fan-out extension in `getMyAllocationDashboard()` + lazy curve-fetch endpoint + widget components (`OutcomesWidget` / `OutcomesKPIStrip` / `OutcomesTimelineRow` / `OutcomesSparkline` or equivalent split) + new `outcomes` category in widget registry + default layout entry so the widget is visible for existing allocators on next page load + unit + component tests.

Out of scope: feedback-engine weight-override visualization on this widget (Phase 6+), admin cross-allocator outcomes view, mobile-responsive polish (Sprint 11), PDF export (Sprint 10), counterfactual "had you allocated" deltas for rejected rows, in-widget outcome edit affordance (editing stays at the Holdings banner per Phase 1 D-17), pagination/virtualization (deferred until an allocator exceeds ~200 outcomes).

</domain>

<decisions>
## Implementation Decisions

### Timeline row model
- **D-01:** Sort order = `ORDER BY created_at DESC`, full list, no pagination. Matches Bloomberg/FactSet data-density aesthetic; early-lifecycle allocators have <50 outcomes. Pagination/virtualization is a deferred optimization.
- **D-02 (REVISED 2026-04-19 per Voice D6):** Status column = **4-state**: `Allocated — win` / `Allocated — loss` / `Allocated — pending` / `Rejected — <reason>`. Allocated variants are color-coded from the most-mature non-NULL delta sign via **strict > 0 check (Phase 4 `_success_value` parity)**: strict `> 0` → win (positive tone); `<= 0` (including exactly 0) → loss (negative tone); all deltas NULL → pending (neutral tone). This **INTENTIONALLY overrides Phase 1 D-13 (D-13 = neutral-on-zero) for the status pill only. The Best Available Delta cell continues to honor D-13 (neutral on zero).** Divergence is intentional: the pill binary-classifies success/failure for reinforcement-learning parity with Phase 4 `feedback_engine._success_value`; the delta cell displays raw magnitude without classification. Rejected variants are neutral tone and show the human-friendly label from `REJECTION_REASON_LABELS`. "Allocated X%" is surfaced inline in the pill (matches OutcomeRecordedRow pattern from Phase 1 D-11).
- **D-03:** "Best Available Delta" cell for rejected rows = **em-dash (—)**. No delta exists for a rejected strategy by design (Phase 1 D-19: the daily cron only computes deltas for `kind='allocated'` rows). Em-dash is the existing Quantalyze convention for missing-cell values.
- **D-04:** **Strategy names (Original + Replacement) link to `/strategies/[id]`** (verified route: `src/app/(dashboard)/strategies/[id]` exists). Expand/collapse is driven by a caret/chevron icon button on the row; full-row click does NOT navigate. Keeps expand/navigate affordances unambiguous.
- **D-05:** "Date Recorded" column source = `allocated_at` for allocated rows (self-reported date of action), falling back to `created_at` for rejected rows (no allocated_at). Rendered "Apr 18, 2026" in DM Sans (dates are not metrics — not Geist Mono).

### Sparkline rendering (DASHBOARD-04 expanded detail)
- **D-06:** **Three sparklines per expanded row** — one per window (30d / 90d / 180d). Each column holds a delta number (Geist Mono, tone-colored) + a mini sparkline pair beneath it. The sparkline covers `allocated_at` → `allocated_at + N days` for its window. Matches the plural wording in DASHBOARD-04.
- **D-07:** Rendering library = **Recharts `<LineChart>` with hidden axes and tight margins**, two `<Line>` series (original + replacement). Recharts@3.8.1 is already in the stack (EquityCurve, DrawdownChart, CumulativeVsBenchmark, RollingSharpe, RollingVolatility, RollingVol). Zero new dependencies.
- **D-08:** Line colors: **replacement = accent `#1B6B5A`, original = muted `#94A3B8`** (DESIGN.md chart strategy/benchmark convention). **Tone color (green/red) applies only to the delta NUMBER**, not the sparkline lines — avoids double-encoding semantics and keeps divergence shape legible.
- **D-09:** Data shape = **rebased to 100 at `allocated_at`** for both series. Standard institutional quant convention (Bloomberg, FactSet); makes divergence visually obvious regardless of absolute strategy scale. Computed via cumulative-product from `allocated_at` onwards against `strategy_analytics.returns_series`.
- **D-10:** NULL-delta window handling = **'Pending' pill in the number cell + greyed skeleton sparkline** in that column. Matches Phase 1 D-14 (surface Pending; hide backend errors). Keeps the three-column layout symmetric; users see what's coming.

### KPI semantics (DASHBOARD-02)
- **D-11: Win rate mirrors the Phase 4 feedback engine** success definition so dashboard and feedback engine tell the same story:
  - **Numerator** = count of `kind='allocated'` rows where the most-mature non-NULL delta > 0 (D-12 label logic in `bridge-outcome-label.ts` already expresses "most-mature").
  - **Denominator** = count of `kind='allocated'` rows with ≥1 non-NULL delta AND `percent_allocated ≥ 1.0` (Phase 4 D-08 noise-filter parity — token-size dabbles aren't conviction). Pending-only allocated rows excluded.
  - `kind='rejected'` rows are NOT included in the denominator (rejecting a bad intro is discipline, not a loss).
  - Rejecting `already_owned` rows don't factor here because they're kind='rejected'; Phase 4 drops them too (D-08 step 1).
- **D-12 (MATH CLARIFIED 2026-04-19 per Voice D2):** "Avg realized delta" = mean of the **most-mature non-NULL delta per row** (preference order `delta_180d` → `delta_90d` → `delta_30d`, mirroring `feedback_engine.py::_success_value` lines 156–166) across the D-11 allocated-inclusion set. Pending-only rows excluded from both numerator and denominator. **Authoritative math confirmed by direct read of Phase 4 code on 2026-04-19:** `_success_value` iterates `("delta_180d", "delta_90d", "delta_30d")` in that order and returns on the first non-NULL, so Phase 5 dashboard math MUST do the same. For the D-21 parity fixture (`tests/fixtures/outcomes-kpi-parity.json`), surviving rows o1/o6/o7 yield most-mature deltas [+0.04 (delta_30d), +0.12 (delta_90d), -0.15 (delta_180d)] → `avgRealizedDelta = 0.01 / 3 = 0.00333...` and `winRate = 2/3`. RESEARCH.md §Q4 originally documented `0.02333` (via delta_90d for row o7 — WRONG); the fixture `0.00333` is the correct Phase-4-parity value and RESEARCH.md Q4 has been corrected.
- **D-13:** "Total outcomes recorded" = **simple count of all `bridge_outcomes` rows** for the allocator, regardless of kind / noise / pending. Matches the timeline row count displayed below — KPI number reconciles 1:1 with visible rows (cognitive consistency over Phase 4 math alignment for this KPI).
- **D-14:** Pending-outcome surfacing = **inline sub-label under "avg realized delta"**: e.g., `"Avg realized delta: +2.3% · 3 pending"` — Geist Mono for the main number, DM Sans 12px muted for the sub-label. Honest about exclusions without inflating the KPI count from 3 to 4. Standard institutional factsheet convention.

### Data loading + widget registration
- **D-15:** Query surface = **extend `getMyAllocationDashboard()`** in `src/lib/queries.ts:599+`. Add outcomes + original-strategy resolution (via `bridge_outcomes.match_decision_id` → `match_decisions.original_strategy_id` → `strategies(id, name)` nested embed) into the existing `Promise.all()` fan-out. Widget receives data via the existing `WidgetProps.data` prop pattern used by all 39 existing widgets. No new top-level page route. **Paginated at 200 most-recent rows per D-05/Voice-D5 (`.limit(200)` on the outcomes SELECT).**
- **D-16:** Sparkline returns_series = **lazy on expand**. Row renders collapsed by default; clicking the caret triggers client-side fetch of a new endpoint `GET /api/bridge/outcome/[id]/curves` (planner finalizes exact path + response shape) returning `{ original: [...NAV], replacement: [...NAV] }` rebased to 100. Results cached per session (planner picks react-query / SWR / plain memo — whatever matches existing widget conventions). Keeps initial page-load payload lean for allocators with dozens of outcomes.
- **D-17:** Widget category = **new `outcomes` category** in `widget-registry.ts` (8th category: performance / risk / allocation / attribution / positions / monitoring / intelligence / meta / **outcomes**). Future outcome-adjacent widgets get a natural home.
- **D-18:** Widget registration defaults: `defaultW: 12` (full-width row), `defaultH: 5` (KPI strip + ~8 timeline rows before scroll), **default-visible in the first-load layout** so existing allocators see the widget on their next page visit without manual setup. Critical for the demo horizon.
- **D-19:** Widget slug: `outcomes-timeline` (matches existing kebab-case convention: `equity-curve`, `positions-table`, etc.). Claude's Discretion if the planner prefers a different name during implementation, as long as the key matches across `widget-registry.ts` and `widgets/index.ts`.

### Cross-phase research residuals
- **D-20:** **Original-strategy resolution path.** ~~Planner must verify during research whether `match_decisions` directly carries the underperformer identity…~~ **RESOLVED 2026-04-19 after research:** Research confirmed NO persisted link exists from a `bridge_outcomes` row (or the intro path) to "the strategy that was replaced." `match_decisions.candidate_id` points only at the replacement candidate; `/api/portfolio-bridge` is stateless; `send_intro_with_decision` RPC never took an `original_strategy_id` param. **Resolution (user-authorized scope expansion):** Persist the underperformer at intro-send time via a new column `match_decisions.original_strategy_id UUID NOT NULL REFERENCES strategies(id)`. This promotes Phase 5 from READ-ONLY to READ + 1 migration + admin-path tweak. User explicitly authorized DB restructuring ("the database has no data yet. Choose the most efficient version. you can completely restructure the database. Make it efficient."). See §D-20a–d for the migration + write-path task breakdown.

- **D-20a (REVISED 2026-04-19):** **Schema shape (locked — column on `match_decisions`, NOT `bridge_outcomes`).** Add `original_strategy_id UUID NOT NULL REFERENCES strategies(id)` directly on **`match_decisions`**. Placement rationale (corrected from prior pass): the underperformer identity is known at **intro-send time** (admin side — via `send_intro_with_decision` RPC called from `/api/admin/match/send-intro`). It is NOT known at **outcome-record time** (allocator side — the allocator UI receives a "Bridge outcome" banner on a holding but has no persisted pointer to what the held strategy is a replacement for). Putting the column on `bridge_outcomes` would force the allocator UI to discover the underperformer at outcome-record time, which it cannot. Correct placement: the admin-known side (`match_decisions`). Phase 5 read-path then hops `bridge_outcomes.match_decision_id → match_decisions.original_strategy_id → strategies(id, name)` via a 1-FK nested Supabase select. **Voice-C3/D3 amendment 2026-04-19:** migration 064 ships the column as **NULL-allowed with `ON DELETE RESTRICT`** (not CASCADE — cites migration 059 A6 precedent: `bridge_outcomes.match_decision_id` FK uses SET NULL to preserve outcome history; here RESTRICT because deleting a still-referenced underperformer should be blocked, not silently erased). A follow-up migration 065 tightens to NOT NULL once the admin UI is confirmed shipping non-null values. Removes the empty-table precondition entirely and is safe for branch DBs.

- **D-20b (REVISED 2026-04-19):** **Write-path update (admin side only).** Migration 064 lives in Phase 5 scope. Phase 5 plan must include: (1) migration 064 on **`match_decisions`** adding the column (NULL-allowed initially per D-20a Voice-C3 amendment) + FK with `ON DELETE RESTRICT` (Voice-D3) + index on `(allocator_id, original_strategy_id)` for the Phase 4 feedback-engine future attribution path + `CREATE OR REPLACE FUNCTION send_intro_with_decision` with a new `p_original_strategy_id UUID` parameter positioned after `p_strategy_id` (position 3) — all in one transaction so old callers fail loud at "too few arguments" (desired breaking behavior). A follow-up migration 065 (Wave 3) tightens to NOT NULL after admin UI has shipped values. (2) `POST /api/admin/match/send-intro` route accepts `original_strategy_id` in the JSON body with the existing `typeof body.X === "string"` validation style (matches lines 44–51 of the current route — NOT Zod). Error message: `"original_strategy_id is required"`. Route passes to RPC as `p_original_strategy_id: body.original_strategy_id`. (3) Admin UI `SendIntroPanel.tsx` plumbs `original_strategy_id` into the send-intro POST body. (4) Phase 5 read-side: `getMyAllocationDashboard` extends its fan-out to join `match_decisions` via the nested embed `match_decision:match_decisions!bridge_outcomes_match_decision_id_fkey(original_strategy:strategies!match_decisions_original_strategy_id_fkey(id, name))` — admin client required (match_decisions has no allocator-self-SELECT RLS policy, same pattern as the existing `sent_as_intro` fan-out at queries.ts:679–687, with explicit `.eq("allocator_id", userId)` inline ownership gate + `.limit(200)` cap per Voice-D5). (5) `GET /api/bridge/outcome/[id]/curves` resolves `original_strategy_id` by selecting the outcome's `match_decision_id`, then admin-SELECTing `match_decisions.original_strategy_id`, then admin-SELECTing `strategy_analytics.returns_series` for BOTH ids. Schema push = `supabase db push` AFTER the migration file lands. No historical backfill (table empty). **No changes to `BridgeOutcome` type, `bridge_outcomes` schema, `POST /api/bridge/outcome`, `BridgeOutcomeBanner`, `AllocatedForm`, `RejectedForm`, or `PositionsTable::BannerSubRow`** — those were incorrectly included in the prior pass.

- **D-20c (REVISED 2026-04-19):** **Admin-side anchor verification — BLOCKING.** The admin route needs the underperformer identity at the moment the admin clicks "Send intro" in `SendIntroPanel`. Research verified 2026-04-19 that `SendIntroPanel` does NOT currently carry an underperformer id in state: `CandidateRow` props have no such field and `grep -rn "underperformer" src/components/admin/` returns zero matches. The admin match queue flow (`AllocatorMatchQueue` → `SendIntroPanel`) is portfolio-unaware — admin recommends a strategy without naming what it replaces. The planner MUST surface this as a BLOCKING `checkpoint:decision` in Wave 1 (**BEFORE** migration 064 apply per Voice-C2 sequencing fix) so the user chooses ONE of: (Option A) add a holdings dropdown to `SendIntroPanel` so admin explicitly names the underperformer from the allocator's current `portfolio_strategies`; (Option B) admin picks from all strategies via an autocomplete; (Option C) defer Phase 5 until an admin-side bridge flow exists that natively carries portfolio context. If Option C is selected BEFORE migration apply, the migration is never applied and no rollback is needed (Voice-C2 intent). **STRICTLY FORBIDDEN:** the previous pass's `originalStrategyId = strategyId` tautology — that collapses Original == Replacement, making the two-series sparkline draw one line atop itself and defeating DASHBOARD-03 + DASHBOARD-04. No invented fallbacks.

- **D-20d (REVISED 2026-04-19):** **Scope impact on ROADMAP.** ROADMAP "Phase 5 is READ-ONLY" note is stale. Planner amends ROADMAP in Wave 3: (a) strike the "READ-ONLY" clause, (b) update the Phase 5 plan-list bullet to reference migration 064 (`match_decisions.original_strategy_id` NOT NULL + `send_intro_with_decision` RPC replacement), (c) append a Schema-amendment note under Phase 5 Success Criteria explaining the column placement on `match_decisions` (not `bridge_outcomes`) and that the read-path uses a 1-FK-hop nested embed. The Original+Replacement columns in DASHBOARD-03 and the two-series sparkline in DASHBOARD-04 remain as-spec — data for the "Original" column arrives via the new nested join, not via any new column on `bridge_outcomes`.

- **D-21 (REVISED 2026-04-19 per Voice D2):** **Cross-runtime math parity — enforced via Python pytest (option a).** D-11 mirrors Phase 4's filtering rules. Phase 4 lives in Python (`analytics-service/services/feedback_engine.py`); Phase 5 lives in TypeScript (dashboard data-shaper). Not literally shared code. **Parity enforcement:** the shared golden fixture `tests/fixtures/outcomes-kpi-parity.json` is asserted against by BOTH runtimes — TypeScript `src/lib/outcomes-kpi.test.ts` (primary KPI test; always runs) AND Python `analytics-service/tests/test_outcomes_kpi_parity.py` (gated on `HAS_PY_ENV=1`; imports `feedback_engine._success_value` and asserts per-row success values + most-mature delta values on the fixture's `outcomes` array match TypeScript-computed expected). Planner chose option (a) "wire Python parity" over option (b) "rename to golden + drop parity framing" because `_success_value` is a pure function over dict inputs — directly testable without live DB. If Phase 4 filter logic ever changes (e.g., 1% threshold moves), Phase 5 must move in lockstep AND the fixture must be updated in the same PR so both test suites stay green.

### Claude's Discretion
- Default layout entry file — `AllocationDashboard.tsx` vs `MyAllocationClient.tsx` vs elsewhere; planner picks from existing registration convention
- Exact lazy-fetch endpoint path + response shape for D-16
- Lazy-fetch caching mechanism (react-query / SWR / plain memo) — whatever matches existing widget patterns
- Empty state CTA target (DASHBOARD-05) — lean scroll-to-PortfolioAlerts-widget or `/holdings` anchor or `/for-quants` Bridge explainer
- Loading skeleton row count + animation approach — reuse existing widget skeleton primitives
- Error state retry affordance — reuse existing widget ErrorBoundary pattern
- Exact KPI strip layout (3-column grid vs horizontal flex, divider styling)
- Sparkline exact pixel dimensions (height, stroke width) — follow DESIGN.md data-density principle
- Expand/collapse animation duration (DESIGN.md motion scale: short 150ms or medium 250ms)
- Row hover state (subtle bg per DESIGN.md table pattern)
- Widget icon glyph (follow existing `▲` or pick a matching data glyph)
- Test file placement — lean new file `widgets/outcomes/outcomes.test.tsx` mirroring `performance.test.tsx` / `positions.test.tsx` / `allocation.test.tsx` convention
- Component directory layout — Voice-D1 2026-04-19: **single file `widgets/outcomes/OutcomesWidget.tsx`** with inline sub-component functions (CustomKpiStrip + PositionsTable pattern) is the chosen shape; the prior multi-file split (KPIStrip / TimelineRow / ExpandedPanel / Sparkline as separate files) has been consolidated
- "Allocated X%" inline in status pill — lean YES (matches OutcomeRecordedRow Phase 1 D-11)

### Folded Todos
None — no pending repo-level TODOs surfaced during cross-reference.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — Sprint 8 vision, Key Decision "Widget-in-grid for Outcomes (not new tab)"
- `.planning/REQUIREMENTS.md` — DASHBOARD-01 through DASHBOARD-06 (locked)
- `.planning/ROADMAP.md` — Phase 5 goal, success criteria SC1–SC5, 1 plan (`05-01`)
- `.planning/STATE.md` — current phase entry point; Phases 1–4 complete
- `DESIGN.md` — Geist Mono 13px for numerics; DM Sans 14px body; chart strategy color `#1B6B5A`; chart benchmark `#94A3B8`; positive `#16A34A` / negative `#DC2626`; card / table / motion / data-density conventions

### Cross-phase coupling — READ FIRST
- `.planning/phases/01-outcome-tracker/01-CONTEXT.md` — D-12 label progression, D-13 green/red only on realized windows, D-14 surface Pending hide errors, D-17 editable outcomes, D-19 cron allocated-only delta computation, D-10 rejection_reason enum — Phase 5 reuses all of these conventions
- `.planning/phases/01-outcome-tracker/01-01-SUMMARY.md` — migration 059 `bridge_outcomes` + `bridge_outcome_dismissals` tables + three-tier RLS + `match_decision_id` FK (D-20 original-strategy join anchor via match_decisions)
- `.planning/phases/01-outcome-tracker/01-02-SUMMARY.md` — `POST /api/bridge/outcome` route + `getMyAllocationDashboard` eligibility fan-out (D-15 extension target)
- `.planning/phases/01-outcome-tracker/01-03-SUMMARY.md` — `BridgeOutcomeBanner` + `AllocatedForm` + `RejectedForm` + `OutcomeRecordedRow` + `bridge-outcome-label` util (status-pill copy precedent, label progression reuse)
- `.planning/phases/01-outcome-tracker/01-04-SUMMARY.md` — migration 060 `compute_bridge_outcome_deltas` cron (source of delta_30/90/180d NULL → non-NULL transitions)
- `.planning/phases/04-feedback-loop/04-CONTEXT.md` — D-01 success = most-mature delta > 0, D-08 noise filters (already_owned + <1% allocated drop), D-13 step function semantics — D-11 and D-12 here mirror those rules; D-21 flags the cross-runtime parity concern

### Architecture decision records
- `docs/architecture/adr-0001-rls-primary-authorization.md` — RLS as primary auth (owner-read on `bridge_outcomes` handles this phase's allocator-only data access)
- `docs/architecture/adr-0003-service-role-bypass.md` — when the admin client bypasses RLS (for `daily_returns` column + `match_decisions` reads; pattern to mirror for the nested match_decisions embed in queries.ts)
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — audit event patterns (Phase 5 is read-only on the allocator path; no new audit events on that side, but the admin send-intro route already emits audit events that naturally capture `original_strategy_id` via its upstream metadata)

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — app layering; Server Component → WidgetProps data → Client Widget pattern
- `.planning/codebase/STRUCTURE.md` — widgets directory conventions; one folder per category
- `.planning/codebase/CONVENTIONS.md` — code style; kebab-case widget slugs; file-co-located tests
- `.planning/codebase/STACK.md` — Next.js 16 App Router + Supabase + Recharts
- `.planning/codebase/TESTING.md` — Vitest + RTL patterns for widgets; mock data fixtures

### Existing widget pattern (read-only; mirror)
- `src/app/(dashboard)/allocations/lib/widget-registry.ts` — `WIDGET_REGISTRY` constant; 7 existing categories; Phase 5 adds `outcomes` (D-17)
- `src/app/(dashboard)/allocations/widgets/index.ts` — `WIDGET_COMPONENTS` lazy-loaded barrel; Phase 5 adds the outcomes widget(s)
- `src/app/(dashboard)/allocations/widgets/performance/EquityCurve.tsx` — Recharts chart + `WidgetProps` reference
- `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` — small-chart sizing reference
- `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx` — table + row-expand pattern reference
- `src/app/(dashboard)/allocations/widgets/meta/CustomKpiStrip.tsx` — KPI strip layout pattern
- `src/app/(dashboard)/allocations/widgets/performance/performance.test.tsx` — component test conventions
- `src/app/(dashboard)/allocations/widgets/positions/positions.test.tsx` — table/row component test conventions
- `src/app/(dashboard)/allocations/MyAllocationClient.tsx` + `src/app/(dashboard)/allocations/AllocationDashboard.tsx` — grid registration + default layout entry points (D-18 target)

### Admin path (new touch-points for D-20b revised)
- `src/app/api/admin/match/send-intro/route.ts` — POST route; Phase 5 extends body validation to accept `original_strategy_id` and forwards as `p_original_strategy_id` to the RPC
- `src/components/admin/SendIntroPanel.tsx` — admin-facing slide-out; Phase 5 adds underperformer-source field per W1-02 decision result
- `src/components/admin/AllocatorMatchQueue.tsx` — parent that opens SendIntroPanel; may need to supply `allocatorHoldings` prop depending on W1-02 option

### Data layer (reuse)
- `src/lib/queries.ts:599+` — `getMyAllocationDashboard()`; Phase 5 extends the `Promise.all` fan-out with outcomes history + nested `match_decisions -> original_strategy` resolution (D-15)
- `src/lib/queries.ts:679-687` — existing `sent_as_intro` admin-client fan-out with explicit `.eq("allocator_id", userId)` ownership gate — mirror this pattern for the new outcomes fan-out
- `src/lib/bridge-outcome-schema.ts` — `BridgeOutcome` type (UNCHANGED by Phase 5), `REJECTION_REASONS` enum, `REJECTION_REASON_LABELS` (reuse for Status pill rejected-row labels — D-02)
- `src/lib/bridge-outcome-label.ts` — `deriveOutcomeLabel()` implements the D-12 label progression; reuse for timeline "Best Available Delta" cell (D-03 for rejected) and the KPI "most-mature delta" computation (D-11, D-12)

### Data source (read-only)
- `supabase/migrations/059_bridge_outcomes.sql` — table schema + three-tier RLS + `match_decision_id` FK (D-20 join anchor — `bridge_outcomes` itself unchanged in Phase 5)
- `supabase/migrations/060_bridge_outcome_cron.sql` — delta cron that populates `delta_30/90/180d`
- `supabase/migrations/011_perfect_match.sql` — `match_candidates` + `match_decisions` + `match_batches` schema + original `send_intro_with_decision` RPC (Phase 5 migration 064 extends `match_decisions` + replaces the RPC)
- `supabase/migrations/064_match_decisions_original_strategy.sql` (NEW in Phase 5) — ALTER TABLE match_decisions ADD COLUMN (NULL-allowed, ON DELETE RESTRICT) + CREATE OR REPLACE FUNCTION send_intro_with_decision
- `supabase/migrations/065_match_decisions_original_strategy_notnull.sql` (NEW in Phase 5 Wave 3) — ALTER COLUMN SET NOT NULL guarded by DO block verifying zero NULL rows
- `strategy_analytics.returns_series` JSONB (daily NAV) — sparkline data source for both original and replacement strategies (D-09)

### Design system (every visual decision must conform)
- DESIGN.md §Typography — Geist Mono 13px numerics (DASHBOARD-02); DM Sans 14px body (DASHBOARD-03); DM Sans 12px muted for captions (D-14 sub-label)
- DESIGN.md §Color — accent `#1B6B5A` (chart strategy / replacement line D-08); muted `#94A3B8` (chart benchmark / original line D-08); positive `#16A34A` / negative `#DC2626` (delta-sign tone D-02)
- DESIGN.md §Component Patterns — card / table / badge / button primitives (reuse; no new primitives)
- DESIGN.md §Data density — prefer tables over stacked cards; outcomes widget is a table + expandable rows (matches principle)
- DESIGN.md §Motion — micro 50ms / short 150ms / medium 250ms / long 400ms; expand/collapse uses short or medium (Claude's Discretion)

### Next.js / Recharts — read before writing code
- `node_modules/next/dist/docs/` — Next.js 16 App Router specifics (Server/Client component boundary, data-fetch patterns — see AGENTS.md warning about training-data staleness)
- Recharts@3.8.1 API surface (pinned in `package.json`) — `<LineChart>` with hidden axes = existing sparkline-style pattern across performance widgets

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/bridge-outcome-label.ts::deriveOutcomeLabel` — ready-made most-mature-delta label progression (reuse for timeline Best Available Delta cell AND KPI win-rate / avg-delta numerator computation)
- `src/lib/bridge-outcome-schema.ts::REJECTION_REASON_LABELS` — human-friendly rejection labels for rejected-row Status pill
- `src/lib/queries.ts::getMyAllocationDashboard` — single server-side data-load entry point; extend its `Promise.all` fan-out (D-15)
- Recharts `<LineChart>` with hidden axes — sparkline-variant pattern already in use across 6+ widgets (EquityCurve, DrawdownChart, CumulativeVsBenchmark, RollingSharpe, RollingVolatility, ReturnDistribution)
- `WidgetProps` / `WIDGET_REGISTRY` / `WIDGET_COMPONENTS` barrel — 39 widgets already registered; Phase 5 drops in cleanly
- Three-tier RLS on `bridge_outcomes` + `match_decisions` admin-only policy — no route-level auth redundancy required for owner reads on `bridge_outcomes`; `match_decisions` reads require admin client + inline `allocator_id` ownership gate

### Established Patterns
- **Server-fetch-once → client-widget-render** via `WidgetProps.data` prop (pattern Phase 5 follows, D-15 / D-16)
- **Category-grouped widget registry** with lazy-loaded components via `widgets/index.ts` barrel
- **Recharts chart with hidden axes/gridlines** as the established sparkline pattern
- **Vitest + RTL component tests** co-located per category folder (`{category}.test.tsx`)
- **Supabase RLS as auth boundary** for owner reads — no route-level redundant check
- **Admin client escape hatch** via `createAdminClient()` for column-level REVOKEs AND for `match_decisions` reads (queries.ts:679–687 precedent); D-16 lazy-fetch endpoint uses the admin client for both `match_decisions` and `strategy_analytics.returns_series` access — ownership proved FIRST via user-scoped `bridge_outcomes` SELECT

### Integration Points
- `src/lib/queries.ts::getMyAllocationDashboard` — extend `Promise.all` fan-out with nested match_decisions embed (D-15)
- **New route**: `GET /api/bridge/outcome/[id]/curves` — lazy sparkline data with match_decisions join (D-16)
- `src/app/api/admin/match/send-intro/route.ts` — extend to accept `original_strategy_id` body field + pass to RPC (D-20b revised)
- `src/components/admin/SendIntroPanel.tsx` — admin UI for including `original_strategy_id` per W1-02 decision (D-20c revised)
- `src/app/(dashboard)/allocations/lib/widget-registry.ts` — add `outcomes` category + 1 widget entry (D-17, D-18, D-19)
- `src/app/(dashboard)/allocations/widgets/index.ts` — add lazy component import for outcomes widget(s)
- `src/app/(dashboard)/allocations/widgets/outcomes/` — new directory for widget component(s) and co-located test file
- `src/app/(dashboard)/allocations/MyAllocationClient.tsx` or `AllocationDashboard.tsx` — default layout entry so the widget is visible on first load (D-18; planner picks from the existing registration convention)

### Schema Sync (touch-points, not new contracts)
- `BridgeOutcome` type in `src/lib/bridge-outcome-schema.ts` is **UNCHANGED** — Phase 5 does NOT add fields here. The dashboard-payload-specific shape (`OutcomeRow` in `src/lib/queries.ts`) carries the nested `match_decision.original_strategy` join result as a dashboard-only enrichment.
- Migration 064 is the ONLY schema change — adds `original_strategy_id` to `match_decisions`, NOT to `bridge_outcomes`.

</code_context>

<specifics>
## Specific Ideas

- **KPI sub-label format**: `"Avg realized delta: +2.3% · 3 pending"` — Geist Mono for the number (13px, per DASHBOARD-02), DM Sans 12px muted for the sub-label. Separator is middle-dot `·`. D-14.
- **Status pill copy examples** (D-02):
  - `"Allocated 12% — win"` (green tone, most-mature delta strict > 0)
  - `"Allocated 12% — loss"` (red tone, most-mature delta <= 0, **INCLUDING exactly 0** per D-02 Phase-4 parity override)
  - `"Allocated 12% — pending"` (neutral tone, no non-NULL delta yet)
  - `"Rejected — mandate conflict"` (neutral tone, reason label from `REJECTION_REASON_LABELS`)
- **Date Recorded format**: `"Apr 18, 2026"` — DM Sans, not Geist Mono (dates aren't metrics). D-05.
- **Empty state copy** (DASHBOARD-05 literal): `"Your Bridge outcomes will appear here after you act on one"` + CTA — CTA target is Claude's Discretion; lean scroll-to-PortfolioAlerts-widget or `/holdings` anchor.
- **Error state copy** (DASHBOARD-06 literal): `"Could not load outcomes"` + retry button.
- **Widget slug**: `outcomes-timeline` (D-19; mirrors `equity-curve`, `positions-table` style).
- **KPI-to-timeline reconciliation** (D-13): "Total outcomes" number equals the count of timeline rows below — if an allocator sees "Total: 12" above and 12 rows below, that's the intended cognitive check.
- **Cross-phase math parity** (D-21): win-rate formula in Phase 5 dashboard = Phase 4 `feedback_engine.py::_success_value` rule (most-mature non-NULL delta in order `delta_180d`, `delta_90d`, `delta_30d`; strict `> 0` = success; `<= 0` = failure). Parity fixture at `tests/fixtures/outcomes-kpi-parity.json`; cross-runtime asserted by both `src/lib/outcomes-kpi.test.ts` (TS) and `analytics-service/tests/test_outcomes_kpi_parity.py` (Python, HAS_PY_ENV gated). If Phase 4 D-08 filters change, update Phase 5 in the same PR or note the drift.
- **Pagination cap** (D-15 amended per Voice-D5): server-side `.limit(200)` on the outcomes fan-out; if received count = 200, widget renders footer `"Showing most recent 200 — reach out if you need historical export"`.

</specifics>

<deferred>
## Deferred Ideas

- **Admin cross-allocator outcomes view** — not in DASHBOARD-* scope; admin debugging is served by direct DB inspection + Phase 1 admin audit trail.
- **Feedback-engine weight-override visualization on this widget** — surfacing `scoring_weight_overrides` (Phase 4 output) is Phase 6+ scope if ever. Phase 5 is outcome history only.
- **Counterfactual "had you allocated" delta for rejected rows** — would require scoring against an intro-time baseline; complexity not justified for v1.
- **In-widget outcome edit affordance** — rejected; editing remains at the Holdings banner per Phase 1 D-17.
- **Pagination / virtualization** — deferred beyond the 200-row server cap (Voice-D5). Most allocators will have <50 in year 1; a "Show older" UI is deferred to a future phase when truncation becomes frequent.
- **Mobile-responsive timeline** — Sprint 11 (desktop-only demo surface acceptable per PROJECT.md).
- **PDF export of outcome history** — Sprint 10 (was Sprint 9).
- **Grouped-by-kind split** (Allocated section + Rejected section) — rejected in favor of chronological; chronology is the learning story.
- **Dollar-weighted win rate** (percent_allocated × delta) — deferred; v1 is unweighted count-based.
- **Separate 30/90/180 avg columns in KPI strip** — deferred; one "avg realized delta" number respects the one-number-per-KPI convention.
- **Full-row click = strategy detail side panel** — rejected (ambiguity with expand/collapse affordance).
- **Grouped sparkline** (1 combined chart with 3 markers) — rejected (30d divergence gets visually crushed).
- **Admin visibility flag on own-user outcomes** — RLS already restricts to owner; no user-facing toggle.
- **Hover-reveal of detailed metrics** on timeline rows — deferred; expand is the interaction.
- **Status = rejection_reason label** (single-column variant) — rejected; kept Status separate from reason cell.
- **Adding `original_strategy_id` to `bridge_outcomes`** — rejected in the revision (the prior pass's design); column belongs on `match_decisions` because intro-send time is the knowable point, not outcome-record time. See D-20a–d revised.
- **Allocator-side `originalStrategyId` prop threading** — rejected in the revision (the prior pass's design); the allocator UI does not need to know the underperformer at outcome-record time because Phase 5 resolves it server-side via `match_decision_id` FK.
- **v1 fallback `originalStrategyId = strategyId` tautology** — strictly rejected in the revision; would collapse the two-series sparkline to one line drawn atop itself and defeat DASHBOARD-03 + DASHBOARD-04.

### Reviewed Todos (not folded)
None — no repo-level pending items surfaced during cross-reference.

</deferred>

---

*Phase: 05-outcomes-dashboard*
*Context gathered: 2026-04-19*
*D-20a–d revised: 2026-04-19 (column placement corrected from `bridge_outcomes` to `match_decisions`; admin-side write-path; no allocator-side plumbing; no tautological fallback)*
*D-02, D-12, D-15, D-20a, D-20b, D-20c, D-21 further revised 2026-04-19 per Outside Voices accepted findings (C2, C3, D1, D2, D3, D5, D6 — see VOICES-ACCEPTED.md).*
</content>
</invoke>