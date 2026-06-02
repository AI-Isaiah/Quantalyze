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
import bisect
import logging
import math
import statistics
import time
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Literal, TypedDict
from uuid import UUID

from postgrest.base_request_builder import APIResponse
from supabase import Client

from services.closed_sets import PositionSide, TRADE_SIDES
from services.db import db_execute, rows
from services.equity.fallback import merge_dq_flags

# Audit-2026-05-07 M-0935: Sentry capture is best-effort. The sentry_sdk
# import is guarded so a stripped-down test/CI environment without sentry
# configured does not fail import on this module. The capture site below
# also swallows any sentry-side error (mirrors services/audit.py).
try:
    import sentry_sdk
except ImportError:  # pragma: no cover — sentry is a prod-only dependency
    sentry_sdk = None  # type: ignore[assignment]


# Audit-2026-05-27 H-0650: `PositionSide` is the canonical position-direction
# Literal (`long`/`short`/`flat`). It is now single-sourced from
# `services.closed_sets` (imported above) — B8b — so it can't drift from the
# buy/sell `Side` it was historically (and dangerously) conflated with. `flat`
# is the snapshot/exposure no-position marker; FIFO matching only ever assigns
# `long`/`short`. NOTE: this is the *direction* contract, NOT the return type
# of `_normalize_side` (which returns an arbitrary lowercased `str` — it
# case-folds raw `buy`/`sell`/etc. before any narrowing; see its docstring).


def _normalize_side(raw: Any) -> str:
    """Normalize a raw `side` value to a lower-cased string.

    Audit-2026-05-27 H-0650: `side` was parsed three different ways over the
    same column — `(snap.get("side") or "").lower()` (snapshot path),
    `(fill.get("side") or "").lower()` (volume_metrics), and raw equality
    `side = f.get("side")` (trade_mix, NOT case-folded). The third regime
    silently dropped an uppercase `side="LONG"` because it matched neither
    `buy`/`sell` nor the lower-cased bucket keys. This helper is the single
    normalization boundary so all three regimes agree.

    Contract: lower-cases the string form, falling back to "" for falsy /
    non-string input — IDENTICAL output to the prior `(x or "").lower()`
    idiom for every current (lowercase or falsy) input. The only behavior
    change is that the raw-equality trade_mix path now folds case too,
    which is the documented bug fix. Returns a plain `str` (not
    `PositionSide`): callers compare it against `buy`/`sell` aliases before
    it is a valid `PositionSide`, so the direction narrowing happens at the
    bucket / position-open assignment (`position_side`), not here.
    """
    if not raw:
        return ""
    return str(raw).lower()


# Audit-2026-05-07 H-0733 / H-0743: wire schemas for the JSONB
# payloads. Pre-fix both were typed as `list[dict[str, Any]]`, so a
# producer typo (e.g. `side='LONG'`) silently fed the wrong bucket in
# `_compute_derived_trade_metrics` downstream.
class RealizedPnLRecord(TypedDict):
    """Wire shape of an entry in `trade_metrics.realized_pnl_per_trade`.

    Consumed by `analytics_runner._compute_derived_trade_metrics` to
    derive SQN and segment profit_factor by side. `side` is `None` only
    for the data-quality-failure path; `realized_pnl` is `None` when
    the position has no computable PnL — the producer must not coerce
    either to a default.

    Audit-2026-05-27 H-0639: this IS the `RealizedTrade` contract the
    audit asked for — the element type of
    `PositionTradeMetrics.realized_pnl_per_trade`. The `side` field uses
    the long/short subset of the `PositionSide` Literal (`flat` is never a
    closed position's recorded direction) plus `None` for the DQ-failure path.
    """

    side: Literal["long", "short"] | None
    realized_pnl: float | None


class PositionTradeMetrics(TypedDict, total=False):
    """Wire shape of `reconstruct_positions`' return dict (the position-side
    trade metrics persisted to `strategy_analytics.trade_metrics`).

    Audit-2026-05-27 H-0638: pre-fix the producer returned an untyped
    `dict[str, Any]` and `analytics_runner._compute_derived_trade_metrics`
    consumed ~10 keys via `.get()`. A renamed/typo'd producer key silently
    yielded `None` → corrupted the derived metrics (expectancy, R:R, SQN,
    profit_factor) and the JSONB column. Enumerating every key the producer
    emits pins the contract at type-check time.

    `total=False` because the producer omits `data_quality_flags` when the
    aggregated flags dict is empty (see `_reconstruct_positions_inner`), and
    the whole dict is `{}` when a strategy has no fills.
    """

    total_positions: int
    open_positions: int
    closed_positions: int
    win_rate: float
    avg_roi: float
    capital_weighted_roi: float
    avg_duration_days: float
    long_count: int
    short_count: int
    best_trade_roi: float
    worst_trade_roi: float
    avg_winning_trade: float
    avg_losing_trade: float
    winners_count: int
    losers_count: int
    realized_pnl_per_trade: list[RealizedPnLRecord]
    data_quality_flags: dict[str, Any]


class ExposurePoint(TypedDict):
    """Wire shape of an entry in `exposure_metrics.exposure_series`
    (also published as the `exposure_series` sibling-kind row, D-01)."""

    date: str  # 'YYYY-MM-DD' per docstring contract
    gross: float
    net: float


class ExposureMetrics(TypedDict, total=False):
    """Wire shape of `compute_exposure_metrics`' return dict.

    Audit-2026-05-27 H-0658: pre-fix the producer returned an untyped
    `dict[str, Any]`; the consumer (`analytics_runner`) splits the scalar
    aggregate bag from the per-date series with
    `exposure_metrics.pop("exposure_series", None)`. Typing the contract
    surfaces a renamed key (e.g. `exposure_serie`) at type-check time
    instead of as a silently-missing sibling-table row.

    `total=False` because the producer emits THREE distinct shapes, all
    subsets of these keys:
      - shared-api-key skip → only `data_quality_flags`
      - no-snapshots        → only `data_quality_flags`
      - normal              → the six aggregates + `exposure_series`
                              (+ optional `data_quality_flags`)

    Audit-2026-05-27 H-0659: the producer always returns one of these
    dicts — it NEVER returns None. The consumer's `... or {}` guard and the
    `isinstance(exposure_metrics, dict)` check are therefore defensive
    against a hypothetical future regression, not a current None path; the
    honest return type is `ExposureMetrics` (non-optional). See the consumer
    annotation note in analytics_runner.run_strategy_analytics.
    """

    mean_gross_exposure: float
    std_gross_exposure: float
    max_gross_exposure: float
    mean_net_exposure: float
    std_net_exposure: float
    max_net_exposure: float
    exposure_series: list[ExposurePoint]
    data_quality_flags: dict[str, Any]

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

# Audit-2026-05-07 red-team pass: bound the data_quality_flags
# per-date lists (turnover_nav_missing_dates / nav_invalid_dates /
# gap_dates / series_dropped_dates) so a grid-flood can't bloat the
# strategy_analytics.data_quality_flags JSONB. 1 000 is generous: a
# strategy with 1 000 NAV-missing dates is already in a triage state
# the truncation flag will surface. On truncation, emit sibling
# counter keys (`{name}_truncated`, `*_kept`, `*_total`) matching the
# convention already used at the realized_pnl_per_trade and
# exposure_series cap sites — keeps the list[str] payload semantically
# pure and makes the merge-into-top-level-flags math (sum counters,
# OR booleans) consistent across all three truncation surfaces.
_FLAG_LIST_CAP = 1_000


def _coerce_finite_float(value: Any, label: str) -> float:
    """Coerce value to a finite float or raise ValueError.

    Why: Supabase numeric driver returns Decimal; downstream JSONB
    serializes via str(Decimal) and silently drifts precision. `float()`
    on its own also accepts `Decimal('NaN')` and `float('inf')`, which
    poison the turnover series with `nan`/`inf` in JSONB. Centralizing
    coercion + finiteness lets the three callers (positions, prices, NAV)
    share one rejection path.

    Re-raises `OverflowError` (raised by `float(huge_int)` for ints
    outside double-precision range) as `ValueError` so callers can use
    a single catch tuple `(AttributeError, TypeError, ValueError)` and
    route the bad date into `dropped_dates` instead of aborting the
    whole series.
    """
    try:
        out = float(value)
    except OverflowError as exc:
        raise ValueError(f"overflow coercing {label} value {value!r}: {exc}") from exc
    if not math.isfinite(out):
        raise ValueError(f"non-finite {label} value {value!r}")
    return out


