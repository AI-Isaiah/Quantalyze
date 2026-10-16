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
