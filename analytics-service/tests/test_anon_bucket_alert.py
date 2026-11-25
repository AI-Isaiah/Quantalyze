"""Phase 215 SC-7 (c) — saturation of the shared anonymous /process-key bucket alerts.

Every anonymous visitor of the public teaser shares ONE limiter bucket
("process_key:anon", 30/hour). When it saturates every one of them is refused and,
before this hook, nobody was told. ``services.app_error_handlers`` now emits one
Sentry ``capture_message`` per limit window per process from production's 429
handler, observability only.

The app is built with the production handlers through ``build_test_app`` (plan
215-03), so the 429 asserted here is the body production sends.

Oracle discipline (programme non-negotiable #3): every expected count, tag, status
and key below is a LITERAL.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any

import hashlib
import hmac

import pytest
import sentry_sdk
from fastapi.testclient import TestClient
from sentry_sdk.transport import Transport
from structlog.testing import capture_logs

from services import app_error_handlers
from tests.app_factory import build_test_app

# The router module comes FROM tests.test_process_key, never from a direct import:
# that module pops routers.process_key from sys.modules and re-imports it at load,
# so a direct import taken before it would be a second module object whose
# decorators register a second pair of limits on the shared limiter.
from tests.test_process_key import (
    _CLAIM_SECRET,
    _TEST_CID,
    _csv_validate_body,
    _mint_claim,
    process_key_router,
)


class _FakeScope:
    def __init__(self) -> None:
        self.tags: dict[str, str] = {}
        self.fingerprint: list[str] | None = None

    def set_tag(self, key: str, value: str) -> None:
        self.tags[key] = value


class _FakeSentry:
    """Records ``new_scope()`` + ``set_tag`` + ``fingerprint`` + ``capture_message``."""

    def __init__(self) -> None:
        self.captures: list[dict[str, Any]] = []
        self.raise_on_capture = False
        self._current: _FakeScope = _FakeScope()

    @contextmanager
    def new_scope(self) -> Iterator[_FakeScope]:
        scope = _FakeScope()
        self._current = scope
        yield scope

    def capture_message(self, message: str, level: str | None = None) -> None:
        if self.raise_on_capture:
            raise RuntimeError("sentry transport down")
        self.captures.append(
            {
                "message": message,
                "level": level,
                "tags": dict(self._current.tags),
                "fingerprint": self._current.fingerprint,
            }
        )


class _Clock:
    """A patched ``time.monotonic``: advanced by hand, never slept."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def sentry_spy(monkeypatch: pytest.MonkeyPatch) -> Iterator[_FakeSentry]:
    spy = _FakeSentry()
    monkeypatch.setattr(app_error_handlers, "sentry_sdk", spy)
    app_error_handlers._anon_alert_last_at.clear()
    yield spy
    app_error_handlers._anon_alert_last_at.clear()


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> _Clock:
    fake = _Clock()
    # Patch the function on the time module the handler module uses, scoped to
    # this module's own attribute, so the rest of the process keeps real time.
    monkeypatch.setattr(app_error_handlers.time, "monotonic", fake)
    return fake


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """A factory app on the production 429 handler, limiter storage reset both ways."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", _CLAIM_SECRET)
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "2/hour")
    app = build_test_app(process_key_router.router)
    app.state.limiter = process_key_router.limiter
    process_key_router.limiter.reset()
    # An ADMITTED request runs the real handler and fails downstream (no DB in
    # unit tests); only whether the limiter admitted it matters here.
    yield TestClient(app, raise_server_exceptions=False)
    process_key_router.limiter.reset()


def _post(client: TestClient, claim: str) -> Any:
    return client.post(
        "/process-key",
        json=_csv_validate_body(),
        headers={
            "Authorization": f"Bearer {_CLAIM_SECRET}",
            "X-Correlation-Id": _TEST_CID,
            "X-Tenant-Claim": claim,
        },
    )


def test_anonymous_refusal_emits_one_tagged_event(
    client: TestClient, sentry_spy: _FakeSentry
) -> None:
    """SC-7 c tracer: the third anonymous post is refused by the shared bucket."""
    anon = _mint_claim("public")

    assert _post(client, anon).status_code != 429
    assert _post(client, anon).status_code != 429
    assert sentry_spy.captures == [], "an admitted request must not alert"

    refused = _post(client, anon)

    assert refused.status_code == 429
    assert len(sentry_spy.captures) == 1, sentry_spy.captures
    event = sentry_spy.captures[0]
    assert event["message"] == "Anonymous teaser bucket saturated on /process-key"
    assert event["level"] == "warning"
    assert event["tags"] == {
        "anon_bucket_saturated": "process_key",
        "limit": "2 per 1 hour",
    }
    assert event["fingerprint"] == ["anon-bucket-saturated", "process_key"]
    # T-215-13: nothing caller-derived rides on the event.
    rendered = repr(event)
    assert _TEST_CID not in rendered
    assert "testclient" not in rendered.lower()
    assert "127.0.0.1" not in rendered
    assert anon not in rendered


def test_repeat_refusals_inside_the_window_emit_nothing_more(
    client: TestClient, sentry_spy: _FakeSentry, clock: _Clock
) -> None:
    anon = _mint_claim("public")
    for _ in range(3):
        _post(client, anon)
    assert len(sentry_spy.captures) == 1

    clock.now += 3599.0  # still inside the 3600 s window of "2/hour"
    assert _post(client, anon).status_code == 429
    assert _post(client, anon).status_code == 429

    assert len(sentry_spy.captures) == 1, (
        "T-215-14: refusals inside one window must not each emit"
    )


def test_a_refusal_after_the_window_emits_again(
    client: TestClient, sentry_spy: _FakeSentry, clock: _Clock
) -> None:
    anon = _mint_claim("public")
    for _ in range(3):
        _post(client, anon)
    assert len(sentry_spy.captures) == 1

    clock.now += 3601.0  # past the window
    assert _post(client, anon).status_code == 429

    assert len(sentry_spy.captures) == 2


def test_a_tenant_bucket_refusal_emits_nothing(
    client: TestClient,
    sentry_spy: _FakeSentry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_TENANT_LIMIT", "2/hour")
    tenant = _mint_claim("tenant-a")

    assert _post(client, tenant).status_code != 429
    assert _post(client, tenant).status_code != 429
    assert _post(client, tenant).status_code == 429

    assert sentry_spy.captures == [], (
        "one tenant over their own limit is not the anonymous-saturation signal"
    )


def test_a_platform_ceiling_refusal_emits_nothing(
    client: TestClient,
    sentry_spy: _FakeSentry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_CEILING_LIMIT", "3/hour")
    tenant_a = _mint_claim("tenant-a")
    tenant_b = _mint_claim("tenant-b")

    for _ in range(3):
        assert _post(client, tenant_a).status_code != 429
    # tenant-b's own bucket is untouched, so only the shared ceiling refuses it.
    assert _post(client, tenant_b).status_code == 429

    assert sentry_spy.captures == []


def test_a_raising_capture_still_returns_the_identical_429(
    client: TestClient, sentry_spy: _FakeSentry
) -> None:
    """T-215-15: the alert is observability only; a Sentry failure changes nothing."""
    anon = _mint_claim("public")
    _post(client, anon)
    _post(client, anon)
    working = _post(client, anon)
    assert working.status_code == 429
    assert len(sentry_spy.captures) == 1

    # A different window state: clear the dedupe so the raising capture is reached.
    app_error_handlers._anon_alert_last_at.clear()
    sentry_spy.raise_on_capture = True
    with capture_logs() as logs:
        broken = _post(client, anon)

    assert broken.status_code == 429
    assert len(sentry_spy.captures) == 1, "the raising capture recorded nothing"
    assert set(broken.json()) == set(working.json()) == {
        "ok",
        "code",
        "human_message",
        "detail",
        "correlation_id",
        "recoverable",
        "retry_after_seconds",
    }
    assert broken.json()["code"] == "RATE_LIMITED"
    assert broken.json()["detail"] == "Rate limit exceeded: 2 per 1 hour"
    assert "Retry-After" in broken.headers
    # SF-M1: the swallowed failure is logged with its traceback, never silent.
    failures = [e for e in logs if e["event"] == "request.anon_bucket_alert_failed"]
    assert len(failures) == 1, logs
    assert failures[0]["exc_info"] is True


def test_an_unreadable_refusing_bucket_is_logged_not_silent() -> None:
    """SF-M1: a slowapi shape change on ``view_rate_limit`` must leave a log line."""
    request: Any = SimpleNamespace(state=SimpleNamespace(view_rate_limit=None))
    throttle: Any = None  # never reached: the read fails first

    with capture_logs() as logs:
        app_error_handlers._alert_anon_bucket_saturated(request, throttle)

    failures = [e for e in logs if e["event"] == "request.anon_bucket_alert_failed"]
    assert len(failures) == 1, logs
    assert failures[0]["exc_info"] is True


def test_the_429_is_byte_identical_with_the_hook_neutered(
    client: TestClient,
    sentry_spy: _FakeSentry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    anon = _mint_claim("public")
    _post(client, anon)
    _post(client, anon)
    with_hook = _post(client, anon)
    assert with_hook.status_code == 429
    assert len(sentry_spy.captures) == 1

    monkeypatch.setattr(
        app_error_handlers, "_alert_anon_bucket_saturated", lambda request, throttle: None
    )
    without_hook = _post(client, anon)

    assert without_hook.status_code == 429
    assert len(sentry_spy.captures) == 1, "the neutered hook emitted nothing"

    def _stable(body: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in body.items() if k != "correlation_id"}

    assert _stable(with_hook.json()) == _stable(without_hook.json())
    assert with_hook.headers["content-type"] == without_hook.headers["content-type"]
    # Retry-After is the live remainder of the window, so it may differ by a
    # second between two calls; both must be a positive integer within the window.
    for resp in (with_hook, without_hook):
        assert 1 <= int(resp.headers["Retry-After"]) <= 3600


class _CapturingTransport(Transport):
    """A real sentry-sdk transport that keeps events in memory and sends nothing."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[dict[str, Any]] = []

    def capture_envelope(self, envelope: Any) -> None:
        event = envelope.get_event()
        if event is not None:
            self.events.append(event)


