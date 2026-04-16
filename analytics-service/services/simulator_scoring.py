"""
Sprint 6 Task 6.4: Portfolio impact simulator (ADD scenario).

ADD-scenario math for the Portfolio Impact Simulator. Given a user's current
portfolio composition plus a candidate strategy the user is considering, this
module computes:

- Current portfolio metrics (Sharpe, MaxDD, average pairwise correlation,
  concentration/HHI)
- Proposed portfolio metrics assuming the candidate is ADDED (incumbent
  weights shrink uniformly to make room for the candidate)
- Deltas between current and proposed
- Before/after portfolio-level equity curves for the UI overlay

The ADD semantics mirror `portfolio_optimizer.find_improvement_candidates`:
existing weights are multiplied by `(1 - add_weight)` and the candidate
takes the freed `add_weight`. Default `add_weight=0.10` matches the
optimizer so the simulator preview is comparable to the optimizer's
scoring on the same candidate.

Returns a single result dict (not a ranked list) — the simulator targets a
specific candidate, unlike the REPLACE bridge that ranks multiple
alternatives.
"""

from typing import Optional

import numpy as np
import pandas as pd

from services.metrics import _safe_float
from services.portfolio_optimizer import _avg_corr, _compute_sharpe, _max_drawdown


# Minimum overlapping trading days required to run the simulation. Matches
# the floor used by find_improvement_candidates / find_replacement_candidates.
MIN_DATA_POINTS = 30

# Threshold below which we flag the proposed portfolio as having only partial
# history. ~6 months of business days ≈ 126. The UI renders a "partial
# history" warning when overlapping data is below this.
PARTIAL_HISTORY_THRESHOLD = 126


