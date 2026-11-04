"""Phase 188 TINYBASE plan 01 - the tiny-base definition at its edges (D-03, D-05, T-A2).

``services.tiny_base`` holds the ONE definition: a day is tiny-base when its starting NAV is
positive and strictly under 5% of the highest end-of-day level over the previous 30 calendar days
(the days t-30 through t-1 inclusive, the level in force at t-30 carried in). The two numbers are
restated here as literals on purpose: the pin test reads the module's constants, so changing
either number is a visible decision and not a silent one. Every other test uses the literals, so
none of them can pass by importing the number under test.

Each test imports the module inside its body (a missing module fails the test at call time, not
as a collection error). Every level is synthetic and typed beside what it exercises.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

_FRACTION = 0.05
_WINDOW = 30


def _iso(start: str, offset: int) -> str:
    return (date.fromisoformat(start) + timedelta(days=offset)).isoformat()


def test_the_literals_are_pinned() -> None:
    """The pin: a changed threshold or window is a decision, so this test must be edited with it."""
    import services.tiny_base as tb

    assert tb.TINY_BASE_FRACTION == _FRACTION
    assert tb.TINY_BASE_WINDOW_DAYS == _WINDOW


def test_boundary_is_strictly_under_five_percent() -> None:
    """Peak 100000.0: base 5000.0 (exactly 5%) is NOT tiny, 4999.99 is. Loosening `<` to `<=`
    flips the first assertion; tightening the fraction flips the second."""
    from services.tiny_base import is_tiny_base

    assert is_tiny_base(5000.0, 100000.0) is False
    assert is_tiny_base(4999.99, 100000.0) is True
    assert is_tiny_base(100000.0, 100000.0) is False


def test_a_base_at_or_below_zero_is_never_tiny() -> None:
    """D-05: a zero or negative base stays with the existing machinery (the 233 zero-base
    key-days keep their rows). A None peak and a non-finite base are never tiny either."""
    from services.tiny_base import is_tiny_base

    assert is_tiny_base(0.0, 100000.0) is False
    assert is_tiny_base(-1.0, 100000.0) is False
    assert is_tiny_base(400.0, None) is False
    assert is_tiny_base(float("nan"), 100000.0) is False
    assert is_tiny_base(float("inf"), 100000.0) is False


def test_window_includes_day_t_minus_30_and_excludes_t_minus_31() -> None:
    """Day 2026-03-10: the window is 2026-02-08 (t-30) through 2026-03-09 (t-1). A peak ON t-30
    counts. A peak on t-31 followed by a lower level ON t-30 is out of the window, because the
    level in force at t-30 is the lower one."""
    from services.tiny_base import window_peaks

    day = "2026-03-10"
    t30, t31 = "2026-02-08", "2026-02-07"
    assert window_peaks({t30: 100000.0, "2026-03-09": 100.0}, [day])[day] == 100000.0
    # The peak ON t-30 followed by a drop the next day still counts: a window that started a day
    # late (t-29) would see only the 400.0.
    assert window_peaks({t30: 100000.0, "2026-02-09": 400.0}, [day])[day] == 100000.0
    assert window_peaks({t31: 100000.0, t30: 400.0}, [day])[day] == 400.0
    # A level on t-31 with nothing newer is the level in force at t-30, so it is carried in.
    assert window_peaks({t31: 100000.0}, [day])[day] == 100000.0


def test_sparse_levels_carry_the_last_entry_into_the_window() -> None:
    """Levels {2026-01-01: 100000, 2026-01-20: 400}. 2026-01-25 sees 100000 (carried), base 400
    is tiny. 2026-02-01's window starts 2026-01-02, where 100000 is still in force: tiny. By
    2026-02-20 the window starts 2026-01-21, where 400 is in force: not tiny."""
    from services.tiny_base import is_tiny_base, window_peaks

    levels = {"2026-01-01": 100000.0, "2026-01-20": 400.0}
    peaks = window_peaks(levels, ["2026-01-25", "2026-02-01", "2026-02-20"])
    assert peaks["2026-01-25"] == 100000.0
    assert is_tiny_base(400.0, peaks["2026-01-25"]) is True
    assert peaks["2026-02-01"] == 100000.0
    assert is_tiny_base(400.0, peaks["2026-02-01"]) is True
    assert peaks["2026-02-20"] == 400.0
    assert is_tiny_base(400.0, peaks["2026-02-20"]) is False


def test_short_history_is_never_tiny_and_no_prior_level_is_absent() -> None:
    """A day whose only prior level is the day before has ratio 1 (T-A2: the window contains
    t-1, so a key's first measured day cannot be tiny). A day with no prior level has no peak."""
    from services.tiny_base import is_tiny_base, window_peaks

    levels = {"2026-03-09": 100.0}
    peaks = window_peaks(levels, ["2026-03-08", "2026-03-09", "2026-03-10"])
    assert "2026-03-08" not in peaks
    assert "2026-03-09" not in peaks  # the level ON the day is not before it
    assert peaks["2026-03-10"] == 100.0
    assert is_tiny_base(100.0, peaks["2026-03-10"]) is False


def test_roll_off_after_a_near_total_withdrawal() -> None:
    """D-03 roll-off. Daily levels: 100000 on day 0, then 400 on every day from day 1. A day's
    base is the previous day's level. Day 1's base (100000) is not tiny, days 2..30 (base 400
    against a window that still holds day 0) are tiny, day 31's window starts at day 1 so the
    100000 has rolled off and the day counts again."""
    from services.tiny_base import is_tiny_base, window_peaks

    start = "2026-01-01"
    levels = {_iso(start, 0): 100000.0}
    levels.update({_iso(start, k): 400.0 for k in range(1, 61)})
    days = [_iso(start, k) for k in range(1, 40)]
    peaks = window_peaks(levels, days)
    verdict = {
        k: is_tiny_base(levels[_iso(start, k - 1)], peaks.get(_iso(start, k)))
        for k in range(1, 40)
    }
    assert verdict[1] is False
    assert all(verdict[k] for k in range(2, 31)), [k for k in range(2, 31) if not verdict[k]]
    assert verdict[31] is False
    assert not any(verdict[k] for k in range(31, 40))


def test_non_finite_levels_and_malformed_days_are_refused_without_a_value() -> None:
    """A NaN or infinite level and a non-canonical day raise ValueError whose text is static
    (no digit, so no amount can leak into a log)."""
    from services.tiny_base import window_peaks

    bad: list[tuple[dict[str, float], list[str]]] = [
        ({"2026-01-01": float("nan")}, ["2026-01-02"]),
        ({"2026-01-01": float("inf")}, ["2026-01-02"]),
        ({"20260101": 7.0}, ["2026-01-02"]),
        ({"2026-1-1": 7.0}, ["2026-01-02"]),
        ({"2026-01-01": 7.0}, ["20260102"]),
    ]
    for levels, days in bad:
        with pytest.raises(ValueError) as caught:
            window_peaks(levels, days)
        assert not any(ch.isdigit() for ch in str(caught.value)), str(caught.value)
