# Phase 09: Bridge Live Against Real Holdings — Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 12 (4 new SQL/TS + 8 modified) + 10 Wave 0 test files
**Analogs found:** 12 / 12 (all have concrete in-repo precedents)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/072_match_decisions_original_holding_ref.sql` | migration (schema) | DDL → CHECK + partial index + DO-block self-verify | `supabase/migrations/070_allocator_equity_snapshots.sql` (DO-block) + `supabase/migrations/064_match_decisions_original_strategy.sql` (column+index+self-verify) + `supabase/migrations/065_match_decisions_original_strategy_notnull.sql` (drop NOT NULL precedent, inverse) | exact |
| `supabase/migrations/073_compute_bridge_outcome_deltas_holding_branch.sql` | migration (pg-function) | `CREATE OR REPLACE FUNCTION` extends cron body | `supabase/migrations/060_bridge_outcome_cron.sql` (whole-body replacement + SQL helpers + GRANT + DO-block) | exact |
| `analytics-service/routers/match.py::_load_allocator_context` | engine-adapter (FastAPI) | `allocator_holdings` + `allocator_equity_snapshots.breakdown` → dict-of-lists for `score_candidates()` | `analytics-service/routers/match.py::_load_allocator_context` (current body, lines 172-248) + `analytics-service/routers/match.py::_load_universe` (lines 100-170 — builds a tuple-of-dicts from multiple upstream tables) | role + shape match |
| `analytics-service/services/match_engine.py::ENGINE_VERSION` | constant bump | one-line version string | `analytics-service/services/match_engine.py:46` (existing `"v2.0.0"`) | exact self-analog |
| `src/lib/queries.ts::getMyAllocationDashboard` | query-layer (SSR) | Supabase fan-out + `derivePhase07Fields` → `MyAllocationDashboardPayload` | `src/lib/queries.ts:819-900` current function body, plus `derivePhase07Fields` at lines 740-817 for the holdings-collapse convention | exact |
| `src/app/(dashboard)/allocations/AllocationDashboard.tsx` | component (client dashboard) | payload props → `widgetData` + `<InsightStrip>` + `<ScenarioStub>` | `AllocationDashboard.tsx:561-585` (`widgetData` useMemo) + lines 865-874 (InsightStrip integration) | exact self-analog |
| `src/components/portfolio/InsightStrip.tsx` | component (insights line) | analytics → bulleted list | `InsightStrip.tsx:79-122` (current list render) | exact self-analog |
| `src/app/(dashboard)/allocations/ScenarioStub.tsx` | component (tab body swap) | zero-data placeholder → conditional body | `AllocationsTabs.tsx:163-170` (tabpanel conditional render) + `ScenarioStub.tsx:14-26` | exact self-analog |
| `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx` (NEW) | component (inline-expandable list) | flaggedHoldings[] → Fragment sub-row pattern → Bridge V2 quartet | `PositionsTable.tsx::BannerSubRow` (lines 273-353) — state machine `banner → allocated → rejected → dismissed` + `OutcomesWidget.tsx::TimelineRow` (lines 401-561) — Fragment + `isExpanded` one-open-at-a-time + `HoldingNoteRow.tsx` (full-width `<tr colSpan>` convention) | exact (state machine + expand) |
| `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` (NEW) | adapter-util (client pure TS) | `(FlaggedHolding, topCandidate, matchDecision)` → `BridgeOutcomeBanner`/`AllocatedForm` props | `src/lib/portfolio-analytics-adapter.ts` (adapter-at-the-boundary convention, lines 1-80) — only pure-TS adapter living under `src/lib/`; no sibling exists under `src/app/(dashboard)/allocations/lib/` today (directory currently holds `dashboard-defaults.ts`, `types.ts`, `widget-registry.ts` — Phase 09 establishes the `lib/holding-outcome-adapter.ts` convention) | role-match |
| `src/app/(dashboard)/compare/page.tsx` | frontend-server (SSR route) | `searchParams.ids` → Supabase strategies fetch → `<CompareTable>` | `compare/page.tsx:11-57` (current parser at line 21, `.from("strategies")...eq("status","published")` fetch at lines 35-39) | exact self-analog |
| `docs/architecture/adr-0023-audit-event-taxonomy.md` | doc | ADR append (Phase 09 section) | any prior "Phase NN section" in `adr-0023` (same file, ADR-0023 is the canonical audit taxonomy doc; Phase 06 and Phase 08 already appended sections — new Phase 09 section follows that append convention) | exact self-analog |

## Pattern Assignments

### `supabase/migrations/072_match_decisions_original_holding_ref.sql` (migration, schema)

**Analog:** `supabase/migrations/070_allocator_equity_snapshots.sql` (DO-block self-verify) + `supabase/migrations/064_match_decisions_original_strategy.sql` (column addition + FK + self-verify) + `supabase/migrations/065_match_decisions_original_strategy_notnull.sql` (NOT NULL guard — inverse: Phase 09 DROPS it)

**Migration header pattern** (070 lines 1-75):
```sql
-- Migration NNN: <one-line title>
-- Phase NN / <requirement> — <one-sentence purpose>
--
-- What this migration does (N-step ordering, mirrors migration <prev> shape)
-- ...
-- What this migration does NOT do
-- ...
-- Application path: authored here; applied via `supabase db push`.
-- Self-verifying DO block raises EXCEPTION on any invariant failure.

BEGIN;
SET lock_timeout = '3s';
```

**Column addition + comment** (064 lines 47-52):
```sql
ALTER TABLE match_decisions
  ADD COLUMN original_strategy_id UUID
    REFERENCES strategies(id) ON DELETE RESTRICT;

