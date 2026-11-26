# Phase 250: BINANCEFILLS - Pattern Map

**Mapped:** 2026-11-25
**Files analyzed:** 9 (2 production files, 2 new test files, 1 new test helper, 1 recorded-markets fixture, 3 existing test files to migrate)
**Analogs found:** 8 / 9 (the recorded-markets JSON has a role-match only)

All paths are relative to `analytics-service/` in the worktree. Every analog below was confirmed git-TRACKED (`git ls-files`): `services/exchange.py`, `services/job_worker.py`, `tests/_bybit_real_markets.py`, `tests/_okx_bills.py`, `tests/test_okxtrades_cursor.py`, `tests/test_okxtrades_walk.py`, `tests/test_exchange.py`, `tests/test_ana_recon_audit.py`. Line numbers are at worktree HEAD and WILL move; plans must cite write scope BY SYMBOL (222 ALERTTRUTH shares `run_sync_trades_job`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `services/exchange.py` constants block (`BINANCE_FILLS_*`, lifted `BINANCE_PAGE_CAP`, deadline) | config | n/a | `services/exchange.py` L142-216 (`OKX_BILLS_PAGE_CAP`, `OKX_BILLS_WINDOW_DAYS`, `OKX_BILLS_REACH_DAYS`, `_monotonic`, `_now_ms`) | exact |
| `services/exchange.py::_fetch_raw_trades_binance` (window walk, reach clamp, BadSymbol class, cap/deadline stop, markets load) | service | batch / request-response (paged venue read) | `services/exchange.py::fetch_daily_pnl` OKX branch L1768-1846 + `_okx_bills_window_read` L1642-1726 | role-match (same walk shape; Binance is per-symbol, OKX is window-major) |
| `services/job_worker.py::run_sync_trades_job` cursor-gate block (`_fills_incomplete`, `advance_fetched_cursor`, `_p_last_fetched`) | service (handler epilogue) | CRUD (cursor write via RPC) | same block, L2714-2752 (extend in place) | exact (self) |
| `services/job_worker.py` `_RAW_TRADE_INGESTION_ENABLED` comment (SC-4) | config | n/a | same declaration, L327-333 | exact (self) |
| `tests/_binance_fills.py` (NEW helper: real `ccxt.binance` + `BinanceFillsVenue`) | test helper | request-response (venue fake) | `tests/_bybit_real_markets.py` (real ccxt + recorded markets + `AsyncMock(side_effect=book.entry)` wiring) and `tests/_okx_bills.py::OkxBillsArchive` (venue rules, `calls`, switches) | exact (two halves of one analog pair) |
| recorded markets JSON fixture (NEW, e.g. `tests/cassettes/binance/markets.json`) | test fixture | file-I/O (read once, cached) | `tests/_bybit_real_markets.py::_instruments_by_category` (L56-71, `lru_cache` over a recorded cassette) | role-match |
| `tests/test_binancefills_walk.py` (NEW: SC-1, SC-2, SC-3 producer, reach, deadline, markets) | test | request-response | `tests/test_okxtrades_walk.py` | exact |
| `tests/test_binancefills_cursor.py` (NEW: gate arms through REAL `run_sync_trades_job`) | test | CRUD (RPC params) | `tests/test_okxtrades_cursor.py` (reuse `_make_supabase`, `_run_job`, `_the_advance`, `_fill`) | exact |
| `tests/test_exchange.py` (14 Binance fakes to migrate) and `tests/test_ana_recon_audit.py::test_c13_03_binance_cursor_advances_without_plus_one` | test (edit) | request-response | `test_binance_pagination_hits_page_cap` (test_exchange.py L2893) is the shape being migrated | exact (self) |

## Pattern Assignments

### `services/exchange.py` constants block (config)

**Analog:** `services/exchange.py` L150-216 (the OKX/Bybit constants block).

**Pattern: plain module-level values, NOT `Final`, so a test lowers them by `monkeypatch.setattr`; every walk reads them at call time; a dated `#:` comment gives the sizing derivation** (L150-163):
```python
OKX_BILLS_PAGE_CAP: int = 100
OKX_ARCHIVE_PAGE_CAP: int = 100
#: Phase 232 VREAD-07: the OKX bills read walks UTC-day-aligned windows of this many days, oldest
#: first, and the two caps above are per (window, instType, endpoint). ...
OKX_BILLS_WINDOW_DAYS: int = 7
#: How far back the OKX walk starts when it has no (or an older) start. Longer than any calendar
#: three months (92 days at most), the archive's documented reach, so a cron tick never spends its
#: deadline on windows that can only be empty.
OKX_BILLS_REACH_DAYS: int = 93
```

**Clock and deadline seams to REUSE, not re-create** (L206-216):
```python
#: Indirection so a test can pass the deadline without sleeping.
_monotonic: Callable[[], float] = time.monotonic

def _wall_clock_ms() -> int:
    """Wall-clock epoch milliseconds."""
    return int(time.time() * 1000)

#: Indirection so a test pins "now" for the OKX window walk (no fixture straddles UTC midnight).
_now_ms: Callable[[], int] = _wall_clock_ms
```
New names (RESEARCH Q2): `BINANCE_FILLS_WINDOW_DAYS=7`, `BINANCE_SPOT_FILLS_WINDOW_HOURS=24`, `BINANCE_FILLS_REACH_DAYS=85`, `BINANCE_PAGE_CAP=20` (lifted from the local in `_fetch_one`, per WINDOW), `BINANCE_FILLS_PAGE_LIMIT=1000`, `BINANCE_FILLS_READ_DEADLINE_S=240.0`. Place beside the existing block or beside `OVERLAP_WINDOW_MS` (L686). Note `_now_ms`/`_monotonic` are module attributes read at call time: tests patch `ex._now_ms`, so the walk must call `_now_ms()` (not a captured import).

---

### `services/exchange.py::_fetch_raw_trades_binance` (service, paged venue read)

**Analogs:** the OKX walk in `fetch_daily_pnl` (L1768-1846) for window arithmetic, reach clamp, deadline/cap stop and flag recording; `_okx_bills_window_read` (L1642-1726) for the per-window page loop with a named self-check; the function's OWN current body (L2483-2723) for everything that stays.

**Reach clamp + window start pattern** (L1781-1795, adapt: Binance uses since-aligned windows, NOT UTC-day floor, and records a NON-holding flag instead of only `logger.info`):
```python
_okx_day_ms = 86_400_000
_okx_now_ms = _now_ms()
_okx_window_ms = OKX_BILLS_WINDOW_DAYS * _okx_day_ms
_okx_reach_ms = _okx_now_ms - OKX_BILLS_REACH_DAYS * _okx_day_ms
_okx_start_raw = _okx_reach_ms
if since_ms:
    if since_ms >= _okx_reach_ms:
        _okx_start_raw = since_ms
    else:
        logger.info("OKX: since_ms is %d days older than the %d-day bills reach; the walk starts at the reach", ...)
```
Binance difference: `since_ms is None` also starts at the reach (never a start-less request); `since_ms < reach` calls `_record_dq_flag("binance_fills_reach_clamped", True)`.

**Window loop pattern, oldest first, next window starts at the previous end** (L1802-1846):
```python
while _okx_window_start < _okx_now_ms:
    _okx_window_end = min(_okx_window_start + _okx_window_ms, _okx_now_ms)
    ...
    if _okx_outcome != "complete":
        if _okx_outcome == "deadline":
            logger.warning("OKX: read deadline (%.0fs) passed in window %s (%s) — ...", ...)
            _record_dq_flag("daily_pnl_deadline_okx", True)
        else:
            logger.warning("OKX: bills page cap hit in window %s (%s) — ...", ...)
            _record_dq_flag("daily_pnl_truncated_okx", True)
        break
    all_bills.extend(_okx_window_bills)
    _okx_window_start = _okx_window_end
```
Binance difference (locked by CONTEXT/RESEARCH): the loop lives inside the per-symbol `_fetch_one`; `window_end = min(window_start + window_ms - 1, read_now)` (span `7d - 1 ms`, `24h - 1 ms` for a spot market), `window_start = window_end` (1 ms overlap, absorbed by the unique index); `read_now = _now_ms()` taken ONCE outside `_fetch_one`. Cap and deadline stops are NON-holding and return the rows read plus a "read-through" bound.

**Deadline check position pattern** (`_okx_bills_window_read` L1669-1671; the Binance version checks inside `async with sem:` immediately before the network call, RESEARCH Q4):
```python
for page in range(page_cap):
    if _monotonic() >= read_deadline:
        return kept, "deadline"
```

**Named per-window self-check pattern (optional `BinanceFillsOutOfWindow`, RESEARCH OQ3)** (L1709-1719):
```python
ts_raw = row.get("ts", "")
if isinstance(ts_raw, str) and ts_raw.isdigit():
    ts = int(ts_raw)
    if ts < start_ms - 1 or ts > end_ms:
        logger.warning("OKX bills %s: a bill lies outside the requested window %s..%s — refusing the read", ...)
        raise OkxBillsWindowIncomplete("out_of_window")
```

**Per-symbol pagination to KEEP inside the nested function** (current L2597-2649). Keep the literal `next_since == current_since` and the `binance_fill_cursor_advance_plus1` flag, because `test_c13_03_binance_cursor_advances_without_plus_one` greps `inspect.getsource(_fetch_raw_trades_binance)` (RESEARCH Pitfall 2) and the `int(last_ts) + 1` form must stay absent:
```python
next_since = int(last_ts)
if next_since == current_since:
    _record_dq_flag("binance_fill_cursor_advance_plus1", True)
    logger.warning("Binance fetch_my_trades %s: cursor stuck at same-ms (last_ts=%d == current_since) on a full page — advancing +1ms ...", symbol, next_since)
    next_since = current_since + 1
current_since = next_since
```
Also keep: the `async with sem:` held only across the network call (L2598-2604), the "no usable timestamp" stop (L2610-2619), and the page-cap WARNING text containing the symbol and `page cap` (L2651-2655; `test_binance_pagination_hits_page_cap` asserts it).

**Request change** (L2602-2604 to RESEARCH Pattern 1):
```python
async with sem:
    batch = await exchange.fetch_my_trades(
        ccxt_symbol, since=current_since, limit=BINANCE_FILLS_PAGE_LIMIT, params={"until": window_end}
    )
```

**Reverse map: keep the strip expression identical to `normalize_symbol`; add `load_markets()` when empty and explicit derivative-over-spot precedence** (current L2571-2582):
```python
ccxt_symbol_by_normalized: dict[str, str] = {}
if hasattr(exchange, "markets") and exchange.markets:
    for mkt_symbol in exchange.markets:
        normalized = (mkt_symbol.replace("/", "").replace(":USDT", "").replace(":USD", ""))
        ccxt_symbol_by_normalized[normalized] = mkt_symbol
```
Insert before it `if not exchange.markets: await exchange.load_markets()` (test doubles use `markets = {}` + `AsyncMock`, so the call is harmless; if still empty keep the raw passthrough). With markets loaded and a name unmapped, raise `ccxt.BadSymbol` locally (RESEARCH Q1).

**Result classification + flag recording to extend** (current L2679-2721). Add the `ccxt.BadSymbol` branch AFTER the unchanged `CancelledError` scan (L2671-2674) and BEFORE the generic `failed_symbols.append`:
```python
for idx, item in enumerate(results):
    if isinstance(item, BaseException):
        symbol = symbols[idx] if idx < len(symbols) else "<unknown>"
        failed_symbols.append(symbol)          # NEW: isinstance(item, ccxt.BadSymbol) -> unlisted.append(symbol); continue
        if first_error is None:
            first_error = item
        logger.warning("Binance fetch_my_trades failed for %s: %s", symbol, str(item))
        continue
...
_record_dq_flag("binance_partial_symbols", list(failed_symbols))
if len(failed_symbols) == len(symbols) and first_error is not None:   # NEW: len(failed)+len(unlisted) == len(symbols) (Pitfall 3)
    raise BinancePerSymbolFetchError(failed_symbols, first_error)
```
The `per-symbol "Binance fetch_my_trades failed for"` log shape is load-bearing for log queries; the existing line logs `str(item)` unscrubbed, so any NEW log must use `scrub_freeform_string(str(e))` (pattern at L2546-2550, L1686-1690).

**`_record_dq_flag` semantics that dictate the flag shapes** (L286-318): lists dedup and cap at `_DQ_LIST_MERGE_CAP=64`; booleans OR; two ints SUM; others overwrite. So `binance_read_through_ms` must be computed as `min(...)` after the gather and recorded exactly ONCE (RESEARCH Pitfall 7).

---

### `services/job_worker.py::run_sync_trades_job` cursor gate (service epilogue, RPC write)

**Analog:** the block itself, L2714-2752 (read this session). Extend in place; do NOT touch `_fills_incomplete`'s holding keys (new keys must never match `sync_truncated_` or `binance_partial_symbols`).

**Existing gate to keep** (L2714-2741):
```python
_fills_incomplete = any(
    (key.startswith("sync_truncated_") or key == "binance_partial_symbols")
    and value
    for key, value in exchange_dq_flags.items()
)
advance_fetched_cursor = (
    bool(raw_fills) and phase2_complete and not phase2_failed
    and not phase1_failed and not _fills_incomplete
)
_p_last_fetched: str | None = None
if advance_fetched_cursor:
    try:
        _p_last_fetched = max(
            coerce_to_aware_utc(fill["timestamp"], "sync_trades") for fill in raw_fills
        ).isoformat()
    except (KeyError, ValueError, TypeError, OverflowError, OSError) as exc:
        logger.warning("sync_trades Phase 2: holding fetched-cursor for strategy %s — a persisted fill has no usable timestamp (%s)", strategy_id, type(exc).__name__)
        _p_last_fetched = None
elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not None:
    _p_last_fetched = fills_anchor_iso
```
**Change:** under `if advance_fetched_cursor`, when `exchange_dq_flags.get("binance_read_through_ms")` is an int (not bool), filter the stamps to `<= _EPOCH + timedelta(milliseconds=bound)` before `max`; add a trailing anchor line for a stop with nothing stampable on a NULL column (`not phase2_failed and not _fills_incomplete and fills_anchor_iso is not None`). See RESEARCH "Pattern 2" skeleton; never use `ms / 1000` floats.

**SC-4 comment target** (L327-333): add the precondition text to the "M-0673" comment above the `Final[bool]` declaration (name Phase 250, SC-1..3, Binance; say it is one of several venue conditions). No test reads prose.

**Seed path that makes the cursor itself the resume point (read-only context, do not edit)** (L2252-2268): `fills_since_ms = min(_fills_cursor_ms, _seed_bound_ms)`; `fetch_raw_trades` then subtracts `OVERLAP_WINDOW_MS` (exchange.py L2449-2452).

---

### `tests/_binance_fills.py` (NEW test helper; real ccxt + venue fake)

**Analogs:** `tests/_bybit_real_markets.py` (how to build a real ccxt instance offline) and `tests/_okx_bills.py::OkxBillsArchive` (how to model venue rules with switches and a `calls` log). Module docstring convention: "A helper module, never collected as tests (no `test_` functions)", states what the fake models and which rules are documented vs UNMEASURED.

**Real ccxt instance with recorded markets** (`_bybit_real_markets.py` L117-136):
```python
ex = ccxt_async.bybit({})
ex.set_markets(copy.deepcopy(_MARKETS))
ex.fetch = AsyncMock(side_effect=AssertionError("a test reached the network through ccxt"))
return ex
```
Adapt: `ccxt_async.binance({"enableRateLimit": False})`, `ex.set_markets(...)` from the recorded JSON, `ex.milliseconds = lambda: NOW_MS`, and keep the network-raising `ex.fetch` guard. To model "markets not loaded" leave `ex.markets = None`, replace `ex.fetch_markets` with a coroutine returning the recorded list and `ex.fetch_currencies` with one returning `{}` so the real `load_markets()` runs.

**Method wiring: replace the HTTP-method layer, not `fetch_my_trades`** (`_bybit_real_markets.py` L192-196):
```python
exchange.privateGetV5PositionList = AsyncMock(side_effect=book.ccxt_entry)
exchange.private_get_v5_position_list = AsyncMock(side_effect=book.raw_entry)
```
Adapt: `ex.fapiPrivateGetUserTrades`, `ex.dapiPrivateGetUserTrades`, `ex.privateGetMyTrades` each `AsyncMock(side_effect=venue)`; record which endpoint answered (spot vs linear) so the markets-unloaded arm can assert `linear_endpoint_calls=1 spot_endpoint_calls=0`.

**Venue rules + `calls` log + switches pattern** (`_okx_bills.py` L227-298): async callable taking the request dict, `self.calls.append(dict(params))`, `self.effect` raised on every call when set, filters applied as the venue does, `sorted(...)` then `rows[:limit]`, and keyword-only default-off switches (`oldest_first`, `reach_floor_ms`, ...):
```python
async def __call__(self, params):
    self.calls.append(dict(params))
    if self.effect is not None:
        raise self.effect
    ...
    if "begin" in params:
        rows = [r for r in rows if int(r["ts"]) >= int(params["begin"])]
    ...
    return {"code": "0", "data": [dict(r) for r in rows[:limit]]}
```
Adapt (RESEARCH Q6): no `startTime` and no `endTime` serves `[now-7d, now]`; both sent and span > window (7d linear/inverse, 24h spot) raises `ccxt.BadRequest`; `startTime` older than reach raises `ccxt.BadRequest` (strict; switch to return `[]`); rows sorted `(time, id)` ascending (switch `newest_first`); at most `min(limit, 1000)`, default 500; `endTime` inclusive (switch exclusive). Rows are RAW venue shapes (string numbers, `time` in ms) so ccxt's `market()`, `until`, implicit linear cap and `parse_trades` run unchanged. The fake must NOT be a function that returns everything after `since` (forbidden by CONTEXT: it would go GREEN on today's code).

