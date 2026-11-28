"""Phase 256 OKXUNITSWITCH plan 01 — the unit-switch seam: when did an account move from its
stable unit into a coin, and how is its daily P&L split at that day.

ORACLE DISCIPLINE: every expected day and amount below is a literal written from the phase
CONTEXT and RESEARCH ("Switch rule", "Boundary day"), never read back from the module under test.
The day-accounting invariant (every input day lands in exactly one unit) is computed here from the
INPUTS, so it does not share a code path with the splitter.

Clocks (RESEARCH "Switch rule"): a bill is bucketed by its UTC day; a holdings row stamped
``asof D`` is written about 01:00Z on D, so it describes the END of UTC day D - 1. Every fixture
below states its holdings as end-of-day values and ``_rows`` stamps them one day later, which is
the shape the table really has.

Fixtures use round illustrative values only (T-256-02): no real amount or account figure.

This module imports only ``services.unit_switch`` (a leaf; stdlib + price_rule), so it stays
importable on a pandera-less local environment.

Run: cd analytics-service && python3 -m pytest tests/test_unit_switch.py -x
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from services.unit_switch import (
    COIN_LEAD_TOLERANCE_DAYS,
    UNIT_SWITCH_REFUSALS,
    SplitPnl,
    UnitSwitch,
    derive_unit_switch,
    end_of_day_holdings_from_rows,
    split_daily_pnl_at_switch,
)

# ---------------------------------------------------------------------------
# Fixture builders. Holdings are written as END-OF-DAY values, stamped asof + 1.
# ---------------------------------------------------------------------------


def _plus(day: str, n: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()


def _rows(eod: dict[str, dict[str, float]], holding_type: str = "spot") -> list[dict[str, object]]:
    """Raw allocator_holdings-shaped rows: end-of-day D is stamped ``asof`` D + 1."""
    return [
        {"asof": _plus(day, 1), "holding_type": holding_type, "symbol": symbol, "value_usd": value}
        for day, values in eod.items()
        for symbol, value in values.items()
    ]


def _eod(rows: list[dict[str, object]]) -> list[tuple[str, dict[str, float]]]:
    return [(day, dict(values)) for day, values in end_of_day_holdings_from_rows(rows)]


def _span(first: str, last: str, values: dict[str, float]) -> dict[str, dict[str, float]]:
    """The same end-of-day values on every day from ``first`` to ``last`` inclusive."""
    out: dict[str, dict[str, float]] = {}
    day = first
    while day <= last:
        out[day] = dict(values)
        day = _plus(day, 1)
    return out


STABLE_ONLY = {"USDT": 1000.0}
BTC_75 = {"BTC": 750.0, "USDT": 250.0}  # 75 % coin
BTC_25 = {"BTC": 250.0, "USDT": 750.0}  # 25 % coin: still a stable majority
BTC_997 = {"BTC": 997.0, "USDT": 3.0}  # 99.7 % coin


def _founder_shape() -> dict[str, dict[str, float]]:
    """All stable through the end of 2026-11-13, about 75 % BTC from the end of 11-14, about 99.7 %
    from the end of 11-20 (RESEARCH "Bills finding": the measured shape, holdings asof 11-15 and asof
    11-21). The 75 % days are NOT the switch: the founder ruling needs the coin at 95 % and staying."""
    eod: dict[str, dict[str, float]] = {}
    eod.update(_span("2026-11-11", "2026-11-13", STABLE_ONLY))
    eod.update(_span("2026-11-14", "2026-11-19", BTC_75))
    eod.update(_span("2026-11-20", "2026-11-21", BTC_997))
    return eod


# ---------------------------------------------------------------------------
# Tracer: the founder-shaped account derives its own switch, end to end
# ---------------------------------------------------------------------------


def test_founder_shaped_account_derives_its_switch_from_data() -> None:
    """Founder rulings 2026-11-27 ("Move switch to coin majority", then R2-01 "95% coin and stays").
    On the MEASURED shape the end-of-day holdings are 75 % BTC from 11-14 and 99.7 % from 11-20. At a
    50 % threshold S would be 11-14 (the six mixed days booked as coin); the ruling needs the coin
    at 95 % or more and staying, so S is 11-20 and the first coin return day is 11-21, the date the
    ruling names."""
    census = {"BTC": ("2026-11-14", 11)}
    holdings = _eod(_rows(_founder_shape()))
    assert derive_unit_switch(census, holdings, None) == UnitSwitch(
        coin="BTC", last_usd_day="2026-11-20", first_coin_return_day="2026-11-21"
    )


def test_a_mixed_account_is_not_booked_as_coin_from_its_first_buy() -> None:
    """The CR-01 arm. 75 % BTC held for six days after the first coin bill: S must not be the bill
    day. Neutered to the old ``min(first bill, first majority)`` rule this returns 11-14."""
    census = {"BTC": ("2026-11-14", 3)}
    holdings = _eod(_rows(_founder_shape()))
    result = derive_unit_switch(census, holdings, {"BTC": 0.997, "USDT": 0.003})
    assert isinstance(result, UnitSwitch)
    assert result.last_usd_day > "2026-11-19", "a stable-majority day was made a coin day"


def test_a_75_percent_coin_account_does_not_switch_at_75_percent() -> None:
    """R2-01 (founder: "95% coin and stays"). An account that holds 75 % BTC for good is not yet a
    coin account: no end of day reaches the threshold, so there is no switch. Under the old 50 %
    rule this returned a switch at the first 75 % day, so this arm is RED there."""
    census = {"BTC": ("2026-11-14", 5)}
    eod = _span("2026-11-11", "2026-11-13", STABLE_ONLY)
    eod.update(_span("2026-11-14", "2026-11-26", BTC_75))
    assert derive_unit_switch(census, _eod(_rows(eod)), {"BTC": 0.75, "USDT": 0.25}) == (
        "coin_bills_without_majority"
    )


def test_the_threshold_is_inclusive_at_95_percent() -> None:
    census = {"BTC": ("2026-11-14", 5)}
    at = {"BTC": 950.0, "USDT": 50.0}
    eod = _span("2026-11-11", "2026-11-13", STABLE_ONLY)
    eod.update(_span("2026-11-14", "2026-11-20", at))
    assert derive_unit_switch(census, _eod(_rows(eod)), None) == UnitSwitch(
        coin="BTC", last_usd_day="2026-11-14", first_coin_return_day="2026-11-15"
    )


def test_a_short_dip_after_the_first_majority_day_does_not_move_the_switch() -> None:
    """R3-03 (founder: "<50% for 7 days"). The coin reaches 95 %, falls to 25 % for two days, then
    is back: two days is not a switch back, so S stays the FIRST day at 95 %. Pre-fix S moved to the
    start of the last run (03-07), so the earlier days of the coin segment were booked as USD."""
    eod = _span("2026-03-01", "2026-03-02", STABLE_ONLY)
    eod.update(_span("2026-03-03", "2026-03-04", BTC_997))
    eod.update(_span("2026-03-05", "2026-03-06", BTC_25))
    eod.update(_span("2026-03-07", "2026-03-10", BTC_997))
    census = {"BTC": ("2026-03-03", 4)}
    assert derive_unit_switch(census, _eod(_rows(eod)), None) == UnitSwitch(
        coin="BTC", last_usd_day="2026-03-03", first_coin_return_day="2026-03-04"
    )


def test_differently_shaped_account_derives_its_own_dates() -> None:
    """A 40-day-earlier gradual mover: coin bills from 10-02, BTC 40 % at the end of 10-02,
    96 % at the end of 10-03, 99 % at the end of 10-04. No date is a constant: the same
    function gives THIS account's dates. S is the first majority day that stays (10-03), not the
    first coin bill day (10-02), which precedes it by one day and is inside the tolerance."""
    eod = {
        "2026-09-30": {"USDT": 1000.0},
        "2026-10-01": {"USDT": 1000.0},
        "2026-10-02": {"BTC": 400.0, "USDT": 600.0},
        "2026-10-03": {"BTC": 960.0, "USDT": 40.0},
        "2026-10-04": {"BTC": 990.0, "USDT": 10.0},
        "2026-10-05": {"BTC": 990.0, "USDT": 10.0},
    }
    census = {"BTC": ("2026-10-02", 3)}
    assert derive_unit_switch(census, _eod(_rows(eod)), None) == UnitSwitch(
        coin="BTC", last_usd_day="2026-10-03", first_coin_return_day="2026-10-04"
    )


def test_majority_before_the_first_bill_pins_s_to_the_majority_day() -> None:
    """When the coin is already the majority at the end of day M and the first coin bill is
    later, S is M (the earlier evidence) and the end of M - 1 is observed as stable."""
    eod = {
        "2026-03-01": STABLE_ONLY,
        "2026-03-02": STABLE_ONLY,
        "2026-03-03": BTC_997,
        "2026-03-04": BTC_997,
        "2026-03-05": BTC_997,
        "2026-03-06": BTC_997,
    }
    census = {"BTC": ("2026-03-05", 2)}
    assert derive_unit_switch(census, _eod(_rows(eod)), None) == UnitSwitch(
        coin="BTC", last_usd_day="2026-03-03", first_coin_return_day="2026-03-04"
    )


def test_coin_code_is_upper_cased_before_use() -> None:
    """T-256-01: the census coin is third-party text; it is validated and upper-cased."""
    eod = _span("2026-04-01", "2026-04-02", STABLE_ONLY)
    eod.update(_span("2026-04-03", "2026-04-06", BTC_997))
    result = derive_unit_switch({"btc": ("2026-04-03", 2)}, _eod(_rows(eod)), None)
    assert isinstance(result, UnitSwitch)
    assert result.coin == "BTC"


# ---------------------------------------------------------------------------
# The holdings normaliser: asof D is the end of day D - 1
# ---------------------------------------------------------------------------


def test_asof_row_describes_the_end_of_the_previous_utc_day() -> None:
    """A row stamped asof 11-15 is the end-of-day state of 11-14 (rows are written about 01:00Z
    on their asof). Mixing the two clocks un-normalised puts S one day off."""
    rows: list[dict[str, object]] = [
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "BTC", "value_usd": 750.0},
    ]
    assert _eod(rows) == [("2026-11-14", {"BTC": 750.0})]


def test_derivative_rows_are_excluded_from_shares() -> None:
    """A swap leg is not a held coin balance; it must not dilute or inflate a coin share."""
    rows: list[dict[str, object]] = [
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "USDT", "value_usd": 100.0},
        {"asof": "2026-11-15", "holding_type": "swap", "symbol": "ETH-USDT-SWAP", "value_usd": 9e6},
        {"asof": "2026-11-15", "holding_type": "perp", "symbol": "BTC", "value_usd": 9e6},
    ]
    assert _eod(rows) == [("2026-11-14", {"USDT": 100.0})]


def test_values_are_summed_per_symbol_per_day_and_symbols_upper_cased() -> None:
    rows: list[dict[str, object]] = [
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "btc", "value_usd": 100.0},
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "BTC", "value_usd": 50.0},
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "USDT", "value_usd": 25.0},
    ]
    assert _eod(rows) == [("2026-11-14", {"BTC": 150.0, "USDT": 25.0})]


def test_days_are_returned_ascending_whatever_the_input_order() -> None:
    rows: list[dict[str, object]] = [
        {"asof": "2026-11-17", "holding_type": "spot", "symbol": "BTC", "value_usd": 3.0},
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "BTC", "value_usd": 1.0},
        {"asof": "2026-11-16", "holding_type": "spot", "symbol": "BTC", "value_usd": 2.0},
    ]
    assert [day for day, _ in end_of_day_holdings_from_rows(rows)] == [
        "2026-11-14",
        "2026-11-15",
        "2026-11-16",
    ]


@pytest.mark.parametrize(
    "bad",
    [
        {"asof": "not-a-date", "holding_type": "spot", "symbol": "BTC", "value_usd": 1.0},
        {"asof": None, "holding_type": "spot", "symbol": "BTC", "value_usd": 1.0},
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "BTC", "value_usd": "x"},
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "BTC", "value_usd": None},
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "BTC", "value_usd": float("nan")},
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "BTC", "value_usd": float("inf")},
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "BTC", "value_usd": -1.0},
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": "", "value_usd": 1.0},
        {"asof": "2026-11-15", "holding_type": "spot", "symbol": 7, "value_usd": 1.0},
    ],
)
def test_unparseable_rows_are_skipped_not_guessed(bad: dict[str, object]) -> None:
    """The shares are computed from what parses. A bad row never becomes a zero or a default."""
    good: dict[str, object] = {
        "asof": "2026-11-16",
        "holding_type": "spot",
        "symbol": "USDT",
        "value_usd": 10.0,
    }
    assert _eod([bad, good]) == [("2026-11-15", {"USDT": 10.0})]


def test_tolerance_constant_is_the_decided_value() -> None:
    """CONTEXT "Decided autonomously": COIN_LEAD_TOLERANCE_DAYS = 14."""
    assert COIN_LEAD_TOLERANCE_DAYS == 14


# ---------------------------------------------------------------------------
# Task 2: every missing or ambiguous case refuses by a closed token. One named case per
# behaviour; the membership test at the end runs over all of them.
# ---------------------------------------------------------------------------

Holdings = list[tuple[str, dict[str, float]]]
Case = tuple[dict[str, tuple[str, int]], Holdings, dict[str, float] | None]


def _case_dust_no_bills() -> Case:
    # BTC under 1 % of value on every day for months and no coin bill at all.
    eod = _span("2026-05-01", "2026-07-30", {"BTC": 5.0, "USDT": 995.0})
    return {}, _eod(_rows(eod)), None


def _case_dust_with_bills() -> Case:
    eod = _span("2026-05-01", "2026-07-30", {"BTC": 5.0, "USDT": 995.0})
    return {"BTC": ("2026-06-10", 2)}, _eod(_rows(eod)), None


def _case_switch_back() -> Case:
    # Coin majority from 08-03, then a later end of day is stable-majority again: a second switch.
    eod = _span("2026-08-01", "2026-08-02", STABLE_ONLY)
    eod.update(_span("2026-08-03", "2026-08-06", BTC_997))
    eod.update(_span("2026-08-07", "2026-08-13", {"BTC": 200.0, "USDT": 800.0}))
    return {"BTC": ("2026-08-03", 4)}, _eod(_rows(eod)), None


def _case_latest_observation_no_longer_coin() -> Case:
    # The coin share is 45 % on seven consecutive end-of-days WITHOUT a stable majority (the rest is
    # a third coin): the account is no longer in the coin, so the switch is not stated.
    eod = _span("2026-08-01", "2026-08-02", STABLE_ONLY)
    eod.update(_span("2026-08-03", "2026-08-05", BTC_997))
    eod.update(_span("2026-08-06", "2026-08-12", {"BTC": 450.0, "USDT": 450.0, "ETH": 100.0}))
    return {"BTC": ("2026-08-03", 3)}, _eod(_rows(eod)), None


def _case_gap_at_first_majority_day() -> Case:
    # The first holdings day is already the coin majority and the coin bill is later: S would come
    # from the holdings, and the end of the day before it was never observed.
    eod = _span("2026-09-03", "2026-09-08", BTC_997)
    return {"BTC": ("2026-09-06", 2)}, _eod(_rows(eod)), None


def _case_gap_of_days_before_majority() -> Case:
    eod = {"2026-09-01": STABLE_ONLY}  # nothing observed on 09-02 or 09-03
    eod.update(_span("2026-09-04", "2026-09-08", BTC_997))
    return {"BTC": ("2026-09-06", 2)}, _eod(_rows(eod)), None


def _case_bills_only_live_balance() -> Case:
    return {"BTC": ("2026-11-14", 3)}, [], {"BTC": 0.97, "USDT": 0.03}


def _case_no_holdings_no_live() -> Case:
    return {"BTC": ("2026-11-14", 3)}, [], None


def _case_live_share_stable_majority() -> Case:
    return {"BTC": ("2026-11-14", 3)}, [], {"BTC": 0.1, "USDT": 0.9}


def _case_live_only_bill_far_before_holdings_end() -> Case:
    # Holdings stable through 11-20; live says coin now; first bill 11-01. The majority cannot be
    # earlier than 11-21, which is 20 days after the bill: beyond the tolerance.
    eod = _span("2026-10-25", "2026-11-20", STABLE_ONLY)
    return {"BTC": ("2026-11-01", 3)}, _eod(_rows(eod)), {"BTC": 0.97, "USDT": 0.03}


def _case_live_only_bill_within_tolerance() -> Case:
    eod = _span("2026-10-25", "2026-11-20", STABLE_ONLY)
    return {"BTC": ("2026-11-10", 3)}, _eod(_rows(eod)), {"BTC": 0.97, "USDT": 0.03}


def _lead_case(lead_days: int) -> Case:
    # Coin bills from 06-01; the first majority end of day is lead_days later.
    majority = _plus("2026-06-01", lead_days)
    eod = _span("2026-05-30", _plus(majority, -1), STABLE_ONLY)
    eod.update(_span(majority, _plus(majority, 3), {"BTC": 990.0, "USDT": 10.0}))
    return {"BTC": ("2026-06-01", 4)}, _eod(_rows(eod)), None


def _case_two_coins_in_census() -> Case:
    eod = _span("2026-05-01", "2026-05-02", STABLE_ONLY)
    eod.update(_span("2026-05-03", "2026-05-06", BTC_997))
    return {"BTC": ("2026-05-03", 2), "ETH": ("2026-05-04", 1)}, _eod(_rows(eod)), None


def _case_majority_coin_differs_from_bill_coin() -> Case:
    eod = _span("2026-05-01", "2026-05-02", STABLE_ONLY)
    eod.update(_span("2026-05-03", "2026-05-06", {"ETH": 900.0, "USDT": 100.0}))
    return {"BTC": ("2026-05-03", 2)}, _eod(_rows(eod)), None


def _case_live_majority_coin_differs_from_bill_coin() -> Case:
    return {"BTC": ("2026-05-03", 2)}, [], {"ETH": 0.9, "USDT": 0.1}


def _case_clean_switch_into_a_coin_without_closes() -> Case:
    eod = _span("2026-05-01", "2026-05-02", STABLE_ONLY)
    eod.update(_span("2026-05-03", "2026-05-06", {"ETH": 750.0, "USDT": 250.0}))
    return {"ETH": ("2026-05-03", 2)}, _eod(_rows(eod)), None


def _case_census_coin_is_a_stable() -> Case:
    return {"USDC": ("2026-05-03", 2)}, [], {"USDC": 1.0}


def _case_census_coin_is_not_a_code() -> Case:
    return {"B!C": ("2026-05-03", 2)}, [], {"BTC": 1.0}


def _case_census_day_is_not_a_day() -> Case:
    return {"BTC": ("not-a-day", 2)}, [], {"BTC": 1.0}


_REFUSAL_CASES: dict[str, tuple[Case, str]] = {
    "dust_no_bills": (_case_dust_no_bills(), "no_coin_evidence"),
    "dust_with_bills": (_case_dust_with_bills(), "coin_bills_without_majority"),
    "switch_back": (_case_switch_back(), "switch_back"),
    "latest_not_coin": (_case_latest_observation_no_longer_coin(), "switch_back"),
    "gap_first_day": (_case_gap_at_first_majority_day(), "ambiguous_boundary"),
    "gap_days": (_case_gap_of_days_before_majority(), "ambiguous_boundary"),
    "no_holdings_no_live": (_case_no_holdings_no_live(), "holdings_unavailable"),
    "no_holdings_live_majority": (_case_bills_only_live_balance(), "holdings_unavailable"),
    "live_stable_majority": (_case_live_share_stable_majority(), "coin_bills_without_majority"),
    "live_majority_after_the_holdings_end": (
        _case_live_only_bill_far_before_holdings_end(),
        "coin_bills_without_majority",
    ),
    "live_majority_after_the_holdings_end_near_bill": (
        _case_live_only_bill_within_tolerance(),
        "coin_bills_without_majority",
    ),
    "lead_15": (_lead_case(15), "bills_precede_majority_beyond_tolerance"),
    "two_coins_census": (_case_two_coins_in_census(), "two_coins"),
    "majority_differs": (_case_majority_coin_differs_from_bill_coin(), "two_coins"),
    "live_majority_differs": (_case_live_majority_coin_differs_from_bill_coin(), "two_coins"),
    "no_price_source": (_case_clean_switch_into_a_coin_without_closes(), "coin_without_price_source"),
    "stable_in_census": (_case_census_coin_is_a_stable(), "no_coin_evidence"),
    "coin_not_a_code": (_case_census_coin_is_not_a_code(), "no_coin_evidence"),
    "day_not_a_day": (_case_census_day_is_not_a_day(), "no_coin_evidence"),
}


def _run(case: Case) -> UnitSwitch | str:
    census, holdings, live = case
    return derive_unit_switch(census, holdings, live)


@pytest.mark.parametrize("name", sorted(_REFUSAL_CASES))
def test_each_refusal_case_returns_its_own_token(name: str) -> None:
    """Pre-fix: ``derive_unit_switch`` does not exist on origin/main, so every one of these accounts
    refuses through the fetch today with the single token ``daily_pnl_non_usd_okx``. Each case here
    names its OWN first failing condition (the order in ``derive_unit_switch``), so a re-ordered
    arm shows up as the wrong token on a named case, not as a generic red."""
    case, expected = _REFUSAL_CASES[name]
    assert _run(case) == expected


def test_dust_coin_with_no_bills_is_no_evidence_not_a_switch() -> None:
    """Pre-fix: no switch is ever derived. A small unrelated coin balance (under 1 % for months)
    with no coin bill is not a switch."""
    assert _run(_case_dust_no_bills()) == "no_coin_evidence"


def test_switch_back_is_refused_by_name_not_designed() -> None:
    """Pre-fix: no switch is derived. CONTEXT Deferred Ideas: a second switch refuses by name."""
    assert _run(_case_switch_back()) == "switch_back"


def test_a_key_with_bills_and_a_live_balance_but_no_holdings_history_refuses_by_name() -> None:
    """SF-01. Pre-fix: with no holdings history the first coin bill alone pinned S, however old,
    so a bill months back set S that far back and rebuilt stable-held days in the coin. Nothing
    says when the coin became the majority, so the switch is not stated."""
    assert _run(_case_bills_only_live_balance()) == "holdings_unavailable"
    long_ago = ({"BTC": ("2026-01-05", 3)}, [], {"BTC": 0.97, "USDT": 0.03})
    assert _run(long_ago) == "holdings_unavailable"


def test_a_live_majority_after_the_last_holdings_day_does_not_pin_the_switch() -> None:
    """Holdings stable through 11-20, live says coin now: the live balance only confirms the coin is
    still held. It cannot say WHEN the majority began, so no switch is stated yet."""
    assert _run(_case_live_only_bill_within_tolerance()) == "coin_bills_without_majority"


def test_tolerance_boundary_is_inclusive_at_14_and_refuses_at_15() -> None:
    """Pre-fix: no tolerance exists. Coin bills on d and the first majority on d + 14 gives
    S = d + 14 (the majority day); on d + 15 it refuses (CONTEXT: COIN_LEAD_TOLERANCE_DAYS = 14)."""
    assert _run(_lead_case(14)) == UnitSwitch(
        coin="BTC", last_usd_day="2026-06-15", first_coin_return_day="2026-06-16"
    )
    assert _run(_lead_case(15)) == "bills_precede_majority_beyond_tolerance"


def test_a_gradual_mover_does_not_refuse() -> None:
    """RESEARCH "Gradual mover": coin fee bills on d with 10 % coin on d, 30 % on d + 1, 99 % on
    d + 2. S is d + 2, the first 95 % day that stays; the fee bills on d and d + 1 are USD-day
    amounts, and d is inside the tolerance, so the gradual mover does not refuse."""
    eod = {
        "2026-07-01": STABLE_ONLY,
        "2026-07-02": {"BTC": 100.0, "USDT": 900.0},
        "2026-07-03": {"BTC": 300.0, "USDT": 700.0},
        "2026-07-04": {"BTC": 990.0, "USDT": 10.0},
        "2026-07-05": {"BTC": 990.0, "USDT": 10.0},
    }
    census = {"BTC": ("2026-07-02", 5)}
    assert derive_unit_switch(census, _eod(_rows(eod)), None) == UnitSwitch(
        coin="BTC", last_usd_day="2026-07-04", first_coin_return_day="2026-07-05"
    )


def test_a_stable_quote_fee_is_not_coin_evidence() -> None:
    """RESEARCH fixture (g): the spot SELL fee is charged in the stable quote, so a census built by
    the fetch from non-stable ``ccy`` only is empty and an account that only ever paid stable fees
    has no coin evidence even when its holdings turn into a coin."""
    eod = _span("2026-05-01", "2026-05-02", STABLE_ONLY)
    eod.update(_span("2026-05-03", "2026-05-06", BTC_997))
    assert derive_unit_switch({}, _eod(_rows(eod)), None) == "no_coin_evidence"


@pytest.mark.parametrize("name", sorted(_REFUSAL_CASES))
def test_every_return_is_a_switch_or_a_member_of_the_closed_set(name: str) -> None:
    """The contract the later plans bind to: nothing but a UnitSwitch or a closed token ever comes
    back, so a reader can map the token to its named failure without a default branch."""
    case, _ = _REFUSAL_CASES[name]
    result = _run(case)
    assert isinstance(result, UnitSwitch) or result in UNIT_SWITCH_REFUSALS


# ---------------------------------------------------------------------------
# CR-02: a switch, once derived, persists (the bills window ages the coin bills out)
# ---------------------------------------------------------------------------

STORED = UnitSwitch(coin="BTC", last_usd_day="2026-11-20", first_coin_return_day="2026-11-21")


def test_a_stored_switch_persists_when_the_bills_window_no_longer_shows_any_coin_bill() -> None:
    """CR-02. The bills read reaches back a fixed window, so 93 days after the last coin bill the
    census is empty. Pre-fix an empty census was ``no_coin_evidence`` and the account read as plain
    USD again (the marker and the two-segment record were cleared)."""
    holdings = _eod(_rows(_founder_shape()))
    assert derive_unit_switch({}, holdings, {"BTC": 0.997, "USDT": 0.003}, prior=STORED) == STORED
    assert derive_unit_switch({}, [], None, prior=STORED) == STORED


def test_a_stored_switch_does_not_move_forward_as_the_first_bill_ages_out() -> None:
    """The census' first bill day moves forward as old bills leave the window; S must not follow it."""
    holdings = _eod(_rows(_founder_shape()))
    aged = {"BTC": ("2026-11-30", 2)}
    assert derive_unit_switch(aged, holdings, None, prior=STORED) == STORED
    assert derive_unit_switch(aged, [], {"BTC": 0.97, "USDT": 0.03}, prior=STORED) == STORED


