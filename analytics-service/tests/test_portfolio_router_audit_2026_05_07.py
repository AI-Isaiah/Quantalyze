"""Audit-2026-05-07 regression tests for routers/portfolio.py.

Targets the previously-untested code paths and new behaviors introduced by
the audit fix pass:

  - _records_to_series tolerates malformed records (M-0614, M-0619, H-0575)
  - regime_shift filters None values from rolling_corr (H-1074)
  - regime_shift / underperformance / concentration_creep firing rules (C-0314)
  - alert dedup select-then-insert respects existing rows (H-1070)
  - _build_normalized_weights helper (M-0624)
  - _series_to_curve helper (M-0625)
  - _compute_sharpe_and_vol helper + status codes (M-0626, M-0615)
  - _redact_credentials never leaks raw secrets to logs (M-0628, C-0214)
  - PortfolioOptimizerRequest validator rejects NaN/Inf/negative (H-0589)
  - matching candidate sort + NaN-safe idxmax (H-0570, H-0587)
  - per-email rate limit sliding window (H-0593)

These tests are pure-Python — they install the same MagicMock stubs as
test_portfolio_router_logic so the router can be imported without
supabase / fastapi / ccxt installed in the local dev env.
"""

from __future__ import annotations

import math
import sys
import types
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest


# Install stubs BEFORE importing routers.portfolio (same pattern as
# test_portfolio_router_logic).
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
    sys.modules["fastapi"].HTTPException = Exception
    sys.modules["fastapi"].Request = MagicMock()


_install_stubs()

from routers import portfolio as portfolio_mod  # noqa: E402
from routers.portfolio import (  # noqa: E402
    _build_normalized_weights,
    _check_verify_strategy_email_rate,
    _compute_sharpe_and_vol,
    _generate_alerts,
    _records_to_series,
    _redact_credentials,
    _series_to_curve,
)


# ---------------------------------------------------------------------------
# _records_to_series (M-0614, M-0619, H-0575)
# ---------------------------------------------------------------------------

class TestRecordsToSeries:
    def test_none_input_returns_none(self):
        assert _records_to_series(None) is None

    def test_empty_list_returns_none(self):
        assert _records_to_series([]) is None

    def test_non_list_returns_none(self):
        assert _records_to_series("not-a-list") is None  # type: ignore[arg-type]
        assert _records_to_series({"date": "2026-01-01", "value": 0.01}) is None  # type: ignore[arg-type]

    def test_valid_records_build_series(self):
        s = _records_to_series([
            {"date": "2026-01-01", "value": 0.01},
            {"date": "2026-01-02", "value": -0.02},
        ], name="s1")
        assert s is not None
        assert s.name == "s1"
        assert len(s) == 2

    def test_missing_date_key_skipped_not_raise(self):
        """Audit M-0614: legacy {ts, val} rows used to raise KeyError that
        bubbled up and overwrote the real exception with "Contact support".
        Now we skip + warn."""
        s = _records_to_series([
            {"date": "2026-01-01", "value": 0.01},
            {"ts": "2026-01-02", "val": -0.02},  # legacy shape
            {"date": "2026-01-03", "value": 0.03},
        ], name="s1")
        assert s is not None
        assert len(s) == 2  # legacy row skipped, not crash

    def test_missing_value_key_skipped(self):
        s = _records_to_series([
            {"date": "2026-01-01"},  # missing value
            {"date": "2026-01-02", "value": 0.02},
        ], name="s1")
        assert s is not None
        assert len(s) == 1

    def test_non_dict_records_skipped(self):
        s = _records_to_series([
            "garbage",
            {"date": "2026-01-01", "value": 0.01},
            42,
        ], name="s1")
        assert s is not None
        assert len(s) == 1

    def test_all_malformed_returns_none(self):
        """If every record is malformed we return None (no series at all)."""
        s = _records_to_series([{"ts": "x", "val": 1}, "garbage"], name="s1")
        assert s is None


# ---------------------------------------------------------------------------
# _redact_credentials (M-0628, C-0214)
# ---------------------------------------------------------------------------

