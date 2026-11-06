# Phase 184: WALLETOFFSET - Pattern Map

**Mapped:** 2026-11-01
**Files analyzed:** 4 (2 new, 1 additive edit, 1 new local fake inside the test file) plus the temporary worker start-command wrapper (an operator artifact, not a repo file)
**Analogs found:** 4 / 4 (the Bybit closed-pnl fake has a partial analog only)

All paths are under `analytics-service/` unless written in full. Every analog named below was checked with `git ls-files` and is git-TRACKED source (no gitignored mirror paths). Line numbers were measured in this worktree on 2026-11-01; `plan-anchor-verify` re-resolves `file:line` anchors, so cite the SYMBOL in plans and treat the numbers as hints.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/walletoffset_probe.py` (new) | read-only operational probe (script) | batch, request-response (select + venue GETs, one JSON line per key) | `scripts/allocator_history_probe.py` (emitter, read-only handle, `_probe_member`, `run`, `main`) and `scripts/bybit_upnl_probe.py` (per-key `k1..kN` labels, `run`) | exact (role + flow) |
| `tests/test_walletoffset_probe.py` (new) | test | request-response on fakes | `tests/test_allocator_history_probe.py` (fakes, read-only pins, redaction needles) and `tests/test_okx_opening_balance.py` (walker tests) | exact |
| `tests/_okx_bills.py` (additive edit) | test helper (venue fake) | request-response | itself: its own Phase 179 additive-and-default-off precedent (module docstring lines 17-28, `okx_bill` lines 37-65) | exact |
| Bybit closed-pnl fake (new, local to the test file; or a small helper beside `_bybit_evidence.py`) | test helper (venue fake) | request-response, cursor-paged | `tests/_bybit_evidence.py` `EvidenceBook` (transaction-log half only; it has NO closed-pnl endpoint) | partial |
| Temporary worker start-command wrapper (operator step in plan 02, `autonomous: false`) | ops procedure | batch | `.planning/phases/180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s/180-08-PLAN.md` Task 1, steps 1-6 | exact |

The pure-arithmetic layer (`window_ms`, `in_window`, `offset_terms`, the OKX bill sum, the Bybit closed-pnl row formula) lives INSIDE `scripts/walletoffset_probe.py`, as in every probe, so it is not a separate file. `scripts/` is outside the mypy gate and outside `--cov=services` (RESEARCH, CI mypy section); do not extract a helper into `services/` unless a shared fix needs it.

## Pattern Assignments

### `scripts/walletoffset_probe.py` (probe, batch / request-response)

**Primary analog:** `scripts/allocator_history_probe.py` (2240 lines). **Secondary analog:** `scripts/bybit_upnl_probe.py` for the per-key `k1..kN` label loop and the `failed_record` shape.

**Module docstring shape** (`allocator_history_probe.py` lines 1-154). Copy the section skeleton: a phase/decision header, `WHAT IT DOES`, `REDACTION CONTRACT` (lines 91-99), `READ-ONLY` (lines 101-114), `USAGE` (lines 134-140: run once on the Railway backfill worker through a temporary start-command change, "Railway's remote shell is broken", paste only the lines that start with `{"`), and `EXIT CODES` (lines 142-153). Add the two RESEARCH-mandated statements: which terms the script summed (OKX `pnl + fee` and funding `type == "8"`; Bybit closed-pnl ex-funding plus `SETTLEMENT`), and the Bybit fee-timing note (closed-pnl books `openFee` at close; Pitfall 3).

**Imports pattern** (`allocator_history_probe.py` lines 156-177):
```python
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import re
import sys
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from scripts.bybit_upnl_probe import FAILURE_CLASSES, FIELD_ABSENT, classify_failure, sig3
from scripts.deribit_ground_truth import assert_sanitized
from services.allocator_equity_derive import working_holder_predicate
from services.closed_sets import STABLECOINS
```
Heavy worker imports (`decrypt_credentials`, `aclose_exchange`, `_make_exchange_client`, `db_execute`, `get_supabase`, `rows`, `get_kek`) are imported INSIDE `_probe_member` / `run` (lines 1705-1707, 2178-2179), not at module top. Keep that, so `import scripts.walletoffset_probe` and the offline tests never touch the worker environment. The walletoffset script additionally needs `services.nav_marks.read_key_marks` / `StoredMark` (`services/nav_marks.py:467`, `:192`), `services.okx_opening_balance` constants (`BILLS_ARCHIVE_PAGE_ROWS` line 106, `BILLS_ARCHIVE_PAGE_CEILING` line 111, `_BILLS_METHOD` line 136), `services.okx_bills_chain.BudgetedExchange` / `CHAIN_CALL_CEILING` (lines 40-65), `services.exchange._okx_bills_fetch_with_backoff` (line 1378), `services.funding_fetch.fetch_funding_bybit` (line 624), `services.ccxt_flow_fetch.fetch_ccxt_transfers` (line 161) and `services.ccxt_flows.ccxt_rows_to_dated_flows` (line 164).

**Shared redaction vocabulary** (`scripts/bybit_upnl_probe.py` lines 90-110, 166-170, 487-510): reuse, do not redefine.
```python
FIELD_ABSENT = "field-absent"
FAILURE_CLASSES: tuple[str, ...] = (
    "none", "AuthenticationError", "PermissionDenied", "RateLimitExceeded", "RequestTimeout",
    "NetworkError", "BadRequest", "ExchangeError", "EmptyResponse", "Timeout", "other",
)
def sig3(x: float) -> float | str:
    """Round to three significant figures; a non-finite value reads ``non-finite``."""
    if not math.isfinite(x):
        return "non-finite"
    return float(f"{x:.3g}")
def classify_failure(exc: BaseException) -> str:
    """The allow-listed class of a failed read. NEVER reads the message ..."""
```
`allocator_history_probe.py` line 181 extends the shared tuple for its own extra class (`_FAILURE_CLASSES = (*FAILURE_CLASSES, "truncated")`); do the same for any walletoffset-only class, and keep the unmeasurable-reason vocabulary (`no_mark`, `key_not_working`, `window_outside_retention`, `reach_unproven`, `page_ceiling`, `unpriced_flow`, `nav_nonpositive`, `reader_not_built`, `timeout`, `other`) as a separate closed tuple, like `_REFUSAL_TOKENS` (line 209).

**Whitelist emitter, the ONLY path to stdout** (`allocator_history_probe.py` lines 436-467, 576-607). Copy verbatim and swap the key tuples / validator dicts:
```python
def _is_sig3_float(x: Any) -> bool:
    return isinstance(x, float) and math.isfinite(x) and float(f"{x:.3g}") == x

def _is_ratio(x: Any) -> bool:
    if isinstance(x, str):
        return x == FIELD_ABSENT
    return _is_sig3_float(x)

def _is_str_matching(pattern: re.Pattern[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and pattern.match(x) is not None

def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed

def _check_keys(path: str, got: Mapping[str, Any], want: Sequence[str]) -> None:
    extra = sorted(set(got) - set(want))
    missing = sorted(set(want) - set(got))
    if extra or missing:
        raise ValueError(f"{path}: keys differ from the whitelist extra={extra} missing={missing}")

def validate_record(record: Mapping[str, Any]) -> None:
    ...                         # kind -> (want, validators); per-key check; then:
    assert_sanitized(dict(record))

def emit_record(record: Mapping[str, Any]) -> str:
    """The ONLY path to stdout: validate, then serialize one compact JSON line."""
    validate_record(record)
    return json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False)
```
Declare `KEY_RECORD_KEYS` / `SUMMARY_RECORD_KEYS` tuples and `_KEY_VALIDATORS` / `_SUMMARY_VALIDATORS` dicts the way lines 328-430 and 470-573 do (record kind validator `_is_one_of(("key",))`, label `^k[0-9]{1,2}$` as `bybit_upnl_probe.py` `_LABEL_RE` does, date `^20[0-9]{2}-[0-9]{2}-[0-9]{2}$`). The validator error message names the PATH, never the value (docstring lines 586-587). "Not measured" is `field-absent`, never 0 (comment at line 535). Record fields: see RESEARCH "Pattern 1" for the suggested key list (`pnl_ratio`, `flow_ratio`, `offset_ratio`, `offset_over_wallet_ratio`, counts, `measured`, `unmeasurable_reason`, `partial`, `shares_account`).

**Read-only database handle** (`allocator_history_probe.py` lines 615-643). Import it rather than copy it if the walletoffset script may depend on the other probe (RESEARCH "Standard Stack" lists `scripts.allocator_history_probe.ReadOnlySupabase` as reused); the tests then pin `ReadOnlySupabase(get_supabase())` once:
```python
class _ReadOnlyTable:
    def __init__(self, inner: Any) -> None: self._inner = inner
    def select(self, *args: Any, **kwargs: Any) -> Any:
        return self._inner.select(*args, **kwargs)
    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)

class ReadOnlySupabase:
    def __init__(self, inner: Any) -> None: self._inner = inner
    def table(self, name: str) -> _ReadOnlyTable:
        return _ReadOnlyTable(self._inner.table(name))
    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)
```
`read_key_marks(supabase, api_key_id)` (`services/nav_marks.py:467-494`) only calls `.table(MARKS_TABLE).select(...).eq().gt().order().limit().execute()`, all reachable through this handle; the first element is the key's first mark. `StoredMark.marked_at` is a `str` (`nav_marks.py:192-202`): parse to an aware datetime before `window_ms`. `mark_day_for` (`nav_marks.py:205-213`) is the label rule (UTC date of `marked_at` minus one day); compute `B` from `marked_at` itself, not `mark_day`.

**Run loop: select, refuse before decrypt, per-key measurement** (`allocator_history_probe.py` `run()` lines 2175-2223 and `bybit_upnl_probe.py` `run()` lines 630-689):
```python
supabase = ReadOnlySupabase(get_supabase())

def _load_keys() -> Any:
    return (
        supabase.table("api_keys")
        .select("*")
        .in_("exchange", list(_PROBE_VENUES))
        .eq("is_active", True)          # walletoffset: drop this filter; report non-working keys as unmeasurable
        .order("created_at")
        .execute()
    )

key_rows = rows(await db_execute(_load_keys))
...
kek = get_kek()
for index, key_row in enumerate(key_rows, start=1):
    label = f"k{index}"
    ...
    print(emit_record(record), flush=True)
print(emit_record(summarize(records, run_date)), flush=True)
```
Differences the planner must apply: RESEARCH says a non-working key is reported `unmeasurable: key_not_working` BEFORE any decrypt via `working_holder_predicate` (`services/allocator_equity_derive.py:361-381`, uses `is_active`, `disconnected_at`, `sync_status` in `NOT_WORKING_SYNC_STATUSES`), so do not pre-filter on `is_active` the way the two analogs do; the probe selects `exchange in (okx, bybit, binance, sfox)`, and a venue with no marked key prints `no_marked_keys` (CONTEXT Deferred). Keep `EXIT_OK / EXIT_FAILED / EXIT_REFUSED = 0/1/2` (lines 183-185).

**Per-key client lifecycle and failure classification** (`allocator_history_probe.py` `_probe_member` lines 1695-1837; the part to copy is lines 1705-1726, 1800-1802 and 1835-1837):
```python
from services.encryption import decrypt_credentials
from services.exchange import aclose_exchange
from services.job_worker import _make_exchange_client

client: Any = None
try:
    if credentials_row is None:
        raise LookupError("selected member is not among the active keys read")
    api_key, api_secret, passphrase = decrypt_credentials(dict(credentials_row), kek)
    client = _make_exchange_client(venue, api_key, api_secret, passphrase)
    rows, agreed = await asyncio.wait_for(
        _read_member(...), er._RECONSTRUCT_CRAWL_TIMEOUT_S,   # walletoffset: use a probe-local timeout, see bybit_upnl_probe READ_TIMEOUT_S = 60.0 (line 87)
    )
    ...
except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
    ... classify_failure(exc) ...
finally:
    if client is not None:
        await aclose_exchange(client)
```
`bybit_upnl_probe.py` lines 669-683 is the same shape without the rebuild-specific branches and is the shorter template.

**GET-only budgeted wrapper for the raw OKX and Bybit calls** (`services/okx_bills_chain.py` lines 40-65; reuse by import):
```python
CHAIN_CALL_CEILING: Final[int] = 120
_GET_PREFIX: Final[str] = "private_get_"

class BudgetedExchange:
    def __init__(self, inner: Any, ceiling: int) -> None: ...
    def __getattr__(self, name: str) -> Callable[..., Awaitable[Any]]:
        if not name.startswith(_GET_PREFIX):
            raise AttributeError(f"BudgetedExchange resolves GET methods only, not {name!r}")
        ...                                   # counts calls; raises CallCeilingReached at the ceiling
```
Wrap the client in it for `private_get_account_bills_archive`, `private_get_v5_position_closed_pnl`, `private_get_v5_account_transaction_log`. Note `fetch_ccxt_transfers` calls `fetch_deposits` / `fetch_withdrawals` (not `private_get_*`), so it takes the UNWRAPPED client; the static pin (below) is what protects that call.

**OKX bills walk (copy structure, keep `pnl` and `fee`)** (`services/okx_opening_balance.py` `walk_okx_bills_archive` lines 256-295; `_parse_bill` lines 230-253 is what DROPS `pnl`/`fee`, so the new parser differs there):
```python
kept: dict[str, dict[str, str]] = {}
cursor: int | None = None
for page_no in range(1, BILLS_ARCHIVE_PAGE_CEILING + 1):
    params = {"limit": str(BILLS_ARCHIVE_PAGE_ROWS)}
    if cursor is not None:
        params["after"] = str(cursor)
    reply: Any = await _okx_bills_fetch_with_backoff(
        exchange, _BILLS_METHOD, params, label="opening", page=page_no
    )
    rows = _page_rows(reply)
    if not rows:
        raise OpeningUnavailable("reach_unproven")
    page = [_parse_bill(r) for r in rows]
    page_min = min(int(b["billId"]) for b in page)
    if cursor is not None and page_min >= cursor:
        raise OpeningUnavailable("malformed_bills")
    reached_older = False
    for bill in page:
        if int(bill["ts"]) >= opening_ms:
            kept[bill["billId"]] = bill
        else:
            reached_older = True
    if reached_older:
        return list(kept.values())
    cursor = page_min
raise OpeningUnavailable("page_ceiling")
```
Adaptations: stop on a bill with `ts < B` (the window start), keep only bills with `B <= ts <= R` in the sum, dedupe by `billId`, no `begin`/`instType`/`ccy` filter (docstring lines 261-268), read ONLY the archive endpoint (RESEARCH Pitfall 1: the 7-day endpoint ages the window out about 2026-11-03), map `OpeningUnavailable`-style failures to the walletoffset unmeasurable tokens (`reach_unproven`, `page_ceiling`), and never return a partial sum.

**OKX bill sum, the chain's own rule** (`services/exchange.py` lines 1595-1620; RESEARCH "Code Examples" restates it):
```python
_OKX_FUNDING_BILL_TYPE = "8"
for bill in all_bills:
    bill_type = str(bill.get("type", "")).strip()
    if bill_type == _OKX_FUNDING_BILL_TYPE:
        continue                      # funding is booked separately from the same bills' ``pnl``
    _pnl_raw = _finite_float(bill.get("pnl", 0), label="OKX bill pnl")
    _fee_raw = _finite_float(bill.get("fee", 0), label="OKX bill fee")
    if _pnl_raw is None or _fee_raw is None:
        ...                           # chain drops the row; walletoffset records a non-finite value as unmeasurable ("malformed"), never 0
    pnl_val = _pnl_raw + _fee_raw
```
Use `_finite_float` from `services.exchange` (already imported by `okx_opening_balance.py` line 88). Sum only `ccy in STABLECOINS` (`services.closed_sets`, imported at `allocator_history_probe.py` line 176) and count the rest as `non_stable_rows`.

**Bybit closed-pnl (formula the chain books; the chain's loop is inline in `fetch_daily_pnl` and cannot be called for a window)** (`services/exchange.py` call at line 1839, row formula lines 1949-1960, window constants lines 1820-1823):
```python
bybit_params: dict[str, Any] = {
    "category": "linear",
    "limit": 200,                      # RESEARCH: the docs say 1-100; send 100 in the probe
    "startTime": str(window_start),
    "endTime": str(window_end),        # <= 7 days
}
if cursor:
    bybit_params["cursor"] = cursor
page_result = await exchange.private_get_v5_position_closed_pnl(bybit_params)
page_items = page_result.get("result", {}).get("list", [])
...
side = str(item.get("side", "")).strip().lower()
if side == "buy":
    position_pnl = cum_entry - cum_exit
else:
    position_pnl = cum_exit - cum_entry
realized_ex_funding = position_pnl - open_fee - close_fee      # day key = createdTime
```
Cursor stop rule: `if not next_cursor or next_cursor == cursor: break` (exchange.py after line 1850). A parity test against `fetch_daily_pnl` guards formula drift (see the test section).

**Bybit funding and flows** (reuse, do not re-implement): `fetch_funding_bybit(exchange, strategy_id, since_ms)` (`services/funding_fetch.py:624-700`) walks 7-day SETTLEMENT windows over `private_get_v5_account_transaction_log` for `linear` then `inverse`; call with `since_ms=B` and filter rows to `timestamp <= R`. Flows: `fetch_ccxt_transfers(exchange, kind, since_ms, now_ms)` (`services/ccxt_flow_fetch.py:161`, Bybit branch uses 30-day windows and raises `TransferPageStalled` on a stuck cursor) then `ccxt_rows_to_dated_flows(rows, venue=..., price_index=..., instants=[...])` (`services/ccxt_flows.py:164`; stablecoin at 1.0, other currency needs a same-day price index or `NavReconstructionError` -> `unpriced_flow`). Window membership must reuse the applier's rule (`services/nav_marks_apply.py:246-258`):
```python
read_s = read_at.timestamp()
read_day = (mark_day + timedelta(days=1)).isoformat()
return [fi for fi in flow_instants if fi.day == read_day and fi.at_ms / 1000.0 <= read_s]
```

**Pure layer (stdlib only; copy the shape from RESEARCH "Code Examples")**: `window_ms(marked_at)`, `in_window(ts_ms, b_ms, r_ms)` with the inclusive upper edge `b_ms <= ts_ms <= r_ms`, `offset_terms(...)` returning ratios over NAV and over wallet, with `nav_usd <= 0` returning an unmeasurable token and never 0. `ratio_or_absent(numerator, denominator)` at `allocator_history_probe.py:1275-1286` is the analog for "ratio or `field-absent`, never a non-finite or unrounded value"; read it once when writing `offset_terms` and mirror its guards.

**Entry point and error handling** (`allocator_history_probe.py` lines 2226-2240; copy verbatim, change the description):
```python
def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="... read-only probe (takes no arguments)")
    parser.parse_args(argv)
    logging.disable(logging.CRITICAL)
    try:
        return asyncio.run(run())
    except Exception as exc:  # noqa: BLE001 - the TYPE only; a message can carry an id
        print(f"failed: {type(exc).__name__}", file=sys.stderr)
        return EXIT_FAILED

if __name__ == "__main__":
    sys.exit(main())
```
The script takes NO arguments, so no identifier is ever typed. A run date is taken once (`_utc_today`, lines 1454-1455, monkeypatched in tests) and printed date-only.

**Summary record** (`allocator_history_probe.py` `summarize` lines 2124-2172): counts only, derived in code from the per-key records; for walletoffset add per-venue `keys`, `keys_measured`, `keys_unmeasurable` and the `no_marked_keys` flag for Binance and sFOX.

---

### `tests/test_walletoffset_probe.py` (test, request-response on fakes)

**Primary analog:** `tests/test_allocator_history_probe.py` (4505 lines). **Walker-test analog:** `tests/test_okx_opening_balance.py`.

**Header and module-level constants** (`test_allocator_history_probe.py` lines 1-66): a module docstring with a "Why each group matters (Rule 9)" list (tracer `run()`, read-only, redaction, refuse before decrypt), then:
```python
import scripts.allocator_history_probe as hp
from tests._bybit_evidence import DAY_MS, METHODS, EvidenceBook

_PROBE_SRC = Path(hp.__file__).read_text(encoding="utf-8")
_TODAY = date(2026, 10, 23)
# Distinctive values, so a substring search for one in the output cannot be confused
# with a count or a ratio's digits.
_USER_ONE = "fake-user-id-one"
_KEY_BYBIT = "fake-key-id-bybit"
_CIPHER = "planted-cipher-text-zzz"
_BASE_VALUE = 7777.25
```
Plant fake uuids, a ciphertext, an amount (RESEARCH suggests 7777.25) and a venue message so the redaction test has needles.

**Fake database with recorded writes** (`test_allocator_history_probe.py` lines 160-192): `_FakeQuery` exposes `insert/update/upsert/delete` that APPEND to `owner.writes` (so a probe that reaches a writer is recorded and the test fails rather than dying on an `AttributeError`), and `_FakeSupabase.rpc` also records. Add `api_key_nav_marks` rows to its tables for the first-mark read.

**Services harness patched in one place** (`test_allocator_history_probe.py` lines 242-311, `_Services.install`): monkeypatches `services.db.get_supabase`, `services.db.db_execute` (`async def _db_execute(fn): return fn()`), `decrypt_credentials` (records ids, returns `("fake-k", "fake-s", None)`), `_make_exchange_client` (records the venue, hands out stub clients in order), `aclose_exchange` (records closes) and `hp._utc_today`. Assert `decrypt_calls == []` and `built_for == []` for refuse-before-decrypt cases.

**Read-only and source pins** (`test_allocator_history_probe.py` lines 2148-2290). Copy these shapes, swapping the probe module and the allowed table names:
```python
def test_read_only_wrapper_exposes_select_and_nothing_else() -> None: ...      # lines 2148-2164
async def test_read_only_wrapper_turns_the_hidden_price_cache_write_into_a_caught_failure(...)  # 2167-2186, includes the CONTROL on the bare client so the assertion can fail

_FORBIDDEN_NAMES = (
    "_allocator_key_preflight", "_crawl_account_key", "_crawl_whole_account", "_stamp_429",
    "replace_equity_snapshots", "replace_equity_snapshots_window", "persist_equity_snapshots",
)
def _code_names(source: str) -> set[str]: ...                                  # AST names, docstrings excluded
def test_the_probe_source_calls_no_writer() -> None:
    for write in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "enqueue"):
        assert write not in _PROBE_SRC, write
def test_the_probe_source_calls_no_venue_write() -> None:
    assert not re.search(r"\b(create_order|cancel_order|withdraw|transfer)\(", _PROBE_SRC)
    assert not re.search(r"\bprivate_(post|put|delete)_", _PROBE_SRC)
def test_the_probe_names_only_the_two_tables_it_reads() -> None:
    literal = re.findall(r'\.table\(\s*"([a-z_]+)"\s*\)', _PROBE_SRC)
    assert sorted(literal) == ["allocator_equity_snapshots", "api_keys"]       # walletoffset: ["api_key_nav_marks", "api_keys"]
def test_every_database_handle_the_probe_passes_on_is_the_wrapper() -> None: ...   # get_supabase( appears once, wrapped at birth; every `supabase` parameter annotated ReadOnlySupabase
```
Caution for the venue-write pin: the walletoffset script calls `fetch_ccxt_transfers`, whose Bybit branch lives in `services/`; the regex only scans the probe source, which is the intended scope (the existing pin does the same for `_fetch_and_price_window`). Do not name `transfer(` in the probe source (the regex would fire); name `fetch_ccxt_transfers` only.

**Redaction / leak test** (`test_allocator_history_probe.py` `test_a_fully_populated_evidence_record_is_emitted_and_leaks_nothing`, lines 1212-1260):
```python
assert await hp.run() == 0
captured = capsys.readouterr()
account = json.loads(captured.out.splitlines()[0])
# The record is fully populated, so a leak had every chance to show.
output = captured.out + captured.err
for needle in _FUNDING_LEAK_NEEDLES:
    assert needle not in output, needle
assert not any(str(stamp) in output for stamp in stamps)
```
Rule 9 applies (RESEARCH, Validation): include a deliberately leaky stub in the same test that DOES print a planted value, so the assertion is proven able to fail. Also test `emit_record` rejecting an extra key, an out-of-vocabulary value, an unrounded float and a 10+ digit run; `main()` prints the exception TYPE only.

**OKX walker tests on the fake archive** (`tests/test_okx_opening_balance.py` lines 300-335): build an `OkxBillsArchive`, call the walker with an `SimpleNamespace(private_get_account_bills_archive=archive)` exchange, assert the token for an empty page before the older bill (`reach_unproven`), a lowered page ceiling (`monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_CEILING", n)` then `page_ceiling`), and the oldest-first switch (`OkxBillsArchive(rows, oldest_first_with_begin=True)`), which must not hide the newest bills because the walker sends no `begin`. Assert `archive.calls` never carry `begin`.

**Test-framework facts**: `asyncio_mode = auto` (async tests need no marker), `pythonpath = .`, run from `analytics-service/` only; never `importlib.reload`. Quick command: `cd analytics-service && .venv/bin/python -m pytest tests/test_walletoffset_probe.py -q -x`.

**Edge cases the RESEARCH table requires** (each a test): window edges `ts == B` in, `ts == R` in, `ts == R+1` out, `ts == B-1` out; `nav <= 0` -> unmeasurable token, never 0; duplicates by `billId` dropped; `type == "1"` transfer bills counted not summed; non-stable `ccy` excluded and counted; Bybit formula parity with `fetch_daily_pnl` on the same synthetic rows (fake exchange exposing `private_get_v5_position_closed_pnl`); unmeasurable keys (`no_mark`, `key_not_working`, auth, permission, timeout) each print their closed token and no ratio.

---

### `tests/_okx_bills.py` (test helper, additive edit)

**Analog:** the file itself. Its module docstring (lines 17-28) states the rule this edit must follow: "all additive and default-off so every Phase 172 caller is untouched", and each new `okx_bill` parameter is added "only when the value is given".

**Pattern to extend** (`tests/_okx_bills.py` lines 37-65, the `okx_bill` signature and tail):
```python
def okx_bill(
    bill_id: int, ts: int, ccy: str, bal: str, bal_chg: str,
    *,
    bill_type: str = "2",
    inst_type: str = "SPOT",
    sub_type: str = "",
    mgn_mode: str = "",
    pos_bal_chg: str = "",
) -> dict[str, str]:
    """One bill with the OKX v5 field names the oracle reads, every value a string.

    ``subType``, ``mgnMode`` and ``posBalChg`` are present only when given."""
    bill = {"billId": str(bill_id), "ts": str(ts), "ccy": ccy, "bal": bal, "balChg": bal_chg,
            "type": bill_type, "instType": inst_type}
    for key, value in (("subType", sub_type), ("mgnMode", mgn_mode), ("posBalChg", pos_bal_chg)):
        if value:
            bill[key] = value
    return bill
```
Add `pnl: str = ""` and `fee: str = ""` keyword parameters and append `("pnl", pnl), ("fee", fee)` to the tuple of optional keys, so a bill carries `pnl` / `fee` only when given (every value a string, as OKX sends it; fixture values synthetic). Extend the module docstring's additions list with a "Phase 184 WALLETOFFSET" bullet in the same voice. Do NOT change `OkxBillsArchive` (lines 210-273): it already honours `after`, `begin`, `end`, `type`, `instType`, `limit`, `oldest_first`, `oldest_first_with_begin`, `empty_after_cursor`, `ignore_after` and records `calls`, which is all the new walker needs. `okx_bill_chain` / `okx_bills_updated_in_order` build `bal` chains for the opening oracle and are not needed (the probe sums `pnl`/`fee`, it does not re-fold balances); build the walletoffset bills with `okx_bill(...)` directly.

---

### Bybit closed-pnl fake (new, test helper)

**Analog (partial):** `tests/_bybit_evidence.py` `EvidenceBook` (lines 65-140+). It already answers `private_get_v5_account_transaction_log` Bybit-faithfully (UNIFIED account type required, `startTime`/`endTime` as strings, `[startTime, endTime]` inclusive, newest first, 50-row pages, opaque `nextPageCursor`, 7-day strict/non-strict span rules, `effects` per method: exception, `"malformed"`, `"repeat"`, `"hang"`, plus `add_log(log_type, stamp_ms, rid, **extra)` at lines ~99-105). So the `SETTLEMENT` funding half of the Bybit measurement can use `EvidenceBook.add_log("SETTLEMENT", stamp_ms, funding="...")` and `book.attach(client)` unchanged (used at `test_allocator_history_probe.py` line ~1236). `EvidenceBook` has NO `private_get_v5_position_closed_pnl` endpoint (its `METHODS` tuple, line 55, lists five asset GETs, query-api and the transaction log only).

**What to write:** a small fake that returns `{"result": {"list": [...], "nextPageCursor": "..."}}` for `private_get_v5_position_closed_pnl`, with the venue rules the production loop relies on and RESEARCH cites: `startTime`/`endTime` strings with `endTime - startTime <= 7 days` (else `ccxt.BadRequest`), rows newest first, page cap 100, opaque cursor, rows carrying `cumEntryValue`, `cumExitValue`, `openFee`, `closeFee`, `side`, `createdTime`, `symbol` as strings. Keep it local to `tests/test_walletoffset_probe.py` unless a second consumer appears; if it is shared, put it in a new `tests/_bybit_closed_pnl.py` in the `_bybit_evidence.py` voice (module docstring stating the vendor rules mirrored and that endpoint facts are hard-coded on purpose instead of imported from the code under test; fixture ids prefixed `fake-`). Additive only: do not edit `_bybit_evidence.py` (Phase 180 callers).

---

### Temporary worker start-command wrapper (operator procedure, plan 02, `autonomous: false`)

**Analog:** `.planning/phases/180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s/180-08-PLAN.md`, Task 1 `<instructions>` steps 1-6 (lines ~96-103), which itself cites `173-03-PLAN.md` / `173-03-SUMMARY.md` and `167.2.1.1.2.1-06-SUMMARY.md`. Copy the structure, with the walletoffset probe module and import check substituted:

1. Approval, asked ONCE with AskUserQuestion ("Run the full deployed probe on the backfill worker now (Recommended)" / "Not now"); record `probe-approval: <answer verbatim>`; "Not now" is a STOP.
2. Preconditions: the code PR is merged; `gh api "repos/<owner>/<repo>/actions/runs?head_sha=<merge sha>" -q '.workflow_runs | length'` plus each run's conclusion shows main's CI green with the expected check count for that SHA; Railway deployed that head or a later main head containing it; UTC clock between 00:30 and 21:30. Record `deployed-commit: <40-hex>`.
3. Import check, in the same wrapper, no payload, from the deployed app directory (for walletoffset: `python -c 'import scripts.walletoffset_probe as p; print(p.EXIT_OK, ...)'`, a printed line the plan pins exactly and treats as a STOP on any mismatch).
4. In the same wrapper: start `python -m scripts.walletoffset_probe` in the BACKGROUND, print `probe-exit: <code>` whatever the code, then `exec python -m main_worker`. Apply with `railway redeploy --from-source` (a redeploy that reuses the old service config never runs the wrapper). Read no record before `probe-exit:` appears.
5. Restore at once: start command back to `python -m main_worker`, redeploy from source, confirm the worker's normal startup line, record `worker-restored: yes`. A worker that does not return is a STOP that outranks everything.
6. Paste records under `## Probe` with a log-format note (Railway's log view prints each record as `key=value` attributes; rebuild each JSON object with every value copied exactly and say so; join split records into ONE line). Check the pasted lines hold no uuid and no run of ten or more digits.

Never `railway ssh` (broken). Scratch outside the repo, deleted at the end. The gate in 180-08's `<automated>` block (a `GATES_OK` shell check over the SUMMARY: records equal the printed ones, `worker-restored: yes` present before any gate line, no uuid via `grep -acE '[0-9a-f]{8}-[0-9a-f]{4}-'`, no 10+ digit run outside the commit line, scratch dir gone) is the shape to copy for plan 02's verify, using `grep -a`.

---

## Shared Patterns

### Redaction contract (public repo, output pasted into a tracked file)
**Source:** `scripts/allocator_history_probe.py` lines 91-99 (contract) and 604-607 (`emit_record`); `scripts/deribit_ground_truth.assert_sanitized` as the second line.
**Apply to:** `scripts/walletoffset_probe.py` and its tests. Labels `k1..kN`, counts, booleans, closed tokens, 3-significant-figure ratios, dates no finer than the run date; no id, amount, venue text or key. Failures are recorded by exception CLASS only (`classify_failure`), a run-level failure prints the exception TYPE only, `logging.disable(logging.CRITICAL)` for the run.

### Read-only enforcement (database and venue)
**Source:** `ReadOnlySupabase` (`allocator_history_probe.py` lines 615-643); `BudgetedExchange` (`services/okx_bills_chain.py` lines 40-65); static source pins (`tests/test_allocator_history_probe.py` lines 2189-2290).
**Apply to:** the probe (handle at birth, `get_supabase(` once) and the test file (pins). Names to keep out of the probe source: `_allocator_key_preflight`, `_stamp_429`, `persist_equity_snapshots`, `replace_equity_snapshots*`, `_crawl_account_key`, `_crawl_whole_account`, `.insert(` `.update(` `.upsert(` `.delete(` `.rpc(` `enqueue`, `create_order|cancel_order|withdraw|transfer(`, `private_(post|put|delete)_`. Only the `api_keys` and `api_key_nav_marks` tables are named. The one hidden DB write reachable through shared readers (`_resolve_ccxt_flow_price_index` -> `_cache_coingecko_prices` upserting `token_price_history`) fails inside its own caught exception because the handle has no `upsert`; keep the control test that proves the bare client DOES write.

### Closed unmeasurable vocabulary, never zero
**Source:** `scripts/allocator_history_probe.py` `_REFUSAL_TOKENS` (line 209) and the "field-absent for every reading below, never 0 or False" comment (line 535); `scripts/bybit_upnl_probe.py` `FIELD_ABSENT` (line 90).
**Apply to:** every ratio and count field of the key record. A key whose window cannot be rebuilt prints a closed reason and `field-absent` ratios (CONTEXT: never invent data).

### Client lifecycle with class-only error recording
**Source:** `allocator_history_probe.py` `_probe_member` lines 1705-1726, 1800-1802, 1835-1837; `bybit_upnl_probe.py` lines 669-683.
**Apply to:** the per-key reader in the probe. Decrypt inside the worker, build via `_make_exchange_client`, bound the read with `asyncio.wait_for`, `except Exception as exc:  # noqa: BLE001` -> `classify_failure(exc)`, `finally: await aclose_exchange(client)`.

### Additive-and-default-off test helpers
**Source:** `tests/_okx_bills.py` docstring lines 17-28.
**Apply to:** the `okx_bill(pnl=, fee=)` edit (and any new helper): existing Phase 172 / 179 callers must not change behavior.

### CI gates and ship rules (carried into every analytics plan)
**Source:** CONTEXT "Shape the orchestrator set" and RESEARCH "CI mypy line".
**Apply to:** plan 01 (code PR): carry CI's mypy line verbatim, `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` from `analytics-service/` (the script is outside its scope; the line only reddens if `services/` is touched); full suite `cd analytics-service && .venv/bin/pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`; CHANGELOG entry plus `VERSION`/`package.json` byte-equal 4-digit bump in the release commit; the ship branch changes nothing under `.planning`; no CI skip tokens and no AI attribution lines in commit or PR text.

## No Analog Found

| File / piece | Role | Data Flow | Reason |
|--------------|------|-----------|--------|
| Bybit `position_closed_pnl` window reader inside the probe | reader | request-response, cursor-paged | The chain's loop is inline in `services/exchange.py` `fetch_daily_pnl` (lines ~1820-1960) and takes no window argument; no callable to reuse. Re-implement the formula in the probe and pin it with a parity test against `fetch_daily_pnl` (RESEARCH "Key insight") |
| OKX bills walker that keeps `pnl` and `fee` | reader | request-response, `after`-paged | `okx_opening_balance.walk_okx_bills_archive` has the right structure but `_parse_bill` drops `pnl`/`fee`; copy the structure, write a new parser (RESEARCH "Alternatives Considered") |
| Binance income reader, sFOX balance-history comparison | reader | n/a | No marked Binance or sFOX key exists (CONTEXT Deferred); print `no_marked_keys`, or `reader_not_built` if one appears. No analog is needed |
| Bybit `position_closed_pnl` test double | test helper | request-response | Only the transaction-log half exists in `tests/_bybit_evidence.py`; see its section above |

## Metadata

**Analog search scope:** `analytics-service/scripts/`, `analytics-service/services/` (`nav_marks.py`, `nav_marks_apply.py`, `okx_opening_balance.py`, `okx_bills_chain.py`, `exchange.py`, `funding_fetch.py`, `ccxt_flow_fetch.py`, `ccxt_flows.py`, `allocator_equity_derive.py`), `analytics-service/tests/` (`test_allocator_history_probe.py`, `test_okx_opening_balance.py`, `_okx_bills.py`, `_bybit_evidence.py`), and `.planning/phases/180-bybitfunding-*/180-08-PLAN.md`.
**Files scanned (opened or grepped):** about 16.
**Tracked-source gate (#3645):** `git ls-files` printed every analog path above (scripts, services, tests); no gitignored capability-mirror path is named.
**Pattern extraction date:** 2026-11-01