COMMENT ON COLUMN match_decisions.original_strategy_id IS
  'FK to strategies(id) naming the underperformer... See .planning/phases/05-outcomes-dashboard/05-CONTEXT.md D-20a (revised).';
```

**DROP NOT NULL precedent** (inverse of 065 lines 32-35 — Phase 09 reverses this direction):
```sql
-- 065 tightened:
ALTER TABLE match_decisions
  ALTER COLUMN original_strategy_id SET NOT NULL;
-- Phase 09 (072) RELAXES it back (RESEARCH Pitfall 1):
ALTER TABLE match_decisions
  ALTER COLUMN original_strategy_id DROP NOT NULL;
```

**Self-verifying DO block** (064 lines 146-205 + 070 lines 416-600 — category-labeled assertions):
```sql
DO $$
DECLARE
  v_col_nullable BOOLEAN;
  v_xor_def TEXT;
BEGIN
  -- (a) <invariant name>
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'match_decisions'
       AND column_name = 'original_strategy_id'
       AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Migration NNN failed: <specific failure>';
  END IF;

  -- (b) ... more invariants
  RAISE NOTICE 'Migration NNN: all <N> assertions passed.';
END
$$;

COMMIT;
```

**CHECK-constraint idempotent re-apply** (Phase 09 adopts this shape for the XOR; see RESEARCH Example 1 lines 613-619):
```sql
ALTER TABLE match_decisions
  DROP CONSTRAINT IF EXISTS match_decisions_original_xor;
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_original_xor CHECK (
    (original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT NULL)
  );
```

**Partial index pattern** (070 lines 200-210 for unique partial indexes — Phase 09 adopts the `WHERE x IS NOT NULL` clause):
```sql
CREATE INDEX IF NOT EXISTS match_decisions_original_holding_ref
  ON match_decisions (original_holding_ref)
  WHERE original_holding_ref IS NOT NULL;
```

**Delta from analog:**
- NOT a new table — `ALTER TABLE match_decisions` to add one column + drop one NOT NULL + add one CHECK + add one partial index.
- NO RLS touch (match_decisions RLS is owned by earlier migrations and unchanged).
- NO FK on the new column — `original_holding_ref TEXT NULL` with no `REFERENCES` clause (Phase 08 D-08 "scope_ref is text by design" precedent).
- Self-verifying DO block runs **5 assertions** (a-e per research §Code Example 1): column nullable post-drop, holding_ref column present with TEXT type, XOR CHECK deployed and correctly shaped, partial index exists, zero pre-existing rows violate XOR.
- NO `cron.schedule` — this migration only reshapes the table; cron extension lives in 073.

---

### `supabase/migrations/073_compute_bridge_outcome_deltas_holding_branch.sql` (migration, pg-function)

**Analog:** `supabase/migrations/060_bridge_outcome_cron.sql` (full-body replacement + SQL helpers + GRANT + DO-block NOTICE)

**Helper function pattern** (060 lines 26-43 — `extract_equity_at`):
```sql
CREATE OR REPLACE FUNCTION public.extract_equity_at(
  series JSONB,
  target_date DATE
) RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF((entry->>'value')::NUMERIC, 0)
  FROM jsonb_array_elements(series) AS entry
  WHERE (entry->>'date')::DATE = target_date
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.extract_equity_at IS
  'Returns cumulative equity on target_date; 0 → NULL to prevent divide-by-zero.';
```

**Main cron function shape** (060 lines 164-217 — `CREATE OR REPLACE FUNCTION` with `RETURNS TABLE(...)`, `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, `DECLARE v_updated/v_failed/v_started`, CTE pattern `candidates → computed → updated`, `RETURN QUERY SELECT ...`):
```sql
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
  WITH candidates AS (
    SELECT bo.id, bo.allocated_at, sa.returns_series AS series
      FROM public.bridge_outcomes AS bo
      JOIN public.strategy_analytics AS sa ON sa.strategy_id = bo.strategy_id
     WHERE bo.kind = 'allocated'
       AND bo.allocated_at IS NOT NULL
       AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
  ),
  computed AS (
    SELECT c.id,
           public.extract_delta(c.series, c.allocated_at, 30)  AS d30,
           public.extract_delta(c.series, c.allocated_at, 90)  AS d90,
           public.extract_delta(c.series, c.allocated_at, 180) AS d180,
           est.bps  AS est_bps,
           est.days AS est_days
      FROM candidates c
      LEFT JOIN LATERAL public.extract_estimated(c.series, c.allocated_at) AS est ON TRUE
  ),
  updated AS (
    UPDATE public.bridge_outcomes AS bo
       SET delta_30d = COALESCE(c.d30, bo.delta_30d),
           ...
           needs_recompute = FALSE,
           deltas_computed_at = v_started
      FROM computed c
     WHERE bo.id = c.id
       AND bo.kind = 'allocated'
       AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  )
  SELECT COUNT(*)::INT INTO v_updated FROM updated;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$$;
```

**GRANT re-application** (060 lines 225-226 — CREATE OR REPLACE strips GRANTs):
```sql
REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_bridge_outcome_deltas TO service_role;
```

**pg_cron schedule — unchanged** (060 lines 228+): migration 073 does NOT touch the `cron.schedule` block; the `0 3 * * *` cadence is preserved by not re-scheduling (the existing schedule calls whichever body is live at run time).

