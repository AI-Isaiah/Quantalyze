"""The compare engine beyond the tracer: window picker, Gate A, identity and explainers.

Why these tests exist: the harness is only worth running if it can say NO, and say it
for a NAMED reason. Gate A judges the days before the first stored mark on a realized
basis against the Report's deal ledger, so every leg here is shown GREEN on the
synthetic account and shown RED when exactly one input is moved. The picker refuses
every window it cannot honestly judge, by name. A breach is classified only by an
explainer that re-ran the comparison under its counterfactual and saw it clear, and an
explained breach is still RED: the harness never corrects a clock and passes.

Every variant is an in-memory copy of the parsed deals or of the loaded capture;
nothing touches a network, a database or the gateway.
"""
from __future__ import annotations

import calendar
import copy
import dataclasses
import json
import math
from collections.abc import Mapping
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest

import services.mt5_parity as engine
from services.broker_dailies import mt5_day_pnl
from services.mt5_deals import deal_utc_day
from services.mt5_parity import (
    ANNUALIZATION_CONVENTION,
    BUCKET_LABELS,
    CLOCK_MISMATCH,
    EDGE_INSTANT_MISMATCH,
    EXPLAINERS,
    FLOW_PLACEMENT,
    MT5_INCEPTION_IDENTITY_BAND,
    MT5_PARITY_TOLERANCE,
    PRE_MARK_REALIZED_BASIS,
    UNEXPLAINED,
    WINDOW_REFUSAL_REASONS,
    WITHHELD_BY_GATE,
    WITHIN_TOLERANCE,
    AccountVerdict,
    ExplainerContext,
    LegResult,
    Verdict,
    Window,
    WindowRefused,
    classify_breach,
    evaluate_account,
    gate_a_legs,
    identity_leg,
    leg_passes,
    oracle_identity_ratio,
    our_identity_ratio,
    propose_windows,
    render_verdict_markdown,
    validate_window,
    verdict_to_json,
)
from services.mt5_parity_capture import (
    Capture,
    load_bundle,
    load_capture,
    our_key_inputs,
    seal_capture,
)
from services.mt5_parity_intake import Worksheet, load_worksheet
from services.mt5_parity_report import parse_report
from services.mt5_server_clock import server_clock_for_rule

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "mt5_parity"
US = server_clock_for_rule("us")
EU = server_clock_for_rule("eu")
RUN_DAY = date(2026, 11, 16)
GATE_A = Window(gate="A", start=date(2026, 10, 5), end=date(2026, 10, 30))
GATE_B = Window(gate="B", start=date(2026, 11, 6), end=date(2026, 11, 13))
LEG_ORDER = ["start_level", "end_level", "cum_return", "inception_identity", "day_placement"]

Deals = tuple[Mapping[str, Any], ...]


# ------------------------------------------------------------------------ helpers


def _deals() -> Deals:
    return parse_report((FIXTURES / "report_synthetic.utf16le.html").read_bytes()).deals


def _worksheet(mutate: Any = None, *, tmp_path: Path | None = None) -> Worksheet:
    path = FIXTURES / "worksheet_synthetic.json"
    if mutate is None:
        return load_worksheet(path)
    assert tmp_path is not None
    data = json.loads(path.read_text(encoding="utf-8"))
    mutate(data)
    out = tmp_path / "worksheet.json"
    out.write_text(json.dumps(data), encoding="utf-8")
    return load_worksheet(out)


def _capture(tmp_path: Path, mutate: Any = None, name: str = "run") -> Capture:
    bundle = FIXTURES / "capture_synthetic.json"
    if mutate is not None:
        data = json.loads(bundle.read_text(encoding="utf-8"))
        mutate(data)
        bundle = tmp_path / f"{name}.bundle.json"
        bundle.write_text(json.dumps(data), encoding="utf-8")
    run_dir = load_bundle(bundle, tmp_path / name)
    seal_capture(run_dir)
    return load_capture(run_dir)


def _evaluate(
    capture: Capture,
    window: Window,
    *,
    deals: Deals | None = None,
    sheet: Worksheet | None = None,
    clock: Any = US,
    run_day: date = RUN_DAY,
) -> AccountVerdict:
    return evaluate_account(
        capture,
        "k1",
        sheet if sheet is not None else _worksheet(),
        window,
        oracle_deals=_deals() if deals is None else deals,
        clock=clock,
        run_day=run_day,
    )


def _wall(year: int, month: int, day: int, hour: int, minute: int = 0, second: int = 0) -> int:
    """A broker wall time as the epoch seconds MT5 reports it (the wall clock read as UTC)."""
    return calendar.timegm(datetime(year, month, day, hour, minute, second).timetuple())


