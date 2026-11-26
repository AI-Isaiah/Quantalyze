"""Phase 215 TESTREACH plan 02 - the live-DB cases that CANNOT run on the CI python job's lane, and
the scan that keeps the shared-TEST DSN out of every test module.

Seven psycopg modules now resolve a loopback lane DSN through ``tests/live_db_dsn.py`` and run in
CI. Every other live-DB case that still does not run there is listed in ``CANNOT_RUN_ON_LANE`` with
its reason, so "a live-DB case that never runs" is a named, reviewed set and not an accident. The
roster fails when an entry rots (its test was renamed or removed) and its size is floored, so a
shrinking list cannot hide a case that quietly stopped being listed.

The scan fails on any direct environment READ of the shared-TEST DSN variable under ``tests/``.
There is no allowlist: ``live_db_dsn.py`` itself never reads it either.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

from tests.live_db_dsn import SHARED_TEST_DSN_VAR

_TESTS_DIR = Path(__file__).resolve().parent

# "<module file>::<test function>" -> why it cannot run on the lane. Hand-typed on purpose: a
# derived list could not notice a case that disappeared. Re-verified against HEAD on 2026-11-15.
CANNOT_RUN_ON_LANE: dict[str, str] = {
    "test_sfox_client_live.py::test_sandbox_get_balances_authenticates_and_returns_list": (
        "Needs SFOX_SANDBOX_KEY, a real sFOX sandbox venue key minted by the founder; the lane "
        "holds no venue credentials and a skip here is a founder gate, not a pass."
    ),
    "test_sfox_client_live.py::test_sandbox_get_balance_history_returns_list": (
        "Needs SFOX_SANDBOX_KEY, a real sFOX sandbox venue key minted by the founder; the lane "
        "holds no venue credentials and a skip here is a founder gate, not a pass."
    ),
    "test_sfox_ground_truth_live.py::test_live_prod_key_parity_holds_exit_zero": (
        "Needs SFOX_GROUND_TRUTH_KEY, a real production sFOX key held by the founder; it compares "
        "against live venue data that no local database can reproduce."
    ),
    "test_upsert_strategy_analytics_series_batch_privilege.py::"
    "test_anon_client_cannot_call_upsert_strategy_analytics_series_batch": (
        "Needs HAS_LIVE_DB, SUPABASE_URL and SUPABASE_ANON_KEY; the python job's Lane handoff "
        "exports the lane URL and service key under SUPABASE_TEST_* and exports no anon key. The "
        "REVOKE it probes is also pinned statically by the module's three migration-text tests."
    ),
    "test_compute_similarity_sql.py::test_immutable_parallel_safe_flags": (
        "Needs SUPABASE_TEST_DB_URL, a raw DSN for a psycopg2 catalog query; the python job's Lane "
        "handoff exports only SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY and LANE_DB_URL, so "
        "the case skips on the lane."
    ),
    "test_migration_108_idempotent.py::test_migration_108_dynamic_reapply_idempotent": (
        "Its skipif passes on the lane (SUPABASE_TEST_URL is exported) but the body is an "
        "unconditional pytest.skip for live-DB work deferred to an integration suite, so it never "
        "runs anywhere."
    ),
    "test_compute_jobs_fencing.py::test_late_mark_done_with_stale_token_raises_serialization_failure": (
        "Permanently skipped in every environment by an explicit pytest skip decorator for a "
        "flaky httpx.ReadTimeout under suite load; it is not a DSN gate and the lane does not "
        "change it."
    ),
    "test_compute_jobs_fencing.py::test_late_mark_failed_with_stale_token_raises_serialization_failure": (
        "Permanently skipped in every environment by an explicit pytest skip decorator for the "
        "same flaky httpx.ReadTimeout pattern; it is not a DSN gate and the lane does not "
        "change it."
    ),
    "test_compute_jobs_fencing.py::test_late_mark_done_after_w2_completed_raises_serialization_failure": (
        "Permanently skipped in every environment by an explicit pytest skip decorator for the "
        "same flaky httpx.ReadTimeout pattern; it is not a DSN gate and the lane does not "
        "change it."
    ),
}
_ROSTER_SIZE_FLOOR = 9


def _test_function_names(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def test_every_roster_entry_names_a_test_that_still_exists() -> None:
    """A renamed or deleted test must not leave a stale entry that keeps vouching for it."""
    stale = []
    for key in CANNOT_RUN_ON_LANE:
        module, _, func = key.partition("::")
        path = _TESTS_DIR / module
        if not path.is_file() or func not in _test_function_names(path):
            stale.append(key)
    assert not stale, f"CANNOT_RUN_ON_LANE entries whose test no longer exists: {stale}"


def test_every_roster_reason_says_why() -> None:
    short = [k for k, reason in CANNOT_RUN_ON_LANE.items() if len(reason) < 40]
    assert not short, f"roster reasons under 40 characters (say WHY it cannot run): {short}"


def test_roster_size_is_floored() -> None:
    """Dropping an entry must be a deliberate edit of this number, never a quiet deletion."""
    assert len(CANNOT_RUN_ON_LANE) >= _ROSTER_SIZE_FLOOR == 9


# --------------------------------------------------------------------------------------
# No test module reads the shared-TEST DSN variable.
# --------------------------------------------------------------------------------------
def _is_environ(node: ast.AST) -> bool:
    """``os.environ`` or a bare ``environ``."""
    return (isinstance(node, ast.Attribute) and node.attr == "environ") or (
        isinstance(node, ast.Name) and node.id == "environ"
    )


def _names_the_variable(node: ast.AST) -> bool:
    """The argument is the variable's literal name or the helper's constant."""
    if isinstance(node, ast.Constant):
        return node.value == SHARED_TEST_DSN_VAR
    if isinstance(node, ast.Name):
        return node.id == "SHARED_TEST_DSN_VAR"
    if isinstance(node, ast.Attribute):
        return node.attr == "SHARED_TEST_DSN_VAR"
    return False


def environment_reads_of_shared_test_dsn(source: str) -> list[int]:
    """Line numbers of environment READS of the shared-TEST DSN variable in ``source``:
    ``os.environ[X]``, ``os.environ.get(X)``, ``os.getenv(X)`` and ``X in os.environ``. Docstrings,
    comments, tuples of names, ``monkeypatch.setenv`` and ``delenv`` calls are not reads."""
    lines: list[int] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Subscript) and _is_environ(node.value):
            if _names_the_variable(node.slice):
                lines.append(node.lineno)
        elif isinstance(node, ast.Call) and node.args and _names_the_variable(node.args[0]):
            func = node.func
            if isinstance(func, ast.Attribute) and (
                (func.attr == "get" and _is_environ(func.value)) or func.attr == "getenv"
            ):
                lines.append(node.lineno)
            elif isinstance(func, ast.Name) and func.id == "getenv":
                lines.append(node.lineno)
        elif isinstance(node, ast.Compare) and _names_the_variable(node.left):
            if any(isinstance(op, (ast.In, ast.NotIn)) for op in node.ops) and any(
                _is_environ(c) for c in node.comparators
            ):
                lines.append(node.lineno)
    return sorted(lines)


@pytest.mark.parametrize(
    "snippet",
    [
        'import os\nx = os.environ["TEST_SUPABASE_DB_URL"]\n',
        'import os\nx = os.environ.get("TEST_SUPABASE_DB_URL")\n',
        'import os\nx = os.getenv("TEST_SUPABASE_DB_URL", "")\n',
        'import os\nok = "TEST_SUPABASE_DB_URL" in os.environ\n',
        "import os\nx = os.environ.get(SHARED_TEST_DSN_VAR)\n",
        "import os\nfrom tests import live_db_dsn\nx = os.getenv(live_db_dsn.SHARED_TEST_DSN_VAR)\n",
        'from os import environ\nx = environ["TEST_SUPABASE_DB_URL"]\n',
    ],
)
def test_scanner_flags_every_read_shape(snippet: str) -> None:
    """The scan can fail: each way of reading the variable is caught."""
    assert environment_reads_of_shared_test_dsn(snippet), snippet


@pytest.mark.parametrize(
    "snippet",
    [
        '"""Mentions TEST_SUPABASE_DB_URL in a docstring."""\n',
        '# TEST_SUPABASE_DB_URL in a comment\nSENTINELS = ("TEST_SUPABASE_DB_URL", "HAS_LIVE_DB")\n',
        'def t(monkeypatch):\n    monkeypatch.setenv("TEST_SUPABASE_DB_URL", "x")\n    monkeypatch.delenv("TEST_SUPABASE_DB_URL")\n',
        'import os\nx = os.getenv("LANE_DB_URL")\ny = os.environ["CI"]\n',
    ],
)
def test_scanner_ignores_mentions_that_are_not_reads(snippet: str) -> None:
    assert environment_reads_of_shared_test_dsn(snippet) == [], snippet


def test_no_test_module_reads_the_shared_test_dsn() -> None:
    """No allowlist, ``live_db_dsn.py`` included: the lane is the only database these writing
    modules may reach, and a direct read is how a local run would end up writing to shared TEST."""
    offenders: dict[str, list[int]] = {}
    scanned = 0
    for path in sorted(_TESTS_DIR.rglob("*.py")):
        scanned += 1
        lines = environment_reads_of_shared_test_dsn(path.read_text(encoding="utf-8"))
        if lines:
            offenders[path.relative_to(_TESTS_DIR).as_posix()] = lines
    assert scanned > 100, f"scan saw only {scanned} files; the glob is broken"
    assert not offenders, (
        f"environment reads of {SHARED_TEST_DSN_VAR} (resolve through tests/live_db_dsn.py "
        f"instead): {offenders}"
    )


# --------------------------------------------------------------------------------------
# Every environment-gated skip under tests/ is accounted for (Phase 215 SF-M3).
# --------------------------------------------------------------------------------------
# "<module file relative to tests/>::<enclosing function, or <module>>" -> why this env-gated
# skip site is acceptable. A site whose module has a CANNOT_RUN_ON_LANE entry at module scope
# (a pytestmark gate) or whose exact "<module>::<function>" is in that roster is already
# accounted for there and is not repeated here. Measured 2026-11-16 at HEAD; reasons say what
# the gate reads and where it resolves in CI, so a new gate must be classified by a reviewer.
_LANE_RESOLVER = (
    "Resolves LANE_DB_URL/LANE_* from the environment: skips in local dev and FAILS under CI=true, "
    "and the python job's Lane handoff exports it, so the case runs on the lane."
)
_LANE_SUPABASE_FAIL_IN_CI = (
    "Gates on SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY: skips in local dev and FAILS under "
    "CI=true; the python job's Lane handoff exports both, so the cases run on the lane."
)
_LANE_SUPABASE_SKIP_ONLY = (
    "Gates on SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY and only skips when they are unset "
    "(no CI hard-fail); the python job's Lane handoff exports both, so the cases run on the lane."
)
_LANE_SUPABASE_PROFILE_FAILS = (
    "Gates on SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY and only skips when they are unset "
    "(no CI hard-fail). The python job's Lane handoff exports both, and the lane carries the "
    "Phase 19 sentinel profile (migration reference data), so the cases run; a lane with no "
    "profile fails in _seed_user_id and never skips."
)
ENV_GATED_SKIP_ALLOWLIST: dict[str, str] = {
    "live_db_dsn.py::resolve_live_db_dsn": _LANE_RESOLVER,
    "live_db_dsn.py::resolve_lane_postgrest": _LANE_RESOLVER,
    "test_compute_job_metadata_merge_live.py::_dsn": _LANE_RESOLVER,
    "test_compute_job_metadata_merge_live.py::_need_supabase": _LANE_SUPABASE_FAIL_IN_CI,
    "test_computed_at_now_literal_live.py::_need_supabase": _LANE_SUPABASE_FAIL_IN_CI,
    "test_flow_price_store_live.py::_need_supabase": _LANE_SUPABASE_FAIL_IN_CI,
    "test_nav_marks_writer_live.py::_need_supabase": _LANE_SUPABASE_FAIL_IN_CI,
    "test_sync_trades_enqueue_failure_bridge_live.py::_need_supabase": _LANE_SUPABASE_FAIL_IN_CI,
    "test_trade_read_store_live.py::_need_supabase": _LANE_SUPABASE_FAIL_IN_CI,
    "test_compute_jobs_fencing.py::_need_supabase": (
        "Gates on SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY: skips in local dev and FAILS "
        "under CI=true once supabase-py imports; the Lane handoff exports both, so it runs."
    ),
    "test_compute_similarity_sql.py::_need_supabase": _LANE_SUPABASE_SKIP_ONLY,
    "test_drain_semantics.py::_need_supabase": _LANE_SUPABASE_PROFILE_FAILS,
    "test_transition_rpc.py::_need_supabase": _LANE_SUPABASE_PROFILE_FAILS,
    "test_feedback_engine.py::test_golden_snapshot": (
        "Skips only after a REGENERATE_GOLDEN=1 run rewrote the golden fixtures, so the human "
        "re-runs without it to assert; the python job never sets it and the assertions run."
    ),
    "test_match_engine.py::test_v1_to_v2_golden_snapshot": (
        "Skips only when REGENERATE_GOLDEN is set, after rewriting the golden fixture; the python "
        "job never sets it, so the snapshot assertion runs in CI."
    ),
    "test_feedback_engine.py::test_migration_063_enqueues_only_transitioned_allocators": (
        "Skips only when HAS_LIVE_DB is set (live variant not written); the python job never "
        "exports HAS_LIVE_DB, so the mocked structural counterpart runs in CI."
    ),
    "test_job_worker.py::test_worker_fence_v2_ships_on_by_default": (
        "Skips only when WORKER_FENCE_V2=false is exported (an operator kill-switch env); the "
        "python job leaves it unset, so the shipped-default assertion runs in CI."
    ),
}
# Measured: 21 env-gated skip sites at HEAD (3 covered by the roster, 2 more added to it, 16 here).
_ENV_GATED_SITE_FLOOR = 21


def _reads_environment(node: ast.AST) -> bool:
    """Any ``os.environ`` / ``environ`` / ``os.getenv`` / ``getenv`` anywhere under ``node``."""
    return any(
        _is_environ(n)
        or (isinstance(n, ast.Attribute) and n.attr == "getenv")
        or (isinstance(n, ast.Name) and n.id == "getenv")
        for n in ast.walk(node)
    )


def _is_skip_call(node: ast.Call) -> bool:
    """``pytest.skip(...)``, ``pytest.mark.skip(...)``, ``pytest.mark.skipif(...)`` or a bare
    ``skip`` / ``skipif``. ``pytest.importorskip`` is a different name and is not matched."""
    func = node.func
    return (isinstance(func, ast.Attribute) and func.attr in ("skip", "skipif")) or (
        isinstance(func, ast.Name) and func.id in ("skip", "skipif")
    )


def env_gated_skip_scopes(source: str) -> set[str]:
    """Enclosing scope (function name or ``<module>``) of every skip call that is gated on the
    environment: the call itself reads it (condition or message), it sits under an ``if`` whose
    test reads it, or it reads a name assigned from an environment read in the same module."""
    tree = ast.parse(source)
    tainted: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None:
            if _reads_environment(node.value):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                tainted |= {t.id for t in targets if isinstance(t, ast.Name)}

    def gated(expr: ast.AST) -> bool:
        return _reads_environment(expr) or any(
            isinstance(n, ast.Name) and n.id in tainted for n in ast.walk(expr)
        )

    scopes: set[str] = set()

    def walk(node: ast.AST, scope: str, tests: list[ast.AST]) -> None:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            scope, tests = node.name, []
        elif isinstance(node, ast.If):
            tests = tests + [node.test]
        if isinstance(node, ast.Call) and _is_skip_call(node):
            if gated(node) or any(gated(t) for t in tests):
                scopes.add(scope)
        for child in ast.iter_child_nodes(node):
            walk(child, scope, tests)

    walk(tree, "<module>", [])
    return scopes


@pytest.mark.parametrize(
    "snippet",
    [
        'import os, pytest\npytestmark = pytest.mark.skipif(not os.environ.get("K"), reason="r")\n',
        'import os, pytest\n@pytest.mark.skipif(os.getenv("K") is None, reason="r")\ndef test_a():\n    pass\n',
        'import pytest\n@pytest.mark.skipif("K" not in __import__("os").environ, reason="r")\ndef test_a():\n    pass\n',
        'import os, pytest\ndef test_a():\n    if not os.getenv("K"):\n        pytest.skip("unset")\n',
        'import os, pytest\nK = os.environ["K"]\ndef test_a():\n    if not K:\n        pytest.skip("unset")\n',
        'import os, pytest\ndef test_a():\n    pytest.skip(os.environ["WHY"])\n',
    ],
)
def test_env_gated_skip_scan_fires_on_every_shape(snippet: str) -> None:
    """The scan can fail: each env-gated skip form is found."""
    assert env_gated_skip_scopes(snippet), snippet


@pytest.mark.parametrize(
    "snippet",
    [
        'import pytest\n@pytest.mark.skip(reason="flaky")\ndef test_a():\n    pass\n',
        'import os, pytest\ndef test_a():\n    pytest.importorskip("psycopg2")\n    os.environ["X"] = "1"\n',
        'import pytest\ndef test_a(x):\n    if x is None:\n        pytest.skip("no x")\n',
        'import os\nK = os.environ.get("K")\ndef test_a():\n    assert K\n',
    ],
)
def test_env_gated_skip_scan_ignores_everything_else(snippet: str) -> None:
    assert env_gated_skip_scopes(snippet) == set(), snippet


def test_every_env_gated_skip_under_tests_is_accounted_for() -> None:
    """A new module with its own env-gated skip must be listed (CANNOT_RUN_ON_LANE or the
    allowlist above) with a reason, so a live-DB case that runs nowhere is never silent."""
    roster_exact = set(CANNOT_RUN_ON_LANE)
    roster_modules = {k.partition("::")[0] for k in CANNOT_RUN_ON_LANE}
    hits: set[str] = set()
    scanned = 0
    for path in sorted(_TESTS_DIR.rglob("*.py")):
        scanned += 1
        rel = path.relative_to(_TESTS_DIR).as_posix()
        hits |= {
            f"{rel}::{scope}" for scope in env_gated_skip_scopes(path.read_text(encoding="utf-8"))
        }
    assert scanned > 100, f"scan saw only {scanned} files; the glob is broken"

    def in_roster(key: str) -> bool:
        module, _, scope = key.partition("::")
        return key in roster_exact or (scope == "<module>" and module in roster_modules)

    assert len(hits) >= _ENV_GATED_SITE_FLOOR, (
        f"scan found {len(hits)} env-gated skip sites, floor is {_ENV_GATED_SITE_FLOOR}; "
        f"the scan or a gate was lost"
    )
    unaccounted = sorted(h for h in hits if not in_roster(h) and h not in ENV_GATED_SKIP_ALLOWLIST)
    assert not unaccounted, (
        f"env-gated skip sites in neither CANNOT_RUN_ON_LANE nor ENV_GATED_SKIP_ALLOWLIST "
        f"(classify each with a reason of at least 40 characters): {unaccounted}"
    )
    stale = sorted(k for k in ENV_GATED_SKIP_ALLOWLIST if k not in hits)
    assert not stale, f"ENV_GATED_SKIP_ALLOWLIST entries whose skip site no longer exists: {stale}"


def test_every_allowlist_reason_says_why() -> None:
    short = [k for k, reason in ENV_GATED_SKIP_ALLOWLIST.items() if len(reason) < 40]
    assert not short, f"allowlist reasons under 40 characters: {short}"
