---
phase: 12-backend-metric-contracts
plan: 02
subsystem: database
tags: [supabase, postgres, migration, rpc, security-definer, search-path, jsonb, sibling-table, frozen-contract, typescript, rls]

# Dependency graph
requires:
  - phase: 12-backend-metric-contracts
    plan: 01
    provides: "TRADE_MIX_HAS_MAKER_TAKER = false flag for D-14 2-bucket fallback in TradeMixBuckets shape"
provides:
  - "Migration 086 — compute_jobs.priority TEXT enum (low/normal/high) + partial index idx_compute_jobs_priority_pending + claim_compute_jobs_with_priority RPC (SECURITY DEFINER + search_path=public,pg_temp + REVOKE FROM PUBLIC,anon,authenticated)"
  - "Migration 087 — strategy_analytics_series sibling table (PK strategy_id+kind, ON DELETE CASCADE) + RLS deny-all policy + fetch_strategy_lazy_metrics RPC (SECURITY DEFINER STABLE, GRANT EXECUTE TO authenticated/anon, panel→kind mapping) + upsert_strategy_analytics_series_batch atomic batch RPC (M-Grok-1, service_role only)"
  - "src/lib/database.types.ts regenerated (3363 lines) — Supabase typegen now includes claim_compute_jobs_with_priority, fetch_strategy_lazy_metrics, upsert_strategy_analytics_series_batch, and strategy_analytics_series row shape"
  - "src/lib/types.ts — D-16 frozen contract: TradeMetrics extended with 7 D-13/METRICS-07 derived fields (expectancy, risk_reward_ratio, weighted_risk_reward_ratio per H-F, sqn, profit_factor_long, profit_factor_short) + optional trade_mix?: TradeMixBuckets"
  - "src/lib/types.ts — TradeMixBucket + TradeMixBuckets interfaces (4-bucket variant or 2-bucket fallback both reachable via optional fields per D-15 audit branch)"
  - "src/lib/types.ts — StrategyAnalyticsSeriesKind union with EXACTLY 12 D-01 sibling kinds (H-D: equity_series_1y intentionally absent — lives in metrics_json, not sibling table) + StrategyAnalyticsSeriesRow + LazyMetricsPayload helper types"
  - "src/lib/types.ts — StrategyAnalytics.trade_metrics tightened from Record<string, unknown> | null to TradeMetrics | null so the frozen contract flows through the typed pipeline"
affects:
  - "Plan 12-03 (rolling Sortino/Vol/Greeks helpers in metrics.py) — reads frozen series-kind names from D-01 list when emitting payloads"
  - "Plan 12-04 (daily_returns_grid + exposure/turnover series + 10 qstats scalars) — reads frozen series-kind names + scalar key names"
  - "Plan 12-05 (5 derived trade metrics + Trade Mix aggregator) — writes the 7 derived fields exactly as locked in TradeMetrics + 2-bucket trade_mix shape per TRADE_MIX_HAS_MAKER_TAKER=false"
  - "Plan 12-06 (MetricsResult dataclass + sibling-table loop upsert in run_strategy_analytics) — calls upsert_strategy_analytics_series_batch RPC instead of per-kind round-trips (M-Grok-1 atomicity)"
  - "Plan 12-07 (dispatch_tick switch from claim_compute_jobs to claim_compute_jobs_with_priority) — RPC ready in remote DB"
  - "Plan 12-08 (fetchStrategyLazyMetrics consumer in queries.ts) — RPC + panel→kind mapping ready"
  - "Plan 12-09 (parity tests + regen_golden) — TS-side TradeMetrics shape locked for parity assertion; sibling-kind threshold reads StrategyAnalyticsSeriesKind enum size (12)"
  - "Plan 12-10 (kill-switch + deploy orchestrator) — strategy_analytics_series target table exists in remote for emergency cutover UPDATE"
  - "Phase 14a/14b — Strategy.trade_metrics?.expectancy, .trade_mix?.long?.count, etc. all type-check against the locked contract; mid-Phase-14b additions require a Phase 12 amendment"

