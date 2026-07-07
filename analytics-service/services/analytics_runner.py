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
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any, Literal, TypedDict

from fastapi import HTTPException
from supabase import Client

from services.benchmark import get_benchmark_returns
from services.db import (
    PaginatedSelectTruncated,
    db_execute,
    get_supabase,
    one,
    paginated_select,
    rows,
)
from services.metrics import _safe_float, compute_all_metrics
from services.equity.fallback import merge_dq_flags
from services.position_reconstruction import _normalize_side
from services.nav_twr import NAV_TWR_GUARD_KEYS, NavReconstructionError
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


# Audit-2026-05-27 H-0651: the valid `strategy_analytics_series.kind` values.
# `metrics_result.sibling_kinds` is mutated here and shipped to the
# `upsert_strategy_analytics_series_batch` SECURITY DEFINER RPC, which
# whitelists kinds server-side (migration 20260514045627 `v_allowlist`, which
# the comment there pins as matching the Python HEAVY_KINDS verbatim). The two
# kinds this module adds (exposure_series, turnover_series) need
# position_snapshots data so compute_all_metrics can't produce them; the other
# ten come from metrics.py. Typing the kind keys means a typo'd kind (e.g.
# `exposure_serie`) — which the RPC would silently drop, blanking a panel —
# surfaces at type-check time. Keep in sync with the RPC allowlist + metrics.py.
SiblingKind = Literal[
    "daily_returns_grid",
    "rolling_sortino_3m",
    "rolling_sortino_6m",
    "rolling_sortino_12m",
    "rolling_volatility_3m",
    "rolling_volatility_6m",
    "rolling_volatility_12m",
    "rolling_alpha",
    "rolling_beta",
    "log_returns_series",
    "exposure_series",
    "turnover_series",
]


