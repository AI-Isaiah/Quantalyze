"""Mt5Client — a narrow, SYNCHRONOUS, READ-ONLY facade over a MetaTrader 5
terminal reached as a pure network client via `mt5linux.MetaTrader5` (RPyC).

MT5GW-02 contract. The worker NEVER imports the Windows-only `MetaTrader5`
package in-process; it wraps the RPyC proxy behind this typed interface, the same
isolation posture SfoxClient uses for its aiohttp session. Downstream phases 135
(Source registration / validate) and 136 (equity reconstruction) stub against the
shape defined here, so the disciplines below are load-bearing.

Contract:

  * Surface (read-only by CONSTRUCTION) — `login`, `account_info`,
    `terminal_info`, `history_deals_get`, `order_check` (probe only), `close`.
    Read-only is a STRUCTURAL property, not a probed scope claim: the underlying
    `mt5linux` client exposes the FULL trading surface (order_send,
    positions_get, orders_get, ...), but this facade composes ONLY the read
    methods plus the order_check probe and NEVER wraps the trade path. There is
    NO generic attribute-forwarding passthrough (no dunder getattr hook) — such a
    facade would silently re-expose that trade path and defeat the whole
    `api_verified` trust story. The forbidden trade method (referred to here
    without call parentheses so the grep gate stays clean) is absent.
    `terminal_info` (153.3 / D-31) reads OUR terminal: a READ-surface widening.

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
      - EVERY MT5 call that carries its own `timeout=` (milliseconds) is
        registered in `MT5_IPC_TIMEOUTS_MS` — `initialize` and `login` today —
        and each one MUST stay strictly BELOW the rpyc timeout, so MT5 fails its
        own pipe first and rpyc surfaces a clean error instead of a raw abort.
        The ordering is enforced for the WHOLE table at construction (153.3 /
        D-24); it used to be enforced for `login` alone, and the unregistered
        `initialize()` — running on MetaTrader5's vendor default of 60 000ms,
        2x the rpyc bound — is what censored 9/9 production logins at the 30s
        ceiling (2026-08-06/08).
    The chain is PER-INSTANCE: `request_timeout_s` and the per-call `*_timeout_ms`
    ctor overrides let an interactive caller build a LONGER chain without moving
    the module constants, which the SEQUENTIAL worker depends on staying at 30s
    (D-25).
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
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, NoReturn

from services.redact import scrub_freeform_string

logger = logging.getLogger("quantalyze.analytics")

# rpyc `sync_request_timeout` (seconds). rpyc 5.x's own DEFAULT_CONFIG default is
# 30s (NOT 300s — that is mt5linux 0.1.10's hardcode, and we pin 0.1.9), so an
# unset knob would already bound a hung terminal at 30s; we set it EXPLICITLY on
# the connection (see `_default_connect`) so this env var, not the rpyc default,
# governs the wire. A hung terminal must not wedge the SEQUENTIAL worker past the
# ~90s healthz budget (v1.11 WEDGE-01); 30s is comfortably above normal MT5 read
# latency yet well under the healthz budget, so a stalled bridge fails loud fast.
MT5_REQUEST_TIMEOUT_S = float(os.getenv("MT5_REQUEST_TIMEOUT_S", "30"))

# MT5's own IPC pipe timeout (milliseconds) passed to login(timeout=...). MUST
# stay strictly BELOW MT5_REQUEST_TIMEOUT_S (converted to ms) so MT5 fails its
# own pipe first and rpyc surfaces a clean error rather than a raw mid-handshake
# abort (Pitfall 3 / T-134-04). 20000ms < 30_000ms with headroom.
MT5_LOGIN_TIMEOUT_MS = int(os.getenv("MT5_LOGIN_TIMEOUT_MS", "20000"))

# MT5's own IPC pipe timeout (milliseconds) passed to initialize(timeout=...).
# 153.3 / D-24 — THE ROOT CAUSE this constant exists to delete: MetaTrader5's
# vendor default for `initialize(timeout=...)` is 60000ms, i.e. 2x the 30000ms
# rpyc bound above. Left unset, the FIRST MT5 call of every login is structurally
# incapable of returning an MT5-level answer before rpyc gives up — which is why
# all 9/9 correlated gateway<->worker failures on 2026-08-06/08 clustered at
# 30.1-31.0s (a fixed ceiling, not a latency distribution). Like the login value
# it MUST stay strictly below the EFFECTIVE request_timeout_s (the ctor arg, not
# necessarily the module constant); the guard in __init__ enforces that.
MT5_INITIALIZE_TIMEOUT_MS = int(os.getenv("MT5_INITIALIZE_TIMEOUT_MS", "20000"))

# The registry of every MT5 call that carries its OWN `timeout=` (milliseconds),
# mapped to its default value.
#
# ⛔ ANY MT5 call that carries its own timeout MUST appear here. Both the
# construction-time ordering guard (`Mt5Client.__init__`) and the source-derived
# completeness test (`tests/test_mt5_client_contract.py`) read this table, so a
# call bound OUTSIDE it is unguarded and untested — which is exactly the D-24
# defect: `initialize()` was bound nowhere, the guard covered `login()` only, and
# the resulting inversion censored every production verdict for months.
MT5_IPC_TIMEOUTS_MS: dict[str, int] = {
    "initialize": MT5_INITIALIZE_TIMEOUT_MS,
    "login": MT5_LOGIN_TIMEOUT_MS,
}


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


class Mt5AccountMismatchError(Exception):
    """MT5CONC-02 — the live terminal presented an account whose ``login`` does NOT
    match the connected key's expected login (or omitted the field entirely).

    Deliberately a PLAIN ``Exception``, NOT an ``Mt5ClientError`` subclass: a
    mismatch is a mis-routed/stale-terminal INFRA fault, never a user-credential
    fault, so the job-worker's ``except Mt5ClientError`` classify/stamp arm (which
    can write a user-attributed permanent ``failed`` analytics row) must be
    structurally UNABLE to absorb it. It routes instead to a dedicated no-stamp,
    no-persist, transient+restart branch — THE guarantee that ``api_verified`` is
    never stamped on the wrong account's numbers.

    Secret hygiene: the message carries ONLY the two login values (an account
    number is an ``int``, not a secret). The broker server and password are NEVER
    interpolated, so — unlike ``Mt5ClientError`` — no scrubbing dependency applies
    (nothing freeform enters the message).
    """

    def __init__(self, expected: object, actual: object) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(
            f"MT5 account mismatch: expected login {expected}, "
            f"terminal presented {actual}"
        )


def _default_connect(*, host: str, port: int, timeout: float) -> Any:
    """Construct the real `mt5linux.MetaTrader5` transport.

    The `mt5linux` import is LAZY — inside this function body only — so importing
    `services.mt5_client` does not require the package. `mt5linux` is not installed
    until the plan 134-03 human-verify gate clears; a module-level import would red
    the whole analytics suite in CI today.

    mt5linux 0.1.9's constructor is ``MetaTrader5(host, port)`` ONLY — it hardwires
    ``rpyc.classic.connect(host, port)`` internally with NO ``timeout=`` knob (that
    param exists only in >=0.1.10, which we deliberately pin OUT — the 0.1.10
    ``shell=True`` server regression, see the go-live runbook / gateway constraint).
    Passing ``timeout`` as a third positional raised ``TypeError`` on EVERY real
    connect (masked in CI: the contract tests inject a ``_connect`` double and
    mt5linux is never installed). So construct with ``(host, port)`` and set the
    rpyc ``sync_request_timeout`` directly on the private connection — the only knob
    0.1.9 exposes — so ``MT5_REQUEST_TIMEOUT_S`` actually governs the wire (its own
    default is 30s, NOT 300s).
    """
    from mt5linux import MetaTrader5  # type: ignore[import-not-found]  # noqa: PLC0415 — intentional lazy transport import

    mt5 = MetaTrader5(host, port)
    # ponytail: name-mangled private attr (`__conn`) + rpyc-internal `_config`;
    # stable because mt5linux is pinned ==0.1.9 and rpyc `_config` is stable across
    # the 5.x line. This is the ONLY per-request timeout knob 0.1.9 exposes.
    mt5._MetaTrader5__conn._config["sync_request_timeout"] = timeout
    return mt5


def _epoch_bound(ts: Any) -> Any:
    """Coerce a history-window bound to int epoch seconds for mt5linux 0.1.9's
    datetime-less remote eval (see `Mt5Client.history_deals_get`): a `datetime` bound
    would f-string-interpolate as `datetime.datetime(...)` and remote-NameError.
    `datetime` -> `int(timestamp())`; int/float -> int; anything else unchanged (a
    surprising type fails loud downstream rather than being silently mangled)."""
    if isinstance(ts, datetime):
        return int(ts.timestamp())
    if isinstance(ts, bool):  # bool is an int subclass — never a valid epoch bound
        return ts
    if isinstance(ts, (int, float)):
        return int(ts)
    return ts


def _coerce(value: Any) -> Any:
    """Coerce a materialized field to a native scalar. Pass int/float/str/bool/None
    through; stringify anything else so a netref scalar never leaks to the caller."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def _materialize(obj: Any) -> dict[str, Any]:
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
        initialize_timeout_ms: int | None = None,
        login_timeout_ms: int | None = None,
    ) -> None:
        # Resolve the PER-INSTANCE IPC-timeout chain (153.3 / D-25). The module
        # constants are the defaults, so a construction that passes no override is
        # byte-identical in behaviour to the pre-153.3 client — which is what keeps
        # job_worker.py, services/ingestion/mt5.py and scripts/mt5_spike.py (all of
        # which build `Mt5Client(host, port)`) on the worker's 30s chain. The
        # INTERACTIVE validate path is the caller that supplies longer values,
        # together with a longer `request_timeout_s`; raising the module constants
        # instead would lengthen the SEQUENTIAL worker's chain too and reopen the
        # v1.11 WEDGE-01 wedge class (a hung terminal past the ~90s healthz budget).
        # Resolution starts from the registry, so a call added to MT5_IPC_TIMEOUTS_MS
        # is carried on its default even before it earns a ctor override.
        ipc_timeouts_ms: dict[str, int] = dict(MT5_IPC_TIMEOUTS_MS)
        for _call_name, _override in (
            ("initialize", initialize_timeout_ms),
            ("login", login_timeout_ms),
        ):
            if _override is not None:
                ipc_timeouts_ms[_call_name] = _override

        # Enforce the load-bearing dual-timeout ORDERING (Pitfall 3 / T-134-04)
        # where the effective values finally meet: EVERY MT5 IPC timeout (ms) MUST
        # stay strictly BELOW the rpyc sync_request_timeout (s -> ms) so MT5 fails
        # its own pipe first and rpyc surfaces a clean error instead of a raw
        # mid-handshake abort. A too-small request_timeout_s (ctor arg or a low
        # MT5_REQUEST_TIMEOUT_S env) silently inverts it and reopens the v1.11
        # WEDGE-01 wedge class, so fail loud at construction rather than at a hung
        # live login.
        #
        # 153.3 / D-24: this guard used to check MT5_LOGIN_TIMEOUT_MS ALONE — the
        # instance its author had in mind — while `initialize()` ran unbound on
        # MetaTrader5's 60000ms vendor default, 2x the rpyc bound. That inversion is
        # what censored 9/9 correlated gateway<->worker failures at 30.1-31.0s on
        # 2026-08-06/08: the first MT5 call could not physically answer in time. The
        # guard therefore covers the whole CLASS — every entry of the per-instance
        # table resolved above — and the contract suite derives the set of
        # timeout-carrying calls from THIS source file so a third one cannot land
        # unregistered. Iteration is sorted so a multi-inversion always names the
        # same call first (a deterministic message, not an arbitrary dict order).
        request_timeout_ms = request_timeout_s * 1000
        for call_name in sorted(ipc_timeouts_ms):
            ipc_ms = ipc_timeouts_ms[call_name]
            if ipc_ms >= request_timeout_ms:
                raise ValueError(
                    f"MT5 {call_name}() IPC timeout must be strictly below the rpyc "
                    f"request timeout ({ipc_ms}ms >= "
                    f"{request_timeout_ms:.0f}ms) — this inversion reopens the "
                    "v1.11 WEDGE-01 wedge class."
                )
        # `_connect` is the injectable transport seam for the offline contract
        # suite (mirrors SfoxClient's _clock/_sleep injection). Default is the
        # lazy real transport.
        connect = _connect or _default_connect
        # Store the construction identity so restart() (MT5CONC-01) can rebuild the
        # transport with the SAME wiring. A blocked RPyC pipe never self-unblocks,
        # so recovering a wedged terminal means telling it to shut down and re-
        # establishing the transport — which requires the resolved factory + args.
        self._connect = connect
        self._host = host
        self._port = port
        self._request_timeout_s = request_timeout_s
        # The resolved per-call IPC ceilings live on the INSTANCE, so restart()
        # (which rebuilds the transport with the same wiring) cannot silently drop
        # back to the module constants.
        self._ipc_timeouts_ms = ipc_timeouts_ms
        self._mt5 = connect(host=host, port=port, timeout=request_timeout_s)
        self._closed = False

    def _raise_last(self) -> NoReturn:
        """Capture `last_error()` IMMEDIATELY (the next remote call overwrites it)
        and raise a typed, secret-scrubbed error."""
        # RED-TEAM: last_error() is itself a raw transport call. If the connection
        # died right after the None-return that triggered _raise_last, this call
        # can RAISE — and outside _guarded_read it would escape as a raw, untyped,
        # unscrubbed rpyc traceback, bypassing the single typed fail-loud choke
        # point (router 500 instead of clean 400; worker skips the mt5 classify
        # arms). Convert it exactly as _guarded_read does.
        try:
            err = self._mt5.last_error()
        except Mt5ClientError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
            raise Mt5ClientError(0, scrub_freeform_string(str(exc))) from None
        if not err:
            raise Mt5ClientError(0, "unknown")
        # A truthy-but-malformed shape (wrong-length tuple, non-subscriptable
        # scalar, dict, non-int code) must NOT escape as a raw
        # IndexError/TypeError/KeyError/ValueError — that would bypass the single
        # typed fail-loud choke point. Coerce defensively.
        try:
            code, text = int(err[0]), str(err[1])
        except (TypeError, IndexError, KeyError, ValueError):
            code, text = 0, "unknown (malformed last_error shape)"
        raise Mt5ClientError(code, text)

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
        shapes) on top of the shape-based `scrub_freeform_string`. BOTH MT5 calls
        below carry an explicit millisecond ceiling taken from this instance's
        `_ipc_timeouts_ms` (registered in ``MT5_IPC_TIMEOUTS_MS``, ordering-checked
        at construction), so each stays strictly below the rpyc request timeout and
        MT5 can fail its own pipe first (Pitfall 3 / D-24).

        initialize() FIRST (T-139 go-live): the MT5 Python API requires
        ``initialize()`` to attach the terminal's IPC pipe before ANY call —
        without it ``login()`` (and every subsequent read) returns
        ``-10004 'No IPC connection'`` against a real terminal (verified live on
        the prod gateway; the offline doubles never exercised it). The gateway
        terminal is already running and investor-auto-logged-in, so a bare
        ``initialize()`` attaches to the running instance ([ASSUMED] idempotent —
        a no-op True when already attached: that is OUR empirical observation, not
        a MetaQuotes-documented guarantee, EVIDENCE Correction C-7; owner Phase 155
        (MT5-VERIFY)), and the explicit ``login()`` below then (re)authenticates the
        EXPECTED investor account under our controlled timeout + read-only
        semantics. initialize() carries no credentials, but its transport text is
        scrubbed on the same fail-loud path for safety."""
        try:
            inited = self._mt5.initialize(timeout=self._ipc_timeouts_ms["initialize"])
        except Mt5ClientError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
            raise Mt5ClientError(0, scrub_freeform_string(str(exc))) from None
        if not inited:
            self._raise_last()
        try:
            ok = self._mt5.login(
                login,
                password=password,
                server=server,
                timeout=self._ipc_timeouts_ms["login"],
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

    def account_info(self) -> dict[str, Any]:
        """Current account snapshot as a native dict. None (error) -> typed raise."""
        info = self._guarded_read(self._mt5.account_info)
        if info is None:
            self._raise_last()
        return _materialize(info)

    def terminal_info(self) -> dict[str, Any]:
        """Current TERMINAL snapshot as a native dict. None (error) -> typed raise.

        This reads the state of the MetaTrader terminal WE operate (the gateway
        process), NOT the user's account — it carries no credential of theirs.
        Two fields are load-bearing for the Phase-153.3 capability rule (D-31,
        EVIDENCE §C12):

          * ``connected`` — is the terminal attached to a trade server. MQL5
            "Trade permission" lists "no connection to the trade server" as a
            SIBLING cause of ``account_info().trade_allowed`` being false, so a
            detached terminal makes the account-level negative unattributable.
          * ``trade_allowed`` — the terminal-level AutoTrading permission. It
            subsumes the terminal option *"Disable automatic trading through the
            external Python API"*, which MetaQuotes ships **ON by default, "for
            security reasons"**. With that option in force ``order_check`` is
            refused from Python REGARDLESS of investor vs master, so a MASTER
            password produces exactly the two negatives an investor password
            produces.

        That is why this method exists: a false ``trade_allowed`` here makes the
        account-level negatives UNINFORMATIVE, and a rule that concluded
        "read-only" from them would stamp a trade-capable password read-only —
        a fail-OPEN on the one security property the probe exists to prove.
        ``services.mt5_validation.classify_trade_capability`` therefore refuses
        (``"undetermined"``) rather than concluding.
        """
        info = self._guarded_read(self._mt5.terminal_info)
        if info is None:
            self._raise_last()
        return _materialize(info)

    def history_deals_get(self, from_ts: Any, to_ts: Any) -> list[dict[str, Any]]:
        """Deals in [from_ts, to_ts) as native dicts. `None` is an ERROR -> typed
        raise (NEVER a truthiness check on `deals` — that conflates the error with
        the honest empty `()`); `()` -> `[]`; a populated tuple -> materialized
        dicts. The raw
        server-time `time`/`time_msc` epochs are returned VERBATIM — the
        normalize-to-UTC seam is Phase 136, not this client.

        Bounds are coerced to INT epoch seconds: mt5linux 0.1.9 f-string-interpolates
        args into a remote eval whose Wine namespace has NO ``datetime`` import, so a
        ``datetime`` bound becomes ``datetime.datetime(...)`` → remote ``NameError``
        (0.1.10 added the import; we pin 0.1.9). MT5 accepts int epoch seconds, so
        coercing here lets EVERY caller work — the worker passes ints, the soak passes
        tz-aware datetimes; a naive/aware datetime → ``int(ts.timestamp())`` (the tz
        offset is immaterial for a range filter)."""
        _from, _to = _epoch_bound(from_ts), _epoch_bound(to_ts)
        deals = self._guarded_read(lambda: self._mt5.history_deals_get(_from, _to))
        if deals is None:
            self._raise_last()
        return [_materialize(d) for d in deals]

    def order_check(self, request: dict[str, Any]) -> dict[str, Any]:
        """PROBE ONLY. Materialize an `order_check` result to a native dict; `None`
        (error) -> typed raise.

        This exists solely for the Phase-135 validate-time investor-vs-master
        rejection (MT5SRC-02); this facade never wraps the trade path (referred to
        here without call parentheses). `order_check` validates margin/funds and
        does NOT place an order. The exact investor retcode/comment signal is
        [ASSUMED] pending MT5SPIKE-01 leg 2 — the Phase-135 rule must combine the
        order_check retcode/comment WITH account_info().trade_allowed (Pitfall 4).

        The request is passed as KEYWORDS (``order_check(**request)``): mt5linux 0.1.9
        evals ``mt5.order_check(*args, **kwargs)``, and MT5's ``order_check`` rejects a
        positional dict with retcode ``-2 'Unnamed arguments not allowed'`` — it wants
        the named request fields (verified live). ``**request`` produces
        ``mt5.order_check(action=…, symbol=…, …)`` which MT5 accepts."""
        result = self._guarded_read(lambda: self._mt5.order_check(**request))
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

    def restart(self) -> None:
        """Tear down a wedged terminal and re-establish the transport (MT5CONC-01).

        A blocked RPyC/Wine pipe will NOT self-unblock, so the transport is
        re-established via the stored ``_connect`` factory and the stale connection
        is told to shut down. Best-effort teardown: a wedged/raising ``shutdown()``
        is swallowed with a logged warning (mirroring ``close()``) — a terminal too
        broken to tear down cleanly must still be rebuilt, never left un-restartable.

        ORDERING (WR-01): the fresh connection is built and swapped in as the live
        connection FIRST, and only THEN is the stale connection disposed. This is
        load-bearing for restart RELIABILITY under the abandon-thread recovery model.
        When restart is triggered by the derive read-timeout branch, the timed-out
        ``_mt5_read`` OS thread is ABANDONED but keeps running and may still be
        driving the SAME rpyc connection. rpyc classic is not concurrent-request-safe,
        so issuing ``shutdown()`` on that stale connection can itself HANG. Were the
        shutdown done FIRST (the old ordering), a hanging stale-shutdown would be
        abandoned by the bounded caller (``_mt5_bounded_restart``'s ``wait_for``)
        BEFORE the reconnect ran — leaving NO fresh terminal for the next retry and
        defeating the restart's whole purpose. Reconnecting first guarantees the
        client holds a FRESH usable connection whenever a connect is possible, EVEN
        IF the stale connection's shutdown would block; the abandoned stale shutdown
        can no longer prevent the reconnect.

        Unlike ``close()`` this does NOT gate on ``self._closed`` and NEVER calls
        ``close()``: restart's contract is teardown+rebuild regardless of prior
        state, and it clears ``self._closed`` so the fresh session is closable
        again. It never sleeps, retries, or joins the abandoned hung reader thread
        — the CALLER bounds this call with ``to_thread`` + ``wait_for`` (see
        ``mt5_concurrency._mt5_bounded_restart``) so restart can never itself
        nest-wedge the worker.

        Live ``initialize()`` semantics — and specifically whether ``shutdown()`` on
        a connection an abandoned reader is still parked on is safe or must be freed
        out-of-band — are [ASSUMED] (A1) pending the Phase-139 gateway spike; against
        the offline ``_connect`` double, reconnect + best-effort ``shutdown()`` is
        the full exercised surface.
        """
        stale = self._mt5
        # Rebuild + swap in the fresh connection FIRST (see ORDERING above).
        self._mt5 = self._connect(
            host=self._host, port=self._port, timeout=self._request_timeout_s
        )
        self._closed = False
        # Best-effort dispose of the stale connection AFTER the fresh one is live, so
        # a shutdown() that blocks (an abandoned reader still driving `stale`) can
        # never prevent the reconnect. A raising teardown is swallowed like close().
        try:
            stale.shutdown()
        except Exception:  # noqa: BLE001 — a wedged teardown must not abort recovery
            logger.warning("Mt5Client.restart: stale shutdown() raised; swallowing.")

    @property
    def terminal_key(self) -> str:
        """Process-wide terminal identity (``host:port``) — the key for the
        Phase-137 per-terminal serialization lock registry
        (``mt5_concurrency._MT5_TERMINAL_LOCKS``, MT5CONC-02).

        Two ``Mt5Client`` instances built for the SAME gateway (every job builds a
        fresh client via ``_make_mt5_session``) share this key, so a single
        module-level ``asyncio.Lock`` serializes every terminal-IPC region against
        the ONE shared Wine terminal. It must be derived from the construction
        identity (``_host``/``_port``, stored in ``__init__``), never from a
        per-Session attribute that would differ per job and serialize nothing.
        """
        return f"{self._host}:{self._port}"


@dataclass
class Mt5Session:
    """MT5RECON-01 (Phase 136) — the worker's non-ccxt exchange holder for mt5.

    The job-worker's ``_make_exchange_client`` construction chokepoint builds this
    (the mt5 analog of the raw ``SfoxClient`` the sfox arm returns) so the derive
    branch can ``login`` + read + ``close`` a terminal session. It bundles the
    read-only ``Mt5Client`` with the PARSED credentials (login/investor password/
    broker server) resolved from the reused api_key/api_secret/passphrase slots
    (the 135 convention), because — unlike a ccxt exchange or the sfox Bearer
    client — an MT5 read requires an explicit per-account ``login(...)`` call at
    read time, not just at construction.

    ``aclose_exchange`` (the single close chokepoint) isinstance-routes this to
    ``client.close()`` (bounded via ``asyncio.to_thread`` — the sync facade), so
    every job-worker close site becomes mt5-safe with zero per-site edits.
    """

    # repr=False on the three credential-bearing fields (RED-TEAM hardening): the
    # dataclass auto-__repr__ would otherwise emit the plaintext investor password
    # (and the login/server, both treated as secrets by services.redact) into any
    # `%r`/f-string/structlog serialization of a Mt5Session — the same repr-leak
    # class schemas.py wraps in SecretStr for. This makes the "secrets never in
    # logs/exceptions" invariant STRUCTURAL, not call-site discipline.
    client: Mt5Client
    login: int = field(repr=False)
    investor_password: str = field(repr=False)
    server: str = field(repr=False)