def test_newer_evidence_still_contradicts_a_stored_switch() -> None:
    holdings = _eod(_rows(_founder_shape()))
    assert derive_unit_switch({"ETH": ("2026-12-01", 1)}, holdings, None, prior=STORED) == "two_coins"
    dropped = _founder_shape()
    dropped.update(_span("2026-11-22", "2026-11-28", BTC_25))
    assert derive_unit_switch({}, _eod(_rows(dropped)), None, prior=STORED) == "switch_back"
    other_coin = _span("2026-11-22", "2026-11-23", {"ETH": 900.0, "USDT": 100.0})
    mixed = _founder_shape()
    mixed.update(other_coin)
    assert derive_unit_switch({}, _eod(_rows(mixed)), None, prior=STORED) == "two_coins"


# ---------------------------------------------------------------------------
# R3-03 (founder ruling 2026-11-27, "<50% for 7 days"): after S a switch back is the coin under 50 %
# of the end-of-day value on seven consecutive days. A dip under 95 %, a short dip under 50 % and a
# single live reading change nothing; 95 % decides only WHEN the switch happens.
# ---------------------------------------------------------------------------

BTC_90 = {"BTC": 900.0, "USDT": 100.0}  # 90 % coin: under the switch share, over half


def _after_s(*segments: tuple[str, str, dict[str, float]]) -> list[tuple[str, dict[str, float]]]:
    shape = _founder_shape()
    for first, last, values in segments:
        shape.update(_span(first, last, values))
    return _eod(_rows(shape))


