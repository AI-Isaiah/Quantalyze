"""Audit-2026-05-07 regression tests for routers/portfolio.py.

Targets the previously-untested code paths and new behaviors introduced by
the audit fix pass:

  - _records_to_series tolerates malformed records (M-0614, M-0619, H-0575)
  - regime_shift filters None values from rolling_corr (H-1074)
  - regime_shift / underperformance / concentration_creep firing rules (C-0314)
  - alert dedup select-then-insert respects existing rows (H-1070)
  - _build_normalized_weights helper (M-0624)
  - _series_to_curve helper (M-0625)
  - sharpe_vol_status_from_backbone status codes (M-0626, M-0615) — the legacy
    router Sharpe/vol helper was DELETED in Phase 114
    (E1 backbone absorption, BACKBONE-01); its status-code intent is PORTED to
    the backbone-module helper services.metrics.sharpe_vol_status_from_backbone
    (3-tuple: vol, sharpe, status — mean_ret dropped, both call sites discarded
    it). Every REACHABLE status is pinned (ok, insufficient_history,
    zero_volatility, nan_vol); nan_mean/nan_sharpe are proven-unreachable dead
    branches under pandas skipna (Phase 114-02) and are deliberately NOT
    asserted.
  - _redact_credentials never leaks raw secrets to logs (M-0628, C-0214)
  - PortfolioOptimizerRequest validator rejects NaN/Inf/negative (H-0589)
  - matching candidate sort + NaN-safe idxmax (H-0570, H-0587)
  - per-email rate limit sliding window (H-0593)

These tests are pure-Python — they import the router's helpers directly and
drive them with locally-constructed mocks. (H-0806: this module used to install
MagicMock stubs into sys.modules before importing the router. Because the
post-guard attribute writes were unconditional — including
`sys.modules["fastapi"].HTTPException = Exception`, a bare-Exception downgrade —
it clobbered the real shared fastapi/supabase/slowapi modules process-globally
for every later-collected test. The deps are installed in CI and the venv, so the
stubs are gone and the helpers are imported for real.)
"""

from __future__ import annotations

import math
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from routers import portfolio as portfolio_mod
from routers.portfolio import (
    _build_normalized_weights,
    _check_verify_strategy_email_rate,
    _generate_alerts,
    _records_to_series,
    _redact_credentials,
    _series_to_curve,
)
from services.metrics import sharpe_vol_status_from_backbone


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

    # --- Audit H-0535: SecretStr trap.
    # The fields above are MagicMock plain strings (duck-typed). The REAL
    # VerifyStrategyRequest now wraps api_key/api_secret/passphrase in
    # pydantic.SecretStr — which is NOT a `str`. Pre-fix, _redact_credentials'
    # `isinstance(needle, str)` guard would have SILENTLY skipped every
    # SecretStr, re-leaking the raw secret into logs/Sentry. These tests pin
    # that _redact_credentials unwraps SecretStr (.get_secret_value()) before
    # the substring scrub, using a genuine request object.
    def test_redacts_secretstr_api_key_from_real_request(self):
        from models.schemas import VerifyStrategyRequest
        raw_key = "AKIDLIVE0123456789abcdef"
        req = VerifyStrategyRequest(
            email="trader@example.com",
            exchange="binance",
            api_key=raw_key,
            api_secret="s" * 24,
        )
        # Sanity: the SecretStr must NOT render the raw value in repr/str —
        # this is the leak surface H-0535 closes.
        assert raw_key not in repr(req)
        assert raw_key not in str(req.api_key)
        msg = f"Invalid signature for key {raw_key}: handshake rejected"
        safe = _redact_credentials(msg, req)
        assert raw_key not in safe, "SecretStr api_key leaked through redaction"
        assert "[REDACTED]" in safe

    def test_redacts_secretstr_api_secret_and_passphrase_from_real_request(self):
        from models.schemas import VerifyStrategyRequest
        raw_secret = "SECRETLIVE9876543210xyzAB"
        raw_pass = "okx-passphrase-live-1234"
        req = VerifyStrategyRequest(
            email="trader@example.com",
            exchange="okx",
            api_key="k" * 24,
            api_secret=raw_secret,
            passphrase=raw_pass,
        )
        msg = f"BadSig: {raw_secret} / passphrase {raw_pass}"
        safe = _redact_credentials(msg, req)
        assert raw_secret not in safe, "SecretStr api_secret leaked"
        assert raw_pass not in safe, "SecretStr passphrase leaked"


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
        # NEW-C19-05: current_weight=0 is now treated as an EXPLICIT zero
        # (not as "unset"), so both strategies keep weight 0.  The `or 1.0`
        # guard on `total` prevents a ZeroDivisionError and the result is
        # {s1: 0.0, s2: 0.0}.  This is the correct paused-strategy behavior:
        # two paused strategies should both be 0-weight, not silently promoted
        # to equal 50/50 allocation.
        w = _build_normalized_weights(rows)
        assert w == pytest.approx({"s1": 0.0, "s2": 0.0})


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
# sharpe_vol_status_from_backbone (M-0626, M-0615)
#
# PORTED from the deleted legacy router Sharpe/vol helper (Phase 114
# E1 backbone absorption). The backbone-module helper returns a 3-tuple
# (vol, sharpe, status) — mean_ret was dropped because both production call
# sites discarded it. Status-code intent is preserved for EVERY reachable code
# (ok, insufficient_history, zero_volatility, nan_vol). nan_mean/nan_sharpe are
# proven-unreachable dead branches under pandas skipna (114-02) and are NOT
# asserted here.
# ---------------------------------------------------------------------------

