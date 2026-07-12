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

import math

import pandas as pd
import pytest

from types import SimpleNamespace

from services.basis_series import (
    KIND_MTM_DAILY_RETURNS,
    BasisSeriesResult,
    derive_basis_series,
    persist_basis_series,
)
from services.broker_dailies import gap_fill_daily_returns
from services.metrics import compute_all_metrics


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
        "schema": 1,
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
    """Only 'mark_to_market' is mapped in Phase 103 — an unknown basis raises
    ValueError (the kind map is where cash joins later)."""
    fake = _StubSupabase()
    with pytest.raises(ValueError):
        persist_basis_series(fake, "strat-1", basis="cash_settlement", result=_result())
