"""Phase 120 / SFOX-05 (120-01) — sFOX broker adapter (ingestion capability).

Wraps the Phase-118 non-ccxt ``SfoxClient`` (GET-only, Bearer-token) behind the
5-method ``IngestionAdapter`` Protocol, mirroring ``DeribitAdapter``. Phase 119
landed the sFOX key-save/read surfaces but deliberately deferred the ingestion
factory to Phase 120 (the ``Source`` Literal was pinned equal to
``SUPPORTED_SOURCES``, so the Literal could not widen ahead of the registry).
This module lands the ``SfoxAdapter`` half; ``services/ingestion/__init__.py``
+ ``adapter.py`` register it in lockstep.

CRITICAL correctness invariant — ``compute_metrics`` FAILS LOUD:
  sFOX returns are reconstructed from the balance-history ``usd_value`` daily
  series via the broker-dailies ONE-path (``chain_linked_twr`` →
  ``derive_basis_series``), exactly like Deribit's ledger-backed returns. A
  fill-based ``MetricsSnapshot`` produced here would be a silently-empty/wrong
  track record persisted by ``long_fetch.process_key`` — the BYB-02 corruption
  class. Therefore this method RAISES rather than delegating to the shared
  ``EquityCurveBuilder`` (doing so would reopen the corruption path).

``fetch_raw`` is likewise fail-loud: no synchronous flow routes sfox to a
bespoke sFOX-row → ``Trade`` normalization. Onboard/resync are long-fetch flows
that route through the worker's broker-dailies branch (SFOX-05, plan 120-03),
so there is NO consumer for a fill list here. Reusing the ccxt
``_normalize_trade`` on sFOX's non-ccxt row shape would silently mis-map; a
future teaser admit must implement an HONEST normalization first — this raise
is the tripwire against unverifiable invented mapping.

Read-only is asserted STRUCTURALLY (the 119 A1 posture): ``SfoxClient`` hardcodes
the HTTP verb to GET (no order/withdraw/transfer surface) and sFOX exposes no
per-key scope endpoint, so ``validate`` reports ``read_only=True`` as a
structural property — NEVER a probed ``{read, trade, withdraw}`` scope claim.
"""
from __future__ import annotations

from typing import Any

from services.exchange import AUTH_FAILED_DETAIL
from services.ingestion.adapter import (
    Fingerprint,
    KeySubmissionRequest,
    MetricsSnapshot,
    Position,
    Trade,
    ValidationResult,
)
from services.sfox_client import SfoxApiError, SfoxClient


class SfoxAdapter:
    """sFOX adapter — wraps the non-ccxt ``SfoxClient`` without rewriting.
    Returns are balance-history-backed (compute_metrics fails loud)."""

    SOURCE: str = "sfox"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        # sFOX auth is a SINGLE Bearer token (Q1 worker contract): the branch
        # takes only api_key and never requires api_secret. Trim at this
        # chokepoint per the v1.11 credential-trim convention (an 8-space token
        # arrives as "" after the client's trimCredential — the empty-token
        # guard below fails CLOSED with the honest AUTH classification).
        api_key = str(req.context.get("api_key") or "").strip()
        if not api_key:
            # An empty/whitespace-only Bearer token cannot authenticate; fail
            # CLOSED with the SAME AUTH_FAILED string a bad ccxt key emits so the
            # TS classifyKeyValidationError maps it to KEY_AUTH_FAILED (zero TS
            # edits). Never constructs a client (its ctor would ValueError).
            return ValidationResult(
                valid=False,
                read_only=None,
                error_code="AUTH_FAILED",
                human_message=AUTH_FAILED_DETAIL,
                debug_context=None,
            )
        client = SfoxClient(api_key=api_key)
        try:
            # A list body (even empty) means the token authenticates AND can
            # read — the single live proof of auth + read access.
            await client.get_balances()
            # read_only=True is STRUCTURAL (GET-only adapter, no scope endpoint —
            # the 119 A1 posture), NOT a probed scope triple.
            return ValidationResult(
                valid=True,
                read_only=True,
                error_code=None,
                human_message=None,
                debug_context=None,
            )
        except SfoxApiError as e:
            # Only a genuine 401/403 blames the user's credentials (F4 honesty).
            if e.status in (401, 403):
                return ValidationResult(
                    valid=False,
                    read_only=None,
                    error_code="AUTH_FAILED",
                    human_message=AUTH_FAILED_DETAIL,
                    debug_context=None,
                )
            # A transient/contract failure (status 0 shape-violation, 429
            # throttle, 5xx upstream-down) is NOT the user's key and NOT a
            # verified pass — PROPAGATE it untouched so the caller classifies it
            # honestly (it must never read as auth-failed OR as valid).
            raise
        finally:
            # The adapter owns an aiohttp session via SfoxClient; aclose on EVERY
            # path (success, auth-fail, propagating transient) so it never leaks.
            await client.aclose()

    async def fetch_raw(self, creds_or_file: dict[str, Any]) -> list[Trade]:
        # FAIL LOUD — no synchronous flow routes sfox to a fill-based Trade
        # list. Onboard/resync are long-fetch → the worker broker-dailies branch
        # (SFOX-05), so there is NO consumer here. A bespoke sFOX→Trade mapping
        # with no consumer would be unverifiable invented data, and reusing the
        # ccxt _normalize_trade on sFOX's non-ccxt row shape would silently
        # mis-map. This raise is the tripwire: a future teaser admit must ship an
        # HONEST normalization first.
        raise NotImplementedError(
            "SfoxAdapter.fetch_raw is intentionally fail-loud: no synchronous "
            "flow admits sfox. sFOX ingestion is long-fetch and routes through "
            "the worker broker-dailies branch (SFOX-05); there is no fill-based "
            "consumer, and mapping sFOX rows through the ccxt normalizer would "
            "silently mis-map. Implement an honest sFOX->Trade normalization "
            "before admitting any synchronous sfox flow."
        )

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        # FAIL LOUD — sFOX returns are balance-history-backed, NEVER fill-derived.
        # sFOX returns come from the /v1/account/balance/history usd_value series
        # (sFOX's own USD portfolio valuation) fed through the broker-dailies
        # ONE-path. A fill-based MetricsSnapshot would be a silently-empty/wrong
        # track record persisted by long_fetch.process_key (BYB-02 class). This
        # method must NOT delegate to the shared EquityCurveBuilder — that
        # reopens the corruption path.
        raise NotImplementedError(
            "SfoxAdapter.compute_metrics is intentionally fail-loud: sFOX returns "
            "come from the balance-history usd_value series via the broker-dailies "
            "ONE-path (chain_linked_twr -> derive_basis_series), never from fill "
            "metrics. A fill-based snapshot would be a silently-empty/wrong track "
            "record (the BYB-02 corruption class)."
        )

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint:
        # Execution-detail axis — shared exchange-agnostic impl is correct here
        # (only the RETURNS axis, compute_metrics, is guarded — deribit precedent).
        from services.ingestion.fingerprint import compute_fingerprint_v1

        return compute_fingerprint_v1(trades, metrics)

    async def reconstruct_positions(
        self, trades: list[Trade]
    ) -> list[Position]:
        # Execution-detail axis — shared FIFO position reconstruction.
        from services.equity_reconstruction import EquityCurveBuilder

        return EquityCurveBuilder(trades).reconstruct_positions()
