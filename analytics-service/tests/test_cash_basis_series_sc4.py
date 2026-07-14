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
    Scope note: both runs execute the new MTM-side ``benchmark_symbol="BTC"`` call, so
    this dual-run captures the cash-PERSIST delta but is structurally BLIND to the
    MTM-payload ``conventions.benchmark`` delta vs pre-104. That MTM delta is SC-4-safe
    by inspection, not by this test: ``parseMtmSeriesPayload``
    (``src/lib/factsheet/composite-read-path.ts``) consumes only ``rows``/``gap_spans``
    and never ``conventions`` (no strict schema/version check), and no Python reader
    consumes it — so the extra ``conventions`` key changes nothing a reader sees.
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

from pathlib import Path
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
    _find_failed_stamp,
    _find_prestamp,
    _mtm_series,
    _patch_benchmark,
    _recording_ledger,
    _report,
)

_SERIES_RPC = "upsert_strategy_analytics_series_batch"
_CASH_KIND = "cash_settlement"

# A malformed returns_denominator_config (denominator not in the valid set) — the
# parse FAILS LOUD (ReturnsDenominatorConfigError → PERMANENT). Used to pin the MED-2
# venue-wide fail-loud parity with analytics_runner's B2 disposition.
_MALFORMED_CONFIG = {"denominator": "not_a_valid_capital_base"}


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


def _trusted_cash_payload(capture: dict) -> dict | None:
    """The cash_settlement payload — but ONLY when the derive reached terminal SUCCESS
    (a csv_source PRESTAMP with no ``computation_status``). After a terminal-failure arm
    (a ``computation_status='failed'`` stamp) the series is heal-DELETED, so trusting a
    captured payload there would be a STALE read; return None (expect-absent). This
    mirrors the MED-1 read gate (Plan 02, D3 caveat b): a reader trusts the series only
    when its scalar row is complete. Deliberately independent of the heal-delete — the
    gate holds even if a stale payload lingers (that is what the read gate protects)."""
    if _find_failed_stamp(capture) is not None:
        return None
    if _find_prestamp(capture) is None:
        return None
    return _cash_series_payload(capture)


def _series_deletes(capture: dict, kind: str) -> list[dict]:
    """strategy_analytics_series DELETEs filtered on ``kind`` — the heal arm (a
    persist_basis_series(result=None) call routes through the table delete chain)."""
    return [
        d for d in capture["deletes"]
        if d["table"] == "strategy_analytics_series"
        and d["filters"].get("eq:kind") == kind
    ]


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
        "densify": "broker_nan",   # Phase 105 (D1) seam densify tag
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


# ── Task 2: broker_nan densify-tag round-trip + terminal-arm heal-deletes ────


