# Phase 09: Bridge Live Against Real Holdings — Context

**Gathered:** 2026-04-21
**Status:** Ready for research & planning
**Prior-phase pickup:** Phase 06 (allocator_holdings + poll_allocator_positions live), Phase 07 (dashboard rewired to real data + tabbed /allocations + allocator_equity_snapshots with per-symbol `breakdown` jsonb + ScenarioStub at /allocations?tab=scenario), Phase 08 (HoldingsTable with per-holding sub-row pattern + user_notes multi-scope + inline-expandable Fragment convention) are all shipped. Real allocators today arrive with rows in `allocator_holdings` keyed by `(venue, symbol, holding_type)` and an empty `portfolio_strategies` — so BridgeOutcomeBanner / AllocatedForm / RejectedForm (all gated on strategy-shaped rows via `match_decisions.original_strategy_id`) literally never fire for them. Phase 09 closes that gap at three layers (engine input, schema pointer, UI attachment).

<domain>
## Phase Boundary

`match_engine.py` v2.0.0 `score_candidates()` runs against real allocator holdings from `allocator_holdings` and surfaces live Bridge recommendations on the Performance tab via the existing "What We Noticed" insights card, with a minimal read-only flagged-holdings list + inline outcome-recording surface on the Scenario tab that feeds the daily 30/90/180-day delta cron.

**In scope:**
- Input-layer rewire of `_load_allocator_context()` in `analytics-service/routers/match.py`: read from `allocator_holdings` + derive per-symbol returns from `allocator_equity_snapshots.breakdown`; synthesize pseudo-strategies keyed `holding:{venue}:{symbol}:{holding_type}` (LIVE-01).
- Migration 072: nullable `match_decisions.original_holding_ref TEXT` column + XOR constraint against existing `original_strategy_id` + ADR-0023 sync in the same commit (infrastructure for LIVE-04 + LIVE-05).
- Migration 073: SQL extension to `compute_bridge_outcome_deltas()` reading from `allocator_equity_snapshots.breakdown` per-symbol series when `original_holding_ref IS NOT NULL` (LIVE-05).
- Performance-tab UI: line item inside the existing "What We Noticed" insights card reading "Bridge flagged N holding(s) — Review in Scenario →" (LIVE-02).
- Scenario-tab UI: minimal read-only flagged-holdings list — each row shows the flagged holding + its top candidate + inline `BridgeOutcomeBanner` / `AllocatedForm` / `RejectedForm`. NO composition toggles, NO weight sliders, NO "Commit scenario" button.
- `/compare?ids=holding:{venue}:{symbol}:{holding_type},<strategy_uuid>` parser extension — renders the held side using the reconstructed per-symbol returns via the same adapter the engine uses (LIVE-03).
- Outcome-recording wire-up against real allocator_holdings rows via holding-sourced match_decisions; existing Phase 05 Bridge V2 form components reused via a thin prop adapter (LIVE-04).

