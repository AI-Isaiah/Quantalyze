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
)
from services.mt5_validation import (
    Mt5ValidationError,
    classify_mt5_login_error,
    is_trade_capable,
    mt5_probe_request,
    parse_mt5_credentials,
)

# The event-loop bound for the SYNCHRONOUS Mt5Client probe (login+read+order_check
# run off the loop via asyncio.to_thread). A margin above the client's own rpyc
# sync_request_timeout so a hung terminal fails its round-trip first and this outer
# wait_for is the LAST-RESORT ceiling — a hang OUTSIDE a bounded round-trip (e.g.
# netref materialization) must NEVER let the sequential worker await unbounded (the
# v1.11 WEDGE-01 failure class). Mirrors routers/exchange.py:_MT5_PROBE_TIMEOUT_S so
# the adapter and router paths do not diverge (WR-02).
_MT5_PROBE_TIMEOUT_S = MT5_REQUEST_TIMEOUT_S + 5.0


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
        # RED-TEAM: _build_client → Mt5Client.__init__ opens the RPyC socket
        # SYNCHRONOUSLY (a blocking connect). Run construction OFF the event loop
        # under a wait_for ceiling; a hung/unreachable gateway connect on the loop
        # would wedge the SEQUENTIAL worker (the v1.11 WEDGE-01 class the probe body
        # already guards). A connect timeout/failure PROPAGATES untouched (the
        # adapter's transient disposition — never valid, never auth-failed); there is
        # no client to close yet, so it sits OUTSIDE the close-finally below.
        client = await asyncio.wait_for(
            asyncio.to_thread(lambda: _build_client(host, int(port_raw))),
            timeout=_MT5_PROBE_TIMEOUT_S,
        )
        try:
            # Mt5Client is SYNCHRONOUS blocking RPyC — run the login+read+probe body
            # off the event loop (asyncio.to_thread). Blocking the loop on a hung
            # terminal reopens the v1.11 WEDGE-01 class.
            def _assert_expected_login(info: dict[str, Any]) -> None:
                # RED-TEAM login bracket, cloned from the worker derive arm
                # (MT5CONC-02): a concurrent validate (the FastAPI router path, a
                # different process) or another worker replica can re-log the ONE
                # shared terminal onto another account mid-probe, so is_trade_capable()
                # could be judged against the WRONG account (a master password wrongly
                # accepted as read-only, or an investor login wrongly rejected). STRICT
                # equality on the parsed login; a missing "login" field FAILS LOUD.
                # Mismatch → Mt5AccountMismatchError (NOT an Mt5ClientError, so the
                # classify arm can never absorb it) → propagated transient below.
                _actual = info.get("login")
                if _actual != login:
                    raise Mt5AccountMismatchError(login, _actual)

            def _probe() -> tuple[dict[str, Any], dict[str, Any]]:
                client.login(login, investor_pw, server)  # falsy -> Mt5ClientError
                info = client.account_info()  # proves auth + read
                _assert_expected_login(info)  # PRE-probe bracket
                probe = client.order_check(mt5_probe_request())  # PROBE ONLY
                _assert_expected_login(client.account_info())  # POST-probe bracket
                return info, probe

            try:
                # LAST-RESORT event-loop ceiling (WR-02): to_thread already keeps
                # the loop free, but with no wait_for a hang OUTSIDE a bounded rpyc
                # round-trip (e.g. netref materialization) would let the sequential
                # worker await unbounded — the router path already guards this, and
                # the two must not diverge (v1.11 WEDGE-01 class).
                info, probe = await asyncio.wait_for(
                    asyncio.to_thread(_probe), timeout=_MT5_PROBE_TIMEOUT_S
                )
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

            if is_trade_capable(info, probe):
                # Master (trade-capable) login REJECTED — NEVER persisted (the
                # caller only encrypts after valid=True). No sFOX analog.
                return ValidationResult(
                    valid=False,
                    read_only=None,
                    error_code="MT5_MASTER_PASSWORD",
                    human_message=MT5_MASTER_PASSWORD_DETAIL,
                    debug_context=None,
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
            # hung Wine shutdown on the loop would wedge the sequential worker);
            # mirror aclose_exchange's mt5 arm + the router's close. Mt5Client.close()
            # swallows and logs its own teardown errors internally; the wait_for is
            # the last-resort ceiling. Runs on EVERY path so the session never leaks;
            # a timeout/failure abandons the session (bounded, client-logged) rather
            # than masking the probe verdict.
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
