"""The MT5 parity compare engine: pure, fail-closed, one tolerance (PARITY-02).

``parity_diff.py`` is the shape precedent: a closed taxonomy whose default
disposition is "unexplained", reached only after every registered explainer was
evaluated and none matched, never by a silent fallthrough. This module follows it
for the MT5 harness and defines the ONE tolerance every comparison reads.

D-B (REQUIREMENTS): the tolerance is a return gap in points,
``|dE_ours - dE_oracle| / E(window start)``, checked separately for the start level,
the end level and the cumulative return. ``MT5_PARITY_TOLERANCE`` is its only
definition; tests import it and nothing else in this package restates the number.

PURE. It imports the capture and intake siblings (themselves stdlib, pandas and
``services.wealth_returns`` only), so no database, gateway or network can be reached
from here. The oracle side is a ``Reading`` whose provenance passed
``require_provenance``: nothing computed by our own pipeline is ever an oracle.

The verdict types hold NO field that can carry an amount or an id, and
``render_verdict_markdown`` writes only fixed words, the account label, leg names,
buckets, reason codes and ratios to three significant figures. The redaction rule
for the tracked record is a type, not a review habit.
"""
from __future__ import annotations

import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Final, Literal

import pandas as pd

from services.broker_dailies import mt5_day_pnl
from services.mt5_deals import (
    Mt5DealClassificationError,
    classify_deal,
    deal_cash_effect,
    deal_utc_day,
    deal_utc_instant_ms,
)
from services.mt5_parity_capture import (
    Capture,
    MarkReading,
    account_rows,
    our_daily_returns,
    our_key_inputs,
    our_mark,
)
from services.mt5_parity_intake import Reading, Worksheet, require_provenance
from services.mt5_server_clock import Mt5ServerClock, server_clock_for_rule

# The ONE parity tolerance (D-B): one percentage point of E at the window start.
MT5_PARITY_TOLERANCE: Final[float] = 0.01

# "About 0" for the inception identity, as a ratio to the first deposit. A planner's
# value, to be confirmed in Phase 155.2 (RESEARCH Open Question 2); defined beside the
# tolerance so every consumer reads one definition.
MT5_INCEPTION_IDENTITY_BAND: Final[float] = 0.001

WITHIN_TOLERANCE: Final = "within_tolerance"
PRE_MARK_REALIZED_BASIS: Final = "pre_mark_realized_basis"
EDGE_INSTANT_MISMATCH: Final = "edge_instant_mismatch"
FLOW_PLACEMENT: Final = "flow_placement"
ANNUALIZATION_CONVENTION: Final = "annualization_convention"
WITHHELD_BY_GATE: Final = "withheld_by_gate"
CLOCK_MISMATCH: Final = "clock_mismatch"
UNEXPLAINED: Final = "unexplained"

Bucket = Literal[
    "within_tolerance",
    "pre_mark_realized_basis",
    "edge_instant_mismatch",
    "flow_placement",
    "annualization_convention",
    "withheld_by_gate",
    "clock_mismatch",
    "unexplained",
]

BUCKET_LABELS: Final[frozenset[str]] = frozenset(
    {
        WITHIN_TOLERANCE,
        PRE_MARK_REALIZED_BASIS,
        EDGE_INSTANT_MISMATCH,
        FLOW_PLACEMENT,
        ANNUALIZATION_CONVENTION,
        WITHHELD_BY_GATE,
        CLOCK_MISMATCH,
        UNEXPLAINED,
    }
)

# Only these pass on their own. ``withheld_by_gate`` passes only in the surface
# matrix, where every surface withholds for the same reason; an engine verdict that
# lands there never passes by itself (see ``AccountVerdict.passed``).
PASSING_BUCKETS: Final[frozenset[str]] = frozenset({WITHIN_TOLERANCE, WITHHELD_BY_GATE})

LegName = Literal[
    "start_level", "end_level", "cum_return", "inception_identity", "day_placement"
]
# The legs in the order a verdict lists them.
GATE_A_LEGS: Final[tuple[LegName, ...]] = (
    "start_level",
    "end_level",
    "cum_return",
    "inception_identity",
    "day_placement",
)
GATE_B_LEGS: Final[tuple[LegName, ...]] = ("start_level", "end_level", "cum_return")

# The closed-market interval a weekend reading is attested for: Friday 22:00 UTC to
# Sunday 21:00 UTC, the intersection of both US-DST states of the FX close and reopen.
WEEKEND_ATTESTED_FROM_UTC_HOUR: Final[int] = 22
WEEKEND_ATTESTED_TO_UTC_HOUR: Final[int] = 21

_FRIDAY: Final[int] = 4
_SHIFT_SECONDS: Final[int] = 3600

# Why a window was refused. A closed set: a refusal is a RED verdict carrying one of
# these, never a skipped account.
WINDOW_REFUSAL_REASONS: Final[tuple[str, ...]] = (
    "gate_b_edge_before_first_mark",
    "edge_without_mark",
    "edge_without_reading",
    "window_not_closed",
    "flow_in_gate_b_window",
    "deal_in_edge_gap",
    "gate_a_reaches_first_mark",
    "edge_order",
    # The picker could not even form a candidate window for the gate.
    "no_candidate_window",
)
_EQUITY_READING_IDS: Final[frozenset[str]] = frozenset(
    {"statement_equity", "weekend_close_equity"}
)
# The first line of every rendered rehearsal verdict.
REHEARSAL_HEADER: Final = (
    "DRESS REHEARSAL: synthetic oracle. Proves the pipeline runs; proves nothing about parity."
)
_LABEL_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,31}$")
_LONG_DIGIT_RUN_RE: Final[re.Pattern[str]] = re.compile(r"[0-9]{5,}")


@dataclass(frozen=True, slots=True)
class LegResult:
    """One leg of a comparison. An unmeasurable leg has ``gap=None``,
    ``passed=False`` and ``reason="not_measurable:<what>"``: it fails closed."""

    leg: LegName
    gap: float | None
    passed: bool
    reason: str | None


