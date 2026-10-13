"""166.3.1 plan 09 (D-08) - the compose-level guards of the no-capital exit.

``compose_allocator_equity`` receives a candidate: a key the job anchored at its writer's realized
terminal level, rotated out after its end day, and named in ``no_capital_exit_by_key``. The rule
may only make a book BETTER. Everything stored about the candidate is a worker-written row, so a
row that cannot be replayed (the replay raises) or that the replay itself calls suspect (a blocking
reason) must not turn a book that composes today into a failed job or a book that reads
trustworthy over a number nobody can stand behind. Such a candidate falls back to what happens to
every other key with returns and no anchor today: ``NO_ANCHOR`` plus ``DROPPED_KEY``.

Hand literals: key A holds 100000.0 flat on five days. Key B is the candidate.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

import pandas as pd
import pytest

from services.allocator_equity_compose import compose_allocator_equity
from services.external_flows import ExternalFlow

A_LEVEL = 100_000.0


def _days(start: str, n: int) -> list[str]:
    base = date.fromisoformat(start)
    return [(base + timedelta(days=i)).isoformat() for i in range(n)]


DAYS = _days("2026-06-06", 5)  # day 1 .. day 5


def _flat(days: list[str]) -> pd.Series:
    return pd.Series([0.0] * len(days), index=days)


def _curve(payload: dict[str, Any]) -> dict[str, float]:
    return {row["date"]: row["equity_usd"] for row in payload["curve"]}


def _candidate_book(
    *,
    anchor: float,
    terminal: tuple[str, float],
    flows: list[ExternalFlow] | None = None,
    end_day: str = DAYS[2],
) -> dict[str, Any]:
    """Key A plus candidate B: returns on days 1 to 3, the exit on ``end_day``."""
    return {
        "returns_by_key": {"A": _flat(DAYS), "B": _flat(DAYS[:3])},
        "flows_by_key": {"A": [], "B": list(flows or [])},
        "anchors_by_key": {"A": A_LEVEL, "B": anchor},
        "null_anchor_reasons": {},
        "realized_terminal_by_key": {"A": (DAYS[-1], A_LEVEL), "B": terminal},
        "departed_end_by_key": {"B": end_day},
        "no_capital_exit_by_key": {"B": ("nonpositive", end_day)},
    }


def _compose(kwargs: dict[str, Any]) -> dict[str, Any]:
    positional = (
        kwargs.pop("returns_by_key"),
        kwargs.pop("flows_by_key"),
        kwargs.pop("anchors_by_key"),
        kwargs.pop("null_anchor_reasons"),
    )
    return compose_allocator_equity(*positional, **kwargs)


def test_no_capital_exit_a_healthy_candidate_still_composes_and_is_named() -> None:
    """The control for the two fallbacks below: a candidate whose replay is clean is composed at
    the writer's level and named. Without this the fallback tests could pass because the rule
    never fires at all."""
    payload = _compose(_candidate_book(anchor=600.0, terminal=(DAYS[2], 600.0)))

    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "B", "reason": "nonpositive", "day": DAYS[2]}
    ]
    assert _curve(payload)[DAYS[0]] == pytest.approx(100_600.0, abs=1e-9)


def test_no_capital_exit_a_refusing_candidate_falls_back_to_dropped_key() -> None:
    """T-166.3.1-31. A candidate row the replay REFUSES (its last level is further below zero than
    EMPTIED_NEGATIVE_FRACTION of its prior peak: a 1050.0 withdrawal against a 1000.0 level) must
    not fail the whole allocator. The key keeps today's named result, ``no_anchor`` plus the
    blocking ``dropped_key``; it is not named as exited, and the other key's curve is intact."""
    kwargs = _candidate_book(
        anchor=-50.0,
        terminal=(DAYS[2], -50.0),
        flows=[ExternalFlow(utc_day_iso=DAYS[2], usd_signed=-1_050.0)],
    )
    payload = _compose(kwargs)

    assert "dropped_key" in payload["degrade_reasons"]
    assert "no_anchor" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_key_exited" not in payload["flags"]
    assert "no_capital_exited_keys" not in payload
    assert _curve(payload) == {day: pytest.approx(A_LEVEL, abs=1e-9) for day in DAYS}


