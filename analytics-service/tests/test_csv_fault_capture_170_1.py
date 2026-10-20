"""170.1 / D-14 (SFH-L1): an internal fault in the CSV path is LOCATABLE and
still never carries a cell.

The defect (review of 244deddcd / 5fdd4e979, finding SFH-L1): the `except
Exception` arms in `routers/csv.py` and `services/ingestion/csv_adapter.py`
logged only `type(e).__name__`. That closed the cell leak and also threw away the
traceback, so an internal fault (a pandas change, a new input shape) could not be
located from the log or from Sentry.

What is pinned here, for the router, the adapter and the shared helper:

  * the log line carries the exception TYPE and the INNERMOST FRAME (file, line,
    function) and never the exception text;
  * the fault is captured to Sentry through the scoped `capture_exception` and
    the existing `_redact_before_send`; the event still carries the frame
    location and its exception TYPE, and no part of it carries a cell;
  * the route's `HTTPException` is raised `from None`, so Sentry's own capture of
    that 500 does not walk into the chained exception text.

Why the event is checked AFTER `_redact_before_send`: that hook scrubs credential
SHAPES and denylisted KEYS. It does not know what a cell is, so on its own it
passes an exception value such as `could not convert string to float: 'ZXQCELL'`
through untouched. The capture therefore withholds exception text, frame locals
and the request body itself (see `services/csv_fault.py`); these tests prove the
combination, not the hook alone.

Every cell value is a synthetic marker (`ZXQCELL`). No real data.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import sentry_sdk
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from sentry_init import _redact_before_send

MARKER = "ZXQCELL"
THIS_FILE = "test_csv_fault_capture_170_1.py"
CSV_BYTES = b"date,daily_return\n2024-01-01,0.01\n2024-01-02,0.02\n"

# The sentence the log line must NOT carry, and the shape it must.
LOCATION_RE = re.compile(r"ValueError at \S*" + re.escape(THIS_FILE) + r":\d+ in _explode")


def _explode(_raw: bytes, _fmt: str):
    """The raising function. It holds the marker in BOTH its exception text and a
    local variable, the two places a cell can reach an event from."""
    cell = MARKER  # noqa: F841 - a frame local, on purpose
    raise ValueError(f"could not convert string to float: '{MARKER}'")


@pytest.fixture
def sentry_events():
    """A real Sentry client whose `before_send` is the production hook
    (`_redact_before_send`) followed by a recorder, so each recorded event is
    exactly what would have left the process. Frame locals are ON: the production
    init turns them off, and the test must not rely on that."""
    events: list[dict[str, Any]] = []

    def record(event, hint):
        events.append(_redact_before_send(event, hint))
        return None  # drop: nothing is sent

    sentry_sdk.init(
        dsn="https://public@example.invalid/1",
        before_send=record,
        include_local_variables=True,
        send_default_pii=False,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.0,
    )
    try:
        yield events
    finally:
        sentry_sdk.get_client().close()
        sentry_sdk.init()  # back to the no-DSN default for the rest of the suite


def _dump(events: list[dict[str, Any]]) -> str:
    return json.dumps(events, default=str)


def _innermost_frame(event: dict[str, Any]) -> dict[str, Any]:
    return event["exception"]["values"][-1]["stacktrace"]["frames"][-1]


# ---------------------------------------------------------------------------
# The shared helper
# ---------------------------------------------------------------------------


def test_helper_returns_type_and_innermost_frame_and_captures_a_cell_free_event(
    sentry_events: list[dict[str, Any]],
) -> None:
    from services.csv_fault import report_csv_internal_fault

    try:
        _explode(b"", "daily_returns")
    except Exception as exc:
        where = report_csv_internal_fault(exc)

    # The log fragment: type and location, never the text.
    assert LOCATION_RE.fullmatch(where), where
    assert MARKER not in where

    ours = [e for e in sentry_events if e.get("exception")]
    assert len(ours) == 1, sentry_events
    event = ours[0]
    # Still useful: the exception TYPE and the innermost frame survive.
    assert event["exception"]["values"][-1]["type"] == "ValueError"
    frame = _innermost_frame(event)
    assert frame["function"] == "_explode"
    assert frame["filename"].endswith(THIS_FILE)
    assert isinstance(frame["lineno"], int)
    # And no cell anywhere in it: not the text, not the frame local.
    assert MARKER not in _dump(sentry_events)


def test_helper_never_raises_when_sentry_is_not_configured() -> None:
    """No DSN (every test and local run): the capture is a no-op, the location
    is still returned."""
    from services.csv_fault import report_csv_internal_fault

    try:
        _explode(b"", "daily_returns")
    except Exception as exc:
        where = report_csv_internal_fault(exc)

    assert LOCATION_RE.fullmatch(where), where


def test_helper_handles_an_exception_that_was_never_raised() -> None:
    """No traceback to read: the type is still reported, nothing raises."""
    from services.csv_fault import report_csv_internal_fault

    where = report_csv_internal_fault(ValueError(MARKER))

    assert where.startswith("ValueError")
    assert MARKER not in where


def test_redaction_hook_redacts_the_csv_upload_body_for_every_event_not_only_ours() -> None:
    """The scoped capture withholds the request body for its own event. Any OTHER
    event raised during a `/process-key` request (an uncaught error further down
    the pipeline, a log event) carries the same body, and `_redact_before_send`
    scrubs by key. `raw_bytes_base64` and the legacy `raw_bytes` are the upload
    itself, so they are denylisted keys."""
    event = {
        "request": {
            "data": {
                "flow_type": "csv",
                "context": {"fmt": "daily_returns", "raw_bytes_base64": "ZGF0ZQ==", "raw_bytes": "date"},
            }
        },
        "extra": {"context": {"raw_bytes_base64": "ZGF0ZQ=="}},
    }

    out = _redact_before_send(event, None)

    context = out["request"]["data"]["context"]
    assert context["raw_bytes_base64"] == "[REDACTED]"
    assert context["raw_bytes"] == "[REDACTED]"
    assert out["extra"]["context"]["raw_bytes_base64"] == "[REDACTED]"
    assert context["fmt"] == "daily_returns"  # the scrub is by key, not wholesale


# ---------------------------------------------------------------------------
# routers/csv.py
# ---------------------------------------------------------------------------


@pytest.fixture
def csv_client():
    import routers.csv as csv_router

    app = FastAPI()
    app.state.limiter = csv_router.limiter
    app.include_router(csv_router.router)
    return TestClient(app, raise_server_exceptions=False)


def _post_csv(client: TestClient):
    return client.post(
        "/api/csv/validate",
        files={"file": ("upload.csv", CSV_BYTES, "text/csv")},
        data={"fmt": "daily_returns", "wizard_session_id": "wiz-170-1"},
    )


def test_route_log_and_sentry_carry_the_frame_and_never_the_cell(
    csv_client: TestClient,
    sentry_events: list[dict[str, Any]],
    caplog: pytest.LogCaptureFixture,
) -> None:
    with patch("routers.csv.validate_csv", _explode), caplog.at_level(logging.DEBUG):
        resp = _post_csv(csv_client)

    assert resp.status_code == 500
    assert resp.json()["detail"]["code"] == "CSV_UPSTREAM_FAIL"
    assert MARKER not in resp.text
    # The log: type AND innermost frame, no text.
    assert LOCATION_RE.search(caplog.text), caplog.text
    assert MARKER not in caplog.text
    # Sentry: at least one event, located, and no cell in ANY recorded event
    # (the scoped capture, the integration's capture of the 500, the log event).
    located = [
        e for e in sentry_events
        if e.get("exception") and _innermost_frame(e)["function"] == "_explode"
    ]
    assert located, _dump(sentry_events)
    assert MARKER not in _dump(sentry_events)
    # One Sentry issue for one fault: the log line is on an ignored logger, so it
    # is not ALSO sent as a log event beside the exception event.
    assert [e for e in sentry_events if e.get("logger") == "quantalyze.analytics.csv_fault"] == []


def test_route_500_is_raised_from_none_so_its_own_capture_has_no_chained_text(
    csv_client: TestClient,
    sentry_events: list[dict[str, Any]],
) -> None:
    """Starlette's integration captures an HTTPException with a 500 status. With
    the implicit `__context__` still attached, the SDK walks into the
    ValueError and ships its text (measured: the inner value was present in the
    event). `raise ... from None` sets `__suppress_context__`, which the SDK
    honours, so that event holds the HTTPException alone."""
    with patch("routers.csv.validate_csv", _explode):
        _post_csv(csv_client)

    http_events = [
        e for e in sentry_events
        if e.get("exception")
        and any(v.get("type") == "HTTPException" for v in e["exception"]["values"])
    ]
    for event in http_events:
        assert [v["type"] for v in event["exception"]["values"]] == ["HTTPException"]
    assert MARKER not in _dump(sentry_events)


def test_route_http_exception_is_not_chained() -> None:
    """The same fact, read off the exception object without a Sentry client."""
    import asyncio

    import routers.csv as csv_router
    from fastapi import HTTPException

    class _Upload:
        async def read(self, _n: int) -> bytes:
            return b""

    fn = csv_router.csv_validate
    inner = getattr(fn, "__wrapped__", fn)
    with patch("routers.csv.validate_csv", _explode), patch(
        "routers.csv._read_capped", return_value=_async_value(CSV_BYTES)
    ):
        with pytest.raises(HTTPException) as caught:
            asyncio.run(inner(MagicMock(), _Upload(), "daily_returns", "wiz-170-1"))

    assert caught.value.status_code == 500
    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__ is True


async def _async_value(value):
    return value


# ---------------------------------------------------------------------------
# services/ingestion/csv_adapter.py
# ---------------------------------------------------------------------------


def _adapter_request(raw: bytes, fmt: str = "daily_returns"):
    from services.ingestion.adapter import KeySubmissionRequest

    return KeySubmissionRequest(
        flow_type="csv",
        source="csv",
        context={
            "raw_bytes": raw,
            "fmt": fmt,
            "wizard_session_id": "wiz-170-1",
            "user_id": "user-170-1",
        },
    )


async def test_adapter_log_and_sentry_carry_the_frame_and_never_the_cell(
    sentry_events: list[dict[str, Any]], caplog: pytest.LogCaptureFixture
) -> None:
    from services import csv_validator
    from services.ingestion.csv_adapter import CsvAdapter

    with patch.object(csv_validator, "validate_csv", _explode), caplog.at_level(logging.DEBUG):
        result = await CsvAdapter().validate(_adapter_request(CSV_BYTES))

    assert result.valid is False
    assert result.error_code == "CSV_UPSTREAM_FAIL"
    assert MARKER not in repr(result)
    assert LOCATION_RE.search(caplog.text), caplog.text
    assert MARKER not in caplog.text
    located = [
        e for e in sentry_events
        if e.get("exception") and _innermost_frame(e)["function"] == "_explode"
    ]
    assert located, _dump(sentry_events)
    assert MARKER not in _dump(sentry_events)


# ---------------------------------------------------------------------------
# /process-key: the request body IS the upload
# ---------------------------------------------------------------------------

_TOKEN = "a" * 64
_TEST_CID = "11111111-1111-4111-8111-111111111111"


def test_process_key_event_does_not_carry_the_uploaded_file(
    monkeypatch, sentry_events: list[dict[str, Any]], caplog: pytest.LogCaptureFixture
) -> None:
    """`/process-key` carries the whole file as `raw_bytes_base64` in its JSON
    body, and Sentry's request integration attaches that body to every event
    raised during the request. The redaction hook scrubs it by KEY and
    `raw_bytes_base64` is not a denylisted key, so without the capture helper
    withholding the body, a small upload would ship to Sentry encoded. Neither
    the marker nor its base64 form may appear."""
    import routers.process_key as process_key_router
    from services import csv_validator

    monkeypatch.setenv("INTERNAL_API_TOKEN", _TOKEN)
    app = FastAPI()
    app.state.limiter = process_key_router.limiter
    app.include_router(process_key_router.router)
    client = TestClient(app, raise_server_exceptions=False)

    raw = f"date,daily_return\n2024-01-01,{MARKER}\n".encode()
    encoded = base64.b64encode(raw).decode("ascii")
    with patch.object(csv_validator, "validate_csv", _explode), patch(
        "routers.process_key.get_supabase", return_value=MagicMock()
    ), caplog.at_level(logging.DEBUG):
        resp = client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "step": "validate",
                    "user_id": "u1",
                    "wizard_session_id": "wiz-170-1",
                    "fmt": "daily_returns",
                    "raw_bytes_base64": encoded,
                    # A key no denylist knows. The capture withholds the request
                    # body as a whole, so this must not reach the event either.
                    "free_form_note": MARKER,
                },
            },
            headers={"Authorization": f"Bearer {_TOKEN}", "X-Correlation-Id": _TEST_CID},
        )

    assert resp.status_code == 200, resp.text
    assert resp.json()["code"] == "CSV_UPSTREAM_FAIL"
    located = [
        e for e in sentry_events
        if e.get("exception") and _innermost_frame(e)["function"] == "_explode"
    ]
    assert located, _dump(sentry_events)
    dumped = _dump(sentry_events)
    assert MARKER not in dumped
    assert encoded not in dumped
    assert "free_form_note" not in dumped
    assert MARKER not in caplog.text
