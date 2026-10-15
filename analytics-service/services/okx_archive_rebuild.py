"""OKXHISTORY (167.1.2.2.2.1): produce the rebuilt daily returns for the days an
OKX strategy lost beyond the 3-month ``bills-archive`` reach, and slice them to
exactly the days the founder scoped.

This module is PURE: it takes plain dicts and a few Decimals, does no I/O and
imports none of the archive-ingest modules. Its three jobs:

1. ``rebuild_union`` (D-07). Produce the rebuilt days with the SAME core the live
   derive uses (``broker_dailies.combine_realized_and_funding``), over the live
   inputs with the archive days prepended. No second return formula exists here.
   The NAV roll inside the core runs BACKWARD from today's equity
   (``nav[t - 1] = nav[t] - pnl[t] - flows[t]``), so days prepended before the
   first live day cannot change any later day's NAV, and therefore cannot change a
   live day's return. That identity is asserted on EVERY run (T-IDENT-1, D-12):
   the union and the live-only call must agree on every live day after the first,
   to 1e-9. Any other difference is a permanent ``identity_violation``.

2. ``rows_for_strategy`` (D-01, D-12). Slice the union to the days that may
   become ``csv_daily_returns`` rows: covered by a verified archive quarter,
   inside one of the strategy's stored ``unrecovered_gaps``, finite, not already
   present, and strictly before the first live day. A day inside a verified
   quarter with no bill is a real zero (an explicit zero-P&L record, TRADESYNC
   D-02); a day in a quarter that was not ingested gets no record, no row and no
   0.0, and stays inside ``unrecovered_gaps`` (SC-4, T-GAP-1).

3. ``subtract_ranges`` / ``days_to_ranges`` (D-05, T-GAP-2). Range arithmetic with
   inclusive ends. ``subtract_ranges`` computes the narrowed gaps the caller sends
   to ``apply_okx_archive_rebuild`` as ``p_expected_gaps_after``, and they must
   equal what that function computes itself: the gap days that still have no row,
   collapsed into inclusive islands PER stored gap.
"""
from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Final

import numpy as np
import pandas as pd

from services.broker_dailies import combine_realized_and_funding
from services.external_flows import ExternalFlow
from services.nav_twr import DUST_NAV_FLOOR

STOP_LIVE_ANCHOR_UNUSABLE: Final[str] = "live_anchor_unusable"
STOP_IDENTITY_VIOLATION: Final[str] = "identity_violation"
_STOP_CLASSES: Final[frozenset[str]] = frozenset(
    {STOP_LIVE_ANCHOR_UNUSABLE, STOP_IDENTITY_VIOLATION}
)

# D-12 / T-IDENT-1: how closely the union must reproduce the live-only call on a live
# day. A module constant, deliberately not a parameter: widening it is how a real
# divergence would be waved through. Absolute only (rtol 0): returns are O(1e-2).
IDENTITY_ATOL: Final[float] = 1e-9


class RebuildRefused(Exception):
    """The rebuild stops, permanently, before anything is written.

    ``stop_class`` is one of ``live_anchor_unusable`` (no trustworthy live anchor to
    roll back from) or ``identity_violation`` (prepending archive days moved a live
    day). The message carries the class only: no amounts, no dates (an account-size
    leak on a channel that reaches ``compute_jobs.last_error``)."""

    def __init__(self, stop_class: str) -> None:
        if stop_class not in _STOP_CLASSES:
            raise ValueError(f"unknown rebuild stop class: {stop_class!r}")
        super().__init__(stop_class)
        self.stop_class = stop_class


@dataclass(frozen=True, eq=False)
class RebuildResult:
    """``returns`` is the UNION series (archive days prepended, the live core's own
    gap-fill and guards applied). ``live_first_day`` is the first day of the
    LIVE-ONLY core's index. ``first_live_day_differs`` records, rather than fails,
    the single exempt day (the first live day may be guarded differently when it is
    no longer day 0). ``archive_days_prepended`` counts the covered days handed to
    the core."""

    returns: pd.Series
    live_first_day: str
    first_live_day_differs: bool
    archive_days_prepended: int


# ---------------------------------------------------------------------------
# Range arithmetic (D-05, T-GAP-2)
# ---------------------------------------------------------------------------


def _parse_day(value: str) -> date:
    """A calendar day from ``YYYY-MM-DD``. Fails loud on anything else, so a
    malformed day never compares lexicographically against real ones."""
    return date.fromisoformat(value)


def _islands(days: AbstractSet[date]) -> list[dict[str, str]]:
    """Collapse a set of days into inclusive ``{from, to}`` islands, sorted."""
    out: list[dict[str, str]] = []
    start: date | None = None
    prev: date | None = None
    for d in sorted(days):
        if start is None:
            start = prev = d
        elif d - prev == timedelta(days=1):  # type: ignore[operator]
            prev = d
        else:
            out.append({"from": start.isoformat(), "to": prev.isoformat()})  # type: ignore[union-attr]
            start = prev = d
    if start is not None:
        out.append({"from": start.isoformat(), "to": prev.isoformat()})  # type: ignore[union-attr]
    return out