**Recorded markets fixture (no tracked analog for a Binance JSON; role-match = `_instruments_by_category` L56-71):**
```python
@functools.lru_cache(maxsize=1)
def _instruments_by_category() -> dict[str, dict[str, Any]]:
    doc = yaml.load(CASSETTE.read_text(), Loader=yaml.CSafeLoader)
    ...
```
Copy the `lru_cache` read-once idiom and the "assert the recording holds what the test needs" line (`assert set(out) == {...}`). Record once from a public `load_markets()` the six unified markets: `BTC/USDT`, `BTC/USDT:USDT`, `BTC/USDC`, `BTC/USDC:USDC`, `BTC/USD:BTC`, `BTC/USDT:USDT-261225`. Existing cassettes live under `tests/cassettes/<venue>/`.

---

### `tests/test_binancefills_walk.py` (NEW test, exchange-level gates)

**Analog:** `tests/test_okxtrades_walk.py` (read L1-135 and L200-240).

**Docstring convention:** WHY paragraph, "Every test drives the REAL ... against <venue-faithful fake>", instants as typed epoch-ms literals beside a pinned `NOW_MS` (none computed by the code under test), then a `PROOF-01. NEUTER` list `- N1 ...: <test name> goes RED` restored from a byte backup with `cp` and checked with `cmp`. Use the N1-N17 table in RESEARCH "Phase Requirements -> Test Map" verbatim as the neuter list.

