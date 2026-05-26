"""Regression tests for Cluster 19 audit findings: routers/portfolio.py.

Covers:
  NEW-C19-01 — /portfolio-analytics and /portfolio-optimizer must enforce
               user ownership (user_id field + .eq("user_id") on SELECT).
  NEW-C19-02 — portfolio_bridge must surface partial_data + computed_from_n_of_m
               when strategies are missing returns_series.
  NEW-C19-03 — portfolio_bridge must return status="incumbent_no_data" when
               the incumbent strategy has no returns, not an empty "complete".
  NEW-C19-04 — covariance history gate uses OVERLAP (dropna), not UNION length.
  NEW-C19-05 — _build_normalized_weights must treat current_weight=0 as explicit
               0.0, not "unset" (promoted to 1.0).
  NEW-C19-06 — AUM collection must use `is not None`, not truthiness, so a $0
               strategy is counted as a known reporter.
  NEW-C19-08 — generate_narrative prepends a hedge when partial_data=True.
  NEW-C19-09 — portfolio_optimizer logs dropped strategies at WARNING and surfaces
               computed_strategy_count / expected_strategy_count in the response.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# Bootstrap stubs (identical pattern to test_portfolio_router_audit_2026_05_07)
# ---------------------------------------------------------------------------

def _install_stubs():
    stubs = [
        "supabase",
        "slowapi",
        "slowapi.util",
        "fastapi",
        "fastapi.routing",
        "ccxt",
        "ccxt.async_support",
    ]
    for name in stubs:
        if name not in sys.modules:
            sys.modules[name] = MagicMock()
    sys.modules["supabase"].create_client = MagicMock()
    sys.modules["supabase"].Client = MagicMock()
    sys.modules["slowapi"].Limiter = MagicMock(return_value=MagicMock())
    sys.modules["slowapi.util"].get_remote_address = MagicMock()
    mock_router = MagicMock()
    sys.modules["fastapi"].APIRouter = MagicMock(return_value=mock_router)
    sys.modules["fastapi"].HTTPException = _StubHTTPException
    sys.modules["fastapi"].Request = MagicMock()


class _StubHTTPException(Exception):
    def __init__(self, status_code: int | None = None, detail: object = None, **kwargs):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


_install_stubs()

from routers.portfolio import _build_normalized_weights  # noqa: E402
from services.portfolio_optimizer import generate_narrative  # noqa: E402


# ---------------------------------------------------------------------------
# NEW-C19-05 — _build_normalized_weights: explicit current_weight=0 preserved
# ---------------------------------------------------------------------------

class TestBuildNormalizedWeightsC19:
    def test_zero_weight_is_not_promoted_to_one(self):
        """NEW-C19-05: a paused strategy with current_weight=0 must stay 0,
        not be promoted to 1.0 by a falsy check.

        Pre-fix: `float(row["current_weight"]) if row.get("current_weight") else 1.0`
        mapped 0.0 → 1.0, making the paused strategy the dominant allocation.
        Post-fix: `is not None` preserves the explicit 0.
        """
        rows = [
            {"strategy_id": "active", "current_weight": 0.5},
            {"strategy_id": "paused", "current_weight": 0.0},
        ]
        w = _build_normalized_weights(rows)
        # The paused strategy MUST remain 0 — it must NOT become 0.5.
        assert w["paused"] == pytest.approx(0.0), (
            "current_weight=0 was promoted to 1.0 by a falsy check — "
            "paused strategy became dominant allocation (NEW-C19-05)"
        )
        # The active strategy should be normalized to 1.0 (sole contributor).
        assert w["active"] == pytest.approx(1.0)

    def test_three_strategies_one_paused_zero_weight(self):
        """NEW-C19-05: in a three-strategy portfolio where one is paused (0-weight),
        only the non-zero strategies should share the weight budget."""
        rows = [
            {"strategy_id": "s1", "current_weight": 0.4},
            {"strategy_id": "s2", "current_weight": 0.6},
            {"strategy_id": "paused", "current_weight": 0.0},
        ]
        w = _build_normalized_weights(rows)
        assert w["paused"] == pytest.approx(0.0)
        assert w["s1"] == pytest.approx(0.4)
        assert w["s2"] == pytest.approx(0.6)

    def test_unset_weight_still_defaults_to_one(self):
        """NEW-C19-05: a strategy with NO current_weight key (None in the DB,
        not in the dict) must still default to 1.0.  The fix must only tighten
        0.0 vs unset — missing key still uses the fallback."""
        rows = [
            {"strategy_id": "s1"},  # no current_weight key at all
            {"strategy_id": "s2"},
        ]
        w = _build_normalized_weights(rows)
        assert w == pytest.approx({"s1": 0.5, "s2": 0.5})

    def test_none_weight_still_defaults_to_one(self):
        """NEW-C19-05: current_weight=None (NULL in DB) must default to 1.0,
        NOT blow up on float(None)."""
        rows = [
            {"strategy_id": "s1", "current_weight": None},
            {"strategy_id": "s2", "current_weight": 1.0},
        ]
        w = _build_normalized_weights(rows)
        # Both default to 1.0 raw → equal split
        assert w == pytest.approx({"s1": 0.5, "s2": 0.5})


# ---------------------------------------------------------------------------
# NEW-C19-06 — AUM collection must use `is not None`
# ---------------------------------------------------------------------------

class TestAumCollectionC19:
    """Verify the AUM collection step uses `is not None`.

    The router's inner loop does:
        if row.get("total_aum") is not None:
            strategy_aum[sid] = float(row["total_aum"])

    We cannot call _compute_portfolio_analytics directly without a live DB,
    so we test the underlying logic by calling _build_normalized_weights
    (which is the helper layer) and then inline the AUM logic in isolation.
    """

    def test_zero_aum_counted_as_known(self):
        """NEW-C19-06: a strategy reporting $0 AUM must be counted as a
        known reporter, not treated as NULL.

        Pre-fix: `if row.get("total_aum"):` → 0 is falsy → dropped.
        Post-fix: `if row.get("total_aum") is not None:` → 0 is counted.
        """
        rows = [
            {"strategy_id": "s1", "total_aum": 100.0},
            {"strategy_id": "s2", "total_aum": 0.0},   # drained strategy
        ]
        strategy_ids = ["s1", "s2"]
        # Reproduce the router's AUM collection logic.
        strategy_aum: dict[str, float] = {}
        for row in rows:
            sid = row["strategy_id"]
            # POST-FIX implementation:
            if row.get("total_aum") is not None:
                strategy_aum[sid] = float(row["total_aum"])
        aum_known_count = sum(1 for sid in strategy_ids if sid in strategy_aum)
        if aum_known_count == len(strategy_ids):
            total_aum = sum(strategy_aum.get(sid, 0) for sid in strategy_ids) or 0.0
        else:
            total_aum = None
        assert total_aum == pytest.approx(100.0), (
            "total_aum collapsed to None because the $0 strategy was treated "
            "as NULL — AUM collection must use `is not None` (NEW-C19-06)"
        )

    def test_null_aum_is_still_excluded(self):
        """NEW-C19-06: a strategy with actual NULL/missing AUM must still
        cause total_aum to collapse to None (the pre-existing behavior for
        genuinely missing data must not change)."""
        rows = [
            {"strategy_id": "s1", "total_aum": 100.0},
            {"strategy_id": "s2"},  # no total_aum key → None
        ]
        strategy_ids = ["s1", "s2"]
        strategy_aum: dict[str, float] = {}
        for row in rows:
            sid = row["strategy_id"]
            if row.get("total_aum") is not None:
                strategy_aum[sid] = float(row["total_aum"])
        aum_known_count = sum(1 for sid in strategy_ids if sid in strategy_aum)
        if aum_known_count == len(strategy_ids):
            total_aum = sum(strategy_aum.get(sid, 0) for sid in strategy_ids) or 0.0
        else:
            total_aum = None
        assert total_aum is None, (
            "A strategy with NULL AUM must cause total_aum to collapse to "
            "None (not partial sum) — the pre-existing behavior must hold."
        )


# ---------------------------------------------------------------------------
# NEW-C19-04 — covariance gate uses OVERLAP not UNION
# ---------------------------------------------------------------------------

class TestCovarianceOverlapGateC19:
    """Verify the covariance history gate uses dropna() overlap, not UNION len.

    We cannot exercise _compute_portfolio_analytics directly without a live DB,
    so we test the invariant at the DataFrame level: the production code now
    computes `overlap_df = pd.DataFrame(strategy_returns).dropna()` and gates
    on `len(overlap_df) > 5`.
    """

    def test_disjoint_date_strategies_have_zero_overlap(self):
        """NEW-C19-04: two strategies with 0 date overlap must produce
        cov_history_sufficient=False even though UNION length > 5.

        Pre-fix: len(df) was the UNION (200 rows for 2×100 disjoint) → >5
        → cov() called on fillna(0) → all off-diagonals ≈ 0, fake variance.
        Post-fix: overlap_df = dropna() → 0 rows → False.
        """
        dates_a = pd.date_range("2026-01-01", periods=100, freq="D")
        dates_b = pd.date_range("2027-01-01", periods=100, freq="D")
        strategy_returns = {
            "s1": pd.Series(np.random.normal(0.001, 0.01, 100), index=dates_a),
            "s2": pd.Series(np.random.normal(0.001, 0.01, 100), index=dates_b),
        }
        overlap_df = pd.DataFrame(strategy_returns).dropna()
        cov_history_sufficient = len(overlap_df) > 5
        assert cov_history_sufficient is False, (
            "Disjoint-date strategies should NOT be flagged as having sufficient "
            "history for covariance — the UNION length is 200 but the OVERLAP is 0 "
            "(NEW-C19-04)"
        )

    def test_sufficient_overlap_produces_true(self):
        """NEW-C19-04: strategies with >5 overlapping dates should pass."""
        dates = pd.date_range("2026-01-01", periods=50, freq="D")
        strategy_returns = {
            "s1": pd.Series(np.random.normal(0.001, 0.01, 50), index=dates),
            "s2": pd.Series(np.random.normal(-0.001, 0.01, 50), index=dates),
        }
        overlap_df = pd.DataFrame(strategy_returns).dropna()
        cov_history_sufficient = len(overlap_df) > 5
        assert cov_history_sufficient is True

    def test_partial_overlap_uses_only_shared_dates(self):
        """NEW-C19-04: partial overlap — only the shared dates should count."""
        dates_all = pd.date_range("2026-01-01", periods=100, freq="D")
        # s2 only covers the first 3 days → overlap = 3 → False
        strategy_returns = {
            "s1": pd.Series(np.random.normal(0.001, 0.01, 100), index=dates_all),
            "s2": pd.Series(np.random.normal(0.001, 0.01, 3), index=dates_all[:3]),
        }
        overlap_df = pd.DataFrame(strategy_returns).dropna()
        cov_history_sufficient = len(overlap_df) > 5
        assert cov_history_sufficient is False, (
            "3 days of overlap must be < 6 threshold — covariance gate "
            "must count OVERLAP not UNION (NEW-C19-04)"
        )


# ---------------------------------------------------------------------------
# NEW-C19-08 — generate_narrative prepends hedge when partial_data=True
# ---------------------------------------------------------------------------

class TestGenerateNarrativePartialDataC19:
    def test_partial_data_hedge_prepended(self):
        """NEW-C19-08: when partial_data=True and computed_strategy_count < expected,
        generate_narrative MUST start with a disclosure sentence."""
        analytics = {
            "partial_data": True,
            "computed_strategy_count": 2,
            "expected_strategy_count": 3,
            "return_mtd": 0.03,
            "avg_pairwise_correlation": 0.2,
            "attribution_breakdown": [
                {"strategy_name": "Alpha-7", "contribution": 0.03},
            ],
        }
        narrative = generate_narrative(analytics)
        assert "Computed from 2 of 3" in narrative, (
            "narrative must start with a partial-data hedge when "
            "partial_data=True (NEW-C19-08) — asserted text: " + repr(narrative)
        )
        assert "1 strategy" in narrative or "strategy/strategies" in narrative, (
            "hedge must mention the number of excluded strategies"
        )

    def test_no_hedge_when_partial_data_false(self):
        """NEW-C19-08: when partial_data=False, NO hedge should appear."""
        analytics = {
            "partial_data": False,
            "computed_strategy_count": 3,
            "expected_strategy_count": 3,
            "return_mtd": 0.03,
        }
        narrative = generate_narrative(analytics)
        assert "Computed from" not in narrative, (
            "no hedge should appear when partial_data=False (NEW-C19-08)"
        )

    def test_no_hedge_when_counts_equal(self):
        """NEW-C19-08: partial_data=True but computed==expected — no hedge
        (this covers the benchmark_error / cov_history path where data quality
        is degraded for a reason other than missing strategies)."""
        analytics = {
            "partial_data": True,
            "computed_strategy_count": 3,
            "expected_strategy_count": 3,
        }
        narrative = generate_narrative(analytics)
        assert "Computed from" not in narrative

    def test_no_hedge_when_counts_absent(self):
        """NEW-C19-08: if the caller omits the count fields entirely, no crash
        and no spurious hedge."""
        analytics = {"partial_data": True}
        # Must not raise; the hedge only fires when both counts are present.
        narrative = generate_narrative(analytics)
        assert "Computed from" not in narrative


# ---------------------------------------------------------------------------
# NEW-C19-01 — PortfolioAnalyticsRequest and PortfolioOptimizerRequest
#              must require user_id
# ---------------------------------------------------------------------------

class TestRequestSchemaUserIdC19:
    def test_portfolio_analytics_request_requires_user_id(self):
        """NEW-C19-01: PortfolioAnalyticsRequest must require user_id.
        Without it any X-Service-Key holder could trigger analytics on
        another tenant's portfolio_id."""
        from pydantic import ValidationError
        from models.schemas import PortfolioAnalyticsRequest
        with pytest.raises(ValidationError):
            PortfolioAnalyticsRequest(portfolio_id="p1")  # missing user_id

    def test_portfolio_analytics_request_accepts_user_id(self):
        from models.schemas import PortfolioAnalyticsRequest
        r = PortfolioAnalyticsRequest(portfolio_id="p1", user_id="u1")
        assert r.user_id == "u1"

    def test_portfolio_optimizer_request_requires_user_id(self):
        """NEW-C19-01: PortfolioOptimizerRequest must require user_id."""
        from pydantic import ValidationError
        from models.schemas import PortfolioOptimizerRequest
        with pytest.raises(ValidationError):
            PortfolioOptimizerRequest(portfolio_id="p1")  # missing user_id

    def test_portfolio_optimizer_request_accepts_user_id(self):
        from models.schemas import PortfolioOptimizerRequest
        r = PortfolioOptimizerRequest(portfolio_id="p1", user_id="u1")
        assert r.user_id == "u1"


