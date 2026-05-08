"""Phase 19 / M-17 — shared timestamp coercion for ingestion adapters.

Both CSV (csv_adapter._csv_row_to_trade) and broker adapters
(okx._normalize_trade) parse a single timestamp value out of a raw
record. The coercion logic was duplicated in both modules — hoisted here
so a future timestamp-shape addition (e.g. RFC3339 with offset, or a
broker-specific ms-with-decimal) lives in one place.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def coerce_to_aware_utc(ts_raw: Any, source: str) -> datetime:
    """Coerce a raw timestamp value into an aware-UTC datetime.

    Accepted shapes:
      - ``datetime`` — returned as-is if tzaware; else assumed UTC.
      - ``int`` / ``float`` — Unix milliseconds.
      - ``str`` — ISO-8601 (with optional trailing ``Z``).

    Raises ``ValueError`` on unsupported shapes (including ``None``);
    the caller is responsible for catching this and surfacing a
    structured error code on its own row.
    """
    if isinstance(ts_raw, datetime):
        return ts_raw if ts_raw.tzinfo else ts_raw.replace(tzinfo=timezone.utc)
    if isinstance(ts_raw, (int, float)):
        return datetime.fromtimestamp(float(ts_raw) / 1000, tz=timezone.utc)
    if isinstance(ts_raw, str):
        ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    raise ValueError(
        f"Unsupported timestamp shape from {source}: {ts_raw!r}"
    )