# Tech tracking
tech-stack:
  added:
    - "Postgres SECURITY DEFINER + SET search_path = public, pg_temp hardening idiom (H-B; prevents privilege-escalation via search_path pollution)"
    - "JSONB sibling-table pattern with composite-PK + RLS deny-all + SECURITY-DEFINER read RPC for visibility-checked access"
    - "Atomic batch upsert RPC pattern (M-Grok-1) — jsonb_each-over-input-object inside SECURITY DEFINER for whole-batch atomicity"
  patterns:
    - "Self-verifying DO block at end of each migration asserts column/index/RPC/policy presence + proconfig search_path hardening (H-B)"
    - "Frozen TS contract in src/lib/types.ts — top-level keys locked at Phase boundary; mid-phase additions require amendment (D-16 enforcement)"
    - "Optional-field discriminated union for D-15 audit-gated variants (TradeMixBuckets covers 4-bucket and 2-bucket without compile-time branching)"
    - "RPC priority dispatch via UPDATE + ORDER BY CASE priority + FOR UPDATE SKIP LOCKED + WHERE (v_high_pending = 0 OR priority IN ('normal','high')) for backpressure-aware queue draining"

key-files:
  created:
    - "supabase/migrations/086_compute_jobs_priority.sql — priority enum + partial index + claim_compute_jobs_with_priority RPC + self-verifying DO block"
    - "supabase/migrations/087_strategy_analytics_series.sql — sibling table + RLS deny-all + fetch_strategy_lazy_metrics RPC + upsert_strategy_analytics_series_batch RPC + self-verifying DO block"
  modified:
    - "src/lib/database.types.ts — regenerated via supabase gen types --linked after applying 086 + 087; 3363 lines"
    - "src/lib/types.ts — D-16 frozen contract additions: TradeMetrics extended (7 derived + trade_mix?), TradeMixBucket + TradeMixBuckets, StrategyAnalyticsSeriesKind + Row + LazyMetricsPayload, StrategyAnalytics.trade_metrics tightened"
    - "src/lib/mock-data.ts — populated the 6 new derived-metric fields with plausible randomBetween values to satisfy the tightened contract (Rule 3 deviation)"

key-decisions:
  - "Migration numbering 086 + 087 (NOT 084 + 085 — those are taken by shipped Phase 11 work); reconciled in TODOS.md before plan-phase"
  - "H-B hardening: every SECURITY DEFINER RPC declares SET search_path = public, pg_temp (NOT pg_catalog); prevents privilege-escalation via search_path pollution; DO block asserts proconfig contains the literal 'search_path=public, pg_temp' string"
  - "H-D contract scope: equity_series_1y stays in metrics_json (above-the-fold), NOT in strategy_analytics_series; the 'equity' panel mapping in fetch_strategy_lazy_metrics returns ARRAY['log_returns_series'] only; StrategyAnalyticsSeriesKind union deliberately omits equity_series_1y"
  - "H-F contract addition: weighted_risk_reward_ratio is the 7th derived trade metric (per METRICS-07 'Weighted R:R'); TradeMetrics has 7 derived fields, not 6"
  - "M-Grok-1 atomicity: per-kind upsert loop in Plan 12-06 replaced by upsert_strategy_analytics_series_batch RPC — entire batch atomic via the function's implicit transaction; eliminates partial-write windows during sibling-table writes"
  - "Frozen TS contract per D-16: locking StrategyAnalytics.trade_metrics from Record<string, unknown> | null to TradeMetrics | null forces the contract through the typed pipeline; mock-data.ts had to be updated as Rule 3 fallout"
  - "BLOCKING checkpoint at Task 3 was applied via the orchestrator's MCP supabase tools (mcp__supabase__apply_migration) rather than via the supabase CLI in this agent's Bash context; verified via remote queries that all 3 RPCs exist with proconfig {search_path=public, pg_temp}; types regenerated; npm run build green"

patterns-established:
  - "Migration self-verification — DO block at end of every Phase 12 migration asserts every named object exists AND that SECURITY DEFINER functions have hardened search_path; failures RAISE EXCEPTION with the migration number for diagnosability"
  - "Type-contract freeze ledger — D-16 keys live in src/lib/types.ts under a 'Phase 12 / D-XX' comment marker; future plans grep these markers when proposing additions to know whether an amendment is required"
  - "Optional-bucket variant union — TradeMixBuckets uses all-optional fields rather than discriminated unions so D-15 audit can flip TRADE_MIX_HAS_MAKER_TAKER true/false without breaking type checks anywhere downstream"
  - "Strategy-visibility check inside SECURITY DEFINER body — fetch_strategy_lazy_metrics validates auth.uid() ownership or status='published' inside the function body, returns empty jsonb_build_object() (not raising) so existence isn't leaked"

