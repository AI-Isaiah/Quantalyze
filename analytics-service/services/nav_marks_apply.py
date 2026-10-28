"""Apply stored marked-to-market NAVs to a realized-basis return series (Phase 167.2.1.1.1 NAVMTM).

What this is for
----------------
From the day NAVMTM deploys, every daily ingest stores each key's marked NAV (equity
including open profit). This module is the ONE place that says how those marks replace
realized-basis values in the series a strategy publishes and the compose rolls back.
It is a pure function of its arguments: pandas and the standard library only, no
Supabase, no network, no logging, and nothing written. The callers (the derive and the
series runner) load the marks and flows and persist the result.

The rule (CONTEXT D-04, D-05, D-09, L1; RESEARCH 5.1)
-----------------------------------------------------
1. No marks: the input comes back unchanged (values, index, NaN positions).
2. ``S`` is the first mark day. Every input day before ``S`` keeps its value exactly
   (L1). Nothing before ``S`` is recomputed, and nothing is invented from position
   history (D-09).
3. ``L_real(S-1)``, the realized level at the end of the day before ``S``, comes from the
   first mark's OWN wallet ``w_S = nav - open_pnl`` (the same basis as the realized level on
   every venue), rolled back one day through day ``S``'s realized return and flow with the
   compose's own convention, ``L(S-1) = (w_S - F_S) / (1 + r_S)``. A day absent from the input
   is ``r = 0`` with its flow. A NaN ``r_S`` uses the day P&L when it holds ``S``,
   ``L(S-1) = w_S - P_S - F_S``, and otherwise leaves ``S`` with no base (rule 4). Nothing
   later than ``S`` is read, so the base, and with it the first marked day's return, is final
   the day ``S`` is stored and cannot move between derives (review CR-01).
4. A mark with no USABLE base has no return row, but its level is still pinned and the next
   mark chains from it (D-05: no row, the next mark covers the day). A base is unusable when
   no input day precedes ``S``, when ``S`` cannot be rolled back (rule 3), and when the base
   is not finite or is at or below ``dust_floor`` (zero by default). Marks and flows are
   history and never change, so a refusal here would repeat on every later derive forever;
   a gap costs one day and heals on the next usable mark (review CR-02).
5. For a mark day ``d`` with previous mark ``p`` (``S-1`` for ``S``) and ``G`` the days
   strictly between them: ``base = level(p) + sum(F_g for g in G)`` and
   ``r(d) = (M_d - base - F_d) / base``. One return, stamped on ``d``, covers the whole
   gap (D-05, "No row; next mark covers it"). A flow inside the gap sits in the base and a
   flow on ``d`` in the numerator. That placement is forced, not chosen: the compose treats
   a flow on a no-return day as an ``r = 0`` day, so its level steps by the flow there, and
   the next return's base must be the stepped level for the compose roll to land on
   ``M_d`` exactly.
6. The output holds the input days before ``S``, then exactly the mark days that have a
   return. A gap day, and every realized input day on or after ``S``, is absent
   (Pitfall 7: a realized row there would be a return of its own for an unmarked day, and
   would double count what the next mark's return spans).

Further rules
-------------
7. ``mark_gap_days`` names the calendar days strictly between ``S`` and the last mark day
   that have no return row of their own (an unmarked day, or a mark with no usable base),
   ascending.
8. ``writer_day_pnl`` is ``M_d - base - F_d`` for each marked day with a return (the level
   identity the compose's writer-basis mode obeys) and ``0.0`` for every gap day carrying a
   flow, because the compose steps the level by the flow there.
9. A flow dated after the last mark day is in no base and no numerator. Its day is listed
   in ``held_out_flow_days``: the caller keeps it out of this derive's stored flows window
   and the next derive places it.
10. A flow is placed by its own instant against the mark's read (CONTEXT D-23). A mark is read
    on the UTC day after its label, so a flow dated that read day may have landed before the
    read, in which case the mark's wallet already holds it. ``flow_instants`` carries the
    instant each raw venue row holds; a flow dated ``d + 1`` made at or before mark ``d``'s
    ``read_at`` is counted in day ``d``, and one made after it stays in ``d + 1``. The flows
    this function reads in rules 3 and 5 are those placed flows, and ``flow_moves`` names what
    moved (mark day -> amount counted in ``d``), so a caller that stores the flows states the
    same placement. The amount counted in ``d`` is the instant's ``amount_prior_day`` when it has
    one (a BTC flow valued at the close the mark itself uses) and its ``amount`` otherwise; the
    amount that leaves ``d + 1`` is always the ``amount`` the day aggregate stored there, reported
    as ``flow_moves_out``. For a USD flow the two are equal. A mark with no ``read_at``, or a
    flow with no instant, is not moved.
    This replaces the round-1 rule that skipped such a mark (review round 2 CR-01, CR-02, WR-01).
11. ``marked_levels`` maps every USED mark day to its stored NAV; ``terminal`` is the last mark
    day and its NAV.
12. An input that is not a well-formed mark or flow (a non-finite amount, marks out of
    order) raises ``MarkApplyRefusal`` with one token from ``MARK_APPLY_REFUSAL_TOKENS`` and
    static text (L3). Nothing is applied partly.
13. ``covered_from`` is the first day whose absence a mark's return covers instead of the
    derive refusing it: the day after the last INPUT index day before ``S`` (a NaN day
    included), or ``S`` itself when no input day precedes it. It is stamped by the caller,
    so the series runner never re-derives it from stored rows (which lack the NaN days and
    would move the boundary).
14. ``covered_days`` is every calendar day from ``covered_from`` through the last mark day
    that has no output row. Callers pass it to ``derive_basis_series(covered_days=...)``.

D-14: a second roll basis for an allocated-capital input
--------------------------------------------------------
``roll_basis="returns"`` (the default) rolls day ``S`` back through its realized return, which
is right when the input returns are NAV changes. An allocated-capital strategy's returns are
P&L over SCHEDULED capital, not NAV changes, so ``(1 + r)`` would roll the wrong level.
``roll_basis="day_pnl"`` rolls by the day P&L and flow alone, ``L(S-1) = w_S - P_S - F_S``,
and never reads the input returns for the base. ``day_pnl`` is then required. Everything else
in the rule is unchanged: the output still keeps every input day before ``S`` and emits only
mark days from ``S`` on.

D-15 (founder, 2026-10-26: "Yes, one observation"): a return that spans unmarked days is
ONE row, so it is one observation in volatility, Sharpe and drawdown. Nothing is spread over
the gap days; ``derive_basis_series(covered_days=...)`` keeps them out of its scalar input.

The pin
-------
On a marked day the level the rule implies is the stored mark's NAV exactly (SC-2). Rolling
the output back with the compose's own ``replay_key_equity`` from the latest mark therefore
reproduces every marked level (SC-3). The base convention in rule 5 is what makes that
true, and it is why the tests feed the output to ``replay_key_equity`` directly.
"""
from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta
from typing import Final, Literal, NamedTuple

