"""Phase 184 WALLETOFFSET: the read-only first-mark offset probe.

D-01 (founder, 2026-11-01): "the offset on OKX, Bybit, Binance and sFOX is measured from
fills and trade history for the first-mark window, per key, as a ratio of NAV. Until it
reports, those four venues keep the wallet base."

WHAT IT MEASURES. For every key on a wallet-base venue that has a stored first mark
(``public.api_key_nav_marks``, the row with the smallest ``mark_day``, read through
``services.nav_marks.read_key_marks``) the probe takes

  * R, the mark's ``marked_at``: the instant OUR worker finished reading the equity;
  * B, UTC midnight of R's own day. The table pins ``mark_day`` to the read day minus one, so
    B is the day boundary after the labelled day; it is computed from ``marked_at`` itself and
    never from the label;
  * offset = the chain-defined realized P&L booked in [B, R] plus the chain's own flows placed
    in [B, R], printed as ratios of the mark's NAV and of its wallet (NAV minus open P&L).

The marks applier rolls the mark's wallet back through the labelled day's return to find the
first marked day's base, but the wallet was read hours into the NEXT day. A positive offset
means the wallet at the read holds more than the chain's level at B, so the wallet base sits
too high and the first marked day's return reads low by about the same ratio of the base. The
P&L part and the flow part are printed separately and as a sum: the applier's rule 10 already
moves a flow made at or before R into the labelled day, so the part that mis-states the base
is the P&L part.

TERMS SUMMED (OKX). The source is the bills archive only, because the 7-day bills endpoint
stops covering the first marks after about 2026-11-03. Trading = ``pnl + fee`` of the window
bills whose ``instType`` is one of the four the chain's own daily P&L loop reads (SWAP,
FUTURES, SPOT, MARGIN) and whose ``type`` is not 8. Funding = ``pnl`` of the ``type`` 8 bills
(the source the chain books funding from). A bill in a currency outside the stablecoin set is
counted (``non_stable_rows``) and summed nowhere, which marks the key ``partial``. A transfer
bill (``type`` 1) and a bill of any other instrument are counted and summed nowhere. Flows are
the derive's own deposit and withdrawal rows valued by ``ccxt_rows_to_dated_flows`` and placed
by ``placed_flow_instants``, the one statement of the applier's window rule.

TERMS SUMMED (Bybit). Trading = the closed-pnl rows (``category`` linear) created in [B, R],
reconstructed ex funding by the chain's own formula, which is inline in ``fetch_daily_pnl`` and
cannot be called for a window: the position P&L is ``cumEntryValue - cumExitValue`` when the
closing ``side`` is buy and ``cumExitValue - cumEntryValue`` otherwise, less ``openFee`` and
``closeFee``; ``bybit_closed_pnl_terms`` is that formula and a parity test drives the real
``fetch_daily_pnl`` on the same rows. The read stops where the chain's loop stops (an empty page,
or a cursor that is empty or repeated) and needing more than the page ceiling is
``page_ceiling``. Funding = the SETTLEMENT rows ``fetch_funding_bybit`` books
(linear then inverse), taken in [B, R]; a row in a currency outside the stablecoin set is counted
(``non_stable_rows``) and summed nowhere, which marks the key ``partial``. Flows are the chain's
own deposit and withdrawal rows, as for OKX. ``unified_edge_rows_in_window`` is a DIAGNOSTIC and
is summed nowhere: the Unified TRANSFER_IN and TRANSFER_OUT rows in [B, R], money that crossed the
Unified wallet's edge and that the chain's flow source may not see.

TERMS SUMMED (Binance). One futures-income read for [B, R] (``fapiPrivateGetIncome`` with the
window's own ``startTime`` and ``endTime`` and the maximum ``limit``). Trading = ``REALIZED_PNL``
and ``COMMISSION`` income, the chain's ``fetch_daily_pnl`` rule; funding = ``FUNDING_FEE`` income,
the rows ``fetch_funding_binance`` books; every other income type is counted and summed nowhere.
An income row whose ``asset`` is not a stablecoin is counted (``non_stable_rows``) and left out,
which marks the key ``partial``. A reply holding the 1000-row maximum cannot prove the window
complete and is ``page_ceiling``, never a partial sum. Flows are the chain's own, as for OKX.
Binance's retention and span rules are taken from RESEARCH A5 (about 3 months, unverified against
the venue), so a window outside it prints ``window_outside_retention`` rather than an empty read.

NO sFOX READER. sFOX's chain chain-links its own daily ``usd_value`` series
(``combine_sfox_balance_history``) and books no realized P&L, so the window offset this probe
measures has no chain definition there. A marked sFOX key prints ``reader_not_built`` and no
credential is decrypted; the founder readout asks how the sFOX offset should be defined (RESEARCH
A7). With no marked sFOX key the summary reads ``no_keys`` or ``no_marked_keys``.

Bybit fee timing. Closed P&L books ``openFee`` when a position CLOSES, but the wallet paid it when
the position OPENED. For a position opened before B the chain-defined P&L therefore differs from
the wallet's movement by that fee. The probe reports the chain's quantity and does not correct it.

Why only the archive. A walk that sent a ``begin`` could be answered oldest first and hide the
newest bills, so the walk sends no ``begin`` and no instrument or currency filter, pages
backward by bill id, and stops only when a bill older than B is served: that older bill is the
proof the window was read in full. An empty page before it is ``reach_unproven``, never an end.

REDACTION CONTRACT (the output is pasted into a tracked file in a public repo): labels
``k1..kN``, counts, booleans, closed-vocabulary tokens, dates no finer than the run date and
3-significant-figure ratios. No id, amount, venue text or key. The only path to stdout is
``emit_record``, which refuses any key outside the declared records and any value outside the
declared vocabulary, then re-checks with ``assert_sanitized``. "Not measured" is the word
``field-absent``, never 0. Logging is switched off for the run, and a run-level failure
prints the exception TYPE only.

READ-ONLY. The probe obtains its database once, through a select-only handle that exposes
``table`` and, on a table, ``select`` and nothing else. It starts no job and calls no writer.
Marks are read through ``read_key_marks``. The OKX bills archive and every Bybit ``private_get_``
call are read through a counted view that resolves GET methods only and stops at a per-key call
ceiling; the deposit and withdrawal
history are read through the worker's own fetchers. Keys are decrypted inside the worker
process and nowhere else.

USAGE. The probe takes no arguments, so no identifier is ever typed. Run it once on the Railway
backfill worker through a temporary start-command wrapper (Railway's remote shell is broken),
read its lines from the service log and paste only the lines that start with an opening brace
and a quote (one per key, then one summary). Before the run, the worker's deployed copy proves it
is the reviewed one: ``python -c 'import scripts.walletoffset_probe as w;
print(w.deploy_fingerprint())'`` prints one line that must equal the line computed at the
reviewed commit.

EXIT CODES
----------
  0  every marked key was measured (a key with no mark is not counted against this)
  1  any marked key could not be measured, or any other failure (the exception TYPE only on
     stderr)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import re
import sys
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Final

from scripts.allocator_history_probe import ReadOnlySupabase, ratio_or_absent
from scripts.bybit_upnl_probe import FAILURE_CLASSES, FIELD_ABSENT, classify_failure, sig3
from scripts.deribit_ground_truth import assert_sanitized
from services import okx_opening_balance as obal
from services.allocator_equity_derive import eligible_key_predicate
from services.closed_sets import STABLECOINS
from services.exchange import _finite_float, normalize_symbol
from services.nav_marks import StoredMark, mark_day_for, read_key_marks
from services.nav_marks_apply import placed_flow_instants
from services.nav_twr import NavReconstructionError
from services.okx_bills_chain import BudgetedExchange, CallCeilingReached

EXIT_OK: Final[int] = 0
EXIT_FAILED: Final[int] = 1

#: The four wallet-base venues of NAVMTM D-27. Deribit and MT5 are writer-basis and out of scope.
PROBE_VENUES: Final[tuple[str, ...]] = ("okx", "bybit", "binance", "sfox")

#: The instruments the chain's own OKX daily P&L loop (``fetch_daily_pnl``) reads.
_OKX_CHAIN_INST_TYPES: Final[tuple[str, ...]] = ("SWAP", "FUTURES", "SPOT", "MARGIN")
_OKX_FUNDING_BILL_TYPE: Final[str] = "8"
_OKX_TRANSFER_BILL_TYPE: Final[str] = "1"

#: How far back each venue's trade history reaches, in days (OKX bills archive "last 3 months",
#: Bybit closed P&L and transaction log 2 years, Binance income about 3 months).
RETENTION_DAYS: Final[dict[str, int]] = {"okx": 90, "bybit": 730, "binance": 90}

#: The archive can trail the 7-day store by up to a day, so a window younger than this is not
#: read.
OKX_MIN_WINDOW_AGE_S: Final[int] = 86400

#: One key's budgeted venue GETs: the archive page ceiling plus retry room.
KEY_CALL_CEILING: Final[int] = 600
KEY_READ_TIMEOUT_S: Final[float] = 900.0

#: Bybit closed P&L: the venue's documented maximum page (the chain sends 200) and the chain's own
#: per-window page cap. Both are read at call time.
BYBIT_CLOSED_PNL_PAGE_LIMIT: str = "100"
BYBIT_CLOSED_PNL_PAGE_CEILING: int = 50

#: Binance futures income: the venue's maximum page. A reply this long cannot prove the window
#: complete, so it is ``page_ceiling``.
BINANCE_INCOME_LIMIT: Final[int] = 1000
_BINANCE_TRADING_INCOME_TYPES: Final[tuple[str, ...]] = ("REALIZED_PNL", "COMMISSION")
_BINANCE_FUNDING_INCOME_TYPE: Final[str] = "FUNDING_FEE"

#: Every reason a key can print instead of a number. ``key_not_eligible`` is the refusal the
#: backfill's own dispatch filter gives; the codebase's "working" rule is a different, stricter
#: rule, so the token does not borrow its name.
UNMEASURABLE_REASONS: Final[tuple[str, ...]] = (
    "none",
    "no_mark",
    "key_not_eligible",
    "window_outside_retention",
    "window_too_recent",
    "reader_not_built",
    "read_failed",
    "reach_unproven",
    "page_ceiling",
    "call_ceiling",
    "malformed",
    "flow_unvalued",
    "nav_nonpositive",
    "timeout",
)

_VENUE_STATES: Final[tuple[str, ...]] = (
    "no_keys",
    "no_marked_keys",
    "measured",
    "partly_measured",
    "unmeasured",
)

#: The label k1..kN carries up to three digits.
_MAX_KEYS: Final[int] = 999
_LABEL_RE = re.compile(r"^k[0-9]{1,3}$")
_DATE_RE = re.compile(r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
_SHARED_ACCOUNT_KINDS: Final[tuple[str, ...]] = ("duplicate", "composite_member")
_HOUR_MS: Final[int] = 3_600_000

# ---------------------------------------------------------------------------
# The closed record vocabulary, declared once and used by the validator and the builders.
# ---------------------------------------------------------------------------

KEY_RECORD_KEYS: Final[tuple[str, ...]] = (
    "record",
    "key",
    "venue",
    "run_date",
    "first_mark_day",
    "read_delay_hours",
    "measured",
    "unmeasurable_reason",
    "failure_class",
    "partial",
    "shares_account",
    "pnl_trading_ratio",
    "pnl_funding_ratio",
    "pnl_ratio",
    "flow_ratio",
    "offset_ratio",
    "offset_over_wallet_ratio",
    "bills_in_window",
    "transfer_bills_in_window",
    "spot_bills_in_window",
    "other_inst_bills_in_window",
    "closed_pnl_rows_in_window",
    "income_rows_in_window",
    "funding_rows_in_window",
    "flow_rows_in_window",
    "unified_edge_rows_in_window",
    "non_stable_rows",
)

_RATIO_KEYS: Final[tuple[str, ...]] = (
    "read_delay_hours",
    "pnl_trading_ratio",
    "pnl_funding_ratio",
    "pnl_ratio",
    "flow_ratio",
    "offset_ratio",
    "offset_over_wallet_ratio",
)

_COUNT_KEYS: Final[tuple[str, ...]] = (
    "bills_in_window",
    "transfer_bills_in_window",
    "spot_bills_in_window",
    "other_inst_bills_in_window",
    "closed_pnl_rows_in_window",
    "income_rows_in_window",
    "funding_rows_in_window",
    "flow_rows_in_window",
    "unified_edge_rows_in_window",
    "non_stable_rows",
)


def _summary_record_keys() -> tuple[str, ...]:
    keys = ["record", "run_date", "keys", "keys_marked", "keys_measured", "keys_unmeasurable"]
    for venue in PROBE_VENUES:
        keys += [
            f"{venue}_keys",
            f"{venue}_keys_marked",
            f"{venue}_keys_measured",
            f"{venue}_state",
            f"{venue}_max_abs_pnl_ratio",
            f"{venue}_max_abs_offset_ratio",
        ]
    return tuple(keys)


SUMMARY_RECORD_KEYS: Final[tuple[str, ...]] = _summary_record_keys()


# ---------------------------------------------------------------------------
# Whitelist emitter. The ONLY path to stdout.
# ---------------------------------------------------------------------------


def _is_bool(x: Any) -> bool:
    return isinstance(x, bool)


def _is_bool_or_absent(x: Any) -> bool:
    return _is_bool(x) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_count(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0


def _is_count_or_absent(x: Any) -> bool:
    return _is_count(x) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_sig3_float(x: Any) -> bool:
    return isinstance(x, float) and math.isfinite(x) and float(f"{x:.3g}") == x


def _is_ratio(x: Any) -> bool:
    if isinstance(x, str):
        return x == FIELD_ABSENT
    return _is_sig3_float(x)


def _is_str_matching(pattern: re.Pattern[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and pattern.match(x) is not None


def _is_date_or_absent(x: Any) -> bool:
    return isinstance(x, str) and (x == FIELD_ABSENT or _DATE_RE.match(x) is not None)


def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed


_KEY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("key",)),
    "key": _is_str_matching(_LABEL_RE),
    "venue": _is_one_of(PROBE_VENUES),
    "run_date": _is_str_matching(_DATE_RE),
    "first_mark_day": _is_date_or_absent,
    "measured": _is_bool,
    "unmeasurable_reason": _is_one_of(UNMEASURABLE_REASONS),
    "failure_class": _is_one_of(FAILURE_CLASSES),
    "partial": _is_bool_or_absent,
    "shares_account": _is_bool,
    **{key: _is_ratio for key in _RATIO_KEYS},
    **{key: _is_count_or_absent for key in _COUNT_KEYS},
}

_SUMMARY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("summary",)),
    "run_date": _is_str_matching(_DATE_RE),
    "keys": _is_count,
    "keys_marked": _is_count,
    "keys_measured": _is_count,
    "keys_unmeasurable": _is_count,
}
for _venue in PROBE_VENUES:
    _SUMMARY_VALIDATORS[f"{_venue}_keys"] = _is_count
    _SUMMARY_VALIDATORS[f"{_venue}_keys_marked"] = _is_count
    _SUMMARY_VALIDATORS[f"{_venue}_keys_measured"] = _is_count
    _SUMMARY_VALIDATORS[f"{_venue}_state"] = _is_one_of(_VENUE_STATES)
    _SUMMARY_VALIDATORS[f"{_venue}_max_abs_pnl_ratio"] = _is_ratio
    _SUMMARY_VALIDATORS[f"{_venue}_max_abs_offset_ratio"] = _is_ratio

if set(_KEY_VALIDATORS) != set(KEY_RECORD_KEYS) or set(_SUMMARY_VALIDATORS) != set(
    SUMMARY_RECORD_KEYS
):  # pragma: no cover - a declaration error, caught at import
    raise RuntimeError("walletoffset_probe: a record vocabulary and its validators disagree")


def _check_keys(path: str, got: Mapping[str, Any], want: Sequence[str]) -> None:
    extra = sorted(set(got) - set(want))
    missing = sorted(set(want) - set(got))
    if extra or missing:
        raise ValueError(f"{path}: keys differ from the whitelist extra={extra} missing={missing}")


def validate_record(record: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` unless ``record`` is exactly the declared vocabulary.

    The message names the PATH of the offending entry and never its value: an unredacted
    amount must not leak through its own rejection."""
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
# Pure layer: the window, the offset arithmetic, the OKX bill sums. Stdlib only, no I/O.
# ---------------------------------------------------------------------------


