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
the trades + position_snapshots tables.

CR-01 fix (REVIEW.md 2026-05-08):
The supabase client cannot be transported through the JSON envelope
sent by the Next.js thin adapters — JSON has no representation for a
Python supabase client object. We instead build the supabase client
locally inside `fetch_raw` via `services.db.get_supabase()` (the same
pattern the rest of analytics-service uses). `strategy_id` is read
from the context dict; if absent (teaser flow has no anchor strategy
row yet) we raise a clear error so the router surfaces a recoverable
envelope rather than letting the underlying KeyError leak as an
unhandled 500.
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
            await exchange_service.aclose_exchange(ex)

    async def fetch_raw(self, creds_or_file: dict[str, Any]) -> list[Trade]:
        # CR-01 fix — build supabase client locally rather than expecting
        # a Python client object on the JSON envelope. The thin adapters
        # under src/app/api/* serialize creds_or_file as JSON; a supabase
        # client cannot survive that round-trip, so the previous
        # `creds_or_file["supabase"]` lookup raised KeyError on every
        # Binance teaser/onboard hit when the unified-backbone flag was on.
        from services.db import get_supabase

        strategy_id = creds_or_file.get("strategy_id")
        if not strategy_id:
            # Teaser flow lands here pre-strategy creation. The legacy
            # `_fetch_raw_trades_binance` requires `strategy_id` to look up
            # the symbol set already traded (it cannot enumerate all
            # binance symbols in a single fetch). Surface a typed error so
            # the router can return a recoverable envelope.
            raise ValueError(
                "BinanceAdapter.fetch_raw requires context.strategy_id; "
                "teaser flow has no anchor strategy row yet — caller must "
                "allocate a draft strategy first."
            )

        ex = exchange_service.create_exchange(
            "binance",
            creds_or_file["api_key"],
            creds_or_file["api_secret"],
            None,
        )
        try:
            raw = await exchange_service._fetch_raw_trades_binance(
                ex,
                strategy_id,
                get_supabase(),
                creds_or_file.get("since_ms"),
            )
            return [_normalize_trade(r, "binance") for r in raw]
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
