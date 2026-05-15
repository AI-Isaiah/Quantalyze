"""Regression tests for analytics-service/routers/cron.py.

Covers audit-2026-05-07 findings:

  * C-0192 — `_sync_single_key` revoked-key branch sets api_keys
    is_active=False scoped to .eq("id", key_id) only.
  * C-0194 — Transient validation failures (RATE_LIMITED, etc.) do
    NOT deactivate the key; only credential-rejection codes do.
  * C-0199 — Missing KEK raises HTTPException(500), not HTTP 200.
  * C-0200 — Strategy lifecycle filter: archived/suspended/deleted
    strategies are skipped when building the per-key strategy list.
  * C-0201 — Multi-strategy keys: sync_trades RPC fires for EVERY
    linked strategy (pre-fix the loop dropped strategies 2..N).
  * H-0541 / H-0545 — Portfolio recompute error-isolation: one
    portfolio failing must NOT abort recompute of subsequent ones.
  * H-0546 — Portfolio recompute fans out via asyncio.gather (the
    test confirms _compute_portfolio_analytics is awaited for every
    portfolio_id in the result set, in any order).

Why pure stdlib + MagicMock: matching the established pattern in
test_cron_recompute_is_test_filter.py. supabase-py + ccxt are real
deps and import-heavy; the cron module itself imports cleanly, so we
stub validate_key_permissions / create_exchange / get_supabase /
decrypt_credentials / get_kek and exercise the orchestration logic
directly.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# `routers.cron` imports cleanly in the analytics-service venv. We
# patch its external dependencies (get_supabase, validate_key_permissions,
# create_exchange, decrypt_credentials, fetch_all_trades,
# fetch_usdt_balance, get_kek) inline per test.
from routers import cron as cron_mod


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_key_row(
    *,
    key_id: str = "key-1",
    exchange: str = "binance",
    strategy_ids: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": key_id,
        "exchange": exchange,
        "last_sync_at": None,
        "strategy_ids": strategy_ids or [],
        "strategy_id": (strategy_ids or [None])[0],
    }


def _stub_validation(
    *,
    valid: bool,
    error_code: str | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "valid": valid,
        "read_only": True,
        "error": error,
        "error_code": error_code,
        "markets_loaded": True,
        "markets_error": None,
    }


# ---------------------------------------------------------------------------
# C-0192 / C-0194 — credential-rejection vs transient validation
# ---------------------------------------------------------------------------


class TestRevokedKeyBranch:
    """C-0192: credential-rejection codes deactivate the key, scoped to
    the row's primary key. C-0194: transient codes do NOT deactivate.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "error_code",
        ["AUTH_FAILED", "PERMISSION_DENIED", "WITHDRAW_SCOPE", "TRADE_SCOPE"],
    )
    async def test_credential_rejection_deactivates_key_scoped_to_id(
        self, error_code: str
    ):
        """Each credential-rejection code triggers
        supabase.table('api_keys').update({'is_active': False}).eq('id', key_id).
        The .eq('id', key_id) scope is the regression seed against
        accidental mass-update — a Supabase mutation without the .eq
        would disable EVERY active key.
        """
        mock_supabase = MagicMock()
        update_chain = MagicMock()
        eq_chain = MagicMock()
        eq_chain.execute.return_value = MagicMock(data=[])
        update_chain.eq.return_value = eq_chain
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(
                     valid=False, error_code=error_code, error="bad creds"
                 )),
             ):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "key_revoked"
        assert result["error_code"] == error_code
        # Mutation contract: ONE .update on api_keys, ONE .eq('id', key_id).
        mock_supabase.table.assert_any_call("api_keys")
        update_chain.eq.assert_called_once_with("id", "key-1")
        eq_chain.execute.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "error_code",
        [
            "RATE_LIMITED",
            "NETWORK_UNAVAILABLE",
            "DDOS_PROTECTION",
            "EXCHANGE_UNAVAILABLE",
            "VALIDATION_UNEXPECTED",
        ],
    )
    async def test_transient_failure_does_not_deactivate(
        self, error_code: str
    ):
        """C-0194: transient codes must NOT call is_active=False. A
        30-second network blip pre-fix permanently disabled the user's
        key.
        """
        mock_supabase = MagicMock()
        # If `.update` is called we want to be able to detect it.
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(
                     valid=False, error_code=error_code, error="transient"
                 )),
             ):
            key_row = _make_key_row(strategy_ids=["strat-A"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "transient_failure"
        assert result["error_code"] == error_code
        # The deactivate path must NOT have been taken: .update was
        # never called on api_keys.
        update_chain.eq.assert_not_called()


# ---------------------------------------------------------------------------
# C-0201 — multi-strategy keys must fan out sync_trades
# ---------------------------------------------------------------------------


class TestMultiStrategyFanOut:
    """C-0201: A single api_keys row can back multiple strategies. The
    pre-fix code took strategy_rel[0] only — strategies 2..N silently
    missed every cron tick. Post-fix sync_trades is invoked once per
    linked strategy, then api_keys.last_sync_at is updated once.
    """

    @pytest.mark.asyncio
    async def test_sync_trades_fires_for_every_linked_strategy(self):
        mock_supabase = MagicMock()
        # RPC chain: supabase.rpc('sync_trades', {...}).execute() returns
        # an .data int (count of stored trades).
        rpc_chain = MagicMock()
        rpc_chain.execute.return_value = MagicMock(data=3)
        mock_supabase.rpc.return_value = rpc_chain
        # update chain (last_sync_at)
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value.update.return_value = update_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        trades_fixture = [{"id": "t1"}, {"id": "t2"}, {"id": "t3"}]

        with patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=trades_fixture),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None):
            key_row = _make_key_row(strategy_ids=["strat-A", "strat-B", "strat-C"])
            result = await cron_mod._sync_single_key(key_row, kek=b"x" * 32)

        assert result["status"] == "ok"
        # ONE RPC per linked strategy
        assert mock_supabase.rpc.call_count == 3
        invoked_strategies = sorted(
            call.args[1]["p_strategy_id"]
            for call in mock_supabase.rpc.call_args_list
        )
        assert invoked_strategies == ["strat-A", "strat-B", "strat-C"]
        # Result reports per-strategy breakdown
        assert result["per_strategy_stored"] == {
            "strat-A": 3,
            "strat-B": 3,
            "strat-C": 3,
        }
        assert result["strategy_ids"] == ["strat-A", "strat-B", "strat-C"]


