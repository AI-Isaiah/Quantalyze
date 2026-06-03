import logging
import numpy as np
import pandas as pd
from datetime import date as _date
from typing import Any, Optional
from services.metrics import _safe_float

logger = logging.getLogger("quantalyze.analytics.portfolio_optimizer")


def find_improvement_candidates(
    portfolio_returns: dict[str, pd.Series],
    candidate_returns: dict[str, pd.Series],
    weights: dict[str, float],
    w1: float = 0.4, w2: float = 0.3, w3: float = 0.3,
    add_weight: float = 0.10,
) -> list[dict[str, Any]]:
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
    results: list[dict[str, Any]] = []
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
        # M-0701: exclude a degenerate candidate whose OWN aligned returns have
        # zero variance (e.g. a paused/all-zero strategy). Its correlation and
        # diversification signal are undefined (NaN), so it cannot be
        # meaningfully scored — dropping it is correct rather than ranking it on
        # a partial 0-collapsed score that looks like a real "no improvement".
        #
        # This keys on the CANDIDATE column only (candidate-specific). It does
        # NOT gate on new_avg_corr: _avg_corr is computed over the WHOLE blended
        # frame, so a single flat EXISTING strategy would poison it to None for
        # every candidate and silently drop ALL suggestions. A None new_avg_corr
        # from a flat existing strategy instead leaves the correlation term at 0
        # below, uniform across candidates. (new_sharpe/new_max_dd None — an
        # exactly-zero-variance or empty blend — is also defensively excluded,
        # though float noise makes new_sharpe None practically unreachable.)
        if float(aligned[cid].std()) == 0.0 or new_sharpe is None or new_max_dd is None:
            logger.debug(
                "find_improvement_candidates: dropping degenerate candidate %s "
                "(zero-variance returns or unscoreable blend)", cid,
            )
            continue
        # Use already-aligned frame to compute correlation with portfolio returns
        port_aligned = (aligned[list(port_df.columns)] * w_arr).sum(axis=1)
        corr_with_portfolio = float(port_aligned.corr(aligned[cid])) if len(aligned) > 10 else 0
        # A None metric on EITHER side of a delta means that axis has no
        # comparable baseline (uniform across candidates), so it contributes 0.
        sharpe_lift = (new_sharpe - current_sharpe) if current_sharpe is not None else 0
        corr_reduction = (
            (current_avg_corr - new_avg_corr)
            if current_avg_corr is not None and new_avg_corr is not None
            else 0
        )
        dd_improvement = (current_max_dd - new_max_dd) if current_max_dd is not None else 0
        score = w1 * sharpe_lift + w2 * corr_reduction + w3 * dd_improvement
        results.append({
            "strategy_id": cid,
            "corr_with_portfolio": _safe_float(corr_with_portfolio),
            "sharpe_lift": _safe_float(sharpe_lift),
            "dd_improvement": _safe_float(dd_improvement),
            "score": _safe_float(score),
        })
    return sorted(results, key=lambda x: x["score"], reverse=True)[:5]


