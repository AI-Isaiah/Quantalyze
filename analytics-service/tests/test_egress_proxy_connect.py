"""SFOX-07 (121-02) — CONNECT Proxy-Authorization lands + Bearer stays opaque.

The standing guard for RESEARCH Pitfall 1: aiohttp 3.14.1 derives
`Proxy-Authorization` from the proxy-URL userinfo and places it on the HTTPS
CONNECT request. An aiohttp upgrade that silently drops that would break the
IP-whitelisted sFOX auth in prod with a 407 — this test turns RED instead.

It also pins the tunnel-opacity design (T-121-05): the proxy URL carries ONLY the
proxy BasicAuth; the sFOX Bearer travels inside the end-to-end TLS tunnel, so it
NEVER appears in what the proxy sees on the CONNECT hop.
"""
from __future__ import annotations

import asyncio
import base64

import aiohttp
import pytest

from services.sfox_client import SfoxApiError
from services.sfox_factory import make_sfox_client

_BEARER = "SFOX-TEST-BEARER-TOKEN"


def test_connect_proxy_auth_lands_and_bearer_absent(monkeypatch):
    captured: dict[str, bytes] = {}

    async def _run() -> None:
        async def handle(reader, writer):
            # Read the CONNECT request head (up to the blank line), record it,
            # then reject with 407 so no TLS tunnel is established.
            data = b""
            while b"\r\n\r\n" not in data:
                chunk = await reader.read(1024)
                if not chunk:
                    break
                data += chunk
            captured["head"] = data
            writer.write(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
            try:
                await writer.drain()
            finally:
                writer.close()

        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        monkeypatch.setenv(
            "WORKER_EGRESS_PROXY_URL", f"http://alice:s3cret@127.0.0.1:{port}"
        )
        client = make_sfox_client(_BEARER)
        try:
            # The 407 surfaces as an aiohttp proxy error, which SfoxClient maps to
            # SfoxApiError — accept either, whichever propagates.
            with pytest.raises((SfoxApiError, aiohttp.ClientError)):
                await client.get_balances()
        finally:
            await client.aclose()
            server.close()
            await server.wait_closed()

    asyncio.run(_run())

    head = captured.get("head", b"")
    first_line = head.split(b"\r\n", 1)[0]
    # 1) It is a CONNECT tunnel to the sFOX host on 443 (HTTPS opacity).
    assert first_line.startswith(b"CONNECT api.sfox.com:443"), first_line
    # 2) The proxy BasicAuth from the URL userinfo lands as Proxy-Authorization.
    expected_cred = b"Basic " + base64.b64encode(b"alice:s3cret")
    assert expected_cred in head, head
    # 3) The sFOX Bearer NEVER appears on the CONNECT hop (tunnel is opaque).
    assert _BEARER.encode() not in head
    assert b"Authorization: Bearer" not in head
