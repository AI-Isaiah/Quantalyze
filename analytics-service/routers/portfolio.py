import asyncio
import enum
import hashlib
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from models.schemas import (
    BridgeRequest,
    PortfolioAnalyticsRequest,
    PortfolioAnalyticsResponse,
    PortfolioBridgeResponse,
    PortfolioOptimizerRequest,
    PortfolioOptimizerResponse,
    VerifyStrategyRequest,
    VerifyStrategyResponse,
)
from services.audit import log_audit_event
from services.benchmark import get_benchmark_returns
from services.db import get_supabase
from services.encryption import decrypt_credentials, encrypt_credentials, get_kek
from services.exchange import create_exchange, fetch_all_trades, fetch_usdt_balance, validate_key_permissions
from services.metrics import _safe_float, sanitize_metrics
from services.portfolio_metrics import compute_twr, compute_mwr, compute_period_returns
from services.portfolio_optimizer import find_improvement_candidates, generate_narrative
from services.portfolio_risk import (
    compute_attribution,
    compute_avg_pairwise_correlation,
    compute_correlation_matrix,
    compute_risk_decomposition,
    compute_rolling_correlation,
)
from services.transforms import trades_to_daily_returns

router = APIRouter(prefix="/api", tags=["portfolio"])
logger = logging.getLogger("quantalyze.analytics")


# Audit M-0620 — canonical enums for the literal strings the DB CHECK
# constraints enforce. The literals used to be hard-coded across the
# router; a typo like 'completed' instead of 'complete' would only
# surface at INSERT-time at the end of a 1-3 minute pipeline. These
# enums give the type system a chance to flag drift at edit time.

class ComputationStatus(str, enum.Enum):
    PENDING = "pending"
    COMPUTING = "computing"
    COMPLETE = "complete"
    FAILED = "failed"


class AlertType(str, enum.Enum):
    DRAWDOWN = "drawdown"
    CORRELATION_SPIKE = "correlation_spike"
    REGIME_SHIFT = "regime_shift"
    UNDERPERFORMANCE = "underperformance"
    CONCENTRATION_CREEP = "concentration_creep"
    REBALANCE_DRIFT = "rebalance_drift"


class AlertSeverity(str, enum.Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


def _to_utc_iso(value: datetime | pd.Timestamp) -> str:
    """Coerce a datetime or pd.Timestamp into a tz-aware UTC ISO string.

    Audit M-0621 — without a single coercion point, callers sprinkled
    `datetime.now(timezone.utc).isoformat()` and `pd.Timestamp.isoformat()`
    inconsistently. A naive pd.Timestamp .isoformat() produced a tz-naive
    string that Postgres TIMESTAMPTZ silently assumed UTC for; mixing the
    two surfaces was a wall-clock-shift hazard.
    """
    if isinstance(value, pd.Timestamp):
        if value.tzinfo is None:
            value = value.tz_localize(timezone.utc)
        else:
            value = value.tz_convert(timezone.utc)
        return value.isoformat()
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        else:
            value = value.astimezone(timezone.utc)
        return value.isoformat()
    raise TypeError(f"_to_utc_iso: unsupported value type {type(value).__name__}")

# Alert / matching thresholds. Named so config review and future tuning
# don't have to chase bare literals scattered through the file.
_DRAWDOWN_ALERT_THRESHOLD = -0.10        # drawdown ratio that triggers a medium alert
_DRAWDOWN_HIGH_SEVERITY_THRESHOLD = -0.20  # below this we mark the alert "high"
_CORRELATION_SPIKE_THRESHOLD = 0.70      # avg pairwise correlation that triggers a spike alert
_REGIME_SHIFT_DELTA_THRESHOLD = 0.15     # rolling-corr delta that triggers a regime_shift alert
_UNDERPERFORMANCE_GAP_THRESHOLD = 0.005  # min gap between worst and second-worst contribution
_CONCENTRATION_MULTIPLIER = 1.5          # weight_pct over equal-weight that flags concentration_creep
_REBALANCE_DRIFT_THRESHOLD = 0.05        # min weight drift to fire a rebalance_drift alert
_REBALANCE_DRIFT_HIGH_THRESHOLD = 0.10   # above this we mark the alert "high"

# Strategy matching (verify_strategy endpoint).
#
# audit-2026-05-07 H-0594 — bounded payload. The pre-fix limit of 100
# candidates × ~500-1000 daily {date,value} records per `returns_series`
# materialised up to 100k JSON objects into Python memory per
# verification call. Two-tier mitigation:
#   1. `_MATCH_CANDIDATE_LIMIT` shortlists to the 30 most-recent
#      published strategies (recency-ordered SELECT) before the heavy
#      `returns_series` fetch. Recency is a coarse signal but is
#      enough to bound a single call's memory while a follow-up
#      schema-level fix (per-strategy fingerprint column or a
#      lower-dimensional embedding) is sized.
#   2. `_MATCH_RETURNS_SERIES_MAX_POINTS` caps each `returns_series`
#      payload to its trailing N entries before the in-memory DataFrame
#      is built. A bad upstream write that ballooned a single series
#      to 10k+ records would otherwise still pin tens of MB per call
#      even with the candidate count capped.
_MATCH_CANDIDATE_LIMIT = 30
_MATCH_RETURNS_SERIES_MAX_POINTS = 750  # ~3 years of daily returns
_MATCH_CORRELATION_THRESHOLD = 0.95

# How long an analytics row can sit in 'computing' before a watchdog is
# allowed to reap it (queryable from the cron sweep).
_COMPUTING_ROW_STALE_MINUTES = 30


limiter = Limiter(key_func=get_remote_address)

# Per-email sliding-window rate limit for verify_strategy. IP-only limiting
# (slowapi) is decorative against rotated-IP attackers. We track recent
# verification attempts in-process so a single email can't burn through the
# IP-budget by rotating cloud IPs. NOT distributed-safe across workers; the
# IP-based limiter is still authoritative for the global ceiling.
_VERIFY_STRATEGY_EMAIL_RATE_LIMIT = 5          # max per window
_VERIFY_STRATEGY_EMAIL_RATE_WINDOW_SEC = 3600  # 1 hour
# Bound on distinct emails tracked simultaneously. Without a cap an attacker
# submitting unique addresses could leak unbounded memory (review CR-1/PERF-2).
# When the cap is hit we evict the oldest-touched email (LRU-ish: dict insertion
# order is the activity order since we re-insert on every check).
_VERIFY_STRATEGY_EMAIL_CACHE_MAX = 10_000
_verify_strategy_email_attempts: dict[str, list[float]] = {}

# Per-user sliding-window rate limit for portfolio-bridge.
#
# audit-2026-05-07 L-0045 — slowapi's @limiter.limit("10/hour") on the
# bridge endpoint uses get_remote_address by default. Behind Next.js
# Vercel-functions every request arrives from the same egress IP pool,
# so the 10/hour ceiling collapses to a SINGLE bucket shared across
# every authenticated user — a noisy or hostile user can starve the
# bucket for everyone on the same IP. The Next.js per-user
# `bridge:${user.id}` Upstash limiter (src/app/api/bridge/route.ts:20,
# 5/min) is the only EFFECTIVE quota today; if that ever degrades
# (Upstash outage) or is bypassed by a future caller, the Python tier
# provides no per-user cap.
#
# In-process per-user limit is the defense-in-depth. Same cap+window
# as the email limiter; bound on distinct users tracked to keep memory
# safe; LRU-ish eviction via insertion-order re-insertion.
_BRIDGE_USER_RATE_LIMIT = 30           # max per window (covers expected legit usage)
_BRIDGE_USER_RATE_WINDOW_SEC = 3600    # 1 hour
_BRIDGE_USER_CACHE_MAX = 10_000
_bridge_user_attempts: dict[str, list[float]] = {}


def _check_sliding_window_rate(
    bucket_map: dict[str, list[float]],
    key: str | None,
    *,
    limit: int,
    window_sec: int,
    cache_max: int,
) -> bool:
    """Sliding-window per-key rate-limit check with LRU-bounded cache.

    Returns True if the key is under budget. Side-effects:
      * prunes expired timestamps from the key's bucket,
      * records the current attempt when under budget,
      * re-inserts the key to preserve insertion-order LRU semantics
        BOTH on the under-budget AND over-budget branches (audit
        2026-05-07 red-team finding — see below),
      * evicts oldest entries when `len(bucket_map) > cache_max`.

    Empty/None keys are passed through as `True` — the trust-boundary
    smell is handled by the caller's downstream filter (e.g. the
    ownership SELECT will 404 a missing user_id; the verify_strategy
    fast-path returns early on a missing email).

    Pure (no I/O). Uses `time.time()` (wall clock) rather than the
    process-local monotonic clock so a worker recycle / cold-start
    does NOT silently invalidate every stored timestamp
    (audit-2026-05-07 red-team L-0045: the monotonic clock restarts
    at 0 on a new process, which pushes every stored `now` outside
    the new cutoff window → all buckets prune to empty → free
    30-call quota refill on every restart). Wall clock is
    process-portable; the existing documented limitation (NOT
    distributed-safe across workers) remains — see
    `_check_bridge_user_rate` docstring.

    NOTE: the regression test
    `test_portfolio_bridge_rate_limit_uses_wall_clock_not_monotonic`
    inspects this function's source and asserts the literal
    `time`-dot-`monotonic` token is absent — keep references to the
    rejected clock prose-only ("monotonic clock") so the contract
    stays pinned without re-tripping the assertion.

    Audit-2026-05-07 red-team (HIGH conf 8): an over-budget key used
    to skip the `pop+reinsert` move-to-tail step (`bucket_map[key] =
    bucket` on an existing key does NOT change dict insertion order
    in CPython). With the key pinned at the dict head, a fresh
    `_BRIDGE_USER_CACHE_MAX` distinct attackers (or legitimate
    callers) would evict the rate-limited user's bucket via the
    `next(iter(bucket_map))` LRU pop — letting them start a brand
    new 30-call window. Both branches now refresh LRU position so
    rejected buckets compete fairly for the cache slot.

    Mirrors the prior duplicated `_check_bridge_user_rate` and
    `_check_verify_strategy_email_rate` bookkeeping so future tuning
    (e.g. switching to a deque or a distributed store) only touches
    one site.
    """
    if not key:
        return True
    now = time.time()
    cutoff = now - window_sec
    bucket = bucket_map.get(key, [])
    bucket = [t for t in bucket if t >= cutoff]
    if len(bucket) >= limit:
        # audit-2026-05-07 red-team HIGH — refresh LRU position even
        # on reject so a rate-limited user can't be evicted by a
        # wave of fresh callers and silently regain their quota.
        bucket_map.pop(key, None)
        bucket_map[key] = bucket
        while len(bucket_map) > cache_max:
            oldest = next(iter(bucket_map))
            bucket_map.pop(oldest, None)
        return False
    bucket.append(now)
    # Re-insert (move to dict-end) to preserve insertion-order LRU semantics.
    bucket_map.pop(key, None)
    bucket_map[key] = bucket
    while len(bucket_map) > cache_max:
        oldest = next(iter(bucket_map))
        bucket_map.pop(oldest, None)
    return True


def _check_bridge_user_rate(user_id: str | None) -> bool:
    """Return True if user_id is under the per-user bridge budget.

    Thin wrapper over `_check_sliding_window_rate` so the rate-limit
    bookkeeping stays in lockstep with the email limiter. Returning
    False means the caller should reject with HTTP 429 even though the
    slowapi IP-based limiter let the request through. Not
    distributed-safe across workers; the IP-based slowapi limit +
    Next.js per-user Upstash limit remain the authoritative bounds on
    multi-worker abuse, but same-process abuse from a single IP pool
    gets full per-user replay protection.

    A missing user_id is itself a trust-boundary smell (see L-0047)
    but we don't reject here — `.eq("user_id", req.user_id)` on the
    portfolios SELECT will 404 the request immediately.
    """
    return _check_sliding_window_rate(
        _bridge_user_attempts,
        user_id,
        limit=_BRIDGE_USER_RATE_LIMIT,
        window_sec=_BRIDGE_USER_RATE_WINDOW_SEC,
        cache_max=_BRIDGE_USER_CACHE_MAX,
    )


def _check_verify_strategy_email_rate(email: str) -> bool:
    """Return True if the email is under the per-email rate budget.

    Thin wrapper over `_check_sliding_window_rate`. Returning False
    means the caller should reject with HTTP 429 even though the
    IP-based limiter let the request through.
    """
    return _check_sliding_window_rate(
        _verify_strategy_email_attempts,
        email,
        limit=_VERIFY_STRATEGY_EMAIL_RATE_LIMIT,
        window_sec=_VERIFY_STRATEGY_EMAIL_RATE_WINDOW_SEC,
        cache_max=_VERIFY_STRATEGY_EMAIL_CACHE_MAX,
    )


# Audit H-0592 — in-process idempotency cache for verify_strategy. Keyed
# by (email, exchange, api_key fingerprint, idempotency_key) with a 24h TTL.
# api_key is hashed into the key (review SEC-2) so two callers sharing an
# email but using different keys can't read each other's cached response.
# Not distributed-safe across workers; the IP rate limit + per-email
# throttle remain the authoritative bound on multi-worker abuse, but
# same-process flaky-client retries get full replay protection.
_VERIFY_STRATEGY_IDEMPOTENCY_TTL_SEC = 24 * 3600
# Bound on simultaneously-cached idempotency responses. Reviewed under CR-2 /
# PERF-2 — without a cap the dict grows unbounded. Eviction follows the same
# insertion-order LRU pattern as the email cache.
_VERIFY_STRATEGY_IDEMPOTENCY_CACHE_MAX = 10_000
_verify_strategy_idempotency: dict[str, tuple[float, dict]] = {}


def _api_key_fingerprint(api_key: str | None) -> str:
    """Return a short hex digest of api_key for inclusion in the
    idempotency-cache key (review SEC-2). 12 hex chars (48 bits) is plenty
    of collision resistance for an in-process cache while staying short.
    """
    raw = (api_key or "").encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:12]


