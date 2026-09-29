"""Phase 167.1.2 C3 fix topic H, item 3: the CSV analytics series read is keyset.

``run_csv_strategy_analytics`` loads one strategy's ``csv_daily_returns`` series
(``_load_series``). It used ``paginated_select``, which pages by OFFSET: every
page is a separate PostgREST request with its own snapshot. The writers that
rewrite this strategy's series (the dailies derive, the composite stitch) can
land between two pages. When that write adds or removes a day that sorts before
the next page's offset, every later row shifts by one, so a day is read twice
or never read, and the metrics are computed over that torn series.

The read is now keyset on ``date`` (``(strategy_id, date)`` is UNIQUE): each
page is ``eq(strategy_id) + gt(date, cursor) + order(date) + limit``, and the
read stops on the first EMPTY page. This mirrors C3 fix E's
``_load_allocator_daily_returns`` in ``job_worker.py``.

Neuter: swap ``_load_strategy_daily_returns``'s body back to the offset read
(``paginated_select`` over the same filter and order) and the race tests below
go RED, naming the day read twice or never read.
"""
from __future__ import annotations

from typing import Any, Callable

import pytest

from services import analytics_runner
from services.analytics_runner import (
    PaginatedSelectTruncated,
    _load_strategy_daily_returns,
)

_SID = "strat-keyset"
_SIBLING = "strat-other"
_DAYS = 10
_PAGE = 4


def _day(i: int) -> str:
    return f"2024-05-{i:02d}"


class _Query:
    def __init__(self, store: "_Store") -> None:
        self.store = store
        self._eqs: list[tuple[str, Any]] = []
        self._gt: tuple[str, Any] | None = None
        self._limit: int | None = None
        self._range: tuple[int, int] | None = None
        self.orders: list[tuple[str, bool]] = []

    def select(self, *a: Any, **k: Any) -> "_Query":
        return self

    def eq(self, col: str, val: Any) -> "_Query":
        self._eqs.append((col, val))
        return self

    def gt(self, col: str, val: Any) -> "_Query":
        self._gt = (col, val)
        return self

    def order(self, col: str, desc: bool = False) -> "_Query":
        self.orders.append((col, desc))
        return self

    def limit(self, n: int) -> "_Query":
        self._limit = n
        return self

    def range(self, start: int, end: int) -> "_Query":
        # Served so the offset-read NEUTER runs against the same fake.
        self._range = (start, end)
        return self

    def execute(self) -> Any:
        rows = [
            r for r in self.store.rows
            if all(r.get(c) == v for c, v in self._eqs)
        ]
        if self._gt is not None:
            col, val = self._gt
            rows = [r for r in rows if str(r[col]) > str(val)]
        rows.sort(key=lambda r: str(r["date"]))
        if self._range is not None:
            start, end = self._range
            rows = rows[start:end + 1]
        if self._limit is not None:
            rows = rows[: self._limit]
        if self.store.max_rows is not None:
            rows = rows[: self.store.max_rows]
        out = [dict(r) for r in rows]  # a real JSON decode copies
        self.store.reads.append(self)
        if self.store.on_read is not None:
            self.store.on_read(self.store)
        return type("Resp", (), {"data": out})()


class _Store:
    def __init__(self, rows: list[dict[str, Any]], max_rows: int | None = None) -> None:
        self.rows = rows
        self.max_rows = max_rows
        self.reads: list[_Query] = []
        self.on_read: Callable[["_Store"], None] | None = None

    def table(self, name: str) -> _Query:
        assert name == "csv_daily_returns", name
        return _Query(self)


def _seed() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    rid = 1
    for sid in (_SID, _SIBLING):
        for i in range(1, _DAYS + 1):
            rows.append({"id": rid, "strategy_id": sid, "date": _day(i), "daily_return": 0.001 * i})
            rid += 1
    return rows


def _rewrite(store: _Store, shape: str) -> None:
    """A concurrent rewrite of this strategy's series between two page reads,
    changing how many rows sort BEFORE the next page: `day_added` inserts a day
    ahead of the first page (a re-derive whose span now reaches further back);
    `day_removed` drops a day inside the first page (a day the new derive refused)."""
    kept = [r for r in store.rows if r["strategy_id"] != _SID]
    days = [_day(i) for i in range(1, _DAYS + 1)]
    if shape == "day_added":
        days.insert(0, "2024-04-30")
    elif shape == "day_removed":
        days.remove(_day(2))
    else:  # pragma: no cover - a typo in a parametrize id
        raise AssertionError(shape)
    for n, d in enumerate(days):
        kept.append({"id": 1000 + n, "strategy_id": _SID, "date": d, "daily_return": 0.002})
    store.rows = kept


