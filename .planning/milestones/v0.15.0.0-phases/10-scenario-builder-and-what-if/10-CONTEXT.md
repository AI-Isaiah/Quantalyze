# Phase 10: Scenario Builder and What-If — Context

**Gathered:** 2026-04-25
**Status:** Ready for research & planning
**Prior-phase pickup:** Phase 06 (allocator_holdings + poll_allocator_positions live), Phase 07 (dashboard rewired to real data + tabbed `/allocations` + allocator_equity_snapshots with per-symbol `breakdown` jsonb), Phase 08 (notes multi-scope + buildHoldingScopeRef), Phase 09 (Bridge live against real holdings + `ScenarioFlaggedHoldingsList.tsx` read-only seed + `holding-outcome-adapter.ts` + match_decisions.original_holding_ref XOR + ENGINE_VERSION v2.1.0), and Phase 09.1 (Allocator Dashboard UI refresh — 6-tab AllocationsTabs, AllocationDashboardV2 behind `allocations.ui_v2` feature flag, KpiStrip 5-cell rewrite, SVG EquityChart, BridgeDrawer 2-stage, "+ Allocation" button routing to `?tab=scenario`, LAYOUT_VERSION 4) are all shipped. Phase 10 grows the Phase 09 read-only flagged list into the full Scenario composer on top of the Phase 09.1 v2 shell.

<domain>
## Phase Boundary

Grow the existing `ScenarioFlaggedHoldingsList` (Phase 09 D-08 read-only seed under the Scenario tab of `/allocations`) into the full Scenario composer: toggle current holdings on/off, add Bridge-recommended OR browse-selected verified strategies, see projected KPI / equity-curve / drawdown deltas vs the live baseline (using the existing `src/lib/scenario.ts::computeScenario` pipeline), and commit each diff through the existing Bridge outcome-recording flow (`AllocatedForm` for additions, `RejectedForm` for removals — both via `holding-outcome-adapter.ts`). Scenario state is client-side + localStorage; "Reset" reinitializes from current live holdings; no DB persistence in v0.15. Lives entirely under the `allocations.ui_v2` feature flag (Phase 09.1 D-17) — legacy v1 dashboard ships the Phase 09 read-only flagged list unchanged.

**In scope:**
- Scenario composer body replacing `ScenarioStub` / `ScenarioFlaggedHoldingsList` body when the Scenario tab is active under `ui_v2` (Phase 09 D-09 hand-off): unified composition list with toggle controls + per-row weight inputs.
- New `src/app/(dashboard)/allocations/lib/scenario-state.ts` (or similar) — typed scenario draft state (holdings toggle map + added-strategies array + per-row weights), default-init from live holdings, renormalization on toggle/add, localStorage resume.
- New `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` — projects `holdingsSummary[] + holdingReturnsByScopeRef + addedStrategies[]` into `StrategyForBuilder[]` for `computeScenario()` (D-01).
- Server payload extension: `getMyAllocationDashboard` adds `holdingReturnsByScopeRef: Record<scope_ref, DailyPoint[]>` reconstructed once from `allocator_equity_snapshots.breakdown` (D-04).
- New `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` (right slide-over ~620px, search + filter pills + mandate-fit pill per row) (D-05/D-06/D-08).
- KpiStrip variant (or scenario-aware mode) showing projected primary + delta badge (D-13); preserves Phase 07 warmup/stale fallbacks.
- EquityChart overlay path — second-series prop carrying scenario-projected equity curve alongside the live baseline (D-14); reuses Phase 09.1 D-10 holding-overlay code path.
- Sticky footer at the bottom of the Scenario tab body: diff count + delta summary + Reset + Commit primary CTA (D-12).
- Commit drawer (right slide-over) — grouped diff sections (Holdings removed / Strategies added / Weight changes) with per-row inline `RejectedForm` / `AllocatedForm` and a single "Submit all" gesture (D-09/D-15).
- Migration relaxing Phase 09's match_decisions XOR — adds `kind`-based discriminator OR replaces the XOR with a triple-permitted state to allow `voluntary_remove` (suggested_strategy_id NULL) and `voluntary_add` (both original_* NULL) decision rows; ADR-0023 sync in the same commit (D-10/D-11).
- "Add to scenario" CTA wired into the `BridgeDrawer` candidate cards (Phase 09.1 D-16) and the inline Bridge-banner row CTA, replacing/supplementing the current "Send intro" entry path with a "Add to scenario" alternative — exact placement is researcher's call.
- Vitest coverage on: scenario-adapter shape invariants, toggle/renormalization math, browse drawer search + filters + mandate-fit pill, commit drawer per-diff form wiring, KpiStrip delta-badge rendering, equity overlay rendering, localStorage resume invalidation, voluntary-remove + voluntary-add migration RLS regression, schema XOR relaxation regression.

**Out of scope (Phase 11 or deferred):**
- DB persistence of scenario drafts — explicit v0.15 deferral (SCENARIO-08).
- Multi-scenario / named-scenario library — single draft only.
- Scenario-fit-score (running scenario through the Bridge engine `score_candidates()` for a "scenario quality" rating) — pure client-side projection only in v0.15.
- Mandate-aware add-strategies filter as a default-on toggle — mandate signals via a per-row pill only (D-08), no filtering applied.
- Stress-testing / scenario regimes (drawdown stress, vol shock) — Sprint 10+ analytics deferral.
- Non-replacement scenario semantics where multiple strategies replace one holding — single weight inputs only.
- Cash bucket / non-zero idle weight — v0.15 ships toggle-off → renormalize only (D-02); no cash row.
- Migration of existing `/scenarios` standalone sandbox to share components — kept independent (D-07).
- Mobile responsive polish (per PROJECT.md).
- New widget tile on the Performance tab for "scenario summary" — Scenario tab is the home; Performance stays focused on live-state monitoring.

</domain>

<prior_decisions_inherited>
## Inherited from Phases 06 / 07 / 08 / 09 / 09.1 (locked — do NOT re-open)

