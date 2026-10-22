"""Phase 167.2.1.1 UPNLVENUES, plan 04: a forced rebuild of an already-reconstructed key (D-02).

WHY these tests exist. ``run_reconstruct_allocator_history_job`` short-circuits to DONE
when ``api_keys.history_reconstructed_at`` is set, so enqueueing the existing kind for a
Bybit key whose curve was anchored on the wrong reading (wallet balance without the open
uPnL) does nothing. D-02 forbids hand SQL writes ("use the product's own job paths"), so
the handler honours one job-metadata flag, ``force_rebuild``. Each test is named for the
rule it guards:

1. The recompute must REACH a marked key: a forced job crawls it and the rebuilt curve's
   last row is the venue's coin equity (walletBalance + open uPnL), read from the payload.
2. The default must not move: no metadata, non-dict metadata, or any flag value other than
   JSON true still short-circuits exactly as before, and an unforced job's
   ``reconstruct_started`` audit metadata is byte-identical.
3. The flag must not be settable by a user: the only authenticated-user RPC that enqueues
   this kind passes no ``p_metadata``.
4. The multi-key limit is recorded, not hidden: with any sibling api_keys row the persist
   half still takes first-writer-wins DO NOTHING, so a forced job cannot overwrite rows
   written with the old anchor. TODOS [167.2.1.1-MULTIKEY-RECOMPUTE] (booked by plan 06)
   owns that gap and the handoff records such allocators as "recorded, not recomputed".
5. The spelling is a contract with the post-deploy enqueue (plan 06): one literal, pinned.

Every FORCED test runs on an exchange whose anchor applies (ccxt's real parsed Bybit
balance and a readable BYBIT_LINEAR_POSITIONS), so a later rule that a forced rebuild
writes only an anchored curve leaves them green. No test touches a venue, a database or an
enqueue; the exchange is a stub and the database is the in-memory fake.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from services.equity_reconstruction import run_reconstruct_allocator_history_job
from services.job_worker import DispatchOutcome
from tests.test_equity_reconstruction import (
    API_KEY_ID_1,
    _install_fake_audit,
    _install_fake_preflight,
)
from tests.test_reconstruct_marker_writer import (
    _crawl_exchange,
    _freeze_now,
    _job,
    _marker_of,
    _MarkerFake,
    _seed_key,
)
from tests.test_upnl_venues import (
    BYBIT_LINEAR_POSITIONS,
    BYBIT_UNIFIED_WALLET_BALANCE,
    real_bybit_parse_balance,
)

MARKER = "2026-03-01T00:00:00+00:00"
ALREADY_RECONSTRUCTED = "already_reconstructed_for_api_key"
STARTED = "allocator.equity.reconstruct_started"
COMPLETE = "allocator.equity.reconstruct_complete"

# The literal metadata key. Spelled out here, never imported, so a rename of the
# constant is a RED here and not a silent follow-along (see the spelling test).
FORCE_KEY = "force_rebuild"


async def _bybit_exchange() -> AsyncMock:
    """The marker-writer crawl exchange, as Bybit, with an anchor that applies.

    ``fetch_balance`` is ccxt's REAL ``bybit.parse_balance`` of the fixture payload
    (``total['USDT']`` is the coin walletBalance, 1000) and ``fetch_positions`` returns the
    fixture's linear position (open uPnL 250.5), so ``_fetch_current_equity`` returns the
    coin equity 1250.5.
    """
    exchange = _crawl_exchange()
    exchange.id = "bybit"
    exchange.fetch_balance = AsyncMock(
        return_value=await real_bybit_parse_balance(BYBIT_UNIFIED_WALLET_BALANCE)
    )
    exchange.fetch_positions = AsyncMock(return_value=list(BYBIT_LINEAR_POSITIONS))
    return exchange


def _forced_job(key_id: str = API_KEY_ID_1) -> dict[str, Any]:
    return {**_job(key_id), "metadata": {FORCE_KEY: True}}


def _audit_reasons(audit: Any) -> list[Any]:
    return [c.kwargs["metadata"].get("reason") for c in audit.call_args_list]


def _audit_metadata(audit: Any, action: str) -> list[dict[str, Any]]:
    return [
        c.kwargs["metadata"] for c in audit.call_args_list if c.kwargs.get("action") == action
    ]


def _venue_coin_equity() -> float:
    """The payload's own coin ``equity``: the oracle, never produced by the code under test."""
    account = BYBIT_UNIFIED_WALLET_BALANCE["result"]["list"][0]
    (coin,) = [c for c in account["coin"] if c["coin"] == "USDT"]
    return float(coin["equity"])


# ---------------------------------------------------------------------------
# Tracer: job metadata -> handler -> persisted rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_forced_rebuild_of_a_marked_bybit_key_reanchors_its_curve_to_the_venue_equity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A marked sole Bybit key, a job carrying ``force_rebuild: true``: the handler crawls
    instead of short-circuiting and the rebuilt curve ends at the venue's coin equity
    (wallet 1000 + open uPnL 250.5 = 1250.5). On the marker short-circuit alone this was
    RED: no crawl, no rows."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    audit = _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert exchange.fetch_my_trades.await_count > 0, (
        "a forced job on a marked key was short-circuited instead of crawled"
    )
    rows = fake.rows_for("allocator_equity_snapshots")
    assert rows, "a forced rebuild persisted no snapshot rows"
    last = max(rows, key=lambda r: r["asof"])
    expected = _venue_coin_equity()
    assert last["value_usd"] == pytest.approx(expected, abs=0.01), (
        f"the rebuilt curve ends at {last['value_usd']}, not the venue's coin equity "
        f"{expected} (wallet balance plus open uPnL): the anchor did not apply"
    )
    assert ALREADY_RECONSTRUCTED not in _audit_reasons(audit), (
        "the marker short-circuit audit fired on a forced job"
    )
    started = _audit_metadata(audit, STARTED)
    assert len(started) == 1 and started[0].get("forced_rebuild") is True, started
    assert _marker_of(fake, API_KEY_ID_1) is not None, (
        "a completed forced rebuild left its key's marker NULL"
    )
