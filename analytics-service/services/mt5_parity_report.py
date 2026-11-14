"""MT5 All-History Report parser for the parity harness (PARITY-01).

The Report is the one oracle the founder exports from the terminal itself. Its
layout is documented only in outline (sections, a Deals table, a Summary), so
this parser is a CONTRACT that refuses anything it did not predict instead of a
best-effort scraper:

* the encoding is sniffed from a BOM (UTF-16-LE, UTF-16-BE, UTF-8); no BOM means
  strict UTF-8, otherwise the file is refused (UTF-16 is never guessed);
* columns are located by header TEXT, never by index. An unknown header, a
  duplicate header or a missing required header is a named refusal;
* Type and Direction come from closed vocabularies; money, time and ids are
  parsed strictly (a decimal comma, a misplaced thousands separator, a missing
  Balance, a trading row without Symbol, Volume or Direction are refused);
* the Balance column must be continuous: from the second row on,
  ``balance_i - balance_{i-1} == profit + swap + commission + fee`` to half a
  cent. This is a parse-integrity check (assumption A3), not a parity tolerance.

Never returned: the header block (account name, number, owner), Symbol, Volume,
Price, Order and the free-text Comment column. Refusal messages name a header, a
column, a type text or a row ordinal, never a money value.

PURE: stdlib plus ``services.mt5_parity_capture.seal_bytes``. No network, no
database, no gateway; ``html.parser`` does not fetch external entities.
"""
from __future__ import annotations

import calendar
import codecs
import json
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from types import MappingProxyType
from typing import Any, Final

from services.mt5_parity_capture import seal_bytes

MAX_REPORT_BYTES: Final[int] = 32 * 1024 * 1024

REPORT_KNOWN_HEADERS: Final[frozenset[str]] = frozenset(
    {
        "Time",
        "Deal",
        "Symbol",
        "Type",
        "Direction",
        "Volume",
        "Price",
        "Order",
        "Commission",
        "Fee",
        "Swap",
        "Profit",
        "Balance",
        "Comment",
    }
)
REPORT_REQUIRED_HEADERS: Final[frozenset[str]] = frozenset(
    {"Time", "Deal", "Type", "Commission", "Swap", "Profit", "Balance"}
)

# Case-folded Type text to the MT5 DEAL_TYPE code, so ``classify_deal`` raises on
# the same types as in the worker (the fail-loud family keeps its code).
REPORT_TYPE_CODES: Final[Mapping[str, int]] = MappingProxyType(
    {
        "buy": 0,
        "sell": 1,
        "balance": 2,
        "credit": 3,
        "charge": 4,
        "correction": 5,
        "bonus": 6,
        "commission": 7,
        "daily commission": 8,
        "monthly commission": 9,
        "agent daily commission": 10,
        "agent monthly commission": 11,
        "interest": 12,
        "buy canceled": 13,
        "sell canceled": 14,
        "dividend": 15,
        "dividend franked": 16,
        "tax": 17,
    }
)

# Case-folded Direction text to the MT5 DEAL_ENTRY code.
REPORT_DIRECTION_CODES: Final[Mapping[str, int]] = MappingProxyType(
    {"in": 0, "out": 1, "in/out": 2, "out by": 3}
)

# Half a cent: the rounding of 2-decimal money. A parse-integrity check, not a
# parity tolerance (the parity band lives once, in services.mt5_parity).
BALANCE_CONTINUITY_ABS_TOL: Final[float] = 0.005

_TRADING_TYPES: Final[frozenset[int]] = frozenset({0, 1})
_ORACLE_VERSION: Final[int] = 1
_DEAL_KEYS: Final[frozenset[str]] = frozenset(
    {
        "deal",
        "time",
        "type",
        "entry",
        "profit",
        "swap",
        "commission",
        "fee",
        "balance",
        "position_id",
        "time_msc",
    }
)
_MONEY_KEYS: Final[tuple[str, ...]] = (
    "profit",
    "swap",
    "commission",
    "fee",
    "balance",
)

