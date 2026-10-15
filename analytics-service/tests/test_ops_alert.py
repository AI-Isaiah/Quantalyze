"""Tests for services/ops_alert.py -- the ONE ops-alert channel (Phase 164.6.8 plan 01).

WHY these properties matter (Rule 9: a test that cannot fail when the business
logic changes is wrong):

* a flood of Sentry captures gets muted, and a muted channel is no channel;
* a raise from an alert path becomes a second outage on top of the first;
* a service key in a log line goes to a public log;
* a redirect followed by the email POST carries the Bearer key to whatever
  host the redirect names.

Each guard below was neutered in ``services/ops_alert.py``, observed RED by
name, and restored byte-identical. See the plan 01 SUMMARY.
"""

from __future__ import annotations

import types
from datetime import datetime, timezone
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import FastAPI

from routers import cron as cron_mod
from services import ops_alert

# Unmistakably synthetic (see the entropy note in test_prober_cadence_alert.py):
# unique enough to be visible if it leaks, never "key-shaped".
CANARY_SERVICE_KEY = "CANARY-not-a-real-key-ops-alert-leak-probe"


class FakeClock:
    """A monotonic clock the test drives, substituted for ``ops_alert.time``."""

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeHttp:
    """Stands in for the ``httpx`` module INSIDE ``ops_alert`` only.

    Patching the real ``httpx.AsyncClient`` would also break the ASGI client the
    tests themselves use to drive the cadence route.
    """

    def __init__(self) -> None:
        self.client_kwargs: list[dict[str, Any]] = []
        self.posts: list[dict[str, Any]] = []
        self.status = 200
        self.raises: Exception | None = None
        outer = self

        class _Client:
            def __init__(self, **kwargs: Any) -> None:
                outer.client_kwargs.append(kwargs)

            async def __aenter__(self) -> "_Client":
                return self

            async def __aexit__(self, *exc: Any) -> bool:
                return False

            async def post(
                self, url: str, *, json: Any = None, headers: Any = None
            ) -> Any:
                outer.posts.append({"url": url, "json": json, "headers": headers})
                if outer.raises is not None:
                    raise outer.raises
                return types.SimpleNamespace(status_code=outer.status)

        self.module = types.SimpleNamespace(AsyncClient=_Client)


@pytest.fixture
def chan(monkeypatch: pytest.MonkeyPatch):
    """A fully faked channel: Sentry spy, httpx fake, clock, env, clean state."""
    spy = MagicMock()
    http = FakeHttp()
    clock = FakeClock()
    monkeypatch.setattr(ops_alert, "sentry_sdk", spy)
    monkeypatch.setattr(ops_alert, "httpx", http.module)
    monkeypatch.setattr(ops_alert, "time", clock)
    monkeypatch.setenv("SERVICE_KEY", CANARY_SERVICE_KEY)
    monkeypatch.delenv("OPS_ALERT_APP_URL", raising=False)
    monkeypatch.delenv("MT5_SERVER", raising=False)
    monkeypatch.delenv("MT5_LOGIN", raising=False)
    ops_alert._reset_ops_alert_for_tests()
    scopes: list[Any] = []

    def _new_scope() -> Any:
        scope = MagicMock()
        scope.tags = {}
        scope.set_tag.side_effect = lambda k, v: scope.tags.__setitem__(k, v)
        scopes.append(scope)
        cm = MagicMock()
        cm.__enter__.return_value = scope
        cm.__exit__.return_value = False
        return cm

    spy.new_scope.side_effect = _new_scope

    yield types.SimpleNamespace(
        spy=spy,
        scopes=scopes,
        http=http,
        clock=clock,
        tags=lambda: [dict(sc.tags) for sc in scopes],
    )
    ops_alert._reset_ops_alert_for_tests()


def _error_records(caplog: pytest.LogCaptureFixture) -> list[Any]:
    return [r for r in caplog.records if r.levelname == "ERROR"]


# ---------------------------------------------------------------------------
# Tracer (Task 1): one cadence alert reaches Sentry AND the email route
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_cadence_alert_reaches_sentry_and_the_founder_email_route(chan):
    """D-01 end to end: POST /api/prober-cadence-alert -> ops_alert.page ->
    (a) one tagged Sentry capture and (b) one authenticated POST to the
    Next.js route. If either half is dropped the founder is not paged by it.
    """
    app = FastAPI()
    app.include_router(cron_mod.router)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/prober-cadence-alert",
            json={
                "cron_name": "prod_prober",
                "gap_minutes": 625,
                "ceiling": "10:25:00",
                "detected_at": "2026-09-18T12:00:00Z",
            },
        )
    await ops_alert._drain_ops_alert_tasks_for_tests()

    assert resp.status_code == 200
    assert chan.spy.capture_message.call_count == 1
    assert chan.tags() == [
        {
            "ops_alert_source": "prod_prober",
            "ops_alert_cause": "cadence_gap",
            "ops_alert_event": "outage",
            "prober_cadence_alert": "prod_prober",
        }
    ]
    assert chan.spy.capture_message.call_args.kwargs["level"] == "error"
    assert len(chan.http.posts) == 1
    post = chan.http.posts[0]
    assert post["url"] == "https://quantalyze.xyz/api/cron/ops-alert"
    assert post["headers"] == {"Authorization": f"Bearer {CANARY_SERVICE_KEY}"}
    assert post["json"]["source"] == "prod_prober"
    assert post["json"]["cause"] == "cadence_gap"
    assert post["json"]["event"] == "outage"
    assert post["json"]["since"] is not None