**Pinned clock fixture** (L115-118):
```python
@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # raising=False: the same fixture runs on code that predates the ``_now_ms`` seam.
    monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS, raising=False)
```

**Read helper that clears and returns the DQ buffer** (L121-124):
```python
async def _read(exchange, since_ms, **kwargs):
    ex.get_and_clear_last_dq_flags()
    rows = await fetch_daily_pnl(exchange, since_ms, **kwargs)
    return rows, ex.get_and_clear_last_dq_flags()
```
Adapt to `fetch_raw_trades(exchange, STRATEGY_ID, supabase, since_ms=...)` (it resets the buffer at entry), with a fake supabase whose `trades`/`position_snapshots` select returns the symbol list (see the symbol-discovery `paginated_select` calls at exchange.py L2497-2518; existing `test_exchange.py` Binance tests show how they stub it).

**Cap and deadline arms by monkeypatch** (L137-138, L203-211, L221-223):
```python
monkeypatch.setattr(ex, "OKX_BILLS_PAGE_CAP", 3)
monkeypatch.setattr(ex, "_monotonic", lambda: 0.0 if len(log) < 13 else 1e12)   # deadline passes after N requests
...
assert len(log) == 13, "no request may be issued after the deadline"
```
Adapt: `monkeypatch.setattr(ex, "BINANCE_PAGE_CAP", 2)`, `BINANCE_FILLS_READ_DEADLINE_S`, and assert request count from the venue fake's `calls`, e.g. "no request after the deadline" and "no window after the capped one is requested".