@pytest.mark.asyncio
async def test_cash_series_broker_nan_densify_tag_and_roundtrip() -> None:
    """D1 (collapse #6): the seam cash derive passes scalar_returns=returns +
    densify_policy="broker_nan", so the persisted payload carries schema==2 and
    conventions["densify"]=="broker_nan", and the anti-divergence round-trip guard
    reconstructs the exact scalar input from the sparse rows END-TO-END — the seam's
    cash echo is now round-trip-complete. The persisted rows/gap_spans/conventions are
    byte-identical to a direct derive_basis_series(scalar_returns=returns, broker_nan)
    with the seam's conventions.

    Kills: dropping densify_policy (the "densify" key is absent → KeyError reddens); or
    passing a scalar_returns that disagrees with the rows (the round-trip guard reddens)."""
    from services.basis_series import BasisSeriesResult, derive_basis_series
    from tests.test_basis_series import _roundtrip_recompute

    idx = pd.date_range("2024-05-01", periods=4, freq="D")
    # interior guard-NaN at 2024-05-02, finite endpoints (span == finite span).
    returns_with_gap = pd.Series(
        [0.01, float("nan"), 0.03, 0.02], index=idx, dtype="float64",
    )
    cap = await _run_seam(
        {"asset_class": "crypto"}, has_option_activity=False,
        returns=returns_with_gap,
    )

    cash = _cash_series_payload(cap)
    assert cash is not None
    assert cash["schema"] == 2
    assert cash["conventions"]["densify"] == "broker_nan", (
        f"the seam must tag the cash echo broker_nan: {cash['conventions']!r}"
    )

    # The reference derive the seam runs (crypto → √365 geometric calendar, BTC,
    # scalar_returns=returns, broker_nan). The persisted payload matches it exactly.
    reference = derive_basis_series(
        returns_with_gap, None,
        periods_per_year=365, cumulative_method="geometric", day_basis="calendar",
        benchmark_symbol="BTC",
        scalar_returns=returns_with_gap, densify_policy="broker_nan",
    )
    assert cash["rows"] == reference.series_rows
    assert cash["gap_spans"] == reference.gap_spans
    assert cash["conventions"] == reference.conventions

    # The round-trip guard covers the seam's cash echo end-to-end: reconstruct the
    # scalar from the persisted rows per the broker_nan echo → the reference scalars.
    reconstructed = BasisSeriesResult(
        metrics_json={}, sibling_kinds={},
        series_rows=cash["rows"], gap_spans=cash["gap_spans"],
        conventions=cash["conventions"], nan_dates=cash.get("nan_dates"),
    )
    assert _roundtrip_recompute(reconstructed) == reference.metrics_json

    # A clean derive is terminal-SUCCESS, so the gate-respecting harness trusts it.
    assert _trusted_cash_payload(cap) is not None


@pytest.mark.asyncio
async def test_insufficient_history_arm_heals_both_series() -> None:
    """D3 SECONDARY: the strategy-mode <2-interpretable-days terminal arm heal-DELETEs
    BOTH series rows (cash_settlement AND mtm_daily_returns) — a stale row from a prior
    longer-history derive must not outlive the now-authoritative 'failed' stamp. NO
    series upsert fires, and the gate-respecting harness expects the cash payload ABSENT.

    Neuter: remove the _heal_delete_basis_series() call from the <2 arm → the two DELETEs
    vanish → reddens."""
    one_day = pd.Series(
        [0.01], index=pd.DatetimeIndex(["2024-05-01"]), dtype="float64",
    )
    cap = await _run_seam(
        {"asset_class": "crypto"}, has_option_activity=False, returns=one_day,
    )
    assert len(_series_deletes(cap, _CASH_KIND)) == 1, (
        f"the <2 arm must heal-delete the cash series; got {cap['deletes']!r}"
    )
    assert len(_series_deletes(cap, _bs.KIND_MTM_DAILY_RETURNS)) == 1, (
        f"the <2 arm must heal-delete the MTM series; got {cap['deletes']!r}"
    )
    # NO series upsert on the terminal arm, and the gate expects-absent.
    assert _cash_series_payload(cap) is None
    assert _trusted_cash_payload(cap) is None
    # The heal is scoped to this strategy (never a cross-strategy wipe).
    assert _series_deletes(cap, _CASH_KIND)[0]["filters"].get("eq:strategy_id") == _STRATEGY_ID


@pytest.mark.asyncio
async def test_stamp_failed_heals_both_series() -> None:
    """D3 SECONDARY (single choke point): a terminal _stamp_strategy_analytics_failed
    (here a malformed-config PERMANENT failure on the ccxt path) heal-DELETEs BOTH series
    rows via the ONE heal inside the stamp helper — covering every failure that routes
    through it. The gate-respecting harness expects the cash payload ABSENT after the
    terminal-failure stamp.

    Neuter: remove the _heal_delete_basis_series() call from _stamp_strategy_analytics_failed
    → the deletes vanish → reddens."""
    strategy_row = {
        "id": "strat-heal-stamp",
        "user_id": "user-1",
        "asset_class": "crypto",
        "returns_denominator_config": _MALFORMED_CONFIG,
    }
    result, cap = await _run_ccxt_seam(strategy_row)
    assert result.outcome == DispatchOutcome.FAILED
    assert len(_series_deletes(cap, _CASH_KIND)) == 1, (
        f"the stamp helper must heal-delete the cash series; got {cap['deletes']!r}"
    )
    assert len(_series_deletes(cap, _bs.KIND_MTM_DAILY_RETURNS)) == 1, (
        f"the stamp helper must heal-delete the MTM series; got {cap['deletes']!r}"
    )
    assert _cash_series_payload(cap) is None
    assert _trusted_cash_payload(cap) is None


