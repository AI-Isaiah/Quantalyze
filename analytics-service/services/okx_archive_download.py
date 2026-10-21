"""The ONE place this service downloads a third-party URL (Phase 167.1.2.2.2.1
OKXHISTORY, plan 03).

The ``fileHref`` OKX returns for a ``bills-history-archive`` quarter is UNTRUSTED
input: it decides where the worker connects, and what comes back becomes published
money figures. The threat register (RESEARCH Section 6) is SSRF, redirect abuse,
zip/gzip bombs and bearer-URL leakage. Every refusal below happens BEFORE a byte of
the body is read, except the size/ratio/container caps, which are enforced against a
running counter so a hostile body is never buffered past its cap.

What the fetch does, in order:

1. URL shape (no I/O): ``https`` only, hostname in ``ARCHIVE_ALLOWED_HOSTS`` by EXACT
   match (no suffix, no wildcard), ``netloc`` equal to the bare hostname (this rejects
   userinfo and an explicit port), no fragment, printable ASCII only.
2. Resolve the host with the event loop's ``getaddrinfo`` and refuse when ANY answer
   is not a public address (loopback, RFC 1918, link-local = cloud metadata, CGNAT,
   unspecified, multicast, IPv4-mapped IPv6 judged as its IPv4, and everything the
   stdlib does not call global).
3. Connect to the FIRST vetted address with the original hostname carried as the
   ``Host`` header and as TLS SNI / certificate-verification name, so a second DNS
   lookup (a rebind) can never swap the address after it was vetted.
4. One request on a bare transport, not a client: a 3xx is a refusal and the
   ``Location`` is never requested, no environment proxy (a ``HTTPS_PROXY`` would route
   around the pin), no cookies, no OKX auth headers, a connect timeout and a TOTAL
   deadline. A client would also log the signed URL at INFO (see ``_fetch_body``).
5. Stream the raw body with a running byte counter, classify the container from its
   magic bytes, decompress IN MEMORY ONLY with running decompressed and ratio caps.
   Nothing is written to disk and no archive member name is ever used as a path.

⛔ The signed URL is a BEARER TOKEN. It is never logged, stored or returned, and the
exceptions raised here never carry it: ``httpx.HTTPStatusError.__str__`` embeds the
request URL, so a transient 5xx is re-raised with a message that names only the status.
Only ``describe_href`` (scheme and host) is ever reported.

⛔ ``ARCHIVE_ALLOWED_HOSTS`` holds only hosts measured from a real archive response and
reviewed into code. A host outside it is refused with ``host_not_allowed`` before the
resolver or the transport is touched, and an EMPTY list admits nothing. Extend it in
code, by review, never from env, job metadata or a parameter: an extensible allow-list
is no allow-list.
"""

from __future__ import annotations

import asyncio
import ipaddress
import io
import logging
import socket
import zipfile
import zlib
from typing import Final
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger("quantalyze.analytics.okx_archive_download")

#: Exact-match hosts the archive link may name; https only, enforced by the URL-shape
#: check, never by a default here. Every entry comes from an observation of a real archive
#: response, reviewed into this file. Tests monkeypatch this constant.
#: 2026-10-20 (plan 13, founder decision ``approve-host-keep-table``): the OKXHISTORY
#: preflight (plan 12, run 2026-10-20) observed an https link on this one host for both
#: archive quarters (2026 Q2 and 2026 Q3), an Alibaba Cloud OSS bucket in Hong Kong. The
#: founder approved it by exact match: no suffix, no subdomain, no http.
ARCHIVE_ALLOWED_HOSTS: Final[frozenset[str]] = frozenset(
    {"okg-pri-hk.oss-cn-hongkong.aliyuncs.com"}
)

#: Caps. Plan 14 compares them with the real quarterly file sizes at calibration and
#: keeps at least 10x headroom; they are declared CEILINGS, not expectations.
MAX_COMPRESSED_BYTES: Final = 64 * 1024 * 1024
MAX_DECOMPRESSED_BYTES: Final = 512 * 1024 * 1024
MAX_RATIO: Final = 100
#: Seconds to establish the TCP+TLS connection.
CONNECT_TIMEOUT_S: Final = 10.0
#: Seconds for the WHOLE network fetch (``asyncio.wait_for`` around it). httpx's own
#: timeout is per phase, so on its own a trickling body could run for ever.
TOTAL_TIMEOUT_S: Final = 300.0

