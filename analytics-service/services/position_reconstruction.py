"""FIFO position matching from raw fills.

Reconstructs position lifecycles by processing fills in timestamp order
per symbol, tracking net position, and recording closed positions with
entry/exit prices, PnL, fees, duration, and ROI.

Also computes exposure metrics from position_snapshots. After FIFO
matching, funding_pnl is attributed to each position by summing
funding_fees rows in [opened_at, closed_at] window.
"""
from __future__ import annotations

import logging
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from services.db import db_execute

logger = logging.getLogger("quantalyze.analytics.position_reconstruction")


async def reconstruct_positions(strategy_id: str, supabase) -> dict:
    """Reconstruct position lifecycles from raw fills using FIFO matching.

    Returns trade_metrics dict for strategy_analytics JSONB. Each closed
    and open position has its funding_pnl column populated by summing
    funding_fees rows in its [opened_at, closed_at] window for the same
    symbol. See migration 044.
    """
    # Query fills ordered by timestamp
    def _fetch_fills():
        return (
            supabase.table("trades")
            .select("*")
            .eq("strategy_id", strategy_id)
            .eq("is_fill", True)
            .order("timestamp")
            .execute()
        )

    result = await db_execute(_fetch_fills)
    fills = result.data or []

    if not fills:
        logger.info("No fills found for strategy %s", strategy_id)
        return {}

    # Group by symbol
    fills_by_symbol: dict[str, list[dict]] = defaultdict(list)
    for fill in fills:
        fills_by_symbol[fill.get("symbol", "UNKNOWN")].append(fill)

    all_positions: list[dict] = []

    for symbol, symbol_fills in fills_by_symbol.items():
        # Sort by timestamp within symbol
        symbol_fills.sort(key=lambda f: f.get("timestamp", ""))
        positions = _match_positions_fifo(symbol, symbol_fills, strategy_id)
        all_positions.extend(positions)

    await _attribute_funding(strategy_id, all_positions, supabase)

    # Persist: DELETE existing positions for strategy, then INSERT new ones
    def _delete_existing():
        supabase.table("positions").delete().eq(
            "strategy_id", strategy_id
        ).execute()

    await db_execute(_delete_existing)

    if all_positions:
        # Insert in batches of 100 to avoid payload limits
        for i in range(0, len(all_positions), 100):
            batch = all_positions[i : i + 100]

            def _insert(rows=batch):
                supabase.table("positions").insert(rows).execute()

            await db_execute(_insert)

    logger.info(
        "Reconstructed %d positions for strategy %s", len(all_positions), strategy_id
    )

    # Compute trade_metrics
    closed = [p for p in all_positions if p.get("status") == "closed"]
    winners = [p for p in closed if (p.get("roi") or 0) > 0]
    # Phase 12 Plan 05 (B-01 path b): segment closed by ROI sign so the
    # downstream `_compute_derived_trade_metrics(volume_metrics, trade_metrics)`
    # in `analytics_runner.py` can produce expectancy / R:R / weighted R:R / SQN /
    # profit_factor_long / profit_factor_short. Plan 12-06 wires both into the
    # orchestrator.
    losers = [p for p in closed if (p.get("roi") or 0) <= 0]

    total = len(all_positions)
    closed_count = len(closed)
    open_count = total - closed_count

    win_rate = len(winners) / closed_count if closed_count > 0 else 0.0
    rois = [p.get("roi", 0) or 0 for p in closed]
    avg_roi = sum(rois) / len(rois) if rois else 0.0

    durations = []
    for p in closed:
        dur = p.get("duration_days")
        if dur is not None:
            durations.append(dur)
    avg_duration_days = (sum(durations) / len(durations)) if durations else 0.0

    long_count = sum(1 for p in all_positions if p.get("side") == "long")
    short_count = sum(1 for p in all_positions if p.get("side") == "short")

    best_roi = max(rois) if rois else 0.0
    worst_roi = min(rois) if rois else 0.0

    # Phase 12 Plan 05 / B-01 path (b) extension — these 5 keys feed
    # `_compute_derived_trade_metrics` in `analytics_runner.py`. Strictly
    # additive: every legacy key above is preserved unchanged.
    avg_winning_trade = (
        sum((p.get("roi") or 0) for p in winners) / len(winners)
        if winners
        else 0.0
    )
    avg_losing_trade = (
        sum((p.get("roi") or 0) for p in losers) / len(losers)
        if losers
        else 0.0
    )
    realized_pnl_per_trade = [
        {
            "side": p.get("side"),
            "realized_pnl": float(p.get("realized_pnl") or 0.0),
        }
        for p in closed
    ]

    return {
        "total_positions": total,
        "open_positions": open_count,
        "closed_positions": closed_count,
        "win_rate": round(win_rate, 4),
        "avg_roi": round(avg_roi, 6),
        "avg_duration_days": round(avg_duration_days, 2),
        "long_count": long_count,
        "short_count": short_count,
        "best_trade_roi": round(best_roi, 6),
        "worst_trade_roi": round(worst_roi, 6),
        # Phase 12 Plan 05 / B-01 path (b): derived-metric inputs
        "avg_winning_trade": round(avg_winning_trade, 6),
        "avg_losing_trade": round(avg_losing_trade, 6),
        "winners_count": len(winners),
        "losers_count": len(losers),
        "realized_pnl_per_trade": realized_pnl_per_trade,
    }


