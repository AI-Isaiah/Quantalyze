---
phase: 180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s
reviewed: 2026-10-28T22:44:30Z
reviewed_at_sha: 10847b78b
diff_range: 3b065928f..HEAD (excluding .planning)
depth: deep
files_reviewed: 19
files_reviewed_list:
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/scripts/bybit_funding_record.py
  - analytics-service/services/bybit_unified_flows.py
  - analytics-service/services/ccxt_flow_fetch.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/_bybit_evidence.py
  - analytics-service/tests/_trade_pages.py
  - analytics-service/tests/test_allocator_history_probe.py
  - analytics-service/tests/test_bybit_funding_record.py
  - analytics-service/tests/test_bybit_two_year_window.py
  - analytics-service/tests/test_bybit_unified_flows.py
  - analytics-service/tests/test_ccxt_flow_fetch.py
  - analytics-service/tests/test_equity_reconstruction.py
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_reconstruct_force_rebuild.py
  - analytics-service/tests/test_reconstruct_marker_writer.py
  - analytics-service/tests/test_trade_pages.py
  - docs/runbooks/marksource-okx-history-correction.md
findings:
  critical: 0
  warning: 3
  info: 7
  total: 10
status: issues_found
---

# Phase 180: Code Review Report

**Reviewed:** 2026-10-28T22:44:30Z
**Depth:** deep (cross-module: reader -> `walk_paginated` -> rebuild -> forced-crawl converter -> job classifier -> probe recorder; ccxt 4.5.x `fetch_deposits` / `add_pagination_cursor_to_result` / `filter_by_since_limit` read from the package source)
**Files Reviewed:** 19
**Status:** issues_found

## Summary

I found no BLOCKER. The money path in the rebuild is sound:

- **Replace, not add.** The Bybit branch of `_fetch_and_price_window` builds `deposits` and `withdrawals` only from the Unified log and never calls `fetch_deposits` or `fetch_withdrawals`, so a FUND deposit cannot be counted twice.
- **Direction.** Direction comes from the requested type, and `amount` is `abs(change or cashFlow)`.
- **Ids.** Rows are deduplicated by `(type, id)` and never carry a `kind` key or `info`.
- **Windows.** The windows tile with `+1 ms` (the same `walk_paginated` contract `funding_fetch` already runs in production against this endpoint).
- **Paging.** A stalled cursor and the page cap both raise.
- **Two-year guard.** It runs before the flow read and outside the refusal `try`.
- **Forced and transient paths.** The forced path refuses `account_flow_source_unreadable` with `from None`, and the rest of the forced crawl passes that refusal through unchanged. Transient venue classes still propagate as themselves.

Other checks:

- **Redaction.** The probe output stays within its contract: counts, closed buckets, closed tokens and booleans. The UIDs from `query-api` are dropped, and every failure is recorded by class only.
- **Venue writes.** None were added.
- **Tests.** `mypy --strict` is clean on the three changed service/script modules plus the probe. The 8 phase-relevant test files pass: 514 passed, 1 skipped, run with the main checkout's venv (ccxt 4.5.85; the pin is 4.5.88).

The three WARNINGs are about honesty at the edges:

- **WR-01:** the probe's own Unified-edge reading says `read` when the rebuild refused that same answer, and it counts rows the rebuild threw away. I confirmed this by running it.
- **WR-02:** the D-02 cursor fix reads the cursor from a ccxt-parsed row that ccxt can filter out, which ends a window silently.
- **WR-03:** the copied 1000-page ceiling truncates silently, and only an immediate cursor repeat is detected. Both contradict D-02's "raises instead of truncating".

## Warnings

### WR-01: The probe's `bybit_unified_state` says `read`, and its Unified counts include rows, when the rebuild refused that same Unified answer

**File:** `analytics-service/scripts/allocator_history_probe.py:685-695, 781-821` (recorder), `:1140-1162` (`bybit_funding_explained`), `:1942-2010` (account record)

