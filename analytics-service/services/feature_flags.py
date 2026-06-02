"""Phase 19 / BACKBONE-04 + BACKBONE-05 — feature flag read seam (Python).

Mirrors src/lib/feature-flags.ts (TS read seam shipped in P5). 30s in-process
cache. Reads kill-switch row from Supabase first; falls back to env var on
outage (Pitfall 6 fail-soft).

Read order
----------
  1. In-process cache (TTL 30s).
  2. Supabase ``feature_flags`` table — if ``process_key_unified_backbone``
     row has ``value='off'``, force OFF regardless of env var (kill-switch).
  3. Env var ``PROCESS_KEY_UNIFIED_BACKBONE`` — value 'on' enables; anything
     else (including absent) is OFF.

Fail-soft semantics (H-3)
-------------------------
When Supabase is unreachable AND env var is unset, the function returns
False (i.e., unified backbone is OFF). Deploys must explicitly set
``PROCESS_KEY_UNIFIED_BACKBONE=on`` to enable. On a transient Supabase
outage where env=on, the kill-switch read fails open — env decides — so
the synchronous /process-key path stays alive instead of flipping to a
user-visible 503. The cache extends across the failure: a successful read
shortly before an outage continues to be served until the 30s TTL expires.
This combination keeps the synchronous endpoint resilient to brief upstream
flaps without ever overriding an explicit kill-switch flip.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import TypedDict

# Imported eagerly so test code can monkey-patch
# `services.feature_flags.get_supabase` (the most ergonomic patch target).
from services.db import get_supabase

logger = logging.getLogger("quantalyze.analytics.feature_flags")

# M-6 — hoist the 30s default into a module-level constant so the env-var
# fallback, the explicit constant, and the test reference all point at
# the same number. Locked per CONTEXT.md L37 (Phase 19 / D-4 — cache TTL
# during stability window).
DEFAULT_CACHE_TTL_S: float = 30.0


# Phase 19 / D-4 — cache TTL during stability window. Default 30s. During the
# 7-day stability window after PR-B, the founder can set
# PHASE_19_STABILITY_CACHE_TTL_S=5 in the analytics-service environment to
# shorten kill-switch propagation from 30s → 5s. Combined with the 15-min
# /api/cron/flag-monitor tick the worst-case auto-rollback latency drops to
# ≤15min05s. After PR-D ships the env var can be unset (defaults back to 30s).
def _resolve_cache_ttl_s() -> float:
    raw = os.getenv("PHASE_19_STABILITY_CACHE_TTL_S")
    if not raw:
        return DEFAULT_CACHE_TTL_S
    try:
        v = float(raw)
        return v if v > 0 else DEFAULT_CACHE_TTL_S
    except ValueError:
        return DEFAULT_CACHE_TTL_S


_CACHE_TTL_S: float = _resolve_cache_ttl_s()


class _FlagCacheEntry(TypedDict):
    # The cached value is always a bool (`env_value and not kill_switch_off`)
    # and expires_at a monotonic float. Typing the entry precisely lets the
    # cache-hit `return cached["value"]` paths stay bool without an Any-launder.
    value: bool
    expires_at: float


_cache: dict[str, _FlagCacheEntry] = {}

# CR-perf-3 — single-flight guard. Without this, N concurrent expired-cache
# misses each fire their own Supabase RPC; under burst load that's a
# stampede that can saturate connections + double-bill the kill-switch
# read. asyncio.Lock-keyed-by-flag ensures at most one in-flight refresh
# for a given flag at a time; the rest await the existing future. We use
# a dict-of-locks so adding more flags later doesn't serialize them all
# behind one global lock.
_refresh_locks: dict[str, asyncio.Lock] = {}


def _get_refresh_lock(flag_key: str) -> asyncio.Lock:
    lock = _refresh_locks.get(flag_key)
    if lock is None:
        lock = asyncio.Lock()
        _refresh_locks[flag_key] = lock
    return lock


async def is_unified_backbone_active() -> bool:
    """Return True iff Phase 19 unified backbone should serve this request."""
    now = time.monotonic()
    cached = _cache.get("process_key_unified_backbone")
    if cached and cached["expires_at"] > now:
        return cached["value"]

    # CR-perf-3 — single-flight: only one coroutine refreshes the cache at
    # a time. Re-check the cache inside the lock so the second waiter
    # picks up the freshly-populated value without re-querying Supabase.
    lock = _get_refresh_lock("process_key_unified_backbone")
    async with lock:
        cached = _cache.get("process_key_unified_backbone")
        if cached and cached["expires_at"] > time.monotonic():
            return cached["value"]

        # Step 1: kill-switch row check.
        kill_switch_off = False
        try:
            supabase = get_supabase()
            result = (
                supabase.table("feature_flags")
                .select("value")
                .eq("flag_key", "process_key_unified_backbone")
                .maybe_single()
                .execute()
            )
            if result.data and result.data.get("value") == "off":
                kill_switch_off = True
        except Exception as exc:  # noqa: BLE001
            # Fail-soft on Supabase outage: don't block on connectivity. Env
            # decides. Logged at WARN so a sustained outage is visible in
            # Sentry but a single transient failure does not page.
            logger.warning(
                "feature_flags.is_unified_backbone_active: kill-switch read failed: %s",
                exc,
            )

        # Step 2: env var.
        env_value = os.getenv("PROCESS_KEY_UNIFIED_BACKBONE", "off") == "on"

        value = env_value and not kill_switch_off
        # Re-resolve TTL each call so a runtime env-var change (e.g. founder sets
        # PHASE_19_STABILITY_CACHE_TTL_S=5 during stability window) takes effect
        # without a process restart. The cost is one os.getenv per cache miss.
        _cache["process_key_unified_backbone"] = {
            "value": value,
            "expires_at": time.monotonic() + _resolve_cache_ttl_s(),
        }
        return value


def _reset_cache_for_tests() -> None:
    """Test-only: clear the in-process cache + single-flight locks.

    Do NOT call from production code. The locks dict is cleared so a test
    that ran a stampede assertion against a stale lock instance does not
    leak state into the next test.
    """
    _cache.clear()
    _refresh_locks.clear()