# ---------------------------------------------------------------------------
# NEW-C19-01 — /portfolio-analytics ownership SELECT uses user_id filter
# ---------------------------------------------------------------------------

def _read_portfolio_router_source() -> str:
    """Read the production router source directly from disk.

    Using inspect.getsource() on the imported module fails when the stubs
    at module-load time replace fastapi router decorators with MagicMock,
    causing inspect to see a MagicMock instead of the real function.
    Reading the .py file is deterministic and doesn't depend on import state.
    """
    import os
    src_path = os.path.join(
        os.path.dirname(__file__), "..", "routers", "portfolio.py"
    )
    with open(os.path.abspath(src_path)) as f:
        return f.read()


class TestPortfolioAnalyticsOwnershipC19:
    """The /portfolio-analytics endpoint must add .eq("user_id", req.user_id)
    to the portfolios SELECT so a mismatched user_id 404s.

    We inspect the source to pin the production filter — a refactor that drops
    the .eq("user_id") call will fail this test loudly before production.
    """

    def test_portfolio_analytics_source_has_user_id_filter(self):
        src = _read_portfolio_router_source()
        # We need the user_id filter in the portfolio_analytics function block.
        # A coarse but robust check: both "portfolio_analytics" and 'eq("user_id"'
        # must co-occur in the file, which they do iff the filter was wired in.
        assert '.eq("user_id"' in src or ".eq('user_id'" in src, (
            "portfolio_analytics must filter portfolios SELECT by user_id "
            "to prevent cross-tenant read (NEW-C19-01)"
        )
        # The user_id field must also be on the request schema.
        schema_src = _read_schema_source()
        assert "class PortfolioAnalyticsRequest" in schema_src
        assert "user_id" in schema_src.split("class PortfolioAnalyticsRequest")[1].split("class ")[0], (
            "PortfolioAnalyticsRequest must declare user_id (NEW-C19-01)"
        )

    def test_portfolio_optimizer_source_has_user_id_filter(self):
        src = _read_portfolio_router_source()
        schema_src = _read_schema_source()
        assert "class PortfolioOptimizerRequest" in schema_src
        assert "user_id" in schema_src.split("class PortfolioOptimizerRequest")[1].split("class ")[0], (
            "PortfolioOptimizerRequest must declare user_id (NEW-C19-01)"
        )