@pytest.mark.asyncio
async def test_page_posts_the_documented_body(chan):
    """The body is a frozen contract with the Next.js route's zod schema."""
    since = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
    await ops_alert.page(
        "cron_sync", "stale_heartbeat", event="outage", since=since, detail="d"
    )
    await ops_alert._drain_ops_alert_tasks_for_tests()

    body = chan.http.posts[0]["json"]
    assert set(body) == {
        "source", "event", "cause", "since", "detected_at", "detail"
    }
    assert body["since"] == since.isoformat()
    assert body["detail"] == "d"


# ---------------------------------------------------------------------------
# The window (D-05): per (source, cause, event), hourly, ERROR on every call
# ---------------------------------------------------------------------------


async def _page(**over: Any) -> None:
    kwargs: dict[str, Any] = {"event": "outage", "detail": "x"}
    kwargs.update(over)
    source = kwargs.pop("source", "mt5_jobs_terminal")
    cause = kwargs.pop("cause", "blind_run")
    await ops_alert.page(source, cause, **kwargs)
    await ops_alert._drain_ops_alert_tasks_for_tests()


async def test_two_pages_inside_the_window_log_twice_but_capture_and_post_once(
    chan, caplog
):
    """A sustained outage re-pages at most hourly: an unbounded capture is a
    flood, and a muted channel is indistinguishable from no channel. The ERROR
    log is the floor and fires on EVERY call.
    """
    with caplog.at_level("ERROR"):
        await _page()
        chan.clock.advance(ops_alert.OPS_ALERT_WINDOW_S - 1)
        await _page()

    assert len(_error_records(caplog)) == 2
    assert chan.spy.capture_message.call_count == 1
    assert len(chan.http.posts) == 1


async def test_the_page_returns_once_the_window_has_fully_expired(chan):
    await _page()
    chan.clock.advance(ops_alert.OPS_ALERT_WINDOW_S + 1)
    await _page()

    assert chan.spy.capture_message.call_count == 2
    assert len(chan.http.posts) == 2


async def test_a_different_cause_inside_the_window_pages_independently(chan):
    """D-05 keys per CAUSE, not per source: a second, different fault on the same
    terminal must not be swallowed by the first fault's window.
    """
    await _page(cause="blind_run")
    await _page(cause="relaunch_debt")

    assert chan.spy.capture_message.call_count == 2
    assert len(chan.http.posts) == 2


async def test_outage_then_recovered_inside_the_window_both_page(chan):
    """The event is part of the key: the 'recovered' notice is the one message
    that tells the founder to stop looking, and an outage window must not eat it.
    """
    await _page(event="outage")
    await _page(event="recovered")

    assert [t["ops_alert_event"] for t in chan.tags()] == ["outage", "recovered"]
    levels = [c.kwargs["level"] for c in chan.spy.capture_message.call_args_list]
    assert levels == ["error", "warning"]
    assert len(chan.http.posts) == 2


async def test_an_outage_that_reopens_inside_the_window_pages_again(chan):
    """Review SFH-F1 / WR-02 (a). The founder's LAST message must never say
    RECOVERED while the system is down: a recovery ends the incident, so the next
    outage on that source is a NEW incident and pages at once, window or not.
    """
    await _page(cause="ipc_fault", event="outage")
    chan.clock.advance(600)
    await _page(cause="recovered_from_ipc_fault", event="recovered")
    chan.clock.advance(600)
    await _page(cause="ipc_fault", event="outage")

    assert [t["ops_alert_event"] for t in chan.tags()] == [
        "outage",
        "recovered",
        "outage",
    ]
    assert chan.spy.capture_message.call_count == 3
    assert len(chan.http.posts) == 3


async def test_a_sustained_outage_still_pages_once_an_hour_after_a_recovery_cycle(
    chan,
):
    """The window is cleared by a RECOVERY, not weakened: once the re-opened
    outage has paged, its own readings inside the hour are suppressed again."""
    await _page(cause="ipc_fault", event="outage")
    await _page(cause="recovered_from_ipc_fault", event="recovered")
    await _page(cause="ipc_fault", event="outage")
    await _page(cause="ipc_fault", event="outage")
    await _page(cause="ipc_fault", event="outage")

    assert chan.spy.capture_message.call_count == 3


