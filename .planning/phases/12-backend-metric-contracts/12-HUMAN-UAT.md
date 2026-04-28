---
status: partial
phase: 12-backend-metric-contracts
source: [12-VERIFICATION.md]
started: 2026-04-28
updated: 2026-04-28
---

## Current Test

[awaiting operator-driven production deploy + 12-min queue-depth observation; items 1, 2, 3-dry-walk all PASSED]

## Tests

### 1. Python parity test live run
expected: `cd analytics-service && python3 -m pytest tests/test_metrics_parity.py` exits 0 with 5/5 passing
result: **PASSED** (live, 2026-04-28)
evidence:
```
tests/test_metrics_parity.py::test_series_close_handles_signed_zeros PASSED [ 20%]
tests/test_metrics_parity.py::test_series_close_handles_nan_pair PASSED  [ 40%]
tests/test_metrics_parity.py::test_series_close_one_nan_one_finite PASSED [ 60%]
tests/test_metrics_parity.py::test_scalar_close_two_tier_fallback PASSED [ 80%]
tests/test_metrics_parity.py::test_metrics_parity_full PASSED            [100%]
============================== 5 passed in 1.83s ===============================
```
notes: Cross-runtime parity gate (`test_metrics_parity_full`) byte-checks the Python `MetricsResult.metrics_json` + 12 `sibling_kinds` against `golden_252d_expected.json`. Includes H-C signed-zero/NaN parity helpers and M-Grok-2 two-tier scalar fallback. Re-confirm in CI/Railway env after pyarrow==18.1.0 pin lands (commit 76c1e33).

### 2. TS parity test live run
expected: `npx vitest run src/__tests__/metrics-parity.test.ts` exits 0 with 5/5 passing
result: **PASSED** (live, 2026-04-28)
evidence:
```
 RUN  v4.1.2 /Users/helios-mammut/claude-projects/quantalyze
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  16:44:45
   Duration  766ms
```
notes: Reading A schema gate (D-01: Python is the math source; TS asserts JSON shape). 12 EXPECTED_SIBLING_KINDS dynamic threshold matches Python's len-12 sibling-kind set per Issue 6 fix.

### 3. Production deploy + SC#4 queue-depth observation
expected: Operator runs `cd analytics-service && python -m scripts.phase12_deploy` against the live Supabase project (DATABASE_URL or SUPABASE_DB_URL pointing at khslejtfbuezsmvmtsdn). Then for 12 minutes observe `compute_analytics` queue depth — must NEVER exceed 50 pending jobs to satisfy ROADMAP SC#4 (live sync_trades does not queue behind backfill). Record the max-pending value in `.planning/phases/12-backend-metric-contracts/TODOS.md` under the `## Phase 12 SC#4 — queue-depth probe` section.

#### 3a. Dry-walk (script integrity)
result: **PASSED** (live, 2026-04-28 — 7/7 checks)
evidence:
```
✓ phase12_deploy.py imports clean
✓ phase12_kill_switch.py imports clean
✓ phase12_backfill_enqueue.py imports clean
✓ M-01 regex on TODOS.md → TRADE_MIX_HAS_MAKER_TAKER = 'false'
✓ HEAVY_KINDS count = 12
✓ H-D respected: equity_series_1y NOT in HEAVY_KINDS
✓ THRESHOLD_BYTES = 800000 (SC#3a 800kB)
phase12_kill_switch: SKIP_KILL_SWITCH=1 — bypassing.
✓ SKIP_KILL_SWITCH=1 → main() returns 0 (expected 0)
✓ WR-04 long-term: cutover_strategy uses migration 088 atomic RPC
```
The dry-walk imports all 3 deploy modules, exercises the M-01 regex against the actual TODOS.md, asserts the HEAVY_KINDS contract (12 kinds, no equity_series_1y per H-D), confirms the SC#3a 800kB threshold, exercises the SKIP_KILL_SWITCH=1 escape hatch, and verifies the WR-04 long-term fix is wired (cutover_strategy calls cutover_strategy_metrics_keys, NOT the legacy non-atomic upsert+update pair).

#### 3b. Live production deploy
result: **pending — operator action required**
notes: Plan 12-10 is `autonomous: false` by design. The /qa orchestrator cannot run `python -m scripts.phase12_deploy` against the live DB without operator authorization. Migrations 086 + 087 + 088 are already applied to remote `khslejtfbuezsmvmtsdn`; the deploy script's remaining work is:
  (a) Re-run `analyze_metrics_size.sql` via psql to gate the kill-switch (no-op if p99.9 < 800kB; if ≥ 800kB, runs the atomic cutover via migration 088's RPC)
  (b) Enqueue backfill jobs at priority='low' with the M-02 duplicate guard (skipped if pending compute_analytics jobs already exist)
  (c) Propagate TRADE_MIX_HAS_MAKER_TAKER=false from TODOS.md to .env.test (gitignored)
  (d) Operator records 12-min queue-depth observation window in TODOS.md `## Phase 12 SC#4 — queue-depth probe` section

Does NOT block Phase 14a — Phase 14a consumes SQL-level contracts already shipped (migrations 086/087/088 + the frozen TS contract in src/lib/types.ts).

## Summary

total: 3
passed: 2 (parity tests) + 1 dry-walk (script integrity)
issues: 0
pending: 1 (live production deploy + queue-depth window — operator-driven)
skipped: 0
blocked: 0

## Gaps

None — all 17 METRICS requirements either verified (16) or explicitly deferred to Phase 14a per ROADMAP SC#3b annotation (METRICS-15 path-extraction half).
