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
from datetime import datetime

from fastapi import HTTPException

from services.benchmark import get_benchmark_returns
from services.db import (
    PaginatedSelectTruncated,
    db_execute,
    get_supabase,
    paginated_select,
)
from services.metrics import _safe_float, compute_all_metrics
from services.transforms import trades_to_daily_returns_with_status

logger = logging.getLogger("quantalyze.analytics.runner")


# ---------------------------------------------------------------------------
# Tunable numeric constants (audit-2026-05-07 / H-0644/H-0654, H-0645/H-0653,
# H-0652). Lifted from inline literals so the rationale is named once.
# ---------------------------------------------------------------------------

# A NUMERIC residual returned by PostgREST (e.g. 1e-15 from a partial-fill
# close) must not be treated as a real position. Tolerance sits below any
# meaningful dollar amount. See H-0644 / H-0654.
POSITION_SIZE_ZERO_TOLERANCE_USD = 1e-9

# `win_rate` is documented as a fraction in [0,1] but the producer
# (`reconstruct_positions`) is an unenforced cross-module contract — values
# clearly outside that range (e.g. 60.0 == 60%) get rescaled. The threshold
# is > 1.5 (not > 1.0) so a 1.0001 ULP drift from `winners/total` at 100%
# winners stays fractional instead of being misclassified as a percent. See
# H-0645 / H-0653 + the red-team follow-up.
WIN_RATE_PERCENT_HEURISTIC_THRESHOLD = 1.5

# SQN scaling factor is capped at sqrt(min(N, 100)) — Van Tharp's original
# 1997 definition. quantstats has no SQN parity oracle so the golden fixture
# is self-anchored against this cap. Changing this constant requires
# regenerating the golden fixture in the same change. See H-0652.
SQN_TRADE_COUNT_CAP = 100


def _merge_into_top_level_flags(
    target: dict | None,
    source: dict | None,
) -> dict | None:
    """Audit-2026-05-07 round-2 / P1994+P1995 follow-up: lift inner
    `data_quality_flags` keys (from `reconstruct_positions` and the
    turnover series) into the top-level `strategy_analytics.data_quality_flags`
    column the dashboard reads.

    Pre-fix, `reconstruct_positions` returned its aggregated flags inside
    `trade_metrics.data_quality_flags` (nested JSONB), and the wrapper
    `compute_turnover_series` discarded its flags entirely. Allocators
    never saw `breakeven_positions`, `positions_missing_realized_pnl`, or
    `turnover_gap_dates`. This helper performs the propagation.

    Merge rules (mirror `aggregated_data_quality_flags` in
    `position_reconstruction.py`):
      - booleans: OR-merge (any True wins)
      - ints / floats: sum (counters accumulate)
      - everything else (e.g. lists, strings): replace (last write wins)

    Single-producer invariant on `*_truncated_kept` / `*_truncated_total`
    counter keys: each list-truncation key name (e.g.
    `turnover_nav_missing_dates_truncated_kept`,
    `realized_pnl_per_trade_truncated_total`) is emitted by EXACTLY ONE
    producer (named after the specific list it caps). The int-sum rule
    above would otherwise double-count under a hypothetical cross-
    producer key collision and make `_kept` exceed its cardinality cap.
    New producers MUST keep their truncation keys uniquely namespaced.

    Returns the (possibly None) target dict. None is preserved when both
    sides are empty so the upsert payload can keep emitting `null` rather
    than `{}` for strategies with zero flags.
    """
    if not source:
        return target
    merged = target if target is not None else {}
    for k, v in source.items():
        existing = merged.get(k)
        if isinstance(v, bool):
            merged[k] = bool(existing) or v
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            base = existing if isinstance(existing, (int, float)) and not isinstance(existing, bool) else 0
            merged[k] = base + v
        else:
            merged[k] = v
    return merged


async def _load_position_time_series(
    strategy_id: str,
    supabase,
) -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]], dict[str, float]]:
    """H-A1: derive (positions_by_date, prices_by_date, nav_by_date) from
    `position_snapshots`.

    `position_snapshots.mark_price` is the SINGLE canonical price source per
    migration 034 — every snapshot row carries BOTH `size_usd` AND `mark_price`,
    so one query produces the position grid AND the price grid. The codebase
    has NO `historical_prices` table (verified pre-execution per H-A1 — the
    phantom table from REVIEWS does not exist).

    Outputs feed `compute_turnover_series_with_flags(positions_by_date,
    prices_by_date, nav_by_date)` (Plan 12-04, audit-2026-05-07 round-2 /
    P1995) — empty inputs return ([], {}) gracefully so a snapshot-less
    strategy degrades to an empty turnover series rather than a runtime error.

    Args:
        strategy_id: UUID string of the strategy.
        supabase: PostgREST client (service-role).

    The tenant's `api_keys.account_balance_usdt` is deliberately NOT a
    parameter of this function — see audit-2026-05-07 C-0221 below. Removing
    it from the signature makes the leak impossible by construction.

    Returns:
        positions_by_date: { 'YYYY-MM-DD': { symbol: signed_size_usd } }
        prices_by_date:    { 'YYYY-MM-DD': { symbol: mark_price } }
        nav_by_date:       { 'YYYY-MM-DD': nav_usd }

    Empty dicts on missing snapshots — caller treats as graceful degradation.

    Audit-2026-05-07 C-0221 (account-balance leak fix) + H-0636 follow-up
    ---------------------------------------------------------------------
    Previously, when `account_balance` was non-null this function wrote
    `nav_by_date[d] = float(account_balance)` — the tenant's raw
    `api_keys.account_balance_usdt`. That payload propagates into the
    `turnover_series` sibling row of `strategy_analytics_series`, which the
    `fetch_strategy_lazy_metrics` RPC exposes to anon for any *published*
    strategy. An anonymous attacker reading two non-zero `turnover` entries
    for a published strategy could divide them and recover the constant
    USDT balance.

    Mitigation: we now publish a PER-STRATEGY stable NAV proxy that contains
    no tenant-secret information. Specifically:

      * NAV[d] = max_gross_exposure if max_gross_exposure > 0 else 1.0,
        where max_gross_exposure = max_t sum(|positions[t]|).
        — the rolling/full-run maximum gross exposure observed across all
        snapshot dates. Constant within a run (no per-day variation), so
        turnover_series == Σ(|Δposition × price|) / max_gross_exposure for
        every date. Two anonymous reads can divide to recover RATIOS of
        position changes, but never the tenant's actual USDT balance —
        gross_exposure is a function of position sizes (already published
        as exposure_series) so leaking it adds no new information.

      * If positions_by_date is empty or max_gross_exposure is 0, NAV
        defaults to 1.0 (degenerate but non-error series; the upstream
        turnover_series builder also short-circuits on nav <= 0).

    Known trade-off (documented per H-0636 fix preference (b)): an attacker
    with access to BOTH `exposure_series` (already published per-day) AND
    `turnover_series` can multiply `turnover_series[d] * max(exposure_series)`
    to recover the absolute dollar position change for that date. This is
    an order-of-magnitude smaller signal than `account_balance` leak (no
    cross-account scaling — it's per-strategy and tied to already-published
    exposure shape), and the brief accepted this trade-off explicitly in
    return for keeping the turnover panel functional on demo / paper
    strategies. Preferred alternative would be H-0636 option (a): require
    account_balance and emit `data_quality_flags.turnover_unavailable`
    otherwise — tracked in the follow-up backlog.
    """
    # Audit-2026-05-07 H-0629 / H-0643: paginate the snapshot fetch. The
    # bare SELECT was bounded only by PostgREST's per-response cap
    # (1000 rows by default on hosted Supabase), so any strategy with
    # > 1000 snapshot rows silently truncated. Composite order_by
    # (snapshot_date, symbol, side) matches the
    # ``position_snapshots_unique_per_day`` index from migration 034 so
    # cross-page row ties cannot duplicate or skip rows.
    snapshots = await db_execute(
        lambda: paginated_select(
            supabase.table("position_snapshots")
            .select("snapshot_date, symbol, side, size_usd, mark_price")
            .eq("strategy_id", strategy_id),
            order_by=(
                ("snapshot_date", False),
                ("symbol", False),
                ("side", False),
            ),
            truncation_hint=f"position_snapshots strategy_id={strategy_id}",
        )
    )
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
        # Skip flat or near-zero-size rows (per migration 034 comment they're
        # usually not stored, but defensive). H-0644 / H-0654 motivates the
        # tolerance — see POSITION_SIZE_ZERO_TOLERANCE_USD docstring.
        if side == "flat" or abs(size_usd) < POSITION_SIZE_ZERO_TOLERANCE_USD:
            continue
        signed = size_usd if side == "long" else -size_usd
        positions_by_date.setdefault(d, {})[sym] = signed
        if mark_raw is not None:
            try:
                prices_by_date.setdefault(d, {})[sym] = float(mark_raw)
            except (TypeError, ValueError):
                # Don't poison prices_by_date with NaN/non-numeric marks.
                pass

    # Build nav_by_date. Audit-2026-05-07 C-0221 + H-0636: NEVER write
    # `float(account_balance)` here — that leaks the raw tenant USDT balance
    # through the published `turnover_series` sibling row. Do NOT write 1.0
    # as a constant denominator FOR NON-EMPTY POSITION BOOKS: that makes
    # turnover_series leak the raw dollar position-change magnitude
    # (numerator with denominator=1). 1.0 IS used as a degenerate fallback
    # ONLY when max_gross_exposure is 0 (no positions to leak).
    #
    # Use the per-strategy rolling maximum gross exposure as a stable proxy:
    # constant within the run, contains no balance information, and
    # gross-exposure shape is already published in exposure_series so it
    # adds no new disclosure surface. The 1.0 fallback avoids divide-by-zero
    # downstream (compute_turnover_series_with_flags short-circuits on
    # nav <= 0 anyway, so this is belt-and-braces).
    max_gross_exposure = max(
        (sum(abs(v) for v in pos_map.values()) for pos_map in positions_by_date.values()),
        default=0.0,
    )
    nav_proxy = max_gross_exposure if max_gross_exposure > 0 else 1.0
    nav_by_date: dict[str, float] = {d: nav_proxy for d in positions_by_date}

    return positions_by_date, prices_by_date, nav_by_date