def test_trusted_cash_payload_respects_terminal_status_gate() -> None:
    """D3 caveat b (harness gate-respect): _trusted_cash_payload trusts a captured cash
    payload ONLY on terminal-SUCCESS. Given a synthetic capture that BOTH stamped a
    terminal 'failed' AND (hypothetically) still carries a cash payload — the harness must
    NOT trust it (the read gate is the guarantee; the heal-delete is defense-in-depth, so
    the gate must hold even if a stale payload lingers).

    Kills: making _trusted_cash_payload ignore the failed stamp (return the raw payload)
    → this assert reddens; it is what keeps a gate-respecting test from reddening on a
    legitimately-failed strategy."""
    fake_capture = {
        "upserts": [
            (
                "strategy_analytics",
                {
                    "computation_status": "failed",
                    "computation_warned": False,
                    "data_quality_flags": {"csv_source": True},
                    "metrics_json_by_basis": None,
                },
                "strategy_id",
            ),
        ],
        "deletes": [],
        "rpc_calls": [
            (
                _SERIES_RPC,
                {"p_strategy_id": "s", "p_kinds": {_CASH_KIND: {"schema": 2, "rows": []}}},
            ),
        ],
    }
    # A stale payload IS present in the capture …
    assert _cash_series_payload(fake_capture) is not None
    # … but the gate refuses to trust it after a terminal-failure stamp.
    assert _trusted_cash_payload(fake_capture) is None, (
        "the harness must NOT trust a cash payload once a terminal-failure stamp exists"
    )


# ── Task 1 (MED-2): the venue-agnostic parse — the 5th SC-4 fixture (ccxt) ────


async def _run_ccxt_seam(
    strategy_row: dict, *, returns: pd.Series | None = None,
) -> tuple[Any, dict]:
    """Run the strategy-mode CCXT (binance) broker-derive once against fully mocked
    I/O and return (DispatchResult, capture). Reuses the dual-mode harness whose venue
    is a ccxt exchange (``key_row['exchange']='binance'``), so
    ``combine_realized_and_funding`` — NOT the deribit native ledger — feeds the single
    cash derive at the seam. This is the venue that exercises the MED-2 hoist: pre-105
    the ccxt arm NEVER parsed ``returns_denominator_config`` (it was deribit-arm-only),
    so an override echoed the geometric/calendar default and a malformed config was
    silently ignored."""
    from tests.test_derive_broker_dailies_dualmode import (
        _build_ctx as _dm_ctx,
        _patches as _dm_patches,
    )

    _returns = _cash_series() if returns is None else returns
    ctx, capture = _dm_ctx(
        key_row={"id": "key-ccxt", "exchange": "binance", "user_id": "user-1"},
        strategy_row=strategy_row,
    )
    patches = _dm_patches(ctx, key_mode=False, returns=_returns)
    with _apply(list(patches)):
        result = await run_derive_broker_dailies_job(
            {"kind": "derive_broker_dailies", "strategy_id": strategy_row["id"]}
        )
    return result, capture


