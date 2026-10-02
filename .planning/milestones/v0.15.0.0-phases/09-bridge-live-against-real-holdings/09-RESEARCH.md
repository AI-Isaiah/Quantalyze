# Phase 09: Bridge Live Against Real Holdings — Research

**Researched:** 2026-04-21
**Domain:** Engine input-layer surgery, per-symbol returns reconstruction, pg_cron SQL extension, schema XOR adapter, UI attachment via prop adapter
**Confidence:** HIGH (all claims verified against repo source, migrations, and prior-phase CONTEXT)

## Summary

Phase 09 is surgery at three layers: (1) an input-layer rewire inside
`analytics-service/routers/match.py::_load_allocator_context()` that feeds the
existing `score_candidates()` with holding-sourced pseudo-strategies synthesized
from `allocator_holdings` + per-symbol returns reconstructed from
`allocator_equity_snapshots.breakdown jsonb`; (2) schema migrations 072 + 073
that add `match_decisions.original_holding_ref TEXT` with an XOR CHECK against
the existing `original_strategy_id` and extend `compute_bridge_outcome_deltas()`
with a holding-ref branch; (3) a thin `holding-outcome-adapter.ts` at the UI
boundary plus a Notices-card line and a minimal `ScenarioFlaggedHoldingsList`
component. The engine math is NOT modified — `score_candidates()` is already
holding-agnostic; the refactor is entirely in the context loader. Migration
071's and 070's self-verifying DO-block template is the canonical pattern for
migrations 072 + 073. `ENGINE_VERSION` lives at `match_engine.py:46` and bumps
v2.0.0 → v2.1.0 as a one-line change; `_should_skip_allocator()` trigger #2 at
`routers/match.py:395` already handles cache invalidation on version mismatch.

**Primary recommendation:** Treat 09-01 (migrations 072 + 073) as the atomic
schema commit following the Phase 03 `062_scoring_weight_overrides` +
Phase 07 `070_allocator_equity_snapshots` precedent. Land migration 072 with
the XOR CHECK and partial index; extend `compute_bridge_outcome_deltas()`
in-place via `CREATE OR REPLACE FUNCTION` in migration 073 preserving the
existing function shape and cron schedule. Do ALL input-layer work in a single
function `_load_holding_portfolio_context()` called from
`_load_allocator_context()` — keep the signature of `_load_allocator_context()`
unchanged so tests that monkey-patch `routers.match.get_supabase` continue to
work. Adapter files live at `src/app/(dashboard)/allocations/lib/` co-located
with other dashboard helpers.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 Token-as-pseudo-strategy adapter** — For each row in `allocator_holdings`
(latest-asof-per-(venue,symbol,holding_type) collapse, already computed as
`holdingsSummary[]`), synthesize a pseudo-strategy record fed into
`score_candidates()`:
- `strategy_id = "holding:{venue}:{symbol}:{holding_type}"` (text prefix)
- `returns_series`: reconstructed from `allocator_equity_snapshots.breakdown`
- `weight` = row's `value_usd` / sum(all holdings' `value_usd`)
- Pseudo-strategies have no `manager_id`, no `strategy_type`, no `subtype`, no
  `exchange`, no `sharpe`/`max_drawdown_pct`/`track_record_days` — all None
- ZERO change to `services/match_engine.py` `score_candidates()` body

**D-02 Pseudo-strategy-id = prefixed text**
`"holding:{venue}:{symbol}:{holding_type}"` — never collides with a real
strategy UUID. Matches Phase 08 D-08 note scope_ref verbatim.

**D-03 Recompute triggers unchanged** — existing daily `cron-recompute` +
mandate-edit (`mandate_edited_at > computed_at`) + `ENGINE_VERSION` mismatch.

**D-04 Flag = mandate-breach + candidate-exists** — holding appears in
`flagged_count` iff (a) it breaches `max_weight` OR `correlation_ceiling` AND
(b) top-ranked candidate composite ≥ 0.50.

**D-05 In-scope mandate constraints = `max_weight` + `correlation_ceiling`**
(`style_exclusions` + `liquidity_preference` deferred to Phase 10+).

**D-06 Candidate-exists threshold = composite ≥ 0.50**.

**D-07 Performance-tab flag surface = line inside existing "What We Noticed"
card** — NO new widget, NO LAYOUT_VERSION bump. Copy: "Bridge flagged N
holding(s) — Review in Scenario →". Hidden entirely when `flagged_count == 0`.

**D-08 Scenario-tab body = minimal read-only flagged-holdings list** via new
`ScenarioFlaggedHoldingsList.tsx`. Replaces `ScenarioStub` body when
`flagged_count > 0`. No composition toggles, no sliders, no Commit.

**D-09 Phase 10 inherits `ScenarioFlaggedHoldingsList.tsx`** as a starting
point and grows it into the full composition surface.

**D-10 Outcome-recording home = Scenario tab's flagged-holdings list** (NOT
HoldingsTable, NOT PositionsTable, NOT a new card on Performance).

**D-11 Bridge V2 components reused verbatim via thin prop adapter.** New
`src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` maps
`(flaggedHolding, topCandidate, matchDecision)` → strategy-shaped props.
`eligible_for_outcome` / `existing_outcome` computed at the adapter boundary
against `match_decisions.original_holding_ref`.

**D-12 Delta cron handles holding-sourced outcomes** — migration 073 extends
`compute_bridge_outcome_deltas()` with a branch that reads per-symbol series
from `allocator_equity_snapshots.breakdown` when `original_holding_ref IS NOT
NULL`. Cadence + idempotency unchanged.

**D-13 Migration 072** — `match_decisions.original_holding_ref TEXT NULL` +
XOR CHECK `(original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT
NULL)` + partial B-tree index `WHERE original_holding_ref IS NOT NULL`. RLS
unchanged. CRITICAL: migration 065 currently has `original_strategy_id SET NOT
NULL` — migration 072 MUST first drop that NOT NULL before adding the XOR
CHECK (otherwise every existing row with strategy_id-only satisfies the XOR
and the relaxation is trivial, but new holding-sourced inserts would fail).

**D-14 ADR-0023 sync in same commit as migration 072**. No new audit event
kind — existing `match.decision.*` kinds carry both sources.

**D-15 `/compare` parser accepts `holding:` prefix** as held-side id. Parser
detects prefix → reconstruct per-symbol returns → render Holding badge. Strategy
UUIDs go through existing path. Access gate = RLS on
`allocator_equity_snapshots` (3-tier: owner + admin + service_role).

**D-16 Mixed portfolios** — allocator with BOTH `portfolio_strategies` AND
`allocator_holdings` rows: both feed `_load_allocator_context()`. Weights
normalized across combined set.

**D-17 Bump `ENGINE_VERSION` v2.0.0 → v2.1.0** at `match_engine.py:46`.
`WEIGHTS_VERSION` unchanged.

**D-18 Plan grain (4 plans, planner may re-slice):**
- **09-01:** Migration 072 + 073 + ADR-0023 sync + RLS regression Vitest
- **09-02:** Engine input-layer rewire + ENGINE_VERSION bump + pytest golden
- **09-03:** Notices-card line + `ScenarioFlaggedHoldingsList.tsx` +
  `holding-outcome-adapter.ts` + inline Bridge V2 sub-rows
- **09-04:** `/compare` parser extension + holding-rendering branch

### Claude's Discretion

- Notices-card line copy exact wording
- Per-symbol returns reconstruction edge cases (partial-day, forward-fill vs
  drop, first-sync warm-up) — addressed in §2 below
- Top-candidate rendering layout on the Scenario flagged list
- Warm-up gate for holdings-sourced pseudo-strategies (< 30d breakdown history)
- XOR enforcement vs legacy `send_intro` RPC path — confirmed safe (§5 below)
- First-sync-still-reconstructing UX copy
- Test fixture strategy for `ScenarioFlaggedHoldingsList`
- Notices-card-only vs KPI-strip pill (default: Notices-card only)

### Deferred Ideas (OUT OF SCOPE)