- **Tab shell + URL semantics (Phase 07 D-04, Phase 09.1 D-05):** `/allocations?tab=scenario`; `searchParams.get("tab")` derived every render in `AllocationsTabs.tsx`; `performance` legacy alias deleted on mount; silent fallback for unknown values. Phase 10 inherits unchanged — only the Scenario tab body changes.
- **Holding identity (Phase 06 D-16, Phase 08 D-08, Phase 09 D-02):** `holding:{venue}:{symbol}:{holding_type}` text scope_ref. Used identically in `user_notes`, `match_decisions.original_holding_ref`, scenario state keys, and `holdingReturnsByScopeRef`. NEVER collides with strategy UUIDs.
- **Bridge V2 component contracts (Phase 01, Phase 05, Phase 09 D-11):** `BridgeOutcomeBanner`, `AllocatedForm`, `RejectedForm`, `OutcomeRecordedRow` — strategy-shaped props, NOT modified. `holding-outcome-adapter.ts` (Phase 09) maps `(flaggedHolding, topCandidate, matchDecision)` → strategy-shaped props. Phase 10 reuses this adapter for the commit-drawer per-row forms; voluntary diffs (D-10/D-11) require a thin extension of the adapter for synthetic match_decision shapes.
- **Payload shape (Phase 07/09):** `holdingsSummary[]`, `flaggedHoldings[]`, `matchDecisionsByHoldingRef{}`, `existingOutcomesByHoldingRef{}`, `equityDailyPoints`, `snapshotCount`, `allKeysStale`, `minHistoryDepthMonths`, `activeVenues`, `strategies[]` already on `MyAllocationDashboardPayload`. Phase 10 ADDS `holdingReturnsByScopeRef: Record<scope_ref, DailyPoint[]>` (D-04).
- **Scenario math (PR 3 / src/lib/scenario.ts):** `computeScenario`, `buildDateMapCache`, `computeStrategyCurve`, `computeCompositeCurve`, `computeFavoritesOverlayCurve` — five behaviors pinned by `scenario.test.ts` regression suite (per-strategy include-from dates, sample covariance, abs-correlation averaging, Sortino-by-n, downsampled equity curve). Phase 10 reuses verbatim via the unified-shape adapter (D-01); ANY behavior change is a regression. SCENARIO-05 marked complete in REQUIREMENTS.md on these foundations.
- **Existing /scenarios sandbox + ScenarioBuilder.tsx:** Kept independent from the Allocations Scenario tab (D-07). Same `computeScenario` engine, different hosting context. No code unification in Phase 10.
- **Engine version + recompute triggers (Phase 09 D-17):** `ENGINE_VERSION = v2.1.0`. No engine version bump in Phase 10 — scenario projection is pure client-side; `score_candidates()` is not called from the Scenario tab.
- **`+ Allocation` header CTA (Phase 09.1 D-20):** Already routes to `/allocations?tab=scenario`. No change — this is now the entry point to the composer.
- **Feature flag (Phase 09.1 D-17):** `allocations.ui_v2` localStorage flag gates V2 dashboard. Phase 10's full composer ships under THIS flag — legacy v1 keeps the Phase 09 read-only flagged-list body unchanged. Phase 10 does NOT introduce a separate scenario_v2 flag; it inherits the v2 cohort.
- **LAYOUT_VERSION = 4 (Phase 09.1 D-02):** Phase 10 does NOT bump. The Scenario tab is full-width body content, not a widget grid. No `react-grid-layout` interaction.
- **Audit taxonomy ADR-0023:** Same-commit sync convention. Migration adding voluntary_* match_decision kinds (or relaxing the XOR) lands in one commit with an ADR-0023 update. Existing `match.decision.*` audit kinds carry voluntary diffs unchanged (Phase 09 D-14 precedent).
- **Migration self-verifying DO block:** Every migration ends with `DO $$` asserting schema invariants + RLS + trigger presence (Phase 06/07/08/09 precedent). Phase 10 migration follows suit.
- **Three-tier RLS on match_decisions + bridge_outcomes:** Owner + admin + service_role — already in place; voluntary_* rows inherit the same policies (no new policy).
- **Daily delta cron `compute_bridge_outcome_deltas()`:** Phase 09 migration 073 added the holding-ref branch. Voluntary commits (D-10/D-11) re-use that branch verbatim — voluntary_remove is a `original_holding_ref IS NOT NULL` row; voluntary_add references a strategy_id (researcher confirms whether the existing strategy-side branch needs an extension or is already correct for null-original add cases).
- **No Edge Functions / Edge Runtime / non-default runtime decisions:** Phase 10 stays Node.js / standard Next.js App Router (per AGENTS.md Next 16 + Fluid Compute defaults).
- **No new npm deps preferred:** Phase 09 + Phase 09.1 both shipped with zero new deps. Phase 10 should hold this — `src/lib/scenario.ts` math is pure TS; the browse drawer can reuse existing primitives; commit drawer reuses existing form components.
- **Banned packages (CLAUDE.md):** `axios`, `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai`. Use native `fetch()` / existing supabase-js path.

</prior_decisions_inherited>

<decisions>
## Implementation Decisions

### Composition state model

- **D-01: Unified state via adapter.** Holdings cast to `StrategyForBuilder` shape via a new `scenario-adapter.ts`: `id = "holding:{venue}:{symbol}:{holding_type}"` (matches Phase 09 D-02 verbatim), `daily_returns` from `holdingReturnsByScopeRef[scope_ref]`, `name` = symbol, `codename = null`, `strategy_types = []`, `markets = [venue]`, `start_date` = first date in returns. Added strategies pass through unchanged from `strategies[]`. Single combined `StrategyForBuilder[]` array fed into `computeScenario()` verbatim — ZERO change to `src/lib/scenario.ts`. Behaviors preserved by the existing scenario.test.ts pins (sample covariance, abs-correlation averaging, etc.).

- **D-02: Toggle-off → renormalize active set.** When a holding is toggled off, its weight is removed and the remaining active rows' weights are scaled proportionally so they sum to 1.0. Matches `src/lib/scenario.ts` behavior note #1 (per-strategy include-from dates with renormalization on the active subset). No "incomplete scenario" state; no cash row.

- **D-03: Add-default = context-aware.**
  - **Bridge "Add to scenario"** (from a flagged-holding's candidate card OR the BridgeDrawer's confirm stage): the new strategy takes the FLAGGED HOLDING's current weight (the natural swap semantic — "replace this 12% holding with this strategy at 12%"). The flagged holding remains in the composition unless the allocator also toggles it off (so the allocator can opt to dilute, not just swap).
  - **Browse-add** (from `StrategyBrowseDrawer`): the new strategy takes a weight equal to `1 / (active_set_size + 1)` and the existing active set's weights are renormalized to occupy the remaining `1 - 1/(active_set_size + 1)` proportionally. Maintains sum = 1.0 invariant.

