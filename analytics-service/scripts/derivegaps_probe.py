"""Phase 186 DERIVEGAPS: the read-only SC-1 probe for the per-key derive's realized-read gaps.

D-01 (founder): the count that decides which of the derive's silent partials are real needs the
stored keys, and a key decrypts only inside the worker. So the count is a worker-side probe,
modelled on ``scripts/walletoffset_probe.py``. It adds no caller to any service and changes no
derive, compose or reader behaviour.

WHAT IT MEASURES. This module holds the Gap 1 section: for every eligible OKX, Bybit and Binance
key the probe runs the REAL ``fetch_all_trades(view, since_ms=None)`` (the derive's own realized
read, so its verdict is the derive's, not a re-implementation that could drift), then drains
``get_and_clear_last_dq_flags()`` from inside the same coroutine and records

  * ``realized_state``: ``complete``, ``truncated`` (a page cap hit), ``fetch_error`` (the
    derive's own error flag) or ``timeout`` (the per-key bound);
  * every data-quality flag as a boolean and the failure class as a closed token;
  * the pages each endpoint took (OKX bills and bills-archive per instType, Bybit windows and
    the deepest window), the elapsed seconds and the seconds per page;
  * for a truncated key only, the pages the full history needs, found by continuing the same
    walk past today's cap up to ``CONTINUATION_PAGE_CEILING`` pages, and whether the end was
    reached (D-06 sizes the new caps from this);
  * the Bybit closed-pnl ``limit`` of 200 against the documented maximum of 100: one 7-day
    window read at each limit.

Plan 186-03 adds two more sections to the same record:

  * Gap 2 (Bybit only, D-02): the account type (UTA or not), the on-chain deposit and withdrawal
    counts the derive reads today, the Unified TRANSFER_IN / TRANSFER_OUT counts the ready reader
    returns, and the overlap between them from ``pair_onchain_with_unified`` (the service's own
    rule). Net flows appear only as 3-significant-figure shares of the account's anchor.
  * Gap 4 (OKX and Bybit funding, D-04): the REAL ``fetch_funding_okx`` / ``fetch_funding_bybit``
    run through the recording view, then from the raw replies the count of (instrument, UTC hour)
    groups holding two or more distinct bill ids (real same-hour legs), groups holding one id twice
    (recent and archive overlap), and rows the repo's own ``_normalize_funding_row`` drops.

  Per key, the seconds spent in the equity read, funding, on-chain flows and Unified flows are
  recorded so D-06 can split the derive's outer budget from measured data.

REDACTION CONTRACT (the output is pasted into a tracked file in a public repo): labels
``k1..kN``, counts, booleans, closed-vocabulary tokens, age buckets and 3-significant-figure
seconds. No id, amount, venue text or key. The only path to stdout is ``emit_record``, which
refuses any key outside the declared records and any value outside the declared vocabulary,
then re-checks with ``assert_sanitized``. "Not measured" is the word ``field-absent``, never 0.
Logging is switched off for the run, and a run-level failure prints the exception TYPE only.
Rows are counted, never printed.

READ-ONLY. The database is obtained once, through ``ReadOnlySupabase`` (select only). Every venue
call goes through ``ReadOnlyRecordingExchange``: it resolves implicit GET methods and a closed
list of read methods and attributes, counts each call and stops at the key's bound,
``KEY_CALL_CEILING + FLOWS_FUNDING_CALL_BUDGET`` (4,000 calls; the realized read, the limit probe
and the continuation share the first 3,000). Keys
are decrypted inside the worker process and nowhere else.

USAGE. No arguments, so no identifier is ever typed. Run once on the Railway backfill worker
through a temporary start-command wrapper, read the lines from the service log and paste only
the lines that start with an opening brace and a quote (one per key, then one summary). Before
the run, the worker's deployed copy proves it is the reviewed one:
``python -c 'import scripts.derivegaps_probe as p; print(p.deploy_fingerprint())'`` prints one
line that must equal the line computed at the reviewed commit.

EXIT CODES
----------
  0  every eligible key was measured (a key the backfill does not derive is not counted)
  1  any eligible key could not be measured, any section after the realized read was skipped
     (``<venue>_sections_skipped``), any on-chain, Unified or funding read ended in a venue error
     (``bybit_onchain_failed``, ``bybit_unified_venue_error``, ``<venue>_funding_fetch_error``),
     or any other failure (the exception TYPE only on stderr)
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
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from datetime import date, datetime, timezone
from typing import Any, Final, NamedTuple

import ccxt

from scripts.bybit_funding_record import AGE_BUCKETS, age_bucket, read_key_info
from scripts.bybit_upnl_probe import FAILURE_CLASSES, FIELD_ABSENT, classify_failure, sig3
from scripts.deribit_ground_truth import assert_sanitized
from scripts.walletoffset_probe import ReadOnlySupabase
from services.allocator_equity_derive import eligible_key_predicate
from services.bybit_unified_flows import (
    BybitUnifiedFlowReadError,
    fetch_bybit_unified_flows,
    pair_onchain_with_unified,
)
from services.ccxt_flow_fetch import fetch_ccxt_transfers
from services.closed_sets import STABLECOINS
from services.exchange import (
    fetch_account_equity_and_upnl_usd,
    fetch_all_trades,
    get_and_clear_last_dq_flags,
    normalize_symbol,
)
from services.funding_fetch import (
    FundingFetchCeilingExceeded,
    _normalize_funding_row,
    fetch_funding_bybit,
    fetch_funding_okx,
)
from services.nav_twr import flow_retention_floor
from services.okx_bills_chain import CallCeilingReached

EXIT_OK: Final[int] = 0
EXIT_FAILED: Final[int] = 1

PROBE_VENUES: Final[tuple[str, ...]] = ("okx", "bybit", "binance")

#: The budget of one key's realized read, limit probe and continuation. The worst realized read
#: today is about 800 OKX pages or about 2,650 Bybit pages; the ceiling sits above both so a heavy
#: key is measured, not refused. A key's whole bound is this plus ``FLOWS_FUNDING_CALL_BUDGET``.
KEY_CALL_CEILING: Final[int] = 3000
#: Calls held back for the Bybit flows and for funding. The realized read, the limit probe and the
#: continuation past the cap run under ``KEY_CALL_CEILING``; these two sections then run under the
#: ceiling plus this, so a continuation that spent its budget cannot starve them. About 200 pages
#: each for the OKX funding endpoints, the Bybit funding log and the Unified flow windows.
FLOWS_FUNDING_CALL_BUDGET: Final[int] = 1000
#: The realized read's bound. The derive bounds each crawl at 810 s under a 900 s outer budget;
#: the probe waits longer so a key slower than the derive's budget reads ``timeout`` only when it
#: is far past it, and the elapsed time it records is a real figure.
KEY_READ_TIMEOUT_S: float = 1200.0
#: The equity read is one call; this bound only stops a hung connection.
EQUITY_READ_TIMEOUT_S: float = 120.0
#: Pages the continuation reads past today's cap, per endpoint and instType (or per Bybit window).
CONTINUATION_PAGE_CEILING: Final[int] = 400

#: Today's caps, copied from ``fetch_daily_pnl`` where they are function-local constants (plan
#: 186-05 hoists them to module level). A cap hit needs ALL of: the last allowed page was read,
#: and it was full (OKX) or still had a next cursor (Bybit), exactly the derive's own test.
TODAY_OKX_PAGE_CAP: Final[int] = 100
TODAY_OKX_PAGE_ROWS: Final[int] = 100
TODAY_BYBIT_PAGE_CAP: Final[int] = 50

REALIZED_STATES: Final[tuple[str, ...]] = ("complete", "truncated", "fetch_error", "timeout")

#: Every reason a key can print instead of a measurement. ``key_not_eligible`` is the refusal
#: the backfill's own dispatch filter gives; ``failure`` carries an allow-listed class.
UNMEASURABLE_REASONS: Final[tuple[str, ...]] = (
    "none",
    "key_not_eligible",
    "call_ceiling",
    "timeout",
    "failure",
)

#: Why a section after the realized read left no readings: a spent call budget, the key's total
#: bound, or the closed class of a venue error. ``none`` is a section that ran.
SECTION_SKIP_REASONS: Final[tuple[str, ...]] = tuple(
    dict.fromkeys(("none", "call_ceiling", "timeout", *FAILURE_CLASSES))
)

#: The label k1..kN carries up to three digits.
_MAX_KEYS: Final[int] = 999
_LABEL_RE = re.compile(r"^k[0-9]{1,3}$")
_DATE_RE = re.compile(r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")

# ---------------------------------------------------------------------------
# The read-only, counting, recording view of an exchange client.
# ---------------------------------------------------------------------------

#: Plain attributes the derive's fetchers read off a client.
_PLAIN_ATTRS: Final[tuple[str, ...]] = ("id", "markets", "has", "options", "rateLimit")

#: ccxt's implicit GET methods, in the naming styles the fetchers use (snake_case, the Binance
#: futures camel case, and the plain camel case ``fetch_ccxt_transfers`` reads Bybit's deposit and
#: withdraw records with). A POST implicit method starts differently and never resolves.
_GET_PREFIXES: Final[tuple[str, ...]] = (
    "private_get_",
    "public_get_",
    "privateGet",
    "publicGet",
    "fapiPrivate_get_",
    "fapiPublic_get_",
    "fapiPrivateGet",
    "fapiPublicGet",
)

#: Pure, synchronous parsing helpers of the client that ``fetch_ccxt_transfers`` calls on a Bybit
#: answer. They do no I/O, so they resolve to the client's own bound method, uncounted.
_PURE_HELPERS: Final[tuple[str, ...]] = ("add_pagination_cursor_to_result", "parse_transactions")

#: The ccxt unified READS the derive's fetchers call. Nothing else unified resolves.
_READ_METHODS: Final[tuple[str, ...]] = (
    "fetch_deposits",
    "fetch_withdrawals",
    "fetch_balance",
    "fetch_my_trades",
    "load_markets",
)


class ReadOnlyRecordingExchange:
    """A GET-only, counted view of an exchange client that keeps every reply in memory.

    Resolves the plain attributes the fetchers read, the pure parsing helpers, the implicit GET
    methods and the closed ``_READ_METHODS``; every other name is an ``AttributeError``. Each call is counted in
    ``calls`` and refused BEFORE the inner call once ``calls`` has reached the ceiling, so the
    venue never sees the call that would exceed the budget; ``ceiling_reached`` then reads True,
    which is how the probe tells a spent budget from a venue failure (the derive's own handlers
    turn the raised refusal into an error flag).

    ``replies[name]`` and ``requests[name]`` are aligned, one entry per SUCCESSFUL call (a call
    that raised, a retried 429 included, is counted in ``calls`` but recorded in neither). They
    live in memory and are never printed."""

    def __init__(self, inner: Any, ceiling: int) -> None:
        self._inner = inner
        self.ceiling = ceiling
        self.calls = 0
        self.ceiling_reached = False
        self.replies: dict[str, list[Any]] = {}
        self.requests: dict[str, list[dict[str, Any]]] = {}
        #: The equity read's 4-tuple, kept for plan 186-03's ratios; never printed.
        self.equity_reading: tuple[float | None, bool, float, bool] | None = None
        #: The page walks of the realized read, taken before any continuation.
        self.realized_walks: list[Walk] = []

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        if name in _PLAIN_ATTRS or name in _PURE_HELPERS:
            return getattr(self._inner, name)
        if not (name in _READ_METHODS or name.startswith(_GET_PREFIXES)):
            raise AttributeError(f"ReadOnlyRecordingExchange resolves reads only, not {name!r}")
        method = getattr(self._inner, name)

        async def _counted(*args: Any, **kwargs: Any) -> Any:
            if self.calls >= self.ceiling:
                self.ceiling_reached = True
                raise CallCeilingReached(self.ceiling)
            self.calls += 1
            reply = await method(*args, **kwargs)
            first = args[0] if args else None
            self.requests.setdefault(name, []).append(dict(first) if isinstance(first, dict) else {})
            self.replies.setdefault(name, []).append(reply)
            return reply

        return _counted


# ---------------------------------------------------------------------------
# The closed record vocabulary, declared once and used by the validator and the builders.
# ---------------------------------------------------------------------------

KEY_RECORD_KEYS: Final[tuple[str, ...]] = (
    "record",
    "key",
    "venue",
    "run_date",
    "measured",
    "unmeasurable_reason",
    "failure_class",
    "realized_state",
    "flag_truncated_okx",
    "flag_truncated_bybit",
    "flag_fetch_error",
    "flag_binance_income_fallback",
    "fetch_error_class",
    "realized_rows",
    "realized_days",
    "realized_oldest_age",
    "okx_bills_pages_max",
    "okx_archive_pages_max",
    "okx_inst_types_at_cap",
    "bybit_windows",
    "bybit_pages_max_in_window",
    "bybit_windows_at_cap",
    "realized_elapsed_s",
    "realized_s_per_page",
    "equity_elapsed_s",
    "pages_needed_okx_bills",
    "pages_needed_okx_archive",
    "pages_needed_bybit_window",
    "past_cap_reached_end",
    "past_cap_oldest_age",
    "past_cap_skip",
    "bybit_limit_skip",
    "bybit_flows_skip",
    "funding_skip",
    "bybit_limit200_rows",
    "bybit_limit100_rows",
    "bybit_limit200_error",
    "bybit_limit100_error",
    "bybit_limit200_error_class",
    "bybit_limit100_error_class",
    "bybit_limit_probe_informative",
    "onchain_deposits",
    "onchain_withdrawals",
    "unified_in",
    "unified_out",
    "paired_deposits",
    "paired_withdrawals",
    "unpaired_onchain_deposits",
    "unpaired_onchain_withdrawals",
    "pairing_unreadable_rows",
    "pairing_near_miss_rows",
    "bybit_is_uta",
    "bybit_is_master",
    "anchor_unreadable",
    "onchain_read_state",
    "unified_read_state",
    "unified_net_over_anchor",
    "unpaired_onchain_net_over_anchor",
    "nonstable_flow_rows",
    "flows_elapsed_s",
    "unified_elapsed_s",
    "funding_state",
    "funding_raw_rows",
    "funding_kept_rows",
    "funding_same_hour_distinct_pairs",
    "funding_same_hour_same_id",
    "funding_malformed_rows",
    "funding_elapsed_s",
)

_FLAG_KEYS: Final[tuple[str, ...]] = (
    "flag_truncated_okx",
    "flag_truncated_bybit",
    "flag_fetch_error",
    "flag_binance_income_fallback",
    "past_cap_reached_end",
    "bybit_limit200_error",
    "bybit_limit100_error",
    "bybit_limit_probe_informative",
    "bybit_is_uta",
    "bybit_is_master",
    "anchor_unreadable",
)

_COUNT_KEYS: Final[tuple[str, ...]] = (
    "realized_rows",
    "realized_days",
    "okx_bills_pages_max",
    "okx_archive_pages_max",
    "okx_inst_types_at_cap",
    "bybit_windows",
    "bybit_pages_max_in_window",
    "bybit_windows_at_cap",
    "pages_needed_okx_bills",
    "pages_needed_okx_archive",
    "pages_needed_bybit_window",
    "bybit_limit200_rows",
    "bybit_limit100_rows",
    "onchain_deposits",
    "onchain_withdrawals",
    "unified_in",
    "unified_out",
    "paired_deposits",
    "paired_withdrawals",
    "unpaired_onchain_deposits",
    "unpaired_onchain_withdrawals",
    "pairing_unreadable_rows",
    "pairing_near_miss_rows",
    "nonstable_flow_rows",
    "funding_raw_rows",
    "funding_kept_rows",
    "funding_same_hour_distinct_pairs",
    "funding_same_hour_same_id",
    "funding_malformed_rows",
)

_SECONDS_KEYS: Final[tuple[str, ...]] = (
    "realized_elapsed_s",
    "realized_s_per_page",
    "equity_elapsed_s",
    "flows_elapsed_s",
    "unified_elapsed_s",
    "funding_elapsed_s",
)

#: A net flow as a share of the account's anchor: signed, three significant figures.
_RATIO_KEYS: Final[tuple[str, ...]] = (
    "unified_net_over_anchor",
    "unpaired_onchain_net_over_anchor",
)

#: How a Bybit flow read ended. ``reader_error`` is the Unified reader's own refusal to return
#: less than the venue holds; ``venue_error`` is any other exception (its class is not printed).
ONCHAIN_READ_STATES: Final[tuple[str, ...]] = ("complete", "failed")
UNIFIED_READ_STATES: Final[tuple[str, ...]] = ("complete", "reader_error", "venue_error")
#: How a funding read ended: ``truncated`` is the fetcher's own page-ceiling refusal.
FUNDING_STATES: Final[tuple[str, ...]] = ("complete", "truncated", "fetch_error")
#: The venues whose funding the probe reads (Binance funding is Phase 187).
FUNDING_VENUES: Final[tuple[str, ...]] = ("okx", "bybit")


#: The six Gap 2 flow sums and the key-record counts each adds. They read ``field-absent`` unless
#: every Bybit key was measured and read both sides in full (a failed read adds nothing to a sum).
_BYBIT_FLOW_SUM_FIELDS: Final[dict[str, tuple[str, ...]]] = {
    "bybit_onchain_rows": ("onchain_deposits", "onchain_withdrawals"),
    "bybit_unified_rows": ("unified_in", "unified_out"),
    "bybit_paired_rows": ("paired_deposits", "paired_withdrawals"),
    "bybit_unpaired_onchain_rows": ("unpaired_onchain_deposits", "unpaired_onchain_withdrawals"),
    "bybit_pairing_unreadable_rows": ("pairing_unreadable_rows",),
    "bybit_near_miss_rows": ("pairing_near_miss_rows",),
}

#: Gap 2 aggregates, Bybit keys only. The three account-type counts split the MEASURED Bybit keys.
_BYBIT_FLOW_SUMMARY_KEYS: Final[tuple[str, ...]] = (
    "bybit_uta",
    "bybit_non_uta",
    "bybit_uta_unknown",
    "bybit_onchain_rows",
    "bybit_unified_rows",
    "bybit_paired_rows",
    "bybit_unpaired_onchain_rows",
    "bybit_pairing_unreadable_rows",
    "bybit_near_miss_rows",
    "bybit_unified_reader_errors",
    "bybit_onchain_complete",
    "bybit_onchain_failed",
    "bybit_onchain_not_read",
    "bybit_unified_complete",
    "bybit_unified_venue_error",
    "bybit_unified_not_read",
    "bybit_anchor_unreadable",
    "bybit_max_flows_s",
)


def _summary_record_keys() -> tuple[str, ...]:
    keys = ["record", "run_date", "keys", "keys_measured", "keys_unmeasurable", "keys_not_eligible"]
    for venue in PROBE_VENUES:
        keys += [
            f"{venue}_keys",
            f"{venue}_realized_complete",
            f"{venue}_realized_truncated",
            f"{venue}_realized_fetch_error",
            f"{venue}_realized_timeout",
            f"{venue}_max_s_per_page",
            f"{venue}_max_realized_s",
            f"{venue}_max_pages_needed",
            f"{venue}_keys_still_short_after_ceiling",
            f"{venue}_sections_skipped",
        ]
    keys += list(_BYBIT_FLOW_SUMMARY_KEYS)
    for venue in FUNDING_VENUES:
        keys += [f"{venue}_funding_{state}" for state in (*FUNDING_STATES, "not_read")]
        keys += [
            f"{venue}_funding_pairs",
            f"{venue}_funding_malformed",
            f"{venue}_max_funding_s",
        ]
    keys += [f"{venue}_max_nonrealized_s" for venue in PROBE_VENUES]
    return tuple(keys)


SUMMARY_RECORD_KEYS: Final[tuple[str, ...]] = _summary_record_keys()


def _is_bool_or_absent(x: Any) -> bool:
    return isinstance(x, bool) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_bool(x: Any) -> bool:
    return isinstance(x, bool)


def _is_count(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0


def _is_count_or_absent(x: Any) -> bool:
    return _is_count(x) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_sig3_float(x: Any) -> bool:
    return isinstance(x, float) and math.isfinite(x) and x >= 0.0 and float(f"{x:.3g}") == x


def _is_ratio_or_absent(x: Any) -> bool:
    if isinstance(x, str):
        return x == FIELD_ABSENT
    return isinstance(x, float) and math.isfinite(x) and float(f"{x:.3g}") == x


def _is_seconds_or_absent(x: Any) -> bool:
    if isinstance(x, str):
        return x == FIELD_ABSENT
    return _is_sig3_float(x)


def _is_str_matching(pattern: re.Pattern[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and pattern.match(x) is not None


def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed


_KEY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("key",)),
    "key": _is_str_matching(_LABEL_RE),
    "venue": _is_one_of(PROBE_VENUES),
    "run_date": _is_str_matching(_DATE_RE),
    "measured": _is_bool,
    "unmeasurable_reason": _is_one_of(UNMEASURABLE_REASONS),
    "failure_class": _is_one_of(FAILURE_CLASSES),
    "realized_state": _is_one_of((*REALIZED_STATES, FIELD_ABSENT)),
    "fetch_error_class": _is_one_of((*FAILURE_CLASSES, FIELD_ABSENT)),
    "realized_oldest_age": _is_one_of((*AGE_BUCKETS, FIELD_ABSENT)),
    "past_cap_oldest_age": _is_one_of((*AGE_BUCKETS, FIELD_ABSENT)),
    **{
        key: _is_one_of((*SECTION_SKIP_REASONS, FIELD_ABSENT))
        for key in ("past_cap_skip", "bybit_limit_skip", "bybit_flows_skip", "funding_skip")
    },
    **{key: _is_bool_or_absent for key in _FLAG_KEYS},
    **{key: _is_count_or_absent for key in _COUNT_KEYS},
    **{key: _is_seconds_or_absent for key in _SECONDS_KEYS},
    **{key: _is_ratio_or_absent for key in _RATIO_KEYS},
    "onchain_read_state": _is_one_of((*ONCHAIN_READ_STATES, FIELD_ABSENT)),
    "unified_read_state": _is_one_of((*UNIFIED_READ_STATES, FIELD_ABSENT)),
    "funding_state": _is_one_of((*FUNDING_STATES, FIELD_ABSENT)),
    "bybit_limit200_error_class": _is_one_of((*FAILURE_CLASSES, FIELD_ABSENT)),
    "bybit_limit100_error_class": _is_one_of((*FAILURE_CLASSES, FIELD_ABSENT)),
}

_SUMMARY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("summary",)),
    "run_date": _is_str_matching(_DATE_RE),
    "keys": _is_count,
    "keys_measured": _is_count,
    "keys_unmeasurable": _is_count,
    "keys_not_eligible": _is_count,
}
for _venue in PROBE_VENUES:
    _SUMMARY_VALIDATORS[f"{_venue}_keys"] = _is_count
    for _state in REALIZED_STATES:
        _SUMMARY_VALIDATORS[f"{_venue}_realized_{_state}"] = _is_count
    _SUMMARY_VALIDATORS[f"{_venue}_max_s_per_page"] = _is_seconds_or_absent
    _SUMMARY_VALIDATORS[f"{_venue}_max_realized_s"] = _is_seconds_or_absent
    _SUMMARY_VALIDATORS[f"{_venue}_max_pages_needed"] = _is_count_or_absent
    _SUMMARY_VALIDATORS[f"{_venue}_keys_still_short_after_ceiling"] = _is_count
    _SUMMARY_VALIDATORS[f"{_venue}_sections_skipped"] = _is_count
for _name in _BYBIT_FLOW_SUMMARY_KEYS:
    _SUMMARY_VALIDATORS[_name] = (
        _is_seconds_or_absent
        if _name.endswith("_s")
        else _is_count_or_absent
        if _name in _BYBIT_FLOW_SUM_FIELDS
        else _is_count
    )
for _venue in FUNDING_VENUES:
    for _state in (*FUNDING_STATES, "not_read"):
        _SUMMARY_VALIDATORS[f"{_venue}_funding_{_state}"] = _is_count
    _SUMMARY_VALIDATORS[f"{_venue}_funding_pairs"] = _is_count_or_absent
    _SUMMARY_VALIDATORS[f"{_venue}_funding_malformed"] = _is_count_or_absent
    _SUMMARY_VALIDATORS[f"{_venue}_max_funding_s"] = _is_seconds_or_absent
for _venue in PROBE_VENUES:
    _SUMMARY_VALIDATORS[f"{_venue}_max_nonrealized_s"] = _is_seconds_or_absent

if set(_KEY_VALIDATORS) != set(KEY_RECORD_KEYS) or set(_SUMMARY_VALIDATORS) != set(
    SUMMARY_RECORD_KEYS
):  # pragma: no cover - a declaration error, caught at import
    raise RuntimeError("derivegaps_probe: a record vocabulary and its validators disagree")


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
# Pure layer: the page walks the view recorded, and the readings taken from them.
# ---------------------------------------------------------------------------

_OKX_BILLS_METHOD: Final[str] = "private_get_account_bills"
_OKX_ARCHIVE_METHOD: Final[str] = "private_get_account_bills_archive"
_BYBIT_PNL_METHOD: Final[str] = "private_get_v5_position_closed_pnl"


class Walk(NamedTuple):
    """One paged walk the realized read made: an OKX endpoint's instType or one Bybit window."""

    endpoint: str  # "okx_bills" | "okx_archive" | "bybit_closed_pnl"
    group: str  # the instType, or the window's startTime
    pages: int
    at_cap: bool
    last_request: dict[str, Any]
    last_rows: list[Any]
    last_cursor: str


