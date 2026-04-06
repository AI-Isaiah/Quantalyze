"""Portfolio performance metrics: TWR, MWR, Modified Dietz, period returns.

Uses 252 trading days for annualisation (matching services/metrics.py).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd
from scipy.optimize import brentq, newton

from services.metrics import _safe_float


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_date(value: Any) -> pd.Timestamp:
    """Parse an ISO date string, date, or datetime into a pd.Timestamp."""
    if isinstance(value, pd.Timestamp):
        return value
    if isinstance(value, (date, datetime)):
        return pd.Timestamp(value)
    return pd.Timestamp(str(value)[:10])


# ---------------------------------------------------------------------------
# Time-Weighted Return (TWR)
# ---------------------------------------------------------------------------

def compute_twr(equity: pd.Series, events: list[dict[str, Any]]) -> float | None:
    """Compute time-weighted return by chaining sub-period returns.

    Cash flow events must have keys:
      - event_date: ISO date string
      - event_type: "deposit" | "withdrawal"
      - amount: positive float

    Day-0 deposits (same date as the first equity observation) are skipped
    because there is no prior equity value to form a ratio.

    Returns the total TWR as a decimal (e.g. 0.10 for +10%), or None if the
    series is too short or all sub-periods produce invalid results.
    """
    if equity is None or len(equity) < 2:
        return None

    # Normalise the equity index to date-only timestamps.
    eq = equity.copy()
    eq.index = pd.to_datetime(eq.index).normalize()

    # Build a set of cash-flow dates (normalised), excluding day-0 events.
    start_date = eq.index[0]
    cf_dates: set[pd.Timestamp] = set()
    for ev in events:
        ev_date = _parse_date(ev.get("event_date", "")).normalize()
        if ev_date > start_date:
            cf_dates.add(ev_date)

    # Build breakpoints: [start, cf_date_1, cf_date_2, …, end].
    breakpoints = sorted({start_date} | cf_dates | {eq.index[-1]})

    sub_returns: list[float] = []
    for i in range(len(breakpoints) - 1):
        t0 = breakpoints[i]
        t1 = breakpoints[i + 1]

        # Value just before the cash flow at t1 (use the last observation ≤ t1).
        mask = (eq.index >= t0) & (eq.index <= t1)
        segment = eq[mask]
        if len(segment) < 2:
            continue

        begin_val = float(segment.iloc[0])
        end_val = float(segment.iloc[-1])

        # Subtract any cash flows that arrived ON t1 (inflows inflate end-value).
        cf_adjustment = 0.0
        for ev in events:
            ev_date = _parse_date(ev.get("event_date", "")).normalize()
            if ev_date == t1:
                signed = float(ev.get("amount", 0))
                if ev.get("event_type") == "withdrawal":
                    signed = -signed
                cf_adjustment += signed

        # End value before the cash flow = end_val - cf_adjustment.
        end_before_cf = end_val - cf_adjustment

        if begin_val == 0:
            continue  # Cannot compute a ratio; skip this sub-period.

        sub_r = (end_before_cf / begin_val) - 1.0
        sub_returns.append(sub_r)

    if not sub_returns:
        return None

    twr = 1.0
    for r in sub_returns:
        twr *= (1.0 + r)
    twr -= 1.0

    return _safe_float(twr)


# ---------------------------------------------------------------------------
# Money-Weighted Return (MWR / IRR)
# ---------------------------------------------------------------------------

def compute_mwr(
    cash_flows: list[dict[str, Any]],
    final_value: float,
    end_date: str | date | datetime | None = None,
) -> float | None:
    """Compute the annualised money-weighted return (internal rate of return).

    cash_flows: list of dicts with keys:
      - date: ISO date string
      - amount: negative for outflows (investments), positive for inflows (distributions)

    final_value: current portfolio value appended as a final positive cash flow.
    end_date: optional explicit end date for the final_value cash flow.
              Defaults to the latest date found in cash_flows.

    Returns the annualised IRR as a decimal, or None if it cannot be solved.
    """
    if not cash_flows:
        return None

    parsed: list[tuple[pd.Timestamp, float]] = []
    for cf in cash_flows:
        parsed.append((_parse_date(cf["date"]), float(cf["amount"])))

    # Determine the end date for the terminal value.
    if end_date is not None:
        terminal_date = _parse_date(end_date).normalize()
    else:
        terminal_date = max(d for d, _ in parsed)

    # Append terminal value only when the provided cash flows don't already
    # include a terminal inflow (i.e. net cash flow is still negative).
    # This avoids double-counting when the caller supplies the final liquidation
    # as both a cash flow entry AND as final_value.
    net_cf = sum(a for _, a in parsed)
    if final_value > 0 and net_cf < 0:
        parsed.append((terminal_date, final_value))

    # Sort by date.
    parsed.sort(key=lambda x: x[0])

    t0 = parsed[0][0]
    # Convert dates to year fractions from t0.
    t_years = np.array([(d - t0).days / 365.25 for d, _ in parsed])
    amounts = np.array([a for _, a in parsed])

    def npv(rate: float) -> float:
        if rate <= -1:
            return float("inf")
        return float(np.sum(amounts / (1.0 + rate) ** t_years))

    # Try Newton's method first, then bisect as fallback.
    try:
        rate = newton(npv, x0=0.1, tol=1e-8, maxiter=200)
        result = _safe_float(rate)
        if result is not None and result > -1:
            return result
    except (RuntimeError, ValueError):
        pass

    try:
        rate = brentq(npv, -0.9999, 100.0, xtol=1e-10, maxiter=500)
        return _safe_float(rate)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Modified Dietz Return
# ---------------------------------------------------------------------------

def compute_modified_dietz(
    begin_value: float,
    end_value: float,
    cash_flows: list[dict[str, Any]],
    period_days: int,
) -> float | None:
    """Compute Modified Dietz return.

    cash_flows: list of dicts with keys:
      - amount: positive for deposit, negative for withdrawal
      - day: day index within the period (0-based from period start)

    period_days: total number of calendar days in the period.

    Returns the return as a decimal, or None on invalid input.
    """
    if begin_value == 0 or period_days <= 0:
        return None

    total_cf = 0.0
    weighted_cf = 0.0
    for cf in cash_flows:
        amount = float(cf.get("amount", 0))
        day = int(cf.get("day", 0))
        # Weight: fraction of period remaining after the cash flow.
        weight = (period_days - day) / period_days
        total_cf += amount
        weighted_cf += weight * amount

    numerator = end_value - begin_value - total_cf
    denominator = begin_value + weighted_cf

    if denominator == 0:
        return None

    return _safe_float(numerator / denominator)


# ---------------------------------------------------------------------------
# Period Returns
# ---------------------------------------------------------------------------

def compute_period_returns(returns: pd.Series) -> dict[str, float | None]:
    """Compute 24h, MTD, and YTD returns from a daily returns series.

    returns: pd.Series of daily decimal returns indexed by date.

    Returns a dict with keys: return_24h, return_mtd, return_ytd.
    """
    if returns is None or len(returns) == 0:
        return {"return_24h": None, "return_mtd": None, "return_ytd": None}

    idx = returns.index
    last_date = idx[-1]

    return_24h = _safe_float(float(returns.iloc[-1]))

    # MTD: compound from the first day of the current month.
    month_start = pd.Timestamp(last_date.year, last_date.month, 1)
    mtd_slice = returns[idx >= month_start]
    return_mtd = _safe_float(float((1 + mtd_slice).prod() - 1)) if len(mtd_slice) > 0 else None

    # YTD: compound from Jan 1 of the current year.
    year_start = pd.Timestamp(last_date.year, 1, 1)
    ytd_slice = returns[idx >= year_start]
    return_ytd = _safe_float(float((1 + ytd_slice).prod() - 1)) if len(ytd_slice) > 0 else None

    return {
        "return_24h": return_24h,
        "return_mtd": return_mtd,
        "return_ytd": return_ytd,
    }
