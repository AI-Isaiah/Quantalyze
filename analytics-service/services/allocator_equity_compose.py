"""115.1 composition layer — supplies real inputs to the FROZEN P115 core and
assembles the persisted display-row payload.

NEVER re-derives blend / seam / replay math (every number comes from
``services.allocator_equity_derive`` — the ONLY derivation source) and NEVER writes
I/O (the job handler in ``job_worker.py`` owns reads + upserts). This module is the
single place the FOUR P115 carry-ins are wired:

  #1/#4  SEGMENT-WISE BLEND / exclusive-only EXCLUSIVE_FILL — ``blend_concurrent_returns``
         is fed ONE ``Segment`` at a time (via ``segment_coverage``), so a key's
         exclusive lead/tail day is a single-key passthrough, NOT a full-weight 0-fill.
         Per-key series are dense calendar-daily, so within a coverage segment
         ``exclusive_fill_days == 0`` STRUCTURALLY — the flag becomes a regression
         canary (we RAISE if it ever fires), never a never-green display gate.
  #2     SHARED SEAM LIST — the SAME ``seg.seams`` object feeds BOTH
         ``build_allocator_ledger`` and ``allocator_equity_curve`` so the ledger and
         the curve cannot disagree on rotation ownership (the MEDIUM-6 double-count
         guard is only load-bearing when they share).
  #3     ISO-STRING DAY INDEX — every series index is a bare ``YYYY-MM-DD`` string;
         the frozen core hard-asserts this at its boundary and we let the
         ``NavReconstructionError`` propagate (never coerce a ``DatetimeIndex``).
  TRAP   DROP UNANCHORED KEYS FIRST — before ``segment_coverage``, so the shared seam
         list can never reference a key the anchored curve dropped (the MEDIUM-6
         stray-key guard would otherwise raise on a legitimate no-anchor key).

No raw USD magnitudes ever enter a log or a raise string (T-115-05 rule,
``allocator_equity_derive.py``): every structural refusal carries counts/day-indices
only. WR-02: no headline cumulative return is derived from the curve (the curve
deliberately drops day-0); the only scalars surfaced are the KEPT Dietz/MWR cashflow
metrics from the unified ledger.
"""
from __future__ import annotations

import logging
import math
from bisect import bisect_right
from collections.abc import Collection, Mapping, Sequence
from datetime import date, datetime, timezone
from typing import Any, NamedTuple

import pandas as pd

from services.allocator_equity_derive import (
    DegradeReason,
    KeyEquity,
    LedgerScalars,
    Seam,
    _is_trustworthy,
    allocator_equity_curve,
    blend_concurrent_returns,
    build_allocator_ledger,
    mwr_and_dietz_from_ledger,
    replay_key_equity,
    segment_coverage,
)
from services.external_flows import ExternalFlow
from services.nav_twr import NavReconstructionError

logger = logging.getLogger(__name__)

# Benign (does not flip is_trustworthy). A day whose prior-capital denominator is
# not positive has no return — emitting one would invent a number from no capital.
_SKIPPED_NONPOSITIVE_DENOMINATOR = "skipped_nonpositive_denominator"
# Reported, not blocking (167.1.2 C2 SFH-10): a key-day inside the key's own
# coverage with no return row AND no flow (a gap in its csv_daily_returns). The
# key's level is carried with r = 0, as before; the flag says it happened.
_MISSING_RETURN_INSIDE_COVERAGE = "missing_return_inside_coverage"
# Benign (167.1.2 plan 09, D-05). A departed key's history is in the book up to
# its end day. Its leaving is an exit, never a return and never a carried level.
_DEPARTED_HISTORY_INCLUDED = "departed_history_included"
# Benign (164.6.6.2 D-13). A key whose account is measured in its own non-USD unit (a BTC
# MT5 account) has a null anchor with reason ``native_unit`` and is left out of the USD
# book. The omission is named, never silent; the reason shown on the dashboard is the
# positions poll's ``MT5_NON_USD_NOTE``.
_NATIVE_UNIT_KEY_OMITTED = "native_unit_key_omitted"
_NATIVE_UNIT_REASON = "native_unit"
# Benign (164.6.6.2.1 D-09, D-20). A BTC key is in the book at its USD values, but a day with no
# stored BTC close cannot be priced. The key is left out of that day BY NAME, never priced at a
# neighbouring close and never carried: after its last priced day (mechanism T1, the existing
# departed-key exit), on an interior unpriced day (mechanism I2), or entirely when nothing could
# be priced at all. ``native_unpriced`` is a null-anchor reason only for that last case.
_NATIVE_UNPRICED_KEY_OMITTED = "native_unpriced_key_omitted"
_NATIVE_UNPRICED_REASON = "native_unpriced"


class PortfolioReturns(NamedTuple):
    """``portfolio_returns``' result. Counts carry no USD figure.

    ``skipped_nonpositive_days``: days omitted because the prior-capital
    denominator was not positive (benign). ``nonfinite_days``: days omitted
    because a level, a return or the sum was non-finite (blocking; SFH-10).
    ``missing_return_days``: key-days inside a key's coverage with no level
    (no return row and no flow), read as r = 0 on the carried level (SFH-10).
    ``undefined_return_days``: key-days the TWR writer left out of the stored
    returns (167.1.2.2 D-15 gives them a level, from their stored P&L), left out of
    that day's sums too (round-1 WR-01). Not r = 0: that day's return is undefined,
    and 0 would be a fabricated flat day in the KPIs."""

    rows: list[dict[str, Any]]
    skipped_nonpositive_days: int
    nonfinite_days: int
    missing_return_days: int
    undefined_return_days: int = 0


class NativeKeyInputs(NamedTuple):
    """The native-unit fields a BTC key's ``key_inputs`` row carries (164.6.6.2.1).

    ``priced_through`` is the last day the key has a USD return (the day of its realized
    terminal); ``unpriced_close_day`` the one live close its anchor lacks, set only when the
    anchor is NULL ``native_unpriced``. ``unpriced_days`` are the days a missing close left out
    of its USD series (an interior hole), and ``segment_terminals`` the realized USD level on the
    last priced day BEFORE each such hole, ``((ISO day, USD), ...)`` oldest first: the level the
    series before the hole is rolled back from (see ``hole_segment_ends``)."""

    priced_through: str | None
    unpriced_close_day: str | None
    unpriced_days: tuple[str, ...] = ()
    segment_terminals: tuple[tuple[str, float], ...] = ()