# ---------------------------------------------------------------------------
# C-0200 — strategy lifecycle filter
# ---------------------------------------------------------------------------


class TestStrategyLifecycleFilter:
    """C-0200: only sync into strategies whose status is one of
    {draft, pending_review, published}. Archived/suspended/deleted
    strategies must NOT receive a sync_trades RPC.
    """

    def test_status_filter_drops_archived_and_unknown(self):
        """Replays the flatten-shape from cron.cron_sync against a
        fixture and asserts only ALLOWED_STRATEGY_STATUSES survive.
        """
        ALLOWED = {"draft", "pending_review", "published"}
        embedded = [
            {"id": "s-pub", "status": "published"},
            {"id": "s-draft", "status": "draft"},
            {"id": "s-review", "status": "pending_review"},
            {"id": "s-archived", "status": "archived"},
            {"id": "s-suspended", "status": "suspended"},
            {"id": "s-deleted", "status": "deleted"},
        ]
        filtered = [
            e["id"]
            for e in embedded
            if isinstance(e, dict)
            and e.get("id")
            and (e.get("status") in ALLOWED if "status" in e else True)
        ]
        assert filtered == ["s-pub", "s-draft", "s-review"]

    def test_cron_source_pulls_status_from_embed(self):
        """Static-source pin: cron.py must `select(...status)` and
        check the lifecycle filter. Guards against a refactor that
        drops the filter but otherwise looks plausible.
        """
        from pathlib import Path

        src = (
            Path(__file__).resolve().parent.parent / "routers" / "cron.py"
        ).read_text(encoding="utf-8")
        assert "id, status" in src
        assert "ALLOWED_STRATEGY_STATUSES" in src
        assert '"published"' in src
        assert '"pending_review"' in src
        assert '"draft"' in src


# ---------------------------------------------------------------------------
# C-0199 — missing KEK raises HTTPException(500)
# ---------------------------------------------------------------------------


class TestKekMissingFailsLoud:
    """C-0199: Pre-fix the missing-KEK branch returned HTTP 200 + body
    {'error': 'Encryption not configured'} and the Vercel cron runner
    treated it as success — KEK outages were invisible. Post-fix the
    branch raises HTTPException(500) so the cron runner alarms.
    """

    @pytest.mark.asyncio
    async def test_missing_kek_raises_500(self):
        # NOTE: use the HTTPException reference cron.py itself bound at
        # import time (cron_mod.HTTPException). Reaching for
        # `from fastapi import HTTPException` here would be sensitive
        # to sys.modules pollution from other test files in the suite
        # (e.g. test_process_key / test_portfolio_router_logic stub
        # `sys.modules["fastapi"].HTTPException = Exception` for their
        # local-env import shim). Anchoring to cron_mod's binding
        # makes this test order-independent.
        HTTPException = cron_mod.HTTPException

        with patch.object(
            cron_mod, "get_kek", side_effect=RuntimeError("KEK missing")
        ):
            with pytest.raises(HTTPException) as excinfo:
                await cron_mod.cron_sync()

        assert excinfo.value.status_code == 500
        assert "Encryption" in str(excinfo.value.detail) or "KEK" in str(
            excinfo.value.detail
        )


# ---------------------------------------------------------------------------
# H-0541 / H-0545 — portfolio recompute error isolation
# ---------------------------------------------------------------------------