class TestRedactCredentials:
    def _req(self, **kw):
        # Minimal duck-typed VerifyStrategyRequest stand-in.
        r = MagicMock()
        r.api_key = kw.get("api_key", "AKIDDEMO0123456789abcdef")
        r.api_secret = kw.get("api_secret", "SECRETDEMO9876543210xyz")
        r.passphrase = kw.get("passphrase", "passphrase-demo-1234")
        return r

    def test_redacts_api_key_substring(self):
        req = self._req()
        msg = f"Invalid signature for key {req.api_key}: ..."
        safe = _redact_credentials(msg, req)
        assert req.api_key not in safe
        assert "[REDACTED]" in safe

    def test_redacts_api_secret_substring(self):
        req = self._req()
        msg = f"BadSig: {req.api_secret} mismatch"
        safe = _redact_credentials(msg, req)
        assert req.api_secret not in safe

    def test_redacts_passphrase_substring(self):
        req = self._req()
        msg = f"OKX rejected passphrase {req.passphrase}"
        safe = _redact_credentials(msg, req)
        assert req.passphrase not in safe

    def test_short_credentials_not_redacted(self):
        """Don't redact credentials shorter than 6 chars — too noisy and
        also implausible (CCXT keys are always 32+ chars)."""
        req = self._req(api_key="ab")
        msg = "An error occurred"
        safe = _redact_credentials(msg, req)
        assert safe == "An error occurred"

    def test_no_match_returns_message_unchanged(self):
        req = self._req()
        msg = "Generic network timeout"
        safe = _redact_credentials(msg, req)
        assert safe == msg


# ---------------------------------------------------------------------------
# _build_normalized_weights (M-0624)
# ---------------------------------------------------------------------------

class TestBuildNormalizedWeights:
    def test_explicit_weights_normalized(self):
        rows = [
            {"strategy_id": "s1", "current_weight": 0.8},
            {"strategy_id": "s2", "current_weight": 0.2},
        ]
        w = _build_normalized_weights(rows)
        assert w == pytest.approx({"s1": 0.8, "s2": 0.2})
        assert sum(w.values()) == pytest.approx(1.0)

    def test_missing_weight_defaults_to_one(self):
        rows = [
            {"strategy_id": "s1"},
            {"strategy_id": "s2"},
        ]
        w = _build_normalized_weights(rows)
        # Equal weights when neither has current_weight set
        assert w == pytest.approx({"s1": 0.5, "s2": 0.5})

    def test_unequal_weights_renormalize(self):
        rows = [
            {"strategy_id": "s1", "current_weight": 4.0},
            {"strategy_id": "s2", "current_weight": 1.0},
        ]
        w = _build_normalized_weights(rows)
        assert sum(w.values()) == pytest.approx(1.0)
        assert w["s1"] == pytest.approx(0.8)

    def test_zero_total_does_not_divide_by_zero(self):
        rows = [
            {"strategy_id": "s1", "current_weight": 0},
            {"strategy_id": "s2", "current_weight": 0},
        ]
        # Zero weight rows fall back to default 1.0 each (current_weight=0
        # is falsy in the dict comprehension) so this normalises cleanly.
        w = _build_normalized_weights(rows)
        assert w == pytest.approx({"s1": 0.5, "s2": 0.5})


# ---------------------------------------------------------------------------
# _series_to_curve (M-0625)
# ---------------------------------------------------------------------------

class TestSeriesToCurve:
    def test_basic_conversion(self):
        idx = pd.DatetimeIndex(["2026-01-01", "2026-01-02"])
        s = pd.Series([1.01, 1.05], index=idx)
        curve = _series_to_curve(s)
        assert len(curve) == 2
        assert curve[0]["value"] == pytest.approx(1.01)
        assert curve[1]["value"] == pytest.approx(1.05)
        # ISO format with 'T' separator
        assert "T" in curve[0]["date"] or "-" in curve[0]["date"]

    def test_nan_in_series_serialized_as_none(self):
        idx = pd.DatetimeIndex(["2026-01-01", "2026-01-02"])
        s = pd.Series([1.0, float("nan")], index=idx)
        curve = _series_to_curve(s)
        assert curve[1]["value"] is None


# ---------------------------------------------------------------------------
# _compute_sharpe_and_vol (M-0626, M-0615)
# ---------------------------------------------------------------------------

