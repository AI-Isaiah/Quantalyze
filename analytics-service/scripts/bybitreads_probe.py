"""Phase 231 BYBITREADS: the read-only, counts-only Bybit read probe (research first).

ROADMAP puts research first: before any Bybit read is changed, the venue is measured. A key
decrypts only inside the worker (Phase 186 D-01), so this is a reviewed script that the phase
orchestrator runs once on the Railway backfill worker, modelled on ``scripts/derivegaps_probe.py``.
It measures the VENUE, not the repo's own functions: after plan 04 replaces the execution reader,
a probe that called it would stop measuring the legacy behaviour.

WHAT IT MEASURES, per eligible Bybit key (labels ``k1..kN``):

  * Section A, trade window (VREAD-03). With a fixed start of now minus 22 days, the legacy
    execution-list shape (``startTime`` on the first page only, cursor pages, no ``endTime``) and
    the windowed shape (seven-day windows, both bounds, cursor within a window) are issued directly
    through ``private_get_v5_execution_list``, plus the start-less shape. Rows are counted by
    ``execId``. ``trade_window_verdict`` is ``truncated`` only when the windowed read found rows
    after the first week that the legacy read did not, ``not_truncated`` only when the legacy
    cursor reached past the first week, and ``undecided`` otherwise: a quiet window never reads as
    a pass. A separate 365-day windowed sweep counts the pages per window, which sizes plan 04's
    per-window page cap (ruling OQ7).
  * Section B, deposits (VREAD-04). The REAL ``fetch_ccxt_transfers`` (on-chain deposits and
    withdrawals) and ``fetch_bybit_unified_flows`` over now minus 729 days to now, paired with the
    service's own ``pair_onchain_with_unified``. ``deposit_verdict`` follows one closed table
    (``deposit_verdict``); zero on-chain rows is ``undecided``, never a replace verdict.
  * Section C, exposure (census rows C18 and C19). Whether the key holds stable coins other than
    USDT or non-stable coins (by the shared ``is_stable_value`` rule), the open positions and the
    read state per category (linear USDT, linear USDC, inverse), and the inverse closed-pnl rows
    over 30 days. A venue refusal of one category reads ``refused`` for that category only.
  * Section D, funding (census row C27). One real ``fetch_funding_bybit`` walk with no start,
    timed: seconds, calls, state and the raw rows per category.

REDACTION CONTRACT (the output is pasted into a tracked file in a public repo): labels ``k1..kN``,
counts, booleans, closed-vocabulary tokens and 3-significant-figure seconds. No amount, id,
symbol, address, venue text or timestamp finer than the run date. The only path to stdout is
``emit_record``, which refuses any key outside the declared records and any value outside the
declared vocabulary, then re-checks with ``assert_sanitized``. "Not measured" is the word
``field-absent``, never 0. Logging is switched off for the run, and a failure prints the exception
TYPE only. Rows are counted, never printed.

READ-ONLY. The database is obtained once, through ``ReadOnlySupabase`` (select only). Every venue
call goes through ``ReadOnlyRecordingExchange``: it resolves implicit GET methods and a closed list
of read methods only, counts each call and stops at its ceiling. Each section has its own view
and ceiling, so one section that spends its budget does not starve the others. Nothing here places
an order or moves funds; ``tests/test_bybitreads_probe.py`` pins that on this file's own text.

USAGE. No arguments, so no identifier is ever typed. The orchestrator runs it once on the Railway
backfill worker through a temporary start-command wrapper, reads the lines from the service log
and pastes only the lines that start with an opening brace and a quote (one per key, then one
summary). Before the run, the worker's deployed copy proves it is the reviewed one:
``python -c 'import scripts.bybitreads_probe as p; print(p.deploy_fingerprint())'`` prints one line
that must equal the line computed at the reviewed commit.

EXIT CODES
----------
  0  at least one eligible key was measured, every eligible key was measured, and no section
     failed, ran out of calls or time, or stopped at a page ceiling (a key the backfill does not
     derive is not counted)
  1  no eligible key was measured (no keys, or none the backfill derives), any eligible key could
     not be measured, any section did not complete, or any other failure (the exception TYPE only
     on stderr)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import re
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, Final

import ccxt

from scripts.bybit_upnl_probe import FIELD_ABSENT, sig3
from scripts.derivegaps_probe import (
    UNMEASURABLE_REASONS,
    ReadOnlyRecordingExchange,
    failure_token,
)
from scripts.deribit_ground_truth import assert_sanitized
from scripts.walletoffset_probe import ReadOnlySupabase
from services.allocator_equity_derive import eligible_key_predicate
from services.bybit_unified_flows import (
    BybitUnifiedFlowReadError,
    fetch_bybit_unified_flows,
    pair_onchain_with_unified,
)
from services.ccxt_flow_fetch import fetch_ccxt_transfers
from services.funding_fetch import FundingFetchCeilingExceeded, fetch_funding_bybit
from services.price_rule import is_stable_value

EXIT_OK: Final[int] = 0
EXIT_FAILED: Final[int] = 1

# ---------------------------------------------------------------------------
# Budgets. Module constants (not Final) so a test can lower them.
# ---------------------------------------------------------------------------

#: Calls per section view: the legacy and start-less reads of section A (a 100-page legacy walk
#: plus a short start-less walk), the windowed read (four windows of at most 100 pages), the
#: 365-day sweep (53 windows), the deposit readers (about 50 on-chain and 210 Unified calls at
#: minimum), the exposure reads and the funding walk (at least 106 requests).
A_LEGACY_CEILING: int = 110
A_WINDOWED_CEILING: int = 900
A_SWEEP_CEILING: int = 3000
B_CEILING: int = 600
C_CEILING: int = 40
D_CEILING: int = 1500

#: Wall-clock bounds of the two reads that can run long. A sweep past its bound records
#: ``trade_sweep_complete: false``; a funding walk past its bound records ``funding_state:
#: timeout``, which is the reading census row C27 is after, not a crash.
SWEEP_DEADLINE_S: float = 600.0
FUNDING_DEADLINE_S: float = 600.0

_DAY_MS: Final[int] = 24 * 60 * 60 * 1000
#: Bybit's documented maximum span between ``startTime`` and ``endTime``.
_WINDOW_MS: Final[int] = 7 * _DAY_MS
TRADE_START_DAYS: Final[int] = 22
SWEEP_DAYS: Final[int] = 365
DEPOSIT_WINDOW_DAYS: Final[int] = 729
EXPOSURE_CLOSED_PNL_DAYS: Final[int] = 30

LEGACY_PAGE_CAP: Final[int] = 100
STARTLESS_PAGE_CAP: Final[int] = 8
WINDOW_PAGE_CAP: Final[int] = 100
SWEEP_WINDOW_PAGE_CAP: Final[int] = 500

_EXEC_PAGE_LIMIT: Final[str] = "100"

#: Section C bounds: pages followed per position category and per closed-pnl window. A category
#: that still has a live cursor after its pages reads ``failed`` (its count would be a lower bound).
POSITION_PAGE_CAP: Final[int] = 3
CLOSED_PNL_PAGE_CAP: Final[int] = 3
_POSITION_LIMIT: Final[str] = "200"
_FUNDING_PROBE_LABEL: Final[str] = "bybitreads-probe"

# ---------------------------------------------------------------------------
# The closed record vocabulary, declared once and used by the validator and the builders.
# ---------------------------------------------------------------------------

TRADE_VERDICTS: Final[tuple[str, ...]] = ("truncated", "not_truncated", "undecided")
DEPOSIT_VERDICTS: Final[tuple[str, ...]] = (
    "undecided",
    "replace_supported",
    "undecided_near_miss",
    "unpaired_present",
    "unread",
)
#: ``incomplete`` is a windowed read that ended on a page ceiling or a repeated cursor in some
#: window, so its row count is a lower bound.
TRADE_READ_STATES: Final[tuple[str, ...]] = ("complete", "incomplete", "failed", "call_ceiling")
LEGACY_ENDS: Final[tuple[str, ...]] = ("empty_cursor", "empty_page", "page_cap", "stuck")
ONCHAIN_READ_STATES: Final[tuple[str, ...]] = ("complete", "failed", "call_ceiling")
UNIFIED_READ_STATES: Final[tuple[str, ...]] = ("complete", "reader_error", "venue_error", "call_ceiling")
POSITION_READ_STATES: Final[tuple[str, ...]] = ("ok", "refused", "failed")
FUNDING_STATES: Final[tuple[str, ...]] = ("complete", "ceiling", "failed", "call_ceiling", "timeout")

_MAX_KEYS: Final[int] = 999
_LABEL_RE = re.compile(r"^k[0-9]{1,3}$")
_DATE_RE = re.compile(r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")

_SECTION_A_KEYS: Final[tuple[str, ...]] = (
    "trade_read_state",
    "trade_legacy_rows",
    "trade_legacy_pages",
    "trade_legacy_end",
    "trade_windowed_rows",
    "trade_rows_after_first_week",
    "trade_cursor_continues_past_7d",
    "trade_startless_rows",
    "trade_last7d_windowed_rows",
    "trade_informative",
    "trade_window_verdict",
    "trade_sweep_windows_read",
    "trade_sweep_pages_max_in_window",
    "trade_sweep_complete",
    "trade_sweep_read_s",
)
_SECTION_B_KEYS: Final[tuple[str, ...]] = (
    "onchain_read_state",
    "unified_read_state",
    "onchain_deposits",
    "onchain_withdrawals",
    "unified_in",
    "unified_out",
    "paired_rows",
    "unpaired_onchain_rows",
    "near_miss_rows",
    "unreadable_rows",
    "deposit_verdict",
)
_SECTION_C_KEYS: Final[tuple[str, ...]] = (
    "stable_non_usdt_present",
    "nonstable_present",
    "positions_open_linear_usdt",
    "positions_open_linear_usdc",
    "positions_open_inverse",
    "positions_read_linear_usdt",
    "positions_read_linear_usdc",
    "positions_read_inverse",
    "inverse_closed_pnl_rows_30d",
    "inverse_closed_pnl_read",
)
_SECTION_D_KEYS: Final[tuple[str, ...]] = (
    "funding_state",
    "funding_read_s",
    "funding_calls",
    "funding_rows_linear",
    "funding_rows_inverse",
    "funding_inverse_skipped",
)

KEY_RECORD_KEYS: Final[tuple[str, ...]] = (
    "record",
    "label",
    "venue",
    "run_date",
    "measured",
    "unmeasurable_reason",
    *_SECTION_A_KEYS,
    *_SECTION_B_KEYS,
    *_SECTION_C_KEYS,
    *_SECTION_D_KEYS,
)

SUMMARY_RECORD_KEYS: Final[tuple[str, ...]] = (
    "record",
    "run_date",
    "keys",
    "keys_measured",
    "keys_unmeasurable",
    "trade_verdict_truncated",
    "trade_verdict_not_truncated",
    "trade_verdict_undecided",
    "trade_sweep_pages_max",
    "trade_sweep_read_s_max",
    "trade_sweep_incomplete",
    "deposit_verdict_undecided",
    "deposit_verdict_replace_supported",
    "deposit_verdict_undecided_near_miss",
    "deposit_verdict_unpaired_present",
    "deposit_verdict_unread",
    "positions_refused_linear_usdc",
    "positions_refused_inverse",
    "positions_open_inverse_total",
    "inverse_closed_pnl_rows_30d_total",
    "funding_rows_inverse_total",
    "funding_read_s_max",
    "funding_incomplete",
    "sections_failed",
)


def _is_bool(x: Any) -> bool:
    return isinstance(x, bool)


def _is_bool_or_absent(x: Any) -> bool:
    return isinstance(x, bool) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_count(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0


def _is_count_or_absent(x: Any) -> bool:
    return _is_count(x) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_sig3_float(x: Any) -> bool:
    return isinstance(x, float) and math.isfinite(x) and x >= 0.0 and float(f"{x:.3g}") == x


def _is_seconds_or_absent(x: Any) -> bool:
    if isinstance(x, str):
        return x == FIELD_ABSENT
    return _is_sig3_float(x)


def _is_str_matching(pattern: re.Pattern[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and pattern.match(x) is not None


def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed


def _is_token_or_absent(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return _is_one_of((*allowed, FIELD_ABSENT))


_KEY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("key",)),
    "label": _is_str_matching(_LABEL_RE),
    "venue": _is_one_of(("bybit",)),
    "run_date": _is_str_matching(_DATE_RE),
    "measured": _is_bool,
    "unmeasurable_reason": _is_one_of(UNMEASURABLE_REASONS),
    "trade_read_state": _is_token_or_absent(TRADE_READ_STATES),
    "trade_legacy_rows": _is_count_or_absent,
    "trade_legacy_pages": _is_count_or_absent,
    "trade_legacy_end": _is_token_or_absent(LEGACY_ENDS),
    "trade_windowed_rows": _is_count_or_absent,
    "trade_rows_after_first_week": _is_count_or_absent,
    "trade_cursor_continues_past_7d": _is_bool_or_absent,
    "trade_startless_rows": _is_count_or_absent,
    "trade_last7d_windowed_rows": _is_count_or_absent,
    "trade_informative": _is_bool_or_absent,
    "trade_window_verdict": _is_token_or_absent(TRADE_VERDICTS),
    "trade_sweep_windows_read": _is_count_or_absent,
    "trade_sweep_pages_max_in_window": _is_count_or_absent,
    "trade_sweep_complete": _is_bool_or_absent,
    "trade_sweep_read_s": _is_seconds_or_absent,
    "onchain_read_state": _is_token_or_absent(ONCHAIN_READ_STATES),
    "unified_read_state": _is_token_or_absent(UNIFIED_READ_STATES),
    "onchain_deposits": _is_count_or_absent,
    "onchain_withdrawals": _is_count_or_absent,
    "unified_in": _is_count_or_absent,
    "unified_out": _is_count_or_absent,
    "paired_rows": _is_count_or_absent,
    "unpaired_onchain_rows": _is_count_or_absent,
    "near_miss_rows": _is_count_or_absent,
    "unreadable_rows": _is_count_or_absent,
    "deposit_verdict": _is_token_or_absent(DEPOSIT_VERDICTS),
    "stable_non_usdt_present": _is_bool_or_absent,
    "nonstable_present": _is_bool_or_absent,
    "positions_open_linear_usdt": _is_count_or_absent,
    "positions_open_linear_usdc": _is_count_or_absent,
    "positions_open_inverse": _is_count_or_absent,
    "positions_read_linear_usdt": _is_token_or_absent(POSITION_READ_STATES),
    "positions_read_linear_usdc": _is_token_or_absent(POSITION_READ_STATES),
    "positions_read_inverse": _is_token_or_absent(POSITION_READ_STATES),
    "inverse_closed_pnl_rows_30d": _is_count_or_absent,
    "inverse_closed_pnl_read": _is_token_or_absent(POSITION_READ_STATES),
    "funding_state": _is_token_or_absent(FUNDING_STATES),
    "funding_read_s": _is_seconds_or_absent,
    "funding_calls": _is_count_or_absent,
    "funding_rows_linear": _is_count_or_absent,
    "funding_rows_inverse": _is_count_or_absent,
    "funding_inverse_skipped": _is_bool_or_absent,
}

_SUMMARY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("summary",)),
    "run_date": _is_str_matching(_DATE_RE),
    "trade_sweep_pages_max": _is_count_or_absent,
    "trade_sweep_read_s_max": _is_seconds_or_absent,
    "positions_open_inverse_total": _is_count_or_absent,
    "inverse_closed_pnl_rows_30d_total": _is_count_or_absent,
    "funding_rows_inverse_total": _is_count_or_absent,
    "funding_read_s_max": _is_seconds_or_absent,
}
for _name in SUMMARY_RECORD_KEYS:
    _SUMMARY_VALIDATORS.setdefault(_name, _is_count)

if set(_KEY_VALIDATORS) != set(KEY_RECORD_KEYS) or set(_SUMMARY_VALIDATORS) != set(
    SUMMARY_RECORD_KEYS
):  # pragma: no cover - a declaration error, caught at import
    raise RuntimeError("bybitreads_probe: a record vocabulary and its validators disagree")


def _check_keys(path: str, got: Mapping[str, Any], want: Sequence[str]) -> None:
    extra = sorted(set(got) - set(want))
    missing = sorted(set(want) - set(got))
    if extra or missing:
        raise ValueError(f"{path}: keys differ from the whitelist extra={extra} missing={missing}")


def validate_record(record: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` unless ``record`` is exactly the declared vocabulary.

    The message names the PATH of the offending entry and never its value: an unredacted
    venue string must not leak through its own rejection."""
    if not isinstance(record, Mapping):
        raise ValueError("record: not a mapping")
    kind = record.get("record")
    if kind == "key":
        want, validators = KEY_RECORD_KEYS, _KEY_VALIDATORS
    elif kind == "summary":
        want, validators = SUMMARY_RECORD_KEYS, _SUMMARY_VALIDATORS
    else:
        raise ValueError("record.record: value outside the declared vocabulary")
    _check_keys("record", record, want)
    for key, check in validators.items():
        if not check(record[key]):
            raise ValueError(f"record.{key}: value outside the declared vocabulary")
    assert_sanitized(dict(record))


