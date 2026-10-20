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
import time

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


def _all_errors(envelope: dict) -> list[tuple[str, int, str, str | None]]:
    """Every error, rule included, whatever its rule: nothing filtered out."""
    return [(e["rule"], e["row"], e["message"], e.get("column")) for e in envelope["errors"]]


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


# Review TR-3 (tiny round, MEDIUM, user-facing). The dates below INCREASE; one cell
# has a zone the validator does not read. The unreadable cell is a date error at
# its row, and that is ALL the user should be told: before this fix the file also
# got `monotonic_dates` at row 0, "dates must be strictly increasing", which
# says the user's dates are out of order when they are not.
ONLY_THE_DATE_ERROR = ["coerce_dtype('datetime64[ns]')", "dtype('datetime64[ns]')"]

INCREASING_WITH_ONE_BAD_ZONE = [
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
    pytest.param(ISO_NAMED_ZONE, 3, id="iso-est-in-the-middle"),
    # The ISO twin of the DST file: a `GMT+1` spelling (read as UTC-1 by dateutil,
    # so never converted) between two recognised offsets.
    pytest.param(
        ["2024-03-30T00:00:00+01:00", "2024-03-31 00:00:00 GMT+1", "2024-04-01T00:00:00+02:00"],
        2,
        id="iso-gmt-plus-1-between-recognised-offsets",
    ),
    pytest.param(
        ["13/01/2024 00:00:00 +01:00", "14/01/2024 00:00:00 +01:00 (CET)", "15/01/2024 00:00:00 +01:00", "16/01/2024 00:00:00 +01:00"],
        2,
        id="day-first-name-after-offset",
    ),
]


