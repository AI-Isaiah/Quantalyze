"""Archive trade bill -> stored fill mapping, and the value reconcile against stored fills (Phase 259, plan 04).

Pure module: stdlib plus ``services.exchange`` (the per-fill normaliser and the contract-size
table), ``services.okx_archive_files`` and ``services.okx_archive_classify._bill_id_shape``. No
network, no database, no clock, and NO import of ``okx_archive_job`` or ``job_worker`` (the job
modules import this one, never the other way round).

What it maps. One OKX ``bills-history-archive`` trade bill carries the cells of one fill: ``subType``
(1 buy/net, 2 sell/net, 3 buy/long, 4 sell/short, 5 sell/long, 6 buy/short), ``px``, ``sz``, ``fee``,
``ccy``, ``ts``, ``ordId``, ``tradeId``, ``execType``. The mapper rebuilds the ``fills-history``
object those cells came from and hands it to ``services.exchange._normalize_okx_fill``, the SAME
helper the live ``fills-history`` pager calls. One normaliser for both sources makes the equality
the phase promises (an archive fill equals the live fill of the same trade on symbol, side, price,
quantity, fee, timestamp and ``exchange_fill_id``) structural rather than a thing two copies must
keep true. The only addition is ``raw_data["source"]``, set after the factory returns because the
factory's raw-data trim would drop an unknown key.

Which bills count as fills is closed and named, never assumed. Every refusal is a
``FillsMapError`` whose ``stop_class`` is one of ``MAP_STOP_CLASSES``:

* ``unproven_inst_type``    - a trade-shaped bill of an instType or settle currency not proven on a
                              real file (anything but SWAP settled in USDT)
* ``unmapped_trade_subtype``- a trade-shaped bill whose subType is outside the six this module maps
* ``unreadable_trade_bill`` - a blank or malformed tradeId, px or sz, or a bill the helper drops
* ``unknown_contract_size`` - an instrument prefix outside the contract-size table (a silent 1.0
                              fallback would store a 10x-wrong ETH quantity)
* ``duplicate_trade_id``    - two trade bills with one tradeId (``ignore_duplicates`` would hide the
                              second)
* ``fills_reconcile_miss``  - the archive fills and the stored fills of one window differ

Value-free rule. Neither an exception's text nor its ``detail`` ever carries a tradeId, an amount, a
price or a raw cell: ``detail`` holds counts, UTC days, closed field names and value-free shape
tokens only (an account-size leak class). The text is the class name alone. The cell checks run
BEFORE the helper is called so the helper's own log lines (which quote the offending value) are
not reached by a cell this module can already name.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Final, Mapping, Sequence

from services.exchange import _OKX_INGEST_CONTRACT_SIZE, _normalize_okx_fill
from services.okx_archive_classify import _bill_id_shape
from services.okx_archive_files import ArchiveFile, ArchiveRow

#: ``raw_data["source"]`` of every archive-built row. Equals ``okx_archive_job._ARCHIVE_SOURCE`` (a
#: test pins the two together); this module may not import the job to share it.
ARCHIVE_SOURCE: Final[str] = "okx_bills_history_archive"

#: The archive column that feeds the stored timestamp. The live normaliser stores ``ts``; the only
#: other legal value is "fillTime", and swapping it is the whole fix if a real reconcile shows ``ts``
#: unequal and ``fillTime`` equal (the reconcile reports both columns' match counts).
ARCHIVE_TS_COLUMN: Final[str] = "ts"

#: subType -> (side, posSide), the CONTEXT table.
SUBTYPE_SIDES: Final[Mapping[str, tuple[str, str]]] = {
    "1": ("buy", "net"),
    "2": ("sell", "net"),
    "3": ("buy", "long"),
    "4": ("sell", "short"),
    "5": ("sell", "long"),
    "6": ("buy", "short"),
}

#: SubTypes whose ``px`` OKX documents as a fill, liquidation, delivery or exercise price but which
#: are not mapped above: block trades (204-209), forced repayment (114, 115), liquidations
#: (100-107), delivery (112, 113) and option exercise (170-172). A bill of one is refused as
#: ``unmapped_trade_subtype``, never silently skipped.
FILL_LIKE_UNMAPPED_SUBTYPES: Final[frozenset[str]] = frozenset(
    {"100", "101", "102", "103", "104", "105", "106", "107", "112", "113", "114", "115",
     "170", "171", "172", "204", "205", "206", "207", "208", "209"}
)

#: The instTypes and settle currencies proven on a real archive file (measured on PROD).
PROVEN_INST_TYPES: Final[frozenset[str]] = frozenset({"SWAP"})
PROVEN_SETTLE_CCYS: Final[frozenset[str]] = frozenset({"USDT"})

MAP_STOP_CLASSES: Final[frozenset[str]] = frozenset(
    {
        "unproven_inst_type",
        "unmapped_trade_subtype",
        "unreadable_trade_bill",
        "unknown_contract_size",
        "duplicate_trade_id",
        "fills_reconcile_miss",
    }
)

# The order one bill is judged in, and the order the raised class is picked in.
_BILL_CLASS_ORDER: Final[tuple[str, ...]] = (
    "unproven_inst_type",
    "unmapped_trade_subtype",
    "unreadable_trade_bill",
    "unknown_contract_size",
    "duplicate_trade_id",
)

# The order a reconcile miss names its field in (the first with a non-zero tally).
_MISS_FIELD_ORDER: Final[tuple[str, ...]] = (
    "stored_unreadable",
    "stored_duplicate",
    "absent_in_archive",
    "absent_in_stored",
    "count",
    "symbol",
    "side",
    "price",
    "quantity",
    "fee",
    "fee_currency",
    "timestamp",
)

_TRADE_ID_RE: Final[re.Pattern[str]] = re.compile(r"-?[0-9]{1,32}")
_PLAIN_DECIMAL_RE: Final[re.Pattern[str]] = re.compile(r"[0-9]+(\.[0-9]+)?")
_LABEL_RE: Final[re.Pattern[str]] = re.compile(r"[0-9A-Za-z_-]{1,16}")
_MALFORMED: Final[str] = "(malformed)"

# The bounds ``exchange._finite_decimal`` applies to a money string; checking them first keeps the
# helper from logging a cell this module can already name.
_MONEY_MAXLEN: Final[int] = 48
_MONEY_MAX_ADJUSTED: Final[int] = 30
_MAX_SHAPES: Final[int] = 10
_EPOCH: Final[datetime] = datetime(1970, 1, 1, tzinfo=timezone.utc)


class FillsMapError(Exception):
    """A permanent, named stop. The text is the class alone; ``detail`` holds counts, UTC days,
    closed field names and value-free shape tokens only (never an id, an amount or a raw cell)."""

    def __init__(self, stop_class: str, detail: Mapping[str, Any] | None = None) -> None:
        if stop_class not in MAP_STOP_CLASSES:
            raise AssertionError(f"unknown fills map stop class {stop_class!r}")
        self.stop_class: str = stop_class
        self.detail: dict[str, Any] = dict(detail or {})
        super().__init__(stop_class)


@dataclass(frozen=True)
class MappedFill:
    """One archive trade bill as the stored row it becomes.

    ``row_ms`` is the instant ``row["timestamp"]`` encodes (the ``ARCHIVE_TS_COLUMN`` cell);
    ``bill_ts_ms`` and ``fill_time_ms`` are the two archive columns, kept so a reconcile can say which
    one the stored fills agree with."""

    trade_id: str
    bill_ts_ms: int
    fill_time_ms: int | None
    row_ms: int
    row: dict[str, Any]


@dataclass(frozen=True)
class StoredFill:
    """One stored ``trades`` row, read the way PostgREST returns it (numbers as JSON numbers or text)."""

    trade_id: str
    symbol: str
    side: str
    price: Decimal
    quantity: Decimal
    fee: Decimal | None
    fee_currency: str | None
    instant: datetime


# --------------------------------------------------------------------------- small readers
def _label(value: str) -> str:
    """A closed-alphabet label for a cell echoed in a count or detail, else ``(malformed)``."""
    return value if _LABEL_RE.fullmatch(value) else _MALFORMED


def _settle_of(inst_id: str) -> str:
    parts = inst_id.split("-")
    return parts[1].upper() if len(parts) >= 2 else ""


def _is_trade_shaped(row: ArchiveRow) -> bool:
    """A bill that records a fill: a mapped trade subType, any bill carrying an ``execType``
    (OKX marks every fill taker or maker), or a subType whose ``px`` the docs define as a fill
    price outside the mapped set (refused by name, never skipped). Measured on the real PROD
    files 2026-11-28: funding (173/174) and transfer (11/12) bills ALSO carry a ``tradeId``, so a
    ``tradeId`` alone does not make a bill a fill."""
    return (
        row.sub_type in SUBTYPE_SIDES
        or bool(row.exec_type.strip())
        or row.sub_type in FILL_LIKE_UNMAPPED_SUBTYPES
    )


def _unique_bills(files: Sequence[ArchiveFile]) -> list[ArchiveRow]:
    """Every bill once, the first file's copy winning (as ``verify_bal_chain`` reads them)."""
    seen: set[str] = set()
    out: list[ArchiveRow] = []
    for file in files:
        for row in file.rows:
            if row.bill_id in seen:
                continue
            seen.add(row.bill_id)
            out.append(row)
    return out


