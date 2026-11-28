"""Calendar-day / event-ordering helpers for the analytics worker.

Python half of B12 (audit-2026-05-07 cross-cutting "Time / Date / Cadence
Discipline"). The TypeScript half lives in ``src/lib/dateday.ts``. This module
single-sources the idiom the equity reconstruction had hand-copied:

* ``epoch_ms_to_iso_day`` — the canonical "epoch-ms → UTC calendar day
  (YYYY-MM-DD)" conversion that bucketed trades, deposits, withdrawals,
  CoinGecko closes and OHLCV candles into per-day cells (three byte-identical
  copies of ``datetime.fromtimestamp(ms / 1000, tz=utc).date().isoformat()``).

It imports nothing from the rest of ``services`` so it stays a leaf in the
import graph (no cycles): consumers import FROM here, never the reverse.

Scope note (deliberate boundary): this is intentionally smaller than the TS
``dateday.ts``. The picker / chart calendar-day arithmetic that drives the TS
module has no Python analog — the worker only needs the epoch→day bucketing. Instant parsing
(``datetime.fromisoformat``), pandas-native day formatting, and rolling-window
duration math are a DIFFERENT class and stay where they are (see B12-PLAN.md exclusions).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


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
