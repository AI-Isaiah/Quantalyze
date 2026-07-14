"""Tests for the shared dailies-canonical derive route (Phase 103, Wave 1).

`services/basis_series.py::derive_basis_series` is the DURABLE shared route the
backbone-unification arc (Phases 104-106) later adopts for cash. The keystone
here is the **anti-divergence round-trip guard** (`test_basis_series_roundtrip`):
the scalars the helper emits must be re-derivable BY CONSTRUCTION from the sparse
rows it persists, re-densified via the SAME `gap_fill_daily_returns` transform and
using the helper's own `conventions` echo. This is the durable regression that
would have caught the Phase-101 √252-vs-√365 divergence class (mismatched
`periods_per_year` between the persisted scalar and its conventions).

Per the OQ1 probe (`103-PROBE-OQ1.md`): interior NaN days reach the single-key MTM
series ONLY via a firing DQ-01 guard (data-dependent), while composite MTM carries
interior NaN + inter-member gaps by construction. The interior-NaN fixture below
pins the helper's sparsity-agnostic semantics for BOTH cases; the helper never
manufactures sparsity (LOCKED: no new math).
"""
from __future__ import annotations

from types import SimpleNamespace

import pandas as pd
import pytest

from services.basis_series import (
    KIND_CASH_SETTLEMENT,
    KIND_MTM_DAILY_RETURNS,
    BasisSeriesResult,
    _KIND_BY_BASIS,
    derive_basis_series,
    persist_basis_series,
)
from services.broker_dailies import gap_fill_daily_returns
from services.metrics import _drop_nonfinite, compute_all_metrics


def _mk_series(pairs: list[tuple[str, float]]) -> pd.Series:
    """Build a float64 daily Series on a `us`-pinned DatetimeIndex (the canonical
    analytics unit that `gap_fill_daily_returns` also pins)."""
    idx = pd.DatetimeIndex([d for d, _ in pairs]).as_unit("us")
    return pd.Series([v for _, v in pairs], index=idx, dtype="float64")


def _fixture_mtm() -> pd.Series:
    """Dense-shaped 25-day series with leading + trailing NaN, a 3-day interior
    hole, and a single ±Inf day — the shape a composite member NaN / single-key
    guard-fire produces. After sanitize the honest span is [Jan-02, Jan-24]."""
    idx = pd.date_range("2024-01-01", "2024-01-25", freq="D").as_unit("us")
    vals = [
        0.004, -0.002, 0.006, -0.001, 0.003, 0.005, -0.004, 0.002, 0.001, -0.003,
        0.007, -0.005, 0.004, 0.002, -0.001, 0.003, 0.006, -0.002, 0.005, -0.004,
        0.001, 0.003, -0.002, 0.004, 0.002,
    ]
    s = pd.Series(vals, index=idx, dtype="float64")
    s.iloc[0] = float("nan")        # leading NaN (Jan-01) → span starts Jan-02
    s.iloc[-1] = float("nan")       # trailing NaN (Jan-25) → span ends Jan-24
    s.iloc[9:12] = float("nan")     # Jan-10,11,12 → 3-day interior hole
    s.iloc[18] = float("inf")       # Jan-19 ±Inf → dropped single-day gap
    return s


def _fixture_cash() -> pd.Series:
    """Cash-convention shape (√252, geometric, calendar): dense, no NaN — proving
    the backbone can adopt this guard for cash UNCHANGED (SC-4 shape parity)."""
    idx = pd.date_range("2024-02-01", "2024-02-20", freq="D").as_unit("us")
    vals = [
        0.005, -0.003, 0.004, 0.002, -0.001, 0.006, -0.004, 0.003, 0.001, -0.002,
        0.004, 0.002, -0.005, 0.006, 0.001, -0.003, 0.004, 0.002, -0.001, 0.003,
    ]
    return pd.Series(vals, index=idx, dtype="float64")