class TestSharpeVolStatusFromBackbone:
    def test_single_observation_insufficient_history(self):
        s = pd.Series([0.01], index=pd.DatetimeIndex(["2026-01-01"]))
        vol, sharpe, status = sharpe_vol_status_from_backbone(s)
        assert status == "insufficient_history"
        assert vol is None
        assert sharpe is None

    def test_flat_series_zero_volatility(self):
        idx = pd.DatetimeIndex(["2026-01-01", "2026-01-02", "2026-01-03"])
        s = pd.Series([0.0, 0.0, 0.0], index=idx)
        vol, sharpe, status = sharpe_vol_status_from_backbone(s)
        assert status == "zero_volatility"
        assert sharpe is None

    def test_real_returns_produces_finite_sharpe(self):
        np.random.seed(42)
        s = pd.Series(
            np.random.normal(0.001, 0.01, 100),
            index=pd.bdate_range("2026-01-01", periods=100),
        )
        vol, sharpe, status = sharpe_vol_status_from_backbone(s)
        assert status == "ok"
        assert sharpe is not None
        assert math.isfinite(sharpe)

    def test_all_nan_returns_nan_vol_without_raising(self):
        """BLOCKER follow-through: an all-NaN, len>=2 series slips past
        compute_all_metrics's len<2-only guard, so the helper's pre-backbone
        pd.isna(std) guard must return (None, None, "nan_vol") WITHOUT raising
        (anti-500). This is the reachable status the legacy suite never covered;
        adding it makes the ported suite exercise every REACHABLE code, not just
        the three the legacy tests hit."""
        idx = pd.DatetimeIndex(["2026-01-01", "2026-01-02", "2026-01-03"])
        s = pd.Series([np.nan, np.nan, np.nan], index=idx)
        vol, sharpe, status = sharpe_vol_status_from_backbone(s)
        assert (vol, sharpe, status) == (None, None, "nan_vol")

    def test_interior_nan_uses_skipna_basis_not_diluted(self):
        """CR-01: the verify_strategy path feeds interior-NaN returns (a guard-NaN
        flanked by valid returns, emitted by reconstruct_nav_and_twr on a
        dust/negative/flow-dominated interior day). Such a series has finite std,
        so it slips past both pre-backbone guards and reaches the pipeline. The
        legacy helper used pandas skipna (NaN days DROPPED); the pipeline's
        _prepare_returns fillna(0)s them, DILUTING vol/mean. The helper must
        reproduce the skipna basis, so vol equals the dropna() oracle and is
        strictly LARGER than the fillna(0)-diluted value it would otherwise show.
        RED pre-fix (helper returned the diluted vol), GREEN after dropna()."""
        idx = pd.bdate_range("2026-01-01", periods=10)
        r = pd.Series(
            np.random.default_rng(7).normal(0.001, 0.01, 10),
            index=idx,
            dtype="float64",
        )
        r.iloc[3] = np.nan
        r.iloc[7] = np.nan
        skipna_vol = r.dropna().std() * math.sqrt(252)
        diluted_vol = r.fillna(0).std() * math.sqrt(252)
        assert skipna_vol > diluted_vol  # the two bases genuinely differ
        vol, _sharpe, status = sharpe_vol_status_from_backbone(r, periods_per_year=252)
        assert status == "ok"
        assert vol == pytest.approx(skipna_vol, rel=1e-9)
        assert vol != pytest.approx(diluted_vol, rel=1e-9)

    def test_returns_status_distinguishes_zero_vol_from_history(self):
        """Audit M-0615: dashboard must distinguish empty-state reasons."""
        # Insufficient history
        s1 = pd.Series([0.01], index=pd.DatetimeIndex(["2026-01-01"]))
        _, _, st1 = sharpe_vol_status_from_backbone(s1)
        # Zero vol (multi-day flat)
        s2 = pd.Series([0.0] * 3, index=pd.bdate_range("2026-01-01", periods=3))
        _, _, st2 = sharpe_vol_status_from_backbone(s2)
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
    """H-0592: Idempotency-Key support for verify_strategy. Same
    (email, exchange, api_key, idempotency_key) returns the cached
    response without re-firing the live exchange handshake. The
    api_key is part of the cache key (review SEC-2) so two callers
    sharing an email but using different api_keys can't read each
    other's cached response.
    """

    _API_KEY = "test-api-key-1"
    _OTHER_API_KEY = "different-api-key-2"

    def setup_method(self):
        portfolio_mod._verify_strategy_idempotency.clear()

    def test_lookup_miss_returns_none(self):
        from routers.portfolio import _verify_strategy_idempotency_lookup
        assert _verify_strategy_idempotency_lookup(
            "a@x.com", "binance", self._API_KEY, "key1",
        ) is None

    def test_store_then_lookup_hits(self):
        from routers.portfolio import (
            _verify_strategy_idempotency_lookup,
            _verify_strategy_idempotency_store,
        )
        _verify_strategy_idempotency_store(
            "a@x.com", "binance", self._API_KEY, "key1",
            {"verification_id": "v-1"},
        )
        cached = _verify_strategy_idempotency_lookup(
            "a@x.com", "binance", self._API_KEY, "key1",
        )
        assert cached == {"verification_id": "v-1"}

    def test_different_key_is_isolated(self):
        from routers.portfolio import (
            _verify_strategy_idempotency_lookup,
            _verify_strategy_idempotency_store,
        )
        _verify_strategy_idempotency_store(
            "a@x.com", "binance", self._API_KEY, "key1",
            {"verification_id": "v-1"},
        )
        # Different IK on the same (email, exchange, api_key) returns nothing.
        assert _verify_strategy_idempotency_lookup(
            "a@x.com", "binance", self._API_KEY, "key2",
        ) is None

    def test_email_case_normalized(self):
        """Idempotency-Key dedup is case-insensitive on email — the
        rate-limit check normalizes email too, so the two must agree."""
        from routers.portfolio import (
            _verify_strategy_idempotency_lookup,
            _verify_strategy_idempotency_store,
        )
        _verify_strategy_idempotency_store(
            "A@X.com", "binance", self._API_KEY, "key1",
            {"verification_id": "v-1"},
        )
        cached = _verify_strategy_idempotency_lookup(
            "a@x.com", "binance", self._API_KEY, "key1",
        )
        assert cached is not None

    def test_different_api_key_isolated(self):
        """SEC-2: same (email, exchange, IK) but different api_key must
        NOT return the cached response. A flaky-client retry that swaps
        credentials should not leak the previous response."""
        from routers.portfolio import (
            _verify_strategy_idempotency_lookup,
            _verify_strategy_idempotency_store,
        )
        _verify_strategy_idempotency_store(
            "a@x.com", "binance", self._API_KEY, "key1",
            {"verification_id": "v-1"},
        )
        assert _verify_strategy_idempotency_lookup(
            "a@x.com", "binance", self._OTHER_API_KEY, "key1",
        ) is None

    def test_cache_evicts_when_over_cap(self):
        """CR-2/PERF-2: simultaneous-entry cap prevents unbounded growth.
        Once cache hits the cap, the oldest insertion is evicted.

        Always access the store via portfolio_mod (not a top-of-file
        import binding) so we are guaranteed to mutate the same module
        globals we then assert against. Under pytest+coverage+supabase
        on Python 3.12 the import-binding and module-attribute can end
        up resolving to different module objects, leaving the binding's
        globals out of sync with portfolio_mod's.
        """
        # Shrink the cap for the test, then restore.
        original_cap = portfolio_mod._VERIFY_STRATEGY_IDEMPOTENCY_CACHE_MAX
        portfolio_mod._VERIFY_STRATEGY_IDEMPOTENCY_CACHE_MAX = 3
        try:
            for i in range(5):
                portfolio_mod._verify_strategy_idempotency_store(
                    f"u{i}@x.com", "binance", f"k{i}", "ik",
                    {"verification_id": f"v-{i}"},
                )
            # Cap=3 means after storing 5, only 3 remain.
            assert len(portfolio_mod._verify_strategy_idempotency) == 3
        finally:
            portfolio_mod._VERIFY_STRATEGY_IDEMPOTENCY_CACHE_MAX = original_cap

    def test_store_uses_wall_clock_not_monotonic(self):
        """F5(b) (red-team HIGH7): the idempotency cache must stamp entries with
        wall clock (time.time()), consistent with the rate limiter. monotonic
        restarts at 0 on a worker recycle, which would make a freshly-stored
        entry read as wildly out-of-window on the new process. The stored
        timestamp must be close to time.time(), NOT time.monotonic() (which on
        any real host is a very different magnitude — uptime, not epoch)."""
        import time

        portfolio_mod._verify_strategy_idempotency_store(
            "a@x.com", "binance", self._API_KEY, "key1", {"verification_id": "v-1"},
        )
        key = portfolio_mod._verify_strategy_idempotency_key(
            "a@x.com", "binance", self._API_KEY, "key1",
        )
        stored_at, _resp = portfolio_mod._verify_strategy_idempotency[key]
        wall = time.time()
        mono = time.monotonic()
        # Stored timestamp must track wall clock, not the monotonic clock.
        assert abs(stored_at - wall) < 5.0, (
            "idempotency entry must be stamped with time.time() (wall clock)"
        )
        # And it must be clearly NOT the monotonic clock (epoch ~1.7e9 vs uptime).
        assert abs(stored_at - mono) > 1000.0, (
            "idempotency entry must NOT use time.monotonic() — it restarts at 0 "
            "on a worker recycle, inconsistent with the rate limiter's wall clock"
        )

    def test_ttl_expiry_measured_against_wall_clock(self):
        """F5(b): an entry whose wall-clock timestamp is older than the TTL must
        expire on lookup; a fresh one must still hit. This pins that the lookup
        TTL compare uses the same clock the store writes."""
        import time

        key = portfolio_mod._verify_strategy_idempotency_key(
            "a@x.com", "binance", self._API_KEY, "key1",
        )
        ttl = portfolio_mod._VERIFY_STRATEGY_IDEMPOTENCY_TTL_SEC
        # Stale wall-clock timestamp (older than the TTL) → must expire.
        portfolio_mod._verify_strategy_idempotency[key] = (
            time.time() - ttl - 10, {"verification_id": "stale"},
        )
        assert portfolio_mod._verify_strategy_idempotency_lookup(
            "a@x.com", "binance", self._API_KEY, "key1",
        ) is None
        # Fresh wall-clock timestamp → must hit.
        portfolio_mod._verify_strategy_idempotency[key] = (
            time.time(), {"verification_id": "fresh"},
        )
        hit = portfolio_mod._verify_strategy_idempotency_lookup(
            "a@x.com", "binance", self._API_KEY, "key1",
        )
        assert hit == {"verification_id": "fresh"}


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

    def test_cache_evicts_when_over_cap(self):
        """CR-1/PERF-2: simultaneous-email cap prevents unbounded growth.
        Once cache hits the cap, the oldest-touched email is evicted."""
        original_cap = portfolio_mod._VERIFY_STRATEGY_EMAIL_CACHE_MAX
        portfolio_mod._VERIFY_STRATEGY_EMAIL_CACHE_MAX = 3
        try:
            for i in range(5):
                _check_verify_strategy_email_rate(f"u{i}@example.com")
            assert len(portfolio_mod._verify_strategy_email_attempts) == 3
        finally:
            portfolio_mod._VERIFY_STRATEGY_EMAIL_CACHE_MAX = original_cap