def _okx_rows_of(reply: Any) -> list[Any]:
    data = reply.get("data") if isinstance(reply, dict) else None
    return data if isinstance(data, list) else []


def _bybit_page_of(reply: Any) -> tuple[list[Any], str]:
    result = reply.get("result") if isinstance(reply, dict) else None
    if not isinstance(result, dict):
        return [], ""
    items = result.get("list")
    cursor = result.get("nextPageCursor")
    return (items if isinstance(items, list) else []), (cursor if isinstance(cursor, str) else "")


def _walks_for(
    view: ReadOnlyRecordingExchange, method: str, endpoint: str, group_param: str
) -> list[Walk]:
    requests = view.requests.get(method, [])
    replies = view.replies.get(method, [])
    groups: dict[str, list[int]] = {}
    for index, request in enumerate(requests):
        groups.setdefault(str(request.get(group_param, "")), []).append(index)
    walks: list[Walk] = []
    for group, indices in groups.items():
        last = indices[-1]
        if endpoint == "bybit_closed_pnl":
            rows, next_cursor = _bybit_page_of(replies[last])
            sent = str(requests[last].get("cursor", ""))
            # The derive's own test: the last allowed page was read, was not empty and still
            # had a cursor that moved.
            at_cap = (
                len(indices) >= TODAY_BYBIT_PAGE_CAP
                and bool(rows)
                and bool(next_cursor)
                and next_cursor != sent
            )
        else:
            rows, next_cursor = _okx_rows_of(replies[last]), ""
            at_cap = len(indices) >= TODAY_OKX_PAGE_CAP and len(rows) >= TODAY_OKX_PAGE_ROWS
        walks.append(Walk(endpoint, group, len(indices), at_cap, requests[last], rows, next_cursor))
    return walks