def _roundtrip_recompute(r: BasisSeriesResult) -> dict:
    """Rebuild the Series from the PERSISTED rows → gap_fill → compute_all_metrics
    using the helper's OWN conventions echo. Any divergence between the persisted
    scalar's convention and the echoed convention (the Phase-101 √252 class) makes
    this recompute disagree with `r.metrics_json`."""
    rebuilt = pd.Series(
        [row["return"] for row in r.series_rows],
        index=pd.DatetimeIndex([row["date"] for row in r.series_rows]).as_unit("us"),
        dtype="float64",
    )
    redense = gap_fill_daily_returns(rebuilt)
    return compute_all_metrics(
        redense,
        None,
        periods_per_year=r.conventions["periods_per_year"],
        cumulative_method=r.conventions["cumulative_method"],
        day_basis=r.conventions["day_basis"],
    ).metrics_json


def test_basis_series_roundtrip() -> None:
    """THE anti-Phase-101 guard (MTM conventions: √365 geometric calendar).

    The persisted scalars must re-derive EXACTLY from the persisted sparse rows via
    gap_fill + the conventions echo. Neuter (compute scalars from the raw
    NaN-carrying series, skip gap_fill, or echo a wrong periods_per_year) → RED."""
    r = derive_basis_series(
        _fixture_mtm(), None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
    )
    assert _roundtrip_recompute(r) == r.metrics_json


def test_cash_shaped_roundtrip() -> None:
    """Same guard for a cash-convention fixture (√252 geometric calendar) — proves
    the backbone can route CASH through this helper unchanged (Phases 104-106)."""
    r = derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
    )
    assert _roundtrip_recompute(r) == r.metrics_json
    assert r.gap_spans == []  # dense input → no interior gaps


def test_sparse_emission_drops_nonfinite_keeps_zero() -> None:
    """NaN and ±Inf days are ABSENT from series_rows; a 0.0 day IS present (a
    gap-filled flat day is real data — mirrors csv_daily_returns `pd.notna`
    persist). Rows ascending, ISO YYYY-MM-DD, values UNROUNDED (round-trip needs
    byte-exact floats)."""
    s = _mk_series([
        ("2024-03-01", 0.01),
        ("2024-03-02", 0.0),          # real flat day — KEPT
        ("2024-03-03", float("nan")),  # dropped
        ("2024-03-04", -0.01),
        ("2024-03-05", float("inf")),  # dropped
        ("2024-03-06", 0.02),
    ])
    r = derive_basis_series(
        s, None, periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
    )
    dates = [row["date"] for row in r.series_rows]
    assert dates == ["2024-03-01", "2024-03-02", "2024-03-04", "2024-03-06"]
    # 0.0 day present with an exact 0.0 value
    zero_row = next(row for row in r.series_rows if row["date"] == "2024-03-02")
    assert zero_row["return"] == 0.0
    # unrounded float preserved
    assert next(row for row in r.series_rows if row["date"] == "2024-03-06")["return"] == 0.02
    # ascending
    assert dates == sorted(dates)


def test_gap_spans_interior_hole() -> None:
    """gap_spans == inclusive runs of calendar days ABSENT from series_rows within
    [first_row, last_row]. The MTM fixture: a 3-day hole (Jan-10..12) + a single
    ±Inf-dropped day (Jan-19). Leading/trailing NaN shrink the SPAN (not gaps)."""
    r = derive_basis_series(
        _fixture_mtm(), None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
    )
    assert r.gap_spans == [
        {"start": "2024-01-10", "end": "2024-01-12"},
        {"start": "2024-01-19", "end": "2024-01-19"},
    ]
    # span shrank to the sanitized first/last marked day (leading/trailing NaN gone)
    assert r.series_rows[0]["date"] == "2024-01-02"
    assert r.series_rows[-1]["date"] == "2024-01-24"


