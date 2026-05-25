"""Regression tests for the 2026-05-25 percent-form auto-normalization in
`services.csv_validator`.

Origin: the production `break-momentum` strategy (MM_dailies_0.5risk CSV)
uploaded clean through the wizard at v0.24.7.2 — the analytics worker
returned a CAGR of 5.3 million percent and a Max DD of -34,000% on a
1,112-row file. The values in the file are uniformly in percent-form
without a `%` sign (median |x| over non-zero rows = 0.904; clearly not
decimal returns), but the existing dollar-form sentinel missed it
because the file is ~50% zero-padded (the strategy started with months
of no-trade days), and `dropna()` does not drop zeros — so the median
over the full series collapses to 0 and the 0.5 threshold isn't tripped.

The 2026-05-25 fix:
  1. `_check_dollar_form_sentinel` switches to the median over **non-zero**
     values when enough non-zero samples exist (>= 2). This is what
     allocators would expect: a strategy's daily-return scale is meaningful
     on trading days, not on zero-padded pre-trading days.
  2. A new `_maybe_auto_normalize_percent_form` runs BEFORE the dollar-form
     sentinel. If the non-zero median |x| is in the percent range
     (> 0.5 AND <= 100) AND the max |x| is also <= 100, the entire
     `daily_return` column is divided by 100 in-place and an info-flag
     entry `{"rule":"auto_normalized_percent_form",...}` is appended to a
     new `envelope.info_flags` array. Post-normalization the sentinel
     sees decimal-scale values and stays silent.
  3. Files that are TRUE dollar-PnL uploads (max |x| > 100, e.g. raw
     account-PnL like $5,000/day) skip normalization and the sentinel
     still rejects them with the existing actionable error message.

These four regression tests pin the contract.
"""
from __future__ import annotations

import pandas as pd

from services.csv_validator import validate_csv


def _csv_bytes(df: pd.DataFrame) -> bytes:
    return df.to_csv(index=False).encode("utf-8")


# ---------------------------------------------------------------------------
# Test 1 — MM_dailies-shape: long zero-padded prefix + percent-form values.
# This is the file that broke prod on 2026-05-25.
# Must auto-normalize, set info_flags, and validate cleanly.
# ---------------------------------------------------------------------------

