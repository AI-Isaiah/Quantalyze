"""Tests for the OKX archive downloader (Phase 167.1.2.2.2.1, plan 03).

The module under test is the one place this service downloads a third-party URL, so
the posture here is adversarial: every refusal test asserts the transport was never
called (a refusal that happens AFTER a request is not a refusal), and the tests
generate their own bomb payloads instead of committing binary fixtures.

Seams (there is NO allow-list parameter on the function): the module constant
``ARCHIVE_ALLOWED_HOSTS``, the module-level resolver ``_resolve_host`` and the
module-level transport factory ``_transport``.
"""

from __future__ import annotations

import gzip
import io
import logging
import os
import zipfile
import zlib
from pathlib import Path

import httpx
import pytest

from services import okx_archive_download as mod

HOST = "archive.example.test"
PUBLIC_IP = "8.8.8.8"
OTHER_PUBLIC_IP = "1.1.1.1"
# The signed query string is the bearer token; the tests assert it never reaches a log.
SECRET_QUERY = "sign=SECRETTOKEN123&expires=9999999999"
SECRET_PATH = "/priv/okx/bills/2026Q2.zip"
URL = f"https://{HOST}{SECRET_PATH}?{SECRET_QUERY}"

CSV = b"ts,type,pnl,fee\n1760000000000,2,3.5,-0.1\n1760086400000,2,-1.25,-0.1\n"


def _gzip(payload: bytes) -> bytes:
    return gzip.compress(payload)


def _zip(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return buf.getvalue()


class _Rig:
    """Records every seam call. ``requests`` is what the transport saw."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.resolver_calls: list[str] = []
        self.addresses: list[list[str]] = [[PUBLIC_IP]]
        self.serve(status_code=200, content=_gzip(CSV))

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.respond(request)

    async def resolver(self, host: str) -> list[str]:
        self.resolver_calls.append(host)
        index = min(len(self.resolver_calls) - 1, len(self.addresses) - 1)
        return self.addresses[index]

    def serve(
        self,
        status_code: int = 200,
        content: bytes = b"",
        headers: dict[str, str] | None = None,
    ) -> None:
        # A fresh UNREAD stream per request, like a real transport returns: a Response
        # built with ``content=`` is pre-read and ``aiter_raw`` refuses it.
        self.respond = lambda request: httpx.Response(
            status_code, headers=headers, stream=httpx.ByteStream(content)
        )


@pytest.fixture
def rig(monkeypatch: pytest.MonkeyPatch) -> _Rig:
    """An allowed test host, a recording resolver and a recording transport."""
    r = _Rig()
    monkeypatch.setattr(mod, "ARCHIVE_ALLOWED_HOSTS", frozenset({HOST}))
    monkeypatch.setattr(mod, "_resolve_host", r.resolver)
    monkeypatch.setattr(
        mod, "_transport", lambda: httpx.MockTransport(r.handler)
    )
    return r


@pytest.fixture
def unallowed_rig(monkeypatch: pytest.MonkeyPatch) -> _Rig:
    """Same seams as ``rig`` but the SHIPPED allow-list (empty) is left untouched."""
    r = _Rig()
    monkeypatch.setattr(mod, "_resolve_host", r.resolver)
    monkeypatch.setattr(
        mod, "_transport", lambda: httpx.MockTransport(r.handler)
    )
    return r


class TestTracerDownload:
    async def test_gzip_link_returns_exact_csv_bytes(self, rig: _Rig) -> None:
        body = _gzip(CSV)
        rig.serve(status_code=200, content=body)
        csv_bytes, container, compressed = await mod.download_archive_csv(URL)
        assert csv_bytes == CSV
        assert container == "gzip"
        assert compressed == len(body)

    async def test_single_member_zip_returns_exact_csv_bytes(self, rig: _Rig) -> None:
        body = _zip({"bills.csv": CSV})
        rig.serve(status_code=200, content=body)
        csv_bytes, container, compressed = await mod.download_archive_csv(URL)
        assert csv_bytes == CSV
        assert container == "zip"
        assert compressed == len(body)

    async def test_request_carries_no_credential_and_is_not_redirected(
        self, rig: _Rig
    ) -> None:
        await mod.download_archive_csv(URL)
        assert len(rig.requests) == 1
        names = {k.lower() for k in rig.requests[0].headers.keys()}
        assert "authorization" not in names
        assert "cookie" not in names
        assert not any(n.startswith("ok-access") for n in names)

    async def test_connect_is_pinned_to_the_vetted_address(self, rig: _Rig) -> None:
        # A rebinding resolver: a SECOND lookup would answer a different address.
        rig.addresses = [[PUBLIC_IP], [OTHER_PUBLIC_IP]]
        await mod.download_archive_csv(URL)
        assert rig.resolver_calls == [HOST], "the host must be resolved exactly once"
        request = rig.requests[0]
        # The transport is handed the vetted address, never the hostname ...
        assert request.url.host == PUBLIC_IP
        # ... and the hostname rides as Host and as the TLS SNI / verification name.
        assert request.headers["host"] == HOST
        assert request.extensions["sni_hostname"] == HOST
        # The signed path and query are forwarded to the vetted address intact.
        assert request.url.path == SECRET_PATH
        assert request.url.query.decode() == SECRET_QUERY

    async def test_ipv6_answer_is_pinned_in_brackets(self, rig: _Rig) -> None:
        rig.addresses = [["2606:4700:4700::1111"]]
        await mod.download_archive_csv(URL)
        assert rig.requests[0].url.host == "2606:4700:4700::1111"
        assert rig.requests[0].headers["host"] == HOST

    def test_describe_href_reports_scheme_and_host_only(self) -> None:
        assert mod.describe_href(URL) == ("https", HOST)
        assert mod.describe_href(f"HTTPS://{HOST.upper()}/x?y=1") == ("https", HOST)
        scheme, host = mod.describe_href(URL)
        assert SECRET_QUERY not in scheme + host and "priv" not in scheme + host

    def test_describe_href_never_echoes_an_unparsable_url(self) -> None:
        assert mod.describe_href("https://[bad/priv?sign=SECRETTOKEN123") == ("", "")

    def test_shipped_allow_list_is_empty_and_has_no_env_path(self) -> None:
        # The module-level constant, read through the module, not the fixture.
        assert mod.ARCHIVE_ALLOWED_HOSTS == frozenset()
        source = Path(mod.__file__).read_text(encoding="utf-8")
        assert "ARCHIVE_ALLOWED_HOSTS: Final" in source
        assert "= frozenset()" in source
        assert "os.environ" not in source and "getenv(" not in source
