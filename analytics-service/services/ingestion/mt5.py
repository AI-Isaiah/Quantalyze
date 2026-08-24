"""Phase 135 / MT5SRC-01 (135-01) — MetaTrader 5 broker adapter (ingestion
capability).

Wraps the Phase-134 synchronous, read-only ``Mt5Client`` (RPyC facade, no trade
surface) behind the 5-method ``IngestionAdapter`` Protocol, mirroring
``SfoxAdapter`` byte-for-byte in structure. ``'mt5'`` joins the ``Source`` Literal
+ ``SUPPORTED_SOURCES`` + ``_FACTORIES`` in lockstep with this module landing (the
SFOX-01 pin precedent: the Literal must not widen ahead of the registry).

CRITICAL correctness invariant — ``compute_metrics`` FAILS LOUD BY DESIGN:
  MT5 returns are reconstructed from the deal-ledger daily-NAV series
  (``combine_mt5_deal_ledger``) fed through the broker-dailies ONE backbone,
  exactly like Deribit's/sFOX's ledger-backed returns. A fill-based
  ``MetricsSnapshot`` produced here would be a silently-empty/wrong track record
  persisted by ``long_fetch.process_key`` — the BYB-02 corruption class.
  Therefore this method RAISES PERMANENTLY (not "until Phase 136") rather than
  delegating to the shared ``EquityCurveBuilder``: mt5 rides the ledger-backed
  long-fetch tail (``_LEDGER_BACKED_SOURCES``), which routes AROUND the fill
  steps entirely, so implementing a fill path would reopen the corruption class,
  not close a gap. This is the permanent by-design posture, mirroring
  ``SfoxAdapter``.

``fetch_raw`` is likewise fail-loud: no synchronous flow routes mt5 to a bespoke
deal → ``Trade`` normalization. MT5 ingestion is a long-fetch flow that routes
through the worker's deal-ledger branch (Phase 136), so there is NO consumer for
a fill list here; a bespoke mapping with no consumer would be unverifiable
invented data (the tripwire posture).

Read-only is asserted STRUCTURALLY (the sFOX A1 posture): ``Mt5Client`` composes
ONLY read methods + an ``order_check`` probe and exposes NO trade surface and no
``__getattr__`` passthrough, so ``validate`` reports ``read_only=True`` as a
structural property — NEVER a probed scope claim. ``validate`` ALSO runs a
behavioral investor-vs-master probe (no sFOX analog): a trade-capable (master)
login is REJECTED and NEVER persisted (only ``valid=True`` credentials are
encrypted by the caller).
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from services.closed_sets import (
    MT5_MASTER_PASSWORD_DETAIL,
    MT5_WRONG_SERVER_DETAIL,
)
from services.exchange import AUTH_FAILED_DETAIL
from services.ingestion.adapter import (
    Fingerprint,
    KeySubmissionRequest,
    MetricsSnapshot,
    Position,
    Trade,
    ValidationResult,
)
from services.mt5_client import (
    MT5_REQUEST_TIMEOUT_S,
    Mt5AccountMismatchError,
    Mt5Client,
    Mt5ClientError,
    Mt5SessionAbandoned,
)
from services.mt5_concurrency import mt5_terminal_lease
# 153.6 / PARITY-01 — the ONE login+read+probe body, shared with the FastAPI
# `_validate_mt5_key_probe` branch. This adapter used to carry its own divergent
# copy; the three fixes 153.3 landed on the router's never reached it. The import
# direction is worker → services leaf, which is the direction D-07 requires: the
# adapter must NEVER import `routers.*`.
from services.mt5_probe import (
    Mt5GatewayMisconfigured,
    mt5_gateway_misconfigured_detail,
    run_probe,
)
from services.mt5_validation import (
    Mt5ValidationError,
    classify_mt5_login_error,
    classify_trade_capability,
    parse_mt5_credentials,
    terminal_trade_permission_off,
)

# The event-loop bound for the SYNCHRONOUS Mt5Client probe (login+read+order_check
# run off the loop via asyncio.to_thread). A margin above the client's own rpyc
# sync_request_timeout so a hung terminal fails its round-trip first and this outer
# wait_for is the LAST-RESORT ceiling — a hang OUTSIDE a bounded round-trip (e.g.
# netref materialization) must NEVER let the sequential worker await unbounded (the
# v1.11 WEDGE-01 failure class). This used to MIRROR the router's own
# `_MT5_PROBE_TIMEOUT_S` (WR-02); as of 153.3 / D-03 the two paths have DIVERGED on
# purpose. The INTERACTIVE validate path in routers/exchange.py now runs a longer
# per-instance chain under ONE end-to-end deadline
# (`_MT5_VALIDATE_STAGE_TIMEOUT_S` / `_MT5_VALIDATE_DEADLINE_S`), because a human is
# waiting and MetaQuotes budgets 60 000ms for initialize()/login(). The WORKER —
# this file — deliberately keeps the short 30s chain: it is SEQUENTIAL, and holding
# it longer is exactly the WEDGE-01 wedge (D-25).
_MT5_PROBE_TIMEOUT_S = MT5_REQUEST_TIMEOUT_S + 5.0

# Same stdlib logger name the rest of the MT5 family uses (services/mt5_client.py)
# so the D-31 capability-refusal WARNINGs land on the one analytics stream. Every
# line here is secret-free by construction: only a stage name and a scrubbed
# Mt5ClientError code ever reach it — never a login, password or broker server.
logger = logging.getLogger("quantalyze.analytics")


def _build_client(host: str, port: int) -> Mt5Client:
    """Construct the real ``Mt5Client`` transport. Isolated as a module-level
    factory so the offline contract suite can monkeypatch it to inject the
    ``_connect`` transport double (mirrors the sFOX ``make_sfox_client`` injection
    seam) — no live terminal, no ``mt5linux`` install, no network in tests."""
    return Mt5Client(host, port)


def _auth_failed() -> ValidationResult:
    # Fail CLOSED with the SAME AUTH_FAILED string a bad ccxt key emits so the TS
    # classifyKeyValidationError maps it to KEY_AUTH_FAILED (zero TS edits).
    return ValidationResult(
        valid=False,
        read_only=None,
        error_code="AUTH_FAILED",
        human_message=AUTH_FAILED_DETAIL,
        debug_context=None,
    )


def _wrong_server() -> ValidationResult:
    return ValidationResult(
        valid=False,
        read_only=None,
        error_code="MT5_WRONG_SERVER",
        human_message=MT5_WRONG_SERVER_DETAIL,
        debug_context=None,
        # PYAPIFIX2-02: a broker server that does not exist cannot start
        # existing on a retry. Stated here because only this adapter knows it.
        permanent=True,
    )


class Mt5Adapter:
    """MT5 adapter — wraps the Phase-134 read-only ``Mt5Client`` without rewriting.
    Returns are deal-ledger-backed (compute_metrics fails loud until Phase 136)."""

    SOURCE: str = "mt5"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        # Offline pre-probe credential-shape validation via the ONE mt5_validation
        # seam — the IDENTICAL guard set + ordering the router's _validate_mt5_key
        # uses (WR-01). Credential-slot reuse (the one MT5 wrinkle, documented
        # LOUDLY at the encrypt chokepoint in plan 135-03): login -> api_key,
        # investor password -> api_secret, broker server -> passphrase. A blank
        # password (previously unguarded here) now fails CLOSED offline instead of
        # burning a live RPyC probe, and a doubly-blank login+server classifies the
        # SAME way it does through the router.
        try:
            login, investor_pw, server = parse_mt5_credentials(
                req.context.get("api_key"),
                req.context.get("api_secret"),
                req.context.get("passphrase"),
            )
        except Mt5ValidationError as e:
            # Fail CLOSED with the SAME classification the router emits — never a
            # client ctor: wrong_server -> MT5_WRONG_SERVER, auth -> AUTH_FAILED.
            if e.kind == "wrong_server":
                return _wrong_server()
            return _auth_failed()

        host = os.getenv("MT5_GATEWAY_HOST")
        port_raw = os.getenv("MT5_GATEWAY_PORT")
        if not host or not port_raw:
            # A SERVER misconfig, propagated — never valid, never blames the user's
            # creds (mirrors sFOX's construction-time posture: a missing egress
            # config is our fault, not the key's).
            raise RuntimeError(
                "MT5 gateway not configured: MT5_GATEWAY_HOST / MT5_GATEWAY_PORT "
                "are unset. This is a server misconfiguration, never a credential "
                "failure."
            )
        # ⭐ D-29 (153.3 review) — TAKE THE TERMINAL LEASE.
        #
        # This is the SIBLING validate path. It logs into the SAME process-global
        # MetaTrader5 session, from the SAME process, as
        # `routers/exchange.py:_validate_mt5_key` — which started leasing at
        # 153.3-04 while this one did not. MT5 binds ONE account per terminal AT A
        # TIME, so an UNLEASED login() here silently re-points the terminal under a
        # leased wizard validate that is mid-probe (and vice versa): the observed
        # interleave was `login-start, login-start, login-end, release, login-end,
        # release`. A lease taken by ONE of two callers of one terminal serializes
        # NOTHING — the same class as the second-registry pitfall (MT5CONC-02).
        #
        # ⚠️ `wait_s=None` — UNBOUNDED, and deliberately so. This is the
        # INGESTION/batch path: its live caller is `long_fetch.process_key` on the
        # worker (mt5 is admitted to onboard/resync ONLY, both long-fetch, so no
        # human is sitting on it — the router owns the interactive path). It
        # therefore takes the SAME patient queueing the other three job call sites
        # take (`job_worker.py` x2, `allocator_positions.py`), byte-equivalent to
        # their `async with _mt5_terminal_lock_for(key):`. Bounding it would convert
        # serialization into batch FAILURE, strictly worse than waiting; the outer
        # per-kind dispatch ceiling is what stops a genuinely wedged queue. The 20s
        # `_MT5_LEASE_WAIT_S` belongs to the INTERACTIVE path alone, where a human
        # is inside the client budget (D-26).
        #
        # ⚠️ The key MUST be byte-identical to `Mt5Client.terminal_key`
        # (`f"{host}:{port}"` over the SAME int port handed to the constructor), or
        # this resolves to a DIFFERENT Lock object and the fix is cosmetic — every
        # lock still "works" while serializing nothing. Derived BEFORE construction
        # because construction opens the rpyc socket that races, so the lease must
        # already be held when it happens.
        port = int(port_raw)
        terminal_key = f"{host}:{port}"
        async with mt5_terminal_lease(terminal_key, wait_s=None):
            # RED-TEAM: _build_client → Mt5Client.__init__ opens the RPyC socket
            # SYNCHRONOUSLY (a blocking connect). Run construction OFF the event loop
            # under a wait_for ceiling; a hung/unreachable gateway connect on the loop
            # would wedge the SEQUENTIAL worker (the v1.11 WEDGE-01 class the probe body
            # already guards). A connect timeout/failure PROPAGATES untouched (the
            # adapter's transient disposition — never valid, never auth-failed); there is
            # no client to close yet, so it sits OUTSIDE the close-finally below.
            client = await asyncio.wait_for(
                asyncio.to_thread(lambda: _build_client(host, port)),
                timeout=_MT5_PROBE_TIMEOUT_S,
            )
            try:
                # Mt5Client is SYNCHRONOUS blocking RPyC — run the login+read+probe body
                # off the event loop (asyncio.to_thread). Blocking the loop on a hung
                # terminal reopens the v1.11 WEDGE-01 class.
                # ⭐ 153.6 / PARITY-01. THIS is the path the three 153.3 fixes never
                # reached. It used to carry its own hand-written
                # `_assert_expected_login` / `_read_terminal` / `_probe` closures,
                # divergent from the router's by exactly the three fixes:
                #   A1 — no terminal short-circuit, so `order_check` ran on an
                #        already-"undetermined" verdict and its refusal came back as
                #        a 400 blaming the user's broker server;
                #   A2 — no broad arm around netref materialization, so a raw
                #        transport raise escaped the whole refusal;
                #   A3 — see the operator-fault arm below.
                # There is now ONE body in `services/mt5_probe.py` and both paths call
                # it, so a fix cannot land on one path only. ⛔ Only the MECHANICS are
                # shared: this adapter's dispositions (propagate-transient, the sFOX F4
                # posture) stay here, as do the UNBOUNDED lease and the diverged
                # timeout chain above, whose rationale is written at those sites.
                def _probe() -> tuple[
                    dict[str, Any], dict[str, Any], dict[str, Any] | None
                ]:
                    return run_probe(
                        client,
                        login=login,
                        investor_pw=investor_pw,
                        server=server,
                        log_prefix="mt5.validate",
                    )

                try:
                    # LAST-RESORT event-loop ceiling (WR-02): to_thread already keeps
                    # the loop free, but with no wait_for a hang OUTSIDE a bounded rpyc
                    # round-trip (e.g. netref materialization) would let the sequential
                    # worker await unbounded — the router path already guards this, and
                    # the two must not diverge (v1.11 WEDGE-01 class).
                    info, probe, terminal = await asyncio.wait_for(
                        asyncio.to_thread(_probe), timeout=_MT5_PROBE_TIMEOUT_S
                    )
                except Mt5SessionAbandoned:
                    # ⭐ WIZFORM-ABANDON / D-40. PROPAGATE untouched — which is
                    # already what would happen without this arm, and that is
                    # exactly why the arm is written down. Propagation IS this
                    # adapter's documented transient disposition (the sFOX F4
                    # posture every sibling arm below takes), so making it
                    # EXPLICIT costs nothing today and buys the guarantee that a
                    # future broad `except Exception` added around this probe
                    # cannot silently absorb an operator-side refusal into a
                    # credential verdict. `Mt5SessionAbandoned` is a plain
                    # `Exception` (D-42) precisely so no classify arm can claim
                    # it; this arm keeps that true at the seam as well as at the
                    # sink.
                    #
                    # ⚠️ On the genuinely abandoned path nobody is awaiting this
                    # coroutine, so the raise reaches no one (D-39 — the sink's
                    # WARNING is the signal). The arm serves the FALSE-POSITIVE
                    # path: a legitimate probe that trips the fence must surface
                    # as a retryable transient, never as `valid`, never as
                    # `auth_failed` and never as `wrong_server`.
                    #
                    # close() still runs in the finally below (`close` is
                    # D-41-EXEMPT from the fence), so the session never leaks.
                    raise
                except asyncio.TimeoutError:
                    # Timeout == a hung terminal, NOT the user's credentials. Take the
                    # adapter's transient disposition: PROPAGATE untouched (never
                    # auth-failed, never valid, never wrong_server); the caller
                    # classifies it honestly (sFOX F4 posture). close() still runs in
                    # the finally below, so the terminal session never leaks.
                    raise
                except Mt5AccountMismatchError:
                    # RED-TEAM: a concurrent actor re-logged the shared terminal onto
                    # another account mid-probe — an INFRA/concurrency fault, never the
                    # user's key. PROPAGATE untouched (transient disposition: never valid,
                    # never auth-failed, never a wrong-account verdict).
                    raise
                except Mt5ClientError as e:
                    kind = classify_mt5_login_error(e)
                    if kind == "auth":
                        return _auth_failed()
                    if kind == "wrong_server":
                        return _wrong_server()
                    # transient -> PROPAGATE untouched (sFOX F4 posture: never
                    # auth-failed, never valid; the caller classifies it honestly).
                    raise

                verdict = classify_trade_capability(info, probe, terminal)

                if verdict == "undetermined":
                    # D-31: we CANNOT distinguish investor from master, so we refuse
                    # rather than stamp read-only. This arm is the CLASS half of the
                    # fix — an instance fix on the router alone would leave THIS path
                    # fail-open. Routed BY CAUSE off the SAME terminal dict that
                    # produced the verdict (never a re-probe).
                    operator_fault = terminal_trade_permission_off(terminal)
                    if operator_fault:
                        # A setting in OUR gateway terminal. No retry can clear it;
                        # the remedy is an operator changing that setting
                        # (docs/runbooks/mt5-go-live.md). A server-side condition,
                        # NEVER the user's credentials.
                        #
                        # ⚠️ 161-02: WHICH setting is derived, not assumed. The
                        # founder-measured live cause is the Expert-Advisors
                        # "Allow algorithmic trading" option (`Enabled` in
                        # [Experts]) — re-set off on every account change, and this
                        # worker logs in on every job, which is exactly why the
                        # fault recurs. MetaQuotes' separate default-ON "Disable
                        # automatic trading through the external Python API"
                        # (`Api`, reported as `tradeapi_disabled`) was measured OFF
                        # at the same time, and the old copy named it anyway.
                        #
                        # ⭐ 153.6 / A3 — A DEDICATED TYPE, not a bare RuntimeError.
                        # This raise escapes `Mt5Adapter.validate` into
                        # `job_worker.classify_exception`, and a `RuntimeError` fell
                        # through to its `("unknown", str(exc))` catch-all: the worker
                        # RETRIED a fault that can never clear, re-running the whole
                        # serialized probe against the ONE shared terminal each time,
                        # queueing ahead of every other user's validate — and rendered
                        # raw internal copy that named investor/master passwords.
                        # `Mt5GatewayMisconfigured` has its own `classify_exception`
                        # arm, which classifies it ("permanent", <curated cause>).
                        #
                        # ⛔ Raised with a CURATED constant chosen by the ONE
                        # flag->cause builder from the SAME terminal dict the
                        # verdict came from — never with interpolated upstream
                        # text: `mt5linux` f-string-interpolates the password into
                        # remotely-eval'd source (T-134-01), and the message is
                        # rendered to a human. The builder guards defensively, so
                        # an absent/unreadable flag yields the generic constant.
                        logger.warning(
                            "mt5.validate: capability undetermined (terminal trade "
                            "permission off) — refusing rather than stamping read-only"
                        )
                        raise Mt5GatewayMisconfigured(
                            mt5_gateway_misconfigured_detail(terminal)
                        )
                    if not operator_fault:
                        # Terminal unreadable or detached — our bridge blipping,
                        # which clears on retry. Take the adapter's TRANSIENT
                        # disposition: propagate (never valid, never auth-failed,
                        # never read-only). The message deliberately avoids the
                        # classify_mt5_login_error token table's "terminal"/
                        # "connect"/"ipc"/"server" words so that if it is ever
                        # classified it degrades to transient, never to a
                        # user-blaming wrong_server.
                        logger.warning(
                            "mt5.validate: capability undetermined (gateway trade-"
                            "permission signal unavailable) — refusing rather than "
                            "stamping read-only"
                        )
                        raise Mt5ClientError(
                            0,
                            "MT5 capability undetermined: the gateway trade-"
                            "permission signal was unavailable, so read-only could "
                            "not be proven.",
                        )

                if verdict == "trade_capable":
                    # Master (trade-capable) login REJECTED — NEVER persisted (the
                    # caller only encrypts after valid=True). No sFOX analog.
                    return ValidationResult(
                        valid=False,
                        read_only=None,
                        error_code="MT5_MASTER_PASSWORD",
                        human_message=MT5_MASTER_PASSWORD_DETAIL,
                        debug_context=None,
                        # PYAPIFIX2-02: the refusal is deterministic — the same
                        # password probes trade-capable on every attempt. Only the
                        # user swapping to the investor password can clear it, so a
                        # retry is 3 serialised gateway probes spent on a verdict we
                        # already hold. The REJECTION itself is unchanged.
                        permanent=True,
                    )
                # Investor (read-only) login. read_only=True is STRUCTURAL (Mt5Client
                # exposes no trade surface — the sFOX A1 posture), NOT a probed scope.
                return ValidationResult(
                    valid=True,
                    read_only=True,
                    error_code=None,
                    human_message=None,
                    debug_context=None,
                )
            finally:
                # RED-TEAM: bounded, off-loop close. client.close() is blocking RPyC (a
                # hung teardown on the loop would wedge the sequential worker);
                # mirror aclose_exchange's mt5 arm + the router's close. Mt5Client.close()
                # swallows and logs its own teardown errors internally; the wait_for is
                # the last-resort ceiling. Runs on EVERY path so the session never leaks;
                # a timeout/failure abandons the session (bounded, client-logged) rather
                # than masking the probe verdict.
                #
                # ⚠️ 153.3 / D-35 — the THIRD path that reached the shared-IPC teardown
                # (D-35 named two; the ast roster found this one). Its old rationale — a
                # hanging teardown of the TERMINAL's IPC — is now false: close() releases
                # only OUR rpyc transport and calls `mt5.shutdown()` ZERO times, so this
                # `finally` can no longer destroy the ONE shared IPC pipe for a
                # concurrent caller (`-10004`). ⛔ The bound STAYS regardless — a
                # blocking socket close is still blocking. Nothing here was edited to
                # achieve that: the fix landed at the SINK, in `Mt5Client.close()`.
                try:
                    await asyncio.wait_for(
                        asyncio.to_thread(client.close), timeout=_MT5_PROBE_TIMEOUT_S
                    )
                except Exception:  # noqa: BLE001 — close must never mask the verdict
                    pass

    async def fetch_raw(self, creds_or_file: dict[str, Any]) -> list[Trade]:
        # FAIL LOUD — no synchronous flow routes mt5 to a fill-based Trade list.
        # MT5 ingestion is long-fetch -> the worker deal-ledger branch (Phase 136),
        # so there is NO consumer here. A bespoke deal->Trade mapping with no
        # consumer would be unverifiable invented data. This raise is the tripwire.
        raise NotImplementedError(
            "Mt5Adapter.fetch_raw is intentionally fail-loud: no synchronous flow "
            "admits mt5. MT5 ingestion is long-fetch and routes through the "
            "worker deal-ledger branch (Phase 136 combine_mt5_deal_ledger); there "
            "is no fill-based consumer, and inventing a deal->Trade mapping with "
            "no consumer would be unverifiable data. Implement an honest MT5 deal "
            "normalization before admitting any synchronous mt5 flow."
        )

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        # FAIL LOUD BY DESIGN (permanent) — MT5 returns are deal-ledger-backed,
        # NEVER fill-derived. MT5 returns come from the deal-ledger daily-NAV
        # reconstruction (combine_mt5_deal_ledger) fed through the broker-dailies
        # ONE backbone. A fill-based MetricsSnapshot would be a silently-empty/
        # wrong track record persisted by long_fetch.process_key (the BYB-02
        # corruption class). mt5 rides the ledger-backed long-fetch tail
        # (_LEDGER_BACKED_SOURCES) which routes AROUND the fill steps, so this
        # method must NOT delegate to EquityCurveBuilder — doing so reopens the
        # corruption path. This is the PERMANENT posture, not a Phase-136 stopgap.
        raise NotImplementedError(
            "Mt5Adapter.compute_metrics is intentionally fail-loud BY DESIGN: MT5 "
            "returns come from the deal-ledger daily-NAV reconstruction "
            "(combine_mt5_deal_ledger) via the broker-dailies ONE backbone, never "
            "from fill metrics. mt5 is a ledger-backed long-fetch source; a "
            "fill-based snapshot would be a silently-empty/wrong track record (the "
            "BYB-02 corruption class). This raise is permanent, not a stopgap."
        )

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint:
        # Execution-detail axis — shared exchange-agnostic impl is correct here
        # (only the RETURNS axis, compute_metrics, is guarded — deribit/sfox
        # precedent).
        from services.ingestion.fingerprint import compute_fingerprint_v1

        return compute_fingerprint_v1(trades, metrics)

    async def reconstruct_positions(
        self, trades: list[Trade]
    ) -> list[Position]:
        # Execution-detail axis — shared FIFO position reconstruction.
        from services.equity_reconstruction import EquityCurveBuilder

        return EquityCurveBuilder(trades).reconstruct_positions()
