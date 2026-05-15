"""Phase 19 / PR-X5 — shared strategy correlation matching.

Extracted from analytics-service/routers/portfolio.py:1024-1051 (the legacy
``verify_strategy`` endpoint's inline correlation block). Now shared
between:

  - The legacy ``verify_strategy`` endpoint (rollback target — stays for
    the kill-switch auto-rollback path until the BACKBONE-09 stability
    window proves the unified path healthy and the legacy endpoint can
    be removed).
  - The unified ``/process-key`` pipeline
    (analytics-service/routers/process_key.py) — runs the same match for
    EVERY flow_type (teaser, csv, internal_report, onboard, resync) per
    D7 unification (PR-X5 handover §"D7"). The matched_strategy_id rides
    on the ``metrics_snapshot`` payload in the ``metrics_captured``
    transition and surfaces in the endpoint response.

Sharing the implementation here keeps the two surfaces from drifting —
e.g., the 95% correlation threshold and the 30-overlap-day floor are
defined in exactly one place.
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd

logger = logging.getLogger("quantalyze.analytics")

# Correlation threshold above which a candidate published strategy is
# considered a "match." Tuned in the legacy verify_strategy block; keep
# in sync if the threshold ever moves.
_MATCH_CORRELATION_THRESHOLD = 0.95

# Minimum number of overlapping daily-return observations between the
# target returns series and a candidate published strategy's series
# before we trust a correlation calculation. Below this, correlations
# are noise.
_MIN_OVERLAP_DAYS = 30

# Cap on the number of published strategies we pull for the match. The
# legacy block used 100; we preserve that to keep query cost bounded.
_PUBLISHED_STRATEGIES_LIMIT = 100


def _records_to_series(raw: list | None, name: str = "") -> pd.Series | None:
    """Convert ``[{date, value}, ...]`` records to a DatetimeIndex Series.

    Mirrors the helper at ``analytics-service/routers/portfolio.py:35``.
    Duplicated here (rather than imported) to keep the matching service
    free of router-level imports — the router still owns its copy for
    other call sites; pulling it across would introduce a circular
    import once process_key imports this module.
    """
    if not isinstance(raw, list) or not raw:
        return None
    dates = [r["date"] for r in raw]
    vals = [r["value"] for r in raw]
    return pd.Series(vals, index=pd.DatetimeIndex(dates), name=name)


def find_matched_strategy(
    returns: pd.Series,
    supabase: Any,
) -> str | None:
    """Find the published strategy_id whose returns series correlates
    >= 95% with ``returns`` over a 30-day-min overlap window. Returns
    ``None`` if no candidate clears the threshold, if there are no
    published strategies, or if the call to Supabase fails.

    Vectorized: builds one DataFrame of all candidate series and runs
    a single ``corrwith`` instead of looping per-strategy.

    Logs warnings on Supabase errors but never raises — matching is
    a best-effort enrichment, not a load-bearing primitive.
    """
    try:
        published_result = (
            supabase.table("strategies")
            .select("id")
            .eq("status", "published")
            .limit(_PUBLISHED_STRATEGIES_LIMIT)
            .execute()
        )
        published_ids = [
            row["id"] for row in (published_result.data or [])
        ]

        if not published_ids:
            return None

        sa_result = (
            supabase.table("strategy_analytics")
            .select("strategy_id, returns_series")
            .in_("strategy_id", published_ids)
            .execute()
        )

        existing: dict[str, pd.Series] = {}
        for row in sa_result.data or []:
            s = _records_to_series(
                row.get("returns_series"), name=row["strategy_id"]
            )
            if s is not None:
                existing[row["strategy_id"]] = s

        if not existing:
            return None

        df = pd.DataFrame(existing)
        aligned = pd.concat(
            [returns.rename("_target"), df], axis=1
        ).dropna()

        if len(aligned) < _MIN_OVERLAP_DAYS:
            return None

        corrs = aligned.drop(columns=["_target"]).corrwith(
            aligned["_target"]
        )
        best = corrs.idxmax()
        if corrs[best] > _MATCH_CORRELATION_THRESHOLD:
            return best
        return None

    except Exception as exc:  # noqa: BLE001
        logger.warning("find_matched_strategy: matching failed: %s", exc)
        return None
