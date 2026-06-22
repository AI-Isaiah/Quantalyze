"""Weight optimizer (Phase 28, OPT-01 + OPT-02) — the milestone's lone new
analytics-service compute.

PURE: no DB, no FastAPI, no network, no global state — given aligned daily-return
series it returns suggested long-only weights (or `None` on a degenerate /
under-sampled input). The router (`routers/optimizer.py`) is the thin transport.

Design (locked in 28-CONTEXT.md):
  - Covariance: a HAND-ROLLED analytical Ledoit-Wolf shrinkage toward a scaled
    identity (Ledoit & Wolf 2004, JMVA "A well-conditioned estimator for
    large-dimensional covariance matrices"). NO scikit-learn dep — ~30 lines of
    numpy. Shrinkage is the whole point: a raw sample covariance over an N-just-
    above-floor window is ill-conditioned and over-optimizes in-sample; shrinkage
    pulls it toward structure so min-vol is robust and the matrix is invertible.
  - Solver: scipy.optimize.minimize(method="SLSQP"), long-only (w_i in [0,1]),
    fully invested (sum w = 1). DETERMINISTIC: fixed equal-weight start, no random
    restart — identical input ⇒ identical weights (OPT-02), and a 1-day data
    extension moves weights by < a few %.
  - Annualization: 252 (product-wide; matches metrics.py np.sqrt(252) and the
    frontend computeScenario), so suggested weights fed back through the engine
    are convention-consistent.
  - min-vol is the DEFAULT (robust). max-Sharpe is gated + caveated as in-sample-
    optimistic by the caller.
  - Degeneracy gate (OPT-02): need n comfortably > k (a sample covariance over
    n < k observations is rank-deficient; even shrunk it is not honest). Below the
    gate, or on a non-finite / constant input, return None — never a fabricated
    weight vector. The caller renders the honest empty state.

Loss/none semantics mirror the frontend: degenerate ⇒ None ⇒ em-dash, never a 0.
"""

from __future__ import annotations

import logging
from typing import Literal

import numpy as np
import numpy.typing as npt
from scipy.optimize import minimize

logger = logging.getLogger("quantalyze.analytics.optimizer")

TRADING_DAYS = 252

Objective = Literal["min_vol", "max_sharpe"]

# Degeneracy gate: require at least this many overlapping observations, AND at
# least MIN_OBS_PER_STRATEGY observations per strategy. A sample covariance needs
# n > k to be full-rank; we demand a comfortable margin so the (shrunk) estimate
# is not dominated by noise. SAMPLE_FLOOR mirrors the frontend's distributional
# floor (Phase 22, SAMPLE_FLOOR_OVERLAPPING_DAYS=60) — kept in sync by the
# golden-fixture parity test, not imported across the service boundary.
SAMPLE_FLOOR = 60
MIN_OBS_PER_STRATEGY = 10


class OptimizerResult:
    """Plain result holder (the router maps it to the pydantic response)."""

    def __init__(
        self,
        *,
        ok: bool,
        objective: Objective,
        n: int,
        k: int,
        weights: dict[str, float] | None,
        reason: str,
    ) -> None:
        self.ok = ok
        self.objective = objective
        self.n = n
        self.k = k
        self.weights = weights
        self.reason = reason
        self.in_sample = True  # ALWAYS — never present these as a forecast.