def _compute_volume_metrics(fills: list[dict]) -> dict:
    """Compute fill-level volume metrics.

    fills: list of dicts with 'side' and 'cost' keys.

    Emits buy/sell percentages (fill-side aggregates). The position-side
    percentages (long_volume_pct / short_volume_pct) live in
    `_compute_position_side_volume_pcts` so they reflect what the field
    name promises (volume attributed to long-side vs short-side positions
    via timestamp window), not a buy/sell alias.

    Audit 2026-05-07 G12.G.4 hardening:
    - cost is taken as `abs(...)` so a rebate / exchange-side adjustment
      (negative cost) doesn't asymmetrically inflate one side and skew
      percentages outside [0, 1]. Volume is a magnitude, not a signed PnL.
    - non-numeric / missing cost defaults to 0.
    - side is lower-cased (case-insensitive match), so 'Buy'/'BUY' fold
      into 'buy'.
    - empty / unknown side contributes to total_volume_usd but neither
      buy nor sell, so percentages can sum to <1.0 (the residual is
      attributable to fills with unparseable sides — caller can detect
      via `1 - buy_pct - sell_pct`).
    - total_volume_usd is the absolute sum, never negative.
    """
    total_cost = 0.0
    buy_cost = 0.0
    sell_cost = 0.0
    non_finite_costs = 0

    for fill in fills:
        raw_cost = fill.get("cost", 0)
        try:
            cost = abs(float(raw_cost)) if raw_cost is not None else 0.0
        except (TypeError, ValueError):
            cost = 0.0
        if not math.isfinite(cost):
            # H-0769 / review-E: a non-finite (NaN/Inf) cost is corrupt input
            # (upstream divide-by-zero or a bad fill). Coerce to 0 so it can't
            # poison total_volume_usd / break strict JSON, but count it so the
            # corruption is observable, not silently absorbed into a $0 volume.
            non_finite_costs += 1
            cost = 0.0
        side = (fill.get("side") or "").lower()
        total_cost += cost
        if side == "buy":
            buy_cost += cost
        elif side == "sell":
            sell_cost += cost

    if non_finite_costs:
        logger.warning(
            "volume metrics: %d non-finite fill cost(s) coerced to 0 "
            "(corrupt input) across %d fills",
            non_finite_costs, len(fills),
        )

    buy_pct = buy_cost / total_cost if total_cost > 0 else 0.0
    sell_pct = sell_cost / total_cost if total_cost > 0 else 0.0

    return {
        "buy_volume_pct": round(buy_pct, 4),
        "sell_volume_pct": round(sell_pct, 4),
        "total_fills": len(fills),
        "total_volume_usd": round(total_cost, 2),
    }