def collect_walks(view: ReadOnlyRecordingExchange) -> list[Walk]:
    """Every paged walk recorded so far, in a fixed endpoint order."""
    return [
        *_walks_for(view, _OKX_BILLS_METHOD, "okx_bills", "instType"),
        *_walks_for(view, _OKX_ARCHIVE_METHOD, "okx_archive", "instType"),
        *_walks_for(view, _BYBIT_PNL_METHOD, "bybit_closed_pnl", "startTime"),
    ]


def _sig3_or_absent(x: float) -> float | str:
    shown = sig3(x)
    return shown + 0.0 if isinstance(shown, float) else FIELD_ABSENT  # + 0.0: never "-0.0"


def _class_token(name: object) -> str:
    """The allow-listed class of an exception CLASS NAME the derive stamped in its flag buffer.

    Only names ccxt itself defines resolve, so no arbitrary name from the buffer is looked up;
    anything else reads ``other``."""
    if not isinstance(name, str):
        return "other"
    if name == "TimeoutError":
        return "Timeout"
    cls = getattr(ccxt, name, None)
    if isinstance(cls, type) and issubclass(cls, BaseException):
        try:
            return classify_failure(cls(""))
        except Exception:  # noqa: BLE001 - a class that cannot be built with one argument
            return "other"
    return "other"