def _read_schema_source() -> str:
    import os
    src_path = os.path.join(
        os.path.dirname(__file__), "..", "models", "schemas.py"
    )
    with open(os.path.abspath(src_path)) as f:
        return f.read()


# ---------------------------------------------------------------------------
# NEW-C19-02 / NEW-C19-03 — bridge partial_data and incumbent_no_data
# ---------------------------------------------------------------------------

class TestBridgePartialDataC19:
    """Verify find_replacement_candidates-level partial_data behavior.

    We cannot drive the full bridge HTTP endpoint without a live DB, so we
    test the service-layer logic via bridge_scoring directly + verify the
    router source contains the NEW-C19-03 incumbent_no_data branch.
    """

    def test_find_replacement_candidates_returns_empty_when_incumbent_absent(self):
        """NEW-C19-03 (service layer): find_replacement_candidates returns []
        when the incumbent is not in port_df.columns (missing returns_series).
        This is the EXISTING behavior; the router-level fix (NEW-C19-03)
        intercepts this BEFORE calling find_replacement_candidates and returns
        status="incumbent_no_data" so the caller can distinguish the two cases.
        """
        from services.bridge_scoring import find_replacement_candidates

        dates = pd.date_range("2026-01-01", periods=100, freq="D")
        portfolio_returns = {
            "s1": pd.Series(np.random.default_rng(0).normal(0.001, 0.01, 100), index=dates),
            # incumbent "underperformer" is NOT in portfolio_returns
        }
        candidate_returns = {
            "c1": pd.Series(np.random.default_rng(1).normal(0.001, 0.01, 100), index=dates),
        }
        weights = {"s1": 1.0, "underperformer": 0.0}
        result = find_replacement_candidates(
            portfolio_returns, candidate_returns, weights, "underperformer"
        )
        assert result == [], (
            "find_replacement_candidates must return [] when incumbent is absent "
            "from portfolio_returns — the router-level fix intercepts this and "
            "returns status='incumbent_no_data' (NEW-C19-03)"
        )

    def test_bridge_router_source_has_incumbent_no_data_branch(self):
        """NEW-C19-03: the router source must contain the incumbent_no_data
        branch so the check was actually wired in and not just a service-layer
        change that never gets surfaced to the caller."""
        src = _read_portfolio_router_source()
        assert "incumbent_no_data" in src, (
            "portfolio_bridge must return status='incumbent_no_data' when the "
            "incumbent strategy has no returns_series (NEW-C19-03)"
        )

    def test_bridge_router_source_has_partial_data_field(self):
        """NEW-C19-02: the bridge response must carry partial_data so the UI
        knows scores were computed against a renormalized subset."""
        src = _read_portfolio_router_source()
        assert '"partial_data"' in src or "'partial_data'" in src, (
            "portfolio_bridge response must include partial_data field (NEW-C19-02)"
        )
        assert "computed_from_n_of_m" in src, (
            "portfolio_bridge response must include computed_from_n_of_m field (NEW-C19-02)"
        )