**Issue:** `_TradeRecorder._recording_unified_log` sees only what the *fetcher* does. `unified_failure` is set only when the raw call raises. `unified_malformed` is set only for an answer that is not `{result:{list:[...]}}`, or a row whose `id` is None or whose `transactionTime` is unparseable.

Every refusal that `services/bybit_unified_flows.py` makes after the fetch returns is invisible to the recorder:

- a row of another type (`:111`)
- an empty-string or non-str/int id (`:114`)
- a missing currency (`:126`)
- a non-numeric or non-finite `change`/`cashFlow` (`:85-101`)
- a non-string cursor (`:179`)
- a cursor that did not advance (`:183`)
- the page cap (`walk_paginated` ceiling)

Non-object rows are also silently dropped by `_log_rows` (`:695`) without being counted as malformed. Meanwhile the recorder appends every raw row, unvalidated and without dedup, to both `transfers` (the gate's input) and `unified`.

Verified by running it (scratch script, test fixtures `install_unified_log`). The reader raised `BybitUnifiedFlowReadError` each time:

```
{'wrong_type': True}    reader refused; recorder unified_state = read rows recorded = 50
{'repeat_cursor': True} reader refused; recorder unified_state = read rows recorded = 100   (the same 50 rows twice)
```

Consequences in a probe record for a forced Bybit read that the rebuild refused with `account_flow_source_unreadable`:

- `bybit_unified_state` reads `read`, which contradicts `member_refusal`. `account_unified_state` documents that "a malformed answer outranks a clean read", and that promise does not hold.
- `bybit_unified_in_rows` / `bybit_unified_out_rows` count rows the rebuild rejected. With `wrong_type`, TRANSFER_OUT rows are counted as deposits. With a repeated cursor, the same rows are counted twice.
- `bybit_funding_explained` returns `explained` from those rows (it short-circuits on `unified_in_rows >= 1` "whatever the Unified state").
- When the venue ignores the type filter and returns old IN and OUT rows under each request, `deposits_older_365d` and `withdrawals_older_365d` can both reach 1. `bybit_transfers_gate` then reads `ok` and `bybit_transfers_cause` reads `none`, both derived from rows the rebuild refused. The rebuild itself still refuses, so nothing is written. But the founder's SC-3 instrument shows an open gate, with no cause, for an account whose flow source is unreadable.

`bybit_transfers_cause` is correct only because `member_refusal` is checked first, and only on the forced path the probe uses.

**Fix:** make the recorder's verdict the reader's verdict. Do not re-implement a narrower one.

- (a) In `_probe_member`, when the caught exception is `ForcedRebuildRefusedError` with reason `_FLOW_SOURCE_REFUSAL`, or the `__context__` / raised exception is `BybitUnifiedFlowReadError`, force `unified_state` to `malformed` (or to the permanent class) before building `_MemberResult`.
- (b) In the recorder, validate each row with the reader's own `normalise_unified_flow_row(row, requested)`. Count a raise as malformed, record only rows that normalise, and dedup on `(kind, id)`, so the probe counts what the replay counts:

```python
from services.bybit_unified_flows import BybitUnifiedFlowReadError, normalise_unified_flow_row
...
for row in rows_raw:                      # do not pre-filter non-Mappings
    try:
        flow = normalise_unified_flow_row(row, requested)
    except BybitUnifiedFlowReadError:
        self.unified_malformed += 1
        continue
    key = (kind, flow["id"])
    if key in self._unified_seen:
        continue
    self._unified_seen.add(key)
    entry = (kind, flow["id"], flow["timestamp"])
    ...
```

Plan 03 says the probe must not import the new module because an older deployed tree lacks it. If that constraint stands, keep (a) and mirror the reader's checks locally, with a parity test that runs both over the same malformed corpus. In either case, add a test where the reader refuses (wrong type, repeated cursor) and the record shows `bybit_unified_state != "read"` and `bybit_transfers_gate != "ok"`.

### WR-02: The D-02 Bybit cursor is read from a ccxt-parsed row that ccxt may filter out, which ends the window silently

**File:** `analytics-service/services/ccxt_flow_fetch.py:40-49, 93-118`

**Issue:** ccxt's `add_pagination_cursor_to_result` writes `nextPageCursor` onto exactly ONE raw row: `data[0]`, which is the newest if Bybit answers newest-first. `parse_transactions` then runs `filter_by_currency_since_limit(result, code, since, limit)`. That filter drops every row whose `timestamp` is None or 0 (`exchange.py` `filter_by_since_limit`: `value is not None and value != 0 and value >= since`).

For a Bybit deposit, ccxt's timestamp is `safe_integer_2(createTime, successAt)`, and deposit records carry only `successAt`. If the cursor-bearing newest row is a deposit still in flight and its `successAt` is empty or `"0"`, the row and its cursor vanish. `_bybit_next_cursor(page)` then returns None, `_read_bybit_transfer_window` returns True ("last page"), and every row past the first 50 in that 30-day window is dropped with no signal. That is exactly the truncation D-02 exists to remove, for every caller (broker dailies, composite, NAV derive).

Confidence is medium. The trigger needs a window holding more than 50 deposits whose newest is unsettled, and Bybit's `successAt` value for a pending row is not documented. The mechanism, though, is in the pinned library's code. The test double (`_NewestFirstBybitTransfers`) never filters a row, so it cannot see this.

**Fix:** take the cursor from the raw answer, not from a parsed row. Either call `exchange.private_get_v5_asset_deposit_query_record` / `..._withdraw_query_record` directly in the Bybit branch and parse with `exchange.parse_transactions(raw_rows, None, None, None)` after reading `result.nextPageCursor`, or wrap `fetch_deposits` so the raw response is captured (ccxt keeps `last_json_response`):

```python
page = await fetcher(None, window_start, _BYBIT_TRANSFER_PAGE_LIMIT, params)
raw = getattr(exchange, "last_json_response", None)
nxt = (raw.get("result") or {}).get("nextPageCursor") if isinstance(raw, dict) else None
```

At minimum, fail loud when the raw page held 50 rows and no cursor was recovered. Add a double whose newest row has `timestamp=None` and assert that all rows come back, or that the read raises.

### WR-03: The Bybit transfer window still truncates silently at the 1000-page ceiling, and a cursor cycle reaches it

**File:** `analytics-service/services/ccxt_flow_fetch.py:93-131`

**Issue:** `_read_bybit_transfer_window` detects only an *immediate* repeat (`nxt == cursor`). A venue cursor that cycles (A -> B -> A ...) or keeps changing without new rows is walked 1000 times. Each step calls `_rate_limit_sleep` and dedups the rows away. The walk then logs a WARNING and **returns True**, so the outer loop moves to the next window and the caller receives a short list as a success.

D-02 and the module's own docstring (`:146-150`, "A cursor that does not advance raises `TransferPageStalled`; it never returns a short list") say the opposite. The new Unified reader got this right (`on_ceiling="raise"`). This branch copied the old generic loop's log-only ceiling. The composite/NAV caller at `services/job_worker.py:10815` has no `wait_for` around the fetch, so nothing else bounds it.

**Fix:** raise at the ceiling, and treat a page that added no new id as a stall:

```python
        added = 0
        for _row in page:
            ...
            all_rows.append(_row); added += 1
        nxt = _bybit_next_cursor(page)
        if nxt is None:
            return True
        if nxt == cursor or nxt in seen_cursors or added == 0:
            raise TransferPageStalled(...)
        seen_cursors.add(nxt)
        cursor = nxt
    raise TransferPageStalled(
        f"a Bybit transfer window exceeded 1000 pages (kind={kind}, window_start_ms={window_start})"
    )
```

Note: `added == 0` must allow the first page of a later window whose rows were all seen at the shared boundary. That page is the first page and has `cursor is None`, so test it only when `cursor is not None`. Add an A -> B -> A double to `test_ccxt_flow_fetch.py`.

## Info

### IN-01: The forced catch set turns key-wide failures into a "flow source" refusal and changes the runbook disposition

**File:** `analytics-service/services/equity_reconstruction.py:4182-4190`

The flow read now runs first, so for a Bybit member an `AuthenticationError` (revoked or expired key, bad signature) or a `PermissionDenied` (IP whitelist) refuses `account_flow_source_unreadable`, which the runbook lists as record-only. Before this phase it refused `account_key_read_failed`, which is re-enqueue-once. A venue `BadRequest`, including Bybit's own two-year rejection if a crawl's later windows cross UTC midnight, lands there too. The probe keeps the class in `bybit_unified_state`, but the job audit carries only the token. If the distinction matters, keep `AuthenticationError` out of the catch so it reaches the existing converter, or state the conflation in the runbook line.

### IN-02: The comment on `_FLOW_SOURCE_REFUSAL` is stale

**File:** `analytics-service/scripts/allocator_history_probe.py:286-291`

"Until then it is not in this probe's emit vocabulary ... no record carrying that refusal is emitted" was true before plan 07. The token is now in `er.FORCED_REBUILD_REFUSAL_REASONS`, and `_REFUSAL_TOKENS` derives from it. Update the comment to its present state.

### IN-03: `NotSupported` on a later Bybit page returns a short list, and a test pins that

**File:** `analytics-service/services/ccxt_flow_fetch.py:101-102`; `analytics-service/tests/test_ccxt_flow_fetch.py` `test_not_supported_on_a_later_bybit_page_returns_what_was_read`

The test asserts that 50 of 120 rows come back as success. `NotSupported` mid-window is not a realistic venue answer, but the test enshrines a truncated return in a module whose contract is "never a short list". Consider raising when `NotSupported` arrives after page 1 (`cursor is not None`).

### IN-04: The probe's Unified counts are not deduplicated the way the replay is

**File:** `analytics-service/scripts/allocator_history_probe.py:811-819, 1942-2010`

The rebuild dedups on `(type, id)`, but the recorder appends every raw row. So `bybit_unified_in_rows` / `out_rows` (and the 173 per-kind counts, as the code already admits) can exceed what the replay consumed. The gate's "at least one" stays sound. The printed counts do not. This is addressed by WR-01 fix (b).

### IN-05: The phase holds two readings of the record endpoints' span rule

**File:** `analytics-service/scripts/bybit_funding_record.py:103-112` (29-day windows, "refuse a span that is not LESS than 30 days") vs `analytics-service/services/ccxt_flow_fetch.py:172-187` (exactly 30-day `[start, start+30d]` spans on the same endpoints)

a6's 2026-10-28 probe read 30-day spans without a `BadRequest`, so 30 days appears to be accepted and the 29 is only conservative. Still, the `EvidenceBook` double enforces a stricter rule than the shared read is tested against. Record which reading is measured.

### IN-06: `off_edge` treats two-way transfer lists as "money arriving"

**File:** `analytics-service/scripts/allocator_history_probe.py:1160-1165` with `analytics-service/scripts/bybit_funding_record.py:166-168`

`inter_xfer` and `universal_xfer` rows include outbound moves (UNIFIED->FUND, master->sub). An account with Unified OUT rows only, plus any transfer-list row, reads `off_edge` ("money arriving off the edge"). The error is in the conservative direction (it holds a rebuild), but the label overstates the evidence.

### IN-07: Reading flows first widens the UTC-midnight exposure for unforced Bybit jobs

**File:** `analytics-service/services/equity_reconstruction.py:4170-4195`

The two-year guard is evaluated once against `now_ms`. Then about 210 log requests (roughly 90 s) run before the trade read begins, and TRANSFER_OUT's oldest window is requested roughly 45 s in. A job claimed in the last couple of minutes before UTC midnight can therefore send an oldest-window start that the venue measures as past two years. Plan 08 forbids the probe between 23:30 and 00:30 UTC, but the queue has no such rule. This is low-likelihood and recorded for completeness.

---

_Reviewed: 2026-10-28T22:44:30Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