def _row_ms(stamp: Any) -> int | None:
    """A daily-pnl row's ``timestamp`` as epoch milliseconds, or None when it is not readable."""
    if isinstance(stamp, str) and stamp.isascii() and stamp.isdigit():
        return int(stamp)
    if not isinstance(stamp, str):
        return None
    try:
        moment = datetime.fromisoformat(stamp)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp() * 1000)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _monotonic() -> float:
    return time.monotonic()


def _walks_at(walks: Sequence[Walk], endpoint: str) -> list[Walk]:
    return [w for w in walks if w.endpoint == endpoint]


def _realized_page_readings(venue: str, walks: Sequence[Walk]) -> dict[str, Any]:
    """The per-venue page counts. A reading that does not apply to the venue is ``field-absent``."""
    absent: dict[str, Any] = {
        "okx_bills_pages_max": FIELD_ABSENT,
        "okx_archive_pages_max": FIELD_ABSENT,
        "okx_inst_types_at_cap": FIELD_ABSENT,
        "bybit_windows": FIELD_ABSENT,
        "bybit_pages_max_in_window": FIELD_ABSENT,
        "bybit_windows_at_cap": FIELD_ABSENT,
    }
    if venue == "okx":
        bills = _walks_at(walks, "okx_bills")
        archive = _walks_at(walks, "okx_archive")
        absent["okx_bills_pages_max"] = max((w.pages for w in bills), default=0)
        absent["okx_archive_pages_max"] = max((w.pages for w in archive), default=0)
        absent["okx_inst_types_at_cap"] = sum(1 for w in (*bills, *archive) if w.at_cap)
    elif venue == "bybit":
        windows = _walks_at(walks, "bybit_closed_pnl")
        absent["bybit_windows"] = len(windows)
        absent["bybit_pages_max_in_window"] = max((w.pages for w in windows), default=0)
        absent["bybit_windows_at_cap"] = sum(1 for w in windows if w.at_cap)
    return absent


async def measure_realized(
    view: ReadOnlyRecordingExchange, venue: str, run_day: date | None = None
) -> dict[str, Any]:
    """Run the derive's own realized read through the view and read its verdict.

    ``get_and_clear_last_dq_flags()`` is called first (the buffer is empty before the read) and
    again INSIDE the timed coroutine, immediately after ``fetch_all_trades`` returns, so the
    flags it reads are this read's own on every Python version (``asyncio.wait_for`` runs the
    coroutine in a copied context before 3.11). State: ``fetch_error`` when the derive stamped
    ``daily_pnl_fetch_error``, else ``truncated`` when it stamped any ``daily_pnl_truncated_*``,
    else ``complete``; ``timeout`` when the bound passed (the flags are then unread).

    A spent call budget is not a venue failure: it raises ``CallCeilingReached`` so the key is
    recorded as unmeasurable. The equity read is timed afterwards and its value kept on the view
    in memory for plan 186-03's ratios; it is never printed."""
    day = run_day if run_day is not None else _utc_now().date()
    get_and_clear_last_dq_flags()

    async def _read() -> tuple[list[dict[str, Any]], dict[str, Any]]:
        rows = await fetch_all_trades(view, since_ms=None)
        return rows, get_and_clear_last_dq_flags()

    started = _monotonic()
    timed_out = False
    rows: list[dict[str, Any]] = []
    flags: dict[str, Any] = {}
    try:
        rows, flags = await asyncio.wait_for(_read(), KEY_READ_TIMEOUT_S)
    except TimeoutError:
        timed_out = True
        get_and_clear_last_dq_flags()  # drop whatever the cancelled read had already stamped
    realized_elapsed = _monotonic() - started
    # Every successful page of the realized read, taken before the equity read adds its own.
    realized_pages = sum(len(replies) for replies in view.replies.values())
    if view.ceiling_reached:
        raise CallCeilingReached(view.ceiling)

    walks = collect_walks(view)
    view.realized_walks = walks

    fetch_error = flags.get("daily_pnl_fetch_error") is True
    truncated = any(
        value is True for name, value in flags.items() if name.startswith("daily_pnl_truncated_")
    )
    if timed_out:
        state = "timeout"
    elif fetch_error:
        state = "fetch_error"
    elif truncated:
        state = "truncated"
    else:
        state = "complete"

    usable = state in ("complete", "truncated")
    stamps = [_row_ms(r.get("timestamp")) for r in rows] if usable else []
    known = [ms for ms in stamps if ms is not None]
    values: dict[str, Any] = {
        "realized_state": state,
        "flag_truncated_okx": FIELD_ABSENT if timed_out else flags.get("daily_pnl_truncated_okx") is True,
        "flag_truncated_bybit": FIELD_ABSENT if timed_out else flags.get("daily_pnl_truncated_bybit") is True,
        "flag_fetch_error": FIELD_ABSENT if timed_out else fetch_error,
        "flag_binance_income_fallback": (
            FIELD_ABSENT if timed_out else flags.get("daily_pnl_binance_income_fallback") is True
        ),
        "fetch_error_class": (
            FIELD_ABSENT
            if timed_out
            else (_class_token(flags.get("daily_pnl_fetch_error_class")) if fetch_error else "none")
        ),
        "realized_rows": len(rows) if usable else FIELD_ABSENT,
        "realized_days": (
            len({datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date() for ms in known})
            if usable
            else FIELD_ABSENT
        ),
        "realized_oldest_age": age_bucket(min(known), day) if usable and known else (
            "none" if usable else FIELD_ABSENT
        ),
        **_realized_page_readings(venue, walks),
        "realized_elapsed_s": _sig3_or_absent(realized_elapsed),
        "realized_s_per_page": (
            _sig3_or_absent(realized_elapsed / realized_pages) if realized_pages else FIELD_ABSENT
        ),
    }

    if not usable:
        # The walks of a read that failed or timed out stop where it stopped: an at-cap count taken
        # from them is not a measurement, and 0 would read as "not capped".
        values["okx_inst_types_at_cap"] = FIELD_ABSENT
        values["bybit_windows_at_cap"] = FIELD_ABSENT

    equity_started = _monotonic()
    try:
        view.equity_reading = await asyncio.wait_for(
            fetch_account_equity_and_upnl_usd(view, venue),
            EQUITY_READ_TIMEOUT_S,
        )
        values["equity_elapsed_s"] = _sig3_or_absent(_monotonic() - equity_started)
    except CallCeilingReached:
        raise
    except Exception:  # noqa: BLE001 - the timing is then not measured, which the record says
        values["equity_elapsed_s"] = FIELD_ABSENT
    if view.ceiling_reached:
        raise CallCeilingReached(view.ceiling)
    return values


# ---------------------------------------------------------------------------
# D-06 sizing: the continuation past today's caps, and the Bybit closed-pnl limit probe.
# ---------------------------------------------------------------------------

_PAST_CAP_KEYS: Final[tuple[str, ...]] = (
    "pages_needed_okx_bills",
    "pages_needed_okx_archive",
    "pages_needed_bybit_window",
    "past_cap_reached_end",
    "past_cap_oldest_age",
)

_WALK_METHOD: Final[dict[str, str]] = {
    "okx_bills": _OKX_BILLS_METHOD,
    "okx_archive": _OKX_ARCHIVE_METHOD,
    "bybit_closed_pnl": _BYBIT_PNL_METHOD,
}

#: Bybit's closed-pnl window: the venue's documented maximum span between startTime and endTime.
BYBIT_WINDOW_MS: Final[int] = 7 * 24 * 60 * 60 * 1000


def _past_cap_absent() -> dict[str, Any]:
    """The continuation readings of a key that was not continued: not measured, never 0."""
    return {name: FIELD_ABSENT for name in _PAST_CAP_KEYS}


async def _continue_okx_walk(view: ReadOnlyRecordingExchange, walk: Walk) -> bool:
    """Continue one capped OKX walk on the SAME endpoint with the SAME params, paging by the last
    bill's id exactly as the derive's loop does, until a page shorter than a full one (the end) or
    ``CONTINUATION_PAGE_CEILING`` more pages. True when the end was reached. A spent call budget
    ends the walk early and reads False: the pages read so far are a lower bound."""
    from services.exchange import _okx_bills_fetch_with_backoff

    method = _WALK_METHOD[walk.endpoint]
    params = {str(k): str(v) for k, v in walk.last_request.items()}
    rows = walk.last_rows
    for page in range(CONTINUATION_PAGE_CEILING):
        last = rows[-1] if rows else None
        bill_id = last.get("billId") if isinstance(last, dict) else None
        if not bill_id:
            return False
        params["after"] = str(bill_id)
        try:
            reply = await _okx_bills_fetch_with_backoff(
                view, method, params, label=f"continue {walk.group}", page=page
            )
        except CallCeilingReached:
            return False
        rows = _okx_rows_of(reply)
        if len(rows) < TODAY_OKX_PAGE_ROWS:
            return True
    return False