**Delta from analog:**
- ADDS two new SQL helpers at the top: `extract_symbol_value_at(allocator_id, symbol, asof)` (reads from `allocator_equity_snapshots.breakdown ->> symbol`) + `parse_holding_ref(text)` (splits `holding:V:S:T` → 3-tuple).
- REPLACES `compute_bridge_outcome_deltas()` body with a dual-CTE: `strategy_candidates`/`strategy_computed`/`strategy_updated` (unchanged from 060) AND `holding_candidates`/`holding_computed`/`holding_updated` (NEW — filters on `md.original_strategy_id IS NULL AND md.original_holding_ref IS NOT NULL`).
- Final `v_updated = (strategy_updated + holding_updated)` — single SELECT on both CTE tails.
- **Preserves verbatim:** `RETURNS TABLE` signature, `SECURITY DEFINER`, `SET search_path`, `WHERE delta_30d IS NULL OR needs_recompute` idempotency guard, `kind = 'allocated'` re-assert at UPDATE, `deltas_computed_at = v_started` atomicity.
- Self-verifying DO block runs 3 assertions: both helpers exist + main function body references `original_holding_ref IS NOT NULL`.

---

### `analytics-service/routers/match.py::_load_allocator_context` (engine-adapter, FastAPI)

**Analog:** `analytics-service/routers/match.py::_load_allocator_context` current body (lines 172-248) — self-analog for shape; `_load_universe` at lines 100-170 for the "build tuple-of-dicts from N upstream tables" convention.

**Current shape — `_load_allocator_context`** (lines 172-248 — tuple-of-lists/dicts dict):
```python
def _load_allocator_context(allocator_id: str) -> dict[str, Any]:
    """Load per-allocator data: preferences, portfolio, thumbs-down history."""
    supabase = get_supabase()

    # Preferences
    prefs_result = supabase.table("allocator_preferences").select("*").eq(
        "user_id", allocator_id
    ).maybe_single().execute()
    preferences = prefs_result.data

    # Portfolio strategies + weights. Iterate all portfolios owned by this allocator.
    portfolios_result = supabase.table("portfolios").select("id").eq(
        "user_id", allocator_id
    ).execute()
    portfolio_ids = [p["id"] for p in (portfolios_result.data or [])]

    portfolio_strategies: list[dict[str, Any]] = []
    portfolio_weights: dict[str, float] = {}
    portfolio_returns: dict[str, pd.Series] = {}
    portfolio_aum: float = 0.0

    if portfolio_ids:
        ps_result = (
            supabase.table("portfolio_strategies")
            .select("strategy_id, current_weight, portfolio_id, allocated_amount")
            .in_("portfolio_id", portfolio_ids)
            .execute()
        )
        ps_rows = ps_result.data or []

        strategy_ids = list({row["strategy_id"] for row in ps_rows})
        sa_result = (
            supabase.table("strategy_analytics")
            .select("strategy_id, returns_series")
            .in_("strategy_id", strategy_ids)
            .execute()
        ) if strategy_ids else None

        if sa_result:
            analytics_by_sid = {row["strategy_id"]: row for row in (sa_result.data or [])}
            for row in ps_rows:
                sid = row["strategy_id"]
                if sid not in portfolio_weights:
                    portfolio_strategies.append({"strategy_id": sid})
                    portfolio_weights[sid] = float(row.get("current_weight") or 1.0)
                    sa = analytics_by_sid.get(sid, {})
                    returns = _records_to_series(sa.get("returns_series"), name=sid)
                    if returns is not None:
                        portfolio_returns[sid] = returns
                    allocated = row.get("allocated_amount")
                    if allocated:
                        portfolio_aum += float(allocated)

    # Thumbs-down history
    td_result = (...)

    return {
        "preferences": preferences,
        "portfolio_strategies": portfolio_strategies,
        "portfolio_weights": portfolio_weights,
        "portfolio_returns": portfolio_returns,
        "portfolio_aum": portfolio_aum if portfolio_aum > 0 else None,
        "thumbs_down_ids": thumbs_down_ids,
    }
```

**Multi-table fan-out convention** (lines 100-170 — `_load_universe` reads `strategies` + `strategy_analytics` and assembles a `{strategies_by_id, returns_by_id}` tuple):
```python
return {
    "strategies_by_id": strategies_by_id,
    "returns_by_id": returns_by_id,
}
```

**Delta from analog:**
- ADD a sibling helper `_load_holding_portfolio_context(allocator_id)` (see RESEARCH Pattern 1, lines 281-335) that reads `allocator_holdings` (latest-asof-per-(venue,symbol,holding_type) collapse — mirror `holdingsMap` convention from `queries.ts:791-795` in Python) + `allocator_equity_snapshots` (ascending by asof, full window) + reconstructs per-symbol returns via `pd.Series(values).pct_change().dropna()` with a `len(series) >= 30` warm-up gate (RESEARCH Pitfall 2).
- MODIFY `_load_allocator_context` to **merge** both sources (strategies + holdings) per D-16: `portfolio_strategies`, `portfolio_weights`, `portfolio_returns` accumulate both feeds; `portfolio_aum` sums `portfolio_strategies.allocated_amount` + `allocator_holdings.value_usd`.
- Pseudo-strategy id = `f"holding:{venue}:{symbol}:{holding_type}"` (prefix text, never a UUID) — these ids flow only through in-memory dicts and NEVER land in `match_candidates.strategy_id` (a UUID column) per RESEARCH Pitfall 4.
- **Preserve verbatim:** function signature, return-dict keys (`preferences`, `portfolio_strategies`, `portfolio_weights`, `portfolio_returns`, `portfolio_aum`, `thumbs_down_ids`), the `monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)` test-patch idiom (analog `test_match_integration.py:55`).
- ZERO changes to `services/match_engine.py::score_candidates()` — engine reads the dict as-is.