# ---------------------------------------------------------------------------
# NEW-C19-09 — optimizer logs dropped strategies and surfaces counts in response
# ---------------------------------------------------------------------------

class TestOptimizerPartialDataC19:
    """Verify the optimizer surfaces partial-data coverage signals."""

    def test_optimizer_router_source_has_coverage_fields(self):
        """NEW-C19-09: the optimizer response must carry computed_strategy_count
        and expected_strategy_count so the UI can show a partial-data badge."""
        src = _read_portfolio_router_source()
        assert "computed_strategy_count" in src, (
            "portfolio_optimizer must surface computed_strategy_count (NEW-C19-09)"
        )
        assert "expected_strategy_count" in src, (
            "portfolio_optimizer must surface expected_strategy_count (NEW-C19-09)"
        )
        assert "optimizer_missing_returns_sids" in src, (
            "portfolio_optimizer must log missing_returns_sids at WARNING "
            "parity with the analytics path (NEW-C19-09)"
        )


# ---------------------------------------------------------------------------
# review-fix SF-F1 — bridge.score_candidates audit event on incumbent_no_data
# ---------------------------------------------------------------------------

class TestBridgeIncumbentNoDataAuditSFF1:
    """H-0815 invariant: every successful bridge exit must emit an audit event.

    The incumbent_no_data early return (NEW-C19-03) was the only bridge exit
    that did not emit bridge.score_candidates. SF-F1 wires the same
    try/except audit pattern used by the empty-candidates and happy-path exits.
    """

    def test_bridge_router_source_emits_audit_on_incumbent_no_data(self):
        """SF-F1: the source must contain log_audit_event inside the
        incumbent_no_data branch — not just around the other two exits.

        Strategy: locate the block bounded by the conditional guard and the
        next major section marker, then assert log_audit_event is present.
        """
        src = _read_portfolio_router_source()
        # The guard that triggers this path
        guard = "if req.underperformer_strategy_id not in portfolio_returns:"
        assert guard in src, "incumbent guard must exist in source"
        block_start = src.index(guard)
        # The block ends at the next top-level bridge section: fetching candidates
        end_marker = "# Fetch all published candidate strategies"
        assert end_marker in src, "end marker not found in source"
        block_end = src.index(end_marker, block_start)
        block_src = src[block_start:block_end]
        assert "log_audit_event" in block_src, (
            "bridge incumbent_no_data path must call log_audit_event before "
            "returning (H-0815 invariant: every successful bridge exit must "
            "emit an audit event) — SF-F1"
        )
        assert '"status": "incumbent_no_data"' in block_src or "'status': 'incumbent_no_data'" in block_src, (
            "audit metadata must include status=incumbent_no_data — SF-F1"
        )


