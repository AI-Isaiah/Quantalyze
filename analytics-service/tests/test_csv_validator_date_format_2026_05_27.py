"""Regression tests for the 2026-05-27 date-format auto-detection in
`services.csv_validator`.

Origin: the `date` column was coerced straight through pandas'
`pd.to_datetime` (via pandera `coerce=True`), which defaults to
MONTH-FIRST (US). Real-world broker / accounting exports are frequently
day-first (European `DD/MM/YYYY`, German `DD.MM.YYYY`). The old behaviour
mis-handled them in two ways:

  1. SILENT CORRUPTION — a day-first file where every day-of-month is
     <= 12 (e.g. "01/02/2023" meaning 1 Feb) parsed as 2 Jan. The wrong
     dates were still monotonically increasing, so NO validation error
     fired and the entire track record computed against the wrong
     calendar (garbage CAGR / Sharpe / time-weighting). This is the
     dangerous case — wrong numbers, no signal.
  2. CRYPTIC REJECTION — a day-first file with any day > 12 (e.g.
     "13/02/2023" meaning 13 Feb) could not be read month-first (no month
     13) and raised an opaque `dtype('datetime64[ns]')` pandera error
     with no actionable message.

The fix deduces the format FROM THE DATA: parse the column both
month-first and day-first, then pick the reading that yields a valid
ascending series. Year-first ISO (YYYY-MM-DD) is short-circuited (it is
unambiguous, and a day-first probe would falsely flip it to YYYY-DD-MM).
For the genuinely-ambiguous all-components-<=12 case, the daily-cadence
reading wins (a daily returns/NAV series is daily-spaced, so day-first
"01/02,02/02,03/02" = 1-3 Feb with a 1-day gap beats month-first
Jan2/Feb2/Mar2 with a ~29-day gap). Any non-default or ambiguity-resolved
pick emits a `date_format_normalized` info-flag for transparency; ISO and
US-month-first inputs are byte-for-byte unchanged and emit no flag.

These tests pin that contract. Each day-first test FAILS without the fix
(the dates come back in the wrong month, or the upload is rejected).
"""
from __future__ import annotations

import pandas as pd
import pytest

from services.csv_validator import validate_csv


def _csv(rows: list[tuple[str, str]], header: str = "date,daily_return") -> bytes:
    """Build raw CSV bytes from (date_string, return_string) rows.

    Uses literal strings — NOT a pandas round-trip — so the exact date
    bytes the customer would upload reach the validator unmodified.
    """
    body = "\n".join(f"{d},{r}" for d, r in rows)
    return f"{header}\n{body}\n".encode("utf-8")


def _dates(envelope: dict) -> list[str]:
    return [row["date"] for row in (envelope.get("daily_returns_series") or [])]


def _flag_rules(envelope: dict) -> set[str]:
    return {f["rule"] for f in (envelope.get("info_flags") or [])}


# ---------------------------------------------------------------------------
# ISO (year-first) — unchanged, NO flag. Pins the fix for the phantom-flag
# bug: a naive day-first probe flips "2023-02-01" to 2023-01-02 (YYYY-DD-MM),
# which is wrong-but-monotonic and would manufacture a false ambiguity.
# ---------------------------------------------------------------------------

def test_iso_dates_parse_correctly_and_emit_no_flag() -> None:
    env = validate_csv(
        _csv([("2023-02-01", "0.01"), ("2023-02-02", "0.02"), ("2023-02-03", "-0.01")]),
        "daily_returns",
    )
    assert env["ok"] is True, env.get("errors")
    assert _dates(env) == ["2023-02-01", "2023-02-02", "2023-02-03"]
    assert "date_format_normalized" not in _flag_rules(env), (
        "ISO is unambiguous and must NOT be flagged as a normalized/ambiguous "
        f"date format. Got info_flags={env.get('info_flags')}"
    )


def test_iso_slash_dates_unchanged() -> None:
    env = validate_csv(
        _csv([("2023/02/01", "0.01"), ("2023/02/02", "0.02"), ("2023/02/03", "-0.01")]),
        "daily_returns",
    )
    assert env["ok"] is True, env.get("errors")
    assert _dates(env) == ["2023-02-01", "2023-02-02", "2023-02-03"]
    assert "date_format_normalized" not in _flag_rules(env)