@pytest.mark.parametrize("shape", ["day_added", "day_removed"])
def test_h3_keyset_read_neither_skips_nor_duplicates_under_a_concurrent_write(
    shape: str,
) -> None:
    store = _Store(_seed())
    before = {r["date"] for r in store.rows if r["strategy_id"] == _SID}

    def _hook(s: _Store) -> None:
        if len(s.reads) == 1:  # after the FIRST page, before the second
            _rewrite(s, shape)

    store.on_read = _hook
    got = _load_strategy_daily_returns(store, _SID, page_size=_PAGE)
    after = {r["date"] for r in store.rows if r["strategy_id"] == _SID}

    dates = [str(r["date"]) for r in got]
    dupes = sorted({d for d in dates if dates.count(d) > 1})
    assert not dupes, f"the paged read returned {dupes} twice"
    missing = sorted((before & after) - set(dates))
    assert not missing, (
        f"the paged read never returned {missing}, present for the whole read"
    )
    assert dates == sorted(dates), "the series must come back in date order"
    assert len(store.reads) >= 3, "the read must have crossed a page boundary"
    # Only this strategy's rows are read.
    assert {r.get("strategy_id", _SID) for r in got} <= {_SID}


def test_h3_keyset_pages_are_keyed_on_date_and_scoped_to_the_strategy() -> None:
    store = _Store(_seed())
    got = _load_strategy_daily_returns(store, _SID, page_size=_PAGE)
    assert [str(r["date"]) for r in got] == [_day(i) for i in range(1, _DAYS + 1)]
    assert len(store.reads) == 4, "3 non-empty pages of 4/4/2 and one empty stop page"
    for q in store.reads:
        assert ("strategy_id", _SID) in q._eqs
        assert q.orders == [("date", False)]
        assert q._range is None, "no OFFSET page may be issued"
    assert store.reads[0]._gt is None
    assert [q._gt for q in store.reads[1:]] == [
        ("date", _day(4)), ("date", _day(8)), ("date", _day(10)),
    ]


@pytest.mark.parametrize("n_rows,raises", [(4, False), (5, True)])
def test_h3_keyset_read_hard_cap_refuses_only_real_overflow(
    n_rows: int, raises: bool
) -> None:
    rows = [
        {"id": i, "strategy_id": _SID, "date": _day(i), "daily_return": 0.0}
        for i in range(1, n_rows + 1)
    ]
    store = _Store(rows)
    if raises:
        with pytest.raises(PaginatedSelectTruncated) as exc:
            _load_strategy_daily_returns(store, _SID, page_size=2, hard_cap_pages=2)
        # The hint is byte-identical to the one paginated_select carried, so the
        # runner's truncation arm logs the same triage string.
        assert exc.value.hint == f"csv_daily_returns strategy_id={_SID}"
        assert exc.value.page_count == 2 and exc.value.page_size == 2
    else:
        got = _load_strategy_daily_returns(store, _SID, page_size=2, hard_cap_pages=2)
        assert len(got) == n_rows


def test_h3_keyset_read_survives_a_server_cap_below_its_page_size() -> None:
    """PostgREST clamps ``limit`` to ``max_rows``; a short-page stop would end
    the read after the first clamped page. The empty-page stop reads it all."""
    store = _Store(_seed(), max_rows=_PAGE - 1)
    got = _load_strategy_daily_returns(store, _SID, page_size=_PAGE)
    assert [str(r["date"]) for r in got] == [_day(i) for i in range(1, _DAYS + 1)]


@pytest.mark.asyncio
async def test_h3_the_runner_loads_its_series_through_the_keyset_read() -> None:
    """``_load_series`` in run_csv_strategy_analytics must call the keyset
    helper with the runner's client and strategy id; a revert to an inline
    ``paginated_select`` would leave the helper tested and unused. The spy
    raises the typed truncation, which the runner re-raises (WR-03), so the
    call is observed without driving the whole compute."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from tests.test_csv_analytics_runner import _make_supabase_mock

    sb = _make_supabase_mock([])
    trunc = PaginatedSelectTruncated(page_count=1, page_size=1, hint="spy")
    spy = MagicMock(side_effect=trunc)
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.db_execute",
               new=AsyncMock(side_effect=lambda fn: fn())), \
         patch("services.analytics_runner._load_strategy_daily_returns", new=spy):
        with pytest.raises(PaginatedSelectTruncated):
            await analytics_runner.run_csv_strategy_analytics("strat-wired")
    spy.assert_called_once()
    assert spy.call_args.args[:2] == (sb, "strat-wired")
