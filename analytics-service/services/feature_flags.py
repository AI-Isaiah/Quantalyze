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

import logging
import os
import time
from typing import Any

# Imported eagerly so test code can monkey-patch
# `services.feature_flags.get_supabase` (the most ergonomic patch target).
from services.db import get_supabase

logger = logging.getLogger("quantalyze.analytics.feature_flags")

# Phase 19 / D-4 — cache TTL during stability window. Default 30s. During the
# 7-day stability window after PR-B, the founder can set
# PHASE_19_STABILITY_CACHE_TTL_S=5 in the analytics-service environment to
# shorten kill-switch propagation from 30s → 5s. Combined with the 15-min
# /api/cron/flag-monitor tick the worst-case auto-rollback latency drops to
# ≤15min05s. After PR-D ships the env var can be unset (defaults back to 30s).
def _resolve_cache_ttl_s() -> float:
    raw = os.getenv("PHASE_19_STABILITY_CACHE_TTL_S")
    if not raw:
        return 30.0
    try:
        v = float(raw)
        return v if v > 0 else 30.0
    except ValueError:
        return 30.0


_CACHE_TTL_S: float = _resolve_cache_ttl_s()
_cache: dict[str, dict[str, Any]] = {}


async def is_unified_backbone_active() -> bool:
    """Return True iff Phase 19 unified backbone should serve this request."""
    now = time.monotonic()
    cached = _cache.get("process_key_unified_backbone")
    if cached and cached["expires_at"] > now:
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
        "expires_at": now + _resolve_cache_ttl_s(),
    }
    return value


def _reset_cache_for_tests() -> None:
    """Test-only: clear the in-process cache. Do NOT call from production code."""
    _cache.clear()
