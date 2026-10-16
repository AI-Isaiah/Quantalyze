"""170.1 / D-14 (WR-A): `validate_csv` NEVER RAISES for a supported fmt, and a
daylight-saving file keeps the calendar dates the user wrote.

The defect (review of 244deddcd / 5fdd4e979, finding WR-A, measured): the callers
turn any exception from `validate_csv` into CSV_UPSTREAM_FAIL, which the wizard
renders as "this is on our side, try again". Two ORDINARY files still raised, so a
user was told to retry a deterministic failure:

  1. ISO timestamps whose UTC offset changes across a daylight-saving boundary
     (`...+01:00` then `...+02:00`): `pd.to_datetime` raises `ValueError: Mixed
     timezones detected` in every format. That is a local-time broker export.
  2. Headers that collide once lower-cased and stripped (`date,Date,...`): a
     `AttributeError` at the date detector and a `TypeError` in the percent
     normaliser, because `df["date"]` is a two-column frame.

Part A pins the DST outcome (valid file, dates exactly as written, rows
unchanged). Part B pins the duplicate-header sentence. Part C is the corpus: a
hostile-input sweep, parametrized over the three formats, asserting
`validate_csv` returns an envelope and no error text carries a cell.

Every cell value is a synthetic marker (`ZXQCELL`). No real data.
"""
from __future__ import annotations

import json

import pytest

from services.csv_validator import validate_csv

MARKER = "ZXQCELL"

# The founder-approved sentence, verbatim (D-14). Hand-typed on purpose: a
# reworded producer message must fail here, and the WR-01 parity specimen is
# typed from the same sentence.
DUPLICATE_HEADER_MESSAGE = "Could not parse CSV: two columns have the same name."

HEADER = {
    "daily_returns": "date,daily_return",
    "daily_nav": "date,nav",
    "trades": "date,side,qty,price,symbol,currency",
}
# The non-date cells of a row, per format and per row ordinal.
BODY = {
    "daily_returns": ["0.01", "0.02", "0.03", "-0.01"],
    "daily_nav": ["100", "101", "102", "103"],
    "trades": [
        "buy,1,10,BTC,USD",
        "sell,1,11,BTC,USD",
        "buy,2,12,BTC,USD",
        "sell,2,13,BTC,USD",
    ],
}


def _file(fmt: str, dates: list[str]) -> bytes:
    rows = [f"{d},{BODY[fmt][i]}" for i, d in enumerate(dates)]
    return (HEADER[fmt] + "\n" + "\n".join(rows) + "\n").encode()


def _written_calendar_dates(dates: list[str]) -> list[str]:
    """The calendar date the user wrote: the first ten characters of an ISO
    timestamp, untouched by any zone arithmetic."""
    return [d[:10] for d in dates]


# ---------------------------------------------------------------------------
# Part A - a DST-crossing daily file validates, with the dates as written
# ---------------------------------------------------------------------------

# Local midnight on four consecutive days, offset +01:00 then +02:00 (Europe,
# 2024-03-31). Converted to UTC naively each timestamp lands on the PREVIOUS
# calendar day, and `...-03-31T00:00:00+02:00` is 2024-03-30 22:00Z.
EUROPE_DST_MIDNIGHT = [
    "2024-03-29T00:00:00+01:00",
    "2024-03-30T00:00:00+01:00",
    "2024-03-31T00:00:00+02:00",
    "2024-04-01T00:00:00+02:00",
]
# Late evening in the Americas (US DST starts 2024-03-10), offset -05:00 then
# -04:00. In UTC every one of these is on the NEXT calendar day, and the DST
# crossing makes a naive conversion collide or reorder dates.
US_DST_LATE_EVENING = [
    "2024-03-08T23:30:00-05:00",
    "2024-03-09T23:30:00-05:00",
    "2024-03-10T23:30:00-04:00",
    "2024-03-11T23:30:00-04:00",
]
# A trailing `Z` beside numeric offsets in the same column.
Z_AND_OFFSETS = [
    "2024-03-29T00:00:00Z",
    "2024-03-30T00:00:00+01:00",
    "2024-03-31T00:00:00+02:00",
    "2024-04-01T00:00:00Z",
]
# A space-separated timestamp with a compact offset.
SPACE_AND_COMPACT_OFFSET = [
    "2024-03-29 00:00:00+0100",
    "2024-03-30 00:00:00+0100",
    "2024-03-31 00:00:00+0200",
    "2024-04-01 00:00:00+0200",
]