import pandas as pd

from services.external_flows import FlowInstant

MARK_APPLY_REFUSAL_TOKENS: Final[frozenset[str]] = frozenset(
    {
        "mark_input_nonfinite",
        "mark_days_not_ascending",
    }
)


class MarkApplyRefusal(ValueError):
    """An input the rule cannot apply. ``token`` is one of ``MARK_APPLY_REFUSAL_TOKENS``;
    the text is static and never carries an amount (T-167.2.1.1.1-11)."""

    def __init__(self, token: str) -> None:
        if token not in MARK_APPLY_REFUSAL_TOKENS:
            raise ValueError("MarkApplyRefusal: unknown refusal token")
        super().__init__(f"mark apply refused ({token})")
        self.token = token


class AppliedMark(NamedTuple):
    """One stored mark: its ISO mark day, the NAV and the open profit in the series' unit. The
    first mark's wallet ``nav - open_pnl`` is what its base is rolled back from (rule 3).
    ``read_at`` is the instant the equity was read (``marked_at``), which places a flow made
    that day against the mark (rule 10)."""

    day: str
    nav: float
    open_pnl: float
    read_at: datetime | None = None


class MarkedSeries(NamedTuple):
    """The marked series and everything the callers stamp or persist beside it."""

    returns: pd.Series
    marks_since: str | None
    mark_gap_days: tuple[str, ...]
    flow_moves: dict[str, float]
    held_out_flow_days: tuple[str, ...]
    marked_levels: dict[str, float]
    writer_day_pnl: dict[str, float]
    terminal: tuple[str, float] | None
    covered_from: str | None
    covered_days: tuple[str, ...]
    flow_moves_out: dict[str, float]


