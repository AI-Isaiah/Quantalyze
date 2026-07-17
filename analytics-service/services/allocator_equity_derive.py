"""Canonical allocator equity derivation — pure blend + coverage segmentation.

Phase 115 (E2), STITCH-01 (this module's blend half) + STITCH-06 seam contract
(the segmentation half). Pure, I/O-free functions: callers inject every series
and weight; nothing here touches supabase, the network, or the filesystem, so the
downstream plan-03 $-ledger core and the Phase 115.1 worker-side display
derivation both build on a hermetically testable foundation.

WHY THIS MODULE EXISTS
----------------------
Python must OWN the canonical allocator blend so the match engine, the factsheet,
and the live-baseline UI converge on one derivation. The Phase-36 TypeScript blend
in ``src/lib/queries.ts::liveBaselineMetricsFromPerKeyDailies`` (L2135-2256) is the
display-era SEMANTIC PRECEDENT — not the owner. This module ports its three
decisions canonically:

  * D1 — one "strategy" per ``api_key_id`` from its ``csv_daily_returns`` series;
         WEIGHT = that key's STATIC share of CURRENT equity (from holdings), NOT a
         time-varying / performance-tracking weight (queries.ts L2155-2210).
  * D2 — AUM stays from holdings; only the curve SHAPE + KPIs come from the blend.
         AUM is NOT this module's concern (the $-ledger is plan-03 / STITCH-03/04).
  * D3 — the blend is ALL-OR-NOTHING: if any eligible key has an EMPTY per-key
         series the WHOLE allocator degrades to the honest-empty baseline, never a
         mixed-annualization-basis half-blend (queries.ts L2105-2112, L2266-2275).

PARTIALLY-MISSING DAYS (the exact TS choice, replicated)
--------------------------------------------------------
On a union day where a subset of keys lacks a row, the TS engine 0-FILLS that key's
return in the NUMERATOR only and keeps the divisor at the CONSTANT full weight mass
(``strategyReturns[s.id] = map.get(d) ?? 0`` at scenario.ts L407-409, then
``portDaily[i] = r / activeWeightSum`` at scenario.ts L430 where ``activeWeightSum``
sums the whole member mass every day on the allocator's absent-window path). We
replicate this exactly: ``blended_r_t = Σ_i w_i · r_i,t(0-filled) / Σ_i w_i``. The
0-fill can never leak past a key's own coverage because segmentation (below) keeps
genuinely sequential runs in their OWN single-key segments — the blend is only ever
handed a concurrent block.

BINDING INVARIANTS
------------------
  * ADDITIVE ONLY. This module NEVER reads, writes, or upserts
    ``allocator_equity_snapshots`` and never imports the writer arm of
    ``equity_reconstruction`` (Pitfall 5 — two writers racing the same table). The
    legacy store keeps sole ownership of its table; STITCH-02 (its physical
    retirement) is DEFERRED because the reader census did not clear. See
    ``.planning/phases/115-e2-allocator-equity-reconstruction-scope-gated-verify-first/115-STITCH-02-DEFERRAL.md``.
    Residual readers pinning the store alive: R1 (match.py per-SYMBOL breakdown),
    R2 (compare per-symbol adapter), R3-partial (getMyAllocationDashboard
    breakdown / provenance fields), R5 (GDPR export manifest), R6 (SQL enqueue +
    pg_cron + compute_job_kinds constraints).
  * Landmine L1. Concurrent sibling keys compose via the CAPITAL-WEIGHTED BLEND,
    NEVER via ``stitch_composite.assert_windows_disjoint`` /
    ``stitch_clipped_series`` (those RAISE ``CompositeOverlapError`` on overlap BY
    DESIGN). Only the window VOCABULARY (``windows_overlap``, half-open
    ``[start, end)``) is reused, and only for SEQUENTIAL rotation boundaries.
  * No raw USD in logs/exceptions (T-115-03 / T-73-02). Weights are ratios (fine);
    equity magnitudes never enter a log or raise string. Flags carry bools/counts.

Purity: pandas + stdlib + typing ONLY.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from services.stitch_composite import MemberWindow, windows_overlap

# D3 honest-empty reasons (machine tokens; no USD, JSON-serializable).
REASON_NO_KEYS = "no_eligible_keys"
REASON_MISSING_SERIES = "d3_missing_series"


@dataclass(frozen=True)
class BlendResult:
    """The canonical concurrent-blend output.

    ``blended`` is the capital-weighted daily-return Series, or ``None`` on the D3
    honest-empty degrade (never a half-blend). ``flags`` carries JSON-serializable
    bools/counts only — no USD magnitudes."""

    blended: pd.Series | None
    flags: dict[str, Any] = field(default_factory=dict)


def eligible_key_predicate(key_row: Mapping[str, Any]) -> bool:
    """The role-agnostic eligibility predicate, byte-identical to the phase35
    backfill dispatch filter (``scripts/phase35_backfill_enqueue.py``):

        is_active = true AND sync_status IS DISTINCT FROM 'revoked'
        AND disconnected_at IS NULL

    Mirrored here so the Phase 115.1 display derivation reuses ONE eligibility
    definition. A credential-revoked / soft-disconnected allocator key keeps
    ``is_active = true`` (rows persist for audit continuity) but is NOT eligible —
    the backfill never derives a series for it, so counting it would pin the D3
    gate to the honest-empty baseline forever (queries.ts L2277-2299)."""
    is_active = bool(key_row.get("is_active"))
    sync_status = key_row.get("sync_status")
    disconnected_at = key_row.get("disconnected_at")
    # IS DISTINCT FROM 'revoked' — NULL/anything-but-'revoked' passes.
    return is_active and sync_status != "revoked" and disconnected_at is None


def blend_concurrent_returns(
    series_by_key: Mapping[str, pd.Series],
    weights_by_key: Mapping[str, float],
) -> BlendResult:
    """Capital-weighted blend of CONCURRENT per-key daily-return series (D1/D2/D3).

    Contract (mirrors ``liveBaselineMetricsFromPerKeyDailies``):
      * D3 gate FIRST — no keys, or any key with an EMPTY series → honest-empty
        (``blended=None`` + ``honest_empty`` flag + machine ``reason``).
      * Sole eligible non-empty key → passes through as its own series, weight 1.0.
      * Otherwise blend over the UNION of days, 0-filling a key's missing interior
        day in the numerator only, dividing by the CONSTANT total weight mass.
      * Weights are STATIC current-equity shares; negative equity clamps to 0
        (queries.ts L2209). All-zero mass degrades to equal-weight (flagged), never
        a ZeroDivision.

    NEVER calls ``assert_windows_disjoint`` (Landmine L1) — overlapping siblings
    blend, they do not stitch."""
    keys = list(series_by_key.keys())
    if not keys:
        return BlendResult(None, {"honest_empty": True, "reason": REASON_NO_KEYS})

    # D3 all-or-nothing: any eligible key with an empty series collapses the whole
    # blend to the honest-empty baseline (never a single-key / half-basis curve).
    if any(len(series_by_key[k]) == 0 for k in keys):
        return BlendResult(
            None, {"honest_empty": True, "reason": REASON_MISSING_SERIES}
        )

    # Sole eligible key: pass its series through untouched at weight 1.0.
    if len(keys) == 1:
        sole = keys[0]
        return BlendResult(
            series_by_key[sole].copy(),
            {"sole_key": True, "weight": 1.0, "equal_weight_fallback": False},
        )

    # D1: static current-equity-share weights; clamp negative equity to 0 so a
    # deeply-losing key cannot inject a negative weight (queries.ts L2209).
    raw = {k: max(0.0, float(weights_by_key.get(k, 0.0))) for k in keys}
    total = sum(raw.values())
    equal_weight_fallback = total <= 0.0
    if equal_weight_fallback:
        # All-zero (or all-clamped-negative) mass → equal weight, never ZeroDivision.
        norm = {k: 1.0 / len(keys) for k in keys}
    else:
        norm = {k: raw[k] / total for k in keys}

    # Union axis (0-fill missing interior days in the numerator; constant divisor).
    union_days = sorted({d for k in keys for d in series_by_key[k].index})
    values: list[float] = []
    for day in union_days:
        r = 0.0
        for k in keys:
            r += norm[k] * float(series_by_key[k].get(day, 0.0))
        values.append(r)
    blended = pd.Series(values, index=union_days, name="allocator_blend")
    return BlendResult(
        blended,
        {
            "sole_key": False,
            "equal_weight_fallback": equal_weight_fallback,
            "zero_weight_keys": sorted(k for k in keys if raw[k] == 0.0),
            "n_keys": len(keys),
        },
    )
