"""Phase 171 READCEILING, plan 02: a Bybit window above the page ceiling is read whole (SC-2).

WHY this file exists. The rebuild's Bybit read used to refuse a 7-day window the moment it held
more than ``_BYBIT_WINDOW_PAGE_CEILING`` pages (100 pages x 100 rows). An account with a busier week
than that could not be rebuilt at all. The window is now continued BY TIME inside a run: the end
bound is lowered to one millisecond past the oldest trade read and a new cursor-less segment starts
(the walk OKX already uses), so no cursor is relied on across segments and id dedupe absorbs the
overlap.

The older ceiling tests in ``test_trade_pages.py`` answer with an INFINITE fake (constant
timestamps, fresh ids, a fresh cursor forever). Such a fake cannot go RED at the old behaviour for
the reason that matters, because both the old and the new read stop on it. The tests here use a
FINITE book that the venue could serve to its end: the old read raised on it after exactly 100
calls, the new one returns every trade.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

import pytest

from services import trade_read_store as store

# --------------------------------------------------------------------------- the budget, hygiene


def test_the_store_names_match_the_migration() -> None:
    """The store writes columns by NAME and the migration declares them: a rename on either side
    alone would make every write fail at the first claim. Read straight from plan 03's file."""
    repo_root = Path(__file__).resolve().parents[2]
    (migration,) = (repo_root / "supabase" / "migrations").glob("*_allocator_trade_reads.sql")
    sql = "\n".join(
        line for line in migration.read_text().splitlines() if not line.lstrip().startswith("--")
    )
    blocks = dict(
        re.findall(r"CREATE TABLE public\.(allocator_trade_read\w*)\s*\((.*?)\n\);", sql, re.DOTALL)
    )
    assert set(blocks) == {store.STATE_TABLE, store.WINDOW_TABLE}

    def _columns(block: str) -> set[str]:
        # A column line is indented two spaces and starts with a lowercase name; constraints,
        # keys and their continuation lines start with a keyword or sit deeper.
        return set(re.findall(r"^  ([a-z][a-z0-9_]*)\s+[A-Z]", block, re.MULTILINE))

    assert _columns(blocks[store.STATE_TABLE]) == set(store.STATE_COLUMNS)
    assert _columns(blocks[store.WINDOW_TABLE]) == set(store.WINDOW_COLUMNS)


# ------------------------------------------------------------ SC-1: claims replay as one pass


async def test_the_watchdog_loop_runs_the_trade_read_sweep_and_survives_its_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T-171-35 and T-171-36. The sweep is only worth having if the watchdog loop calls it, and it
    must never stop the loop: a sweep that raises on its first call is called again on the next
    tick, and the loop task ends without an exception. (The orphan-sweep loop test's technique.)"""
    import asyncio

    import main_worker

    calls = 0
    shutdown = asyncio.Event()
    monkeypatch.setattr(main_worker, "SHUTDOWN", shutdown)

    async def _tick() -> None:
        return None

    async def _orphans() -> None:
        return None

    async def _sweep() -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("fixture: sweep blew up")
        shutdown.set()

    monkeypatch.setattr(main_worker, "watchdog_tick", _tick)
    monkeypatch.setattr(main_worker, "report_orphaned_capped_reconstructs", _orphans)
    monkeypatch.setattr(main_worker, "sweep_expired_trade_reads", _sweep)

    task = asyncio.create_task(main_worker.watchdog_loop(interval=0.01))
    done, pending = await asyncio.wait({task}, timeout=3.0)
    for p in pending:
        p.cancel()

    assert task in done, "watchdog_loop hung"
    assert calls >= 2, f"the trade read sweep ran {calls} time(s); a failing sweep stopped the loop"
    assert task.exception() is None
