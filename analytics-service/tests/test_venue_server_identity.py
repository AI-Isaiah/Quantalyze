"""Phase 225 plan 06 (CONN-03, MT5D-08): the Python half of the broker-server
identity rule, replayed against the case table the TS twin reads too
(``tests/fixtures/venue_server_identity.json``; ``src/lib/venue-identity.ts``).

The expectations in that file are hand-typed. Nothing here derives one from the
code under test.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from services.account_identity import (
    MAX_VENUE_SERVER_LENGTH,
    normalise_venue_server,
    pick_same_account_holder,
    same_venue_server,
)

_SPEC = json.loads(
    (Path(__file__).parent / "fixtures" / "venue_server_identity.json").read_text(
        encoding="utf-8"
    )
)


def test_the_shared_fixture_is_not_vacuous() -> None:
    assert len(_SPEC["normalise"]) > 0
    assert len(_SPEC["same"]) > 0
    assert len(_SPEC["pick"]) > 0


@pytest.mark.parametrize("case", _SPEC["normalise"], ids=lambda c: repr(c["in"])[:40])
def test_normalise_venue_server(case: dict[str, Any]) -> None:
    assert normalise_venue_server(case["in"]) == case["out"]


def test_normalise_counts_code_points_like_the_databases_char_length() -> None:
    assert MAX_VENUE_SERVER_LENGTH == 128
    assert normalise_venue_server("\U0001f600" * 128) == "\U0001f600" * 128
    assert normalise_venue_server("\U0001f600" * 129) is None


@pytest.mark.parametrize("case", _SPEC["same"], ids=lambda c: f"{c['a']}-{c['b']}")
def test_same_venue_server(case: dict[str, Any]) -> None:
    assert same_venue_server(case["a"], case["b"]) is case["same"]


def _pick_id(case: dict[str, Any], rows: list[dict[str, Any]]) -> str | None:
    picked = pick_same_account_holder(
        rows,
        case["server"],
        after_index_refusal=case["mode"] == "after_index_refusal",
    )
    return None if picked is None else str(picked["id"])


@pytest.mark.parametrize("case", _SPEC["pick"], ids=lambda c: c["name"])
def test_pick_same_account_holder(case: dict[str, Any]) -> None:
    assert _pick_id(case, case["rows"]) == case["expect"]


@pytest.mark.parametrize("case", _SPEC["pick"], ids=lambda c: c["name"])
def test_pick_does_not_depend_on_row_order(case: dict[str, Any]) -> None:
    assert _pick_id(case, list(reversed(case["rows"]))) == case["expect"]