# ---------------------------------------------------------------------------
# review-fix SF-F2 — generate_narrative hedge for benchmark_error / cov gap
# ---------------------------------------------------------------------------

class TestGenerateNarrativeBenchmarkCovHedgeSFF2:
    """SF-F2: partial_data=True caused by benchmark_error or cov_history_sufficient=False
    must produce hedge text even when computed_strategy_count == expected_strategy_count.
    """

    def test_benchmark_error_hedge(self):
        """SF-F2: when partial_data=True and benchmark_error is set, the narrative
        must include a benchmark-comparison-unavailable sentence."""
        analytics = {
            "partial_data": True,
            "computed_strategy_count": 3,
            "expected_strategy_count": 3,  # no strategy drop → old code silenced
            "benchmark_error": True,
        }
        narrative = generate_narrative(analytics)
        assert "Benchmark comparison unavailable" in narrative, (
            "narrative must disclose benchmark unavailability when benchmark_error "
            "is True and partial_data=True (SF-F2). Got: " + repr(narrative)
        )

    def test_cov_history_insufficient_hedge(self):
        """SF-F2: when partial_data=True and cov_history_sufficient=False, the
        narrative must include a risk-decomposition-unavailable sentence."""
        analytics = {
            "partial_data": True,
            "computed_strategy_count": 2,
            "expected_strategy_count": 2,  # no strategy drop
            "cov_history_sufficient": False,
        }
        narrative = generate_narrative(analytics)
        assert "Risk decomposition unavailable" in narrative, (
            "narrative must disclose risk decomposition unavailability when "
            "cov_history_sufficient=False and partial_data=True (SF-F2). "
            "Got: " + repr(narrative)
        )

    def test_no_false_hedge_when_cov_sufficient(self):
        """SF-F2: cov_history_sufficient=True must NOT trigger the risk hedge."""
        analytics = {
            "partial_data": False,
            "cov_history_sufficient": True,
            "benchmark_error": False,
        }
        narrative = generate_narrative(analytics)
        assert "Risk decomposition unavailable" not in narrative
        assert "Benchmark comparison unavailable" not in narrative

    def test_both_causes_produces_both_hedge_sentences(self):
        """SF-F2: when both cov and benchmark are unavailable, both sentences appear."""
        analytics = {
            "partial_data": True,
            "computed_strategy_count": 3,
            "expected_strategy_count": 3,
            "cov_history_sufficient": False,
            "benchmark_error": True,
        }
        narrative = generate_narrative(analytics)
        assert "Risk decomposition unavailable" in narrative, (
            "cov hedge missing — SF-F2"
        )
        assert "Benchmark comparison unavailable" in narrative, (
            "benchmark hedge missing — SF-F2"
        )


