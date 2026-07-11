"""Pure, credentials-free composite-stitch core (Phase 86, COMP-02 / COMP-04).

This module productionizes the offline stitch prototype in
``scripts/zavara_acceptance.py::stitch_key_outputs`` into a single-owner, typed,
fail-loud core. It fans a set of per-member-key daily-return series into ONE
honest combined series and owns four semantics:

  1. HALF-OPEN WINDOW CLIP — ``clip_to_window`` keeps a series day ``d`` iff
     ``window_start <= d < window_end`` (``d == window_start`` KEPT,
     ``d == window_end`` EXCLUDED, ``window_end=None`` = unbounded). This is
     byte-consistent with ``services.allocated_capital.capital_on_date`` (the last
     tranche with ``effective_from <= day``; the day equal to the next tranche's
     boundary belongs to that next tranche) — the ONE window convention the
     allocated-capital path already rides. Values are never re-derived.

  2. FAIL-LOUD OVERLAP GUARD — declared member windows are checked pairwise by
     ``assert_windows_disjoint`` and any overlap RAISES ``CompositeOverlapError``
     (never last-write-wins). ``stitch_clipped_series`` adds a SECOND layer: a
     post-clip day present in more than one clipped series also RAISES. The
     overlap predicate ``windows_overlap`` is the canonical one documented in the
     shared spec ``tests/fixtures/window_overlap_convention.json``:

         half-open ``[start, end)`` intervals, ``end=None`` = unbounded;
         ``a`` overlaps ``b`` iff
         ``a.start < (b.end ?? +inf) AND b.start < (a.end ?? +inf)``.

     That fixture is the SINGLE shared convention: the Phase 88 wizard zod
     validator MUST load the SAME file (parallel impls, one spec — the v1.5
     "same inputs, different derivations = silent divergence" lesson). Overlap
     error text carries ONLY member seqs and ISO dates — never a USD magnitude
     (account-size leak discipline, T-86-05).

  3. EXPLICIT COVERAGE MASK — ``coverage_mask`` reports per-key first/last-day
     boundaries + day counts, the calendar gap spans between clipped windows +
     their day count, and any overlap days. Gap days are MARKED, NEVER zero-filled
     as flat performance (the no-invented-data invariant): the mask operates on the
     honest sparse clipped series, and the metrics caller gap-fills separately (a
     0.0-filled gap here would hide a real coverage hole). The result is
     JSON-serializable primitives only (``data_quality_flags`` destination).

  4. MTM HONESTY GATE (OQ-1) — ``mark_to_market_available`` is the single owner of
     mark-to-market admissibility. An options-active Deribit member gates MTM OFF
     with reason ``"unsmoothed_options_book"`` (Phase 83 daily-option smoothing is
     deferred, so an un-smoothed options book fabricates ~94%/day spikes); any
     non-native (ccxt: binance/okx/bybit) member gates OFF with
     ``"mtm_basis_unavailable_for_venue"`` (those reconstruction paths have no
     mark-to-market basis concept); an all-perp-only / USD-native native book is
     admissible ``(True, None)``. The reason string is carried in
     ``data_quality_flags.mtm_gated_reason`` for Phase 90's disabled-with-reason UI.

Purity: pandas + stdlib + typing ONLY — no network, no I/O, no persistence, no
credential handling (mirrors the ``nav_twr.py`` / ``ccxt_flows.py`` pure-module
discipline). Worker wiring is Plan 03.
"""
from __future__ import annotations

from collections.abc import Sequence
from typing import Any, NamedTuple

import pandas as pd


class CompositeOverlapError(ValueError):
    """A member-window overlap (declared windows OR a post-clip day collision).

    Typed so the Plan 03 worker catch classifies it PERMANENT (a user's declared
    windows are structurally overlapping — retrying cannot fix it), mirroring the
    ``NavReconstructionError`` / ``LedgerValuationError`` disposition discipline.
    """


class MemberWindow(NamedTuple):
    """A composite member's half-open declared window. ``window_end=None`` means
    open-ended (unbounded). Dates are ISO ``'YYYY-MM-DD'`` UTC calendar days."""

    seq: int
    window_start: str
    window_end: str | None


