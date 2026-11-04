"""Phase 191 REFUSALRACE -- static privilege pins for the two metadata merge functions.

``public.mark_compute_job_kept_figures(uuid)`` and
``public.retract_ledger_refresh_marker(uuid, text)`` are SECURITY DEFINER writers of
``compute_jobs.metadata``. Supabase default privileges grant EXECUTE on a new function to
``anon`` and ``authenticated`` directly, so a migration that forgets to name them in the
REVOKE, or widens a GRANT, would let any signed-in user (or an anonymous caller) rewrite a
job's metadata through PostgREST: flip the refusal marker or strip a ledger-refresh marker.

These tests read the migration text only (no database), so they run in every analytics
job. The behavioural proof (both write orders keep every key, the ACL on a real cluster)
lives in ``supabase/tests/test_compute_job_metadata_merge.sql``.
"""
from __future__ import annotations

import pathlib
import re

import pytest

_MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20261106120000_refusalrace_metadata_merge_rpcs.sql"
)

_FUNCTIONS = [
    pytest.param("mark_compute_job_kept_figures", "uuid", id="mark_compute_job_kept_figures"),
    pytest.param("retract_ledger_refresh_marker", r"uuid,\s*text", id="retract_ledger_refresh_marker"),
]


def _statements() -> list[str]:
    """The migration split into code statements (comment lines dropped).

    The function bodies hold ``;`` inside ``$$ ... $$`` so they are not split here; the
    tests that need a function's own text slice it by its CREATE and its closing ``$$;``.
    """
    return [
        line
        for line in _MIGRATION_PATH.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("--")
    ]


def _code() -> str:
    return "\n".join(_statements())


def _create_statement(name: str) -> str:
    code = _code()
    matches = re.findall(
        rf"CREATE\s+FUNCTION\s+public\.{name}\(.*?\n\$\$;",
        code,
        flags=re.DOTALL,
    )
    assert len(matches) == 1, (
        f"expected exactly one plain CREATE FUNCTION public.{name}( in the migration, "
        f"found {len(matches)}. CREATE OR REPLACE would silently replace someone else's body."
    )
    return matches[0]


@pytest.mark.parametrize(("name", "args"), _FUNCTIONS)
def test_function_is_security_definer_with_a_pinned_search_path(name: str, args: str) -> None:
    """A SECURITY DEFINER function with a mutable search_path can be hijacked by a
    same-named object in a schema the caller controls, and running as INVOKER would make
    every legitimate service-role call fail on the RLS-protected table."""
    stmt = _create_statement(name)
    assert re.search(r"SECURITY\s+DEFINER", stmt), f"{name} must be SECURITY DEFINER"
    assert re.search(r"SET\s+search_path\s*=\s*public\s*,\s*pg_catalog", stmt), (
        f"{name} must pin SET search_path = public, pg_catalog"
    )


@pytest.mark.parametrize(("name", "args"), _FUNCTIONS)
def test_revoke_names_public_anon_and_authenticated(name: str, args: str) -> None:
    """``FROM PUBLIC`` alone leaves anon and authenticated with the EXECUTE Supabase
    default privileges gave them, so both must be named in the REVOKE."""
    code = _code()
    pattern = re.compile(
        rf"REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.{name}\({args}\)\s+FROM\s+"
        r"PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;",
        flags=re.IGNORECASE,
    )
    assert len(pattern.findall(code)) == 1, (
        f"{name}: exactly one REVOKE ALL ... FROM PUBLIC, anon, authenticated is required"
    )


@pytest.mark.parametrize(("name", "args"), _FUNCTIONS)
def test_grant_execute_goes_to_service_role_and_nothing_else(name: str, args: str) -> None:
    """The analytics worker and the Next.js routes call these with the service key; any
    other grantee turns a job-metadata writer into a user-reachable one."""
    code = _code()
    pattern = re.compile(
        rf"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.{name}\({args}\)\s+TO\s+([^;]*);",
        flags=re.IGNORECASE,
    )
    grants = pattern.findall(code)
    assert len(grants) == 1, f"{name}: exactly one GRANT EXECUTE is required, found {len(grants)}"
    assert grants[0].strip() == "service_role", (
        f"{name}: GRANT EXECUTE must name service_role and nothing else, got {grants[0]!r}"
    )


def test_no_grant_anywhere_names_anon_or_authenticated() -> None:
    """A stray second GRANT (for example in a later copy-pasted block) would undo the
    REVOKE for either function."""
    for grant in re.findall(r"GRANT\s+[^;]*;", _code(), flags=re.IGNORECASE):
        assert not re.search(
            r"\b(anon|authenticated)\b", grant, flags=re.IGNORECASE
        ), f"GRANT statement names anon or authenticated: {grant!r}"


def test_the_migration_defines_exactly_these_two_functions() -> None:
    """The enqueue RPC and the status bridge must not be redefined here (D-01): this file
    ships alone as PR 1 and a third function-defining statement would be an unreviewed one."""
    defining = [
        line
        for line in _statements()
        if re.match(r"\s*(CREATE|ALTER|DROP)\s+(OR\s+REPLACE\s+)?FUNCTION\b", line, flags=re.IGNORECASE)
    ]
    assert len(defining) == 2, f"expected exactly two function-defining statements, found {defining!r}"
