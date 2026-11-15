"""Phase 215 SC-3 — a factory test app answers with PRODUCTION's app-global handlers.

A bare ``FastAPI()`` test app never sees the 422 handler (credential-safe body) or
the 429 handler (``RATE_LIMITED`` + ``Retry-After``) that ``main.py`` installs, so a
router test on it asserts against a body production never sends. ``tests/app_factory.py``
installs the three production handlers through ``install_app_exception_handlers``;
this module is the guard that the installer actually reaches a factory app.

Oracle discipline: every expected status, code and string is a LITERAL. The only
thing read from production is the handler OBJECTS in test (a), which is exactly
what "the same handlers" means.

``main`` is imported inside test (a) only. An early ``import main`` changes router
module identity for the whole process, which is why the factory never imports it.
"""

from __future__ import annotations

import ast
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest
from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from services.error_contract import VenueTransientHTTPException
from tests.app_factory import build_test_app

# Where the regrowth scans look. A module constant, so a RED proof can point it at
# an empty directory and watch the vacuity floor bite.
TESTS_DIR = Path(__file__).resolve().parent

# Files allowed to construct ``FastAPI(`` besides ``app_factory.py`` itself, and files
# allowed to import slowapi's default 429 handler. BOTH are empty on purpose: adding a
# name here is a deviation from the Phase 215 SC-3 decision ("any module that must stay
# bare is a deviation recorded in SUMMARY and surfaced, not silently exempted"), so it
# needs a recorded deviation, never a quiet edit.
FASTAPI_CONSTRUCTION_ALLOWLIST: tuple[str, ...] = ()
DEFAULT_429_HANDLER_ALLOWLIST: tuple[str, ...] = ()

# Vacuity floors, hand-typed. 458 test files parsed at authoring (2026-11-15); the floor
# sits a little under so a handful of deletions does not red it, while a scan pointed at
# the wrong directory (0 files) does.
MIN_TEST_FILES_PARSED = 450
_SLOWAPI_DEFAULT_429 = "_rate_limit_exceeded_handler"

# Secret-SHAPED and unmistakable, so a count over body + headers is unambiguous.
_CANARY = "CANARY_SECRET_215_03_f00d"


class _Body(BaseModel):
    count: int


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def test_factory_registers_the_same_handler_objects_main_registers() -> None:
    """(a) 422, 429 and venue-transient resolve to main.app's identical functions."""
    import main

    factory_app = build_test_app()
    for exc_type in (
        RequestValidationError,
        RateLimitExceeded,
        VenueTransientHTTPException,
    ):
        assert exc_type in factory_app.exception_handlers, (
            f"the factory app has no handler for {exc_type.__name__}"
        )
        assert (
            factory_app.exception_handlers[exc_type]
            is main.app.exception_handlers[exc_type]
        ), f"the factory app's {exc_type.__name__} handler is not production's"


@pytest.mark.asyncio
async def test_factory_app_answers_a_validation_failure_with_the_credential_safe_422() -> None:
    """(b) canary: a planted secret in a wrong-typed field appears zero times."""
    router = APIRouter()

    @router.post("/probe")
    async def probe(body: _Body) -> dict[str, int]:
        return {"count": body.count}

    app = build_test_app(router)
    async with _client(app) as client:
        resp = await client.post("/probe", json={"count": _CANARY})

    assert resp.status_code == 422
    assert resp.json()["code"] == "VALIDATION_FAILED"
    header_blob = "\n".join(f"{k}: {v}" for k, v in resp.headers.items())
    haystack = f"{resp.text}\n{header_blob}"
    assert haystack.count(_CANARY) == 0, (
        "the factory app's 422 echoed a caller-supplied value: FastAPI's default "
        f"handler is answering, not production's. Response:\n{haystack[:800]}"
    )


@pytest.mark.asyncio
async def test_factory_app_answers_a_slowapi_refusal_with_production_429() -> None:
    """(c) the second call to a 1/minute route is production's RATE_LIMITED body."""
    local_limiter = Limiter(key_func=get_remote_address)
    router = APIRouter()

    @router.get("/probe")
    @local_limiter.limit("1/minute")
    async def probe(request: Request) -> dict[str, bool]:
        return {"ok": True}

    app = build_test_app(router)
    app.state.limiter = local_limiter
    async with _client(app) as client:
        first = await client.get("/probe")
        second = await client.get("/probe")

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["code"] == "RATE_LIMITED"
    retry_after = second.headers["Retry-After"]
    assert retry_after.isdigit() and int(retry_after) > 0, retry_after


