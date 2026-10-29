---
phase: 180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s
reviewed: 2026-10-28T23:25:08Z
reviewed_at_sha: a7653d14f
diff_range: e08531676..HEAD (round-2 fix) and 3b065928f..HEAD (whole phase), excluding .planning
round: 3
depth: deep
files_reviewed: 13
files_reviewed_list:
  - analytics-service/services/ccxt_flow_fetch.py
  - analytics-service/tests/test_ccxt_flow_fetch.py
  - analytics-service/services/bybit_unified_flows.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/services/job_worker.py
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/scripts/bybit_funding_record.py
  - analytics-service/tests/_trade_pages.py
  - analytics-service/tests/test_bybit_two_year_window.py
  - analytics-service/tests/test_bybit_unified_flows.py
  - analytics-service/tests/test_allocator_history_probe.py
  - analytics-service/tests/test_bybit_funding_record.py
  - docs/runbooks/marksource-okx-history-correction.md
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 180: Code Review Report, round 3

**Reviewed:** 2026-10-28T23:25:08Z
**Depth:** deep. I read the round-2 diff line by line, along with the ccxt source it depends on (4.5.85 in the main checkout's venv): `bybit.add_pagination_cursor_to_result`, `bybit.parse_transaction`, base `parse_transactions` and `filter_by_value_since_limit`. I mutation-tested the stop rules through a pytest plugin kept in the scratchpad. Each mutation patched `_read_bybit_transfer_window` in memory only, so no source file was touched. I then made a final pass over the whole phase's service, script and runbook diff.
**Files Reviewed:** 13
**Status:** issues_found

## Summary

### Task 1: CR-01 (= SFH-2 F-1) and SFH-2 F-2

| Finding | Verdict | Evidence |
|---|---|---|
| CR-01 = F-1: an empty raw page that still carries a cursor raised `TransferPageStalled` | **Fixed** | `ccxt_flow_fetch.py:116-120`. The raw rows are taken first, and an empty raw page returns True before the cursor is read or checked against `seen_cursors`. **Can fail:** I reverted the mutation to the round-1 stop (`if not page and nxt is None`, with the raw-empty return removed). `test_an_empty_bybit_page_ends_the_window_even_when_its_cursor_repeats` went RED (1 failed, 11 passed). |
| F-2: `parse_transactions` drops raw rows with no trace | **Fixed (counts-only log, as briefed)** | `ccxt_flow_fetch.py:126-136`. One WARNING per page carries `kind`, `window_start_ms`, `raw_rows` and `parsed_rows`. **Can fail:** I mutated the guard to `if False:` and `test_a_bybit_page_whose_rows_parsing_drops_logs_the_counts_only` went RED. The fixer chose not to raise on more than 50 raw rows. That raise is listed under "Not fixed (LOW / INFO)" in `180-REVIEW-FIX.md`, so it is not re-raised here. A slice past 50 now at least logs `raw_rows=N parsed_rows=50`. |

### Task 2: the round-2 diff

- **An empty raw page ends the window before the cursor check.** Correct, and it matches the Unified reader (`bybit_unified_flows.py:182`, `is_empty` checked before the cursor in `walk_paginated`) and ccxt's own cursor paginator. The early return does make a malformed answer (rows under an unknown key) end the window whatever cursor it carries. That is the pre-phase `fetch_deposits` behaviour and is already booked as SFH-2 L-1 (LOW). It is not re-raised.
- **A full raw page whose rows all parse away still continues.** Correct at HEAD. A scratch test proved it: page 1 has 50 raw rows, all stamped `successAt "0"`, followed by 20 more rows; the result is 2 calls and 20 rows back. **No shipped test pins this property, though.** See WR-01.
- **The ceiling test now serves 1100 rows.** Still sound. Cursors run `off:1` to `off:1000`, so every page offset is below 1100 and all 1000 pages are non-empty with distinct cursors. The walk can only leave through the ceiling raise, and the test still asserts `"1000 pages"` and exactly 1000 calls. The rows overlap from page to page (offset +1) and are de-duplicated by id, which does not affect what the test asserts.
- **The dropped-rows log carries counts only.** Confirmed. The format string's arguments are `kind` (an internal literal), `window_start` (an int the caller computed) and two `len()` values. No id, txid, currency, amount or venue text appears. Raw rows dropped by the cross-window `seen_ids` de-dup are deliberately not counted, because that is a correct de-dup and not a parse loss. CI mypy on the module: `Success: no issues found in 1 source file`. `tests/test_ccxt_flow_fetch.py`: 12 passed.

### Task 3: final pass over the whole phase

I found no new MEDIUM+ data-integrity, silent-failure or redaction defect beyond WR-01. Here is what I checked and found sound:

- `_fetch_and_price_window` (`equity_reconstruction.py:4153-4216`):
  - The Bybit flows replace the on-chain read and are never added beside it.
  - The two-year guard sits outside the forced `try`, and `test_the_two_year_guard_runs_before_the_flow_read_and_outside_its_refusal` pins that.
  - The catch set is exactly `classify_exception`'s permanent ccxt classes plus the reader's own class. A transient error propagates.
  - The refusal log is class-only.
- `classify_exception` gives `BybitUnifiedFlowReadError` a permanent arm, placed above the HTTPException, geo and ccxt arms. Its text is static by contract: `_refuse` and the walker's ceiling message carry type, window and page cap only.
- The Unified reader (`bybit_unified_flows.py`):
  - It refuses rather than drops: no object, wrong type, no usable id, stamp, currency or amount, a non-finite amount, a non-string cursor, a cursor echoed on a non-empty page, and the 200-page ceiling (`on_ceiling="raise"`).
  - A cursor cycle (A, B, A) is not caught early, but it runs to the ceiling and raises. It is never a short list.
  - Direction comes only from the requested type, and the output carries no `kind` or `info` key.
- `bybit_funding_record.py` and the probe diff are diagnostic only (they feed no gate). Every printed value is a count, a closed bucket, a closed token, a boolean or field-absent. Failure states come from `classify_failure` and never read a message. The round-1 and round-2 fixes (WR-01/M-5, M-6, the M-7 cursor half) are intact.
- The runbook's B'3 list moved to 17 tokens, with `account_flow_source_unreadable` under record-only and `account_key_read_stalled` under re-enqueue-once. This matches the code's comment block at `equity_reconstruction.py:2577-2582`.

Items already booked as LOW/INFO or validly dispositioned are not repeated here: REVIEW IN-01 to IN-07, SFH L-1 to L-5, REVIEW-2 IN-01 to IN-05, SFH-2 L-1 to L-5, and M-2 / the M-7 empty-cursor half.

## Warnings

### WR-01: The property this round claims for a full page whose rows all parse away has no test, and a regression that reopens WR-02 passes the whole suite

**File:** `analytics-service/tests/test_ccxt_flow_fetch.py:282-298`. The guarded code is `analytics-service/services/ccxt_flow_fetch.py:116-146`.

**Issue:** The fix report says: "A full raw page whose parsed rows all dropped still continues on its cursor (`test_a_bybit_page_whose_cursor_row_is_dropped_by_parsing_still_continues` stays green)." The code does behave that way. The cited test does not exercise it, though. `unstamped_newest` drops only the newest row of each page, so every parsed page in that test still holds 49 rows. No test anywhere serves a non-empty raw page whose parsed rows are all dropped.

I proved the gap by mutation. This is the plugin in the scratchpad: the function is re-compiled in memory and nothing is written to the tree.

- **Mutation A:** insert `if not page: return True` right after `nxt = _bybit_next_cursor(response)`. This is the natural "simplification" of the parse-then-stop logic. It silently ends a Bybit transfer window after a page whose rows all parse away, which is the WR-02 / H-1 truncation class: missing flows corrupt the flow-aware TWR base for `run_derive_broker_dailies_job` and the stitch composite. Result: `tests/test_ccxt_flow_fetch.py` + `tests/test_exchange_pagination.py` give **30 passed**, so the mutation survives.
- A scratch test that serves 50 raw rows, all `successAt "0"`, then 20 more rows passes at HEAD (`calls == [None, "off:50"]`, 20 rows). It fails under mutation A with `assert [None] == [None, 'off:50']`.

The same scratch run found a second, lower-stakes gap. **Mutation C** turns the stop into `if not raw_rows and _bybit_next_cursor(response) in seen_cursors:`, so an empty page that carries a fresh cursor keeps walking, against plan 05's empty-page stop. It also survives the shipped suite. The only empty-page test uses a repeated cursor, and C still stops on that. A scratch test with a fresh cursor on the empty page kills C (`IndexError` from the double after the extra call). C costs calls rather than rows, which is why it is folded in here rather than filed separately.

The rule this repo applies to data-integrity gates is that the gate must be able to fail. The parse-drop branch is the exact boundary that WR-02, H-1, CR-01 and F-1 have all crossed, and its "continue" direction is currently unguarded.

**Fix:** add two RED-able tests to `tests/test_ccxt_flow_fetch.py`, using the existing double:

```python
class _FirstPageAllUnstamped(_NewestFirstBybitTransfers):
    """Page 1's rows are all stamped successAt "0", so ccxt parses every one away;
    the raw page is full and still carries a live cursor."""

    async def _record(self, request: dict[str, Any]) -> dict[str, Any]:
        answer = await super()._record(request)
        if len(self.calls) == 1:
            for row in answer["result"]["rows"]:
                row["successAt"] = "0"
        return answer


@pytest.mark.asyncio
async def test_a_full_bybit_page_whose_rows_all_parse_away_still_continues() -> None:
    ex = _FirstPageAllUnstamped(_transfer_rows(70, _NOW_MS - 1_000))
    rows = await fetch_ccxt_transfers(
        ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
    )
    assert [c[3] for c in ex.calls] == [None, "off:50"]
    assert len(rows) == 20


@pytest.mark.asyncio
async def test_an_empty_bybit_page_with_a_fresh_cursor_ends_the_window() -> None:
    ex = _NewestFirstBybitTransfers(
        _transfer_rows(50, _NOW_MS - 1_000), cursors=["off:50", "off:999", "off:1000"]
    )
    rows = await fetch_ccxt_transfers(
        ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
    )
    assert len(rows) == 50
    assert len(ex.calls) == 2
```

RED proof to record: from a byte backup, add `if not page: return True` after the `nxt` line. The first test must fail and the second must pass. Then change the empty-raw stop to `if not raw_rows and _bybit_next_cursor(response) in seen_cursors:`. The second test must fail. Restore from the backup and `cmp`.

---

_Reviewed: 2026-10-28T23:25:08Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
