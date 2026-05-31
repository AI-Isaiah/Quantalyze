"""Calendar-day / event-ordering helpers for the analytics worker.

Python half of B12 (audit-2026-05-07 cross-cutting "Time / Date / Cadence
Discipline"). The TypeScript half lives in ``src/lib/dateday.ts``. This module
single-sources two idioms the equity reconstruction had hand-copied:

* ``epoch_ms_to_iso_day`` — the canonical "epoch-ms → UTC calendar day
  (YYYY-MM-DD)" conversion that bucketed trades, deposits, withdrawals,
  CoinGecko closes and OHLCV candles into per-day cells (three byte-identical
  copies of ``datetime.fromtimestamp(ms / 1000, tz=utc).date().isoformat()``).
* ``sort_events_stable`` — the NEW-C01-18 fix: a stable intra-day event sort
  where a missing / zero timestamp sorts LAST within its day (never epoch-0
  first, which inverted same-day open-before-close ordering) and same-timestamp
  events keep their insertion order.

It imports nothing from the rest of ``services`` so it stays a leaf in the
import graph (no cycles): consumers import FROM here, never the reverse.

Scope note (deliberate boundary): this is intentionally smaller than the TS
``dateday.ts``. The picker / chart calendar-day arithmetic that drives the TS
module has no Python analog — the worker only needs the epoch→day bucketing and
the stable event sort. Instant parsing (``datetime.fromisoformat``), pandas-
native day formatting, and rolling-window duration math are a DIFFERENT class
and stay where they are (see B12-PLAN.md exclusions).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# A missing / falsy timestamp sorts to the very end of its day rather than to
# epoch-0 (which would sort it BEFORE every real fill and invert same-day
# open→close ordering). 10**18 ms is ~31.7 MILLION years past epoch —
# astronomically beyond any real fill (a year-2100 timestamp is ~4.1e12 ms), so
# the sentinel can never collide with a genuine timestamp. It is only ever
# compared as an integer sort key, never converted to a date (the conversion
# would in fact raise, since the year exceeds datetime's 9999 ceiling).
_MISSING_TS_SENTINEL = 10**18


def epoch_ms_to_iso_day(ts_ms: Any) -> str:
    """Convert an epoch-millisecond timestamp to a UTC calendar day (YYYY-MM-DD).

    The single source of the ``fromtimestamp(ms / 1000, tz=utc).date().isoformat()``
    idiom. UTC is deliberate: which calendar day an event books to must not
    depend on the worker's local timezone. Raises ``TypeError`` / ``ValueError``
    / ``OSError`` for un-coercible or out-of-range input (callers that tolerate
    missing timestamps guard with their own ``None`` check, as ``_event_date``
    does).
    """
    return datetime.fromtimestamp(int(ts_ms) / 1000.0, tz=timezone.utc).date().isoformat()


def sort_events_stable(
    events: list[dict[str, Any]], ts_key: str = "timestamp"
) -> list[dict[str, Any]]:
    """Stably order intra-day events by timestamp, ascending (NEW-C01-18).

    Opens must land before closes when a round trip spans a few minutes inside
    one calendar day. Two guarantees:

    * a missing / zero ``ts_key`` value sorts LAST within the day (via the
      ``_MISSING_TS_SENTINEL``), so a timestamp-less event can never jump ahead
      of a real fill (the original ``int(ts or 0)`` collapsed it to epoch-0,
      which sorted it FIRST and inverted the ordering);
    * the enumerate insertion-index secondary key keeps same-timestamp events
      in their original order (stable sort).

    Returns a new list; ``events`` is not mutated.
    """
    return [
        e
        for _, e in sorted(
            enumerate(events),
            key=lambda ie: (
                int(ie[1].get(ts_key) or 0) or _MISSING_TS_SENTINEL,
                ie[0],
            ),
        )
    ]