def _readable_money(text: str) -> bool:
    """``px`` / ``sz``: a plain positive finite decimal inside the helper's own bounds."""
    if len(text) > _MONEY_MAXLEN or not _PLAIN_DECIMAL_RE.fullmatch(text):
        return False
    try:
        value = Decimal(text)
    except InvalidOperation:
        return False
    return value > 0 and abs(value.adjusted()) <= _MONEY_MAX_ADJUSTED


def _readable_fill_time(text: str) -> bool:
    return text.isascii() and text.isdigit() and len(text) <= 16


def _readable_cells(row: ArchiveRow) -> bool:
    if not _TRADE_ID_RE.fullmatch(row.trade_id):
        return False
    if not (_readable_money(row.px_raw) and _readable_money(row.sz_raw)):
        return False
    return ARCHIVE_TS_COLUMN != "fillTime" or _readable_fill_time(row.fill_time_raw)


def _contract_size_known(inst_id: str) -> bool:
    parts = inst_id.split("-")
    return len(parts) >= 2 and f"{parts[0]}-{parts[1]}" in _OKX_INGEST_CONTRACT_SIZE


def _judge(row: ArchiveRow) -> str | None:
    """The first refusal class a trade-shaped bill meets before the helper runs, else None."""
    if row.inst_type not in PROVEN_INST_TYPES or _settle_of(row.inst_id) not in PROVEN_SETTLE_CCYS:
        return "unproven_inst_type"
    if row.sub_type not in SUBTYPE_SIDES:
        return "unmapped_trade_subtype"
    if not _readable_cells(row):
        return "unreadable_trade_bill"
    if not _contract_size_known(row.inst_id):
        return "unknown_contract_size"
    return None