def _parse_iso_utc(value: Any) -> datetime | None:
    """Parse an ISO-8601 timestamp string to a tz-aware UTC datetime.

    Returns None when `value` is falsy or unparseable, so callers can
    distinguish a usable instant from corrupt input instead of letting a
    raw, unvalidated string flow downstream. Naive datetimes are assumed
    UTC (mirrors the per-row parse convention used throughout
    `_attribute_funding`). Trailing 'Z' is normalized to '+00:00' for
    `datetime.fromisoformat`, which does not accept 'Z' on older runtimes.
    """
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    # Normalize an aware non-UTC offset to UTC so the return is literally UTC
    # (matches the docstring + batch-2 _parse_supabase_ts). The instant is
    # unchanged, so min/max + PostgREST comparisons are unaffected.
    return dt.astimezone(timezone.utc)


def _emit_capped_flag_list(
    flags: dict[str, Any], name: str, lst: list[str]
) -> None:
    """Attach `lst` to `flags[name]`, truncating at `_FLAG_LIST_CAP`.

    On truncation, emit sibling counter keys (`{name}_truncated`,
    `{name}_truncated_kept`, `{name}_truncated_total`) so consumers can
    detect the partial-window state without parsing magic strings out of
    the list. Mirrors the convention used at the realized_pnl_per_trade
    and exposure_series cap sites.
    """
    if not lst:
        return
    if len(lst) > _FLAG_LIST_CAP:
        flags[name] = lst[:_FLAG_LIST_CAP]
        flags[f"{name}_truncated"] = True
        flags[f"{name}_truncated_kept"] = _FLAG_LIST_CAP
        flags[f"{name}_truncated_total"] = len(lst)
    else:
        flags[name] = lst


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


async def reconstruct_positions(
    strategy_id: str | UUID, supabase: Client
) -> PositionTradeMetrics:
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


