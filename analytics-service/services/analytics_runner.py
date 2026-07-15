"""Shared strategy analytics runner.

The sole live entry point is ``run_csv_strategy_analytics`` — the unified
CSV/backbone derive path: it loads csv_daily_returns and routes the scalar
metrics through the ONE shared ``derive_basis_series`` (since Phase 105).

Historically a second, trades-based path (the HTTP ``compute_analytics``
endpoint and its compute_jobs worker handler) ran a "load trades → compute
metrics → upsert strategy_analytics" sequence off the non-backbone route.
That dark chain and both its re-entry points were fully deleted in Stage B
(106-07/08/09); nothing may recompute a strategy off the trades path any
longer. The permanent grep-gate ``tests/test_dark_path_deleted.py`` keeps
that deletion state enforced across both runtimes.

The private helpers below (volume / trade-mix / derived-trade metrics,
position time-series loading, flag merging) are retained: they are the
computation units the metrics-parity and golden-fixture suites validate
directly, independent of any runner.
"""
from __future__ import annotations

import logging
import math
from collections import defaultdict
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any, TypedDict

from fastapi import HTTPException
from supabase import Client

from services.benchmark import get_benchmark_returns
from services.db import (
    PaginatedSelectTruncated,
    db_execute,
    get_supabase,
    paginated_select,
)
from services.metrics import (
    DEFAULT_PERIODS_PER_YEAR,
    periods_per_year_for_asset_class,
    _safe_float,
    # Retained as a patch seam for the run_csv_strategy_analytics tests; the
    # scalar compute itself now runs inside derive_basis_series (Phase 105),
    # so this name is not called directly here — keep it importable.
    compute_all_metrics,  # noqa: F401
)
from services.allocated_capital import (
    ALLOCATED_CAPITAL_GUARD_KEYS,
    ReturnsDenominatorConfigError,
    metrics_day_basis,
    parse_returns_denominator_config,
)
from services.equity.fallback import merge_dq_flags
from services.position_reconstruction import _normalize_side
from services.nav_twr import NAV_TWR_GUARD_KEYS

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


