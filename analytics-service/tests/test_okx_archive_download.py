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

import ast
import gzip
import io
import logging
import os
import random
import tempfile
import zipfile
import zlib
from pathlib import Path

import httpx
import pytest

from services import okx_archive_download as mod

HOST = "archive.example.test"
#: The one host the shipped allow-list admits (plan 13, founder decision 2026-10-20).
APPROVED_HOST = "okg-pri-hk.oss-cn-hongkong.aliyuncs.com"
PUBLIC_IP = "8.8.8.8"
OTHER_PUBLIC_IP = "1.1.1.1"
# The signed query string is the bearer token; the tests assert it never reaches a log.
SECRET_QUERY = "sign=SECRETTOKEN123&expires=9999999999"
SECRET_PATH = "/priv/okx/bills/2026Q2.zip"
# Synthetic userinfo for the refusal row. Kept out of the URL literal so a push-time
# credential scanner does not read a test fixture as a leaked basic-auth URL.
FAKE_USERINFO = "user:pw"
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
    """Same seams as ``rig`` but the SHIPPED allow-list is left untouched."""
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

    def test_shipped_allow_list_is_exactly_the_approved_host_and_has_no_env_path(self) -> None:
        # The module-level constant, read through the module, not the fixture. It holds the
        # one host the founder approved from the preflight observation and nothing else: a
        # second entry, a wildcard or an env-fed extension is a new reviewed change.
        assert mod.ARCHIVE_ALLOWED_HOSTS == frozenset({APPROVED_HOST})
        source = Path(mod.__file__).read_text(encoding="utf-8")
        assert "ARCHIVE_ALLOWED_HOSTS: Final" in source
        assert "os.environ" not in source and "getenv(" not in source


async def _refused(rig: _Rig, url: str, reason: str) -> None:
    """The URL is refused with ``reason`` and NOT ONE request reached the transport."""
    with pytest.raises(mod.DownloadRefused) as caught:
        await mod.download_archive_csv(url)
    assert caught.value.reason == reason
    assert reason in mod.REFUSAL_REASONS
    assert rig.requests == [], "a refusal must happen before any request is made"
    assert "SECRETTOKEN123" not in str(caught.value)


