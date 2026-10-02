"""Phase 167.1.2 C3 fix topic H: a csv_daily_returns writer never opens a hole.

The two writers that make the stored series match a fresh rebuild are the
dailies derive (``run_derive_broker_dailies_job``, strategy mode and key mode)
and the composite stitch (``run_stitch_composite_job``). Before topic H both
DELETED first and upserted after, as separate PostgREST statements with no
transaction. A reader that landed between the two saw the rebuilt days absent,
and every consumer reads an absent day as a 0% day or a chain break. C3 fixes D,
E and F made the READERS page-consistent; no read can close a hole the WRITER
opens.

The fix reorders the writers: upsert the fresh payload first (``ON CONFLICT DO
UPDATE`` keeps each row present), then delete only the rows the payload does not
carry. The end state is unchanged. These tests drive the real handlers against a
stateful ``csv_daily_returns`` store that snapshots the table after EVERY write
statement, which is what a concurrent reader landing between two statements
would see. They assert:

* no day that exists before AND after the write is ever missing from a snapshot;
* a day the new derive refuses still ends ABSENT (the authoritative-span rule);
* out-of-span history (derive) is untouched in every snapshot, and a stale
  out-of-span row (composite, full-series ownership) still ends absent;
* a sibling series on the same dates is never touched (the scope filter);
* every ``in.(...)`` date list is bounded.

Neuter: restore either writer's pre-topic-H shape (a whole-span or
whole-series delete BEFORE the upsert), and the snapshot taken after that
delete lacks the rebuilt days, so the no-hole assertions go RED. Note what is
NOT sufficient on its own: a delete that names only the absent days opens no
hole in either order, because it never touches a day the payload carries. The
NARROWING is what closes the hole; the upsert-first ORDER decides what a death
between statements leaves behind (the new payload landed, a refused day still
stale), which the death test below pins.
"""
from __future__ import annotations

from typing import Any, Callable
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest

from services import job_worker
from services.job_worker import (
    DispatchOutcome,
    run_derive_broker_dailies_job,
    run_stitch_composite_job,
)
from tests.test_composite_headline_parity import (
    _STRATEGY_ID as _COMPOSITE_ID,
    _StatefulSupabase,
    _apply,
    _member,
    _patches as _composite_patches,
    _returns,
)
from tests.test_derive_broker_dailies_dualmode import (
    _CCXT_VERDICT,
    _build_ctx,
    _patches_with_combine,
)

_TABLE = "csv_daily_returns"


# ---------------------------------------------------------------------------
# A stateful csv_daily_returns store that snapshots after every write statement
# ---------------------------------------------------------------------------


