import numpy as np
import pandas as pd
from typing import Optional
from services.metrics import _safe_float


def find_improvement_candidates(
    portfolio_returns: dict[str, pd.Series],
    candidate_returns: dict[str, pd.Series],
    weights: dict[str, float],
    w1: float = 0.4, w2: float = 0.3, w3: float = 0.3,
    add_weight: float = 0.10,
) -> list[dict]:
    port_df = pd.DataFrame(portfolio_returns).dropna()
    if port_df.empty:
        return []
    w_arr = np.array([weights.get(sid, 0) for sid in port_df.columns])
    if w_arr.sum() > 0:
        w_arr = w_arr / w_arr.sum()
    port_returns = (port_df * w_arr).sum(axis=1)
    current_sharpe = _compute_sharpe(port_returns)
    current_avg_corr = _avg_corr(port_df)
    current_max_dd = _max_drawdown(port_returns)
    results = []
    for cid, c_returns in candidate_returns.items():
        aligned = pd.concat([port_df, c_returns.rename(cid)], axis=1).dropna()
        if len(aligned) < 30:
            continue
        new_weights = {sid: w * (1 - add_weight) for sid, w in weights.items()}
        new_weights[cid] = add_weight
        w_new = np.array([new_weights.get(col, 0) for col in aligned.columns])
        if w_new.sum() > 0:
            w_new = w_new / w_new.sum()
        new_port = (aligned * w_new).sum(axis=1)
        new_sharpe = _compute_sharpe(new_port)
        new_avg_corr = _avg_corr(aligned)
        new_max_dd = _max_drawdown(new_port)
        # Use already-aligned frame to compute correlation with portfolio returns
        port_aligned = (aligned[list(port_df.columns)] * w_arr).sum(axis=1)
        corr_with_portfolio = float(port_aligned.corr(aligned[cid])) if len(aligned) > 10 else 0
        sharpe_lift = (new_sharpe - current_sharpe) if current_sharpe is not None and new_sharpe is not None else 0
        corr_reduction = (current_avg_corr - new_avg_corr) if current_avg_corr is not None and new_avg_corr is not None else 0
        dd_improvement = (current_max_dd - new_max_dd) if current_max_dd is not None and new_max_dd is not None else 0
        score = w1 * sharpe_lift + w2 * corr_reduction + w3 * dd_improvement
        results.append({
            "strategy_id": cid,
            "corr_with_portfolio": _safe_float(corr_with_portfolio),
            "sharpe_lift": _safe_float(sharpe_lift),
            "dd_improvement": _safe_float(dd_improvement),
            "score": _safe_float(score),
        })
    return sorted(results, key=lambda x: x["score"], reverse=True)[:5]


def generate_narrative(analytics: dict) -> str:
    parts = []
    mtd = analytics.get("return_mtd")
    if mtd is not None:
        parts.append(f"Your portfolio returned {mtd * 100:+.1f}% MTD (TWR)")
    attr = analytics.get("attribution_breakdown", [])
    if attr:
        top = max(attr, key=lambda a: abs(a.get("contribution", 0)))
        parts.append(f"driven primarily by {top.get('strategy_name', 'unknown')} ({top['contribution'] * 100:+.2f}% contribution)")
    avg_corr = analytics.get("avg_pairwise_correlation")
    if avg_corr is not None:
        quality = "well-diversified" if avg_corr < 0.3 else "moderately correlated" if avg_corr < 0.6 else "highly correlated"
        parts.append(f"Average pairwise correlation is {avg_corr:.2f}, which is {quality}")
    risk = analytics.get("risk_decomposition", [])
    if risk:
        top_risk = max(risk, key=lambda r: r.get("marginal_risk_pct", 0))
        if top_risk.get("marginal_risk_pct", 0) > top_risk.get("weight_pct", 0) * 1.2:
            parts.append(
                f"Risk is concentrated in {top_risk.get('strategy_name', 'unknown')} "
                f"({top_risk['marginal_risk_pct']:.0f}% of portfolio volatility on "
                f"{top_risk.get('weight_pct', 0):.0f}% of capital)"
            )
    return ". ".join(parts) + "." if parts else "Portfolio analytics pending computation."


def _compute_sharpe(returns: pd.Series, rf: float = 0) -> Optional[float]:
    if returns.empty or returns.std() == 0:
        return None
    return _safe_float(float((returns.mean() - rf) / returns.std() * np.sqrt(252)))


def _avg_corr(df: pd.DataFrame) -> Optional[float]:
    if df.shape[1] < 2:
        return None
    corr = df.corr()
    n = len(corr)
    total = (corr.values.sum() - n) / (n * (n - 1))
    return _safe_float(float(total))


def _max_drawdown(returns: pd.Series) -> Optional[float]:
    if returns.empty:
        return None
    cumulative = (1 + returns).cumprod()
    running_max = cumulative.cummax()
    drawdown = (cumulative - running_max) / running_max
    return _safe_float(float(drawdown.min()))