def _verify_strategy_idempotency_key(
    email: str, exchange: str, api_key: str | None, ik: str,
) -> str:
    return (
        f"{(email or '').strip().lower()}|{exchange}|"
        f"{_api_key_fingerprint(api_key)}|{ik}"
    )


def _verify_strategy_idempotency_lookup(
    email: str, exchange: str, api_key: str | None, ik: str,
) -> dict | None:
    key = _verify_strategy_idempotency_key(email, exchange, api_key, ik)
    entry = _verify_strategy_idempotency.get(key)
    if not entry:
        return None
    stored_at, response = entry
    if time.monotonic() - stored_at > _VERIFY_STRATEGY_IDEMPOTENCY_TTL_SEC:
        _verify_strategy_idempotency.pop(key, None)
        return None
    return response


def _verify_strategy_idempotency_store(
    email: str, exchange: str, api_key: str | None, ik: str, response: dict,
) -> None:
    key = _verify_strategy_idempotency_key(email, exchange, api_key, ik)
    # Re-insert to preserve insertion-order LRU semantics.
    _verify_strategy_idempotency.pop(key, None)
    _verify_strategy_idempotency[key] = (time.monotonic(), dict(response))
    while len(_verify_strategy_idempotency) > _VERIFY_STRATEGY_IDEMPOTENCY_CACHE_MAX:
        oldest = next(iter(_verify_strategy_idempotency))
        _verify_strategy_idempotency.pop(oldest, None)


def _records_to_series(raw: list | None, name: str = "") -> pd.Series | None:
    """Convert [{date, value}, ...] records to a DatetimeIndex pd.Series.

    Tolerates malformed records by skipping any entry missing ``date`` or
    ``value`` and emitting a single warning. A single typo (legacy
    ``{ts, val}`` row) used to raise KeyError that propagated up to the
    outer catch and overwrote the real exception with the generic
    "Analytics computation failed" message — masking schema drift.
    """
    if not isinstance(raw, list) or not raw:
        return None

    dates: list = []
    vals: list = []
    skipped = 0
    for r in raw:
        if not isinstance(r, dict):
            skipped += 1
            continue
        d = r.get("date")
        v = r.get("value")
        if d is None or v is None:
            skipped += 1
            continue
        dates.append(d)
        vals.append(v)

    if skipped:
        logger.warning(
            "_records_to_series: skipped %d malformed records for %s",
            skipped, name or "<unnamed>",
        )

    if not dates:
        return None

    return pd.Series(vals, index=pd.DatetimeIndex(dates), name=name)


def _build_monthly_returns(
    portfolio_returns_series: "pd.Series",
) -> dict[str, dict[str, float]]:
    """Build a {year: {month: period_return}} dict from a daily-returns series.

    audit-2026-05-07 L-0046 — single-pass cumulative-product accumulate
    followed by a dict-comprehension `(cum - 1.0)` finalize. Yields
    period returns per (year, month). The previous form mutated the
    same dict across two loops; a missed key in pass 2 would have left
    a cumulative product masquerading as a period return.

    audit-2026-05-07 red-team (MED conf 8) — input series may contain
    DUPLICATE dates. `_records_to_series` does not dedupe; an upstream
    `returns_series` JSONB with a repeated `date` key (or a future
    reindex against a non-unique DatetimeIndex) would feed two
    entries for the same calendar day into the cumprod, double-counting
    that day's return in the bucket. We dedupe last-write-wins on the
    raw `(date, value)` stream BEFORE the cumprod so the bucket math
    is idempotent under unsorted / duplicated input. Callers SHOULD
    still pass a series with unique dates — this is defense-in-depth
    against the JSONB shape rather than a license to feed dirty data.

    Extracted so both the router and the regression tests drive the
    SAME code path (Rule 9 — tests verify intent, not a pasted copy
    of the implementation).
    """
    # Defensive last-write-wins dedupe on (year, month, day) — protect
    # against duplicate index entries upstream of the cumprod walk. Key
    # by tuple rather than a parallel `(date_key → (year, month))` dict:
    # the tuple IS the year+month carrier, so the cumprod walk reads
    # year/month directly off the key without a second lookup.
    # Stable tuple components (string year/month) sidestep pd.Timestamp
    # hashing quirks (e.g. same-day-different-tz) at our daily resolution.
    deduped: dict[tuple[str, str, str], float] = {}
    for d, v in portfolio_returns_series.items():
        if hasattr(d, "year"):
            year_str = str(d.year)
            month_str = str(d.month).zfill(2)
            day_str = str(d.day).zfill(2) if hasattr(d, "day") else ""
        else:
            year_str = str(d)[:4]
            month_str = str(d)[5:7]
            day_str = str(d)[8:10]
        deduped[(year_str, month_str, day_str)] = float(v)

    monthly_cumprod: dict[str, dict[str, float]] = {}
    for (year_str, month_str, _day), v in deduped.items():
        monthly_cumprod.setdefault(year_str, {}).setdefault(month_str, 1.0)
        monthly_cumprod[year_str][month_str] *= (1 + v)
    return {
        year_str: {month_str: cum - 1.0 for month_str, cum in months.items()}
        for year_str, months in monthly_cumprod.items()
    }


def _trim_returns_series(raw_series: list | None, cap: int | None = None) -> list | None:
    """Return the trailing `cap` entries of a JSONB returns_series list.

    audit-2026-05-07 H-0594 — verify_strategy's per-candidate
    `returns_series` payloads are trimmed to their trailing window
    before deserialization. Older history dilutes the recent-regime
    correlation signal verify_strategy is looking for, and trimming
    bounds the in-memory pd.DataFrame footprint when an upstream
    write ballooned a single series to 10k+ records.

    audit-2026-05-07 red-team (MED conf 8) — ALWAYS returns a fresh
    list when the input is a list. The pre-fix shape returned
    `raw_series[-cap:]` (a new list) on the trim path but the SAME
    reference on the no-trim path. Future enrichment loops that
    `trimmed.append(...)` would otherwise silently mutate the
    Supabase row's `returns_series` JSONB still held in
    `sa_result.data` — a subtle aliasing bug. The defensive copy
    eliminates the footgun. Non-list inputs (None / malformed JSONB)
    still pass through unchanged.

    Extracted so both the router and the regression test drive the
    SAME helper (Rule 9). `cap` defaults to
    `_MATCH_RETURNS_SERIES_MAX_POINTS`.
    """
    if cap is None:
        cap = _MATCH_RETURNS_SERIES_MAX_POINTS
    if not isinstance(raw_series, list):
        return raw_series
    if len(raw_series) > cap:
        return raw_series[-cap:]
    # Defensive copy on the no-trim path — see red-team finding above.
    return list(raw_series)


def _redact_credentials(message: str, req: "VerifyStrategyRequest") -> str:
    """Strip raw api_key / api_secret / passphrase substrings from a log line.

    CCXT auth-error messages embed the api_key verbatim in signature-mismatch
    strings. Without redaction those land in Sentry breadcrumbs that the PII
    scrubber doesn't touch.
    """
    safe = message
    for needle in (
        getattr(req, "api_key", None),
        getattr(req, "api_secret", None),
        getattr(req, "passphrase", None),
    ):
        if needle and isinstance(needle, str) and len(needle) >= 6:
            safe = safe.replace(needle, "[REDACTED]")
    return safe

# Cron concurrency guard: allow at most 3 simultaneous portfolio computations.
# NOTE: asyncio.Semaphore is process-local. Multi-worker/multi-pod deployments rely
# on the DB-level in-flight row check instead. The semaphore limits within-process burst.
_compute_semaphore = asyncio.Semaphore(3)


def _build_normalized_weights(portfolio_strategies: list[dict]) -> dict[str, float]:
    """Build a normalized weight map from portfolio_strategies rows.

    Replaces three near-identical inline copies across _compute_portfolio_analytics,
    portfolio_optimizer, and portfolio_bridge (audit M-0624).

    NEW-C19-05: use `is not None` instead of truthiness so an explicit
    current_weight=0 (paused strategy) is preserved as 0.0, not silently
    promoted to 1.0 as if unset.  A 0-weight strategy must stay 0-weight —
    it must not become the dominant allocation after renormalization.
    """
    raw = {
        row["strategy_id"]: float(row["current_weight"]) if row.get("current_weight") is not None else 1.0
        for row in portfolio_strategies
    }
    total = sum(raw.values()) or 1.0
    return {sid: w / total for sid, w in raw.items()}


def _series_to_curve(series: pd.Series) -> list[dict]:
    """Serialize a cumprod Series into JSON-shaped equity-curve records.

    Replaces two duplicated comprehensions in _compute_portfolio_analytics and
    verify_strategy (audit M-0625).
    """
    return [
        {"date": d.isoformat(), "value": _safe_float(float(v))}
        for d, v in series.items()
    ]