class Unmeasurable(Exception):
    """A key's window cannot be rebuilt. Carries a closed reason and an allow-listed class."""

    def __init__(self, reason: str, failure_class: str = "none") -> None:
        if reason not in UNMEASURABLE_REASONS or failure_class not in FAILURE_CLASSES:
            raise ValueError("Unmeasurable: reason or class outside the declared vocabulary")
        super().__init__(reason)
        self.reason = reason
        self.failure_class = failure_class


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _epoch_ms(moment: datetime) -> int:
    return (moment - _EPOCH) // timedelta(milliseconds=1)


def _from_epoch_ms(ms: int) -> datetime:
    return _EPOCH + timedelta(milliseconds=ms)


def window_ms(marked_at: datetime) -> tuple[int, int]:
    """``(B, R)`` in epoch milliseconds: B is UTC midnight at the start of the read's own day
    and R is the read instant. Computed from ``marked_at`` itself, never from the mark day."""
    if marked_at.tzinfo is None or marked_at.utcoffset() is None:
        raise ValueError("window_ms needs a timezone-aware datetime")
    read = marked_at.astimezone(timezone.utc)
    boundary = read.replace(hour=0, minute=0, second=0, microsecond=0)
    return _epoch_ms(boundary), _epoch_ms(read)


def in_window(ts_ms: int, b_ms: int, r_ms: int) -> bool:
    """Inclusive at both edges: the same upper edge as ``placed_flow_instants``."""
    return b_ms <= ts_ms <= r_ms


