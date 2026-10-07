"""Tests for pure logic in the portfolio router — no HTTP, no Supabase, no exchange.

`routers.portfolio` and its dependencies (fastapi, supabase, slowapi, ccxt) are
all installed via requirements.txt in CI and the dev venv, and the module imports
with no import-time side effects (the Supabase client is built lazily inside
`get_supabase()`, not at module load). So we import the alert-logic helpers for
real and drive them with locally-constructed Supabase mocks.

H-0806: this module used to run an `_install_stubs()` at import time that mutated
`sys.modules`. Its `if name not in sys.modules` guard only protected the wholesale
MagicMock replacement — the *attribute* writes that followed were unconditional, so
it clobbered the REAL `fastapi.APIRouter/.HTTPException/.Request`,
`supabase.create_client/.Client`, and `slowapi.Limiter` process-globally for every
later-collected test (the textbook filesystem-order-dependent green/red CI). The
deps are no longer optional, so the stub machinery is gone.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from routers import portfolio as portfolio_mod
from routers.portfolio import _generate_alerts, _generate_rebalance_drift_alert
from tests.test_portfolio_compute_integration import _make_supabase_for_compute


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

    # H-0806: the former `test_httpexception_stub_is_distinct_from_base_exception`
    # was removed with the stub it guarded. With the real fastapi imported it
    # could only re-assert fastapi's own class semantics (vacuous per Rule 9 —
    # it cannot fail on any change to OUR code). The invariant it cared about —
    # the router's `except HTTPException` staying specific (not swallowing
    # ValueError/KeyError/TypeError) — is exercised against the REAL
    # fastapi.HTTPException by test_routers_audit_2026_05_17.py's
    # `pytest.raises(HTTPException)` 404/400 endpoint tests.


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


class TestRebalanceDriftStrategyNameChunking:
    """B19: the strategy-name lookup IN-list (`strategies.id`) must be bounded.
    `strategy_ids` here derives from `weight_snapshots`, NOT `portfolio_strategies`,
    so it is NOT capped by `MAX_PORTFOLIO_STRATEGIES` — an unbounded IN-list could
    overflow the PostgREST URL (HTTP 414). Also pins the coverage WARNING that
    surfaces an unresolved name (the sentence then falls back to the raw id)."""

    def _make_sb(self, snapshots, strategies_rows, chunks_out):
        """Supabase mock that RECORDS each `strategies.in_("id", chunk)` call into
        chunks_out so the test can assert the IN-list was actually chunked."""
        sb = MagicMock()

        portfolios_t = MagicMock()
        portfolios_t.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data={"created_at": "2026-01-01T00:00:00+00:00"}  # old → past honeymoon
        )

        ws_t = MagicMock()
        ws_t.select.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(
            data=snapshots
        )

        rows_by_id = {r["id"]: r for r in strategies_rows}

        class _StratSelect:
            def in_(self, _col, ids):
                chunks_out.append(list(ids))
                matched = [rows_by_id[i] for i in ids if i in rows_by_id]
                return MagicMock(execute=lambda: MagicMock(data=matched))

        strat_t = MagicMock()
        strat_t.select.return_value = _StratSelect()

        pa_t = MagicMock()
        pa_t.select.return_value.eq.return_value.eq.return_value.eq.return_value.is_.return_value.gte.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[]  # no existing weekly alert → not deduped
        )
        pa_t.insert.return_value.execute.return_value = MagicMock(data=[{"id": "new"}])

        tables = {
            "portfolios": portfolios_t,
            "weight_snapshots": ws_t,
            "strategies": strat_t,
            "portfolio_alerts": pa_t,
        }
        sb.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
        return sb

    def test_strategy_name_lookup_is_chunked(self):
        from routers.portfolio import _generate_rebalance_drift_alert

        n = 250  # > chunked_in_query's default page_size (200) → forces ≥2 chunks
        snaps = [
            {"strategy_id": f"s{i}", "target_weight": 0.10, "actual_weight": 0.30,
             "snapshot_date": "2026-04-10"}
            for i in range(n)
        ]
        strat_rows = [{"id": f"s{i}", "name": f"Strat {i}"} for i in range(n)]
        chunks: list[list[str]] = []

        _generate_rebalance_drift_alert(self._make_sb(snaps, strat_rows, chunks), "p-1")

        assert len(chunks) >= 2, (
            f"strategy-name IN-list must be chunked for {n} strategies; got "
            f"{len(chunks)} chunk(s)"
        )
        assert all(len(c) <= 200 for c in chunks), (
            f"each chunk must be <= 200 ids; got {[len(c) for c in chunks]}"
        )
        assert sum(len(c) for c in chunks) == n  # every id queried exactly once

    def test_unresolved_name_logs_coverage_warning_and_falls_back_to_id(self, caplog):
        from routers.portfolio import _generate_rebalance_drift_alert

        # One drifting strategy, but the strategies lookup returns NO row for it
        # (e.g. a coverage gap) → WARNING must fire and the alert sentence must
        # fall back to the raw strategy id rather than silently dropping it.
        snaps = [{"strategy_id": "s-missing", "target_weight": 0.10,
                  "actual_weight": 0.40, "snapshot_date": "2026-04-10"}]
        chunks: list[list[str]] = []
        sb = self._make_sb(snaps, strategies_rows=[], chunks_out=chunks)

        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            _generate_rebalance_drift_alert(sb, "p-1")

        assert any(
            r.levelname == "WARNING" and "strategy-name lookup coverage" in r.getMessage()
            for r in caplog.records
        ), (
            "an unresolved strategy name must log a coverage WARNING (B19); got "
            f"{[(r.levelname, r.getMessage()) for r in caplog.records]}"
        )
        inserted = sb.table("portfolio_alerts").insert.call_args[0][0]
        assert inserted["strategy_id"] == "s-missing"
        assert "s-missing" in inserted["message"]  # sentence fell back to the id


# ---------------------------------------------------------------------------
# Phase 164.6.6.2 (D-23): a BTC strategy enters every portfolio blend as USD
# ---------------------------------------------------------------------------

_BTC_DATES = ["2026-02-02", "2026-02-03", "2026-02-04"]
# BTC closes: +10% then +10%. Hand-computed against the shared oracle's
# arithmetic, usd_k = (1 + r_k) * (P_k / P_{k-1}) - 1:
#   B (BTC account, native daily returns 0.0, 0.10, 0.04)
#     d1: 1.10 * 1.10 - 1 = 0.21      (the oracle's 0.21: r = 0.10)
#     d2: 1.04 * 1.10 - 1 = 0.144
#   A (USD account) 0.0, 0.02, 0.01; weights 0.5 / 0.5
#   portfolio d1 = 0.5 * 0.02 + 0.5 * 0.21 = 0.115  (NOT 0.5*0.02 + 0.5*0.10 = 0.06)
#   portfolio d2 = 0.5 * 0.01 + 0.5 * 0.144 = 0.077
_BTC_CLOSES = pd.Series(
    [60000.0, 66000.0, 72600.0],
    index=pd.DatetimeIndex(_BTC_DATES),
    name="BTC",
)


def _recs(values: list[float]) -> list[dict]:
    return [{"date": d, "value": v} for d, v in zip(_BTC_DATES, values)]


def _eq(values: list[float]) -> list[dict]:
    out, level = [], 1.0
    for d, v in zip(_BTC_DATES, values):
        level *= 1 + v
        out.append({"date": d, "value": level})
    return out


def _mixed_portfolio_rows() -> tuple[list[dict], list[dict]]:
    a = [0.0, 0.02, 0.01]
    b = [0.0, 0.10, 0.04]  # B's d1 return is the oracle's r = 0.10
    ps = [
        {"strategy_id": "usd-a", "current_weight": 0.5, "strategies": {"id": "usd-a", "name": "A"}},
        {"strategy_id": "btc-b", "current_weight": 0.5, "strategies": {"id": "btc-b", "name": "B"}},
    ]
    sa = [
        {"strategy_id": "usd-a", "returns_series": _recs(a), "equity_curve": _eq(a),
         "total_aum": 100.0, "data_quality_flags": {}},
        {"strategy_id": "btc-b", "returns_series": _recs(b), "equity_curve": _eq(b),
         "total_aum": 50.0, "data_quality_flags": {"native_unit": "BTC"}},
    ]
    return ps, sa


async def _run_compute(ps: list[dict], sa: list[dict], closes: pd.Series | None):
    sb, tables = _make_supabase_for_compute(portfolio_strategies=ps, analytics_rows=sa)
    closes_mock = AsyncMock(return_value=closes)

    async def _no_benchmark(symbol):
        return None, True

    portfolio_mod._compute_semaphore = asyncio.Semaphore(3)
    with patch.object(portfolio_mod, "get_supabase", return_value=sb), \
         patch.object(portfolio_mod, "get_benchmark_returns", side_effect=_no_benchmark), \
         patch.object(portfolio_mod, "get_btc_closes", closes_mock):
        await portfolio_mod._compute_portfolio_analytics("portfolio-1")
    return tables, closes_mock


class TestPortfolioAnalyticsBlendsBtcInUsd:
    """The portfolio page's portfolio-level numbers must not weight a raw BTC
    return beside USD returns: a 10% BTC move on a 10% BTC account is 21% USD."""

    @pytest.mark.asyncio
    async def test_portfolio_return_blends_the_converted_021_not_the_raw_010(self):
        ps, sa = _mixed_portfolio_rows()
        tables, _ = await _run_compute(ps, sa, _BTC_CLOSES)
        update = tables["portfolio_analytics"].update.call_args[0][0]
        curve = {p["date"][:10]: p["value"] for p in update["portfolio_equity_curve"]}
        # d1 = 0.5*0.02 + 0.5*0.21 = 0.115 -> equity 1.115. The raw-BTC blend
        # would give 0.5*0.02 + 0.5*0.10 = 0.06 -> 1.06.
        assert curve["2026-02-03"] == pytest.approx(1.115, abs=1e-12)
        assert curve["2026-02-03"] != pytest.approx(1.06, abs=1e-3)
        # d2 = 0.5*0.01 + 0.5*0.144 = 0.077
        assert curve["2026-02-04"] == pytest.approx(1.115 * 1.077, abs=1e-12)

    @pytest.mark.asyncio
    async def test_attribution_uses_the_usd_twr_of_the_btc_strategy(self):
        """compute_attribution's contribution is weight * strategy TWR. The BTC
        strategy's stored equity_curve is in BTC, so its TWR must be rebuilt from
        the converted returns: prod(1 + c_k, k>=1) - 1 with c1 = 1.1 * 1.1 - 1 = 0.21
        and c2 = 1.04 * 1.1 - 1 = 0.144 -> 1.21 * 1.144 - 1 = 0.38424.
        The raw equity ratio would be 1.10 * 1.04 - 1 = 0.144."""
        ps, sa = _mixed_portfolio_rows()
        tables, _ = await _run_compute(ps, sa, _BTC_CLOSES)
        update = tables["portfolio_analytics"].update.call_args[0][0]
        by_id = {a["strategy_id"]: a for a in update["attribution_breakdown"]}
        assert by_id["btc-b"]["contribution"] == pytest.approx(0.5 * 0.38424, abs=1e-9)
        # The USD strategy is untouched: 1.02 * 1.01 - 1 = 0.0302.
        assert by_id["usd-a"]["contribution"] == pytest.approx(0.5 * 0.0302, abs=1e-9)

    @pytest.mark.asyncio
    async def test_flags_are_read_from_the_same_row_as_the_returns(self):
        ps, sa = _mixed_portfolio_rows()
        tables, _ = await _run_compute(ps, sa, _BTC_CLOSES)
        selected = tables["strategy_analytics"].select.call_args[0][0]
        assert "data_quality_flags" in selected
        assert "returns_series" in selected

    @pytest.mark.asyncio
    async def test_a_usd_only_portfolio_reads_no_btc_closes_and_is_unchanged(self):
        ps, sa = _mixed_portfolio_rows()
        sa[1]["data_quality_flags"] = {}
        tables, closes_mock = await _run_compute(ps, sa, _BTC_CLOSES)
        closes_mock.assert_not_awaited()
        update = tables["portfolio_analytics"].update.call_args[0][0]
        curve = {p["date"][:10]: p["value"] for p in update["portfolio_equity_curve"]}
        assert curve["2026-02-03"] == pytest.approx(1.06, abs=1e-12)  # 0.5*0.02 + 0.5*0.10

    @pytest.mark.asyncio
    async def test_btc_closes_are_read_once_for_the_whole_request(self):
        ps, sa = _mixed_portfolio_rows()
        sa.append({**sa[1], "strategy_id": "btc-c"})
        ps.append({"strategy_id": "btc-c", "current_weight": 0.2, "strategies": {"id": "btc-c", "name": "C"}})
        _, closes_mock = await _run_compute(ps, sa, _BTC_CLOSES)
        assert closes_mock.await_count == 1

    @pytest.mark.asyncio
    async def test_no_price_source_drops_the_btc_strategy_never_weights_it_raw(self):
        """With no BTC price source the BTC strategy is a MISSING series (named in
        data_quality, weights renormalized onto the rest), never a flat or raw one."""
        ps, sa = _mixed_portfolio_rows()
        tables, _ = await _run_compute(ps, sa, None)
        update = tables["portfolio_analytics"].update.call_args[0][0]
        assert "btc-b" in update["data_quality"]["missing_returns_sids"]
        assert update["data_quality"]["partial_data"] is True
        curve = {p["date"][:10]: p["value"] for p in update["portfolio_equity_curve"]}
        # A alone at weight 1.0: d1 = 0.02
        assert curve["2026-02-03"] == pytest.approx(1.02, abs=1e-12)


class _TableChain:
    """A chain-agnostic stand-in for one supabase table query: every builder
    method returns itself, `.in_("strategy_id", ids)` narrows the rows, and
    `.execute()` returns them."""

    def __init__(self, data, negate: bool = False):
        self._data = data
        self._negate = negate

    @property
    def not_(self):
        return _TableChain(self._data, negate=True)

    def in_(self, col, ids):
        if isinstance(self._data, list):
            self._data = [
                r for r in self._data if (r.get(col) in set(ids)) != self._negate
            ]
        return self

    def __getattr__(self, name):
        if name == "execute":
            return lambda: MagicMock(data=self._data)
        return lambda *a, **k: self


class _FakeSupabase:
    def __init__(self, tables: dict[str, object]):
        self._tables = tables

    def table(self, name: str) -> _TableChain:
        data = self._tables.get(name, [])
        return _TableChain(list(data) if isinstance(data, list) else data)


def _blend_tables() -> dict[str, object]:
    usd = [0.0, 0.02, 0.01]
    btc = [0.0, 0.10, 0.04]
    return {
        "portfolios": {"id": "pf", "user_id": "u"},
        "portfolio_strategies": [
            {"strategy_id": "usd-a", "current_weight": 0.5},
            {"strategy_id": "btc-b", "current_weight": 0.5},
        ],
        "strategy_analytics": [
            {"strategy_id": "usd-a", "returns_series": _recs(usd), "data_quality_flags": {}},
            {"strategy_id": "btc-b", "returns_series": _recs(btc),
             "data_quality_flags": {"native_unit": "BTC"}},
            {"strategy_id": "btc-cand", "returns_series": _recs(btc),
             "data_quality_flags": {"native_unit": "BTC"}},
            {"strategy_id": "usd-cand", "returns_series": _recs(usd), "data_quality_flags": None},
        ],
        "strategies": [
            {"id": "btc-cand", "name": "BC"},
            {"id": "usd-cand", "name": "UC"},
        ],
        "portfolio_analytics": [],
    }


def _d1(series: pd.Series) -> float:
    return float(series.loc[pd.Timestamp("2026-02-03")])


class TestOptimizerAndBridgeScoreBtcInUsd:
    """`find_improvement_candidates` and `find_replacement_candidates` weight the
    series they are given, so the portfolio's BTC strategies AND a BTC candidate
    must be converted to USD before the call (D-23)."""

    @pytest.mark.asyncio
    async def test_optimizer_hands_the_scorer_usd_series(self):
        seen: dict[str, dict[str, pd.Series]] = {}

        def _spy(portfolio_returns, candidate_returns, weights):
            seen["p"], seen["c"] = portfolio_returns, candidate_returns
            return []

        closes = AsyncMock(return_value=_BTC_CLOSES)
        req = MagicMock(portfolio_id="pf", user_id="u", weights=None)
        with patch.object(portfolio_mod, "get_supabase", return_value=_FakeSupabase(_blend_tables())), \
             patch.object(portfolio_mod, "get_btc_closes", closes), \
             patch.object(portfolio_mod, "find_improvement_candidates", side_effect=_spy), \
             patch.object(portfolio_mod, "log_audit_event"):
            await portfolio_mod.portfolio_optimizer.__wrapped__(MagicMock(), req)

        assert _d1(seen["p"]["btc-b"]) == pytest.approx(0.21, abs=1e-12)  # not the raw 0.10
        assert _d1(seen["c"]["btc-cand"]) == pytest.approx(0.21, abs=1e-12)
        assert _d1(seen["p"]["usd-a"]) == 0.02  # a USD series is untouched
        assert _d1(seen["c"]["usd-cand"]) == 0.02
        assert closes.await_count == 1  # one read for portfolio AND candidates

    @pytest.mark.asyncio
    async def test_bridge_hands_the_scorer_usd_series(self):
        seen: dict[str, dict[str, pd.Series]] = {}

        def _spy(portfolio_returns, candidate_returns, weights, incumbent):
            seen["p"], seen["c"] = portfolio_returns, candidate_returns
            return []

        closes = AsyncMock(return_value=_BTC_CLOSES)
        req = MagicMock(portfolio_id="pf", user_id="bridge-user-1", underperformer_strategy_id="btc-b")
        with patch.object(portfolio_mod, "get_supabase", return_value=_FakeSupabase(_blend_tables())), \
             patch.object(portfolio_mod, "get_btc_closes", closes), \
             patch("services.bridge_scoring.find_replacement_candidates", side_effect=_spy), \
             patch.object(portfolio_mod, "log_audit_event"):
            await portfolio_mod.portfolio_bridge.__wrapped__(MagicMock(), req)

        assert _d1(seen["p"]["btc-b"]) == pytest.approx(0.21, abs=1e-12)
        assert _d1(seen["c"]["btc-cand"]) == pytest.approx(0.21, abs=1e-12)
        assert _d1(seen["p"]["usd-a"]) == 0.02
        assert closes.await_count == 1

    @pytest.mark.asyncio
    async def test_bridge_incumbent_with_no_price_source_is_no_data_not_raw(self):
        closes = AsyncMock(return_value=None)
        req = MagicMock(portfolio_id="pf", user_id="bridge-user-2", underperformer_strategy_id="btc-b")
        with patch.object(portfolio_mod, "get_supabase", return_value=_FakeSupabase(_blend_tables())), \
             patch.object(portfolio_mod, "get_btc_closes", closes), \
             patch.object(portfolio_mod, "log_audit_event"):
            out = await portfolio_mod.portfolio_bridge.__wrapped__(MagicMock(), req)
        assert out["status"] == "incumbent_no_data"
        assert out["partial_data"] is True
