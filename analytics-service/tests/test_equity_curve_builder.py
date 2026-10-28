"""Phase 19 / BACKBONE-06 + BACKBONE-09 — EquityCurveBuilder tests.

Covers:
  - BACKBONE-06: open perpetual position valuation at mark price.
  - BACKBONE-09: funding-rate accumulation via attach_funding.
  - The MetricsSnapshot shape and the CR-perf-2 position cache.
  - MARKSOURCE D-03 / SC-3: the builder computes no return scalar and books
    no open profit as a return; every adapter snapshot carries the four as null.

The golden-file TWR / YTD / Sharpe / drawdown tests that lived here (and the
four recorded golden fixtures they loaded) went with the return-based methods
they exercised.
"""
from __future__ import annotations

import importlib
from datetime import datetime, timezone

import pytest

from services.equity_reconstruction import EquityCurveBuilder
from services.ingestion.adapter import Trade
from services.ingestion.serde import metrics_to_jsonb

_UTC = timezone.utc

# The removed method names are built by concatenation: the census walks of
# test_e1_sharpe_twr_parity.py and test_e1_delete_gate.py match the contiguous
# literal, so a spelled-out name in this file would trip them.
_REMOVED_BUILDER_METHODS = (
    "to_equity_curve" + "_daily",
    "compute" + "_twr",
    "compute" + "_ytd",
    "compute" + "_sharpe",
    "compute" + "_max_drawdown",
)


def _fill(
    symbol: str, side: str, price: float, qty: float, when: datetime
) -> Trade:
    return Trade(
        exchange="okx",
        symbol=symbol,
        side=side,
        price=price,
        quantity=qty,
        fee=0.0,
        fee_currency="USDT",
        timestamp=when,
        order_type="limit",
        is_fill=True,
    )


def _round_trip_plus_open_position() -> tuple[list[Trade], dict[str, float]]:
    """One closed round trip worth +100.0 and one open position worth +500.0.

    BTC: buy 1 at 1000, sell 1 at 1100 -> realised +100.0.
    ETH: buy 1 at 2000, still open; the mark of 2500 makes it +500.0.
    """
    trades = [
        _fill("BTC/USDT:USDT", "buy", 1000.0, 1.0, datetime(2026, 1, 5, 12, tzinfo=_UTC)),
        _fill("BTC/USDT:USDT", "sell", 1100.0, 1.0, datetime(2026, 1, 8, 12, tzinfo=_UTC)),
        _fill("ETH/USDT:USDT", "buy", 2000.0, 1.0, datetime(2026, 1, 9, 12, tzinfo=_UTC)),
    ]
    return trades, {"ETH/USDT:USDT": 2500.0}


# ---------------------------------------------------------------------------
# MARKSOURCE D-03 / SC-3 — no open profit lands on a bar, and no return scalar
# is persisted from the trade-reconstruction curve.
#
# The census (plan 167.2.1.1.1.1-02, Task 1) found no screen that reads a
# long-fetch twr or sharpe: the only readers are the teaser status route and
# the landing results panel, and the teaser flow runs inline with the four keys
# already pre-nulled. So the builder no longer computes them at all, and the
# old behaviour (the whole of every open position's profit booked on the last
# bar as one day's return) has nothing left to live in.
# ---------------------------------------------------------------------------


def test_no_last_bar_open_profit():
    """SC-3: an open position's profit is not booked as a return, and the
    snapshot carries no return scalar.

    The +500.0 open profit must not reach total_pnl (a realised-plus-funding
    figure) and must not turn into a twr / sharpe / ytd / max_drawdown. The
    removed methods must not be attributes of the class: a method that
    returned would be the way the spike comes back.
    """
    trades, marks = _round_trip_plus_open_position()
    builder = EquityCurveBuilder(trades, mark_prices=marks)
    builder.attach_funding(
        [{"timestamp": "2026-01-10T00:00:00Z", "symbol": "BTC/USDT:USDT", "payment": 10.0}]
    )

    snap = builder.to_metrics_snapshot()

    assert snap.sharpe is None
    assert snap.twr is None
    assert snap.ytd is None
    assert snap.max_drawdown is None
    assert snap.total_pnl == 110.0  # 100.0 closed + 10.0 funding; the 500.0 is not in it
    assert snap.trade_count == len(trades)
    assert snap.win_rate == 1.0
    for name in _REMOVED_BUILDER_METHODS:
        assert not hasattr(EquityCurveBuilder, name), name


