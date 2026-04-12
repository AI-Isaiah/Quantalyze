"""Tests for pure logic in the portfolio router — no HTTP, no Supabase, no exchange.

The router imports services that chain through db.py → supabase, which isn't installed
in the local dev env (it's a Docker/prod dep). We mock the heavy imports at sys.modules
level before importing the router, so the alert logic can be tested in isolation.
"""

import sys
import types
from unittest.mock import MagicMock

import pytest


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
    sys.modules["fastapi"].HTTPException = Exception
    sys.modules["fastapi"].Request = MagicMock()


_install_stubs()

# Now the import will succeed even without supabase/fastapi installed
from routers.portfolio import _generate_alerts  # noqa: E402


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
        """Drawdown at -9% should NOT trigger an alert."""
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.09, avg_pairwise_corr=0.2)
        sb.table.assert_not_called()

    def test_drawdown_exactly_10_percent_no_alert(self):
        """Drawdown at exactly -10% is not strictly below threshold — no alert."""
        sb = self._make_supabase_mock()
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.10, avg_pairwise_corr=0.2)
        sb.table.assert_not_called()

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
        sb.table.assert_not_called()

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
        sb.table.assert_not_called()

    def test_supabase_insert_failure_does_not_raise(self):
        """If Supabase raises during insert, _generate_alerts swallows it silently."""
        sb = MagicMock()
        # Mock the select-then-insert path: select succeeds (no existing), insert fails
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
        sb.table.return_value.insert.return_value.execute.side_effect = RuntimeError("DB down")
        # Should NOT propagate the exception
        _generate_alerts(sb, "portfolio-1", max_drawdown=-0.25, avg_pairwise_corr=0.80)