def _strict_iso_day(raw: Any, what: str) -> str:
    """An ISO ``YYYY-MM-DD`` day, exactly as written. ``date.fromisoformat`` also accepts
    other spellings (``20261008``) on some Python versions, which would not match the
    writer's day keys, so the round trip must reproduce the input."""
    if not isinstance(raw, str):
        raise TypeError(f"key_inputs {what}: not a string")
    try:
        iso = date.fromisoformat(raw).isoformat()
    except ValueError:
        # Re-raised without the stdlib text, which echoes the stored value: the worker logs
        # this message to name the field, and a stored value is not ours to print.
        raise ValueError(f"key_inputs {what}: not an ISO day") from None
    if iso != raw:
        raise ValueError(f"key_inputs {what}: not an ISO day")
    return iso


def read_native_key_inputs(payload: Mapping[str, Any]) -> NativeKeyInputs | None:
    """The native-unit fields of a ``key_inputs`` payload, or ``None`` for a USD key (no
    ``native_unit``). The JSONB is worker-written but untrusted (T-164.6.6.2.1-23): a present
    but malformed field raises ``ValueError`` / ``TypeError`` so the caller can leave the key
    OUT of the book by name, never read a guess as a price."""
    unit = payload.get("native_unit")
    if unit is None:
        return None
    if not isinstance(unit, str) or not unit:
        raise TypeError("key_inputs native_unit: not a unit code")
    through = payload.get("priced_through")
    close_day = payload.get("unpriced_close_day")
    raw_days = payload.get("unpriced_days")
    if raw_days is not None and not isinstance(raw_days, list):
        raise TypeError("key_inputs unpriced_days: not a list")
    days = tuple(sorted({_strict_iso_day(d, "unpriced_days") for d in raw_days or ()}))
    raw_terminals = payload.get("segment_terminals")
    if raw_terminals is not None and not isinstance(raw_terminals, list):
        raise TypeError("key_inputs segment_terminals: not a list")
    terminals: dict[str, float] = {}
    for row in raw_terminals or ():
        day = _strict_iso_day(row["utc_day_iso"], "segment_terminals")
        level = row["level_usd"]
        # ``float(True) == 1.0``: a JSON boolean must not be read as a dollar.
        if isinstance(level, bool) or not isinstance(level, (int, float)):
            raise TypeError("key_inputs segment_terminals: non-numeric level")
        if not math.isfinite(float(level)) or float(level) <= 0.0:
            raise ValueError("key_inputs segment_terminals: level is not a positive number")
        if day in terminals:
            raise ValueError("key_inputs segment_terminals: duplicate day")
        terminals[day] = float(level)
    return NativeKeyInputs(
        None if through is None else _strict_iso_day(through, "priced_through"),
        None if close_day is None else _strict_iso_day(close_day, "unpriced_close_day"),
        days,
        tuple(sorted(terminals.items())),
    )


def hole_segment_ends(event_days: Collection[str], unpriced_days: Collection[str]) -> list[str]:
    """The event days that END a segment before an interior unpriced stretch (a hole).

    ``event_days`` are the days a key's USD series says anything about (a return, a flow or a
    dropped-day P&L); a day in ``unpriced_days`` is never an event, since its close is missing
    (or its predecessor's is). Two consecutive events with an unpriced day strictly between them
    are separated by a hole, and the earlier one is returned. An unpriced day before the first
    event or after the last separates nothing. ONE definition, used by the writer (which stores
    the realized USD level on each of these days) and by the compose (which needs a level on
    exactly these days), so the two cannot disagree on where a hole is."""
    unpriced = sorted(set(unpriced_days))
    events = sorted(set(event_days) - set(unpriced))
    ends: list[str] = []
    for earlier, later in zip(events, events[1:]):
        nxt = bisect_right(unpriced, earlier)
        if nxt < len(unpriced) and unpriced[nxt] < later:
            ends.append(earlier)
    return ends


def _bool_flag_tokens(flags: Mapping[str, Any]) -> set[str]:
    """The set of flag names whose value is the boolean ``True`` — a JSON-safe token
    summary for the payload's ``flags`` list. Count / list flags (e.g.
    ``exclusive_fill_days``, ``dropped_keys``) are intentionally excluded: their
    detail lives in ``degrade_reasons`` / the curve, and mixing scalars into a string
    token list would leak structure (and USD-free counts are diagnostics, not tokens)."""
    return {k for k, v in flags.items() if v is True}


def _current_equity_weights(
    keys: Sequence[str], anchors_by_key: Mapping[str, float | None]
) -> dict[str, float]:
    """Static current-equity share weights ``w_k = anchor_k / Σ anchor`` over the
    anchored keys (negative equity clamps to 0, mirroring the core / queries.ts). On
    an all-zero mass the raw (all-zero) map is returned so the core emits the honest
    ZERO_WEIGHT_MASS degrade rather than a fabricated equal-weight curve."""
    raw = {
        k: (max(0.0, float(v)) if (v := anchors_by_key[k]) is not None else 0.0)
        for k in keys
    }
    total = sum(raw.values())
    if total <= 0.0:
        return raw
    return {k: raw[k] / total for k in keys}