async def test_a_recovery_clears_only_its_own_sources_outage_windows(chan):
    """Source A recovers: A's outage windows (every cause) are cleared, and source
    B's open incident keeps its window and does not re-page."""
    await _page(source="mt5_jobs_terminal", cause="ipc_fault")
    await _page(source="mt5_jobs_terminal", cause="busy_skip")
    await _page(source="mt5_validation_terminal", cause="ipc_fault")
    assert chan.spy.capture_message.call_count == 3

    await _page(
        source="mt5_jobs_terminal",
        cause="recovered_from_busy_skip",
        event="recovered",
    )
    assert chan.spy.capture_message.call_count == 4

    await _page(source="mt5_jobs_terminal", cause="ipc_fault")
    await _page(source="mt5_jobs_terminal", cause="busy_skip")
    await _page(source="mt5_validation_terminal", cause="ipc_fault")

    assert chan.spy.capture_message.call_count == 6


async def test_a_recovery_pages_at_most_once_per_incident(chan):
    """A second recovery for the same source with no outage page between them is
    the same incident ending twice. Whatever cause it names, it must not send a
    second 'recovered'; a NEW outage page re-arms recovery for the next incident.
    """
    await _page(cause="ipc_fault", event="outage")
    await _page(cause="recovered_from_ipc_fault", event="recovered")
    await _page(cause="recovered_from_busy_skip", event="recovered")
    assert [t["ops_alert_event"] for t in chan.tags()] == ["outage", "recovered"]

    await _page(cause="ipc_fault", event="outage")
    await _page(cause="recovered_from_ipc_fault", event="recovered")
    assert [t["ops_alert_event"] for t in chan.tags()] == [
        "outage",
        "recovered",
        "outage",
        "recovered",
    ]
    assert len(chan.http.posts) == 4


async def test_a_suppressed_outage_does_not_re_arm_recovery(chan):
    """Only an outage that actually PAGES starts a new incident. A repeat reading
    of the same open incident (suppressed by its window) must not re-arm the
    recovery window, or one incident could send two 'recovered' notices."""
    await _page(cause="ipc_fault", event="outage")
    await _page(cause="recovered_from_ipc_fault", event="recovered")
    await _page(cause="ipc_fault", event="outage")  # new incident, pages
    await _page(cause="recovered_from_ipc_fault", event="recovered")
    await _page(cause="ipc_fault", event="outage")  # new incident, pages
    await _page(cause="ipc_fault", event="outage")  # same incident, suppressed
    await _page(cause="recovered_from_ipc_fault", event="recovered")
    await _page(cause="recovered_from_ipc_fault", event="recovered")  # dup

    assert [t["ops_alert_event"] for t in chan.tags()] == [
        "outage",
        "recovered",
        "outage",
        "recovered",
        "outage",
        "recovered",
    ]


# ---------------------------------------------------------------------------
# Delivery spends the window (review SFH-F2): a page that reached NO channel must
# not silence the retry
# ---------------------------------------------------------------------------


async def test_a_page_that_reached_no_channel_does_not_spend_the_window(chan, caplog):
    """The founder email fails (502) AND Sentry produced no event id. Nothing
    reached a human, so the next reading retries instead of waiting an hour, and
    the failure is logged at ERROR (a level the Sentry LoggingIntegration reports).
    """
    chan.spy.capture_message.return_value = None
    chan.http.status = 502

    with caplog.at_level("ERROR"):
        await _page()
        await _page()

    assert chan.spy.capture_message.call_count == 2
    assert len(chan.http.posts) == 2
    assert any(
        "no channel delivered" in r.getMessage() and r.levelname == "ERROR"
        for r in caplog.records
    )


async def test_a_failed_email_with_a_sentry_event_still_spends_the_window(chan):
    """Sentry reached the founder's rule, so the page was delivered once: the
    window holds and a sustained outage is not re-paged every reading."""
    chan.http.status = 502

    await _page()
    await _page()

    assert chan.spy.capture_message.call_count == 1
    assert len(chan.http.posts) == 1


async def test_a_delivered_email_with_no_sentry_event_still_spends_the_window(chan):
    chan.spy.capture_message.return_value = None

    await _page()
    await _page()

    assert len(chan.http.posts) == 1


async def test_a_raising_email_with_no_sentry_event_releases_the_window(chan):
    chan.spy.capture_message.return_value = None
    chan.http.raises = httpx.ConnectError("boom")

    await _page()
    await _page()

    assert len(chan.http.posts) == 2


