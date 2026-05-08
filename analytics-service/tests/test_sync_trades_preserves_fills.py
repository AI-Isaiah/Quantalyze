"""audit-2026-05-07 G12.A.1 — sync_trades RPC must preserve raw fills.

Asserted invariants:
  1. A pre-existing is_fill=true row for a strategy survives a subsequent
     sync_trades(...) RPC call that replaces the strategy's daily_pnl
     (is_fill=false) rows.
  2. The legacy is_fill=false rows are still replaced atomically (the
     RPC returns the count of newly-inserted summary rows).

Migration under test: supabase/migrations/102_sync_trades_preserve_fills.sql.
Original bug: migration 007's sync_trades did
  `DELETE FROM trades WHERE strategy_id = p_strategy_id`
unconditionally, which silently wiped the Phase 2 raw fills written by the
USE_RAW_TRADE_INGESTION worker path. Phase 1 ran BEFORE Phase 2 in
analytics-service/services/job_worker.run_sync_trades_job, so every
successful Phase 1 destroyed prior Phase 2 fills.

Test framework + skipif gate mirror analytics-service/tests/test_resend_correlation_rls.py.
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Iterator

import psycopg
import pytest
from psycopg.rows import dict_row


pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_SUPABASE_DB_URL"),
    reason="Live test Supabase project not configured (TEST_SUPABASE_DB_URL unset). "
    "See MEMORY reference_test_supabase_project.md for the qmnijlgmdhviwzwfyzlc setup.",
)


@pytest.fixture
def service_role_conn() -> Iterator[psycopg.Connection]:
    """Service-role connection. DSN must point at the test project."""
    dsn = os.environ["TEST_SUPABASE_DB_URL"]
    conn = psycopg.connect(dsn, row_factory=dict_row, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture
def seeded_strategy(
    service_role_conn: psycopg.Connection,
) -> Iterator[str]:
    """Provision a throwaway profile + strategy + a Phase 2 raw-fill row.

    Returns the strategy_id so tests can call sync_trades() against it. All
    rows are deleted in the teardown to keep the test project clean across
    runs.
    """
    user_id = str(uuid.uuid4())
    strategy_id = str(uuid.uuid4())
    fill_external_id = f"fill-{uuid.uuid4().hex[:12]}"

    with service_role_conn.cursor() as cur:
        # Profile + strategy seed (FKs into trades).
        cur.execute(
            "INSERT INTO public.profiles (id, role, created_at) "
            "VALUES (%s, 'manager', now())",
            (user_id,),
        )
        cur.execute(
            "INSERT INTO public.strategies "
            "(id, user_id, name, status, created_at) "
            "VALUES (%s, %s, %s, 'pending_review', now())",
            (strategy_id, user_id, f"audit-g12a1-{uuid.uuid4().hex[:6]}"),
        )

        # Phase 2 raw fill — this is the row we are guarding.
        cur.execute(
            """
            INSERT INTO public.trades (
              strategy_id, exchange, symbol, side, price, quantity,
              fee, fee_currency, timestamp, order_type,
              exchange_fill_id, is_fill, cost
            ) VALUES (
              %s, 'okx', 'BTC-USDT-SWAP', 'buy', 50000, 0.1,
              0.5, 'USDT', now(), 'market',
              %s, true, 5000
            )
            """,
            (strategy_id, fill_external_id),
        )

    try:
        yield strategy_id
    finally:
        with service_role_conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.trades WHERE strategy_id = %s",
                (strategy_id,),
            )
            cur.execute(
                "DELETE FROM public.strategies WHERE id = %s",
                (strategy_id,),
            )
            cur.execute(
                "DELETE FROM public.profiles WHERE id = %s",
                (user_id,),
            )


class TestSyncTradesPreservesFills:
    """G12.A.1: Phase 1 sync_trades must not destroy Phase 2 fills."""

    def test_phase1_sync_trades_preserves_raw_fills(
        self,
        service_role_conn: psycopg.Connection,
        seeded_strategy: str,
    ) -> None:
        strategy_id = seeded_strategy
        # Sanity check: the seeded fill is present before sync_trades runs.
        with service_role_conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) AS n FROM public.trades "
                "WHERE strategy_id = %s AND is_fill = true",
                (strategy_id,),
            )
            row = cur.fetchone()
        assert row is not None and row["n"] == 1, "seed precondition: 1 fill row expected"

        # Phase 1 payload — two daily_pnl summary rows (is_fill defaults to false).
        daily_pnl_payload = [
            {
                "exchange": "okx",
                "symbol": "BTC-USDT-SWAP",
                "side": "buy",
                "price": "0",
                "quantity": "0",
                "fee": "0",
                "fee_currency": "USDT",
                "timestamp": "2026-05-01T00:00:00Z",
                "order_type": "summary",
            },
            {
                "exchange": "okx",
                "symbol": "BTC-USDT-SWAP",
                "side": "sell",
                "price": "0",
                "quantity": "0",
                "fee": "0",
                "fee_currency": "USDT",
                "timestamp": "2026-05-02T00:00:00Z",
                "order_type": "summary",
            },
        ]

        with service_role_conn.cursor() as cur:
            cur.execute(
                "SELECT public.sync_trades(%s::uuid, %s::jsonb) AS inserted",
                (strategy_id, json.dumps(daily_pnl_payload)),
            )
            inserted_row = cur.fetchone()
        assert inserted_row is not None
        assert inserted_row["inserted"] == 2, (
            "sync_trades must report the count of inserted daily_pnl rows; "
            f"got {inserted_row['inserted']!r}"
        )

        # The raw fill must still be present; the daily_pnl rows must be the
        # ones the RPC just inserted (not the prior empty set).
        with service_role_conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) AS n FROM public.trades "
                "WHERE strategy_id = %s AND is_fill = true",
                (strategy_id,),
            )
            fills = cur.fetchone()
            cur.execute(
                "SELECT count(*) AS n FROM public.trades "
                "WHERE strategy_id = %s AND is_fill = false",
                (strategy_id,),
            )
            summaries = cur.fetchone()

        assert fills is not None and fills["n"] == 1, (
            "sync_trades wiped the is_fill=true row — Phase 1 destroyed Phase 2 data. "
            "Migration 102 regressed."
        )
        assert summaries is not None and summaries["n"] == 2, (
            f"sync_trades did not replace daily_pnl rows correctly; "
            f"summary count={summaries['n'] if summaries else None!r}"
        )

    def test_phase1_sync_trades_replaces_prior_summaries(
        self,
        service_role_conn: psycopg.Connection,
        seeded_strategy: str,
    ) -> None:
        """Two consecutive sync_trades calls: the second's summary set
        replaces the first's, while the raw fill is preserved across both.
        """
        strategy_id = seeded_strategy
        first_payload = [
            {
                "exchange": "okx",
                "symbol": "BTC-USDT-SWAP",
                "side": "buy",
                "price": "0",
                "quantity": "0",
                "fee": "0",
                "fee_currency": "USDT",
                "timestamp": "2026-05-01T00:00:00Z",
                "order_type": "summary",
            },
        ]
        second_payload = [
            {
                "exchange": "okx",
                "symbol": "ETH-USDT-SWAP",
                "side": "sell",
                "price": "0",
                "quantity": "0",
                "fee": "0",
                "fee_currency": "USDT",
                "timestamp": "2026-05-03T00:00:00Z",
                "order_type": "summary",
            },
        ]

        with service_role_conn.cursor() as cur:
            cur.execute(
                "SELECT public.sync_trades(%s::uuid, %s::jsonb)",
                (strategy_id, json.dumps(first_payload)),
            )
            cur.execute(
                "SELECT public.sync_trades(%s::uuid, %s::jsonb)",
                (strategy_id, json.dumps(second_payload)),
            )
            cur.execute(
                "SELECT symbol FROM public.trades "
                "WHERE strategy_id = %s AND is_fill = false",
                (strategy_id,),
            )
            summaries = [r["symbol"] for r in cur.fetchall()]
            cur.execute(
                "SELECT count(*) AS n FROM public.trades "
                "WHERE strategy_id = %s AND is_fill = true",
                (strategy_id,),
            )
            fills = cur.fetchone()

        assert summaries == ["ETH-USDT-SWAP"], (
            "second sync_trades should replace first's daily_pnl rows; "
            f"got summaries={summaries!r}"
        )
        assert fills is not None and fills["n"] == 1, (
            "raw fill must survive both sync_trades calls; "
            f"got fills count={fills['n'] if fills else None!r}"
        )
