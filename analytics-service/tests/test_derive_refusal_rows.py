"""Phase 167.1.2.1.1 WRITERRESIDUALS, SC-1 (decision D-04): the refusal row the
allocator equity derive persists, asserted against ONE table the TS reader and
the SQL census mirror also read.

WHY this matters. A derive refusal used to delete the (allocator_id,
'equity_curve') row, and the reader then told the owner the history is
"recomputed daily" while the derive had refused it and would refuse it again
tomorrow. The refusal now persists WHY in the same row, and the reader maps each
token onto a line it already has. Three runtimes have to agree on that row: this
file asserts the payload the writer builds, ``src/lib/__tests__/derive-refusal-rows.test.ts``
asserts the reader's verdict, and ``src/__tests__/accounttruth-census.test.ts``
asserts the census CASE. The fixture is loaded in place, never copied.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "derive_refusal_rows.json"
TABLE: dict[str, Any] = json.loads(FIXTURE.read_text())


@pytest.mark.parametrize("row", TABLE["refusals"], ids=lambda r: r["token"])
def test_refusal_payload_is_the_fixture_row(row: dict[str, Any]) -> None:
    """The writer builds exactly the payload the fixture states, so the reader
    test and the census pin evaluate the shape the worker really writes."""
    from services.allocator_equity_derive import refusal_payload

    built = refusal_payload(
        row["token"],
        composed_at=TABLE["composed_at"],
        extra_reasons=tuple(row["extra_reasons"]),
    )
    # Through JSON, as the row is stored: enum members must serialise as tokens.
    assert json.loads(json.dumps(built)) == row["payload"]


# The reader lines a degrade_reasons token can map to. All exist in the reader
# already (EquityHistoryRebuildReason in src/lib/queries.ts); a value outside
# this set would mean a new owner-facing line, which this phase does not add.
EXISTING_READER_LINES = {
    "awaiting_derivation",
    "derivation_rejected",
    "duplicate_account",
    "account_identity_pending",
    "shared_account_no_working_key",
    "shared_account_history_truncated",
}


def test_the_fixture_has_one_refusal_row_per_derive_refusal_member() -> None:
    """A member added to ``DeriveRefusal`` without a fixture row, or a row left
    behind for a removed member, fails here by name. Without this, a token the
    reader and the census never learned would still persist, and the owner
    would read the generic line for a cause the fixture never pinned."""
    from services.allocator_equity_derive import DeriveRefusal

    tokens = [row["token"] for row in TABLE["refusals"]]
    assert len(tokens) == len(set(tokens)), "a token appears twice"
    assert set(tokens) == {m.value for m in DeriveRefusal}
    for row in TABLE["refusals"]:
        assert row["reader_reason"] in EXISTING_READER_LINES, row["token"]


def test_the_fixture_has_one_blocking_row_per_blocking_degrade_reason() -> None:
    """The reader falls back to ``derivation_rejected`` for any blocking token it
    has no line for, and names the two shared-account tokens. A blocking token
    added to the writer without a row here is a decision nobody made."""
    from services.allocator_equity_derive import _BLOCKING_REASONS

    tokens = [row["token"] for row in TABLE["blocking"]]
    assert len(tokens) == len(set(tokens)), "a token appears twice"
    assert set(tokens) == {r.value for r in _BLOCKING_REASONS}
    for row in TABLE["blocking"]:
        assert row["reader_reason"] in EXISTING_READER_LINES, row["token"]


def test_every_precedence_row_names_an_existing_line_over_known_tokens() -> None:
    """A precedence row is a multi-token ``degrade_reasons`` array. Each token is
    one the writer can really produce (a refusal token or a DegradeReason value),
    so the table cannot pin an order for a pair that never occurs."""
    from services.allocator_equity_derive import DegradeReason, DeriveRefusal

    producible = {m.value for m in DeriveRefusal} | {m.value for m in DegradeReason}
    assert TABLE["precedence"], "the precedence table must not be empty"
    for row in TABLE["precedence"]:
        assert set(row["degrade_reasons"]) <= producible, row
        assert row["reader_reason"] in EXISTING_READER_LINES, row