async def test_an_unset_service_key_with_no_sentry_event_releases_the_window(
    chan, monkeypatch
):
    chan.spy.capture_message.return_value = None
    monkeypatch.delenv("SERVICE_KEY", raising=False)

    await _page()
    await _page()

    assert chan.spy.capture_message.call_count == 2


async def test_a_raising_sentry_capture_and_a_failed_email_release_the_window(chan):
    chan.spy.capture_message.side_effect = RuntimeError("sdk down")
    chan.http.status = 401

    await _page()
    await _page()

    assert chan.spy.capture_message.call_count == 2
    assert len(chan.http.posts) == 2


async def test_an_unschedulable_email_with_no_sentry_event_releases_the_window(
    chan, monkeypatch
):
    """The email task cannot even be created (page still never raises), and Sentry
    took nothing: the stamp must not stand for an hour over a page nobody got."""
    chan.spy.capture_message.return_value = None

    def boom(_payload: Any) -> None:
        raise RuntimeError("no loop")

    monkeypatch.setattr(ops_alert, "_schedule_founder_email", boom)

    await ops_alert.page("mt5_jobs_terminal", "blind_run", event="outage")
    await ops_alert.page("mt5_jobs_terminal", "blind_run", event="outage")

    assert chan.spy.capture_message.call_count == 2


async def test_a_released_window_is_not_released_over_a_newer_page(chan):
    """The release is a compare-and-clear: a failed delivery must only free the
    window ITS OWN page spent, never one a later page has since stamped."""
    chan.spy.capture_message.return_value = None
    chan.http.status = 502
    await ops_alert.page("mt5_jobs_terminal", "blind_run", event="outage")
    key = ("mt5_jobs_terminal", "blind_run", "outage")
    spent = ops_alert._last_alert_at[key]
    ops_alert._last_alert_at[key] = spent + 5.0  # a newer page's stamp
    await ops_alert._drain_ops_alert_tasks_for_tests()

    assert ops_alert._last_alert_at.get(key) == spent + 5.0


async def test_a_different_source_inside_the_window_pages_independently(chan):
    await _page(source="mt5_jobs_terminal")
    await _page(source="mt5_validation_terminal")

    assert chan.spy.capture_message.call_count == 2


async def test_unknown_source_and_bad_cause_page_as_unrecognised_never_dropped(
    chan,
):
    """An alert is never dropped because its name is unknown; but the value
    that reaches Sentry tags and the email route is always inside the closed
    contract, so the route cannot 400 it.
    """
    await ops_alert.page("some_future_source", "Has Spaces & Caps")
    await ops_alert._drain_ops_alert_tasks_for_tests()

    assert chan.tags() == [
        {
            "ops_alert_source": "unrecognised",
            "ops_alert_cause": "unrecognised",
            "ops_alert_event": "outage",
        }
    ]
    body = chan.http.posts[0]["json"]
    assert body["source"] == "unrecognised" and body["cause"] == "unrecognised"


async def test_the_capture_is_grouped_by_key_not_by_its_varying_text(chan):
    """The message carries since/detail, which differ per call. Without a
    stable fingerprint every page mints a NEW Sentry issue, and a frequency
    alert rule never sees the recurrence it exists to catch.
    """
    await _page(detail="first")
    chan.clock.advance(ops_alert.OPS_ALERT_WINDOW_S + 1)
    await _page(detail="second")

    fps = [sc.fingerprint for sc in chan.scopes]
    assert fps[0] == fps[1] == [
        "ops_alert", "mt5_jobs_terminal", "blind_run", "outage"
    ]


async def test_the_caller_does_not_wait_on_the_email_post(chan):
    """page() schedules the POST and returns: a slow Next.js route must never
    stall the heal or the monitor tick that is reporting an outage.
    """
    import asyncio

    release = asyncio.Event()
    original_post = chan.http.module.AsyncClient.post

    async def slow_post(self, url, **kw):
        await release.wait()
        return await original_post(self, url, **kw)

    chan.http.module.AsyncClient.post = slow_post

    await ops_alert.page("cron_sync", "stale_heartbeat")
    assert chan.http.posts == [], "page() returned while the POST is still in flight"

    release.set()
    await ops_alert._drain_ops_alert_tasks_for_tests()
    assert len(chan.http.posts) == 1


# ---------------------------------------------------------------------------
# Never raises
# ---------------------------------------------------------------------------


async def test_a_raising_sentry_capture_leaves_page_returning_and_still_emails(
    chan, caplog
):
    """A Sentry transport failure must not replace the outcome nor starve the
    other half of the channel.
    """
    chan.spy.capture_message.side_effect = RuntimeError("sentry transport down")

    with caplog.at_level("ERROR"):
        await ops_alert.page("cron_sync", "stale_heartbeat")  # returns, never raises
        await ops_alert._drain_ops_alert_tasks_for_tests()

    assert len(chan.http.posts) == 1
    assert any("exc_class=RuntimeError" in r.message for r in caplog.records)


