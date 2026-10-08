"""Phase 167.1.2.2 round-2 R2-WR-01 — a compose that reads a key while its derive is between
its two writes must not store a blocking verdict that nothing heals.

THE DEFECT (167.1.2.2-REVIEW.md round 2, R2-WR-01). A key-mode derive writes the key's
``csv_daily_returns`` first and its ``key_inputs`` row last, with no transaction between
them. The compose read the returns, then the inputs. After round-1 CR-01 the inputs carry the
day the writer's realized terminal sits on, and a derive that moves the last NAV day forward
(nearly every daily one) leaves a window in which the returns end on the new day and the inputs
still name the old one (or the reverse). The compose then persisted ``key_inputs_mismatch``,
a BLOCKING reason, and the sibling's own corrective compose request was dropped by
``compute_jobs_one_inflight_per_kind_allocator`` (its predicate includes 'running'), so the
book stayed untrustworthy until that key's next derive, a day later.

THE FIX UNDER TEST (no migration).
  * The compose reads the ``key_inputs`` rows BEFORE the returns. A row visible to it then
    implies its returns were already written, so a race can only leave the returns NEWER than
    the inputs, never the reverse.
  * A counted key whose returns run past its realized-terminal day makes the job end
    ``transient``: the queue's backoff re-reads after the sibling's inputs landed. ``failed_retry``
    is outside the one-in-flight index, so a request arriving while the job waits is enqueued as
    a twin (164.9.3) and not lost. On the last attempt the job composes what is stored, and the
    replay's own check blocks it as before, so a genuine mismatch is still a loud verdict.
  * The opposite skew (inputs newer than the returns) is not a race any more and blocks at once.

THE ORACLE IS INDEPENDENT OF THE CODE UNDER TEST. The book is built FORWARD in exact
``Fraction`` arithmetic from a chosen 50,000 of capital; the expected levels are its navs, the
terminal the derive stores is its last nav, and a live open-position wedge sits on top of the last
day. The sibling's write is a mutation of the in-memory store performed from inside the read
hook, i.e. between two reads of one compose, as a concurrent writer's would land.
"""
from __future__ import annotations

from fractions import Fraction
from typing import Any
from unittest.mock import patch

import pytest

from tests.test_allocator_equity_dropped_day_pnl import Book
from tests.test_allocator_equity_realized_basis import _close, _ordinary_book
from tests.test_derive_allocator_equity_job import (
    DERIVED_TABLE,
    _extract_payload,
    _FakeSupabase,
    _is_equity_curve_upsert,
)

ALLOC = "alloc-race"
CSV = "csv_daily_returns"
WEDGE = Fraction(1, 100)  # an open position worth 1% of the realized terminal


def _live(book: Book, last: int) -> float:
    return float(book.nav[last] * (1 + WEDGE))


def _ki_payload(book: Book, last: int) -> dict[str, Any]:
    """The key_inputs row a derive whose last NAV day is ``last`` writes."""
    return {
        "flows": [
            {"utc_day_iso": f.utc_day_iso, "usd_signed": f.usd_signed}
            for f in book.flows
            if f.utc_day_iso <= book.days[last]
        ],
        "anchor_usd": _live(book, last),
        "anchor_null_reason": None,
        "anchor_asof": f"{book.days[last]}T06:00:00+00:00",
        "venue": "okx",
        "realized_terminal_usd": float(book.nav[last]),
        "realized_terminal_day": book.days[last],
    }


def _csv_rows(book: Book, last: int) -> list[dict[str, Any]]:
    return [
        {"api_key_id": "key-R", "allocator_id": ALLOC, "date": d, "daily_return": float(r)}
        for d, r in zip(book.days[: last + 1], [book.pnl[i] / book.prev[i] for i in range(last + 1)])
    ]


