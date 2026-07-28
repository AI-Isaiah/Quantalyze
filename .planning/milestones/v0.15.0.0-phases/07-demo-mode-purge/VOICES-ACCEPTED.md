# Voice-Accepted Findings — Phase 07

User accepted all 9 divergent findings from Voice A. Voice B (Grok) re-run surfaced 4 findings — 3 are CONSENSUS with Voice A's already-accepted items (reinforcing f2/f7 widget rewire, f5 mocked verification, f9 per-venue cap metadata); the 4th is NEW and the user accepted it as well (move 07-06 to wave=1).

Apply every finding below as a revision to the existing PLAN.md files. Preserve plan structure; modify scope, sequencing, task details, or acceptance criteria as each finding directs.

**Consensus reinforcement from Voice B (Grok) — fold into the same f2/f5/f7/f9 items below:**
- Grok f1 reinforces **f2 + f7**: explicitly adds EquityCurve/DrawdownChart/PositionsTable/InsightStrip to the rewire surface, and asks for an e2e test asserting charts render non-zero series from mocked snapshots. Add this e2e test to the acceptance criteria in the combined f2/f7 revision.
- Grok f3 reinforces **f5**: adds an integration test (separate from the env-gated live ccxt test) that hits a real test DB end-to-end — enqueue reconstruct → await job done → query getMyAllocationDashboard → render AllocationDashboard → assert charts have points. Add this as a sibling task to the env-gated live test in 07-02.
- Grok f4 reinforces **f9**: adds a manual QA step to 07-02 SUMMARY.md (connect test key to Binance/OKX, spot-check value_usd against exchange UI). Add to 07-02's Manual-Only Verifications.

---

## f1 — `refresh_allocator_equity_daily` scope fix (BLOCKER, 07-01 + 07-02)

**Problem:** 07-01 STEP 4 declares the new kind as allocator-scoped (`allocator_id IS NOT NULL AND api_key_id IS NULL`). 07-01 STEP 7's `enqueue_refresh_allocator_equity_for_all` enqueues with `p_allocator_id`. But 07-02 Task 2 tells the handler to call `_allocator_key_preflight` (job_worker.py lines 376–413), which hard-requires `job['api_key_id']`. Every cron job enqueues then permanently fails on dispatch.

**Apply:** Change 07-01 STEP 4 CHECK for `refresh_allocator_equity_daily` to `api_key_id IS NOT NULL` (key-scoped, not allocator-scoped). Change STEP 7's `enqueue_refresh_allocator_equity_for_all` to fan out one job per active `api_key_id` per allocator — mirrors `poll_allocator_positions` pattern exactly. Update 07-02 handler to operate per-key (aggregate across the allocator's keys happens at snapshot-write time via UPSERT on `(allocator_id, asof)`). `reconstruct_allocator_history` may remain key-scoped (first-connect is naturally key-scoped).

---

## f2 — Widget-rewire scope: hide non-KPI widgets when `strategies.length === 0` (BLOCKER, 07-03 + 07-04)

**Problem:** 30+ widgets in `src/app/(dashboard)/allocations/widgets/` all consume `data.strategies[].strategy_analytics.daily_returns` via `buildCompositeReturns`/`computeScenario`. Plans 07-03/07-04 rewire only KPI/EquityCurve/Drawdown/InsightStrip — leaving all other widgets reading stale strategy-composite data. Inconsistent numbers on the same page.

**Chosen sub-option: (b) Hide non-KPI/EquityCurve/Drawdown/InsightStrip widgets when `strategies.length === 0`.**

Rationale: preserves D-05 "Performance tab verbatim" for allocators WITH strategy data (post-Phase 09 Bridge allocators); cleanly handles zero-holdings (they see KPI + equity + drawdown + insight only); does not balloon 07-03 scope with a full widget-contract rewire.

**Apply:**
- In `AllocationDashboard.tsx`, gate the rendering of ALL widgets that consume `strategies[].strategy_analytics.daily_returns` (RollingSharpe, RollingVolatility, CumulativeVsBenchmark, TailRisk, RiskDecomposition, CorrelationMatrix, CorrelationOverTime, AlphaBetaDecomposition, TrackingError, RegimeDetector, StrategyComparison, MonthlyReturns, AnnualReturns, ReturnDistribution, WinRateProfitFactor, BestWorstPeriods, PerformanceByPeriod, VarExpectedShortfall, and any other strategy-composite widgets) on `data.strategies.length > 0`.
- KPI strip, EquityCurve, DrawdownChart, InsightStrip always render (they consume the new equity-snapshot-derived inputs per f7).
- Bridge/Outcome widgets (data from outcomes/strategies tables) keep their existing render conditions.
- Add a new acceptance criterion to 07-04 Task 3 (or new task): `grep "strategies.length > 0" AllocationDashboard.tsx` returns exactly one match (or equivalent gate helper).
- Add a Wave-0 test `AllocationDashboard.widget-gating.test.tsx` asserting: when `strategies.length === 0`, only KPI strip + EquityCurve + DrawdownChart + InsightStrip + (future) EmptyState render; strategy-composite widgets are absent.