#: Decompression is pulled in bounded chunks so a bomb is stopped one chunk past its
#: cap and never inflated whole.
_CHUNK_BYTES: Final = 1024 * 1024

_ZIP_MAGIC: Final = b"PK\x03\x04"
_GZIP_MAGIC: Final = b"\x1f\x8b"

#: The closed refusal vocabulary (``DownloadRefused.reason``).
REFUSAL_REASONS: Final = frozenset(
    {
        "scheme",
        "host_not_allowed",
        "url_shape",
        "private_address",
        "resolve_failed",
        "redirect",
        "http_status",
        "too_large",
        "ratio",
        "zip_members",
        "zip_encrypted",
        "container_unknown",
    }
)

#: Networks an outbound fetch must never reach. An EXPLICIT list (the ``mt5_client``
#: gateway list plus what an outbound fetch adds: link-local = cloud metadata,
#: unspecified, multicast), backed by ``not is_global`` in ``_address_refused``.
_REFUSED_NETWORKS: Final = tuple(
    ipaddress.ip_network(n)
    for n in (
        "0.0.0.0/8",  # unspecified / "this network"
        "10.0.0.0/8",  # RFC 1918
        "100.64.0.0/10",  # CGNAT
        "127.0.0.0/8",  # loopback
        "169.254.0.0/16",  # link-local (cloud metadata endpoints)
        "172.16.0.0/12",  # RFC 1918
        "192.168.0.0/16",  # RFC 1918
        "224.0.0.0/4",  # multicast
        "::/128",  # unspecified
        "::1/128",  # loopback
        "fc00::/7",  # unique-local
        "fe80::/10",  # link-local
        "ff00::/8",  # multicast
    )
)


class DownloadRefused(Exception):
    """A permanent refusal: retrying the same link cannot help. ``reason`` is one of
    ``REFUSAL_REASONS``. The message never carries the URL."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(f"archive download refused: {reason}")


class LinkExpired(Exception):
    """The link answered 403 or 410: the caller re-requests a fresh link once."""

    def __init__(self) -> None:
        super().__init__("archive link expired (HTTP 403/410)")


def describe_href(url: str) -> tuple[str, str]:
    """``(scheme, host)`` of ``url``, lower-cased; never the path or the query.

    The only description of an archive link that may be logged, stored or returned.
    An unparsable URL answers ``("", "")`` rather than echoing any of it.
    """
    try:
        parts = urlsplit(url.strip())
        return (parts.scheme.lower(), (parts.hostname or "").lower())
    except (ValueError, AttributeError):
        return ("", "")


def _literal_address(
    host: str,
) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """The address ``host`` IS when it is an IP literal, else ``None``.

    Numeric forms the C resolver accepts but ``ipaddress`` does not (``8.8``, a single
    decimal such as ``2130706433``, hex ``0x7f000001``) are IPv4 addresses too;
    ``socket.inet_aton`` parses exactly those without touching the network, so they are
    judged as the address they dial, never as a name.
    """
    candidate = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    try:
        return ipaddress.ip_address(candidate)
    except ValueError:
        pass
    try:
        return ipaddress.IPv4Address(socket.inet_aton(candidate))
    except (OSError, ValueError):
        return None


def _address_refused(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True when ``addr`` is not a public address this fetch may dial."""
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    if any(addr in net for net in _REFUSED_NETWORKS):
        return True
    return not addr.is_global


async def _resolve_host(host: str) -> list[str]:
    """Module-level resolver seam (tests monkeypatch it): every address ``host``
    resolves to, as text. Raises ``OSError`` when it does not resolve."""
    infos = await asyncio.get_running_loop().getaddrinfo(
        host, 443, type=socket.SOCK_STREAM
    )
    # An IPv6 answer can carry a zone ("fe80::1%eth0"); judge the address itself.
    return [str(info[4][0]).split("%", 1)[0] for info in infos]


def _transport() -> httpx.AsyncBaseTransport | None:
    """Module-level transport seam (tests monkeypatch it). ``None`` is httpx's own."""
    return None


