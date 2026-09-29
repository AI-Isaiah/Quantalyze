"""167.1.2 plan 09 — a departed account's history stays in the book up to its end day.

D-05 (founder): "do not delete the data when a key is disconnected ... they would
be included only till the day that the key was deleted." D-09: a disconnected
key ends on the UTC day of ``disconnected_at``; a revoked key ends on its last
``csv_daily_returns`` day.

What the book must show, and why each assertion matters:

* Through the end day the departed key's level is IN the $-curve. Plan 05 drops
  it entirely, so the book reads as if that capital never existed.
* The day after, it is OUT of the $-curve and out of both sums of
  ``payload.returns``. Its leaving is an exit of capital, not a loss: the
  return that day is exactly the remaining key's own return (no cliff), and the
  $-curve steps down by the departed key's last level. A carried level
  (last-observation-carried-forward) would keep dead capital in the book forever.
* A departed key's inputs are kept while its key row exists, so the owner's
  include/exclude switch stays reversible.

Fakes only; no network, no database.
"""
from __future__ import annotations

import math
from typing import Any
from unittest.mock import patch

import pandas as pd
import pytest

from services.allocator_equity_compose import compose_allocator_equity
from tests.test_derive_allocator_equity_job import (
    DERIVED_TABLE,
    LEGACY_TABLE,
    _curve_deletes,
    _curve_upserts,
    _extract_payload,
    _FakeSupabase,
    _gate_key,
)

ALLOC = "alloc-departed"
DAYS = [f"2026-06-{d:02d}" for d in range(1, 21)]
LIVE_R = 0.01
LIVE_ANCHOR = 1_000.0
DEP_R = 0.02
DEP_ANCHOR = 500.0


def _level(anchor: float, r: float, days_to_anchor: int) -> float:
    """The backward replay of a constant-return key with no flows."""
    return anchor / (1.0 + r) ** days_to_anchor


def _csv(key_id: str, days: list[str], r: float) -> list[dict[str, Any]]:
    return [
        {"api_key_id": key_id, "allocator_id": ALLOC, "date": day, "daily_return": r}
        for day in days
    ]


def _key_inputs(key_id: str, anchor: float, asof: str) -> dict[str, Any]:
    return {
        "allocator_id": ALLOC,
        "kind": f"key_inputs:{key_id}",
        "payload": {
            "flows": [],
            "anchor_usd": anchor,
            "anchor_asof": asof,
            "venue": "binance",
        },
    }


async def _run(fake: _FakeSupabase) -> Any:
    from services.job_worker import run_derive_allocator_equity_job

    job = {"id": "j-departed", "kind": "derive_allocator_equity", "allocator_id": ALLOC}
    with patch("services.job_worker.get_supabase", return_value=fake):
        return await run_derive_allocator_equity_job(job)


def _book(fake: _FakeSupabase) -> dict[str, Any]:
    upserts = _curve_upserts(fake)
    assert len(upserts) == 1, f"expected one equity_curve upsert, got {fake.upserts!r}"
    return _extract_payload(upserts[0][1])


def _curve(payload: dict[str, Any]) -> dict[str, float]:
    return {row["date"]: row["equity_usd"] for row in payload["curve"]}


def _returns(payload: dict[str, Any]) -> dict[str, float]:
    return {row["date"]: row["r"] for row in payload["returns"]}


def _live_level(day: str) -> float:
    return _level(LIVE_ANCHOR, LIVE_R, len(DAYS) - 1 - DAYS.index(day))


def _live_and_departed(departed: dict[str, Any], dep_days: list[str]) -> _FakeSupabase:
    return _FakeSupabase({
        "api_keys": [
            _gate_key("key-L", ALLOC, venue_account_id="acct-live"),
            departed,
        ],
        "csv_daily_returns": _csv("key-L", DAYS, LIVE_R) + _csv(departed["id"], dep_days, DEP_R),
        DERIVED_TABLE: [
            _key_inputs("key-L", LIVE_ANCHOR, DAYS[-1]),
            _key_inputs(departed["id"], DEP_ANCHOR, dep_days[-1]),
        ],
        LEGACY_TABLE: [],
    })


