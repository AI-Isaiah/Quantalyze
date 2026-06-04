"""Phase 19 / BACKBONE-02 — Bybit broker adapter.

Wraps services/exchange.py (629 LOC unchanged per ROADMAP REUSE flag).
KeySubmissionRequest.context carries: api_key, api_secret, strategy_id,
wizard_session_id, user_id (no passphrase — Bybit V5 keys are
2-component).

DO NOT re-patch the Bybit currency-meta quirk in this adapter. The
patch already lives in services/exchange.py:35-46 (read-only Bybit keys
get 403 on /v5/asset/coin/query-info, which ccxt re-raises as
RateLimitExceeded; the patch disables the currency-meta call because
the data isn't used by validation OR trade fetching). This adapter
just wraps `create_exchange("bybit", …)` and inherits the patch.
Re-patching here would silently shadow the canonical fix.
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


class BybitAdapter:
    """Bybit adapter — wraps services/exchange.py without rewriting."""

    SOURCE: str = "bybit"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        creds = req.context
        ex = exchange_service.create_exchange(
            "bybit",
            creds["api_key"],
            creds["api_secret"],
            None,
        )
        try:
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
            "bybit",
            creds_or_file["api_key"],
            creds_or_file["api_secret"],
            None,
        )
        try:
            raw = await exchange_service._fetch_raw_trades_bybit(
                ex, since_ms=creds_or_file.get("since_ms")
            )
            return [_normalize_trade(r, "bybit") for r in raw]
        finally:
            await exchange_service.aclose_exchange(ex)

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        from services.equity_reconstruction import EquityCurveBuilder

        return EquityCurveBuilder(trades).to_metrics_snapshot()

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint:
        from services.ingestion.fingerprint import compute_fingerprint_v1

        return compute_fingerprint_v1(trades, metrics)

    async def reconstruct_positions(
        self, trades: list[Trade]
    ) -> list[Position]:
        from services.equity_reconstruction import EquityCurveBuilder

        return EquityCurveBuilder(trades).reconstruct_positions()