requirements-completed: [METRICS-16, METRICS-17]
requirements-resolved-contracts: [METRICS-07, METRICS-14, METRICS-15]  # Contract surface locked (frozen TS keys + RPCs + sibling table); IMPLEMENTATIONS land in 12-05 (METRICS-07), 12-07 (METRICS-14), and 12-08 (METRICS-15). Mirror of 12-01 SUMMARY's 'requirements-resolved-gates' convention.

# Metrics
duration: 25m
completed: 2026-04-28
---

# Phase 12 Plan 02: Migrations 086 + 087 + Frozen TS Contracts Summary

**Shipped migrations 086 (compute_jobs.priority enum + claim_compute_jobs_with_priority RPC) and 087 (strategy_analytics_series sibling table + fetch_strategy_lazy_metrics + upsert_strategy_analytics_series_batch RPCs) to remote DB, regenerated TypeScript types, and locked the D-16 frozen contract in src/lib/types.ts (TradeMetrics with 7 derived fields per H-F, TradeMixBuckets, StrategyAnalyticsSeriesKind/Row).**

## Performance

- **Duration:** ~25 min wall-clock across 4 tasks (1 BLOCKING checkpoint applied via orchestrator MCP supabase tools)
- **Started:** 2026-04-28T11:54Z (continuing from Plan 12-01 completion)
- **Completed:** 2026-04-28T12:14Z (Task 4 atomic commit + this SUMMARY)
- **Tasks:** 4 (all four committed atomically)
- **Files modified:** 4 (2 new migrations + 2 TS files; database.types.ts regenerated)

## Accomplishments

- **Migrations 086 + 087 written and applied to remote** (Supabase project `khslejtfbuezsmvmtsdn`, versions `20260428120836` + `20260428120919`); all 3 new RPCs verified to carry `SET search_path = public, pg_temp` (H-B hardening) via `pg_proc.proconfig` query.
- **`claim_compute_jobs_with_priority` RPC** ships with priority dispatch — UPDATE-RETURNING with `ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END`, FOR UPDATE SKIP LOCKED, and the v_high_pending guard so backfill (`low`) never queues ahead of `sync_trades` (`normal`) when high-priority work is pending.
- **`strategy_analytics_series` sibling table** ships with RLS deny-all + FK CASCADE on `strategies.id`, partial index `idx_strategy_analytics_series_payload_present`, and PRIMARY KEY `(strategy_id, kind)` per D-02 schema.
- **`fetch_strategy_lazy_metrics` RPC** ships with the H-D-corrected panel mapping (`'equity'` → `ARRAY['log_returns_series']`, NOT `['equity_series_1y', 'log_returns_series']`); visibility check via `EXISTS … WHERE status='published' OR user_id = auth.uid()`; returns empty `jsonb_build_object()` on failure to avoid leaking strategy existence.
- **`upsert_strategy_analytics_series_batch` RPC** (M-Grok-1) ships as the atomic batch-upsert path replacing per-kind round-trips in Plan 12-06; service_role only.
- **`src/lib/database.types.ts` regenerated** via `supabase gen types typescript --linked` (3363 lines); all 3 new RPCs and the new table appear in the generated types.
- **`src/lib/types.ts` D-16 contract locked** — TradeMetrics has 7 derived fields (incl. weighted_risk_reward_ratio per H-F), 6 optional trade_mix bucket fields covering both 4-bucket and 2-bucket variants, and a 12-element StrategyAnalyticsSeriesKind union (H-D: deliberately no equity_series_1y).
- **`StrategyAnalytics.trade_metrics` tightened** from `Record<string, unknown> | null` to `TradeMetrics | null` so the frozen contract flows through `getStrategyDetail()` and Phase 14b consumers.
- **`npm run build` exits 0** post-tightening, confirming the contract holds across the entire repo.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 086_compute_jobs_priority.sql** — `985ba61` (feat)
2. **Task 2: Write migration 087_strategy_analytics_series.sql** — `af121f5` (feat)
3. **Task 3 [BLOCKING checkpoint]: Apply migrations to remote DB and regenerate TypeScript types** — `b3805ac` (feat) — applied via orchestrator MCP supabase tools (`mcp__supabase__apply_migration`); types regenerated and committed in this hash
4. **Task 4: Lock frozen TS contracts in src/lib/types.ts** — `262ff44` (feat)

