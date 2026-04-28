"""Regenerate golden_252d_*.{parquet,json} fixtures for METRICS-13 parity test.

Run via: ``python -m tests.fixtures.regen_golden`` from ``analytics-service/`` cwd.

Invariants (D-09 + cross-AI review fixes):

- ``np.random.seed(42)``
- 252 trading days
- ~5% annualized volatility, ~0.4 Sharpe, ~10% max DD
- ~250 fills, ~50 closed positions
- **H-A1: simulates positions/prices/NAV** so ``compute_turnover_series`` and
  ``compute_exposure_metrics`` emit non-empty series in expected JSON
- **B-01: uses ``_compute_derived_trade_metrics(volume_metrics,
  trade_metrics_from_positions)``** passing BOTH dicts (NOT extending
  ``_compute_volume_metrics``)
- **H-F: includes ``weighted_risk_reward_ratio`` in trade_metrics output**

Bytes-stable across env changes — runs entirely in NumPy/pandas/quantstats.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from services.analytics_runner import (
    _compute_derived_trade_metrics,  # B-01 — extracted in Plan 12-05
    _compute_trade_mix,
    _compute_volume_aggregator,
    _compute_volume_metrics,
)
from services.metrics import compute_all_metrics
from services.position_reconstruction import compute_turnover_series

FIXTURES_DIR = Path(__file__).parent
SEED = 42
N_DAYS = 252
N_SYMBOLS = 5  # synthetic universe (H-A1 position simulation)
SYMBOLS = [f"SYM{i}" for i in range(N_SYMBOLS)]


def _build_input() -> dict:
    """Build the full deterministic input bundle (returns, fills, positions, prices, NAV)."""
    np.random.seed(SEED)
    dates = pd.bdate_range("2025-01-01", periods=N_DAYS)

    # Strategy returns: calibrated random walk
    base = np.random.normal(0.0008, 0.013, N_DAYS)
    base[120:140] = np.random.normal(-0.005, 0.015, 20)  # controlled drawdown
    returns = pd.Series(base, index=dates, name="returns")

    # BTC-like benchmark
    bench = np.random.normal(0.0003, 0.025, N_DAYS)
    benchmark = pd.Series(bench, index=dates, name="benchmark")

    # Synthetic fills (250) — fields satisfy _compute_volume_aggregator + _compute_trade_mix
    # Note: _compute_volume_metrics reads `cost` (absent here → zero buy/sell pcts);
    # this is intentionally byte-stable across runs since the same fills feed both
    # regen and the parity test.
    fills: list[dict] = []
    for i in range(250):
        day_idx = (i * 5) % N_DAYS
        side = "long" if i % 2 == 0 else "short"
        is_maker = (i % 3 == 0)
        fills.append({
            "filled_at": dates[day_idx].strftime("%Y-%m-%d"),
            "side": side,
            "is_maker": is_maker,
            "is_fill": True,
            "symbol": SYMBOLS[i % N_SYMBOLS],
            "notional_usd": 1000.0 * (1 + (i % 10) / 10.0),
            "realized_pnl_usd": float(np.random.normal(2.0, 50.0)),
            "holding_period_hours": 4.0 + (i % 20),
            "qty": float(1.0 + (i % 5) / 10.0),
        })

    # Synthetic closed positions (50) — feed _compute_derived_trade_metrics (B-01 path b)
    positions: list[dict] = []
    winners: list[dict] = []
    losers: list[dict] = []
    realized_per_trade: list[dict] = []
    for i in range(50):
        roi = float(np.random.normal(0.015, 0.06))
        side = "long" if i % 2 == 0 else "short"
        realized_pnl = float(roi * 1000.0)  # $1000 notional per trade
        pos = {
            "side": side,
            "roi": roi,
            "realized_pnl": realized_pnl,
            "duration_days": 2.0 + (i % 7),
        }
        positions.append(pos)
        (winners if roi > 0 else losers).append(pos)
        realized_per_trade.append({"side": side, "realized_pnl": realized_pnl})

    win_rate = len(winners) / max(len(positions), 1)
    avg_win = sum(p["roi"] for p in winners) / max(len(winners), 1) if winners else 0.0
    avg_loss = sum(p["roi"] for p in losers) / max(len(losers), 1) if losers else 0.0

    trade_metrics_from_positions = {
        "total_positions": len(positions),
        "open_positions": 0,
        "closed_positions": len(positions),
        "win_rate": round(win_rate, 4),
        "avg_roi": round(sum(p["roi"] for p in positions) / max(len(positions), 1), 6),
        "avg_duration_days": round(
            sum(p["duration_days"] for p in positions) / max(len(positions), 1), 2
        ),
        "long_count": sum(1 for p in positions if p["side"] == "long"),
        "short_count": sum(1 for p in positions if p["side"] == "short"),
        "best_trade_roi": max((p["roi"] for p in positions), default=0.0),
        "worst_trade_roi": min((p["roi"] for p in positions), default=0.0),
        # Plan 12-05 B-01 path-b extensions:
        "avg_winning_trade": round(avg_win, 6),
        "avg_losing_trade": round(avg_loss, 6),
        "winners_count": len(winners),
        "losers_count": len(losers),
        "realized_pnl_per_trade": realized_per_trade,
    }

    # H-A1: simulate positions_by_date / prices_by_date / nav_by_date
    np.random.seed(SEED)  # re-seed for prices to be independent of returns
    prices_array = np.zeros((N_DAYS, N_SYMBOLS))
    prices_array[0] = 100.0
    for t in range(1, N_DAYS):
        prices_array[t] = prices_array[t - 1] * np.exp(
            np.random.normal(0.0005, 0.02, N_SYMBOLS)
        )

    prices_by_date: dict[str, dict[str, float]] = {}
    for ti, d in enumerate(dates):
        day_str = d.strftime("%Y-%m-%d")
        prices_by_date[day_str] = {
            SYMBOLS[s]: float(prices_array[ti, s]) for s in range(N_SYMBOLS)
        }

    # positions_by_date: each day, each symbol holds a slow-drifting position size
    np.random.seed(SEED + 1)  # independent stream
    position_sizes = np.zeros((N_DAYS, N_SYMBOLS))
    for s in range(N_SYMBOLS):
        x = 0.0
        for t in range(N_DAYS):
            x += float(np.random.normal(0.0, 0.5))
            x *= 0.95  # mean reversion
            position_sizes[t, s] = x

    positions_by_date: dict[str, dict[str, float]] = {}
    for ti, d in enumerate(dates):
        day_str = d.strftime("%Y-%m-%d")
        positions_by_date[day_str] = {
            SYMBOLS[s]: float(position_sizes[ti, s]) for s in range(N_SYMBOLS)
        }

    # nav_by_date: cash + sum_over_symbols(position_size × price); cash = $100k
    nav_by_date: dict[str, float] = {}
    cash = 100_000.0
    for ti, d in enumerate(dates):
        day_str = d.strftime("%Y-%m-%d")
        mtm = sum(
            positions_by_date[day_str][sym] * prices_by_date[day_str][sym]
            for sym in SYMBOLS
        )
        nav_by_date[day_str] = float(cash + mtm)

    # exposure_series: mimics what compute_exposure_metrics would emit if it ran
    # over the position_snapshots table that is populated from positions_by_date.
    # Each row: {date, gross, net} matching the H-A1 contract.
    exposure_series: list[dict[str, Any]] = []
    for d in dates:
        day_str = d.strftime("%Y-%m-%d")
        day_positions = positions_by_date[day_str]
        day_prices = prices_by_date[day_str]
        gross = sum(abs(day_positions[sym] * day_prices[sym]) for sym in SYMBOLS)
        net = sum(day_positions[sym] * day_prices[sym] for sym in SYMBOLS)
        exposure_series.append(
            {"date": day_str, "gross": round(gross, 6), "net": round(net, 6)}
        )

    return {
        "returns": returns,
        "benchmark": benchmark,
        "fills": fills,
        "positions": positions,
        "trade_metrics_from_positions": trade_metrics_from_positions,
        "positions_by_date": positions_by_date,
        "prices_by_date": prices_by_date,
        "nav_by_date": nav_by_date,
        "exposure_series": exposure_series,
    }


def _serialize_series(s: pd.Series) -> list[dict]:
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": float(v)}
        for d, v in s.items()
    ]


def _json_default(obj):
    if isinstance(obj, (np.floating, np.integer)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, pd.Timestamp):
        return obj.strftime("%Y-%m-%d")
    raise TypeError(f"Not JSON-serializable: {type(obj)}")


def main() -> None:
    inp = _build_input()

    # Parquet for Python-side consumption (returns + benchmark only — fills/positions
    # are large and round-trip cleanly through JSON; the parquet stays small).
    pd.DataFrame({
        "returns": inp["returns"],
        "benchmark": inp["benchmark"],
    }).to_parquet(FIXTURES_DIR / "golden_252d_input.parquet")

    # JSON companion for TS side (RESEARCH.md §9.2 path 1) — full input bundle so
    # parity tests on either runtime can reproduce every step.
    input_json = {
        "seed": SEED,
        "n_days": N_DAYS,
        "returns": _serialize_series(inp["returns"]),
        "benchmark": _serialize_series(inp["benchmark"]),
        "fills": inp["fills"],
        "positions": inp["positions"],
        "trade_metrics_from_positions": inp["trade_metrics_from_positions"],
        "positions_by_date": inp["positions_by_date"],
        "prices_by_date": inp["prices_by_date"],
        "nav_by_date": inp["nav_by_date"],
    }
    (FIXTURES_DIR / "golden_252d_input.json").write_text(
        json.dumps(input_json, indent=2, sort_keys=True, default=_json_default)
    )

    # Run the actual metrics path → produce expected output
    result = compute_all_metrics(inp["returns"], inp["benchmark"])
    metrics_json = dict(result.metrics_json)

    # B-01: build trade_metrics by merging position + volume + derived per Plan 12-06 wiring
    volume_metrics = _compute_volume_metrics(inp["fills"])
    volume_aggregator = _compute_volume_aggregator(inp["fills"])
    derived = _compute_derived_trade_metrics(
        volume_metrics, inp["trade_metrics_from_positions"]
    )

    # TRADE_MIX_HAS_MAKER_TAKER drives 4-bucket vs 2-bucket Trade Mix per D-15
    has_maker_taker = os.getenv("TRADE_MIX_HAS_MAKER_TAKER") == "true"
    trade_mix = _compute_trade_mix(inp["fills"], has_maker_taker=has_maker_taker)

    merged_trade_metrics = {
        **inp["trade_metrics_from_positions"],
        **volume_metrics,
        **volume_aggregator,
        **derived,
        "trade_mix": trade_mix,
    }
    metrics_json["trade_metrics"] = merged_trade_metrics
    metrics_json["volume_metrics"] = volume_aggregator

    # H-A1: populate sibling kinds for exposure_series + turnover_series
    sibling = dict(result.sibling_kinds)
    sibling["exposure_series"] = inp["exposure_series"]
    sibling["turnover_series"] = compute_turnover_series(
        inp["positions_by_date"], inp["prices_by_date"], inp["nav_by_date"]
    )

    expected = {
        "metrics_json": metrics_json,
        "sibling": sibling,
    }
    (FIXTURES_DIR / "golden_252d_expected.json").write_text(
        json.dumps(expected, indent=2, sort_keys=True, default=_json_default)
    )

    print(f"Fixtures regenerated. has_maker_taker={has_maker_taker}")
    print(f"  metrics_json keys: {len(metrics_json)}")
    print(
        f"  sibling kinds: {len(sibling)}  "
        "(must include exposure_series + turnover_series — H-A1)"
    )
    print(
        "  trade_metrics has weighted_risk_reward_ratio: "
        f"{'weighted_risk_reward_ratio' in merged_trade_metrics}"
    )


if __name__ == "__main__":
    main()
