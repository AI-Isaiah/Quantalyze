"""Phase 236 plan 01 (FIG-01, F-5): cross-language pin of the convention constant set.

WHY: "365, ddof 1 everywhere" is one convention only if both languages hold the same
numbers. This pin reads ``src/lib/figure-conventions.ts`` as text and fails NAMING the
constant when either side moves alone. Exactly-once is part of the rule: a duplicate
definition is a second place a number can drift. The vitest twin is
``src/lib/figure-conventions.test.ts``.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from services import figure_conventions as fc

TS_PATH = Path(__file__).resolve().parents[2] / "src" / "lib" / "figure-conventions.ts"

NAMES = (
    "CALENDAR_DAYS_PER_YEAR",
    "SD_DDOF",
    "PERIODS_PER_YEAR_CRYPTO",
    "PERIODS_PER_YEAR_TRADITIONAL",
    "CVAR_MIN_OBS",
)


def _ts_value(name: str) -> int:
    text = TS_PATH.read_text(encoding="utf-8")
    hits = re.findall(rf"^export const {name} = (\d+);\s*$", text, flags=re.MULTILINE)
    assert len(hits) == 1, f"{name} must be exported exactly once from figure-conventions.ts"
    return int(hits[0])


@pytest.mark.parametrize("name", NAMES)
def test_constant_agrees_with_typescript(name: str) -> None:
    assert _ts_value(name) == getattr(fc, name), (
        f"{name} differs between figure_conventions.py and figure-conventions.ts"
    )


def test_f5_f6_values() -> None:
    """The F-5 / F-6 / Q2 rulings, as values (a retune is a founder decision, not a drive-by)."""
    assert fc.CALENDAR_DAYS_PER_YEAR == 365
    assert fc.SD_DDOF == 1
    assert fc.PERIODS_PER_YEAR_CRYPTO == 365
    assert fc.PERIODS_PER_YEAR_TRADITIONAL == 252
    assert fc.CVAR_MIN_OBS == 60