def offset_terms(
    trading_usd: float,
    funding_usd: float,
    flow_usd: float,
    nav_usd: float,
    open_pnl_usd: float,
) -> dict[str, float | str]:
    """The ratios of the P&L part, the flow part and their sum to the mark's NAV, and of the
    sum to the mark's wallet (NAV minus open P&L). A NAV that is not above 0 is unmeasurable;
    a wallet that is not above 0 leaves the wallet ratio ``field-absent``."""
    if not (math.isfinite(nav_usd) and nav_usd > 0.0):
        raise Unmeasurable("nav_nonpositive")
    pnl_usd = trading_usd + funding_usd
    offset_usd = pnl_usd + flow_usd
    wallet = nav_usd - open_pnl_usd
    return {
        "pnl_trading_ratio": ratio_or_absent(trading_usd, nav_usd),
        "pnl_funding_ratio": ratio_or_absent(funding_usd, nav_usd),
        "pnl_ratio": ratio_or_absent(pnl_usd, nav_usd),
        "flow_ratio": ratio_or_absent(flow_usd, nav_usd),
        "offset_ratio": ratio_or_absent(offset_usd, nav_usd),
        "offset_over_wallet_ratio": (
            ratio_or_absent(offset_usd, wallet)
            if math.isfinite(wallet) and wallet > 0.0
            else FIELD_ABSENT
        ),
    }