# ---------------------------------------------------------------------------
# US month-first with a day > 12 — only month-first parses, so behaviour is
# unchanged and NO flag is emitted (mirrors the real customer CSV that
# motivated this work: Poke-OKX, M/D/YYYY).
# ---------------------------------------------------------------------------

def test_us_month_first_with_day_over_12_unchanged_no_flag() -> None:
    env = validate_csv(
        _csv([("11/26/2023", "0.006"), ("11/27/2023", "-0.017"), ("11/28/2023", "-0.001")]),
        "daily_returns",
    )
    assert env["ok"] is True, env.get("errors")
    assert _dates(env) == ["2023-11-26", "2023-11-27", "2023-11-28"]
    assert "date_format_normalized" not in _flag_rules(env), (
        "Unambiguous US month-first (a day > 12 rules out day-first) must stay "
        "on the unchanged path with no info-flag."
    )


# ---------------------------------------------------------------------------
# Genuinely ambiguous dates (every component <= 12, both readings valid AND
# different) must be REJECTED, not guessed. The data cannot tell DD/MM from
# MM/DD; guessing silently mis-parses the whole series into the wrong calendar.
# A real >=20-day daily series always contains a day > 12 (unambiguous), so
# only short/sparse series reach this path.
# ---------------------------------------------------------------------------

def test_european_day_first_all_le_12_is_rejected_as_ambiguous() -> None:
    # 01/02,02/02,03/02 could be 1-3 Feb (day-first) OR Jan2/Feb2/Mar2
    # (month-first) — both monotonic. The pre-fix cadence tie-break silently
    # picked one; now we reject rather than risk corrupting the calendar.
    env = validate_csv(
        _csv([("01/02/2023", "0.01"), ("02/02/2023", "0.02"), ("03/02/2023", "-0.01")]),
        "daily_returns",
    )
    assert env["ok"] is False
    assert "date_format_ambiguous" in {e["rule"] for e in env["errors"]}, (
        f"Ambiguous all-<=12 dates must be rejected, not guessed. errors={env['errors']}"
    )
    assert env.get("daily_returns_series") is None


def test_monthly_day_first_ambiguous_is_rejected_not_silently_misread() -> None:
    """GAP-1 regression. A monthly day-first series (5th of Jan/Feb/Mar,
    European) whose WRONG month-first reading collapses to three consecutive
    days in May. The old daily-cadence tie-break picked the smaller-gap
    (month-first) reading and silently relabeled it — the exact silent
    corruption the feature was meant to prevent. Must now reject as ambiguous.
    """
    env = validate_csv(
        _csv([("05/01/2023", "0.01"), ("05/02/2023", "0.02"), ("05/03/2023", "-0.01")]),
        "daily_returns",
    )
    assert env["ok"] is False
    assert "date_format_ambiguous" in {e["rule"] for e in env["errors"]}, (
        f"A monthly day-first series must not be silently read as month-first "
        f"daily. errors={env['errors']}"
    )


def test_single_row_ambiguous_is_rejected_without_phantom_flag() -> None:
    """GAP-2. A 1-row all-<=12 file has no way to disambiguate and no cadence
    to lean on; it must be rejected (ambiguous), not emit a phantom
    date_format_normalized flag claiming a resolved guess."""
    env = validate_csv(_csv([("01/02/2023", "0.01")]), "daily_returns")
    assert env["ok"] is False
    assert "date_format_ambiguous" in {e["rule"] for e in env["errors"]}
    assert "date_format_normalized" not in _flag_rules(env)


# ---------------------------------------------------------------------------
# Day-first with a day > 12 — only day-first parses, so it is UNAMBIGUOUS:
# was a cryptic `dtype('datetime64[ns]')` rejection, must now parse cleanly to
# 12-14 February with a day-first flag.
# ---------------------------------------------------------------------------

def test_european_day_first_with_day_over_12_now_accepted() -> None:
    env = validate_csv(
        _csv([("12/02/2023", "0.01"), ("13/02/2023", "0.02"), ("14/02/2023", "-0.01")]),
        "daily_returns",
    )
    assert env["ok"] is True, (
        f"13/02/2023 (13 Feb) must no longer be rejected. errors={env.get('errors')}"
    )
    assert _dates(env) == ["2023-02-12", "2023-02-13", "2023-02-14"]
    date_flags = [f for f in (env.get("info_flags") or []) if f["rule"] == "date_format_normalized"]
    assert date_flags and date_flags[0]["detected_format"] == "day_first"