DST_SPECIMENS = [
    pytest.param(EUROPE_DST_MIDNIGHT, id="europe-midnight-plus01-to-plus02"),
    pytest.param(US_DST_LATE_EVENING, id="us-late-evening-minus05-to-minus04"),
    pytest.param(Z_AND_OFFSETS, id="z-beside-numeric-offsets"),
    pytest.param(SPACE_AND_COMPACT_OFFSET, id="space-separated-compact-offsets"),
]


@pytest.mark.parametrize("fmt", list(HEADER))
@pytest.mark.parametrize("dates", DST_SPECIMENS)
def test_a_dst_crossing_file_validates_and_keeps_the_dates_the_user_wrote(
    fmt: str, dates: list[str]
) -> None:
    envelope = validate_csv(_file(fmt, dates), fmt)  # must not raise

    assert envelope["ok"] is True, envelope["errors"]
    written = _written_calendar_dates(dates)
    # Row count unchanged: no row dropped, merged or duplicated by the zone maths.
    assert envelope["preview"]["row_count"] == len(dates)
    # The range endpoints are the calendar dates the user wrote.
    assert envelope["preview"]["date_range"] == [written[0], written[-1]]
    if fmt == "daily_returns":
        assert [r["date"] for r in envelope["daily_returns_series"]] == written
    elif fmt == "daily_nav":
        # A return needs a previous NAV, so the first date has no return row.
        assert [r["date"] for r in envelope["daily_returns_series"]] == written[1:]


def test_dates_are_taken_before_any_zone_conversion_not_after() -> None:
    """The reason the calendar date is read from the wall clock and not from a
    UTC conversion: at +02:00 local midnight the UTC instant is on the previous
    day. A converter-first implementation yields 2024-03-30 for the 31st, which
    duplicates the 30th's reading and turns a valid file into a monotonic-dates
    failure."""
    dates = ["2024-03-30T00:00:00+01:00", "2024-03-31T00:00:00+02:00"]
    envelope = validate_csv(_file("daily_returns", dates), "daily_returns")

    assert envelope["ok"] is True, envelope["errors"]
    assert [r["date"] for r in envelope["daily_returns_series"]] == ["2024-03-30", "2024-03-31"]


def test_day_first_dates_with_offsets_across_dst_keep_the_dates_the_user_wrote() -> None:
    """The day-first detector (`_detect_and_normalize_date_column`) parses the
    column itself, so it needs the same mixed-offset handling as the ISO path."""
    dates = [
        "29/03/2024 10:00:00+01:00",
        "30/03/2024 10:00:00+01:00",
        "31/03/2024 10:00:00+02:00",
    ]
    envelope = validate_csv(_file("daily_returns", dates), "daily_returns")

    assert envelope["ok"] is True, envelope["errors"]
    assert [r["date"] for r in envelope["daily_returns_series"]] == [
        "2024-03-29",
        "2024-03-30",
        "2024-03-31",
    ]


def test_the_parse_backstop_does_not_raise_on_mixed_offsets_the_pattern_missed() -> None:
    """`_drop_utc_offsets` takes the wall-clock date for every spelling it
    recognises. `_parse_dates` is the backstop behind it for any spelling it does
    not: mixed offsets must come back as a series (UTC, naive), never an exception.
    Called directly because no realistic file reaches it with the pattern in place."""
    import pandas as pd

    from services.csv_validator import _parse_dates

    mixed = pd.Series(["2024-03-30T00:00:00+01:00", "2024-03-31T00:00:00+02:00", "not a date"])
    parsed = _parse_dates(mixed)  # must not raise

    assert parsed.dt.tz is None
    assert list(parsed.dropna().dt.strftime("%Y-%m-%dT%H:%M")) == [
        "2024-03-29T23:00",
        "2024-03-30T22:00",
    ]
    assert bool(parsed.isna().iloc[2])


def test_a_dst_file_with_a_genuine_date_defect_is_still_rejected() -> None:
    """The offset handling must not make a bad file pass: a repeated calendar
    date is still a `monotonic_dates` rejection."""
    dates = ["2024-03-30T00:00:00+01:00", "2024-03-30T00:00:00+01:00", "2024-03-31T00:00:00+02:00"]
    envelope = validate_csv(_file("daily_returns", dates), "daily_returns")

    assert envelope["ok"] is False
    assert "monotonic_dates" in {e["rule"] for e in envelope["errors"]}


