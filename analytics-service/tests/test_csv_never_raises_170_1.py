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

D-14 amendment (founder, 2026-10-16, "One more round"): offsets are handled per
format and a zone we cannot read fails closed. Part A pins the daily formats (the
wall clock, so the calendar date written is the date stored). Part A1 pins
`trades` (each timestamp is an instant, the reading the worker's
`coerce_to_aware_utc` gives). Part A2 pins the rejection of a zone the strip does
not recognise, as a date error at the real row; nothing converts a date silently.
Part B pins the duplicate-header sentence, for a case or padding collision and
for an exact repeat of a header the schema declares (an undeclared pair stays
accepted). Part C is the corpus: a hostile-input sweep, parametrized over the
three formats, asserting `validate_csv` returns an envelope and no error text
carries a cell.

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


DAILY_FORMATS = ["daily_returns", "daily_nav"]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
@pytest.mark.parametrize("dates", DST_SPECIMENS)
def test_a_dst_crossing_file_validates_and_keeps_the_dates_the_user_wrote(
    fmt: str, dates: list[str]
) -> None:
    """The two DAILY formats read the wall clock: the calendar date written is the
    date stored. `trades` is the other reading (an instant), pinned further down."""
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


def test_the_parse_backstop_never_converts_a_zone_it_is_handed() -> None:
    """D-14 amendment (founder, 2026-10-16): "`utc=True` never converts a date
    silently". `_normalise_date_zones` strips or rejects every zone before any parse, so no
    accepted file reaches `_parse_dates` with a zone on it. If one ever did, the
    parser must fail CLOSED: every value NaT, so pandera reports a date error at
    each row. It must neither raise (the callers turn a raise into "try again")
    nor return a shifted calendar. Mixed offsets used to come back converted to
    UTC (`2024-03-29T23:00`), which is the silent move this test now forbids."""
    import pandas as pd

    from services.csv_validator import _parse_dates

    mixed = pd.Series(["2024-03-30T00:00:00+01:00", "2024-03-31T00:00:00+02:00", "not a date"])
    single = pd.Series(["2024-03-30T00:00:00+01:00", "2024-03-31T00:00:00+01:00"])

    for zoned in (mixed, single):
        parsed = _parse_dates(zoned)  # must not raise
        assert parsed.dt.tz is None
        assert bool(parsed.isna().all()), list(parsed)

    # Naive input is untouched by the guard.
    naive = _parse_dates(pd.Series(["2024-03-30T00:00:00", "2024-03-31T12:30:00"]))
    assert list(naive.dt.strftime("%Y-%m-%dT%H:%M")) == ["2024-03-30T00:00", "2024-03-31T12:30"]


def test_a_dst_file_with_a_genuine_date_defect_is_still_rejected() -> None:
    """The offset handling must not make a bad file pass: a repeated calendar
    date is still a `monotonic_dates` rejection."""
    dates = ["2024-03-30T00:00:00+01:00", "2024-03-30T00:00:00+01:00", "2024-03-31T00:00:00+02:00"]
    envelope = validate_csv(_file("daily_returns", dates), "daily_returns")

    assert envelope["ok"] is False
    assert "monotonic_dates" in {e["rule"] for e in envelope["errors"]}


# ---------------------------------------------------------------------------
# Part A1 - a `trades` file is read as INSTANTS (D-14 amendment, review D14-M1)
# ---------------------------------------------------------------------------
#
# A trade timestamp is a moment, and the worker reads it as one:
# `services/ingestion/_timestamps.py` `coerce_to_aware_utc` keeps the offset. So
# the validator converts each trades timestamp to a UTC-naive instant, and the
# oracle in these tests IS the worker's function. (The daily formats take the
# wall clock instead, because there the calendar date the user wrote is what is
# stored; see Part A.)


def _worker_instant(text: str):
    """The instant the WORKER reads for `text`, as a UTC-naive Timestamp."""
    from datetime import timezone

    import pandas as pd

    from services.ingestion._timestamps import coerce_to_aware_utc

    return pd.Timestamp(coerce_to_aware_utc(text, "csv").astimezone(timezone.utc).replace(tzinfo=None))


def _validated_instants(envelope: dict) -> list:
    """The `date` values the validator kept for the first and last rows."""
    import pandas as pd

    rows = envelope["preview"]["first_rows"]
    return [pd.Timestamp(r["date"]) for r in rows] + [pd.Timestamp(envelope["preview"]["last_rows"][-1]["date"])]


# US fall-back, 2024-11-03: the wall clock repeats the 01:00 hour, the instants
# do not. In UTC this file is 04:30Z, 05:45Z, 06:10Z, 08:00Z: strictly increasing.
FALL_BACK_TRADES = [
    "2024-11-03T00:30:00-04:00",
    "2024-11-03T01:45:00-04:00",
    "2024-11-03T01:10:00-05:00",
    "2024-11-03T03:00:00-05:00",
]


def test_a_trades_file_that_crosses_a_dst_fall_back_validates() -> None:
    """The review's specimen. Stripped to the wall clock this file reads
    00:30, 01:45, 01:10, 03:00 and was rejected as "dates must be strictly
    increasing", telling the user their correct timestamps were out of order."""
    envelope = validate_csv(_file("trades", FALL_BACK_TRADES), "trades")

    assert envelope["ok"] is True, envelope["errors"]
    assert envelope["preview"]["row_count"] == 4
    assert _validated_instants(envelope) == [_worker_instant(d) for d in FALL_BACK_TRADES[:3]] + [
        _worker_instant(FALL_BACK_TRADES[-1])
    ]
    # And those instants really are what the review computed.
    assert [str(i.time()) for i in _validated_instants(envelope)] == [
        "04:30:00", "05:45:00", "06:10:00", "08:00:00",
    ]
    assert envelope["preview"]["date_range"] == ["2024-11-03", "2024-11-03"]


