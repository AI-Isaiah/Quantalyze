"""170.1 / T-170.1-45: a Sentry TRANSACTION event never carries the CSV upload.

The defect (security re-audit, `[170.1-CSV-SENTRY-TXN-UPLOAD]`): `init_sentry`
set only `before_send`, and the SDK does not run `before_send` on transaction
events. The `_PII_KEYS` additions of `raw_bytes_base64` and `raw_bytes` therefore
protected ERROR events only. A `/process-key` CSV request attaches its whole JSON
body to the event's `request.data`, and a sampled transaction (10% in production)
shipped the upload base64-encoded whenever the body was under the SDK's size cap.

What is pinned here is the whole path, not the hook alone: the production
`init_sentry()` kwargs (its `before_send`, `before_send_transaction`, integrations
and `include_local_variables`; only the sample rate and the transport are
swapped), a real FastAPI app, the real `CsvAdapter`, and a recording transport
that serialises every envelope item exactly as it would leave the process.

Every cell is a synthetic marker. No real data.
"""
from __future__ import annotations

import base64
import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import sentry_sdk
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sentry_sdk.transport import Transport

import sentry_init

MARKER = "ZXQTXNCELLMARKER"
CSV_BYTES = (
    f"date,daily_return,note\n2024-01-01,0.01,{MARKER}\n2024-01-02,0.02,{MARKER}\n"
).encode()
_TOKEN = "a" * 64
_CID = "11111111-1111-4111-8111-111111111111"


class _RecordingTransport(Transport):
    """Keeps the SERIALISED bytes of every envelope item: that is what leaves the
    process, and a field the SDK adds after `before_send_transaction` shows here."""

    def __init__(self) -> None:
        super().__init__()
        self.items: list[tuple[str, bytes]] = []

    def capture_envelope(self, envelope: Any) -> None:
        for item in envelope.items:
            self.items.append((str(item.type), item.get_bytes()))


def _base64_fragments(marker: str) -> list[str]:
    """Substrings of base64(<any text containing marker>) that do not depend on
    what precedes the marker: base64 re-aligns the marker by offset mod 3."""
    out = []
    for prefix_len in range(3):
        encoded = base64.b64encode(b"A" * prefix_len + marker.encode()).decode()
        out.append(encoded[4:-4])
    return out


@pytest.fixture
def transport(monkeypatch):
    """`init_sentry()` itself, unmodified, except sampling is forced to 1.0 and the
    transport is the recorder. A real DSN-shaped value satisfies its no-DSN guard."""
    rec = _RecordingTransport()
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.invalid/1")
    real_init = sentry_sdk.init

    def init(**kwargs):
        assert kwargs["traces_sample_rate"] == 0.1  # the production value we override
        real_init(**{**kwargs, "traces_sample_rate": 1.0, "transport": rec})

    monkeypatch.setattr(sentry_init.sentry_sdk, "init", init)
    sentry_init.init_sentry()
    try:
        yield rec
    finally:
        sentry_sdk.flush()
        sentry_sdk.get_client().close()
        real_init()  # back to the no-DSN default for the rest of the suite
        # (`monkeypatch` swaps the module attribute, so the saved original is used)


def _process_key_router():
    """Imported at call time, never at module level: `tests/test_process_key.py`
    evicts and re-imports `routers.process_key` at ITS collection, and an earlier
    collection-time import here would make that re-import register the route's
    rate limits twice (`test_process_key_route_registers_both_limits`)."""
    import routers.process_key as process_key_router

    return process_key_router


@pytest.fixture
def client(monkeypatch, transport):
    monkeypatch.setenv("INTERNAL_API_TOKEN", _TOKEN)
    process_key_router = _process_key_router()
    app = FastAPI()
    app.state.limiter = process_key_router.limiter
    app.include_router(process_key_router.router)
    process_key_router.limiter.reset()  # process-wide in-memory storage
    yield TestClient(app)
    process_key_router.limiter.reset()


def _post_validate_only(client: TestClient):
    # No `get_adapter` patch: the real CsvAdapter parses the real bytes.
    with patch.object(_process_key_router(), "get_supabase", return_value=MagicMock()):
        return client.post(
            "/process-key",
            json={
                "flow_type": "csv",
                "source": "csv",
                "context": {
                    "step": "validate",
                    "user_id": "u1",
                    "wizard_session_id": "wiz-txn-170-1",
                    "fmt": "daily_returns",
                    "raw_bytes_base64": base64.b64encode(CSV_BYTES).decode(),
                },
            },
            headers={"Authorization": f"Bearer {_TOKEN}", "X-Correlation-Id": _CID},
        )


def _transactions(transport: _RecordingTransport) -> list[dict[str, Any]]:
    return [json.loads(raw) for kind, raw in transport.items if kind == "transaction"]


