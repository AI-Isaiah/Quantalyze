"""Phase 167.1.1.1 (BRIDGERETURNS) D-03, SC3: the Python half of the SPOT mark-price rule,
replayed against the case table the TypeScript twin reads too
(``tests/fixtures/holding_mark_returns_cases.json``;
``classifySpotMarks`` in ``src/app/(dashboard)/compare/lib/holding-compare-adapter.ts``).

Every expectation in that file is hand-typed. Nothing here derives an expectation from
the code under test.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from services.allocator_equity_derive import HoldingsUpdatedAtError
from services.holding_marks import (
    MIN_PRICED_DAYS,
    PRICE_RULE_WITHHELD_REASONS,
    HoldingMarkContractError,
    classify_spot_marks,
)

_SPEC = json.loads(
    (Path(__file__).parent / "fixtures" / "holding_mark_returns_cases.json").read_text()
)
_CASES: list[dict[str, Any]] = _SPEC["cases"]
_ERRORS: dict[str, type[Exception]] = {
    "HoldingMarkContractError": HoldingMarkContractError,
    "HoldingsUpdatedAtError": HoldingsUpdatedAtError,
}


def test_the_shared_spec_matches_the_module_constants() -> None:
    """The 30-day minimum and the reason vocabulary are one decision in two runtimes."""
    assert _SPEC["min_priced_days"] == MIN_PRICED_DAYS
    assert sorted(PRICE_RULE_WITHHELD_REASONS) == _SPEC["withheld_reasons"]


@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
def test_spot_case_matches_the_shared_table(case: dict[str, Any]) -> None:
    assert case["holding_type"] == "spot"
    if "expect_error" in case:
        with pytest.raises(_ERRORS[case["expect_error"]]):
            classify_spot_marks(case["rows"], venue=case["venue"], symbol=case["symbol"])
        return
    got = classify_spot_marks(case["rows"], venue=case["venue"], symbol=case["symbol"])
    want = case["expected"]
    assert got.withheld_reason == want["withheld"]
    assert got.priced_days == want["priced_days"]
    assert [day for day, _ in got.returns] == [day for day, _ in want["returns"]]
    assert [value for _, value in got.returns] == pytest.approx(
        [value for _, value in want["returns"]], rel=1e-12, abs=1e-12
    )