@dataclass(frozen=True, slots=True)
class Window:
    gate: Literal["A", "B"]
    start: date
    end: date
    # Set only by ``propose_windows(keep_refused=True)`` on a gate it could not form a
    # window for; ``evaluate_account`` turns it into a RED ``window_refused`` verdict.
    refusal: str | None = None

    def __post_init__(self) -> None:
        if self.refusal is not None and self.refusal not in WINDOW_REFUSAL_REASONS:
            raise ValueError("unknown window refusal reason")


@dataclass(frozen=True, slots=True)
class ExplainerContext:
    """What an explainer may read: the account's capture view, the oracle's
    readings, the window and the legs that breached."""

    capture: Capture
    ordinal: str
    readings: tuple[Reading, ...]
    window: Window
    breaching: tuple[LegResult, ...]
    # The Gate A oracle: the Report's deals and the base clock they were folded under.
    # Empty / None for a Gate B context built without them.
    oracle_deals: tuple[Mapping[str, Any], ...] = ()
    clock: Mt5ServerClock | None = None


def _not_measurable(leg: LegName, what: str) -> LegResult:
    return LegResult(leg=leg, gap=None, passed=False, reason=f"not_measurable:{what}")


def leg_passes(gap: float) -> bool:
    """The one pass test for a return-gap leg: ``gap <= MT5_PARITY_TOLERANCE``. A gap
    exactly at the tolerance passes; the next float above it does not."""
    return gap <= MT5_PARITY_TOLERANCE


def _measured(leg: LegName, gap: float) -> LegResult:
    return LegResult(leg=leg, gap=gap, passed=leg_passes(gap), reason=None)


class WindowRefused(ValueError):
    """A comparison window that may not be judged. ``reason`` is a member of
    ``WINDOW_REFUSAL_REASONS``."""

    def __init__(self, reason: str) -> None:
        if reason not in WINDOW_REFUSAL_REASONS:
            raise ValueError("unknown window refusal reason")
        super().__init__(reason)
        self.reason = reason


# ------------------------------------------------------------------ explainers


def _attested_interval(friday: date) -> tuple[datetime, datetime]:
    start = datetime.combine(friday, time(WEEKEND_ATTESTED_FROM_UTC_HOUR), tzinfo=timezone.utc)
    end = datetime.combine(
        friday + timedelta(days=2), time(WEEKEND_ATTESTED_TO_UTC_HOUR), tzinfo=timezone.utc
    )
    return start, end


def _breaching_edges(ctx: ExplainerContext) -> tuple[date, ...]:
    """The window edges the breaching level and return legs depend on."""
    edges: list[date] = []
    for leg in ctx.breaching:
        if leg.leg == "start_level":
            edges.append(ctx.window.start)
        elif leg.leg == "end_level":
            edges.append(ctx.window.end)
        elif leg.leg == "cum_return":
            edges.extend((ctx.window.start, ctx.window.end))
    return tuple(edges)


def _edge_instant_mismatch(ctx: ExplainerContext) -> bool:
    """A breaching edge's mark was taken outside the interval the oracle's weekend
    reading is attested for, so the two numbers describe different instants."""
    for edge in _breaching_edges(ctx):
        if edge.weekday() != _FRIDAY:
            continue
        mark = our_mark(ctx.capture, ctx.ordinal, edge)
        if mark is None:
            continue
        lo, hi = _attested_interval(edge)
        if not lo <= mark.marked_at <= hi:
            return True
    return False


def _legs_under(
    ctx: ExplainerContext,
    *,
    deals: tuple[Mapping[str, Any], ...] | None = None,
    clock: Mt5ServerClock | None = None,
    realized_edges: frozenset[date] = frozenset(),
) -> tuple[LegResult, ...] | None:
    """Re-run the breached comparison under a counterfactual. ``None`` when the
    context lacks what the gate needs (a Gate A context with no oracle deals or no
    clock), which no explainer may treat as a match."""
    if ctx.window.gate == "A":
        use_clock = clock if clock is not None else ctx.clock
        use_deals = deals if deals is not None else ctx.oracle_deals
        if use_clock is None or not use_deals:
            return None
        return gate_a_legs(ctx.capture, ctx.ordinal, use_deals, ctx.window, use_clock)
    return gate_b_legs(
        ctx.capture, ctx.ordinal, ctx.readings, ctx.window, realized_edges=realized_edges
    )


def _clears(legs: tuple[LegResult, ...] | None) -> bool:
    """A counterfactual explains a breach only if the re-run clears EVERY leg. A leg
    that is still not measurable has ``passed=False``, so it never clears."""
    return legs is not None and len(legs) > 0 and all(leg.passed for leg in legs)


def _shifted(
    deals: tuple[Mapping[str, Any], ...], seconds: int
) -> tuple[Mapping[str, Any], ...] | None:
    """Every deal's wall time moved by ``seconds`` (a copy), or None when a deal's
    time is not a plain number."""
    out: list[Mapping[str, Any]] = []
    for deal in deals:
        moved = _finite(deal.get("time"))
        if moved is None:
            return None
        out.append({**deal, "time": int(moved) + seconds})
    return tuple(out)


def _clock_mismatch(ctx: ExplainerContext) -> bool:
    """Re-fold the oracle under the other DST rule, and with every deal time one
    hour earlier and one hour later. Any variant that clears every leg matches. The
    counterfactual only CLASSIFIES: the verdict stays RED (founder decision: refuse,
    never auto-correct)."""
    if ctx.window.gate != "A" or ctx.clock is None or not ctx.oracle_deals:
        return False
    base = ctx.clock
    for rule in ("eu", "us"):
        if base.rule == rule:
            continue
        if _clears(_legs_under(ctx, clock=server_clock_for_rule(rule))):
            return True
    for seconds in (-_SHIFT_SECONDS, _SHIFT_SECONDS):
        moved = _shifted(ctx.oracle_deals, seconds)
        if moved is not None and _clears(_legs_under(ctx, deals=moved)):
            return True
    return False