# --------------------------------------------------------------------------- census
def archive_census(files: Sequence[ArchiveFile]) -> dict[str, Any]:
    """What the archive bills held, counted without raising: instType and subType tallies, the
    trade-bill counts, how many trade cells are readable, and the value-free shapes of tradeIds that
    are not plain digits. The first real file is the first real look at these cells, so a stop still
    reports this."""
    bills = _unique_bills(files)
    by_inst_type: dict[str, int] = {}
    by_sub_type: dict[str, int] = {}
    trade_by_inst_type: dict[str, int] = {}
    readable = {"trade_id": 0, "px": 0, "sz": 0, "fill_time": 0, "ord_id": 0, "exec_type": 0}
    shapes: dict[str, int] = {}
    trade_bills = 0
    for row in bills:
        inst = _label(row.inst_type)
        by_inst_type[inst] = by_inst_type.get(inst, 0) + 1
        sub = _label(row.sub_type)
        by_sub_type[sub] = by_sub_type.get(sub, 0) + 1
        if not _is_trade_shaped(row):
            continue
        trade_bills += 1
        trade_by_inst_type[inst] = trade_by_inst_type.get(inst, 0) + 1
        if _TRADE_ID_RE.fullmatch(row.trade_id):
            readable["trade_id"] += 1
        elif row.trade_id:
            shape = _bill_id_shape(row.trade_id)
            shapes[shape] = shapes.get(shape, 0) + 1
        readable["px"] += _readable_money(row.px_raw)
        readable["sz"] += _readable_money(row.sz_raw)
        readable["fill_time"] += _readable_fill_time(row.fill_time_raw)
        readable["ord_id"] += bool(row.ord_id)
        readable["exec_type"] += bool(row.exec_type)
    ranked = sorted(shapes.items(), key=lambda kv: (-kv[1], kv[0]))
    kept = dict(ranked[:_MAX_SHAPES])
    rest = sum(count for _, count in ranked[_MAX_SHAPES:])
    if rest:
        kept["(more)"] = rest
    return {
        "bills": len(bills),
        "by_inst_type": by_inst_type,
        "by_sub_type": by_sub_type,
        "trade_bills": trade_bills,
        "trade_bills_by_inst_type": trade_by_inst_type,
        "readable": readable,
        "trade_id_shapes": kept,
    }


