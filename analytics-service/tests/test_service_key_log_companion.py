"""M-14 — the two `_capture_secret_misconfig` sites in `verify_service_key` that
fire with no log companion.

`main._capture_secret_misconfig` routes to Sentry. Three of its five call sites
pair with a structured log line; **two do not** — both in `verify_service_key`:

  * `SERVICE_KEY` **unset** — the Railway half of C-11. Every guarded route
    refuses while `/health` stays green.
  * `SERVICE_KEY` **mismatched** — "C-11's HEADLINE", a stale
    `ANALYTICS_SERVICE_KEY` on Vercel producing a 401 storm that no breaker
    counts and no probe notices.

`SENTRY_DSN` IS set on Railway (verified), so this is **hygiene, not a blind
spot**: it removes the single-vendor dependency in the operator signal. When
Sentry is muted, rate-limited by its own quota, or simply not where the operator
is looking, the structured log is the only remaining trail.

**The load-bearing test in this file is the ZERO case.** The mismatched log line
lives inside `if provided:` — an absent `X-Service-Key` header is internet
background noise (unauthenticated probers hit every public host continuously),
and logging it makes the signal meaningless in exactly the way that made C-11
invisible in the first place. A line that drifts one indent level out of that
block still passes both positive tests; only the 0-event assertion catches it.

ORACLE DISCIPLINE (programme non-negotiable #3): every expected event name,
level, count and status below is a **literal typed into this file**. Nothing is
read back out of `main`.
"""

from __future__ import annotations

from typing import Any, Iterator

import httpx
import pytest
from structlog.testing import capture_logs

# Distinctive, wordless secrets — a leak into a log line has to be unmistakable
# and cannot be confused with ordinary vocabulary ("SERVICE_KEY", "mismatched").
_SERVICE_KEY_CANARY = "Zx9Qv7Wm2Kd4Rb8Tn5Hj3Lp6Fs1Gy0"
_WRONG_SERVICE_KEY = "Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0"

# A guarded path (not /health, /internal/*, /process-key) that routes nowhere.
# `verify_service_key` is middleware, so it runs BEFORE routing and produces the
# refusal without touching any endpoint, limiter bucket or dependency.
_GUARDED_PATH = "/api/__m14_probe__"


@pytest.fixture
def auth_events(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[dict[str, Any]]]:
    """The structlog stream, plus a cleared Sentry-capture throttle.

    The throttle is a module-global dict; clearing it both ways means a
    neighbouring test neither primes nor inherits it. The log lines under test
    are deliberately NOT throttled — the Sentry capture is the expensive half,
    and the sibling `_gate_process_key` arms log unconditionally too.
    """
    import main

    main._secret_capture_last_at.clear()
    with capture_logs() as events:
        yield events
    main._secret_capture_last_at.clear()


def _client(**kwargs: Any) -> httpx.AsyncClient:
    import main

    transport = httpx.ASGITransport(app=main.app, **kwargs)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _service_key_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e for e in events if str(e.get("event", "")).startswith("service_key.")]


def _assert_no_secret_material(events: list[dict[str, Any]]) -> None:
    """The constraint that outranks the signal.

    Naming the env var is the entire point; naming its value turns the operator
    signal into the leak. The wrong key matters as much as the right one — on a
    rotation it IS the previous real secret.
    """
    blob = repr(events)
    for secret in (_SERVICE_KEY_CANARY, _WRONG_SERVICE_KEY):
        assert secret not in blob, f"a platform secret leaked into a log line: {blob}"