# ---------------------------------------------------------------------------
# Part B - headers that collide once lower-cased and stripped
# ---------------------------------------------------------------------------

COLLIDING_HEADERS = [
    pytest.param("daily_returns", "date,Date,daily_return", id="date-Date"),
    pytest.param("daily_returns", "date,daily_return,Daily_Return", id="daily_return-Daily_Return"),
    pytest.param("daily_returns", "Daily_Return,date,daily_return", id="Daily_Return-first"),
    pytest.param("daily_returns", "date, date ,daily_return", id="padded-with-spaces"),
    pytest.param("daily_nav", "date,nav,NAV", id="nav-NAV"),
    pytest.param("trades", "date,side,qty,price,symbol,currency,Symbol", id="trades-symbol-Symbol"),
]


@pytest.mark.parametrize("fmt,header", COLLIDING_HEADERS)
def test_two_headers_that_collide_after_lowercasing_get_the_founder_sentence(
    fmt: str, header: str
) -> None:
    width = len(header.split(","))
    row = ",".join(["2024-01-01"] + ["1"] * (width - 1))
    raw = (header + "\n" + row + "\n" + row.replace("01-01", "01-02") + "\n").encode()

    envelope = validate_csv(raw, fmt)  # must not raise

    assert envelope["ok"] is False
    assert [(e["rule"], e["row"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", 0, DUPLICATE_HEADER_MESSAGE)
    ]
    assert envelope["preview"] is None


def test_the_duplicate_header_sentence_names_no_header_and_echoes_no_cell() -> None:
    raw = f"date,Date,daily_return\n{MARKER},{MARKER},{MARKER}\n".encode()
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["errors"][0]["message"] == DUPLICATE_HEADER_MESSAGE
    assert "date" not in envelope["errors"][0]["message"].lower().replace("same name", "")
    assert MARKER.lower() not in json.dumps(envelope, default=str).lower()


def test_a_collision_between_undeclared_columns_does_not_reject_a_good_file() -> None:
    """Control for the scope of the rule: `Notes,notes` are two columns the
    schema does not declare, `strict="filter"` drops them, and the file
    validated before the collision check existed. It must keep validating."""
    raw = b"date,daily_return,Notes,notes\n2024-01-01,0.01,a,b\n2024-01-02,0.02,a,b\n"
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["ok"] is True, envelope["errors"]


def test_pandas_own_duplicate_suffixing_is_not_mistaken_for_a_collision() -> None:
    """Control: `daily_return,daily_return` is mangled by pandas to
    `daily_return.1` and was never a collision. It must keep its existing
    outcome, not the new sentence."""
    raw = b"date,daily_return,daily_return\n2024-01-01,0.01,5\n2024-01-02,0.02,5\n"
    envelope = validate_csv(raw, "daily_returns")

    assert DUPLICATE_HEADER_MESSAGE not in {e["message"] for e in envelope["errors"]}


# ---------------------------------------------------------------------------
# Part C - the corpus: validate_csv never raises, no error text carries a cell
# ---------------------------------------------------------------------------

_HDR_COLS = {
    "daily_returns": ["date", "daily_return"],
    "daily_nav": ["date", "nav"],
    "trades": ["date", "side", "qty", "price", "symbol", "currency"],
}
_GOOD_ROWS = {
    "daily_returns": ["2024-01-01,0.01", "2024-01-02,0.02", "2024-01-03,-0.01"],
    "daily_nav": ["2024-01-01,100", "2024-01-02,101", "2024-01-03,102"],
    "trades": [
        "2024-01-01,buy,1,10,BTC,USD",
        "2024-01-02,sell,1,11,BTC,USD",
        "2024-01-03,buy,2,12,BTC,USD",
    ],
}
_STRING_COLS = ("date", "side", "symbol", "currency")


def _grid(fmt: str, edit) -> str:
    """The good file with one edit applied to its cell grid."""
    rows = [r.split(",") for r in _GOOD_ROWS[fmt]]
    edit(rows)
    return "\n".join(",".join(r) for r in rows)


def _corpus() -> list[tuple[str, str, bytes]]:
    cases: list[tuple[str, str, bytes]] = []

    def add(label: str, fmt: str, data: str | bytes) -> None:
        cases.append((label, fmt, data if isinstance(data, bytes) else data.encode()))

    for fmt, cols in _HDR_COLS.items():
        h = ",".join(cols)
        rows = _GOOD_ROWS[fmt]
        ncol = len(cols)

        def set_cell(ri: int, ci: int, value: str):
            def edit(grid):
                grid[ri][ci] = value
            return edit

        def set_col(ci: int, value: str):
            def edit(grid):
                for r in grid:
                    r[ci] = value
            return edit

        add("baseline-good", fmt, h + "\n" + "\n".join(rows) + "\n")
        for ci, col in enumerate(cols):
            if col == "date":
                continue
            for ri in range(3):
                add(f"marker-in-{col}-row{ri + 1}", fmt, h + "\n" + _grid(fmt, set_cell(ri, ci, MARKER)) + "\n")
            add(f"marker-in-{col}-allrows", fmt, h + "\n" + _grid(fmt, set_col(ci, MARKER)) + "\n")
        add("marker-in-date-row2", fmt, h + "\n" + _grid(fmt, set_cell(1, 0, MARKER)) + "\n")
        add("marker-in-date-allrows", fmt, h + "\n" + _grid(fmt, set_col(0, MARKER)) + "\n")
        add("bad-date-2024-13-45", fmt, h + "\n" + _grid(fmt, set_cell(1, 0, "2024-13-45")) + "\n")
        add("extra-field-data-row", fmt, h + "\n" + rows[0] + "\n" + rows[1] + f",{MARKER}\n" + rows[2] + "\n")
        add("extra-field-first-row", fmt, h + "\n" + rows[0] + f",{MARKER}\n" + rows[1] + "\n" + rows[2] + "\n")
        add("extra-field-all-rows", fmt, h + "\n" + "\n".join(x + f",{MARKER}" for x in rows) + "\n")
        add("extra-fields-many", fmt, h + "\n" + rows[0] + f",{MARKER},{MARKER},{MARKER}\n" + rows[1] + "\n")

        def short(x: str) -> str:
            return ",".join(x.split(",")[:-1])

        add("missing-field-data-row", fmt, h + "\n" + rows[0] + "\n" + short(rows[1]) + "\n" + rows[2] + "\n")
        add("missing-field-all-rows", fmt, h + "\n" + "\n".join(short(x) for x in rows) + "\n")
        add("one-col-only", fmt, cols[0] + "\n" + "\n".join(x.split(",")[0] for x in rows) + "\n")
        add("header-extra-field", fmt, h + f",{MARKER}\n" + "\n".join(rows) + "\n")
        add("header-extra-field-values-too", fmt, h + f",{MARKER}\n" + "\n".join(x + f",{MARKER}" for x in rows) + "\n")
        add("header-missing-field", fmt, ",".join(cols[:-1]) + "\n" + "\n".join(rows) + "\n")
        add("header-dup-columns", fmt, h + f",{cols[-1]}\n" + "\n".join(x + ",5" for x in rows) + "\n")
        add("header-marker", fmt, f"{MARKER},{MARKER}\n" + "\n".join(rows) + "\n")
        add("header-only", fmt, h + "\n")
        # Quoted newlines and an unterminated quote.
        add(
            "quoted-newline-numeric-last",
            fmt,
            h + "\n" + _grid(fmt, set_cell(1, ncol - 1, f'"{MARKER}\n{MARKER}"')) + "\n",
        )
        add("unterminated-quote", fmt, h + "\n" + rows[0] + "\n" + f'"{MARKER}' + "," + rows[1] + "\n")
        add(
            "quoted-newline-in-date",
            fmt,
            h + "\n" + f'"2024-01-01\n{MARKER}",' + ",".join(rows[0].split(",")[1:]) + "\n" + rows[1] + "\n",
        )
        # Leading blank-header row (Excel export).
        blank = "," * (ncol - 1)
        add("blank-header-row-then-good", fmt, blank + "\n" + h + "\n" + "\n".join(rows) + "\n")
        add("blank-header-row-then-marker-header", fmt, blank + "\n" + MARKER + "\n" + "\n".join(rows) + "\n")
        add("blank-header-row-only", fmt, blank + "\n")
        add("blank-header-row-then-ragged", fmt, blank + "\n" + h + "\n" + rows[0] + f",{MARKER},{MARKER}\n" + rows[1] + "\n")
        add("blank-header-then-marker-rows", fmt, blank + "\n" + h + "\n" + f"{MARKER},{MARKER}\n" + "\n")
        add("two-blank-lines-top", fmt, "\n\n" + h + "\n" + "\n".join(rows) + "\n")
        # Numeric-looking tokens in every numeric column.
        for tok in ["inf", "-inf", "nan", "NaN", "Infinity", "-Infinity", "1e999", "1e-999", "NA", "null", "1,5", "--1", "1.2.3", "0x10", "٣"]:
            for ci, col in enumerate(cols):
                if col in _STRING_COLS:
                    continue
                add(f"tok[{tok}]-in-{col}", fmt, h + "\n" + _grid(fmt, set_cell(1, ci, tok)) + "\n")
        for ci, col in enumerate(cols):
            if col in _STRING_COLS:
                continue

            def mixed(grid, ci=ci):
                grid[0][ci], grid[1][ci], grid[2][ci] = "5%", MARKER, "$1,000"

            def mixed2(grid, ci=ci):
                grid[0][ci], grid[1][ci], grid[2][ci] = "(5)", "1e3", ""

            add(f"mixed-{col}", fmt, h + "\n" + _grid(fmt, mixed) + "\n")
            add(f"mixed2-{col}", fmt, h + "\n" + _grid(fmt, mixed2) + "\n")
            add(f"empty-cells-{col}", fmt, h + "\n" + _grid(fmt, set_col(ci, "")) + "\n")
        # Byte-level shapes.
        add("non-utf8-latin1-cell", fmt, h.encode() + b"\n" + rows[0].encode() + b"\n" + rows[1].encode() + MARKER.encode() + b"\xe9\xff\n")
        add("non-utf8-header", fmt, b"\xff\xfe" + h.encode() + b"\n" + "\n".join(rows).encode() + b"\n")
        add("utf16", fmt, (h + "\n" + "\n".join(rows) + "\n").encode("utf-16"))
        add("nul-bytes", fmt, h.encode() + b"\n" + rows[0].encode() + b"\x00\n" + rows[1].encode() + b"\n")
        add("only-garbage-bytes", fmt, b"\xff\xfe\xfd\xfc")
        add("binary-blob", fmt, bytes(range(256)) * 4)
        add("whitespace-only", fmt, b"   \n  \n")
        add("newline-only", fmt, b"\n")
        add("marker-only", fmt, MARKER.encode())
        add("bom-only", fmt, b"\xef\xbb\xbf")
        add("one-row", fmt, h + "\n" + rows[0] + "\n")
        add("dup-dates", fmt, h + "\n" + rows[0] + "\n" + rows[0] + "\n" + rows[1] + "\n")
        add("undeclared-col-marker", fmt, h + ",extra\n" + "\n".join(x + f",{MARKER}" for x in rows) + "\n")
        # D-14 specimens: the two ordinary shapes that raised before.
        add("dst-offsets-iso", fmt, _file(fmt, EUROPE_DST_MIDNIGHT))
        add("dst-offsets-marker-cell", fmt, _file(fmt, EUROPE_DST_MIDNIGHT[:2] + [f"{MARKER}+02:00"]))
        add("mixed-offsets-and-naive", fmt, _file(fmt, ["2024-03-29T00:00:00", "2024-03-30T00:00:00+01:00", "2024-03-31T00:00:00Z"]))
        add("offset-garbage", fmt, _file(fmt, ["2024-03-29T00:00:00+99:99", "2024-03-30T00:00:00+01:00", "2024-03-31T00:00:00+zz"]))
        add("header-case-collision-date", fmt, h.replace("date", "date,Date", 1) + "\n" + "\n".join(x.replace(",", ",x,", 1) for x in rows) + "\n")
        add("header-case-collision-last", fmt, h + f",{cols[-1].upper()}\n" + "\n".join(x + ",5" for x in rows) + "\n")
        add("header-case-collision-marker", fmt, f"{MARKER},{MARKER.lower()}\n" + "\n".join(rows) + "\n")

    # Format-specific shapes.
    add("dr-all-marker-single", "daily_returns", f"date,daily_return\n2024-01-01,{MARKER}\n2024-01-02,{MARKER}\n")
    add("dr-marker-then-dayfirst-dates", "daily_returns", f"date,daily_return\n13/02/2024,0.01\n14/02/2024,{MARKER}\n15/02/2024,0.02\n")
    add("dr-ambiguous-dates-and-marker", "daily_returns", f"date,daily_return\n01/02/2024,0.01\n02/02/2024,{MARKER}\n03/02/2024,0.02\n")
    add("dr-bool-cells", "daily_returns", "date,daily_return\n2024-01-01,True\n2024-01-02,False\n2024-01-03,True\n")
    add("dr-huge-int", "daily_returns", "date,daily_return\n2024-01-01,99999999999999999999999\n2024-01-02,1\n2024-01-03,2\n")
    add("dr-date-as-number", "daily_returns", "date,daily_return\n20240101,0.01\n20240102,0.02\n20240103,0.03\n")
    add("dr-currency-marker", "daily_returns", f"date,daily_return,currency\n2024-01-01,0.01,{MARKER}\n2024-01-02,0.02,{MARKER}\n2024-01-03,-0.01,{MARKER}\n")
    add("dr-currency-numeric", "daily_returns", "date,daily_return,currency\n2024-01-01,0.01,1\n2024-01-02,0.02,2\n2024-01-03,-0.01,3\n")
    add("dr-currency-empty-col", "daily_returns", "date,daily_return,currency\n2024-01-01,0.01,\n2024-01-02,0.02,\n2024-01-03,-0.01,\n")
    add("trades-side-numeric", "trades", "date,side,qty,price,symbol,currency\n2024-01-01,1,1,10,2,USD\n2024-01-02,2,1,11,3,USD\n")
    add("trades-qty-neg-marker-sym", "trades", f"date,side,qty,price,symbol,currency\n2024-01-01,{MARKER},-1,10,{MARKER},{MARKER}\n2024-01-02,{MARKER},-1,11,{MARKER},{MARKER}\n")
    add("nav-zero-marker", "daily_nav", f"date,nav\n2024-01-01,0\n2024-01-02,{MARKER}\n2024-01-03,0\n")
    add("nav-all-zero", "daily_nav", "date,nav\n2024-01-01,0\n2024-01-02,0\n2024-01-03,0\n")
    add("nav-negative", "daily_nav", "date,nav\n2024-01-01,-1\n2024-01-02,-2\n2024-01-03,-3\n")
    add("nav-marker-first-row", "daily_nav", f"date,nav\n2024-01-01,{MARKER}\n2024-01-02,101\n")
    add("dr-two-markers-one-good", "daily_returns", f"date,daily_return\n2024-01-01,{MARKER}\n2024-01-02,{MARKER}\n2024-01-03,0.02\n")
    add("dr-marker-dates-all-same", "daily_returns", f"date,daily_return\n2024-01-01,0.01\n2024-01-01,{MARKER}\n2024-01-01,0.02\n")
    return cases


CORPUS = _corpus()


def _error_surface(envelope: dict) -> str:
    """Everything the user or an operator can read about a rejection. `preview`
    is excluded: it is the first/last rows of the user's own upload, declared
    columns only, which is the preview feature working as designed."""
    surface = {k: envelope.get(k) for k in ("errors", "info_flags", "correlation_id")}
    return json.dumps(surface, default=str)


def test_the_corpus_is_the_size_it_was_measured_at() -> None:
    """The sweep is only a guard if it keeps covering the shapes it was built
    from. A silent shrink (a shape deleted, a format dropped) would still pass
    every parametrized case, so the count is pinned: 3 formats x the shared
    shapes, plus the format-specific ones."""
    assert len(CORPUS) >= 237, len(CORPUS)
    assert {fmt for _, fmt, _ in CORPUS} == set(HEADER)


@pytest.mark.parametrize(
    "label,fmt,raw", [pytest.param(label, fmt, raw, id=f"{fmt}-{label}") for label, fmt, raw in CORPUS]
)
def test_validate_csv_never_raises_and_no_error_text_carries_a_cell(
    label: str, fmt: str, raw: bytes, caplog: pytest.LogCaptureFixture
) -> None:
    import logging

    with caplog.at_level(logging.DEBUG):
        envelope = validate_csv(raw, fmt)  # the contract: an envelope, never an exception

    assert isinstance(envelope, dict) and "ok" in envelope and "errors" in envelope
    if envelope["ok"] is False:
        assert envelope["errors"], "a rejected file must say why"
    # Case-insensitive: header lower-casing must not hide a leak.
    assert MARKER.lower() not in _error_surface(envelope).lower()
    assert MARKER.lower() not in caplog.text.lower()