def test_gap_spans_mask_is_roundtrippable_from_rows() -> None:
    """The mask itself round-trips: gap_spans re-derived FROM series_rows equals
    r.gap_spans (the mask is a pure function of the persisted rows, not a second
    source of truth)."""
    r = derive_basis_series(
        _fixture_mtm(), None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
    )
    row_days = pd.DatetimeIndex([row["date"] for row in r.series_rows]).as_unit("us")
    full = pd.date_range(row_days.min(), row_days.max(), freq="D").as_unit("us")
    absent = full.difference(row_days)
    from services.stitch_composite import _consecutive_spans

    assert _consecutive_spans(list(absent)) == r.gap_spans


def test_conventions_echo() -> None:
    """conventions echoes exactly the three convention inputs (the divergence-guard
    anchor — the round-trip recomputes against THIS echo)."""
    r = derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
    )
    assert r.conventions == {
        "periods_per_year": 252,
        "cumulative_method": "geometric",
        "day_basis": "calendar",
    }


def test_conventions_echo_includes_benchmark_identity_when_supplied() -> None:
    """Phase 104 (104-SC5): when the deriving call site passes the benchmark
    IDENTITY STRING (`benchmark_symbol="BTC"`), conventions carries it as a fourth
    `benchmark` key — an identity, NOT a returns fetch (benchmark_rets stays None).
    Phase 105's scalar route re-derives α/β/corr itself but needs to know WHICH
    benchmark, so the string travels alongside conventions. Neuter (drop the key /
    hardcode) → RED."""
    r = derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
        benchmark_symbol="BTC",
    )
    assert r.conventions["benchmark"] == "BTC"
    assert r.conventions == {
        "periods_per_year": 252,
        "cumulative_method": "geometric",
        "day_basis": "calendar",
        "benchmark": "BTC",
    }


def test_conventions_echo_omits_benchmark_by_default() -> None:
    """The `benchmark_symbol` kwarg is ADDITIVE: the default (None) OMITS the key,
    so a caller that opts out is byte-unaffected (exactly the three convention
    keys). This pins the additive-only property protecting SC-4 (a reader that does
    not pass the identity sees an unchanged conventions shape). Neuter (always emit
    the key) → RED."""
    r = derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
    )
    assert "benchmark" not in r.conventions
    assert set(r.conventions) == {"periods_per_year", "cumulative_method", "day_basis"}


def test_sibling_kinds_passthrough() -> None:
    """sibling_kinds passes through from the MetricsResult unchanged (future
    cash/backbone adoption reads it) — same object the inline compute produced."""
    s = _fixture_cash()
    r = derive_basis_series(
        s, None, periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
    )
    dense = gap_fill_daily_returns(s)
    expected = compute_all_metrics(
        dense, None, periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
    ).sibling_kinds
    assert r.sibling_kinds == expected


def test_degenerate_input_raises_valueerror() -> None:
    """<2 rows after sanitize raises ValueError (mirrors compute_all_metrics — call
    sites keep their existing degrade/fail handling)."""
    s = _mk_series([("2024-04-01", 0.01), ("2024-04-02", float("nan"))])
    with pytest.raises(ValueError):
        derive_basis_series(
            s, None, periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
        )


# ── Task 3: persist_basis_series (pure-stub supabase — no live DB) ──────────────

class _StubQuery:
    """Records a delete filter chain: .delete().eq(...).eq(...).execute()."""

    def __init__(self, fake: "_StubSupabase", table: str) -> None:
        self.fake = fake
        self.table = table
        self._op: str | None = None
        self._eqs: list[tuple[str, object]] = []

    def delete(self) -> "_StubQuery":
        self._op = "delete"
        return self

    def eq(self, col: str, val: object) -> "_StubQuery":
        self._eqs.append((col, val))
        return self

    def execute(self) -> SimpleNamespace:
        if self._op == "delete":
            self.fake.deletes.append((self.table, list(self._eqs)))
        return SimpleNamespace(data=[])


