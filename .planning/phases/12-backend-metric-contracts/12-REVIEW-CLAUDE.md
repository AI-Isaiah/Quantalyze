# Phase 12 Plan Review — Claude (Fresh Context)

**Generated:** 2026-04-27
**Reviewer:** feature-dev:code-reviewer subagent (no prior conversation context)

## Summary

- Plans reviewed: 10 (12-01..12-10) plus CONTEXT.md, RESEARCH.md, ROADMAP.md, REQUIREMENTS.md
- Verdict: **BLOCK — PROCEED WITH FIXES**
- BLOCKER count: 2
- HIGH count: 4
- MEDIUM count: 4
- LOW count: 3

---

## BLOCKER findings (must fix before execute)

### B-01: `_compute_volume_metrics` data-flow error — derived metrics will be all-None at runtime

**Plan:** 12-05, Task 1

**Issue:** Plan 05 Task 1 (GREEN phase) adds `expectancy`, `risk_reward_ratio`, and `sqn` to `_compute_volume_metrics` by reading `result.get("avg_winning_trade", 0.0)`, `result.get("avg_losing_trade", 0.0)`, and `result.get("win_rate", 0.0)` from the in-progress `result` dict. The current implementation of `_compute_volume_metrics` at `analytics-service/services/analytics_runner.py:49-77` returns only these keys: `buy_volume_pct`, `sell_volume_pct`, `long_volume_pct`, `short_volume_pct`, `total_fills`, `total_volume_usd`. None of `avg_winning_trade`, `avg_losing_trade`, or `win_rate` are computed in this function — they are computed in `reconstruct_positions()` (a completely separate async call path at `analytics_runner.py:220`). The result will be:
- `win_rate = 0.0` (missing key, default 0)
- `avg_win = 0.0` (missing key, default 0)
- `avg_loss = 0.0` (missing key, default 0)
- `expectancy = None` (both zero → `if avg_win or avg_loss: False`)
- `risk_reward_ratio = None` (avg_loss == 0)
- `sqn = None` (risk_unit == 0)

This means METRICS-07 and METRICS-08 ship silently broken — all five derived metrics will always be `None` in production.

The plan also uses `profit_factor_long = _profit_factor(long_pnls)` where `long_pnls = [t.get("realized_pnl_usd", ...) for t in fills if t.get("side") == "long"]`. But `fills` here is the existing fills list (only `side` and `cost` fields at line 58-65 — `cost` field, not `realized_pnl_usd`). Profit factor will also always return `None`.

**Fix:** Either (a) compute `avg_winning_trade`, `avg_losing_trade`, `win_rate` from `fills` directly within `_compute_volume_metrics` using per-fill `realized_pnl_usd` (requires the `fills` query at `analytics_runner.py:224-230` to also select `realized_pnl_usd`, `side`, `holding_period_hours` fields), OR (b) move the derived-metric computation to a separate function that receives both the volume fills AND the existing `trade_metrics` dict from `reconstruct_positions()` as inputs. Option (b) matches the actual data architecture better — trade stats are positional (from `reconstruct_positions`), not fill-level. The fills query at line 224-230 currently only selects `side, cost` — it must be extended to also fetch `realized_pnl_usd` if option (a) is chosen.

---

### B-02: Wave 3 parallel execution creates a merge conflict on `metrics.py`

**Plans:** 12-03 AND 12-04 (both `wave: 3`, both `depends_on: [12-02]`)

**Issue:** Plans 03 and 04 are marked `wave: 3` and `depends_on: [12-02]` only — no dependency between them. Both plans modify `analytics-service/services/metrics.py`. Plan 03 appends `MAR`, `_rolling_sortino`, `_rolling_volatility`, `_rolling_alpha`, `_rolling_beta`, and `_log_returns_series`. Plan 04 adds `_daily_returns_grid_from_series` and `compute_qstats_scalars` to the same file. If run in parallel (as the wave structure implies), these will create a merge conflict. The frontmatter `wave: 3` on both plans, combined with `depends_on: [12-02]` (not `depends_on: [12-02, 12-03]` for plan 04), is structurally ambiguous about whether they can truly execute in parallel.

Additionally, Plan 04 also modifies `analytics-service/tests/test_metrics.py` (adding tests for `_daily_returns_grid_from_series` and `compute_qstats_scalars`), while Plan 03 also modifies the same file (adding tests for rolling helpers). A concurrent TDD loop on the same test file creates a race condition.