def _validate_url(url: str) -> tuple[str, str]:
    """``(hostname, path_and_query)`` of an acceptable link; raises ``DownloadRefused``.

    Pure: no resolution, no I/O. The order is part of the contract: the scheme first,
    then the allow-list (so the shipped empty list refuses everything as
    ``host_not_allowed``), then the shape.
    """
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
        port = parts.port
    except (ValueError, AttributeError):
        raise DownloadRefused("url_shape") from None
    if parts.scheme != "https":
        raise DownloadRefused("scheme")
    if hostname is None or hostname not in ARCHIVE_ALLOWED_HOSTS:
        raise DownloadRefused("host_not_allowed")
    if (
        # netloc equal to the bare hostname rejects userinfo, a port and any parser
        # oddity in one comparison (the ``ops_alert`` idiom).
        parts.netloc.lower() != hostname
        or port is not None
        or parts.fragment
        or not url.isascii()
        or any(ch <= " " or ch == "\x7f" for ch in url)
    ):
        raise DownloadRefused("url_shape")
    path_and_query = parts.path + (f"?{parts.query}" if parts.query else "")
    return hostname, path_and_query


async def _vet_address(host: str) -> str:
    """The one address to connect to; raises ``DownloadRefused`` if ANY answer is
    not public. A resolver is asked exactly once (the rebind defence)."""
    literal = _literal_address(host)
    if literal is not None:
        addresses = [str(literal)]
    else:
        try:
            addresses = await _resolve_host(host)
        except OSError:
            raise DownloadRefused("resolve_failed") from None
    if not addresses:
        raise DownloadRefused("resolve_failed")
    parsed: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for text in addresses:
        try:
            parsed.append(ipaddress.ip_address(text))
        except ValueError:
            raise DownloadRefused("resolve_failed") from None
    # Judge EVERY answer before choosing one: a mixed public+private answer is the
    # shape of a rebind probe.
    if any(_address_refused(a) for a in parsed):
        raise DownloadRefused("private_address")
    return str(parsed[0])


def _container_of(head: bytes) -> str | None:
    """``"zip"`` / ``"gzip"`` from the leading bytes, else ``None``."""
    if head[:4] == _ZIP_MAGIC:
        return "zip"
    if head[:2] == _GZIP_MAGIC:
        return "gzip"
    return None


async def _fetch_body(scheme_host: str, ip: str, host: str, path_and_query: str) -> bytes:
    """Stream the raw (still compressed) body under the compressed cap.

    ⛔ Deliberately NOT ``httpx.AsyncClient``: the client logs ``HTTP Request: GET
    <full url>`` at INFO on the ``httpx`` logger, and that URL carries the signed query
    string (a bearer token). Measured by ``TestNoLinkInLogs``. Driving the transport
    directly sends the one request this module means to send and nothing else: no
    redirect handling, no cookie jar, no environment proxy (a ``HTTPS_PROXY`` would route
    around the address pin), no default auth, and no request log.
    """
    host_literal = f"[{ip}]" if ":" in ip else ip
    request = httpx.Request(
        "GET",
        httpx.URL(f"https://{host_literal}{path_and_query or '/'}"),
        # The connect target is the vetted IP; the hostname rides as Host and as the
        # SNI / certificate-verification name. ``identity``: the bytes as stored, so
        # the magic check sees the container.
        headers={"Host": host, "Accept-Encoding": "identity"},
        extensions={
            "sni_hostname": host,
            "timeout": {
                "connect": CONNECT_TIMEOUT_S,
                "read": TOTAL_TIMEOUT_S,
                "write": CONNECT_TIMEOUT_S,
                "pool": CONNECT_TIMEOUT_S,
            },
        },
    )
    buf = bytearray()
    container_checked = False
    transport = _transport() or httpx.AsyncHTTPTransport(trust_env=False)
    async with transport:
        response = await transport.handle_async_request(request)
        try:
            response.request = request
            status = response.status_code
            if 300 <= status < 400:
                raise DownloadRefused("redirect")
            if status in (403, 410):
                raise LinkExpired()
            if status >= 500 or status in (408, 429):
                # NOT raise_for_status(): its message embeds the signed URL.
                raise httpx.HTTPStatusError(
                    f"archive host answered HTTP {status} ({scheme_host})",
                    request=request,
                    response=response,
                )
            if not 200 <= status < 300:
                raise DownloadRefused("http_status")
            declared = response.headers.get("content-length")
            if declared is not None and declared.isdigit():
                if int(declared) > MAX_COMPRESSED_BYTES:
                    raise DownloadRefused("too_large")
            async for chunk in response.aiter_raw():
                if len(buf) + len(chunk) > MAX_COMPRESSED_BYTES:
                    raise DownloadRefused("too_large")
                buf += chunk
                if not container_checked and len(buf) >= 4:
                    container_checked = True
                    if _container_of(bytes(buf[:4])) is None:
                        raise DownloadRefused("container_unknown")
        finally:
            await response.aclose()
    return bytes(buf)


