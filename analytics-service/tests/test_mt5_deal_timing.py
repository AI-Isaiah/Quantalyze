"""FLOWTIMING plan 03 - the MT5 deal INSTANT seam and the DEAL_ENTRY / position helpers.

``deal_utc_instant_ms`` is the instant sibling of ``deal_utc_day``: it converts a
deal's broker-server time to UTC epoch MILLISECONDS with the SAME
``server_utc_offset_s`` integer, so a deal's instant can never disagree with the
UTC day the day-level rule gives it (D-08). It uses ``time_msc`` when the venue
gives it (D-09), and answers ``None`` - never a guessed time - when the
millisecond field cannot be trusted (D-07), so a timing anomaly degrades that day
to the day-level rule in the fold instead of failing a derive that succeeds today.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from services.mt5_deals import (
    MT5_DEAL_ENTRY_IN,
    MT5_DEAL_ENTRY_INOUT,
    MT5_DEAL_ENTRY_OUT,
    MT5_DEAL_ENTRY_OUT_BY,
    _MT5_KNOWN_DEAL_ENTRIES,
    Mt5DealClassificationError,
    deal_entry_code,
    deal_position_id,
    deal_utc_day,
    deal_utc_instant_ms,
)
from services.mt5_server_clock import server_clock_for_rule


def _server_epoch(
    year: int, month: int, day: int, hour: int = 0, minute: int = 0, second: int = 0
) -> int:
    """A broker-server-time epoch (seconds): the server wall clock read as if it were UTC."""
    return int(datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc).timestamp())


def _day_of_instant_ms(instant_ms: int) -> str:
    """The UTC day of an epoch-millisecond instant, by exact integer arithmetic."""
    epoch0 = datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (epoch0 + timedelta(milliseconds=instant_ms)).date().isoformat()


# ---------------------------------------------------------------------------
# Task 1 - tracer: one deal's UTC instant, consistent with its UTC day
# ---------------------------------------------------------------------------


def test_instant_uses_time_msc_and_subtracts_the_server_offset() -> None:
    """time T (server seconds), time_msc = T*1000 + 250, offset 10800 (UTC+3).

    Hand arithmetic: (T - 10800) * 1000 + 250 - the millisecond field survives and
    the offset is removed in milliseconds.
    """
    t = _server_epoch(2025, 3, 10, 14, 5, 7)
    deal = {"time": t, "time_msc": t * 1000 + 250}
    assert deal_utc_instant_ms(deal, 10800) == (t - 10800) * 1000 + 250


def test_instant_without_time_msc_falls_back_to_the_deals_own_time() -> None:
    """No time_msc: the instant is (time - offset) * 1000 and nothing else."""
    t = _server_epoch(2025, 3, 10, 14, 5, 7)
    assert deal_utc_instant_ms({"time": t}, 7200) == (t - 7200) * 1000
    assert deal_utc_instant_ms({"time": t, "time_msc": None}, 7200) == (t - 7200) * 1000


@pytest.mark.parametrize("offset_s", [0, 7200, 10800])
@pytest.mark.parametrize("delta_ms", [-1, 0, 1])
def test_instant_day_equals_deal_utc_day_around_a_utc_midnight(
    offset_s: int, delta_ms: int
) -> None:
    """The instant and the day share ONE offset seam, so a deal 1 ms either side of
    a UTC midnight lands on the same UTC day by both routes (Pitfall 3 / D-08).

    The server-clock reading of UTC midnight 2025-03-11 00:00:00 is
    midnight + offset; the deal sits ``delta_ms`` from it.
    """
    midnight_utc_s = _server_epoch(2025, 3, 11)
    server_ms = (midnight_utc_s + offset_s) * 1000 + delta_ms
    deal = {"time": server_ms // 1000, "time_msc": server_ms}
    instant = deal_utc_instant_ms(deal, offset_s)
    assert instant == midnight_utc_s * 1000 + delta_ms
    assert instant is not None
    assert _day_of_instant_ms(instant) == deal_utc_day(deal["time"], offset_s)
    # The two sides of midnight really are two different days (the test can fail).
    assert _day_of_instant_ms(instant) == ("2025-03-10" if delta_ms < 0 else "2025-03-11")


@pytest.mark.parametrize(
    "time_msc",
    [
        True,  # bool is an int subclass, not a millisecond clock
        1_741_615_507_250.5,  # fractional float
        float("nan"),
        float("inf"),
        "1741615507250",  # a string
        1_741_615_507_250 + 5_000,  # disagrees with the deal's own time by 5 s
        1_741_615_507_250 - 1_000,  # one whole second early
    ],
)
def test_untrustworthy_time_msc_resolves_to_none_and_never_raises(time_msc: object) -> None:
    """D-07: a time_msc anomaly is 'no instant', not a failure and not the time field.

    ``time`` is 1_741_615_507 (2025-03-10 14:05:07); a time_msc that is a bool, a
    fraction, non-finite, a string, or in a different second than ``time`` is
    untrustworthy. The answer is None: never a fallback to ``time * 1000`` (that
    would invent a precision) and never an exception (that would make a derive that
    succeeds today fail permanently).
    """
    deal = {"time": 1_741_615_507, "time_msc": time_msc}
    assert deal_utc_instant_ms(deal, 0) is None


@pytest.mark.parametrize("flag", [True, False])
def test_a_bool_time_msc_is_never_read_as_a_millisecond_count(flag: bool) -> None:
    """True/False are ints (1/0). On a deal stamped at epoch 0 they would also pass
    the same-second check, so only the explicit bool rejection keeps them out."""
    assert deal_utc_instant_ms({"time": 0, "time_msc": flag}, 0) is None


def test_an_integral_float_time_msc_is_accepted() -> None:
    """A venue that ships the millisecond clock as 1741615507250.0 is still exact."""
    deal = {"time": 1_741_615_507, "time_msc": 1_741_615_507_250.0}
    assert deal_utc_instant_ms(deal, 0) == 1_741_615_507_250


@pytest.mark.parametrize("bad_time", [None, "not-a-time", float("nan"), float("inf"), True])
def test_undatable_time_raises_exactly_what_deal_utc_day_raises(bad_time: object) -> None:
    """The only raise is the shared ``time`` parse that deal_utc_day performs for
    every deal today - same class, same message, so no new failure mode appears."""
    with pytest.raises(Mt5DealClassificationError) as day_err:
        deal_utc_day(bad_time, 0)
    with pytest.raises(Mt5DealClassificationError) as instant_err:
        deal_utc_instant_ms({"time": bad_time, "time_msc": 1}, 0)
    assert str(instant_err.value) == str(day_err.value)


def test_a_missing_time_field_raises_like_an_undatable_time() -> None:
    with pytest.raises(Mt5DealClassificationError):
        deal_utc_instant_ms({"time_msc": 1_741_615_507_250}, 0)


def test_out_of_range_time_raises_like_deal_utc_day() -> None:
    """A deal deal_utc_day cannot date is also one the instant cannot date: the
    instant never succeeds where the day raises, so it adds no failure mode."""
    with pytest.raises(Mt5DealClassificationError) as day_err:
        deal_utc_day(1e30, 0)
    with pytest.raises(Mt5DealClassificationError) as instant_err:
        deal_utc_instant_ms({"time": 1e30}, 0)
    assert str(instant_err.value) == str(day_err.value)


@pytest.mark.parametrize("bad_offset", [True, 3.5, "10800", None])
def test_the_offset_is_validated_exactly_as_deal_utc_day_validates_it(bad_offset: object) -> None:
    with pytest.raises(Mt5DealClassificationError) as day_err:
        deal_utc_day(1_741_615_507, bad_offset)  # type: ignore[arg-type]
    with pytest.raises(Mt5DealClassificationError) as instant_err:
        deal_utc_instant_ms({"time": 1_741_615_507}, bad_offset)  # type: ignore[arg-type]
    assert str(instant_err.value) == str(day_err.value)


def test_a_datetime_time_is_read_like_deal_utc_day_reads_it() -> None:
    """deal_utc_day accepts a datetime (naive = UTC); the instant must too."""
    moment = datetime(2025, 3, 10, 14, 5, 7, tzinfo=timezone.utc)
    assert deal_utc_instant_ms({"time": moment}, 3600) == (int(moment.timestamp()) - 3600) * 1000
    naive = datetime(2025, 3, 10, 14, 5, 7)
    assert deal_utc_instant_ms({"time": naive}, 0) == int(moment.timestamp()) * 1000


def test_a_fractional_time_never_lands_on_a_different_day_than_the_day_rule() -> None:
    """Never disagree with the day: 86399.9999996 s is rounded UP to the next day
    by ``datetime.fromtimestamp`` (microsecond rounding) inside deal_utc_day, while
    a floor-to-millisecond instant stays on day one. The two cannot both stand, so
    the instant is None (unresolvable) rather than a time on a different day."""
    time_value = 86399.9999996
    assert deal_utc_day(time_value, 0) == "1970-01-02"
    assert deal_utc_instant_ms({"time": time_value}, 0) is None


# ---------------------------------------------------------------------------
# Phase 175 - the seam under a DST rule clock
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("rule_id", "wall", "day"),
    [
        # Repeated hour: the day comes from the first occurrence (UTC+3).
        ("eu", _server_epoch(2026, 10, 25, 3, 30), "2026-10-25"),
        ("us", _server_epoch(2026, 11, 1, 8, 30), "2026-11-01"),
        # Skipped hour: the day comes from the pre-transition offset (UTC+2).
        ("eu", _server_epoch(2027, 3, 28, 3, 30), "2027-03-28"),
        ("us", _server_epoch(2027, 3, 14, 9, 30), "2027-03-14"),
    ],
)
def test_a_repeated_or_skipped_broker_hour_has_a_day_and_no_instant(
    rule_id: str, wall: int, day: str
) -> None:
    """D-07: the hour the broker clock repeats or skips has no trustworthy instant,
    but the deal still has a day and nothing raises, so a derive that succeeds today
    cannot fail on it. A time_msc that agrees with the second does not change that."""
    clock = server_clock_for_rule(rule_id)
    assert deal_utc_day(wall, clock) == day
    assert deal_utc_instant_ms({"time": wall}, clock) is None
    assert deal_utc_instant_ms({"time": wall, "time_msc": wall * 1000 + 7}, clock) is None


@pytest.mark.parametrize("rule_id", ["eu", "us"])
@pytest.mark.parametrize(
    ("season", "midnight_utc", "broker_offset_s"),
    [
        ("winter", (2026, 12, 11), 7200),
        ("summer", (2026, 7, 11), 10800),
    ],
)
@pytest.mark.parametrize("delta_ms", [-1, 1])
def test_instant_day_equals_deal_utc_day_around_a_utc_midnight_under_a_rule_clock(
    rule_id: str, season: str, midnight_utc: tuple[int, int, int], broker_offset_s: int, delta_ms: int
) -> None:
    """The midnight agreement of the fixed form holds under a rule clock too, in
    both seasons: the offset in force is the winter or the summer one, the instant
    lands on the day ``deal_utc_day`` gives, and the two sides of midnight are two
    different days."""
    clock = server_clock_for_rule(rule_id)
    midnight_s = _server_epoch(*midnight_utc)
    server_ms = (midnight_s + broker_offset_s) * 1000 + delta_ms
    deal = {"time": server_ms // 1000, "time_msc": server_ms}
    instant = deal_utc_instant_ms(deal, clock)
    assert instant == midnight_s * 1000 + delta_ms, season
    assert instant is not None
    assert _day_of_instant_ms(instant) == deal_utc_day(deal["time"], clock)
    before = "%04d-%02d-%02d" % (midnight_utc[0], midnight_utc[1], midnight_utc[2] - 1)
    after = "%04d-%02d-%02d" % midnight_utc
    assert _day_of_instant_ms(instant) == (before if delta_ms < 0 else after)


@pytest.mark.parametrize("rule_id", ["eu", "us"])
@pytest.mark.parametrize("year", [2006, 2100])
def test_a_deal_outside_the_rules_year_span_fails_loud_with_one_text(
    rule_id: str, year: int
) -> None:
    """The statutory rule covers 2007-2099. Outside it the seam raises the same
    existing out-of-range failure from both entry points, never a guessed offset."""
    clock = server_clock_for_rule(rule_id)
    wall = _server_epoch(year, 6, 1)
    with pytest.raises(Mt5DealClassificationError) as day_err:
        deal_utc_day(wall, clock)
    with pytest.raises(Mt5DealClassificationError) as instant_err:
        deal_utc_instant_ms({"time": wall}, clock)
    assert str(day_err.value) == (
        "MT5 deal time is outside the dates the broker server-clock rule covers (2007-2099) — fail loud"
    )
    assert str(instant_err.value) == str(day_err.value)


@pytest.mark.parametrize("rule_id", ["eu", "us"])
def test_an_undatable_epoch_raises_the_same_text_under_a_rule_clock(rule_id: str) -> None:
    clock = server_clock_for_rule(rule_id)
    with pytest.raises(Mt5DealClassificationError) as day_err:
        deal_utc_day(1e30, clock)
    with pytest.raises(Mt5DealClassificationError) as instant_err:
        deal_utc_instant_ms({"time": 1e30}, clock)
    assert str(instant_err.value) == str(day_err.value)
    assert str(day_err.value) == (
        "MT5 deal time is outside the dates the broker server-clock rule covers (2007-2099) — fail loud"
    )


def test_a_clock_and_an_int_are_both_accepted_as_the_offset() -> None:
    """The widened offset argument accepts a clock beside the int; the rejection of
    a bool, float, str and None is the unchanged parametrization above."""
    wall = _server_epoch(2026, 12, 11, 12)
    assert deal_utc_day(wall, server_clock_for_rule("us")) == "2026-12-11"
    assert deal_utc_day(wall, 7200) == "2026-12-11"


# ---------------------------------------------------------------------------
# Task 2 - DEAL_ENTRY table (vendor-pinned) and the position helpers
# ---------------------------------------------------------------------------


def test_the_four_entry_constants_equal_the_vendor_values() -> None:
    """MetaTrader5 5.0.6231 ``# ENUM_DEAL_ENTRY``: IN=0, OUT=1, INOUT=2, OUT_BY=3.
    A wrong code would key the open-instant picker on the wrong deals."""
    assert (MT5_DEAL_ENTRY_IN, MT5_DEAL_ENTRY_OUT, MT5_DEAL_ENTRY_INOUT, MT5_DEAL_ENTRY_OUT_BY) == (
        0,
        1,
        2,
        3,
    )
    assert _MT5_KNOWN_DEAL_ENTRIES == frozenset({0, 1, 2, 3})


@pytest.mark.parametrize("code", [0, 1, 2, 3])
def test_deal_entry_code_returns_a_known_code(code: int) -> None:
    assert deal_entry_code({"entry": code}) == code


@pytest.mark.parametrize(
    "deal",
    [
        {"entry": 7},  # unknown code is unresolvable, never a default
        {"entry": -1},
        {"entry": True},  # bool masquerades as OUT (1)
        {"entry": False},
        {"entry": 1.0},  # not an int
        {"entry": "1"},
        {"entry": None},
        {},  # missing
    ],
)
def test_deal_entry_code_is_none_for_everything_else(deal: dict[str, object]) -> None:
    assert deal_entry_code(deal) is None


def test_deal_position_id_returns_a_positive_int() -> None:
    assert deal_position_id({"position_id": 42}) == 42


@pytest.mark.parametrize(
    "deal",
    [
        {"position_id": 0},  # commission/fee-only deals carry 0
        {"position_id": -5},
        {"position_id": True},
        {"position_id": 4.0},
        {"position_id": "42"},
        {"position_id": None},
        {},
    ],
)
def test_deal_position_id_is_none_for_everything_else(deal: dict[str, object]) -> None:
    assert deal_position_id(deal) is None