**Fix:** Plan 04 must add `depends_on: [12-03]` to its frontmatter (making it Wave 3b sequential after 03), OR plans 03 and 04 must be merged into a single plan. Since both are additive to `metrics.py` without touching the same functions, sequential is the safe choice. Update Plan 04 frontmatter: `depends_on: [12-02, 12-03]`, wave: 3 (or wave: 4 if renumbering makes sense). Similarly, Plan 05 modifies `analytics_runner.py` and `tests/test_analytics_runner.py` — it can remain parallel to 03/04 since it touches different files.

---

## HIGH findings (fix before merge / before plan-checker re-run)

### H-01: `equity_series_1y` treated as a sibling kind by Plan 02 and migration 087 — contradicts D-01

**Plans:** 12-02, 12-09

**Issue:** D-01 (CONTEXT.md) explicitly places `equity_series_1y` in `metrics_json` (above-the-fold series that stays in the main table): "**`metrics_json` keys:** ... + above-the-fold series (`equity_series_1y`, sparkline) + all existing qstats scalars." However, Plan 02 Task 2 includes `equity_series_1y` in the migration 087 `fetch_strategy_lazy_metrics` RPC panel mapping (`'equity' THEN ARRAY['equity_series_1y', 'log_returns_series']`). Plan 02 Task 4 includes `equity_series_1y` in the `StrategyAnalyticsSeriesKind` union in `src/lib/types.ts`. Plan 09 Task 3 includes it in `EXPECTED_SIBLING_KINDS` in `metrics-parity-helper.ts`.

No plan task actually writes `equity_series_1y` to the sibling table (Plan 06 wires only the 12 sibling kinds from D-01, which do not include `equity_series_1y`). The RPC would return an empty payload for the `equity` panel even after backfill, breaking Phase 14b's panel 2 equity curve.

**Fix:** Remove `equity_series_1y` from the migration 087 RPC `'equity'` panel mapping (it should read from `metrics_json` directly, not the sibling table). Remove it from `StrategyAnalyticsSeriesKind` in Plan 02 Task 4 and from `EXPECTED_SIBLING_KINDS` in Plan 09 Task 3. The `equity` panel_id in the RPC should map to only `['log_returns_series']` (or `ARRAY[]::TEXT[]` if `equity_series_1y` is served via path-extraction). Update RESEARCH.md §3 Wave E task 17 panel mapping accordingly. This is a D-01 vs implementation inconsistency that will cause silent empty payloads in Phase 14b.

---

### H-02: RESEARCH.md §6 SQL skeleton RAISE strings still say "Migration 084" — executor will copy wrong text verbatim

**Plans:** 12-02 (Task 1 and Task 2)