class DataQualityFlags(TypedDict, total=False):
    """Audit-2026-05-27 M-0657: the string-keyed bag persisted to
    `strategy_analytics.data_quality_flags` (JSONB the dashboard reads).

    Pre-fix it was typed `dict | None` and mutated across several regions of
    `run_csv_strategy_analytics` PLUS lifted from
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
    # Phase 92 (HARD-01): a single-day P&L dwarfed a small-but-above-dust prior
    # NAV (the inverse-perpetual near-zero-equity blow-up: |pnl_t| >=
    # PNL_DOM_RATIO * NAV_{t-1}). The honest core NaNs that day rather than
    # emitting an un-interpretable ~10-100x/day return that would compound into
    # a millions-of-% per-key contribution. The missing sibling of
    # flow_dominated_guard; a BOOL only (no raw NAV/P&L magnitude, the
    # account-size leak T-73-02); promotes computation_status to
    # complete_with_warnings on the same NAV_TWR_GUARD_KEYS channel.
    pnl_dominated_guard: bool
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
    # --- Fix B (v1.8 allocated-capital): mandate reporting-window exclusion. Fires
    # when a config-bearing (allocated-capital) strategy dropped P&L activity days
    # outside [mandate_start, mandate_end] — pre-mandate history and/or the
    # post-mandate winding-down tail. Bridged explicitly by derive_broker_dailies
    # (NOT a NAV_TWR_GUARD_KEYS member — it originates in the allocated_capital
    # meta, not NavTWRMeta); promotes computation_status to complete_with_warnings
    # on the same channel. ---
    mandate_window_excluded_days: bool
    # --- Phase 92 (HARD-04, #67): the annualization window (retained CAGR suffix
    # for geometric / returns span for simple) is under MIN_ANNUALIZATION_DAYS
    # calendar days, so annualizing CAGR over it (exponent 365/elapsed) is not
    # statistically meaningful. A DQ ANNOTATION ONLY — deliberately NOT a
    # NAV_TWR_GUARD_KEYS member and NEVER promotes computation_status: flagging
    # every young account complete_with_warnings would be factsheet-wide blast
    # radius (roadmap Pitfall #12). The CAGR value it annotates is unchanged. ---
    insufficient_window: bool
    # --- Phase 101 (MTM-01): the machine reason stamped by the broker derive
    # (job_worker._prestamp_dq_flags) when a single-key options book's
    # mark_to_market pass structurally degrades. run_csv_strategy_analytics is now
    # a PRODUCER of this key (it bridges the prestamped value through its wholesale
    # data_quality_flags rebuild), so it must be enumerated here. An availability
    # annotation ONLY — like insufficient_window it NEVER promotes
    # computation_status. Read by Phase-102's disabled-with-reason toggle. ---
    mtm_gated_reason: str
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


async def run_csv_strategy_analytics(strategy_id: str) -> dict[str, Any]:
    """Phase 19.1 / CSV → analytics pipeline Plan 02 Task 2.

    Analytics pipeline for source='csv' strategies. Loads
    csv_daily_returns, builds a pd.Series, and calls compute_all_metrics
    directly — bypasses the 700-line trades-to-returns chain used by the
    exchange-backed path. CSV uploads have no fills, no positions, no
    trade_mix, no volume metrics; those panels stay null on the
    strategy_analytics row.

    Skips the exchange-specific branches entirely (the deleted trades path).
    Sets computation_status='computing' on entry; 'complete' or 'failed' on
    exit.

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

    # Verify strategy exists BEFORE touching strategy_analytics; the
    # response is unused beyond the existence check.
    strategy_result = await db_execute(
        lambda: supabase.table("strategies")
        .select("id, user_id, api_key_id, returns_denominator_config, asset_class")
        .eq("id", strategy_id)
        .single()
        .execute()
    )
    if not strategy_result.data:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # MEDIUM-1 (v1.9, DQ-03): the broker-vs-user-CSV distinguisher for the
    # interior-break NaN reinstatement below. A BROKER-sourced strategy carries an
    # api_key_id — derive_broker_dailies gates its ENTIRE (dense, gap-filled) path
    # on `api_key_id IS NOT NULL` (job_worker._load_strategy_and_key), so a
    # broker series is ALWAYS gap-filled to a dense daily calendar BEFORE the
    # 74-04 NaN-skip write. A user CSV upload has api_key_id IS NULL (the wizard
    # "CSV branch") and is NEVER gap-filled — its missing dates are legitimately
    # absent (weekend / non-trading day) and MUST NOT be NaN-filled.
    # `.single()` returns the row as a dict; the isinstance guard keeps a
    # malformed/None probe response from being mis-read as broker-sourced.
    _strategy_row = strategy_result.data
    _is_broker_sourced = bool(
        isinstance(_strategy_row, dict) and _strategy_row.get("api_key_id")
    )

    # Mark computing.
    def _mark_computing() -> None:
        supabase.table("strategy_analytics").upsert(
            {"strategy_id": strategy_id, "computation_status": "computing"},
            on_conflict="strategy_id",
        ).execute()
    await db_execute(_mark_computing)

    # Phase 105 (BB-02, collapse #2, D1): the single-key cash SCALAR path joins the ONE
    # shared dailies-canonical derive route. Function-local import (matching the runner's
    # local `import pandas` idiom) keeps the import-cycle risk low AND binds the names for
    # BOTH the success persist and the terminal-arm heal-delete in the except block below.
    from services.basis_series import derive_basis_series, persist_basis_series

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
                        # SI-02 (MEDIUM-2): clear the runner-owned warned marker.
                        "computation_warned": False,
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

        # MEDIUM-1 (v1.9, DQ-03): reinstate the interior-break NaN for a
        # BROKER-sourced series at the load boundary. A guarded interior day
        # (flow-dominated / negative-NAV / dust) is np.nan and SKIPPED at the
        # csv_daily_returns write (74-04 NaN policy) → ABSENT from the stored
        # rows. Because the broker path gap-fills to a DENSE daily calendar
        # BEFORE that NaN-skip (broker_dailies.gap_fill_daily_returns), an in-span
        # missing calendar date can ONLY be such a refused/guarded day. Rebuilding
        # the series verbatim from the sparse stored rows would hide the break:
        # cumulative_twr_segmented would find no NaN and compound ACROSS it — the
        # exact bridging DQ-03 forbids (the twr_chain_broken flag still arrives via
        # the derive prestamp, but the money number would be the bridged figure).
        # Reindex to the dense [min,max] daily span so the in-span gaps become NaN
        # again; the segmenter then computes the suffix-only headline + CAGR.
        # GATED to broker sources: a user CSV (api_key_id IS NULL) is NOT
        # gap-filled, so its missing dates are legitimately absent and must stay
        # sparse — NaN-filling them would fabricate a break and corrupt the
        # headline of legitimate data.
        #
        # F-4 (convergence red team): the former `composite_dense_gap_fill` branch
        # (a 0.0-gap-filled COMPOSITE headline) is GONE. run_stitch_composite_job now
        # persists the composite headline DIRECTLY from its in-memory stitched series
        # (headline == metrics_json_by_basis.cash_settlement by construction) and no
        # longer routes through this function, so the flag had zero callers. Its
        # 0.0-fill for guard days was exactly the dishonest fabrication the root-cause
        # fix removed — keeping the dead branch invited re-routing the headline back
        # through the divergent path.
        if _is_broker_sourced and not returns.empty:
            dense_index = pd.date_range(
                returns.index.min(), returns.index.max(), freq="D"
            )
            returns = returns.reindex(dense_index)
            returns.name = "returns"

        benchmark_rets, benchmark_stale = None, True
        try:
            benchmark_rets, benchmark_stale = await get_benchmark_returns("BTC")
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "csv analytics: benchmark fetch failed for %s: %s",
                strategy_id, exc,
            )

        # Fix A (v1.8): thread the strategy's metrics CONVENTIONS into the SHIPPED
        # factsheet so it matches the harness-validated path — NOT a geometric /
        # √252 / calendar recompute of the persisted returns.
        #
        # Phase 105 (BB-02, collapse #2): these three conventions now feed the ONE shared
        # derive_basis_series route (the inline compute_all_metrics is GONE). The scalar
        # stays BYTE-IDENTICAL to the pre-105 compute BY CONSTRUCTION (D1): `returns` is
        # passed as `scalar_returns` (the exact legacy-conditioned series — the :2272
        # broker dense-reindex-with-NaN fork already ran), so the derive's default
        # 0.0-densify NEVER touches the scalar. `densify_policy` echoes HOW that scalar
        # was conditioned so the persisted series is round-trip-complete.
        #   * periods_per_year — ASSET-CLASS driven (#597): strategies.asset_class
        #     ('crypto' √365 / 'traditional' √252), backfilled 'crypto' for every
        #     api_key-sourced row, so a CSV-uploaded crypto strategy is ALSO √365
        #     (the old api_key_id proxy wrongly left it at 252). This is the same
        #     signal the OG card / ScenarioComposer / allocator portfolio read.
        #   * cumulative_method / day_basis — from returns_denominator_config (the
        #     allocated-capital override; Zavara → simple + active). Absent ⇒
        #     geometric + calendar (BYTE-IDENTICAL to the pre-Fix-A recompute).
        _periods_per_year = periods_per_year_for_asset_class(
            _strategy_row.get("asset_class") if isinstance(_strategy_row, dict) else None
        )
        _cumulative_method = "geometric"
        _day_basis = "calendar"
        _denominator_config = (
            parse_returns_denominator_config(
                _strategy_row.get("returns_denominator_config")
            )
            if isinstance(_strategy_row, dict)
            else None
        )
        if _denominator_config is not None:
            _cumulative_method = _denominator_config.cumulative_method
            # B2: EXHAUSTIVE fail-loud map (no silent calendar default on a typo'd /
            # future metrics_basis). ReturnsDenominatorConfigError is dispositioned
            # PERMANENT by the except branch below (mirrors the derive path).
            _day_basis = metrics_day_basis(_denominator_config.metrics_basis)

        # Phase 105 (BB-02, collapse #2): the single-key inline compute swaps for the
        # shared derive. `returns` serves BOTH params by construction (D1): as `returns`
        # it feeds `_drop_nonfinite` → the honest sparse rows/gap_spans; as
        # `scalar_returns` it is the EXACT legacy compute input (the :2272 conditioning
        # already ran), so the scalar is byte-identical to the pre-105 recompute. The
        # densify echo is broker → "broker_nan" (in-span gaps are guard NaN), user CSV →
        # "sparse" (verbatim — NEVER 0.0-weekend-filled: the broadest SC-4 blast radius).
        # A ValueError (<2 finite rows) lands in the SAME error handling the legacy
        # compute relied on. Downstream reads (.insufficient_window/.metrics_json/
        # .sibling_kinds) are duck-compatible with the old MetricsResult.
        metrics_result = derive_basis_series(
            returns,
            benchmark_rets,
            periods_per_year=_periods_per_year,
            cumulative_method=_cumulative_method,
            day_basis=_day_basis,
            benchmark_symbol="BTC",
            scalar_returns=returns,
            densify_policy="broker_nan" if _is_broker_sourced else "sparse",
        )

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
        # S3 — the allocated-capital warn flags (NOT NAV_TWR_GUARD_KEYS members: they
        # originate in the allocated_capital meta, not NavTWRMeta) ride the SAME
        # bridge via the ONE shared ALLOCATED_CAPITAL_GUARD_KEYS source, iterated
        # exactly like NAV_TWR_GUARD_KEYS above — so a new allocated warn flag
        # promotes here by construction instead of a hand-copied branch.
        for _flag in ALLOCATED_CAPITAL_GUARD_KEYS:
            if existing_flags.get(_flag):
                data_quality_flags[_flag] = True  # type: ignore[literal-required]
                _warned = True

        # Phase 101 (MTM-01): the broker derive PRESTAMPS `mtm_gated_reason` onto
        # this row (job_worker._prestamp_dq_flags) BEFORE enqueuing this CSV run,
        # when the single-key mark_to_market pass structurally degraded. This
        # rebuild REBUILDS data_quality_flags WHOLESALE (the fresh dict above), so
        # an unbridged reason is wiped seconds after being stamped — Phase 102's
        # disabled-with-reason toggle would then read nothing. Carry it
        # PRESENT-ONLY and NON-PROMOTING: it is an availability annotation (like
        # insufficient_window / HARD-04), NOT a NAV/allocated warn flag, so it must
        # NEVER touch `_warned` (the composite path likewise never promotes on this
        # key). EXCLUDE composite→single transitions: a stale composite-era reason
        # (e.g. `unsmoothed_options_book`) is meaningless for the NEW single-key
        # headline and must not masquerade as a fresh single-key verdict — mirror
        # the Finding-5 by-basis NULLing below (`_was_composite` is hoisted here
        # from its original site so both this exclusion and `_clear_stale_by_basis`
        # read the one lookup). The next broker derive re-evaluates and re-stamps
        # honestly.
        _was_composite = bool(existing_flags.get("composite"))
        _mtm_reason = existing_flags.get("mtm_gated_reason")
        if _mtm_reason and not _was_composite:
            data_quality_flags["mtm_gated_reason"] = _mtm_reason

        csv_status = "complete_with_warnings" if _warned else "complete"

        # HARD-04 (#67): lift the CAGR-site insufficient_window annotation.
        # Present-only additive; deliberately AFTER csv_status and NOT touching
        # `_warned`, so it NEVER promotes computation_status (a young-but-clean
        # CSV/MT5 account stays exact-string "complete" — not a NAV_TWR_GUARD_KEYS
        # member). The CAGR value it annotates is unchanged.
        if metrics_result.insufficient_window:
            data_quality_flags["insufficient_window"] = True

        # Finding 5 (non-composite direction): a strategy that STOPS being a
        # composite (members removed → single-key path) — or ANY non-composite CSV
        # recompute — is re-derived HERE with a fresh single-basis headline. The
        # freshly-built data_quality_flags above already drops the composite-only
        # flags (composite / per_key / gap_spans / gap_day_count / overlap_days /
        # mtm_gated_reason) because this upsert REPLACES the column wholesale. But
        # metrics_json_by_basis is NOT in this payload, so a prior composite's
        # object (incl. a stale mark_to_market key) would SURVIVE next to a now
        # single-key headline — silent disagreement. Null it so a stale composite
        # object can't linger. Gate on the prior row's `composite` flag so a pure
        # single-key strategy (never a composite) is byte-identical (no extra
        # column write). run_stitch_composite_job owns its OWN by-basis write and
        # never routes through this function, so any recompute HERE is genuinely
        # single-key. (`_was_composite` is assigned above, hoisted so the Phase-101
        # mtm_gated_reason exclusion shares the same lookup.)
        _clear_stale_by_basis = _was_composite

        def _mark_complete() -> None:
            payload: dict[str, Any] = {
                "strategy_id": strategy_id,
                "computation_status": csv_status,
                # SI-02: same runner-owned warned marker as the stored-trades path
                # (TRUE when the broker→CSV guard flags promoted csv_status,
                # FALSE on a clean run). The bridge branches (a)/(c) read it.
                "computation_warned": _warned,
                "computation_error": None,
                "data_quality_flags": data_quality_flags,
                "trade_metrics": None,    # CSV has no fills
                "volume_metrics": None,
                "exposure_metrics": None,
            }
            if _clear_stale_by_basis:
                # SQL NULL (never JSON null) — Phase 85 CHECK allows NULL or a jsonb
                # object. Python None → SQL NULL.
                payload["metrics_json_by_basis"] = None
            payload.update(metrics_result.metrics_json)
            supabase.table("strategy_analytics").upsert(
                payload, on_conflict="strategy_id"
            ).execute()

        # Phase 105 (BB-02, D5 ordering): persist the cash_settlement SERIES row BEFORE
        # the strategy_analytics scalar/status flip, so a `complete` scalar never exists
        # without its series (mirrors the job_worker series-before-DONE discipline). A
        # series-persist failure MUST abort BEFORE the scalar flip (fail-loud): it
        # propagates to the catch-all, which stamps failed AND heal-deletes the
        # (never-written) row. The single-key cash scalar is now a cache of this series.
        def _persist_cash_series() -> None:
            persist_basis_series(
                supabase, strategy_id, basis="cash_settlement", result=metrics_result,
            )
        await db_execute(_persist_cash_series)

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
                    # SI-02 (MEDIUM-2): clear the runner-owned warned marker.
                    "computation_warned": False,
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
    except ReturnsDenominatorConfigError as cfg_exc:
        # S1 / B2: a malformed returns_denominator_config (or an unknown
        # metrics_basis) is PERMANENT — never retry-forever. Mirror the derive path
        # (run_derive_broker_dailies_job stamps failed + permanent): the generic
        # `except Exception` below would downgrade this to a 500 → classify_exception
        # 'unknown' → indefinite transient retry, losing the reason. Stamp failed and
        # raise a 422 HTTPException (4xx ∈ 400..499 → classify_exception PERMANENT).
        logger.error(
            "csv analytics: malformed returns_denominator_config for %s: %s",
            strategy_id, cfg_exc,
        )

        def _mark_config_failed() -> None:
            supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "failed",
                    "computation_warned": False,
                    "computation_error": (
                        "Strategy returns_denominator_config is malformed; "
                        "operator intervention required."
                    ),
                    "data_quality_flags": {"csv_source": True},
                },
                on_conflict="strategy_id",
            ).execute()
        try:
            await db_execute(_mark_config_failed)
        except Exception as mark_exc:  # noqa: BLE001
            logger.warning(
                "csv analytics: could not mark strategy %s config-failed: %s",
                strategy_id, mark_exc,
            )
        raise HTTPException(
            status_code=422, detail="Malformed returns_denominator_config"
        ) from cfg_exc
    except Exception as exc:  # noqa: BLE001
        logger.error("csv analytics failed for %s: %s", strategy_id, exc)

        # WR-05 (19.1-REVIEW): stamp csv_source=True so the provenance
        # pill survives the unrecoverable failure. Without it the
        # owner-side UI sees null data_quality_flags and falls back to
        # generic "missing data" copy instead of "CSV upload failed".
        #
        # mig 20260707120000: READ-MODIFY-WRITE — do NOT wipe the column. This
        # path raises HTTP 500 → the job goes to failed_retry and the CSV run is
        # re-dispatched (derive is NOT re-run). A wholesale {csv_source:True}
        # write here destroyed any NAV_TWR_GUARD_KEYS that derive_broker_dailies
        # pre-stamped, so attempt 2's _read_existing_flags found none →
        # _warned=False → a clean 'complete' over a guard-refused series (the
        # exact laundering class this migration kills). Preserve prior flags.
        def _mark_unrecoverable() -> None:
            prior_res = (
                supabase.table("strategy_analytics")
                .select("data_quality_flags")
                .eq("strategy_id", strategy_id)
                .maybe_single()
                .execute()
            )
            prior_flags = dict(
                (getattr(prior_res, "data", None) or {}).get("data_quality_flags") or {}
            )
            prior_flags["csv_source"] = True
            supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "failed",
                    # SI-02 (MEDIUM-2): clear the runner-owned warned marker.
                    "computation_warned": False,
                    "computation_error": "CSV analytics computation failed.",
                    "data_quality_flags": prior_flags,
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

        # Phase 105 (BB-02, D3 SECONDARY): heal-DELETE the cash_settlement series row so a
        # stale row from a prior longer-history derive never outlives this authoritative
        # 'failed' stamp. DEFENSE-IN-DEPTH — the Plan-02 read gate is the primary
        # guarantee. A heal failure must NEVER mask the terminal stamp that invoked it:
        # swallow + warn (mirrors job_worker._heal_delete_basis_series).
        def _heal_delete_cash_series() -> None:
            persist_basis_series(
                supabase, strategy_id, basis="cash_settlement", result=None,
            )
        try:
            await db_execute(_heal_delete_cash_series)
        except Exception as heal_exc:  # noqa: BLE001
            logger.warning(
                "csv analytics: cash series heal-delete failed for %s "
                "(terminal stamp already applied): %s",
                strategy_id,
                heal_exc,
            )

        raise HTTPException(status_code=500, detail="CSV analytics computation failed")