def ledoit_wolf_shrinkage(returns: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    """Analytical Ledoit-Wolf shrinkage of the sample covariance toward a scaled
    identity target ``m·I`` (Ledoit & Wolf 2004, JMVA).

    ``returns`` is a ``T x N`` matrix (T observations, N assets) of daily returns.
    Returns the ``N x N`` shrunk **daily** covariance (the caller annualizes).
    Deterministic and well-conditioned (invertible for m > 0). Never raises on a
    well-formed finite matrix; the caller guards non-finite / constant inputs.
    """
    t, n = returns.shape
    # Demean each column (asset). Population covariance (divide by T) per LW.
    x = returns - returns.mean(axis=0, keepdims=True)
    sample = (x.T @ x) / t  # N x N sample covariance

    # Target: m·I where m = average variance = trace(S)/N.
    m = np.trace(sample) / n
    target = m * np.eye(n)

    # d^2 = ||S - m·I||_F^2 / N  (dispersion of S around the target)
    d2 = np.sum((sample - target) ** 2) / n

    # b̄^2 = (1/N) * (1/T^2) * Σ_t ||x_t x_t^T - S||_F^2  (per-obs estimation noise)
    # Vectorized: for each observation t, the outer product x_t x_t^T minus S.
    b_bar2 = 0.0
    for i in range(t):
        xi = x[i : i + 1, :]  # 1 x N
        outer = xi.T @ xi  # N x N
        b_bar2 += np.sum((outer - sample) ** 2)
    b_bar2 = b_bar2 / (n * t * t)

    # b^2 = min(b̄^2, d^2); shrinkage ρ = b^2 / d^2 (clamped to [0,1]).
    b2 = min(b_bar2, d2)
    shrinkage = 0.0 if d2 <= 0 else max(0.0, min(1.0, b2 / d2))

    shrunk: npt.NDArray[np.float64] = shrinkage * target + (1.0 - shrinkage) * sample
    return shrunk


def optimize_weights(
    series_by_id: dict[str, list[tuple[str, float]]],
    objective: Objective = "min_vol",
) -> OptimizerResult:
    """Suggest long-only, fully-invested weights for ``objective`` over the
    common-date overlap of ``series_by_id`` (id -> [(date, daily_return), ...]).

    Returns an ``OptimizerResult``; ``weights is None`` (ok=False) on any
    degenerate / under-sampled input — never a fabricated vector.
    """
    ids = list(series_by_id.keys())
    k = len(ids)

    # 1. Need >= 2 strategies to optimize a blend at all.
    if k < 2:
        return OptimizerResult(ok=False, objective=objective, n=0, k=k, weights=None, reason="few-strategies")

    # 2. Align on the INTERSECTION of dates (never zero-fill — that invents
    #    correlation). Build a date -> {id: value} map, keep dates present in ALL.
    per_id_maps: dict[str, dict[str, float]] = {}
    for sid in ids:
        m: dict[str, float] = {}
        for date, value in series_by_id[sid]:
            m[date] = value
        per_id_maps[sid] = m
    common_dates = sorted(set.intersection(*[set(m.keys()) for m in per_id_maps.values()]))
    n = len(common_dates)

    # 3. Degeneracy gate (OPT-02): n must clear the sample floor AND be comfortably
    #    larger than k (rank). Below ⇒ honest absence, no weights.
    if n < SAMPLE_FLOOR or n < MIN_OBS_PER_STRATEGY * k:
        return OptimizerResult(ok=False, objective=objective, n=n, k=k, weights=None, reason="below-sample-gate")

    returns = np.array(
        [[per_id_maps[sid][d] for sid in ids] for d in common_dates],
        dtype=float,
    )  # n x k

    # 4. Non-finite contaminant anywhere ⇒ null (mirror the engine's guard).
    if not np.all(np.isfinite(returns)):
        return OptimizerResult(ok=False, objective=objective, n=n, k=k, weights=None, reason="non-finite")

    # 5. A column with zero variance (a constant strategy) makes the problem
    #    degenerate; surface null rather than a misleading "park everything here".
    col_std = returns.std(axis=0)
    if np.any(col_std <= 1e-12):
        return OptimizerResult(ok=False, objective=objective, n=n, k=k, weights=None, reason="constant-series")

    # 6. Ledoit-Wolf shrunk DAILY covariance, annualized to 252.
    cov = ledoit_wolf_shrinkage(returns) * TRADING_DAYS
    mean_annual = returns.mean(axis=0) * TRADING_DAYS

    # 6b. max-Sharpe on an all-losing book is a mean-variance pathology: it would
    # concentrate in the "least-negative-Sharpe" leg and present a confident
    # weight with only the generic in-sample caveat. Surface honest absence
    # instead — there is no positive risk-adjusted return to maximize.
    if objective == "max_sharpe" and float(np.max(mean_annual)) <= 0:
        return OptimizerResult(
            ok=False, objective=objective, n=n, k=k, weights=None, reason="no-positive-drift"
        )

    x0 = np.full(k, 1.0 / k)
    bounds = [(0.0, 1.0)] * k
    constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]

    if objective == "max_sharpe":
        def neg_objective(w: npt.NDArray[np.float64]) -> float:
            variance = float(w @ cov @ w)
            vol = float(np.sqrt(max(variance, 1e-18)))
            return float(-(w @ mean_annual) / vol)
    else:  # min_vol (default)
        def neg_objective(w: npt.NDArray[np.float64]) -> float:
            return float(w @ cov @ w)

    result = minimize(
        neg_objective,
        x0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 500, "ftol": 1e-12},
    )

    if not result.success or not np.all(np.isfinite(result.x)):
        logger.info("optimizer SLSQP did not converge (objective=%s, n=%s, k=%s): %s", objective, n, k, result.message)
        return OptimizerResult(ok=False, objective=objective, n=n, k=k, weights=None, reason="no-convergence")

    # Clean the solution: clip tiny negatives from numerical slack, renormalize.
    w = np.clip(result.x, 0.0, 1.0)
    total = w.sum()
    if total <= 0 or not np.isfinite(total):
        return OptimizerResult(ok=False, objective=objective, n=n, k=k, weights=None, reason="no-convergence")
    w = w / total

    weights = {sid: round(float(wi), 6) for sid, wi in zip(ids, w)}
    return OptimizerResult(ok=True, objective=objective, n=n, k=k, weights=weights, reason="ok")
