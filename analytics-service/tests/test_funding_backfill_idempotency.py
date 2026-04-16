"""Idempotency test for scripts/backfill_funding.py.

Regression guard: running the backfill twice against the same exchange
data must NOT create duplicate funding_fees rows. Deduplication is
enforced by UNIQUE(match_key) + ON CONFLICT DO NOTHING on upsert.

This test mocks both CCXT and Supabase; it verifies the upsert call
shape (conflict target + ignore_duplicates) rather than real DB state,
which is covered by migration 044's UNIQUE constraint.
"""
from __future__ import annotations

import importlib
import sys
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


STRATEGY_ID = "00000000-0000-0000-0000-000000000001"


def _load_backfill_module():
    """Load scripts/backfill_funding.py as a module without depending on
    packaging layout."""
    scripts_dir = (
        Path(__file__).resolve().parent.parent.parent / "scripts"
    )
    assert scripts_dir.exists(), f"scripts dir missing: {scripts_dir}"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    if "backfill_funding" in sys.modules:
        return importlib.reload(sys.modules["backfill_funding"])
    return importlib.import_module("backfill_funding")


@pytest.mark.asyncio
async def test_upsert_uses_match_key_conflict_target() -> None:
    """The backfill must upsert with on_conflict='match_key', ignore_duplicates=True.

    This is what makes a re-run idempotent — PostgreSQL DO NOTHING on the
    UNIQUE(match_key) constraint drops duplicate rows silently.
    """
    backfill = _load_backfill_module()

    captured_calls: list[dict] = []

    def _make_mock_supabase() -> MagicMock:
        mock = MagicMock()

        # funding_fees.upsert(rows, on_conflict=..., ignore_duplicates=...)
        mock_table = MagicMock()
        mock_upsert = MagicMock()
        mock_upsert.execute.return_value = MagicMock(data=[])

        def _upsert(rows, on_conflict=None, ignore_duplicates=False):
            captured_calls.append({
                "rows": rows,
                "on_conflict": on_conflict,
                "ignore_duplicates": ignore_duplicates,
            })
            return mock_upsert

        mock_table.upsert.side_effect = _upsert
        mock.table.return_value = mock_table
        return mock

    fake_rows = [
        {
            "strategy_id": STRATEGY_ID,
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": Decimal("-0.01"),
            "currency": "USDT",
            "timestamp": "2024-01-01T00:00:00+00:00",
            "match_key": f"{STRATEGY_ID}:binance:BTCUSDT:2024-01-01T00:00:00+00:00",
            "raw_data": {"x": 1},
        }
    ]

    mock_supabase = _make_mock_supabase()

    async def _mock_fetch_funding(*args, **kwargs):
        return fake_rows

    # Run twice
    with patch.object(backfill, "fetch_funding", new=AsyncMock(side_effect=_mock_fetch_funding)):
        await backfill.upsert_funding_rows(mock_supabase, fake_rows)
        await backfill.upsert_funding_rows(mock_supabase, fake_rows)

    # Both calls must have used on_conflict='match_key' + ignore_duplicates=True
    assert len(captured_calls) == 2
    for call in captured_calls:
        assert call["on_conflict"] == "match_key"
        assert call["ignore_duplicates"] is True
        assert len(call["rows"]) == 1


@pytest.mark.asyncio
async def test_empty_rows_noop() -> None:
    """upsert_funding_rows([]) does nothing — no DB call."""
    backfill = _load_backfill_module()

    mock_supabase = MagicMock()
    await backfill.upsert_funding_rows(mock_supabase, [])
    mock_supabase.table.assert_not_called()


@pytest.mark.asyncio
async def test_batching_respects_limit() -> None:
    """Rows are batched — the upsert is called in chunks so large backfills
    don't blow the HTTP payload size."""
    backfill = _load_backfill_module()

    captured_batch_sizes: list[int] = []

    mock = MagicMock()
    mock_table = MagicMock()
    mock_upsert = MagicMock()
    mock_upsert.execute.return_value = MagicMock(data=[])

    def _upsert(rows, on_conflict=None, ignore_duplicates=False):
        captured_batch_sizes.append(len(rows))
        return mock_upsert

    mock_table.upsert.side_effect = _upsert
    mock.table.return_value = mock_table

    # 250 rows should be batched (default batch size expected ≤ 200).
    many_rows = [
        {
            "strategy_id": STRATEGY_ID,
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": Decimal("-0.01"),
            "currency": "USDT",
            "timestamp": "2024-01-01T00:00:00+00:00",
            "match_key": f"{STRATEGY_ID}:binance:BTCUSDT:bucket-{i}",
            "raw_data": None,
        }
        for i in range(250)
    ]

    await backfill.upsert_funding_rows(mock, many_rows)
    # At least 2 batches
    assert sum(captured_batch_sizes) == 250
    assert len(captured_batch_sizes) >= 2
