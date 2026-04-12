"""FIFO position matching from raw fills.

Reconstructs position lifecycles by processing fills in timestamp order
per symbol, tracking net position, and recording closed positions with
entry/exit prices, PnL, fees, duration, and ROI.

Also computes exposure metrics from position_snapshots.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone

from services.db import db_execute

logger = logging.getLogger("quantalyze.analytics.position_reconstruction")


async def reconstruct_positions(strategy_id: str, supabase) -> dict:
    """Reconstruct position lifecycles from raw fills using FIFO matching.

    Returns trade_metrics dict for strategy_analytics JSONB.
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
    open_positions = [p for p in all_positions if p.get("status") == "open"]
    winners = [p for p in closed if (p.get("roi") or 0) > 0]

    total = len(all_positions)
    closed_count = len(closed)
    open_count = len(open_positions)

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
    }


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
        if net_qty == 0.0:
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
                roi = (exit_avg - entry_avg) / entry_avg if entry_avg > 0 else 0
            else:
                realized_pnl = (entry_avg - exit_avg) * total_entry_qty - total_fees
                roi = (entry_avg - exit_avg) / entry_avg if entry_avg > 0 else 0

            # Compute duration in days (INTEGER column)
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
                    duration_days = int((close_dt - open_dt).total_seconds() / 86400)
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
        })

    return positions


async def compute_exposure_metrics(strategy_id: str, supabase) -> dict:
    """Compute exposure metrics from position_snapshots.

    Returns dict with mean/std/max gross and net exposure.
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

    if not gross_exposures:
        return {}

    import statistics

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
    }
