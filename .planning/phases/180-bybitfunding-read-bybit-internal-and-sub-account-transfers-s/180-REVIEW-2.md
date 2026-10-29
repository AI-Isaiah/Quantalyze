---
phase: 180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s
reviewed: 2026-10-28T23:16:39Z
reviewed_at_sha: fee98b345
diff_range: eb8d860bd..HEAD (excluding .planning)
round: 2
depth: deep
files_reviewed: 10
files_reviewed_list:
  - analytics-service/services/ccxt_flow_fetch.py
  - analytics-service/services/bybit_unified_flows.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/scripts/bybit_funding_record.py
  - analytics-service/tests/test_ccxt_flow_fetch.py
  - analytics-service/tests/test_allocator_history_probe.py
  - analytics-service/tests/test_bybit_funding_record.py
  - analytics-service/tests/test_bybit_unified_flows.py
  - analytics-service/tests/test_reconstruct_force_rebuild.py
findings:
  critical: 1
  warning: 0
  info: 5
  total: 6
status: issues_found
---

# Phase 180: Code Review Report, round 2

**Reviewed:** 2026-10-28T23:16:39Z
**Depth:** deep. The fix diff was traced across modules: `_read_bybit_transfer_window` and its callers in `job_worker` and `equity_reconstruction`, and the probe recorder through `_probe_member`, `_probe_account` and the gate, cause and explanation functions. The ccxt 4.5.88 source was read from the local uv cache: `bybit.fetch_deposits`, `fetch_withdrawals`, `add_pagination_cursor_to_result` and `parse_transaction`, plus base `parse_transactions`, `fetch2` / `throttle` and `fetch_paginated_call_cursor`.
**Files Reviewed:** 10
**Status:** issues_found

## Summary

### Round-1 MEDIUM+ verification

| Finding | Verdict | Evidence |
|---|---|---|
| REVIEW WR-02 = SFH H-1 (cursor taken from a parsed row) | **Fixed.** The fix introduced CR-01 below. | The cursor is now read from `result.nextPageCursor` of the call's own raw answer (`ccxt_flow_fetch.py:40-50, 124`). `last_json_response` is no longer used. |
| REVIEW WR-03 = SFH M-1 (silent ceiling, cycles undetected) | **Fixed** | `seen_cursors` raises on a repeat or a cycle (`:136-141`). The 1000-page exit raises `TransferPageStalled` (`:144-147`). Both are tested. |
| REVIEW WR-01 = SFH M-5 (+ IN-04) (probe says `read` for a refused read) | **Fixed** | Rows the reader would refuse now count nowhere. Dedup is on `(kind, id)`. Non-string and repeated cursors count as malformed. A cancel reads `Timeout` and is re-raised. A flow-source refusal turns a `read` member state into `malformed`. I ran the parity test and the end-to-end tests. One residual case is booked as IN-01. |
| SFH M-2 (full Unified page with an empty cursor) | **Validly dispositioned** | Caller instruction: Bybit's cursor is authoritative. This is consistent with plan 04 and with `funding_fetch` in production. |
| SFH M-3 (venue text in the log) | **Fixed** | Only the class is logged. A `caplog` test checks that `fake-venue-text` is absent. |
| SFH M-4 (forced refusal leaves no trace) | **Fixed** | `equity_reconstruction.py:4189-4193` logs the class before raising `from None`. The granularity is coarse (IN-02). |
| SFH M-6 (explanation built from the first member only) | **Fixed** | It takes every Bybit member's evidence, `len(evidences) == bybit_members`, and a trade count over Bybit members only. Tested end to end with two members and with OKX + Bybit. |
| SFH M-7, cursor half (non-string evidence cursor) | **Fixed** | `bybit_funding_record.py:343-345` raises `EvidenceShapeError`. |
| SFH M-7, empty-cursor half | **Validly dispositioned** | Same contract as M-2. |

### WR-02 equivalence: is the raw-endpoint path the same as `fetch_deposits` / `fetch_withdrawals`?

Yes, page for page. I checked this by reading the source and by running it against both 4.5.85 and 4.5.88:

