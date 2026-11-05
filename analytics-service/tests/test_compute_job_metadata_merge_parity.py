"""Phase 191 REFUSALRACE plan 09 - Python-to-SQL parity pins over the generated snapshots.

Four facts are shared between the Python services and the two SQL functions that merge into
``compute_jobs.metadata``, and each one exists as a separate copy that nothing but a test can
keep in step:

1. the ledger-refresh marker set: ``LEDGER_REFRESH_JOB_SOURCES`` in Python, a literal ``IN``
   list in SQL (and a third copy in TypeScript, pinned by ``src/lib/ledger-refresh-marker.test.ts``);
2. the two rpc names the services call, which a rename in SQL would leave dangling;
3. the outcome words the retraction answers, which the Python caller maps to log lines;
4. the metadata key ``read_refusal_kept_figures``, written by the marker function and read by the
   status bridge.

A test that merely imports a constant and compares it with itself cannot catch a typo in the
constant, so every expected value here is read from the GENERATED snapshot under
``supabase/schema/functions/`` (the canonical current body, replayed from the migrations) and
compared with the Python constant. Each pin has a widened-copy or misspelled-copy case showing
it can go red, because a parity test that cannot fail only looks like coverage.
"""
from __future__ import annotations

import re
from pathlib import Path

from services.ingestion.long_fetch import RETRACT_REFRESH_MARKER_RPC, RETRACTION_OUTCOMES
from services.job_worker import (
    LEDGER_REFRESH_JOB_SOURCES,
    MARK_KEPT_FIGURES_RPC,
    READ_REFUSAL_KEPT_FIGURES_KEY,
)

_FUNCTIONS = Path(__file__).resolve().parents[2] / "supabase" / "schema" / "functions"
_RETRACT_SQL = (_FUNCTIONS / "retract_ledger_refresh_marker.sql").read_text()
_MARK_SQL = (_FUNCTIONS / "mark_compute_job_kept_figures.sql").read_text()
_BRIDGE_SQL = (_FUNCTIONS / "sync_strategy_analytics_status.sql").read_text()

