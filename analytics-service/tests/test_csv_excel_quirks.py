"""Regression coverage for real-world Excel/accounting-tool CSV exports.

The IQSF QuantumAlpha and UC244 FXDaily founder UAT submissions both shipped
with cosmetic decoration that pandas read_csv preserves as strings:

    * Leading all-empty header row (",,,,,,") above the real headers
    * Currency-formatted values: "$9,994,084.29"
    * Percent-formatted values: "-0.06%"
    * Wrapped-paren negatives: "(123.45)" (Excel default)

Pandera's coerce=True can't parse those, so without the scrub the founder
hits column_in_dataframe with no actionable feedback. These tests pin the
scrub + leading-blank-row handling so the gates can't silently regress.
"""
from __future__ import annotations

import io

import pandas as pd

from services.csv_validator import (
    _coerce_numeric_string,
    _scrub_numeric_columns,
    validate_csv,
)


# ---------------------------------------------------------------------------
# Unit: _coerce_numeric_string
# ---------------------------------------------------------------------------

def test_coerce_strips_dollar_and_thousands():
    assert _coerce_numeric_string("$9,994,084.29") == 9994084.29


def test_coerce_strips_negative_dollar():
    assert _coerce_numeric_string("-$5,915.71") == -5915.71


def test_coerce_handles_paren_negative():
    # Excel default for negatives in the accounting profile.
    assert _coerce_numeric_string("(1,234.50)") == -1234.50


def test_coerce_strips_percent_and_divides():
    # Percent suffix → decimal (5.5% → 0.055).
    assert _coerce_numeric_string("-0.06%") == -0.0006


def test_coerce_passes_plain_float_through():
    assert _coerce_numeric_string(3.14) == 3.14
    assert _coerce_numeric_string("3.14") == 3.14


def test_coerce_leaves_unrecognized_shape_alone():
    # Garbage stays garbage so pandera can raise a precise per-row error.
    out = _coerce_numeric_string("not-a-number")
    assert out == "not-a-number"


# ---------------------------------------------------------------------------
# End-to-end: validate_csv on a real Excel-shaped daily_nav export
# ---------------------------------------------------------------------------

def test_validate_csv_skips_leading_blank_header_row():
    """UC244 FXDaily ships with a `,,,,,,` row above the real headers.
    Pre-fix this caused every column to read as Unnamed:N → schema rejected
    with column_in_dataframe and no useful guidance."""
    raw = (
        b",,,,,,\n"
        b",Date,NAV,Daily ROI%,Daily P&L,Drawdown,Log Return\n"
        b",2026-01-01,\"$9,994,084.29\",-0.06%,\"-$5,915.71\",0.00%,-0.0006\n"
        b",2026-01-02,\"$10,004,272.89\",0.10%,\"$10,188.60\",0.00%,0.0010\n"
        b",2026-01-05,\"$10,012,239.07\",0.08%,\"$7,966.18\",0.00%,0.0008\n"
        b",2026-01-06,\"$10,019,500.00\",0.07%,\"$7,261.00\",0.00%,0.0007\n"
        b",2026-01-07,\"$10,025,000.00\",0.05%,\"$5,500.00\",0.00%,0.0005\n"
    )
    result = validate_csv(raw, "daily_nav")
    assert result["ok"] is True, f"errors: {result['errors']}"
    assert result["preview"]["row_count"] == 5
    # NAV decoration scrubbed → real numeric value reaches the preview.
    first = result["preview"]["first_rows"][0]
    assert first["nav"] == 9994084.29


def test_validate_csv_currency_decoration_on_daily_nav():
    """Plain currency-formatted NAV without the leading blank row."""
    raw = (
        b"Date,NAV\n"
        b"2026-01-02,\"$1,000,000.00\"\n"
        b"2026-01-03,\"$1,005,000.00\"\n"
        b"2026-01-04,\"$1,010,000.00\"\n"
        b"2026-01-05,\"$1,015,000.00\"\n"
        b"2026-01-06,\"$1,020,000.00\"\n"
    )
    result = validate_csv(raw, "daily_nav")
    assert result["ok"] is True, f"errors: {result['errors']}"
    assert result["preview"]["first_rows"][0]["nav"] == 1_000_000.00


def test_validate_csv_percent_decoration_on_daily_returns():
    """Percent-suffix daily_return values are divided by 100 so the
    downstream analytics layer sees decimals."""
    raw = (
        b"date,daily_return\n"
        b"2026-01-02,0.10%\n"
        b"2026-01-03,-0.06%\n"
        b"2026-01-04,5.50%\n"
        b"2026-01-05,-0.20%\n"
        b"2026-01-06,0.30%\n"
    )
    result = validate_csv(raw, "daily_returns")
    assert result["ok"] is True, f"errors: {result['errors']}"
    rows = result["preview"]["first_rows"]
    # 5.50% → 0.055, -0.06% → -0.0006
    assert rows[0]["daily_return"] == 0.001
    assert rows[1]["daily_return"] == -0.0006


def test_unrelated_string_columns_untouched():
    """The scrub only targets float-typed schema columns. side / symbol /
    currency are str — must pass through unchanged so pandera's
    string-shape checks still fire on bad data."""
    df = pd.DataFrame({
        "date": pd.to_datetime(["2024-01-02", "2024-01-03"]),
        "qty": ["1,000", "2,000"],          # float col — should scrub
        "price": ["$1.50", "$1.55"],         # float col — should scrub
        "side": ["buy", "sell"],             # str col — leave alone
        "symbol": ["AAPL", "GOOG"],          # str col — leave alone
        "currency": ["USD", "USD"],
    })
    _scrub_numeric_columns(df, "trades")
    assert df.loc[0, "qty"] == 1000.0
    assert df.loc[0, "price"] == 1.50
    assert df.loc[0, "side"] == "buy"
    assert df.loc[0, "symbol"] == "AAPL"