def test_the_real_sentry_sdk_emits_one_event_with_the_fingerprint_and_tag(
    client: TestClient,
) -> None:
    """SF-M2: every other case here replaces ``sentry_sdk`` with a spy, so a real API
    break (``new_scope``, ``scope.fingerprint``, ``capture_message``) at the pinned
    sdk would pass them while the alert silently stopped. This one runs the real SDK
    against a capturing transport: nothing leaves the process."""
    transport = _CapturingTransport()
    global_scope = sentry_sdk.get_global_scope()
    previous_client = global_scope.client
    global_scope.set_client(
        sentry_sdk.Client(
            dsn="https://public@o0.ingest.invalid/1",
            transport=transport,
            default_integrations=False,
        )
    )
    app_error_handlers._anon_alert_last_at.clear()
    try:
        anon = _mint_claim("public")
        _post(client, anon)
        _post(client, anon)
        assert _post(client, anon).status_code == 429
        sentry_sdk.get_client().flush()
    finally:
        global_scope.set_client(previous_client)
        app_error_handlers._anon_alert_last_at.clear()

    assert len(transport.events) == 1, transport.events
    event = transport.events[0]
    assert event["message"] == "Anonymous teaser bucket saturated on /process-key"
    assert event["level"] == "warning"
    assert event["fingerprint"] == ["anon-bucket-saturated", "process_key"]
    assert event["tags"]["anon_bucket_saturated"] == "process_key"


