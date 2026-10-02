---
phase: 70-trades-ingestion-dailies-risky
plan: 04
subsystem: analytics
tags: [deribit, trades, id-cursor, fills, fillrow, advisory-crosscheck, rate-limit, python, tdd]

# Dependency graph
requires:
  - phase: 70-01
    provides: LOCKED Deribit ingestion design (id-cursor get_user_trades_by_currency; historical=true; continue-while-full; time endpoint one-page-stalls; fill-count non-reconciling per Wave-0 BLOCKING_FINDING)
  - phase: 70-03
    provides: services/deribit_ingest.py per-scope auth (enumerate_scopes, resolve_scope_auth/mint_subaccount_token via exchange_token), enumerate_currencies, _deribit_error_code, scrub_freeform_string wiring, re-anchored D-02 ledger-completeness gate
provides:
  - "services/deribit_ingest.py trades axis — _build_trades_params (always historical=true + sorting=asc), paginate_trades_id_cursor (advance start_id exclusive, continue while has_more OR page-full, boundary trade_id dedup, 10028 backoff), _trade_to_fillrow (exchange_fill_id=trade_id via _make_fill_dict), fetch_deribit_fills (scope×currency, reuses 70-03 scope auth, -32602 per-currency skip), KNOWN_TRADE_TOTALS + reconcile_fill_count (advisory, never raises)"
  - "services/exchange.py fetch_raw_trades deribit dispatch branch + _fetch_raw_trades_deribit delegate"
  - "Revert-proof CI fixtures: id-cursor start_id advance, continue-while-full (has_more=false+full still fetches), boundary dedup, historical=true params, FillRow exchange_fill_id mapping, -32602 skip, scope-auth reuse, dispatch routing, advisory-never-raises, known-totals non-reconciling"
