"""Phase 167.1.2.1.1 WRITERRESIDUALS plan 02 (decision D-03): the derive's blocking
tokens for a book the writer can no longer vouch for, asserted against ONE table the
TS reader also reads.

WHY this matters. The derive raises a blocking token (``failing_key_series_ended``,
``account_identity_pending``) and the reader maps that token onto a line the owner
already sees. If the two halves drift, a diluted book reads "ready" or a healthy one
reads "rebuilding" and every suite stays green on its own side. The table in
``tests/fixtures/writer_residual_resolution.json`` states, per key list, the
blocking tokens the derive carries and the verdict the reader gives; this file runs
the derive over every cell, ``src/lib/__tests__/writer-residual-parity.test.ts`` runs
the reader over the same cell.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tests.test_derive_allocator_equity_job import (
    DERIVED_TABLE,
    LEGACY_TABLE,
    _composed_payload,
    _FakeSupabase,
    _gate_key,
    _run_gate,
    _stale_curve,
)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "writer_residual_resolution.json"
TABLE: dict[str, Any] = json.loads(FIXTURE.read_text())


def _book(alloc: str, cell: dict[str, Any]) -> _FakeSupabase:
    days: list[str] = TABLE["days"]
    keys: list[dict[str, Any]] = []
    csv: list[dict[str, Any]] = []
    derived: list[dict[str, Any]] = [_stale_curve(alloc)]
    for key in cell["keys"]:
        keys.append(
            _gate_key(
                key["id"], alloc,
                exchange=key["exchange"],
                sync_status=key["sync_status"],
                venue_account_id=key["venue_account_id"],
                account_share_kind=key.get("account_share_kind"),
                account_shared_with_api_key_id=key.get("account_shared_with_api_key_id"),
            )
        )
        own_days = days[: key["days"]]
        csv += [
            {"api_key_id": key["id"], "allocator_id": alloc, "date": day, "daily_return": 0.0}
            for day in own_days
        ]
        derived.append({
            "allocator_id": alloc,
            "kind": f"key_inputs:{key['id']}",
            "payload": {
                "flows": [], "anchor_usd": key["anchor"],
                "anchor_asof": own_days[-1], "venue": key["exchange"],
            },
        })
    return _FakeSupabase({
        "api_keys": keys, "csv_daily_returns": csv, DERIVED_TABLE: derived, LEGACY_TABLE: [],
    })


def test_the_cells_are_unique_and_cover_every_derive_side_token() -> None:
    """A cell deleted from the table must fail here, not leave a token without
    cross-runtime coverage. ``failing_key_series_ended`` needs a cell that raises it
    AND one that does not."""
    ids = [cell["id"] for cell in TABLE["cells"]]
    assert len(ids) == len(set(ids)), "a cell id appears twice"
    raised = {t for c in TABLE["cells"] for t in c["derive"]["blocking_tokens"]}
    assert "failing_key_series_ended" in raised
    assert "account_identity_pending" in raised
    for sc in ("SC-2", "SC-6"):
        assert any(
            c["sc"] == sc and not c["derive"]["blocking_tokens"] for c in TABLE["cells"]
        ), f"{sc} needs a negative cell"


@pytest.mark.asyncio
@pytest.mark.parametrize("cell", TABLE["cells"], ids=lambda c: c["id"])
async def test_the_derive_carries_each_cells_blocking_tokens(cell: dict[str, Any]) -> None:
    from services.allocator_equity_derive import blocking_degrade_tokens

    alloc = f"alloc-{cell['id']}"
    fake = _book(alloc, cell)
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert blocking_degrade_tokens(payload["degrade_reasons"]) == sorted(
        cell["derive"]["blocking_tokens"]
    ), payload["degrade_reasons"]
    assert payload["is_trustworthy"] is cell["derive"]["trustworthy"]