def _compute_sharpe_and_vol(returns: pd.Series) -> tuple[float | None, float | None, float | None, str]:
    """Compute annualised vol, mean_ret, sharpe + a status code.

    Returns (vol, mean_ret, sharpe, sharpe_status). Status codes are
    deliberately mutually exclusive so the data_quality channel can
    distinguish each empty-state reason (review CR-3):

      "ok"                   — sharpe is a real float.
      "insufficient_history" — fewer than 2 samples.
      "zero_volatility"      — vol == 0 (flat returns).
      "nan_vol"              — vol is NaN (typically all-NaN returns).
      "nan_mean"             — vol is finite but mean_ret is NaN.
      "nan_sharpe"           — mean_ret/vol arithmetic produced NaN/inf.

    Replaces three structurally identical implementations (audit M-0626).
    """
    if len(returns) <= 1:
        return None, None, None, "insufficient_history"
    vol = returns.std() * np.sqrt(252)
    mean_ret = returns.mean() * 252
    if vol is None or vol == 0 or (isinstance(vol, float) and np.isnan(vol)):
        if vol == 0:
            status = "zero_volatility"
        else:
            status = "nan_vol"
        return _safe_float(vol), _safe_float(mean_ret), None, status
    if mean_ret is None or (isinstance(mean_ret, float) and np.isnan(mean_ret)):
        return _safe_float(vol), None, None, "nan_mean"
    sharpe = _safe_float(mean_ret / vol)
    return _safe_float(vol), _safe_float(mean_ret), sharpe, "ok" if sharpe is not None else "nan_sharpe"


# ---------------------------------------------------------------------------
# Internal computation helper (also callable from the cron module)
# ---------------------------------------------------------------------------

async def _compute_portfolio_analytics(portfolio_id: str) -> dict:
    """Compute full portfolio analytics and persist the result.

    Inserts a new portfolio_analytics row (immutable history — no upsert).
    Returns the final analytics payload on success.
    Raises HTTPException on unrecoverable errors.
    """
    supabase = get_supabase()

    # @audit-skip: compute-job state row. portfolio_analytics is the
    # immutable-history table backing the dashboard; each compute run
    # writes a new row. Not a user-intent mutation — the user's
    # "compute my portfolio analytics" intent doesn't map 1:1 to this
    # row (the row is internal bookkeeping).
    insert_result = supabase.table("portfolio_analytics").insert(
        {"portfolio_id": portfolio_id, "computation_status": ComputationStatus.COMPUTING.value}
    ).execute()

    if not insert_result.data:
        raise HTTPException(status_code=500, detail="Failed to create analytics row")

    analytics_id = insert_result.data[0]["id"]

    def _fail(error_msg: str):
        # @audit-skip: compute-job failure state.
        # error_msg is bounded to ~500 chars to keep the column readable.
        supabase.table("portfolio_analytics").update(
            {
                "computation_status": ComputationStatus.FAILED.value,
                "computation_error": error_msg[:500],
            }
        ).eq("id", analytics_id).execute()

    try:
        ps_result = supabase.table("portfolio_strategies").select(
            "strategy_id, current_weight, strategies(id, name)"
        ).eq("portfolio_id", portfolio_id).execute()

        portfolio_strategies = ps_result.data or []
        if not portfolio_strategies:
            _fail("No strategies found in portfolio.")
            raise HTTPException(status_code=400, detail="No strategies found in portfolio")

        strategy_ids = [row["strategy_id"] for row in portfolio_strategies]

        # Build weight map (default equal weight if not set)
        weights = _build_normalized_weights(portfolio_strategies)

        strategy_names = {
            row["strategy_id"]: (row.get("strategies") or {}).get("name", row["strategy_id"])
            for row in portfolio_strategies
        }

        sa_result = supabase.table("strategy_analytics").select(
            "strategy_id, returns_series, equity_curve, total_aum"
        ).in_("strategy_id", strategy_ids).execute()

        analytics_rows = {row["strategy_id"]: row for row in (sa_result.data or [])}

        strategy_returns: dict[str, pd.Series] = {}
        strategy_equity: dict[str, pd.Series] = {}
        strategy_twrs: dict[str, float] = {}
        strategy_aum: dict[str, float] = {}

        # Telemetry — record sids dropped at each step so the persisted
        # analytics row can flag partial-data computations. Project memory
        # (v0.17.1 KPI-17 saga, PRs #95-#100) flagged the silent-drop pattern;
        # we now warn-log AND persist counts so the dashboard can render a
        # "computed from N of M strategies" badge instead of silently degrading.
        missing_analytics_sids: list[str] = []
        missing_returns_sids: list[str] = []
        missing_equity_sids: list[str] = []

        for sid in strategy_ids:
            row = analytics_rows.get(sid)
            if not row:
                missing_analytics_sids.append(sid)
                continue

            s = _records_to_series(row.get("returns_series"), name=sid)
            if s is not None:
                strategy_returns[sid] = s

                eq = _records_to_series(row.get("equity_curve"), name=sid)
                if eq is not None:
                    strategy_equity[sid] = eq
                else:
                    missing_equity_sids.append(sid)
            else:
                missing_returns_sids.append(sid)

            # NEW-C19-06: use `is not None` so a genuine $0 strategy is counted
            # as a known reporter, not silently treated as NULL.  A truthy check
            # (if row.get("total_aum"):) maps $0 → falsy → no entry in
            # strategy_aum, causing aum_known_count to fall short of
            # len(strategy_ids) even when every strategy has reported, and
            # collapsing total_aum to None for any portfolio that contains one
            # drained strategy.
            if row.get("total_aum") is not None:
                strategy_aum[sid] = float(row["total_aum"])

        if missing_analytics_sids:
            logger.warning(
                "portfolio %s missing strategy_analytics rows for %d/%d strategies: %s",
                portfolio_id, len(missing_analytics_sids), len(strategy_ids),
                missing_analytics_sids,
            )
        if missing_returns_sids:
            logger.warning(
                "portfolio %s missing returns_series for %d strategies: %s",
                portfolio_id, len(missing_returns_sids), missing_returns_sids,
            )
        if missing_equity_sids:
            logger.warning(
                "portfolio %s missing equity_curve for %d strategies: %s",
                portfolio_id, len(missing_equity_sids), missing_equity_sids,
            )

        if not strategy_returns:
            _fail("No returns data available for strategies in this portfolio.")
            raise HTTPException(status_code=400, detail="No returns data available")

        # Renormalize weights to only the strategies that have data.
        # Without this, a missing high-weight strategy silently suppresses all returns
        # (e.g., 80% weight strategy missing → surviving 20% still gets 0.2× multiplier).
        # We persist the dropped sids on the analytics row so the UI can render a
        # "computed from N of M strategies" badge — silent renormalization to 100%
        # is the canonical KPI-17 anti-pattern (project memory).
        dropped_weight_total = sum(
            w for sid, w in weights.items() if sid not in strategy_returns
        )
        available_sids = set(strategy_returns.keys())
        weights = {sid: w for sid, w in weights.items() if sid in available_sids}
        total_available_w = sum(weights.values()) or 1.0
        weights = {sid: w / total_available_w for sid, w in weights.items()}

        # Compute TWR per strategy
        for sid, eq in strategy_equity.items():
            twr = compute_twr(eq, [])
            if twr is not None:
                strategy_twrs[sid] = twr

        # Build portfolio-level daily returns
        all_dates = sorted(
            set(d for s in strategy_returns.values() for d in s.index)
        )
        if len(all_dates) < 2:
            _fail("Insufficient return history across portfolio strategies.")
            raise HTTPException(status_code=400, detail="Insufficient return history")

        # fillna(0) treats days with no trade record as flat performance.
        # This slightly suppresses measured vol/drawdown on short or sparse strategies.
        # A future improvement: use intersection-only dates (dropna instead of fillna).
        df = pd.DataFrame(strategy_returns).reindex(all_dates).fillna(0)
        w_arr = np.array([weights.get(sid, 0) for sid in df.columns])
        portfolio_returns_series = pd.Series(
            (df.values * w_arr).sum(axis=1),
            index=df.index,
            name="portfolio",
        )

        # Portfolio TWR
        portfolio_twr = compute_twr(
            (1 + portfolio_returns_series).cumprod(), []
        )

        # Period returns
        period_returns = compute_period_returns(portfolio_returns_series)

        # Correlation matrix + rolling + avg pairwise
        corr_matrix = compute_correlation_matrix(dict(strategy_returns))
        rolling_corr = compute_rolling_correlation(dict(strategy_returns))
        avg_pairwise_corr = compute_avg_pairwise_correlation(corr_matrix)

        # Risk decomposition + attribution
        ordered_sids = list(df.columns)
        ordered_weights = [weights.get(sid, 0) for sid in ordered_sids]

        # Covariance matrix for risk decomposition.
        #
        # NEW-C19-04: gate on OVERLAP (dropna) rather than UNION length.
        # `df` was built with .reindex(all_dates).fillna(0), so `len(df)` is
        # the UNION of dates across all strategies — two strategies with 100
        # disjoint days each yield len(df)==200 and previously passed the >5
        # gate.  The resulting cov() off-diagonals collapse toward 0 and
        # on-diagonals dilute (numerator contains many synthetic 0-returns),
        # producing fabricated "confident" risk numbers exactly as the comment
        # above intends to prevent.
        #
        # Fix: count rows where every strategy has a real return (`dropna`),
        # and compute cov() from that overlap-only frame.  The fillna(0) `df`
        # is still used for the portfolio_returns_series weighted sum (preserving
        # existing flat-performance semantics); only the risk-decomposition
        # covariance path is tightened here.
        overlap_df = pd.DataFrame(strategy_returns).dropna()
        cov_history_sufficient = len(overlap_df) > 5
        if cov_history_sufficient:
            # Build w_arr aligned to overlap_df columns (may differ from df columns
            # if dropna removed a column — reuse ordered_sids for consistency).
            overlap_sids = list(overlap_df.columns)
            overlap_weights = [weights.get(sid, 0) for sid in overlap_sids]
            cov_matrix = overlap_df.cov().values
            risk_decomp_raw = compute_risk_decomposition(overlap_weights, cov_matrix)
            # Re-sync ordered_sids / ordered_weights to the overlap frame so
            # the risk_decomp annotation loop below iterates the right columns.
            ordered_sids = overlap_sids
            ordered_weights = overlap_weights
        else:
            cov_matrix = None
            risk_decomp_raw = []
            logger.warning(
                "portfolio %s has %d days of full overlap (<6); skipping risk decomposition",
                portfolio_id, len(overlap_df),
            )

        # Annotate risk decomposition with strategy names and weight pcts
        risk_decomp = []
        for i, rd in enumerate(risk_decomp_raw):
            sid = ordered_sids[i]
            risk_decomp.append({
                **rd,
                "strategy_id": sid,
                "strategy_name": strategy_names.get(sid, sid),
                "weight_pct": _safe_float(ordered_weights[i] * 100),
            })

        # Attribution — drop strategies that lack a TWR. Defaulting to 0.0
        # fabricated allocation_effect numbers for missing-data strategies
        # (w * (0 - portfolio_twr)) that the narrative could then pick up as
        # "driven by X" when X actually has no measured return.
        attribution_pairs = [
            (sid, w) for sid, w in zip(ordered_sids, ordered_weights)
            if sid in strategy_twrs
        ]
        if attribution_pairs:
            attr_sids = [p[0] for p in attribution_pairs]
            attr_weights = [p[1] for p in attribution_pairs]
            attr_twrs = [strategy_twrs[sid] for sid in attr_sids]
            port_twr_for_attr = portfolio_twr or 0.0
            attribution_raw = compute_attribution(attr_weights, attr_twrs, port_twr_for_attr)
        else:
            attr_sids = []
            attribution_raw = []

        attribution = []
        for i, attr in enumerate(attribution_raw):
            sid = attr_sids[i]
            attribution.append({
                **attr,
                "strategy_id": sid,
                "strategy_name": strategy_names.get(sid, sid),
            })

        # Benchmark comparison (BTC)
        benchmark_comparison = None
        benchmark_error: str | None = None
        try:
            benchmark_rets, benchmark_stale = await get_benchmark_returns("BTC")
            if benchmark_rets is not None and not benchmark_stale:
                aligned = portfolio_returns_series.reindex(benchmark_rets.index).dropna()
                b_aligned = benchmark_rets.reindex(aligned.index).dropna()
                if len(aligned) >= 30:
                    corr = _safe_float(float(aligned.corr(b_aligned)))
                    btc_twr = compute_twr((1 + b_aligned).cumprod(), [])
                    benchmark_comparison = {
                        "symbol": "BTC",
                        "correlation": corr,
                        "benchmark_twr": btc_twr,
                        "portfolio_twr": portfolio_twr,
                        "stale": benchmark_stale,
                    }
        except asyncio.CancelledError:
            # Don't swallow cancellation — propagate.
            raise
        except Exception as exc:
            # Narrowed via re-raise above. Log with exc_info so traceback
            # lands in Sentry; persist a sentinel so the UI can distinguish
            # "fetch failed" from "no benchmark overlap".
            benchmark_error = f"{type(exc).__name__}: {exc}"
            logger.exception(
                "Benchmark fetch failed for portfolio %s: %s",
                portfolio_id, exc,
            )

        # Portfolio equity curve
        cumulative = (1 + portfolio_returns_series).cumprod()
        portfolio_equity_curve = _series_to_curve(cumulative)

        # Total AUM — only meaningful when every strategy reports AUM. A
        # mix of $0 reporters and NULLs would otherwise collapse to None and
        # be indistinguishable from "no strategies" / "all missing".
        aum_known_count = sum(1 for sid in strategy_ids if sid in strategy_aum)
        if aum_known_count == len(strategy_ids):
            total_aum = sum(strategy_aum.get(sid, 0) for sid in strategy_ids) or 0.0
        else:
            total_aum = None  # at least one strategy has NULL AUM

        # Portfolio-level sharpe and volatility. Track WHY the metric is None
        # so the dashboard can show the right empty-state instead of conflating
        # "insufficient history" with "flat vol" with "broken compute".
        vol, _mean_ret, sharpe, sharpe_status = _compute_sharpe_and_vol(portfolio_returns_series)
        vol_status = "insufficient_history" if sharpe_status == "insufficient_history" else "ok"

        running_max = cumulative.cummax()
        drawdown = (cumulative - running_max) / running_max
        max_drawdown = _safe_float(float(drawdown.min()))

        # Narrative — pass enriched payload for monthly breakdown + optimizer sentence
        analytics_payload: dict = {
            "return_mtd": period_returns.get("return_mtd"),
            "avg_pairwise_correlation": avg_pairwise_corr,
            "attribution_breakdown": attribution,
            "risk_decomposition": risk_decomp,
            "portfolio_sharpe": sharpe,
        }

        # Attempt to add monthly returns for per-month narrative breakdown.
        # Monthly returns are computed per-strategy in strategy_analytics; for the
        # portfolio-level narrative we build a weighted monthly return from the
        # daily portfolio returns series.
        #
        # audit-2026-05-07 L-0046 — algorithm + dedupe semantics live in
        # `_build_monthly_returns`. Extracted so the router and the
        # regression tests share a single source of truth (Rule 9).
        try:
            analytics_payload["monthly_returns"] = _build_monthly_returns(
                portfolio_returns_series
            )
        except (AttributeError, ValueError, TypeError, ZeroDivisionError) as exc:
            # Narrowed catch: only expected build errors. Unexpected exceptions
            # (e.g. KeyError on a renamed column) bubble up to the outer handler
            # so we don't silently mask schema drift.
            logger.warning(
                "monthly_returns build failed for %s: %s",
                portfolio_id, exc, exc_info=True,
            )

        # Attach optimizer suggestions from last completed analytics (if any)
        try:
            prev_analytics = supabase.table("portfolio_analytics").select(
                "optimizer_suggestions"
            ).eq("portfolio_id", portfolio_id).eq(
                "computation_status", ComputationStatus.COMPLETE.value
            ).order("computed_at", desc=True).limit(1).execute()
            if prev_analytics.data and prev_analytics.data[0].get("optimizer_suggestions"):
                analytics_payload["optimizer_suggestions"] = prev_analytics.data[0]["optimizer_suggestions"]
        except Exception as exc:
            # Optimizer sentence is best-effort, but we MUST surface the failure
            # in logs so transient Supabase issues don't silently drop the
            # narrative recommendation. Project memory: monthly_returns swallow
            # was the exact pattern flagged by silent-failure-hunter.
            logger.warning(
                "optimizer_suggestions fetch failed for %s: %s",
                portfolio_id, exc, exc_info=True,
            )

        # NEW-C19-08: compute partial_data BEFORE generating the narrative so
        # generate_narrative can prepend a hedge when the figures were derived
        # from a renormalized subset.  This must stay above the data_quality
        # dict construction so partial_data is available for both uses.
        partial_data = bool(
            missing_analytics_sids or missing_returns_sids or missing_equity_sids
            or benchmark_error or not cov_history_sufficient
        )

        # Pass partial_data context so the narrative discloses that numbers
        # are subset-derived when relevant (audit NEW-C19-08).
        analytics_payload["partial_data"] = partial_data
        analytics_payload["computed_strategy_count"] = len(strategy_returns)
        analytics_payload["expected_strategy_count"] = len(strategy_ids)

        narrative = generate_narrative(analytics_payload)

        # Partial-data telemetry. Tracks WHY a dashboard might look smaller
        # than expected so operators can tell "renormalized to subset" apart
        # from "all strategies reported in full".
        # `dropped_for_renormalize` was previously computed here as
        # (missing_analytics_sids ∪ missing_returns_sids); the two lists
        # already cover every drop reason so the union is redundant.
        # (partial_data already computed above for the narrative path.)
        data_quality = {
            "partial_data": partial_data,
            "expected_strategy_count": len(strategy_ids),
            "computed_strategy_count": len(strategy_returns),
            "missing_analytics_sids": missing_analytics_sids,
            "missing_returns_sids": missing_returns_sids,
            "missing_equity_sids": missing_equity_sids,
            "dropped_weight_total": _safe_float(dropped_weight_total),
            "vol_status": vol_status,
            "sharpe_status": sharpe_status,
            "cov_history_sufficient": cov_history_sufficient,
            "benchmark_error": benchmark_error,
            "matching_status": None,  # populated only on verify_strategy
        }

        # Persist results
        update_payload = sanitize_metrics({
            "computation_status": ComputationStatus.COMPLETE.value,
            "computation_error": None,
            "total_aum": total_aum,
            "total_return_twr": portfolio_twr,
            "portfolio_sharpe": sharpe,
            "portfolio_volatility": _safe_float(vol),
            "portfolio_max_drawdown": max_drawdown,
            "avg_pairwise_correlation": avg_pairwise_corr,
            "return_24h": period_returns.get("return_24h"),
            "return_mtd": period_returns.get("return_mtd"),
            "return_ytd": period_returns.get("return_ytd"),
            "narrative_summary": narrative,
            "correlation_matrix": corr_matrix,
            "attribution_breakdown": attribution,
            "risk_decomposition": risk_decomp,
            "benchmark_comparison": benchmark_comparison,
            "portfolio_equity_curve": portfolio_equity_curve,
            "rolling_correlation": rolling_corr,
            "data_quality": data_quality,
        })

        supabase.table("portfolio_analytics").update(update_payload).eq(
            "id", analytics_id
        ).execute()

        # Generate alerts. Wrapped in its own try so an alert-side failure
        # (review SFH-3) cannot demote a successfully-COMPLETE analytics
        # row back to FAILED: by the time we get here the row is persisted
        # as COMPLETE above, and the user-visible analytics are correct.
        # Alerts are best-effort secondary signals.
        # NOTE (red-team RT-4): silencing the alert failure at the wire
        # level means monitoring must watch service logs for
        # "Alert generation failed" rather than relying on the response
        # 5xx rate. The logger.exception() below ensures the failure is
        # visible to log aggregators.
        try:
            _generate_alerts(
                supabase,
                portfolio_id,
                max_drawdown,
                avg_pairwise_corr,
                rolling_corr=rolling_corr,
                attribution=attribution,
                risk_decomp=risk_decomp,
            )
        except Exception as alert_exc:
            logger.exception(
                "Alert generation failed for portfolio %s (analytics row "
                "remains COMPLETE): %s",
                portfolio_id, alert_exc,
            )

        return {"analytics_id": analytics_id, **update_payload}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Portfolio analytics computation failed for %s: %s",
            portfolio_id,
            str(exc),
            exc_info=True,
        )
        # Persist the exception class + truncated message so operators
        # can identify the root cause from the row alone, without having
        # to cross-reference Sentry by timestamp. Project memory KPI-17
        # saga (PRs #95-#100) flagged this exact debug-the-DB-row need.
        # _fail() itself can raise if Supabase is down — catch and log
        # (review CR-7) so the original computation exception isn't
        # masked by a subsequent infra error.
        try:
            _fail(f"{type(exc).__name__}: {str(exc)[:400]}")
        except Exception as fail_exc:
            logger.exception(
                "Failed to mark portfolio %s analytics row FAILED (row may "
                "be stuck in 'computing'; cron reaper will recover): %s",
                portfolio_id, fail_exc,
            )
        raise HTTPException(status_code=500, detail="Portfolio analytics computation failed")


