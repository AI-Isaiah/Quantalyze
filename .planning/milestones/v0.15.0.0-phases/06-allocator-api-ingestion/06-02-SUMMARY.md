---
phase: 06-allocator-api-ingestion
plan: 02
subsystem: python-worker
tags: [python, fastapi, ccxt, worker, compute-jobs, pytest, allocator, ingestion]
requires: [06-01]
provides:
  - "services.allocator_positions.fetch_allocator_holdings(exchange_name, exchange) -> (rows, warning)"
  - "services.allocator_positions.persist_allocator_holdings(supabase, holdings, allocator_id, api_key_id, asof) -> int"
  - "services.allocator_positions.DeribitNotSupportedError (ccxt.NotSupported subclass — f3 Path B)"
  - "services.allocator_positions._map_exception_to_sync_status(exc) -> 'revoked'|'rate_limited'|'error'"
  - "services.job_worker._allocator_key_preflight(job, handler_name) -> DispatchResult | _ExchangeContext"
  - "services.job_worker._emit_audit(allocator_id, api_key_id, action, metadata) -> None  # f7"
  - "services.job_worker.run_poll_allocator_positions_job(job) -> DispatchResult"
  - "services.job_worker.dispatch — extended with 'poll_allocator_positions' elif branch"
  - "services.exchange.EXCHANGE_CLASSES — Deribit entry (derivative-side only per f3 Path B)"
affects:
  - "06-03 (POST /api/allocator/holdings/sync route can enqueue jobs that actually get processed)"
  - "06-04 (UI can trust sync_status ∈ {complete,complete_with_warnings,revoked,rate_limited,error} and render 'Queued — retry in {N}s' from next_attempt_at during f8 breaker-deferrals)"
tech-stack:
  added: []   # no new dependencies — ccxt + pytest + supabase-py already installed
  patterns:
    - "Sibling preflight for non-strategy jobs: _allocator_key_preflight mirrors _exchange_preflight but skips the strategy hop (loads api_keys by job['api_key_id']) and reuses _ExchangeContext with strategy_row=None."
    - "Dual-fetch per sync: fetch_balance() for spot + fetch_positions() for derivatives emitted in a single flat list, each row tagged holding_type='spot'|'derivative' (D-01)."
    - "Stablecoin mark_price shortcut: USDT/USDC/BUSD/DAI/TUSD/USD skip fetch_tickers() entirely with mark_price=1.0 (lower API cost; avoids rate-limit bleed onto strategy-side poll_positions for the same exchange)."
    - "raw_payload cap via json.dumps length check + {'truncated': True, 'preview': str[:3900]} fallback (D-02 — keeps JSONB rows indexable, runaway CCXT `info` blobs can't blow up row size)."
    - "Exception→sync_status mapping as a separable pure helper (_map_exception_to_sync_status) co-located with the worker concern it serves; importable by tests without the job_worker dependency chain."
    - "Partial-success complete_with_warnings path: fetch_allocator_holdings returns (rows, warning) — spot rows persist even when derivatives fail with a non-auth non-429 error; handler writes sync_status='complete_with_warnings'."
    - "f3 Path B — Explicit error-class deferral: DeribitNotSupportedError(ccxt.NotSupported) raised BEFORE fetch_balance() converts silent-empty into surfaced sync_status='error' with a human-readable reason. Tracked deferral rather than phantom-complete."
    - "f7 — Audit wrapper re-use via _emit_audit → services.audit.log_audit_event (NOT a local no-op). Import resolved at call time via `from services import audit as audit_module` so test monkeypatches apply."
    - "f8 — Rate-limit contagion documented inline in the _allocator_key_preflight comment. DispatchOutcome.DEFERRED is a valid terminal state for THIS invocation; per-exchange breaker splitting is explicitly deferred."
    - "Defensive UPDATE: db_execute failures during api_keys status stamps log-and-continue so an audit emission still happens; finally-block exchange.close() swallows errors to avoid masking the handler result."
key-files:
  created:
    - "analytics-service/services/allocator_positions.py (223 lines)"
    - "analytics-service/tests/test_allocator_positions.py (394 lines, 9 tests)"
  modified:
    - "analytics-service/services/exchange.py (EXCHANGE_CLASSES +deribit)"
    - "analytics-service/services/job_worker.py (+260 lines: TIMEOUT_PER_KIND entry, _allocator_key_preflight, _emit_audit, run_poll_allocator_positions_job, dispatch elif branch, f8 contagion comment)"
    - "analytics-service/tests/conftest.py (+api_key_row_factory fixture)"
