"""Phase 167.2.1.1.1.1 plan 09 (D-07, UI-SPEC U-06): the Python half of the stored price-gap
rule, replayed against the case table the TypeScript predicate reads too
(``tests/fixtures/holding_price_gap_cases.json``; ``holdingIsPriceGap`` in
``src/lib/holding-equity.ts``). Each case carries ONE ``expected_gap`` that both runtimes
must return.

Every figure in that file is hand-typed. Nothing here derives an expectation from the code
under test.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from services.holding_equity import is_price_gap_holding

_SPEC = json.loads(
    (Path(__file__).parent / "fixtures" / "holding_price_gap_cases.json").read_text()
)

_NONFINITE = {"NaN": float("nan"), "Infinity": float("inf"), "-Infinity": float("-inf")}


def _decode(value: Any) -> Any:
    """Turn the fixture's ``{"nonfinite": ...}`` sentinel into the float it names."""
    if isinstance(value, dict) and set(value) == {"nonfinite"}:
        return _NONFINITE[value["nonfinite"]]
    return value


def _row(case: dict[str, Any]) -> dict[str, Any]:
    row: dict[str, Any] = {
        "holding_type": case["holding_type"],
        "quantity": _decode(case["quantity"]),
    }
    # An ABSENT mark is a case with no ``mark_price`` key: the row omits it too.
    if "mark_price" in case:
        row["mark_price"] = _decode(case["mark_price"])
    return row


@pytest.mark.parametrize("case", _SPEC["cases"], ids=lambda c: c["name"])
def test_price_gap_matches_the_shared_table(case: dict[str, Any]) -> None:
    assert is_price_gap_holding(_row(case)) is case["expected_gap"]


def test_one_expectation_for_both_runtimes() -> None:
    """A case carries ONE boolean ``expected_gap`` and no per-runtime key."""
    for case in _SPEC["cases"]:
        assert isinstance(case.get("expected_gap"), bool), case["name"]
        assert "expected_gap_ts" not in case, case["name"]
        assert "expected_gap_py" not in case, case["name"]


def test_fixture_pins_the_edges_the_rule_names() -> None:
    """A thin fixture would let a rewritten predicate pass. The edges D-07 names must each
    be present."""
    cases = _SPEC["cases"]
    assert len(cases) >= 16
    assert any(c.get("mark_price") == 0 for c in cases), "a zero mark"
    assert any(isinstance(c.get("mark_price"), dict) for c in cases), "a non-finite mark"
    assert any("mark_price" not in c for c in cases), "an absent mark"
    assert any(c["quantity"] == 0 for c in cases), "a zero quantity"
    assert any(c["holding_type"] == "derivative" for c in cases), "a derivative"
