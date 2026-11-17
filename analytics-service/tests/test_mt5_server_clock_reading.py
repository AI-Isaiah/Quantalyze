"""Phase 155.1 SERVERCLOCK (MT5-06) - the pure server-clock assessment, pinned by
independent hand literals.

WHY these tests exist: a derive REFUSES on a ``mismatch`` verdict, and that refusal
is the D-01 data-integrity control. If the live broker clock disagrees with the
configured rule and the worker derives anyway, every deal is bucketed onto the wrong
UTC day near midnight and NAV, deposits and returns are silently mis-dated. So a
wrong check order, a wrong residual bound or a wrong rule must FAIL a test here; a
test that recomputes its expectation from the code under test could never do that.

Every expected number is therefore one of:

* a reading recorded by hand in ``155.1-SPIKE-READINGS.md`` (the three live runs:
  raw 7199.835 s, 7199.836 s and 7199.708 s under rule us after the autumn
  transitions, residuals 0.165, 0.164 and 0.292), or
* a daylight-saving fact derived BY HAND in the comment beside it.

Nothing is read back out of ``assess_server_clock_reading`` to build an oracle.

The two ``near_midnight`` tests are criterion 5 (D-18 as ruled by the founder on
2026-11-17, "Real hour, built deal"). The band run found no real broker deal in the
one wall hour where the eu and us rules disagree (02:00:00-02:59:59), so that hour is
exercised with a CONSTRUCTED wall time anchored to a real wall date of the divergence
week. It is labelled constructed everywhere it appears and is never a real deal.
"""
from __future__ import annotations

import calendar
import hashlib
import re

import pytest

from services.mt5_deals import deal_utc_day
from services.mt5_server_clock import (
    MT5_SERVER_CLOCK_RESIDUAL_BOUND_S,
    MT5_SERVER_CLOCK_ROUND_S,
    MT5_SERVER_CLOCK_UNMEASURED_REASONS,
    MT5_SERVER_CLOCK_VERDICTS,
    Mt5ServerClockAssessment,
    Mt5ServerClockMismatchError,
    assess_server_clock_reading,
    fixed_server_clock,
    format_offset_hours,
    server_clock_for_rule,
)
from services.mt5_server_clock_reading import server_label_hash


def _utc_ms(y: int, mo: int, d: int, h: int = 0, mi: int = 0, s: int = 0) -> int:
    """A UTC instant in epoch milliseconds, from calendar.timegm (independent of
    the clock leaf)."""
    return calendar.timegm((y, mo, d, h, mi, s)) * 1000


# --------------------------------------------------------------------------
# The three live spike readings (155.1-SPIKE-READINGS.md), rebuilt by hand.
# --------------------------------------------------------------------------


def test_spike_run_1_weekend_reading_is_a_match_with_residual_0_165() -> None:
    # Run 1, Saturday 2026-11-14 18:22 UTC, raw 7199.835 s. The us daylight window
    # closed on 2026-11-01 06:00Z, so on 11-14 the broker is on standard (+2 h).
    now = _utc_ms(2026, 11, 14, 18, 22)
    got = assess_server_clock_reading(
        server_clock_for_rule("us"), newest_tick_ms=now + 7199835, utc_now_ms=now
    )
    assert got.verdict == "match"
    assert got.reason is None
    assert got.measured_offset_s == 7200
    assert got.expected_offset_s == 7200
    assert got.residual_s == pytest.approx(0.165, abs=1e-6)


def test_spike_run_2_market_hours_reading_is_a_match_with_residual_0_164() -> None:
    # Run 2, Monday 2026-11-16 21:22 UTC, raw 7199.836 s.
    now = _utc_ms(2026, 11, 16, 21, 22)
    got = assess_server_clock_reading(
        server_clock_for_rule("us"), newest_tick_ms=now + 7199836, utc_now_ms=now
    )
    assert got.verdict == "match"
    assert got.measured_offset_s == 7200
    assert got.expected_offset_s == 7200
    assert got.residual_s == pytest.approx(0.164, abs=1e-6)