def test_german_dotted_day_first_parses() -> None:
    # 12.02 (Dec 2 month-first) then 13.02 breaks month-first monotonicity →
    # day-first is the only valid reading → unambiguous dotted European date.
    env = validate_csv(
        _csv([("12.02.2023", "0.01"), ("13.02.2023", "0.02"), ("14.02.2023", "-0.01")]),
        "daily_returns",
    )
    assert env["ok"] is True, env.get("errors")
    assert _dates(env) == ["2023-02-12", "2023-02-13", "2023-02-14"]
    assert "date_format_normalized" in _flag_rules(env)


# ---------------------------------------------------------------------------
# Output series is always ISO regardless of input format — the contract the
# downstream TS route boundary (`parseDailyReturnsSeries`, /^\d{4}-\d{2}-\d{2}$/)
# depends on.
# ---------------------------------------------------------------------------

def test_day_first_output_series_is_always_iso() -> None:
    env = validate_csv(
        _csv([("13/02/2023", "0.01"), ("14/02/2023", "0.02"), ("15/02/2023", "-0.01")]),
        "daily_returns",
    )
    assert env["ok"] is True
    import re

    iso = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    assert all(iso.match(d) for d in _dates(env)), (
        f"Every emitted series date must be YYYY-MM-DD; got {_dates(env)}"
    )


# ---------------------------------------------------------------------------
# daily_nav also carries a date column — detection must apply there too.
# ---------------------------------------------------------------------------

def test_daily_nav_day_first_is_normalized() -> None:
    env = validate_csv(
        _csv(
            [("12/02/2023", "100"), ("13/02/2023", "101"), ("14/02/2023", "102")],
            header="date,nav",
        ),
        "daily_nav",
    )
    assert env["ok"] is True, env.get("errors")
    # NAV -> pct_change drops the first row, so the series starts at 13 Feb.
    assert _dates(env) == ["2023-02-13", "2023-02-14"]
    assert "date_format_normalized" in _flag_rules(env)


# ---------------------------------------------------------------------------
# Unparseable dates must still fail (no speculative mutation, no crash) and
# emit no date flag — the existing error path is preserved.
# ---------------------------------------------------------------------------

def test_unparseable_dates_still_rejected_without_flag() -> None:
    env = validate_csv(
        _csv([("not-a-date", "0.01"), ("also-bad", "0.02")]),
        "daily_returns",
    )
    assert env["ok"] is False
    assert env.get("daily_returns_series") is None
    assert "date_format_normalized" not in _flag_rules(env)


# ---------------------------------------------------------------------------
# H1 — row cap (DoS): reject oversize row counts before the date double-parse.
# GAP-3 — a partially-unparseable column is rejected, not speculatively mutated.
# ---------------------------------------------------------------------------

def test_too_many_rows_is_rejected() -> None:
    import datetime as _dt

    from services.csv_validator import MAX_INGEST_ROWS

    base = _dt.date(2000, 1, 1)
    rows = [
        ((base + _dt.timedelta(days=i)).isoformat(), "0.001")
        for i in range(MAX_INGEST_ROWS + 5)
    ]
    env = validate_csv(_csv(rows), "daily_returns")
    assert env["ok"] is False
    assert "too_many_rows" in {e["rule"] for e in env["errors"]}


def test_partially_unparseable_dates_rejected_without_flag() -> None:
    # GAP-3 — one bad row among good ones: rejected, no speculative mutation,
    # no date flag (the existing pandera error path handles it).
    env = validate_csv(
        _csv([("01/02/2023", "0.01"), ("not-a-date", "0.02"), ("03/02/2023", "-0.01")]),
        "daily_returns",
    )
    assert env["ok"] is False
    assert env.get("daily_returns_series") is None
    assert "date_format_normalized" not in _flag_rules(env)


# ---------------------------------------------------------------------------
# CONN-06 (Phase 240) — a date written with an English month name inside a
# numeric-date column. A month name carries no day/month ambiguity, so it is
# read; pandas infers ONE format from the first cell, so before this the cell
# became NaT under both readings and was rejected as coerce_dtype at its row.
# ---------------------------------------------------------------------------