# ---------------------------------------------------------------------------
# Regrowth scans: no bare FastAPI(), no slowapi default 429 handler
# ---------------------------------------------------------------------------


def _fastapi_construction_count(tree: ast.AST) -> int:
    """Calls whose callee is the name ``FastAPI`` or an attribute ending ``.FastAPI``.

    Parsed with ``ast`` so a docstring, a comment or a type annotation that merely
    NAMES ``FastAPI`` cannot trip it, and a ``fastapi.FastAPI()`` spelling cannot hide.
    """
    count = 0
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if (isinstance(func, ast.Name) and func.id == "FastAPI") or (
            isinstance(func, ast.Attribute) and func.attr == "FastAPI"
        ):
            count += 1
    return count


def _default_429_handler_count(tree: ast.AST) -> int:
    """Imports, name uses and attribute uses of slowapi's default 429 handler."""
    count = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.alias) and node.name == _SLOWAPI_DEFAULT_429:
            count += 1
        elif isinstance(node, ast.Name) and node.id == _SLOWAPI_DEFAULT_429:
            count += 1
        elif isinstance(node, ast.Attribute) and node.attr == _SLOWAPI_DEFAULT_429:
            count += 1
    return count


def _scan_tests_dir(counter: Callable[[ast.AST], int]) -> tuple[int, dict[str, int]]:
    """(files parsed, {relative path: hits}) over every ``tests/**/*.py``."""
    parsed = 0
    hits: dict[str, int] = {}
    for path in sorted(TESTS_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        parsed += 1
        found = counter(tree)
        if found:
            hits[path.relative_to(TESTS_DIR).as_posix()] = found
    return parsed, hits


def test_scan_helpers_can_see_what_they_hunt() -> None:
    """The scans must be able to FIRE: each shape is a literal source string."""
    assert _fastapi_construction_count(ast.parse("wrap(FastAPI())")) == 1
    assert _fastapi_construction_count(ast.parse("wrap(fastapi.FastAPI(title='x'))")) == 1
    # Naming it is not constructing it.
    assert _fastapi_construction_count(ast.parse("def f(app: FastAPI) -> None: ...")) == 0
    assert _fastapi_construction_count(ast.parse('"""FastAPI()"""\n# wrap(FastAPI())')) == 0
    assert (
        _default_429_handler_count(
            ast.parse("from slowapi import _rate_limit_exceeded_handler")
        )
        == 1
    )
    assert (
        _default_429_handler_count(
            ast.parse("import slowapi\nslowapi._rate_limit_exceeded_handler")
        )
        == 1
    )
    assert _default_429_handler_count(ast.parse('"_rate_limit_exceeded_handler"')) == 0


def test_no_test_module_constructs_a_fastapi_app_except_the_factory() -> None:
    """SC-3 regrowth guard: the factory is the ONLY ``FastAPI(`` in tests/."""
    parsed, hits = _scan_tests_dir(_fastapi_construction_count)

    assert parsed >= MIN_TEST_FILES_PARSED, (
        f"vacuous scan: parsed {parsed} test files, floor is {MIN_TEST_FILES_PARSED}. "
        f"TESTS_DIR={TESTS_DIR}"
    )
    assert hits.get("app_factory.py") == 1, (
        "app_factory.py must hold exactly one FastAPI( construction; "
        f"found {hits.get('app_factory.py', 0)}"
    )
    offenders = sorted(
        name
        for name in hits
        if name != "app_factory.py" and name not in FASTAPI_CONSTRUCTION_ALLOWLIST
    )
    assert offenders == [], (
        "test modules construct a bare FastAPI app, which never sees production's "
        "422/429 handlers; build it with tests.app_factory.build_test_app instead: "
        f"{offenders}"
    )


def test_no_test_module_imports_slowapis_default_429_handler() -> None:
    """Production's 429 handler (installed by the factory) must not be overridden."""
    parsed, hits = _scan_tests_dir(_default_429_handler_count)

    assert parsed >= MIN_TEST_FILES_PARSED, (
        f"vacuous scan: parsed {parsed} test files, floor is {MIN_TEST_FILES_PARSED}. "
        f"TESTS_DIR={TESTS_DIR}"
    )
    offenders = sorted(name for name in hits if name not in DEFAULT_429_HANDLER_ALLOWLIST)
    assert offenders == [], (
        "test modules use slowapi's default 429 handler, which answers a body "
        "production never sends; rely on the factory's production handler: "
        f"{offenders}"
    )
