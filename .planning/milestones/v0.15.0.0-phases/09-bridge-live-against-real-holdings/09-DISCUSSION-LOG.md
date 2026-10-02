# Phase 09: Bridge Live Against Real Holdings — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 09-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 09-bridge-live-against-real-holdings
**Areas discussed:** Engine↔holdings bridge, Flag trigger rules, Strip + Scenario scope, Outcome form attach, /compare deep-link

---

## Area selection (multiSelect)

**Question:** Which gray areas do you want to discuss for Phase 09?

| Option | Description | Selected |
|--------|-------------|----------|
| Engine↔holdings bridge | How allocator_holdings feeds score_candidates() AND how match_decisions.original_strategy_id stretches to carry holding identity | ✓ |
| Flag trigger rules | What makes a holding 'flagged' — mandate-only vs mandate + underperform vs synthetic-strategy pipeline | ✓ |
| Strip + Scenario scope | Where the 'N holdings flagged' strip lives; does Phase 09 extend Scenario stub | ✓ |
| Outcome form attach | Where BridgeOutcomeBanner / AllocatedForm / RejectedForm attach for holding-sourced flags | ✓ |

---

## Area 1: Engine↔holdings bridge

### Q1a: How should allocator_holdings feed score_candidates() — the engine input layer?

| Option | Description | Selected |
|--------|-------------|----------|
| Token-as-pseudo-strategy adapter (Recommended) | Synthesize pseudo-strategy rows from holdings; feed into existing score_candidates() unchanged | ✓ |
| Holdings-aware engine branch | New entrypoint score_candidates_for_holdings() with separate codepath | |
| Aggregate portfolio vector only | Single portfolio-level exposure vector, no per-token identity | |

**Notes:** Zero engine change + pseudo-strategy synthesis in routers/match.py::_load_allocator_context() only. Fits user's pattern-reuse preference + preserves Phase 03 scoring v2.0.0 golden.

### Q1b: How should match_decisions.original_strategy_id adapt for holding-sourced Bridge decisions?

| Option | Description | Selected |
|--------|-------------|----------|
| Nullable original_holding_ref column (Recommended) | Migration 072 adds original_holding_ref TEXT NULL + XOR CHECK vs original_strategy_id | ✓ |
| Synthetic pseudo-strategy UUIDs in strategies table | v5 UUID from scope_ref + new kind='holdings_proxy' column | |
| Keep strategy_id, resolve to closest verified strategy | No schema change; lossy attribution | |

**Notes:** Matches Phase 08 D-08 scope_ref precedent (text-based, no typed FK). Avoids polluting the strategies table with non-quant rows. ADR-0023 sync in same commit.

### Q1c: How should the pseudo-strategy id be shaped so downstream code can tell holdings apart from real strategies?

| Option | Description | Selected |
|--------|-------------|----------|
| Prefixed text id: holding:{venue}:{symbol}:{holding_type} (Recommended) | Never collides with UUID; gate on id.startsWith('holding:'); matches Phase 08 scope_ref | ✓ |
| Deterministic v5 UUID derived from scope_ref | Uniform shape with strategy UUIDs; requires separate lookup to distinguish | |
| Raw scope_ref with no prefix | Smallest identifier; triggers false-positive surprises in UUID parsers | |

### Q1d: What drives a new Bridge recompute for holdings-based allocators?

| Option | Description | Selected |
|--------|-------------|----------|
| Existing triggers, unchanged (Recommended) | Daily cron-recompute + mandate-edit + ENGINE_VERSION mismatch | ✓ |
| Also fire proactively after poll_allocator_positions | Every successful sync enqueues rescore_allocator job | |
| Only on explicit mandate edit + daily cron | Most conservative; no per-sync trigger | |

---

## Area 2: Flag trigger rules

### Q2a: How should the 'flagged holdings' count be derived on the Performance strip?

| Option | Description | Selected |
|--------|-------------|----------|
| Mandate-breach + candidate-exists (Recommended) | Breach + top candidate composite > threshold; 'underperform' absorbed by candidate-exists | ✓ |
| Mandate-only | Breach regardless of candidate; non-actionable flags | |
| Mandate-breach OR per-holding underperform threshold | Two independent triggers; noisy on market corrections | |

### Q2b: Which mandate constraints are in-scope for Phase 09's holding-level check? (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| max_weight per holding (Recommended) | value_usd / total > mandate.max_weight; trivial | ✓ |
| correlation_ceiling against the rest of portfolio (Recommended) | Reuses _compute_corr_with_portfolio() verbatim | ✓ |
| style_exclusions on the token class (Recommended) | Needs token→style classifier we don't have; flagged but not selected | |
| liquidity_preference against venue/symbol turnover | Needs 24h volume data; defer | |

**Notes:** User selected max_weight + correlation_ceiling only. style_exclusions not in scope (needs classifier); liquidity_preference not in scope (needs new data source).

### Q2c: What does 'candidate-exists' mean in practice?

| Option | Description | Selected |
|--------|-------------|----------|
| Top candidate score ≥ 0.50 (Recommended) | Uses engine composite; concrete, cheap, explainable | ✓ |
| Top candidate has positive sharpe_delta vs the held token's implied sharpe | More intuitive but more math to validate | |
| Always at least one candidate — no threshold | Floods strip on weak candidate pools | |

---

## Area 3: Strip + Scenario scope

