"""The stored high-water: the one resume rule for every trade-fetch path.

The cron (`routers/cron.py` `cron_sync`), `POST /fetch-trades`
(`routers/exchange.py` `fetch_trades`) and the queued `sync_trades` job all
resume from the strategy's own stored high-water: the UTC day of its newest
`is_fill = false` `trades` row, or `None` (full reach) when it has none or the
read failed. Phase 167.1.2.2.2 D-11 introduced the rule for the cron; Phase 211
LASTSYNC-SEED decision 2 moved it here so the other paths call the SAME
definition instead of copying it.

`api_keys.last_sync_at` is NOT a resume point. The daily holdings poll
overwrites it for every active key, so it says "a poll ran recently", not
"trades are stored up to here". A fetch that resumed from it never re-read a
gap in the stored days.

This module is a leaf: it imports only `services.db`, so `routers/*` and
`services/job_worker.py` can both import it without a cycle.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from services.db import rows

logger = logging.getLogger("quantalyze.analytics")


def high_water_floor_iso(timestamp: str) -> str:
    """ISO string for 00:00 UTC of the day containing `timestamp`.

    Raises on an unparseable value; the caller treats that as a failed read
    (fail OPEN, recorded in the envelope), never as a silent `None`.
    """
    parsed = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    parsed = parsed.astimezone(timezone.utc)
    return parsed.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def load_strategy_high_waters(
    supabase: Any, strategy_ids: list[str]
) -> tuple[dict[str, str | None], str | None]:
    """Each strategy's own resume high-water: the UTC day of its newest stored
    DAILY-P&L row, or `None` when it has none. Returns `(mapping, error)`.

    167.1.2.2.2 TRADESYNC SC-2 / D-11. This replaces `api_keys.last_sync_at`
    as the ABSENT-marker fallback.

    ⛔ `is_fill = false` IS THE WHOLE FILTER. The cron writes one `daily_pnl`
    row per day with `is_fill = false`; raw fills (`is_fill = true`) come from
    the queued `sync_trades` job and are NEWER than the daily rows, so reading
    them would move the floor forward past a gap that is still open.

    ⚠️ FAIL OPEN, PER STRATEGY. A read or parse error maps THAT strategy to
    `None` (full reach, the over-fetch direction, which is idempotent) and is
    recorded in the returned error string for the response envelope. It never
    raises: a Supabase blip must not abort the tick, and a full-reach fetch is
    still bounded by `KEY_SYNC_TIMEOUT`.

    The mapping carries an entry for EVERY requested strategy (a value of
    `None` means "no stored day, or the read failed"), so the resolver never
    has to tell "not loaded" from "empty".
    """
    mapping: dict[str, str | None] = {}
    errors: list[str] = []
    for sid in strategy_ids:
        try:
            result = (
                supabase.table("trades")
                .select("timestamp")
                .eq("strategy_id", sid)
                .eq("is_fill", False)
                .order("timestamp", desc=True)
                .limit(1)
                .execute()
            )
            newest = rows(result)
            mapping[sid] = (
                high_water_floor_iso(newest[0]["timestamp"]) if newest else None
            )
        except Exception as exc:
            logger.exception(
                "stored-high-water read failed for strategy %s — "
                "failing OPEN to a full-reach fetch for this fetch",
                sid,
            )
            mapping[sid] = None
            errors.append(f"{sid}: {type(exc).__name__}: {exc}")
    return mapping, ("; ".join(errors) if errors else None)