async def test_a_raising_http_client_leaves_page_returning(chan, caplog):
    chan.http.raises = httpx.ConnectError("boom")

    with caplog.at_level("ERROR"):
        await ops_alert.page("cron_sync", "stale_heartbeat")  # returns, never raises
        await ops_alert._drain_ops_alert_tasks_for_tests()

    assert chan.spy.capture_message.call_count == 1
    assert any("exc_class=ConnectError" in r.message for r in caplog.records)


async def test_a_502_answer_is_logged_by_status_and_page_returns(chan, caplog):
    chan.http.status = 502

    with caplog.at_level("ERROR"):
        await ops_alert.page("cron_sync", "stale_heartbeat")  # returns, never raises
        await ops_alert._drain_ops_alert_tasks_for_tests()

    assert any("status=502" in r.message for r in caplog.records)


async def test_page_never_raises_even_when_its_own_machinery_fails(
    chan, monkeypatch
):
    """The outermost guard: whatever raises inside page(), the caller gets an
    outcome (not delivered) and never an exception."""

    def boom(*a: Any, **k: Any) -> None:
        raise RuntimeError("scheduler exploded")

    monkeypatch.setattr(ops_alert, "_schedule_founder_email", boom)
    chan.spy.capture_message.return_value = None
    delivery = await ops_alert.page("cron_sync", "stale_heartbeat")
    assert await ops_alert.await_delivery(delivery) is False


# ---------------------------------------------------------------------------
# Scrubbing (T-164.6.8-03, D-13)
# ---------------------------------------------------------------------------


def test_scrub_alert_detail_removes_digits_paths_and_configured_mt5_values(
    monkeypatch,
):
    """Alert text reaches Sentry and a founder inbox. An account number, a
    broker server name or a machine path in it is a leak into third parties.
    """
    monkeypatch.setenv("MT5_SERVER", "Broker-Demo12345")
    monkeypatch.setenv("MT5_LOGIN", "7777")
    hostile = (
        "login 123456789 failed on Broker-Demo12345 as 7777; "
        "C:\\Users\\x\\AppData\\terminal64.exe crashed, see /home/x/mt5/a.log"
    )

    out = ops_alert.scrub_alert_detail(hostile)

    for leaked in (
        "123456789",
        "Broker-Demo12345",
        "Demo12345",
        "7777",
        "C:\\Users",
        "AppData",
        "terminal64.exe",
        "/home/x/mt5",
        "a.log",
    ):
        assert leaked not in out, f"{leaked!r} survived the scrub: {out!r}"
    assert "<digits>" in out and "<path>" in out and "<redacted>" in out


def test_scrub_alert_detail_redacts_the_server_by_value_before_the_digit_pass(
    monkeypatch,
):
    """Order matters: if the digit pass ran first it would turn the server name
    into 'Broker-Demo<digits>', the by-value match would miss, and the name's
    prefix would leak.
    """
    monkeypatch.setenv("MT5_SERVER", "Broker-Demo12345")
    out = ops_alert.scrub_alert_detail("server Broker-Demo12345 refused")
    assert "Broker" not in out


def test_scrub_alert_detail_caps_length():
    assert len(ops_alert.scrub_alert_detail("a" * 5000)) == 2000


async def test_the_scrubbed_detail_is_what_reaches_sentry_and_the_post(chan):
    await _page(detail="account 987654321 at /srv/mt5/run/x.log")

    message = chan.spy.capture_message.call_args.args[0]
    body = chan.http.posts[0]["json"]
    for text in (message, body["detail"]):
        assert "987654321" not in text and "/srv/mt5" not in text


# ---------------------------------------------------------------------------
# The email POST target (T-164.6.8-02)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_url",
    [
        "http://evil.example",
        "https://x.example",
        "https://quantalyze.xyz:8443",
        "https://user@quantalyze.xyz",
        "https://quantalyze.xyz/path",
    ],
)
async def test_a_non_allow_listed_app_url_refuses_the_post_and_names_only_the_variable(
    chan, monkeypatch, caplog, bad_url
):
    """The Bearer key leaves the service on this POST. The destination is an
    allow-list in code, never an env value: an env that can name any host is a
    key-exfiltration switch. The refusal names the variable, never its value.
    """
    monkeypatch.setenv("OPS_ALERT_APP_URL", bad_url)

    with caplog.at_level("ERROR"):
        await _page()

    assert chan.http.posts == [], "the POST must not be attempted"
    assert chan.spy.capture_message.call_count == 1, "Sentry half is unaffected"
    rendered = " ".join(r.message for r in caplog.records)
    assert "OPS_ALERT_APP_URL" in rendered
    assert bad_url not in rendered and "evil" not in rendered