def test_spike_run_3_session_break_reading_is_a_match_with_residual_0_292() -> None:
    # Run 3, Monday 2026-11-16 22:01 UTC, raw 7199.708 s: the daily session break,
    # the worst of the three live residuals (0.292 s, well under the 5 s bound).
    now = _utc_ms(2026, 11, 16, 22, 1)
    got = assess_server_clock_reading(
        server_clock_for_rule("us"), newest_tick_ms=now + 7199708, utc_now_ms=now
    )
    assert got.verdict == "match"
    assert got.measured_offset_s == 7200
    assert got.expected_offset_s == 7200
    assert got.residual_s == pytest.approx(0.292, abs=1e-6)


# --------------------------------------------------------------------------
# Mismatch: a wrong rule, a wrong fixed clock, an off-rule offset, a stale tick.
# --------------------------------------------------------------------------


def test_a_truly_us_broker_in_the_divergence_week_is_mismatch_under_eu_and_match_under_us() -> None:
    # 2026-10-28 12:00Z is inside the divergence week: eu went back to +2 h on
    # 2026-10-25 01:00Z, us stays on +3 h until 2026-11-01 06:00Z. A truly-us broker
    # therefore reads UTC + 10800 s; the tick is 100 ms old, so raw = 10799.9 s,
    # measured 10800, residual 0.1 s.
    now = _utc_ms(2026, 10, 28, 12)
    tick = now + 10_800_000 - 100
    under_eu = assess_server_clock_reading(
        server_clock_for_rule("eu"), newest_tick_ms=tick, utc_now_ms=now
    )
    assert under_eu.verdict == "mismatch"
    assert under_eu.expected_offset_s == 7200
    assert under_eu.measured_offset_s == 10800
    under_us = assess_server_clock_reading(
        server_clock_for_rule("us"), newest_tick_ms=tick, utc_now_ms=now
    )
    assert under_us.verdict == "match"
    assert under_us.expected_offset_s == 10800
    assert under_us.measured_offset_s == 10800


def test_a_fixed_plus_3h_clock_against_a_true_plus_2h_broker_is_mismatch() -> None:
    # The pre-175 production shape: a fixed 10800 offset read a winter broker an
    # hour fast. 2026-11-17 the broker is on +2 h; the tick is 100 ms old.
    now = _utc_ms(2026, 11, 17, 12)
    got = assess_server_clock_reading(
        fixed_server_clock(10800), newest_tick_ms=now + 7_200_000 - 100, utc_now_ms=now
    )
    assert got.verdict == "mismatch"
    assert got.expected_offset_s == 10800
    assert got.measured_offset_s == 7200


def test_an_off_rule_offset_is_mismatch_never_unmeasured() -> None:
    # D-19: no plausibility class exists. Measured 3600 with a 0.1 s residual (a tick
    # one hour stale, or a broker one hour behind: the two cannot be told apart) is a
    # mismatch against the +2 h standard offset in force on 2026-11-17.
    now = _utc_ms(2026, 11, 17, 12)
    got = assess_server_clock_reading(
        server_clock_for_rule("us"), newest_tick_ms=now + 3_600_000 - 100, utc_now_ms=now
    )
    assert got.verdict == "mismatch"
    assert got.reason is None
    assert got.measured_offset_s == 3600
    assert got.expected_offset_s == 7200


def test_a_tick_exactly_900_s_stale_is_mismatch_the_accepted_collision() -> None:
    # T-155.1-06, accepted: a tick 900 s stale reads 7200 - 900 = 6300 s, exactly on
    # the 900 s grid, so it is indistinguishable from an offset of +1h45m. It is a
    # mismatch (raw 6299.9, measured 6300, residual 0.1), not an unmeasured reading.
    now = _utc_ms(2026, 11, 17, 12)
    got = assess_server_clock_reading(
        server_clock_for_rule("us"),
        newest_tick_ms=now + 7_200_000 - 900_000 - 100,
        utc_now_ms=now,
    )
    assert got.verdict == "mismatch"
    assert got.measured_offset_s == 6300
    assert got.expected_offset_s == 7200


