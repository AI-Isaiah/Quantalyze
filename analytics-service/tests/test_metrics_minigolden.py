"""audit-2026-05-07 G.4 / P2006: minigolden — independent hand-computed oracle.

The golden_252d parity test is fed by ``regen_golden.py``, which imports the
same helpers that the test asserts against. A math bug in those helpers
bakes silently into the fixture during regen and parity passes anyway. The
defenses against that are layered:

- G.3: ``regen_golden`` requires explicit acknowledgement flags +
  scalar-drift guard (catches large unintentional moves).
- **G.4 (this file)**: a 5-trade scenario with hand-computed expected
  values that exercises the production trade-metrics computation
  directly. Because the expectations are derived from first principles
  (paper, not Python), no shared helper between the test and the SUT can
  mask a regression here.

Scenario:
    W1: long  realized_pnl=+500, roi=+0.5  (entry 100 x10, exit 150 x10, no fees)
    W2: long  realized_pnl=+200, roi=+0.4  (entry 100 x5,  exit 140 x5)
    L1: short realized_pnl=-100, roi=-0.1  (entry 100 x10, exit 110 x10)
    L2: short realized_pnl=-50,  roi=-0.05 (entry 100 x10, exit 105 x10)
    BE: long  realized_pnl=0,    roi=0    (entry 100 x10, exit 100 x10)

Hand-computed expected values (dollars, the Block A contract):
    avg_winning_trade = (500 + 200) / 2 = **350.0** (NOT 0.45 ratio)
    avg_losing_trade  = (-100 + -50) / 2 = **-75.0** (NOT -0.075 ratio)
    winners_count = 2
    losers_count  = 2
    win_rate = 2 / (2 + 2) = 0.5  (breakeven excluded from numerator
                                   AND denominator)
    expectancy = win_rate * avg_win - (1 - win_rate) * abs(avg_loss)
               = 0.5 * 350 - 0.5 * 75
               = **137.5** dollars

Block A (P1994) — winner/loser bucketing on ``realized_pnl`` sign, breakeven
exclusion, and ``data_quality_flags['breakeven_positions']`` — landed in
v0.22.28.0. This file pins the post-fix semantics so any regression to
ROI-ratio averages, breakeven-in-losers, or a missing breakeven flag fails
loudly here, even if ``regen_golden.py`` quietly re-bakes a bad fixture.

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
    f_order = MagicMock()
    f_range = MagicMock()
    f_range.execute.return_value = MagicMock(data=[])
    # M-0939: order() between lte and range.
    f_order.range.return_value = f_range
    f_lte.order.return_value = f_order
    f_gte.lte.return_value = f_lte
    f_eq1.gte.return_value = f_gte
    f_sel.eq.return_value = f_eq1
    mock_funding.select.return_value = f_sel

    def _table(name: str):
        if name == "trades":
            return mock_trades
        if name == "funding_fees":
            return mock_funding
        # Anything else means the production code grew a new table
        # dependency the oracle scenario doesn't model — fail loud rather
        # than auto-vivify a permissive MagicMock that returns wrong shapes.
        raise AssertionError(
            f"minigolden mock supabase received unexpected table: {name!r}. "
            "Update _make_mock_supabase to model the new table or extend "
            "the scenario."
        )

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
# Structural sanity (independent of Block A)
# ---------------------------------------------------------------------------

def test_minigolden_position_count_sanity(minigolden_metrics):
    """5 symbols × (1 open + 1 close) = 10 fills → 5 closed positions."""
    assert minigolden_metrics["closed_positions"] == 5
    assert minigolden_metrics["total_positions"] == 5
    assert minigolden_metrics["open_positions"] == 0


# ---------------------------------------------------------------------------
# Block A (P1994) regression pins — pre-fix semantics fail these loudly
# ---------------------------------------------------------------------------

def test_minigolden_winners_losers_partition(minigolden_metrics):
    """Breakeven MUST be excluded from both winners and losers.

    Hand-counted from the scenario: winners=2 (W1,W2), losers=2 (L1,L2),
    breakeven=1 (BE) — excluded.

    Pre-Block-A bucketing on ``roi <= 0`` lumped BE into losers
    (losers_count==3). A regression to that behaviour fails here.
    """
    assert minigolden_metrics["winners_count"] == 2
    assert minigolden_metrics["losers_count"] == 2


def test_minigolden_avg_winning_trade_is_dollars(minigolden_metrics):
    """avg_winning_trade is the realized_pnl dollar mean, not an ROI ratio.

    Hand-computed: (500 + 200) / 2 = 350.0 dollars.
    Pre-Block-A regression: (0.5 + 0.4) / 2 = 0.45 (ratio).
    """
    assert minigolden_metrics["avg_winning_trade"] == 350.0


def test_minigolden_avg_losing_trade_is_dollars(minigolden_metrics):
    """avg_losing_trade is the realized_pnl dollar mean, not an ROI ratio.

    Hand-computed: (-100 + -50) / 2 = -75.0 dollars.
    Pre-Block-A regression: (-0.1 + -0.05) / 2 = -0.075 (ratio).
    """
    assert minigolden_metrics["avg_losing_trade"] == -75.0


def test_minigolden_win_rate_excludes_breakeven(minigolden_metrics):
    """win_rate = winners / (winners + losers), breakeven excluded.

    Hand-computed: 2 / (2 + 2) = 0.5.
    Pre-Block-A regression (denominator = closed_count): 2/5 = 0.4.
    """
    assert minigolden_metrics["win_rate"] == 0.5


def test_minigolden_data_quality_flags_records_breakeven(minigolden_metrics):
    """``data_quality_flags['breakeven_positions']`` counts BE trades.

    Hand-counted: exactly 1 (the BE scenario). The flag must be present —
    a missing key indicates a regression to pre-Block-A behaviour where
    breakeven trades were silently lumped into losers.
    """
    assert "data_quality_flags" in minigolden_metrics, (
        "data_quality_flags key is missing — Block A regression"
    )
    flags = minigolden_metrics["data_quality_flags"]
    assert flags["breakeven_positions"] == 1


def test_minigolden_realized_pnl_per_trade_preserves_breakeven_zero(
    minigolden_metrics,
):
    """realized_pnl_per_trade must distinguish 0.0 (breakeven) from None.

    Block A (P1994) added the None-vs-0.0 contract: closed positions with
    a numeric ``realized_pnl`` (including 0.0 for breakeven) round-trip as
    that number, while closed positions with no ``realized_pnl`` surface
    as ``None`` and are counted in
    ``data_quality_flags['positions_missing_realized_pnl']``.

    The minigolden BE trade has realized_pnl==0.0 (numeric, not None). A
    regression coercing 0.0 → None (or vice versa) fails here.
    """
    per_trade = minigolden_metrics["realized_pnl_per_trade"]
    assert len(per_trade) == 5
    pnls = sorted(p["realized_pnl"] for p in per_trade)
    assert pnls == [-100.0, -50.0, 0.0, 200.0, 500.0]
    # And the breakeven entry is the literal float 0.0, not None.
    assert any(p["realized_pnl"] == 0.0 for p in per_trade)
    # Block A invariant: no closed-position oracle entry is None here.
    assert all(p["realized_pnl"] is not None for p in per_trade)


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
    # Expectancy: 0.5*350 - 0.5*75 = 137.5 (exact for these inputs).
    assert derived["expectancy"] == 137.5
    # Risk:Reward (dollar ratio) = avg_win / |avg_loss| = 350/75.
    # IEEE-754 ULP slack via approx (rel default 1e-6).
    assert derived["risk_reward_ratio"] == pytest.approx(350.0 / 75.0)
    # Audit-2026-05-07 H-0627 / H-0628: Weighted R:R is now the genuine
    # pnl-weighted average of per-trade R-multiples, NOT the algebraic
    # equivalent of Profit Factor. For the inputs above with risk_unit=75:
    #   R_i  = [500/75, 200/75, -100/75, -50/75]
    #   |w_i|= [500,    200,    100,     50]
    #   weighted_rr = Σ(R_i × |w_i|) / Σ|w_i|
    #              = (500*500/75 + 200*200/75 + 100*100/75 + 50*50/75) / 850
    risk_unit = 75.0
    trades = trade_metrics_post_block_a["realized_pnl_per_trade"]
    num = sum((p["realized_pnl"] / risk_unit) * abs(p["realized_pnl"]) for p in trades)
    den = sum(abs(p["realized_pnl"]) for p in trades)
    expected_weighted_rr = num / den
    assert derived["weighted_risk_reward_ratio"] == pytest.approx(
        expected_weighted_rr
    )