---

### `tests/test_binancefills_cursor.py` (NEW test, gate through the REAL `run_sync_trades_job`)

**Analog:** `tests/test_okxtrades_cursor.py` (760 lines; read L1-420 and L640-760). IMPORT or copy its harness, do not re-invent it: `_make_supabase` (L84-239; applies every `.eq/.order/.limit`, records upserts, advance RPC params, analytics upserts; `flags=` dict shared across two runs), `_run_job` (L249-317), `_the_advance` (L320-324), `_fill` (L69-81).

**Driving the gate with a flag dict** (`_run_job` L261-263 and L297-309): `fills_flags` is what the fills read's DQ drain returns; patched via `get_and_clear_last_dq_flags` with `itertools.chain([{}, second], itertools.repeat({}))` (call 1 = daily drain, call 2 = fills drain). The new arms pass `fills_flags={"binance_read_through_ms": <ms>, "binance_page_cap_symbols": ["BTCUSDT"]}` and assert the RPC param.

**Refuse-then-clean two-run arm (copy this shape for SC-2 transient hold and SC-3 resume)** (L667-715):
```python
shared_flags: dict[str, Any] = {}
supabase1, rec1 = _make_supabase(trades_rows=DEFAULT_TRADES, flags=shared_flags)
out1 = await _run_job(supabase=supabase1, column=CURSOR_BEHIND_TS,
    raw_fills=[_fill("fill-btc", NEWEST_FILL_TS)],
    fills_flags={"binance_partial_symbols": ["ETHUSDT"]})
stamped = _the_advance(rec1)["p_last_fetched_ts"]
assert stamped is None, "a partial-symbol fills read must hold the fills cursor (CR-02)"
supabase2, rec2 = _make_supabase(trades_rows=DEFAULT_TRADES, flags=shared_flags)
out2 = await _run_job(supabase=supabase2, column=stamped or CURSOR_BEHIND_TS, raw_fills=[...])
assert out2.fetch_raw.call_args.kwargs["since_ms"] == CURSOR_BEHIND_MS
assert _the_advance(rec2)["p_last_fetched_ts"] == NEWEST_FILL_TS   # control: the hold above was the flag's
```
Note the harness builds its mock key row with `"exchange": "okx"` (L228); the cursor gate is venue-agnostic, so keep it unless a gate arm needs `binance`. Its fill helper also hardcodes `exchange: "okx"`/`symbol: BTC-USDT-SWAP`; a Binance arm can copy `_fill` with a `BTCUSDT` symbol. Bootstrap anchor arms (L640-760) are the pattern for "NULL column + stop + nothing stampable anchors at `fills_anchor_iso`, also with empty `raw_fills`" (N12); assert `DAILY_NEWEST_DAY_START_ISO`.

