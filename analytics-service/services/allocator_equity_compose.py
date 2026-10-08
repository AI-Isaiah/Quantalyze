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


class PortfolioReturns(NamedTuple):
    """``portfolio_returns``' result. Counts carry no USD figure.

    ``skipped_nonpositive_days``: days omitted because the prior-capital
    denominator was not positive (benign). ``nonfinite_days``: days omitted
    because a level, a return or the sum was non-finite (blocking; SFH-10).
    ``missing_return_days``: key-days inside a key's coverage with no level
    (no return row and no flow), read as r = 0 on the carried level (SFH-10)."""

    rows: list[dict[str, Any]]
    skipped_nonpositive_days: int
    nonfinite_days: int
    missing_return_days: int


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
    caller can report it. ``departed_keys`` (167.1.2 plan 09, D-05) are keys
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

    union = sorted({day for day_map in level_by_key.values() for day in day_map})
    rows: list[dict[str, Any]] = []
    skipped = 0
    nonfinite = 0
    missing = 0
    for index in range(1, len(union)):
        prev, day = union[index - 1], union[index]
        numer = 0.0
        denom = 0.0
        poison = False
        for key in level_by_key:
            equity_prev = _level_on(key, prev)
            equity_day = _level_on(key, day)
            if equity_prev is None or equity_day is None:
                continue
            if first_day[key] < day < last_day[key] and day not in level_by_key[key]:
                missing += 1
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
        if not (denom > 0.0):
            skipped += 1
            continue
        value = numer / denom
        if not math.isfinite(value):
            nonfinite += 1
            continue
        rows.append({"date": day, "r": value})
    return PortfolioReturns(rows, skipped, nonfinite, missing)


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
    composed exactly as before."""
    departed_end = dict(departed_end_by_key or {})
    dropped_pnl = dict(dropped_day_pnl_by_key or {})
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
    unanchored_return_keys = [
        k
        for k in returns_by_key
        if anchors_by_key.get(k) is None and k not in native_unit_keys
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
        and k not in native_unit_keys
    ]
    for k in null_anchor_without_returns:
        if _null_reasons.get(k) == "dust":
            continue  # materiality: omit silently, no degrade reason
        reasons.add(DegradeReason.NO_ANCHOR)
        reasons.add(DegradeReason.MISSING_SERIES)
        reasons.add(DegradeReason.DROPPED_KEY)

    anchored_returns = {k: returns_by_key[k] for k in anchored_keys}
    anchored_flows = {k: list(flows_by_key.get(k, [])) for k in anchored_keys}

    # Per-key $-equity backward replay (asserts the ISO index per key). A
    # departed key is replayed on its FULL series first: its anchor is its level
    # on its own last return day, so clipping before the replay would hang that
    # anchor on the wrong day.
    per_key_equity = {
        k: replay_key_equity(
            anchored_returns[k],
            anchored_flows[k],
            anchors_by_key[k],
            history_reaches_inception=k in full_history,
            dropped_day_pnl=dropped_pnl.get(k),
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
    weights = _current_equity_weights(anchored_keys, anchors_by_key)
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
    book_returns = portfolio_returns(
        per_key_equity, anchored_returns, departed_keys=departed_present
    )
    if departed_present:
        flag_tokens.add(_DEPARTED_HISTORY_INCLUDED)
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
    return {
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
            "n_keys": len(anchored_keys),
            "anchor_asof": anchor_asof,
            "composed_at": datetime.now(timezone.utc).isoformat(),
        },
    }
