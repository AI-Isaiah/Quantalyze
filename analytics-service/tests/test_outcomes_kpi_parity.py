"""Phase 5 D-21 cross-runtime parity test (Voice-D2 option a).

Asserts that Phase 4 `feedback_engine._success_value` produces per-row
success values and most-mature deltas that match the TypeScript side's
`tests/fixtures/outcomes-kpi-parity.json` expected payload. Running this
test gated on HAS_PY_ENV=1 prevents drift between Phase 4 (Python) and
Phase 5 (TypeScript) — any change to Phase 4 filter rules must update
BOTH the fixture AND this test in the same PR.
"""
import json
import os
import pathlib

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("HAS_PY_ENV") != "1",
    reason="Python parity test gated on HAS_PY_ENV=1 (Phase 5 D-21 / Voice-D2 option a)",
)


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "outcomes-kpi-parity.json"


@pytest.fixture(scope="module")
def fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


def test_fixture_path_resolves(fixture: dict) -> None:
    """The TS-side fixture must be readable from the Python tree."""
    assert "outcomes" in fixture
    assert "expected" in fixture
    assert "phase4_success_values" in fixture


def test_success_value_matches_per_row(fixture: dict) -> None:
    """feedback_engine._success_value returns 1 iff most-mature non-NULL delta > 0.

    The fixture's `phase4_success_values` map is the authoritative source
    of expected per-row success values. Any drift here means Phase 5
    dashboard math + Phase 4 scoring engine have diverged.
    """
    from services.feedback_engine import _success_value

    expected = fixture["phase4_success_values"]
    for outcome in fixture["outcomes"]:
        oid = outcome["id"]
        if oid not in expected:
            # Outcome didn't survive Phase 4 filters (e.g. rejected-already_owned
            # or allocated-pending-only) — not asserted here; see
            # test_mature_survivors for filter-level parity.
            continue
        assert _success_value(outcome) == expected[oid], (
            f"Row {oid}: _success_value disagrees with TS expected "
            f"({_success_value(outcome)} vs {expected[oid]})"
        )


def test_mature_survivors_match(fixture: dict) -> None:
    """Rows that SHOULD pass D-08 + D-03 filters for Phase 4 must match
    the TS-side `phase4_mature_survivors` list.
    """
    expected_survivors = set(fixture["phase4_mature_survivors"])
    actual_survivors: set[str] = set()
    for outcome in fixture["outcomes"]:
        kind = outcome["kind"]
        if kind == "rejected":
            if outcome["rejection_reason"] == "already_owned":
                continue
            actual_survivors.add(outcome["id"])
        elif kind == "allocated":
            if (outcome["percent_allocated"] or 0) < 1.0:
                continue
            has_delta = any(
                outcome.get(k) is not None
                for k in ("delta_30d", "delta_90d", "delta_180d")
            )
            if not has_delta:
                continue
            actual_survivors.add(outcome["id"])
    # NOTE: phase4_mature_survivors in the fixture lists ONLY allocated
    # survivors (the TS KPI denominator); rejected-non-already_owned
    # survive Phase 4 for attribution but are out of KPI denominator scope.
    # Restrict the actual set to allocated kind for parity.
    actual_allocated_survivors = {
        outcome["id"]
        for outcome in fixture["outcomes"]
        if outcome["id"] in actual_survivors and outcome["kind"] == "allocated"
    }
    assert actual_allocated_survivors == expected_survivors