def emit_record(record: Mapping[str, Any]) -> str:
    """The ONLY path to stdout: validate, then serialize one compact JSON line."""
    validate_record(record)
    return json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False)


# ---------------------------------------------------------------------------
# Small helpers.
# ---------------------------------------------------------------------------


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _monotonic() -> float:
    return time.monotonic()


def _sig3_or_absent(x: float) -> float | str:
    shown = sig3(x)
    return shown + 0.0 if isinstance(shown, float) else FIELD_ABSENT  # + 0.0: never "-0.0"


def _section_view(client: Any, ceiling: int) -> ReadOnlyRecordingExchange:
    """One GET-only, counted view for one section: it has its own call budget."""
    return ReadOnlyRecordingExchange(client, ceiling)


def _tile(start_ms: int, now_ms: int) -> list[tuple[int, int]]:
    """Seven-day windows over ``[start_ms, now_ms]`` with the plus-one-millisecond boundary: each
    next window starts one millisecond after the previous one ends, and no span exceeds seven days."""
    windows: list[tuple[int, int]] = []
    window_start = start_ms
    while window_start < now_ms:
        window_end = min(window_start + _WINDOW_MS, now_ms)
        windows.append((window_start, window_end))
        if window_end >= now_ms:
            break
        window_start = window_end + 1
    return windows