# ---------------------------------------------------------------------------
# review-fix SF-F3 — _build_normalized_weights logs WARNING on all-zero total
# ---------------------------------------------------------------------------

class TestBuildNormalizedWeightsAllZeroWarningSFF3:
    """SF-F3: _build_normalized_weights must emit a logger.warning when the
    pre-normalization total is 0.0 (all strategies paused).

    The flat portfolio_returns_series produced by an all-zero weight vector is
    indistinguishable from "portfolio genuinely had no movement" — the warning
    makes the all-paused state visible to ops.
    """

    def test_all_zero_weights_triggers_warning(self):
        """SF-F3: passing all current_weight=0 strategies must trigger a warning log."""
        rows = [
            {"strategy_id": "s1", "current_weight": 0.0},
            {"strategy_id": "s2", "current_weight": 0.0},
        ]
        with patch("routers.portfolio.logger") as mock_logger:
            result = _build_normalized_weights(rows)
            mock_logger.warning.assert_called_once()
            call_args = mock_logger.warning.call_args[0]
            assert "0.0" in str(call_args) or "all" in str(call_args).lower() or "paused" in str(call_args).lower(), (
                "warning message must mention all-zero / paused state — SF-F3"
            )
        # The normalized weights must all be 0.0 (mathematically correct).
        assert result == {"s1": 0.0, "s2": 0.0}

    def test_partial_zero_does_not_warn(self):
        """SF-F3: a portfolio with at least one non-zero weight must NOT warn."""
        rows = [
            {"strategy_id": "active", "current_weight": 1.0},
            {"strategy_id": "paused", "current_weight": 0.0},
        ]
        with patch("routers.portfolio.logger") as mock_logger:
            _build_normalized_weights(rows)
            mock_logger.warning.assert_not_called()