@pytest.mark.parametrize("prior", [STORED, None])
def test_one_night_at_90_percent_after_s_is_no_refusal(prior: UnitSwitch | None) -> None:
    census = {"BTC": ("2026-11-14", 3)}
    one_night = _after_s(("2026-11-22", "2026-11-22", BTC_90), ("2026-11-23", "2026-11-30", BTC_997))
    assert derive_unit_switch(census, one_night, None, prior=prior) == STORED
    # A dip on the LATEST observed day, not followed by a recovery, is no refusal either.
    trailing = _after_s(("2026-11-22", "2026-11-22", BTC_90))
    assert derive_unit_switch(census, trailing, None, prior=prior) == STORED


@pytest.mark.parametrize("prior", [STORED, None])
def test_six_days_under_half_after_s_is_no_refusal(prior: UnitSwitch | None) -> None:
    census = {"BTC": ("2026-11-14", 3)}
    six = _after_s(("2026-11-22", "2026-11-27", BTC_25))
    assert derive_unit_switch(census, six, None, prior=prior) == STORED
    # Seven days under half, but not consecutive (one day back at 60 % in the middle): no refusal.
    broken = _after_s(
        ("2026-11-22", "2026-11-24", BTC_25),
        ("2026-11-25", "2026-11-25", {"BTC": 600.0, "USDT": 400.0}),
        ("2026-11-26", "2026-11-29", BTC_25),
    )
    assert derive_unit_switch(census, broken, None, prior=prior) == STORED