@pytest.mark.asyncio
async def test_wrong_service_key_logs_exactly_one_mismatch_event(
    monkeypatch: pytest.MonkeyPatch, auth_events: list[dict[str, Any]]
) -> None:
    """M-14's named subject. A stale `ANALYTICS_SERVICE_KEY` on Vercel lands here.

    `warning`, matching the `process_key.auth.token_mismatch` sibling: a
    mismatched credential is either a rotation mid-flight or an attacker, and
    neither is an operator-must-act-now `error` the way an unset secret is.
    """
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)

    async with _client() as client:
        resp = await client.post(
            _GUARDED_PATH, json={}, headers={"X-Service-Key": _WRONG_SERVICE_KEY}
        )

    # The refusal is UNCHANGED — this is additive observability, not a new
    # rejection, and a changed status here would be a regression, not a feature.
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Unauthorized"}

    events = _service_key_events(auth_events)
    assert len(events) == 1, f"expected exactly one service_key event, got {events}"
    assert events[0]["event"] == "service_key.mismatch"
    assert events[0]["log_level"] == "warning"
    assert events[0]["path"] == _GUARDED_PATH
    _assert_no_secret_material(auth_events)


@pytest.mark.asyncio
async def test_an_absent_service_key_header_logs_nothing_at_all(
    monkeypatch: pytest.MonkeyPatch, auth_events: list[dict[str, Any]]
) -> None:
    """THE test this file exists for (RESEARCH Validation row M-14).

    An absent `X-Service-Key` is an unauthenticated prober — internet background
    noise, arriving continuously on any public host. Logging it would bury the
    real signal under noise, which is the same failure mode as having no signal.

    The mismatch line therefore lives INSIDE `if provided:`. A line that drifts
    one indent level out of that block still satisfies both positive tests in
    this file; this **zero**-event assertion is the only thing that catches it.
    """
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)

    async with _client() as client:
        resp = await client.post(_GUARDED_PATH, json={})  # no header at all

    assert resp.status_code == 401
    assert resp.json() == {"detail": "Unauthorized"}

    events = _service_key_events(auth_events)
    assert events == [], (
        "an absent header must log NOTHING — capturing internet background "
        f"noise makes the operator signal meaningless. Got {events}"
    )


@pytest.mark.asyncio
async def test_unset_service_key_logs_exactly_one_secret_unset_event(
    monkeypatch: pytest.MonkeyPatch, auth_events: list[dict[str, Any]]
) -> None:
    """The Railway half of C-11, and M-14's second member — missed by the review,
    which counted "four of five" sites as already paired. Three were.

    `error`, not `warning`: an unset platform secret is a deploy fault that
    refuses EVERY request to EVERY guarded route until a human sets the env var.
    That is the same severity the `process_key.auth.secret_unset` sibling uses
    for the identical fault on the other secret.
    """
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", None)

    async with _client() as client:
        resp = await client.post(
            _GUARDED_PATH, json={}, headers={"X-Service-Key": _WRONG_SERVICE_KEY}
        )

    # S-23 is unchanged: SERVICE-PERMANENT, never a breaker input.
    assert resp.status_code == 500
    assert resp.json() == {
        "detail": {
            "code": "SERVICE_KEY_UNCONFIGURED",
            "dependency": None,
            "retryable": False,
            "detail": "Service not configured",
        }
    }

    events = _service_key_events(auth_events)
    assert len(events) == 1, f"expected exactly one service_key event, got {events}"
    assert events[0]["event"] == "service_key.secret_unset"
    assert events[0]["log_level"] == "error"
    assert events[0]["path"] == _GUARDED_PATH
    _assert_no_secret_material(auth_events)


@pytest.mark.asyncio
async def test_unset_and_mismatched_are_distinguishable_in_the_log_stream(
    monkeypatch: pytest.MonkeyPatch, auth_events: list[dict[str, Any]]
) -> None:
    """A rotation must not look like a deploy fault, and vice versa.

    The Sentry captures already carry distinct `config_fault` tags; the log
    stream is useless as a fallback if it collapses the two into one event name.
    """
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", None)
    async with _client() as client:
        await client.post(_GUARDED_PATH, json={})

    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY_CANARY)
    async with _client() as client:
        await client.post(
            _GUARDED_PATH, json={}, headers={"X-Service-Key": _WRONG_SERVICE_KEY}
        )

    assert [e["event"] for e in _service_key_events(auth_events)] == [
        "service_key.secret_unset",
        "service_key.mismatch",
    ]
    _assert_no_secret_material(auth_events)
