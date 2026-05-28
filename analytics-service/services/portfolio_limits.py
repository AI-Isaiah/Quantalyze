"""Shared OWN-portfolio membership cap (NEW-C19-07).

Single source of truth for the guard that bounds the O(N^2) covariance /
correlation compute every OWN-portfolio path performs. The candidate pool
(_MATCH_CANDIDATE_LIMIT=30) and published pool (_OPTIMIZER_PUBLISHED_LIMIT=200)
were already bounded, but the allocator's OWN membership N was uncapped and
attacker-controllable (AddToPortfolio inserts with no count guard). N strategies
-> an N-column DataFrame, df.cov()/df.corr() N×N, w@cov@w, and an N×N matrix
persisted to JSONB — a memory/compute DoS.

This lives in its own module (not a router) so EVERY OWN-membership entry point
imports the same guard without a router-to-router import or a circular-import
risk: analytics (_compute_portfolio_analytics), optimizer (portfolio_optimizer),
bridge (portfolio_bridge), and the simulator (portfolio_simulator). A future
OWN-membership path should import this rather than re-deriving a cap.
"""

from __future__ import annotations

from fastapi import HTTPException

# ~16x the current prod max (6 strategies in the largest portfolio), so the cap
# bounds the matmul without rejecting any real portfolio.
MAX_PORTFOLIO_STRATEGIES = 100


def assert_portfolio_within_cap(portfolio_strategies: list[dict]) -> None:
    """Reject an oversized OWN portfolio at the boundary, BEFORE any O(N^2)
    cov/correlation matmul + N×N JSONB persist runs (and before a compute permit
    is consumed). Raises HTTPException 413 when membership exceeds
    ``MAX_PORTFOLIO_STRATEGIES``; the detail carries the actual + max counts
    (no table names / schema reconnaissance)."""
    n = len(portfolio_strategies)
    if n > MAX_PORTFOLIO_STRATEGIES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Portfolio has {n} strategies; the maximum supported for "
                f"analytics is {MAX_PORTFOLIO_STRATEGIES}."
            ),
        )