def _generate_alerts(
    supabase,
    portfolio_id: str,
    max_drawdown: float | None,
    avg_pairwise_corr: float | None,
    rolling_corr: dict | None = None,
    attribution: list | None = None,
    risk_decomp: list | None = None,
    strategy_returns: dict | None = None,
) -> None:
    """Insert portfolio alerts for threshold breaches.

    Original rules: drawdown > 10%, correlation spike > 0.7.
    Sprint 4 additions: regime_shift, underperformance, concentration_creep.
    Sprint 5 addition: rebalance_drift (Task 5.4) with its own select-then-
    insert path because dedup is per (portfolio, strategy, UTC-week) rather
    than per (portfolio, alert_type).

    Uses select-then-insert per alert type. The partial unique index
    `portfolio_alerts_dedup_unacked` (migration 042, carved in 050 to
    exclude rebalance_drift) and the concurrent weekly index
    `portfolio_alerts_rebalance_drift_weekly` (migration 051) act as
    DB-level safety nets for any races.

    NOTE: `sync_failure` alerts are NOT generated here. They are inserted
    by `run_reconcile_strategy_job` in services/job_worker.py, which has
    the reconciliation diff in hand and knows which portfolios hold the
    affected strategy. See Sprint 5 Task 5.1b and migration 046.
    """
    alerts = []

    if max_drawdown is not None and max_drawdown < _DRAWDOWN_ALERT_THRESHOLD:
        severity = (
            AlertSeverity.HIGH.value
            if max_drawdown < _DRAWDOWN_HIGH_SEVERITY_THRESHOLD
            else AlertSeverity.MEDIUM.value
        )
        alerts.append({
            "portfolio_id": portfolio_id,
            "alert_type": AlertType.DRAWDOWN.value,
            "severity": severity,
            "message": f"Portfolio drawdown has reached {max_drawdown * 100:.1f}%.",
        })

    if avg_pairwise_corr is not None and avg_pairwise_corr > _CORRELATION_SPIKE_THRESHOLD:
        alerts.append({
            "portfolio_id": portfolio_id,
            "alert_type": AlertType.CORRELATION_SPIKE.value,
            "severity": AlertSeverity.MEDIUM.value,
            "message": (
                f"Average pairwise correlation is {avg_pairwise_corr:.2f}. "
                "Portfolio diversification may be insufficient."
            ),
        })

    # ── Sprint 4: regime_shift ──────────────────────────────────────
    # Fires when the rolling correlation delta between the most recent and
    # prior window exceeds _REGIME_SHIFT_DELTA_THRESHOLD for any strategy pair.
    if rolling_corr:
        window = 5
        best_delta = 0.0
        best_recent = 0.0
        best_prior = 0.0
        for series in rolling_corr.values():
            if not isinstance(series, list) or len(series) < window * 2:
                continue
            recent_raw = [p["value"] if isinstance(p, dict) else p for p in series[-window:]]
            prior_raw = [p["value"] if isinstance(p, dict) else p for p in series[-window * 2:-window]]
            # _safe_float returns None for NaN at the rolling-window leading
            # edge; sum([None, ...]) crashes. Filter before averaging so a
            # transient leading-NaN doesn't propagate up through _generate_alerts
            # and starve sibling alert types in the same call.
            recent_vals = [x for x in recent_raw if x is not None]
            prior_vals = [x for x in prior_raw if x is not None]
            if not recent_vals or not prior_vals:
                continue
            recent_avg = sum(recent_vals) / len(recent_vals)
            prior_avg = sum(prior_vals) / len(prior_vals)
            delta = abs(recent_avg - prior_avg)
            if delta > best_delta:
                best_delta = delta
                best_recent = recent_avg
                best_prior = prior_avg
        if best_delta > _REGIME_SHIFT_DELTA_THRESHOLD:
            direction = "tightened" if best_recent > best_prior else "loosened"
            alerts.append({
                "portfolio_id": portfolio_id,
                "alert_type": AlertType.REGIME_SHIFT.value,
                "severity": AlertSeverity.MEDIUM.value,
                "message": (
                    f"Correlation regime shift detected: pairwise correlation "
                    f"{direction} from {best_prior:.2f} to {best_recent:.2f} (delta {best_delta:.2f})."
                ),
            })

    # ── Sprint 4: underperformance ──────────────────────────────────
    # Fires when the worst strategy trails the portfolio average contribution
    # by more than 1 standalone-vol band.
    if attribution and risk_decomp and len(attribution) >= 2:
        vol_by_sid = {r["strategy_id"]: r.get("standalone_vol", 0) for r in risk_decomp}
        avg_contribution = sum(a.get("contribution", 0) for a in attribution) / len(attribution)
        sorted_attr = sorted(attribution, key=lambda a: a.get("contribution", 0))
        worst = sorted_attr[0]
        band = vol_by_sid.get(worst.get("strategy_id", ""), 0.01)
        threshold = band if band > 0 else 0.01
        trail_distance = avg_contribution - worst.get("contribution", 0)
        if trail_distance > threshold:
            second = sorted_attr[1] if len(sorted_attr) > 1 else None
            if not second or (
                second.get("contribution", 0) - worst.get("contribution", 0)
            ) >= _UNDERPERFORMANCE_GAP_THRESHOLD:
                alerts.append({
                    "portfolio_id": portfolio_id,
                    "alert_type": AlertType.UNDERPERFORMANCE.value,
                    "severity": AlertSeverity.MEDIUM.value,
                    "message": (
                        f"{worst.get('strategy_name', 'Unknown')} is trailing the portfolio "
                        f"baseline by {abs(trail_distance) * 100:.2f}% over the trailing window."
                    ),
                })

    # ── Sprint 4: concentration_creep ───────────────────────────────
    # Fires when any strategy weight exceeds _CONCENTRATION_MULTIPLIER × the
    # equal-weight baseline (only meaningful with 3+ strategies).
    if risk_decomp and len(risk_decomp) >= 3:
        equal_weight = 100.0 / len(risk_decomp)
        top = max(risk_decomp, key=lambda r: r.get("weight_pct", 0))
        if top.get("weight_pct", 0) >= equal_weight * _CONCENTRATION_MULTIPLIER:
            alerts.append({
                "portfolio_id": portfolio_id,
                "alert_type": AlertType.CONCENTRATION_CREEP.value,
                "severity": AlertSeverity.LOW.value,
                "message": (
                    f"{top.get('strategy_name', 'Unknown')} is {top['weight_pct']:.0f}% "
                    f"of the portfolio (equal-weight baseline is {equal_weight:.0f}%)."
                ),
            })

    if alerts:
        # Audit H-1073: batch the dedup SELECT into one query so we do
        # at most 1 SELECT + N INSERTs per portfolio compute instead of
        # N SELECT + N INSERT. PostgREST upsert can't reference the
        # PARTIAL unique index (WHERE acknowledged_at IS NULL), so true
        # ON CONFLICT DO NOTHING isn't reachable from supabase-py; the
        # partial unique index from migration 042 still acts as the
        # DB-level race guard.
        alert_types_to_check = list({a["alert_type"] for a in alerts})
        try:
            existing_resp = supabase.table("portfolio_alerts").select(
                "alert_type"
            ).eq(
                "portfolio_id", portfolio_id
            ).in_(
                "alert_type", alert_types_to_check
            ).is_(
                "acknowledged_at", "null"
            ).execute()
            existing_types = {row["alert_type"] for row in (existing_resp.data or [])}
        except Exception as exc:
            # If the dedup probe fails we must not silently skip alerts —
            # fall back to per-alert select-then-insert to preserve the
            # delivery contract.
            logger.warning(
                "portfolio_alerts batch dedup probe failed for %s: %s; "
                "falling back to per-alert select",
                portfolio_id, exc,
            )
            existing_types = None

        for alert in alerts:
            try:
                if existing_types is None:
                    existing = supabase.table("portfolio_alerts").select("id").eq(
                        "portfolio_id", alert["portfolio_id"]
                    ).eq(
                        "alert_type", alert["alert_type"]
                    ).is_(
                        "acknowledged_at", "null"
                    ).limit(1).execute()
                    if existing.data:
                        continue
                elif alert["alert_type"] in existing_types:
                    continue  # already have an unacked alert of this type
                supabase.table("portfolio_alerts").insert(alert).execute()
            except Exception as exc:
                logger.warning(
                    "Failed to insert %s alert for %s: %s",
                    alert.get("alert_type"), portfolio_id, exc,
                )

    # ── Sprint 5 Task 5.4: rebalance_drift ─────────────────────────────
    # Handled on its own because dedup is weekly per (portfolio, strategy),
    # not per (portfolio, alert_type). Kept AFTER the generic loop so a
    # Supabase failure in this block can't starve the other alerts.
    _generate_rebalance_drift_alert(supabase, portfolio_id)


