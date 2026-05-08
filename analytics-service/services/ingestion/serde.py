"""Phase 19 / BACKBONE-09 / MC-4 — shared metrics-snapshot serialiser.

Extracted from routers/process_key.py per WR-05 (REVIEW.md 2026-05-08) so
both the synchronous router path and the async long_fetch worker path use
the same type-aware encoder.

The original blueprint walked ``m.__dict__`` which works for the primitive-
only MetricsSnapshot but silently corrupts JSONB if any future field is
``datetime`` / ``Decimal`` / non-primitive. Use ``dataclasses.asdict`` for
dataclasses, ``model_dump(mode='json')`` for pydantic, falling back to a
``__dict__`` walk + ``json.dumps`` round-trip that surfaces TypeError on a
non-encodable value rather than persisting a corrupted dict.
"""
from __future__ import annotations

import dataclasses
import json
from typing import Any


def metrics_to_jsonb(m: Any) -> dict:
    """Type-aware serialisation for the MetricsSnapshot JSONB column.

    Contract — single source of truth, used in both:
      - analytics-service/routers/process_key.py (synchronous pipeline)
      - analytics-service/services/ingestion/long_fetch.py (worker pipeline)

    Behaviour:
      * dataclass → dataclasses.asdict (preserves nested values verbatim).
      * pydantic v2 model → model_dump(mode='json') (canonical JSON shape).
      * plain object → __dict__ walk + json.dumps roundtrip; TypeError on
        a non-encodable value rather than silent corruption of the JSONB.
    """
    if dataclasses.is_dataclass(m) and not isinstance(m, type):
        return dataclasses.asdict(m)
    if hasattr(m, "model_dump"):
        return m.model_dump(mode="json")
    out = {k: v for k, v in m.__dict__.items() if not k.startswith("_")}
    json.dumps(out)  # raises TypeError on non-encodable values
    return out


__all__ = ["metrics_to_jsonb"]