# ---------------------------------------------------------------------------
# PortfolioOptimizerRequest validator (H-0589)
# ---------------------------------------------------------------------------

_VALID_UUID = "123e4567-e89b-12d3-a456-426614174000"


class TestPortfolioOptimizerRequestValidator:
    def test_none_weights_accepted(self):
        # user_id is now REQUIRED (C-PR5-01 follow-up to PR #347); the prior
        # C-001 Optional[str]=None relaxation was the C-PR5-01 attack surface
        # and is closed at the Pydantic layer. _VALID_UUID is passed verbatim
        # here so this weights-focused test still constructs a valid model.
        # Audit H-0533: portfolio_id is also UUID-validated, so use _VALID_UUID.
        from models.schemas import PortfolioOptimizerRequest
        r = PortfolioOptimizerRequest(portfolio_id=_VALID_UUID, user_id=_VALID_UUID)
        assert r.weights is None

    def test_valid_weights_accepted(self):
        from models.schemas import PortfolioOptimizerRequest
        r = PortfolioOptimizerRequest(
            portfolio_id=_VALID_UUID,
            user_id=_VALID_UUID,
            weights={"s1": 0.6, "s2": 0.4},
        )
        assert r.weights == {"s1": 0.6, "s2": 0.4}

    def test_nan_weight_rejected(self):
        from models.schemas import PortfolioOptimizerRequest
        with pytest.raises(Exception):
            PortfolioOptimizerRequest(portfolio_id=_VALID_UUID, user_id=_VALID_UUID, weights={"s1": float("nan")})

    def test_inf_weight_rejected(self):
        from models.schemas import PortfolioOptimizerRequest
        with pytest.raises(Exception):
            PortfolioOptimizerRequest(portfolio_id=_VALID_UUID, user_id=_VALID_UUID, weights={"s1": float("inf")})

    def test_negative_weight_rejected(self):
        from models.schemas import PortfolioOptimizerRequest
        with pytest.raises(Exception):
            PortfolioOptimizerRequest(portfolio_id=_VALID_UUID, user_id=_VALID_UUID, weights={"s1": -0.5})

    def test_non_numeric_weight_rejected(self):
        from models.schemas import PortfolioOptimizerRequest
        with pytest.raises(Exception):
            PortfolioOptimizerRequest(portfolio_id=_VALID_UUID, user_id=_VALID_UUID, weights={"s1": "not-a-number"})


