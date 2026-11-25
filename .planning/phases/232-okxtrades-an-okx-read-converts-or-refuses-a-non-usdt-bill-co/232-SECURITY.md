---
phase: 232
slug: okxtrades
threats_total: 17
threats_closed: 17
threats_open: 0
status: SECURED
asvs_level: 2
block_on: high
audited_at_sha: 549f192d8a2c8977bda69c259fa5b3549320921b
---

# Phase 232 OKXTRADES: Security Verification

Audit by gsd-security-auditor over `git diff 5217975b6...HEAD -- analytics-service docs`, read at HEAD, tests not run. Persisted by the phase agent. Paths are under `analytics-service/`.

| Threat | Mitigation | Evidence | Status |
|---|---|---|---|
| T-232-01 (high) | The fills-cursor stamp is the newest persisted fill, never the clock. It is gated on: fills exist and `phase2_complete`; no phase-1 or phase-2 failure; no `sync_truncated_*` or `binance_partial_symbols` flag; every timestamp parses. The seed is `min(cursor, stored-fill high-water)`. The RPC only moves forward. | `services/job_worker.py:run_sync_trades_job`; `services/trade_resume.py:load_strategy_fill_high_water`; RPC `advance_sync_cursor`; `tests/test_okxtrades_cursor.py` | CLOSED |
| T-232-02 (medium) | On a refused or incomplete read with a NULL cursor, the cursor is anchored at the read start. Otherwise it is held. | `run_sync_trades_job` (anchor branch); `tests/test_okxtrades_cursor.py` | CLOSED |
| T-232-03 (low) | The unparsable-timestamp WARNING names the strategy id and the exception class only. | `test_an_unparsable_fill_timestamp_holds_the_cursor` | CLOSED |
| T-232-04 (high) | Each window carries bounds. An out-of-window row or a `billId` order drift raises `OkxBillsWindowIncomplete`, and the class name reaches `daily_pnl_fetch_error_class`. | `services/exchange.py:_okx_bills_window_read`; `tests/test_okxtrades_walk.py` | CLOSED |
| T-232-05 (high) | The walk is UTC-day aligned and oldest first. Only windows that complete are kept, so every stop leaves a contiguous oldest prefix. | `exchange.py:fetch_daily_pnl`; `tests/test_okxtrades_walk.py` | CLOSED |
| T-232-06 (medium) | Refusal texts are static and contain no digits or venue text. Logs are scrubbed and print dates only. | `OkxBillsWindowIncomplete._TEXTS`; `test_the_refusal_text_carries_no_digits` | CLOSED |
| T-232-07 (low) | ACCEPT: the request floor is recorded. | `232-02-SUMMARY.md` | CLOSED (accepted) |
| T-232-08 (high) | A nonzero bill in a currency that is not stable refuses with `daily_pnl_non_usd_okx` and `[]`, and is never summed. | `exchange.py:fetch_daily_pnl` (`_okx_non_usd_census`); `tests/test_okxtrades_ccy.py` | CLOSED |
| T-232-09 (medium) | The flag value is boolean. Census keys are regex-validated and reach one count-only WARNING. | `_OKX_CCY_CODE_RE`; `test_the_flag_carries_no_venue_text` | CLOSED |
| T-232-10 (high) | The token is named by `daily_pnl_read_verdict`, the cron `_fetch_degradation` and the derive `READ_INCOMPLETE_TOKENS`. | `tests/test_daily_pnl_read_verdict.py`; `tests/test_derive_broker_dailies_dualmode.py` | CLOSED (declared scope; see Warnings) |
| T-232-11 (high) | A prefix-only fetch holds the key `last_sync_at`, the strategy markers and the recompute enqueue, and sets status `held` with `fetch_partial_prefix`. Degradation wins over the prefix. | `routers/cron.py:_sync_single_key`; `tests/test_cron_router.py` | CLOSED |
| T-232-12 (low) | ACCEPT: a prefix that never advances is loud on every tick. | `232-04-SUMMARY.md` | CLOSED (accepted) |
| T-232-13 (low) | The prefix WARNING carries the key id, a count and the flag name only. | `routers/cron.py` | CLOSED |
| T-232-SC x4 (low) | ACCEPT: no dependency was added. | `git diff --name-only` | CLOSED (accepted) |

## Log and error-string leak check

The phase's new log lines carry ids, dates, counts, validated currency codes, flag names and exception class names only. They contain no keys, secrets, account numbers or raw venue payloads.

## Warnings (non-blocking)

- `services/okx_archive_job.py:_check_live_realized_flags` (Phase 223's file) does not name `daily_pnl_non_usd_okx` (REVIEW CR-03 / SFH-03). The hand-off goes to 223 by ruling Q4. Exposure is latent: the 2026-10-26 archive census found every bill in USDT.
- `load_strategy_fill_high_water` builds its error string from the raw exception, as its sibling does. The string is never persisted.
