"""Phase 215 TESTREACH plan 02 - self-tests of ``tests/live_db_dsn.py``.

The resolver is what makes seven psycopg live-DB modules run on the CI python job's private lane,
and what stops them from skipping silently there. A resolver that cannot fail would reproduce the
defect it replaces, so each rule below has a case that goes RED if the rule is dropped. All cases
use ``monkeypatch`` environment edits only and need no database.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from tests import conftest
from tests.live_db_dsn import SHARED_TEST_DSN_VAR, resolve_lane_postgrest, resolve_live_db_dsn

_LANE_DSN = "postgresql://postgres:postgres@127.0.0.1:54422/postgres"
_NON_LOOPBACK_DSN = "postgresql://postgres@db.abcdefghijklmnop.supabase.co:5432/postgres"
# A dummy value: the helper must never connect to, or even read, the shared-TEST variable.
_SHARED_TEST_DUMMY = "postgresql://postgres@shared-test.invalid:5432/postgres"


def _outcome() -> str:
    """What ``resolve_live_db_dsn`` does, as a label. Catching both pytest outcomes matters: a
    resolver that skips where it must fail would otherwise propagate the Skipped exception and
    report THIS test as skipped, which is a silent pass in the very run that must go red."""
    try:
        resolve_live_db_dsn()
    except pytest.fail.Exception:
        return "fail"
    except pytest.skip.Exception:
        return "skip"
    return "dsn"


def _fail_message() -> str:
    try:
        resolve_live_db_dsn()
    except pytest.fail.Exception as exc:
        return str(exc)
    return ""


def _env(monkeypatch: pytest.MonkeyPatch, *, ci: bool, lane: str | None, shared: str | None) -> None:
    if ci:
        monkeypatch.setenv("CI", "true")
    else:
        monkeypatch.delenv("CI", raising=False)
    if lane is None:
        monkeypatch.delenv("LANE_DB_URL", raising=False)
    else:
        monkeypatch.setenv("LANE_DB_URL", lane)
    if shared is None:
        monkeypatch.delenv(SHARED_TEST_DSN_VAR, raising=False)
    else:
        monkeypatch.setenv(SHARED_TEST_DSN_VAR, shared)


def test_ci_without_a_lane_dsn_fails_and_never_skips(monkeypatch: pytest.MonkeyPatch) -> None:
    """(a) The defect this phase removes was a silent skip in CI. Under CI=true with no lane DSN
    the outcome must be a FAIL that names LANE_DB_URL, never a skip."""
    _env(monkeypatch, ci=True, lane=None, shared=None)
    assert _outcome() == "fail"
    assert "LANE_DB_URL" in _fail_message()


def test_local_run_without_the_lane_skips(monkeypatch: pytest.MonkeyPatch) -> None:
    """(b) A developer machine with no lane boots nothing and writes nothing: skip, not fail."""
    _env(monkeypatch, ci=False, lane=None, shared=None)
    assert _outcome() == "skip"


def test_local_run_never_falls_back_to_shared_test(monkeypatch: pytest.MonkeyPatch) -> None:
    """(c) Only the shared-TEST variable is set (a developer's exported secret): the helper still
    skips. A fallback would be a write path to shared TEST with no marker check."""
    _env(monkeypatch, ci=False, lane=None, shared=_SHARED_TEST_DUMMY)
    assert _outcome() == "skip"


def test_ci_never_falls_back_to_shared_test(monkeypatch: pytest.MonkeyPatch) -> None:
    """(f) Under CI=true the shared-TEST variable does not stand in for the lane DSN: still a FAIL."""
    _env(monkeypatch, ci=True, lane=None, shared=_SHARED_TEST_DUMMY)
    assert _outcome() == "fail"


@pytest.mark.parametrize("ci", [False, True])
def test_non_loopback_lane_dsn_is_refused(monkeypatch: pytest.MonkeyPatch, ci: bool) -> None:
    """(d) A LANE_DB_URL naming a hosted host fails before any connect, in CI and locally."""
    _env(monkeypatch, ci=ci, lane=_NON_LOOPBACK_DSN, shared=None)
    assert _outcome() == "fail"


@pytest.mark.parametrize("ci", [False, True])
def test_loopback_lane_dsn_is_returned_verbatim(monkeypatch: pytest.MonkeyPatch, ci: bool) -> None:
    """(e) The lane DSN is returned unchanged, and the shared-TEST variable, when also set, is
    ignored rather than preferred."""
    _env(monkeypatch, ci=ci, lane=_LANE_DSN, shared=_SHARED_TEST_DUMMY)
    assert resolve_live_db_dsn() == _LANE_DSN


# --------------------------------------------------------------------------------------
# resolve_lane_postgrest: the same rule for the persist module's runner cases.
# --------------------------------------------------------------------------------------
_LANE_URL = "http://127.0.0.1:54421"


def _postgrest_outcome() -> str:
    try:
        resolve_lane_postgrest()
    except pytest.fail.Exception:
        return "fail"
    except pytest.skip.Exception:
        return "skip"
    return "value"


def _postgrest_env(monkeypatch: pytest.MonkeyPatch, *, ci: bool, url: str | None, key: str | None) -> None:
    if ci:
        monkeypatch.setenv("CI", "true")
    else:
        monkeypatch.delenv("CI", raising=False)
    for name, value in (("SUPABASE_TEST_URL", url), ("SUPABASE_TEST_SERVICE_KEY", key)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)


@pytest.mark.parametrize("url,key", [(None, None), (_LANE_URL, None), (None, "k")])
def test_postgrest_missing_variables_fail_in_ci_and_skip_locally(
    monkeypatch: pytest.MonkeyPatch, url: str | None, key: str | None
) -> None:
    """A partial or empty lane PostgREST pair fails by name under CI=true and skips locally."""
    _postgrest_env(monkeypatch, ci=True, url=url, key=key)
    assert _postgrest_outcome() == "fail"
    _postgrest_env(monkeypatch, ci=False, url=url, key=key)
    assert _postgrest_outcome() == "skip"


def test_postgrest_non_loopback_url_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """The caller writes through this URL, so a hosted host fails even when both values are set."""
    _postgrest_env(monkeypatch, ci=False, url="https://abcdefghijklmnop.supabase.co", key="k")
    assert _postgrest_outcome() == "fail"


def test_postgrest_loopback_pair_is_returned_verbatim(monkeypatch: pytest.MonkeyPatch) -> None:
    _postgrest_env(monkeypatch, ci=True, url=_LANE_URL, key="service-key")
    assert resolve_lane_postgrest() == (_LANE_URL, "service-key")


# --------------------------------------------------------------------------------------
# xdist grouping: the migrated modules must stay in the `shared_test_db` group.
# --------------------------------------------------------------------------------------
_MIGRATED_MODULES = [
    "test_trigger_rls_audit.py",
    "test_csv_daily_returns_dualaxis_live.py",
    "test_csv_daily_returns_perkey_rls_live.py",
    "test_persist_csv_daily_returns_live.py",
    "test_resend_correlation_rls.py",
    "test_sync_trades_preserves_fills.py",
    "test_job_worker.py",
]


def test_live_db_dsn_is_a_shared_db_sentinel() -> None:
    """The seven migrated modules no longer contain the old DSN name, so the content sentinel is
    what keeps them in the `shared_test_db` xdist group. Without it they leave the group and race
    the fencing tests on the one lane database. The membership assertion is the oracle; the
    per-module check below is a supporting one (a module whose docstring still names the old
    variable would pass it without the sentinel)."""
    assert "live_db_dsn" in conftest._DB_MODULE_SENTINELS


def test_every_migrated_module_is_grouped_as_a_shared_db_module() -> None:
    assert len(_MIGRATED_MODULES) == 7
    tests_dir = Path(__file__).resolve().parent
    ungrouped = [
        name for name in _MIGRATED_MODULES if not conftest._is_shared_db_module(str(tests_dir / name))
    ]
    assert not ungrouped, f"migrated modules outside the shared_test_db group: {ungrouped}"