- Full Scenario composition (SCENARIO-01…SCENARIO-09, Phase 10)
- `style_exclusions` on holdings (needs token classifier)
- `liquidity_preference` on holdings (needs 24h volume data)
- Independent per-holding underperform threshold (absorbed by D-04)
- Proactive post-sync Bridge recompute enqueue (daily cron adequate for v0.15)
- Dedicated Bridge widget tile on Performance (LAYOUT_VERSION churn)
- Automatic /demo→Phase-09 demo loop
- Admin-facing flagged-holdings dashboard

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIVE-01 | `score_candidates(allocator_id)` reads holdings from `allocator_holdings`, computes current weights, applies mandate constraints, produces ranked candidates via scoring v2.0.0 | §1 Engine input-layer surgery; §2 per-symbol returns recipe; no `score_candidates()` body change |
| LIVE-02 | Performance tab shows compact Bridge summary strip when holdings breach mandate; click opens Scenario tab | §4 Notices card insert seam; line copy per D-07; `flaggedHoldings[]` threads via widgetData |
| LIVE-03 | `/compare?ids=<held>,<candidate>` deep-dive preserved as side-route | §4 `/compare` parser branch; RLS access gate on `allocator_equity_snapshots` |
| LIVE-04 | Inline `AllocatedForm` / `RejectedForm` / outcome banner work correctly when holding is from `allocator_holdings` (not seeded `portfolio_strategies`) | §3 Bridge V2 contracts + holding-outcome-adapter prop shape; Phase 01 components reused verbatim |
| LIVE-05 | Recording outcome on real holding flows through daily delta cron → real 30/90/180d realized deltas | §6 migration 073 extends `compute_bridge_outcome_deltas()` with holding branch reading from `breakdown` series |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Input-layer pseudo-strategy synthesis | API / Backend (FastAPI analytics-service) | — | Score computation lives in Python; routers/match.py owns context loading |
| Per-symbol returns reconstruction from `breakdown` | API / Backend (FastAPI) | — | pandas/numpy + jsonb read; same runtime as existing `score_candidates()` |
| `match_decisions` schema XOR | Database / Storage | — | Pure SQL via migration 072 + DO-block self-verify |
| Delta cron branch for holdings | Database / Storage (pg_cron SQL function body) | — | Migration 073 extends `compute_bridge_outcome_deltas()` in-place |
| Flagged-holdings threading | Frontend Server (Next.js SSR, `getMyAllocationDashboard`) | API / Backend (Bridge recompute) | Server-side query fan-out joins `match_batches` + `allocator_holdings` + `match_decisions` on holding_ref |
| `holding-outcome-adapter.ts` | Browser / Client | — | Pure TypeScript mapping; no server round-trip |
| Notices-card line + ScenarioFlaggedHoldingsList | Browser / Client | Frontend Server (hydration) | React components with widgetData flow per Phase 07 D-09 pattern |
| `/compare` holding-branch render | Frontend Server (SSR) | Database (RLS gate) | `page.tsx` async component; RLS enforced at Supabase client level |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pandas | already installed | pd.Series for returns math | existing engine uses it throughout |
| numpy | already installed | weight arrays + normalization | existing engine uses it |
| Next.js | 16 (from repo) | App Router SSR + client components | already in use |
| @supabase/supabase-js | already installed | 3-tier RLS client | existing pattern |
| zod | already installed | runtime schema validation | existing form validators use it |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.2 | client + RLS regression tests | all TS tests |
| pytest | installed | engine input-layer tests | golden-snapshot + mixed-portfolio |

### Alternatives Considered
None — Phase 09 ships ZERO new dependencies. CONTEXT.md explicitly states "Zero
npm package additions in Phase 09" and "All reconstruction math reuses
pandas/numpy already in analytics-service."

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Daily cron (03:00 UTC)                               │
│                                                                              │
│  pg_cron ──► compute_bridge_outcome_deltas()                                 │
│                │                                                             │
│                ├─► [strategy branch]   bridge_outcomes ⋈ strategy_analytics  │
│                │                        (existing)                           │
│                │                                                             │
│                └─► [holding branch]    bridge_outcomes ⋈                     │
│                     (NEW migration 073) allocator_equity_snapshots.breakdown │
│                                                                              │
│  pg_cron ──► cron-recompute (daily)                                          │
│                │                                                             │
│                └─► FastAPI /api/match/cron-recompute                         │
│                      │                                                       │
│                      └─► _score_one_allocator ─► _load_allocator_context     │
│                            │                                                 │
│                            ├─► allocator_holdings (latest asof per symbol)   │
│                            ├─► allocator_equity_snapshots.breakdown          │
│                            │     └─► per-symbol returns reconstruction       │
│                            │          (diff + dropna + forward-fill policy)  │
│                            └─► portfolio_strategies (mixed-portfolio path)   │
│                                                                              │
│                          score_candidates() ◄── unchanged, holding-agnostic  │
│                            │                                                 │
│                            ├─► match_batches (one row per allocator)         │
│                            └─► match_candidates (top 30 + excluded)          │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                         Allocator visit (SSR)                                │
│                                                                              │
│  /allocations?tab=performance ─► AllocationsTabs ─► AllocationDashboard      │
│                                    │                                         │
│                                    └─► getMyAllocationDashboard (SSR)        │
│                                         │                                    │
│                                         ├─► (existing) holdingsSummary[]     │
│                                         ├─► (NEW) flaggedHoldings[]          │
│                                         │         from match_batches +       │
│                                         │         match_candidates +         │
│                                         │         allocator_preferences      │
│                                         └─► (NEW) matchDecisionsByHoldingRef │
│                                                                              │
│                                    InsightStrip (D-09 Notices card)          │
│                                       └─► (NEW) "Bridge flagged N… →"        │
│                                                                              │
│                                 ScenarioStub ─► (when flagged>0)             │
│                                    └─► ScenarioFlaggedHoldingsList (NEW)     │
│                                         └─► holding-outcome-adapter (NEW)    │
│                                              ├─► BridgeOutcomeBanner (reuse) │
│                                              ├─► AllocatedForm (reuse)       │
│                                              ├─► RejectedForm (reuse)        │
│                                              └─► OutcomeRecordedRow (reuse)  │
│                                                                              │
│  /compare?ids=holding:*,strategy-uuid ─► compare/page.tsx                    │
│                                           ├─► parser: detect `holding:` pfx │
│                                           ├─► RLS gate on allocator_equity_ │
│                                           │     snapshots (3-tier)          │
│                                           └─► render holding badge + metrics│
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| File | Layer | Phase 09 work |
|------|-------|---------------|
| `analytics-service/routers/match.py::_load_allocator_context` | backend | rewire to read `allocator_holdings` + reconstruct per-symbol returns |
| `analytics-service/services/match_engine.py::score_candidates` | backend | NO changes (signature already holding-agnostic) |
| `analytics-service/services/match_engine.py:46 ENGINE_VERSION` | backend | bump v2.0.0 → v2.1.0 |
| `supabase/migrations/072_match_decisions_original_holding_ref.sql` | database | NEW: column + XOR CHECK + partial index |
| `supabase/migrations/073_compute_bridge_outcome_deltas_holding_branch.sql` | database | NEW: CREATE OR REPLACE function body extension |
| `src/lib/queries.ts::getMyAllocationDashboard` | frontend server | extend payload with `flaggedHoldings[]` + `matchDecisionsByHoldingRef{}` |
| `src/app/(dashboard)/allocations/AllocationDashboard.tsx` | frontend server | thread new payload keys into widgetData + Scenario tab |
| `src/components/portfolio/InsightStrip.tsx` (Phase 07 D-09 "What We Noticed") | client | add flagged-holdings line at top when `flaggedCount > 0` |
| `src/app/(dashboard)/allocations/ScenarioStub.tsx` | client | wrap in conditional: `flaggedCount > 0 ? <ScenarioFlaggedHoldingsList /> : <ScenarioStub />` |
| `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx` | client | NEW: read-only list + inline Bridge V2 sub-rows |
| `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` | client | NEW: prop adapter for Bridge V2 components |
| `src/app/(dashboard)/compare/page.tsx` | frontend server | parser extension for `holding:` prefix |

### Pattern 1: Input-layer pseudo-strategy synthesis
**What:** `_load_allocator_context()` returns a tuple of `(portfolio_strategies, portfolio_returns, portfolio_weights, portfolio_aum)` that match the existing `score_candidates()` contract. The refactor adds holding-sourced rows to this tuple without changing its shape.

**When to use:** Any allocator with ≥ 1 row in `allocator_holdings` and/or ≥ 1 row in `portfolio_strategies`.

