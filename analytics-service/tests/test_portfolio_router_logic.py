"""Tests for pure logic in the portfolio router — no HTTP, no Supabase, no exchange.

The router imports services that chain through db.py → supabase, which isn't installed
in the local dev env (it's a Docker/prod dep). We mock the heavy imports at sys.modules
level before importing the router, so the alert logic can be tested in isolation.
"""

import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock


def _install_stubs():
    """Stub out all packages that aren't available in the local test env."""
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

    # supabase.create_client and Client
    sys.modules["supabase"].create_client = MagicMock()
    sys.modules["supabase"].Client = MagicMock()

    # slowapi.Limiter needs to be callable
    sys.modules["slowapi"].Limiter = MagicMock(return_value=MagicMock())
    sys.modules["slowapi.util"].get_remote_address = MagicMock()

    # fastapi.APIRouter needs prefix/tags kwargs
    mock_router = MagicMock()
    sys.modules["fastapi"].APIRouter = MagicMock(return_value=mock_router)
    # H-0805: stub HTTPException as a REAL Exception SUBCLASS, not bare
    # `Exception`. Aliasing it to `Exception` collapsed the type so that
    # `except HTTPException: raise` in the router would catch every
    # ValueError/KeyError/TypeError, and any `pytest.raises(HTTPException)`
    # would match unrelated exceptions — a total loss of specificity vs
    # production. A subclass that accepts the (status_code, detail) kwargs
    # the router constructs preserves the production control flow.
    sys.modules["fastapi"].HTTPException = _StubHTTPException
    sys.modules["fastapi"].Request = MagicMock()


class _StubHTTPException(Exception):
    """Minimal stand-in for fastapi.HTTPException for the local (no-fastapi)
    test env. Accepts the same status_code/detail kwargs the router passes so
    `raise HTTPException(status_code=..., detail=...)` works, and — crucially —
    is a DISTINCT subclass of Exception so `except HTTPException` does not
    swallow plain ValueError/KeyError/TypeError (H-0805)."""

    def __init__(self, status_code: int | None = None, detail: object = None, **kwargs):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


_install_stubs()

# Now the import will succeed even without supabase/fastapi installed
from routers.portfolio import _generate_alerts, _generate_rebalance_drift_alert  # noqa: E402