_Plan metadata commit follows below (covers SUMMARY.md + STATE.md + ROADMAP.md updates)._

## Files Created/Modified

- `supabase/migrations/086_compute_jobs_priority.sql` — priority enum (low/normal/high) on `compute_jobs`, partial index `idx_compute_jobs_priority_pending`, `claim_compute_jobs_with_priority(p_batch_size, p_worker_id)` SECURITY DEFINER RPC with hardened search_path, REVOKE FROM PUBLIC/anon/authenticated, self-verifying DO block.
- `supabase/migrations/087_strategy_analytics_series.sql` — `strategy_analytics_series` table (composite PK, JSONB payload, FK CASCADE), partial index, RLS enable + deny-all policy, `fetch_strategy_lazy_metrics(p_strategy_id, p_panel_id)` STABLE SECURITY DEFINER RPC with H-D-corrected panel mapping + visibility check + GRANT EXECUTE TO authenticated, anon, `upsert_strategy_analytics_series_batch(p_strategy_id, p_kinds JSONB)` SECURITY DEFINER RPC for atomic batch writes (M-Grok-1) granted only to service_role, self-verifying DO block (7 assertions).
- `src/lib/database.types.ts` — regenerated, 3363 lines; new RPCs + table now type-check end-to-end.
- `src/lib/types.ts` — D-16 frozen contract additions: TradeMetrics +7 derived fields + optional trade_mix, TradeMixBucket + TradeMixBuckets, StrategyAnalyticsSeriesKind (12 kinds, H-D — no equity_series_1y) + StrategyAnalyticsSeriesRow + LazyMetricsPayload, StrategyAnalytics.trade_metrics tightened to TradeMetrics | null.
- `src/lib/mock-data.ts` — populated 6 new derived-metric fields with plausible randomBetween values (Rule 3 deviation) so the tightened StrategyAnalytics.trade_metrics: TradeMetrics | null contract passes the build.

## Decisions Made

**Migration numbering 086 + 087 (NOT 084/085).** Migrations 084 + 085 are already shipped Phase 11 work; this was reconciled in TODOS.md ("Other Phase 12 todos") at plan-phase boundary before any code was written. RESEARCH.md §6/§7 was rewritten 086→086 / 085→087 in commit 3685362.

**H-B search_path hardening on all SECURITY DEFINER RPCs.** Every new RPC (`claim_compute_jobs_with_priority`, `fetch_strategy_lazy_metrics`, `upsert_strategy_analytics_series_batch`) declares `SET search_path = public, pg_temp` (NOT `pg_catalog` — the original 12-REVIEWS.md hedge was wrong; `pg_temp` blocks search_path-pollution privilege-escalation while keeping built-in operators reachable). The DO block asserts the literal `search_path=public, pg_temp` string in `pg_proc.proconfig` for each function, so a regression in any future migration that removes the hardening would fail the migration apply.

**H-D contract scope: equity_series_1y stays in metrics_json.** The original D-01 listing temporarily included `equity_series_1y` in the sibling kinds; H-D from 12-REVIEWS.md called this out as a conflict with the "above-the-fold" rule. Resolution: the StrategyAnalyticsSeriesKind union has exactly 12 kinds (no equity_series_1y), and the `'equity'` panel mapping in `fetch_strategy_lazy_metrics` resolves to `ARRAY['log_returns_series']` only. Phase 14b path-extracts `equity_series_1y` from `metrics_json` directly (`metrics_json -> 'equity_series_1y'`), not via the lazy RPC. The migration grep check `! grep -q "ARRAY\['equity_series_1y', 'log_returns_series'\]" 087_*.sql` enforces this at apply time.

**H-F contract addition: 7 derived trade metrics, not 6.** The original D-13 listing showed 5 derived metrics (Expectancy, R:R, SQN, PF long, PF short); H-F from 12-REVIEWS.md and METRICS-07 in REQUIREMENTS.md ("7 derived trade metrics — Expectancy, R:R, **Weighted R:R**, Long PF, Short PF + side-segmented Trade Main aggregator") established that `weighted_risk_reward_ratio` is also part of the frozen contract. TradeMetrics now has 7 derived fields. Wave D (Plan 12-05) implements the math; this plan only locks the type.