@dataclass(frozen=True)
class OkxWindowTerms:
    """The OKX window sums and the counts that qualify them."""

    trading_usd: float
    funding_usd: float
    bills_in_window: int
    funding_rows_in_window: int
    transfer_bills_in_window: int
    spot_bills_in_window: int
    other_inst_bills_in_window: int
    non_stable_rows: int


def okx_window_terms(bills: Sequence[Mapping[str, str]], b_ms: int, r_ms: int) -> OkxWindowTerms:
    """Sum the window's bills with the chain's own rule (see the module docstring).

    A value that is not a finite number on a bill that WOULD be summed raises
    ``Unmeasurable("malformed")``: the chain drops such a row with a warning, and the probe
    refuses rather than print a sum missing a row."""
    trading = 0.0
    funding = 0.0
    funding_keys: set[tuple[str, int]] = set()
    counted = funding_rows = transfers = spot = other_inst = non_stable = 0
    for bill in bills:
        if not in_window(int(bill["ts"]), b_ms, r_ms):
            continue
        counted += 1
        bill_type = bill["type"].strip()
        inst_type = bill["instType"]
        is_funding = bill_type == _OKX_FUNDING_BILL_TYPE
        if is_funding:
            funding_rows += 1
        if bill_type == _OKX_TRANSFER_BILL_TYPE:
            transfers += 1
        if inst_type == "SPOT":
            spot += 1
        if not is_funding and inst_type not in _OKX_CHAIN_INST_TYPES:
            other_inst += 1
        if bill["ccy"] not in STABLECOINS:
            non_stable += 1
            continue
        if not is_funding and inst_type not in _OKX_CHAIN_INST_TYPES:
            continue
        pnl = _finite_float(bill.get("pnl", "0"), label="walletoffset bill pnl")
        if pnl is None:
            raise Unmeasurable("malformed")
        if is_funding:
            # fetch_funding_okx drops a blank instId and keeps one row per instrument and UTC hour.
            inst = normalize_symbol("okx", bill.get("instId", "") or "")
            funding_key = (inst, int(bill["ts"]) // _HOUR_MS)
            if not inst or funding_key in funding_keys:
                raise Unmeasurable("malformed")
            funding_keys.add(funding_key)
            funding += pnl
            continue
        fee = _finite_float(bill.get("fee", "0"), label="walletoffset bill fee")
        if fee is None:
            raise Unmeasurable("malformed")
        trading += pnl + fee
    return OkxWindowTerms(
        trading_usd=trading,
        funding_usd=funding,
        bills_in_window=counted,
        funding_rows_in_window=funding_rows,
        transfer_bills_in_window=transfers,
        spot_bills_in_window=spot,
        other_inst_bills_in_window=other_inst,
        non_stable_rows=non_stable,
    )


def failure_token(exc: BaseException) -> tuple[str, str]:
    """The ONE place a reader's exception becomes ``(unmeasurable_reason, failure_class)``.

    A refusal the probe raised keeps its own reason; a reader that never answered (the
    ``asyncio.wait_for`` bound) is ``("timeout", "Timeout")``; any other exception is
    ``("read_failed", <allow-listed class>)``. The class comes from ``classify_failure``,
    which never reads the message: a venue message can carry a signed URL, an amount or an id."""
    if isinstance(exc, Unmeasurable):
        return exc.reason, exc.failure_class
    if isinstance(exc, CallCeilingReached):
        return "call_ceiling", "none"
    if isinstance(exc, TimeoutError):
        return "timeout", "Timeout"
    return "read_failed", classify_failure(exc)


# ---------------------------------------------------------------------------
# OKX reader: the bills archive walk and the flow term.
# ---------------------------------------------------------------------------


def _parse_window_bill(row: Any) -> dict[str, str]:
    """One bill as strings, keeping the ``pnl`` and ``fee`` the opening oracle's parser drops.

    A field the probe reads that is unusable is ``malformed``. An absent ``pnl`` or ``fee``
    reads ``0`` like the chain's own ``bill.get("pnl", 0)``; a present one stays a string so a
    non-number is refused where it is summed."""
    if not isinstance(row, dict):
        raise Unmeasurable("malformed")
    bill_id = obal._digits(row.get("billId"))
    ts = obal._digits(row.get("ts"))
    ccy = row.get("ccy")
    if bill_id is None or ts is None or not isinstance(ccy, str) or not ccy:
        raise Unmeasurable("malformed")
    return {
        "billId": str(bill_id),
        "ts": str(ts),
        "ccy": ccy,
        "type": str(row.get("type") or ""),
        "instType": str(row.get("instType") or ""),
        "pnl": str(row["pnl"]) if "pnl" in row else "0",
        "fee": str(row["fee"]) if "fee" in row else "0",
    }


async def walk_okx_window_bills(exchange: Any, b_ms: int) -> list[dict[str, str]]:
    """Every bill with ``ts >= b_ms``, paged backward by bill id until a bill older than B is
    served, in the structure of ``walk_okx_bills_archive`` (no ``begin``, no ``end``, no
    ``instType``, no ``ccy``). The older bill is the proof the window was read in full: an empty
    page before it is ``reach_unproven``, a stalled cursor is ``malformed``, and needing more
    than the page ceiling is ``page_ceiling``. Never a partial list."""
    from services.exchange import _okx_bills_fetch_with_backoff

    kept: dict[str, dict[str, str]] = {}
    cursor: int | None = None
    for page_no in range(1, obal.BILLS_ARCHIVE_PAGE_CEILING + 1):
        params = {"limit": str(obal.BILLS_ARCHIVE_PAGE_ROWS)}
        if cursor is not None:
            params["after"] = str(cursor)
        reply: Any = await _okx_bills_fetch_with_backoff(
            exchange, obal._BILLS_METHOD, params, label="window", page=page_no
        )
        try:
            raw_rows = obal._page_rows(reply)
        except obal.OpeningUnavailable as exc:
            raise Unmeasurable("malformed") from exc
        if not raw_rows:
            raise Unmeasurable("reach_unproven")
        page = [_parse_window_bill(r) for r in raw_rows]
        page_min = min(int(b["billId"]) for b in page)
        if cursor is not None and page_min >= cursor:
            raise Unmeasurable("malformed")
        reached_older = False
        for bill in page:
            if int(bill["ts"]) >= b_ms:
                kept[bill["billId"]] = bill
            else:
                reached_older = True
        if reached_older:
            return list(kept.values())
        cursor = page_min
    raise Unmeasurable("page_ceiling")


async def _window_flows(
    client: Any,
    venue: str,
    supabase: ReadOnlySupabase,
    mark_day: date,
    read_at: datetime,
    b_ms: int,
    r_ms: int,
) -> tuple[float, int]:
    """The chain's own flows placed in the window: ``(sum in USD, count)``.

    The rows come from the derive's own fetchers on the UNWRAPPED client (they are not GET
    implicit names). Only rows whose ccxt ``timestamp`` lies in [B, R] are valued, so a later,
    not-yet-closed day's non-stable flow cannot fail the window; membership is then confirmed
    by ``placed_flow_instants``, the applier's own rule."""
    from services.ccxt_flow_fetch import fetch_ccxt_transfers
    from services.ccxt_flows import ccxt_rows_to_dated_flows
    from services.job_worker import _resolve_ccxt_flow_price_index

    window_rows: list[dict[str, Any]] = []
    for kind in ("deposits", "withdrawals"):
        for row in await fetch_ccxt_transfers(client, kind, b_ms, r_ms):
            stamp = row.get("timestamp") if isinstance(row, dict) else None
            if not isinstance(stamp, int) or isinstance(stamp, bool):
                raise Unmeasurable("malformed")
            if in_window(stamp, b_ms, r_ms):
                window_rows.append(row)
    price_index = await _resolve_ccxt_flow_price_index(client, venue, supabase, window_rows)
    instants: list[Any] = []
    try:
        ccxt_rows_to_dated_flows(
            window_rows, venue=venue, price_index=price_index, instants=instants
        )
    except NavReconstructionError as exc:
        raise Unmeasurable("flow_unvalued") from exc
    placed = placed_flow_instants(instants, mark_day, read_at)
    return sum(fi.amount for fi in placed), len(placed)


# ---------------------------------------------------------------------------
# Bybit reader: closed P&L ex-funding by the chain's own formula, SETTLEMENT funding, the
# Unified-edge count, and the flow term.
# ---------------------------------------------------------------------------


def _closed_pnl_page(reply: Any) -> tuple[list[Any], str]:
    """``(rows, next cursor)`` of one closed-pnl answer. A reply that is not an object holding
    ``result.list`` as a list, or a cursor that is not text, is ``malformed``."""
    if not isinstance(reply, dict):
        raise Unmeasurable("malformed")
    result = reply.get("result")
    if not isinstance(result, dict):
        raise Unmeasurable("malformed")
    items = result.get("list")
    if not isinstance(items, list):
        raise Unmeasurable("malformed")
    cursor = result.get("nextPageCursor", "")
    if cursor is None:
        cursor = ""
    if not isinstance(cursor, str):
        raise Unmeasurable("malformed")
    return items, cursor


def _created_ms(row: Mapping[str, Any]) -> int:
    """A closed-pnl row's ``createdTime`` as epoch milliseconds. The chain keeps only a digit
    string; the probe refuses anything else rather than drop a row from the sum."""
    raw = row.get("createdTime", "")
    text = str(raw)
    if not (text.isascii() and text.isdigit()):
        raise Unmeasurable("malformed")
    return int(text)


async def bybit_closed_pnl_rows(exchange: Any, b_ms: int, r_ms: int) -> list[dict[str, Any]]:
    """The closed-pnl rows created in ``[B, R]``, read as ONE window (R - B is under a day, so
    always inside the venue's 7-day span) in the structure of ``fetch_daily_pnl``'s Bybit loop:
    ``category`` linear, paged by ``nextPageCursor``, stopping on an empty page or on a cursor
    that is empty or repeated, deduplicated on ``(symbol, createdTime)``.

    Needing more than ``BYBIT_CLOSED_PNL_PAGE_CEILING`` pages is ``page_ceiling`` and an
    unreadable reply or row is ``malformed``: never a partial list. Rows outside [B, R] are
    dropped even when the venue serves them."""
    items: list[Any] = []
    cursor = ""
    for _page in range(BYBIT_CLOSED_PNL_PAGE_CEILING):
        params: dict[str, str] = {
            "category": "linear",
            "limit": BYBIT_CLOSED_PNL_PAGE_LIMIT,
            "startTime": str(b_ms),
            "endTime": str(r_ms),
        }
        if cursor:
            params["cursor"] = cursor
        page_items, next_cursor = _closed_pnl_page(
            await exchange.private_get_v5_position_closed_pnl(params)
        )
        if not page_items:
            break
        items.extend(page_items)
        if not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor
    else:
        raise Unmeasurable("page_ceiling")
    seen: set[tuple[str, str]] = set()
    kept: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            raise Unmeasurable("malformed")
        created = _created_ms(item)
        key = (str(item.get("symbol", "")), str(item.get("createdTime", "")))
        if key in seen:
            continue
        seen.add(key)
        if in_window(created, b_ms, r_ms):
            kept.append(item)
    return kept


def bybit_closed_pnl_terms(rows: Sequence[Mapping[str, Any]]) -> tuple[float, int]:
    """``(sum of the realized P&L ex funding, row count)`` with the chain's row formula verbatim
    (``fetch_daily_pnl``'s Bybit branch): ``side`` is the closing order's side, so ``buy`` closes a
    short and its position P&L is entry minus exit, any other side exit minus entry; the
    realized figure is the position P&L less ``openFee`` and ``closeFee``.

    A field that is not a finite number raises ``Unmeasurable("malformed")``: the chain drops such
    a row with a warning, and the probe refuses rather than print a sum missing a row. An absent
    field reads 0 like the chain's ``item.get(field, 0)``."""
    total = 0.0
    for row in rows:
        cum_entry = _finite_float(row.get("cumEntryValue", 0), label="walletoffset cumEntryValue")
        cum_exit = _finite_float(row.get("cumExitValue", 0), label="walletoffset cumExitValue")
        open_fee = _finite_float(row.get("openFee", 0), label="walletoffset openFee")
        close_fee = _finite_float(row.get("closeFee", 0), label="walletoffset closeFee")
        if cum_entry is None or cum_exit is None or open_fee is None or close_fee is None:
            raise Unmeasurable("malformed")
        side = str(row.get("side", "")).strip().lower()
        position_pnl = cum_entry - cum_exit if side == "buy" else cum_exit - cum_entry
        total += position_pnl - open_fee - close_fee
    return total, len(rows)


async def _measure_bybit(
    client: Any, supabase: ReadOnlySupabase, mark: StoredMark, read_at: datetime, label: str
) -> dict[str, Any]:
    """The Bybit key record values: closed P&L, SETTLEMENT funding, the Unified-edge count, the
    flow term and the arithmetic. Every ``private_get_`` call goes through the counted GET-only
    view; the ccxt flow fetchers run on the unwrapped client."""
    from services.bybit_unified_flows import fetch_bybit_unified_flows
    from services.funding_fetch import fetch_funding_bybit

    if not (math.isfinite(mark.nav_usd) and mark.nav_usd > 0.0):
        raise Unmeasurable("nav_nonpositive")  # before any venue call
    b_ms, r_ms = window_ms(read_at)
    budgeted = BudgetedExchange(client, KEY_CALL_CEILING)
    closed = await bybit_closed_pnl_rows(budgeted, b_ms, r_ms)
    trading_usd, closed_rows = bybit_closed_pnl_terms(closed)
    funding_usd = 0.0
    funding_rows = non_stable = 0
    settlement_rows_read = 0

    async def _counted_log(params: dict[str, Any]) -> Any:
        # ``fetch_funding_bybit`` drops a row it cannot read with only a log line, so count the rows
        # the venue sent and compare them with the rows it returns (below).
        nonlocal settlement_rows_read
        reply = await budgeted.private_get_v5_account_transaction_log(params)
        inner = reply.get("result") if isinstance(reply, dict) else None
        items = inner.get("list") if isinstance(inner, dict) else None
        if isinstance(items, list):
            settlement_rows_read += len(items)
        return reply

    chain_view: Any = SimpleNamespace(private_get_v5_account_transaction_log=_counted_log)
    settlement_rows = await fetch_funding_bybit(chain_view, label, b_ms)
    if len(settlement_rows) != settlement_rows_read:
        raise Unmeasurable("malformed")  # a SETTLEMENT row was dropped: the sum would miss it
    for funding in settlement_rows:
        stamp = funding["timestamp"]
        if stamp.tzinfo is None or stamp.utcoffset() is None:
            raise Unmeasurable("malformed")
        if not in_window(_epoch_ms(stamp), b_ms, r_ms):
            continue
        funding_rows += 1
        if str(funding["currency"]).upper() not in STABLECOINS:
            non_stable += 1
            continue
        amount = float(funding["amount"])
        if not math.isfinite(amount):
            raise Unmeasurable("malformed")
        funding_usd += amount
    deposits, withdrawals = await fetch_bybit_unified_flows(budgeted, b_ms, r_ms)
    unified_edge_rows = sum(
        1 for row in (*deposits, *withdrawals) if in_window(row["timestamp"], b_ms, r_ms)
    )
    flow_usd, flow_rows = await _window_flows(
        client, "bybit", supabase, mark_day_for(read_at), read_at, b_ms, r_ms
    )
    ratios = offset_terms(trading_usd, funding_usd, flow_usd, mark.nav_usd, mark.open_pnl_usd)
    return {
        "measured": True,
        "partial": non_stable > 0,
        **ratios,
        "closed_pnl_rows_in_window": closed_rows,
        "funding_rows_in_window": funding_rows,
        "unified_edge_rows_in_window": unified_edge_rows,
        "flow_rows_in_window": flow_rows,
        "non_stable_rows": non_stable,
    }


# ---------------------------------------------------------------------------
# Binance reader: one futures-income read for [B, R] and the flow term.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BinanceIncomeTerms:
    """The Binance window sums and the counts that qualify them."""

    trading_usd: float
    funding_usd: float
    income_rows_in_window: int
    funding_rows_in_window: int
    non_stable_rows: int


def _income_ms(row: Mapping[str, Any]) -> int:
    """A futures-income row's ``time`` as integer epoch milliseconds, or ``malformed``."""
    raw = row.get("time")
    if isinstance(raw, bool):
        raise Unmeasurable("malformed")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.isascii() and raw.isdigit():
        return int(raw)
    raise Unmeasurable("malformed")


def binance_income_terms(rows: Sequence[Any], b_ms: int, r_ms: int) -> BinanceIncomeTerms:
    """Sum the window's income rows with the chain's split: ``REALIZED_PNL`` and ``COMMISSION`` as
    trading (the chain's ``fetch_daily_pnl``), ``FUNDING_FEE`` as funding (the chain's
    ``fetch_funding_binance``). Every other income type is counted and summed nowhere.

    A summed row whose ``asset`` is not a stablecoin (or is absent) is counted in ``non_stable_rows``
    and left out. A summed row whose ``income`` is not a finite number, any row whose ``time`` is
    not an integer, and any row that is not an object raise ``Unmeasurable("malformed")``; the
    chain drops such a row with a warning and the probe refuses rather than print a sum missing a
    row."""
    trading = funding = 0.0
    counted = funding_rows = non_stable = 0
    for row in rows:
        if not isinstance(row, Mapping):
            raise Unmeasurable("malformed")
        if not in_window(_income_ms(row), b_ms, r_ms):
            continue
        counted += 1
        income_type = row.get("incomeType")
        is_funding = income_type == _BINANCE_FUNDING_INCOME_TYPE
        if is_funding:
            funding_rows += 1
        if not is_funding and income_type not in _BINANCE_TRADING_INCOME_TYPES:
            continue
        asset = row.get("asset")
        if not (isinstance(asset, str) and asset.upper() in STABLECOINS):
            non_stable += 1
            continue
        income = _finite_float(row.get("income", 0), label="walletoffset income")
        if income is None:
            raise Unmeasurable("malformed")
        if is_funding:
            funding += income
        else:
            trading += income
    return BinanceIncomeTerms(
        trading_usd=trading,
        funding_usd=funding,
        income_rows_in_window=counted,
        funding_rows_in_window=funding_rows,
        non_stable_rows=non_stable,
    )


async def _measure_binance(
    client: Any, supabase: ReadOnlySupabase, mark: StoredMark, read_at: datetime, label: str
) -> dict[str, Any]:
    """The Binance key record values: ONE futures-income read for [B, R], the chain's split, the
    flow term and the arithmetic. The income GET is called by its exact name (it is not a
    ``private_get_`` implicit name, so the counted view does not resolve it); the source pins
    refuse every write name in both naming styles."""
    if not (math.isfinite(mark.nav_usd) and mark.nav_usd > 0.0):
        raise Unmeasurable("nav_nonpositive")  # before any venue call
    b_ms, r_ms = window_ms(read_at)
    reply = await client.fapiPrivateGetIncome(
        {"startTime": b_ms, "endTime": r_ms, "limit": BINANCE_INCOME_LIMIT}
    )
    if not isinstance(reply, list):
        raise Unmeasurable("malformed")
    if len(reply) >= BINANCE_INCOME_LIMIT:
        raise Unmeasurable("page_ceiling")  # a full page cannot prove the window complete
    terms = binance_income_terms(reply, b_ms, r_ms)
    flow_usd, flow_rows = await _window_flows(
        client, "binance", supabase, mark_day_for(read_at), read_at, b_ms, r_ms
    )
    ratios = offset_terms(
        terms.trading_usd, terms.funding_usd, flow_usd, mark.nav_usd, mark.open_pnl_usd
    )
    return {
        "measured": True,
        "partial": terms.non_stable_rows > 0,
        **ratios,
        "income_rows_in_window": terms.income_rows_in_window,
        "funding_rows_in_window": terms.funding_rows_in_window,
        "flow_rows_in_window": flow_rows,
        "non_stable_rows": terms.non_stable_rows,
    }


# ---------------------------------------------------------------------------
# Run layer.
# ---------------------------------------------------------------------------


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_marked_at(raw: str) -> datetime:
    """The mark's read instant as an aware UTC datetime, or ``malformed``."""
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise Unmeasurable("malformed") from exc
    if moment.tzinfo is None or moment.utcoffset() is None:
        raise Unmeasurable("malformed")
    return moment.astimezone(timezone.utc)


async def _measure_okx(
    client: Any, supabase: ReadOnlySupabase, mark: StoredMark, read_at: datetime, label: str
) -> dict[str, Any]:
    """The OKX key record values: the bills archive walk, the chain's terms, the flow term and
    the arithmetic."""
    if not (math.isfinite(mark.nav_usd) and mark.nav_usd > 0.0):
        raise Unmeasurable("nav_nonpositive")  # before any venue call
    b_ms, r_ms = window_ms(read_at)
    bills = await walk_okx_window_bills(BudgetedExchange(client, KEY_CALL_CEILING), b_ms)
    terms = okx_window_terms(bills, b_ms, r_ms)
    flow_usd, flow_rows = await _window_flows(
        client, "okx", supabase, mark_day_for(read_at), read_at, b_ms, r_ms
    )
    ratios = offset_terms(
        terms.trading_usd, terms.funding_usd, flow_usd, mark.nav_usd, mark.open_pnl_usd
    )
    return {
        "measured": True,
        "partial": terms.non_stable_rows > 0,
        **ratios,
        "bills_in_window": terms.bills_in_window,
        "transfer_bills_in_window": terms.transfer_bills_in_window,
        "spot_bills_in_window": terms.spot_bills_in_window,
        "other_inst_bills_in_window": terms.other_inst_bills_in_window,
        "funding_rows_in_window": terms.funding_rows_in_window,
        "flow_rows_in_window": flow_rows,
        "non_stable_rows": terms.non_stable_rows,
    }


#: A venue appears here only when its chain books a realized P&L the probe can rebuild. sFOX is
#: absent on purpose (see the module docstring).
_VENUE_READERS: dict[str, Callable[..., Awaitable[dict[str, Any]]]] = {
    "okx": _measure_okx,
    "bybit": _measure_bybit,
    "binance": _measure_binance,
}


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
        "shares_account": False,
        **values,
    }