def days_to_ranges(days: Iterable[str]) -> list[dict[str, str]]:
    """Consecutive ISO days collapsed into inclusive ``{from, to}`` islands, sorted
    by ``from``. Duplicates collapse."""
    return _islands({_parse_day(d) for d in days})


def subtract_ranges(
    gaps: Sequence[Mapping[str, str]], days_with_rows: AbstractSet[str]
) -> list[dict[str, str]]:
    """The gap days that have no row, as inclusive islands, computed PER gap.

    A gap with every day covered is removed, one whose head or tail is covered is
    narrowed, and one with a covered middle day is split in two. Ends are
    inclusive. Per-gap (not merged across gaps) because the SQL function this must
    agree with collapses islands per stored gap; two adjacent stored gaps stay two.
    """
    covered = {_parse_day(d) for d in days_with_rows}
    out: list[dict[str, str]] = []
    for gap in gaps:
        first, last = _parse_day(gap["from"]), _parse_day(gap["to"])
        if first > last:
            raise ValueError(f"gap runs backwards: {gap['from']!r}..{gap['to']!r}")
        span = (last - first).days + 1
        remaining = {
            first + timedelta(days=i)
            for i in range(span)
            if (first + timedelta(days=i)) not in covered
        }
        out.extend(_islands(remaining))
    return sorted(out, key=lambda r: (r["from"], r["to"]))


# ---------------------------------------------------------------------------
# The union (D-07, D-12)
# ---------------------------------------------------------------------------


def _finite_float(value: Decimal, *, what: str) -> float:
    """A Decimal crossed to float exactly once, at this boundary. Non-finite fails
    loud: a NaN P&L would poison the whole NAV roll."""
    out = float(value)
    if not math.isfinite(out):
        raise ValueError(f"archive {what} is not finite")
    return out


def _pnl_record(day: str, pnl: float) -> dict[str, Any]:
    """One daily realized-P&L record in the shape ``fetch_daily_pnl`` emits for OKX
    (``side`` encodes the sign, ``price`` is the absolute amount)."""
    return {
        "exchange": "okx",
        "symbol": "PORTFOLIO",
        "side": "buy" if pnl >= 0 else "sell",
        "price": abs(pnl),
        "quantity": 1,
        "fee": 0,
        "fee_currency": "USDT",
        "timestamp": f"{day}T00:00:00+00:00",
        "order_type": "daily_pnl",
    }


def _day_iso(ts: pd.Timestamp) -> str:
    return ts.date().isoformat()