affects: [70-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "id-cursor pagination: advance start_id=last trade_id (exclusive) + continue-while-full OR has_more — never trust has_more alone (Wave-0 bug #2 one-page-stall guard)"
    - "seen-set boundary dedup: start_id is exclusive but the API may re-serve the boundary trade; a trade_id seen-guard keeps re-fetch idempotent"
    - "SECONDARY axis maps to the shared FillRow via the canonical _make_fill_dict factory (no hand-rolled fill dict); exchange_fill_id=trade_id is the diff_strategy_fills PK dedup axis"
    - "ADVISORY cross-check that RETURNS a report and NEVER raises — structurally distinct from the fail-loud ledger-completeness honesty gate (70-03)"

key-files:
  created: []
  modified:
    - analytics-service/services/deribit_ingest.py
    - analytics-service/services/exchange.py
    - analytics-service/tests/test_deribit_ingest.py

key-decisions:
  - "Trade fetch uses the id-cursor private/get_user_trades_by_currency with historical=true + sorting=asc, advancing start_id=last trade_id and continuing while has_more OR the page is FULL (len==count). has_more has no documented reliability guarantee (Wave-0), so a full-but-has_more=false page STILL fetches the next page — otherwise rows silently drop. Explicitly NOT the _and_time endpoint (both bounds one-page-stall, Wave-0 bug #2)."
  - "start_id is EXCLUSIVE but the API may re-include the boundary trade, so paginate_trades_id_cursor carries a seen-set of trade_ids and drops re-served boundary rows — overlap re-fetch is idempotent."
  - "Each trade maps to the existing FillRow via _make_fill_dict (never hand-built) with exchange_fill_id=trade_id, exchange='deribit', side from direction, symbol=instrument_name, monetary fields as exact Decimal strings (H-0669). diff_strategy_fills dedups on (exchange, exchange_fill_id)."
  - "fetch_deribit_fills reuses the 70-03 per-scope auth (resolve_scope_auth) so subaccount fills are reachable despite subaccount_id being refused on read-only keys; a -32602 (non-margin currency for the wallet type) skips THAT currency (scrubbed-logged) while others still fetch; any other error propagates."
  - "reconcile_fill_count is ADVISORY ONLY — it RETURNS a diff report and NEVER raises; there is no DeribitCountGateError by design. KNOWN_TRADE_TOTALS (18,778/21,014/61,248) is documented non-reconciling-to-API (Wave-0 BLOCKING_FINDING). The returns-completeness honesty gate stays assert_ledger_complete (70-03), never this fill count. fetch_raw_trades invokes no count gate."
  - "since_ms is accepted on fetch_deribit_fills for signature parity with the other _fetch_raw_trades_* producers; the id-cursor crawl is full-history (historical=true) and dedups downstream on exchange_fill_id rather than filtering by time."

patterns-established:
  - "Pattern: continue-while-full paginator is revert-proof — a stub page that is FULL with has_more=false must still fetch the next page or a row is dropped (test goes red)"
  - "Pattern: advisory cross-check proven non-gating by a structural test (no exception type + report on huge shortfall) so it can never be mistaken for the honesty gate"

requirements-completed: [DRB-04]

# Metrics
metrics:
  duration: ~35m
  completed: 2026-07-05
  tasks: 2
  files_changed: 3
  commits: 4
---

# Phase 70 Plan 04: Deribit SECONDARY Trades Axis (id-cursor fills + advisory cross-check) Summary

id-cursor `private/get_user_trades_by_currency` fill fetch (historical=true, advance start_id, continue-while-full) mapped to the shared `FillRow` with `exchange_fill_id=trade_id`, wired into `fetch_raw_trades` via a `deribit` dispatch branch, plus an ADVISORY `reconcile_fill_count` that never raises — the returns honesty gate stays the 70-03 ledger-completeness gate.

## What was built

**Task 1 — id-cursor fill fetch + FillRow mapping** (`services/deribit_ingest.py`):
- `_build_trades_params(currency, count, *, start_id, historical=True, sorting="asc")` — pure; always sends `historical=true` (Wave-0 bug #1: without it the endpoint caps at 24h) + `sorting=asc`; `start_id` only when advancing.
- `paginate_trades_id_cursor(...)` — raw `private_get_get_user_trades_by_currency`; advances `start_id`=last trade_id (exclusive), continues while `has_more` OR the page is FULL (`len==count`), stops only when a page is BOTH not-full AND `has_more=false`; `seen`-set drops any re-served boundary trade_id; 10028 exponential backoff; other errors propagate.
- `_trade_to_fillrow(trade)` — maps a raw Deribit trade → `FillRow` via `_make_fill_dict` (exchange_fill_id=trade_id, side from `direction`, exact-string money fields).
- `fetch_deribit_fills(exchange, since_ms)` — enumerate_scopes → resolve_scope_auth (70-03) → enumerate_currencies → loop scope × currency; `-32602` skips that currency (scrubbed-log), other errors propagate.

**Task 2 — dispatch + advisory cross-check** (`services/exchange.py` + `services/deribit_ingest.py`):
- `exchange.py`: `elif exchange.id == "deribit"` branch → thin `_fetch_raw_trades_deribit` delegating to `deribit_ingest.fetch_deribit_fills` (import at call time so ingestion primitives stay monkeypatchable).
- `deribit_ingest.py`: `KNOWN_TRADE_TOTALS` (18,778/21,014/61,248, documented non-reconciling) + `reconcile_fill_count(fetched, known)` returning an advisory report; never raises, no `DeribitCountGateError`.

## Verification

`cd analytics-service && python -m pytest tests/test_deribit_ingest.py -k "<11 new tests>"` → 11 passed. Tests are RED-first + revert-proof:
- `test_id_cursor_continue_while_full_even_if_has_more_false` drops a row (goes red) if the loop stops on `has_more=false` while the page is full.
- `test_id_cursor_dedups_boundary_trade_id` proves the exclusive-boundary seen-guard.
- `test_reconcile_fill_count_is_advisory_not_raising` + `test_known_totals_documented_non_reconciling` structurally prove the count is not a gate.

Local full-suite runs segfault on Python 3.14 (`services.transforms` pulls pandas/scipy — documented AGENTS.md limitation); targeted `-k` runs are clean and CI Python 3.12 is the authority.

## Deviations from Plan

**1. [Test-design fix] Boundary-dedup fixture made non-full.** The initial `test_id_cursor_dedups_boundary_trade_id` scripted a 2nd page that was itself FULL (`len==count`), which correctly triggered a 3rd fetch and exhausted the stub (IndexError). Corrected the fixture to a full page-1 (count=3) + a short page-2 so the paginator stops after the boundary dedup. This is a test-fixture correction (the continue-while-full behavior under test is exactly right), folded into the Task 1 GREEN commit.

No other deviations. No architectural changes, no new packages (ccxt pinned), no auth gates.

## Known Stubs

None — no placeholder/empty-return stubs. `KNOWN_TRADE_TOTALS` holds real observed figures and is intentionally advisory (documented, per Wave-0 BLOCKING_FINDING); it is not a stub.

## Notes for downstream (70-06)

`fetch_deribit_fills(exchange: Any, since_ms: int | None = None, *, sleep=asyncio.sleep) -> list[dict]` is the import surface for 70-06's adapter. `reconcile_fill_count(fetched_total, known_total) -> dict` is ADVISORY ONLY and must never be wired as a gate — the returns-completeness honesty gate is `assert_ledger_complete` (70-03).

## Self-Check: PASSED

All modified files present; all 4 commits (b271ced2 test, 15896d14 feat, d28ed21d test, 689c2c71 feat) exist in history.
