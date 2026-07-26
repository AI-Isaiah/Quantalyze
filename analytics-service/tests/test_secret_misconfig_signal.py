"""PYAPI-06 (C-11) — a missing or stale platform secret must leave a trail.

C-11's two directions, both silent before this plan:

* **Railway side.** `SERVICE_KEY` unset ⇒ EVERY guarded route refuses, while
  `/process-key` and `/internal/*` keep working because the middleware skips
  them. No log, no Sentry, `/health` green.
* **Vercel side.** A stale `ANALYTICS_SERVICE_KEY` ⇒ a 401 storm. 4xx, so
  140.2's breaker never trips, `/health` stays green, `warm-analytics` stays
  green. Indistinguishable from an attacker.

The signal is three parts, all tested here:

1. a **startup** assertion — loud, once per missing secret, and deliberately
   NOT `sys.exit` (a hard exit on Railway is a crash-loop, which converts a
   config warning into an outage);
2. **request-time** captures, RATE-LIMITED (a stale key fires on every request,
   so an unthrottled capture is its own outage — T-140.1-23), with **distinct**
   tags for *unset* (deploy/config fault) vs *mismatched* (rotation drift or an
   attack) — conflating them is what makes a rotation look like an attack;
3. a **`/health` config-integrity term** that never changes the HTTP status —
   a red `/health` triggers Railway's restart loop (T-140.1-24), and S-24's
   stale-heartbeat 503 must stay byte-identical.

And the constraint that outranks all three: **no log, tag or capture may
contain the secret, or any substring of it.** Naming the env var is the whole
point; naming its value would turn the operator signal into the leak.

Oracle discipline (programme non-negotiable #3): every expected count, tag,
status and key below is a **LITERAL**.
"""

from __future__ import annotations

import ast
import inspect
from contextlib import contextmanager
from typing import Any, Iterator

import httpx
import pytest

# Distinctive, wordless secrets. The no-substring oracle scans for EVERY
# contiguous run of >= 6 characters, so the values must share no 6-gram with
# any plausible log line ("platform secret", "SERVICE_KEY", "mismatched", ...).
_SERVICE_KEY_CANARY = "Zx9Qv7Wm2Kd4Rb8Tn5Hj3Lp6Fs1Gy0"
_INTERNAL_TOKEN_CANARY = "Vc4Nz8Jr1Bq6Dw3Xk9Ty5Ml7Ps2Hg0"

# What a stale caller presents. Also must never be echoed — it is
# caller-controlled and on a rotation it is the PREVIOUS real secret.
_WRONG_SERVICE_KEY = "Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0"
_WRONG_BEARER = "Kk1Ll2Mm3Nn4Oo5Pp6Qq7Rr8Ss9Tt0"

# A guarded path that reaches the middleware and never routes anywhere — the
# middleware runs BEFORE routing, so the refusal is produced without touching
# any endpoint, limiter bucket or dependency.
_GUARDED_PATH = "/api/__pyapi06_probe__"

_MIN_SUBSTRING = 6


class _FakeScope:
    def __init__(self) -> None:
        self.tags: dict[str, str] = {}

    def set_tag(self, key: str, value: str) -> None:
        self.tags[key] = value


class _FakeSentry:
    """Records `new_scope()` + `set_tag` + `capture_message` verbatim."""

    def __init__(self) -> None:
        self.captures: list[dict[str, Any]] = []
        self._current: _FakeScope = _FakeScope()

    @contextmanager
    def new_scope(self) -> Iterator[_FakeScope]:
        scope = _FakeScope()
        self._current = scope
        yield scope

    def capture_message(self, message: str, level: str | None = None) -> None:
        self.captures.append(
            {"message": message, "level": level, "tags": dict(self._current.tags)}
        )

    # Anything the real SDK exposes that our code does not call must NOT be
    # silently invented — an AttributeError here is a genuine test failure.

    def serialised(self) -> str:
        return "\n".join(
            f"{c['message']} | {c['level']} | {sorted(c['tags'].items())}"
            for c in self.captures
        )


@pytest.fixture
def sentry_spy(monkeypatch: pytest.MonkeyPatch) -> Iterator[_FakeSentry]:
    import main

    spy = _FakeSentry()
    monkeypatch.setattr(main, "sentry_sdk", spy)
    # The capture throttle is a module-global dict; clear it both ways so
    # neighbouring tests neither prime nor inherit it.
    main._secret_capture_last_at.clear()
    yield spy
    main._secret_capture_last_at.clear()


def _client(**kwargs: Any) -> httpx.AsyncClient:
    import main

    transport = httpx.ASGITransport(app=main.app, **kwargs)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _substrings(secret: str, n: int = _MIN_SUBSTRING) -> list[str]:
    return [secret[i : i + n] for i in range(len(secret) - n + 1)]