async def _attribute_funding(
    strategy_id: str, positions: list[dict], supabase
) -> None:
    """Sum funding_fees into each position's funding_pnl column.

    For each position, sums amounts from funding_fees rows where:
      - strategy_id matches
      - symbol matches
      - timestamp is within [opened_at, closed_at] (open positions use
        closed_at=now for the upper bound)

    Mutates the positions list in place. Called after FIFO matching and
    before DB persist in reconstruct_positions.

    Failure mode: if funding_fees fetch errors (e.g. RLS misconfig, table
    missing on a stale staging DB), each position keeps funding_pnl=0
    rather than blocking the entire reconstruction. Logged as warning.
    """
    if not positions:
        return

    now = datetime.now(timezone.utc)

    # Compute the date window that bounds all positions so the query is a
    # tight range scan on the (strategy_id, timestamp DESC) index rather
    # than a full strategy-partition scan.
    min_opened_at = min(p["opened_at"] for p in positions if p.get("opened_at"))
    max_closed_at = max(
        (p.get("closed_at") or now.isoformat()) for p in positions
    )

    # Page size for funding_fees fetch. Small enough to stay well under
    # PostgREST's per-response limit; used in tests via patching.
    _PAGE_SIZE = 1000

    funding_rows: list[dict] = []
    page = 0
    try:
        while True:
            start = page * _PAGE_SIZE
            end = start + _PAGE_SIZE - 1

            def _fetch_funding(s=start, e=end):
                return (
                    supabase.table("funding_fees")
                    .select("symbol, amount, timestamp")
                    .eq("strategy_id", strategy_id)
                    .gte("timestamp", min_opened_at)
                    .lte("timestamp", max_closed_at)
                    .range(s, e)
                    .execute()
                )

            result = await db_execute(_fetch_funding)
            chunk = (result.data if result else None) or []
            funding_rows.extend(chunk)
            if len(chunk) < _PAGE_SIZE:
                break
            page += 1
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "funding_fees fetch failed for strategy %s: %s — "
            "positions will get funding_pnl=0",
            strategy_id, exc,
        )
        return

    if not funding_rows:
        return

    # Group funding rows by symbol for fast lookup during position scan.
    by_symbol: dict[str, list[tuple[datetime, Decimal]]] = defaultdict(list)
    for row in funding_rows:
        sym = row.get("symbol", "")
        ts_raw = row.get("timestamp")
        amt_raw = row.get("amount")
        if not sym or ts_raw is None or amt_raw is None:
            continue
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            amt = Decimal(str(amt_raw))
        except Exception:
            continue
        by_symbol[sym].append((ts, amt))

    # Sort each symbol's timeline once — supports linear scan per position.
    for sym in by_symbol:
        by_symbol[sym].sort(key=lambda x: x[0])

    now_utc = datetime.now(timezone.utc)

    for pos in positions:
        symbol = pos.get("symbol", "")
        opened_at_raw = pos.get("opened_at")
        closed_at_raw = pos.get("closed_at")
        if not opened_at_raw:
            continue

        try:
            opened_dt = datetime.fromisoformat(
                str(opened_at_raw).replace("Z", "+00:00")
            )
            if opened_dt.tzinfo is None:
                opened_dt = opened_dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue

        if closed_at_raw:
            try:
                closed_dt = datetime.fromisoformat(
                    str(closed_at_raw).replace("Z", "+00:00")
                )
                if closed_dt.tzinfo is None:
                    closed_dt = closed_dt.replace(tzinfo=timezone.utc)
            except Exception:
                closed_dt = now_utc
        else:
            closed_dt = now_utc

        total = Decimal(0)
        for ts, amt in by_symbol.get(symbol, []):
            if opened_dt <= ts <= closed_dt:
                total += amt

        # Round to 8 decimals (funding amounts are typically ≤ 6 places
        # but we keep headroom to avoid premature truncation).
        pos["funding_pnl"] = float(round(total, 8))


