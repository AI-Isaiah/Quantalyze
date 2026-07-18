"""Phase 19 / BACKBONE-02 — shared dataclasses for the IngestionAdapter Protocol.

@dataclass instead of pydantic.BaseModel mirrors services/exchange.py:444
RawFill precedent. FastAPI routers parse pydantic bodies and convert into
KeySubmissionRequest at the entry point (see routers/process_key.py — P4).

Locked enums per CONTEXT.md L72; align with REQUIREMENTS.md BACKBONE-01.
The Source list is explicitly `okx | binance | bybit | csv` — UC-B drops
MT5/IBKR for v1.0.0.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal


# ---------------------------------------------------------------------------
# Literal type aliases — CONTEXT.md L72 locked enums.
# ---------------------------------------------------------------------------

FlowType = Literal["teaser", "onboard", "internal_report", "csv", "resync"]
# Phase 68 (OQ2): "deribit" widened the Source Literal for key-save boundary
# type-consistency. Phase 70 (DRB-08, 70-06) now SHIPS the deribit ingestion
# path: the ingestion registry (``SUPPORTED_SOURCES`` in
# services/ingestion/__init__.py) admits deribit and get_adapter("deribit")
# resolves a DeribitAdapter. This is the ingestion CAPABILITY only — the
# ``process_key`` per-flow onboarding sets still exclude deribit (live LTP
# onboarding is Phase 72), and Deribit returns flow through the broker-dailies
# ONE-path (70-05, txn-log ledger), never fill-based process_key metrics.
Source = Literal["okx", "binance", "bybit", "csv", "deribit", "sfox"]
TrustTier = Literal["api_verified", "csv_uploaded", "self_reported"]
Status = Literal[
    "draft",
    "validated",
    "metrics_captured",
    "encrypted",
    "report_queued",
    "published",
]


# ---------------------------------------------------------------------------
# Request / response envelopes (BACKBONE-01 contract surface).
# ---------------------------------------------------------------------------


@dataclass
class KeySubmissionRequest:
    """Body shape for POST /process-key. Phase 19 / BACKBONE-01.

    `context` carries flow-specific payload. Concrete shapes (informal,
    enforced at the FastAPI router boundary in P4):
      - teaser/onboard/resync (API):
            {api_key, api_secret, passphrase?, strategy_id,
             wizard_session_id, user_id}
      - csv:
            {raw_bytes (bytes) | csv_blob_url, fmt ∈ {daily_returns,
             daily_nav, trades}, strategy_id, wizard_session_id, user_id}
      - internal_report:
            {strategy_id} (read-only flow; not used in /process-key in v1)
    """

    flow_type: FlowType
    source: Source
    context: dict[str, Any]


@dataclass
class ValidationResult:
    """Outcome of IngestionAdapter.validate.

    Mirrors services/exchange.py validate_key_permissions() return shape
    (Phase 17 DESIGN-05 envelope contract). For CSV, `read_only` is None
    because the field is N/A for file-format validation.
    """

    valid: bool
    read_only: bool | None
    # AUTH_FAILED | PERMISSION_DENIED | RATE_LIMITED | DDOS_PROTECTION |
    # NETWORK_UNAVAILABLE | EXCHANGE_UNAVAILABLE | UNSUPPORTED_EXCHANGE |
    # WITHDRAW_SCOPE | TRADE_SCOPE | MISSING_SCOPE | PROBE_FAILED |
    # VALIDATION_UNEXPECTED |
    # CSV_VALIDATION_FAILED (Phase 19 addition for the CSV adapter).
    # (PROBE_FAILED is set by services/exchange.py when the permission probe
    # fail-closes on a transient upstream error — Phase 110.1 / DOGFOOD-3.)
    error_code: str | None
    # SoT for human-readable text: src/lib/wizardErrors.ts (Phase 17
    # DESIGN-05). Adapters return `error_code`; the Next.js layer does
    # the lookup. `human_message` is populated only for legacy callers
    # that need the raw exchange-derived message — new callers should
    # treat `error_code` as authoritative.
    human_message: str | None
    debug_context: dict[str, Any] | None
    # Phase 19.1 (2026-05-27) — CSV wizard preview passthrough. The CSV
    # adapter populates these from csv_validator.validate_csv()'s success
    # envelope so the unified /process-key validate-only flow returns the
    # same {preview, daily_returns_series} the wizard's CsvUploadStep
    # requires: it raises CSV_UPSTREAM_FAIL on a missing `preview` and
    # forwards `daily_returns_series` to csv-finalize. None for the API-key
    # adapter, which has no file preview. Shapes: PreviewShape in
    # CsvUploadStep.tsx; the success envelope in csv_validator.py.
    preview: dict[str, Any] | None = None
    daily_returns_series: list[dict[str, Any]] | None = None


# ---------------------------------------------------------------------------
# Domain dataclasses (consumed by IngestionAdapter pipeline + P4 router).
# ---------------------------------------------------------------------------


@dataclass
class Trade:
    """Normalized trade fill across all sources (broker SDK + CSV)."""

    exchange: str
    symbol: str
    side: str
    price: float
    quantity: float
    fee: float
    fee_currency: str
    timestamp: datetime
    order_type: str
    is_fill: bool


@dataclass
class Position:
    """Reconstructed position from trade fills (open or closed).

    `duration_days` is NUMERIC per migration 092 (the trades→positions
    pipeline rounded to integer days pre-092 which lost intraday
    information; the column is now NUMERIC and the dataclass mirrors).
    """

    strategy_id: str
    symbol: str
    side: str
    opened_at: datetime
    closed_at: datetime | None
    entry_price: float
    exit_price: float | None
    quantity: float
    pnl: float | None
    funding_pnl: float | None
    status: Literal["open", "closed"]
    roi: float | None
    duration_days: float | None


@dataclass
class MetricsSnapshot:
    """Computed metrics from the trade pipeline.

    Populated by P8 EquityCurveBuilder.to_metrics_snapshot() — Wave 2.
    Lives on the protocol surface so P4 router can serialize it into
    `VerificationResult.metrics_snapshot` without importing P8 internals.
    """

    sharpe: float | None
    twr: float | None
    ytd: float | None
    max_drawdown: float | None
    total_pnl: float | None
    trade_count: int
    win_rate: float | None


@dataclass
class Fingerprint:
    """Versioned 5-component fingerprint per CONTEXT.md L66-72.

    All 5 components L1-normalized so each sums to 1.0 — cosine
    similarity (compute_similarity SQL function in migration 105) is
    well-defined. Empty trades → all-zeros default; compute_similarity
    returns 0.0 on either-zero norm so the empty case is benign.
    """

    version: int = 1
    trade_size_buckets: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    hold_duration_buckets: tuple[float, float, float, float] = (
        0.0,
        0.0,
        0.0,
        0.0,
    )
    asset_class_mix: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    instrument_concentration: tuple[float, ...] = field(
        default_factory=lambda: (0.0,) * 10
    )
    temporal_pattern: tuple[float, ...] = field(
        default_factory=lambda: (0.0,) * 24
    )

    def to_jsonb(self) -> dict[str, Any]:
        """Serialize for the strategies.fingerprint JSONB column.

        The 5 component arrays + a `version` discriminator, exactly the
        shape compute_similarity() (migration 105) expects.
        """
        return {
            "version": self.version,
            "trade_size_buckets": list(self.trade_size_buckets),
            "hold_duration_buckets": list(self.hold_duration_buckets),
            "asset_class_mix": list(self.asset_class_mix),
            "instrument_concentration": list(self.instrument_concentration),
            "temporal_pattern": list(self.temporal_pattern),
        }


@dataclass
class VerificationResult:
    """Phase 19 / BACKBONE-01 — POST /process-key response shape.

    Carries the full pipeline output for the entry-route caller:
      - status: state-machine position after the pipeline run
      - trust_tier: api_verified | csv_uploaded | self_reported
      - metrics_snapshot / fingerprint: pipeline outputs (None on error
        envelope or before encrypted state)
      - encrypted_credentials: KEK-wrapped row from services.encryption
      - errors: list of {code, human_message, debug_context}
      - correlation_id: forwarded from analytics-client.ts seam (Phase 16
        OBSERV-09)
      - verification_id / queued: populated when long-fetch dispatched
        to the worker dyno (P6/P7)
    """

    status: Status
    trust_tier: TrustTier
    metrics_snapshot: MetricsSnapshot | None
    fingerprint: Fingerprint | None
    encrypted_credentials: dict[str, Any] | None
    errors: list[dict[str, Any]] | None
    correlation_id: str
    verification_id: str | None = None
    queued: bool = False