- **Request.** Identical: `{startTime, limit: 50, endTime, cursor}`, with `until` mapped to `endTime` exactly as `handle_until_option` does. No `coin` is sent. `withdrawType` is not sent on either path, so withdrawals stay on-chain only as before (D-02 scope).
- **Parsing and filtering.** Identical: `parse_transactions(add_pagination_cursor_to_result(response), None, window_start, 50)`. Rows are sorted ascending, rows stamped 0/None or older than `window_start` are dropped, and the result is capped at 50.
- **Scratch check.** A scratch script called `fetch_deposits(None, ws, 50, {"until": we, "cursor": "PREV"})` and the new path against the same stubbed raw answer (one stamp-0 row, one row before `since`, deposit and withdrawal shapes). Rows were equal and requests were equal on both versions.
- **`load_markets`.** It runs when `markets is None`, inside the same `except ccxt.NotSupported` scope as before.
- **Rate limiter.** The implicit endpoint method goes through `request -> fetch2 -> throttle` (`async_support/base/exchange.py:998-1001`), so ccxt's limiter still applies. `_rate_limit_sleep` between pages is unchanged.
- **Errors.** The HTTP request path and `handle_errors` are the same, so the exception classes are the same.
- **Wrappers.** The only production wrapper of `fetch_deposits` / `fetch_withdrawals` is the probe recorder. For a Bybit member it is now dead, because the rebuild reads Bybit flows from the Unified log, not `fetch_ccxt_transfers`. The fixer's note on this is correct.

### Verification run

All runs used the main checkout's venv.

- Under ccxt 4.5.85: `test_ccxt_flow_fetch.py`, `test_exchange_pagination.py`, `test_bybit_unified_flows.py`, `test_allocator_history_probe.py`, `test_bybit_funding_record.py` and `test_reconstruct_force_rebuild.py` gave **367 passed**.
- Under 4.5.88 (the uv-cache copy put first on `PYTHONPATH`): `test_ccxt_flow_fetch.py` and `test_bybit_unified_flows.py` gave **60 passed**.
- CI mypy line: `Success: no issues found in 127 source files`. Probe scripts: `Success: no issues found in 2 source files`.
- Redaction: no changed file logs `str(exc)`, `exc_info` or `logger.exception`. `TransferPageStalled` text is static (the kind and the window start only).

### What is wrong

The WR-02 correction changed the window's stop rule. It now ends a window on an empty *parsed* page only when no cursor came back. As a result, an empty *raw* page that still carries a cursor no longer ends the window. If that cursor is the one just sent, the window raises `TransferPageStalled`. Plan 05 says to stop on an empty page, and plan 04 models a venue that does exactly this. See CR-01, which I reproduced.

## Critical Issues

### CR-01: An empty Bybit transfer page that carries a cursor no longer ends the window; an echoed cursor raises `TransferPageStalled`

**File:** `analytics-service/services/ccxt_flow_fetch.py:118-142` (the stop test is `:125`)

**Issue:**

**What changed.** Before this round, `if not page: return True` ended a window on an empty page. To stop a stamp-0 cursor row from ending a window early (WR-02), the condition became `if not page and nxt is None: return True`. Here `page` is the *parsed* page. So an answer whose raw `rows` is empty but whose `nextPageCursor` is non-empty keeps walking. If that cursor was already sent (an echo), `nxt in seen_cursors` raises `TransferPageStalled`.

**Why this shape is realistic.** The phase treats it as a real venue shape:

- **Plan 04, line 148:** "a window holding exactly 50 rows, answered as one full page with cursor "c50" and then an empty page still carrying "c50", returns those 50 rows". The Unified reader pins this in `test_an_empty_page_ends_the_window_even_when_its_cursor_repeats`.
- **Plan 05, line 106:** the transfer branch "stops on an empty page or on a page that left no cursor".
- **ccxt's own cursor paginator** (`fetch_paginated_call_cursor`) breaks on `responseLength == 0` whatever the cursor.

**How often it can trigger.** ccxt's documented Bybit deposit example returns a cursor on a one-row page. If the venue puts a cursor on every non-empty page, every window that holds any deposit or withdrawal is followed by a cursor call. If that call echoes the cursor on an empty answer, the window raises.

**Reproduced.** A real `ccxt.bybit` subclass answered page 1 with 50 rows and cursor `c50`, then page 2 with `rows: []` and cursor `c50`. `fetch_ccxt_transfers` raised `a Bybit transfer window's page cursor did not advance ... (kind=deposits, ...)` after 2 calls. At `eb8d860bd` the same answer returned the 50 rows.

**Who it reaches.** Every `fetch_ccxt_transfers` Bybit caller:

- `run_derive_broker_dailies_job` (`job_worker.py:7357-7366`)
- the stitch composite / NAV derive (`job_worker.py:10815-10820`)

`TransferPageStalled` has no `classify_exception` arm (round-1 L-4), so it is classified `unknown` and retried. If the venue echoes, every Bybit live derive with any flow in a window fails on every retry. That is fail-loud, not data loss, but it is an outage of the live NAV path. The fix was not run against a live venue (the fix report says so), and the pre-phase code never sent a transfer cursor, so nothing so far has measured how the venue answers this call.

**Test gap.** No test serves an empty raw page with a cursor. `_RecordingBybit` and `_NewestFirstBybitTransfers` always answer an empty page with `nextPageCursor: ""`.

