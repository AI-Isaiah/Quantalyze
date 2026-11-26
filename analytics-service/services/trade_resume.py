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


def load_strategy_fill_high_water(
    supabase: Any, strategy_id: str
) -> tuple[str | None, str | None]:
    """The strategy's newest stored raw FILL timestamp, EXACT, or `None` when it
    has none or the read failed. Returns `(timestamp, error)`.

    Phase 232 VREAD-08. The queued `sync_trades` job clamps its fills-read seed
    to this value, so a `last_fetched_trade_timestamp` that sits ahead of the
    newest stored fill (the days between them were never fetched) is read from
    that fill instead and the skipped days are re-read.

    ⛔ `is_fill = true` IS THE WHOLE FILTER, and it is the reason this helper
    differs from `load_strategy_high_waters`, which filters `is_fill = false`
    (the daily-P&L rows). The two never share a floor: the daily rows are
    one-per-day and floored to 00:00 UTC, while a fills seed is the fill's own
    timestamp, UNFLOORED (LASTSYNC-SEED decision 4), because flooring would
    only widen an over-fetch the unique-index dedup already absorbs.

    ⚠️ FAIL OPEN, NEVER RAISES. A read or parse error returns `(None, error)`;
    the caller treats that as "no stored fill known" and bounds the cursor by
    the daily seed, so a Supabase blip can never leave an ahead cursor
    unclamped. The error string is shaped like the sibling's.
    """
    try:
        result = (
            supabase.table("trades")
            .select("timestamp")
            .eq("strategy_id", strategy_id)
            .eq("is_fill", True)
            .order("timestamp", desc=True)
            .limit(1)
            .execute()
        )
        newest = rows(result)
        return (str(newest[0]["timestamp"]) if newest else None), None
    except Exception as exc:
        logger.exception(
            "stored-fill-high-water read failed for strategy %s — failing OPEN "
            "to the daily seed for this fills read",
            strategy_id,
        )
        return None, f"{strategy_id}: {type(exc).__name__}: {exc}"


def load_strategy_fills_reread_bound(
    supabase: Any, strategy_id: str, api_key_id: str
) -> tuple[str | None, str | None]:
    """This strategy's Binance fills re-read bound, or `None`. Returns `(unread_from, error)`.

    Phase 253 BINANCECURSOR. `strategy_fills_reread_bounds` holds, per strategy, the earliest
    instant a stopped, failed or raised Binance fills read was complete through. The queued
    `sync_trades` job lowers its fills-read seed to it, so the span is read again whatever a
    sibling strategy on the same key did to the shared `api_keys.last_fetched_trade_timestamp`
    column. The seed that survives is read by `load_strategy_fill_high_water` and the column;
    this is the third term of it.

    A row stored for ANOTHER key is ignored on read (the strategy was re-pointed at a different
    key; the RPC replaces or deletes that row on this run's write).

    ⚠️ FAIL OPEN, NEVER RAISES, like its sibling `load_strategy_fill_high_water`. A read error
    (a blip, or a missing relation during a deploy) returns `(None, error)`, which the caller
    treats as "no bound term". That is safe because the run's write then carries a `covers_from`
    above the stored bound, so the RPC keeps the stored bound and the first run whose read
    succeeds re-reads it. A full-reach fallback would add an 85-day walk under the 840 s read
    deadline on every blip and buys no integrity.
    """
    try:
        result = (
            supabase.table("strategy_fills_reread_bounds")
            .select("api_key_id, unread_from")
            .eq("strategy_id", strategy_id)
            .limit(1)
            .execute()
        )
        found = rows(result)
        if found and str(found[0]["api_key_id"]) == str(api_key_id):
            return str(found[0]["unread_from"]), None
        return None, None
    except Exception as exc:
        logger.exception(
            "fills-reread-bound read failed for strategy %s — failing OPEN to no bound "
            "term for this fills read",
            strategy_id,
        )
        return None, f"{strategy_id}: {type(exc).__name__}: {exc}"