def _input_days(returns: pd.Series) -> list[tuple[date, float]]:
    """The input as ascending ``(day, value)`` pairs. An ISO-string index (what the compose
    reads) and a ``DatetimeIndex`` (what the series derive builds) are both accepted."""
    days: list[tuple[date, float]] = []
    for label, value in returns.items():
        if isinstance(label, pd.Timestamp):
            day = label.date()
        elif isinstance(label, str):
            try:
                day = date.fromisoformat(label)
            except ValueError:
                raise ValueError("apply_marks: returns index must hold ISO days") from None
        else:
            raise ValueError("apply_marks: returns index must hold ISO days")
        days.append((day, float(value)))
    days.sort(key=lambda pair: pair[0])
    if any(a[0] == b[0] for a, b in zip(days, days[1:])):
        raise ValueError("apply_marks: returns index holds a repeated day")
    return days


def _output_index(returns: pd.Series, days: list[date]) -> pd.Index:
    """An index of ``days`` in the same flavor as the input's."""
    if isinstance(returns.index, pd.DatetimeIndex):
        return pd.DatetimeIndex([pd.Timestamp(d) for d in days]).as_unit(returns.index.unit)
    labels = [d.isoformat() for d in days]
    if len(returns.index):
        return pd.Index(labels, dtype=returns.index.dtype)
    return pd.Index(labels)


def _parse_day(value: object, token: str) -> date:
    """A canonical ``YYYY-MM-DD`` day, or the refusal ``token``. ``date.fromisoformat``
    accepts compact and week forms, so the round trip pins the spelling the stores use."""
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            raise MarkApplyRefusal(token) from None
        if parsed.isoformat() == value:
            return parsed
    raise MarkApplyRefusal(token)