async def _reconstruct_positions_inner(
    strategy_id: str, supabase: Client
) -> PositionTradeMetrics:
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
    def _fetch_fills() -> APIResponse:
        return (
            supabase.table("trades")
            .select("*")
            .eq("strategy_id", strategy_id)
            .eq("is_fill", True)
            .order("timestamp")
            .execute()
        )

    result = await db_execute(_fetch_fills)
    fills = rows(result)

    if not fills:
        logger.info("No fills found for strategy %s", strategy_id)
        return {}

    # Audit-2026-05-07 G12.C.6: bucket by (symbol, exchange) tuple instead
    # of symbol alone. Symbol-less fills are DROPPED (not bucketed under
    # 'UNKNOWN') so heterogeneous instruments can no longer FIFO-match
    # under a fictitious shared lifecycle (a buy of BTC and a sell of ETH
    # would otherwise "close" a position).
    fills_by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
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

    all_positions: list[dict[str, Any]] = []
    aggregated_data_quality_flags: dict[str, Any] = {}
    # Audit H-0812: counters for positions DROPPED inside FIFO (corrupt input,
    # e.g. zero_entry_price_dropped). Accumulated across symbols, then merged
    # into the strategy-level flags below — the dropped positions are not in
    # the returned list to carry their own per-position flag.
    fifo_dropped_flags: dict[str, Any] = {}

    for (symbol, _exchange), symbol_fills in fills_by_key.items():
        # Sort by timestamp within bucket (per-symbol-per-exchange).
        symbol_fills.sort(key=lambda f: f.get("timestamp", ""))
        positions = _match_positions_fifo(
            symbol, symbol_fills, strategy_id, dropped_flags=fifo_dropped_flags
        )
        # Audit-2026-05-27 P1 (MED8): stamp the bucket's exchange onto each
        # position so `_attribute_funding` can key funding lookup by
        # (symbol, exchange) — matching the FIFO bucketing. `_match_positions_fifo`
        # only knows `symbol` (it is also imported by equity_reconstruction with
        # that narrower contract), so the exchange is attached here at the one
        # site that holds the (symbol, exchange) bucket key. `exchange` is a
        # transient key stripped before the atomic-rebuild RPC (see _NON_DB_KEYS).
        for pos in positions:
            pos["exchange"] = _exchange
        # Audit G12.C.4: collect transient data_quality_flags from
        # in-memory position dicts BEFORE we strip them for DB persistence.
        # B22: route through the one canonical reducer (bool-OR / int-sum /
        # else-replace) in services.equity.fallback so this merge and the
        # FIFO-drop merge below can no longer diverge.
        for pos in positions:
            flags = pos.get("data_quality_flags")
            if isinstance(flags, dict):
                merge_dq_flags(aggregated_data_quality_flags, flags)
        all_positions.extend(positions)

    if fills_dropped_no_symbol:
        aggregated_data_quality_flags["fills_dropped_no_symbol"] = (
            fills_dropped_no_symbol
        )

    # Audit H-0812: merge FIFO drop counters (e.g. zero_entry_price_dropped)
    # into the strategy-level flags. B22: the SAME canonical reducer as the
    # per-position aggregation above — the two merges are now one function, so
    # they cannot drift apart (previously hand-mirrored copies kept in sync by
    # comment alone).
    merge_dq_flags(aggregated_data_quality_flags, fifo_dropped_flags)

    await _attribute_funding(
        strategy_id, all_positions, supabase, aggregated_data_quality_flags
    )

    # Audit-2026-05-07 G12.C.1/C.2: atomic DELETE+INSERT via RPC. The RPC
    # signature mirrors the column list of the previous direct INSERT so
    # the on-disk shape is unchanged. Strip in-memory-only keys (e.g.
    # `data_quality_flags` which the positions table does not have).
    payload = [_strip_non_db_keys(p) for p in all_positions]

    def _atomic_rebuild() -> None:
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
    # Audit M-0709: `all_positions` is built by iterating `fills_by_key`
    # (a dict keyed by (symbol, exchange)) whose insertion order tracks the
    # input fill order, so the persisted `realized_pnl_per_trade` list — and
    # the chronological-first-N truncation slice below — would otherwise
    # depend on which symbol's fills the caller happened to pass first. Sort
    # by closed_at ASC so the persisted list contract is deterministic and
    # input-order insensitive (downstream SQN / profit-factor sums are
    # already order-insensitive; the LIST contract was not). Positions with a
    # missing closed_at sort last but keep their relative order (stable sort).
    closed.sort(key=lambda p: (p.get("closed_at") is None, p.get("closed_at") or ""))

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
    winners: list[dict[str, Any]] = []
    losers: list[dict[str, Any]] = []
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

    # NEW-C01-16: capital-weighted ROI = total realized PnL / total entry
    # notional. `avg_roi` (unweighted arithmetic mean) weights a $10 +500%
    # position equally with a $1M +2% position; a $10 outlier can dominate.
    # This variant reflects how much the strategy made per dollar deployed.
    # Only include closed positions with both realized_pnl and notional > 0.
    # silent-failure/F-09: float(p["realized_pnl"]) raises ValueError for
    # non-numeric strings (e.g. "N/A", "", "12.3USDT"). The None guard only
    # filters None; a buggy ingestion path can store an empty or currency-
    # suffixed string. Wrap in try/except to match the same-diff fix applied
    # to the equity_reconstruction spot_fee path (F-08).
    _pnl_values: list[float] = []
    for _p in closed:
        _raw_pnl = _p.get("realized_pnl")
        if _raw_pnl is None:
            continue
        try:
            _pnl_values.append(float(_raw_pnl))
        except (TypeError, ValueError):
            logger.warning(
                "capital_weighted_roi: unparseable realized_pnl=%r for "
                "position %s — excluded from sum",
                _raw_pnl, _p.get("id"),
            )
    _sum_pnl = sum(_pnl_values)
    _sum_notional = sum(
        float(p["entry_price_avg"] or 0.0) * float(p.get("size_base") or p.get("quantity") or 0.0)
        for p in closed
        if p.get("entry_price_avg") and (p.get("size_base") or p.get("quantity"))
    )
    capital_weighted_roi = (
        round(_sum_pnl / _sum_notional, 6) if _sum_notional > 0 else 0.0
    )

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
    # strategy_analytics JSONB. Sibling counter keys surface partial
    # window state to the dashboard (SQN / profit factor / R:R are
    # then known to be computed over the kept slice only).
    realized_pnl_per_trade: list[RealizedPnLRecord] = [
        RealizedPnLRecord(
            side=p.get("side"),
            realized_pnl=(
                float(p["realized_pnl"]) if p.get("realized_pnl") is not None else None
            ),
        )
        for p in closed[:_REALIZED_PNL_PER_TRADE_CAP]
    ]
    if len(closed) > _REALIZED_PNL_PER_TRADE_CAP:
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

    out: PositionTradeMetrics = {
        "total_positions": total,
        "open_positions": open_count,
        "closed_positions": closed_count,
        "win_rate": round(win_rate, 4),
        "avg_roi": round(avg_roi, 6),
        # NEW-C01-16: capital-weighted ROI alongside the unweighted avg_roi.
        # avg_roi is kept for backward compatibility (existing dashboards read it).
        "capital_weighted_roi": capital_weighted_roi,
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
_NON_DB_KEYS = frozenset({"data_quality_flags", "exchange"})


def _strip_non_db_keys(pos: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of the position dict with transient (non-column) keys
    removed. Caller-side defense for the atomic-rebuild RPC payload."""
    return {k: v for k, v in pos.items() if k not in _NON_DB_KEYS}


async def _attribute_funding(
    strategy_id: str,
    positions: list[dict[str, Any]],
    supabase: Client,
    flags: dict[str, Any] | None = None,
) -> None:
    """Sum funding_fees into each position's funding_pnl column.

    For each position, sums amounts from funding_fees rows where:
      - strategy_id matches
      - symbol matches
      - timestamp is within [opened_at, closed_at] (open positions use
        closed_at=now for the upper bound)

    Mutates the positions list in place. Called after FIFO matching and
    before DB persist in reconstruct_positions.

    `flags`, when supplied, is the strategy-level
    `aggregated_data_quality_flags` dict. On a swallowed funding-fetch
    failure we set `flags['funding_attribution_failed'] = True` (Audit
    H-1094) so the silent funding_pnl=0 degradation is observable to
    analytics_runner (which lifts it into
    `strategy_analytics.data_quality_flags`) instead of letting the
    dashboard claim "ROI excludes funding" when funding could not be
    loaded at all. Corrupt position timestamps are counted per-position in
    `flags['funding_window_corrupt_position']` (Audit H-1097). Funding rows
    dropped from the sum because their OWN timestamp/amount is corrupt are
    counted in `flags['funding_rows_unparseable']` — a partial under-count of
    funding_pnl, distinct from the all-or-nothing `funding_attribution_failed`.

    Failure mode: if funding_fees fetch errors (e.g. RLS misconfig, table
    missing on a stale staging DB), each position keeps funding_pnl=0
    rather than blocking the entire reconstruction. Logged as warning and
    surfaced via the DQ flag above.
    """
    if not positions:
        return

    now = datetime.now(timezone.utc)

    # Compute the date window that bounds all positions so the query is a
    # tight range scan on the (strategy_id, timestamp DESC) index rather
    # than a full strategy-partition scan.
    #
    # Audit H-1095: `min(... if p.get('opened_at'))` raises
    # ValueError('min() arg is an empty sequence') when EVERY position has a
    # falsy opened_at (e.g. open positions seeded from a fill whose timestamp
    # was NULL/empty → position_open_time=None). This computation sits before
    # the DB-fetch try/except below, so the ValueError would escape and crash
    # the whole reconstruction — violating this function's documented
    # fail-soft contract (positions keep funding_pnl=0).
    #
    # Audit H-1097: compute the bounds from PARSED datetimes, not raw string
    # min/max. The pre-fix code took the lexical min/max of opened_at /
    # closed_at strings and injected them straight into PostgREST .gte/.lte.
    # A SINGLE corrupt closed_at (e.g. a space instead of 'T', or a Unix-ms
    # int-as-string) could be lexically-max yet parse-invalid as TIMESTAMPTZ,
    # making PostgREST 400 the whole range scan — which the broad `except`
    # below then swallows, silently zeroing funding for EVERY position. By
    # parsing first, only positions with a valid timestamp contribute to the
    # bounds; corrupt-but-present timestamps are counted (not injected raw)
    # so one poison-pill row can no longer take down the strategy's funding.
    open_dts: list[datetime] = []
    close_dts: list[datetime] = []
    corrupt_window_positions = 0
    for p in positions:
        pos_corrupt = False
        opened_raw = p.get("opened_at")
        if opened_raw:
            opened_dt = _parse_iso_utc(opened_raw)
            if opened_dt is None:
                pos_corrupt = True
            else:
                open_dts.append(opened_dt)
        closed_raw = p.get("closed_at")
        if not closed_raw:
            # Open position (or no recorded close): upper bound is now.
            close_dts.append(now)
        else:
            closed_dt = _parse_iso_utc(closed_raw)
            if closed_dt is None:
                # Corrupt close: the per-position scan below falls THIS row's
                # window back to `now`, so the query upper bound MUST also cover
                # `now` — otherwise the fetch window ends before this position's
                # window and its funding is silently dropped (a quieter
                # recurrence of the H-1097 poison-pill, e.g. a clean early close
                # + a later corrupt-close position). Mirror the per-position
                # fallback here instead of dropping the bound.
                pos_corrupt = True
                close_dts.append(now)
            else:
                close_dts.append(closed_dt)
        # Count per POSITION, not per timestamp: a position with BOTH opened_at
        # and closed_at corrupt is ONE corrupt position, not two (the flag is a
        # position-keyed count summed into strategy_analytics.data_quality_flags).
        if pos_corrupt:
            corrupt_window_positions += 1

    if corrupt_window_positions and flags is not None:
        flags["funding_window_corrupt_position"] = (
            flags.get("funding_window_corrupt_position", 0)
            + corrupt_window_positions
        )

    if not open_dts:
        # Fail-soft, consistent with the funding_fees-fetch-failure path below:
        # no position has a usable (parseable) opened_at, so there is no lower
        # window bound to attribute funding against. This is the WORST funding
        # degradation (the entire lower bound is unrecoverable), so surface it
        # both at WARNING and via the same DQ flag as the fetch-failure path —
        # otherwise the dashboard sees a clean flag blob and implies the
        # strategy simply paid no funding. Then leave every funding_pnl at 0.
        if flags is not None:
            flags["funding_attribution_failed"] = True
        logger.warning(
            "funding attribution skipped for strategy %s: no position has a "
            "parseable opened_at (%d positions, %d with corrupt timestamps) — "
            "funding_pnl stays 0",
            strategy_id, len(positions), corrupt_window_positions,
        )
        return
    # Serialize the parsed bounds back to canonical ISO-8601 so PostgREST
    # always receives a valid TIMESTAMPTZ literal. close_dts is guaranteed
    # non-empty TODAY: every position appends exactly one entry above (a parsed
    # close, or `now` for an open OR corrupt-close position), and reaching here
    # requires open_dts non-empty ⇒ positions non-empty. So `else now` is
    # UNREACHABLE today — kept only so a future refactor that stops every
    # position contributing a close bound degrades to `now` instead of a
    # max([]) ValueError before the DB try/except below.
    min_opened_at = min(open_dts).isoformat()
    max_closed_at = (max(close_dts) if close_dts else now).isoformat()

    # Page size for funding_fees fetch. Small enough to stay well under
    # PostgREST's per-response limit; used in tests via patching.
    #
    # Audit-2026-05-07 M-0938 (raise page size): page size pinned to
    # PostgREST `max_rows=1000` (repo supabase/config.toml). Raising the
    # page size without bumping the server max would silently truncate:
    # `.range(0, 9999)` would still return at most 1000 rows, and the
    # `len(chunk) < _PAGE_SIZE` terminator would then declare the funding
    # window complete after page 1 even when more data exists.
    # Coordinated infra change, not a code change. Current pagination is
    # correct.
    _PAGE_SIZE = 1000

    funding_rows: list[dict[str, Any]] = []
    page = 0
    try:
        while True:
            start = page * _PAGE_SIZE
            end = start + _PAGE_SIZE - 1

            def _fetch_funding(s: int = start, e: int = end) -> APIResponse:
                return (
                    supabase.table("funding_fees")
                    # NEW-C30-02: include currency so we can skip
                    # base-coin-denominated (inverse-perp) rows before
                    # summing — previously only symbol/amount/timestamp were
                    # selected, so a 0.0001 BTC row was silently added as $0.0001
                    # into a USD funding_pnl column (magnitude ~5 orders wrong).
                    # Audit-2026-05-27 P1 (MED8): include exchange so funding is
                    # keyed by (symbol, exchange), matching the FIFO bucketing —
                    # otherwise two same-symbol positions on different exchanges
                    # would both claim each other's funding rows.
                    .select("symbol, amount, timestamp, currency, exchange")
                    .eq("strategy_id", strategy_id)
                    .gte("timestamp", min_opened_at)
                    .lte("timestamp", max_closed_at)
                    # Audit-2026-05-07 M-0939: explicit ordering so pages are
                    # stable across PostgREST default-ordering changes. Without
                    # this the pagination relies on PostgREST's implicit
                    # primary-key ordering — any future server tweak could
                    # silently double-count or skip rows at page boundaries,
                    # corrupting funding_pnl. Ascending by timestamp also
                    # matches the per-(symbol, exchange) timeline sort below,
                    # so a single-page response arrives pre-sorted.
                    .order("timestamp")
                    .range(s, e)
                    .execute()
                )

            result = await db_execute(_fetch_funding)
            chunk = rows(result)
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
        # Audit H-1094: surface the silent funding_pnl=0 degradation as a
        # data-quality flag (mirrors breakeven_positions / fills_dropped_no_symbol).
        # analytics_runner lifts inner trade_metrics flags into
        # strategy_analytics.data_quality_flags, so the dashboard can warn that
        # ROI excludes funding because funding could NOT be loaded — instead of
        # implying the strategy simply paid none.
        if flags is not None:
            flags["funding_attribution_failed"] = True
        # Audit-2026-05-07 M-0935: also capture to Sentry so an RLS regression
        # or transient outage that silently zeros funding for every position
        # is observable in error tracking — the WARNING log + DQ flag alone
        # require dashboard inspection / log search to notice. Wrapped so a
        # sentry-side failure cannot mask the original DQ flag.
        #
        # Audit-2026-05-07 round-2 M2 (Sentry tag-bleed): `sentry_sdk.set_tag`
        # mutates the GLOBAL isolation scope, so after this fires for
        # strategy A every subsequent Sentry capture in the same worker
        # request inherits `strategy_id=A`. Wrap in `new_scope()` to bound
        # the tag lifetime to this capture only — mirrors the surrounding
        # request-scoped pattern at services/logging_config.py:116.
        if sentry_sdk is not None:
            try:
                with sentry_sdk.new_scope() as scope:
                    scope.set_tag("funding_attribution_failed", "true")
                    scope.set_tag("strategy_id", str(strategy_id))
                    sentry_sdk.capture_exception(exc)
            except Exception:  # pragma: no cover — best-effort
                pass
        return

    if not funding_rows:
        return

    # Group funding rows by symbol for fast lookup during position scan.
    # Audit H-1094 (extended): a funding row with a missing/corrupt timestamp or
    # non-numeric amount is dropped from the sum — which silently UNDER-counts
    # funding_pnl (a wrong-but-clean-looking ROI). Count the drops and surface
    # them so a half-corrupt funding feed is observable, mirroring the
    # all-or-nothing funding_attribution_failed flag.
    #
    # NEW-C30-02: funding_fees.currency is the settlement coin (USDT for linear
    # perps, BTC/ETH for inverse perps). Summing raw amounts across currencies
    # produces a magnitude error of ~5 orders of magnitude (0.0001 BTC ≈ $6
    # but is added as $0.0001). Only sum rows whose currency is a USD-quote
    # stablecoin; skip others and emit a DQ flag so the drop is observable.
    _USD_QUOTE_CURRENCIES = frozenset({"USDT", "USDC", "BUSD", "USD", "TUSD", "FDUSD"})
    # Audit-2026-05-27 P1 (MED8): key funding rows by (symbol, exchange) so a
    # row is only ever a candidate for positions on the SAME exchange — the FIFO
    # bucketing key (G12.C.6). Positions are stamped with their bucket exchange
    # (see `_reconstruct_positions_inner`); the funding fetch now selects it too.
    by_key: dict[tuple[str, str], list[tuple[datetime, Decimal]]] = defaultdict(list)
    funding_rows_unparseable = 0
    funding_currency_unsupported_count = 0
    for row in funding_rows:
        sym = row.get("symbol", "")
        ts_raw = row.get("timestamp")
        amt_raw = row.get("amount")
        if not sym or ts_raw is None or amt_raw is None:
            funding_rows_unparseable += 1
            continue
        # Match the FIFO bucket's exchange fallback ("unknown") so a
        # NULL-exchange funding row aligns with a NULL-exchange position bucket.
        row_exchange = row.get("exchange") or "unknown"
        # NEW-C30-02: skip base-coin-denominated rows (inverse perps).
        currency = (row.get("currency") or "").upper()
        if currency and currency not in _USD_QUOTE_CURRENCIES:
            funding_currency_unsupported_count += 1
            # silent-failure/F-07: was logger.debug — invisible in production.
            # The parallel guard in EquityCurveBuilder.attach_funding correctly
            # logs at WARNING. Use the same level so operators can see which
            # symbols are affected without enabling DEBUG logging.
            logger.warning(
                "funding attribution: skipped row currency=%r for symbol=%s "
                "(strategy %s) — not a USD-quote stablecoin",
                currency, sym, strategy_id,
            )
            continue
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            amt = Decimal(str(amt_raw))
        except Exception:  # noqa: BLE001 — keep fail-soft; the row is counted
            funding_rows_unparseable += 1
            continue
        by_key[(sym, row_exchange)].append((ts, amt))

    if funding_rows_unparseable and flags is not None:
        flags["funding_rows_unparseable"] = (
            flags.get("funding_rows_unparseable", 0) + funding_rows_unparseable
        )
    if funding_currency_unsupported_count and flags is not None:
        # NEW-C30-02: surface skipped inverse-perp funding rows so the
        # dashboard can warn that funding_pnl EXCLUDES inverse-perp funding
        # (partial data) rather than silently mis-summing it.
        flags["funding_currency_unsupported"] = (
            flags.get("funding_currency_unsupported", 0)
            + funding_currency_unsupported_count
        )

    # Sort each (symbol, exchange) timeline once — supports linear scan
    # per position and a stable single-assignment ownership pass below.
    for key in by_key:
        by_key[key].sort(key=lambda x: x[0])

    # Audit-2026-05-27 P1 (MED8): attribute each funding row to EXACTLY ONE
    # position, with half-open `[opened_at, closed_at)` windows. The prior loop
    # summed every row in `[opened, closed]` (BOTH bounds inclusive) into EVERY
    # position whose window contained it — two double-count bugs:
    #   (a) a flip at instant T stamps the closing long with window [open, T]
    #       and the new short with [T, close]; a funding row at exactly T landed
    #       in BOTH (inclusive bounds). Half-open windows put it solely in the
    #       new short ([T, close)) — counted once.
    #   (b) two same-symbol positions with overlapping windows both summed a row
    #       in the overlap. Single-assignment (consume each row once) fixes it;
    #       (symbol, exchange) keying additionally prevents cross-exchange bleed.
    #
    # Algorithm: parse + collect each position's window, sort positions by
    # opened_at (then closed_at) so earlier-opened positions claim contested
    # rows first, and walk each position's (symbol, exchange) timeline skipping
    # rows a prior position already consumed. Rows are sorted by ts; a per-key
    # `consumed` set of indices marks ownership so no row is summed twice.
    #
    # `now` (sampled before the fetch) is the open/corrupt-close upper bound —
    # sampling a second `now` here would let a row in the micro-gap between the
    # two be inside a window yet outside the (earlier) fetch bound, dropping it.
    parsed_positions: list[tuple[datetime, datetime, dict[str, Any]]] = []
    for pos in positions:
        # Default funding_pnl=0 for every position; only positions whose window
        # parses and claims rows below get a non-zero value.
        pos["funding_pnl"] = 0
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
                closed_dt = now
        else:
            closed_dt = now

        parsed_positions.append((opened_dt, closed_dt, pos))

    # Earlier-opened (then earlier-closed) positions claim contested rows first.
    parsed_positions.sort(key=lambda x: (x[0], x[1]))

    # Audit-2026-05-07 M-0934: bisect into the per-key SORTED-BY-TS timeline
    # so each position only scans the funding rows whose timestamp falls in
    # its window, not the whole symbol timeline. Pre-fix this was O(P * F)
    # per (symbol, exchange): for a 5-year strategy with ~100 positions and
    # ~1500 funding rows per symbol, that's ~150k comparisons per call vs
    # ~O(P log F + total_window_rows) with bisect. Per-key timestamp arrays
    # are extracted once so `bisect_left` can binary-search. Both window
    # bounds use ``bisect_left`` (lower AND upper) to implement half-open
    # ``[opened, closed)`` semantics — see the inline comment at the
    # bisect call below for the upper-bound rationale.
    # The `consumed` set still tracks single-assignment ownership for
    # positions with OVERLAPPING windows on the same key — bisect bounds the
    # scan window, the set picks the winner inside it.
    key_timestamps: dict[tuple[str, str], list[datetime]] = {
        key: [row[0] for row in key_rows] for key, key_rows in by_key.items()
    }
    # Per-(symbol, exchange) set of funding-row indices already owned by a
    # position, so a row is summed into at most one position.
    consumed: dict[tuple[str, str], set[int]] = defaultdict(set)
    for opened_dt, closed_dt, pos in parsed_positions:
        key = (pos.get("symbol", ""), pos.get("exchange") or "unknown")
        key_rows = by_key.get(key, [])
        if not key_rows:
            continue
        timestamps = key_timestamps[key]
        # Half-open window: [opened, closed). bisect_left on opened_dt finds
        # the first ts >= opened_dt; bisect_left on closed_dt finds the first
        # ts >= closed_dt — i.e. the upper-exclusive bound. A row at exactly
        # closed_dt is therefore EXCLUDED (it belongs to the NEXT leg or to
        # no position) — preserves the prior half-open semantics that kills
        # the flip-instant double count.
        lo = bisect.bisect_left(timestamps, opened_dt)
        hi = bisect.bisect_left(timestamps, closed_dt)
        owned = consumed[key]
        total = Decimal(0)
        for idx in range(lo, hi):
            if idx in owned:
                continue
            total += key_rows[idx][1]
            owned.add(idx)

        # Round to 8 decimals (funding amounts are typically ≤ 6 places
        # but we keep headroom to avoid premature truncation).
        pos["funding_pnl"] = _round_float(total, 8)


# Audit-2026-05-07 PATTERN-2 / P1100: net-qty snap-to-zero scale factor.
# After every reducing fill in `_match_positions_fifo` we collapse any
# `|net_qty|` below `max(total_entry_qty * FLIP_EPS_FACTOR, MIN_QTY_DUST)`
# to an exact zero. 1e-9 = "one part per billion" of the original position
# size; below this we treat the residue as dust rather than a real open
# exposure. Without the snap, sub-quantum residuals accumulated across many
# micro-fills cause the close-and-flip branch to fire spuriously, producing
# zero-duration phantom positions whose entry and exit prices both equal a
# fill price (impossible under normal FIFO semantics). Full root-cause
# analysis: `.planning/audit-2026-05-07/INVEST-PATTERN-2-POSITIONS.md`.
#
# Audit-2026-05-07 M-0717 / M-0718: the FIFO matcher now runs ALL monetary
# and quantity arithmetic in `Decimal` (parsed from the trades table's
# NUMERIC columns via `Decimal(str(...))`), serializing back to float only
# at the output boundary in `position_dict` / `open_dict`. Two consequences:
#   - The snap factor and absolute dust floor are Decimal so the proportional
#     `total_entry_qty * FLIP_EPS_FACTOR` snap stays in exact arithmetic and
#     never re-introduces float drift it was meant to absorb.
#   - The bare close-detection used a hardcoded float epsilon `1e-12`
#     (M-0718): wrong for memecoin-scale sizes (1e6 - 999999.9999999999
#     routinely exceeds 1e-12) and for sub-satoshi BTC closes. With exact
#     Decimal arithmetic a genuine close lands on EXACTLY `Decimal(0)`, so
#     close detection is `net_qty == 0` (exact). The only residue that can
#     survive is the proportional dust the snap above already collapses;
#     `MIN_QTY_DUST` (1e-9 base units) remains the absolute floor for the
#     snap, documented as "below the smallest exchange lot precision (1e-8)".
FLIP_EPS_FACTOR = Decimal("1e-9")

# Absolute lower floor for the proportional snap-to-zero above. 1e-9 base
# units sits one order of magnitude below the smallest exchange lot
# precision in use (Binance/OKX minQty ~1e-8), so a residue below it cannot
# be a real fill remainder — it is accumulation dust. Change only if a base
# asset adopts a tick finer than 1e-9.
MIN_QTY_DUST = Decimal("1e-9")


def _decimal_or_none(value: Any) -> Decimal | None:
    """Parse a trades-table numeric (str/int/float/Decimal) to a finite
    Decimal, or None when the value is missing or non-numeric.

    The trades table columns (quantity, price, fee) are NUMERIC; PostgREST
    returns them as JSON strings to preserve precision. Parsing via
    `Decimal(str(value))` keeps that precision end-to-end through the FIFO
    matcher (M-0717). A non-finite result (NaN/Inf, reachable if a parser
    upstream stored 'NaN'/'Infinity') is rejected as None so it cannot
    poison `total_entry_cost` — mirrors the `is_finite()` guard the
    closed/open record paths already apply to `entry_avg`.
    """
    if value is None:
        return None
    try:
        out = Decimal(str(value))
    except (ArithmeticError, ValueError, TypeError):
        return None
    if not out.is_finite():
        return None
    return out


def _round_float(value: Decimal, places: int) -> float:
    """Round a Decimal money/qty field and return it as float for the OUTPUT
    boundary. `round(Decimal, n)` quantizes within the active 28-digit decimal
    context and raises InvalidOperation once the result needs more digits
    (e.g. a >=1e20 value rounded to 8dp). The matcher runs in a bare per-symbol
    loop, so that uncaught crash would take down the WHOLE reconstruction on
    corrupt large-magnitude input that the prior float code tolerated
    (red-team 2026-05-27). The serialized output is float regardless, so round
    the float: identical for representable values, and float round never raises.
    """
    return round(float(value), places)


# Phase 19 / MC-2 decision: leave private (underscore prefix preserved).
# EquityCurveBuilder (services/equity_reconstruction.py) imports this
# directly to avoid touching the DB-side tested primitive. Future API
# cleanup may rename without underscore once the equity-curve seam is stable.
def _match_positions_fifo(
    symbol: str,
    fills: list[dict[str, Any]],
    strategy_id: str,
    dropped_flags: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """FIFO position matching for a single symbol.

    Tracks net position: buy increases (long), sell decreases (long).
    For shorts: sell increases, buy decreases.
    Uses posSide from raw_data when available (OKX hedge mode).
    When net crosses zero -> position closed.

    `dropped_flags`, when supplied, accumulates strategy-level data-quality
    counters for positions that were DROPPED (not returned) because their
    input was corrupt — e.g. `zero_entry_price_dropped`. The caller merges
    it into the aggregated strategy data_quality_flags. Dropped positions
    are excluded from the returned list so corrupt input cannot pollute
    win_rate / avg_roi / expectancy as a fabricated flat trade.
    """
    # Audit-2026-05-07 M-0717/M-0718: all monetary + quantity state is
    # Decimal. Float accumulation of `total_entry_cost += price * qty` over
    # thousands of fills drifts (the trades table is NUMERIC); Decimal keeps
    # the running sums exact and makes the close-detection `net_qty == 0`
    # exact rather than dependent on a float epsilon. Serialized to float
    # only when building the output position dict.
    positions: list[dict[str, Any]] = []
    net_qty = Decimal(0)
    entry_fills: list[dict[str, Any]] = []  # fills that opened the current position
    # Audit-2026-05-27 P2 (LOW9): count EVERY fill that touches the current
    # position (open + adds + partial reductions + final close), not just the
    # opening/adding fills. `entry_fills` only ever held opening/adding fills,
    # so `fill_count = len(entry_fills) + 1` undercounted any position with
    # intermediate partial reductions (e.g. 1 open + 3 partial reductions + 1
    # close reported 2 instead of 5). This counter is incremented at each
    # branch that allocates a fill's quantity to the position.
    fill_touch_count = 0
    total_entry_cost = Decimal(0)
    total_entry_qty = Decimal(0)
    peak_qty = Decimal(0)  # track peak position size for size_peak column
    # Audit-2026-05-07 G12.C.5: track exit VWAP across multi-fill closes.
    # Previously `exit_avg = price` of the last closing fill only.
    total_exit_cost = Decimal(0)
    total_exit_qty = Decimal(0)
    total_fees = Decimal(0)
    # Audit-2026-05-27 type-hygiene: the live `PositionSide` annotation. Only
    # ever `None` (no open position) or `"long"`/`"short"` — the matcher never
    # assigns `"flat"` to a reconstructed position, but the direction contract
    # is shared with the snapshot/exposure path so `PositionSide` carries the
    # full three-value domain.
    position_side: PositionSide | None = None
    position_open_time = None
    # Audit-2026-05-07 G12.C.4: per-position transient quality flags
    # (e.g. posSide_side_mismatch). Stored on the in-memory dict and
    # stripped before the atomic-rebuild RPC payload is sent.
    position_quality_flags: dict[str, Any] = {}

    for fill in fills:
        # Audit-2026-05-27 H-0650: single normalization boundary (was
        # `fill.get("side", "").lower()`). Behavior-identical for current
        # lowercase/falsy input.
        side = _normalize_side(fill.get("side"))
        # NEW-C01-09 (FIFO-matcher half): `trades` can hold a fill whose side is
        # not in TRADE_SIDES — the ingest layer (exchange._make_fill_dict)
        # deliberately FLAGS-but-PERSISTS such fills. Guard it HERE too: without
        # this, the open branch below (`"short" if side == "sell" else "long"`)
        # defaults ANY non-"sell" side (incl. "", "long", garbage) to a phantom
        # LONG, and the close branch silently consumes it — corrupting
        # win_rate / expectancy / long_count on trade_metrics with no signal.
        # The equity-curve consumer is already guarded
        # (equity_reconstruction._compute_daily_equity); this closes the second
        # consumer the ingest comment's "downstream guard" rationale omitted.
        # Drop the corrupt fill and surface it through the same drop-and-count
        # channel as malformed_fill_field_dropped / zero_entry_price_dropped.
        if side not in TRADE_SIDES:
            if dropped_flags is not None:
                dropped_flags["unknown_side_dropped"] = (
                    dropped_flags.get("unknown_side_dropped", 0) + 1
                )
            logger.warning(
                "position_reconstruction: dropping fill with side=%r not in "
                "TRADE_SIDES (strategy=%s symbol=%s) — would otherwise open a "
                "phantom long (NEW-C01-09)",
                side, strategy_id, symbol,
            )
            continue
        # Audit-2026-05-07 M-0717: parse the NUMERIC columns as Decimal
        # (preserving the PostgREST string precision) instead of float. A
        # missing value coerces to Decimal(0) — preserving the prior
        # `float(... or 0)` behavior where a 0/None qty fill is skipped by the
        # `qty <= 0` guard below, and a None price/fee contributes 0.
        raw_qty = fill.get("quantity")
        raw_price = fill.get("price")
        raw_fee = fill.get("fee")
        parsed_qty = _decimal_or_none(raw_qty)
        parsed_price = _decimal_or_none(raw_price)
        parsed_fee = _decimal_or_none(raw_fee)
        # Specialist follow-up (pr-test-analyzer / silent-failure-hunter): the
        # old `float(fill[...] or 0)` RAISED on a present-but-non-numeric value
        # (e.g. quantity="abc"); the Decimal parse instead returns None and
        # coerces to 0, which would silently drop a corrupt fill from the
        # reconstruction. Surface a field that was PRESENT but unparseable via
        # the same drop-and-count channel as `zero_entry_price_dropped`, so
        # corrupt monetary input is visible rather than swallowed. A
        # legitimately ABSENT field (raw is None) is not corruption — skip it.
        if dropped_flags is not None:
            malformed = sum(
                1
                for raw, parsed in (
                    (raw_qty, parsed_qty),
                    (raw_price, parsed_price),
                    (raw_fee, parsed_fee),
                )
                if raw is not None and parsed is None
            )
            if malformed:
                dropped_flags["malformed_fill_field_dropped"] = (
                    dropped_flags.get("malformed_fill_field_dropped", 0) + malformed
                )
        qty = parsed_qty or Decimal(0)
        price = parsed_price or Decimal(0)
        fee = parsed_fee or Decimal(0)

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

        # Determine if this fill opens or closes position.
        # Audit-2026-05-07 M-0718: exact Decimal zero-test. The prior float
        # `abs(net_qty) < 1e-12` was simultaneously too SMALL to absorb
        # memecoin-scale residue (1e6 - 999999.9999999999 is ~1.16e-10, well
        # above 1e-12, so it was NOT snapped -> phantom flip) yet large enough
        # to wrongly snap away a genuine sub-satoshi position; with Decimal
        # arithmetic a flat book is EXACTLY Decimal(0) (the close/flip branch
        # below snaps any proportional dust to 0 too).
        if net_qty == 0:
            # Opening a new position. Direction is derived from `side`
            # (buy → long, sell → short). posSide is treated as a HINT
            # only: if it disagrees with side, we PREFER side and flag
            # the mismatch in data_quality_flags. The previous code
            # blindly trusted posSide, allowing posSide='short' on a
            # side='buy' fill to publish a fabricated short-side
            # position to allocators (G12.C.4).
            side_derived: PositionSide = "short" if side == "sell" else "long"
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
            total_exit_cost = Decimal(0)
            total_exit_qty = Decimal(0)
            entry_fills = [fill]
            # P2 (LOW9): this opening fill is the first touch of the new position.
            fill_touch_count = 1
            position_open_time = fill.get("timestamp")
            continue

        # Existing position. Determine whether this fill is closing (or
        # partial-closing/overshooting) the current side and how much of
        # the fill quantity is allocated to the close vs. the next leg.
        #
        # P2 (LOW9): every fill that reaches here touches the current position
        # (add, partial reduction, or final/overshoot close) — count it. Adds
        # also append to `entry_fills`; reductions previously appended NOWHERE,
        # which is exactly why `len(entry_fills) + 1` undercounted. On an
        # overshoot/flip this fill ALSO seeds the new leg's count (handled in
        # the flip branch below) since it both closes the old leg and opens the
        # new one.
        fill_touch_count += 1
        closing_qty = Decimal(0)
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
                closing_qty = min(qty, net_qty) if net_qty > 0 else Decimal(0)
                net_qty -= qty
                # Audit-2026-05-07 PATTERN-2 / P1100: snap proportional dust
                # to zero. Exact Decimal arithmetic removes the IEEE-754 ULP
                # residue the float path accumulated, but a tiny PROPORTIONAL
                # remainder (e.g. an exchange reporting a close fill rounded
                # to fewer places than the opening fills) can still leave
                # |net_qty| a few dust units shy of zero; without the snap
                # the close branch below would open a phantom flip leg with
                # size ~dust whose entry_price is drawn from the very fill
                # that was supposed to close cleanly, producing zero-duration
                # positions whose opened_at == closed_at. See
                # .planning/audit-2026-05-07/INVEST-PATTERN-2-POSITIONS.md.
                flip_eps = max(total_entry_qty * FLIP_EPS_FACTOR, MIN_QTY_DUST)
                if abs(net_qty) < flip_eps:
                    net_qty = Decimal(0)
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
                closing_qty = min(qty, -net_qty) if net_qty < 0 else Decimal(0)
                net_qty += qty
                # Audit-2026-05-07 PATTERN-2 / P1100: see snap-to-zero note
                # above (the long-reducing branch). Same rationale applied
                # symmetrically when buys close a short.
                flip_eps = max(total_entry_qty * FLIP_EPS_FACTOR, MIN_QTY_DUST)
                if abs(net_qty) < flip_eps:
                    net_qty = Decimal(0)
        else:
            # Audit-2026-05-07 M-0715: `position_side` is annotated
            # `PositionSide | None` (Literal["long","short","flat"] | None),
            # and inside this branch `net_qty != 0` guarantees a non-None
            # position. The matcher never assigns `"flat"` (it is the
            # snapshot/exposure no-position marker only). A future hedge-mode
            # extension that introduces a new value would otherwise silently
            # fall through here, leaving `net_qty` unchanged and `closing_qty`
            # at 0 — booking the fill as a no-op and producing a phantom
            # always-open position. Fail loud (Rule 12) so the gap is visible
            # at the first bad fill, not in downstream KPI drift.
            raise AssertionError(
                f"unexpected position_side={position_side!r} "
                f"(strategy={strategy_id} symbol={symbol})"
            )

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
            # Audit-2026-05-07 M-0718: exact Decimal overshoot test. The dust
            # snap above already collapsed any proportional remainder to
            # Decimal(0), so a non-zero remainder here is a genuine flip leg.
            remainder = abs(net_qty)
            opening_qty = remainder if remainder > 0 else Decimal(0)
            opening_share = Decimal(0)
            if opening_qty > 0 and qty > 0 and fee > 0:
                opening_share = (opening_qty / qty) * fee
                # Subtract from the closed leg's fee total.
                total_fees -= opening_share

            # Audit-2026-05-07 H-0735/H-0740/M-0717: entry/exit VWAP and the
            # realized_pnl below are all Decimal — no float drift creeps in
            # between the fills and the funding combination in
            # `_attribute_funding`. Serialized to float at the output dict.
            entry_avg = (
                total_entry_cost / total_entry_qty
                if total_entry_qty > 0
                else Decimal(0)
            )
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
            roi = realized_pnl / notional if notional > 0 else Decimal(0)

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

            # Audit H-0812/M-0751: a zero, negative, or NON-FINITE (NaN/Inf)
            # average entry price is nonsensical input — exchange/parser
            # corruption. The roi=0 it would yield (notional<=0 → the
            # divide-by-zero guard returns 0) silently pollutes win_rate /
            # avg_roi / expectancy as if it were a real flat trade. DROP the
            # corrupt position (do not record it) and surface a strategy-level
            # `zero_entry_price_dropped` counter via `dropped_flags`, so the
            # corruption is not silent — the same drop-and-count pattern used
            # for `fills_dropped_no_symbol`. (review-5: the non-finite check
            # mirrors the H-0769 guard — `Inf <= 0` is False. entry_avg is
            # Decimal here, so use Decimal.is_finite() — `Decimal('NaN') <= 0`
            # RAISES InvalidOperation, unlike float NaN comparisons, so the
            # finiteness check MUST short-circuit before the `<= 0`.)
            if not entry_avg.is_finite() or entry_avg <= 0:
                if dropped_flags is not None:
                    dropped_flags["zero_entry_price_dropped"] = (
                        dropped_flags.get("zero_entry_price_dropped", 0) + 1
                    )
                logger.warning(
                    "Dropping zero-entry-price position (corrupt input) "
                    "strategy=%s symbol=%s side=%s exit_avg=%s size=%s",
                    strategy_id, symbol, position_side, exit_avg,
                    total_entry_qty,
                )
            else:
                # Audit-2026-05-07 H-0735/H-0740/M-0717: serialize the Decimal
                # money/quantity state to float at the OUTPUT boundary (same
                # form the RPC payload + TS frontend + equity_reconstruction
                # already consume — JSON cannot encode Decimal). The arithmetic
                # above stayed in Decimal so the running cost/qty sums and the
                # round-to-persisted-precision here are exact (no float drift
                # across thousands of fills); the realized_pnl and funding_pnl
                # halves are later combined in pandas float64 by the equity
                # reconstructor, by which point both are already float.
                position_dict: dict[str, Any] = {
                    "strategy_id": strategy_id,
                    "symbol": symbol,
                    "side": position_side,
                    "status": "closed",
                    "entry_price_avg": _round_float(entry_avg, 8),
                    "exit_price_avg": _round_float(exit_avg, 8),
                    "size_base": _round_float(total_entry_qty, 8),
                    "size_peak": _round_float(peak_qty, 8),
                    "realized_pnl": _round_float(realized_pnl, 4),
                    "fee_total": _round_float(total_fees, 4),
                    "roi": _round_float(roi, 6),
                    "duration_days": duration_days,
                    "duration_seconds": duration_seconds,
                    "opened_at": position_open_time,
                    "closed_at": close_time,
                    # P2 (LOW9): every touching fill (open + adds + partial
                    # reductions + this closing fill) is in fill_touch_count.
                    # The closing fill already incremented it at the top of the
                    # "existing position" block, so no `+ 1` is needed (the old
                    # `len(entry_fills) + 1` missed every partial reduction).
                    "fill_count": fill_touch_count,
                    # Default 0; _attribute_funding sums in-window funding_fees rows before insert.
                    "funding_pnl": 0,
                }
                if position_quality_flags:
                    position_dict["data_quality_flags"] = dict(position_quality_flags)
                positions.append(position_dict)

            # If overshot (net != 0), start a new position with remainder.
            # Audit-2026-05-07 M-0718: exact Decimal — the dust snap above
            # already zeroed any proportional residue, so `remainder > 0`
            # cleanly distinguishes a real flip from a clean close.
            if remainder > 0:
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
                # P2 (LOW9): the flip fill that just closed the prior leg ALSO
                # opens this new leg — it is the new leg's first (and so far
                # only) touching fill. Seed to 1 (not +=, the prior leg's count
                # was already consumed by its closed position_dict above).
                fill_touch_count = 1
                # Audit G12.C.3: seed the new leg with the prorated
                # opening share of the flip-fill's fee. The closed-leg
                # fee_total already had this subtracted above.
                total_fees = opening_share
                total_exit_cost = Decimal(0)
                total_exit_qty = Decimal(0)
                position_open_time = fill.get("timestamp")
                # Reset per-position quality flags for the new leg.
                position_quality_flags = {}
            else:
                net_qty = Decimal(0)
                total_entry_cost = Decimal(0)
                total_entry_qty = Decimal(0)
                peak_qty = Decimal(0)
                total_exit_cost = Decimal(0)
                total_exit_qty = Decimal(0)
                entry_fills = []
                # P2 (LOW9): clean close — no open position remains; reset.
                fill_touch_count = 0
                total_fees = Decimal(0)
                position_side = None
                position_open_time = None
                position_quality_flags = {}

    # Record any open position.
    # Audit-2026-05-07 M-0718: exact Decimal residual test (`> 0`) replaces
    # the float epsilon — the dust snap inside the loop already zeroed any
    # IEEE-754/proportional residue, so a surviving net_qty is a real open.
    if abs(net_qty) > 0 and position_side and total_entry_qty > 0:
        entry_avg = total_entry_cost / total_entry_qty
        # review-5: same corrupt-input guard as the closed path above. A zero /
        # negative / non-finite entry on an OPEN position would persist
        # entry_price_avg=0 and feed a fabricated unrealized_pnl (mark*qty) to
        # the equity reconstructor. Drop + count it instead of recording it.
        # (entry_avg is Decimal — is_finite() must short-circuit before
        # `<= 0`, which RAISES on Decimal('NaN').)
        if not entry_avg.is_finite() or entry_avg <= 0:
            if dropped_flags is not None:
                dropped_flags["zero_entry_price_dropped"] = (
                    dropped_flags.get("zero_entry_price_dropped", 0) + 1
                )
            logger.warning(
                "Dropping zero-entry-price OPEN position (corrupt input) "
                "strategy=%s symbol=%s side=%s size=%s",
                strategy_id, symbol, position_side, total_entry_qty,
            )
        else:
            # Audit-2026-05-07 M-0717: serialize Decimal → float at boundary.
            open_dict: dict[str, Any] = {
                "strategy_id": strategy_id,
                "symbol": symbol,
                "side": position_side,
                "status": "open",
                "entry_price_avg": _round_float(entry_avg, 8),
                "exit_price_avg": None,
                "size_base": _round_float(total_entry_qty, 8),
                "size_peak": _round_float(peak_qty, 8),
                "realized_pnl": None,
                "fee_total": _round_float(total_fees, 4),
                "roi": None,
                "duration_days": None,
                # Audit G12.C.9: also write duration_seconds (NULL while open).
                "duration_seconds": None,
                "opened_at": position_open_time,
                "closed_at": None,
                # P2 (LOW9): open position never had a closing fill, but its
                # partial reductions still touched it — count them all, not just
                # the opening/adding fills `entry_fills` held.
                "fill_count": fill_touch_count,
                # Default 0; _attribute_funding sums funding_fees rows up to now
                # for open positions (closed_at=None → window-end = now).
                "funding_pnl": 0,
            }
            if position_quality_flags:
                open_dict["data_quality_flags"] = dict(position_quality_flags)
            positions.append(open_dict)

    return positions


async def compute_exposure_metrics(
    strategy_id: str, supabase: Client
) -> ExposureMetrics:
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
    # the contamination case quickly. Failure to read strategies is
    # treated as "unknown" and we publish anyway (fail-open beats
    # silently zeroing out exposure for everyone), but Audit H-0738
    # adds an `exposure_metrics_apikey_lookup_failed` marker so the
    # three failure modes — no shared key (safe), shared key (skipped),
    # lookup failed (unknown) — stay discriminable to security reviewers.
    api_key_lookup_failed = False
    try:
        def _fetch_self() -> APIResponse:
            return (
                supabase.table("strategies")
                .select("api_key_id")
                .eq("id", strategy_id)
                .limit(1)
                .execute()
            )

        self_result = await db_execute(_fetch_self)
        self_rows = rows(self_result)
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
            def _fetch_siblings() -> APIResponse:
                return (
                    supabase.table("strategies")
                    .select("id")
                    .eq("api_key_id", api_key_id)
                    .execute()
                )

            sib_result = await db_execute(_fetch_siblings)
            sib_rows = rows(sib_result)
            if len(sib_rows) > 1:
                logger.warning(
                    "compute_exposure_metrics: api_key_id %s is shared by %d "
                    "strategies; refusing to compute exposure_metrics for %s "
                    "to avoid cross-strategy contamination",
                    api_key_id, len(sib_rows), strategy_id,
                )
                # Audit-2026-05-07 M-0713: the contamination short-circuit
                # drops `exposure_series` silently (the function's contract
                # promises one whenever exposure data was found). The
                # sibling-table writer (kind=exposure_series) needs an
                # explicit "series intentionally skipped" signal alongside
                # the existing scalar-aggregates skip flag — without it the
                # downstream consumer can't distinguish "no series produced
                # this run because we refused to compute" from "writer
                # silently lost the field".
                return {
                    "data_quality_flags": {
                        "exposure_metrics_skipped_shared_api_key": True,
                        "exposure_series_skipped_shared_api_key": True,
                    }
                }
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "compute_exposure_metrics: shared-key check failed for %s: %s",
                strategy_id, exc,
            )

    def _fetch_snapshots() -> APIResponse:
        return (
            supabase.table("position_snapshots")
            .select("snapshot_date, side, size_usd")
            .eq("strategy_id", strategy_id)
            .order("snapshot_date")
            .execute()
        )

    result = await db_execute(_fetch_snapshots)
    snapshots = rows(result)

    # Audit H-0738: collect data-quality markers in one place. The
    # apikey-lookup-failed marker is shared across the no-snapshots
    # and normal-return paths — without it, three failure modes
    # (no shared key → safe / shared key → skipped / lookup failed →
    # unknown) collapsed into a single output shape.
    dq_flags: dict[str, Any] = {}
    if api_key_lookup_failed:
        dq_flags["exposure_metrics_apikey_lookup_failed"] = True

    if not snapshots:
        # Audit H-0747: previously returned bare {} — VolumeExposureTab
        # rendered $0 across mean/std/max as if those were real
        # measurements. Surface an explicit "no snapshots" marker so
        # the dashboard shows "Position snapshots not yet collected"
        # rather than spurious zeros.
        dq_flags["exposure_metrics_no_snapshots"] = True
        return {"data_quality_flags": dq_flags}

    # Group by snapshot_date to compute per-date exposure
    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for snap in snapshots:
        by_date[snap.get("snapshot_date", "")].append(snap)

    gross_exposures: list[float] = []
    net_exposures: list[float] = []
    # METRICS-05: per-date exposure points for sibling-table persistence.
    # Audit H-0743: wire shape pinned by `ExposurePoint` TypedDict.
    exposure_series_records: list[ExposurePoint] = []

    for date_key, date_snaps in by_date.items():
        gross = 0.0
        net = 0.0
        for snap in date_snaps:
            size_usd = float(snap.get("size_usd", 0) or 0)
            # Audit-2026-05-27 H-0650: normalize via the shared boundary so the
            # snapshot side regime agrees with FIFO + volume + trade_mix.
            # Behavior-identical for current lowercase input.
            side = _normalize_side(snap.get("side"))
            gross += abs(size_usd)
            if side == "short":
                net -= abs(size_usd)
            else:
                net += abs(size_usd)
        # Aggregates (mean/std/max) see the full set — only the per-date
        # series persisted to JSONB is capped.
        gross_exposures.append(gross)
        net_exposures.append(net)
        if len(exposure_series_records) < _EXPOSURE_SERIES_CAP:
            exposure_series_records.append(ExposurePoint(
                date=str(date_key),
                gross=round(gross, 2),
                net=round(net, 2),
            ))

    mean_gross = statistics.mean(gross_exposures)
    std_gross = statistics.stdev(gross_exposures) if len(gross_exposures) > 1 else 0.0
    max_gross = max(gross_exposures)

    mean_net = statistics.mean(net_exposures)
    std_net = statistics.stdev(net_exposures) if len(net_exposures) > 1 else 0.0
    max_net = max(net_exposures, key=abs)

    out: ExposureMetrics = {
        "mean_gross_exposure": round(mean_gross, 2),
        "std_gross_exposure": round(std_gross, 2),
        "max_gross_exposure": round(max_gross, 2),
        "mean_net_exposure": round(mean_net, 2),
        "std_net_exposure": round(std_net, 2),
        "max_net_exposure": round(max_net, 2),
        "exposure_series": exposure_series_records,
    }
    # Audit H-0736: exposure_series truncated at cardinality cap.
    if len(by_date) > _EXPOSURE_SERIES_CAP:
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
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
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
                      'turnover_missing_price_dates': dates where a symbol
                        with a non-zero position delta had no price in
                        prices_by_date — its contribution was silently
                        treated as $0, UNDER-stating that day's turnover
                        (Audit-2026-05-07 M-0711). The math still runs (the
                        row is emitted) but the flag makes the price-feed
                        gap explicit instead of indistinguishable from a
                        genuinely low-turnover day.

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
    flags: dict[str, Any] = {}
    if not positions_by_date:
        return [], flags
    dates = sorted(positions_by_date.keys())
    series: list[dict[str, Any]] = []
    prev_positions: dict[str, float] | None = None
    prev_date: datetime | None = None
    gap_dates: list[str] = []
    nav_missing_dates: list[str] = []
    nav_invalid_dates: list[str] = []
    # Audit-2026-05-07 M-0711: dates where a symbol with a non-zero position
    # delta had no price — its turnover contribution was silently zeroed,
    # under-stating the day. Recorded once per date (deduped) so the flag
    # counts affected DATES, consistent with the other turnover flag lists.
    missing_price_dates: list[str] = []
    # Audit H-0741: rows the type-validation guard dropped (non-dict
    # positions / prices payload, or scalar values that can't coerce
    # to float). Pre-fix the entire date was silently dropped mid-loop
    # if Decimal/str slipped in from Supabase — no signal reached the
    # consumer. Surfaced now so dashboards can report
    # "turnover unavailable due to data-type drift".
    dropped_dates: list[str] = []
    for date in dates:
        # Audit H-0741: coerce the per-date payload to plain
        # dict[str, float] (rejecting NaN/Inf and non-numeric values)
        # BEFORE the math runs. Pre-fix a Decimal payload would silently
        # propagate via `round(..., 6) → Decimal` into JSONB, and a None
        # row would raise AttributeError mid-loop. On failure, record
        # the date in dropped_dates and continue without advancing
        # prev_positions — the next valid date then measures delta
        # against the last known-good snapshot.
        try:
            positions_raw = positions_by_date.get(date, {})
            prices_raw = prices_by_date.get(date, {})
            if positions_raw is None or prices_raw is None:
                raise TypeError("positions/prices row is None")
            positions: dict[str, float] = {
                str(sym): _coerce_finite_float(qty, f"position[{sym!r}]")
                for sym, qty in positions_raw.items()
            }
            prices: dict[str, float] = {
                str(sym): _coerce_finite_float(p, f"price[{sym!r}]")
                for sym, p in prices_raw.items()
            }
        except (AttributeError, TypeError, ValueError) as exc:
            logger.warning(
                "compute_turnover_series: skipping date=%r due to "
                "type-coercion failure: %s",
                date, exc,
            )
            dropped_dates.append(date)
            continue

        # Audit H-0744: explicit presence check — distinguishes 'NAV
        # not yet ingested' (key absent) from 'NAV present but bad'
        # (key present, value <= 0). The pre-fix `.get(date, 0.0)`
        # collapsed both into a turnover=0 short-circuit.
        nav_present = date in nav_by_date
        if nav_present:
            try:
                nav = _coerce_finite_float(nav_by_date[date], "NAV")
            except (TypeError, ValueError) as exc:
                logger.warning(
                    "compute_turnover_series: skipping date=%r — NAV "
                    "value %r not numeric: %s",
                    date, nav_by_date.get(date), exc,
                )
                dropped_dates.append(date)
                continue
        else:
            nav = 0.0

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
        date_has_missing_price = False
        for sym in symbols:
            delta = positions.get(sym, 0.0) - prev_positions.get(sym, 0.0)
            # Audit-2026-05-07 M-0711: a symbol absent from `prices` defaults
            # to 0.0, contributing $0 to turnover. When that symbol ALSO moved
            # (delta != 0) the day's turnover is silently UNDER-stated — a
            # price-feed gap indistinguishable from a quiet day. Flag the date
            # (the math still runs so consumers can decide to drop/smooth it).
            # A delta of 0 needs no price, so a missing price there is benign
            # and not flagged.
            if sym not in prices:
                if delta != 0.0:
                    date_has_missing_price = True
                price = 0.0
            else:
                price = prices[sym]
            total_change_usd += abs(delta * price)
        if date_has_missing_price:
            missing_price_dates.append(date)
        series.append({"date": date, "turnover": round(total_change_usd / nav, 6)})
        prev_positions = positions
        if current_date_parsed is not None:
            prev_date = current_date_parsed

    # Red-team pass: cap each flag list at _FLAG_LIST_CAP so a grid
    # flood can't bloat the strategy_analytics.data_quality_flags JSONB.
    # Truncation surfaces as sibling counter keys via
    # `_emit_capped_flag_list`.
    _emit_capped_flag_list(flags, "turnover_nav_missing_dates", nav_missing_dates)
    _emit_capped_flag_list(flags, "turnover_nav_invalid_dates", nav_invalid_dates)
    _emit_capped_flag_list(flags, "turnover_gap_dates", gap_dates)
    _emit_capped_flag_list(flags, "turnover_series_dropped_dates", dropped_dates)
    # Audit-2026-05-07 M-0711: surface under-counted-turnover dates (missing
    # price for a moved symbol). Same capped-list convention as the siblings.
    _emit_capped_flag_list(flags, "turnover_missing_price_dates", missing_price_dates)
    return series, flags


def _compute_turnover_series(
    positions_by_date: dict[str, dict[str, float]],
    prices_by_date: dict[str, dict[str, float]],
    nav_by_date: dict[str, float],
) -> list[dict[str, Any]]:
    """Backwards-compatible wrapper around `compute_turnover_series_with_flags`.

    Returns only the series and discards the data quality flags — preserves
    the pre-existing call-site shape used by tests/fixtures/regen_golden.py.
    Production callers (analytics_runner) use
    `compute_turnover_series_with_flags` directly.

    Audit-2026-05-07 H-0739: renamed from `compute_turnover_series` →
    `_compute_turnover_series`. This is a CONVENTION-ONLY change with NO
    security delta — the public `compute_turnover_series_with_flags` has
    the same plain-dicts signature with the same lack of strategy_id /
    allocator identity, so the underscore alone cannot defend against an
    attacker-shaped grid the way the original H-0739 audit framing
    implied. The honest benefit is narrower: it signals to future readers
    that the only legitimate callers are the in-package test/regen
    fixtures, so a new production caller MUST switch to the public
    `compute_turnover_series_with_flags` and pick up the data-quality
    flags it returns. Genuinely closing H-0739's info-disclosure surface
    requires an allocator-identity-aware wrapper at the call-site (cross-
    file, deferred to the dedicated H-0737 batch).
    """
    series, _flags = compute_turnover_series_with_flags(
        positions_by_date, prices_by_date, nav_by_date
    )
    return series