**Out of scope (Phase 10 or deferred):**
- Full Scenario builder: composition toggles, weight sliders, drag-to-add, "Commit scenario" routing through outcome flow (SCENARIO-01…SCENARIO-09 — Phase 10).
- Per-holding style_exclusions check (needs a token→style classifier we don't have; defer to Phase 10+).
- liquidity_preference mandate check (needs per-venue 24h volume data; defer).
- Per-holding underperform threshold as an independent flag trigger (absorbed into candidate-exists gate — see D-04).
- Proactive Bridge-recompute enqueue on successful `poll_allocator_positions` completion (deferred; existing daily cron + mandate-edit triggers are adequate for v0.15).
- Any new widget tile on the Performance react-grid (folding into Notices card avoids LAYOUT_VERSION churn).

</domain>

<prior_decisions_inherited>
## Inherited from Phases 06 / 07 / 08 (locked)

- **Dashboard IA (Phase 07 D-04):** `/allocations?tab=performance|scenario`. URL query-param state; `performance` is default; `scenario` is the current ScenarioStub (`src/app/(dashboard)/allocations/ScenarioStub.tsx`). Phase 09 extends the Scenario tab's body while preserving the tab shell and URL semantics.
- **Scenario-stub Phase 07 D-06:** The stub exists so the two-mode mental model is established; body is pure placeholder. Phase 09 REPLACES the placeholder body with the read-only flagged-holdings list (no longer pure stub) BUT keeps the tab itself unchanged.
- **Per-symbol price history:** `allocator_equity_snapshots.breakdown jsonb` (Phase 07 D-02) carries per-symbol decomposition daily. Phase 09 reconstructs per-symbol returns series from this — no new reconstruction worker.
- **Holdings identity (Phase 06 D-16, Phase 08 D-08):** `{venue}:{symbol}:{holding_type}` is the canonical scope_ref form across notes, match_decisions, and now the engine-adapter pseudo-strategy id. CCXT-stripped symbol convention preserved.
- **Sync-status taxonomy + revoked-key historical inclusion (Phase 08 D-04/D-05):** Historical rows from revoked keys stay in `allocator_holdings` permanently and feed ALL backward-looking computations. Phase 09 inherits verbatim — the engine consumes the full unfiltered holdings set regardless of current key sync_status.
- **Inline expandable sub-row pattern (Phase 01 BridgeOutcomeBanner + Phase 05 OutcomesWidget + Phase 08 HoldingNoteRow):** One-open-at-a-time Fragment sub-row under a list/table row is the established "details inside a list view" affordance. The Phase 09 Scenario-tab flagged-holdings list reuses this same inline-expandable pattern.
- **ADR-0023 same-commit sync:** Any taxonomy addition or breaking rename lands in the same git commit as the migration + emitter change (Phase 03, 04, 06, 08 precedent).
- **Migration self-verifying DO block:** Every migration ends with `DO $$` asserting schema invariants + RLS + trigger presence (Phase 06 + 07 + 08 precedent). Migrations 072 + 073 follow suit.
- **Bridge V2 component contracts (Phase 01 + Phase 05):** `BridgeOutcomeBanner` / `AllocatedForm` / `RejectedForm` / `OutcomeRecordedRow` contracts are preserved verbatim. Phase 09 adds a thin adapter that maps a flagged-holding row → strategy-shaped props. No Bridge V2 component rewrites.
- **Daily delta cron (Phase 01 pg_cron 0 3 * * *):** `compute_bridge_outcome_deltas()` is idempotent with `WHERE delta_30d IS NULL` guard. Phase 09 extends its SQL body (migration 073) to handle the `original_holding_ref IS NOT NULL` branch; cadence + idempotency semantics unchanged.
- **Engine version seam (Phase 3 D-11 / SCORING-05):** `_should_skip_allocator()` recomputes on engine_version mismatch. Phase 09 bumps ENGINE_VERSION (from the current v2.0.0 → v2.1.0) so the first cron run after ship invalidates every allocator's cached v2.0.0 batch — no manual flush.

</prior_decisions_inherited>

<decisions>
## Implementation Decisions

### Engine ↔ holdings bridge (LIVE-01)

- **D-01: Token-as-pseudo-strategy adapter.** For each row in `allocator_holdings` (latest-asof-per-(venue,symbol,holding_type) collapse — already computed as `holdingsSummary[]` in `getMyAllocationDashboard`), synthesize a pseudo-strategy record fed into the existing `score_candidates()` path:
  - `strategy_id = "holding:{venue}:{symbol}:{holding_type}"` (text prefix — see D-02)
  - `returns_series`: reconstructed from `allocator_equity_snapshots.breakdown` — per-day per-symbol value_usd from the jsonb decomposition is differenced to a daily return series. Series indexed by `asof` ascending, dtype float64.
  - `weight` = row's `value_usd` / sum(all holdings' `value_usd`) for the allocator on the latest asof
  - Pseudo-strategies have no `manager_id`, no `strategy_type`, no `subtype`, no `exchange`, no `sharpe` / `max_drawdown_pct` / `track_record_days` — these fields are None. Candidates (verified strategies) retain their full shape unchanged.
  - ZERO change to `services/match_engine.py` `score_candidates()` body. The refactor is entirely in `routers/match.py::_load_allocator_context()`: it now returns holding-sourced pseudo-strategies alongside (or instead of) real portfolio_strategies.

- **D-02: Pseudo-strategy-id format = prefixed text.** `strategy_id = "holding:{venue}:{symbol}:{holding_type}"` — never collides with a real strategy UUID (UUIDs are 36 chars with dashes; pseudo-ids are colon-delimited text). Every downstream consumer that needs to tell them apart gates on `id.startsWith("holding:")`. Matches Phase 08 D-08 note scope_ref verbatim — one string identifies the thing in notes, in `match_decisions.original_holding_ref`, and inside the engine. Deterministic v5 UUIDs were rejected because they force every consumer to carry a separate "is this a synthetic?" lookup.

- **D-03: Recompute triggers unchanged.** Existing daily `cron-recompute` + mandate-edit (`mandate_edited_at > computed_at`) + `ENGINE_VERSION` mismatch cover the freshness need. Holdings reshape is purely input-layer; no new compute-job kind and no post-sync proactive enqueue in Phase 09. Allocator sees first Bridge within 24h of first holdings sync. Proactive per-sync recompute is deferred to a future onboarding polish (Phase 11+) if live-feedback demands it.

### Flag trigger rules (LIVE-02)