decisions:
  - "f3 Path B (Deribit deferral) selected because no Deribit test key exists in the Keychain harness (`security find-generic-password -s quantalyze-test -a deribit` returns 'item not found'). Path A (per-currency branch) cannot be test-driven end-to-end without a live key. Path B converts silent-empty into surfaced sync_status='error' with a human-readable reason — safer default. Derivative side still syncs via services/positions.py."
  - "_map_exception_to_sync_status lives in allocator_positions.py (not job_worker.py) so the mapping logic is co-located with the worker's concern and can be unit-tested without importing the whole job_worker dependency chain."
  - "fetch_tickers() preferred over per-symbol fetch_ticker() — a single bulk request is lower cost on every supported exchange. Per-symbol fallback kicks in only if the bulk call raises (some venues reject symbol lists)."
  - "raw_payload capped at 4KB via json.dumps().length slice-and-reparse pattern (simpler than streaming truncation; good enough for the 95%th-percentile row)."
  - "complete_with_warnings IS in scope for v0.15 (RESEARCH Open Question 2). The partial-success path persists spot rows and surfaces the derivative-side error in sync_error rather than treating the whole sync as a failure."
  - "Rate-limit contagion (f8) accepted in Phase 06 — the per-exchange breaker is shared with strategy-side poll_positions. Splitting to per-(exchange, api_key_id) is tracked as a future phase. The UI (Plan 04) surfaces the deferral via next_attempt_at as 'Queued — retry in {N}s' so allocators see the expected state."
  - "Audit emission path verified (f7 pre-task): services/audit.py already exposes log_audit_event(user_id, action, entity_type, entity_id, metadata) with the exact shape, dispatches via supabase.rpc('log_audit_event_service', ...) fire-and-forget. No patch needed on audit.py."
  - "_emit_audit re-imports log_audit_event at call time (via `from services import audit as audit_module`) so pytest monkeypatches on services.audit.log_audit_event resolve correctly — this matters for test 8's f7 assertion."
  - "Defensive handler error path: api_keys UPDATE failures are log-and-continue (not re-raise) so the audit event still emits when the DB layer is flaky, keeping the admin UI trail intact."
requirements-completed: [INGEST-03, INGEST-04, INGEST-05]
metrics:
  tasks_completed: 3
  files_created: 2
  files_modified: 3
  test_count: 9        # test_allocator_positions.py
  test_pass_count: 9
  full_suite_pass: 495
  full_suite_skip: 3
  full_suite_fail: 0
  duration_seconds: 771
  completed_at: "2026-04-20T08:00:39Z"
---

# Phase 06 Plan 02: FastAPI worker + pytest for allocator holdings ingestion — Summary

One-liner: Landed the allocator-side CCXT worker (`fetch_allocator_holdings` dual-path + idempotent upsert on `(allocator_id, venue, symbol, asof)`), the `job_worker.py` extension (`_allocator_key_preflight` + `run_poll_allocator_positions_job` + dispatch elif), and the Deribit-in-EXCHANGE_CLASSES fix behind a nine-test pytest suite that proves INGEST-03 / INGEST-04 / INGEST-05 including f3 Path B (DeribitNotSupportedError deferral), f7 (audit emission via services.audit.log_audit_event), and f8 (rate-limit contagion documented inline).

## Objective Delivered

| Requirement | Coverage |
|-------------|----------|
| INGEST-03 (worker dispatches `poll_allocator_positions` and writes to `allocator_holdings`) | `run_poll_allocator_positions_job` + `fetch_allocator_holdings` + `persist_allocator_holdings`; dispatch elif wired. |
| INGEST-04 (same-day re-run produces identical rows) | `persist_allocator_holdings` uses `on_conflict="allocator_id,venue,symbol,asof"`. Covered by `test_idempotent_upsert`. |
| INGEST-05 (error UX: revoked/rate_limited/error surfaced with human-readable reason) | `_map_exception_to_sync_status` (five-class map) + handler UPDATE to `api_keys.sync_status` + `sync_error` = `classify_exception(exc)[:500]`. Covered by `test_error_status_mapping` and `test_run_poll_allocator_positions_job_auth_error_sets_revoked`. |

## Commits

| # | Task                                                                                                     | Commit    |
| - | -------------------------------------------------------------------------------------------------------- | --------- |
| 1 | test(06-02): add failing pytest suite for allocator_positions worker (RED — 9 cases)                     | `e66fbdb` |
| 2 | feat(06-02): allocator_positions.py + Deribit in EXCHANGE_CLASSES (GREEN for 7/9 tests)                   | `e1c057a` |
| 3 | feat(06-02): wire poll_allocator_positions handler + dispatch + f7/f8 (all 9 tests GREEN)                 | `545caa8` |

## Test Matrix (all green)

