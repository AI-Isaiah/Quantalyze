"""SFOX-07 (121-02) — the ONE place WORKER_EGRESS_PROXY_URL becomes an explicit proxy.

aiohttp ignores `HTTPS_PROXY`/`HTTP_PROXY` env vars unless `trust_env=True`, and
`SfoxClient` is `trust_env=False` by design (sfox_client.py). So the static-egress
proxy must be threaded EXPLICITLY as the `proxy=` ctor arg at every SfoxClient
construction site. This factory reads the env once and constructs the client with
`proxy=worker_egress_proxy_url()` — never via aiohttp trust_env (RESEARCH Pitfall 4).

Two DELIBERATE deviations from RESEARCH Pattern 2, documented here:
  (a) NO `.strip()` inside the factory. The byte-identical mandate means each call
      site keeps its EXACT current credential expression — job_worker/internal
      already `.strip()`; routers/exchange + ingestion receive pre-trimmed input
      from the TS validate/encrypt chokepoint. Stripping here would change one of
      those sites' observable behavior.
  (b) An empty-string env (`WORKER_EGRESS_PROXY_URL=""`, how an unset Railway var
      reads) coerces to None — byte-identical to truly unset.

SECRET HYGIENE (T-121-06 / Pitfall 5): the proxy URL carries the proxy BasicAuth
secret. This module NEVER logs or reprs it — no `logger`, no `print`.

Imports only `os` + `sfox_client` (no cycle: sfox_client imports nothing from
exchange.py; this module imports nothing from exchange.py either).
"""
from __future__ import annotations

import os
import urllib.parse

from services.sfox_client import SFOX_PROD_BASE_URL, SfoxClient


def worker_egress_proxy_url() -> str | None:
    """Read WORKER_EGRESS_PROXY_URL. Empty/whitespace-only/unset ⇒ None.

    Empty coerces to None (deviation (b) — how an unset Railway var reads).
    F5 (121): an all-whitespace value is ALSO deploy-config noise (a fat-fingered
    "   " edit); coerce it to None too so it stays byte-identical to truly unset,
    rather than being handed to aiohttp as a confusing `InvalidURL('')`-class
    error. `"".isspace()` is False, so the empty case is caught by the falsy guard
    and the all-whitespace case by `.isspace()`. `.isspace()` is used deliberately
    instead of `.strip()` — the module's guard test forbids any `.strip()` here
    (deviation (a): call sites own the trim), and this is a whitespace-ONLY
    detector, not a mutation of the value.
    """
    url = os.getenv("WORKER_EGRESS_PROXY_URL")
    if not url or url.isspace():
        return None
    return url


def _validate_proxy_url(url: str) -> None:
    """Fail LOUD on a genuinely-malformed non-empty proxy URL (F5).

    A malformed WORKER_EGRESS_PROXY_URL (bad port, missing scheme, missing host)
    must not be threaded silently into aiohttp/ccxt only to surface later as an
    opaque transport error far from the config mistake. Raise a clear ValueError
    at the construction seam instead.

    SECRET HYGIENE: the message NEVER echoes the URL. The port-cast branch used to
    scrub-and-echo str(exc), but urlsplit parses a URL TRUNCATED at '@' (e.g. a
    copy-cut `scheme://user:PASSWORD`) with PASSWORD in the PORT slot, so str(exc)
    IS the secret — and scrub_url_userinfo is a structural no-op on a string with no
    `://...@`. Both branches now name the failure mode WITHOUT the value.
    """
    try:
        parts = urllib.parse.urlsplit(url)
        _ = parts.port  # `.port` property raises ValueError on a non-numeric port
    except ValueError:
        raise ValueError(
            "WORKER_EGRESS_PROXY_URL is malformed: the port is missing or "
            "non-numeric (expected http(s)://[user:pass@]host:PORT)"
        ) from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError(
            "WORKER_EGRESS_PROXY_URL must be of the form "
            "http(s)://[user:pass@]host:port (scheme or host missing/unsupported)"
        )


def make_sfox_client(api_key: str, base_url: str = SFOX_PROD_BASE_URL) -> SfoxClient:
    """Construct a SfoxClient with the worker egress proxy threaded EXPLICITLY.

    `api_key` passes through UNCHANGED — the factory never `.strip()`s (deviation
    (a)); the call site owns its exact credential expression. `proxy=` is always
    explicit, so trust_env stays False inside SfoxClient (Pitfall 4 trap avoided).

    F5 (121): when a proxy URL IS present, its shape is validated fail-loud before
    construction (a malformed URL raises a clear, secret-free ValueError). When the
    env is unset/empty/whitespace the proxy is None and validation is skipped —
    byte-identical to today's direct-egress default.
    """
    proxy = worker_egress_proxy_url()
    if proxy is not None:
        _validate_proxy_url(proxy)
    return SfoxClient(api_key=api_key, base_url=base_url, proxy=proxy)