def _mark_facts(mark: StoredMark) -> dict[str, Any]:
    """The mark's label day and the read's hours past UTC midnight; what the database holds,
    known even when the venue read fails."""
    facts: dict[str, Any] = {
        "first_mark_day": mark.mark_day if _DATE_RE.match(mark.mark_day) else FIELD_ABSENT,
        "read_delay_hours": FIELD_ABSENT,
    }
    try:
        read_at = _parse_marked_at(mark.marked_at)
    except Unmeasurable:
        return facts
    b_ms, r_ms = window_ms(read_at)
    facts["read_delay_hours"] = sig3((r_ms - b_ms) / _HOUR_MS)
    return facts


def summarize(records: Sequence[Mapping[str, Any]], run_date: str) -> dict[str, Any]:
    """Counts and maxima derived from the key records in code."""
    marked = [r for r in records if r["unmeasurable_reason"] != "no_mark"]
    measured = [r for r in records if r["measured"]]
    summary: dict[str, Any] = {
        "record": "summary",
        "run_date": run_date,
        "keys": len(records),
        "keys_marked": len(marked),
        "keys_measured": len(measured),
        "keys_unmeasurable": len(marked) - len(measured),
    }
    for venue in PROBE_VENUES:
        v_all = [r for r in records if r["venue"] == venue]
        v_marked = [r for r in v_all if r["unmeasurable_reason"] != "no_mark"]
        v_measured = [r for r in v_all if r["measured"]]
        if not v_all:
            state = "no_keys"
        elif not v_marked:
            state = "no_marked_keys"
        elif len(v_measured) == len(v_marked):
            state = "measured"
        elif v_measured:
            state = "partly_measured"
        else:
            state = "unmeasured"
        summary[f"{venue}_keys"] = len(v_all)
        summary[f"{venue}_keys_marked"] = len(v_marked)
        summary[f"{venue}_keys_measured"] = len(v_measured)
        summary[f"{venue}_state"] = state
        for name in ("pnl", "offset"):
            shown = [
                abs(r[f"{name}_ratio"])
                for r in v_measured
                if isinstance(r[f"{name}_ratio"], float)
            ]
            summary[f"{venue}_max_abs_{name}_ratio"] = max(shown) if shown else FIELD_ABSENT
    return summary


