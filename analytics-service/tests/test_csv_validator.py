"""
Phase 15 / CSV-01..CSV-02: tests for the pandera-backed CSV validator.

11 tests covering:
- 6 CSV-02 rules (monotonic_dates, nav_non_zero, daily_return_lower_bound,
  daily_sharpe_sentinel — covered by integration; currency_usd_or_blank,
  qty_price_positive)
- empty bytes early-return
- happy-path daily_returns success envelope
- ValueError on unsupported fmt
- correlation_id None slot present on every return path
- weekend dates pass (regression — `_check_trading_window` was DROPPED 2026-04-30)
- PII redaction in preview rows (cross-AI revision 2026-04-30)
"""
from __future__ import annotations

import pandas as pd
import pytest

from services.csv_validator import validate_csv


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _csv_bytes(df: pd.DataFrame) -> bytes:
    """Render a DataFrame to CSV bytes for validate_csv()."""
    return df.to_csv(index=False).encode("utf-8")


def _daily_returns_df(
    n: int = 5,
    start: str = "2024-01-02",  # Tuesday — weekday baseline
    daily_return: float = 0.001,
) -> pd.DataFrame:
    """Fabricate a monotonic, valid daily_returns CSV body."""
    return pd.DataFrame({
        "date": pd.date_range(start, periods=n, freq="D").strftime("%Y-%m-%d"),
        "daily_return": [daily_return] * n,
    })


def _daily_nav_df(n: int = 5, start: str = "2024-01-02") -> pd.DataFrame:
    return pd.DataFrame({
        "date": pd.date_range(start, periods=n, freq="D").strftime("%Y-%m-%d"),
        "nav": [100.0 + i for i in range(n)],
    })


def _trades_df(n: int = 5, start: str = "2024-01-02") -> pd.DataFrame:
    return pd.DataFrame({
        "date": pd.date_range(start, periods=n, freq="D").strftime("%Y-%m-%d"),
        "side": ["buy"] * n,
        "qty": [1.0] * n,
        "price": [100.0] * n,
        "symbol": ["BTC-USD"] * n,
        "currency": ["USD"] * n,
    })


# ---------------------------------------------------------------------------
# Test 1 — empty bytes → ok=False with errors[0].rule == 'empty'
# ---------------------------------------------------------------------------

def test_empty_bytes_returns_empty_rule():
    result = validate_csv(b"", "daily_returns")
    assert result["ok"] is False
    assert result["errors"]
    assert result["errors"][0]["rule"] == "empty"
    assert result["correlation_id"] is None


# ---------------------------------------------------------------------------
# Test 2 — valid daily_returns CSV with 5 monotonic dates → ok=True
# ---------------------------------------------------------------------------

def test_valid_daily_returns_passes():
    df = _daily_returns_df(n=5)
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is True, f"Expected ok=True, got errors: {result.get('errors')}"
    assert result["preview"] is not None
    assert result["preview"]["row_count"] == 5
    # date_range is [first, last] non-empty strings
    assert result["preview"]["date_range"][0]
    assert result["preview"]["date_range"][1]
    assert result["correlation_id"] is None


# ---------------------------------------------------------------------------
# Test 3 — date going backward at row 5 → monotonic_dates rule
# ---------------------------------------------------------------------------