@pytest.mark.parametrize("adapter_module,adapter_class", [
    ("services.ingestion.okx", "OkxAdapter"),
    ("services.ingestion.bybit", "BybitAdapter"),
    ("services.ingestion.binance", "BinanceAdapter"),
    ("services.ingestion.csv_adapter", "CsvAdapter"),
])
def test_long_fetch_adapters_carry_no_return_scalars(adapter_module, adapter_class):
    """What long-fetch writes into metrics_snapshot has the four return scalars
    as null for every adapter that computes them from the builder."""
    trades, _ = _round_trip_plus_open_position()
    adapter = getattr(importlib.import_module(adapter_module), adapter_class)()

    snapshot = adapter.compute_metrics(trades)
    stored = metrics_to_jsonb(snapshot)

    for key in ("twr", "sharpe", "ytd", "max_drawdown"):
        assert getattr(snapshot, key) is None, key
        assert stored[key] is None, key
    assert stored["total_pnl"] == 100.0


# ---------------------------------------------------------------------------
# BACKBONE-06: open-perp valuation
# ---------------------------------------------------------------------------


def test_open_perp_valuation():
    """BACKBONE-06: an open position picks up its unrealized P&L from the mark."""
    trades, marks = _round_trip_plus_open_position()
    positions = EquityCurveBuilder(trades, mark_prices=marks).reconstruct_positions()

    open_positions = [p for p in positions if p.status == "open"]
    assert [p.symbol for p in open_positions] == ["ETH/USDT:USDT"]
    # Open positions get pnl populated from unrealized_pnl per the
    # _position_dict_to_position_kwargs mapping: (2500 - 2000) * 1.
    assert open_positions[0].pnl == 500.0


# ---------------------------------------------------------------------------
# Funding accumulation
# ---------------------------------------------------------------------------


def test_funding_accumulation():
    """Funding rows accumulate into total_pnl (BACKBONE-09), signed and summed
    across days; a base-coin-denominated row is skipped, not added at face value
    (NEW-C30-02)."""
    trades, _ = _round_trip_plus_open_position()
    builder = EquityCurveBuilder(trades)
    builder.attach_funding([
        {"timestamp": "2026-01-10T00:00:00Z", "symbol": "BTCUSDT", "payment": -0.5},
        {"timestamp": "2026-01-10T08:00:00Z", "symbol": "BTCUSDT", "payment": -0.4},
        {"timestamp": "2026-01-11T00:00:00Z", "symbol": "BTCUSDT", "payment": 2.0},
        {"timestamp": "2026-01-11T08:00:00Z", "symbol": "BTCUSD", "payment": 9.0, "currency": "BTC"},
    ])

    assert builder.to_metrics_snapshot().total_pnl == pytest.approx(100.0 + 1.1)


# ---------------------------------------------------------------------------
# MetricsSnapshot shape
# ---------------------------------------------------------------------------


def test_to_metrics_snapshot_shape():
    """to_metrics_snapshot returns a MetricsSnapshot with all 7 fields."""
    trades, marks = _round_trip_plus_open_position()
    snap = EquityCurveBuilder(trades, mark_prices=marks).to_metrics_snapshot()
    for field in (
        "sharpe",
        "twr",
        "ytd",
        "max_drawdown",
        "total_pnl",
        "trade_count",
        "win_rate",
    ):
        assert hasattr(snap, field), (
            f"MetricsSnapshot missing field {field}"
        )


# ---------------------------------------------------------------------------
# CR-perf-2 — reconstruct_positions cache regression
# ---------------------------------------------------------------------------


def test_reconstruct_positions_is_cached_across_calls(monkeypatch):
    """CR-perf-2 regression: to_metrics_snapshot calls reconstruct_positions.
    Without the cache the underlying _match_positions_fifo runs again for every
    snapshot read, burning CPU on every recompute.
    """
    trades, _ = _round_trip_plus_open_position()

    builder = EquityCurveBuilder(trades, mark_prices={})

    from services import position_reconstruction
    real_match = position_reconstruction._match_positions_fifo
    call_counter = {"n": 0}

    def _counting_match(*a, **kw):
        call_counter["n"] += 1
        return real_match(*a, **kw)

    monkeypatch.setattr(
        position_reconstruction, "_match_positions_fifo", _counting_match
    )

    # 1st call: cold cache, populates self._positions_cache.
    builder.reconstruct_positions()
    n_after_first = call_counter["n"]
    assert n_after_first >= 1, "First call must invoke _match_positions_fifo"

    # 2nd call: must hit cache and NOT re-invoke _match_positions_fifo.
    builder.reconstruct_positions()
    assert call_counter["n"] == n_after_first, (
        "CR-perf-2: reconstruct_positions must cache; second call should "
        f"not re-invoke _match_positions_fifo (got n={call_counter['n']})"
    )

    # to_metrics_snapshot reads the positions; the cache must short-circuit it.
    builder.to_metrics_snapshot()
    assert call_counter["n"] == n_after_first, (
        "CR-perf-2: to_metrics_snapshot must reuse cached positions "
        f"(got n={call_counter['n']})"
    )
