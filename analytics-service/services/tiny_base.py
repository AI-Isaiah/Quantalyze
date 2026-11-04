"""The tiny-base rule, defined once (Phase 188 TINYBASE, CONTEXT D-02, D-03, D-05).

Why this exists
---------------
A day's return is ``(NAV_t - base - F_t) / base``. When the account was nearly emptied a few
days earlier, ``base`` is a sliver of what the strategy ran with, and one ordinary move on what
is left reads as +47% or -53%. The founder's decisions (2026-11-03): D-03 sets the threshold,
D-02 the treatment (leave the day out of the returns and show it flagged), D-05 excludes a base
at or below zero (those days stay with the machinery that already handles them).

The rule (D-03)
---------------
A day ``t`` is tiny-base when its starting NAV ``base`` is positive and under
``TINY_BASE_FRACTION`` of the highest end-of-day level over the previous
``TINY_BASE_WINDOW_DAYS`` calendar days, the window being the days ``t-30`` through ``t-1``
inclusive. A calendar day with no level of its own carries the last level before it, so the
level in force at the window's first day counts. The window always contains ``t-1``, so a
series' first measured day has a ratio of at most 1 and is never tiny.

Purity
------
Standard library only: no I/O, no logging, no pandas. Every refusal raises ``ValueError`` with
static text that carries no amount. This module is the only home of 0.05 and 30 in production
code; every caller imports the constants or calls the two functions.
"""
from __future__ import annotations

import math
from bisect import bisect_right
from collections.abc import Iterable, Mapping
from datetime import date, timedelta
from typing import Final

# D-03 (founder 2026-11-03, "Under 5% of the 30-day peak"): the only home of this number.
TINY_BASE_FRACTION: Final[float] = 0.05
# D-03: the window length in calendar days, t-30 through t-1 inclusive. The only home of this number.
TINY_BASE_WINDOW_DAYS: Final[int] = 30


def _parse_day(value: object) -> date:
    """A canonical ``YYYY-MM-DD`` day, or ``ValueError``. ``date.fromisoformat`` accepts compact
    and week forms, so the round trip pins the spelling the stores use."""
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            raise ValueError("tiny_base: day must be a canonical YYYY-MM-DD") from None
        if parsed.isoformat() == value:
            return parsed
    raise ValueError("tiny_base: day must be a canonical YYYY-MM-DD")


def window_peaks(levels: Mapping[str, float], days: Iterable[str]) -> dict[str, float]:
    """The 30-day peak for each requested day.

    ``levels`` is {ISO day: end-of-day level}. For each day ``d`` in ``days`` the result holds
    the maximum level over the calendar days ``d-30`` through ``d-1`` inclusive, where a day
    with no entry carries the last entry before it (so the entry in force at ``d-30`` counts).
    A day with no entry before it is left out of the result. Raises ``ValueError`` (static text)
    on a non-finite level, a non-numeric level, or a day that is not a canonical ISO day."""
    parsed: list[tuple[date, float]] = []
    for key, level in levels.items():
        if isinstance(level, bool) or not isinstance(level, (int, float)):
            raise ValueError("tiny_base: level must be a finite number")
        amount = float(level)
        if not math.isfinite(amount):
            raise ValueError("tiny_base: level must be a finite number")
        parsed.append((_parse_day(key), amount))
    parsed.sort(key=lambda pair: pair[0])
    keys = [d for d, _ in parsed]
    values = [v for _, v in parsed]

    out: dict[str, float] = {}
    for day_iso in days:
        day = _parse_day(day_iso)
        window_first = day - timedelta(days=TINY_BASE_WINDOW_DAYS)
        window_last = day - timedelta(days=1)
        end = bisect_right(keys, window_last)
        if end == 0:
            continue
        # The last entry at or before the window's first day is carried into the window.
        start = max(bisect_right(keys, window_first) - 1, 0)
        out[day_iso] = max(values[start:end])
    return out


def is_tiny_base(base: float, peak: float | None) -> bool:
    """True when ``base`` is positive and strictly under ``TINY_BASE_FRACTION`` of ``peak``.

    D-05: a base at or below zero is never tiny (those days stay with the existing machinery),
    a ``None`` peak (no level before the day) is never tiny, and neither is a non-finite base."""
    return (
        peak is not None
        and math.isfinite(base)
        and 0.0 < base < TINY_BASE_FRACTION * peak
    )


def tiny_base_day_list(
    realized_days: Iterable[str] | None,
    marks_since: str | None,
    marked_days: Iterable[str] = (),
) -> list[str]:
    """The days the rule left out of one series, as the ascending unique ISO list the derive
    stores (D-02: ``key_inputs.tiny_base_days`` and the pre-stamp's ``tiny_base_days``).

    ``realized_days`` are the realized-era days the NAV core named (``meta["tiny_base_days"]``,
    quiet days included); only those strictly before ``marks_since`` count, because from the first
    stored mark on the marked era owns every day (all of them when ``marks_since`` is None).
    ``marked_days`` are the days ``apply_marks`` left out. ``None`` realized days is an empty
    input. Raises ``ValueError`` (static text) on a day that is not a canonical ISO day."""
    kept: set[str] = set()
    boundary = None if marks_since is None else _parse_day(marks_since)
    for day_iso in realized_days or ():
        day = _parse_day(day_iso)
        if boundary is None or day < boundary:
            kept.add(day_iso)
    for day_iso in marked_days:
        _parse_day(day_iso)
        kept.add(day_iso)
    return sorted(kept)


def realized_tiny_base_pnl(
    day_pnl: Mapping[str, float] | None, marks_since: str | None
) -> dict[str, float]:
    """The realized-era tiny days' P&L (``meta["tiny_base_day_pnl"]``), cut like the day list: only
    the entries strictly before ``marks_since`` (all of them when it is None), ``{}`` for None.
    A copy, never an alias of the combiner's meta. Raises ``ValueError`` (static text, no value in
    it) on a non-finite or non-numeric amount or a day that is not a canonical ISO day."""
    out: dict[str, float] = {}
    boundary = None if marks_since is None else _parse_day(marks_since)
    for day_iso, amount in (day_pnl or {}).items():
        day = _parse_day(day_iso)
        if isinstance(amount, bool) or not isinstance(amount, (int, float)):
            raise ValueError("tiny_base: P&L must be a finite number")
        value = float(amount)
        if not math.isfinite(value):
            raise ValueError("tiny_base: P&L must be a finite number")
        if boundary is None or day < boundary:
            out[day_iso] = value
    return out


__all__ = [
    "TINY_BASE_FRACTION",
    "TINY_BASE_WINDOW_DAYS",
    "is_tiny_base",
    "realized_tiny_base_pnl",
    "tiny_base_day_list",
    "window_peaks",
]
