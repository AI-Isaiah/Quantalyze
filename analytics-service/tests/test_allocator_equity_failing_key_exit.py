"""186 plan 07 (D-03, D-07) - the compose NAMES a key the book stopped counting.

D-07 (founder 2026-11-03, "Leaves the book that day"): a failing key's history counts up to its
last good day and its capital then leaves the book as a flow, never a loss or a gain. The compose
already has that exit, ``departed_end_by_key``. The keyword under test,
``failing_key_exit_by_key``, adds only the NAME: ``payload["failing_key_exits"]`` plus the benign
flag ``failing_key_exited``. It changes no math and never makes the curve untrustworthy.

Hand literals: key A holds 40,000.0 flat (r = 0) on 2026-06-01 .. 06-03 and exits after 06-03.
Key B holds 60,000.0 on 06-05 and returns +1% every day 06-01 .. 06-05. A key's anchor is its level
on its own last day, so B's level on 06-0k is 60,000 / 1.01^(5-k).
"""
from __future__ import annotations

import math
from typing import Any

import pandas as pd
import pytest

from services.allocator_equity_compose import (
    FAILING_KEY_EXIT_REASONS,
    compose_allocator_equity,
)
from services.external_flows import ExternalFlow

DAYS = [f"2026-06-{d:02d}" for d in range(1, 6)]  # day 1 .. day 5
A_DAYS = DAYS[:3]
A_LEVEL = 40_000.0
B_ANCHOR = 60_000.0
B_R = 0.01


def _series(days: list[str], r: float) -> pd.Series:
    return pd.Series([r] * len(days), index=days, dtype="float64")


def _compose(
    *,
    departed: dict[str, str] | None = None,
    exits: dict[str, tuple[str, str | None]] | None = None,
    extra_returns: dict[str, pd.Series] | None = None,
    extra_anchors: dict[str, float | None] | None = None,
) -> dict[str, Any]:
    returns = {"key-A": _series(A_DAYS, 0.0), "key-B": _series(DAYS, B_R)}
    anchors: dict[str, float | None] = {"key-A": A_LEVEL, "key-B": B_ANCHOR}
    returns.update(extra_returns or {})
    anchors.update(extra_anchors or {})
    kwargs: dict[str, Any] = {}
    if departed is not None:
        kwargs["departed_end_by_key"] = departed
    if exits is not None:
        kwargs["failing_key_exit_by_key"] = exits
    return compose_allocator_equity(
        returns, {k: [] for k in returns}, anchors, {}, **kwargs
    )


def _returns(payload: dict[str, Any]) -> dict[str, float]:
    return {row["date"]: row["r"] for row in payload["returns"]}


def _curve(payload: dict[str, Any]) -> dict[str, float]:
    return {row["date"]: row["equity_usd"] for row in payload["curve"]}


def _b_level(day: str) -> float:
    return B_ANCHOR / (1.0 + B_R) ** (len(DAYS) - 1 - DAYS.index(day))


def test_failing_key_exit_book_after_the_exit_is_exactly_the_rest_of_the_book() -> None:
    """SC-4 oracle. After A leaves, the book IS B, so the book's return on 06-04 and 06-05 is B's
    own +1.00% (an independent invariant: B's return, not anything the code under test computes).
    A frozen 40,000 left in the book would dilute it. The key is named, the curve stays trusted."""
    payload = _compose(
        departed={"key-A": A_DAYS[-1]},
        exits={"key-A": ("sync_failing", A_DAYS[-1])},
    )

    returns = _returns(payload)
    assert returns["2026-06-04"] == pytest.approx(0.01, abs=1e-12)
    assert returns["2026-06-05"] == pytest.approx(0.01, abs=1e-12)
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert payload["failing_key_exits"] == [
        {"api_key_id": "key-A", "reason": "sync_failing", "day": "2026-06-03"}
    ]
    assert "failing_key_exited" in payload["flags"]
    # Benign by construction: it is a flag token, never a degrade reason.
    assert not any("failing_key" in r for r in payload["degrade_reasons"])