# --------------------------------------------------------------------------- mapping
def _synthesize(row: ArchiveRow) -> dict[str, Any]:
    """The ``fills-history``-shaped object this bill's cells came from (a fresh dict per call: the
    helper mutates its input)."""
    side, pos_side = SUBTYPE_SIDES[row.sub_type]
    ts_cell = str(row.ts_ms) if ARCHIVE_TS_COLUMN == "ts" else row.fill_time_raw
    return {
        "instType": row.inst_type,
        "instId": row.inst_id,
        "side": side,
        "posSide": pos_side,
        "fillPx": row.px_raw,
        "fillSz": row.sz_raw,
        "fee": str(row.fee),
        "feeCcy": row.ccy,
        "ts": ts_cell,
        "fillTime": row.fill_time_raw,
        "ordId": row.ord_id,
        "tradeId": row.trade_id,
        "execType": row.exec_type,
    }


def map_trade_bills(files: Sequence[ArchiveFile]) -> list[MappedFill]:
    """Every archive trade bill as a stored-fill row, or a named stop.

    All bills are judged before anything is raised, so the stop's detail counts every class present.
    The raised class is the first of ``_BILL_CLASS_ORDER`` that occurs; its detail holds ``count``
    (bills of that class), ``classes`` (a count per class present), ``first_day`` (the UTC day of the
    first offending bill) and ``shape`` (a value-free token, else None). Output order is
    ``(row_ms, trade_id)``."""
    counts: dict[str, int] = {}
    first: dict[str, tuple[str, str | None]] = {}

    def note(cls: str, row: ArchiveRow, shape: str | None = None) -> None:
        counts[cls] = counts.get(cls, 0) + 1
        first.setdefault(cls, (row.day, shape))

    mapped: list[MappedFill] = []
    seen_trade_ids: set[str] = set()
    for row in _unique_bills(files):
        if not _is_trade_shaped(row):
            continue
        refusal = _judge(row)
        if refusal is not None:
            shape: str | None = None
            if refusal == "unproven_inst_type":
                shape = f"{_label(row.inst_type)}/{_label(_settle_of(row.inst_id))}"
            elif refusal == "unreadable_trade_bill" and row.trade_id and not _TRADE_ID_RE.fullmatch(row.trade_id):
                shape = _bill_id_shape(row.trade_id)
            note(refusal, row, shape)
            continue
        normalized = _normalize_okx_fill(_synthesize(row), "SWAP", None)
        if normalized is None:
            note("unreadable_trade_bill", row)
            continue
        if row.trade_id in seen_trade_ids:
            note("duplicate_trade_id", row)
            continue
        seen_trade_ids.add(row.trade_id)
        normalized["raw_data"] = {**(normalized["raw_data"] or {}), "source": ARCHIVE_SOURCE}
        fill_time_ms = int(row.fill_time_raw) if _readable_fill_time(row.fill_time_raw) else None
        row_ms = row.ts_ms if ARCHIVE_TS_COLUMN == "ts" else int(row.fill_time_raw)
        mapped.append(
            MappedFill(
                trade_id=row.trade_id,
                bill_ts_ms=row.ts_ms,
                fill_time_ms=fill_time_ms,
                row_ms=row_ms,
                row=normalized,
            )
        )
    for cls in _BILL_CLASS_ORDER:
        if cls in counts:
            day, shape_token = first[cls]
            raise FillsMapError(
                cls,
                {"count": counts[cls], "classes": dict(counts), "first_day": day, "shape": shape_token},
            )
    mapped.sort(key=lambda m: (m.row_ms, m.trade_id))
    return mapped


