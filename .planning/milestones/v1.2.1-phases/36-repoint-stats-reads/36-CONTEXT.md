# Phase 36: Repoint stats reads - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning
**Mode:** Autonomous discuss (grey areas decided per the no-clients directive; surfaced below)

<domain>
## Phase Boundary

Repoint the allocator **Overview** equity curve + performance KPIs (Sharpe, returns,
volatility, max-drawdown, avg-ρ) from the blended `allocator_equity_snapshots`
reconstruction onto the persisted per-key dailies in `csv_daily_returns`
(`api_key_id` + `allocator_id` rows, `strategy_id` NULL) — blended through the SAME
`computeScenario` compute path the CSV/factsheet stats already use. Overview numbers
converge to the realized+funding / unified-252 basis (the same honest source Scenario
and factsheets read).

**In scope (UNIFY-01/02/03):**
1. **Repoint Overview STATS** in `src/lib/queries.ts` (`getMyAllocationDashboard` →
   `liveBaselineMetricsFromHoldings`): the equity-curve SHAPE + KPIs derive from a
   blend of per-key `(date, daily_return)` series, not from the per-symbol
   `allocator_equity_snapshots.breakdown` reconstruction.
2. **Deferred-from-P35 compliance cluster** (must land BEFORE the prod backfill runs):
   - GDPR export manifest — add a per-key axis so Art.15/20 exports include per-key dailies.
   - GDPR coverage hook — keep it green/honest with the table now owned via TWO axes.
   - `database.types.ts` — hand-patch the per-key columns so the typed read compiles.
3. **Operational backfill** — after the code ships+deploys, run
   `phase35_backfill_enqueue` so existing keys get a per-key series, then verify Overview
   converges in prod.

**Out of scope:**
- Live HOLDINGS / positions table — STAYS on the `allocator_holdings` poll path (UNIFY-03).
- The scenario composer's per-source toggle + adapter re-key — **Phase 37**.
- Composer factsheet-parity chart + blank-mode fix — **Phase 38**.
- `/compare` `holding-compare-adapter.ts` — STAYS on `allocator_equity_snapshots`
  (it is a per-holding compare surface, not the Overview; D7 below).
</domain>

<decisions>
## Implementation Decisions

### D1 — Blending unit = per `api_key` (not per symbol)
Today `reconstructHoldingReturnsByScopeRef` (queries.ts ~2002–2044) rebuilds per-SYMBOL
returns from `allocator_equity_snapshots.breakdown` JSONB, then
`liveBaselineMetricsFromHoldings` (~2099–2209) runs `computeScenario` over per-holding
"strategies". Phase 36 changes the BLEND UNIT: build one "strategy" per `api_key_id`
from its `csv_daily_returns` `(date, daily_return)` series and run the SAME
`computeScenario`. Honest (each key's realized+funding daily return is the source of
truth) and simpler than per-symbol pct-change reconstruction.

### D2 — AUM stays from holdings; curve shape + KPIs from the per-key blend
- **AUM** (current total USD) stays a HOLDINGS concern: `Σ allocator_holdings.value_usd`
  (unchanged). It is "current positions", not performance.
- **Equity-curve SHAPE + KPIs** (Sharpe/vol/maxDD/returns/avgρ) come from the per-key
  returns blend through `computeScenario`. The curve's absolute USD scale is anchored to
  current AUM (same anchoring the current path uses), so the shape is the honest
  realized+funding basis while the level is the real current book value.
- **Per-key weights** for the blend = each key's current equity share, i.e.
  `allocator_holdings.value_usd` grouped by `api_key_id` (holdingsSummary already carries
  `api_key_id`). No new weight source.

### D3 — Fallback = ALL-OR-NOTHING per allocator (honesty over coverage)
Per-key dailies exist only for keys whose derive job has run (crypto exchange keys,
post-backfill). Decision: if EVERY active key of the allocator has a per-key series
covering the window → use the per-key blend (D1/D2). Otherwise fall back to the EXISTING
`reconstructHoldingReturnsByScopeRef` snapshot path for the WHOLE allocator. Rationale:
**never mix two annualization/derivation bases inside one curve** (that would be
dishonest). Allocators with a non-derivable key (e.g. MT5/IBKR — no funding-dailies
feeder) stay on the snapshot basis until those get a feeder; that is honest, not a
regression. The fallback is permanent infrastructure, not a temporary rollout shim.

