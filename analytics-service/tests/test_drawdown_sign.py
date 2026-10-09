"""Phase 166.1.1 DDSIGN: a shallower max drawdown is a POSITIVE improvement.

``_max_drawdown`` returns a value <= 0, so the improvement of a book that goes
from ``before`` to ``after`` is ``after - before`` (D-01): -0.464 -> -0.236 must
read +0.228. The bridge's REPLACE ranking has used that convention since
H-1065; the simulator, the optimizer and the match engine used the opposite
subtraction, so a worse drawdown was rendered under "Positive = shallower" as
good news.

The two measured cases are constructed by hand, independent of the code under
test:

* Case A (the ROADMAP's -0.464 -> -0.236): the book's one shock is -0.464 on
  day 10; a 50% add of a candidate whose shock is -0.008 blends that day to
  0.5 * -0.464 + 0.5 * -0.008 = -0.236.
* Case B (a constant-yield book whose drawdown got worse, 0.0 -> -0.0087): a
  10% add of a candidate with a -0.096 shock blends that day to
  0.9 * 0.001 + 0.1 * -0.096 = -0.0087.

Every comparison uses ``pytest.approx``: 0.5 * -0.464 + 0.5 * -0.008 is
-0.236 only to float precision (-0.22799999999999998 is observed).
"""

import pandas as pd
import pytest

from services.portfolio_optimizer import _max_drawdown, drawdown_improvement
from services.simulator_scoring import simulate_add_candidate


def _s(vals: list[float]) -> pd.Series:
    """Daily-indexed float returns series starting 2025-01-01."""
    return pd.Series(
        vals,
        index=pd.date_range("2025-01-01", periods=len(vals), freq="D"),
        dtype=float,
    )


# The shock sits on day 10 / 20, never day 0: _max_drawdown starts its running
# max at the first cumulative value, so a day-0 loss is not a drawdown.
BOOK_A = [0.0] * 10 + [-0.464] + [0.0] * 29  # book max DD = -0.464
CAND_A = [0.0] * 10 + [-0.008] + [0.0] * 29  # at add_weight 0.5 the blend day = -0.236
BOOK_B = [0.001] * 40  # constant yield, max DD 0.0
CAND_B = [0.0] * 20 + [-0.096] + [0.0] * 19  # at add_weight 0.10 the blend day = -0.0087


def test_fixture_drawdowns_are_the_measured_cases():
    """Precondition control: the fixtures say what the oracles assume.

    If BOOK_A did not read -0.464 the Case A oracle would be measuring a
    different book, and a green sign test would prove nothing.
    """
    assert _max_drawdown(_s(BOOK_A)) == pytest.approx(-0.464)
    assert _max_drawdown(_s(BOOK_B)) == pytest.approx(0.0)


def test_simulator_shallower_is_positive():
    """A candidate that makes the max drawdown shallower must read positive.

    The simulator panel renders ``dd_delta`` under the hint "Positive =
    shallower"; a negative number for a shallower book tells the allocator a
    better book is worse.
    """
    r = simulate_add_candidate(
        {"s1": _s(BOOK_A)}, "c1", _s(CAND_A), {"s1": 1.0}, add_weight=0.5
    )
    assert r["current"]["max_drawdown"] == pytest.approx(-0.464)
    assert r["proposed"]["max_drawdown"] == pytest.approx(-0.236)
    assert r["deltas"]["dd_delta"] == pytest.approx(0.228)
    # The invariant, not only the constant: improvement = proposed - current.
    assert r["deltas"]["dd_delta"] == pytest.approx(
        r["proposed"]["max_drawdown"] - r["current"]["max_drawdown"]
    )


def test_simulator_worse_is_negative():
    """A candidate that makes the drawdown WORSE must read negative.

    HEAD read +0.0087 here, which the product rendered as an improvement.
    """
    r = simulate_add_candidate(
        {"s1": _s(BOOK_B)}, "c1", _s(CAND_B), {"s1": 1.0}, add_weight=0.10
    )
    assert r["deltas"]["dd_delta"] == pytest.approx(-0.0087)


def test_drawdown_improvement_helper_contract():
    """The one definition of the sign: shallower after => positive.

    -0.464 -> -0.236 is +0.228; 0.0 -> -0.0087 is -0.0087 (the drawdown got
    worse); either side None gives None, because a delta against a drawdown
    that does not exist does not exist either (166.1 D7).
    """
    assert drawdown_improvement(-0.464, -0.236) == pytest.approx(0.228)
    assert drawdown_improvement(0.0, -0.0087) == pytest.approx(-0.0087)
    assert drawdown_improvement(None, -0.236) is None
    assert drawdown_improvement(-0.464, None) is None
    assert drawdown_improvement(None, None) is None
