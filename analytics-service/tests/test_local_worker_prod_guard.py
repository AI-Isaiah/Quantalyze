"""The local-worker prod guard (incident 2026-08-20).

A locally-started ``uvicorn main:app`` claimed real PROD compute jobs within
seconds, because analytics-service/.env pointed at the prod Supabase project
and main.py's lifespan starts the worker loops. These tests pin the guard that
makes that impossible by accident:

  * off-platform + PROD SUPABASE_URL -> RuntimeError (fail loud, no loops)
  * on Railway -> allowed (that IS prod)
  * ALLOW_PROD_WORKER_OFF_PLATFORM=1 -> allowed (deliberate emergency escape)
  * TEST / other URL -> allowed (local dev's sanctioned target)

plus wiring assertions: a guard that exists but is never called from BOTH
worker entrypoints (merged lifespan in main.py, standalone main_worker.main)
protects nothing.
"""

import re
from pathlib import Path

import pytest

import main_worker
from main_worker import assert_worker_not_aimed_at_prod_off_platform

_PROD_URL = "https://khslejtfbuezsmvmtsdn.supabase.co"
_TEST_URL = "https://qmnijlgmdhviwzwfyzlc.supabase.co"

_SERVICE_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _clean_guard_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test states its OWN env; nothing leaks in from the dev shell."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.delenv("ALLOW_PROD_WORKER_OFF_PLATFORM", raising=False)


def test_prod_url_off_platform_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", _PROD_URL)
    with pytest.raises(RuntimeError, match="Refusing to start worker loops"):
        assert_worker_not_aimed_at_prod_off_platform()


def test_prod_url_on_railway_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", _PROD_URL)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    assert_worker_not_aimed_at_prod_off_platform()


def test_prod_url_with_explicit_override_is_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_URL", _PROD_URL)
    monkeypatch.setenv("ALLOW_PROD_WORKER_OFF_PLATFORM", "1")
    assert_worker_not_aimed_at_prod_off_platform()


def test_override_must_be_exactly_1(monkeypatch: pytest.MonkeyPatch) -> None:
    """'true'/'yes' do NOT disarm the guard — only the documented literal."""
    monkeypatch.setenv("SUPABASE_URL", _PROD_URL)
    monkeypatch.setenv("ALLOW_PROD_WORKER_OFF_PLATFORM", "true")
    with pytest.raises(RuntimeError, match="Refusing to start worker loops"):
        assert_worker_not_aimed_at_prod_off_platform()


def test_test_url_off_platform_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", _TEST_URL)
    assert_worker_not_aimed_at_prod_off_platform()


def test_unset_url_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    """No SUPABASE_URL -> not this guard's problem (services/db.py fails loud
    with its own RuntimeError when a client is actually requested)."""
    assert_worker_not_aimed_at_prod_off_platform()


# ---------------------------------------------------------------------------
# Wiring — the guard must be CALLED from both entrypoints, in live code.
# ---------------------------------------------------------------------------

def _live_code(path: Path) -> str:
    """Source with comment lines dropped, so commenting a call site out
    reddens these tests instead of still matching the substring."""
    src = path.read_text(encoding="utf-8")
    return "\n".join(
        line for line in src.splitlines() if not line.lstrip().startswith("#")
    )


def test_merged_lifespan_calls_the_guard() -> None:
    code = _live_code(_SERVICE_DIR / "main.py")
    lifespan = code.split("async def lifespan", 1)[1]
    # Harness guard: if the loop-start anchor ever disappears (loops extracted
    # to a helper, switched to bare gather), the split below would silently
    # degrade to "whole rest of file" and the ordering check would evaporate.
    assert "create_task" in lifespan, (
        "harness: lifespan no longer starts worker loops via create_task — "
        "update this test's ordering anchor."
    )
    before_loops = lifespan.split("create_task", 1)[0]
    assert "assert_worker_not_aimed_at_prod_off_platform()" in before_loops, (
        "main.py's lifespan no longer calls the prod guard before starting "
        "worker loops — a laptop `uvicorn main:app` aimed at PROD would claim "
        "real jobs again (2026-08-20 incident)."
    )


def test_standalone_main_calls_the_guard() -> None:
    code = _live_code(_SERVICE_DIR / "main_worker.py")
    main_body = code.split("async def main(", 1)[1]
    call_at = main_body.find("assert_worker_not_aimed_at_prod_off_platform()")
    assert call_at != -1, (
        "main_worker.main() no longer calls the prod guard — a standalone "
        "`python -m main_worker` aimed at PROD would claim real jobs."
    )
    # ORDERING, not just presence: the guard must run BEFORE the loops start.
    # A call placed after the gather would only be reached at shutdown — after
    # every loop has already claimed prod jobs — while a presence check stays
    # green. Mirrors test_secret_misconfig_signal.py's call-before-tasks pin.
    loops_at = main_body.find("dispatch_loop(")
    assert loops_at != -1, (
        "harness: main_worker.main() no longer starts dispatch_loop — update "
        "this test's ordering anchor."
    )
    assert call_at < loops_at, (
        "the prod guard is called AFTER the worker loops start — by then a "
        "PROD-aimed laptop has already claimed real jobs (2026-08-20 incident)."
    )


def test_env_load_prefers_qa_local() -> None:
    """Both entrypoints load .env.qa-local BEFORE .env, so the TEST project
    wins locally (load_dotenv never overrides already-set keys)."""
    for name in ("main.py", "main_worker.py"):
        code = _live_code(_SERVICE_DIR / name)
        m = re.search(
            r'load_dotenv\(Path\(__file__\)\.parent / "\.env\.qa-local"\)\s*\n'
            r"\s*load_dotenv\(\)",
            code,
        )
        assert m, (
            f"{name} no longer loads .env.qa-local before .env — local runs "
            "would fall back to whatever .env points at (PROD, historically)."
        )