def test_monotonic_dates_violation():
    df = pd.DataFrame({
        "date": [
            "2024-01-02",
            "2024-01-03",
            "2024-01-04",
            "2024-01-05",
            "2024-01-03",  # backward at row 5 (1-based)
        ],
        "daily_return": [0.001] * 5,
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is False
    rules = {e["rule"] for e in result["errors"]}
    assert "monotonic_dates" in rules


# ---------------------------------------------------------------------------
# Test 4 — NAV=0 at row 3 → nav_non_zero rule
# ---------------------------------------------------------------------------

def test_nav_non_zero_violation():
    df = _daily_nav_df(n=5)
    df.loc[2, "nav"] = 0.0  # row 3 (0-based index 2)
    result = validate_csv(_csv_bytes(df), "daily_nav")
    assert result["ok"] is False
    rules = {e["rule"] for e in result["errors"]}
    assert "nav_non_zero" in rules


# ---------------------------------------------------------------------------
# Test 5 — daily_return=-1.5 at row 2 → daily_return_lower_bound rule
# ---------------------------------------------------------------------------

def test_daily_return_lower_bound_violation():
    # Bound is -100.0 (see csv_validator.py — widened 2026-05-07 to admit
    # percent-form CSVs and leveraged decimal returns). Use -150.0 so the
    # check still fires; this is sentinel-class garbage, not real data.
    df = _daily_returns_df(n=5)
    df.loc[1, "daily_return"] = -150.0
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is False
    rules = {e["rule"] for e in result["errors"]}
    assert "daily_return_lower_bound" in rules


def test_daily_return_accepts_negative_below_minus_one():
    # Regression: a -1.5 daily return must validate cleanly under the
    # widened bound. Pre-2026-05-07 this would have failed
    # daily_return_lower_bound; founder UAT (IQSF QuantumAlpha) blocked
    # because of it.
    df = _daily_returns_df(n=5)
    df.loc[1, "daily_return"] = -1.5
    result = validate_csv(_csv_bytes(df), "daily_returns")
    rules = {e["rule"] for e in result["errors"]}
    assert "daily_return_lower_bound" not in rules


# QA report 2026-05-21 ISSUE-008. A user uploaded a `pnl` column
# (renamed to `daily_return`) with raw dollar PnL values — typical row
# values around |3.0|, which sit between the -100.0 floor and infinity
# so no per-row rule fires. The dataset-level sentinel detects the
# whole series by its median absolute value and flags it so the user
# can fix the unit rather than have it slip into the analytics pipeline
# and produce nonsense CAGR / Sharpe / Max DD downstream.
def test_dollar_form_daily_return_caught_by_sentinel():
    # Median(|x|) ~= 3.0 — well above the 0.5 threshold.
    df = pd.DataFrame({
        "date": pd.date_range("2024-01-02", periods=20, freq="D").strftime(
            "%Y-%m-%d",
        ),
        "daily_return": [
            -3.29, 1.71, -2.40, 4.10, -1.95, 2.55, -3.10, 1.20, -2.65, 3.85,
            -1.50, 2.10, -3.45, 4.25, -1.85, 2.95, -3.20, 1.65, -2.85, 3.05,
        ],
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    rules = {e["rule"] for e in result["errors"]}
    assert "daily_return_dollar_form_sentinel" in rules
    assert result["ok"] is False
    # The error message has to be actionable — tell the user this looks
    # like dollar PnL and how to convert it.
    msg = next(
        e["message"] for e in result["errors"]
        if e["rule"] == "daily_return_dollar_form_sentinel"
    )
    assert "decimal" in msg.lower() or "dollar" in msg.lower()


def test_dollar_form_sentinel_lets_normal_decimal_returns_through():
    # Regression: a plain decimal-return series with daily moves around
    # |0.01| must validate cleanly (the median absolute value sits well
    # below the 0.5 threshold).
    df = _daily_returns_df(n=20, daily_return=0.01)
    result = validate_csv(_csv_bytes(df), "daily_returns")
    rules = {e["rule"] for e in result["errors"]}
    assert "daily_return_dollar_form_sentinel" not in rules


def test_dollar_form_sentinel_lets_leveraged_decimal_returns_through():
    # Regression: a leveraged decimal-return series that occasionally
    # dips below -1.0 still passes the sentinel — the median absolute
    # value is what matters, not the extremes. This protects the
    # widening done on 2026-05-07 for leveraged strategies.
    df = pd.DataFrame({
        "date": pd.date_range("2024-01-02", periods=20, freq="D").strftime(
            "%Y-%m-%d",
        ),
        # Mostly small daily moves, two extreme leverage days.
        "daily_return": (
            [0.02, -0.01, 0.015, -0.025, 0.018, -0.02, 0.022, -0.014]
            + [-1.5, -1.2]  # two extreme leveraged days
            + [0.019, -0.013, 0.024, -0.021, 0.011, -0.017, 0.026, -0.012]
            + [0.029, -0.018]
        ),
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    rules = {e["rule"] for e in result["errors"]}
    assert "daily_return_dollar_form_sentinel" not in rules


# ---------------------------------------------------------------------------
# Test 6 — currency='EUR' at row 4 (trades) → currency_usd_or_blank rule
# ---------------------------------------------------------------------------

def test_currency_usd_or_blank_violation():
    df = _trades_df(n=5)
    df.loc[3, "currency"] = "EUR"  # row 4
    result = validate_csv(_csv_bytes(df), "trades")
    assert result["ok"] is False
    rules = {e["rule"] for e in result["errors"]}
    assert "currency_usd_or_blank" in rules


# ---------------------------------------------------------------------------
# Test 7 — BOTH monotonic_dates AND nav_non_zero violations (lazy collection)
# ---------------------------------------------------------------------------

def test_lazy_error_collection_returns_both_violations():
    df = _daily_nav_df(n=5)
    # Inject TWO violations:
    df.loc[2, "nav"] = 0.0  # nav_non_zero
    df.loc[4, "date"] = "2024-01-02"  # monotonic_dates (backward at last row)
    result = validate_csv(_csv_bytes(df), "daily_nav")
    assert result["ok"] is False
    rules = {e["rule"] for e in result["errors"]}
    assert "monotonic_dates" in rules
    assert "nav_non_zero" in rules


# ---------------------------------------------------------------------------
# Test 8 — invalid fmt raises ValueError
# ---------------------------------------------------------------------------

def test_invalid_fmt_raises_valueerror():
    with pytest.raises(ValueError):
        validate_csv(b"date,daily_return\n2024-01-02,0.001", "invalid_fmt")


# ---------------------------------------------------------------------------
# Test 9 — every envelope return path includes correlation_id=None
# ---------------------------------------------------------------------------

def test_correlation_id_slot_always_present():
    # success path
    ok_envelope = validate_csv(_csv_bytes(_daily_returns_df()), "daily_returns")
    assert "correlation_id" in ok_envelope
    assert ok_envelope["correlation_id"] is None

    # empty path
    empty_envelope = validate_csv(b"", "daily_returns")
    assert "correlation_id" in empty_envelope
    assert empty_envelope["correlation_id"] is None

    # validation-fail path
    bad = _daily_returns_df(n=5)
    bad.loc[1, "daily_return"] = -1.5
    fail_envelope = validate_csv(_csv_bytes(bad), "daily_returns")
    assert "correlation_id" in fail_envelope
    assert fail_envelope["correlation_id"] is None


# ---------------------------------------------------------------------------
# Test 10 — weekend dates pass (regression: trading_window dropped 2026-04-30)
# ---------------------------------------------------------------------------

def test_weekend_dates_pass_regression():
    """A CSV with all weekend dates and otherwise valid daily_returns must pass.

    `_check_trading_window` was DROPPED 2026-04-30 because crypto trades 24/7.
    This test fails if the rule is ever re-added.
    """
    # 2024-01-06 (Sat), 07 (Sun), 13 (Sat), 14 (Sun), 20 (Sat) — all weekend
    df = pd.DataFrame({
        "date": [
            "2024-01-06",
            "2024-01-07",
            "2024-01-13",
            "2024-01-14",
            "2024-01-20",
        ],
        "daily_return": [0.001, 0.002, -0.001, 0.003, -0.002],
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is True, (
        f"Weekend-only CSV must pass (trading_window rule dropped 2026-04-30). "
        f"Got errors: {result.get('errors')}"
    )
    rules = {e["rule"] for e in result["errors"]}
    assert "trading_window" not in rules


# ---------------------------------------------------------------------------
# Test 11 — PII redaction in preview.first_rows + preview.last_rows
# ---------------------------------------------------------------------------

def test_pii_undeclared_columns_dropped_from_preview():
    """Undeclared columns (potentially PII) must be DROPPED from the preview.

    Adversarial-review fix 2026-05-02: schema.strict='filter' drops undeclared
    columns from the validated DataFrame. Defense-in-depth: the preview
    projection is also restricted to declared schema columns so undeclared
    columns the redact regex does NOT match (e.g. 'ssn', 'phone_number') can
    never reach the UI either. The earlier behavior masked recognized PII
    column names in place but leaked unrecognized ones.

    Underlying validation still runs on the original DataFrame; only the
    preview serialization is filtered.
    """
    df = pd.DataFrame({
        "date": pd.date_range("2024-01-02", periods=5, freq="D").strftime("%Y-%m-%d"),
        "daily_return": [0.001] * 5,
        "account": ["acct-12345", "acct-67890", "acct-abcde", "acct-fghij", "acct-klmno"],
        "customer_email": ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"],
        "wallet_address": ["0xabc", "0xdef", "0x111", "0x222", "0x333"],
        "ssn": ["111-22-3333"] * 5,  # NOT matched by PII regex; pre-fix would leak.
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is True, f"Expected ok=True, got errors: {result.get('errors')}"

    preview = result["preview"]
    assert preview is not None

    # `columns_detected` and preview rows must contain ONLY declared columns.
    declared = {"date", "daily_return", "currency"}
    assert set(preview["columns_detected"]).issubset(declared), (
        f"Preview leaked undeclared columns: {preview['columns_detected']!r}"
    )
    for row in [*preview["first_rows"], *preview["last_rows"]]:
        assert "account" not in row, "account leaked into preview row"
        assert "customer_email" not in row, "customer_email leaked into preview row"
        assert "wallet_address" not in row, "wallet_address leaked into preview row"
        assert "ssn" not in row, "ssn leaked into preview row"
        # Declared columns pass through unchanged
        assert row["daily_return"] == 0.001
        assert row["date"]  # non-empty


def test_redact_preview_masks_declared_pii_named_column():
    """If a declared schema column happens to match the PII regex, its values
    are still masked at the preview layer (defense in depth).

    The existing schema declares only date / daily_return / currency / nav /
    qty / price / symbol / side, none of which match the PII regex. This test
    exercises the `_redact_preview` helper directly to verify the masking
    contract has not regressed.
    """
    from services.csv_validator import _redact_preview

    rows = [{"date": "2024-01-02", "user_id": "u-123", "daily_return": 0.01}]
    masked = _redact_preview(rows)
    assert masked[0]["user_id"] == "***"
    assert masked[0]["date"] == "2024-01-02"
    assert masked[0]["daily_return"] == 0.01


# ---------------------------------------------------------------------------
# Test 13 — duplicate consecutive dates fail strict-monotonic check
# (regression for adversarial-review fix 2026-05-02; pandas
# `is_monotonic_increasing` accepts equal consecutive values which would
# silently double-count days downstream).
# ---------------------------------------------------------------------------

def test_strictly_increasing_rejects_duplicate_dates():
    df = pd.DataFrame({
        "date": ["2024-01-02", "2024-01-03", "2024-01-03", "2024-01-04"],
        "daily_return": [0.01, 0.02, 0.03, 0.04],
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is False, "Duplicate dates must fail validation"
    rules = {e["rule"] for e in result["errors"]}
    assert "monotonic_dates" in rules, (
        f"Expected monotonic_dates violation, got rules: {rules}"
    )


# ---------------------------------------------------------------------------
# Phase 19.1 / CSV → analytics pipeline Task 4. validate_csv() envelope must
# include the full daily-return series for ok=True daily_returns and
# daily_nav uploads so the wizard can forward it to csv-finalize for
# persistence. Trades format omits the key entirely.
# Re-derived from PR #270 commit 8611ae1c.
# ---------------------------------------------------------------------------

def test_validate_envelope_includes_daily_returns_series_for_daily_returns():
    """Test 1 — daily_returns format: series is the validated rows verbatim,
    each entry shaped {"date": "YYYY-MM-DD", "daily_return": float}."""
    # Varied returns to stay below the 10.0 daily Sharpe sentinel.
    df = pd.DataFrame({
        "date": pd.date_range("2024-01-02", periods=10, freq="D").strftime("%Y-%m-%d"),
        "daily_return": [0.001, 0.002, 0.003, 0.001, 0.002,
                         0.003, 0.001, 0.002, 0.003, 0.001],
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is True
    assert "daily_returns_series" in result
    series = result["daily_returns_series"]
    assert len(series) == 10
    for row in series:
        assert "date" in row
        assert "daily_return" in row
        assert isinstance(row["daily_return"], float)


def test_validate_envelope_includes_daily_returns_series_for_daily_nav():
    """Test 2 — daily_nav format: series equals pct_change().dropna() of NAV,
    so an N-row NAV input produces an N-1 row return series."""
    df = _daily_nav_df(n=5)
    result = validate_csv(_csv_bytes(df), "daily_nav")
    assert result["ok"] is True
    assert "daily_returns_series" in result
    series = result["daily_returns_series"]
    assert len(series) == 4  # 5 NAV rows - 1 (first pct_change is NaN, dropped)
    # First derived return: (101 - 100) / 100 = 0.01
    assert abs(series[0]["daily_return"] - 0.01) < 1e-9


def test_validate_envelope_omits_daily_returns_series_for_trades():
    """Test 3 — trades format: key absent from envelope (not present, not None)."""
    df = _trades_df(n=5)
    result = validate_csv(_csv_bytes(df), "trades")
    # trades format produces no daily-return series — Phase 19.1 reserves
    # the new pipeline for daily_returns + daily_nav uploads only.
    assert "daily_returns_series" not in result


def test_validate_envelope_daily_returns_series_handles_sparse_calendar():
    """Test 4 — a series that skips weekends round-trips through
    daily_returns_series without raising. compute_all_metrics downstream
    must accept gappy daily series, which means the envelope must too."""
    # 5 weekday-only rows over 7 calendar days (Mon-Fri).
    dates = ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12"]
    df = pd.DataFrame({
        "date": dates,
        "daily_return": [0.001, 0.002, -0.001, 0.003, 0.002],
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is True, f"Expected ok=True, errors: {result.get('errors')}"
    assert "daily_returns_series" in result
    series = result["daily_returns_series"]
    assert len(series) == 5
    # All five dates must be present in the envelope verbatim.
    series_dates = {row["date"] for row in series}
    assert series_dates == set(dates)


def test_validate_envelope_daily_returns_series_stringifies_dates():
    """Test 5 — when the validated DataFrame holds the date column as
    pd.Timestamp / datetime.date objects (which pandera coerces it to),
    daily_returns_series[i]["date"] must be the YYYY-MM-DD string form,
    not the typed object. Downstream JSON serialization depends on this."""
    df = pd.DataFrame({
        "date": pd.date_range("2024-01-02", periods=3, freq="D").strftime("%Y-%m-%d"),
        "daily_return": [0.001, 0.002, 0.003],
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is True
    assert "daily_returns_series" in result
    for row in result["daily_returns_series"]:
        assert isinstance(row["date"], str), (
            f"date must be str, got {type(row['date']).__name__}: {row['date']!r}"
        )
        # Must match YYYY-MM-DD pattern exactly.
        import re
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", row["date"]), (
            f"date {row['date']!r} not in YYYY-MM-DD form"
        )