def _generate_rebalance_drift_alert(supabase, portfolio_id: str) -> None:
    """Fire a rebalance_drift alert for the strategy with the largest drift > 5%.

    Two-layer safety against alert storms:
      1. Honeymoon: skip when portfolio age < 7 days.
      2. Null-target guard: skip strategies whose latest weight_snapshots
         target_weight is NULL. NULL is explicit ("not yet set"), not 0.

    Weekly dedup: at most one unacked alert per (portfolio, strategy, UTC
    week). Enforced in the query below and defended at the DB layer by
    the partial unique index from migration 051.

    Severity: drift > 10% → high; 5-10% → medium.

    Swallows all exceptions — alert generation is best-effort; a failure
    here must NOT break the analytics write that already succeeded above.
    """
    try:
        # Portfolio age → honeymoon guard
        portfolio_row = supabase.table("portfolios").select(
            "created_at"
        ).eq("id", portfolio_id).single().execute()
        if not portfolio_row.data:
            return
        created_at_str = portfolio_row.data.get("created_at")
        if not created_at_str:
            return
        created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        age_days = (datetime.now(timezone.utc) - created_at).days
        if age_days < 7:
            return

        # Latest weight_snapshots row per strategy for this portfolio
        ws_rows = supabase.table("weight_snapshots").select(
            "strategy_id, target_weight, actual_weight, snapshot_date"
        ).eq("portfolio_id", portfolio_id).order(
            "snapshot_date", desc=True
        ).execute()
        if not ws_rows.data:
            return

        # Keep most recent per strategy. Rows come back ordered DESC.
        seen: set[str] = set()
        latest: list[dict] = []
        for row in ws_rows.data:
            sid = row.get("strategy_id")
            if sid in seen:
                continue
            seen.add(sid)
            latest.append(row)

        # Strategy names for the sentence
        strategy_ids = [row["strategy_id"] for row in latest]
        strat_rows = supabase.table("strategies").select(
            "id, name"
        ).in_("id", strategy_ids).execute()
        name_by_id = {
            r["id"]: r.get("name") or r["id"] for r in (strat_rows.data or [])
        }

        # Find worst-drift strategy with both values present
        worst: dict | None = None
        for row in latest:
            target = row.get("target_weight")
            actual = row.get("actual_weight")
            if target is None or actual is None:
                continue
            drift = abs(float(actual) - float(target))
            if worst is None or drift > worst["drift"]:
                worst = {
                    "strategy_id": row["strategy_id"],
                    "target": float(target),
                    "actual": float(actual),
                    "drift": drift,
                }

        if worst is None or worst["drift"] <= _REBALANCE_DRIFT_THRESHOLD:
            return

        # Weekly dedup check: any unacked rebalance_drift for this
        # (portfolio, strategy) inside the current UTC ISO week?
        # Postgres `date_trunc('week', ...)` starts Monday 00:00 UTC.
        now = datetime.now(timezone.utc)
        # ISO week: Monday is weekday()==0
        week_start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        existing = supabase.table("portfolio_alerts").select("id").eq(
            "portfolio_id", portfolio_id
        ).eq(
            "strategy_id", worst["strategy_id"]
        ).eq(
            "alert_type", AlertType.REBALANCE_DRIFT.value
        ).is_(
            "acknowledged_at", "null"
        ).gte(
            "triggered_at", _to_utc_iso(week_start)
        ).limit(1).execute()
        if existing.data:
            return

        severity = (
            AlertSeverity.HIGH.value
            if worst["drift"] > _REBALANCE_DRIFT_HIGH_THRESHOLD
            else AlertSeverity.MEDIUM.value
        )
        strategy_name = name_by_id.get(worst["strategy_id"], worst["strategy_id"])
        message = (
            f"{strategy_name}'s weight is {worst['actual'] * 100:.0f}% "
            f"(target {worst['target'] * 100:.0f}%) — consider rebalancing."
        )

        try:
            supabase.table("portfolio_alerts").insert({
                "portfolio_id": portfolio_id,
                "strategy_id": worst["strategy_id"],
                "alert_type": AlertType.REBALANCE_DRIFT.value,
                "severity": severity,
                "message": message,
                "metadata": {
                    "target_weight": worst["target"],
                    "actual_weight": worst["actual"],
                    "drift": worst["drift"],
                },
            }).execute()
        except Exception as exc:
            # The DB-side weekly unique index (migration 051) is the
            # authoritative race guard. Narrow the swallow to the
            # unique_violation case only — anything else (RLS / FK / etc.)
            # is a real failure that must surface to the outer catch and
            # the caller's logs.
            code = getattr(exc, "code", None)
            msg = str(exc)
            if code == "23505" or "23505" in msg or "duplicate key" in msg.lower():
                logger.warning(
                    "rebalance_drift dedup race for %s: %s",
                    portfolio_id, exc,
                )
            else:
                raise
    except Exception as exc:
        logger.warning(
            "rebalance_drift alert generation failed for %s: %s",
            portfolio_id, exc,
        )


# ---------------------------------------------------------------------------
# Endpoint 1: POST /api/portfolio-analytics
# ---------------------------------------------------------------------------