# ---------------------------------------------------------------------------
# Section A: the trade window (VREAD-03). The venue is measured, not the repo's reader.
# ---------------------------------------------------------------------------

_EXEC_METHOD: Final[str] = "private_get_v5_execution_list"
_NATURAL_ENDS: Final[tuple[str, ...]] = ("empty_cursor", "empty_page")


def _result_page(reply: Any) -> tuple[list[dict[str, Any]], str]:
    """The rows and next cursor of one reply. A reply without ``result.list``, or a list holding
    anything but objects, raises: reading it as an empty page would end a walk as if the venue had
    no more data, and a section would report a cut-short read as complete (or a measured zero).
    Every caller sits in a ``try`` that maps the exception to a failed or incomplete state."""
    result = reply.get("result") if isinstance(reply, dict) else None
    if not isinstance(result, dict) or not isinstance(result.get("list"), list):
        raise ValueError("reply has no result.list")  # no venue text
    items = result["list"]
    if not all(isinstance(item, dict) for item in items):
        raise ValueError("reply list holds a non-object row")
    cursor = result.get("nextPageCursor")
    return list(items), cursor if isinstance(cursor, str) else ""


def _exec_time_ms(row: Mapping[str, Any]) -> int:
    raw = row.get("execTime")
    if not (isinstance(raw, str) and raw.isascii() and raw.isdigit()):
        raise ValueError("execution row has no readable execTime")
    return int(raw)


