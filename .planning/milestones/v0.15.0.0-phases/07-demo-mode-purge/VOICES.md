# Outside Voices — Phase 07

**Voice A (Claude subagent, fresh context, opus):** verdict=revise — Two BLOCKER contradictions exist between 07-01 and 07-02 on the refresh_allocator_equity_daily job shape (scope mismatch makes the handler uncallable) and 07-03/07-04 drastically understate the rewire surface (AllocationDashboard is 548 LOC with 30+ widgets, not the 4 widgets RESEARCH.md §3B implies). Several WARNINGs around Wave-0 test feasibility, back/forward tab desync, and unverified migration-001–009 trigger assumption. (9 findings.)

**Voice B (Grok grok-4-1-fast-reasoning):** verdict=revise — Plans miss rewiring AllocationDashboard child widgets (EquityCurve, DrawdownChart, PositionsTable, InsightStrip) to consume new equitySnapshots/holdingsSummary payload fields, leaving Performance tab KPIs functional but charts/table/insights still seed-derived or broken. 07-06 wave=4 creates false dependency sequencing smell. (4 findings. First run returned empty shallow response; re-run at user's request produced these findings.)

## Consensus findings (auto-fold into replan)

| # | Priority | Area | Title | Severity (A/B) | Confidence (A/B) | Recommendation |
|---|----------|------|-------|----------------|------------------|----------------|
| C1 | P0 | scope | Widgets not rewired to new payload; widget surface undercounted | BLOCKER/BLOCKER | HIGH/HIGH | Combine Voice A f2 (hide non-KPI widgets when strategies.length===0) + Voice A f7 (equitySnapshotsToDailyPoints adapter in allocation-helpers.ts with parallel-prop strategy) + Voice B f1 (update AllocationDashboard to compute/pass equitySeries; rewire EquityCurve/DrawdownChart/PositionsTable/InsightStrip props; add e2e test asserting charts render non-zero series from mocked snapshots). |
| C2 | P1 | verification | Verification of reconstruction/widgets is mocked-only | WARNING/WARNING | MED/MED | Combine Voice A f5 (env-gated QUANTALYZE_LIVE_CCXT per-venue integration smoke) + Voice B f3 (add 07-02 Task integration test: enqueue reconstruct → await job done → query getMyAllocationDashboard → render AllocationDashboard → assert charts have points). Both tests live in analytics-service/tests; one hits real exchanges (env-gated), one hits real test DB + full Next.js render pipeline. |
| C3 | P3 | risk | Reconstruction metadata not surfaced + complexity unproven beyond unit | INFO/INFO | MED/HIGH | Combine Voice A f9 (store history_depth_months per-venue in snapshot rows; KPI warm-up message venue-specific) + Voice B f4 (document manual QA step in 07-02 SUMMARY.md: connect test key to Binance/OKX, spot-check value_usd against exchange UI). |

## Divergent findings (require user decision)

### Already accepted by user (first voices round, Voice A only)

These findings were presented to the user after the initial voices round and ALL were accepted. Keeping them in the replan:

| # | Priority | Area | Title | Voice A says | Voice B says |
|---|----------|------|-------|--------------|--------------|
| f1 | P0 | architecture | `refresh_allocator_equity_daily` scope mismatch — kind-coherence CHECK vs handler preflight | **BLOCKER (HIGH):** Change CHECK to `api_key_id IS NOT NULL`; fan out one job per active key. | (not flagged) |
| f3 | P1 | architecture | AllocationsTabs back/forward navigation will desync tab state | **WARNING (HIGH):** Derive `activeTab` directly from searchParams each render. | (not flagged) |
| f4 | P1 | risk | 07-06 PURGE-05 trigger audit unverified | **WARNING (HIGH):** grep migrations 001–010 for auth.users triggers before locking PURGE-05. | (not flagged) |
| f6 | P1 | sequencing | Wave-0 naming collision | **WARNING (HIGH):** Rename prose "Wave 0" to "TDD Red gate". | (not flagged) |
| f8 | P3 | verification | formatPercent(null) already resolved in codebase | **INFO (HIGH):** Downgrade task to verification-only. | (not flagged) |

### New from Voice B (re-run) — requires user decision

| # | Priority | Area | Title | Voice A says | Voice B says |
|---|----------|------|-------|--------------|--------------|
| gB2 | P1 | sequencing | 07-06 wave=4 unnecessarily after 07-04/05 | (not flagged) | **WARNING (HIGH):** 07-06 only depends on 07-03 per frontmatter; audit tests are independent of tabs/empty-state. Move 07-06 to wave=1 (post-migration, pre-worker). |