async def test_the_default_and_the_explicit_allow_listed_origin_are_accepted(
    chan, monkeypatch
):
    await _page()
    monkeypatch.setenv("OPS_ALERT_APP_URL", "https://quantalyze.xyz/")
    chan.clock.advance(ops_alert.OPS_ALERT_WINDOW_S + 1)
    await _page()

    assert [p["url"] for p in chan.http.posts] == [
        "https://quantalyze.xyz/api/cron/ops-alert"
    ] * 2


async def test_redirects_are_never_followed_and_a_3xx_is_a_logged_failure(
    chan, caplog
):
    """A followed redirect would carry the Bearer key to whatever host it
    names. follow_redirects=False must be set EXPLICITLY (httpx's default is
    also False, but an implicit default is one library change from a leak).
    """
    chan.http.status = 302

    with caplog.at_level("ERROR"):
        await _page()

    assert chan.http.client_kwargs[0]["follow_redirects"] is False
    assert len(chan.http.posts) == 1, "no second request after a 3xx"
    assert any("status=302" in r.message for r in caplog.records)


async def test_an_unset_service_key_skips_the_post_with_an_error(
    chan, monkeypatch, caplog
):
    monkeypatch.delenv("SERVICE_KEY", raising=False)

    with caplog.at_level("ERROR"):
        await _page()

    assert chan.http.posts == []
    assert any("SERVICE_KEY is unset" in r.message for r in caplog.records)


async def test_the_service_key_is_only_ever_in_the_authorization_header(
    chan, caplog
):
    """A key in a log line goes to a public log; a key in the body goes to the
    founder's inbox."""
    with caplog.at_level("DEBUG"):
        await _page(detail="detail text")
        chan.http.status = 500
        chan.clock.advance(ops_alert.OPS_ALERT_WINDOW_S + 1)
        await _page(detail="detail text")

    post = chan.http.posts[0]
    assert post["headers"] == {"Authorization": f"Bearer {CANARY_SERVICE_KEY}"}
    assert CANARY_SERVICE_KEY not in repr(post["json"])
    assert CANARY_SERVICE_KEY not in " ".join(r.getMessage() for r in caplog.records)
    assert CANARY_SERVICE_KEY not in repr(chan.spy.mock_calls)
    assert CANARY_SERVICE_KEY not in repr([sc.mock_calls for sc in chan.scopes])


def test_the_window_constant_is_one_hour_and_the_cadence_route_imports_it():
    """D-05: one literal. If cron.py spelled its own, the two could drift."""
    assert ops_alert.OPS_ALERT_WINDOW_S == 3600.0
    assert cron_mod._PROBER_CADENCE_ALERT_WINDOW_S is ops_alert.OPS_ALERT_WINDOW_S


# ---------------------------------------------------------------------------
# Review WR-R2-01 / SFH-N1 - the caller can learn whether a channel delivered
#
# WHY: a RECOVERED notice is one-shot. If the caller closes its durable record on
# the strength of "page() returned", a notice that reached no channel is lost for
# good. The outcome is the SAME `sentry_ok or email_ok` rule `_settle_window` uses.
# ---------------------------------------------------------------------------


async def _delivered(**over: Any) -> bool:
    kwargs: dict[str, Any] = {"event": "outage", "detail": "x"}
    kwargs.update(over)
    source = kwargs.pop("source", "mt5_jobs_terminal")
    cause = kwargs.pop("cause", "blind_run")
    delivery = await ops_alert.page(source, cause, **kwargs)
    return await ops_alert.await_delivery(delivery)


async def test_a_page_whose_email_was_accepted_reports_delivered(chan):
    chan.spy.capture_message.return_value = None
    assert await _delivered() is True


async def test_a_page_with_no_sentry_event_and_a_502_reports_not_delivered(chan):
    chan.spy.capture_message.return_value = None
    chan.http.status = 502
    assert await _delivered(event="recovered", cause="recovered_from_x") is False


async def test_a_page_with_no_sentry_event_and_a_401_reports_not_delivered(chan):
    chan.spy.capture_message.return_value = None
    chan.http.status = 401
    assert await _delivered() is False


async def test_a_sentry_event_alone_reports_delivered_even_when_the_email_fails(chan):
    # Since D-16 (under D-15) the same Sentry credit applies to a RECOVERED notice,
    # pinned by the D-16 tests below. Lineage: round 3 (WR-R3-01) had scoped this
    # credit to the OUTAGE event, because the live Sentry rule ("Ops alert: outage
    # (164.6.8)") filters ops_alert_event=outage.
    chan.http.status = 502
    assert await _delivered(event="outage") is True


