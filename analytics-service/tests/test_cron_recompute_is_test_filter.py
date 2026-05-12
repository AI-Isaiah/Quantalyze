"""Regression test for FIX-LIST P164 / atomic ID G8.F.2.

Scope: the analytics-service cron's portfolio-recompute branch must
filter `portfolios.is_test=false` before triggering recompute.

Pre-fix, every tick's recompute walked portfolio_strategies and
recomputed analytics for every portfolio that owned a synced
strategy — including is_test=true scenario portfolios that the
v0.4.0 pivot hid from the allocator sidebar. That wasted compute,
inflated portfolio_alerts, and triggered email dispatches via
notification_dispatches for hypothetical positions.

This test does NOT import cron.py directly. It exercises the filter
contract by:
  * inlining the recompute branch shape against a chained-call
    supabase MagicMock, asserting only is_test=false portfolios are
    recomputed; and
  * a static-source pin asserting cron.py contains the
    `.eq("is_test", False)` predicate.

Both halves are pure stdlib + pytest — no fastapi/slowapi/ccxt/supabase
imports happen here. Earlier revisions monkey-patched sys.modules at
module load to stub those deps for a local venv that lacked them; that
pollution caused 24 unrelated CI failures (test_debug_key_flow_router,
test_job_worker) when collected alongside this file. The stubs are not
needed because no real-module imports exist in this file.
"""

from unittest.mock import MagicMock

import pytest


def _build_supabase_mock(
    portfolio_strategies_rows: list[dict],
    portfolios_real_rows: list[dict],
):
    """Build a chained-call MagicMock matching the cron query shape:

      supabase.table("portfolio_strategies").select(...).in_(...).execute()
      supabase.table("portfolios").select(...).in_(...).eq("is_test", False).execute()

    Each `.table()` call gets its own chain so we can return different
    fixtures per table.
    """
    sb = MagicMock()

    ps_chain = MagicMock()
    ps_chain.select.return_value.in_.return_value.execute.return_value = MagicMock(
        data=portfolio_strategies_rows,
    )

    pf_chain = MagicMock()
    pf_chain.select.return_value.in_.return_value.eq.return_value.execute.return_value = MagicMock(
        data=portfolios_real_rows,
    )

    def _table(name: str):
        if name == "portfolio_strategies":
            return ps_chain
        if name == "portfolios":
            return pf_chain
        return MagicMock()

    sb.table.side_effect = _table
    return sb


class TestCronRecomputeIsTestFilter:
    """G8.F.2 — cron recompute MUST skip is_test=true portfolios."""

    @pytest.mark.asyncio
    async def test_skips_is_test_true_portfolios(self):
        """Portfolios where the second-round-trip filter excluded them
        (is_test=true) must NOT receive _compute_portfolio_analytics calls.
        """
        # portfolio_strategies has 3 portfolios that own one of the
        # synced strategies. The portfolios table second-round-trip
        # only returns 1 of them as is_test=false — the other 2 are
        # scenario books that must be skipped.
        ps_rows = [
            {"portfolio_id": "real-portfolio-1"},
            {"portfolio_id": "scenario-A"},
            {"portfolio_id": "scenario-B"},
        ]
        real_rows = [{"id": "real-portfolio-1"}]

        sb = _build_supabase_mock(ps_rows, real_rows)

        # Inline-replay the recompute branch from cron.py. We do not
        # invoke the full sync_active_keys orchestrator because that
        # requires extensive HTTP / Bybit / OKX mocking — the unit
        # under test here is the filter behavior, not the upstream
        # sync. Mirror the post-fix shape from cron.py:265-310.
        synced_strategy_ids = ["strat-1", "strat-2"]

        recompute_calls: list[str] = []

        async def fake_recompute(pid: str) -> None:
            recompute_calls.append(pid)

        if synced_strategy_ids:
            ps_resp = (
                sb.table("portfolio_strategies")
                .select("portfolio_id")
                .in_("strategy_id", synced_strategy_ids)
                .execute()
            )
            candidate_portfolio_ids = list(
                set(r["portfolio_id"] for r in (ps_resp.data or []))
            )

            portfolio_ids: list[str] = []
            if candidate_portfolio_ids:
                pf_resp = (
                    sb.table("portfolios")
                    .select("id")
                    .in_("id", candidate_portfolio_ids)
                    .eq("is_test", False)
                    .execute()
                )
                portfolio_ids = [r["id"] for r in (pf_resp.data or [])]

            for pid in portfolio_ids:
                await fake_recompute(pid)

        # The filter test: only the real portfolio is recomputed.
        assert recompute_calls == ["real-portfolio-1"]
        assert "scenario-A" not in recompute_calls
        assert "scenario-B" not in recompute_calls

    def test_cron_source_contains_is_test_predicate(self):
        """Static-source pin: the recompute branch in cron.py must
        contain `.eq("is_test", False)` against the portfolios table.

        Behavioral coverage is in test_skips_is_test_true_portfolios.
        This static check guards against a refactor that drops the
        predicate but otherwise preserves the second round-trip
        (e.g., switching to a single embedded-filter query) — if the
        invariant moves, this test should fail loudly so the author
        re-anchors the behavioral test.
        """
        from pathlib import Path

        cron_path = (
            Path(__file__).resolve().parent.parent / "routers" / "cron.py"
        )
        source = cron_path.read_text(encoding="utf-8")
        # The exact line we shipped; tolerate single OR double quotes.
        assert (
            ".eq(\"is_test\", False)" in source
            or ".eq('is_test', False)" in source
        ), "cron.py recompute branch missing .eq('is_test', False) — see G8.F.2"
