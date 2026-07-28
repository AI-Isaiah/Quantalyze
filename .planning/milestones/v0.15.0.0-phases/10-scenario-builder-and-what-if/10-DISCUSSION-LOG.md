# Phase 10: Scenario Builder and What-If — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-25
**Phase:** 10-scenario-builder-and-what-if
**Areas discussed:** Composition state model, Add-strategies UX, Commit-through-Bridge mapping, Delta + diff visualization

---

## Composition state model

### Q1: How should holdings and added strategies coexist in the scenario draft state?

| Option | Description | Selected |
|--------|-------------|----------|
| Unified via adapter (Recommended) | Cast holdings to StrategyForBuilder shape (id `holding:{venue}:{symbol}:{holding_type}`), reuse computeScenario() unchanged. Maximum reuse of Phase 09 D-01/D-02 conventions. | ✓ |
| Split state, fan-in at projection | Holdings tracked in toggleByScopeRef map; strategies tracked in weightByStrategyId map. Merged JIT for projection. | |
| Holdings-first symmetric | All composition keyed by scope_ref; strategies cast to synthetic `strategy:{uuid}` ref. | |

**User's choice:** Unified via adapter (Recommended)
**Notes:** Existing `src/lib/scenario.ts::computeScenario` is reused verbatim; the adapter sits between scenario state and the engine.

### Q2: When an allocator toggles a holding OFF in the scenario, where does its weight go?

| Option | Description | Selected |
|--------|-------------|----------|
| Renormalize active set (Recommended) | Remaining active rows scaled proportionally to sum to 1.0. Matches scenario.ts behavior note #1. | ✓ |
| Cash bucket (0% return) | Toggled-off weight goes into a synthetic cash row (drags TWR proportionally). | |
| Manual reassignment required | Scenario shows 'X% unallocated' until allocator explicitly redistributes. | |

**User's choice:** Renormalize active set (Recommended)
**Notes:** No cash row in v0.15; deferred.

### Q3: When a strategy is added to the scenario, what default weight does it get?

| Option | Description | Selected |
|--------|-------------|----------|
| Context-aware default (Recommended) | Bridge swap takes flagged-holding's weight; browse-add even-splits with renormalization. | ✓ |
| Always even-split | All adds recompute even weights across active set. | |
| User must set explicitly | Slider starts at zero; no projection until set. | |

**User's choice:** Context-aware default (Recommended)
**Notes:** Two distinct add paths, two distinct semantics. Allocator can still adjust the weight after the default is set.

### Q4: How does Phase 10 get per-holding daily returns into computeScenario?

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side payload prep (Recommended) | Extend `getMyAllocationDashboard` with `holdingReturnsByScopeRef: Record<scope_ref, DailyPoint[]>` reconstructed once on the server. | ✓ |
| Client-side reconstruction | Ship raw `breakdown` jsonb; reconstruct on client. | |
| Lazy fetch on first scenario open | New `/api/allocator/holding-returns` route fetched on Scenario tab activate. | |

**User's choice:** Server-side payload prep (Recommended)
**Notes:** Same source Phase 09 engine consumes; no client-side reconstruction divergence risk; Vitest can fixture directly.

---

## Add-strategies UX

### Q1: What's the primary discovery surface for adding a strategy to the scenario?

| Option | Description | Selected |
|--------|-------------|----------|
| Bridge-inline + Browse modal (Recommended) | Dual path: inline 'Add to scenario' on flagged-holding candidates + a 'Browse strategies' header button opening a modal/drawer. | ✓ |
| Bridge-inline only | Allocators can ONLY add Bridge-recommended candidates (blocks SCENARIO-04). | |
| Inline search widget | Persistent search/filter bar at the top of the Scenario tab. | |
| Deep-link round-trip | Header CTA routes to `/strategies?return=scenario`. | |

**User's choice:** Bridge-inline + Browse modal (Recommended)
**Notes:** Browse drawer satisfies SCENARIO-04 'browse verified strategies'.

### Q2: If we ship a Browse modal/drawer, what's its scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Modal with search + filters (Recommended) | Right slide-over (~620px, BridgeDrawer pattern), text search + filter pills (markets / strategy_types / mandate-fit). Multi-add session-able. | ✓ |
| Modal lists strategies, no filters | Single search field; full list below. | |
| Route to /strategies with return query | Reuses existing browse page. | |