def _fake(book: Book, *, csv_last: int, ki_last: int) -> _FakeSupabase:
    n = len(book.days)
    assert 0 <= csv_last < n and 0 <= ki_last < n
    return _FakeSupabase({
        "api_keys": [{
            "id": "key-R", "user_id": ALLOC, "is_active": True, "sync_status": "connected",
            "disconnected_at": None, "exchange": "okx",
        }],
        CSV: _csv_rows(book, csv_last),
        DERIVED_TABLE: [
            {"allocator_id": ALLOC, "kind": "key_inputs:key-R", "payload": _ki_payload(book, ki_last)},
            # yesterday's composed curve, trustworthy: a stale row the race must not disturb
            {"allocator_id": ALLOC, "kind": "equity_curve",
             "payload": {"is_trustworthy": True, "curve": [], "marker": "yesterday"}},
        ],
        "allocator_equity_snapshots": [],
    })


def _sibling_derive(book: Book, last: int):
    """A whole key-mode derive landing: returns first, then the inputs (the writer's order)."""

    def action(fake: _FakeSupabase) -> None:
        fake.rows[CSV] = _csv_rows(book, last)
        for row in fake.rows[DERIVED_TABLE]:
            if row["kind"] == "key_inputs:key-R":
                row["payload"] = _ki_payload(book, last)

    return action


def _fire_once_after_first_compose_read(fake: _FakeSupabase, action) -> list[str]:
    """Run ``action`` once, right after the compose's FIRST read of either input table.
    Returns the (mutable) list of table names it fired on, so a test can pin the read order."""
    fired: list[str] = []

    def on_read(name: str) -> None:
        if fired or name not in (DERIVED_TABLE, CSV):
            return
        fired.append(name)
        action(fake)

    fake.on_read = on_read
    return fired


async def _compose(fake: _FakeSupabase, *, attempts: int = 1, max_attempts: int = 3):
    from services.job_worker import run_derive_allocator_equity_job

    with patch("services.job_worker.get_supabase", return_value=fake):
        return await run_derive_allocator_equity_job({
            "id": "j-race", "kind": "derive_allocator_equity", "allocator_id": ALLOC,
            "attempts": attempts, "max_attempts": max_attempts,
        })


def _curve_upserts(fake: _FakeSupabase) -> list[dict[str, Any]]:
    return [
        _extract_payload(u[1])
        for u in fake.upserts
        if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])
    ]


def _assert_oracle_curve(book: Book, payload: dict[str, Any], last: int) -> None:
    """Trustworthy, ends on ``last``, levels before it are the oracle's realized navs and the
    last point is the live equity."""
    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True
    curve = {row["date"]: row["equity_usd"] for row in payload["curve"]}
    assert max(curve) == book.days[last]
    for i, day in enumerate(book.days[:last]):
        assert _close(curve[day], book.nav[i]), day
    assert curve[book.days[last]] == _live(book, last)


# ── 1. the race itself ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_sibling_derive_landing_between_the_two_reads_is_retried_not_persisted() -> None:
    """The reviewer's interleaving: the compose has read one input table when a sibling
    derive moves its key's last day forward (returns, then inputs). The compose must end
    transient, store no verdict and leave yesterday's row alone; the retry, after the sibling is
    done, reads a consistent pair and is trustworthy on the new day."""
    book = _ordinary_book()
    last = len(book.days) - 1
    fake = _fake(book, csv_last=last - 1, ki_last=last - 1)  # yesterday's state
    fired = _fire_once_after_first_compose_read(fake, _sibling_derive(book, last))

    first = await _compose(fake, attempts=1)

    # The inputs are read FIRST. This is the design's central invariant: it is what makes the
    # skew one-sided, so it is pinned directly and not only through the outcome below.
    assert fired == [DERIVED_TABLE]
    assert first.outcome.name == "FAILED"
    assert first.error_kind == "transient"
    assert _curve_upserts(fake) == []  # no verdict persisted
    assert fake.deletes == []  # and yesterday's row is not removed either
    assert any(r["payload"].get("marker") == "yesterday" for r in fake.rows[DERIVED_TABLE])

    fake.on_read = None  # the sibling has finished
    retry = await _compose(fake, attempts=2)
    assert retry.outcome.name == "DONE"
    (payload,) = _curve_upserts(fake)
    _assert_oracle_curve(book, payload, last)