Ordering rule to assert (Pitfall 6): a hold flag in the same dict as `binance_read_through_ms` still wins (N11).

---

### `tests/test_exchange.py` + `tests/test_ana_recon_audit.py` (migration of 14 existing tests)

**Analog (shape being migrated):** `test_exchange.py::test_binance_pagination_hits_page_cap` (L2893-2933):
```python
async def _fetch_my_trades(symbol, since=None, limit=None):     # hand fake: breaks once the walk passes params=
    call_count["n"] += 1
    return [{**row, "timestamp": row["timestamp"] + call_count["n"] * 1_000_000} for row in full_page]
mock_exchange = AsyncMock()
mock_exchange.id = "binance"
mock_exchange.markets = {}
mock_exchange.fetch_my_trades = _fetch_my_trades
```
Migration rules (RESEARCH Q6): (a) 8 hand fakes with signature `(symbol, since=None, limit=None)` must accept `params=None` or the walk's `params=` raises `TypeError` and every symbol "fails" (the "always fails" test would pass for the wrong reason); (b) 5 `AsyncMock(return_value=...)` tests pass `since_ms=None`, so the seed becomes `read_now - 85d` and canned rows repeat per window: pin `since_ms` and/or `_now_ms` and give the fake window-aware rows; (c) `markets = {}` stays falsy, so `load_markets()` is called on an `AsyncMock` (harmless) and the raw passthrough is kept; (d) keep the cap at 20 per window and the `page cap` log text, or update `test_binance_pagination_hits_page_cap` in the same plan. Phase 1 tests that use `fetch_my_trades` for the BTC/USDT spot fallback (test_exchange.py 3839-3999, `test_exchange_harness.py:448,1124-1140`) are NOT touched.