def _match_positions_fifo(
    symbol: str, fills: list[dict], strategy_id: str
) -> list[dict]:
    """FIFO position matching for a single symbol.

    Tracks net position: buy increases (long), sell decreases (long).
    For shorts: sell increases, buy decreases.
    Uses posSide from raw_data when available (OKX hedge mode).
    When net crosses zero -> position closed.
    """
    positions: list[dict] = []
    net_qty = 0.0
    entry_fills: list[dict] = []  # fills that opened the current position
    total_entry_cost = 0.0
    total_entry_qty = 0.0
    peak_qty = 0.0  # track peak position size for size_peak column
    total_fees = 0.0
    position_side = None  # "long" or "short"
    position_open_time = None

    for fill in fills:
        side = fill.get("side", "").lower()
        qty = float(fill.get("quantity", 0) or 0)
        price = float(fill.get("price", 0) or 0)
        fee = float(fill.get("fee", 0) or 0)

        # Determine direction from posSide if available (OKX hedge mode)
        raw_data = fill.get("raw_data") or {}
        pos_side = raw_data.get("posSide", "")

        if qty <= 0:
            continue

        total_fees += fee

        # Determine if this fill opens or closes position
        if abs(net_qty) < 1e-12:
            # Opening a new position
            if pos_side == "short" or (not pos_side and side == "sell"):
                position_side = "short"
                net_qty = -qty
            else:
                position_side = "long"
                net_qty = qty

            total_entry_cost = price * qty
            total_entry_qty = qty
            peak_qty = qty
            entry_fills = [fill]
            position_open_time = fill.get("timestamp")
            continue

        # Existing position
        if position_side == "long":
            if side == "buy":
                # Adding to long
                net_qty += qty
                total_entry_cost += price * qty
                total_entry_qty += qty
                peak_qty = max(peak_qty, abs(net_qty))
                entry_fills.append(fill)
            else:
                # Reducing/closing long
                net_qty -= qty
        elif position_side == "short":
            if side == "sell":
                # Adding to short
                net_qty -= qty
                total_entry_cost += price * qty
                total_entry_qty += qty
                peak_qty = max(peak_qty, abs(net_qty))
                entry_fills.append(fill)
            else:
                # Reducing/closing short
                net_qty += qty

        # Check if position crossed zero (closed)
        if (position_side == "long" and net_qty <= 0) or (
            position_side == "short" and net_qty >= 0
        ):
            entry_avg = total_entry_cost / total_entry_qty if total_entry_qty > 0 else 0
            exit_avg = price  # last fill is the closing fill

            if position_side == "long":
                realized_pnl = (exit_avg - entry_avg) * total_entry_qty - total_fees
            else:
                realized_pnl = (entry_avg - exit_avg) * total_entry_qty - total_fees
            # KPI-17 follow-up: ROI is net-of-fees return on capital deployed.
            # Prior formula computed gross price change `(exit-entry)/entry`,
            # which classified fee-only-losers as winners (price flat, fees
            # negative net). The new formula tracks realized_pnl / notional;
            # winners/losers stays aligned with positive/negative net P&L.
            notional = entry_avg * total_entry_qty
            roi = realized_pnl / notional if notional > 0 else 0

            # Sub-day-aware duration. The DB column is NUMERIC (migration
            # 092) so fractional days express positions held for hours
            # instead of int-truncating to 0.
            duration_days = None
            close_time = fill.get("timestamp")
            if position_open_time and close_time:
                try:
                    open_dt = datetime.fromisoformat(
                        position_open_time.replace("Z", "+00:00")
                    )
                    close_dt = datetime.fromisoformat(
                        close_time.replace("Z", "+00:00")
                    )
                    duration_days = round(
                        (close_dt - open_dt).total_seconds() / 86400, 4
                    )
                except (ValueError, TypeError):
                    pass

            positions.append({
                "strategy_id": strategy_id,
                "symbol": symbol,
                "side": position_side,
                "status": "closed",
                "entry_price_avg": round(entry_avg, 8),
                "exit_price_avg": round(exit_avg, 8),
                "size_base": round(total_entry_qty, 8),
                "size_peak": round(peak_qty, 8),
                "realized_pnl": round(realized_pnl, 4),
                "fee_total": round(total_fees, 4),
                "roi": round(roi, 6),
                "duration_days": duration_days,
                "opened_at": position_open_time,
                "closed_at": close_time,
                "fill_count": len(entry_fills) + 1,  # +1 for closing fill
                # Default 0; _attribute_funding sums in-window funding_fees rows before insert.
                "funding_pnl": 0,
            })

            # If overshot (net != 0), start a new position with remainder
            remainder = abs(net_qty)
            if remainder > 1e-12:
                # Flip direction
                if position_side == "long":
                    position_side = "short"
                    net_qty = -remainder
                else:
                    position_side = "long"
                    net_qty = remainder
                total_entry_cost = price * remainder
                total_entry_qty = remainder
                peak_qty = remainder
                entry_fills = [fill]
                total_fees = 0.0
                position_open_time = fill.get("timestamp")
            else:
                net_qty = 0.0
                total_entry_cost = 0.0
                total_entry_qty = 0.0
                peak_qty = 0.0
                entry_fills = []
                total_fees = 0.0
                position_side = None
                position_open_time = None

    # Record any open position
    if abs(net_qty) > 1e-12 and position_side and total_entry_qty > 0:
        entry_avg = total_entry_cost / total_entry_qty
        positions.append({
            "strategy_id": strategy_id,
            "symbol": symbol,
            "side": position_side,
            "status": "open",
            "entry_price_avg": round(entry_avg, 8),
            "exit_price_avg": None,
            "size_base": round(total_entry_qty, 8),
            "size_peak": round(peak_qty, 8),
            "realized_pnl": None,
            "fee_total": round(total_fees, 4),
            "roi": None,
            "duration_days": None,
            "opened_at": position_open_time,
            "closed_at": None,
            "fill_count": len(entry_fills),
            # Default 0; _attribute_funding sums funding_fees rows up to now
            # for open positions (closed_at=None → window-end = now).
            "funding_pnl": 0,
        })

    return positions