def _assert_no_secret_material(haystack: str, *secrets: str) -> None:
    for secret in secrets:
        assert secret not in haystack, f"the FULL secret leaked into: {haystack}"
        for frag in _substrings(secret):
            assert frag not in haystack, (
                f"a {_MIN_SUBSTRING}-character substring {frag!r} of a platform "
                f"secret leaked into: {haystack}"
            )


# ---------------------------------------------------------------------------
# Startup assertion
# ---------------------------------------------------------------------------


def test_startup_captures_exactly_one_error_per_missing_secret(
    monkeypatch: pytest.MonkeyPatch, sentry_spy: _FakeSentry
) -> None:
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", None)
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)

    degraded = main.assert_platform_secrets_configured()

    assert degraded == ["SERVICE_KEY", "INTERNAL_API_TOKEN"]
    assert len(sentry_spy.captures) == 2, (
        f"one capture per missing secret, got {sentry_spy.captures}"
    )
    assert [c["level"] for c in sentry_spy.captures] == ["error", "error"]
    assert [c["tags"]["config_secret"] for c in sentry_spy.captures] == [
        "SERVICE_KEY",
        "INTERNAL_API_TOKEN",
    ]
    assert [c["tags"]["config_fault"] for c in sentry_spy.captures] == [
        "unset",
        "unset",
    ]


def test_startup_is_silent_when_both_secrets_are_configured(
    monkeypatch: pytest.MonkeyPatch, sentry_spy: _FakeSentry
) -> None:
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)
    monkeypatch.setenv("INTERNAL_API_TOKEN", _INTERNAL_TOKEN_CANARY)

    assert main.assert_platform_secrets_configured() == []
    assert sentry_spy.captures == []


def test_startup_reports_only_the_secret_that_is_actually_missing(
    monkeypatch: pytest.MonkeyPatch, sentry_spy: _FakeSentry
) -> None:
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)

    assert main.assert_platform_secrets_configured() == ["INTERNAL_API_TOKEN"]
    assert len(sentry_spy.captures) == 1
    assert sentry_spy.captures[0]["tags"]["config_secret"] == "INTERNAL_API_TOKEN"


def test_startup_assertion_never_exits_the_process(
    monkeypatch: pytest.MonkeyPatch, sentry_spy: _FakeSentry
) -> None:
    """Warning 5 / T-140.1-24: a hard exit on Railway is a crash-loop, which
    converts a config warning into a total outage. The assertion is LOUD, not
    fatal — it must return normally with BOTH secrets missing.
    """
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", None)
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)

    result = main.assert_platform_secrets_configured()  # must not raise/exit

    assert result == ["SERVICE_KEY", "INTERNAL_API_TOKEN"]


def test_lifespan_calls_the_startup_assertion_before_starting_the_worker() -> None:
    """The WIRING, not the helper. A helper that nothing calls is not a signal.

    Also pins the ORDER: the secret check must run before the worker tasks are
    created, so the operator sees the config fault even if a loop crashes on
    the way up.
    """
    import main

    tree = ast.parse(inspect.getsource(main))
    lifespan = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "lifespan"
    )
    call_lines = [
        node.lineno
        for node in ast.walk(lifespan)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "assert_platform_secrets_configured"
    ]
    assert len(call_lines) == 1, (
        "main.lifespan must call assert_platform_secrets_configured() exactly once"
    )

    task_lines = [
        node.lineno
        for node in ast.walk(lifespan)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "create_task"
    ]
    assert task_lines, "harness: lifespan should still create worker tasks"
    assert call_lines[0] < min(task_lines), (
        "the secret check must run BEFORE the worker loops start"
    )


# ---------------------------------------------------------------------------
# Request-time captures — bounded, and distinctly tagged
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_request_storm_on_unset_service_key_is_capture_bounded(
    monkeypatch: pytest.MonkeyPatch, sentry_spy: _FakeSentry
) -> None:
    """T-140.1-23: a stale key fires on EVERY request. 25 requests, ONE capture.

    The responses are pinned too: S-23 must still be a 500
    `SERVICE_KEY_UNCONFIGURED` on every one of them — the signal is additive,
    it does not change the refusal.
    """
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", None)

    async with _client() as client:
        for _ in range(25):
            resp = await client.post(_GUARDED_PATH, json={})
            assert resp.status_code == 500
            assert resp.json()["detail"]["code"] == "SERVICE_KEY_UNCONFIGURED"

    assert len(sentry_spy.captures) == 1, (
        "an unthrottled capture on a stale key is its own outage. Got "
        f"{len(sentry_spy.captures)} captures."
    )
    assert sentry_spy.captures[0]["tags"] == {
        "config_fault": "unset",
        "config_secret": "SERVICE_KEY",
    }


