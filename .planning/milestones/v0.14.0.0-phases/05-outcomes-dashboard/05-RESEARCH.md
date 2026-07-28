# Phase 5: Outcomes Dashboard — Research

**Researched:** 2026-04-19
**Domain:** React widget (react-grid-layout) + Next.js App Router data fan-out + Supabase read-only queries + Recharts sparklines
**Confidence:** HIGH on widget / data / math layers · MEDIUM on D-20 original-strategy join (structural issue — see §Technical Approach Q1)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-21)

**Timeline row model (D-01..D-05):**
- **D-01:** Sort order = `ORDER BY created_at DESC`, full list, no pagination. Bloomberg/FactSet data-density aesthetic; early-lifecycle allocators have <50 outcomes. Pagination is a deferred optimization.
- **D-02:** Status column = 4-state: `Allocated — win` / `Allocated — loss` / `Allocated — pending` / `Rejected — <reason>`. Allocated variants color-coded from most-mature non-NULL delta sign (green/red/neutral per Phase 1 D-13). Rejected variants neutral tone + human-friendly label from `REJECTION_REASON_LABELS`. "Allocated X%" surfaced inline in the pill.
- **D-03:** "Best Available Delta" cell for rejected rows = em-dash (—). No delta exists for a rejected strategy by design (Phase 1 D-19: cron only computes deltas for `kind='allocated'` rows).
- **D-04:** Strategy names (Original + Replacement) link to `/strategies/[id]`. Expand/collapse driven by caret/chevron icon button — full-row click does NOT navigate. Keeps expand/navigate affordances unambiguous.
- **D-05:** "Date Recorded" column source = `allocated_at` for allocated rows, falling back to `created_at` for rejected rows. Rendered "Apr 18, 2026" in DM Sans (not Geist Mono — dates aren't metrics).

**Sparkline rendering (D-06..D-10):**
- **D-06:** Three sparklines per expanded row — one per window (30d / 90d / 180d). Each column holds delta number (Geist Mono, tone-colored) + mini sparkline pair beneath.
- **D-07:** Rendering library = Recharts `<LineChart>` with hidden axes and tight margins, two `<Line>` series (original + replacement). Zero new dependencies.
- **D-08:** Line colors: replacement = accent `#1B6B5A`, original = muted `#94A3B8`. Tone color (green/red) applies only to the delta NUMBER, not the sparkline lines.
- **D-09:** Data shape = rebased to 100 at `allocated_at` for both series. Standard institutional quant convention. Computed via cumulative-equity ratio from `strategy_analytics.returns_series`.
- **D-10:** NULL-delta window handling = 'Pending' pill in the number cell + greyed skeleton sparkline in that column. Matches Phase 1 D-14.

**KPI semantics (D-11..D-14):**
- **D-11:** Win rate mirrors Phase 4 feedback engine success definition:
  - Numerator = count of `kind='allocated'` rows where most-mature non-NULL delta > 0.
  - Denominator = count of `kind='allocated'` rows with ≥1 non-NULL delta AND `percent_allocated ≥ 1.0` (Phase 4 D-08 noise-filter parity). Pending-only allocated rows excluded.
  - `kind='rejected'` rows NOT included in denominator.
- **D-12:** "Avg realized delta" = mean of most-mature non-NULL delta per row, across the D-11 allocated-inclusion set.
- **D-13:** "Total outcomes recorded" = simple count of all `bridge_outcomes` rows for the allocator. Matches the timeline row count below — KPI reconciles 1:1 with visible rows.
- **D-14:** Pending-outcome surfacing = inline sub-label under "avg realized delta": `"Avg realized delta: +2.3% · 3 pending"`.

**Data loading + widget registration (D-15..D-19):**
- **D-15:** Query surface = extend `getMyAllocationDashboard()` in `src/lib/queries.ts:599+`. Add outcomes + original-strategy resolution into the existing `Promise.all()` fan-out. Widget receives data via `WidgetProps.data` prop pattern.
- **D-16:** Sparkline returns_series = lazy on expand. Client-side fetch to `GET /api/bridge/outcome/[id]/curves` returning `{ original: [...NAV], replacement: [...NAV] }` rebased to 100. Results cached per session.
- **D-17:** Widget category = new `outcomes` category (8th category in `widget-registry.ts`).
- **D-18:** Widget registration defaults: `defaultW: 12`, `defaultH: 5`, default-visible in first-load layout.
- **D-19:** Widget slug: `outcomes-timeline`.

**Cross-phase residuals (D-20, D-21):**
- **D-20:** Original-strategy resolution path flagged for research — ADDRESSED in §Technical Approach Q1 below. **Research finding: the concept of "original/replacement pair" is NOT persisted anywhere in the current schema.** Planner must choose a semantic interpretation.
- **D-21:** Cross-runtime math parity (Phase 4 Python ↔ Phase 5 TypeScript). Shared golden fixture recommended — see §Technical Approach Q4.

### Claude's Discretion
- Default layout entry file (`AllocationDashboard.tsx` vs `MyAllocationClient.tsx` vs `dashboard-defaults.ts`) — researcher recommends `dashboard-defaults.ts` (the canonical default layout constant, with LAYOUT_VERSION bump).
- Exact lazy-fetch endpoint path + response shape for D-16 (researcher recommends `GET /api/bridge/outcome/[id]/curves`, see Q2).
- Lazy-fetch caching mechanism — researcher recommends plain `useRef<Map<string, CurveData>>` per widget mount (zero deps, matches existing widget conventions).
- Empty state CTA target — researcher recommends `/holdings` anchor (aligns with Phase 1 banner insertion point).
- Loading skeleton row count — researcher recommends 5 (fills `defaultH: 5` grid height).
- Error retry affordance — reuse existing widget ErrorBoundary + add data-level retry button.
- KPI strip layout — researcher recommends 3-column flex with `justify-around` + hairline dividers (mirrors `CustomKpiStrip.tsx`).
- Sparkline dimensions — height 48px, strokeWidth 1.5 (matches DrawdownChart precedent).
- Expand/collapse animation — `transition-all duration-150 ease-out` (short).
- Widget icon — `◈` glyph (data/measurement signal).
- Test file — `widgets/outcomes/outcomes.test.tsx` (mirrors per-category convention).
- Component directory layout — `widgets/outcomes/{OutcomesWidget, OutcomesKPIStrip, OutcomesTimelineRow, OutcomesSparkline}.tsx`.
- "Allocated X%" inline in status pill — YES (matches OutcomeRecordedRow Phase 1 D-11).

### Deferred Ideas (OUT OF SCOPE for Phase 5)

- Admin cross-allocator outcomes view — not in DASHBOARD-* scope.
- Feedback-engine weight-override visualization — Phase 6+ scope.
- Counterfactual "had you allocated" delta for rejected rows — complexity not justified for v1.
- In-widget outcome edit affordance — rejected; editing stays at Holdings banner per Phase 1 D-17.
- Pagination / virtualization — deferred until an allocator exceeds ~200 outcomes.
- Mobile-responsive timeline — Sprint 11.
- PDF export of outcome history — Sprint 10.
- Grouped-by-kind split (Allocated section + Rejected section) — rejected in favor of chronological.
- Dollar-weighted win rate (percent_allocated × delta) — deferred.
- Separate 30/90/180 avg columns in KPI strip — deferred.
- Full-row click = strategy detail side panel — rejected.
- Grouped sparkline (1 combined chart with 3 markers) — rejected.
- Admin visibility flag on own-user outcomes — rejected.
- Hover-reveal of detailed metrics on timeline rows — deferred; expand is the interaction.
- Status = rejection_reason label (single-column variant) — rejected.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASHBOARD-01 | Outcomes widget renders as a new widget inside the existing react-grid-layout grid on My Allocation (not a new tab container). | §Domain Model + §Technical Approach Q5 (widget registration); zero architectural changes — `WIDGET_REGISTRY` / `WIDGET_COMPONENTS` barrel extension only. |
| DASHBOARD-02 | KPI strip (top) shows total outcomes recorded, win rate %, average realized delta in Geist Mono 13px. | §Technical Approach Q4 (Phase 4 math parity) + existing `CustomKpiStrip.tsx` layout pattern; D-11..D-14 locked semantics. |
| DASHBOARD-03 | Timeline list (below KPI) shows columns Original Strategy \| Replacement \| Date Recorded \| Status \| Best Available Delta. | §Technical Approach Q1 (**D-20 flagged**: original strategy not stored; planner must choose semantic), Q6 (status pill label derivation), + existing `PositionsTable.tsx` table structure. |
| DASHBOARD-04 | Expanded row shows three-column delta comparison (30d / 90d / 180d) with mini sparklines of original vs replacement equity curves diverging. | §Technical Approach Q2 (lazy curves endpoint) + Q3 (Recharts sparkline ergonomics) + Q7 (a11y on expandable rows). Depends on Q1 resolution (what is "original"?). |
| DASHBOARD-05 | Empty state: illustration + "Your Bridge outcomes will appear here after you act on one" + CTA pointing at Bridge. | §Technical Approach Q8 (state matrix); literal copy locked in UI-SPEC. |
| DASHBOARD-06 | State matrix fully covered — loading (skeleton rows), error ("Could not load outcomes" + retry), partial ("Estimated" / "Pending" delta labels). | §Technical Approach Q8; reuses `animate-pulse` skeleton primitive and existing `TileWrapper` error boundary wrapping. |
</phase_requirements>

## Project Constraints (from CLAUDE.md + AGENTS.md)

- **Simplicity first:** minimal diff surface, no unnecessary abstraction.
- **Root-cause obsession:** no bandaids, no temporary fixes.
- **Minimal impact:** touch only what's required — Phase 5 is widget-only.
- **Elegance check** for non-trivial changes.
- **Zero hand-holding:** locate evidence, fix autonomously.
- **DESIGN.md** is the visual contract — every font/color/spacing decision traces there. UI-SPEC already inlines the tokens Phase 5 needs; planner does not need to re-research DESIGN.md, only compliance-check.
- **Banned packages** (supply-chain compromises): `axios`, `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai`. Phase 5 introduces ZERO new npm deps (Recharts 3.8.1 already in stack); no risk.
- **AGENTS.md:** "This is NOT the Next.js you know" — Next.js 16 App Router specifics. Read `node_modules/next/dist/docs/` before writing route handler code. Particularly: `cookies()` / `headers()` / `params` / `searchParams` are async in Next.js 16; route handler signatures may differ from training data.
- **Skill routing**: Not relevant for planning (no user-request match).

---

## Summary

Phase 5 is a well-scoped widget addition with one structural gotcha.

**What's straightforward:**
- Schema already exists. `bridge_outcomes` is live (migration 059), three-tier RLS enforces allocator-only SELECT, Phase 1 cron populates delta_30/90/180d. Phase 5 is pure READ.
- Widget pattern is well-trodden: 39 existing widgets, `WIDGET_REGISTRY` / `WIDGET_COMPONENTS` barrel, `WidgetProps.data` prop. Phase 5 adds category `outcomes` + one widget — textbook extension.
- Recharts sparkline variant is already used 6+ times (DrawdownChart, EquityCurve, CumulativeVsBenchmark, RollingSharpe, RollingVolatility, ReturnDistribution). Pattern: `<LineChart>` with hidden axes + tight margins + no tooltips.
- Math parity with Phase 4: the TypeScript equivalent of `feedback_engine.py::_fetch_eligible_outcomes` + `_success_value` is ~20 lines of pure function. Filter rules are simple and fully documented in Phase 4 D-08.
- KPI layout: `CustomKpiStrip.tsx` is the drop-in precedent.
- Expandable rows: `PositionsTable.tsx::BannerSubRow` is the precedent for `<tr><td colSpan>` sub-row injection.

**What's structurally broken (research finding):**
- **D-20 original-strategy resolution has no clean answer in the current schema.** `bridge_outcomes` stores only `strategy_id` (the replacement) + `match_decision_id` (the intro). The Bridge V1 `/api/portfolio-bridge` endpoint is STATELESS — it takes `underperformer_strategy_id` as INPUT and returns candidates, but never persists the underperformer → replacement pair. `match_decisions.candidate_id` → `match_candidates` carries scoring context for the REPLACEMENT strategy, not the underperformer. There is no `original_strategy_id` column anywhere. UI-SPEC's "Original Strategy | Replacement" columns need semantic re-interpretation — see Q1 below for three alternatives.

**Primary recommendation:** Plan should open with a `wave-0` data-layer spike that resolves D-20 (Q1) before committing to the UI contract. The UI-SPEC is otherwise executable as-is. Recommend a single plan (`05-01`) with 4 waves: Wave 0 (data spike + test fixtures), Wave 1 (data-fetch extension + lazy endpoint), Wave 2 (widget components + sparklines), Wave 3 (state matrix + a11y + tests).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Outcomes data fan-out | API/Backend (Server Component) | — | `getMyAllocationDashboard()` is a Server-Component query; RLS on `bridge_outcomes` is primary auth (ADR-0001). Widget receives already-filtered data via `WidgetProps.data`. |
| Original-strategy resolution (if implemented) | API/Backend (Server Component) | Database (RLS) | Same query surface; reads go through admin client because `match_decisions` has no allocator-self-SELECT RLS policy (see queries.ts:619–623 and send-intro/route.ts:114–121). |
| Status-pill derivation | Browser / Client | — | Pure function over `BridgeOutcome` data. Reuses `deriveOutcomeLabel()` already shipped Phase 1. |
| KPI math (win rate / avg delta) | Browser / Client | — | Pure function over outcomes array. Mirrors Phase 4's `compute_adjusted_weights` filter rules (D-08) client-side. |
| Sparkline equity curves (rebased to 100) | API/Backend (Route Handler) | Browser / Client (rendering) | Raw `returns_series` fetched server-side via admin client (column-level REVOKE convention per ADR-0003 §2.b). Client does NOT fetch returns directly; client renders the rebased points returned by `/api/bridge/outcome/[id]/curves`. |
| Expand/collapse state | Browser / Client | — | `useState<string \| null>(expandedId)` lives in the widget. No server round-trip. |
| Lazy-load cache | Browser / Client | — | Session-scoped in-memory `useRef<Map<string, CurveData>>`. No SWR/react-query — keeps bundle lean and matches existing widget conventions. |
| Widget registration & layout | Browser / Client | — | Extend `WIDGET_REGISTRY`, `WIDGET_COMPONENTS`, `DEFAULT_LAYOUT`. LocalStorage-backed via `useDashboardConfig` hook. Bump `LAYOUT_VERSION` so existing users see the widget on next visit (D-18). |
| State matrix (loading/empty/error/partial) | Browser / Client | — | Each state is a render branch in `OutcomesWidget`. Wrapped by `TileWrapper` error boundary for catastrophic JS errors. |

---

## Domain Model

### Data flow diagram

```
USER VISITS /allocations
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ SERVER COMPONENT: src/app/(dashboard)/allocations/page │
│                                                         │
│  await getMyAllocationDashboard(user.id)                │
│        │                                                │
│        ▼                                                │
│  Promise.all([                                          │
│    portfolio_analytics       (admin)                    │
│    portfolio_strategies      (admin)                    │
│    api_keys                  (user-scoped)              │
│    portfolio_alerts          (user-scoped)              │
│    match_decisions           (admin)                    │
│    bridge_outcomes           (user-scoped)              │
│    bridge_outcome_dismissals (user-scoped)              │
│    +++ NEW (D-15) +++                                   │
│    strategies name-lookup    (admin — batch by id set)  │
│  ])                                                     │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼ { portfolio, analytics, strategies[], apiKeys[], alertCount, outcomes[] }
┌─────────────────────────────────────────────────────────┐
│ CLIENT: AllocationDashboard.tsx (widgetData.outcomes)   │
│          │                                              │
│          ▼                                              │
│   <DashboardGrid>                                       │
│     <TileWrapper title="Bridge Outcomes">               │
│       <Suspense fallback={<WidgetSkeleton/>}>           │
│         <OutcomesWidget                                 │
│           data={widgetData}                             │
│           .../>                                         │
│       </Suspense>                                       │
│     </TileWrapper>                                      │
│   </DashboardGrid>                                      │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│ OutcomesWidget.tsx ("use client")                       │
│   │                                                     │
│   ├── computeKPIs(outcomes)  ← pure; mirrors Phase 4    │
│   │        └→ <OutcomesKPIStrip />                      │
│   │                                                     │
│   ├── outcomes.sort(created_at desc).map(...)          │
│   │        └→ <OutcomesTimelineRow>  (caret button,     │
│   │             deriveOutcomeLabel, status pill)        │
│   │                                                     │
│   └── on caret click:                                   │
│         expandedId = id                                 │
│         │                                               │
│         └→ if not cached:                               │
│             fetch GET /api/bridge/outcome/[id]/curves   │
│                  │                                      │
│                  ▼                                      │
│         ┌──────────────────────────────────────────┐    │
│         │ ROUTE HANDLER: /api/bridge/outcome/      │    │
│         │                [id]/curves               │    │
│         │                                          │    │
│         │  1. withAuth → verify session            │    │
│         │  2. SELECT bridge_outcomes WHERE id=[id] │    │
│         │     AND allocator_id=auth.uid()  ← RLS   │    │
│         │  3. If not found → 404 (owner-read)      │    │
│         │  4. Resolve original_strategy_id via     │    │
│         │     D-20 decision (see Q1)               │    │
│         │  5. Admin client SELECT returns_series   │    │
│         │     FROM strategy_analytics              │    │
│         │     WHERE strategy_id IN (orig, repl)    │    │
│         │  6. Rebase both to 100 at allocated_at   │    │
│         │  7. Slice to allocated_at..+180 days     │    │
│         │  8. Return { original, replacement }     │    │
│         └──────────────────────────────────────────┘    │
│                  │                                      │
│                  ▼                                      │
│         <OutcomesExpandedPanel>                         │
│           for window in [30, 90, 180]:                  │
│             <delta number + OutcomesSparkline>          │
└─────────────────────────────────────────────────────────┘
```

### DB schema touch-points (READ-ONLY — no new migrations)

| Table / Column | Role in Phase 5 | RLS considerations |
|----------------|-----------------|---------------------|
| `bridge_outcomes` (migration 059) | Primary source. Columns read: `id`, `strategy_id`, `match_decision_id`, `kind`, `percent_allocated`, `allocated_at`, `rejection_reason`, `note`, `delta_30d/90d/180d`, `estimated_delta_bps`, `estimated_days`, `needs_recompute`, `created_at`. | Owner-select via `bridge_outcomes_select_own` policy. User-scoped client works (see queries.ts:690–695 precedent). |
| `strategies` (migration 001) | Name lookup (original + replacement) — `id, name`. | Publicly readable for `status='published'` (migration 002 policy `strategies_read_own_or_published`). Safe via user-scoped client for published strategies; admin client needed if any are status=`draft`/`pending_review`. Recommend admin client for consistency with existing query pattern. |
| `match_decisions` (migration 011) | Provides `bridge_outcomes.match_decision_id` linkage. No allocator-self-SELECT RLS policy (admin-only) — must use admin client with explicit `.eq("allocator_id", userId)` as ownership gate (precedent: queries.ts:683–687, outcome/route.ts:114–121). | Admin client REQUIRED. |
| `match_candidates` (migration 011) | Referenced via `match_decisions.candidate_id` — holds `score_breakdown` for the REPLACEMENT (not the underperformer). Not directly needed for Phase 5 UI. | Admin client required. |
| `match_batches` (migration 011) | Holds `effective_preferences` JSONB at scoring time. Not needed for Phase 5. | Admin client required. |
| `portfolio_strategies` (migration 001) | **May be needed for D-20 Option B** (see Q1) — shows what the allocator held at `sent_as_intro` time. Schema is CURRENT state only, no snapshot history. | Admin client (already in use in queries.ts:644–671). |
| `strategy_analytics.returns_series` (migration 001) | JSONB cumulative equity curve `[{date:"YYYY-MM-DD", value:NUMERIC}, ...]`. Source for sparkline rebase. **NOT daily returns** — confirmed from migration 060 comments ("NEVER SUM of daily returns"). | Admin client required per existing comment in queries.ts:619–620 (even if column-level REVOKE isn't provably in migrations 001/010; the `createAdminClient()` pattern is the established convention and ADR-0003 §(b) codifies it). |

### Original-strategy join SQL (contingent on Q1 resolution)

**If Option A (drop the column):** no join needed. Single-strategy timeline.

**If Option B (join to current-holdings underperformer):**
```sql
-- For each bridge_outcome row, resolve the worst-performing current holding
-- in the allocator's portfolio at outcome-record time. "Worst" defined as
-- portfolio_strategies with the most negative trailing 30-day return.
-- CAVEAT: this is NOT a snapshot — it shows "what's underperforming NOW",
-- not "what was underperforming at intro time". Acceptable only if UI-SPEC
-- copy frames it as "worst current holding" rather than "the one you replaced".
-- Not recommended — semantic mismatch with UI-SPEC language.
```

**If Option C (store explicit original at intro time via migration 061):**
```sql
-- Phase 5.5 scope — NEW MIGRATION:
ALTER TABLE match_decisions ADD COLUMN original_strategy_id UUID
  REFERENCES strategies(id) ON DELETE SET NULL;
-- Backfill: NULL (no historical data to recover).
-- Forward: send_intro_with_decision() RPC takes p_original_strategy_id.
-- Then Phase 5 JOIN is a trivial FK hop.
-- Not recommended for Phase 5 — violates "widget-only, READ-ONLY" scope.
```

**Recommended (Option A')**: Drop "Original Strategy" column from timeline table. Status pill already communicates win/loss/pending. Expanded-row sparklines become single-line (replacement only; no divergence comparison). See §Unknowns for why this is the simplest path to a shipping demo.

---

## Technical Approach

### Q1. D-20 original-strategy resolution path [CRITICAL RESEARCH FINDING]

**Verified via:** `supabase/migrations/059_bridge_outcomes.sql`, `supabase/migrations/011_perfect_match.sql`, `supabase/migrations/001_initial_schema.sql`, `src/app/api/bridge/route.ts`, `src/app/api/admin/match/send-intro/route.ts`, `analytics-service/routers/portfolio.py:797–880`.

**Finding:** The current schema has **no persisted link from a `bridge_outcomes` row to "the strategy that was being replaced."**

- `bridge_outcomes` carries only `strategy_id` (the strategy introduced) and `match_decision_id`.
- `match_decisions` has `candidate_id` (FK to `match_candidates`) — scoring context for the intro strategy, not the replacer.
- `match_candidates.reasons[]` is free-text sentence list — no structured underperformer reference.
- `match_batches.effective_preferences` is the allocator's preferences at scoring time — no strategy pair.
- `/api/portfolio-bridge` (analytics-service) takes `underperformer_strategy_id` as INPUT and is stateless — it writes no row recording "intro X replaces Y".
- `contact_requests` has just `(allocator_id, strategy_id, message, status)` — no original pointer.
- `send_intro_with_decision()` RPC signature takes `(p_allocator_id, p_strategy_id, p_candidate_id, p_admin_note, p_decided_by)` — no `p_original_strategy_id`.

**Grepped explicit:** `grep -rn "original_strategy\|underperforming_strategy\|replaces_strategy"` → zero matches in migrations/, src/app/api/, analytics-service/.

**Three options for the planner:**

| Option | Description | Cost | Demo-readiness |
|--------|-------------|------|----------------|
| **A (recommended)** | Drop "Original Strategy" column. Timeline = 4 columns (Replacement \| Date \| Status \| Best Delta). Expanded-row sparkline = single line (replacement only). Widget becomes "outcome ledger" not "comparison report". | 0 new schema. Minor UI-SPEC rewrite (planner's call; CONTEXT doesn't lock the column count — it's inside DASHBOARD-03 requirement, but DASHBOARD-03 says "Original \| Replacement" so technically REQUIRES an update or requirement re-interpretation). | Ships cleanly. Shows realized deltas honestly. |
| **B** | Reinterpret "Original" as "worst current holding" at view time. Join `portfolio_strategies` + sort by trailing 30d return. | 0 new schema. SQL in fan-out. | Semantically weak: "original" becomes "current underperformer", which CHANGES on every page load. Not a faithful retrospective. |
| **C** | Add migration 061: `match_decisions.original_strategy_id UUID`. Update `send_intro_with_decision()` to accept + persist. Backfill NULL for historical rows. Phase 5 JOIN trivial. | +1 migration (small). Phase 5 scope crosses into schema changes. ROADMAP line 99–100 explicitly says Phase 5 is READ-ONLY ("no new migrations"). | Semantically correct but OUT of current phase scope. Would need ROADMAP amendment. |

**Recommendation:** Option A. Rationale: (1) CONTEXT.md §Deferred explicitly rejects "Full-row click = strategy detail side panel" and "Grouped-by-kind split" — the simplification pattern is established. (2) Adding Option C requires ROADMAP amendment and breaks the "widget-only, READ-ONLY" scope. (3) Option B is semantically wrong — it answers a different question. (4) Option A still satisfies all DASHBOARD-* requirements if DASHBOARD-03 is re-read as "Replacement | Date | Status | Best Delta" (the planner and discuss-phase need to confirm this with the user). (5) The expanded-row sparkline still tells a story ("how did this pick do after you allocated?") even without a comparison line.

**If user insists on two-series sparkline in D-20 discuss:** Option C (new migration) is the only honest path. Option B should be rejected.

**Exact SQL for Option A** (no join needed):
```sql
-- getMyAllocationDashboard extension — single new fan-out entry
supabase
  .from("bridge_outcomes")
  .select(`
    id, strategy_id, match_decision_id, kind, percent_allocated, allocated_at,
    rejection_reason, note, delta_30d, delta_90d, delta_180d,
    estimated_delta_bps, estimated_days, needs_recompute, created_at,
    strategy:strategies!inner(id, name)
  `)
  .eq("allocator_id", userId)
  .order("created_at", { ascending: false })
```
RLS on `bridge_outcomes` is owner-select; user-scoped client works. `strategies` embed is readable via `strategies_read_own_or_published` (migration 002).

### Q2. D-16 lazy curves endpoint — exact path & response shape

**Verified via:** `supabase/migrations/060_bridge_outcome_cron.sql:11–14` (`returns_series` format), `src/lib/queries.ts:617–625` (admin-client convention for strategy_analytics), `docs/architecture/adr-0003-three-client-supabase.md:59–61` (column-level REVOKE noted but not provably in migrations — convention nonetheless).

**returns_series format (confirmed HIGH):**
```json
[
  {"date": "2025-10-01", "value": 1.00},
  {"date": "2025-10-02", "value": 1.012},
  {"date": "2025-10-03", "value": 1.005},
  ...
]
```
This is a **cumulative equity curve** (NAV), not daily returns. Rebasing to 100 at `allocated_at`:
```
rebased[d] = 100 × equity_at(d) / equity_at(allocated_at)
```
Where `equity_at(allocated_at)` must be non-NULL and non-zero. If missing, the row contributes a "curve unavailable" signal — see §Pitfalls.

**Recommended endpoint:**
- **Path:** `GET /api/bridge/outcome/[id]/curves` (D-16 Claude's Discretion — matches existing `GET /api/bridge/outcome/[id]` convention style).
- **Auth:** `withAuth` wrapper; route handler first SELECTs `bridge_outcomes WHERE id=[id] AND allocator_id=auth.uid()` via user-scoped client (RLS enforces owner read — 404 if not found).
- **Data fetch:** Admin client SELECTs `strategy_analytics.returns_series` for `strategy_id` (and `original_strategy_id` IF Option C chosen in Q1).
- **Response shape (Option A — single series):**
```ts
{
  replacement: Array<{ date: string; nav: number }>;   // rebased to 100; dates YYYY-MM-DD
  allocated_at: string;                                 // YYYY-MM-DD for client-side x-axis
}
```
- **Response shape (Option C — two series):**
```ts
{
  original:    Array<{ date: string; nav: number }>;
  replacement: Array<{ date: string; nav: number }>;
  allocated_at: string;
}
```
- **Windowing:** Slice to `allocated_at` .. `allocated_at + 180 days` (inclusive). Bound by the most-recent date in `returns_series`.
- **Error shape:** `{ error: string }` + HTTP 404 (not-found) / 403 (wrong allocator, though RLS should make this unreachable) / 500 (data fetch failure). Client shows "—" + retry microlink.

**Auth boundary (HIGH):** The route MUST verify ownership BEFORE fetching returns_series. Pattern:
```ts
// 1. RLS-enforced ownership check (user-scoped client)
const { data: outcome } = await supabase
  .from("bridge_outcomes")
  .select("id, strategy_id, allocated_at")
  .eq("id", params.id)
  .maybeSingle();
if (!outcome) return NextResponse.json({ error: "Not found" }, { status: 404 });

// 2. Only AFTER ownership proven, use admin client for the analytics read
const admin = createAdminClient();
const { data: analytics } = await admin
  .from("strategy_analytics")
  .select("strategy_id, returns_series")
  .eq("strategy_id", outcome.strategy_id)
  .single();
```

**Caching (Claude's Discretion recommendation):** Plain `useRef<Map<string, CurveData>>` inside `OutcomesWidget`. Rationale: (1) no existing widget uses react-query or SWR — all widgets are server-pushed data via `WidgetProps.data`, so adding a fetch lib just for this one endpoint violates simplicity-first. (2) Session-scoped cache is sufficient — curves only change when the cron runs (daily), so cache invalidation isn't even needed within a session. (3) Zero new deps.

**Rate limiting:** Reuse existing `userActionLimiter` keyed by `bridge_outcome_curves:${user.id}`.

### Q3. Recharts sparkline ergonomics

**Verified via:** `src/app/(dashboard)/allocations/widgets/performance/{DrawdownChart, RollingSharpe, CumulativeVsBenchmark, RollingVolatility, ReturnDistribution}.tsx`; Recharts@3.8.1 pinned in package.json.

**Extracted minimal sparkline pattern** (from DrawdownChart + removing axes/tooltips):

```tsx
import { Line, LineChart, ResponsiveContainer } from "recharts";

export function OutcomesSparkline({
  points,
}: {
  points: Array<{ date: string; original?: number; replacement: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        {/* Original (muted) — only if two-series variant (Option C from Q1) */}
        {points.some(p => p.original !== undefined) && (
          <Line
            type="monotone"
            dataKey="original"
            stroke="#94A3B8"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        )}
        <Line
          type="monotone"
          dataKey="replacement"
          stroke="#1B6B5A"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        {/* NO XAxis, NO YAxis, NO Tooltip, NO Legend — sparkline convention */}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

**Dimensions (HIGH, UI-SPEC-aligned):** `height={48}`, full column width via `ResponsiveContainer`, `strokeWidth={1.5}` (matches DrawdownChart precedent line 75).

**Tooltips:** DISABLED. Sparkline convention in the codebase (DrawdownChart uses tooltips because it's a full chart at card-width; sparklines in DESIGN.md §Data density should NOT compete for attention via tooltips). A separate explicit delta number cell ABOVE the sparkline carries the value.

**Animation:** `isAnimationActive={false}`. Lazy-fetched data would flash on render; disabling avoids distraction.

**`connectNulls`:** Enabled — `returns_series` may have gaps (non-trading days) and we want the line to bridge them rather than break visually.

**X-axis key:** The merged `points` array uses `date` as the implicit key (Recharts `<LineChart data={...}>` uses the first field). No explicit `<XAxis dataKey="date" />` is needed when axes are hidden.

### Q4. Phase 4 math parity (D-11, D-12, D-21)

**Verified via:** `analytics-service/services/feedback_engine.py:91–126` (the literal filter function), `.planning/phases/04-feedback-loop/04-CONTEXT.md` D-01, D-02, D-08.

**Phase 4 filter rules (from `feedback_engine.py::_fetch_eligible_outcomes` + `_success_value`):**

1. Drop rows where `kind='rejected' AND rejection_reason='already_owned'` (D-08 step 1, line 106 `.neq("rejection_reason", "already_owned")`).
2. Drop rows where `kind='allocated' AND percent_allocated < 1.0` (D-08 step 2, line 116 `.gte("percent_allocated", 1.0)`).
3. Drop `kind='allocated'` rows where ALL of `delta_30d`, `delta_90d`, `delta_180d` are NULL (D-03, lines 120–125).
4. For remaining allocated rows: `success = 1` iff most-mature non-NULL delta (order: `delta_180d`, `delta_90d`, `delta_30d`) is strictly `> 0`; else 0. (D-01/D-02, `_success_value` lines 156–166).

**Phase 5 CONTEXT.md D-11 narrows this further for KPI purposes:**
- KPI win rate ONLY counts `kind='allocated'` rows (rejected rows excluded from numerator AND denominator — "rejecting a bad intro is discipline, not a loss").
- KPI denominator = allocated rows surviving filters 1–3.

**TypeScript pure function spec (recommended):**

```ts
// src/lib/outcomes-kpi.ts (new file)
import type { BridgeOutcome } from "./bridge-outcome-schema";

export type OutcomeKPIs = {
  totalOutcomes: number;    // D-13: COUNT(*) all rows, unfiltered
  winRate: number | null;   // D-11: wins / denominator; null when denom=0
  avgRealizedDelta: number | null;  // D-12: mean of most-mature; null when denom=0
  pendingCount: number;     // D-14: count of allocated rows excluded from denom for pending reasons
};

export function computeOutcomeKPIs(outcomes: BridgeOutcome[]): OutcomeKPIs {
  const totalOutcomes = outcomes.length;

  // Apply Phase 4 D-08 filters (allocated rows only for KPI denominator)
  const allocated = outcomes.filter(o => o.kind === "allocated");
  const filteredAllocated = allocated.filter(o =>
    (o.percent_allocated ?? 0) >= 1.0                    // D-08 step 2
  );
  const mature = filteredAllocated.filter(o =>
    o.delta_30d !== null || o.delta_90d !== null || o.delta_180d !== null  // D-03
  );
  const pendingCount = filteredAllocated.length - mature.length;

  if (mature.length === 0) {
    return { totalOutcomes, winRate: null, avgRealizedDelta: null, pendingCount };
  }

  // Most-mature non-NULL delta (D-02)
  const mostMatureDeltas: number[] = mature.map(o => {
    if (o.delta_180d !== null) return o.delta_180d;
    if (o.delta_90d !== null) return o.delta_90d;
    return o.delta_30d!;
  });

  const wins = mostMatureDeltas.filter(d => d > 0).length;
  const winRate = wins / mature.length;
  const avgRealizedDelta = mostMatureDeltas.reduce((a, b) => a + b, 0) / mature.length;

  return { totalOutcomes, winRate, avgRealizedDelta, pendingCount };
}
```

**Shared golden fixture (D-21 parity enforcement):**

**Recommended path:** `tests/fixtures/outcomes-kpi-parity.json` (repo root, accessible to both TS + Python).

```json
{
  "description": "Cross-runtime parity fixture. Phase 4 Python feedback_engine.py AND Phase 5 TypeScript outcomes-kpi.ts MUST produce identical success_rate + avg_delta on this input. Any drift = blocker.",
  "outcomes": [
    {"id":"o1","kind":"allocated","percent_allocated":10,"delta_30d":0.04,"delta_90d":null,"delta_180d":null,"rejection_reason":null,"allocated_at":"2025-10-01"},
    {"id":"o2","kind":"allocated","percent_allocated":0.5,"delta_30d":0.05,"delta_90d":null,"delta_180d":null,"rejection_reason":null,"allocated_at":"2025-10-05"},
    {"id":"o3","kind":"allocated","percent_allocated":15,"delta_30d":null,"delta_90d":null,"delta_180d":null,"rejection_reason":null,"allocated_at":"2025-10-10"},
    {"id":"o4","kind":"rejected","percent_allocated":null,"delta_30d":null,"delta_90d":null,"delta_180d":null,"rejection_reason":"already_owned","allocated_at":null},
    {"id":"o5","kind":"rejected","percent_allocated":null,"delta_30d":null,"delta_90d":null,"delta_180d":null,"rejection_reason":"mandate_conflict","allocated_at":null},
    {"id":"o6","kind":"allocated","percent_allocated":5,"delta_30d":null,"delta_90d":0.12,"delta_180d":null,"rejection_reason":null,"allocated_at":"2025-06-01"},
    {"id":"o7","kind":"allocated","percent_allocated":8,"delta_30d":-0.03,"delta_90d":-0.08,"delta_180d":-0.15,"rejection_reason":null,"allocated_at":"2025-04-01"}
  ],
  "expected_phase5_kpis": {
    "totalOutcomes": 7,
    "winRate": 0.666666666666667,
    "avgRealizedDelta": 0.0033333333333333335,
    "pendingCount": 1
  },
  "expected_phase4_filter_survivors": ["o1","o6","o7"],
  "expected_phase4_success_values": {"o1":1,"o6":1,"o7":0}
}
```

> **Math correction (Voice D2, 2026-04-19):** earlier drafts of this fixture recorded `avgRealizedDelta = 0.02333` under the assumption that row o7 would contribute its `delta_90d = -0.08`. That was wrong. Phase 4 `feedback_engine.py::_success_value` (lines 156–166) iterates `(delta_180d, delta_90d, delta_30d)` and returns on the first non-NULL, so o7 contributes `delta_180d = -0.15`. Correct survivors + their most-mature deltas are: o1 → +0.04 (delta_30d, win), o6 → +0.12 (delta_90d, win), o7 → -0.15 (delta_180d, loss). `avgRealizedDelta = (0.04 + 0.12 + -0.15) / 3 = 0.00333...`, `winRate = 2/3`. CONTEXT.md D-12 has been revised with the same correction; the fixture above is now authoritative.

Phase 5 TS test: `src/lib/outcomes-kpi.test.ts` loads the JSON and asserts `expected_phase5_kpis` matches to 12 decimal places. Phase 4 Python follow-up (out of scope for Phase 5 but highly recommended): extend `analytics-service/tests/test_feedback_engine.py` with a test that loads the same JSON and asserts on `expected_phase4_filter_survivors`/`expected_phase4_success_values`. A CI-level invariant test can `git diff`-guard the fixture file (no change to fixture without both test suites updating).

### Q5. Widget registration shape (D-17, D-18, D-19)

**Verified via:** `src/app/(dashboard)/allocations/lib/widget-registry.ts:7–416`, `src/app/(dashboard)/allocations/widgets/index.ts:14–101`, `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts:11–26`, `src/app/(dashboard)/allocations/hooks/useDashboardConfig.ts:16–30`.

**WIDGET_REGISTRY entry (exact shape to add):**

```ts
// src/app/(dashboard)/allocations/lib/widget-registry.ts
// Insert as new category block BEFORE the WIDGET_CATEGORIES constant (line 422)
// OR AT THE END of the 39-widget list (either works — registry is a keyed object).
// Style match: follow the existing "// ── Category (N) ────..." divider comments.

  // ── Outcomes (1) ─────────────────────────────────────────────────
  "outcomes-timeline": {
    id: "outcomes-timeline",
    name: "Bridge Outcomes",
    category: "outcomes",
    icon: "◈",                   // Claude's Discretion — diamond-dot glyph per UI-SPEC
    defaultW: 12,                 // D-18: full-width row
    defaultH: 5,                  // D-18: KPI strip + ~8 rows before scroll
    description: "Your Bridge outcome history with win rate, timeline, and per-window sparklines.",
    status: "ready",
  },
```

**WIDGET_CATEGORIES extension (line 422–431):**

```ts
export const WIDGET_CATEGORIES = [
  { id: "performance" as const, name: "Performance", icon: "▲" },
  { id: "risk" as const, name: "Risk", icon: "◆" },
  { id: "allocation" as const, name: "Allocation", icon: "◉" },
  { id: "attribution" as const, name: "Attribution", icon: "▸" },
  { id: "positions" as const, name: "Positions", icon: "▦" },
  { id: "monitoring" as const, name: "Monitoring", icon: "●" },
  { id: "intelligence" as const, name: "Intelligence", icon: "◈" },
  { id: "meta" as const, name: "Meta", icon: "≡" },
  { id: "outcomes" as const, name: "Outcomes", icon: "◈" },  // NEW — 8th category
];
```

**TYPE EXTENSION (src/app/(dashboard)/allocations/lib/types.ts:22):**

```ts
export interface WidgetMeta {
  id: string;
  name: string;
  category: "performance" | "risk" | "allocation" | "attribution" | "positions" | "monitoring" | "intelligence" | "meta" | "outcomes";  // ADD "outcomes"
  ...
}
```

**WIDGET_COMPONENTS entry (src/app/(dashboard)/allocations/widgets/index.ts:100):**

```ts
  // ── Outcomes (1) ──────────────────────────────────────────────────
  "outcomes-timeline": lazy(() => import("./outcomes/OutcomesWidget")),
```

Uses default export (matches Performance widgets convention).

**Default-visible on first load (D-18) — CRITICAL for demo:**

The canonical default layout is `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts::DEFAULT_LAYOUT` — consumed by `useDashboardConfig::loadConfig()`. Add entry AND bump `LAYOUT_VERSION`:

```ts
// src/app/(dashboard)/allocations/lib/dashboard-defaults.ts
export const LAYOUT_VERSION = 2;  // was 1 — forces existing users to see new defaults

export const DEFAULT_LAYOUT: TileConfig[] = [
  { i: "equity-curve-1", widgetId: "equity-curve", x: 0, y: 0, w: 12, h: 4 },
  { i: "drawdown-chart-1", widgetId: "drawdown-chart", x: 0, y: 4, w: 12, h: 4 },
  { i: "allocation-donut-1", widgetId: "allocation-donut", x: 0, y: 8, w: 4, h: 3 },
  { i: "correlation-matrix-1", widgetId: "correlation-matrix", x: 4, y: 8, w: 4, h: 3 },
  { i: "monthly-returns-1", widgetId: "monthly-returns", x: 8, y: 8, w: 4, h: 3 },
  { i: "positions-table-1", widgetId: "positions-table", x: 0, y: 11, w: 12, h: 4 },
  { i: "net-exposure-1", widgetId: "net-exposure", x: 0, y: 15, w: 12, h: 4 },
  { i: "trade-volume-1", widgetId: "trade-volume", x: 0, y: 19, w: 6, h: 3 },
  { i: "exposure-by-asset-1", widgetId: "exposure-by-asset", x: 6, y: 19, w: 6, h: 3 },
  // NEW Phase 5 — row 22 full-width
  { i: "outcomes-timeline-1", widgetId: "outcomes-timeline", x: 0, y: 22, w: 12, h: 5 },
];
```

**Version-bump consequence:** From `useDashboardConfig.ts:18–21`, when `parsed.layoutVersion !== LAYOUT_VERSION` the hook resets to `DEFAULT_LAYOUT`. This means existing users with saved custom layouts will LOSE their customizations and see the default layout again on next visit. The comment in `dashboard-defaults.ts:6–11` acknowledges this is a deliberate trade-off for material layout changes. **Phase 5 is such a change** per D-18 ("critical for demo horizon"), so the bump is justified. But the planner should document this as a user-visible side effect in the phase summary.

### Q6. Status-pill label source (D-02)

**Verified via:** `src/lib/bridge-outcome-label.ts` (16 test cases in `bridge-outcome-label.test.ts`).

**Existing `deriveOutcomeLabel()` returns:**
```ts
{
  label: "Pending" | "Estimated" | "30-day" | "90-day" | "180-day",
  value: "Pending" | "Estimated: +2.1% (3d)" | "30-day: +4.3%" | ...,
  tone: "neutral" | "positive" | "negative"
}
```

**This output is NOT directly suitable for the D-02 status-pill.** The D-02 pill variants are:
- `"Allocated 12% — win"`
- `"Allocated 12% — loss"`
- `"Allocated 12% — pending"`
- `"Rejected — Mandate conflict"`

`deriveOutcomeLabel()` doesn't know about `percent_allocated` or "win/loss/pending" aggregate vocabulary — it returns the specific window label.

**Recommended solution:** ADD a new helper adjacent to `deriveOutcomeLabel`:

```ts
// src/lib/bridge-outcome-label.ts (append)

export type OutcomeStatusPill = {
  text: string;      // "Allocated 12% — win" | "Rejected — Mandate conflict" | ...
  tone: "positive" | "negative" | "neutral";
  state: "allocated-win" | "allocated-loss" | "allocated-pending" | "rejected";
};

export function deriveOutcomeStatusPill(
  outcome: BridgeOutcome,
): OutcomeStatusPill {
  if (outcome.kind === "rejected") {
    const label = outcome.rejection_reason
      ? REJECTION_REASON_LABELS[outcome.rejection_reason]
      : "Other";
    return {
      text: `Rejected — ${label}`,
      tone: "neutral",
      state: "rejected",
    };
  }

  // Allocated — determine win/loss/pending from most-mature delta
  const pct = outcome.percent_allocated ?? 0;
  const prefix = `Allocated ${pct}%`;

  // D-02: most-mature non-NULL delta sign drives win/loss
  const mostMature =
    outcome.delta_180d !== null
      ? outcome.delta_180d
      : outcome.delta_90d !== null
        ? outcome.delta_90d
        : outcome.delta_30d;  // may still be null

  if (mostMature === null || mostMature === undefined) {
    return { text: `${prefix} — pending`, tone: "neutral", state: "allocated-pending" };
  }
  if (mostMature > 0) {
    return { text: `${prefix} — win`, tone: "positive", state: "allocated-win" };
  }
  return { text: `${prefix} — loss`, tone: "negative", state: "allocated-loss" };
}
```

**Key decisions:**
- Reuses `REJECTION_REASON_LABELS` from `bridge-outcome-schema.ts` (no duplication).
- `state` discriminant is used by the widget to pick the pill styling (bg/text color map in UI-SPEC §Status Pill Anatomy).
- Tie-breaking for `delta === 0`: treated as "loss" (matching Phase 4 `_success_value` which uses `> 0` strict).
- Does NOT call `deriveOutcomeLabel()` — kept pure and independent. Timeline "Best Available Delta" cell separately calls `deriveOutcomeLabel()` per UI-SPEC.

**Placement:** Append to `src/lib/bridge-outcome-label.ts` — it's already the "bridge outcome labels" module, adding a second derivation aligns with naming.

**Tests:** Add ~8 cases to `src/lib/bridge-outcome-label.test.ts` matching the canonical shape (win, loss, pending, rejected-mandate-conflict, rejected-already-owned, rejected-other, zero-delta-as-loss, 180d-wins-over-30d).

### Q7. Keyboard / a11y on expandable rows

**Verified via:** `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx` — the BannerSubRow pattern. Note: PositionsTable's BannerSubRow is a PERMANENTLY rendered sub-row beneath eligible Holdings rows; it is NOT a caret-driven expand/collapse. Phase 5 needs a DIFFERENT pattern.

**PositionsTable precedent — NOT directly reusable:** The `<tr><td colSpan>` sub-row injection pattern (PositionsTable lines 506–534) IS the right structural pattern (fragment key + conditional sub-row), but the toggle mechanism is not present.

**Recommended pattern for caret-button expand:**

```tsx
// OutcomesTimelineRow.tsx — per-row component
function OutcomesTimelineRow({
  outcome,
  colSpan,
  isExpanded,
  onToggle,
}: Props) {
  return (
    <>
      <tr
        className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8F9FA] transition-colors"
        style={{ height: 44 }}
      >
        <td className="px-2 py-2 w-[32px]">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse outcome detail" : "Expand outcome detail"}
            aria-controls={`outcome-detail-${outcome.id}`}
            className="flex items-center justify-center w-7 h-7 rounded
                       text-[#718096] hover:text-[#1A1A2E] hover:bg-[#F8F9FA]
                       focus-visible:outline focus-visible:outline-2
                       focus-visible:outline-[#1B6B5A] transition-colors"
          >
            <span aria-hidden="true" className="text-sm"
                  style={{ transform: isExpanded ? "rotate(90deg)" : "none",
                           transition: "transform 150ms ease-out" }}>
              {"\u203A"}  {/* U+203A single right-pointing angle */}
            </span>
          </button>
        </td>
        {/* ...other cells: Original link, Replacement link, Date, Status pill, Best Delta */}
      </tr>
      {isExpanded && (
        <tr id={`outcome-detail-${outcome.id}`}>
          <td colSpan={colSpan} className="p-0">
            <OutcomesExpandedPanel outcomeId={outcome.id} allocatedAt={outcome.allocated_at} />
          </td>
        </tr>
      )}
    </>
  );
}
```

**Key a11y decisions:**
- **`<button>` wraps the caret** (not a bare clickable div) — native keyboard support (Space/Enter) comes free.
- **`aria-expanded`** toggles `false`/`true` on the button.
- **`aria-controls`** points to the panel's id — screen reader users can navigate to the newly revealed content.
- **`aria-label`** dynamically updates based on state ("Expand" / "Collapse") — matches UI-SPEC literal copy.
- **Focus-visible outline** uses accent color — DESIGN.md convention.
- **Rotation via CSS transform** is purely visual; the glyph is `aria-hidden`.
- **Strategy name links** are separate `<a>` elements — clicking the caret does NOT navigate (D-04). Full-row click also does NOT toggle (D-04).

**Row-expand state management (widget-level):**

```tsx
// OutcomesWidget.tsx
const [expandedId, setExpandedId] = useState<string | null>(null);
// One row expanded at a time — matches UI-SPEC Interaction Contract line 335.

<tbody>
  {outcomes.map(o => (
    <OutcomesTimelineRow
      key={o.id}
      outcome={o}
      colSpan={visibleColCount}
      isExpanded={expandedId === o.id}
      onToggle={() => setExpandedId(expandedId === o.id ? null : o.id)}
    />
  ))}
</tbody>
```

### Q8. Empty / loading / error / partial states

**Verified via:** UI-SPEC §State Matrix (lines 277–327), `src/app/(dashboard)/allocations/components/TileWrapper.tsx` (WidgetErrorBoundary), `src/app/(dashboard)/allocations/components/DashboardGrid.tsx:21–28` (WidgetSkeleton).

**Error boundary (catastrophic JS errors):** Already wired by `TileWrapper.tsx:17–40` — every widget is wrapped. Fallback: `"Widget error — try removing and re-adding."`. Phase 5 inherits this for free.

**Data-level state matrix (spec-driven):**

| State | Trigger | Render |
|-------|---------|--------|
| **Loading** | `widgetData.outcomes === undefined` (initial render or RSC hydration) | 5 skeleton rows, `animate-pulse bg-[#E2E8F0]` rectangles at stepped widths. Height = 44px each. Labels `aria-label="Loading outcomes data"` on container. |
| **Empty** | `widgetData.outcomes !== undefined && widgetData.outcomes.length === 0` | Centered icon + copy `"Your Bridge outcomes will appear here after you act on one"` + `"View Holdings"` CTA → `/holdings`. |
| **Error** | Fan-out threw (shouldn't happen given Promise.all error-mask pattern — see §Pitfalls) OR client fetch in lazy curves fails (per-row). | Widget-level: `"Could not load outcomes"` + retry button. Lazy-curves row-level: `"—"` microtext + retry microlink in the three delta cells. |
| **Partial** | Rows exist but some/all have NULL deltas | Normal render; per-row handling: status pill = "Allocated 12% — pending"; expanded sparkline = skeleton rectangle; KPI sub-label shows `· N pending`. |

**Skeleton primitive:** No dedicated `<Skeleton>` component exists in the codebase — `DashboardGrid.tsx:WidgetSkeleton` is a single-purpose inline div. UI-SPEC specifies inline `animate-pulse` divs (matches the convention). Do NOT introduce a new skeleton library.

**Retry affordance (error state):** Simple button that triggers `router.refresh()` (Next.js App Router server-component re-fetch) OR, for the lazy-curves row-level error, re-invokes the fetch wrapped in the ref cache clear. Both are Claude's Discretion.

**Loading = server-side-fetch-in-flight IS rare** with the Server Component pattern — by the time `OutcomesWidget` renders, `widgetData.outcomes` is already populated from `getMyAllocationDashboard`. The "Loading" state is most meaningful for client refetches (e.g., after outcome recording via `router.refresh()`). **Recommendation:** lean heavily on the partial state as the "loading" surface — when a newly-recorded outcome arrives with all deltas NULL, the widget looks "loading" naturally without a separate state transition.

---

## Runtime State Inventory

Phase 5 is widget-only and READ-ONLY. No rename/refactor/migration work.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no keys renamed or data migrated. | None — verified by reading CONTEXT.md + reviewing each `bridge_outcomes` column. |
| Live service config | None — no external service config touched. Bridge V1 `/api/portfolio-bridge` remains unchanged. | None — verified. |
| OS-registered state | None — no cron/task changes. pg_cron for `compute_bridge_outcome_deltas` remains unchanged. | None — verified by reading migration 060. |
| Secrets/env vars | None — no new secrets. Existing `SUPABASE_SERVICE_ROLE_KEY` reused for admin client (D-16 endpoint). | None — verified. |
| Build artifacts | LAYOUT_VERSION bump from 1 → 2 will reset persisted user layouts in localStorage. This is a DESIRED behavior (D-18 requires visibility on next load) but is a runtime-state side effect. | Document in plan summary; no action needed mid-plan. |

---

## Pitfalls

### Pitfall 1: `allocated_at` is a DATE, not TIMESTAMPTZ
**What goes wrong:** Client-side math that treats `allocated_at` as a timestamp (e.g., `new Date(allocated_at).getTime()`) will implicitly interpret "2026-04-18" as "2026-04-18T00:00:00Z" — UTC midnight. Server-side and sparkline rebase math already knows this (migration 059 D-09 decision, migration 060 comment lines 11–12).
**How to avoid:** For sparkline date matching against `returns_series[].date` (which is TEXT "YYYY-MM-DD"), compare strings — don't parse to Date. Extract helper: `function sameDay(a: string, b: string) { return a === b; }`. For the curves endpoint's slice math: use a pure string comparator `date >= allocated_at && date <= addDaysISO(allocated_at, 180)`.
**Warning signs:** Off-by-one day in sparkline rendering; rebased values != 100 at anchor; curves start on the day AFTER `allocated_at`.

### Pitfall 2: `returns_series` is cumulative equity, NOT daily returns
**What goes wrong:** Rebasing by `cumprod(1 + daily_return)` when the series is already cumulative double-counts growth. Migration 060 has an inline "NEVER SUM" warning (line 13, line 52, line 76) specifically because someone almost did.
**Root cause:** `strategy_analytics.returns_series` is a cumulative NAV curve `[{date, value}, ...]` where `value` is a unit-normalized cumulative figure.
**How to avoid:** Rebase formula is simple ratio:
```ts
const anchorNav = findDate(series, allocated_at)?.value;
if (!anchorNav) return [];  // can't rebase
return series
  .filter(p => p.date >= allocated_at)
  .map(p => ({ date: p.date, nav: 100 * p.value / anchorNav }));
```
**Warning signs:** Rebased values grow explosively; sparklines look vertical; tests comparing against expected "+5%" deliver "+127%".

### Pitfall 3: NULL-delta rows (pending) break naive aggregation
**What goes wrong:** `outcomes.reduce((sum, o) => sum + o.delta_30d, 0)` on a pending row summing `null` → NaN. All KPIs downstream become NaN.
**How to avoid:** Filter BEFORE aggregating (see Q4 TypeScript spec). Use the narrow `mature` subset. Return `null` (not `NaN`) when denominator = 0 and render as em-dash.
**Warning signs:** `toFixed()` called on NaN returns "NaN"; KPI strip shows "NaN%"; empty state NOT triggered because `outcomes.length > 0` but all are pending.

### Pitfall 4: `bridge_outcomes` is append-only — editable-via-UPDATE
**What goes wrong:** Treating `bridge_outcomes` as immutable (no UPDATE possibility) means widget state doesn't refresh after the user edits a previously-recorded outcome via the Holdings banner (Phase 1 D-17). The widget would show stale data until a full page refresh.
**How to avoid:** Because the widget gets data from `getMyAllocationDashboard()` which is a Server Component `cache()`-wrapped query, data refresh comes from `router.refresh()` triggered by the outcome-edit banner. The widget itself doesn't need explicit refresh logic — but the planner should sanity-check that the Holdings outcome-edit banner already calls `router.refresh()` on submit (verified in Phase 1 plan 01-03 summary — yes, it does; the banner replaces itself with OutcomeRecordedRow on client, and React re-renders from props on next navigation).
**Warning signs:** User edits outcome, navigates away and back, widget shows stale KPI.

### Pitfall 5: `returns_series` may have gaps — rebase handling
**What goes wrong:** `returns_series` may be missing specific dates (non-trading days, data pipeline gaps). The rebase formula returns `undefined` for missing anchor, or an incomplete sparkline.
**How to avoid:**
- If `anchorNav` is missing on `allocated_at`, FALL FORWARD to the first date >= `allocated_at` in the series. Document this as a known approximation.
- For the line chart: `connectNulls` on `<Line>` bridges gaps visually (see Q3 code). DO NOT fill gaps with carry-forward values server-side — let Recharts interpolate visually.
- If the entire series is missing OR `anchorNav` is still missing after fall-forward, return empty array; UI falls back to the "pending sparkline" grey rectangle.
**Warning signs:** Sparkline line disappears mid-chart; rebased[0] is not 100.

### Pitfall 6: Admin client REVOKE on strategy_analytics.daily_returns — NOT provably in migrations
**What goes wrong:** The comment in `src/lib/queries.ts:617–620` claims `daily_returns` is column-level REVOKE'd per migration 010. Grep of migrations 001–063 finds ZERO explicit REVOKE on `daily_returns` or `returns_series` from anon/authenticated. The admin-client convention is therefore **convention-only**, not DB-enforced.
**Consequence for Phase 5:** If the curves endpoint uses the user-scoped client, it MIGHT actually work despite the comment. BUT — the convention (reinforced by ADR-0003 §(b)) says USE ADMIN. Relying on undocumented/unenforced DB state is a bug waiting to happen.
**How to avoid:** Use admin client for the returns_series read (Q2 code pattern). Do NOT use user-scoped client even if it "seems to work in dev" — the REVOKE may be applied via a later migration not yet merged, or enforced at a different layer.
**Warning signs:** Endpoint works for admin-user fingerprint but returns NULL returns_series for plain authenticated users; or worse, works in dev but fails in prod.

### Pitfall 7: Fan-out Promise.all failure masking
**What goes wrong:** `queries.ts::getMyAllocationDashboard` uses `Promise.all` (line 636) — if ANY fan-out query fails, the entire dashboard fails. Currently hardcoded: portfolio_analytics, portfolio_strategies, api_keys, portfolio_alerts, match_decisions, bridge_outcomes, bridge_outcome_dismissals (7 queries). Phase 5 adds an 8th (strategies name-lookup or joined SELECT).
**How to avoid:** Consider switching to `Promise.allSettled` on the NEW query only — or at minimum wrap the outcomes fetch in a try/catch that returns `[]` on failure, so the page still renders the rest of the dashboard. Follow the pattern Phase 1 already established (bridge_outcomes fan-out line 690 is already inside the unified `Promise.all` — a failure there already takes out the dashboard). Phase 5 should NOT make this worse.
**Warning signs:** `GET /allocations` 500s with "Cannot read property x of undefined" when outcomes query fails.

### Pitfall 8: LAYOUT_VERSION bump resets ALL user customizations
**What goes wrong:** From `useDashboardConfig.ts:18–21`, `LAYOUT_VERSION !== parsed.layoutVersion` triggers a reset to DEFAULT_LAYOUT — not a merge. Users with custom widget arrangements lose ALL customization.
**How to avoid:** D-18 requires the widget to be visible on first load for existing allocators, and the cleanest mechanism is the LAYOUT_VERSION bump. Accept the trade-off. Document prominently in the plan summary. Consider a follow-up P2 issue: migrate layout-persistence to a MERGE strategy (add new default tiles to user layout, don't replace).
**Warning signs:** Users complain about losing their dashboard setup. Demo-post-mortem feedback.

### Pitfall 9: Next.js 16 route-handler param shape
**What goes wrong:** AGENTS.md explicitly warns "This is NOT the Next.js you know." In Next.js 16, dynamic route params may be async (`params: Promise<{id: string}>`). Writing the curves route as `({params}: {params: {id: string}})` from training data would compile but emit a deprecation warning — or fail at runtime.
**How to avoid:** Before writing the route, read `node_modules/next/dist/docs/` specifically for dynamic route handlers. The Phase 1 routes (`src/app/api/bridge/outcome/route.ts`) use a non-dynamic path so aren't a precedent. The correct signature is:
```ts
export const GET = withAuth(async (
  req: NextRequest,
  user: User,
  { params }: { params: Promise<{ id: string }> },  // Next.js 16: async params
): Promise<NextResponse> => {
  const { id } = await params;
  ...
});
```
**Warning signs:** TypeScript error on params destructure; `undefined` id at runtime; deprecation warning in dev console.

### Pitfall 10: `withAuth` wrapper shape for dynamic route
**What goes wrong:** Phase 1 `src/app/api/bridge/outcome/route.ts` uses `withAuth(async (req, user) => ...)`. For a dynamic route, the handler takes a third `context` arg that must be forwarded. If the `withAuth` helper doesn't pass through `context`, `params` is lost.
**How to avoid:** Inspect `src/lib/api/withAuth.ts` before writing the route. If it signatures as `(req, user)` only, Phase 5 needs a variant `withAuthDynamic` or direct route handler. (Researcher did not verify `withAuth` shape — flag to planner for inspection during wave 1.)
**Warning signs:** `params` is undefined in route handler body.

---

## Validation Architecture

> nyquist_validation is enabled in `.planning/config.json`. This section drives the VALIDATION.md template the planner will instantiate.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 + React Testing Library 16.3.2 + jsdom |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx src/lib/outcomes-kpi.test.ts src/lib/bridge-outcome-label.test.ts` |
| Full suite command | `npm test` |
| Coverage gate | None enforced on TypeScript (intentional per TESTING.md line 487). Targeted invariants via `audit-coverage.test.ts` serve this purpose. |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASHBOARD-01 | Widget appears in `WIDGET_REGISTRY` + `WIDGET_COMPONENTS` barrel + DEFAULT_LAYOUT with correct slug | unit (barrel smoke test) | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx -t "Barrel export"` | ❌ Wave 0 |
| DASHBOARD-02 | KPI strip renders 3 values in Geist Mono 13px tabular-nums; win rate/avg delta computed per D-11/D-12 filters | component + unit (`computeOutcomeKPIs` pure fn) | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx -t "OutcomesKPIStrip"; npx vitest run src/lib/outcomes-kpi.test.ts` | ❌ Wave 0 |
| DASHBOARD-03 | Timeline renders 1 row per outcome, correct columns, sort newest-first, status pill variants, em-dash on rejected "Best Delta" | component | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx -t "OutcomesTimeline"` | ❌ Wave 0 |
| DASHBOARD-04 | Expanded row renders 3 columns with delta numbers; sparkline mounts on expand; lazy fetch fires exactly once per row; cached on re-expand | component + integration | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx -t "OutcomesExpandedPanel"` | ❌ Wave 0 |
| DASHBOARD-05 | Empty state shows literal copy + CTA; click navigates to `/holdings` | component | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx -t "Empty state"` | ❌ Wave 0 |
| DASHBOARD-06 | Loading = 5 skeletons; Error = retry button; Partial = pending pill + skeleton sparkline | component | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx -t "State matrix"` | ❌ Wave 0 |
| D-11/D-21 (math parity) | `computeOutcomeKPIs` output matches shared golden fixture exactly | unit + golden | `npx vitest run src/lib/outcomes-kpi.test.ts -t "parity fixture"` | ❌ Wave 0 |
| D-15 (data fan-out) | `getMyAllocationDashboard` returns new `outcomes` field shaped per `BridgeOutcome[]` with strategy name embed | unit (mock-store + buildChain) | `npx vitest run src/lib/queries.my-allocation.test.ts -t "outcomes"` | partially ❌ — extend existing file |
| D-16 (lazy curves endpoint) | Route returns 401 without auth; 404 for other-allocator's outcome; 200 with rebased arrays + correct windowing | route-handler | `npx vitest run src/app/api/bridge/outcome/\[id\]/curves/route.test.ts` | ❌ Wave 0 |
| D-16 RLS | Owner-read on `bridge_outcomes`; admin client required for `returns_series`; foreign allocator gets 404 | live-DB integration (HAS_LIVE_DB gated) | `npx vitest run src/__tests__/outcomes-curves-rls.test.ts` | ❌ Wave 0 (optional — follow Phase 1 precedent of gated live-DB) |

### Sampling Rate

- **Per task commit:** `npx vitest run <impacted test file>` — component or unit test only, < 5s.
- **Per wave merge:** `npm test` — full Vitest suite, currently ~12s for 117 files.
- **Phase gate:** Full suite green + `npm run typecheck` exit 0 + `npm run lint` exit 0 before `/gsd-verify-work`.
- **No E2E required:** Phase 5 is within the 150 LOC "small change" threshold where Playwright is optional per repo convention. An E2E smoke covering "render widget + expand first row" COULD be added but is Claude's Discretion. Recommend deferring to Phase 6+ (when cross-widget interactions mature).

### Wave 0 Gaps

- [ ] `src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx` — component + state-matrix tests for OutcomesWidget, OutcomesKPIStrip, OutcomesTimelineRow, OutcomesExpandedPanel, and barrel smoke test. Covers DASHBOARD-01..06.
- [ ] `src/lib/outcomes-kpi.ts` + `src/lib/outcomes-kpi.test.ts` — pure function `computeOutcomeKPIs(outcomes)` + ~8 cases including the shared golden fixture (D-11/D-21 parity).
- [ ] `tests/fixtures/outcomes-kpi-parity.json` — shared golden fixture consumed by both TS test (now) and Python test (follow-up, out of phase scope but documented).
- [ ] `src/lib/bridge-outcome-label.test.ts` — EXTEND with ~8 cases for new `deriveOutcomeStatusPill` helper.
- [ ] `src/app/api/bridge/outcome/[id]/curves/route.ts` + `route.test.ts` — lazy curves endpoint + ~6 test cases (auth, not-found, successful fetch, windowing, rebase math, empty-series fallback).
- [ ] `src/lib/queries.my-allocation.test.ts` — EXTEND with ~3 cases for new outcomes fan-out (with/without rows, with embedded strategy name, pending rows).
- [ ] (OPTIONAL) `src/__tests__/outcomes-curves-rls.test.ts` — HAS_LIVE_DB-gated integration test proving RLS blocks foreign-allocator access (Phase 1 precedent: `bridge-outcomes-rls.test.ts`).

**No framework install needed** — Vitest + RTL already installed; all deps are in place.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sparkline charts | Custom SVG paths or D3 | Recharts `<LineChart>` with hidden axes | Already pinned (`^3.8.1`), 6+ widgets use this pattern. Recharts 3.x handles responsive sizing, scale inversion, null-gap interpolation. |
| Skeleton loader | Custom keyframe animation library | Inline `animate-pulse bg-[#E2E8F0]` divs | Tailwind v4 `animate-pulse` is the existing convention (DashboardGrid.tsx line 23). Adding a skeleton lib = extra deps + bigger bundle. |
| Date formatting ("Apr 18, 2026") | Manual `Date.toLocaleDateString` calls inline | `formatDate` helper in `src/lib/utils.ts` (if exists; else write once) | Consistency across widgets. Also avoids timezone-on-DATE-column confusion. |
| Fetch caching | Add react-query / SWR | `useRef<Map<string, T>>` session cache | No existing widget uses a fetch lib; bundle stays small. Curves only update after daily cron, so cache invalidation isn't needed within a session. |
| Table expand/collapse | TanStack Table expand extension | Plain HTML `<table>` + `<tr colSpan>` pattern | PositionsTable.tsx precedent. One expand = one state variable. Zero deps. |
| Status pill styling | Reinvent toned pill shapes | Inline Tailwind classes per UI-SPEC §Status Pill Anatomy | UI-SPEC locks all 4 variants with `bg-rgba(...)` + text color. Copy the classes. |
| Percent/currency formatting | Inline `.toFixed(1) + "%"` | `formatPercent` from `src/lib/utils.ts` | Existing widgets use this; null-handling built in. |
| Icon glyphs | SVG files or icon library | Unicode chevron `›` + Geist Mono rendering | Entire dashboard uses Unicode glyphs (PositionsTable.tsx line 244–247 is the one exception — SVG for gear). Keeps things consistent. |
| Golden fixture | One-off inline object per test | Shared JSON file at `tests/fixtures/outcomes-kpi-parity.json` | D-21 cross-runtime parity gate; future Phase 4 test can import the same file. Single source of truth. |

**Key insight:** Every pattern Phase 5 needs already exists in the codebase. The entire implementation should be < 600 LOC across ~6 new files + extensions to 3 existing files.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + test | ✓ | 20.x (project target) | — |
| npm | Dep management | ✓ | 10.x | — |
| TypeScript (`tsc`) | Typecheck | ✓ | 5.x | — |
| Next.js | Framework | ✓ | ^16.2.3 | — |
| React | UI | ✓ | 19.x | — |
| Supabase | DB + RLS | ✓ | Live prod (khslejtfbuezsmvmtsdn) | — |
| Recharts | Sparklines | ✓ | ^3.8.1 (pinned) | — |
| Vitest | Test runner | ✓ | ^4.1.2 | — |
| @testing-library/react | Component tests | ✓ | ^16.3.2 | — |
| HAS_LIVE_DB env | Integration test (optional) | conditional | `SUPABASE_SERVICE_ROLE_KEY` present in `.env.local` on developer machine; absent in CI | `it.skipIf(!HAS_LIVE_DB)` graceful skip — matches Phase 1 precedent. |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate tab for history/analytics surfaces | In-grid widget per topic | Sprint 4 onwards; 39 widgets in production | Phase 5 locked into this — CONTEXT §Key Decisions "Widget-in-grid for Outcomes (not new tab)". |
| Custom chart components | Recharts 3.x with hidden axes variant | Sprint 3–4 | Zero new deps for Phase 5 sparklines. |
| Server-scoped SWR / react-query | Server Component → `WidgetProps.data` prop | Sprint 2+ | Keeps bundles lean; Phase 5 follows. |
| Inline icon components | Unicode glyphs | Sprint 1+ | Zero icon-library deps; consistent rendering. |

**No deprecated patterns to avoid** in Phase 5's scope.

---

## Code Examples

All code snippets in §Technical Approach above are verified against the sources listed. No hallucinated API surface.

**Particularly important literal excerpts:**

- `bridge-outcome-label.ts::deriveOutcomeLabel` (verified source): Phase 5's "Best Available Delta" cell should call it directly for allocated rows. Rejected rows bypass to em-dash per D-03.
- `queries.ts::getMyAllocationDashboard` (lines 599–792): the extension point. Phase 5 adds a new Promise.all entry for `bridge_outcomes` SELECT. Note: `bridge_outcomes` is already in the fan-out (lines 688–695) but is currently fetched ONLY for eligibility gating — Phase 5 needs the FULL row set (joined with strategy name) surfaced into `WidgetProps.data.outcomes`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `strategy_analytics.returns_series` contains daily entries (or near-daily; gaps acceptable) | Q2, Pitfall 5 | If series is weekly or monthly, sparklines look coarse. MEDIUM risk — verify against a published strategy by quick SQL SELECT during Wave 0. |
| A2 | `withAuth` wrapper passes `context` through to the handler for dynamic routes | Pitfall 10 | If not, Phase 5 route needs a different auth pattern. LOW risk — easily verified by reading `src/lib/api/withAuth.ts` (Wave 1). |
| A3 | `LAYOUT_VERSION` bump reset is an acceptable user-facing side effect | Q5, Pitfall 8 | User feedback could say "I lost my layout." MEDIUM risk — but this is D-18's explicit trade-off. Document in summary. |
| A4 | `router.refresh()` after outcome edit via Holdings banner will re-fetch dashboard data (and thus the outcomes widget will update) | Pitfall 4 | If Holdings banner doesn't call `router.refresh()`, widget stays stale until navigation. LOW risk — Phase 1 plan 01-03 summary indicates `router.refresh()` is wired, but worth a Wave 3 smoke test. |
| A5 | Admin client convention (queries.ts:619–620 comment) correctly captures the intent for `returns_series` access, even though no explicit REVOKE is in migrations | Pitfall 6 | If REVOKE is silently present via a different mechanism (e.g., table GRANT), user-scoped client might fail for published strategies too. MEDIUM risk — the safer path is admin client per ADR-0003 §(b). |
| A6 | Phase 4 `feedback_engine.py` filter rules are stable and won't change before Phase 5 ships | Q4, D-21 | If Phase 4 adds a new filter (e.g., `require percent_allocated >= 2%`), parity breaks silently. LOW risk — Phase 4 is complete as of 2026-04-19; next iteration is Phase 6+ scope. The shared fixture guards against it. |

---

## Unknowns / Open Questions

1. **D-20 semantic re-interpretation (HIGH priority for planner).** The CONTEXT.md locked decision says "original-strategy resolution path" but research reveals the concept isn't persisted. The planner MUST get user sign-off on one of three options (see Q1) BEFORE Wave 1 starts:
   - Option A (recommended): drop the Original column; timeline shows 4 columns; expanded sparkline is single-line.
   - Option B: reinterpret Original = worst current holding (semantic drift warning).
   - Option C: add migration 061 with `original_strategy_id` backfill (out of current phase scope).
   - **What the planner should do:** Put this at the top of `05-01-PLAN.md` as a blocking prerequisite. Recommend a short back-to-discuss step: `/gsd-discuss-phase 5 --addendum` to log a D-20-RESOLUTION decision before planning proceeds.

2. **Is the "View Holdings" CTA destination correct?** UI-SPEC empty state CTA is `/holdings` — but I could not find a `/holdings` route in `src/app/(dashboard)/`. The allocation dashboard lives at `/allocations`. Planner should verify OR change to `/allocations#holdings` (anchor into PositionsTable widget) OR `/allocations` without anchor.

3. **Rate limit key for `/api/bridge/outcome/[id]/curves`?** Claude's Discretion recommendation is `bridge_outcome_curves:${user.id}` via `userActionLimiter`. Planner should confirm — if the existing `userActionLimiter` budget is tight (many routes share it), a dedicated limiter key / bucket may be warranted.

4. **Should the lazy-curves endpoint pre-rebase server-side, or return raw NAV and let the client rebase?** Recommendation: server-side rebase (Q2 response shape shows `nav: number` as rebased). Rationale: client never sees raw NAV, which matches existing column-level-REVOKE discipline. But the endpoint is TECHNICALLY already behind admin-client + auth, so either works. Planner's call.

5. **Is there a `formatDate` utility in `src/lib/utils.ts`?** Not checked. Multiple widgets render dates ("Apr 18, 2026" style); there's likely a helper. If not, Phase 5 adds one (minimal addition).

---

## Recommended Plan Breakdown

### Should Phase 5 be 1 plan or 2 plans?

**Recommendation: ONE plan (`05-01`), structured in 4 waves internally.** Rationale:

- ROADMAP.md line 100 locks "1 plan" for Phase 5.
- The total surface area (~6 new files + 3 extensions + 1 test fixture) is well within a single-plan scope (Sprint 8 Plan 04-01 shipped 486 tests + migration 063 + lazy seam + feedback_engine.py in ONE plan — Phase 5 is smaller).
- Splitting into "backend (route + query) vs frontend (widget)" would serialize unnecessarily; the backend deliverables are < 100 LOC.

### Wave structure (inside `05-01`)

**Wave 0 — Foundation + D-20 resolution (blocking everything else):**
- [blocking] Resolve D-20 via user sign-off (Option A/B/C) — outside-plan discuss-phase step.
- Create failing test files (TDD RED phase):
  - `src/lib/outcomes-kpi.test.ts` (~8 cases + parity fixture)
  - `tests/fixtures/outcomes-kpi-parity.json`
  - `src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx` (~12 cases across components)
  - `src/app/api/bridge/outcome/[id]/curves/route.test.ts` (~6 cases)
  - Extend `src/lib/queries.my-allocation.test.ts` (+3 cases)
  - Extend `src/lib/bridge-outcome-label.test.ts` (+8 cases for `deriveOutcomeStatusPill`)

**Wave 1 — Data & types (depends: Wave 0):**
- `src/lib/outcomes-kpi.ts` — `computeOutcomeKPIs()` pure function (GREEN Wave 0 unit tests).
- Append `deriveOutcomeStatusPill` to `src/lib/bridge-outcome-label.ts` (GREEN Wave 0 label tests).
- Extend `src/lib/queries.ts::getMyAllocationDashboard` — add outcomes fan-out with strategy name embed. Extend `MyAllocationDashboardPayload.outcomes: Outcomes[]`.
- Create `src/app/api/bridge/outcome/[id]/curves/route.ts` — GET handler with auth + admin client + rebase (GREEN route tests).
- Optional: `src/__tests__/outcomes-curves-rls.test.ts` — HAS_LIVE_DB-gated RLS integration.

**Wave 2 — Widget components (depends: Wave 1):**
- `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx` ("use client"; container; expand-state management).
- `OutcomesKPIStrip.tsx` (pure prop-driven KPI strip; reuses `computeOutcomeKPIs`).
- `OutcomesTimelineRow.tsx` (single row + caret + conditional expanded sub-tr).
- `OutcomesSparkline.tsx` (thin Recharts wrapper).
- `OutcomesExpandedPanel.tsx` (3-column grid + lazy-fetch effect + cache ref).
- Register widget: extend `widget-registry.ts`, `widgets/index.ts`, `dashboard-defaults.ts` (bump LAYOUT_VERSION).
- Extend `types.ts::WidgetMeta.category` union with `"outcomes"`.

**Wave 3 — State matrix + a11y + polish (depends: Wave 2):**
- Loading state (5 skeleton rows).
- Empty state (copy + CTA).
- Error state (widget-level + lazy-curves row-level).
- Partial state (pending pill + skeleton sparkline per column).
- a11y pass: `aria-expanded`, `aria-controls`, `aria-label` on carets + skeleton `aria-label`.
- Manual browser smoke test (if executor supports). OR: automated smoke via Playwright if repo convention requires.
- Typecheck + lint + full vitest run.

### If the planner wants 2 plans (not recommended)

- Plan 05-01: Data layer (Waves 0 + 1). Ships `outcomes-kpi.ts`, `deriveOutcomeStatusPill`, queries extension, curves endpoint, all tests GREEN.
- Plan 05-02: UI layer (Waves 2 + 3, deps: 05-01). Ships widget components + registration + state matrix.

Downside: serializes work. Two sets of commits, two deploys, two CI runs. Given the total size (~600 LOC), overhead isn't justified.

---

## Sources

### Primary (HIGH confidence)

- **Context7 / MCP:** Not needed — all library APIs were verified against in-repo code patterns that exercise them.
- **Repo files verified line-by-line:**
  - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md`
  - `.planning/phases/05-outcomes-dashboard/05-UI-SPEC.md`
  - `.planning/phases/01-outcome-tracker/01-CONTEXT.md` (D-12, D-14 label semantics)
  - `.planning/phases/04-feedback-loop/04-CONTEXT.md` (D-08 filter rules)
  - `.planning/REQUIREMENTS.md` (DASHBOARD-01..06)
  - `.planning/ROADMAP.md` (Phase 5 goal, SC1..SC5)
  - `supabase/migrations/059_bridge_outcomes.sql` (schema + RLS)
  - `supabase/migrations/060_bridge_outcome_cron.sql` (returns_series format + rebase math)
  - `supabase/migrations/011_perfect_match.sql` (match_decisions/candidates/batches)
  - `supabase/migrations/001_initial_schema.sql` (strategy_analytics.returns_series column)
  - `src/lib/bridge-outcome-schema.ts` (BridgeOutcome type + REJECTION_REASONS)
  - `src/lib/bridge-outcome-label.ts` (deriveOutcomeLabel)
  - `src/lib/queries.ts:599–792` (getMyAllocationDashboard)
  - `src/app/(dashboard)/allocations/lib/widget-registry.ts` (WIDGET_REGISTRY)
  - `src/app/(dashboard)/allocations/widgets/index.ts` (WIDGET_COMPONENTS)
  - `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts` (DEFAULT_LAYOUT, LAYOUT_VERSION)
  - `src/app/(dashboard)/allocations/lib/types.ts` (WidgetProps, WidgetMeta)
  - `src/app/(dashboard)/allocations/hooks/useDashboardConfig.ts` (load/persist behavior)
  - `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` (sparkline precedent)
  - `src/app/(dashboard)/allocations/widgets/performance/RollingSharpe.tsx` (LineChart + Line pattern)
  - `src/app/(dashboard)/allocations/widgets/meta/CustomKpiStrip.tsx` (KPI strip layout)
  - `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx` (expand pattern)
  - `src/app/(dashboard)/allocations/widgets/positions/positions.test.tsx` (table test conventions)
  - `src/app/(dashboard)/allocations/widgets/performance/performance.test.tsx` (widget test conventions)
  - `src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx` (Phase 1 label reuse)
  - `src/app/(dashboard)/allocations/components/TileWrapper.tsx` (WidgetErrorBoundary)
  - `src/app/(dashboard)/allocations/components/DashboardGrid.tsx` (WidgetSkeleton convention)
  - `src/app/api/bridge/outcome/route.ts` (POST pattern + withAuth + admin client use)
  - `src/app/api/admin/match/send-intro/route.ts` (send_intro_with_decision shape)
  - `src/lib/analytics-client.ts:183–198` (findReplacementCandidates call)
  - `analytics-service/routers/portfolio.py:797–880` (portfolio-bridge statelessness)
  - `analytics-service/services/feedback_engine.py` (Phase 4 filter rules)
  - `src/components/portfolio/ReplacementPanel.tsx` (Bridge V1 UI — no persistence)
  - `docs/architecture/adr-0003-three-client-supabase.md` (admin client conventions)
  - `.planning/codebase/TESTING.md` (Vitest + RTL patterns)

### Secondary (MEDIUM confidence)
- **Comment in `src/lib/queries.ts:617–620`** claiming column-level REVOKE on `daily_returns` per migration 010: the REVOKE was NOT found by grep of migrations/ directory. The convention (admin-client usage) is nonetheless the correct path per ADR-0003 §(b). Flagged in Pitfall 6.

### Tertiary (LOW confidence — none)
None. All critical claims are backed by primary sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (Recharts, React, Vitest, Supabase all verified in repo)
- Architecture patterns: HIGH (3 precedents per pattern: PositionsTable + CustomKpiStrip + DrawdownChart cover table, KPI strip, and sparkline)
- Pitfalls: HIGH on data-layer pitfalls (returns_series format, DATE column, Promise.all fan-out); MEDIUM on framework pitfalls (Next.js 16 params, withAuth shape — verifiable during Wave 1)
- D-20 path: CRITICAL FINDING — no clean answer in schema; planner must resolve with user before Wave 1

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (30 days for stable infrastructure; re-verify if Phase 4 feedback_engine filter rules change)

---

## RESEARCH COMPLETE