@pytest.mark.parametrize("prior", [STORED, None])
def test_seven_consecutive_days_under_half_after_s_is_a_switch_back(prior: UnitSwitch | None) -> None:
    census = {"BTC": ("2026-11-14", 3)}
    seven = _after_s(("2026-11-22", "2026-11-28", BTC_25))
    assert derive_unit_switch(census, seven, None, prior=prior) == "switch_back"


@pytest.mark.parametrize("prior", [STORED, None])
def test_a_single_live_reading_under_95_percent_is_no_refusal(prior: UnitSwitch | None) -> None:
    census = {"BTC": ("2026-11-14", 3)}
    holdings = _eod(_rows(_founder_shape()))
    assert derive_unit_switch(census, holdings, {"BTC": 0.9, "USDT": 0.1}, prior=prior) == STORED
    assert derive_unit_switch(census, holdings, {"BTC": 0.1, "USDT": 0.9}, prior=prior) == STORED


# ---------------------------------------------------------------------------
# Task 3: the split books every day in exactly one unit
# ---------------------------------------------------------------------------

SWITCH = UnitSwitch(coin="BTC", last_usd_day="2026-11-14", first_coin_return_day="2026-11-15")
CLOSES = {"2026-11-14": 90000.0, "2026-11-20": 92000.0, "2026-11-21": 92000.0}


