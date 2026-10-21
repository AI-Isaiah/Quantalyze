"""Perfect Match Engine router — admin-only match queue computations.

POST /api/match/recompute            Single-allocator recompute (called from Next.js admin)
POST /api/match/cron-recompute       Daily cron that loops all allocators

See docs/superpowers/plans/2026-04-07-perfect-match-engine.md Phase 2.

TRUST BOUNDARY (H-0558 / M-0601)
--------------------------------
Every route here is gated ONLY by the global ``X-Service-Key`` middleware in
``main.py`` — a single shared secret used across the entire analytics-service
surface (cron worker, debug scripts, internal tools). There is NO per-user
RBAC, no signed JWT, and no ``profiles.is_admin`` check inside FastAPI; trust
that the caller is the legitimate Next.js admin gate is fully delegated to that
shared secret.

Consequences a caller MUST understand:
  * ``recompute`` accepts ``allocator_id`` from the request body. It is
    validated as an *allocator/both* profile (``_is_allocator_profile``) but is
    NOT bound to a verified acting user — anyone holding SERVICE_KEY can
    recompute ANY allocator's batch and (via ``force=True``) evict their
    retention window.
  * Do NOT forward an end-user-supplied ``allocator_id`` to this endpoint from
    any non-admin Next.js route without first verifying admin authorization at
    the Next.js layer.

The defense-in-depth fix (forward the acting user's Supabase JWT and verify
``profiles.is_admin`` server-side, or sign the (acting_user, allocator_id)
tuple) is a cross-service change tracked outside this worktree. This docstring
is the explicit trust contract the audit (M-0601) requires; the
``_is_allocator_profile`` gate added below is the in-service hardening that
stops non-allocator UUIDs from manufacturing batches.
"""

import asyncio
import logging
import os
import re
import time
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from functools import partial
from typing import Annotated, Any, Final
from uuid import UUID, uuid4

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from services.allocator_equity_derive import account_identity_tokens, one_key_per_account_day
from services.allocator_positions import read_native_unpriced_days
from services.benchmark import get_btc_closes
from services.db import (
    PaginatedSelectTruncated,
    Row,
    _is_transient_read_error,
    chunked_in_query,
    db_execute,
    db_read_with_retry,
    db_read_with_retry_sync,
    get_supabase,
    one,
    paginated_select,
    rows,
)
# PYAPI-05 — every deliberate error in this file's seam-reachable arms goes
# through service_error so the four status classes cannot drift apart
# site-by-site. Contract: analytics-service/docs/STATUS_CONTRACT.md.
from services.error_contract import RETRY_AFTER_SECONDS, service_error
from services.holding_equity import holding_equity_contribution
from services.holding_marks import classify_derivative_marks, classify_spot_marks
from services.match_defaults import merge_with_defaults
from services.match_engine import (
    ENGINE_VERSION,
    PORTFOLIO_FIT_MIN_OVERLAP_DAYS,
    WEIGHTS_VERSION,
    score_candidates,
)
from services.match_eval import (
    compute_hit_rate_metrics,
)
from services.native_to_usd import UsdSeriesConverter, native_units_by_id
from services.rate_limit import limiter, tenant_or_platform_key
from services.wealth_returns import daily_returns_from_row, records_to_series

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
# M-1 (red-team): per-allocator asyncio.Lock makes the check-then-stamp
# sequence atomic. Without the lock, N concurrent force=True requests all
# read 0.0 on pod startup, pass the gate simultaneously, and queue on
# _scoring_semaphore(3) — exactly the concurrent churn the throttle guards
# against. The lock is created on first use (defaultdict pattern).
_force_lock: dict[str, asyncio.Lock] = {}

# NEW-C08-06: per-allocator serialization lock for the FULL
# skip-check → score → match_batches insert sequence. Distinct in PURPOSE
# from _force_lock (which makes only the force-throttle check-then-stamp
# atomic and is released FAST so a throttled force request gets an immediate
# 429 rather than queueing behind 30s of scoring): _recompute_lock is HELD
# across scoring + the insert, so a non-forced POST /recompute cannot race
# cron_recompute (or another POST) into a DUPLICATE batch for the same
# allocator — the second holder runs _should_skip_allocator AFTER the first
# commits and sees the fresh batch, so it skips. Acquired in BOTH recompute()
# and cron_recompute(), always AFTER _force_lock is released (no nested hold)
# so there is no lock-ordering deadlock. Process-local: this closes the
# finding's stated single-process race (the match engine runs one worker
# today; cron awaits _score_one_allocator sequentially). Multi-worker
# durability (a Postgres advisory lock or a UNIQUE constraint on
# match_batches) is the separately-tracked H-0562 — see the module comment.
_recompute_lock: dict[str, asyncio.Lock] = {}


def _get_recompute_lock(allocator_id: str) -> asyncio.Lock:
    """Return the per-allocator recompute serialization lock (NEW-C08-06),
    creating it on first use. No await between the get and the caller's
    ``async with`` (and asyncio.Lock.acquire on a free lock does not yield),
    so the create-then-acquire is not interleaved — mirrors _force_lock.
    Bounded by the role-gated allocator population: only real allocator_ids
    reach here (recompute()'s NEW-C08-10 role gate and cron's
    role IN ('allocator','both') filter run before acquisition). Idle entries
    are pruned by _prune_stale_force_entries."""
    lock = _recompute_lock.get(allocator_id)
    if lock is None:
        lock = asyncio.Lock()
        _recompute_lock[allocator_id] = lock
    return lock


def _prune_stale_force_entries(now: float | None = None) -> None:
    """MA1 (red-team LOW9): evict stale per-allocator force-throttle state.

    ``_force_last_run`` and ``_force_lock`` grow one permanent entry per
    distinct allocator_id that ever hits the force=True path. Bounded by the
    allocator population today, but unbounded in principle (e.g. a SERVICE_KEY
    holder rotating allocator_ids). Called on the force path before the
    check-then-stamp so the dicts stay proportional to *recently-active*
    allocators, not all-time.

    Eviction rule preserves throttle semantics exactly:
      * A stamp is droppable only once it is OLDER than
        FORCE_RECOMPUTE_MIN_INTERVAL_S — at that age it can no longer throttle
        any future request (the gate compares ``now - stamp`` against the same
        window), so removing it changes no decision. A *recent* stamp (still
        inside the window) is retained so it keeps throttling.
      * A lock is dropped only when it is (a) NOT currently held — an in-flight
        request is inside ``async with _force_lock[id]`` — and (b) its allocator
        has no surviving (recent) stamp. Dropping a held lock would let a
        concurrent waiter acquire a *different* lock object, breaking the
        atomicity M-1 added; dropping an unheld lock is safe because the next
        force request lazily recreates one.
    """
    if now is None:
        now = time.monotonic()
    cutoff = FORCE_RECOMPUTE_MIN_INTERVAL_S
    # Prune stamps that can no longer throttle (older than the window).
    stale_ids = [
        aid for aid, stamp in _force_last_run.items()
        if now - stamp >= cutoff
    ]
    for aid in stale_ids:
        del _force_last_run[aid]
    # Prune idle locks whose allocator no longer has a live (recent) stamp.
    # Iterate a snapshot of keys since we mutate the dict in the loop.
    for aid in list(_force_lock.keys()):
        if aid in _force_last_run:
            continue  # still has a recent stamp → keep the matching lock
        lock = _force_lock.get(aid)
        if lock is not None and not lock.locked():
            del _force_lock[aid]
    # NEW-C08-06: prune idle recompute-serialization locks on the same cadence.
    # Same safety rule as above — never drop a HELD lock (an in-flight
    # skip→score→insert is inside it; dropping it would let a concurrent waiter
    # acquire a different lock object and break serialization, the M-1 hazard).
    # These have no paired stamp, so lock.locked() is the only guard; an unheld
    # lock is safe to drop because the next request lazily recreates one.
    for aid in list(_recompute_lock.keys()):
        lock = _recompute_lock.get(aid)
        if lock is not None and not lock.locked():
            del _recompute_lock[aid]

# C-01 (code-review): page size for analytics SELECT .in_() fetches
# (NEW-C08-02 / NEW-C08-03). Previously defined at line 1007 (below its call
# sites at lines 190 and 466) — CPython resolves module globals at call time
# so no NameError in production, but tests that partially evaluate the module
# or monkeypatch before full load would raise. Canonical placement with the
# other per-module constants ensures the definition precedes every use.
# The retention sweep already documents this hazard at L1122; the same
# URL-length cap applies to every unbounded .in_() against strategy_analytics.
# 200 IDs/request is well under the PostgREST/nginx URL cap (~8KB) for
# typical 36-char UUIDs and keeps the per-query response size manageable.
_ANALYTICS_IN_LIST_PAGE_SIZE = 200

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
    # C-PR5-01 (audit-2026-05-07): the authenticated actor's user_id, as
    # forwarded by the Next.js admin route from supabase.auth.getUser().
    # Optional today for backward compatibility — when present, the
    # endpoint asserts ``actor_id == allocator_id`` OR ``actor_id`` is
    # an admin profile. When absent, the legacy SERVICE_KEY-only gate
    # still applies (the Next.js admin route is the de facto gate), but
    # a deprecation warning is logged so operators can track the
    # rollout. Future PR will flip this to required.
    actor_id: UUID | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


# Tri-state kill-switch status (Phase 164.5.1 criterion 8). The closed state
# is DISTINCT from the founder's own switch: a database outage yields
# KILL_SWITCH_UNAVAILABLE, the founder flipping system_flags yields
# KILL_SWITCH_DISABLED. No input may produce the same status for both
# causes — a database outage must never be mistaken for the founder pressing
# the switch (Sentry QUANTALYZE-1D, 5 events, 2026-09-12).
KILL_SWITCH_ENABLED = "enabled"
KILL_SWITCH_DISABLED = "disabled"
KILL_SWITCH_UNAVAILABLE = "kill_switch_unavailable"


async def _engine_is_enabled() -> str:
    """Return the kill switch's tri-state status.

    M-0609: named to match the DB flag ``match_engine_enabled`` — an
    engine-ON flag, not a kill-switch flag. The previous name
    ``_kill_switch_enabled`` read inverted at every call site
    (``if not _kill_switch_enabled(): skip``), which conventionally means "if
    the kill switch is NOT enabled, skip" — the opposite of the actual logic.

    Fail-CLOSED contract (Phase 164.5.1 criterion 8, superseding the former
    fail-open one): the Supabase read goes through `db_read_with_retry`,
    which retries ONLY a transient-timeout-shaped exception
    (`_is_transient_read_error`: a gateway 504 or an httpx ReadTimeout) up to
    DB_READ_MAX_RETRIES times. After retries
    are exhausted — or on any other exception — the engine STOPS:
    KILL_SWITCH_UNAVAILABLE is returned and logged at ERROR so Sentry fires.
    There is no surviving fail-open arm; a transient DB blip that outlasts
    the retry budget is no longer a "blip" and must not be treated as one.
    """
    supabase = get_supabase()

    def _read() -> Any:
        return supabase.table("system_flags").select("enabled").eq(
            "key", "match_engine_enabled"
        ).maybe_single().execute()

    try:
        result = await db_read_with_retry(_read)
        row = one(result)
        if not row:
            return KILL_SWITCH_ENABLED  # No row / null maybe_single response = default enabled
        return (
            KILL_SWITCH_ENABLED
            if bool(row.get("enabled", True))
            else KILL_SWITCH_DISABLED
        )
    except Exception as err:
        # WR-14: one log that INTERPOLATES the classification, not twelve
        # lines of branch between two messages differing by a parenthetical.
        # The two arms shared their prefix and their suffix, no test could
        # tell them apart, and the branch was therefore unexercised in the
        # direction that mattered. `_is_transient_read_error` is `services.db`'s
        # own retry predicate — the classification is only ever a log
        # adjective here; both arms stop the engine FAIL-CLOSED identically.
        # Phase 166.5.1 (T-166.5.1-08): the predicate widened to ReadTimeout,
        # so an exhausted ReadTimeout reads "transient timeout", not
        # "non-retryable".
        logger.error(
            "match_engine: kill switch check FAILED (%s) — engine STOPPED "
            "(kill_switch_unavailable): %s",
            "transient timeout, retries exhausted"
            if _is_transient_read_error(err)
            else "non-retryable",
            err,
        )
        return KILL_SWITCH_UNAVAILABLE


# M-0603 (part 1): the cron's mid-run kill-switch re-check used to call
# _engine_is_enabled() once PER allocator — one Supabase round-trip per loop
# iteration just to read a single boolean (O(allocators) RTTs). Cache the
# result for a short TTL so a founder who flips the switch mid-run is still
# honored within KILL_SWITCH_CACHE_TTL_S, at the cost of at most one extra
# query per TTL window rather than one per allocator. Process-local; the
# cron is the only sustained-loop caller (the single POST /recompute path
# reads it once and does not benefit, but is unharmed — a fresh process or a
# stale-by-<TTL cache value is still correct enough for a one-shot request).
KILL_SWITCH_CACHE_TTL_S = 30.0
_kill_switch_cache: dict[str, float | str] = {}  # {"at": monotonic, "value": str}


async def _engine_is_enabled_cached() -> str:
    """TTL-cached view over _engine_is_enabled for the per-allocator cron loop.

    Returns the cached value when it is younger than KILL_SWITCH_CACHE_TTL_S,
    otherwise re-polls and refreshes the cache. The TTL bounds the staleness of
    a mid-run flip to KILL_SWITCH_CACHE_TTL_S seconds.

    Fail-closed cache contract (Phase 164.5.1 criterion 8, task 2): the cache
    NEVER serves a value produced by a failed poll — an exhausted poll
    (KILL_SWITCH_UNAVAILABLE) INVALIDATES the cache instead of being stored,
    so a stale prior ENABLED value can never be resurrected by a subsequent
    outage. Only KILL_SWITCH_ENABLED and KILL_SWITCH_DISABLED are ever
    written to the cache.
    """
    now = time.monotonic()
    cached_at = _kill_switch_cache.get("at")
    if isinstance(cached_at, float) and (now - cached_at) < KILL_SWITCH_CACHE_TTL_S:
        return str(_kill_switch_cache.get("value", KILL_SWITCH_ENABLED))
    value = await _engine_is_enabled()
    if value == KILL_SWITCH_UNAVAILABLE:
        # A failed poll invalidates rather than caches — never serve a value
        # produced by a failed poll, and never let a stale ENABLED/DISABLED
        # entry survive an outage.
        _kill_switch_cache.clear()
        return KILL_SWITCH_UNAVAILABLE
    _kill_switch_cache["at"] = now
    _kill_switch_cache["value"] = value
    return value


