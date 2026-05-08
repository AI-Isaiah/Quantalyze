"""Phase 19 / BACKBONE-05 — feature flag read seam (Python).

Mirrors src/lib/feature-flags.ts on the FastAPI side. Used by the
main_worker.py dispatch loop to capture the active flag value once per
tick and pass it through claim_compute_jobs_with_priority's third
argument so migration 104 can stamp 'unified_backbone_at_claim' in
compute_jobs.metadata at claim time (drain semantics).

Two-tier resolution (kill-switch wins):
  1. Supabase `feature_flags` row (flag_key='process_key_unified_backbone').
     If value='off', force OFF regardless of env var.
  2. PROCESS_KEY_UNIFIED_BACKBONE env var. Default 'off' until founder
     enables (BACKBONE-05 acceptance — no accidental on-state at deploy).

A 30-second in-process cache keeps round-trip cost trivial — the
dispatch loop reads the flag every 30s anyway, so cache hit ratio is
~99.9% at sustained traffic.

NOTE: This module is owned by P4 (Wave 2). It is created here as part
of P6 because the dispatch loop change in this plan depends on the
import. P4 will land a more complete version (with logging + Sentry
breadcrumbs); the public surface (`is_unified_backbone_active`,
`_reset_cache_for_tests`) is locked.
"""
from __future__ import annotations

import logging
import os
import time

logger = logging.getLogger("quantalyze.analytics.feature_flags")

_CACHE_TTL_S = 30
_FLAG_KEY = "process_key_unified_backbone"
_cache: dict = {}


async def is_unified_backbone_active() -> bool:
    """Return True iff Phase 19 unified backbone is active for new claims.

    Resolution order (kill-switch wins):
      1. Supabase feature_flags row — if value='off', force False.
      2. PROCESS_KEY_UNIFIED_BACKBONE env var — 'on' = True, anything
         else = False.

    Cached for 30s. The cache lives at module scope; callers that need
    a fresh read (test setup, post-flip verification) should call
    `_reset_cache_for_tests()` first.
    """
    now = time.monotonic()
    cached = _cache.get(_FLAG_KEY)
    if cached and cached["expires_at"] > now:
        return bool(cached["value"])

    kill_switch_off = False
    try:
        # Lazy import: keeps `from services.feature_flags import …` cheap
        # for callers that want only the env-var fallback (e.g. tests).
        from services.db import get_supabase

        supabase = get_supabase()
        result = (
            supabase.table("feature_flags")
            .select("value")
            .eq("flag_key", _FLAG_KEY)
            .maybe_single()
            .execute()
        )
        if (
            result is not None
            and getattr(result, "data", None)
            and result.data.get("value") == "off"
        ):
            kill_switch_off = True
    except Exception as exc:  # noqa: BLE001
        # Don't block on Supabase outage — fall through to env var.
        # Worker availability matters more than ideal flag freshness.
        logger.warning(
            "feature_flags.kill_switch_read_failed: %s", str(exc)[:200]
        )

    env_value = os.getenv("PROCESS_KEY_UNIFIED_BACKBONE", "off") == "on"
    value = env_value and not kill_switch_off

    _cache[_FLAG_KEY] = {"value": value, "expires_at": now + _CACHE_TTL_S}
    return value


def _reset_cache_for_tests() -> None:
    """Hook for tests to invalidate the cache between cases.

    Public name follows the same pattern as src/lib/feature-flags.ts
    (`_resetCacheForTests`). Not for runtime use — production callers
    rely on the 30s TTL for cache invalidation.
    """
    _cache.clear()