class TestComputeSharpeAndVol:
    def test_single_observation_insufficient_history(self):
        s = pd.Series([0.01], index=pd.DatetimeIndex(["2026-01-01"]))
        vol, mean_ret, sharpe, status = _compute_sharpe_and_vol(s)
        assert status == "insufficient_history"
        assert vol is None
        assert sharpe is None

    def test_flat_series_zero_volatility(self):
        idx = pd.DatetimeIndex(["2026-01-01", "2026-01-02", "2026-01-03"])
        s = pd.Series([0.0, 0.0, 0.0], index=idx)
        vol, mean_ret, sharpe, status = _compute_sharpe_and_vol(s)
        assert status == "zero_volatility"
        assert sharpe is None

    def test_real_returns_produces_finite_sharpe(self):
        np.random.seed(42)
        s = pd.Series(
            np.random.normal(0.001, 0.01, 100),
            index=pd.bdate_range("2026-01-01", periods=100),
        )
        vol, mean_ret, sharpe, status = _compute_sharpe_and_vol(s)
        assert status == "ok"
        assert sharpe is not None
        assert math.isfinite(sharpe)

    def test_returns_status_distinguishes_zero_vol_from_history(self):
        """Audit M-0615: dashboard must distinguish empty-state reasons."""
        # Insufficient history
        s1 = pd.Series([0.01], index=pd.DatetimeIndex(["2026-01-01"]))
        _, _, _, st1 = _compute_sharpe_and_vol(s1)
        # Zero vol (multi-day flat)
        s2 = pd.Series([0.0] * 3, index=pd.bdate_range("2026-01-01", periods=3))
        _, _, _, st2 = _compute_sharpe_and_vol(s2)
        assert st1 != st2


# ---------------------------------------------------------------------------
# regime_shift / underperformance / concentration_creep alert rules
# (C-0314, H-1074)
# ---------------------------------------------------------------------------

