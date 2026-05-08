"""Phase 19 / BACKBONE-02 — OKX broker adapter.

Wraps services/exchange.py (629 LOC unchanged per ROADMAP REUSE flag).
KeySubmissionRequest.context carries the credential payload for the API
flows (teaser / onboard / resync): api_key, api_secret, passphrase,
strategy_id, wizard_session_id, user_id.

The 5 IngestionAdapter methods delegate as follows:
  - validate          → exchange.validate_key_permissions
  - fetch_raw         → exchange._fetch_raw_trades_okx + _normalize_trade
  - compute_metrics   → P8 EquityCurveBuilder.to_metrics_snapshot (lazy)
  - compute_fingerprint → P9 compute_fingerprint_v1 (lazy)
  - reconstruct_positions → P8 EquityCurveBuilder.reconstruct_positions

P8 / P9 are Wave 2; the adapter must not hard-import them at module
load time (would create a Wave-1 → Wave-2 dependency the orchestrator
disallows). Lazy imports inside the method bodies satisfy this.
"""
from __future__ import annotations

from datetime import datetime, timezone
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


class OkxAdapter:
    """OKX adapter — wraps services/exchange.py without rewriting."""

    SOURCE: str = "okx"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        creds = req.context
        ex = exchange_service.create_exchange(
            "okx",
            creds["api_key"],
            creds["api_secret"],
            creds.get("passphrase"),
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

    async def fetch_raw(self, creds_or_file: dict) -> list[Trade]:
        ex = exchange_service.create_exchange(
            "okx",
            creds_or_file["api_key"],
            creds_or_file["api_secret"],
            creds_or_file.get("passphrase"),
        )
        try:
            raw = await exchange_service._fetch_raw_trades_okx(
                ex, since_ms=creds_or_file.get("since_ms")
            )
            return [_normalize_trade(r, "okx") for r in raw]
        finally:
            await ex.close()

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        # Lazy import: P8 ships EquityCurveBuilder in Wave 2; the adapter
        # cannot hard-import it without creating a Wave-1 → Wave-2 cycle.
        from services.equity_reconstruction import (  # type: ignore[attr-defined]
            EquityCurveBuilder,
        )

        return EquityCurveBuilder(trades).to_metrics_snapshot()

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint:
        # Lazy import: P9 ships compute_fingerprint_v1 in Wave 2.
        from services.ingestion.fingerprint import (  # type: ignore[import-not-found]
            compute_fingerprint_v1,
        )

        return compute_fingerprint_v1(trades, metrics)

    async def reconstruct_positions(
        self, trades: list[Trade]
    ) -> list[Position]:
        # BACKBONE-09 reuse: P8 EquityCurveBuilder.reconstruct_positions
        # wraps the existing position_reconstruction._match_positions_fifo
        # primitive without rewriting it.
        from services.equity_reconstruction import (  # type: ignore[attr-defined]
            EquityCurveBuilder,
        )

        return EquityCurveBuilder(trades).reconstruct_positions()


def _normalize_trade(raw: dict[str, Any], exchange: str) -> Trade:
    """Normalize a raw broker fill dict → canonical Trade dataclass.

    services/exchange.py emits per-exchange dicts whose keys are already
    aligned to the trades-table schema (`exchange, symbol, side, price,
    quantity, fee, fee_currency, timestamp, order_type, is_fill`). This
    helper just coerces timestamps (which may be ISO strings or numeric
    ms) and float-casts the numeric columns.

    Shared between Okx / Binance / Bybit adapters (binance + bybit
    import this symbol from .okx to avoid duplication).
    """
    ts_raw = raw.get("timestamp") or raw.get("ts")
    if isinstance(ts_raw, datetime):
        ts = ts_raw if ts_raw.tzinfo else ts_raw.replace(tzinfo=timezone.utc)
    elif isinstance(ts_raw, (int, float)):
        ts = datetime.fromtimestamp(ts_raw / 1000, tz=timezone.utc)
    elif isinstance(ts_raw, str):
        # ISO string — exchange.py emits .isoformat() on datetimes that
        # are already UTC, so the trailing 'Z' may or may not be present.
        ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
    else:
        raise ValueError(
            f"Unsupported timestamp shape from {exchange}: {ts_raw!r}"
        )

    fee_raw = raw.get("fee", 0.0)
    if isinstance(fee_raw, dict):
        # ccxt's fee shape: {cost, currency}; the exchange.py fetchers
        # already flatten this, but ccxt.fetch_my_trades preserves it
        # and the binance fill normalizer (services/exchange.py
        # _normalize_fill) may pass it through.
        fee = float(fee_raw.get("cost", 0.0) or 0.0)
        fee_currency = str(fee_raw.get("currency") or raw.get("fee_currency") or "")
    else:
        fee = float(fee_raw or 0.0)
        fee_currency = str(raw.get("fee_currency") or "")

    return Trade(
        exchange=str(raw.get("exchange") or exchange),
        symbol=str(raw.get("symbol", "")),
        side=str(raw.get("side", "")),
        price=float(raw.get("price", 0.0) or 0.0),
        quantity=float(raw.get("quantity", raw.get("amount", 0.0)) or 0.0),
        fee=fee,
        fee_currency=fee_currency,
        timestamp=ts,
        order_type=str(raw.get("order_type", raw.get("type", "fill"))),
        is_fill=bool(raw.get("is_fill", True)),
    )