class _StubSupabase:
    def __init__(self) -> None:
        self.rpc_calls: list[tuple[str, dict]] = []
        self.deletes: list[tuple[str, list[tuple[str, object]]]] = []

    def table(self, name: str) -> _StubQuery:
        return _StubQuery(self, name)

    def rpc(self, name: str, args: dict) -> SimpleNamespace:
        self.rpc_calls.append((name, args))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=None))


def _result() -> BasisSeriesResult:
    return derive_basis_series(
        _fixture_mtm(), None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
    )


def test_persist_upserts_via_batch_rpc() -> None:
    """Upsert routes the payload through the existing service-role-only batch RPC
    with the exact `{kind: payload}` shape. Neuter the payload keys / kind → RED."""
    fake = _StubSupabase()
    r = _result()
    persist_basis_series(fake, "strat-1", basis="mark_to_market", result=r)

    assert len(fake.rpc_calls) == 1
    name, args = fake.rpc_calls[0]
    assert name == "upsert_strategy_analytics_series_batch"
    assert args["p_strategy_id"] == "strat-1"
    assert set(args["p_kinds"]) == {KIND_MTM_DAILY_RETURNS}
    payload = args["p_kinds"][KIND_MTM_DAILY_RETURNS]
    assert payload == {
        "schema": 2,
        "basis": "mark_to_market",
        "rows": r.series_rows,
        "gap_spans": r.gap_spans,
        "conventions": r.conventions,
    }
    assert fake.deletes == []  # upsert path never deletes


def test_persist_none_heals_via_delete() -> None:
    """result=None DELETES the (strategy_id, kind) row — the heal path (Pitfall 5:
    a stale series must never outlive the scalars' authoritative-NULL write).
    Neuter (drop the kind filter / skip the delete) → RED."""
    fake = _StubSupabase()
    persist_basis_series(fake, "strat-1", basis="mark_to_market", result=None)

    assert fake.rpc_calls == []  # heal never upserts
    assert fake.deletes == [
        ("strategy_analytics_series",
         [("strategy_id", "strat-1"), ("kind", KIND_MTM_DAILY_RETURNS)]),
    ]


def test_persist_unknown_basis_raises() -> None:
    """An UNMAPPED basis raises ValueError (the kind map gates the write surface).
    Phase 104 added 'cash_settlement' to the map, so the unmapped example here is a
    string that is genuinely absent from `_KIND_BY_BASIS`."""
    fake = _StubSupabase()
    with pytest.raises(ValueError):
        persist_basis_series(fake, "strat-1", basis="not_a_real_basis", result=_result())


# ── Phase 104 (BB-01): cash_settlement joins _KIND_BY_BASIS (SERIES-ONLY) ───────


def test_cash_settlement_kind_mapping() -> None:
    """Phase 104: cash joins the basis→kind map. `strategy_analytics_series.kind` is
    unconstrained TEXT (no DDL), so adding a kind is a map entry + a module constant.
    Neuter (drop the map entry / rename the constant) → RED."""
    assert KIND_CASH_SETTLEMENT == "cash_settlement"
    assert _KIND_BY_BASIS["cash_settlement"] == "cash_settlement"
    assert _KIND_BY_BASIS["cash_settlement"] == KIND_CASH_SETTLEMENT


def _cash_result() -> BasisSeriesResult:
    """A cash-convention (√252) derived result carrying the benchmark identity."""
    return derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
        benchmark_symbol="BTC",
    )