def _collect(seen: dict[str, int], rows: Sequence[Mapping[str, Any]]) -> None:
    """Count rows by ``execId``: a row seen twice is one execution. Ids and times stay in memory.
    A row without an ``execId`` or a readable ``execTime`` raises: dropping it, or reading its time
    as 0, would leave the totals or the after-the-first-week count short with no signal."""
    for row in rows:
        exec_id = row.get("execId")
        if not (isinstance(exec_id, str) and exec_id):
            raise ValueError("execution row has no execId")
        seen.setdefault(exec_id, _exec_time_ms(row))


async def _walk_query(
    view: ReadOnlyRecordingExchange,
    first: Mapping[str, str],
    later: Mapping[str, str],
    page_cap: int,
    seen: dict[str, int],
) -> tuple[int, str]:
    """Read one query's cursor pages. The first page sends ``first``; every later page sends
    ``later`` plus the cursor. Returns ``(pages, end)``, ``end`` being how the walk stopped:
    ``empty_page``, ``empty_cursor``, ``stuck`` (the venue repeated the cursor it was sent) or
    ``page_cap`` (the cap was spent with a live cursor)."""
    cursor = ""
    pages = 0
    while pages < page_cap:
        params = dict(first if pages == 0 else later)
        if cursor:
            params["cursor"] = cursor
        reply = await getattr(view, _EXEC_METHOD)(params)
        pages += 1
        rows, next_cursor = _result_page(reply)
        _collect(seen, rows)
        if not rows:
            return pages, "empty_page"
        if not next_cursor:
            return pages, "empty_cursor"
        if next_cursor == cursor:
            return pages, "stuck"
        cursor = next_cursor
    return pages, "page_cap"


def trade_window_verdict(
    *,
    legacy_after: int,
    windowed_after: int,
    legacy_end: str,
    read_ok: bool,
    windowed_complete: bool,
) -> str:
    """The VREAD-03 verdict, total over its inputs.

    ``legacy_after`` and ``windowed_after`` are the executions each shape found after the first
    week; ``legacy_end`` is how the legacy walk stopped. ``truncated`` only when the windowed read
    found rows the legacy read did not (positive evidence, so it stands even when the windowed
    read was cut short); ``not_truncated`` only when the legacy cursor reached past the first week
    AND the windowed read was complete, so it did not miss more; ``undecided`` otherwise.
    ``undecided`` covers every read that failed, every window with no row after the first week and
    every legacy walk that stopped on its page cap or a repeated cursor: such a walk was cut by
    the cap, not by the seven-day rule this verdict is about, so the gap between the two shapes
    does not show which of the two cut it. A quiet window never reads as a pass."""
    if not read_ok or legacy_end not in _NATURAL_ENDS:
        return "undecided"
    if windowed_after > legacy_after:
        return "truncated"
    if windowed_complete and legacy_after > 0:
        return "not_truncated"
    return "undecided"


def _count_after(seen: Mapping[str, int], after_ms: int) -> int:
    return sum(1 for stamp in seen.values() if stamp > after_ms)


async def measure_trade_window(client: Any, now_ms: int) -> dict[str, Any]:
    """Section A, the three request shapes, from one clock snapshot (``now_ms``).

    The start is fixed at now minus 22 days. (a) The legacy shape: ``startTime`` on the first
    page only, cursor pages without a start, no ``endTime``, up to ``LEGACY_PAGE_CAP`` pages.
    (c) The start-less shape: no bound at all. (b) The windowed shape over the same 22 days:
    seven-day windows with both bounds as decimal strings, cursor within a window. Every request
    goes through a counted GET-only view. Readings taken before a read stopped are kept; a read
    that failed or ran out of calls leaves the later readings ``field-absent`` and the verdict
    ``undecided``."""
    values: dict[str, Any] = {name: FIELD_ABSENT for name in _SECTION_A_KEYS}
    start = now_ms - TRADE_START_DAYS * _DAY_MS
    first_week_end = start + _WINDOW_MS
    legacy_view = _section_view(client, A_LEGACY_CEILING)
    windowed_view = _section_view(client, A_WINDOWED_CEILING)
    legacy: dict[str, int] = {}
    startless: dict[str, int] = {}
    windowed: dict[str, int] = {}
    state = "complete"
    try:
        base = {"category": "linear", "limit": _EXEC_PAGE_LIMIT}
        pages, end = await _walk_query(
            legacy_view, {**base, "startTime": str(start)}, base, LEGACY_PAGE_CAP, legacy
        )
        values["trade_legacy_pages"] = pages
        values["trade_legacy_end"] = end
        values["trade_legacy_rows"] = len(legacy)
        values["trade_cursor_continues_past_7d"] = _count_after(legacy, first_week_end) > 0
        _, startless_end = await _walk_query(legacy_view, base, base, STARTLESS_PAGE_CAP, startless)
        # A start-less walk cut by its small page cap holds a lower bound; set beside a larger
        # windowed count it would read as the venue missing rows, so it is not reported.
        if startless_end in _NATURAL_ENDS:
            values["trade_startless_rows"] = len(startless)
        all_natural = True
        for window_start, window_end in _tile(start, now_ms):
            bounded = {**base, "startTime": str(window_start), "endTime": str(window_end)}
            _, window_ending = await _walk_query(windowed_view, bounded, bounded, WINDOW_PAGE_CAP, windowed)
            all_natural = all_natural and window_ending in _NATURAL_ENDS
        values["trade_windowed_rows"] = len(windowed)
        values["trade_rows_after_first_week"] = _count_after(windowed, first_week_end)
        values["trade_last7d_windowed_rows"] = _count_after(windowed, now_ms - _WINDOW_MS - 1)
        if not all_natural:
            state = "incomplete"
    except Exception:  # noqa: BLE001 - the state is the reading; class and message are not printed
        state = "call_ceiling" if legacy_view.ceiling_reached or windowed_view.ceiling_reached else "failed"
    values["trade_read_state"] = state
    read_ok = state in ("complete", "incomplete")
    if read_ok:
        after = int(values["trade_rows_after_first_week"])
        values["trade_informative"] = after > 0 and values["trade_legacy_end"] in _NATURAL_ENDS
        values["trade_window_verdict"] = trade_window_verdict(
            legacy_after=_count_after(legacy, first_week_end),
            windowed_after=after,
            legacy_end=str(values["trade_legacy_end"]),
            read_ok=True,
            windowed_complete=state == "complete",
        )
    else:
        values["trade_window_verdict"] = "undecided"
    return values