def test_mm_dailies_shape_auto_normalizes_percent_form() -> None:
    # 600 zero-padded rows (strategy not trading yet) + 100 percent-form
    # trading rows. Distribution shape matches the prod break-momentum
    # file: median(non-zero |x|) ~ 0.9, max ~ 5.0 — well below the
    # 100.0 ceiling, so auto-normalize must fire.
    zero_dates = pd.date_range("2023-04-26", periods=600, freq="D").strftime(
        "%Y-%m-%d",
    )
    trade_dates = pd.date_range("2024-12-17", periods=100, freq="D").strftime(
        "%Y-%m-%d",
    )
    # Percent-form trading values: most around 0.5-2.0, a few up to ~5.0.
    trade_returns = (
        [0.5, -0.3, 1.2, -0.8, 2.5, -1.5, 0.9, -0.4, 1.8, -2.1] * 10
    )
    df = pd.DataFrame({
        "date": list(zero_dates) + list(trade_dates),
        "daily_return": [0.0] * 600 + trade_returns,
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")

    # Must validate clean — the file is percent-form but our normalizer
    # recovers it instead of rejecting.
    assert result["ok"] is True, (
        f"Expected ok=True after auto-normalization, got errors: "
        f"{result.get('errors')}"
    )

    # Must emit the info_flag entry so the wizard/UI can surface a chip.
    info_flags = result.get("info_flags") or []
    flag_rules = {f["rule"] for f in info_flags}
    assert "auto_normalized_percent_form" in flag_rules, (
        f"Expected auto_normalized_percent_form in info_flags, got: "
        f"{info_flags}"
    )
    norm_flag = next(
        f for f in info_flags if f["rule"] == "auto_normalized_percent_form"
    )
    assert norm_flag["factor"] == 0.01

    # daily_returns_series must be the NORMALIZED series — the wizard
    # persists exactly what comes out here, and the analytics worker
    # reads from csv_daily_returns, so normalization MUST happen on the
    # envelope's published series, not just on a discarded copy.
    series = result["daily_returns_series"]
    assert series is not None
    series_values = [row["daily_return"] for row in series]
    # Should NOT contain values like 2.5 anymore — those are 0.025
    # post-normalization.
    assert max(abs(v) for v in series_values) <= 1.0, (
        f"Normalized series still contains values > 1.0 in magnitude: "
        f"max = {max(abs(v) for v in series_values)}"
    )


# ---------------------------------------------------------------------------
# Test 2 — UC244-shape: consistent small decimals throughout (legit form).
# Must NOT auto-normalize, must validate cleanly, info_flags must be empty.
# ---------------------------------------------------------------------------

def test_uc244_shape_does_not_auto_normalize() -> None:
    # 90 rows of small decimal returns — daily moves around 0.001 (0.1%).
    # Median |x| sits well below the 0.5 percent-form threshold, so the
    # normalizer must NOT fire and the series must pass through verbatim.
    dates = pd.date_range("2026-01-01", periods=90, freq="D").strftime(
        "%Y-%m-%d",
    )
    # Alternate small positive/negative values; max abs ~ 0.004.
    returns = [0.001 if i % 2 == 0 else -0.002 for i in range(90)]
    df = pd.DataFrame({"date": dates, "daily_return": returns})
    result = validate_csv(_csv_bytes(df), "daily_returns")

    assert result["ok"] is True
    info_flags = result.get("info_flags") or []
    flag_rules = {f["rule"] for f in info_flags}
    assert "auto_normalized_percent_form" not in flag_rules, (
        f"Small-decimal series must NOT trigger auto-normalize. "
        f"info_flags: {info_flags}"
    )

    # Series values must be identical to input (no /100 happened).
    series = result["daily_returns_series"]
    assert series is not None
    series_values = [row["daily_return"] for row in series]
    assert any(abs(v - 0.001) < 1e-9 for v in series_values), (
        "Original 0.001 values must survive untouched"
    )


# ---------------------------------------------------------------------------
# Test 3 — Genuine dollar-PnL upload (max |x| > 100): must still reject.
# Confirms the auto-normalize change doesn't swallow what the sentinel
# is designed to catch.
# ---------------------------------------------------------------------------

def test_dollar_pnl_upload_still_rejects_after_norm_change() -> None:
    # Account-level dollar-PnL (~$300/day average). max |x| well over 100,
    # so auto-normalize must skip. Median |non-zero| also far above 0.5,
    # so the sentinel must fire with the existing actionable error.
    dates = pd.date_range("2024-01-02", periods=30, freq="D").strftime(
        "%Y-%m-%d",
    )
    returns = [
        329.0, -171.0, 240.0, -410.0, 195.0, -255.0, 310.0, -120.0,
        265.0, -385.0, 150.0, -210.0, 345.0, -425.0, 185.0, -295.0,
        320.0, -165.0, 285.0, -305.0, 410.0, -195.0, 250.0, -340.0,
        180.0, -270.0, 415.0, -225.0, 195.0, -355.0,
    ]
    df = pd.DataFrame({"date": dates, "daily_return": returns})
    result = validate_csv(_csv_bytes(df), "daily_returns")

    assert result["ok"] is False, (
        "Dollar-PnL upload (max |x| > 100) must still reject — "
        "auto-normalize must not swallow genuine garbage"
    )
    rules = {e["rule"] for e in result["errors"]}
    assert "daily_return_dollar_form_sentinel" in rules, (
        f"Expected dollar_form_sentinel to fire, got rules: {rules}"
    )

    # And no normalization happened — info_flags absent or empty.
    info_flags = result.get("info_flags") or []
    flag_rules = {f["rule"] for f in info_flags}
    assert "auto_normalized_percent_form" not in flag_rules, (
        "Dollar-PnL upload must NOT trigger auto-normalize (max |x| > 100)"
    )


# ---------------------------------------------------------------------------
# Test 4 — Leveraged decimal strategy with extreme single-day drawdowns.
# Must NOT auto-normalize (median over non-zero stays small) and must
# pass the existing dollar-form sentinel (preserves the 2026-05-07 widening
# for leveraged track records that legitimately dip below -1.0).
# ---------------------------------------------------------------------------

def test_leveraged_decimal_does_not_auto_normalize_or_reject() -> None:
    # 18 normal decimal rows (median |x| ~ 0.02) + 2 extreme leverage
    # days at -1.5 / -1.2. Median(non-zero |x|) sits well below 0.5, so
    # auto-normalize MUST NOT fire and the sentinel MUST stay silent.
    dates = pd.date_range("2024-01-02", periods=20, freq="D").strftime(
        "%Y-%m-%d",
    )
    returns = (
        [0.02, -0.01, 0.015, -0.025, 0.018, -0.02, 0.022, -0.014]
        + [-1.5, -1.2]
        + [0.019, -0.013, 0.024, -0.021, 0.011, -0.017, 0.026, -0.012]
        + [0.029, -0.018]
    )
    df = pd.DataFrame({"date": dates, "daily_return": returns})
    result = validate_csv(_csv_bytes(df), "daily_returns")

    assert result["ok"] is True, (
        f"Leveraged decimal strategy must validate cleanly. errors: "
        f"{result.get('errors')}"
    )
    info_flags = result.get("info_flags") or []
    flag_rules = {f["rule"] for f in info_flags}
    assert "auto_normalized_percent_form" not in flag_rules, (
        "Leveraged decimal strategy must NOT trigger auto-normalize — "
        "median(|non-zero|) is small even when individual days are extreme"
    )

    # The -1.5 day must survive verbatim in the published series (no /100).
    series = result["daily_returns_series"]
    assert series is not None
    series_values = [row["daily_return"] for row in series]
    assert any(abs(v + 1.5) < 1e-9 for v in series_values), (
        "Original -1.5 leverage day must survive untouched in the series"
    )