def test_cash_persist_roundtrips_via_batch_rpc() -> None:
    """A cash persist routes the payload through the SAME service-role-only batch RPC
    keyed on the `cash_settlement` kind; rebuilding a Series from the persisted rows
    reproduces the sparse input EXACTLY (byte-equal floats). Neuter the kind / drop a
    payload field / round the floats → RED."""
    fake = _StubSupabase()
    r = _cash_result()
    persist_basis_series(fake, "strat-cash", basis="cash_settlement", result=r)

    assert len(fake.rpc_calls) == 1
    name, args = fake.rpc_calls[0]
    assert name == "upsert_strategy_analytics_series_batch"
    assert args["p_strategy_id"] == "strat-cash"
    assert set(args["p_kinds"]) == {KIND_CASH_SETTLEMENT}
    payload = args["p_kinds"][KIND_CASH_SETTLEMENT]
    assert payload == {
        "schema": 2,
        "basis": "cash_settlement",
        "rows": r.series_rows,
        "gap_spans": r.gap_spans,
        "conventions": r.conventions,
    }
    # the benchmark identity travels in the persisted conventions echo (104-SC5)
    assert payload["conventions"]["benchmark"] == "BTC"
    assert fake.deletes == []  # upsert path never deletes

    rebuilt = pd.Series(
        [row["return"] for row in payload["rows"]],
        index=pd.DatetimeIndex([row["date"] for row in payload["rows"]]).as_unit("us"),
        dtype="float64",
    )
    expected = _drop_nonfinite(_fixture_cash()).sort_index()
    # check_freq=False: the persisted rows carry no index frequency (a list of ISO
    # dates), so a rebuilt series has freq=None while the source fixture retains its
    # date_range freq — the round-trip guarantee is byte-exact VALUES + dates, not
    # the pandas freq attribute.
    pd.testing.assert_series_equal(rebuilt, expected, check_exact=True, check_freq=False)


# ── Phase 105 (D1): scalar_returns + densify_policy + nan_dates + insufficient_window ──


def _fixture_sparse_gapped() -> pd.Series:
    """A user-CSV weekend-gapped sparse series (trading days only, all finite). Its
    gap-filled form (0.0 weekend rows) computes DIFFERENT scalars than the sparse
    form itself — so it distinguishes `scalar_returns=sparse` from the default
    gap_fill(sparse) scalar."""
    return _mk_series([
        ("2024-03-01", 0.004),   # Fri
        ("2024-03-04", -0.002),  # Mon (Sat/Sun 03-02/03 absent)
        ("2024-03-05", 0.006),
        ("2024-03-06", -0.001),
        ("2024-03-07", 0.003),
        ("2024-03-08", 0.005),   # Fri
        ("2024-03-11", -0.004),  # Mon (weekend absent)
        ("2024-03-12", 0.002),
        ("2024-03-13", 0.001),
    ])


def _scalar_with_guard_nan() -> pd.Series:
    """A 5-day series carrying a single in-index guard-day NaN (2024-06-04) — the
    composite `zero_fill` scalar-input shape (0.0-bridged gaps but a preserved NaN
    break)."""
    return _mk_series([
        ("2024-06-03", 0.010),
        ("2024-06-04", float("nan")),  # in-index guard NaN
        ("2024-06-05", -0.020),
        ("2024-06-06", 0.030),
        ("2024-06-07", 0.010),
    ])


def test_default_path_byte_invisible() -> None:
    """Calling with NEITHER new kwarg is byte-identical to today: conventions has no
    "densify" key, nan_dates is None, and the persist payload carries no "nan_dates".
    Neuter (always emit the densify key / always set nan_dates) → RED."""
    r = derive_basis_series(
        _fixture_mtm(), None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
    )
    assert "densify" not in r.conventions
    assert r.nan_dates is None

    fake = _StubSupabase()
    persist_basis_series(fake, "s", basis="mark_to_market", result=r)
    payload = fake.rpc_calls[0][1]["p_kinds"][KIND_MTM_DAILY_RETURNS]
    assert "nan_dates" not in payload
    assert payload["schema"] == 2  # the bump is reader-invisible (SC-4-safe)