@router.post("/portfolio-analytics", response_model=PortfolioAnalyticsResponse)
@limiter.limit("10/hour")
async def portfolio_analytics(request: Request, req: PortfolioAnalyticsRequest):
    """Compute full portfolio analytics for a given portfolio."""
    supabase = get_supabase()

    # NEW-C19-01: verify portfolio exists AND belongs to the requesting user.
    # The service-role client bypasses RLS; without this ownership filter any
    # X-Service-Key holder could compute analytics on another tenant's portfolio.
    # Same pattern as the bridge endpoint's L-0047 ownership SELECT.
    portfolio_result = supabase.table("portfolios").select("id").eq(
        "id", req.portfolio_id
    ).eq("user_id", req.user_id).single().execute()

    if not portfolio_result.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Concurrency guard: acquire semaphore first, then check for in-flight row.
    # Ordering matters: check inside the semaphore prevents a TOCTOU window where
    # two concurrent requests both pass the check before either INSERT runs.
    async with _compute_semaphore:
        in_flight = supabase.table("portfolio_analytics").select("id").eq(
            "portfolio_id", req.portfolio_id
        ).eq("computation_status", ComputationStatus.COMPUTING.value).limit(1).execute()

        if in_flight.data:
            raise HTTPException(
                status_code=409,
                detail="Analytics computation already in progress for this portfolio",
            )

        result = await _compute_portfolio_analytics(req.portfolio_id)

    # Audit C-0216: previously this handler discarded the full update_payload
    # spread, returning only {status, portfolio_id, analytics_id}. Callers that
    # expected inline metrics (mirroring verify-strategy's response shape) got
    # nothing back and had no signal to poll separately. We now surface the
    # full sanitized payload inline so callers can render without an extra
    # round-trip; analytics_id is preserved for cache-key purposes.
    return {
        "ok": True,
        "status": "complete",
        "portfolio_id": req.portfolio_id,
        **result,
    }


# ---------------------------------------------------------------------------
# Endpoint 2: POST /api/portfolio-optimizer
# ---------------------------------------------------------------------------

_OPTIMIZER_PUBLISHED_LIMIT = 200  # max published strategies pulled per optimizer run


@router.post("/portfolio-optimizer", response_model=PortfolioOptimizerResponse)
@limiter.limit("10/hour")
async def portfolio_optimizer(request: Request, req: PortfolioOptimizerRequest):
    """Find diversification candidates for a portfolio.

    Audit 2026-05-07 hardening:
      - req.weights is now Dict[str, float] with NaN/Inf/negative rejected
        at the Pydantic layer (PortfolioOptimizerRequest._validate_weights).
      - Phantom keys (not in the portfolio's strategy_ids) are dropped
        with a warning so the optimizer math doesn't operate on injected
        ghost strategies.
      - Published-strategy pool is capped at _OPTIMIZER_PUBLISHED_LIMIT
        to bound memory + PostgREST payload size.
      - optimizer_suggestions is stored against the LATEST analytics row
        only when one exists; the absence of a row is now logged so the
        response-only fallback doesn't hide silently (M-0617).
      - When portfolio.user_id is NULL the audit emission still happens
        under a sentinel ('unknown-owner') so the run is never silently
        unaudited (M-0623).
    """
    supabase = get_supabase()

    # NEW-C19-01: verify portfolio exists AND belongs to the requesting user.
    # Without the .eq("user_id", req.user_id) filter this endpoint used to do
    # a pure existence check — any X-Service-Key holder could pass an arbitrary
    # portfolio_id and also issue an in-place UPDATE of another tenant's
    # optimizer_suggestions (attribution forgery + cross-tenant write).
    # The fix mirrors the bridge endpoint's L-0047 pattern.
    # NOTE: portfolio_owner_id is captured from the row so the audit below
    # can attribute under the portfolio's real owner; req.user_id is the value
    # verified by the ownership SELECT.
    portfolio_result = supabase.table("portfolios").select("id, user_id").eq(
        "id", req.portfolio_id
    ).eq("user_id", req.user_id).single().execute()

    if not portfolio_result.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    portfolio_owner_id = portfolio_result.data.get("user_id")

    ps_result = supabase.table("portfolio_strategies").select(
        "strategy_id, current_weight"
    ).eq("portfolio_id", req.portfolio_id).execute()

    portfolio_strategies = ps_result.data or []
    if not portfolio_strategies:
        raise HTTPException(status_code=400, detail="No strategies found in portfolio")

    strategy_ids = [row["strategy_id"] for row in portfolio_strategies]

    weights = _build_normalized_weights(portfolio_strategies)

    # Override weights from request if provided. Phantom keys (not in the
    # portfolio's strategy_ids) are dropped — the pre-audit code silently
    # added them to the weight vector, which let any service-key holder
    # corrupt the score matrix.
    if req.weights:
        portfolio_sids = set(strategy_ids)
        phantom = [k for k in req.weights if k not in portfolio_sids]
        if phantom:
            logger.warning(
                "portfolio_optimizer: dropping %d phantom weight keys for %s: %s",
                len(phantom), req.portfolio_id, phantom,
            )
        scoped = {k: v for k, v in req.weights.items() if k in portfolio_sids}
        weights.update(scoped)
        # Renormalize so injected weights can't unbalance the vector.
        total = sum(weights.values()) or 1.0
        weights = {sid: w / total for sid, w in weights.items()}

    sa_in_result = supabase.table("strategy_analytics").select(
        "strategy_id, returns_series"
    ).in_("strategy_id", strategy_ids).execute()

    portfolio_returns: dict[str, pd.Series] = {}
    optimizer_missing_returns_sids: list[str] = []
    optimizer_fetched_sids: set[str] = set()
    for row in (sa_in_result.data or []):
        optimizer_fetched_sids.add(row["strategy_id"])
        s = _records_to_series(row.get("returns_series"), name=row["strategy_id"])
        if s is not None:
            portfolio_returns[row["strategy_id"]] = s
        else:
            optimizer_missing_returns_sids.append(row["strategy_id"])

    # NEW-C19-09: log dropped strategies at WARNING parity with the analytics path.
    # find_improvement_candidates builds port_df from portfolio_returns (dropna),
    # so any strategy without a returns_series silently vanishes from the weight
    # vector and scores are computed against a renormalized subset.
    optimizer_missing_analytics_sids = [
        sid for sid in strategy_ids if sid not in optimizer_fetched_sids
    ]
    if optimizer_missing_returns_sids:
        logger.warning(
            "portfolio_optimizer: %d/%d portfolio strategies missing returns_series "
            "for portfolio %s; scores computed against subset: %s",
            len(optimizer_missing_returns_sids), len(strategy_ids),
            req.portfolio_id, optimizer_missing_returns_sids,
        )
    if optimizer_missing_analytics_sids:
        logger.warning(
            "portfolio_optimizer: %d/%d portfolio strategies missing analytics rows "
            "for portfolio %s: %s",
            len(optimizer_missing_analytics_sids), len(strategy_ids),
            req.portfolio_id, optimizer_missing_analytics_sids,
        )
    optimizer_computed_strategy_count = len(portfolio_returns)
    optimizer_expected_strategy_count = len(strategy_ids)

    if not portfolio_returns:
        raise HTTPException(status_code=400, detail="No returns data available for portfolio strategies")

    # NEW-C19-10 (design decision confirmation): pulling published strategies
    # for the optimizer/bridge candidate pool exposes co-movement information
    # (correlation/sharpe scores) derived from other authors' return series.
    # CONFIRMED INTENT: `status='published'` is the marketplace-visible state —
    # by publishing, a strategy manager explicitly makes their strategy
    # discoverable and scoreable by allocators (the match engine, bridge, and
    # optimizer all use this same pool).  Only id/name are selected here; the
    # raw returns_series are fetched separately from strategy_analytics and
    # NEVER returned to the caller — only derived numeric scores (sharpe_lift,
    # corr_with_portfolio, score) are emitted.  These scores do not allow
    # reconstruction of the underlying return series.  This is the intended
    # behavior; no additional scoping is required.
    # If a future "unlisted but published" visibility tier is introduced, scope
    # this SELECT by that predicate (e.g. `.eq("is_listed", True)`).
    all_published = supabase.table("strategies").select("id, name").eq(
        "status", "published"
    ).not_.in_("id", strategy_ids).order(
        "created_at", desc=True
    ).limit(_OPTIMIZER_PUBLISHED_LIMIT).execute()

    candidate_rows = all_published.data or []
    candidate_ids = [row["id"] for row in candidate_rows]
    candidate_names = {row["id"]: row.get("name", row["id"]) for row in candidate_rows}

    candidate_returns: dict[str, pd.Series] = {}
    if candidate_ids:
        sa_cand_result = supabase.table("strategy_analytics").select(
            "strategy_id, returns_series"
        ).in_("strategy_id", candidate_ids).execute()

        for row in (sa_cand_result.data or []):
            s = _records_to_series(row.get("returns_series"), name=row["strategy_id"])
            if s is not None:
                candidate_returns[row["strategy_id"]] = s

    suggestions = find_improvement_candidates(portfolio_returns, candidate_returns, weights)
    # Hydrate suggestions with strategy names so the UI can render them without an extra round-trip.
    for s in suggestions:
        s["strategy_name"] = candidate_names.get(s["strategy_id"], s["strategy_id"])

    latest = supabase.table("portfolio_analytics").select("id").eq(
        "portfolio_id", req.portfolio_id
    ).eq("computation_status", ComputationStatus.COMPLETE.value).order("computed_at", desc=True).limit(1).execute()

    persisted = False
    if latest.data:
        # @audit-skip: internal cache write (optimizer_suggestions is
        # denormalized onto the most recent portfolio_analytics row for
        # the UI to read in one fetch). User-intent audit emitted below
        # after the compute completes.
        #
        # NOTE: This is an in-place UPDATE of an append-only snapshot. The
        # ideal fix (H-0573) is to INSERT a new portfolio_analytics row
        # carrying optimizer_suggestions, but that requires a schema-level
        # decision (recompute the full payload? mark as derivative?) that
        # is out of scope for the audit-2026-05-07 router pass. We keep
        # the UPDATE here for now but explicitly log the override so the
        # audit trail isn't silent about the mutation.
        logger.info(
            "portfolio_optimizer: in-place suggestions override on analytics_id=%s "
            "(portfolio=%s, suggestion_count=%d). H-0573 follow-up tracks the "
            "append-only redesign.",
            latest.data[0]["id"], req.portfolio_id, len(suggestions),
        )
        supabase.table("portfolio_analytics").update(
            {"optimizer_suggestions": suggestions}
        ).eq("id", latest.data[0]["id"]).execute()
        persisted = True
    else:
        # Surface the no-completed-analytics no-op explicitly. The previous
        # code silently returned suggestions that vanished on page reload.
        logger.warning(
            "portfolio_optimizer: no completed analytics row for %s; "
            "suggestions returned response-only (will not persist)",
            req.portfolio_id,
        )

    # Sprint 6 Task 7.1b — audit the optimizer run. entity is the
    # portfolio the optimizer ran against. user_id is the portfolio
    # owner (resolved via the portfolios row above). When user_id is
    # NULL we still emit under a sentinel so the run isn't silently
    # unaudited (audit-2026-05-07 M-0623).
    audit_user_id = portfolio_owner_id or "00000000-0000-0000-0000-000000000000"
    if not portfolio_owner_id:
        logger.warning(
            "portfolio_optimizer: portfolio %s has NULL user_id; "
            "auditing under sentinel actor",
            req.portfolio_id,
        )
    optimizer_partial_data = optimizer_computed_strategy_count < optimizer_expected_strategy_count
    log_audit_event(
        user_id=audit_user_id,
        action="optimizer.run",
        entity_type="optimizer_run",
        entity_id=req.portfolio_id,
        metadata={
            "suggestion_count": len(suggestions),
            "owner_resolved": bool(portfolio_owner_id),
            "persisted": persisted,
            # NEW-C19-09: surface coverage signal in the audit trail so ops
            # can see when suggestions were computed against a subset.
            "computed_strategy_count": optimizer_computed_strategy_count,
            "expected_strategy_count": optimizer_expected_strategy_count,
            "partial_data": optimizer_partial_data,
        },
    )

    return {
        "ok": True,
        "status": "complete",
        "portfolio_id": req.portfolio_id,
        "suggestions": suggestions,
        "persisted": persisted,
        # NEW-C19-09: surface partial_data so the UI/caller can show a badge
        # when suggestions were scored against fewer strategies than expected.
        "computed_strategy_count": optimizer_computed_strategy_count,
        "expected_strategy_count": optimizer_expected_strategy_count,
        "partial_data": optimizer_partial_data,
    }