def _check_inflated(total: int, compressed: int) -> None:
    """Raise when ``total`` decompressed bytes break a cap (checked per chunk)."""
    if total > MAX_DECOMPRESSED_BYTES:
        raise DownloadRefused("too_large")
    if total > MAX_RATIO * compressed:
        raise DownloadRefused("ratio")


def _inflate_gzip(body: bytes) -> bytes:
    """Decompress exactly one gzip member, in bounded chunks, under the caps."""
    inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
    out = bytearray()
    pending = body
    try:
        while pending:
            chunk = inflater.decompress(pending, _CHUNK_BYTES)
            out += chunk
            _check_inflated(len(out), len(body))
            if inflater.eof:
                break
            pending = inflater.unconsumed_tail
            if not chunk and not pending:
                break
    except zlib.error:
        raise DownloadRefused("container_unknown") from None
    # A truncated stream or trailing bytes (a second member) would silently change
    # which days the file covers: refuse rather than return a partial CSV.
    if not inflater.eof or inflater.unused_data:
        raise DownloadRefused("container_unknown")
    return bytes(out)


def _inflate_zip(body: bytes) -> bytes:
    """Read the single member of a zip in memory, under the caps. The member name is
    never used: ``extractall`` and every path-building API are deliberately absent."""
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            members = archive.infolist()
            if len(members) != 1:
                raise DownloadRefused("zip_members")
            member = members[0]
            if member.flag_bits & 0x1:
                raise DownloadRefused("zip_encrypted")
            # The declared size is attacker-controlled and only an early exit; the
            # running counter below is the real cap.
            _check_inflated(member.file_size, len(body))
            out = bytearray()
            with archive.open(member) as handle:
                while True:
                    chunk = handle.read(_CHUNK_BYTES)
                    if not chunk:
                        break
                    out += chunk
                    _check_inflated(len(out), len(body))
            return bytes(out)
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, zlib.error):
        # Corrupt/truncated archive, an unsupported compression method, a CRC miss.
        raise DownloadRefused("container_unknown") from None


def _decompress(body: bytes) -> tuple[bytes, str]:
    container = _container_of(body[:4])
    if container is None:
        raise DownloadRefused("container_unknown")
    if container == "gzip":
        return _inflate_gzip(body), container
    return _inflate_zip(body), container


async def download_archive_csv(url: str) -> tuple[bytes, str, int]:
    """Download one archive link and return ``(csv_bytes, container, compressed_bytes)``.

    ``container`` is ``"zip"`` or ``"gzip"``; ``compressed_bytes`` is the body size as
    streamed (plan 16 records it with ``len(csv_bytes)`` so plan 14 can compare the real
    sizes with the caps). Raises ``DownloadRefused`` (permanent), ``LinkExpired`` (the
    caller re-requests a fresh link once); network errors, timeouts and 5xx/408/429
    propagate as the caller's transient class. Nothing is written to disk.
    """
    scheme, host_for_log = describe_href(url)
    scheme_host = f"{scheme}://{host_for_log}"
    try:
        host, path_and_query = _validate_url(url)
        ip = await _vet_address(host)
        body = await asyncio.wait_for(
            _fetch_body(scheme_host, ip, host, path_and_query),
            timeout=TOTAL_TIMEOUT_S,
        )
        # CPU-bound and capped, but a 512 MiB inflate must not stall the event loop.
        csv_bytes, container = await asyncio.to_thread(_decompress, body)
    except DownloadRefused as refusal:
        # Scheme and host only; the path and query are the bearer token.
        logger.error(
            "okx_archive_download: refused (reason=%s) for %s", refusal.reason, scheme_host
        )
        raise
    except LinkExpired:
        logger.warning("okx_archive_download: link expired for %s", scheme_host)
        raise
    except (httpx.HTTPError, TimeoutError) as exc:
        # Transient (network, timeout, 5xx/408/429): the caller retries. The class
        # name only; an httpx message can embed the request URL.
        logger.warning(
            "okx_archive_download: transient failure (exc_class=%s) for %s",
            type(exc).__name__,
            scheme_host,
        )
        raise
    logger.info(
        "okx_archive_download: fetched %s container=%s compressed_bytes=%d "
        "decompressed_bytes=%d",
        scheme_host,
        container,
        len(body),
        len(csv_bytes),
    )
    return csv_bytes, container, len(body)