def _compute_position_side_volume_pcts(
    fills: list[dict], positions: list[dict]
) -> dict:
    """Attribute fill volume to positions by timestamp window.

    A fill belongs to position P if its timestamp falls within
    [P.opened_at, P.closed_at] (closed_at=None for open positions means
    "until now"). Sums cost across long-side positions vs short-side,
    expresses each as a percentage of total volume across all attributed
    fills.

    Replaces v0.16.x's buy/sell alias for long_volume_pct / short_volume_
    pct, which double-counted "buy to close short" as long-side volume.

    Returns {"long_volume_pct", "short_volume_pct"}. When fills can't be
    attributed (positions list empty, missing timestamps, etc.), returns
    both as 0.0 — frontend renders "—" for that range.
    """
    if not fills or not positions:
        return {"long_volume_pct": 0.0, "short_volume_pct": 0.0}

    def _parse(ts: str | None) -> datetime | None:
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None

    windows: list[tuple[datetime, datetime | None, str]] = []
    for p in positions:
        opened = _parse(p.get("opened_at"))
        closed = _parse(p.get("closed_at"))  # None for open positions
        side = p.get("side")
        if not opened or side not in ("long", "short"):
            continue
        windows.append((opened, closed, side))

    long_volume = 0.0
    short_volume = 0.0
    attributed_total = 0.0
    cost_parse_failed = 0
    for f in fills:
        ts = _parse(f.get("timestamp") or f.get("filled_at"))
        if not ts:
            continue
        # NEW-C02-07: guard cost cast with same try/except as _compute_volume_metrics;
        # one malformed fill must not nuke the entire long/short attribution.
        # SF-H2 (review 2026-05-26): also guard float("nan")/float("inf") — these
        # parse without raising TypeError/ValueError but poison accumulated totals.
        raw_cost = f.get("cost")
        try:
            parsed_cost = abs(float(raw_cost)) if raw_cost is not None else 0.0
            if math.isfinite(parsed_cost):
                cost = parsed_cost
            else:
                cost = 0.0
                cost_parse_failed += 1
        except (TypeError, ValueError):
            cost = 0.0
            cost_parse_failed += 1
        for opened, closed, side in windows:
            if ts < opened:
                continue
            if closed is not None and ts > closed:
                continue
            attributed_total += cost
            if side == "long":
                long_volume += cost
            else:
                short_volume += cost
            break  # first matching window wins; positions don't overlap by design

    # SF-H1 (review 2026-05-26): emit warning when cost parse failures occurred
    # so operators can distinguish clean runs from degraded attribution.
    if cost_parse_failed > 0:
        logger.warning(
            "_compute_position_side_volume_pcts: %d fill(s) had non-numeric or "
            "non-finite cost (contributed 0 to attribution); long/short pcts may "
            "be skewed.",
            cost_parse_failed,
        )

    if attributed_total <= 0:
        return {"long_volume_pct": 0.0, "short_volume_pct": 0.0}
    return {
        "long_volume_pct": round(long_volume / attributed_total, 4),
        "short_volume_pct": round(short_volume / attributed_total, 4),
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
      Σ(R_i × |pnl_i|) / Σ|pnl_i|   where R_i = pnl_i / risk_unit
      and risk_unit = |avg_losing_trade| (canonical Van Tharp R denominator)

    Audit-2026-05-07 H-0627 / H-0628 ratchet: the prior closed-form
    `(avg_win × winners_count) / (|avg_loss| × losers_count)` is algebraically
    identical to Profit Factor (gross_profit / |gross_loss|) because
    `avg = sum / count`. The runner used to publish the same number under two
    labels (weighted_risk_reward_ratio AND profit_factor), which is a metric
    disclosure hazard for institutional allocators. The new pnl-weighted
    average weights each trade's R-multiple by its own dollar magnitude, so
    the metric varies independently of Profit Factor on heterogeneous
    cohorts. Note: this is NOT a textbook Van Tharp metric — Tharp's
    canonical Expectancy is simple-mean R (`Σ R_i / N`). The pnl-weighted
    form was chosen deliberately by the audit to (a) emphasize the
    contribution of larger trades and (b) ensure the published number
    differs from Profit Factor on heterogeneous cohorts. Quantstats does
    not implement a weighted-R metric so there is no external parity
    oracle; the metric label and formula are this codebase's contract.

    Threat T-12-05-03 mitigation: every divisor is guarded with `> 0`; pure
    zero-loss / zero-divisor cases yield None (rendered downstream as "—") to
    avoid +Infinity propagating into JSONB and breaking the parity gate.
    """
    # `volume_metrics` is currently only consumed for plumbing/compatibility
    # — kept in the signature so Plan 12-06 orchestrator wiring matches the
    # B-01 path-(b) contract literally.
    _ = volume_metrics

    # Position-side primitives (B-01 path (b) extended reconstruct_positions output).
    #
    # Audit-2026-05-07 H-0645 / H-0653: defensively normalize win_rate to the
    # canonical fraction-in-[0,1] convention. The producer
    # (`reconstruct_positions`) historically returns a fraction (0.6 == 60%),
    # but this is an unenforced cross-module contract. If a future refactor
    # flips to percent (60.0 == 60%) without updating this consumer, the
    # expectancy formula `win_rate * avg_win - (1 - win_rate) * |avg_loss|`
    # blows up by ~100×. Normalize at the boundary so a single-character
    # producer drift cannot ship inflated expectancy.
    # Threshold is `> 1.5` (not `> 1.0`): `winners/total` at 100% winners
    # can ULP-drift to `1.0001`, and the old `> 1.0` check misclassified
    # that as a percent, shipping a 1% win-rate for a 100%-winner strategy.
    # Anything clearly outside [0,1] (e.g. 60.0 == 60%) is still treated
    # as percent. Non-finite/negative inputs collapse to 0 so producer
    # drift cannot ship nonsense expectancy.
    win_rate = _safe_float(trade_metrics_from_positions.get("win_rate")) or 0.0
    if win_rate < 0:
        win_rate = 0.0
    elif win_rate > WIN_RATE_PERCENT_HEURISTIC_THRESHOLD:
        win_rate = win_rate / 100.0
    win_rate = min(win_rate, 1.0)
    # Per-trade aggregations below filter non-finite pnl via `_safe_float`,
    # but `avg_winning_trade` / `avg_losing_trade` are pre-aggregated
    # UPSTREAM by reconstruct_positions — a `+inf` realized_pnl passes
    # `pnl > 0` there and inflates the winners' average. Zero only the
    # non-finite side so a healthy partner metric still contributes to
    # `risk_reward_ratio` instead of being wiped silently.
    avg_win = _safe_float(trade_metrics_from_positions.get("avg_winning_trade")) or 0.0
    avg_loss = _safe_float(trade_metrics_from_positions.get("avg_losing_trade")) or 0.0
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

    # NaN/inf/non-numeric `realized_pnl` (typically an upstream
    # divide-by-zero in `reconstruct_positions`) must be dropped at the
    # boundary — it silently corrupts SQN / profit-factor / weighted-R:R
    # math (NaN evades both `p > 0` and `p < 0` filters).
    def _finite_pnl(t: dict) -> float | None:
        return _safe_float(t.get("realized_pnl"))

    # Expectancy: only meaningful when at least one of avg_win / avg_loss is
    # non-zero. All-zero position book → keep expectancy=None per the empty
    # test's contract.
    if avg_win or avg_loss:
        out["expectancy"] = win_rate * avg_win - (1 - win_rate) * abs(avg_loss)

    # Risk:Reward Ratio
    if avg_loss != 0:
        out["risk_reward_ratio"] = avg_win / abs(avg_loss)

    # H-F / METRICS-07: Weighted R:R.
    #
    # Audit-2026-05-07 H-0627 / H-0628: the previous formulation
    # `(avg_win × winners_count) / (|avg_loss| × losers_count)` is
    # algebraically identical to Profit Factor (gross_profit / |gross_loss|)
    # because `avg = sum / count`. Publishing the same number under two
    # labels (weighted_risk_reward_ratio + profit_factor) is a metric
    # disclosure hazard.
    #
    # Replace with a genuine pnl-weighted average of per-trade R-multiple:
    #     Σ(R_i × |pnl_i|) / Σ|pnl_i|     where R_i = pnl_i / risk_unit
    # This weights each trade's R by its own dollar magnitude (large trades
    # carry more signal). NOT a textbook Van Tharp metric — see the docstring
    # at the top of this function for the rationale and audit decision.
    # Falls back to None when there is no risk_unit (avg_loss == 0) or no
    # closed trade has a non-zero |pnl|.
    pnl_weighted_num = 0.0
    pnl_weighted_den = 0.0
    risk_unit_for_weighted = abs(avg_loss) if avg_loss else 0.0
    if risk_unit_for_weighted > 0:
        for t in per_trade:
            pnl_val = _finite_pnl(t)
            if pnl_val is None:
                continue
            r_i = pnl_val / risk_unit_for_weighted
            w_i = abs(pnl_val)
            pnl_weighted_num += r_i * w_i
            pnl_weighted_den += w_i
    if pnl_weighted_den > 0:
        out["weighted_risk_reward_ratio"] = pnl_weighted_num / pnl_weighted_den

    # METRICS-08: SQN over per-trade R-multiples (R = realized_pnl / risk_unit).
    # risk_unit = |avg_loss| (canonical Van Tharp denominator).
    #
    # Scaling cap is sqrt(min(N, 100)) — Van Tharp's original definition
    # (Tharp, *Trade Your Way to Financial Freedom*, 2nd ed., 2007).
    # quantstats does NOT implement SQN, so there is no external parity
    # oracle and the golden-fixture value is self-anchored. Unbounded
    # sqrt(N) inflates SQN for high-trade-count strategies, distorting
    # cross-strategy comparison. If a future change moves to the academic
    # sqrt(N) form, regen the golden fixture in the same change.
    risk_unit = abs(avg_loss) if avg_loss else 0.0
    if risk_unit > 0 and per_trade:
        finite_pnls = [v for v in (_finite_pnl(t) for t in per_trade) if v is not None]
        r_multiples = [v / risk_unit for v in finite_pnls]
        if len(r_multiples) >= 2:
            mean_r = sum(r_multiples) / len(r_multiples)
            var_r = sum((r - mean_r) ** 2 for r in r_multiples) / (
                len(r_multiples) - 1
            )
            std_r = math.sqrt(var_r) if var_r > 0 else 0.0
            if std_r > 0:
                out["sqn"] = (mean_r / std_r) * math.sqrt(
                    min(len(r_multiples), SQN_TRADE_COUNT_CAP)
                )

    # Profit Factor segmented by side — same `_finite_pnl` coercion so a
    # non-finite pnl can't poison either bucket.
    long_pnls: list[float] = []
    short_pnls: list[float] = []
    for t in per_trade:
        v = _finite_pnl(t)
        if v is None:
            continue
        if t.get("side") == "long":
            long_pnls.append(v)
        elif t.get("side") == "short":
            short_pnls.append(v)

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
      gross_volume_usd          — sum of |notional_usd| over every fill
      mean_trade_size_usd       — gross_volume / N
      daily_turnover_usd        — mean of per-day notional totals (group by date prefix)
      monthly_turnover_usd      — mean of per-month notional totals (group by YYYY-MM prefix)
      turnover_timestamp_coverage — fraction of fills with usable timestamps (NEW-C02-08)

    Pure function: groups by `filled_at` (or `created_at` fallback) date prefix.
    Skips fills with malformed/missing timestamps for daily/monthly bucketing
    but keeps them in gross_volume + mean_trade_size aggregates.

    NEW-C02-08: count skipped (timestamp-less) fills; emit
    `turnover_timestamp_coverage` into the returned dict when the fraction is
    non-trivially low (< 1.0), so callers can surface it as a data-quality flag.

    NEW-C02-09: notional_usd coerced through try/except (consistent with
    `_compute_volume_metrics`); malformed value contributes 0, not a crash.

    NEW-C02-10: each fill's notional parsed once in a single pass that accumulates
    gross total and per-bucket totals together, eliminating the prior two-traversal
    pattern (notionals[] list + second per-fill parse in the bucket loop).
    """
    if not fills:
        return {
            "gross_volume_usd": 0.0,
            "mean_trade_size_usd": 0.0,
            "daily_turnover_usd": 0.0,
            "monthly_turnover_usd": 0.0,
        }

    # Single pass: parse notional once, accumulate gross + daily/monthly buckets.
    gross_volume = 0.0
    daily: dict[str, float] = defaultdict(float)
    monthly: dict[str, float] = defaultdict(float)
    ts_skipped = 0

    notional_parse_failed = 0
    for f in fills:
        raw_notional = f.get("notional_usd", 0.0)
        try:
            parsed_notional = abs(float(raw_notional)) if raw_notional is not None else 0.0
            # SF-H2 (review 2026-05-26): float("nan")/"Infinity" parse without raising;
            # guard with isfinite so they don't poison gross_volume / mean_size.
            if math.isfinite(parsed_notional):
                notional = parsed_notional
            else:
                notional = 0.0
                notional_parse_failed += 1
        except (TypeError, ValueError):
            notional = 0.0
            notional_parse_failed += 1
        gross_volume += notional

        ts = f.get("filled_at") or f.get("created_at") or ""
        if not ts or len(ts) < 10:
            ts_skipped += 1
            continue
        day = ts[:10]
        month = ts[:7]
        daily[day] += notional
        monthly[month] += notional

    n = len(fills)
    mean_size = gross_volume / n if n else 0.0
    daily_avg = sum(daily.values()) / len(daily) if daily else 0.0
    monthly_avg = sum(monthly.values()) / len(monthly) if monthly else 0.0

    # SF-H1 (review 2026-05-26): warn on non-finite/malformed notional, mirroring
    # the timestamp-coverage warning already present below.
    if notional_parse_failed > 0:
        logger.warning(
            "_compute_volume_aggregator: %d fill(s) had non-numeric or non-finite "
            "notional_usd (contributed 0 to gross_volume); volume metrics may be "
            "understated.",
            notional_parse_failed,
        )

    result: dict[str, float] = {
        "gross_volume_usd": gross_volume,
        "mean_trade_size_usd": mean_size,
        "daily_turnover_usd": daily_avg,
        "monthly_turnover_usd": monthly_avg,
    }
    # Emit coverage fraction so callers can propagate it as a data-quality flag.
    ts_coverage = (n - ts_skipped) / n if n else 1.0
    if ts_coverage < 1.0:
        result["turnover_timestamp_coverage"] = round(ts_coverage, 4)
        if ts_skipped > 0:
            logger.warning(
                "_compute_volume_aggregator: %d/%d fills missing/short timestamps "
                "(turnover_timestamp_coverage=%.2f%%); gross_volume computed on all fills, "
                "daily/monthly turnover on timestamped subset only.",
                ts_skipped, n, ts_coverage * 100,
            )
    return result


def _compute_trade_mix(
    fills: list[dict], has_maker_taker: bool
) -> dict[str, dict[str, float]]:
    """Trade Mix breakdown by side × maker/taker.

    Bucket count branches off the is_maker audit outcome:
      - has_maker_taker=True  → 4 buckets (long_maker, long_taker, short_maker, short_taker)
      - has_maker_taker=False → 2 buckets fallback (long, short)

    Each bucket: {count, total_notional}.

    In 4-bucket mode, fills with `is_maker` missing/None are skipped — can't
    bucket without the flag. The audit gate only sets has_maker_taker=True
    when ≥99% of fills carry it, so skipped fills are a known small fraction.

    Side mapping is fill-level (buy→long, sell→short); a "buy to close short"
    is bucketed as a long entry. The approximation matches the panel labels
    (maker/taker fee-tier exposure vs entry direction).
    """

    def _empty_bucket() -> dict[str, float]:
        return {"count": 0, "total_notional": 0.0}

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

    notional_parse_failed = 0
    for f in fills:
        side = f.get("side")
        if side == "buy":
            side = "long"
        elif side == "sell":
            side = "short"
        if side not in ("long", "short"):
            continue
        # NEW-C02-09: guard notional cast (mirrors _compute_volume_metrics policy);
        # a malformed notional_usd contributes 0 to total_notional, not a crash.
        # SF-H2 (review 2026-05-26): also guard float("nan")/float("inf").
        raw_notional = f.get("notional_usd", 0.0)
        try:
            parsed_notional = abs(float(raw_notional)) if raw_notional is not None else 0.0
            if math.isfinite(parsed_notional):
                notional = parsed_notional
            else:
                notional = 0.0
                notional_parse_failed += 1
        except (TypeError, ValueError):
            notional = 0.0
            notional_parse_failed += 1

        if has_maker_taker:
            is_maker = f.get("is_maker")
            if is_maker is None:
                continue
            maker_key = "maker" if is_maker else "taker"
            bucket_key = f"{side}_{maker_key}"
        else:
            bucket_key = side

        buckets[bucket_key]["count"] += 1
        buckets[bucket_key]["total_notional"] += notional

    # SF-H1 (review 2026-05-26): emit warning when notional parse failures occurred.
    if notional_parse_failed > 0:
        logger.warning(
            "_compute_trade_mix: %d fill(s) had non-numeric or non-finite "
            "notional_usd (contributed 0 to total_notional); trade mix may be "
            "understated.",
            notional_parse_failed,
        )

    return buckets


# KPI-17: per-strategy gate threshold for switching to 4-bucket Trade Mix.
# Matches D-15 audit gate (≥99% is_maker population on the strategy's fills).
_MAKER_TAKER_COVERAGE_THRESHOLD = 0.99


def _has_maker_taker_coverage(fills: list[dict]) -> bool:
    """Return True when ≥99% of this strategy's fills carry is_maker.

    Per-strategy data-driven gate: a venue that populates is_maker
    reliably (current: OKX) auto-qualifies; a venue that doesn't keeps
    the strategy on the 2-bucket render. No exchange allowlist needed —
    the data answers for each strategy.
    """
    if not fills:
        return False
    populated = sum(1 for f in fills if f.get("is_maker") is not None)
    return populated / len(fills) >= _MAKER_TAKER_COVERAGE_THRESHOLD


def _is_trade_mix_approximate(positions: list[dict]) -> bool:
    """Trade Mix panel buckets fills by side (buy→long, sell→short).

    A *closed* short has a buy-to-close fill that gets mis-bucketed as
    a long entry, which is what makes the panel an approximation. An
    *open-only* short has no closing buy yet — the sell that opened it
    is bucketed correctly as "short", so the panel remains exact until
    the position closes.

    The flag therefore only fires when at least one closed short exists
    in the dataset; over-firing on open-only shorts would surface the
    chip even though no fills are mis-attributed.
    """
    return any(
        p.get("side") == "short" and p.get("closed_at") is not None
        for p in positions
    )


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
        #
        # Two separate flags persist post-C-0221 for OPERATOR visibility,
        # not for analytics-degradation signaling:
        #   - no_linked_api_key: strategy has no api_key_id (demo / paper).
        #   - account_balance_unavailable: api_key_id IS set but the
        #     balance lookup didn't return a usable value (no balance
        #     configured, or fetch threw).
        # Post-C-0221, NEITHER flag affects NAV semantics — `_load_position_
        # time_series` always builds `nav_by_date` from `max_gross_exposure`
        # regardless of whether `account_balance` was successfully fetched.
        # The flags remain informational so the owner-side UI can distinguish
        # "missing exchange credential" from "credential present, fetch broke"
        # without falsely implying analytics ran with a degraded NAV.
        account_balance = None
        account_balance_unavailable = False
        no_linked_api_key = False
        # Hoisted out of the try so the except handler can route based on
        # whether api_key_id was set BEFORE the throw — otherwise a fetch
        # failure would always set account_balance_unavailable, even for
        # demo strategies, re-introducing the demo-vs-failure conflation
        # the flag split was meant to eliminate.
        api_key_id: str | None = None
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
                # Use `is not None` so a literal 0 / 0.0 (drained
                # account, or operator zeroed it) is distinguishable from
                # NULL. A truthy check would conflate "real zero" with
                # "no balance configured" and silently mark the strategy
                # as degraded forever.
                balance_raw = (
                    key_result.data.get("account_balance_usdt")
                    if key_result.data
                    else None
                )
                if balance_raw is not None:
                    account_balance = float(balance_raw)
                else:
                    # api_key exists but no balance configured. Post-C-0221
                    # NAV semantics are unchanged (always `max_gross_exposure`,
                    # per _load_position_time_series); the flag exists only
                    # to surface the degraded state in the owner UI.
                    account_balance_unavailable = True
            else:
                # No api_key linked at all — common for demo / paper
                # strategies. NAV proxy still unconditional; distinct flag so
                # the UI text doesn't imply something needs fixing.
                no_linked_api_key = True
        except Exception:  # noqa: BLE001
            # Use exception() to capture the full traceback in logs;
            # warning(str(e)) loses the stack and obscures whether the
            # error came from db_execute, the float() cast, or
            # something else.
            logger.exception(
                "Could not fetch account balance for %s", strategy_id
            )
            # Route based on whether api_key_id was actually resolved.
            # If the throw happened before/during api_key_id resolution
            # OR with no key linked, it's the demo path; only a real
            # fetch failure with a known api_key_id is the degraded path.
            if api_key_id:
                account_balance_unavailable = True
            else:
                no_linked_api_key = True

        # Transform trades to daily returns.
        #
        # Audit-2026-05-07 #9 (PR-7 consumer migration) — use the
        # _with_status form so the heuristic-capital fallback is
        # surfaced through data_quality_flags + computation_status.
        # Pre-fix the bare returns shape collapsed three states:
        #   * accurate compute (real account_balance, no fallback);
        #   * approximate compute (heuristic capital, off by 5–10×);
        #   * errored compute (exchange-API balance fetch failed).
        # The factsheet rendered the second and third as canonical
        # CAGR/Sharpe with no DQF chip.
        #
        # `balance_error` from the runner side is NOT plumbed through
        # yet — analytics_runner reads `api_keys.account_balance_usdt`
        # (a DB column populated by the cron / process-key path), not
        # the exchange API directly. The exchange-API error flag from
        # `fetch_usdt_balance_with_status` lives on the cron path; to
        # carry it down to the analytics consumer requires either a
        # `balance_error` column on `api_keys` or a dedicated DQF
        # plumbing table — both PR-5 territory. Track as PR-7c
        # (DB schema add). For now the runner passes balance_error=False
        # and only surfaces `used_heuristic_capital` in DQF.
        returns, returns_meta = trades_to_daily_returns_with_status(
            trades, account_balance=account_balance, balance_error=False
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
            compute_turnover_series_with_flags,
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
            # Audit 2026-05-07 G12.G.10: store a stable enum code in the
            # data_quality_flags blob (which leaks to allocators via
            # PostgREST) — never the raw exception message, which may
            # contain table names, column names, or query fragments. The
            # full message is in the worker log (above) for operators.
            position_reconstruction_error = "RECONSTRUCTION_FAILED"

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
            ) = await _load_position_time_series(strategy_id, supabase)
        except PaginatedSelectTruncated:
            # Audit #52 fail-loud contract: a 1M-row strategy hitting the
            # pagination hard cap must surface as a stable typed error so
            # operators can investigate, NOT be downgraded to the generic
            # "SNAPSHOTS_LOAD_FAILED" DQF (which conflates RLS regressions,
            # transient network blips, and scale overflow).
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Position snapshots load failed for %s: %s", strategy_id, str(exc)
            )
            # Audit 2026-05-07 G12.G.10: stable enum code, not raw exc text.
            position_snapshots_error = "SNAPSHOTS_LOAD_FAILED"

        # Fetch fills once, feed volume helpers + trade_mix. The trades
        # table only stores side / cost / is_maker / timestamp; the prior
        # `notional_usd, holding_period_hours, filled_at, created_at`
        # column list 400'd because those columns don't exist (migration
        # 039 was never landed). Project `cost` -> `notional_usd` and
        # `timestamp` -> `filled_at` so downstream helpers see the keys
        # they expect; missing keys still fall through `.get(..., default)`.
        fills_data: list[dict] = []
        fills_fetch_failed = False
        fills_fetch_error: str | None = None
        try:
            # Active live OKX strategies routinely have tens of thousands
            # of fills; bare SELECT was capped at PostgREST's default 1000
            # rows, silently corrupting volume / turnover / trade_mix math.
            # Composite order_by (timestamp, id) — OKX millisecond
            # timestamps collide trivially when one order fills against
            # multiple makers in the same ms; the UUID primary key is a
            # guaranteed tiebreaker so paginated rows cannot duplicate or
            # skip at page boundaries.
            raw_fills = await db_execute(
                lambda: paginated_select(
                    supabase.table("trades")
                    .select("side, cost, is_maker, timestamp")
                    .eq("strategy_id", strategy_id)
                    .eq("is_fill", True),
                    order_by=(("timestamp", False), ("id", False)),
                    truncation_hint=f"trades fills strategy_id={strategy_id}",
                )
            )
            fills_data = [
                {
                    **row,
                    "notional_usd": abs(float(row.get("cost") or 0.0)),
                    "filled_at": row.get("timestamp"),
                }
                for row in raw_fills
            ]
        except PaginatedSelectTruncated:
            # Audit #52 fail-loud contract: same as the snapshots path.
            # A 1M-row fills strategy must not be silently downgraded to
            # an empty fills set with "FILLS_FETCH_FAILED" DQF.
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Fills fetch failed for %s: %s", strategy_id, str(exc)
            )
            fills_data = []
            fills_fetch_failed = True
            # Audit 2026-05-07 G12.G.10: stable enum code, not raw exc text.
            fills_fetch_error = "FILLS_FETCH_FAILED"

        # B-01 path (b) merge: volume_metrics + volume_aggregator + derived +
        # trade_mix all flow into the trade_metrics JSONB before the upsert.
        volume_metrics = _compute_volume_metrics(fills_data) if fills_data else {}
        volume_aggregator = (
            _compute_volume_aggregator(fills_data) if fills_data else {}
        )
        derived = _compute_derived_trade_metrics(
            volume_metrics, trade_metrics_from_positions
        )

        # Position-side volume attribution. The reconstructed positions live
        # in `public.positions`; fetch each position's side + window so the
        # helper can attribute fills by timestamp instead of pretending
        # buy_volume_pct equals long_volume_pct.
        position_side_pcts: dict = {}
        position_side_volume_failed = False
        position_side_volume_error: str | None = None
        trade_mix_approximate = False
        if fills_data:
            try:
                pos_result = await db_execute(
                    lambda: supabase.table("positions")
                    .select("side, opened_at, closed_at")
                    .eq("strategy_id", strategy_id)
                    .execute()
                )
                positions_list = (pos_result.data if pos_result else []) or []
                position_side_pcts = _compute_position_side_volume_pcts(
                    fills_data, positions_list
                )
                # Trade Mix maps buy→long / sell→short on raw fills, which
                # mis-attributes "buy to close short" as a long entry. The
                # contract is narrower than "any short": it fires only on
                # closed shorts, because an open-only short has no closing
                # buy yet (its sell is bucketed correctly). See
                # _is_trade_mix_approximate.
                trade_mix_approximate = _is_trade_mix_approximate(positions_list)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Position-side volume attribution failed for %s: %s",
                    strategy_id, str(exc),
                )
                position_side_volume_failed = True
                # Audit 2026-05-07 G12.G.10: stable enum code, not raw exc text.
                position_side_volume_error = "POSITION_SIDE_VOLUME_FAILED"
        # KPI-17: 4-bucket Trade Mix gated on (env flag) AND (per-strategy
        # is_maker coverage ≥99% on this strategy's actual fills). The
        # env flag is the global kill switch; the per-strategy coverage
        # check is the audit. Works for all exchanges — when a venue
        # populates is_maker reliably it auto-qualifies; when it doesn't,
        # the strategy falls back to 2-bucket. v0.17.1: OKX confirmed
        # at 100% coverage. Binance/Bybit qualify automatically once
        # they ingest fills with is_maker populated.
        env_flag = (
            os.getenv("TRADE_MIX_HAS_MAKER_TAKER", "false").lower() == "true"
        )
        has_maker_taker = env_flag and _has_maker_taker_coverage(fills_data)
        trade_mix = _compute_trade_mix(fills_data, has_maker_taker=has_maker_taker)

        # Observability: when 4-bucket mode is on, _compute_trade_mix silently
        # skips fills missing is_maker. The coverage gate caps that at <1% by
        # design, but log AND emit a DQF when it happens so allocators see the
        # count instead of a quiet panel-vs-volume discrepancy.
        #
        # Audit-2026-05-07 H-0646: a compromised exchange connector / malicious
        # tenant emitting `is_maker: null` on every fill could otherwise
        # suppress the entire trade_mix panel (all four buckets zero) with no
        # signal — the per-run coverage gate then flips the mode back to
        # 2-bucket, but only AFTER the gate is checked at the top of this
        # block. Add a defense-in-depth observability flag here so any
        # missing-is_maker fills surface in `data_quality_flags` regardless of
        # which mode the gate picked.
        fills_missing_is_maker_pct: float | None = None
        if fills_data:
            missing = sum(1 for f in fills_data if f.get("is_maker") is None)
            if missing > 0:
                fills_missing_is_maker_pct = missing / len(fills_data)
                logger.info(
                    "Trade Mix: %d/%d fills missing is_maker for strategy %s "
                    "(mode=%s, pct=%.4f)",
                    missing, len(fills_data), strategy_id,
                    "4-bucket" if has_maker_taker else "2-bucket",
                    fills_missing_is_maker_pct,
                )

        merged_trade_metrics = {
            **(trade_metrics_from_positions or {}),
            **volume_metrics,
            **position_side_pcts,
            **volume_aggregator,
            **derived,
            "trade_mix": trade_mix,
        }

        # H-A1: turnover_series from position_snapshots-derived grids.
        # Audit-2026-05-07 round-2 / P1995 follow-up: use the _with_flags
        # variant so `turnover_gap_dates` (sparse-calendar flag) reaches
        # the top-level data_quality_flags below — the wrapper discards
        # the flags dict and was the silent source of the dashboard not
        # surfacing the gap signal.
        turnover_series, turnover_flags = compute_turnover_series_with_flags(
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

        # Distinguish "real 0% volume" from "we couldn't compute it" so the
        # frontend doesn't render a confident flat-strategy reading after a
        # transient fetch failure.
        if fills_fetch_failed:
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["fills_fetch_failed"] = True
            if fills_fetch_error is not None:
                data_quality_flags["fills_fetch_error"] = fills_fetch_error
        if position_side_volume_failed:
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["position_side_volume_failed"] = True
            if position_side_volume_error is not None:
                data_quality_flags["position_side_volume_error"] = (
                    position_side_volume_error
                )
        if trade_mix_approximate:
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["trade_mix_approximation"] = True
        # Audit-2026-05-07 H-0646: surface the percentage of fills missing
        # is_maker so allocators can see when the trade_mix panel is built
        # from an incomplete view (silent suppression-attack mitigation).
        if fills_missing_is_maker_pct is not None and fills_missing_is_maker_pct > 0:
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["fills_missing_is_maker_pct"] = round(
                fills_missing_is_maker_pct, 4
            )
        if account_balance_unavailable:
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["account_balance_unavailable"] = True
        if no_linked_api_key:
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["no_linked_api_key"] = True

        # Audit-2026-05-07 #9 (PR-7 consumer migration) — surface
        # used_heuristic_capital and balance_error from the
        # ReturnsComputationMeta returned by trades_to_daily_returns_with_status.
        # The factsheet UI uses these keys to render an "approximate"
        # chip on CAGR/Sharpe rather than presenting them as canonical.
        #
        # Suppress used_heuristic_capital when account_balance_unavailable
        # OR no_linked_api_key already fires — the heuristic is the
        # downstream consequence of those upstream states, not a distinct
        # condition. Surfacing both would render two redundant
        # "approximate" chips on the factsheet for one underlying state.
        if returns_meta["used_heuristic_capital"] and not (
            account_balance_unavailable or no_linked_api_key
        ):
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["used_heuristic_capital"] = True
        if returns_meta["balance_error"]:
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["balance_error"] = True

        # Audit-2026-05-07 round-2 / P1994+P1995 follow-up: lift inner
        # `data_quality_flags` from reconstruct_positions (breakeven_positions,
        # positions_missing_realized_pnl, plus pre-existing fills_dropped_no_symbol
        # and posSide_side_mismatch) AND from the turnover series
        # (turnover_gap_dates) into the top-level column the dashboard reads.
        # Pre-fix these were buried inside `trade_metrics.data_quality_flags`
        # (nested JSONB) or discarded entirely by the wrapper — allocators
        # never saw the new observability signals the audit fix added.
        #
        # The merge does NOT promote `computation_status` to
        # `complete_with_warnings`: that promotion is gated below on
        # `used_heuristic_capital` / `balance_error` only (see the long
        # comment block on the consumer_specific_flags check).
        inner_position_flags = (
            (trade_metrics_from_positions or {}).get("data_quality_flags")
            if isinstance(trade_metrics_from_positions, dict)
            else None
        )
        if inner_position_flags:
            data_quality_flags = _merge_into_top_level_flags(
                data_quality_flags, inner_position_flags
            )
        if turnover_flags:
            data_quality_flags = _merge_into_top_level_flags(
                data_quality_flags, turnover_flags
            )

        # Upgrade computation_status to 'complete_with_warnings' ONLY when
        # one of the consumer-specific flags above fires
        # (used_heuristic_capital, balance_error). The section-level
        # flags (position_metrics_failed, fills_fetch_failed,
        # position_side_volume_failed, trade_mix_approximation,
        # account_balance_unavailable, no_linked_api_key,
        # benchmark_unavailable) deliberately KEEP status='complete'
        # because eight downstream frontend consumers gate exact-string
        # on `computation_status === "complete"`:
        #   - src/app/api/factsheet/[id]/pdf/route.ts:90
        #   - src/app/api/factsheet/[id]/tearsheet.pdf/route.ts:61
        #   - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:113
        #   - src/app/strategy/[id]/page.tsx:134
        #   - src/app/(dashboard)/portfolios/[id]/page.tsx:484
        #   - src/components/strategy/PerformanceReport.tsx:50
        #   - src/components/strategy/SyncProgress.tsx:139
        #   - src/lib/queries.ts:509
        # Promoting those flags would cause demo strategies (no api_key
        # linked) and any strategy with a stale benchmark to fail PDF
        # rendering, hide metric grids, and trip warning chips on every
        # public surface. Migrating the consumers to accept both states
        # is its own follow-up PR (tracked in FIX-LIST follow-up backlog
        # alongside PR-7c). Until then, stay narrow: only the audit-#9
        # producer/consumer pair upgrades status.
        consumer_specific_flags = (
            (data_quality_flags or {}).get("used_heuristic_capital")
            or (data_quality_flags or {}).get("balance_error")
        )
        # When the consumer flag is suppressed (because the upstream
        # account_balance_unavailable / no_linked_api_key already
        # captures the same root cause), status MUST stay 'complete' —
        # do NOT fall back to the meta hint, which would still read
        # 'complete_with_warnings' from transforms.py and silently
        # promote section-flag-only runs the frontend gates can't
        # handle.
        computation_status_value = (
            "complete_with_warnings" if consumer_specific_flags else "complete"
        )

        # B-01: single strategy_analytics upsert spreads metrics_result.metrics_json
        # AND attaches the merged trade_metrics + volume_aggregator + exposure
        # aggregates (without exposure_series, which moved to sibling_kinds).
        await db_execute(
            lambda: supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": computation_status_value,
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
                    # Audit 2026-05-07 G12.G.10: stable enum code, not raw exc.
                    existing["sibling_kinds_error"] = "SIBLING_BATCH_UPSERT_FAILED"
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
                except Exception as flag_exc:  # noqa: BLE001
                    # The flag write itself failed — operators have no signal
                    # that panels 4-7 are blank. Log loudly so production
                    # monitoring picks this up; we still return "complete"
                    # because the scalar metrics are valid.
                    logger.error(
                        "Failed to record sibling_kinds_failed flag for %s: %s",
                        strategy_id, str(flag_exc),
                    )

        return {"status": "complete", "strategy_id": strategy_id}

    except HTTPException:
        raise
    except PaginatedSelectTruncated as trunc:
        # Phase C red-team Finding 1: the broad `except Exception` below
        # would swallow this typed exception, mapping it to a generic
        # HTTPException(500). The worker dispatcher's classify_exception
        # then tags 500 as `unknown` → indefinite retry on a permanent
        # data-shape fault. Handle the truncation distinctly: persist a
        # SPECIFIC computation_error that preserves the page count + hint,
        # then re-raise the typed exception so callers (and the dispatcher)
        # can classify it as a permanent fault.
        logger.error(
            "Compute analytics: pagination truncation for %s "
            "(page_count=%d, page_size=%d, hint=%s)",
            strategy_id, trunc.page_count, trunc.page_size, trunc.hint or "n/a",
        )
        await db_execute(
            lambda: supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "failed",
                    "computation_error": (
                        f"Analytics aborted: dataset exceeds "
                        f"{trunc.page_count * trunc.page_size:,} rows "
                        f"({trunc.hint or 'unknown source'}); operator "
                        "intervention required."
                    ),
                },
                on_conflict="strategy_id",
            ).execute()
        )
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