class TestUrlRefusals:
    async def test_an_empty_allow_list_admits_nothing_not_even_the_shipped_host(
        self, unallowed_rig: _Rig, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """T-DL-1 (rewritten in plan 13). The allow-list is the only SSRF gate before any
        socket opens, so an EMPTY list must fail closed, never open: every URL, the shipped
        approved host's included, is refused with ``host_not_allowed`` and the transport is
        called zero times. Plan 03 pinned this against the shipped list being empty; plan 13
        populates the shipped list, so the property is pinned by emptying it here."""
        monkeypatch.setattr(mod, "ARCHIVE_ALLOWED_HOSTS", frozenset())
        await _refused(unallowed_rig, URL, "host_not_allowed")
        await _refused(
            unallowed_rig,
            f"https://{APPROVED_HOST}{SECRET_PATH}?{SECRET_QUERY}",
            "host_not_allowed",
        )
        assert unallowed_rig.resolver_calls == [], "nothing is resolved either"

    async def test_the_shipped_list_admits_the_approved_host_over_https(
        self, unallowed_rig: _Rig
    ) -> None:
        """No monkeypatch of the list: the approved host downloads, and the vetted address
        is the one dialled."""
        csv_bytes, container, _ = await mod.download_archive_csv(
            f"https://{APPROVED_HOST}{SECRET_PATH}?{SECRET_QUERY}"
        )
        assert csv_bytes == CSV and container == "gzip"
        assert unallowed_rig.resolver_calls == [APPROVED_HOST]
        assert len(unallowed_rig.requests) == 1

    @pytest.mark.parametrize(
        "url",
        [
            f"http://{APPROVED_HOST}{SECRET_PATH}?{SECRET_QUERY}",  # plain http: scheme
            f"https://{APPROVED_HOST}.evil{SECRET_PATH}?{SECRET_QUERY}",  # suffix
            f"https://x.{APPROVED_HOST}{SECRET_PATH}?{SECRET_QUERY}",  # subdomain
            f"https://evil{APPROVED_HOST}{SECRET_PATH}?{SECRET_QUERY}",  # prefix glued on
            f"https://{APPROVED_HOST}.{SECRET_PATH}?{SECRET_QUERY}",  # trailing dot
            f"https://aliyuncs.com{SECRET_PATH}?{SECRET_QUERY}",  # parent domain
            f"https://oss-cn-hongkong.aliyuncs.com{SECRET_PATH}?{SECRET_QUERY}",  # sibling label
        ],
    )
    async def test_the_shipped_list_refuses_the_approved_host_spelled_any_other_way(
        self, unallowed_rig: _Rig, url: str
    ) -> None:
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(url)
        assert caught.value.reason in {"scheme", "host_not_allowed"}
        assert unallowed_rig.requests == [], "a refusal must happen before any request"
        assert unallowed_rig.resolver_calls == []

    async def test_http_scheme_is_refused(self, rig: _Rig) -> None:
        await _refused(rig, f"http://{HOST}{SECRET_PATH}?{SECRET_QUERY}", "scheme")

    @pytest.mark.parametrize(
        "host",
        [
            f"{HOST}.evil",  # suffix extension of an allowed name
            f"x.{HOST}",  # a subdomain is not the allowed host
            f"evil{HOST}",  # prefix glued on
            f"{HOST}.",  # trailing dot is a different spelling, not the entry
            "other.example.test",
        ],
    )
    async def test_host_not_allowed_unless_it_matches_the_entry_exactly(
        self, rig: _Rig, host: str
    ) -> None:
        await _refused(rig, f"https://{host}{SECRET_PATH}?{SECRET_QUERY}", "host_not_allowed")

    @pytest.mark.parametrize(
        "url",
        [
            f"https://{FAKE_USERINFO}@{HOST}{SECRET_PATH}?{SECRET_QUERY}",  # userinfo
            f"https://user@{HOST}{SECRET_PATH}",  # userinfo, no password
            f"https://{HOST}:8443{SECRET_PATH}?{SECRET_QUERY}",  # explicit port
            f"https://{HOST}:443{SECRET_PATH}",  # even the default port, spelled out
            f"https://{HOST}{SECRET_PATH}?{SECRET_QUERY}#frag",  # fragment
            f"https://{HOST}{SECRET_PATH} x?{SECRET_QUERY}",  # whitespace
            f"https://{HOST}{SECRET_PATH}\r\nX-Evil: 1",  # header-splitting attempt
            f"https://{HOST}/café?{SECRET_QUERY}",  # non-ASCII
        ],
    )
    async def test_url_shape_is_refused(self, rig: _Rig, url: str) -> None:
        await _refused(rig, url, "url_shape")

    async def test_host_not_allowed_when_userinfo_smuggles_a_second_host(self, rig: _Rig) -> None:
        # urlsplit reads the host AFTER the "@": that host is not allow-listed.
        await _refused(
            rig, f"https://{HOST}@evil.example/{SECRET_PATH}", "host_not_allowed"
        )


PRIVATE_ANSWERS = [
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",  # cloud metadata
    "100.64.0.1",  # CGNAT
    "0.0.0.0",
    "224.0.0.1",  # multicast
    "::1",
    "::",
    "fe80::1",
    "fe80::1%eth0",  # zone id on a link-local answer
    "fc00::1",
    "ff02::1",
    "::ffff:10.0.0.1",  # IPv4-mapped private
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
]


class TestAddressRefusals:
    @pytest.mark.parametrize("answer", PRIVATE_ANSWERS)
    async def test_private_address_resolution_is_refused(self, rig: _Rig, answer: str) -> None:
        rig.addresses = [[answer]]
        await _refused(rig, URL, "private_address")

    @pytest.mark.parametrize("private", ["10.0.0.5", "169.254.169.254", "::1"])
    @pytest.mark.parametrize("order", ["public_first", "private_first"])
    async def test_private_address_in_a_mixed_answer_is_refused(
        self, rig: _Rig, private: str, order: str
    ) -> None:
        rig.addresses = [
            [PUBLIC_IP, private] if order == "public_first" else [private, PUBLIC_IP]
        ]
        await _refused(rig, URL, "private_address")

    @pytest.mark.parametrize(
        "numeric_host",
        [
            "2130706433",  # 127.0.0.1 as one decimal
            "0x7f000001",  # 127.0.0.1 as hex
            "127.1",  # 127.0.0.1 as a short form
            "167772165",  # 10.0.0.5 as one decimal
            "2852039166",  # 169.254.169.254 as one decimal
            "127.0.0.1",
        ],
    )
    async def test_private_address_numeric_host_forms_are_judged_as_the_address_they_dial(
        self, rig: _Rig, monkeypatch: pytest.MonkeyPatch, numeric_host: str
    ) -> None:
        # Even a (mistaken) allow-list entry cannot make a private literal dialable.
        monkeypatch.setattr(mod, "ARCHIVE_ALLOWED_HOSTS", frozenset({numeric_host.strip("[]")}))
        await _refused(rig, f"https://{numeric_host}{SECRET_PATH}?{SECRET_QUERY}", "private_address")

    async def test_a_bracketed_ipv6_literal_host_is_refused_by_shape(
        self, rig: _Rig, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A named allow-listed host is the only legitimate shape; an IPv6 literal is
        # refused whatever it says (the netloc is not the bare hostname).
        monkeypatch.setattr(mod, "ARCHIVE_ALLOWED_HOSTS", frozenset({"::1"}))
        await _refused(rig, f"https://[::1]{SECRET_PATH}?{SECRET_QUERY}", "url_shape")

    async def test_a_resolver_failure_is_a_permanent_refusal(self, rig: _Rig) -> None:
        async def boom(host: str) -> list[str]:
            raise OSError("no such host")

        mod_resolver = boom
        import pytest as _pytest  # noqa: PLC0415 - local, to patch inside the test

        with _pytest.MonkeyPatch.context() as mp:
            mp.setattr(mod, "_resolve_host", mod_resolver)
            await _refused(rig, URL, "resolve_failed")

    async def test_an_empty_resolution_is_refused(self, rig: _Rig) -> None:
        rig.addresses = [[]]
        await _refused(rig, URL, "resolve_failed")

    async def test_a_public_answer_is_accepted(self, rig: _Rig) -> None:
        # The control for the refusals above: the same flow with a public answer works.
        rig.addresses = [["93.184.216.34"]]
        csv_bytes, _, _ = await mod.download_archive_csv(URL)
        assert csv_bytes == CSV


class TestStatusHandling:
    async def test_a_redirect_is_refused_and_its_location_is_not_requested(
        self, rig: _Rig
    ) -> None:
        rig.serve(
            status_code=302, headers={"Location": "https://evil.example/steal"}
        )
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "redirect"
        assert len(rig.requests) == 1, "the Location must never be requested"
        assert rig.requests[0].url.host == PUBLIC_IP

    @pytest.mark.parametrize("status", [301, 303, 307, 308])
    async def test_every_3xx_is_refused(self, rig: _Rig, status: int) -> None:
        rig.serve(status_code=status, headers={"Location": f"https://{HOST}/elsewhere"})
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "redirect"
        assert len(rig.requests) == 1

    @pytest.mark.parametrize("status", [403, 410])
    async def test_an_expired_link_is_its_own_outcome(
        self, rig: _Rig, status: int
    ) -> None:
        rig.serve(status_code=status)
        with pytest.raises(mod.LinkExpired) as caught:
            await mod.download_archive_csv(URL)
        assert not isinstance(caught.value, mod.DownloadRefused)
        assert "SECRETTOKEN123" not in str(caught.value)

    @pytest.mark.parametrize("status", [400, 401, 404, 451])
    async def test_other_client_errors_are_a_permanent_refusal(
        self, rig: _Rig, status: int
    ) -> None:
        rig.serve(status_code=status)
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "http_status"

    @pytest.mark.parametrize("status", [500, 502, 503, 504, 408, 429])
    async def test_a_server_side_status_is_transient_and_leaks_nothing(
        self, rig: _Rig, status: int
    ) -> None:
        rig.serve(status_code=status)
        with pytest.raises(httpx.HTTPStatusError) as caught:
            await mod.download_archive_csv(URL)
        assert not isinstance(caught.value, mod.DownloadRefused)
        # httpx's own raise_for_status() message embeds the full request URL.
        text = f"{caught.value} {caught.value!r}"
        assert "SECRETTOKEN123" not in text and "sign=" not in text
        assert SECRET_PATH not in text

    async def test_a_network_error_propagates_as_transient(self, rig: _Rig) -> None:
        def refuse_connection(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=request)

        rig.respond = refuse_connection
        with pytest.raises(httpx.ConnectError):
            await mod.download_archive_csv(URL)


class TestNoLinkInLogs:
    """The signed query string is a bearer token: no log record may carry it."""

    @pytest.mark.parametrize(
        "scenario",
        ["ok", "redirect", "expired", "not_found", "server_error", "bad_container", "private"],
    )
    async def test_no_record_carries_the_path_or_query(
        self, rig: _Rig, caplog: pytest.LogCaptureFixture, scenario: str
    ) -> None:
        # Pin the level on the emitting loggers themselves, not only the root:
        # an earlier test in the same session can leave a parent logger's level
        # raised, which silently drops these records and made the vacuity
        # assert below fail only when test_exchange.py ran first.
        caplog.set_level(logging.DEBUG)
        caplog.set_level(logging.DEBUG, logger=mod.logger.name)
        caplog.set_level(logging.DEBUG, logger="httpx")
        if scenario == "redirect":
            rig.serve(status_code=302, headers={"Location": f"https://{HOST}/x"})
        elif scenario == "expired":
            rig.serve(status_code=410)
        elif scenario == "not_found":
            rig.serve(status_code=404)
        elif scenario == "server_error":
            rig.serve(status_code=503)
        elif scenario == "bad_container":
            rig.serve(status_code=200, content=b"not an archive at all")
        elif scenario == "private":
            rig.addresses = [["10.0.0.5"]]
        try:
            await mod.download_archive_csv(URL)
        except (mod.DownloadRefused, mod.LinkExpired, httpx.HTTPError):
            pass
        assert caplog.records, "the fetch must leave at least one record to inspect"
        for record in caplog.records:
            text = record.getMessage()
            assert "SECRETTOKEN123" not in text
            assert "sign=" not in text
            assert SECRET_PATH not in text
            assert "priv/okx" not in text
        # Scheme and host are the only description of the link that is allowed.
        assert any(f"https://{HOST}" in r.getMessage() for r in caplog.records)


class _Chunks(httpx.AsyncByteStream):
    """A body served chunk by chunk that counts how many chunks were pulled."""

    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks
        self.sent = 0

    async def __aiter__(self):  # type: ignore[override]
        for chunk in self.chunks:
            self.sent += 1
            yield chunk


def _incompressible(n: int) -> bytes:
    """Deterministic bytes that deflate to about their own size (ratio ~1)."""
    return random.Random(20261015).randbytes(n)


def _encrypted_zip(payload: bytes) -> bytes:
    """A real zip whose single member carries the 'encrypted' general-purpose flag."""
    raw = bytearray(_zip({"bills.csv": payload}))
    raw[6] |= 0x01  # local file header, general purpose bit flag
    central = raw.index(b"PK\x01\x02")
    raw[central + 8] |= 0x01  # central directory entry, general purpose bit flag
    return bytes(raw)


class TestSizeCaps:
    async def test_compressed_cap_stops_the_stream_without_buffering_the_rest(
        self, rig: _Rig, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(mod, "MAX_COMPRESSED_BYTES", 1000)
        stream = _Chunks([_gzip(CSV)[:4] + b"x" * 400] * 50)
        rig.respond = lambda request: httpx.Response(200, stream=stream)
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "too_large"
        assert stream.sent <= 4, "the cap must stop the read, not fire after the body"

    async def test_a_declared_length_over_the_cap_is_refused_before_any_byte(
        self, rig: _Rig, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(mod, "MAX_COMPRESSED_BYTES", 1000)
        stream = _Chunks([_gzip(CSV)])
        rig.respond = lambda request: httpx.Response(
            200, headers={"Content-Length": "5000"}, stream=stream
        )
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "too_large"
        assert stream.sent == 0

    async def test_a_body_exactly_at_the_compressed_cap_is_accepted(
        self, rig: _Rig, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        body = _gzip(CSV)
        monkeypatch.setattr(mod, "MAX_COMPRESSED_BYTES", len(body))
        rig.serve(status_code=200, content=body)
        csv_bytes, _, compressed = await mod.download_archive_csv(URL)
        assert csv_bytes == CSV and compressed == len(body)

    async def test_decompressed_cap_gzip(
        self, rig: _Rig, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Incompressible data: the RATIO is ~1, so only the absolute cap can refuse it.
        monkeypatch.setattr(mod, "MAX_DECOMPRESSED_BYTES", 50_000)
        rig.serve(status_code=200, content=_gzip(_incompressible(200_000)))
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "too_large"

    async def test_decompressed_cap_zip(
        self, rig: _Rig, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(mod, "MAX_DECOMPRESSED_BYTES", 50_000)
        rig.serve(status_code=200, content=_zip({"b.csv": _incompressible(200_000)}))
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "too_large"

    async def test_decompressed_cap_at_the_limit_is_accepted(
        self, rig: _Rig, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        data = _incompressible(30_000)
        monkeypatch.setattr(mod, "MAX_DECOMPRESSED_BYTES", len(data))
        rig.serve(status_code=200, content=_gzip(data))
        csv_bytes, _, _ = await mod.download_archive_csv(URL)
        assert csv_bytes == data

    async def test_a_bomb_is_stopped_one_chunk_past_the_cap_not_inflated_whole(
        self, rig: _Rig, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        produced = {"bytes": 0}
        real = zlib.decompressobj

        class Spy:
            def __init__(self, wbits: int) -> None:
                self._inner = real(wbits)

            def decompress(self, data: bytes, max_length: int = 0) -> bytes:
                out = self._inner.decompress(data, max_length)
                produced["bytes"] += len(out)
                return out

            def __getattr__(self, name: str):
                return getattr(self._inner, name)

        monkeypatch.setattr(zlib, "decompressobj", Spy)
        monkeypatch.setattr(mod, "_CHUNK_BYTES", 64 * 1024)
        monkeypatch.setattr(mod, "MAX_DECOMPRESSED_BYTES", 128 * 1024)
        monkeypatch.setattr(mod, "MAX_RATIO", 10**9)  # isolate the absolute cap
        rig.serve(status_code=200, content=_gzip(b"0" * 20_000_000))
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "too_large"
        assert produced["bytes"] <= 128 * 1024 + 64 * 1024

    @pytest.mark.parametrize("container", ["gzip", "zip"])
    async def test_ratio_cap(self, rig: _Rig, container: str) -> None:
        zeros = b"0" * 5_000_000  # ~5 KB compressed: a ratio of ~1000 against 100
        body = _gzip(zeros) if container == "gzip" else _zip({"b.csv": zeros})
        rig.serve(status_code=200, content=body)
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "ratio"

    async def test_the_same_payload_is_accepted_when_only_the_ratio_cap_is_lifted(
        self, rig: _Rig, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The control: it is the ratio cap, not the format, that refuses the bomb.
        zeros = b"0" * 5_000_000
        monkeypatch.setattr(mod, "MAX_RATIO", 10**9)
        rig.serve(status_code=200, content=_gzip(zeros))
        csv_bytes, _, _ = await mod.download_archive_csv(URL)
        assert csv_bytes == zeros


class TestContainerRefusals:
    async def test_a_zip_with_two_members_is_refused(self, rig: _Rig) -> None:
        rig.serve(status_code=200, content=_zip({"a.csv": CSV, "b.csv": CSV}))
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "zip_members"

    async def test_an_encrypted_member_is_refused(self, rig: _Rig) -> None:
        rig.serve(status_code=200, content=_encrypted_zip(CSV))
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "zip_encrypted"

    async def test_a_traversal_member_name_is_never_used_as_a_path(
        self, rig: _Rig, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        workdir = tmp_path / "cwd"
        scratch = tmp_path / "tmp"
        workdir.mkdir()
        scratch.mkdir()
        monkeypatch.chdir(workdir)
        monkeypatch.setattr(tempfile, "tempdir", str(scratch))
        rig.serve(status_code=200, content=_zip({"../../etc/x": CSV}))
        csv_bytes, container, _ = await mod.download_archive_csv(URL)
        assert (csv_bytes, container) == (CSV, "zip")
        assert list(workdir.iterdir()) == [], "nothing may be written to the cwd"
        assert list(scratch.iterdir()) == [], "nothing may be written to the temp dir"
        assert not (tmp_path / "etc").exists() and not (tmp_path.parent / "etc").exists()

    @pytest.mark.parametrize(
        "body",
        [
            b"%PDF-1.4 not an archive",
            b"<html>sign in</html>",
            b"PK",  # too short to be a local file header
            b"\x1f",  # too short for the gzip magic
            b"",
            b"PK\x05\x06" + b"\x00" * 18,  # a valid but EMPTY zip has no local header
        ],
    )
    async def test_unknown_magic_bytes_are_refused(self, rig: _Rig, body: bytes) -> None:
        rig.serve(status_code=200, content=body)
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "container_unknown"

    async def test_unknown_magic_stops_the_read_at_the_first_chunk(
        self, rig: _Rig
    ) -> None:
        stream = _Chunks([b"<html>"] + [b"x" * 1000] * 100)
        rig.respond = lambda request: httpx.Response(200, stream=stream)
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "container_unknown"
        assert stream.sent == 1

    @pytest.mark.parametrize(
        "make",
        [
            lambda: _gzip(CSV)[:-8],  # truncated: no trailer
            lambda: _gzip(CSV) + _gzip(CSV),  # a second gzip member
            lambda: _gzip(CSV) + b"trailing garbage",
            lambda: _gzip(CSV)[:12] + b"\xff" * 12,  # corrupt deflate stream
            lambda: _zip({"b.csv": CSV})[:-30],  # zip with its central directory cut
        ],
        ids=["gzip_truncated", "gzip_two_members", "gzip_trailing", "gzip_corrupt", "zip_cut"],
    )
    async def test_a_damaged_container_is_refused_not_returned_partial(
        self, rig: _Rig, make
    ) -> None:
        rig.serve(status_code=200, content=make())
        with pytest.raises(mod.DownloadRefused) as caught:
            await mod.download_archive_csv(URL)
        assert caught.value.reason == "container_unknown"


class TestNothingTouchesDisk:
    def test_the_module_never_extracts_or_writes_or_uses_a_temp_file(self) -> None:
        tree = ast.parse(Path(mod.__file__).read_text(encoding="utf-8"))
        imported = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        } | {
            (node.module or "").split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
        }
        assert imported.isdisjoint({"tempfile", "shutil", "pathlib", "os"}), imported
        forbidden_attrs = {
            "extract", "extractall", "write_bytes", "write_text", "mkstemp",
            "mkdtemp", "NamedTemporaryFile", "TemporaryFile", "SpooledTemporaryFile",
        }
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                fn = node.func
                if isinstance(fn, ast.Attribute):
                    assert fn.attr not in forbidden_attrs, fn.attr
                if isinstance(fn, ast.Name):
                    assert fn.id != "open", "builtin open() is not allowed here"
