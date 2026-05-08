"""Phase 19 / BACKBONE-02 — Binance broker adapter.

Wraps services/exchange.py (629 LOC unchanged per ROADMAP REUSE flag).
KeySubmissionRequest.context carries: api_key, api_secret, strategy_id,
wizard_session_id, user_id (no passphrase — Binance keys are
2-component).

Special note vs OKX/Bybit: services/exchange.py
`_fetch_raw_trades_binance(exchange, strategy_id, supabase, since_ms)`
takes a strategy_id + supabase client because Binance's per-symbol
fetch_my_trades requires the symbol set to be known up-front; the
existing fetcher reads it from the strategies-already-traded set in
the trades + position_snapshots tables. The adapter therefore expects
`creds_or_file` to also carry `strategy_id` and `supabase` (the P4
router passes them in alongside the raw credentials).
"""
from __future__ import annotations

from typing import Any, cast

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


class BinanceAdapter:
    """Binance adapter — wraps services/exchange.py without rewriting."""

    SOURCE: str = "binance"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        creds = req.context
        ex = exchange_service.create_exchange(
            "binance",
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
            await ex.close()

    async def fetch_raw(self, creds_or_file: dict[str, Any]) -> list[Trade]:
        ex = exchange_service.create_exchange(
            "binance",
            creds_or_file["api_key"],
            creds_or_file["api_secret"],
            None,
        )
        try:
            raw = await exchange_service._fetch_raw_trades_binance(
                ex,
                creds_or_file["strategy_id"],
                creds_or_file["supabase"],
                creds_or_file.get("since_ms"),
            )
            return [_normalize_trade(r, "binance") for r in raw]
        finally:
            await ex.close()

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        from services.equity_reconstruction import (  # type: ignore[attr-defined]
            EquityCurveBuilder,
        )

        return cast(MetricsSnapshot, EquityCurveBuilder(trades).to_metrics_snapshot())

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint:
        from services.ingestion.fingerprint import compute_fingerprint_v1

        return compute_fingerprint_v1(trades, metrics)

    async def reconstruct_positions(
        self, trades: list[Trade]
    ) -> list[Position]:
        from services.equity_reconstruction import (  # type: ignore[attr-defined]
            EquityCurveBuilder,
        )

        return cast(list[Position], EquityCurveBuilder(trades).reconstruct_positions())