def _pseudonym(ip: str) -> str:
    """First 32 hex of HMAC-SHA256(secret, ``anon-ip:<ip>``): the TS construction."""
    return hmac.new(
        _CLAIM_SECRET.encode("utf-8"), f"anon-ip:{ip}".encode("utf-8"), hashlib.sha256
    ).hexdigest()[:32]


def _anon_claim(ip: str) -> str:
    return _mint_claim(f"public:{_pseudonym(ip)}")


def test_an_aggregate_refusal_emits_one_tagged_event(
    client: TestClient, sentry_spy: _FakeSentry, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 240: the anonymous AGGREGATE saturating is the same signal as the shared
    bucket, so it alerts with the byte-stable message, fingerprint and tag. Three
    different pseudonyms, one call each: no per-IP window is near full, so only the
    aggregate (shrunk to 2/hour) can refuse the third."""
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_AGGREGATE_LIMIT", "2/hour")

    assert _post(client, _anon_claim("192.0.2.10")).status_code != 429
    assert _post(client, _anon_claim("192.0.2.20")).status_code != 429
    assert sentry_spy.captures == []

    assert _post(client, _anon_claim("198.51.100.30")).status_code == 429

    assert len(sentry_spy.captures) == 1, sentry_spy.captures
    event = sentry_spy.captures[0]
    assert event["message"] == "Anonymous teaser bucket saturated on /process-key"
    assert event["fingerprint"] == ["anon-bucket-saturated", "process_key"]
    assert event["tags"]["anon_bucket_saturated"] == "process_key"


def test_a_per_ip_refusal_emits_no_event_and_grows_no_dedupe_entry(
    client: TestClient, sentry_spy: _FakeSentry
) -> None:
    """One visitor over their own window is a normal fairness refusal, not the
    saturation signal. Alerting on it would page on ordinary use and grow
    ``_anon_alert_last_at`` by one key per pseudonym without bound."""
    a = _anon_claim("192.0.2.10")

    assert _post(client, a).status_code != 429
    assert _post(client, a).status_code != 429
    for _ in range(3):
        assert _post(client, a).status_code == 429

    assert sentry_spy.captures == []
    assert [
        k for k in app_error_handlers._anon_alert_last_at if k.startswith("process_key:anon:")
    ] == []
    assert app_error_handlers._anon_alert_last_at == {}
