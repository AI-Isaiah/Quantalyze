# Phase 98: Portfolio Data Foundation - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — grey areas auto-decided; no prod-risk decisions here)

<domain>
## Phase Boundary

The server-side read layer the Portfolio Intelligence widgets (Phase 99/100) stand on: position-level exposure data, a historical-position time series (net exposure over time), and weight/allocation history — all owner-scoped and secretless — plus the cross-process portfolio-recompute UNIQUE INDEX (PI-07) so concurrent recompute processes cannot create duplicate `computing` rows. NO UI in this phase (widgets are Phase 99); NO new widget rendering. Foundation + data-integrity only.
</domain>

<decisions>
## Implementation Decisions

### Data source & shape
- Reuse the existing `allocator_holdings` table (allocator_id, venue, symbol, asof, holding_type, quantity, value_usd, mark_price) as BOTH the position-level source and the `asof` time axis — do NOT introduce a new positions table. It already carries the per-venue/symbol/asof grain the three widgets need.
- **Exposure by Asset Class** = group latest-`asof` holdings by asset_class, derived from venue/symbol via the EXISTING classifier (crypto vs traditional — same source as the annualization asset_class work, #597); value = sum(`value_usd`).
- **Net Exposure Over Time** = sum(`value_usd`) per `asof` (a real series over the holdings history).
- **Allocation Over Time** = per-strategy (or per-venue) weight = value_usd / total, per `asof`.
- Read functions are server-only, typed, return honest-empty (`[]` / null series) when the allocator has no holdings — never a fabricated or zero-filled series.

### Gap / coverage discipline
- Time-series reads mirror the factsheet coverage-mask discipline: a missing `asof` is a marked gap, never a zero-fill that reads as flat real exposure. Reuse the existing coverage/gap convention rather than inventing a new one.

### Security / RLS
- Owner-scoped: an allocator reads only their own holdings (RLS on `allocator_holdings` already enforces this — the read layer must NOT bypass it via a SECDEF unless a specific need is proven; prefer the RLS-scoped user client).
- Secretless: no `api_key` ciphertext or key material in any read shape or projection.

### PI-07 — cross-process recompute dedupe
- Add a PARTIAL UNIQUE INDEX on the portfolio-recompute inflight key (mirror the `compute_jobs_one_inflight_per_kind_strategy` pattern) so two processes racing a recompute cannot both insert a `computing` row. The process-local semaphore stays as a fast-path; the DB unique index is the real fence.
- Pin it with a real-Postgres integration test (`supabase/tests/test_*.sql` per the DB-test CI wiring): two concurrent inserts → one survives, no duplicate `computing`.
- Migration discipline: 14-digit timestamp later than latest; if it touches an existing object, grep-all + re-base on the latest def; SECDEF-hardened if any new function; route through migration-reviewer + rls-policy-auditor post-land. Auto-applies to prod on merge — and must be applied to the test project via MCP before the PR can go green.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `allocator_holdings` table with (allocator_id, venue, symbol, asof, holding_type, quantity, value_usd, mark_price) + indexes `allocator_holdings_allocator_asof_desc_idx` (allocator_id, asof DESC) and the owner/venue/symbol/asof unique key — the time-series + position grain already exists.
- Rich `src/components/portfolio/` widget library (AllocationTimeline, CompositionDonut, AttributionBar, CorrelationHeatmap, BenchmarkComparison, InsightStrip, …) — Phase 99/100 render targets; some may be reusable/adaptable.
- The asset_class classifier from #597 (crypto/traditional) for the Exposure-by-Asset-Class grouping.
- The `compute_jobs_one_inflight_per_kind_strategy` partial-unique-index pattern as the model for PI-07.

### Established Patterns
- Factsheet coverage-mask (marked gaps, never zero-fill) — the no-invented-data discipline the time-series reads must follow.
- Owner-scoped RLS reads via the user client (not SECDEF) for tenant data.
- DB-test CI wiring: RLS/index gates go in `supabase/tests/test_*.sql`; test project must be caught up via MCP before merge.

### Integration Points
- Read functions land in the analytics/query lib; Phase 99 widgets consume them.
- The recompute inflight path (wherever portfolio recompute enqueues/marks `computing`) gets the new unique-index fence.
</code_context>

<specifics>
## Specific Ideas
- The plan-phase researcher must LOCATE the exact portfolio-recompute inflight write path (where a `computing` row is created) before designing the PI-07 index — the semaphore is process-local today (TODOS.md:699); confirm the table + inflight key it should fence.
- Confirm the asset_class classifier is reusable for a POSITION (venue/symbol) vs a STRATEGY — it may need a per-symbol variant.
</specifics>

<deferred>
## Deferred Ideas
- Widget rendering (Phase 99), optimizer sleeve + Notes (Phase 100), options-MTM (101/102) — all out of scope here.
- Any NEW position-ingestion source (this phase reads existing `allocator_holdings`, does not add ingestion).
</deferred>
