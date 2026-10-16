"""Self-test of the shared PostgREST fake against the real ``services.db.paginated_select``.

The fake is the ONE test double the matcher's paginated history read (D-05) runs on, so
it must page, cap and record reads the way PostgREST does. Each test pins a behavior a
later plan leans on: a fake that silently returned everything in one page would let a
truncated production read pass unnoticed.
"""

from __future__ import annotations

import random
from typing import Any

import pytest

from services.db import PaginatedSelectTruncated, paginated_select
from tests.fake_postgrest import FakeDb, FakeRead

ORDER = (("asof", False), ("id", False))


def _rows(n: int) -> list[dict[str, Any]]:
    """``n`` rows with a unique (asof, id) ordering key, shuffled so only ORDER BY can sort them."""
    rows = [{"id": i, "asof": f"2026-01-{(i % 28) + 1:02d}", "v": i} for i in range(n)]
    random.Random(7).shuffle(rows)
    return rows


def _range_calls(db: FakeDb) -> list[tuple[int, int]]:
    return [r.range for r in db.read_log if r.range is not None]


def test_three_pages_return_every_row_in_multi_key_order() -> None:
    db = FakeDb({"t": _rows(2500)})
    got = paginated_select(db.table("t").select("*"), order_by=ORDER)
    assert len(got) == 2500
    assert [(r["asof"], r["id"]) for r in got] == sorted((r["asof"], r["id"]) for r in got)
    assert _range_calls(db) == [(0, 999), (1000, 1999), (2000, 2999)]


def test_row_count_on_the_exact_boundary_returns_without_raising() -> None:
    db = FakeDb({"t": _rows(3000)})
    got = paginated_select(db.table("t").select("*"), order_by=ORDER, hard_cap_pages=3)
    assert len(got) == 3000


def test_one_row_past_the_cap_raises_truncated() -> None:
    db = FakeDb({"t": _rows(3001)})
    with pytest.raises(PaginatedSelectTruncated):
        paginated_select(db.table("t").select("*"), order_by=ORDER, hard_cap_pages=3)


def test_server_max_rows_beats_a_larger_limit() -> None:
    db = FakeDb({"t": _rows(5000)})
    db.max_rows = 1000
    got = db.table("t").select("*").limit(5000).execute().data
    assert len(got) == 1000


def test_max_rows_caps_a_range_page_too() -> None:
    """PostgREST truncates a range response at max_rows; a pager must see the short page, not extra rows."""
    db = FakeDb({"t": _rows(5000)})
    db.max_rows = 500
    got = db.table("t").select("*").order("id").range(0, 999).execute().data
    assert len(got) == 500


def test_order_keys_apply_in_call_order_first_key_most_significant() -> None:
    db = FakeDb(
        {
            "t": [
                {"id": 1, "asof": "2026-01-02"},
                {"id": 2, "asof": "2026-01-01"},
                {"id": 3, "asof": "2026-01-02"},
                {"id": 4, "asof": "2026-01-01"},
            ]
        }
    )
    got = db.table("t").order("asof", desc=True).order("id", desc=False).execute().data
    assert [r["id"] for r in got] == [1, 3, 2, 4]


def test_a_row_missing_an_order_key_sorts_first_and_never_raises() -> None:
    db = FakeDb({"t": [{"id": 2}, {"asof": "2026-01-01"}, {"id": 1}]})
    got = db.table("t").order("id").execute().data
    assert [r.get("id") for r in got] == [None, 1, 2]


def test_gte_keeps_rows_on_or_after_the_bound_and_is_logged() -> None:
    db = FakeDb(
        {
            "allocator_holdings": [
                {"allocator_id": "a", "asof": "2026-01-09"},
                {"allocator_id": "a", "asof": "2026-01-10"},
                {"allocator_id": "a", "asof": "2026-01-11"},
                {"allocator_id": "b", "asof": "2026-01-11"},
            ]
        }
    )
    q = (
        db.table("allocator_holdings")
        .select("*")
        .eq("allocator_id", "a")
        .gte("asof", "2026-01-10")
        .order("asof")
        .range(0, 9)
    )
    got = q.execute().data
    assert [r["asof"] for r in got] == ["2026-01-10", "2026-01-11"]
    read = db.read_log[-1]
    assert isinstance(read, FakeRead)
    assert read.table == "allocator_holdings"
    assert read.eq == (("allocator_id", "a"),)
    assert read.gte == (("asof", "2026-01-10"),)
    assert read.range == (0, 9)


def test_every_read_is_logged_not_only_the_last() -> None:
    """The tenant-filter assertion (T-167.1.1.1-04) needs EVERY page's filters, so the log must keep them all."""
    db = FakeDb({"t": [{**r, "allocator_id": "a"} for r in _rows(2500)]})
    paginated_select(db.table("t").eq("allocator_id", "a").select("*"), order_by=ORDER)
    assert len(db.read_log) == 3
    assert all(r.eq == (("allocator_id", "a"),) for r in db.read_log)


def test_compat_reads_view_is_a_two_tuple_that_unpacks_like_the_old_per_file_fake() -> None:
    db = FakeDb({"allocator_holdings": [{"allocator_id": "a", "asof": "2026-01-10"}]})
    db.table("allocator_holdings").eq("allocator_id", "a").gte("asof", "2026-01-10").execute()
    assert db.reads[-1] == ("allocator_holdings", [("allocator_id", "a")])
    assert len(db.reads) == len(db.read_log)
    for name, eqs in db.reads:
        assert name == "allocator_holdings"
        assert ("allocator_id", "a") in eqs


def test_in_filter_and_maybe_single() -> None:
    db = FakeDb({"t": [{"id": 1}, {"id": 2}, {"id": 3}]})
    assert [r["id"] for r in db.table("t").in_("id", [1, 3]).execute().data] == [1, 3]
    assert db.table("t").eq("id", 2).maybe_single().execute().data == {"id": 2}
    assert db.table("t").eq("id", 9).maybe_single().execute().data is None


def test_injected_error_fires_only_for_its_table() -> None:
    db = FakeDb({"allocator_equity_derived": [], "other": [{"id": 1}]})
    db.errors["allocator_equity_derived"] = RuntimeError("marker table unavailable")
    with pytest.raises(RuntimeError, match="marker table unavailable"):
        db.table("allocator_equity_derived").select("*").execute()
    assert db.table("other").select("*").execute().data == [{"id": 1}]


def test_returned_rows_are_copies() -> None:
    db = FakeDb({"t": [{"id": 1, "v": 1}]})
    db.table("t").execute().data[0]["v"] = 99
    assert db.tables["t"][0]["v"] == 1
