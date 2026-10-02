import numpy as np
import pandas as pd
from typing import Any, Optional
from services.dispersion import dispersion_is_real, dispersion_is_residue, residue_floor
from services.metrics import _safe_float

# Rolling correlation is O(n²) in strategy count; skip beyond this threshold.
MAX_STRATEGIES_FOR_ROLLING = 20
# When many strategies exist, return only the most correlated pairs.
MAX_ROLLING_PAIRS = 10


def compute_correlation_matrix(strategy_returns: dict[str, pd.Series]) -> dict[str, Any]:
    ids = list(strategy_returns.keys())
    if len(ids) < 2:
        return {ids[0]: {ids[0]: 1.0}} if ids else {}
    df = pd.DataFrame(strategy_returns).dropna()
    if len(df) < 10:
        return {sid: {sid2: None for sid2 in ids} for sid in ids}
    corr_df = df.corr()
    # Phase 166.1 (C1, D-02): a leg whose dispersion is residue defines no
    # correlation. pandas gives an all-zero leg NaN on its row, column and
    # diagonal (read as None below), but a compounding constant yield a noise
    # correlation and a 1.0 diagonal. Mask the residue leg the same way.
    flat = [c for c in df.columns if not dispersion_is_real(float(df[c].std()), float(df[c].mean()))]
    if flat:
        corr_df.loc[flat, :] = np.nan
        corr_df.loc[:, flat] = np.nan
    corr = corr_df.to_dict()
    return {k1: {k2: _safe_float(v) for k2, v in row.items()} for k1, row in corr.items()}


def compute_rolling_correlation(strategy_returns: dict[str, pd.Series], window: int = 30) -> dict[str, Any]:
    ids = list(strategy_returns.keys())
    if len(ids) < 2 or len(ids) > MAX_STRATEGIES_FOR_ROLLING:
        return {}
    df = pd.DataFrame(strategy_returns).dropna()
    result = {}
    pairs = []
    for i, s1 in enumerate(ids):
        for s2 in ids[i + 1:]:
            # Phase 166.1 (C2, D-02): the both_move mask of metrics
            # _rolling_correlation. A window where either leg's dispersion is
            # residue defines no correlation, so it is NaN and dropped, as an
            # all-zero leg's windows are; pandas divides by the residue std.
            r1, r2 = df[s1].rolling(window), df[s2].rolling(window)
            both_move = (r1.std() > residue_floor(r1.mean())) & (r2.std() > residue_floor(r2.mean()))
            rolling = r1.corr(df[s2]).where(both_move).dropna()
            avg_corr = abs(float(rolling.mean())) if len(rolling) > 0 else 0
            pairs.append((f"{s1}:{s2}", rolling, avg_corr))
    # M-0704: cap on the number of PAIRS, not the strategy count. The constant
    # is a pair-count limit (n*(n-1)/2 pairs), so gating on len(ids) let e.g.
    # 6 strategies (15 pairs) slip the cap and return all 15 series. Reference
    # the constant in the slice too, rather than a hard-coded literal.
    if len(pairs) > MAX_ROLLING_PAIRS:
        pairs.sort(key=lambda x: x[2], reverse=True)
        pairs = pairs[:MAX_ROLLING_PAIRS]
    for key, rolling, _ in pairs:
        result[key] = [{"date": d.isoformat(), "value": _safe_float(v)} for d, v in rolling.items()]
    return result


def compute_avg_pairwise_correlation(corr_matrix: dict[str, Any]) -> Optional[float]:
    return compute_avg_pairwise_correlation_with_pairs(corr_matrix)[0]


def compute_avg_pairwise_correlation_with_pairs(
    corr_matrix: dict[str, Any],
) -> tuple[Optional[float], int, int]:
    """``(mean, pairs_used, pairs_total)`` over the matrix's DEFINED pairs.

    Phase 166.1 round-1 WR-03 / SFH MEDIUM-1: the same rule as
    ``dispersion.average_pairwise_correlation`` (the scorers' ``_avg_corr``).
    C1 masks a non-dispersing leg's row and column to None, and every None
    pair is skipped, so the mean covers a subset of the book whenever a leg is
    masked. ``pairs_used`` of ``pairs_total`` says how large that subset is;
    the router records both in ``data_quality`` beside the average.
    """
    ids = list(corr_matrix.keys())
    n = len(ids)
    pairs_total = n * (n - 1) // 2
    if n < 2:
        return None, 0, pairs_total
    total = 0.0
    count = 0
    for i, s1 in enumerate(ids):
        for s2 in ids[i + 1:]:
            val = corr_matrix.get(s1, {}).get(s2)
            if val is not None:
                total += val
                count += 1
    return (_safe_float(total / count) if count > 0 else None), count, pairs_total


def compute_risk_decomposition(weights: list[float], covariance_matrix: np.ndarray[Any, Any]) -> list[dict[str, Any]]:
    w = np.array(weights)
    port_var = w @ covariance_matrix @ w
    port_vol = float(np.sqrt(port_var)) if port_var > 0 else 0.0
    # Phase 166.1 (S7, D-05): a residue portfolio vol (two constant yields give
    # a ~1e-16 vol, never exactly 0) is no risk, so it takes the zero branch
    # instead of a fabricated 48.6% / 51.4% split. There is no mean here, so the
    # floor is the absolute one, residue_floor(0.0).
    if dispersion_is_residue(port_vol, 0.0):
        # H-0803: marginal/component attribution is genuinely undefined when the
        # portfolio carries no risk (all-zero weights, or a non-PSD cov whose
        # port_var<0 collapsed to 0) — you cannot apportion a share of a zero
        # risk. Round-1 SFH MEDIUM-2 / 166.1 D7 (founder 2026-09-26): so those
        # are None, not 0. A 0 made the rows sum to 0% where every real split
        # sums to 100%, and read as "this strategy carries none of the risk".
        # But standalone_vol = sqrt(cov[i][i]) is a
        # PER-STRATEGY property independent of the weights; it must report the
        # real per-strategy vol here, not collapse to 0. Mirrors the non-zero
        # branch's standalone_vol expression below.
        return [
            {
                "marginal_risk_pct": None,
                "standalone_vol": _safe_float(float(np.sqrt(covariance_matrix[i][i]))),
                "component_var": None,
            }
            for i in range(len(weights))
        ]
    marginal_contrib = (covariance_matrix @ w) / port_vol
    component_risk = w * marginal_contrib
    return [
        {
            "marginal_risk_pct": _safe_float(float(cr / port_vol * 100)),
            "standalone_vol": _safe_float(float(np.sqrt(covariance_matrix[i][i]))),
            "component_var": _safe_float(float(cr)),
        }
        for i, cr in enumerate(component_risk)
    ]


def compute_attribution(weights: list[float], strategy_twrs: list[float], portfolio_twr: float) -> list[dict[str, Any]]:
    n = len(weights)
    equal_weight = 1.0 / n if n > 0 else 0
    result = []
    for i in range(n):
        contribution = weights[i] * strategy_twrs[i]
        allocation_effect = (weights[i] - equal_weight) * (strategy_twrs[i] - portfolio_twr)
        result.append({
            "contribution": _safe_float(contribution),
            "allocation_effect": _safe_float(allocation_effect),
        })
    return result
