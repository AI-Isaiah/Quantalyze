"""Shared strategy analytics runner.

The HTTP endpoint (routers/analytics.py::compute_analytics) and the
compute_jobs worker handler (services/job_worker.py::run_compute_analytics_job)
both need to run the same "load trades → compute metrics → upsert
strategy_analytics" sequence. Before Sprint 3 they would have duplicated
the logic; this helper exists so both callers share one implementation.

Contract
--------
async def run_strategy_analytics(strategy_id: str) -> dict

Returns a {status, strategy_id} payload on success. Raises HTTPException
on recoverable failures (missing strategy, insufficient history) so the
HTTP endpoint's FastAPI layer surfaces them as 4xx/5xx. The worker
dispatcher catches the exception and maps it through classify_exception
into (error_kind, sanitized_message) for compute_jobs.

Side effects
------------
1. On entry, upserts strategy_analytics.computation_status = 'computing'.
2. On success, upserts computation_status = 'complete' + full metrics.
3. On failure, upserts computation_status = 'failed' + sanitized error.

Note
----
The worker-side UI status bridge (sync_strategy_analytics_status via the
038 RPC) runs AFTER the job finishes, inside job_worker.dispatch. The
bridge's mapping considers the compute_jobs aggregate, so if this helper
landed 'complete' but a sibling sync_trades job is still running, the
bridge will rewrite computation_status back to 'computing' before the
caller sees the row. That's the intended interaction — Finding 2-C says
the UI surface reflects the queue, not the individual handler.
"""
from __future__ import annotations

import logging
import math
import os
from collections import defaultdict

from fastapi import HTTPException

from services.benchmark import get_benchmark_returns
from services.db import db_execute, get_supabase
from services.metrics import compute_all_metrics
from services.transforms import trades_to_daily_returns

logger = logging.getLogger("quantalyze.analytics.runner")


async def _load_position_time_series(
    strategy_id: str,
    supabase,
    account_balance: float | None,
) -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]], dict[str, float]]:
    """H-A1: derive (positions_by_date, prices_by_date, nav_by_date) from
    `position_snapshots`.

    `position_snapshots.mark_price` is the SINGLE canonical price source per
    migration 034 — every snapshot row carries BOTH `size_usd` AND `mark_price`,
    so one query produces the position grid AND the price grid. The codebase
    has NO `historical_prices` table (verified pre-execution per H-A1 — the
    phantom table from REVIEWS does not exist).

    Outputs feed `compute_turnover_series(positions_by_date, prices_by_date,
    nav_by_date)` (Plan 12-04) — empty inputs return [] gracefully so a
    snapshot-less strategy degrades to an empty turnover series rather than
    a runtime error.

    Args:
        strategy_id: UUID string of the strategy.
        supabase: PostgREST client (service-role).
        account_balance: optional USD account balance from `api_keys`. When
            present, NAV per date = account_balance + cumulative_realized_pnl.
            When None, falls back to gross-exposure proxy
            (sum(abs(positions[d].values()))) — turnover formula
            `Σ(|Δposition × price|) / nav` is self-consistent under any
            non-zero monotonic NAV proxy.

    Returns:
        positions_by_date: { 'YYYY-MM-DD': { symbol: signed_size_usd } }
        prices_by_date:    { 'YYYY-MM-DD': { symbol: mark_price } }
        nav_by_date:       { 'YYYY-MM-DD': nav_usd }

    Empty dicts on missing snapshots — caller treats as graceful degradation.
    """
    def _fetch_snapshots():
        return (
            supabase.table("position_snapshots")
            .select("snapshot_date, symbol, side, size_usd, mark_price")
            .eq("strategy_id", strategy_id)
            .order("snapshot_date")
            .execute()
        )

    snaps_result = await db_execute(_fetch_snapshots)
    snapshots = (snaps_result.data if snaps_result else None) or []
    if not snapshots:
        return {}, {}, {}

    positions_by_date: dict[str, dict[str, float]] = {}
    prices_by_date: dict[str, dict[str, float]] = {}

    for snap in snapshots:
        d = snap.get("snapshot_date")
        sym = snap.get("symbol")
        side = (snap.get("side") or "").lower()
        size_raw = snap.get("size_usd")
        mark_raw = snap.get("mark_price")
        if not d or not sym:
            continue
        try:
            size_usd = float(size_raw) if size_raw is not None else 0.0
        except (TypeError, ValueError):
            size_usd = 0.0
        # Skip flat or zero-size rows (per migration 034 comment they're
        # usually not stored, but defensive).
        if side == "flat" or size_usd == 0.0:
            continue
        signed = size_usd if side == "long" else -size_usd
        positions_by_date.setdefault(d, {})[sym] = signed
        if mark_raw is not None:
            try:
                prices_by_date.setdefault(d, {})[sym] = float(mark_raw)
            except (TypeError, ValueError):
                # Don't poison prices_by_date with NaN/non-numeric marks.
                pass

    # Build nav_by_date. With account_balance present, NAV is a constant
    # (account-level scaling); turnover formula divides by NAV, so a
    # constant non-zero NAV produces a self-consistent series. Without
    # account_balance, use sum(abs(positions)) as a NAV proxy (gross
    # exposure) — also self-consistent for the turnover ratio.
    nav_by_date: dict[str, float] = {}
    if account_balance is not None and account_balance > 0:
        for d in positions_by_date:
            nav_by_date[d] = float(account_balance)
    else:
        for d, pos_map in positions_by_date.items():
            nav_by_date[d] = sum(abs(v) for v in pos_map.values())

    return positions_by_date, prices_by_date, nav_by_date