async def test_d16_a_recovered_notice_with_a_sentry_event_id_is_credited_and_its_failing_email_is_tried_once(
    chan, caplog
):
    """D-16, under D-15. CONTEXT D-15: "Sentry is the only live paging channel for
    now." CONTEXT D-16: "a RECOVERED notice counts as delivered once its Sentry
    capture succeeds", so with the founder email unconfigured (here: 502 on every
    POST) a recovery is credited on its Sentry event id. The email is still attempted
    and still logs loud when it fails, but ONCE per window, not once per healthy
    reading: before D-16 each of these three pages reported False, released the
    window and sent another email, another Sentry warning and another ERROR.
    Lineage: review WR-R3-01 had pinned the opposite direction until the founder
    decided D-16 on 2026-10-14."""
    chan.spy.capture_message.return_value = "synthetic-event-id"
    chan.http.status = 502

    with caplog.at_level("ERROR", logger="quantalyze.analytics.ops_alert"):
        assert await _delivered(event="recovered", cause="recovered_from_x") is True
        assert await _delivered(event="recovered", cause="recovered_from_x") is True
        assert await _delivered(event="recovered", cause="recovered_from_x") is True
        await ops_alert._drain_ops_alert_tasks_for_tests()

    assert [p["json"]["event"] for p in chan.http.posts] == ["recovered"]
    assert chan.spy.capture_message.call_count == 1
    messages = [r.getMessage() for r in _error_records(caplog)]
    assert sum("founder email POST was not accepted" in m for m in messages) == 1
    assert sum("no channel delivered the page" in m for m in messages) == 0


async def test_a_recovered_notice_is_delivered_by_the_founder_email_alone(chan):
    chan.spy.capture_message.return_value = None
    chan.http.status = 200
    assert await _delivered(event="recovered", cause="recovered_from_x") is True


async def test_an_outage_taken_by_sentry_is_decided_without_waiting_on_the_email(
    chan, monkeypatch
):
    """Review R3-SFH-01. Sentry already took the OUTAGE, so the outcome is known the
    moment the capture returns: a caller must not sit behind a slow founder-email
    POST for a fact that is already decided (and then read a timeout as 'no channel').
    The POST here never answers; the wait is shortened so a wrong implementation fails
    fast with False rather than waiting out the real bound."""
    import asyncio

    monkeypatch.setattr(ops_alert, "_DELIVERY_WAIT_S", 0.5)
    release = asyncio.Event()
    original_post = chan.http.module.AsyncClient.post

    async def stuck_post(self, url, **kw):
        await release.wait()
        return await original_post(self, url, **kw)

    chan.http.module.AsyncClient.post = stuck_post
    chan.spy.capture_message.return_value = "event-id"

    delivery = await ops_alert.page("mt5_jobs_terminal", "blind_run", event="outage")

    assert delivery.done(), "the outcome was held back for the email POST"
    assert await ops_alert.await_delivery(delivery) is True
    release.set()
    await ops_alert._drain_ops_alert_tasks_for_tests()


async def test_d16_a_recovered_notice_taken_by_sentry_is_decided_without_waiting_on_the_email(
    chan, monkeypatch
):
    """D-16, under D-15. A recovered notice whose Sentry capture returned an event id
    is credited at capture time, exactly like an outage (CONTEXT D-16: "a RECOVERED
    notice counts as delivered once its Sentry capture succeeds"). The POST here never
    answers; the wait is shortened so a wrong implementation fails fast with False
    rather than waiting out the real bound. Lineage: review WR-R3-01 had held a
    recovered outcome open until the email answered."""
    import asyncio

    monkeypatch.setattr(ops_alert, "_DELIVERY_WAIT_S", 0.5)
    release = asyncio.Event()
    original_post = chan.http.module.AsyncClient.post

    async def slow_post(self, url, **kw):
        await release.wait()
        return await original_post(self, url, **kw)

    chan.http.module.AsyncClient.post = slow_post
    chan.spy.capture_message.return_value = "event-id"

    try:
        delivery = await ops_alert.page(
            "mt5_jobs_terminal", "recovered_from_x", event="recovered"
        )

        assert delivery.done(), "the outcome was held back for the email POST"
        assert await ops_alert.await_delivery(delivery) is True
    finally:
        release.set()
        await ops_alert._drain_ops_alert_tasks_for_tests()


async def test_a_recovered_notice_with_no_sentry_event_still_waits_for_the_founder_email(
    chan,
):
    """Without a Sentry event only the email can deliver a recovered notice, so its
    outcome stays open until the email answers rather than guessing."""
    import asyncio

    release = asyncio.Event()
    original_post = chan.http.module.AsyncClient.post

    async def slow_post(self, url, **kw):
        await release.wait()
        return await original_post(self, url, **kw)

    chan.http.module.AsyncClient.post = slow_post
    chan.spy.capture_message.return_value = None

    delivery = await ops_alert.page(
        "mt5_jobs_terminal", "recovered_from_x", event="recovered"
    )

    assert not delivery.done()
    release.set()
    assert await ops_alert.await_delivery(delivery) is True


