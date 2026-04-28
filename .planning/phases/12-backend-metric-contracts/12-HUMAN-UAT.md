---
status: partial
phase: 12-backend-metric-contracts
source: [12-VERIFICATION.md]
started: 2026-04-28
updated: 2026-04-28
---

## Current Test

[awaiting human testing — production deploy run + queue-depth observation]

## Tests

### 1. Python parity test live run
expected: `cd analytics-service && python3 -m pytest tests/test_metrics_parity.py` exits 0 with 5/5 passing
result: PASSED (orchestrator's regression sweep on 2026-04-28 ran the full analytics-service suite — 592/592 pass, 5 skipped, 0 failed; this includes test_metrics_parity.py)
notes: Locally satisfied. Re-confirm in CI/Railway env after pyarrow==18.1.0 pin lands (commit 76c1e33).

### 2. TS parity test live run
expected: `npx vitest run src/__tests__/metrics-parity.test.ts` exits 0 with 5/5 passing
result: PASSED (orchestrator's regression sweep on 2026-04-28 ran `npx vitest run` — 2285/2285 pass, 148 skipped, 0 failed; this includes metrics-parity.test.ts)
notes: Locally satisfied. The 12 EXPECTED_SIBLING_KINDS dynamic threshold matches Python's len-12 sibling-kind set.

### 3. Production deploy + SC#4 queue-depth observation
expected: Operator runs `cd analytics-service && python -m scripts.phase12_deploy` against the live Supabase project (DATABASE_URL or SUPABASE_DB_URL pointing at khslejtfbuezsmvmtsdn). Then for 12 minutes observe `compute_analytics` queue depth — must NEVER exceed 50 pending jobs to satisfy ROADMAP SC#4 (live sync_trades does not queue behind backfill). Record the max-pending value in `.planning/phases/12-backend-metric-contracts/TODOS.md` under the `## Phase 12 SC#4 — queue-depth probe` section.
result: pending
notes: Plan 12-10 is autonomous=false by design — this is the human-gated operational step. Migrations 086 + 087 + 088 are already applied; the deploy script (a) re-runs the SQL probe to gate the kill-switch, (b) enqueues backfill jobs at priority='low' with the M-02 duplicate guard, (c) propagates TRADE_MIX_HAS_MAKER_TAKER=false from TODOS.md to .env.test for CI parity tests. Does NOT block Phase 14a (Phase 14a only consumes SQL-level contracts already shipped).

## Summary

total: 3
passed: 2
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

None — all 17 METRICS requirements either verified (16) or explicitly deferred to Phase 14a per ROADMAP SC#3b annotation (METRICS-15 path-extraction half).