**`test_ana_recon_audit.py` L648-662 (source inspection):** must still find `cursor_stuck` or `next_since == current_since` in `inspect.getsource(exchange._fetch_raw_trades_binance)` and no `int(last_ts) + 1`. Either keep the pagination in the nested function, or replace the test in the same plan with a behavioural pin (venue fake with >= 1000 rows on one millisecond).

---

## Shared Patterns

### DQ flag buffer (producer and drain)
**Source:** `services/exchange.py::_record_dq_flag` L286-318 and `fetch_raw_trades` entry reset (`_LAST_DQ_FLAGS.set({})`, also at `fetch_daily_pnl` L1761).
**Apply to:** every new flag in `_fetch_raw_trades_binance`.
Rules: lists dedup + cap 64; bool OR; int SUM (record `binance_read_through_ms` once as a `min`); other types overwrite. New list flags: `binance_unlisted_symbols`, `binance_page_cap_symbols`, `binance_deadline_symbols`; scalar `binance_read_through_ms`; bool `binance_fills_reach_clamped`. None may start with `sync_truncated_` or equal `binance_partial_symbols`.

### Scrubbed logging of venue exception text
**Source:** `services/exchange.py` L2546-2550 and L1686-1690.
**Apply to:** any NEW log line that includes an exception message.
```python
logger.warning("...: exc_class=%s scrubbed=%s", type(e).__name__, scrub_freeform_string(str(e)))
```