def _finite(value: object) -> float:
    """A finite real number, or ``mark_input_nonfinite``. A boolean is not an amount."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MarkApplyRefusal("mark_input_nonfinite")
    amount = float(value)
    if not math.isfinite(amount):
        raise MarkApplyRefusal("mark_input_nonfinite")
    return amount


def _days_between(first: date, last: date) -> list[date]:
    """Calendar days strictly between ``first`` and ``last``."""
    return [first + timedelta(days=k) for k in range(1, (last - first).days)]


def _days_inclusive(first: date, last: date) -> list[date]:
    """Calendar days from ``first`` through ``last``."""
    return [first + timedelta(days=k) for k in range((last - first).days + 1)]


def apply_marks(
    returns: pd.Series,
    flows_by_day: Mapping[str, float],
    marks: Sequence[AppliedMark],
    *,
    day_pnl: Mapping[str, float] | None = None,
    roll_basis: Literal["returns", "day_pnl"] = "returns",
    dust_floor: float = 0.0,
    flow_instants: Sequence[FlowInstant] = (),
) -> MarkedSeries:
    """Apply ``marks`` to ``returns``; see the module docstring for the rule.

    ``flows_by_day`` is {ISO day: signed amount} (deposit positive). ``dust_floor`` is the
    smallest base a return is measured against, in the series' unit (rule 4). Raises
    ``MarkApplyRefusal`` on a malformed input. ``flow_instants`` places a flow made on a mark's
    read day against that mark (rule 10)."""
    if roll_basis not in ("returns", "day_pnl"):
        raise ValueError("apply_marks: unknown roll_basis")
    if not marks:
        return MarkedSeries(returns.copy(), None, (), {}, (), {}, {}, None, None, (), {})

    mark_days = [_parse_day(m.day, "mark_days_not_ascending") for m in marks]
    if any(a >= b for a, b in zip(mark_days, mark_days[1:])):
        raise MarkApplyRefusal("mark_days_not_ascending")
    navs = [_finite(m.nav) for m in marks]
    flows = {
        _parse_day(day, "mark_input_nonfinite"): _finite(amount)
        for day, amount in flows_by_day.items()
    }
    pnl = {
        _parse_day(day, "mark_input_nonfinite"): _finite(amount)
        for day, amount in (day_pnl or {}).items()
    }
    open_pnls = [_finite(m.open_pnl) for m in marks]

    # Rule 10: a flow dated the read day (``md + 1``) and made at or before the mark's read is
    # inside the mark, so it is counted in ``md`` (at ``amount_prior_day`` when the instant has
    # one) and the ``amount`` the day aggregate stored on ``md + 1`` is what leaves it.
    moves: dict[date, float] = {}
    moves_out: dict[date, float] = {}
    for mark, md in zip(marks, mark_days):
        if mark.read_at is None:
            continue
        read_s = mark.read_at.timestamp()
        read_day = (md + timedelta(days=1)).isoformat()
        placed = [
            fi for fi in flow_instants if fi.day == read_day and fi.at_ms / 1000.0 <= read_s
        ]
        moved_out = sum(_finite(fi.amount) for fi in placed)
        moved_in = sum(
            _finite(fi.amount if fi.amount_prior_day is None else fi.amount_prior_day)
            for fi in placed
        )
        if moved_in != 0.0 or moved_out != 0.0:
            moves[md] = moved_in
            moves_out[md] = moved_out
    for md, amount in moves.items():
        flows[md] = flows.get(md, 0.0) + amount
        flows[md + timedelta(days=1)] = flows.get(md + timedelta(days=1), 0.0) - moves_out[md]

    start = mark_days[0]
    last_mark = mark_days[-1]
    in_days = _input_days(returns)
    pre = [(d, v) for d, v in in_days if d < start]

    def usable(base: float) -> bool:
        return math.isfinite(base) and base > dust_floor

    # The base the first mark is measured against, L_real(S-1), from the first mark's own
    # wallet (rule 3). A mark with no usable base is pinned but has no return (rule 4).
    base0: float | None = None
    if pre:
        wallet = navs[0] - open_pnls[0]
        flow_s = flows.get(start, 0.0)
        if roll_basis == "day_pnl":
            base0 = wallet - pnl.get(start, 0.0) - flow_s
        else:
            r_s = dict(in_days).get(start, 0.0)
            if not math.isnan(r_s):
                factor = 1.0 + r_s
                if factor > 0.0:
                    base0 = (wallet - flow_s) / factor
            elif start in pnl:
                base0 = wallet - pnl[start] - flow_s
        if base0 is not None and not usable(base0):
            base0 = None

    level_prev: float | None = base0
    prev_day = start - timedelta(days=1)
    rows: list[tuple[date, float]] = []
    writer_day_pnl: dict[str, float] = {}
    for md, nav in zip(mark_days, navs):
        gap = _days_between(prev_day, md)
        has_row = False
        if level_prev is not None:
            base = level_prev + sum(flows.get(g, 0.0) for g in gap)
            if usable(base):
                day_result = nav - base - flows.get(md, 0.0)
                rows.append((md, day_result / base))
                writer_day_pnl[md.isoformat()] = day_result
                has_row = True
        # A flow on a day with no return steps the compose's level by the flow (rule 8).
        for g in gap if has_row else [*gap, md]:
            if g in flows:
                writer_day_pnl[g.isoformat()] = 0.0
        level_prev = nav
        prev_day = md

    labels = [d for d, _ in pre] + [d for d, _ in rows]
    values = [v for _, v in pre] + [r for _, r in rows]
    out = pd.Series(
        values, index=_output_index(returns, labels), dtype="float64", name=returns.name
    )

    emitted = {d for d, _ in rows}
    covered_from = (pre[-1][0] + timedelta(days=1)) if pre else start
    covered_days = tuple(
        d.isoformat()
        for d in _days_inclusive(covered_from, last_mark)
        if d not in emitted
    )
    return MarkedSeries(
        returns=out,
        marks_since=start.isoformat(),
        mark_gap_days=tuple(
            d.isoformat() for d in _days_between(start, last_mark) if d not in emitted
        ),
        flow_moves={d.isoformat(): amount for d, amount in moves.items()},
        held_out_flow_days=tuple(d.isoformat() for d in sorted(flows) if d > last_mark),
        marked_levels={d.isoformat(): n for d, n in zip(mark_days, navs)},
        writer_day_pnl=writer_day_pnl,
        terminal=(last_mark.isoformat(), navs[-1]),
        covered_from=covered_from.isoformat(),
        covered_days=covered_days,
        flow_moves_out={d.isoformat(): amount for d, amount in moves_out.items()},
    )


__all__ = [
    "FlowInstant",
    "MARK_APPLY_REFUSAL_TOKENS",
    "AppliedMark",
    "MarkApplyRefusal",
    "MarkedSeries",
    "apply_marks",
]