async def compute_exposure_metrics(strategy_id: str, supabase) -> dict:
    """Compute exposure metrics from position_snapshots.

    Returns dict with mean/std/max gross and net exposure (existing aggregates,
    preserved for backward compatibility) AND a per-date `exposure_series`
    field.

    METRICS-05 refactor: previously the per-date arrays at lines 461-476 were
    aggregated into mean/std/max and then discarded. Now they also persist
    as `exposure_series: [{date, gross, net}]` for sibling-table writes
    (D-01 sibling kind = `exposure_series`).
    """

    def _fetch_snapshots():
        return (
            supabase.table("position_snapshots")
            .select("snapshot_date, side, size_usd")
            .eq("strategy_id", strategy_id)
            .order("snapshot_date")
            .execute()
        )

    result = await db_execute(_fetch_snapshots)
    snapshots = result.data or []

    if not snapshots:
        return {}

    # Group by snapshot_date to compute per-date exposure
    by_date: dict[str, list[dict]] = defaultdict(list)
    for snap in snapshots:
        by_date[snap.get("snapshot_date", "")].append(snap)

    gross_exposures: list[float] = []
    net_exposures: list[float] = []
    # METRICS-05: per-date exposure points for sibling-table persistence.
    # Uses iteration over the same loop that previously discarded the data.
    exposure_series_records: list[dict[str, Any]] = []

    for date_key, date_snaps in by_date.items():
        gross = 0.0
        net = 0.0
        for snap in date_snaps:
            size_usd = float(snap.get("size_usd", 0) or 0)
            side = snap.get("side", "")
            gross += abs(size_usd)
            if side == "short":
                net -= abs(size_usd)
            else:
                net += abs(size_usd)
        gross_exposures.append(gross)
        net_exposures.append(net)
        exposure_series_records.append({
            "date": str(date_key),
            "gross": round(gross, 2),
            "net": round(net, 2),
        })

    if not gross_exposures:
        return {}

    mean_gross = statistics.mean(gross_exposures)
    std_gross = statistics.stdev(gross_exposures) if len(gross_exposures) > 1 else 0.0
    max_gross = max(gross_exposures)

    mean_net = statistics.mean(net_exposures)
    std_net = statistics.stdev(net_exposures) if len(net_exposures) > 1 else 0.0
    max_net = max(net_exposures, key=abs)

    return {
        "mean_gross_exposure": round(mean_gross, 2),
        "std_gross_exposure": round(std_gross, 2),
        "max_gross_exposure": round(max_gross, 2),
        "mean_net_exposure": round(mean_net, 2),
        "std_net_exposure": round(std_net, 2),
        "max_net_exposure": round(max_net, 2),
        "exposure_series": exposure_series_records,
    }


