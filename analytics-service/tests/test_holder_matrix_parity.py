"""Phase 167.1.2 C2 review round 2, R2-WR-01: the derive's resolution of a
shared account, asserted against ONE table the TS reader also reads.

WHY this matters. The reader (``equityHistoryReadiness`` in src/lib/queries.ts)
shows a book "ready" behind a duplicate whose holder is not working, and that
is only correct while the derive counts that account ONCE, through its working
member (round 1's holder-drop half). The two sides were tied by a prose comment
alone: a revert of the holder-drop half would let the reader show a
double-counted curve as ready while every suite stayed green. The table in
``tests/fixtures/shared_account_resolution.json`` states, per holder state x
marked-key state x marker kind, what the derive counts and what the reader
shows; this file asserts the derive, ``src/lib/__tests__/holder-matrix-parity.test.ts``
asserts the reader. Either side drifting fails CI.

The counted set is read off the persisted curve: each key carries a distinct
anchor, the returns are flat, so the terminal equity is the sum of the counted
keys' anchors and ``n_keys`` is their number. A double count cannot hide.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tests.test_derive_allocator_equity_job import (
    DERIVED_TABLE,
    LEGACY_TABLE,
    _curve_deletes,
    _curve_upserts,
    _extract_payload,
    _FakeSupabase,
    _gate_key,
    _run_gate,
    _stale_curve,
)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "shared_account_resolution.json"
TABLE: dict[str, Any] = json.loads(FIXTURE.read_text())
DAYS = ["2026-06-01", "2026-06-02", "2026-06-03"]
KEY_IDS = {"O": "key-O", "H": "key-H", "M": "key-M"}


def _book(alloc: str, cell: dict[str, Any]) -> _FakeSupabase:
    states = TABLE["states"]
    exchange = TABLE["exchange"]
    keys = [
        _gate_key(
            KEY_IDS["O"], alloc, exchange=exchange, venue_account_id="venue-own",
            **states["working"],
        ),
        _gate_key(
            KEY_IDS["H"], alloc, exchange=exchange, venue_account_id="venue-shared",
            **states[cell["holder"]],
        ),
        _gate_key(
            KEY_IDS["M"], alloc, exchange=exchange, venue_account_id=None,
            account_share_kind=cell["kind"],
            account_shared_with_api_key_id=KEY_IDS["H"],
            **states[cell["marked"]],
        ),
    ]
    csv = [
        {"api_key_id": key_id, "allocator_id": alloc, "date": day, "daily_return": 0.0}
        for key_id in KEY_IDS.values()
        for day in DAYS
    ]
    derived = [
        {
            "allocator_id": alloc,
            "kind": f"key_inputs:{KEY_IDS[name]}",
            "payload": {
                "flows": [], "anchor_usd": anchor,
                "anchor_asof": DAYS[-1], "venue": exchange,
            },
        }
        for name, anchor in TABLE["anchors"].items()
    ]
    return _FakeSupabase({
        "api_keys": keys,
        "csv_daily_returns": csv,
        DERIVED_TABLE: derived + [_stale_curve(alloc)],
        LEGACY_TABLE: [],
    })


def _cell_id(cell: dict[str, Any]) -> str:
    return f"{cell['kind']}-H_{cell['holder']}-M_{cell['marked']}"


def test_the_table_covers_every_cell_once() -> None:
    """2 kinds x 6 holder states x 6 marked states, each exactly once, so a
    row deleted from the table is a failure and not a silent gap."""
    cells = {(c["kind"], c["holder"], c["marked"]) for c in TABLE["cells"]}
    states = set(TABLE["states"])
    assert len(TABLE["cells"]) == len(cells) == 2 * len(states) ** 2
    assert {c[0] for c in cells} == {"duplicate", "composite_member"}


@pytest.mark.asyncio
@pytest.mark.parametrize("cell", TABLE["cells"], ids=_cell_id)
async def test_the_derive_resolves_each_cell_as_the_table_says(cell: dict[str, Any]) -> None:
    alloc = f"alloc-{_cell_id(cell)}"
    fake = _book(alloc, cell)
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    expected = cell["derive"]
    if expected["outcome"] == "refuse":
        assert _curve_upserts(fake) == [], "the table says the curve is refused"
        assert len(_curve_deletes(fake, alloc)) == 1
        return
    upserts = _curve_upserts(fake)
    assert len(upserts) == 1, f"expected a composed curve, got {len(upserts)}"
    payload = _extract_payload(upserts[0][1])
    counted = expected["counted"]
    assert payload["inputs"]["n_keys"] == len(counted)
    terminal = payload["curve"][-1]["equity_usd"]
    want = sum(TABLE["anchors"][name] for name in counted)
    assert terminal == pytest.approx(want, rel=1e-9), (
        f"counted {counted} should end at {want}; the curve ends at {terminal}"
    )
    assert payload["is_trustworthy"] is expected["trustworthy"], payload["degrade_reasons"]
