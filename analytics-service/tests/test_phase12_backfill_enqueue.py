"""Tests for analytics-service/scripts/phase12_backfill_enqueue.py.

P2025 (audit-2026-05-07 round 2):
    The pre-fix loop:
      n = len(strategies)
      for r in strategies:
          await db_execute(lambda: supabase.table('compute_jobs').insert(...).execute())
      print(f'enqueued {n} jobs')
      return 0
    swallows per-row exceptions (none caught) AND lies about the count
    when an insert raises mid-loop. We need:
      - try/except around each insert,
      - track `inserted` separately from `len(strategies)`,
      - log each failure,
      - exit non-zero if any failures.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from scripts import phase12_backfill_enqueue as bf


def _make_supabase(insert_side_effects: list[object]) -> MagicMock:
    """Build a chained MagicMock that mimics the supabase client API.

    `insert_side_effects` is the sequence of per-call outcomes for
    `supabase.table('compute_jobs').insert(...).execute()` — each entry
    is either an Exception (to raise) or a MagicMock result (to return).
    The `select('id', count='exact')...execute()` call at the top of
    main() returns an empty pending list (count=0).
    """
    supabase = MagicMock()

    # The pending-check select branch: count=0, no pending rows.
    select_chain = MagicMock()
    select_chain.eq.return_value = select_chain
    select_chain.execute.return_value = MagicMock(count=0, data=[])

    # The published-strategies select branch: 5 strategies.
    published_chain = MagicMock()
    published_chain.eq.return_value = published_chain
    published_chain.execute.return_value = MagicMock(
        data=[{"id": f"strat-{i}"} for i in range(5)],
    )

    # The insert call counter must be SHARED across every supabase.table('compute_jobs')
    # invocation, since each per-row insert in the loop calls .table('compute_jobs')
    # fresh. Capturing the counter inside `table` would reset it per call.
    insert_calls = {"i": 0}

    def table(name: str) -> MagicMock:  # type: ignore[no-untyped-def]
        chain = MagicMock()

        def select(*args, **kwargs):  # type: ignore[no-untyped-def]
            return select_chain if name == "compute_jobs" else published_chain

        chain.select = select

        def insert(payload):  # type: ignore[no-untyped-def]
            inner = MagicMock()
            idx = insert_calls["i"]
            insert_calls["i"] += 1
            effect = insert_side_effects[idx] if idx < len(insert_side_effects) else MagicMock()
            if isinstance(effect, Exception):
                inner.execute.side_effect = effect
            else:
                inner.execute.return_value = effect
            return inner

        chain.insert = insert
        return chain

    supabase.table = table
    return supabase


# --- P2025: per-row failure rollup ----------------------------------------


@pytest.mark.asyncio
async def test_partial_failure_reports_inserted_over_total(capsys) -> None:
    """When the 3rd of 5 inserts raises, the final message must show
    `2/5` (the actual inserted count and the total attempted), NOT `5`."""
    effects: list[object] = [
        MagicMock(),  # strat-0 ok
        MagicMock(),  # strat-1 ok
        RuntimeError("simulated insert failure"),  # strat-2 fails
        MagicMock(),  # strat-3 ok — even after failure, loop must continue
        MagicMock(),  # strat-4 ok
    ]
    supabase = _make_supabase(effects)

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    # Per-row failures must be logged.
    assert "simulated insert failure" in captured.out or "simulated insert failure" in captured.err
    # The final tally must reflect inserted/total, not pre-loop len.
    assert "4/5" in captured.out  # 5 - 1 failure = 4 inserted
    # And it must NOT lie that it enqueued 5.
    assert "enqueued 5 jobs" not in captured.out
    # Non-zero exit when failures occur.
    assert rc != 0


@pytest.mark.asyncio
async def test_all_success_returns_zero(capsys) -> None:
    """Happy path: every insert succeeds → rc=0 and `5/5` reported."""
    effects = [MagicMock() for _ in range(5)]
    supabase = _make_supabase(effects)

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc == 0
    assert "5/5" in captured.out


@pytest.mark.asyncio
async def test_all_failures_returns_nonzero(capsys) -> None:
    """Pathological case: every insert raises → rc!=0 and `0/5` reported."""
    effects = [RuntimeError(f"fail-{i}") for i in range(5)]
    supabase = _make_supabase(effects)

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc != 0
    assert "0/5" in captured.out


# --- Strategies-select returning None must NOT silently coerce to [] ------


@pytest.mark.asyncio
async def test_published_strategies_none_data_raises() -> None:
    """rows.data is None when the supabase client failed the query. If we
    coerced to [] (the prior behavior), the script would print
    "enqueueing 0 strategies" and exit 0 — a green log on a broken query.
    Must raise RuntimeError instead (Rule 12)."""
    supabase = MagicMock()

    # Pending-check select: count=0 (lets us past the early-exit gate).
    select_chain = MagicMock()
    select_chain.eq.return_value = select_chain
    select_chain.execute.return_value = MagicMock(count=0, data=[])

    # Published-strategies select: data=None — simulating a query failure
    # where the client returned an envelope without rows.
    published_chain = MagicMock()
    published_chain.eq.return_value = published_chain
    published_chain.execute.return_value = MagicMock(data=None)

    def table(name: str) -> MagicMock:  # type: ignore[no-untyped-def]
        chain = MagicMock()
        chain.select = lambda *a, **kw: (
            select_chain if name == "compute_jobs" else published_chain
        )
        return chain

    supabase.table = table

    with patch("scripts.phase12_backfill_enqueue.get_supabase", return_value=supabase):
        with pytest.raises(RuntimeError, match="strategies select returned None"):
            await bf.main()
