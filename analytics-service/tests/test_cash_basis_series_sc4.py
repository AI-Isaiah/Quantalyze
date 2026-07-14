"""Phase 104 (BB-01) — the load-bearing SC proofs for the additive DARK
cash_settlement daily-return SERIES persist at the single-key broker-derive seam.

Wave 1 (104-01) shipped an ADDITIVE, DARK write: beside the Phase-103
mark_to_market series persist, ``run_derive_broker_dailies_job`` now also derives
the CASH daily series through the shared ``derive_basis_series`` route and persists
it as ``strategy_analytics_series`` kind ``cash_settlement`` — with ZERO readers
this phase (Phase 105/106 collapse the scalar route onto it). This module pins the
four guarantees that keep that write honest:

  * **SC-4 byte-identity** (Test 1): with the cash persist ACTIVE vs no-opped, the
    ``csv_daily_returns`` delete+upsert payloads, the ``strategy_analytics``
    prestamp payload (incl. ``metrics_json_by_basis`` — NO ``cash_settlement`` key),
    and the ``enqueue_compute_job`` RPC are DICT-EQUAL — the ONLY delta is the
    additive ``cash_settlement`` entry in ``upsert_strategy_analytics_series_batch``.
    Because 104-01 dropped the benchmark-fetch hoist, this dual-run captures the
    ENTIRE Phase-104 production delta.
  * **SC-1 round-trip + coverage mask** (Test 2): the persisted sparse cash rows
    reproduce the FINITE (``pd.notna``) subset of the fixture returns bit-exactly
    (``assert_series_equal(check_exact=True)``); an interior NaN guard day is ABSENT
    from BOTH the series row and ``csv_daily_returns`` and is covered by ``gap_spans``.
  * **Convention fidelity** (Tests 3-4): a Zavara-style simple/active override and a
    traditional-asset √252 fixture echo the correct conventions in the persisted
    payload while the legacy outputs stay byte-untouched; the benchmark IDENTITY
    ``"BTC"`` travels UNCONDITIONALLY (present even when the MTM-side benchmark fetch
    RAISES — the cash derive passes ``benchmark_rets=None``).
  * **Boundary guards** (Tests 5-7, appended in Task 2): the cash SCALAR path is not
    yet routed through the shared derive (SC-2), no reader consumes the dark row
    (INERT read), and exactly one persist seam exists (A3 honest-absence).

Each test names — in its docstring — the mutation it kills (neuter-falsifiability).
Network-free: every I/O primitive is a stub / AsyncMock reused from the sibling
single-key seam harness (``tests.test_mtm_single_key``); no MCP, no live DB.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
import pytest
from unittest.mock import MagicMock, patch

import services.basis_series as _bs
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_mtm_single_key import (
    _ALLOC_CONFIG,
    _STRATEGY_ID,
    _apply,
    _base_patches,
    _cash_series,
    _ctx,
    _find_prestamp,
    _mtm_series,
    _patch_benchmark,
    _recording_ledger,
    _report,
)

_SERIES_RPC = "upsert_strategy_analytics_series_batch"
_CASH_KIND = "cash_settlement"


# ── seam runner + capture extractors ────────────────────────────────────────


def _cash_noop_patch() -> Any:
    """Patch ``persist_basis_series`` at its SOURCE so a ``basis="cash_settlement"``
    call NO-OPS while ``basis="mark_to_market"`` passes through — this reproduces the
    exact pre-104 seam (MTM series persist only). job_worker imports the helper
    function-locally, so patching the module attribute rebinds the name at call time.
    """
    _real = _bs.persist_basis_series

    def _wrapper(
        supabase: Any, strategy_id: str, *, basis: str = "mark_to_market",
        result: Any,
    ) -> None:
        if basis == _CASH_KIND:
            return  # simulate the pre-Phase-104 seam
        _real(supabase, strategy_id, basis=basis, result=result)

    return patch("services.basis_series.persist_basis_series", new=_wrapper)


async def _run_seam(
    strategy_row: dict,
    *,
    has_option_activity: bool,
    cash_noop: bool = False,
    benchmark_raises: bool = False,
    returns: pd.Series | None = None,
    mtm_series: pd.Series | None = None,
) -> dict:
    """Run the strategy-mode Deribit broker-derive once against fully mocked I/O and
    return the supabase op capture. ``has_option_activity`` selects the two-pass
    (cash + MTM) vs single-pass (cash only) shape; ``cash_noop`` disables the additive
    cash series persist to reproduce the pre-104 seam."""
    _returns = _cash_series() if returns is None else returns
    _mtm = _mtm_series() if mtm_series is None else mtm_series
    ctx, capture = _ctx(strategy_row=strategy_row)
    if has_option_activity:
        reports = [_report(has_option_activity=True), _report(has_option_activity=True)]
        combine = MagicMock(side_effect=[
            (_returns, {"used_heuristic_capital": False}),
            (_mtm, {"used_heuristic_capital": False}),
        ])
    else:
        reports = [_report(has_option_activity=False)]
        combine = MagicMock(return_value=(_returns, {"used_heuristic_capital": False}))
    ledger_mock, _calls = _recording_ledger(reports)
    patches = _base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    )
    patches.append(_patch_benchmark(raises=benchmark_raises))
    if cash_noop:
        patches.append(_cash_noop_patch())
    with _apply(patches):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    return capture


def _cash_series_payload(capture: dict) -> dict | None:
    """The additive cash_settlement series JSONB payload (rows/gap_spans/conventions)
    from the ``upsert_strategy_analytics_series_batch`` RPC, or None if absent."""
    for name, payload in capture["rpc_calls"]:
        if name == _SERIES_RPC and _CASH_KIND in payload.get("p_kinds", {}):
            return payload["p_kinds"][_CASH_KIND]
    return None


def _noncash_track(capture: dict) -> dict:
    """EVERYTHING the seam writes EXCEPT the additive cash series RPC — the surface
    SC-4 protects. Includes the csv_daily_returns upserts + reconcile-delete filters,
    the FULL strategy_analytics prestamp payload (strategy_id + data_quality_flags +
    metrics_json_by_basis), and every RPC call other than the cash series persist
    (i.e. the MTM series persist + enqueue_compute_job)."""
    csv_upserts = [
        payload for name, payload, _c in capture["upserts"]
        if name == "csv_daily_returns"
    ]
    csv_deletes = [
        d["filters"] for d in capture["deletes"]
        if d["table"] == "csv_daily_returns"
    ]
    rpc_noncash = [
        (name, payload) for name, payload in capture["rpc_calls"]
        if not (name == _SERIES_RPC and _CASH_KIND in payload.get("p_kinds", {}))
    ]
    return {
        "csv_upserts": csv_upserts,
        "csv_deletes": csv_deletes,
        "prestamp": _find_prestamp(capture),
        "rpc_noncash": rpc_noncash,
    }


def _csv_row_map(capture: dict) -> dict[str, float]:
    """{date: daily_return} across every csv_daily_returns upsert row."""
    out: dict[str, float] = {}
    for name, payload, _c in capture["upserts"]:
        if name == "csv_daily_returns":
            for row in payload:
                out[row["date"]] = row["daily_return"]
    return out


# ── Test 1: SC-4 dual-run byte-identity ─────────────────────────────────────


@pytest.mark.asyncio
async def test_sc4_cash_series_dual_run_byte_identity() -> None:
    """SC-4: the additive DARK cash-series persist changes NOTHING the legacy cash
    path writes or reads. Run A (as-shipped) vs Run B (cash persist no-opped) on the
    IDENTICAL options-book fixture: the csv_daily_returns delete+upsert payloads, the
    FULL strategy_analytics prestamp (incl. metrics_json_by_basis — NO cash_settlement
    key), and every non-cash RPC (MTM series persist + enqueue) are DICT-EQUAL. The
    ONLY delta is the presence of the cash_settlement entry in the series-batch RPC.

    Kills: the cash block perturbing rows_payload / the delete span / the prestamp
    (dual-run inequality reddens), OR leaking a cash_settlement key into
    metrics_json_by_basis (the explicit no-key invariant below reddens — the dual-run
    alone would NOT catch it since both runs execute the same prestamp code)."""
    strategy_row = {"asset_class": "crypto"}
    cap_a = await _run_seam(strategy_row, has_option_activity=True, cash_noop=False)
    cap_b = await _run_seam(strategy_row, has_option_activity=True, cash_noop=True)

    track_a = _noncash_track(cap_a)
    track_b = _noncash_track(cap_b)

    assert track_a["csv_upserts"] == track_b["csv_upserts"], (
        "the cash-series persist perturbed the csv_daily_returns payload — SC-4 breach"
    )
    assert track_a["csv_deletes"] == track_b["csv_deletes"], (
        "the cash-series persist perturbed the reconcile-delete span — SC-4 breach"
    )
    assert track_a["prestamp"] == track_b["prestamp"], (
        "the cash-series persist perturbed the strategy_analytics prestamp — SC-4 breach"
    )
    assert track_a["rpc_noncash"] == track_b["rpc_noncash"], (
        "the cash-series persist perturbed the MTM persist / enqueue RPCs — SC-4 breach"
    )

    # The ONLY delta: the additive cash_settlement series RPC (present A, absent B).
    assert _cash_series_payload(cap_a) is not None, (
        "Run A must persist the additive cash_settlement series"
    )
    assert _cash_series_payload(cap_b) is None, (
        "Run B (cash no-opped) must NOT persist any cash_settlement series"
    )

    # Load-bearing invariant (the mutation spot-check target): the single-key prestamp
    # by-basis object carries ONLY mark_to_market — a leaked cash_settlement key would
    # activate the recomputed cash overlay and risk SC-4 divergence (Phase-105 scope).
    by_basis_a = track_a["prestamp"].get("metrics_json_by_basis") or {}
    assert _CASH_KIND not in by_basis_a, (
        "a cash_settlement key leaked into the prestamp metrics_json_by_basis — "
        "this phase is SERIES-ONLY (no cash scalar overlay until Phase 105)"
    )


# ── Test 2: series ↔ csv_daily_returns round-trip + coverage mask ────────────


@pytest.mark.asyncio
async def test_cash_series_roundtrip_and_gap_mask() -> None:
    """SC-1: the persisted sparse cash rows reproduce the FINITE fixture subset
    bit-exactly, the interior NaN guard day is ABSENT from BOTH the series row and
    csv_daily_returns (identical date sets, bit-equal values), and gap_spans covers it.

    Kills: a gap_fill / 0.0-coercion of the guard day (it would re-appear as a 0.0 row
    in the series and csv → the guard-absent + round-trip asserts redden), OR rounding
    the persisted returns (check_exact=True reddens)."""
    idx = pd.date_range("2024-05-01", periods=4, freq="D")
    # interior NaN at 2024-05-02 → a guarded (uninterpretable) day.
    returns_with_gap = pd.Series(
        [0.01, float("nan"), 0.03, 0.02], index=idx, dtype="float64",
    )
    cap = await _run_seam(
        {"asset_class": "crypto"}, has_option_activity=False,
        returns=returns_with_gap,
    )

    cash = _cash_series_payload(cap)
    assert cash is not None, "a clean derive must persist the cash_settlement series"
    rows = cash["rows"]
    row_dates = [r["date"] for r in rows]

    # Round-trip: rebuilt sparse series ≡ the finite subset of the fixture. Both indices
    # are constructed identically from ISO date strings so no freq/unit drift can mask a
    # value diff; check_freq=False because the persisted rows carry no index frequency
    # (104-01 deviation #3). check_exact=True → no tolerance on the values.
    finite = returns_with_gap.dropna().sort_index()
    expected = pd.Series(
        finite.to_numpy(),
        index=pd.to_datetime([ts.date().isoformat() for ts in finite.index]),
        dtype="float64",
    )
    rebuilt = pd.Series(
        [r["return"] for r in rows],
        index=pd.to_datetime(row_dates),
        dtype="float64",
    )
    pd.testing.assert_series_equal(
        rebuilt, expected, check_exact=True, check_freq=False, check_names=False,
    )

    # Guard day absent from BOTH surfaces; identical date sets; bit-equal values.
    csv_map = _csv_row_map(cap)
    assert "2024-05-02" not in row_dates, "the guard day must be ABSENT from the series"
    assert "2024-05-02" not in csv_map, "the guard day must be ABSENT from csv_daily_returns"
    assert set(row_dates) == set(csv_map), (
        "the series rows and csv_daily_returns must cover the SAME date set"
    )
    assert {r["date"]: r["return"] for r in rows} == csv_map, (
        "the series rows and csv_daily_returns must carry bit-equal values"
    )

    # The coverage mask exists and covers the guard day (a pure function of the rows).
    gap_spans = cash["gap_spans"]
    assert any(
        s["start"] <= "2024-05-02" <= s["end"] for s in gap_spans
    ), f"gap_spans must cover the interior guard day 2024-05-02: {gap_spans!r}"


# ── Test 3: Zavara simple/active override conventions ───────────────────────


@pytest.mark.asyncio
async def test_cash_conventions_echo_zavara_override() -> None:
    """A Zavara-style allocated-capital override (cumulative_method="simple",
    metrics_basis="active_day") is echoed in the persisted cash conventions, and SC-4
    still holds under the override (dual-run non-cash track byte-identical; no cash
    key in the by-basis object).

    Kills: hardcoding the conventions to the geometric/calendar default (the echo
    would not match {simple, active}), OR leaking a cash_settlement key under the
    override (the by-basis assert reddens)."""
    strategy_row = {"asset_class": "crypto", "returns_denominator_config": _ALLOC_CONFIG}
    cap_a = await _run_seam(strategy_row, has_option_activity=True, cash_noop=False)

    cash = _cash_series_payload(cap_a)
    assert cash is not None
    assert cash["conventions"] == {
        "periods_per_year": 365,   # crypto asset_class → √365 (#597)
        "cumulative_method": "simple",  # from the override
        "day_basis": "active",     # metrics_day_basis("active_day")
        "benchmark": "BTC",        # unconditional identity carry
    }, f"cash conventions did not echo the Zavara override: {cash['conventions']!r}"

    cap_b = await _run_seam(strategy_row, has_option_activity=True, cash_noop=True)
    assert _noncash_track(cap_a) == _noncash_track(cap_b), (
        "SC-4 breach under the allocated-capital override"
    )
    by_basis = (_find_prestamp(cap_a) or {}).get("metrics_json_by_basis") or {}
    assert _CASH_KIND not in by_basis


# ── Test 4: traditional √252 clock + unconditional benchmark identity ────────


@pytest.mark.asyncio
async def test_cash_conventions_traditional_clock_and_unconditional_benchmark() -> None:
    """A traditional-asset fixture (asset_class not "crypto") annualizes on √252, and
    the benchmark IDENTITY "BTC" is present in the conventions UNCONDITIONALLY — even
    when the MTM-side get_benchmark_returns RAISES. The cash derive passes
    benchmark_symbol="BTC" with benchmark_rets=None, so the identity never depends on a
    fetch outcome.

    Kills: hardcoding periods_per_year to 365 (Pitfall 2 — the 252 assert reddens); a
    mutation that drops the benchmark identity string or makes it fetch-contingent (the
    benchmark assert reddens under the raising fetch)."""
    cap = await _run_seam(
        {"asset_class": "equity"}, has_option_activity=True, benchmark_raises=True,
    )

    cash = _cash_series_payload(cap)
    assert cash is not None
    conv = cash["conventions"]
    assert conv["periods_per_year"] == 252, (
        f"traditional asset must annualize on √252, got {conv['periods_per_year']}"
    )
    assert conv["benchmark"] == "BTC", (
        "the benchmark identity must be present even when the MTM benchmark fetch raised"
    )
    assert conv["cumulative_method"] == "geometric"
    assert conv["day_basis"] == "calendar"

    # Legacy cash outputs still landed (the raising benchmark fetch only feeds the MTM
    # compute; it never gates the cash path).
    assert _csv_row_map(cap), "the legacy csv_daily_returns cash rows must still persist"
