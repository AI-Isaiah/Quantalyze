"""The ONE shared pytest fake of the PostgREST query builder.

New matcher tests build a ``FakeDb`` from a ``{table: [row, ...]}`` dict and monkeypatch
``get_supabase`` to return it. The fake mirrors the parts of PostgREST the service reads
through:

* ``select`` / ``eq`` / ``in_`` / ``gte`` row filters;
* ``order(col, desc=...)`` called several times: keys apply in call order, the FIRST key
  is the most significant (what ``services.db.paginated_select`` relies on);
* ``limit`` and ``range(start, end)`` (inclusive end), and ``range`` may be called again on
  the same builder, which is how ``paginated_select`` drives its pages;
* a server-side ``max_rows`` cap that truncates any response without an error, exactly as
  PostgREST does (1000 on this project);
* ``maybe_single`` (``.data`` is one dict or ``None``);
* per-table injected errors via ``errors[table] = exc``.

Two records of every read are kept:

* ``read_log`` -- a ``FakeRead`` per execute (table, eq filters, gte filters, range). New
  tests read THIS, e.g. to prove every page of a service-role read carries the tenant filter.
* ``reads`` -- a 2-field ``(table, eq-list)`` compatibility view, in the exact shape the
  per-file ``_Db.reads`` had, so migrated assertions that unpack ``for name, eqs in db.reads``
  stay byte-identical.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class FakeRead:
    """One executed read: the table, its eq and gte filters, and the range it asked for."""

    table: str
    eq: tuple[tuple[str, Any], ...]
    gte: tuple[tuple[str, Any], ...]
    range: tuple[int, int] | None


class _Response:
    def __init__(self, data: Any) -> None:
        self.data = data


def _order_key(row: dict[str, Any], col: str) -> tuple[bool, Any]:
    """None (or a missing key) sorts before any value; test rows may omit ``id``."""
    value = row.get(col)
    return (value is not None, value)


class FakeQuery:
    def __init__(self, db: "FakeDb", name: str) -> None:
        self._db = db
        self._name = name
        self._eq: list[tuple[str, Any]] = []
        self._in: list[tuple[str, list[Any]]] = []
        self._gte: list[tuple[str, Any]] = []
        self._order: list[tuple[str, bool]] = []
        self._limit: int | None = None
        self._range: tuple[int, int] | None = None
        self._single = False

    def select(self, *_a: Any, **_k: Any) -> "FakeQuery":
        return self

    def eq(self, col: str, val: Any) -> "FakeQuery":
        self._eq.append((col, val))
        return self

    def in_(self, col: str, vals: Any) -> "FakeQuery":
        self._in.append((col, list(vals)))
        return self

    def gte(self, col: str, val: Any) -> "FakeQuery":
        self._gte.append((col, val))
        return self

    def order(self, col: str, desc: bool = False) -> "FakeQuery":
        self._order.append((col, desc))
        return self

    def limit(self, count: int) -> "FakeQuery":
        self._limit = count
        return self

    def range(self, start: int, end: int) -> "FakeQuery":
        self._range = (start, end)
        return self

    def maybe_single(self) -> "FakeQuery":
        self._single = True
        return self

    def execute(self) -> Any:
        self._db.read_log.append(
            FakeRead(self._name, tuple(self._eq), tuple(self._gte), self._range)
        )
        self._db.reads.append((self._name, list(self._eq)))
        error = self._db.errors.get(self._name)
        if error is not None:
            raise error
        data = [
            dict(r)
            for r in self._db.tables.get(self._name, [])
            if all(r.get(c) == v for c, v in self._eq)
            and all(r.get(c) in vs for c, vs in self._in)
            and all(r.get(c) is not None and r.get(c) >= v for c, v in self._gte)
        ]
        # Stable sorts from the least to the most significant key give a multi-key ORDER BY.
        for col, desc in reversed(self._order):
            data.sort(key=lambda r, c=col: _order_key(r, c), reverse=desc)
        if self._range is not None:
            start, end = self._range
            data = data[start : end + 1]
        # PostgREST: a response never exceeds the explicit limit nor the server's
        # max_rows, and a capped read carries no error.
        ceilings = [n for n in (self._limit, self._db.max_rows) if n is not None]
        if ceilings:
            data = data[: min(ceilings)]
        if self._single:
            return _Response(data[0] if data else None)
        return _Response(data)


class FakeDb:
    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        self.tables = tables
        self.max_rows: int | None = None  # PostgREST's server-side cap
        self.errors: dict[str, Exception] = {}
        self.read_log: list[FakeRead] = []
        self.reads: list[tuple[str, list[tuple[str, Any]]]] = []

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)