class _CsvStore:
    """``csv_daily_returns`` as rows, with PostgREST filter semantics.

    ``snapshots`` holds a copy of the whole table taken after each write
    statement executes: exactly what a reader landing between two of the
    writer's statements would read. ``die_after_writes=N`` makes every write
    statement after the Nth raise instead of executing, to model a worker death
    between two of the writer's statements, whatever their order.
    """

    def __init__(
        self, rows: list[dict[str, Any]], *, die_after_writes: int | None = None
    ) -> None:
        self.rows: list[dict[str, Any]] = []
        self._next_id = 1
        for r in rows:
            self._insert(r)
        self.statements: list[tuple[str, list[tuple[str, str, Any]], Any]] = []
        self.snapshots: list[list[dict[str, Any]]] = []
        self._die_after_writes = die_after_writes

    def _insert(self, row: dict[str, Any]) -> None:
        full = {
            "strategy_id": None,
            "api_key_id": None,
            "allocator_id": None,
            **row,
            "id": self._next_id,
        }
        self._next_id += 1
        self.rows.append(full)

    @staticmethod
    def _matches(row: dict[str, Any], filters: list[tuple[str, str, Any]]) -> bool:
        for op, col, val in filters:
            cell = row.get(col)
            if op == "eq" and cell != val:
                return False
            if op == "gte" and not (cell is not None and str(cell) >= str(val)):
                return False
            if op == "lte" and not (cell is not None and str(cell) <= str(val)):
                return False
            if op == "gt" and not (cell is not None and str(cell) > str(val)):
                return False
            if op == "lt" and not (cell is not None and str(cell) < str(val)):
                return False
            if op == "in" and str(cell) not in {str(v) for v in val}:
                return False
        return True

    def _snapshot(self) -> None:
        self.snapshots.append([dict(r) for r in self.rows])

    def _maybe_die(self) -> None:
        if (
            self._die_after_writes is not None
            and len(self.statements) >= self._die_after_writes
        ):
            raise RuntimeError("simulated worker death between write statements")

    def do_upsert(self, payload: list[dict[str, Any]], on_conflict: str) -> None:
        self._maybe_die()
        cols = [c.strip() for c in on_conflict.split(",")]
        self.statements.append(("upsert", [], [dict(r) for r in payload]))
        for new in payload:
            hit = next(
                (
                    r for r in self.rows
                    if all(r.get(c) == new.get(c) for c in cols)
                ),
                None,
            )
            if hit is not None:
                hit.update(new)  # ON CONFLICT DO UPDATE: the row stays present
            else:
                self._insert(new)
        self._snapshot()

    def do_delete(self, filters: list[tuple[str, str, Any]]) -> None:
        self._maybe_die()
        self.statements.append(("delete", list(filters), None))
        self.rows = [r for r in self.rows if not self._matches(r, filters)]
        self._snapshot()

    def do_select(self, filters: list[tuple[str, str, Any]]) -> list[dict[str, Any]]:
        return [dict(r) for r in self.rows if self._matches(r, filters)]


class _CsvQuery:
    def __init__(self, store: _CsvStore) -> None:
        self.store = store
        self._op = "select"
        self._filters: list[tuple[str, str, Any]] = []
        self._payload: Any = None
        self._conflict: str | None = None

    def select(self, *a: Any, **k: Any) -> "_CsvQuery":
        self._op = "select"
        return self

    def delete(self, *a: Any, **k: Any) -> "_CsvQuery":
        self._op = "delete"
        return self

    def upsert(self, payload: Any, on_conflict: str | None = None, **k: Any) -> "_CsvQuery":
        self._op = "upsert"
        self._payload = payload
        self._conflict = on_conflict
        return self

    def _f(self, op: str) -> Callable[[str, Any], "_CsvQuery"]:
        def _add(col: str, val: Any) -> "_CsvQuery":
            self._filters.append((op, col, val))
            return self
        return _add

    def eq(self, col: str, val: Any) -> "_CsvQuery":
        return self._f("eq")(col, val)

    def gte(self, col: str, val: Any) -> "_CsvQuery":
        return self._f("gte")(col, val)

    def lte(self, col: str, val: Any) -> "_CsvQuery":
        return self._f("lte")(col, val)

    def gt(self, col: str, val: Any) -> "_CsvQuery":
        return self._f("gt")(col, val)

    def lt(self, col: str, val: Any) -> "_CsvQuery":
        return self._f("lt")(col, val)

    def in_(self, col: str, val: Any) -> "_CsvQuery":
        return self._f("in")(col, list(val))

    def order(self, *a: Any, **k: Any) -> "_CsvQuery":
        return self

    def limit(self, *a: Any, **k: Any) -> "_CsvQuery":
        return self

    def execute(self) -> MagicMock:
        if self._op == "upsert":
            assert self._conflict is not None, "a series upsert must name its arbiter"
            self.store.do_upsert(list(self._payload), self._conflict)
            return MagicMock(data=self._payload)
        if self._op == "delete":
            assert self._filters, "an unfiltered csv_daily_returns delete"
            self.store.do_delete(self._filters)
            return MagicMock(data=[])
        return MagicMock(data=self.store.do_select(self._filters))