async def _continue_bybit_walk(view: ReadOnlyRecordingExchange, walk: Walk) -> bool:
    """Continue one capped Bybit window on its own ``cursor``, stopping where the derive's loop
    stops (an empty page, or a cursor that is empty or repeated). True when the end was reached."""
    params = dict(walk.last_request)
    cursor = walk.last_cursor
    for _page in range(CONTINUATION_PAGE_CEILING):
        params["cursor"] = cursor
        try:
            reply = await view.private_get_v5_position_closed_pnl(params)
        except CallCeilingReached:
            return False
        rows, next_cursor = _bybit_page_of(reply)
        if not rows or not next_cursor or next_cursor == cursor:
            return True
        cursor = next_cursor
    return False


def _oldest_ms(view: ReadOnlyRecordingExchange, walk: Walk) -> int | None:
    """The oldest row stamp over every page recorded for this walk, continuation included."""
    method = _WALK_METHOD[walk.endpoint]
    bybit = walk.endpoint == "bybit_closed_pnl"
    group_param, stamp_field = ("startTime", "createdTime") if bybit else ("instType", "ts")
    oldest: int | None = None
    for request, reply in zip(view.requests.get(method, []), view.replies.get(method, [])):
        if str(request.get(group_param, "")) != walk.group:
            continue
        for row in _bybit_page_of(reply)[0] if bybit else _okx_rows_of(reply):
            raw = row.get(stamp_field) if isinstance(row, dict) else None
            if isinstance(raw, str) and raw.isascii() and raw.isdigit():
                oldest = int(raw) if oldest is None else min(oldest, int(raw))
    return oldest


async def measure_past_cap(
    view: ReadOnlyRecordingExchange,
    venue: str,
    walks: Sequence[Walk],
    run_day: date | None = None,
) -> dict[str, Any]:
    """For a truncated key: how many pages its full history needs.

    Continues every walk that hit today's cap (the same endpoint, the same params, the cursor
    taken from the last recorded page) until the end or ``CONTINUATION_PAGE_CEILING`` more pages,
    then reads the page counts and the oldest row back from what the view recorded. Rows read here
    are counted and stamped, never aggregated or printed. ``past_cap_reached_end`` is True only if
    every continued walk reached its end, so False means the page counts are lower bounds. A key
    with no walk at the cap has nothing to continue: every reading is ``field-absent``."""
    day = run_day if run_day is not None else _utc_now().date()
    values = _past_cap_absent()
    capped = [w for w in walks if w.at_cap]
    if not capped:
        return values
    reached_all = True
    for walk in capped:
        if walk.endpoint == "bybit_closed_pnl":
            reached = await _continue_bybit_walk(view, walk)
        else:
            reached = await _continue_okx_walk(view, walk)
        reached_all = reached_all and reached
    after = collect_walks(view)
    if venue == "okx":
        values["pages_needed_okx_bills"] = max(
            (w.pages for w in _walks_at(after, "okx_bills")), default=0
        )
        values["pages_needed_okx_archive"] = max(
            (w.pages for w in _walks_at(after, "okx_archive")), default=0
        )
    elif venue == "bybit":
        values["pages_needed_bybit_window"] = max(
            (w.pages for w in _walks_at(after, "bybit_closed_pnl")), default=0
        )
    stamps = [ms for ms in (_oldest_ms(view, w) for w in capped) if ms is not None]
    values["past_cap_reached_end"] = reached_all
    values["past_cap_oldest_age"] = age_bucket(min(stamps) if stamps else None, day)
    return values



async def measure_bybit_limit(view: ReadOnlyRecordingExchange) -> dict[str, Any]:
    """Bybit only: does the closed-pnl endpoint honour the ``limit`` of 200 the derive sends,
    against the documented maximum of 100? One 7-day window GET at each limit, with the derive's
    own params. Records the returned list length, whether the call raised and the closed class of
    the error (never its message). ``bybit_limit_probe_informative`` is True only when the 200 read
    returned more than 100 rows (the venue honours 200) or the venue rejected it with a parameter
    error (``BadRequest``) while the 100 read succeeded: equal row counts on a quiet window, a
    transient failure (``ExchangeError`` covers Bybit's "try again later") or both reads failing
    show nothing.
    A spent call budget is a refusal and propagates."""
    end_ms = int(_utc_now().timestamp() * 1000)
    start_ms = end_ms - BYBIT_WINDOW_MS
    values: dict[str, Any] = {}
    for limit in (200, 100):
        params: dict[str, Any] = {
            "category": "linear",
            "limit": limit,
            "startTime": str(start_ms),
            "endTime": str(end_ms),
        }
        try:
            reply = await view.private_get_v5_position_closed_pnl(params)
            rows, _cursor = _bybit_page_of(reply)
            values[f"bybit_limit{limit}_rows"] = len(rows)
            values[f"bybit_limit{limit}_error"] = False
            values[f"bybit_limit{limit}_error_class"] = "none"
        except CallCeilingReached:
            raise
        except Exception as exc:  # noqa: BLE001 - any failure is the reading; only its class is kept
            values[f"bybit_limit{limit}_rows"] = FIELD_ABSENT
            values[f"bybit_limit{limit}_error"] = True
            values[f"bybit_limit{limit}_error_class"] = classify_failure(exc)
    rows_200 = values["bybit_limit200_rows"]
    values["bybit_limit_probe_informative"] = (
        isinstance(rows_200, int) and rows_200 > 100
    ) or (
        values["bybit_limit200_error_class"] == "BadRequest"
        and values["bybit_limit100_error_class"] == "none"
    )
    return values


# ---------------------------------------------------------------------------
# Gap 2: Bybit on-chain flows against the Unified flows (D-02), plan 186-03.
# ---------------------------------------------------------------------------


#: Every reading ``measure_bybit_flows`` owns; a reading its reads could not give stays ``field-absent``.
_FLOW_KEYS: Final[tuple[str, ...]] = (
    "bybit_is_uta",
    "bybit_is_master",
    "anchor_unreadable",
    "onchain_read_state",
    "unified_read_state",
    "onchain_deposits",
    "onchain_withdrawals",
    "unified_in",
    "unified_out",
    "paired_deposits",
    "paired_withdrawals",
    "unpaired_onchain_deposits",
    "unpaired_onchain_withdrawals",
    "pairing_unreadable_rows",
    "pairing_near_miss_rows",
    "unified_net_over_anchor",
    "unpaired_onchain_net_over_anchor",
    "nonstable_flow_rows",
    "flows_elapsed_s",
    "unified_elapsed_s",
)


def _anchor_of(view: ReadOnlyRecordingExchange) -> float | None:
    """The account's anchor (the USDT wallet balance the equity read took) when it read cleanly
    and is positive; None otherwise. Kept in memory, never printed."""
    reading = view.equity_reading
    if reading is None:
        return None
    equity, balance_error, _upnl, _unreadable = reading
    if balance_error or equity is None or not math.isfinite(equity) or equity <= 0:
        return None
    return equity


def _stable_net(
    deposits: Sequence[Mapping[str, Any]], withdrawals: Sequence[Mapping[str, Any]]
) -> tuple[float, int]:
    """(net of the USD-stable rows, deposits positive and withdrawals negative; count of rows in
    any other currency, which are left out of the net). An unreadable amount counts as left out."""
    net = 0.0
    other = 0
    for sign, rows in ((1.0, deposits), (-1.0, withdrawals)):
        for row in rows:
            currency = row.get("currency")
            amount = row.get("amount")
            if not (isinstance(currency, str) and currency.upper() in STABLECOINS):
                other += 1
            elif isinstance(amount, (int, float)) and not isinstance(amount, bool) and math.isfinite(amount):
                net += sign * abs(float(amount))
            else:
                other += 1
    return net, other


def _ratio_over(net: float, anchor: float | None) -> float | str:
    return FIELD_ABSENT if anchor is None else _sig3_or_absent(net / anchor)