def _compute_volume_metrics(fills: list[dict]) -> dict:
    """Compute volume metrics from raw fill data.

    fills: list of dicts with 'side' and 'cost' keys.
    """
    total_cost = 0.0
    buy_cost = 0.0
    sell_cost = 0.0

    for fill in fills:
        cost = float(fill.get("cost", 0) or 0)
        side = (fill.get("side") or "").lower()
        total_cost += cost
        if side == "buy":
            buy_cost += cost
        elif side == "sell":
            sell_cost += cost

    buy_pct = buy_cost / total_cost if total_cost > 0 else 0.0
    sell_pct = sell_cost / total_cost if total_cost > 0 else 0.0

    return {
        "buy_volume_pct": round(buy_pct, 4),
        "sell_volume_pct": round(sell_pct, 4),
        "long_volume_pct": round(buy_pct, 4),  # approximation from fill sides
        "short_volume_pct": round(sell_pct, 4),
        "total_fills": len(fills),
        "total_volume_usd": round(total_cost, 2),
    }


def _compute_derived_trade_metrics(
    volume_metrics: dict,
    trade_metrics_from_positions: dict,
) -> dict:
    """B-01 path (b): compute the 6 derived trade metrics from BOTH the
    volume-side dict (`_compute_volume_metrics(fills)` output) AND the
    position-side dict (`reconstruct_positions(strategy_id, supabase)` output).

    Returns a dict with keys:
      expectancy, risk_reward_ratio, weighted_risk_reward_ratio, sqn,
      profit_factor_long, profit_factor_short.

    Why a separate function (not extension of _compute_volume_metrics):
      - `_compute_volume_metrics` only sees raw fills (`select side, cost`); it
        has no access to win_rate / avg_winning_trade / avg_losing_trade /
        per-trade realized PnL.
      - `reconstruct_positions` produces all of those at the position level
        (Plan 12-05 extends it with avg_winning_trade / avg_losing_trade /
        winners_count / losers_count / realized_pnl_per_trade).
      - Per B-01 from 12-REVIEWS.md, mixing fill-level and position-level math
        inside the same function silently defaults all derived metrics to None.

    Formula (Weighted R:R per H-F / METRICS-07):
      Σ(win_size × win_count) / Σ(loss_size × loss_count)
    Implemented as (avg_winning_trade × winners_count) / (|avg_losing_trade| × losers_count).
    Documented here as the canonical Phase 12 formula; if quantstats reference
    defines a different canonical form, update this docstring + regen golden
    fixture.

    Threat T-12-05-03 mitigation: every divisor is guarded with `> 0`; pure
    zero-loss / zero-divisor cases yield None (rendered downstream as "—") to
    avoid +Infinity propagating into JSONB and breaking the parity gate.
    """
    # `volume_metrics` is currently only consumed for plumbing/compatibility
    # — kept in the signature so Plan 12-06 orchestrator wiring matches the
    # B-01 path-(b) contract literally.
    _ = volume_metrics

    # Position-side primitives (B-01 path (b) extended reconstruct_positions output)
    win_rate = float(trade_metrics_from_positions.get("win_rate") or 0.0)
    avg_win = float(trade_metrics_from_positions.get("avg_winning_trade") or 0.0)
    avg_loss = float(trade_metrics_from_positions.get("avg_losing_trade") or 0.0)
    winners_count = int(trade_metrics_from_positions.get("winners_count") or 0)
    losers_count = int(trade_metrics_from_positions.get("losers_count") or 0)
    per_trade = trade_metrics_from_positions.get("realized_pnl_per_trade") or []

    out: dict = {
        "expectancy": None,
        "risk_reward_ratio": None,
        "weighted_risk_reward_ratio": None,
        "sqn": None,
        "profit_factor_long": None,
        "profit_factor_short": None,
    }

    # Expectancy: only meaningful when at least one of avg_win / avg_loss is
    # non-zero. All-zero position book → keep expectancy=None per the empty
    # test's contract.
    if avg_win or avg_loss:
        out["expectancy"] = win_rate * avg_win - (1 - win_rate) * abs(avg_loss)

    # Risk:Reward Ratio
    if avg_loss != 0:
        out["risk_reward_ratio"] = avg_win / abs(avg_loss)

    # H-F / METRICS-07: Weighted R:R = (avg_win × winners_count) /
    # (|avg_loss| × losers_count). Guards against zero divisor (no losers, or
    # zero |avg_loss|).
    num = avg_win * winners_count
    den = abs(avg_loss) * losers_count
    if den > 0:
        out["weighted_risk_reward_ratio"] = num / den

    # METRICS-08: SQN over per-trade R-multiples (R = realized_pnl / risk_unit).
    # risk_unit derived from |avg_loss| (the canonical Van Tharp denominator).
    risk_unit = abs(avg_loss) if avg_loss else 0.0
    if risk_unit > 0 and per_trade:
        r_multiples = [
            (t.get("realized_pnl") or 0.0) / risk_unit
            for t in per_trade
            if t.get("realized_pnl") is not None
        ]
        if len(r_multiples) >= 2:
            mean_r = sum(r_multiples) / len(r_multiples)
            var_r = sum((r - mean_r) ** 2 for r in r_multiples) / (
                len(r_multiples) - 1
            )
            std_r = math.sqrt(var_r) if var_r > 0 else 0.0
            if std_r > 0:
                out["sqn"] = (mean_r / std_r) * math.sqrt(
                    min(len(r_multiples), 100)
                )

    # Profit Factor segmented by side — uses position-side realized_pnl_per_trade
    long_pnls = [
        float(t.get("realized_pnl") or 0.0)
        for t in per_trade
        if t.get("side") == "long"
    ]
    short_pnls = [
        float(t.get("realized_pnl") or 0.0)
        for t in per_trade
        if t.get("side") == "short"
    ]

    def _profit_factor(pnls: list[float]) -> float | None:
        gp = sum(p for p in pnls if p > 0)
        gl = abs(sum(p for p in pnls if p < 0))
        if gl == 0:
            # Avoid +Infinity; downstream renders as "—" (T-12-05-03).
            return None
        return gp / gl

    out["profit_factor_long"] = _profit_factor(long_pnls)
    out["profit_factor_short"] = _profit_factor(short_pnls)

    return out