@pytest.mark.parametrize("failure", ["no_event_id", "capture_raises"])
async def test_wr_r3_01_a_failed_sentry_capture_does_not_credit_a_recovered_notice(
    chan, caplog, failure
):
    """D-16 credits a SUCCESSFUL capture only. A capture that produced no event id,
    or raised, reached nobody, so the WR-R3-01 rule still holds for it: with the
    email also failing, the page reports not delivered, the window is released and
    the next healthy reading sends the notice again."""
    if failure == "no_event_id":
        chan.spy.capture_message.return_value = None
    else:
        chan.spy.capture_message.side_effect = RuntimeError("sdk down")
    chan.http.status = 502

    with caplog.at_level("ERROR", logger="quantalyze.analytics.ops_alert"):
        assert await _delivered(event="recovered", cause="recovered_from_x") is False
        assert await _delivered(event="recovered", cause="recovered_from_x") is False
        await ops_alert._drain_ops_alert_tasks_for_tests()

    assert [p["json"]["event"] for p in chan.http.posts] == ["recovered", "recovered"]
    messages = [r.getMessage() for r in _error_records(caplog)]
    assert sum("no channel delivered the page" in m for m in messages) == 2


async def test_the_founder_email_post_has_a_total_deadline(chan, monkeypatch):
    """Review R3-SFH-01 / WR-R3-03. httpx's timeout is per PHASE (connect, read,
    write, pool), so a slow route can hold one POST past any single number. The POST
    carries a TOTAL deadline, which is what makes `_DELIVERY_WAIT_S` a real bound
    rather than a hope. A client that never answers must come back False."""
    import asyncio

    monkeypatch.setattr(ops_alert, "_OPS_ALERT_TIMEOUT_S", 0.05)

    async def never_answers(self, url, **kw):
        await asyncio.sleep(30)

    chan.http.module.AsyncClient.post = never_answers

    ok = await asyncio.wait_for(
        ops_alert._post_founder_email({"source": "cron_sync"}), timeout=2.0
    )

    assert ok is False


async def test_an_unschedulable_email_reports_by_sentry_alone(chan, monkeypatch):
    def boom(_payload: Any) -> None:
        raise RuntimeError("no loop")

    monkeypatch.setattr(ops_alert, "_schedule_founder_email", boom)
    chan.spy.capture_message.return_value = None
    assert await _delivered() is False
    chan.spy.capture_message.return_value = "event-id"
    ops_alert._reset_ops_alert_for_tests()
    assert await _delivered() is True


async def test_a_suppressed_repeat_joins_the_outcome_of_the_page_holding_the_window(
    chan,
):
    """Two pages of one incident, the first still in flight and failing: the second
    is suppressed by the window but must NOT report delivered, or the caller of the
    second would close a record the first page never delivered."""
    chan.spy.capture_message.return_value = None
    chan.http.status = 502
    first = await ops_alert.page("mt5_jobs_terminal", "blind_run", event="outage")
    second = await ops_alert.page("mt5_jobs_terminal", "blind_run", event="outage")

    assert await ops_alert.await_delivery(first) is False
    assert await ops_alert.await_delivery(second) is False
    assert len(chan.http.posts) == 1


async def test_a_suppressed_repeat_of_a_delivered_page_reports_delivered(chan):
    chan.spy.capture_message.return_value = None
    assert await _delivered() is True
    assert await _delivered() is True
    assert len(chan.http.posts) == 1


async def test_a_page_that_fails_inside_reports_not_delivered_and_never_raises(
    chan, monkeypatch
):
    def boom(*a: Any, **k: Any) -> None:
        raise RuntimeError("normaliser exploded")

    monkeypatch.setattr(ops_alert, "_normalise_source", boom)
    delivery = await ops_alert.page("cron_sync", "stale_heartbeat")
    assert await ops_alert.await_delivery(delivery) is False


async def test_await_delivery_treats_a_non_future_as_not_delivered():
    assert await ops_alert.await_delivery(None) is False


async def test_await_delivery_gives_up_after_its_bound_without_cancelling_the_page(
    monkeypatch,
):
    """A wait that times out is 'not delivered YET': the outcome future stays
    alive for a later waiter, so a slow email can still settle."""
    import asyncio

    monkeypatch.setattr(ops_alert, "_DELIVERY_WAIT_S", 0.01)
    pending: asyncio.Future[bool] = asyncio.get_running_loop().create_future()

    assert await ops_alert.await_delivery(pending) is False
    assert not pending.cancelled() and not pending.done()
    pending.set_result(True)
    assert await ops_alert.await_delivery(pending) is True
