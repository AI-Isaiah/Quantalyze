"""Drift gate for the KIND SCOPE on the CR-01 refresh-protection predicate.

Phase 161.1, migration re-review (rls-policy-auditor MEDIUM). The protection in
``sync_strategy_analytics_status`` keys on ``compute_jobs.metadata ->> 'source'`` — a key the request path also
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

⭐ 2026-10-03 (Phase 164.5.2.1, D-12): the SQL side is no longer a hard-coded
file. It is the NEWEST migration carrying a line-start ``CREATE`` of
``sync_strategy_analytics_status``, found by scan, so the gate follows every
re-base on its own. Until this date it read the 2026-08-25 protection migration,
three re-bases behind the body that ships. The resolved file is cross-checked
against the function snapshot's ``-- source migration:`` line, which
``scripts/dump-sql-functions.ts`` derives independently, and every ``kind IN``
list in the comment-stripped body must agree (there are two since this phase).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final

from services.job_worker import JOB_CHAIN_FOLLOW_ON

_REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
_MIGRATIONS: Final[Path] = _REPO_ROOT / "supabase" / "migrations"

_BRIDGE_SNAPSHOT: Final[Path] = (
    _REPO_ROOT / "supabase" / "schema" / "functions"
    / "sync_strategy_analytics_status.sql"
)
# A STATEMENT, not a mention: anchored at line start, so a header comment that
# quotes the phrase never counts. Accepts the bare, `public.` and quoted
# `"public"."..."` spellings of the name.
_BRIDGE_CREATE_RE: Final[re.Pattern[str]] = re.compile(
    r'^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+'
    r'(?:"public"\.|public\.)?"?sync_strategy_analytics_status"?\s*\(',
    re.MULTILINE | re.IGNORECASE,
)
# The dollar-quoted body after the CREATE: `AS $$ ... $$` or `AS $tag$ ... $tag$`.
_DOLLAR_BODY_RE: Final[re.Pattern[str]] = re.compile(
    r"\bAS\s+(\$[A-Za-z_]*\$)(.*?)\1", re.DOTALL | re.IGNORECASE
)
_SQL_LINE_COMMENT_RE: Final[re.Pattern[str]] = re.compile(r"--[^\n]*")
_SNAPSHOT_SOURCE_RE: Final[re.Pattern[str]] = re.compile(
    r"^-- source migration: (\S+)$", re.MULTILINE
)
# The two recurring-refresh fan-out arms. Each enqueues one kind carrying a
# marker; a third arm is exactly the drift this gate exists to catch, so it is
# NOT enumerated defensively — it would show up as a fan-out kind missing from
# the SQL scope.
#
# ⚠️ THREE FILES, and the THIRD is the live one. Phase 164.7 / D-01 re-defined
# BOTH arms in 20260907130000 (the activation switch moved off an
# `app.`-namespace database setting no operator on this platform can set, and
# onto public.system_flags). The two 20260825 entries are LINEAGE: their text is
# unchanged, so leaving them here costs nothing and keeps the historical enqueues
# in the comparison — but on their own they would pin a body that no longer runs,
# which is precisely the stale-pointer failure this module's docstring warns
# about. The newest entry is what makes this gate about the LIVE definition.
_FANOUT_MIGRATIONS: Final[tuple[Path, ...]] = (
    _MIGRATIONS / "20260825130000_ledger_refresh_fanout_dormant.sql",
    _MIGRATIONS / "20260825140000_ledger_refresh_composite_arm.sql",
    _MIGRATIONS / "20260907130000_ledger_refresh_switch_to_system_flags.sql",
)
_PROCESS_KEY_ROUTER: Final[Path] = (
    _REPO_ROOT / "analytics-service" / "routers" / "process_key.py"
)

# Every `kind IN ('a', 'b', 'c')` (bare or `f.`-qualified) in the body: the
# live_failures CTE's protection predicate and the non-terminal count's
# unmarked FILTER.
_SQL_KIND_SCOPE_RE: Final[re.Pattern[str]] = re.compile(
    r"\bkind\s+IN\s*\(([^)]*)\)", re.IGNORECASE
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


def _newest_bridge_definition() -> tuple[Path, str]:
    """The newest migration that CREATEs the bridge, and its comment-stripped body.

    Filename order is apply order. The body is the dollar-quoted block after the
    LAST such statement in that file, with `--` comments removed, so prose about
    a kind list can never stand in for one.
    """
    migrations = sorted(_MIGRATIONS.glob("*.sql"))
    assert migrations, f"No migrations found under {_MIGRATIONS}."
    for path in reversed(migrations):
        text = path.read_text(encoding="utf-8")
        creates = list(_BRIDGE_CREATE_RE.finditer(text))
        if not creates:
            continue
        body_match = _DOLLAR_BODY_RE.search(text, creates[-1].end())
        assert body_match is not None, (
            f"{path.name} CREATEs sync_strategy_analytics_status but no "
            "dollar-quoted body follows it. The body extraction has drifted from "
            "the file, so this gate would be comparing nothing."
        )
        body = _SQL_LINE_COMMENT_RE.sub("", body_match.group(2))
        assert body.strip(), f"The bridge body in {path.name} parsed as empty."
        return path, body
    raise AssertionError(
        "No migration CREATEs sync_strategy_analytics_status at line start. "
        "Either the statement scan drifted or the function was dropped; in both "
        "cases this gate is comparing nothing."
    )


def _snapshot_source_migration() -> str:
    """The `-- source migration:` filename the function dumper recorded."""
    sources = _SNAPSHOT_SOURCE_RE.findall(_read(_BRIDGE_SNAPSHOT))
    assert len(sources) == 1, (
        f"{_BRIDGE_SNAPSHOT.name} carries {len(sources)} `-- source migration:` "
        "line(s), not 1. The bridge has one overload; anything else means the "
        "snapshot format drifted and the cross-check below would compare nothing."
    )
    return sources[0]


def _sql_kind_scope() -> set[str]:
    path, body = _newest_bridge_definition()
    lists = _SQL_KIND_SCOPE_RE.findall(body)
    assert len(lists) >= 2, (
        f"The bridge body in {path.name} carries {len(lists)} `kind IN (...)` "
        "list(s), not at least 2 (the CR-01 protection predicate and the "
        "non-terminal count's unmarked FILTER). Without the first the exemption "
        "trusts `metadata->>'source'` alone, a key routers/process_key.py writes "
        "from the request body."
    )
    scopes = [frozenset(_SQL_LITERAL_RE.findall(raw)) for raw in lists]
    for raw, kinds in zip(lists, scopes):
        assert kinds, f"A kind scope in {path.name} parsed as empty from: {raw!r}"
    assert len(set(scopes)) == 1, (
        f"KIND LISTS DISAGREE inside {path.name}: "
        f"{[sorted(k) for k in scopes]}. The protection predicate and the "
        "unmarked FILTER must admit the same kinds, or a job the bridge protects "
        "is still counted as an unmarked sibling (or the reverse)."
    )
    return set(scopes[0])


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
    path, _ = _newest_bridge_definition()
    assert _sql_kind_scope() == _marker_carrying_kinds(), (
        f"KIND SCOPE DRIFT: {path.name}'s `kind IN (...)` lists read "
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
        "the REQUEST's body.source in metadata, and the newest bridge "
        f"definition ({_newest_bridge_definition()[0].name}) protects that kind. The only remaining barrier is the Pydantic Source "
        "Literal in services/ingestion/adapter.py — widen that enum and a "
        "caller can keep a permanently-failing strategy published."
    )


def test_newest_bridge_definition_is_the_snapshot_source() -> None:
    """The scan and the function dumper must name the SAME migration.

    Two independent resolvers: this module's line-start statement scan, and
    ``scripts/dump-sql-functions.ts``, which replays every migration and records
    which file the surviving body came from. If they disagree, one of them is
    reading a body that does not ship, and the kind comparison above would be
    measuring that body.
    """
    path, _ = _newest_bridge_definition()
    source = _snapshot_source_migration()
    assert path.name == source, (
        f"BRIDGE RESOLVER DISAGREEMENT: the statement scan resolves {path.name}, "
        f"but {_BRIDGE_SNAPSHOT.name} says its body came from {source}. Re-run "
        "`npm run schema:functions` if the snapshot is stale; otherwise the scan "
        "regex has drifted."
    )