class TestSprint4AlertRules:
    def _make_sb(self):
        sb = MagicMock()
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "a-1"}])
        return sb

    def test_regime_shift_fires_when_delta_exceeds_threshold(self):
        """C-0314: rolling_corr delta > 0.15 should fire a regime_shift alert."""
        sb = self._make_sb()
        rolling = {
            "s1-s2": (
                [{"date": f"2026-01-{i:02d}", "value": 0.2} for i in range(1, 6)]
                + [{"date": f"2026-01-{i:02d}", "value": 0.5} for i in range(6, 11)]
            ),
        }
        _generate_alerts(
            sb, "portfolio-1",
            max_drawdown=-0.05,  # below drawdown threshold
            avg_pairwise_corr=0.5,  # below correlation_spike threshold
            rolling_corr=rolling,
        )
        # At least one insert call for regime_shift
        insert_calls = sb.table.return_value.insert.call_args_list
        assert any(
            call[0][0].get("alert_type") == "regime_shift"
            for call in insert_calls
        )

    def test_regime_shift_skipped_when_delta_below_threshold(self):
        """Delta of 0.10 (< 0.15) must not fire."""
        sb = self._make_sb()
        rolling = {
            "s1-s2": (
                [{"date": f"2026-01-{i:02d}", "value": 0.3} for i in range(1, 6)]
                + [{"date": f"2026-01-{i:02d}", "value": 0.4} for i in range(6, 11)]
            ),
        }
        _generate_alerts(sb, "portfolio-1", -0.05, 0.5, rolling_corr=rolling)
        insert_calls = sb.table.return_value.insert.call_args_list
        assert not any(
            call[0][0].get("alert_type") == "regime_shift"
            for call in insert_calls
        )

    def test_regime_shift_tolerates_none_values_in_rolling_corr(self):
        """H-1074: _safe_float(NaN) writes None into rolling_corr. The old
        code crashed sum([None, ...]); the new code filters and continues.
        """
        sb = self._make_sb()
        rolling = {
            "s1-s2": (
                # leading None then a stable run
                [{"date": f"2026-01-{i:02d}", "value": None} for i in range(1, 4)]
                + [{"date": f"2026-01-{i:02d}", "value": 0.2} for i in range(4, 8)]
                + [{"date": f"2026-01-{i:02d}", "value": 0.6} for i in range(8, 13)]
            ),
        }
        # Must NOT raise — previously TypeError: sum([None, 0.2, ...])
        _generate_alerts(sb, "portfolio-1", -0.05, 0.5, rolling_corr=rolling)

    def test_concentration_creep_fires_when_top_exceeds_baseline(self):
        """C-0314: 3 strategies, top at 55% (>33%*1.5=50%) fires."""
        sb = self._make_sb()
        risk_decomp = [
            {"strategy_id": "s1", "strategy_name": "Alpha", "weight_pct": 55, "standalone_vol": 0.01},
            {"strategy_id": "s2", "strategy_name": "Beta", "weight_pct": 30, "standalone_vol": 0.01},
            {"strategy_id": "s3", "strategy_name": "Gamma", "weight_pct": 15, "standalone_vol": 0.01},
        ]
        _generate_alerts(
            sb, "portfolio-1", -0.05, 0.5,
            risk_decomp=risk_decomp,
        )
        insert_calls = sb.table.return_value.insert.call_args_list
        assert any(
            call[0][0].get("alert_type") == "concentration_creep"
            for call in insert_calls
        )

    def test_concentration_creep_skipped_with_only_two_strategies(self):
        """Rule only applies with 3+ strategies."""
        sb = self._make_sb()
        risk_decomp = [
            {"strategy_id": "s1", "strategy_name": "Alpha", "weight_pct": 80, "standalone_vol": 0.01},
            {"strategy_id": "s2", "strategy_name": "Beta", "weight_pct": 20, "standalone_vol": 0.01},
        ]
        _generate_alerts(sb, "portfolio-1", -0.05, 0.5, risk_decomp=risk_decomp)
        insert_calls = sb.table.return_value.insert.call_args_list
        assert not any(
            call[0][0].get("alert_type") == "concentration_creep"
            for call in insert_calls
        )

    def test_underperformance_fires_when_worst_trails_with_gap(self):
        """C-0314: worst contribution -0.05, second -0.04 (gap 0.005), band 0.01."""
        sb = self._make_sb()
        attribution = [
            {"strategy_id": "s1", "strategy_name": "Alpha", "contribution": 0.02},
            {"strategy_id": "s2", "strategy_name": "Beta", "contribution": -0.04},
            {"strategy_id": "s3", "strategy_name": "Gamma", "contribution": -0.05},
        ]
        risk_decomp = [
            {"strategy_id": s, "strategy_name": "x", "standalone_vol": 0.01}
            for s in ("s1", "s2", "s3")
        ]
        _generate_alerts(
            sb, "portfolio-1", -0.05, 0.5,
            attribution=attribution, risk_decomp=risk_decomp,
        )
        insert_calls = sb.table.return_value.insert.call_args_list
        types = [c[0][0].get("alert_type") for c in insert_calls]
        assert "underperformance" in types

    def test_underperformance_suppressed_when_gap_too_close(self):
        """C-0314: gap < 0.005 must not fire (worst and second are tied)."""
        sb = self._make_sb()
        attribution = [
            {"strategy_id": "s1", "strategy_name": "Alpha", "contribution": 0.02},
            {"strategy_id": "s2", "strategy_name": "Beta", "contribution": -0.049},  # gap = 0.001
            {"strategy_id": "s3", "strategy_name": "Gamma", "contribution": -0.050},
        ]
        risk_decomp = [
            {"strategy_id": s, "strategy_name": "x", "standalone_vol": 0.01}
            for s in ("s1", "s2", "s3")
        ]
        _generate_alerts(
            sb, "portfolio-1", -0.05, 0.5,
            attribution=attribution, risk_decomp=risk_decomp,
        )
        types = [c[0][0].get("alert_type") for c in sb.table.return_value.insert.call_args_list]
        assert "underperformance" not in types


# ---------------------------------------------------------------------------
# Alert dedup select-then-insert (H-1070)
# ---------------------------------------------------------------------------

class TestAlertDedup:
    def test_skips_insert_when_unacked_alert_exists(self):
        """H-1070: existing unacked alert of same type → skip insert.

        After audit H-1073 the dedup path was batched into a single SELECT
        over alert_type IN (...) for the whole call. The test must mock
        the new chain (.eq.in_.is_.execute) AND the per-alert fallback
        (.eq.eq.is_.limit.execute) because the per-alert path is taken
        only when the batch probe fails.
        """
        sb = MagicMock()
        # Batch probe returns ALL alert_types as existing → skip all inserts.
        sb.table.return_value.select.return_value.eq.return_value.in_.return_value.is_.return_value.execute.return_value = MagicMock(
            data=[
                {"alert_type": "drawdown"},
                {"alert_type": "correlation_spike"},
            ]
        )
        # The per-alert fallback chain (only used if batch probe raises).
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[{"id": "existing-1"}]
        )
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock(
            data=[{"id": "new-1"}]
        )
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.25, avg_pairwise_corr=0.85)
        # No insert call (dedup hit on both alerts)
        sb.table.return_value.insert.assert_not_called()