def test_failing_key_exit_control_without_the_exit_the_same_book_reads_diluted() -> None:
    """The control: with no exit, A's 40,000 stays in the book on 06-04. The return is then the
    capital-weighted mean over A (r = 0) and B, about 0.6% (B is 60,000 / 1.01 = 59,405.9 on
    06-04 of a 99,405.9 book, so about 0.01 * 0.5976 = 0.00598), inside 0.005 .. 0.007. This is
    what lets the oracle above tell an exit from a flat carry."""
    payload = _compose()

    assert 0.005 < _returns(payload)["2026-06-04"] < 0.007
    assert "failing_key_exits" not in payload
    assert "failing_key_exited" not in payload["flags"]


def test_failing_key_exit_leaves_as_an_outflow_of_the_last_level_not_a_loss() -> None:
    """The exit is booked as an outflow of A's last level (40,000) on 06-04, read the way the
    departed-key tests read it: the curve steps down by A's level and the KEPT Modified-Dietz
    scalar sees a withdrawal, not a loss.

    Hand arithmetic: begin = 40,000 + B(06-01) = 40,000 + 60,000/1.01^4; end = 60,000 (06-05);
    F = -40,000 on day offset 3 of a 4-day period. With the exit read as a flow the gain is
    end - begin - F = 60,000 - B(06-01) > 0; read as a loss it would be 20,000 - B(06-01) < 0."""
    payload = _compose(
        departed={"key-A": A_DAYS[-1]},
        exits={"key-A": ("read_incomplete", A_DAYS[-1])},
    )

    curve = _curve(payload)
    assert curve["2026-06-03"] == pytest.approx(A_LEVEL + _b_level("2026-06-03"), rel=1e-12)
    assert curve["2026-06-04"] == pytest.approx(_b_level("2026-06-04"), rel=1e-12)

    scalars = payload["scalars"]
    assert scalars["computable"] is True
    b1 = _b_level("2026-06-01")
    gain = B_ANCHOR - b1
    assert gain > 0
    assert scalars["dietz"] is not None and math.isfinite(scalars["dietz"])
    assert scalars["dietz"] > 0.0, "the exit must not read as a loss"
    # Weight of the flow on offset 3 of 4 days is 0.25 (Modified Dietz).
    assert scalars["dietz"] == pytest.approx(gain / (A_LEVEL + b1 - 0.25 * A_LEVEL), rel=1e-9)


def test_failing_key_exit_reason_vocabulary_is_closed() -> None:
    """The reader (plan 186-08) parses exactly these two reasons; widening the set is a contract
    change for both runtimes, so the set is pinned."""
    assert FAILING_KEY_EXIT_REASONS == frozenset({"sync_failing", "read_incomplete"})


def test_failing_key_exit_a_key_that_never_counted_carries_a_null_day_and_changes_no_return() -> None:
    """SC-6. A key with no returns and no anchor never had a counted day: it is listed with
    ``day: None``, the compose invents neither a day nor a level for it, and every return of the
    book equals the book composed without the entry."""
    with_name = _compose(
        departed={"key-A": A_DAYS[-1]},
        exits={
            "key-A": ("sync_failing", A_DAYS[-1]),
            "key-never": ("sync_failing", None),
        },
    )
    without_name = _compose(departed={"key-A": A_DAYS[-1]})

    never = [e for e in with_name["failing_key_exits"] if e["api_key_id"] == "key-never"]
    assert never == [{"api_key_id": "key-never", "reason": "sync_failing", "day": None}]
    assert _returns(with_name) == _returns(without_name)
    assert _curve(with_name) == _curve(without_name)
    assert with_name["is_trustworthy"] is True, with_name["degrade_reasons"]


def test_failing_key_exit_entries_are_sorted_by_key_id_and_keep_their_reason() -> None:
    payload = _compose(
        departed={"key-A": A_DAYS[-1]},
        exits={
            "key-z": ("read_incomplete", None),
            "key-A": ("sync_failing", A_DAYS[-1]),
            "key-m": ("sync_failing", "2026-05-30"),
        },
    )

    assert payload["failing_key_exits"] == [
        {"api_key_id": "key-A", "reason": "sync_failing", "day": "2026-06-03"},
        {"api_key_id": "key-m", "reason": "sync_failing", "day": "2026-05-30"},
        {"api_key_id": "key-z", "reason": "read_incomplete", "day": None},
    ]