**User's choice:** Modal with search + filters (Recommended)
**Notes:** Pattern-match BridgeDrawer convention from Phase 09.1.

### Q3: How should the existing standalone /scenarios sandbox relate to the Allocations Scenario tab?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep both, no merge (Recommended) | Different jobs-to-be-done: sandbox = strategies-only experimentation; allocations Scenario = live-portfolio composer. Cross-link in help text only. | ✓ |
| Migrate /scenarios to share components | Refactor /scenarios to consume the same composer. Single source of truth, but widens blast radius. | |
| Deprecate /scenarios | Remove in a follow-up PR after Phase 10. | |

**User's choice:** Keep both, no merge (Recommended)
**Notes:** scenario.test.ts regression pins protected; /scenarios stays untouched in Phase 10.

### Q4: How should browse results signal mandate compatibility?

| Option | Description | Selected |
|--------|-------------|----------|
| Visible mandate-fit badge per row (Recommended) | Green/yellow/red pill from existing mandate_fit_score. Informational only; never blocks. | ✓ |
| Default-filter to mandate-fit, toggle to show all | Browse opens with mandate-compatible only. | |
| No mandate signal | Allocator infers mandate-fit from projected metrics after add. | |

**User's choice:** Visible mandate-fit badge per row (Recommended)
**Notes:** Threshold mapping ≥0.7 green / 0.4–0.7 yellow / <0.4 red; informational only.

---

## Commit-through-Bridge mapping

### Q1: How should 'Commit scenario' flow when there are multiple diffs?

| Option | Description | Selected |
|--------|-------------|----------|
| Batch summary → per-diff inline forms (Recommended) | Drawer shows summary table with per-row form embedded; single 'Submit all' fires inserts. | ✓ |
| Per-diff inline forms in-place | Each diff in the composition list expands its own sub-row form. | |
| Single batch confirmation, no per-diff form | Confirmation modal with shared payload across all diffs. | |

**User's choice:** Batch summary → per-diff inline forms (Recommended)
**Notes:** ScenarioCommitDrawer (~720px) holds the per-row forms; one submit gesture.

### Q2: Voluntary toggle-off — how should this map to outcome recording?

| Option | Description | Selected |
|--------|-------------|----------|
| Synthesize a match_decision row at commit time (Recommended) | API inserts a synthetic match_decision (kind='voluntary_remove'); then bridge_outcome references it. Requires schema relaxation on Phase 09 XOR. | ✓ |
| Skip outcome record for voluntary toggles | Voluntary diffs don't contribute to feedback loop (violates SCENARIO-07). | |
| Block voluntary toggles entirely | Allow toggle-off only on flagged holdings. | |

**User's choice:** Synthesize a match_decision row at commit time (Recommended)
**Notes:** Migration relaxes XOR; ADR-0023 sync; Path A (kind enum) preferred.

### Q3: Voluntary strategy add — how should this map?

| Option | Description | Selected |
|--------|-------------|----------|
| Synthesize a match_decision (kind='voluntary_add') at commit time (Recommended) | Symmetric with voluntary_remove. New match_decision row with both original_* NULL; bridge_outcome references it. | ✓ |
| Direct AllocatedForm without match_decision parent | bridge_outcomes.match_decision_id NULL; requires FK relaxation. | |
| Block voluntary adds without flagged-holding context | Browse-add only enabled when at least one holding is flagged. | |

**User's choice:** Synthesize a match_decision (kind='voluntary_add') at commit time (Recommended)
**Notes:** Same migration as voluntary_remove; engine learns from voluntary adds.

### Q4: Where do allocators perform the Commit action?

| Option | Description | Selected |
|--------|-------------|----------|
| Persistent footer/sticky bar (Recommended) | Sticky bar at the bottom of the Scenario tab body with diff count + delta summary + Reset + Commit. | ✓ |
| Top-of-tab action strip | Action strip at the top with diff count + buttons. | |
| Modal triggered from header CTA | Commit only via primary button in the page header. | |

**User's choice:** Persistent footer/sticky bar (Recommended)
**Notes:** Always-visible while composing; commit is one click + drawer.

---

## Delta + diff visualization

### Q1: How should projected KPIs render alongside the live baseline?

| Option | Description | Selected |
|--------|-------------|----------|
| KpiStrip rewrite — projected + delta badge inline (Recommended) | Each cell: scenario value primary + delta pill below; live baseline on hover. Phase 07 warmup paths preserved. | ✓ |
| Two parallel KPI rows (live + scenario) | Stack two strips. | |
| Single delta-only banner above existing KpiStrip | Live KpiStrip unchanged; delta banner above. | |