def _assert_exit(payload: dict[str, Any], end_day: str) -> None:
    """The departed key counts through ``end_day`` and exits cleanly after it."""
    curve = _curve(payload)
    returns = _returns(payload)
    next_day = DAYS[DAYS.index(end_day) + 1]
    departed_last = DEP_ANCHOR  # its anchor is its level on its own last day

    # In the book through its end day (plan 05 dropped it: curve == live only).
    assert curve[end_day] == pytest.approx(_live_level(end_day) + departed_last, rel=1e-12)
    assert curve[DAYS[0]] == pytest.approx(
        _live_level(DAYS[0])
        + _level(DEP_ANCHOR, DEP_R, DAYS.index(end_day)),
        rel=1e-12,
    )
    # Out of the book the next day: no carried level.
    assert curve[next_day] == pytest.approx(_live_level(next_day), rel=1e-12)
    # The $-curve steps down by the departed key's last level, less nothing else
    # than the live key's own growth.
    step = curve[next_day] - curve[end_day]
    assert step == pytest.approx(
        _live_level(next_day) - _live_level(end_day) - departed_last, rel=1e-9
    )
    # The exit is not a return: the next day's return is the live key's own.
    assert returns[next_day] == pytest.approx(LIVE_R, abs=1e-15)
    assert returns[next_day] > 0.0, "the stop day must not read as a loss"
    # On the end day both keys are in both sums (prior-capital weights).
    prev = DAYS[DAYS.index(end_day) - 1]
    live_prev = _live_level(prev)
    dep_prev = _level(DEP_ANCHOR, DEP_R, 1)
    expected = (live_prev * LIVE_R + dep_prev * DEP_R) / (live_prev + dep_prev)
    assert returns[end_day] == pytest.approx(expected, rel=1e-12)
    # Every later day is the live key alone.
    for day in DAYS[DAYS.index(next_day):]:
        assert returns[day] == pytest.approx(LIVE_R, abs=1e-15), day
        assert curve[day] == pytest.approx(_live_level(day), rel=1e-12), day
    assert payload["is_trustworthy"] is True
    assert "departed_history_included" in payload["flags"]


@pytest.mark.asyncio
async def test_disconnected_distinct_account_counts_through_its_disconnect_day() -> None:
    """Case (1): a known account no other key holds. Disconnected at 15:30 UTC on
    June 10, so June 10 is its last day in the book."""
    dep_days = DAYS[:10]
    departed = _gate_key(
        "key-D", ALLOC,
        venue_account_id="acct-departed",
        disconnected_at="2026-06-10T15:30:00+00:00",
    )
    fake = _live_and_departed(departed, dep_days)
    result = await _run(fake)
    assert result.outcome.name == "DONE"
    _assert_exit(_book(fake), "2026-06-10")


@pytest.mark.asyncio
async def test_revoked_key_stops_on_its_last_returns_day() -> None:
    """Success criterion 3 (the revoked key's stop): a key revoked mid-window,
    never disconnected, ends on its last csv_daily_returns day, and the stop day
    carries no negative return."""
    dep_days = DAYS[:8]
    departed = _gate_key(
        "key-R", ALLOC, venue_account_id="acct-revoked", sync_status="revoked",
    )
    fake = _live_and_departed(departed, dep_days)
    result = await _run(fake)
    assert result.outcome.name == "DONE"
    _assert_exit(_book(fake), "2026-06-08")


@pytest.mark.asyncio
async def test_a_departed_keys_inputs_survive_while_its_key_row_exists() -> None:
    """The orphan cleanup deleted every non-eligible key's key_inputs row, so a
    departed key's anchor and flows were gone after the next compose and the
    owner's switch could never bring its history back. Now only a row whose key
    no longer exists is deleted, whether the departed key is included or not."""
    included = _gate_key(
        "key-D", ALLOC,
        venue_account_id="acct-departed",
        disconnected_at="2026-06-10T15:30:00+00:00",
    )
    excluded = _gate_key(
        "key-N", ALLOC, disconnected_at="2026-06-05T09:00:00+00:00",
    )  # NULL identity: excluded by default, its inputs still kept
    fake = _FakeSupabase({
        "api_keys": [
            _gate_key("key-L", ALLOC, venue_account_id="acct-live"),
            included,
            excluded,
        ],
        "csv_daily_returns": (
            _csv("key-L", DAYS, LIVE_R)
            + _csv("key-D", DAYS[:10], DEP_R)
            + _csv("key-N", DAYS[:5], DEP_R)
        ),
        DERIVED_TABLE: [
            _key_inputs("key-L", LIVE_ANCHOR, DAYS[-1]),
            _key_inputs("key-D", DEP_ANCHOR, DAYS[9]),
            _key_inputs("key-N", DEP_ANCHOR, DAYS[4]),
            _key_inputs("key-gone", DEP_ANCHOR, DAYS[4]),
        ],
        LEGACY_TABLE: [],
    })
    result = await _run(fake)
    assert result.outcome.name == "DONE"
    deleted_kinds = {
        d[1].get("kind") for d in fake.deletes if d[0] == DERIVED_TABLE
    }
    assert deleted_kinds == {"key_inputs:key-gone"}, deleted_kinds
    assert _curve_deletes(fake, ALLOC) == []
    _assert_exit(_book(fake), "2026-06-10")


# ── compose level ─────────────────────────────────────────────────────────────


def _series(days: list[str], r: float) -> pd.Series:
    return pd.Series([r] * len(days), index=days, dtype="float64")


