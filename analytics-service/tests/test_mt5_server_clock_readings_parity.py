"""Parity: the worker's server-clock reading row cannot drift from its table.

Phase 155.1 SERVERCLOCK (MT5-06) plan 01, decisions D-13, D-16, D-20(b).

WHY this test exists (Rule 9: the WHY, not the WHAT)
----------------------------------------------------
``build_mt5_server_clock_reading_row`` (``services/mt5_server_clock_reading.py``) builds
the payload of the INSERT that is the FIRST WRITE of every leased MT5 derive, and the
derive lets a database error bubble (a failed insert ends the derive FAILED transient).
So the migration ``*_mt5_server_clock_readings.sql`` and the builder are two copies of one
contract that cannot import each other, and each way they can move alone is a silent
failure at deploy, not a loud one:

* a column renamed or added on one side only makes PostgREST refuse EVERY insert, so
  every MT5 derive fails after the deploy, with the series untouched and the evidence
  never written;
* a verdict, reason or rule the assessment can produce but the named CHECK does not
  admit fails the insert only on that branch, which is the rarest and so the last one
  anybody would test (a closed market, a repeated broker hour, a failed tick read);
* a value the CHECK admits but nothing produces is dead schema that hides the next drift.

The SQL side is read from the migration TEXT (comments stripped first, so a header that
quotes a column cannot satisfy or break a match), found by SUFFIX so a re-picked
migration stamp survives. The Python side is read by import, never from a list copied
into this file.

Pure-stdlib apart from the two services modules; no DB, no network.
"""

from __future__ import annotations

import pathlib
import re
from datetime import datetime, timezone

from services.mt5_server_clock import (
    MT5_SERVER_CLOCK_UNMEASURED_REASONS,
    MT5_SERVER_CLOCK_VERDICTS,
    assess_server_clock_reading,
    fixed_server_clock,
    server_clock_for_rule,
)
from services.mt5_server_clock_reading import (
    MT5_SERVER_CLOCK_READINGS_TABLE,
    build_mt5_server_clock_reading_row,
)

# analytics-service/tests/ -> repo root is parents[2].
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
_MIGRATIONS = _REPO_ROOT / "supabase" / "migrations"

_LINE_COMMENT_RE = re.compile(r"--[^\n]*")
_QUOTED_RE = re.compile(r"'([^']*)'")
# The rule ids the table admits: hand-typed, the clock's three forms.
_RULES = ("eu", "us", "fixed")
# Columns the database fills itself, so the worker never sends them.
_DEFAULTED_COLUMNS = {"id", "created_at"}


def _migration_text() -> str:
    found = sorted(_MIGRATIONS.glob("*_mt5_server_clock_readings.sql"))
    assert len(found) == 1, f"expected exactly one readings migration, found {found}"
    return _LINE_COMMENT_RE.sub("", found[0].read_text(encoding="utf-8"))


def _create_table_body(text: str) -> str:
    start = text.index(f"CREATE TABLE public.{MT5_SERVER_CLOCK_READINGS_TABLE} (")
    open_at = text.index("(", start)
    depth = 0
    for index in range(open_at, len(text)):
        if text[index] == "(":
            depth += 1
        elif text[index] == ")":
            depth -= 1
            if depth == 0:
                return text[open_at + 1 : index]
    raise AssertionError("unbalanced CREATE TABLE block")


def _top_level_items(body: str) -> list[str]:
    items: list[str] = []
    depth = 0
    current: list[str] = []
    for char in body:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            items.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    items.append("".join(current).strip())
    return [item for item in items if item]


def _columns(text: str) -> set[str]:
    names: set[str] = set()
    for item in _top_level_items(_create_table_body(text)):
        first = item.split()[0]
        if first.upper() not in {"CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"}:
            names.add(first)
    return names


def _constraint_literals(text: str, name: str) -> set[str]:
    for item in _top_level_items(_create_table_body(text)):
        if item.startswith(f"CONSTRAINT {name}"):
            return set(_QUOTED_RE.findall(item))
    raise AssertionError(f"constraint {name} is not in the CREATE TABLE block")


def _a_row() -> dict[str, object]:
    clock = server_clock_for_rule("us")
    now = datetime(2026, 11, 17, 12, 0, 0, tzinfo=timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    newest = now_ms + 7_200_000 - 200
    return build_mt5_server_clock_reading_row(
        api_key_id="key-1",
        job_id="job-1",
        read_at=now,
        clock=clock,
        assessment=assess_server_clock_reading(
            clock, newest_tick_ms=newest, utc_now_ms=now_ms
        ),
        newest_tick_wall_ms=newest,
        symbols_visible=14,
        symbols_answered=14,
        server="Some-Server",
    )


def test_the_row_keys_are_exactly_the_tables_non_defaulted_columns() -> None:
    """The insert payload carries every column the database does not fill itself, and
    nothing else: an extra key is refused by PostgREST, a missing one is written NULL
    (or refused where the column is NOT NULL), on every derive."""
    columns = _columns(_migration_text())
    assert set(_a_row()) == columns - _DEFAULTED_COLUMNS, (
        sorted(set(_a_row()) ^ (columns - _DEFAULTED_COLUMNS))
    )


def test_the_verdicts_reasons_and_rules_are_each_admitted_by_a_named_check() -> None:
    """Each value the assessment can produce appears single-quoted in the migration, and
    the named CHECKs admit EXACTLY those sets, so a branch that the table would refuse
    (and so fail a whole derive) cannot ship, and a value nothing produces cannot hide."""
    text = _migration_text()
    for value in (*MT5_SERVER_CLOCK_VERDICTS, *MT5_SERVER_CLOCK_UNMEASURED_REASONS, *_RULES):
        assert f"'{value}'" in text, f"{value!r} is not admitted by the migration"
    assert _constraint_literals(text, "mt5_server_clock_readings_verdict_chk") == set(
        MT5_SERVER_CLOCK_VERDICTS
    )
    assert _constraint_literals(text, "mt5_server_clock_readings_reason_chk") == set(
        MT5_SERVER_CLOCK_UNMEASURED_REASONS
    )
    assert _constraint_literals(text, "mt5_server_clock_readings_rule_chk") == set(_RULES)


def test_a_fixed_zero_clock_row_fits_the_existing_checks() -> None:
    """Phase 217 R1: a server mapped to ``utc`` is the fixed offset 0, so its reading row
    carries ``configured_rule = 'fixed'`` and ``expected_offset_s = 0``. Both are already
    admitted by the applied migration (the rule CHECK lists ``fixed``), so Phase 217 needs no
    migration: this pins that the row stays inside the table's key set and rule CHECK."""
    clock = fixed_server_clock(0)
    now = datetime(2026, 10, 28, 12, 0, 0, tzinfo=timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    newest = now_ms - 100
    row = build_mt5_server_clock_reading_row(
        api_key_id="key-1",
        job_id="job-1",
        read_at=now,
        clock=clock,
        assessment=assess_server_clock_reading(
            clock, newest_tick_ms=newest, utc_now_ms=now_ms
        ),
        newest_tick_wall_ms=newest,
        symbols_visible=14,
        symbols_answered=14,
        server="Some-Server",
    )
    text = _migration_text()
    assert set(row) == _columns(text) - _DEFAULTED_COLUMNS
    assert row["configured_rule"] == "fixed"
    assert row["configured_rule"] in _constraint_literals(text, "mt5_server_clock_readings_rule_chk")
    assert row["expected_offset_s"] == 0
    assert row["verdict"] == "match"