@pytest.mark.asyncio
async def test_unset_and_mismatched_carry_distinct_tags(
    monkeypatch: pytest.MonkeyPatch, sentry_spy: _FakeSentry
) -> None:
    """A rotation must not look like an attack, and vice versa."""
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", None)
    async with _client() as client:
        await client.post(_GUARDED_PATH, json={})

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)
    async with _client() as client:
        resp = await client.post(
            _GUARDED_PATH, json={}, headers={"X-Service-Key": _WRONG_SERVICE_KEY}
        )
    assert resp.status_code == 401

    faults = [c["tags"]["config_fault"] for c in sentry_spy.captures]
    assert faults == ["unset", "mismatched"], (
        f"absent and mismatched must be distinguishable. Got {sentry_spy.captures}"
    )


@pytest.mark.asyncio
async def test_a_caller_that_sends_no_key_at_all_produces_no_capture(
    monkeypatch: pytest.MonkeyPatch, sentry_spy: _FakeSentry
) -> None:
    """An absent header is an unauthenticated prober, not a config fault.

    Capturing it would make the operator signal fire on internet background
    noise — the signal has to mean something.
    """
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)

    async with _client() as client:
        resp = await client.post(_GUARDED_PATH, json={})

    assert resp.status_code == 401
    assert resp.json() == {"detail": "Unauthorized"}
    assert sentry_spy.captures == []


@pytest.mark.asyncio
async def test_process_key_unset_and_mismatched_token_are_captured_distinctly(
    monkeypatch: pytest.MonkeyPatch, sentry_spy: _FakeSentry
) -> None:
    """The `/process-key` gate is the other half of C-11 (sites 2 and 3)."""
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)

    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    async with _client() as client:
        unset = await client.post("/process-key", json={})
    assert unset.status_code == 500
    assert unset.json()["detail"]["code"] == "INTERNAL_TOKEN_UNCONFIGURED"

    monkeypatch.setenv("INTERNAL_API_TOKEN", _INTERNAL_TOKEN_CANARY)
    async with _client() as client:
        bad = await client.post(
            "/process-key",
            json={},
            headers={"Authorization": f"Bearer {_WRONG_BEARER}"},
        )
    assert bad.status_code == 401
    assert bad.json()["detail"]["code"] == "UNAUTHENTICATED"

    assert [
        (c["tags"]["config_fault"], c["tags"]["config_secret"])
        for c in sentry_spy.captures
    ] == [
        ("unset", "INTERNAL_API_TOKEN"),
        ("mismatched", "INTERNAL_API_TOKEN"),
    ]