def test_boundary_oracle_each_day_is_in_exactly_one_unit() -> None:
    """Pre-fix: no splitter exists; the whole read refuses. Boundary rule (CONTEXT "Boundary day"):
    S = 11-14 is the last USD return day, so a coin fee bill dated S is a USD-day amount valued at
    S's close (-0.0012 * 90000 = -108.0), and the first coin return day is 11-15, so the 11-20 coin
    amount keeps its native value."""
    stable = {"2026-11-12": -50.0, "2026-11-13": 0.0}
    coin = {"2026-11-14": -0.0012, "2026-11-20": -0.0009}
    out = split_daily_pnl_at_switch(stable, coin, SWITCH, CLOSES)
    assert isinstance(out, SplitPnl)
    assert out.usd_by_day == pytest.approx({"2026-11-12": -50.0, "2026-11-13": 0.0, "2026-11-14": -108.0})
    assert out.coin_by_day == pytest.approx({"2026-11-20": -0.0009})
    # Independent invariant, computed from the INPUTS: every input day is in exactly one unit.
    input_days = set(stable) | set(coin)
    assert set(out.usd_by_day) | set(out.coin_by_day) == input_days
    assert set(out.usd_by_day) & set(out.coin_by_day) == set()


def test_a_stable_amount_after_the_switch_is_expressed_in_the_coin_at_that_days_close() -> None:
    """46.0 of stable P&L on 11-21 at a 92000.0 close is 0.0005 coin."""
    out = split_daily_pnl_at_switch({"2026-11-21": 46.0}, {}, SWITCH, CLOSES)
    assert isinstance(out, SplitPnl)
    assert out.usd_by_day == {}
    assert out.coin_by_day == pytest.approx({"2026-11-21": 0.0005})