**Issue:** Plan 02 correctly uses migration numbers 086/087 throughout (confirmed in the plan's acceptance_criteria and verify greps). However, RESEARCH.md §6a (the SQL skeleton template that Plan 02 Task 1 explicitly instructs to mirror: "per RESEARCH.md §6a") still has `RAISE EXCEPTION 'Migration 084: priority column missing'`, `RAISE NOTICE 'Migration 084: priority enum + partial index + claim RPC installed.'` throughout. Plan 02 Task 1 says "Create `supabase/migrations/086_compute_jobs_priority.sql` with these required components (per RESEARCH.md §6a + D-05/D-06)" and shows the correct `'Migration 086'` strings in its own action block. But the `<read_first>` section says to read RESEARCH.md §6a verbatim — a distracted executor may copy the §6a skeleton directly and get the wrong migration number in the self-verifying DO block.

The verify grep in Plan 02 Task 1 checks for `grep -qE "RAISE EXCEPTION 'Migration 086"` — this will catch the error IF the executor runs the verify step. But the inconsistency creates unnecessary risk.

**Fix:** Update RESEARCH.md §6a and §6b skeletons to use 086/087 throughout, or add a bold note at the top of each skeleton section: "⚠️ NUMBERING NOTE: Use 086/087 (not 084/085 shown below — those are taken). The plan action block above has the correct numbers."

---

### H-03: Plan 06 explicitly punts on `exposure_series`/`turnover_series` sibling-kind wiring — creates invisible test gap

**Plan:** 12-06, Task 2

**Issue:** Plan 06 Task 2 action block states: "if those inputs aren't available in this scope, document the TODO and skip — the parity test in Plan 09 will catch missing kinds." This is an explicit acceptance of silent omission of `exposure_series` and `turnover_series` from `sibling_kinds`. Plan 09 Task 1 acceptance criteria says "sibling dict has at least 9 kinds... exposure/turnover **may be absent if synthetic fixture lacks position data** — that's acceptable for fixture." The fixture `regen_golden.py` in Plan 09 does not call `compute_turnover_series()` or the refactored `compute_exposure_metrics()` at all (it only calls `compute_all_metrics()` and the trade-side helpers).

This means both METRICS-05 and METRICS-06 will pass unit tests in Plans 04/05 but will NOT appear in the golden fixture's `sibling` dict, will NOT be verified by the parity test, and will NOT be verified as part of Plan 06's integration. The CI gate (D-12: "fail-loud on any new key not present in expected JSON") won't catch missing keys — it only catches extra keys. The missing exposure_series and turnover_series will simply be absent from both expected and actual.

**Fix:** Plan 09 Task 1 (`regen_golden.py`) must call `compute_turnover_series()` and the refactored `compute_exposure_metrics()` using synthetic position/price/NAV data from the fixture, so the expected JSON includes `exposure_series` and `turnover_series`. Plan 06 Task 2 must commit to wiring these (not punt) by ensuring `run_strategy_analytics` computes and passes `positions_by_date`, `prices_by_date`, and `nav_by_date` to `compute_turnover_series()`. If the position data isn't available at that call site, this is an architecture gap that must be resolved — not deferred.

---

### H-04: `METRICS-07` requirement specifies "Weighted R:R" but Plan 05 and D-13 omit it

**Plans:** 12-05, affecting METRICS-07

**Issue:** REQUIREMENTS.md §METRICS-07 states: "7 derived trade metrics added — Expectancy, R:R, **Weighted R:R**, Long PF, Short PF + side-segmented Trade Main aggregator." CONTEXT.md D-13 lists: "Five derived trade metrics — Expectancy, Risk:Reward Ratio, SQN (METRICS-08), Profit Factor (long), Profit Factor (short), plus Trade Mix." Weighted R:R is present in REQUIREMENTS.md but absent from D-13 and from every plan task. The frozen TS contract in Plan 02 Task 4 does not include `weighted_risk_reward_ratio`. The parity fixture won't include it.

If Phase 14b renders KPI-14 ("Risk/Reward row: R:R, Weighted R:R, Profit Factor..."), the `weighted_risk_reward_ratio` key will be missing from `trade_metrics` JSONB.

**Fix:** Either (a) add `Weighted R:R` computation to Plan 05 Task 1 and add `weighted_risk_reward_ratio: number | null` to the frozen TS contract in Plan 02 Task 4, OR (b) explicitly document in TODOS.md that Weighted R:R is deferred to Phase 14b amendment per D-16 and confirm REQUIREMENTS.md §METRICS-07 scope has been intentionally trimmed to 5+Trade Mix (not 7). The discrepancy between the 7-metric REQUIREMENTS.md count and the 5-metric D-13 count must be explicitly resolved before execution.

---

## MEDIUM findings (fix if time)

### M-01: `TRADE_MIX_HAS_MAKER_TAKER` env-var consistency across Python regen / TS test / CI not enforced by any single plan

**Plans:** 12-05, 12-09, 12-10

**Issue:** Three plans read the same flag independently:
- Plan 05 Task 2: `os.getenv("TRADE_MIX_HAS_MAKER_TAKER")` in `_compute_volume_metrics`
- Plan 09 Task 1: `os.getenv("TRADE_MIX_HAS_MAKER_TAKER")` in `regen_golden.py`
- Plan 09 Task 3: `process.env.TRADE_MIX_HAS_MAKER_TAKER` in TS parity test

No plan task sets this env var in CI configuration (`.github/workflows/`, Vercel env vars, Railway env vars). Plan 09 acceptance criteria says "CI sets identically" but no plan defines WHERE CI gets this value. If CI defaults to env-var-absent (the typical case), all three readers default to the 2-bucket path regardless of audit outcome, meaning the 4-bucket path is never tested in CI even if the audit passes.

**Fix:** Plan 10 (deploy orchestrator) or Plan 01 should include a step that writes the `TRADE_MIX_HAS_MAKER_TAKER` flag from `TODOS.md` into a CI-readable env file (e.g., `.env.test` or a GitHub Actions secret). Alternatively, add a CI step that reads TODOS.md and exports the flag before running parity tests. Document the canonical source of truth as TODOS.md and the propagation mechanism in CLAUDE.md or STATE.md.

---

### M-02: `phase12_backfill_enqueue.py` lacks duplicate-job guard and references a non-existent unique constraint

**Plan:** 12-10, Task 1

**Issue:** The plan's idempotency comment states: "Idempotent: re-running enqueues again, but the deduplication is at the worker level (`compute_jobs` unique constraint on (strategy_id, kind, payload) — **verify before running**)." This caveat is a red flag: the plan acknowledges it doesn't know if the constraint exists and tells the executor to "verify before running." Reviewing `supabase/migrations/032_compute_jobs_queue.sql`, the queue is designed to allow multiple pending jobs for the same (kind, payload) — it uses a serial primary key, not a unique constraint on (strategy_id, kind). Running `phase12_backfill_enqueue.py` twice will insert duplicate `compute_analytics` jobs for all 20 strategies, producing 40 backfill jobs and doubling compute load.

**Fix:** Add a pre-check in `phase12_backfill_enqueue.py`:
```python
existing = await db_execute(
    lambda: supabase.table("compute_jobs")
    .select("id", count="exact")
    .eq("kind", "compute_analytics")
    .eq("status", "pending")
    .execute()
)
if (existing.count or 0) > 0:
    print(f"phase12_backfill_enqueue: {existing.count} existing pending compute_analytics jobs found — skipping to avoid duplicates")
    return 0
```

---

### M-03: Plan 10 kill-switch size probe uses JSON string length, not `pg_column_size` — can undercount by 30-50%

**Plan:** 12-10, Task 1

**Issue:** `phase12_kill_switch.py` measures row size as `len(json.dumps(r["metrics_json"]).encode("utf-8"))`. This approximates the Python-side JSON string length, not the Postgres JSONB storage size. `pg_column_size()` measures the post-TOAST-compression on-disk size, which can differ significantly from the raw JSON string length (JSONB binary format is typically 10-30% larger than the JSON string; TOAST LZ4 compression then brings it back down). The SQL probe in `analyze_metrics_size.sql` (also Plan 10) uses the correct `pg_column_size(metrics_json)` for the actual Postgres measurement. The Python script's approximation is used for the threshold check.

In practice, since `analyze_metrics_size.sql` is run first and its output is the authoritative check (per the plan's ordering), the Python approximation in `phase12_kill_switch.py` is a secondary measurement. But the Python script is the one that actually triggers the cutover. If `analyze_metrics_size.sql` shows p99.9 = 820kB but the Python approximation shows 750kB (due to JSONB binary overhead being underestimated), the kill-switch will not fire even though the threshold is exceeded.

**Fix:** Use the DB-side probe output in the kill-switch decision rather than recomputing it in Python. Pass `p99.9` as a command-line argument from `phase12_deploy.py` (run `analyze_metrics_size.sql` via `supabase db remote query`, parse output, and pass to kill-switch), or have kill-switch re-run the SQL query via `supabase.rpc()` or a raw SQL execution path. This ensures the kill-switch uses the same measurement as the declared threshold check.

---

### M-04: Plan 07 acceptance criteria contains a false-positive grep

**Plan:** 12-07, Task 1

**Issue:** The verify step includes: `! grep -q '"claim_compute_jobs"' analytics-service/main_worker.py`. This will FAIL if the module has any comment or log message that mentions `"claim_compute_jobs"` (e.g., a docstring saying "Previously called claim_compute_jobs"). More critically, if any other function in `main_worker.py` (not `dispatch_tick`) still calls the old RPC for fallback purposes, this grep would incorrectly fail the verification.

**Fix:** Narrow the verify grep to check the absence of `supabase.rpc("claim_compute_jobs"` (with the opening paren) rather than the bare string `"claim_compute_jobs"`. Updated verify:
```bash
! grep -q 'supabase.rpc("claim_compute_jobs",' analytics-service/main_worker.py
```

---

## LOW findings (nice-to-have)

### L-01: Plan 08 Vitest mock path may not match actual `createClient` import

**Plan:** 12-08, Task 1

**Issue:** The test scaffolding uses `vi.mock("./supabase/server", ...)`. The actual import in `src/lib/queries.ts` (line 281) calls `createClient()` — but the import path for `createClient` is not visible from the 35-line window shown. If the actual import is `@/utils/supabase/server` or `../supabase/client`, the mock will silently not apply.

**Fix:** Add an acceptance criterion item: "vi.mock path matches actual createClient import (verified against src/lib/queries.ts top-of-file import)."

---

### L-02: D-11 "byte-identical scalars" goal conflicts with `_finalize_rolling`'s 4-decimal rounding

**Plans:** 12-03, 12-09

**Issue:** D-11 states scalar keys should be "byte-identical JSON after both sides round to 12 significant digits." However, `_finalize_rolling` (`metrics.py:368`) rounds series values to 4 decimal places. Rolling series values are therefore truncated to 4 decimals before reaching the parity assertion. This is internally consistent but contradicts D-11's stated 12-sig-digit precision.

**Fix:** Either accept this as intentional (4-decimal rounding is a documented precision limit) and update D-11 to say "1e-4 for series values output by `_finalize_rolling`", or change `_finalize_rolling` to round to 6+ decimals.

---

### L-03: `avg_holding_period_hours` derivation source ambiguous in Plan 05

**Plan:** 12-05, Task 2

**Issue:** Plan 05 Task 2's `_compute_trade_mix` reads `holding = float(f.get("holding_period_hours") or 0.0)`. This assumes `holding_period_hours` is a field on each fill dict. The fills query at `analytics_runner.py:224-230` only selects `side, cost`. The `trades`/`raw_fills` schema (migration 039:44-48) has no `holding_period_hours` column. All buckets will have `avg_holding_period_hours = 0.0`.

**Fix:** Either (a) compute `holding_period_hours` from `entry_time` and `exit_time` on each trade/position record, or (b) derive it from `reconstruct_positions()` per-trade data (where duration is already computed as `avg_duration_days × 24`). Document the derivation in `_compute_trade_mix`'s docstring per RESEARCH.md §9.10.

---

## Coverage matrix

| Dimension | Status | Notes |
|---|---|---|
| METRICS-01..17 (17 reqs) | ALL COVERED (with gaps) | METRICS-07 "Weighted R:R" present in req text but not in any plan; METRICS-05/06 integration gap (H-03) |
| D-01..D-16 (16 decisions) | ALL COVERED | D-06 5/min cap only enforced while higher-priority jobs are pending (by design per D-06 "unthrottled when queue idle") |
| Success criteria 1, 2, 3a, 3b, 3c, 4, 5 | ALL MAPPED | SC#1 → Plan 06; SC#2 → Plan 09; SC#3a → Plans 09+10; SC#3b → Phase 14a (deferred correctly); SC#3c → Plan 02/08; SC#4 → Plans 02/07/10; SC#5 → Plan 01 |
| Pitfalls #2/3/11/19/22 mitigated | YES with gaps | #2 (sibling table) ✓; #3 (throttle) partially (B-02); #11 (MAR constant) ✓; #19 (turnover docstring) ✓; #22 (Phase 14 concern, N/A) ✓ |
| Banned packages avoided | YES | No `axios`, `react-native-international-phone-number`, `react-native-country-select`, or `@openclaw-ai/openclawai` |
| Threat model coverage | OK with gaps | Missing: multi-worker race on `measure_p999()` → `cutover_strategy()` in kill-switch |
| Migration numbering correct | YES (in plans) / INCONSISTENT (in RESEARCH) | Plans 02/07 use 086/087 correctly; RESEARCH.md §6 skeleton still shows 084/085 strings (H-02) |
| Schema push BLOCKING placement | OK | Plan 02 Task 3 is `type: checkpoint:human-verify gate: blocking` |
| Parity test Reading A | YES | Plan 09 Task 3 explicitly implements Reading A (TS schema gate) |
| `compute_all_metrics()` → `MetricsResult` refactor | YES | Plan 06 Task 1 implements dataclass; Plan 06 Task 2 updates single caller |
| Research open questions resolved | 5/6 | Migration numbering ✓; parquet TS side ✓; Reading A ✓; avg_holding_period_hours — NOT resolved (L-03); throttle option (a) ✓; eager backfill — addressed but with duplicate-job risk (M-02) |

---

## Final recommendation

**BLOCK — PROCEED WITH FIXES.** Two blockers prevent clean execution: B-01 (derived trade metrics will be all-None due to data-flow error in `_compute_volume_metrics`) and B-02 (wave 3 parallel plans 03/04 both modify `metrics.py` without a declared dependency, creating a merge conflict). B-01 is a real production bug — METRICS-07 and METRICS-08 would ship silently broken with every value as `None`. B-02 is an execution-sequencing error that would halt implementation mid-wave. Both are straightforward to fix in the plan documents before execution begins. The four HIGH findings (H-01 through H-04) should also be resolved: H-01 (`equity_series_1y` contract contradiction) will cause silent empty payloads in Phase 14b; H-03 (exposure/turnover integration gap) means two of the 17 metrics are never end-to-end tested; H-04 (Weighted R:R missing) is a requirements-to-implementation discrepancy. The medium findings are operational risks rather than correctness bugs. The overall plan architecture is sound — the wave structure, migration design, parity test approach, and schema split are all well-designed. Once B-01 and B-02 are fixed, and H-01/H-03/H-04 are addressed, the plans are executable.

---

## REVIEW COMPLETE