def _compute_volume_aggregator(fills: list[dict]) -> dict[str, float]:
    """METRICS-09: aggregate volume metrics over fills (raw_fills WHERE is_fill=true).

    Returns:
      gross_volume_usd     — sum of |notional_usd| over every fill
      mean_trade_size_usd  — gross_volume / N
      daily_turnover_usd   — mean of per-day notional totals (group by date prefix)
      monthly_turnover_usd — mean of per-month notional totals (group by YYYY-MM prefix)

    Pure function: groups by `filled_at` (or `created_at` fallback) date prefix.
    Skips fills with malformed/missing timestamps for daily/monthly bucketing
    but keeps them in gross_volume + mean_trade_size aggregates.
    """
    if not fills:
        return {
            "gross_volume_usd": 0.0,
            "mean_trade_size_usd": 0.0,
            "daily_turnover_usd": 0.0,
            "monthly_turnover_usd": 0.0,
        }

    notionals = [abs(float(f.get("notional_usd", 0.0) or 0.0)) for f in fills]
    gross_volume = sum(notionals)
    mean_size = gross_volume / len(notionals) if notionals else 0.0

    # Daily / monthly turnover — group by date / month prefix, then mean
    daily: dict[str, float] = defaultdict(float)
    monthly: dict[str, float] = defaultdict(float)
    for f in fills:
        ts = f.get("filled_at") or f.get("created_at") or ""
        if not ts or len(ts) < 10:
            continue
        day = ts[:10]
        month = ts[:7]
        notional = abs(float(f.get("notional_usd", 0.0) or 0.0))
        daily[day] += notional
        monthly[month] += notional
    daily_avg = sum(daily.values()) / len(daily) if daily else 0.0
    monthly_avg = sum(monthly.values()) / len(monthly) if monthly else 0.0

    return {
        "gross_volume_usd": gross_volume,
        "mean_trade_size_usd": mean_size,
        "daily_turnover_usd": daily_avg,
        "monthly_turnover_usd": monthly_avg,
    }