def generate_narrative(analytics: dict[str, Any]) -> str:
    """Build a deterministic portfolio narrative.

    Structure:
      0. Partial-data hedge (if partial_data=True, NEW-C19-08)
      1. MTD headline + top contributor
      2. Correlation / diversification quality
      3. Risk concentration warning (if applicable)
      4. Per-month breakdown (from monthly_returns if available)
      5. Optimizer recommendation sentence (if optimizer_suggestions present)
    """
    parts = []

    # NEW-C19-08 + review-fix SF-F2: when the analytics were computed from a
    # renormalized subset OR when covariance/benchmark data was unavailable,
    # prepend disclosure sentences so the user is not misled by confident
    # whole-portfolio claims derived from partial data.
    #
    # SF-F2 root cause: the original guard only fired on `computed < expected`
    # (missing strategies), so partial_data=True caused by benchmark_error or
    # cov_history_sufficient=False silently produced no hedge text — the caller
    # received confident Sharpe/attribution prose with no caveat despite the
    # risk decomposition having been entirely skipped.
    if analytics.get("partial_data"):
        computed = analytics.get("computed_strategy_count")
        expected = analytics.get("expected_strategy_count")
        if computed is not None and expected is not None and computed < expected:
            parts.append(
                f"Computed from {computed} of {expected} strategies — "
                f"figures exclude {expected - computed} strategy/strategies with no return history"
            )
        # Covariance / risk decomposition unavailable (insufficient overlap).
        if not analytics.get("cov_history_sufficient", True):
            parts.append(
                "Risk decomposition unavailable — insufficient overlapping return history"
            )
        # Benchmark fetch failed; benchmark comparison may be absent.
        if analytics.get("benchmark_error"):
            parts.append("Benchmark comparison unavailable")
        # H-002 (red-team): equity curves missing for one or more strategies.
        # These strategies ARE included in strategy_returns (and therefore in
        # computed_strategy_count) so the `computed < expected` hedge above does
        # not fire.  TWR/attribution figures are still derived from the return
        # series; only equity-curve-dependent metrics (e.g. drawdown shape) may
        # be affected.  We disclose rather than silently produce confident prose.
        missing_equity = analytics.get("missing_equity_sids")
        if missing_equity:
            n = len(missing_equity)
            parts.append(
                f"Equity curve unavailable for {n} strategy/strategies — "
                "some metrics may be based on return series only"
            )

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

    # ── Per-month breakdown ─────────────────────────────────────────
    monthly_returns = analytics.get("monthly_returns")
    if monthly_returns and attr:
        # monthly_returns: {"2026": {"01": 0.05, "02": -0.02, ...}}
        # Pick the last 3 months that have data
        month_entries = []
        for year_str, months in sorted(monthly_returns.items()):
            for month_str, ret in sorted(months.items()):
                month_entries.append((year_str, month_str, ret))
        # Compute top contributor once (invariant across months — uses overall attribution)
        top_contrib = max(attr, key=lambda a: abs(a.get("contribution", 0)))
        total_abs = sum(abs(a.get("contribution", 0)) for a in attr) or 1
        top_share = abs(top_contrib.get("contribution", 0)) / total_abs

        for year_str, month_str, ret in month_entries[-3:]:
            try:
                month_name = _date(int(year_str), int(month_str), 1).strftime("%B %Y")
            except (ValueError, TypeError):
                month_name = f"{month_str}/{year_str}"
            # M-0903: top_share is a SIZE share (abs contribution / total abs),
            # so "drove X% of the gain" is sign-blind. When the month LOST money
            # the clause must say "decline", not "gain".
            noun = "gain" if ret >= 0 else "decline"
            parts.append(
                f"In {month_name}, portfolio returned {ret * 100:+.1f}%. "
                f"{top_contrib.get('strategy_name', 'unknown')} drove {top_share * 100:.0f}% of the {noun}"
            )

    # ── Optimizer recommendation sentence ───────────────────────────
    suggestions = analytics.get("optimizer_suggestions")
    if suggestions and len(suggestions) > 0 and attr:
        worst_attr = min(attr, key=lambda a: a.get("contribution", 0))
        best_suggestion = suggestions[0]
        sharpe_lift = best_suggestion.get("sharpe_lift", 0)
        if sharpe_lift > 0 and worst_attr.get("strategy_name"):
            # The recommendation sentence requires both a non-empty risk
            # decomposition AND a portfolio-level Sharpe to quote the before/after.
            portfolio_sharpe = analytics.get("portfolio_sharpe")
            risk_items = analytics.get("risk_decomposition", [])
            if risk_items and portfolio_sharpe is not None:
                parts.append(
                    f"If you trim {worst_attr['strategy_name']} and redistribute to "
                    f"{best_suggestion.get('strategy_name', 'top candidates')}, "
                    f"expected Sharpe moves from {portfolio_sharpe:.2f} to "
                    f"{portfolio_sharpe + sharpe_lift:.2f}"
                )
            else:
                # M-0904: the recommendation is warranted (positive lift, named
                # underperformer) but a prerequisite is missing, so the
                # actionable sentence silently vanishes. Warn so the asymmetric
                # data flow is visible rather than degrading without a signal.
                logger.warning(
                    "generate_narrative: optimizer recommendation suppressed "
                    "(sharpe_lift=%.4f, worst=%s) — %s missing",
                    sharpe_lift,
                    worst_attr.get("strategy_name"),
                    "portfolio_sharpe" if portfolio_sharpe is None else "risk_decomposition",
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