@pytest.mark.parametrize("fmt", list(HEADER))
@pytest.mark.parametrize("dates,bad_row", INCREASING_WITH_ONE_BAD_ZONE)
def test_dates_that_increase_with_one_unreadable_zone_get_only_the_date_error(
    fmt: str, dates: list[str], bad_row: int
) -> None:
    envelope = validate_csv(_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    assert [(rule, row) for rule, row, _, _ in _all_errors(envelope)] == [
        (rule, bad_row) for rule in ONLY_THE_DATE_ERROR
    ], envelope["errors"]
    assert "monotonic_dates" not in {e["rule"] for e in envelope["errors"]}


OUT_OF_ORDER_WITH_ONE_BAD_ZONE = [
    pytest.param(
        ["13/01/2024 10:00 +01:00", "16/01/2024 10:00 +01:00", "15/01/2024 10:00 +01:00", "17/01/2024 10:00 EST"],
        id="day-first-est",
    ),
    pytest.param(
        ["2024-01-13 10:00 +01:00", "2024-01-16 10:00 +01:00", "2024-01-15 10:00 +01:00", "2024-01-17 10:00 EST"],
        id="iso-est",
    ),
    # Two readable dates on the same day: not strictly increasing, whatever the
    # third cell is.
    pytest.param(
        ["2024-01-13 10:00 +01:00", "2024-01-13 10:00 +01:00", "2024-01-15 10:00 EST", "2024-01-16 10:00 +01:00"],
        id="iso-duplicate-readable-dates",
    ),
    pytest.param(
        ["13/01/2024 10:00 +01:00", "16/01/2024 10:00 +01:00", "15/01/2024 10:00 GMT+1", "14/01/2024 10:00 +01:00"],
        id="day-first-gmt-plus-1",
    ),
]


@pytest.mark.parametrize("fmt", list(HEADER))
@pytest.mark.parametrize("dates", OUT_OF_ORDER_WITH_ONE_BAD_ZONE)
def test_dates_that_really_are_out_of_order_still_report_it_beside_a_bad_zone(
    fmt: str, dates: list[str]
) -> None:
    """Control for TR-3: the order is checked on the readable rows, not dropped."""
    envelope = validate_csv(_file(fmt, dates), fmt)

    rules = {e["rule"] for e in envelope["errors"]}
    assert envelope["ok"] is False
    assert "monotonic_dates" in rules, envelope["errors"]
    assert set(ONLY_THE_DATE_ERROR) <= rules, envelope["errors"]


@pytest.mark.parametrize("fmt", list(HEADER))
def test_the_day_first_named_zone_error_has_the_shape_the_iso_file_gets(fmt: str) -> None:
    """Rule string, row, message and column are what pandera emits for the same
    cell in an ISO column: the day-first file must not read differently."""
    day_first = validate_csv(_file(fmt, DAY_FIRST_NAMED_ZONE), fmt)
    iso = validate_csv(_file(fmt, ISO_NAMED_ZONE), fmt)

    assert day_first["ok"] is False and iso["ok"] is False
    assert _date_errors(iso), iso["errors"]  # the ISO path still gives coerce_dtype
    assert _date_errors(day_first) == _date_errors(iso)
    # The FULL rule list, not only the `coerce_dtype` subset: filtering to that
    # subset is what hid a spurious `monotonic_dates` here (review TR-3).
    assert _all_errors(day_first) == _all_errors(iso), (day_first["errors"], iso["errors"])


# Review LR-2 (last round, MEDIUM, user-facing). TR-3 was fixed only where pandera
# had parsed the column. A day-first file with one unreadable cell reached the
# order check as text, and the check read it month-first from the first cell, so a
# file whose dates increase was told "dates must be strictly increasing" (and a
# real disorder could be hidden). Every TR-3 specimen above uses days 13 to 17,
# which no month-first reading can parse; a real day-first file has days 1 to 12.
def _daily_file(fmt: str, dates: list[str]) -> bytes:
    value = {
        "daily_returns": lambda i: f"0.00{i % 9 + 1}",
        "trades": lambda i: "buy,1,10,BTC,USD",
    }.get(fmt, lambda i: str(100 + i))
    rows = [f"{d},{value(i)}" for i, d in enumerate(dates)]
    return (HEADER[fmt] + "\n" + "\n".join(rows) + "\n").encode()


def _day_first_days(count: int) -> list[str]:
    import datetime as dt

    return [(dt.date(2024, 1, 1) + dt.timedelta(i)).strftime("%d/%m/%Y") for i in range(count)]


def _rules_and_rows(envelope: dict) -> list[tuple[str, int]]:
    return [(e["rule"], e["row"]) for e in envelope["errors"]]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_total_footer_under_a_day_first_file_gets_only_its_own_date_error(fmt: str) -> None:
    dates = _day_first_days(60)  # 01/01/2024 ... 29/02/2024
    raw = _daily_file(fmt, dates) + b"Total,0.05\n"
    envelope = validate_csv(raw, fmt)

    assert envelope["ok"] is False
    assert _rules_and_rows(envelope) == [(rule, 61) for rule in ONLY_THE_DATE_ERROR], envelope["errors"]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_blank_date_footer_under_a_day_first_file_has_no_order_error(fmt: str) -> None:
    raw = _daily_file(fmt, _day_first_days(60)) + b",0.05\n"
    envelope = validate_csv(raw, fmt)

    assert envelope["ok"] is False
    assert "monotonic_dates" not in {e["rule"] for e in envelope["errors"]}, envelope["errors"]
    assert {row for _, row in _rules_and_rows(envelope)} == {61}, envelope["errors"]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_ten_day_steps_day_first_with_one_garbage_cell_get_only_the_date_error(fmt: str) -> None:
    import datetime as dt

    # 05/01, 15/01, 25/01, 04/02, 14/02, 24/02, 05/03 ...: days 1 to 12 included.
    dates = [(dt.date(2024, 1, 5) + dt.timedelta(10 * i)).strftime("%d/%m/%Y") for i in range(12)]
    dates[4] = "garbage"
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    assert _rules_and_rows(envelope) == [(rule, 5) for rule in ONLY_THE_DATE_ERROR], envelope["errors"]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_day_first_file_with_a_bad_zone_and_two_rows_swapped_still_reports_the_order(fmt: str) -> None:
    """Control: the readable cells are judged on the detector's day-first reading,
    so a real disorder is not hidden by the unreadable cell beside it."""
    dates = [f"{day:02d}/01/2024 10:00 +01:00" for day in range(1, 21)]
    dates[2] = "03/01/2024 10:00 EST"
    dates[16], dates[17] = dates[17], dates[16]  # rows 17 and 18
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    rules = {e["rule"] for e in envelope["errors"]}
    assert envelope["ok"] is False
    assert "monotonic_dates" in rules, envelope["errors"]
    assert set(ONLY_THE_DATE_ERROR) <= rules, envelope["errors"]


# Review LF-1 (HIGH, data integrity, introduced by the LR-2 fix). A cell spelled
# differently from the first cell is unreadable under BOTH readings (each reading
# infers one format from the first cell). It was handed back to pandera as text,
# and pandera read it month-first without an error: the last row of an in-order
# day-first file was stored as 2024-05-04 for `05/04/24`, which is 2024-04-05.
@pytest.mark.parametrize("fmt", DAILY_FORMATS)
@pytest.mark.parametrize("last", ["05/04/24", "05-04-2024", "05.04.2024", "12/03/2024 00:00", "05/04/2024 10:00"])
def test_a_differently_spelled_last_cell_in_a_day_first_file_is_rejected_at_its_row(
    fmt: str, last: str
) -> None:
    import datetime as dt

    dates = [(dt.date(2024, 3, 1) + dt.timedelta(i)).strftime("%d/%m/%Y") for i in range(35)]
    dates.append(last)  # row 36
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is False, "a date in another spelling was accepted and read in the other calendar"
    assert (ONLY_THE_DATE_ERROR[0], 36) in _rules_and_rows(envelope), envelope["errors"]


@pytest.mark.parametrize("last", ["Total", "05/04/24"])
def test_the_preview_of_a_rejected_day_first_file_shows_the_text_of_the_bad_cell(last: str) -> None:
    """The placeholder stands in for the cell only while pandera runs (LF-1)."""
    dates = _day_first_days(60) + [last]
    envelope = validate_csv(_daily_file("daily_returns", dates), "daily_returns")

    assert envelope["ok"] is False
    assert envelope["preview"]["last_rows"][-1]["date"] == last, envelope["preview"]


def test_an_ambiguous_day_first_file_with_a_footer_still_reports_the_footer_cell() -> None:
    """Every readable day is 12 or less, so the format cannot be told (the file
    is rejected as ambiguous, as it is without the footer). The footer's own date
    error must still be there beside it."""
    dates = ["01/01/2024", "01/02/2024", "01/03/2024", "Total"]
    envelope = validate_csv(_daily_file("daily_returns", dates), "daily_returns")

    assert envelope["ok"] is False
    assert _rules_and_rows(envelope) == [
        ("date_format_ambiguous", 0),
        *[(rule, 4) for rule in ONLY_THE_DATE_ERROR],
    ], envelope["errors"]


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


def test_a_header_record_the_raw_read_cannot_parse_is_rejected_not_waved_through(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FAIL CLOSED. The raw-header read used to fall back to pandas' renamed
    columns when it failed, which restores the exact defect it exists to remove.
    The raw read is pandas now (review LR-1), so a file it cannot parse is a file
    the frame read cannot either; this forces the failure the way pandas reports
    one, a `ParserError`, and pins what the caller does with it: the existing
    `Could not parse CSV: ...` sentence, and no cell echoed."""
    import pandas as pd

    import services.csv_validator as csv_validator

    big = "x" * 200_000

    def _cannot_parse(*_args: object, **_kwargs: object) -> list[str]:
        raise pd.errors.ParserError("Error tokenizing data")

    monkeypatch.setattr(csv_validator, "_raw_header_names", _cannot_parse)
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


def test_a_raw_header_the_frame_read_disagrees_with_is_rejected_not_checked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The guard against the two readers drifting apart (review TR-1). Both reads
    are pandas now (review LR-1), so they cannot disagree on a real file; this
    forces a raw header of the wrong width and pins that the file is rejected with
    the existing wrong-width sentence, never raised and never validated against a
    header that may be the wrong line."""
    import services.csv_validator as csv_validator

    monkeypatch.setattr(csv_validator, "_raw_header_names", lambda *_a, **_k: ["date", "daily_return", "x"])
    raw = b"date,daily_return\n2024-03-10,0.001\n2024-03-11,0.002\n"
    envelope = validate_csv(raw, "daily_returns")  # must not raise

    assert envelope["ok"] is False, envelope
    assert envelope["preview"] is None
    assert "daily_returns_series" not in envelope
    assert [(e["rule"], e["row"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", 0, "Could not parse CSV: a data row has more fields than the header row.")
    ]


# Review LR-1 (last round, HIGH). A quoted-empty first line (`""`, what a one-cell
# blank row looks like from a quote-all exporter) is a header cell to pandas, so
# the blank-row re-read takes line 2 as the header. The stdlib reader the raw
# header read used dropped it as blank, took the FIRST DATA ROW as the "header",
# and the width guard passed when that row was as wide as the header. The raw read
# is now pandas with the frame read's own options, so both agree on the header.
@pytest.mark.parametrize(
    "header,body",
    [
        pytest.param("date,daily_return,daily_return", _DUP_BODY, id="exact-repeat"),
        pytest.param("date,Date,daily_return", _DUP_BODY_DATE_DATE, id="date-Date"),
        pytest.param("date,daily_return,Daily_Return", _DUP_BODY, id="case-collision"),
    ],
)
def test_a_quoted_empty_first_line_does_not_hide_a_repeated_column(header: str, body: str) -> None:
    envelope = validate_csv(f'""\n{header}\n{body}'.encode(), "daily_returns")  # must not raise

    assert [(e["rule"], e["row"], e["message"]) for e in envelope["errors"]] == [
        ("parse_error", 0, DUPLICATE_HEADER_MESSAGE)
    ]
    assert envelope["ok"] is False and envelope["preview"] is None


def test_a_good_header_with_a_trailing_comma_under_a_quoted_empty_line_is_accepted() -> None:
    """Control: the file has no over-long data row, and must not be told it has."""
    raw = '""\ndate,daily_return,\n2024-03-10,0.001\n2024-03-11,0.002\n2024-03-12,-0.001\n'.encode()
    envelope = validate_csv(raw, "daily_returns")

    assert envelope["ok"] is True, envelope["errors"]
    assert [r["daily_return"] for r in envelope["daily_returns_series"]] == [0.001, 0.002, -0.001]


# Security re-audit T-170.1-51 (availability, validator half). The per-cell zone
# check called `pd.to_datetime` on every date cell and only the row count and the
# 10 MB body were capped, not the length of a cell: a 10 MB file of 5,000 rows of
# 2 KB (or 500 of 20 KB) of repeated `1:11 ` took 42 to 45 s here (11.9 s before
# D-14, 58.8 s in the audit's own run) on a synchronous call in a single-process
# service. A date cell longer than 64 characters is now unreadable without a call
# into pandas or a zone regex: it is the same `coerce_dtype` date error at its
# row. The bound below is generous on purpose, 5 s against a measured fraction of
# one, so a slow CI runner cannot flake it; the shape it replaces takes 40 s.
MAX_DATE_CELL_CHARS = 64  # hand-typed: the cap the audit asked for, pinned here
TIME_BOUND_SECONDS = 5.0


def _long_cell(size: int) -> str:
    return ("1:11 " * (size // 5 + 1))[:size].strip()


@pytest.mark.parametrize(
    "rows,size",
    [pytest.param(5000, 2000, id="5000-rows-x-2KB"), pytest.param(500, 20000, id="500-rows-x-20KB")],
)
def test_a_10mb_file_of_very_long_date_cells_is_rejected_in_bounded_time(rows: int, size: int) -> None:
    cell = _long_cell(size)
    raw = ("date,daily_return\n" + "".join(f"{cell},0.001\n" for _ in range(rows))).encode()
    assert len(raw) > 9_000_000  # the worst case the 10 MB body cap allows

    started = time.perf_counter()
    envelope = validate_csv(raw, "daily_returns")  # must not raise
    elapsed = time.perf_counter() - started

    assert elapsed < TIME_BOUND_SECONDS, f"{elapsed:.1f}s for {rows} rows of {size} characters"
    assert envelope["ok"] is False
    # Every long cell is the existing date error at its own 1-based row.
    assert sorted({row for rule, row, _, _ in _all_errors(envelope) if rule.startswith(COERCE_RULE_PREFIX)}) == list(
        range(1, rows + 1)
    )


@pytest.mark.parametrize("fmt", list(HEADER))
def test_one_over_long_date_cell_is_a_date_error_at_its_row_and_only_that(fmt: str) -> None:
    dates = ["2024-03-01", "2024-03-02", "2024-03-03 " + "9" * 200, "2024-03-04"]
    envelope = validate_csv(_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    assert [(rule, row) for rule, row, _, _ in _all_errors(envelope)] == [
        (rule, 3) for rule in ONLY_THE_DATE_ERROR
    ], envelope["errors"]
    assert "9" * 50 not in json.dumps(_all_errors(envelope))  # no cell in a message


def test_the_cap_is_on_the_cell_not_its_padding() -> None:
    """Spaces around a short date are not part of the date. A fixed-width export
    pads every cell; the cap must not read that padding as length."""
    padded = [" " * 80 + d + " " * 80 for d in ("2024-03-01", "2024-03-02", "2024-03-03")]
    envelope = validate_csv(_file("daily_returns", padded), "daily_returns")

    assert envelope["ok"] is True, envelope["errors"]


# The longest spellings a date cell can honestly take: nanoseconds and a zone.
# Every one is far under the cap, and every one validated before the cap existed.
LONGEST_LEGITIMATE_SPELLINGS = [
    "2024-03-{d}T00:00:00.123456789+02:00",
    "2024-03-{d} 00:00:00.123456789 UTC+02:00",
    "2024-03-{d} 00:00:00.123456789 GMT",
    '"2024-03-{d}T00:00:00,123456789Z"',  # quoted: the comma is the fraction mark
    "{d}/03/2024 12:00:00.123456789 PM",
]


@pytest.mark.parametrize("spelling", LONGEST_LEGITIMATE_SPELLINGS)
@pytest.mark.parametrize("fmt", ["daily_returns", "daily_nav", "trades"])
def test_the_longest_legitimate_date_spellings_are_under_the_cap_and_validate(spelling: str, fmt: str) -> None:
    dates = [spelling.format(d=d) for d in (13, 14, 15)]  # day > 12: no day/month ambiguity
    assert max(len(d) for d in dates) <= 40 < MAX_DATE_CELL_CHARS
    envelope = validate_csv(_file(fmt, dates), fmt)

    assert envelope["ok"] is True, envelope["errors"]


def test_the_cap_is_exactly_64_characters() -> None:
    """64 characters of a readable date is read; 65 is not. Pins the number."""
    head = "2024-03-0{d} 00:00:00."

    def cell(d: int, length: int) -> str:
        return head.format(d=d) + "1" * (length - len(head.format(d=d)))

    at_cap = validate_csv(_file("daily_returns", [cell(d, MAX_DATE_CELL_CHARS) for d in (1, 2, 3)]), "daily_returns")
    over = validate_csv(_file("daily_returns", [cell(d, MAX_DATE_CELL_CHARS + 1) for d in (1, 2, 3)]), "daily_returns")

    assert at_cap["ok"] is True, at_cap["errors"]
    assert over["ok"] is False
    assert {row for rule, row, _, _ in _all_errors(over) if rule.startswith(COERCE_RULE_PREFIX)} == {1, 2, 3}


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


# Final-hunt F1 (HIGH, data integrity) and F2 (MEDIUM, user-facing). `dayfirst=True`
# flips a year-first cell (`2024-01-02` is read as 2024-02-01), so in a day-first
# column one such cell made the day-first reading non-monotonic, the detector took
# "month-first is the only valid reading", and pandera read EVERY cell month-first:
# twelve days of January came back as twelve months of 2024 with no error.
@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_one_year_first_cell_in_a_day_first_column_does_not_move_the_whole_column_to_month_first(
    fmt: str,
) -> None:
    """Twelve days of January 2024 with the second spelled `2024-01-02`. Every
    component is 12 or less, so the day order cannot be told (the file is rejected
    as ambiguous, as it is without the year-first cell). It must not be ACCEPTED,
    and certainly not with a range that ends in December."""
    dates = [f"{day:02d}/01/24" for day in range(1, 13)]
    dates[1] = "2024-01-02"
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is False, envelope["preview"]
    assert _rules_and_rows(envelope) == [("date_format_ambiguous", 0)], envelope["errors"]
    assert envelope.get("daily_returns_series") in (None, []), "a rejected file carries no series"


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_year_first_cell_among_unambiguous_day_first_cells_is_accepted_with_the_right_range(
    fmt: str,
) -> None:
    """F2: before the last round this file was accepted; the last round rejected it
    at the year-first cell. 40 days, one of them spelled `2024-01-21` (row 21)."""
    dates = _day_first_days(40)
    dates[20] = "2024-01-21"
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is True, envelope["errors"]
    assert envelope["preview"]["date_range"] == ["2024-01-01", "2024-02-09"], envelope["preview"]


# Final-hunt F3 (MEDIUM, user-facing). When both day/month readings agree (every day
# is over 12) a cell neither reads was written as NaT, so pandera reported a
# footer as `not_nullable` ("blank") and the preview showed `NaT`. The day-first
# branch already hands such a cell to pandera as the uncoercible placeholder,
# which gives `coerce_dtype` at its row and the user's own text in the preview.
@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_total_footer_under_dates_both_readings_agree_on_is_a_date_error_not_a_blank(
    fmt: str,
) -> None:
    envelope = validate_csv(_daily_file(fmt, ["13/01/2024", "14/01/2024", "Total"]), fmt)

    assert envelope["ok"] is False
    assert _rules_and_rows(envelope) == [(rule, 3) for rule in ONLY_THE_DATE_ERROR], envelope["errors"]
    assert "not_nullable" not in {e["rule"] for e in envelope["errors"]}
    assert envelope["preview"]["last_rows"][-1]["date"] == "Total", envelope["preview"]
    assert "0000-00-00" not in json.dumps(envelope["preview"], default=str)


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_blank_date_under_dates_both_readings_agree_on_is_still_reported_as_blank(fmt: str) -> None:
    """Control: a blank cell is not an unreadable date, it is a missing one."""
    envelope = validate_csv(_daily_file(fmt, ["13/01/2024", "14/01/2024", ""]), fmt)

    assert envelope["ok"] is False
    assert [(rule, row) for rule, row in _rules_and_rows(envelope) if rule == "not_nullable"] == [
        ("not_nullable", 3)
    ], envelope["errors"]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_differently_spelled_first_cell_reports_the_later_rows_as_date_errors_with_their_text(
    fmt: str,
) -> None:
    """Pandas infers the one format from the FIRST cell, so `13-01-2024` first makes
    the `/` cells unreadable. The file is rejected at those rows (not read in the
    other calendar, not shown as blank), each shown as the user wrote it."""
    envelope = validate_csv(_daily_file(fmt, ["13-01-2024", "14/01/2024", "15/01/2024"]), fmt)

    assert envelope["ok"] is False
    assert [(rule, row) for rule, row in _rules_and_rows(envelope) if rule.startswith(COERCE_RULE_PREFIX)] == [
        (ONLY_THE_DATE_ERROR[0], 2),
        (ONLY_THE_DATE_ERROR[0], 3),
    ], envelope["errors"]
    assert "not_nullable" not in {e["rule"] for e in envelope["errors"]}
    assert [r["date"] for r in envelope["preview"]["last_rows"][1:]] == ["14/01/2024", "15/01/2024"]


# Final-hunt F4 (HIGH, data integrity, not from 170.1). A date column of all digits
# (`20230305`) is read by pandas as int64, and pandera reads an integer as
# nanoseconds since the epoch: a 60-day file was ACCEPTED with every date on
# 1970-01-01.
def _yyyymmdd_days(count: int) -> list[str]:
    import datetime as dt

    return [(dt.date(2023, 3, 5) + dt.timedelta(i)).strftime("%Y%m%d") for i in range(count)]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_an_all_digit_yyyymmdd_date_column_is_read_as_dates_not_as_epoch_nanoseconds(fmt: str) -> None:
    envelope = validate_csv(_daily_file(fmt, _yyyymmdd_days(60)), fmt)

    assert envelope["ok"] is True, envelope["errors"]
    assert envelope["preview"]["date_range"] == ["2023-03-05", "2023-05-03"], envelope["preview"]
    if fmt == "daily_returns":
        series = [row["date"] for row in envelope["daily_returns_series"]]
        assert series[0] == "2023-03-05" and series[-1] == "2023-05-03" and len(series) == 60


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
@pytest.mark.parametrize(
    "dates",
    [
        pytest.param([str(45000 + i) for i in range(30)], id="excel-serial"),
        pytest.param([str(1700000000 + 86400 * i) for i in range(30)], id="unix-seconds"),
        pytest.param(_yyyymmdd_days(30)[:9] + ["20231340"] + _yyyymmdd_days(30)[10:], id="invalid-yyyymmdd-cell"),
    ],
)
def test_an_all_digit_date_column_that_is_not_yyyymmdd_is_rejected_at_its_rows_never_read_as_1970(
    fmt: str, dates: list[str]
) -> None:
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    assert envelope["preview"]["date_range"][0] != "1970-01-01", envelope["preview"]
    assert (ONLY_THE_DATE_ERROR[0], 10 if "20231340" in dates else 1) in _rules_and_rows(envelope), envelope["errors"]
    assert "0000-00-00" not in json.dumps(envelope["preview"], default=str)


# Last-round review (WR-01, WR-02, SF-1, SF-2, SF-3). F4 read an integer date column
# as `%Y%m%d`, but strptime takes a one- or two-digit month and day, so a 6- or
# 7-digit integer was read by a guessed split (`2024121` as 2024-12-01) and a
# negative one parsed to a year below zero (`-20230305` is year -2023), which
# `validate_csv` then raised on at the preview. A float column (`20230305.0`, a
# spreadsheet export) skipped the branch and every date was read as 1970-01-01.
# Only an 8-digit non-negative whole number is a YYYYMMDD date; anything else in
# an integer or whole-number float column is reported at its own row.
def _yyyymmdd_with_a_seven_digit_typo() -> list[str]:
    return [f"202401{day:02d}" for day in range(1, 21)] + ["2024121"]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_whole_number_float_yyyymmdd_column_is_read_as_dates_not_as_1970(fmt: str) -> None:
    """`20230305.0` is how a spreadsheet export spells the same date."""
    envelope = validate_csv(_daily_file(fmt, [f"{d}.0" for d in _yyyymmdd_days(60)]), fmt)

    assert envelope["ok"] is True, envelope["errors"]
    assert envelope["preview"]["date_range"] == ["2023-03-05", "2023-05-03"], envelope["preview"]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_non_whole_float_in_a_yyyymmdd_column_is_a_date_error_at_its_row(fmt: str) -> None:
    dates = [f"{d}.0" for d in _yyyymmdd_days(59)] + ["20230505.5"]
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    assert envelope["preview"]["date_range"][0] != "1970-01-01", envelope["preview"]
    assert (ONLY_THE_DATE_ERROR[0], 60) in _rules_and_rows(envelope), envelope["errors"]
    assert "0000-00-00" not in json.dumps(envelope["preview"], default=str)


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_blank_in_a_float_yyyymmdd_column_is_still_reported_as_blank(fmt: str) -> None:
    """Control: a blank cell is a missing date, not an unreadable one."""
    dates = [f"{d}.0" for d in _yyyymmdd_days(59)] + [""]
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    assert ("not_nullable", 60) in _rules_and_rows(envelope), envelope["errors"]
    assert ONLY_THE_DATE_ERROR[0] not in {e["rule"] for e in envelope["errors"]}


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_seven_digit_date_among_yyyymmdd_dates_is_rejected_at_its_row(fmt: str) -> None:
    """`2024121` (a typo for `20240121`) was accepted as 2024-12-01."""
    envelope = validate_csv(_daily_file(fmt, _yyyymmdd_with_a_seven_digit_typo()), fmt)

    assert envelope["ok"] is False
    assert (ONLY_THE_DATE_ERROR[0], 21) in _rules_and_rows(envelope), envelope["errors"]
    assert envelope["preview"]["date_range"][1] != "2024-12-01", envelope["preview"]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
@pytest.mark.parametrize("row", [1, 6])
def test_a_negative_yyyymmdd_cell_returns_an_envelope_with_the_error_at_its_row(fmt: str, row: int) -> None:
    """`-20230305` parsed to year -2023 and `validate_csv` raised on it (a 500)."""
    dates = _yyyymmdd_days(10)
    dates[row - 1] = "-" + dates[row - 1]
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    assert (ONLY_THE_DATE_ERROR[0], row) in _rules_and_rows(envelope), envelope["errors"]
    assert "0000-00-00" not in json.dumps(envelope["preview"], default=str)


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_yyyymm_month_column_is_rejected_at_its_rows_not_read_as_january(fmt: str) -> None:
    """`202411` and `202412` were read as 1 and 2 January 2024."""
    dates = [f"{year}{month:02d}" for year in (2023, 2024) for month in range(1, 13)]
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    date_rows = {row for rule, row in _rules_and_rows(envelope) if rule == ONLY_THE_DATE_ERROR[0]}
    assert date_rows == set(range(1, 25)), envelope["errors"]
    assert envelope["preview"]["date_range"] != ["2023-01-01", "2024-01-02"], envelope["preview"]


# Last-round review WR-03 (MEDIUM, user-facing). A month-first (US) column with one
# year-first cell chose month-first correctly, then returned without writing its
# reading, so pandera re-parsed the raw text from the first cell's format and named
# no row (`coerce_dtype` at row 0). The day-first column with the same cell was
# accepted.
def _month_first_days(count: int) -> list[str]:
    import datetime as dt

    return [(dt.date(2024, 1, 1) + dt.timedelta(i)).strftime("%m/%d/%Y") for i in range(count)]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_a_year_first_cell_in_a_month_first_column_is_accepted_with_the_right_range(fmt: str) -> None:
    dates = _month_first_days(20)
    dates[13] = "2024-01-14"
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is True, envelope["errors"]
    assert envelope["preview"]["date_range"] == ["2024-01-01", "2024-01-20"], envelope["preview"]


@pytest.mark.parametrize("fmt", DAILY_FORMATS)
def test_an_unreadable_cell_beside_a_year_first_cell_in_a_month_first_column_is_reported_at_its_row(
    fmt: str,
) -> None:
    dates = _month_first_days(20)
    dates[13] = "2024-01-14"
    dates[15] = "garbage"
    envelope = validate_csv(_daily_file(fmt, dates), fmt)

    assert envelope["ok"] is False
    assert _rules_and_rows(envelope) == [(rule, 16) for rule in ONLY_THE_DATE_ERROR], envelope["errors"]
    assert "0000-00-00" not in json.dumps(envelope["preview"], default=str)


# Measured-fix round WR-01 (MEDIUM, never-raises). A whole-number float at or past
# 2^63 (`1e19`, `1e30`) passed the `% 1 == 0` test, and the cast to Int64 raised
# `TypeError`, which the router reports as "our side, try again" for a file that
# fails the same way every time. Such a cell is no YYYYMMDD date either.
@pytest.mark.parametrize("fmt", list(HEADER))
@pytest.mark.parametrize("cell", ["1e30", "1e19", "9.3e18", "-1e30", "1e300"])
def test_a_float_date_cell_past_the_int64_range_returns_an_envelope_with_the_error_at_its_row(
    fmt: str, cell: str
) -> None:
    envelope = validate_csv(_daily_file(fmt, ["20230305.0", cell, "20230307.0"]), fmt)

    assert envelope["ok"] is False
    assert (ONLY_THE_DATE_ERROR[0], 2) in _rules_and_rows(envelope), envelope["errors"]
    assert "0000-00-00" not in json.dumps(envelope["preview"], default=str)