### Q3a: Where does the 'N holdings flagged' strip render on the Performance tab?

| Option | Description | Selected |
|--------|-------------|----------|
| Thin sub-header above KPI strip (Recommended) | Full-width banner between tabs and KPI strip; sticky | |
| Dedicated widget tile in react-grid-layout | New BridgeSummaryWidget; LAYOUT_VERSION bump | |
| Fold into existing 'What We Noticed' insights card | Zero new components, no LAYOUT_VERSION change | ✓ |

**Notes:** User diverged from recommendation — chose Notices-card placement for institutional minimalism + zero widget churn. Trade-off: slightly lower click-through than a sticky strip, but aligns with pattern preference.

### Q3b: What does the Scenario tab show in Phase 09?

| Option | Description | Selected |
|--------|-------------|----------|
| Stay as the Phase 07 ScenarioStub — don't extend in Phase 09 (Recommended initially) | Clean phase boundary; Phase 10 owns full Scenario | ✓ (then REVISED after Area 4) |
| Extend Scenario stub into read-only flagged-holdings list | Minimal extension; gives 'Review in Scenario' link a real destination | (REVISED to this) |
| Drop the 'Review in Scenario' routing and inline-expand the strip | Strip itself becomes the disclosure; Scenario stays pure stub | |

**Notes:** Initial answer "stay as stub" was REVISED during Area 4 after user surfaced "acting on Bridge recommendation is a scenario action". Final lock: Scenario body grows minimally into `ScenarioFlaggedHoldingsList.tsx` for Phase 09; Phase 10 replaces it with full composition surface.

---

## Area 4: Outcome form attach

### Q4a: Where do BridgeOutcomeBanner / AllocatedForm / RejectedForm attach for holding-sourced flags?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline sub-row on HoldingsTable (Recommended initially) | Mirrors Phase 08 notes sub-row pattern | |
| Drop into PositionsTable using synthetic pseudo-strategy rows | Smallest UI diff; muddies Strategy column | |
| New dedicated FlaggedHoldingsCard on Performance tab | Clean narrative; third holdings-listing surface | |
| Other (user input): "I think that should live in the scenarios tab, no? Because adding a strategy suggested by the bridge is a scenario" | User reframe | ✓ |

**Notes:** User pushed back on HoldingsTable recommendation and reframed: acting on a Bridge recommendation IS a scenario action. This drove the revision of Q3b and led to the follow-up resolution question.

### Q4b: Given outcome forms belong in Scenario tab, how should Phase 09 vs Phase 10 split the work?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend Scenario stub minimally in Phase 09: flagged-holdings list + inline outcome forms only (Recommended) | Phase 09 gets read-only flagged list + Bridge V2 inline forms; Phase 10 adds composition | ✓ |
| Defer LIVE-04 and LIVE-05 to Phase 10 — Phase 09 is engine + strip only | Phase 09 doesn't close the loop; ROADMAP success criteria 4 + 5 move to Phase 10 | |
| Keep outcome forms on HoldingsTable after all — original recommendation | Reopens the Area 4 reframe; not aligned with user's mental model | |

### Q4c: How does a holding-sourced outcome recording feed the existing daily 30/90/180-day delta cron?

| Option | Description | Selected |
|--------|-------------|----------|
| Cron already handles it once original_holding_ref exists (Recommended) | Migration 073 extends compute_bridge_outcome_deltas() SQL body; reads per-symbol series from allocator_equity_snapshots.breakdown | ✓ |
| Freeze per-symbol return baseline at outcome insert time | Capture snapshot into bridge_outcomes.metadata_jsonb; heavier | |
| Block outcome recording on holding rows until Phase 10 | UI attaches but submission returns 'coming soon' | |

---

## Area 5: /compare deep-link (LIVE-03)

### Q5a: How does <held> address a token on /compare?ids=<held>,<candidate>?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend /compare parser to accept holding: prefix (Recommended) | /compare?ids=holding:binance:BTC:spot,<strategy_uuid>; small focused diff | ✓ |
| Always right-side-only on holdings — don't link /compare from Phase 09 | Punts on LIVE-03 literal text | |
| Resolve held-side to closest verified strategy on-the-fly | Lossy; two allocators with raw BTC see same left panel | |

---

## Closing check

### Ready for context?

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context | Lock decisions and write CONTEXT.md | ✓ |
| Explore more gray areas | Surface more topics (test migration, kill-switch, mixed portfolios, copy, etc.) | |

---

## Claude's Discretion

Captured in 09-CONTEXT.md `<decisions>` → "Claude's Discretion" subsection. Key items:
- Exact Notices-card line copy
- Per-symbol returns reconstruction edge cases (partial breakdown handling)
- Top-candidate rendering layout on the Scenario flagged list
- Warm-up gate threshold for holdings-sourced pseudo-strategies (< 30d per-symbol history)
- XOR enforcement verification against legacy send_intro RPC path
- First-sync-still-reconstructing warm-up copy
- Test fixture strategy for the Scenario flagged-holdings list

## Deferred Ideas

Captured in 09-CONTEXT.md `<deferred>` section. Key deferrals: full Scenario composition (Phase 10), style_exclusions + liquidity_preference mandate checks (need new data), per-holding underperform as independent trigger (rejected in favor of candidate-exists gate), proactive post-sync recompute enqueue (daily cron is enough for v0.15), dedicated Bridge widget tile on Performance.