**M-Grok-1 atomicity: batch upsert RPC instead of per-kind loop.** Plan 12-06 originally had a per-kind upsert loop (one round-trip per sibling kind); M-Grok-1 from 12-REVIEWS.md flagged this as a partial-write hazard during analytics_runner crashes. Resolution: this plan ships `upsert_strategy_analytics_series_batch(p_strategy_id, p_kinds JSONB)` which uses `jsonb_each(p_kinds)` to upsert all rows in a single SECURITY DEFINER call — entire batch atomic via the function's implicit transaction. Plan 12-06 calls this RPC instead of looping.

**Frozen-contract enforcement via TS tightening.** Per D-16, the frozen-contract obligation is meaningful only if the type pipeline enforces it. Tightening `StrategyAnalytics.trade_metrics` from `Record<string, unknown> | null` to `TradeMetrics | null` is the lever — it forces every consumer (mock-data, queries, UI panels) to satisfy the locked shape. The Rule 3 mock-data fix is downstream fallout, not deviation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Mock-data fixture missing 6 new derived-metric fields**
- **Found during:** Task 4 (TS contract lock + `npm run build` verification check #13)
- **Issue:** Tightening `StrategyAnalytics.trade_metrics` from `Record<string, unknown> | null` to `TradeMetrics | null` (per plan Task 4 step 4) caused TypeScript to type-check the existing `src/lib/mock-data.ts:212` `trade_metrics: { ... }` literal against the new TradeMetrics shape. The mock omitted the 6 new derived fields (expectancy, risk_reward_ratio, weighted_risk_reward_ratio, sqn, profit_factor_long, profit_factor_short). Build failed:
  ```
  ./src/lib/mock-data.ts:212:5
  Type error: Type '{ … }' is missing the following properties from type 'TradeMetrics': expectancy, risk_reward_ratio, weighted_risk_reward_ratio, sqn, and 2 more.
  ```
- **Fix:** Populated the 6 new fields with plausible `randomBetween` values matching the existing mock pattern (see file diff lines 222-228). Real values arrive from `analytics-service/services/metrics.py` once Plan 12-05 lands the math. The mock-data path serves the demo/showcase routes; populating with realistic-but-mock values keeps the demo coherent without lying about real strategy performance.
- **Files modified:** `src/lib/mock-data.ts` (lines 212-228; added 8 lines).
- **Verification:** `npm run build` exits 0 post-fix.
- **Committed in:** `262ff44` (Task 4 commit — bundled with the types.ts contract lock since both files form the same contract-tightening change).

---

**Total deviations:** 1 auto-fixed (1 blocking issue per Rule 3).
**Impact on plan:** The fix is a mechanical one-spot patch to keep the typed pipeline buildable post-tightening — exactly the kind of fallout Rule 3 covers. No scope creep. The Phase 12 plan-as-drafted assumed `mock-data.ts` would track the contract; this auto-fix maintains that contract.

## Issues Encountered

- **Hook noise (false positives) on Edit operations.** The `PreToolUse:Edit` hook fired multiple `READ-BEFORE-EDIT REMINDER` messages on `types.ts` and `mock-data.ts` even though both files were Read in the same session within a few tool calls before each Edit. Each Edit succeeded; the hook reminder is purely informational and doesn't block. Documented here in case the same pattern surfaces on later Phase 12 plans — the runtime accepted every edit despite the warnings.

- **Task 3 BLOCKING checkpoint executed via orchestrator MCP, not Bash CLI.** The plan's Task 3 action block listed `supabase db push` and `supabase gen types typescript --linked` as Bash commands, but the executor (this agent) inherits a fresh sandboxed Bash context that does not have a logged-in `supabase` CLI session, and orchestrator-side MCP supabase tools (`mcp__supabase__apply_migration`, `mcp__supabase__generate_typescript_types`) are the canonical path for this project. The orchestrator applied both migrations via MCP, regenerated types, and committed at `b3805ac` before spawning this agent for Task 4. The DO-block self-verification messages from the migrations did emit cleanly during the apply step. This is not a deviation — it's a tool-routing choice the orchestrator made; documenting for future replay.

## User Setup Required

None — all migrations applied via orchestrator's MCP path; no environment variables added; no dashboard configuration needed. The new RPCs auto-grant per the migration's `GRANT EXECUTE` clauses (`fetch_strategy_lazy_metrics` to authenticated/anon; `claim_compute_jobs_with_priority` and `upsert_strategy_analytics_series_batch` to service_role only).

## Next Phase Readiness

- **Plan 12-03 (rolling Sortino/Vol/Greeks helpers in metrics.py — Wave 3):** Unblocked. The series-kind names (`rolling_sortino_3m/6m/12m`, `rolling_volatility_3m/6m/12m`, `rolling_alpha`, `rolling_beta`) are now locked in StrategyAnalyticsSeriesKind; metrics.py emits payloads keyed by these strings.
- **Plan 12-04 (daily_returns_grid + exposure/turnover series + 10 qstats scalars — Wave 3):** Unblocked. Series-kind names + scalar key names locked.
- **Plan 12-05 (5 derived trade metrics + Trade Mix aggregator — Wave 3):** Unblocked. TradeMetrics has the 7 derived field names + 2-bucket trade_mix shape locked (TRADE_MIX_HAS_MAKER_TAKER=false from Plan 12-01); aggregator writes the exact shape this contract expects.
- **Plan 12-06 (MetricsResult + sibling-table loop upsert — Wave 4):** Unblocked. Calls `upsert_strategy_analytics_series_batch(strategy_id, kinds_jsonb)` instead of looping; M-Grok-1 atomicity locked in.
- **Plan 12-07 (dispatch_tick switch — Wave 5, TDD):** Unblocked. `claim_compute_jobs_with_priority(5, worker_id)` is the new `analytics-service/main_worker.py:100` call site replacement.
- **Plan 12-08 (fetchStrategyLazyMetrics consumer — Wave 5):** Unblocked. RPC + panel→kind mapping + visibility check ready in remote.
- **Plan 12-09 (parity tests — Wave 6, TDD):** Unblocked. `EXPECTED_SIBLING_KINDS.size == 12` matches the StrategyAnalyticsSeriesKind union cardinality.
- **Plan 12-10 (kill-switch + deploy orchestrator — Wave 7):** Unblocked. `strategy_analytics_series` table ready as the emergency-cutover destination if `pg_column_size(metrics_json) > 800kB` at p99.9 fires.
- **Phase 14a/14b (Strategy detail UI):** The frozen contract is the source of truth — adding any key requires a Phase 12 amendment plan. Reads `Strategy.trade_metrics?.expectancy`, `.trade_mix?.long?.count`, etc., type-checked end-to-end.
- **Concern carried forward:** Production `trades` table is empty (per Plan 12-01 D-15 audit) — this means TradeMix aggregator will produce empty 2-bucket payloads on the first backfill. Not a Phase 12 regression; flagged for v0.17.1 once raw-fill ingestion populates `trades` for binance/okx/bybit.

## Self-Check: PASSED

- Files exist:
  - `supabase/migrations/086_compute_jobs_priority.sql` — FOUND
  - `supabase/migrations/087_strategy_analytics_series.sql` — FOUND
  - `src/lib/database.types.ts` — FOUND (3363 lines)
  - `src/lib/types.ts` — FOUND (with all 13 plan-defined grep markers)
  - `src/lib/mock-data.ts` — FOUND (6 new derived-metric fields populated)
- Commits exist (verified `git log --oneline -5`):
  - `985ba61` — Task 1 (migration 086) — FOUND
  - `af121f5` — Task 2 (migration 087) — FOUND
  - `b3805ac` — Task 3 BLOCKING (apply + types regen) — FOUND
  - `262ff44` — Task 4 (frozen TS contracts) — FOUND
- All 13 plan-defined verification checks (line 489) pass:
  - 12 grep markers in `src/lib/types.ts` (expectancy, risk_reward_ratio, weighted_risk_reward_ratio, sqn, profit_factor_long, profit_factor_short, interface TradeMixBucket, interface TradeMixBuckets, long_maker, type StrategyAnalyticsSeriesKind, interface StrategyAnalyticsSeriesRow, NO `"equity_series_1y"` literal): all PASS
  - `npm run build > /dev/null 2>&1`: exits 0
- All acceptance criteria from `<acceptance_criteria>` met (Tasks 1-4).
- No stubs introduced (all referenced types, RPCs, and panel mappings flow to concrete implementations in later plans 12-05/06/07/08/09).

---
*Phase: 12-backend-metric-contracts*
*Completed: 2026-04-28*