def test_scalar_returns_computes_on_exact_series() -> None:
    """scalar_returns=S computes metrics_json on EXACTLY S (never gap_fill(sparse)),
    while series_rows/gap_spans stay derived from _drop_nonfinite(returns). Neuter
    (compute the scalar from gap_fill(sparse) despite scalar_returns) → RED (asserted
    by the inequality against the gap-filled scalar)."""
    s = _fixture_sparse_gapped()
    r = derive_basis_series(
        s, None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
        scalar_returns=s,
    )
    on_exact = compute_all_metrics(
        s, None, periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
    ).metrics_json
    on_gapfilled = compute_all_metrics(
        gap_fill_daily_returns(_drop_nonfinite(s).sort_index()), None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
    ).metrics_json
    assert r.metrics_json == on_exact
    assert r.metrics_json != on_gapfilled  # the weekend 0.0 fills DO move the scalar
    # rows/gap_spans decoupled — still the honest sparse form of `returns`
    sparse = _drop_nonfinite(s).sort_index()
    assert [row["date"] for row in r.series_rows] == [
        ts.date().isoformat() for ts in sparse.index
    ]


def test_densify_echo_present_when_supplied() -> None:
    """densify_policy echoes into conventions["densify"] (the round-trip guard's
    reconstruction selector), leaving the other convention keys untouched."""
    r = derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
        densify_policy="sparse",
    )
    assert r.conventions["densify"] == "sparse"
    assert set(r.conventions) == {
        "periods_per_year", "cumulative_method", "day_basis", "densify",
    }


def test_densify_echo_omitted_by_default() -> None:
    """The densify_policy kwarg is ADDITIVE: the default (None) OMITS the key (mirror
    of test_conventions_echo_omits_benchmark_by_default). Neuter (always emit the
    key) → RED."""
    r = derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
    )
    assert "densify" not in r.conventions


def test_unknown_densify_policy_raises() -> None:
    """An out-of-set densify_policy fails LOUD (V5) — ValueError naming the allowed
    set {sparse, broker_nan, zero_fill}. Neuter (silently accept any string) → RED."""
    with pytest.raises(ValueError, match="zero_fill"):
        derive_basis_series(
            _fixture_cash(), None,
            periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
            densify_policy="bogus",
        )


def test_nan_dates_under_zero_fill() -> None:
    """densify_policy="zero_fill" + a scalar_returns carrying in-index NaN → nan_dates
    == the sorted ISO dates of those NaN positions (the additive composite key the
    round-trip guard reinstates)."""
    r = derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
        scalar_returns=_scalar_with_guard_nan(), densify_policy="zero_fill",
    )
    assert r.nan_dates == ["2024-06-04"]


def test_nan_dates_none_under_non_zero_fill_policy() -> None:
    """nan_dates is emitted ONLY for zero_fill — a NaN-carrying scalar under any other
    policy yields None. Neuter (emit nan_dates under a non-zero_fill policy) → RED."""
    r = derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
        scalar_returns=_scalar_with_guard_nan(), densify_policy="broker_nan",
    )
    assert r.nan_dates is None


def test_nan_dates_none_when_no_scalar_returns() -> None:
    """No scalar_returns → nan_dates is None regardless of policy (nothing to inspect
    for NaN positions)."""
    r = derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
        densify_policy="zero_fill",
    )
    assert r.nan_dates is None


def test_payload_carries_nan_dates_only_when_present() -> None:
    """The persist payload includes "nan_dates" ONLY when result.nan_dates is not
    None; schema is always 2. Neuter (always/never emit the key) → RED."""
    r = derive_basis_series(
        _fixture_cash(), None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
        scalar_returns=_scalar_with_guard_nan(), densify_policy="zero_fill",
    )
    fake = _StubSupabase()
    persist_basis_series(fake, "s", basis="cash_settlement", result=r)
    payload = fake.rpc_calls[0][1]["p_kinds"][KIND_CASH_SETTLEMENT]
    assert payload["nan_dates"] == ["2024-06-04"]
    assert payload["schema"] == 2


def test_insufficient_window_mirrors_metrics_result() -> None:
    """BasisSeriesResult.insufficient_window is a pass-through of the MetricsResult DQ
    flag (duck-compat for Plans 04/05). Neuter (hardcode False) → RED when the flag
    is True."""
    s = _fixture_cash()
    r = derive_basis_series(
        s, None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
    )
    expected = compute_all_metrics(
        gap_fill_daily_returns(_drop_nonfinite(s).sort_index()), None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
    ).insufficient_window
    assert r.insufficient_window == expected


