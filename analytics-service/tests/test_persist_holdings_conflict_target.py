"""170.4 D-10: ``persist_allocator_holdings`` upserts on the per-key conflict target and
falls back to the pre-D-10 target ONLY on SQLSTATE 42P10.

WHY this matters (the deploy window): the plan 09 migration widens ``allocator_holdings``'
unique index to include ``api_key_id`` and auto-applies to PROD on merge, while the Railway
worker deploys separately. Until that index exists, Postgres refuses the per-key
``ON CONFLICT`` with 42P10 (no unique index matches). The fallback keeps the worker writing
on either side of the migration. It must NOT widen: a 23505, an RLS refusal or a timeout is
a real failure that ``sync_status`` has to record, so each of those propagates untouched.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError

from services.allocator_positions import (
    HOLDINGS_CONFLICT_TARGET,
    HOLDINGS_CONFLICT_TARGET_PRE_D10,
    persist_allocator_holdings,
)

ALLOCATOR_ID = "00000000-0000-0000-0000-0000000000a1"
API_KEY_ID = "00000000-0000-0000-0000-0000000000b2"
ASOF = "2026-10-11"

NO_MATCHING_INDEX = APIError(
    {
        "code": "42P10",
        "message": "there is no unique or exclusion constraint matching the ON CONFLICT specification",
    }
)


def _holdings() -> list[dict[str, Any]]:
    return [
        {"venue": "deribit", "symbol": "BTC", "value_usd": 100.0},
        {"venue": "deribit", "symbol": "ETH", "value_usd": 50.0},
    ]


def _client(*outcomes: Exception | None) -> tuple[MagicMock, list[dict[str, Any]]]:
    """A fake client whose Nth upsert raises ``outcomes[N]`` (``None`` succeeds).

    Returns the client and the ordered record of every ``upsert(rows, on_conflict=...)``.
    """
    calls: list[dict[str, Any]] = []
    queue = list(outcomes)

    def _upsert(rows, on_conflict=None):  # noqa: ANN001
        calls.append({"rows": rows, "on_conflict": on_conflict})
        outcome = queue.pop(0) if queue else None
        chain = MagicMock()
        if outcome is not None:
            chain.execute.side_effect = outcome
        else:
            chain.execute.return_value = MagicMock(data=rows)
        return chain

    table = MagicMock()
    table.upsert.side_effect = _upsert
    client = MagicMock()
    client.table.return_value = table
    return client, calls


def test_constants_are_the_per_key_and_the_pre_d10_targets():
    assert HOLDINGS_CONFLICT_TARGET == "allocator_id,venue,symbol,asof,api_key_id"
    assert HOLDINGS_CONFLICT_TARGET_PRE_D10 == "allocator_id,venue,symbol,asof"


_PER_KEY_MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20261011120000_allocator_holdings_per_key_unique.sql"
)


def _migration_unique_index_columns() -> list[str]:
    """The column list of the migration's ``CREATE UNIQUE INDEX`` (comments stripped)."""
    live = "\n".join(
        line for line in _PER_KEY_MIGRATION.read_text().splitlines() if not line.lstrip().startswith("--")
    )
    found = re.findall(
        r"CREATE\s+UNIQUE\s+INDEX\s+\w+\s+ON\s+public\.allocator_holdings\s*\(([^)]*)\)",
        live,
        flags=re.IGNORECASE,
    )
    assert len(found) == 1, f"expected exactly one CREATE UNIQUE INDEX in the migration, found {len(found)}"
    return [col.strip() for col in found[0].split(",")]


def test_the_writers_conflict_target_is_the_migrations_unique_index():
    """ON CONFLICT needs a unique index over EXACTLY the target's columns, or Postgres answers 42P10.

    The writer's constant and the migration's index are two copies of one fact; this binds them
    so a column added to one cannot ship without the other (D-10).
    """
    index_columns = _migration_unique_index_columns()
    target_columns = HOLDINGS_CONFLICT_TARGET.split(",")
    assert len(index_columns) == len(set(index_columns)), "the index repeats a column"
    assert set(index_columns) == set(target_columns), (
        f"the writer upserts on {target_columns} but migration 20261011120000 indexes {index_columns}"
    )


@pytest.mark.asyncio
async def test_first_attempt_uses_the_per_key_target_and_stamps_every_row():
    client, calls = _client(None)

    written = await persist_allocator_holdings(
        client, _holdings(), ALLOCATOR_ID, API_KEY_ID, ASOF
    )

    assert written == 2
    assert len(calls) == 1, "a clean upsert makes exactly one call"
    # Two live keys on one venue holding one symbol must keep one row EACH (D-08/D-10):
    # that only holds if api_key_id is part of the conflict target.
    assert calls[0]["on_conflict"] == "allocator_id,venue,symbol,asof,api_key_id"
    for row in calls[0]["rows"]:
        assert row["allocator_id"] == ALLOCATOR_ID
        assert row["api_key_id"] == API_KEY_ID
        assert row["asof"] == ASOF


@pytest.mark.asyncio
async def test_42p10_retries_once_on_the_old_target_with_the_same_rows(caplog):
    client, calls = _client(NO_MATCHING_INDEX, None)

    with caplog.at_level(logging.INFO, logger="quantalyze.analytics.allocator_positions"):
        written = await persist_allocator_holdings(
            client, _holdings(), ALLOCATOR_ID, API_KEY_ID, ASOF
        )

    assert written == 2
    assert [c["on_conflict"] for c in calls] == [
        "allocator_id,venue,symbol,asof,api_key_id",
        "allocator_id,venue,symbol,asof",
    ]
    assert calls[0]["rows"] == calls[1]["rows"], "the retry must write the SAME rows"

    fallback_logs = [
        r
        for r in caplog.records
        if r.levelno == logging.INFO and HOLDINGS_CONFLICT_TARGET_PRE_D10 in r.getMessage()
    ]
    assert len(fallback_logs) == 1, "the fallback is logged exactly once per call"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        APIError({"code": "23505", "message": "duplicate key value violates unique constraint"}),
        APIError({"code": "42501", "message": "new row violates row-level security policy"}),
        RuntimeError("connection reset by peer"),
    ],
    ids=["23505", "42501-rls", "non-apierror"],
)
async def test_any_other_error_propagates_after_exactly_one_call(error):
    client, calls = _client(error)

    with pytest.raises(type(error)) as raised:
        await persist_allocator_holdings(
            client, _holdings(), ALLOCATOR_ID, API_KEY_ID, ASOF
        )

    assert raised.value is error, "the original error propagates unchanged"
    assert len(calls) == 1, "a non-42P10 failure is never retried"


@pytest.mark.asyncio
async def test_42p10_on_the_fallback_itself_propagates_with_no_third_call():
    second = APIError({"code": "42P10", "message": "still no matching index"})
    client, calls = _client(NO_MATCHING_INDEX, second)

    with pytest.raises(APIError) as raised:
        await persist_allocator_holdings(
            client, _holdings(), ALLOCATOR_ID, API_KEY_ID, ASOF
        )

    assert raised.value is second, "the fallback's own error is the one that surfaces"
    assert len(calls) == 2, "exactly one retry, never a third attempt"


@pytest.mark.asyncio
async def test_empty_holdings_returns_zero_with_no_call():
    client, calls = _client()

    assert await persist_allocator_holdings(client, [], ALLOCATOR_ID, API_KEY_ID, ASOF) == 0
    assert calls == []
    client.table.assert_not_called()
