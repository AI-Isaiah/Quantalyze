"""Phase 167.1.2.2.1 (DERIBITWEDGE) PR-1 — the inception numbers that decide the cap are STORED.

THE GAP. ``_assert_inception_reconciled`` judges a Deribit account's rolled pre-history residual
against a per-currency dust allowance, but the numbers behind that verdict (the residual, the
inception-day mark, the native throughput, the two day-0 capitals) were local variables of the
gate. A cap on the dust allowance (SC-2) and a balance-anchored wedge (SC-5) both need those
numbers measured on the real account first. This plan exposes them through the SAME rolled
buckets the gate judges and stores them in the key's ``key_inputs`` payload.

NOTHING A DERIVE COMPUTES CHANGES HERE, and no gate reads the new constant yet. Every assertion
below is either about what the diagnostic reports or about the gate staying exactly where it was.

THE ORACLES ARE RESTATED, NOT IMPORTED. The residual, the mark, the throughput and the breach
ratios are worked forward by hand from each fixture's own numbers; the $5 cap is a hand-typed
literal, so a module that quietly changed its constant (or the arithmetic) fails here.

Root-cause note: see the debug note named derivecron-compose-divergence.
"""
from __future__ import annotations

import math
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from services.allocator_equity_derive import (
    native_inception_diagnostics_payload,
    read_native_inception_diagnostics,
)
from services.broker_dailies import native_ledger_inception_diagnostics
from services.deribit_ingest import DeribitNativeAccountState
from services.external_flows import ExternalFlow
from services.nav_twr import NavReconstructionError
from services.native_nav import (
    INCEPTION_DUST_CAP_USD,
    InceptionReconciliationError,
    NativeLedger,
    native_inception_diagnostics,
    reconstruct_native_nav_and_twr,
)
from tests.test_native_nav import _dense, _s

_BTC = frozenset({"BTC"})


def _section_b_ledger(*, wedge: float = 0.0, terminal: float = 0.01) -> NativeLedger:
    """BTC rolled 1000 in, 1000 out, then a 2000 BTC withdrawal: 4000 BTC of throughput, so a
    0.01 BTC residual (= $300 at the 30000 mark) is far inside today's 1e-4 allowance (0.4 BTC)."""
    return NativeLedger(
        native_pnl={"BTC": _dense([1000.0, 1000.0, 0.0])},
        terminal_native_equity={"BTC": terminal},
        marks={"BTC": _dense([30000.0, 30000.0, 30000.0])},
        native_flows=[ExternalFlow("2026-01-03", -60_000_000.0, "BTC", -2000.0)],
        terminal_upnl_native={"BTC": wedge} if wedge else {},
        full_history=True,
    )


def _diag(ledger: NativeLedger, **kw: Any) -> dict[str, Any]:
    out = native_inception_diagnostics(
        ledger, indexable_currencies=_BTC, venue="deribit", **kw
    )
    assert out is not None
    return out


# ── the constant ─────────────────────────────────────────────────────────────────


def test_the_dust_cap_constant_is_pinned() -> None:
    """Hand-typed. Any value in about [2, 300) satisfies both measured data points (the pinned
    production dust of about $1.06 stays green, the measured offset breaches ~60x); 5 is the
    founder's pick. Changing it is a decision, so it must fail here first."""
    assert INCEPTION_DUST_CAP_USD == 5.0


# ── the oracle ───────────────────────────────────────────────────────────────────