---

## f3 — AllocationsTabs derive activeTab from searchParams each render (WARNING, 07-04)

**Problem:** Current template uses `useState(parseTab(searchParams.get("tab")))`, snapshotting tab on mount. Browser back/forward updates URL but leaves `activeTab` unchanged.

**Apply:** Remove the `useState`. Derive `activeTab` directly from `searchParams` on every render (matches `ProfileTabs.tsx` pattern verbatim). Tab-click calls `router.replace(url, { scroll: false })` which updates searchParams, which re-derives activeTab next render. Add a 7th test to `AllocationsTabs.test.tsx` asserting that re-rendering with different `searchParams.get('tab')` (simulated via `useSearchParams` mock re-render) toggles the visible tab panel.

---

## f4 — Verify migrations 001–010 for auth.users triggers before locking PURGE-05 (WARNING, 07-06)

**Problem:** RESEARCH.md A4 + Open Q2 explicitly flag this. If any early migration adds a seed-inserting trigger on auth.users, PURGE-05 needs a DROP TRIGGER migration, not doc-only.

**Apply:**
- Before 07-06 Task 2 executes, run: `grep -rn "ON auth.users" supabase/migrations/` and inspect each match. Document findings in 07-06's audit table.
- If any match is a trigger that inserts into `portfolios` or `allocator_holdings` or similar seed-adjacent tables: add a new task "07-06 Task 3b: DROP TRIGGER migration" that authors a new migration file to drop the offending trigger.
- Strengthen `src/__tests__/seed-integrity.test.ts` to scan for co-occurrence: for each file in `supabase/migrations/`, fail if it contains BOTH `ON auth.users` AND `INSERT INTO public.portfolios` (or `INSERT INTO allocator_holdings`). Replace the current "at most one `ON auth.users` substring globally" assertion.

---

## f5 — Add env-gated live ccxt integration test (WARNING, 07-02)

**Problem:** Mocked pytest green-lights whatever pagination code exists regardless of real ccxt boundary behaviour (OKX 3-month, Binance 90-day, Bybit cursor, CoinGecko rate-limit).

**Apply:** Add a new pytest file `analytics-service/tests/test_equity_reconstruction_live.py` with:
- Module-level `pytest.skip` guard: `if os.getenv("QUANTALYZE_LIVE_CCXT") != "1": pytest.skip("live-ccxt tests require QUANTALYZE_LIVE_CCXT=1", allow_module_level=True)`
- One test per venue (Binance, OKX, Bybit) that reads a read-only test API key from env (`BINANCE_TEST_API_KEY`, etc.), runs `reconstruct_allocator_history`, and asserts: (a) rows > 0 in `allocator_equity_snapshots` for the test allocator, (b) no raised exceptions, (c) OKX returns rows spanning <= 90 days (validates A3-adjacent behaviour).
- Keep out of CI default. Document in 07-02 Task acceptance criteria as `pytest analytics-service/tests/test_equity_reconstruction_live.py` runs green when env is set.

---

## f6 — Normalize Wave-0 naming across all plans (WARNING, all 6 plans)

**Problem:** Plans use "Wave 0" in prose (test-first TDD pattern) and `wave: N` in YAML (execution ordering). Same term, different meaning, collide.

**Apply:** In every PLAN.md (07-01 through 07-06): rename prose "Wave 0" to **"TDD Red gate"**. Keep YAML `wave: N` frontmatter values unchanged. Update 07-VALIDATION.md to match (rename "Wave 0 Requirements" section to "TDD Red gate tests" and "Wave 0 Gaps" accordingly). The `wave` frontmatter field now unambiguously refers to `/gsd-execute-phase` wave scheduling; "TDD Red gate" refers to the test-first pattern within a plan.

---

## f7 — Add equitySnapshotsToDailyPoints adapter + decide prop strategy (WARNING, 07-03)

**Problem:** 07-03 adds `equitySnapshots: Array<{asof, value_usd, breakdown, source}>` but never defines the adapter from snapshots → `DailyPoint[]` that `EquityCurve`/`DrawdownChart` need. Leaves translation as exercise.