# --------------------------------------------------------------------------
# The residual bound and the unmeasured reasons.
# --------------------------------------------------------------------------


def test_a_residual_of_exactly_5_s_still_asserts() -> None:
    # The bound is "over 5 s", not "5 s or more": raw 7195.0 s rounds to 7200 with a
    # residual of exactly 5.0 s, and that reading is still asserted.
    now = _utc_ms(2026, 11, 17, 12)
    got = assess_server_clock_reading(
        server_clock_for_rule("us"), newest_tick_ms=now + 7_195_000, utc_now_ms=now
    )
    assert got.residual_s == pytest.approx(5.0, abs=1e-9)
    assert got.verdict == "match"
    assert got.reason is None


def test_a_residual_just_over_5_s_is_unmeasured_residual_over_bound() -> None:
    # raw 7194.999 s: residual 5.001 s, just over the bound.
    now = _utc_ms(2026, 11, 17, 12)
    got = assess_server_clock_reading(
        server_clock_for_rule("us"), newest_tick_ms=now + 7_194_999, utc_now_ms=now
    )
    assert got.verdict == "unmeasured"
    assert got.reason == "residual_over_bound"
    assert got.residual_s == pytest.approx(5.001, abs=1e-6)


def test_the_bound_and_the_round_are_the_decided_constants() -> None:
    # D-19 and D-08, restated by hand: a 5 s bound, a 900 s grid.
    assert MT5_SERVER_CLOCK_RESIDUAL_BOUND_S == 5.0
    assert MT5_SERVER_CLOCK_ROUND_S == 900


def test_no_tick_is_unmeasured_no_tick() -> None:
    got = assess_server_clock_reading(
        server_clock_for_rule("us"),
        newest_tick_ms=None,
        utc_now_ms=_utc_ms(2026, 11, 17, 12),
    )
    assert got == Mt5ServerClockAssessment(
        "unmeasured", "no_tick", None, None, None, None, None
    )


def test_a_failed_tick_read_is_unmeasured_even_when_a_tick_value_is_passed() -> None:
    now = _utc_ms(2026, 11, 17, 12)
    got = assess_server_clock_reading(
        server_clock_for_rule("us"),
        newest_tick_ms=now + 7_199_836,
        utc_now_ms=now,
        tick_read_failed=True,
    )
    assert got.verdict == "unmeasured"
    assert got.reason == "tick_read_failed"
    assert got.measured_offset_s is None


@pytest.mark.parametrize(
    "tick_ms",
    [
        _utc_ms(1990, 1, 1),  # before the rule's 2007 start
        _utc_ms(2100, 1, 1),  # after the rule's 2099 end
        10**18,  # not a datable instant at all
        -(10**18),
    ],
)
def test_an_undatable_tick_under_a_rule_is_unmeasured_and_never_raises(
    tick_ms: int,
) -> None:
    # A RULE clock consults the tick's year (a fixed clock never does, so it never
    # raises). The offsets stay None: they are integer columns and an absurd value
    # would fail the insert on every retry.
    got = assess_server_clock_reading(
        server_clock_for_rule("us"),
        newest_tick_ms=tick_ms,
        utc_now_ms=_utc_ms(2026, 11, 17, 12),
    )
    assert got.verdict == "unmeasured"
    assert got.reason == "tick_time_out_of_range"
    assert got.raw_offset_s is None
    assert got.measured_offset_s is None
    assert got.expected_offset_s is None


def test_a_repeated_autumn_hour_under_eu_is_unmeasured_expected_unassertable() -> None:
    # eu moves back at 2026-10-25 01:00Z, so the broker wall hour 03:00-03:59 happens
    # twice (RESEARCH computed the repeated band as 03:00-03:50 on this date). Wall
    # 03:30:00: as daylight it is 00:30Z (inside the window), as standard it is 01:30Z
    # (past the end). Two consistent offsets, so no trustworthy instant.
    clock = server_clock_for_rule("eu")
    wall = calendar.timegm((2026, 10, 25, 3, 30, 0))
    assert len(clock.candidates(wall)) == 2  # fixture sanity: it IS a repeated hour
    tick = wall * 1000
    now = tick - 10_800_000 + 100  # raw 10799.9 s, measured 10800, residual 0.1 s
    got = assess_server_clock_reading(clock, newest_tick_ms=tick, utc_now_ms=now)
    assert got.verdict == "unmeasured"
    assert got.reason == "expected_unassertable"
    assert got.expected_offset_s is None
    assert got.measured_offset_s == 10800