def test_the_diagnostic_reports_the_hand_worked_numbers() -> None:
    d = _diag(_section_b_ledger())
    [row] = d["currencies"]
    assert row["currency"] == "BTC"
    # Σpnl 2000 and Σflow -2000 against a terminal of 0.01: the residual is the terminal.
    assert abs(row["resid_native_current"] - 0.01) < 1e-12
    assert row["mark0_usd"] == 30000.0
    assert row["throughput_native"] == 4000.0
    assert abs(row["dust_rel_current"] - 0.01 / 4000.0) < 1e-15
    # 0.01 <= 1e-4 * 4000 = 0.4: dust today. $300 once a $5 cap is ANDed in; tol is the $1 floor.
    assert d["breach_ratio_current"] == 0.0
    assert abs(d["breach_ratio_current_with_cap"] - 300.0) < 1e-6
    # day-0 capital: the 0.01 BTC pre-history balance at the 30000 mark.
    assert abs(d["prev0_usd_current"] - 300.0) < 1e-6
    # first NAV level: 1000.01 BTC at 30000 (the terminal 0.01 plus the two days rolled back).
    assert abs(d["first_nav_usd_current"] - 1000.01 * 30000.0) < 1e-3
    assert d["cap_usd"] == 5.0
    assert d["orphan_unvaluable"] is False
    # No balance given: every balance-anchored field is null, never a copy of the current one.
    assert row["resid_native_balance_anchor"] is None
    assert row["dust_rel_balance_anchor"] is None
    assert d["prev0_usd_balance_anchor"] is None
    assert d["breach_ratio_balance_anchor"] is None
    assert d["breach_ratio_balance_anchor_with_cap"] is None


def test_a_usd_family_bucket_is_valued_at_one() -> None:
    ledger = NativeLedger(
        native_pnl={"USDC": _s([("2026-01-01", 100.0)])},
        terminal_native_equity={"USDC": 100.5},
        marks={},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    d = _diag(ledger)
    [row] = d["currencies"]
    assert row["currency"] == "USD"
    assert abs(row["resid_native_current"] - 0.5) < 1e-12
    assert row["mark0_usd"] == 1.0
    assert row["throughput_native"] == 100.0
    # 0.5 > 1e-4 * 100: not dust, so $0.5 against a $1 tolerance, with or without a cap.
    assert abs(d["breach_ratio_current"] - 0.5) < 1e-12
    assert abs(d["breach_ratio_current_with_cap"] - 0.5) < 1e-12


def test_the_balance_anchored_residual_moves_by_the_wedge_difference() -> None:
    """Rolled from ``equity - wedge``, so swapping the wedge for ``equity - balance`` moves the
    pre-history residual by (current wedge - new wedge). Worked by hand: equity 0.01, current
    wedge 0.003 -> roll from 0.007; balance 0.006 -> wedge 0.004 -> roll from 0.006."""
    ledger = _section_b_ledger(wedge=0.003)
    d = _diag(ledger, alt_terminal_upnl_native={"BTC": 0.004})
    [row] = d["currencies"]
    assert abs(row["resid_native_current"] - 0.007) < 1e-12
    assert abs(row["resid_native_balance_anchor"] - 0.006) < 1e-12
    assert abs(row["resid_native_balance_anchor"] - (0.007 + (0.003 - 0.004))) < 1e-12
    assert abs(row["dust_rel_balance_anchor"] - 0.006 / 4000.0) < 1e-15
    assert abs(d["prev0_usd_balance_anchor"] - 0.006 * 30000.0) < 1e-6
    # Dust today under either anchor; with the cap each is the residual in USD (tol = $1 floor).
    assert d["breach_ratio_current"] == 0.0
    assert d["breach_ratio_balance_anchor"] == 0.0
    assert abs(d["breach_ratio_current_with_cap"] - 0.007 * 30000.0) < 1e-6
    assert abs(d["breach_ratio_balance_anchor_with_cap"] - 0.006 * 30000.0) < 1e-6


def test_a_currency_the_balance_does_not_cover_keeps_its_current_wedge() -> None:
    """The balance-anchored reading replaces the wedge only where a balance was read."""
    ledger = NativeLedger(
        native_pnl={
            "BTC": _dense([1000.0, 1000.0, 0.0]),
            "USDC": _s([("2026-01-01", 100.0)]),
        },
        terminal_native_equity={"BTC": 0.01, "USDC": 100.0},
        marks={"BTC": _dense([30000.0, 30000.0, 30000.0])},
        native_flows=[ExternalFlow("2026-01-03", -60_000_000.0, "BTC", -2000.0)],
        terminal_upnl_native={"USDC": 4.0},
        full_history=True,
    )
    d = _diag(ledger, alt_terminal_upnl_native={"BTC": 0.004})
    by_code = {r["currency"]: r for r in d["currencies"]}
    # USD rolled from 100 - 4 = 96 against Σpnl 100: residual -4, unchanged by the BTC-only alt.
    assert abs(by_code["USD"]["resid_native_current"] - (-4.0)) < 1e-12
    assert abs(by_code["USD"]["resid_native_balance_anchor"] - (-4.0)) < 1e-12
    assert abs(by_code["BTC"]["resid_native_balance_anchor"] - 0.006) < 1e-12


# ── the gate reads the cap; the diagnostic's "current" ratio does not ────────────


def test_the_gate_reads_the_cap_and_breach_ratio_current_stays_without_it() -> None:
    """167.1.2.2.1 plan 06 (SC-2): the $300 residual now breaches the gate, because the gate
    ANDs the absolute cap into ``is_dust``. ``breach_ratio_current`` keeps its meaning of
    "today's rule WITHOUT the cap" (still absorbed as dust, so 0), while
    ``breach_ratio_current_with_cap`` carries the breach. That split is what lets readings taken
    before and after the gate change compare like for like."""
    ledger = _section_b_ledger()
    with pytest.raises(InceptionReconciliationError) as exc:
        reconstruct_native_nav_and_twr(ledger, indexable_currencies=_BTC, venue="deribit")
    assert exc.value.currencies == ["BTC"]
    d = _diag(ledger)
    assert d["breach_ratio_current"] == 0.0
    assert d["breach_ratio_current_with_cap"] > 1.0
    assert abs(exc.value.breach_ratio - d["breach_ratio_current_with_cap"]) < 1e-9


def test_a_ledger_the_gate_refuses_still_yields_a_diagnostic() -> None:
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([3.0, 3.479214])},
        terminal_native_equity={"BTC": 0.5},          # 0.5 BTC residual: material
        marks={"BTC": _dense([88000.0, 88000.0])},
        native_flows=[ExternalFlow("2026-01-02", -570000.0, "BTC", -6.479202)],
        terminal_upnl_native={},
        full_history=True,
    )
    with pytest.raises(InceptionReconciliationError):
        reconstruct_native_nav_and_twr(ledger, indexable_currencies=_BTC, venue="deribit")
    d = _diag(ledger)
    # Residual = terminal 0.5 less Σpnl 6.479214 plus the 6.479202 withdrawn = 0.499988 BTC, so
    # $43998.944 at the 88000 mark, against max($1, 1e-4 * the $44000 anchor NAV) = $4.4.
    assert d["breach_ratio_current"] > 1.0
    assert abs(d["breach_ratio_current"] - (0.499988 * 88000.0) / 4.4) < 1e-3
    assert d["breach_ratio_current_with_cap"] == d["breach_ratio_current"]