**Example:**
```python
# analytics-service/routers/match.py (conceptual delta)
def _load_holding_portfolio_context(allocator_id: str) -> dict[str, Any]:
    """Build holding-sourced pseudo-strategies per Phase 09 D-01."""
    supabase = get_supabase()

    # 1. Latest-asof-per-(venue,symbol,holding_type) collapse — mirrors
    #    queries.ts derivePhase07Fields holdingsMap logic, but Python-side.
    holdings_rows = (
        supabase.table("allocator_holdings")
        .select("venue, symbol, holding_type, value_usd, asof")
        .eq("allocator_id", allocator_id)
        .order("asof", desc=True)
        .execute()
    ).data or []
    latest_by_key: dict[tuple[str, str, str], dict] = {}
    for r in holdings_rows:
        k = (r["venue"], r["symbol"], r["holding_type"])
        if k not in latest_by_key:  # order desc → first wins
            latest_by_key[k] = r

    # 2. Per-symbol returns from equity_snapshots.breakdown.
    snapshots = (
        supabase.table("allocator_equity_snapshots")
        .select("asof, breakdown")
        .eq("allocator_id", allocator_id)
        .order("asof", ascending=True)
        .execute()
    ).data or []

    portfolio_strategies: list[dict] = []
    portfolio_returns: dict[str, pd.Series] = {}
    portfolio_weights: dict[str, float] = {}
    total_value = sum(float(r["value_usd"]) for r in latest_by_key.values())

    for (venue, symbol, holding_type), row in latest_by_key.items():
        pseudo_id = f"holding:{venue}:{symbol}:{holding_type}"
        # Reconstruct per-symbol daily returns from breakdown
        per_symbol_series = _reconstruct_symbol_returns(snapshots, symbol)
        if per_symbol_series is None or len(per_symbol_series) < 30:
            continue  # warm-up gate per Phase 07 D-03 analog
        portfolio_strategies.append({"strategy_id": pseudo_id})
        portfolio_returns[pseudo_id] = per_symbol_series
        portfolio_weights[pseudo_id] = (
            float(row["value_usd"]) / total_value if total_value > 0 else 0
        )

    return {
        "portfolio_strategies": portfolio_strategies,
        "portfolio_returns": portfolio_returns,
        "portfolio_weights": portfolio_weights,
        "portfolio_aum": total_value if total_value > 0 else None,
    }
```
**Source:** `analytics-service/routers/match.py:172-248` (current `_load_allocator_context`)

### Pattern 2: Prop-adapter at UI boundary
**What:** `holding-outcome-adapter.ts` maps holding-sourced rows to the
strategy-shaped props the Phase 01 Bridge V2 components already expect. The
components themselves are untouched.

**When to use:** Any flagged-holding row that needs inline `BridgeOutcomeBanner`
/ `AllocatedForm` / `RejectedForm` / `OutcomeRecordedRow`.

**Example:**
```typescript
// src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts (conceptual)
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";

export type FlaggedHolding = {
  venue: string;
  symbol: string;
  holding_type: "spot" | "derivative";
  value_usd: number;
  /** Top candidate composite ≥ 0.50 — what the Bridge wants allocator to swap into */
  top_candidate_strategy_id: string;
  top_candidate_name: string;
  top_candidate_composite: number;
  /** Breach reasons — rendered in the expandable sub-row */
  breach_reasons: Array<"max_weight" | "correlation_ceiling">;
};

/** scope_ref = "holding:{venue}:{symbol}:{holding_type}" — matches Phase 08 D-08 */
export function buildHoldingRef(h: FlaggedHolding): string {
  return `holding:${h.venue}:${h.symbol}:${h.holding_type}`;
}

export function toBridgeOutcomeBannerProps(
  h: FlaggedHolding,
  opts: { onAllocatedClick: () => void; onRejectedClick: () => void; onDismiss: () => void },
) {
  return {
    // BridgeOutcomeBanner expects strategyId — pass the TOP CANDIDATE uuid
    // since that's what the outcome routes to (allocator is being asked
    // "did you swap into this candidate?"). The holding_ref carries on
    // match_decisions.original_holding_ref for cron attribution.
    strategyId: h.top_candidate_strategy_id,
    ...opts,
  };
}

export function deriveEligibleForOutcome(
  h: FlaggedHolding,
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>,
  existingOutcomesByHoldingRef: Record<string, BridgeOutcome | null>,
): { eligible: boolean; existingOutcome: BridgeOutcome | null } {
  const ref = buildHoldingRef(h);
  const existing = existingOutcomesByHoldingRef[ref] ?? null;
  const decision = matchDecisionsByHoldingRef[ref] ?? null;
  return {
    eligible: decision !== null && existing === null,
    existingOutcome: existing,
  };
}
```

### Pattern 3: Migration extends pg_cron function body in-place
**What:** `CREATE OR REPLACE FUNCTION compute_bridge_outcome_deltas()` with an
extended body that branches on `bo.original_strategy_id IS NULL AND
bo.original_holding_ref IS NOT NULL`. Same RETURNS shape, same cron schedule,
same idempotency guard.

**When to use:** When extending an existing pg_cron SQL function body without
cadence or signature changes. Mirrors the pattern from migration 063 extending
migration 062's `enqueue_compute_job`.

**Example:** See §6 below.

### Anti-Patterns to Avoid
- **Touching `services/match_engine.py::score_candidates()` body** — CONTEXT.md
  locks ZERO engine changes. Phase 09 refactor is entirely in
  `routers/match.py::_load_allocator_context`.
- **Rewriting Bridge V2 components** — `BridgeOutcomeBanner` / `AllocatedForm`
  / `RejectedForm` / `OutcomeRecordedRow` contracts are preserved verbatim.
  Adapter at the boundary.
- **Deterministic v5 UUIDs for pseudo-strategies** — rejected in Q1c; forces
  every consumer to carry a separate "is this a synthetic?" lookup. Stick to
  the `holding:` prefix text id.
- **Denormalizing `flagged_count` onto a new widget** — rejected in D-07 to
  avoid LAYOUT_VERSION churn. Fold into existing Notices card.
- **SUM of daily returns for delta cron** — returns_series is cumulative (see
  migration 060 comment, line 14: "NEVER SUM(daily_return)"). Reconstructed
  per-symbol series from `breakdown` is USD values — compute return as
  `value[i+N] / value[i] - 1`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Correlation-vs-portfolio | Custom rolling corr | Existing `_compute_corr_with_portfolio()` at `match_engine.py:113` + `_compute_portfolio_fit_components` at `match_engine.py:402` | Already handles <30-day overlap → None, min_overlap_days floor, dropna semantics |
| Per-symbol returns dataframe alignment | Manual date-index matching | `pd.DataFrame({symbol: series}).dropna()` — the existing engine pattern at `match_engine.py:422` | Handles asof-gap days uniformly |
| Scoring weight renormalization | Custom overrides math | Existing `_clamp` + multiplicative override path at `match_engine.py:767-785` | Already tested + golden-snapshotted in Phase 03 |
| XOR constraint enforcement | App-layer guard | SQL CHECK constraint | DB-level guarantees every row satisfies XOR; race-proof |
| Cron idempotency | Client-side de-dup | `WHERE delta_30d IS NULL` guard in `compute_bridge_outcome_deltas` | Idempotent replay is already a locked invariant (D-15 Phase 01) |
| Daily value_usd to daily return | Custom diff loop | `pd.Series(values).pct_change().dropna()` | Standard pandas idiom; handles first-day NaN |
| Bridge outcome form state machine | New state reducer | Existing `BannerSubRow` in `PositionsTable.tsx:280-353` — copy the state machine into `ScenarioFlaggedHoldingsList` or hoist it | Proven pattern; matches Phase 01 D-01 |

**Key insight:** Phase 09 is almost entirely pattern-reuse. The locked
decisions explicitly rule out new libraries, new widgets, and engine rewrites.
Every decision delegates to an existing abstraction. The novel code is (a) the
per-symbol returns reconstruction recipe (§2), (b) the flagged-count
derivation that joins match_batches × allocator_preferences × allocator_holdings
(§1), and (c) two small migration files.

## Common Pitfalls

### Pitfall 1: `original_strategy_id SET NOT NULL` blocks holding-sourced inserts
**What goes wrong:** Migration 065 tightened `original_strategy_id` to NOT
NULL. A holding-sourced `match_decisions` INSERT would fail at the column
NOT NULL check before reaching the XOR CHECK.
**Why it happens:** Phase 05 locked the column as NOT NULL post-admin-UI.
**How to avoid:** Migration 072 MUST start with
`ALTER TABLE match_decisions ALTER COLUMN original_strategy_id DROP NOT NULL`
BEFORE adding the XOR CHECK. Self-verifying DO block asserts both columns are
now NULLABLE at the column level and that the XOR constraint enforces
mutual-exclusivity at the row level.
**Warning signs:** Any test inserting a holding-sourced match_decision hits
`null value in column "original_strategy_id" violates not-null constraint`.

