# Phase 180: BYBITFUNDING - Pattern Map

**Mapped:** 2026-10-28
**Files analyzed:** 14 (2 new, 12 modified)
**Analogs found:** 14 / 14 (one file, the evidence-source reader inside the probe, has only a role-match analog)

All paths are repo-relative and git-tracked (verified with `git ls-files` from `analytics-service/`). No analog is a gitignored mirror. Cite by SYMBOL: the line numbers are this session's, for `plan-anchor-verify` re-resolution; anchor plan prose on the symbol beside them. Everything below runs from `analytics-service/` (pytest and the CI mypy line, see Shared Patterns).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/services/bybit_unified_flows.py` (NEW) | service (venue fetch) | batch / cursor-paged request-response | `analytics-service/services/funding_fetch.py` `fetch_funding_bybit` (same endpoint) | exact |
| `analytics-service/services/ccxt_flow_fetch.py` (EDIT, Bybit branch of `fetch_ccxt_transfers`) | service (venue fetch) | batch / cursor-paged | itself + `equity_reconstruction._next_page_cursor` / `_read_bybit_window` (ccxt `info["nextPageCursor"]`) | exact (same ccxt mechanism) |
| `analytics-service/services/equity_reconstruction.py` (EDIT: `_fetch_and_price_window` Bybit branch) | service (orchestration) | request-response | its own non-Bybit transfers read; `_fetch_bybit_trades` age guard | exact |
| `analytics-service/services/equity_reconstruction.py` (EDIT: `FORCED_REBUILD_ACCOUNT_REASONS` + raise site) | config (closed vocabulary) | event-driven (refusal) | `account_key_read_stalled` token and its raise site | exact |
| `analytics-service/scripts/allocator_history_probe.py` (EDIT: `_TradeRecorder`) | utility (read-only recorder) | transform / in-memory capture | itself: `_TradeRecorder._recording_transfers` | exact |
| `analytics-service/scripts/allocator_history_probe.py` (EDIT: per-source evidence reads) | utility (side measurement) | batch, GET only | `_okx_order_reading` (+ `_anchor_diagnostic` for the bound) | role-match |
| `analytics-service/scripts/allocator_history_probe.py` (EDIT: record vocabulary, `bybit_transfers_cause`, `bybit_funding_explained`) | utility (closed vocabulary) | transform | `ACCOUNT_RECORD_KEYS` / `_ACCOUNT_VALIDATORS` / `_account_record` / `bybit_transfers_verdict` | exact |
| `analytics-service/tests/_trade_pages.py` (EDIT: Bybit log/transfer book double) | test helper | request-response fake | `VenueTradeBook` + `bybit_select` | exact |
| `analytics-service/tests/test_bybit_unified_flows.py` (NEW) | test | request-response | `analytics-service/tests/test_funding_fetch.py` `TestFetchFundingBybit` + `_bybit_mock_with_fallback` | exact |
| `analytics-service/tests/test_ccxt_flow_fetch.py` (EDIT: page RED tests) | test | request-response | itself: `_RecordingExchange` | exact |
| `analytics-service/tests/test_trade_pages.py` (EDIT: on-chain-only RED, flows-before-trades) | test | request-response | `test_a_bybit_window_with_a_quiet_first_week...` (spy on `er._compute_daily_equity`) | exact |
| `analytics-service/tests/test_reconstruct_force_rebuild.py` and `analytics-service/tests/test_bybit_two_year_window.py` (EDIT: token pin 16 to 17, flow_source arm) | test | event-driven | the 16-token pin + raise-site equality scan | exact |
| `analytics-service/tests/test_allocator_history_probe.py` (EDIT) | test | request-response | `_StubVenueWithTransfers`, `test_transfer_events_older_than_365_days...`, `test_the_probe_source_calls_no_venue_write` | exact |
| `docs/runbooks/marksource-okx-history-correction.md` (EDIT, B'3 token list) | config (runbook) | n/a | the B'3 "Record only, no re-run" list | exact |

(`CHANGELOG.md`, `VERSION`, `package.json` release commit: see Shared Patterns, CHANGELOG discipline. Not a code analog.)

## Pattern Assignments

### `analytics-service/services/bybit_unified_flows.py` (NEW; service, cursor-paged request-response)

**Analog:** `analytics-service/services/funding_fetch.py` `fetch_funding_bybit` (reads the SAME endpoint `private_get_v5_account_transaction_log` through `walk_paginated`). Driver: `analytics-service/services/exchange_pagination.py`.

**Imports pattern** (`funding_fetch.py` header, `from __future__ ...` through `from services.redact import scrub_freeform_string`): `logging`, `datetime/timezone`, `ccxt.async_support as ccxt`, then the pagination names
```python
from services.exchange_pagination import (
    PageRequest, PageResult, ProviderPaginationContract, walk_paginated,
)   # funding_fetch.py imports these from services.exchange_pagination
from services.redact import scrub_freeform_string
```
Constants to mirror (`funding_fetch.py`): `BYBIT_PAGE_SIZE = 50`, `MAX_PAGES = 200`. Define `UNIFIED_FLOW_TYPES: Final[tuple[str, ...]] = ("TRANSFER_IN", "TRANSFER_OUT")` here so a follow-up extends the list in one place (RESEARCH Q2). Import this module's constants DIRECTLY in the probe, never through `er` (the `DEPLOYED_ER_NAMES` pin).

**Per-page callback + response-shape validation** (`fetch_funding_bybit`, inner `_fetch_page`, params dict and the three `isinstance` guards): copy the structure, change the fan-out key from `category` to `type`:
```python
params: dict[str, str] = {
    "category": req.inst_type or "",     # <- Phase 180: "accountType": "UNIFIED", "type": req.inst_type or ""
    "type": "SETTLEMENT",
    "limit": str(BYBIT_PAGE_SIZE),
    "startTime": str(req.window_start),
    "endTime": str(req.window_end),
}
if req.cursor:
    params["cursor"] = req.cursor
result = await exchange.private_get_v5_account_transaction_log(params)
...
if not isinstance(result, dict): raise RuntimeError(...)
inner = result.get("result")
if not isinstance(inner, dict): raise RuntimeError(...)
items = inner.get("list", [])
if not isinstance(items, list): raise RuntimeError(...)
...
next_cursor = inner.get("nextPageCursor", "") or ""
return PageResult(rows=page_rows, next_cursor=next_cursor,
                  is_full_page=len(items) >= BYBIT_PAGE_SIZE, is_empty=(not items))
```
**Do NOT copy** the row picking loop `for key in ("funding", "change", "cashFlow"): if val is not None` (a transfer row carries `"funding": ""`, so `is not None` picks the empty string; RESEARCH Pitfall 3). Read `change`, else `cashFlow`, treat `""`/`None`/non-finite as absent; direction from the requested `type`, never from the sign; `amount = abs(...)`. A row with no parseable id, amount, currency or `transactionTime` RAISES (unreadable source) rather than being dropped (funding drops and counts; flows must refuse). Never put a key named `kind` on an output row (the replay builds `{"kind": "deposit", **d}`, `equity_reconstruction.py` replay events).

**Contract** (`funding_fetch.py` `ProviderPaginationContract(...)` block; `exchange_pagination.py` class `ProviderPaginationContract` lines 53-103):
```python
contract = ProviderPaginationContract(
    fetcher="fetch_bybit_unified_flows",
    page_cap=MAX_PAGES, on_ceiling="raise",          # ceiling_exc/ceiling_label: own class or default PaginationCeilingExceeded
    stop_on_short_page=False,       # cursor-authoritative, like every Bybit walk
    stuck_cursor_is_stop=False,     # a repeated cursor exhausts to the ceiling and RAISES (loud)
    inst_types=UNIFIED_FLOW_TYPES,  # the two log types are the fan-out
    gated_inst_types=frozenset(),
    window_max_days=7,              # Bybit caps the range at 7 days
)
walk = await walk_paginated(contract, since_ms=since_ms, now_ms=now_ms, fetch_page=_fetch_page)
```
Window rule to rely on (`exchange_pagination._windows`): `w_end = min(w_start + window_ms, now_ms)`, `next_start = w_end + 1`. 729 days is 105 windows per type, 210 calls before paging. Walk completion rule: the driver `for ... else` raises/flags only when `page_cap` is exhausted on a live page.

**Error handling** (`fetch_funding_bybit` `except ccxt.BadRequest / ccxt.PermissionDenied / except Exception`): log exception CLASS plus `scrub_freeform_string(str(exc))`, then `raise`. Copy the log-and-reraise shape; DROP the `if req.inst_type == "inverse": ... skip_inst_type=True` graceful-skip arms. Neither flow type may be skipped: a permanent error must reach `_fetch_and_price_window` to become the new refusal (WR-04: only `NotSupported` is ever swallowed).

**Output shape:** ccxt-transfer dicts the replay reads: `currency` (replay falls back to `code`), `amount`, `timestamp`, plus `type` in {`deposit`,`withdrawal`}, `id`, `fee` for `services/ccxt_flows.py` `ccxt_rows_to_dated_flows`. Dedup by `id` per kind (copy the `seen_ids` idiom in `fetch_ccxt_transfers`).

---

### `analytics-service/services/ccxt_flow_fetch.py` (EDIT; Bybit branch of `fetch_ccxt_transfers`, cursor-paged)

**Analog:** the function itself (lines 51-162) for the window loop and dedup, and `analytics-service/services/equity_reconstruction.py` `_next_page_cursor` (line 709) for the cursor scan.

**The bug, verbatim** (`fetch_ccxt_transfers`, inner loop tail):
```python
max_ts = max((int(r.get("timestamp") or 0) for r in page), default=inner_cursor)
if max_ts <= inner_cursor or max_ts >= window_end:
    break
inner_cursor = max_ts + 1
await _rate_limit_sleep(exchange)
```
ccxt re-sorts a parsed page ASCENDING, so `max_ts` is the newest row. A newest-first venue drops every older row of the window.

**Cursor helper to copy** (`equity_reconstruction._next_page_cursor`; do NOT import `equity_reconstruction` here, it imports this module at `from services.ccxt_flow_fetch import _rate_limit_sleep, fetch_ccxt_transfers`):
```python
def _next_page_cursor(page: list[dict[str, Any]]) -> str | None:
    for row in page:
        info = row.get("info")
        if isinstance(info, dict) and info.get("nextPageCursor"):
            return str(info["nextPageCursor"])
    return None
```
Rename it privately (`_bybit_next_cursor`) in this module. Shape of the change (Bybit branch only, keyed on the existing `exchange_id == "bybit"`; Binance/OKX stay byte-identical): call `fetcher(None, window_start, 50, {"until": window_end, "cursor": cursor})` (cursor only when set), keep the id-dedup block unchanged, stop on empty page or no cursor, and RAISE on a repeated cursor (never a silent `break`). Keep `except ccxt.NotSupported: return all_rows` exactly (WR-04). Keep the loud `for ... else` ceiling warning pattern.

**Callers that inherit the fix (D-02):** `job_worker` NAV and composite derives (visible live-NAV change on busy Bybit keys; the SUMMARY must say so), `okx_archive_job` (none), the probe (via the rebuild). Do not add new kinds to them.

---

### `analytics-service/services/equity_reconstruction.py` (EDIT; `_fetch_and_price_window`, Bybit branch)

**Analog:** the current transfers block in the same function (`_fetch_and_price_window`, lines 4141-4150) and the age guard in `_fetch_bybit_trades` (lines 894-907).

**Current code to replace for Bybit only:**
```python
transfers_since_ms = start_ms
if hit_terminus:
    okx_terminus_ms = now_ms - OKX_TRADE_TERMINUS_DAYS * 24 * 60 * 60 * 1000
    transfers_since_ms = max(start_ms, okx_terminus_ms)
deposits = await fetch_ccxt_transfers(exchange, "deposits", transfers_since_ms, now_ms)
withdrawals = await fetch_ccxt_transfers(exchange, "withdrawals", transfers_since_ms, now_ms)
```
New: an explicit `venue.lower() == "bybit"` branch builds `deposits`/`withdrawals` ONLY from `fetch_bybit_unified_flows` and calls neither `fetch_deposits` nor `fetch_withdrawals` (replace, do not add: adding both double-counts a FUND deposit plus its FUND-to-UNIFIED move; Pitfall 1). Non-Bybit venues keep the block above untouched. The downstream symbol collection (`for lst in (deposits, withdrawals): ... s not in STABLECOINS`) and pricing need no change.

**Read order (planner decision, RESEARCH Q7, recommended):** read the Bybit flows BEFORE `_fetch_trades_with_pagination` so a trade-crawl timeout (`_RECONSTRUCT_CRAWL_TIMEOUT_S`, 1500 s; a6 used about 1050 s) cannot lose them. Test with a call-order assertion (log requested before the first `fetch_my_trades`).

**Age guard stays OUTSIDE the wrapped call** (copy the shape from `_fetch_bybit_trades`):
```python
if since_ms < now_ms - BYBIT_TRADE_TERMINUS_DAYS * 24 * 60 * 60 * 1000:
    raise ccxt.BadRequest("bybit trade window starts before the venue's two-year limit; nothing was read")
```
If the flow read runs first, apply the same guard before it and outside the `try`, so a crawl begun after UTC rollover keeps its existing disposition (`account_key_read_failed` via the gather converter) instead of being mislabelled as an unreadable flow source.

**New refusal (D-03) wrapper, only permanent classes and only when `require_anchor`:**
```python
try:
    deposits, withdrawals = await fetch_bybit_unified_flows(exchange, start_ms, now_ms)
except (ccxt.AuthenticationError, ccxt.PermissionDenied, ccxt.BadRequest, <malformed-row/stall error>):
    if require_anchor:
        raise ForcedRebuildRefusedError("account_flow_source_unreadable") from None
    raise
```
The tuple is `job_worker.classify_exception`'s permanent set (`isinstance(exc, (ccxt.AuthenticationError, ccxt.PermissionDenied, ccxt.BadRequest))` returns `"permanent"`). `NetworkError`, `RequestTimeout`, `RateLimitExceeded` stay unwrapped and bubble (the account crawl turns them into `_AccountCrawlRetryableError`; see the gather loop around line 6370-6386). Unforced (`require_anchor` False): the venue error propagates to the generic classifier and nothing is written (RESEARCH Open Question 2: founder decision, recommended fail loud). The literal MUST be written as `ForcedRebuildRefusedError("account_flow_source_unreadable")` (the raise-site scan reads source text; Pitfall 7).

---

### `analytics-service/services/equity_reconstruction.py` (EDIT; closed vocabulary, new token)

**Analog:** `account_key_read_stalled` (Phase 171, the 16th token) in `FORCED_REBUILD_ACCOUNT_REASONS` (lines 2576-2588), its lineage comment (lines 2562-2565), and its raise site (`raise ForcedRebuildRefusedError("account_key_read_stalled") from None`, line 6351).

**Pattern to copy:**
```python
FORCED_REBUILD_ACCOUNT_REASONS: Final[frozenset[str]] = frozenset(
    {
        "account_state_unreadable",
        ...
        "history_days_unreproduced",
        "account_key_read_stalled",
        # add: "account_flow_source_unreadable",   (17th)
    }
)
FORCED_REBUILD_REFUSAL_REASONS: Final[frozenset[str]] = (
    FORCED_REBUILD_ANCHOR_REASONS | FORCED_REBUILD_ACCOUNT_REASONS
)
```
Add a dated lineage comment above the sets, in the voice of the existing "2026-10-27, Phase 171 READCEILING: the set gained its 16th token ..." paragraph, naming Phase 180 BYBITFUNDING as the 17th and saying which re-run class it belongs to (it clears only when key permissions change, so record-only). Update the "these 16 tokens" wording in the comment above the sets. Refusal text stays static (`ForcedRebuildRefusedError.__init__`: `forced rebuild refused (<reason>)`, no venue text).

**Closed-vocabulary pins that move TOGETHER with this token (one commit):**
- `analytics-service/tests/test_reconstruct_force_rebuild.py` token-set test (lines ~776-826): the `account = frozenset({...})` literal, `assert len(anchor) + len(account) == 16`, the docstring "EQUAL the 16 tokens", and the raise-site equality scan `re.findall(r'ForcedRebuildRefusedError\(\s*"([a-z_]+)"\s*\)', source)`.
- `analytics-service/tests/test_bybit_two_year_window.py` `test_the_two_year_refusal_adds_no_token` (line ~364): `assert len(er.FORCED_REBUILD_REFUSAL_REASONS) == 16` and its docstring.
- `docs/runbooks/marksource-okx-history-correction.md` B'3 (lines ~603-613): "15 tokens" (already stale) and the "Record only, no re-run" list (add the new token).
- Probe vocabularies `_SELECTION_TOKENS` / `_REFUSAL_TOKENS` derive from the set (lines 193-194): no edit, only a docstring note in `test_the_probe_knows_every_typed_truncation_site` style.

---

### `analytics-service/scripts/allocator_history_probe.py` (EDIT; `_TradeRecorder` also records the Unified log)

**Analog:** the class itself, `_TradeRecorder.__init__` and `_recording_transfers` (lines 621-655).

**Existing pattern:**
```python
self.transfers: list[tuple[str, Any, int | None]] = []
for kind, name in (("deposits", "fetch_deposits"), ("withdrawals", "fetch_withdrawals")):
    fetcher = getattr(client, name, None)
    if fetcher is not None:
        setattr(client, name, self._recording_transfers(kind, fetcher))

def _recording_transfers(self, kind: str, fetcher: Any) -> Callable[..., Any]:
    async def _recorded_transfers(*args: Any, **kwargs: Any) -> Any:
        page = await fetcher(*args, **kwargs)
        for row in page or []:
            if isinstance(row, Mapping):
                self.transfers.append((kind, row.get("id"), _as_int(row.get("timestamp"))))
        return page
    return _recorded_transfers
```
New: also wrap `client.private_get_v5_account_transaction_log` (only when present, like `getattr(..., None)`): for a call whose `type` param is `TRANSFER_IN`/`TRANSFER_OUT`, append `("deposits"|"withdrawals", row["id"], int(row["transactionTime"]))` per raw `result.list` row, leave every other call untouched, hand the answer back unchanged. Ids and stamps stay in memory. All downstream (`transfers_older_than`, `transfers_of_kind`, `oldest_transfer_ms`, `deposits_older_365d`, `withdrawals_older_365d`, `bybit_transfers_verdict`) then describes the Unified edge with NO shape change; map `TRANSFER_IN` to the `"deposits"` kind and `TRANSFER_OUT` to `"withdrawals"` (document the mapping in the plan, D discretion). Rewrite the "on-chain only" wording in the comment at `_probe_account` (lines ~1655-1657, "the rebuild's Bybit transfer read is on-chain only (RESEARCH Pitfall 3)") and in the file header, adding a lineage note that the 2026-10-28 reading was on-chain.

---

### `analytics-service/scripts/allocator_history_probe.py` (EDIT; per-source evidence reads, probe-only)

**Analog:** `_okx_order_reading` (lines 1161-1216) for a side measurement that never changes a member's outcome, plus `_anchor_diagnostic` (lines 1323-1340) for the own bound.

**Own bound + class-only failure** (copy):
```python
for inst_type in inst_types:
    try:
        raw = await asyncio.wait_for(client.private_get_trade_fills_history({...}), er._RECONSTRUCT_CRAWL_TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
        if failure == "none":
            failure = classify_failure(exc)
        continue
```
and `_anchor_diagnostic`: `asyncio.wait_for(..., er._RECONSTRUCT_CRAWL_TIMEOUT_S)` then `except Exception as exc: ... "diagnostic_failure_class": ("truncated" if isinstance(exc, er.TruncatedTradeRead) else classify_failure(exc))`. Use a per-source constant bound (RESEARCH suggests about 420 s) so a timeout is the state token `Timeout`, never a count of 0.

**Where it runs:** from `_probe_member` AFTER the snapshot lines (`calls = list(recorder.calls)`, `moved = list(recorder.transfers)`, `elapsed_s = _elapsed()`) and beside the `_okx_order_reading` call, on the success, refusal and truncated arms, skipped on the generic failure arm (a hung venue). Add its results to `_MemberResult` (dataclass at line 1144) like `order` / `order_failure_class`.

**Walk:** reuse `walk_paginated` with `inst_types=()`, `window_max_days` 30 (on-chain deposit, internal deposit, withdraw `withdrawType=2`) or 7 (inter-transfer, universal-transfer), `on_ceiling="flag"` surfaced as a state token. Sources and rows keys per RESEARCH Standard Stack table. Raw method names: `private_get_v5_asset_deposit_query_record`, `private_get_v5_asset_deposit_query_internal_record`, `private_get_v5_asset_withdraw_query_record`, `private_get_v5_asset_transfer_query_inter_transfer_list`, `private_get_v5_asset_transfer_query_universal_transfer_list`, `private_get_v5_user_query_api`.

**Failure vocabulary:** `FAILURE_CLASSES` and `classify_failure` in `analytics-service/scripts/bybit_upnl_probe.py` (imported at probe line 156), never a new mapping. Master-only sources (withdraw record) get an explicit `not-master` state when `isMaster` is `False`, not a call. Read `isMaster`/`uta` strictly (`is True`/`is False`, else `field-absent`); never store `userID` or `parentUid`.

**Static pins this code must satisfy** (`analytics-service/tests/test_allocator_history_probe.py`): `test_the_probe_source_calls_no_venue_write` forbids `\b(create_order|cancel_order|withdraw|transfer)\(` anywhere in the probe source (name helpers `_read_withdraw_all`, never `withdraw(`/`transfer(`) and `\bprivate_(post|put|delete)_`; the existing assertion `"private_get_trade_fills_history(" in _PROBE_SRC` shows the pattern for adding the new raw GETs; `test_every_rebuild_name_the_probe_reads_is_declared` requires every `er.<name>` read to be in sorted `DEPLOYED_ER_NAMES` (line 245).

---

### `analytics-service/scripts/allocator_history_probe.py` (EDIT; record vocabulary, cause and explained fields)

**Analog:** `ACCOUNT_RECORD_KEYS` (lines 264-335), `_ACCOUNT_VALIDATORS` (395-470), `_account_record` defaults (1493-1566), `_BYBIT_TRANSFERS_GATES` (241), `bybit_transfers_verdict` (896-912), and the `_probe_account` call that wires it (1673-1675).

Three places move together or `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens` (`set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record("a1", "2026-10-23"))`) and `validate_record` fail:
```python
ACCOUNT_RECORD_KEYS = (..., "bybit_transfers_gate", <new keys>, "truncated_site", ...)
_ACCOUNT_VALIDATORS = {..., "bybit_transfers_gate": _is_one_of(_BYBIT_TRANSFERS_GATES), <new validators>, ...}
_account_record(...) record = {..., "bybit_transfers_gate": "not-applicable", <new defaults>, ...}
```
Validator helpers to reuse: `_is_count`, `_is_count_or_absent`, `_is_bool_or_absent`, `_is_one_of(...)`, with the existing `_WINDOW_AGE_BUCKETS` for per-source oldest buckets. Non-Bybit accounts carry defaults (`0`, `none`, `not-run`, `field-absent`). `SUMMARY_RECORD_KEYS` changes only if a summary field is added.

**Redaction contract (deny list in `deribit_ground_truth.assert_sanitized`, called by `validate_record`):** key names must avoid the substrings `secret`, `token`, `api_key`, `apikey`, `password`; no string value of 40+ chars of `[A-Za-z0-9+/=_-]`. So proposed field names are `bybit_<source>_rows`, `bybit_<source>_older_365d`, `bybit_<source>_oldest_age_bucket`, `bybit_<source>_state`, `bybit_is_master`, `bybit_is_uta`, `bybit_unified_state`, `bybit_unified_sign_mismatch_rows`, `bybit_other_transfer_like_rows` (optional census), `bybit_transfers_cause`, `bybit_funding_explained`; avoid the word "token" in any NEW KEY NAME (the closed-set values may be anything under 40 chars). Add one test that emits a fully populated record through `emit_record` (Pitfall 8) and one that plants a fake id in a stub row and asserts it never appears in `captured.out + captured.err` (existing pattern: `assert "fake-transfer" not in captured.out + captured.err`).

**Cause is code-derived next to the gate** (copy the shape of `bybit_transfers_verdict`: pure function, inputs are counts and tokens, returns a closed string). Values (RESEARCH Q6): `none`, `no_deposit_older_365d`, `no_withdrawal_older_365d`, `neither_older_365d`, `flow_source_unreadable` (member refused with the new token, or the Unified state is a failure class), `read_incomplete`, `not-applicable`. The gate function itself is UNCHANGED (BOTH kinds older than 365 days).

---

### `analytics-service/tests/_trade_pages.py` (EDIT; Bybit log/transfer book double)

**Analog:** `bybit_select` (lines 120-142) and `VenueTradeBook._bybit` (210-229), and `real_ccxt_client`'s `_execution_list` stub (322-339) for a RAW-endpoint answer.

**Pattern to copy (newest first, opaque offset cursor, window check):**
```python
def bybit_select(trades, *, start, end, cursor, size):
    end = start + BYBIT_WINDOW_MS if end is None else int(end)
    if end - start > BYBIT_WINDOW_MS:
        raise ccxt.BadRequest("bybit: endTime - startTime must be at most 7 days")
    inside = sorted((t for t in trades if start <= int(t["timestamp"]) <= end), key=_order_key, reverse=True)
    offset = int(str(cursor)[1:]) if cursor else 0
    chunk = inside[offset : offset + size]
    return chunk, (f"c{offset + size}" if offset + size < len(inside) else None)
```
New double for `private_get_v5_account_transaction_log`: takes the raw request dict (`accountType`, `type`, `startTime`, `endTime`, `limit`, `cursor`), filters by `type`, reuses `bybit_select` (size capped at 50), and answers `{"retCode": 0, "result": {"list": [<raw log rows>], "nextPageCursor": next_cursor or ""}}`; raw rows carry `id`, `type`, `transactionTime`, `change`, `cashFlow`, `funding: ""`, `currency`. For on-chain `fetch_deposits` pages (ccxt-shaped), a Bybit-faithful NEWEST-FIRST, 50-per-page double that honours `params["until"]` and `params["cursor"]`, returns rows ascending and puts `info["nextPageCursor"]` on the newest returned row (as `VenueTradeBook._bybit` does with `page[-1]["info"]["nextPageCursor"]`). Add an "empty log" installer for the many `AsyncMock()` Bybit doubles (`exchange.id = "bybit"` with only `fetch_deposits`/`fetch_withdrawals` set): `AsyncMock().private_get_v5_account_transaction_log` returns a non-dict, which the new reader correctly refuses (Pitfall 6, Wave 0). Sweep with `grep -ln 'id = "bybit"' tests/*.py` and run the whole corpus once early.

---

### `analytics-service/tests/test_bybit_unified_flows.py` (NEW)

**Analog:** `analytics-service/tests/test_funding_fetch.py` `TestFetchFundingBybit` (line 243) and its helper `_bybit_mock_with_fallback` (lines 38-64).

**Helper pattern to copy:**
```python
def _bybit_mock_with_fallback(*responses):
    response_list = list(responses); call_count = {"n": 0}
    async def _side_effect(*args, **kwargs):
        idx = call_count["n"]; call_count["n"] += 1
        if idx < len(response_list):
            item = response_list[idx]
            if isinstance(item, BaseException): raise item
            return item
        return _BYBIT_EMPTY_PAGE
    return AsyncMock(side_effect=_side_effect)
```
**Assertion pattern** (`test_uses_transaction_log_endpoint`): collect `c.args[0]` from `mock_exchange.private_get_v5_account_transaction_log.await_args_list` and assert the set of requested `type`s. For this file also assert `accountType == "UNIFIED"`, both types, 7-day tiling from start to now, `limit == "50"`. Prefer the new newest-first book double over a static list for the paging test. Tests (RESEARCH Validation map): request shape; 120 `TRANSFER_IN` rows across pages (neuter: ignore `nextPageCursor` gives 50, RED); normaliser (`""` fields, sign vs type, missing id/amount/currency/time raises); repeated cursor raises; permanent vs transient exception passthrough. Each RED proof is run as: byte-copy the file, neuter, see RED, restore from the byte backup (never `git checkout`/`stash`).

---

### `analytics-service/tests/test_ccxt_flow_fetch.py` (EDIT; RED tests for dropped page and stuck cursor)

**Analog:** the file's `_RecordingExchange` (lines 25-56) and tests `test_bybit_windows_tile_the_full_history_without_gaps` (85-97).

Pattern: a small exchange double with `id = "bybit"`, async `fetch_deposits(self, code, since, limit, params=None)` recording `{"since", "until"}`. Add a NEWEST-FIRST variant that returns 50 rows per call, ascending, with `info["nextPageCursor"]` on the newest row and honours `params["cursor"]`. Assertions: a 120-row single window returns all 120 ids and exactly 3 calls; a double that repeats its cursor makes `fetch_ccxt_transfers` raise (never a truncated list). Keep the existing `_make_capped_transfer_fetcher` doubles in `tests/test_exchange_pagination.py` (ascending, `matching[:cap]`) for OKX/Binance only: they model Bybit wrongly, which is why the old bug never showed (Pitfall 5). Neuter proof: restore `inner_cursor = max_ts + 1` for the Bybit branch.

---

### `analytics-service/tests/test_trade_pages.py` (EDIT; on-chain-only RED, flows-before-trades)

**Analog:** `test_a_bybit_window_with_a_quiet_first_week_and_more_than_one_page_reaches_the_replay_whole` (lines 30-71).

**Pattern to copy (exchange double + spy on the replay input):**
```python
exchange = AsyncMock()
exchange.id = "bybit"
exchange.fetch_my_trades = AsyncMock(side_effect=VenueTradeBook(exchange, trades))
exchange.fetch_deposits = AsyncMock(return_value=[])
exchange.fetch_withdrawals = AsyncMock(return_value=[])
exchange.fetch_ohlcv = AsyncMock(return_value=[_make_ohlcv_row(start_ms + d * DAY_MS, 50000.0) for d in range(62)])

seen = []
original = er._compute_daily_equity
def _spy(trades_in, *args, **kwargs):
    seen.append(list(trades_in))
    return original(trades_in, *args, **kwargs)
monkeypatch.setattr(er, "_compute_daily_equity", _spy)
await er._fetch_and_price_window(exchange, "bybit", MagicMock(), start_date, end_date)
```
For SC-2: set `fetch_deposits` to return ONE on-chain deposit and `private_get_v5_account_transaction_log` to return ONE `TRANSFER_IN` of a different coin/amount/id; also record the `deposits`/`withdrawals` arguments in the spy. Assert `deposits` is exactly the Unified row (on-chain row absent), `withdrawals` is the Unified `TRANSFER_OUT` row, the log was requested with `accountType` `UNIFIED`, both types over tiled 7-day windows, and `fetch_deposits`/`fetch_withdrawals` were never awaited (`await_count == 0`, as `test_the_two_year_refusal_adds_no_token` asserts `fetch_my_trades.await_count == 0`). Reverting the Bybit branch to `fetch_ccxt_transfers` is RED. Flows-before-trades: record call order on one shared list and assert the first log call precedes the first `fetch_my_trades`.

---

### `analytics-service/tests/test_reconstruct_force_rebuild.py` and `analytics-service/tests/test_bybit_two_year_window.py` (EDIT)

**Analog:** the existing token-set pin (`test_reconstruct_force_rebuild.py` lines ~776-826) and the Phase 171 edit of it.

Edits: add `"account_flow_source_unreadable"` to the `account` frozenset literal, `== 17`, update both docstrings with a dated 180 paragraph in the style of the Phase 171 one ("It moved with this pin, the two-year-window pin, the probe's derived vocabulary and the post-deploy handoff, as the closed-vocabulary rule says"). `test_bybit_two_year_window.py`: `assert len(er.FORCED_REBUILD_REFUSAL_REASONS) == 17`. New `-k flow_source` tests: permanent venue error plus `require_anchor=True` raises `ForcedRebuildRefusedError` with reason `account_flow_source_unreadable` (neuter: widen the `except` to `Exception`, or drop the `require_anchor` gate); a transient error (`ccxt.RateLimitExceeded`/`NetworkError`) bubbles unchanged; unforced re-raises the venue error. Use the existing refusal-message assertion `str(exc) == f"{REFUSAL_PREFIX}{reason})"`.

---

### `analytics-service/tests/test_allocator_history_probe.py` (EDIT)

**Analog:** `_StubVenueWithTransfers` (lines 1005-1029) plus `test_transfer_events_older_than_365_days_are_counted_per_account` (1032-1083) and `test_the_rebuilds_own_transfer_read_is_what_the_recorder_sees` (1174-1188).

**Harness pattern:** subclass `_StubVenue` with an async `private_get_v5_account_transaction_log(self, params)` (and one method per evidence source) returning prepared raw pages, record `raw_calls`; install through `_Services(book, [bybit], window=(_TODAY - timedelta(days=729), 730))` with a custom `services.reader` that calls the venue methods then returns `_window_rows(end), False, {}`; run `assert await hp.run() == 0`, then `account = json.loads(captured.out.splitlines()[0])` and assert fields plus `"fake-transfer" not in captured.out + captured.err`. New cases (`-k` names from RESEARCH): unified recorder maps IN/OUT to deposits/withdrawals with gate unchanged; per-source count/older/bucket/state; master-only skipped as `not-master`; failure class recorded not swallowed as 0; evidence read runs after the snapshot under its own bound and a timeout is a state token; `bybit_transfers_cause` and `bybit_funding_explained` derivations (pure); redaction. Existing tests that stub `fetch_deposits`/`fetch_withdrawals` for the rebuild's read keep working because the recorder still wraps those when present.

---

## Shared Patterns

### Closed-vocabulary and redaction (probe)
**Source:** `analytics-service/scripts/allocator_history_probe.py` `emit_record` / `validate_record` / `_check_keys` (lines 492-523) and `assert_sanitized` from `analytics-service/scripts/deribit_ground_truth.py`.
**Apply to:** every new probe field. The emitter is the ONLY path to stdout; keys must equal the declared vocabulary exactly; values are counts, booleans, closed tokens, `_WINDOW_AGE_BUCKETS`, 3-significant-figure ratios. No id, amount, `userID`, `parentUid`, `fromMemberId`, or timestamp finer than the run date ever leaves the process.

### Exception handling (WR-04) and venue text
**Source:** `analytics-service/services/ccxt_flow_fetch.py` module docstring and the `except ccxt.NotSupported: return all_rows` arm; `analytics-service/scripts/bybit_upnl_probe.py` `classify_failure` (never reads the message); `funding_fetch.py` `scrub_freeform_string(str(exc))` in logs.
**Apply to:** the new fetch module, the Bybit branch edit, the probe evidence reads. Only `NotSupported` is feature detection; every other exception bubbles. Logs carry the exception CLASS and `scrub_freeform_string` text; the refusal and probe records carry only closed tokens.

### Permanent versus transient
**Source:** `analytics-service/services/job_worker.py` `classify_exception`: `(ccxt.AuthenticationError, ccxt.PermissionDenied, ccxt.BadRequest)` is permanent; the account-crawl gather loop in `equity_reconstruction.py` (around `crawl_kind = classify_exception(outcome)[0]`) turns non-permanent into `_AccountCrawlRetryableError`.
**Apply to:** the new refusal wrapper; do not invent a second tuple.

### Cursor-authoritative Bybit walk
**Source:** `exchange_pagination.walk_paginated` with `stop_on_short_page=False`, `stuck_cursor_is_stop=False`, `window_max_days=7` (funding's contract); ccxt 4.5.88 puts `nextPageCursor` on `info` of one row of every `fetch_deposits`/`fetch_withdrawals` page (`add_pagination_cursor_to_result`) and `equity_reconstruction._next_page_cursor` reads it.
**Apply to:** the new module (raw log, cursor in `result.nextPageCursor`) and the `fetch_ccxt_transfers` Bybit branch (cursor in `info`).

### Throttling
**Source:** ccxt `enableRateLimit` is on for every client (`services/exchange.py` client options `"enableRateLimit": True`); raw `private_get_*` calls are throttled by the api-table `cost`. **Apply to:** all new calls; do not add `asyncio.sleep`. `_rate_limit_sleep` in `ccxt_flow_fetch.py` stays for the ccxt `fetch_*` branch only.

### Test discipline for gates that must fail
**Source:** project rules (CLAUDE.md, memory). **Apply to:** every RED test: neuter, see RED, restore from a BYTE backup (never `git checkout`/`restore`/`stash` on uncommitted work); `pytest` only from `analytics-service/`; `grep -a`. Table of neuters is in RESEARCH Validation Architecture.

### CI gates (put in every executor brief)
- mypy, verbatim (`.github/workflows/ci.yml`, step cited by symbol: `grep -n 'mypy --strict' .github/workflows/ci.yml`), from `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`
- pytest CI form: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`
- Focused set: `pytest tests/test_ccxt_flow_fetch.py tests/test_exchange_pagination.py tests/test_bybit_unified_flows.py tests/test_allocator_history_probe.py tests/test_reconstruct_force_rebuild.py tests/test_bybit_two_year_window.py tests/test_trade_pages.py tests/test_reconstruct_whole_account.py tests/test_trade_read_resume.py -q`
- Ruff is NOT a CI gate here; do not invent a ruff step.

### CHANGELOG discipline (release commit, not a code analog)
**Source:** project CLAUDE.md "CHANGELOG discipline". **Apply to:** the ship commit `chore(release): vX.Y.Z.B` that bumps `VERSION` and `package.json` as byte-equal 4-digit strings together with one unified `CHANGELOG.md` entry (sections `### Added` / `### Changed` / `### Tests` / `### Notes`; carry the Earn limitation, the live-NAV visible change from the page fix, and the unforced-path behaviour change as `### Notes`). Never `npm version`; never write a CI skip token in any commit or PR text; ship branch changes nothing under `.planning/`; no AI attribution lines.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Per-source evidence reader for the three 30-day record endpoints and the two 7-day transfer lists (inside the probe) | utility | batch, GET only | The closest analog is `_okx_order_reading` (side measurement, own bound, class-only failure), but nothing in the codebase reads these five Bybit asset endpoints. Planner uses RESEARCH Standard Stack (method names, rows key, id and time fields) and Q6 table (windows, status filters, master-only). `status` filters are from vendor docs, not live-verified. |
| `bybit_other_transfer_like_rows` census (optional, RESEARCH Q2.3) | utility | batch, GET only | No existing multi-type log census. Build it as the same `walk_paginated` pattern as the new module with the closed type tuple; planner may cut it (about 840 calls, 6 minutes). |
| Reading of the Unified log's classic-account and direct-to-Unified behaviours | n/a | n/a | Not knowable offline (RESEARCH A3-A6, Open Question 3); the post-deploy probe is the instrument. |

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/scripts/`, `analytics-service/tests/`, `docs/runbooks/` (grep for `transaction_log`, `fetch_ccxt_transfers`, `FORCED_REBUILD_*`, `walk_paginated`, `_TradeRecorder`, `bybit_transfers_verdict`).
**Files read:** `services/ccxt_flow_fetch.py` (whole), `services/exchange_pagination.py` (whole), `services/funding_fetch.py` (Bybit section), `services/equity_reconstruction.py` (token sets, `_fetch_and_price_window`, `_next_page_cursor`, `_fetch_bybit_trades`, account-crawl refusal arms), `scripts/allocator_history_probe.py` (vocabulary, recorder, verdict, `_okx_order_reading`, `_probe_member`, `_account_record`, `_probe_account`), `scripts/bybit_upnl_probe.py` (`FAILURE_CLASSES`, `classify_failure`), `tests/_trade_pages.py` (whole), `tests/test_ccxt_flow_fetch.py` (whole), and targeted ranges of `tests/test_trade_pages.py`, `tests/test_reconstruct_force_rebuild.py`, `tests/test_bybit_two_year_window.py`, `tests/test_allocator_history_probe.py`, `tests/test_funding_fetch.py`, `tests/test_exchange_pagination.py`, and the runbook B'3 list.
**Pattern extraction date:** 2026-10-28
