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
CASH and COMPOSITE — routing both series through the SAME function via the additive
`scalar_returns`/`densify_policy` params (Phase 105, D1), with NO fork and NO
signature break (the `sibling_kinds` passthrough + basis-agnostic conventions are
there for that adoption). The bespoke composite scalar path that once lived beside
this route is DELETED in Phase 105-05; nothing bolts derive logic outside this
helper.

D1 rows-vs-scalar-input decoupling (Phase 105)
----------------------------------------------
The persisted sparse ROWS always derive from `_drop_nonfinite(returns)`, but the
SCALAR cache may be computed from a caller-supplied `scalar_returns` (the exact
legacy-conditioned series) instead of `gap_fill_daily_returns(sparse)`, so a cash /
composite caller reproduces its legacy scalar byte-identically BY CONSTRUCTION.
`densify_policy` echoes HOW that scalar input was conditioned
({"sparse","broker_nan","zero_fill"}) so the round-trip guard can reconstruct it
from the rows: `sparse` → rows verbatim; `broker_nan` → reindex to the dense
calendar (every in-span absence is a guard NaN); `zero_fill` → `gap_fill(rows)` then
reinstate NaN at the additive `nan_dates` payload key (so a member-guard NaN break is
never silently 0.0-bridged). Default (both params None) is byte-invisible: today's
`gap_fill(sparse)` scalar, NO `densify` echo, `nan_dates` None, payload unchanged
except its reader-invisible `schema` version.

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

Phase 105.1 addendum (teaser preview-only exception, PERMANENT)
---------------------------------------------------------------
The sync onboarding pipeline (`routers/process_key.py` — teaser/csv/internal_report)
DERIVES its preview scalars via `derive_basis_series` but persists NO series row. This
is a documented PERMANENT exception to the persisted-series half of the invariant — it
survives Phase 106 and is NOT an open bypass to be "re-discovered" later. The COMPUTE
half of the LOCKED principle holds fully: the preview scalars are a cache of the
just-derived series within the SAME call, so no second derivation path exists (this
kills the second-derivation divergence class for onboarding). What is deliberately
absent is a persisted series backing those scalars — because there is no series READER.
Justification (D1, user 2026-07-14): the teaser landing card reads scalars + a
precomputed cumulative curve, never a series row; and the teaser's shared sentinel
anchor (`00000000-0000-0000-0000-000000000001`, `status='archived'`, user-less) makes
any hypothetical persisted row unreadable BY CONSTRUCTION — `fetch_strategy_lazy_metrics`
requires published-OR-owner, and the fixed `(strategy_id, kind)` PK is collision-prone
across concurrent teasers. A SUBMITTER-keyed teaser series for lead capture is deferred
scope (Phase 106 / a dedicated slice — USER 2026-07-14) and MUST NOT key on the archived
sentinel; that is a separate future concern, not a gap in this invariant.
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
# so a reader can detect a stale-shape row). Phase 105 (D1): bumped 1 → 2 for the
# additive `nan_dates` key. This is a JSONB-additive shape change, NOT a migration
# (`strategy_analytics_series` DDL untouched); readers ignore unknown keys.
_PAYLOAD_SCHEMA_VERSION = 2