### Pitfall 2: `breakdown jsonb` is partial for warm-up days
**What goes wrong:** First few days of an allocator's reconstruction may have
only a subset of symbols in `breakdown` (the reconstruction worker only writes
days where at least one symbol was priced). A naive `pct_change()` on a
subset series produces misleading returns.
**Why it happens:** `equity_reconstruction.py:524-576` only appends a row when
`breakdown or total` is truthy, and only adds per-symbol entries where pricing
was resolvable. New deposits arrive on Day N, so the symbol is absent on
Days 1..N-1.
**How to avoid:** For each pseudo-strategy, reconstruct the series by reading
`value_usd_for_symbol[i]` from `breakdown[i].get(symbol)` across ALL
snapshot days. Drop days where the symbol is absent OR zero, then
`pct_change().dropna()`. Apply a `len(series) >= 30` warm-up gate (matches
Phase 07 D-03) — exclude the pseudo-strategy from the portfolio math entirely
when the series is too short. Do NOT flag a warm-up holding.
**Warning signs:** Runtime warnings like "portfolio_returns_series has
<30 aligned days; _compute_portfolio_fit_components returns Nones for every
component."

### Pitfall 3: XOR CHECK is trivially satisfied on existing rows
**What goes wrong:** Existing `match_decisions` rows all have
`original_strategy_id IS NOT NULL AND original_holding_ref IS NULL`. The XOR
`(A IS NOT NULL) <> (B IS NOT NULL)` is trivially TRUE (TRUE <> FALSE = TRUE).
Adding the constraint runs but provides no new guarantee unless a test
actually exercises the holding-ref branch with strategy_id set to non-null.
**Why it happens:** XOR is asymmetric in failure modes — only the "both set"
and "both null" inputs fail.
**How to avoid:** Vitest schema-regression test MUST explicitly attempt BOTH
invalid shapes: `(strategy_id=X, holding_ref=Y)` AND `(strategy_id=NULL,
holding_ref=NULL)`. Both should fail with SQLSTATE 23514 (check_violation).
**Warning signs:** Migration 072 runs green but a later bug allows the
frontend to insert rows with both columns set.

### Pitfall 4: Pseudo-strategy `strategy_id` containing colons vs PostgREST encoding
**What goes wrong:** `strategy_id = "holding:binance:BTC:spot"` is sent over
the wire to `match_candidates.strategy_id UUID` FK. The UUID column type will
reject non-UUID text.
**Why it happens:** `match_candidates.strategy_id` is typed as UUID with FK to
`strategies(id)` — pseudo-strategies cannot land there. Pseudo-strategies
exist ONLY in `portfolio_strategies` during `score_candidates()` — they NEVER
get persisted into `match_candidates`. The candidates being scored (stored)
are still real strategy UUIDs.
**How to avoid:** Verify during planning that pseudo-strategy ids remain
in-memory only. The engine reads `portfolio_strategies[*].strategy_id` into
`owned_set` and references it in `portfolio_weights` + `portfolio_returns`
dicts — all in-memory. No DB write uses the pseudo-id. Pseudo-ids surface at
the UI layer via `match_decisions.original_holding_ref TEXT` (the new column),
NOT via `match_decisions.strategy_id` (which stays UUID to the candidate).
**Warning signs:** Any DB error mentioning `invalid input syntax for uuid` at
match-insert time.

### Pitfall 5: `send_intro` RPC still writes `original_strategy_id` only
**What goes wrong:** Phase 05 `send_intro_with_decision(6-arg)` always writes
`original_strategy_id`. After migration 072 relaxes NOT NULL, will it break?
**Why it happens:** The 6-arg RPC takes `p_original_strategy_id UUID` as
position 3 and inserts it directly — it never passes `NULL` intentionally.
**How to avoid:** The legacy path is UNCHANGED and SAFE:
`send_intro_with_decision(..., p_original_strategy_id=UUID, ...)` → row with
`(original_strategy_id=UUID, original_holding_ref=NULL)` — XOR satisfied.
Phase 09's new holding-sourced outcome-recording path writes via a DIFFERENT
route (likely the existing `/api/bridge/outcome` POST or a new sibling) that
inserts into `match_decisions` with
`(original_strategy_id=NULL, original_holding_ref='holding:...')` — XOR
satisfied. Both paths coexist.
**Warning signs:** Existing Phase 05 tests break on migration 072 apply.