# --------------------------------------------------------------------------- stored rows and reconcile
def _decimal(value: Any) -> Decimal | None:
    """A finite ``Decimal`` from a PostgREST number or text, else None (never a float conversion)."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        out = Decimal(str(value))
    except InvalidOperation:
        return None
    return out if out.is_finite() else None


def _instant(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def parse_stored_fill(row: Mapping[str, Any]) -> StoredFill | None:
    """A stored ``trades`` row as a ``StoredFill``, or None when it cannot be read exactly.

    None unless ``exchange_fill_id`` is a non-blank string, price and quantity are finite numbers,
    the fee is absent or a finite number, and the timestamp is an ISO string (a naive one is read as
    UTC). Numbers go through ``Decimal(str(value))``: PostgREST hands back JSON numbers or text."""
    trade_id = row.get("exchange_fill_id")
    if not isinstance(trade_id, str) or not trade_id.strip():
        return None
    price = _decimal(row.get("price"))
    quantity = _decimal(row.get("quantity"))
    instant = _instant(row.get("timestamp"))
    if price is None or quantity is None or instant is None:
        return None
    fee_raw = row.get("fee")
    fee = _decimal(fee_raw)
    if fee_raw is not None and fee is None:
        return None
    symbol = row.get("symbol")
    side = row.get("side")
    fee_currency = row.get("fee_currency")
    return StoredFill(
        trade_id=trade_id,
        symbol=symbol if isinstance(symbol, str) else "",
        side=side if isinstance(side, str) else "",
        price=price,
        quantity=quantity,
        fee=fee,
        fee_currency=fee_currency if isinstance(fee_currency, str) else None,
        instant=instant,
    )


def _instant_ms(instant: datetime) -> int:
    """The instant in epoch milliseconds, rounded to the nearest millisecond."""
    delta = instant - _EPOCH
    return (delta.days * 86_400 + delta.seconds) * 1000 + (delta.microseconds + 500) // 1000


def _diff_fields(mapped: MappedFill, stored: StoredFill) -> list[str]:
    """The fields on which a stored fill differs from its archive fill, in ``_MISS_FIELD_ORDER``'s
    order. Money by ``Decimal`` value and the timestamp by parsed instant, never by string."""
    row = mapped.row
    expected_instant = _instant(row["timestamp"])
    diffs: list[str] = []
    if stored.symbol != row["symbol"]:
        diffs.append("symbol")
    if stored.side != row["side"]:
        diffs.append("side")
    if stored.price != Decimal(row["price"]):
        diffs.append("price")
    if stored.quantity != Decimal(row["quantity"]):
        diffs.append("quantity")
    if stored.fee is None or stored.fee != Decimal(row["fee"]):
        diffs.append("fee")
    if stored.fee_currency != row["fee_currency"]:
        diffs.append("fee_currency")
    if expected_instant is None or stored.instant != expected_instant:
        diffs.append("timestamp")
    return diffs


def reconcile_window(
    mapped: Sequence[MappedFill],
    stored_rows: Sequence[Mapping[str, Any]],
    *,
    position: int,
) -> dict[str, Any]:
    """Compare the archive fills of one window with the stored ``fills-history`` fills, by value.

    Matched on tradeId. A miss is any stored row that cannot be read, any tradeId stored twice,
    any stored fill with no archive bill, any archive bill with no stored fill, a count that
    differs, or a matched pair differing on symbol, side, price, quantity, fee, fee_currency or
    timestamp. It raises ``fills_reconcile_miss`` naming the first failing field (in
    ``_MISS_FIELD_ORDER``) with a tally of every field. ``ts_match`` and ``fill_time_match`` count the
    matched pairs whose stored instant equals the bill's ``ts`` / ``fillTime`` at millisecond
    precision, so a reconcile that fails on timestamp also says which archive column agrees."""
    tally: dict[str, int] = {}

    def miss(field: str, n: int = 1) -> None:
        tally[field] = tally.get(field, 0) + n

    stored_by_id: dict[str, StoredFill] = {}
    for raw in stored_rows:
        parsed = parse_stored_fill(raw)
        if parsed is None:
            miss("stored_unreadable")
        elif parsed.trade_id in stored_by_id:
            miss("stored_duplicate")
        else:
            stored_by_id[parsed.trade_id] = parsed
    mapped_by_id = {m.trade_id: m for m in mapped}
    for trade_id in stored_by_id:
        if trade_id not in mapped_by_id:
            miss("absent_in_archive")
    pairs = 0
    ts_match = 0
    fill_time_match = 0
    for trade_id, fill in mapped_by_id.items():
        stored = stored_by_id.get(trade_id)
        if stored is None:
            miss("absent_in_stored")
            continue
        pairs += 1
        for field in _diff_fields(fill, stored):
            miss(field)
        stored_ms = _instant_ms(stored.instant)
        ts_match += stored_ms == fill.bill_ts_ms
        fill_time_match += fill.fill_time_ms is not None and stored_ms == fill.fill_time_ms
    if len(mapped) != len(stored_rows):
        miss("count")
    common = {
        "position": position,
        "pairs": pairs,
        "archive_count": len(mapped),
        "stored_count": len(stored_rows),
        "ts_column": ARCHIVE_TS_COLUMN,
        "ts_match": ts_match,
        "fill_time_match": fill_time_match,
    }
    for field in _MISS_FIELD_ORDER:
        if tally.get(field):
            raise FillsMapError(
                "fills_reconcile_miss",
                {"field": field, "misses_by_field": dict(tally), **common},
            )
    return {**common, "state": "window_empty" if not mapped and not stored_rows else "equal"}


def legacy_subset(
    mapped: Sequence[MappedFill],
    stored_rows: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """How the stored rows of the write window compare with their archive bills (never raises).

    It is the evidence for the quarters the live overlap cannot reach: ``matched`` stored rows equal
    their archive bill on every field, ``unequal`` ones differ (``unequal_by_field`` names the first
    differing field of each), ``absent_in_archive`` have no archive bill, ``unreadable`` could not be
    read. It reports and never stops; the job decides what a non-zero count means."""
    mapped_by_id = {m.trade_id: m for m in mapped}
    matched = 0
    unequal = 0
    unequal_by_field: dict[str, int] = {}
    absent = 0
    unreadable = 0
    for raw in stored_rows:
        stored = parse_stored_fill(raw)
        if stored is None:
            unreadable += 1
            continue
        fill = mapped_by_id.get(stored.trade_id)
        if fill is None:
            absent += 1
            continue
        diffs = _diff_fields(fill, stored)
        if diffs:
            unequal += 1
            unequal_by_field[diffs[0]] = unequal_by_field.get(diffs[0], 0) + 1
        else:
            matched += 1
    return {
        "stored": len(stored_rows),
        "matched": matched,
        "unequal": unequal,
        "unequal_by_field": unequal_by_field,
        "absent_in_archive": absent,
        "unreadable": unreadable,
    }