---

### `analytics-service/services/match_engine.py::ENGINE_VERSION` (constant bump)

**Analog:** `analytics-service/services/match_engine.py:46` (current value `"v2.0.0"`)

**Current:**
```python
# Versioning for the engine + weight set. Bump on any change to the scoring math
# so historical batches are reproducible / debuggable. Phase 3 bumps both to
# v2.0.0 in lockstep — SCORING-01.
ENGINE_VERSION = "v2.0.0"
WEIGHTS_VERSION = "v2.0.0"
```

**Delta from analog:**
- Single-line change: `ENGINE_VERSION = "v2.1.0"` (D-17).
- `WEIGHTS_VERSION` unchanged (weight composition identical; only input layer changed).
- `_should_skip_allocator()` trigger #2 at `routers/match.py:395` (`if last_row.get("engine_version") != ENGINE_VERSION: return False`) auto-invalidates cached v2.0.0 batches on first post-ship cron run — zero manual flush.
- Update the comment above the constant to record the Phase 09 bump reason (RESEARCH Pattern §`ENGINE_VERSION` seam).

---

### `src/lib/queries.ts::getMyAllocationDashboard` (query-layer, SSR)

**Analog:** `src/lib/queries.ts:819-900` (current function body) + `derivePhase07Fields` at lines 740-817 (holdings-collapse helper convention).

**Parallel fan-out pattern** (lines 830-856):
```typescript
const [
  portfolio,
  phase07EquityRes,
  phase07HoldingsRes,
  apiKeys,
] = await Promise.all([
  getRealPortfolio(userId),
  supabase
    .from("allocator_equity_snapshots")
    .select("asof, value_usd, breakdown, source, history_depth_months")
    .eq("allocator_id", userId)
    .order("asof", { ascending: true })
    .limit(730),
  supabase
    .from("allocator_holdings")
    .select("symbol, quantity, mark_price, value_usd, venue, holding_type, asof, api_key_id")
    .eq("allocator_id", userId)
    .order("asof", { ascending: false }),
  getUserApiKeys(userId),
]);
```

**Holdings collapse helper** (lines 791-804 — mirror this exact shape for the `flaggedHoldings` derivation):
```typescript
const holdingsMap = new Map<string, (typeof holdingsRows)[number]>();
for (const r of holdingsRows) {
  const existing = holdingsMap.get(r.symbol);
  if (!existing || r.asof > existing.asof) holdingsMap.set(r.symbol, r);
}
const holdingsSummary = Array.from(holdingsMap.values()).map((r) => ({
  symbol: r.symbol,
  quantity: r.quantity,
  mark_price_usd: r.mark_price,
  value_usd: r.value_usd,
  venue: r.venue,
  holding_type: r.holding_type,
  api_key_id: r.api_key_id,
}));
```

**Admin-client match_decisions read** (lines 968-976 — extend for `original_holding_ref`):
```typescript
// match_decisions has no allocator-self-SELECT RLS policy; use admin client
// with explicit .eq("allocator_id", userId) as the ownership gate.
admin
  .from("match_decisions")
  .select("...")
  .eq("allocator_id", userId)
```

**Delta from analog:**
- ADD two payload keys: `flaggedHoldings: FlaggedHolding[]` + `matchDecisionsByHoldingRef: Record<string, { id: string } | null>`.
- `flaggedHoldings` derived from `match_batches` (latest per allocator) + `match_candidates` (top-ranked per pseudo-strategy) + `allocator_preferences` (max_weight, correlation_ceiling) + `holdingsSummary`. Join holding-sourced candidates by `strategy_id LIKE 'holding:%'`.
- `matchDecisionsByHoldingRef` is a plain keyed map: `{ "holding:binance:BTC:spot": { id: decisionUuid } | null }`. Use the same **admin client** pattern as the existing `sentAsIntroRes` fan-out (lines 968-976) because `match_decisions` has no owner-select RLS policy.
- Piggyback on the existing `Promise.all` waves — no new waves (Phase 07 f7 preserved).
- Collapse helper for flagged-holdings mirrors `holdingsMap` shape verbatim — one entry per `(venue, symbol, holding_type)`.

---

### `src/app/(dashboard)/allocations/AllocationDashboard.tsx` (component, client dashboard)

**Analog:** `AllocationDashboard.tsx:561-585` (current `widgetData` useMemo) + lines 865-874 (InsightStrip integration).

**`widgetData` useMemo pattern** (lines 561-585):
```typescript
const widgetData = useMemo(
  () => ({
    portfolio,
    analytics,
    strategies: strategies.map((row) => ({
      strategy_id: row.strategy_id,
      weight: row.current_weight ?? 0,
      allocated_amount: row.allocated_amount,
      alias: row.alias,
      eligible_for_outcome: row.eligible_for_outcome,
      existing_outcome: row.existing_outcome,
      strategy: row.strategy,
    })),
    apiKeys,
    alertCount,
    metrics,
    compositeReturns,
    weightSnapshots,
    positionSnapshots,
    outcomes,
  }),
  [portfolio, analytics, strategies, apiKeys, alertCount, metrics, compositeReturns, weightSnapshots, positionSnapshots, outcomes],
);
```

**InsightStrip integration** (lines 865-874):
```typescript
<div className="mb-6 rounded-lg border border-[#E2E8F0] bg-white px-5 py-4">
  <InsightStrip
    analytics={analytics}
    portfolioId={portfolio?.id ?? null}
    max={3}
    portfolioStrategies={rebalanceDriftInputs}
    portfolioAgeDays={portfolioAgeDays}
  />
</div>
```