def test_first_coin_return_day_itself_is_a_coin_day() -> None:
    """S + 1 is the first day measured in the coin: a stable amount on it divides by its close and
    a coin amount keeps its native value, summed into the one coin entry."""
    closes = {"2026-11-15": 100000.0}
    out = split_daily_pnl_at_switch({"2026-11-15": 10.0}, {"2026-11-15": 0.5}, SWITCH, closes)
    assert isinstance(out, SplitPnl)
    assert out.coin_by_day == pytest.approx({"2026-11-15": 0.5001})
    assert out.usd_by_day == {}


def test_stable_and_coin_amounts_on_the_switch_day_sum_in_usd() -> None:
    out = split_daily_pnl_at_switch(
        {"2026-11-14": -20.0}, {"2026-11-14": -0.001}, SWITCH, CLOSES
    )
    assert isinstance(out, SplitPnl)
    assert out.usd_by_day == pytest.approx({"2026-11-14": -110.0})
    assert out.coin_by_day == {}


def test_a_coin_amount_on_the_switch_day_with_no_close_refuses_by_name() -> None:
    """Pre-fix: no splitter. A close for S is the only valid price for S's coin leg."""
    out = split_daily_pnl_at_switch({}, {"2026-11-14": -0.0012}, SWITCH, {"2026-11-20": 92000.0})
    assert out == "switch_day_unpriced"