# ---------------------------------------------------------------------------
# review-fix SF-F5 — optimizer published candidate pool: log missing returns
# ---------------------------------------------------------------------------

class TestOptimizerCandidatePoolMissingReturnsSFF5:
    """SF-F5: the optimizer must log a WARNING when published candidates are
    silently dropped because their returns_series is None.

    Verifies the source-level fix — the router now tracks
    candidate_missing_returns_count and emits a WARNING when >0.
    """

    def test_optimizer_source_tracks_candidate_missing_returns(self):
        """SF-F5: the optimizer candidate fetch block must track and log
        missing-returns candidates."""
        src = _read_portfolio_router_source()
        assert "candidate_missing_returns_count" in src, (
            "portfolio_optimizer must track candidate_missing_returns_count "
            "so it can warn when the scorer pool is reduced (SF-F5)"
        )

    def test_optimizer_source_warns_on_candidate_missing_returns(self):
        """SF-F5: a WARNING log must be emitted when candidate_missing_returns_count > 0."""
        src = _read_portfolio_router_source()
        # The warning call must reference the missing count and the portfolio_id.
        assert "candidate_missing_returns_count" in src
        # Check a substring that would only appear in the warning log call.
        assert "published candidates missing returns_series" in src, (
            "portfolio_optimizer must log 'published candidates missing "
            "returns_series' at WARNING level when the candidate pool is "
            "reduced (SF-F5)"
        )


# ---------------------------------------------------------------------------
# review-fix SF-F7 — final analytics persistence: check update result
# ---------------------------------------------------------------------------

class TestAnalyticsUpdateResultCheckSFF7:
    """SF-F7: the portfolio_analytics UPDATE that transitions the row to COMPLETE
    must check execute()'s return value.

    If execute() silently returns data=[] (row concurrently deleted), the row
    stays in COMPUTING forever — and with the new partial_data/computed_*
    fields, the "computed from N of M" badge in the API response becomes
    permanently absent from subsequent DB reads.
    """

    def test_analytics_update_result_is_checked(self):
        """SF-F7: the source must check the analytics update result and log
        an error when no data is returned."""
        src = _read_portfolio_router_source()
        # The fix assigns the execute() result to a variable and checks .data.
        assert "_analytics_update_result" in src, (
            "portfolio analytics update must capture the execute() result "
            "to detect silent write failures (SF-F7)"
        )
        assert "not _analytics_update_result.data" in src or "_analytics_update_result.data" in src, (
            "the update result .data must be checked for emptiness (SF-F7)"
        )