class TestGenerateAlerts:
    """Tests for _generate_alerts — the pure business-logic alert rules."""

    def _make_supabase_mock(self):
        """Build a mock that supports the select-then-insert dedup pattern.

        The new _generate_alerts does:
          1. SELECT to check for existing unacknowledged alert of the same type
          2. If none found, INSERT the new alert
        The select chain: .table().select().eq().eq().is_().limit().execute()
        By default, the select returns no existing alerts (data=[]), so the
        insert proceeds for every alert type.
        """
        sb = MagicMock()
        # Default: no existing alerts → dedup check passes → insert proceeds
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
        sb.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "alert-1"}])
        return sb

    def test_drawdown_below_10_percent_no_alert(self):
        """Drawdown at -9% should NOT trigger an alert.

        Note: rebalance_drift branch (Sprint 5 Task 5.4) always runs and
        may issue reads, so we assert on the insert path instead of
        `sb.table.assert_not_called()`.
        """
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.09, avg_pairwise_corr=0.2)
        sb.table.return_value.insert.assert_not_called()

    def test_drawdown_exactly_10_percent_no_alert(self):
        """Drawdown at exactly -10% is not strictly below threshold — no alert."""
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.10, avg_pairwise_corr=0.2)
        sb.table.return_value.insert.assert_not_called()

    def test_drawdown_triggers_medium_alert(self):
        """Drawdown at -15% (> -10%, < -20%) → severity='medium'."""
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.15, avg_pairwise_corr=0.2)
        # New code inserts one alert per call (select-then-insert per type)
        alert = sb.table.return_value.insert.call_args[0][0]
        assert alert["alert_type"] == "drawdown"
        assert alert["severity"] == "medium"
        assert "15.0%" in alert["message"]

    def test_drawdown_triggers_high_alert(self):
        """Drawdown at -25% (< -20%) → severity='high'."""
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.25, avg_pairwise_corr=0.2)
        alert = sb.table.return_value.insert.call_args[0][0]
        assert alert["severity"] == "high"

    def test_correlation_spike_triggers_alert(self):
        """avg_pairwise_corr > 0.70 → correlation_spike alert with medium severity."""
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.05, avg_pairwise_corr=0.85)
        alert = sb.table.return_value.insert.call_args[0][0]
        assert alert["alert_type"] == "correlation_spike"
        assert alert["severity"] == "medium"

    def test_correlation_at_threshold_no_alert(self):
        """avg_pairwise_corr at exactly 0.70 should NOT trigger (uses strict >)."""
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.05, avg_pairwise_corr=0.70)
        sb.table.return_value.insert.assert_not_called()

    def test_both_triggers_fire_together(self):
        """Both drawdown and correlation spike → 2 separate insert calls."""
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.22, avg_pairwise_corr=0.75)
        # New code does one insert per alert type
        insert_calls = sb.table.return_value.insert.call_args_list
        assert len(insert_calls) == 2
        types_found = {call[0][0]["alert_type"] for call in insert_calls}
        assert types_found == {"drawdown", "correlation_spike"}

    def test_none_inputs_no_crash(self):
        """None drawdown and None corr produce no alerts and do not raise."""
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=None, avg_pairwise_corr=None)
        sb.table.return_value.insert.assert_not_called()

    def test_supabase_insert_failure_does_not_raise(self):
        """If Supabase raises during insert, _generate_alerts swallows it silently."""
        sb = MagicMock()
        # Mock the select-then-insert path: select succeeds (no existing), insert fails
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
        sb.table.return_value.insert.return_value.execute.side_effect = RuntimeError("DB down")
        # Should NOT propagate the exception
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.25, avg_pairwise_corr=0.80)

    # ── H-0804: NaN inputs must not fire alerts ──────────────────────────
    def test_nan_drawdown_no_alert(self):
        """H-0804(a): max_drawdown=NaN must NOT trigger a drawdown alert.

        `nan < -0.10` is False in IEEE-754, so the threshold check is
        silently skipped. The correct behaviour is no insert — a NaN is a
        computation gap, not a -10%+ breach. If a regression replaced the
        `<` with a not-`>=` style guard, NaN would slip through and fire a
        spurious alert; this asserts it does not.
        """
        sb = self._make_supabase_mock()
        _generate_alerts(
            sb, "portfolio-1", max_drawdown=float("nan"), avg_pairwise_corr=0.2
        )
        sb.table.return_value.insert.assert_not_called()

    def test_nan_correlation_no_alert(self):
        """H-0804(b): avg_pairwise_corr=NaN must NOT trigger a correlation
        spike. `nan > 0.70` is False, so no alert should be inserted."""
        sb = self._make_supabase_mock()
        _generate_alerts(
            sb, "portfolio-1", max_drawdown=-0.05, avg_pairwise_corr=float("nan")
        )
        sb.table.return_value.insert.assert_not_called()

    def test_both_nan_no_alert(self):
        """H-0804: both inputs NaN → no alerts, no crash."""
        sb = self._make_supabase_mock()
        _generate_alerts(
            sb, "portfolio-1", max_drawdown=float("nan"), avg_pairwise_corr=float("nan")
        )
        sb.table.return_value.insert.assert_not_called()

    def test_drawdown_message_formats_negative_percent(self):
        """H-0804(c): the drawdown message must render the negative sign, e.g.
        -22.5% (f-string `{md*100:.1f}%`), not a stripped-magnitude '22.5%'."""
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.225, avg_pairwise_corr=0.2)
        alert = sb.table.return_value.insert.call_args[0][0]
        assert alert["message"] == "Portfolio drawdown has reached -22.5%."

    def test_alert_payload_matches_db_check_constraint_shape(self):
        """H-0804(d): every inserted alert's alert_type and severity must be a
        value permitted by the portfolio_alerts CHECK constraints, otherwise
        the production INSERT would be rejected even though the mocked test
        accepts anything.

        Valid sets pinned from the migrations (latest CHECK definitions):
          alert_type IN (drawdown, correlation_spike, sync_failure,
            status_change, optimizer_suggestion, regime_shift,
            underperformance, concentration_creep, rebalance_drift)
          severity IN (critical, high, medium, low)
        A typo like 'mediuml' or a renamed alert_type would fail this.
        """
        valid_alert_types = {
            "drawdown",
            "correlation_spike",
            "sync_failure",
            "status_change",
            "optimizer_suggestion",
            "regime_shift",
            "underperformance",
            "concentration_creep",
            "rebalance_drift",
        }
        valid_severities = {"critical", "high", "medium", "low"}

        sb = self._make_supabase_mock()
        # Fire both drawdown (high) and correlation_spike (medium) at once.
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.30, avg_pairwise_corr=0.90)

        insert_calls = sb.table.return_value.insert.call_args_list
        assert len(insert_calls) == 2
        for call in insert_calls:
            payload = call[0][0]
            # Required field shape.
            assert set(payload.keys()) >= {
                "portfolio_id",
                "alert_type",
                "severity",
                "message",
            }
            assert payload["alert_type"] in valid_alert_types, payload["alert_type"]
            assert payload["severity"] in valid_severities, payload["severity"]
            assert payload["portfolio_id"] == "portfolio-1"
            assert isinstance(payload["message"], str) and payload["message"]

    def test_httpexception_stub_is_distinct_from_base_exception(self):
        """H-0805: the fastapi.HTTPException stub must be a proper Exception
        SUBCLASS, not an alias of `Exception`. Otherwise `except HTTPException`
        in the router would swallow ValueError/KeyError/TypeError and any
        `pytest.raises(HTTPException)` would lose all specificity.

        Asserts: HTTPException is a strict subclass of Exception, is NOT the
        base Exception itself, and a plain ValueError is NOT an instance of it.
        """
        import fastapi

        http_exc = fastapi.HTTPException
        assert issubclass(http_exc, Exception)
        assert http_exc is not Exception
        # Specificity: a generic error must not be caught as an HTTPException.
        assert not isinstance(ValueError("boom"), http_exc)
        # And it must accept the kwargs the router constructs it with.
        instance = http_exc(status_code=404, detail="not found")
        assert isinstance(instance, http_exc)
        assert instance.status_code == 404
        assert instance.detail == "not found"