def _unmeasured_record(
    label: str,
    venue: str,
    run_date: str,
    shares: bool,
    facts: Mapping[str, Any],
    exc: BaseException,
) -> dict[str, Any]:
    """The record of a key that could not be measured: its closed reason and class, the mark
    facts the database holds, and every reading ``field-absent``."""
    reason, failure_class = failure_token(exc)
    return _key_record(
        label,
        venue,
        run_date,
        shares_account=shares,
        unmeasurable_reason=reason,
        failure_class=failure_class,
        **facts,
    )


def _shares_account(key_row: Mapping[str, Any], key_rows: Sequence[Mapping[str, Any]]) -> bool:
    """True when this key reads an account another selected key also reads: it carries a
    share marker itself, or another selected key names it as its holder."""
    if key_row.get("account_share_kind") is not None:
        return True
    key_id = key_row.get("id")
    return any(
        other.get("id") != key_id and other.get("account_shared_with_api_key_id") == key_id
        for other in key_rows
    )


def _check_readable(
    key_row: Mapping[str, Any], mark: StoredMark, run_at: datetime
) -> datetime:
    """Refuse, before any credential is decrypted, a marked key the probe cannot measure
    without a venue read. Returns the mark's read instant when the key may be read.

    Order: a malformed mark, a key the backfill does not derive, a venue with no reader, a
    window older than the venue's trade history, a window too young for the archive."""
    venue = str(key_row.get("exchange"))
    read_at = _parse_marked_at(mark.marked_at)  # malformed: not an aware timestamp
    if mark.venue != venue or mark_day_for(read_at).isoformat() != mark.mark_day:
        # The table's CHECK should make this impossible; if it fires it is a fact to see.
        raise Unmeasurable("malformed")
    # The backfill's own dispatch filter (is_active, not revoked, not disconnected), NOT the
    # stricter ``working_holder_predicate``. The backfill derives a series for a key whose last
    # sync is ``error`` or ``sign_in_failed``, so that key's published numbers carry the offset
    # and it is read; ``error`` is also stamped for transient causes (a geo block, a failed
    # positions poll), so refusing on it would make a readable key unmeasurable. A key that
    # cannot sign in fails the read and prints its exception class.
    if not eligible_key_predicate(key_row):
        raise Unmeasurable("key_not_eligible")
    if venue not in _VENUE_READERS:
        raise Unmeasurable("reader_not_built")
    b_ms, r_ms = window_ms(read_at)
    if (run_at.date() - _from_epoch_ms(b_ms).date()).days > RETENTION_DAYS[venue]:
        raise Unmeasurable("window_outside_retention")
    if venue == "okx" and (_epoch_ms(run_at) - r_ms) < OKX_MIN_WINDOW_AGE_S * 1000:
        raise Unmeasurable("window_too_recent")
    return read_at


