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

from collections.abc import Mapping, Sequence
from datetime import date, datetime, timezone
from typing import Any

import pandas as pd

from services.allocator_equity_derive import (
    DegradeReason,
    LedgerScalars,
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
    raw = {k: max(0.0, float(anchors_by_key[k])) for k in keys}
    total = sum(raw.values())
    if total <= 0.0:
        return raw
    return {k: raw[k] / total for k in keys}


def compose_allocator_equity(
    returns_by_key: Mapping[str, pd.Series],
    flows_by_key: Mapping[str, list[ExternalFlow]],
    anchors_by_key: Mapping[str, float | None],
    null_anchor_reasons: Mapping[str, str] | None = None,
) -> dict:
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
    the safe default) DEGRADES the allocator (DROPPED_KEY → legacy fallback)."""
    reasons: set[DegradeReason] = set()
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
    unanchored_return_keys = [
        k for k in returns_by_key if anchors_by_key.get(k) is None
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
        if anchors_by_key.get(k) is None and k not in returns_by_key
    ]
    for k in null_anchor_without_returns:
        if _null_reasons.get(k) == "dust":
            continue  # materiality: omit silently, no degrade reason
        reasons.add(DegradeReason.NO_ANCHOR)
        reasons.add(DegradeReason.MISSING_SERIES)
        reasons.add(DegradeReason.DROPPED_KEY)

    anchored_returns = {k: returns_by_key[k] for k in anchored_keys}
    anchored_flows = {k: list(flows_by_key.get(k, [])) for k in anchored_keys}

    # ── Carry-in #2/#3: segment ONCE (asserts the ISO-day index — carry-in #3 fails
    # loud here on a DatetimeIndex). ``seg.seams`` is the single shared seam list. ──
    seg = segment_coverage(anchored_returns)

    # Per-key $-equity backward replay (also asserts the ISO index per key).
    per_key_equity = {
        k: replay_key_equity(anchored_returns[k], anchored_flows[k], anchors_by_key[k])
        for k in anchored_keys
    }
    for ke in per_key_equity.values():
        reasons |= ke.degrade_reasons
        flag_tokens |= _bool_flag_tokens(ke.flags)

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
    ledger = build_allocator_ledger(
        anchored_flows, seg.seams, per_key_equity, anchored_returns
    )
    alloc = allocator_equity_curve(per_key_equity, seams=seg.seams)
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
    return {
        "curve": curve_rows,
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