def test_failing_key_exit_an_entry_carries_no_amount_level_or_venue() -> None:
    """T-186-16. The entry is key id, closed reason and ISO day, nothing else: the payload is read
    by the owner's SSR reader and a name must not leak a figure."""
    payload = _compose(
        departed={"key-A": A_DAYS[-1]},
        exits={"key-A": ("sync_failing", A_DAYS[-1])},
    )

    (entry,) = payload["failing_key_exits"]
    assert set(entry) == {"api_key_id", "reason", "day"}


@pytest.mark.parametrize(
    "bad",
    [
        ("exchange_down", "2026-06-03"),  # reason outside the closed set
        ("sync_failing", "20260603"),  # not the ISO spelling
        ("sync_failing", "2026-06-3"),
        ("sync_failing", "not-a-day"),
        ("sync_failing", 20260603),  # not a string
    ],
)
def test_failing_key_exit_rejects_an_unknown_reason_or_a_non_iso_day(bad: Any) -> None:
    """A caller bug is loud (T-186-17): the name and the exit are set together by the job, so a
    malformed name is never repaired or dropped quietly."""
    with pytest.raises(ValueError):
        _compose(
            departed={"key-A": A_DAYS[-1]},
            exits={"key-A": bad},
        )


@pytest.mark.parametrize("exits", [None, {}])
def test_failing_key_exit_absent_or_empty_leaves_the_payload_unchanged(exits: Any) -> None:
    """Additive: with nothing to name, no field and no flag appear, so an older reader and every
    existing payload see exactly what they saw before."""
    baseline = _compose(departed={"key-A": A_DAYS[-1]})
    payload = _compose(departed={"key-A": A_DAYS[-1]}, exits=exits)

    assert "failing_key_exits" not in payload
    assert "failing_key_exited" not in payload["flags"]
    assert payload["flags"] == baseline["flags"]
    assert _returns(payload) == _returns(baseline)
    assert _curve(payload) == _curve(baseline)


def test_failing_key_exit_a_no_capital_fallback_leaves_the_failing_name_and_its_exit_intact() -> None:
    """Interplay with the no-capital fallback. Candidate N is refused by the replay (a 1,050.0
    withdrawal against a 1,000.0 level) and is taken back out as ``dropped_key``. That fallback
    pops only the candidate's own exit: failing key F (40,000 flat on days 1 to 3, exited after
    day 3) is still named and still leaves the book on day 4, so with K (100,000 flat) the curve
    reads 140,000 through day 3 and 100,000 after, exactly the hand literals."""
    days = DAYS
    payload = compose_allocator_equity(
        {
            "K": _series(days, 0.0),
            "F": _series(A_DAYS, 0.0),
            "N": _series(A_DAYS, 0.0),
        },
        {
            "K": [],
            "F": [],
            "N": [ExternalFlow(utc_day_iso=A_DAYS[-1], usd_signed=-1_050.0)],
        },
        {"K": 100_000.0, "F": 40_000.0, "N": -50.0},
        {},
        realized_terminal_by_key={
            "K": (days[-1], 100_000.0),
            "F": (A_DAYS[-1], 40_000.0),
            "N": (A_DAYS[-1], -50.0),
        },
        departed_end_by_key={"F": A_DAYS[-1], "N": A_DAYS[-1]},
        no_capital_exit_by_key={"N": ("nonpositive", A_DAYS[-1])},
        failing_key_exit_by_key={"F": ("sync_failing", A_DAYS[-1])},
    )

    # The fallback fired (otherwise this test would prove nothing about it).
    assert "dropped_key" in payload["degrade_reasons"]
    assert "no_capital_exited_keys" not in payload
    assert payload["failing_key_exits"] == [
        {"api_key_id": "F", "reason": "sync_failing", "day": "2026-06-03"}
    ]
    assert "failing_key_exited" in payload["flags"]
    curve = _curve(payload)
    assert curve["2026-06-03"] == pytest.approx(140_000.0, abs=1e-9)
    assert curve["2026-06-04"] == pytest.approx(100_000.0, abs=1e-9)
    assert curve["2026-06-05"] == pytest.approx(100_000.0, abs=1e-9)