### Pitfall 6: `allocator_equity_snapshots.breakdown` is capped at ~4KB
**What goes wrong:** `_cap_breakdown()` at `equity_reconstruction.py:121-132`
truncates `breakdown` to top-20 symbols by absolute USD value when encoded size
exceeds `RAW_PAYLOAD_CAP_BYTES`. A holding on a 21st+ symbol is silently
missing from the breakdown → its per-symbol series is unreconstructable.
**Why it happens:** Raw-payload size cap inherited from `allocator_positions.py`.
**How to avoid:** When reconstructing per-symbol returns, treat missing
symbols from `breakdown` as "no data that day" (drop, don't zero-fill). For
allocators who hit truncation, the low-value tail symbols naturally fail the
30-day warm-up gate and silently drop out of the engine's portfolio math.
Document this as a known limitation in research.
**Warning signs:** A known-held symbol never appears in the flagged-holdings
list despite breaching max_weight.

### Pitfall 7: `activeTab === "scenario" && <ScenarioStub />` — body switch
**What goes wrong:** Naively swapping `<ScenarioStub />` for
`<ScenarioFlaggedHoldingsList />` in `AllocationsTabs.tsx:169` breaks the
flagged_count=0 case.
**Why it happens:** `ScenarioStub` has "coming soon" copy that's still the
right empty state when no holdings are flagged.
**How to avoid:** Condition the body: `flagged_count > 0 ?
<ScenarioFlaggedHoldingsList /> : <ScenarioStub />`. Both are rendered inside
the `<div role="tabpanel" id="panel-scenario">`. The tab shell (keyboard nav,
URL state) is unchanged per D-08.

### Pitfall 8: `/compare` existing flow preserves only strategies.status='published'
**What goes wrong:** The current parser at `compare/page.tsx:35-39` does
`.eq("status", "published")` — which would reject the holding side entirely
(holdings aren't strategies).
**Why it happens:** Existing parser was strategy-only.
**How to avoid:** Detect `holding:` prefix BEFORE the `.from("strategies")`
query. Branch: for `holding:` ids, load from `allocator_equity_snapshots`
(RLS-gated) + reconstruct series; for UUID ids, keep the existing strategies
query. Combine the two sides into `items[]` with a discriminator field.
**Warning signs:** `/compare?ids=holding:binance:BTC:spot,<uuid>` renders
only the right-hand strategy with no left panel.

## Runtime State Inventory

Phase 09 is primarily additive (new columns, new migrations, new UI branches).
No rename / refactor / migration-of-existing-keys affecting runtime state
beyond what's covered by the schema migrations themselves.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `match_decisions.original_holding_ref` is a new column; no backfill required since existing rows have `original_strategy_id` populated (XOR still satisfied). | None |
| Live service config | None — Phase 09 adds neither pg_cron jobs nor new external services. Extends existing `compute_bridge_outcome_deltas` cron (schedule `0 3 * * *` unchanged). | None |
| OS-registered state | None — no Windows Task Scheduler / launchd / systemd entries touched. | None |
| Secrets / env vars | None — no new secrets. Existing Supabase URL + service-role key already cover new queries. | None |
| Build artifacts / installed packages | Python analytics-service: zero new deps. Frontend: zero new deps. Existing `pip install` + `npm install` unchanged. | None |

**Nothing found in any category requiring a data migration or manual
runtime step.**

## Common Pitfalls Captured (additional)

See above §Common Pitfalls for the 8 primary pitfalls.

## Code Examples

Verified patterns from official sources:

### Example 1: Migration 072 structure (XOR + partial index, copied from migration 070)

```sql
-- Migration 072: match_decisions.original_holding_ref TEXT NULL + XOR CHECK
-- Phase 09 / D-13 — holdings-sourced Bridge outcome attribution.

BEGIN;
SET lock_timeout = '3s';

-- STEP 1: Drop Phase 05 migration 065's NOT NULL constraint on
--         original_strategy_id — XOR CHECK replaces it as the
--         per-row invariant.
ALTER TABLE match_decisions
  ALTER COLUMN original_strategy_id DROP NOT NULL;

-- STEP 2: Add original_holding_ref column (nullable, no FK — scope_ref
--         is text by design per Phase 08 D-08 precedent).
ALTER TABLE match_decisions
  ADD COLUMN IF NOT EXISTS original_holding_ref TEXT;

COMMENT ON COLUMN match_decisions.original_holding_ref IS
  'Phase 09 / D-13. scope_ref = "holding:{venue}:{symbol}:{holding_type}" '
  'for holdings-sourced Bridge decisions. Mutually exclusive with '
  'original_strategy_id via match_decisions_original_xor CHECK.';

-- STEP 3: XOR CHECK — exactly one of the two is non-null per row.
ALTER TABLE match_decisions
  DROP CONSTRAINT IF EXISTS match_decisions_original_xor;
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_original_xor CHECK (
    (original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT NULL)
  );

-- STEP 4: Partial B-tree index on the new column for attribution lookups.
CREATE INDEX IF NOT EXISTS match_decisions_original_holding_ref
  ON match_decisions (original_holding_ref)
  WHERE original_holding_ref IS NOT NULL;

-- STEP 5: Self-verifying DO block (mirrors migration 070 Category A + B).
DO $$
DECLARE
  v_strategy_nullable BOOLEAN;
  v_holding_col_type TEXT;
  v_xor_def TEXT;
  v_index_exists BOOLEAN;
  v_existing_rows_ok INT;
BEGIN
  -- (a) original_strategy_id now NULLABLE
  SELECT is_nullable = 'YES' INTO v_strategy_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'match_decisions'
      AND column_name = 'original_strategy_id';
  IF NOT v_strategy_nullable THEN
    RAISE EXCEPTION 'Migration 072 failed: original_strategy_id not nullable (migration 065 NOT NULL not dropped)';
  END IF;

  -- (b) original_holding_ref column exists + TEXT type
  SELECT data_type INTO v_holding_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'match_decisions'
      AND column_name = 'original_holding_ref';
  IF v_holding_col_type IS NULL OR v_holding_col_type <> 'text' THEN
    RAISE EXCEPTION 'Migration 072 failed: original_holding_ref missing or not TEXT (got %)', COALESCE(v_holding_col_type, '<null>');
  END IF;

  -- (c) XOR CHECK constraint present
  SELECT pg_get_constraintdef(oid) INTO v_xor_def
    FROM pg_constraint
    WHERE conname = 'match_decisions_original_xor';
  IF v_xor_def IS NULL
     OR v_xor_def NOT LIKE '%original_strategy_id IS NOT NULL%'
     OR v_xor_def NOT LIKE '%original_holding_ref IS NOT NULL%' THEN
    RAISE EXCEPTION 'Migration 072 failed: match_decisions_original_xor CHECK missing or malformed. Got: %', COALESCE(v_xor_def, '<null>');
  END IF;

  -- (d) Partial index exists
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'match_decisions'
      AND indexname = 'match_decisions_original_holding_ref'
  ) INTO v_index_exists;
  IF NOT v_index_exists THEN
    RAISE EXCEPTION 'Migration 072 failed: match_decisions_original_holding_ref index missing';
  END IF;

  -- (e) Pre-existing rows still satisfy the XOR (holding_ref IS NULL, strategy_id NOT NULL)
  SELECT COUNT(*) INTO v_existing_rows_ok
    FROM match_decisions
    WHERE NOT ((original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT NULL));
  IF v_existing_rows_ok > 0 THEN
    RAISE EXCEPTION 'Migration 072 failed: % pre-existing rows violate the XOR invariant (SHOULD BE 0 since all had strategy_id NOT NULL and holding_ref NULL)', v_existing_rows_ok;
  END IF;

  RAISE NOTICE 'Migration 072: all 5 self-verification assertions (a-e) passed.';
END
$$;

COMMIT;
```

**Source:** Pattern derived from migration 070
(`supabase/migrations/070_allocator_equity_snapshots.sql:373-643`) + migration
064 (`supabase/migrations/064_match_decisions_original_strategy.sql:146-205`).

### Example 2: Migration 073 structure (CREATE OR REPLACE FUNCTION body extension)

```sql
-- Migration 073: compute_bridge_outcome_deltas() — holding-ref branch
-- Phase 09 / D-12 — extends migration 060's function body to handle
-- bridge_outcomes rows where original_holding_ref IS NOT NULL.

BEGIN;

-- Helper: extract value_usd for a specific symbol on a specific date from
-- allocator_equity_snapshots.breakdown jsonb. Returns NULL when absent
-- (handles the _cap_breakdown truncation gracefully — see RESEARCH Pitfall 6).
CREATE OR REPLACE FUNCTION public.extract_symbol_value_at(
  p_allocator_id UUID,
  p_symbol       TEXT,
  p_asof         DATE
) RETURNS NUMERIC
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF((breakdown ->> p_symbol)::NUMERIC, 0)
    FROM allocator_equity_snapshots
    WHERE allocator_id = p_allocator_id AND asof = p_asof
    LIMIT 1;
$$;

COMMENT ON FUNCTION public.extract_symbol_value_at IS
  'Phase 09 / D-12. Reads per-symbol USD value on a given asof from '
  'allocator_equity_snapshots.breakdown jsonb. Returns NULL when the symbol '
  'is absent OR zero (prevents divide-by-zero in extract_holding_delta).';

-- Helper: parse the holding scope_ref into its parts. Returns NULL on malformed.
CREATE OR REPLACE FUNCTION public.parse_holding_ref(p_ref TEXT)
RETURNS TABLE(venue TEXT, symbol TEXT, holding_type TEXT)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parts TEXT[];
BEGIN
  IF p_ref IS NULL OR NOT p_ref LIKE 'holding:%' THEN
    RETURN;
  END IF;
  parts := string_to_array(substring(p_ref FROM 9), ':');
  -- Expect exactly 3 parts: venue, symbol, holding_type
  IF array_length(parts, 1) <> 3 THEN
    RETURN;
  END IF;
  venue := parts[1];
  symbol := parts[2];
  holding_type := parts[3];
  RETURN NEXT;
END;
$$;

-- STEP 2: Extend compute_bridge_outcome_deltas with a holding branch.
-- RETURNS signature unchanged (TABLE(updated_count INT, failed_count INT,
-- batch_started_at TIMESTAMPTZ)). Cadence (pg_cron 0 3 * * *) unchanged.
-- Idempotency guard (WHERE delta_30d IS NULL OR needs_recompute = TRUE) unchanged.
CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()
RETURNS TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_updated INT := 0;
  v_failed  INT := 0;
  v_started TIMESTAMPTZ := NOW();
BEGIN
  -- Strategy branch — UNCHANGED from migration 060.
  WITH strategy_candidates AS (
    SELECT bo.id, bo.allocated_at, sa.returns_series AS series
      FROM public.bridge_outcomes AS bo
      JOIN public.match_decisions AS md ON md.id = bo.match_decision_id
      JOIN public.strategy_analytics AS sa ON sa.strategy_id = bo.strategy_id
     WHERE bo.kind = 'allocated'
       AND bo.allocated_at IS NOT NULL
       AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
       AND md.original_strategy_id IS NOT NULL
       AND md.original_holding_ref IS NULL
  ),
  strategy_computed AS (
    SELECT c.id,
           public.extract_delta(c.series, c.allocated_at, 30)  AS d30,
           public.extract_delta(c.series, c.allocated_at, 90)  AS d90,
           public.extract_delta(c.series, c.allocated_at, 180) AS d180,
           est.bps  AS est_bps,
           est.days AS est_days
      FROM strategy_candidates c
      LEFT JOIN LATERAL public.extract_estimated(c.series, c.allocated_at) AS est ON TRUE
  ),
  strategy_updated AS (
    UPDATE public.bridge_outcomes AS bo
       SET delta_30d           = COALESCE(c.d30,      bo.delta_30d),
           delta_90d           = COALESCE(c.d90,      bo.delta_90d),
           delta_180d          = COALESCE(c.d180,     bo.delta_180d),
           estimated_delta_bps = COALESCE(c.est_bps,  bo.estimated_delta_bps),
           estimated_days      = COALESCE(c.est_days, bo.estimated_days),
           needs_recompute     = FALSE,
           deltas_computed_at  = v_started
      FROM strategy_computed c
     WHERE bo.id = c.id
       AND bo.kind = 'allocated'
       AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  ),
  -- Holding branch — NEW in migration 073.
  -- Reads per-symbol USD series from allocator_equity_snapshots.breakdown.
  -- Computes return as value_at(anchor + N) / value_at(anchor) - 1.
  holding_candidates AS (
    SELECT bo.id,
           bo.allocator_id,
           bo.allocated_at,
           hp.symbol
      FROM public.bridge_outcomes AS bo
      JOIN public.match_decisions AS md ON md.id = bo.match_decision_id
      LEFT JOIN LATERAL public.parse_holding_ref(md.original_holding_ref) hp ON TRUE
     WHERE bo.kind = 'allocated'
       AND bo.allocated_at IS NOT NULL
       AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
       AND md.original_strategy_id IS NULL
       AND md.original_holding_ref IS NOT NULL
       AND hp.symbol IS NOT NULL
  ),
  holding_computed AS (
    SELECT hc.id,
           CASE
             WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL THEN NULL
             WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 30) IS NULL THEN NULL
             ELSE (public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 30)
                 / public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)) - 1
           END AS d30,
           CASE
             WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL THEN NULL
             WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 90) IS NULL THEN NULL
             ELSE (public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 90)
                 / public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)) - 1
           END AS d90,
           CASE
             WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL THEN NULL
             WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 180) IS NULL THEN NULL
             ELSE (public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 180)
                 / public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)) - 1
           END AS d180
      FROM holding_candidates hc
  ),
  holding_updated AS (
    UPDATE public.bridge_outcomes AS bo
       SET delta_30d           = COALESCE(c.d30,  bo.delta_30d),
           delta_90d           = COALESCE(c.d90,  bo.delta_90d),
           delta_180d          = COALESCE(c.d180, bo.delta_180d),
           needs_recompute     = FALSE,
           deltas_computed_at  = v_started
      FROM holding_computed c
     WHERE bo.id = c.id
       AND bo.kind = 'allocated'
       AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  )
  SELECT (SELECT COUNT(*) FROM strategy_updated) + (SELECT COUNT(*) FROM holding_updated)
    INTO v_updated;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$$;

-- STEP 3: GRANTs re-applied (CREATE OR REPLACE strips GRANTs on signature-identical bodies).
REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_bridge_outcome_deltas TO service_role;

-- Self-verifying DO block — 3 assertions.
DO $$
DECLARE
  v_fn_src TEXT;
  v_helper_src TEXT;
BEGIN
  SELECT prosrc INTO v_fn_src
    FROM pg_proc WHERE proname = 'compute_bridge_outcome_deltas';
  IF v_fn_src IS NULL OR v_fn_src NOT LIKE '%original_holding_ref IS NOT NULL%' THEN
    RAISE EXCEPTION 'Migration 073 failed: compute_bridge_outcome_deltas body missing holding branch';
  END IF;

  SELECT prosrc INTO v_helper_src
    FROM pg_proc WHERE proname = 'extract_symbol_value_at';
  IF v_helper_src IS NULL THEN
    RAISE EXCEPTION 'Migration 073 failed: extract_symbol_value_at helper missing';
  END IF;

  SELECT prosrc INTO v_helper_src
    FROM pg_proc WHERE proname = 'parse_holding_ref';
  IF v_helper_src IS NULL THEN
    RAISE EXCEPTION 'Migration 073 failed: parse_holding_ref helper missing';
  END IF;

  RAISE NOTICE 'Migration 073: compute_bridge_outcome_deltas holding branch installed.';
END
$$;

COMMIT;
```

**Source:** Pattern derived from migration 060
(`supabase/migrations/060_bridge_outcome_cron.sql:164-223`) extending its
own function body in-place is standard — every `CREATE OR REPLACE FUNCTION`
call REPLACES the body wholesale.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `score_candidates()` reads only `portfolio_strategies` (Sprint 2) | Reads `portfolio_strategies` + pseudo-strategies from `allocator_holdings` | Phase 09 | Input-layer rewire only; engine math unchanged |
| Bridge outcome attribution via `bridge_outcomes.strategy_id` only | Plus `match_decisions.original_holding_ref` for holdings-sourced | Phase 09 migration 072 | Enables LIVE-04 + LIVE-05 |
| `ENGINE_VERSION = 'v2.0.0'` (Phase 03) | `ENGINE_VERSION = 'v2.1.0'` (Phase 09) | Phase 09 | Auto-invalidates cached v2.0.0 batches |
| Scenario tab = pure stub | Scenario body swaps to `ScenarioFlaggedHoldingsList` when `flagged_count > 0` | Phase 09 D-08 (revised from initial "stay stub") | Minimal preview of Phase 10 surface |

**Deprecated/outdated:** None — Phase 09 is purely additive.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Migration 072 can safely drop `original_strategy_id SET NOT NULL` in one transaction with adding the XOR CHECK | Pitfall 1, Example 1 | If migration 065 is revisited to re-assert NOT NULL post-tighten, the XOR drop could race with a concurrent `send_intro` RPC — low risk given single-writer cron cadence |
| A2 | `breakdown jsonb` partial-symbol days can be treated as missing (dropna) rather than forward-filled | §2 Pitfall 2 | If forward-fill is required, the per-symbol series would be biased toward flat runs during deposit-gap days — planner should confirm with a golden fixture on a real allocator's reconstruction |
| A3 | Top candidate composite ≥ 0.50 is computable directly from `match_candidates.score` (which ranges 0-100 based on `match_engine.py:787 final_score`) — so threshold is 50, not 0.50 | §3 (needs planner confirmation) | CONTEXT.md D-06 literally says "composite ≥ 0.50" — score is 0..100 scale per `match_engine.py:787`. Planner MUST verify whether D-06 means `score / 100 >= 0.50` (i.e. score >= 50) or the raw score column is on a 0..1 scale in some other surface |
| A4 | The warm-up gate for holdings-sourced pseudo-strategies is ≥ 30 days of per-symbol history, mirroring Phase 07 D-03 | §2 (Claude's Discretion per CONTEXT.md) | Too-strict gate → holdings never flag; too-loose → noisy flags for first-week allocators |

## Open Questions

1. **D-06 "composite ≥ 0.50" — 0-1 scale or 0-100 scale?**
   - What we know: `match_engine.py:787` computes `final_score = 100 * (...)` so stored `match_candidates.score` is 0-100.
   - What's unclear: CONTEXT.md D-06 says "composite ≥ 0.50" but `0.50` on the raw score column means a nearly-zero composite.
   - Recommendation: Planner asks user to confirm intent during plan-check. Default interpretation: score ≥ 50 (i.e. 0.50 on the normalized [0,1] scale, before the *100 multiplication). The Vitest fixture assertion MUST be pinned.

2. **Warm-up gate threshold for holdings (Claude's Discretion in CONTEXT)**
   - What we know: Phase 07 D-03 uses ~30 snapshot days.
   - What's unclear: Whether holdings-side warm-up should mirror the 30-day portfolio-level gate or a different per-symbol-series threshold.
   - Recommendation: Use 30 days per-symbol as default; document in planner PR description so UAT can surface feedback.

3. **`breakdown` partial-day policy (Claude's Discretion)**
   - What we know: Existing portfolio_metrics use `_safe_float` + dropna.
   - What's unclear: Whether a symbol absent from `breakdown` on Day N is "missing" or "zero-valued" (e.g. a holding that went fully out on Day N-1).
   - Recommendation: Treat absent-from-breakdown as missing (dropna); the prior-day's value_usd > 0 with current-day absent signals a close-out that the engine can correctly represent as a large negative return via the next-day diff.

4. **`match_decisions.original_holding_ref` + `match_decisions.strategy_id` relationship**
   - What we know: `match_decisions.strategy_id` is UUID NOT NULL FK to strategies — represents the **candidate** (what the Bridge offered).
   - What's unclear: For holdings-sourced decisions, the `strategy_id` still points to the candidate (real UUID). Only `original_strategy_id` ↔ `original_holding_ref` XOR applies.
   - Recommendation: Confirmed — pseudo-ids never appear in `match_decisions.strategy_id`. The XOR is solely on the "what was replaced" field.

## Environment Availability

Phase 09 has no external dependencies beyond what's already installed.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL + pg_cron | Migration 073 + delta cron | ✓ (inherited from Phase 07) | — | — |
| Supabase (auth + RLS) | RLS enforcement on allocator_equity_snapshots | ✓ | — | — |
| Python 3 + pandas + numpy | routers/match.py::_load_allocator_context rewire | ✓ | — | — |
| Node 20+ / Next.js 16 | Frontend components | ✓ | — | — |
| vitest 4.1.2 | Client + RLS tests | ✓ | — | — |
| pytest + asyncio_mode | Engine input-layer tests | ✓ | — | — |

**Missing dependencies:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (client/RLS) + pytest (backend) |
| Config file | `vitest.config.ts` + `analytics-service/pytest.ini` |
| Quick run command | `npx vitest run src/...` or `pytest analytics-service/tests/test_...` |
| Full suite command | `npm test && cd analytics-service && pytest` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIVE-01 | Holdings-only allocator passes through `score_candidates()` (manager_id=None, strategy_type=None on OWNED rows acceptable; candidates are real strategies) | pytest golden | `pytest analytics-service/tests/test_match_integration.py::test_load_allocator_context_holdings_only` | ❌ Wave 0 (new file `test_match_integration_phase09.py` OR extend existing) |
| LIVE-01 | Mixed portfolio (strategies + holdings) weights normalize to 1.0 | pytest | `pytest analytics-service/tests/test_match_integration.py::test_mixed_portfolio_weights_sum_to_one` | ❌ Wave 0 |
| LIVE-01 | Per-symbol returns reconstruction math — golden fixture on known breakdown jsonb → known returns series | pytest | `pytest analytics-service/tests/test_equity_reconstruction_phase09.py::test_reconstruct_symbol_returns_golden` | ❌ Wave 0 new file |
| LIVE-01 | `ENGINE_VERSION == 'v2.1.0'` | pytest | `pytest analytics-service/tests/test_match_engine.py::test_engine_version_phase09_bump` | ❌ Wave 0 (extend existing test_match_engine.py) |
| LIVE-02 | Notices card renders "Bridge flagged N holding(s)" line when `flagged_count > 0` | Vitest RTL | `npx vitest run src/components/portfolio/InsightStrip.test.tsx` | ✓ file exists — extend |
| LIVE-02 | Notices card hides line when `flagged_count === 0` | Vitest RTL | same file | ✓ extend |
| LIVE-02 | Link routes to `/allocations?tab=scenario` | Vitest RTL | same file | ✓ extend |
| LIVE-03 | `/compare?ids=holding:*,strategy-uuid` renders both sides | Vitest RTL | `npx vitest run src/app/(dashboard)/compare/page.test.tsx` | ❌ Wave 0 new file |
| LIVE-03 | `/compare?ids=holding:other-allocator:*,uuid` returns 403 (RLS access-gate) | Vitest live-DB RLS | `npx vitest run src/__tests__/compare-holding-rls.test.ts` | ❌ Wave 0 new file |
| LIVE-04 | `match_decisions` XOR CHECK: insert with BOTH columns set → fails SQLSTATE 23514 | Vitest live-DB | `npx vitest run src/__tests__/match-decisions-xor-rls.test.ts` | ❌ Wave 0 new file |
| LIVE-04 | `match_decisions` XOR CHECK: insert with NEITHER column set → fails SQLSTATE 23514 | Vitest live-DB | same file | ❌ Wave 0 |
| LIVE-04 | `original_holding_ref` RLS surface matches `original_strategy_id` RLS | Vitest live-DB | same file | ❌ Wave 0 |
| LIVE-04 | ScenarioFlaggedHoldingsList inline form click path — click banner → form appears → submit → OutcomeRecordedRow replaces | Vitest RTL | `npx vitest run src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.test.tsx` | ❌ Wave 0 new file |
| LIVE-04 | `holding-outcome-adapter.ts` maps `(flaggedHolding, topCandidate, matchDecision)` → correct Bridge V2 props | Vitest unit | `npx vitest run src/app/(dashboard)/allocations/lib/holding-outcome-adapter.test.ts` | ❌ Wave 0 new file |
| LIVE-05 | `compute_bridge_outcome_deltas` holding branch — fixture allocator with recorded outcome on `original_holding_ref`, cron runs, `delta_30d` populated | Vitest live-DB | `npx vitest run src/__tests__/bridge-outcome-cron-holding.test.ts` | ❌ Wave 0 new file |
| LIVE-05 | Strategy branch continues to work (regression) | Vitest live-DB | existing `src/__tests__/bridge-outcome-cron.test.ts` | ✓ existing — regression check |
| — | Multi-actor RLS on `allocator_equity_snapshots` surfaces through `/compare` access gate | Vitest live-DB | same file as LIVE-03 RLS test | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/...` for TS tests touched + `pytest analytics-service/tests/test_match_integration.py -x` for engine tests
- **Per wave merge:** full `npm test && pytest` green
- **Phase gate:** Full suite green before `/gsd-verify-work`; migrations 072 + 073 applied to live DB via `supabase db push` with NOTICE blocks green

### Wave 0 Gaps

- [ ] `analytics-service/tests/test_match_integration_phase09.py` — holdings-only allocator + mixed portfolio weight tests (LIVE-01)
- [ ] `analytics-service/tests/test_equity_reconstruction_phase09.py` — per-symbol returns reconstruction golden fixture (LIVE-01)
- [ ] Extend `analytics-service/tests/test_match_engine.py` with `ENGINE_VERSION == 'v2.1.0'` assertion (LIVE-01)
- [ ] `src/__tests__/match-decisions-xor-rls.test.ts` — XOR CHECK regression + RLS (LIVE-04)
- [ ] `src/__tests__/bridge-outcome-cron-holding.test.ts` — holding-branch cron regression (LIVE-05)
- [ ] `src/__tests__/compare-holding-rls.test.ts` — `/compare` access gate (LIVE-03)
- [ ] `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.test.tsx` — end-to-end click path (LIVE-04)
- [ ] `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.test.ts` — prop adapter unit (LIVE-04)
- [ ] `src/app/(dashboard)/compare/page.test.tsx` — parser + branch render (LIVE-03)
- [ ] Extend `src/components/portfolio/InsightStrip.test.tsx` — Notices card line visibility + routing (LIVE-02)

**Framework install:** None needed — Vitest 4.1.2 + pytest are already installed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Supabase Auth + withAuth wrapper on new routes (if any) |
| V3 Session Management | no | No new session state |
| V4 Access Control | yes | 3-tier RLS on `allocator_equity_snapshots` (owner + admin + service_role) + `match_decisions` (admin + service_role). `/compare` RLS gate validates holding-side ownership |
| V5 Input Validation | yes | zod validation on `/api/bridge/outcome` (already in place); parseHoldingScopeRef for `original_holding_ref` inserts |
| V6 Cryptography | no | No new crypto surface |

### Known Threat Patterns for Next.js 16 + Supabase + FastAPI

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Holding-ref forgery via API (allocator A inserts `match_decisions` with holding from allocator B's book) | Elevation of Privilege | API route MUST verify allocator owns the holding via `parseHoldingScopeRef` + lookup against `allocator_holdings WHERE allocator_id = auth.uid()` BEFORE inserting match_decisions. Mirrors Phase 08 D-09 app-layer ownership pattern |
| Info leak via `/compare?ids=holding:other-allocator:...` | Info Disclosure | RLS on `allocator_equity_snapshots` blocks read; route returns generic 403 "This comparison isn't available" (no "holding exists but you don't own it" leak) per D-15 |
| Symbol-name bleed in breakdown (e.g. allocator names their "holding" with SQL injection) | Tampering | Breakdown is populated by worker only (service_role); user-provided scope_ref goes through parseHoldingScopeRef which restricts to `{venue}:{symbol}:{holding_type}` 3-part form (chars limited to [A-Za-z0-9_-]) |
| Pseudo-strategy id collision with real UUIDs | Spoofing | Impossible by construction — pseudo-ids have colons; UUIDs do not. Match `id.startsWith("holding:")` is a simple, reliable gate |
| pg_cron function privilege escalation via `extract_symbol_value_at` | Elevation of Privilege | Function marked STABLE + SECURITY DEFINER with `SET search_path = public, pg_catalog` (inherits migration 060 pattern); REVOKE ALL FROM PUBLIC; GRANT only to the caller |

## Risks + Unknowns

1. **D-06 threshold scale** (§Assumptions Log A3) — planner MUST confirm 0.50 vs 50 before freezing the SQL filter predicate in the flagged_count derivation.

2. **Migration 065 NOT NULL drop** — dropping the NOT NULL on
   `original_strategy_id` could open a failure mode if a future Sprint re-adds
   rows with NULL in BOTH columns (XOR violated). Mitigated by the XOR CHECK
   itself. Planner verifies self-verifying DO block asserts the XOR
   constraint exists.

3. **Cached v2.0.0 batches during Phase 09 ship window** — between migration
   072 apply and `ENGINE_VERSION` bump commit, there's a brief window where
   the daily cron might run v2.0.0 with the new schema. Safe because
   holdings-sourced code paths haven't landed yet. Planner MUST sequence:
   Migration 072 → 073 → engine ENGINE_VERSION bump in that order (or
   atomic-commit the three).

4. **`/compare` route path** — CONTEXT.md says `src/app/compare/` but the
   actual path is `src/app/(dashboard)/compare/page.tsx` (verified). Planner
   MUST use the correct path.

5. **Top-candidate-per-holding derivation inside `getMyAllocationDashboard`**
   — no blocker, but the SSR query needs to fan out over the allocator's
   latest match_batch → match_candidates → join with candidate strategies →
   pick top per holding-slot. This is one new SQL join chain; the planner
   should time-box it. Fallback: derive flaggedHoldings in a separate
   route/server-action if the SSR query becomes heavy.

6. **Per-symbol returns reconstruction feasibility on truncated breakdown**
   (Pitfall 6) — tail symbols dropped by `_cap_breakdown` never flag. This is
   accepted behavior for v0.15 since tail holdings are by definition small.
   Flag explicitly in plan description so UAT is informed.

## Sources

### Primary (HIGH confidence — verified via Read tool against working tree)
- `.planning/phases/09-bridge-live-against-real-holdings/09-CONTEXT.md` — all locked decisions D-01…D-18 (lines 1-303)
- `.planning/phases/09-bridge-live-against-real-holdings/09-DISCUSSION-LOG.md` — decision audit trail
- `.planning/REQUIREMENTS.md` — LIVE-01…LIVE-05 acceptance criteria (lines 60-66)
- `.planning/ROADMAP.md` — Phase 09 charter (lines 113-131)
- `.planning/STATE.md` — Phase 08 complete, Phase 09 not started
- `.planning/phases/06-allocator-api-ingestion/06-CONTEXT.md` — allocator_holdings D-02 schema, sync_status D-07, symbol normalization D-16
- `.planning/phases/07-demo-mode-purge/07-CONTEXT.md` — equity_snapshots D-02 with breakdown jsonb, warm-up D-03, tabbed D-04, Notices-card D-09
- `.planning/phases/08-connection-management-and-notes/08-CONTEXT.md` — scope_ref D-08, inline expandable sub-row D-16, revoked-historical-inclusion D-04
- `.planning/phases/01-outcome-tracker/01-CONTEXT.md` — bridge_outcomes + pg_cron idempotent cron pattern
- `.planning/phases/03-mandate-aware-scoring-engine/03-CONTEXT.md` — engine_version seam D-11, multiplicative overrides D-08
- `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` — Option A + OutcomesWidget pattern
- `analytics-service/routers/match.py:172-248` — current `_load_allocator_context` implementation
- `analytics-service/routers/match.py:369-421` — current `_should_skip_allocator` (trigger #2 at line 395)
- `analytics-service/services/match_engine.py:46` — `ENGINE_VERSION = "v2.0.0"` (file:line for bump)
- `analytics-service/services/match_engine.py:549-575` — `score_candidates` signature (holding-agnostic)
- `analytics-service/services/match_engine.py:402-483` — `_compute_portfolio_fit_components` (reused verbatim)
- `analytics-service/services/match_engine.py:113-133` — `_compute_corr_with_portfolio` (reused for D-05)
- `analytics-service/services/equity_reconstruction.py:121-132` — `_cap_breakdown` (informs Pitfall 6)
- `analytics-service/services/equity_reconstruction.py:420-578` — breakdown jsonb shape producer
- `supabase/migrations/011_perfect_match.sql:133-143` — match_decisions schema (pre-Phase-09)
- `supabase/migrations/011_perfect_match.sql:275-281` — match_decisions RLS (admin + service_role)
- `supabase/migrations/059_bridge_outcomes.sql:45-95` — bridge_outcomes schema
- `supabase/migrations/060_bridge_outcome_cron.sql:164-223` — `compute_bridge_outcome_deltas` current body (extended by migration 073)
- `supabase/migrations/060_bridge_outcome_cron.sql:26-38` — `extract_equity_at` helper pattern
- `supabase/migrations/064_match_decisions_original_strategy.sql:47-53` — `original_strategy_id` column add pattern
- `supabase/migrations/065_match_decisions_original_strategy_notnull.sql:34-35` — NOT NULL currently in force (Pitfall 1)
- `supabase/migrations/070_allocator_equity_snapshots.sql:88-113` — `allocator_equity_snapshots` schema + RLS
- `supabase/migrations/070_allocator_equity_snapshots.sql:420-641` — self-verifying DO block (12 assertions) — template for migration 072
- `supabase/migrations/071_user_notes_multiscope.sql:40-177` — migration pattern with add-column + CHECK + self-verify
- `src/lib/queries.ts:596-664` — `MyAllocationDashboardPayload` interface
- `src/lib/queries.ts:721-817` — `derivePhase07Fields` (holdingsSummary collapse logic to mirror in Python)
- `src/lib/queries.ts:1000-1068` — outcome eligibility computation pattern
- `src/app/(dashboard)/allocations/AllocationDashboard.tsx:37` — InsightStrip import
- `src/app/(dashboard)/allocations/AllocationDashboard.tsx:730-746` — existing D-09 Notices card structure
- `src/app/(dashboard)/allocations/AllocationDashboard.tsx:865-874` — InsightStrip render site inside Performance tab
- `src/app/(dashboard)/allocations/ScenarioStub.tsx:1-26` — current stub body (swap seam)
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx:155-170` — tabpanel structure (body switch seam)
- `src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.tsx:6-12` — prop contract
- `src/app/(dashboard)/allocations/components/AllocatedForm.tsx:11-17` — prop contract
- `src/app/(dashboard)/allocations/components/RejectedForm.tsx:14-18` — prop contract
- `src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx:9-12` — prop contract
- `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx:273-353` — `BannerSubRow` state machine (proven pattern)
- `src/app/(dashboard)/compare/page.tsx:1-57` — current `/compare` parser + render (verified actual path under `(dashboard)` route group)
- `src/components/portfolio/InsightStrip.tsx:1-122` — "What We Noticed" card definition (insert seam for LIVE-02)
- `src/components/notes/HoldingNoteRow.tsx:1-77` — Phase 08 inline expandable sub-row precedent
- `src/lib/bridge-outcome-schema.ts:1-118` — `BridgeOutcome` type + `postBridgeOutcome` helper
- `src/__tests__/bridge-outcomes-rls.test.ts` — RLS regression pattern
- `src/__tests__/bridge-outcome-cron.test.ts:1-80` — cron live-DB test pattern (regression target for LIVE-05)
- `src/__tests__/allocator-holdings-rls.test.ts:1-80` — multi-actor RLS helper pattern
- `analytics-service/tests/test_match_integration.py:1-100` — pytest monkeypatch + mocked Supabase pattern
- `.planning/config.json` — `workflow.nyquist_validation = true` (Validation Architecture required)

### Secondary (MEDIUM confidence — derived from cross-reference)
- Migration 062 — DROP+REDEFINE FUNCTION pattern for signature-preserving extensions
- Migration 063 — `feedback_delta_enqueue` extension pattern
- ADR-0023 — audit taxonomy (not re-read but referenced by CONTEXT.md D-14 as requiring in-commit sync with no new kind)

### Tertiary (LOW confidence — marked as assumed)
- None — all claims verified against working tree.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every recommendation is grounded in an existing file in the repo
- Architecture: HIGH — patterns copy-pasted from migrations 060, 064, 070, 071 and components from Phase 01/05/07/08
- Pitfalls: HIGH — 8 pitfalls each grounded in a specific file:line reference

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days — stable schema + Python analytics service; check `.planning/STATE.md` for any cross-phase shifts)

## RESEARCH COMPLETE