def test_no_capital_exit_a_blocking_candidate_falls_back_to_dropped_key() -> None:
    """T-166.3.1-31. A candidate whose realized terminal is dated on a day that is not the last
    day of its replay is a row/returns disagreement: the replay does not refuse, it flags
    ``realized_terminal_day_mismatch`` and degrades the key as the blocking ``key_inputs_mismatch``.
    A booked ``key_inputs_mismatch`` or an exit named over such a row would put a number nobody can
    stand behind in the book, so the candidate is composed as today instead: ``dropped_key``."""
    payload = _compose(_candidate_book(anchor=600.0, terminal=(DAYS[1], 600.0)))

    assert "dropped_key" in payload["degrade_reasons"]
    assert "no_anchor" in payload["degrade_reasons"]
    assert "key_inputs_mismatch" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload
    assert _curve(payload) == {day: pytest.approx(A_LEVEL, abs=1e-9) for day in DAYS}


def test_no_capital_exit_fallback_does_not_widen_to_other_keys() -> None:
    """The handler is for candidates only. A refusal by a key that is NOT a candidate is a
    structural input fault and keeps raising, exactly as before, so a corrupt row can never be
    hidden behind the candidate path."""
    from services.nav_twr import NavReconstructionError

    kwargs = _candidate_book(anchor=600.0, terminal=(DAYS[2], 600.0))
    kwargs["no_capital_exit_by_key"] = {}
    kwargs["departed_end_by_key"] = {}
    kwargs["anchors_by_key"]["B"] = -50.0
    kwargs["realized_terminal_by_key"]["B"] = (DAYS[2], -50.0)
    kwargs["flows_by_key"]["B"] = [ExternalFlow(utc_day_iso=DAYS[2], usd_signed=-1_050.0)]
    with pytest.raises(NavReconstructionError):
        _compose(kwargs)


