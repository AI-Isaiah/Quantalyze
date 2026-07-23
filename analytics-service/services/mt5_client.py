"""Mt5Client — a narrow, SYNCHRONOUS, READ-ONLY facade over a MetaTrader 5
terminal reached as a pure network client via `mt5linux.MetaTrader5` (RPyC).

MT5GW-02 contract. The worker NEVER imports the Windows-only `MetaTrader5`
package in-process; it wraps the RPyC proxy behind this typed interface, the same
isolation posture SfoxClient uses for its aiohttp session. Downstream phases 135
(Source registration / validate) and 136 (equity reconstruction) stub against the
shape defined here, so the disciplines below are load-bearing.

Contract:

  * Surface (read-only by CONSTRUCTION) — `login`, `account_info`,
    `history_deals_get`, `order_check` (probe only), `close`. Read-only is a
    STRUCTURAL property, not a probed scope claim: the underlying `mt5linux`
    client exposes the FULL trading surface (order_send, positions_get,
    orders_get, ...), but this facade composes ONLY the read methods plus the
    order_check probe and NEVER wraps the trade path. There is NO generic
    attribute-forwarding passthrough (no dunder getattr hook) — such a facade would
    silently re-expose that trade path and defeat the whole `api_verified` trust
    story. The forbidden
    trade method (referred to here without call parentheses so the grep gate stays
    clean) is intentionally absent.

  * Return discipline (fail-loud, no invented data) — every read distinguishes
    `None` (RPyC/terminal error -> capture `last_error()` IMMEDIATELY and raise a
    typed `Mt5ClientError` carrying the (code, text)) from `()` (an honest empty
    result). Conflating them fabricates a flat/empty account — the highest-severity
    correctness pitfall for this source. A degenerate (non-namedtuple) shape also
    raises. `last_error()` must be read immediately because the next remote call
    overwrites it.

  * Materialization (netref -> native) — RPyC returns namedtuples as live netref
    proxies. Every structured read is materialized to a plain native dict via
    `._asdict()` before returning, so a caller never holds a proxy that dies with
    the connection.

  * Dual timeout (Pitfall 3 / T-134-04) — there are TWO independent timeouts and
    their ORDERING matters:
      - `MT5_REQUEST_TIMEOUT_S` sets the rpyc `sync_request_timeout` (via the
        mt5linux constructor `timeout=`): how long the worker waits for a remote
        round-trip before rpyc raises. Its implicit default is 300s — a hung
        terminal would block the SEQUENTIAL worker for 5 minutes, far past the
        ~90s healthz budget (the v1.11 WEDGE-01 failure class).
      - `MT5_LOGIN_TIMEOUT_MS` is passed to MT5's own `login(timeout=<ms>)` IPC
        pipe ceiling and MUST stay strictly BELOW the rpyc timeout, so MT5 fails
        its own pipe first and rpyc surfaces a clean error instead of a raw abort.
    The outer `asyncio.to_thread` + `asyncio.wait_for` event-loop bound is a Phase
    136/137 worker-seam concern, NOT part of this synchronous, blocking client.

  * Secret hygiene (T-134-01) — the login / investor password / broker server
    NEVER appear in any exception message or log surface. `mt5linux`
    f-string-interpolates the password into the remotely-eval'd code, so a leaked
    error string is a real credential disclosure; every error detail passes
    through `services.redact.scrub_freeform_string` at `Mt5ClientError`
    construction, and the interpolated remote `code` string is never logged.

  * Transport security (T-134-03, constraint documented; hardening owned by Phase
    139) — `mt5linux` speaks rpyc classic / SlaveService, an UNAUTHENTICATED
    arbitrary-remote-code channel. The bridge MUST only ever be reachable over a
    PRIVATE network (Railway internal / WireGuard / SSH tunnel), NEVER a public
    port.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Callable, NoReturn

from services.redact import scrub_freeform_string

logger = logging.getLogger("quantalyze.analytics")

# rpyc `sync_request_timeout` (seconds). Its mt5linux/rpyc default is 300s — a
# hung terminal would wedge the SEQUENTIAL worker for 5 minutes, far past the
# ~90s healthz budget (v1.11 WEDGE-01). 30s is comfortably above normal MT5 read
# latency yet well under the healthz budget, so a stalled bridge fails loud fast.
MT5_REQUEST_TIMEOUT_S = float(os.getenv("MT5_REQUEST_TIMEOUT_S", "30"))

# MT5's own IPC pipe timeout (milliseconds) passed to login(timeout=...). MUST
# stay strictly BELOW MT5_REQUEST_TIMEOUT_S (converted to ms) so MT5 fails its
# own pipe first and rpyc surfaces a clean error rather than a raw mid-handshake
# abort (Pitfall 3 / T-134-04). 20000ms < 30_000ms with headroom.
MT5_LOGIN_TIMEOUT_MS = int(os.getenv("MT5_LOGIN_TIMEOUT_MS", "20000"))


class Mt5ClientError(RuntimeError):
    """Fail-loud typed error carrying the MT5 `(code, text)` from `last_error()`.

    Carries `self.code` so callers (Phase 135 validate branch) can distinguish
    auth/server failures from transient errors. The message NEVER contains a
    secret; the detail text is scrubbed via `scrub_freeform_string` at
    construction (T-134-01).
    """

    def __init__(self, code: int, detail: str) -> None:
        self.code = code
        super().__init__(f"MT5 client error (code={code}): {scrub_freeform_string(detail)}")


def _default_connect(*, host: str, port: int, timeout: float) -> Any:
    """Construct the real `mt5linux.MetaTrader5` transport.

    The `mt5linux` import is LAZY — inside this function body only — so importing
    `services.mt5_client` does not require the package. `mt5linux` is not installed
    until the plan 134-03 human-verify gate clears; a module-level import would red
    the whole analytics suite in CI today. `timeout` sets the rpyc
    `sync_request_timeout` (the constructor `timeout=` knob).
    """
    from mt5linux import MetaTrader5  # noqa: PLC0415 — intentional lazy transport import

    return MetaTrader5(host, port, timeout)


def _coerce(value: Any) -> Any:
    """Coerce a materialized field to a native scalar. Pass int/float/str/bool/None
    through; stringify anything else so a netref scalar never leaks to the caller."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def _materialize(obj: Any) -> dict:
    """Materialize a netref namedtuple to a native dict. Fail loud on a degenerate
    (non-namedtuple) shape — never coerce it into an empty/partial dict."""
    asdict = getattr(obj, "_asdict", None)
    if asdict is None:
        raise Mt5ClientError(0, "MT5 returned a non-namedtuple/degenerate shape")
    return {str(k): _coerce(v) for k, v in asdict().items()}


