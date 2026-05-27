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
# THE critical regression: day-first, every component <= 12. Without the fix
# this silently parsed as month-first (Jan 2 / Feb 2 / Mar 2) with NO error.
# The fix must return three CONSECUTIVE days in February.
# ---------------------------------------------------------------------------

def test_european_day_first_all_le_12_is_not_silently_corrupted() -> None:
    env = validate_csv(
        _csv([("01/02/2023", "0.01"), ("02/02/2023", "0.02"), ("03/02/2023", "-0.01")]),
        "daily_returns",
    )
    assert env["ok"] is True, env.get("errors")
    # 1-3 February (day-first) — NOT 2 Jan / 2 Feb / 2 Mar (the old month-first
    # mis-parse). This assertion fails on the pre-fix code.
    assert _dates(env) == ["2023-02-01", "2023-02-02", "2023-02-03"], (
        "Day-first dates with all components <= 12 must be read as consecutive "
        "days (daily cadence), not spread across three months by the month-first "
        f"default. Got {_dates(env)}"
    )
    flags = env.get("info_flags") or []
    date_flags = [f for f in flags if f["rule"] == "date_format_normalized"]
    assert date_flags, "An ambiguous day-first resolution must surface a transparency flag."
    assert date_flags[0]["detected_format"] == "day_first"
    assert date_flags[0]["ambiguous"] is True


# ---------------------------------------------------------------------------
# Day-first with a day > 12 — was a cryptic `dtype('datetime64[ns]')`
# rejection; must now parse cleanly to 12-14 February with a (non-ambiguous)
# day-first flag.
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
    # A day > 12 makes month-first impossible, so this is unambiguous, not a
    # cadence-resolved tie.
    assert date_flags[0]["ambiguous"] is False


def test_german_dotted_day_first_parses() -> None:
    env = validate_csv(
        _csv([("01.02.2023", "0.01"), ("02.02.2023", "0.02"), ("03.02.2023", "-0.01")]),
        "daily_returns",
    )
    assert env["ok"] is True, env.get("errors")
    assert _dates(env) == ["2023-02-01", "2023-02-02", "2023-02-03"]
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