**Apply:**
- Add 07-03 Task (new): implement `equitySnapshotsToDailyPoints(snapshots: EquitySnapshot[]): DailyPoint[]` in `src/lib/allocation-helpers.ts` (or `src/lib/equity-adapter.ts` — planner chooses). Include unit tests:
  - Happy path: dense daily snapshots → one DailyPoint per asof.
  - Mid-series gap: snapshots skip a day → adapter fills or flags? Decide: fill with previous day's value_usd (forward-fill), with a TODO to revisit for gap-aware charting.
  - Warm-up: snapshots.length < 30 → adapter returns whatever's available; warm-up gate in KPI handles the render.
- Decide prop strategy: **parallel-prop**. Pass `equityDailyPoints?: DailyPoint[]` alongside existing `data.strategies` prop on `EquityCurve`/`DrawdownChart`. When `equityDailyPoints` is present, prefer it; else fall back to existing `strategies`-derived compute. This lets Bridge allocators (post-Phase 09) still see strategy-composite charts if they prefer, and zero-holdings allocators see snapshot-derived charts without Breaking existing widget signatures.
- Wire `equityDailyPoints` through `getMyAllocationDashboard` payload → `AllocationDashboard` → widgets.

---

## f8 — Downgrade formatPercent(null) task to verification-only (INFO, 07-03)

**Problem:** `src/lib/utils.ts` line 8 already has `if (value == null) return "—";`. RESEARCH.md A5 flags this.

**Apply:** In 07-03, remove the "Fix `src/lib/utils.ts` `formatPercent`" code-change task. Keep the Wave-0/TDD-Red-gate test `utils.formatPercent-null.test.ts` as a regression guard (already passes against current code). Add a one-line acceptance criterion: `grep "if (value == null) return \"—\"" src/lib/utils.ts` returns one match, confirming the existing guard is present.

---

## f9 — Store `history_depth_months` per-venue in snapshot breakdown (INFO, 07-01 + 07-02)

**Problem:** Single `BACKFILL_CAP_DAYS = 730` constant in `equity_reconstruction.py` ignores per-venue retention. OKX allocators generically see "Warming up — need N more days" instead of venue-specific "Only 3 months of history available on OKX".

**Apply:**
- In 07-01 migration 070: add `history_depth_months int` column on `allocator_equity_snapshots` (or require the breakdown jsonb to carry a `history_depth_months` key; planner chooses — column preferred for indexability and typing).
- In 07-02 handler: after completing a reconstruction, record the per-venue cap (Binance=730, OKX=90 for trades / ~730 for OHLCV, Bybit=730) into the snapshot rows for that key.
- In 07-03 `getMyAllocationDashboard`: compute `min_history_depth_months = min(snapshot.history_depth_months for active keys)`. Expose as `minHistoryDepthMonths` on the payload.
- In 07-03 KpiStrip warm-up: when `snapshotCount < 30` AND `minHistoryDepthMonths < 3`, show venue-specific message like "Only X months of history available on {venues}" instead of generic warm-up.
- Add acceptance criterion test for the three venue messages.

---

## gB2 — Move 07-06 to wave=1 (WARNING, 07-06 frontmatter)

**Problem:** 07-06 frontmatter currently says `wave: 4`, but its `depends_on` list only references 07-03 per the planner summary (or per the actual PLAN file). Audit/regression tests (`src/__tests__/seed-integrity.test.ts` import-graph scan + OnboardingWizard noseed test) touch no data paths and run against code that exists today — there's no real dependency on 07-04/05 landing first. Sequencing it at wave=4 creates an illusion of blocking later waves unnecessarily.

**Apply:**
- Change 07-06 frontmatter from `wave: 4` to `wave: 1`.
- Update `depends_on` to the minimum required — likely just `[07-01]` (needs schema push for any migration-drop if f4 trigger audit surfaces a seed-inserting trigger); if 07-06 doesn't actually need the schema push, change to `[]`.
- Update ROADMAP.md wave structure summary for Phase 07 to reflect the new wave numbering.
- Keep 07-06's own task order intact; only the wave assignment changes.
- Re-check the wave diagram: Wave 1 now runs 07-01 + 07-06 in parallel; Wave 2 runs 07-02; Wave 3 runs 07-03; Wave 4 runs 07-04 + 07-05. (Or whatever simplified structure the planner derives.)

---

**Replan instructions:** Apply these 10 findings (9 Voice A + 1 new Grok sequencing finding + 3 reinforcement notes at the top of this file) as targeted edits to existing PLAN.md files. Do NOT re-plan from scratch. Preserve task IDs where possible. For any new tasks, append new task IDs to the appropriate plan rather than renumbering existing tasks. Return `## REVISION COMPLETE` with a bullet per finding applied.