def _flipped(deal: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """The deal with its flow/trading kind flipped, or None when it cannot be
    classified. A flow becomes a type 1 trade with the same cash effect; a trade
    becomes a type 2 balance row carrying its cash effect as the amount."""
    try:
        kind = classify_deal(deal)
        cash = deal_cash_effect(deal)
    except Mt5DealClassificationError:
        return None
    if kind == "external_flow":
        return {**deal, "type": 1}
    return {**deal, "type": 2, "profit": cash, "swap": 0.0, "commission": 0.0, "fee": 0.0}


def _flow_placement(ctx: ExplainerContext) -> bool:
    """Flip each oracle deal dated inside the window, one at a time. Any single
    flip that clears every leg matches."""
    if ctx.window.gate != "A" or ctx.clock is None or not ctx.oracle_deals:
        return False
    for index, deal in enumerate(ctx.oracle_deals):
        try:
            day = date.fromisoformat(deal_utc_day(deal.get("time"), ctx.clock))
        except ValueError:
            continue
        if not ctx.window.start < day <= ctx.window.end:
            continue
        flipped = _flipped(deal)
        if flipped is None:
            continue
        variant = ctx.oracle_deals[:index] + (flipped,) + ctx.oracle_deals[index + 1 :]
        if _clears(_legs_under(ctx, deals=variant)):
            return True
    return False


def _pre_mark_realized_basis(ctx: ExplainerContext) -> bool:
    """Our stored mark includes open P&L and the oracle reading is a realized
    balance. Re-run with our level at the end edge, the start edge, then both, taken
    on a realized basis (level minus that mark's open P&L). Any variant that clears
    every leg matches."""
    if ctx.window.gate != "B":
        return False
    start = our_mark(ctx.capture, ctx.ordinal, ctx.window.start)
    end = our_mark(ctx.capture, ctx.ordinal, ctx.window.end)
    if not any(m is not None and m.open_pnl != 0.0 for m in (start, end)):
        return False
    for edges in (
        frozenset({ctx.window.end}),
        frozenset({ctx.window.start}),
        frozenset({ctx.window.start, ctx.window.end}),
    ):
        if _clears(_legs_under(ctx, realized_edges=edges)):
            return True
    return False


def _annualization_convention(ctx: ExplainerContext) -> bool:
    """Registered so that "every explainer ran" holds. No engine leg is an
    annualized ratio, so it never matches here; the reannualization match belongs to
    the surface matrix (``services/mt5_parity_findings.py``), which compares CAGR
    and Sharpe."""
    return False


# Ordered by priority. Each entry is a positive counterfactual match: it re-runs the
# breached legs under its own counterfactual and matches only if every leg clears.
EXPLAINERS: Final[tuple[tuple[Bucket, Callable[[ExplainerContext], bool]], ...]] = (
    (CLOCK_MISMATCH, _clock_mismatch),
    (FLOW_PLACEMENT, _flow_placement),
    (PRE_MARK_REALIZED_BASIS, _pre_mark_realized_basis),
    (EDGE_INSTANT_MISMATCH, _edge_instant_mismatch),
    (ANNUALIZATION_CONVENTION, _annualization_convention),
)


def classify_breach(ctx: ExplainerContext) -> tuple[Bucket, tuple[Bucket, ...]]:
    """The first matching bucket and every matching bucket.

    ``UNEXPLAINED`` is returned only after the loop has evaluated EVERY registered
    explainer and none matched. There is no default branch that returns a bucket.
    """
    matched: list[Bucket] = []
    for bucket, explainer in EXPLAINERS:
        if explainer(ctx):
            matched.append(bucket)
    if matched:
        return matched[0], tuple(matched)
    return UNEXPLAINED, ()


# --------------------------------------------------------------------- Gate B legs


def _equity_readings(readings: tuple[Reading, ...], edge: date) -> tuple[float, ...]:
    """Every oracle equity reading (statement or weekend close) dated that day.
    Empty when there is none, or when any of them is not a finite number: an
    unreadable reading is never dropped to leave the others standing."""
    found = [
        r
        for r in readings
        if r.id in _EQUITY_READING_IDS and r.as_of == edge.isoformat()
    ]
    if any(isinstance(r.value, str) for r in found):
        return ()
    values = tuple(float(r.value) for r in found)
    return values if all(math.isfinite(v) for v in values) else ()


def _readings_agree(values: tuple[float, ...], base: float) -> bool:
    """Several readings of one edge agree when their spread is within the tolerance,
    in points of ``base`` (the oracle's start equity). A lone reading always agrees."""
    return leg_passes((max(values) - min(values)) / base)


def _curve_return(returns: pd.Series, start: date, end: date) -> float | None:
    """prod(1 + r) - 1 over our stored daily returns dated in (start, end]."""
    index = pd.DatetimeIndex(returns.index)
    mask = (index > pd.Timestamp(start)) & (index <= pd.Timestamp(end))
    window = returns[mask]
    if len(window) == 0:
        return None
    return float((1.0 + window.astype(float)).prod() - 1.0)


def _realized(mark: MarkReading) -> MarkReading:
    return MarkReading(
        nav=mark.nav - mark.open_pnl,
        open_pnl=0.0,
        marked_at=mark.marked_at,
        unit=mark.unit,
    )


def gate_b_legs(
    capture: Capture,
    ordinal: str,
    worksheet_readings: tuple[Reading, ...],
    window: Window,
    *,
    realized_edges: frozenset[date] = frozenset(),
) -> tuple[LegResult, ...]:
    """The three Gate B legs for one account, each against ``MT5_PARITY_TOLERANCE``.

    ``E`` is equity in the account's unit. ``start_level`` and ``end_level`` are
    gaps in points of the oracle's start equity; ``cum_return`` carries the money
    gap AND the stored-curve gap and records the larger. Any missing input makes
    that leg not measurable, never a pass.

    ``realized_edges`` is a counterfactual used only by an explainer: at those edges
    our level is the stored NAV minus the mark's open P&L (a realized basis)."""
    if window.gate != "B":
        raise ValueError("gate_b_legs evaluates Gate B windows only")
    for reading in worksheet_readings:
        require_provenance(reading.provenance)

    mark_start: MarkReading | None = our_mark(capture, ordinal, window.start)
    mark_end: MarkReading | None = our_mark(capture, ordinal, window.end)
    if mark_start is not None and window.start in realized_edges:
        mark_start = _realized(mark_start)
    if mark_end is not None and window.end in realized_edges:
        mark_end = _realized(mark_end)
    # An edge may carry several equity readings (a broker statement AND a weekend
    # terminal reading on one Friday). None is preferred: every leg is judged against
    # every one of them, and readings that disagree with each other fail the leg.
    starts = _equity_readings(worksheet_readings, window.start)
    ends = _equity_readings(worksheet_readings, window.end)
    oracle_start = min(starts) if starts else None
    base_ok = oracle_start is not None and oracle_start > 0.0
    disagree_start = base_ok and not _readings_agree(starts, oracle_start or 0.0)
    disagree_end = bool(ends) and base_ok and not _readings_agree(ends, oracle_start or 0.0)

    if mark_start is None:
        start_leg = _not_measurable("start_level", "mark_start")
    elif oracle_start is None or not base_ok:
        start_leg = _not_measurable("start_level", "reading_start")
    elif disagree_start:
        start_leg = _not_measurable("start_level", "readings_disagree")
    else:
        start_leg = _measured(
            "start_level", max(abs(mark_start.nav - v) for v in starts) / oracle_start
        )

    if mark_end is None:
        end_leg = _not_measurable("end_level", "mark_end")
    elif not ends:
        end_leg = _not_measurable("end_level", "reading_end")
    elif oracle_start is None or not base_ok:
        end_leg = _not_measurable("end_level", "reading_start")
    elif disagree_end:
        end_leg = _not_measurable("end_level", "readings_disagree")
    else:
        end_leg = _measured(
            "end_level", max(abs(mark_end.nav - v) for v in ends) / oracle_start
        )

    if mark_start is None:
        cum_leg = _not_measurable("cum_return", "mark_start")
    elif mark_end is None:
        cum_leg = _not_measurable("cum_return", "mark_end")
    elif not starts or not ends or oracle_start is None or not base_ok:
        cum_leg = _not_measurable("cum_return", "reading")
    elif disagree_start or disagree_end:
        cum_leg = _not_measurable("cum_return", "readings_disagree")
    else:
        returns = our_daily_returns(capture, ordinal)
        r_curve = None if returns is None else _curve_return(returns, window.start, window.end)
        if r_curve is None:
            cum_leg = _not_measurable("cum_return", "returns")
        else:
            money_gap = max(
                abs((mark_end.nav - mark_start.nav) - (e - s)) / oracle_start
                for s in starts
                for e in ends
            )
            curve_gap = max(abs(r_curve - (e / s - 1.0)) for s in starts for e in ends)
            cum_leg = _measured("cum_return", max(money_gap, curve_gap))
    return (start_leg, end_leg, cum_leg)


# --------------------------------------------------------------------- Gate A legs
#
# Gate A judges days BEFORE the first stored mark (S) on a realized-balance basis,
# against the Report's deal ledger (D-A). It never invents a mark or an open P&L: our
# level at a day is rolled BACK from the realized terminal in the key_inputs payload,
# and the oracle level is the Balance column of the last deal on or before that day.


class _OracleUnusable(Exception):
    """The oracle deals cannot be folded (an undatable or unclassifiable deal, a
    missing Balance). Never leaves this module: it becomes a not-measurable leg."""


def _finite(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _day_amounts(
    payload: Mapping[str, Any], key: str, amount: str
) -> tuple[tuple[date, float], ...] | None:
    rows = payload.get(key)
    if not isinstance(rows, list):
        return None
    out: list[tuple[date, float]] = []
    for row in rows:
        if not isinstance(row, Mapping):
            return None
        value = _finite(row.get(amount))
        try:
            day = date.fromisoformat(str(row.get("utc_day_iso")))
        except ValueError:
            return None
        if value is None:
            return None
        out.append((day, value))
    return tuple(out)


@dataclass(frozen=True, slots=True)
class _OurBooks:
    terminal: float
    terminal_day: date
    pnl: tuple[tuple[date, float], ...]
    flows: tuple[tuple[date, float], ...]


def _books_from_payload(payload: Mapping[str, Any]) -> _OurBooks | None:
    terminal = _finite(payload.get("realized_terminal_usd"))
    try:
        terminal_day = date.fromisoformat(str(payload.get("realized_terminal_day")))
    except ValueError:
        return None
    pnl = _day_amounts(payload, "composed_day_pnl", "pnl_usd")
    flows = _day_amounts(payload, "composed_flows", "flow_usd")
    if terminal is None or pnl is None or flows is None:
        return None
    return _OurBooks(terminal=terminal, terminal_day=terminal_day, pnl=pnl, flows=flows)


def _our_books(capture: Capture, ordinal: str) -> _OurBooks | None:
    payload = our_key_inputs(capture, ordinal)
    return None if payload is None else _books_from_payload(payload)


def _our_level(books: _OurBooks, day: date) -> float | None:
    """Our NAV at the end of ``day``: the realized terminal less every composed P&L
    and flow dated after it (the telescoping identity ``P_t = NAV_t - NAV_{t-1} - F_t``).
    None for a day after the terminal day."""
    if day > books.terminal_day:
        return None
    later_pnl = sum(v for d, v in books.pnl if d > day)
    later_flow = sum(v for d, v in books.flows if d > day)
    return books.terminal - later_pnl - later_flow


def our_identity_ratio(key_inputs: Mapping[str, Any]) -> float | None:
    """``(realized_terminal - sum(pnl) - sum(flows)) / |earliest flow|``: about 0 for a
    ledger that starts at the account's inception. None when there is no flow or the
    first flow is 0."""
    books = _books_from_payload(key_inputs)
    if books is None or not books.flows:
        return None
    first = min(books.flows, key=lambda row: row[0])[1]
    if first == 0.0:
        return None
    residual = books.terminal - sum(v for _, v in books.pnl) - sum(v for _, v in books.flows)
    return residual / abs(first)


@dataclass(frozen=True, slots=True)
class _Oracle:
    """The Report's deals folded under one clock."""

    levels: tuple[tuple[float, int, date, float], ...]  # (time, index, day, balance)
    flows_by_day: Mapping[date, float]
    day_pnl: Mapping[date, float]


def _fold_oracle(deals: tuple[Mapping[str, Any], ...], clock: Mt5ServerClock) -> _Oracle:
    levels: list[tuple[float, int, date, float]] = []
    flows: dict[date, float] = {}
    try:
        for index, deal in enumerate(deals):
            moment = _finite(deal.get("time"))
            balance = _finite(deal.get("balance"))
            if moment is None or balance is None:
                raise _OracleUnusable
            day = date.fromisoformat(deal_utc_day(deal.get("time"), clock))
            levels.append((moment, index, day, balance))
            if classify_deal(deal) == "external_flow":
                flows[day] = flows.get(day, 0.0) + deal_cash_effect(deal)
        series = mt5_day_pnl(deals, server_utc_offset_s=clock)
    except ValueError as exc:  # Mt5DealClassificationError is a ValueError
        raise _OracleUnusable from exc
    day_pnl = {pd.Timestamp(i).date(): float(v) for i, v in series.items()}
    return _Oracle(levels=tuple(levels), flows_by_day=flows, day_pnl=day_pnl)


def _oracle_level(oracle: _Oracle, day: date) -> float | None:
    """The Balance of the last deal on or before ``day``; None when none is."""
    best: tuple[float, int, date, float] | None = None
    for row in oracle.levels:
        if row[2] <= day and (best is None or (row[0], row[1]) > (best[0], best[1])):
            best = row
    return None if best is None else best[3]


def oracle_identity_ratio(oracle_deals: tuple[Mapping[str, Any], ...]) -> float | None:
    """``(last Balance - sum(trading cash) - sum(flows)) / |earliest flow|``. None when
    there is no deal, no flow, a first flow of 0, or a deal that cannot be classified."""
    if not oracle_deals:
        return None
    trading = 0.0
    flows: list[tuple[float, int, float]] = []
    last: tuple[float, int, float] | None = None
    try:
        for index, deal in enumerate(oracle_deals):
            moment = _finite(deal.get("time"))
            balance = _finite(deal.get("balance"))
            if moment is None or balance is None:
                return None
            cash = deal_cash_effect(deal)
            if classify_deal(deal) == "external_flow":
                flows.append((moment, index, cash))
            else:
                trading += cash
            if last is None or (moment, index) > (last[0], last[1]):
                last = (moment, index, balance)
    except Mt5DealClassificationError:
        return None
    if last is None or not flows:
        return None
    first_flow = min(flows, key=lambda row: (row[0], row[1]))[2]
    if first_flow == 0.0:
        return None
    return (last[2] - trading - sum(f[2] for f in flows)) / abs(first_flow)


def identity_leg(our_ratio: float | None, oracle_ratio: float | None) -> LegResult:
    """The inception-identity leg: both ratios must be about 0, within
    ``MT5_INCEPTION_IDENTITY_BAND`` of the first deposit. Exactly at the band passes."""
    if our_ratio is None:
        return _not_measurable("inception_identity", "identity_ours")
    if oracle_ratio is None:
        return _not_measurable("inception_identity", "identity_oracle")
    gap = max(abs(our_ratio), abs(oracle_ratio))
    return LegResult(
        leg="inception_identity",
        gap=gap,
        passed=gap <= MT5_INCEPTION_IDENTITY_BAND,
        reason=None,
    )


def _native_unit_present(capture: Capture, ordinal: str) -> bool:
    return any(r.get("native_unit") is not None for r in account_rows(capture, ordinal, "marks"))


def _all_not_measurable(what: str) -> tuple[LegResult, ...]:
    return tuple(_not_measurable(leg, what) for leg in GATE_A_LEGS)


def gate_a_legs(
    capture: Capture,
    ordinal: str,
    oracle_deals: tuple[Mapping[str, Any], ...],
    window: Window,
    clock: Mt5ServerClock,
) -> tuple[LegResult, ...]:
    """The five Gate A legs in ``LegName`` order, each a gap in points of the oracle's
    level at the window start (``MT5_PARITY_TOLERANCE``), except the identity, which is
    a ratio to the first deposit (``MT5_INCEPTION_IDENTITY_BAND``).

    Realized-balance basis only: a missing input makes that leg not measurable and
    never a pass. The money legs compare money, not ``r_t``: the Report carries no
    position id, so the oracle fold uses the day-level rule on flow days while
    production used the timed rule. A native-unit account is never compared across
    units (the writer basis is USD, the Report is native)."""
    if window.gate != "A":
        raise ValueError("gate_a_legs evaluates Gate A windows only")
    if not oracle_deals:
        return _all_not_measurable("oracle_deals")
    try:
        oracle = _fold_oracle(oracle_deals, clock)
    except _OracleUnusable:
        return _all_not_measurable("oracle_deals")

    books = _our_books(capture, ordinal)
    unit_mismatch = _native_unit_present(capture, ordinal)
    base = _oracle_level(oracle, window.start)
    oracle_end = _oracle_level(oracle, window.end)
    base_ok = base is not None and base > 0.0
    our_start = None if books is None else _our_level(books, window.start)
    our_end = None if books is None else _our_level(books, window.end)

    def level_leg(
        leg: LegName,
        ours: float | None,
        theirs: float | None,
        ours_name: str,
        theirs_name: str,
    ) -> LegResult:
        if unit_mismatch:
            return _not_measurable(leg, "unit_mismatch")
        if books is None:
            return _not_measurable(leg, "key_inputs")
        if base is None or not base_ok:
            return _not_measurable(leg, "oracle_base")
        if theirs is None:
            return _not_measurable(leg, theirs_name)
        if ours is None:
            return _not_measurable(leg, ours_name)
        return _measured(leg, abs(ours - theirs) / base)

    start_leg = level_leg("start_level", our_start, base, "our_level_start", "oracle_level_start")
    end_leg = level_leg("end_level", our_end, oracle_end, "our_level_end", "oracle_level_end")

    def in_window(day: date) -> bool:
        return window.start < day <= window.end

    cum_leg: LegResult
    day_leg: LegResult
    if unit_mismatch:
        cum_leg = _not_measurable("cum_return", "unit_mismatch")
        day_leg = _not_measurable("day_placement", "unit_mismatch")
    elif books is None:
        cum_leg = _not_measurable("cum_return", "key_inputs")
        day_leg = _not_measurable("day_placement", "key_inputs")
    elif base is None or not base_ok:
        cum_leg = _not_measurable("cum_return", "oracle_base")
        day_leg = _not_measurable("day_placement", "oracle_base")
    else:
        if our_start is None or our_end is None or oracle_end is None:
            cum_leg = _not_measurable("cum_return", "level")
        else:
            flows_ours = sum(v for d, v in books.flows if in_window(d))
            flows_oracle = sum(v for d, v in oracle.flows_by_day.items() if in_window(d))
            money_ours = our_end - our_start - flows_ours
            money_oracle = oracle_end - base - flows_oracle
            cum_leg = _measured("cum_return", abs(money_ours - money_oracle) / base)

        ours_by_day: dict[date, float] = {}
        for d, v in books.pnl:
            if in_window(d):
                ours_by_day[d] = ours_by_day.get(d, 0.0) + v
        days = {d for d in oracle.day_pnl if in_window(d)} | set(ours_by_day)
        if not days:
            day_leg = _not_measurable("day_placement", "days")
        else:
            worst = 0.0
            breaching_days = 0
            for d in sorted(days):
                gap = abs(ours_by_day.get(d, 0.0) - oracle.day_pnl.get(d, 0.0)) / base
                worst = max(worst, gap)
                breaching_days += 0 if leg_passes(gap) else 1
            day_leg = LegResult(
                leg="day_placement",
                gap=worst,
                passed=breaching_days == 0,
                reason=None if breaching_days == 0 else f"{breaching_days}_days_breach",
            )

    payload = our_key_inputs(capture, ordinal)
    ident = identity_leg(
        None if payload is None else our_identity_ratio(payload),
        oracle_identity_ratio(oracle_deals),
    )
    return (start_leg, end_leg, cum_leg, ident, day_leg)


# ---------------------------------------------------------------- the window picker


def _mark_days(capture: Capture, ordinal: str) -> tuple[date, ...]:
    days: list[date] = []
    for row in account_rows(capture, ordinal, "marks"):
        try:
            days.append(date.fromisoformat(str(row.get("mark_day"))[:10]))
        except ValueError:
            continue
    return tuple(sorted(days))


def _first_mark_day(capture: Capture, ordinal: str) -> date | None:
    days = _mark_days(capture, ordinal)
    return days[0] if days else None


def _flow_days_in(
    capture: Capture,
    ordinal: str,
    oracle_deals: tuple[Mapping[str, Any], ...],
    clock: Mt5ServerClock,
    window: Window,
) -> bool:
    """True when a non-zero flow (ours or the oracle's) lands in ``(start, end]``."""
    books = _our_books(capture, ordinal)
    if books is not None and any(
        v != 0.0 and window.start < d <= window.end for d, v in books.flows
    ):
        return True
    for deal in oracle_deals:
        if classify_deal(deal) != "external_flow" or deal_cash_effect(deal) == 0.0:
            continue
        day = date.fromisoformat(deal_utc_day(deal.get("time"), clock))
        if window.start < day <= window.end:
            return True
    return False


def _deal_in_gap(
    deals: tuple[Mapping[str, Any], ...], clock: Mt5ServerClock, friday: date
) -> bool:
    """True when a deal sits inside the weekend interval of ``friday``. A deal whose
    instant cannot be resolved (a repeated or skipped broker hour) counts as inside."""
    lo, hi = _attested_interval(friday)
    for deal in deals:
        instant = deal_utc_instant_ms(deal, clock)
        if instant is None:
            # Only a deal near the weekend can be ambiguous; judge its day.
            day = date.fromisoformat(deal_utc_day(deal.get("time"), clock))
            if lo.date() <= day <= hi.date():
                return True
            continue
        moment = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=instant)
        if lo <= moment <= hi:
            return True
    return False


def validate_window(
    window: Window,
    *,
    capture: Capture,
    ordinal: str,
    readings: tuple[Reading, ...],
    oracle_deals: tuple[Mapping[str, Any], ...],
    clock: Mt5ServerClock,
    run_day: date,
) -> Window:
    """The window, or a ``WindowRefused`` naming why it may not be judged."""
    if window.start >= window.end:
        raise WindowRefused("edge_order")
    if window.end >= run_day:
        raise WindowRefused("window_not_closed")
    first_mark = _first_mark_day(capture, ordinal)
    if window.gate == "A":
        # Without any mark there is no S, so "pre-S" cannot be shown: refuse.
        if first_mark is None or window.end >= first_mark:
            raise WindowRefused("gate_a_reaches_first_mark")
        return window
    if first_mark is not None and window.start < first_mark:
        raise WindowRefused("gate_b_edge_before_first_mark")
    for edge in (window.start, window.end):
        if our_mark(capture, ordinal, edge) is None:
            raise WindowRefused("edge_without_mark")
    for edge in (window.start, window.end):
        if not _equity_readings(readings, edge):
            raise WindowRefused("edge_without_reading")
    if _flow_days_in(capture, ordinal, oracle_deals, clock, window):
        raise WindowRefused("flow_in_gate_b_window")
    for edge in (window.start, window.end):
        if edge.isoweekday() == 5 and _deal_in_gap(oracle_deals, clock, edge):
            raise WindowRefused("deal_in_edge_gap")
    return window


def _last_friday_before(day: date) -> date:
    candidate = day - timedelta(days=1)
    while candidate.isoweekday() != 5:
        candidate -= timedelta(days=1)
    return candidate


def propose_windows(
    *,
    capture: Capture,
    ordinal: str,
    readings: tuple[Reading, ...],
    oracle_deals: tuple[Mapping[str, Any], ...],
    clock: Mt5ServerClock,
    run_day: date,
    keep_refused: bool = False,
) -> tuple[Window, ...]:
    """At most one Gate A and one Gate B window, or none.

    Gate A runs from the first UTC day holding a trading deal to the last Friday
    strictly before S. Gate B is the valid Friday pair with the latest end, then the
    longest span.

    With ``keep_refused`` every gate yields exactly one window, Gate A then Gate B: a
    gate with no valid window yields the candidate the picker would have used, which
    ``evaluate_account`` then refuses by its real reason, or a window carrying
    ``refusal="no_candidate_window"`` when not even a candidate exists. A gate the
    picker cannot build is then a RED verdict, never an absent one."""

    def valid(window: Window) -> bool:
        try:
            validate_window(
                window,
                capture=capture,
                ordinal=ordinal,
                readings=readings,
                oracle_deals=oracle_deals,
                clock=clock,
                run_day=run_day,
            )
        except ValueError:  # WindowRefused, or a deal that cannot be dated or classified
            return False
        return True

    no_candidate = "no_candidate_window"
    proposed: list[Window] = []
    first_mark = _first_mark_day(capture, ordinal)
    gate_a = Window("A", run_day, run_day, refusal=no_candidate)
    if first_mark is not None and oracle_deals:
        try:
            trading_days = [
                date.fromisoformat(deal_utc_day(d.get("time"), clock))
                for d in oracle_deals
                if classify_deal(d) == "trading"
            ]
        except ValueError:
            trading_days = []
        if trading_days:
            gate_a = Window("A", min(trading_days), _last_friday_before(first_mark))
    if gate_a.refusal is None and valid(gate_a):
        proposed.append(gate_a)
    elif keep_refused:
        proposed.append(gate_a)

    fridays = sorted(d for d in _mark_days(capture, ordinal) if d.isoweekday() == 5)
    read_fridays = [d for d in fridays if _equity_readings(readings, d)]
    best: Window | None = None
    for i, start in enumerate(read_fridays):
        for end in read_fridays[i + 1 :]:
            candidate = Window("B", start, end)
            if not valid(candidate):
                continue
            if best is None or (end, end - start) > (best.end, best.end - best.start):
                best = candidate
    if best is not None:
        proposed.append(best)
    elif keep_refused:
        # The latest Friday pair is the picker's first choice: refuse it by its real reason.
        proposed.append(
            Window("B", fridays[-2], fridays[-1])
            if len(fridays) >= 2
            else Window("B", run_day, run_day, refusal=no_candidate)
        )
    return tuple(proposed)


# ---------------------------------------------------------------------- verdicts


@dataclass(frozen=True, slots=True)
class AccountVerdict:
    """One account's verdict. Holds a label, a gate, a day count, leg results (each a
    ratio or None), a bucket and reason codes: no amount, no id."""

    label: str
    gate: Literal["A", "B"]
    window_days: int
    legs: tuple[LegResult, ...]
    bucket: Bucket
    matched: tuple[Bucket, ...]
    reason: str | None
    passed: bool
    # The worksheet account whose readings were compared against this account's
    # capture, recorded so a cross-label binding is visible in the verdict. None when
    # the verdict was not built through ``evaluate_windows``.
    oracle_label: str | None = None

    def __post_init__(self) -> None:
        # A label names an account (MM2, FX-AI_V, SYN-A). A long digit run is a login.
        for label in (self.label, self.oracle_label):
            if label is None:
                continue
            if not _LABEL_RE.match(label) or _LONG_DIGIT_RUN_RE.search(label):
                raise ValueError("account label is not a plain account label")


@dataclass(frozen=True, slots=True)
class Verdict:
    accounts: tuple[AccountVerdict, ...]
    rehearsal: bool
    run_day: date

    @property
    def final_green(self) -> bool:
        """The only reading of a verdict as a parity pass. A rehearsal (a synthetic
        oracle) is never final, whatever its legs say, and a verdict that judged no
        account is not green either. Every account needs BOTH Gate A and Gate B in the
        verdict and passing: a gate that is absent is a gate never judged."""
        gates: dict[str, set[str]] = {}
        for a in self.accounts:
            gates.setdefault(a.label, set()).add(a.gate)
        return (
            (not self.rehearsal)
            and bool(self.accounts)
            and all(a.passed for a in self.accounts)
            and all(seen == {"A", "B"} for seen in gates.values())
        )


class OracleBindingRefused(ValueError):
    """A capture account compared against another account's oracle readings, on a
    worksheet that is not synthetic. Only a rehearsal may do that."""


def _refused_verdict(
    label: str, window: Window, reason: str
) -> AccountVerdict:
    return AccountVerdict(
        label=label,
        gate=window.gate,
        window_days=max((window.end - window.start).days, 0),
        legs=(),
        bucket=UNEXPLAINED,
        matched=(),
        reason=reason,
        passed=False,
    )


def evaluate_account(
    capture: Capture,
    ordinal: str,
    worksheet: Worksheet,
    window: Window,
    *,
    oracle_deals: tuple[Mapping[str, Any], ...] | None = None,
    clock: Mt5ServerClock | None = None,
    run_day: date | None = None,
) -> AccountVerdict:
    """One captured account's verdict for one window.

    ``oracle_deals``, ``clock`` and ``run_day`` are supplied together. With them the
    window is validated first and a refusal becomes a RED verdict
    (``window_refused:<reason>``), never a skipped account. Gate A requires them. A
    Gate B call that omits all three keeps plan 01's behaviour: no window validation
    and no deal-based check."""
    label = capture.labels[ordinal]
    if window.refusal is not None:
        return _refused_verdict(label, window, f"window_refused:{window.refusal}")
    readings = worksheet.accounts.get(label, ())
    supplied = (oracle_deals is not None, clock is not None, run_day is not None)
    if any(supplied) and not all(supplied):
        raise ValueError("oracle_deals, clock and run_day are supplied together")
    if window.gate == "A" and not all(supplied):
        raise ValueError("a Gate A evaluation requires oracle_deals, clock and run_day")

    deals: tuple[Mapping[str, Any], ...] = ()
    if oracle_deals is not None and clock is not None and run_day is not None:
        deals = oracle_deals
        try:
            validate_window(
                window,
                capture=capture,
                ordinal=ordinal,
                readings=readings,
                oracle_deals=oracle_deals,
                clock=clock,
                run_day=run_day,
            )
        except WindowRefused as refused:
            return _refused_verdict(label, window, f"window_refused:{refused.reason}")
        except Mt5DealClassificationError:
            return _refused_verdict(label, window, "oracle_deals_unclassifiable")
        except ValueError:
            return _refused_verdict(label, window, "oracle_deals_undatable")

    legs: tuple[LegResult, ...]
    if window.gate == "A":
        assert clock is not None  # narrowed by the check above
        legs = gate_a_legs(capture, ordinal, deals, window, clock)
    elif oracle_deals is not None and not oracle_deals:
        # Validated, but with no oracle deal the flow and weekend-gap checks were
        # vacuous: nothing about this account's oracle is established.
        legs = tuple(_not_measurable(leg, "oracle_deals") for leg in GATE_B_LEGS)
    else:
        legs = gate_b_legs(capture, ordinal, readings, window)
    window_days = (window.end - window.start).days
    breaching = tuple(leg for leg in legs if not leg.passed)
    if not breaching:
        return AccountVerdict(
            label=label,
            gate=window.gate,
            window_days=window_days,
            legs=legs,
            bucket=WITHIN_TOLERANCE,
            matched=(),
            reason=None,
            passed=True,
        )
    ctx = ExplainerContext(
        capture=capture,
        ordinal=ordinal,
        readings=readings,
        window=window,
        breaching=breaching,
        oracle_deals=deals,
        clock=clock,
    )
    bucket, matched = classify_breach(ctx)
    unmeasurable = [leg for leg in breaching if leg.reason is not None and leg.gap is None]
    # The breaching legs in LegName order: a name for a measured breach, the
    # not_measurable reason for a leg that could not be measured.
    reason = ";".join(
        leg.reason if leg.gap is None and leg.reason is not None else leg.leg
        for leg in breaching
    )
    return AccountVerdict(
        label=label,
        gate=window.gate,
        window_days=window_days,
        legs=legs,
        bucket=bucket,
        matched=matched,
        reason=reason,
        passed=bucket in PASSING_BUCKETS and not unmeasurable,
    )


def evaluate_windows(
    capture: Capture,
    ordinal: str,
    worksheet: Worksheet,
    windows: tuple[Window, ...],
    *,
    oracle_deals: tuple[Mapping[str, Any], ...],
    clock: Mt5ServerClock,
    run_day: date,
    oracle_label: str | None = None,
    capture_synthetic: bool = False,
) -> Verdict:
    """One account judged on every window, as a ``Verdict``.

    ``oracle_label`` names the worksheet account whose readings stand in for this
    capture account (default: its own label). A different label is allowed only on a
    synthetic worksheet (``OracleBindingRefused`` otherwise), and the label used is
    recorded on every account verdict. ``Verdict.rehearsal`` is the worksheet's
    ``synthetic`` flag, or ``capture_synthetic`` (a capture materialised from a
    synthetic bundle): either side synthetic makes the verdict a rehearsal. An
    account whose ``trade_mode`` reading is not exactly ``real`` is RED on every window
    (``trade_mode_not_real``)."""
    capture_label = capture.labels[ordinal]
    used = capture_label if oracle_label is None else oracle_label
    view = worksheet
    if used != capture_label:
        if not worksheet.synthetic:
            raise OracleBindingRefused(
                "a real worksheet cannot be bound to a different account label"
            )
        readings = worksheet.accounts.get(used)
        if readings is None:
            raise OracleBindingRefused("worksheet has no account for the oracle label")
        view = Worksheet(synthetic=worksheet.synthetic, accounts={capture_label: readings})
    accounts = tuple(
        replace(
            evaluate_account(
                capture,
                ordinal,
                view,
                window,
                oracle_deals=oracle_deals,
                clock=clock,
                run_day=run_day,
            ),
            oracle_label=used,
        )
        for window in windows
    )
    # A demo account does not count as the run (MT5-08): every verdict goes RED by name.
    trade_modes = [r.value for r in view.accounts.get(capture_label, ()) if r.id == "trade_mode"]
    if trade_modes != ["real"]:
        accounts = tuple(
            replace(a, passed=False, reason="trade_mode_not_real") for a in accounts
        )
    return Verdict(
        accounts=accounts, rehearsal=worksheet.synthetic or capture_synthetic, run_day=run_day
    )


def ratio_3sf(x: float | None) -> str:
    """A ratio to three significant figures, or ``n/a`` when there is none."""
    if x is None or not math.isfinite(x):
        return "n/a"
    return format(x, ".3g")


def verdict_to_json(v: Verdict) -> dict[str, Any]:
    """The verdict as JSON-ready data. Only a ``Verdict`` is accepted: a mapping,
    which could carry keys the typed object cannot, is refused."""
    if not isinstance(v, Verdict):
        raise TypeError("verdict_to_json accepts a Verdict only")
    return {
        "rehearsal": v.rehearsal,
        "final_green": v.final_green,
        "run_day": v.run_day.isoformat(),
        "accounts": [
            {
                "label": a.label,
                "oracle_label": a.oracle_label,
                "gate": a.gate,
                "window_days": a.window_days,
                "bucket": a.bucket,
                "matched": list(a.matched),
                "reason": a.reason,
                "passed": a.passed,
                "legs": [
                    {
                        "leg": leg.leg,
                        "gap_3sf": ratio_3sf(leg.gap),
                        "passed": leg.passed,
                        "reason": leg.reason,
                    }
                    for leg in a.legs
                ],
            }
            for a in sorted(v.accounts, key=lambda a: a.label)
        ],
    }


def render_verdict_markdown(v: Verdict) -> str:
    """The tracked verdict document, rendered by code from the typed verdict."""
    if not isinstance(v, Verdict):
        raise TypeError("render_verdict_markdown accepts a Verdict only")
    lines = [REHEARSAL_HEADER, ""] if v.rehearsal else []
    lines += [
        "# MT5 parity verdict",
        "",
        "Rehearsal: " + ("yes, a synthetic oracle: not a parity result" if v.rehearsal else "no"),
        f"Accounts: {len(v.accounts)}",
    ]
    for a in sorted(v.accounts, key=lambda a: a.label):
        lines += [
            "",
            f"## {a.label} (gate {a.gate})",
            "",
            f"- window days: {a.window_days}",
            f"- bucket: {a.bucket}",
            "- matched: " + (", ".join(a.matched) if a.matched else "none"),
            f"- passed: {'yes' if a.passed else 'no'}",
            f"- reason: {a.reason if a.reason else 'none'}",
        ]
        if a.oracle_label is not None:
            lines.append(f"- oracle label: {a.oracle_label}")
        for leg in a.legs:
            lines.append(
                f"- leg {leg.leg}: {'pass' if leg.passed else 'fail'}, gap {ratio_3sf(leg.gap)}"
            )
    return "\n".join(lines) + "\n"