| Test                                                                                          | Proves                                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `test_fetch_allocator_holdings_returns_both_types`                                            | D-01 dual-path: spot + derivative rows in one list; USDT mark_price=1.0 without ticker call |
| `test_idempotent_upsert`                                                                      | INGEST-04: `on_conflict="allocator_id,venue,symbol,asof"`, rows stamped with allocator_id/api_key_id/asof |
| `test_error_status_mapping`                                                                   | INGEST-05/D-07 five-class map including DeribitNotSupportedError → 'error'                  |
| `test_stablecoin_mark_price_is_one`                                                           | RESEARCH §1 stablecoin skip: no fetch_tickers / fetch_ticker calls on {USDT, USDC, DAI}     |
| `test_partial_success_emits_warnings`                                                         | Partial-success complete_with_warnings: spot persists, derivative error surfaced in warning |
| `test_raw_payload_cap_4kb`                                                                    | D-02 ~4KB cap via json.dumps length check                                                   |
| `test_deribit_balance_per_currency_shape`                                                     | **f3 Path B** — DeribitNotSupportedError subclass of ccxt.NotSupported; fetch_balance not called; maps to 'error' |
| `test_run_poll_allocator_positions_job_emits_sync_completed_audit_on_done`                    | **f7** — `allocator.holdings.sync_completed` emitted via `services.audit.log_audit_event` with row_count + holding_type_counts |
| `test_run_poll_allocator_positions_job_auth_error_sets_revoked`                               | AuthenticationError → `sync_status='revoked'` + sanitized `sync_error` + `allocator.holdings.sync_failed` audit with error_kind='permanent' |

Also: Full analytics-service pytest suite 495 passed, 3 skipped, 0 failures (22.68s).

## Key Files

- `analytics-service/services/allocator_positions.py` (NEW, 223 lines) — the pure allocator worker module.
- `analytics-service/services/exchange.py` — `EXCHANGE_CLASSES` now includes `"deribit": ccxt.deribit` (Landmine 1 closed).
- `analytics-service/services/job_worker.py` — extended with `TIMEOUT_PER_KIND['poll_allocator_positions']`, `_allocator_key_preflight` (with f8 contagion comment), `_emit_audit` (f7 wiring), `run_poll_allocator_positions_job`, and the `dispatch()` elif branch.
- `analytics-service/tests/test_allocator_positions.py` (NEW, 394 lines, 9 tests).
- `analytics-service/tests/conftest.py` — added `api_key_row_factory` fixture.

## Public API Exports

From `services.allocator_positions`:

```python
# classes
DeribitNotSupportedError(ccxt.NotSupported)

# pure helpers
_map_exception_to_sync_status(exc: Exception) -> str    # 'revoked' | 'rate_limited' | 'error'

# async entry points
await fetch_allocator_holdings(exchange_name, exchange) -> tuple[list[dict], str | None]
await persist_allocator_holdings(supabase, holdings, allocator_id, api_key_id, asof) -> int
```

From `services.job_worker` (unchanged public shape; extensions are additive):

```python
# new
await _allocator_key_preflight(job, handler_name) -> DispatchResult | _ExchangeContext
_emit_audit(allocator_id, api_key_id, action, metadata) -> None
await run_poll_allocator_positions_job(job) -> DispatchResult

# dispatch now accepts kind='poll_allocator_positions'
```

## Decisions Recorded (quick reference)

1. **f3 Path B over Path A** (Deribit): deferral via explicit `DeribitNotSupportedError` rather than per-currency branch, because no Deribit test key exists in the Keychain harness. When a test key lands, a Phase 06.x minor can flip the `_fetch_spot_rows` guard to a real per-currency parser.
2. **`_map_exception_to_sync_status` in allocator_positions.py, not job_worker.py**: co-locates the mapping with the worker concern; testable without importing the whole job_worker dependency chain.
3. **Single bulk `fetch_tickers()` + stablecoin skip**: one API call per sync for the whole non-stablecoin set; USDT/USDC/BUSD/DAI/TUSD/USD get `mark_price=1.0` without a lookup — lower cost, no rate-limit bleed onto strategy-side `poll_positions`.
4. **`complete_with_warnings` IS in scope for v0.15** (RESEARCH Q2): partial success persists spot rows + surfaces the derivative error in `sync_error`, beats marking the whole sync as failed.
5. **raw_payload cap at 4KB via slice-and-reparse**: `{'truncated': True, 'preview': encoded[:3900]}` on overflow — simple, indexable, bounded.
6. **f7 audit dispatch re-imported at call time** via `from services import audit as audit_module` inside `_emit_audit` so pytest `monkeypatch.setattr(audit_module, "log_audit_event", …)` resolves through the bound name.
7. **f8 rate-limit contagion accepted**: per-exchange breaker is shared with strategy-side; the inline comment documents this explicitly and points to the `next_attempt_at` UI affordance. Per-(exchange, api_key_id) splitting is a future phase.
8. **Defensive handler error path**: api_keys UPDATE failures are log-and-continue so an audit event still emits. Audit drops are already fire-and-forget; this keeps the admin UI trail intact when the DB layer is flaky.