async def _sweep_walk(
    view: ReadOnlyRecordingExchange, now_ms: int, progress: dict[str, Any]
) -> None:
    start = now_ms - SWEEP_DAYS * _DAY_MS
    seen: dict[str, int] = {}
    base = {"category": "linear", "limit": _EXEC_PAGE_LIMIT}
    for window_start, window_end in _tile(start, now_ms):
        bounded = {**base, "startTime": str(window_start), "endTime": str(window_end)}
        pages, ending = await _walk_query(view, bounded, bounded, SWEEP_WINDOW_PAGE_CAP, seen)
        progress["windows"] += 1
        progress["pages_max"] = max(progress["pages_max"], pages)
        if ending not in _NATURAL_ENDS:
            progress["clean"] = False


async def measure_trade_sweep(client: Any, now_ms: int) -> dict[str, Any]:
    """Section A's 365-day windowed sweep: the pages each seven-day window needs, which sizes plan
    04's per-window page cap (ruling OQ7). Its own view (``A_SWEEP_CEILING`` calls) and its own
    wall-clock bound (``SWEEP_DEADLINE_S``). ``trade_sweep_complete`` is true only when every
    window was walked to a natural end; a spent budget, a deadline, a venue error or a window that
    hit its page cap leaves it false, and the page counts are then lower bounds."""
    view = _section_view(client, A_SWEEP_CEILING)
    progress: dict[str, Any] = {"windows": 0, "pages_max": 0, "clean": True}
    started = _monotonic()
    complete = False
    try:
        await asyncio.wait_for(_sweep_walk(view, now_ms, progress), SWEEP_DEADLINE_S)
        complete = bool(progress["clean"])
    except Exception:  # noqa: BLE001 - a deadline, a spent budget or a venue error all read incomplete
        complete = False
    elapsed = _monotonic() - started
    return {
        "trade_sweep_windows_read": progress["windows"],
        "trade_sweep_pages_max_in_window": progress["pages_max"] if progress["windows"] else FIELD_ABSENT,
        "trade_sweep_complete": complete,
        "trade_sweep_read_s": _sig3_or_absent(elapsed),
    }


async def measure_trades(client: Any, now_ms: int) -> dict[str, Any]:
    """Section A whole: the three shapes, then the 365-day sweep. The sweep runs even when the
    shapes failed, so one broken read does not hide the page counts."""
    values = await measure_trade_window(client, now_ms)
    values.update(await measure_trade_sweep(client, now_ms))
    return values


# ---------------------------------------------------------------------------
# Section B: the on-chain deposit (VREAD-04), through the REAL readers.
# ---------------------------------------------------------------------------


def deposit_verdict(
    *,
    onchain_state: str,
    unified_state: str,
    onchain_rows: int,
    unreadable_rows: int,
    unpaired_rows: int,
    near_miss_rows: int,
) -> str:
    """The VREAD-04 verdict, one closed table, evaluated top to bottom.

    ``unread``: either reader did not complete. ``undecided``: no on-chain row exists (nothing
    distinguishes replace from union, so zero rows is never a replace verdict) or some row cannot
    be read by the pairing rule (``unreadable_rows`` counts either side, which can only make the
    verdict more cautious). ``replace_supported``: every on-chain row paired.
    ``undecided_near_miss``: unpaired rows exist and a near miss shows the rule, not the account,
    may be why. ``unpaired_present``: unpaired rows with no near miss."""
    if onchain_state != "complete" or unified_state != "complete":
        return "unread"
    if onchain_rows == 0 or unreadable_rows > 0:
        return "undecided"
    if unpaired_rows == 0:
        return "replace_supported"
    if near_miss_rows > 0:
        return "undecided_near_miss"
    return "unpaired_present"


async def measure_deposits(client: Any, now_ms: int) -> dict[str, Any]:
    """Section B: the on-chain deposit and withdrawal records and the Unified TRANSFER_IN and
    TRANSFER_OUT rows over now minus 729 days to now, read by the REAL ``fetch_ccxt_transfers`` and
    ``fetch_bybit_unified_flows`` (no reader of its own), paired by the service's own
    ``pair_onchain_with_unified``. Each read ends in a closed state instead of failing the key; a
    spent call budget reads ``call_ceiling``. Rows are counted in memory, never printed."""
    values: dict[str, Any] = {name: FIELD_ABSENT for name in _SECTION_B_KEYS}
    view = _section_view(client, B_CEILING)
    since_ms = now_ms - DEPOSIT_WINDOW_DAYS * _DAY_MS

    onchain_deposits: list[dict[str, Any]] | None = None
    onchain_withdrawals: list[dict[str, Any]] | None = None
    try:
        onchain_deposits = await fetch_ccxt_transfers(view, "deposits", since_ms, now_ms)
        onchain_withdrawals = await fetch_ccxt_transfers(view, "withdrawals", since_ms, now_ms)
        values["onchain_read_state"] = "complete"
    except Exception:  # noqa: BLE001 - the state is the reading; class and message are not printed
        onchain_deposits = onchain_withdrawals = None
        values["onchain_read_state"] = "call_ceiling" if view.ceiling_reached else "failed"

    unified_deposits: list[dict[str, Any]] | None = None
    unified_withdrawals: list[dict[str, Any]] | None = None
    try:
        unified_deposits, unified_withdrawals = await fetch_bybit_unified_flows(view, since_ms, now_ms)
        values["unified_read_state"] = "complete"
    except Exception as exc:  # noqa: BLE001 - the state is the reading; class and message are not printed
        if view.ceiling_reached:
            values["unified_read_state"] = "call_ceiling"
        elif isinstance(exc, BybitUnifiedFlowReadError):
            values["unified_read_state"] = "reader_error"
        else:
            values["unified_read_state"] = "venue_error"

    if onchain_deposits is not None and onchain_withdrawals is not None:
        values["onchain_deposits"] = len(onchain_deposits)
        values["onchain_withdrawals"] = len(onchain_withdrawals)
    if unified_deposits is not None and unified_withdrawals is not None:
        values["unified_in"] = len(unified_deposits)
        values["unified_out"] = len(unified_withdrawals)

    unpaired_rows = unreadable_rows = near_miss_rows = 0
    if (
        onchain_deposits is not None
        and onchain_withdrawals is not None
        and unified_deposits is not None
        and unified_withdrawals is not None
    ):
        pairing = pair_onchain_with_unified(
            onchain_deposits, onchain_withdrawals, unified_deposits, unified_withdrawals
        )
        unpaired_rows = pairing.unpaired_onchain_deposits + pairing.unpaired_onchain_withdrawals
        unreadable_rows = pairing.unreadable_rows
        near_miss_rows = pairing.near_miss_rows
        values["paired_rows"] = pairing.paired_deposits + pairing.paired_withdrawals
        values["unpaired_onchain_rows"] = unpaired_rows
        values["near_miss_rows"] = near_miss_rows
        values["unreadable_rows"] = unreadable_rows
    values["deposit_verdict"] = deposit_verdict(
        onchain_state=str(values["onchain_read_state"]),
        unified_state=str(values["unified_read_state"]),
        onchain_rows=(
            len(onchain_deposits) + len(onchain_withdrawals)
            if onchain_deposits is not None and onchain_withdrawals is not None
            else 0
        ),
        unreadable_rows=unreadable_rows,
        unpaired_rows=unpaired_rows,
        near_miss_rows=near_miss_rows,
    )
    return values


