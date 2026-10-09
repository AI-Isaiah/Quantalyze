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

from services.bridge_scoring import find_replacement_candidates
from services.match_engine import _compute_portfolio_fit_components, score_candidates
from services.portfolio_optimizer import (
    _max_drawdown,
    drawdown_improvement,
    find_improvement_candidates,
)
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
# A much deeper candidate than CAND_B: at add_weight 0.10 the blend day is
# 0.9 * 0.001 + 0.1 * -0.5 = -0.0491.
CAND_DEEP = [0.0] * 20 + [-0.5] + [0.0] * 19


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


# ---------------------------------------------------------------------------
# Plan 01 Task 2: the other two ADD sites, the ranking and the parity oracle
# ---------------------------------------------------------------------------


def _match_candidate(strategy_id: str) -> dict:
    """A candidate that clears every hard and soft eligibility gate.

    Both candidates are identical on every axis except their returns, so the
    drawdown axis is the only thing that can order them.
    """
    return {
        "strategy_id": strategy_id,
        "sharpe": 1.5,
        "track_record_days": 365,
        "max_drawdown_pct": -0.15,
        "manager_aum": 5_000_000,
        "exchange": "binance",
        "strategy_type": "trend_following",
        "subtype": None,
    }


def test_optimizer_shallower_is_positive():
    """The optimizer card says "improve drawdown by X": a shallower book is +X."""
    res = find_improvement_candidates(
        {"s1": _s(BOOK_A)}, {"c1": _s(CAND_A)}, {"s1": 1.0}, add_weight=0.5
    )
    assert res[0]["dd_improvement"] == pytest.approx(0.228)


def test_optimizer_worse_is_negative():
    """A worse drawdown must not be offered as "improve drawdown by 0.87%"."""
    res = find_improvement_candidates(
        {"s1": _s(BOOK_B)}, {"c1": _s(CAND_B)}, {"s1": 1.0}, add_weight=0.10
    )
    assert res[0]["dd_improvement"] == pytest.approx(-0.0087)


def test_match_engine_shallower_is_positive():
    """The match score's portfolio-fit drawdown component rewards a shallower book."""
    c = _compute_portfolio_fit_components(
        _s(BOOK_A), {"s1": 1.0}, {"s1": _s(BOOK_A)}, _s(CAND_A), add_weight=0.5
    )
    assert c["dd_improvement"] == pytest.approx(0.228)


def test_match_engine_worse_is_negative():
    """A candidate that deepens the drawdown must read negative in the match score."""
    c = _compute_portfolio_fit_components(
        _s(BOOK_B), {"s1": 1.0}, {"s1": _s(BOOK_B)}, _s(CAND_B), add_weight=0.10
    )
    assert c["dd_improvement"] == pytest.approx(-0.0087)


def test_optimizer_ranks_shallower_first():
    """The suggestion list puts the candidate that hurts the drawdown least first.

    The constant-yield one-strategy book makes sharpe_lift and corr_reduction
    None for every candidate, so drawdown is the only axis that can order them
    (otherwise real Sharpe/correlation noise could mask a flipped sign).
    """
    res = find_improvement_candidates(
        {"s1": _s(BOOK_B)},
        {"mild": _s(CAND_B), "deep": _s(CAND_DEEP)},
        {"s1": 1.0},
        add_weight=0.10,
    )
    assert [r["strategy_id"] for r in res] == ["mild", "deep"]
    assert [r["dd_improvement"] for r in res] == pytest.approx([-0.0087, -0.0491])


def test_match_engine_ranks_shallower_first():
    """The match ranking rewards the shallower book.

    One-strategy constant-yield book (drawdown is the only axis that can order
    the candidates), ticket 10 over AUM 100 gives add_weight 0.10. The 8.0
    gap between the two scores is exactly
    100 * W_PORTFOLIO_FIT * W_DD_IMPROVEMENT * (1.0 - 0.0) = 100 * 0.40 * 0.20.
    """
    result = score_candidates(
        allocator_id="a1",
        preferences={"target_ticket_size_usd": 10.0},
        portfolio_strategies=[{"strategy_id": "s1"}],
        portfolio_returns={"s1": _s(BOOK_B)},
        portfolio_weights={"s1": 1.0},
        candidate_strategies=[_match_candidate("deep"), _match_candidate("mild")],
        candidate_returns={"mild": _s(CAND_B), "deep": _s(CAND_DEEP)},
        portfolio_aum=100.0,
    )
    ranked = result["candidates"]
    assert [c["strategy_id"] for c in ranked] == ["mild", "deep"]
    assert ranked[0]["score"] == pytest.approx(57.5, abs=1e-3)
    assert ranked[1]["score"] == pytest.approx(49.5, abs=1e-3)


def test_all_three_scorers_agree_on_the_sign_and_value():
    """The same Case A inputs give the same number at every scorer, bridge included.

    This is the test that stops a fifth independent copy of the sign landing
    green: the simulator, the optimizer and the match engine must agree with
    each other, and the bridge's replacement delta must equal
    drawdown_improvement of the two books' own max drawdowns.
    """
    sim = simulate_add_candidate(
        {"s1": _s(BOOK_A)}, "c1", _s(CAND_A), {"s1": 1.0}, add_weight=0.5
    )["deltas"]["dd_delta"]
    opt = find_improvement_candidates(
        {"s1": _s(BOOK_A)}, {"c1": _s(CAND_A)}, {"s1": 1.0}, add_weight=0.5
    )[0]["dd_improvement"]
    mat = _compute_portfolio_fit_components(
        _s(BOOK_A), {"s1": 1.0}, {"s1": _s(BOOK_A)}, _s(CAND_A), add_weight=0.5
    )["dd_improvement"]
    assert sim == pytest.approx(0.228)
    assert opt == pytest.approx(sim)
    assert mat == pytest.approx(sim)

    # Bridge leg: replacing a crashing incumbent with a smooth candidate
    # shallows the book, so dd_delta is positive and equals the helper applied
    # to the two blended books.
    mild = [0.001] * 40
    crash = [0.001] * 10 + [-0.05] * 10 + [0.001] * 20
    smooth = [0.002] * 40
    rows = find_replacement_candidates(
        {"s1": _s(mild), "s2": _s(crash)},
        {"c1": _s(smooth)},
        {"s1": 0.5, "s2": 0.5},
        incumbent_strategy_id="s2",
    )
    assert rows, "expected the smooth candidate to be scored"
    before = _max_drawdown(0.5 * _s(mild) + 0.5 * _s(crash))
    after = _max_drawdown(0.5 * _s(mild) + 0.5 * _s(smooth))
    assert rows[0]["dd_delta"] > 0
    assert rows[0]["dd_delta"] == pytest.approx(drawdown_improvement(before, after))
