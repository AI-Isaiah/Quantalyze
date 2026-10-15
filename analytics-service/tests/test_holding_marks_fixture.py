"""Phase 167.1.1.1 (BRIDGERETURNS) D-02, D-03, SC3: the Python half of the mark-price rule
(spot and signed derivative), replayed against the case table the TypeScript twin reads too
(``tests/fixtures/holding_mark_returns_cases.json``; ``classifySpotMarks`` and
``classifyDerivativeMarks`` in ``src/app/(dashboard)/compare/lib/holding-compare-adapter.ts``).

Every expectation in that file is hand-typed. Nothing here derives an expectation from
the code under test.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from services.allocator_equity_derive import HoldingsUpdatedAtError
from services.closed_sets import CRYPTO_VENUES
from services.holding_marks import (
    MIN_PRICED_DAYS,
    PRICE_RULE_WITHHELD_REASONS,
    DailyMark,
    HoldingMarkContractError,
    DirectedMark,
    adjacent_daily_returns,
    classify_holding_marks,
    classify_spot_marks,
    is_option_symbol,
    signed_adjacent_returns,
)

_SPEC = json.loads(
    (Path(__file__).parent / "fixtures" / "holding_mark_returns_cases.json").read_text()
)
_CASES: list[dict[str, Any]] = _SPEC["cases"]
assert len(_SPEC["cases"]) > 15, "the shared fixture lost cases"
_ERRORS: dict[str, type[Exception]] = {
    "HoldingMarkContractError": HoldingMarkContractError,
    "HoldingsUpdatedAtError": HoldingsUpdatedAtError,
}


def test_the_shared_spec_matches_the_module_constants() -> None:
    """The 30-day minimum and the reason vocabulary are one decision in two runtimes."""
    assert _SPEC["min_priced_days"] == MIN_PRICED_DAYS
    assert sorted(PRICE_RULE_WITHHELD_REASONS) == _SPEC["withheld_reasons"]


def test_venue_census_matches_the_shared_fixture() -> None:
    """The account_balance gate rests on which venues are crypto exchanges. The fixture's
    hand-typed list is read by both runtimes, so a venue added to one set only goes RED."""
    assert sorted(CRYPTO_VENUES) == _SPEC["crypto_venues"]


@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
def test_case_matches_the_shared_table(case: dict[str, Any]) -> None:
    assert case["holding_type"] in ("spot", "derivative")
    args = {"venue": case["venue"], "symbol": case["symbol"], "holding_type": case["holding_type"]}
    if "expect_error" in case:
        with pytest.raises(_ERRORS[case["expect_error"]]):
            classify_holding_marks(case["rows"], **args)
        return
    got = classify_holding_marks(case["rows"], **args)
    want = case["expected"]
    assert got.withheld_reason == want["withheld"]
    assert got.priced_days == want["priced_days"]
    assert [day for day, _ in got.returns] == [day for day, _ in want["returns"]]
    assert [value for _, value in got.returns] == pytest.approx(
        [value for _, value in want["returns"]], rel=1e-12, abs=1e-12
    )


# ---------------------------------------------------------------------------
# Independent invariants: properties of a return series that hold whatever the
# implementation does, so they are not copies of it.
# ---------------------------------------------------------------------------
def _spot_rows(marks: list[float], values: list[float], quantities: list[float]) -> list[dict[str, Any]]:
    return [
        {
            "asof": f"2026-01-{i + 1:02d}",
            "mark_price": mark,
            "side": "flat",
            "updated_at": f"2026-01-{i + 1:02d}T10:00:00Z",
            "api_key_id": "key-a",
            "value_usd": values[i],
            "quantity": quantities[i],
        }
        for i, mark in enumerate(marks)
    ]


def test_a_constant_mark_gives_all_zero_returns_whatever_the_dollar_path() -> None:
    """The reason the price rule exists: buying, selling or moving an asset moves the
    quantity and the dollar value but never the price, so it must never read as a return."""
    rows = _spot_rows(
        marks=[250.0] * 6,
        values=[250.0, 500.0, 125.0, 1250.0, 2.5, 250.0],
        quantities=[1.0, 2.0, 0.5, 5.0, 0.01, 1.0],
    )
    got = classify_spot_marks(rows, venue="binance", symbol="ETH")
    assert got.priced_days == 6
    assert len(got.returns) == 5
    assert all(value == 0.0 for _, value in got.returns)


def test_gap_free_returns_compound_back_to_the_price_ratio() -> None:
    """Telescoping: the product of (1 + r) over an unbroken chain is last / first."""
    marks = [100.0, 120.0, 90.0, 135.0, 108.0]
    rows = _spot_rows(marks, marks, [1.0] * 5)
    got = classify_spot_marks(rows, venue="okx", symbol="BTC")
    growth = 1.0
    for _, value in got.returns:
        growth *= 1 + value
    assert growth == pytest.approx(108.0 / 100.0, rel=1e-12)


def test_a_return_is_keyed_by_the_later_day() -> None:
    """The move from day 1 to day 2 is observed on day 2, so no return is keyed day 1."""
    points = [DailyMark("2026-01-01", 100.0), DailyMark("2026-01-02", 110.0), DailyMark("2026-01-03", 99.0)]
    days = [day for day, _ in adjacent_daily_returns(points)]
    assert days == ["2026-01-02", "2026-01-03"]
    assert "2026-01-01" not in days


# ---------------------------------------------------------------------------
# Derivative invariants (D-02, D-12): properties that hold whatever the implementation does.
# ---------------------------------------------------------------------------
def _directed(prices: list[float], direction: str) -> list[DirectedMark]:
    return [DirectedMark(f"2026-01-{i + 1:02d}", p, direction) for i, p in enumerate(prices)]


def test_a_short_return_is_minus_the_long_return_for_the_same_prices() -> None:
    """Holding the opposite side over the same interval earns exactly the opposite return
    (where no floor applies): the signed rule is a sign flip, not a different measure."""
    prices = [100.0, 110.0, 99.0, 104.0, 100.0]
    long_r = signed_adjacent_returns(_directed(prices, "long"))
    short_r = signed_adjacent_returns(_directed(prices, "short"))
    assert [day for day, _ in short_r] == [day for day, _ in long_r]
    assert [v for _, v in short_r] == pytest.approx([-v for _, v in long_r], rel=1e-12)


def test_a_day_without_direction_never_signs_or_receives_a_return() -> None:
    """No guessed sign: a direction-less day neither signs the interval after it nor
    receives the interval before it."""
    days = [
        DirectedMark("2026-01-01", 100.0, "long"),
        DirectedMark("2026-01-02", 110.0, None),
        DirectedMark("2026-01-03", 121.0, "long"),
    ]
    assert signed_adjacent_returns(days) == []


def test_a_signed_return_is_never_below_the_floor() -> None:
    """A holder cannot lose more than the position: whatever the spike, r >= -1."""
    for spike in (1.5, 2.0, 2.5, 10.0, 1000.0):
        returns = signed_adjacent_returns(_directed([1.0, spike], "short"))
        assert all(v >= -1.0 for _, v in returns)


def test_the_option_classifier_is_the_instrument_classifier() -> None:
    assert is_option_symbol("BTC-10OCT26-81000-P")
    assert is_option_symbol("btc-10oct26-81000-c")
    assert is_option_symbol("ETH_USDC-27MAR26-50000-C")
    assert not is_option_symbol("BTC-PERPETUAL")
    assert not is_option_symbol("BTC-27MAR26")
    assert not is_option_symbol("1000PEPEUSDT")


def test_an_unknown_holding_type_is_a_caller_bug() -> None:
    with pytest.raises(ValueError):
        classify_holding_marks([], venue="binance", symbol="BTC", holding_type="swap")