### D4 — GDPR per-key axis (deferred cluster #1/#2)
`csv_daily_returns` is ALREADY in `USER_EXPORT_TABLES` as an INDIRECT entry
(`strategy_id → strategies.user_id`). Per-key rows have `strategy_id NULL` + `allocator_id`
set, so the indirect filter SILENTLY OMITS them (`NULL IN (...)` is never true). The CI
coverage hook stays GREEN regardless (the table NAME is present) — so this is a genuine
**correctness/compliance** gap the hook cannot catch, NOT a CI blocker.
- Add a SECOND spec for the per-key axis, reusing the existing `projected` kind to avoid a
  bundle-key collision with the indirect entry:
  `{ kind: "projected", table: "csv_daily_returns_per_key", source_table: "csv_daily_returns",
    user_column: "allocator_id", project: <identity passthrough filtered to allocator_id===userId> }`.
  The engine SELECTs `* WHERE allocator_id = userId` → only per-key rows (strategy rows have
  `allocator_id NULL`). The project is defense-in-depth (re-filter allocator_id), no column
  stripping (per-key rows carry no cross-party data).
- Coverage-hook change: add `csv_daily_returns_per_key` to `SANITIZE_PARITY_ALLOWLIST`
  (the projection-parity check requires the bundle name be covered; erasure is the
  `api_key_id → api_keys ON DELETE CASCADE` + `allocator_id → auth.users ON DELETE CASCADE`
  the migration already declares — same CASCADE-erasure rationale as the existing
  `csv_daily_returns` allowlist entry). Existing indirect strategy entry stays untouched.
- `getOrderColumn` already maps `csv_daily_returns → date` (via source_table lookup) — no change.
- Pin both axes with a unit test (per-key rows appear in the bundle; strategy rows still do;
  cross-allocator rows never do).

### D5 — `database.types.ts` hand-patch (deferred cluster #3, repo convention)
No CI gate regenerates `database.types.ts`; the repo hand-patches it when TS reads new
columns. Patch the `csv_daily_returns` Row/Insert/Update:
- `strategy_id: string` → `string | null` (now nullable)
- add `id: number` (BIGINT IDENTITY surrogate PK)
- add `api_key_id: string | null`
- add `allocator_id: string | null`
Required for the typed per-key read in queries.ts to compile. (Insert/Update mirror with
appropriate optionality.)

### D6 — Backfill = post-deploy operational step, gated behind D4/D5
The repoint only SHOWS the new basis once per-key rows exist. Sequence:
1. Ship+land+deploy the phase-36 code (D1–D5) to prod (dual-mode derive job already live
   from P35).
2. Run `railway ssh "cd /app && python -m scripts.phase35_backfill_enqueue"` (service-role)
   → enqueues an `api_key`-scoped `derive_broker_dailies` job per active connected key.
3. Wait for the worker to drain; verify per-key rows populated + Overview converged in prod.
Because D4 lands in the SAME PR, no un-exportable per-key data exists before compliance is
in place. Backfill is idempotent (pre-check guard + atomic 23505-safe bulk insert).

### D7 — `/compare` holding-compare-adapter stays on snapshots
`src/app/(dashboard)/compare/lib/holding-compare-adapter.ts` reads
`allocator_equity_snapshots.breakdown` for per-HOLDING compare analytics. That is a
distinct surface (single-holding compare, not the blended Overview). Out of scope for 36 —
leave it on the snapshot path. Phase 36 touches ONLY the Overview dashboard stats.

### Claude's Discretion (planner's call)
- Exact seam: whether the per-key blend is a new helper feeding `liveBaselineMetricsFromHoldings`
  vs a sibling `liveBaselineMetricsFromPerKeyDailies` selected by the D3 gate. Prefer the
  smallest diff that keeps the `liveBaselineMetrics` output contract byte-identical so the
  SSR payload + downstream consumers (and the scenario composer baseline) are unaffected.
- How the D3 "every active key has a per-key series covering the window" predicate is
  computed (presence of ≥1 row per active api_key_id vs window-coverage threshold) — keep
  it simple and honest; a missing key → fallback.