class DataQualityFlags(TypedDict, total=False):
    """Audit-2026-05-27 M-0657: the string-keyed bag persisted to
    `strategy_analytics.data_quality_flags` (JSONB the dashboard reads).

    Pre-fix it was typed `dict | None` and mutated across ~8 regions of
    `run_strategy_analytics` / `run_csv_strategy_analytics` PLUS lifted from
    the producer via `_merge_into_top_level_flags`. A typo'd key (e.g.
    `benchmark_unavailble`) silently flowed to JSONB and the dashboard chip
    never fired. `total=False` because every key is conditional.

    Keys are grouped by producer:
      * directly assigned in analytics_runner (benchmark / position /
        fills / volume / trade_mix / account-balance / heuristic / sibling);
      * `csv_source` from run_csv_strategy_analytics;
      * lifted from reconstruct_positions' aggregated flags and the turnover
        series via `_merge_into_top_level_flags` (the `*_truncated{,_kept,
        _total}` derived keys come from `_emit_capped_flag_list`).
    A non-None merge can still introduce a key not listed here (the helper
    iterates source.items() dynamically); the enumeration documents the
    KNOWN contract so drift in the named producers is type-visible. New
    producers that add a key MUST add it here.
    """

    # --- benchmark ---
    benchmark_unavailable: bool
    benchmark_note: str
    # --- position reconstruction / snapshots (analytics_runner) ---
    position_reconstruction_failed: bool
    position_reconstruction_error: str
    position_snapshots_unavailable: bool
    position_snapshots_error: str
    position_metrics_failed: bool
    position_metrics_error: str
    # --- fills fetch / volume ---
    fills_fetch_failed: bool
    fills_fetch_error: str
    position_side_volume_failed: bool
    position_side_volume_error: str
    trade_mix_approximation: bool
    fills_missing_is_maker_pct: float
    # --- account balance / capital ---
    account_balance_unavailable: bool
    # Audit-2026-05-27 A1 (MED8): the stored account_balance_usdt was PRESENT
    # but non-numeric (corrupt). Distinct from account_balance_unavailable
    # ("no balance configured") and no_linked_api_key ("demo / no key").
    account_balance_corrupt: bool
    no_linked_api_key: bool
    used_heuristic_capital: bool
    balance_error: bool
    # --- Phase 74 (v1.8 Flow-Aware TWR): NAV-denominator guard keys lifted from
    # the NavTWRMeta the honest core carries onto returns_meta. Each fires only
    # when a day's chain-link BROKE (NaN) rather than divided by a fabricated
    # base; each promotes computation_status to complete_with_warnings. ---
    negative_nav_guard: bool
    dust_nav_guard: bool
    flow_dominated_guard: bool
    # --- Phase 76 (v1.8 DQ-02): flow-coverage terminus. Fires when a broker
    # account's return window extends BEFORE the venue's deposit-history
    # retention (OKX 90d / Bybit 365d) so the pre-terminus flows are unfetchable;
    # the honest core NaNs those days (refusing a fabricated return over the gap)
    # and this flag promotes computation_status to complete_with_warnings. Rides
    # the same channel as the NAV guard keys. ---
    flow_coverage_incomplete: bool
    # --- Phase 77 (v1.8 FLOW-04): open-uPnL materiality. Fires when the terminal
    # open unrealized PnL wedge is material (|wedge|/anchor > 5%) relative to a
    # non-dust anchor — the anchor-to-today NAV embeds uncrystallised MTM that the
    # realized-basis roll cannot reconstruct per-day. A BOOL only (no raw USD, the
    # account-size leak T-77-09); promotes computation_status to
    # complete_with_warnings on the same channel as the NAV guard keys. ---
    unrealized_pnl_in_anchor: bool
    # --- MUST-2 (v1.8): the open-uPnL wedge FIELD was unreadable on a MTM venue
    # (Deribit session_upl / OKX upl absent-or-garbled while the anchor read
    # cleanly). A wrong/renamed assumed field would silently coalesce to a 0.0
    # wedge — the FLOW-04 harm class minus even the warning. A BOOL only;
    # promotes computation_status to complete_with_warnings on the same channel
    # as the other guard keys so a wrong field name is LOUD. ---
    unrealized_pnl_unreadable: bool
    # --- sibling-table batch upsert ---
    sibling_kinds_failed: bool
    sibling_kinds_error: str
    # --- CSV provenance ---
    csv_source: bool
    # --- lifted from reconstruct_positions' aggregated_data_quality_flags ---
    breakeven_positions: int
    positions_missing_realized_pnl: int
    fills_dropped_no_symbol: int
    posSide_side_mismatch: bool
    duration_parse_errors: int
    zero_entry_price_dropped: int
    malformed_fill_field_dropped: int
    funding_attribution_failed: bool
    funding_window_corrupt_position: int
    funding_rows_unparseable: int
    funding_currency_unsupported: int
    exposure_metrics_skipped_shared_api_key: bool
    # Audit-2026-05-07 round-2 M1: companion to
    # `exposure_metrics_skipped_shared_api_key` covering the SERIES sibling
    # (`exposure_series`) that the same short-circuit drops alongside the
    # scalar aggregates. Emitted by `compute_exposure_metrics` in
    # services/position_reconstruction.py so the writer can distinguish
    # "series intentionally skipped" from "writer silently lost the field".
    exposure_series_skipped_shared_api_key: bool
    exposure_metrics_apikey_lookup_failed: bool
    exposure_metrics_no_snapshots: bool
    # --- cardinality-cap truncation siblings (realized_pnl + exposure) ---
    realized_pnl_per_trade_truncated: bool
    realized_pnl_per_trade_truncated_kept: int
    realized_pnl_per_trade_truncated_total: int
    exposure_series_truncated: bool
    exposure_series_truncated_kept: int
    exposure_series_truncated_total: int
    # --- lifted from compute_turnover_series_with_flags ---
    turnover_gap_dates: list[str]
    turnover_nav_missing_dates: list[str]
    turnover_nav_invalid_dates: list[str]
    turnover_series_dropped_dates: list[str]
    turnover_missing_price_dates: list[str]
    turnover_timestamp_coverage: float
    # `_emit_capped_flag_list` emits `{name}_truncated{,_kept,_total}` for
    # each of the five turnover lists above when they exceed the cap.
    turnover_gap_dates_truncated: bool
    turnover_gap_dates_truncated_kept: int
    turnover_gap_dates_truncated_total: int
    turnover_nav_missing_dates_truncated: bool
    turnover_nav_missing_dates_truncated_kept: int
    turnover_nav_missing_dates_truncated_total: int
    turnover_nav_invalid_dates_truncated: bool
    turnover_nav_invalid_dates_truncated_kept: int
    turnover_nav_invalid_dates_truncated_total: int
    turnover_series_dropped_dates_truncated: bool
    turnover_series_dropped_dates_truncated_kept: int
    turnover_series_dropped_dates_truncated_total: int
    turnover_missing_price_dates_truncated: bool
    turnover_missing_price_dates_truncated_kept: int
    turnover_missing_price_dates_truncated_total: int