def test_no_capital_exit_fallback_logs_counts_and_reason_class_only(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """T-166.3.1-34. The fallback's warning says how many candidates fell back and why (the
    reason class), never a key id, a day or an amount."""
    kwargs = _candidate_book(
        anchor=-50.0,
        terminal=(DAYS[2], -50.0),
        flows=[ExternalFlow(utc_day_iso=DAYS[2], usd_signed=-1_050.0)],
    )
    kwargs["returns_by_key"] = {"A": _flat(DAYS), "KEY-ID-B": _flat(DAYS[:3])}
    kwargs["flows_by_key"] = {"A": [], "KEY-ID-B": kwargs["flows_by_key"]["B"]}
    kwargs["anchors_by_key"] = {"A": A_LEVEL, "KEY-ID-B": -50.0}
    kwargs["realized_terminal_by_key"] = {"A": (DAYS[-1], A_LEVEL), "KEY-ID-B": (DAYS[2], -50.0)}
    kwargs["departed_end_by_key"] = {"KEY-ID-B": DAYS[2]}
    kwargs["no_capital_exit_by_key"] = {"KEY-ID-B": ("nonpositive", DAYS[2])}
    with caplog.at_level(logging.WARNING, logger="services.allocator_equity_compose"):
        _compose(kwargs)

    fell_back = [r.getMessage() for r in caplog.records if "no-capital" in r.getMessage()]
    assert len(fell_back) == 1, [r.getMessage() for r in caplog.records]
    message = fell_back[0]
    assert "KEY-ID-B" not in message
    assert DAYS[2] not in message
    assert "1050" not in message and "-50" not in message


# ── WR-02 (round-1 review) / SFH F4: a candidate split by an interior unpriced hole ──────────────
# Interior-hole segmentation (164.6.6.2.1 D-09) replays key ``B`` as ``B#hole0`` (days 1 and 2,
# rotated out after day 2 at its stored level) plus ``B`` (day 4). A candidate is a KEY, not a
# unit: when any of its units refuses or is flagged blocking, the WHOLE key falls back, because
# "composed exactly as an unanchored key with returns is today" means the key is absent from the
# curve, not half in it.
HOLE_DAY = DAYS[2]  # day 3 has no USD return: the interior hole between day 2 and day 4


def _hole_candidate_book(
    *,
    last_terminal: tuple[str, float],
    first_terminal: float = 600.0,
    first_flows: list[ExternalFlow] | None = None,
) -> dict[str, Any]:
    """Key A plus candidate B, returns on days 1, 2 and 4, the hole on day 3, exit on day 4."""
    return {
        "returns_by_key": {"A": _flat(DAYS), "B": _flat([DAYS[0], DAYS[1], DAYS[3]])},
        "flows_by_key": {"A": [], "B": list(first_flows or [])},
        "anchors_by_key": {"A": A_LEVEL, "B": 600.0},
        "null_anchor_reasons": {},
        "realized_terminal_by_key": {"A": (DAYS[-1], A_LEVEL), "B": last_terminal},
        "departed_end_by_key": {"B": DAYS[3]},
        "no_capital_exit_by_key": {"B": ("nonpositive", DAYS[3])},
        "unpriced_days_by_key": {"B": [HOLE_DAY]},
        "segment_terminals_by_key": {"B": {DAYS[1]: first_terminal}},
    }


def _today(kwargs: dict[str, Any]) -> dict[str, Any]:
    """The same book as it composes TODAY: B is an unanchored key with returns (no candidacy, no
    segmentation, nothing the hole machinery sends)."""
    today = dict(kwargs)
    today["anchors_by_key"] = {**kwargs["anchors_by_key"], "B": None}
    today["realized_terminal_by_key"] = {
        k: v for k, v in kwargs["realized_terminal_by_key"].items() if k != "B"
    }
    for name in (
        "departed_end_by_key",
        "no_capital_exit_by_key",
        "unpriced_days_by_key",
        "segment_terminals_by_key",
    ):
        today.pop(name)
    return today


def _without_clock(payload: dict[str, Any]) -> dict[str, Any]:
    """The payload minus the one field that is the wall clock (``inputs.composed_at``)."""
    return {**payload, "inputs": {**payload["inputs"], "composed_at": None}}


def test_hole_candidate_healthy_control_composes_in_segments_and_is_named() -> None:
    """The control for the two fallbacks below: with a clean last segment the candidate is composed
    in segments (B#hole0 contributes 600.0 on days 1 and 2, B 600.0 on day 4), so the fallback
    tests cannot pass because the hole machinery never ran."""
    payload = _compose(_hole_candidate_book(last_terminal=(DAYS[3], 600.0)))

    curve = _curve(payload)
    assert curve[DAYS[0]] == pytest.approx(100_600.0, abs=1e-9)
    assert curve[DAYS[1]] == pytest.approx(100_600.0, abs=1e-9)
    assert curve[DAYS[2]] == pytest.approx(100_000.0, abs=1e-9)
    assert curve[DAYS[3]] == pytest.approx(100_600.0, abs=1e-9)
    assert [e["api_key_id"] for e in payload["no_capital_exited_keys"]] == ["B"]


def test_hole_candidate_whose_last_segment_blocks_falls_back_as_a_whole_key() -> None:
    """WR-02. The reviewer's repro. The last segment's realized terminal is dated day 5 while its
    last return is day 4, so the replay flags a blocking ``key_inputs_mismatch`` and ``B`` falls
    back. The earlier segment ``B#hole0`` must go with it: the curve is today's (A's 100000.0 on
    every day, not 100600.0 on days 1 and 2), and the payload is today's payload."""
    kwargs = _hole_candidate_book(last_terminal=(DAYS[4], 600.0))
    payload = _compose(dict(kwargs))

    assert _curve(payload) == {day: pytest.approx(A_LEVEL, abs=1e-9) for day in DAYS}
    assert _without_clock(payload) == _without_clock(_compose(_today(kwargs)))
    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload
    assert "unpriced_native_keys" not in payload


def test_hole_candidate_whose_earlier_segment_refuses_falls_back_instead_of_failing() -> None:
    """SFH F4. The EARLIER segment ``B#hole0`` is not itself a key of ``no_capital_exit_by_key``, so
    its refusal (a 1050.0 withdrawal against a 600.0 level, stored terminal -50.0) used to
    re-raise out of the whole compose and fail the allocator's job. A candidate is its parent key,
    so the key falls back as a whole and the book is today's."""
    kwargs = _hole_candidate_book(
        last_terminal=(DAYS[3], 600.0),
        first_terminal=-50.0,
        first_flows=[ExternalFlow(utc_day_iso=DAYS[1], usd_signed=-1_050.0)],
    )
    payload = _compose(dict(kwargs))

    assert _curve(payload) == {day: pytest.approx(A_LEVEL, abs=1e-9) for day in DAYS}
    assert _without_clock(payload) == _without_clock(_compose(_today(kwargs)))
    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False


def test_hole_segment_of_a_key_that_is_not_a_candidate_still_raises() -> None:
    """The parent mapping widens the handler to a candidate's OWN segments only. The same refusing
    earlier segment on a key that is not offered as a candidate keeps raising."""
    from services.nav_twr import NavReconstructionError

    kwargs = _hole_candidate_book(
        last_terminal=(DAYS[3], 600.0),
        first_terminal=-50.0,
        first_flows=[ExternalFlow(utc_day_iso=DAYS[1], usd_signed=-1_050.0)],
    )
    kwargs["no_capital_exit_by_key"] = {}
    kwargs["departed_end_by_key"] = {}
    with pytest.raises(NavReconstructionError):
        _compose(kwargs)