async def measure_bybit_flows(
    view: ReadOnlyRecordingExchange,
    run_day: date | None = None,
    values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Bybit only: the account type, how many on-chain deposit and withdrawal rows the derive reads
    today, how many Unified TRANSFER_IN / TRANSFER_OUT rows the ready reader returns, how many
    on-chain rows pair with a Unified row, and the size of the flows against the anchor.

    The window is the derive's own: ``flow_retention_floor("bybit", now)`` to now, exactly as
    ``run_derive_broker_dailies_job`` computes ``_flow_since_ms``. Both readers are the REAL ones
    (``fetch_ccxt_transfers`` and ``fetch_bybit_unified_flows``, D-02: no new reader is written),
    and the pairing is the service's ``pair_onchain_with_unified`` so the probe and a pair-aware
    derive cannot disagree. Rows are counted in memory; amounts reach a record only as a
    three-significant-figure share of the anchor, never a number of currency.

    Each read ends in a closed state instead of failing the key: the on-chain pair of reads is
    ``complete`` or ``failed``; the Unified read is ``complete``, ``reader_error`` (the reader
    refused to return less than the venue holds) or ``venue_error`` (any other exception; neither
    the class nor the message is printed). A reading that needs a failed read is ``field-absent``.
    A spent call budget is a refusal and propagates. A caller that passes ``values`` keeps what was
    read before such a stop (the on-chain counts, the timings)."""
    day = run_day if run_day is not None else _utc_now().date()
    now_ms = int(_utc_now().timestamp() * 1000)
    floor = flow_retention_floor("bybit", datetime(day.year, day.month, day.day, tzinfo=timezone.utc))
    since_ms = 0 if floor is None else max(0, int(floor.timestamp() * 1000))

    info = await read_key_info(view)
    if values is None:
        values = {}
    values |= {name: FIELD_ABSENT for name in _FLOW_KEYS}
    values |= {
        "bybit_is_uta": info["bybit_is_uta"],
        "bybit_is_master": info["bybit_is_master"],
    }

    onchain_deposits: list[dict[str, Any]] | None = None
    onchain_withdrawals: list[dict[str, Any]] | None = None
    started = _monotonic()
    try:
        onchain_deposits = await fetch_ccxt_transfers(view, "deposits", since_ms, now_ms)
        onchain_withdrawals = await fetch_ccxt_transfers(view, "withdrawals", since_ms, now_ms)
        values["onchain_read_state"] = "complete"
    except CallCeilingReached:
        raise
    except Exception:  # noqa: BLE001 - the state is the reading; the class and message are not printed
        onchain_deposits = onchain_withdrawals = None
        values["onchain_read_state"] = "failed"
    finally:
        values["flows_elapsed_s"] = _sig3_or_absent(_monotonic() - started)
    if onchain_deposits is not None and onchain_withdrawals is not None:
        values["onchain_deposits"] = len(onchain_deposits)
        values["onchain_withdrawals"] = len(onchain_withdrawals)

    unified_deposits: list[dict[str, Any]] | None = None
    unified_withdrawals: list[dict[str, Any]] | None = None
    started = _monotonic()
    try:
        unified_deposits, unified_withdrawals = await fetch_bybit_unified_flows(view, since_ms, now_ms)
        values["unified_read_state"] = "complete"
    except CallCeilingReached:
        raise
    except BybitUnifiedFlowReadError:
        values["unified_read_state"] = "reader_error"
    except Exception:  # noqa: BLE001 - the state is the reading; the class and message are not printed
        values["unified_read_state"] = "venue_error"
    finally:
        values["unified_elapsed_s"] = _sig3_or_absent(_monotonic() - started)
    if view.ceiling_reached:
        raise CallCeilingReached(view.ceiling)

    anchor = _anchor_of(view)
    values["anchor_unreadable"] = anchor is None
    nonstable = 0
    if onchain_deposits is not None and onchain_withdrawals is not None:
        nonstable += _stable_net(onchain_deposits, onchain_withdrawals)[1]
    if unified_deposits is not None and unified_withdrawals is not None:
        values["unified_in"] = len(unified_deposits)
        values["unified_out"] = len(unified_withdrawals)
        net, other = _stable_net(unified_deposits, unified_withdrawals)
        nonstable += other
        values["unified_net_over_anchor"] = _ratio_over(net, anchor)
    if (
        onchain_deposits is not None
        and onchain_withdrawals is not None
        and unified_deposits is not None
        and unified_withdrawals is not None
    ):
        pairing = pair_onchain_with_unified(
            onchain_deposits, onchain_withdrawals, unified_deposits, unified_withdrawals
        )
        values["paired_deposits"] = pairing.paired_deposits
        values["paired_withdrawals"] = pairing.paired_withdrawals
        values["unpaired_onchain_deposits"] = pairing.unpaired_onchain_deposits
        values["unpaired_onchain_withdrawals"] = pairing.unpaired_onchain_withdrawals
        values["pairing_unreadable_rows"] = pairing.unreadable_rows
        values["pairing_near_miss_rows"] = pairing.near_miss_rows

        def _unpaired(rows: Sequence[dict[str, Any]], matched: frozenset[str]) -> list[dict[str, Any]]:
            return [r for r in rows if r.get("id") is None or str(r["id"]) not in matched]

        net, _other = _stable_net(
            _unpaired(onchain_deposits, pairing.matched_deposit_ids),
            _unpaired(onchain_withdrawals, pairing.matched_withdrawal_ids),
        )
        values["unpaired_onchain_net_over_anchor"] = _ratio_over(net, anchor)
    if onchain_deposits is not None or unified_deposits is not None:
        values["nonstable_flow_rows"] = nonstable
    return values


# ---------------------------------------------------------------------------
# Gap 4: same-hour funding legs, overlap duplicates and malformed rows (D-04), plan 186-03.
# ---------------------------------------------------------------------------

_MS_PER_HOUR: Final[int] = 3_600_000
_FUNDING_PROBE_STRATEGY_ID: Final[str] = "derivegaps-probe"

#: The funding GET methods. The realized read (OKX bills) and the flow read (Bybit log) use the
#: same endpoints, which is why the funding replies are taken by position, after the read starts.
_OKX_FUNDING_METHODS: Final[tuple[str, ...]] = (_OKX_BILLS_METHOD, _OKX_ARCHIVE_METHOD)
_BYBIT_LOG_METHOD: Final[str] = "private_get_v5_account_transaction_log"


def same_hour_pairs(rows: Iterable[tuple[str, int, str]]) -> tuple[int, int]:
    """From ``(instrument, epoch ms, bill id)`` rows: how many (instrument, UTC hour) groups hold two
    or more DISTINCT ids (real same-hour legs, which today's hour-bucket dedup folds into one), and
    how many groups hold the SAME id twice (the recent and archive endpoints overlapping, harmless).
    A group can count in both."""
    ids: dict[tuple[str, int], list[str]] = {}
    for instrument, stamp, bill_id in rows:
        ids.setdefault((instrument, stamp // _MS_PER_HOUR), []).append(bill_id)
    distinct = sum(1 for group in ids.values() if len(set(group)) >= 2)
    repeated = sum(1 for group in ids.values() if len(group) != len(set(group)))
    return distinct, repeated


def _funding_replies_since(
    view: ReadOnlyRecordingExchange, offsets: Mapping[str, int], method: str
) -> list[Any]:
    """The replies to ``method`` recorded after ``offsets[method]``: the funding read's own pages.
    The realized read and the flow read use the same endpoints, so what came before the funding
    read started is not funding."""
    return list(view.replies.get(method, [])[offsets.get(method, 0):])


def _okx_funding_readings(
    replies: Sequence[Any], strategy_id: str
) -> tuple[int, list[tuple[str, int, str]], int]:
    """(raw rows, (instrument, ms, bill id) per usable row, malformed rows) over OKX funding pages,
    mapping each raw row to ``_normalize_funding_row`` exactly as ``fetch_funding_okx`` does."""
    raw = 0
    triples: list[tuple[str, int, str]] = []
    malformed = 0
    for reply in replies:
        for item in _okx_rows_of(reply):
            raw += 1
            if not isinstance(item, dict):
                malformed += 1
                continue
            symbol = normalize_symbol("okx", item.get("instId", "") or "")
            if _normalize_funding_row(
                strategy_id=strategy_id,
                exchange="okx",
                symbol=symbol,
                amount_raw=item.get("pnl"),
                ts_raw=item.get("ts"),
                currency=item.get("ccy", "USDT") or "USDT",
                raw_item=item,
            ) is None:
                malformed += 1
                continue
            stamp, bill_id = _row_ms(item.get("ts")), item.get("billId")
            if symbol and stamp is not None and bill_id:
                triples.append((symbol, stamp, str(bill_id)))
    return raw, triples, malformed


def _bybit_funding_readings(
    replies: Sequence[Any], strategy_id: str
) -> tuple[int, list[tuple[str, int, str]], int]:
    """Like ``_okx_funding_readings`` for Bybit SETTLEMENT pages. A row with none of ``funding``,
    ``change`` or ``cashFlow`` is passed with no amount, which the repo's own normaliser drops."""
    raw = 0
    triples: list[tuple[str, int, str]] = []
    malformed = 0
    for reply in replies:
        for item in _bybit_page_of(reply)[0]:
            raw += 1
            if not isinstance(item, dict):
                malformed += 1
                continue
            amount: Any = None
            for field_name in ("funding", "change", "cashFlow"):
                candidate = item.get(field_name)
                if candidate is not None:
                    amount = candidate
                    break
            symbol = item.get("symbol", "") or ""
            if _normalize_funding_row(
                strategy_id=strategy_id,
                exchange="bybit",
                symbol=symbol,
                amount_raw=amount,
                ts_raw=(item.get("transactionTime") or item.get("created_time")),
                currency=item.get("currency", "USDT") or "USDT",
                raw_item=item,
            ) is None:
                malformed += 1
                continue
            stamp, bill_id = _row_ms(item.get("transactionTime")), item.get("id")
            if symbol and stamp is not None and bill_id:
                triples.append((str(symbol), stamp, str(bill_id)))
    return raw, triples, malformed


async def measure_funding_pairs(
    view: ReadOnlyRecordingExchange,
    venue: str,
    label: str = _FUNDING_PROBE_STRATEGY_ID,
    values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """OKX and Bybit: run the REAL funding fetcher exactly as the derive calls it (``since_ms=None``)
    and read, from the raw replies it caused, whether real same-hour legs exist.

    ``funding_kept_rows`` is what the fetcher returns (OKX folds an hour into one row through its
    ``match_key`` dedup; Bybit keeps every row). ``funding_same_hour_distinct_pairs`` counts
    (instrument, UTC hour) groups with two or more distinct bill ids, ``funding_same_hour_same_id``
    those holding one id twice (recent and archive overlap), and ``funding_malformed_rows`` the raw
    rows the repo's own ``_normalize_funding_row`` drops. State: ``complete``, ``truncated`` (the
    fetcher's own page ceiling) or ``fetch_error`` (any other exception; neither class nor message is
    printed), with every count ``field-absent`` unless ``complete``. A spent call budget is a refusal
    and propagates. Binance funding is Phase 187: every reading is ``field-absent``, nothing is read.
    Ids, instruments and amounts stay in memory. A caller that passes ``values`` keeps the timing
    of a read that was stopped."""
    if values is None:
        values = {}
    values |= {
        name: FIELD_ABSENT
        for name in (
            "funding_state",
            "funding_raw_rows",
            "funding_kept_rows",
            "funding_same_hour_distinct_pairs",
            "funding_same_hour_same_id",
            "funding_malformed_rows",
            "funding_elapsed_s",
        )
    }
    if venue not in FUNDING_VENUES:
        return values
    offsets = {
        method: len(view.replies.get(method, []))
        for method in (*_OKX_FUNDING_METHODS, _BYBIT_LOG_METHOD)
    }
    started = _monotonic()
    kept: int | None = None
    try:
        if venue == "okx":
            kept = len(await fetch_funding_okx(view, label, None))
        else:
            kept = len(await fetch_funding_bybit(view, label, None))
        state = "complete"
    except CallCeilingReached:
        raise
    except FundingFetchCeilingExceeded:
        state = "truncated"
    except Exception:  # noqa: BLE001 - the state is the reading; the class and message are not printed
        state = "fetch_error"
    finally:
        values["funding_elapsed_s"] = _sig3_or_absent(_monotonic() - started)
    if view.ceiling_reached:
        raise CallCeilingReached(view.ceiling)
    values["funding_state"] = state
    if state != "complete" or kept is None:
        return values

    if venue == "okx":
        replies = [
            reply
            for method in _OKX_FUNDING_METHODS
            for reply in _funding_replies_since(view, offsets, method)
        ]
        raw, triples, malformed = _okx_funding_readings(replies, label)
    else:
        replies = _funding_replies_since(view, offsets, _BYBIT_LOG_METHOD)
        raw, triples, malformed = _bybit_funding_readings(replies, label)
    distinct, repeated = same_hour_pairs(triples)
    values["funding_raw_rows"] = raw
    values["funding_kept_rows"] = kept
    values["funding_same_hour_distinct_pairs"] = distinct
    values["funding_same_hour_same_id"] = repeated
    values["funding_malformed_rows"] = malformed
    return values


# ---------------------------------------------------------------------------
# Run layer.
# ---------------------------------------------------------------------------

#: A whole key's bound, from the start of the key: the realized read and the equity read have
#: their own bounds; each later section gets what is left of this and is dropped, not the key, when
#: it runs out.
KEY_TOTAL_TIMEOUT_S: float = 3600.0


def failure_token(exc: BaseException) -> tuple[str, str]:
    """The ONE place a reader's exception becomes ``(unmeasurable_reason, failure_class)``.

    The class comes from ``classify_failure``, which never reads the message: a venue message
    can carry a signed URL, an amount or an id."""
    if isinstance(exc, CallCeilingReached):
        return "call_ceiling", "none"
    if isinstance(exc, TimeoutError):
        return "timeout", "Timeout"
    return "failure", classify_failure(exc)


def _key_record(label: str, venue: str, run_date: str, **values: Any) -> dict[str, Any]:
    """A key record with every reading ``field-absent`` and ``measured`` false until given."""
    unknown = sorted(set(values) - set(KEY_RECORD_KEYS))
    if unknown:
        raise ValueError(f"_key_record: keys outside the whitelist {unknown}")
    defaults: dict[str, Any] = {key: FIELD_ABSENT for key in KEY_RECORD_KEYS}
    return {
        **defaults,
        "record": "key",
        "key": label,
        "venue": venue,
        "run_date": run_date,
        "measured": False,
        "unmeasurable_reason": "none",
        "failure_class": "none",
        **values,
    }


def _unmeasured_record(
    label: str, venue: str, run_date: str, exc: BaseException | None = None
) -> dict[str, Any]:
    """The record of a key that was not measured: a closed reason and class, every reading
    ``field-absent``. No exception means the key is not eligible."""
    if exc is None:
        return _key_record(label, venue, run_date, unmeasurable_reason="key_not_eligible")
    reason, failure_class = failure_token(exc)
    return _key_record(
        label, venue, run_date, unmeasurable_reason=reason, failure_class=failure_class
    )


_PAGES_NEEDED_KEYS: Final[tuple[str, ...]] = (
    "pages_needed_okx_bills",
    "pages_needed_okx_archive",
    "pages_needed_bybit_window",
)


def _count_sum(records: Sequence[Mapping[str, Any]], names: Sequence[str]) -> int:
    """The sum of the counts present over the records; a ``field-absent`` reading adds nothing
    (it is not a measured zero, and a key whose read failed is counted in its own state key)."""
    return sum(
        r[name]
        for r in records
        for name in names
        if isinstance(r[name], int) and not isinstance(r[name], bool)
    )


def _sum_seconds(record: Mapping[str, Any], names: Sequence[str]) -> float | str:
    """The sum of the timings present on one record, to three significant figures; absent when
    none was timed."""
    shown = [record[n] for n in names if isinstance(record[n], float)]
    return _sig3_or_absent(sum(shown)) if shown else FIELD_ABSENT


def _flow_seconds(record: Mapping[str, Any]) -> float | str:
    """On-chain plus Unified flow seconds for one key; absent when neither was timed."""
    return _sum_seconds(record, ("flows_elapsed_s", "unified_elapsed_s"))


#: What a key spends outside the realized read, for D-06's split of the outer budget.
_NONREALIZED_SECOND_KEYS: Final[tuple[str, ...]] = (
    "equity_elapsed_s",
    "funding_elapsed_s",
    "flows_elapsed_s",
    "unified_elapsed_s",
)


def _max_seconds(records: Sequence[Mapping[str, Any]], key: str) -> float | str:
    shown = [r[key] for r in records if isinstance(r[key], float)]
    return max(shown) if shown else FIELD_ABSENT


_SECTION_SKIP_KEYS: Final[tuple[str, ...]] = (
    "past_cap_skip",
    "bybit_limit_skip",
    "bybit_flows_skip",
    "funding_skip",
)


def summarize(records: Sequence[Mapping[str, Any]], run_date: str) -> dict[str, Any]:
    """Counts and maxima derived from the key records in code.

    ``keys_unmeasurable`` counts the keys the backfill derives that the probe could not measure;
    a key the backfill does not derive is ``keys_not_eligible`` and fails nothing. A key whose
    read timed out has a ``realized_state`` of ``timeout`` and IS measured: the timeout is the
    measurement."""
    measured = [r for r in records if r["measured"]]
    not_eligible = [r for r in records if r["unmeasurable_reason"] == "key_not_eligible"]
    summary: dict[str, Any] = {
        "record": "summary",
        "run_date": run_date,
        "keys": len(records),
        "keys_measured": len(measured),
        "keys_unmeasurable": len(records) - len(measured) - len(not_eligible),
        "keys_not_eligible": len(not_eligible),
    }
    for venue in PROBE_VENUES:
        v_all = [r for r in records if r["venue"] == venue]
        summary[f"{venue}_keys"] = len(v_all)
        for state in REALIZED_STATES:
            summary[f"{venue}_realized_{state}"] = sum(
                1 for r in v_all if r["realized_state"] == state
            )
        summary[f"{venue}_max_s_per_page"] = _max_seconds(v_all, "realized_s_per_page")
        summary[f"{venue}_max_realized_s"] = _max_seconds(v_all, "realized_elapsed_s")
        needed = [
            r[name]
            for r in v_all
            for name in _PAGES_NEEDED_KEYS
            if isinstance(r[name], int) and not isinstance(r[name], bool)
        ]
        summary[f"{venue}_max_pages_needed"] = max(needed) if needed else FIELD_ABSENT
        # A truncated key whose continuation was not measured is as unsized as one that stopped short.
        summary[f"{venue}_keys_still_short_after_ceiling"] = sum(
            1
            for r in v_all
            if r["past_cap_reached_end"] is False
            or (r["realized_state"] == "truncated" and r["past_cap_reached_end"] == FIELD_ABSENT)
        )
        summary[f"{venue}_sections_skipped"] = sum(
            1 for r in v_all for name in _SECTION_SKIP_KEYS if r[name] not in ("none", FIELD_ABSENT)
        )
    bybit = [r for r in records if r["venue"] == "bybit" and r["measured"]]
    summary["bybit_uta"] = sum(1 for r in bybit if r["bybit_is_uta"] is True)
    summary["bybit_non_uta"] = sum(1 for r in bybit if r["bybit_is_uta"] is False)
    summary["bybit_uta_unknown"] = sum(1 for r in bybit if not isinstance(r["bybit_is_uta"], bool))
    # A failed or unread flow read adds nothing to a sum, so the sums are printed only when at
    # least one Bybit key was measured, every measured key read both sides in full and no eligible
    # Bybit key went unmeasured (the rule the funding sums use below).
    flows_complete = (
        bool(bybit)
        and all(r["onchain_read_state"] == "complete" and r["unified_read_state"] == "complete" for r in bybit)
        and not any(
            r["venue"] == "bybit" and not r["measured"] and r["unmeasurable_reason"] != "key_not_eligible"
            for r in records
        )
    )
    for name, fields in _BYBIT_FLOW_SUM_FIELDS.items():
        summary[name] = _count_sum(bybit, fields) if flows_complete else FIELD_ABSENT
    summary["bybit_unified_reader_errors"] = sum(
        1 for r in bybit if r["unified_read_state"] == "reader_error"
    )
    summary["bybit_onchain_complete"] = sum(1 for r in bybit if r["onchain_read_state"] == "complete")
    summary["bybit_onchain_failed"] = sum(1 for r in bybit if r["onchain_read_state"] == "failed")
    summary["bybit_onchain_not_read"] = sum(
        1 for r in bybit if r["onchain_read_state"] == FIELD_ABSENT
    )
    summary["bybit_unified_complete"] = sum(
        1 for r in bybit if r["unified_read_state"] == "complete"
    )
    summary["bybit_unified_venue_error"] = sum(
        1 for r in bybit if r["unified_read_state"] == "venue_error"
    )
    summary["bybit_unified_not_read"] = sum(
        1 for r in bybit if r["unified_read_state"] == FIELD_ABSENT
    )
    summary["bybit_anchor_unreadable"] = sum(1 for r in bybit if r["anchor_unreadable"] is True)
    flow_seconds = [x for x in (_flow_seconds(r) for r in bybit) if isinstance(x, float)]
    summary["bybit_max_flows_s"] = max(flow_seconds) if flow_seconds else FIELD_ABSENT
    for venue in FUNDING_VENUES:
        measured_v = [r for r in records if r["venue"] == venue and r["measured"]]
        for state in FUNDING_STATES:
            summary[f"{venue}_funding_{state}"] = sum(1 for r in measured_v if r["funding_state"] == state)
        summary[f"{venue}_funding_not_read"] = sum(
            1 for r in measured_v if r["funding_state"] == FIELD_ABSENT
        )
        # A truncated, failed or unread funding adds nothing to a sum, so the sum would read as a
        # smaller count of pairs than the account holds: it is printed only when at least one key
        # was measured, every measured key's funding was read in full and no key of the venue went
        # unmeasured (its funding is unread, and it is in no measured key).
        funding_complete = (
            bool(measured_v)
            and all(r["funding_state"] == "complete" for r in measured_v)
            and not any(
                r["venue"] == venue
                and not r["measured"]
                and r["unmeasurable_reason"] != "key_not_eligible"
                for r in records
            )
        )
        summary[f"{venue}_funding_pairs"] = (
            _count_sum(measured_v, ("funding_same_hour_distinct_pairs",)) if funding_complete else FIELD_ABSENT
        )
        summary[f"{venue}_funding_malformed"] = (
            _count_sum(measured_v, ("funding_malformed_rows",)) if funding_complete else FIELD_ABSENT
        )
        summary[f"{venue}_max_funding_s"] = _max_seconds(measured_v, "funding_elapsed_s")
    for venue in PROBE_VENUES:
        totals = [
            t
            for t in (
                _sum_seconds(r, _NONREALIZED_SECOND_KEYS)
                for r in records
                if r["venue"] == venue and r["measured"]
            )
            if isinstance(t, float)
        ]
        summary[f"{venue}_max_nonrealized_s"] = max(totals) if totals else FIELD_ABSENT
    return summary


async def _later_section(
    view: ReadOnlyRecordingExchange,
    deadline: float,
    name: str,
    section: Callable[[], Awaitable[dict[str, Any]]],
) -> dict[str, Any]:
    """Run one section that follows the realized read, or none of it, and say which. A spent call
    budget, the key's total bound or a venue error in a section ends THAT section: its readings
    stay ``field-absent``, the key keeps what the realized read measured (a truncated key's state
    and page counts are what D-06 sizes the caps from), and ``<name>_skip`` carries the closed
    reason (``call_ceiling``, ``timeout`` or the venue error's class). A section that ran reads
    ``none``. Once the budget is spent no further call is made."""
    skip = f"{name}_skip"
    if view.ceiling_reached:
        return {skip: "call_ceiling"}
    remaining = deadline - _monotonic()
    if remaining <= 0:
        return {skip: "timeout"}
    try:
        return {**await asyncio.wait_for(section(), remaining), skip: "none"}
    except (CallCeilingReached, TimeoutError, ccxt.BaseError) as exc:
        reason, failure_class = failure_token(exc)
        return {skip: failure_class if reason == "failure" else reason}


async def _measure_key(
    view: ReadOnlyRecordingExchange, venue: str, run_day: date
) -> dict[str, Any]:
    """One key's readings: the realized read (a refusal if its budget is spent), then each later
    section on its own guard: the Bybit closed-pnl limit probe, the continuation past the cap
    (truncated keys only), the Bybit flows and funding. The view is built with
    ``KEY_CALL_CEILING + FLOWS_FUNDING_CALL_BUDGET``; the first three run under ``KEY_CALL_CEILING``
    and the last two get the rest, so a continuation that spent its budget does not starve them."""
    deadline = _monotonic() + KEY_TOTAL_TIMEOUT_S
    total_ceiling = view.ceiling
    view.ceiling = total_ceiling - FLOWS_FUNDING_CALL_BUDGET
    values = await measure_realized(view, venue, run_day)
    values.update(_past_cap_absent())
    if venue == "bybit":
        values.update(await _later_section(view, deadline, "bybit_limit", lambda: measure_bybit_limit(view)))
    if values["realized_state"] == "truncated":
        values.update(
            await _later_section(
                view, deadline, "past_cap", lambda: measure_past_cap(view, venue, view.realized_walks, run_day)
            )
        )
    view.ceiling = total_ceiling
    view.ceiling_reached = False
    if venue == "bybit":
        flows: dict[str, Any] = {}
        stopped = await _later_section(
            view, deadline, "bybit_flows", lambda: measure_bybit_flows(view, run_day, flows)
        )
        values.update(flows)  # what a stopped section read before it stopped is kept
        values.update(stopped)
    funding: dict[str, Any] = {}
    stopped = await _later_section(
        view, deadline, "funding", lambda: measure_funding_pairs(view, venue, values=funding)
    )
    values.update(funding)
    values.update(stopped)
    return values


async def _read_one_key(
    key_row: Mapping[str, Any], kek: bytes, run_day: date
) -> dict[str, Any]:
    """Decrypt, build the client, measure under the per-key bound and close the client in every
    case. Raises on any failure; ``failure_token`` names it."""
    from services.encryption import decrypt_credentials
    from services.exchange import aclose_exchange
    from services.job_worker import _make_exchange_client

    venue = str(key_row.get("exchange"))
    client: Any = None
    try:
        api_key, api_secret, passphrase = decrypt_credentials(dict(key_row), kek)
        client = _make_exchange_client(venue, api_key, api_secret, passphrase)
        view = ReadOnlyRecordingExchange(client, KEY_CALL_CEILING + FLOWS_FUNDING_CALL_BUDGET)
        return await _measure_key(view, venue, run_day)
    finally:
        if client is not None:
            await aclose_exchange(client)


async def run() -> int:
    """Select the keys on the three venues, measure each key the backfill derives, and print one
    JSON line per key and a summary."""
    from services.db import db_execute, get_supabase, rows
    from services.encryption import get_kek

    supabase = ReadOnlySupabase(get_supabase())

    def _load_keys() -> Any:
        return (
            supabase.table("api_keys")
            .select("*")
            .in_("exchange", list(PROBE_VENUES))
            .order("created_at")
            .execute()
        )

    key_rows = rows(await db_execute(_load_keys))
    if len(key_rows) > _MAX_KEYS:
        print("refused: more keys than the label can carry", file=sys.stderr)
        return EXIT_FAILED
    run_at = _utc_now()
    run_date = run_at.strftime("%Y-%m-%d")
    kek: bytes | None = None
    records: list[dict[str, Any]] = []
    for index, key_row in enumerate(key_rows, start=1):
        label = f"k{index}"
        venue = str(key_row.get("exchange"))
        if not eligible_key_predicate(key_row):
            record = _unmeasured_record(label, venue, run_date)
        else:
            if kek is None:
                kek = get_kek()
            try:
                values = await _read_one_key(key_row, kek, run_at.date())
                record = _key_record(label, venue, run_date, measured=True, **values)
            except Exception as exc:  # noqa: BLE001 - mapped to a closed token; the message is never read
                record = _unmeasured_record(label, venue, run_date, exc)
        records.append(record)
        print(emit_record(record), flush=True)
    summary = summarize(records, run_date)
    print(emit_record(summary), flush=True)
    skipped = sum(summary[f"{venue}_sections_skipped"] for venue in PROBE_VENUES)
    # A venue error inside a flow or funding read is a measured state, not a skip: count it here so
    # it exits as the same error one frame out does. `truncated` and `reader_error` are findings.
    failed_reads = (
        summary["bybit_onchain_failed"]
        + summary["bybit_unified_venue_error"]
        + sum(summary[f"{venue}_funding_fetch_error"] for venue in FUNDING_VENUES)
    )
    return (
        EXIT_OK
        if summary["keys_unmeasurable"] == 0 and skipped == 0 and failed_reads == 0
        else EXIT_FAILED
    )


def deploy_fingerprint() -> str:
    """One line naming the shape of the deployed probe: the two exit codes, the sizes of the key
    record, summary record, unmeasurable and realized-state vocabularies, and the venues. Plan
    186-04 prints it on the worker and compares it with the line computed at the reviewed commit,
    so the worker is shown to run the reviewed code."""
    return " ".join(
        [
            "derivegaps",
            str(EXIT_OK),
            str(EXIT_FAILED),
            str(len(KEY_RECORD_KEYS)),
            str(len(SUMMARY_RECORD_KEYS)),
            str(len(UNMEASURABLE_REASONS)),
            str(len(REALIZED_STATES)),
            ",".join(PROBE_VENUES),
        ]
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="DERIVEGAPS read-only realized-read probe (takes no arguments)"
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