def test_two_trades_at_one_wall_clock_in_the_repeated_hour_are_two_instants() -> None:
    dates = ["2024-11-03T01:30:00-04:00", "2024-11-03T01:30:00-05:00"]
    envelope = validate_csv(_file("trades", dates), "trades")

    assert envelope["ok"] is True, envelope["errors"]


def test_two_trades_at_one_instant_are_still_a_duplicate() -> None:
    """The conversion must not make a bad file pass: `01:00+01:00` and `00:00Z`
    are the same moment."""
    dates = ["2024-03-31T01:00:00+01:00", "2024-03-31T00:00:00Z"]
    envelope = validate_csv(_file("trades", dates), "trades")

    assert envelope["ok"] is False
    assert "monotonic_dates" in {e["rule"] for e in envelope["errors"]}


@pytest.mark.parametrize("dates", DST_SPECIMENS)
def test_a_trades_file_reads_each_timestamp_as_the_instant_the_worker_reads(
    dates: list[str],
) -> None:
    envelope = validate_csv(_file("trades", dates), "trades")

    assert envelope["ok"] is True, envelope["errors"]
    assert _validated_instants(envelope) == [_worker_instant(d) for d in dates[:3]] + [
        _worker_instant(dates[-1])
    ]
    assert envelope["preview"]["date_range"] == [
        str(_worker_instant(dates[0]).date()),
        str(_worker_instant(dates[-1]).date()),
    ]


def test_a_trades_late_evening_offset_lands_on_the_next_utc_day() -> None:
    """The reason `trades` and the daily formats differ: 23:30-05:00 is 04:30Z on
    the NEXT day. A trade is that instant; a daily value is the day written."""
    dates = ["2024-03-08T23:30:00-05:00", "2024-03-09T23:30:00-05:00"]
    trades = validate_csv(_file("trades", dates), "trades")
    daily = validate_csv(_file("daily_returns", dates), "daily_returns")

    assert trades["preview"]["date_range"] == ["2024-03-09", "2024-03-10"]
    assert daily["preview"]["date_range"] == ["2024-03-08", "2024-03-09"]


def test_a_trades_day_first_timestamp_with_an_offset_is_converted_after_the_day_first_reading() -> None:
    """The day/month reading is deduced from the whole column, so the offset is
    applied to the PARSED value, not to the text."""
    dates = [
        "13/01/2024 10:00:00 +01:00",
        "14/01/2024 10:00:00 +01:00",
        "15/01/2024 00:30:00 +02:00",
    ]
    envelope = validate_csv(_file("trades", dates), "trades")

    assert envelope["ok"] is True, envelope["errors"]
    import pandas as pd

    firsts = [pd.Timestamp(r["date"]) for r in envelope["preview"]["first_rows"]]
    assert firsts == [
        pd.Timestamp("2024-01-13 09:00"),
        pd.Timestamp("2024-01-14 09:00"),
        pd.Timestamp("2024-01-14 22:30"),
    ]


def test_a_naive_trades_timestamp_is_read_as_utc_like_the_worker_reads_it() -> None:
    dates = ["2024-03-30T09:00:00", "2024-03-30T11:00:00+01:00", "2024-03-30T11:00:00Z"]
    envelope = validate_csv(_file("trades", dates), "trades")

    import pandas as pd

    assert envelope["ok"] is True, envelope["errors"]
    assert [pd.Timestamp(r["date"]) for r in envelope["preview"]["first_rows"]] == [
        pd.Timestamp("2024-03-30 09:00"),
        pd.Timestamp("2024-03-30 10:00"),
        pd.Timestamp("2024-03-30 11:00"),
    ]
    assert pd.Timestamp("2024-03-30 09:00") == _worker_instant("2024-03-30T09:00:00")


# ---------------------------------------------------------------------------
# Part A2 - a zone that survives the strip is a date error, never a shifted date
# (D-14 amendment, review finding D14-M2 / F1)
# ---------------------------------------------------------------------------

COERCE_RULE_PREFIX = "coerce_dtype("