# Mirrors the regex in src/lib/ledger-refresh-marker.test.ts (parseSqlLedgerRefreshSourceLists).
_SOURCE_LIST_RE = re.compile(r"->>\s*'source'\)\s*IN\s*\(([^)]*)\)")
_OUTCOME_RE = re.compile(r"'outcome',\s*'([a-z_]+)'")
_FUNCTION_NAME_RE = re.compile(r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z_0-9]+)\(")


def _source_lists(sql: str) -> list[frozenset[str]]:
    """Every ``(metadata ->> 'source') IN (...)`` list in ``sql``. A member that is not a quoted
    literal raises: a silently skipped member would let the lists drift apart unseen."""
    lists: list[frozenset[str]] = []
    for match in _SOURCE_LIST_RE.finditer(sql):
        members = []
        for token in (t.strip() for t in match.group(1).split(",")):
            literal = re.fullmatch(r"'([^']+)'", token)
            assert literal, f"unresolvable list member {token!r} in a marker list"
            members.append(literal.group(1))
        lists.append(frozenset(members))
    return lists


def _function_names(sql: str) -> list[str]:
    return _FUNCTION_NAME_RE.findall(sql)


def _outcomes(sql: str) -> frozenset[str]:
    return frozenset(_OUTCOME_RE.findall(sql))


def test_retraction_marker_lists_equal_the_python_marker_set() -> None:
    """The retraction function names the marker set twice (the UPDATE's guard and the
    classifying SELECT). Both must equal ``LEDGER_REFRESH_JOB_SOURCES``: a marker the SQL does not
    know is never retracted, so a Sync would keep an inherited refresh marker the Python side
    believes it removed. The list count is pinned (measured 2026-11-05: 2) so a parse that finds
    nothing fails instead of comparing an empty set."""
    lists = _source_lists(_RETRACT_SQL)
    assert len(lists) == 2, f"expected 2 marker lists in the retraction snapshot, found {len(lists)}"
    for found in lists:
        assert found == LEDGER_REFRESH_JOB_SOURCES


def test_a_marker_added_to_the_sql_alone_fails_the_comparison() -> None:
    """The comparison above can go red: widen one list in a copy of the snapshot and the
    parsed set no longer equals the Python one."""
    widened = _RETRACT_SQL.replace(
        "IN ('ledger-refresh', 'ledger-refresh-composite')",
        "IN ('ledger-refresh', 'ledger-refresh-composite', 'ledger-refresh-mt5')",
        1,
    )
    assert widened != _RETRACT_SQL, "the replace matched nothing: re-point the widened-copy case"
    lists = _source_lists(widened)
    assert any(found != LEDGER_REFRESH_JOB_SOURCES for found in lists)
    assert any(len(found) == 3 for found in lists)


def test_rpc_name_constants_equal_the_snapshots_function_names() -> None:
    """``MARK_KEPT_FIGURES_RPC`` and ``RETRACT_REFRESH_MARKER_RPC`` are what the services pass to
    ``rpc(...)``. A typo in either constant (or a renamed function) makes every call answer
    PGRST202 at runtime, and tests that import the constant would agree with the typo. Each
    snapshot defines exactly one function, and its name must equal the constant."""
    assert _function_names(_MARK_SQL) == [MARK_KEPT_FIGURES_RPC]
    assert _function_names(_RETRACT_SQL) == [RETRACT_REFRESH_MARKER_RPC]


def test_a_misspelled_rpc_constant_would_not_match_the_snapshot() -> None:
    """The name comparison above can go red: a misspelled name differs from the parsed one."""
    assert _function_names(_RETRACT_SQL) != [RETRACT_REFRESH_MARKER_RPC + "x"]
    assert _function_names(_MARK_SQL) != [MARK_KEPT_FIGURES_RPC.replace("kept", "kep")]


def test_retraction_outcomes_equal_the_snapshots_outcome_words() -> None:
    """``RETRACTION_OUTCOMES`` is the set the Python caller accepts as an answer. A word the SQL
    can answer but the set lacks makes the caller treat a real answer as a protocol error; a word
    in the set that SQL never answers is dead code that hides a rename. Size 4 is the
    anti-vacuity pin (retracted, done, no_marker, no_row)."""
    found = _outcomes(_RETRACT_SQL)
    assert len(found) == 4, found
    assert found == RETRACTION_OUTCOMES


def test_a_fifth_outcome_in_the_sql_alone_fails_the_comparison() -> None:
    """The outcome comparison can go red: a word added to a copy of the snapshot alone makes
    the parsed set differ from ``RETRACTION_OUTCOMES``."""
    widened = _RETRACT_SQL.replace(
        "'outcome', 'no_row'", "'outcome', 'no_row'), jsonb_build_object('outcome', 'surprise'", 1
    )
    assert widened != _RETRACT_SQL, "the replace matched nothing: re-point the widened-copy case"
    assert _outcomes(widened) != RETRACTION_OUTCOMES


def test_refusal_marker_key_literal_matches_the_constant_and_both_snapshots() -> None:
    """The key is written by the marker function and read by the status bridge, in separate SQL
    files, and named by the Python constant. The literal is typed by hand here so a typo in the
    constant is caught (importing it would agree with the typo), and it must appear in BOTH
    snapshots: the writer and the reader of the same key."""
    assert READ_REFUSAL_KEPT_FIGURES_KEY == "read_refusal_kept_figures"
    assert "'read_refusal_kept_figures'" in _MARK_SQL
    assert "read_refusal_kept_figures" in _BRIDGE_SQL


def test_a_misspelled_key_is_absent_from_both_snapshots() -> None:
    """The presence checks above can go red: a one-letter misspelling is in neither file."""
    assert "'read_refusal_kept_figure'" not in _MARK_SQL
    assert "read_refusal_kept_figurez" not in _BRIDGE_SQL