class Mt5Client:
    """Read-only narrowing facade over `mt5linux.MetaTrader5` (RPyC). Synchronous
    by construction — rpyc classic is blocking. See module docstring."""

    def __init__(
        self,
        host: str,
        port: int,
        *,
        _connect: Callable[..., Any] | None = None,
        request_timeout_s: float = MT5_REQUEST_TIMEOUT_S,
    ) -> None:
        # Enforce the load-bearing dual-timeout ORDERING (Pitfall 3 / T-134-04)
        # where the two effective values finally meet: the MT5 login IPC timeout
        # (ms) MUST stay strictly BELOW the rpyc sync_request_timeout (s -> ms) so
        # MT5 fails its own pipe first and rpyc surfaces a clean error instead of a
        # raw mid-handshake abort. A too-small request_timeout_s (ctor arg or a low
        # MT5_REQUEST_TIMEOUT_S env) silently inverts it and reopens the v1.11
        # WEDGE-01 wedge class, so fail loud at construction rather than at a hung
        # live login.
        if MT5_LOGIN_TIMEOUT_MS >= request_timeout_s * 1000:
            raise ValueError(
                "MT5 login IPC timeout must be strictly below the rpyc request "
                f"timeout ({MT5_LOGIN_TIMEOUT_MS}ms >= "
                f"{request_timeout_s * 1000:.0f}ms) — this inversion reopens the "
                "v1.11 WEDGE-01 wedge class."
            )
        # `_connect` is the injectable transport seam for the offline contract
        # suite (mirrors SfoxClient's _clock/_sleep injection). Default is the
        # lazy real transport.
        connect = _connect or _default_connect
        self._mt5 = connect(host=host, port=port, timeout=request_timeout_s)
        self._closed = False

    def _raise_last(self) -> NoReturn:
        """Capture `last_error()` IMMEDIATELY (the next remote call overwrites it)
        and raise a typed, secret-scrubbed error."""
        err = self._mt5.last_error()
        code, text = (err[0], err[1]) if err else (0, "unknown")
        raise Mt5ClientError(int(code), str(text))

    def _guarded_read(self, call: Callable[[], Any]) -> Any:
        """Run a raw transport read, converting ANY transport-RAISED exception
        into a scrubbed, typed `Mt5ClientError` (T-134-01). `mt5linux` speaks rpyc
        classic: a round-trip that raises (a remote traceback carrying the
        interpolated `code` source line, a mid-handshake abort, an rpyc timeout)
        would otherwise escape UNSCRUBBED — the exact credential-disclosure class
        the module docstring flags. This is fail-loud, just scrubbed: the error
        still propagates, never swallowed. An `Mt5ClientError` we constructed
        (e.g. a `_materialize` degenerate-shape raise) passes through unchanged.
        Only RAISES are intercepted — the `None` (error) vs `()` (honest empty)
        RETURN discipline is untouched (the returned value is handed straight
        back)."""
        try:
            return call()
        except Mt5ClientError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
            raise Mt5ClientError(0, scrub_freeform_string(str(exc))) from None

    def login(self, login: int, password: str, server: str) -> None:
        """Log the terminal into the broker account. A falsy return (bad
        credentials / wrong server — both surface as an opaque False) -> typed
        raise. A transport-RAISED exception is caught and re-raised as a scrubbed
        typed error — `mt5linux` f-string-interpolates the password into the
        remotely-eval'd code, so a raw rpyc remote traceback is a real credential
        disclosure (T-134-01). Because the credential values are in scope here,
        they are ALSO redacted by value (login/server, not just `password=`
        shapes) on top of the shape-based `scrub_freeform_string`. The MT5 IPC
        login timeout is passed explicitly and stays below the rpyc request
        timeout (Pitfall 3)."""
        try:
            ok = self._mt5.login(
                login, password=password, server=server, timeout=MT5_LOGIN_TIMEOUT_MS
            )
        except Mt5ClientError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
            safe = scrub_freeform_string(str(exc))
            for literal in (str(login), password, server):
                if literal:
                    safe = safe.replace(literal, "[REDACTED]")
            raise Mt5ClientError(0, safe) from None
        if not ok:
            self._raise_last()

    def account_info(self) -> dict:
        """Current account snapshot as a native dict. None (error) -> typed raise."""
        info = self._guarded_read(self._mt5.account_info)
        if info is None:
            self._raise_last()
        return _materialize(info)

    def history_deals_get(self, from_ts: Any, to_ts: Any) -> list[dict]:
        """Deals in [from_ts, to_ts) as native dicts. `None` is an ERROR -> typed
        raise (NEVER a truthiness check on `deals` — that conflates the error with
        the honest empty `()`); `()` -> `[]`; a populated tuple -> materialized
        dicts. The raw
        server-time `time`/`time_msc` epochs are returned VERBATIM — the
        normalize-to-UTC seam is Phase 136, not this client."""
        deals = self._guarded_read(lambda: self._mt5.history_deals_get(from_ts, to_ts))
        if deals is None:
            self._raise_last()
        return [_materialize(d) for d in deals]

    def order_check(self, request: dict) -> dict:
        """PROBE ONLY. Materialize an `order_check` result to a native dict; `None`
        (error) -> typed raise.

        This exists solely for the Phase-135 validate-time investor-vs-master
        rejection (MT5SRC-02); this facade never wraps the trade path (referred to
        here without call parentheses). `order_check` validates margin/funds and
        does NOT place an order. The exact investor retcode/comment signal is
        [ASSUMED] pending MT5SPIKE-01 leg 2 — the Phase-135 rule must combine the
        order_check retcode/comment WITH account_info().trade_allowed (Pitfall 4).
        """
        result = self._guarded_read(lambda: self._mt5.order_check(request))
        if result is None:
            self._raise_last()
        return _materialize(result)

    def close(self) -> None:
        """Bounded, idempotent shutdown of the terminal session. A teardown failure
        is swallowed so it never masks the caller's error, and shutdown() is never
        called twice (mirrors SfoxClient.aclose)."""
        if self._closed:
            return
        self._closed = True
        try:
            self._mt5.shutdown()
        except Exception:  # noqa: BLE001 — a close error must not mask caller errors
            logger.warning("Mt5Client.close: shutdown() raised; swallowing.")