- **D-04: Flag = mandate-breach + candidate-exists.** A holding appears on the "N holdings flagged" count iff (a) it breaches at least one in-scope mandate constraint (see D-05) AND (b) the top-ranked candidate for that holding's "slot" has composite score ≥ 0.50 (see D-06). "Underperform" is absorbed by the candidate-exists gate — only genuinely improvable holdings surface. Rejected alternatives: mandate-only (floods strip with non-actionable flags); independent per-holding 90d-return threshold (too noisy on normal drawdowns — institutional risk of crying wolf).

- **D-05: In-scope mandate constraints = max_weight + correlation_ceiling.**
  - `max_weight`: holding breaches when `value_usd / total_portfolio_value > allocator_preferences.max_weight`. Direct translation of existing strategy-level max_weight dimension; trivially computed from `holdingsSummary[]` already on the dashboard payload.
  - `correlation_ceiling`: using the per-symbol returns reconstructed from `breakdown` (D-01), compute each holding's correlation vs the weighted-rest-of-portfolio. Reuses `_compute_corr_with_portfolio()` from `match_engine.py` verbatim. Fires on concentrated crypto books where every token correlates > 0.9 with BTC/ETH.
  - `style_exclusions`: NOT in-scope for Phase 09 — requires a token→style classifier (CoinGecko categories or hardcoded lookup) the project doesn't have. Defer to Phase 10+ if needed.
  - `liquidity_preference`: NOT in-scope — requires per-venue 24h volume data. Defer.

- **D-06: Candidate-exists threshold = composite ≥ 0.50.** Uses the engine's existing composite score for the top-ranked verified strategy in the holding's slot. 0.50 bar ≈ "meaningful improvement available" and aligns with the Bridge V1 fit-label boundaries. Concrete, cheap (already computed), explainable. Positive-sharpe-delta was rejected as stretching the adapter; no-threshold was rejected as flooding weak-candidate-pool allocators.

### Strip + Scenario scope (LIVE-02)

- **D-07: Performance-tab flag surface = line inside the existing "What We Noticed" card.** No new widget, no LAYOUT_VERSION bump. The Notices card (Phase 07 D-09) grows a dedicated line at the top: "Bridge flagged N holding(s) — Review in Scenario →" when `flagged_count > 0`. Hidden entirely when `flagged_count == 0`. The "→" CTA routes to `/allocations?tab=scenario`. Rejected alternatives: sticky sub-header above KPI strip (new component + CSS + stale-warning banner collision risk); dedicated widget tile (LAYOUT_VERSION 3→4 localStorage bump + widget-registry entry for a one-line strip is over-engineered).

- **D-08: Scenario-tab body in Phase 09 = minimal read-only flagged-holdings list.** This REVISES the "stay pure stub" initial read. The current `ScenarioStub` body is REPLACED by `ScenarioFlaggedHoldingsList.tsx` when `flagged_count > 0` — or retains the "Scenario builder coming soon" copy when `flagged_count == 0`. The list is read-only: it renders each flagged holding + top candidate + inline Bridge V2 outcome forms (see D-11). No composition toggles, no sliders, no Commit — those stay Phase 10. The tab shell itself (URL query param, AllocationsTabs component) is unchanged — Phase 09 ONLY replaces the body component.

- **D-09: Phase 10 replaces the Phase 09 list with the full composition surface.** Phase 10 SCENARIO-01…SCENARIO-09 inherits `ScenarioFlaggedHoldingsList.tsx` as a starting point and grows it into the full Scenario builder (toggles, add-strategy, weight slider, Commit). Phase 09 writes the component with a forward-looking prop shape (see planner hints) so Phase 10 replaces the body rather than grafting.

### Outcome form attach (LIVE-04 + LIVE-05)

- **D-10: Outcome-recording home = Scenario tab's flagged-holdings list** (not HoldingsTable, not PositionsTable, not a new FlaggedHoldingsCard on Performance). Rationale: acting on a Bridge recommendation is conceptually a scenario action — even when Phase 09 exposes only the read-only flagged list, the location aligns the user's mental model with Phase 10's full composition surface. The Performance tab stays focused on "how am I doing?"; Scenario is "what should I do?".

- **D-11: Bridge V2 components reused verbatim via a thin prop adapter.**
  - `BridgeOutcomeBanner` / `AllocatedForm` / `RejectedForm` / `OutcomeRecordedRow` contracts are NOT modified.
  - A new `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` maps `(flaggedHolding, topCandidate, matchDecision)` → strategy-shaped props the existing components expect.
  - `eligible_for_outcome` / `existing_outcome` are computed at the adapter boundary against `match_decisions.original_holding_ref` (not `.original_strategy_id`) for holding-sourced flags.
  - Outcome forms render as inline sub-rows beneath each flagged-holding row (one-open-at-a-time Fragment pattern matching Phase 01 BridgeOutcomeBanner + Phase 08 HoldingNoteRow).

