---
phase: 12
status: all_fixed
fix_scope: critical_warning
findings_in_scope: 4
fixed: 4
skipped: 0
iteration: 1
fixed_at: 2026-04-28
review_path: .planning/phases/12-backend-metric-contracts/12-REVIEW.md
---

# Phase 12 — Code Review Fix Report

**Fixed at:** 2026-04-28
**Source review:** `.planning/phases/12-backend-metric-contracts/12-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (Critical: 0, Warning: 4)
- Fixed: 4
- Skipped: 0

Info findings (IN-01..IN-06) were intentionally out of scope for this iteration per the orchestrator config (`fix_scope: critical_warning`).

## Fixed Issues

### WR-01: Pre-existing TS fixture drift in `MetricPanel.test.tsx` and `PositionsTab.test.tsx` — `TradeMetrics` shape mismatch

**Files modified:**
- `src/components/strategy/MetricPanel.test.tsx:118-136`
- `src/components/strategy/PositionsTab.test.tsx:31-49, 113-131`

**Commit:** `6d2a232`

**Applied fix:**
- `MetricPanel.test.tsx`: replaced `{ total_trades: 150, win_rate: 0.55 }` with the full Phase 12 `TradeMetrics` shape — renamed `total_trades` → `total_positions`, added `open_positions`, `closed_positions`, `avg_roi`, `avg_duration_days`, `long_count`, `short_count`, `best_trade_roi`, `worst_trade_roi`, set the 6 derived keys (`expectancy`, `risk_reward_ratio`, `weighted_risk_reward_ratio`, `sqn`, `profit_factor_long`, `profit_factor_short`) to `null`, and set the optional `trade_mix` to `undefined`.
- `PositionsTab.test.tsx`: applied the same derived-key + `trade_mix` additions to both `trade_metrics` blocks (line 31-42 default fixture, line 106-117 the empty-positions override). Position-level keys were already present in this file; only the new Phase 12 derived keys needed to be added.
- Verification: `npx vitest run` on both files → 10 tests pass; `npx tsc --noEmit` reports no errors in either file.

---

### WR-02: `pyarrow` is not pinned in `analytics-service/requirements.txt` — fixture loading will fail in clean CI

**Files modified:**
- `analytics-service/requirements.txt:7-10`

**Commit:** `76c1e33`

**Applied fix:**
- Pinned `pyarrow==18.1.0` directly under the `pandas==2.2.3` / `numpy==2.2.4` block, with an explanatory comment referencing the WR-02 finding and the conftest.py call site.
- Verification: PyPI confirms `pyarrow==18.1.0` ships cp312 wheels for `manylinux_2_17` and `manylinux_2_28`, so the existing `python:3.12-slim` Dockerfile target (the actual CI/Railway environment) will resolve cleanly. The local Python 3.14 venv has no compatible pyarrow wheel — that's a developer-environment concern outside WR-02's scope (the finding is explicitly about clean Railway/CI fragility, which is now fixed).

---

### WR-03: `_load_position_time_series` failure misclassified under `position_metrics_failed` flag

**Files modified:**
- `analytics-service/services/analytics_runner.py:533-575, 651-694`

**Commit:** `7695053`

**Applied fix:**
- Split the single try/except wrapping `reconstruct_positions` + `compute_exposure_metrics` + `_load_position_time_series` into two separate try/except blocks, each tracking its own error string (`position_reconstruction_error`, `position_snapshots_error`).
- Updated the `data_quality_flags` builder to emit distinct surface-specific keys: `position_reconstruction_failed` + `position_reconstruction_error` (FIFO from raw fills failed) and `position_snapshots_unavailable` + `position_snapshots_error` (snapshot grids unavailable for turnover/exposure_series).
- Preserved the legacy aggregate `position_metrics_failed` / `position_metrics_error` keys for backward compatibility with the admin compute-jobs page (`src/app/(dashboard)/admin/compute-jobs/page.tsx`), `PositionsTab` and `VolumeExposureTab` consumers, and the existing `test_graceful_degradation_position_failure` assertion. The legacy error string now concatenates surface-labeled segments (`"reconstruction: ..."` / `"snapshots: ..."`) so legacy readers still get unambiguous diagnostic context.
- Verification: `pytest tests/test_analytics_runner.py` → 18 passed (legacy assertion still satisfied because step-1 failures still set `position_metrics_failed=True`).

---

### WR-04: `phase12_kill_switch.cutover_strategy` writes `metrics_json` non-atomically with the sibling-table upsert

**Files modified:**
- `supabase/migrations/088_cutover_strategy_metrics_keys.sql` (created)
- `src/lib/database.types.ts` (regenerated via `supabase gen types --linked`)
- `analytics-service/scripts/phase12_kill_switch.py:117-172` (simplified)

**Commits:**
- `aaf6ac9` — initial smaller path: rollback-on-failure guard (superseded)
- `af52bf0` — **migration 088: cutover_strategy_metrics_keys atomic dual-write RPC**
- `7961cfa` — **simplify cutover_strategy to use the atomic RPC; drop Python rollback guard**

**Applied fix (long-term path, user-approved):**
- **Migration 088**: created `cutover_strategy_metrics_keys(p_strategy_id UUID, p_kinds JSONB)` SECURITY DEFINER RPC. The function body performs both the `strategy_analytics_series` `INSERT … ON CONFLICT DO UPDATE` AND the `strategy_analytics.metrics_json - text[]` strip inside a single Postgres function — one implicit transaction. Partial failure is impossible at the DB level.
- **H-B hardening**: `SET search_path = public, pg_temp` on the new RPC (NOT pg_catalog). Self-verifying DO block asserts `proconfig` contains the literal entry.
- **Distinction from M-Grok-1**: kept `upsert_strategy_analytics_series_batch` (087) unchanged — that's the analytics_runner write path which leaves `metrics_json` alone. The new 088 RPC is the kill-switch dual-write path.
- **Permissions**: `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role` (only the operational deploy script calls it).
- **Applied to remote**: `khslejtfbuezsmvmtsdn` via MCP supabase tools. Verified via `pg_proc` query that the RPC exists with correct `proconfig`.
- **Python script simplified**: `phase12_kill_switch.cutover_strategy` shrinks from ~95 lines to ~55 — single `supabase.rpc("cutover_strategy_metrics_keys", …)` call replaces the prior 2-call + try/except + best-effort-rollback pattern. Idempotent semantics preserved.
- **Types regenerated**: `src/lib/database.types.ts` re-generated via `supabase gen types typescript --linked` to pick up the new RPC's signature.
- Verification: `python3 -c "import ast; ast.parse(open('scripts/phase12_kill_switch.py').read())"` → clean. `npm run build` → exits 0 (Next.js compiles 73 pages, no type errors).

---

## Skipped Issues

None — all four warnings were fixed.

---

_Fixed: 2026-04-28_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