# Each specimen is a file the validator must REJECT. Before this round every one
# came back `ok: True` with the calendar moved by a day (dateutil reads `GMT+1`
# as UTC-1, a single-digit hour as a zone, and a trailing `(CET)` defeated the
# strip's `$` anchor so the `utc=True` backstop converted the value).
ZONE_REJECTED = [
    pytest.param(
        ["2024-03-29T00:00:00+2", "2024-03-30T00:00:00+2", "2024-03-31T00:00:00+2"],
        id="single-digit-hour-offset",
    ),
    pytest.param(
        ["2024-03-29 00:00+2:00", "2024-03-30 00:00+2:00", "2024-03-31 00:00+2:00"],
        id="single-digit-hour-with-minutes",
    ),
    pytest.param(
        ["2024-03-29 23:00 GMT+1", "2024-03-30 23:00 GMT+1", "2024-03-31 23:00 GMT+1"],
        id="gmt-plus-1",
    ),
    pytest.param(
        ["2024-03-29 23:00 GMT+1", "2024-03-30 23:00 GMT+1", "2024-03-31 23:00 GMT+2", "2024-04-01 23:00 GMT+2"],
        id="gmt-plus-1-then-plus-2",
    ),
    pytest.param(
        ["2024-03-29 23:00 GMT+02:00", "2024-03-30 23:00 GMT+02:00", "2024-03-31 23:00 GMT+02:00"],
        id="gmt-plus-two-digit-colon",
    ),
    pytest.param(
        [
            "13/01/2024 00:00 +01:00 (CET)",
            "14/01/2024 00:00 +01:00 (CET)",
            "15/01/2024 00:00 +01:00 (CET)",
            "16/01/2024 00:00 +01:00 (CET)",
        ],
        id="offset-then-parenthesised-name",
    ),
    pytest.param(
        [
            "29/03/2024 00:00 +01:00 (CET)",
            "30/03/2024 00:00 +01:00 (CET)",
            "31/03/2024 00:00 +02:00 (CEST)",
            "01/04/2024 00:00 +02:00 (CEST)",
        ],
        id="cet-then-cest-mixed",
    ),
]


@pytest.mark.parametrize("fmt", list(HEADER))
@pytest.mark.parametrize("dates", ZONE_REJECTED)
def test_a_zone_the_strip_does_not_recognise_is_rejected_not_shifted(
    fmt: str, dates: list[str]
) -> None:
    envelope = validate_csv(_file(fmt, dates), fmt)  # must not raise

    assert envelope["ok"] is False, envelope
    # No series is ever emitted for a rejected file, shifted or otherwise.
    assert "daily_returns_series" not in envelope
    # The existing date rule, on the date column, at the real 1-based rows.
    coerce_rows = sorted(
        e["row"] for e in envelope["errors"] if e["rule"].startswith(COERCE_RULE_PREFIX)
    )
    assert coerce_rows == list(range(1, len(dates) + 1)), envelope["errors"]
    assert all(
        e["column"] == "date" for e in envelope["errors"] if e["rule"].startswith(COERCE_RULE_PREFIX)
    )