# ---------------------------------------------------------------------------
# Endpoint 3: POST /api/portfolio-bridge
# ---------------------------------------------------------------------------

@router.post("/portfolio-bridge", response_model=PortfolioBridgeResponse)
@limiter.limit("10/hour")
async def portfolio_bridge(request: Request, req: BridgeRequest):
    """Find replacement candidates for an underperforming strategy (Bridge V1).

    Uses REPLACE scoring: removes the incumbent, redistributes its weight,
    and scores each published candidate in that slot. Returns allocator-safe
    payload (no admin internals, no profile data).

    Trust boundary (audit-2026-05-07 L-0047):
      * req.user_id is supplied by the Next.js caller in the request
        body, NOT verified by this service. The X-Service-Key middleware
        authenticates the CALLER (Next.js), not the END USER.
      * The .eq("user_id", req.user_id) filter on the portfolios SELECT
        below is the ONLY defense — a mismatched user_id 404s the request
        immediately because `.single()` on an empty result raises.
      * If the service key ever leaks (committed in .env, captured from
        CI logs) or if a future caller besides /api/bridge starts
        calling this endpoint, the attacker can pass any user_id and
        portfolio_id pair that line up in the DB. The trust assumption
        is "the X-Service-Key holder is honest about user_id". An
        eventual fix requires forwarding the user's Supabase JWT and
        validating it in the FastAPI middleware before populating
        req.user_id from the verified `sub` claim.
      * test_routers_audit_2026_05_17.py
        ::test_portfolio_bridge_rejects_mismatched_user_id pins the
        404 promise so a refactor cannot silently drop the .eq filter.
    """
    from services.bridge_scoring import find_replacement_candidates

    supabase = get_supabase()

    # Verify portfolio exists AND belongs to the requesting user.
    # Defense-in-depth: Next.js layer already checks ownership, but the Python
    # service uses a service-role client that bypasses RLS. This closes the gap
    # if the service is ever reachable from another path.
    #
    # audit-2026-05-07 red-team (MED conf 8) — ownership SELECT MUST run
    # BEFORE `_check_bridge_user_rate`. Pre-fix the rate-limit check ran
    # first, so an attacker-supplied (forged or unauthenticated) user_id
    # appended a fresh entry to `_bridge_user_attempts` PER REQUEST. With
    # CACHE_MAX=10k, an attacker rotating uuids could fully turn over the
    # dict and silently evict every legitimate user's bucket — combined
    # with the LRU-eviction-bypass red-team finding above, this gave a
    # vector to disable the per-user limiter entirely. Running the
    # ownership SELECT first 404s any user_id that doesn't actually own a
    # portfolio in this DB, so only DB-validated user_ids can ever reach
    # the limiter and consume a cache slot.
    portfolio_result = supabase.table("portfolios").select("id").eq(
        "id", req.portfolio_id
    ).eq("user_id", req.user_id).single().execute()
    if not portfolio_result.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # audit-2026-05-07 L-0045 — per-user defense-in-depth rate limit.
    # The slowapi IP-based limit collapses to a single bucket behind
    # Next.js Vercel-functions (shared egress IPs). Without this
    # per-user cap a single noisy or hostile user can exhaust the
    # 10/hour quota for ALL users on the same IP pool. Composed with
    # the slowapi IP budget, not a replacement. Runs AFTER the
    # ownership SELECT (above) so an attacker cannot poison the
    # bucket cache with forged user_ids.
    if not _check_bridge_user_rate((req.user_id or "").strip()):
        raise HTTPException(
            status_code=429,
            detail="Too many bridge requests for this user. Try again later.",
        )

    # Verify the underperformer is actually in this portfolio
    ps_result = supabase.table("portfolio_strategies").select(
        "strategy_id, current_weight"
    ).eq("portfolio_id", req.portfolio_id).execute()

    portfolio_strategies = ps_result.data or []
    strategy_ids = [row["strategy_id"] for row in portfolio_strategies]

    if req.underperformer_strategy_id not in strategy_ids:
        raise HTTPException(
            status_code=400,
            detail="Strategy not found in this portfolio",
        )

    # Build weights
    weights = _build_normalized_weights(portfolio_strategies)

    # Fetch portfolio strategy returns
    sa_in_result = supabase.table("strategy_analytics").select(
        "strategy_id, returns_series"
    ).in_("strategy_id", strategy_ids).execute()

    portfolio_returns: dict[str, pd.Series] = {}
    bridge_missing_returns_sids: list[str] = []
    for row in (sa_in_result.data or []):
        s = _records_to_series(row.get("returns_series"), name=row["strategy_id"])
        if s is not None:
            portfolio_returns[row["strategy_id"]] = s
        else:
            bridge_missing_returns_sids.append(row["strategy_id"])

    # NEW-C19-02: track strategies that had analytics rows but no returns_series.
    # The scorer (find_replacement_candidates) builds port_df from portfolio_returns,
    # so any dropped strategy's weight silently vanishes and the candidate scores
    # are computed against a renormalized subset.  Log so the problem is visible.
    if bridge_missing_returns_sids:
        logger.warning(
            "portfolio_bridge: %d/%d portfolio strategies missing returns_series "
            "for portfolio %s; scores computed against subset: %s",
            len(bridge_missing_returns_sids), len(strategy_ids),
            req.portfolio_id, bridge_missing_returns_sids,
        )

    # Also detect strategies that had no analytics row at all.
    fetched_sids = {row["strategy_id"] for row in (sa_in_result.data or [])}
    bridge_missing_analytics_sids = [sid for sid in strategy_ids if sid not in fetched_sids]
    if bridge_missing_analytics_sids:
        logger.warning(
            "portfolio_bridge: %d/%d portfolio strategies missing analytics rows "
            "for portfolio %s: %s",
            len(bridge_missing_analytics_sids), len(strategy_ids),
            req.portfolio_id, bridge_missing_analytics_sids,
        )

    # Combined set of strategies excluded from scoring.
    bridge_all_missing_sids = bridge_missing_returns_sids + bridge_missing_analytics_sids
    bridge_partial_data = bool(bridge_all_missing_sids)

    if not portfolio_returns:
        raise HTTPException(status_code=400, detail="No returns data available")

    # NEW-C19-03: detect when the incumbent itself has no returns data.
    # Without this check, find_replacement_candidates immediately returns []
    # (incumbent not in port_df.columns) and the caller cannot distinguish
    # "genuine no-candidates" from "couldn't score — incumbent has no history".
    if req.underperformer_strategy_id not in portfolio_returns:
        return {
            "ok": True,
            "status": "incumbent_no_data",
            "portfolio_id": req.portfolio_id,
            "underperformer_strategy_id": req.underperformer_strategy_id,
            "candidates": [],
            "partial_data": True,
            "computed_from_n_of_m": f"{len(portfolio_returns)} of {len(strategy_ids)}",
        }

    # Fetch all published candidate strategies (excluding portfolio members).
    # Cap at _OPTIMIZER_PUBLISHED_LIMIT to bound the JSONB payload size as the
    # catalog grows (audit-2026-05-07 H-1072).
    # NEW-C19-10 (design decision confirmation): see the optimizer's matching
    # comment — published=marketplace-visible is the confirmed intent; only
    # derived numeric scores (composite_score, sharpe_delta, etc.) are returned,
    # never the raw return series.  No additional scoping is required until a
    # "unlisted-but-published" visibility tier is added.
    all_published = supabase.table("strategies").select("id, name").eq(
        "status", "published"
    ).not_.in_("id", strategy_ids).order(
        "created_at", desc=True
    ).limit(_OPTIMIZER_PUBLISHED_LIMIT).execute()

    candidate_rows = all_published.data or []
    candidate_ids = [row["id"] for row in candidate_rows]
    candidate_names = {row["id"]: row.get("name", row["id"]) for row in candidate_rows}

    candidate_returns: dict[str, pd.Series] = {}
    if candidate_ids:
        sa_cand_result = supabase.table("strategy_analytics").select(
            "strategy_id, returns_series"
        ).in_("strategy_id", candidate_ids).execute()

        for row in (sa_cand_result.data or []):
            s = _records_to_series(row.get("returns_series"), name=row["strategy_id"])
            if s is not None:
                candidate_returns[row["strategy_id"]] = s

    # /review follow-up (T4-I1): emit the audit event BEFORE the empty-
    # candidates fast-path. "User ran the bridge, got zero candidates"
    # is still a user-intent event worth auditing (especially for abuse
    # detection — a caller who triggers many empty-candidate runs is
    # interesting signal). We compute candidates separately below for
    # the non-empty branch; the empty branch reports candidate_count=0
    # and returns a 200 with an empty list.
    if not candidate_returns:
        # H-0815 (final): wrap the happy-path emit. log_audit_event already
        # Sentry-captures + writes a structured error log for the serious
        # classes (permission_denied / unknown) BEFORE it re-raises
        # (services/audit.py P907/P908 Branch 1 & 3), so swallowing the
        # re-raise here does NOT hide the regression from ops — it only
        # prevents one audit-path failure (e.g. an RLS regression) from
        # 500-ing EVERY successful bridge run (a total-outage risk for no added
        # visibility). Matches services/job_worker.py::_emit_audit, the
        # established "an audit drop must never fail the compute path" pattern.
        # (Transient blips are already swallowed inside the emitter; this catch
        # covers the re-raised serious classes for availability.)
        try:
            log_audit_event(
                user_id=req.user_id,
                action="bridge.score_candidates",
                entity_type="bridge_run",
                entity_id=req.portfolio_id,
                metadata={
                    "underperformer_strategy_id": req.underperformer_strategy_id,
                    "candidate_count": 0,
                    "partial_data": bridge_partial_data,
                },
            )
        except Exception as audit_exc:  # noqa: BLE001
            logger.error(
                "bridge audit emit failed (run still succeeded): %s",
                audit_exc, exc_info=True,
            )
        return {
            "ok": True,
            "status": "complete",
            "portfolio_id": req.portfolio_id,
            "underperformer_strategy_id": req.underperformer_strategy_id,
            "candidates": [],
            # NEW-C19-02: surface partial_data so the caller knows scores were
            # computed against a subset (or that there truly are no candidates).
            "partial_data": bridge_partial_data,
            "computed_from_n_of_m": f"{len(portfolio_returns)} of {len(strategy_ids)}" if bridge_partial_data else None,
        }

    candidates = find_replacement_candidates(
        portfolio_returns, candidate_returns, weights, req.underperformer_strategy_id
    )

    # Hydrate with strategy names (allocator-safe, no emails/profiles)
    for c in candidates:
        c["strategy_name"] = candidate_names.get(c["strategy_id"], c["strategy_id"])

    # Sprint 6 Task 7.1b — audit the bridge scoring. entity is the
    # portfolio the bridge was run against; user_id is carried in the
    # request shape (BridgeRequest.user_id).
    # H-0815 (final): wrap the happy-path emit — see the empty-candidates
    # branch above for the full rationale (emitter already Sentry-captures +
    # logs serious errors before re-raising; matches job_worker._emit_audit;
    # avoids a single audit-path regression 500-ing every successful run).
    try:
        log_audit_event(
            user_id=req.user_id,
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=req.portfolio_id,
            metadata={
                "underperformer_strategy_id": req.underperformer_strategy_id,
                "candidate_count": len(candidates),
                "partial_data": bridge_partial_data,
            },
        )
    except Exception as audit_exc:  # noqa: BLE001
        logger.error(
            "bridge audit emit failed (run still succeeded): %s",
            audit_exc, exc_info=True,
        )

    return {
        "ok": True,
        "status": "complete",
        "portfolio_id": req.portfolio_id,
        "underperformer_strategy_id": req.underperformer_strategy_id,
        "candidates": candidates,
        # NEW-C19-02: surface partial_data when scores were computed against
        # a renormalized subset (some strategies had no returns_series).
        "partial_data": bridge_partial_data,
        "computed_from_n_of_m": f"{len(portfolio_returns)} of {len(strategy_ids)}" if bridge_partial_data else None,
    }


