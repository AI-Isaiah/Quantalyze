"""167.1.2 plan 05 — D-06 flow-neutral book returns.

The $-curve steps when cash moves. ``payload.returns`` must not: a deposit, a
withdrawal, a join and a carried day are not returns of the book. The pinned
identity is ``r_t = Σ_{k∈S}(E_{k,t} − F_{k,t}) / Σ_{k∈S} E_{k,t−1} − 1``, which
equals ``Σ E_{k,t−1}·r_{k,t} / Σ E_{k,t−1}`` only when flows are kept out of the
return. Phase 115's static ``_current_equity_weights`` weights every historical
day by today's capital mix and is rejected for this series.
"""
from __future__ import annotations

import math

import pandas as pd
import pytest

from services.allocator_equity_compose import (
    _current_equity_weights,
    compose_allocator_equity,
)
from services.allocator_equity_derive import replay_key_equity
from services.external_flows import ExternalFlow

_ABS = 1e-12


def _series(days: list[str], values: list[float]) -> pd.Series:
    return pd.Series(values, index=days, dtype="float64")


def _by_date(payload: dict) -> dict[str, float]:
    rows = payload["returns"]
    assert [row["date"] for row in rows] == sorted(row["date"] for row in rows)
    return {row["date"]: row["r"] for row in rows}


def _replayed_levels(
    returns_by_key: dict[str, pd.Series],
    flows_by_key: dict[str, list[ExternalFlow]],
    anchors_by_key: dict[str, float],
) -> dict[str, dict[str, float]]:
    levels: dict[str, dict[str, float]] = {}
    for key, series in returns_by_key.items():
        replayed = replay_key_equity(series, flows_by_key.get(key, []), anchors_by_key[key])
        assert replayed.equity is not None, key
        levels[key] = {str(day): float(level) for day, level in replayed.equity.items()}
    return levels


def _identity_returns(
    returns_by_key: dict[str, pd.Series],
    flows_by_key: dict[str, list[ExternalFlow]],
    anchors_by_key: dict[str, float],
) -> dict[str, float]:
    """The D-06 identity from replayed levels and flows, not from ``r``.

    A key is absent before its first replayed day (a join is not a return).
    After its last replayed day it keeps that last level and ``F = 0`` through
    the union (this fixture has no disjoint rotation, so nothing drops to $0).
    """
    levels = _replayed_levels(returns_by_key, flows_by_key, anchors_by_key)
    first = {key: min(day_map) for key, day_map in levels.items()}
    last = {key: max(day_map) for key, day_map in levels.items()}
    union = sorted({day for day_map in levels.values() for day in day_map})

    def _level(key: str, day: str) -> float | None:
        if day < first[key]:
            return None
        if day in levels[key]:
            return levels[key][day]
        if day > last[key]:
            return levels[key][last[key]]
        return None

    def _flow(key: str, day: str) -> float:
        # A carried day has no flow. A flow inside the series is external cash,
        # which the identity removes and a level-ratio would keep.
        if day not in levels[key]:
            return 0.0
        return sum(
            flow.usd_signed
            for flow in flows_by_key.get(key, [])
            if flow.utc_day_iso == day
        )

    expected: dict[str, float] = {}
    for index in range(1, len(union)):
        prev, day = union[index - 1], union[index]
        numer = 0.0
        denom = 0.0
        for key in levels:
            equity_prev = _level(key, prev)
            equity_day = _level(key, day)
            if equity_prev is None or equity_day is None:
                continue
            numer += equity_day - _flow(key, day)
            denom += equity_prev
        assert denom > 0.0, day
        expected[day] = numer / denom - 1.0
    return expected


def test_one_key_deposit_steps_the_curve_and_not_the_return() -> None:
    """A deposit on day 3 moves the $-curve by the cash. The book's return that
    day stays the key's own r — today there is no ``returns`` key at all."""
    days = ["2026-06-01", "2026-06-02", "2026-06-03"]
    own_r = 0.02
    deposit = 1_000.0
    anchor = 5_100.0
    returns_by_key = {"key-A": _series(days, [0.0, 0.0, own_r])}
    flows_by_key = {"key-A": [ExternalFlow("2026-06-03", deposit)]}
    anchors_by_key = {"key-A": anchor}

    payload = compose_allocator_equity(returns_by_key, flows_by_key, anchors_by_key)

    assert payload["version"] == 2
    curve = {point["date"]: point["equity_usd"] for point in payload["curve"]}
    step = curve["2026-06-03"] - curve["2026-06-02"]
    # The curve steps by the deposit on top of the key's own return, not by r alone.
    assert step == pytest.approx(deposit + curve["2026-06-02"] * own_r, abs=1e-6)
    returns = _by_date(payload)
    assert "2026-06-01" not in returns  # a key's first day is never a return
    assert returns["2026-06-03"] == pytest.approx(own_r, abs=_ABS)
    level_ratio = curve["2026-06-03"] / curve["2026-06-02"] - 1.0
    assert abs(level_ratio - returns["2026-06-03"]) > 1e-4