# The closed set of scalar-input conditioning policies a caller may echo (D1). Fail
# loud on anything outside it — these are code-controlled constants, never user input.
_ALLOWED_DENSIFY_POLICIES = ("sparse", "broker_nan", "zero_fill")


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
        Phase 105 adds an OPTIONAL `densify` key ∈ {"sparse","broker_nan","zero_fill"}
        — HOW the caller conditioned `scalar_returns` — present ONLY when the caller
        passed `densify_policy`. Absent (byte-invisible) by default.
    nan_dates:
        Composite `zero_fill` ONLY (else None): sorted ISO dates of the in-index NaN
        positions of the caller's `scalar_returns`. Carried as an ADDITIVE JSONB
        payload key so the round-trip guard reinstates a member-guard NaN break
        rather than 0.0-bridging it. Never populated for any other policy.
    insufficient_window:
        Pass-through of the `MetricsResult.insufficient_window` DQ flag (NOT
        persisted). Exposed so the composite/single-key runners can duck-swap onto
        this helper without losing the annualization-window annotation (Plans 04/05,
        consumed at job_worker.py:4586 / analytics_runner.py:2399).
    """

    metrics_json: dict[str, Any]
    sibling_kinds: dict[str, Any]
    series_rows: list[dict[str, Any]]
    gap_spans: list[dict[str, str]]
    conventions: dict[str, Any]
    nan_dates: list[str] | None = None
    insufficient_window: bool = False


def derive_basis_series(
    returns: pd.Series,
    benchmark_rets: pd.Series | None,
    *,
    periods_per_year: int,
    cumulative_method: str,
    day_basis: str,
    benchmark_symbol: str | None = None,
    scalar_returns: pd.Series | None = None,
    densify_policy: str | None = None,
) -> BasisSeriesResult:
    """Derive the persisted form + scalar cache + coverage mask from an
    already-computed daily-return series (basis-agnostic; NO new math).

    Steps (composition of existing primitives only):
      1. `sparse = _drop_nonfinite(returns)` — drop NaN AND ±Inf. THIS is the
         persisted truth (`series_rows` + `gap_spans` ALWAYS derive from it).
      2. scalars = `compute_all_metrics(scalar_input, ...)`, where
         `scalar_input = scalar_returns` when the caller supplies it (the exact
         legacy-conditioned series → byte-identical legacy scalar BY CONSTRUCTION),
         else today's `gap_fill_daily_returns(sparse)`. The ROWS and the scalar input
         are DECOUPLED (D1) — the sparse rows never change with `scalar_returns`.
      3. `gap_spans` = `_consecutive_spans` over calendar days in
         `[sparse.min, sparse.max]` ABSENT from `sparse.index`.
      4. `series_rows` from `sparse` (`ts.date().isoformat()`, unrounded `float`).

    `densify_policy` (∈ {"sparse","broker_nan","zero_fill"}) echoes into
    `conventions["densify"]` so the round-trip guard can reconstruct the scalar input
    from the rows. Under `zero_fill` with a NaN-carrying `scalar_returns`, the in-index
    NaN dates are surfaced as `nan_dates` (an additive payload key) so a member-guard
    NaN break is reinstated rather than 0.0-bridged. Both params default None →
    byte-invisible (today's behavior; no `densify` echo, `nan_dates` None).

    Raises `ValueError` when `densify_policy` is outside the closed set, or when fewer
    than 2 finite rows survive sanitize (mirrors the `compute_all_metrics` contract —
    call sites keep their degrade/fail handling).
    """
    if densify_policy is not None and densify_policy not in _ALLOWED_DENSIFY_POLICIES:
        raise ValueError(
            f"derive_basis_series: unknown densify_policy {densify_policy!r} "
            f"(allowed: {set(_ALLOWED_DENSIFY_POLICIES)})."
        )

    sparse = _drop_nonfinite(returns).sort_index()
    if len(sparse) < 2:
        raise ValueError(
            "derive_basis_series: fewer than 2 finite daily returns after sanitize."
        )

    # D1: the scalar cache is computed from the caller's exact conditioned series when
    # supplied (legacy byte-identity by construction), else today's gap_fill(sparse).
    # The rows/gap_spans pipeline below stays on `sparse` untouched — rows and
    # scalar-input are decoupled.
    scalar_input = scalar_returns if scalar_returns is not None else gap_fill_daily_returns(sparse)
    metrics = compute_all_metrics(
        scalar_input,
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
    # Phase 105 (D1): echo HOW the scalar input was conditioned so the round-trip
    # guard / 106 reader can reconstruct it from the rows. Same additive shape as
    # `benchmark` — omitted (byte-invisible) when the caller passes no policy.
    if densify_policy is not None:
        conventions["densify"] = densify_policy

    # Phase 105 (D1): under `zero_fill` ONLY, surface the in-index NaN dates of the
    # caller's scalar input (a preserved member-guard NaN break) so the round-trip
    # guard reinstates the NaN rather than 0.0-bridging it. Any other policy (or no
    # scalar_returns) → None (byte-invisible).
    nan_dates: list[str] | None = None
    if densify_policy == "zero_fill" and scalar_returns is not None:
        nan_dates = sorted(
            ts.date().isoformat() for ts in scalar_returns.index[scalar_returns.isna()]
        )

    return BasisSeriesResult(
        metrics_json=metrics.metrics_json,
        sibling_kinds=metrics.sibling_kinds,
        series_rows=series_rows,
        gap_spans=gap_spans,
        conventions=conventions,
        nan_dates=nan_dates,
        insufficient_window=metrics.insufficient_window,
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

    payload: dict[str, Any] = {
        "schema": _PAYLOAD_SCHEMA_VERSION,
        "basis": basis,
        "rows": result.series_rows,
        "gap_spans": result.gap_spans,
        "conventions": result.conventions,
    }
    # Phase 105 (D1): additive composite-only key (JSONB, no DDL) — emitted ONLY when
    # the derive surfaced guard-NaN dates under `zero_fill`, so no other payload shape
    # changes.
    if result.nan_dates is not None:
        payload["nan_dates"] = result.nan_dates
    supabase.rpc(
        "upsert_strategy_analytics_series_batch",
        {"p_strategy_id": strategy_id, "p_kinds": {kind: payload}},
    ).execute()
