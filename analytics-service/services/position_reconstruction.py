"""FIFO position matching from raw fills.

Reconstructs position lifecycles by processing fills in timestamp order
per symbol, tracking net position, and recording closed positions with
entry/exit prices, PnL, fees, duration, and ROI.

Also computes exposure metrics from position_snapshots. After FIFO
matching, funding_pnl is attributed to each position by summing
funding_fees rows in [opened_at, closed_at] window.
"""
from __future__ import annotations

import asyncio
import logging
import statistics
import time
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from services.db import db_execute

logger = logging.getLogger("quantalyze.analytics.position_reconstruction")

# A single contended reconstruct that genuinely needs operator attention
# typically blocks for seconds (DB roundtrip + atomic-rebuild RPC). A
# 1-second hold threshold filters out routine sub-RTT contention noise
# while still surfacing the 30s stalls the lock was added to make
# debuggable. See `reconstruct_positions` log site below.
_LOCK_HOLD_LOG_THRESHOLD_S = 1.0


# Audit-2026-05-07 H-0736: cardinality caps on the unbounded JSONB
# payloads (`realized_pnl_per_trade`, `exposure_series`) persisted to
# strategy_analytics. Without a cap, a fill-flood or snapshot-flood on
# any single strategy bloats the JSONB blob → PostgREST response sizes
# slow every reader, TOAST pressure on strategy_analytics, and the
# frontend metrics-parity helper allocates O(N) per render.
#
# Caps are deliberately generous: a real strategy with daily fills for
# 10 years × 50 symbols stays well under 10 000. Truncation surfaces a
# flag (`realized_pnl_per_trade_truncated` / `exposure_series_truncated`)
# so the dashboard can warn the allocator their analytics are partial.
#
# Downstream consumer (`analytics_runner._compute_derived_trade_metrics`)
# computes SQN over the per-trade list and segments profit-factor by
# side, so we keep the FIRST N records (chronologically — closed by
# closing-fill timestamp via iteration order from FIFO matching). Tail
# truncation preserves the open-of-history characterization sample;
# the dashboard flag makes the partial-window state explicit.
_REALIZED_PNL_PER_TRADE_CAP = 10_000
_EXPOSURE_SERIES_CAP = 10_000


# Audit-2026-05-07 P1101 (caller follow-up): per-worker per-strategy
# asyncio.Lock registry — defense-in-depth above the SQL-side
# pg_advisory_xact_lock (migration 113) + (strategy_id, symbol, side,
# opened_at) UNIQUE constraint (migration 119).
#
# Lock ordering invariant: the outer asyncio.Lock is always acquired
# BEFORE the SQL advisory lock. Monotonic outer→inner across every path
# in this module — no deadlock surface between the two layers.
#
# The dict grows unboundedly by design: evicting a Lock with waiters
# parked on it would silently break serialization, and strategy_id
# cardinality is bounded by the strategies table (O(10²–10³)).
_RECONSTRUCT_LOCKS: dict[str, asyncio.Lock] = {}


def _lock_for(strategy_id: str) -> asyncio.Lock:
    # setdefault is atomic across coroutine resumption — there is no
    # await between the lookup and the insert, so within one event loop
    # two simultaneous first-callers cannot end up with two different
    # Lock objects for the same strategy_id. This is single-event-loop
    # safe; cross-thread invocation is not supported.
    return _RECONSTRUCT_LOCKS.setdefault(strategy_id, asyncio.Lock())


async def reconstruct_positions(strategy_id: str | UUID, supabase) -> dict:
    """Public entry point — serializes per-strategy via in-memory
    asyncio.Lock so concurrent same-worker callers do not both fire the
    atomic-rebuild RPC. Cluster-wide serialization remains the SQL-side
    pg_advisory_xact_lock + migration 119 UNIQUE constraint's
    responsibility (audit-2026-05-07 P1101 caller follow-up)."""
    # Canonicalize so UUID / str / padded-str representations of the
    # same strategy all hash to the same in-memory Lock bucket. (This
    # only needs to be internally consistent across Python callers; the
    # SQL advisory lock is an independent cross-process defense layer
    # and does not need to share a key derivation with this lock.)
    strategy_id = str(strategy_id).strip()
    lock = _lock_for(strategy_id)
    # Log on the slow path only — pre-acquire `locked()` checks are racy
    # (the holder may release between check and acquire), and INFO-level
    # contention logging at burst rates would flood log shipping.
    t0 = time.monotonic()
    async with lock:
        wait_s = time.monotonic() - t0
        if wait_s > _LOCK_HOLD_LOG_THRESHOLD_S:
            logger.warning(
                "reconstruct_positions: blocked on per-strategy lock for %.2fs",
                wait_s,
                extra={"strategy_id": strategy_id, "wait_seconds": wait_s},
            )
        return await _reconstruct_positions_inner(strategy_id, supabase)