- **D-04: Server-side payload prep for holding returns.** Extend `getMyAllocationDashboard(userId)` in `src/lib/queries.ts` with `holdingReturnsByScopeRef: Record<scope_ref, DailyPoint[]>` reconstructed from `allocator_equity_snapshots.breakdown` jsonb. ONE pass per dashboard load — same source Phase 09 engine reconstructs (`_load_allocator_context()` in `analytics-service/routers/match.py`). Reconstruction logic mirrors Phase 09 D-01 (per-day per-symbol value_usd differenced to a daily return series, ascending by asof). Researcher: extract a shared TS reconstructor or duplicate; the Python side stays canonical for engine math.

### Add-strategies UX

- **D-05: Two discovery surfaces.**
  1. Bridge inline "Add to scenario" CTA on flagged-holding candidate cards (in `ScenarioFlaggedHoldingsList`-evolved body and in `BridgeDrawer` confirm stage).
  2. "Browse strategies" header button on the Scenario tab opens `StrategyBrowseDrawer` for non-Bridge-recommended adds.

- **D-06: `StrategyBrowseDrawer` shape.** Right slide-over (~620px, max-width 96vw), pattern-match `BridgeDrawer` from Phase 09.1 D-16. Header: text search by `alias` and `codename`. Filter pills below: markets (multi-select), strategy_types (multi-select), mandate-fit threshold (toggle). Body: scrollable card list, one verified strategy per row, primary "Add" button per row. Multi-add session-able — drawer stays open after adds; close via backdrop / X. Strategy data source: existing `getStrategiesForBuilder` query (or equivalent — researcher confirms the canonical "all verified strategies" query path).

- **D-07: `/scenarios` standalone sandbox kept independent.** `src/app/(dashboard)/scenarios/page.tsx` and `src/components/scenarios/ScenarioBuilder.tsx` continue to serve the strategies-only experimentation use case (no portfolio context). Add a single help-text cross-link from the Allocations Scenario tab empty state ("Want to compare strategies without your portfolio? Try the Strategy Sandbox →") and from the standalone /scenarios page back to /allocations?tab=scenario. NO component refactor; NO shared composer file.

- **D-08: Mandate-fit pill per row in `StrategyBrowseDrawer`.** Each row card shows a small pill (green / yellow / red) computed from existing `mandate_fit_score` on the strategy (Phase 03 SCORING). Threshold mapping: ≥ 0.7 green, 0.4 ≤ x < 0.7 yellow, < 0.4 red. Pill is visible BEFORE add. Allocator is NEVER blocked from adding any verified strategy. No pre-filter on mandate-fit — pill is informational.

### Commit-through-Bridge mapping