# ---------------------------------------------------------------------------
# Section C: exposure counts for census rows C18 and C19.
# ---------------------------------------------------------------------------

_POSITION_READS: Final[tuple[tuple[str, dict[str, str]], ...]] = (
    ("linear_usdt", {"category": "linear", "settleCoin": "USDT"}),
    ("linear_usdc", {"category": "linear", "settleCoin": "USDC"}),
    ("inverse", {"category": "inverse"}),
)


async def _paged_rows(
    view: ReadOnlyRecordingExchange, method: str, params: Mapping[str, str], page_cap: int
) -> list[dict[str, Any]] | None:
    """Every row of one query, following ``nextPageCursor`` for at most ``page_cap`` pages. None
    when the cap was spent with a live cursor or the venue repeated its cursor: a count taken from
    those rows would be a lower bound."""
    rows: list[dict[str, Any]] = []
    cursor = ""
    for _ in range(page_cap):
        page_params = dict(params)
        if cursor:
            page_params["cursor"] = cursor
        page, next_cursor = _result_page(await getattr(view, method)(page_params))
        rows.extend(page)
        if not page or not next_cursor:
            return rows
        if next_cursor == cursor:
            return None  # a repeated cursor never ends: the rows so far are a lower bound
        cursor = next_cursor
    return None


def _is_open_position(row: Mapping[str, Any]) -> bool:
    """A position row with a non-zero size; the venue also lists flat rows. A row without a
    parseable size raises: counting it as flat would let the category read ``ok`` with an under-count."""
    size = row.get("size")
    if not isinstance(size, (str, int, float)) or isinstance(size, bool):
        raise ValueError("position row has no readable size")
    held = float(size)  # ValueError on an unparseable string
    if not math.isfinite(held):
        raise ValueError("position row has no readable size")
    return held > 0


async def measure_exposure(client: Any, now_ms: int) -> dict[str, Any]:
    """Section C: whether the key holds stable coins other than USDT or non-stable coins (the
    shared ``is_stable_value`` rule, no coin list here), the open positions and the read state per
    category, and the inverse closed-pnl rows over 30 days. Each read is in its own ``try``: a venue
    refusal (``PermissionDenied`` only: a ``BadRequest`` is a parameter error of this probe, not a
    scope finding) of one category reads ``refused`` for that category only, any other failure
    reads ``failed``, and the others still run. The closed-pnl read has its own state
    (``inverse_closed_pnl_read``) beside its count. A reading whose read did not complete stays
    ``field-absent``, never 0."""
    values: dict[str, Any] = {name: FIELD_ABSENT for name in _SECTION_C_KEYS}
    view = _section_view(client, C_CEILING)

    try:
        balance = await view.fetch_balance()
        total = balance.get("total") if isinstance(balance, Mapping) else None
        if not isinstance(total, Mapping):
            raise ValueError("balance has no totals")
        stable = nonstable = False
        for coin, amount in total.items():
            if amount is None:
                continue
            held = float(amount)
            if not math.isfinite(held) or held <= 0:
                continue
            code = str(coin).upper()
            if code == "USDT":
                continue
            if is_stable_value(code):
                stable = True
            else:
                nonstable = True
        values["stable_non_usdt_present"] = stable
        values["nonstable_present"] = nonstable
    except Exception:  # noqa: BLE001 - an unreadable balance leaves both readings absent
        pass

    for name, params in _POSITION_READS:
        try:
            rows = await _paged_rows(
                view,
                "private_get_v5_position_list",
                {**params, "limit": _POSITION_LIMIT},
                POSITION_PAGE_CAP,
            )
            if rows is None:
                raise ValueError("a category has more pages than the cap")
            open_rows = sum(1 for row in rows if _is_open_position(row))
        except ccxt.PermissionDenied:
            values[f"positions_read_{name}"] = "refused"
        except Exception:  # noqa: BLE001 - any other failure, a spent budget included
            values[f"positions_read_{name}"] = "failed"
        else:
            values[f"positions_read_{name}"] = "ok"
            values[f"positions_open_{name}"] = open_rows

    try:
        closed = 0
        for window_start, window_end in _tile(now_ms - EXPOSURE_CLOSED_PNL_DAYS * _DAY_MS, now_ms):
            window_rows = await _paged_rows(
                view,
                "private_get_v5_position_closed_pnl",
                {
                    "category": "inverse",
                    "limit": _EXEC_PAGE_LIMIT,
                    "startTime": str(window_start),
                    "endTime": str(window_end),
                },
                CLOSED_PNL_PAGE_CAP,
            )
            if window_rows is None:
                raise ValueError("a window has more pages than the cap")
            closed += len(window_rows)
    except ccxt.PermissionDenied:
        values["inverse_closed_pnl_read"] = "refused"
    except Exception:  # noqa: BLE001 - failed or cut short: not measured, never 0
        values["inverse_closed_pnl_read"] = "failed"
    else:
        values["inverse_closed_pnl_read"] = "ok"
        values["inverse_closed_pnl_rows_30d"] = closed
    return values