- **D-12: Delta cron handles holding-sourced outcomes once original_holding_ref exists.** Migration 073 extends the `compute_bridge_outcome_deltas()` function body:
  - Branch: `WHEN bo.original_strategy_id IS NULL AND md.original_holding_ref IS NOT NULL THEN ...`
  - Parse `original_holding_ref` → `(venue, symbol, holding_type)`.
  - Read the per-symbol value_usd series from `allocator_equity_snapshots.breakdown` for the allocator, compute 30/90/180-day realized return.
  - WHERE delta_30d IS NULL guard preserved (idempotent last-write-wins).
  - Cadence (pg_cron `0 3 * * *`) unchanged. No new worker code. No new table.
  - Self-verifying DO block asserts the new branch's SQL compiles + both branches (strategy and holding) produce finite floats on a golden fixture.

### Schema adapter (supports D-11 + D-12)

- **D-13: Migration 072 — `match_decisions.original_holding_ref TEXT` nullable + XOR constraint.**
  - Column: `original_holding_ref TEXT NULL` (no FK — scope_ref is text by design; same rationale as Phase 08 D-08's no-typed-FK decision).
  - CHECK constraint: `(original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT NULL)` — exactly one non-null per match_decision. Strategy-sourced decisions keep `original_strategy_id`; holding-sourced decisions use `original_holding_ref`.
  - Index: partial B-tree on `original_holding_ref WHERE original_holding_ref IS NOT NULL` for outcome-attribution lookups.
  - RLS unchanged (match_decisions already has admin-read-only + service-role-all policies).
  - Self-verifying DO block asserts: column present + nullable + index exists + XOR CHECK is deployed + existing row count is preserved (no backfill required since the XOR holds trivially for pre-existing rows where original_holding_ref is NULL).
  - Back-compat: existing `send_intro` RPC (Phase 05 Option A dropdown) still writes `original_strategy_id`; new Phase 09 outcome path writes `original_holding_ref`.

- **D-14: ADR-0023 audit taxonomy sync in the same commit as migration 072.**
  - Add note to the ADR's Phase 09 section: "`match_decisions.original_holding_ref` is the sibling key to `original_strategy_id` for holdings-sourced Bridge decisions. Both fields are captured in the audit `entity_id` via the existing `match.decision.*` kinds — no new audit kind required."
  - Rationale: no new audit event kind is needed because the action being audited ("Bridge outcome recorded") is identical regardless of source; only the entity pointer varies, which is already carried through `metadata.match_decision_id`.

### /compare deep-link (LIVE-03)

- **D-15: `/compare` parser accepts `holding:{venue}:{symbol}:{holding_type}` as held-side id.**
  - Parser detects the `holding:` prefix and branches to the holding-rendering path: reconstruct per-symbol returns from `allocator_equity_snapshots.breakdown`, compute sharpe / max_drawdown / vol / cumulative_return the same way as strategies do, render the left panel with a "Holding" header badge instead of the strategy factsheet card.
  - Strategy-side id shape unchanged — UUIDs go through the existing path.
  - Access gate: RLS on `allocator_equity_snapshots` (owner + admin + service_role) governs whether the current user can see the held side. Unauthorized = 403 with a "This comparison isn't available" message; no information leak about whether the holding exists.
  - Small focused diff in `src/app/compare/` — one parser fn + one render branch. Not a rewrite.

### Mixed portfolios (defensive)

- **D-16: Mixed portfolios (legacy strategies + tokens) — both feed score_candidates().**
  - An allocator with any rows in `portfolio_strategies` (legacy) AND rows in `allocator_holdings` (real) gets BOTH feeds into `_load_allocator_context()`: the portfolio_strategies rows keep their real strategy_id + real returns_series + real weight; the allocator_holdings rows land as pseudo-strategies per D-01.
  - Weights are normalized across the combined set: `sum_of_portfolio_strategies.allocated_amount + sum_of_allocator_holdings.value_usd = total`, each row's weight is its contribution / total. Pre-existing normalization in score_candidates is preserved.
  - `mode` detection (`"personalized"` vs `"screening"`) triggers on `portfolio_strategies OR holdings_present` — both count as "has portfolio". `screening` only fires for brand-new allocators with neither.
  - Flag-count derivation (D-04) applies uniformly across the combined set: a strategy-sourced row can also be flagged, and its click-through routes to /compare?ids=<strategy_uuid>,<candidate_uuid> via the existing (unchanged) path.

### Engine-version bump

- **D-17: Bump `ENGINE_VERSION` to v2.1.0** (from the current v2.0.0 shipped in Phase 03 / SCORING-05).
  - First daily cron after Phase 09 ships invalidates every allocator's cached v2.0.0 batch via `_should_skip_allocator()` trigger #2 — no manual flush, no banner needed.
  - Matches Phase 3's v1→v2 cutover pattern verbatim.
  - `WEIGHTS_VERSION` unchanged (weight composition is identical; only the input layer changed).

### Plan file breakdown (indicative — planner may re-slice)

- **D-18: Likely plan grain (4 plans, planner may re-partition):**
  - **09-01:** Migration 072 (`match_decisions.original_holding_ref` + XOR + partial index) + migration 073 (`compute_bridge_outcome_deltas()` SQL extension for holding-ref branch) + ADR-0023 sync + self-verifying DO blocks + RLS regression Vitest — atomic D-23-style commit.
  - **09-02:** Engine input-layer rewire — `_load_allocator_context()` reads `allocator_holdings` + per-symbol returns from `allocator_equity_snapshots.breakdown` + synthesizes pseudo-strategies (D-01) + `ENGINE_VERSION` bump to v2.1.0 + pytest golden snapshot for a holdings-only allocator + mixed-portfolio test (D-16).
  - **09-03:** UI surfaces — Notices-card line (D-07) + `ScenarioFlaggedHoldingsList.tsx` replacing ScenarioStub body (D-08) + `holding-outcome-adapter.ts` (D-11) + inline Bridge V2 form sub-rows on the Scenario list + Vitest coverage on the full Performance→Scenario→inline-form click path.
  - **09-04:** `/compare` parser extension + holding-rendering branch (D-15) + access-gate test + test pinning LIVE-03 preserved for both strategy-sourced and holding-sourced flags.
  - Each plan asserts what its predecessor plan shipped (no stubs crossing plan boundaries). 09-02 is the test-depth hotspot (golden snapshot + mixed-portfolio math + engine_version seam) — planner should time-box pytest iteration before locking.

### Claude's Discretion

- **Notices-card line copy** — exact string "Bridge flagged N holding(s) — Review in Scenario →" is a starting point; copy-review may refine (e.g. "N holding(s) may be improvable" or "N mandate breach(es) detected"). Preserve institutional tone; don't use promotional language.
- **Per-symbol returns reconstruction edge cases** — when `breakdown` is partial (e.g. some days have symbol-level decomposition, some don't), researcher decides whether to forward-fill, drop the day, or treat as missing. Use the existing portfolio_metrics `_safe_float` + dropna conventions.
- **Top-candidate rendering on the Scenario flagged list** — exact layout: single card per flagged holding with candidate inline, or two-pane (flagged on left, candidate on right). Planner picks after design review.
- **Warm-up gate for holdings-sourced pseudo-strategies** — similar to Phase 07 D-03 (< 30 snapshot days → annualized metrics render `—`). When a holding has < 30d of per-symbol breakdown data, the pseudo-strategy should be excluded from portfolio-fit math entirely (treated as a missing series), not flagged, not compared. Planner codifies the exact threshold and test fixture.
- **XOR enforcement for send_intro legacy callers** — Phase 05's `send_intro` RPC path passes `original_strategy_id` only. Planner verifies the XOR CHECK does NOT break any existing insert path. Expected: back-compat is trivial because the current sender always writes original_strategy_id and never writes original_holding_ref.
- **Handling holdings-only allocators whose equity snapshots are still reconstructing** — first-sync allocator has holdings but no (or partial) equity_snapshots.breakdown yet. Planner decides whether the flag count waits for snapshots (graceful), shows as 0 with a "Computing your flags…" note, or shows a generic "Bridge is warming up" line. Default: wait for snapshots (matches Phase 07 D-03 warm-up pattern).
- **Test fixture for the Scenario flagged-holdings list** — planner decides whether to reuse the Phase 05 outcomes fixture or seed a new one keyed off `holdingsSummary[]`.
- **Whether the Notices-card line is the ONLY affordance, or also a KPI-strip badge (e.g. small "2 flags" pill next to the portfolio AUM header)** — planner decides via design review; default is Notices-card only for minimum surface churn.

### Folded Todos

None — no pending todos matched this phase's scope (no `gsd-sdk query todo.match-phase` matches surfaced).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase charter + requirements
- `.planning/ROADMAP.md` §Phase 09 — Goal, Depends-on, Requirements (LIVE-01…LIVE-05), Success Criteria (note: plan stubs under Phase 09 are copy-paste placeholders from Phase 06 and do NOT reflect Phase 09 plan intent — see D-18 for the real grain).
- `.planning/REQUIREMENTS.md` §LIVE-01…LIVE-05 — line-item acceptance criteria
- `.planning/PROJECT.md` — milestone goal (Demo-to-Production), institutional-tone guardrails, Key Decisions table (Sprint 8 Bridge V2 ground truth)
- `.planning/STATE.md` — current position (Phase 08 complete; Phase 09 Not started)

### Design + repo guardrails
- `DESIGN.md` — DM Sans / Geist Mono, 1px borders, 8px radius, institutional minimalist palette (required before any UI decision per CLAUDE.md)
- `AGENTS.md` — "This is NOT the Next.js you know": read `node_modules/next/dist/docs/` before writing App Router code
- `CLAUDE.md` — project guardrails (Simplicity First, Root-Cause Obsession, Banned Packages including `axios`)

### Prior-phase context (inherited decisions — LOCKED, do not re-open)
- `.planning/phases/06-allocator-api-ingestion/06-CONTEXT.md` — `allocator_holdings` schema, `poll_allocator_positions` job kind, Remove-key + delete RPC, symbol-form convention (D-16), sync_status taxonomy (D-07)
- `.planning/phases/07-demo-mode-purge/07-CONTEXT.md` — `allocator_equity_snapshots` schema incl. `breakdown jsonb` (D-02), warm-up gate (D-03), tabbed `/allocations` (D-04), ScenarioStub (D-06), staleness semantics (D-10/D-11), Notices-card (D-09)
- `.planning/phases/08-connection-management-and-notes/08-CONTEXT.md` — scope_ref format for holdings (D-08), inline-expandable sub-row pattern for HoldingNoteRow (D-16), revoked-historical-inclusion invariant (D-04/D-05)
- `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` — OutcomesWidget expandable pattern, Option A Holdings dropdown for original_strategy_id supply (D-20c)
- `.planning/phases/04-feedback-loop/04-CONTEXT.md` — `compute_adjusted_weights` + lazy import seam in routers/match.py (still in effect)
- `.planning/phases/03-mandate-aware-scoring-engine/03-CONTEXT.md` — scoring v2.0.0 + mandate_fit_score inside W_PREFERENCE_FIT composition + engine_version seam
- `.planning/phases/01-outcome-tracker/01-CONTEXT.md` — `bridge_outcomes` schema + pg_cron delta computation + BridgeOutcomeBanner/AllocatedForm/RejectedForm contracts

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — route group layout, widget registry shape, Python analytics service boundary
- `.planning/codebase/STRUCTURE.md` — `src/app/(dashboard)/allocations/` tree + `analytics-service/services/` tree
- `.planning/codebase/CONVENTIONS.md` — audit-log call sites, RLS policy style, migration DO-block template
- `.planning/codebase/TESTING.md` — Vitest multi-actor RLS helper + pytest fixtures + golden-snapshot conventions
- `.planning/codebase/CONCERNS.md` — LAYOUT_VERSION tech-debt note (no banner on bump)

### Schema + backend (current state this phase extends)
- `analytics-service/services/match_engine.py` — `score_candidates()` signature + `_compute_preference_fit` + `_compute_mandate_fit_score` + `_compute_portfolio_fit_components` (all reused verbatim; adapter path only changes `_load_allocator_context` in routers/match.py)
- `analytics-service/services/bridge_scoring.py` — `find_replacement_candidates` (current Bridge V1 REPLACE semantics; portfolio.py dependency — verify it still passes for strategy-shaped portfolios after Phase 09 ships)
- `analytics-service/routers/match.py` — `_load_allocator_context()` is the SINGLE surgical target for LIVE-01 input-layer rewire (D-01/D-16). `cron-recompute` + `recompute` endpoints unchanged.
- `analytics-service/services/feedback_engine.py` — `compute_adjusted_weights` lazy-imported in routers/match.py; still in effect, untouched by Phase 09
- `supabase/migrations/059_bridge_outcomes.sql` + `060_compute_bridge_outcome_deltas.sql` — bridge_outcomes schema + delta cron function body (migration 073 extends the function)
- `supabase/migrations/066_allocator_holdings.sql` — allocator_holdings unique key `(allocator_id, venue, symbol, asof)` + RLS (owner + admin + service_role)
- `supabase/migrations/070_allocator_equity_snapshots.sql` — equity_snapshots schema incl. `breakdown jsonb` + `history_depth_months` + 3-tier RLS (read-source for D-01 per-symbol returns)
- `supabase/migrations/064_match_decisions_original_strategy_id.sql` + `065_match_decisions_original_strategy_id_not_null.sql` — current original_strategy_id shape (Phase 09 migration 072 relaxes NOT NULL + adds XOR sibling column)

### Audit taxonomy
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — sync Phase 09 section in same commit as migration 072. Per D-14, no new audit kind is introduced; the existing `match.decision.*` kinds carry both strategy-sourced and holding-sourced decisions.

### Existing surfaces to modify
- `src/app/(dashboard)/allocations/ScenarioStub.tsx` — body replaced by `ScenarioFlaggedHoldingsList.tsx` when `flagged_count > 0` (D-08); stub copy retained as the empty-state branch
- `src/app/(dashboard)/allocations/AllocationDashboard.tsx` — thread `flaggedHoldings` + `matchDecisionsByHoldingRef` into `widgetData` + pass through to the Notices card + the Scenario tab
- `src/app/(dashboard)/allocations/components/NoticesCard.tsx` (or wherever the Phase 07 D-09 insights card lives — researcher confirms exact path) — add the "Bridge flagged N holding(s) — Review in Scenario →" line
- `src/app/compare/` — parser extension for `holding:` prefix + held-rendering branch (D-15)
- `src/lib/queries.ts` `getMyAllocationDashboard()` — add `flaggedHoldings[]` + `matchDecisionsByHoldingRef{}` to the payload; piggyback on existing allocator_holdings + match_batches reads

### New surfaces to create
- `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx` — read-only flagged-holdings list (D-08) with inline Bridge V2 sub-rows (D-11)
- `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` — flaggedHolding → strategy-shaped props for BridgeOutcomeBanner / AllocatedForm / RejectedForm (D-11)
- `supabase/migrations/072_match_decisions_original_holding_ref.sql` — nullable column + XOR CHECK + partial index + DO-block (D-13)
- `supabase/migrations/073_compute_bridge_outcome_deltas_holding_branch.sql` — SQL extension to `compute_bridge_outcome_deltas()` for holding-ref branch (D-12)

### Existing surfaces to extend (pattern reuse only — no rewrite)
- `src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.tsx` — contract preserved; Phase 09 uses via adapter
- `src/app/(dashboard)/allocations/components/AllocatedForm.tsx` + `RejectedForm.tsx` + `OutcomeRecordedRow.tsx` — contracts preserved; adapter maps holding props → strategy-shaped form props
- `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx` — DOES NOT change in Phase 09; continues to serve strategy-shaped rows from legacy portfolios + mixed portfolios (D-16)

### Test-pattern references
- `analytics-service/tests/test_match_integration.py` — routers/match.py test shape (includes the patch-in-namespace idiom for score_candidates); extend for holdings-adapter path
- `analytics-service/tests/test_bridge_scoring.py` — find_replacement_candidates golden; regression target for D-16 mixed-portfolio case
- `analytics-service/tests/test_outcomes_kpi_parity.py` — bridge_outcomes + delta cron parity; regression target for D-12 holding-branch
- `src/__tests__/bridge-outcomes-rls.test.ts` — multi-actor RLS; extend for match_decisions.original_holding_ref policy surface
- `src/__tests__/bridge-outcome-cron.test.ts` — existing cron regression; extend for holding-ref branch
- `src/__tests__/match-decisions-schema.test.ts` — migration 072 XOR CHECK regression target

### No new deps
- Zero npm package additions in Phase 09 (unlike Phase 08 which pinned markdown deps). All reconstruction math reuses pandas/numpy already in analytics-service.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets
- **`allocator_equity_snapshots.breakdown jsonb`** — shipped in Phase 07, carries per-symbol value_usd decomposition daily. Phase 09 reconstructs per-symbol returns from this dataset; no new reconstruction worker needed.
- **`score_candidates()` in `match_engine.py`** — signature is holding-agnostic (takes any `portfolio_strategies` + `portfolio_returns` + `portfolio_weights` dict), so feeding pseudo-strategies requires ZERO engine changes. Refactor is strictly in `_load_allocator_context()` in routers/match.py.
- **`_compute_corr_with_portfolio()`** — already computes a candidate's correlation against the weighted portfolio vector. Reused verbatim for D-05 correlation_ceiling check on holdings.
- **`compute_bridge_outcome_deltas()` pg_cron** — idempotent + last-write-wins (D-11 from Phase 01). Migration 073 extends its SQL body with a CASE branch; cadence unchanged.
- **Bridge V2 component quartet** — `BridgeOutcomeBanner` + `AllocatedForm` + `RejectedForm` + `OutcomeRecordedRow` are strategy-prop-shaped; Phase 09 reuses them verbatim via `holding-outcome-adapter.ts`.
- **ScenarioStub** — small file, easy to swap body for `ScenarioFlaggedHoldingsList.tsx` via a `flagged_count > 0 ? <List/> : <Stub/>` branch.
- **`holdingsSummary[]` on dashboard payload** — already latest-asof-per-(venue,symbol,holding_type) collapsed (Phase 06 + Phase 08); direct input to D-01 pseudo-strategy synthesis.
- **Phase 08 HoldingNoteRow + HoldingNoteIconButton inline-expandable sub-row convention** — exact pattern Phase 09's flagged-holding-list uses for Bridge V2 form sub-rows.

### Established patterns
- **Three-tier RLS** (owner + admin + service_role) — match_decisions already has it; migration 072 doesn't alter RLS.
- **Migration self-verifying DO block** — every migration ends with `DO $$` asserting invariants. Migrations 072 + 073 follow suit.
- **Engine_version seam** — `_should_skip_allocator()` trigger #2 invalidates stale batches on version mismatch. Phase 09 bumps v2.0.0 → v2.1.0 to flush every allocator's cached batch on first post-ship cron run.
- **Atomic migration + ADR sync + emitter change** — Phase 03 / 04 / 06 / 08 precedent. Migration 072 + ADR-0023 sync land in one commit.
- **Inline expandable sub-row** — Phase 01 BridgeOutcomeBanner + Phase 05 OutcomesWidget + Phase 08 HoldingNoteRow established this. Phase 09 adopts for the Scenario flagged-list.
- **Pattern: strategy-shaped props flow through widgetData; adapter at the boundary when the source changes** — avoids deep prop-shape rewrites.

### Integration points
- **`analytics-service/routers/match.py::_load_allocator_context()`** — SINGLE surgical point for LIVE-01. Returns the portfolio_strategies + returns + weights dict; Phase 09 adds holdings-sourced pseudo-strategies alongside (or instead of) portfolio_strategies rows per D-16 mixed-portfolio semantic.
- **`getMyAllocationDashboard()` in queries.ts** — payload grows `flaggedHoldings[]` + `matchDecisionsByHoldingRef{}`; read sources are match_batches (latest per allocator) + allocator_holdings + match_decisions filtered on original_holding_ref.
- **`src/app/compare/`** — parser in the route component; small conditional branch in the rendering layer. No route re-shuffle.
- **pg_cron `compute_bridge_outcome_deltas()`** — function body extended in migration 073; cadence + caller path unchanged.

</code_context>

<specifics>
## User vision / specific asks

- **"Acting on a Bridge recommendation IS a scenario action"** (verbatim reframe mid-discussion): this drove D-10 and D-08. Rather than attaching outcome forms on Performance-tab HoldingsTable (initial recommendation), Phase 09 puts them on the Scenario tab's minimal flagged-holdings list — matches Phase 10's conceptual home without building Phase 10's full composition surface yet.
- **Minimum surface churn preference** — captured in D-07 Notices-card placement over new widget tile (no LAYOUT_VERSION bump) and D-11 adapter over component rewrites (Bridge V2 contracts preserved).
- **Institutional narrative fidelity** — D-04's candidate-exists gate chosen over independent underperform threshold to avoid crying-wolf flags during normal market drawdowns.
- **Schema honesty** — D-13's XOR original_strategy_id / original_holding_ref chosen over synthetic-UUID-in-strategies-table so the strategies table doesn't acquire a non-quant row class. Matches the Phase 08 D-08 "no typed FK, text scope_ref" precedent verbatim.
- **Phase 10 cleanliness** — D-09 locks the Phase 09→10 handoff: Phase 09's `ScenarioFlaggedHoldingsList.tsx` is a read-only starting point; Phase 10 inherits and grows it into the full SCENARIO-01…SCENARIO-09 surface without grafting.

</specifics>

<deferred>
## Deferred Ideas

### Not shipping in Phase 09 (Phase 10 or later)
- **Full Scenario composition** — toggles, weight sliders, drag-to-add, "Commit scenario" routing through outcome flow (SCENARIO-01…SCENARIO-09, Phase 10).
- **style_exclusions on holdings** — needs token→style classifier (CoinGecko categories? hardcoded?). Defer to Phase 10+.
- **liquidity_preference on holdings** — needs per-venue 24h volume data ingestion. Defer to Phase 10+.
- **Independent per-holding underperform threshold** — rejected in favor of candidate-exists gate (D-04). Revisit only if allocators report "missed" underperformers during pilot.
- **Proactive post-sync Bridge recompute enqueue** — daily cron + mandate-edit are enough for v0.15 (D-03). Revisit in Phase 11+ if live-feedback demands faster first-flag.
- **Dedicated Bridge widget tile on Performance tab** — rejected per D-07 to avoid LAYOUT_VERSION churn. Revisit if Notices-card surface becomes over-cluttered.
- **Automatic /demo→Phase-09 demo loop** — out of scope; /demo stays seeded per Phase 07 D-14.
- **Admin-facing flagged-holdings dashboard** — institutional support tooling candidate for post-v0.15.

### Reviewed Todos (not folded)
None — no pending todos matched this phase's scope.

</deferred>

---

*Phase: 09-bridge-live-against-real-holdings*
*Context gathered: 2026-04-21*
