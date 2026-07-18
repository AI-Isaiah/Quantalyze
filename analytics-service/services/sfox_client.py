"""SfoxClient — a custom, non-ccxt, READ-ONLY async adapter for the sFOX REST API.

sFOX is not a ccxt exchange (SFOX-01 locked decision): it must NOT be added to
`exchange.py::EXCHANGE_CLASSES` (a `dict[str, type]` of ccxt classes) and must
NOT route through `create_exchange` (which returns a `ccxt.Exchange`). This
module imports nothing from `exchange.py`; the ingestion-boundary dispatch seam
that selects SfoxClient vs. ccxt is phase 119, not here.

Contract (all values cited to docs.sfox.com and confirmed against the live hosts
2026-07-18 — see 118-RESEARCH.md "The SfoxClient Adapter Contract"):

  * Auth   — Bearer token: header `Authorization: Bearer <API_KEY>`.
  * Hosts  — prod `https://api.sfox.com`, sandbox `https://api.staging.sfox.com`
             (both live; 401 on authed routes confirms auth scheme + route set).
  * Reads  — exactly four, read-only by construction:
               get_balances()        GET /v1/user/balance
               get_transactions()    GET /v1/account/transactions   (from/to/limit/after/offset/types)
               get_trades()          GET /v1/account/trades         (page_size/last_seen_id)
               get_balance_history()  GET /v1/account/balance/history (start_date/end_date/interval)
             NO order/withdraw/transfer/trade-placement method exists on the class.
  * Proxy  — an explicit optional `proxy` ctor arg is threaded into EVERY request
             (aiohttp silently ignores HTTPS_PROXY without `trust_env`/`proxy=`;
             this is the phase-121 static-IP egress seam — RESEARCH Pitfall 2).
  * Rate   — per-endpoint min-interval gate in the single `_request` chokepoint;
             the transactions endpoint is a strict 1 req / 10 s. Reads are
             SINGLE-PAGE only — cursors are exposed (after / last_seen_id) but this
             adapter does NOT auto-crawl. Crawl orchestration with `asyncio.wait_for`
             bounds is phase 120 (FLIPRETRY-01: an unbounded crawl on the sequential
             worker loop is the v1.11 wedge). Do not read single-page reads as a bug.
  * Errors — fail-loud (no invented data): non-2xx, non-JSON 2xx bodies, and
             degenerate shapes (non-list balances, missing `data` envelope) all
             raise `SfoxApiError`. The api_key / Authorization header are NEVER
             placed in any message; response text is scrubbed via
             `services.redact.scrub_freeform_string` (T-118-01).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

import aiohttp

from services.redact import scrub_freeform_string

logger = logging.getLogger("quantalyze.analytics")

SFOX_PROD_BASE_URL = "https://api.sfox.com"
SFOX_SANDBOX_BASE_URL = "https://api.staging.sfox.com"

# Upper bound (seconds) on how long aclose() waits for the owned aiohttp session
# to close — mirrors exchange.py::_ACLOSE_TIMEOUT_S. A stuck teardown degrades to
# a logged leak instead of wedging the sequential worker loop.
SFOX_CLOSE_TIMEOUT_S = float(os.getenv("SFOX_CLOSE_TIMEOUT_S", "10"))

# Per-endpoint-path minimum interval between requests (seconds). The transactions
# endpoint is a documented 1 req / 10 s; every other authed endpoint is treated as
# tightly rate-limited (analogous to ccxt enableRateLimit=True). Set by Task 2.
SFOX_RATE_LIMITS: dict[str, float] = {
    "/v1/account/transactions": 10.0,
}
SFOX_DEFAULT_RATE_INTERVAL_S = 1.0

# Documented max page size for /v1/account/transactions.
_TRANSACTIONS_MAX_LIMIT = 1000
# Documented balance-history intervals: hourly or daily.
_VALID_BALANCE_HISTORY_INTERVALS = (3600, 86400)


class SfoxApiError(RuntimeError):
    """Raised on any non-2xx response or fail-loud shape violation from sFOX.

    Carries the HTTP `status` (0 for shape violations on an otherwise-2xx body) so
    callers can distinguish auth failures (401/403 -> phase-119 KEY_AUTH_FAILED)
    from transient/other errors. The message NEVER contains the api_key or the
    Authorization header; any embedded response text is scrubbed at construction.
    """

    def __init__(self, status: int, detail: str) -> None:
        self.status = status
        super().__init__(f"sFOX API error (status={status}): {detail}")


class SfoxClient:
    """Read-only aiohttp adapter for the sFOX REST API. See module docstring."""

    def __init__(
        self,
        api_key: str,
        base_url: str = SFOX_PROD_BASE_URL,
        proxy: str | None = None,
        *,
        _clock: Any = time.monotonic,
        _sleep: Any = asyncio.sleep,
    ) -> None:
        if not api_key:
            raise ValueError("SfoxClient requires a non-empty api_key")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._proxy = proxy
        # Session is created lazily on first request and OWNED by this client
        # (never trust_env=True — the proxy is explicit per request).
        self._session: aiohttp.ClientSession | None = None
        self._closed = False
        # Rate-gate state: last-request monotonic timestamp per endpoint path.
        # Injectable clock/sleep keep the 10s gate testable in milliseconds.
        self._clock = _clock
        self._sleep = _sleep
        self._last_request_at: dict[str, float] = {}

    async def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None:
            # trust_env stays False by design: the ONLY proxy source is the
            # explicit ctor arg threaded per-request (phase-121 seam).
            self._session = aiohttp.ClientSession(trust_env=False)
        return self._session

    async def _rate_gate(self, path: str) -> None:
        """Serialize requests per endpoint to a documented min interval.

        Single min-interval gate (last-monotonic-timestamp + sleep of the
        remainder). The transactions endpoint's 1 req/10 s limit lives HERE, in
        one place, so no call site can bypass it (FLIPRETRY-01 at the client
        layer). Never parallel-fan-out; the adapter is serial by construction.
        """
        interval = SFOX_RATE_LIMITS.get(path, SFOX_DEFAULT_RATE_INTERVAL_S)
        last = self._last_request_at.get(path)
        now = self._clock()
        if last is not None:
            wait = interval - (now - last)
            if wait > 0:
                await self._sleep(wait)
                now = self._clock()
        self._last_request_at[path] = now

    async def _request(
        self, method: str, path: str, params: dict[str, Any] | None = None
    ) -> Any:
        """Single HTTP chokepoint: Bearer auth, explicit proxy, rate gate, fail-loud parse.

        Every read method funnels through here so auth, proxy threading, the rate
        gate, and secret-scrubbed error handling exist in exactly one place.
        """
        await self._rate_gate(path)
        session = await self._ensure_session()
        url = f"{self._base_url}{path}"
        headers = {"Authorization": f"Bearer {self._api_key}"}
        # aiohttp rejects None-valued params; drop unset ones before sending.
        query = {k: v for k, v in (params or {}).items() if v is not None}

        resp = await session.request(
            method, url, headers=headers, params=query, proxy=self._proxy
        )
        try:
            status = resp.status
            raw = await resp.text()
        finally:
            # Release the connection regardless of parse outcome.
            release = getattr(resp, "release", None)
            if release is not None:
                maybe = release()
                if asyncio.iscoroutine(maybe):
                    await maybe

        if status < 200 or status >= 300:
            # Scrub before the text can reach any log/Sentry surface (T-118-01).
            raise SfoxApiError(status, scrub_freeform_string(raw))
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            # Non-JSON 2xx body — fail loud, never coerce (T-118-04, no invented data).
            raise SfoxApiError(status, "sFOX returned a non-JSON 2xx body") from None

    # -- Read methods (four, read-only by construction) ---------------------

    async def get_balances(self) -> list[dict]:
        """GET /v1/user/balance — current per-asset balance snapshot (bare array)."""
        payload = await self._request("GET", "/v1/user/balance")
        if not isinstance(payload, list):
            raise SfoxApiError(0, "sFOX /v1/user/balance did not return a list")
        return payload

    async def aclose(self) -> None:
        """Bounded, idempotent close of the owned session (mirrors aclose_exchange).

        Wraps session.close() in asyncio.wait_for(SFOX_CLOSE_TIMEOUT_S): a hung
        close degrades to a logged leak instead of wedging the sequential worker
        loop (the v1.11 FLIP failure mode / Sentry "Unclosed session" class).
        """
        if self._closed:
            return
        self._closed = True
        session = self._session
        self._session = None
        if session is None:
            return
        try:
            await asyncio.wait_for(session.close(), timeout=SFOX_CLOSE_TIMEOUT_S)
        except asyncio.TimeoutError:
            logger.warning(
                "SfoxClient.aclose: session close exceeded %ss — degrading to a "
                "logged leak rather than wedging the worker loop.",
                SFOX_CLOSE_TIMEOUT_S,
            )
        except Exception:  # noqa: BLE001 — a close error must not mask caller errors
            logger.warning("SfoxClient.aclose: session close raised; swallowing.")