def test_three_keys_identity_join_and_carry() -> None:
    """Deposit, withdrawal, a join on day 5 and a carried key. Every emitted r
    matches the flow-neutral identity to 1e-12. The join is not a return. The
    carried key contributes its last level and r = 0, never $0."""
    days_all = [f"2026-07-0{n}" for n in range(1, 7)]
    days_b = days_all[:4]
    days_c = days_all[4:]
    returns_by_key = {
        "key-A": _series(days_all, [0.01] * 6),
        "key-B": _series(days_b, [0.0, 0.0, -0.01, 0.0]),
        "key-C": _series(days_c, [0.20, 0.0]),
    }
    flows_by_key = {
        "key-A": [ExternalFlow("2026-07-03", 500.0)],
        "key-B": [ExternalFlow("2026-07-02", -200.0)],
        "key-C": [],
    }
    anchors_by_key = {"key-A": 2_000.0, "key-B": 800.0, "key-C": 5_000.0}

    payload = compose_allocator_equity(returns_by_key, flows_by_key, anchors_by_key)
    assert payload["version"] == 2
    actual = _by_date(payload)
    expected = _identity_returns(returns_by_key, flows_by_key, anchors_by_key)
    assert actual.keys() == expected.keys()
    for day, want in expected.items():
        assert actual[day] == pytest.approx(want, abs=_ABS), day

    levels = _replayed_levels(returns_by_key, flows_by_key, anchors_by_key)
    # Day 5: C joins (its 0.20 must not enter) and B's series has ended, so B
    # contributes its last level with r = 0. Dropping B to $0 would leave A's r.
    e_a = levels["key-A"]["2026-07-04"]
    e_b = levels["key-B"]["2026-07-04"]
    carried = (e_a * 0.01) / (e_a + e_b)
    assert actual["2026-07-05"] == pytest.approx(carried, abs=_ABS)
    assert abs(actual["2026-07-05"] - 0.01) > 1e-4
    assert abs(actual["2026-07-05"] - 0.20) > 1e-4


def test_dynamic_weights_differ_from_current_equity_weights() -> None:
    """Capital that moved between two keys: D-06 (prior equity) is not D1
    (today's anchor share). Wiring ``_current_equity_weights`` into the book
    return would make these equal."""
    days = ["2026-04-01", "2026-04-02"]
    returns_by_key = {
        "key-A": _series(days, [0.0, 0.50]),
        "key-B": _series(days, [0.0, 0.0]),
    }
    flows_by_key = {
        "key-A": [ExternalFlow("2026-04-02", -900.0)],
        "key-B": [ExternalFlow("2026-04-02", 900.0)],
    }
    anchors_by_key = {"key-A": 100.0, "key-B": 1_000.0}

    payload = compose_allocator_equity(returns_by_key, flows_by_key, anchors_by_key)
    dynamic = _by_date(payload)["2026-04-02"]
    weights = _current_equity_weights(["key-A", "key-B"], anchors_by_key)
    static = weights["key-A"] * 0.50 + weights["key-B"] * 0.0
    assert abs(dynamic - static) > 1e-3
    assert dynamic == pytest.approx(0.43478260869565216, abs=1e-9)


def test_nonpositive_denominator_is_a_benign_skip() -> None:
    """A disjoint handoff has no key present on both days, so the denominator is
    not positive. That day is omitted and flagged, and the book stays trustworthy
    — the flag is not a degrade reason."""
    returns_by_key = {
        "key-A": _series(["2026-08-01"], [0.0]),
        "key-B": _series(["2026-08-02"], [0.05]),
    }
    flows_by_key = {"key-A": [], "key-B": []}
    anchors_by_key = {"key-A": 100.0, "key-B": 100.0}

    payload = compose_allocator_equity(returns_by_key, flows_by_key, anchors_by_key)

    assert payload["returns"] == []
    assert "skipped_nonpositive_denominator" in payload["flags"]
    assert "skipped_nonpositive_denominator" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is True
    assert math.isfinite(payload["curve"][-1]["equity_usd"])
