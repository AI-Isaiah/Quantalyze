"""Phase 70 / DRB-08 (70-06) — Deribit broker adapter (ingestion capability).

Wraps services/exchange.py (unchanged per the REUSE flag) and the Phase-70
ledger/fills I/O (services/deribit_ingest.py) behind the 5-method
``IngestionAdapter`` Protocol, mirroring ``BybitAdapter``. Phase 68 explicitly
parked the ingestion-registry widening for Phase 70; this module lands the
``DeribitAdapter`` half.

CRITICAL correctness invariant — ``compute_metrics`` FAILS LOUD:
  Deribit ``type=trade`` fills carry ZERO realized cashflow (Wave-0 A3 —
  realized PnL crystallizes at settlement and is captured ONLY in the txn-log
  ledger, 70-03/70-05). OKX/Bybit legitimately derive metrics from fills via
  the shared ``EquityCurveBuilder``; doing that for Deribit would persist a
  silently-empty/wrong track record through ``long_fetch.process_key`` (the
  BYB-02 corruption class). Therefore Deribit returns come from the txn-log
  ledger via the broker-dailies ONE-path (70-05), and ``compute_metrics`` here
  RAISES rather than returning a fill-based zero-PnL snapshot. Do NOT delegate
  it to ``EquityCurveBuilder`` — that reopens the corruption path.

SCOPE: this is the ingestion CAPABILITY only. Live onboarding of the 3 LTP
accounts (verified strategies + per-subaccount key provisioning + secret
rotation) is Phase 72 — not wired here. The read-only scope gate stays enforced.

Do NOT re-patch Deribit/ccxt quirks in this adapter — canonical fixes live in
services/exchange.py; re-patching here would silently shadow them.
"""
from __future__ import annotations

from typing import Any

from services import exchange as exchange_service
from services.ingestion.adapter import (
    Fingerprint,
    KeySubmissionRequest,
    MetricsSnapshot,
    Position,
    Trade,
    ValidationResult,
)
from services.ingestion.okx import _normalize_trade


class DeribitAdapter:
    """Deribit adapter — wraps services/exchange.py + deribit_ingest without
    rewriting. Returns are ledger-backed (compute_metrics fails loud)."""

    SOURCE: str = "deribit"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        creds = req.context
        # Deribit auth is client_id/client_secret (api_key/api_secret); a
        # passphrase is passed through when present for signature parity with
        # the other API adapters (create_exchange maps it to ccxt `password`).
        ex = exchange_service.create_exchange(
            "deribit",
            creds["api_key"],
            creds["api_secret"],
            creds.get("passphrase"),
        )
        try:
            # validate_key_permissions routes deribit through
            # detect_deribit_permissions (P68) and sets read_only / TRADE_SCOPE
            # / MISSING_SCOPE — a write-capable key yields valid=False,
            # read_only=False. No write path is opened here.
            result = await exchange_service.validate_key_permissions(ex)
            valid = bool(result.get("valid", False))
            return ValidationResult(
                valid=valid,
                read_only=result.get("read_only"),
                error_code=result.get("error_code"),
                human_message=result.get("error"),
                debug_context=(
                    None
                    if valid
                    else {
                        "markets_loaded": result.get("markets_loaded"),
                        "markets_error": result.get("markets_error"),
                        "probe_error": result.get("probe_error"),
                    }
                ),
            )
        finally:
            await exchange_service.aclose_exchange(ex)

    async def fetch_raw(self, creds_or_file: dict[str, Any]) -> list[Trade]:
        ex = exchange_service.create_exchange(
            "deribit",
            creds_or_file["api_key"],
            creds_or_file["api_secret"],
            creds_or_file.get("passphrase"),
        )
        try:
            # Lazy import so deribit_ingest's I/O primitives stay
            # monkeypatchable and the validate-only path avoids the import.
            # fetch_deribit_fills reuses the 70-03 per-scope auth
            # (resolve_scope_auth → subaccount reads via exchange_token) so
            # subaccount fills are reachable despite subaccount_id being
            # refused on the read-only LTP keys.
            from services.deribit_ingest import fetch_deribit_fills

            raw = await fetch_deribit_fills(
                ex, since_ms=creds_or_file.get("since_ms")
            )
            return [_normalize_trade(r, "deribit") for r in raw]
        finally:
            await exchange_service.aclose_exchange(ex)

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        # FAIL LOUD — Deribit returns are ledger-backed, NEVER fill-derived.
        # Deribit fills carry zero realized cashflow (Wave-0 A3): realized PnL
        # crystallizes at settlement and is captured only in the txn-log
        # ledger. A fill-based MetricsSnapshot would be a silently-empty/wrong
        # track record persisted by long_fetch.process_key (BYB-02 class).
        # Returns flow through the broker-dailies ONE-path (70-05); this method
        # must NOT delegate to the shared EquityCurveBuilder.
        raise NotImplementedError(
            "DeribitAdapter.compute_metrics is intentionally fail-loud: Deribit "
            "fills carry zero realized cashflow (A3), so a fill-based metrics "
            "snapshot would be a silently-empty/wrong track record. Deribit "
            "returns come from the transaction-log ledger via the broker-dailies "
            "ONE-path (70-05), never from process_key fill metrics."
        )

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint:
        # Execution-detail axis — shared exchange-agnostic impl is correct
        # here (only the RETURNS axis, compute_metrics, is guarded).
        from services.ingestion.fingerprint import compute_fingerprint_v1

        return compute_fingerprint_v1(trades, metrics)

    async def reconstruct_positions(
        self, trades: list[Trade]
    ) -> list[Position]:
        # Execution-detail axis — shared FIFO position reconstruction.
        from services.equity_reconstruction import EquityCurveBuilder

        return EquityCurveBuilder(trades).reconstruct_positions()