**User's choice:** KpiStrip rewrite — projected + delta badge inline (Recommended)
**Notes:** New `mode: "live" | "scenario"` variant on existing KpiStrip; warmup invariants preserved.

### Q2: How should the projected equity curve display vs the live baseline?

| Option | Description | Selected |
|--------|-------------|----------|
| Overlay: two lines on one chart (Recommended) | Single chart with live (muted) + scenario (accent) lines. Toggle to hide either. Reuses Phase 09.1 holding-overlay code path. | ✓ |
| Side-by-side mini-charts | Two small charts. | |
| Toggle between live / scenario | Single chart, single line, control to flip. | |

**User's choice:** Overlay: two lines on one chart (Recommended)
**Notes:** Drawdown chart receives the same overlay treatment; CustomRangePicker preserved.

### Q3: Inside the Commit summary drawer, how should the diff itself be presented?

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped diff list — Removed / Added / Weight-changed sections (Recommended) | Three labeled sections with per-row inline form. | ✓ |
| Single chronological diff list (order-of-edit) | Mixed kinds in edit order. | |
| Side-by-side composition table (live vs scenario) | Two-column table; diff implicit. | |

**User's choice:** Grouped diff list — Removed / Added / Weight-changed sections (Recommended)
**Notes:** Empty sections hidden; per-row form errors block 'Submit all' with aria-live.

### Q4: How should improvement vs regression be color-coded across deltas?

| Option | Description | Selected |
|--------|-------------|----------|
| Direction-aware DESIGN.md tokens (Recommended) | Green/up = improvement; red/down = regression; neutral gray below noise floor. Per-KPI improvement direction. | ✓ |
| Always-positive coloring | Neutral +/− prefixes only. | |
| Threshold-banded (good/neutral/bad) | Per-KPI thresholds. | |

**User's choice:** Direction-aware DESIGN.md tokens (Recommended)
**Notes:** Noise floor: |Δ| < 0.01 absolute or |Δ| < 1% relative; Sharpe/CAGR/TWR up=good; MaxDD/Vol/avg ρ down=good.

---

## Claude's Discretion

Areas the user explicitly deferred to Claude / planner:

- **Weight-change diff outcome semantics** (D-17): ship as `voluntary_modify` kind / ship as non-outcome rebalance / defer to Phase 11+. Planner picks.
- **Browse-drawer search algorithm** (alias-substring vs full-text vs fuzzy).
- **Browse-drawer empty state copy** (no results / no mandate-compatible).
- **Browse-drawer initial load** (full vs paginated vs lazy).
- **Holdings warm-up gate threshold** (< 30d breakdown — Phase 07 D-03 mirror).
- **Mixed-portfolio toggle semantics** (Phase 09 D-16 inheritance).
- **localStorage shape + invalidation rules** (fingerprint algorithm + prompt copy).
- **Reset confirmation modal copy.**
- **Commit-success behavior** (auto-reset draft vs retain).
- **Sticky-footer collision check** with HoldingNoteRow / OutcomesWidget sub-rows.
- **`/compare` deep-link** exposure on composer holding rows.
- **PostHog instrumentation event names** for Phase 11 onboarding-funnel.
- **API route shape for commit** (`POST /api/allocator/scenario/commit` vs N parallel `/api/bridge/outcomes` calls).
- **Empty-portfolio Scenario tab path** (allocator with no holdings — pure voluntary_add scenarios).
- **ScenarioFlaggedHoldingsList disposition** (evolve in place vs wrap as composer section).
- **Migration path** (Path A `kind` enum + per-kind invariants vs Path B drop-XOR).

---

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section:

- DB persistence of scenario drafts (SCENARIO-08 deferral).
- Multi-scenario / named scenarios.
- Scenario fit-score (running through `score_candidates()`).
- Stress testing / regime scenarios.
- Cash bucket / non-zero idle weight.
- Component unification with /scenarios sandbox.
- Mobile responsive polish.
- Pure weight-change diff outcome semantics (planner-decided).
- Scenario PostHog hookup → Phase 11 (ONBOARD-05).
- PDF / report export of a scenario.
- Wallet OAuth / on-chain holdings in scenario.
- Server-side scenario engine.
- Scenario-aware `score_candidates()` extension.