# ---------------------------------------------------------------------------
# Endpoint 4: POST /api/verify-strategy
# ---------------------------------------------------------------------------

@router.post("/verify-strategy", response_model=VerifyStrategyResponse)
@limiter.limit("5/hour")
async def verify_strategy(request: Request, req: VerifyStrategyRequest):
    """Verify a strategy from exchange API keys (landing page flow).

    Phase 19 / PR-X2 (pre-BACKBONE-04 step (d)) — this endpoint no longer
    writes to ``verification_requests``. Migration 107 (the VIEW shim, PR-D)
    renames that table to ``verification_requests_legacy`` and replaces it
    with a read-only VIEW backed by ``strategy_verifications``; any INSERT
    or UPDATE here would hit the INSTEAD OF triggers and raise 42501,
    breaking the kill-switch auto-rollback path (BACKBONE-05 D-4) that
    falls back to this endpoint when the unified-backbone flag flips off
    on a Sentry error-rate breach.

    The TS caller at ``src/app/api/verify-strategy/route.ts``
    (Phase 19 BACKBONE-04 step (a)) upserts the ``strategy_verifications``
    row directly with the verification_id this endpoint returns. We just
    own the compute path: validate the keys, fetch trades, score the
    portfolio, and return the metrics. The verification_id is generated
    locally via uuid.uuid4().
    """
    # Defense-in-depth per-email rate limit (IP-only limit above is decorative
    # against rotated-IP attackers). Composed with the slowapi IP budget.
    if not _check_verify_strategy_email_rate((req.email or "").strip().lower()):
        raise HTTPException(
            status_code=429,
            detail="Too many verification attempts for this email. Try again later.",
        )

    # Audit H-0592 — Idempotency-Key support. A flaky-client retry on the
    # same key returns the cached response (with idempotent_replay=True)
    # instead of firing two live exchange handshakes per call. Scope: in
    # process memory; cross-worker dedup would need a Redis surface but
    # the same-process case is the common one and gives us most of the
    # protection.
    # Starlette Request.headers is always a Headers mapping (never raises on
    # .get()); no defensive try/except needed. Empty / missing header → skip.
    idempotency_key = (request.headers.get("Idempotency-Key") or "").strip()
    if idempotency_key:
        cached = _verify_strategy_idempotency_lookup(
            req.email, req.exchange, req.api_key, idempotency_key,
        )
        if cached is not None:
            return {**cached, "idempotent_replay": True}

    try:
        exchange = create_exchange(req.exchange, req.api_key, req.api_secret, req.passphrase)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        # Capture exception class + redacted message for diagnostics. Project
        # policy forbids empty catch blocks; opaque failures hide CCXT signature
        # changes, ImportError on missing extras, and transient network errors.
        logger.exception(
            "verify_strategy: create_exchange failed (%s): %s",
            type(exc).__name__, _redact_credentials(str(exc), req),
        )
        raise HTTPException(status_code=400, detail="Failed to initialise exchange connection")

    try:
        validation = await validate_key_permissions(exchange)
    except Exception as exc:
        # Redact api_key/api_secret/passphrase before logging — CCXT auth-error
        # messages embed the api_key in signature-mismatch text, leaking it to
        # Sentry breadcrumbs that the PII scrubber doesn't touch.
        logger.error(
            "verify_strategy: key validation error (%s): %s",
            type(exc).__name__, _redact_credentials(str(exc), req),
        )
        raise HTTPException(status_code=500, detail="Key validation failed. Please check your credentials.")
    finally:
        try:
            await exchange.close()
        except Exception as exc:
            # Don't break the response, but DO log — connection leaks and SSL
            # shutdown errors are operator-relevant.
            logger.warning(
                "verify_strategy: exchange.close() failed (%s): %s",
                type(exc).__name__, exc,
            )

    if validation.get("error"):
        raise HTTPException(status_code=400, detail=validation["error"])

    verification_id = str(uuid.uuid4())
    supabase = get_supabase()

    def _fail_vr(msg: str):
        # Phase 19 / PR-X2 — no-op. The legacy state-machine UPDATE on
        # ``verification_requests`` is gone (migration 107 makes it a
        # read-only VIEW). The TS caller's ``strategy_verifications``
        # upsert owns the row's state-machine; we log here so failures
        # still surface in service logs / Sentry breadcrumbs.
        logger.warning("verify_strategy %s failed: %s", verification_id, msg)

    try:
        exchange = create_exchange(req.exchange, req.api_key, req.api_secret, req.passphrase)
        try:
            trades = await fetch_all_trades(exchange)
            account_balance = await fetch_usdt_balance(exchange)
        finally:
            await exchange.close()

        if not trades or len(trades) < 2:
            _fail_vr("Insufficient trade history. At least 2 trades required for verification.")
            raise HTTPException(status_code=400, detail="Insufficient trade history")

        returns = trades_to_daily_returns(trades, account_balance=account_balance)
        if len(returns) < 2:
            _fail_vr("Insufficient trading days after aggregation.")
            raise HTTPException(status_code=400, detail="Insufficient trading days")

        # Period returns
        period_returns = compute_period_returns(returns)

        # Equity curve
        cumulative = (1 + returns).cumprod()
        equity_curve = _series_to_curve(cumulative)

        # TWR
        twr = compute_twr(cumulative, [])

        # Annualized sharpe + vol — extracted into helper so the three router
        # callsites + services/portfolio_optimizer don't drift apart.
        _vol, _mean_ret, sharpe, _sharpe_status = _compute_sharpe_and_vol(returns)

        matched_strategy_id: str | None = None
        # Distinguish FOUR outcomes the previous code collapsed:
        #   matched / no_match / matching_partial / matching_unavailable
        # so the user / dashboard can tell "no peer found" from "matching
        # unavailable" AND from "we only looked at the most-recent
        # _MATCH_CANDIDATE_LIMIT and didn't find one in that window".
        #
        # audit-2026-05-07 red-team (CRITICAL conf 7): when the catalog
        # is larger than `_MATCH_CANDIDATE_LIMIT`, the bounded SELECT
        # silently truncates — the user's actual peer strategy may be
        # the (N+1)th-most-recent and would NEVER be compared. Pre-fix
        # the endpoint returned `matching_status='no_match'` in that
        # case, a FALSE NEGATIVE on a user-facing correctness promise.
        # `matching_partial` surfaces the truncation so callers can
        # render "we only looked at the most-recent 30 strategies" UI
        # instead of "nobody else trades like you". The followup is the
        # tracked fingerprint-based shortlist (audit H-0594 followup);
        # this is the minimum-touch correctness fix.
        matching_status = "no_match"
        try:
            # Order by recency so the slice is deterministic when the catalog
            # exceeds the limit; otherwise Postgres returns a random 100-row
            # window and the user's actual strategy may silently drop out.
            published_result = supabase.table("strategies").select("id").eq(
                "status", "published"
            ).order("created_at", desc=True).limit(_MATCH_CANDIDATE_LIMIT).execute()
            published_ids = [row["id"] for row in (published_result.data or [])]

            # Detect the partial-coverage case before the matching loop
            # so we can flip `matching_status` if no match is found in the
            # bounded window. `>=` (not `==`) because Supabase's `.limit`
            # is an upper bound — a degenerate post-LIMIT plan could in
            # theory return fewer than the requested count, but never more.
            hit_candidate_cap = len(published_ids) >= _MATCH_CANDIDATE_LIMIT

            if published_ids:
                sa_result = supabase.table("strategy_analytics").select(
                    "strategy_id, returns_series"
                ).in_("strategy_id", published_ids).execute()

                # Vectorized matching: build a DataFrame of all existing series and
                # compute correlations in one call instead of per-strategy loop.
                #
                # audit-2026-05-07 H-0594 — trim each `returns_series`
                # JSONB to its trailing _MATCH_RETURNS_SERIES_MAX_POINTS
                # entries BEFORE deserializing into a pd.Series. Without
                # this cap, a runaway upstream write that ballooned a
                # single series to 10k+ records would still pin tens of
                # MB per verify_strategy call even with the candidate
                # count capped by _MATCH_CANDIDATE_LIMIT. The trailing
                # slice is the relevant window for correlation matching
                # anyway — older history dilutes the recent-regime
                # signal verify_strategy is actually looking for.
                existing: dict[str, pd.Series] = {}
                for row in (sa_result.data or []):
                    raw_series = _trim_returns_series(row.get("returns_series"))
                    s = _records_to_series(raw_series, name=row["strategy_id"])
                    if s is not None:
                        existing[row["strategy_id"]] = s

                if existing:
                    df = pd.DataFrame(existing)
                    aligned = pd.concat([returns.rename("_target"), df], axis=1).dropna()
                    if len(aligned) >= 30:
                        corrs = aligned.drop(columns=["_target"]).corrwith(aligned["_target"])
                        # Filter NaN before idxmax — corrwith returns all-NaN when
                        # every candidate has zero variance over the aligned window,
                        # and corrs[NaN] raises KeyError.
                        corrs_clean = corrs.dropna()
                        if not corrs_clean.empty:
                            best = corrs_clean.idxmax()
                            if corrs_clean[best] > _MATCH_CORRELATION_THRESHOLD:
                                matched_strategy_id = best
                                matching_status = "matched"

            # If no match was found AND the SELECT hit the candidate
            # cap, surface that we only compared the most-recent slice.
            # The truthful answer is "we did not find a peer in the
            # bounded window we examined" — NOT "no peer exists".
            if matching_status == "no_match" and hit_candidate_cap:
                matching_status = "matching_partial"
        except Exception as exc:
            # Surface the real cause; flag the outcome so callers can tell
            # "we tried and didn't find" from "matching is down".
            matching_status = "matching_unavailable"
            logger.exception(
                "verify_strategy: strategy matching failed (%s): %s",
                type(exc).__name__, exc,
            )

        results_payload = sanitize_metrics({
            "twr": twr,
            "sharpe": sharpe,
            "return_24h": period_returns.get("return_24h"),
            "return_mtd": period_returns.get("return_mtd"),
            "return_ytd": period_returns.get("return_ytd"),
            "equity_curve": equity_curve,
            "trade_count": len(trades),
        })

        # Phase 19 / PR-X2 — the legacy ``verification_requests`` UPDATE
        # has been removed (migration 107 makes the table a read-only
        # VIEW; any UPDATE here would raise 42501). The TS caller owns
        # the strategy_verifications row's state-machine transitions
        # and persists public_token / expires_at on its side. We return
        # the computed metrics in the response so the caller can stamp
        # them onto strategy_verifications.metrics_snapshot if desired.
        response = {
            "ok": True,
            "status": "complete",
            "verification_id": verification_id,
            "matched_strategy_id": matched_strategy_id,
            "matching_status": matching_status,
            "results": results_payload,
            "twr": twr,
            "sharpe": sharpe,
            **{k: period_returns.get(k) for k in ("return_24h", "return_mtd", "return_ytd")},
        }
        # Cache on Idempotency-Key for replay-protection on flaky-client
        # retries (audit H-0592).
        if idempotency_key:
            _verify_strategy_idempotency_store(
                req.email, req.exchange, req.api_key, idempotency_key, response,
            )
        return response

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "verify_strategy: computation failed for %s: %s",
            verification_id,
            str(exc),
            exc_info=True,
        )
        _fail_vr("Verification failed. Contact support if this persists.")
        raise HTTPException(status_code=500, detail="Strategy verification failed")