def compute_turnover_series(
    positions_by_date: dict[str, dict[str, float]],
    prices_by_date: dict[str, dict[str, float]],
    nav_by_date: dict[str, float],
) -> list[dict[str, Any]]:
    """Compute daily turnover series.

    Pitfall #19 mitigation: contract is documented inline.

    Definition: daily_turnover = sum_over_symbols(abs(delta * price)) / nav
                where delta = position_today - position_yesterday.

    Args:
        positions_by_date: { 'YYYY-MM-DD': { symbol: position_size }, ... }
        prices_by_date:    { 'YYYY-MM-DD': { symbol: close_price }, ... }
        nav_by_date:       { 'YYYY-MM-DD': nav_usd, ... }

    Returns:
        [{date: 'YYYY-MM-DD', turnover: float}, ...] sorted by date asc.
        Empty list when positions_by_date is empty.

    Threat model T-12-04-02: nav <= 0 short-circuits to turnover=0.0
    rather than raising ZeroDivisionError on a stray zero/negative NAV row.
    """
    if not positions_by_date:
        return []
    dates = sorted(positions_by_date.keys())
    series: list[dict[str, Any]] = []
    prev_positions: dict[str, float] = {}
    for date in dates:
        positions = positions_by_date.get(date, {})
        prices = prices_by_date.get(date, {})
        nav = nav_by_date.get(date, 0.0)
        if nav <= 0:
            series.append({"date": date, "turnover": 0.0})
            prev_positions = positions
            continue
        total_change_usd = 0.0
        symbols = set(positions.keys()) | set(prev_positions.keys())
        for sym in symbols:
            delta = positions.get(sym, 0.0) - prev_positions.get(sym, 0.0)
            price = prices.get(sym, 0.0)
            total_change_usd += abs(delta * price)
        series.append({"date": date, "turnover": round(total_change_usd / nav, 6)})
        prev_positions = positions
    return series