def test_a_skipped_spring_hour_under_eu_is_unmeasured_expected_unassertable() -> None:
    # eu moves forward at 2026-03-29 01:00Z, so the wall hour 03:00-03:59 does not
    # exist before the jump. Wall 03:30:00: as daylight it is 00:30Z (before the
    # window opens), as standard it is 01:30Z (already inside it). Neither is
    # consistent: no candidate.
    clock = server_clock_for_rule("eu")
    wall = calendar.timegm((2026, 3, 29, 3, 30, 0))
    assert len(clock.candidates(wall)) == 0  # fixture sanity: it IS a skipped hour
    tick = wall * 1000
    now = tick - 7_200_000 + 100  # raw 7199.9 s, measured 7200, residual 0.1 s
    got = assess_server_clock_reading(clock, newest_tick_ms=tick, utc_now_ms=now)
    assert got.verdict == "unmeasured"
    assert got.reason == "expected_unassertable"
    assert got.expected_offset_s is None


def test_the_residual_check_runs_before_the_unassertable_check() -> None:
    # Same repeated hour, but the tick is 60 s stale against a 10800 s grid point, so
    # the residual is 60 s. The bound reason wins: an unreadable instant must not
    # hide a reading that was never assertable in the first place.
    clock = server_clock_for_rule("eu")
    wall = calendar.timegm((2026, 10, 25, 3, 30, 0))
    tick = wall * 1000
    now = tick - 10_800_000 + 60_000
    got = assess_server_clock_reading(clock, newest_tick_ms=tick, utc_now_ms=now)
    assert got.verdict == "unmeasured"
    assert got.reason == "residual_over_bound"


def test_reason_is_none_exactly_when_the_verdict_is_not_unmeasured() -> None:
    now = _utc_ms(2026, 11, 17, 12)
    us = server_clock_for_rule("us")
    repeated_wall = calendar.timegm((2026, 10, 25, 3, 30, 0)) * 1000
    cases = [
        assess_server_clock_reading(us, newest_tick_ms=now + 7_199_836, utc_now_ms=now),
        assess_server_clock_reading(us, newest_tick_ms=now + 3_600_000 - 100, utc_now_ms=now),
        assess_server_clock_reading(us, newest_tick_ms=None, utc_now_ms=now),
        assess_server_clock_reading(
            us, newest_tick_ms=now, utc_now_ms=now, tick_read_failed=True
        ),
        assess_server_clock_reading(us, newest_tick_ms=now + 7_194_999, utc_now_ms=now),
        assess_server_clock_reading(us, newest_tick_ms=_utc_ms(1990, 1, 1), utc_now_ms=now),
        assess_server_clock_reading(
            server_clock_for_rule("eu"),
            newest_tick_ms=repeated_wall,
            utc_now_ms=repeated_wall - 10_800_000 + 100,
        ),
    ]
    for got in cases:
        assert got.verdict in MT5_SERVER_CLOCK_VERDICTS
        if got.verdict == "unmeasured":
            assert got.reason in MT5_SERVER_CLOCK_UNMEASURED_REASONS
        else:
            assert got.reason is None
    # Every one of the five reasons occurs among the cases, so none is untested.
    assert {c.reason for c in cases if c.reason} == set(MT5_SERVER_CLOCK_UNMEASURED_REASONS)


def test_the_closed_sets_are_the_decided_literals() -> None:
    # Hand-typed: the migration's CHECKs mirror these (parity pin), so a silent
    # change here would be a schema change.
    assert MT5_SERVER_CLOCK_VERDICTS == ("match", "mismatch", "unmeasured")
    assert MT5_SERVER_CLOCK_UNMEASURED_REASONS == (
        "no_tick",
        "tick_read_failed",
        "residual_over_bound",
        "tick_time_out_of_range",
        "expected_unassertable",
    )