_MONEY_RE: Final[re.Pattern[str]] = re.compile(
    r"^[+-]?(?:\d{1,3}(?: \d{3})+|\d+)(?:\.\d+)?$"
)
_TIME_RE: Final[re.Pattern[str]] = re.compile(
    r"^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$"
)
_ID_RE: Final[re.Pattern[str]] = re.compile(r"^\d{1,18}$")
_COLSPAN_RE: Final[re.Pattern[str]] = re.compile(r"^\d{1,3}$")


class ReportRefused(ValueError):
    """The Report could not be parsed under the contract. Base of every named
    refusal below; messages never carry a money value."""


class ReportEncodingRefused(ReportRefused):
    """No BOM and not strict UTF-8, an undecodable body, or NUL characters."""


class ReportTooLarge(ReportRefused):
    """The file is larger than ``MAX_REPORT_BYTES``."""


class UnknownHeader(ReportRefused):
    """A Deals header outside ``REPORT_KNOWN_HEADERS``."""


class MissingHeader(ReportRefused):
    """A header in ``REPORT_REQUIRED_HEADERS`` is absent."""


class DuplicateHeader(ReportRefused):
    """The same Deals header appears twice."""


class RowShapeRefused(ReportRefused):
    """A row (or an oracle deal) does not fit the header contract."""


class UnknownDealType(ReportRefused):
    """A Type text outside ``REPORT_TYPE_CODES``."""


class UnknownDirection(ReportRefused):
    """A Direction text outside ``REPORT_DIRECTION_CODES``."""


class TradingRowIncomplete(ReportRefused):
    """A buy or sell row without its Symbol, Volume or Direction."""


class MoneyCellRefused(ReportRefused):
    """A money cell that is empty where required, uses a comma, is malformed or
    is not finite."""


class TimeCellRefused(ReportRefused):
    """A Time cell that is not ``YYYY.MM.DD HH:MM:SS``."""


class BalanceContinuityRefused(ReportRefused):
    """A row whose Balance does not follow from the previous Balance and its own
    profit, swap, commission and fee."""


class EmptyDeals(ReportRefused):
    """No Deals section, or a Deals section with no deal rows."""


@dataclass(frozen=True, slots=True)
class ParsedReport:
    """The parse result: deals in FILE order (a stable order for equal Time), the
    encoding that was sniffed, the canonical headers in file order and whether a
    Fee column existed (absent means every fee is 0.0)."""

    deals: tuple[Mapping[str, Any], ...]
    encoding: str
    headers: tuple[str, ...]
    fee_column_present: bool


@dataclass(frozen=True, slots=True)
class _Cell:
    tag: str
    text: str
    colspan: int


