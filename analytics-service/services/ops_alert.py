"""The ONE ops-alert channel (Phase 164.6.8 OUTAGEALERT, plan 01, decision D-01).

``page`` is how an outage reaches a human without anyone clicking a button. One
call does three things, in this order:

1. ``logger.error`` on EVERY call (the floor that always exists; the RATE of
   these lines is itself evidence);
2. at most one tagged Sentry capture per ``(source, cause, event)`` per
   ``OPS_ALERT_WINDOW_S`` (D-05) -- an unbounded capture becomes a flood that
   gets muted, which is indistinguishable from no signal at all. A RECOVERY ends
   the incident and clears its source's outage windows (``_admit_through_window``),
   so an outage that re-opens inside the hour pages again. The window is stamped
   before delivery (concurrent pages cannot both send) and RELEASED when neither
   channel succeeded (the email failed and Sentry produced no event id), so the
   next reading retries instead of waiting out the hour. A page counts as
   delivered when Sentry returns an event id, for an outage and a recovered notice
   alike (D-16, under D-15: Sentry is the only live paging channel for now), or when
   the email answers 2xx. A caller that must act on the outcome (the RECOVERED
   notice is one-shot: the caller closes its durable record only once a channel has
   the notice) awaits ``page``'s return value through ``await_delivery``;
3. one authenticated POST to the Next.js ``/api/cron/ops-alert`` route, which
   emails the founder through ``notifyFounderGeneric``. The POST runs as a held
   background task so the caller never waits on HTTP.

⛔ NEVER RAISES. An alert path that raises into the heal, the monitor tick or
the cadence route turns "an outage was reported" into "a second outage". The
whole body of ``page`` sits in one ``except Exception`` whose handler is itself
one nested argument-free ``try``, the shape ``record_mt5_session_reading``
carries. ``except BaseException`` never wraps an ``await`` here: that would
swallow ``asyncio.CancelledError`` and hang lifespan shutdown.

⚠️ DELIVERY IS NOT GUARANTEED BY THIS MODULE. A Sentry capture reaches a human
only when ``SENTRY_DSN`` is set AND a Sentry alert rule turns it into a
notification (recorded by the founder, plan 01 Task 3). The email half needs
``SERVICE_KEY``, ``ADMIN_EMAIL`` and Resend on the Next.js side. Whether the
alarm watches its own delivery (``PROBER-ALERT-DELIVERY-UNVERIFIED-01``) is out
of scope (D-03); nothing here claims to close it.

⛔ The source set, the event set and the cause charset are defined ONCE per
language: here, and in ``src/lib/ops-alert-contract.ts``. A parity test fails
when they disagree, because a source added on one side only makes the route
400 that source's emails.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Final
from urllib.parse import urlsplit

import httpx
import sentry_sdk

from services.redact import scrub_freeform_string

logger = logging.getLogger("quantalyze.analytics.ops_alert")

# --------------------------------------------------------------------------- #
# The contract (mirrored in src/lib/ops-alert-contract.ts)
# --------------------------------------------------------------------------- #

#: Closed source set. ``drill`` is plan 09's live arrival test, so a drill is
#: never mistaken for an outage. ``unrecognised`` carries any value outside the
#: set: an alert is never dropped because its name is unknown.
OPS_ALERT_SOURCES: Final = frozenset(
    {
        "mt5_jobs_terminal",
        "mt5_validation_terminal",
        "mt5_terminal_scrub",
        "mt5_relaunch_debt",
        "cron_sync",
        "backfill",
        "prod_prober",
        "drill",
        "unrecognised",
    }
)
OPS_ALERT_EVENTS: Final = frozenset({"outage", "recovered"})
#: The cause charset, as a pattern string for ``re.fullmatch``.
OPS_ALERT_CAUSE_RE: Final = "[a-z0-9_:.-]{1,64}"

_UNRECOGNISED: Final = "unrecognised"

#: Bounds how often a SUSTAINED outage re-pages while it stays open (D-05).
#: ``routers/cron.py`` imports this rather than spelling a second literal.
OPS_ALERT_WINDOW_S: Final = 3600.0

_OPS_ALERT_DETAIL_MAX: Final = 2000
_OPS_ALERT_TAG_MAX: Final = 200
#: The TOTAL deadline of one email POST (``asyncio.wait_for`` around the whole
#: request), and also the per-phase ``timeout=`` handed to httpx. httpx's own timeout
#: is per PHASE (connect, read, write, pool), so on its own one POST could run to a
#: multiple of it; the total deadline is what makes the bound below real.
_OPS_ALERT_TIMEOUT_S: Final = 10.0
#: How long ``await_delivery`` waits for the outcome of a page. The email POST is
#: bounded in TOTAL by ``_OPS_ALERT_TIMEOUT_S``, so this is that bound plus slack and
#: it cannot run out before an answer that is coming; a wait that does run out answers
#: "not delivered yet", which is the safe direction for a caller deciding whether to
#: close a record.
_DELIVERY_WAIT_S: Final = _OPS_ALERT_TIMEOUT_S + 5.0
_OPS_ALERT_DEFAULT_APP_URL: Final = "https://quantalyze.xyz"
#: The only hosts the Bearer-carrying POST may reach. Extend in code, by review,
#: never by env: an env-extensible allow-list is no allow-list.
_OPS_ALERT_ALLOWED_HOSTS: Final = frozenset({"quantalyze.xyz"})
_OPS_ALERT_APP_URL_ENV: Final = "OPS_ALERT_APP_URL"
_OPS_ALERT_PATH: Final = "/api/cron/ops-alert"

_CAUSE_RE = re.compile(OPS_ALERT_CAUSE_RE)

# Process-local, lock-free: every writer runs on the event loop thread.
_last_alert_at: dict[tuple[str, str, str], float] = {}
#: The delivery outcome of the page that holds each window key, so a SUPPRESSED
#: repeat can report the holder's outcome instead of a guess (review WR-R2-01).
_delivery_by_key: dict[tuple[str, str, str], "asyncio.Future[bool]"] = {}
#: Strong references to the running email tasks (CPython holds only a weak one).
_OPS_ALERT_TASKS: set[asyncio.Task[bool]] = set()


def _reset_ops_alert_for_tests() -> None:
    """Test-only: forget the window and the task set."""
    _last_alert_at.clear()
    _delivery_by_key.clear()
    _OPS_ALERT_TASKS.clear()


async def _drain_ops_alert_tasks_for_tests() -> None:
    """Test-only: wait for every scheduled email POST to finish."""
    pending = list(_OPS_ALERT_TASKS)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


# --------------------------------------------------------------------------- #
# Scrubbing (D-13: plan 04 reuses this for MT5 wedge evidence)
# --------------------------------------------------------------------------- #

_DIGIT_RUN_RE = re.compile(r"\d{5,}")
_WINDOWS_PATH_RE = re.compile(r"[A-Za-z]:[\\/][^\s'\"]*")
_POSIX_PATH_RE = re.compile(r"/[^\s/'\"]+(?:/[^\s/'\"]+)+")


def scrub_alert_detail(text: str) -> str:
    """Make free text safe to leave the service in an alert.

    Order matters. The configured ``MT5_SERVER`` and ``MT5_LOGIN`` values are
    replaced BY VALUE first: if the digit pass ran first, a server name such as
    ``Broker-Demo12345`` would be mangled to ``Broker-Demo<digits>``, the
    by-value match would then miss it, and the name's prefix would leak.
    Then ``scrub_freeform_string`` (credentials, JWTs, URL userinfo), then every
    run of five or more digits (account numbers), then Windows and POSIX
    machine paths. Capped at 2000 characters.
    """
    out = text if isinstance(text, str) else str(text)
    for env_name in ("MT5_SERVER", "MT5_LOGIN"):
        value = os.environ.get(env_name, "").strip()
        if value:
            out = out.replace(value, "<redacted>")
    scrubbed = scrub_freeform_string(out)
    out = scrubbed if isinstance(scrubbed, str) else str(scrubbed)
    out = _DIGIT_RUN_RE.sub("<digits>", out)
    out = _WINDOWS_PATH_RE.sub("<path>", out)
    out = _POSIX_PATH_RE.sub("<path>", out)
    return out[:_OPS_ALERT_DETAIL_MAX]


# --------------------------------------------------------------------------- #
# Normalisation
# --------------------------------------------------------------------------- #


def _normalise_source(source: str) -> str:
    return source if source in OPS_ALERT_SOURCES else _UNRECOGNISED


def _normalise_cause(cause: str) -> str:
    return cause if _CAUSE_RE.fullmatch(cause) else _UNRECOGNISED


def _normalise_event(event: str) -> str:
    # An unknown event is treated as an outage: never drop an alert, and never
    # let an unknown word downgrade it to a recovery.
    return event if event in OPS_ALERT_EVENTS else "outage"


# --------------------------------------------------------------------------- #
# The email half
# --------------------------------------------------------------------------- #


def _resolve_ops_alert_url() -> str | None:
    """The POST target, or None (with one ERROR line) when it is not acceptable.

    The value must be ``https``, carry no userinfo, port, path, query or
    fragment, and name a host in ``_OPS_ALERT_ALLOWED_HOSTS``. Read per call,
    never at import. The refusal names the VARIABLE and never its value.
    """
    raw = os.environ.get(_OPS_ALERT_APP_URL_ENV) or _OPS_ALERT_DEFAULT_APP_URL
    try:
        parts = urlsplit(raw.strip())
        hostname = parts.hostname
        port = parts.port
    except ValueError:
        hostname, port, parts = None, None, urlsplit("")
    acceptable = (
        parts.scheme == "https"
        and hostname is not None
        and hostname in _OPS_ALERT_ALLOWED_HOSTS
        # netloc equal to the bare hostname rejects userinfo, a port and any
        # parser oddity in one comparison.
        and parts.netloc.lower() == hostname
        and port is None
        and parts.path in ("", "/")
        and not parts.query
        and not parts.fragment
    )
    if not acceptable:
        logger.error(
            "ops_alert: %s is not an allow-listed https origin; the founder "
            "email POST is refused (the Sentry capture and this log line are "
            "unaffected)",
            _OPS_ALERT_APP_URL_ENV,
        )
        return None
    return f"https://{hostname}{_OPS_ALERT_PATH}"


async def _post_founder_email(payload: dict[str, str | None]) -> bool:
    """POST one alert to the Next.js route. Never raises, logs class/status only.

    True only when the route answered 2xx: the answer ``page`` needs to decide
    whether a page that also got no Sentry event reached anybody (review SFH-F2).
    """
    try:
        url = _resolve_ops_alert_url()
        if url is None:
            return False
        service_key = os.environ.get("SERVICE_KEY", "")
        if not service_key:
            logger.error(
                "ops_alert: SERVICE_KEY is unset; the founder email POST is "
                "skipped"
            )
            return False
        # follow_redirects=False is set EXPLICITLY: a 3xx is a failure, never
        # followed, because a redirect would carry the Bearer key to whatever
        # host it names.
        async def _post() -> Any:
            async with httpx.AsyncClient(
                timeout=_OPS_ALERT_TIMEOUT_S, follow_redirects=False
            ) as client:
                return await client.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {service_key}"},
                )

        response = await asyncio.wait_for(_post(), timeout=_OPS_ALERT_TIMEOUT_S)
        if not 200 <= response.status_code < 300:
            logger.error(
                "ops_alert: the founder email POST was not accepted "
                "(status=%s)",
                response.status_code,
            )
            return False
        return True
    except Exception as exc:  # noqa: BLE001 - an alert must never raise
        try:
            logger.error(
                "ops_alert: the founder email POST failed (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            pass
    return False


def _schedule_founder_email(payload: dict[str, str | None]) -> asyncio.Task[bool]:
    loop = asyncio.get_running_loop()
    task = loop.create_task(_post_founder_email(payload))
    _OPS_ALERT_TASKS.add(task)
    task.add_done_callback(_OPS_ALERT_TASKS.discard)
    return task


# --------------------------------------------------------------------------- #
# The window: per (source, cause, event) while an incident is open, and an
# INCIDENT BOUNDARY on every recovery (review SFH-F1 / WR-02)
# --------------------------------------------------------------------------- #


def _drop_window_entries(source: str, event: str) -> None:
    for stale in [k for k in _last_alert_at if k[0] == source and k[2] == event]:
        del _last_alert_at[stale]


def _admit_through_window(
    source: str, key: tuple[str, str, str], now: float
) -> tuple[bool, tuple[str, str, str] | None]:
    """``(True, None)`` when this page may reach Sentry and the email (and the
    window is stamped); ``(False, holder_key)`` when it is suppressed, naming the
    window key whose page is the one that holds the incident.

    The hourly window (D-05) bounds a SUSTAINED incident. A recovery ends the
    incident, and the window has to know that, or two things go wrong:

    * an outage that re-opens inside the hour is dropped, and the founder's last
      message says RECOVERED while the system is down. So a recovery CLEARS every
      outage entry of its source, whether or not the notice itself is sent (the
      source reported healthy; what it was last paged for is no longer open);
    * a recovery would page once per cause. So a recovery is admitted at most once
      per incident: while a recovery of this source is inside the window it is
      suppressed whatever cause it names, and only an outage that actually PAGES
      (a new incident) re-arms recovery by clearing the source's recovery entries.
      A suppressed repeat reading of the open incident re-arms nothing.
    """
    event = key[2]
    if event == "recovered":
        _drop_window_entries(source, "outage")
        for k, at in _last_alert_at.items():
            if k[0] == source and k[2] == "recovered" and (now - at) < OPS_ALERT_WINDOW_S:
                return False, k
    else:
        last = _last_alert_at.get(key)
        if last is not None and (now - last) < OPS_ALERT_WINDOW_S:
            return False, key
        _drop_window_entries(source, "recovered")
    _last_alert_at[key] = now
    return True, None


def _release_window(key: tuple[str, str, str], stamp: float) -> None:
    """Free the window ``stamp`` spent, unless a newer page has stamped it since."""
    if _last_alert_at.get(key) == stamp:
        del _last_alert_at[key]
        _delivery_by_key.pop(key, None)


def _settle_window(
    key: tuple[str, str, str],
    stamp: float,
    sentry_counts: bool,
    delivered: "asyncio.Future[bool]",
    task: "asyncio.Task[bool]",
) -> None:
    """Done-callback of the email task: spend the window only if a channel got it,
    and publish the outcome to whoever awaits ``page``'s return value.

    The window is stamped BEFORE delivery so two concurrent pages cannot both
    send. If neither channel succeeded (the email failed AND Sentry returned no
    event id) the stamp is released, so the next reading retries instead of the
    outage staying unreported for the rest of the hour (review SFH-F2). Logged at
    ERROR: that is the level the Sentry LoggingIntegration reports.

    The outcome is ``sentry_counts or email_ok``, the one rule for "a channel has
    it". ``sentry_counts`` is a Sentry event id for either event since D-16 (under
    D-15). Lineage: review WR-R3-01 had credited a recovered event to the email
    alone.
    An outcome that cannot be determined is "not delivered": a caller then keeps
    its record and the notice is sent again, never lost (review WR-R2-01).
    """
    outcome = False
    try:
        email_ok = (
            not task.cancelled()
            and task.exception() is None
            and task.result() is True
        )
        outcome = email_ok or sentry_counts
        if outcome:
            return
        _release_window(key, stamp)
        logger.error(
            "ops_alert: no channel delivered the page (the founder email failed "
            "and Sentry returned no event id); the window is "
            "not spent and the next reading retries (source=%s event=%s "
            "cause=%s)",
            key[0],
            key[2],
            key[1],
        )
    except Exception as exc:  # noqa: BLE001 - an alert must never raise
        try:
            logger.error(
                "ops_alert: the delivery check failed (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            pass
    finally:
        if not delivered.done():
            delivered.set_result(outcome)


async def await_delivery(delivery: object) -> bool:
    """True when the page behind ``delivery`` reached a channel. Never raises.

    ``delivery`` is what ``page`` returned. Anything else (a stub, ``None``), a
    cancelled outcome, a wait that runs out and any failure answer False: "not
    delivered" is the safe direction for a caller deciding whether to close a
    durable record, because it keeps the record and the notice is sent again.

    The outcome future is SHIELDED: a waiter that gives up or is cancelled does not
    cancel the page's own settlement, so a slow email can still settle for a later
    waiter. ``asyncio.CancelledError`` of the WAITER is not caught here.
    """
    if not isinstance(delivery, asyncio.Future) or delivery.cancelled():
        return False
    try:
        outcome = await asyncio.wait_for(
            asyncio.shield(delivery), timeout=_DELIVERY_WAIT_S
        )
    except Exception:  # noqa: BLE001 - a timeout or a broken future is "not yet"
        return False
    return outcome is True


# --------------------------------------------------------------------------- #
# The page
# --------------------------------------------------------------------------- #


async def page(
    source: str,
    cause: str,
    *,
    event: str = "outage",
    since: datetime | None = None,
    detail: str = "",
    extra_tags: dict[str, str] | None = None,
) -> "asyncio.Future[bool]":
    """Page a human about ``source``. Never raises. See the module docstring.

    Returns the page's delivery OUTCOME, a future that resolves True when a channel
    has the page (a Sentry event id for an outage or a recovered notice alike, D-16
    under D-15, or a 2xx from the founder email) and False when none does. Lineage:
    review WR-R3-01 had credited a recovered notice to the email alone. The live
    Sentry rule "Ops alert: outage (164.6.8)" notifies on ``ops_alert_event=outage``
    and, since 2026-10-15 (founder), on ``recovered`` too. A page suppressed by the
    window returns the outcome of the page that holds the window. Most callers
    ignore it; a RECOVERED notice is one-shot, so its callers pass it to
    ``await_delivery`` before they close a durable record (review WR-R2-01).

    ``extra_tags`` lets a caller keep a tag its own dashboards already use (the
    cadence route keeps ``prober_cadence_alert``); it is applied inside the
    capture's own scope, never globally.
    """
    delivered: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
    try:
        source_n = _normalise_source(source)
        cause_n = _normalise_cause(cause)
        event_n = _normalise_event(event)
        since_iso = since.isoformat() if since is not None else None
        detail_n = scrub_alert_detail(detail)

        # The floor that always exists. A recovery is not an error.
        logger.log(
            logging.ERROR if event_n == "outage" else logging.WARNING,
            "ops_alert: source=%s event=%s cause=%s since=%s",
            source_n,
            event_n,
            cause_n,
            since_iso or "unknown",
        )

        key = (source_n, cause_n, event_n)
        now = time.monotonic()
        admitted, holder = _admit_through_window(source_n, key, now)
        if not admitted:
            held = _delivery_by_key.get(holder) if holder is not None else None
            if held is not None:
                return held
            # No page in flight holds this window: an earlier page of the incident
            # went out and settled, so the incident has been reported.
            delivered.set_result(True)
            return delivered
        _delivery_by_key[key] = delivered

        sentry_ok = False
        try:
            # A scoped capture: an unscoped ``set_tag`` would label every later
            # event this process sends (review WR-03 on the scrub alert).
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("ops_alert_source", source_n)
                scope.set_tag("ops_alert_cause", cause_n)
                scope.set_tag("ops_alert_event", event_n)
                for tag, value in (extra_tags or {}).items():
                    scope.set_tag(tag, str(value)[:_OPS_ALERT_TAG_MAX])
                # One issue per (source, cause, event): the detail and the
                # since-stamp vary per call and must not mint a new issue each
                # time, or a frequency rule never sees the recurrence.
                scope.fingerprint = ["ops_alert", source_n, cause_n, event_n]
                event_id = sentry_sdk.capture_message(
                    f"ops alert [{event_n}] source={source_n} cause={cause_n} "
                    f"since={since_iso or 'unknown'} detail={detail_n}",
                    level="error" if event_n == "outage" else "warning",
                )
                # ``None`` is the SDK's own answer for "nothing was sent": no
                # DSN, or ``before_send`` dropped the event.
                sentry_ok = event_id is not None
        except Exception as exc:  # noqa: BLE001 - never mask the path reported on
            logger.error(
                "ops_alert: the Sentry capture failed (exc_class=%s)",
                type(exc).__name__,
            )

        # D-16, under D-15: a Sentry event id credits the page for BOTH events. CONTEXT
        # D-15 makes Sentry the only live paging channel for now, and D-16 (founder,
        # 2026-10-14, "Credit recovery via Sentry") says a RECOVERED notice counts as
        # delivered once its Sentry capture succeeds. The email is still scheduled
        # below for every admitted page, so it goes out whenever Resend is configured.
        # Lineage: review WR-R3-01 had credited a recovered notice to the founder email
        # alone, because the live Sentry rule ("Ops alert: outage (164.6.8)") filters
        # ops_alert_event=outage and a recovered capture is a warning-level event no
        # rule fires on. With the email unconfigured that retried every healthy
        # reading for ever, which is what D-16 stops.
        # 2026-10-15 (founder): that rule now has a second action group on
        # ops_alert_event=recovered, so a credited recovered capture notifies the
        # founder the way an outage does. A FAILED capture (no event id, or a raise) is not
        # credited: sentry_ok stays False and WR-R3-01's retry still holds for it.
        sentry_counts = sentry_ok
        if sentry_counts:
            # Decided: a channel already has this page, whatever the email does.
            # Resolve now so a caller waiting on the outcome is not held behind the
            # email POST for a fact it already knows (review R3-SFH-01).
            delivered.set_result(True)

        try:
            email_task = _schedule_founder_email(
                {
                    "source": source_n,
                    "event": event_n,
                    "cause": cause_n,
                    "since": since_iso,
                    "detected_at": datetime.now(timezone.utc).isoformat(),
                    "detail": detail_n,
                }
            )
        except Exception:
            # No email task could even be created: if Sentry did not take the
            # page either, nothing was delivered, so do not spend the window.
            if not sentry_counts:
                _release_window(key, now)
            if not delivered.done():
                delivered.set_result(False)
            raise
        if isinstance(email_task, asyncio.Task):
            email_task.add_done_callback(
                functools.partial(_settle_window, key, now, sentry_counts, delivered)
            )
        elif not delivered.done():
            delivered.set_result(False)
    except Exception as exc:  # noqa: BLE001 - an alert must never replace the outcome
        try:
            logger.error(
                "ops_alert: page failed (exc_class=%s)", type(exc).__name__
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            pass
        # Whatever failed, the caller still gets an outcome: not delivered, unless
        # the failure came after a channel had already taken the page.
        if not delivered.done():
            delivered.set_result(False)
    return delivered