# ---------------------------------------------------------------------------
# Per-email rate limit (H-0593)
# ---------------------------------------------------------------------------

class TestIdempotencyCache:
    """H-0592: Idempotency-Key support for verify_strategy. Same key +
    same (email, exchange) returns the cached response without re-firing
    the live exchange handshake.
    """

    def setup_method(self):
        portfolio_mod._verify_strategy_idempotency.clear()

    def test_lookup_miss_returns_none(self):
        from routers.portfolio import _verify_strategy_idempotency_lookup
        assert _verify_strategy_idempotency_lookup("a@x.com", "binance", "key1") is None

    def test_store_then_lookup_hits(self):
        from routers.portfolio import (
            _verify_strategy_idempotency_lookup,
            _verify_strategy_idempotency_store,
        )
        _verify_strategy_idempotency_store(
            "a@x.com", "binance", "key1", {"verification_id": "v-1"},
        )
        cached = _verify_strategy_idempotency_lookup("a@x.com", "binance", "key1")
        assert cached == {"verification_id": "v-1"}

    def test_different_key_is_isolated(self):
        from routers.portfolio import (
            _verify_strategy_idempotency_lookup,
            _verify_strategy_idempotency_store,
        )
        _verify_strategy_idempotency_store(
            "a@x.com", "binance", "key1", {"verification_id": "v-1"},
        )
        # Different IK on the same (email, exchange) returns nothing.
        assert _verify_strategy_idempotency_lookup("a@x.com", "binance", "key2") is None

    def test_email_case_normalized(self):
        """Idempotency-Key dedup is case-insensitive on email — the
        rate-limit check normalizes email too, so the two must agree."""
        from routers.portfolio import (
            _verify_strategy_idempotency_lookup,
            _verify_strategy_idempotency_store,
        )
        _verify_strategy_idempotency_store(
            "A@X.com", "binance", "key1", {"verification_id": "v-1"},
        )
        cached = _verify_strategy_idempotency_lookup("a@x.com", "binance", "key1")
        assert cached is not None


class TestPerEmailRateLimit:
    def setup_method(self):
        # Clear the in-memory bucket between tests.
        portfolio_mod._verify_strategy_email_attempts.clear()

    def test_first_attempts_allowed(self):
        for _ in range(portfolio_mod._VERIFY_STRATEGY_EMAIL_RATE_LIMIT):
            assert _check_verify_strategy_email_rate("a@example.com") is True

    def test_exceeding_budget_rejected(self):
        for _ in range(portfolio_mod._VERIFY_STRATEGY_EMAIL_RATE_LIMIT):
            _check_verify_strategy_email_rate("b@example.com")
        # Next attempt within window must be rejected.
        assert _check_verify_strategy_email_rate("b@example.com") is False

    def test_empty_email_always_allowed(self):
        """Empty email bypasses the per-email limit (IP limit still applies)."""
        for _ in range(20):
            assert _check_verify_strategy_email_rate("") is True

    def test_separate_emails_isolated(self):
        for _ in range(portfolio_mod._VERIFY_STRATEGY_EMAIL_RATE_LIMIT):
            _check_verify_strategy_email_rate("c@example.com")
        # Different email should still be allowed.
        assert _check_verify_strategy_email_rate("d@example.com") is True


# ---------------------------------------------------------------------------
# PortfolioOptimizerRequest validator (H-0589)
# ---------------------------------------------------------------------------