def _with_time(deals: Deals, deal_id: int, wall: int) -> Deals:
    assert any(d["deal"] == deal_id for d in deals)
    return tuple({**d, "time": wall} if d["deal"] == deal_id else d for d in deals)


def _shift_all(deals: Deals, seconds: int) -> Deals:
    return tuple({**d, "time": d["time"] + seconds} for d in deals)


def _extra_deal(wall: int, *, deal_id: int = 9001, deal_type: int = 1) -> Mapping[str, Any]:
    return {
        "deal": deal_id,
        "time": wall,
        "type": deal_type,
        "entry": 1 if deal_type in (0, 1) else None,
        "profit": 10.0,
        "swap": 0.0,
        "commission": 0.0,
        "fee": 0.0,
        "balance": 12080.0,
        "position_id": None,
        "time_msc": None,
    }


def _marks(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = data["raw"]["capture-marks.json"][0]["slice_rows"]
    return rows


def _key_inputs_payload(data: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = data["raw"]["capture-key-inputs.json"][0]["slice_rows"][0]["payload"]
    return payload


def _legs(verdict: AccountVerdict) -> dict[str, LegResult]:
    return {leg.leg: leg for leg in verdict.legs}


def _refusal(window: Window, capture: Capture, **overrides: Any) -> str:
    kwargs: dict[str, Any] = {
        "capture": capture,
        "ordinal": "k1",
        "readings": _worksheet().accounts["SYN-A"],
        "oracle_deals": _deals(),
        "clock": US,
        "run_day": RUN_DAY,
    }
    kwargs.update(overrides)
    with pytest.raises(WindowRefused) as refused:
        validate_window(window, **kwargs)
    return refused.value.reason


# ------------------------------------------------------------- tolerance boundaries


def test_a_gap_exactly_at_the_tolerance_passes_and_the_next_float_fails() -> None:
    assert leg_passes(MT5_PARITY_TOLERANCE) is True
    assert leg_passes(math.nextafter(MT5_PARITY_TOLERANCE, 1.0)) is False
    assert leg_passes(0.0) is True


def test_a_real_leg_sitting_exactly_on_the_tolerance_passes(tmp_path: Path) -> None:
    # 119 / 11900 is exactly the tolerance: the boundary through the real end_level leg.
    def move(data: dict[str, Any]) -> None:
        for reading in data["accounts"]["SYN-A"]["readings"]:
            if reading["id"] == "weekend_close_equity":
                reading["value"] = 12150.0 - 119.0

    verdict = _evaluate(_capture(tmp_path), GATE_B, sheet=_worksheet(move, tmp_path=tmp_path))
    end_level = _legs(verdict)["end_level"]
    assert end_level.gap == MT5_PARITY_TOLERANCE
    assert end_level.passed is True


def test_the_identity_band_boundary_is_inclusive() -> None:
    assert identity_leg(MT5_INCEPTION_IDENTITY_BAND, 0.0).passed is True
    assert identity_leg(0.0, -MT5_INCEPTION_IDENTITY_BAND).passed is True
    above = math.nextafter(MT5_INCEPTION_IDENTITY_BAND, 1.0)
    assert identity_leg(above, 0.0).passed is False
    assert identity_leg(0.0, above).passed is False
    for missing in (identity_leg(None, 0.0), identity_leg(0.0, None)):
        assert missing.passed is False and missing.gap is None
        assert (missing.reason or "").startswith("not_measurable:")


# ------------------------------------------------------------------------ Gate A


def test_gate_a_on_the_synthetic_account_is_green_on_every_leg(tmp_path: Path) -> None:
    capture = _capture(tmp_path)
    verdict = _evaluate(capture, GATE_A)
    assert [leg.leg for leg in verdict.legs] == LEG_ORDER
    for leg in verdict.legs:
        assert leg.gap is not None and leg.gap <= 1e-9, leg
        assert leg.passed is True
    assert verdict.bucket == WITHIN_TOLERANCE
    assert verdict.passed is True
    payload = our_key_inputs(capture, "k1")
    assert payload is not None
    ours = our_identity_ratio(payload)
    theirs = oracle_identity_ratio(_deals())
    assert ours is not None and theirs is not None
    assert abs(ours) <= 1e-9 and abs(theirs) <= 1e-9


def test_gate_a_is_a_pure_function_of_its_inputs(tmp_path: Path) -> None:
    capture = _capture(tmp_path)
    first = gate_a_legs(capture, "k1", _deals(), GATE_A, US)
    second = gate_a_legs(capture, "k1", _deals(), GATE_A, US)
    assert first == second
    with pytest.raises(ValueError):
        gate_a_legs(capture, "k1", _deals(), GATE_B, US)


def test_gate_a_moves_one_leg_when_one_input_moves(tmp_path: Path) -> None:
    # The first sell is 300 on a base of 9995: the end level, the money return and the
    # day placement all see the 10-07 profit, the start level and the identity do not.
    moved = tuple(
        {**d, "profit": d["profit"] + 250.0} if d["deal"] == 1003 else d for d in _deals()
    )
    verdict = _evaluate(_capture(tmp_path), GATE_A, deals=moved)
    legs = _legs(verdict)
    assert verdict.passed is False
    assert legs["start_level"].passed is True
    # 250 / 9995 is above the tolerance on the day placement leg.
    assert legs["day_placement"].passed is False
    assert legs["day_placement"].gap == pytest.approx(250.0 / 9995.0, abs=1e-12)


# ------------------------------------------------------------------- the picker


def test_propose_windows_on_the_synthetic_account(tmp_path: Path) -> None:
    capture = _capture(tmp_path)
    proposed = propose_windows(
        capture=capture,
        ordinal="k1",
        readings=_worksheet().accounts["SYN-A"],
        oracle_deals=_deals(),
        clock=US,
        run_day=RUN_DAY,
    )
    assert proposed == (GATE_A, GATE_B)


def test_propose_windows_never_proposes_an_unclosed_window(tmp_path: Path) -> None:
    proposed = propose_windows(
        capture=_capture(tmp_path),
        ordinal="k1",
        readings=_worksheet().accounts["SYN-A"],
        oracle_deals=_deals(),
        clock=US,
        run_day=date(2026, 11, 13),  # Gate B ends on the run day: not closed
    )
    assert proposed == (GATE_A,)


def test_propose_windows_proposes_nothing_without_oracle_or_marks(tmp_path: Path) -> None:
    def drop_marks(data: dict[str, Any]) -> None:
        marks = data["raw"]["capture-marks.json"][0]
        marks["slice_rows"] = []
        marks["row_count"] = 0
        marks["first_day"] = None
        marks["last_day"] = None
        for table in ("bind-before.json", "bind-after.json"):
            data["raw"][table][0]["marks_count"] = 0
            data["raw"][table][0]["marks_max_created_at"] = None

    capture = _capture(tmp_path, drop_marks)
    assert (
        propose_windows(
            capture=capture,
            ordinal="k1",
            readings=_worksheet().accounts["SYN-A"],
            oracle_deals=_deals(),
            clock=US,
            run_day=RUN_DAY,
        )
        == ()
    )
    assert (
        propose_windows(
            capture=_capture(tmp_path, name="again"),
            ordinal="k1",
            readings=(),
            oracle_deals=(),
            clock=US,
            run_day=RUN_DAY,
        )
        == ()
    )


def _with_extra_equity(tmp_path: Path, extras: list[tuple[str, str, float]]) -> Worksheet:
    """The synthetic worksheet plus extra equity readings: (id, as_of, value)."""

    def add(data: dict[str, Any]) -> None:
        for reading_id, as_of, value in extras:
            data["accounts"]["SYN-A"]["readings"].append(
                {
                    "id": reading_id,
                    "as_of": as_of,
                    "value": value,
                    "provenance": "broker_statement"
                    if reading_id == "statement_equity"
                    else "terminal_reading",
                }
            )

    return _worksheet(add, tmp_path=tmp_path)


def test_two_agreeing_equity_readings_on_one_friday_are_judged_not_dropped(
    tmp_path: Path,
) -> None:
    # Why: the founder script asks for a statement reading AND a weekend reading on
    # the same Friday. That used to void the edge (no reading), so Gate B vanished.
    capture = _capture(tmp_path)
    sheet = _with_extra_equity(tmp_path, [("statement_equity", "2026-11-13", 12150.0)])
    readings = sheet.accounts["SYN-A"]
    verdict = _evaluate(capture, GATE_B, sheet=sheet)
    assert verdict.passed is True and verdict.reason is None
    proposed = propose_windows(
        capture=capture,
        ordinal="k1",
        readings=readings,
        oracle_deals=_deals(),
        clock=US,
        run_day=RUN_DAY,
    )
    assert proposed == (GATE_A, GATE_B)


def test_two_equity_readings_that_disagree_beyond_tolerance_make_the_leg_red_by_name(
    tmp_path: Path,
) -> None:
    # Why: neither the broker statement (D-C) nor the weekend reading (D-E) is crowned.
    # Both must hold; a disagreement between them is a RED leg, never a silent pass.
    capture = _capture(tmp_path)
    sheet = _with_extra_equity(tmp_path, [("statement_equity", "2026-11-13", 12150.0 * 1.05)])
    verdict = _evaluate(capture, GATE_B, sheet=sheet)
    assert verdict.passed is False
    legs = _legs(verdict)
    assert legs["end_level"].reason == "not_measurable:readings_disagree"
    assert legs["cum_return"].reason == "not_measurable:readings_disagree"
    assert legs["start_level"].passed is True


def test_each_equity_reading_is_judged_so_a_spread_wider_than_tolerance_fails(
    tmp_path: Path,
) -> None:
    # Each reading is within tolerance of our mark, yet they differ from each other by
    # more than the tolerance: the leg must still be RED.
    capture = _capture(tmp_path)
    delta = 0.7 * MT5_PARITY_TOLERANCE * 11900.0
    sheet = _with_extra_equity(
        tmp_path,
        [
            ("statement_equity", "2026-11-13", 12150.0 - delta),
            ("statement_equity", "2026-11-13", 12150.0 + delta),
        ],
    )
    verdict = _evaluate(capture, GATE_B, sheet=sheet)
    assert verdict.passed is False
    assert _legs(verdict)["end_level"].reason == "not_measurable:readings_disagree"


def test_keep_refused_leaves_exactly_one_window_per_gate_each_refused_by_its_real_reason(
    tmp_path: Path,
) -> None:
    # Why: a gate the picker could not build used to be missing from the proposal, so a
    # verdict could read green on the other gate alone. With keep_refused the gate stays,
    # and evaluate_account turns it into a RED verdict naming the real refusal.
    capture = _capture(tmp_path)

    def drop_start_reading(data: dict[str, Any]) -> None:
        rows = data["accounts"]["SYN-A"]["readings"]
        rows[:] = [
            r for r in rows if not (r["id"] == "statement_equity" and r["as_of"] == "2026-11-06")
        ]

    sheet = _worksheet(drop_start_reading, tmp_path=tmp_path)
    no_start_reading = sheet.accounts["SYN-A"]
    common: dict[str, Any] = {
        "capture": capture,
        "ordinal": "k1",
        "oracle_deals": _deals(),
        "clock": US,
        "run_day": RUN_DAY,
    }
    assert propose_windows(readings=no_start_reading, **common) == (GATE_A,)
    kept = propose_windows(readings=no_start_reading, keep_refused=True, **common)
    assert [w.gate for w in kept] == ["A", "B"]
    verdicts = [
        evaluate_account(
            capture,
            "k1",
            sheet,
            w,
            oracle_deals=_deals(),
            clock=US,
            run_day=RUN_DAY,
        )
        for w in kept
    ]
    assert verdicts[0].passed is True
    assert verdicts[1].passed is False
    assert verdicts[1].reason == "window_refused:edge_without_reading"
    # Nothing to even propose: both gates are still there, naming that.
    empty = propose_windows(
        readings=(), keep_refused=True, **{**common, "oracle_deals": ()}
    )
    assert [(w.gate, w.refusal) for w in empty][0] == ("A", "no_candidate_window")
    refused = evaluate_account(
        capture,
        "k1",
        _worksheet(),
        empty[0],
        oracle_deals=_deals(),
        clock=US,
        run_day=RUN_DAY,
    )
    assert refused.passed is False
    assert refused.reason == "window_refused:no_candidate_window"
    with pytest.raises(ValueError):
        Window("A", RUN_DAY, RUN_DAY, refusal="made_up")


def test_every_window_refusal_reason_is_produced_and_the_set_is_closed(tmp_path: Path) -> None:
    capture = _capture(tmp_path)
    seen: dict[str, str] = {}

    seen["gate_b_edge_before_first_mark"] = _refusal(
        Window("B", date(2026, 10, 30), date(2026, 11, 13)), capture
    )
    seen["window_not_closed"] = _refusal(Window("B", date(2026, 11, 6), RUN_DAY), capture)
    seen["edge_without_mark"] = _refusal(Window("B", date(2026, 11, 6), date(2026, 11, 9)), capture)

    no_start_reading = tuple(
        r
        for r in _worksheet().accounts["SYN-A"]
        if not (r.id == "statement_equity" and r.as_of == "2026-11-06")
    )
    seen["edge_without_reading"] = _refusal(GATE_B, capture, readings=no_start_reading)

    def extra_flow(data: dict[str, Any]) -> None:
        _key_inputs_payload(data)["composed_flows"].append(
            {"utc_day_iso": "2026-11-10", "flow_usd": 100.0}
        )

    seen["flow_in_gate_b_window"] = _refusal(GATE_B, _capture(tmp_path, extra_flow, "flow"))

    in_gap = _deals() + (_extra_deal(_wall(2026, 11, 7, 12)),)
    seen["deal_in_edge_gap"] = _refusal(GATE_B, capture, oracle_deals=in_gap)

    seen["gate_a_reaches_first_mark"] = _refusal(
        Window("A", date(2026, 10, 5), date(2026, 11, 2)), capture
    )
    seen["edge_order"] = _refusal(Window("A", date(2026, 10, 30), date(2026, 10, 30)), capture)
    (nothing,) = (
        w
        for w in propose_windows(
            capture=capture,
            ordinal="k1",
            readings=(),
            oracle_deals=(),
            clock=US,
            run_day=RUN_DAY,
            keep_refused=True,
        )
        if w.gate == "A"
    )
    assert nothing.refusal is not None
    seen["no_candidate_window"] = nothing.refusal

    for reason, got in seen.items():
        assert got == reason
    assert set(seen) == set(WINDOW_REFUSAL_REASONS)
    assert len(WINDOW_REFUSAL_REASONS) == 9


def test_a_refused_window_is_a_red_verdict_naming_the_reason_never_a_skip(
    tmp_path: Path,
) -> None:
    verdict = _evaluate(_capture(tmp_path), Window("B", date(2026, 11, 6), RUN_DAY))
    assert verdict.passed is False
    assert verdict.bucket == UNEXPLAINED
    assert verdict.reason == "window_refused:window_not_closed"
    assert verdict.legs == ()
    text = render_verdict_markdown(Verdict((verdict,), rehearsal=True, run_day=RUN_DAY))
    assert "window_refused:window_not_closed" in text


def test_the_weekend_gap_boundary_is_inclusive_at_friday_2200_utc(tmp_path: Path) -> None:
    capture = _capture(tmp_path)
    # Under the us rule on 2026-11-06 the broker is UTC+2: 22:00 UTC is wall 00:00 on the 7th.
    inside = _deals() + (_extra_deal(_wall(2026, 11, 7, 0, 0, 0)),)
    outside = _deals() + (_extra_deal(_wall(2026, 11, 6, 23, 59, 59)),)
    assert _refusal(GATE_B, capture, oracle_deals=inside) == "deal_in_edge_gap"
    validate_window(
        GATE_B,
        capture=capture,
        ordinal="k1",
        readings=_worksheet().accounts["SYN-A"],
        oracle_deals=outside,
        clock=US,
        run_day=RUN_DAY,
    )


# ----------------------------------------------------------------- fail closed


def test_an_empty_oracle_makes_every_gate_a_leg_not_measurable(tmp_path: Path) -> None:
    verdict = _evaluate(_capture(tmp_path), GATE_A, deals=())
    assert [leg.leg for leg in verdict.legs] == LEG_ORDER
    for leg in verdict.legs:
        assert leg.gap is None and leg.passed is False
        assert leg.reason == "not_measurable:oracle_deals"
    assert verdict.passed is False


def test_an_empty_oracle_never_passes_gate_b_either(tmp_path: Path) -> None:
    verdict = _evaluate(_capture(tmp_path), GATE_B, deals=())
    assert verdict.passed is False
    assert all(leg.reason == "not_measurable:oracle_deals" for leg in verdict.legs)


def test_a_capture_without_key_inputs_is_not_measurable_on_the_money_legs(
    tmp_path: Path,
) -> None:
    def drop_key_inputs(data: dict[str, Any]) -> None:
        table = data["raw"]["capture-key-inputs.json"][0]
        table["slice_rows"] = []
        table["row_count"] = 0
        for name in ("bind-before.json", "bind-after.json"):
            data["raw"][name][0]["key_inputs_computed_at"] = None

    verdict = _evaluate(_capture(tmp_path, drop_key_inputs), GATE_A)
    legs = _legs(verdict)
    assert verdict.passed is False
    for name in ("start_level", "end_level", "cum_return", "day_placement"):
        assert legs[name].reason == "not_measurable:key_inputs", name
    assert legs["inception_identity"].reason == "not_measurable:identity_ours"


def test_a_native_unit_account_is_never_compared_across_units(tmp_path: Path) -> None:
    def native(data: dict[str, Any]) -> None:
        for row in _marks(data):
            row["native_unit"] = "BTC"
            row["nav_native"] = row["nav_usd"]
            row["open_pnl_native"] = row["open_pnl_usd"]

    verdict = _evaluate(_capture(tmp_path, native), GATE_A)
    legs = _legs(verdict)
    assert verdict.passed is False
    for name in ("start_level", "end_level", "cum_return", "day_placement"):
        assert legs[name].reason == "not_measurable:unit_mismatch", name


def test_a_deal_the_engine_cannot_classify_is_not_measurable_not_a_crash(
    tmp_path: Path,
) -> None:
    unknown = tuple({**d, "type": 4} if d["deal"] == 1005 else d for d in _deals())
    verdict = _evaluate(_capture(tmp_path), GATE_A, deals=unknown)
    assert verdict.passed is False
    assert all(leg.reason == "not_measurable:oracle_deals" for leg in verdict.legs)


def test_gate_a_requires_the_oracle_inputs_and_they_arrive_together(tmp_path: Path) -> None:
    capture = _capture(tmp_path)
    with pytest.raises(ValueError):
        evaluate_account(capture, "k1", _worksheet(), GATE_A)
    with pytest.raises(ValueError):
        evaluate_account(capture, "k1", _worksheet(), GATE_B, clock=US)


# ----------------------------------------------- the day a deal lands on (Pitfall 1)


def test_a_deal_at_exactly_midnight_utc_lands_on_the_day_the_seam_assigns(
    tmp_path: Path,
) -> None:
    capture = _capture(tmp_path)
    # us rule on 2026-10-27: the broker is UTC+3, so wall 03:00:00 is 00:00:00 UTC.
    on_midnight = _with_time(_deals(), 1007, _wall(2026, 10, 27, 3, 0, 0))
    just_before = _with_time(_deals(), 1007, _wall(2026, 10, 27, 2, 59, 59))

    assert deal_utc_day(_wall(2026, 10, 27, 3, 0, 0), US) == "2026-10-27"
    assert deal_utc_day(_wall(2026, 10, 27, 2, 59, 59), US) == "2026-10-26"
    moved = {ts.date(): v for ts, v in mt5_day_pnl(on_midnight, server_utc_offset_s=US).items()}
    stayed = {ts.date(): v for ts, v in mt5_day_pnl(just_before, server_utc_offset_s=US).items()}
    assert moved.get(date(2026, 10, 26), 0.0) == 0.0
    assert moved[date(2026, 10, 27)] == pytest.approx(500.0 - 400.0)
    assert stayed[date(2026, 10, 26)] == pytest.approx(500.0)
    assert stayed[date(2026, 10, 27)] == pytest.approx(-400.0)

    # The engine's own fold agrees with the seam on both sides: our books put the 500
    # on 10-26, so the exact-midnight deal breaches day_placement and the second
    # before does not.
    assert _evaluate(capture, GATE_A, deals=just_before).passed is True
    breach = _evaluate(capture, GATE_A, deals=on_midnight)
    assert breach.passed is False
    assert _legs(breach)["day_placement"].passed is False


# =============================================================== the explainer registry


def _dropped_oldest_deal() -> Deals:
    deals = _deals()
    assert deals[0]["deal"] == 1001
    return deals[1:]


def _relabel(deals: Deals, deal_id: int, new_type: int) -> Deals:
    assert any(d["deal"] == deal_id for d in deals)
    return tuple({**d, "type": new_type} if d["deal"] == deal_id else d for d in deals)


def _failing(verdict: AccountVerdict) -> list[str]:
    return [leg.leg for leg in verdict.legs if not leg.passed]


def test_the_taxonomy_is_the_eight_context_names_and_the_registry_order_is_fixed() -> None:
    assert BUCKET_LABELS == {
        "within_tolerance",
        "pre_mark_realized_basis",
        "edge_instant_mismatch",
        "flow_placement",
        "annualization_convention",
        "withheld_by_gate",
        "clock_mismatch",
        "unexplained",
    }
    assert [bucket for bucket, _ in EXPLAINERS] == [
        CLOCK_MISMATCH,
        FLOW_PLACEMENT,
        PRE_MARK_REALIZED_BASIS,
        EDGE_INSTANT_MISMATCH,
        ANNUALIZATION_CONVENTION,
    ]
    assert WITHHELD_BY_GATE in BUCKET_LABELS
    assert WITHHELD_BY_GATE not in [bucket for bucket, _ in EXPLAINERS]


def test_a_one_hour_shift_is_a_red_clock_mismatch_and_is_never_corrected(
    tmp_path: Path,
) -> None:
    # +1h moves the 500.00 deal (wall 02:30 on 10-27, UTC 23:30 on 10-26) onto 10-27.
    verdict = _evaluate(_capture(tmp_path), GATE_A, deals=_shift_all(_deals(), 3600))
    assert verdict.bucket == CLOCK_MISMATCH
    assert verdict.matched == (CLOCK_MISMATCH,)
    assert _failing(verdict) == ["day_placement"]
    assert verdict.reason == "day_placement"
    # RED stays RED: the counterfactual that cleared it is a label, not a repair, and
    # the reported legs are the ones measured under the clock that was supplied.
    assert verdict.passed is False
    assert _legs(verdict)["day_placement"].gap == pytest.approx(500.0 / 9995.0, abs=1e-12)


def test_a_wrong_dst_rule_is_a_red_clock_mismatch_too(tmp_path: Path) -> None:
    # Our books were folded under the us rule; folding the oracle under eu moves the same deal.
    verdict = _evaluate(_capture(tmp_path), GATE_A, clock=EU)
    assert verdict.bucket == CLOCK_MISMATCH
    assert verdict.passed is False
    assert _failing(verdict) == ["day_placement"]


def test_a_deposit_relabelled_as_a_trade_is_a_red_flow_placement(tmp_path: Path) -> None:
    deals = _relabel(_deals(), 1004, 1)  # the 2026-10-12 deposit becomes a sell
    verdict = _evaluate(_capture(tmp_path), GATE_A, deals=deals)
    assert verdict.bucket == FLOW_PLACEMENT
    assert verdict.matched == (FLOW_PLACEMENT,)
    assert verdict.passed is False
    failing = _failing(verdict)
    assert "cum_return" in failing and "day_placement" in failing
    # The first deposit is untouched, so the inception identity still holds.
    assert _legs(verdict)["inception_identity"].passed is True


def test_a_trade_relabelled_as_a_deposit_is_a_red_flow_placement(tmp_path: Path) -> None:
    deals = _relabel(_deals(), 1005, 2)
    verdict = _evaluate(_capture(tmp_path), GATE_A, deals=deals)
    assert verdict.bucket == FLOW_PLACEMENT
    assert verdict.passed is False


def test_the_flow_explainer_never_mutates_the_oracle_it_was_given(tmp_path: Path) -> None:
    deals = _relabel(_deals(), 1004, 1)
    before = copy.deepcopy(deals)
    _evaluate(_capture(tmp_path), GATE_A, deals=deals)
    assert deals == before


def test_a_mark_with_open_pnl_against_a_realized_balance_is_pre_mark_realized_basis(
    tmp_path: Path,
) -> None:
    def open_pnl_300(data: dict[str, Any]) -> None:
        row = _marks(data)[2]
        assert row["mark_day"] == "2026-11-13"
        row["open_pnl_usd"] = 300.0
        row["nav_usd"] = 12370.0

    def balance_reading(data: dict[str, Any]) -> None:
        for reading in data["accounts"]["SYN-A"]["readings"]:
            if reading["id"] == "weekend_close_equity":
                reading["value"] = 12070.0  # a balance, not an equity

    verdict = _evaluate(
        _capture(tmp_path, open_pnl_300),
        GATE_B,
        sheet=_worksheet(balance_reading, tmp_path=tmp_path),
    )
    assert verdict.bucket == PRE_MARK_REALIZED_BASIS
    assert verdict.matched == (PRE_MARK_REALIZED_BASIS,)
    assert verdict.passed is False
    assert _failing(verdict) == ["end_level", "cum_return"]


def test_edge_instant_mismatch_is_unchanged_with_the_full_registry(tmp_path: Path) -> None:
    def move_mark(data: dict[str, Any]) -> None:
        row = _marks(data)[2]
        assert row["mark_day"] == "2026-11-13"
        row["marked_at"] = "2026-11-16T00:05:00Z"

    def move_reading(data: dict[str, Any]) -> None:
        for reading in data["accounts"]["SYN-A"]["readings"]:
            if reading["id"] == "weekend_close_equity":
                reading["value"] = 12400.0

    verdict = _evaluate(
        _capture(tmp_path, move_mark),
        GATE_B,
        sheet=_worksheet(move_reading, tmp_path=tmp_path),
    )
    assert verdict.bucket == EDGE_INSTANT_MISMATCH
    assert verdict.matched == (EDGE_INSTANT_MISMATCH,)
    assert verdict.passed is False


def test_a_dropped_oldest_deal_moves_only_the_identity_and_lands_in_unexplained(
    tmp_path: Path,
) -> None:
    verdict = _evaluate(_capture(tmp_path), GATE_A, deals=_dropped_oldest_deal())
    legs = _legs(verdict)
    assert verdict.bucket == UNEXPLAINED
    assert verdict.matched == ()
    assert verdict.reason == "inception_identity"
    assert verdict.passed is False
    # Vacuity guard (Pitfall 1): the truncation breaks ONLY the identity. If another
    # leg had failed too, this test would pass for a reason that is not the identity.
    for name in ("start_level", "end_level", "cum_return", "day_placement"):
        assert legs[name].passed is True, name
    assert legs["inception_identity"].gap is not None
    assert legs["inception_identity"].gap > MT5_INCEPTION_IDENTITY_BAND


def test_annualization_is_evaluated_on_every_breach_and_never_matches_in_the_engine(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[ExplainerContext] = []
    registered = dict(EXPLAINERS)[ANNUALIZATION_CONVENTION]
    results: list[bool] = []

    def spy(ctx: ExplainerContext) -> bool:
        seen.append(ctx)
        results.append(registered(ctx))
        return results[-1]

    patched = tuple((b, spy) if b == ANNUALIZATION_CONVENTION else (b, f) for b, f in EXPLAINERS)
    monkeypatch.setattr(engine, "EXPLAINERS", patched)
    capture = _capture(tmp_path)
    # An unexplained breach, and an explained one that matched an EARLIER explainer:
    # every explainer runs on both, so the spy fires twice.
    unexplained = _evaluate(capture, GATE_A, deals=_dropped_oldest_deal())
    explained = _evaluate(capture, GATE_A, deals=_shift_all(_deals(), 3600))
    assert len(seen) == 2
    assert results == [False, False]
    assert unexplained.bucket == UNEXPLAINED
    assert explained.bucket == CLOCK_MISMATCH
    assert ANNUALIZATION_CONVENTION not in explained.matched


def test_priority_takes_the_first_match_and_records_every_match(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        engine,
        "EXPLAINERS",
        ((CLOCK_MISMATCH, lambda ctx: True), (FLOW_PLACEMENT, lambda ctx: True)),
    )
    verdict = _evaluate(_capture(tmp_path), GATE_A, deals=_dropped_oldest_deal())
    assert verdict.bucket == CLOCK_MISMATCH
    assert verdict.matched == (CLOCK_MISMATCH, FLOW_PLACEMENT)
    assert verdict.passed is False


def test_the_loop_is_the_only_path_to_a_bucket(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    capture = _capture(tmp_path)
    ctx = ExplainerContext(
        capture=capture,
        ordinal="k1",
        readings=_worksheet().accounts["SYN-A"],
        window=GATE_B,
        breaching=(LegResult(leg="end_level", gap=0.5, passed=False, reason=None),),
    )
    monkeypatch.setattr(engine, "EXPLAINERS", ())
    assert classify_breach(ctx) == (UNEXPLAINED, ())
    monkeypatch.setattr(engine, "EXPLAINERS", ((FLOW_PLACEMENT, lambda c: True),))
    assert classify_breach(ctx) == (FLOW_PLACEMENT, (FLOW_PLACEMENT,))


def test_no_scenario_ever_reaches_a_passing_bucket_by_explanation(tmp_path: Path) -> None:
    capture = _capture(tmp_path)
    scenarios = (
        _evaluate(capture, GATE_A, deals=_shift_all(_deals(), 3600)),
        _evaluate(capture, GATE_A, deals=_relabel(_deals(), 1004, 1)),
        _evaluate(capture, GATE_A, deals=_dropped_oldest_deal()),
        _evaluate(capture, GATE_A, clock=EU),
    )
    for verdict in scenarios:
        assert verdict.passed is False
        assert verdict.bucket not in (WITHIN_TOLERANCE, WITHHELD_BY_GATE)


def test_the_same_inputs_render_byte_identical_markdown_ordered_by_label(
    tmp_path: Path,
) -> None:
    def build(name: str, *, reverse: bool) -> Verdict:
        capture = _capture(tmp_path, name=name)
        a = _evaluate(capture, GATE_A, deals=_shift_all(_deals(), 3600))
        b = dataclasses.replace(_evaluate(capture, GATE_B), label="SYN-B")
        accounts = (a, b)
        return Verdict(accounts[::-1] if reverse else accounts, rehearsal=True, run_day=RUN_DAY)

    first = build("one", reverse=False)
    second = build("two", reverse=False)
    flipped = build("three", reverse=True)
    text = render_verdict_markdown(first)
    assert text == render_verdict_markdown(second)
    assert text == render_verdict_markdown(flipped)
    assert verdict_to_json(first) == verdict_to_json(second) == verdict_to_json(flipped)
    assert text.index("## SYN-A") < text.index("## SYN-B")