**Delta from analog:**
- Add `flaggedHoldings` + `matchDecisionsByHoldingRef` to the `widgetData` useMemo (both new keys + add both to the deps array).
- Add `flaggedCount = flaggedHoldings.length` prop + `flaggedHoldings` prop to `<InsightStrip>` (new props — InsightStrip change below).
- Pass `flaggedHoldings` + `matchDecisionsByHoldingRef` down into `AllocationsTabs` so the Scenario tab body can consume them (new props wire — `AllocationsTabs` already receives `{...props}` passthrough at line 161 so the addition is purely additive).

---

### `src/components/portfolio/InsightStrip.tsx` (component, insights line)

**Analog:** `InsightStrip.tsx:79-122` (current list render with `<p>` section header + `<ul role="list">`).

**Current render shape**:
```typescript
<section aria-label="Portfolio insights" className={cn("flex flex-col gap-3", className)}>
  <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
    What we noticed
  </p>
  {insights.length === 0 ? (
    <p className="text-sm text-text-secondary">
      No unusual activity in the trailing window.
    </p>
  ) : (
    <ul role="list" className="space-y-2">
      {insights.map((insight) => (
        <li key={...} className="flex items-start gap-3 text-sm text-text-secondary">
          <span aria-hidden="true" className={...} />
          <span className="sr-only">{SEVERITY_LABEL[insight.severity]}:</span>
          {isBridgeable(insight, portfolioId) ? (
            <BridgeTrigger insight={insight} portfolioId={portfolioId!}>
              <span>{insight.sentence}</span>
            </BridgeTrigger>
          ) : (
            <span>{insight.sentence}</span>
          )}
        </li>
      ))}
    </ul>
  )}
</section>
```

