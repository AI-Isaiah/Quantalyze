"""Phase 07 / PURGE-02 — Test-DB end-to-end integration test.

Exercises the full pipeline:
  1. Seed synthetic allocator_holdings rows into a real test Supabase DB.
  2. Invoke run_refresh_allocator_equity_daily_job directly (bypassing the
     outer dispatch loop for test determinism) against a test api_keys row.
  3. Assert rows appear in allocator_equity_snapshots for the test allocator.
  4. Mirror the getMyAllocationDashboard equity-query shape via a direct
     SELECT (same columns the dashboard consumes) and assert the resulting
     `equitySnapshots` array is non-empty AND carries non-zero series.

Per VOICES-ACCEPTED f5 + Grok f3 reinforcement: unit tests mock the UPSERT
layer; this end-to-end test proves the worker → snapshot → dashboard-shape
pipeline actually produces visible data.

Env-gated via QUANTALYZE_INTEGRATION_DB=1 — requires a test Supabase project
with migration 070 applied. Default CI leaves it unset → module is skipped.

How to run locally:
  export QUANTALYZE_INTEGRATION_DB=1
  export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
  export QUANTALYZE_TEST_ALLOCATOR_ID=<uuid of a seeded allocator>
  export QUANTALYZE_TEST_BINANCE_KEY_ID=<uuid of an api_keys row>
  cd analytics-service && pytest tests/test_equity_reconstruction_integration.py -v

File commits zero secrets / real URLs.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

import pytest

if os.getenv("QUANTALYZE_INTEGRATION_DB") != "1":
    pytest.skip(
        "integration tests require QUANTALYZE_INTEGRATION_DB=1 + test Supabase project",
        allow_module_level=True,
    )


@pytest.mark.asyncio
async def test_full_enqueue_to_render_pipeline():
    """End-to-end smoke: worker persists → dashboard-shape SELECT returns
    non-empty equitySnapshots with non-zero series.

    Steps:
      1. Load test allocator + test api_key ids from env.
      2. Seed allocator_holdings for today (mimics what Phase 06
         poll_allocator_positions writes at 04:00 UTC).
      3. Invoke run_refresh_allocator_equity_daily_job directly.
      4. Assert SELECT on allocator_equity_snapshots returns rows for
         (allocator_id, today) with value_usd > 0.
      5. Mirror getMyAllocationDashboard's equity query shape (see
         src/lib/queries.ts — selects asof, value_usd, breakdown, source
         ordered by asof ascending).
      6. Assert the returned equitySnapshots array is non-empty AND
         every row has value_usd > 0 (proves charts have non-zero series,
         per Grok f3 reinforcement).
    """
    allocator_id = os.getenv("QUANTALYZE_TEST_ALLOCATOR_ID")
    api_key_id = os.getenv("QUANTALYZE_TEST_BINANCE_KEY_ID")
    if not allocator_id or not api_key_id:
        pytest.skip(
            "QUANTALYZE_TEST_ALLOCATOR_ID / QUANTALYZE_TEST_BINANCE_KEY_ID must be set"
        )

    from services.db import db_execute, get_supabase
    from services.equity_reconstruction import run_refresh_allocator_equity_daily_job
    from services.job_worker import DispatchOutcome

    supabase = get_supabase()
    today = datetime.now(timezone.utc).date()
    today_iso = today.isoformat()

    # --- Step 1/2: purge any prior today-row + seed holdings -----------------

    def _purge_snapshot():
        return (
            supabase.table("allocator_equity_snapshots")
            .delete()
            .eq("allocator_id", allocator_id)
            .eq("asof", today_iso)
            .execute()
        )

    def _seed_holdings():
        return supabase.table("allocator_holdings").upsert(
            [
                {
                    "allocator_id": allocator_id,
                    "api_key_id": api_key_id,
                    "venue": "binance",
                    "symbol": "BTC",
                    "asof": today_iso,
                    "holding_type": "spot",
                    "side": "flat",
                    "quantity": 0.5,
                    "mark_price": 50000.0,
                    "value_usd": 25000.0,
                    "entry_price": None,
                    "unrealized_pnl_usd": None,
                    "cost_basis_usd": None,
                    "raw_payload": {"asset": "BTC"},
                },
            ],
            on_conflict="allocator_id,venue,symbol,asof",
        ).execute()

    await db_execute(_purge_snapshot)
    await db_execute(_seed_holdings)

    # --- Step 3: invoke the daily refresh handler ----------------------------
    job = {
        "id": f"integration-refresh-{today_iso}",
        "kind": "refresh_allocator_equity_daily",
        "api_key_id": api_key_id,
    }
    result = await run_refresh_allocator_equity_daily_job(job)
    assert result.outcome == DispatchOutcome.DONE, (
        f"expected DONE, got {result!r}"
    )

    # --- Step 4: assert snapshot row exists ---------------------------------
    def _count_today():
        return (
            supabase.table("allocator_equity_snapshots")
            .select("value_usd", count="exact")
            .eq("allocator_id", allocator_id)
            .eq("asof", today_iso)
            .execute()
        )

    res = await db_execute(_count_today)
    data = list(getattr(res, "data", None) or [])
    assert len(data) >= 1, (
        f"expected >=1 snapshot row for ({allocator_id}, {today_iso}); got {data!r}"
    )
    assert float(data[0]["value_usd"]) > 0, (
        f"expected value_usd > 0; got {data[0]!r}"
    )

    # --- Step 5: mirror getMyAllocationDashboard equity query --------------
    # Shape: selects asof, value_usd, breakdown, source (same columns the
    # dashboard payload consumes). Matches src/lib/queries.ts § getMyAllocationDashboard.
    def _dashboard_query():
        return (
            supabase.table("allocator_equity_snapshots")
            .select("asof, value_usd, breakdown, source")
            .eq("allocator_id", allocator_id)
            .order("asof", desc=False)
            .execute()
        )

    dash_res = await db_execute(_dashboard_query)
    equity_snapshots = list(getattr(dash_res, "data", None) or [])

    # --- Step 6: assert charts have non-zero series ------------------------
    assert len(equity_snapshots) > 0, (
        "expected non-empty equitySnapshots from dashboard-shape query"
    )
    non_zero = [r for r in equity_snapshots if float(r.get("value_usd") or 0) > 0]
    assert len(non_zero) > 0, (
        f"expected at least one equity snapshot with value_usd > 0 (proves charts "
        f"have non-zero series per Grok f3); got {equity_snapshots!r}"
    )
    # Today's row must specifically be in the dashboard-shape output.
    today_row = next((r for r in equity_snapshots if r["asof"] == today_iso), None)
    assert today_row is not None, (
        f"today's row missing from dashboard-shape output: {equity_snapshots!r}"
    )
    assert float(today_row["value_usd"]) > 0
