"""Perfect Match Engine router — admin-only match queue computations.

POST /api/match/recompute            Single-allocator recompute (called from Next.js admin)
POST /api/match/cron-recompute       Daily cron that loops all allocators

See docs/superpowers/plans/2026-04-07-perfect-match-engine.md Phase 2.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.db import get_supabase
from services.equity_reconstruction import reconstruct_symbol_returns
from services.match_engine import (
    ENGINE_VERSION,
    TOP_N_CANDIDATES,
    WEIGHTS_VERSION,
    score_candidates,
)
from services.match_eval import (
    PaginatedSelectTruncated,
    compute_hit_rate_metrics,
)

router = APIRouter(prefix="/api/match", tags=["match"])
logger = logging.getLogger("quantalyze.analytics")

# Per-allocator scoring concurrency. This Semaphore is PROCESS-LOCAL and the
# cron loop awaits _score_one_allocator sequentially, so today at most one
# holder is ever active and the bound does not gate anything — it only becomes
# load-bearing if a future change fans the loop out with asyncio.gather.
#
# H-0562: there is NO cross-worker serialization here. Unlike the portfolio
# cron (routers/cron.py), this router has no in-flight marker row, and
# match_batches has no UNIQUE constraint on (allocator_id, computed_at)
# (migration 20260407164606_perfect_match.sql only adds the NON-unique
# idx_match_batches_allocator_recent). So if the deploy ever scales to 2+
# FastAPI workers AND this loop is parallelised, two workers can each insert a
# duplicate batch for the same allocator+second. Before doing either, add a
# Postgres advisory lock keyed on allocator_id (or a UNIQUE constraint on
# match_batches) — do NOT assume this Semaphore protects multi-worker runs.
_scoring_semaphore = asyncio.Semaphore(3)

# Skip recompute if the last batch is newer than this threshold (unless forced)
RECOMPUTE_MIN_AGE_HOURS = 12

# NEW-C08-06: minimum interval between forced recomputes per allocator.
# force=True bypasses the 12h age guard, so a looped caller (SERVICE_KEY
# holder past the Next.js rate limiter) could stack concurrent scoring and
# retention churn. This in-memory gate enforces a 30-second floor per
# allocator_id on the FORCED path only (normal age-gated recomputes are
# unaffected). Process-local — a pod restart resets it, which is acceptable.
FORCE_RECOMPUTE_MIN_INTERVAL_S = 30
_force_last_run: dict[str, float] = {}  # allocator_id → monotonic timestamp

# The demo founder-view endpoint (/api/demo/match/[allocator_id]) is anon/public
# and hard-locks to this seeded ALLOCATOR_ACTIVE_ID (src/lib/demo.ts). Candidate
# universe for THIS allocator MUST be filtered to is_example=true so real
# published strategies cannot leak (name, manager_id, AUM, max_capacity) through
# the public demo endpoint.
_DEMO_ALLOCATOR_ID = "aaaaaaaa-0001-4000-8000-000000000002"

# Composite-score threshold for flagging holdings. Scale is 0..100 per
# match_engine.final_score; matches the TypeScript-side parity test in
# allocations/lib/holding-outcome-adapter.test.ts.
FLAG_COMPOSITE_THRESHOLD = 50


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class RecomputeRequest(BaseModel):
    # UUID type forces a 422 at the request boundary for malformed input
    # (profiles.id is UUID NOT NULL upstream) — otherwise empty strings or
    # injection bait round-trip through to a 0-row Supabase result.
    allocator_id: UUID
    force: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _records_to_series(raw: list | None, name: str = "") -> pd.Series | None:
    """Convert [{date, value}, ...] JSONB records to a DatetimeIndex pd.Series."""
    if not isinstance(raw, list) or not raw:
        return None
    dates = [r["date"] for r in raw]
    vals = [r["value"] for r in raw]
    return pd.Series(vals, index=pd.DatetimeIndex(dates), name=name)


def _parse_supabase_ts(raw: str) -> datetime:
    """Parse a Supabase ISO timestamp/date string into a tz-aware UTC datetime.

    M-0600: three sites (start_date, computed_at, mandate_edited_at) used to
    repeat ``datetime.fromisoformat(raw.replace("Z", "+00:00"))`` with
    inconsistent tzinfo promotion — DATE columns (e.g. start_date) parse to a
    naive datetime, and subtracting a naive from an aware ``now()`` raises
    TypeError. Centralize the invariant here: the result is ALWAYS tz-aware
    UTC. A naive parse is promoted to UTC; a malformed value raises
    ``ValueError``/``AttributeError`` (the same exceptions every call site
    already catches), so error handling and logging stay at the call site.
    """
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    # A non-UTC offset (rare from Supabase, which emits Z/+00:00) is normalized
    # so the return is ALWAYS UTC, matching this helper's name and docstring.
    return parsed.astimezone(timezone.utc)


def _kill_switch_enabled() -> bool:
    """Check the kill switch. Returns True if the engine should run.

    Fail-OPEN contract: any Supabase exception (network blip, RLS rejection,
    schema drift, table missing post-rollback) keeps the engine running and
    logs at ERROR. Fail-closed would silently disable the engine on transient
    DB blips, which is a worse failure mode for a manual founder kill switch.
    """
    supabase = get_supabase()
    try:
        result = supabase.table("system_flags").select("enabled").eq(
            "key", "match_engine_enabled"
        ).maybe_single().execute()
        if not (result and result.data):
            return True  # No row / null maybe_single response = default enabled
        return bool(result.data.get("enabled", True))
    except Exception as err:
        logger.error(
            "match_engine: kill switch check FAILED (fail-open, engine "
            "still running): %s",
            err,
        )
        return True


def _load_candidate_universe(demo_only: bool = False) -> dict[str, Any]:
    """Load all strategies, analytics, and returns ONCE per cron run.

    Args:
      demo_only: When True, restricts the universe to `is_example=true` rows.
        The demo-allocator path serves through an anon public endpoint, so its
        universe must never include real published strategies. Default False
        preserves the normal admin cron behaviour.

    Returns a dict:
    {
      "strategies_by_id": {sid: {...}},
      "returns_by_id": {sid: pd.Series},
    }
    """
    supabase = get_supabase()

    strategies_query = (
        supabase.table("strategies")
        .select(
            "id, name, codename, strategy_types, subtypes, supported_exchanges, "
            "status, aum, max_capacity, user_id, start_date, is_example"
        )
        .eq("status", "published")
    )
    if demo_only:
        strategies_query = strategies_query.eq("is_example", True)
    strategies_result = strategies_query.execute()
    strategies = strategies_result.data or []
    strategy_ids = [s["id"] for s in strategies]

    if not strategy_ids:
        return {"strategies_by_id": {}, "returns_by_id": {}}

    # NEW-C08-02: paginate the analytics IN-list. The retention sweep at
    # L872-905 already documents this hazard ("an unbounded list risks HTTP
    # 414 or silent filter truncation"); this fetch was unguarded. On
    # truncation, missing strategies received analytics={} → None Sharpe/DD/
    # returns, still emitted as candidates, scored on defaults (preference_fit
    # 0.5) — a silent universe contamination indistinguishable from healthy.
    analytics_rows: list[dict[str, Any]] = []
    for _page_start in range(0, len(strategy_ids), _ANALYTICS_IN_LIST_PAGE_SIZE):
        _chunk = strategy_ids[_page_start:_page_start + _ANALYTICS_IN_LIST_PAGE_SIZE]
        _page = (
            supabase.table("strategy_analytics")
            .select(
                "strategy_id, returns_series, sharpe, max_drawdown, "
                "cumulative_return, cagr, volatility"
            )
            .in_("strategy_id", _chunk)
            .execute()
        )
        analytics_rows.extend(_page.data or [])
    if len(analytics_rows) < len(strategy_ids):
        logger.warning(
            "match: universe analytics coverage %d/%d — %d strategies have "
            "no analytics row (expected for new strategies; log rate > 0 on "
            "a full platform likely indicates IN-list truncation)",
            len(analytics_rows), len(strategy_ids),
            len(strategy_ids) - len(analytics_rows),
        )
    analytics_by_sid = {row["strategy_id"]: row for row in analytics_rows}

    strategies_by_id: dict[str, dict[str, Any]] = {}
    returns_by_id: dict[str, pd.Series] = {}

    for strategy in strategies:
        sid = strategy["id"]
        analytics = analytics_by_sid.get(sid, {})

        # Track record days from start_date. start_date is a DATE column, so it
        # parses to a naive datetime — _parse_supabase_ts promotes it to UTC
        # before subtracting from the aware now().
        track_record_days = 0
        if strategy.get("start_date"):
            try:
                start = _parse_supabase_ts(strategy["start_date"])
                track_record_days = (datetime.now(timezone.utc) - start).days
            except (ValueError, AttributeError) as exc:
                # A malformed start_date would silently produce
                # track_record_days=0 and bias scoring AGAINST the strategy.
                # Log loudly so an operator can spot the offending row.
                logger.warning(
                    "match: bad start_date %r for strategy %s — track_record_days=0: %s",
                    strategy.get("start_date"), sid, exc,
                )

        # First strategy type as primary
        types = strategy.get("strategy_types") or []
        primary_type = types[0] if types else None

        # First exchange as primary
        exchanges = strategy.get("supported_exchanges") or []
        primary_exchange = exchanges[0] if exchanges else None

        # First subtype as primary (Phase 3 / Pitfall 1 — SUBTYPES enum,
        # compared against allocator.style_exclusions in match_engine._eligibility_check)
        subtypes = strategy.get("subtypes") or []
        primary_subtype = subtypes[0] if subtypes else None

        strategies_by_id[sid] = {
            "strategy_id": sid,
            "name": strategy.get("name"),
            "codename": strategy.get("codename"),
            "manager_id": strategy.get("user_id"),
            "manager_aum": float(strategy.get("aum")) if strategy.get("aum") else None,
            "strategy_type": primary_type,
            "subtype": primary_subtype,  # Phase 3 / SCORING-07
            "exchange": primary_exchange,
            "sharpe": analytics.get("sharpe"),
            "max_drawdown_pct": analytics.get("max_drawdown"),
            "track_record_days": track_record_days,
            # Propagated so _score_one_allocator can post-filter the demo
            # allocator's universe to is_example=true rows only.
            "is_example": bool(strategy.get("is_example")),
        }

        returns_series = _records_to_series(analytics.get("returns_series"), name=sid)
        if returns_series is not None:
            returns_by_id[sid] = returns_series

    return {
        "strategies_by_id": strategies_by_id,
        "returns_by_id": returns_by_id,
    }


def _load_holding_portfolio_context(allocator_id: str) -> dict[str, Any]:
    """Phase 09 / D-01 + D-16. Load allocator_holdings and reconstruct per-symbol
    returns from allocator_equity_snapshots.breakdown.

    Mirrors the TypeScript queries.ts holdingsMap collapse (latest-asof-per-
    (venue, symbol, holding_type) wins). Applies the Phase 07 D-03 warm-up gate:
    holdings whose per-symbol series has fewer than 30 daily returns are excluded
    from portfolio math entirely (not flagged, not compared).

    This helper is SYNC (plain def) — called from _load_allocator_context which is
    itself sync and invoked via asyncio.to_thread. Per finding f1: MUST NOT be
    converted to async def.

    Returns dict with:
      portfolio_strategies: list[dict]  (pseudo-strategy dicts, strategy_id = "holding:V:S:T")
      portfolio_weights:    dict[str, float]  (value_usd / total_eligible_value, sums to 1.0)
      portfolio_returns:    dict[str, pd.Series]  (one Series per eligible holding)
      portfolio_aum:        float  (sum of eligible holding value_usd)
      holdings_rows_eligible: list[dict]  (raw holding rows that passed warm-up gate, for
                                           compute_holding_flags consumption in Task 3)
    """
    supabase = get_supabase()

    # --- Step 1: fetch all holdings for this allocator, most-recent-first ---
    holdings_result = (
        supabase.table("allocator_holdings")
        .select("venue, symbol, holding_type, value_usd, asof")
        .eq("allocator_id", allocator_id)
        .order("asof", desc=True)
        .execute()
    )
    holdings_rows = holdings_result.data or []

    # --- Step 2: collapse to latest-asof-per-(venue, symbol, holding_type) ---
    # First row wins because we ordered DESC — mirrors queries.ts:791-795 holdingsMap
    holdings_map: dict[tuple[str, str, str], dict] = {}
    for row in holdings_rows:
        key = (row["venue"], row["symbol"], row["holding_type"])
        if key not in holdings_map:
            holdings_map[key] = row
    collapsed = list(holdings_map.values())

    if not collapsed:
        return {
            "portfolio_strategies": [],
            "portfolio_weights": {},
            "portfolio_returns": {},
            "portfolio_aum": 0.0,
            "holdings_rows_eligible": [],
        }

    # --- Step 3: fetch equity snapshots ordered ASC (needed for pct_change) ---
    snapshots_result = (
        supabase.table("allocator_equity_snapshots")
        .select("asof, breakdown")
        .eq("allocator_id", allocator_id)
        .order("asof", desc=False)
        .execute()
    )
    snapshots = snapshots_result.data or []

    # --- Step 4: reconstruct per-symbol returns + apply 30-day warm-up gate ---
    portfolio_strategies: list[dict[str, Any]] = []
    portfolio_returns: dict[str, pd.Series] = {}
    holdings_rows_eligible: list[dict] = []
    raw_values: dict[str, float] = {}  # pseudo_id -> value_usd (for weight computation)
    warm_up_dropped = 0  # NEW-C08-05: count excluded holdings for observability

    for row in collapsed:
        venue = row["venue"]
        symbol = row["symbol"]
        holding_type = row["holding_type"]
        pseudo_id = f"holding:{venue}:{symbol}:{holding_type}"
        value_usd = float(row.get("value_usd") or 0.0)

        series = reconstruct_symbol_returns(snapshots, symbol)
        if series is None or len(series) < 30:
            # Warm-up gate: insufficient history — exclude entirely (Phase 07 D-03 analog).
            # NEW-C08-05: count and log so the caller can distinguish empty-book
            # from freshly-funded (portfolio_aum=0 with warm_up_dropped>0 means
            # the allocator has holdings but they're all too new to score, not
            # that there are genuinely no holdings).
            warm_up_dropped += 1
            continue

        portfolio_strategies.append({"strategy_id": pseudo_id})
        portfolio_returns[pseudo_id] = series
        holdings_rows_eligible.append(row)
        raw_values[pseudo_id] = value_usd

    if warm_up_dropped > 0:
        logger.info(
            "match: holdings warm-up gate dropped %d/%d holding(s) for allocator %s "
            "(< 30 reconstructable daily returns) — these are excluded from portfolio "
            "math and flag computation",
            warm_up_dropped, len(collapsed), allocator_id,
        )

    # --- Step 5: compute weights (value_usd / total_eligible_value) ---
    total_eligible_value = sum(raw_values.values())
    portfolio_weights: dict[str, float] = {}
    if total_eligible_value > 0:
        for pid, val in raw_values.items():
            portfolio_weights[pid] = val / total_eligible_value
    else:
        # All values zero — equal weight as fallback
        for pid in raw_values:
            portfolio_weights[pid] = 1.0 / len(raw_values) if raw_values else 0.0

    return {
        "portfolio_strategies": portfolio_strategies,
        "portfolio_weights": portfolio_weights,
        "portfolio_returns": portfolio_returns,
        "portfolio_aum": total_eligible_value,
        "holdings_rows_eligible": holdings_rows_eligible,
    }


def _load_allocator_context(allocator_id: str) -> dict[str, Any]:
    """Load per-allocator data: preferences, portfolio, thumbs-down history.

    Merges legacy ``portfolio_strategies`` and ``allocator_holdings``
    (real holdings as pseudo-strategies) into the combined context;
    weights are renormalized across the combined set to sum to 1.0.
    Stays synchronous (called via ``asyncio.to_thread`` from
    ``_score_one_allocator``) — making it ``async def`` would break the
    thread-pool pattern.
    """
    supabase = get_supabase()

    # Preferences
    prefs_result = supabase.table("allocator_preferences").select("*").eq(
        "user_id", allocator_id
    ).maybe_single().execute()
    # postgrest maybe_single().execute() returns None (not an APIResponse with
    # data=None) when no allocator_preferences row exists. Guard the None before
    # .data; _score_one_allocator already normalizes None preferences to {}.
    # Pre-fix this raised AttributeError: 'NoneType' object has no attribute
    # 'data' on every prefs-less allocator (Sentry 122529812, cron-recompute).
    preferences = prefs_result.data if prefs_result else None

    # Portfolio strategies + weights. Iterate all portfolios owned by this allocator.
    portfolios_result = supabase.table("portfolios").select("id").eq(
        "user_id", allocator_id
    ).execute()
    portfolio_ids = [p["id"] for p in (portfolios_result.data or [])]

    portfolio_strategies: list[dict[str, Any]] = []
    portfolio_weights: dict[str, float] = {}
    portfolio_returns: dict[str, pd.Series] = {}
    strategy_aum: float = 0.0
    # Track raw value per strategy id for combined renormalization
    strategy_raw_values: dict[str, float] = {}

    if portfolio_ids:
        # M-0598 / M-0599 / H-0563 core: the dedup loop below keeps the FIRST
        # row seen per strategy_id. Without an ORDER BY, PostgREST may return
        # the rows in any order, so when the same strategy appears in two of
        # this allocator's portfolios with different current_weight /
        # allocated_amount, the retained values (and therefore strategy_aum and
        # the final scores) would vary between processes — contradicting the
        # engine's determinism contract ("same inputs → identical output,
        # modulo dict ordering", services/match_engine.py module docstring) and
        # the test_determinism guarantee. Order by (portfolio_id, strategy_id)
        # so the first-wins tie-break is reproducible.
        ps_result = (
            supabase.table("portfolio_strategies")
            .select("strategy_id, current_weight, portfolio_id, allocated_amount")
            .in_("portfolio_id", portfolio_ids)
            .order("portfolio_id", desc=False)
            .order("strategy_id", desc=False)
            .execute()
        )
        ps_rows = ps_result.data or []

        # sorted() (not list(set(...))): a bare set has non-deterministic
        # iteration order, and the match engine this feeds promises
        # deterministic output (services/match_engine.py). The IN-filter result
        # is order-independent today, but a future edit that iterates
        # strategy_ids directly would silently regress.
        strategy_ids = sorted({row["strategy_id"] for row in ps_rows})
        # NEW-C08-03: paginate the portfolio analytics IN-list. An allocator
        # with many strategies can push the IN-list past the URL cap; on
        # truncation analytics_by_sid is missing entries → portfolio_returns
        # is incomplete → _compute_portfolio_fit_components silently scores
        # against a partial book, understating existing exposure (audit
        # finding M-0675 angle but query-caused, no log distinguishing "no
        # analytics yet" from "silently truncated").
        if strategy_ids:
            sa_rows: list[dict[str, Any]] = []
            for _page_start in range(0, len(strategy_ids), _ANALYTICS_IN_LIST_PAGE_SIZE):
                _chunk = strategy_ids[_page_start:_page_start + _ANALYTICS_IN_LIST_PAGE_SIZE]
                _page = (
                    supabase.table("strategy_analytics")
                    .select("strategy_id, returns_series")
                    .in_("strategy_id", _chunk)
                    .execute()
                )
                sa_rows.extend(_page.data or [])
            if len(sa_rows) < len(strategy_ids):
                logger.warning(
                    "match: portfolio analytics coverage %d/%d for allocator %s "
                    "— %d strategies lack analytics rows",
                    len(sa_rows), len(strategy_ids), allocator_id,
                    len(strategy_ids) - len(sa_rows),
                )
            analytics_by_sid = {row["strategy_id"]: row for row in sa_rows}
        else:
            analytics_by_sid: dict[str, Any] = {}

        if strategy_ids:
            for row in ps_rows:
                sid = row["strategy_id"]
                if sid not in portfolio_weights:
                    portfolio_strategies.append({"strategy_id": sid})
                    # NULL current_weight defaults to 1.0 as a cold-start placeholder.
                    # match_engine.score_candidates re-normalizes the weights dict to
                    # sum=1.0 before scoring, so a single NULL row won't break the
                    # math — but a portfolio with mixed NULL and filled rows will
                    # still skew toward the NULL row. Seeded data always fills weights;
                    # this path is for user-created portfolios with partial data.
                    portfolio_weights[sid] = float(row.get("current_weight") or 1.0)
                    sa = analytics_by_sid.get(sid, {})
                    returns = _records_to_series(sa.get("returns_series"), name=sid)
                    if returns is not None:
                        portfolio_returns[sid] = returns
                    allocated = row.get("allocated_amount")
                    if allocated:
                        alloc_val = float(allocated)
                        strategy_aum += alloc_val
                        strategy_raw_values[sid] = alloc_val

    # Phase 09 / D-01 + D-16: load holdings-sourced pseudo-strategies
    holdings_ctx = _load_holding_portfolio_context(allocator_id)
    holding_strategies = holdings_ctx["portfolio_strategies"]
    holding_returns = holdings_ctx["portfolio_returns"]
    holding_aum = holdings_ctx["portfolio_aum"]
    holdings_rows_eligible = holdings_ctx["holdings_rows_eligible"]

    # Merge strategies + holdings into combined dicts
    portfolio_strategies.extend(holding_strategies)
    portfolio_returns.update(holding_returns)

    # Combined AUM
    combined_aum = strategy_aum + holding_aum

    # Renormalize weights across the combined set so they sum to 1.0 (D-16).
    # Strategy side: use allocated_amount as the value basis.
    # Holdings side: use value_usd (already in holdings_ctx["portfolio_weights"] as fractions
    #   of the holdings total, but we need absolute values for combined renorm).
    # Reconstruct absolute values for holding side from their individual value_usd.
    holding_abs_values: dict[str, float] = {}
    for row in holdings_rows_eligible:
        pseudo_id = f"holding:{row['venue']}:{row['symbol']}:{row['holding_type']}"
        holding_abs_values[pseudo_id] = float(row.get("value_usd") or 0.0)

    if combined_aum > 0:
        # Strategies side
        for sid, val in strategy_raw_values.items():
            portfolio_weights[sid] = val / combined_aum
        # Holdings side
        for pid, val in holding_abs_values.items():
            portfolio_weights[pid] = val / combined_aum
    elif holding_strategies or portfolio_strategies:
        # Fall back: equal weights when no AUM data available
        all_ids = [ps["strategy_id"] for ps in portfolio_strategies]
        eq_w = 1.0 / len(all_ids) if all_ids else 0.0
        for pid in all_ids:
            portfolio_weights[pid] = eq_w

    # Thumbs-down history
    td_result = (
        supabase.table("match_decisions")
        .select("strategy_id")
        .eq("allocator_id", allocator_id)
        .eq("decision", "thumbs_down")
        .execute()
    )
    thumbs_down_ids = {row["strategy_id"] for row in (td_result.data or [])}

    return {
        "preferences": preferences,
        "portfolio_strategies": portfolio_strategies,
        "portfolio_weights": portfolio_weights,
        "portfolio_returns": portfolio_returns,
        "portfolio_aum": combined_aum if combined_aum > 0 else None,
        "thumbs_down_ids": thumbs_down_ids,
        # Internal-use: passed to compute_holding_flags in _score_one_allocator (Task 3)
        "_holdings_rows_eligible": holdings_rows_eligible,
    }


def compute_holding_flags(
    *,
    holdings_rows_eligible: list[dict],
    portfolio_returns: dict[str, pd.Series],
    portfolio_weights: dict[str, float],
    portfolio_aum: float | None,
    allocator_preferences: dict,
    scored_candidates_by_slot: dict[str, list],
) -> list[dict]:
    """Phase 09 / finding f5. Per-holding flag rows persisted into match_batches.holding_flags.

    Returns list[dict] — one entry per eligible holding (those present in portfolio_returns).
    Applies D-04 (breach + candidate-exists gate) + D-05 (max_weight + correlation_ceiling)
    + D-06 (FLAG_COMPOSITE_THRESHOLD=50 gate on top candidate composite score).

    Entry shape:
        {
            "holding_ref":              "holding:{venue}:{symbol}:{holding_type}",
            "value_usd":                float,
            "weight":                   float,       # value_usd / portfolio_aum
            "breach_reasons":           list[str],   # "max_weight" | "correlation_ceiling"
            "top_candidate_strategy_id": str | None,
            "top_candidate_composite":  float | None,
            "flagged":                  bool,        # True iff breach + candidate_composite >= 50
        }

    This is a synchronous plain `def` per finding f1.
    """
    from services.match_engine import _compute_corr_with_portfolio

    max_weight_pref = allocator_preferences.get("max_weight")
    corr_ceiling = allocator_preferences.get("correlation_ceiling")
    aum = float(portfolio_aum) if portfolio_aum and float(portfolio_aum) > 0 else None

    flags: list[dict] = []

    for row in holdings_rows_eligible:
        pseudo_id = f"holding:{row['venue']}:{row['symbol']}:{row['holding_type']}"

        # Defense-in-depth: skip any holding whose series isn't loaded
        # (warm-up already filtered upstream in _load_holding_portfolio_context)
        if pseudo_id not in portfolio_returns:
            continue

        value = float(row.get("value_usd") or 0.0)
        weight = value / aum if aum else 0.0
        breaches: list[str] = []

        # D-05 max_weight breach
        if max_weight_pref is not None and aum is not None and weight > float(max_weight_pref):
            breaches.append("max_weight")

        # D-05 correlation_ceiling breach via _compute_corr_with_portfolio
        if corr_ceiling is not None:
            # Build weighted rest-of-portfolio returns (all holdings except this one)
            rest_ids = [k for k in portfolio_returns if k != pseudo_id]
            if rest_ids:
                rest_weights = {k: portfolio_weights.get(k, 0.0) for k in rest_ids}
                total_rest_w = sum(rest_weights.values())
                if total_rest_w > 0:
                    # Compute weighted portfolio returns for the rest
                    rest_series_list = []
                    for k in rest_ids:
                        s = portfolio_returns[k]
                        rest_series_list.append(s.rename(k))

                    rest_df = pd.concat(rest_series_list, axis=1).dropna()
                    if not rest_df.empty:
                        w_arr = [rest_weights.get(col, 0.0) / total_rest_w for col in rest_df.columns]
                        rest_port = (rest_df * w_arr).sum(axis=1)
                        corr = _compute_corr_with_portfolio(
                            rest_port,
                            portfolio_returns[pseudo_id],
                        )
                        if corr is not None and corr > float(corr_ceiling):
                            breaches.append("correlation_ceiling")

        # D-06 candidate-exists gate: pick top verified strategy candidate above threshold
        top_id: str | None = None
        top_composite: float | None = None
        slot_candidates = scored_candidates_by_slot.get(pseudo_id) or []
        # Sort by final_score descending; only real strategy UUIDs (not holding: pseudo-ids)
        for cand in sorted(slot_candidates, key=lambda c: float(getattr(c, "final_score", 0.0)), reverse=True):
            cand_id = getattr(cand, "strategy_id", None)
            if cand_id and not str(cand_id).startswith("holding:"):
                score_val = float(getattr(cand, "final_score", 0.0))
                if score_val >= FLAG_COMPOSITE_THRESHOLD:
                    top_id = str(cand_id)
                    top_composite = score_val
                break  # Only need the top candidate — exit after first real UUID

        flagged = bool(breaches) and top_id is not None

        flags.append({
            "holding_ref": pseudo_id,
            "value_usd": value,
            "weight": weight,
            "breach_reasons": breaches,
            "top_candidate_strategy_id": top_id,
            "top_candidate_composite": top_composite,
            "flagged": flagged,
        })

    return flags


class _ScoredProxy:
    """Attribute-access view over a scored candidate dict.

    compute_holding_flags reads `final_score` / `strategy_id` via getattr;
    score_candidates emits dicts with `score` / `strategy_id` keys.
    """

    __slots__ = ("strategy_id", "final_score")

    def __init__(self, strategy_id: str, final_score: float) -> None:
        self.strategy_id = strategy_id
        self.final_score = final_score


async def _score_one_allocator(
    allocator_id: str,
    universe: dict[str, Any],
) -> dict[str, Any]:
    """Score a single allocator and persist the batch + candidates."""
    # Body-placed import keeps services.feedback_engine lazy — it should NOT
    # land in sys.modules at module load time, only when scoring runs.
    from services.feedback_engine import compute_adjusted_weights
    async with _scoring_semaphore:
        start = time.monotonic()

        ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)

        overrides = await asyncio.to_thread(compute_adjusted_weights, allocator_id)
        # ctx["preferences"] can be None when the allocator has no
        # allocator_preferences row; normalize to {} before merging overrides.
        if ctx["preferences"] is None:
            ctx["preferences"] = {}
        ctx["preferences"]["scoring_weight_overrides"] = overrides or None

        # Demo allocator is post-filtered to is_example=true so the public
        # /api/demo/match endpoint cannot leak real strategies. Post-filter
        # (not a universe reload) so the cron's universe-once optimization
        # is preserved.
        if allocator_id == _DEMO_ALLOCATOR_ID:
            strategies_by_id = {
                sid: s
                for sid, s in universe["strategies_by_id"].items()
                if s.get("is_example") is True
            }
            candidate_strategies = list(strategies_by_id.values())
            candidate_returns = {
                sid: universe["returns_by_id"][sid]
                for sid in strategies_by_id
                if sid in universe["returns_by_id"]
            }
        else:
            candidate_strategies = list(universe["strategies_by_id"].values())
            candidate_returns = universe["returns_by_id"]

        # score_candidates runs pandas/numpy heavy work (DataFrame builds,
        # correlation calcs, min-max normalization across the candidate
        # universe). Off-load so we don't block the event loop per allocator.
        result = await asyncio.to_thread(
            score_candidates,
            allocator_id=allocator_id,
            preferences=ctx["preferences"],
            portfolio_strategies=ctx["portfolio_strategies"],
            portfolio_returns=ctx["portfolio_returns"],
            portfolio_weights=ctx["portfolio_weights"],
            candidate_strategies=candidate_strategies,
            candidate_returns=candidate_returns,
            thumbs_down_ids=ctx["thumbs_down_ids"],
            portfolio_aum=ctx["portfolio_aum"],
        )

        latency_ms = int((time.monotonic() - start) * 1000)

        # Per-holding flag rows persisted into match_batches.holding_flags
        # for SSR consumption. Every holding slot receives the same ranked
        # candidate list; compute_holding_flags applies the top-real-UUID +
        # FLAG_COMPOSITE_THRESHOLD filter per slot.
        holdings_eligible = ctx.get("_holdings_rows_eligible") or []
        scored_by_slot: dict[str, list] = {}
        if holdings_eligible:
            proxies = [
                _ScoredProxy(c["strategy_id"], float(c.get("score", 0.0)))
                for c in result["candidates"]
            ]
            for row in holdings_eligible:
                slot_key = f"holding:{row['venue']}:{row['symbol']}:{row['holding_type']}"
                scored_by_slot[slot_key] = proxies  # same ranked list for every slot

        # compute_holding_flags does pandas concat + correlation math per
        # eligible holding — off-load to a thread like score_candidates so
        # the event loop is not blocked on multi-holding allocators.
        holding_flags_list = await asyncio.to_thread(
            compute_holding_flags,
            holdings_rows_eligible=holdings_eligible,
            portfolio_returns=ctx["portfolio_returns"],
            portfolio_weights=ctx["portfolio_weights"],
            portfolio_aum=ctx["portfolio_aum"],
            allocator_preferences=ctx["preferences"] or {},
            scored_candidates_by_slot=scored_by_slot,
        )

        # Persist: one match_batches row, N match_candidates rows.
        supabase = get_supabase()

        batch_row = {
            "allocator_id": allocator_id,
            "mode": result["mode"],
            "filter_relaxed": result["filter_relaxed"],
            "candidate_count": len(result["candidates"]),
            # Use the TRUE excluded count, not the length of the persisted list
            # (which is capped at TOP_N_EXCLUDED for storage efficiency).
            "excluded_count": result.get("excluded_total", len(result["excluded"])),
            "engine_version": ENGINE_VERSION,
            "weights_version": WEIGHTS_VERSION,
            "effective_preferences": result["effective_preferences"],
            "effective_thresholds": result["effective_thresholds"],
            "source_strategy_count": result["source_strategy_count"],
            "latency_ms": latency_ms,
            "holding_flags": holding_flags_list,
        }
        # NEW-C08-07: wrap the batch_insert + candidates_insert pair in
        # asyncio.shield() so a CancelledError (uvicorn shutdown / Railway
        # redeploy / request timeout) arriving BETWEEN the two awaits does not
        # leave a committed match_batches row with zero match_candidates children
        # — exactly the orphan the rollback path below was designed to prevent
        # but couldn't catch on cancellation. shield() lets the inner coroutine
        # run to completion even if the outer task is cancelled; the outer
        # CancelledError is re-raised after the inner finishes.
        async def _persist_batch_and_candidates() -> str:
            """Insert match_batches row + match_candidates rows atomically
            enough for cancellation safety. Returns the batch_id."""
            _batch_insert = await asyncio.to_thread(
                lambda: supabase.table("match_batches").insert(batch_row).execute()
            )
            if not _batch_insert.data:
                raise RuntimeError(f"Failed to insert match_batches for {allocator_id}")
            _batch_id = _batch_insert.data[0]["id"]

            # Build the candidates+excluded rows list.
            # Red-team CRITICAL fix (audit-2026-05-07): `explicitly_excluded` is a
            # NEW ExclusionReason value introduced by H-0705 but the SQL CHECK on
            # match_candidates.exclusion_reason (supabase/migrations/
            # 20260407164606_perfect_match.sql:111-114) still allows only 7 values.
            # Persisting `explicitly_excluded` here would trigger CHECK violation
            # in the bulk insert below and tear down the entire match_batches
            # parent via the rollback path. Per the audit's in-scope fix (option b:
            # this worktree has no migrations), we drop these rows at the
            # persistence boundary — they remain in the in-memory `excluded` list
            # the caller receives, and `excluded_count` on match_batches already
            # uses `excluded_total` so the row-count audit trail stays honest.
            # TODO(audit-2026-05-07 follow-up PR): ship a migration that widens
            # the CHECK to include 'explicitly_excluded', then remove this filter.
            _rows_to_insert = []
            for _cand in result["candidates"]:
                _rows_to_insert.append({
                    "batch_id": _batch_id,
                    "allocator_id": allocator_id,
                    "strategy_id": _cand["strategy_id"],
                    "score": _cand["score"],
                    "score_breakdown": _cand["score_breakdown"],
                    "reasons": _cand["reasons"],
                    "rank": _cand["rank"],
                    "exclusion_reason": None,
                    "exclusion_provenance": None,
                })
            for _exc in result["excluded"]:
                if _exc["exclusion_reason"] == "explicitly_excluded":
                    logger.info(
                        "match_engine: dropping explicitly_excluded row from "
                        "match_candidates persistence (allocator=%s, strategy=%s) "
                        "— pending SQL CHECK migration",
                        allocator_id, _exc["strategy_id"],
                    )
                    continue
                _rows_to_insert.append({
                    "batch_id": _batch_id,
                    "allocator_id": allocator_id,
                    "strategy_id": _exc["strategy_id"],
                    "score": 0,
                    "score_breakdown": {"raw": {}},
                    "reasons": [],
                    "rank": None,
                    "exclusion_reason": _exc["exclusion_reason"],
                    "exclusion_provenance": _exc.get("exclusion_provenance"),
                })

            if _rows_to_insert:
                # Inspect the insert result so a silent FK/CHECK violation
                # (e.g. strategy_id deleted between the universe snapshot and
                # the insert) cannot leave the match_batches row claiming
                # candidate_count > 0 with zero child rows. If the insert
                # raises, tear down the parent batch row so the admin queue
                # never sees an orphan with non-zero count + empty list.
                _insert_err: Exception | None = None
                _cand_data_ok = False
                try:
                    _cand_insert = await asyncio.to_thread(
                        lambda: supabase.table("match_candidates").insert(_rows_to_insert).execute()
                    )
                    _cand_data_ok = bool(_cand_insert.data)
                except Exception as _exc_inner:
                    _insert_err = _exc_inner
                    logger.exception(
                        "match_engine: match_candidates insert raised for batch %s "
                        "(allocator=%s, expected=%d)",
                        _batch_id, allocator_id, len(_rows_to_insert),
                    )

                if not _cand_data_ok:
                    logger.error(
                        "match_engine: rolling back orphan batch %s (allocator=%s)",
                        _batch_id, allocator_id,
                    )
                    try:
                        await asyncio.to_thread(
                            lambda: supabase.table("match_batches")
                            .delete()
                            .eq("id", _batch_id)
                            .execute()
                        )
                    except Exception as _cleanup_err:
                        logger.error(
                            "match_engine: failed to roll back orphan batch %s: %s",
                            _batch_id, _cleanup_err,
                        )
                    raise RuntimeError(
                        f"match_candidates insert failed for batch {_batch_id} "
                        f"(allocator={allocator_id}, expected {len(_rows_to_insert)} rows)"
                    ) from _insert_err

            return _batch_id

        batch_id = await asyncio.shield(_persist_batch_and_candidates())

        logger.info(
            "match_engine recompute: allocator=%s batch=%s mode=%s "
            "candidates=%d excluded=%d filter_relaxed=%s latency_ms=%d",
            allocator_id, batch_id, result["mode"],
            len(result["candidates"]), len(result["excluded"]),
            result["filter_relaxed"], latency_ms,
        )

        return {
            "allocator_id": allocator_id,
            "batch_id": batch_id,
            "candidate_count": len(result["candidates"]),
            "excluded_count": len(result["excluded"]),
            "mode": result["mode"],
            "filter_relaxed": result["filter_relaxed"],
            "latency_ms": latency_ms,
        }


async def _should_skip_allocator(allocator_id: str, force: bool) -> bool:
    """D-11 triple check — return False (don't skip) when ANY of:
      1. force == True (caller explicit override)
      2. last_batch.engine_version != ENGINE_VERSION (v1→v2 cutover or future bump)
      3. allocator_preferences.mandate_edited_at > last_batch.computed_at (mandate edit)
    Otherwise apply the RECOMPUTE_MIN_AGE_HOURS age guard.
    Phase 3 / SCORING-05.
    """
    if force:
        return False
    supabase = get_supabase()
    result = await asyncio.to_thread(
        lambda: supabase.table("match_batches")
        .select("computed_at, engine_version")
        .eq("allocator_id", allocator_id)
        .order("computed_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return False
    last_row = rows[0]
    # Trigger 2: engine_version mismatch — invalidate v1 batches for the
    # v1→v2 cutover and any future bump. Short-circuits BEFORE the age
    # check so a fresh v1 batch is still recomputed.
    if last_row.get("engine_version") != ENGINE_VERSION:
        return False
    try:
        last_at = _parse_supabase_ts(last_row["computed_at"])
    except (ValueError, AttributeError):
        return False
    # Age guard FIRST: if the batch is already older than the threshold we
    # need to recompute anyway, so skip the second Supabase round-trip to
    # allocator_preferences. Saves O(allocators) RTTs per cron run.
    age_hours = (datetime.now(timezone.utc) - last_at).total_seconds() / 3600
    if age_hours >= RECOMPUTE_MIN_AGE_HOURS:
        return False
    # Trigger 3: mandate_edited_at > computed_at — mandate edit invalidates
    # the cached batch. One extra query against allocator_preferences
    # (indexed by user_id PK, O(1) lookup), only on the SKIP path.
    prefs_result = await asyncio.to_thread(
        lambda: supabase.table("allocator_preferences")
        .select("mandate_edited_at")
        .eq("user_id", allocator_id)
        .maybe_single()
        .execute()
    )
    prefs = (prefs_result.data or {}) if prefs_result else {}
    edited_raw = prefs.get("mandate_edited_at") if isinstance(prefs, dict) else None
    if edited_raw:
        try:
            edited_at = _parse_supabase_ts(edited_raw)
            if edited_at > last_at:
                return False
        except (ValueError, AttributeError) as exc:
            # A malformed mandate_edited_at (legacy backup, unix epoch,
            # serializer drift) used to silently fall through to the age
            # guard, downgrading Trigger 3 into a no-op — an allocator's
            # mandate edit could fail to invalidate stale batches. Fail
            # loud: log and force a recompute.
            logger.warning(
                "match_engine: bad mandate_edited_at %r for allocator %s "
                "— forcing recompute: %s",
                edited_raw, allocator_id, exc,
            )
            return False
    return True


# Cap the DELETE IN-list so the PostgREST URL stays under the platform's
# query-string limit. supabase-py serializes `.in_('id', ids)` into the URL,
# and an unbounded list risks HTTP 414 or silent filter truncation (old
# batches would survive the sweep). 50 IDs per page is well under any cap.
_RETENTION_DELETE_BATCH_SIZE = 50

# Page size for analytics SELECT .in_() fetches (NEW-C08-02 / NEW-C08-03).
# The retention sweep already documents this hazard at L919 above; the same
# URL-length cap applies to every unbounded .in_() against strategy_analytics.
# 200 IDs/request is well under the PostgREST/nginx URL cap (~8KB) for
# typical 36-char UUIDs and keeps the per-query response size manageable.
_ANALYTICS_IN_LIST_PAGE_SIZE = 200


def _retention_sweep(allocator_id: str, keep: int = 7) -> int:
    """Delete old batches for this allocator, keeping the last `keep`.
    CASCADE drops match_candidates for the deleted batches.

    Returns the number of batches deleted.
    """
    supabase = get_supabase()
    # Get all batches ordered by computed_at DESC
    result = (
        supabase.table("match_batches")
        .select("id")
        .eq("allocator_id", allocator_id)
        .order("computed_at", desc=True)
        .execute()
    )
    rows = result.data or []
    if len(rows) <= keep:
        return 0
    ids_to_delete = [row["id"] for row in rows[keep:]]
    deleted = 0
    # Paginate the DELETE so the IN-list URL stays bounded. Each chunk is
    # its own request, so partial progress survives transient failures.
    for start in range(0, len(ids_to_delete), _RETENTION_DELETE_BATCH_SIZE):
        chunk = ids_to_delete[start:start + _RETENTION_DELETE_BATCH_SIZE]
        del_result = supabase.table("match_batches").delete().in_("id", chunk).execute()
        # NEW-C08-04: count actual deleted rows from the result, not len(chunk).
        # A no-op DELETE (RLS regression, permission drift, CASCADE issue) returns
        # 200 with data=[] — pre-fix we'd unconditionally add len(chunk) and
        # surface retention_deleted=N while old batches accumulated unbounded.
        actual_deleted = len(del_result.data or [])
        if actual_deleted < len(chunk):
            logger.error(
                "match_engine: retention DELETE affected %d/%d rows for allocator %s "
                "— possible RLS/permission regression; old batches may survive sweep",
                actual_deleted, len(chunk), allocator_id,
            )
        deleted += actual_deleted
    return deleted


# ---------------------------------------------------------------------------
# Helpers (continued)
# ---------------------------------------------------------------------------


def _is_allocator_profile(allocator_id: str) -> bool:
    """NEW-C08-10: return True iff the profile exists and has role 'allocator' or 'both'.

    Synchronous (called via asyncio.to_thread). Module-level so tests can
    monkeypatch it without patching get_supabase (which requires live env vars).
    """
    sb = get_supabase()
    profile = (
        sb.table("profiles")
        .select("role")
        .eq("id", allocator_id)
        .maybe_single()
        .execute()
    )
    if not (profile and profile.data):
        return False
    return profile.data.get("role") in ("allocator", "both")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/recompute")
async def recompute(req: RecomputeRequest) -> dict[str, Any]:
    """Single-allocator recompute. Called from the Next.js admin /api/admin/match/recompute."""
    # Stringify the UUID once for Supabase / downstream sync helpers.
    allocator_id = str(req.allocator_id)

    # NEW-C08-10: validate that allocator_id is actually an allocator (or both).
    # Pre-fix any UUID (strategy-manager, admin, deleted profile) manufactured
    # match_batches rows — polluting the founder queue and hit-rate eval.
    # Mirrors cron_recompute's role IN ('allocator','both') filter.
    if not await asyncio.to_thread(_is_allocator_profile, allocator_id):
        raise HTTPException(
            status_code=422,
            detail=f"allocator_id {allocator_id} is not an allocator profile",
        )

    if not await asyncio.to_thread(_kill_switch_enabled):
        logger.info("match_engine recompute: kill switch off, skipping allocator=%s", allocator_id)
        return {"status": "disabled", "disabled": True}

    # NEW-C08-06: floor force=True to a per-allocator 30-second minimum interval.
    # force=True bypasses the 12h age guard (see _should_skip_allocator); without
    # this gate a looped caller past the Next.js rate limiter can stack concurrent
    # scoring + retention churn. The interval is process-local — a pod restart
    # resets it, which is acceptable (the guard is a budget, not a hard lock).
    import time as _time
    if req.force:
        _now = _time.monotonic()
        _last = _force_last_run.get(allocator_id, 0.0)
        if _now - _last < FORCE_RECOMPUTE_MIN_INTERVAL_S:
            wait_s = int(FORCE_RECOMPUTE_MIN_INTERVAL_S - (_now - _last))
            raise HTTPException(
                status_code=429,
                detail=(
                    f"force recompute for {allocator_id} throttled: "
                    f"retry after {wait_s}s (min interval {FORCE_RECOMPUTE_MIN_INTERVAL_S}s)"
                ),
            )
        _force_last_run[allocator_id] = _now

    if await _should_skip_allocator(allocator_id, req.force):
        logger.info("match_engine recompute: skipping recent batch for %s", allocator_id)
        return {"status": "skipped", "skipped": True, "reason": "recent_batch"}

    # NEW-C08-09: wire demo_only at the call site so the DB-layer guard is in
    # place (defense at the boundary). Pre-fix the call was unconditionally
    # _load_candidate_universe() with demo_only=False; the only protection was
    # the in-memory post-filter in _score_one_allocator, which a refactor could
    # silently drop. Now the universe is filtered at the DB for the demo allocator.
    universe = await asyncio.to_thread(
        _load_candidate_universe,
        allocator_id == _DEMO_ALLOCATOR_ID,
    )
    if not universe["strategies_by_id"]:
        raise HTTPException(status_code=400, detail="No eligible strategies in the directory")

    try:
        result = await _score_one_allocator(allocator_id, universe)
    except Exception as err:
        logger.exception("match_engine recompute failed for %s", allocator_id)
        raise HTTPException(status_code=500, detail=f"Scoring failed: {err}") from err

    # Retention sweep (keep last 7). A sweep failure must not 500 the
    # request after the batch was successfully persisted — log and continue.
    try:
        await asyncio.to_thread(_retention_sweep, allocator_id)
    except Exception as err:
        logger.error(
            "match_engine recompute: retention sweep failed for %s after successful insert: %s",
            allocator_id, err,
        )

    result["status"] = "ok"
    return result


@router.get("/eval")
async def eval_metrics(
    lookback_days: int = 28,
    partner_tag: str | None = None,
) -> dict[str, Any]:
    """Compute hit-rate metrics for the /admin/match/eval dashboard.

    Optional `partner_tag` query param scopes the metrics to allocators tagged
    into a partner pilot (see migration 016 + /admin/partner-import).
    """
    if lookback_days < 1 or lookback_days > 365:
        raise HTTPException(status_code=400, detail="lookback_days must be between 1 and 365")
    try:
        return await asyncio.to_thread(
            compute_hit_rate_metrics, lookback_days, partner_tag
        )
    except PaginatedSelectTruncated as err:
        # paginated_select hit its hard cap — without this we'd silently
        # aggregate over a partial window. 503 (data scale exceeded) is a
        # cleaner monitoring signal than a generic 500.
        logger.exception("match_engine eval truncated at hard cap: %s", err)
        raise HTTPException(
            status_code=503,
            detail=(
                f"Eval truncated at {err.page_count} pages × {err.page_size} rows"
                + (f" (hint: {err.hint})" if err.hint else "")
            ),
        ) from err
    except Exception as err:
        logger.exception("match_engine eval failed")
        raise HTTPException(status_code=500, detail=f"Eval failed: {err}") from err


@router.post("/cron-recompute")
async def cron_recompute() -> dict[str, Any]:
    """Daily cron. Loops every allocator (+ role 'both'), recomputes their batch."""
    overall_start = time.monotonic()

    def _duration() -> float:
        return round(time.monotonic() - overall_start, 2)

    def _early_return(status: str, **extras: Any) -> dict[str, Any]:
        """Build the uniform early-return response shape.

        Every cron return carries `status` + the four counters + `duration_s` so
        monitoring can switch on one field instead of guessing at key presence
        (see TestCronResponseShape._REQUIRED_KEYS). `extras` carries
        branch-specific flags (e.g. `disabled=True`, `reason=...`).
        """
        return {
            "status": status,
            "processed": 0,
            "skipped": 0,
            "failed": 0,
            "retention_deleted": 0,
            "duration_s": _duration(),
            **extras,
        }

    # _kill_switch_enabled does sync Supabase IO; off-load to keep the event
    # loop unblocked.
    if not await asyncio.to_thread(_kill_switch_enabled):
        logger.info("match_engine cron: kill switch off, skipping")
        return _early_return("disabled", disabled=True)

    supabase = get_supabase()

    # Load allocators (role = 'allocator' OR 'both')
    allocators_result = (
        supabase.table("profiles")
        .select("id")
        .in_("role", ["allocator", "both"])
        .execute()
    )
    allocators = allocators_result.data or []
    if not allocators:
        logger.info("match_engine cron: no allocators found")
        return _early_return("no_allocators")

    # Load universe ONCE for the whole cron run.
    # NEW-C08-09 note: the cron loads the FULL (non-demo-only) universe so all
    # allocators share a single cached fetch. The demo allocator's is_example
    # filter is applied inside _score_one_allocator (L708-712) at scoring time.
    # The DB-layer defense (demo_only=True) is wired at the single-allocator
    # POST /recompute path, which is the endpoint reachable from the anon demo
    # surface — the cron runs with SERVICE_KEY under internal trust.
    universe = await asyncio.to_thread(_load_candidate_universe)
    if not universe["strategies_by_id"]:
        logger.warning("match_engine cron: no strategies in universe")
        return _early_return("empty_universe", reason="empty_universe")

    processed = 0
    skipped = 0
    failed = 0

    for profile in allocators:
        allocator_id = profile["id"]

        # Re-check kill switch mid-run (founder may flip it).
        if not await asyncio.to_thread(_kill_switch_enabled):
            logger.info("match_engine cron: kill switch flipped mid-run, aborting")
            break

        if await _should_skip_allocator(allocator_id, force=False):
            skipped += 1
            continue

        try:
            await _score_one_allocator(allocator_id, universe)
            processed += 1
        except Exception as err:
            logger.exception("match_engine cron: allocator %s failed: %s", allocator_id, err)
            failed += 1
            # Continue the loop — one allocator failure doesn't fail the cron

    # Retention sweep at end of cron. Log at ERROR so a silently-broken
    # sweep (RLS regression, FK error, URL truncation) lights up alerts
    # rather than getting buried.
    retention_total = 0
    for profile in allocators:
        try:
            retention_total += await asyncio.to_thread(_retention_sweep, profile["id"])
        except Exception as err:
            logger.error(
                "match_engine cron: retention sweep failed for %s: %s",
                profile["id"], err,
            )

    duration_s = _duration()

    # Pick a status discriminator that lets monitoring switch on a single
    # field. Returning "ok" on a structural fault (every allocator failed)
    # would let dashboards stay green while the engine is broken — distinct
    # statuses surface the breakdown without forcing log-text parsing.
    if failed > 0 and processed == 0:
        status_value = "total_failure"
        logger.error(
            "match_engine cron: TOTAL FAILURE — processed=0 failed=%d "
            "(structural; see preceding exceptions)",
            failed,
        )
    elif failed > 0 and failed > processed:
        status_value = "degraded"
        logger.error(
            "match_engine cron: majority failure — processed=%d failed=%d",
            processed, failed,
        )
    else:
        status_value = "ok"

    logger.info(
        "match_engine cron complete: status=%s processed=%d skipped=%d "
        "failed=%d retention_deleted=%d duration_s=%.2f",
        status_value, processed, skipped, failed, retention_total, duration_s,
    )
    return {
        "status": status_value,
        "processed": processed,
        "skipped": skipped,
        "failed": failed,
        "retention_deleted": retention_total,
        "duration_s": duration_s,
    }