async def run_csv_strategy_analytics(strategy_id: str) -> dict:
    """Phase 19.1 / CSV → analytics pipeline Plan 02 Task 2.

    Analytics pipeline for source='csv' strategies. Loads
    csv_daily_returns, builds a pd.Series, and calls compute_all_metrics
    directly — bypasses the 700-line trades-to-returns chain used by the
    exchange-backed path. CSV uploads have no fills, no positions, no
    trade_mix, no volume metrics; those panels stay null on the
    strategy_analytics row.

    Mirrors the structure of run_strategy_analytics but skips the
    exchange-specific branches. Sets computation_status='computing' on
    entry; 'complete' or 'failed' on exit.

    On the unrecoverable-exception path (T-19.1-03 / PR #273), we wrap
    the failure-marker upsert in try/except and log a warning BEFORE
    re-raising the outer 500 — without that evidence, a `computing` row
    that gets stuck because the DB went down would leave operators
    blind. Re-derived from PR #270 commit 06c38b80 + PR #273 commit
    01cbea60 under the GSD workflow.

    WR-01 (19.1-REVIEW): mirror the exchange runner's strategy-existence
    probe before the unconditional `_mark_computing` upsert. Otherwise a
    `compute_analytics_from_csv` job enqueued for a strategy that was
    deleted between enqueue and dispatch (wizard race, admin delete-and-
    recreate) would land a spurious `strategy_analytics` row and then
    fail with a misleading "Insufficient CSV history" 400 — operator
    triage gets pointed at data quality instead of the actual cause.
    Raising 404 here gets `classify_exception`-mapped to `permanent`
    (no retry).
    """
    supabase = get_supabase()

    # Verify strategy exists BEFORE touching strategy_analytics. Mirrors
    # run_strategy_analytics:748-757; the response is unused beyond the
    # existence check.
    strategy_result = await db_execute(
        lambda: supabase.table("strategies")
        .select("id, user_id")
        .eq("id", strategy_id)
        .single()
        .execute()
    )
    if not strategy_result.data:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Mark computing.
    def _mark_computing() -> None:
        supabase.table("strategy_analytics").upsert(
            {"strategy_id": strategy_id, "computation_status": "computing"},
            on_conflict="strategy_id",
        ).execute()
    await db_execute(_mark_computing)

    try:
        # Load persisted series.
        #
        # WR-02 (19.1-REVIEW): use paginated_select. A bare
        # .select(...).eq(...).order(...).execute() caps at PostgREST's
        # default 1000-row response on hosted Supabase, but
        # persist_csv_daily_returns accepts up to 5000 rows (migration
        # 20260522111839:160). A 1001–5000-row CSV persists fine but
        # would silently truncate to the first 1000 rows here, feeding
        # compute_all_metrics a partial series. Composite order_by
        # (date asc) matches the (strategy_id, date) UNIQUE index from
        # the same migration so paginated rows cannot duplicate or
        # skip at page boundaries.
        def _load_series():
            return paginated_select(
                supabase.table("csv_daily_returns")
                .select("date, daily_return")
                .eq("strategy_id", strategy_id),
                order_by=(("date", False),),
                truncation_hint=f"csv_daily_returns strategy_id={strategy_id}",
            )
        data = await db_execute(_load_series)

        if len(data) < 2:
            # WR-05 (19.1-REVIEW): stamp csv_source=True so the
            # provenance pill renders "CSV upload failed — insufficient
            # history" instead of falling through to generic "missing
            # data" copy. Downstream consumers gate the chip on
            # data_quality_flags?.csv_source (src/lib/types.ts:335).
            def _mark_failed():
                supabase.table("strategy_analytics").upsert(
                    {
                        "strategy_id": strategy_id,
                        "computation_status": "failed",
                        "computation_error": "Insufficient CSV history. At least 2 data points required.",
                        "data_quality_flags": {"csv_source": True},
                    },
                    on_conflict="strategy_id",
                ).execute()
            await db_execute(_mark_failed)
            raise HTTPException(status_code=400, detail="Insufficient CSV history")

        # Local import keeps the cycle risk low (analytics_runner is
        # imported at worker startup; pandas is already pulled in via
        # services.benchmark but the explicit local import documents
        # intent).
        import pandas as pd
        dates = pd.DatetimeIndex([r["date"] for r in data])
        values = [float(r["daily_return"]) for r in data]
        returns = pd.Series(values, index=dates, name="returns")

        benchmark_rets, benchmark_stale = None, True
        try:
            benchmark_rets, benchmark_stale = await get_benchmark_returns("BTC")
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "csv analytics: benchmark fetch failed for %s: %s",
                strategy_id, exc,
            )

        metrics_result = compute_all_metrics(returns, benchmark_rets)

        data_quality_flags: dict = {"csv_source": True}
        if benchmark_stale or benchmark_rets is None:
            data_quality_flags["benchmark_unavailable"] = True
            data_quality_flags["benchmark_note"] = "Benchmark data unavailable."

        def _mark_complete():
            payload = {
                "strategy_id": strategy_id,
                "computation_status": "complete",
                "computation_error": None,
                "data_quality_flags": data_quality_flags,
                "trade_metrics": None,    # CSV has no fills
                "volume_metrics": None,
                "exposure_metrics": None,
            }
            payload.update(metrics_result.metrics_json)
            supabase.table("strategy_analytics").upsert(
                payload, on_conflict="strategy_id"
            ).execute()
        await db_execute(_mark_complete)

        if metrics_result.sibling_kinds:
            # NEW-C02-06: mirror the exchange runner's guarded sibling upsert.
            # A transient RPC blip previously re-raised into the outer except,
            # overwriting computation_status → 'failed' and discarding valid
            # scalars. Now: sibling failure sets sibling_kinds_failed=True and
            # still returns 'complete' (scalars are intact).
            try:
                def _upsert_siblings():
                    supabase.rpc(
                        "upsert_strategy_analytics_series_batch",
                        {
                            "p_strategy_id": strategy_id,
                            "p_kinds": metrics_result.sibling_kinds,
                        },
                    ).execute()
                await db_execute(_upsert_siblings)
            except Exception as sibling_exc:  # noqa: BLE001
                logger.warning(
                    "csv analytics: sibling-table batch upsert failed for %s: %s",
                    strategy_id,
                    str(sibling_exc),
                )
                try:
                    existing = data_quality_flags or {}
                    existing["sibling_kinds_failed"] = True
                    existing["sibling_kinds_error"] = "SIBLING_BATCH_UPSERT_FAILED"
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
                except Exception as flag_exc:  # noqa: BLE001
                    logger.error(
                        "csv analytics: failed to record sibling_kinds_failed flag for %s: %s",
                        strategy_id, str(flag_exc),
                    )

        return {"status": "complete", "strategy_id": strategy_id}

    except HTTPException:
        raise
    except PaginatedSelectTruncated as trunc:
        # WR-03 (19.1-REVIEW) + audit-#52 fail-loud contract: mirror the
        # exchange runner's typed-truncation branch (lines 1399-1428).
        # The catch-all below would otherwise downgrade this to the
        # generic "CSV analytics computation failed." message and a
        # 500 — classify_exception then tags 500 as `unknown` →
        # indefinite retry on a permanent data-shape fault. Preserve
        # the typed signal so the dispatcher classifies it as permanent
        # and the operator-facing computation_error names the specific
        # cause.
        logger.error(
            "csv analytics: pagination truncation for %s "
            "(page_count=%d, page_size=%d, hint=%s)",
            strategy_id, trunc.page_count, trunc.page_size, trunc.hint or "n/a",
        )

        def _mark_truncated():
            supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "failed",
                    "computation_error": (
                        f"CSV analytics aborted: dataset exceeds "
                        f"{trunc.page_count * trunc.page_size:,} rows "
                        f"({trunc.hint or 'unknown source'}); operator "
                        "intervention required."
                    ),
                    "data_quality_flags": {"csv_source": True},
                },
                on_conflict="strategy_id",
            ).execute()
        try:
            await db_execute(_mark_truncated)
        except Exception as mark_exc:  # noqa: BLE001
            # Same defensive logging as _mark_unrecoverable below — if
            # the truncation-marker write itself fails, log so a stuck
            # 'computing' row has operator-visible evidence.
            logger.warning(
                "csv analytics: could not mark strategy %s truncated: %s",
                strategy_id,
                mark_exc,
            )
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("csv analytics failed for %s: %s", strategy_id, exc)

        # WR-05 (19.1-REVIEW): stamp csv_source=True so the provenance
        # pill survives the unrecoverable failure. Without it the
        # owner-side UI sees null data_quality_flags and falls back to
        # generic "missing data" copy instead of "CSV upload failed".
        def _mark_unrecoverable():
            supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "failed",
                    "computation_error": "CSV analytics computation failed.",
                    "data_quality_flags": {"csv_source": True},
                },
                on_conflict="strategy_id",
            ).execute()

        try:
            await db_execute(_mark_unrecoverable)
        except Exception as mark_exc:  # noqa: BLE001
            # PR #273 (T-19.1-03) — log BEFORE re-raise so a stuck
            # 'computing' row has log evidence pointing at the inner
            # mark-unrecoverable failure. Without this, the strategy
            # would be stuck in 'computing' forever with no operator
            # signal.
            logger.warning(
                "csv analytics: could not mark strategy %s unrecoverable: %s",
                strategy_id,
                mark_exc,
            )
        raise HTTPException(status_code=500, detail="CSV analytics computation failed")