def _compute_trade_mix(
    fills: list[dict], has_maker_taker: bool
) -> dict[str, dict[str, float]]:
    """METRICS-10: Trade Mix breakdown by side × maker/taker.

    D-14 / D-15: bucket count branches off the is_maker audit outcome.
      - has_maker_taker=True  → 4 buckets (long_maker, long_taker, short_maker, short_taker)
      - has_maker_taker=False → 2 buckets fallback (long, short)

    Each bucket: {count, total_notional, avg_holding_period_hours}.

    T-12-05-04: in 4-bucket mode, fills with `is_maker` missing/None are
    skipped (cannot bucket without the flag). The audit gate (Plan 12-01)
    only sets `has_maker_taker=True` when ≥99% of fills carry the flag, so
    skipped fills represent a known small fraction.

    Plan 12-06 reads `TRADE_MIX_HAS_MAKER_TAKER` from env (set by the deploy
    script per M-01) to decide which mode to call this in.
    """

    def _empty_bucket() -> dict[str, float]:
        return {
            "count": 0,
            "total_notional": 0.0,
            "avg_holding_period_hours": 0.0,
        }

    if has_maker_taker:
        buckets: dict[str, dict[str, float]] = {
            "long_maker": _empty_bucket(),
            "long_taker": _empty_bucket(),
            "short_maker": _empty_bucket(),
            "short_taker": _empty_bucket(),
        }
    else:
        buckets = {
            "long": _empty_bucket(),
            "short": _empty_bucket(),
        }

    holding_sums: dict[str, float] = {k: 0.0 for k in buckets}
    for f in fills:
        side = f.get("side")
        if side not in ("long", "short"):
            continue
        notional = abs(float(f.get("notional_usd", 0.0) or 0.0))
        holding = float(f.get("holding_period_hours") or 0.0)

        if has_maker_taker:
            is_maker = f.get("is_maker")
            if is_maker is None:
                # T-12-05-04: skip — can't bucket without the flag
                continue
            maker_key = "maker" if is_maker else "taker"
            bucket_key = f"{side}_{maker_key}"
        else:
            bucket_key = side

        buckets[bucket_key]["count"] += 1
        buckets[bucket_key]["total_notional"] += notional
        holding_sums[bucket_key] += holding

    # Finalize avg holding period
    for k, b in buckets.items():
        if b["count"] > 0:
            b["avg_holding_period_hours"] = holding_sums[k] / b["count"]

    return buckets


