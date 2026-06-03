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
from typing import Any, Optional
from services.metrics import _safe_float
from services.portfolio_optimizer import _compute_sharpe, _avg_corr, _max_drawdown

# H-1066: per-axis "excellent" reference magnitudes for a single-strategy swap.
# Normalizing each delta by its scale (and clamping to [-1, 1]) puts the composite
# in [-1, 1], so the _fit_label thresholds (0.7/0.4/0.2) are reachable for realistic
# candidates instead of every candidate collapsing to "Weak fit".
SHARPE_SCALE = 0.5   # Sharpe-ratio points
CORR_SCALE = 0.15    # average-correlation reduction
DD_SCALE = 0.10      # fractional drawdown improvement


def find_replacement_candidates(
    portfolio_returns: dict[str, pd.Series],
    candidate_returns: dict[str, pd.Series],
    weights: dict[str, float],
    incumbent_strategy_id: str,
    w1: float = 0.4,
    w2: float = 0.3,
    w3: float = 0.3,
) -> list[dict[str, Any]]:
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
    # Dedupe duplicate timestamps last-write-wins (the G15-006 idiom in
    # routers/simulator.py + _build_monthly_returns) so the per-candidate
    # baseline reslice below cannot cartesian-amplify against a returns_series
    # carrying a repeated date — routers/portfolio.py documents that
    # `_records_to_series` does NOT dedupe its JSONB input. A no-op on the
    # unique-date series the analytics pipeline normally produces.
    port_df = port_df[~port_df.index.duplicated(keep="last")]

    # Current-portfolio weights (with incumbent). The baseline metrics
    # (sharpe / corr / dd) are NOT computed here over the full port_df window —
    # they are recomputed PER CANDIDATE over that candidate's overlap window
    # inside the loop below (M-0893), so each delta compares two portfolios
    # over the same dates rather than mixing a full-window baseline with a
    # candidate-window challenger.
    w_arr = np.array([weights.get(sid, 0) for sid in port_df.columns])
    w_sum = w_arr.sum()
    if w_sum > 0:
        w_arr = w_arr / w_sum

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

    results: list[dict[str, Any]] = []
    for cid, c_returns in candidate_returns.items():
        if cid in portfolio_sids:
            continue

        all_returns = pd.concat(
            [remaining_df, c_returns.rename(cid)], axis=1
        ).dropna()
        if len(all_returns) < 30:
            continue

        # M-0893: reslice the incumbent-portfolio baseline to THIS candidate's
        # overlap window (the same window-alignment match_engine.py does for the
        # ADD-semantics sibling, NEW-C08-01). new_* below are computed over
        # all_returns' window (the candidate's track record, typically shorter
        # than the full portfolio history); subtracting them from a full-window
        # baseline let a short bull-run candidate out-rank a full-history one
        # purely on a regime / sample-size mismatch (_compute_sharpe annualizes
        # ×√252 regardless of window length). all_returns.index ⊆ port_df.index
        # (remaining_df is a column-subset of the already-dropna'd port_df), so
        # .loc never KeyErrors or introduces NaN and the incumbent is present on
        # every aligned row; because port_df's index was deduped above it cannot
        # cartesian-amplify, so the aligned baseline has exactly all_returns'
        # rows. w_arr is unchanged because the column set is identical.
        port_df_aligned = port_df.loc[all_returns.index]
        current_returns = (port_df_aligned * w_arr).sum(axis=1)
        current_sharpe = _compute_sharpe(current_returns)
        current_corr = _avg_corr(port_df_aligned)
        current_dd = _max_drawdown(current_returns)

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
        # H-1065: _max_drawdown returns <= 0, so a shallower (better) new drawdown
        # means new_dd > current_dd. Use (new_dd - current_dd) so positive = improvement,
        # consistent with sharpe_delta and corr_delta. The old (current_dd - new_dd)
        # made improvement negative, which the positive-weighted composite penalized —
        # inverting the REPLACE ranking on the drawdown axis.
        dd_delta = _delta(new_dd, current_dd)  # positive = shallower drawdown (good)

        # H-1066: normalize each axis to [-1, 1] before weighting so the composite is
        # scale-stable and the fit-label thresholds are reachable for realistic deltas.
        composite = (
            w1 * _normalize(sharpe_delta, SHARPE_SCALE)
            + w2 * _normalize(corr_delta, CORR_SCALE)
            + w3 * _normalize(dd_delta, DD_SCALE)
        )
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


def _normalize(value: float, scale: float) -> float:
    """Scale a raw delta by its per-axis reference magnitude, clamped to [-1, 1].

    Clamping bounds the composite to [-1, 1] so the fit-label thresholds are
    meaningful. Trade-off: a delta beyond ``scale`` (an already-extraordinary
    single-swap improvement) saturates to +/-1, so two such candidates tie on
    that axis and are ordered only by the remaining axes — the strict ranking is
    preserved for realistic deltas (well within ``scale``), which is the case
    that matters for allocator-facing fit labels.
    """
    return max(-1.0, min(1.0, value / scale))


def _fit_label(score: float) -> str:
    if score > 0.7:
        return "Strong fit"
    if score > 0.4:
        return "Good fit"
    if score > 0.2:
        return "Moderate fit"
    return "Weak fit"


    # _compute_sharpe, _avg_corr, _max_drawdown imported from portfolio_optimizer