def portfolio_returns(
    per_key_equity: Mapping[str, KeyEquity],
    per_key_returns: Mapping[str, pd.Series],
    departed_keys: Collection[str] = (),
    dropped_days_by_key: Mapping[str, Collection[str]] | None = None,
) -> PortfolioReturns:
    """D-06 book returns: ``r_t = Σ_k E_{k,t−1}·r_{k,t} / Σ_k E_{k,t−1}``.

    Sums only keys that have a level on both the previous union day and ``t``.
    A key's first day is a join (no prior level, so it is not in the sum). A
    non-rotated key whose own series has ended keeps its last level with
    ``r = 0`` (stale-mark carry — never a drop to $0, and never a return). A
    rotated-out key (disjoint coverage seam, the same classification the $-curve
    uses) stops: no level after its last day, so a departure is not a return.
    A day whose denominator is not positive is omitted and counted (the caller
    logs it and raises a benign flag). A day with a non-finite level, return or
    sum is omitted and counted apart (the caller makes it a blocking degrade
    reason). A key's level days are its return days plus its flow days (the
    replay unions them), so a day inside the key's coverage with NO level has
    neither a return row nor a flow: a gap. The key's level is carried with
    r = 0 there, as for a flow-only day, and the key-day is counted so the
    caller can report it. ``dropped_days_by_key`` (167.1.2.2 round-1 WR-01) names, per key,
    the days its writer left out of the stored returns because its prior capital could
    not be a denominator (the funding day, a day whose flow dominates the prior NAV, a
    dust or P&L-dominated day). D-15 gave those days a LEVEL, but they have no return: the
    day's P&L is inside the level jump and ``E_{t-1}`` is not a base to divide it by. The
    key therefore sits out that day's sums, exactly as a key sits out the day it joins,
    and the key-day is counted (``undefined_return_days``). It is never read as r = 0,
    which would show a flat day the account did not have; a day on which NO key has a
    defined return is absent from the result. ``departed_keys`` (167.1.2 plan 09, D-05) are keys
    whose history ended on the last day of their (already clipped) series: they
    are treated as rotated out, so on the next day they leave both sums instead
    of carrying their last level. Pure: no I/O.
    """
    level_by_key: dict[str, dict[str, float]] = {}
    equity_by_key: dict[str, pd.Series] = {}
    first_day: dict[str, str] = {}
    last_day: dict[str, str] = {}
    for key, key_equity in per_key_equity.items():
        series = key_equity.equity
        if series is None or len(series) == 0:
            continue
        day_map = {str(day): float(level) for day, level in series.items()}
        if not day_map:
            continue
        ordered = sorted(day_map)
        level_by_key[key] = day_map
        equity_by_key[key] = series
        first_day[key] = ordered[0]
        last_day[key] = ordered[-1]
    if not level_by_key:
        return PortfolioReturns([], 0, 0, 0)

    return_by_key: dict[str, dict[str, float]] = {
        key: {str(day): float(value) for day, value in series.items()}
        for key, series in per_key_returns.items()
    }
    # Same seam rule as allocator_equity_curve with no explicit seams: only a
    # DISJOINT coverage handoff is a rotation. An overlapped key that ends early
    # is still held, so its level carries (r = 0). A rotated-out key does not.
    rotated_out: set[str] = set(departed_keys)
    for seam in segment_coverage(equity_by_key).seams:
        rotated_out.update(seam.prev_keys)

    def _level_on(key: str, day: str) -> float | None:
        day_map = level_by_key[key]
        if day < first_day[key]:
            return None
        if day in day_map:
            return day_map[day]
        if day > last_day[key]:
            if key in rotated_out:
                return None
            return day_map[last_day[key]]
        prior = [known for known in day_map if known <= day]
        if not prior:
            return None
        return day_map[max(prior)]

    def _return_on(key: str, day: str) -> float:
        # Past the key's own series the level is carried and the return is 0.
        # A flow-only day inside the series also has no return row: r = 0.
        if day not in level_by_key[key]:
            return 0.0
        raw = return_by_key.get(key, {}).get(day)
        if raw is None:
            return 0.0
        return raw

    undefined_days = {
        key: frozenset(str(d) for d in days)
        for key, days in (dropped_days_by_key or {}).items()
    }
    union = sorted({day for day_map in level_by_key.values() for day in day_map})
    rows: list[dict[str, Any]] = []
    skipped = 0
    nonfinite = 0
    missing = 0
    undefined = 0
    for index in range(1, len(union)):
        prev, day = union[index - 1], union[index]
        numer = 0.0
        denom = 0.0
        poison = False
        excluded = 0
        for key in level_by_key:
            equity_prev = _level_on(key, prev)
            equity_day = _level_on(key, day)
            if equity_prev is None or equity_day is None:
                continue
            if first_day[key] < day < last_day[key] and day not in level_by_key[key]:
                missing += 1
            if day in level_by_key[key] and day in undefined_days.get(key, ()):
                undefined += 1
                excluded += 1
                continue
            ret = _return_on(key, day)
            if (
                not math.isfinite(equity_prev)
                or not math.isfinite(equity_day)
                or not math.isfinite(ret)
            ):
                poison = True
                break
            numer += equity_prev * ret
            denom += equity_prev
        if poison or not math.isfinite(denom) or not math.isfinite(numer):
            nonfinite += 1
            continue
        if excluded and denom == 0.0:
            # Every key with a level on this day sat it out (undefined return): there is
            # no book return to report, and that is not a non-positive denominator.
            continue
        if not (denom > 0.0):
            skipped += 1
            continue
        value = numer / denom
        if not math.isfinite(value):
            nonfinite += 1
            continue
        rows.append({"date": day, "r": value})
    return PortfolioReturns(rows, skipped, nonfinite, missing, undefined)


def _clip_through(series: pd.Series, end_day: str) -> pd.Series:
    """The part of an ISO-day series on or before ``end_day`` (order kept)."""
    return series[[str(day) <= end_day for day in series.index]]


def _departure_seams(
    equity_by_key: Mapping[str, pd.Series],
    departed: Collection[str],
    already_rotated: Collection[str],
) -> list[Seam]:
    """One exit seam per departed key the coverage does not already rotate out.

    ``allocator_equity_curve`` (frozen) carries a key past its last day unless a
    seam names it in ``prev_keys``. A departed key that still overlaps a counted
    key gets no seam from ``segment_coverage`` (the covering sets share a key),
    so its last level would carry. This seam is how the frozen core's own
    rotated-out rule expresses the exit: 0 after its last day. ``next_keys`` are
    the keys that cover the next union day, all anchored, so the MEDIUM-6
    stray-key guard holds. A key whose last day is the book's last day has no
    exit inside the window and gets no seam.

    Curve only. The ledger's seam formula books a redeployment into
    ``next_keys``, which an exit is not; the caller books the exit as an outflow
    instead."""
    union = sorted({str(d) for s in equity_by_key.values() for d in s.index})
    seams: list[Seam] = []
    for key in sorted(departed):
        if key in already_rotated or key not in equity_by_key:
            continue
        last = max(str(d) for d in equity_by_key[key].index)
        later = [day for day in union if day > last]
        if not later:
            continue
        nxt = later[0]
        next_keys = tuple(
            sorted(
                k
                for k, s in equity_by_key.items()
                if nxt in {str(d) for d in s.index}
            )
        )
        seams.append(
            Seam(
                prev_last_day=last,
                next_first_day=nxt,
                gap_days=(date.fromisoformat(nxt) - date.fromisoformat(last)).days - 1,
                prev_keys=(key,),
                next_keys=next_keys,
            )
        )
    return seams