class TestPortfolioRecomputeErrorIsolation:
    """The cron-sync portfolio-recompute block must call
    _compute_portfolio_analytics for EVERY affected portfolio even if
    one raises (H-0545). The response payload must report per-portfolio
    success/failure counts (H-0542). Pre-fix a single failure would log
    and continue but the response payload silently said 'failed=0'.
    """

    @pytest.mark.asyncio
    async def test_one_portfolio_failure_does_not_abort_others(self):
        """Mock _compute_portfolio_analytics with side_effect that
        raises on the first call and succeeds on subsequent ones.
        Assert .call_count == 3 and the response payload reports
        portfolio_recomputes={ok=2, failed=1}.
        """
        # cron_sync lazy-imports `from routers.portfolio import ...`
        # inside the function body. Other tests in the suite have been
        # observed to unload `routers.portfolio` from sys.modules (e.g.
        # via subprocess workers); re-import then hits the real module
        # which needs SUPABASE_URL. Force the module into sys.modules
        # and patch ITS attribute so the lazy import resolves to the
        # mock.
        import sys
        import routers.portfolio as portfolio_mod  # noqa: F401
        sys.modules["routers.portfolio"] = portfolio_mod

        portfolio_ids_in_order = ["p1", "p2", "p3"]

        mock_supabase = MagicMock()

        # api_keys SELECT returns a single ok key with one strategy
        keys_chain = MagicMock()
        keys_chain.select.return_value.eq.return_value.execute.return_value = (
            MagicMock(
                data=[
                    {
                        "id": "key-1",
                        "exchange": "binance",
                        "last_sync_at": None,
                        "strategies": [{"id": "strat-A", "status": "published"}],
                    }
                ]
            )
        )

        # portfolio_strategies SELECT returns three portfolios for the
        # synced strategy
        ps_chain = MagicMock()
        ps_chain.select.return_value.in_.return_value.execute.return_value = (
            MagicMock(
                data=[
                    {"portfolio_id": "p1"},
                    {"portfolio_id": "p2"},
                    {"portfolio_id": "p3"},
                ]
            )
        )

        # portfolios SELECT (is_test=false filter) returns all three
        pf_chain = MagicMock()
        pf_chain.select.return_value.in_.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{"id": "p1"}, {"id": "p2"}, {"id": "p3"}])
        )

        # portfolio_analytics in-flight check: returns no in-flight rows
        pa_chain = MagicMock()
        pa_chain.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = (
            MagicMock(data=[])
        )

        # api_keys UPDATE chain (last_sync_at update at end of sync)
        update_chain = MagicMock()
        update_chain.eq.return_value.execute.return_value = MagicMock(data=[])

        def _table(name: str):
            if name == "api_keys":
                t = MagicMock()
                # SELECT path
                t.select.return_value.eq.return_value.execute.return_value = (
                    keys_chain.select.return_value.eq.return_value.execute.return_value
                )
                # UPDATE path
                t.update.return_value = update_chain
                return t
            if name == "portfolio_strategies":
                return ps_chain
            if name == "portfolios":
                return pf_chain
            if name == "portfolio_analytics":
                return pa_chain
            return MagicMock()

        mock_supabase.table.side_effect = _table
        # supabase.rpc(...).execute() returns a count for sync_trades
        rpc_chain = MagicMock()
        rpc_chain.execute.return_value = MagicMock(data=2)
        mock_supabase.rpc.return_value = rpc_chain

        mock_exchange = AsyncMock()
        mock_exchange.close = AsyncMock()

        # Per-portfolio side-effect: p1 raises, p2/p3 succeed.
        call_log: list[str] = []

        async def _compute_side_effect(pid: str):
            call_log.append(pid)
            if pid == "p1":
                raise RuntimeError("boom for p1")
            return {"analytics_id": f"a-{pid}"}

        with patch.object(cron_mod, "get_kek", return_value=b"x" * 32), \
             patch.object(cron_mod, "get_supabase", return_value=mock_supabase), \
             patch.object(cron_mod, "decrypt_credentials", return_value=("k", "s", None)), \
             patch.object(cron_mod, "create_exchange", return_value=mock_exchange), \
             patch.object(
                 cron_mod,
                 "validate_key_permissions",
                 AsyncMock(return_value=_stub_validation(valid=True)),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_all_trades",
                 AsyncMock(return_value=[{"id": "t1"}, {"id": "t2"}]),
             ), \
             patch.object(
                 cron_mod,
                 "fetch_usdt_balance",
                 AsyncMock(return_value=None),
             ), \
             patch.object(cron_mod, "parse_since_ms", return_value=None), \
             patch.object(
                 portfolio_mod,
                 "_compute_portfolio_analytics",
                 AsyncMock(side_effect=_compute_side_effect),
             ):
            response = await cron_mod.cron_sync()

        # Every portfolio was attempted, even after p1 raised.
        assert sorted(call_log) == sorted(portfolio_ids_in_order)
        assert len(call_log) == 3

        # H-0542: response payload reports per-portfolio outcomes.
        assert "portfolio_recomputes" in response
        pr = response["portfolio_recomputes"]
        assert pr["attempted"] == 3
        assert pr["ok"] == 2
        assert pr["failed"] == 1
        failed_pids = [f["portfolio_id"] for f in pr["failures"]]
        assert failed_pids == ["p1"]
        # Error repr captures the exception type for Sentry correlation.
        assert "RuntimeError" in pr["failures"][0]["error"]
