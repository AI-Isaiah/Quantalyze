"""Regenerate golden_252d_*.{parquet,json} fixtures for METRICS-13 parity test.

Run via:
    ``python -m tests.fixtures.regen_golden --i-am-fixing-a-real-bug``
from ``analytics-service/`` cwd.

Invariants (D-09 + cross-AI review fixes):

- ``np.random.seed(42)``
- 252 trading days
- ~5% annualized volatility, ~0.4 Sharpe, ~10% max DD
- ~250 fills, ~50 closed positions
- **H-A1: simulates positions/prices/NAV** so ``_compute_turnover_series`` and
  ``compute_exposure_metrics`` emit non-empty series in expected JSON
- **B-01: uses ``_compute_derived_trade_metrics(volume_metrics,
  trade_metrics_from_positions)``** passing BOTH dicts (NOT extending
  ``_compute_volume_metrics``)
- **H-F: includes ``weighted_risk_reward_ratio`` in trade_metrics output**

audit-2026-05-07 P1689 / P2006 guards: this script imports the same helpers
that test_metrics_parity.py asserts against, so a math bug bakes silently
into the fixture on regen and parity still passes. To make accidental
overwrite loud:

- ``--i-am-fixing-a-real-bug`` is REQUIRED. Without it the script exits
  with code 2 and a guidance message. This prevents a wandering refactor
  from regenerating the fixture without an acknowledged reason.
- If a prior fixture exists, scalar-key drift > 1% on > 3 keys requires
  the additional ``--accept-numpy-drift`` flag — a forcing function to
  surface unexpected math changes.

audit-2026-05-07 P2005: the script also pins ``_fixture_has_maker_taker``
into ``golden_252d_expected.json`` as a top-level key, so the consuming
parity test no longer relies on the ``TRADE_MIX_HAS_MAKER_TAKER`` env to
match. Cross-process contract instead of cross-process convention.

Bytes-stable across env changes — runs entirely in NumPy/pandas/quantstats.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from services.analytics_runner import (
    _compute_derived_trade_metrics,  # B-01 — extracted in Plan 12-05
    _compute_position_side_volume_pcts,
    _compute_trade_mix,
    _compute_volume_aggregator,
    _compute_volume_metrics,
)
from services.metrics import compute_all_metrics
from services.position_reconstruction import _compute_turnover_series

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
        # Audit-2026-05-07 round-2 / P1994: bucket by sign of
        # `realized_pnl` (dollars), matching production code at
        # services/position_reconstruction.py. Pre-fix this script
        # bucketed by `roi` sign and summed ROI ratios — producing
        # a golden fixture that documented the broken contract.
        if realized_pnl > 0:
            winners.append(pos)
        elif realized_pnl < 0:
            losers.append(pos)
        # realized_pnl == 0 cases skip both buckets (breakeven). The
        # synthetic data above uses np.random.normal so exact zeros
        # are vanishingly unlikely, but the bucketing rule still
        # mirrors production.
        realized_per_trade.append({"side": side, "realized_pnl": realized_pnl})

    # win_rate denominator: positions with a decided outcome (winner or
    # loser). Synthetic data here produces no breakevens, so this matches
    # `len(positions)` — but the formula tracks the production rule for
    # parity if synthetic data later includes breakevens.
    decided = len(winners) + len(losers)
    win_rate = len(winners) / decided if decided > 0 else 0.0
    # P1994 fix: sum realized_pnl DOLLARS, not ROI ratios. Matches
    # production at position_reconstruction.py:206-217.
    avg_win = (
        sum(p["realized_pnl"] for p in winners) / len(winners)
        if winners
        else 0.0
    )
    avg_loss = (
        sum(p["realized_pnl"] for p in losers) / len(losers)
        if losers
        else 0.0
    )

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


def _scalar_drift_summary(
    old: dict[str, Any], new: dict[str, Any]
) -> dict[str, float]:
    """Walk metrics_json scalars and return relative deltas {key: |drift|}.

    audit-2026-05-07 P1689 / P2006: surfaces unexpected math changes when
    regenerating the fixture. Skips series (lists/dicts) — series drift is
    expected to be widespread on legit refactors; the scalar drift signal
    is the cheaper sanity bell.

    Args:
        old: prior ``metrics_json`` dict from disk.
        new: freshly-computed ``metrics_json`` dict.

    Returns:
        Dict of {scalar_key_path: |relative_delta|} for every key present
        in BOTH where ``old`` is a non-zero numeric. The following silent
        contract drifts are surfaced as ``float('inf')`` so the caller
        refuses to accept them: keys missing on either side, dict↔scalar
        shape flips, exotic numerics that fail isinstance(int|float) but
        slip the bool guard. Matched zeros (0→0) are not recorded — there
        is no drift signal to emit.
    """
    drifts: dict[str, float] = {}

    def _walk(o: Any, n: Any, prefix: str) -> None:
        # dict↔dict: recurse + record missing-on-either-side as inf
        if isinstance(o, dict) and isinstance(n, dict):
            old_keys = set(o.keys())
            new_keys = set(n.keys())
            for k in (old_keys - new_keys):
                drifts[f"{prefix}.{k}" if prefix else k] = float("inf")
            for k in (new_keys - old_keys):
                drifts[f"{prefix}.{k}" if prefix else k] = float("inf")
            for k in (old_keys & new_keys):
                _walk(o[k], n[k], f"{prefix}.{k}" if prefix else k)
            return
        # dict↔non-dict (or vice versa): a shape flip is a contract drift,
        # surface as inf. Pre-fix this branch fell through silently.
        if isinstance(o, dict) != isinstance(n, dict):
            drifts[prefix] = float("inf")
            return
        # Skip lists (series) — scalar-drift signal only.
        if isinstance(o, list) or isinstance(n, list):
            return
        # Skip non-numeric scalars (strings, bools, None).
        if not isinstance(o, (int, float)) or isinstance(o, bool):
            return
        if not isinstance(n, (int, float)) or isinstance(n, bool):
            return
        if o == 0:
            # Avoid div-by-zero; treat 0→non-zero as inf drift. (0,0)
            # matches and is not recorded — no drift signal to emit.
            if n != 0:
                drifts[prefix] = float("inf")
            return
        try:
            drifts[prefix] = abs(float(n) - float(o)) / abs(float(o))
        except (TypeError, ValueError):
            # Both isinstance checks above already passed (int/float, not
            # bool) — only exotic numerics (numpy NaN/Inf or a subclass)
            # can land here. Surface as inf so the drift gate sees it.
            drifts[prefix] = float("inf")

    _walk(old, new, "")
    return drifts


_DRIFT_HEAVY_THRESHOLD = 0.01  # > 1% relative drift counts as "heavy"
_DRIFT_HEAVY_KEY_COUNT = 3  # > N heavy keys trips the gate
_DRIFT_MAGNITUDE_THRESHOLD = 0.05  # any single drift > 5% trips the gate


def _check_drift_or_die(
    fixture_path: Path,
    new_expected: dict[str, Any],
    accept_drift: bool,
) -> None:
    """audit-2026-05-07 P2006: refuse silent fixture overwrite on heavy drift.

    Two-arm trip:
      - Population: > 3 scalar keys with |drift| > 1%  (broad math shift)
      - Magnitude: any single key with |drift| > 5%    (catastrophic
        scalar regression that the population test misses)
    Either arm requires the ``--accept-numpy-drift`` escape hatch.

    If the prior fixture is unreadable or has invalid JSON, raises
    SystemExit(4) — silent skipping of the gate is exactly the contract
    drift this guard exists to prevent. A truly fresh-from-empty regen
    hits the ``not fixture_path.exists()`` early-return instead.
    """
    if not fixture_path.exists():
        return
    try:
        old = json.loads(fixture_path.read_text())
    except OSError as exc:
        print(
            f"REFUSING TO REGENERATE: prior fixture at {fixture_path} is "
            f"unreadable ({exc}). Resolve before regen so the drift gate "
            "can run. (audit-2026-05-07 P2006)",
            file=sys.stderr,
        )
        raise SystemExit(4) from exc
    except json.JSONDecodeError as exc:
        print(
            f"REFUSING TO REGENERATE: prior fixture at {fixture_path} is "
            f"not valid JSON ({exc}). Resolve before regen so the drift "
            "gate can run. (audit-2026-05-07 P2006)",
            file=sys.stderr,
        )
        raise SystemExit(4) from exc
    old_metrics = old.get("metrics_json", {})
    new_metrics = new_expected.get("metrics_json", {})
    drifts = _scalar_drift_summary(old_metrics, new_metrics)
    heavy = {k: v for k, v in drifts.items() if v > _DRIFT_HEAVY_THRESHOLD}
    catastrophic = {
        k: v for k, v in drifts.items() if v > _DRIFT_MAGNITUDE_THRESHOLD
    }
    population_trip = len(heavy) > _DRIFT_HEAVY_KEY_COUNT
    magnitude_trip = bool(catastrophic)
    if (population_trip or magnitude_trip) and not accept_drift:
        keys_preview = sorted(heavy.items(), key=lambda kv: -kv[1])[:10]
        reasons: list[str] = []
        if population_trip:
            reasons.append(
                f"{len(heavy)} keys with |drift| > "
                f"{_DRIFT_HEAVY_THRESHOLD:.0%}"
            )
        if magnitude_trip:
            top = max(catastrophic.values())
            reasons.append(
                f"max |drift| {top:.2%} exceeds "
                f"{_DRIFT_MAGNITUDE_THRESHOLD:.0%} magnitude cap"
            )
        print(
            "REFUSING TO REGENERATE: "
            + " AND ".join(reasons)
            + " (audit-2026-05-07 P2006).",
            file=sys.stderr,
        )
        print("Top offenders (key, |drift|):", file=sys.stderr)
        for k, v in keys_preview:
            print(f"  {k}: {v:.4%}", file=sys.stderr)
        print(
            "\nIf this is intentional (e.g. you are intentionally changing "
            "a formula), re-run with --accept-numpy-drift.",
            file=sys.stderr,
        )
        raise SystemExit(3)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="regen_golden",
        description=(
            "Regenerate golden_252d_*.{parquet,json} fixtures. "
            "audit-2026-05-07 P1689 / P2006 hardened: explicit flags required."
        ),
    )
    parser.add_argument(
        "--i-am-fixing-a-real-bug",
        action="store_true",
        help=(
            "Required acknowledgement that you intend to overwrite the "
            "committed golden fixture. Without this flag, the script exits "
            "with code 2."
        ),
    )
    parser.add_argument(
        "--accept-numpy-drift",
        action="store_true",
        help=(
            "Acknowledge ULP-scale or formula-change scalar drift. Required "
            "when the new fixture differs from the prior fixture by more "
            "than one percent on more than three scalar keys."
        ),
    )
    args = parser.parse_args(argv)

    if not args.i_am_fixing_a_real_bug:
        print(
            "REFUSING TO REGENERATE: golden_252d_expected.json is the "
            "byte-stable parity oracle for METRICS-13. Overwriting it without "
            "an acknowledged reason is how silent math regressions ship.\n"
            "\n"
            "If you really intend to regenerate, pass "
            "--i-am-fixing-a-real-bug.\n"
            "If scalar drift > 1% is expected (formula change), also pass "
            "--accept-numpy-drift.\n"
            "audit-2026-05-07 P1689",
            file=sys.stderr,
        )
        raise SystemExit(2)

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

    # TRADE_MIX_HAS_MAKER_TAKER drives 4-bucket vs 2-bucket Trade Mix per D-15.
    # Match production's parsing at services/analytics_runner.py (case-insensitive
    # "true") so a developer running regen with TRADE_MIX_HAS_MAKER_TAKER=True
    # doesn't silently pin the fixture to the opposite mode.
    has_maker_taker = (
        os.getenv("TRADE_MIX_HAS_MAKER_TAKER", "false").lower() == "true"
    )
    trade_mix = _compute_trade_mix(inp["fills"], has_maker_taker=has_maker_taker)

    # KPI-17 follow-up: position-side volume attribution. The fixture has
    # no `positions` list (only `trade_metrics_from_positions` aggregates),
    # so the helper returns 0/0 — matches the prior `long_volume_pct: 0.0
    # / short_volume_pct: 0.0` shape under `_compute_volume_metrics`'s
    # legacy alias. Real strategies attribute via timestamp window in the
    # `_compute_position_side_volume_pcts` helper; the fixture pipeline
    # preserves the shape only.
    position_side_pcts = _compute_position_side_volume_pcts(
        inp["fills"], []
    )

    merged_trade_metrics = {
        **inp["trade_metrics_from_positions"],
        **volume_metrics,
        **position_side_pcts,
        **volume_aggregator,
        **derived,
        "trade_mix": trade_mix,
    }
    # Audit-2026-05-07 round-2 H-0737: mirror the production strip — the
    # per-trade realized PnL list is read INTERNALLY by
    # `_compute_derived_trade_metrics` but is REMOVED from the persisted
    # JSONB to close an RLS-readable info leak. The regen fixture must
    # match the persisted shape, otherwise the parity test will fail with
    # a contract mismatch on the next regen. See
    # analytics-service/services/analytics_runner.py for the matching strip.
    merged_trade_metrics.pop("realized_pnl_per_trade", None)
    metrics_json["trade_metrics"] = merged_trade_metrics
    metrics_json["volume_metrics"] = volume_aggregator

    # H-A1: populate sibling kinds for exposure_series + turnover_series
    sibling = dict(result.sibling_kinds)
    sibling["exposure_series"] = inp["exposure_series"]
    sibling["turnover_series"] = _compute_turnover_series(
        inp["positions_by_date"], inp["prices_by_date"], inp["nav_by_date"]
    )

    expected = {
        # audit-2026-05-07 P2005: pin the bucket-shape mode into the fixture
        # so the parity test trusts the fixture instead of an ad-hoc env var.
        "_fixture_has_maker_taker": has_maker_taker,
        "metrics_json": metrics_json,
        "sibling": sibling,
    }

    # audit-2026-05-07 P2006: refuse to silently overwrite the fixture if the
    # new scalar values drift > 1% on more than 3 keys without an explicit
    # --accept-numpy-drift acknowledgement.
    fixture_path = FIXTURES_DIR / "golden_252d_expected.json"
    _check_drift_or_die(fixture_path, expected, args.accept_numpy_drift)

    fixture_path.write_text(
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
