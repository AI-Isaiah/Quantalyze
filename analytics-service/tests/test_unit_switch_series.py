"""Phase 256 OKXUNITSWITCH plan 04 — the two-segment series builder: a switched account's
whole-history USD headline (the USD segment through S, then the coin segment converted at the
stored daily close) and its native coin segment.

ORACLE DISCIPLINE: the expected values here are NOT read back from the builder. Closes and P&L are
literals; the NAV identity ``L(d - 1) = L(d) - P_d - F_d`` and the conversion
``(1 + r) x close(d) / close(d - 1) - 1`` are re-derived in this file from the inputs (the second is
the shared ``native_to_usd`` oracle's own convention, restated, never imported from the converter),
so a bug in the builder's anchoring, boundary or conversion cannot cancel against itself.

Fixtures use round illustrative values only (T-256-02): no real amount or account figure.

Run: cd analytics-service && python3 -m pytest tests/test_unit_switch_series.py -x
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd
import pytest

from services.account_unit import USD_FLOORS
from services.broker_dailies import combine_realized_and_funding
from services.external_flows import ExternalFlow
from services.unit_switch import UNIT_SWITCH_REFUSALS, SplitPnl, UnitSwitch
from services.unit_switch_series import (
    SWITCH_ANCHOR_UNPRICED,
    SwitchedSeries,
    _merge_meta,
    build_switched_series,
)

S = "2026-11-14"
FIRST_COIN_DAY = "2026-11-15"
LATEST = "2026-11-26"
SWITCH = UnitSwitch(coin="BTC", last_usd_day=S, first_coin_return_day="2026-11-15")

# One round, distinct close for every day 11-01 .. 11-26 (11-14 = 90000, 11-22 = 92000, 11-26 = 92000).
_CLOSE_VALUES = [
    88000.0, 88500.0, 89000.0, 89500.0, 88000.0, 87000.0, 87500.0, 88500.0, 89000.0, 89500.0,
    90500.0, 91000.0, 89000.0, 90000.0, 90500.0, 91000.0, 90000.0, 89500.0, 90500.0, 91500.0,
    92500.0, 92000.0, 90500.0, 91500.0, 91000.0, 92000.0,
]
CLOSE_BY_DAY: dict[str, float] = {
    f"2026-11-{n:02d}": value for n, value in enumerate(_CLOSE_VALUES, start=1)
}
assert CLOSE_BY_DAY[S] == 90000.0 and CLOSE_BY_DAY[LATEST] == 92000.0
assert CLOSE_BY_DAY["2026-11-22"] == 92000.0


def _closes(by_day: dict[str, float] | None = None, drop: tuple[str, ...] = ()) -> pd.Series:
    source = CLOSE_BY_DAY if by_day is None else by_day
    items = {day: value for day, value in source.items() if day not in drop}
    return pd.Series(
        list(items.values()),
        index=pd.DatetimeIndex([pd.Timestamp(day) for day in items]).as_unit("us"),
        dtype="float64",
    )


def _days(first: str, last: str) -> list[str]:
    out: list[str] = []
    day = date.fromisoformat(first)
    while day <= date.fromisoformat(last):
        out.append(day.isoformat())
        day += timedelta(days=1)
    return out


def _prev(day: str) -> str:
    return (date.fromisoformat(day) - timedelta(days=1)).isoformat()


def _founder_split() -> SplitPnl:
    return SplitPnl(
        usd_by_day={"2026-11-10": 120.0, "2026-11-12": 900.0, "2026-11-14": -108.0},
        coin_by_day={"2026-11-20": -0.0009},
    )


def _build(**overrides: Any) -> SwitchedSeries | str:
    kwargs: dict[str, Any] = {
        "switch": SWITCH,
        "split": _founder_split(),
        "funding_rows": [],
        "external_flows": [],
        "anchor_usd": 184000.0,
        "anchor_price": CLOSE_BY_DAY[LATEST],
        "open_unrealized_usd": 0.0,
        "closes": _closes(),
        "latest_close_day": LATEST,
        "usd_full_history": False,
    }
    kwargs.update(overrides)
    return build_switched_series(**kwargs)


def _ok(result: SwitchedSeries | str) -> SwitchedSeries:
    assert isinstance(result, SwitchedSeries), f"refused: {result!r}"
    return result


def _iso(index: pd.Index) -> list[str]:
    return [ts.date().isoformat() for ts in pd.DatetimeIndex(index)]


def _by_day(series: pd.Series) -> dict[str, float]:
    return dict(zip(_iso(series.index), (float(v) for v in series), strict=True))


# ---------------------------------------------------------------------------
# Independent oracles (re-derived from the inputs, never from the builder).
# ---------------------------------------------------------------------------


def _coin_oracle(
    pnl: dict[str, float], flows: dict[str, float], terminal: float, first: str, last: str
) -> tuple[dict[str, float], dict[str, float]]:
    """NAV levels L(d) and returns r_d = P_d / L(d - 1) over the dense days ``first..last``, by the
    identity L(d - 1) = L(d) - P_d - F_d from the terminal level. ``first`` is day 0 (r = 0)."""
    days = _days(first, last)
    level = {last: terminal}
    for day in reversed(days[1:]):
        level[_prev(day)] = level[day] - pnl.get(day, 0.0) - flows.get(day, 0.0)
    returns = {day: pnl.get(day, 0.0) / level[_prev(day)] for day in days[1:]}
    return level, returns


def _usd_oracle(
    pnl: dict[str, float], terminal: float, first: str, last: str
) -> dict[str, float]:
    """The USD segment's returns by the same identity, day 0 included (its base is reconstructed
    as L(first) - P_first)."""
    days = _days(first, last)
    level = {last: terminal}
    for day in reversed(days):
        level[_prev(day)] = level[day] - pnl.get(day, 0.0)
    return {day: pnl.get(day, 0.0) / level[_prev(day)] for day in days}


def _convert(r: float, day: str) -> float:
    """USD return of a coin day: (1 + r) x close(d) / close(d - 1) - 1."""
    return (1.0 + r) * CLOSE_BY_DAY[day] / CLOSE_BY_DAY[_prev(day)] - 1.0


# ---------------------------------------------------------------------------
# Task 1: the tracer.
# ---------------------------------------------------------------------------


def test_tracer_founder_shaped_inputs_give_a_whole_history_usd_headline() -> None:
    # Pre-fix: no two-segment construction exists on origin/main; the derive refuses the account.
    result = _ok(_build())

    coin_days = _days(FIRST_COIN_DAY, LATEST)
    usd_days = _days("2026-11-10", S)
    assert _iso(result.usd_returns.index) == usd_days
    assert _iso(result.coin_returns.index) == coin_days
    assert _iso(result.headline.index) == usd_days + coin_days

    # NAV identity over the coin days, in the coin, from the live anchor 184000 / 92000 = 2.0.
    level, coin_oracle = _coin_oracle({"2026-11-20": -0.0009}, {}, 2.0, S, LATEST)
    assert level[S] == pytest.approx(2.0 + 0.0009, abs=1e-15)
    assert result.coin_base_level == pytest.approx(2.0 + 0.0009, abs=1e-12)
    for day in coin_days:
        assert result.coin_returns.loc[pd.Timestamp(day)] == pytest.approx(coin_oracle[day], abs=1e-12)

    # The conversion oracle on every coin day.
    headline = _by_day(result.headline)
    for day in coin_days:
        assert headline[day] == pytest.approx(_convert(coin_oracle[day], day), abs=1e-12), day

    # The boundary anchor: the USD segment ends at the coin base level priced at S's close, so its
    # returns equal the identity rolled from level(S) x close(S), not from the raw live anchor.
    usd_oracle = _usd_oracle(
        {"2026-11-10": 120.0, "2026-11-12": 900.0, "2026-11-14": -108.0},
        level[S] * CLOSE_BY_DAY[S],
        "2026-11-10",
        S,
    )
    usd_returns = _by_day(result.usd_returns)
    for day, expected in usd_oracle.items():
        assert usd_returns[day] == pytest.approx(expected, abs=1e-12), day
    for day in usd_days:
        assert headline[day] == usd_returns[day]

    assert result.unpriced_days == ()
    assert result.meta["used_heuristic_capital"] is False
    assert "native_unit" not in result.meta


def test_the_coin_segment_is_native_levels_pnl_and_no_flows() -> None:
    # Pre-fix: no coin segment exists; nothing carried a native level or P&L for the account.
    result = _ok(_build())
    assert _iso(result.coin_nav_levels.index) == _days(S, LATEST)
    assert float(result.coin_nav_levels.loc[pd.Timestamp(S)]) == pytest.approx(result.coin_base_level)
    assert float(result.coin_nav_levels.loc[pd.Timestamp(LATEST)]) == pytest.approx(2.0, abs=1e-15)
    assert _by_day(result.coin_day_pnl)["2026-11-20"] == -0.0009
    assert sum(_by_day(result.coin_day_pnl).values()) == pytest.approx(-0.0009, abs=1e-15)
    assert result.coin_flow_by_day == {}


def test_floors_default_is_the_usd_row_so_existing_callers_are_unchanged() -> None:
    # Pre-fix: the engine entry points took no floors keyword. The default must be byte-identical.
    records = [
        {
            "exchange": "", "symbol": "X", "side": "buy" if i % 2 == 0 else "sell",
            "price": 50.0 + i, "quantity": 1, "fee": 0, "fee_currency": "USDT",
            "timestamp": f"2026-11-{10 + i:02d}T00:00:00+00:00", "order_type": "daily_pnl",
        }
        for i in range(6)
    ]
    default, default_meta = combine_realized_and_funding(records, [], 5000.0)
    explicit, explicit_meta = combine_realized_and_funding(records, [], 5000.0, floors=USD_FLOORS)
    pd.testing.assert_series_equal(default, explicit)
    assert default_meta == explicit_meta


# ---------------------------------------------------------------------------
# Task 2: boundary, unpriced days, refusals, flat coin, flows.
# ---------------------------------------------------------------------------


def test_day_accounting_every_day_is_in_exactly_one_unit() -> None:
    # Pre-fix: no two-segment construction exists on origin/main; the derive refuses the account.
    result = _ok(_build())
    usd = set(_iso(result.usd_returns.index))
    coin = set(_iso(result.coin_returns.index))
    assert usd.isdisjoint(coin)
    assert usd | coin == set(_days("2026-11-10", LATEST))
    assert max(usd) == S
    assert min(coin) == FIRST_COIN_DAY
    assert date.fromisoformat(min(coin)) == date.fromisoformat(max(usd)) + timedelta(days=1)
    assert set(_iso(result.headline.index)) == usd | coin


def test_pitfall_6_a_flat_coin_balance_under_a_falling_price_loses_in_usd() -> None:
    # Pre-fix: no two-segment construction exists on origin/main; the derive refuses the account.
    falling = dict(CLOSE_BY_DAY)
    price = CLOSE_BY_DAY[S]
    for day in _days(FIRST_COIN_DAY, LATEST):
        price *= 0.99
        falling[day] = price
    split = SplitPnl(usd_by_day={"2026-11-10": 120.0, S: -108.0}, coin_by_day={})
    result = _ok(
        _build(split=split, closes=_closes(falling), anchor_usd=2.0 * falling[LATEST])
    )
    coin_days = _days(FIRST_COIN_DAY, LATEST)
    # BOTH directions: the coin is flat, and the USD headline is the price fall, never the reverse.
    for day in coin_days:
        assert abs(result.coin_returns.loc[pd.Timestamp(day)]) < 1e-9, day
    headline = _by_day(result.headline)
    for day in coin_days:
        assert headline[day] < 0.0, day
        assert headline[day] == pytest.approx(0.99 - 1.0, abs=1e-9), day


@pytest.mark.parametrize("bad", ["absent", 0.0, -1.0, float("nan"), float("inf")])
def test_a_missing_or_unusable_close_is_in_the_coin_segment_and_absent_from_the_headline(
    bad: str | float,
) -> None:
    # Pre-fix: no two-segment construction exists on the base branch; the derive refuses the account.
    # T-256-10: an unusable close (zero, negative, NaN, inf) is as missing as an absent one, and
    # its day is named, never priced at a neighbour's close.
    if isinstance(bad, str):
        closes = _closes(drop=("2026-11-18",))
    else:
        by_day = dict(CLOSE_BY_DAY)
        by_day["2026-11-18"] = bad
        closes = _closes(by_day)
    result = _ok(_build(closes=closes))
    assert "2026-11-18" in _iso(result.coin_returns.index)
    assert "2026-11-19" in _iso(result.coin_returns.index)
    headline_days = _iso(result.headline.index)
    assert "2026-11-18" not in headline_days
    assert "2026-11-19" not in headline_days  # its interval [11-18, 11-19] holds no close at 11-18
    assert "2026-11-17" in headline_days and "2026-11-20" in headline_days
    assert result.unpriced_days == ("2026-11-18", "2026-11-19")


def test_the_pre_switch_history_does_not_move_with_the_overnight_price() -> None:
    """WR-01. The account holds a fixed amount of the coin, so its live equity is that amount times
    the LIVE price. Pre-fix the coin anchor divided the live equity by yesterday's close, so every
    overnight move re-scaled the whole stored USD history (the S-2 return was +1.00002% at +2%
    against +1.02041% exact). Anchored at the live price the held amount is exact, and nothing
    stored depends on the price the derive happened to run at."""
    held = 2.0
    quiet = _ok(_build(anchor_usd=held * 92000.0, anchor_price=92000.0))
    up = _ok(_build(anchor_usd=held * 93840.0, anchor_price=93840.0))
    down = _ok(_build(anchor_usd=held * 90160.0, anchor_price=90160.0))
    for other in (up, down):
        assert _by_day(other.usd_returns) == pytest.approx(_by_day(quiet.usd_returns), abs=1e-12)
        assert _by_day(other.headline) == pytest.approx(_by_day(quiet.headline), abs=1e-12)
        assert other.coin_base_level == pytest.approx(quiet.coin_base_level, abs=1e-12)


def test_no_close_for_the_latest_completed_day_refuses_anchor_unpriced() -> None:
    # Pre-fix: no two-segment construction exists on origin/main; the derive refuses the account.
    assert _build(closes=_closes(drop=(LATEST,))) == SWITCH_ANCHOR_UNPRICED == "switch_anchor_unpriced"


def test_no_close_for_the_switch_day_refuses_switch_day_unpriced() -> None:
    # Pre-fix: no two-segment construction exists on origin/main; the derive refuses the account.
    assert _build(closes=_closes(drop=(S,))) == "switch_day_unpriced"


def test_an_unusable_close_for_the_switch_day_is_as_missing_as_an_absent_one() -> None:
    # Pre-fix: no two-segment construction exists on origin/main (T-256-10: never a neighbour's close).
    for bad in (0.0, -1.0, float("nan"), float("inf")):
        by_day = dict(CLOSE_BY_DAY)
        by_day[S] = bad
        assert _build(closes=_closes(by_day)) == "switch_day_unpriced", bad


def test_a_funding_row_after_the_switch_on_an_unpriced_day_is_left_out_and_the_day_is_named() -> None:
    """WR-02. Pre-fix a funding row on a day with no close refused the whole account permanently
    (``coin_segment_unpriced``) while a coin amount on the same day passed. It is left out (never
    priced at a neighbour's close, T-256-10) and the day is named; the account is kept."""
    funding = [{"timestamp": datetime(2026, 11, 22, 8, tzinfo=timezone.utc), "amount": 5.0}]
    result = _ok(_build(funding_rows=funding, closes=_closes(drop=("2026-11-22",))))
    assert "2026-11-22" in result.unpriced_days
    assert "2026-11-22" not in _iso(result.headline.index)
    plain = _ok(_build(closes=_closes(drop=("2026-11-22",))))
    assert _by_day(result.coin_day_pnl) == pytest.approx(_by_day(plain.coin_day_pnl), abs=1e-15)


def test_a_flow_after_the_switch_on_an_unpriced_day_still_refuses_by_name() -> None:
    """A deposit or withdrawal cannot be left out without shifting every earlier level, so it keeps
    its named refusal (reported as not fixed by WR-02)."""
    flow = [ExternalFlow("2026-11-22", 9200.0)]
    assert (
        _build(external_flows=flow, closes=_closes(drop=("2026-11-22",))) == "coin_segment_unpriced"
    )


def test_a_coin_with_no_floors_row_refuses_before_any_arithmetic() -> None:
    # Pre-fix: no two-segment construction exists on origin/main; the derive refuses the account.
    eth = UnitSwitch(coin="ETH", last_usd_day=S, first_coin_return_day=FIRST_COIN_DAY)
    # The closes are empty: reaching the anchor lookup would return switch_anchor_unpriced instead.
    assert _build(switch=eth, closes=_closes({})) == "coin_without_price_source"


def test_every_refusal_is_a_token_of_the_closed_set() -> None:
    # Pre-fix: no two-segment construction exists on origin/main; the derive refuses the account.
    refusals = [
        _build(closes=_closes(drop=(LATEST,))),
        _build(closes=_closes(drop=(S,))),
        _build(
            external_flows=[ExternalFlow("2026-11-22", 1.0)],
            closes=_closes(drop=("2026-11-22",)),
        ),
        _build(switch=UnitSwitch("ETH", S, FIRST_COIN_DAY)),
    ]
    allowed = UNIT_SWITCH_REFUSALS | {SWITCH_ANCHOR_UNPRICED}
    for refusal in refusals:
        assert isinstance(refusal, str) and refusal in allowed


def test_a_usd_deposit_after_the_switch_is_a_coin_flow_and_its_day_is_flow_neutral() -> None:
    # Pre-fix: no two-segment construction exists on origin/main; the derive refuses the account.
    flow_day = "2026-11-22"
    result = _ok(_build(external_flows=[ExternalFlow(flow_day, 9200.0)]))
    assert result.coin_flow_by_day == {flow_day: pytest.approx(0.1)}  # 9200 / 92000

    # Hand-computed: terminal 2.0 at 11-26, no P&L after 11-20, the 0.1 deposit on 11-22, so
    # L(21) = L(20) = 1.9, L(19) = 1.9 + 0.0009 = 1.9009 (the base level).
    assert result.coin_base_level == pytest.approx(1.9009, abs=1e-12)
    # The deposit day books its real P&L (none), never the deposit itself.
    assert result.coin_returns.loc[pd.Timestamp(flow_day)] == pytest.approx(0.0, abs=1e-15)
    assert result.coin_returns.loc[pd.Timestamp("2026-11-20")] == pytest.approx(
        -0.0009 / 1.9009, abs=1e-12
    )
    # Chain-linked over the coin segment: 1 - 0.0009 / 1.9009, the deposit contributing nothing.
    chained = 1.0
    for value in result.coin_returns:
        chained *= 1.0 + float(value)
    assert chained == pytest.approx(1.0 - 0.0009 / 1.9009, abs=1e-12)
    # And the headline on that day is the pure price move.
    assert _by_day(result.headline)[flow_day] == pytest.approx(
        CLOSE_BY_DAY[flow_day] / CLOSE_BY_DAY[_prev(flow_day)] - 1.0, abs=1e-12
    )


def test_a_deposit_on_or_before_the_switch_day_stays_in_the_usd_segment() -> None:
    # Pre-fix: no two-segment construction exists on origin/main; the derive refuses the account.
    result = _ok(_build(external_flows=[ExternalFlow("2026-11-12", 1000.0)]))
    assert result.coin_flow_by_day == {}
    assert result.coin_base_level == pytest.approx(2.0009, abs=1e-12)  # the coin side is untouched
    # USD identity with the flow: L(11) = L(12) - 900 - 1000; the deposit day's return is its P&L only.
    terminal = result.coin_base_level * CLOSE_BY_DAY[S]
    nav = {S: terminal}
    nav["2026-11-13"] = nav[S] - (-108.0) - 0.0  # 11-14 pnl -108
    nav["2026-11-12"] = nav["2026-11-13"]
    nav["2026-11-11"] = nav["2026-11-12"] - 900.0 - 1000.0
    nav["2026-11-10"] = nav["2026-11-11"]
    assert result.usd_returns.loc[pd.Timestamp("2026-11-12")] == pytest.approx(
        900.0 / nav["2026-11-11"], abs=1e-12
    )
    assert result.usd_returns.loc[pd.Timestamp(S)] == pytest.approx(-108.0 / nav["2026-11-13"], abs=1e-12)


def test_funding_after_the_switch_is_a_coin_pnl_at_its_own_days_close() -> None:
    # Pre-fix: no two-segment construction exists on origin/main; the derive refuses the account.
    funding = [
        {"timestamp": datetime(2026, 11, 22, 8, tzinfo=timezone.utc), "amount": 92.0},
        {"timestamp": datetime(2026, 11, 11, 8, tzinfo=timezone.utc), "amount": 5.0},
    ]
    result = _ok(_build(funding_rows=funding))
    assert _by_day(result.coin_day_pnl)["2026-11-22"] == pytest.approx(0.001)  # 92 / 92000
    # The 11-11 row is a USD amount on a USD day: it moves the USD returns, not the coin ones.
    assert sum(_by_day(result.coin_day_pnl).values()) == pytest.approx(-0.0009 + 0.001, abs=1e-15)
    base = _ok(_build())
    assert result.usd_returns.loc[pd.Timestamp("2026-11-11")] != base.usd_returns.loc[pd.Timestamp("2026-11-11")]


def test_a_split_day_on_the_wrong_side_of_the_switch_is_a_contract_breach() -> None:
    # Pre-fix: no two-segment construction exists on origin/main (a programming error, not a data state).
    with pytest.raises(ValueError):
        _build(split=SplitPnl(usd_by_day={"2026-11-16": 1.0}, coin_by_day={}))
    with pytest.raises(ValueError):
        _build(split=SplitPnl(usd_by_day={}, coin_by_day={S: 0.0001}))


def test_a_coin_pnl_day_after_the_latest_completed_day_extends_the_native_segment_and_is_unpriced() -> None:
    # Pre-fix: no two-segment construction exists on the base branch. Pinned so the behaviour plans
    # 06 and 09 inherit is stated: the engine anchors the terminal at the LAST P&L day, so a row
    # dated after the latest completed day moves the anchor day and extends the native levels past
    # it, while the headline stops at the last priced day and the extra day is named.
    today = "2026-11-27"
    split = SplitPnl(
        usd_by_day=_founder_split().usd_by_day, coin_by_day={"2026-11-20": -0.0009, today: 0.0005}
    )
    result = _ok(_build(split=split))
    assert _iso(result.coin_nav_levels.index)[-1] == today
    assert float(result.coin_nav_levels.loc[pd.Timestamp(today)]) == pytest.approx(2.0, abs=1e-15)
    assert today not in _iso(result.headline.index)
    assert result.unpriced_days == (today,)


def test_a_flow_after_the_latest_completed_day_refuses_and_a_funding_row_is_left_out() -> None:
    # No close can exist for a day that has not completed, so a flow there cannot be expressed in
    # the coin (the derive does not hand this builder rows dated after the latest completed day), and
    # a funding row there is left out like any unpriced funding row (WR-02).
    today = "2026-11-27"
    funding = [{"timestamp": datetime(2026, 11, 27, 1, tzinfo=timezone.utc), "amount": 5.0}]
    result = _ok(_build(funding_rows=funding))
    assert today not in _iso(result.coin_nav_levels.index)
    assert _build(external_flows=[ExternalFlow(today, 100.0)]) == "coin_segment_unpriced"


def test_meta_carries_the_coin_segments_guard_flags_but_never_its_coin_valued_annotations() -> None:
    # Pre-fix: no two-segment construction exists on the base branch. A guard fired only on the coin
    # segment must reach the stored meta (the derive would otherwise publish a warned series as
    # clean); a coin-valued annotation must not (a coin NAV beside USD figures is a mixed unit).
    usd = {
        "used_heuristic_capital": False,
        "balance_error": False,
        "computation_status_hint": "complete",
        "series_completeness": "fill_derived_unproven",
    }
    coin = {
        "used_heuristic_capital": False,
        "balance_error": False,
        "computation_status_hint": "complete_with_warnings",
        "dust_nav_guard": True,
        "small_base_measured": True,
        "small_base_measured_min_nav": 0.5,
    }
    merged = _merge_meta(usd, coin)
    assert merged["dust_nav_guard"] is True
    assert merged["computation_status_hint"] == "complete_with_warnings"
    assert "small_base_measured_min_nav" not in merged and "small_base_measured" not in merged
    assert _merge_meta(usd, {"computation_status_hint": "complete"})["computation_status_hint"] == "complete"
    # With no USD segment the status keys still exist, so the derive reads one shape.
    assert _merge_meta({}, {"computation_status_hint": "complete", "series_completeness": "x"})[
        "used_heuristic_capital"
    ] is False


# --- WR-02: the coin level is carried across a day with no close (strategy mode) ----------------------


def _native_factor(result: SwitchedSeries, days: list[str]) -> float:
    by_day = _by_day(result.coin_returns)
    factor = 1.0
    for day in days:
        factor *= 1.0 + by_day[day]
    return factor


def test_a_hole_is_carried_by_the_next_priced_day_so_no_return_is_lost_and_no_chain_breaks() -> None:
    """WR-02. Close missing on 11-18. The default (key mode) keeps the hole: 11-18 and 11-19 both
    absent. Strategy mode carries the coin level across it: only 11-18 has no row of its own, and
    11-19 holds the compounded native returns of 11-18 and 11-19 times close(11-19) / close(11-17),
    restated here from the inputs (an independent oracle, not the builder's own arithmetic)."""
    closes = _closes(drop=("2026-11-18",))
    held = _ok(_build(closes=closes))
    spanned = _ok(_build(closes=closes, span_unpriced_days=True))
    assert "2026-11-19" not in _iso(held.headline.index)
    days = _iso(spanned.headline.index)
    assert "2026-11-18" not in days and "2026-11-19" in days
    assert spanned.unpriced_days == ("2026-11-18",)
    expected = (
        _native_factor(spanned, ["2026-11-18", "2026-11-19"])
        * CLOSE_BY_DAY["2026-11-19"]
        / CLOSE_BY_DAY["2026-11-17"]
        - 1.0
    )
    assert _by_day(spanned.headline)["2026-11-19"] == pytest.approx(expected, abs=1e-12)
    # Every other day is untouched, and the USD segment and the native coin segment are identical.
    for day in days:
        if day != "2026-11-19":
            assert _by_day(spanned.headline)[day] == pytest.approx(_by_day(held.headline)[day], abs=1e-12)
    assert _by_day(spanned.coin_returns) == pytest.approx(_by_day(held.coin_returns), abs=1e-15)


def test_without_a_hole_the_spanning_conversion_is_the_plain_conversion() -> None:
    plain = _ok(_build())
    spanned = _ok(_build(span_unpriced_days=True))
    assert _by_day(spanned.headline) == pytest.approx(_by_day(plain.headline), abs=1e-15)
    assert spanned.unpriced_days == plain.unpriced_days == ()


def test_a_run_of_two_holes_is_carried_by_the_next_priced_day() -> None:
    """A run of two holes (11-18 and 11-19) is carried by 11-20 across all three native days."""
    closes = _closes(drop=("2026-11-18", "2026-11-19"))
    spanned = _ok(_build(closes=closes, span_unpriced_days=True))
    assert spanned.unpriced_days == ("2026-11-18", "2026-11-19")
    expected = (
        _native_factor(spanned, ["2026-11-18", "2026-11-19", "2026-11-20"])
        * CLOSE_BY_DAY["2026-11-20"]
        / CLOSE_BY_DAY["2026-11-17"]
        - 1.0
    )
    assert _by_day(spanned.headline)["2026-11-20"] == pytest.approx(expected, abs=1e-12)


# --- CR-02: S older than the window the bills read covers -----------------------------------------


def test_a_switch_older_than_the_bills_window_rebuilds_only_the_days_the_window_covers() -> None:
    """CR-02. The switch persists after its coin bills age out, so S (11-14) can be older than the
    first day the bills read covers (11-18). The coin days 11-15..11-17 have no P&L the read can
    see: rebuilding them gives zero-return rows that overwrite the stored real ones. The coin
    segment is based on 11-17, the USD segment (all of it before the window) is not rebuilt, and no
    day before 11-18 is in the headline."""
    split = SplitPnl(usd_by_day={}, coin_by_day={"2026-11-20": -0.0009})
    result = _ok(_build(split=split, bills_from_day="2026-11-18"))
    assert result.coin_base_day == "2026-11-17"
    assert _iso(result.coin_returns.index)[0] == "2026-11-18"
    assert result.usd_returns.empty
    assert min(_iso(result.headline.index)) == "2026-11-18"
    # The window's own days equal the same days of a build whose window starts at S: the base moved,
    # the levels at and after it did not.
    full = _ok(_build(split=SplitPnl(usd_by_day={}, coin_by_day={"2026-11-20": -0.0009})))
    for day, value in _by_day(result.coin_returns).items():
        assert value == pytest.approx(_by_day(full.coin_returns)[day], abs=1e-12)


def test_a_switch_inside_the_window_is_built_as_before() -> None:
    plain = _ok(_build())
    inside = _ok(_build(bills_from_day="2026-11-01"))
    assert inside.coin_base_day == S
    assert _by_day(inside.headline) == pytest.approx(_by_day(plain.headline), abs=1e-15)


# --- R2-02: the held coin's price move on the mixed days is in no bill ----------------------------
#
# Founder ruling "Move switch to coin majority": the mixed days are USD days. The coin held on them
# (75% of the account) moves in price every day, but no bill carries that move, so the USD segment
# rolled back from the true equity at S over the booked P&L alone leaves every earlier level too high
# by the coin's whole unbooked gain, and every earlier return too low. The stored marks are the true
# USD levels: the segment is anchored at the earliest mark instead, and a mixed day no mark covers is
# withheld by name.

_R2_S = "2026-11-20"
_R2_SWITCH = UnitSwitch(coin="BTC", last_usd_day=_R2_S, first_coin_return_day="2026-11-21")
_R2_FIRST_COIN_BILL = "2026-11-14"  # the day the coin first shows in the bills (mixed days follow it)
_R2_C0 = 90000.0
_R2_STABLE_PNL = 100.0


def _r2_close(day: int) -> float:
    """BTC rises 1.67% a day from 11-14 to 11-19, flat afterwards (and before)."""
    return _R2_C0 * 1.0167 ** (min(max(day, 14), 19) - 14)


def _r2_closes() -> pd.Series:
    return _closes({f"2026-11-{n:02d}": _r2_close(n) for n in range(1, 27)})


def _r2_true_nav(day: int) -> float:
    """The TRUE USD NAV at the end of ``day``: 10,000 at the end of 11-13 and +100 stable P&L a day;
    from the end of 11-14, 75% of that day's NAV is BTC (bought with cash, so no jump), which then
    follows the close. Written from the scenario, never read back from the builder."""
    if day <= 13:
        return 10000.0 - _R2_STABLE_PNL * (13 - day)
    nav14 = 10000.0 + _R2_STABLE_PNL
    qty = 0.75 * nav14 / _r2_close(14)
    cash = 0.25 * nav14 + _R2_STABLE_PNL * (day - 14)
    return cash + qty * _r2_close(day)


def _r2_build(**overrides: Any) -> SwitchedSeries | str:
    split = SplitPnl(
        usd_by_day={f"2026-11-{n:02d}": _R2_STABLE_PNL for n in range(6, 21)}, coin_by_day={}
    )
    kwargs: dict[str, Any] = {
        "switch": _R2_SWITCH,
        "split": split,
        # The live equity is the true NAV at S; the price is the flat close of S, so the coin base
        # level times the close of S is exactly that NAV.
        "anchor_usd": _r2_true_nav(20),
        "anchor_price": _r2_close(26),
        "closes": _r2_closes(),
    }
    kwargs.update(overrides)
    return _build(**kwargs)


def _r2_marks(first: int, last: int = 20) -> dict[str, float]:
    return {f"2026-11-{n:02d}": _r2_true_nav(n) for n in range(first, last + 1)}


def test_with_marks_an_early_usd_day_equals_its_true_return() -> None:
    """The reviewer's case: 11-10 is +1.0417% true (100 / 9600). Rolled back from the true equity at
    S over the booked P&L alone it read +0.9492%. Anchored at the stored mark of 11-13 it is exact,
    and so is every day through the mark's own day."""
    result = _ok(_r2_build(usd_marks=_r2_marks(13), mixed_from_day=_R2_FIRST_COIN_BILL))
    usd = _by_day(result.usd_returns)
    assert usd["2026-11-10"] == pytest.approx(100.0 / 9600.0, abs=1e-12)
    assert usd["2026-11-12"] == pytest.approx(100.0 / 9800.0, abs=1e-12)
    assert usd["2026-11-13"] == pytest.approx(100.0 / 9900.0, abs=1e-12)
    # Every mixed day is still a day of the segment (the marks block replaces them), none withheld.
    assert all(pd.notna(usd[f"2026-11-{n:02d}"]) for n in range(14, 21))
    assert result.unpriced_days == ()


def test_without_marks_the_mixed_days_are_withheld_by_name_not_read_as_zero() -> None:
    """No mark covers the mixed days 11-15..11-20 (the coin was first booked on 11-14): their
    returns are left out and named, never published from bills that omit the coin's price move. A
    day on or before the first coin bill keeps its figure."""
    result = _ok(_r2_build(mixed_from_day=_R2_FIRST_COIN_BILL))
    usd = _by_day(result.usd_returns)
    mixed = [f"2026-11-{n:02d}" for n in range(15, 21)]
    for day in mixed:
        assert pd.isna(usd[day]), day
    assert pd.notna(usd["2026-11-14"]) and pd.notna(usd["2026-11-10"])
    assert result.unpriced_days == tuple(mixed)


def test_marks_that_begin_inside_the_mixed_days_withhold_only_the_days_before_them() -> None:
    """The first mark is 11-17: 11-15 and 11-16 have no mark before them, so they are withheld;
    11-17 on is the marks block's."""
    result = _ok(_r2_build(usd_marks=_r2_marks(17), mixed_from_day=_R2_FIRST_COIN_BILL))
    usd = _by_day(result.usd_returns)
    assert pd.isna(usd["2026-11-15"]) and pd.isna(usd["2026-11-16"])
    assert pd.notna(usd["2026-11-17"]) and pd.notna(usd["2026-11-20"])
    assert result.unpriced_days == ("2026-11-15", "2026-11-16")


def test_a_build_with_no_marks_and_no_mixed_start_withholds_nothing() -> None:
    """Both kwargs default to absent (an account with no coin bill before S, or a persisted switch
    whose bills aged out): nothing is withheld."""
    built = _ok(_r2_build())
    assert built.unpriced_days == ()
    assert bool(built.usd_returns.notna().all())
