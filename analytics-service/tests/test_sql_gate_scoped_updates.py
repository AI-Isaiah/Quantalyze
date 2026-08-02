"""D-05 — every ``UPDATE`` on ``strategy_analytics`` in ``supabase/tests/`` must be
scoped to a block-local seeded id.

WHY this gate exists (Rule 9 — the WHY, not the WHAT)
-----------------------------------------------------
``supabase/tests/*.sql`` run against the ONE SHARED Supabase test project
(``qmnijlgmdhviwzwfyzlc``), concurrently with other PRs. An ``UPDATE`` on
``strategy_analytics`` whose ``WHERE`` clause is not bound to a strategy_id the
block itself seeded writes across OTHER tenants' rows — another PR's in-flight
fixture — mid-run. Those writes are invisible to the author (the surrounding
``ROLLBACK`` hides them from the *writer*, not from a concurrent *reader*) and
produce failures in a completely different test file.

`test_strategy_analytics_stuck_computing_reaper.sql` carried three such
statements until Phase 142.1 (D-05 / D-18). They were DELETED rather than
narrowed, and the gate's isolation is now BY CONSTRUCTION: it seeds its
must-be-reaped rows a century back so they outrank any plausible foreign row for
the deployed reaper's ``ORDER BY computing_started_at ASC … LIMIT 25`` budget.
This test is what stops the deleted pattern from growing back.

ONE RULE, no special cases
--------------------------
Every statement matching ``UPDATE (public.)?strategy_analytics`` must carry a
``strategy_id`` predicate bound to a **plpgsql identifier**::

    WHERE strategy_id = v_strat            -- reaper Part 4b
    WHERE strategy_id = strat              -- test_metrics_by_basis_write.sql
    WHERE strategy_id = strat_comp         -- test_wizard_composite_members.sql
    WHERE strategy_id = ANY (v_seeded)     -- a seeded array

There is deliberately **no accepted ``<> ALL (…)`` form and no staleness-conjunct
branch** — the neutralization shape no longer exists in the tree, so the gate has
no exception to carve out for it. ``<> ALL (v_seeded)`` is precisely the shape
that must FLAG.

⚠️ The optional-schema alternation is MANDATORY.
``test_metrics_by_basis_write.sql:68,71,74,83`` use the **unqualified**
``UPDATE strategy_analytics`` form and are correctly scoped today — proof the
unqualified form is live. A ``public.``-only pattern would let an unscoped
unqualified ``UPDATE`` added later walk straight through.

⚠️ Comments are stripped FIRST (S-1). The reaper gate's own header quotes the
deleted neutralizing ``UPDATE`` verbatim so a future reader knows what was
removed; a naive whole-file regex would flag that prose.

Pure-stdlib, I/O-free apart from reading repo files. No DB, no ccxt.
"""

from __future__ import annotations

import re
from pathlib import Path

# analytics-service/tests/ -> repo root is parents[2].
_REPO_ROOT = Path(__file__).resolve().parents[2]
_SQL_TESTS_DIR = _REPO_ROOT / "supabase" / "tests"

_LINE_COMMENT_RE = re.compile(r"--[^\n]*")
_WS_RE = re.compile(r"\s+")

# A whole UPDATE statement on strategy_analytics, qualified or not, up to its
# terminating semicolon. Comments are stripped before this runs, so the only
# semicolons left are real statement terminators.
_UPDATE_RE = re.compile(
    r"UPDATE\s+(?:public\.)?strategy_analytics\b[^;]*;",
    re.IGNORECASE,
)