def test_a_stable_amount_after_the_switch_with_no_close_is_left_out_and_the_account_is_kept() -> None:
    """SF-03. Pre-fix this refused the whole account permanently (``coin_segment_unpriced``) while a
    coin amount on the same unpriced day passed. The amount cannot be expressed in the coin without
    a neighbour's price, so it is left out; the day stays in the coin segment (zero) and the builder
    names it unpriced."""
    out = split_daily_pnl_at_switch({"2026-11-21": 46.0}, {}, SWITCH, {"2026-11-20": 92000.0})
    assert isinstance(out, SplitPnl)
    assert out.coin_by_day == {"2026-11-21": 0.0}
    assert out.usd_by_day == {}


@pytest.mark.parametrize("bad_close", [0.0, -1.0, float("nan"), float("inf")])
def test_an_unusable_close_is_as_missing_as_an_absent_one(bad_close: float) -> None:
    """The usable-close rule of ``native_to_usd``: finite and positive. A close that is not is never
    borrowed from a neighbour day and never treated as 1.0."""
    on_switch = split_daily_pnl_at_switch(
        {}, {"2026-11-14": -0.001}, SWITCH, {"2026-11-14": bad_close, "2026-11-13": 90000.0}
    )
    after = split_daily_pnl_at_switch(
        {"2026-11-21": 5.0}, {}, SWITCH, {"2026-11-21": bad_close, "2026-11-20": 92000.0}
    )
    assert on_switch == "switch_day_unpriced"
    assert isinstance(after, SplitPnl) and after.coin_by_day == {"2026-11-21": 0.0}