@pytest.mark.asyncio
async def test_cash_conventions_echo_ccxt_override() -> None:
    """MED-2 (the 5th SC-4 fixture: ccxt-override): a CCXT (binance) strategy carrying a
    Zavara-style returns_denominator_config override (cumulative_method="simple",
    metrics_basis="active_day") now echoes {simple, active} in the persisted cash
    conventions. Pre-105 the ccxt arm NEVER parsed the override (the parse lived only
    inside ``if venue == "deribit"``), so it echoed the geometric/calendar DEFAULT — the
    MED-2 bug. Proves the parse is hoisted VENUE-AGNOSTICALLY (analytics_runner.py:2304-2316
    parity), feeding the SAME single derive with no venue branch inside the derive path.

    Neuter: re-scope the parse back inside the ``if venue == "deribit"`` branch →
    ``denominator_config`` stays None on the ccxt path → conventions echo
    geometric/calendar → this assert reddens."""
    strategy_row = {
        "id": "strat-ccxt-ovr",
        "user_id": "user-1",
        "asset_class": "crypto",
        "returns_denominator_config": _ALLOC_CONFIG,
    }
    result, capture = await _run_ccxt_seam(strategy_row)
    assert result.outcome == DispatchOutcome.DONE
    cash = _cash_series_payload(capture)
    assert cash is not None, "a ccxt strategy derive must persist the cash_settlement series"
    assert cash["conventions"] == {
        "periods_per_year": 365,          # crypto asset_class → √365 (#597)
        "cumulative_method": "simple",    # from the override (was geometric — MED-2)
        "day_basis": "active",            # metrics_day_basis("active_day") (was calendar)
        "benchmark": "BTC",               # unconditional identity carry
        "densify": "broker_nan",          # Phase 105 (D1) seam densify tag
    }, f"ccxt cash conventions did not echo the override (MED-2): {cash['conventions']!r}"


@pytest.mark.asyncio
async def test_ccxt_malformed_config_fails_permanent() -> None:
    """MED-2 fail-loud parity: a CCXT strategy with a MALFORMED
    returns_denominator_config now FAILS LOUD — a PERMANENT DispatchResult plus a
    terminal ``computation_status='failed'`` strategy_analytics stamp (metrics_json_by_basis
    authoritatively NULL) — matching run_csv_strategy_analytics' B2 disposition. Pre-105
    the ccxt arm never parsed it, so a bad config was silently ignored and a factsheet
    shipped on a guessed capital base.

    Neuter: re-scope the parse inside the deribit arm → the ccxt path never parses → the
    derive completes DONE → this assert reddens."""
    strategy_row = {
        "id": "strat-ccxt-bad",
        "user_id": "user-1",
        "asset_class": "crypto",
        "returns_denominator_config": _MALFORMED_CONFIG,
    }
    result, capture = await _run_ccxt_seam(strategy_row)
    assert result.outcome == DispatchOutcome.FAILED, (
        "a malformed ccxt config must FAIL PERMANENT (parity with the runner's B2 "
        f"disposition), got {result.outcome!r}"
    )
    assert result.error_kind == "permanent"
    failed = _find_failed_stamp(capture)
    assert failed is not None, "a malformed ccxt config must stamp a terminal 'failed'"
    assert failed["computation_status"] == "failed"
    assert failed["computation_warned"] is False
    assert failed["metrics_json_by_basis"] is None
    # No cash series is persisted on the terminal-failure path.
    assert _cash_series_payload(capture) is None


# ── boundary guards (Task 2): SERIES-ONLY + INERT read + single seam ─────────