class _CsvSplitSupabase:
    """Routes ``csv_daily_returns`` to the store; everything else to ``inner``."""

    def __init__(self, inner: Any, store: _CsvStore) -> None:
        self._inner = inner
        self._store = store

    def table(self, name: str) -> Any:
        if name == _TABLE:
            return _CsvQuery(self._store)
        return self._inner.table(name)

    def rpc(self, *a: Any, **k: Any) -> Any:
        return self._inner.rpc(*a, **k)


def _series(rows: list[dict[str, Any]], col: str, val: Any) -> dict[str, float]:
    return {
        str(r["date"]): float(r["daily_return"])
        for r in rows
        if r.get(col) == val
    }


def _assert_no_hole(
    store: _CsvStore,
    col: str,
    val: Any,
    before: dict[str, float],
    after: dict[str, float],
) -> None:
    """Every day present before AND after the write is present in EVERY snapshot."""
    persistent = set(before) & set(after)
    assert persistent, "test setup: no day survives the write, nothing to observe"
    assert len(store.snapshots) >= 2, (
        f"test setup: expected >= 2 write statements, got {store.statements!r}"
    )
    for i, snap in enumerate(store.snapshots):
        visible = set(_series(snap, col, val))
        missing = sorted(persistent - visible)
        assert not missing, (
            f"a reader after write statement {i} "
            f"({store.statements[i][0]}) saw {missing} missing for {col}={val}; "
            "those days exist before and after the write, so the writer opened "
            f"a hole. Statement order: {[s[0] for s in store.statements]}"
        )


def _in_lists(store: _CsvStore) -> list[list[Any]]:
    return [
        val
        for op, filters, _p in store.statements
        if op == "delete"
        for f_op, _col, val in filters
        if f_op == "in"
    ]


# ---------------------------------------------------------------------------
# Item 1 — the dailies derive (strategy mode and key mode)
# ---------------------------------------------------------------------------

_OLD = 0.9  # every seeded in-span value; the fresh derive writes different ones


def _derive_returns() -> pd.Series:
    """Dense 05-01..05-06 with 05-03 REFUSED (NaN) and 05-06 new."""
    idx = pd.DatetimeIndex(
        ["2024-05-01", "2024-05-02", "2024-05-03", "2024-05-04", "2024-05-05", "2024-05-06"]
    )
    return pd.Series([0.01, 0.02, np.nan, 0.04, 0.05, 0.06], index=idx, dtype="float64")