- Whether the `csv_daily_returns` per-key fetch is a new parallel query in
  `getMyAllocationDashboard`'s fetch fan-out (preferred — it already parallel-fetches).
</decisions>

<code_context>
## Existing Code Insights (terrain map, 2026-06-25)

- `src/lib/queries.ts`:
  - `getMyAllocationDashboard(userId)` ~2340–3150 — the Overview dashboard builder. Parallel
    fetch fan-out (~2434) reads `allocator_equity_snapshots` (stats) + `allocator_holdings`
    (holdings) + portfolio `strategy_analytics`. Add the `csv_daily_returns` per-key fetch here.
  - `reconstructHoldingReturnsByScopeRef(equitySnapshots, holdingsSummary)` ~2002–2044 —
    per-symbol returns from `breakdown` JSONB. The CURRENT stats source; becomes the D3 FALLBACK.
  - `liveBaselineMetricsFromHoldings(holdingsSummary, holdingReturnsByScopeRef)` ~2099–2209 —
    builds per-holding "strategies", de-aliases multi-venue, `computeScenario` → equity/Sharpe/
    maxDD/AUM/avgρ. Output contract `liveBaselineMetrics` must stay byte-identical.
  - `derivePhase07Fields(...)` ~2216–2336 — `equityDailyPoints` from the blended snapshot curve.
- HOLDINGS read = `allocator_holdings` (latest-asof collapse, ~2446–2461) — LEAVE UNCHANGED.
- `csv_daily_returns` is currently WRITE-ONLY in src/ (no analytics reader yet) — this phase adds
  the first read. Per-key rows: `(api_key_id, date, daily_return, allocator_id)`, `strategy_id NULL`,
  written by `run_derive_broker_dailies_job` key-mode (`on_conflict=api_key_id,date`).
- `computeScenario` (src/lib/scenario.ts) is the FROZEN engine (SCENARIO-05). Reuse, don't fork.
- GDPR: `src/lib/gdpr-export-manifest.ts` (`USER_EXPORT_TABLES`, `projected` kind, `getOrderColumn`,
  `ORDER_COLUMN_OVERRIDES['csv_daily_returns']='date'`) + `scripts/check-gdpr-export-coverage.ts`
  (`SANITIZE_PARITY_ALLOWLIST`, projection-parity check). Migration
  `20260624120000_csv_daily_returns_per_key_axis.sql` declares the CASCADE FKs + owner RLS + trigger.
- `database.types.ts` `csv_daily_returns` Row currently lacks `id/api_key_id/allocator_id` and has
  `strategy_id: string` (non-null) — stale vs the landed migration (D5).

## Tests that will need updating
- `src/lib/queries.my-allocation.test.ts` (~455–1506) — seeds `allocator_equity_snapshots`; add
  per-key `csv_daily_returns` fixtures for the per-key branch + keep snapshot fixtures for the
  fallback branch. The avgρ de-alias test (1443–1506) must still hold on whichever branch runs.
- `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts` — full payload shape.
- A new GDPR per-key export test (D4).
</code_context>

<specifics>
## Specific Ideas
- The `liveBaselineMetrics` output contract MUST stay byte-identical (only the SOURCE of the
  curve/KPIs changes) so the scenario composer baseline (Phase 37 input) and SSR payload are
  unaffected. Prove with a test that the per-key branch and the fallback branch both produce the
  same SHAPE of payload.
- D3 honesty guard: add a test proving a mixed population (one key with dailies, one without)
  takes the FALLBACK — never a half-per-key/half-snapshot blended curve.
- The GDPR per-key axis (D4) is the load-bearing compliance fix; without it the Art.15 bundle
  silently omits per-key dailies once the backfill runs. Pin it before the backfill (D6).
</specifics>

<deferred>
## Deferred Ideas
- Scenario composer per-source toggle + per-`api_key` adapter re-key — Phase 37.
- Composer factsheet-parity chart + blank-mode equity-projection fix — Phase 38.
- Per-key factsheet surface — v2 (UNIFY-V2-01).
- Repointing `/compare` holding-compare onto per-key dailies — out of scope (per-holding surface).
</deferred>
