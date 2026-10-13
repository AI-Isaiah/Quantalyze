"""164.6.6.2.3 plan 08 (D-13): the FLOWTIMING dry-run harness.

The harness (``scripts/flowtiming_dry_run.py``) turns a stored PROD before-state and a captured
MT5 ledger into a counts-only before/after report. These tests use SYNTHETIC fixtures only: the
MM-2x timed shape for MT5 and a three-day Deribit payload with one dropped flow day. Nothing here
opens a database, a socket or a terminal.

Each test names the intent it protects (a number that must be right, or a leak that must not
happen), so one that can no longer fail when that intent breaks is a wrong test.
"""
from __future__ import annotations

import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from scripts import flowtiming_dry_run as dr
from services.account_unit import USD_FLOORS, UnitFloors

_SCRIPT = Path(dr.__file__)

# ---------------------------------------------------------------------------
# Synthetic MT5 ledgers (the deal-row shape the terminal serves; see
# tests/test_mt5_deal_reconstruction.py for the same helpers' provenance).
# ---------------------------------------------------------------------------

_D0 = date(2025, 10, 16)  # the MM-2x first deposit day
_ZERO_COSTS = {"swap": 0.0, "commission": 0.0, "fee": 0.0}


def _utc_ms(d: date, hh: int = 0, mm: int = 0) -> int:
    whole = datetime(d.year, d.month, d.day, hh, mm, 0, tzinfo=timezone.utc)
    return int(whole.timestamp()) * 1000


