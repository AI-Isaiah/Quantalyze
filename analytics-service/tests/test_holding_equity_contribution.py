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


def test_python_diverges_from_typescript_only_on_the_d18_case() -> None:
    """D-18 allows exactly one behavioural difference from ``holdingEquityContribution``:
    a derivative with a NULL P&L is withheld here and counted 0 there. A second
    divergence, or the loss of this one, fails here."""
    diverging = {c["name"] for c in _SPEC["cases"] if c["expected_py"] != c["expected_ts"]}
    assert diverging == {"derivative_null_pnl_is_withheld"}


def test_fixture_pins_the_edges_the_rule_names() -> None:
    """A thin fixture would let a rewritten helper pass. The edges D-16 and D-18 name
    must each be present."""
    names = {c["name"] for c in _SPEC["cases"]}
    assert {
        "derivative_counts_pnl_not_notional",
        "losing_short_kept_signed",
        "option_pnl_counts",
        "deribit_inverse_perp_pnl",
        "derivative_null_pnl_is_withheld",
        "spot_counts_value",
    } <= names
    assert len(_SPEC["cases"]) >= 13