**Delta from analog:**
- Add optional `flaggedCount?: number` prop to `InsightStripProps`.
- When `flaggedCount > 0`, prepend a dedicated `<li>` to the `<ul>` (or above the fallback "No unusual activity" line) with copy "Bridge flagged N holding(s) — Review in Scenario →" wrapped in `<Link href="/allocations?tab=scenario">` (D-07). When `flaggedCount === 0 || undefined`, render nothing extra — NO empty-state copy for the flagged-holdings line (hidden, per D-07).
- Reuse the existing `<li className="flex items-start gap-3 text-sm text-text-secondary">` shape + severity-dot convention (use `SEVERITY_DOT.medium` to match institutional tone — not negative, not muted).
- Institutional tone copy: no "!", no "urgent" language. Exact string "Bridge flagged N holding(s) — Review in Scenario →" per D-07 (Claude's Discretion — copy-review may refine).

---

### `src/app/(dashboard)/allocations/ScenarioStub.tsx` (component, tab body swap)

**Analog:** current `ScenarioStub.tsx:14-26` (empty-state card) + `AllocationsTabs.tsx:163-170` (tabpanel conditional render).

**Current stub body**:
```typescript
export function ScenarioStub() {
  return (
    <Card className="py-12 text-center">
      <h2 className="font-serif text-2xl text-text-primary mb-2">
        Scenario builder coming soon
      </h2>
      <p className="text-sm text-text-secondary max-w-md mx-auto">
        Model what-if outcomes by adding or removing strategies and holdings
        from your live composition. Available in the next update.
      </p>
    </Card>
  );
}
```

**Current tabpanel switch** (`AllocationsTabs.tsx:163-170`):
```typescript
<div role="tabpanel" id="panel-scenario" aria-labelledby="tab-scenario"
     hidden={activeTab !== "scenario"}>
  {activeTab === "scenario" && <ScenarioStub />}
</div>
```

**Delta from analog:**
- EITHER (a) modify `ScenarioStub.tsx` to accept `flaggedHoldings?: FlaggedHolding[]` + `matchDecisionsByHoldingRef?: Record<...>` props and internally branch `flagged_count > 0 ? <ScenarioFlaggedHoldingsList .../> : <existing empty-state card/>` — **preferred** because it keeps the single import site in `AllocationsTabs.tsx:169` untouched;
- OR (b) move the branch up into `AllocationsTabs.tsx:169` directly — more invasive.
- Preserve the existing empty-state copy verbatim as the `flagged_count === 0` fallback (D-08).
- RESEARCH Pitfall 7 — this is exactly the "body switch" pitfall; solution is the conditional render, not a naive swap.

---

### `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx` (NEW — component, inline-expandable list)

**Analogs (two combined):**
1. **`BannerSubRow` state machine** — `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx:273-353`
2. **Fragment + `isExpanded` one-open-at-a-time row** — `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx::TimelineRow` (lines 401-561) + `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx::OutcomesWidget` (lines 615-766 — `expandedId` useState)
3. **Full-width `<tr colSpan>` sub-row** — `src/components/notes/HoldingNoteRow.tsx:236-260`

**State machine (BannerSubRow, PositionsTable.tsx:280-353):**
```typescript
type BannerMode = "banner" | "allocated" | "rejected" | "dismissed";

function BannerSubRow({
  colSpan, strategyId, initialOutcome,
}: {
  colSpan: number;
  strategyId: string;
  initialOutcome: BridgeOutcome | null;
}) {
  const [mode, setMode] = useState<BannerMode>("banner");
  const [localOutcome, setLocalOutcome] = useState<BridgeOutcome | null>(initialOutcome);

  if (localOutcome) {
    return (<tr><td colSpan={colSpan} className="p-0">
      <OutcomeRecordedRow outcome={localOutcome} />
    </td></tr>);
  }

  if (mode === "dismissed") return null;

  if (mode === "allocated") {
    return (<tr><td colSpan={colSpan} className="p-0">
      <AllocatedForm
        strategyId={strategyId}
        maxWeight={null}
        onRecorded={(outcome) => setLocalOutcome(outcome)}
        onCancel={() => setMode("banner")}
      />
    </td></tr>);
  }

  if (mode === "rejected") {
    return (<tr><td colSpan={colSpan} className="p-0">
      <RejectedForm
        strategyId={strategyId}
        onRecorded={(outcome) => setLocalOutcome(outcome)}
        onCancel={() => setMode("banner")}
      />
    </td></tr>);
  }

  // Default: banner mode
  return (<tr><td colSpan={colSpan} className="p-0">
    <BridgeOutcomeBanner
      strategyId={strategyId}
      onAllocatedClick={() => setMode("allocated")}
      onRejectedClick={() => setMode("rejected")}
      onDismiss={() => setMode("dismissed")}
    />
  </td></tr>);
}
```

**One-open-at-a-time pattern (OutcomesWidget.tsx:627 + TimelineRow.tsx:455-559):**
```typescript
const [expandedId, setExpandedId] = useState<string | null>(null);
// ... in the list render:
{outcomes.map((o) => (
  <TimelineRow
    key={o.id}
    outcome={o}
    isExpanded={expandedId === o.id}
    onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
    ...
  />
))}
// ... inside TimelineRow:
return (
  <Fragment>
    <tr> ... main row with onToggle button + aria-expanded + aria-controls ... </tr>
    {isExpanded && (
      <tr id={`outcome-detail-${outcome.id}`}>
        <td colSpan={colSpan} className="p-0">
          <ExpandedPanel ... />
        </td>
      </tr>
    )}
  </Fragment>
);
```

**Full-width sub-row shell (HoldingNoteRow.tsx:236-243):**
```typescript
<tr
  id={`note-row-${props.rowId}`}
  role="region"
  aria-label={`Note for ${props.symbol} ${props.holding_type}`}
>
  <td colSpan={props.colSpan} className="p-0">
    <div className="px-4 py-3 bg-surface border-t border-border">
      ...content...
    </div>
  </td>
</tr>
```

**Delta from analogs:**
- **Layout:** outer `<table>` with one main `<tr>` per flagged holding (columns: symbol/venue, top candidate name+composite, breach reasons chip, expand caret). Each main `<tr>` has a sibling `<tr>` rendered conditionally on `expandedId === holding.ref` containing the full-width `<td colSpan={COL_SPAN}>` that hosts the Bridge V2 sub-row state machine.
- **State:** TWO useStates at the list root:
  - `const [expandedId, setExpandedId] = useState<string | null>(null);` — one-open-at-a-time (outcomes pattern)
  - Each expanded row internally runs the `banner|allocated|rejected|dismissed` machine (positions pattern)
- **Props via adapter:** instead of passing `strategyId` directly to `BridgeOutcomeBanner`/`AllocatedForm`/`RejectedForm`, use `toBridgeOutcomeBannerProps(flaggedHolding, opts)` from `holding-outcome-adapter.ts` to derive the strategy-shaped props (D-11).
- **Initial outcome:** compute via `deriveEligibleForOutcome(flaggedHolding, matchDecisionsByHoldingRef, existingOutcomesByHoldingRef)` at render time — mirrors `PositionsTable` reading `existing_outcome` from the row prop.
- **`scope_ref` = `"holding:{venue}:{symbol}:{holding_type}"`** — built via a shared helper that also lives in the adapter (`buildHoldingRef`).
- **Phase 10 migration comment** at the top of the file: this component is the Phase 10 composition-surface starting point (D-09) — Phase 10 extends the main row with toggles/sliders/commit.
- DESIGN.md tokens: DM Sans / Geist Mono, 1px borders (`border-[#E2E8F0]`), 8px radius, institutional minimalist palette — copy EXACTLY from `OutcomesWidget.tsx` styling strings.

---

### `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` (NEW — adapter-util)

**Analog:** `src/lib/portfolio-analytics-adapter.ts` (lines 1-80) — the only pure-TS adapter convention in the repo. Secondary: `src/lib/notes/scope-ref.ts::buildHoldingScopeRef` (Phase 08 D-08) — scope_ref format.

**Pure-TS adapter header pattern** (`portfolio-analytics-adapter.ts:1-30`):
```typescript
/**
 * Portfolio analytics JSONB adapter.
 *
 * ... normalizes the raw row into the strict typed shapes declared in
 * `src/lib/types.ts`. Anything malformed is logged and replaced with `null`
 * so render-side code can rely on either-the-correct-shape-or-null.
 *
 * Use this adapter at the Supabase fetch boundary. Downstream code (lib
 * functions, card components) should never see raw JSONB.
 *
 * Defensive parsing rules:
 *   - Unknown fields are ignored.
 *   - Numeric fields are coerced via Number(); non-finite results become null.
 *   - ...
 */

import type { ... } from "./types";
```

**Helper function shape (`portfolio-analytics-adapter.ts:48-80`):**
```typescript
function isSafeKey(key: string): boolean { ... }
function asNumber(v: Json): number | null { ... }
function parseTimeSeriesPoint(v: Json): TimeSeriesPoint | null {
  if (!isObject(v)) return null;
  const date = asString(v.date);
  const value = asNumber(v.value);
  if (date == null || value == null) return null;
  return { date, value };
}
```

**RESEARCH Pattern 2 (research.md lines 346-395) — the concrete shape Phase 09 adopts:**
```typescript
export type FlaggedHolding = {
  venue: string;
  symbol: string;
  holding_type: "spot" | "derivative";
  value_usd: number;
  top_candidate_strategy_id: string;
  top_candidate_name: string;
  top_candidate_composite: number;
  breach_reasons: Array<"max_weight" | "correlation_ceiling">;
};

export function buildHoldingRef(h: FlaggedHolding): string {
  return `holding:${h.venue}:${h.symbol}:${h.holding_type}`;
}

export function toBridgeOutcomeBannerProps(
  h: FlaggedHolding,
  opts: { onAllocatedClick: () => void; onRejectedClick: () => void; onDismiss: () => void },
) {
  return {
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
  return { eligible: decision !== null && existing === null, existingOutcome: existing };
}
```

**Delta from analog (no existing per-app `lib/*-adapter.ts`):**
- Phase 09 establishes a new `src/app/(dashboard)/allocations/lib/` adapter convention — analog is the SHAPE of `portfolio-analytics-adapter.ts` (pure TS, strictly-typed exports, boundary-at-UI convention).
- Exported functions: `buildHoldingRef`, `toBridgeOutcomeBannerProps`, `toAllocatedFormProps`, `toRejectedFormProps`, `deriveEligibleForOutcome`. All are pure TypeScript (no side effects, no fetch).
- `toAllocatedFormProps` maps `FlaggedHolding → { strategyId: top_candidate_strategy_id, maxWeight: null, onRecorded, onCancel }` — mirrors `BannerSubRow`'s current direct-pass pattern (PositionsTable.tsx:310-320) but routes through the adapter to surface the `strategyId = top_candidate_uuid` invariant (RESEARCH: "BridgeOutcomeBanner expects strategyId — pass the TOP CANDIDATE uuid since that's what the outcome routes to").
- Outcome-recording writes go through the **existing `/api/bridge/outcome` POST** (unchanged route); the new payload field `original_holding_ref: string` sits alongside the existing `strategy_id` (the top candidate UUID) per D-11.
- `buildHoldingRef` is intentionally DUPLICATED from `src/lib/notes/scope-ref.ts::buildHoldingScopeRef` — different callers, identical format; the two are kept in sync via the adapter unit test (`holding-outcome-adapter.test.ts`) that asserts output string equals the notes-side helper.

---

### `src/app/(dashboard)/compare/page.tsx` (frontend-server, SSR route)

**Analog:** `src/app/(dashboard)/compare/page.tsx:11-57` (current body).

**Current shape (lines 11-57):**
```typescript
export default async function ComparePage({ searchParams }: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const ids = params.ids?.split(",").filter(Boolean).slice(0, 4) ?? [];

  if (ids.length === 0) {
    return (<>...empty state...</>);
  }

  const { data: strategies } = await supabase
    .from("strategies")
    .select("*, strategy_analytics (*)")
    .in("id", ids)
    .eq("status", "published");

  const items = (strategies ?? []).map((s) => ({
    strategy: s as Strategy,
    analytics: ((Array.isArray(s.strategy_analytics) ? s.strategy_analytics[0] : s.strategy_analytics) ?? { ...EMPTY_ANALYTICS, strategy_id: s.id }) as StrategyAnalytics,
  }));

  return (
    <>
      <Breadcrumb ... />
      <PageHeader title={`Comparing ${items.length} Strategies`} />
      <div className="space-y-8">
        <CompareTable items={items} />
        <CompareEquityOverlay items={items} />
        <CompareCorrelationMatrix items={items} />
      </div>
    </>
  );
}
```

**Delta from analog (RESEARCH Pitfall 8):**
- AFTER the `.split(",")` at line 21, partition `ids` into two groups: `strategyIds` (UUIDs — 36 chars with dashes) and `holdingIds` (text starting with `holding:`). Gate at the PARSER layer, BEFORE any Supabase call, because the existing `.from("strategies").eq("status","published")` (line 35-39) would reject holding ids.
- For each `holding:` id, run a sibling fetch against `allocator_equity_snapshots` (RLS-gated — 3-tier owner/admin/service-role from migration 070 lines 391-413) + reconstruct per-symbol returns via the same Python-side adapter (D-15) OR a TS-side sibling that reads the `breakdown` jsonb per-symbol and computes sharpe/max_drawdown/vol/cumulative_return.
- Merge both sides into a single `items[]` with a discriminator: `items: Array<{ kind: 'strategy', strategy, analytics } | { kind: 'holding', holding_ref, venue, symbol, holding_type, analytics }>`.
- Access gate: RLS on `allocator_equity_snapshots` returns zero rows to non-owners → render "This comparison isn't available" (per D-15 — no existence leak).
- `<CompareTable>` + `<CompareEquityOverlay>` + `<CompareCorrelationMatrix>` components render a "Holding" header badge for `kind === 'holding'` rows instead of the factsheet card (D-15).
- Preserve `ids.slice(0, 4)` cap + `ids.length === 0` empty-state path verbatim.

---

### `docs/architecture/adr-0023-audit-event-taxonomy.md` (doc)

**Analog:** prior "Phase NN section" appends within `adr-0023` itself (Phase 06 + Phase 08 already appended). Same-commit sync is the established convention (Phase 03 / 04 / 06 / 08 precedent per CONTEXT.md §Inherited).

**Delta from analog:**
- Append a new section labeled "Phase 09" per D-14:
  > `match_decisions.original_holding_ref` is the sibling key to `original_strategy_id` for holdings-sourced Bridge decisions. Both fields are captured in the audit `entity_id` via the existing `match.decision.*` kinds — no new audit kind required.
- NO new audit event kind registered — the action being audited ("Bridge outcome recorded") is identical regardless of source; only the entity pointer varies, carried through `metadata.match_decision_id`.
- Landed in the SAME git commit as migration 072 (atomic — Phase 03 / 04 / 06 / 08 precedent per CONTEXT.md).

---

## Shared Patterns

### Pattern A — Self-verifying migration DO block

**Source:** `supabase/migrations/070_allocator_equity_snapshots.sql:416-600` (12 assertions a-l) + `supabase/migrations/064_match_decisions_original_strategy.sql:146-205` (5 assertions)

**Apply to:** Migrations 072, 073

**Excerpt:**
```sql
DO $$
DECLARE
  v_<name1> <type>;
  v_<name2> <type>;
BEGIN
  -- (a) <invariant name>
  SELECT <probe> INTO v_<name1> FROM <...>;
  IF v_<name1> IS NULL OR <condition> THEN
    RAISE EXCEPTION 'Migration NNN failed: <specific message, cite the invariant>';
  END IF;

  -- (b) ...

  RAISE NOTICE 'Migration NNN: all N self-verification assertions (a-X) passed.';
END
$$;
```

**Per-migration assertion list:**
- **072 (5 assertions):** (a) `original_strategy_id` now nullable; (b) `original_holding_ref` TEXT column present; (c) XOR CHECK deployed with correct def; (d) partial index exists; (e) zero pre-existing rows violate XOR.
- **073 (3 assertions):** (a) `extract_symbol_value_at` helper installed; (b) `parse_holding_ref` helper installed; (c) `compute_bridge_outcome_deltas` body references `original_holding_ref IS NOT NULL`.

### Pattern B — Atomic migration + ADR sync + emitter change (single commit)

**Source:** Phase 03 / 04 / 06 / 08 precedent (per CONTEXT.md §Inherited)

**Apply to:** Plan 09-01 (migration 072 + adr-0023 Phase 09 section in ONE commit).

### Pattern C — Inline-expandable Fragment sub-row, one-open-at-a-time

**Source:**
- `OutcomesWidget.tsx:615-766` + `TimelineRow` at lines 401-561 (`expandedId` state + `Fragment` + `isExpanded && <tr>`)
- `PositionsTable.tsx::BannerSubRow` lines 280-353 (`BannerMode` state machine)
- `HoldingNoteRow.tsx:236-260` (full-width `<tr><td colSpan>` shell)

**Apply to:** `ScenarioFlaggedHoldingsList.tsx`

### Pattern D — Admin-client read when RLS lacks owner-select

**Source:** `src/lib/queries.ts:968-976` (`match_decisions` read via `admin` client + explicit `.eq("allocator_id", userId)` as the ownership gate)

**Apply to:** `getMyAllocationDashboard` extension for `matchDecisionsByHoldingRef` — use the same `admin` client + inline `.eq("allocator_id", userId)` gate.

### Pattern E — Vitest live-DB regression test scaffold

**Source:** `src/__tests__/bridge-outcome-cron.test.ts` lines 1-70 (HAS_LIVE_DB skip gate, `buildLinearEquityCurve` synthetic fixture, `describe → it.skipIf(!HAS_LIVE_DB)` structure, `advertiseLiveDbSkipReason`)

**Apply to:** Wave 0 test files:
- `src/__tests__/match-decisions-xor-rls.test.ts` — both/neither XOR inserts → SQLSTATE 23514
- `src/__tests__/bridge-outcome-cron-holding.test.ts` — holding-branch cron populates `delta_30d` from `allocator_equity_snapshots.breakdown`
- `src/__tests__/compare-holding-rls.test.ts` — /compare access gate across allocators (no existence leak)

**Excerpt:**
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

describe("<suite name> (live-DB)", () => {
  advertiseLiveDbSkipReason("<suite-slug>");
  // ...
  it.skipIf(!HAS_LIVE_DB)("<case>", async () => {
    const admin = createLiveAdminClient();
    // ... arrange/act/assert ...
  }, 30_000);
});
```

### Pattern F — pytest engine test via `monkeypatch.setattr("routers.match.get_supabase", ...)`

**Source:** `analytics-service/tests/test_match_integration.py:50-59`

**Apply to:** Wave 0 pytest files:
- `analytics-service/tests/test_match_integration_phase09.py` — holdings-only + mixed + warm-up gate
- `analytics-service/tests/test_equity_reconstruction_phase09.py` — per-symbol returns golden fixture
- Extension to `analytics-service/tests/test_match_engine.py` — `ENGINE_VERSION == 'v2.1.0'`

**Excerpt:**
```python
async def test_<case>(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.<...>.execute.return_value = \
        MagicMock(data=[<fixture rows>])
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

    result = await _load_allocator_context("alloc-1")
    assert <invariant>
```

---

## No Analog Found

None. Every file in Phase 09 has a concrete in-repo analog. The directory `src/app/(dashboard)/allocations/lib/` currently holds only config/type/registry files (no prior `-adapter.ts`), so `holding-outcome-adapter.ts` establishes a new convention — but the SHAPE analog is `src/lib/portfolio-analytics-adapter.ts` (same "pure TS adapter at the boundary" concept).

## Metadata

**Analog search scope:** `analytics-service/routers/`, `analytics-service/services/`, `analytics-service/tests/`, `supabase/migrations/`, `src/app/(dashboard)/allocations/`, `src/components/portfolio/`, `src/components/notes/`, `src/lib/`, `src/__tests__/`, `docs/architecture/`
**Files scanned:** ~40 direct reads + ~6 glob/grep sweeps
**Pattern extraction date:** 2026-04-21

## PATTERN MAPPING COMPLETE
