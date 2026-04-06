import numpy as np
import pandas as pd
from typing import Optional
from services.metrics import _safe_float


def compute_correlation_matrix(strategy_returns: dict[str, pd.Series]) -> dict:
    ids = list(strategy_returns.keys())
    if len(ids) < 2:
        return {ids[0]: {ids[0]: 1.0}} if ids else {}
    df = pd.DataFrame(strategy_returns).dropna()
    if len(df) < 10:
        return {sid: {sid2: None for sid2 in ids} for sid in ids}
    corr = df.corr().to_dict()
    return {k1: {k2: _safe_float(v) for k2, v in row.items()} for k1, row in corr.items()}


def compute_rolling_correlation(strategy_returns: dict[str, pd.Series], window: int = 30) -> dict:
    ids = list(strategy_returns.keys())
    # Skip if n > 20 strategies (too many pairs)
    if len(ids) < 2 or len(ids) > 20:
        return {}
    df = pd.DataFrame(strategy_returns).dropna()
    result = {}
    pairs = []
    for i, s1 in enumerate(ids):
        for s2 in ids[i + 1:]:
            rolling = df[s1].rolling(window).corr(df[s2]).dropna()
            avg_corr = abs(float(rolling.mean())) if len(rolling) > 0 else 0
            pairs.append((f"{s1}:{s2}", rolling, avg_corr))
    # Cap to top-10 most correlated pairs when n > 10
    if len(ids) > 10:
        pairs.sort(key=lambda x: x[2], reverse=True)
        pairs = pairs[:10]
    for key, rolling, _ in pairs:
        result[key] = [{"date": d.isoformat(), "value": _safe_float(v)} for d, v in rolling.items()]
    return result


def compute_avg_pairwise_correlation(corr_matrix: dict) -> Optional[float]:
    ids = list(corr_matrix.keys())
    n = len(ids)
    if n < 2:
        return None
    total = 0
    count = 0
    for i, s1 in enumerate(ids):
        for s2 in ids[i + 1:]:
            val = corr_matrix.get(s1, {}).get(s2)
            if val is not None:
                total += val
                count += 1
    return _safe_float(total / count) if count > 0 else None


def compute_risk_decomposition(weights: list[float], covariance_matrix: np.ndarray) -> list[dict]:
    w = np.array(weights)
    port_var = w @ covariance_matrix @ w
    port_vol = np.sqrt(port_var) if port_var > 0 else 0
    if port_vol == 0:
        return [{"marginal_risk_pct": 0, "standalone_vol": 0, "component_var": 0} for _ in weights]
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


def compute_attribution(weights: list[float], strategy_twrs: list[float], portfolio_twr: float) -> list[dict]:
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