def _merge_into_top_level_flags(
    target: dict[str, Any] | None,
    source: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
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
    # B22: the per-key bool-OR / int-sum / else-replace rule (with the
    # non-numeric-prior-as-0 type guards) is the canonical reducer in
    # services.equity.fallback — the same function the position engine routes
    # through. This wrapper keeps the None-preserving target semantics above
    # and delegates the merge so the (formerly three) copies cannot diverge.
    return merge_dq_flags(merged, source)


async def _load_position_time_series(
    strategy_id: str,
    supabase: Client,
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

    # Audit-2026-05-07 M-0654: a malformed `size_usd` was silently coerced to
    # 0.0 and then dropped by the zero-tolerance skip below — corrupting the
    # turnover/exposure grids by, e.g., 5% with NO operator signal if a
    # migration left non-numeric values on a fraction of rows. Same for a
    # non-numeric `mark_price` (silently skipped). Count both and emit a
    # logger.warning, mirroring the counter+warning convention already used by
    # the sibling fill helpers (`_compute_volume_metrics`,
    # `_compute_volume_aggregator`, `_compute_trade_mix`,
    # `_compute_position_side_volume_pcts`). NaN/Inf parse without raising, so
    # guard `isfinite` too — a NaN size_usd would otherwise pass the tolerance
    # check (abs(nan) < tol is False) and poison `signed` / max_gross_exposure.
    size_usd_parse_failed = 0
    mark_price_parse_failed = 0

    for snap in snapshots:
        d = snap.get("snapshot_date")
        sym = snap.get("symbol")
        # Audit-2026-05-27 H-0650: shared normalization boundary (was
        # `(snap.get("side") or "").lower()`). Behavior-identical for current
        # lowercase/falsy input.
        side = _normalize_side(snap.get("side"))
        size_raw = snap.get("size_usd")
        mark_raw = snap.get("mark_price")
        if not d or not sym:
            continue
        size_malformed = False
        try:
            size_usd = float(size_raw) if size_raw is not None else 0.0
            if not math.isfinite(size_usd):
                size_usd = 0.0
                size_malformed = size_raw is not None
        except (TypeError, ValueError):
            size_usd = 0.0
            size_malformed = True
        if size_malformed:
            size_usd_parse_failed += 1
        # Skip flat or near-zero-size rows (per migration 034 comment they're
        # usually not stored, but defensive). H-0644 / H-0654 motivates the
        # tolerance — see POSITION_SIZE_ZERO_TOLERANCE_USD docstring. A
        # malformed size_usd lands here too (coerced to 0.0) — already counted
        # above so the drop is observable, not silent (M-0654).
        if side == "flat" or abs(size_usd) < POSITION_SIZE_ZERO_TOLERANCE_USD:
            continue
        signed = size_usd if side == "long" else -size_usd
        positions_by_date.setdefault(d, {})[sym] = signed
        if mark_raw is not None:
            try:
                mark_val = float(mark_raw)
                if math.isfinite(mark_val):
                    prices_by_date.setdefault(d, {})[sym] = mark_val
                else:
                    # Don't poison prices_by_date with NaN/Inf marks, but
                    # count the drop (M-0654) so it isn't silent.
                    mark_price_parse_failed += 1
            except (TypeError, ValueError):
                # Don't poison prices_by_date with non-numeric marks; count
                # the drop (M-0654) instead of swallowing it silently.
                mark_price_parse_failed += 1

    # M-0654: surface malformed-row counts the same way the fill helpers do —
    # a counter + a single warning per run. Silent 0.0 coercion of monetary
    # snapshot fields previously degraded the turnover/exposure panels with no
    # operator-visible signal.
    if size_usd_parse_failed > 0:
        logger.warning(
            "_load_position_time_series: %d snapshot row(s) had non-numeric or "
            "non-finite size_usd (coerced to 0 and dropped); turnover/exposure "
            "grids may be understated for strategy %s.",
            size_usd_parse_failed, strategy_id,
        )
    if mark_price_parse_failed > 0:
        logger.warning(
            "_load_position_time_series: %d snapshot row(s) had non-numeric or "
            "non-finite mark_price (price omitted); turnover ratios for those "
            "symbol-dates may be unavailable for strategy %s.",
            mark_price_parse_failed, strategy_id,
        )

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


def _compute_volume_metrics(fills: list[dict[str, Any]]) -> dict[str, Any]:
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
        # Audit-2026-05-27 H-0650: shared normalization boundary (was
        # `(fill.get("side") or "").lower()`). Behavior-identical for current
        # lowercase/falsy input.
        side = _normalize_side(fill.get("side"))
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
    fills: list[dict[str, Any]], positions: list[dict[str, Any]]
) -> dict[str, Any]:
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
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
        # F6 (red-team HIGH8): normalize to tz-aware UTC. `fromisoformat` yields
        # a NAIVE datetime for a date-only / offset-less string but an AWARE one
        # for an offset-bearing string. The window comparisons below mix
        # timestamps from `positions` (opened_at/closed_at) and `trades`
        # (filled_at), which can disagree on tz-format → `TypeError: can't
        # compare offset-naive and offset-aware` → swallowed by the broad except
        # at the call site → position_side_volume_failed=True, silently dropping
        # the long/short volume panel for the WHOLE strategy on valid data.
        # Mirror the single-boundary normalization used elsewhere (match.py
        # _parse_supabase_ts): promote naive → UTC, convert aware → UTC.
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

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
    volume_metrics: Mapping[str, Any],
    trade_metrics_from_positions: Mapping[str, Any],
) -> dict[str, Any]:
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

    out: dict[str, Any] = {
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
    def _finite_pnl(t: dict[str, Any]) -> float | None:
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


def _compute_volume_aggregator(fills: list[dict[str, Any]]) -> dict[str, float]:
    """METRICS-09: aggregate volume metrics over fills (raw_fills WHERE is_fill=true).

    Returns:
      gross_volume_usd          — sum of |notional_usd| over every fill
      mean_trade_size_usd       — gross_volume / N
      mean_daily_turnover_usd        — mean of per-day notional totals (group by date prefix)
      mean_monthly_turnover_usd      — mean of per-month notional totals (group by YYYY-MM prefix)
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
            "mean_daily_turnover_usd": 0.0,
            "mean_monthly_turnover_usd": 0.0,
        }

    # Single pass: parse notional once, accumulate gross + daily/monthly buckets.
    gross_volume = 0.0
    daily: dict[str, float] = defaultdict(float)
    monthly: dict[str, float] = defaultdict(float)
    ts_skipped = 0

    # Audit-2026-05-07 M-0645: `mean_trade_size_usd` must average over fills
    # that carry a REAL notional, not over every row. raw_fills includes
    # zero-notional rows (orders placed but never filled, cancelled, or
    # malformed-coerced-to-0) — dividing gross_volume by len(fills) silently
    # shrinks the mean toward zero in proportion to how many dead rows exist.
    # Count fills with notional > 0 and use that as the denominator instead.
    nonzero_notional_count = 0

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
        if notional > 0:
            nonzero_notional_count += 1

        ts = f.get("filled_at") or f.get("created_at") or ""
        if not ts or len(ts) < 10:
            ts_skipped += 1
            continue
        day = ts[:10]
        month = ts[:7]
        daily[day] += notional
        monthly[month] += notional

    n = len(fills)
    # M-0645: divide by the count of fills with a real (> 0) notional so
    # zero-notional rows don't dilute the mean. Guard divide-by-zero — an
    # all-zero-notional fill set yields mean 0.0 (no real trades to average).
    mean_size = gross_volume / nonzero_notional_count if nonzero_notional_count else 0.0
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
        "mean_daily_turnover_usd": daily_avg,
        "mean_monthly_turnover_usd": monthly_avg,
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


class TradeMixBucket(TypedDict):
    """Audit-2026-05-27 M-0655: per-bucket shape for `_compute_trade_mix`.

    Pre-fix `_compute_trade_mix` was annotated `-> dict[str, dict[str, float]]`,
    but `count` is an `int` (`"count": 0` seed, `count += 1`) — only
    `total_notional` is a float. The lying `float` annotation would mask a
    consumer that did integer-only math on `count` (e.g. modulo) drifting if
    the value were ever a float. Pin the precise per-field types.
    """

    count: int
    total_notional: float


# Audit-2026-05-27 M-0656: `_compute_trade_mix` returns one of two key sets,
# selected by `has_maker_taker`. Both are `dict[str, TradeMixBucket]`; the
# distinction is the KEY SET, not the value shape:
#   - has_maker_taker=True  → {long_maker, long_taker, short_maker, short_taker}
#   - has_maker_taker=False → {long, short}
# A per-mode TypedDict (fixed keys, total=True) documents each contract while
# keeping the runtime output (a plain dict) identical. The union alias is the
# declared return type; callers narrow on the mode they requested.
class TradeMix4Bucket(TypedDict):
    long_maker: TradeMixBucket
    long_taker: TradeMixBucket
    short_maker: TradeMixBucket
    short_taker: TradeMixBucket


class TradeMix2Bucket(TypedDict):
    long: TradeMixBucket
    short: TradeMixBucket


TradeMixResult = TradeMix4Bucket | TradeMix2Bucket


def _compute_trade_mix(
    fills: list[dict[str, Any]], has_maker_taker: bool
) -> TradeMixResult:
    """Trade Mix breakdown by side × maker/taker.

    Bucket count branches off the is_maker audit outcome:
      - has_maker_taker=True  → 4 buckets (long_maker, long_taker, short_maker, short_taker)
      - has_maker_taker=False → 2 buckets fallback (long, short)

    Each bucket: {count: int, total_notional: float} (TradeMixBucket).

    In 4-bucket mode, fills with `is_maker` missing/None are skipped — can't
    bucket without the flag. The audit gate only sets has_maker_taker=True
    when ≥99% of fills carry it, so skipped fills are a known small fraction.

    Side mapping is fill-level (buy→long, sell→short); a "buy to close short"
    is bucketed as a long entry. The approximation matches the panel labels
    (maker/taker fee-tier exposure vs entry direction).
    """

    def _empty_bucket() -> TradeMixBucket:
        return {"count": 0, "total_notional": 0.0}

    # Internal accumulator is keyed by str (the bucket key is computed from
    # side × maker/taker below); the return type narrows to one of the two
    # mode TypedDicts (M-0656). Runtime output is a plain dict, unchanged.
    buckets: dict[str, TradeMixBucket]
    if has_maker_taker:
        buckets = {
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
        # Audit-2026-05-27 H-0650: normalize via the shared boundary BEFORE the
        # buy/sell alias + bucket-key equality. Pre-fix this path read
        # `f.get("side")` raw (the ONLY one of the three side-parse regimes
        # that did NOT case-fold), so an uppercase `side="LONG"` matched
        # neither `buy`/`sell` nor the lowercase bucket keys and was silently
        # dropped from trade_mix. Folding case here aligns it with the
        # FIFO / volume / snapshot regimes. Current lowercase input is
        # unchanged (`"long"`/`"short"`/`"buy"`/`"sell"` fold to themselves).
        side = _normalize_side(f.get("side"))
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

    # M-0656: narrow the str-keyed accumulator to the mode TypedDict the
    # declared return type promises. Reconstructing from the known keys (the
    # exact keys initialized above, never mutated to add new ones) is
    # behaviour-identical to returning `buckets` — same keys, same bucket
    # objects — while satisfying the union return type without a cast.
    if has_maker_taker:
        return TradeMix4Bucket(
            long_maker=buckets["long_maker"],
            long_taker=buckets["long_taker"],
            short_maker=buckets["short_maker"],
            short_taker=buckets["short_taker"],
        )
    return TradeMix2Bucket(long=buckets["long"], short=buckets["short"])


# KPI-17: per-strategy gate threshold for switching to 4-bucket Trade Mix.
# Matches D-15 audit gate (≥99% is_maker population on the strategy's fills).
_MAKER_TAKER_COVERAGE_THRESHOLD = 0.99


def _has_maker_taker_coverage(fills: list[dict[str, Any]]) -> bool:
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


def _is_trade_mix_approximate(positions: list[dict[str, Any]]) -> bool:
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


async def run_strategy_analytics(strategy_id: str) -> dict[str, Any]:
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

    strategy_row = one(strategy_result)
    if not strategy_row:
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

        trades = rows(result)
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
        # Audit-2026-05-27 A1 (MED8): a non-numeric / corrupt
        # api_keys.account_balance_usdt is DISTINCT from "no balance
        # configured". Pre-fix `float(balance_raw)` raised inside the broad
        # `except Exception` below and routed to account_balance_unavailable,
        # conflating "stored value is garbage" (a data-integrity bug worth
        # surfacing) with the documented no-balance/demo meaning of that flag.
        account_balance_corrupt = False
        no_linked_api_key = False
        # Hoisted out of the try so the except handler can route based on
        # whether api_key_id was set BEFORE the throw — otherwise a fetch
        # failure would always set account_balance_unavailable, even for
        # demo strategies, re-introducing the demo-vs-failure conflation
        # the flag split was meant to eliminate.
        api_key_id: str | None = None
        try:
            api_key_id = strategy_row.get("api_key_id")
            if api_key_id:
                key_result = await db_execute(
                    lambda: supabase.table("api_keys")
                    .select("account_balance_usdt")
                    .eq("id", api_key_id)
                    .single()
                    .execute()
                )
                # Use `is not None` so a literal 0 / 0.0 (drained
                # account, or operator zeroed it) is distinguishable from
                # NULL. A truthy check would conflate "real zero" with
                # "no balance configured" and silently mark the strategy
                # as degraded forever.
                key_row = one(key_result)
                balance_raw = (
                    key_row.get("account_balance_usdt") if key_row else None
                )
                if balance_raw is not None:
                    # Audit-2026-05-27 A1 (MED8): narrow the cast so a corrupt
                    # stored value (e.g. "", "N/A", "12.3USDT") raises HERE and
                    # is routed to a DISTINCT account_balance_corrupt flag —
                    # NOT swallowed by the broad except below and mislabeled as
                    # account_balance_unavailable. account_balance stays None
                    # (NAV proxy semantics unchanged, per _load_position_time_
                    # series), but the corruption is surfaced for the owner UI.
                    try:
                        account_balance = float(balance_raw)
                    except (TypeError, ValueError):
                        account_balance_corrupt = True
                        logger.warning(
                            "Corrupt account_balance_usdt=%r for strategy %s "
                            "(api_key %s) — not numeric; treating as unavailable "
                            "for NAV but flagging distinctly",
                            balance_raw, strategy_id, api_key_id,
                        )
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
            ExposureMetrics,
            PositionTradeMetrics,
            reconstruct_positions,
            compute_exposure_metrics,
            compute_turnover_series_with_flags,
        )

        # H-0638: consume the producer's typed contract (was bare `dict`).
        trade_metrics_from_positions: PositionTradeMetrics = {}
        # H-0658/H-0659: the producer never returns None, so the honest
        # consumer type is `ExposureMetrics` (the `or {}` on the assignment
        # below + the later `isinstance(..., dict)` guard are defensive, not a
        # live None path). `{}` is a valid total=False ExposureMetrics.
        exposure_metrics: ExposureMetrics = {}
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
        fills_data: list[dict[str, Any]] = []
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
        position_side_pcts: dict[str, Any] = {}
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
                positions_list = rows(pos_result)
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

        # Audit-2026-05-07 round-2 H-0737 (info-disclosure RLS leak): strip the
        # per-trade realized PnL list from the PERSISTED `strategy_analytics.
        # trade_metrics` JSONB. The list is read INTERNALLY by
        # `_compute_derived_trade_metrics` above (weighted R:R, SQN) — we
        # keep it inside `trade_metrics_from_positions` for that computation,
        # but it MUST NOT reach the public-readable column.
        #
        # Threat: the `analytics_read` RLS policy on `strategy_analytics`
        # allows ANY authenticated user to SELECT trade_metrics for any
        # published strategy. Each entry exposes per-trade PnL (capped at
        # 10000) AND side ("long" / "short"), enough for an allocator or a
        # competitor with allocator creds to reverse-engineer the underlying
        # algorithm's entry/exit cadence and direction bias.
        #
        # Decision: option (a) from the round-2 brief — drop the key from the
        # JSONB write entirely. The only `src/` reference is the schema gate
        # in metrics-parity-helper.ts (FROZEN_TRADE_METRICS_KEYS); that list
        # is updated in the same change. No UI surface renders this field.
        merged_trade_metrics.pop("realized_pnl_per_trade", None)

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
        # Audit-2026-05-27 H-0651: pin the mutated kind keys to the SiblingKind
        # Literal so a typo can't slip past into a kind the RPC silently drops.
        if exposure_series_payload:
            _exposure_kind: SiblingKind = "exposure_series"
            metrics_result.sibling_kinds[_exposure_kind] = (
                exposure_series_payload
            )
        if turnover_series:
            _turnover_kind: SiblingKind = "turnover_series"
            metrics_result.sibling_kinds[_turnover_kind] = turnover_series

        # Build data quality flags (combine benchmark + position-side failures).
        # M-0657: typed bag (was `dict | None`) — see DataQualityFlags. The
        # runtime value may still gain dynamically-merged producer keys via
        # `_merge_into_top_level_flags`, so the type documents the known
        # contract rather than sealing it.
        data_quality_flags: DataQualityFlags | None = None
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
        # Audit-2026-05-27 A1 (MED8): corrupt stored balance gets its OWN flag,
        # not account_balance_unavailable — preserves the data-integrity signal.
        if account_balance_corrupt:
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["account_balance_corrupt"] = True
        if no_linked_api_key:
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["no_linked_api_key"] = True

        # Audit-2026-05-07 #9 (PR-7 consumer migration) — surface
        # used_heuristic_capital and balance_error from the
        # ReturnsComputationMeta returned by trades_to_daily_returns_with_status.
        # The factsheet UI uses these keys to render an "approximate"
        # chip on CAGR/Sharpe rather than presenting them as canonical.
        #
        # Suppress used_heuristic_capital when account_balance_unavailable,
        # account_balance_corrupt, OR no_linked_api_key already fires — the
        # heuristic is the downstream consequence of those upstream states, not
        # a distinct condition. Surfacing both would render two redundant
        # "approximate" chips on the factsheet for one underlying state.
        if returns_meta["used_heuristic_capital"] and not (
            account_balance_unavailable
            or account_balance_corrupt
            or no_linked_api_key
        ):
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["used_heuristic_capital"] = True
        if returns_meta["balance_error"]:
            data_quality_flags = data_quality_flags or {}
            data_quality_flags["balance_error"] = True

        # Phase 74 (v1.8 Flow-Aware TWR) — lift the three NAV-denominator guard
        # keys the Phase-73 honest core now carries onto returns_meta (via the
        # NavTWRMeta contract, 74-02). A guard fires when a day's NAV
        # denominator was not a usable base (dust / negative / flow-dominated),
        # so the core BROKE that day's chain-link (NaN) instead of dividing by a
        # fabricated floor — the very "invalid presented as valid" harm this
        # milestone kills. These keys are additive and present on returns_meta
        # ONLY when they fired (NavTWRMeta is total=False), so a no-guard
        # flow-less / estimated_start>0 account carries NONE of them and stays
        # status-identical to today (the 8 exact-string 'complete' consumers are
        # unaffected — see the consumer_specific_flags block below). Same
        # additive shape + None-vs-empty-dict guarding as used_heuristic_capital.
        # Phase 76 (v1.8 DQ-02) — flow_coverage_incomplete joins the additive
        # NavTWRMeta guard-key lift. It fires when the flow-coverage terminus
        # segmented a retention gap (unfetchable pre-terminus flows), and like the
        # NAV guards it is present ONLY when it fired, so a fully-covered account
        # carries none of them and stays status-identical (SC-4). Phase 77
        # (unrealized_pnl_in_anchor) + MUST-2 (unrealized_pnl_unreadable) join the
        # same additive lift. SHOULD-1: iterate the ONE shared NAV_TWR_GUARD_KEYS
        # source so adding a guard propagates here by construction.
        for _guard_key in NAV_TWR_GUARD_KEYS:
            if returns_meta.get(_guard_key):
                data_quality_flags = data_quality_flags or {}
                data_quality_flags[_guard_key] = True  # type: ignore[literal-required]

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
        # `data_quality_flags` carried the DataQualityFlags contract through the
        # typed direct writes above (M-0657 typo-guard). The producer-flag merge
        # below introduces dynamically-keyed flags (see the DataQualityFlags
        # docstring), so widen to the open `dict[str, Any]` the canonical reducer
        # operates on. `{**...}` preserves the None-vs-empty distinction the
        # upsert relies on (null vs {} for a zero-flag strategy).
        top_level_flags: dict[str, Any] | None = (
            {**data_quality_flags} if data_quality_flags is not None else None
        )
        if inner_position_flags:
            top_level_flags = _merge_into_top_level_flags(
                top_level_flags, inner_position_flags
            )
        if turnover_flags:
            top_level_flags = _merge_into_top_level_flags(
                top_level_flags, turnover_flags
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
        #
        # Phase 74 (v1.8) — the three NAV-denominator guard keys join the
        # consumer-promoting set. A guard means a day's return was BROKEN (NaN),
        # not merely approximated, so a guarded run is at least as degraded as a
        # heuristic-capital run and MUST promote to complete_with_warnings for
        # the same reason (SC-4 semantics preserved). They are consumer-safe:
        # unlike the section-level flags above, a guard key appears ONLY when a
        # real NAV fault fired, so a clean flow-less account never trips them and
        # keeps its exact-string 'complete' the 8 consumers gate on.
        # The two heuristic-capital signals stay explicit; the NAV/flow/uPnL
        # guard keys promote via the ONE shared NAV_TWR_GUARD_KEYS source
        # (SHOULD-1) so a new guard promotes here by construction. A guard means a
        # day's return was BROKEN (NaN) or the anchor embeds unmeasured MTM — at
        # least as degraded as a heuristic-capital run → complete_with_warnings.
        _tlf = top_level_flags or {}
        consumer_specific_flags = (
            _tlf.get("used_heuristic_capital")
            or _tlf.get("balance_error")
            or any(_tlf.get(_k) for _k in NAV_TWR_GUARD_KEYS)
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
        upsert_payload: dict[str, Any] = {
            "strategy_id": strategy_id,
            "computation_status": computation_status_value,
            "computation_error": None,
            "data_quality_flags": top_level_flags,
            **metrics_result.metrics_json,
            "trade_metrics": merged_trade_metrics,
            "volume_metrics": volume_aggregator,
            "exposure_metrics": exposure_metrics,
        }
        await db_execute(
            lambda: supabase.table("strategy_analytics").upsert(
                upsert_payload,
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
                    existing = top_level_flags or {}
                    existing["sibling_kinds_failed"] = True
                    # Audit 2026-05-07 G12.G.10: stable enum code, not raw exc.
                    existing["sibling_kinds_error"] = "SIBLING_BATCH_UPSERT_FAILED"
                    flag_payload: dict[str, Any] = {
                        "strategy_id": strategy_id,
                        "data_quality_flags": existing,
                    }
                    await db_execute(
                        lambda: supabase.table("strategy_analytics")
                        .upsert(
                            flag_payload,
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
    except NavReconstructionError as exc:
        # Phase 74 (v1.8 Flow-Aware TWR) — a NAV/TWR reconstruction failure
        # (non-finite/non-numeric anchor or pnl, an undatable or orphan external
        # flow) is a PERMANENT STRUCTURAL fault: the input can never
        # reconstruct, so retrying only burns the dispatcher's retry budget. As
        # a bare ValueError it would fall through to the generic `except
        # Exception` below → HTTPException(500) → classify_exception 'unknown' →
        # retried forever (T-74-02). Catch the TYPED subclass, stamp a terminal
        # 'failed' (so the wizard reaches a gate instead of an infinite
        # 'computing' spinner), and raise HTTPException(422) so
        # classify_exception buckets it permanent (422 ∈ 400..499, not
        # 408/429/403/404). Mirrors the LedgerValuationError catch at
        # job_worker.py:1916-1941. Narrowed to NavReconstructionError so a
        # transient ValueError escaping elsewhere still hits the generic handler
        # and stays transient-retryable — never silently marked permanent.
        # scrub_freeform_string strips any account-size USD / row repr from the
        # message before it is stamped or surfaced (T-74-03 — never log raw
        # NAV/flow magnitudes); detail carries only the scrubbed text and NO
        # `from exc` chain so the unscrubbed repr cannot leak into
        # classify_exception's __cause__ append.
        from services.redact import scrub_freeform_string

        scrubbed = str(scrub_freeform_string(str(exc)))
        logger.error(
            "Compute analytics: NAV/TWR reconstruction failed for %s: %s",
            strategy_id, scrubbed,
        )
        await db_execute(
            lambda: supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "failed",
                    "computation_error": (
                        "NAV/TWR reconstruction failed (unusable return "
                        "denominator or malformed input); operator "
                        "intervention required. " + scrubbed
                    ),
                },
                on_conflict="strategy_id",
            ).execute()
        )
        raise HTTPException(
            status_code=422, detail="NAV/TWR reconstruction failed"
        )
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


async def run_csv_strategy_analytics(strategy_id: str) -> dict[str, Any]:
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
        def _load_series() -> list[dict[str, Any]]:
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
            def _mark_failed() -> None:
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

        data_quality_flags: DataQualityFlags = {"csv_source": True}  # M-0657
        if benchmark_stale or benchmark_rets is None:
            data_quality_flags["benchmark_unavailable"] = True
            data_quality_flags["benchmark_note"] = "Benchmark data unavailable."

        # Phase 76 (v1.8 DQ-02 + DQ-01): the broker path PRE-STAMPS the coverage
        # terminus flag AND the NAV-denominator guard flags (negative/dust/flow-
        # dominated) onto this strategy_analytics row (job_worker,
        # derive_broker_dailies) BEFORE enqueuing this CSV run — the guard-broken
        # / pre-terminus days are honestly absent from csv_daily_returns, so these
        # flags are the only channel that tells the factsheet a day was refused.
        # Read each pre-existing flag and PRESERVE it (a full _mark_complete upsert
        # would otherwise wipe it) + promote status to complete_with_warnings when
        # ANY fired (MED-2 bridges the DQ-01 guard flags to the broker factsheet).
        def _read_existing_flags() -> dict[str, Any]:
            res = (
                supabase.table("strategy_analytics")
                .select("data_quality_flags")
                .eq("strategy_id", strategy_id)
                .maybe_single()
                .execute()
            )
            row = getattr(res, "data", None) or {}
            return dict(row.get("data_quality_flags") or {})

        existing_flags = await db_execute(_read_existing_flags)
        # SHOULD-1: the pre-stamped broker warn flags (the NAV/flow/uPnL guard
        # keys derive_broker_dailies stamps onto strategy_analytics) ride the
        # broker→CSV bridge → complete_with_warnings. Iterate the ONE shared
        # NAV_TWR_GUARD_KEYS source so a new guard surfaces here by construction.
        _warned = False
        for _flag in NAV_TWR_GUARD_KEYS:
            if existing_flags.get(_flag):
                data_quality_flags[_flag] = True  # type: ignore[literal-required]
                _warned = True
        csv_status = "complete_with_warnings" if _warned else "complete"

        def _mark_complete() -> None:
            payload: dict[str, Any] = {
                "strategy_id": strategy_id,
                "computation_status": csv_status,
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
                def _upsert_siblings() -> None:
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
                    csv_flag_payload: dict[str, Any] = {
                        "strategy_id": strategy_id,
                        "data_quality_flags": existing,
                    }
                    await db_execute(
                        lambda: supabase.table("strategy_analytics")
                        .upsert(
                            csv_flag_payload,
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

        def _mark_truncated() -> None:
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
        def _mark_unrecoverable() -> None:
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
