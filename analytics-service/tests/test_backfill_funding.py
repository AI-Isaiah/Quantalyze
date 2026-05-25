"""H-1107 — branch coverage for scripts/backfill_funding.py::backfill_one_strategy.

backfill_one_strategy has four distinct skip/error branches that
test_funding_backfill_idempotency.py never exercises (that file only tests the
shared upsert helper). Each branch returns (0, 0) so a single broken strategy
never aborts the whole backfill loop:

  (a) strategy_row missing api_key_id        → (0, 0)   [line ~82]
  (b) key_row is None (api_key row missing)  → (0, 0)   [line ~86]
  (c) exchange not in SUPPORTED_EXCHANGES    → (0, 0)   [line ~91]
  (d) fetch_funding raises                   → (0, 0)   [line ~107] + error log

These are the regression-prone branches: promoting a "no api_key" skip into a
hard error would crash the entire loop and lose every other strategy's work; a
SUPPORTED_EXCHANGES change (e.g. dropping 'bybit') would silently skip every
Bybit strategy. The tests pin the (0, 0) contract for each.
"""
from __future__ import annotations

import importlib
import logging
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest


STRATEGY_ID = "00000000-0000-0000-0000-000000000001"
API_KEY_ID = "00000000-0000-0000-0000-0000000000aa"


def _load_backfill_module():
    """Load scripts/backfill_funding.py as a module (mirrors the loader in
    test_funding_backfill_idempotency.py)."""
    scripts_dir = Path(__file__).resolve().parent.parent.parent / "scripts"
    assert scripts_dir.exists(), f"scripts dir missing: {scripts_dir}"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    if "backfill_funding" in sys.modules:
        return importlib.reload(sys.modules["backfill_funding"])
    return importlib.import_module("backfill_funding")


def _key_row(exchange: str = "binance") -> dict:
    """A shape-correct api_keys row. The encrypted fields are placeholders;
    tests that reach decrypt_credentials patch it out so no real crypto runs."""
    return {
        "id": API_KEY_ID,
        "exchange": exchange,
        "api_key_encrypted": "enc",
        "dek_encrypted": "enc",
        "kek_version": 1,
    }


@pytest.mark.asyncio
async def test_no_api_key_id_returns_zeros() -> None:
    """Branch (a): a strategy with no api_key_id is skipped, returning (0, 0)
    WITHOUT crashing — so the backfill loop keeps processing other strategies."""
    backfill = _load_backfill_module()
    supabase = MagicMock()
    strategy_row = {"id": STRATEGY_ID}  # no api_key_id key at all

    fetched, inserted = await backfill.backfill_one_strategy(
        supabase, kek=b"unused", strategy_row=strategy_row, lookback_days=90,
        key_row=None,
    )
    assert (fetched, inserted) == (0, 0)
    # No DB / fetch work happened on the skip.
    supabase.table.assert_not_called()


@pytest.mark.asyncio
async def test_missing_key_row_returns_zeros(caplog) -> None:
    """Branch (b): api_key_id present but the batch key load found no matching
    api_keys row (key_row=None) → skip with a warning, return (0, 0)."""
    backfill = _load_backfill_module()
    supabase = MagicMock()
    strategy_row = {"id": STRATEGY_ID, "api_key_id": API_KEY_ID}

    with caplog.at_level(logging.WARNING, logger="backfill_funding"):
        fetched, inserted = await backfill.backfill_one_strategy(
            supabase, kek=b"unused", strategy_row=strategy_row, lookback_days=90,
            key_row=None,
        )
    assert (fetched, inserted) == (0, 0)
    assert any(
        "missing" in rec.getMessage() for rec in caplog.records
    ), "expected a warning that the api_key row is missing"


@pytest.mark.asyncio
async def test_unsupported_exchange_skipped() -> None:
    """Branch (c): an exchange not in SUPPORTED_EXCHANGES (e.g. 'kraken', which
    has no perp funding) is skipped → (0, 0). Pins the SUPPORTED_EXCHANGES gate
    so a regression that drops a supported exchange surfaces, and an unsupported
    one never reaches decrypt/fetch."""
    backfill = _load_backfill_module()
    # Sanity: kraken is genuinely not in the supported set (guards the premise).
    assert "kraken" not in backfill.SUPPORTED_EXCHANGES
    assert {"binance", "okx", "bybit"} <= backfill.SUPPORTED_EXCHANGES

    supabase = MagicMock()
    strategy_row = {"id": STRATEGY_ID, "api_key_id": API_KEY_ID}

    fetched, inserted = await backfill.backfill_one_strategy(
        supabase, kek=b"unused", strategy_row=strategy_row, lookback_days=90,
        key_row=_key_row(exchange="kraken"),
    )
    assert (fetched, inserted) == (0, 0)


@pytest.mark.asyncio
async def test_fetch_funding_raises_caught(monkeypatch, caplog) -> None:
    """Branch (d): fetch_funding raising (e.g. a rate-limit / network error)
    must be caught and logged, returning (0, 0) so one strategy's transient
    failure never aborts the whole backfill loop."""
    backfill = _load_backfill_module()
    supabase = MagicMock()
    strategy_row = {"id": STRATEGY_ID, "api_key_id": API_KEY_ID}

    # decrypt_credentials runs BEFORE fetch_funding; stub it so the test does
    # not depend on real Fernet keys (orthogonal to the branch under test).
    monkeypatch.setattr(
        backfill, "decrypt_credentials",
        lambda key_row, kek: ("k", "s", None),
    )
    monkeypatch.setattr(
        backfill, "fetch_funding",
        AsyncMock(side_effect=Exception("rate limit")),
    )
    # upsert must NOT be reached when fetch fails.
    upsert_spy = AsyncMock(return_value=0)
    monkeypatch.setattr(backfill, "upsert_funding_rows", upsert_spy)

    with caplog.at_level(logging.ERROR, logger="backfill_funding"):
        fetched, inserted = await backfill.backfill_one_strategy(
            supabase, kek=b"unused", strategy_row=strategy_row, lookback_days=90,
            key_row=_key_row(exchange="binance"),
        )

    assert (fetched, inserted) == (0, 0)
    upsert_spy.assert_not_awaited()
    assert any(
        "fetch_funding failed" in rec.getMessage() for rec in caplog.records
    ), "expected an error log when fetch_funding raises"