def test_an_unvaluable_orphan_is_reported_not_raised() -> None:
    """A held balance with no explaining ledger and no mark to value it: the gate raises with an
    infinite ratio. JSON cannot hold inf, so the diagnostic says so with null ratios and a flag."""
    ledger = NativeLedger(
        native_pnl={},
        terminal_native_equity={"BTC": 0.5},
        marks={"BTC": _dense([])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    with pytest.raises(InceptionReconciliationError):
        reconstruct_native_nav_and_twr(ledger, indexable_currencies=_BTC, venue="deribit")
    d = _diag(ledger)
    assert d["orphan_unvaluable"] is True
    assert d["breach_ratio_current"] is None
    assert d["breach_ratio_current_with_cap"] is None
    json_safe = native_inception_diagnostics_payload(d)
    assert read_native_inception_diagnostics(json_safe) == json_safe["native_inception_diagnostics"]


def test_a_truncated_ledger_has_no_diagnostic() -> None:
    ledger = NativeLedger(
        native_pnl={"BTC": _dense([1.0, 1.0])},
        terminal_native_equity={"BTC": 5.0},
        marks={"BTC": _dense([40000.0, 40000.0])},
        native_flows=[],
        terminal_upnl_native={},
        full_history=False,
    )
    assert (
        native_inception_diagnostics(ledger, indexable_currencies=_BTC, venue="deribit") is None
    )
    assert native_ledger_inception_diagnostics(ledger, _BTC) is None


def test_the_wrapper_reads_the_deribit_venue() -> None:
    d = native_ledger_inception_diagnostics(
        _section_b_ledger(), _BTC, alt_terminal_upnl_native={"BTC": 0.004}
    )
    assert d is not None and d["currencies"][0]["resid_native_balance_anchor"] is not None


# ── the stored shape ─────────────────────────────────────────────────────────────


def test_the_payload_round_trips_through_the_strict_reader() -> None:
    d = _diag(_section_b_ledger(wedge=0.003), alt_terminal_upnl_native={"BTC": 0.004})
    payload = native_inception_diagnostics_payload(d)
    assert set(payload) == {"native_inception_diagnostics"}
    assert read_native_inception_diagnostics(payload) == payload["native_inception_diagnostics"]


def test_an_old_row_reads_as_none() -> None:
    assert read_native_inception_diagnostics({}) is None
    assert read_native_inception_diagnostics({"native_inception_diagnostics": None}) is None
    assert (
        read_native_inception_diagnostics({"native_inception_diagnostics_error": "ValueError"})
        is None
    )


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_the_writer_refuses_a_non_finite_value(bad: float) -> None:
    d = _diag(_section_b_ledger())
    d["currencies"][0]["mark0_usd"] = bad
    with pytest.raises(NavReconstructionError):
        native_inception_diagnostics_payload(d)
    d2 = _diag(_section_b_ledger())
    d2["breach_ratio_current"] = bad
    with pytest.raises(NavReconstructionError):
        native_inception_diagnostics_payload(d2)


def _stored() -> dict[str, Any]:
    return native_inception_diagnostics_payload(_diag(_section_b_ledger()))


def _drop_key(p: dict[str, Any]) -> None:
    del p["native_inception_diagnostics"]["cap_usd"]


def _extra_key(p: dict[str, Any]) -> None:
    p["native_inception_diagnostics"]["surprise"] = 1


def _bool_as_number(p: dict[str, Any]) -> None:
    p["native_inception_diagnostics"]["breach_ratio_current"] = True


def _string_number(p: dict[str, Any]) -> None:
    p["native_inception_diagnostics"]["currencies"][0]["mark0_usd"] = "30000"


def _not_a_list(p: dict[str, Any]) -> None:
    p["native_inception_diagnostics"]["currencies"] = {}


def _flag_not_bool(p: dict[str, Any]) -> None:
    p["native_inception_diagnostics"]["orphan_unvaluable"] = 0


def _row_missing_field(p: dict[str, Any]) -> None:
    del p["native_inception_diagnostics"]["currencies"][0]["throughput_native"]


def _non_finite_stored(p: dict[str, Any]) -> None:
    p["native_inception_diagnostics"]["prev0_usd_current"] = float("nan")


@pytest.mark.parametrize(
    "mutate",
    [
        _drop_key, _extra_key, _bool_as_number, _string_number, _not_a_list,
        _flag_not_bool, _row_missing_field, _non_finite_stored,
    ],
)
def test_a_malformed_stored_record_raises(mutate: Any) -> None:
    payload = _stored()
    mutate(payload)
    with pytest.raises((TypeError, ValueError)):
        read_native_inception_diagnostics(payload)


# ── through the whole mocked key-mode derive ─────────────────────────────────────


def _state(*, equity: float = 1.0, balance: float | None = 0.9) -> DeribitNativeAccountState:
    return DeribitNativeAccountState(
        native_equity={"BTC": equity}, native_upnl={}, collapsed_equity_usd=100_000.0,
        collapsed_upnl_usd=0.0, balance_error=False, upnl_unreadable=False,
        native_options_value={},
        native_balance={} if balance is None else {"BTC": balance},
    )


async def _derive(
    state: Any, wrapper: Any, *, ledger: Any = None, trace: dict[str, Any] | None = None
) -> dict[str, Any]:
    from tests.test_deribit_account_summary_capture import _run_deribit_key_mode_derive

    with patch("services.broker_dailies.native_ledger_inception_diagnostics", new=wrapper):
        payload, _spy = await _run_deribit_key_mode_derive(state, ledger=ledger, trace=trace)
    return payload


@pytest.mark.asyncio
async def test_a_key_mode_derive_stores_the_inception_diagnostics() -> None:
    from tests.test_mtm_single_key import _stub_native_ledger

    real = _diag(_section_b_ledger(), alt_terminal_upnl_native={"BTC": 0.004})
    wrapper = MagicMock(return_value=real)
    given = _stub_native_ledger()
    trace: dict[str, Any] = {}
    payload = await _derive(_state(), wrapper, ledger=given, trace=trace)

    stored = read_native_inception_diagnostics(payload)
    assert stored == real
    assert "native_inception_diagnostics_error" not in payload
    # equity 1.0 - balance 0.9 is the balance-anchored wedge, handed to the wrapper per currency.
    [(args, kwargs)] = [(c.args, c.kwargs) for c in wrapper.call_args_list]
    alt = kwargs["alt_terminal_upnl_native"]
    assert set(alt) == {"BTC"} and abs(alt["BTC"] - 0.1) < 1e-12
    # LO-06: the diagnostic is run on the SAME ledger and indexable set the worker gave the
    # combine, not on some other ledger (a wiring defect the mocked wrapper used to hide).
    [combine_call] = trace["combine"].call_args_list
    assert len(args) == 2
    assert args[0] is given and args[0] is combine_call.args[0]
    assert args[1] == combine_call.args[1] == frozenset({"BTC"})


@pytest.mark.asyncio
async def test_the_real_diagnostic_runs_through_the_worker_and_round_trips() -> None:
    """LO-06: no MagicMock. The ledger the build returns carries marks, so the REAL
    ``native_ledger_inception_diagnostics`` runs inside ``job_worker`` and what it stores
    survives the strict reader. Hand-worked: the ledger rolls 2000 BTC of pnl against a
    2000 BTC withdrawal to a terminal of 0.01, so the residual under the ledger's own (empty)
    wedge is 0.01; equity 0.01 less balance 0.006 is a balance-anchored wedge of 0.004, which
    rolls from 0.006."""
    from tests.test_deribit_account_summary_capture import _run_deribit_key_mode_derive

    ledger = _section_b_ledger()
    state = _state(equity=0.01, balance=0.006)
    payload, _spy = await _run_deribit_key_mode_derive(state, ledger=ledger)

    assert "native_inception_diagnostics_error" not in payload
    stored = read_native_inception_diagnostics(payload)
    assert stored is not None
    [row] = stored["currencies"]
    assert row["currency"] == "BTC"
    assert abs(row["resid_native_current"] - 0.01) < 1e-12
    assert abs(row["resid_native_balance_anchor"] - 0.006) < 1e-12
    assert row["mark0_usd"] == 30000.0
    assert row["throughput_native"] == 4000.0
    assert stored["orphan_unvaluable"] is False


@pytest.mark.asyncio
async def test_no_balance_read_passes_no_balance_anchor() -> None:
    wrapper = MagicMock(return_value=_diag(_section_b_ledger()))
    await _derive(_state(balance=None), wrapper)
    assert wrapper.call_args.kwargs["alt_terminal_upnl_native"] is None


@pytest.mark.asyncio
async def test_a_diagnostic_failure_never_fails_the_derive_and_is_never_silent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    wrapper = MagicMock(side_effect=ZeroDivisionError("secret 123456 BTC"))
    with caplog.at_level("WARNING"):
        payload = await _derive(_state(), wrapper)
    assert "native_inception_diagnostics" not in payload
    assert payload["native_inception_diagnostics_error"] == "ZeroDivisionError"
    warnings = [r for r in caplog.records if "native_inception_diagnostics" in r.getMessage()]
    assert len(warnings) == 1
    # Class name and venue only: never the message, never a magnitude.
    assert "123456" not in warnings[0].getMessage()
    assert "deribit" in warnings[0].getMessage()


@pytest.mark.asyncio
async def test_a_poison_diagnostic_is_named_and_does_not_fail_the_derive() -> None:
    poison = _diag(_section_b_ledger())
    poison["breach_ratio_current"] = math.nan
    payload = await _derive(_state(), MagicMock(return_value=poison))
    assert "native_inception_diagnostics" not in payload
    assert payload["native_inception_diagnostics_error"] == "NavReconstructionError"


@pytest.mark.asyncio
async def test_a_truncated_ledger_stores_neither_field() -> None:
    payload = await _derive(_state(), MagicMock(return_value=None))
    assert "native_inception_diagnostics" not in payload
    assert "native_inception_diagnostics_error" not in payload