class MemberBasisSignal(NamedTuple):
    """The per-member signal the MTM gate reads. ``venue`` is the lowercased
    exchange id; ``has_option_activity`` is the additive crawl signal Plan 03
    threads for a Deribit member (option-instrument evidence)."""

    seq: int
    venue: str
    has_option_activity: bool


# ccxt reconstruction venues — realized+funding paths with no mark-to-market
# basis concept. Any member NOT on the native (deribit) venue gates MTM off.
_NATIVE_VENUE = "deribit"

MTM_REASON_OPTIONS = "unsmoothed_options_book"
MTM_REASON_VENUE = "mtm_basis_unavailable_for_venue"


def windows_overlap(a: MemberWindow, b: MemberWindow) -> bool:
    """The canonical half-open overlap predicate (see the module docstring + the
    shared ``window_overlap_convention.json``): ``a`` overlaps ``b`` iff
    ``a.start < (b.end ?? +inf) AND b.start < (a.end ?? +inf)``. Adjacent windows
    sharing only the handoff boundary (``a.end == b.start``) do NOT overlap."""
    a_start = pd.Timestamp(a.window_start)
    b_start = pd.Timestamp(b.window_start)
    a_end = None if a.window_end is None else pd.Timestamp(a.window_end)
    b_end = None if b.window_end is None else pd.Timestamp(b.window_end)
    left = b_end is None or a_start < b_end
    right = a_end is None or b_start < a_end
    return bool(left and right)


def _overlap_range_iso(a: MemberWindow, b: MemberWindow) -> tuple[str, str]:
    """The ISO ``[start, end)`` intersection of two overlapping windows for the
    fail-loud message. ``end`` is ``'open'`` when both windows are unbounded."""
    start = max(pd.Timestamp(a.window_start), pd.Timestamp(b.window_start))
    a_end = None if a.window_end is None else pd.Timestamp(a.window_end)
    b_end = None if b.window_end is None else pd.Timestamp(b.window_end)
    if a_end is None and b_end is None:
        end_iso = "open"
    elif a_end is None:
        end_iso = str(b_end.date())  # type: ignore[union-attr]
    elif b_end is None:
        end_iso = str(a_end.date())
    else:
        end_iso = str(min(a_end, b_end).date())
    return str(start.date()), end_iso


def assert_windows_disjoint(windows: Sequence[MemberWindow]) -> None:
    """Pairwise fail-loud overlap guard. RAISES ``CompositeOverlapError`` naming
    the first offending seq pair + the ISO overlap range — seqs and dates ONLY, no
    USD magnitude (T-86-05). Returns ``None`` when every window is disjoint."""
    for i in range(len(windows)):
        for j in range(i + 1, len(windows)):
            a, b = windows[i], windows[j]
            if windows_overlap(a, b):
                start_iso, end_iso = _overlap_range_iso(a, b)
                raise CompositeOverlapError(
                    f"member seq {a.seq} and seq {b.seq} declare overlapping "
                    f"windows on [{start_iso}, {end_iso}); composite member windows "
                    "must be disjoint (never last-write-wins) — refusing to stitch "
                    "overlapping tracks"
                )


def clip_to_window(
    returns: pd.Series, window_start: str, window_end: str | None
) -> pd.Series:
    """Clip a dense per-key daily-return series to its half-open
    ``[window_start, window_end)`` window on the tz-naive midnight DatetimeIndex:
    ``d == window_start`` KEPT, ``d == window_end`` EXCLUDED, ``window_end=None``
    keeps everything from ``window_start`` on. Values are preserved byte-identically
    (a boolean-mask selection, no re-derivation). Convention source:
    ``services.allocated_capital.capital_on_date``."""
    start = pd.Timestamp(window_start)
    mask = returns.index >= start
    if window_end is not None:
        mask = mask & (returns.index < pd.Timestamp(window_end))
    return returns[mask]


