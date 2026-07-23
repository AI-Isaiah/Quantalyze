"""Phase 135 / MT5SRC-01 (135-01) — MetaTrader 5 broker adapter (ingestion
capability).

Wraps the Phase-134 synchronous, read-only ``Mt5Client`` (RPyC facade, no trade
surface) behind the 5-method ``IngestionAdapter`` Protocol, mirroring
``SfoxAdapter`` byte-for-byte in structure. ``'mt5'`` joins the ``Source`` Literal
+ ``SUPPORTED_SOURCES`` + ``_FACTORIES`` in lockstep with this module landing (the
SFOX-01 pin precedent: the Literal must not widen ahead of the registry).

CRITICAL correctness invariant — ``compute_metrics`` FAILS LOUD:
  MT5 returns are reconstructed from the deal-ledger daily-NAV series
  (``combine_mt5_deal_ledger`` in Phase 136) fed through the broker-dailies ONE
  backbone, exactly like Deribit's/sFOX's ledger-backed returns. A fill-based
  ``MetricsSnapshot`` produced here would be a silently-empty/wrong track record
  persisted by ``long_fetch.process_key`` — the BYB-02 corruption class.
  Therefore this method RAISES until Phase 136 rather than delegating to the
  shared ``EquityCurveBuilder`` (doing so would reopen the corruption path).

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
from services.mt5_client import Mt5Client, Mt5ClientError
from services.mt5_validation import (
    classify_mt5_login_error,
    is_trade_capable,
    mt5_probe_request,
)


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
        # Credential-slot reuse (the one MT5-specific wrinkle, documented LOUDLY at
        # the encrypt chokepoint in plan 135-03): login -> api_key, investor
        # password -> api_secret, broker server -> passphrase. Trim login/server at
        # this chokepoint per the v1.11 credential-trim convention.
        raw_login = str(req.context.get("api_key") or "").strip()
        if not raw_login:
            # A blank login cannot authenticate — fail CLOSED (never a client ctor).
            return _auth_failed()
        try:
            login = int(raw_login)
        except ValueError:
            # A non-numeric MT5 login cannot authenticate; classify as AUTH_FAILED
            # rather than a server misconfig — it is a bad credential, not our env.
            return _auth_failed()
        # Password passed through verbatim (never trimmed — MT5 passwords may be
        # space-significant; the wizard client already trims at submit).
        investor_pw = str(req.context.get("api_secret") or "")
        server = str(req.context.get("passphrase") or "").strip()
        if not server:
            # Broker server is REQUIRED for MT5 (a login without a server cannot
            # resolve); this is distinct from a bad-password failure (F4 honesty).
            return _wrong_server()

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
        client = _build_client(host, int(port_raw))
        try:
            # Mt5Client is SYNCHRONOUS blocking RPyC — run the login+read+probe body
            # off the event loop (asyncio.to_thread). Blocking the loop on a hung
            # terminal reopens the v1.11 WEDGE-01 class.
            def _probe() -> tuple[dict[str, Any], dict[str, Any]]:
                client.login(login, investor_pw, server)  # falsy -> Mt5ClientError
                info = client.account_info()  # proves auth + read
                probe = client.order_check(mt5_probe_request())  # PROBE ONLY
                return info, probe

            try:
                info, probe = await asyncio.to_thread(_probe)
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
            # Idempotent close on EVERY path (success, master-reject, auth/server
            # fail, propagating transient) so the terminal session never leaks.
            client.close()

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
        # FAIL LOUD — MT5 returns are deal-ledger-backed, NEVER fill-derived. MT5
        # returns come from the deal-ledger daily-NAV reconstruction
        # (combine_mt5_deal_ledger, Phase 136) fed through the broker-dailies ONE
        # backbone. A fill-based MetricsSnapshot would be a silently-empty/wrong
        # track record persisted by long_fetch.process_key (the BYB-02 corruption
        # class). This method must NOT delegate to EquityCurveBuilder — that
        # reopens the corruption path.
        raise NotImplementedError(
            "Mt5Adapter.compute_metrics is intentionally fail-loud until Phase "
            "136: MT5 returns come from the deal-ledger daily-NAV reconstruction "
            "(combine_mt5_deal_ledger) via the broker-dailies ONE backbone, never "
            "from fill metrics. A fill-based snapshot would be a silently-empty/"
            "wrong track record (the BYB-02 corruption class)."
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