def _day_first_rows(n: int = 24) -> list[tuple[str, str]]:
    """n strictly increasing day-first rows from 01/03/2024 (a day above 12
    appears from the 13th row, so the day-first branch fires)."""
    import datetime as _dt

    base = _dt.date(2024, 3, 1)
    return [
        ((base + _dt.timedelta(days=i)).strftime("%d/%m/%Y"), f"{0.001 * ((i * 7) % 11 - 5):.4f}")
        for i in range(n)
    ]


def test_month_name_cell_mid_file_in_day_first_column_is_read() -> None:
    rows = _day_first_rows()
    # Row index 11 is 12/03/2024; write the same day with a month name.
    assert rows[11][0] == "12/03/2024"
    rows[11] = ("12 Mar 2024", rows[11][1])
    env = validate_csv(_csv(rows), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    dates = _dates(env)
    assert len(dates) == len(rows)
    assert dates == sorted(set(dates)), "dates must stay strictly increasing"
    assert dates[11] == "2024-03-12"
    assert dates[0] == "2024-03-01" and dates[-1] == "2024-03-24"


# --- Acceptance matrix: spelling x position x column format -----------------
# Eight strictly increasing days, 10..17 March 2024. Days 13..17 are above 12,
# so the DD/MM and MM/DD columns each have exactly one valid reading.

_ISO_DAYS = [f"2024-03-{d}" for d in ("10", "11", "12", "13", "14", "15", "16", "17")]
_NUMERIC_COLUMN = {
    "dmy": [f"{d}/03/2024" for d in ("10", "11", "12", "13", "14", "15", "16", "17")],
    "mdy": [f"03/{d}/2024" for d in ("10", "11", "12", "13", "14", "15", "16", "17")],
    "iso": _ISO_DAYS,
}
_RETURNS = ["0.001", "0.002", "-0.001", "0.003", "-0.002", "0.004", "-0.003", "0.002"]
_SPELLINGS = {
    "d_mon_y": lambda day: f"{day} Mar 2024",
    "d_mon_hyphen_y": lambda day: f"{day}-Mar-2024",
    "d_month_y": lambda day: f"{day} March 2024",
    "quoted_month_d_y": lambda day: f'"Mar {day}, 2024"',
}
_POSITIONS = {"first": 0, "mid": 3, "last": 7}


def _column_with_month_cell(column: str, spelling: str, index: int) -> list[str]:
    cells = list(_NUMERIC_COLUMN[column])
    cells[index] = _SPELLINGS[spelling](10 + index)
    return cells


@pytest.mark.parametrize("column", sorted(_NUMERIC_COLUMN))
@pytest.mark.parametrize("position", sorted(_POSITIONS))
@pytest.mark.parametrize("spelling", sorted(_SPELLINGS))
def test_month_name_cell_is_read_in_every_position_and_column_format(
    spelling: str, position: str, column: str
) -> None:
    cells = _column_with_month_cell(column, spelling, _POSITIONS[position])
    env = validate_csv(_csv(list(zip(cells, _RETURNS))), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    assert env["preview"]["row_count"] == 8
    assert env["preview"]["date_range"] == ["2024-03-10", "2024-03-17"]
    assert _dates(env) == _ISO_DAYS


@pytest.mark.parametrize("column", sorted(_NUMERIC_COLUMN))
@pytest.mark.parametrize("index", [0, 1, 6, 7])
def test_month_name_row_in_preview_has_the_form_of_its_neighbours(column: str, index: int) -> None:
    """UI-SPEC row 10: no date cell of the preview is raw month-name text while
    its neighbours are normalized."""
    cells = _column_with_month_cell(column, "d_mon_y", index)
    env = validate_csv(_csv(list(zip(cells, _RETURNS))), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    shown = [r["date"] for r in env["preview"]["first_rows"] + env["preview"]["last_rows"]]
    assert len({type(v) for v in shown}) == 1, shown
    assert {str(v)[:10] for v in shown} <= set(_ISO_DAYS), shown
    assert not any("Mar 2024" in str(v) for v in shown), shown


@pytest.mark.parametrize("column", sorted(_NUMERIC_COLUMN))
def test_month_name_cell_in_daily_nav_is_read(column: str) -> None:
    cells = _column_with_month_cell(column, "d_mon_y", 3)
    navs = ["100", "101", "103", "102", "104", "106", "105", "107"]
    env = validate_csv(_csv(list(zip(cells, navs)), header="date,nav"), "daily_nav")
    assert env["ok"] is True, env.get("errors")
    assert env["preview"]["row_count"] == 8
    assert env["preview"]["date_range"] == ["2024-03-10", "2024-03-17"]


def _trades_csv(date_cells: list[str]) -> bytes:
    """A valid trades file (the `_trades_df` fixture shape) with its date column
    replaced by the given literal cells. Copied from tests/test_csv_validator.py
    rather than imported, so this file keeps no collection coupling to it."""
    header = "date,side,qty,price,symbol,currency"
    body = "\n".join(f"{d},buy,1.0,100.0,BTC-USD,USD" for d in date_cells)
    return f"{header}\n{body}\n".encode("utf-8")


@pytest.mark.parametrize("column", sorted(_NUMERIC_COLUMN))
def test_month_name_cell_in_trades_is_read(column: str) -> None:
    env = validate_csv(_trades_csv(_column_with_month_cell(column, "d_mon_y", 3)), "trades")
    assert env["ok"] is True, env.get("errors")
    assert env["preview"]["row_count"] == 8
    assert env["preview"]["date_range"] == ["2024-03-10", "2024-03-17"]


# --- Rejections that must hold: the reading is never a guess ----------------

def _rejected_rows(env: dict, rule_prefix: str = "coerce_dtype") -> list[int]:
    return [e["row"] for e in env["errors"] if e["rule"].startswith(rule_prefix)]


@pytest.mark.parametrize("cell", ["12 Mar 24", "12 Mär 2024", "12 Mrz 2024"])
def test_unreadable_month_spelling_is_still_a_row_error(cell: str) -> None:
    rows = _day_first_rows()
    rows[11] = (cell, rows[11][1])
    env = validate_csv(_csv(rows), "daily_returns")
    assert env["ok"] is False
    assert _rejected_rows(env) == [12], env["errors"]
    assert env.get("daily_returns_series") is None


def test_month_name_cell_carrying_a_time_is_still_a_row_error_on_trades() -> None:
    cells = list(_NUMERIC_COLUMN["dmy"])
    cells[3] = "15 Jan 2024 10:00"
    env = validate_csv(_trades_csv(cells), "trades")
    assert env["ok"] is False
    assert _rejected_rows(env) == [4], env["errors"]


def test_impossible_month_name_day_is_still_a_row_error() -> None:
    rows = _day_first_rows()
    rows[11] = ("31 Feb 2024", rows[11][1])
    env = validate_csv(_csv(rows), "daily_returns")
    assert env["ok"] is False
    assert _rejected_rows(env) == [12], env["errors"]


def test_out_of_order_month_name_cell_is_reported_by_the_order_check() -> None:
    """Same report as any out-of-order numeric date: monotonic_dates, and that
    rule names row 0 for every date at HEAD (UI-SPEC's 'at its row' is narrower
    than the shipped rule)."""
    cells = list(_NUMERIC_COLUMN["dmy"])
    cells[3] = "01 Mar 2024"
    env = validate_csv(_csv(list(zip(cells, _RETURNS))), "daily_returns")
    assert env["ok"] is False
    assert [(e["rule"], e["row"]) for e in env["errors"] if e["rule"] == "monotonic_dates"] == [
        ("monotonic_dates", 0)
    ]
    numeric = list(_NUMERIC_COLUMN["dmy"])
    numeric[3] = "01/03/2024"
    env_numeric = validate_csv(_csv(list(zip(numeric, _RETURNS))), "daily_returns")
    assert [(e["rule"], e["row"]) for e in env_numeric["errors"]] == [("monotonic_dates", 0)]


@pytest.mark.parametrize(
    ("named", "numeric", "expected_rule"),
    [
        # Out of order, every day and month <= 12: neither reading is a clean ascending
        # series, so the "neither reading" exit is the one taken.
        (
            ["01/03/2024", "02/03/2024", "12 Mar 2024", "03/03/2024", "04/03/2024"],
            ["01/03/2024", "02/03/2024", "12/03/2024", "03/03/2024", "04/03/2024"],
            "monotonic_dates",
        ),
        # Both readings ascending and different: the "ambiguous" exit is the one taken.
        (
            ["01/02/2024", "03/04/2024", "12 Dec 2024"],
            ["01/02/2024", "03/04/2024", "12/12/2024"],
            "date_format_ambiguous",
        ),
    ],
    ids=["out_of_order", "ambiguous"],
)
def test_month_name_cell_on_a_rejecting_exit_gets_its_numeric_twins_errors(
    named: list[str], numeric: list[str], expected_rule: str
) -> None:
    """CONN-06: a month-name cell is parsed, so it is never the reason a file is
    rejected. On the two exits that reject the file (review WR-01) the cell was left
    as raw text and pandera failed it with `coerce_dtype`, naming a cell that is
    fine. The file must get exactly the errors its all-numeric twin gets."""
    returns = _RETURNS[: len(named)]
    env = validate_csv(_csv(list(zip(named, returns))), "daily_returns")
    env_numeric = validate_csv(_csv(list(zip(numeric, returns))), "daily_returns")
    assert env["ok"] is False
    assert expected_rule in {e["rule"] for e in env_numeric["errors"]}
    assert [(e["rule"], e["row"]) for e in env["errors"]] == [
        (e["rule"], e["row"]) for e in env_numeric["errors"]
    ]
    assert "coerce_dtype" not in {e["rule"] for e in env["errors"]}


def test_day_first_only_cell_on_a_rejecting_exit_is_not_blanked_by_the_month_first_write_back() -> None:
    """Review WR-01 round 2: the write-back keyed on a cell EITHER reading could read, so
    a cell only day-first can read (`25/03/2024`) went in as NaT and pandera reported
    `not_nullable` at a row the user filled in, and the preview showed NaT."""
    cells = ["01/02/2024", "25/03/2024", "03/25/2024", "12 Mar 2024", "05/06/2024"]
    env = validate_csv(_csv(list(zip(cells, _RETURNS))), "daily_returns")
    assert env["ok"] is False
    assert "not_nullable" not in {e["rule"] for e in env["errors"]}, env["errors"]
    assert not any(pd.isna(r["date"]) for r in env["preview"]["first_rows"]), env["preview"]


def test_blank_date_beside_a_month_name_cell_on_a_rejecting_exit_still_reports_not_nullable() -> None:
    cells = ["01/03/2024", "", "12 Mar 2024", "03/03/2024", "04/03/2024"]
    env = validate_csv(_csv(list(zip(cells, _RETURNS))), "daily_returns")
    assert env["ok"] is False
    assert [e["rule"] for e in env["errors"]].count("not_nullable") == 1, env["errors"]
    assert "coerce_dtype" not in {e["rule"] for e in env["errors"]}


# --- Edges ------------------------------------------------------------------

def test_column_entirely_month_names_is_accepted_with_no_flag_as_at_head() -> None:
    days = ["10", "11", "12", "13", "14"]
    env = validate_csv(
        _csv([(f"{d} Mar 2024", r) for d, r in zip(days, _RETURNS)]), "daily_returns"
    )
    assert env["ok"] is True, env.get("errors")
    assert _dates(env) == [f"2024-03-{d}" for d in days]
    assert not env.get("info_flags")


def test_single_row_month_name_file_is_accepted_with_no_flag_as_at_head() -> None:
    env = validate_csv(_csv([("10 Mar 2024", "0.001")]), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    assert _dates(env) == ["2024-03-10"]
    assert not env.get("info_flags")


def test_blank_date_beside_a_month_name_cell_still_reports_not_nullable() -> None:
    env = validate_csv(
        _csv([("13/03/2024", "0.001"), ("", "0.002"), ("15 Mar 2024", "-0.001"), ("16/03/2024", "0.003")]),
        "daily_returns",
    )
    assert env["ok"] is False
    assert [(e["rule"], e["row"]) for e in env["errors"]] == [("not_nullable", 2)]


# --- The flag message (UI-SPEC 1.3): true for the file it describes ----------
# Every sentence is typed here as a literal, never built from the module's helper.

_DAY_FIRST_SENTENCE = "Detected day-first (DD/MM/YYYY) dates and normalized them to YYYY-MM-DD."


def _date_flag(envelope: dict) -> dict:
    flags = [f for f in (envelope.get("info_flags") or []) if f["rule"] == "date_format_normalized"]
    assert len(flags) == 1, envelope.get("info_flags")
    return flags[0]


def _with_month_cells(cells: list[str], indexes: list[int]) -> list[str]:
    out = list(cells)
    for i in indexes:
        out[i] = f"{10 + i} Mar 2024"
    return out


def test_flag_day_first_column_with_one_month_cell() -> None:
    cells = _with_month_cells(_NUMERIC_COLUMN["dmy"], [3])
    env = validate_csv(_csv(list(zip(cells, _RETURNS))), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    flag = _date_flag(env)
    assert flag["detected_format"] == "day_first"
    assert flag["message"] == (
        "Detected day-first (DD/MM/YYYY) dates and normalized them to YYYY-MM-DD. "
        "Also read 1 date written with a month name (such as 12 Mar 2024)."
    )


def test_flag_day_first_column_with_three_month_cells() -> None:
    cells = _with_month_cells(_NUMERIC_COLUMN["dmy"], [1, 3, 6])
    env = validate_csv(_csv(list(zip(cells, _RETURNS))), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    assert _date_flag(env)["message"] == (
        "Detected day-first (DD/MM/YYYY) dates and normalized them to YYYY-MM-DD. "
        "Also read 3 dates written with a month name (such as 12 Mar 2024)."
    )


def test_flag_us_column_with_one_month_cell_carries_the_month_sentence_only() -> None:
    cells = _with_month_cells(_NUMERIC_COLUMN["mdy"], [3])
    env = validate_csv(_csv(list(zip(cells, _RETURNS))), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    assert _date_flag(env)["message"] == (
        "Read 1 date written with a month name (such as 12 Mar 2024) and normalized it to YYYY-MM-DD."
    )


def test_flag_iso_column_with_two_month_cells() -> None:
    cells = _with_month_cells(_NUMERIC_COLUMN["iso"], [2, 5])
    env = validate_csv(_csv(list(zip(cells, _RETURNS))), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    assert _date_flag(env)["message"] == (
        "Read 2 dates written with a month name (such as 12 Mar 2024) and normalized them to YYYY-MM-DD."
    )


@pytest.mark.parametrize("column", ["mdy", "iso"])
def test_flag_count_prints_with_a_thousands_separator(column: str) -> None:
    import datetime as _dt

    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    start = _dt.date(2021, 1, 1)
    days = [start + _dt.timedelta(days=i) for i in range(1001)]
    # The one numeric cell is the last row, written so that no day-first reading exists.
    numeric = days[-1].strftime("%m/%d/%Y") if column == "mdy" else days[-1].isoformat()
    cells = [f"{d.day} {months[d.month - 1]} {d.year}" for d in days[:-1]] + [numeric]
    returns = [f"{0.001 * ((i * 7) % 11 - 5):.4f}" for i in range(1001)]
    env = validate_csv(_csv(list(zip(cells, returns))), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    assert _date_flag(env)["message"] == (
        "Read 1,000 dates written with a month name (such as 12 Mar 2024) and normalized them to YYYY-MM-DD."
    )


def test_flag_day_first_without_a_month_cell_is_byte_identical_to_head() -> None:
    env = validate_csv(_csv(list(zip(_NUMERIC_COLUMN["dmy"], _RETURNS))), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    assert _date_flag(env) == {
        "rule": "date_format_normalized",
        "detected_format": "day_first",
        "message": _DAY_FIRST_SENTENCE,
    }


@pytest.mark.parametrize("column", ["mdy", "iso"])
def test_no_date_flag_without_a_month_cell_in_us_or_iso_columns(column: str) -> None:
    env = validate_csv(_csv(list(zip(_NUMERIC_COLUMN[column], _RETURNS))), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    assert "date_format_normalized" not in _flag_rules(env)


def test_flag_message_carries_no_cell_from_the_file() -> None:
    cells = list(_NUMERIC_COLUMN["dmy"])
    cells[4] = "14 Mar 2024"
    env = validate_csv(_csv(list(zip(cells, _RETURNS))), "daily_returns")
    assert env["ok"] is True, env.get("errors")
    message = _date_flag(env)["message"]
    assert "such as 12 Mar 2024" in message
    assert "14 Mar 2024" not in message and "14/03/2024" not in message