**Fix:** decide the stop on the RAW rows, not the parsed ones. This keeps WR-02 (a full raw page whose parsed rows all dropped still continues on its cursor) and restores plan 05's empty-page stop:

```python
        raw_rows = exchange.add_pagination_cursor_to_result(response)
        nxt = _bybit_next_cursor(response)
        if not raw_rows:
            # An empty answer ends the window whatever cursor it carries (plan 05; the
            # Unified reader and ccxt's own cursor paginator stop the same way).
            return True
        page = exchange.parse_transactions(
            raw_rows, None, window_start, _BYBIT_TRANSFER_PAGE_LIMIT
        )
```

Add a RED-able test to `test_ccxt_flow_fetch.py`: 50 rows, then an empty page that still carries `c50`. Assert 50 rows back and 2 calls. Neuter the `if not raw_rows` line and the test should fail with `TransferPageStalled`. `test_a_bybit_page_whose_cursor_row_is_dropped_by_parsing_still_continues` must stay green.

## Info

### IN-01: A refused Unified read can still open the transfer-depth gate from rows the reader would have accepted

**File:** `analytics-service/scripts/allocator_history_probe.py:2003-2006` (gate) and `:1142-1166` (cause)

**What happens.** I reproduced this with a scratch test using the test file's own stubs. The TRANSFER_IN page held one good row 500 days old plus one wrong-type row, so the reader refuses the read. TRANSFER_OUT held one good row 400 days old. The record printed:

- `member_refusal=account_flow_source_unreadable`
- `bybit_unified_state=malformed`
- `deposits_older_365d=1`, `withdrawals_older_365d=1`
- `bybit_transfers_gate=ok`, `bybit_transfers_cause=none`
- `bybit_funding_explained=explained`

**Why it is INFO.** This matches Phase 173 RESEARCH Pitfall 4: a per-kind positive is evidence of venue depth even from a member that failed later. The counted rows also pass the reader's own row check.

**What is missing.** Round-1 WR-01 named "gate `ok`, cause `none`" for a refused read as a consequence. The fix report marks WR-01 fixed without saying that this case remains by design. The new end-to-end test only covers the all-rows-refused case.

**Fix:** record the disposition in `180-REVIEW-FIX.md`. Optionally, add a sentence to `bybit_transfers_cause`'s docstring saying an `ok` gate beside `member_refusal=account_flow_source_unreadable` is intended.

### IN-02: The M-4 log line cannot tell the reader's own refusals apart

**File:** `analytics-service/services/equity_reconstruction.py:4189-4193`

Every reader refusal logs `exc_class=BybitUnifiedFlowReadError`. That covers a stalled cursor, the 200-page ceiling, a wrong-type row and an unreadable amount. SFH M-4's complaint was exactly that an operator cannot tell "repeating cursor" from "past 200 pages". The reader's text is static by contract (`_refuse`, and the walker's ceiling message), so it is safe to log.

**Fix (optional):** for `BybitUnifiedFlowReadError` only, log `str(exc)` as well. Keep class-only for the ccxt classes. The runbook action is the same for all of them, so this is diagnostics only.

### IN-03: `_bybit_next_cursor` coerces a non-string cursor with `str()`

**File:** `analytics-service/services/ccxt_flow_fetch.py:48-50`

A dict or int `nextPageCursor` is sent back to the venue as its Python repr. The Unified reader and, after M-7, the evidence module both refuse a non-string cursor. A coerced cursor most likely ends in a venue `BadRequest` (loud), so this is a consistency nit.

**Fix:** `return cursor if isinstance(cursor, str) and cursor else None`, or raise `TransferPageStalled` for a non-string cursor.

### IN-04: `TransferPageStalled` is still unclassified, and this round added two more ways to raise it

**File:** `analytics-service/services/job_worker.py:1198-1207` (round-1 L-4)

The cycle check and the ceiling now raise where the old code logged. Both are deterministic venue shapes, but they fall to `unknown` and are retried until the budget runs out. This is a LOW carried from round 1; it is noted here because CR-01 would make it fire on every retry.

### IN-05: `test_transfers_bybit_50_per_page_multi_page_not_truncated` never runs the Bybit branch

**File:** `analytics-service/tests/test_exchange_pagination.py:323-344` (pre-existing)

The double is a bare `MagicMock()` with no `id = "bybit"`, so `exchange.id` is a `MagicMock` and the generic 90-day / one-millisecond-advance loop runs. The name claims Bybit coverage it does not give. The real Bybit coverage is in `test_ccxt_flow_fetch.py`.

**Fix:** rename it, or set `exchange.id = "okx"` and describe it as generic-loop coverage.

---

_Reviewed: 2026-10-28T23:16:39Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
