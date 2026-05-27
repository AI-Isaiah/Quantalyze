"""Phase 19 / BACKBONE-02 — CSV ingestion adapter.

Wraps services/csv_validator.py (Phase 15). Unlike the broker adapters,
CSV does NOT have credential validation — the `validate` method runs
file-format validation (pandera schemas + the 6 CSV-02 rules) and
returns ValidationResult.read_only=None because the field is N/A for a
file upload.

Wire-shape contract (CR-03 fix, REVIEW.md 2026-05-08)
-----------------------------------------------------
The Next.js thin adapter at src/app/api/strategies/csv-validate/route.ts
serializes file bytes as base64 under `context.raw_bytes_base64` because
JSON has no native bytes type (multipart can't survive JSON encode). The
pre-fix adapter expected `context.raw_bytes` (raw bytes) and threw KeyError
on every CSV validate call when the unified-backbone flag was on.

Canonical key: `raw_bytes_base64` (string). The adapter base64-decodes on
entry. We retain a fallback to legacy `raw_bytes` (raw Python bytes) for
unit tests and any internal caller that already speaks bytes natively.

DEVIATION FROM PLAN BLUEPRINT: blueprint helpers (parse_csv,
validate_schema, df_to_trades, CsvValidationError) don't exist in
services/csv_validator.py — the actual public entrypoint is
``validate_csv(raw_bytes, fmt) -> dict``. Adapter wraps the envelope
shape directly. v0 limitation per CONTEXT.md L83: mark-prices and
funding accumulation are not applied to CSV. Full rationale in
.planning/phase-19/csv-adapter-deviation.md.
"""
from __future__ import annotations

import base64
import io
from datetime import datetime, timezone
from typing import Any

from services.ingestion.adapter import (
    Fingerprint,
    KeySubmissionRequest,
    MetricsSnapshot,
    Position,
    Trade,
    ValidationResult,
)


# 2026-05-27 (H1, security) — byte ceiling on the /process-key CSV path. The
# unified-backbone endpoint has no upstream size cap (unlike the TS edge route
# and the legacy FastAPI csv.py `_read_capped`), so a direct caller holding
# INTERNAL_API_TOKEN could hand an arbitrarily large base64 blob and OOM / DoS
# the worker via base64.b64decode + pd.read_csv. Reject oversize BEFORE
# allocating the full decoded buffer. 10 MB matches the TS edge + legacy caps.
MAX_CSV_BYTES = 10 * 1024 * 1024
# base64 inflates by ~4/3; bound the b64 string so the decode can't allocate
# past the cap. Slack covers padding/newlines.
_MAX_CSV_B64_CHARS = (MAX_CSV_BYTES * 4) // 3 + 1024


class CsvTooLargeError(ValueError):
    """Raised when an uploaded CSV exceeds MAX_CSV_BYTES."""


def _resolve_raw_bytes(context: dict[str, Any]) -> bytes:
    """CR-03 — resolve CSV bytes from the unified-backbone wire envelope.

    Canonical key: `raw_bytes_base64` (string). Falls back to legacy
    `raw_bytes` (raw bytes) for unit tests / internal callers. Raises
    KeyError if neither is present, or CsvTooLargeError if the payload exceeds
    MAX_CSV_BYTES, so the route surfaces a clean error.
    """
    b64 = context.get("raw_bytes_base64")
    if b64 is not None:
        if isinstance(b64, (bytes, bytearray)):
            b64 = bytes(b64).decode("ascii")
        if len(b64) > _MAX_CSV_B64_CHARS:
            raise CsvTooLargeError(
                f"CSV exceeds the {MAX_CSV_BYTES // (1024 * 1024)} MB limit."
            )
        decoded = base64.b64decode(b64)
        if len(decoded) > MAX_CSV_BYTES:
            raise CsvTooLargeError(
                f"CSV exceeds the {MAX_CSV_BYTES // (1024 * 1024)} MB limit "
                f"({len(decoded)} bytes)."
            )
        return decoded
    raw = context.get("raw_bytes")
    if raw is not None:
        # Legacy callers occasionally hand a UTF-8 string; preserve
        # backwards-compatibility but emit bytes.
        data = raw.encode("utf-8") if isinstance(raw, str) else bytes(raw)
        if len(data) > MAX_CSV_BYTES:
            raise CsvTooLargeError(
                f"CSV exceeds the {MAX_CSV_BYTES // (1024 * 1024)} MB limit "
                f"({len(data)} bytes)."
            )
        return data
    raise KeyError(
        "CSV context missing both `raw_bytes_base64` (canonical) and "
        "`raw_bytes` (legacy); the thin adapter must base64-encode file bytes."
    )


class CsvAdapter:
    """CSV adapter — wraps services/csv_validator.py."""

    SOURCE: str = "csv"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        # CR-03: context.raw_bytes_base64 is the canonical wire shape from
        # the Next.js thin adapter (csv-validate/route.ts). Legacy raw_bytes
        # (Python bytes) still accepted for unit tests / internal callers.
        # context also carries: fmt ∈ {daily_returns, daily_nav, trades},
        # strategy_id (optional pre-strategy), wizard_session_id, user_id.
        from services import csv_validator

        try:
            raw_bytes = _resolve_raw_bytes(req.context)
        except CsvTooLargeError as exc:
            # H1 — reject oversize uploads cleanly instead of OOM-ing the pod.
            return ValidationResult(
                valid=False,
                read_only=None,
                error_code="CSV_TOO_LARGE",
                human_message=str(exc),
                debug_context=None,
            )
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

        # CR-03: same canonical-key resolution as validate().
        raw_bytes = _resolve_raw_bytes(creds_or_file)
        df = pd.read_csv(io.BytesIO(raw_bytes), encoding="utf-8-sig")
        df.columns = [str(c).strip().lower() for c in df.columns]

        # I-perf-4 — itertuples avoids materialising the entire dataframe
        # as a list of dicts in memory. For a 50k-row CSV upload that's
        # ~30MB of dict allocation that gets immediately discarded after
        # the per-row Trade construction. itertuples streams the rows
        # without that intermediate. We pass index=False because the
        # CSV row index is meaningless to _csv_row_to_trade.
        cols = list(df.columns)
        trades: list[Trade] = []
        for tup in df.itertuples(index=False, name=None):
            row = dict(zip(cols, tup))
            trades.append(_csv_row_to_trade(row))
        return trades

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        # Lazy import: P8 ships EquityCurveBuilder in Wave 2.
        from services.equity_reconstruction import EquityCurveBuilder

        return EquityCurveBuilder(trades).to_metrics_snapshot()

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
    if ts_raw is None:
        raise ValueError("CSV row missing date/timestamp")
    # M-17 — shared coercion lives in services.ingestion._timestamps so
    # CSV + broker adapters parse identical shapes.
    from services.ingestion._timestamps import coerce_to_aware_utc

    ts = coerce_to_aware_utc(ts_raw, "csv")

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