# ---------------------------------------------------------------------------
# Section D: one real funding walk, timed (census row C27).
# ---------------------------------------------------------------------------

_LOG_METHOD: Final[str] = "private_get_v5_account_transaction_log"


async def measure_funding(client: Any) -> dict[str, Any]:
    """Section D: one real ``fetch_funding_bybit(view, <synthetic label>, None)`` walk, exactly as
    the funding sync starts from an empty table, with its seconds, calls and state.

    ``funding_state``: ``complete``; ``ceiling`` (the fetcher's own page ceiling, a named refusal);
    ``call_ceiling`` (this section's budget, checked on the view BEFORE the exception class is
    trusted); ``timeout`` (``FUNDING_DEADLINE_S``, a reading, not a crash, because the production
    symptom is a funding read that never finishes); ``failed``. Seconds and calls are taken from the
    view after the read ends, so a timeout keeps both. The rows per category come from the view's
    aligned requests and replies; they are counted only for a complete walk. The inverse category
    is skipped by the fetcher when the venue refuses it on any page, which shows as a call that
    raised (more calls than recorded requests); the inverse rows then read ``field-absent``.
    Rows are counted, never printed."""
    values: dict[str, Any] = {name: FIELD_ABSENT for name in _SECTION_D_KEYS}
    view = _section_view(client, D_CEILING)
    started = _monotonic()
    state = "complete"
    rows_by_category = {"linear": 0, "inverse": 0}
    try:
        await asyncio.wait_for(
            fetch_funding_bybit(view, _FUNDING_PROBE_LABEL, None), FUNDING_DEADLINE_S
        )
        # Counted inside the try: a reply the row count cannot read is a failed walk, not a crash.
        for request, reply in zip(view.requests.get(_LOG_METHOD, []), view.replies.get(_LOG_METHOD, [])):
            category = str(request.get("category", ""))
            if category in rows_by_category:
                rows_by_category[category] += len(_result_page(reply)[0])
    except Exception as exc:  # noqa: BLE001 - the state is the reading; class and message are not printed
        if view.ceiling_reached:
            state = "call_ceiling"
        elif isinstance(exc, TimeoutError):
            state = "timeout"
        elif isinstance(exc, FundingFetchCeilingExceeded):
            state = "ceiling"
        else:
            state = "failed"
    values["funding_state"] = state
    values["funding_read_s"] = _sig3_or_absent(_monotonic() - started)
    values["funding_calls"] = view.calls
    if state == "complete":
        # A call that raised is counted in ``calls`` but recorded in no request or reply. The walk
        # completed, so the only raise the fetcher swallowed is the venue's refusal of the inverse
        # category (on any page): the inverse rows are then a lower bound, never a measured count.
        inverse_skipped = view.calls > len(view.requests.get(_LOG_METHOD, []))
        values["funding_rows_linear"] = rows_by_category["linear"]
        values["funding_rows_inverse"] = FIELD_ABSENT if inverse_skipped else rows_by_category["inverse"]
        values["funding_inverse_skipped"] = inverse_skipped
    return values


# ---------------------------------------------------------------------------
# Run layer.
# ---------------------------------------------------------------------------


def _key_record(label: str, run_date: str, **values: Any) -> dict[str, Any]:
    """A key record with every reading ``field-absent`` and ``measured`` false until given."""
    unknown = sorted(set(values) - set(KEY_RECORD_KEYS))
    if unknown:
        raise ValueError(f"_key_record: keys outside the whitelist {unknown}")
    defaults: dict[str, Any] = {key: FIELD_ABSENT for key in KEY_RECORD_KEYS}
    return {
        **defaults,
        "record": "key",
        "label": label,
        "venue": "bybit",
        "run_date": run_date,
        "measured": False,
        "unmeasurable_reason": "none",
        **values,
    }


def _unmeasured_record(label: str, run_date: str, exc: BaseException | None = None) -> dict[str, Any]:
    """The record of a key that was not measured: a closed reason, every reading ``field-absent``.
    No exception means the key is not eligible."""
    if exc is None:
        return _key_record(label, run_date, unmeasurable_reason="key_not_eligible")
    reason, _failure_class = failure_token(exc)
    return _key_record(label, run_date, unmeasurable_reason=reason)


async def _measure_key(client: Any, now_ms: int) -> dict[str, Any]:
    """One key's readings. Each section has its own view, ceiling and bounds, so a section that
    runs out does not stop the next."""
    values: dict[str, Any] = {}
    values.update(await measure_trades(client, now_ms))
    values.update(await measure_deposits(client, now_ms))
    values.update(await measure_exposure(client, now_ms))
    values.update(await measure_funding(client))
    return values


def section_failures(record: Mapping[str, Any]) -> int:
    """How many of the four sections did not complete on one MEASURED key, read from the record's
    own keys: A when its read state is anything but complete, its sweep was not complete, the legacy
    walk stopped on a page cap or a repeated cursor or the start-less count was not reported, B when
    the deposit verdict is ``unread``, C when the balance, any category read or the inverse
    closed-pnl read failed (a venue ``refused`` is a finding, not a failure), D when the funding
    walk did not complete."""
    failed = 0
    if (
        record["trade_read_state"] != "complete"
        or record["trade_sweep_complete"] is not True
        or record["trade_legacy_end"] not in _NATURAL_ENDS
        or record["trade_startless_rows"] == FIELD_ABSENT
    ):
        failed += 1
    if record["deposit_verdict"] == "unread":
        failed += 1
    position_states = (
        record["positions_read_linear_usdt"],
        record["positions_read_linear_usdc"],
        record["positions_read_inverse"],
    )
    if record["stable_non_usdt_present"] == FIELD_ABSENT or "failed" in (
        *position_states,
        record["inverse_closed_pnl_read"],
    ):
        failed += 1
    if record["funding_state"] != "complete":
        failed += 1
    return failed


def _max_seconds(records: Sequence[Mapping[str, Any]], key: str) -> float | str:
    shown = [r[key] for r in records if isinstance(r[key], float)]
    return max(shown) if shown else FIELD_ABSENT


