"""Archive-vs-live reconciliation to the cent (Phase 167.1.2.2.2.1, plan 02; D-09, D-10).

Pure module: stdlib only. The archive has no checksum, so reading it against the live
endpoints on the days both cover is the only content authentication it gets. The two
are the same OKX ledger reached by different endpoints; a difference above one cent is
a parse, aggregation or truncation error, never noise.

``TOLERANCE_USD`` is a fixed fact of this module: no parameter, no override, no
configuration of any kind. A calibration miss is a founder STOP, not a code change
(D-10). A day present on only one side compares against zero on the other, which is how
an archive-only day (the live fetch was truncated) and a live-only day (the archive
dropped it) both surface as misses.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Final, Mapping

TOLERANCE_USD: Final[Decimal] = Decimal("0.01")

_MAX_FIRST_OFFENDING: Final[int] = 10


@dataclass(frozen=True)
class LegReading:
    name: str
    days_compared: int
    max_abs_diff: Decimal
    window_total_diff: Decimal
    days_over_half_cent: int
    days_over_cent: int
    first_offending: tuple[str, ...]
    misses: tuple[tuple[str, Decimal, Decimal], ...]
    ok: bool


def overlap_window(
    quarter_start: date, quarter_end_excl: date, live_first_full_day: date, today: date
) -> tuple[str, str] | None:
    """Inclusive ISO day window both sources can cover, or None when it is empty.

    ``max(quarter_start, live_first_full_day)`` to
    ``min(quarter_end_excl - 1 day, today - 1 day)``. Today is excluded because the live
    day is still open. The window shrinks one day per day and is empty once the live
    reach no longer touches the quarter.
    """
    first = max(quarter_start, live_first_full_day)
    last = min(quarter_end_excl - timedelta(days=1), today - timedelta(days=1))
    if first > last:
        return None
    return first.isoformat(), last.isoformat()


def reconcile_leg(
    name: str,
    archive_by_day: Mapping[str, Decimal],
    live_by_day: Mapping[str, Decimal],
    window: tuple[str, str],
) -> LegReading:
    """Compare one leg day by day and in total over the inclusive ``window``.

    Days outside the window are ignored on both sides. ``ok`` requires every day AND the
    window total to be within ``TOLERANCE_USD``.
    """
    first = date.fromisoformat(window[0])
    last = date.fromisoformat(window[1])
    if first > last:
        raise ValueError(f"empty reconciliation window {window!r}")

    zero = Decimal(0)
    half = TOLERANCE_USD / 2
    days_compared = (last - first).days + 1
    max_abs = zero
    total_archive = zero
    total_live = zero
    over_half = 0
    misses: list[tuple[str, Decimal, Decimal]] = []
    for offset in range(days_compared):
        day = (first + timedelta(days=offset)).isoformat()
        archive_value = archive_by_day.get(day, zero)
        live_value = live_by_day.get(day, zero)
        total_archive += archive_value
        total_live += live_value
        diff = abs(archive_value - live_value)
        max_abs = max(max_abs, diff)
        if diff > half:
            over_half += 1
        if diff > TOLERANCE_USD:
            misses.append((day, archive_value, live_value))

    window_total_diff = total_archive - total_live
    return LegReading(
        name=name,
        days_compared=days_compared,
        max_abs_diff=max_abs,
        window_total_diff=window_total_diff,
        days_over_half_cent=over_half,
        days_over_cent=len(misses),
        first_offending=tuple(day for day, _, _ in misses[:_MAX_FIRST_OFFENDING]),
        misses=tuple(misses),
        ok=not misses and abs(window_total_diff) <= TOLERANCE_USD,
    )