def rebuild_union(
    *,
    live_realized: list[dict[str, Any]],
    live_funding: Sequence[Mapping[str, Any]],
    live_flows: Sequence[ExternalFlow],
    equity: float | None,
    balance_error: bool,
    open_unrealized_usd: float,
    full_history: bool,
    archive_realized_by_day: Mapping[str, Decimal],
    archive_funding_by_day: Mapping[str, Decimal],
    archive_flows_by_day: Mapping[str, Decimal],
    covered_days: AbstractSet[str],
    from_day: str,
) -> RebuildResult:
    """Run the live core twice, live-only and with archive days prepended, and
    return the union once the identity on the live days is proven.

    ``full_history`` is the value the caller computed exactly as the derive does
    (``_ccxt_full_history_verdict`` on the live inputs). Both calls receive the same
    keyword arguments the derive passes at its ``combine_realized_and_funding`` call
    site, so the only difference between them is the prepended archive days.

    Sign conventions: archive realized and funding amounts are signed income
    (positive earns); archive flows are signed USD (deposit positive, withdrawal
    negative), the ``ExternalFlow`` convention. Archive days handed to the core are
    the covered days in ``[from_day, live_first_day)``: earlier days cannot change a
    gap day under a backward roll and only risk a guard tripping on old history.
    """
    # A heuristic base is not acceptable for a rebuild: refuse BEFORE any core call.
    if (
        balance_error
        or equity is None
        or not math.isfinite(equity)
        or abs(equity) <= DUST_NAV_FLOOR
    ):
        raise RebuildRefused(STOP_LIVE_ANCHOR_UNUSABLE)

    # NEVER ``apply_flow_coverage_terminus`` here. That step NaNs returns before the
    # venue's 90-day deposit-history retention, because capital moves older than it are
    # unfetchable on the live path. The archive's transfer bills supply those flows back
    # to 2021, so the rebuilt days are NOT flow-truncated and applying it would erase
    # exactly the days this module exists to produce (RESEARCH Section 2).
    core_kwargs: dict[str, Any] = {
        "account_balance": equity,
        "balance_error": balance_error,
        "open_unrealized_usd": open_unrealized_usd,
        "full_history": full_history,
    }

    live_returns, _ = combine_realized_and_funding(
        list(live_realized),
        list(live_funding),
        external_flows=list(live_flows),
        **core_kwargs,
    )
    if live_returns.empty:
        # No live day at all: nothing to anchor the archive days to.
        raise RebuildRefused(STOP_LIVE_ANCHOR_UNUSABLE)
    live_first_day = _day_iso(live_returns.index[0])

    first = _parse_day(from_day).isoformat()
    covered_in = sorted(d for d in covered_days if first <= _parse_day(d).isoformat() < live_first_day)

    # A bill on a day the verified quarters do not cover is a caller inconsistency, not
    # data to use: fail loud rather than let an unverified day shape the NAV roll.
    covered_set = set(covered_in)
    for name, by_day in (
        ("realized", archive_realized_by_day),
        ("funding", archive_funding_by_day),
        ("flows", archive_flows_by_day),
    ):
        stray = [
            d for d in by_day
            if first <= _parse_day(d).isoformat() < live_first_day and d not in covered_set
        ]
        if stray:
            raise ValueError(
                f"archive {name} carry {len(stray)} day(s) outside the covered set"
            )

    archive_realized: list[dict[str, Any]] = []
    archive_funding: list[dict[str, Any]] = []
    archive_flows: list[ExternalFlow] = []
    for day in covered_in:
        # A covered quiet day is an explicit zero-P&L record (RESEARCH Pattern 3): the
        # core indexes only days that carry a record or a flow.
        pnl = _finite_float(archive_realized_by_day.get(day, Decimal(0)), what="realized P&L")
        archive_realized.append(_pnl_record(day, pnl))
        funding = _finite_float(archive_funding_by_day.get(day, Decimal(0)), what="funding")
        if funding != 0.0:
            y, m, d = (int(p) for p in day.split("-"))
            archive_funding.append(
                {"timestamp": datetime(y, m, d, tzinfo=timezone.utc), "amount": funding}
            )
        flow = _finite_float(archive_flows_by_day.get(day, Decimal(0)), what="flow")
        if flow != 0.0:
            archive_flows.append(ExternalFlow(day, flow, currency="USD", quantity=None))

    union_returns, _ = combine_realized_and_funding(
        archive_realized + list(live_realized),
        list(live_funding) + archive_funding,
        external_flows=archive_flows + list(live_flows),
        **core_kwargs,
    )

    # T-IDENT-1: every live day after the first must be reproduced by the union.
    live_idx = live_returns.index
    if not live_idx.isin(union_returns.index).all():
        raise RebuildRefused(STOP_IDENTITY_VIOLATION)
    union_live = union_returns.reindex(live_idx).to_numpy(dtype=float)
    live_vals = live_returns.to_numpy(dtype=float)
    if len(live_vals) > 1 and not np.allclose(
        union_live[1:], live_vals[1:], rtol=0.0, atol=IDENTITY_ATOL, equal_nan=True
    ):
        raise RebuildRefused(STOP_IDENTITY_VIOLATION)
    # The first live day may legitimately differ (it is no longer day 0, so a day-0
    # inception rule or guard can read it differently): recorded, not failed.
    first_live_day_differs = not np.allclose(
        union_live[:1], live_vals[:1], rtol=0.0, atol=IDENTITY_ATOL, equal_nan=True
    )

    return RebuildResult(
        returns=union_returns,
        live_first_day=live_first_day,
        first_live_day_differs=bool(first_live_day_differs),
        archive_days_prepended=len(covered_in),
    )


# ---------------------------------------------------------------------------
# The slice (D-01, D-12, SC-4)
# ---------------------------------------------------------------------------


def rows_for_strategy(
    result: RebuildResult,
    gaps: Sequence[Mapping[str, str]],
    existing_days: AbstractSet[str],
    covered_days: AbstractSet[str],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """The ``csv_daily_returns`` rows for one strategy, and the narrowed gaps the
    caller expects ``apply_okx_archive_rebuild`` to compute.

    A day becomes a row only when it is in the covered set AND inside a stored gap
    AND finite AND not already present AND strictly before the first live day. A
    guard-NaN day is left out and stays in its gap, exactly as the live series
    treats it. Legacy days, days before the earliest gap and live days are never
    rows (D-01), and a day that already has a row is never rewritten (D-12).
    """
    gap_days: set[str] = set()
    for gap in gaps:
        first, last = _parse_day(gap["from"]), _parse_day(gap["to"])
        if first > last:
            raise ValueError(f"gap runs backwards: {gap['from']!r}..{gap['to']!r}")
        gap_days.update(
            (first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)
        )

    rows: list[dict[str, Any]] = []
    for ts, value in result.returns.items():
        day = _day_iso(ts)
        if day >= result.live_first_day:
            continue
        if day not in gap_days or day not in covered_days or day in existing_days:
            continue
        if not math.isfinite(float(value)):
            continue
        rows.append({"date": day, "daily_return": float(value)})

    inserted = {r["date"] for r in rows}
    already_present = gap_days & set(existing_days)
    return rows, subtract_ranges(gaps, inserted | already_present)