# ---------------------------------------------------------------------------
# The constraint that outranks the signal — no secret material, anywhere
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_capture_or_log_contains_any_substring_of_any_secret(
    monkeypatch: pytest.MonkeyPatch,
    sentry_spy: _FakeSentry,
    capsys: pytest.CaptureFixture[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """T-140.1-22. Every 6-gram of every secret, and of the WRONG value the
    caller presented, must be absent from the captures, the structlog stream
    (stdout) and the stdlib log stream.

    The caller-presented value matters as much as ours: on a rotation it IS the
    previous real secret, and it is the value a naive "log what they sent"
    debug line would print.
    """
    import main

    caplog.set_level(0)

    monkeypatch.setattr(main, "SERVICE_KEY", None)
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    main.assert_platform_secrets_configured()

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)
    monkeypatch.setenv("INTERNAL_API_TOKEN", _INTERNAL_TOKEN_CANARY)
    main._secret_capture_last_at.clear()

    async with _client() as client:
        await client.post(
            _GUARDED_PATH, json={}, headers={"X-Service-Key": _WRONG_SERVICE_KEY}
        )
        await client.post(
            "/process-key",
            json={},
            headers={"Authorization": f"Bearer {_WRONG_BEARER}"},
        )

    assert sentry_spy.captures, "harness: the run must have produced captures"

    streams = capsys.readouterr()
    haystack = "\n".join(
        [sentry_spy.serialised(), streams.out, streams.err, caplog.text]
    )
    _assert_no_secret_material(
        haystack,
        _SERVICE_KEY_CANARY,
        _INTERNAL_TOKEN_CANARY,
        _WRONG_SERVICE_KEY,
        _WRONG_BEARER,
    )


def test_the_capture_message_names_the_env_var_and_nothing_else(
    monkeypatch: pytest.MonkeyPatch, sentry_spy: _FakeSentry
) -> None:
    """Positive control for the test above: a capture that said nothing at all
    would also pass a pure absence check. The message must NAME the secret.
    """
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", None)
    monkeypatch.setenv("INTERNAL_API_TOKEN", _INTERNAL_TOKEN_CANARY)

    main.assert_platform_secrets_configured()

    assert len(sentry_spy.captures) == 1
    assert "SERVICE_KEY" in sentry_spy.captures[0]["message"]


# ---------------------------------------------------------------------------
# /health — a config term that never changes the status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health_reports_a_degraded_secret_and_stays_200(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """C-11's headline: `/health` green while every guarded route 500s.

    The term is added; the STATUS is not. A red `/health` triggers Railway's
    healthcheck restart loop (T-140.1-24), turning a config warning into an
    outage.
    """
    import time as _time

    import main

    monkeypatch.setattr(main, "SERVICE_KEY", None)
    monkeypatch.setenv("INTERNAL_API_TOKEN", _INTERNAL_TOKEN_CANARY)
    monkeypatch.setattr(main, "WORKER_LAST_TICK_AT", _time.time())

    async with _client() as client:
        resp = await client.get("/health")

    assert resp.status_code == 200, (
        "a config-only degradation must NOT make /health red — Railway restarts "
        "the pod on a red healthcheck"
    )
    body = resp.json()
    assert body["status"] == "ok"
    assert body["config_ok"] is False
    assert body["config_degraded_secrets"] == ["SERVICE_KEY"]


@pytest.mark.asyncio
async def test_health_config_ok_is_true_when_both_secrets_are_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import time as _time

    import main

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)
    monkeypatch.setenv("INTERNAL_API_TOKEN", _INTERNAL_TOKEN_CANARY)
    monkeypatch.setattr(main, "WORKER_LAST_TICK_AT", _time.time())

    async with _client() as client:
        resp = await client.get("/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["config_ok"] is True
    assert body["config_degraded_secrets"] == []


@pytest.mark.asyncio
async def test_health_does_not_echo_the_secret_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`/health` is UNAUTHENTICATED (the middleware skips it), so it is the one
    place where echoing a secret would be a straight public disclosure.
    """
    import time as _time

    import main

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)
    monkeypatch.setenv("INTERNAL_API_TOKEN", _INTERNAL_TOKEN_CANARY)
    monkeypatch.setattr(main, "WORKER_LAST_TICK_AT", _time.time())

    async with _client() as client:
        resp = await client.get("/health")

    _assert_no_secret_material(
        resp.text, _SERVICE_KEY_CANARY, _INTERNAL_TOKEN_CANARY
    )


@pytest.mark.asyncio
async def test_s24_stale_health_arm_is_byte_identical(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """S-24 restated inside this file, because THIS plan changes the payload.

    `tests/test_status_contract_match_sim_portfolio.py` already pins it; a
    payload change is exactly the edit that would break it, so the pin is
    repeated where the change lives.
    """
    import time as _time

    import main

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)
    monkeypatch.setattr(main, "_PROCESS_START_AT", _time.time() - 10_000)
    monkeypatch.setattr(main, "WORKER_LAST_TICK_AT", _time.time() - 10_000)

    async with _client() as client:
        resp = await client.get("/health")

    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "stale"
    assert "detail" not in body
    assert "retryable" not in body


@pytest.mark.asyncio
async def test_a_degraded_secret_does_not_turn_a_healthy_pod_stale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The two terms are independent: `status` is the worker heartbeat,
    `config_ok` is the secret set. Crossing them is how T-140.1-24 happens.
    """
    import time as _time

    import main

    monkeypatch.setattr(main, "SERVICE_KEY", None)
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    monkeypatch.setattr(main, "WORKER_LAST_TICK_AT", _time.time())

    async with _client() as client:
        resp = await client.get("/health")

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["config_degraded_secrets"] == [
        "SERVICE_KEY",
        "INTERNAL_API_TOKEN",
    ]


def test_the_required_secret_list_is_a_literal() -> None:
    """Enumerate by behaviour, state the count (programme standing lesson).

    Two platform secrets gate the seam: `SERVICE_KEY` (every route except
    /health, /internal/*, /process-key) and `INTERNAL_API_TOKEN`
    (/process-key). KEK is deliberately NOT in this list — it already has its
    own startup validation (`services.encryption.validate_kek_on_startup`, run
    from the same lifespan) and a request-time capture from plan 03; adding a
    second, weaker probe here would just create two sources of truth.
    """
    import main

    assert main.REQUIRED_PLATFORM_SECRETS == ("SERVICE_KEY", "INTERNAL_API_TOKEN")