# ── Task 2 (D1): densify_policy-aware round-trip guard + the 3-policy fixtures ──


def _fixture_broker_gapped() -> pd.Series:
    """A broker-sourced finite series with a 2-day interior CALENDAR gap (07-04/05
    ABSENT, not NaN). The broker scalar-input reindexes those in-span absences to NaN
    guard days — the `broker_nan` policy."""
    return _mk_series([
        ("2024-07-01", 0.005),
        ("2024-07-02", -0.003),
        ("2024-07-03", 0.004),
        # 2024-07-04, 2024-07-05 ABSENT (broker guard days → NaN in the scalar input)
        ("2024-07-06", 0.002),
        ("2024-07-07", -0.001),
        ("2024-07-08", 0.006),
    ])


def _fixture_stitched_composite() -> pd.Series:
    """A stitched-composite-shaped series: an inter-member ABSENT gap (07-13/14) AND
    an INTERIOR in-index member-guard NaN (07-16). The composite scalar input is
    `gap_fill(stitched)` — 0.0 at the inter-member gap, NaN PRESERVED at the guard."""
    return _mk_series([
        ("2024-07-10", 0.004),
        ("2024-07-11", -0.002),
        ("2024-07-12", 0.006),
        # 2024-07-13, 2024-07-14 ABSENT (inter-member gap → 0.0 bridge)
        ("2024-07-15", 0.003),
        ("2024-07-16", float("nan")),  # in-index member-guard NaN (interior break)
        ("2024-07-17", 0.005),
        ("2024-07-18", -0.001),
        ("2024-07-19", 0.002),
    ])


def _fixture_stitched_edge_nan() -> pd.Series:
    """A stitched-composite series whose member-guard NaN sits at the TRAILING EDGE
    (08-08). The nan_date falls OUTSIDE [first_row, last_row] (the honest rows end at
    08-07), so the round-trip reconstruction must union-reindex to re-extend the span."""
    return _mk_series([
        ("2024-08-01", 0.004),
        ("2024-08-02", -0.002),
        # 2024-08-03, 2024-08-04 ABSENT (inter-member gap → 0.0 bridge)
        ("2024-08-05", 0.006),
        ("2024-08-06", 0.003),
        ("2024-08-07", -0.001),
        ("2024-08-08", float("nan")),  # TRAILING-edge member-guard NaN (union-reindex)
    ])


def test_sparse_policy_roundtrip() -> None:
    """A weekend-gapped user-CSV sparse fixture derived with scalar_returns=sparse +
    densify_policy="sparse" round-trips dict-equal: the guard reconstructs the scalar
    as the rows VERBATIM (no gap_fill). Neuter (reconstruct with gap_fill) → RED."""
    s = _fixture_sparse_gapped()
    r = derive_basis_series(
        s, None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
        scalar_returns=s, densify_policy="sparse",
    )
    assert _roundtrip_recompute(r) == r.metrics_json


def test_broker_nan_policy_roundtrip() -> None:
    """A broker guard-day fixture derived with scalar_returns=dense-reindexed-NaN +
    densify_policy="broker_nan" round-trips dict-equal: the guard reconstructs every
    in-span ABSENCE as a NaN guard day (reindex to the dense calendar). Neuter
    (reconstruct with gap_fill so absences become 0.0) → RED."""
    s = _fixture_broker_gapped()
    dense_idx = pd.date_range("2024-07-01", "2024-07-08", freq="D").as_unit("us")
    scalar = s.reindex(dense_idx)  # 07-04/05 → NaN guard days
    r = derive_basis_series(
        s, None,
        periods_per_year=252, cumulative_method="geometric", day_basis="calendar",
        scalar_returns=scalar, densify_policy="broker_nan",
    )
    assert _roundtrip_recompute(r) == r.metrics_json


