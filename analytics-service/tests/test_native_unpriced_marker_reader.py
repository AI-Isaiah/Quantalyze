"""164.6.6.2.1 R2-WR-01: the ONE Python reader of the ``native_unpriced:<key>`` marker.

The marker is the poll's service-written record that a native-unit (BTC) account's latest
completed day had no stored close. Two Python readers act on it (the daily refresh and the
match scorer's AUM); they share one definition, ``read_native_unpriced_days``.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.allocator_positions import (
    NATIVE_UNPRICED_KIND_PREFIX,
    native_unpriced_day,
    read_native_unpriced_days,
)

ALLOCATOR = "00000000-0000-0000-0000-0000000000aa"
KEY_A = "00000000-0000-0000-0000-00000000000a"
KEY_B = "00000000-0000-0000-0000-00000000000b"


class _Query:
    def __init__(self, rows: list[dict[str, Any]], error: Exception | None) -> None:
        self._rows = rows
        self._error = error
        self.filters: dict[str, Any] = {}

    def select(self, *_a: Any, **_k: Any) -> "_Query":
        return self

    def eq(self, col: str, val: Any) -> "_Query":
        self.filters[col] = val
        return self

    def in_(self, col: str, vals: Any) -> "_Query":
        self.filters[col] = list(vals)
        return self

    def execute(self) -> Any:
        if self._error is not None:
            raise self._error
        kinds = self.filters.get("kind")
        data = [r for r in self._rows if kinds is None or r["kind"] in kinds]
        return type("R", (), {"data": data})()


class _Client:
    def __init__(self, rows: list[dict[str, Any]], error: Exception | None = None) -> None:
        self._rows = rows
        self._error = error
        self.queries: list[_Query] = []

    def table(self, name: str) -> _Query:
        assert name == "allocator_equity_derived"
        q = _Query(self._rows, self._error)
        self.queries.append(q)
        return q


def _row(key: str, payload: Any) -> dict[str, Any]:
    return {"kind": NATIVE_UNPRICED_KIND_PREFIX + key, "payload": payload}


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"native_unpriced": True, "asof": "2026-10-10"}, "2026-10-10"),
        ({"native_unpriced": False, "asof": "2026-10-10"}, None),
        ({"asof": "2026-10-10"}, None),
        ({"native_unpriced": True}, None),
        ({"native_unpriced": True, "asof": "10/10/2026"}, None),
        ({"native_unpriced": True, "asof": 20261010}, None),
        (None, None),
        ("native_unpriced", None),
    ],
)
def test_a_record_needs_the_flag_and_a_recorded_iso_day(payload: Any, expected: str | None) -> None:
    assert native_unpriced_day(payload) == expected


def test_reads_only_the_asked_keys_and_only_valid_records() -> None:
    client = _Client(
        [
            _row(KEY_A, {"native_unpriced": True, "asof": "2026-10-10"}),
            _row(KEY_B, {"asof": "2026-10-10"}),  # not a marker
            _row("00000000-0000-0000-0000-00000000000c", {"native_unpriced": True, "asof": "2026-10-09"}),
        ]
    )

    got = read_native_unpriced_days(client, ALLOCATOR, [KEY_A, KEY_B])  # type: ignore[arg-type]

    assert got == {KEY_A: "2026-10-10"}
    assert client.queries[0].filters["allocator_id"] == ALLOCATOR


def test_no_keys_means_no_query() -> None:
    client = _Client([])
    assert read_native_unpriced_days(client, ALLOCATOR, []) == {}  # type: ignore[arg-type]
    assert client.queries == []


def test_a_failed_read_raises_rather_than_reporting_no_markers() -> None:
    client = _Client([], error=RuntimeError("down"))
    with pytest.raises(RuntimeError, match="down"):
        read_native_unpriced_days(client, ALLOCATOR, [KEY_A])  # type: ignore[arg-type]