def simulate_add_candidate(
    portfolio_returns: dict[str, pd.Series],
    candidate_id: str,
    candidate_returns: pd.Series,
    weights: dict[str, float],
    add_weight: float = 0.10,
) -> dict:
    """Run the ADD scenario for a single candidate against a portfolio.

    Args:
        portfolio_returns: {strategy_id: daily returns series} for every
            strategy currently in the portfolio.
        candidate_id: id of the candidate strategy being simulated.
        candidate_returns: daily returns series for the candidate.
        weights: {strategy_id: weight} for the current portfolio. Weights
            are normalised to sum to 1 before scoring.
        add_weight: fraction of the portfolio freed for the candidate.
            Defaults to 0.10, matching the optimizer's default.

    Returns:
        A dict with:
          - candidate_id
          - status: "ok" | "insufficient_data" | "already_in_portfolio" |
                    "empty_portfolio"
          - deltas: {sharpe_delta, dd_delta, corr_delta, concentration_delta}
          - current: {sharpe, max_drawdown, avg_correlation, concentration}
          - proposed: {sharpe, max_drawdown, avg_correlation, concentration}
          - overlap_days: int — trading days of overlap between candidate
            and portfolio
          - partial_history: bool — True when overlap_days <
            PARTIAL_HISTORY_THRESHOLD
          - equity_curve_current: [{date, value}] portfolio-level cumulative
            equity with the current weights
          - equity_curve_proposed: [{date, value}] portfolio-level
            cumulative equity with the candidate added

    Deltas are oriented so POSITIVE = improvement for every chip:
      - sharpe_delta:        proposed - current   (higher Sharpe is better)
      - dd_delta:            current  - proposed  (less drawdown is better;
                                                   MaxDD is negative so this
                                                   measures how far the
                                                   trough shrinks toward 0)
      - corr_delta:          current  - proposed  (lower correlation is
                                                   better for diversification)
      - concentration_delta: current  - proposed  (lower HHI is better for
                                                   diversification)
    """
    # Guard: candidate already in portfolio — cannot ADD it again.
    if candidate_id in portfolio_returns:
        return _empty_result(candidate_id, status="already_in_portfolio")

    port_df = pd.DataFrame(portfolio_returns).dropna()
    if port_df.empty:
        return _empty_result(candidate_id, status="empty_portfolio")

    # --- Current portfolio (without the candidate) --------------------
    w_arr = np.array([weights.get(sid, 0) for sid in port_df.columns])
    if w_arr.sum() > 0:
        w_arr = w_arr / w_arr.sum()
    current_returns = (port_df * w_arr).sum(axis=1)

    current_sharpe = _compute_sharpe(current_returns)
    current_avg_corr = _avg_corr(port_df)
    current_max_dd = _max_drawdown(current_returns)
    current_weights_map = {sid: float(w) for sid, w in zip(port_df.columns, w_arr)}
    current_concentration = _herfindahl(current_weights_map)

    # --- Proposed portfolio (with the candidate added) ----------------
    aligned = pd.concat(
        [port_df, candidate_returns.rename(candidate_id)], axis=1
    ).dropna()
    overlap_days = int(len(aligned))

    if overlap_days < MIN_DATA_POINTS:
        return {
            "candidate_id": candidate_id,
            "status": "insufficient_data",
            "overlap_days": overlap_days,
            "partial_history": True,
            "deltas": _zero_deltas(),
            "current": _metrics_dict(
                current_sharpe, current_max_dd, current_avg_corr, current_concentration
            ),
            "proposed": _metrics_dict(None, None, None, None),
            "equity_curve_current": _cumulative_curve(current_returns),
            "equity_curve_proposed": [],
        }

    new_weights = {sid: weights.get(sid, 0) * (1 - add_weight) for sid in port_df.columns}
    new_weights[candidate_id] = add_weight

    w_new = np.array([new_weights.get(col, 0) for col in aligned.columns])
    if w_new.sum() > 0:
        w_new = w_new / w_new.sum()

    proposed_returns = (aligned * w_new).sum(axis=1)
    proposed_sharpe = _compute_sharpe(proposed_returns)
    proposed_avg_corr = _avg_corr(aligned)
    proposed_max_dd = _max_drawdown(proposed_returns)
    proposed_weights_map = {sid: float(w) for sid, w in zip(aligned.columns, w_new)}
    proposed_concentration = _herfindahl(proposed_weights_map)

    # --- Deltas (positive = improvement on every chip) ----------------
    sharpe_delta = _delta(proposed_sharpe, current_sharpe)
    # MaxDD is a negative number; "less drawdown" means closer to 0, so
    # current - proposed is positive when the candidate reduces drawdown.
    dd_delta = _delta(current_max_dd, proposed_max_dd)
    corr_delta = _delta(current_avg_corr, proposed_avg_corr)
    concentration_delta = _delta(current_concentration, proposed_concentration)

    partial_history = overlap_days < PARTIAL_HISTORY_THRESHOLD

    return {
        "candidate_id": candidate_id,
        "status": "ok",
        "overlap_days": overlap_days,
        "partial_history": partial_history,
        "deltas": {
            "sharpe_delta": _safe_float(sharpe_delta),
            "dd_delta": _safe_float(dd_delta),
            "corr_delta": _safe_float(corr_delta),
            "concentration_delta": _safe_float(concentration_delta),
        },
        "current": _metrics_dict(
            current_sharpe, current_max_dd, current_avg_corr, current_concentration
        ),
        "proposed": _metrics_dict(
            proposed_sharpe, proposed_max_dd, proposed_avg_corr, proposed_concentration
        ),
        # Both curves are portfolio-level cumulative equity (starting at 1.0)
        # so the UI can overlay "current" vs "proposed" on a shared axis.
        "equity_curve_current": _cumulative_curve(current_returns),
        "equity_curve_proposed": _cumulative_curve(proposed_returns),
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _delta(new_val: Optional[float], old_val: Optional[float]) -> float:
    """Return new-old, coercing None to 0 so the caller always gets a float.

    The sign convention is the caller's responsibility (see docstring on
    simulate_add_candidate).
    """
    if new_val is None or old_val is None:
        return 0.0
    return new_val - old_val


def _herfindahl(weights_map: dict[str, float]) -> Optional[float]:
    """Sum of squared weights — the Herfindahl-Hirschman concentration index.

    Range: [1/N, 1]. 1/N is the equal-weight floor, 1 is all capital in
    one strategy. Smaller is more diversified. Returns None when there
    are no weights to score (empty portfolio).
    """
    values = [float(w) for w in weights_map.values() if w is not None]
    if not values:
        return None
    return _safe_float(float(sum(w * w for w in values)))


def _metrics_dict(
    sharpe: Optional[float],
    max_dd: Optional[float],
    avg_corr: Optional[float],
    concentration: Optional[float],
) -> dict:
    return {
        "sharpe": _safe_float(sharpe),
        "max_drawdown": _safe_float(max_dd),
        "avg_correlation": _safe_float(avg_corr),
        "concentration": _safe_float(concentration),
    }


def _zero_deltas() -> dict:
    return {
        "sharpe_delta": 0.0,
        "dd_delta": 0.0,
        "corr_delta": 0.0,
        "concentration_delta": 0.0,
    }


def _cumulative_curve(returns: pd.Series) -> list[dict]:
    """Convert a returns series into a list of {date, value} points where
    value is the cumulative growth factor (starts at ~1 + first return)."""
    if returns.empty:
        return []
    cumulative = (1 + returns).cumprod()
    points: list[dict] = []
    for idx, val in cumulative.items():
        date_str = idx.isoformat() if hasattr(idx, "isoformat") else str(idx)
        # Strip time when the index is a pd.Timestamp at midnight (most
        # daily-returns series are date-only).
        if "T00:00:00" in date_str:
            date_str = date_str.split("T")[0]
        points.append({"date": date_str, "value": _safe_float(float(val))})
    return points


def _empty_result(candidate_id: str, status: str) -> dict:
    """Return a well-formed no-op result when preconditions fail but we
    still want to respond without an HTTP error."""
    return {
        "candidate_id": candidate_id,
        "status": status,
        "overlap_days": 0,
        "partial_history": True,
        "deltas": _zero_deltas(),
        "current": _metrics_dict(None, None, None, None),
        "proposed": _metrics_dict(None, None, None, None),
        "equity_curve_current": [],
        "equity_curve_proposed": [],
    }