def test_init_sentry_wires_the_redactor_onto_transaction_events(monkeypatch) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.invalid/1")
    monkeypatch.setattr(sentry_init.sentry_sdk, "init", lambda **kw: captured.update(kw))

    sentry_init.init_sentry()

    assert captured["before_send_transaction"] is sentry_init._redact_before_send


def test_a_sampled_process_key_csv_transaction_carries_no_upload(
    client: TestClient, transport: _RecordingTransport
) -> None:
    resp = _post_validate_only(client)
    assert resp.status_code == 200, resp.text
    sentry_sdk.flush()

    # Not vacuous: a transaction was sampled and the request body rode on it.
    txns = [t for t in _transactions(transport) if "/process-key" in json.dumps(t)]
    assert txns, [kind for kind, _ in transport.items]
    request = txns[0].get("request") or {}
    uploaded = ((request.get("data") or {}).get("context") or {}).get("raw_bytes_base64")
    assert uploaded in (None, "[REDACTED]"), uploaded
    # The scrub is by key, not wholesale: the rest of the body is still there.
    if uploaded is not None:
        assert request["data"]["context"]["fmt"] == "daily_returns"

    # And nowhere in anything that would have been sent.
    everything = b"\n".join(raw for _, raw in transport.items).decode("utf-8", "replace")
    assert MARKER not in everything
    assert base64.b64encode(CSV_BYTES).decode() not in everything
    for fragment in _base64_fragments(MARKER):
        assert fragment not in everything, fragment


def test_a_transaction_spans_data_is_scrubbed_by_key() -> None:
    """`spans[*].data` exists only on transaction events, and the hook is the only
    redactor a transaction passes through."""
    event = {
        "type": "transaction",
        "spans": [
            {"op": "http.client", "data": {"authorization": "Bearer x", "http.method": "GET"}},
            {"op": "other"},
        ],
    }

    out = sentry_init._redact_before_send(event, None)

    assert out["spans"][0]["data"]["authorization"] == "[REDACTED]"
    assert out["spans"][0]["data"]["http.method"] == "GET"
    assert out["spans"][1] == {"op": "other"}


def test_a_transaction_keeps_dotted_hosts_and_versions_but_still_redacts_a_real_jwt() -> None:
    """LR-JWT: the redactor now runs on every sampled transaction, and the value-shape
    scan used to treat ANY three dot-separated base64url segments as a JWT. A span's
    `server.address` / `net.peer.name` host, `contexts.trace.origin` and a runtime
    version are all of that shape, so they were rewritten to a redaction marker. Only
    a real JWT (header = base64url of a JSON object, so it starts `eyJ`) is redacted."""
    real_jwt = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ"
        ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    )
    event = {
        "type": "transaction",
        "contexts": {
            "trace": {"origin": "auto.http.starlette"},
            "runtime": {"name": "CPython", "version": "3.12.13"},
        },
        "spans": [
            {
                "op": "http.client",
                "data": {
                    "server.address": "api.example.com",
                    "net.peer.name": "api.example.com",
                    "leaked": real_jwt,
                },
            }
        ],
    }

    out = sentry_init._redact_before_send(event, None)

    data = out["spans"][0]["data"]
    assert data["server.address"] == "api.example.com"
    assert data["net.peer.name"] == "api.example.com"
    assert out["contexts"]["runtime"]["version"] == "3.12.13"
    assert out["contexts"]["trace"]["origin"] == "auto.http.starlette"
    assert data["leaked"] == "[REDACTED_JWT]"


def test_the_service_key_and_tenant_claim_headers_are_redacted_on_error_and_transaction_events() -> None:
    """170.1 security re-audit: `X-Service-Key` (the shared secret the Next.js server
    sends on every analytics call) and `X-Tenant-Claim` (`<uuid>.<exp>.<hmac>`, no
    longer caught by the `eyJ`-anchored value scan) were on no denylist, so both
    reached Sentry in cleartext. They are redacted by KEY, whatever the casing, on an
    error event and on a transaction event alike."""
    headers = {
        "X-Service-Key": "svc-secret-value",
        "x-tenant-claim": "00000000-0000-0000-0000-000000000000.1700000000.abcdef0123456789",
        "User-Agent": "kept",
    }
    for event_type in (None, "transaction"):
        event = {"request": {"headers": dict(headers)}}
        if event_type:
            event["type"] = event_type
        out = sentry_init._redact_before_send(event, None)
        assert out["request"]["headers"]["X-Service-Key"] == "[REDACTED]", event_type
        assert out["request"]["headers"]["x-tenant-claim"] == "[REDACTED]", event_type
        assert out["request"]["headers"]["User-Agent"] == "kept", event_type
