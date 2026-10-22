"""OKX quarterly ``bills-history-archive`` file reader (Phase 167.1.2.2.2.1, plan 02).

Pure module: stdlib only, no network, no file or database I/O, no coupling to any
I/O ``services.*`` module. It turns the bytes of ONE decompressed archive CSV into
typed rows, and refuses (with a named, permanent stop class) every file it cannot
read exactly.

Why this module is strict (CONTEXT D-09 / D-10): the archive has no checksum, so the
only content authentication is (a) this parser's structural pins and (b) the
reconciliation against the live endpoints. A wrong header, a wrong quarter, an
unparseable amount or a conflicting duplicate bill must therefore stop the run LOUD
with a class name, never be tolerated and never surface a figure.

Stop classes raised here (``ArchiveParseError.stop_class``):

* ``undecodable_file``       - bytes are not UTF-8
* ``malformed_csv``          - the csv layer rejected the file
* ``header_drift``           - header is not the pinned 28 columns (the documented-
                               absent ``type`` column is the one accepted variant)
* ``malformed_row``          - a row whose cell count differs from the header
* ``unparseable_ts``         - ``ts`` is not digits-only epoch milliseconds
* ``empty_file``             - header only, so no row can authenticate the quarter
* ``quarter_range_mismatch`` - a ``ts`` lies outside the requested quarter's
                               half-open UTC calendar range
* ``missing_bill_id``        - a row without a ``billId`` (dedup and conflict
                               detection are impossible)
* ``duplicate_bill_conflict``- one ``billId`` carried with different content
* ``unparseable_amount``     - a money field that is not a finite plain decimal

(``okx_archive_classify.verify_bal_chain`` adds ``archive_incomplete``: files whose running
``bal`` does not chain, within a file or across the seam of adjacent quarters, are missing rows,
and a currency with money on it but too few chained pairs cannot be proven complete. It lives
there because it reads the typed rows.)

``ArchiveParseError.detail`` carries dates, labels, counts and line numbers ONLY.
Never an amount, a billId or a raw cell value (the account-size leak class).

Quarter labels: OKX documents "2024 Q2" as [2024-07-01, 2024-10-01), which contradicts
the plain calendar reading. The code does NOT remap. It asserts the plain reading
(Q1 January-March ... Q4 October-December) against every file's ``ts`` values and
stops when they disagree, naming the requested label and the observed UTC dates.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Final, Mapping

ARCHIVE_HEADER: Final[tuple[str, ...]] = (
    "instType",
    "billId",
    "subType",
    "ts",
    "balChg",
    "posBalChg",
    "bal",
    "posBal",
    "sz",
    "px",
    "ccy",
    "pnl",
    "fee",
    "mgnMode",
    "instId",
    "ordId",
    "execType",
    "interest",
    "tag",
    "fillTime",
    "tradeId",
    "clOrdId",
    "fillIdxPx",
    "fillMarkPx",
    "fillPxVol",
    "fillPxUsd",
    "fillMarkVol",
    "fillFwdPx",
)

# The JSON endpoints list ``type`` beside ``subType``; the docs' CSV field list omits
# it. A file that carries it is accepted (once, anywhere) as long as the remaining
# columns equal ARCHIVE_HEADER exactly and in order; the value is then cross-checked
# against the live subtype map by ``okx_archive_classify.aggregate_archive``.
_TYPE_COLUMN: Final[str] = "type"

_QUARTER_FIRST_MONTH: Final[Mapping[str, int]] = {"Q1": 1, "Q2": 4, "Q3": 7, "Q4": 10}
_MS_PER_DAY: Final[int] = 86_400_000
_EPOCH: Final[date] = date(1970, 1, 1)

# Bound untrusted money strings (mirror of exchange._finite_decimal): a real amount
# is short and of sane magnitude. Two-sided on the adjusted exponent.
_MONETARY_STR_MAXLEN: Final[int] = 48
_MONETARY_MAX_ADJUSTED: Final[int] = 30
_PLAIN_DECIMAL_RE: Final[re.Pattern[str]] = re.compile(r"-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?")

# Header names come from an untrusted file; cap what an error detail may echo.
_DETAIL_NAME_MAXLEN: Final[int] = 40
_DETAIL_NAME_MAXCOUNT: Final[int] = 40


class ArchiveParseError(Exception):
    """A permanent, named stop. ``detail`` holds dates, labels and counts only."""

    def __init__(self, stop_class: str, detail: Mapping[str, Any] | None = None) -> None:
        self.stop_class: str = stop_class
        self.detail: dict[str, Any] = dict(detail or {})
        super().__init__(f"{stop_class}: {self.detail}")


@dataclass(frozen=True)
class ArchiveRow:
    """One archive bill. Money fields are exact ``Decimal`` parsed from the CSV text."""

    bill_id: str
    sub_type: str
    type_raw: str | None
    ts_ms: int
    day: str
    inst_type: str
    ccy: str
    pnl: Decimal
    fee: Decimal
    bal_chg: Decimal
    bal: Decimal


@dataclass(frozen=True)
class ArchiveFile:
    """A verified quarter file: every ``ts`` lies inside the requested quarter."""

    rows: tuple[ArchiveRow, ...]
    has_type_column: bool
    ts_min_day: str
    ts_max_day: str
    row_count: int
    covered_days: frozenset[str]
    duplicate_rows_dropped: int = 0


def quarter_bounds(year: int, quarter: str) -> tuple[date, date]:
    """Half-open ``[start, end)`` calendar range of a quarter (plain reading)."""
    first_month = _QUARTER_FIRST_MONTH.get(quarter)
    if first_month is None:
        raise ValueError(f"unknown quarter label {quarter!r}; expected one of Q1..Q4")
    start = date(year, first_month, 1)
    end = date(year + 1, 1, 1) if first_month == 10 else date(year, first_month + 3, 1)
    return start, end


def longest_billless_run(file: ArchiveFile) -> dict[str, Any]:
    """The longest run of consecutive covered days on which the file carries NO bill at all.

    Counts and dates only. A quarter file is read as the complete ledger of its quarter, so a
    bill-less day becomes an explicit zero; this reading puts the longest such stretch next to
    ``ts_min_day`` / ``ts_max_day`` so a file with a missing head or tail shows as one long
    quiet run. The earliest run wins a tie. ``{"days": 0, "from": None, "to": None}`` when
    every covered day has a bill."""
    billed = {row.day for row in file.rows}
    best_len, best_from, best_to = 0, None, None
    run: list[str] = []
    for day in sorted(file.covered_days):
        if day in billed:
            run = []
            continue
        run.append(day)
        if len(run) > best_len:
            best_len, best_from, best_to = len(run), run[0], run[-1]
    return {"days": best_len, "from": best_from, "to": best_to}


def _day_number(day: date) -> int:
    return (day - _EPOCH).days


def _ms_to_day(ts_ms: int) -> str:
    """UTC calendar day of an epoch-millisecond timestamp, in integer arithmetic."""
    return (_EPOCH + timedelta(days=ts_ms // _MS_PER_DAY)).isoformat()


def _clip(names: list[str]) -> list[str]:
    return [n[:_DETAIL_NAME_MAXLEN] for n in names[:_DETAIL_NAME_MAXCOUNT]]


def _check_header(header: list[str]) -> bool:
    """Return ``has_type_column``; raise ``header_drift`` for any other header."""
    if tuple(header) == ARCHIVE_HEADER:
        return False
    if header.count(_TYPE_COLUMN) == 1 and tuple(c for c in header if c != _TYPE_COLUMN) == ARCHIVE_HEADER:
        return True
    pinned = set(ARCHIVE_HEADER)
    seen = set(header)
    raise ArchiveParseError(
        "header_drift",
        {
            "column_count": len(header),
            "missing": _clip([c for c in ARCHIVE_HEADER if c not in seen]),
            "unexpected": _clip([c for c in header if c not in pinned]),
            "order_changed": seen == pinned and len(header) == len(ARCHIVE_HEADER),
        },
    )


def _parse_amount(text: str, *, field: str, line: int) -> Decimal:
    """Exact, finite, bounded ``Decimal`` from a plain decimal string, else a stop."""
    if len(text) <= _MONETARY_STR_MAXLEN and _PLAIN_DECIMAL_RE.fullmatch(text):
        try:
            value = Decimal(text)
        except InvalidOperation:
            pass
        else:
            if value.is_finite() and (value == 0 or abs(value.adjusted()) <= _MONETARY_MAX_ADJUSTED):
                return value
    raise ArchiveParseError("unparseable_amount", {"field": field, "line": line})


def parse_archive_csv(data: bytes, *, year: int, quarter: str) -> ArchiveFile:
    """Parse one decompressed archive CSV for the requested quarter, or stop loud."""
    start, end_excl = quarter_bounds(year, quarter)
    label = f"{year} {quarter}"
    start_ms = _day_number(start) * _MS_PER_DAY
    end_ms = _day_number(end_excl) * _MS_PER_DAY

    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ArchiveParseError("undecodable_file", {"byte_length": len(data)}) from None

    raw_rows: list[tuple[int, dict[str, str], tuple[str, ...], int]] = []
    try:
        reader = csv.reader(io.StringIO(text, newline=""))
        header = next(reader, [])
        has_type = _check_header(header)
        for cells in reader:
            if not cells:
                continue  # a blank line carries no bill
            line = reader.line_num
            if len(cells) != len(header):
                raise ArchiveParseError(
                    "malformed_row", {"line": line, "expected_cells": len(header), "got_cells": len(cells)}
                )
            row = dict(zip(header, cells))
            ts_text = row["ts"]
            if not (ts_text.isascii() and ts_text.isdigit()) or len(ts_text) > 16:
                raise ArchiveParseError("unparseable_ts", {"line": line})
            raw_rows.append((line, row, tuple(cells), int(ts_text)))
    except csv.Error:
        raise ArchiveParseError("malformed_csv", {"byte_length": len(data)}) from None

    if not raw_rows:
        raise ArchiveParseError("empty_file", {"requested": label})

    ts_values = [r[3] for r in raw_rows]
    ts_min, ts_max = min(ts_values), max(ts_values)
    if ts_min < start_ms or ts_max >= end_ms:
        try:
            observed_min_day: str | None = _ms_to_day(ts_min)
            observed_max_day: str | None = _ms_to_day(ts_max)
        except OverflowError:  # a ts past the year 9999 (a microsecond-unit file) has no day
            observed_min_day = observed_max_day = None
        raise ArchiveParseError(
            "quarter_range_mismatch",
            {
                "requested": label,
                "range_start": start.isoformat(),
                "range_end_exclusive": end_excl.isoformat(),
                "observed_min_day": observed_min_day,
                "observed_max_day": observed_max_day,
                "rows_outside": sum(1 for t in ts_values if t < start_ms or t >= end_ms),
            },
        )

    seen: dict[str, tuple[str, ...]] = {}
    rows: list[ArchiveRow] = []
    dropped = 0
    for line, row, cell_tuple, ts_ms in raw_rows:
        bill_id = row["billId"]
        if not bill_id:
            raise ArchiveParseError("missing_bill_id", {"line": line})
        earlier = seen.get(bill_id)
        if earlier is not None:
            if earlier == cell_tuple:
                dropped += 1
                continue
            raise ArchiveParseError("duplicate_bill_conflict", {"line": line})
        seen[bill_id] = cell_tuple
        rows.append(
            ArchiveRow(
                bill_id=bill_id,
                sub_type=row["subType"],
                type_raw=row[_TYPE_COLUMN] if has_type else None,
                ts_ms=ts_ms,
                day=_ms_to_day(ts_ms),
                inst_type=row["instType"],
                ccy=row["ccy"],
                pnl=_parse_amount(row["pnl"], field="pnl", line=line),
                fee=_parse_amount(row["fee"], field="fee", line=line),
                bal_chg=_parse_amount(row["balChg"], field="balChg", line=line),
                bal=_parse_amount(row["bal"], field="bal", line=line),
            )
        )

    covered = frozenset((start + timedelta(days=i)).isoformat() for i in range((end_excl - start).days))
    return ArchiveFile(
        rows=tuple(rows),
        has_type_column=has_type,
        ts_min_day=_ms_to_day(ts_min),
        ts_max_day=_ms_to_day(ts_max),
        row_count=len(rows),
        covered_days=covered,
        duplicate_rows_dropped=dropped,
    )