async def _reconstruct_positions_inner(strategy_id: str, supabase) -> dict:
    """Reconstruct position lifecycles from raw fills using FIFO matching.

    Returns trade_metrics dict for strategy_analytics JSONB. Each closed
    and open position has its funding_pnl column populated by summing
    funding_fees rows in its [opened_at, closed_at] window for the same
    symbol. See migration 044.

    Audit-2026-05-07 G12.C.1/C.2: persistence now goes through the
    `reconstruct_positions_atomic(uuid, jsonb)` RPC (migration 113) which
    performs DELETE-then-INSERT in a single transaction guarded by a
    per-strategy advisory xact lock. The previous PostgREST-level DELETE
    + batched INSERT pair could partial-fail mid-flight, leaving the
    dashboard with empty positions and contradictory trade_metrics.
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

    # Audit-2026-05-07 G12.C.6: bucket by (symbol, exchange) tuple instead
    # of symbol alone. Symbol-less fills are DROPPED (not bucketed under
    # 'UNKNOWN') so heterogeneous instruments can no longer FIFO-match
    # under a fictitious shared lifecycle (a buy of BTC and a sell of ETH
    # would otherwise "close" a position).
    fills_by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    fills_dropped_no_symbol = 0
    for fill in fills:
        sym = fill.get("symbol")
        if not sym:
            logger.error(
                "Fill missing symbol; skipping. raw=%s",
                fill.get("raw_data"),
            )
            fills_dropped_no_symbol += 1
            continue
        exch = (fill.get("exchange") or "unknown")
        fills_by_key[(sym, exch)].append(fill)

    all_positions: list[dict] = []
    aggregated_data_quality_flags: dict[str, Any] = {}

    for (symbol, _exchange), symbol_fills in fills_by_key.items():
        # Sort by timestamp within bucket (per-symbol-per-exchange).
        symbol_fills.sort(key=lambda f: f.get("timestamp", ""))
        positions = _match_positions_fifo(symbol, symbol_fills, strategy_id)
        # Audit G12.C.4: collect transient data_quality_flags from
        # in-memory position dicts BEFORE we strip them for DB persistence.
        for pos in positions:
            flags = pos.get("data_quality_flags")
            if isinstance(flags, dict):
                for k, v in flags.items():
                    # OR-merge booleans / counters: any True wins, ints sum.
                    if isinstance(v, bool):
                        aggregated_data_quality_flags[k] = (
                            aggregated_data_quality_flags.get(k, False) or v
                        )
                    elif isinstance(v, (int, float)):
                        aggregated_data_quality_flags[k] = (
                            aggregated_data_quality_flags.get(k, 0) + v
                        )
                    else:
                        aggregated_data_quality_flags[k] = v
        all_positions.extend(positions)

    if fills_dropped_no_symbol:
        aggregated_data_quality_flags["fills_dropped_no_symbol"] = (
            fills_dropped_no_symbol
        )

    await _attribute_funding(strategy_id, all_positions, supabase)

    # Audit-2026-05-07 G12.C.1/C.2: atomic DELETE+INSERT via RPC. The RPC
    # signature mirrors the column list of the previous direct INSERT so
    # the on-disk shape is unchanged. Strip in-memory-only keys (e.g.
    # `data_quality_flags` which the positions table does not have).
    payload = [_strip_non_db_keys(p) for p in all_positions]

    def _atomic_rebuild():
        supabase.rpc(
            "reconstruct_positions_atomic",
            {"p_strategy_id": strategy_id, "p_positions": payload},
        ).execute()

    await db_execute(_atomic_rebuild)

    logger.info(
        "Reconstructed %d positions for strategy %s", len(all_positions), strategy_id
    )

    # Compute trade_metrics
    closed = [p for p in all_positions if p.get("status") == "closed"]

    # Audit-2026-05-07 round-2 / P1994: avg_winning_trade and
    # avg_losing_trade must be DOLLAR sums (realized_pnl), not ratio
    # averages (roi). The downstream `_compute_derived_trade_metrics` in
    # analytics_runner.py expects dollars to derive R:R, expectancy,
    # weighted R:R, SQN, profit_factor — feeding ratios produced
    # nonsense values silently.
    #
    # Bucketing also moves from `roi` sign to `realized_pnl` sign so:
    #   - breakevens (realized_pnl == 0) are excluded from both buckets
    #     and surfaced via data_quality_flags['breakeven_positions']
    #     rather than depressing avg_losing_trade as the prior
    #     `(roi or 0) <= 0` lumped them
    #   - closed positions with realized_pnl=None are NOT silently
    #     coerced via `or 0` into the losers bucket; they surface via
    #     data_quality_flags['positions_missing_realized_pnl'] so the
    #     dashboard can flag the data integrity hole
    #
    # ROI-based KPIs (avg_roi, best_trade_roi, worst_trade_roi,
    # total_positions, open_positions, closed_positions, long_count,
    # short_count) remain ROI-based by contract — only the dollar
    # bucketing changes.
    winners: list[dict] = []
    losers: list[dict] = []
    breakevens = 0
    missing_pnl = 0
    for p in closed:
        pnl = p.get("realized_pnl")
        if pnl is None:
            missing_pnl += 1
            continue
        if pnl > 0:
            winners.append(p)
        elif pnl < 0:
            losers.append(p)
        else:
            breakevens += 1

    total = len(all_positions)
    closed_count = len(closed)
    open_count = total - closed_count

    # Win rate denominator: positions with a decided outcome (winner or
    # loser). Breakevens and missing-PnL rows are excluded so they don't
    # depress the rate. Pre-fix the denominator was `closed_count`, which
    # let breakevens-as-losers depress the rate via the bucket leak.
    decided = len(winners) + len(losers)
    win_rate = len(winners) / decided if decided > 0 else 0.0

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

    # P1994 fix: sum realized_pnl DOLLARS, not ROI ratios. realized_pnl
    # is guaranteed non-None within the winners/losers buckets by the
    # loop above.
    avg_winning_trade = (
        sum(p["realized_pnl"] for p in winners) / len(winners)
        if winners
        else 0.0
    )
    avg_losing_trade = (
        sum(p["realized_pnl"] for p in losers) / len(losers)
        if losers
        else 0.0
    )
    # P1994 fix: emit None (not phantom 0.0) for closed positions
    # missing realized_pnl. Downstream consumers can now distinguish
    # "this position broke even" from "we don't know what happened".
    #
    # Audit H-0736: cap cardinality so a fill-flood can't bloat the
    # strategy_analytics JSONB. Cap is generous (see
    # _REALIZED_PNL_PER_TRADE_CAP). When truncated, surface a flag so
    # the dashboard can warn the allocator their derived KPIs (SQN /
    # profit factor / R:R) are computed over a partial window.
    realized_pnl_per_trade_truncated = (
        len(closed) > _REALIZED_PNL_PER_TRADE_CAP
    )
    closed_for_per_trade = (
        closed[:_REALIZED_PNL_PER_TRADE_CAP]
        if realized_pnl_per_trade_truncated
        else closed
    )
    realized_pnl_per_trade = [
        {
            "side": p.get("side"),
            "realized_pnl": (
                float(p["realized_pnl"]) if p.get("realized_pnl") is not None else None
            ),
        }
        for p in closed_for_per_trade
    ]
    if realized_pnl_per_trade_truncated:
        aggregated_data_quality_flags["realized_pnl_per_trade_truncated"] = True
        aggregated_data_quality_flags["realized_pnl_per_trade_truncated_kept"] = (
            _REALIZED_PNL_PER_TRADE_CAP
        )
        aggregated_data_quality_flags["realized_pnl_per_trade_truncated_total"] = (
            len(closed)
        )

    # P1994 fix: merge breakeven + missing-PnL counters into the
    # aggregated quality flags so the analytics_runner can surface them
    # alongside the existing G12.C.* flags.
    if breakevens:
        aggregated_data_quality_flags["breakeven_positions"] = (
            aggregated_data_quality_flags.get("breakeven_positions", 0) + breakevens
        )
    if missing_pnl:
        aggregated_data_quality_flags["positions_missing_realized_pnl"] = (
            aggregated_data_quality_flags.get("positions_missing_realized_pnl", 0)
            + missing_pnl
        )

    out: dict[str, Any] = {
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
    # Audit-2026-05-07 G12.C.4 / C.6: surface aggregated data quality
    # flags so analytics_runner can merge them into
    # strategy_analytics.data_quality_flags. Only present when non-empty.
    if aggregated_data_quality_flags:
        out["data_quality_flags"] = aggregated_data_quality_flags
    return out


# Audit-2026-05-07 G12.C.1/C.2: keys we attach in-memory to position dicts
# but which are NOT columns on the positions table. They must be stripped
# before sending the payload to reconstruct_positions_atomic, otherwise
# the JSONB-to-column projection in migration 113 will silently ignore
# them (or, depending on Postgres version, raise on unknown casts).
_NON_DB_KEYS = frozenset({"data_quality_flags"})


def _strip_non_db_keys(pos: dict) -> dict:
    """Return a copy of the position dict with transient (non-column) keys
    removed. Caller-side defense for the atomic-rebuild RPC payload."""
    return {k: v for k, v in pos.items() if k not in _NON_DB_KEYS}


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


# Audit-2026-05-07 PATTERN-2 / P1100: net-qty snap-to-zero scale factor.
# After every reducing fill in `_match_positions_fifo` we collapse any
# `|net_qty|` below `max(total_entry_qty * FLIP_EPS_FACTOR, 1e-9)` to an
# exact zero. 1e-9 = "one part per billion" of the original position
# size; below this we treat the residue as IEEE-754 dust rather than a
# real open exposure. Without the snap, sub-ULP residuals accumulated
# across many micro-fills cause the close-and-flip branch to fire
# spuriously, producing zero-duration phantom positions whose entry and
# exit prices both equal a fill price (impossible under normal FIFO
# semantics). Full root-cause analysis:
# `.planning/audit-2026-05-07/INVEST-PATTERN-2-POSITIONS.md`.
FLIP_EPS_FACTOR = 1e-9


# Phase 19 / MC-2 decision: leave private (underscore prefix preserved).
# EquityCurveBuilder (services/equity_reconstruction.py) imports this
# directly to avoid touching the DB-side tested primitive. Future API
# cleanup may rename without underscore once the equity-curve seam is stable.
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
    # Audit-2026-05-07 G12.C.5: track exit VWAP across multi-fill closes.
    # Previously `exit_avg = price` of the last closing fill only.
    total_exit_cost = 0.0
    total_exit_qty = 0.0
    total_fees = 0.0
    position_side = None  # "long" or "short"
    position_open_time = None
    # Audit-2026-05-07 G12.C.4: per-position transient quality flags
    # (e.g. posSide_side_mismatch). Stored on the in-memory dict and
    # stripped before the atomic-rebuild RPC payload is sent.
    position_quality_flags: dict[str, Any] = {}

    for fill in fills:
        side = fill.get("side", "").lower()
        qty = float(fill.get("quantity", 0) or 0)
        price = float(fill.get("price", 0) or 0)
        fee = float(fill.get("fee", 0) or 0)

        # Audit-2026-05-07 G12.C.4: whitelist `posSide` from the
        # exchange-supplied raw_data. Anything outside the known set is
        # treated as missing — an attacker-controlled OKX response can no
        # longer flip the reconstructed direction by injecting a
        # garbage posSide.
        raw_data = fill.get("raw_data") or {}
        pos_side = raw_data.get("posSide", "") or ""
        if pos_side not in ("long", "short", "net", ""):
            logger.warning(
                "invalid posSide=%s for fill, ignoring (strategy=%s symbol=%s)",
                pos_side, strategy_id, symbol,
            )
            pos_side = ""

        if qty <= 0:
            continue

        total_fees += fee

        # Determine if this fill opens or closes position
        if abs(net_qty) < 1e-12:
            # Opening a new position. Direction is derived from `side`
            # (buy → long, sell → short). posSide is treated as a HINT
            # only: if it disagrees with side, we PREFER side and flag
            # the mismatch in data_quality_flags. The previous code
            # blindly trusted posSide, allowing posSide='short' on a
            # side='buy' fill to publish a fabricated short-side
            # position to allocators (G12.C.4).
            side_derived = "short" if side == "sell" else "long"
            if pos_side in ("long", "short") and pos_side != side_derived:
                position_quality_flags["posSide_side_mismatch"] = True
                logger.warning(
                    "posSide=%s conflicts with side=%s for first fill "
                    "(strategy=%s symbol=%s); preferring side-derived direction=%s",
                    pos_side, side, strategy_id, symbol, side_derived,
                )
            position_side = side_derived
            net_qty = qty if side_derived == "long" else -qty

            total_entry_cost = price * qty
            total_entry_qty = qty
            peak_qty = qty
            total_exit_cost = 0.0
            total_exit_qty = 0.0
            entry_fills = [fill]
            position_open_time = fill.get("timestamp")
            continue

        # Existing position. Determine whether this fill is closing (or
        # partial-closing/overshooting) the current side and how much of
        # the fill quantity is allocated to the close vs. the next leg.
        closing_qty = 0.0
        if position_side == "long":
            if side == "buy":
                # Adding to long
                net_qty += qty
                total_entry_cost += price * qty
                total_entry_qty += qty
                peak_qty = max(peak_qty, abs(net_qty))
                entry_fills.append(fill)
            else:
                # Reducing/closing long: portion of qty that closes the
                # current long is min(qty, current net long size).
                closing_qty = min(qty, net_qty) if net_qty > 0 else 0.0
                net_qty -= qty
                # Audit-2026-05-07 PATTERN-2 / P1100: snap sub-ULP residuals
                # to zero. Without this, a residue of +/-1e-15..1e-9 in
                # net_qty (from cumulative IEEE-754 error across many
                # micro-fills) causes the close branch below to fire
                # incorrectly — opening a phantom flip leg with size ~ ULP
                # and entry_price drawn from the very fill that was
                # supposed to close cleanly. The phantom then re-flips on
                # the next fill, producing zero-duration positions whose
                # opened_at == closed_at. See
                # .planning/audit-2026-05-07/INVEST-PATTERN-2-POSITIONS.md.
                flip_eps = max(total_entry_qty * FLIP_EPS_FACTOR, 1e-9)
                if abs(net_qty) < flip_eps:
                    net_qty = 0.0
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
                closing_qty = min(qty, -net_qty) if net_qty < 0 else 0.0
                net_qty += qty
                # Audit-2026-05-07 PATTERN-2 / P1100: see snap-to-zero note
                # above (the long-reducing branch). Same rationale applied
                # symmetrically when buys close a short.
                flip_eps = max(total_entry_qty * FLIP_EPS_FACTOR, 1e-9)
                if abs(net_qty) < flip_eps:
                    net_qty = 0.0

        # Audit-2026-05-07 G12.C.5: accumulate VWAP exit across all
        # closing fills (partial reductions PLUS the final closing fill).
        # Previously `exit_avg = price` only used the last closing fill,
        # silently dropping prior reducing-fills' price/qty.
        if closing_qty > 0:
            total_exit_cost += price * closing_qty
            total_exit_qty += closing_qty

        # Check if position crossed zero (closed)
        if (position_side == "long" and net_qty <= 0) or (
            position_side == "short" and net_qty >= 0
        ):
            close_time = fill.get("timestamp")

            # Audit-2026-05-07 G12.C.3: prorate THIS fill's fee between
            # the closed leg and the (potentially) new opening leg.
            # `total_fees` was already incremented by `fee` at the top of
            # the loop, so the fee is currently 100% attributed to the
            # closed position. If this fill flipped direction, allocate
            # `opening_share` to the new leg's seed.
            #
            # closing_share / opening_share split based on size_used:
            #   closing_qty = size that closed the prior side
            #   opening_qty = size that opens the new (flipped) side
            #   ratio = closing_qty / qty
            remainder = abs(net_qty)
            opening_qty = remainder if remainder > 1e-12 else 0.0
            opening_share = 0.0
            if opening_qty > 0 and qty > 0 and fee > 0:
                opening_share = (opening_qty / qty) * fee
                # Subtract from the closed leg's fee total.
                total_fees -= opening_share

            entry_avg = total_entry_cost / total_entry_qty if total_entry_qty > 0 else 0
            # Audit G12.C.5: VWAP across the position's closing fills.
            # Fall back to the last fill's price only if (defensively)
            # no closing volume was tracked — should not happen in
            # practice but avoids ZeroDivisionError on degenerate input.
            exit_avg = (
                total_exit_cost / total_exit_qty if total_exit_qty > 0 else price
            )

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
            #
            # Audit-2026-05-07 G12.C.9: also write `duration_seconds`
            # alongside `duration_days` so downstream consumers can
            # report sub-day holds without precision loss. Migration 114
            # adds the column; the JSONB→column projection in migration
            # 113's RPC ignores unknown keys, so writing this key today
            # is safe even before 114 lands.
            duration_days = None
            duration_seconds: int | None = None
            if position_open_time and close_time:
                try:
                    open_dt = datetime.fromisoformat(
                        position_open_time.replace("Z", "+00:00")
                    )
                    close_dt = datetime.fromisoformat(
                        close_time.replace("Z", "+00:00")
                    )
                    seconds = (close_dt - open_dt).total_seconds()
                    # Adversarial-review hardening (PR #140 follow-up):
                    # clock skew or out-of-order fills can make close_dt
                    # < open_dt — pre-fix int(negative_seconds) would
                    # persist a negative duration that downstream
                    # dashboards inherit as garbage. Clamp to 0 and flag
                    # the position so admin can triage.
                    if seconds < 0:
                        logger.warning(
                            "Negative position duration detected — clamping to 0. "
                            "open=%s close=%s seconds=%.2f. Likely cause: clock skew "
                            "or out-of-order fills.",
                            position_open_time, close_time, seconds,
                        )
                        seconds = 0.0
                    duration_days = round(seconds / 86400, 4)
                    duration_seconds = int(seconds)
                except (ValueError, TypeError) as exc:
                    # Audit H-0745: a silently-dropped duration is
                    # indistinguishable downstream from a still-open
                    # position. Log + flag so allocators can tell the
                    # two apart in the dashboard.
                    logger.warning(
                        "Duration parse failed for strategy=%s symbol=%s "
                        "open=%r close=%r: %s",
                        strategy_id, symbol,
                        position_open_time, close_time, exc,
                    )
                    position_quality_flags["duration_parse_errors"] = (
                        position_quality_flags.get("duration_parse_errors", 0) + 1
                    )

            position_dict: dict[str, Any] = {
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
                "duration_seconds": duration_seconds,
                "opened_at": position_open_time,
                "closed_at": close_time,
                "fill_count": len(entry_fills) + 1,  # +1 for closing fill
                # Default 0; _attribute_funding sums in-window funding_fees rows before insert.
                "funding_pnl": 0,
            }
            if position_quality_flags:
                position_dict["data_quality_flags"] = dict(position_quality_flags)
            positions.append(position_dict)

            # If overshot (net != 0), start a new position with remainder
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
                # Audit G12.C.3: seed the new leg with the prorated
                # opening share of the flip-fill's fee. The closed-leg
                # fee_total already had this subtracted above.
                total_fees = opening_share
                total_exit_cost = 0.0
                total_exit_qty = 0.0
                position_open_time = fill.get("timestamp")
                # Reset per-position quality flags for the new leg.
                position_quality_flags = {}
            else:
                net_qty = 0.0
                total_entry_cost = 0.0
                total_entry_qty = 0.0
                peak_qty = 0.0
                total_exit_cost = 0.0
                total_exit_qty = 0.0
                entry_fills = []
                total_fees = 0.0
                position_side = None
                position_open_time = None
                position_quality_flags = {}

    # Record any open position
    if abs(net_qty) > 1e-12 and position_side and total_entry_qty > 0:
        entry_avg = total_entry_cost / total_entry_qty
        open_dict: dict[str, Any] = {
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
            # Audit G12.C.9: also write duration_seconds (NULL while open).
            "duration_seconds": None,
            "opened_at": position_open_time,
            "closed_at": None,
            "fill_count": len(entry_fills),
            # Default 0; _attribute_funding sums funding_fees rows up to now
            # for open positions (closed_at=None → window-end = now).
            "funding_pnl": 0,
        }
        if position_quality_flags:
            open_dict["data_quality_flags"] = dict(position_quality_flags)
        positions.append(open_dict)

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

    Audit-2026-05-07 G12.C.7: position_snapshots is account-scoped (the
    poll_positions worker writes ALL exchange positions for an
    api_key_id under the strategy that triggered the poll). When two
    strategies share an api_key_id, computing exposure_metrics from
    snapshots would mix the two strategies' exposures together and
    publish a misleading gross/net to allocators. We refuse to compute
    in that case and surface a `exposure_metrics_skipped_shared_api_key`
    flag for analytics_runner to merge into data_quality_flags.
    """

    # Detect shared api_key_id BEFORE we touch snapshots — short-circuits
    # the contamination case quickly. Failure to read strategies (e.g.
    # transient DB error) is treated as "unknown" and we proceed: better
    # to publish exposure than to silently zero it out for everyone.
    #
    # Audit H-0738: when the api_key lookup fails the contamination
    # guard cannot run. We still publish (fail-open policy preserved
    # for back-compat with allocator dashboards) BUT we attach a
    # `exposure_metrics_apikey_lookup_failed` marker so downstream
    # consumers can tell "exposure published normally" apart from
    # "exposure published WITHOUT the cross-strategy contamination
    # check" — a materially different trust state for security
    # reviewers. Without this flag the three failure modes (no shared
    # key → safe / shared key → skipped / lookup failed → unknown)
    # collapsed into a single output shape.
    api_key_lookup_failed = False
    try:
        def _fetch_self():
            return (
                supabase.table("strategies")
                .select("api_key_id")
                .eq("id", strategy_id)
                .limit(1)
                .execute()
            )

        self_result = await db_execute(_fetch_self)
        self_rows = (self_result.data if self_result else []) or []
        api_key_id = self_rows[0].get("api_key_id") if self_rows else None
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "compute_exposure_metrics: api_key_id lookup failed for %s: %s",
            strategy_id, exc,
        )
        api_key_id = None
        api_key_lookup_failed = True

    if api_key_id:
        try:
            def _fetch_siblings():
                return (
                    supabase.table("strategies")
                    .select("id")
                    .eq("api_key_id", api_key_id)
                    .execute()
                )

            sib_result = await db_execute(_fetch_siblings)
            sib_rows = (sib_result.data if sib_result else []) or []
            if len(sib_rows) > 1:
                logger.warning(
                    "compute_exposure_metrics: api_key_id %s is shared by %d "
                    "strategies; refusing to compute exposure_metrics for %s "
                    "to avoid cross-strategy contamination",
                    api_key_id, len(sib_rows), strategy_id,
                )
                return {
                    "data_quality_flags": {
                        "exposure_metrics_skipped_shared_api_key": True,
                    }
                }
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "compute_exposure_metrics: shared-key check failed for %s: %s",
                strategy_id, exc,
            )

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
        # Audit H-0747: previously returned bare {} — VolumeExposureTab
        # rendered $0 across mean/std/max as if those were real
        # measurements. Surface an explicit "no snapshots" marker via
        # data_quality_flags so analytics_runner can merge it into the
        # strategy-level flags and the dashboard can show
        # "Position snapshots not yet collected — exposure unavailable"
        # rather than spurious zeros.
        flags: dict[str, Any] = {"exposure_metrics_no_snapshots": True}
        if api_key_lookup_failed:
            flags["exposure_metrics_apikey_lookup_failed"] = True
        return {"data_quality_flags": flags}

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
        # Aggregates (mean/std/max) still see the full set — capping
        # only the per-date series persisted to JSONB. Caller can
        # always recompute the full series from position_snapshots.
        gross_exposures.append(gross)
        net_exposures.append(net)
        # Audit H-0736: cap exposure_series cardinality so a
        # snapshot-flood can't bloat strategy_analytics JSONB.
        if len(exposure_series_records) < _EXPOSURE_SERIES_CAP:
            exposure_series_records.append({
                "date": str(date_key),
                "gross": round(gross, 2),
                "net": round(net, 2),
            })

    exposure_series_truncated = len(by_date) > _EXPOSURE_SERIES_CAP

    if not gross_exposures:
        # Defensive: with `by_date` non-empty above this branch is
        # currently unreachable (every key triggers an append). Kept
        # as a safety net in case future refactors filter rows mid-loop.
        # Audit H-0747: never return bare {} — surface a marker.
        flags = {"exposure_metrics_no_gross_exposure": True}
        if api_key_lookup_failed:
            flags["exposure_metrics_apikey_lookup_failed"] = True
        return {"data_quality_flags": flags}

    mean_gross = statistics.mean(gross_exposures)
    std_gross = statistics.stdev(gross_exposures) if len(gross_exposures) > 1 else 0.0
    max_gross = max(gross_exposures)

    mean_net = statistics.mean(net_exposures)
    std_net = statistics.stdev(net_exposures) if len(net_exposures) > 1 else 0.0
    max_net = max(net_exposures, key=abs)

    out: dict[str, Any] = {
        "mean_gross_exposure": round(mean_gross, 2),
        "std_gross_exposure": round(std_gross, 2),
        "max_gross_exposure": round(max_gross, 2),
        "mean_net_exposure": round(mean_net, 2),
        "std_net_exposure": round(std_net, 2),
        "max_net_exposure": round(max_net, 2),
        "exposure_series": exposure_series_records,
    }
    dq_flags: dict[str, Any] = {}
    # Audit H-0738: contamination-guard could not run because the
    # api_key_id lookup failed. We still publish (fail-open policy
    # for back-compat) but the marker tells consumers/auditors the
    # output is NOT guaranteed shared-key-safe. Three failure modes
    # are now discriminable in the JSONB blob.
    if api_key_lookup_failed:
        dq_flags["exposure_metrics_apikey_lookup_failed"] = True
    # Audit H-0736: exposure_series truncated at cardinality cap.
    if exposure_series_truncated:
        dq_flags["exposure_series_truncated"] = True
        dq_flags["exposure_series_truncated_kept"] = _EXPOSURE_SERIES_CAP
        dq_flags["exposure_series_truncated_total"] = len(by_date)
    if dq_flags:
        out["data_quality_flags"] = dq_flags
    return out