@pytest.mark.asyncio
async def test_a_consistent_pair_is_composed_at_once() -> None:
    """The control: no race, no retry, and the same oracle curve."""
    book = _ordinary_book()
    last = len(book.days) - 1
    fake = _fake(book, csv_last=last, ki_last=last)

    result = await _compose(fake, attempts=1)

    assert result.outcome.name == "DONE"
    (payload,) = _curve_upserts(fake)
    _assert_oracle_curve(book, payload, last)


@pytest.mark.asyncio
async def test_a_sibling_that_finishes_before_the_first_read_is_simply_fresh() -> None:
    book = _ordinary_book()
    last = len(book.days) - 1
    fake = _fake(book, csv_last=last - 1, ki_last=last - 1)
    _sibling_derive(book, last)(fake)  # the derive completes first

    result = await _compose(fake, attempts=1)

    assert result.outcome.name == "DONE"
    (payload,) = _curve_upserts(fake)
    _assert_oracle_curve(book, payload, last)


# ── 2. a genuinely inconsistent pair still blocks ────────────────────────────


@pytest.mark.asyncio
async def test_returns_that_stay_newer_than_the_inputs_block_on_the_last_attempt() -> None:
    """A derive that died between its writes and keeps dying. Not a race: nothing changes
    between attempts. Early attempts retry (the compose cannot tell); the last one persists
    the blocking verdict, so a genuine inconsistency is never swallowed by the retry."""
    book = _ordinary_book()
    last = len(book.days) - 1

    fake = _fake(book, csv_last=last, ki_last=last - 1)
    for attempt in (1, 2):
        again = await _compose(fake, attempts=attempt, max_attempts=3)
        assert again.outcome.name == "FAILED" and again.error_kind == "transient"
        assert _curve_upserts(fake) == []

    final = await _compose(fake, attempts=3, max_attempts=3)
    assert final.outcome.name == "DONE"
    (payload,) = _curve_upserts(fake)
    assert "key_inputs_mismatch" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False


@pytest.mark.asyncio
async def test_inputs_newer_than_the_returns_are_not_a_race_and_block_at_once() -> None:
    """With the inputs read first a race cannot produce this skew (an input row that is
    visible implies its returns were written), so it is a real inconsistency and is not
    retried. Retrying it would only delay the same verdict."""
    book = _ordinary_book()
    last = len(book.days) - 1
    fake = _fake(book, csv_last=last - 1, ki_last=last)

    result = await _compose(fake, attempts=1, max_attempts=3)

    assert result.outcome.name == "DONE"
    (payload,) = _curve_upserts(fake)
    assert "key_inputs_mismatch" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False


@pytest.mark.asyncio
async def test_a_job_without_attempt_counters_is_retried_not_blocked() -> None:
    """A defence against the opposite default: a job row that carries no counters is not
    the last attempt, so it takes the safe branch."""
    from services.job_worker import run_derive_allocator_equity_job

    book = _ordinary_book()
    last = len(book.days) - 1
    fake = _fake(book, csv_last=last, ki_last=last - 1)
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(
            {"id": "j", "kind": "derive_allocator_equity", "allocator_id": ALLOC}
        )
    assert result.error_kind == "transient"


@pytest.mark.asyncio
async def test_the_retry_log_carries_counts_only(caplog) -> None:
    import logging

    book = _ordinary_book()
    last = len(book.days) - 1
    fake = _fake(book, csv_last=last, ki_last=last - 1)
    with caplog.at_level(logging.WARNING, logger="services.job_worker"):
        result = await _compose(fake, attempts=1)

    (record,) = [r for r in caplog.records if "newer than their key_inputs row" in r.getMessage()]
    for text in (record.getMessage(), result.error_message or ""):
        assert "key-R" not in text
        assert book.days[last] not in text
        assert str(int(book.nav[last])) not in text
