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
    df = _daily_returns_df(n=5)
    df.loc[1, "daily_return"] = -1.5  # row 2 — impossible to lose >100%
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is False
    rules = {e["rule"] for e in result["errors"]}
    assert "daily_return_lower_bound" in rules


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

def test_pii_redaction_masks_sensitive_columns():
    """Preview rows must mask values whose column names match the PII pattern.

    Column names matching /^.*(account|email|user|customer|wallet|address).*$/i
    are masked to '***'. Numeric and date columns pass through unchanged.

    Underlying validation runs on the unredacted DataFrame; only the preview
    serialization gets masked.
    """
    df = pd.DataFrame({
        "date": pd.date_range("2024-01-02", periods=5, freq="D").strftime("%Y-%m-%d"),
        "daily_return": [0.001] * 5,
        "account": ["acct-12345", "acct-67890", "acct-abcde", "acct-fghij", "acct-klmno"],
        "customer_email": ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"],
        "wallet_address": ["0xabc", "0xdef", "0x111", "0x222", "0x333"],
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is True, f"Expected ok=True, got errors: {result.get('errors')}"

    preview = result["preview"]
    assert preview is not None

    # Every row in first_rows + last_rows must have masked PII columns
    for row in [*preview["first_rows"], *preview["last_rows"]]:
        assert row["account"] == "***", f"account not masked: {row['account']!r}"
        assert row["customer_email"] == "***", f"customer_email not masked: {row['customer_email']!r}"
        assert row["wallet_address"] == "***", f"wallet_address not masked: {row['wallet_address']!r}"
        # Numeric / date columns pass through unchanged
        assert row["daily_return"] == 0.001
        assert row["date"]  # non-empty