class TestPortfolioOptimizerRequestValidator:
    def test_none_weights_accepted(self):
        from models.schemas import PortfolioOptimizerRequest
        r = PortfolioOptimizerRequest(portfolio_id="p1")
        assert r.weights is None

    def test_valid_weights_accepted(self):
        from models.schemas import PortfolioOptimizerRequest
        r = PortfolioOptimizerRequest(
            portfolio_id="p1",
            weights={"s1": 0.6, "s2": 0.4},
        )
        assert r.weights == {"s1": 0.6, "s2": 0.4}

    def test_nan_weight_rejected(self):
        from models.schemas import PortfolioOptimizerRequest
        with pytest.raises(Exception):
            PortfolioOptimizerRequest(portfolio_id="p1", weights={"s1": float("nan")})

    def test_inf_weight_rejected(self):
        from models.schemas import PortfolioOptimizerRequest
        with pytest.raises(Exception):
            PortfolioOptimizerRequest(portfolio_id="p1", weights={"s1": float("inf")})

    def test_negative_weight_rejected(self):
        from models.schemas import PortfolioOptimizerRequest
        with pytest.raises(Exception):
            PortfolioOptimizerRequest(portfolio_id="p1", weights={"s1": -0.5})

    def test_non_numeric_weight_rejected(self):
        from models.schemas import PortfolioOptimizerRequest
        with pytest.raises(Exception):
            PortfolioOptimizerRequest(portfolio_id="p1", weights={"s1": "not-a-number"})


# ---------------------------------------------------------------------------
# Total AUM partial-data status (M-0616)
# ---------------------------------------------------------------------------
# (No direct unit because the logic lives inside _compute_portfolio_analytics
# and depends on the supabase mock surface. Covered indirectly by the
# end-to-end integration test plan documented in the audit-fix report.)


# ---------------------------------------------------------------------------
# ComputationStatus / AlertType / AlertSeverity enums (M-0620)
# ---------------------------------------------------------------------------

class TestStatusEnums:
    def test_computation_status_values_match_db_check(self):
        """Migration 010 line 30-31 declares CHECK constraint values.
        The enum here must match exactly so we don't drift between
        Python and DB.
        """
        from routers.portfolio import ComputationStatus
        assert ComputationStatus.PENDING.value == "pending"
        assert ComputationStatus.COMPUTING.value == "computing"
        assert ComputationStatus.COMPLETE.value == "complete"
        assert ComputationStatus.FAILED.value == "failed"

    def test_alert_type_values(self):
        from routers.portfolio import AlertType
        # All Sprint 4 + Sprint 5 alert types.
        assert AlertType.DRAWDOWN.value == "drawdown"
        assert AlertType.CORRELATION_SPIKE.value == "correlation_spike"
        assert AlertType.REGIME_SHIFT.value == "regime_shift"
        assert AlertType.UNDERPERFORMANCE.value == "underperformance"
        assert AlertType.CONCENTRATION_CREEP.value == "concentration_creep"
        assert AlertType.REBALANCE_DRIFT.value == "rebalance_drift"

    def test_alert_severity_values(self):
        from routers.portfolio import AlertSeverity
        assert AlertSeverity.HIGH.value == "high"
        assert AlertSeverity.MEDIUM.value == "medium"
        assert AlertSeverity.LOW.value == "low"


# ---------------------------------------------------------------------------
# _to_utc_iso datetime coercion helper (M-0621)
# ---------------------------------------------------------------------------

class TestToUtcIso:
    def test_aware_datetime_passes_through(self):
        from datetime import datetime, timezone
        from routers.portfolio import _to_utc_iso
        d = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
        s = _to_utc_iso(d)
        assert s.startswith("2026-05-15T12:00:00")
        assert "+00:00" in s

    def test_naive_datetime_assumed_utc(self):
        from datetime import datetime
        from routers.portfolio import _to_utc_iso
        # Naive datetime — coerced to UTC.
        d = datetime(2026, 5, 15, 12, 0)
        s = _to_utc_iso(d)
        assert "+00:00" in s

    def test_pd_timestamp_naive_assumed_utc(self):
        import pandas as pd
        from routers.portfolio import _to_utc_iso
        t = pd.Timestamp("2026-05-15 12:00:00")
        s = _to_utc_iso(t)
        # pd.Timestamp.isoformat after tz_localize(UTC) produces
        # something like "2026-05-15T12:00:00+00:00".
        assert "+00:00" in s

    def test_invalid_type_raises(self):
        from routers.portfolio import _to_utc_iso
        with pytest.raises(TypeError):
            _to_utc_iso("not-a-datetime")  # type: ignore[arg-type]