def _total_if_all_read(records: Sequence[Mapping[str, Any]], key: str) -> int | str:
    """The sum of a count over the measured keys, or ``field-absent`` unless every one of them read
    it: a key that did not read it would otherwise look like a key that holds zero."""
    if not records:
        return FIELD_ABSENT
    values = [r[key] for r in records]
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in values):
        return FIELD_ABSENT
    return sum(int(v) for v in values)


def summarize(records: Sequence[Mapping[str, Any]], run_date: str) -> dict[str, Any]:
    """Counts and maxima derived from the key records in code. ``keys`` counts every record
    printed; ``keys_unmeasurable`` counts the eligible keys the probe could not measure (a key the
    backfill does not derive is not counted against it)."""
    measured = [r for r in records if r["measured"]]
    not_eligible = [r for r in records if r["unmeasurable_reason"] == "key_not_eligible"]
    pages = [
        r["trade_sweep_pages_max_in_window"]
        for r in measured
        if isinstance(r["trade_sweep_pages_max_in_window"], int)
        and not isinstance(r["trade_sweep_pages_max_in_window"], bool)
    ]
    sweep_incomplete = sum(1 for r in measured if r["trade_sweep_complete"] is not True)
    summary: dict[str, Any] = {
        "record": "summary",
        "run_date": run_date,
        "keys": len(records),
        "keys_measured": len(measured),
        "keys_unmeasurable": len(records) - len(measured) - len(not_eligible),
        # The page counts of an incomplete sweep are lower bounds, and this maximum sizes plan 04's
        # per-window page cap: it is reported only when every measured sweep completed.
        "trade_sweep_pages_max": max(pages) if pages and sweep_incomplete == 0 else FIELD_ABSENT,
        "trade_sweep_read_s_max": _max_seconds(measured, "trade_sweep_read_s"),
        "trade_sweep_incomplete": sweep_incomplete,
        "positions_refused_linear_usdc": sum(
            1 for r in measured if r["positions_read_linear_usdc"] == "refused"
        ),
        "positions_refused_inverse": sum(1 for r in measured if r["positions_read_inverse"] == "refused"),
        "positions_open_inverse_total": _total_if_all_read(measured, "positions_open_inverse"),
        "inverse_closed_pnl_rows_30d_total": _total_if_all_read(measured, "inverse_closed_pnl_rows_30d"),
        "funding_rows_inverse_total": _total_if_all_read(measured, "funding_rows_inverse"),
        "funding_read_s_max": _max_seconds(measured, "funding_read_s"),
        "funding_incomplete": sum(1 for r in measured if r["funding_state"] != "complete"),
        "sections_failed": sum(section_failures(r) for r in measured),
    }
    for verdict in TRADE_VERDICTS:
        summary[f"trade_verdict_{verdict}"] = sum(
            1 for r in measured if r["trade_window_verdict"] == verdict
        )
    for verdict in DEPOSIT_VERDICTS:
        summary[f"deposit_verdict_{verdict}"] = sum(
            1 for r in measured if r["deposit_verdict"] == verdict
        )
    return summary


async def _read_one_key(key_row: Mapping[str, Any], kek: bytes, now_ms: int) -> dict[str, Any]:
    """Decrypt, build the client, measure and close the client in every case. Raises on any
    failure; ``failure_token`` names it."""
    from services.encryption import decrypt_credentials
    from services.exchange import aclose_exchange
    from services.job_worker import _make_exchange_client

    client: Any = None
    try:
        api_key, api_secret, passphrase = decrypt_credentials(dict(key_row), kek)
        client = _make_exchange_client("bybit", api_key, api_secret, passphrase)
        return await _measure_key(client, now_ms)
    finally:
        if client is not None:
            await aclose_exchange(client)


async def run() -> int:
    """Select the Bybit keys, measure each key the backfill derives, and print one JSON line per
    key and a summary."""
    from services.db import db_execute, get_supabase, rows
    from services.encryption import get_kek

    supabase = ReadOnlySupabase(get_supabase())

    def _load_keys() -> Any:
        return (
            supabase.table("api_keys")
            .select("*")
            .in_("exchange", ["bybit"])
            .order("created_at")
            .execute()
        )

    key_rows = rows(await db_execute(_load_keys))
    if len(key_rows) > _MAX_KEYS:
        print("refused: more keys than the label can carry", file=sys.stderr)
        return EXIT_FAILED
    run_at = _utc_now()
    run_date = run_at.strftime("%Y-%m-%d")
    now_ms = int(run_at.timestamp() * 1000)
    kek: bytes | None = None
    records: list[dict[str, Any]] = []
    for index, key_row in enumerate(key_rows, start=1):
        label = f"k{index}"
        if not eligible_key_predicate(key_row):
            record = _unmeasured_record(label, run_date)
        else:
            if kek is None:
                kek = get_kek()
            try:
                values = await _read_one_key(key_row, kek, now_ms)
                record = _key_record(label, run_date, measured=True, **values)
            except Exception as exc:  # noqa: BLE001 - mapped to a closed token; the message is never read
                print(f"{label} failed: {type(exc).__name__}", file=sys.stderr)
                record = _unmeasured_record(label, run_date, exc)
        records.append(record)
        print(emit_record(record), flush=True)
    summary = summarize(records, run_date)
    print(emit_record(summary), flush=True)
    if summary["keys_measured"] == 0:
        # An empty key list, or only keys the backfill does not derive, measured nothing: that is
        # no evidence, not a pass.
        print("refused: no eligible key was measured", file=sys.stderr)
        return EXIT_FAILED
    return (
        EXIT_OK
        if summary["keys_unmeasurable"] == 0 and summary["sections_failed"] == 0
        else EXIT_FAILED
    )


def deploy_fingerprint() -> str:
    """One line naming the shape of the deployed probe: the two exit codes and the sizes of the
    key record, summary record and the two verdict vocabularies. The orchestrator prints it on the
    worker and compares it with the line computed at the reviewed commit, so the worker is shown to
    run the reviewed code."""
    return " ".join(
        [
            "bybitreads",
            str(EXIT_OK),
            str(EXIT_FAILED),
            str(len(KEY_RECORD_KEYS)),
            str(len(SUMMARY_RECORD_KEYS)),
            str(len(DEPOSIT_VERDICTS)),
            str(len(TRADE_VERDICTS)),
        ]
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="BYBITREADS read-only Bybit read probe (takes no arguments)"
    )
    parser.parse_args(argv)
    logging.disable(logging.CRITICAL)
    try:
        return asyncio.run(run())
    except Exception as exc:  # noqa: BLE001 - the TYPE only; a message can carry an id
        print(f"failed: {type(exc).__name__}", file=sys.stderr)
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