- **D-09: Commit flow = batch summary drawer with per-diff inline forms + single "Submit all" gesture.** On clicking "Commit scenario" (sticky footer per D-12), open a right slide-over `ScenarioCommitDrawer` (~720px) showing the diff summary with `RejectedForm` / `AllocatedForm` embedded per row. Allocator fills each form (most can use defaults — date today, size = scenario weight, no notes). One "Submit all" button at the bottom fires the inserts in a single API call (`POST /api/allocator/scenario/commit` or similar — researcher decides the route shape; one transaction or N atomic txs is the planner's call). On success: drawer collapses to a green "N decisions recorded" confirmation; the scenario draft is reset to the new live state automatically.

- **D-10: Voluntary toggle-off → synthetic match_decision row at commit time.** When a holding NOT in `flaggedHoldings` is toggled off and the scenario is committed:
  - API route inserts a `match_decisions` row with: `original_holding_ref` set, `original_strategy_id` NULL, `suggested_strategy_id` NULL, `kind = 'voluntary_remove'` (or equivalent discriminator — researcher decides between adding a `kind` column vs using a sentinel value).
  - This requires **relaxing Phase 09 D-13's XOR constraint**. Two viable migration paths (researcher to choose):
    - **Path A (preferred):** Add a `kind` enum column (`bridge_recommended`, `voluntary_remove`, `voluntary_add`); replace XOR with a per-kind invariant CHECK (`bridge_recommended` → suggested_strategy_id NOT NULL AND (one of original_* NOT NULL); `voluntary_remove` → original_holding_ref NOT NULL AND suggested_strategy_id NULL; `voluntary_add` → suggested_strategy_id NOT NULL AND both original_* NULL).
    - **Path B:** Drop the XOR; allow all-NULL combinations on a `kind` column gating semantics. Simpler migration but weaker schema-level guarantee.
  - Then `bridge_outcomes` row references the synthesized match_decision via existing FK. **Note (post-cross-review):** the existing `bridge_outcomes` schema (migration 059) requires `strategy_id NOT NULL` and gates `(allocator_id, strategy_id)` uniqueness — these constraints are incompatible with voluntary_remove (no strategy) and with voluntary_add/voluntary_modify when the same strategy can recur across decisions. Phase 10 ships a SECOND migration (081) atomically with 080 to relax `bridge_outcomes` for voluntary kinds: nullable `strategy_id`, widen unique index from `(allocator_id, strategy_id)` to `(allocator_id, match_decision_id)`, kind-aware CHECK accepting the existing `kind='allocated'`/`kind='rejected'` shapes plus voluntary_remove and voluntary_add shapes. ADR-0023 sync covers both 080 and 081.
  - ADR-0023 sync: add `match.decision.voluntary_remove` and `match.decision.voluntary_add` audit kinds (or extend the existing `match.decision.*` family with a kind metadata field — D-14 from Phase 09 left this open).
  - Self-verifying DO block on the migration asserts: kind enum present, all three branches' CHECK constraints active, existing rows backfill to `bridge_recommended` (since they all satisfy that branch trivially), RLS policies unchanged.

- **D-11: Voluntary strategy add → symmetric synthetic match_decision row.** When a strategy added via Browse (NOT via Bridge "Add to scenario") is committed:
  - `match_decisions` row: `original_holding_ref` NULL, `original_strategy_id` NULL, `suggested_strategy_id` set, `kind = 'voluntary_add'`.
  - `bridge_outcomes` row references it via existing FK.
  - Same migration as D-10.
  - **Cron coverage (post-cross-review revision):** voluntary_add rows satisfy NEITHER existing branch in Phase 09 migration 073 (both `original_holding_ref` and `original_strategy_id` are NULL). Migration 080 therefore ships a third CTE branch in `compute_bridge_outcome_deltas()` ATOMICALLY alongside the kind enum, matching `md.kind='voluntary_add'` and joining on `suggested_strategy_id` to fill `delta_30d/90d/180d` once `strategy_analytics.returns_series` covers `allocated_at`. The DO block asserts the third branch exists and produces a delta for a fixture voluntary_add row. The earlier "the existing strategy branch will pick it up" claim was factually wrong (corrected in RESEARCH Pitfall 5).
  - **Hybrid case (Bridge "Add to scenario" but FOR a specific flagged holding):** the resulting match_decision is `bridge_recommended` (existing kind) with `original_holding_ref` set + `suggested_strategy_id` set — preserves Phase 09 semantics verbatim.

- **D-12: Persistent sticky footer on Scenario tab.** Bottom-pinned bar (full-width within the tab content area, height ~56px) showing: live diff count ("3 changes" — color-tinted by direction), compact delta summary ("+0.3 Sharpe · −4% Max DD"), "Reset" secondary button (left), "Commit scenario" primary button (right, disabled when diff count = 0). Footer respects tab navigation — does NOT escape the tab content area; switching tabs hides it. Renders via the same SizeStepper / WidgetChrome design tokens (Phase 09.1 D-04).

### Delta + diff visualization

- **D-13: KpiStrip rewrite for Scenario tab — projected primary + delta badge.** Reuse Phase 09.1 D-09 KpiStrip 5-cell layout (AUM, YTD TWR, Sharpe, Max DD 12m, Avg ρ — researcher may extend to include CAGR / Sortino / Score per SCENARIO-03; keep the KpiStrip's 5-cell capacity if needed by swapping a cell or compacting). Each cell: SCENARIO value as primary number, small delta pill below (e.g. "+0.31"). Live baseline value visible on hover/tooltip. Phase 07 warmup/stale paths preserved — when no live baseline (warm-up < 30 days), strip falls back to "—" / current behavior with no delta surfaced. The Performance-tab KpiStrip is UNCHANGED (live-only). New variant prop (e.g. `mode: "live" | "scenario"`) gates the delta-badge layout. Delta direction colored per D-16.

- **D-14: Equity-curve overlay — two lines on one chart.** Reuse Phase 09.1 D-10 SVG `EquityChart`'s existing holding-overlay-series prop. Pass a SECOND series: `scenarioEquity` (computed by `computeScenario().equity_curve`). Live baseline line renders muted (e.g. text-secondary stroke); scenario line renders accent. Toggle at the top-right of the chart: "Show live" / "Show scenario" / "Both" — default "Both". CustomRangePicker (Phase 09.1) preserved verbatim — both series respect the selected period. Drawdown chart receives the same overlay treatment.

- **D-15: Commit drawer diff layout = grouped sections.** Inside `ScenarioCommitDrawer`:
  1. **Holdings removed** (red strikethrough left bar accent) — each row: holding name + scope_ref + last weight + inline `RejectedForm` (note field, optional reason taxonomy from existing form).
  2. **Strategies added** (green plus left bar accent) — each row: strategy name + alias + assigned weight + inline `AllocatedForm` (allocation size, effective date, note).
  3. **Weight changes** (neutral chevron left bar accent) — each row: holding name + "12% → 8%" + inline (lighter) form for size + note. Weight-only changes are a v0.15 stretch — see D-17 in Claude's Discretion.
  Each section header shows count ("3 holdings removed"). Empty sections are hidden. Per-row form errors block "Submit all" with inline aria-live announcements. Confirmation pre-flight: "Submit 5 decisions? This will record 5 outcomes and feed the daily delta cron."

- **D-16: Direction-aware DESIGN.md status tokens for deltas.**
  - Each KPI knows its improvement direction: Sharpe / Sortino / CAGR / TWR / AUM / Score → up = good (green); Max DD / Vol / Avg ρ → down = good (green).
  - Delta sign mapped to direction: green (up arrow) for improvement, red (down arrow) for regression, neutral gray for "no meaningful change" (|Δ| < 0.01 absolute or |Δ| < 1% relative — whichever applies for the metric).
  - Color tokens come from DESIGN.md status palette (no garish colors; institutional muted tones). Numbers use Geist Mono per DESIGN.md.
  - Diff sticky-footer summary uses the same token rules.

### Claude's Discretion

- **D-17: Weight-change diff treatment.** Whether scenario weight tweaks (without toggle/add) ship in v0.15 or defer to Phase 11+. Default: SHIP — the composition list naturally exposes weight inputs once toggles work; the "Weight changes" section in D-15 covers them. But the outcome semantics for a pure weight-change ("rebalanced — neither allocated nor rejected") aren't strongly defined in Phase 01's BridgeOutcomeRow taxonomy. Planner picks: either (a) ship as `kind = 'voluntary_modify'` (third synthetic kind), (b) ship as a non-outcome-recorded "rebalance" that doesn't insert bridge_outcomes (purely UI-side), or (c) defer to Phase 11+. If (c), the Scenario tab disables direct weight inputs in v0.15; weight changes happen only as side-effects of toggle/add.
- **Browse-drawer search algorithm** — full-text vs alias-substring vs fuzzy. Default: alias-substring (existing pattern in `/strategies` browse).
- **Browse-drawer empty state** — copy when filters yield 0 results; copy when allocator has 0 mandate-compatible strategies.
- **Browse-drawer initial load** — full list vs paginated vs lazy on filter-change. Default: full list (verified strategy count is ~tens, not thousands).
- **Holdings warm-up gate for projection** — if a holding has < 30 days of `breakdown` data, exclude its returns from `computeScenario` (treat as missing series → renormalize active set). Mirror Phase 07 D-03 warmup gate. Planner pins the threshold + test fixture.
- **Mixed portfolios (legacy `portfolio_strategies` rows + holdings)** — if any allocator still has legacy strategy rows AND holdings, the unified composition list shows both, with the same toggle/weight semantics. Default-init enables both. Phase 09 D-16 covers engine-side mixed handling; Phase 10 inherits the convention on the UI side.
- **localStorage shape + invalidation rules.** Key: `allocations.scenario_v0_15` (json blob: `{ schema_version, init_holdings_fingerprint, toggleByScopeRef, addedStrategies, weightOverrides, lastEditedAt }`). Invalidation: on dashboard load, if `init_holdings_fingerprint` (a deterministic hash of the live `holdingsSummary`) does NOT match the stored fingerprint, prompt a confirmation modal: "Your live holdings have changed since you last edited the scenario. Reset and start from current holdings, or keep your draft?" Defaults to keep. Planner finalizes the fingerprint algorithm + the prompt copy.
- **Reset confirmation modal copy.** Default: "Discard your scenario draft and reinitialize from current holdings? This can't be undone." Planner pins the exact copy.
- **Commit-success behavior.** Default per D-09: drawer collapses to green confirmation, scenario draft resets to new live state. Alternative: draft retained for further iteration. Planner picks.
- **Sticky footer collision with HoldingNoteRow / OutcomesWidget sub-row sticky behavior.** Verify no z-index or layout collision when both surfaces are visible simultaneously.
- **`/compare` deep-link from Scenario tab** — already supported via Phase 09 D-15. The composer's holding rows can offer a "Compare to [candidate]" button that routes to `/compare?ids=<holding_scope_ref>,<candidate_uuid>`. Researcher confirms whether to expose; default: yes for flagged holdings (where a candidate exists).
- **Scenario-tab deep-link from Performance tab Notices card** — Phase 09 D-07 already routes "Bridge flagged N holding(s) — Review in Scenario →" to `/allocations?tab=scenario`. With Phase 10's composer landing on that tab, the deep-link continues to work.
- **PostHog instrumentation for Scenario tab.** Suggested events: `scenario_opened`, `scenario_holding_toggled`, `scenario_strategy_added` (with `source: bridge | browse`), `scenario_committed` (with diff_count + per-kind counts), `scenario_reset`. Planner finalizes the event names and properties for the Phase 11 onboarding-funnel hookup.
- **API route shape for commit.** Whether `POST /api/allocator/scenario/commit` (one-shot transaction) vs N parallel `POST /api/bridge/outcomes` calls (existing path). Researcher decides based on transactional guarantees + existing Phase 01 outcome-record route shape.
- **Empty-portfolio path** — if `holdingsSummary.length === 0`, what does the Scenario tab show? Default: same EmptyState component (Phase 07 D-08) with an additional "Browse strategies" CTA opening the browse drawer. Allocator can build a hypothetical scenario from scratch via voluntary_add only. Planner verifies the projection math handles "all-added, no-baseline" gracefully (live baseline = empty curve).

### Folded Todos

*None — no pending todos matched this phase's scope (cross_reference_todos returned 0 matches).*

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase charter + requirements
- `.planning/ROADMAP.md` §Phase 10 — Goal, Depends-on (07, 08, 09), Requirements (SCENARIO-01…09), Success Criteria. (Note: plan stubs under Phase 10 are copy-paste placeholders and do NOT reflect Phase 10 plan intent — researcher/planner derive real plan grain.)
- `.planning/REQUIREMENTS.md` §SCENARIO-01…SCENARIO-09 — line-item acceptance criteria. SCENARIO-05 already complete (existing `src/lib/scenario.ts` math). SCENARIO-08 locks "client-side state + localStorage; no DB persistence".
- `.planning/PROJECT.md` — milestone goal (Demo-to-Production), institutional-tone guardrails, Key Decisions table, Constraints (no new deps, no new services preferred), Banned Packages.
- `.planning/STATE.md` — current position (Phase 09.1 in execution; Phase 10 not started).

### Design + repo guardrails
- `DESIGN.md` — DM Sans / Geist Mono, 1px borders, 8px radius, institutional minimalist palette, status color tokens (D-16 reads from this).
- `AGENTS.md` — "This is NOT the Next.js you know"; read `node_modules/next/dist/docs/` before App Router work.
- `CLAUDE.md` — project guardrails (Simplicity First, Root-Cause Obsession, Banned Packages: `axios`, etc.).

### Prior-phase context (inherited decisions — LOCKED, do NOT re-open)
- `.planning/phases/01-outcome-tracker/01-CONTEXT.md` — `bridge_outcomes` schema, pg_cron delta computation, `BridgeOutcomeBanner` / `AllocatedForm` / `RejectedForm` contracts.
- `.planning/phases/03-mandate-aware-scoring-engine/03-CONTEXT.md` — `mandate_fit_score` composition (D-08 mandate pill source).
- `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` — OutcomesWidget expandable pattern, Option A Holdings dropdown for `original_strategy_id` supply.
- `.planning/phases/06-allocator-api-ingestion/06-CONTEXT.md` — `allocator_holdings` schema, scope_ref convention (D-16), sync_status taxonomy (D-07).
- `.planning/phases/07-demo-mode-purge/07-CONTEXT.md` — `allocator_equity_snapshots` + `breakdown jsonb` (D-02), warm-up gate (D-03), tabbed `/allocations` (D-04), staleness semantics (D-10/D-11), `EmptyState.tsx` (D-08), Notices card (D-09), `STRATEGY_COMPOSITE_WIDGETS` (f2), equityDailyPoints parallel-prop (f7).
- `.planning/phases/08-connection-management-and-notes/08-CONTEXT.md` — `buildHoldingScopeRef` (D-08), inline-expandable sub-row pattern (D-16), revoked-historical-inclusion (D-04/D-05), shared notes primitives.
- `.planning/phases/09-bridge-live-against-real-holdings/09-CONTEXT.md` — D-01 token-as-pseudo-strategy adapter, D-02 scope_ref format, D-04/D-05/D-06 flag rules, D-08 Scenario flagged-list seed, D-09 Phase 10 hand-off contract, D-11 holding-outcome-adapter.ts, D-13 match_decisions.original_holding_ref XOR (Phase 10 RELAXES this), D-14 ADR-0023 sync, D-15 /compare extension, D-16 mixed-portfolio semantics, D-17 ENGINE_VERSION v2.1.0.
- `.planning/phases/09.1-allocator-dashboard-ui-refresh-implement-designer-provided-a/09.1-CONTEXT.md` — D-01 4-col grid, D-02 LAYOUT_VERSION 4, D-04 hover chrome + a11y contract, D-05 6-tab AllocationsTabs, D-09 KpiStrip 5-cell rewrite (Phase 10 EXTENDS to scenario mode), D-10 SVG EquityChart + holding overlays (Phase 10 EXTENDS to scenario series), D-14/D-15/D-16 Bridge widget + drawer + 2-stage flow (Phase 10 ADDS "Add to scenario" CTA), D-17 `allocations.ui_v2` feature flag (Phase 10 ships under this flag), D-18 holdings-adapter.ts pattern (Phase 10 mirrors for scenario-adapter), D-20 "+ Allocation" routing, D-19 Tweaks panel.

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — route group layout, payload shapes, Python analytics service boundary.
- `.planning/codebase/STRUCTURE.md` — `src/app/(dashboard)/allocations/` tree.
- `.planning/codebase/CONVENTIONS.md` — audit-log call sites, RLS policy style, migration DO-block template.
- `.planning/codebase/TESTING.md` — Vitest multi-actor RLS helper, golden-snapshot conventions.
- `.planning/codebase/CONCERNS.md` — LAYOUT_VERSION tech-debt note, dual-cron path, compute_jobs RLS.

### Schema + backend (current state Phase 10 extends)
- `supabase/migrations/059_bridge_outcomes.sql` — `bridge_outcomes` schema (NOT modified by Phase 10).
- `supabase/migrations/060_compute_bridge_outcome_deltas.sql` — original delta cron body.
- `supabase/migrations/072_match_decisions_original_holding_ref.sql` — Phase 09 added column + XOR (Phase 10 RELAXES).
- `supabase/migrations/073_compute_bridge_outcome_deltas_holding_branch.sql` — Phase 09 holding-ref branch in cron (researcher verifies coverage for voluntary_add case).
- `supabase/migrations/074_match_decisions_symmetric_unique_widening.sql` — Phase 09 unique-key widening (researcher verifies relevance to Phase 10 voluntary kinds).
- Migration 075 (Phase 10) — relax XOR + add `kind` column (or sentinel) + ADR-0023 sync (D-10/D-11). Self-verifying DO block.

### Audit taxonomy
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — sync Phase 10 entry in same commit as the migration. Either extend `match.decision.*` family with kind metadata OR introduce `match.decision.voluntary_remove` / `match.decision.voluntary_add` (researcher decides; Phase 09 D-14 left this open by carrying both source types under existing kinds).

### Existing surfaces to modify
- `src/app/(dashboard)/allocations/ScenarioStub.tsx` — body branch already exists (D-08 from Phase 09: shows `ScenarioFlaggedHoldingsList` when `flaggedHoldings.length > 0`). Phase 10 adds a THIRD branch: when `allocations.ui_v2` is on, render the new `ScenarioComposer` (or replace the body entirely under the flag). Researcher confirms exact wiring point.
- `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx` — Phase 09 read-only seed; Phase 10 either evolves into the full composer OR is wrapped/embedded as a section within the new composer. Researcher decides.
- `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` — Phase 09.1 root; Phase 10 wires the composer into the Scenario tab body slot (existing tab-body wiring from Phase 09.1 Plan 02).
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` — UNCHANGED (6-tab structure already in place from Phase 09.1 D-05).
- `src/app/(dashboard)/allocations/components/KpiStrip.tsx` — extend with a `mode: "live" | "scenario"` variant supporting the delta-badge layout (D-13). Preserve `KpiStrip.warmup.test.tsx` invariants verbatim.
- `src/app/(dashboard)/allocations/components/BridgeDrawer.tsx` — confirm stage adds an "Add to scenario" CTA alongside existing "Send intro" (D-05 Bridge inline path). Preserve existing 2-stage flow + tests.
- `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` — UNCHANGED. (Scenario tab is a separate body, not a holdings sub-row.)
- `src/app/(dashboard)/allocations/components/AllocatedForm.tsx` + `RejectedForm.tsx` + `OutcomeRecordedRow.tsx` — UNCHANGED contracts; reused via `holding-outcome-adapter.ts` (Phase 09) extended for synthetic match_decisions (D-10/D-11).
- `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` — extend to handle voluntary_remove + voluntary_add synthetic match_decision shapes.
- `src/app/(dashboard)/allocations/widgets/performance/EquityCurve` (or wherever Phase 09.1 SVG EquityChart lives — researcher confirms the exact filename) — accept a second `scenarioSeries` prop and render overlay (D-14).
- `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart` — same overlay treatment.
- `src/lib/queries.ts` — extend `getMyAllocationDashboard()` payload with `holdingReturnsByScopeRef: Record<string, DailyPoint[]>` reconstructed from `allocator_equity_snapshots.breakdown` (D-04). Preserve existing payload fields.
- `src/lib/queries.ts` — `MyAllocationDashboardPayload` type widening for the new field.

### New surfaces to create
- `src/app/(dashboard)/allocations/lib/scenario-state.ts` — typed scenario draft (toggleByScopeRef + addedStrategies + weightOverrides), default-init helper, renormalization helpers, localStorage persistence + fingerprint invalidation.
- `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` — projects scenario state + holdings + holdingReturnsByScopeRef + strategies into `StrategyForBuilder[]` for `computeScenario()` (D-01).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (or split into ScenarioCompositionList + ScenarioFooter + ScenarioCommitDrawer + StrategyBrowseDrawer) — the full composer body. Planner shapes the file decomposition.
- `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx` (D-09/D-15) — right slide-over with grouped diff sections + per-row inline forms.
- `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` (D-05/D-06/D-08) — right slide-over for browse-add.
- `src/app/(dashboard)/allocations/components/ScenarioFooter.tsx` (D-12) — sticky footer with diff count + delta summary + Reset + Commit.
- `src/app/api/allocator/scenario/commit/route.ts` (or similar — researcher decides) — accepts the commit payload, inserts synthetic match_decisions for voluntary diffs, then bridge_outcomes, all in one transaction. RLS regression.
- `supabase/migrations/0XX_match_decisions_relax_xor.sql` — relax Phase 09 XOR + add kind column + DO-block + ADR-0023 sync. Atomic commit.
- Vitest co-located: `ScenarioComposer.test.tsx`, `ScenarioCommitDrawer.test.tsx`, `StrategyBrowseDrawer.test.tsx`, `scenario-adapter.test.ts`, `scenario-state.test.ts`, `scenario-state.localStorage.test.ts`.
- Pytest (analytics-service) — none required (engine path unchanged in Phase 10).

### Existing surfaces to extend (pattern reuse only — no rewrite)
- `src/lib/scenario.ts` — `computeScenario`, `buildDateMapCache`, etc. — UNCHANGED. Phase 10 feeds this engine via the new adapter.
- `src/lib/scenario.test.ts` — UNCHANGED. Regression pins remain.
- `src/components/scenarios/ScenarioBuilder.tsx` — UNCHANGED (independent /scenarios sandbox per D-07).
- `src/app/(dashboard)/scenarios/page.tsx` — UNCHANGED (per D-07; only add a help-text cross-link).
- `src/app/compare/` — UNCHANGED (Phase 09 D-15 already supports `holding:` prefix).

### Test-pattern references
- `src/lib/scenario.test.ts` — regression pins for all five scenario.ts behaviors (Phase 10 must keep these GREEN).
- `src/app/(dashboard)/allocations/AllocationDashboard.revoked-holdings.test.tsx` — Phase 08 D-04 invariant (KPIs always get full unfiltered holdings).
- `src/app/(dashboard)/allocations/AllocationDashboard.widget-gating.test.tsx` — Phase 07 f2 invariant.
- `src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx` — Phase 07 D-09 warm-up invariants (Phase 10 must keep these GREEN under the live-mode KpiStrip path).
- `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.test.tsx` — Phase 09 read-only seed coverage.
- `src/app/(dashboard)/allocations/components/BridgeDrawer.test.tsx` — Phase 09.1 confirm-stage tests (Phase 10 extends with "Add to scenario" CTA).
- `src/__tests__/bridge-outcomes-rls.test.ts` — multi-actor RLS pattern; extend for Phase 10 commit path covering voluntary kinds.
- `src/__tests__/bridge-outcome-cron.test.ts` — extend for voluntary_remove + voluntary_add delta-cron coverage if cron is touched.
- `src/__tests__/match-decisions-schema.test.ts` — Phase 09 XOR target; Phase 10 migration regression.

### No new deps
Zero npm package additions in Phase 10 (matches Phase 09 + Phase 09.1 precedent). All new components use existing primitives + `src/lib/scenario.ts` + Phase 09.1 design tokens.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets

- **`src/lib/scenario.ts`** — full client-side projection engine: TWR / CAGR / Vol / Sharpe / Sortino / Max DD / correlation / equity curve. Five behaviors pinned by `scenario.test.ts`. Direct reuse via D-01 unified-shape adapter — zero engine changes.
- **`src/components/scenarios/ScenarioBuilder.tsx`** — existing standalone scenario UI for the `/scenarios` route. Reference for composer interaction patterns (toggle / weight / include-from), but NOT shared with Phase 10 per D-07.
- **`src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx`** — Phase 09 D-08 read-only flagged-holdings list with inline `BridgeOutcomeBanner` / `AllocatedForm` / `RejectedForm` sub-rows via `holding-outcome-adapter.ts`. Either evolves into the composer or is consumed as a section of it (researcher decides).
- **`src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts`** — Phase 09 adapter mapping `(flaggedHolding, topCandidate, matchDecision)` → strategy-shaped form props. Phase 10 EXTENDS for synthetic voluntary_remove / voluntary_add match_decision shapes.
- **`src/app/(dashboard)/allocations/lib/holdings-adapter.ts`** — Phase 09.1 D-18 pattern for read-side adapter joining `holdingsSummary × flaggedHoldings × matchDecisions × strategies`. Phase 10 mirrors this pattern for the scenario adapter.
- **`src/app/(dashboard)/allocations/components/KpiStrip.tsx`** — Phase 09.1 D-09 5-cell strip with Phase 07 warmup paths. Phase 10 extends with a `mode: "scenario"` variant for delta-badge layout (D-13).
- **`src/app/(dashboard)/allocations/components/BridgeDrawer.tsx`** — Phase 09.1 D-16 right slide-over template. Pattern-match for `ScenarioCommitDrawer` and `StrategyBrowseDrawer` (D-09/D-06).
- **`src/app/(dashboard)/allocations/widgets/performance/`** — Phase 09.1 SVG `EquityChart` and `DrawdownChart` with holding-overlay-series prop. Phase 10 passes a second `scenarioSeries` prop (D-14).
- **`src/app/(dashboard)/allocations/components/AllocatedForm.tsx` + `RejectedForm.tsx`** — Bridge V2 form contracts preserved verbatim (Phase 01 / Phase 09 D-11).
- **`src/app/(dashboard)/allocations/EmptyState.tsx`** — Phase 07 D-08 zero-holdings empty state. Phase 10 reuses for the "no live holdings + try the browse drawer" Scenario-tab empty path (Claude's discretion).
- **`buildHoldingScopeRef(venue, symbol, holding_type)`** — Phase 08 utility producing `holding:{venue}:{symbol}:{holding_type}`. Phase 10 keys all scenario state by this scope_ref form.
- **`useDashboardConfig` localStorage idiom** — `vi.stubGlobal('localStorage', mock)` test pattern from Phase 07/08. Phase 10's `scenario-state.localStorage.test.ts` uses the same idiom.
- **`AllocatorContext` / `AllocationContext`** — existing context provider for shared dashboard state. Phase 10 may extend with scenario state OR keep scenario state in a dedicated provider — planner decides.

### Established patterns

- **Tab body wiring under `ui_v2` flag.** Phase 09.1 D-17 ships `AllocationDashboardV2` behind `allocations.ui_v2`. Phase 10's full composer ships under THIS flag — legacy v1 keeps the Phase 09 read-only flagged-list body unchanged. No new flag.
- **Right slide-over pattern** (`BridgeDrawer`): width ~620–720px, max-width 96vw, backdrop-dismissable, focus-trap, escape-to-close. Mirror for `StrategyBrowseDrawer` and `ScenarioCommitDrawer`.
- **Inline form sub-row Fragment pattern** (Phase 01 / 05 / 08 / 09): one-open-at-a-time. Phase 10's commit drawer uses inline forms but multiple-open simultaneously is acceptable inside the modal context (different modality from the Holdings table).
- **localStorage flag + state persistence** (Phase 08 `allocations.showRevokedHoldings`): SSR-safe `typeof window === "undefined"`; try/catch around getItem/setItem; Safari private-mode fallback. Phase 10 reuses for `allocations.scenario_v0_15`.
- **Atomic commits with TDD cadence** (Phase 08 / 09.1 precedent): RED commit adds failing tests, GREEN commit lands implementation; type-check clean at every commit boundary. Apply per major subcomponent.
- **`vi.stubGlobal` for localStorage** under vitest 4.1.2 (per Phase 08 Plan 02 STATE decision) — the reliable idiom for localStorage-dependent tests.
- **Atomic D-23 commit** (Phase 03 / 04 / 06 / 08 / 09 precedent): migration + audit taxonomy update + emitter changes land in ONE git commit. Phase 10 migration relaxing XOR + ADR-0023 + any kind-aware emitter follow this rule.
- **Status-token color coding** (DESIGN.md): green up = improvement, red down = regression, neutral gray when below noise floor (D-16). Geist Mono for numeric content.

### Integration points

- **Route entry:** `src/app/(dashboard)/allocations/page.tsx` UNCHANGED. → `MyAllocationClient.tsx` → `AllocationsTabs.tsx` → (under flag) `AllocationDashboardV2` (which renders the Scenario tab body — Phase 10's composer).
- **Payload extension hook:** `src/lib/queries.ts::getMyAllocationDashboard` — adds `holdingReturnsByScopeRef` field. Reuses the existing `allocator_equity_snapshots.breakdown` read; no new RLS path.
- **Bridge "Add to scenario" entry points:** `BridgeDrawer.tsx` confirm stage + the inline Bridge banner row (CandidateCard) — both grow an "Add to scenario" CTA next to the existing "Send intro" / "Record outcome" CTAs.
- **Commit API route:** new `POST /api/allocator/scenario/commit` (or extension to existing `/api/bridge/outcomes`) — researcher confirms shape. Routes through standard owner-RLS supabase client; no SECURITY DEFINER RPC needed (writes to user-owned rows).
- **Audit emissions:** scenario commits route through `log_audit_event` with `match.decision.*` kinds (per ADR-0023 sync); no new audit kind required if the existing family carries voluntary metadata.
- **Analytics events** (`trackUsageEventClient`): `widget_viewed` IntersectionObserver marker `data-widget-id="scenario-composer"` so Phase 11 PostHog onboarding funnel can hook scenario_opened / scenario_committed events.
- **Scenario state lifecycle:** Hydration order — load CONTEXT page server-side → client mount → `useScenarioState({ payload, allocatorId })` → on first mount, check localStorage fingerprint → either resume or default-init from `holdingsSummary[]`.
- **Mixed-portfolio path (Phase 09 D-16):** if the allocator has both `portfolio_strategies` (legacy) AND `holdings`, the unified composition list shows both via the same `StrategyForBuilder[]` shape — strategies pass-through, holdings via the adapter.

</code_context>

<specifics>
## User vision / specific asks

- **"Acting on a Bridge recommendation IS a scenario action"** (Phase 09 specific verbatim) — drove Phase 09's choice to put outcome forms on the Scenario tab. Phase 10 extends the same framing: voluntary diffs are also scenario actions and deserve the same outcome-graph treatment (D-10/D-11 synthetic match_decisions).
- **Schema honesty over convenience.** Phase 09 D-13 chose XOR over a typed FK on holdings. Phase 10 inherits the principle: synthetic match_decisions for voluntary diffs (with a kind discriminator) are preferred over orphan bridge_outcomes (D-11 path B). The migration relaxes the XOR but adds a per-kind invariant CHECK so the schema still tells the truth about which fields must be set.
- **Institutional tone — no garish colors, no animations beyond ~150ms ease-out.** D-16 status tokens use DESIGN.md muted greens / reds; the sticky footer's delta summary uses the same.
- **Minimum surface churn within the v2 cohort.** No new feature flag (D-17 from Phase 09.1 inherits); no LAYOUT_VERSION bump (Scenario tab is full-width body); no new widget tile; no new dependency.
- **Phase 10 cleanly ends the Phase 09→10 hand-off.** Phase 09 D-09 promised the read-only flagged list would grow into the composer. Phase 10's composer ABSORBS the flagged list (or wraps it as a section), making `ScenarioFlaggedHoldingsList.tsx` either evolve in place or be embedded — researcher's call.
- **`/scenarios` standalone sandbox is NOT obsolete.** Different jobs-to-be-done (D-07): prospective allocators without portfolios use the sandbox; live allocators with portfolios use the Scenario tab. Cross-link in help text but DO NOT merge components.
- **Browse drawer is for power users.** Most LPs will commit Bridge-recommended diffs only. The browse drawer exists so the SCENARIO-04 acceptance criterion is satisfied AND so allocators can stress-test arbitrary scenarios — but it's NOT the primary path.

</specifics>

<deferred>
## Deferred Ideas

### Not shipping in Phase 10 (Phase 11+ or later)
- **DB persistence of scenario drafts** — explicit v0.15 deferral (SCENARIO-08 locks localStorage-only). Revisit when allocators want named saved scenarios or multi-device resume.
- **Multi-scenario / named scenarios** — single draft only. Future phase if institutional users want side-by-side scenario comparisons.
- **Scenario fit-score** — running the scenario through `score_candidates()` for a "scenario quality" rating. Phase 10 ships pure projection only. Future phase if mandate-aware scenario optimization is wanted.
- **Stress testing / regime scenarios** — drawdown stress, vol shock, custom shocks — Sprint 10+ Analytics deferral (PROJECT.md).
- **Cash bucket / non-zero idle weight** — toggle-off → renormalize only in v0.15 (D-02). Cash row deferred.
- **Component unification with /scenarios sandbox** — kept independent (D-07). Revisit only if maintenance burden grows.
- **Mobile responsive polish** — PROJECT.md explicit deferral; desktop-only commitment.
- **Pure weight-change diff outcome semantics** — see D-17 in Claude's Discretion. If planner picks defer-to-Phase-11, weight inputs in v0.15 are toggle-derived only (no direct slider).
- **Scenario PostHog instrumentation hookup** — events suggested in Claude's Discretion; the actual onboarding-funnel wiring (`first_scenario_committed` etc.) lands in Phase 11 (ONBOARD-05).
- **PDF / report export of a scenario** — Sprint 10+ deferral (PROJECT.md).
- **Wallet OAuth / on-chain holdings in scenario** — out of scope per PROJECT.md (CSV + manual entry both dropped from v0.15).
- **Scenario engine on the server** — pure client-side math via `src/lib/scenario.ts` in v0.15 (matches `/scenarios` sandbox path).
- **Scenario-aware `score_candidates()` extension** — Phase 09 already runs the engine off real holdings; Phase 10 doesn't introduce a "what-if score" engine call.

### Reviewed Todos (not folded)
None — `gsd-sdk query todo.match-phase 10` returned 0 matches.

</deferred>

---

*Phase: 10-scenario-builder-and-what-if*
*Context gathered: 2026-04-25*