def stitch_clipped_series(
    clipped: Sequence[tuple[int, pd.Series]],
) -> pd.Series:
    """Union disjoint clipped per-key series into ONE ascending series preserving
    values. Any day present in MORE THAN ONE clipped series RAISES
    ``CompositeOverlapError`` (fail-loud; never last-write-wins). NO gap-fill here
    — the coverage mask must see the honest gaps; the metrics caller gap-fills
    separately (Pitfall 2)."""
    first_seq: dict[pd.Timestamp, int] = {}
    collisions: dict[pd.Timestamp, set[int]] = {}
    for seq, s in clipped:
        for ts in s.index:
            if ts in first_seq:
                collisions.setdefault(ts, {first_seq[ts]}).add(seq)
            else:
                first_seq[ts] = seq
    if collisions:
        detail = ", ".join(
            f"{str(ts.date())} in member seqs {sorted(seqs)}"
            for ts, seqs in sorted(collisions.items())
        )
        raise CompositeOverlapError(
            "post-clip day collision across composite members — the same calendar "
            f"day appears in multiple clipped series ({detail}); refusing to "
            "coalesce (never last-write-wins)"
        )
    if not clipped:
        return pd.Series(dtype="float64")
    combined = pd.concat([s for _, s in clipped])
    return combined.sort_index()


def _consecutive_spans(gap_days: list[pd.Timestamp]) -> list[dict[str, str]]:
    """Group an ascending list of gap days into inclusive ``{start, end}`` spans."""
    spans: list[dict[str, str]] = []
    run_start: pd.Timestamp | None = None
    prev: pd.Timestamp | None = None
    for day in gap_days:
        if run_start is None:
            run_start = day
        elif prev is not None and day != prev + pd.Timedelta(days=1):
            spans.append({"start": str(run_start.date()), "end": str(prev.date())})
            run_start = day
        prev = day
    if run_start is not None and prev is not None:
        spans.append({"start": str(run_start.date()), "end": str(prev.date())})
    return spans


def coverage_mask(clipped: Sequence[tuple[int, pd.Series]]) -> dict[str, Any]:
    """The explicit coverage mask for ``data_quality_flags``: per-key first/last-day
    boundaries + day counts, the calendar GAP spans between clipped windows + their
    day count, and any overlap days. Gaps are MARKED (never zero-filled) — the mask
    reads the honest sparse series, so gap-filling before counting would hide a real
    hole (falsifiable: zero-fill → ``gap_day_count`` drops to 0). JSON-serializable
    primitives only."""
    per_key: list[dict[str, Any]] = []
    day_seen: dict[pd.Timestamp, int] = {}
    all_days: set[pd.Timestamp] = set()
    for seq, s in sorted(clipped, key=lambda kv: kv[0]):
        days = list(s.index)
        if days:
            per_key.append({
                "seq": seq,
                "first_day": str(min(days).date()),
                "last_day": str(max(days).date()),
                "n_days": len(days),
            })
        else:
            per_key.append({
                "seq": seq, "first_day": None, "last_day": None, "n_days": 0,
            })
        for ts in days:
            day_seen[ts] = day_seen.get(ts, 0) + 1
            all_days.add(ts)

    overlap_days = sorted(str(ts.date()) for ts, n in day_seen.items() if n > 1)

    if all_days:
        span_start, span_end = min(all_days), max(all_days)
        full = pd.date_range(span_start, span_end, freq="D").as_unit("us")
        present = all_days
        gap_days = [d for d in full if d not in present]
    else:
        gap_days = []

    gap_spans = _consecutive_spans(gap_days)
    return {
        "per_key": per_key,
        "gap_spans": gap_spans,
        "gap_day_count": len(gap_days),
        "overlap_days": overlap_days,
    }


def mark_to_market_available(
    members: Sequence[MemberBasisSignal],
) -> tuple[bool, str | None]:
    """The OQ-1 single-owner mark-to-market honesty gate. Returns
    ``(admissible, reason)``:

      * any member with option activity → ``(False, "unsmoothed_options_book")``
        (checked FIRST — the more specific ~94%/day-spike signal takes precedence);
      * any member on a non-native (ccxt) venue →
        ``(False, "mtm_basis_unavailable_for_venue")``;
      * otherwise (all native, perp-only) → ``(True, None)``.
    """
    if any(m.has_option_activity for m in members):
        return (False, MTM_REASON_OPTIONS)
    if any(m.venue.strip().lower() != _NATIVE_VENUE for m in members):
        return (False, MTM_REASON_VENUE)
    return (True, None)