class _RowCollector(HTMLParser):
    """Collects every ``<tr>`` as a list of cells. Tolerates omitted ``</td>``
    and ``</tr>``; whitespace (including NBSP and thin spaces) is collapsed."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[_Cell]] = []
        self._row: list[_Cell] | None = None
        self._tag: str | None = None
        self._colspan = 1
        self._text: list[str] = []

    def _close_cell(self) -> None:
        if self._tag is None:
            return
        if self._row is None:
            self._row = []
        self._row.append(
            _Cell(self._tag, " ".join("".join(self._text).split()), self._colspan)
        )
        self._tag = None
        self._colspan = 1
        self._text = []

    def _close_row(self) -> None:
        self._close_cell()
        if self._row:
            self.rows.append(self._row)
        self._row = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._close_row()
            self._row = []
        elif tag in ("td", "th"):
            self._close_cell()
            colspan = 1
            for name, value in attrs:
                if name == "colspan":
                    raw = (value or "").strip()
                    if not _COLSPAN_RE.match(raw) or int(raw) < 1:
                        raise RowShapeRefused("a cell carries an invalid colspan")
                    colspan = int(raw)
            self._tag = tag
            self._colspan = colspan
        elif tag == "br" and self._tag is not None:
            self._text.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag == "tr":
            self._close_row()
        elif tag in ("td", "th"):
            self._close_cell()

    def handle_data(self, data: str) -> None:
        if self._tag is not None:
            self._text.append(data)

    def finish(self) -> list[list[_Cell]]:
        self.close()
        self._close_row()
        return self.rows


def _shown(text: str) -> str:
    """A bounded repr of an untrusted label (a header or a type text, never money)."""
    return repr(text[:40])


def _decode(data: bytes) -> tuple[str, str]:
    if len(data) > MAX_REPORT_BYTES:
        raise ReportTooLarge("the Report is larger than the size cap")
    if data.startswith(codecs.BOM_UTF16_LE):
        encoding, codec, body = "utf-16-le", "utf-16-le", data[2:]
    elif data.startswith(codecs.BOM_UTF16_BE):
        encoding, codec, body = "utf-16-be", "utf-16-be", data[2:]
    elif data.startswith(codecs.BOM_UTF8):
        encoding, codec, body = "utf-8-sig", "utf-8", data[3:]
    else:
        encoding, codec, body = "utf-8", "utf-8", data
    try:
        text = body.decode(codec, errors="strict")
    except UnicodeDecodeError:
        raise ReportEncodingRefused(
            "the Report has no BOM and is not strict UTF-8, or its body does not "
            f"decode as {encoding}"
        ) from None
    if "\x00" in text:
        # UTF-16 without a BOM can pass as UTF-8 when it is all ASCII; the NULs
        # give it away. Never guess an encoding.
        raise ReportEncodingRefused("the Report body carries NUL characters")
    return text, encoding


def _collect_rows(text: str) -> list[list[_Cell]]:
    collector = _RowCollector()
    collector.feed(text)
    return collector.finish()


def _is_deals_marker(row: list[_Cell]) -> bool:
    return len(row) == 1 and row[0].tag == "th" and row[0].text.casefold() == "deals"


def _canonical_headers(header_row: list[_Cell]) -> tuple[str, ...]:
    if any(c.tag != "th" or c.colspan != 1 for c in header_row):
        raise RowShapeRefused("the Deals header row is not a row of plain header cells")
    by_fold = {h.casefold(): h for h in REPORT_KNOWN_HEADERS}
    names: list[str] = []
    for cell in header_row:
        canonical = by_fold.get(cell.text.casefold())
        if canonical is None:
            raise UnknownHeader(f"unknown Deals header {_shown(cell.text)}")
        names.append(canonical)
    seen: set[str] = set()
    for name in names:
        if name in seen:
            raise DuplicateHeader(f"the Deals header {name!r} appears more than once")
        seen.add(name)
    missing = sorted(REPORT_REQUIRED_HEADERS - seen)
    if missing:
        raise MissingHeader(
            "the Deals table lacks required header(s): " + ", ".join(missing)
        )
    return tuple(names)


def _money(text: str, column: str, ordinal: int, *, empty_is_zero: bool) -> float:
    if not text:
        if empty_is_zero:
            return 0.0
        raise MoneyCellRefused(f"Deals row {ordinal}: the {column} cell is empty")
    if "," in text:
        raise MoneyCellRefused(
            f"Deals row {ordinal}: the {column} cell uses a comma (a decimal-comma "
            "locale is not supported)"
        )
    if not _MONEY_RE.match(text):
        raise MoneyCellRefused(f"Deals row {ordinal}: the {column} cell is not a number")
    value = float(text.replace(" ", ""))
    if not math.isfinite(value):
        raise MoneyCellRefused(f"Deals row {ordinal}: the {column} cell is not finite")
    return value


def _time(text: str, ordinal: int) -> int:
    if not _TIME_RE.match(text):
        raise TimeCellRefused(
            f"Deals row {ordinal}: the Time cell is not YYYY.MM.DD HH:MM:SS"
        )
    try:
        moment = datetime.strptime(text, "%Y.%m.%d %H:%M:%S")
    except ValueError:
        raise TimeCellRefused(
            f"Deals row {ordinal}: the Time cell is not a calendar time"
        ) from None
    # Epoch seconds as if the wall time were UTC: the gateway's own encoding of a
    # deal time (mt5_server_clock). The server offset is applied downstream.
    return calendar.timegm(moment.timetuple())


def _parse_row(
    cells: list[_Cell], names: tuple[str, ...], ordinal: int
) -> dict[str, Any]:
    by_name = {name: cells[i].text for i, name in enumerate(names)}

    deal_text = by_name["Deal"]
    if not _ID_RE.match(deal_text):
        raise RowShapeRefused(f"Deals row {ordinal}: the Deal cell is not an integer id")

    type_text = by_name["Type"].casefold()
    deal_type = REPORT_TYPE_CODES.get(type_text)
    if deal_type is None:
        raise UnknownDealType(
            f"Deals row {ordinal}: unknown deal type {_shown(by_name['Type'])}"
        )

    entry: int | None = None
    direction_text = by_name.get("Direction", "")
    if direction_text:
        entry = REPORT_DIRECTION_CODES.get(direction_text.casefold())
        if entry is None:
            raise UnknownDirection(
                f"Deals row {ordinal}: unknown direction {_shown(direction_text)}"
            )

    if deal_type in _TRADING_TYPES:
        for column in ("Symbol", "Volume", "Direction"):
            if column in by_name and not by_name[column]:
                raise TradingRowIncomplete(
                    f"Deals row {ordinal}: a buy or sell row has an empty {column} cell"
                )

    return {
        "deal": int(deal_text),
        "time": _time(by_name["Time"], ordinal),
        "type": deal_type,
        "entry": entry,
        "profit": _money(by_name["Profit"], "Profit", ordinal, empty_is_zero=False),
        "swap": _money(by_name["Swap"], "Swap", ordinal, empty_is_zero=True),
        "commission": _money(
            by_name["Commission"], "Commission", ordinal, empty_is_zero=True
        ),
        "fee": _money(by_name.get("Fee", ""), "Fee", ordinal, empty_is_zero=True),
        "balance": _money(by_name["Balance"], "Balance", ordinal, empty_is_zero=False),
        "position_id": None,
        "time_msc": None,
    }


def parse_report(data: bytes) -> ParsedReport:
    """Parse an MT5 All-History Report to its deal list, or raise a named
    ``ReportRefused`` subclass."""
    text, encoding = _decode(data)
    rows = _collect_rows(text)

    markers = [i for i, row in enumerate(rows) if _is_deals_marker(row)]
    if not markers:
        raise EmptyDeals("the Report has no Deals section")
    if len(markers) > 1:
        raise RowShapeRefused("the Report has more than one Deals section")
    start = markers[0]
    if start + 1 >= len(rows):
        raise EmptyDeals("the Deals section has no header row")

    names = _canonical_headers(rows[start + 1])
    width = len(names)

    deals: list[dict[str, Any]] = []
    body = rows[start + 2 :]
    for ordinal, row in enumerate(body, start=1):
        span = sum(c.colspan for c in row)
        if len(row) == width and span == width:
            deals.append(_parse_row(row, names, ordinal))
            continue
        if (
            len(row) < width
            and span == width
            and (row[0].tag == "th" or row[0].colspan > 1)
        ):
            # A footer or the next section marker. Nothing deal-shaped may follow it: a
            # mid-table subtotal would otherwise silently cut the oracle short.
            for later_ordinal, later in enumerate(body[ordinal:], start=ordinal + 1):
                if len(later) == width and sum(c.colspan for c in later) == width:
                    raise RowShapeRefused(
                        f"Deals row {later_ordinal} is deal-shaped but follows a footer-shaped row"
                    )
            break
        raise RowShapeRefused(
            f"Deals row {ordinal} does not fit the {width}-column header"
        )

    if not deals:
        raise EmptyDeals("the Deals section has no deal rows")

    seen_ids: set[int] = set()
    for ordinal, deal in enumerate(deals, start=1):
        if deal["deal"] in seen_ids:
            raise RowShapeRefused(f"Deals row {ordinal} repeats an earlier deal id")
        seen_ids.add(deal["deal"])

    for ordinal in range(2, len(deals) + 1):
        prev, cur = deals[ordinal - 2], deals[ordinal - 1]
        implied = cur["profit"] + cur["swap"] + cur["commission"] + cur["fee"]
        if abs(cur["balance"] - prev["balance"] - implied) > BALANCE_CONTINUITY_ABS_TOL:
            raise BalanceContinuityRefused(
                f"Deals row {ordinal}: the Balance does not follow from the previous "
                "Balance and the row's profit, swap, commission and fee"
            )

    return ParsedReport(
        deals=tuple(deals),
        encoding=encoding,
        headers=names,
        fee_column_present="Fee" in names,
    )


def oracle_deals_bytes(parsed: ParsedReport) -> bytes:
    """Canonical JSON ``{"oracle_version": 1, "deals": [...]}``: the byte form the
    RED proofs mutate and ``load_oracle_deals`` reads back."""
    raw, _digest = seal_bytes(
        {"oracle_version": _ORACLE_VERSION, "deals": [dict(d) for d in parsed.deals]}
    )
    return raw


def _refuse_constant(name: str) -> Any:
    raise RowShapeRefused(f"the oracle deals carry a non-finite number ({name})")


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def load_oracle_deals(data: bytes) -> tuple[Mapping[str, Any], ...]:
    """Inverse of ``oracle_deals_bytes``; every field is validated."""
    try:
        obj = json.loads(data, parse_constant=_refuse_constant)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise RowShapeRefused("the oracle deals are not valid JSON") from None
    if not isinstance(obj, dict) or set(obj) != {"oracle_version", "deals"}:
        raise RowShapeRefused("the oracle deals file has the wrong top-level keys")
    if obj["oracle_version"] != _ORACLE_VERSION or isinstance(
        obj["oracle_version"], bool
    ):
        raise RowShapeRefused("the oracle deals file has an unsupported version")
    raw_deals = obj["deals"]
    if not isinstance(raw_deals, list):
        raise RowShapeRefused("the oracle deals are not a list")
    if not raw_deals:
        raise EmptyDeals("the oracle deals list is empty")

    deals: list[Mapping[str, Any]] = []
    for ordinal, raw in enumerate(raw_deals, start=1):
        if not isinstance(raw, dict) or set(raw) != _DEAL_KEYS:
            raise RowShapeRefused(f"oracle deal {ordinal} has the wrong keys")
        for key in ("deal", "time", "type"):
            if not _is_int(raw[key]):
                raise RowShapeRefused(f"oracle deal {ordinal}: {key} is not an integer")
        if raw["entry"] is not None and not _is_int(raw["entry"]):
            raise RowShapeRefused(f"oracle deal {ordinal}: entry is not an integer")
        if raw["position_id"] is not None or raw["time_msc"] is not None:
            raise RowShapeRefused(
                f"oracle deal {ordinal}: position_id and time_msc must be null"
            )
        deal: dict[str, Any] = {k: raw[k] for k in _DEAL_KEYS}
        for key in _MONEY_KEYS:
            value = raw[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise RowShapeRefused(f"oracle deal {ordinal}: {key} is not a number")
            if not math.isfinite(value):
                raise RowShapeRefused(f"oracle deal {ordinal}: {key} is not finite")
            deal[key] = float(value)
        deals.append(deal)
    return tuple(deals)
