"""
Bridge V1: REPLACE scoring for portfolio-aware strategy replacement.

Unlike find_improvement_candidates() (ADD semantics: shrink all existing,
add candidate), this module computes REPLACE semantics: remove a specific
incumbent strategy, redistribute its weight among remaining strategies,
then score how each candidate performs in that slot.

Deltas are relative to the portfolio WITH the incumbent vs the portfolio
WITH the candidate replacing the incumbent.
"""

import numpy as np
import pandas as pd
from typing import Optional
from services.metrics import _safe_float
from services.portfolio_optimizer import _compute_sharpe, _avg_corr, _max_drawdown


def find_replacement_candidates(
    portfolio_returns: dict[str, pd.Series],
    candidate_returns: dict[str, pd.Series],
    weights: dict[str, float],
    incumbent_strategy_id: str,
    w1: float = 0.4,
    w2: float = 0.3,
    w3: float = 0.3,
) -> list[dict]:
    """Score candidates as replacements for a specific underperforming strategy.

    Returns top 5 candidates sorted by composite_score, each with:
      strategy_id, sharpe_delta, dd_delta, corr_delta,
      composite_score, fit_label

    NOTE: strategy_name is NOT included in the raw output. The router
    (portfolio.py) hydrates it from the strategies table before returning
    to the client. The Zod BridgeResponseSchema requires it.
    """
    port_df = pd.DataFrame(portfolio_returns).dropna()
    if port_df.empty or incumbent_strategy_id not in port_df.columns:
        return []

    # Current portfolio metrics (with incumbent)
    w_arr = np.array([weights.get(sid, 0) for sid in port_df.columns])
    w_sum = w_arr.sum()
    if w_sum > 0:
        w_arr = w_arr / w_sum
    current_returns = (port_df * w_arr).sum(axis=1)
    current_sharpe = _compute_sharpe(current_returns)
    current_corr = _avg_corr(port_df)
    current_dd = _max_drawdown(current_returns)

    # Weight of the incumbent to redistribute
    incumbent_weight = weights.get(incumbent_strategy_id, 0)
    if incumbent_weight <= 0:
        return []

    # Remaining strategies (without incumbent)
    remaining_sids = [sid for sid in port_df.columns if sid != incumbent_strategy_id]
    if not remaining_sids:
        return []

    # Pre-slice the remaining-strategies frame once (avoids repeated column
    # indexing inside the candidate loop).
    remaining_df = port_df[remaining_sids]
    portfolio_sids = set(port_df.columns)

    # Pre-compute remaining weights (shared across all candidates)
    base_weights = {sid: weights.get(sid, 0) for sid in remaining_sids}

    results = []
    for cid, c_returns in candidate_returns.items():
        if cid in portfolio_sids:
            continue

        all_returns = pd.concat(
            [remaining_df, c_returns.rename(cid)], axis=1
        ).dropna()
        if len(all_returns) < 30:
            continue

        new_weights = {**base_weights, cid: incumbent_weight}

        w_new = np.array([new_weights.get(col, 0) for col in all_returns.columns])
        w_new_sum = w_new.sum()
        if w_new_sum > 0:
            w_new = w_new / w_new_sum

        new_port_returns = (all_returns * w_new).sum(axis=1)
        new_sharpe = _compute_sharpe(new_port_returns)
        new_corr = _avg_corr(all_returns)
        new_dd = _max_drawdown(new_port_returns)

        sharpe_delta = _delta(new_sharpe, current_sharpe)
        corr_delta = _delta(current_corr, new_corr)  # positive = corr reduced (good)
        dd_delta = _delta(current_dd, new_dd)  # positive = less drawdown (good)

        composite = w1 * sharpe_delta + w2 * corr_delta + w3 * dd_delta
        fit_label = _fit_label(composite)

        results.append({
            "strategy_id": cid,
            "sharpe_delta": _safe_float(sharpe_delta),
            "dd_delta": _safe_float(dd_delta),
            "corr_delta": _safe_float(corr_delta),
            "composite_score": _safe_float(composite),
            "fit_label": fit_label,
        })

    return sorted(results, key=lambda x: x["composite_score"], reverse=True)[:5]


def _delta(new_val: Optional[float], old_val: Optional[float]) -> float:
    if new_val is None or old_val is None:
        return 0.0
    return new_val - old_val


def _fit_label(score: float) -> str:
    if score > 0.7:
        return "Strong fit"
    if score > 0.4:
        return "Good fit"
    if score > 0.2:
        return "Moderate fit"
    return "Weak fit"


    # _compute_sharpe, _avg_corr, _max_drawdown imported from portfolio_optimizer
