"""Tests for analytics-service/scripts/phase12_backfill_enqueue.py.

P2025 (audit-2026-05-07 round 2):
    The original loop swallowed the count when an insert raised mid-loop and
    lied about how many jobs were enqueued. The contract is: never report more
    enqueued than actually landed, and exit non-zero when anything went wrong.

S15e (audit-2026-05-07, H-0596 / H-0599 / H-0600):
    The per-row serial insert loop was N PostgREST round-trips and opened N
    implicit transactions, and its duplicate-guard pre-check could leave a
    split-brain half-enqueued state if a parallel operator (or a worker
    re-enqueue) raced it mid-loop. Root-cause fix: ONE atomic bulk
    `.insert([...])`. A racing collision on the partial unique index now aborts
    the whole statement atomically (errcode 23505) — zero rows enqueued, no
    partial state — and is reported cleanly instead of crashing. The pre-check's
    `existing.count or 0` (None → 0) silently skipped the guard; it now fails
    loud when the count header is absent (H-0600c).
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from scripts import phase12_backfill_enqueue as bf

# Sentinel to distinguish "caller did not pass strategies_data" (use the
# n_strategies default) from "caller explicitly passed None" (simulate a
# PostgREST query failure where .data is None).
_DEFAULT = object()


def _make_supabase(
    *,
    pending_count: int | None = 0,
    n_strategies: int = 5,
    strategies_data: object = _DEFAULT,
    bulk_insert_effect: object | None = None,
) -> tuple[MagicMock, dict]:
    """Build a chained MagicMock mimicking the supabase client API.

    Returns ``(supabase, capture)`` where ``capture`` records:
      - ``capture['insert_calls']``: number of ``.insert(...)`` invocations on
        the compute_jobs table (must be exactly 1 for the bulk path).
      - ``capture['insert_payloads']``: the payloads passed to each insert.

    ``pending_count`` is the count returned by the pre-check select
    (``None`` simulates a missing count header). ``bulk_insert_effect`` is the
    outcome of ``compute_jobs.insert(...).execute()`` — an Exception to raise or
    a MagicMock result to return (default: a fresh MagicMock = success).
    """
    supabase = MagicMock()
    capture: dict = {"insert_calls": 0, "insert_payloads": []}

    if strategies_data is _DEFAULT:
        strategies_data = [{"id": f"strat-{i}"} for i in range(n_strategies)]

    # Pre-check select branch (compute_jobs): count + empty pending list.
    select_chain = MagicMock()
    select_chain.eq.return_value = select_chain
    select_chain.execute.return_value = MagicMock(count=pending_count, data=[])

    # Published-strategies select branch.
    published_chain = MagicMock()
    published_chain.eq.return_value = published_chain
    published_chain.execute.return_value = MagicMock(data=strategies_data)

    def table(name: str) -> MagicMock:  # type: ignore[no-untyped-def]
        chain = MagicMock()

        def select(*args, **kwargs):  # type: ignore[no-untyped-def]
            return select_chain if name == "compute_jobs" else published_chain

        chain.select = select

        def insert(payload):  # type: ignore[no-untyped-def]
            capture["insert_calls"] += 1
            capture["insert_payloads"].append(payload)
            inner = MagicMock()
            effect = bulk_insert_effect if bulk_insert_effect is not None else MagicMock()
            if isinstance(effect, Exception):
                inner.execute.side_effect = effect
            else:
                inner.execute.return_value = effect
            return inner

        chain.insert = insert
        return chain

    supabase.table = table
    return supabase, capture


# --- H-0596: single bulk insert, not N round-trips ------------------------


@pytest.mark.asyncio
async def test_enqueues_via_single_bulk_insert(capsys) -> None:
    """H-0596 regression: 5 strategies must produce exactly ONE
    `.insert(...)` call carrying a 5-element list — not 5 serial inserts.

    Fails against the pre-fix per-row loop (which called .insert() 5 times
    with single-dict payloads)."""
    supabase, capture = _make_supabase(n_strategies=5)

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    assert rc == 0
    # Exactly one bulk insert call.
    assert capture["insert_calls"] == 1
    # Carrying a list of all 5 rows.
    payload = capture["insert_payloads"][0]
    assert isinstance(payload, list)
    assert len(payload) == 5
    assert all(row["priority"] == "low" for row in payload)
    assert all(row["kind"] == "compute_analytics" for row in payload)
    captured = capsys.readouterr()
    assert "5/5" in captured.out


@pytest.mark.asyncio
async def test_all_success_returns_zero(capsys) -> None:
    """Happy path: bulk insert succeeds → rc=0 and `5/5` reported."""
    supabase, _ = _make_supabase(n_strategies=5)

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc == 0
    assert "5/5" in captured.out


# --- H-0599 / H-0600: atomic race abort, not split-brain ------------------


@pytest.mark.asyncio
async def test_duplicate_race_aborts_atomically_zero_enqueued(capsys) -> None:
    """H-0599/H-0600 regression: when the bulk insert hits the partial unique
    index (errcode 23505 — a racing operator/worker already enqueued an
    in-flight row), the whole statement rolls back atomically: 0 enqueued,
    rc!=0, and a clean error (NOT a raw traceback, NOT a lie about partial
    progress)."""

    class _DupErr(Exception):
        code = "23505"

    supabase, capture = _make_supabase(
        n_strategies=5,
        bulk_insert_effect=_DupErr("duplicate key value violates unique constraint"),
    )

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc != 0
    # Single atomic attempt — not a per-row retry storm.
    assert capture["insert_calls"] == 1
    # Zero enqueued (atomic rollback), never claims partial progress.
    assert "0/5" in captured.out
    assert "23505" in captured.out
    assert "enqueued 5 jobs" not in captured.out


@pytest.mark.asyncio
async def test_non_race_bulk_failure_returns_nonzero(capsys) -> None:
    """A non-23505 bulk insert failure (network/auth/malformed) is surfaced
    loudly and exits non-zero — never swallowed as success."""
    supabase, capture = _make_supabase(
        n_strategies=5,
        bulk_insert_effect=RuntimeError("connection reset"),
    )

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc != 0
    assert capture["insert_calls"] == 1
    assert "0/5" in captured.out
    assert "connection reset" in captured.out


# --- H-0600(c): None pending count must fail loud, not skip the guard ------


@pytest.mark.asyncio
async def test_none_pending_count_raises_not_skips_guard() -> None:
    """H-0600(c) regression: a missing count header (`existing.count is None`)
    must RAISE — the pre-fix `existing.count or 0` collapsed None→0, silently
    skipping the duplicate guard and risking a piled-on second backfill."""
    supabase, _ = _make_supabase(pending_count=None, n_strategies=5)

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        with pytest.raises(RuntimeError, match="count came back\\s+None"):
            await bf.main()


@pytest.mark.asyncio
async def test_pending_jobs_present_skips_enqueue(capsys) -> None:
    """When the pre-check finds pending compute_analytics jobs, the script
    bails out (M-02 guard) without enqueueing anything, and returns 0."""
    supabase, capture = _make_supabase(pending_count=3, n_strategies=5)

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc == 0
    assert capture["insert_calls"] == 0
    assert "skipping to avoid duplicates" in captured.out


# --- Defensive id extraction: malformed rows skipped, valid ones enqueued --


@pytest.mark.asyncio
async def test_malformed_rows_skipped_valid_rows_enqueued(capsys) -> None:
    """A row missing/invalid 'id' must be skipped (not crash the batch), the
    valid rows still get enqueued in the bulk insert, and rc!=0 flags the skip."""
    supabase, capture = _make_supabase(
        strategies_data=[
            {"id": "strat-0"},
            {"nope": "x"},          # missing id
            {"id": ""},             # empty id
            {"id": "strat-1"},
            "not-a-dict",           # not even a dict
        ],
    )

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    # 3 rows skipped → non-zero exit.
    assert rc != 0
    # Bulk insert still ran once for the 2 valid rows.
    assert capture["insert_calls"] == 1
    payload = capture["insert_payloads"][0]
    assert [row["strategy_id"] for row in payload] == ["strat-0", "strat-1"]
    # Reports 2 enqueued out of total 5 attempted.
    assert "2/5" in captured.out
    assert "3 strategy rows skipped" in captured.out


@pytest.mark.asyncio
async def test_all_rows_malformed_no_insert(capsys) -> None:
    """If every row is malformed, no bulk insert is attempted and rc!=0."""
    supabase, capture = _make_supabase(
        strategies_data=[{"nope": 1}, "x", {"id": None}],
    )

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc != 0
    assert capture["insert_calls"] == 0
    assert "0/3" in captured.out


# --- Strategies-select returning None must NOT silently coerce to [] ------


@pytest.mark.asyncio
async def test_published_strategies_none_data_raises() -> None:
    """rows.data is None when the supabase client failed the query. If we
    coerced to [] (the prior behavior), the script would print
    "enqueueing 0 strategies" and exit 0 — a green log on a broken query.
    Must raise RuntimeError instead (Rule 12)."""
    supabase, _ = _make_supabase(strategies_data=None)

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        with pytest.raises(RuntimeError, match="strategies select returned None"):
            await bf.main()