@pytest.mark.parametrize("fmt", list(HEADER))
def test_only_the_row_with_the_unsupported_zone_is_reported_and_at_its_real_row(fmt: str) -> None:
    """Three rows are in a recognised spelling, row 3 is not. The error names row
    3, not row 1 and not a row index of the stripped frame."""
    dates = [
        "2024-03-28T00:00:00+02:00",
        "2024-03-29T00:00:00+02:00",
        "2024-03-30T00:00:00+2",
        "2024-03-31T00:00:00+02:00",
    ]
    envelope = validate_csv(_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    coerce = [e for e in envelope["errors"] if e["rule"].startswith(COERCE_RULE_PREFIX)]
    assert [e["row"] for e in coerce] == [3], envelope["errors"]
    # The message is the existing pandera sentence: no cell, no zone text.
    assert "+2" not in json.dumps(envelope["errors"])


@pytest.mark.parametrize("fmt", list(HEADER))
@pytest.mark.parametrize(
    "dates,bad_row",
    [
        pytest.param(
            [
                "13/01/2024 00:00:00 +01:00",
                "14/01/2024 00:00:00 +01:00",
                "15/01/2024 00:00:00 +01:00 (CET)",
                "16/01/2024 00:00:00 +01:00",
            ],
            3,
            id="day-first-name-after-offset",
        ),
        pytest.param(
            [
                "29/03/2024 00:00:00 +01:00",
                "30/03/2024 00:00:00 +01:00",
                "31/03/2024 00:00:00 GMT+2",
                "01/04/2024 00:00:00 +02:00",
            ],
            3,
            id="day-first-gmt-plus-2",
        ),
    ],
)
def test_a_bad_zone_in_a_day_first_file_is_the_same_date_error_at_its_real_row(
    fmt: str, dates: list[str], bad_row: int
) -> None:
    """The day/month detector rewrites the date column when its dates parse. A
    cell it cannot read must not come out as a NaT (`not_nullable`, "A required
    value is blank"): it is the same `coerce_dtype` date error as in an ISO file,
    at the same real row."""
    envelope = validate_csv(_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    assert {e["row"] for e in envelope["errors"] if e["rule"].startswith(COERCE_RULE_PREFIX)} == {bad_row}
    assert "not_nullable" not in {e["rule"] for e in envelope["errors"]}
    assert "0000-00-00" not in json.dumps(envelope, default=str)


# Review SFH-R2 (D-14 final round). A NAMED zone the validator does not read
# (`EST`, `CET`, ...) beside recognised offsets, in a DAY-FIRST column. pandas
# reads such a value as NaT under every reading, so the zone check never saw it,
# the day/month detector rewrote the column, and the unreadable cell became a
# blank: `not_nullable` ("A required value is blank") instead of the
# `coerce_dtype` ("A value is not a valid date or number") the D-14 amendment
# requires. The same cell in an ISO column was already `coerce_dtype`.
DAY_FIRST_NAMED_ZONE = [
    "13/01/2024 10:00 +01:00",
    "14/01/2024 10:00 +01:00",
    "15/01/2024 10:00 EST",
    "16/01/2024 10:00 +01:00",
]
ISO_NAMED_ZONE = [
    "2024-01-13 10:00 +01:00",
    "2024-01-14 10:00 +01:00",
    "2024-01-15 10:00 EST",
    "2024-01-16 10:00 +01:00",
]


def _date_errors(envelope: dict) -> list[tuple[str, int, str, str]]:
    return [
        (e["rule"], e["row"], e["message"], e["column"])
        for e in envelope["errors"]
        if e["rule"].startswith(COERCE_RULE_PREFIX)
    ]


@pytest.mark.parametrize("fmt", list(HEADER))
@pytest.mark.parametrize(
    "dates,bad_row",
    [
        pytest.param(DAY_FIRST_NAMED_ZONE, 3, id="day-first-est-in-the-middle"),
        pytest.param(
            ["13/01/2024 10:00 EST", "14/01/2024 10:00 +01:00", "15/01/2024 10:00 +01:00", "16/01/2024 10:00 +01:00"],
            1,
            id="day-first-est-first",
        ),
        pytest.param(
            ["13/01/2024 10:00 +01:00", "14/01/2024 10:00 +01:00", "15/01/2024 10:00 +01:00", "16/01/2024 10:00 CEST"],
            4,
            id="day-first-cest-last",
        ),
    ],
)
def test_a_named_zone_in_a_day_first_file_is_a_date_error_not_a_blank(
    fmt: str, dates: list[str], bad_row: int
) -> None:
    envelope = validate_csv(_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    assert {row for _, row, _, _ in _date_errors(envelope)} == {bad_row}, envelope["errors"]
    assert "not_nullable" not in {e["rule"] for e in envelope["errors"]}, envelope["errors"]
    assert "0000-00-00" not in json.dumps(envelope, default=str)


@pytest.mark.parametrize("fmt", list(HEADER))
def test_the_day_first_named_zone_error_has_the_shape_the_iso_file_gets(fmt: str) -> None:
    """Rule string, row, message and column are what pandera emits for the same
    cell in an ISO column: the day-first file must not read differently."""
    day_first = validate_csv(_file(fmt, DAY_FIRST_NAMED_ZONE), fmt)
    iso = validate_csv(_file(fmt, ISO_NAMED_ZONE), fmt)

    assert day_first["ok"] is False and iso["ok"] is False
    assert _date_errors(iso), iso["errors"]  # the ISO path still gives coerce_dtype
    assert _date_errors(day_first) == _date_errors(iso)


def test_the_repro_from_the_review_gives_coerce_dtype_at_row_3() -> None:
    """Five rows, `daily_returns`, one `EST` among `+01:00` rows (SFH-R2)."""
    dates = [
        "13/01/2024 10:00 +01:00",
        "14/01/2024 10:00 +01:00",
        "15/01/2024 10:00 EST",
        "16/01/2024 10:00 +01:00",
        "17/01/2024 10:00 +01:00",
    ]
    raw = ("date,daily_return\n" + "\n".join(f"{d},0.0{i + 1}" for i, d in enumerate(dates)) + "\n").encode()
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["ok"] is False
    assert [(rule.split("(")[0], row) for rule, row, _, _ in _date_errors(envelope)] == [("coerce_dtype", 3)]
    assert "not_nullable" not in {e["rule"] for e in envelope["errors"]}


def test_a_time_with_am_pm_is_not_mistaken_for_a_zone_name() -> None:
    """Control for the reach of the rule: `PM` is a trailing capital word too, but
    pandas reads the value, so it is a date and not a zone."""
    dates = ["13/01/2024 10:00 PM", "14/01/2024 10:00 PM", "15/01/2024 10:00 PM", "16/01/2024 10:00 PM"]
    envelope = validate_csv(_file("daily_returns", dates), "daily_returns")

    assert envelope["ok"] is True, envelope["errors"]


def test_the_preview_of_a_rejected_zone_file_shows_what_the_user_wrote() -> None:
    """The guard replaces the cell with an unparseable token while pandera runs.
    That token is an implementation detail and must not reach the preview."""
    dates = ["2024-03-29T00:00:00+02:00", "2024-03-30T00:00:00+2", "2024-03-31T00:00:00+02:00"]
    envelope = validate_csv(_file("daily_returns", dates), "daily_returns")

    shown = [r["date"] for r in envelope["preview"]["first_rows"]]
    assert shown[1] == "2024-03-30T00:00:00+2"
    assert "0000-00-00" not in json.dumps(envelope["preview"])


# The recognised spellings keep working, with the calendar date the user wrote.
RECOGNISED_ZONES = [
    pytest.param("{d}T{c}+02:00", id="colon-offset"),
    pytest.param("{d}T{c}+0200", id="compact-offset"),
    pytest.param("{d}T{c}+02", id="hours-only-offset"),
    pytest.param("{d}T{c}-05:00", id="negative-offset"),
    pytest.param("{d}T{c}Z", id="z"),
    pytest.param("{d} {c} UTC", id="utc-word"),
    pytest.param("{d} {c} UTC+02:00", id="utc-prefixed-offset"),
    pytest.param("{d} {c} +02:00", id="space-before-offset"),
]


@pytest.mark.parametrize("fmt", ["daily_returns", "daily_nav"])
@pytest.mark.parametrize("clock", ["00:00:00", "23:30:00"])
@pytest.mark.parametrize("shape", RECOGNISED_ZONES)
def test_the_recognised_zone_spellings_keep_the_calendar_date_written(
    fmt: str, clock: str, shape: str
) -> None:
    days = ["2024-03-29", "2024-03-30", "2024-03-31"]
    dates = [shape.format(d=d, c=clock) for d in days]
    envelope = validate_csv(_file(fmt, dates), fmt)

    assert envelope["ok"] is True, (dates, envelope["errors"])
    assert envelope["preview"]["date_range"] == ["2024-03-29", "2024-03-31"]
    series = [r["date"] for r in envelope["daily_returns_series"]]
    assert series == (days if fmt == "daily_returns" else days[1:])


# The invariant behind all of the above, over a grid of spellings: an ACCEPTED
# daily file carries exactly the calendar dates written in it. A spelling is
# either read as the wall clock or rejected; none moves a date.
_SPELLINGS = [
    "", "Z", "z", " UTC", " GMT", "+02:00", "+0200", "+02", "-05:00", " +02:00",
    "+2", "+2:00", "+02:0", "+002", "+99:99", "+24:00", "+0260",
    " GMT+1", " GMT-5", " GMT+02:00", " UTC+2", " UTC+02:00", " UTC-5",
    " (CET)", " CET", " +01:00 (CET)", "+01:00 CET", " +0100 CEST", " EST",
    " America/New_York", " +01:00 +02:00", "+01:00Z", " Z+01:00", "\u200b+02:00",
]
_CLOCKS = ["T00:00:00", " 23:30", " 00:00:00.123", "T12:00"]


@pytest.mark.parametrize("fmt", ["daily_returns", "daily_nav", "trades"])
@pytest.mark.parametrize("clock", _CLOCKS)
@pytest.mark.parametrize("spelling", _SPELLINGS)
def test_no_zone_spelling_raises_and_none_moves_a_daily_date(
    fmt: str, clock: str, spelling: str
) -> None:
    days = ["2024-03-29", "2024-03-30", "2024-03-31"]
    dates = [d + clock + spelling for d in days]
    envelope = validate_csv(_file(fmt, dates), fmt)  # must not raise

    if envelope["ok"] and fmt != "trades":
        assert envelope["preview"]["date_range"] == [days[0], days[-1]], (spelling, clock)
        series = [r["date"] for r in envelope["daily_returns_series"]]
        assert series == (days if fmt == "daily_returns" else days[1:]), (spelling, clock)


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


# An exact repeat of a header the schema declares. Pandas renames the second one
# (`daily_return` -> `daily_return.1`) BEFORE any check of ours runs, and
# `strict="filter"` then drops the copy, so the file used to be accepted using
# only the first column: the user's second column was silently ignored (review
# finding F2). The collision is read off the RAW header.
EXACT_REPEATS = [
    pytest.param("daily_returns", "date,daily_return,daily_return", id="daily_return-twice"),
    pytest.param("daily_returns", "date,daily_return,daily_return,daily_return", id="daily_return-three-times"),
    pytest.param("daily_returns", "date,date,daily_return", id="date-twice"),
    pytest.param("daily_returns", "daily_return,date,daily_return", id="daily_return-apart"),
    pytest.param("daily_returns", "date,daily_return,currency,currency", id="optional-currency-twice"),
    pytest.param("daily_returns", "date,daily_return,daily_return,Daily_Return", id="repeat-and-case"),
    pytest.param("daily_nav", "date,nav,nav", id="nav-twice"),
    pytest.param("trades", "date,side,qty,price,symbol,currency,symbol", id="trades-symbol-twice"),
    pytest.param("trades", "date,side,side,qty,price,symbol,currency", id="trades-side-twice"),
]


@pytest.mark.parametrize("fmt,header", EXACT_REPEATS)
def test_an_exact_repeat_of_a_declared_header_gets_the_founder_sentence(fmt: str, header: str) -> None:
    width = len(header.split(","))
    row = ",".join(["2024-01-01"] + ["1"] * (width - 1))
    raw = (header + "\n" + row + "\n" + row.replace("01-01", "01-02") + "\n").encode()

    envelope = validate_csv(raw, fmt)  # must not raise

    assert envelope["ok"] is False
    assert [(e["rule"], e["row"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", 0, DUPLICATE_HEADER_MESSAGE)
    ]
    assert envelope["preview"] is None


def test_an_exact_repeat_under_a_leading_blank_header_row_is_found_too() -> None:
    """The Excel shape: an all-empty first row, then the real header. The raw
    header to read is the SECOND row."""
    raw = b",,\ndate,daily_return,daily_return\n2024-01-01,0.01,5\n2024-01-02,0.02,5\n"
    envelope = validate_csv(raw, "daily_returns")

    assert [(e["rule"], e["row"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", 0, DUPLICATE_HEADER_MESSAGE)
    ]


# Review R-1 / SFH-R1 (D-14 final round). The raw header used to be read with
# `pd.read_csv(header=None)`, which fixes the field count from the FIRST line. An
# Excel-style blank first row NARROWER than the real header made that read raise,
# the error was swallowed, and the caller fell back to pandas' renamed columns
# (`daily_return`, `daily_return.1`), so the repeat was never seen and the user's
# second column was ignored without a word. The header is now read with the stdlib
# `csv` reader, which infers no field count.
_BODY_ROWS = "2024-03-10,0.001,0.5\n2024-03-11,0.002,0.5\n2024-03-12,-0.001,0.5\n"


def _under_blank_row(blank: str, header: str, rows: str = _BODY_ROWS) -> bytes:
    return f"{blank}\n{header}\n{rows}".encode()


# (blank first row, header, id). Each header repeats the declared `daily_return`.
BLANK_ROW_REPEATS = [
    pytest.param(",", "date,daily_return,daily_return", id="narrower-blank-row"),
    pytest.param(",,", "date,daily_return,daily_return", id="equal-width-blank-row"),
    pytest.param(",,,,", "date,daily_return,daily_return", id="wider-blank-row"),
    pytest.param(
        ",",
        'date,daily_return,"a,b",daily_return',
        id="narrower-blank-row-quoted-comma-before-the-repeat",
    ),
]


@pytest.mark.parametrize("blank,header", BLANK_ROW_REPEATS)
def test_an_exact_repeat_is_found_under_a_blank_first_row_of_any_width(blank: str, header: str) -> None:
    rows = _BODY_ROWS if "a,b" not in header else _BODY_ROWS.replace(",0.5", ",x,0.5")
    envelope = validate_csv(_under_blank_row(blank, header, rows), "daily_returns")

    assert envelope["ok"] is False, envelope
    assert [(e["rule"], e["row"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", 0, DUPLICATE_HEADER_MESSAGE)
    ]
    assert envelope["preview"] is None
    assert "daily_returns_series" not in envelope


def test_an_exact_repeat_is_found_under_a_leading_empty_line_and_a_narrower_blank_row() -> None:
    """pandas skips a truly empty line; the blank row that follows is record 0."""
    raw = b"\n,\ndate,daily_return,daily_return\n" + _BODY_ROWS.encode()
    envelope = validate_csv(raw, "daily_returns")

    assert [(e["rule"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", DUPLICATE_HEADER_MESSAGE)
    ]


def test_an_exact_repeat_is_found_under_a_byte_order_mark_and_a_narrower_blank_row() -> None:
    raw = b"\xef\xbb\xbf,\ndate,daily_return,daily_return\n" + _BODY_ROWS.encode()
    envelope = validate_csv(raw, "daily_returns")

    assert [(e["rule"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", DUPLICATE_HEADER_MESSAGE)
    ]


def test_an_exact_repeat_is_found_when_an_earlier_header_cell_holds_a_quoted_newline() -> None:
    raw = (
        b',\ndate,"no\nte",daily_return,daily_return\n'
        b"2024-03-10,x,0.001,0.5\n2024-03-11,x,0.002,0.5\n2024-03-12,x,-0.001,0.5\n"
    )
    envelope = validate_csv(raw, "daily_returns")

    assert [(e["rule"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", DUPLICATE_HEADER_MESSAGE)
    ]


@pytest.mark.parametrize("blank", [",", ",,", ",,,,"])
def test_a_good_header_under_a_blank_first_row_of_any_width_is_still_accepted(blank: str) -> None:
    """Control: the blank-row skip still works, and a header that repeats nothing
    (a quoted comma inside one cell is one cell, an undeclared pair is dropped) is
    not rejected by the raw-header read."""
    raw = (
        f'{blank}\ndate,daily_return,"a,b",Notes,notes\n'
        "2024-03-10,0.001,x,p,q\n2024-03-11,0.002,x,p,q\n2024-03-12,-0.001,x,p,q\n"
    ).encode()
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["ok"] is True, envelope["errors"]
    assert [r["daily_return"] for r in envelope["daily_returns_series"]] == [0.001, 0.002, -0.001]


def test_a_header_record_the_raw_read_cannot_parse_is_rejected_not_waved_through() -> None:
    """FAIL CLOSED. The raw-header read used to fall back to pandas' renamed
    columns when it failed, which restores the exact defect it exists to remove.
    A header cell over the stdlib reader's field limit (131072 characters) is a
    file pandas reads and the raw read cannot: it must be rejected, with the
    existing `Could not parse CSV: ...` sentence, and echo no cell."""
    big = "x" * 200_000
    raw = f"date,daily_return,{big}\n2024-03-10,0.001,a\n2024-03-11,0.002,b\n".encode()
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["ok"] is False, envelope
    assert "daily_returns_series" not in envelope
    assert envelope["preview"] is None
    assert [(e["rule"], e["row"]) for e in envelope["errors"]] == [("parse_error", 0)]
    assert envelope["errors"][0]["message"].startswith("Could not parse CSV: ")
    assert big[:50] not in json.dumps(envelope, default=str)


@pytest.mark.parametrize(
    "header",
    [
        pytest.param("date,daily_return,Notes,notes", id="undeclared-case-pair"),
        pytest.param("date,daily_return,notes,notes", id="undeclared-exact-pair"),
        pytest.param("notes,notes,date,daily_return", id="undeclared-exact-pair-first"),
        pytest.param("date,daily_return,daily_return.1", id="declared-name-with-a-literal-dot-one"),
    ],
)
def test_a_pair_the_schema_does_not_declare_is_still_accepted(header: str) -> None:
    """Control for the scope of the rule (D-14 amendment): the founder sentence is
    for a collision on a column the schema READS. Undeclared columns are dropped
    by `strict="filter"` without being read, these files validated before this
    change, and a literal `daily_return.1` is a different name, not a repeat."""
    width = len(header.split(","))
    cells = {"date": "2024-01-0{n}", "daily_return": "0.0{n}"}
    cols = header.split(",")

    def row(n: int) -> str:
        return ",".join(cells[c].format(n=n) if c in cells else "x" for c in cols)

    raw = (header + "\n" + row(1) + "\n" + row(2) + "\n").encode()
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["ok"] is True, (width, envelope["errors"])
    assert DUPLICATE_HEADER_MESSAGE not in {e["message"] for e in envelope["errors"]}


def test_the_exact_repeat_sentence_names_no_header_and_echoes_no_cell() -> None:
    raw = f"date,daily_return,daily_return\n{MARKER},{MARKER},{MARKER}\n".encode()
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["errors"][0]["message"] == DUPLICATE_HEADER_MESSAGE
    assert MARKER.lower() not in json.dumps(envelope, default=str).lower()


# Review TR-1 and TR-2 (tiny round, both HIGH). The raw header read that R-1
# introduced regressed two shapes that validated correctly before it:
#   TR-1  pandas skips a line of spaces or tabs; the stdlib reader keeps it as a
#         one-field record, so the "header" was that line. A repeated column under
#         it was ACCEPTED (the second one silently ignored) or RAISED.
#   TR-2  `io.StringIO(text)` without `newline=""` splits only on a line feed, so a
#         file with bare-carriage-return line ends (Excel for Mac) was rejected
#         with a Python hint, "do you need to open the file with newline=''?".
# The `\r` and `\t` below are real control characters in the file, not escapes the
# test forgot to decode.
_DUP_BODY = "2024-03-10,0.001,0.5\n2024-03-11,0.002,0.5\n2024-03-12,-0.001,0.5\n"
_DUP_BODY_DATE_DATE = "2024-03-10,2024-03-10,0.001\n2024-03-11,2024-03-11,0.002\n2024-03-12,2024-03-12,-0.001\n"

# (line above the header, header, body, id). Every one must get the founder
# sentence: the header repeats, or collides after lower-casing, a declared column.
WHITESPACE_LINE_REPEATS = [
    pytest.param(" ", "date,daily_return,daily_return", _DUP_BODY, id="space-above-exact-repeat"),
    pytest.param("\t", "date,daily_return,daily_return", _DUP_BODY, id="tab-above-exact-repeat"),
    pytest.param(" \t  ", "date,daily_return,daily_return", _DUP_BODY, id="mixed-whitespace-above-exact-repeat"),
    pytest.param(" ", "date,daily_return,Daily_Return", _DUP_BODY, id="space-above-case-collision"),
    pytest.param(" ", "date,Date,daily_return", _DUP_BODY_DATE_DATE, id="space-above-date-Date"),
    pytest.param(",", "date,daily_return,daily_return", _DUP_BODY, id="comma-above-exact-repeat-original-R1"),
]


@pytest.mark.parametrize("above,header,body", WHITESPACE_LINE_REPEATS)
def test_a_whitespace_only_line_above_the_header_does_not_hide_a_repeated_column(
    above: str, header: str, body: str
) -> None:
    envelope = validate_csv(f"{above}\n{header}\n{body}".encode(), "daily_returns")  # must not raise

    assert envelope["ok"] is False, envelope
    assert [(e["rule"], e["row"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", 0, DUPLICATE_HEADER_MESSAGE)
    ]
    assert envelope["preview"] is None
    assert "daily_returns_series" not in envelope


@pytest.mark.parametrize("above", [" ", "\t", " \t  "])
def test_a_good_header_under_a_whitespace_only_line_is_still_accepted(above: str) -> None:
    """Control: skipping the line must not cost a good file."""
    raw = f"{above}\ndate,daily_return\n2024-03-10,0.001\n2024-03-11,0.002\n2024-03-12,-0.001\n".encode()
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["ok"] is True, envelope["errors"]
    assert [r["daily_return"] for r in envelope["daily_returns_series"]] == [0.001, 0.002, -0.001]


# A bare carriage return ends a line for pandas, and for the raw header read too.
_CR_GOOD = b"date,daily_return\r2024-03-10,0.001\r2024-03-11,0.002\r2024-03-12,-0.001\r"
_CR_GOOD_UNDER_BLANK = b",\rdate,daily_return\r2024-03-10,0.001\r2024-03-11,0.002\r2024-03-12,-0.001\r"
_CR_GOOD_UNDER_SPACE = b" \rdate,daily_return\r2024-03-10,0.001\r2024-03-11,0.002\r2024-03-12,-0.001\r"


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(_CR_GOOD, id="bare-cr"),
        pytest.param(_CR_GOOD_UNDER_BLANK, id="bare-cr-blank-first-row"),
        pytest.param(_CR_GOOD_UNDER_SPACE, id="bare-cr-whitespace-first-row"),
    ],
)
def test_a_file_with_bare_carriage_return_line_ends_validates(raw: bytes) -> None:
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["ok"] is True, envelope["errors"]
    assert [r["daily_return"] for r in envelope["daily_returns_series"]] == [0.001, 0.002, -0.001]
    # Never the Python developer hint.
    assert "newline=" not in json.dumps(envelope, default=str)


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(
            b"date,daily_return,daily_return\r2024-03-10,0.001,0.5\r2024-03-11,0.002,0.5\r",
            id="bare-cr-exact-repeat",
        ),
        pytest.param(
            b",\rdate,daily_return,daily_return\r2024-03-10,0.001,0.5\r2024-03-11,0.002,0.5\r",
            id="bare-cr-blank-first-row-exact-repeat",
        ),
        pytest.param(
            b"date,daily_return,Daily_Return\r2024-03-10,0.001,0.5\r2024-03-11,0.002,0.5\r",
            id="bare-cr-case-collision",
        ),
    ],
)
def test_a_bare_carriage_return_duplicate_header_gets_the_founder_sentence(raw: bytes) -> None:
    envelope = validate_csv(raw, "daily_returns")

    assert [(e["rule"], e["row"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", 0, DUPLICATE_HEADER_MESSAGE)
    ]


def test_crlf_bom_quoted_comma_and_quoted_newline_headers_still_behave() -> None:
    """Controls for the `newline=""` change: every other line-end and quoting shape
    reads the same as before, for a good header and for a repeated one."""
    body_lf = _DUP_BODY
    good = b"date,daily_return\r\n2024-03-10,0.001\r\n2024-03-11,0.002\r\n"
    assert validate_csv(good, "daily_returns")["ok"] is True
    assert validate_csv(b"\xef\xbb\xbf" + good, "daily_returns")["ok"] is True
    assert validate_csv(b'date,daily_return,"a,b"\n2024-03-10,0.001,x\n2024-03-11,0.002,x\n', "daily_returns")["ok"] is True
    assert validate_csv(b'"no\nte",date,daily_return\nx,2024-03-10,0.001\nx,2024-03-11,0.002\n', "daily_returns")["ok"] is True

    for dup in (
        b"date,daily_return,daily_return\r\n" + body_lf.replace("\n", "\r\n").encode(),
        b"\xef\xbb\xbfdate,daily_return,daily_return\n" + body_lf.encode(),
        b'date,"a,b",daily_return,daily_return\n' + body_lf.replace(",0.5", ",x,0.5").encode(),
        b'"no\nte",date,daily_return,daily_return\n' + body_lf.replace("2024", "x,2024").encode(),
    ):
        envelope = validate_csv(dup, "daily_returns")
        assert [(e["rule"], e["message"]) for e in envelope["errors"]] == [
            ("parse_error", DUPLICATE_HEADER_MESSAGE)
        ], dup


def test_a_raw_header_the_frame_read_disagrees_with_is_rejected_not_checked() -> None:
    """The guard against the two readers drifting apart (review TR-1). A leading
    bare carriage return makes pandas drop the empty first field of the next line
    (header `date`, `daily_return`) where the raw read sees a three-field record.
    Neither can be trusted to name a column, so the file is rejected with the
    existing wrong-width sentence, never raised and never validated against a
    header that may be the wrong line."""
    raw = b"\r,date,daily_return\n2024-03-10,0.001\n2024-03-11,0.002\n"
    envelope = validate_csv(raw, "daily_returns")  # must not raise

    assert envelope["ok"] is False, envelope
    assert envelope["preview"] is None
    assert "daily_returns_series" not in envelope
    assert [(e["rule"], e["row"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", 0, "Could not parse CSV: a data row has more fields than the header row.")
    ]


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
        add("fall-back-offsets", fmt, _file(fmt, FALL_BACK_TRADES))
        add("dst-offsets-marker-cell", fmt, _file(fmt, EUROPE_DST_MIDNIGHT[:2] + [f"{MARKER}+02:00"]))
        add("mixed-offsets-and-naive", fmt, _file(fmt, ["2024-03-29T00:00:00", "2024-03-30T00:00:00+01:00", "2024-03-31T00:00:00Z"]))
        add("offset-garbage", fmt, _file(fmt, ["2024-03-29T00:00:00+99:99", "2024-03-30T00:00:00+01:00", "2024-03-31T00:00:00+zz"]))
        add("header-case-collision-date", fmt, h.replace("date", "date,Date", 1) + "\n" + "\n".join(x.replace(",", ",x,", 1) for x in rows) + "\n")
        add("header-case-collision-last", fmt, h + f",{cols[-1].upper()}\n" + "\n".join(x + ",5" for x in rows) + "\n")
        add("header-exact-repeat-first", fmt, f"{cols[0]},{h}\n" + "\n".join(x.split(",")[0] + "," + x for x in rows) + "\n")
        add("header-exact-repeat-last", fmt, h + f",{cols[-1]}\n" + "\n".join(x + ",5" for x in rows) + "\n")
        add("header-exact-repeat-thrice", fmt, h + f",{cols[-1]},{cols[-1]}\n" + "\n".join(x + ",5,5" for x in rows) + "\n")
        add("header-exact-repeat-marker-cells", fmt, h + f",{cols[-1]}\n" + "\n".join(x + f",{MARKER}" for x in rows) + "\n")
        add("header-exact-repeat-undeclared", fmt, h + ",notes,notes\n" + "\n".join(x + ",a,b" for x in rows) + "\n")
        add("header-exact-repeat-blank-header-row", fmt, "," * (ncol) + "\n" + h + f",{cols[-1]}\n" + "\n".join(x + ",5" for x in rows) + "\n")
        add("header-case-collision-marker", fmt, f"{MARKER},{MARKER.lower()}\n" + "\n".join(rows) + "\n")
        # D-14 amendment specimens: zones the strip does not recognise.
        for zone_case in ZONE_REJECTED:
            add(f"zone-{zone_case.id}", fmt, _file(fmt, zone_case.values[0]))
        add("zone-marker-before-offset", fmt, _file(fmt, [f"2024-03-29 00:00 {MARKER}+2", f"2024-03-30 00:00 {MARKER} GMT+1", "2024-03-31T00:00:00+02:00"]))

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
