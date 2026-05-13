"""audit-2026-05-07 G.4 / P2006: minigolden — independent hand-computed oracle.

The golden_252d parity test is fed by ``regen_golden.py``, which imports the
same helpers that the test asserts against. A math bug in those helpers
bakes silently into the fixture during regen and parity passes anyway. The
defenses against that are layered:

- G.3: `regen_golden` requires explicit acknowledgement flags + scalar-drift
  guard (catches large unintentional moves).
- **G.4 (this file)**: a 5-trade scenario with hand-computed expected values
  that exercises the production trade-metrics computation directly. Because
  the expectations are derived from first principles (paper, not Python),
  no shared helper between the test and the SUT can mask a regression here.

Scenario:
    W1: long  realized_pnl=+500, roi=+0.5  (entry 100 x10, exit 150 x10, no fees)
    W2: long  realized_pnl=+200, roi=+0.4  (entry 100 x5,  exit 140 x5)
    L1: short realized_pnl=-100, roi=-0.1  (entry 100 x10, exit 110 x10)
    L2: short realized_pnl=-50,  roi=-0.05 (entry 100 x10, exit 105 x10)
    BE: long  realized_pnl=0,    roi=0    (entry 100 x10, exit 100 x10)

Hand-computed expected values (dollars-based, the Block A target):
    avg_winning_trade = (500 + 200) / 2 = **350.0** (NOT 0.45 ratio)
    avg_losing_trade  = (-100 + -50) / 2 = **-75.0** (NOT -0.075 ratio)
    winners_count = 2
    losers_count  = 2
    win_rate = 2/4 = 0.5  (breakeven excluded from BOTH winners and losers)
    expectancy = 0.5 * 350 + 0.5 * -75 = **137.5** dollars

CRITICAL: these tests will **FAIL** on `main` because production currently
emits the ROI-ratio averages (P1994). The failure IS the test of the test
— this file is the independent oracle for Block A's fix. Once Block A
flips `position_reconstruction.py:162-171` to use ``realized_pnl`` instead
of ``roi``, these tests will pass.

Run: ``cd analytics-service && pytest tests/test_metrics_minigolden.py``
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from services.position_reconstruction import reconstruct_positions


# ---------------------------------------------------------------------------
# Fill builders + supabase mock (mirrors test_position_reconstruction_edges.py)
# ---------------------------------------------------------------------------

async def _mock_db_execute(fn):
    return fn()


def _fill(
    symbol: str,
    side: str,
    qty: float,
    price: float,
    ts: str,
) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "side": side,
        "quantity": qty,
        "price": price,
        "fee": 0.0,
        "timestamp": ts,
        "is_fill": True,
        "exchange": "okx",
        "raw_data": {},
    }


def _make_mock_supabase(fills: list[dict]) -> MagicMock:
    """Mock supabase whose `trades.select.eq.eq.order.execute` returns fills.

    Covers the three tables ``reconstruct_positions`` touches:
        - ``trades`` for the fills fetch
        - ``funding_fees`` for ``_attribute_funding`` (returns empty)
        - ``positions`` / RPC for the atomic rebuild (no-op writes)
    """
    mock = MagicMock()

    mock_trades = MagicMock()
    m_sel = MagicMock()
    m_eq1 = MagicMock()
    m_eq2 = MagicMock()
    m_order = MagicMock()
    m_order.execute.return_value = MagicMock(data=fills)
    m_eq2.order.return_value = m_order
    m_eq1.eq.return_value = m_eq2
    m_sel.eq.return_value = m_eq1
    mock_trades.select.return_value = m_sel

    mock_funding = MagicMock()
    f_sel = MagicMock()
    f_eq1 = MagicMock()
    f_gte = MagicMock()
    f_lte = MagicMock()
    f_range = MagicMock()
    f_range.execute.return_value = MagicMock(data=[])
    f_lte.range.return_value = f_range
    f_gte.lte.return_value = f_lte
    f_eq1.gte.return_value = f_gte
    f_sel.eq.return_value = f_eq1
    mock_funding.select.return_value = f_sel

    def _table(name: str):
        if name == "trades":
            return mock_trades
        if name == "funding_fees":
            return mock_funding
        # positions / others — return a permissive mock that no-ops.
        return MagicMock()

    mock.table = _table

    def _rpc(name, payload=None):
        handle = MagicMock()
        handle.execute.return_value = MagicMock(data=[])
        return handle

    mock.rpc = _rpc
    return mock


# ---------------------------------------------------------------------------
# Hand-crafted 5-trade scenario (5 symbols → no FIFO interleaving)
# ---------------------------------------------------------------------------

def _build_minigolden_fills() -> list[dict[str, Any]]:
    """Five disjoint trades on five symbols.

    W1 = SYM0 long  10@100 → 10@150  pnl=+500 roi=+0.5
    W2 = SYM1 long   5@100 →  5@140  pnl=+200 roi=+0.4
    L1 = SYM2 short 10@100 → 10@110  pnl=-100 roi=-0.1
    L2 = SYM3 short 10@100 → 10@105  pnl=-50  roi=-0.05
    BE = SYM4 long  10@100 → 10@100  pnl=0    roi=0
    """
    return [
        # W1
        _fill("SYM0", "buy",  10.0, 100.0, "2025-01-01T00:00:00+00:00"),
        _fill("SYM0", "sell", 10.0, 150.0, "2025-01-02T00:00:00+00:00"),
        # W2
        _fill("SYM1", "buy",   5.0, 100.0, "2025-01-01T00:00:00+00:00"),
        _fill("SYM1", "sell",  5.0, 140.0, "2025-01-02T00:00:00+00:00"),
        # L1
        _fill("SYM2", "sell", 10.0, 100.0, "2025-01-01T00:00:00+00:00"),
        _fill("SYM2", "buy",  10.0, 110.0, "2025-01-02T00:00:00+00:00"),
        # L2
        _fill("SYM3", "sell", 10.0, 100.0, "2025-01-01T00:00:00+00:00"),
        _fill("SYM3", "buy",  10.0, 105.0, "2025-01-02T00:00:00+00:00"),
        # BE
        _fill("SYM4", "buy",  10.0, 100.0, "2025-01-01T00:00:00+00:00"),
        _fill("SYM4", "sell", 10.0, 100.0, "2025-01-02T00:00:00+00:00"),
    ]


@pytest.fixture
def minigolden_metrics() -> dict[str, Any]:
    """Drive `reconstruct_positions` end-to-end with the 5-trade scenario.

    Returns the trade_metrics dict that ``analytics_runner`` would feed into
    ``_compute_derived_trade_metrics``. The asserts below are against this
    dict, which makes them independent of the downstream wiring.
    """
    fills = _build_minigolden_fills()
    mock_sb = _make_mock_supabase(fills)
    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        return asyncio.run(reconstruct_positions("strategy-minigolden", mock_sb))


# ---------------------------------------------------------------------------
# Sanity checks (these MUST pass even on `main`)
# ---------------------------------------------------------------------------

def test_minigolden_position_count_sanity(minigolden_metrics):
    """5 fills × 2 = 10 fills → 5 closed positions (one per symbol)."""
    assert minigolden_metrics["closed_positions"] == 5
    assert minigolden_metrics["total_positions"] == 5
    assert minigolden_metrics["open_positions"] == 0


def test_minigolden_winners_losers_partition(minigolden_metrics):
    """Breakeven MUST be excluded from BOTH winners and losers.

    The production code at position_reconstruction.py:130/136 partitions:
        winners = roi > 0    (strict)
        losers  = roi <= 0   (THIS INCLUDES BE)

    Audit finding (Block A / P1994): the `<=` swallows breakeven into the
    loser bucket, which is wrong — a flat trade is neither a win nor a
    loss. This test asserts the corrected semantics.

    This test is expected to FAIL on `main` (where losers_count == 3, not 2)
    until Block A flips the partition to `roi < 0` for losers and excludes
    BE from both buckets.
    """
    assert minigolden_metrics["winners_count"] == 2
    assert minigolden_metrics["losers_count"] == 2


# ---------------------------------------------------------------------------
# P1994 / Block A oracle — DOLLARS, not ratios
# ---------------------------------------------------------------------------

def test_minigolden_avg_winning_trade_is_dollars(minigolden_metrics):
    """avg_winning_trade MUST be the dollar mean, NOT the ROI ratio.

    Hand-computed: (500 + 200) / 2 = 350.0 dollars.

    Production today (P1994) returns (0.5 + 0.4) / 2 = 0.45 (ratio) — this
    test fails until Block A switches the formula to use realized_pnl.
    """
    assert minigolden_metrics["avg_winning_trade"] == pytest.approx(350.0, abs=1e-6)


def test_minigolden_avg_losing_trade_is_dollars(minigolden_metrics):
    """avg_losing_trade MUST be the dollar mean, NOT the ROI ratio.

    Hand-computed: (-100 + -50) / 2 = -75.0 dollars.

    Production today (P1994) returns (-0.1 + -0.05) / 2 = -0.075 (ratio).
    Block A fixes.
    """
    assert minigolden_metrics["avg_losing_trade"] == pytest.approx(-75.0, abs=1e-6)


def test_minigolden_win_rate_excludes_breakeven(minigolden_metrics):
    """Win rate must be winners / (winners + losers), with BE excluded.

    Hand-computed: 2 / (2 + 2) = 0.5. NOT 2/5 = 0.4 (which would result
    from including BE in the denominator).

    This is currently broken on `main` because the closed-position count
    (5) is the denominator, giving 2/5 = 0.4 instead of 2/4 = 0.5. Block A
    fixes by partitioning closed → winners / losers / breakeven.
    """
    assert minigolden_metrics["win_rate"] == pytest.approx(0.5, abs=1e-6)


def test_minigolden_data_quality_flags_records_breakeven(minigolden_metrics):
    """Breakeven trades must surface as a data_quality_flag count of 1.

    The reconstructed positions output should include a flag like
    ``data_quality_flags.breakeven_positions == 1`` so allocators can see
    that one of the closed trades was flat.

    Block A is expected to add this flag. On `main` the key is absent and
    this test fails with KeyError.
    """
    flags = minigolden_metrics.get("data_quality_flags") or {}
    assert flags.get("breakeven_positions") == 1


def test_minigolden_expectancy_is_dollars():
    """Independent oracle for `_compute_derived_trade_metrics`.

    Expectancy = win_rate * avg_winning_trade - (1-win_rate) * |avg_losing_trade|
               = 0.5 * 350 - 0.5 * 75
               = **137.5 dollars**

    This test invokes ``_compute_derived_trade_metrics`` directly with the
    hand-computed trade_metrics shape (no FIFO involved) so the assertion
    fails ONLY for the derived-metric formula, not for the reconstruction
    partition.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    trade_metrics_post_block_a = {
        "win_rate": 0.5,
        "avg_winning_trade": 350.0,   # dollars
        "avg_losing_trade": -75.0,    # dollars
        "winners_count": 2,
        "losers_count": 2,
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 500.0},
            {"side": "long", "realized_pnl": 200.0},
            {"side": "short", "realized_pnl": -100.0},
            {"side": "short", "realized_pnl": -50.0},
            # BE excluded from per-trade list (Block A behaviour).
        ],
    }
    derived = _compute_derived_trade_metrics({}, trade_metrics_post_block_a)
    assert derived["expectancy"] == pytest.approx(137.5, abs=1e-6)
    # Risk:Reward (dollar ratio) = avg_win / |avg_loss| = 350 / 75 = 4.666...
    assert derived["risk_reward_ratio"] == pytest.approx(350.0 / 75.0, abs=1e-9)
    # Weighted R:R = (350 * 2) / (75 * 2) = 350/75 (same in this symmetric case).
    assert derived["weighted_risk_reward_ratio"] == pytest.approx(
        350.0 / 75.0, abs=1e-9
    )