## Deviations from Plan

None — plan executed exactly as written. f3/f7/f8 callouts were implemented per VOICES-ACCEPTED.md; the plan's acceptance-criteria grep counts all pass.

## Auth Gates

None encountered. All tests mock the CCXT exchange and Supabase client; no network or DB calls during the pytest run.

## Known Stubs

None. Every file is fully wired:

- `allocator_positions.py`: all functions return real values; no placeholder `return None` or mock fixtures.
- `job_worker.py`: handler persists real rows and emits real audit events (via the fire-and-forget wrapper).
- Test suite: no `pytest.skip` or `TODO`s; all nine cases assert concrete behavior.

The Deribit spot path IS an intentional deferred stub (raises `DeribitNotSupportedError`) — documented in the module docstring, tracked in PROJECT.md "Active — Inherited deferrals" (Plan 01 responsibility), and the derivative side continues to work for Deribit users. This is correctness-surfaced-as-error, not a silent stub.

## Threat Flags

None — no new security-relevant surface introduced beyond what the plan's `<threat_model>` already registered. All seven STRIDE threats (T-06-02-01 through T-06-02-07) have their mitigations in place:

- **T-06-02-01** (sync_error IDs): `classify_exception(exc)[:500]` everywhere before writing.
- **T-06-02-02** (api_key_id spoofing): `_allocator_key_preflight` loads by id; route owns ownership check.
- **T-06-02-03** (credentials): reused `decrypt_credentials` + `get_kek` — no new crypto surface.
- **T-06-02-04** (DoS/rate limits): `_check_circuit_breaker` + `_stamp_429` reused; f8 contagion documented.
- **T-06-02-05** (repudiation): every DONE/FAILED emits `allocator.holdings.sync_*` via verified `services.audit.log_audit_event` path.
- **T-06-02-06** (raw_payload leakage): 4KB cap via `_cap_raw_payload`.
- **T-06-02-07** (Deribit silent-empty): Path B explicit error + message.

## TDD Gate Compliance

Plan was `type: execute` with `tdd="true"` on each task. Gate sequence verified in git log:

- `e66fbdb` — `test(06-02):` RED gate (failing 9 tests committed first).
- `e1c057a` — `feat(06-02):` partial GREEN (7/9 — infrastructure tests pass; handler tests stay red).
- `545caa8` — `feat(06-02):` full GREEN (9/9).

No REFACTOR commit needed — the code landed in its final shape.

## Cross-Plan Dependencies Unlocked

- **Plan 03** (route): the `POST /api/allocator/holdings/sync` route can now enqueue `kind='poll_allocator_positions'` jobs with confidence that the worker picks them up and processes them end-to-end.
- **Plan 04** (UI): sync status values are guaranteed to be one of `{complete, complete_with_warnings, revoked, rate_limited, error}` with sanitized `sync_error`. UI can render `Queued — retry in {N}s` from `next_attempt_at` for the f8 contagion path.

## Self-Check: PASSED

Files created:
- FOUND: `analytics-service/services/allocator_positions.py`
- FOUND: `analytics-service/tests/test_allocator_positions.py`

Files modified:
- FOUND: `analytics-service/services/exchange.py` (grep `'deribit'` → 1 hit in EXCHANGE_CLASSES)
- FOUND: `analytics-service/services/job_worker.py` (grep `'poll_allocator_positions'` → 10 hits)
- FOUND: `analytics-service/tests/conftest.py` (grep `'api_key_row_factory'` → 2 hits)

Commits on branch `worktree-agent-a2ac81a7`:
- FOUND: `e66fbdb` — RED tests
- FOUND: `e1c057a` — allocator_positions.py + Deribit
- FOUND: `545caa8` — job_worker.py wiring

Grep-count acceptance criteria (all ≥ required thresholds):
- `class DeribitNotSupportedError` → 1 ✓
- `run_poll_allocator_positions_job` in job_worker.py → 3 (≥2) ✓
- `Rate-limit contagion` in job_worker.py → 1 (≥1) ✓
- `allocator.holdings.sync_*` in job_worker.py → 5 (≥2) ✓
- `log_audit_event\|_emit_audit` in job_worker.py → 10 (≥2) ✓
- `_allocator_key_preflight` in job_worker.py → 3 (≥2) ✓

Pytest:
- PASSED: `tests/test_allocator_positions.py` 9/9
- PASSED: full analytics-service suite 495/498 (3 pre-existing skips, 0 failures)

Plan executed cleanly per the acceptance contract.
