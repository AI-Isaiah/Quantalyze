"""Phase 19 / BACKBONE-02 — CSV ingestion adapter.

Wraps services/csv_validator.py (Phase 15). Unlike the broker adapters,
CSV does NOT have credential validation — the `validate` method runs
file-format validation (pandera schemas + the 6 CSV-02 rules) and
returns ValidationResult.read_only=None because the field is N/A for a
file upload.

DEVIATION FROM PLAN BLUEPRINT (Rule 3 — blocking issue):
The 19-03 plan blueprint references `csv_validator.parse_csv`,
`validate_schema`, `df_to_trades`, and `CsvValidationError` — none of
which exist in the actual services/csv_validator.py. The Phase 15
module exposes a single public entrypoint `validate_csv(raw_bytes,
fmt) -> dict` that returns the envelope `{ok, preview, errors,
correlation_id}`. This adapter therefore wraps THAT envelope shape
(the only available primitive) instead of the granular helpers the
blueprint imagined. Behavior is equivalent: pandera schemas still run,
the 6 CSV-02 rules still fire, error codes still surface.

Trade-level fetch (`fetch_raw`) is implemented inline against
pd.read_csv on the raw bytes for `fmt='trades'` because the blueprint's
`df_to_trades` helper does not exist. For `daily_returns` and
`daily_nav` formats, fetch_raw returns an empty list — those formats
do not produce fill-level data; the existing CSV pipeline routes them
through a daily-PnL aggregation downstream that does not need Trade
objects.

v0 limitation (per CONTEXT.md L83): mark prices are not applicable for
CSV ingestion; open positions are assumed flat at upload time. Funding-
rate accumulation is not computed for CSV. Documented here for
downstream consumers (PDF report, dashboard); revisited in v2 once a
mark-snapshot column ships.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any, cast

from services.ingestion.adapter import (
    Fingerprint,
    KeySubmissionRequest,
    MetricsSnapshot,
    Position,
    Trade,
    ValidationResult,
)


class CsvAdapter:
    """CSV adapter — wraps services/csv_validator.py."""

    SOURCE: str = "csv"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        # context carries: raw_bytes (bytes), fmt ∈ {daily_returns,
        # daily_nav, trades}, strategy_id, wizard_session_id, user_id.
        from services import csv_validator

        raw_bytes = req.context["raw_bytes"]
        fmt = req.context["fmt"]

        try:
            envelope = csv_validator.validate_csv(raw_bytes, fmt)
        except ValueError as exc:
            # validate_csv raises ValueError for an unknown fmt.
            return ValidationResult(
                valid=False,
                read_only=None,
                error_code="CSV_FORMAT_UNSUPPORTED",
                human_message=str(exc),
                debug_context=None,
            )

        if envelope.get("ok"):
            return ValidationResult(
                valid=True,
                read_only=None,
                error_code=None,
                human_message=None,
                debug_context=None,
            )

        errors = envelope.get("errors") or []
        # Use the first rule code as the error_code discriminator so the
        # Phase 17 DESIGN-05 wizardErrors.ts lookup can render a
        # granular human message; carry the full list under
        # debug_context.violations for the inline-issue UI.
        first_rule = (
            str(errors[0].get("rule"))
            if errors and isinstance(errors[0], dict)
            else "CSV_VALIDATION_FAILED"
        )
        return ValidationResult(
            valid=False,
            read_only=None,
            error_code=first_rule.upper() if first_rule else "CSV_VALIDATION_FAILED",
            human_message=(
                str(errors[0].get("message"))
                if errors and isinstance(errors[0], dict)
                else None
            ),
            debug_context={"violations": errors},
        )

    async def fetch_raw(self, creds_or_file: dict[str, Any]) -> list[Trade]:
        # Trade-level fetch only meaningful for fmt='trades'. The
        # daily_returns / daily_nav formats produce daily-PnL series that
        # the downstream pipeline aggregates without a Trade list.
        fmt = creds_or_file.get("fmt")
        if fmt != "trades":
            return []

        import pandas as pd  # type: ignore[import-untyped]

        raw_bytes = creds_or_file["raw_bytes"]
        df = pd.read_csv(io.BytesIO(raw_bytes), encoding="utf-8-sig")
        df.columns = [str(c).strip().lower() for c in df.columns]

        trades: list[Trade] = []
        for row in df.to_dict(orient="records"):
            trades.append(_csv_row_to_trade(row))
        return trades

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        # Lazy import: P8 ships EquityCurveBuilder in Wave 2.
        from services.equity_reconstruction import (  # type: ignore[attr-defined]
            EquityCurveBuilder,
        )

        return cast(MetricsSnapshot, EquityCurveBuilder(trades).to_metrics_snapshot())

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint:
        # P9 ships compute_fingerprint_v1 in this same package.
        from services.ingestion.fingerprint import compute_fingerprint_v1

        return compute_fingerprint_v1(trades, metrics)

    async def reconstruct_positions(
        self, trades: list[Trade]
    ) -> list[Position]:
        # v0 limitation per CONTEXT.md L83: mark prices are not
        # applicable for CSV ingestion; open positions are assumed flat
        # at upload time. Returns [] regardless of trade count. Revisit
        # in v2 once a mark-snapshot column ships and the broker-side
        # mark-price oracle can fall through to a CSV-supplied snapshot.
        return []


def _csv_row_to_trade(row: dict[str, Any]) -> Trade:
    """Convert a single trades-fmt CSV row → Trade dataclass.

    Schema columns (per csv_validator.SCHEMAS['trades']): date, side,
    qty, price, symbol, currency. Only present in `fmt='trades'` —
    daily_returns / daily_nav formats route through fetch_raw's empty-
    list shortcut.
    """
    ts_raw = row.get("date") or row.get("timestamp")
    if isinstance(ts_raw, datetime):
        ts = ts_raw if ts_raw.tzinfo else ts_raw.replace(tzinfo=timezone.utc)
    elif isinstance(ts_raw, (int, float)):
        ts = datetime.fromtimestamp(float(ts_raw) / 1000, tz=timezone.utc)
    elif ts_raw is None:
        raise ValueError("CSV row missing date/timestamp")
    else:
        ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

    return Trade(
        exchange="csv",
        symbol=str(row.get("symbol", "")),
        side=str(row.get("side", "")),
        price=float(row.get("price", 0.0) or 0.0),
        quantity=float(row.get("qty", row.get("quantity", 0.0)) or 0.0),
        fee=float(row.get("fee", 0.0) or 0.0),
        fee_currency=str(row.get("currency") or row.get("fee_currency") or "USD"),
        timestamp=ts,
        order_type=str(row.get("order_type", "csv")),
        is_fill=bool(row.get("is_fill", True)),
    )
