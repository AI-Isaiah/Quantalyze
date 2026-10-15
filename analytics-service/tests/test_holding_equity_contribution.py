"""Phase 167.1.1.1 plan 02 (D-15, D-16, D-18): the Python half of the matcher's AUM basis,
replayed against the case table the TypeScript twins read too
(``tests/fixtures/holding_equity_contribution_cases.json``;
``holdingEquityContribution`` in ``src/lib/queries.ts``).

Every figure in that file is hand-typed. Nothing here derives an expectation from the
code under test.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from services.holding_equity import holding_equity_contribution

_SPEC = json.loads(
    (Path(__file__).parent / "fixtures" / "holding_equity_contribution_cases.json").read_text()
)

_NONFINITE = {"NaN": float("nan"), "Infinity": float("inf"), "-Infinity": float("-inf")}


def _decode(value: Any) -> Any:
    """Turn the fixture's ``{"nonfinite": ...}`` sentinel into the float it names."""
    if isinstance(value, dict) and set(value) == {"nonfinite"}:
        return _NONFINITE[value["nonfinite"]]
    return value


def _row(case: dict[str, Any]) -> dict[str, Any]:
    return {
        "holding_type": case["holding_type"],
        "value_usd": _decode(case["value_usd"]),
        "unrealized_pnl_usd": _decode(case["unrealized_pnl_usd"]),
    }


@pytest.mark.parametrize("case", _SPEC["cases"], ids=lambda c: c["name"])
def test_holding_equity_contribution_matches_the_shared_table(case: dict[str, Any]) -> None:
    got = holding_equity_contribution(_row(case))
    if case["expected_py"] is None:
        assert got is None
    else:
        assert got == case["expected_py"]