def compose_allocator_equity(
    returns_by_key: Mapping[str, pd.Series],
    flows_by_key: Mapping[str, list[ExternalFlow]],
    anchors_by_key: Mapping[str, float | None],
    null_anchor_reasons: Mapping[str, str] | None = None,
    *,
    benign_flag_tokens: Sequence[str] | None = None,
    degrade_reasons: Sequence[DegradeReason] | None = None,
    departed_end_by_key: Mapping[str, str] | None = None,
    full_history_keys: Collection[str] | None = None,
    dropped_day_pnl_by_key: Mapping[str, Mapping[str, float]] | None = None,
    realized_terminal_by_key: Mapping[str, tuple[str, float]] | None = None,
    unpriced_close_day_by_key: Mapping[str, str] | None = None,
    unpriced_days_by_key: Mapping[str, Collection[str]] | None = None,
    segment_terminals_by_key: Mapping[str, Mapping[str, float]] | None = None,
) -> dict[str, Any]:
    """Compose the allocator display-row payload from real per-key inputs.

    See the module docstring for the four carry-ins. Returns the phase-wide contract:
    ``{curve, flags, degrade_reasons, is_trustworthy, scalars, inputs}``. Pure /
    I/O-free — the job handler owns persistence.

    ``null_anchor_reasons`` (optional) maps a key with a NULL anchor to WHY the
    epilogue nulled it (``'dust'`` vs a real-capital read failure —
    ``'balance_error'/'nonpositive'/'nonfinite'/'flow_drop'``). It is consulted ONLY
    for the fourth reconciliation bucket (a null-anchor key ALSO absent from the
    returns axis): a ``'dust'`` such key is SILENTLY OMITTED (materiality — a dust
    key must not pin the allocator to legacy), any other reason (or a MISSING token,
    the safe default) DEGRADES the allocator (DROPPED_KEY → legacy fallback).

    164.6.6.2 D-13: a null-anchor key whose reason is ``'native_unit'`` (an account measured
    in its own non-USD currency) is omitted from BOTH the unanchored-return and the
    fourth-bucket rules above, whether or not it has a return series, and the benign flag
    ``native_unit_key_omitted`` records it. It adds no degrade reason, so the book over the
    USD keys stays trustworthy. The reason a viewer sees for the missing account is the
    positions poll's ``MT5_NON_USD_NOTE``, not this flag.

    ``degrade_reasons`` (optional) are caller-supplied reasons the caller found
    before composing (167.1.2 C2 round 2: a shared account's history that could
    not be stitched). They join the payload's reasons like the core's own, so a
    BLOCKING one makes the curve untrustworthy; ``benign_flag_tokens`` never
    can.

    ``departed_end_by_key`` (167.1.2 plan 09, D-05 / D-09) maps a departed key
    to the last ISO day its history counts. The key is replayed on its FULL
    series (its anchor is the level on its own last return day), then its
    levels, returns and flows are clipped to days ``<= end``. After that day it
    is rotated out: it contributes nothing to the $-curve (an exit seam, see
    ``_departure_seams``) and leaves both sums of ``payload.returns``, so its
    leaving is never a return and its level is never carried. The ledger books
    the exit as an outflow of its last level on the next union day. A live key
    is never in this map, so the frozen core's math for live keys is unchanged.

    ``full_history_keys`` (167.1.2.2 D-13) names the keys on a venue whose history
    reaches the account's start (``FULL_HISTORY_VENUES``). Only those get the
    opening-flow zero-start check in ``replay_key_equity``; every other key keeps the
    positional ``OUT_OF_WINDOW_FLOW`` rule. The caller knows the venue, this pure
    layer does not, so it is passed in rather than guessed.

    ``dropped_day_pnl_by_key`` (167.1.2.2 D-15) maps a key to {ISO day: P&L in USD} for
    the days its TWR writer left out of the stored returns (the funding day, a day whose
    flow dominates the prior NAV). ``replay_key_equity`` uses that P&L on those days
    instead of reading them as flat, and judges the opening run by the capital before
    the funding day's P&L. A key with no entry (every row written before D-15) is
    composed exactly as before.

    ``realized_terminal_by_key`` (167.1.2.2 round-1 CR-01) maps a key to ``(ISO day, USD)``,
    the REALIZED terminal level its writer rolled the stored returns back from (not the live
    equity in ``anchors_by_key``, which adds the open position). ``replay_key_equity`` rolls
    from it, so levels and the zero-start verdict are the writer's own, and the live anchor
    enters on the last day only. A key with no entry is replayed from its anchor as before.

    ``unpriced_close_day_by_key`` (164.6.6.2.1 D-09 / D-20) maps a BTC key whose live balance
    could not be priced (the latest completed UTC day has no stored close) to that day's ISO
    date. The key arrives with its series priced through its last USD return day ``P``, an
    anchor equal to its realized USD level on ``P`` (the live balance is NOT in the book: no
    price exists for it) and ``departed_end_by_key[k] == P``. It is then composed through ``P``
    and rotated out after it as an exit, never a return and never a carried level, so the book
    stays trustworthy (mechanism T1, measured in plan 03). The omission is named twice: the
    benign flag ``native_unpriced_key_omitted``, and ``payload["unpriced_native_keys"]``, a list
    sorted by key id of ``{"api_key_id", "day"}`` for each such key left out of the curve's LAST
    day, ``day`` being the ISO date of the close that is missing. No amount enters the list. A
    key with a NULL anchor and the reason ``native_unpriced`` (nothing could be priced at all) is
    omitted from the unanchored-return and fourth-bucket rules exactly as ``native_unit`` is, and
    listed the same way; its entry carries ``"reason": "day_unknown"`` when no close day is known.
    (164.6.6.2.1 SFH-02) A key replayed in segments across an interior hole is listed too, with
    ``"hole_days"`` (the interior unpriced days, sorted) beside its ``day``, which stays ``None``
    unless the key is also left out of the curve's last day. ``day`` keeps its one meaning. A key in this map without a ``departed_end_by_key`` entry is rotated out
    after its last return day, which is what the job sends; carrying it flat would book dollars
    no close backs.

    ``unpriced_days_by_key`` and ``segment_terminals_by_key`` (164.6.6.2.1 D-09, mechanism I2,
    selected by MEASUREMENT M3 = STALE-CARRY) handle an INTERIOR hole: days between a key's
    priced days that have no USD return because a close is missing. A hole in the stored
    returns is not a local defect. ``replay_key_equity`` rolls backward over the days present,
    so the return after the hole is applied to the level labelled with the day BEFORE it, and
    every earlier level is scaled by the same error (M3 measured +2833, +2691 and +2940 on
    levels of 62730, 59590 and 65100); the interior days were also carried at r = 0. The key is
    therefore replayed in SEGMENTS, split at each ``hole_segment_ends`` day. Each segment before
    the last is rolled back from ``segment_terminals_by_key[k][day]``, the realized USD level the
    writer stored on its last day (the writer priced it at that day's own close), so the levels
    before a hole are the writer's own; the last segment rolls from the key's realized terminal as
    before. A segment before the last is rotated out after its last day by the departure
    machinery (an exit seam on the curve, an outflow of its last level in the ledger), and the
    next segment enters with an inflow of its first level, so across the hole the key
    contributes nothing to the dollar total and leaves both sums of ``payload.returns``: never a
    return, never a carried level. A hole whose terminal is missing is not guessed: the key is
    composed unsplit and ``key_inputs_mismatch`` (blocking) says so. The flag
    ``native_unpriced_key_omitted`` records that days were left out. Both inputs are optional;
    a key with no entry is composed exactly as before."""
    departed_end = dict(departed_end_by_key or {})
    unpriced_close_day = dict(unpriced_close_day_by_key or {})
    dropped_pnl = dict(dropped_day_pnl_by_key or {})
    realized_terminal = dict(realized_terminal_by_key or {})
    full_history = frozenset(full_history_keys or ())
    reasons: set[DegradeReason] = set(degrade_reasons or ())
    flag_tokens: set[str] = set()
    _null_reasons = null_anchor_reasons or {}

    # ── Carry-in TRAP: drop unanchored keys FIRST (before segmentation) ──
    # WR-01 / B3: reconcile over the UNION of the return-bearing keys AND the keys
    # that carry a real anchor. A key must be BOTH anchored AND have a return series
    # to enter the blend; a key present in only ONE of the two maps is DROPPED (and
    # the number is suspect — the $-total understates its capital), never silently
    # omitted. Iterating returns_by_key alone (the pre-fix bug) made an anchored key
    # with NO return series invisible: not summed, no reason raised, is_trustworthy
    # stayed True on an understated curve.
    anchored_keys = [k for k in returns_by_key if anchors_by_key.get(k) is not None]
    # A return-bearing key with no anchor (allocator_equity_curve drops it too).
    # D-13: a native-unit key is OMITTED from the USD book by name, before either degrade
    # bucket sees it. Its return series (if any, e.g. one written before the key-mode skip
    # existed) is in BTC, so blending it would add BTC as dollars; its capital is real but
    # not dollars, so calling it a "dropped key" would degrade a curve that is correct over
    # the USD keys. Only a NULL anchor is omitted: a key that somehow carries a USD anchor
    # is a different fact and keeps the existing rules.
    native_unit_keys = {
        k
        for k, a in anchors_by_key.items()
        if a is None and _null_reasons.get(k) == _NATIVE_UNIT_REASON
    }
    if native_unit_keys:
        flag_tokens.add(_NATIVE_UNIT_KEY_OMITTED)
    # 164.6.6.2.1 D-09: a BTC key with a NULL anchor and the reason ``native_unpriced`` had no
    # close to price its live balance and nothing priced before it either (a key that has a
    # priced stretch arrives ANCHORED at its realized USD level, see ``unpriced_close_day_by_key``).
    # It is left out by name exactly like a native-unit key: real capital that is not a read
    # failure, so no ``DROPPED_KEY``.
    native_unpriced_keys = {
        k
        for k, a in anchors_by_key.items()
        if a is None and _null_reasons.get(k) == _NATIVE_UNPRICED_REASON
    }
    omitted_by_name = native_unit_keys | native_unpriced_keys
    unanchored_return_keys = [
        k
        for k in returns_by_key
        if anchors_by_key.get(k) is None and k not in omitted_by_name
    ]
    # An anchored key (real capital) with NO return series — cannot be blended, so
    # its capital is missing from the $-total. Iterate anchors_by_key so it is seen.
    anchored_without_returns = [
        k
        for k, a in anchors_by_key.items()
        if a is not None and k not in returns_by_key
    ]
    if unanchored_return_keys:
        # Mirror the core's honest-degradation vocabulary: NO_ANCHOR (benign, the
        # reason) + DROPPED_KEY (blocking — the total understates the missing key's
        # capital, so the number is suspect exactly as allocator_equity_curve treats
        # an unanchored key it drops).
        reasons.add(DegradeReason.NO_ANCHOR)
        reasons.add(DegradeReason.DROPPED_KEY)
    if anchored_without_returns:
        # MISSING_SERIES (benign honest-empty companion) + DROPPED_KEY (blocking):
        # a key with real anchored capital but no series cannot enter the $-curve,
        # so the total understates it → untrustworthy, never a silent omission.
        reasons.add(DegradeReason.MISSING_SERIES)
        reasons.add(DegradeReason.DROPPED_KEY)
    # FOURTH BUCKET (F1a×F3/M2 seam): a key present in anchors_by_key with a NULL
    # anchor AND absent from returns_by_key (the <2-day / never-traded idle key
    # whose live equity read failed) is in NONE of the three buckets above → it
    # would be silently omitted → a trustworthy partial curve over the rest. Gate it
    # on the epilogue's anchor_null_reason:
    #   'dust'  → SILENTLY OMIT (materiality — an immaterial dust key must not pin
    #             the whole allocator to legacy forever; matches why M2 nulls dust).
    #   else / MISSING token → real-capital read failure (balance_error / nonpositive
    #             / nonfinite / flow_drop) OR a legacy pre-fix row with no token →
    #             emit NO_ANCHOR + MISSING_SERIES + DROPPED_KEY (blocking) so the
    #             allocator degrades honestly (we cannot account for that key's real
    #             capital). A MISSING token defaults to the SAFE (degrade) side.
    null_anchor_without_returns = [
        k
        for k in anchors_by_key
        if anchors_by_key.get(k) is None
        and k not in returns_by_key
        and k not in omitted_by_name
    ]
    for k in null_anchor_without_returns:
        if _null_reasons.get(k) == "dust":
            continue  # materiality: omit silently, no degrade reason
        reasons.add(DegradeReason.NO_ANCHOR)
        reasons.add(DegradeReason.MISSING_SERIES)
        reasons.add(DegradeReason.DROPPED_KEY)

    # D-09: a key the job names as unpriced on its live close leaves the book after its last
    # return day. The job always sends that end in ``departed_end_by_key``; if a caller does not,
    # the same day is used, so the key is never carried flat on a price no close backs.
    for k in sorted(unpriced_close_day):
        if k in anchored_keys and k not in departed_end and len(returns_by_key[k]) > 0:
            departed_end[k] = max(str(d) for d in returns_by_key[k].index)

    anchored_returns = {k: returns_by_key[k] for k in anchored_keys}
    anchored_flows = {k: list(flows_by_key.get(k, [])) for k in anchored_keys}

    # ── D-09 / mechanism I2: replay a key with an interior unpriced hole in SEGMENTS. ──
    # ``unit`` is what the rest of the compose calls a key: an original key, or one segment of
    # a key split at a hole (the LAST segment keeps the key's own id, so every per-key input
    # that names the key - its realized terminal, its departed end - still lands on it).
    parent: dict[str, str] = {k: k for k in anchored_keys}
    # SFH-02: the interior unpriced days of each key replayed in segments, so the dashboard can
    # name a key that was left out of days other than the curve's last.
    interior_hole_days: dict[str, list[str]] = {}
    unit_anchors: dict[str, float | None] = dict(anchors_by_key)
    hole_exit_units: set[str] = set()
    reentry_units: list[str] = []
    history_first = set(full_history)
    unpriced_days_in = {
        k: frozenset(str(d) for d in days)
        for k, days in (unpriced_days_by_key or {}).items()
    }
    for k in list(anchored_keys):
        unpriced_k = unpriced_days_in.get(k)
        if not unpriced_k:
            continue
        pnl_k = dropped_pnl.get(k) or {}
        events = (
            {str(d) for d in anchored_returns[k].index}
            | {str(f[0]) for f in anchored_flows[k]}
            | {str(d) for d in pnl_k}
        )
        ends = hole_segment_ends(events, unpriced_k)
        if not ends:
            continue
        terminals = (segment_terminals_by_key or {}).get(k, {})
        if any(e not in terminals for e in ends):
            # The writer should have stored the level on each of these days. Without it the
            # levels before the hole are unknowable, so it is NOT guessed: the key composes
            # unsplit (the pre-fix roll) and the book says it cannot be trusted.
            reasons.add(DegradeReason.KEY_INPUTS_MISMATCH)
            logger.warning(
                "compose: a key has %d interior unpriced hole(s) but no stored level on %d of "
                "the days before them; it is composed unsplit and the book is untrustworthy (%s)",
                len(ends),
                sum(1 for e in ends if e not in terminals),
                DegradeReason.KEY_INPUTS_MISMATCH.value,
            )
            continue
        priced_events = sorted(events - unpriced_k)
        interior_hole_days[k] = sorted(
            d for d in unpriced_k if priced_events[0] < d < priced_events[-1]
        )

        def _in_segment(day: str, lo: str | None, hi: str | None) -> bool:
            return (
                day not in unpriced_k
                and (lo is None or day > lo)
                and (hi is None or day <= hi)
            )

        bounds = [None, *ends, None]
        units: list[tuple[str, pd.Series, list[ExternalFlow], dict[str, float], str | None]] = []
        for j in range(len(ends) + 1):
            lo, hi = bounds[j], bounds[j + 1]
            uid = k if j == len(ends) else f"{k}#hole{j}"
            seg_returns = anchored_returns[k][
                [_in_segment(str(d), lo, hi) for d in anchored_returns[k].index]
            ]
            seg_flows = [f for f in anchored_flows[k] if _in_segment(str(f[0]), lo, hi)]
            seg_pnl = {d: v for d, v in pnl_k.items() if _in_segment(str(d), lo, hi)}
            units.append((uid, seg_returns, seg_flows, seg_pnl, hi))
        position = anchored_keys.index(k)
        del anchored_keys[position]
        del anchored_returns[k]
        del anchored_flows[k]
        was_full_history = k in history_first
        history_first.discard(k)
        placed = 0
        for j, (uid, seg_returns, seg_flows, seg_pnl, hi) in enumerate(units):
            if len(seg_returns) == 0:
                # A segment with no return row cannot be blended or replayed from a level.
                # It is left out and the omission is named (the flag below), not hidden.
                flag_tokens.add(_NATIVE_UNPRICED_KEY_OMITTED)
                continue
            anchored_keys.insert(position + placed, uid)
            placed += 1
            parent[uid] = k
            anchored_returns[uid] = seg_returns
            anchored_flows[uid] = seg_flows
            dropped_pnl[uid] = seg_pnl
            if j == 0 and was_full_history:
                history_first.add(uid)
            if j > 0:
                reentry_units.append(uid)
            if hi is not None:
                level = terminals[hi]
                unit_anchors[uid] = level
                realized_terminal[uid] = (hi, level)
                departed_end[uid] = hi
                hole_exit_units.add(uid)
        flag_tokens.add(_NATIVE_UNPRICED_KEY_OMITTED)

    # Per-key $-equity backward replay (asserts the ISO index per key). A
    # departed key is replayed on its FULL series first: its anchor is its level
    # on its own last return day, so clipping before the replay would hang that
    # anchor on the wrong day.
    per_key_equity = {
        k: replay_key_equity(
            anchored_returns[k],
            anchored_flows[k],
            unit_anchors[k],
            history_reaches_inception=k in history_first,
            dropped_day_pnl=dropped_pnl.get(k),
            realized_terminal=realized_terminal.get(k),
        )
        for k in anchored_keys
    }
    for ke in per_key_equity.values():
        reasons |= ke.degrade_reasons
        flag_tokens |= _bool_flag_tokens(ke.flags)
    # M2: the count flags never leave the replay (``_bool_flag_tokens`` keeps only
    # ``True``), so a stored P&L it had to ignore would be invisible. Counts only: no
    # key id, no day, no USD (T-115-05).
    ignored_pnl_days = sum(
        int(ke.flags.get("dropped_day_pnl_ignored_days", 0))
        for ke in per_key_equity.values()
    )
    if ignored_pnl_days:
        logger.warning(
            "compose: %d stored dropped-day P&L entr(ies) sit on a day that has a "
            "return row and were ignored — the key_inputs row and the returns come "
            "from different derive runs; the book is untrustworthy (%s)",
            ignored_pnl_days,
            DegradeReason.KEY_INPUTS_MISMATCH.value,
        )

    # D-05 / D-09: clip each departed key to its end day (levels, returns and
    # flows). A key with no level on or before that day has no history to
    # show; it leaves the compose (the job never sends one, see D-09's rule).
    departed_present: list[str] = []
    for k in sorted(departed_end):
        departed_ke = per_key_equity.get(k)
        if departed_ke is None or departed_ke.equity is None:
            continue
        end = departed_end[k]
        clipped = _clip_through(departed_ke.equity, end)
        if len(clipped) == 0:
            logger.warning(
                "compose: a departed key has no level on or before its end day; "
                "it is left out of the compose"
            )
            del per_key_equity[k]
            anchored_keys.remove(k)
            del anchored_returns[k]
            del anchored_flows[k]
            continue
        per_key_equity[k] = KeyEquity(
            clipped,
            departed_ke.reason,
            dict(departed_ke.flags),
            departed_ke.degrade_reasons,
        )
        anchored_returns[k] = _clip_through(anchored_returns[k], end)
        anchored_flows[k] = [f for f in anchored_flows[k] if str(f[0]) <= end]
        departed_present.append(k)

    # ── Carry-in #2/#3: segment ONCE (asserts the ISO-day index — carry-in #3 fails
    # loud here on a DatetimeIndex). ``seg.seams`` is the single shared seam list. ──
    seg = segment_coverage(anchored_returns)

    # ── Carry-in #1/#4: feed the blend ONE Segment at a time. Within a dense coverage
    # segment every covering key has a row every day, so exclusive_fill_days == 0
    # STRUCTURALLY — a nonzero count means the wiring regressed (the canary). ──
    weights = _current_equity_weights(anchored_keys, unit_anchors)
    for s in seg.segments:
        seg_series = {k: anchored_returns[k].loc[list(s.days)] for k in s.keys}
        seg_weights = {k: weights[k] for k in s.keys}
        blend = blend_concurrent_returns(seg_series, seg_weights)
        reasons |= blend.degrade_reasons
        flag_tokens |= _bool_flag_tokens(blend.flags)
        exclusive = int(blend.flags.get("exclusive_fill_days", 0))
        if exclusive:
            raise NavReconstructionError(
                "compose: exclusive_fill within a coverage segment — the segment-wise "
                "blend wiring regressed (carry-in #1/#4 canary): a dense segment must "
                f"contain only concurrent days, but {exclusive} day(s) 0-filled a key"
            )

    # ── Carry-in #2: the SAME seg.seams feeds both the ledger and the curve. The
    # returns arg is mandatory for scalars.computable == True. ──
    # D-05: a departed key that still overlaps a counted key has no coverage
    # seam, so the curve gets an EXIT seam for it (the frozen core's rotated-out
    # rule: 0 after its last day). The ledger keeps seg.seams — every rotation
    # it books is the same one the curve sees — and books each exit as what it
    # is, the key's last level leaving the book on the next union day.
    rotated_by_coverage = {k for seam in seg.seams for k in seam.prev_keys}
    exit_seams = _departure_seams(
        {k: ke.equity for k, ke in per_key_equity.items() if ke.equity is not None},
        departed_present,
        rotated_by_coverage,
    )
    ledger_flows = {k: list(v) for k, v in anchored_flows.items()}
    for seam in exit_seams:
        (key,) = seam.prev_keys
        equity = per_key_equity[key].equity
        assert equity is not None  # only anchored keys get an exit seam
        ledger_flows[key].append(
            ExternalFlow(
                utc_day_iso=seam.next_first_day,
                usd_signed=-float(equity[seam.prev_last_day]),
            )
        )
    # I2: a segment that follows a hole ENTERS the book with its first level, the other half of
    # the exit booked above. Where a coverage seam already hands capital into it, that seam
    # books the handoff once and no second inflow is added.
    seam_entered = {n for seam in seg.seams for n in seam.next_keys}
    for unit in reentry_units:
        entered = per_key_equity[unit].equity if unit in per_key_equity else None
        if entered is None or len(entered) == 0 or unit in seam_entered:
            continue
        first = min(str(d) for d in entered.index)
        ledger_flows[unit].append(
            ExternalFlow(utc_day_iso=first, usd_signed=float(entered[first]))
        )
    ledger = build_allocator_ledger(
        ledger_flows, seg.seams, per_key_equity, anchored_returns
    )
    alloc = allocator_equity_curve(
        per_key_equity, seams=list(seg.seams) + exit_seams
    )
    reasons |= alloc.degrade_reasons
    flag_tokens |= _bool_flag_tokens(alloc.flags)

    # Assemble the curve + scalars from the allocator $-equity (ISO-day keyed).
    if alloc.equity is None or len(alloc.equity) == 0:
        curve_rows: list[dict[str, Any]] = []
        scalars = LedgerScalars(None, None, computable=False)
        anchor_asof: str | None = None
    else:
        # ``str(d)`` verbatim — never reformat the ISO day key.
        curve_rows = [
            {"date": str(d), "equity_usd": float(v)} for d, v in alloc.equity.items()
        ]
        days = [str(d) for d in alloc.equity.index]
        period_days = (date.fromisoformat(days[-1]) - date.fromisoformat(days[0])).days
        scalars = mwr_and_dietz_from_ledger(
            ledger,
            begin_value=float(alloc.equity.iloc[0]),
            end_value=float(alloc.equity.iloc[-1]),
            period_start=days[0],
            period_days=period_days,
        )
        # The anchor is the terminal (last-day) venue equity — the curve's last day.
        anchor_asof = days[-1]

    # F5 NOTE (do NOT display-wire without a guard): ``scalars`` (mwr/dietz) are the
    # thread-only KEPT cashflow metrics. On a SHORT / staggered window they can be
    # numerically ABSURD (mwr ≈ −0.9999 at a 1-day window; a ~2.7e26 blow-up on a
    # 4-day staggered book) — mathematically correct for the period but meaningless
    # as a headline. The frontend today reads ONLY ``curve`` (+ is_trustworthy) via
    # extractTrustworthyDerivedCurve and NEVER renders these scalars. If a future
    # surface DOES render them, it MUST gate on a minimum window / sanity bound and
    # never show the raw value — otherwise it prints a nonsense headline return.

    # D-06: the book curve's own returns. Not _current_equity_weights (static D1
    # shares weight history by today's mix). ``version`` 2 is the contract the
    # reader accepts; a payload without it is still the pre-D-06 $-curve.
    # WR-01: a day the writer left out of a key's stored returns has a level (D-15) but no
    # return, so it is left out of the book return too. Derived from the same inputs the
    # replay used: a stored P&L on a day with no return row.
    dropped_days: dict[str, set[str]] = {}
    for k in anchored_keys:
        if dropped_pnl.get(k):
            has_return = {str(d) for d in anchored_returns[k].index}
            dropped_days[k] = {str(d) for d in dropped_pnl[k] if str(d) not in has_return}
    book_returns = portfolio_returns(
        per_key_equity,
        anchored_returns,
        departed_keys=departed_present,
        dropped_days_by_key=dropped_days,
    )
    if any(k not in hole_exit_units for k in departed_present):
        # A segment rotated out before a hole is not a departed key.
        flag_tokens.add(_DEPARTED_HISTORY_INCLUDED)
    # D-09 / D-20: the BTC keys left out of the book by name. A key rotated out after its last
    # priced day is listed only when that day precedes the curve's last date (it is then absent
    # from the last day); a key omitted whole is always listed. ``day`` is the missing close.
    last_curve_day = curve_rows[-1]["date"] if curve_rows else None
    unpriced_native: list[dict[str, Any]] = []
    for k in sorted(set(unpriced_close_day) | native_unpriced_keys | set(interior_hole_days)):
        entry: dict[str, Any] | None = None
        if k in native_unpriced_keys:
            entry = {"api_key_id": k, "day": unpriced_close_day.get(k)}
            if entry["day"] is None:
                # The row's native fields were unreadable (or named no close): the key is out
                # whole and the day is unknown. Say so, so the reader never has to guess.
                entry["reason"] = "day_unknown"
        else:
            held = per_key_equity.get(k)
            if (
                k in departed_present
                and held is not None
                and held.equity is not None
                and last_curve_day is not None
                and max(str(d) for d in held.equity.index) < last_curve_day
            ):
                entry = {"api_key_id": k, "day": unpriced_close_day.get(k)}
        if k in interior_hole_days:
            # ``day`` keeps its meaning (left out of the curve's LAST day); the interior days
            # ride beside it. A key with only interior holes has no ``day``.
            entry = entry or {"api_key_id": k, "day": None}
            entry["hole_days"] = interior_hole_days[k]
        if entry is not None:
            unpriced_native.append(entry)
    if unpriced_native:
        flag_tokens.add(_NATIVE_UNPRICED_KEY_OMITTED)
    returns_rows = book_returns.rows
    skipped_days = book_returns.skipped_nonpositive_days
    if book_returns.nonfinite_days:
        # SFH-10: a non-finite input is not benign. Blocking, counts only.
        reasons.add(DegradeReason.NONFINITE_RETURN)
        logger.warning(
            "compose: portfolio returns omitted %d day(s) with a non-finite "
            "level, return or sum — the book is untrustworthy",
            book_returns.nonfinite_days,
        )
    if book_returns.missing_return_days:
        flag_tokens.add(_MISSING_RETURN_INSIDE_COVERAGE)
        logger.warning(
            "compose: %d key-day(s) inside a key's coverage had no return row and "
            "no flow; each was read as r = 0 on the carried level (flag %s)",
            book_returns.missing_return_days,
            _MISSING_RETURN_INSIDE_COVERAGE,
        )
    if book_returns.undefined_return_days:
        # The signal the dust and P&L-dominated dropped days carried before D-15 gave them
        # a level: a key-day inside the key's coverage with no return row. Reported, not
        # blocking: the day is left out of the book return, never invented.
        flag_tokens.add(_MISSING_RETURN_INSIDE_COVERAGE)
        logger.warning(
            "compose: %d key-day(s) had no stored return because the writer left the day "
            "out; each was left out of the book return for that day, not read as r = 0 "
            "(flag %s)",
            book_returns.undefined_return_days,
            _MISSING_RETURN_INSIDE_COVERAGE,
        )
    if skipped_days:
        flag_tokens.add(_SKIPPED_NONPOSITIVE_DENOMINATOR)
        logger.info(
            "compose: portfolio returns skipped %d day(s) with a non-positive "
            "denominator",
            skipped_days,
        )
    for token in benign_flag_tokens or ():
        # Caller-supplied benign tokens (the composite shared-account flag). Never
        # a degrade reason — the number stays trustworthy when the account is
        # counted once on purpose.
        if token:
            flag_tokens.add(token)
    payload: dict[str, Any] = {
        "curve": curve_rows,
        "returns": returns_rows,
        "version": 2,
        "flags": sorted(flag_tokens),
        "degrade_reasons": sorted(r.value for r in reasons),
        "is_trustworthy": _is_trustworthy(frozenset(reasons)),
        "scalars": {
            "mwr": scalars.mwr,
            "dietz": scalars.dietz,
            "computable": scalars.computable,
        },
        "inputs": {
            "n_keys": len({parent[k] for k in anchored_keys}),
            "anchor_asof": anchor_asof,
            "composed_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    if unpriced_native:
        # Additive, present only when a key was left out (an older reader never sees it).
        payload["unpriced_native_keys"] = unpriced_native
    return payload