def test_compose_replays_the_full_series_then_clips_at_the_end_day() -> None:
    """A departed key's anchor is its level on its OWN last return day. When its
    returns run past the end day (a successor on the account, or a disconnect
    mid-day), the level on the end day is the full replay's level, not the
    anchor re-hung on the end day."""
    dep_days = DAYS[:12]
    payload = compose_allocator_equity(
        {"L": _series(DAYS, LIVE_R), "D": _series(dep_days, DEP_R)},
        {"L": [], "D": []},
        {"L": LIVE_ANCHOR, "D": DEP_ANCHOR},
        departed_end_by_key={"D": "2026-06-10"},
    )
    curve = _curve(payload)
    returns = _returns(payload)
    d_on_end = _level(DEP_ANCHOR, DEP_R, 2)
    assert curve["2026-06-10"] == pytest.approx(_live_level("2026-06-10") + d_on_end, rel=1e-12)
    assert curve["2026-06-11"] == pytest.approx(_live_level("2026-06-11"), rel=1e-12)
    assert curve["2026-06-12"] == pytest.approx(_live_level("2026-06-12"), rel=1e-12)
    assert returns["2026-06-11"] == pytest.approx(LIVE_R, abs=1e-15)
    assert payload["is_trustworthy"] is True


def test_compose_books_the_exit_as_an_outflow_not_a_loss() -> None:
    """The KEPT cashflow scalars read the ledger. The exit leaves the book as
    the departed key's last level, so a flat book with a departure reads a
    Modified-Dietz return of 0, not a loss of the departed capital."""
    payload = compose_allocator_equity(
        {"L": _series(DAYS, 0.0), "D": _series(DAYS[:10], 0.0)},
        {"L": [], "D": []},
        {"L": LIVE_ANCHOR, "D": DEP_ANCHOR},
        departed_end_by_key={"D": "2026-06-10"},
    )
    scalars = payload["scalars"]
    assert scalars["computable"] is True
    assert scalars["dietz"] is not None and math.isfinite(scalars["dietz"])
    assert scalars["dietz"] == pytest.approx(0.0, abs=1e-12)
    curve = _curve(payload)
    assert curve["2026-06-10"] == pytest.approx(LIVE_ANCHOR + DEP_ANCHOR)
    assert curve["2026-06-11"] == pytest.approx(LIVE_ANCHOR)


def test_compose_without_departures_is_unchanged() -> None:
    """A live key is never in departed_end_by_key: its math is the frozen
    core's. An overlapped key that ends early is still carried (plan 05)."""
    base = compose_allocator_equity(
        {"L": _series(DAYS, LIVE_R), "D": _series(DAYS[:10], DEP_R)},
        {"L": [], "D": []},
        {"L": LIVE_ANCHOR, "D": DEP_ANCHOR},
    )
    same = compose_allocator_equity(
        {"L": _series(DAYS, LIVE_R), "D": _series(DAYS[:10], DEP_R)},
        {"L": [], "D": []},
        {"L": LIVE_ANCHOR, "D": DEP_ANCHOR},
        departed_end_by_key={},
    )
    for key in ("curve", "returns", "flags", "degrade_reasons", "is_trustworthy"):
        assert base[key] == same[key], key
    assert _curve(base)["2026-06-11"] == pytest.approx(
        _live_level("2026-06-11") + DEP_ANCHOR
    )


@pytest.mark.asyncio
async def test_a_departed_key_whose_inputs_are_gone_is_left_out_and_the_book_stays_ready() -> None:
    """Before plan 09 the orphan cleanup deleted every departed key's key_inputs
    row, and a departed key is never derived again, so its anchor cannot come
    back. Composing it would drop it as DROPPED_KEY and hold the book
    untrustworthy forever. It is left out under a benign flag instead: the book
    is what it was before plan 09 for that key, never worse."""
    departed = _gate_key(
        "key-D", ALLOC,
        venue_account_id="acct-departed",
        disconnected_at="2026-06-10T15:30:00+00:00",
    )
    fake = _FakeSupabase({
        "api_keys": [_gate_key("key-L", ALLOC, venue_account_id="acct-live"), departed],
        "csv_daily_returns": _csv("key-L", DAYS, LIVE_R) + _csv("key-D", DAYS[:10], DEP_R),
        DERIVED_TABLE: [_key_inputs("key-L", LIVE_ANCHOR, DAYS[-1])],
        LEGACY_TABLE: [],
    })
    result = await _run(fake)
    assert result.outcome.name == "DONE"
    payload = _book(fake)
    assert payload["is_trustworthy"] is True
    assert "departed_history_unavailable" in payload["flags"]
    assert "departed_history_included" not in payload["flags"]
    curve = _curve(payload)
    for day in DAYS:
        assert curve[day] == pytest.approx(_live_level(day), rel=1e-12), day
