"""Phase 167.1.2.1 RECONMARKER, review WR-01: the fan-out's OWED predicate has a
Python twin, and this test keeps the two from drifting apart.

THE TWO COPIES. The daily fan-out (``enqueue_refresh_allocator_equity_for_all``,
migration 20261021120000) enqueues a key's reconstruct only when the key
QUALIFIES (active, not revoked, sync_status not sign_in_failed / error, not
disconnected, not Deribit, not linked to one of its owner's non-archived
strategies) and is OWED (marker NULL, attempts under the cap, no reconstruct in
flight). The worker's refresh hold (``_owed_reconstructs_for_zero_snapshot_book``)
asks "would the fan-out still retry this key?", so it must apply the same terms.
It once did not apply the strategy-link term: a key that failed once and was then
linked to a strategy held its book's first refresh for ever, because the fan-out
never retried it and its attempts never reached the cap.

A comment does not keep two predicates equal; a test that reads the SQL does. This
file reads the text of the NEWEST migration that defines the function (as the cap
twin test does) and pins three things, each of which must be able to fail:

  1. Every conjunct of the per-key ``rk`` query is one of the terms below. A term
     added to the SQL with no entry here fails the test by name (the drift this
     file exists to catch), and a term deleted from the SQL fails it too.
  2. The literal lists in the SQL (the sync_status exclusions, the in-flight
     statuses, the cap) equal the Python constants.
  3. The Python predicate, driven through the real probe against an in-memory
     store, EXCLUDES a key for every qualifying term and every literal the SQL
     lists, and includes the unmutated control.

Two terms are deliberately not mirrored and are pinned as such: the fan-out's
"no reconstruct in flight" is INVERTED in Python (an in-flight job is waited on),
and Python additionally requires ``attempts >= 1`` (a key no job has touched has
nothing to wait for).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any


from services.equity_reconstruction import (
    _NON_RETRYABLE_SYNC_STATUSES,
    _RECONSTRUCT_IN_FLIGHT_STATUSES,
    HISTORY_RECONSTRUCT_ATTEMPT_CAP,
)
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_MIGRATIONS = _REPO_ROOT / "supabase" / "migrations"

_FN_RE = re.compile(
    r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.enqueue_refresh_allocator_equity_for_all\s*\(\s*\)"
    r"(?P<head>.*?)AS\s+\$\$(?P<body>.*?)\n\$\$;",
    re.IGNORECASE | re.DOTALL,
)
_CAP_RE = re.compile(
    r"v_reconstruct_attempt_cap\s+CONSTANT\s+integer\s*:=\s*(\d+)\s*;", re.IGNORECASE
)


def _strip_sql_comments(text: str) -> str:
    return "\n".join(re.sub(r"--.*$", "", line) for line in text.splitlines())


def _newest_fanout_body() -> tuple[str, str]:
    """(file name, comment-stripped body) of the newest migration defining the
    fan-out with the reconstruct cap. Loud when none does."""
    found: list[tuple[str, str]] = []
    for path in sorted(_MIGRATIONS.glob("*.sql")):
        code = _strip_sql_comments(path.read_text(encoding="utf-8"))
        for match in _FN_RE.finditer(code):
            if "v_reconstruct_attempt_cap" in match.group("body"):
                found.append((path.name, match.group("body")))
    assert found, (
        f"no migration under {_MIGRATIONS} defines enqueue_refresh_allocator_equity_for_all "
        "with v_reconstruct_attempt_cap, so the owed predicate cannot be read and its "
        "Python twin is unpinned (a silent pass here would defeat the test)"
    )
    return found[-1]


def _rk_query(body: str) -> str:
    match = re.search(
        r"FOR\s+v_rkey\s+IN\s+SELECT(?P<q>.*?)ORDER\s+BY\s+rk\.", body, re.IGNORECASE | re.DOTALL
    )
    assert match, "the per-key `rk` owed query was not found in the fan-out; re-read the migration"
    return match.group("q")


def _conjuncts(query: str) -> list[str]:
    """The WHERE conjuncts of the `rk` query, one per top-level AND (each is its
    own line in the migration). The first piece also carries the SELECT list."""
    where = re.split(r"\bWHERE\b", query, maxsplit=1, flags=re.IGNORECASE)
    assert len(where) == 2, query
    return [c.strip() for c in re.split(r"\n\s*AND\s+", where[1]) if c.strip()]


_NOT_ARCHIVED = (
    r"\w+\.api_key_id = \w+\.id AND \w+\.user_id = \w+\.user_id AND \w+\.status <> 'archived'"
)

# term name -> regex over ONE conjunct. Every conjunct must match exactly one.
_TERMS: dict[str, str] = {
    "owner_scope": r"^\w+\.user_id = v_book\.owner_id$",
    "active": r"^\w+\.is_active = TRUE$",
    "not_revoked": r"^\w+\.sync_status IS DISTINCT FROM 'revoked'$",
    "sync_status_exclusions": r"^coalesce\(\w+\.sync_status, ''\) NOT IN \((?P<lits>[^)]*)\)$",
    "not_disconnected": r"^\w+\.disconnected_at IS NULL$",
    "not_deribit": r"^lower\(\w+\.exchange\) <> 'deribit'$",
    "not_linked_direct": (
        r"^NOT EXISTS \(SELECT 1 FROM strategies \w+ WHERE " + _NOT_ARCHIVED + r"\)$"
    ),
    "not_linked_composite": (
        r"^NOT EXISTS \(SELECT 1 FROM strategy_keys \w+ JOIN strategies \w+ ON "
        r"\w+\.id = \w+\.strategy_id WHERE \w+\.api_key_id = \w+\.id AND "
        r"\w+\.user_id = \w+\.user_id AND \w+\.status <> 'archived'\)$"
    ),
    "marker_null": r"^\w+\.history_reconstructed_at IS NULL$",
    "under_cap": r"^\w+\.history_reconstruct_attempts < v_reconstruct_attempt_cap$",
    "none_in_flight": (
        r"^NOT EXISTS \(SELECT 1 FROM compute_jobs \w+ WHERE \w+\.api_key_id = \w+\.id AND "
        r"\w+\.kind = 'reconstruct_allocator_history' AND \w+\.status IN \((?P<lits>[^)]*)\)\)$"
    ),
}


def _literals(text: str) -> set[str]:
    return set(re.findall(r"'([^']*)'", text))


def _classify() -> tuple[str, dict[str, re.Match[str]]]:
    name, body = _newest_fanout_body()
    matched: dict[str, re.Match[str]] = {}
    unmatched: list[str] = []
    for conj in _conjuncts(_rk_query(body)):
        # The first conjunct carries the SELECT list ("rk.id AS api_key_id FROM ... WHERE").
        hits = [
            (term, m)
            for term, rx in _TERMS.items()
            if (m := re.match(rx, conj, re.IGNORECASE | re.DOTALL))
        ]
        if len(hits) != 1:
            unmatched.append(conj)
            continue
        term, m = hits[0]
        assert term not in matched, f"term {term} matched two conjuncts in {name}"
        matched[term] = m
    assert not unmatched, (
        f"{name}: the per-key owed query has terms with no entry in this twin test: "
        f"{unmatched}. The worker's refresh hold must apply each one "
        "(services/equity_reconstruction.py, _fanout_would_still_retry and "
        "_strategy_linked_key_ids), then add the term here with a behaviour case below."
    )
    return name, matched


def test_every_term_of_the_fanout_owed_query_is_a_known_term_and_none_is_missing() -> None:
    name, matched = _classify()
    assert set(matched) == set(_TERMS), (
        f"{name}: the owed query no longer contains {sorted(set(_TERMS) - set(matched))}. "
        "A term was removed from the fan-out; remove it from the Python hold and from "
        "this test together."
    )


def test_the_sql_literal_lists_equal_the_python_constants() -> None:
    name, matched = _classify()
    sql_sync = _literals(matched["sync_status_exclusions"].group("lits")) | {"revoked"}
    assert sql_sync == set(_NON_RETRYABLE_SYNC_STATUSES), (
        f"{name} excludes sync_status {sorted(sql_sync)} but the Python hold excludes "
        f"{sorted(_NON_RETRYABLE_SYNC_STATUSES)}"
    )
    sql_inflight = _literals(matched["none_in_flight"].group("lits"))
    assert sql_inflight == set(_RECONSTRUCT_IN_FLIGHT_STATUSES), (
        f"{name} counts in-flight statuses {sorted(sql_inflight)} but the Python hold "
        f"waits on {sorted(_RECONSTRUCT_IN_FLIGHT_STATUSES)}"
    )
    _, body = _newest_fanout_body()
    assert int(_CAP_RE.search(body).group(1)) == HISTORY_RECONSTRUCT_ATTEMPT_CAP  # type: ignore[union-attr]


# --------------------------------------------------------------------------
# Behaviour: drive the real probe, not a helper. Zero-snapshot book, one key.
# --------------------------------------------------------------------------

_BASE_KEY: dict[str, Any] = {
    "id": API_KEY_ID_1,
    "user_id": ALLOCATOR_ID,
    "exchange": "okx",
    "is_active": True,
    "sync_status": "ok",
    "disconnected_at": None,
    "history_reconstructed_at": None,
    "history_reconstruct_attempts": 1,
}


# term -> the one mutation of the control that the fan-out's query excludes.
_ROW_MUTATIONS: dict[str, dict[str, Any]] = {
    "active": {"is_active": False},
    "not_revoked": {"sync_status": "revoked"},
    "not_disconnected": {"disconnected_at": "2026-09-10T00:00:00+00:00"},
    "not_deribit": {"exchange": "Deribit"},
    "marker_null": {"history_reconstructed_at": "2026-09-01T00:00:00+00:00"},
    "under_cap": {"history_reconstruct_attempts": HISTORY_RECONSTRUCT_ATTEMPT_CAP},
}
