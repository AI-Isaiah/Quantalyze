"""Test helper: the real column set of a table, parsed from the committed schema.

WHY this exists (Phase 164.6.6.2.2, D-04): ``_compute_portfolio_analytics`` selected
``equity_curve`` and ``total_aum`` from ``strategy_analytics``, columns that table
does not have, so PostgREST would have refused the select on every portfolio that
holds a strategy. Its tests passed because the supabase fake returned its canned
rows for ANY select string. A fake that cannot see the schema cannot catch a
select naming a column that is not there.

``table_columns`` reads ``supabase/schema/baseline.sql`` (the quoted column names
inside the table's ``CREATE TABLE`` block, ``CONSTRAINT`` lines excluded) and adds
every ``ADD COLUMN`` that targets the table in ``supabase/migrations/*.sql``.
``assert_select_columns`` checks a PostgREST select string against it.

Known limit, stated rather than hidden: a ``DROP COLUMN`` or ``RENAME COLUMN`` in a
migration is not subtracted. The set is therefore a SUPERSET of the live columns,
so this guard can miss a select of a dropped column; it cannot reject a real one.

Pure ``re`` and ``pathlib``; no I/O beyond reading those committed files.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_BASELINE = _REPO_ROOT / "supabase" / "schema" / "baseline.sql"
_MIGRATIONS = _REPO_ROOT / "supabase" / "migrations"

_COLUMN_LINE_RE = re.compile(r'^\s*"([A-Za-z_][A-Za-z0-9_]*)"\s+\S')
_ADD_COLUMN_RE = re.compile(
    r'ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?',
    re.IGNORECASE,
)


def _baseline_columns(table: str) -> set[str]:
    header = f'CREATE TABLE IF NOT EXISTS "public"."{table}" ('
    columns: set[str] = set()
    inside = False
    found = False
    for line in _BASELINE.read_text(encoding="utf-8").splitlines():
        if not inside:
            if line.startswith(header):
                inside = True
                found = True
            continue
        if line.startswith(");"):
            break
        if line.lstrip().startswith("CONSTRAINT"):
            continue
        m = _COLUMN_LINE_RE.match(line)
        if m:
            columns.add(m.group(1))
    if not found:
        raise LookupError(
            f"table {table!r} has no CREATE TABLE block in {_BASELINE}; refusing to "
            "return an empty column set (a silent empty set would reject nothing)"
        )
    return columns


def _migration_columns(table: str) -> set[str]:
    stmt_re = re.compile(
        r'ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?'
        rf'(?:"?public"?\.)?"?{re.escape(table)}"?\s+(.*?);',
        re.IGNORECASE | re.DOTALL,
    )
    columns: set[str] = set()
    for path in sorted(_MIGRATIONS.glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        for stmt in stmt_re.finditer(text):
            columns.update(_ADD_COLUMN_RE.findall(stmt.group(1)))
    return columns


@lru_cache(maxsize=None)
def table_columns(table: str) -> frozenset[str]:
    """Every column of ``public.<table>``: baseline block plus migration ADD COLUMNs.

    Raises ``LookupError`` when the table block is not in the baseline.
    """
    return frozenset(_baseline_columns(table) | _migration_columns(table))


def _top_level_items(select_str: str) -> list[str]:
    items: list[str] = []
    depth = 0
    current: list[str] = []
    for ch in select_str:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            items.append("".join(current))
            current = []
        else:
            current.append(ch)
    items.append("".join(current))
    return [i.strip() for i in items if i.strip()]


def assert_select_columns(table: str, select_str: str) -> None:
    """Raise ``AssertionError`` naming every column in ``select_str`` that ``table`` lacks.

    Embeds such as ``strategies(id, name)`` are not columns of this table and are
    skipped; ``*`` is accepted; an ``alias:column`` item checks the column.
    """
    known = table_columns(table)
    unknown: list[str] = []
    for item in _top_level_items(select_str):
        if "(" in item or item == "*":
            continue
        name = item.split(":")[-1].strip()
        if name not in known:
            unknown.append(name)
    if unknown:
        raise AssertionError(
            f"select on {table!r} names column(s) the table does not have: "
            f"{sorted(unknown)} (select was {select_str!r})"
        )