def test_zero_fill_composite_guard_nan_roundtrip_flagship() -> None:
    """D1 FLAGSHIP: a stitched-composite fixture (inter-member gap + interior
    member-guard NaN) derived with scalar_returns=gap_fill(stitched) +
    densify_policy="zero_fill" round-trips DICT-EQUAL — the guard 0.0-bridges the
    inter-member gap but REINSTATES the member-guard NaN at nan_dates.

    Neuter target (RED, pinned in-test): dropping nan_dates from the reconstruction
    (plain gap_fill, i.e. the pre-D1 path) 0.0-bridges the guard day and does NOT
    equal r.metrics_json — a 0.0 flat day yields different vol/Sharpe than a NaN
    break, so a silently-dropped nan_dates can never pass."""
    stitched = _fixture_stitched_composite()
    scalar = gap_fill_daily_returns(stitched)  # 0.0 at 07-13/14, NaN preserved at 07-16
    r = derive_basis_series(
        stitched, None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
        scalar_returns=scalar, densify_policy="zero_fill",
    )
    assert r.nan_dates == ["2024-07-16"]
    assert _roundtrip_recompute(r) == r.metrics_json

    # neuter RED: the pre-D1 reconstruction (drop nan_dates → plain gap_fill) diverges
    rebuilt = pd.Series(
        [row["return"] for row in r.series_rows],
        index=pd.DatetimeIndex([row["date"] for row in r.series_rows]).as_unit("us"),
        dtype="float64",
    )
    naive = compute_all_metrics(
        gap_fill_daily_returns(rebuilt), None,
        periods_per_year=r.conventions["periods_per_year"],
        cumulative_method=r.conventions["cumulative_method"],
        day_basis=r.conventions["day_basis"],
    ).metrics_json
    assert naive != r.metrics_json


def test_zero_fill_edge_guard_nan_roundtrip_union_reindex() -> None:
    """D1 FLAGSHIP (edge case): a member-guard NaN at the TRAILING edge — the nan_date
    lies OUTSIDE [first_row, last_row] — still round-trips dict-equal via the
    union-reindex path (the reconstruction re-extends the span to cover the nan_date).
    Neuter (reindex only to [first_row,last_row], dropping the edge nan_date) → RED."""
    stitched = _fixture_stitched_edge_nan()
    scalar = gap_fill_daily_returns(stitched)  # 0.0 at 08-03/04, NaN preserved at 08-08
    r = derive_basis_series(
        stitched, None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
        scalar_returns=scalar, densify_policy="zero_fill",
    )
    assert r.nan_dates == ["2024-08-08"]
    # the guard NaN is beyond the last honest row (08-07)
    assert r.series_rows[-1]["date"] == "2024-08-07"
    assert _roundtrip_recompute(r) == r.metrics_json


def test_simple_active_denominator_roundtrip() -> None:
    """The guard mechanism holds under the MED-2 Zavara/ccxt-override convention pair
    (cumulative_method="simple", day_basis="active") — a sparse fixture derived under
    those conventions round-trips dict-equal (the seam WIRING test is Plan 03's)."""
    s = _fixture_sparse_gapped()
    r = derive_basis_series(
        s, None,
        periods_per_year=252, cumulative_method="simple", day_basis="active",
        scalar_returns=s, densify_policy="sparse",
    )
    assert _roundtrip_recompute(r) == r.metrics_json


def test_cash_persist_none_heals_via_delete() -> None:
    """result=None DELETES the (strategy_id, cash_settlement) row — the Pitfall-5
    heal so a stale cash series never outlives an authoritative-reject derive. Neuter
    (drop the kind filter / skip the delete) → RED."""
    fake = _StubSupabase()
    persist_basis_series(fake, "strat-cash", basis="cash_settlement", result=None)

    assert fake.rpc_calls == []  # heal never upserts
    assert fake.deletes == [
        ("strategy_analytics_series",
         [("strategy_id", "strat-cash"), ("kind", KIND_CASH_SETTLEMENT)]),
    ]
