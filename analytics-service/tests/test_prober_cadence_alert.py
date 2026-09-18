"""Tests for POST /api/prober-cadence-alert (analytics-service/routers/cron.py).

Covers PROBER-CADENCE-UNDELIVERED-01 / Phase 164.1.1 plan 04: the far end of
the alarm `public.prod_prober_cadence_check()` posts when the prod-prober's
last contact exceeds the measured cadence ceiling.

Each of the four load-bearing behaviours below — the unconditional log, the
escalation window, the escalation-failure containment, and the body
validation — was manually neutered in `routers/cron.py`, observed RED by
name, and restored. See the plan 04 SUMMARY for the neuter applied and the
exact failure observed per behaviour.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import cron as cron_mod

# A plausible-looking, entirely fake service key — never a real credential.
# Used ONLY to prove it never lands in a log record or an escalation call.
_CANARY_SERVICE_KEY = "X9vQ2mNb7RtL4kZp1YcW6HsD3Jf8Ug5A"


class _FakeClock:
    """A monotonic clock the test drives, substituted for `routers.cron`'s
    `time` module — mirrors `_FakeClock` in
    tests/test_status_contract_exchange_internal.py's KEK-alert window test.
    """

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def client() -> TestClient:
    """Bare FastAPI app with routers.cron mounted — no SERVICE_KEY middleware.

    The middleware guard itself is proven separately, driving the REAL
    `main.app` stack (see
    `test_unauthenticated_request_is_refused_by_service_key_middleware`
    below) — mirrors the split `tests/test_status_contract_exchange_internal.py`
    uses for routers/internal.py: router-logic tests run bare, the auth-order
    claim runs through the full app.
    """
    cron_mod._reset_prober_cadence_alert()
    app = FastAPI()
    app.include_router(cron_mod.router)
    test_client = TestClient(app)
    yield test_client
    cron_mod._reset_prober_cadence_alert()


def _body(
    *,
    cron_name: str = "prod_prober",
    gap_minutes: Any = 625,
    ceiling: str = "10:25:00",
    detected_at: str = "2026-09-18T12:00:00Z",
) -> dict[str, Any]:
    return {
        "cron_name": cron_name,
        "gap_minutes": gap_minutes,
        "ceiling": ceiling,
        "detected_at": detected_at,
    }


def _drop(body: dict[str, Any], *keys: str) -> dict[str, Any]:
    return {k: v for k, v in body.items() if k not in keys}


def _error_records(caplog: pytest.LogCaptureFixture) -> list[Any]:
    return [r for r in caplog.records if r.levelname == "ERROR"]


# ---------------------------------------------------------------------------
# Accepted body — 200, one log line carrying the measurement
# ---------------------------------------------------------------------------


def test_accepted_body_returns_200_and_logs_the_measurement(client, caplog):
    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post(
            "/api/prober-cadence-alert",
            json=_body(gap_minutes=625, ceiling="10:25:00"),
        )

    assert resp.status_code == 200
    records = _error_records(caplog)
    assert len(records) == 1, (
        "expected exactly one structured log line for one accepted alert; got "
        + repr([r.message for r in caplog.records])
    )
    assert "625" in records[0].message
    assert "10:25:00" in records[0].message
    assert "2026-09-18T12:00:00" in records[0].message, (
        "IN-01: detected_at must surface in the log line; got "
        + records[0].message
    )


def test_escalation_message_carries_detected_at(client, monkeypatch, caplog):
    """IN-01: `detected_at` is a required field on the wire but was dropped
    before ever reaching the Sentry message — assert it surfaces there too.
    """
    spy = MagicMock()
    monkeypatch.setattr(cron_mod, "sentry_sdk", spy)
    cron_mod._reset_prober_cadence_alert()

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post(
            "/api/prober-cadence-alert",
            json=_body(detected_at="2026-09-18T12:00:00Z"),
        )

    assert resp.status_code == 200
    message = spy.capture_message.call_args.args[0]
    assert "2026-09-18T12:00:00" in message, (
        "the Sentry escalation must surface detected_at; got " + message
    )


def test_null_gap_minutes_is_accepted_and_logged_as_never(client, caplog):
    """The never-contacted case: gap_minutes is explicitly null, not absent."""
    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post("/api/prober-cadence-alert", json=_body(gap_minutes=None))

    assert resp.status_code == 200
    records = _error_records(caplog)
    assert len(records) == 1
    assert "never" in records[0].message, (
        "a null gap_minutes must log the WORD 'never', not a blank/None value; got "
        + records[0].message
    )


# ---------------------------------------------------------------------------
# Malformed body — 4xx naming the field, zero escalation, zero log
# ---------------------------------------------------------------------------


def test_missing_gap_minutes_is_4xx_and_no_escalation(client, caplog, monkeypatch):
    spy = MagicMock()
    monkeypatch.setattr(cron_mod, "sentry_sdk", spy)

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post(
            "/api/prober-cadence-alert", json=_drop(_body(), "gap_minutes")
        )

    assert 400 <= resp.status_code < 500
    assert "gap_minutes" in resp.text
    assert spy.capture_message.call_count == 0
    assert not _error_records(caplog), (
        "a rejected body must never reach the logging path"
    )


def test_non_integer_gap_minutes_is_4xx(client):
    resp = client.post(
        "/api/prober-cadence-alert", json=_body(gap_minutes="not-a-number")
    )
    assert 400 <= resp.status_code < 500
    assert "gap_minutes" in resp.text


def test_missing_cron_name_is_4xx(client):
    resp = client.post("/api/prober-cadence-alert", json=_drop(_body(), "cron_name"))
    assert 400 <= resp.status_code < 500
    assert "cron_name" in resp.text


# ---------------------------------------------------------------------------
# The window — one escalation inside, two either side
# ---------------------------------------------------------------------------


def test_two_alerts_inside_window_produce_two_logs_one_escalation(
    client, monkeypatch, caplog
):
    spy = MagicMock()
    monkeypatch.setattr(cron_mod, "sentry_sdk", spy)
    clock = _FakeClock()
    monkeypatch.setattr(cron_mod, "time", clock)
    cron_mod._reset_prober_cadence_alert()

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        r1 = client.post("/api/prober-cadence-alert", json=_body())
        clock.advance(cron_mod._PROBER_CADENCE_ALERT_WINDOW_S - 1)
        r2 = client.post("/api/prober-cadence-alert", json=_body())

    assert r1.status_code == 200 and r2.status_code == 200
    assert len(_error_records(caplog)) == 2, "every accepted alert must log, window or not"
    assert spy.capture_message.call_count == 1, (
        "a second alert inside the window must not re-escalate to Sentry"
    )


def test_two_alerts_either_side_of_window_produce_two_escalations(
    client, monkeypatch, caplog
):
    spy = MagicMock()
    monkeypatch.setattr(cron_mod, "sentry_sdk", spy)
    clock = _FakeClock()
    monkeypatch.setattr(cron_mod, "time", clock)
    cron_mod._reset_prober_cadence_alert()

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        r1 = client.post("/api/prober-cadence-alert", json=_body())
        clock.advance(cron_mod._PROBER_CADENCE_ALERT_WINDOW_S + 1)
        r2 = client.post("/api/prober-cadence-alert", json=_body())

    assert r1.status_code == 200 and r2.status_code == 200
    assert spy.capture_message.call_count == 2, (
        "the operator signal must return once the window has fully expired"
    )


def test_two_alerts_for_different_cron_names_inside_window_both_escalate(
    client, monkeypatch, caplog
):
    """WR-02: the escalation window is keyed by `cron_name`, not a single
    shared timestamp. Pre-fix, this fails: the second call (a DIFFERENT,
    unrelated cron) would be swallowed by the window the first cron_name
    opened, silently downgrading its Sentry-paged signal to log-only.
    """
    spy = MagicMock()
    monkeypatch.setattr(cron_mod, "sentry_sdk", spy)
    clock = _FakeClock()
    monkeypatch.setattr(cron_mod, "time", clock)
    cron_mod._reset_prober_cadence_alert()

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        r1 = client.post(
            "/api/prober-cadence-alert", json=_body(cron_name="prod_prober")
        )
        clock.advance(cron_mod._PROBER_CADENCE_ALERT_WINDOW_S - 1)
        r2 = client.post(
            "/api/prober-cadence-alert",
            json=_body(cron_name="some_other_prober"),
        )

    assert r1.status_code == 200 and r2.status_code == 200
    assert len(_error_records(caplog)) == 2, "every accepted alert must log"
    assert spy.capture_message.call_count == 2, (
        "a different cron_name inside the same window must escalate "
        "independently, not be suppressed by an unrelated cron's window"
    )


# ---------------------------------------------------------------------------
# Escalation-failure containment
# ---------------------------------------------------------------------------


def test_escalation_that_raises_does_not_change_response_or_propagate(
    client, monkeypatch, caplog
):
    spy = MagicMock()
    spy.capture_message.side_effect = RuntimeError("sentry transport down")
    monkeypatch.setattr(cron_mod, "sentry_sdk", spy)
    cron_mod._reset_prober_cadence_alert()

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post("/api/prober-cadence-alert", json=_body())

    assert resp.status_code == 200, (
        "an escalation-transport failure must never surface as a non-200 — "
        f"got {resp.status_code}: {resp.text}"
    )
    assert len(_error_records(caplog)) == 1, (
        "the structured log must already have been emitted before the failed capture"
    )


# ---------------------------------------------------------------------------
# Secrets never leak into a log record or an escalation argument
# ---------------------------------------------------------------------------


def test_no_log_or_escalation_carries_the_request_service_key(
    client, monkeypatch, caplog
):
    spy = MagicMock()
    monkeypatch.setattr(cron_mod, "sentry_sdk", spy)
    cron_mod._reset_prober_cadence_alert()

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post(
            "/api/prober-cadence-alert",
            json=_body(),
            headers={"X-Service-Key": _CANARY_SERVICE_KEY},
        )

    assert resp.status_code == 200
    rendered_logs = " ".join(r.message for r in caplog.records)
    rendered_escalation = repr(spy.set_tag.call_args_list) + repr(
        spy.capture_message.call_args_list
    )
    assert _CANARY_SERVICE_KEY not in rendered_logs
    assert _CANARY_SERVICE_KEY not in rendered_escalation


# ---------------------------------------------------------------------------
# T-164.1.1-15 — the route is guarded by the existing SERVICE_KEY middleware,
# no carve-out. Driven through the REAL `main.app` stack (httpx.ASGITransport,
# which does NOT run lifespan) so this proves the middleware, not a
# bare-router test harness that would pass vacuously with no auth at all —
# same idiom as tests/test_secret_misconfig_signal.py and
# tests/test_process_key_auth_order.py.
# ---------------------------------------------------------------------------


def _main_client(**kwargs: Any) -> httpx.AsyncClient:
    import main

    transport = httpx.ASGITransport(app=main.app, **kwargs)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_unauthenticated_request_is_refused_by_service_key_middleware(
    monkeypatch,
):
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", "a-real-service-key-value")

    async with _main_client(raise_app_exceptions=False) as ac:
        resp = await ac.post("/api/prober-cadence-alert", json=_body())

    assert resp.status_code == 401, (
        "an unkeyed POST to /api/prober-cadence-alert must be refused by the "
        f"existing SERVICE_KEY middleware, no carve-out. Got {resp.status_code}: {resp.text}"
    )