def _reset_kill_switch_cache() -> None:
    """Clear the cache. Called at the top of each cron run so a fresh poll
    happens immediately rather than honoring a value cached by a prior run."""
    _kill_switch_cache.clear()


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
      "native_units": {sid: unit}   # D-23: candidates whose series is not in USD
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
    strategies = rows(strategies_result)
    strategy_ids = [s["id"] for s in strategies]

    if not strategy_ids:
        return {"strategies_by_id": {}, "returns_by_id": {}}

    # NEW-C08-02: paginate the analytics IN-list. The retention sweep at
    # L1122 already documents this hazard ("an unbounded list risks HTTP
    # 414 or silent filter truncation"); this fetch was unguarded. On
    # truncation, missing strategies received analytics={} → None Sharpe/DD/
    # returns, still emitted as candidates, scored on defaults (preference_fit
    # 0.5) — a silent universe contamination indistinguishable from healthy.
    # NEW-C08-02 / B19: bound the analytics IN-list through the one
    # chunked_in_query primitive (every executed IN-list <= page_size ids, so a
    # 414 / silent PostgREST filter-truncation is unrepresentable) and read its
    # uniform coverage counts. On a gap, missing strategies receive analytics={}
    # → None Sharpe/DD/returns, still emitted as candidates, scored on defaults
    # (preference_fit 0.5) — a silent universe contamination indistinguishable
    # from healthy unless this coverage check fires.
    _analytics = chunked_in_query(
        lambda _chunk: (
            supabase.table("strategy_analytics")
            # M-0605: select ONLY the fields the engine consumes. The previous
            # query also pulled cumulative_return, cagr, and volatility, none of
            # which are read into strategies_by_id below — dead select fields
            # that bloated every per-page response and misled readers about what
            # the engine actually uses (sharpe, max_drawdown, returns_series).
            # D-23: `data_quality_flags` rides the same row as `returns_series`,
            # so a BTC strategy's `native_unit` is read beside the series it
            # describes. It is consumed by `_score_one_allocator`, which converts
            # to USD before the engine weights anything.
            # 164.6.6.2.2 (D-01, D-02): `returns_series` is the cumulative wealth
            # CURVE, so the candidate's daily returns come from `daily_returns`
            # when stored and are otherwise derived from the curve, never read
            # as returns.
            .select(
                "strategy_id, returns_series, daily_returns, sharpe, max_drawdown, "
                "data_quality_flags"
            )
            .in_("strategy_id", _chunk)
        ),
        strategy_ids,
        id_field="strategy_id",
        page_size=_ANALYTICS_IN_LIST_PAGE_SIZE,
    )
    analytics_rows = _analytics.rows
    if _analytics.truncated:
        # A3-04: escalate to ERROR when the gap exceeds a meaningful fraction
        # (>10% of universe, min 10 strategies). A handful of new listings
        # legitimately have no analytics row; a large gap is a real coverage
        # anomaly (historically IN-list truncation — now bounded away — or a
        # stalled analytics pipeline). ERROR surfaces to Sentry; WARNING is
        # low-level noise for normal growth. The >10% policy lives HERE, not in
        # chunked_in_query, so the helper stays a pure detection primitive.
        if _analytics.gap > max(10, _analytics.requested_count * 0.10):
            logger.error(
                "match: universe analytics coverage %d/%d — gap of %d (%.0f%%) "
                "exceeds threshold (>10%% or >10); the analytics pipeline is "
                "likely stalled or backfilled incompletely (the IN-list is now "
                "bounded by chunked_in_query, so truncation is not the cause)",
                _analytics.returned_count, _analytics.requested_count,
                _analytics.gap, 100.0 * _analytics.gap_fraction,
            )
        else:
            logger.warning(
                "match: universe analytics coverage %d/%d — %d strategies have "
                "no analytics row (expected as new-strategy lag; a sustained "
                "nonzero rate on a full platform indicates a stalled analytics "
                "pipeline, not IN-list truncation)",
                _analytics.returned_count, _analytics.requested_count,
                _analytics.gap,
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
            # M-0605: this is the PER-STRATEGY reported AUM (strategies.aum), NOT
            # the manager's total AUM across all their strategies. The engine's
            # _compute_capacity_fit reads it as "how much of capacity does this
            # ticket consume", which is a per-strategy capacity notion. The key
            # name `manager_aum` is a historical misnomer; it is preserved here
            # (rather than renamed to `strategy_aum`) because it is persisted
            # verbatim into score_breakdown.raw.manager_aum and consumed by the
            # TypeScript parity layer — renaming the JSONB key is a cross-runtime
            # contract change tracked separately. Computing the TRUE manager_aum
            # (SUM over strategies.user_id) is a behaviour change, also deferred.
            "manager_aum": float(_aum) if (_aum := strategy.get("aum")) else None,
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

        daily_returns = daily_returns_from_row(analytics, name=sid, keep_absent=True)
        if daily_returns is not None:
            returns_by_id[sid] = daily_returns

    return {
        "strategies_by_id": strategies_by_id,
        "returns_by_id": returns_by_id,
        # D-23: {sid: native unit} for the candidates whose returns_series is NOT
        # in USD. Read from the same analytics rows as the series themselves.
        "native_units": native_units_by_id(analytics_rows),
    }


# The most rows one holdings or key read may return before it counts as possibly
# truncated. PostgREST's ``max_rows`` is 1000 on this project and a read at that
# ceiling returns a silent partial list. Same figure as ``HOLDINGS_ROW_CAP`` in
# src/lib/latest-holdings-per-key.ts, which fails loud the same way.
_HOLDINGS_ROW_CAP = 1000

# The per-holding mark history the matcher reads is bounded the way /compare's is
# (HOLDING_COMPARE_WINDOW_DAYS and HOLDING_COMPARE_MAX_PAGES in
# src/app/(dashboard)/compare/lib/holding-compare-adapter.ts): 730 days, and at most 50
# pages of ``_HOLDINGS_ROW_CAP`` rows. A read that fills every page raises instead of
# returning a partial series.
_HOLDINGS_HISTORY_WINDOW_DAYS = 730
_HOLDINGS_HISTORY_MAX_PAGES = 50


# D-20 (founder, 167.1.1.1): the fewest ADJACENT one-day returns a spot holding needs to join
# the matcher's return signal. The shared price rule (``MIN_PRICED_DAYS``, D-03) admits a
# holding by how many days it is priced, and 30 priced days that are not adjacent have no
# one-day return at all. ``score_candidates`` joins the book on the days every series carries
# a return, so one such series would empty that join, null the portfolio-fit axis and silence
# every correlation-ceiling test for the allocator. The old dollar-ratio gate counted 30
# returns, not 30 days. This is a MATCHER constant on purpose and a distinct cause from
# ``too_few_priced_days``: /compare and the shared rule are unchanged, and a false cause is
# the defect class this repo avoids.
_MATCHER_MIN_ADJACENT_RETURNS: Final[int] = 30

# D-22 (founder, 167.1.1.1): the fewest days the book's shared-days join must span for the
# portfolio-fit axis to compute. It IS the engine's ``PORTFOLIO_FIT_MIN_OVERLAP_DAYS`` (the same
# constant feeds the candidate-level marker, so the two cannot disagree); a book whose join is
# shorter is NAMED with ``book_join_marker`` and no holding is withheld to fit it.
_BOOK_JOIN_MIN_DAYS: Final[int] = PORTFOLIO_FIT_MIN_OVERLAP_DAYS

# D-23 (founder, 167.1.1.1 round 2): a book whose matcher AUM is zero or below sizes the ticket
# at the engine's add-weight CEILING, ``_clamp(ticket / aum, 0.01, 0.5)`` at its top, consistent
# with D-21 (a tiny positive AUM). ``score_candidates`` reads ``portfolio_aum=None`` as
# "cold-start or unknown AUM" and sizes at a fixed 0.10, which would score a LOSING book better
# on max weight than a book with $100. ``_AUM_NOT_POSITIVE_SCORING_AUM`` is the AUM handed to the
# engine instead: positive and so small that any positive ticket divided by it clamps to the
# ceiling. It exists only for that call; the persisted AUM share stays null.
_ADD_WEIGHT_CEILING: Final[float] = 0.5
_AUM_NOT_POSITIVE_SCORING_AUM: Final[float] = 1e-6

# D-24, D-25 (founder, 167.1.1.1 round 3): the engine sizes ``add_weight`` from the ticket and the
# AUM in PERSONALIZED mode only; everywhere else, and for an unknown AUM, it uses the fixed
# default below (``match_engine`` ``add_weight = 0.10``). Those cases are not changed, only
# NAMED on the batch, so a reader can tell a default from a measured sizing.
_ADD_WEIGHT_DEFAULT: Final[float] = 0.10
_FALLBACK_AUM_NOT_POSITIVE_CEILING: Final[str] = "aum_not_positive_ceiling_0_5"
_FALLBACK_AUM_NOT_POSITIVE_SCREENING: Final[str] = "aum_not_positive_screening_default_0_10"
_FALLBACK_AUM_UNKNOWN: Final[str] = "aum_unknown_default_0_10"


def _holdings_history_window_start() -> str:
    """The first ``asof`` (YYYY-MM-DD, UTC) the holdings history read asks for.

    A function, not a constant, so a test with a fixed fixture calendar can pin it."""
    start = datetime.now(timezone.utc).date() - timedelta(days=_HOLDINGS_HISTORY_WINDOW_DAYS)
    return start.isoformat()


class SeriesIndexError(RuntimeError):
    """The return series handed to the matcher's scoring do not share ONE index type
    (CR-01, round 2). pandas treats a string day and a ``Timestamp`` (or a tz-naive and a
    tz-aware day) as different labels, so a mixed set joins to ZERO shared days without any
    error: the portfolio-fit axis goes null, every correlation-ceiling test is skipped, and
    the D-22 marker blames an overlap that is fine. Raised before scoring so that can never be
    silent."""


def assert_uniform_datetime_index(
    groups: dict[str, dict[str, pd.Series]], *, allocator_id: str
) -> None:
    """Raise :class:`SeriesIndexError` unless every non-empty series across ``groups``
    (``{label: {series_id: Series}}``, e.g. the book and the candidates) is indexed by a
    ``DatetimeIndex`` of ONE tz-awareness, the shape ``records_to_series`` gives every
    strategy, candidate and holding series. Names the group, the series ids and the offending
    index types, never a value. An empty series has no day to join and is skipped."""
    not_datetime: list[str] = []
    naive: list[str] = []
    aware: list[str] = []
    for label, series_by_id in groups.items():
        for sid, series in series_by_id.items():
            if len(series) == 0:
                continue
            index = series.index
            ref = f"{label}:{sid}"
            if not isinstance(index, pd.DatetimeIndex):
                not_datetime.append(f"{ref} ({type(index).__name__})")
            elif index.tz is None:
                naive.append(ref)
            else:
                aware.append(ref)
    if not_datetime or (naive and aware):
        parts: list[str] = []
        if not_datetime:
            parts.append(f"{len(not_datetime)} not DatetimeIndex-indexed: {_sample(not_datetime)}")
        if naive and aware:
            parts.append(
                f"{len(naive)} tz-naive ({_sample(naive)}) beside {len(aware)} tz-aware "
                f"({_sample(aware)})"
            )
        raise SeriesIndexError(
            f"allocator {allocator_id}: the scored series must all share one DatetimeIndex "
            f"type (the shape records_to_series produces), but " + "; ".join(parts)
        )


def _sample(refs: list[str], limit: int = 3) -> str:
    more = f", and {len(refs) - limit} more" if len(refs) > limit else ""
    return ", ".join(refs[:limit]) + more


class HoldingsReadTruncated(RuntimeError):
    """A holdings or key read reached ``_HOLDINGS_ROW_CAP`` rows, so it may be a
    partial list. Scoring on a partial book would report a confident, wrong
    ``portfolio_aum``; ``_score_one_allocator``'s caller turns this, like any
    failed read, into a 500 with a correlation id."""


def _load_holding_portfolio_context(allocator_id: str) -> dict[str, Any]:
    """Phase 09 / D-01 + D-16, rewritten by 167.1.1.1 (BRIDGERETURNS). Load
    allocator_holdings and build each spot holding's return series from its daily MARK
    PRICE.

    Phase 170.4 D-08 / D-10 (Phase 167.1.1 R-15-1, R-15-2): one API key is one
    strategy, so the AUM is the sum over EVERY live key's position, and keys that
    read ONE exchange account count it once. Each account (``account_identity_tokens``,
    the dashboard's and the commit RPC's identity: keys that share a non-blank
    (exchange, venue_account_id) or a marker link; any other key is its own account)
    takes its rows at its newest ``asof``, and ``one_key_per_account_day`` (plan 11)
    keeps, per account AND per holding type, the one key that wins that day (latest
    ``updated_at`` instant, ties by smallest lowercase ``api_key_id``). Rows of a key before its account's newest day
    no longer count. Rows of different keys that share a (venue, symbol,
    holding_type) are SUMMED into one pseudo-strategy, which carries their total
    once. The same rule runs in TypeScript for the dashboard and the scenario
    commit (``oneKeyPerAccountDay``); both are replayed against one case table.
    Only service-written evidence enters: ``allocator_holdings`` rows and
    ``updated_at``, the native-unpriced markers and the owner's ``api_keys``
    identity columns. No audit-log read is added.

    Returns come from MARKS, not dollars (D-03, D-07): one tenant-filtered, capped
    history read of the allocator's holdings (D-05), grouped per (venue, symbol,
    holding_type) (D-08), then ``classify_spot_marks`` for each spot holding. The change
    of a holding's dollar value is never read as a return, so a purchase, a sale or a
    transfer is not a gain or a loss. A mark that breaks the read contract, or an
    unusable ``updated_at``, raises (``HoldingMarkContractError``,
    ``HoldingsUpdatedAtError``) and is deliberately not caught here: the scorer's
    caller logs it under a correlation id.

    What is in and out of the book (D-01, spot only in this function):

    ===========================  ========  ==================  ==================  ==================
    spot holding                 AUM       AUM share, max-wt   scoring weights     returns, eligible
    ===========================  ========  ==================  ==================  ==================
    priced (30+ priced days and  in        in                  in                  in
    30+ adjacent returns)
    withheld (account_balance,   in        in                  out (no series)     out (named)
    fixed_price, no_price,
    too_few_priced_days,
    too_few_adjacent_returns)
    ===========================  ========  ==================  ==================  ==================

    Two weight notions, kept apart on purpose (review CR-01). The AUM share
    (``aum_contribution_usd`` over the full matcher AUM, withheld spot and derivative P&L
    included) is what ``holding_flags`` persists and what the max-weight test reads (D-01,
    D-16); ``compute_holding_flags`` derives it from ``portfolio_aum``. The SCORING weights
    (``portfolio_weights``) are what ``match_engine`` blends the joined series with, so they
    cover exactly the series it joins and sum to 1: a withheld holding has no series and
    must not sit in their denominator, or the candidate's add_weight is inflated.

    ``too_few_adjacent_returns`` (D-20) is a matcher-only reason: a holding with 30 or more
    priced days whose marks give fewer than ``_MATCHER_MIN_ADJACENT_RETURNS`` adjacent
    one-day returns. It keeps the price rule's reasons below 30 priced days.

    The AUM is the allocator's own (D-15, D-16): every collapsed holding, spot priced,
    spot withheld and derivative, adds ``aum_contribution_usd``, which is
    ``holding_equity_contribution`` summed over the holding's counted rows (spot: its
    finite ``value_usd``; derivative: its signed unrealized P&L, never its notional). A
    derivative is in the AUM and in NEITHER the weights, the max-weight test nor the
    returns (D-19, D-09). A derivative whose counted rows reported no P&L (D-18)
    contributes nothing and carries ``pnl_missing`` True with ``aum_contribution_usd``
    None: it is never counted as 0.0.

    This helper is SYNC (plain def) — called from _load_allocator_context which is
    itself sync and invoked via asyncio.to_thread. Per finding f1: MUST NOT be
    converted to async def.

    Returns dict with:
      portfolio_strategies: list[dict]  (priced spot only; strategy_id = "holding:V:S:T")
      portfolio_weights:    dict[str, float]  (SCORING weights: aum_contribution_usd over
                                               the sum of the PRICED spot holdings only, so
                                               they sum to 1.0 over the series
                                               match_engine joins; withheld spot and
                                               derivatives are not in them)
      portfolio_returns:    dict[str, pd.Series]  (one Series per priced spot holding)
      portfolio_aum:        float  (sum of aum_contribution_usd over every collapsed
                                    holding: spot priced, spot withheld, derivative)
      holdings_rows_eligible: list[dict]  (one row per priced spot pseudo-strategy,
                                           ``value_usd`` summed over the counted keys,
                                           for compute_holding_flags consumption)
      holdings_rows_withheld: list[dict]  (one row per withheld spot holding, the same
                                           shape plus ``withheld_reason``)
      holdings_rows_derivative: list[dict]  (one row per collapsed derivative holding, with
                                           ``aum_contribution_usd`` (float | None),
                                           ``pnl_missing`` and ``withheld_reason``: the
                                           reason it is out of the book, ``pnl_missing`` >
                                           the price rule's > ``derivative_out_of_book``)

    Every collapsed row carries ``aum_contribution_usd`` (float | None: None only for a
    derivative none of whose counted rows had a P&L) and ``pnl_missing`` (bool).
    """
    supabase = get_supabase()

    # --- Step 1: the owner's keys, then each key's newest day of holdings ---
    # 170.4 review WR-03 / SFH-1: this used to read the allocator's WHOLE holdings
    # history in one unbounded SELECT. PostgREST's max_rows (1000 on this project)
    # truncates such a read with no error, and the account-newest-day rule below
    # would then take an account's "newest" day from a partial list. The read is
    # now the one ``fetchLatestHoldingsPerKey`` makes (src/lib/latest-holdings-per-key.ts):
    # per key, its latest ``asof`` and then the rows on that day. Every read is
    # owner-filtered and asks for at most ``_HOLDINGS_ROW_CAP`` rows; one that
    # returns that many raises, because the book would be a partial one. A key's
    # rows before its newest day never counted (its account's newest day is the
    # latest of its keys' newest days), so nothing the old read used is dropped.
    key_rows = rows(
        supabase.table("api_keys")
        .select(
            "id, exchange, venue_account_id, account_share_kind, "
            "account_shared_with_api_key_id"
        )
        .eq("user_id", allocator_id)
        .limit(_HOLDINGS_ROW_CAP)
        .execute()
    )
    if len(key_rows) >= _HOLDINGS_ROW_CAP:
        raise HoldingsReadTruncated(
            f"api_keys read reached the {_HOLDINGS_ROW_CAP}-row cap for allocator {allocator_id}"
        )
    holdings_rows: list[Row] = []
    for key_row in key_rows:
        key_id = str(key_row["id"])
        latest = rows(
            supabase.table("allocator_holdings")
            .select("asof")
            .eq("allocator_id", allocator_id)
            .eq("api_key_id", key_id)
            .order("asof", desc=True)
            .limit(1)
            .execute()
        )
        if not latest:
            continue
        day_rows = rows(
            supabase.table("allocator_holdings")
            .select(
                "api_key_id, venue, symbol, holding_type, value_usd, "
                "unrealized_pnl_usd, asof, updated_at"
            )
            .eq("allocator_id", allocator_id)
            .eq("api_key_id", key_id)
            .eq("asof", latest[0]["asof"])
            .limit(_HOLDINGS_ROW_CAP)
            .execute()
        )
        if len(day_rows) >= _HOLDINGS_ROW_CAP:
            raise HoldingsReadTruncated(
                f"allocator_holdings per-key read reached the {_HOLDINGS_ROW_CAP}-row cap "
                f"for allocator {allocator_id}"
            )
        holdings_rows.extend(day_rows)

    # --- Step 1b: drop a native-unpriced key's rows dated before its marker ---
    # 164.6.6.2.1 R2-WR-01 (D-02, D-08, D-17): a BTC-denominated MT5 account whose latest
    # completed day has no stored close polls to NO row, so its earlier row (priced at an
    # older close) would win the collapse below and be summed into the AUM and the weights
    # while the dashboard says the account is left out. The poll's service-written marker
    # names that day; the same reader the daily refresh uses (strict comparison: rows on
    # or after the marker's day stand). A failed marker read is logged at ERROR (which
    # reaches Sentry) and the rows are kept as they were: this is a request-time scorer,
    # and nothing it computes is persisted.
    key_ids = sorted({str(h["api_key_id"]) for h in holdings_rows if h.get("api_key_id")})
    unpriced_days: dict[str, str] = {}
    if key_ids:
        try:
            unpriced_days = read_native_unpriced_days(supabase, allocator_id, key_ids)
        except Exception:  # noqa: BLE001 - see above: keep the rows, say so loudly
            logger.exception(
                "match: native-unpriced marker read failed for allocator %s; the "
                "holdings rows are kept as they were",
                allocator_id,
            )
    if unpriced_days:
        kept_rows: list[Row] = []
        for h in holdings_rows:
            unpriced_day = unpriced_days.get(str(h.get("api_key_id")))
            if unpriced_day is not None and str(h["asof"]) < unpriced_day:
                continue
            kept_rows.append(h)
        if len(kept_rows) != len(holdings_rows):
            logger.info(
                "match: native-unpriced marker removed %d holdings row(s) for allocator %s",
                len(holdings_rows) - len(kept_rows), allocator_id,
            )
        holdings_rows = kept_rows

    # --- Step 2: every key's position, each exchange account once per day ---
    # (170.4 D-08, D-10). The owner's keys (read in Step 1; owner-filtered, identity
    # columns only, no key material) name which keys read one account.
    group_of: dict[str, str] = {}
    if holdings_rows:
        # CR-01 (D-10): the SAME identity the dashboard, the commit AUM and the
        # commit RPC's ``contributing`` CTE use: a shared non-blank
        # (exchange, venue_account_id) OR a marker link. A key with neither is
        # unknown and stays its own account (``key:<id>`` below).
        for key_id, token in account_identity_tokens(key_rows).items():
            if token is not None:
                group_of[key_id] = token

    def _account(holding: Row) -> str:
        key_id = str(holding["api_key_id"])
        return group_of.get(key_id, f"key:{key_id}")

    newest_day: dict[str, str] = {}
    for holding in holdings_rows:
        account = _account(holding)
        if account not in newest_day or str(holding["asof"]) > newest_day[account]:
            newest_day[account] = str(holding["asof"])
    day_rows_by_account: dict[str, list[Row]] = {}
    for holding in holdings_rows:
        account = _account(holding)
        if str(holding["asof"]) == newest_day[account]:
            day_rows_by_account.setdefault(account, []).append(holding)

    # One pseudo-strategy per (venue, symbol, holding_type): the counted keys'
    # values are summed into it (D-08), the eligible row carries the total once.
    #
    # Each counted row also goes through ``holding_equity_contribution`` (D-15, D-16), the
    # dashboard's AUM rule, so the matcher's AUM is the AUM the allocator sees. The collapsed
    # row's ``aum_contribution_usd`` is the sum of the contributions that exist, or None
    # when none did (only a derivative with no P&L returns None, D-18); ``pnl_missing``
    # records that at least one counted derivative row had no P&L. The missing P&L is
    # never represented as 0.0, and a derivative's notional ``value_usd`` never feeds it.
    holdings_map: dict[tuple[str, str, str], Row] = {}
    for account_rows in day_rows_by_account.values():
        for counted in one_key_per_account_day(account_rows):
            key = (counted["venue"], counted["symbol"], counted["holding_type"])
            contribution = holding_equity_contribution(counted)
            row_pnl_missing = contribution is None
            if key in holdings_map:
                held = holdings_map[key]
                held_contribution: float | None = held["aum_contribution_usd"]
                merged_contribution: float | None
                if held_contribution is None:
                    merged_contribution = contribution
                elif contribution is None:
                    merged_contribution = held_contribution
                else:
                    merged_contribution = held_contribution + contribution
                holdings_map[key] = {
                    **held,
                    "value_usd": float(held.get("value_usd") or 0.0)
                    + float(counted.get("value_usd") or 0.0),
                    "aum_contribution_usd": merged_contribution,
                    "pnl_missing": bool(held["pnl_missing"]) or row_pnl_missing,
                }
            else:
                holdings_map[key] = {
                    **counted,
                    "aum_contribution_usd": contribution,
                    "pnl_missing": row_pnl_missing,
                }
    collapsed = list(holdings_map.values())

    if not collapsed:
        return {
            "portfolio_strategies": [],
            "portfolio_weights": {},
            "portfolio_returns": {},
            "portfolio_aum": 0.0,
            "holdings_rows_eligible": [],
            "holdings_rows_withheld": [],
            "holdings_rows_derivative": [],
        }

    # --- Step 3: the holdings' mark history, one tenant-filtered, capped read ---
    # The service role bypasses RLS, so ``.eq("allocator_id", ...)`` IS the tenant
    # boundary (T-167.1.1.1-05). The read applies neither the account rule nor the
    # native-unpriced marker: a price does not depend on whose account holds the asset
    # (MT5 and sFOX holdings are withheld before any mark is read). It is bounded to the
    # window and to ``_HOLDINGS_HISTORY_MAX_PAGES`` pages; a read that fills the ceiling
    # raises, because a partial series would be reported as a complete one.
    try:
        history_rows = paginated_select(
            supabase.table("allocator_holdings")
            .select("asof, venue, symbol, holding_type, side, mark_price, updated_at, api_key_id")
            .eq("allocator_id", allocator_id)
            .gte("asof", _holdings_history_window_start()),
            order_by=(("asof", False), ("id", False)),
            page_size=_HOLDINGS_ROW_CAP,
            hard_cap_pages=_HOLDINGS_HISTORY_MAX_PAGES,
            truncation_hint="holdings history",
        )
    except PaginatedSelectTruncated as err:
        raise HoldingsReadTruncated(
            f"allocator_holdings history read reached the {_HOLDINGS_HISTORY_MAX_PAGES}-page "
            f"ceiling for allocator {allocator_id}"
        ) from err

    # One list of rows per (venue, symbol, holding_type), only for the holdings that
    # survived the account rule above (D-08: a venue's marks never feed another
    # venue's series, and no read is keyed by bare symbol). Rows of different keys on
    # one holding stay together on purpose: ``classify_spot_marks`` keeps ONE mark per
    # day across them, so two keys holding an asset never double a day.
    counted_refs = set(holdings_map)
    marks_by_ref: dict[tuple[str, str, str], list[Row]] = {}
    for hist in history_rows:
        hist_ref = (hist["venue"], hist["symbol"], hist["holding_type"])
        if hist_ref in counted_refs:
            marks_by_ref.setdefault(hist_ref, []).append(hist)

    # --- Step 4: each spot holding's returns from its marks (D-03, D-07) ---
    portfolio_strategies: list[dict[str, Any]] = []
    portfolio_returns: dict[str, pd.Series] = {}
    holdings_rows_eligible: list[Row] = []
    holdings_rows_withheld: list[Row] = []
    holdings_rows_derivative: list[Row] = []
    # pseudo_id -> aum_contribution_usd (priced AND withheld spot; never a derivative)
    raw_values: dict[str, float] = {}
    # D-15, D-16: the AUM is every collapsed holding's contribution, derivative P&L included.
    # A None (a derivative with no P&L, D-18) adds nothing; it is skipped here, not coerced.
    total_aum = 0.0
    withheld_counts: dict[str, int] = {}
    derivative_counts: dict[str, int] = {}

    for row in collapsed:
        venue = row["venue"]
        symbol = row["symbol"]
        holding_type = row["holding_type"]
        contribution = row["aum_contribution_usd"]
        if contribution is not None:
            total_aum += contribution
        if holding_type != "spot":
            # D-19, D-09: a derivative is in the AUM (its P&L, above) and nowhere else in
            # the book: no weight, no max-weight test, no return series. It is NAMED in
            # holding_flags with a reason (D-02), chosen in this precedence order:
            #   1. ``pnl_missing`` (D-18): a counted row had no P&L, so its AUM
            #      contribution is not a full figure; this outranks any price-rule reason;
            #   2. the price rule's reason (``option_premium`` D-10, ``no_price``,
            #      ``no_direction``, ``too_few_priced_days``);
            #   3. ``derivative_out_of_book`` (D-09): the signed series is usable, but a
            #      derivative never joins the book's return signal.
            # The marks are always classified, so a row that breaks the read contract
            # raises here exactly as a spot one does, whatever the P&L says.
            derivative_marks = classify_derivative_marks(
                marks_by_ref.get((venue, symbol, holding_type), []), symbol=symbol
            )
            if row["pnl_missing"]:
                derivative_reason = "pnl_missing"
            elif derivative_marks.withheld_reason is not None:
                derivative_reason = derivative_marks.withheld_reason
            else:
                derivative_reason = "derivative_out_of_book"
            holdings_rows_derivative.append({**row, "withheld_reason": derivative_reason})
            derivative_counts[derivative_reason] = derivative_counts.get(derivative_reason, 0) + 1
            continue
        pseudo_id = f"holding:{venue}:{symbol}:{holding_type}"
        # A spot row's contribution is never None (only a derivative can be); its finite
        # value is its weight basis, so a NaN value weighs 0 rather than poisoning the AUM.
        value_usd = float(contribution) if contribution is not None else 0.0

        marks = classify_spot_marks(
            marks_by_ref.get((venue, symbol, holding_type), []), venue=venue, symbol=symbol
        )
        # D-01: priced or withheld, a spot holding keeps its dollars in the AUM and
        # its weight. Only a priced one carries a return series.
        raw_values[pseudo_id] = value_usd
        # D-20: a holding the price rule ADMITTED but whose series has fewer than
        # ``_MATCHER_MIN_ADJACENT_RETURNS`` adjacent one-day returns cannot join the book's
        # return signal; the price rule's own reason always wins when it fired.
        withheld_reason = marks.withheld_reason
        if withheld_reason is None and len(marks.returns) < _MATCHER_MIN_ADJACENT_RETURNS:
            withheld_reason = "too_few_adjacent_returns"
        if withheld_reason is not None:
            holdings_rows_withheld.append({**row, "withheld_reason": withheld_reason})
            withheld_counts[withheld_reason] = withheld_counts.get(withheld_reason, 0) + 1
            continue

        portfolio_strategies.append({"strategy_id": pseudo_id})
        # CR-01 (round 2): the SAME converter the strategy and candidate series go through
        # (``daily_returns_from_row`` reaches ``records_to_series``), so a holding's days are
        # a tz-naive ``DatetimeIndex`` like theirs. A plain "YYYY-MM-DD" string index never
        # equals a ``Timestamp``, so the engine's date joins found no shared day with any
        # candidate or strategy in production.
        holding_series = records_to_series(
            [{"date": day, "value": ret} for day, ret in marks.returns], name=pseudo_id
        )
        if holding_series is None:
            # Unreachable for a finite return: the rule floors each signed return at -100% and
            # a price is positive, so every adjacent return is a finite float. Fail loud
            # rather than carry a holding with no usable series into the book.
            raise SeriesIndexError(
                f"allocator {allocator_id}: a priced spot holding's mark returns produced "
                f"no usable date-indexed series"
            )
        portfolio_returns[pseudo_id] = holding_series
        holdings_rows_eligible.append(row)

    if withheld_counts:
        # Counts per reason only: no symbol, value or key id (T-167.1.1.1-08).
        logger.info(
            "match: %d spot holding(s) withheld from the return signal for allocator %s "
            "(by reason: %s); they stay in the AUM and the weights",
            len(holdings_rows_withheld), allocator_id,
            ", ".join(f"{reason}={n}" for reason, n in sorted(withheld_counts.items())),
        )

    if derivative_counts:
        # Counts per reason only: no symbol, value or key id (T-167.1.1.1-08).
        logger.info(
            "match: %d derivative holding(s) named in holding_flags for allocator %s "
            "(by reason: %s); each adds only its P&L to the AUM",
            len(holdings_rows_derivative), allocator_id,
            ", ".join(f"{reason}={n}" for reason, n in sorted(derivative_counts.items())),
        )

    # --- Step 5: SCORING weights over the series match_engine will join (CR-01) ---
    # The denominator is the sum of the PRICED spot holdings only. A withheld holding has
    # no series, and a derivative's P&L is never a weight, so neither may sit in the
    # denominator: match_engine blends exactly the joined series, and a denominator that
    # includes dollars with no series would make the candidate's add_weight a/(S(1-a)+a)
    # with S < 1 instead of a. The AUM share that D-01 and D-16 keep over the full AUM
    # (withheld spot and derivative P&L included) is not built here; compute_holding_flags
    # derives it from ``portfolio_aum``.
    scoring_values = {pid: raw_values[pid] for pid in portfolio_returns}
    scoring_total = sum(scoring_values.values())
    portfolio_weights: dict[str, float] = {}
    if scoring_total > 0:
        for pid, val in scoring_values.items():
            portfolio_weights[pid] = val / scoring_total
    elif scoring_values:
        # Every priced holding has a zero value: equal weights over the priced set, the
        # fallback that predates this phase. Named, never silent.
        logger.warning(
            "match: scoring_weights_equal_fallback: the %d priced spot holding(s) of "
            "allocator %s sum to a non-positive value, so they are scored at equal weights",
            len(scoring_values), allocator_id,
        )
        for pid in scoring_values:
            portfolio_weights[pid] = 1.0 / len(scoring_values)

    return {
        "portfolio_strategies": portfolio_strategies,
        "portfolio_weights": portfolio_weights,
        "portfolio_returns": portfolio_returns,
        "portfolio_aum": total_aum,
        "holdings_rows_eligible": holdings_rows_eligible,
        "holdings_rows_withheld": holdings_rows_withheld,
        "holdings_rows_derivative": holdings_rows_derivative,
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
    # QUANTALYZE-2D (Phase 166.5.1, D-02a): only this select retries a transient
    # ReadTimeout (synchronous twin: this function runs in a worker thread).
    # None of the reads below move.
    prefs_result = db_read_with_retry_sync(
        lambda: supabase.table("allocator_preferences").select("*").eq(
            "user_id", allocator_id
        ).maybe_single().execute()
    )
    # postgrest maybe_single().execute() returns None (not an APIResponse with
    # data=None) when no allocator_preferences row exists. Guard the None before
    # .data; _score_one_allocator already normalizes None preferences to {}.
    # Pre-fix this raised AttributeError: 'NoneType' object has no attribute
    # 'data' on every prefs-less allocator (Sentry 122529812, cron-recompute).
    preferences = one(prefs_result)

    # Portfolio strategies + weights. Iterate all portfolios owned by this allocator.
    portfolios_result = supabase.table("portfolios").select("id").eq(
        "user_id", allocator_id
    ).execute()
    # H-2 (red-team): sort portfolio_ids before chunking so the per-chunk
    # ORDER BY (portfolio_id, strategy_id) produces a globally deterministic
    # ps_rows assembly. Without this, the first-wins loop retains whichever
    # chunk's row is seen first — non-deterministic across pod restarts when
    # the same strategy appears in portfolios spanning different pages.
    portfolio_ids = sorted(p["id"] for p in rows(portfolios_result))

    portfolio_strategies: list[dict[str, Any]] = []
    portfolio_weights: dict[str, float] = {}
    portfolio_returns: dict[str, pd.Series] = {}
    strategy_aum: float = 0.0
    # D-23: {sid: native unit} for the book's strategies whose returns_series is
    # NOT in USD, read from the same analytics rows as the series.
    native_units: dict[str, str] = {}
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
        #
        # A3-05 (silent-failure): paginate the portfolio_id IN-list. An
        # allocator with many portfolios can overflow the PostgREST URL limit
        # just like the analytics IN-lists (NEW-C08-02/03). On truncation
        # ps_rows would be incomplete → strategy_ids missing entries → the
        # analytics coverage warning at the next layer would report a "correct"
        # ratio (truncated inputs vs. truncated outputs) and the scoring would
        # silently proceed against a partial book — the same M-0675 exposure
        # but at a higher layer where no warning fires.
        # B19: route the portfolio_id IN-list through chunked_in_query (every
        # executed IN-list <= page_size, so the URL-overflow truncation this
        # comment warns about is unrepresentable). No coverage WARNING on the
        # returned flag here: the IN key is portfolio_id and a portfolio with no
        # portfolio_strategies rows is a legitimate empty book, so a portfolio_id
        # gap would be dominated by empty portfolios rather than truncation
        # (which the bounding already prevents). The meaningful coverage signal
        # fires one layer down on strategy_id (NEW-C08-03, below).
        ps_rows = chunked_in_query(
            lambda _ps_chunk: (
                supabase.table("portfolio_strategies")
                .select("strategy_id, current_weight, portfolio_id, allocated_amount")
                .in_("portfolio_id", _ps_chunk)
                .order("portfolio_id", desc=False)
                .order("strategy_id", desc=False)
            ),
            portfolio_ids,
            id_field="portfolio_id",
            page_size=_ANALYTICS_IN_LIST_PAGE_SIZE,
        ).rows

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
        analytics_by_sid: dict[str, Any] = {}
        if strategy_ids:
            # NEW-C08-03 / B19: bound the portfolio analytics IN-list through
            # chunked_in_query. A coverage gap here is the meaningful signal
            # (a strategy in the book with no analytics row → portfolio_returns
            # incomplete → _compute_portfolio_fit_components scores a partial
            # book). WARNING-only (not the universe-path's >10% ERROR): this is
            # the allocator's own book, where missing analytics is more often
            # new-strategy lag than a systemic anomaly.
            _sa = chunked_in_query(
                lambda _chunk: (
                    supabase.table("strategy_analytics")
                    # 164.6.6.2.2 (D-01, D-02): `returns_series` is the cumulative
                    # wealth CURVE, not daily returns, so the book is built through
                    # `daily_returns_from_row`, which prefers the stored
                    # `daily_returns` and otherwise derives them from the curve.
                    .select("strategy_id, returns_series, daily_returns, data_quality_flags")
                    .in_("strategy_id", _chunk)
                ),
                strategy_ids,
                id_field="strategy_id",
                page_size=_ANALYTICS_IN_LIST_PAGE_SIZE,
            )
            sa_rows = _sa.rows
            if _sa.truncated:
                logger.warning(
                    "match: portfolio analytics coverage %d/%d for allocator %s "
                    "— %d strategies lack analytics rows",
                    _sa.returned_count, _sa.requested_count, allocator_id,
                    _sa.gap,
                )
            analytics_by_sid = {row["strategy_id"]: row for row in sa_rows}
            native_units = native_units_by_id(sa_rows)
        else:
            analytics_by_sid = {}

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
                    returns = daily_returns_from_row(sa, name=sid, keep_absent=True)
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
    # D-01: a withheld spot holding stays in the AUM and the weights; only its returns
    # are left out of portfolio_returns (it is not in holding_strategies).
    holdings_rows_withheld = holdings_ctx.get("holdings_rows_withheld", [])
    holdings_rows_derivative = holdings_ctx.get("holdings_rows_derivative", [])

    # Merge strategies + holdings into combined dicts
    portfolio_strategies.extend(holding_strategies)
    portfolio_returns.update(holding_returns)

    # Matcher AUM: the allocator's own figure (D-15, D-16), strategy allocations plus every
    # holding's contribution (withheld spot and derivative P&L included). It sizes the
    # ticket (add_weight) and is the denominator of the AUM share that holding_flags
    # persists and the max-weight test reads (D-01). It is NOT the scoring denominator.
    combined_aum = strategy_aum + holding_aum

    # SCORING weights (CR-01): normalised over the series match_engine joins, that is the
    # book's strategies (allocated_amount) and the priced holdings, nothing else. A
    # withheld holding has no series and a derivative's P&L is not a weight, so neither
    # is in this denominator, exactly as before this phase. Keep this notion apart from
    # the AUM share above: put withheld dollars back in here and the candidate's
    # add_weight a becomes a/(S(1-a)+a) with S < 1, inflating sharpe_lift and
    # dd_improvement.
    # Strategy side: use allocated_amount as the value basis.
    # Holdings side: the priced holdings' aum_contribution_usd (their finite value).
    holding_abs_values: dict[str, float] = {}
    for row in holdings_rows_eligible:
        pseudo_id = f"holding:{row['venue']}:{row['symbol']}:{row['holding_type']}"
        spot_contribution = row["aum_contribution_usd"]
        # A spot row's contribution is never None (only a derivative with no P&L is).
        holding_abs_values[pseudo_id] = (
            float(spot_contribution) if spot_contribution is not None else 0.0
        )
    scoring_denominator = sum(strategy_raw_values.values()) + sum(holding_abs_values.values())

    if scoring_denominator > 0:
        # Strategies side
        for sid, val in strategy_raw_values.items():
            portfolio_weights[sid] = val / scoring_denominator
        # Holdings side
        for pid, val in holding_abs_values.items():
            portfolio_weights[pid] = val / scoring_denominator
    elif holding_strategies or portfolio_strategies:
        # Fall back: equal weights over the scored set when its values sum to nothing
        # (predates 167.1.1.1; the sign of the matcher AUM plays no part in it). Named.
        all_ids = [ps["strategy_id"] for ps in portfolio_strategies]
        eq_w = 1.0 / len(all_ids) if all_ids else 0.0
        logger.warning(
            "match: scoring_weights_equal_fallback: the %d scored series of allocator %s "
            "carry no positive value, so they are scored at equal weights",
            len(all_ids), allocator_id,
        )
        for pid in all_ids:
            portfolio_weights[pid] = eq_w

    aum_not_positive = combined_aum <= 0 and bool(
        holdings_rows_eligible or holdings_rows_withheld or holdings_rows_derivative
    )
    if aum_not_positive:
        # SFH-01: a non-positive matcher AUM is real (derivative losses can exceed spot), not
        # "no AUM data". The scoring weights do not depend on it; the AUM share and the
        # max-weight test cannot be computed, so holding_flags names that (weight None,
        # breach_skipped). The ticket sizing this implies (D-23, D-25) depends on the mode the
        # engine runs in, so it is named after scoring, by ``add_weight_fallback_entry``.
        logger.warning(
            "match: aum_not_positive: the matcher AUM of allocator %s is not positive "
            "(derivative P&L exceeds the spot and strategy value), so holding weights are "
            "persisted as null and the max-weight test is skipped; scoring weights are "
            "unaffected",
            allocator_id,
        )

    # Thumbs-down history
    td_result = (
        supabase.table("match_decisions")
        .select("strategy_id")
        .eq("allocator_id", allocator_id)
        .eq("decision", "thumbs_down")
        .execute()
    )
    thumbs_down_ids = {row["strategy_id"] for row in rows(td_result)}

    return {
        "preferences": preferences,
        "portfolio_strategies": portfolio_strategies,
        "portfolio_weights": portfolio_weights,
        "portfolio_returns": portfolio_returns,
        "native_units": native_units,
        "portfolio_aum": combined_aum if combined_aum > 0 else None,
        # D-23: True when the AUM is at or below zero for a book that holds holdings; the
        # engine's own ``portfolio_aum=None`` reading ("unknown AUM", 0.10 sizing) must not
        # apply to it.
        "aum_not_positive": aum_not_positive,
        "thumbs_down_ids": thumbs_down_ids,
        # Internal-use: passed to compute_holding_flags in _score_one_allocator (Task 3)
        "_holdings_rows_eligible": holdings_rows_eligible,
        # D-01: spot held out of the return signal by name; plan 05 names them in holding_flags.
        "_holdings_rows_withheld": holdings_rows_withheld,
        # D-02, D-19: every derivative in the book, named in holding_flags by reason and
        # P&L contribution, never weighed, never max-weight tested, never in the returns.
        "_holdings_rows_derivative": holdings_rows_derivative,
    }


def _flag_value_usd(row: dict[str, Any]) -> float:
    """The dollar figure a SPOT holding's flag entry carries and weighs on.

    The collapsed row's ``aum_contribution_usd`` when it has one (the AUM basis: a finite
    value, so a NaN ``value_usd`` weighs 0 rather than producing a NaN weight), else its
    ``value_usd`` as before. A derivative's notional never reaches this function: a
    derivative row is refused here, so a future caller cannot weigh or print a notional."""
    if row.get("holding_type") == "derivative":
        raise ValueError("_flag_value_usd is for spot rows; a derivative has no flag value")
    contribution = row.get("aum_contribution_usd")
    if contribution is not None:
        return float(contribution)
    return float(row.get("value_usd") or 0.0)


def compute_holding_flags(
    *,
    holdings_rows_eligible: list[dict[str, Any]],
    portfolio_returns: dict[str, pd.Series],
    portfolio_weights: dict[str, float],
    portfolio_aum: float | None,
    allocator_preferences: dict[str, Any],
    scored_candidates_by_slot: dict[str, list[Any]],
    holdings_rows_withheld: list[dict[str, Any]] | None = None,
    holdings_rows_derivative: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Phase 09 / finding f5. Per-holding flag rows persisted into match_batches.holding_flags.

    Returns list[dict] — one entry per eligible holding (those present in portfolio_returns),
    then (167.1.1.1 D-04, D-12) one per withheld SPOT holding in ``holdings_rows_withheld``,
    then (D-02, D-19) one per DERIVATIVE holding in ``holdings_rows_derivative``.
    Applies D-04 (breach + candidate-exists gate) + D-05 (max_weight + correlation_ceiling)
    + D-06 (FLAG_COMPOSITE_THRESHOLD=50 gate on top candidate composite score).

    Entry shape:
        {
            "holding_ref":              "holding:{venue}:{symbol}:{holding_type}",
            "value_usd":                float,
            "weight":                   float | None, # the AUM SHARE: value_usd / portfolio_aum,
                                                      # over the full matcher AUM (D-01, D-16),
                                                      # NOT the scoring weight; None (JSON null)
                                                      # when the AUM is not positive (SFH-01)
            "breach_reasons":           list[str],   # "max_weight" | "correlation_ceiling"
            "top_candidate_strategy_id": str | None,
            "top_candidate_composite":  float | None,
            "flagged":                  bool,        # True iff breach + candidate_composite >= 50
            "breach_skipped":           ["aum_not_positive"],  # ONLY present when the matcher
                                                      # AUM is not positive and the allocator set
                                                      # a max_weight: the max-weight test could
                                                      # not run (weight is null). Absent
                                                      # otherwise; never in ``breach_reasons``.
        }

    The weight persisted here is the AUM share, a different notion from the scoring weights
    ``match_engine`` blends the joined series with (``portfolio_weights``, which sum to 1
    over the joined series only). A non-positive ``portfolio_aum`` (derivative losses can
    exceed the spot value) never produces a weight: it is null, never 0.0 (SFH-01).

    A withheld spot holding (its price is not a market price, or its series is too thin to
    join the book's returns) gets the same shape plus ``withheld_reason``, one of
    ``account_balance`` | ``fixed_price`` | ``no_price`` | ``too_few_priced_days`` |
    ``too_few_adjacent_returns``. It stays in the AUM and the weights (D-01), so the
    max-weight test runs and a breach is recorded in ``breach_reasons``; but
    ``flagged`` is forced False (D-12), ``top_candidate_*`` are None (no candidate is
    picked for it) and no correlation test runs (it has no return series). The dashboard
    reader keeps only ``flagged`` entries with a candidate, so such an entry is not shown.

    A DERIVATIVE holding (D-02, D-09, D-19) is named with a different shape: it is in the AUM
    through its signed unrealized P&L only, never its notional, and it has no weight.
    ::

        {
            "holding_ref":              "holding:{venue}:{symbol}:derivative",
            "value_usd":                None,        # never the notional (D-15)
            "aum_contribution_usd":     float | None,# the P&L it added to the AUM (D-16);
                                                     # None (JSON null) when no counted row
                                                     # had a P&L, never 0.0 (D-18)
            "weight":                   None,        # a derivative has no weight (D-19)
            "breach_reasons":           [],          # no max-weight, no correlation test
            "top_candidate_strategy_id": None,
            "top_candidate_composite":  None,
            "flagged":                  False,
            "withheld_reason":          str,         # pnl_missing | option_premium | no_price
                                                     # | no_direction | too_few_priced_days
                                                     # | derivative_out_of_book
        }

    ``pnl_missing`` (D-18) outranks the price rule's reasons, which outrank
    ``derivative_out_of_book`` (D-09: a usable signed series still never joins the book's
    return signal). The row's ``aum_contribution_usd`` is copied as it is, never coerced.

    This is a synchronous plain `def` per finding f1.
    """
    from services.match_engine import _compute_corr_with_portfolio

    max_weight_pref = allocator_preferences.get("max_weight")
    corr_ceiling = allocator_preferences.get("correlation_ceiling")
    # The AUM share's denominator. None means "not positive" (the context returns None
    # for a non-positive matcher AUM): no share can be computed, so every spot entry gets
    # weight None and the max-weight test is skipped BY NAME, never as a silent 0.0.
    aum = float(portfolio_aum) if portfolio_aum and float(portfolio_aum) > 0 else None
    max_weight_skipped = max_weight_pref is not None and aum is None

    flags: list[dict[str, Any]] = []

    for row in holdings_rows_eligible:
        pseudo_id = f"holding:{row['venue']}:{row['symbol']}:{row['holding_type']}"

        # Defense-in-depth: skip any holding whose series isn't loaded
        # (warm-up already filtered upstream in _load_holding_portfolio_context)
        if pseudo_id not in portfolio_returns:
            continue

        value = _flag_value_usd(row)
        aum_share = value / aum if aum is not None else None
        breaches: list[str] = []

        # D-05 max_weight breach
        if max_weight_pref is not None and aum_share is not None and aum_share > float(max_weight_pref):
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

        entry: dict[str, Any] = {
            "holding_ref": pseudo_id,
            "value_usd": value,
            "weight": aum_share,
            "breach_reasons": breaches,
            "top_candidate_strategy_id": top_id,
            "top_candidate_composite": top_composite,
            "flagged": flagged,
        }
        if max_weight_skipped:
            entry["breach_skipped"] = ["aum_not_positive"]
        flags.append(entry)

    # 167.1.1.1 D-04, D-12: a withheld SPOT holding is named, with its max-weight breach
    # (D-01: it is in the AUM and the weights) and never flagged.
    for row in holdings_rows_withheld or []:
        value = _flag_value_usd(row)
        aum_share = value / aum if aum is not None else None
        withheld_breaches: list[str] = []
        if max_weight_pref is not None and aum_share is not None and aum_share > float(max_weight_pref):
            withheld_breaches.append("max_weight")
        withheld_entry: dict[str, Any] = {
            "holding_ref": f"holding:{row['venue']}:{row['symbol']}:{row['holding_type']}",
            "value_usd": value,
            "weight": aum_share,
            "breach_reasons": withheld_breaches,
            "top_candidate_strategy_id": None,
            "top_candidate_composite": None,
            "flagged": False,
            "withheld_reason": row["withheld_reason"],
        }
        if max_weight_skipped:
            withheld_entry["breach_skipped"] = ["aum_not_positive"]
        flags.append(withheld_entry)

    # 167.1.1.1 D-02, D-19: every derivative is named, with its P&L contribution to the AUM
    # (D-16) and the reason it is out of the book. No max-weight test (it has no weight:
    # value_usd and weight are None, never the notional, D-15), no correlation test, no
    # candidate, never flagged. ``aum_contribution_usd`` is copied as it is, so a derivative
    # with no P&L at all persists as JSON null and not as a 0.0 it never reported (D-18).
    for row in holdings_rows_derivative or []:
        flags.append({
            "holding_ref": f"holding:{row['venue']}:{row['symbol']}:{row['holding_type']}",
            "value_usd": None,
            "aum_contribution_usd": row["aum_contribution_usd"],
            "weight": None,
            "breach_reasons": [],
            "top_candidate_strategy_id": None,
            "top_candidate_composite": None,
            "flagged": False,
            "withheld_reason": row["withheld_reason"],
        })

    return flags


def book_join_marker(
    portfolio_returns: dict[str, pd.Series], *, allocator_id: str
) -> dict[str, Any] | None:
    """D-22 (WR-02). A book-level entry for ``match_batches.holding_flags`` when the shared-days
    join of the series actually passed to scoring (the ``.dropna()`` window) spans fewer than
    ``_BOOK_JOIN_MIN_DAYS`` days, else None.

    No holding is withheld to fit the overlap: every holding stays named in its own entry. The
    portfolio-fit axis and the correlation-ceiling tests do go null for such a book, and this
    marker is how that is named instead of silent. A WARNING with the allocator id and the
    count is logged as well.

    No series at all returns None: an empty book has no join to be too short (the engine
    scores it in cold-start mode and ``holding_flags`` is empty).

    Shape (distinguishable from a holding entry by ``kind`` and a null ``holding_ref``; the
    dashboard reader keeps only ``flagged`` entries with a candidate, so it ignores this one)::

        {
            "kind":                "book",
            "holding_ref":         None,
            "book_join_too_short": True,
            "shared_days":         int,   # days on which EVERY series carries a return
            "min_days":            30,    # the engine's min_overlap_days
            "flagged":             False,
        }
    """
    if not portfolio_returns:
        return None
    # The same guarantee as the scoring call: a mixed index would read as shared_days 0 and
    # persist a false cause. ``_score_one_allocator`` has already checked this book.
    assert_uniform_datetime_index({"book": portfolio_returns}, allocator_id=allocator_id)
    shared_days = len(pd.DataFrame(portfolio_returns).dropna())
    if shared_days >= _BOOK_JOIN_MIN_DAYS:
        return None
    logger.warning(
        "match: book_join_too_short: the %d series scored for allocator %s share %d day(s) "
        "(< %d), so the portfolio-fit axis and the correlation-ceiling tests cannot compute; "
        "no holding is withheld for it",
        len(portfolio_returns), allocator_id, shared_days, _BOOK_JOIN_MIN_DAYS,
    )
    return {
        "kind": "book",
        "holding_ref": None,
        "book_join_too_short": True,
        "shared_days": shared_days,
        "min_days": _BOOK_JOIN_MIN_DAYS,
        "flagged": False,
    }


def _engine_ticket_is_positive(ctx: dict[str, Any]) -> bool:
    """True when the engine's effective ``target_ticket_size_usd`` is positive.

    The engine reads the ticket after ``merge_with_defaults``: a missing or null ticket is the
    50,000 default there, so ask the same function rather than the raw preference. An explicit
    zero ticket sizes at the 0.10 default whatever the AUM, so no AUM substitution or AUM
    fallback changes anything for it."""
    ticket = merge_with_defaults(ctx.get("preferences")).get("target_ticket_size_usd")
    return not isinstance(ticket, bool) and isinstance(ticket, (int, float)) and ticket > 0


def add_weight_fallback_entry(
    ctx: dict[str, Any], result: Mapping[str, Any], *, allocator_id: str
) -> dict[str, Any] | None:
    """D-23, D-24, D-25. The book-level ``holding_flags`` entry naming the add-weight sizing the
    engine actually used when the AUM could not size it, else None. Decided AFTER
    ``score_candidates`` returns, from its own ``result["mode"]`` and ``result["candidates"]``,
    so the record never claims a sizing that did not happen.

    Nothing is recorded when the engine returned no candidate: no candidate was sized. Otherwise:

    - AUM <= 0 for a book of holdings (``ctx["aum_not_positive"]``), PERSONALIZED mode, positive
      effective ticket: ``aum_not_positive_ceiling_0_5`` (D-23, ``add_weight`` 0.5, the
      ``_AUM_NOT_POSITIVE_SCORING_AUM`` substitution made before the call).
    - AUM <= 0, SCREENING mode (no strategy and no priced spot holding, so the engine never
      reads the AUM): ``aum_not_positive_screening_default_0_10`` (D-25, ``add_weight`` 0.1,
      the sizing every screening book gets; the ticket plays no part in it).
    - AUM unknown (``ctx["portfolio_aum"]`` None and not ``aum_not_positive``), PERSONALIZED
      mode, positive effective ticket: ``aum_unknown_default_0_10`` (D-24, ``add_weight`` 0.1,
      the engine's cold-start default, unchanged). An unknown AUM in screening mode is a book
      with nothing to size against, so it records nothing.

    Same family as :func:`book_join_marker`: ``kind`` "book", a null ``holding_ref`` and
    ``flagged`` false, so the dashboard reader (which keeps only flagged entries that carry a
    candidate) ignores it. Shape::

        {
            "kind":                "book",
            "holding_ref":         None,
            "add_weight_fallback": "aum_not_positive_ceiling_0_5",
            "add_weight":          0.5,
            "flagged":             False,
        }
    """
    if not result["candidates"]:
        return None
    personalized = result["mode"] == "personalized"
    if ctx.get("aum_not_positive"):
        if not personalized:
            fallback, add_weight = _FALLBACK_AUM_NOT_POSITIVE_SCREENING, _ADD_WEIGHT_DEFAULT
            detail = (
                "has a non-positive matcher AUM but the engine ran in screening mode, so the "
                "candidate keeps the screening default add-weight of %s (D-25)"
            )
        elif _engine_ticket_is_positive(ctx):
            fallback, add_weight = _FALLBACK_AUM_NOT_POSITIVE_CEILING, _ADD_WEIGHT_CEILING
            detail = (
                "has a non-positive matcher AUM and a ticket, so the candidate is sized at the "
                "%s add-weight ceiling (D-23), not the engine's 0.10 default"
            )
        else:
            return None
    elif personalized and ctx.get("portfolio_aum") is None and _engine_ticket_is_positive(ctx):
        fallback, add_weight = _FALLBACK_AUM_UNKNOWN, _ADD_WEIGHT_DEFAULT
        detail = (
            "has no known matcher AUM (no allocated amount on any strategy), so the candidate "
            "keeps the engine's default add-weight of %s (D-24)"
        )
    else:
        return None
    logger.warning(
        "match: add_weight_fallback: %s: allocator %s " + detail,
        fallback, allocator_id, add_weight,
    )
    return {
        "kind": "book",
        "holding_ref": None,
        "add_weight_fallback": fallback,
        "add_weight": add_weight,
        "flagged": False,
    }


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
    *,
    precomputed_ctx: dict[str, Any] | None = None,
    precomputed_overrides: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Score a single allocator and persist the batch + candidates.

    NEW-C12-09: run_rescore_allocator_job loads the allocator context +
    feedback overrides in its pre-universe-scan preflight (to fail a poison
    mandate 'permanent' before the ~30k scan) and threads them in via
    precomputed_ctx/precomputed_overrides so the healthy rescore path neither
    re-loads the allocator-scoped rows nor double-emits compute_adjusted_weights'
    audit event + _persist_overrides write. The HTTP recompute() and
    cron_recompute() callers pass neither, so they self-load exactly as before
    (keyword-only with None defaults — purely additive, no shared-path change).
    """
    # Body-placed import keeps services.feedback_engine lazy — it should NOT
    # land in sys.modules at module load time, only when scoring runs.
    from services.feedback_engine import compute_adjusted_weights
    async with _scoring_semaphore:
        start = time.monotonic()

        if precomputed_ctx is not None:
            # Rescore preflight already loaded these (single-allocator, cheap).
            ctx = precomputed_ctx
            overrides = precomputed_overrides
        else:
            ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)

            overrides = await asyncio.to_thread(compute_adjusted_weights, allocator_id)
        # ctx["preferences"] can be None when the allocator has no
        # allocator_preferences row; normalize to {} before merging overrides.
        #
        # M-0602: coercing None → {} silently erases the legitimate signal
        # "this allocator has not configured a mandate". The engine then scores
        # with an all-default mandate and emits a batch indistinguishable from a
        # configured allocator's. Log a structured INFO event so ops can tell
        # "no mandate row" apart from "empty mandate" — important once an
        # allocator with 5+ bridge_outcomes silently starts receiving
        # feedback-tuned scores despite never opening the mandate UI.
        if ctx["preferences"] is None:
            logger.info(
                "match_engine: allocator %s scoring with DEFAULT mandate — no "
                "allocator_preferences row exists (distinct from an empty mandate)",
                allocator_id,
            )
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

        # D-23 (founder, 2026-10-07): the engine weights whatever series it is
        # given (the personalized portfolio series is a weighted sum of
        # `portfolio_returns`, and each candidate is scored beside it), so every
        # native-unit (BTC) series is converted to USD HERE, before the call.
        # `services/match_engine.py` stays a pure function of USD inputs. The
        # converter lives on the universe, so the BTC closes are read once per
        # universe (one cron run), and only when some series carries a unit; a
        # series that cannot be converted (no BTC price source) is left out,
        # exactly like a strategy with no returns_series, never weighted raw.
        _usd = universe.get("_usd_converter")
        if _usd is None:
            _usd = universe["_usd_converter"] = UsdSeriesConverter(get_btc_closes)
        portfolio_returns, _ = await _usd.convert(
            ctx["portfolio_returns"], ctx.get("native_units") or {}
        )
        candidate_returns, _ = await _usd.convert(
            candidate_returns, universe.get("native_units") or {}
        )

        # D-23: an AUM at or below zero must not read as "unknown AUM" (the engine's fixed 0.10
        # sizing). Hand it a positive AUM that clamps a ticket to the 0.5 ceiling instead.
        # The engine reads the AUM only in personalized mode, so the substitution is harmless in
        # screening mode; whether it was USED is decided from the result below.
        scoring_aum = ctx["portfolio_aum"]
        if ctx.get("aum_not_positive") and _engine_ticket_is_positive(ctx):
            scoring_aum = _AUM_NOT_POSITIVE_SCORING_AUM

        # CR-01 (round 2): every joined series must share ONE index type. A string-indexed
        # holding beside Timestamp-indexed candidates joins to zero days with no error, so
        # check the converted book and the converted candidates here, before anything joins
        # them (the D-22 marker and compute_holding_flags below read the same book).
        assert_uniform_datetime_index(
            {"book": portfolio_returns, "candidate": candidate_returns},
            allocator_id=allocator_id,
        )

        # score_candidates runs pandas/numpy heavy work (DataFrame builds,
        # correlation calcs, min-max normalization across the candidate
        # universe). Off-load so we don't block the event loop per allocator.
        result = await asyncio.to_thread(
            score_candidates,
            allocator_id=allocator_id,
            preferences=ctx["preferences"],
            portfolio_strategies=ctx["portfolio_strategies"],
            portfolio_returns=portfolio_returns,
            portfolio_weights=ctx["portfolio_weights"],
            candidate_strategies=candidate_strategies,
            candidate_returns=candidate_returns,
            thumbs_down_ids=ctx["thumbs_down_ids"],
            portfolio_aum=scoring_aum,
        )

        latency_ms = int((time.monotonic() - start) * 1000)

        # D-23, D-24, D-25: name the add-weight sizing only from what the engine actually did.
        add_weight_fallback = add_weight_fallback_entry(ctx, result, allocator_id=allocator_id)

        # Per-holding flag rows persisted into match_batches.holding_flags
        # for SSR consumption. Every holding slot receives the same ranked
        # candidate list; compute_holding_flags applies the top-real-UUID +
        # FLAG_COMPOSITE_THRESHOLD filter per slot.
        holdings_eligible = ctx.get("_holdings_rows_eligible") or []
        scored_by_slot: dict[str, list[Any]] = {}
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
            holdings_rows_withheld=ctx.get("_holdings_rows_withheld") or [],
            holdings_rows_derivative=ctx.get("_holdings_rows_derivative") or [],
            portfolio_returns=portfolio_returns,  # D-23: the converted book
            portfolio_weights=ctx["portfolio_weights"],
            portfolio_aum=ctx["portfolio_aum"],
            allocator_preferences=ctx["preferences"] or {},
            scored_candidates_by_slot=scored_by_slot,
        )
        # D-22: name a book whose shared-days join is too short (no holding is withheld for it).
        book_marker = book_join_marker(portfolio_returns, allocator_id=allocator_id)
        if book_marker is not None:
            holding_flags_list.append(book_marker)
        if add_weight_fallback is not None:
            holding_flags_list.append(add_weight_fallback)

        # Persist: one match_batches row, N match_candidates rows.
        supabase = get_supabase()

        batch_row: dict[str, Any] = {
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
            _batch_rows = rows(_batch_insert)
            if not _batch_rows:
                raise RuntimeError(f"Failed to insert match_batches for {allocator_id}")
            _batch_id = str(_batch_rows[0]["id"])

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
            _rows_to_insert: list[dict[str, Any]] = []
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

            # A3-10: when _rows_to_insert is empty (all candidates/excluded
            # filtered out) but the batch header claims non-zero counts,
            # log a warning. This happens when every excluded strategy is
            # 'explicitly_excluded' (stripped at the persistence boundary
            # pending the SQL CHECK migration). The batch header row has
            # candidate_count=0/excluded_count>0 while match_candidates has
            # zero rows — a discrepancy visible only by direct DB query.
            if not _rows_to_insert:
                if batch_row.get("candidate_count", 0) > 0 or batch_row.get("excluded_count", 0) > 0:
                    logger.warning(
                        "match_engine: batch %s for allocator %s has no rows to insert "
                        "(candidate_count=%d excluded_count=%d) — all excluded rows "
                        "may be explicitly_excluded (pending CHECK migration)",
                        _batch_id, allocator_id,
                        batch_row.get("candidate_count", 0),
                        batch_row.get("excluded_count", 0),
                    )

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
                        # A3-01: inspect the rollback DELETE result so an
                        # RLS/race no-op (data=[]) is distinguishable from a
                        # successful cleanup. Pre-fix the result was discarded —
                        # the orphan row could survive and the audit trail would
                        # only show "rolling back" without confirming success.
                        #
                        # H-PR5-05 (audit-2026-05-07): pin the rollback DELETE
                        # to the same allocator_id under which the batch was
                        # being persisted. Service-role bypasses RLS, so a
                        # poorly-typed _batch_id (None, future supabase-py
                        # shape change) could in principle widen the DELETE.
                        # The extra .eq("allocator_id", allocator_id) makes a
                        # "delete-everything" regression impossible to escape
                        # the tenant — defense-in-depth even when the .eq("id")
                        # filter is the load-bearing one in practice today.
                        _del_result = await asyncio.to_thread(
                            lambda: supabase.table("match_batches")
                            .delete()
                            .eq("id", _batch_id)
                            .eq("allocator_id", allocator_id)
                            .execute()
                        )
                        if not (_del_result.data):
                            logger.error(
                                "match_engine: rollback DELETE for orphan batch %s "
                                "returned no rows (RLS/race? orphan row may persist "
                                "in match_batches)",
                                _batch_id,
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

        # I-01 / A3-07: hold an explicit strong reference to the inner task so
        # a SIGTERM-triggered loop.stop() cannot GC it before it completes.
        # asyncio.shield() prevents the inner task from receiving CancelledError,
        # but does NOT prevent the event loop from draining it during shutdown
        # unless a strong reference is held outside the shield expression itself.
        # Pattern: create the inner task explicitly, then shield + re-await on
        # cancel so the outer task waits for the inner to finish before unwinding.
        #
        # A3-07: also catch RuntimeError from the inner persist (e.g. rollback
        # path after failed match_candidates insert). If a CancelledError and a
        # RuntimeError arrive concurrently, the RuntimeError may be suppressed by
        # the outer cancellation machinery. Logging it here before re-raise ensures
        # Sentry captures the root cause even when the outer exception masks it.
        _persist_task = asyncio.ensure_future(_persist_batch_and_candidates())
        try:
            batch_id = await asyncio.shield(_persist_task)
        except asyncio.CancelledError:
            # Re-await the inner task so shutdown waits for the DB writes to
            # complete before the process exits. The CancelledError is re-raised
            # after the inner task finishes (I-01 fix).
            #
            # H-1 (red-team): if _persist_task itself raises RuntimeError (e.g.,
            # rollback after a failed match_candidates insert), that RuntimeError
            # would propagate out of this except block, making the `raise` below
            # unreachable. The caller would see RuntimeError instead of
            # CancelledError, corrupting the ASGI graceful-shutdown chain. Wrap
            # the re-await so RuntimeError is logged + swallowed here; the
            # CancelledError is still re-raised so uvicorn sees the correct
            # shutdown signal.
            try:
                await _persist_task
            except RuntimeError as _inner_err:
                logger.error(
                    "match_engine: batch persistence failed during shutdown for "
                    "allocator %s: %s — CancelledError still propagated",
                    allocator_id, _inner_err,
                )
            raise
        except RuntimeError as _persist_err:
            # A3-07: inner RuntimeError (persist/rollback failure) may be
            # suppressed when CancelledError is also pending. Log explicitly so
            # Sentry captures the root cause regardless of outer cancellation.
            logger.error(
                "match_engine: batch persistence failed for allocator %s: %s",
                allocator_id, _persist_err,
            )
            raise

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
    # QUANTALYZE-2F (Phase 166.5.1, D-02a): this latest-batch read retries a transient
    # ReadTimeout; the second read below stays: Sentry did not name it.
    result = await db_read_with_retry(
        lambda: supabase.table("match_batches")
        .select("computed_at, engine_version")
        .eq("allocator_id", allocator_id)
        .order("computed_at", desc=True)
        .limit(1)
        .execute()
    )
    batch_rows = rows(result)
    if not batch_rows:
        return False
    last_row = batch_rows[0]
    # Trigger 2: engine_version mismatch — invalidate v1 batches for the
    # v1→v2 cutover and any future bump. Short-circuits BEFORE the age
    # check so a fresh v1 batch is still recomputed.
    if last_row.get("engine_version") != ENGINE_VERSION:
        return False
    try:
        last_at = _parse_supabase_ts(last_row["computed_at"])
    except (ValueError, AttributeError) as exc:
        # M-0607: a malformed/NULL computed_at used to silently return False
        # (don't skip) with NO log — every cron tick would then re-score this
        # allocator forever, burning CPU/DB while "stale" data masqueraded as
        # "fresh", with zero signal for an operator. Fail loud: log a WARNING
        # with the bad value + allocator_id and force a recompute (returning
        # False is the safe choice — we'd rather over-recompute a corrupted
        # row than thrash silently or skip a genuinely-stale batch).
        logger.warning(
            "match_engine: bad computed_at %r for allocator %s last batch "
            "— forcing recompute: %s",
            last_row.get("computed_at"), allocator_id, exc,
        )
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
    prefs = one(prefs_result) or {}
    edited_raw = prefs.get("mandate_edited_at")
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

# Max batch-ids the retention SELECT will pull per allocator per run. The
# sweep keeps the newest `keep` and deletes the rest; a single cron run only
# ever adds ONE batch per allocator, so under steady state there is at most
# one row to delete. This page bounds the SELECT so a backlog (e.g. retention
# was disabled for a long window) is drained in bounded chunks across runs
# rather than pulling unbounded history into Python in one call.
_RETENTION_SELECT_PAGE_SIZE = 200

def _retention_sweep(allocator_id: str, keep: int = 7) -> int:
    """Delete old batches for this allocator, keeping the newest `keep`.
    CASCADE drops match_candidates for the deleted batches.

    Returns the number of batches deleted.

    F2 (red-team MED8): the prior implementation selected one page of deletable
    rows via `.range(keep, keep + PAGE - 1)` over `computed_at DESC` and deleted
    only that page per sweep. Under concurrent front-inserts (a new batch landing
    between the SELECT and a subsequent run) the DESC offset shifts, so tail rows
    could be skipped indefinitely and a backlog larger than one page would never
    fully drain. Root-cause fix: drain the FULL backlog within a single sweep —
    (1) pin the protected set (newest `keep` ids) ONCE, then (2) page the OLDEST
    rows ascending, deleting any id not in the protected set, until a page returns
    fewer than PAGE rows. Ascending order + the explicit protected-id filter make
    the drain immune to front-inserts (new rows enter the newest end, never the
    oldest page) and guarantee the newest `keep` are never touched and no row is
    deleted twice.
    """
    supabase = get_supabase()

    # --- Step 1: pin the protected set (newest `keep` ids) ONCE. ---
    # These rows must never be deleted regardless of any concurrent inserts.
    protected_result = (
        supabase.table("match_batches")
        .select("id")
        .eq("allocator_id", allocator_id)
        .order("computed_at", desc=True)
        .range(0, keep - 1)
        .execute()
    )
    protected_ids = {row["id"] for row in rows(protected_result)}
    # Fewer than `keep` total rows → nothing older to sweep.
    if len(protected_ids) < keep:
        return 0

    # --- Step 2: drain the oldest rows ascending until exhausted. ---
    # Always read the oldest PAGE rows (ASC). After each DELETE those rows are
    # gone, so the next ASC page exposes the next-oldest survivors — front
    # inserts only ever push rows onto the newest (DESC) end, so they can never
    # appear in (or shift) the oldest page. Bound the iteration count defensively
    # so a pathological no-op DELETE (RLS regression that returns data=[] without
    # actually deleting) cannot spin forever; the per-page < PAGE terminator is
    # the normal exit.
    deleted = 0
    max_pages = 10_000  # hard ceiling; real backlogs are orders of magnitude smaller
    for _ in range(max_pages):
        page_result = (
            supabase.table("match_batches")
            .select("id")
            .eq("allocator_id", allocator_id)
            .order("computed_at", desc=False)
            .range(0, _RETENTION_SELECT_PAGE_SIZE - 1)
            .execute()
        )
        page_rows = rows(page_result)
        if not page_rows:
            break
        # Exclude the pinned newest `keep` so they are never deleted even when
        # the total count has shrunk to <= keep mid-drain.
        ids_to_delete = [row["id"] for row in page_rows if row["id"] not in protected_ids]
        page_was_full = len(page_rows) >= _RETENTION_SELECT_PAGE_SIZE

        if not ids_to_delete:
            # Every row on the oldest page is protected — nothing left to drain.
            break

        page_deleted = 0
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
            page_deleted += actual_deleted

        deleted += page_deleted

        # Termination: the page was not full (no more older rows to fetch), or a
        # no-op DELETE made no progress (guard against an RLS-regression spin).
        if not page_was_full or page_deleted == 0:
            break

    return deleted


# ---------------------------------------------------------------------------
# Helpers (continued)
# ---------------------------------------------------------------------------


def _is_admin_profile(user_id: str) -> bool | None:
    """C-PR5-01 (audit-2026-05-07): return True iff the user has admin role.

    Two signal sources — ``profiles.is_admin = TRUE`` (legacy) and
    ``user_app_roles.role = 'admin'`` (canonical). Either source proves
    admin; mirroring the Next.js ``isAdminUser`` boolean OR keeps the two
    layers in agreement. Returns None on transient DB error so the
    caller can 503 instead of returning a misleading 403.

    Synchronous — call via ``asyncio.to_thread``.
    """
    sb = get_supabase()
    try:
        profile = (
            sb.table("profiles")
            .select("is_admin")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        profile_row = one(profile)
        if profile_row and profile_row.get("is_admin"):
            return True
        roles = (
            sb.table("user_app_roles")
            .select("role")
            .eq("user_id", user_id)
            .eq("role", "admin")
            .limit(1)
            .execute()
        )
        return bool(roles.data)
    except Exception as exc:
        logger.error(
            "match_engine: admin role check failed for user %s: %s "
            "— returning None (transient; caller will 503)",
            user_id, exc,
        )
        return None


def _is_allocator_profile(allocator_id: str) -> bool | None:
    """NEW-C08-10: return True iff the profile exists and has role 'allocator' or 'both'.

    Synchronous (called via asyncio.to_thread). Module-level so tests can
    monkeypatch it without patching get_supabase (which requires live env vars).

    Return values:
      True  — confirmed allocator/both role
      False — confirmed non-allocator (profile found but wrong role, or no row)
      None  — transient error (DB blip); caller must raise 503, not 422

    A3-06 / I-03: wraps the Supabase query in try/except so a transient DB
    blip does not surface as a context-free 500 from the recompute endpoint.
    M-2 (red-team): distinguishes transient error (None) from confirmed
    non-allocator (False) so the caller can return 503 on a DB blip instead of
    422, which incorrectly tells a real allocator they are "not an allocator".
    Log includes allocator_id for Sentry triage.
    """
    sb = get_supabase()
    try:
        profile = (
            sb.table("profiles")
            .select("role")
            .eq("id", allocator_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        logger.error(
            "match_engine: profile role check failed for allocator %s: %s "
            "— returning None (transient; caller will 503)",
            allocator_id, exc,
        )
        return None  # sentinel: transient error, not confirmed non-allocator
    profile_row = one(profile)
    if not profile_row:
        return False
    return profile_row.get("role") in ("allocator", "both")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/recompute")
@limiter.limit(
    # RATE-03 / TS-21 (146-02, D-146-2): defense-in-depth floor for a leaked
    # X-Service-Key looping Railway directly. 30/min per tenant sits ABOVE the
    # max legitimate Vercel-forwarded rate (20/min per admin via
    # adminActionLimiter on both siblings post-146-01) and brutally below an
    # unauthenticated-loop abuse rate. Storage is memory:// per replica
    # (ASSUMPTION-3): an order-of-magnitude floor, not a quota.
    "30/minute", key_func=partial(tenant_or_platform_key, scope="match_recompute")
)
async def recompute(request: Request, req: RecomputeRequest) -> dict[str, Any]:
    """Single-allocator recompute. Called from the Next.js admin /api/admin/match/recompute."""
    # Stringify the UUID once for Supabase / downstream sync helpers.
    allocator_id = str(req.allocator_id)

    # C-PR5-01 (audit-2026-05-07): actor binding. When the caller forwards
    # an ``actor_id``, assert it can legitimately act on this allocator —
    # either the actor IS the allocator (allocator running their own
    # recompute) or the actor is an admin. Pre-fix the endpoint trusted
    # any SERVICE_KEY-bearing caller, so any future Next.js route that
    # forwarded user-supplied allocator_id without an admin gate became a
    # cross-tenant batch-forgery vector (the audit's CRITICAL finding).
    # Backward compat: if actor_id is None, log a deprecation warning so
    # the rollout is observable; the legacy Next.js admin gate still
    # protects production today.
    if req.actor_id is None:
        logger.warning(
            "match_engine recompute: actor_id missing — falling back to "
            "service-key-only gate. Caller must forward x-actor-id in a "
            "future release (C-PR5-01). allocator_id=%s",
            allocator_id,
        )
    else:
        actor_id = str(req.actor_id)
        if actor_id != allocator_id:
            _is_admin = await asyncio.to_thread(_is_admin_profile, actor_id)
            if _is_admin is None:
                # PYAPI-05 S-13: SERVICE-TRANSIENT. Supabase is genuinely
                # unavailable, so this one IS ours — but it is keyed on
                # `supabase`, not on the service as a whole (O-2).
                raise service_error(
                    503,
                    "ADMIN_CHECK_UNAVAILABLE",
                    dependency="supabase",
                    retryable=True,
                    retry_after=RETRY_AFTER_SECONDS["supabase"],
                    detail="actor admin check temporarily unavailable — please retry",
                )
            if not _is_admin:
                logger.warning(
                    "match_engine recompute: rejected cross-tenant write — "
                    "actor_id=%s targeted allocator_id=%s without admin role",
                    actor_id, allocator_id,
                )
                raise HTTPException(
                    status_code=403,
                    detail="actor does not own this allocator and is not an admin",
                )

    # NEW-C08-10: validate that allocator_id is actually an allocator (or both).
    # Pre-fix any UUID (strategy-manager, admin, deleted profile) manufactured
    # match_batches rows — polluting the founder queue and hit-rate eval.
    # Mirrors cron_recompute's role IN ('allocator','both') filter.
    #
    # M-2 (red-team): _is_allocator_profile returns None on transient DB error.
    # Raise 503 (not 422) in that case — 422 semantically means the input is
    # invalid, which is incorrect and misleading during a DB blip. A real
    # allocator must not see "you are not an allocator" during a Supabase outage.
    #
    # PYAPI-05 S-14 extends that reasoning rather than replacing it: the 503 now
    # also says WHICH dependency is down (`supabase`) and how long to wait, so
    # 140.2 keys its breaker on Supabase alone instead of on the whole service.
    _role_check = await asyncio.to_thread(_is_allocator_profile, allocator_id)
    if _role_check is None:
        raise service_error(
            503,
            "ROLE_CHECK_UNAVAILABLE",
            dependency="supabase",
            retryable=True,
            retry_after=RETRY_AFTER_SECONDS["supabase"],
            detail="profile role check temporarily unavailable — please retry",
        )
    if not _role_check:
        raise HTTPException(
            status_code=422,
            detail=f"allocator_id {allocator_id} is not an allocator profile",
        )

    _kill_switch_state = await _engine_is_enabled()
    if _kill_switch_state == KILL_SWITCH_UNAVAILABLE:
        raise service_error(
            503,
            "KILL_SWITCH_UNAVAILABLE",
            dependency="supabase",
            retryable=True,
            retry_after=RETRY_AFTER_SECONDS["supabase"],
            detail="kill switch check temporarily unavailable — please retry",
        )
    if _kill_switch_state == KILL_SWITCH_DISABLED:
        logger.info("match_engine recompute: kill switch off, skipping allocator=%s", allocator_id)
        return {"status": "disabled", "disabled": True}

    # NEW-C08-06: floor force=True to a per-allocator 30-second minimum interval.
    # force=True bypasses the 12h age guard (see _should_skip_allocator); without
    # this gate a looped caller past the Next.js rate limiter can stack concurrent
    # scoring + retention churn. The interval is process-local — a pod restart
    # resets it, which is acceptable (the guard is a budget, not a hard lock).
    #
    # I-02 / A3-02: stamp _force_last_run AFTER scoring succeeds, not before.
    # Pre-fix: the timestamp was written before calling _score_one_allocator.
    # If scoring raised a 500, the 30-second window was consumed by a failed
    # recompute — a retry by the operator received 429 ("throttled") even though
    # no batch was ever persisted. Post-fix: the 429 check still fires at entry
    # (correct — guards against rapid duplicate requests), but the slot is only
    # consumed on a successful result.
    #
    # M-1 (red-team): per-allocator asyncio.Lock makes the read-then-stamp
    # sequence atomic. Without the lock, N concurrent force=True requests on pod
    # startup all read 0.0, pass the gate simultaneously, and queue on the
    # scoring semaphore — exactly the churn the throttle was designed to prevent.
    # Lock is created on first use (lazy initialisation keeps the module-level
    # dict lean). Idle locks for stale allocators are pruned by
    # _prune_stale_force_entries below — but never a *held* lock.
    if req.force:
        # MA1: prune stale throttle state BEFORE touching this allocator's
        # entries so the dicts stay bounded by recently-active allocators.
        # Runs before creating/acquiring THIS allocator's lock; the prune
        # never drops a held lock or a still-throttling (recent) stamp, so
        # it cannot race with this request's own check-then-stamp below.
        _prune_stale_force_entries()
        if allocator_id not in _force_lock:
            _force_lock[allocator_id] = asyncio.Lock()
        async with _force_lock[allocator_id]:
            _now = time.monotonic()
            _last = _force_last_run.get(allocator_id, 0.0)
            if _now - _last < FORCE_RECOMPUTE_MIN_INTERVAL_S:
                # TS-23 (146-02, D-146-3): migrated onto the nested
                # service_error envelope — internal.py's worked example, the ONE
                # winning 429 raise-site shape. `wait_s` stays derived from the
                # same interval the guard checks (never RETRY_AFTER_SECONDS,
                # never a fresh literal — PYAPIFIX2-04 preserved). NOW clamped
                # to >= 1: the contract's _validate requires a positive
                # Retry-After, and the body interpolates the SAME clamped value
                # so header and copy still agree (the old unclamped
                # "Retry-After: 0" arm is traded away for the one-shape
                # contract).
                wait_s = max(1, int(FORCE_RECOMPUTE_MIN_INTERVAL_S - (_now - _last)))
                raise service_error(
                    429,
                    "RATE_LIMITED",
                    retryable=True,
                    retry_after=wait_s,
                    detail=(
                        f"force recompute for {allocator_id} throttled: "
                        f"retry after {wait_s}s (min interval {FORCE_RECOMPUTE_MIN_INTERVAL_S}s)"
                    ),
                )
            # Stamp optimistically inside the lock so concurrent requests that
            # arrive while scoring is in-flight also see the window. On scoring
            # failure the stamp is cleared (below) so the operator can retry.
            _force_last_run[allocator_id] = time.monotonic()

    # NEW-C08-06: serialize the skip-check → score → insert sequence per
    # allocator (shared with cron_recompute) so a non-forced POST cannot race
    # cron — or another POST — into a duplicate match_batches row. The second
    # holder's _should_skip_allocator runs AFTER the first commits, sees the
    # fresh batch, and skips. Acquired after _force_lock is released above.
    async with _get_recompute_lock(allocator_id):
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
            # PYAPI-05 S-15: SERVICE-PERMANENT. The exception text stays
            # SERVER-SIDE — the old f-string interpolation of `err` into the
            # detail shipped whatever a pandas/Supabase exception happened to
            # carry (table names, row payloads, connection strings)
            # straight to the caller. The
            # operator loses nothing: the message + traceback are logged here
            # under a correlation_id that the response body also carries, so a
            # user report joins to the log line without the leak.
            correlation_id = str(uuid4())
            logger.error(
                "match_engine recompute failed for %s (correlation_id=%s): %s",
                allocator_id, correlation_id, err,
                exc_info=True,
            )
            # M-1 (red-team): clear the optimistic stamp so the operator can retry
            # immediately after a scoring failure. The stamp was written inside the
            # lock before scoring; clearing it here releases the throttle window.
            if req.force:
                _force_last_run.pop(allocator_id, None)
            raise service_error(
                500,
                "SCORING_FAILED",
                retryable=False,
                detail="Scoring failed on our side. This has been logged.",
                correlation_id=correlation_id,
            ) from err

    # Retention sweep (keep last 7). A sweep failure must not 500 the
    # request after the batch was successfully persisted — log and continue.
    # I-04: The sweep must run even when _score_one_allocator completes via
    # the shielded persist path and then the outer task is cancelled. Pre-fix:
    # if CancelledError propagated out of _score_one_allocator after shielding,
    # it bypassed the outer try/except (CancelledError is BaseException, not
    # Exception) and this sweep was silently skipped — old batches could
    # accumulate past keep=7 on Railway redeploys during high traffic.
    # The cron's per-allocator retention at the end of cron_recompute provides
    # backstop coverage, but single-allocator POST /recompute skips that path.
    # Documented gap: the try/except Exception below still won't catch
    # CancelledError. A full fix would require try/finally in the outer handler,
    # which would need to shield the sweep itself — a larger refactor deferred
    # as a known limitation. This comment replaces the pre-fix silence.
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
@limiter.limit(
    # RATE-03 / TS-21 (146-02, D-146-2): same defense-in-depth floor as
    # /recompute above — 30/min per tenant, sized above the 20/min legitimate
    # Vercel-forwarded ceiling; per-replica memory:// storage.
    "30/minute", key_func=partial(tenant_or_platform_key, scope="match_eval")
)
async def eval_metrics(
    request: Request,
    # M-0608: enforce the 1..365 bound at the type layer via Query(ge=, le=)
    # rather than an imperative `if lookback_days < 1 ...: raise` in the body.
    # FastAPI emits an automatic 422 with structured loc/type detail (which the
    # old hand-rolled 400 lacked), the constraint shows up in the OpenAPI schema
    # downstream tooling consumes, and the branch can't be dropped in a refactor.
    lookback_days: Annotated[int, Query(ge=1, le=365)] = 28,
    partner_tag: str | None = None,
) -> dict[str, Any]:
    """Compute hit-rate metrics for the /admin/match/eval dashboard.

    Optional `partner_tag` query param scopes the metrics to allocators tagged
    into a partner pilot (see migration 016 + /admin/partner-import).
    """
    try:
        return await asyncio.to_thread(
            compute_hit_rate_metrics, lookback_days, partner_tag
        )
    except PaginatedSelectTruncated as err:
        # paginated_select hit its hard cap — without this we'd silently
        # aggregate over a partial window.
        #
        # PYAPI-05 S-16: this is a CALLER fault, not an outage. The service is
        # healthy; the caller's `lookback_days` window contains more rows than
        # the paginator will drain. The old 503 both lied about our uptime and
        # (under 140.2) fed the breaker, so an admin hammering lookback_days=365
        # could trip a platform-wide outage. 400 is truthful and breaker-inert,
        # and the copy says what to DO. `hint` is operator-curated and
        # explicitly non-PII (see services/db.py:PaginatedSelectTruncated).
        logger.exception("match_engine eval truncated at hard cap: %s", err)
        raise service_error(
            400,
            "EVAL_WINDOW_TOO_LARGE",
            retryable=False,
            detail=(
                f"Eval truncated at {err.page_count} pages × {err.page_size} rows"
                + (f" (hint: {err.hint})" if err.hint else "")
                + " — narrow lookback_days (or scope with partner_tag) and retry."
            ),
        ) from err
    except Exception as err:
        # PYAPI-05 S-17: SERVICE-PERMANENT, and the same leak discipline as
        # S-15 — the exception text is logged, never interpolated into the body.
        correlation_id = str(uuid4())
        logger.error(
            "match_engine eval failed (correlation_id=%s): %s",
            correlation_id, err,
            exc_info=True,
        )
        raise service_error(
            500,
            "EVAL_FAILED",
            retryable=False,
            detail="Eval failed on our side. This has been logged.",
            correlation_id=correlation_id,
        ) from err


# ---------------------------------------------------------------------------
# Cron batching cursor (Phase 164.5.1 criterion 9 /
# [164.5.1-GATEWAY-CEILING-INVERSION]) — persisted in public.system_settings
# so a slice survives across separately-scheduled pg_cron ticks.
# CRON_BATCH_BUDGET_S (25s) is set below the 60s API gateway ceiling (see
# [164.5.1-GATEWAY-CEILING-INVERSION] in TODOS.md for the measured numbers).
# ⚠️ It is a BEST-EFFORT BOUNDARY CHECKED BETWEEN ALLOCATORS, not a cap on
# the request. The comment here claimed "three bounds keep one request
# inside the gateway window" until 2026-09-16; that was never what the code
# did and the test that "pinned" it compared two constants. The real wall
# time of one request is
#   cursor read + page fetch + universe load
#     + Σ(allocators handled) + THE FULL DURATION OF THE ALLOCATOR THAT
#       CROSSED THE BUDGET,
# and `_score_one_allocator` is pandas/numpy work whose own documented SLA
# is p95 < 30s. One slow allocator therefore takes the request past 60s no
# matter what this constant says. What the budget DOES buy is that the
# NEXT allocator is never started once the clock is spent, so the overshoot
# is bounded by one allocator rather than by the size of the platform.
# The budget clock starts AFTER the universe load (see _budget_elapsed in
# cron_recompute): measuring the shared O(strategies) scan against a
# PER-SLICE budget spent the whole allowance before allocator #1 on a large
# universe, which made every tick a one-allocator tick.
# ⛔ A `service_role` statement_timeout is deliberately NOT part of this
# nesting. Plan 03 planned one and this comment named its value; the
# migration was WITHDRAWN at the plan-09 D4 gate 2026-09-16 — a
# per-STATEMENT timeout cannot bound a per-REQUEST 504 for a request that
# issues many short statements, and `service_role` has no row in
# pg_db_role_setting, so its real inherited ceiling is authenticator's 8s
# (measured read-only on PROD), not the 120s the phase had assumed.
# ---------------------------------------------------------------------------
MATCH_ENGINE_CURSOR_KEY = "match_engine_cron_cursor"
# ⛔ A SECOND key, and the reason is a defect this phase shipped and then caught.
# WR-12's pass-duration observable originally read the CURSOR row's
# `updated_at`, calling it "the moment the previous pass ended". That is false
# for every multi-tick pass: `_write_cron_cursor` stamps `updated_at` on EVERY
# call, including at each partial batch boundary, so at wrap time the column
# held the PREVIOUS TICK's timestamp. `now() - updated_at` was therefore ~one
# tick interval, never the pass duration — the WARNING could not fire in the
# batched regime, and the else-branch printed a REASSURING but false all-clear
# ("full pass completed in 1.0h") for a pass that had really taken 50h. Found
# independently by both round-2 reviewers, confidence 90.
# ⛔ The obvious fix — stop stamping `updated_at` on the partial path — is
# WRONG and would break a sibling instrument: `docs/runbooks/match-engine.md`'s
# batching alarm REQUIRES that column to move every tick ("Expected: updated_at
# within one tick interval"). One column cannot mean both "last touched" and
# "last wrapped". So the pass start gets its own key, written ONCE per pass.
MATCH_ENGINE_PASS_START_KEY = "match_engine_cron_pass_started_at"


def _bounded_env(name: str, default: float, low: float, high: float) -> float:
    """Parse a numeric env knob, clamped to [low, high], defaulting loudly.

    Both knobs are operator-set. A bare `int(os.getenv(...))` raised
    ValueError at MODULE IMPORT on a typo, i.e. the whole FastAPI app failed
    to start with a traceback naming `int()` rather than the variable —
    the operator learns nothing and the service is down. Log the offending
    variable and fall back instead: a knob at its default is a degraded
    tuning decision, a dead service is an outage.

    The clamp is the other half. CRON_BATCH_SIZE carried a `max(1, ...)`
    floor and CRON_BATCH_BUDGET_S carried none, so
    `MATCH_ENGINE_CRON_BUDGET_S=0` tripped the batch bound after every
    single allocator (one allocator per tick, forever), and a value above
    the gateway ceiling defeated the constant's entire purpose.
    """
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        value = default
    else:
        try:
            value = float(raw)
        except ValueError:
            logger.error(
                "match_engine cron: %s=%r is not a number — falling back to "
                "the default %s rather than failing the service at import",
                name, raw, default,
            )
            value = default
    clamped = min(high, max(low, value))
    if clamped != value:
        logger.warning(
            "match_engine cron: %s=%s is outside [%s, %s] — clamped to %s",
            name, value, low, high, clamped,
        )
    return clamped


CRON_BATCH_SIZE = int(_bounded_env("MATCH_ENGINE_CRON_BATCH_SIZE", 10.0, 1.0, 1000.0))
# Upper clamp at 55s: strictly below the 60s gateway ceiling, so a knob set
# to "120" cannot silently disable the boundary it exists to enforce.
CRON_BATCH_BUDGET_S = _bounded_env("MATCH_ENGINE_CRON_BUDGET_S", 25.0, 1.0, 55.0)

# Canonical lowercase-or-uppercase-hex UUID shape (Postgres uuid columns
# normalize to lowercase on read, but a hand-edited system_settings row is
# not guaranteed to). Anything else is treated as corrupt.
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


async def _read_cron_cursor() -> str | None:
    """Read the persisted cron batching cursor from public.system_settings.

    This is the FIRST Python read/write path against public.system_settings
    in this service (measured 2026-09-16, zero non-test hits) — it follows
    db_execute's/db_read_with_retry's general shape because there is no
    table-specific pattern to follow, it does not "consume" an existing
    system_settings convention. The cursor is ENGINE-INTERNAL BOOKKEEPING
    that the table's grants do NOT distinguish from operator-editable
    configuration — see _write_cron_cursor's docstring for what an app-admin
    who PATCHes this row can actually do, and for what bounds it.

    Returns None for an absent row, for the empty-string wrap marker (an
    exhausted cursor means the same "start from the beginning" thing to the
    caller as no cursor at all), and for a value that is not a canonical
    UUID (logged at ERROR — a corrupt cursor restarts the pass loudly rather
    than poisoning the keyset filter). A read that exhausts
    db_read_with_retry's retries is NOT swallowed here — it propagates so
    the caller decides, matching every other db_read_with_retry consumer; a
    failed read must never be indistinguishable from "start over".
    """
    supabase = get_supabase()

    def _read() -> Any:
        return (
            supabase.table("system_settings")
            .select("value")
            .eq("key", MATCH_ENGINE_CURSOR_KEY)
            .maybe_single()
            .execute()
        )

    result = await db_read_with_retry(_read)
    row = one(result)
    if not row:
        return None
    value = row.get("value") or ""
    if value == "":
        return None
    if not _UUID_RE.match(value):
        logger.error(
            "match_engine cron: cursor value for %s is not a canonical "
            "UUID (%r) — restarting the pass from the beginning",
            MATCH_ENGINE_CURSOR_KEY, value,
        )
        return None
    return value


async def _write_cron_cursor(value: str | None) -> None:
    """Upsert the cron batching cursor into public.system_settings.

    This is the FIRST Python read/write path against public.system_settings
    in this service (measured 2026-09-16, zero non-test hits) — it follows
    db_execute's general shape because there is no table-specific pattern to
    follow, it does not "consume" an existing system_settings convention.

    ⚠️ The cursor is ENGINE-INTERNAL BOOKKEEPING and the table's grants do
    NOT distinguish it from operator-editable configuration.
    `system_settings_admin_all FOR ALL TO authenticated` (migration
    20260907120000) is gated only on `profiles.is_admin = true`, and the
    table's single CHECK constraint is scoped to `key =
    'analytics_service_url'` — so ANY app-admin can PATCH this row through
    PostgREST. This docstring said an admin edit "restarts a pass and
    nothing worse" until 2026-09-16; that was wrong in the direction that
    HIDES harm. The real residual: an admin who can write this row can
    STARVE the pass (while a high-valued UUID stands, every allocator
    ordered below it is never reached) or STALL it by rewriting it each
    tick. Two things bound the blast radius, and both are worth keeping:
    `_UUID_RE` rejects a non-UUID before it can ever reach `.gt("id",
    cursor)`, so there is no filter-injection route; and cron_recompute now
    WRAPS on an empty keyset page past a live cursor (CR-01), so even a
    maximal UUID costs one wasted tick instead of wedging the engine
    permanently. Moving the fail-loud into the schema — a CHECK pinning
    this key to `value = '' OR value ~ '^[0-9a-f]{8}-...'` — is a migration,
    not a change here.

    `value=None` writes the empty-string wrap marker rather than deleting
    the row, so the row's updated_at stays a usable "last completed pass"
    signal. updated_by is deliberately left NULL (no acting human/service
    identity for an engine-internal write).
    """
    supabase = get_supabase()
    stored = value if value is not None else ""

    def _write() -> Any:
        return (
            supabase.table("system_settings")
            .upsert(
                {
                    "key": MATCH_ENGINE_CURSOR_KEY,
                    "value": stored,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="key",
            )
            .execute()
        )

    _res = await db_execute(_write)
    # A3-01 / candidates-insert convention: this file inspects `.data` on
    # every write whose silence would be indistinguishable from success, and
    # the cursor is the ONE piece of state resume correctness depends on. A
    # zero-row upsert (RLS regression, a CHECK added later, a PostgREST
    # `Prefer: return=minimal` default change) leaves the cursor stale, and
    # the next tick re-processes the identical slice — where
    # `_should_skip_allocator`'s 12h age guard turns every allocator into a
    # `skipped`, so the counters read healthy while the pass never advances.
    if not getattr(_res, "data", None):
        logger.error(
            "match_engine cron: cursor upsert for %s returned no rows — the "
            "cursor did NOT advance to %r and the next tick will REPLAY this "
            "slice (expect a run of all-skipped ticks)",
            MATCH_ENGINE_CURSOR_KEY, stored,
        )


async def _read_pass_started_at() -> datetime | None:
    """Read when the CURRENT pass began — a value written once per pass.

    ⛔ Deliberately NOT the cursor row's `updated_at`. That column is
    rewritten at every partial batch boundary, so reading it here measured
    the gap between the last two TICKS and reported it as the pass duration.
    See MATCH_ENGINE_PASS_START_KEY for the full record.

    Purely diagnostic: a failure must never be able to fail a cron tick, so
    everything is caught. ⚠️ It is caught but NOT silent — a read that keeps
    failing would otherwise be indistinguishable from a genuine first pass,
    and an operator watching for the pass-duration line would see the same
    nothing in both cases.
    """
    try:
        supabase = get_supabase()

        def _read() -> Any:
            return (
                supabase.table("system_settings")
                .select("value")
                .eq("key", MATCH_ENGINE_PASS_START_KEY)
                .maybe_single()
                .execute()
            )

        row = one(await db_execute(_read))
        if not row or not row.get("value"):
            # The genuine no-row case: the first pass after deploy, or right
            # after the key was cleared. Silent on purpose — there is nothing
            # wrong and nothing to measure yet.
            return None
        return datetime.fromisoformat(str(row["value"]).replace("Z", "+00:00"))
    except Exception as err:
        logger.warning(
            "match_engine cron: pass-start read failed (%s: %s) — this tick's "
            "pass-duration line will be MISSING, which is NOT the same as a "
            "healthy pass. If it repeats, the WR-12 freshness instrument is "
            "dead rather than quiet.",
            type(err).__name__, err,
        )
        return None


async def _write_pass_started_at() -> None:
    """Stamp the start of a fresh pass. Called ONCE, on the tick that begins
    one (cursor absent or wrapped), never at a batch boundary.

    Diagnostic-only, like its reader: a failure here costs the next wrap its
    duration line and nothing else, so it must never fail the tick.
    """
    try:
        supabase = get_supabase()
        now_iso = datetime.now(timezone.utc).isoformat()

        def _write() -> Any:
            return (
                supabase.table("system_settings")
                .upsert(
                    {
                        "key": MATCH_ENGINE_PASS_START_KEY,
                        "value": now_iso,
                        "updated_at": now_iso,
                    },
                    on_conflict="key",
                )
                .execute()
            )

        await db_execute(_write)
    except Exception as err:
        logger.warning(
            "match_engine cron: could not stamp the pass start (%s: %s) — the "
            "next wrap will report no duration. Correctness is unaffected; the "
            "WR-12 instrument is.",
            type(err).__name__, err,
        )


async def _wrap_cron_cursor(*, allocators_handled: int) -> None:
    """Write the wrap marker, logging how long the completed pass took.

    The WARNING bar is RECOMPUTE_MIN_AGE_HOURS because that is the number
    the engine already treats as its freshness promise: `_should_skip_allocator`
    declines to rescore anything younger than it, so a pass that takes
    LONGER than it means batches routinely age past the threshold the skip
    logic assumes they never exceed.
    """
    _pass_started_at = await _read_pass_started_at()
    await _write_cron_cursor(None)
    if _pass_started_at is None:
        return
    _pass_hours = (
        datetime.now(timezone.utc) - _pass_started_at
    ).total_seconds() / 3600.0
    if _pass_hours > RECOMPUTE_MIN_AGE_HOURS:
        logger.warning(
            "match_engine cron: full pass took %.1fh, longer than the %dh "
            "freshness window _should_skip_allocator enforces — allocators "
            "are ageing past the SLA between rescores (allocators handled on "
            "the wrapping tick: %d). The batch bound is throttling the pass; "
            "see [164.5.1] WR-12.",
            _pass_hours, RECOMPUTE_MIN_AGE_HOURS, allocators_handled,
        )
    else:
        logger.info(
            "match_engine cron: full pass completed in %.1fh (freshness "
            "window %dh)", _pass_hours, RECOMPUTE_MIN_AGE_HOURS,
        )


@router.post("/cron-recompute")
async def cron_recompute() -> dict[str, Any]:
    """Daily cron. Loops every allocator (+ role 'both'), recomputes their batch."""
    overall_start = time.monotonic()

    def _duration() -> float:
        return round(time.monotonic() - overall_start, 2)

    def _early_return(status: str, **extras: Any) -> dict[str, Any]:
        """Build the uniform early-return response shape.

        Every cron return carries `status` + the four counters + `duration_s`
        + `next_cursor` so monitoring can switch on one field instead of
        guessing at key presence (see TestCronResponseShape._REQUIRED_KEYS).
        `extras` carries branch-specific flags (e.g. `disabled=True`,
        `reason=...`).

        `next_cursor` defaults to None on every early return because none of
        them leaves a resume point: they either never wrote the cursor
        (`disabled`, `kill_switch_unavailable`, `empty_universe`) or wrote
        the wrap marker (`no_allocators` past a live cursor). It is in the
        BASE dict rather than passed per-branch because it was absent from
        all five early returns until 2026-09-16, which made a consumer
        reading `body.next_cursor` get `undefined` — indistinguishable from
        the terminal `null` that means "wrapped". That is exactly the
        "guessing at key presence" this helper exists to prevent.
        """
        return {
            "status": status,
            "processed": 0,
            "skipped": 0,
            "failed": 0,
            "retention_deleted": 0,
            "duration_s": _duration(),
            "next_cursor": None,
            **extras,
        }

    # M-0603 (part 1): reset the TTL cache so this run starts with a fresh
    # poll rather than a value cached by a prior cron invocation, then use the
    # cached accessor for the initial gate (seeds the cache) AND the mid-run
    # re-check below — collapsing O(allocators) round-trips into one per TTL
    # window.
    _reset_kill_switch_cache()
    _kill_switch_state = await _engine_is_enabled_cached()
    if _kill_switch_state != KILL_SWITCH_ENABLED:
        logger.info(
            "match_engine cron: kill switch not enabled (state=%s), skipping",
            _kill_switch_state,
        )
        return _early_return(_kill_switch_state, disabled=True)

    # Phase 164.5.1 criterion 9: read the persisted batching cursor BEFORE
    # the allocator query — an absent/wrapped cursor means "start from the
    # beginning" (cursor stays None, no .gt() filter is added below).
    #
    # `_read_cron_cursor` deliberately PROPAGATES an exhausted read rather
    # than swallowing it into None, "so the caller decides". This IS that
    # decision, and it was missing: the call sat in no `try`, so the
    # exception escaped the handler and FastAPI answered a bare 500 with no
    # `service_error` envelope — contradicting this file's own header rule
    # that every deliberate error in a seam-reachable arm goes through
    # `service_error`. Declining is the only correct disposition: falling
    # back to `cursor = None` would make a FAILED READ indistinguishable
    # from "start over" and silently restart a pass mid-flight, which is the
    # exact property `_read_cron_cursor` was written to preserve.
    try:
        cursor = await _read_cron_cursor()
    except Exception as err:
        logger.error(
            "match_engine cron: cursor read FAILED after exhausting retries "
            "— declining to run rather than restarting the pass from an "
            "unknown position: %s",
            err,
        )
        raise service_error(
            503,
            "CURSOR_UNAVAILABLE",
            dependency="supabase",
            retryable=True,
            retry_after=RETRY_AFTER_SECONDS["supabase"],
            detail="batching cursor read temporarily unavailable — please retry",
        ) from err

    # WR-12 / round-2 regression fix: a NULL cursor means this tick BEGINS a
    # pass — either the first one after deploy, or the one after a wrap. That
    # is the only moment a pass start exists, so it is the only moment the
    # stamp is written. Writing it anywhere else (in particular at a batch
    # boundary, which is what reading the cursor row's own `updated_at`
    # effectively did) collapses the measured interval to one tick and makes
    # the freshness WARNING unreachable.
    if cursor is None:
        await _write_pass_started_at()

    supabase = get_supabase()

    # Load allocators (role = 'allocator' OR 'both') as a keyset-paginated
    # page: fetch CRON_BATCH_SIZE + 1 rows so the extra row tells the caller
    # whether more remain WITHOUT a second count query. Ordered by
    # profiles.id, a PRIMARY KEY — no two rows compare equal, so the keyset
    # page has no tie to break (edge-coverage row 20).
    allocators_query = (
        supabase.table("profiles")
        .select("id")
        .in_("role", ["allocator", "both"])
        # D-01 (QUANTALYZE-Z): the demo allocator shares the allocator role, so
        # the role filter alone returned it on every run. Excluding it here, in
        # the keyset page itself, means the cron never fetches it and a page
        # never spends a slot on it. The scoring-time is_example filter in
        # _score_one_allocator stays the boundary for the endpoint the anon
        # demo can reach.
        .neq("id", _DEMO_ALLOCATOR_ID)
    )
    if cursor is not None:
        allocators_query = allocators_query.gt("id", cursor)
    allocators_result = (
        allocators_query.order("id").limit(CRON_BATCH_SIZE + 1).execute()
    )
    _fetched_page = rows(allocators_result)
    # has_more is computed from the RAW fetch (before trimming to the page):
    # CRON_BATCH_SIZE + 1 rows came back means at least one more exists
    # beyond this page.
    has_more = len(_fetched_page) > CRON_BATCH_SIZE
    allocators = _fetched_page[:CRON_BATCH_SIZE]
    if not allocators:
        # CR-01: an empty keyset page means two COMPLETELY different things
        # depending on whether a cursor is live, and conflating them gave
        # the cursor an ABSORBING state.
        #
        # With a live cursor the pass has simply run off the end of the set
        # (the tail was consumed, or the remaining rows lost their allocator
        # role / were deleted between ticks). That is "the pass is over",
        # not "there is nothing to do" — and leaving the cursor pinned made
        # `.gt("id", cursor)` match zero rows on EVERY subsequent tick,
        # forever: no allocator rescored, no retention sweep, and a status
        # the runbook documents as benign. This was the ONLY terminal path
        # reachable with a non-null cursor that wrote nothing; every other
        # one either wraps or advances.
        if cursor is not None:
            logger.info(
                "match_engine cron: keyset page past cursor %s came back "
                "empty — the pass reached the end of the set; wrapping so "
                "the next tick restarts from the beginning",
                cursor,
            )
            await _wrap_cron_cursor(allocators_handled=0)
            return _early_return("no_allocators", wrapped=True)
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
    # WR-04: the batch budget is a PER-SLICE allowance for allocator work,
    # so its clock starts here, after the shared universe load. Measuring
    # the O(strategies) scan against it spent the whole allowance before
    # allocator #1 on a large universe, which made `budget_exhausted` fire
    # on every tick — one allocator per hour, and (pre-CR-01-fix) a wedge on
    # the tail. `duration_s` on the response still reports TOTAL request
    # time from `overall_start`; only the bound moved.
    _budget_start = time.monotonic()

    def _budget_elapsed() -> float:
        return time.monotonic() - _budget_start

    if not universe["strategies_by_id"]:
        logger.warning("match_engine cron: no strategies in universe")
        return _early_return("empty_universe", reason="empty_universe")

    processed = 0
    skipped = 0
    failed = 0
    # M-0603 (part 2): the retention sweep only needs to run for allocators
    # that actually got a NEW batch this run — an allocator that was skipped
    # (recent batch) or that failed scoring produced no new row, so its
    # existing batch history is unchanged and re-sweeping it is wasted DB work.
    # Track the set of allocators that successfully scored and sweep ONLY
    # those (the comment at the old loop promised "per allocator that had a
    # batch this run" but the code iterated every allocator).
    swept_allocator_ids: list[str] = []
    # Phase 164.5.1 criterion 9: the batching state this loop decides its
    # return on. last_handled_id tracks the last allocator that COMPLETED
    # (processed, skipped, or failed) — a cursor must never point at a
    # half-processed allocator, so it is only set AFTER the per-allocator
    # work below, never before or during it.
    last_handled_id: str | None = None
    budget_exhausted = False
    mid_run_kill_switch_state: str | None = None

    for profile in allocators:
        allocator_id = profile["id"]

        # Re-check kill switch mid-run (founder may flip it). F1 (red-team
        # MED8): use the UNCACHED _engine_is_enabled() here. The cached accessor
        # (KILL_SWITCH_CACHE_TTL_S=30s) delayed honoring a mid-run safety-off by
        # up to 30s of active scoring + persisting — a safety regression for a
        # manual founder kill switch. One indexed boolean SELECT per allocator
        # is negligible against the pandas scoring work in _score_one_allocator,
        # so the safety re-check polls fresh every iteration. (The pre-loop gate
        # at the top of cron_recompute still uses the cached accessor — it only
        # seeds the value once and a sub-TTL staleness there is harmless.)
        # Phase 164.5.1 task 2: the async conversion preserved this property
        # unchanged — this re-check still calls the UNCACHED accessor and
        # still polls fresh every iteration; only the CACHED accessor's
        # failure contract changed (see _engine_is_enabled_cached). Batching
        # (this task) does not move this check onto the cached path either —
        # a mid-run kill-switch flip must never wait on batching's own
        # bookkeeping, and this UNCACHED re-check does not touch
        # _read_cron_cursor/_write_cron_cursor at all.
        _mid_run_state = await _engine_is_enabled()
        if _mid_run_state != KILL_SWITCH_ENABLED:
            logger.info(
                "match_engine cron: kill switch not enabled mid-run "
                "(state=%s), aborting — cursor left unwritten so the next "
                "tick re-attempts this slice",
                _mid_run_state,
            )
            mid_run_kill_switch_state = _mid_run_state
            break

        # NEW-C08-06: serialize skip-check → score per allocator (shared with
        # POST /recompute) so a concurrent admin recompute cannot race this
        # cron iteration into a duplicate batch for the same allocator. The
        # lock is per-allocator, so cross-allocator cron throughput is
        # unaffected (and cron already awaits each allocator sequentially).
        async with _get_recompute_lock(allocator_id):
            if await _should_skip_allocator(allocator_id, force=False):
                skipped += 1
            else:
                try:
                    await _score_one_allocator(allocator_id, universe)
                    processed += 1
                    swept_allocator_ids.append(allocator_id)
                except Exception as err:
                    logger.exception("match_engine cron: allocator %s failed: %s", allocator_id, err)
                    failed += 1
                    # Continue the loop — one allocator failure doesn't fail the cron

        # This allocator is now COMPLETE (processed, skipped, or failed —
        # all three count as "handled" for cursor purposes). Phase 164.5.1
        # criterion 9: the elapsed-time batch bound is checked HERE, BETWEEN
        # allocators, never inside _score_one_allocator — a cursor must
        # never point at a half-processed allocator.
        last_handled_id = allocator_id
        # CR-01: the budget is a bound on STARTING MORE WORK, so it must not
        # fire when there IS no more work. Evaluated unconditionally, it set
        # budget_exhausted=True after the LAST allocator of the LAST page —
        # `has_more` false, nothing left to resume — and the boundary branch
        # below then wrote the MAXIMUM profiles.id as the cursor instead of
        # the wrap marker. Every later tick matched zero rows. With the
        # measured 25s budget against a measured 44.67s real cron run this
        # was the ordinary path, not an edge case.
        _is_tail_of_set = not has_more and allocator_id == allocators[-1]["id"]
        if _budget_elapsed() >= CRON_BATCH_BUDGET_S and not _is_tail_of_set:
            budget_exhausted = True
            break

    # Retention sweep at end of cron. Log at ERROR so a silently-broken
    # sweep (RLS regression, FK error, URL truncation) lights up alerts
    # rather than getting buried.
    #
    # M-0611: fan the per-allocator sweeps out with asyncio.gather instead of
    # awaiting them serially — they have no inter-dependencies, so the previous
    # sequential loop spent O(swept) round-trips back-to-back. _retention_sweep
    # is sync, so each runs in its own thread via asyncio.to_thread; gather with
    # return_exceptions=True so one allocator's sweep failure cannot abort the
    # rest (matching the old per-iteration try/except semantics).
    retention_total = 0
    sweep_results = await asyncio.gather(
        *(asyncio.to_thread(_retention_sweep, aid) for aid in swept_allocator_ids),
        return_exceptions=True,
    )
    for aid, sweep_result in zip(swept_allocator_ids, sweep_results):
        if isinstance(sweep_result, BaseException):
            logger.error(
                "match_engine cron: retention sweep failed for %s: %s",
                aid, sweep_result,
            )
        else:
            retention_total += sweep_result

    duration_s = _duration()

    # Phase 164.5.1 criterion 9: a mid-run kill-switch flip takes priority
    # over the batching decision below — the cursor is left UNWRITTEN (no
    # _write_cron_cursor call at all) so the next tick re-attempts this same
    # slice from the SAME starting cursor, rather than silently skipping the
    # allocators this run never reached (T-164.5.1-06-04).
    if mid_run_kill_switch_state is not None:
        logger.info(
            "match_engine cron complete: status=%s (mid-run kill-switch "
            "abort) processed=%d skipped=%d failed=%d retention_deleted=%d "
            "duration_s=%.2f",
            mid_run_kill_switch_state, processed, skipped, failed,
            retention_total, duration_s,
        )
        return {
            "status": mid_run_kill_switch_state,
            "processed": processed,
            "skipped": skipped,
            "failed": failed,
            "retention_deleted": retention_total,
            "duration_s": duration_s,
            # The cursor was deliberately NOT written, so the resume point
            # is still whatever this tick started from. Reporting None here
            # would advertise "start over" for a run that does the opposite.
            "next_cursor": cursor,
        }

    if has_more or budget_exhausted:
        # Phase 164.5.1 criterion 9: this run stopped at its batch boundary
        # (a count bound OR an elapsed-time bound, whichever came first).
        # `partial` is a NORMAL completion of one slice — orthogonal to the
        # processed/failed ratio the ok/degraded/total_failure block below
        # decides on, never conflated with it. Persist the cursor so the
        # NEXT tick resumes strictly after the last COMPLETED allocator.
        #
        # A batch boundary is reached only after at least one allocator was
        # handled: the query excludes the demo allocator (D-01), so a
        # non-empty page always reaches the loop, whose first iteration
        # either aborts on the mid-run kill switch (that path returns above)
        # or sets last_handled_id. Writing None here would write the WRAP
        # marker while `has_more` says more allocators exist, so an
        # impossible state fails loud rather than being logged as routine.
        if last_handled_id is None:
            raise RuntimeError(
                "match_engine cron: batch boundary reached with nothing "
                "handled — a batch boundary is reached only after at least "
                "one allocator was handled"
            )
        await _write_cron_cursor(last_handled_id)
        logger.info(
            "match_engine cron: batch boundary reached (has_more=%s "
            "budget_exhausted=%s) — next_cursor=%s processed=%d skipped=%d "
            "failed=%d retention_deleted=%d duration_s=%.2f",
            has_more, budget_exhausted, last_handled_id, processed, skipped,
            failed, retention_total, duration_s,
        )
        return {
            "status": "partial",
            "processed": processed,
            "skipped": skipped,
            "failed": failed,
            "retention_deleted": retention_total,
            "duration_s": duration_s,
            "next_cursor": last_handled_id,
        }

    # The set was exhausted in this pass (no has-more flag, no budget trip):
    # wrap the cursor so the next tick starts from the beginning again.
    await _wrap_cron_cursor(
        allocators_handled=processed + skipped + failed,
    )

    # Pick a status discriminator that lets monitoring switch on a single
    # field. Returning "ok" on a structural fault (every allocator failed)
    # would let dashboards stay green while the engine is broken — distinct
    # statuses surface the breakdown without forcing log-text parsing.
    # `partial` (above) is a FOURTH, orthogonal axis — it says the pass is
    # incomplete, never that anything failed; it is decided BEFORE this
    # block runs and this block never sees a partial run.
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
        "next_cursor": None,
    }