# ---------------------------------------------------------------------------
# VerifyStrategyRequest boundary validation (audit H-0530 exchange Literal,
# H-0536 email format/length). These pin the service-edge contract to the DB
# CHECK (exchange IN ('binance','okx','bybit'), email TEXT) + the TS boundary
# (SUPPORTED_EXCHANGES, isValidEmail). They FAIL if the field types regress to
# bare ``str`` — an out-of-domain exchange or a junk email would then clear
# Pydantic and only fail at INSERT (or never), the exact pre-fix defect.
# ---------------------------------------------------------------------------

class TestVerifyStrategyRequestValidation:
    _BASE = {
        "email": "trader@example.com",
        "exchange": "binance",
        "api_key": "k" * 16,
        "api_secret": "s" * 16,
    }

    def test_valid_request_accepted(self):
        from models.schemas import VerifyStrategyRequest
        r = VerifyStrategyRequest(**self._BASE)
        assert r.exchange == "binance"
        assert r.email == "trader@example.com"

    def test_all_three_supported_exchanges_accepted(self):
        from models.schemas import VerifyStrategyRequest
        for ex in ("binance", "okx", "bybit"):
            assert VerifyStrategyRequest(**{**self._BASE, "exchange": ex}).exchange == ex

    def test_deribit_exchange_accepted(self):
        # Phase 68 (DRB-02): the key-save boundary now admits 'deribit' in
        # lockstep with the TS SUPPORTED_EXCHANGES allowlist + the SQL CHECKs.
        # A deribit verify request constructs without raising at the boundary.
        from models.schemas import VerifyStrategyRequest
        r = VerifyStrategyRequest(**{**self._BASE, "exchange": "deribit"})
        assert r.exchange == "deribit"

    def test_unknown_exchange_rejected(self):
        # The closed-set gate itself is still proven: an out-of-domain value
        # ('kraken' — which create_exchange also constructs) 422s at the Literal
        # boundary before any live handshake, even though 'deribit' now clears it.
        from models.schemas import VerifyStrategyRequest
        with pytest.raises(ValidationError):
            VerifyStrategyRequest(**{**self._BASE, "exchange": "kraken"})

    def test_malformed_email_rejected(self):
        from models.schemas import VerifyStrategyRequest
        with pytest.raises(ValidationError):
            VerifyStrategyRequest(**{**self._BASE, "email": "not-an-email"})

    def test_empty_email_rejected(self):
        from models.schemas import VerifyStrategyRequest
        with pytest.raises(ValidationError):
            VerifyStrategyRequest(**{**self._BASE, "email": "   "})

    def test_oversized_email_rejected(self):
        # RFC-5321 caps addr-spec at 254 chars; oversized payloads are a junk
        # row + trivial-DoS vector (H-0536).
        from models.schemas import VerifyStrategyRequest
        long_local = "a" * 250
        with pytest.raises(ValidationError):
            VerifyStrategyRequest(**{**self._BASE, "email": f"{long_local}@example.com"})

    def test_control_char_email_rejected(self):
        from models.schemas import VerifyStrategyRequest
        with pytest.raises(ValidationError):
            VerifyStrategyRequest(**{**self._BASE, "email": "evil\n@example.com"})

    # --- Divergent cases the tightened validator (regex + Unicode Cc) newly
    # rejects. These pin the "mirror+harden the TS isValidEmail" contract so a
    # regression to the looser partition()-based check fails loudly.

    def test_trailing_dot_domain_rejected(self):
        # Both an empty final label (``trader@gmail.``) and a trailing dot after
        # a valid TLD (``trader@example.com.``) are rejected — the latter would
        # otherwise create a distinct rate-limit/idempotency key for the same
        # address. Stricter than the TS regex, which accepts the trailing dot.
        from models.schemas import VerifyStrategyRequest
        for bad in ("trader@gmail.", "trader@example.com."):
            with pytest.raises(ValidationError):
                VerifyStrategyRequest(**{**self._BASE, "email": bad})

    def test_interior_whitespace_rejected(self):
        from models.schemas import VerifyStrategyRequest
        with pytest.raises(ValidationError):
            VerifyStrategyRequest(**{**self._BASE, "email": "trader name@example.com"})

    def test_multiple_at_rejected(self):
        from models.schemas import VerifyStrategyRequest
        with pytest.raises(ValidationError):
            VerifyStrategyRequest(**{**self._BASE, "email": "a@b@example.com"})

    def test_del_control_char_rejected(self):
        # DEL (0x7f) and the C1 range are control chars the prior ``ord(ch)<32``
        # check missed; the Unicode ``Cc`` category catches them.
        from models.schemas import VerifyStrategyRequest
        with pytest.raises(ValidationError):
            VerifyStrategyRequest(**{**self._BASE, "email": "trader@example.com\x7f"})

    def test_max_length_boundary(self):
        # 254 chars accepted, 255 rejected — pins the >254 cap exactly.
        from models.schemas import VerifyStrategyRequest
        at_limit = "a" * 249 + "@e.co"   # 249 + 5 = 254
        assert len(at_limit) == 254
        assert VerifyStrategyRequest(**{**self._BASE, "email": at_limit}).email == at_limit
        over_limit = "a" * 250 + "@e.co"  # 255
        with pytest.raises(ValidationError):
            VerifyStrategyRequest(**{**self._BASE, "email": over_limit})

    # --- Audit H-0535: api_key/api_secret/passphrase are pydantic.SecretStr.
    # NOTE: we assert on BEHAVIOR (masked repr + .get_secret_value round-trip),
    # not `isinstance(_, SecretStr)`. Sibling test modules in this suite install
    # MagicMock stubs that can re-import `pydantic` under a distinct module
    # identity, so a class-identity `isinstance` check flakes in the full-suite
    # ordering even though the field genuinely IS a SecretStr (see the file
    # header re: stub-import contamination). The security contract is the
    # masked-repr + opaque-str behavior — that is what we pin.
    def test_credentials_are_secretstr(self):
        """H-0535: the three credential fields must be SecretStr so they never
        render verbatim in repr/str/validation errors. The raw value is only
        reachable via .get_secret_value()."""
        from models.schemas import VerifyStrategyRequest
        r = VerifyStrategyRequest(
            **{**self._BASE, "passphrase": "okx-pass-123456"}
        )
        # Behavioral SecretStr contract: type name, masked str, opaque getter.
        assert type(r.api_key).__name__ == "SecretStr"
        assert type(r.api_secret).__name__ == "SecretStr"
        assert type(r.passphrase).__name__ == "SecretStr"
        assert "**********" in str(r.api_key)
        # Round-trip: the raw value is preserved behind the wrapper.
        assert r.api_key.get_secret_value() == self._BASE["api_key"]
        assert r.api_secret.get_secret_value() == self._BASE["api_secret"]
        assert r.passphrase.get_secret_value() == "okx-pass-123456"

    def test_secretstr_not_leaked_in_repr(self):
        """H-0535: the raw secret must NOT appear in repr(req) / str(field) —
        the exact leak surface (logs, Sentry breadcrumbs, tracebacks)."""
        from models.schemas import VerifyStrategyRequest
        raw_key = "VISIBLE_KEY_VALUE_ABCDEF1234"
        raw_secret = "VISIBLE_SECRET_VALUE_XYZ9876"
        r = VerifyStrategyRequest(
            **{**self._BASE, "api_key": raw_key, "api_secret": raw_secret}
        )
        text = repr(r)
        assert raw_key not in text
        assert raw_secret not in text
        assert raw_key not in str(r.api_key)
        assert raw_secret not in str(r.api_secret)

    def test_passphrase_optional_defaults_none(self):
        """H-0535: passphrase is Optional[SecretStr]; omitting it yields None
        (not a SecretStr('')), so the handler's `is not None` unwrap guard is
        exercised on the non-OKX path."""
        from models.schemas import VerifyStrategyRequest
        r = VerifyStrategyRequest(**self._BASE)
        assert r.passphrase is None

    def test_empty_credential_is_handled_not_crash(self):
        """H-0535: a malformed/empty credential must not crash construction —
        SecretStr('') is a valid (if useless) wrapper; the empty raw value
        round-trips and downstream redaction's len>=6 floor simply skips it.
        The exchange handshake then fails cleanly rather than blowing up at
        the type boundary."""
        from models.schemas import VerifyStrategyRequest
        r = VerifyStrategyRequest(**{**self._BASE, "api_key": ""})
        assert type(r.api_key).__name__ == "SecretStr"
        assert r.api_key.get_secret_value() == ""


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
