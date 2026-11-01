"""Phase 170.4 plan 11 (D-10, D-08): the Python half of the one-key-per-account-day
rule, replayed against the case table the TS twin reads too
(``tests/fixtures/one_key_per_account_day_cases.json``; ``src/lib/holdings-account-day.ts``).

The figures in that file are hand-typed. Nothing here derives an expectation
from the code under test: a survivor list and a dollar sum come from the file,
and the refresh totals below are typed by hand from the rows each test seeds.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import pytest

from services.allocator_equity_derive import (
    HoldingsUpdatedAtError,
    one_key_per_account_day,
    written_at_micros,
)

_SPEC = json.loads(
    (Path(__file__).parent / "fixtures" / "one_key_per_account_day_cases.json").read_text()
)


def _survivors_by_account(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """What the refresh does per group: the account's rows on its newest day,
    handed to the rule. The case file's ``account`` field is the group."""
    by_account: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_account[row["account"]].append(row)
    out: dict[str, list[dict[str, Any]]] = {}
    for account, group in by_account.items():
        newest = max(r["asof"] for r in group)
        out[account] = one_key_per_account_day([r for r in group if r["asof"] == newest])
    return out


@pytest.mark.parametrize("item", _SPEC["micros"], ids=lambda i: i["ts"])
def test_written_at_micros_matches_the_shared_table(item: dict[str, Any]) -> None:
    assert written_at_micros(item["ts"]) == item["micros"]


@pytest.mark.parametrize("ts", _SPEC["micros_errors"], ids=repr)
def test_written_at_micros_rejects_what_the_shared_table_rejects(ts: str) -> None:
    with pytest.raises(HoldingsUpdatedAtError):
        written_at_micros(ts)


@pytest.mark.parametrize("value", [None, 20261011, {}])
def test_written_at_micros_rejects_a_non_string(value: Any) -> None:
    with pytest.raises(HoldingsUpdatedAtError):
        written_at_micros(value)


def test_the_shared_table_is_not_empty() -> None:
    assert len(_SPEC["cases"]) > 10


@pytest.mark.parametrize("case", _SPEC["cases"], ids=lambda c: c["name"])
def test_one_key_per_account_day_matches_the_shared_table(case: dict[str, Any]) -> None:
    if "expect_error" in case:
        assert case["expect_error"] == HoldingsUpdatedAtError.__name__
        with pytest.raises(HoldingsUpdatedAtError):
            _survivors_by_account(case["rows"])
        return
    survivors = _survivors_by_account(case["rows"])
    got = {
        account: sorted({r["api_key_id"] for r in rows})
        for account, rows in survivors.items()
    }
    assert got == {a: sorted(ids) for a, ids in case["expected"].items()}
    assert sum(r["value_usd"] for rows in survivors.values() for r in rows) == case[
        "expected_sum_usd"
    ]


def test_input_order_is_kept_and_the_input_is_not_mutated() -> None:
    rows = [
        {"api_key_id": "a", "updated_at": "2026-10-11T04:00:00Z", "holding_type": "spot", "symbol": "ETH"},
        {"api_key_id": "b", "updated_at": "2026-10-11T05:00:00Z", "holding_type": "spot", "symbol": "SOL"},
        {"api_key_id": "b", "updated_at": "2026-10-11T05:00:00Z", "holding_type": "spot", "symbol": "BTC"},
    ]
    before = json.dumps(rows)
    assert [r["symbol"] for r in one_key_per_account_day(rows)] == ["SOL", "BTC"]
    assert json.dumps(rows) == before
    assert one_key_per_account_day([]) == []