class TestGenerateRebalanceDriftAlert:
    """Tests for Sprint 5 Task 5.4 rebalance_drift branch.

    Uses a small DSL to build the Supabase mock: different select chains
    are used for portfolios, weight_snapshots, strategies, and
    portfolio_alerts reads, and an .insert() for the write path.
    """

    def _make_supabase(
        self,
        *,
        portfolio_created_at: str | None = "2026-01-01T00:00:00+00:00",
        weight_snapshots: list[dict] | None = None,
        strategies_rows: list[dict] | None = None,
        existing_weekly_alert: bool = False,
    ):
        sb = MagicMock()
        tables: dict[str, MagicMock] = {}

        # Pre-build each named table mock so the SAME mock is returned
        # every time code-under-test calls supabase.table(name). Without
        # this, side_effect would return a fresh MagicMock each call and
        # the insert assertions in the test would hit a different mock
        # than the one the production code wrote to.

        portfolios_t = MagicMock()
        portfolios_t.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data={"created_at": portfolio_created_at} if portfolio_created_at else None
        )
        tables["portfolios"] = portfolios_t

        ws_t = MagicMock()
        ws_t.select.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(
            data=weight_snapshots or []
        )
        tables["weight_snapshots"] = ws_t

        strat_t = MagicMock()
        strat_t.select.return_value.in_.return_value.execute.return_value = MagicMock(
            data=strategies_rows or []
        )
        tables["strategies"] = strat_t

        pa_t = MagicMock()
        existing_data = [{"id": "existing"}] if existing_weekly_alert else []
        # For the OLD generic dedup check (select→eq→eq→is_→limit→execute)
        pa_t.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[]
        )
        # For the NEW weekly dedup (select→eq→eq→eq→is_→gte→limit→execute)
        pa_t.select.return_value.eq.return_value.eq.return_value.eq.return_value.is_.return_value.gte.return_value.limit.return_value.execute.return_value = MagicMock(
            data=existing_data
        )
        pa_t.insert.return_value.execute.return_value = MagicMock(data=[{"id": "new-alert"}])
        tables["portfolio_alerts"] = pa_t

        def _table(name):
            return tables.setdefault(name, MagicMock())

        sb.table.side_effect = _table
        return sb

    def test_honeymoon_suppresses_fresh_portfolio(self):
        """Portfolio age < 7 days → no alert even with obvious drift."""
        now = datetime.now(timezone.utc)
        created = (now - timedelta(days=3)).isoformat()
        sb = self._make_supabase(
            portfolio_created_at=created,
            weight_snapshots=[
                {"strategy_id": "s1", "target_weight": 0.2, "actual_weight": 0.5, "snapshot_date": "2026-04-10"},
            ],
            strategies_rows=[{"id": "s1", "name": "Alpha"}],
        )
        _generate_rebalance_drift_alert(sb, "portfolio-1")
        # Insert must NOT be called on portfolio_alerts
        pa_table = sb.table("portfolio_alerts")
        pa_table.insert.assert_not_called()

    def test_null_target_is_skipped(self):
        """Strategies with null target_weight must not trigger."""
        now = datetime.now(timezone.utc)
        created = (now - timedelta(days=60)).isoformat()
        sb = self._make_supabase(
            portfolio_created_at=created,
            weight_snapshots=[
                {"strategy_id": "s1", "target_weight": None, "actual_weight": 0.5, "snapshot_date": "2026-04-10"},
            ],
            strategies_rows=[{"id": "s1", "name": "Alpha"}],
        )
        _generate_rebalance_drift_alert(sb, "portfolio-1")
        sb.table("portfolio_alerts").insert.assert_not_called()

    def test_drift_below_threshold_no_alert(self):
        """Drift exactly at 5% does NOT fire (strict >)."""
        now = datetime.now(timezone.utc)
        created = (now - timedelta(days=60)).isoformat()
        sb = self._make_supabase(
            portfolio_created_at=created,
            weight_snapshots=[
                {"strategy_id": "s1", "target_weight": 0.20, "actual_weight": 0.25, "snapshot_date": "2026-04-10"},
            ],
            strategies_rows=[{"id": "s1", "name": "Alpha"}],
        )
        _generate_rebalance_drift_alert(sb, "portfolio-1")
        sb.table("portfolio_alerts").insert.assert_not_called()

    def test_drift_above_5pct_fires_medium(self):
        """Drift 8% → medium severity alert."""
        now = datetime.now(timezone.utc)
        created = (now - timedelta(days=60)).isoformat()
        sb = self._make_supabase(
            portfolio_created_at=created,
            weight_snapshots=[
                {"strategy_id": "s1", "target_weight": 0.20, "actual_weight": 0.28, "snapshot_date": "2026-04-10"},
            ],
            strategies_rows=[{"id": "s1", "name": "Alpha"}],
        )
        _generate_rebalance_drift_alert(sb, "portfolio-1")
        pa_table = sb.table("portfolio_alerts")
        inserted = pa_table.insert.call_args[0][0]
        assert inserted["alert_type"] == "rebalance_drift"
        assert inserted["severity"] == "medium"
        assert inserted["strategy_id"] == "s1"
        assert "Alpha" in inserted["message"]

    def test_drift_above_10pct_fires_high(self):
        """Drift 15% → high severity alert."""
        now = datetime.now(timezone.utc)
        created = (now - timedelta(days=60)).isoformat()
        sb = self._make_supabase(
            portfolio_created_at=created,
            weight_snapshots=[
                {"strategy_id": "s1", "target_weight": 0.20, "actual_weight": 0.35, "snapshot_date": "2026-04-10"},
            ],
            strategies_rows=[{"id": "s1", "name": "Alpha"}],
        )
        _generate_rebalance_drift_alert(sb, "portfolio-1")
        inserted = sb.table("portfolio_alerts").insert.call_args[0][0]
        assert inserted["severity"] == "high"

    def test_picks_worst_drift_strategy(self):
        """Multiple strategies → alert fires for the one with the largest drift."""
        now = datetime.now(timezone.utc)
        created = (now - timedelta(days=60)).isoformat()
        sb = self._make_supabase(
            portfolio_created_at=created,
            weight_snapshots=[
                {"strategy_id": "s1", "target_weight": 0.20, "actual_weight": 0.28, "snapshot_date": "2026-04-10"},
                {"strategy_id": "s2", "target_weight": 0.20, "actual_weight": 0.42, "snapshot_date": "2026-04-10"},
                {"strategy_id": "s3", "target_weight": 0.20, "actual_weight": 0.22, "snapshot_date": "2026-04-10"},
            ],
            strategies_rows=[
                {"id": "s1", "name": "Alpha"},
                {"id": "s2", "name": "Beta"},
                {"id": "s3", "name": "Gamma"},
            ],
        )
        _generate_rebalance_drift_alert(sb, "portfolio-1")
        inserted = sb.table("portfolio_alerts").insert.call_args[0][0]
        assert inserted["strategy_id"] == "s2"
        assert "Beta" in inserted["message"]

    def test_weekly_dedup_skips_insert_when_existing(self):
        """If an unacked rebalance_drift exists this week, skip the insert."""
        now = datetime.now(timezone.utc)
        created = (now - timedelta(days=60)).isoformat()
        sb = self._make_supabase(
            portfolio_created_at=created,
            weight_snapshots=[
                {"strategy_id": "s1", "target_weight": 0.20, "actual_weight": 0.42, "snapshot_date": "2026-04-10"},
            ],
            strategies_rows=[{"id": "s1", "name": "Alpha"}],
            existing_weekly_alert=True,
        )
        _generate_rebalance_drift_alert(sb, "portfolio-1")
        sb.table("portfolio_alerts").insert.assert_not_called()

    def test_missing_portfolio_row_no_crash(self):
        """No portfolio row → early return, no insert."""
        sb = self._make_supabase(portfolio_created_at=None)
        _generate_rebalance_drift_alert(sb, "does-not-exist")
        sb.table("portfolio_alerts").insert.assert_not_called()

    def test_no_weight_snapshots_no_crash(self):
        """Empty weight_snapshots → no insert, no exception."""
        now = datetime.now(timezone.utc)
        created = (now - timedelta(days=60)).isoformat()
        sb = self._make_supabase(
            portfolio_created_at=created,
            weight_snapshots=[],
            strategies_rows=[],
        )
        _generate_rebalance_drift_alert(sb, "portfolio-1")
        sb.table("portfolio_alerts").insert.assert_not_called()
