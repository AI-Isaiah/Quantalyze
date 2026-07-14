"""The dailies-canonical derive route (Phase 103, first increment).

This module IS the shared route of the backbone-unification arc (LOCKED principle,
user 2026-07-12): **compute the daily-return series first, then derive EVERYTHING
— scalars, the sparse persisted rows, and the coverage mask — FROM that one
series.** `derive_basis_series` takes an ALREADY-COMPUTED daily-return series and
emits:

  * the SPARSE honest persisted form (NaN/±Inf days ABSENT, 0.0 flat days KEPT),
  * the scalar cache derived FROM that sparse form (re-densified with
    `gap_fill_daily_returns`), so the anti-divergence guard is true BY
    CONSTRUCTION — the scalars are a cache of the rows, never an independent
    source of truth (kills the Phase-101 √252-vs-√365 divergence class),
  * the per-basis coverage `gap_spans` derived FROM the same sparse form.

Phases 104-106 (the `process_key`/unified-backbone program) ADOPT this helper for
CASH — routing the cash series through the SAME function without a signature
change (the `sibling_kinds` passthrough + basis-agnostic conventions are there for
that adoption). Do NOT fork; do NOT bolt derive logic onto the composite's bespoke
`_metrics_result_for` path (that path is what the backbone merge deletes).

Composition-only — NO new valuation math (LOCKED). The helper composes existing
primitives: `_drop_nonfinite` (metrics), `gap_fill_daily_returns` (broker_dailies),
`compute_all_metrics` (metrics), `_consecutive_spans` (stitch_composite).

Deliberate NaN semantics (load-bearing — reviewers look here)
------------------------------------------------------------
The scalars derive from the SPARSE persisted form re-densified with
`gap_fill_daily_returns` (0.0 fill). Where the in-memory MTM series carried
interior NaN guard days (per `103-PROBE-OQ1.md`: single-key ONLY when a DQ-01
guard fires; composite by construction via member-NaN + inter-member gaps), those
days are `_drop_nonfinite`d → ABSENT rows → re-densified to 0.0 for the scalar.
This may shift the MTM scalar slightly vs the Phase-101/102 inline compute (which
fed NaN THROUGH to the statistics, and — under `cumulative_method="simple"` — could
even raise a bare ValueError on an interior chain-break). That shift is the LOCKED
principle's intent: the persisted dailies are the only truth and the scalar is
their cache. Leading/trailing NaN days shrink the persisted span (and thus the
calendar span CAGR sees) — same rationale.

Cash paths are NOT routed through this module in Phase 103 (SC-4 cash byte-identity
is untouched — Phase 103 routes ONLY the MTM basis here).

Phase 104 addendum (BB-01, SERIES-ONLY): the single-key broker derive now ALSO
persists the cash daily SERIES here via `basis="cash_settlement"` (KIND_CASH_SETTLEMENT)
— an ADDITIVE, DARK write with NO reader yet (Phase 105/106 collapse the scalar route
onto it). The AUTHORITATIVE cash SCALARS remain on the legacy `analytics_runner` path
until Phase 105: routing cash SCALARS through this module before the NaN/gap-fill
reconciliation would bridge broker guard-day NaN breaks and 0.0-fill sparse user-CSV
gaps — an SC-4 violation (104-RESEARCH Pitfall 1). Only the series (rows + gap_spans +
conventions echo, incl. the benchmark identity) is persisted for cash this phase.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd

from services.broker_dailies import gap_fill_daily_returns
from services.metrics import _drop_nonfinite, compute_all_metrics
from services.stitch_composite import _consecutive_spans

# The persist kind (Phase 103: MTM only). `strategy_analytics_series.kind` is
# unconstrained TEXT by documented design ("Add a new kind = INSERT a new row; no
# ALTER TABLE", migration 20260428120919) — cash joins here as a sibling kind when
# the backbone adopts the helper (Phases 104-106). No DDL ships this phase.
KIND_MTM_DAILY_RETURNS = "mtm_daily_returns"

# Phase 104 (BB-01): cash joins the route as its own persist kind. Still no DDL —
# `strategy_analytics_series.kind` is unconstrained TEXT by documented design
# (migration 20260428120919), so a new kind is a map entry + a constant, not an
# ALTER. This is a SERIES-ONLY dark write (additive, zero readers this phase); the
# authoritative cash SCALARS stay on the legacy analytics_runner path until 105.
KIND_CASH_SETTLEMENT = "cash_settlement"

# The basis → kind map. Cash joined here in Phase 104 (104-SC1).
_KIND_BY_BASIS: dict[str, str] = {
    "mark_to_market": KIND_MTM_DAILY_RETURNS,
    "cash_settlement": KIND_CASH_SETTLEMENT,
}

# JSONB payload schema version (bump if the row/gap_spans/conventions shape changes
# so a reader can detect a stale-shape row).
_PAYLOAD_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class BasisSeriesResult:
    """The single derived object a basis's persist consumes — scalars, sparse
    rows, mask, and the conventions echo the anti-divergence guard anchors on.

    Attributes
    ----------
    metrics_json:
        JSON-safe scalar cache derived FROM `series_rows` (re-densified). Spread by
        call sites into `metrics_json_by_basis.<basis>` exactly as today.
    sibling_kinds:
        Pass-through from the `MetricsResult` (heavy sibling series — rolling etc.).
        Carried for the future cash/backbone adoption; unused by the MTM persist.
    series_rows:
        The SPARSE honest persisted truth: ascending
        `[{"date": "YYYY-MM-DD", "return": <float>}]`, NaN/±Inf ABSENT, 0.0 kept,
        values UNROUNDED (the round-trip guard needs byte-exact floats).
    gap_spans:
        Inclusive `[{"start","end"}]` runs of calendar days ABSENT from
        `series_rows` within `[first_row, last_row]` — the per-basis coverage mask,
        a pure function of `series_rows` (never a second source of truth).
    conventions:
        `{"periods_per_year", "cumulative_method", "day_basis"}` echo — the
        divergence-guard anchor. The round-trip recomputes AGAINST this echo, so a
        scalar computed under a convention that disagrees with the echo reddens.
        Phase 104 adds an OPTIONAL `benchmark` key — the benchmark identity STRING —
        present ONLY when the deriving call site passed `benchmark_symbol` (both
        Phase-104 call sites, cash AND MTM, pass "BTC"). Absent when omitted.
    """

    metrics_json: dict[str, Any]
    sibling_kinds: dict[str, Any]
    series_rows: list[dict[str, Any]]
    gap_spans: list[dict[str, str]]
    conventions: dict[str, Any]


def derive_basis_series(
    returns: pd.Series,
    benchmark_rets: pd.Series | None,
    *,
    periods_per_year: int,
    cumulative_method: str,
    day_basis: str,
    benchmark_symbol: str | None = None,
) -> BasisSeriesResult:
    """Derive the persisted form + scalar cache + coverage mask from an
    already-computed daily-return series (basis-agnostic; NO new math).

    Steps (composition of existing primitives only):
      1. `sparse = _drop_nonfinite(returns)` — drop NaN AND ±Inf. THIS is the
         persisted truth.
      2. scalars = `compute_all_metrics(gap_fill_daily_returns(sparse), ...)` — the
         cache is computed FROM the sparse persisted form re-densified with 0.0, so
         the round-trip guard holds by construction.
      3. `gap_spans` = `_consecutive_spans` over calendar days in
         `[sparse.min, sparse.max]` ABSENT from `sparse.index`.
      4. `series_rows` from `sparse` (`ts.date().isoformat()`, unrounded `float`).

    Raises `ValueError` when fewer than 2 finite rows survive sanitize (mirrors the
    `compute_all_metrics` contract — call sites keep their degrade/fail handling).
    """
    sparse = _drop_nonfinite(returns).sort_index()
    if len(sparse) < 2:
        raise ValueError(
            "derive_basis_series: fewer than 2 finite daily returns after sanitize."
        )

    dense = gap_fill_daily_returns(sparse)
    metrics = compute_all_metrics(
        dense,
        benchmark_rets,
        periods_per_year=periods_per_year,
        cumulative_method=cumulative_method,
        day_basis=day_basis,
    )

    series_rows = [
        {"date": ts.date().isoformat(), "return": float(val)}
        for ts, val in sparse.items()
    ]

    full_idx = pd.date_range(
        sparse.index.min(), sparse.index.max(), freq="D"
    ).as_unit("us")
    absent_days = list(full_idx.difference(sparse.index))
    gap_spans = _consecutive_spans(absent_days)

    conventions: dict[str, Any] = {
        "periods_per_year": periods_per_year,
        "cumulative_method": cumulative_method,
        "day_basis": day_basis,
    }
    # Phase 104 (104-SC5): carry the benchmark IDENTITY STRING (not a returns fetch —
    # `benchmark_rets` stays whatever the caller passed) so Phase 105's scalar route
    # knows WHICH benchmark to re-derive α/β/corr against. ADDITIVE-ONLY: a caller
    # that omits the kwarg (default None) gets the unchanged three-key conventions
    # dict, so opting out is byte-invisible (SC-4-safe — no reader consumes
    # `conventions.benchmark` this phase; 105's round-trip guard is its first).
    if benchmark_symbol is not None:
        conventions["benchmark"] = benchmark_symbol

    return BasisSeriesResult(
        metrics_json=metrics.metrics_json,
        sibling_kinds=metrics.sibling_kinds,
        series_rows=series_rows,
        gap_spans=gap_spans,
        conventions=conventions,
    )


def persist_basis_series(
    supabase: Any,
    strategy_id: str,
    *,
    basis: str = "mark_to_market",
    result: BasisSeriesResult | None,
) -> None:
    """Authoritatively upsert (or HEAL) the persisted series row for `basis`.

    `result` present → upsert the `(strategy_id, kind)` row via the existing
    service-role-only `upsert_strategy_analytics_series_batch` RPC. The PK
    `(strategy_id, kind)` makes this a single-row authoritative replace — no span
    reconcile needed (contrast the cash multi-row `_reconcile_full_delete`).

    `result is None` → DELETE the row (the HEAL path for a degrade/gated/
    not-attempted derive; Pitfall 5: a stale series must never outlive the scalars'
    authoritative-NULL write).

    Sync function — call sites wrap it in their existing `db_execute`/thread
    patterns (Plan 02's concern).

    NOTE (density, both honest): the two callers persist series of DIFFERENT
    density. The single-key broker-derive route (job_worker.py :3112) writes a
    DENSE mark_to_market series — one row per interpretable day of the reconstructed
    book. The composite stitch route (:4575-area) writes a SPARSE series — the
    stitched members leave honest interior gaps (recorded in `gap_spans`) on days no
    member covers. Both are correct: the reader's coverage mask (`gap_spans`) is what
    the client `deriveSegmentMarkers` turns into FS-02 missing-segment annotations,
    so a sparse composite series renders its gaps rather than fabricating flat days.
    """
    kind = _KIND_BY_BASIS.get(basis)
    if kind is None:
        raise ValueError(
            f"persist_basis_series: unknown basis {basis!r} "
            f"(mapped: {sorted(_KIND_BY_BASIS)})."
        )

    if result is None:
        (
            supabase.table("strategy_analytics_series")
            .delete()
            .eq("strategy_id", strategy_id)
            .eq("kind", kind)
            .execute()
        )
        return

    payload = {
        "schema": _PAYLOAD_SCHEMA_VERSION,
        "basis": basis,
        "rows": result.series_rows,
        "gap_spans": result.gap_spans,
        "conventions": result.conventions,
    }
    supabase.rpc(
        "upsert_strategy_analytics_series_batch",
        {"p_strategy_id": strategy_id, "p_kinds": {kind: payload}},
    ).execute()