def _repo_root() -> Path:
    """The monorepo root — the first ancestor containing BOTH ``src/`` and
    ``analytics-service/``. Resolved by walking up from this file so the scan works
    from the ``analytics-service`` pytest cwd and in CI."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "src").is_dir() and (parent / "analytics-service").is_dir():
            return parent
    raise RuntimeError(
        "could not locate the repo root (an ancestor with both src/ and "
        "analytics-service/)"
    )


def _strip_comment(line: str, *, lang: str) -> bool:
    """True when ``line`` is a pure comment for its language (grep-gate hygiene: a
    docstring/comment mentioning a token must neither trip nor satisfy the gate)."""
    stripped = line.lstrip()
    if lang == "py":
        return stripped.startswith("#")
    return stripped.startswith("//") or stripped.startswith("*")


# Phase 105 (BB-02, collapse #2) DELETED the Phase-104 SC-2 boundary guard
# (test_analytics_runner_series_only_boundary) that asserted analytics_runner.py had
# ZERO references to derive_basis_series / basis_series. That guard existed ONLY to hold
# the SERIES-ONLY line until this plan — its own docstring named "a premature Phase-105
# cash-scalar reroute landing in analytics_runner.py" as the mutation it kills. Plan
# 105-04 IS that reroute (the single-key cash SCALAR now routes through the ONE shared
# derive), so the guard is retired here deliberately. The scalar's byte-identity is now
# proven positively by the three dual-run SC-4 fixtures below (test_user_csv_weekend,
# test_broker_guard_day, test_zavara_simple_active).


def test_no_reader_consumes_cash_settlement_series_row() -> None:
    """INERT read (SC-4 roadmap): the new cash_settlement series row has ZERO
    consumers this phase. Scan src/**/*.ts{,x} (excluding *.test.*) plus
    analytics-service/{services,routers}/*.py (excluding the two write-seam files
    basis_series.py and job_worker.py) and assert NO non-comment line pairs the
    substring ``cash_settlement`` with (``kind`` OR ``strategy_analytics_series``).

    PHASE GUARD: Phase 105/106 lands the reader and DELETES this test deliberately.
    Kills: any reader wired to the dark cash series before the scalar route collapses
    (neuter-checked: adding `.eq("kind", "cash_settlement")` to a frontend reader
    reddens this scan)."""
    root = _repo_root()
    scanned: list[tuple[str, Path]] = []
    for ext in ("*.ts", "*.tsx"):
        for f in (root / "src").rglob(ext):
            if ".test." in f.name:
                continue
            scanned.append(("ts", f))
    for sub in ("services", "routers"):
        for f in sorted((root / "analytics-service" / sub).glob("*.py")):
            if f.name in ("basis_series.py", "job_worker.py"):
                continue
            scanned.append(("py", f))

    assert scanned, "the boundary scan found no files — path resolution is broken"

    offenders: list[str] = []
    for lang, f in scanned:
        for i, line in enumerate(f.read_text().splitlines(), 1):
            if _strip_comment(line, lang=lang):
                continue
            if "cash_settlement" in line and (
                "kind" in line or "strategy_analytics_series" in line
            ):
                offenders.append(f"{f}:{i}: {line.strip()}")

    assert not offenders, (
        "a reader now consumes the DARK cash_settlement series row (INERT-read "
        "boundary breached — if this is the Phase-105/106 reader landing, DELETE this "
        "guard deliberately):\n" + "\n".join(offenders)
    )


def test_single_cash_settlement_persist_seam() -> None:
    """A3 honest-absence: exactly ONE persist site writes basis="cash_settlement".
    A second bootleg persist (e.g. someone adding one to run_compute_analytics_job —
    the 106-slated dark-path re-entry point — or fabricating a fill for a legacy-tail
    strategy) would give some strategies a fabricated series this phase instead of an
    honest absence. Strip comment lines, then assert the literal appears once.

    Kills: any second basis="cash_settlement" persist added outside the single seam.

    Phase 105 (D3) adds heal-DELETE call(s) — persist_basis_series(..., result=None) —
    at the terminal-failure arms. A heal DELETES a stale row (it never FABRICATES a
    series), so it does not violate the A3 honest-absence guarantee. Count only the
    NON-heal (result-bearing) cash persists: exactly ONE must exist."""
    worker = _repo_root() / "analytics-service" / "services" / "job_worker.py"
    code = "\n".join(
        ln for ln in worker.read_text().splitlines()
        if not _strip_comment(ln, lang="py")
    )
    total = code.count('basis="cash_settlement"')
    heals = code.count('basis="cash_settlement", result=None')
    assert total - heals == 1, (
        f"expected exactly ONE result-bearing basis=\"cash_settlement\" persist seam, "
        f"found {total - heals} (total={total}, heals={heals}) — a second bootleg "
        "persist site would fabricate a series where this phase mandates an honest "
        "absence (A3); heal-deletes (result=None) are exempt"
    )