def _stamped(row: dict, utc_ms: int, offset_s: int = 0) -> dict:
    server_ms = utc_ms + offset_s * 1000
    return {**row, "time": server_ms // 1000, "time_msc": server_ms}


def _flow(utc_ms: int, amount: float) -> dict:
    return _stamped({"type": 2, "profit": amount, **_ZERO_COSTS}, utc_ms)


def _position(position_id: int, open_ms: int, close_ms: int, pnl: float) -> list[dict]:
    opening = _stamped(
        {"type": 0, "entry": 0, "position_id": position_id, "profit": 0.0, **_ZERO_COSTS}, open_ms
    )
    closing = _stamped(
        {"type": 1, "entry": 1, "position_id": position_id, "profit": pnl, **_ZERO_COSTS}, close_ms
    )
    return [opening, closing]


def _mm2x_btc() -> tuple[list[dict], float]:
    """0.1 BTC deposited 08:00 on day 0, 1.0 BTC deposited 09:00 on day 1, one position opened
    10:00 and closed 15:00 on day 1 for +0.011 BTC. Returns (deals, terminal balance)."""
    d1 = _D0 + timedelta(1)
    deals = [_flow(_utc_ms(_D0, 8), 0.1), _flow(_utc_ms(d1, 9), 1.0)]
    deals += _position(1001, _utc_ms(d1, 10), _utc_ms(d1, 15), 0.011)
    return deals, 1.111


def _usd_dip_ledger() -> tuple[list[dict], float]:
    """USD: 1500 deposited day 0 (inception), a -1000 trade on day 1 (prior NAV 1500), a +10
    trade on day 2 (prior NAV 500). Only day 2 sits on a base between the old floor (1000) and the
    new one (100)."""
    deals = [_flow(_utc_ms(_D0, 8), 1500.0)]
    deals += _position(2001, _utc_ms(_D0 + timedelta(1), 9), _utc_ms(_D0 + timedelta(1), 12), -1000.0)
    deals += _position(2002, _utc_ms(_D0 + timedelta(2), 9), _utc_ms(_D0 + timedelta(2), 12), 10.0)
    return deals, 510.0


def _usd_big_ledger() -> tuple[list[dict], float]:
    """USD: every prior NAV is far above 1000, so the floor change flips nothing."""
    deals = [_flow(_utc_ms(_D0, 8), 5000.0)]
    deals += _position(3001, _utc_ms(_D0 + timedelta(1), 9), _utc_ms(_D0 + timedelta(1), 12), 50.0)
    deals += _position(3002, _utc_ms(_D0 + timedelta(2), 9), _utc_ms(_D0 + timedelta(2), 12), -20.0)
    return deals, 5030.0


def _day(offset: int) -> str:
    return (_D0 + timedelta(offset)).isoformat()


# ---------------------------------------------------------------------------
# mt5_after
# ---------------------------------------------------------------------------


def test_mt5_after_measures_the_deposit_day_on_the_capital_the_position_opened_on() -> None:
    """MM-2x: the 1.0 deposit day books 0.011 against 1.1 (0.01), not against 0.1 (0.11), day 0
    has no return and no warning. This is the number the founder is asked to accept."""
    deals, terminal = _mm2x_btc()
    out = dr.mt5_after(deals, terminal, terminal, "BTC", 0)
    assert out["returns"][_day(1)] == pytest.approx(0.01, abs=1e-12)
    assert _day(0) not in out["returns"]
    assert out["first_measured_day"] == _day(1)
    for guard in ("dust_nav_guard", "negative_nav_guard", "pnl_dominated_guard"):
        assert guard not in out["flags"]
    assert out["native_unit"] is True
    assert out["d27_applicable"] is False  # BTC: D-27 moves the USD row only
    assert out["measured_days"] == len(out["returns"])
    assert out["nan_days"] >= 1  # day 0 (inception) is a gap, not a zero


def test_mt5_after_default_floors_are_the_branch_usd_row() -> None:
    """floors=None resolves the unit's own row: for USD that is the branch ``USD_FLOORS``, where a
    500 base is measured."""
    deals, terminal = _usd_dip_ledger()
    out = dr.mt5_after(deals, terminal, terminal, "USD", 0)
    assert out["d27_applicable"] is True
    assert _day(2) in out["returns"]
    assert out["returns"][_day(2)] == pytest.approx(10.0 / 500.0, abs=1e-12)
    assert out["guard_events"].get("dust_nav_guard", 0) == 0


def test_mt5_after_explicit_pre_d27_floors_dust_guard_the_500_base() -> None:
    """The explicit override is what carries the old $1000 row. It must reach
    ``combine_mt5_deal_ledger`` (a patched USD_FLOORS would not), so the 500 base is dropped
    and named."""
    deals, terminal = _usd_dip_ledger()
    out = dr.mt5_after(deals, terminal, terminal, "USD", 0, floors=dr.PRE_D27_USD_FLOORS)
    assert _day(2) not in out["returns"]
    assert "dust_nav_guard" in out["flags"]
    assert out["guard_events"]["dust_nav_guard"] == 1


def test_pre_d27_row_is_the_historical_usd_row_only() -> None:
    assert dr.PRE_D27_USD_FLOORS == UnitFloors(
        dust_nav=1000.0, material_equity=100.0, residual_abs_tol=1.00
    )
    assert USD_FLOORS.dust_nav == 100.0  # the branch moved; the harness row did not


def test_btc_unit_ignores_a_usd_override() -> None:
    """A BTC account is judged on BTC thresholds. A USD override handed to it must not apply:
    the same returns come back and the key is reported as D-27 not applicable."""
    deals, terminal = _mm2x_btc()
    plain = dr.mt5_after(deals, terminal, terminal, "BTC", 0)
    forced = dr.mt5_after(deals, terminal, terminal, "BTC", 0, floors=dr.PRE_D27_USD_FLOORS)
    assert forced["returns"] == plain["returns"]
    assert forced["flags"] == plain["flags"]
    assert forced["d27_applicable"] is False
    assert forced["native_unit"] is True


# ---------------------------------------------------------------------------
# compare
# ---------------------------------------------------------------------------


def test_compare_reports_flags_removed_first_day_shift_and_new_days() -> None:
    before = {
        "flags": ["dust_nav_guard", "flow_dominated_guard", "csv_source"],
        "returns": {_day(2): 0.01, _day(3): 0.02, _day(5): -0.01},
    }
    after = {
        "flags": ["csv_source"],
        "returns": {_day(1): 0.011, _day(2): 0.01, _day(3): 0.025, _day(4): 0.0, _day(5): -0.01,
                    _day(6): 0.002},
    }
    out = dr.compare(before, after)
    assert out["flags_removed"] == ["dust_nav_guard", "flow_dominated_guard"]
    assert out["flags_added"] == []
    assert out["first_day_shift_days"] == -1  # the after series starts a day earlier
    assert out["newly_measured_days"] == 2  # day 1 and day 4, inside the stored span
    assert out["extended_days"] == 1  # day 6 lies past the last stored day
    assert out["lost_days"] == 0
    assert out["max_abs_change"] == pytest.approx(0.005, abs=1e-12)  # day 3 moved 0.02 -> 0.025
    assert out["moved_days"] == 1


def test_compare_flags_a_day_measured_before_and_dropped_after() -> None:
    before = {"flags": [], "returns": {_day(1): 0.01, _day(2): 0.02}}
    after = {"flags": ["negative_nav_guard"], "returns": {_day(1): 0.01}}
    out = dr.compare(before, after)
    assert out["lost_days"] == 1
    assert out["flags_added"] == ["negative_nav_guard"]


# ---------------------------------------------------------------------------
# Deribit sizing
# ---------------------------------------------------------------------------


def _deribit_payload(prior: float = 500.0, flow: float = 300.0, pnl: float = 50.0) -> dict:
    """Three NAV days. Day 0: 500 deposited (inception). Day 1: ``flow`` deposited and ``pnl``
    earned on a prior level of ``prior`` (the stored dropped flow day). Day 2: +10."""
    l0 = prior
    l1 = l0 + pnl + flow
    l2 = l1 + 10.0
    return {
        "composed_day_pnl": [
            {"utc_day_iso": _day(0), "pnl_usd": 0.0},
            {"utc_day_iso": _day(1), "pnl_usd": pnl},
            {"utc_day_iso": _day(2), "pnl_usd": 10.0},
        ],
        "composed_flows": [
            {"utc_day_iso": _day(0), "flow_usd": prior},
            {"utc_day_iso": _day(1), "flow_usd": flow},
        ],
        "realized_terminal_day": _day(2),
        "realized_terminal_usd": l2,
        "dropped_day_pnl": [{"utc_day_iso": _day(1), "pnl_usd": pnl}],
        "flows": [],
    }


def test_deribit_sizing_passes_the_dust_floor_explicitly() -> None:
    """``_guard_denominator``'s default floor binds when the function is DEFINED, so only an
    explicit argument can compare the two rows. A 500 prior level is dust at 1000 and a finite
    end-of-day return at 100."""
    payload = _deribit_payload()
    old = dr.deribit_sizing(payload, dust_floor=1000.0)
    new = dr.deribit_sizing(payload, dust_floor=100.0)
    assert old["ok"] and new["ok"]
    assert old["verdict"][_day(1)]["guard"] == "dust_nav_guard"
    assert old["verdict"][_day(1)]["r"] is None
    assert new["verdict"][_day(1)]["guard"] is None
    assert new["verdict"][_day(1)]["r"] == pytest.approx(50.0 / 500.0, abs=1e-12)


def test_deribit_sizing_counts_the_dropped_flow_day_and_its_remaining_guard() -> None:
    payload = _deribit_payload()
    new = dr.deribit_sizing(payload, dust_floor=100.0)
    assert new["dropped_flow_days"] == 1
    assert new["newly_measured"] == 1
    assert new["still_dropped"] == {}
    assert new["max_abs_new_return"] == pytest.approx(0.1, abs=1e-12)
    assert (new["new_ge_10pct"], new["new_ge_100pct"]) == (1, 0)  # 0.1 is at the 10% edge
    old = dr.deribit_sizing(payload, dust_floor=1000.0)
    assert old["newly_measured"] == 0
    assert old["still_dropped"] == {"dust_nav_guard": 1}


def test_deribit_sizing_counts_inflated_new_returns_by_size() -> None:
    """The founder acknowledges the size of the end-of-day convention: a flow day on a small prior
    level can book a return of several hundred percent. They are counted by size."""
    payload = _deribit_payload(prior=500.0, flow=300.0, pnl=2600.0)  # +520%, under the 10x guard
    out = dr.deribit_sizing(payload, dust_floor=100.0)
    assert out["newly_measured"] == 1
    assert out["max_abs_new_return"] == pytest.approx(5.2, abs=1e-12)
    assert (out["new_ge_10pct"], out["new_ge_100pct"]) == (1, 1)


def test_deribit_sizing_keeps_a_pnl_dominated_flow_day_dropped() -> None:
    """D-05 deletes the flow guard, not the P&L-dominance one: a +10x day on a small prior
    level stays dropped and is named."""
    payload = _deribit_payload(prior=500.0, flow=300.0, pnl=6000.0)
    out = dr.deribit_sizing(payload, dust_floor=100.0)
    assert out["verdict"][_day(1)]["guard"] == "pnl_dominated_guard"
    assert out["still_dropped"] == {"pnl_dominated_guard": 1}
    assert out["newly_measured"] == 0


def test_deribit_sizing_keeps_a_negative_prior_dropped() -> None:
    payload = _deribit_payload(prior=500.0, flow=300.0, pnl=50.0)
    # Roll the same days over a deposit-less negative start: day 0 pnl -900 on a 500 flow.
    payload["composed_day_pnl"][0]["pnl_usd"] = -900.0
    l1 = -400.0 + 50.0 + 300.0
    payload["realized_terminal_usd"] = l1 + 10.0
    out = dr.deribit_sizing(payload, dust_floor=100.0)
    assert out["verdict"][_day(1)]["guard"] == "negative_nav_guard"
    assert out["still_dropped"] == {"negative_nav_guard": 1}


def test_deribit_sizing_day_zero_is_the_inception_and_not_a_dropped_flow_day() -> None:
    payload = _deribit_payload()
    payload["dropped_day_pnl"].append({"utc_day_iso": _day(0), "pnl_usd": 0.0})
    out = dr.deribit_sizing(payload, dust_floor=100.0)
    assert out["inception_days"] == 1
    assert out["dropped_flow_days"] == 1  # day 0 is not counted as a newly measurable flow day
    assert out["verdict"][_day(0)]["guard"] is None
    assert out["verdict"][_day(0)]["r"] is None


def test_deribit_sizing_without_the_writer_basis_is_not_sized() -> None:
    out = dr.deribit_sizing({"flows": [], "dropped_day_pnl": []}, dust_floor=100.0)
    assert out["ok"] is False
    assert out["reason"] == "no_writer_basis"


def test_deribit_sizing_rolls_back_from_the_stored_terminal() -> None:
    """The levels are the stored terminal rolled back through P&L and flows: the end-of-day
    return of every measured day equals pnl / prior level."""
    payload = _deribit_payload(prior=1200.0, flow=300.0, pnl=60.0)
    out = dr.deribit_sizing(payload, dust_floor=100.0)
    assert out["verdict"][_day(1)]["r"] == pytest.approx(60.0 / 1200.0, abs=1e-12)
    assert out["verdict"][_day(2)]["r"] == pytest.approx(10.0 / (1200.0 + 60.0 + 300.0), abs=1e-12)


def test_analyze_groups_keys_that_carry_one_series() -> None:
    """Several logins on one account store the same series. The report says how many distinct
    series sit behind the sized keys, so a repeated count is not read as independent evidence."""
    base = {"venue": "deribit", "unit": "USD", "native": False, "balance_usdt": None, "active": True,
            "disconnected": False, "key_returns": {}, "anchor_null_reason": None,
            "anchor_usd_null": False, "composite_member": False}
    same = _deribit_payload(prior=1200.0)
    other = _deribit_payload(prior=900.0)
    before = {"run_date": "2026-10-12", "strategies": [], "keys": [
        {**base, "id": "a", "payload": same}, {**base, "id": "b", "payload": same},
        {**base, "id": "c", "payload": other},
    ]}
    analysis = dr.analyze(before, {"offset_s": 0, "keys": {}})
    assert len({r["series_sig"] for r in analysis["deribit"]}) == 2
    text = dr.render_report(analysis, marker_verdict="PRODUCTION")
    assert "2 distinct series" in text
    # The D-27 flips are counted once per distinct series too (3 keys, 2 series).
    assert analysis["d27_deribit_distinct"]["keys"] == 2
    assert analysis["d27"]["Deribit"]["keys"] == 3
    # Each distinct series once: 1 + 1 newly measured, not the 3 keys' sum.
    assert "Counting each distinct series once: 2 stored dropped flow days; 2 now carry" in text


def test_deribit_crosscheck_counts_agreement_with_the_stored_series() -> None:
    payload = _deribit_payload(prior=1200.0, flow=300.0, pnl=60.0)
    out = dr.deribit_sizing(payload, dust_floor=100.0)
    stored = {_day(1): 60.0 / 1200.0, _day(2): 0.5}  # day 2 disagrees on purpose
    check = dr.deribit_crosscheck(out, stored)
    assert check == {"both_measured": 2, "agree": 1, "disagree": 1}


# ---------------------------------------------------------------------------
# D-27 comparison
# ---------------------------------------------------------------------------


def test_d27_compare_mt5_flips_exactly_the_500_base_day() -> None:
    deals, terminal = _usd_dip_ledger()
    old = dr.mt5_after(deals, terminal, terminal, "USD", 0, floors=dr.PRE_D27_USD_FLOORS)
    new = dr.mt5_after(deals, terminal, terminal, "USD", 0)
    out = dr.d27_compare({"MT5": {"mt5-key-1": old}}, {"MT5": {"mt5-key-1": new}})
    assert out["MT5"]["to_measured"] == 1
    assert out["MT5"]["to_dust_guarded"] == 0
    assert out["MT5"]["max_abs_change"] == pytest.approx(10.0 / 500.0, abs=1e-12)


def test_d27_compare_mt5_flips_nothing_when_every_base_is_above_1000() -> None:
    deals, terminal = _usd_big_ledger()
    old = dr.mt5_after(deals, terminal, terminal, "USD", 0, floors=dr.PRE_D27_USD_FLOORS)
    new = dr.mt5_after(deals, terminal, terminal, "USD", 0)
    out = dr.d27_compare({"MT5": {"mt5-key-1": old}}, {"MT5": {"mt5-key-1": new}})
    assert out["MT5"]["to_measured"] == 0
    assert out["MT5"]["to_dust_guarded"] == 0
    assert out["MT5"]["max_abs_change"] == 0.0


def test_d27_compare_deribit_and_the_reverse_direction() -> None:
    payload = _deribit_payload()
    old = dr.deribit_sizing(payload, dust_floor=1000.0)
    new = dr.deribit_sizing(payload, dust_floor=100.0)
    out = dr.d27_compare({"Deribit": {"deribit-key-1": old}}, {"Deribit": {"deribit-key-1": new}})
    assert out["Deribit"]["to_measured"] == 2  # day 1 (prior 500) and day 2 (prior 850)
    assert out["Deribit"]["to_dust_guarded"] == 0
    reverse = dr.d27_compare(
        {"Deribit": {"deribit-key-1": new}}, {"Deribit": {"deribit-key-1": old}}
    )
    assert reverse["Deribit"]["to_dust_guarded"] == 2
    assert reverse["Deribit"]["to_measured"] == 0


def test_d27_compare_reports_a_venue_with_nothing_to_compare() -> None:
    out = dr.d27_compare({"MT5": {}}, {"MT5": {}})
    assert out["MT5"] == {
        "keys": 0, "to_measured": 0, "to_dust_guarded": 0, "max_abs_change": 0.0,
    }


# ---------------------------------------------------------------------------
# Gate channels
# ---------------------------------------------------------------------------


def _key(venue: str, x: float | None, *, unit: str = "USD", native: bool = False) -> dict:
    return {"venue": venue, "unit": unit, "native": native, "gate_input": x}


@pytest.mark.parametrize(
    ("x", "flips"),
    [(100.0, False), (500.0, True), (1000.0, True), (1001.0, False)],
)
def test_epilogue_anchor_null_operator_edges(x: float, flips: bool) -> None:
    """``abs(x) <= floor``: 100 is dust at both floors (no flip), 1000 is dust only at the old
    one (flip), 1001 is never dust."""
    out = dr.gate_channel_flips([_key("mt5", x)])
    row = out["channels"]["epilogue_anchor_null"]["MT5"]
    assert (row["flips"] == 1) is flips


@pytest.mark.parametrize(
    ("channel", "venue"),
    [
        ("deribit_wedge", "deribit"),
        ("mt5_wedge", "mt5"),
        ("ccxt_wedge", "okx"),
        ("nav_twr_wedge", "mt5"),
    ],
)
@pytest.mark.parametrize(
    ("x", "flips"),
    [(100.0, False), (500.0, True), (1000.0, True), (1001.0, False)],
)
def test_wedge_gate_operator_edges(channel: str, venue: str, x: float, flips: bool) -> None:
    """``x > floor``: 100 is not above 100 at the new floor (no flip), 1000 is not above 1000 at
    the old one but is above 100 (flip), 1001 is above both."""
    out = dr.gate_channel_flips([_key(venue, x)])
    group = {"deribit": "Deribit", "mt5": "MT5"}.get(venue, "other")
    assert (out["channels"][channel][group]["flips"] == 1) is flips


@pytest.mark.parametrize(
    ("x", "flips"),
    [(100.0, False), (500.0, True), (1000.0, True), (1001.0, False)],
)
def test_stitched_ccxt_member_operator_edges(x: float, flips: bool) -> None:
    out = dr.gate_channel_flips([_key("bybit", x)])
    assert (out["channels"]["stitched_ccxt_member"]["other"]["flips"] == 1) is flips


def test_gate_channels_apply_only_to_their_venues() -> None:
    out = dr.gate_channel_flips([_key("deribit", 500.0)])
    assert out["channels"]["deribit_wedge"]["Deribit"]["flips"] == 1
    assert out["channels"]["mt5_wedge"]["MT5"]["keys"] == 0
    assert out["channels"]["ccxt_wedge"]["other"]["keys"] == 0
    assert out["channels"]["stitched_ccxt_member"]["other"]["keys"] == 0


def test_gate_channels_count_keys_with_no_stored_input_as_not_sized() -> None:
    out = dr.gate_channel_flips([_key("mt5", None), _key("mt5", 500.0)])
    row = out["channels"]["mt5_wedge"]["MT5"]
    assert row["not_sized"] == 1
    assert row["keys"] == 2
    assert row["flips"] == 1


def test_gate_channels_skip_native_unit_keys() -> None:
    """A BTC key reads the BTC row, which D-27 did not move: it is counted, not evaluated."""
    out = dr.gate_channel_flips([_key("mt5", 0.5, unit="BTC", native=True)])
    row = out["channels"]["mt5_wedge"]["MT5"]
    assert row["native_na"] == 1
    assert row["flips"] == 0


def test_ccxt_heuristic_anchor_candidates_are_the_balances_in_100_to_1000() -> None:
    keys = [
        _key("okx", 100.0), _key("okx", 100.01), _key("bybit", 1000.0),
        _key("binance", 1000.01), _key("okx", None), _key("mt5", 500.0), _key("deribit", 500.0),
    ]
    out = dr.gate_channel_flips(keys)
    assert out["ccxt_heuristic_candidates"] == 2  # (100, 1000] among ccxt venues only
    assert out["ccxt_unsized"] == 1


def test_gate_summary_states_when_no_key_sits_in_the_interval() -> None:
    out = dr.gate_channel_flips([_key("mt5", 5000.0), _key("deribit", 50.0), _key("okx", None)])
    assert out["keys_in_interval"] == 0
    assert out["keys_without_input"] == 1


# ---------------------------------------------------------------------------
# Report and redaction
# ---------------------------------------------------------------------------

_UUID = "0f8fad5b-d9cb-469f-a165-70867728950e"
_EMAIL = "someone@example.com"
_LOGIN = "123456789"
# Built by concatenation so this file never spells the macOS home prefix itself (the planning
# hygiene gate, rule ABSOLUTE-HOME-PATH, is structural and reads test sources too).
_HOME_PREFIX = "/" + "Users" + "/"


def _tiny_analysis() -> dict:
    deals, terminal = _mm2x_btc()
    captured = {
        "offset_s": 0,
        "keys": {
            _UUID: {
                "status": "captured", "deals": deals, "equity": terminal, "balance": terminal,
                "currency": "BTC",
            },
            "k-2": {"status": "not_captured", "error_class": "Mt5AccountMismatchError"},
        },
    }
    before = {
        "run_date": "2026-10-12",
        # Labels that look like identifiers must never reach the report.
        "strategies": [
            {"id": "s-1", "label": _EMAIL, "key_id": _UUID, "venue": "mt5", "unit": "BTC",
             "status": "complete_with_warnings",
             "flags": {"csv_source": True, "dust_nav_guard": True, "flow_dominated_guard": True},
             "returns": {_day(3): 0.001, _day(4): 0.002}},
            {"id": "s-2", "label": _LOGIN, "key_id": "k-2", "venue": "mt5", "unit": "USD",
             "status": "complete_with_warnings",
             "flags": {"csv_source": True, "negative_nav_guard": True},
             "returns": {_day(3): 0.001}},
        ],
        "keys": [
            {"id": _UUID, "label": _EMAIL, "venue": "mt5", "unit": "BTC", "native": True,
             "balance_usdt": None, "active": True, "disconnected": False, "key_returns": {},
             "payload": {"flows": [{"utc_day_iso": _day(0), "usd_signed": 1.0}]},
             "anchor_null_reason": None, "anchor_usd_null": False, "composite_member": False},
            {"id": "k-2", "label": _LOGIN, "venue": "mt5", "unit": "USD", "native": False,
             "balance_usdt": 500.0, "active": True, "disconnected": False, "key_returns": {},
             "payload": {"flows": []}, "anchor_null_reason": "dust", "anchor_usd_null": True,
             "composite_member": False},
            {"id": "k-3", "label": _UUID, "venue": "deribit", "unit": "USD", "native": False,
             "balance_usdt": None, "active": True, "disconnected": False, "key_returns": {},
             "payload": _deribit_payload(), "anchor_null_reason": None, "anchor_usd_null": False,
             "composite_member": False},
        ],
    }
    return dr.analyze(before, captured)


def test_render_report_keeps_no_identifier_shaped_text() -> None:
    """The report carries ordinals, counts and returns. Identifiers, an email and a 9-digit login
    that sit in the inputs never survive into it."""
    text = dr.render_report(_tiny_analysis(), marker_verdict="PRODUCTION")
    assert _UUID not in text
    assert _EMAIL not in text
    assert _LOGIN not in text
    assert "mt5-strategy-1" in text and "mt5-strategy-2" in text
    assert not re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", text)
    assert not re.search(r"@[A-Za-z0-9.-]+\.[a-z]{2,}", text)
    assert not re.search(r"\b\d{9,}\b", text)
    assert _HOME_PREFIX not in text


def test_render_report_scrubs_an_identifier_that_reaches_a_free_text_field() -> None:
    """Belt for the ordinals: free text (an error class) that carries a uuid, an email or a long
    digit run is scrubbed before it is rendered."""
    analysis = _tiny_analysis()
    analysis["notes"] = [f"error {_UUID} {_EMAIL} {_LOGIN} {_HOME_PREFIX}someone/x"]
    text = dr.render_report(analysis, marker_verdict="PRODUCTION")
    for leak in (_UUID, _EMAIL, _LOGIN, _HOME_PREFIX):
        assert leak not in text


def test_render_report_records_the_marker_and_states_not_captured_keys() -> None:
    text = dr.render_report(_tiny_analysis(), marker_verdict="PRODUCTION")
    assert "PRODUCTION" in text
    assert "not captured: Mt5AccountMismatchError" in text
    assert "167.1.2 D-27" in text
    assert "Deribit" in text


def test_render_report_has_the_flagged_row_verdicts() -> None:
    text = dr.render_report(_tiny_analysis(), marker_verdict="PRODUCTION")
    assert re.search(r"mt5-strategy-1 .*confirmed (day-0|flow-only)", text)
    assert re.search(r"mt5-strategy-2 .*not captured", text)


def test_gate_input_falls_back_from_captured_to_balance_to_anchor() -> None:
    """The measured gate input is the captured equity, else the stored balance, else the stored
    anchor, else the stored terminal, else nothing. Each key reads the first it has, and the report names the source."""
    base = {"label": "x", "venue": "okx", "unit": "USD", "native": False, "active": True,
            "disconnected": False, "key_returns": {}, "payload": {"flows": []},
            "anchor_null_reason": None, "anchor_usd_null": False, "composite_member": False}
    before = {"run_date": "2026-10-12", "strategies": [], "keys": [
        {**base, "id": "a", "balance_usdt": 500.0, "anchor_usd": 5000.0},
        {**base, "id": "b", "balance_usdt": None, "anchor_usd": 500.0},
        {**base, "id": "c", "balance_usdt": None, "anchor_usd": None},
        {**base, "id": "d", "balance_usdt": None, "anchor_usd": None, "terminal_usd": 800.0},
    ]}
    analysis = dr.analyze(before, {"offset_s": 0, "keys": {}})
    assert analysis["gate_sources"] == {
        "stored balance": 1, "stored anchor": 1, "stored terminal": 1, "none": 1,
    }
    row = analysis["gates"]["channels"]["ccxt_wedge"]["other"]
    assert (row["keys"], row["flips"], row["not_sized"]) == (4, 3, 1)  # the 500, 500 and 800 flip
    assert analysis["gates"]["ccxt_heuristic_candidates"] == 3


def test_a_row_that_was_not_captured_still_reports_its_stored_interior_gap() -> None:
    """The interior gap is the stored series' own missing days, so it is known without a ledger."""
    before = {"run_date": "2026-10-12", "keys": [], "strategies": [
        {"id": "s", "key_id": "k", "venue": "mt5", "unit": "USD", "status": "x",
         "flags": {"flow_dominated_guard": True},
         "returns": {_day(1): 0.01, _day(4): 0.02}},  # days 2 and 3 are missing
    ]}
    analysis = dr.analyze(before, {"offset_s": 0, "keys": {}})
    verdict = analysis["mt5_rows"][0]["verdict"]
    assert verdict["verdict"] == "not captured"
    assert verdict["interior"] == 2
    assert verdict["leading"] is None


def test_flags_added_by_later_stages_are_not_reported_as_disappearing() -> None:
    """``csv_source`` and friends are stamped after the engine runs; a recomputation that does not
    run those stages must not be read as having cleared them."""
    deals, terminal = _mm2x_btc()
    before = {"run_date": "2026-10-12", "keys": [
        {"id": "k", "venue": "mt5", "unit": "BTC", "native": True, "active": True,
         "disconnected": False, "key_returns": {}, "payload": {"flows": []}, "balance_usdt": None},
    ], "strategies": [
        {"id": "s", "key_id": "k", "venue": "mt5", "unit": "BTC", "status": "x",
         "flags": {"csv_source": True, "native_unit": True, "dust_nav_guard": True,
                   "flow_dominated_guard": True},
         "returns": {_day(3): 0.001}},
    ]}
    captured = {"offset_s": 0, "keys": {"k": {"status": "captured", "deals": deals,
                                              "equity": terminal, "balance": terminal,
                                              "currency": "BTC"}}}
    row = dr.analyze(before, captured)["mt5_rows"][0]
    assert row["compare"]["flags_removed"] == ["dust_nav_guard", "flow_dominated_guard"]


def test_render_report_carries_no_amount_text() -> None:
    """A balance is reported only as a count inside an interval, never as a value."""
    text = dr.render_report(_tiny_analysis(), marker_verdict="PRODUCTION")
    assert "500.0" not in text
    assert "1.111" not in text


# ---------------------------------------------------------------------------
# Module hygiene and the command line
# ---------------------------------------------------------------------------


def test_harness_imports_no_database_or_http_client() -> None:
    src = _SCRIPT.read_text(encoding="utf-8")
    assert not re.search(r"import supabase|from supabase|import httpx|import requests", src)
    assert not re.search(r"import socket|from socket|import urllib|import aiohttp", src)


def test_harness_defines_the_report_entry_points() -> None:
    src = _SCRIPT.read_text(encoding="utf-8")
    assert "def render_report" in src
    assert "def d27_compare" in src
    assert "def gate_channel_flips" in src


def test_main_reads_two_json_files_and_writes_only_the_named_out(tmp_path: Path) -> None:
    deals, terminal = _mm2x_btc()
    before = {"run_date": "2026-10-12", "strategies": [], "keys": []}
    captured = {"offset_s": 0, "keys": {}}
    b, c, o = tmp_path / "b.json", tmp_path / "c.json", tmp_path / "report.md"
    b.write_text(json.dumps(before), encoding="utf-8")
    c.write_text(json.dumps(captured), encoding="utf-8")
    rc = dr.main(
        ["--before", str(b), "--captured", str(c), "--marker-verdict", "PRODUCTION",
         "--out", str(o)]
    )
    assert rc == 0
    assert "PRODUCTION" in o.read_text(encoding="utf-8")
    assert sorted(p.name for p in tmp_path.iterdir()) == ["b.json", "c.json", "report.md"]
    assert math.isfinite(terminal) and deals  # the synthetic ledger fixture is non-empty


def test_main_prints_to_stdout_without_out(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    b, c = tmp_path / "b.json", tmp_path / "c.json"
    b.write_text(json.dumps({"run_date": "2026-10-12", "strategies": [], "keys": []}), encoding="utf-8")
    c.write_text(json.dumps({"offset_s": 0, "keys": {}}), encoding="utf-8")
    assert dr.main(["--before", str(b), "--captured", str(c), "--marker-verdict", "PRODUCTION"]) == 0
    assert "PRODUCTION" in capsys.readouterr().out
    assert sorted(p.name for p in tmp_path.iterdir()) == ["b.json", "c.json"]
