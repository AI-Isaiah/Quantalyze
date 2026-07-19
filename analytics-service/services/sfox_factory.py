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

from services.sfox_client import SFOX_PROD_BASE_URL, SfoxClient


def worker_egress_proxy_url() -> str | None:
    """Read WORKER_EGRESS_PROXY_URL. Empty/unset ⇒ None (direct egress, today's default)."""
    url = os.getenv("WORKER_EGRESS_PROXY_URL")
    return url or None  # "" ⇒ None (deviation (b))


def make_sfox_client(api_key: str, base_url: str = SFOX_PROD_BASE_URL) -> SfoxClient:
    """Construct a SfoxClient with the worker egress proxy threaded EXPLICITLY.

    `api_key` passes through UNCHANGED — the factory never `.strip()`s (deviation
    (a)); the call site owns its exact credential expression. `proxy=` is always
    explicit, so trust_env stays False inside SfoxClient (Pitfall 4 trap avoided).
    """
    return SfoxClient(api_key=api_key, base_url=base_url, proxy=worker_egress_proxy_url())