### Test-lowerable constants and clock seams
**Source:** `services/exchange.py` L150-216; consumed by `tests/test_okxtrades_walk.py` L116-118, L137-138, L209.
**Apply to:** walk constants, deadline, `read_now`.

### PROOF-01 neuter discipline
**Source:** module docstrings of `tests/test_okxtrades_walk.py` and `tests/test_okxtrades_cursor.py` ("NEUTER (each recorded in the SUMMARY, restored from a byte backup)").
**Apply to:** both new test files and the plan SUMMARYs: `cp` the file aside, neuter, run, see the named arm RED, `cp` back, `cmp`, GREEN, record verbatim. Never `git checkout/restore/stash` on uncommitted work.

### mypy strict surface
**Source:** RESEARCH Q9 (`ci.yml` mypy command; `src/__tests__/contracts/ci-mypy-strict-surface.contract.test.ts`).
**Apply to:** all production edits. Keep new production code inside `services/exchange.py` / `services/job_worker.py` (or a new file under `services/`); a new top-level module widens the CI surface and turns the contract test RED. Tests under `tests/` are excluded and untyped.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| a per-SYMBOL (not window-major) resumable walk with a min-over-symbols read-through bound | service | batch | The OKX walk is window-major and drops a stopped window entirely; Bybit walks are per-window. Nothing in the repo returns a partial per-symbol prefix plus a scalar bound. Use RESEARCH "Walk skeleton" and "Pattern 2". |
| Binance recorded-markets JSON | test fixture | file-I/O | No Binance cassette exists under `tests/cassettes/`; copy the Bybit `lru_cache` read-once idiom and record once from public `load_markets()`. |
| gate arithmetic bounding the stamp by a flag scalar | service | CRUD | The current gate has only boolean holds; the `<= bound` filter is new (RESEARCH Pattern 2 skeleton). |

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/tests/` (`_*` helpers, `test_okxtrades_*`, `test_exchange.py`, `test_ana_recon_audit.py`, `cassettes/`).
**Files read:** exchange.py (L140-320, 1636-1865, 2426-2452, 2483-2723, 755-775), job_worker.py (L322-335, 2252-2275, 2690-2756), `_bybit_real_markets.py`, `_okx_bills.py`, `test_okxtrades_cursor.py`, `test_okxtrades_walk.py`, the Binance excerpts of `test_exchange.py` and `test_ana_recon_audit.py`.
**Tracked-source gate (#3645):** all named analogs verified with `git ls-files`; no gitignored mirror paths emitted.
**Pattern extraction date:** 2026-11-25