# The ONE accepted scoping form: strategy_id compared for EQUALITY against a
# bare plpgsql identifier, or membership in a bare identifier array.
# `ANY`/`ALL` are excluded from the bare-identifier branch so that
# `= ANY (SELECT …)` (not a block-local seeded array) does not sneak through as
# if `ANY` were the variable name.
_SCOPED_RE = re.compile(
    r"strategy_id\s*=\s*(?:"
    r"ANY\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)"
    r"|(?!ANY\b)(?!ALL\b)[A-Za-z_][A-Za-z0-9_]*"
    r")",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Anti-vacuity pin (S-2). Re-derived against the real tree at Phase 142.1 wave 2.
#
# Without this, the gate passes trivially if the extraction regex silently stops
# matching (a rename, a reformat, a bad edit to _UPDATE_RE) — "no violations"
# and "nothing scanned" look identical from the outside.
#
# ⚠️ These counts are EXPECTED TO MOVE, and each move belongs in the SAME commit
# as the SQL edit that causes it — that is the pin doing its job, not churn:
#   * plan 142.1-05's Part-4 retrofit DELETED the reaper file's last remaining
#     strategy_analytics UPDATE (the SC-2b sentinel is now seeded at INSERT,
#     because migration
#     20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql
#     coerces the stamp on any UPDATE of an already-computing row) -> reaper 1 -> 0
#   * plan 142.1-08's Part 6 adds three scoped driver UPDATEs
#                                              -> reaper 0 -> 3
#
# ⚠️ A count of ZERO is expressed by ABSENCE, not by an explicit `: 0` entry.
# `actual` below is built with a truthiness filter, so a file with no matches
# never appears in it and an explicit `: 0` here would fail the comparison. The
# gate is unweakened: if the reaper file regains an UPDATE, `actual` gains a key
# this map does not have and the assertion still fires.
# ---------------------------------------------------------------------------
_EXPECTED_MATCH_COUNTS: dict[str, int] = {
    "test_metrics_by_basis_write.sql": 4,
    "test_wizard_composite_members.sql": 2,
    # test_strategy_analytics_stuck_computing_reaper.sql: 0 — intentionally
    # absent per the note above. Plan 142.1-08 restores it at 3.
}


def _strip_comments(sql: str) -> str:
    """Strip SQL line comments. MANDATORY before any pattern scan (S-1)."""
    return _LINE_COMMENT_RE.sub("", sql)


def _update_statements(sql: str) -> list[str]:
    """Every strategy_analytics UPDATE statement in `sql`, comments stripped and
    whitespace collapsed."""
    return [
        _WS_RE.sub(" ", stmt).strip()
        for stmt in _UPDATE_RE.findall(_strip_comments(sql))
    ]


def _unscoped_updates(sql: str) -> list[str]:
    """Every strategy_analytics UPDATE in `sql` that is NOT bound to a
    block-local seeded strategy_id."""
    return [stmt for stmt in _update_statements(sql) if not _SCOPED_RE.search(stmt)]


def _sql_test_files() -> list[Path]:
    return sorted(_SQL_TESTS_DIR.glob("test_*.sql"))


def test_every_strategy_analytics_update_in_sql_tests_is_seed_scoped() -> None:
    """D-05: no cross-tenant write may exist in supabase/tests/."""
    violations: list[str] = []
    for path in _sql_test_files():
        for stmt in _unscoped_updates(path.read_text()):
            violations.append(f"{path.relative_to(_REPO_ROOT)}: {stmt}")

    assert not violations, (
        "D-05 VIOLATION — UPDATE on strategy_analytics in supabase/tests/ whose "
        "strategy_id predicate is not bound to a block-local seeded identifier. "
        "These files run against the SHARED test project concurrently with other "
        "PRs; an unscoped UPDATE writes across another PR's fixture mid-run and "
        "surfaces as a failure somewhere else entirely. Scope it to a strategy_id "
        "this block seeded (`= v_strat` / `= ANY (v_seeded)`). ⛔ `<> ALL (v_seeded)` "
        "is NOT an accepted form — Phase 142.1 (D-18) deleted the three "
        "neutralizing UPDATEs that used it and replaced them with "
        "isolation-by-construction (century-old seeds + seeded-set assertions). "
        "Offenders:\n  " + "\n  ".join(violations)
    )


def test_scanner_is_not_vacuous() -> None:
    """S-2: pin the per-file match counts so a silently-broken extraction cannot
    masquerade as a clean tree."""
    actual = {
        path.name: len(_update_statements(path.read_text()))
        for path in _sql_test_files()
    }
    actual = {name: count for name, count in actual.items() if count}

    assert actual == _EXPECTED_MATCH_COUNTS, (
        "D-05 anti-vacuity pin drifted. Either a supabase/tests file gained or "
        "lost a strategy_analytics UPDATE (update _EXPECTED_MATCH_COUNTS in the "
        "SAME commit as the SQL edit — see the comment above the map), or the "
        "extraction regex stopped matching and this gate is now green over "
        "nothing.\n"
        f"  expected: {_EXPECTED_MATCH_COUNTS}\n"
        f"  actual:   {actual}"
    )


def test_scanner_self_test_five_polarities() -> None:
    """The gate's green must be falsifiable WITHOUT touching repo files.

    Drives both directions on synthetic in-memory SQL, including the exact
    neutralization shape D-18 deleted.
    """
    # 1. unscoped, SCHEMA-QUALIFIED -> flagged
    assert _unscoped_updates(
        "UPDATE public.strategy_analytics SET computation_error = NULL;"
    ), "an unscoped schema-qualified UPDATE must be flagged"

    # 2. unscoped, UNQUALIFIED -> flagged (test_metrics_by_basis_write.sql proves
    #    the unqualified form is live in the tree)
    assert _unscoped_updates(
        "UPDATE strategy_analytics SET computation_error = NULL;"
    ), "an unscoped UNQUALIFIED UPDATE must be flagged"

    # 3. scoped to a single seeded id -> passes
    assert not _unscoped_updates(
        "UPDATE public.strategy_analytics SET computing_started_at = v_sentinel "
        "WHERE strategy_id = v_strat;"
    ), "`= v_strat` is the accepted block-local form"

    # 4. scoped to a seeded array -> passes
    assert not _unscoped_updates(
        "UPDATE strategy_analytics SET computation_status = 'failed' "
        "WHERE strategy_id = ANY (v_seeded);"
    ), "`= ANY (v_seeded)` is the accepted block-local form"

    # 5. the DELETED neutralization shape -> flagged. It was legal-looking, ran
    #    green for a whole phase, and wrote across every other tenant's rows.
    assert _unscoped_updates(
        "UPDATE public.strategy_analytics SET computing_started_at = NULL "
        "WHERE computation_status = 'computing' AND strategy_id <> ALL (v_seeded);"
    ), "`<> ALL (v_seeded)` is the neutralization shape D-18 deleted — it must FLAG"


def test_comments_are_stripped_before_scanning() -> None:
    """The reaper gate's header quotes the deleted neutralizing UPDATE verbatim so
    future readers know what was removed. Prose must never be scanned."""
    commented = (
        "-- UPDATE public.strategy_analytics SET computing_started_at = NULL\n"
        "--  WHERE computation_status = 'computing' AND strategy_id <> ALL (v_seeded);\n"
    )
    assert not _update_statements(commented), (
        "comments must be stripped FIRST (S-1) — the reaper gate documents the "
        "deleted pattern in its header and would otherwise flag itself"
    )