# --------------------------------------------------------------------------
# format_offset_hours and the mismatch error text.
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("offset_s", "text"),
    [(7200, "+2h"), (10800, "+3h"), (19800, "+5h30m"), (-6300, "-1h45m"), (0, "+0h")],
)
def test_format_offset_hours(offset_s: int, text: str) -> None:
    assert format_offset_hours(offset_s) == text


def test_the_mismatch_error_text_names_the_rule_and_two_offsets_in_hours_only() -> None:
    message = str(
        Mt5ServerClockMismatchError(
            rule="us", expected_offset_s=10800, measured_offset_s=7200
        )
    )
    assert "rule=us expected=+3h measured=+2h" in message
    # scrub_alert_detail replaces any run of 5+ digits: seconds would read <digits>.
    assert re.search(r"\d{5,}", message) is None


# --------------------------------------------------------------------------
# server_label_hash.
# --------------------------------------------------------------------------


def test_server_label_hash_is_the_sha256_of_the_stripped_casefolded_server() -> None:
    # An invented placeholder, never a real broker or server name.
    expected = hashlib.sha256(b"example-demo").hexdigest()
    assert server_label_hash("example-demo") == expected
    assert server_label_hash("  Example-Demo ") == expected
    assert server_label_hash("EXAMPLE-DEMO") == expected


def test_server_label_hash_differs_for_different_servers() -> None:
    assert server_label_hash("example-demo") != server_label_hash("example-live")


@pytest.mark.parametrize("blank", [None, "", "   ", 42])
def test_server_label_hash_is_none_for_a_blank_or_non_string_value(blank: object) -> None:
    assert server_label_hash(blank) is None


# --------------------------------------------------------------------------
# Criterion 5 (D-18 as ruled 2026-11-17, "Real hour, built deal").
# --------------------------------------------------------------------------


def test_near_midnight_constructed_deal_time_anchored_to_2026_10_30_lands_on_the_us_rule_day() -> None:
    """CONSTRUCTED, not real: the broker wall time 2026-10-30 02:30:00 is a built
    deal time anchored to a real wall date of the divergence week. It is NOT a real
    deal: the band run found no real broker deal in 02:00:00-02:59:59, the only wall
    hour where the eu and us rules disagree about the UTC day. It carries no ticket,
    symbol, amount, login or server.

    Hand derivation (a deal's ``time`` is the broker wall clock encoded as if UTC):

    * us is still on daylight (+3 h) until 2026-11-01 06:00Z, so the wall 02:30:00
      is 23:30Z on 2026-10-29: UTC day 2026-10-29.
    * eu has been on standard (+2 h) since 2026-10-25 01:00Z, so the same wall time
      is 00:30Z on 2026-10-30: UTC day 2026-10-30.

    A worker configured for the wrong rule dates this deal a day off, which is the
    near-midnight error the server-clock check exists to refuse.
    """
    wall = calendar.timegm((2026, 10, 30, 2, 30, 0))
    assert deal_utc_day(wall, server_clock_for_rule("us")) == "2026-10-29"
    assert deal_utc_day(wall, server_clock_for_rule("eu")) == "2026-10-30"


def test_near_midnight_real_mm2_boundary_deal_2026_10_30_0300_agrees_under_both_rules() -> None:
    """A REAL deal, the agreeing boundary: the broker wall time 2026-10-30 03:00:00
    is MM2's actual deal from the band run (155.1-SPIKE-READINGS.md). Wall 03:00:00
    minus 3 h (us) is 00:00Z and minus 2 h (eu) is 01:00Z, both on 2026-10-30, so the
    two rules AGREE one wall hour after the disagreeing hour."""
    wall = calendar.timegm((2026, 10, 30, 3, 0, 0))
    assert deal_utc_day(wall, server_clock_for_rule("us")) == "2026-10-30"
    assert deal_utc_day(wall, server_clock_for_rule("eu")) == "2026-10-30"