async def _read_one_key(
    key_row: Mapping[str, Any],
    mark: StoredMark,
    read_at: datetime,
    kek: bytes,
    supabase: ReadOnlySupabase,
    label: str,
) -> dict[str, Any]:
    """Decrypt, build the client, run the venue reader under the per-key bound and close the
    client in every case. Raises on any failure; ``failure_token`` names it."""
    from services.encryption import decrypt_credentials
    from services.exchange import aclose_exchange
    from services.job_worker import _make_exchange_client

    venue = str(key_row.get("exchange"))
    client: Any = None
    try:
        api_key, api_secret, passphrase = decrypt_credentials(dict(key_row), kek)
        client = _make_exchange_client(venue, api_key, api_secret, passphrase)
        return await asyncio.wait_for(
            _VENUE_READERS[venue](client, supabase, mark, read_at, label), KEY_READ_TIMEOUT_S
        )
    finally:
        if client is not None:
            await aclose_exchange(client)


async def run() -> int:
    """Select the keys on the four wallet-base venues, read each key's first mark, measure the
    keys that have one and may be read, and print one JSON line per key and a summary."""
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
        key_id = str(key_row.get("id"))
        shares = _shares_account(key_row, key_rows)
        facts: dict[str, Any] = {}
        record: dict[str, Any] | None = None
        mark: StoredMark | None = None
        read_at: datetime | None = None
        try:
            marks = await db_execute(lambda: read_key_marks(supabase, key_id))
            if not marks:
                record = _key_record(
                    label, venue, run_date, shares_account=shares, unmeasurable_reason="no_mark"
                )
            else:
                mark = marks[0]
                facts = _mark_facts(mark)
                read_at = _check_readable(key_row, mark, run_at)
        except Exception as exc:  # noqa: BLE001 - mapped to a closed token; the message is never read
            record = _unmeasured_record(label, venue, run_date, shares, facts, exc)
        if record is None and mark is not None and read_at is not None:
            if kek is None:
                kek = get_kek()
            try:
                values = await _read_one_key(key_row, mark, read_at, kek, supabase, label)
                record = _key_record(
                    label, venue, run_date, shares_account=shares, **facts, **values
                )
            except Exception as exc:  # noqa: BLE001 - mapped to a closed token; the message is never read
                record = _unmeasured_record(label, venue, run_date, shares, facts, exc)
        if record is None:  # pragma: no cover - unreachable: every branch above sets a record
            raise RuntimeError("walletoffset_probe: a key produced no record")
        records.append(record)
        print(emit_record(record), flush=True)
    summary = summarize(records, run_date)
    print(emit_record(summary), flush=True)
    return EXIT_OK if summary["keys_unmeasurable"] == 0 else EXIT_FAILED


def deploy_fingerprint() -> str:
    """One line naming the shape of the deployed probe: the two exit codes, the sizes of the key
    record, summary record and unmeasurable vocabularies, and the sorted venues that have a
    reader. Plan 184-04 prints it on the worker and compares it with the line computed at the
    reviewed commit, so the worker is shown to run the reviewed code."""
    return " ".join(
        [
            "walletoffset",
            str(EXIT_OK),
            str(EXIT_FAILED),
            str(len(KEY_RECORD_KEYS)),
            str(len(SUMMARY_RECORD_KEYS)),
            str(len(UNMEASURABLE_REASONS)),
            ",".join(sorted(_VENUE_READERS)),
        ]
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="WALLETOFFSET read-only first-mark offset probe (takes no arguments)"
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
