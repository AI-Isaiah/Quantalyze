"""Phase 167.1.1.1 plan 02 (D-15, D-16, D-18) and Phase 167.1.1.2 D-06: the Python half of
the AUM basis, replayed against the case table the TypeScript functions read too
(``tests/fixtures/holding_equity_contribution_cases.json``;
``holdingEquityContribution`` in ``src/lib/holding-equity.ts``). Each case carries ONE
``expected`` that both runtimes must return.

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
    if case["expected"] is None:
        assert got is None
    else:
        assert got == case["expected"]


def test_one_expectation_for_both_runtimes() -> None:
    """Since 167.1.1.2 D-06 there is no divergence: a case carries ONE ``expected`` and the
    two retired per-runtime keys cannot return. A NULL derivative P&L is withheld in both
    runtimes."""
    for case in _SPEC["cases"]:
        assert "expected" in case, case["name"]
        assert "expected_ts" not in case, case["name"]
        assert "expected_py" not in case, case["name"]
    by_name = {c["name"]: c for c in _SPEC["cases"]}
    assert by_name["derivative_null_pnl_is_withheld"]["expected"] is None


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