def _seed(scope: dict[str, Any], sibling: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for s in (scope, sibling):
        # Out-of-span history: older than the reconstructed window.
        rows.append({**s, "date": "2024-04-28", "daily_return": 0.5})
        for d in ("2024-05-01", "2024-05-02", "2024-05-03", "2024-05-04", "2024-05-05"):
            rows.append({**s, "date": d, "daily_return": _OLD})
    return rows


async def _run_derive(
    *, key_mode: bool, store: _CsvStore, returns: pd.Series
) -> Any:
    if key_mode:
        ctx, _cap = _build_ctx(
            key_row={"id": "key-h", "exchange": "binance", "user_id": "alloc-h"},
            strategy_row=None,
        )
        job = {"id": "j-h", "kind": "derive_broker_dailies", "api_key_id": "key-h"}
    else:
        ctx, _cap = _build_ctx(
            key_row={"id": "key-h", "exchange": "binance", "user_id": "user-h"},
            strategy_row={"id": "strat-h", "user_id": "user-h"},
        )
        job = {"id": "j-h", "kind": "derive_broker_dailies", "strategy_id": "strat-h"}
    ctx.supabase = _CsvSplitSupabase(ctx.supabase, store)
    combine = MagicMock(
        return_value=(
            returns,
            {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
        )
    )
    patches = _patches_with_combine(ctx, key_mode=key_mode, combine_mock=combine)
    with _apply(patches):
        return await run_derive_broker_dailies_job(job)


_MODES = [
    pytest.param(
        False,
        ("strategy_id", "strat-h"),
        {"strategy_id": "strat-h"},
        {"strategy_id": "strat-sib"},
        id="strategy_mode",
    ),
    pytest.param(
        True,
        ("api_key_id", "key-h"),
        {"api_key_id": "key-h", "allocator_id": "alloc-h"},
        {"api_key_id": "key-sib", "allocator_id": "alloc-h"},
        id="key_mode",
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("key_mode,scope_key,scope,sibling", _MODES)
async def test_h1_derive_never_opens_a_hole_and_keeps_the_end_state(
    key_mode: bool,
    scope_key: tuple[str, str],
    scope: dict[str, Any],
    sibling: dict[str, Any],
) -> None:
    col, val = scope_key
    store = _CsvStore(_seed(scope, sibling))
    before = _series(store.rows, col, val)
    sib_col, sib_val = next(iter(sibling.items()))
    sibling_before = _series(store.rows, sib_col, sib_val)

    result = await _run_derive(key_mode=key_mode, store=store, returns=_derive_returns())
    assert result.outcome == DispatchOutcome.DONE

    after = _series(store.rows, col, val)
    # End state, exactly as the authoritative-span rule requires.
    assert after == {
        "2024-04-28": 0.5,  # out-of-span history untouched
        "2024-05-01": 0.01,
        "2024-05-02": 0.02,
        # 2024-05-03 REFUSED by the new derive -> honestly ABSENT
        "2024-05-04": 0.04,
        "2024-05-05": 0.05,
        "2024-05-06": 0.06,
    }, f"end state drifted from the pre-reorder writer's; got {after!r}"

    # The reader's view between every pair of statements.
    _assert_no_hole(store, col, val, before, after)
    for i, snap in enumerate(store.snapshots):
        assert _series(snap, col, val).get("2024-04-28") == 0.5, (
            f"out-of-span history touched at statement {i}"
        )
        assert _series(snap, sib_col, sib_val) == sibling_before, (
            f"the sibling series {sib_col}={sib_val} was touched at statement {i}"
        )

    # Every reconcile delete stays on the writer's own scope and inside the span.
    deletes = [s for s in store.statements if s[0] == "delete"]
    assert deletes, "a refused day must be reconciled away by a delete"
    for _op, filters, _p in deletes:
        assert ("eq", col, val) in filters, f"delete off-scope: {filters!r}"
        assert ("gte", "date", "2024-05-01") in filters, filters
        assert ("lte", "date", "2024-05-06") in filters, filters


@pytest.mark.asyncio
@pytest.mark.parametrize("key_mode,scope_key,scope,sibling", _MODES)
async def test_h1_derive_batches_a_long_refused_span_into_bounded_in_lists(
    key_mode: bool,
    scope_key: tuple[str, str],
    scope: dict[str, Any],
    sibling: dict[str, Any],
) -> None:
    """A span thousands of days wide must not become one unbounded ``in.()``
    URL. 500 dense days with only the first and last kept leaves 498 refused
    days; each must end absent, through ``in`` lists no longer than the cap."""
    col, val = scope_key
    days = pd.date_range("2022-01-01", periods=500, freq="D")
    values = [np.nan] * 500
    values[0] = 0.01
    values[-1] = 0.02
    returns = pd.Series(values, index=days, dtype="float64")
    seed = [
        {**scope, "date": d.date().isoformat(), "daily_return": _OLD} for d in days
    ] + [{**sibling, "date": d.date().isoformat(), "daily_return": _OLD} for d in days]
    store = _CsvStore(seed)
    before = _series(store.rows, col, val)

    result = await _run_derive(key_mode=key_mode, store=store, returns=returns)
    assert result.outcome == DispatchOutcome.DONE

    after = _series(store.rows, col, val)
    assert after == {"2022-01-01": 0.01, days[-1].date().isoformat(): 0.02}
    _assert_no_hole(store, col, val, before, after)
    in_lists = _in_lists(store)
    cap = job_worker._RECONCILE_DELETE_IN_BATCH
    assert len(in_lists) >= 2, f"498 refused days must span >1 batch; got {len(in_lists)}"
    assert all(0 < len(lst) <= cap for lst in in_lists), [len(x) for x in in_lists]
    assert sum(len(lst) for lst in in_lists) == 498
    sib_col, sib_val = next(iter(sibling.items()))
    assert len(_series(store.rows, sib_col, sib_val)) == 500, "sibling series touched"


@pytest.mark.asyncio
async def test_h1_a_death_after_the_upsert_leaves_a_stale_day_not_a_hole() -> None:
    """The new partial-failure shape, stated honestly: a worker death after the
    writer's FIRST statement (now the upsert) leaves the refused day's STALE row
    present until the retry heals it. It can no longer leave the rebuilt days
    absent, which is what a death after the old first statement (the delete) did."""
    store = _CsvStore(
        _seed({"strategy_id": "strat-h"}, {"strategy_id": "strat-sib"}),
        die_after_writes=1,
    )
    with pytest.raises(RuntimeError, match="simulated worker death"):
        await _run_derive(key_mode=False, store=store, returns=_derive_returns())
    after = _series(store.rows, "strategy_id", "strat-h")
    # Days present before the write AND carried by the new payload: a death at
    # any point must leave every one of them present.
    for d in ("2024-04-28", "2024-05-01", "2024-05-02", "2024-05-04", "2024-05-05"):
        assert d in after, f"{d} absent after a death between statements: a hole"
    # The upsert-first shape specifically: the payload landed whole (05-06 is
    # new), and the refused day is still its stale self until the retry.
    assert after["2024-05-06"] == 0.06, "the upsert must be the first statement"
    assert after["2024-05-03"] == _OLD, "the refused day is stale until the retry"


# ---------------------------------------------------------------------------
# Item 2 — the composite stitch (full-series ownership)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_h2_composite_never_opens_a_hole_and_keeps_full_series_ownership() -> None:
    inner = _StatefulSupabase(members=[
        _member(1, "2024-01-01", "2024-01-03"),
        _member(2, "2024-01-10", None),
    ])
    sibling = "s-sibling-composite"
    seed: list[dict[str, Any]] = []
    for sid in (_COMPOSITE_ID, sibling):
        for d in (
            "2023-12-31",  # stale, BEFORE the new series (shrunk re-derive)
            "2024-01-01", "2024-01-02",
            "2024-01-05",  # stale, inside the inter-member gap
            "2024-01-10", "2024-01-11",
            "2024-02-20",  # stale, AFTER the new series
        ):
            seed.append({"strategy_id": sid, "date": d, "daily_return": _OLD})
    store = _CsvStore(seed)
    before = _series(store.rows, "strategy_id", _COMPOSITE_ID)
    sibling_before = _series(store.rows, "strategy_id", sibling)
    fake = _CsvSplitSupabase(inner, store)

    m1 = _returns([("2024-01-01", 0.02), ("2024-01-02", 0.01)])
    m2 = _returns([("2024-01-10", 0.03), ("2024-01-11", -0.05)])
    with _apply(_composite_patches(fake, combine_returns=[(m1, {}), (m2, {})])):  # type: ignore[arg-type]
        result = await run_stitch_composite_job({"strategy_id": _COMPOSITE_ID})
    assert result.outcome == DispatchOutcome.DONE

    after = _series(store.rows, "strategy_id", _COMPOSITE_ID)
    assert after == {
        "2024-01-01": 0.02, "2024-01-02": 0.01,
        "2024-01-10": 0.03, "2024-01-11": -0.05,
    }, f"the composite must own its WHOLE series; got {after!r}"
    _assert_no_hole(store, "strategy_id", _COMPOSITE_ID, before, after)
    for i, snap in enumerate(store.snapshots):
        assert _series(snap, "strategy_id", sibling) == sibling_before, (
            f"the sibling composite was touched at statement {i}"
        )
    for op, filters, _p in store.statements:
        if op == "delete":
            assert ("eq", "strategy_id", _COMPOSITE_ID) in filters, filters
    cap = job_worker._RECONCILE_DELETE_IN_BATCH
    assert all(0 < len(lst) <= cap for lst in _in_lists(store))