def compute_turnover_series_with_flags(
    positions_by_date: dict[str, dict[str, float]],
    prices_by_date: dict[str, dict[str, float]],
    nav_by_date: dict[str, float],
) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    """Compute daily turnover series + sparse-day quality flags.

    Pitfall #19 mitigation: contract is documented inline.

    Definition: daily_turnover = sum_over_symbols(abs(delta * price)) / nav
                where delta = position_today - position_yesterday.

    Audit-2026-05-07 round-2 / P1995 fixes:
      1) First observed date emits turnover=0 (no phantom spike). The
         pre-fix code computed delta = positions - prev_positions={}
         on iteration 1, which treated the entire opening position as
         a same-day rotation — inflating day-zero turnover to the full
         position weight every time.
      2) Sparse calendar gaps (any prev→current date delta > 1 day) are
         surfaced via `flags['turnover_gap_dates']`. The math still runs
         (delta / single-day NAV) so downstream consumers can decide
         whether to drop, smooth, or normalize the row — but the flag
         makes the data quality issue explicit instead of silent.

    Args:
        positions_by_date: { 'YYYY-MM-DD': { symbol: position_size }, ... }
        prices_by_date:    { 'YYYY-MM-DD': { symbol: close_price }, ... }
        nav_by_date:       { 'YYYY-MM-DD': nav_usd, ... }

    Returns:
        Tuple of (series, flags) where:
          - series: [{date: 'YYYY-MM-DD', turnover: float | None}, ...]
                    sorted by date asc. `turnover` is None when the NAV
                    row for that date is absent from `nav_by_date` —
                    distinguishing 'data not yet ingested' from a real
                    zero-turnover day. Empty list when positions_by_date
                    is empty.
          - flags:  dict with optional keys:
                      'turnover_gap_dates': dates whose row spans more
                        than one calendar day.
                      'turnover_nav_missing_dates': dates absent from
                        nav_by_date (turnover emitted as None).
                      'turnover_nav_invalid_dates': dates whose NAV row
                        is present but <= 0 (turnover emitted as 0.0).

    Audit-2026-05-07 H-0744: previously a missing NAV row defaulted to
    0.0 and short-circuited to turnover=0.0, collapsing three distinct
    conditions (real margin-call NAV<=0, data-not-yet-ingested, genuine
    no-rebalances day) into a single zero. The fix differentiates:
      - date not in nav_by_date → turnover=None + nav_missing_dates flag
      - date in nav_by_date but nav<=0 → turnover=0.0 + nav_invalid_dates
        flag (preserves T-12-04-02 short-circuit semantics for back-compat)
      - normal day → unchanged
    Additionally, both NAV-missing and NAV-invalid days preserve the
    PRIOR `prev_positions` so the next valid date computes a true delta
    across the gap rather than seeing a phantom no-op.
    """
    flags: dict[str, list[str]] = {}
    if not positions_by_date:
        return [], flags
    dates = sorted(positions_by_date.keys())
    series: list[dict[str, Any]] = []
    prev_positions: dict[str, float] | None = None
    prev_date: datetime | None = None
    gap_dates: list[str] = []
    nav_missing_dates: list[str] = []
    nav_invalid_dates: list[str] = []
    for date in dates:
        positions = positions_by_date.get(date, {})
        prices = prices_by_date.get(date, {})
        # Audit H-0744: explicit presence check — distinguishes 'NAV
        # not yet ingested' (key absent) from 'NAV present but bad'
        # (key present, value <= 0). The pre-fix `.get(date, 0.0)`
        # collapsed both into a turnover=0 short-circuit.
        nav_present = date in nav_by_date
        nav = nav_by_date.get(date, 0.0) if nav_present else 0.0

        # P1995 fix #1: first observed date has no meaningful
        # prev_positions snapshot — emit turnover=0 instead of
        # treating the entire opening position as a same-day rotation.
        if prev_positions is None:
            series.append({"date": date, "turnover": 0.0})
            prev_positions = positions
            try:
                prev_date = datetime.fromisoformat(date)
            except (ValueError, TypeError):
                prev_date = None
            continue

        # P1995 fix #2: flag sparse-day rows. Parse current date; if
        # we can compute a calendar delta and it's > 1 day, record it.
        # Parse failures are not flagged — defensive fallback for
        # unconventional date keys (the math path still runs).
        try:
            current_date_parsed = datetime.fromisoformat(date)
        except (ValueError, TypeError):
            current_date_parsed = None
        if (
            current_date_parsed is not None
            and prev_date is not None
            and (current_date_parsed - prev_date).days > 1
        ):
            gap_dates.append(date)

        if not nav_present:
            # Audit H-0744: NAV row absent — emit turnover=None (not 0.0)
            # so dashboards can render a "data unavailable" marker. Do
            # NOT update prev_positions so the next valid date still
            # measures a true delta across the gap.
            series.append({"date": date, "turnover": None})
            nav_missing_dates.append(date)
            if current_date_parsed is not None:
                prev_date = current_date_parsed
            continue

        if nav <= 0:
            # NAV present but invalid (margin-call / liquidation /
            # stray zero row). Preserve T-12-04-02 short-circuit
            # semantics (turnover=0.0) for back-compat, but surface
            # the row in nav_invalid_dates and (per H-0744) preserve
            # prev_positions so the next valid date computes a true
            # delta over the gap.
            series.append({"date": date, "turnover": 0.0})
            nav_invalid_dates.append(date)
            if current_date_parsed is not None:
                prev_date = current_date_parsed
            continue

        total_change_usd = 0.0
        symbols = set(positions.keys()) | set(prev_positions.keys())
        for sym in symbols:
            delta = positions.get(sym, 0.0) - prev_positions.get(sym, 0.0)
            price = prices.get(sym, 0.0)
            total_change_usd += abs(delta * price)
        series.append({"date": date, "turnover": round(total_change_usd / nav, 6)})
        prev_positions = positions
        if current_date_parsed is not None:
            prev_date = current_date_parsed

    if nav_missing_dates:
        flags["turnover_nav_missing_dates"] = nav_missing_dates
    if nav_invalid_dates:
        flags["turnover_nav_invalid_dates"] = nav_invalid_dates
    if gap_dates:
        flags["turnover_gap_dates"] = gap_dates
    return series, flags


def compute_turnover_series(
    positions_by_date: dict[str, dict[str, float]],
    prices_by_date: dict[str, dict[str, float]],
    nav_by_date: dict[str, float],
) -> list[dict[str, Any]]:
    """Backwards-compatible wrapper around `compute_turnover_series_with_flags`.

    Returns only the series and discards the data quality flags — preserves
    the pre-existing call-site shape used by analytics_runner and
    tests/fixtures/regen_golden.py. Callers that want the flags should
    use `compute_turnover_series_with_flags` directly.
    """
    series, _flags = compute_turnover_series_with_flags(
        positions_by_date, prices_by_date, nav_by_date
    )
    return series
