"""Drift gate for the KIND SCOPE on the CR-01 refresh-protection predicate.

Phase 161.1, migration re-review (rls-policy-auditor MEDIUM). The protection in
``supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql``
keys on ``compute_jobs.metadata ->> 'source'`` — a key the request path also
writes (``routers/process_key.py`` puts the caller's ``body.source`` into
``p_metadata``). Today the values cannot collide, because the Pydantic ``Source``
Literal admits venue names only; that is one enum widening from not being true.

The structural half of the containment is the predicate's ``f.kind IN (...)``
list, and that list is HAND-MAINTAINED across four files in three languages with
no compiler between them. This module is the compiler:

* :func:`test_kind_scope_matches_every_marker_carrying_enqueue` fails if a fan-out
  arm starts enqueuing a kind the SQL predicate does not admit (that job's
  failures would silently stop being protected — CR-01 re-opens, quietly), or if
  the SQL list admits a kind nothing can enqueue with a marker (dead surface).
* :func:`test_request_derived_enqueue_kind_is_outside_the_scope` fails if the
  request-derived writer's kind ever lands inside the scope, which is the
  precondition for a forged marker to matter at all.

⛔ Every extraction below asserts it found something before it compares. A regex
that silently matches nothing would make both tests pass against an empty set,
which is the vacuity mode this phase has now found fifteen times.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final

from services.job_worker import JOB_CHAIN_FOLLOW_ON

_REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
_MIGRATIONS: Final[Path] = _REPO_ROOT / "supabase" / "migrations"

_PROTECTION_MIGRATION: Final[Path] = (
    _MIGRATIONS / "20260825150000_sync_status_protect_marked_refresh.sql"
)
# The two recurring-refresh fan-out arms. Each enqueues one kind carrying a
# marker; a third arm is exactly the drift this gate exists to catch, so it is
# NOT enumerated defensively — it would show up as a fan-out kind missing from
# the SQL scope.
_FANOUT_MIGRATIONS: Final[tuple[Path, ...]] = (
    _MIGRATIONS / "20260825130000_ledger_refresh_fanout_dormant.sql",
    _MIGRATIONS / "20260825140000_ledger_refresh_composite_arm.sql",
)
_PROCESS_KEY_ROUTER: Final[Path] = (
    _REPO_ROOT / "analytics-service" / "routers" / "process_key.py"
)

# `AND f.kind IN ('a', 'b', 'c')` inside the live_failures CTE.
_SQL_KIND_SCOPE_RE: Final[re.Pattern[str]] = re.compile(
    r"AND\s+f\.kind\s+IN\s*\(([^)]*)\)", re.IGNORECASE
)
_SQL_LITERAL_RE: Final[re.Pattern[str]] = re.compile(r"'([a-z_]+)'")
# `p_kind := 'derive_broker_dailies'` in a fan-out's enqueue_compute_job call.
_FANOUT_KIND_RE: Final[re.Pattern[str]] = re.compile(
    r"p_kind\s*:=\s*'([a-z_]+)'"
)
# A `"p_kind": "<kind>"` enqueue whose metadata carries the REQUEST's source.
# The `[^}]*?` stops at the first closing brace, which cannot be crossed before
# `"source": body.source` because `"p_metadata": {` opens and does not close in
# between — so this only matches request-derived enqueues.
_REQUEST_DERIVED_ENQUEUE_RE: Final[re.Pattern[str]] = re.compile(
    r'"p_kind":\s*"([a-z_]+)"[^}]*?"source":\s*body\.source', re.DOTALL
)


def _read(path: Path) -> str:
    assert path.is_file(), (
        f"{path} does not exist. This gate compares four files that have no "
        "compiler between them; a missing one means it is comparing nothing."
    )
    return path.read_text(encoding="utf-8")


def _sql_kind_scope() -> set[str]:
    body = _read(_PROTECTION_MIGRATION)
    match = _SQL_KIND_SCOPE_RE.search(body)
    assert match is not None, (
        "The CR-01 protection predicate has no `AND f.kind IN (...)` scope. "
        "Without it the exemption trusts `metadata->>'source'` alone — a key "
        "routers/process_key.py writes from the request body."
    )
    kinds = set(_SQL_LITERAL_RE.findall(match.group(1)))
    assert kinds, f"The kind scope parsed as empty from: {match.group(1)!r}"
    return kinds


def _fanout_enqueued_kinds() -> set[str]:
    kinds: set[str] = set()
    for path in _FANOUT_MIGRATIONS:
        body = _read(path)
        assert "ledger-refresh" in body, (
            f"{path.name} no longer carries a ledger-refresh marker — either it "
            "is not a refresh fan-out any more, or the marker literal drifted."
        )
        found = set(_FANOUT_KIND_RE.findall(body))
        assert found, (
            f"No `p_kind := '...'` enqueue found in {path.name}. The extraction "
            "regex has drifted from the file, so this gate is comparing an "
            "empty set and cannot fail."
        )
        kinds |= found
    return kinds


def _marker_carrying_kinds() -> set[str]:
    """Every kind that can legitimately reach the bridge carrying a marker."""
    fanout = _fanout_enqueued_kinds()

    # The chain hop: services/job_worker.py forwards the marker from a
    # derive_broker_dailies job onto JOB_CHAIN_FOLLOW_ON['derive_broker_dailies'][0]
    # (the `_enqueue_csv_analytics` payload). Read from the real constant, not
    # from a literal, so a chain re-wiring moves this set automatically.
    follow_on = JOB_CHAIN_FOLLOW_ON["derive_broker_dailies"]
    assert follow_on, (
        "JOB_CHAIN_FOLLOW_ON['derive_broker_dailies'] is empty — the marker is "
        "forwarded onto its first element, so an empty tuple means this gate "
        "silently stopped covering the chain hop."
    )
    return fanout | {follow_on[0]}


def test_kind_scope_matches_every_marker_carrying_enqueue() -> None:
    """The SQL kind list == the kinds that can actually carry a refresh marker.

    Both directions matter and neither is cosmetic:

    * a marker-carrying kind MISSING from the SQL list silently loses its
      protection — a funded account goes dark on the next failed refresh, which
      is CR-01 itself;
    * a kind in the SQL list that nothing can enqueue with a marker is exemption
      surface with no reachable producer, i.e. blast radius bought for nothing.
    """
    assert _sql_kind_scope() == _marker_carrying_kinds(), (
        "KIND SCOPE DRIFT: migration 20260825150000's `f.kind IN (...)` is "
        f"{sorted(_sql_kind_scope())} but the kinds that can carry a refresh "
        f"marker are {sorted(_marker_carrying_kinds())} (the two fan-out "
        "migrations' p_kind enqueues plus the JOB_CHAIN_FOLLOW_ON hop out of "
        "derive_broker_dailies). A kind missing from the SQL side is a funded "
        "account that un-publishes on its next failed refresh."
    )


def test_request_derived_enqueue_kind_is_outside_the_scope() -> None:
    """The one request-influenced metadata writer must land outside the scope.

    routers/process_key.py copies the request's ``body.source`` into the job's
    metadata. The value cannot collide with a refresh marker today (the Pydantic
    ``Source`` Literal admits venue names only), but the kind scope is the half
    of the containment that does not depend on that Literal staying narrow.
    """
    matches = set(_REQUEST_DERIVED_ENQUEUE_RE.findall(_read(_PROCESS_KEY_ROUTER)))
    assert matches, (
        "No `\"p_kind\": ... \"source\": body.source` enqueue found in "
        "process_key.py. Either the request-derived metadata writer moved (this "
        "gate must follow it) or the regex drifted — and a gate that matches "
        "nothing passes for free."
    )

    collisions = matches & _sql_kind_scope()
    assert not collisions, (
        f"CONTAINMENT LOST: process_key.py enqueues {sorted(collisions)} with "
        "the REQUEST's body.source in metadata, and migration 20260825150000 "
        "protects that kind. The only remaining barrier is the Pydantic Source "
        "Literal in services/ingestion/adapter.py — widen that enum and a "
        "caller can keep a permanently-failing strategy published."
    )