def test_a_zero_amount_needs_no_close() -> None:
    """Zero converts to zero in either direction, so a zero day with no close is not a refusal."""
    out = split_daily_pnl_at_switch({"2026-11-21": 0.0}, {"2026-11-14": 0.0}, SWITCH, {})
    assert isinstance(out, SplitPnl)
    assert out.usd_by_day == {"2026-11-14": 0.0}
    assert out.coin_by_day == {"2026-11-21": 0.0}


def test_a_coin_transition_fee_before_the_switch_is_valued_in_usd_at_its_own_days_close() -> None:
    """CR-01. A coin fee bill dated before S (the first buy, while the account was still mostly
    stable) is a USD-segment amount at ITS OWN day's close, never a coin amount. Pre-fix this raised
    ``ValueError`` (contract breach) because the old rule made S the first coin bill."""
    closes = {"2026-11-13": 89000.0, "2026-11-14": 90000.0}
    out = split_daily_pnl_at_switch(
        {"2026-11-13": 10.0}, {"2026-11-13": -0.001, "2026-11-14": -0.002}, SWITCH, closes
    )
    assert isinstance(out, SplitPnl)
    assert out.usd_by_day == pytest.approx({"2026-11-13": 10.0 - 89.0, "2026-11-14": -180.0})
    assert out.coin_by_day == {}


def test_a_coin_transition_fee_before_the_switch_with_no_close_refuses_by_name() -> None:
    """A USD day cannot be left out of the chain, so an unpriced pre-switch coin amount is named
    (the same token as an unpriced coin amount on S), never valued at a neighbour's close."""
    out = split_daily_pnl_at_switch({}, {"2026-11-13": -0.001}, SWITCH, {"2026-11-14": 90000.0})
    assert out == "switch_day_unpriced"


def test_tokens_with_no_defining_case_are_not_in_the_set() -> None:
    """RESEARCH listed one more token (a stable bill before an unclear state) without a definition.
    Every case it could name is already ambiguous_boundary or holdings_unavailable, so it is not
    part of the closed set (Rule 7: the choice is recorded in the plan SUMMARY)."""
    assert "stable_bill_before_unclear_state" not in UNIT_SWITCH_REFUSALS