async def run_strategy_analytics(strategy_id: str) -> dict:
    """Run the full analytics pipeline for a single strategy.

    See module docstring for contract and side effects.
    """
    supabase = get_supabase()

    # Verify strategy exists
    strategy_result = await db_execute(
        lambda: supabase.table("strategies")
        .select("id, user_id, api_key_id")
        .eq("id", strategy_id)
        .single()
        .execute()
    )

    if not strategy_result.data:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Update status to computing. The worker-side bridge (038 RPC) may
    # overwrite this soon after if the strategy has multiple concurrent
    # jobs, which is fine — the aggregate mapping is the source of truth.
    await db_execute(
        lambda: supabase.table("strategy_analytics").upsert(
            {"strategy_id": strategy_id, "computation_status": "computing"},
            on_conflict="strategy_id",
        ).execute()
    )

    try:
        # Fetch trades (exclude raw fills to avoid double-counting)
        result = await db_execute(
            lambda: supabase.table("trades")
            .select("*")
            .eq("strategy_id", strategy_id)
            .neq("is_fill", True)
            .order("timestamp")
            .execute()
        )

        trades = result.data
        if not trades or len(trades) < 2:
            await db_execute(
                lambda: supabase.table("strategy_analytics").upsert(
                    {
                        "strategy_id": strategy_id,
                        "computation_status": "failed",
                        "computation_error": "Insufficient trade history. At least 2 trading days required.",
                    },
                    on_conflict="strategy_id",
                ).execute()
            )
            raise HTTPException(status_code=400, detail="Insufficient trade history")

        # Fetch account balance for accurate capital estimation.
        # Link: strategies.api_key_id -> api_keys.id (api_keys has no
        # strategy_id column).
        account_balance = None
        try:
            api_key_id = (
                strategy_result.data.get("api_key_id")
                if strategy_result.data
                else None
            )
            if api_key_id:
                key_result = await db_execute(
                    lambda kid=api_key_id: supabase.table("api_keys")
                    .select("account_balance_usdt")
                    .eq("id", kid)
                    .single()
                    .execute()
                )
                if key_result.data and key_result.data.get("account_balance_usdt"):
                    account_balance = float(
                        key_result.data["account_balance_usdt"]
                    )
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "Could not fetch account balance for %s: %s", strategy_id, str(e)
            )

        # Transform trades to daily returns
        returns = trades_to_daily_returns(
            trades, account_balance=account_balance
        )

        if len(returns) < 2:
            await db_execute(
                lambda: supabase.table("strategy_analytics").upsert(
                    {
                        "strategy_id": strategy_id,
                        "computation_status": "failed",
                        "computation_error": "Insufficient trading days after aggregation.",
                    },
                    on_conflict="strategy_id",
                ).execute()
            )
            raise HTTPException(status_code=400, detail="Insufficient trading days")

        # Fetch benchmark returns for BTC overlay
        benchmark_stale = False
        try:
            benchmark_rets, benchmark_stale = await get_benchmark_returns("BTC")
        except Exception as e:  # noqa: BLE001
            logger.warning("Benchmark fetch failed: %s", str(e))
            benchmark_rets = None
            benchmark_stale = True

        # B-01 (path b): hoist position reconstruction BEFORE compute_all_metrics
        # so derived metrics see avg_winning_trade / avg_losing_trade /
        # winners_count / losers_count / realized_pnl_per_trade. Wrapped in a
        # local try so position-side failures do NOT block the qstats half;
        # they degrade gracefully via data_quality_flags.position_metrics_failed.
        from services.position_reconstruction import (
            reconstruct_positions,
            compute_exposure_metrics,
            compute_turnover_series,
        )

        trade_metrics_from_positions: dict = {}
        exposure_metrics: dict = {}
        positions_by_date: dict[str, dict[str, float]] = {}
        prices_by_date: dict[str, dict[str, float]] = {}
        nav_by_date: dict[str, float] = {}
        # WR-03: split into two failure surfaces so operators can distinguish
        # "FIFO matching from raw fills failed" (positions table writes blocked)
        # from "snapshot read for turnover/exposure_series failed" (raw_fills
        # FIFO is fine, but exposure/turnover series can't be derived).
        position_reconstruction_error: str | None = None
        position_snapshots_error: str | None = None
        try:
            trade_metrics_from_positions = (
                await reconstruct_positions(strategy_id, supabase) or {}
            )
            exposure_metrics = (
                await compute_exposure_metrics(strategy_id, supabase) or {}
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Position reconstruction failed for %s: %s", strategy_id, str(exc)
            )
            position_reconstruction_error = str(exc)[:200]

        # H-A1: position_snapshots is the canonical source for
        # positions+prices+NAV (no historical_prices table exists per
        # migration 034). One query produces both grids; turnover
        # formula consumes them. WR-03: separate try so a snapshot RLS
        # regression does not get misclassified as a FIFO reconstruction
        # failure (and vice versa).
        try:
            (
                positions_by_date,
                prices_by_date,
                nav_by_date,
            ) = await _load_position_time_series(
                strategy_id, supabase, account_balance
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Position snapshots load failed for %s: %s", strategy_id, str(exc)
            )
            position_snapshots_error = str(exc)[:200]

        # B-01: fetch fills once, feed both volume helpers + trade_mix.
        # `cost` is needed by _compute_volume_metrics; `notional_usd`,
        # `is_maker`, `holding_period_hours`, `filled_at`, `side` are needed by
        # _compute_volume_aggregator + _compute_trade_mix (per migration 039
        # column shape). Selecting columns explicitly to keep payload bounded.
        fills_data: list[dict] = []
        try:
            fills_result = await db_execute(
                lambda: supabase.table("trades")
                .select(
                    "side, cost, is_maker, notional_usd, "
                    "holding_period_hours, filled_at, created_at"
                )
                .eq("strategy_id", strategy_id)
                .eq("is_fill", True)
                .execute()
            )
            fills_data = fills_result.data if fills_result else []
            fills_data = fills_data or []
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Fills fetch failed for %s: %s", strategy_id, str(exc)
            )
            fills_data = []

        # B-01 path (b) merge: volume_metrics + volume_aggregator + derived +
        # trade_mix all flow into the trade_metrics JSONB before the upsert.
        volume_metrics = _compute_volume_metrics(fills_data) if fills_data else {}
        volume_aggregator = (
            _compute_volume_aggregator(fills_data) if fills_data else {}
        )
        derived = _compute_derived_trade_metrics(
            volume_metrics, trade_metrics_from_positions
        )
        # M-01: TRADE_MIX_HAS_MAKER_TAKER comes from CI / .env.test; deploy
        # script (Plan 12-10) writes it. False today (D-15 audit fail);
        # 4-bucket reachable via flag flip in v0.17.1.
        has_maker_taker = (
            os.getenv("TRADE_MIX_HAS_MAKER_TAKER", "false").lower() == "true"
        )
        trade_mix = _compute_trade_mix(fills_data, has_maker_taker=has_maker_taker)

        merged_trade_metrics = {
            **(trade_metrics_from_positions or {}),
            **volume_metrics,
            **volume_aggregator,
            **derived,
            "trade_mix": trade_mix,
        }

        # H-A1: turnover_series from position_snapshots-derived grids.
        turnover_series = compute_turnover_series(
            positions_by_date, prices_by_date, nav_by_date
        )

        # METRICS-11/12: compute_all_metrics returns MetricsResult dataclass.
        metrics_result = compute_all_metrics(returns, benchmark_rets)

        # H-A1: pop exposure_series from exposure_metrics (so it lands in the
        # sibling table, not in the strategy_analytics.exposure_metrics column).
        # exposure_metrics may be {} when position reconstruction failed —
        # `.pop(key, default)` is the safe accessor.
        exposure_series_payload = (
            exposure_metrics.pop("exposure_series", None)
            if isinstance(exposure_metrics, dict)
            else None
        )
        if exposure_series_payload:
            metrics_result.sibling_kinds["exposure_series"] = (
                exposure_series_payload
            )
        if turnover_series:
            metrics_result.sibling_kinds["turnover_series"] = turnover_series

        # Build data quality flags (combine benchmark + position-side failures).
        data_quality_flags: dict | None = None
        if benchmark_stale or benchmark_rets is None:
            data_quality_flags = {
                "benchmark_unavailable": True,
                "benchmark_note": "Benchmark data unavailable. Alpha, beta, and correlation not computed.",
            }
        # WR-03: emit distinct keys per failure surface, keep legacy
        # `position_metrics_failed` / `position_metrics_error` aggregate set
        # for backward compatibility with the admin compute-jobs page,
        # PositionsTab/VolumeExposureTab consumers, and existing tests.
        if (
            position_reconstruction_error is not None
            or position_snapshots_error is not None
        ):
            data_quality_flags = data_quality_flags or {}
            # Distinct, surface-specific flags (new — operators read these
            # to differentiate "FIFO from fills failed" vs
            # "snapshot grids unavailable").
            if position_reconstruction_error is not None:
                data_quality_flags["position_reconstruction_failed"] = True
                data_quality_flags["position_reconstruction_error"] = (
                    position_reconstruction_error
                )
            if position_snapshots_error is not None:
                data_quality_flags["position_snapshots_unavailable"] = True
                data_quality_flags["position_snapshots_error"] = (
                    position_snapshots_error
                )
            # Legacy aggregate (preserved): UI/admin consumers read this as
            # a single "anything position-side failed" boolean. The error
            # string concatenates surface labels so the legacy reader still
            # gets unambiguous diagnostic context.
            data_quality_flags["position_metrics_failed"] = True
            legacy_parts: list[str] = []
            if position_reconstruction_error is not None:
                legacy_parts.append(
                    f"reconstruction: {position_reconstruction_error}"
                )
            if position_snapshots_error is not None:
                legacy_parts.append(
                    f"snapshots: {position_snapshots_error}"
                )
            data_quality_flags["position_metrics_error"] = "; ".join(legacy_parts)

        # B-01: single strategy_analytics upsert spreads metrics_result.metrics_json
        # AND attaches the merged trade_metrics + volume_aggregator + exposure
        # aggregates (without exposure_series, which moved to sibling_kinds).
        await db_execute(
            lambda: supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "complete",
                    "computation_error": None,
                    "data_quality_flags": data_quality_flags,
                    **metrics_result.metrics_json,
                    "trade_metrics": merged_trade_metrics,
                    "volume_metrics": volume_aggregator,
                    "exposure_metrics": exposure_metrics,
                },
                on_conflict="strategy_id",
            ).execute()
        )

        # M-Grok-1: atomic batch sibling-table upsert via SECURITY DEFINER RPC.
        # Replaces the legacy per-kind ON CONFLICT loop (no surrounding
        # transaction; partial failure could leave the strategy in an
        # inconsistent state). The RPC's implicit transaction makes the whole
        # batch atomic. See migration 087 / Plan 12-02.
        if metrics_result.sibling_kinds:
            try:
                await db_execute(
                    lambda: supabase.rpc(
                        "upsert_strategy_analytics_series_batch",
                        {
                            "p_strategy_id": strategy_id,
                            "p_kinds": metrics_result.sibling_kinds,
                        },
                    ).execute()
                )
            except Exception as exc:  # noqa: BLE001
                # Sibling-table failure is non-fatal — the above-the-fold
                # scalars in strategy_analytics are still valid; only panels
                # 4–7 (lazy-fetched) lose their series. Flag and continue.
                logger.warning(
                    "Sibling-table batch upsert failed for %s: %s",
                    strategy_id,
                    str(exc),
                )
                try:
                    existing = data_quality_flags or {}
                    existing["sibling_kinds_failed"] = True
                    existing["sibling_kinds_error"] = str(exc)[:200]
                    await db_execute(
                        lambda: supabase.table("strategy_analytics")
                        .upsert(
                            {
                                "strategy_id": strategy_id,
                                "data_quality_flags": existing,
                            },
                            on_conflict="strategy_id",
                        )
                        .execute()
                    )
                except Exception:
                    pass

        return {"status": "complete", "strategy_id": strategy_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Compute analytics failed for %s: %s", strategy_id, str(e)
        )
        await db_execute(
            lambda: supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "failed",
                    "computation_error": "Analytics computation failed. Contact support if this persists.",
                },
                on_conflict="strategy_id",
            ).execute()
        )
        raise HTTPException(status_code=500, detail="Analytics computation failed")
