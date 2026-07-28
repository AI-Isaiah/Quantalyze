---
phase: 19
slug: unified-backbone-conditional-on-day-2-gate-commit
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - analytics-service/services/ingestion/__init__.py
  - analytics-service/services/ingestion/adapter.py
  - analytics-service/services/ingestion/okx.py
  - analytics-service/services/ingestion/binance.py
  - analytics-service/services/ingestion/bybit.py
  - analytics-service/services/ingestion/csv_adapter.py
  - analytics-service/tests/test_ingestion_protocol.py
  - analytics-service/tests/test_csv_adapter.py
  - analytics-service/Makefile  # MC-3: add `lint:` target invoking `mypy --strict services/ingestion/`
autonomous: true
requirements: [BACKBONE-01, BACKBONE-02]
must_haves:
  truths:
    - "`IngestionAdapter` Protocol defines exactly 5 methods (validate, fetch_raw, compute_metrics, compute_fingerprint, reconstruct_positions) with stable signatures importable from `analytics-service.services.ingestion`"
    - "Each of OkxAdapter / BinanceAdapter / BybitAdapter / CsvAdapter is structurally a Protocol-conformant adapter (passes `isinstance(adapter, IngestionAdapter)` runtime_checkable test)"
    - "Adapters delegate to existing `services/exchange.py` (629 LOC unchanged per ROADMAP REUSE flag) — no rewrite of broker fetch logic"
    - "ADAPTERS dict maps `'okx' | 'binance' | 'bybit' | 'csv'` to instances; `get_adapter(source)` raises ValueError on unknown source"
    - "CSV adapter's `validate` returns ValidationResult with `read_only=None` (N/A for file-format check); reconstruct_positions returns [] (v0 limitation documented in docstring)"
    - "Shared dataclasses (KeySubmissionRequest, VerificationResult, Trade, Position, MetricsSnapshot, Fingerprint, ValidationResult) defined exactly once in adapter.py and re-exported from __init__.py"
  artifacts:
    - path: "analytics-service/services/ingestion/__init__.py"
      provides: "IngestionAdapter Protocol + ADAPTERS registry + get_adapter() lookup"
      contains: "ADAPTERS"
    - path: "analytics-service/services/ingestion/adapter.py"
      provides: "Shared dataclasses + Literal type aliases"
      contains: "@dataclass"
    - path: "analytics-service/services/ingestion/okx.py"
      provides: "OKX broker adapter wrapping services/exchange.py"
      contains: "class OkxAdapter"
    - path: "analytics-service/services/ingestion/binance.py"
      provides: "Binance broker adapter"
      contains: "class BinanceAdapter"
    - path: "analytics-service/services/ingestion/bybit.py"
      provides: "Bybit broker adapter"
      contains: "class BybitAdapter"
    - path: "analytics-service/services/ingestion/csv_adapter.py"
      provides: "CSV adapter wrapping services/csv_validator.py"
      contains: "class CsvAdapter"
  key_links:
    - from: "OkxAdapter.validate"
      to: "services.exchange.validate_key_permissions"
      via: "delegation through services.exchange.create_exchange + try/finally close()"
      pattern: "validate_key_permissions"
    - from: "BinanceAdapter.fetch_raw"
      to: "services.exchange._fetch_raw_trades_binance"
      via: "private fetcher delegated through ccxt instance"
      pattern: "_fetch_raw_trades_"
    - from: "CsvAdapter.validate"
      to: "services.csv_validator.parse_csv + validate_schema"
      via: "Phase 15 csv_validator primitives"
      pattern: "csv_validator"
    - from: "OkxAdapter.compute_metrics"
      to: "services.equity_reconstruction.EquityCurveBuilder"
      via: "P8 EquityCurveBuilder.to_metrics_snapshot()"
      pattern: "EquityCurveBuilder"
    - from: "OkxAdapter.compute_fingerprint"
      to: "services.ingestion.fingerprint.compute_fingerprint_v1"
      via: "P9 fingerprint module"
      pattern: "compute_fingerprint_v1"
---

<objective>
Ship the `IngestionAdapter` Protocol (BACKBONE-02) and 4 concrete adapters
under a new `analytics-service/services/ingestion/` package. The Protocol is
the contract every Phase 19 broker/CSV adapter implements; concrete adapters
WRAP existing primitives — they do NOT rewrite broker fetch logic
(`services/exchange.py` 629 LOC unchanged per ROADMAP REUSE flag).

Module layout (per CONTEXT.md L42-47):
- `ingestion/__init__.py` — Protocol declaration (PEP 544 `runtime_checkable`),
  ADAPTERS registry dict, `get_adapter(source)` lookup function.
- `ingestion/adapter.py` — Shared dataclasses (`KeySubmissionRequest`,
  `VerificationResult`, `Trade`, `Position`, `MetricsSnapshot`, `Fingerprint`,
  `ValidationResult`) + Literal type aliases (`FlowType`, `Source`, `TrustTier`,
  `Status`).
- `ingestion/okx.py` — `OkxAdapter` wraps `services/exchange.py` OKX-specific
  fetchers; KeySubmissionRequest.context carries api_key + api_secret + passphrase.
- `ingestion/binance.py` — `BinanceAdapter` (same pattern; no passphrase).
- `ingestion/bybit.py` — `BybitAdapter` (Bybit broker quirks already patched
  in services/exchange.py:35-46 — DO NOT re-patch).
- `ingestion/csv_adapter.py` — `CsvAdapter` wraps Phase 15 `services/csv_validator.py`;
  `validate` returns `read_only=None` (N/A for file-format); `reconstruct_positions`
  returns `[]` (v0 limitation documented in docstring per CONTEXT.md L83).

The 5 Protocol methods (CONTEXT.md L49-54):
1. `validate(req: KeySubmissionRequest) -> ValidationResult` — broker creds OR file format.
2. `fetch_raw(creds_or_file: dict) -> list[Trade]` — broker fetch OR CSV parse.
3. `compute_metrics(trades: list[Trade]) -> MetricsSnapshot` — delegates to P8.
4. `compute_fingerprint(trades, metrics) -> Fingerprint` — delegates to P9.
5. `reconstruct_positions(trades) -> list[Position]` — wires existing
   `position_reconstruction.py` + `positions.py` + `funding_fetch.py` primitives
   (BACKBONE-09 reuse).

NOT in this plan (handled by P4 router): orchestration of the 5 methods in
sequence, state-machine RPC calls between steps, `INTERNAL_API_TOKEN` auth.

Purpose: Provides the typed protocol surface that P4 router (Wave 2) consumes
and that P5 thin adapters indirectly depend on (via `/process-key` shape).
Wave 1 / independent of P1, P2 (only needs existing services to import; does
not touch new schema).

Output: 6 source files + 2 pytest stubs covering Protocol conformance and
CSV-specific behavior.

Tracking: BACKBONE-01 (KeySubmissionRequest/VerificationResult shapes match
the /process-key body contract), BACKBONE-02 (Protocol + adapters).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md
@analytics-service/services/exchange.py
@analytics-service/services/encryption.py
@analytics-service/services/csv_validator.py
@analytics-service/services/position_reconstruction.py
@analytics-service/services/equity_reconstruction.py

<interfaces>
<!-- Existing primitives this plan WRAPS (REUSE flag — do not rewrite). -->

From `analytics-service/services/exchange.py` (629 LOC unchanged):
- `create_exchange(name: str, api_key: str, api_secret: str, passphrase: str | None = None) -> ccxt.Exchange`
- `validate_key_permissions(ex) -> dict` — returns `{"valid": bool, "read_only": bool, "error_code": str | None, "error": str | None, "markers": dict, "markets_loaded": bool, "probe_error": str | None}`
- `_fetch_raw_trades_okx(ex, since_ms: int | None) -> list[dict]`
- `_fetch_raw_trades_binance(ex, since_ms: int | None) -> list[dict]`
- `_fetch_raw_trades_bybit(ex, since_ms: int | None) -> list[dict]`
- Existing error_code enum (RESEARCH.md L603 reference): AUTH_FAILED, PERMISSION_DENIED, RATE_LIMITED, NETWORK_UNAVAILABLE, EXCHANGE_UNAVAILABLE, UNKNOWN
- Bybit quirks already patched at services/exchange.py:35-46 — DO NOT re-patch in BybitAdapter
- @dataclass RawFill at services/exchange.py:444 — adapter pattern reference

From `analytics-service/services/csv_validator.py` (Phase 15):
- `parse_csv(raw_bytes: bytes, fmt: str) -> pd.DataFrame`
- `validate_schema(df: pd.DataFrame, fmt: str) -> None` (raises CsvValidationError)
- `df_to_trades(df, fmt) -> list[dict]` (only `trades` fmt produces fill-level)
- `class CsvValidationError(Exception)` with `code`, `human_message`, `violations` attrs

From `analytics-service/services/encryption.py`:
- `encrypt_credentials(api_key: str, api_secret: str, passphrase: str | None, kek: bytes) -> dict`
- `get_kek() -> bytes`

From `analytics-service/services/position_reconstruction.py`:
- `reconstruct_positions(strategy_id, supabase) -> ...` — DB-side persisting variant
- `_match_positions_fifo(symbol, fills, strategy_id) -> list[dict]` — pure FIFO matcher (P3 wraps this for in-memory use; P8 may expose without underscore)

From `analytics-service/services/equity_reconstruction.py`:
- (existing module — P8 appends `EquityCurveBuilder` class; P3 imports it lazily inside compute_metrics + reconstruct_positions methods)
</interfaces>
</context>

<no_git_branch_ops>
You are running on branch `v1.0.0-phase-19-unified-backbone`. Do NOT run
`git checkout`, `git pull`, `git fetch`, `git switch`, `git reset`, or any other
command that changes branches or pulls remote state. No commits, no pushes.
If you need to verify the branch, use `git rev-parse --abbrev-ref HEAD` (read-only).
</no_git_branch_ops>

<tasks>

<task id="P3-1" type="auto" tdd="true">
  <name>Task 1: Write IngestionAdapter Protocol + shared dataclasses + ADAPTERS registry</name>
  <files>analytics-service/services/ingestion/__init__.py, analytics-service/services/ingestion/adapter.py, analytics-service/tests/test_ingestion_protocol.py</files>
  <read_first>
    - analytics-service/services/exchange.py (lines 1-100 + L444 RawFill dataclass)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 545-675 — Protocol shape + dataclasses; line 2127-2140 PEP 544 reference)
    - analytics-service/services/encryption.py (full file — encrypt_credentials signature)
    - supabase/migrations/092_positions_duration_days_numeric.sql (verify Position.duration_days is NUMERIC)
  </read_first>
  <behavior>
    - Test 1 (test_protocol_runtime_checkable): `runtime_checkable` decorated; abstract `IngestionAdapter` exposes 5 method names.
    - Test 2 (test_dataclasses_importable): `from services.ingestion.adapter import KeySubmissionRequest, VerificationResult, Trade, Position, MetricsSnapshot, Fingerprint, ValidationResult` succeeds.
    - Test 3 (test_fingerprint_to_jsonb_shape): `Fingerprint().to_jsonb()` returns a dict with exactly the 5 array keys + `version:1`; arrays are lengths 4,4,4,10,24.
    - Test 4 (test_get_adapter_unknown_source): `get_adapter('mt5')` raises ValueError mentioning 'Unsupported source'.
    - Test 5 (test_literal_types): FlowType, Source, TrustTier, Status are typing.Literal values matching the canonical enum (use typing.get_args to verify).
  </behavior>
  <action>
Create `analytics-service/services/ingestion/__init__.py`:

```python
"""Phase 19 / BACKBONE-02 — IngestionAdapter Protocol package.

Five-method pipeline contract; concrete adapters live in this package
(okx.py, binance.py, bybit.py, csv_adapter.py). Routers/process_key.py
orchestrates calls to these methods in sequence; state-machine RPC
(transition_strategy_verification, migration 103) is called between steps.

Existing primitives are WRAPPED (services/exchange.py 629 LOC unchanged
per ROADMAP REUSE flag); concrete adapters delegate to broker SDK
fetchers without rewrites.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from .adapter import (
    Fingerprint,
    FlowType,
    KeySubmissionRequest,
    MetricsSnapshot,
    Position,
    Source,
    Status,
    Trade,
    TrustTier,
    ValidationResult,
    VerificationResult,
)

__all__ = [
    "ADAPTERS",
    "Fingerprint",
    "FlowType",
    "IngestionAdapter",
    "KeySubmissionRequest",
    "MetricsSnapshot",
    "Position",
    "Source",
    "Status",
    "Trade",
    "TrustTier",
    "ValidationResult",
    "VerificationResult",
    "get_adapter",
]


@runtime_checkable
class IngestionAdapter(Protocol):
    """Phase 19 / BACKBONE-02. Five-method pipeline contract.

    Concrete impls live in this package as okx.py / binance.py / bybit.py /
    csv_adapter.py. Routers/process_key.py orchestrates calls to these
    methods in sequence.
    """

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult: ...

    async def fetch_raw(self, creds_or_file: dict) -> list[Trade]: ...

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot: ...

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint: ...

    async def reconstruct_positions(self, trades: list[Trade]) -> list[Position]: ...


# Adapter registry — populated lazily on first import to avoid circular imports.
ADAPTERS: dict[str, IngestionAdapter] = {}


def _register_adapters() -> None:
    """Populate ADAPTERS dict. Called once at import."""
    if ADAPTERS:
        return
    from .binance import BinanceAdapter
    from .bybit import BybitAdapter
    from .csv_adapter import CsvAdapter
    from .okx import OkxAdapter

    ADAPTERS["okx"] = OkxAdapter()
    ADAPTERS["binance"] = BinanceAdapter()
    ADAPTERS["bybit"] = BybitAdapter()
    ADAPTERS["csv"] = CsvAdapter()


def get_adapter(source: str) -> IngestionAdapter:
    """Resolve an adapter by `source` discriminator.

    Raises ValueError on unknown source (mt5 / ibkr / etc — UC-B drops these
    for v1.0.0; the supported list is exactly okx, binance, bybit, csv).
    """
    _register_adapters()
    if source not in ADAPTERS:
        raise ValueError(
            f"Unsupported source: {source!r}; valid: {sorted(ADAPTERS.keys())}"
        )
    return ADAPTERS[source]
```

Create `analytics-service/services/ingestion/adapter.py`:

```python
"""Phase 19 / BACKBONE-02 — shared dataclasses for the IngestionAdapter Protocol.

@dataclass instead of pydantic.BaseModel mirrors services/exchange.py:444
RawFill precedent. FastAPI routers parse pydantic bodies and convert into
KeySubmissionRequest at the entry point (see routers/process_key.py).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

# Locked enums per CONTEXT.md L72; align with REQUIREMENTS.md BACKBONE-01.
FlowType = Literal["teaser", "onboard", "internal_report", "csv", "resync"]
Source = Literal["okx", "binance", "bybit", "csv"]
TrustTier = Literal["api_verified", "csv_uploaded", "self_reported"]
Status = Literal[
    "draft", "validated", "metrics_captured",
    "encrypted", "report_queued", "published",
]


@dataclass
class KeySubmissionRequest:
    """Body shape for POST /process-key. Phase 19 / BACKBONE-01.

    `context` carries flow-specific payload:
      - teaser/onboard/resync (API): {api_key, api_secret, passphrase?, strategy_id, wizard_session_id, user_id}
      - csv: {raw_bytes (bytes) | csv_blob_url, fmt ∈ {daily_returns, daily_nav, trades}, strategy_id, wizard_session_id, user_id}
      - internal_report: {strategy_id} (read-only flow; not used in /process-key in v1)
    """

    flow_type: FlowType
    source: Source
    context: dict[str, Any]


@dataclass
class ValidationResult:
    """Outcome of IngestionAdapter.validate (Phase 17 DESIGN-05 envelope shape)."""

    valid: bool
    read_only: bool | None  # None for CSV
    error_code: str | None  # AUTH_FAILED | PERMISSION_DENIED | RATE_LIMITED | ... mirrors services/exchange.py
    human_message: str | None  # SoT: src/lib/wizardErrors.ts via Phase 17 DESIGN-05
    debug_context: dict[str, Any] | None


@dataclass
class Trade:
    """Normalized trade fill across all sources."""

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
    """Reconstructed position from trade fills (open or closed)."""

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
    duration_days: float | None  # NUMERIC per migration 092


@dataclass
class MetricsSnapshot:
    """Computed metrics from the trade pipeline (P8 EquityCurveBuilder.to_metrics_snapshot)."""

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

    All 5 components L1-normalized to sum to 1.0 so cosine similarity is
    meaningful. Empty trades → all-zeros (compute_similarity returns 0.0
    on either-zero norm, so similarity is well-defined).
    """

    version: int = 1
    trade_size_buckets: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    hold_duration_buckets: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    asset_class_mix: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    instrument_concentration: tuple[float, ...] = (0.0,) * 10
    temporal_pattern: tuple[float, ...] = (0.0,) * 24

    def to_jsonb(self) -> dict[str, Any]:
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
    """Phase 19 / BACKBONE-01 — POST /process-key response shape."""

    status: Status
    trust_tier: TrustTier
    metrics_snapshot: MetricsSnapshot | None
    fingerprint: Fingerprint | None
    encrypted_credentials: dict | None
    errors: list[dict] | None  # [{code, human_message, debug_context}, ...]
    correlation_id: str
    verification_id: str | None = None
    queued: bool = False
```

Then create `analytics-service/tests/test_ingestion_protocol.py` with the 5 behaviors above.
  </action>
  <acceptance_criteria>
    - File `analytics-service/services/ingestion/__init__.py` exists; defines `IngestionAdapter` Protocol + `ADAPTERS` dict + `get_adapter` function
    - `grep -q '@runtime_checkable' analytics-service/services/ingestion/__init__.py`
    - `grep -q 'class IngestionAdapter(Protocol)' analytics-service/services/ingestion/__init__.py`
    - File `analytics-service/services/ingestion/adapter.py` exists with all 7 dataclasses (KeySubmissionRequest, ValidationResult, Trade, Position, MetricsSnapshot, Fingerprint, VerificationResult) and 4 Literal aliases (FlowType, Source, TrustTier, Status)
    - `grep -c '@dataclass' analytics-service/services/ingestion/adapter.py` returns ≥ 7
    - `grep -q 'FlowType = Literal' analytics-service/services/ingestion/adapter.py`
    - `grep -q 'Source = Literal\["okx", "binance", "bybit", "csv"\]' analytics-service/services/ingestion/adapter.py`
    - File `analytics-service/tests/test_ingestion_protocol.py` exists with the 5 test functions
    - `python -c "from services.ingestion import IngestionAdapter, get_adapter, ADAPTERS"` succeeds (run from analytics-service dir)
  </acceptance_criteria>
  <automated>
    bash -c 'cd analytics-service && test -f services/ingestion/__init__.py && test -f services/ingestion/adapter.py && grep -q "class IngestionAdapter(Protocol)" services/ingestion/__init__.py && grep -q "@runtime_checkable" services/ingestion/__init__.py && grep -q "FlowType = Literal" services/ingestion/adapter.py && test -f tests/test_ingestion_protocol.py && grep -q "test_protocol_runtime_checkable" tests/test_ingestion_protocol.py'
  </automated>
  <requirements>BACKBONE-01, BACKBONE-02</requirements>
</task>

<task id="P3-2" type="auto" tdd="true">
  <name>Task 2: Write OKX/Binance/Bybit broker adapters wrapping services/exchange.py</name>
  <files>analytics-service/services/ingestion/okx.py, analytics-service/services/ingestion/binance.py, analytics-service/services/ingestion/bybit.py</files>
  <read_first>
    - analytics-service/services/exchange.py (full file for create_exchange, validate_key_permissions, _fetch_raw_trades_{okx,binance,bybit}, error_code enum)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 677-748 — OKX adapter blueprint; lines 805-810 — gotchas: ccxt close in finally, Bybit quirks already patched, source-of-truth wizardErrors.ts)
    - analytics-service/services/ingestion/adapter.py (Task 1 output — dataclass shapes)
  </read_first>
  <behavior>
    - Each of OkxAdapter, BinanceAdapter, BybitAdapter conforms to IngestionAdapter (passes runtime_checkable isinstance test).
    - validate() returns ValidationResult with read_only ∈ {True, False} (NOT None — that's CSV-only) and human_message=None on success.
    - fetch_raw() uses try/finally to close the ccxt instance.
    - compute_metrics() lazy-imports EquityCurveBuilder from services.equity_reconstruction (P8 dependency; deferred import).
    - compute_fingerprint() lazy-imports compute_fingerprint_v1 from services.ingestion.fingerprint (P9 dependency; deferred import).
    - BybitAdapter does NOT contain code patching `fetchCurrencies` (already patched at services/exchange.py:35-46).
  </behavior>
  <action>
Create THREE files. Each adapter is structurally identical except for the `SOURCE` constant and the `_fetch_raw_trades_*` private call.

`analytics-service/services/ingestion/okx.py`:

```python
"""Phase 19 / BACKBONE-02 — OKX broker adapter.

Wraps `services/exchange.py` (629 LOC unchanged per ROADMAP REUSE flag).
KeySubmissionRequest.context carries: api_key, api_secret, passphrase,
strategy_id, wizard_session_id, user_id.
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


class OkxAdapter:
    SOURCE = "okx"

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
            return ValidationResult(
                valid=bool(result["valid"]),
                read_only=result.get("read_only"),
                error_code=result.get("error_code"),
                human_message=result.get("error"),
                debug_context=(
                    {
                        "markers": result.get("markers"),
                        "markets_loaded": result.get("markets_loaded"),
                        "probe_error": result.get("probe_error"),
                    }
                    if not result["valid"]
                    else None
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
            raw = await exchange_service._fetch_raw_trades_okx(ex, since_ms=None)
            return [_normalize_trade(r, "okx") for r in raw]
        finally:
            await ex.close()

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        # Lazy import: P8 ships EquityCurveBuilder; avoid circular at module load.
        from services.equity_reconstruction import EquityCurveBuilder

        return EquityCurveBuilder(trades).to_metrics_snapshot()

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint:
        # Lazy import: P9 ships compute_fingerprint_v1.
        from services.ingestion.fingerprint import compute_fingerprint_v1

        return compute_fingerprint_v1(trades, metrics)

    async def reconstruct_positions(self, trades: list[Trade]) -> list[Position]:
        # BACKBONE-09 reuse: P8 EquityCurveBuilder.reconstruct_positions wraps
        # the existing position_reconstruction._match_positions_fifo primitive.
        from services.equity_reconstruction import EquityCurveBuilder

        builder = EquityCurveBuilder(trades)
        return builder.reconstruct_positions()


def _normalize_trade(raw: dict[str, Any], exchange: str) -> Trade:
    """Normalize a raw broker fill into the canonical Trade dataclass.

    Field mapping varies per exchange; lean on the existing services/exchange.py
    fetcher's output shape (each exchange returns a dict; the keys differ).
    """
    from datetime import datetime, timezone

    ts_raw = raw.get("timestamp") or raw.get("ts")
    if isinstance(ts_raw, (int, float)):
        ts = datetime.fromtimestamp(ts_raw / 1000, tz=timezone.utc)
    elif isinstance(ts_raw, str):
        ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
    elif isinstance(ts_raw, datetime):
        ts = ts_raw
    else:
        raise ValueError(f"Unsupported timestamp shape from {exchange}: {ts_raw!r}")

    fee = raw.get("fee") or {}
    return Trade(
        exchange=exchange,
        symbol=str(raw.get("symbol", "")),
        side=str(raw.get("side", "")),
        price=float(raw.get("price", 0.0)),
        quantity=float(raw.get("amount", raw.get("quantity", 0.0))),
        fee=float(fee.get("cost", 0.0)) if isinstance(fee, dict) else float(fee or 0.0),
        fee_currency=str(fee.get("currency", "")) if isinstance(fee, dict) else "",
        timestamp=ts,
        order_type=str(raw.get("type", raw.get("order_type", ""))),
        is_fill=bool(raw.get("is_fill", True)),
    )
```

`analytics-service/services/ingestion/binance.py` — same structure, swap:
- `SOURCE = "binance"`
- create_exchange args: `("binance", api_key, api_secret, None)` (no passphrase)
- validate signature: `creds["api_key"], creds["api_secret"]` (omit passphrase param entirely)
- `_fetch_raw_trades_okx` → `_fetch_raw_trades_binance`
- `_normalize_trade(r, "binance")`
- Reuse the same `_normalize_trade` private — import from `.okx` to avoid duplication: `from services.ingestion.okx import _normalize_trade`

`analytics-service/services/ingestion/bybit.py` — same structure, swap:
- `SOURCE = "bybit"`
- create_exchange args: `("bybit", api_key, api_secret, None)` (no passphrase)
- `_fetch_raw_trades_okx` → `_fetch_raw_trades_bybit`
- `_normalize_trade(r, "bybit")`
- Reuse `_normalize_trade` from `.okx`
- **DO NOT add Bybit fetchCurrencies disable code** — already patched in `services/exchange.py:35-46` per RESEARCH.md gotcha (line 809).

Each adapter file MUST:
- Wrap ccxt exchange close in try/finally (existing services/exchange.py pattern; httpx pool leak otherwise).
- Use lazy imports for EquityCurveBuilder + compute_fingerprint_v1 (P8 + P9 are Wave 2; this plan must not hard-import them).
- NOT hard-code human messages — Phase 17 DESIGN-05 contract says wizardErrors.ts is SoT; adapter returns the existing error_code enum and routes do the lookup.

Verify each adapter is structurally a Protocol implementer:
```bash
python -c "from services.ingestion import IngestionAdapter
from services.ingestion.okx import OkxAdapter
from services.ingestion.binance import BinanceAdapter
from services.ingestion.bybit import BybitAdapter
assert isinstance(OkxAdapter(), IngestionAdapter)
assert isinstance(BinanceAdapter(), IngestionAdapter)
assert isinstance(BybitAdapter(), IngestionAdapter)
print('OK')"
```
  </action>
  <acceptance_criteria>
    - All 3 files exist: `services/ingestion/okx.py`, `services/ingestion/binance.py`, `services/ingestion/bybit.py`
    - Each defines a class named `OkxAdapter` / `BinanceAdapter` / `BybitAdapter` respectively
    - Each class implements 5 methods (validate, fetch_raw, compute_metrics, compute_fingerprint, reconstruct_positions)
    - Each ccxt fetch path uses `try: ... finally: await ex.close()` — verifiable via grep
    - Bybit adapter does NOT contain `fetchCurrencies` patch code — verifiable via `! grep -q 'fetchCurrencies' analytics-service/services/ingestion/bybit.py`
    - Lazy imports used for EquityCurveBuilder and compute_fingerprint_v1 — `grep -q 'from services.equity_reconstruction import EquityCurveBuilder' inside method body` (not module-level)
    - Adapters import `from services import exchange as exchange_service` (delegate, not rewrite)
    - Runtime Protocol check passes: `isinstance(OkxAdapter(), IngestionAdapter)` returns True
  </acceptance_criteria>
  <automated>
    bash -c 'cd analytics-service && test -f services/ingestion/okx.py && test -f services/ingestion/binance.py && test -f services/ingestion/bybit.py && grep -q "class OkxAdapter" services/ingestion/okx.py && grep -q "class BinanceAdapter" services/ingestion/binance.py && grep -q "class BybitAdapter" services/ingestion/bybit.py && grep -q "_fetch_raw_trades_okx" services/ingestion/okx.py && grep -q "_fetch_raw_trades_binance" services/ingestion/binance.py && grep -q "_fetch_raw_trades_bybit" services/ingestion/bybit.py && ! grep -q "fetchCurrencies" services/ingestion/bybit.py && grep -q "await ex.close()" services/ingestion/okx.py'
  </automated>
  <requirements>BACKBONE-02</requirements>
</task>

<task id="P3-3" type="auto" tdd="true">
  <name>Task 3: Write CSV adapter wrapping services/csv_validator.py + CSV-specific test</name>
  <files>analytics-service/services/ingestion/csv_adapter.py, analytics-service/tests/test_csv_adapter.py</files>
  <read_first>
    - analytics-service/services/csv_validator.py (full file — parse_csv, validate_schema, df_to_trades, CsvValidationError shape)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 750-786 — CSV adapter blueprint; line 83 docstring v0 limitation)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md (line 83 — CSV mark-prices not applicable, open positions assumed flat at upload time)
    - analytics-service/services/ingestion/adapter.py (Task 1 — dataclass shapes)
  </read_first>
  <behavior>
    - Test 1 (test_validate_returns_none_read_only): CsvAdapter.validate() returns ValidationResult with read_only=None (N/A for CSV) on a valid daily_returns CSV.
    - Test 2 (test_validate_returns_error_on_invalid_format): Invalid CSV (e.g., negative NAV) returns ValidationResult with valid=False, error_code matching CsvValidationError.code.
    - Test 3 (test_reconstruct_positions_empty): CsvAdapter.reconstruct_positions returns []  (v0 limitation — open positions assumed flat at upload time).
    - Test 4 (test_csv_adapter_protocol_conforms): isinstance(CsvAdapter(), IngestionAdapter) returns True.
  </behavior>
  <action>
Create `analytics-service/services/ingestion/csv_adapter.py`:

```python
"""Phase 19 / BACKBONE-02 — CSV ingestion adapter.

Wraps `services/csv_validator.py` (Phase 15). Unlike the broker adapters,
CSV does NOT have credential validation — the `validate` method runs file-
format validation (pandera schemas + 6 CSV-02 rules) and returns
`read_only=None` because the field is N/A for CSV.

v0 limitation (per CONTEXT.md L83): mark prices are not applicable for CSV
ingestion; open positions are assumed flat at upload time. Funding-rate
accumulation is not computed for CSV. Documented here for downstream
consumers (PDF report, dashboard).
"""
from __future__ import annotations

from typing import Any

from services.ingestion.adapter import (
    Fingerprint,
    KeySubmissionRequest,
    MetricsSnapshot,
    Position,
    Trade,
    ValidationResult,
)


class CsvAdapter:
    SOURCE = "csv"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        # context carries: raw_bytes (bytes), fmt ∈ {daily_returns, daily_nav, trades}
        from services import csv_validator

        try:
            df = csv_validator.parse_csv(
                req.context["raw_bytes"], req.context["fmt"]
            )
            csv_validator.validate_schema(df, req.context["fmt"])
            return ValidationResult(
                valid=True,
                read_only=None,  # N/A for CSV
                error_code=None,
                human_message=None,
                debug_context=None,
            )
        except csv_validator.CsvValidationError as exc:
            return ValidationResult(
                valid=False,
                read_only=None,
                error_code=getattr(exc, "code", "CSV_VALIDATION_FAILED"),
                human_message=getattr(exc, "human_message", str(exc)),
                debug_context={
                    "violations": getattr(exc, "violations", []),
                },
            )

    async def fetch_raw(self, creds_or_file: dict) -> list[Trade]:
        from services import csv_validator

        df = csv_validator.parse_csv(creds_or_file["raw_bytes"], creds_or_file["fmt"])
        raw_dicts = csv_validator.df_to_trades(df, creds_or_file["fmt"])
        return [_csv_dict_to_trade(d) for d in raw_dicts]

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        from services.equity_reconstruction import EquityCurveBuilder

        return EquityCurveBuilder(trades).to_metrics_snapshot()

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint:
        from services.ingestion.fingerprint import compute_fingerprint_v1

        return compute_fingerprint_v1(trades, metrics)

    async def reconstruct_positions(self, trades: list[Trade]) -> list[Position]:
        # v0 limitation per CONTEXT.md L83: mark prices not applicable; open
        # positions assumed flat at upload time. Returns empty list. Document
        # for downstream readers; revisit in v2 once CSV adapter has
        # mark-snapshot column support.
        return []


def _csv_dict_to_trade(raw: dict[str, Any]) -> Trade:
    """Convert csv_validator.df_to_trades output dict → Trade dataclass.

    Only the 'trades' fmt produces fill-level rows; daily_returns / daily_nav
    yield daily-PnL pseudo-trades whose 'symbol', 'side' fields may be empty
    or 'CSV_DAILY' sentinel.
    """
    from datetime import datetime, timezone

    ts_raw = raw.get("timestamp") or raw.get("date")
    if isinstance(ts_raw, (int, float)):
        ts = datetime.fromtimestamp(ts_raw / 1000, tz=timezone.utc)
    elif isinstance(ts_raw, str):
        ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
    elif isinstance(ts_raw, datetime):
        ts = ts_raw
    else:
        raise ValueError(f"Unsupported timestamp shape from csv: {ts_raw!r}")

    return Trade(
        exchange="csv",
        symbol=str(raw.get("symbol", "")),
        side=str(raw.get("side", "")),
        price=float(raw.get("price", 0.0)),
        quantity=float(raw.get("quantity", 0.0)),
        fee=float(raw.get("fee", 0.0)),
        fee_currency=str(raw.get("fee_currency", "USD")),
        timestamp=ts,
        order_type=str(raw.get("order_type", "csv")),
        is_fill=bool(raw.get("is_fill", True)),
    )
```

Then create `analytics-service/tests/test_csv_adapter.py` with the 4 behaviors above. Sample fixture for valid daily_returns:
```
date,daily_return
2025-01-02,0.0103
2025-01-03,-0.0042
```
Sample invalid (negative NAV):
```
date,nav
2025-01-02,-100.00
```

Use `pytest.mark.asyncio` (already in repo per `pytest-asyncio`). Do NOT touch broker code; CSV adapter is fully self-contained against `services/csv_validator.py`.
  </action>
  <acceptance_criteria>
    - File `analytics-service/services/ingestion/csv_adapter.py` exists; defines `class CsvAdapter`
    - `grep -q 'class CsvAdapter' analytics-service/services/ingestion/csv_adapter.py`
    - `grep -q 'read_only=None' analytics-service/services/ingestion/csv_adapter.py`
    - `grep -q 'return \[\]' analytics-service/services/ingestion/csv_adapter.py` (reconstruct_positions empty per v0 limitation)
    - `grep -q 'csv_validator' analytics-service/services/ingestion/csv_adapter.py`
    - File `analytics-service/tests/test_csv_adapter.py` exists with 4 test functions
    - `grep -q 'test_validate_returns_none_read_only' analytics-service/tests/test_csv_adapter.py`
    - `grep -q 'test_reconstruct_positions_empty' analytics-service/tests/test_csv_adapter.py`
    - `grep -q 'test_csv_adapter_protocol_conforms' analytics-service/tests/test_csv_adapter.py`
  </acceptance_criteria>
  <automated>
    bash -c 'cd analytics-service && test -f services/ingestion/csv_adapter.py && grep -q "class CsvAdapter" services/ingestion/csv_adapter.py && grep -q "read_only=None" services/ingestion/csv_adapter.py && grep -q "v0 limitation" services/ingestion/csv_adapter.py && test -f tests/test_csv_adapter.py && grep -q "test_validate_returns_none_read_only" tests/test_csv_adapter.py && grep -q "test_reconstruct_positions_empty" tests/test_csv_adapter.py'
  </automated>
  <requirements>BACKBONE-02</requirements>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| /process-key router → IngestionAdapter | Adapter receives raw credentials in KeySubmissionRequest.context; PII surface |
| IngestionAdapter → broker SDK (ccxt) | TLS to broker; secrets transit memory; ccxt instance must close on every path |
| IngestionAdapter → services/csv_validator | Untrusted file content (raw_bytes); pandera schemas defend against malformed CSV |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-11 | Information disclosure | Trade dataclass + ValidationResult.debug_context | mitigate | `debug_context` excludes raw credentials; only carries error markers from existing services/exchange.validate_key_permissions which is already redacted via Phase 18 redact.py at Sentry/structlog boundaries |
| T-19-12 | Resource exhaustion | ccxt exchange instance lifecycle | mitigate | Every `validate` and `fetch_raw` wraps the create_exchange call in try/finally and calls `await ex.close()` to release the httpx pool — services/exchange.py existing pattern preserved |
| T-19-13 | Tampering | Bybit broker quirks | mitigate | NOT re-patching Bybit `fetchCurrencies` in BybitAdapter; the existing patch at services/exchange.py:35-46 stands; adapter wraps without modifying broker layer |
| T-19-14 | Spoofing | unknown source string in get_adapter | mitigate | get_adapter() raises ValueError on unknown source; UC-B drops MT5/IBKR for v1.0.0 — explicit allowlist `okx, binance, bybit, csv` |
| T-19-15 | DoS | oversized CSV upload | mitigate | csv_validator.parse_csv enforces 10MB max per Phase 15 CSV-02; CsvValidationError surfaces in ValidationResult with valid=False + error_code |
| T-19-15b | Tampering | Protocol method-signature drift | mitigate | **MC-3 fix** — `@runtime_checkable` Protocol only verifies method presence, NOT signatures. CI runs `mypy --strict analytics-service/services/ingestion/` to catch signature drift (e.g., a typo `validate(req)` vs `validate(request)`) at type-check time before tests. Add to the test pipeline alongside pytest. |
</threat_model>

<verification>
- All 6 source files exist (`__init__.py`, `adapter.py`, `okx.py`, `binance.py`, `bybit.py`, `csv_adapter.py`).
- All 4 adapters pass `isinstance(adapter, IngestionAdapter)` runtime check.
- **MC-3 mypy strict:** `mypy --strict analytics-service/services/ingestion/` exits 0 — `@runtime_checkable` only checks method *presence*, not signatures, so a typo like `validate(req)` vs `validate(request)` is silently accepted at runtime; mypy strict catches signature drift at type-check time before the test pipeline.
- `python -c "from services.ingestion import get_adapter; print(get_adapter('okx').__class__.__name__)"` prints `OkxAdapter`.
- `python -c "from services.ingestion import get_adapter; get_adapter('mt5')"` raises ValueError with message containing 'Unsupported source'.
- 2 pytest stub files exist (`test_ingestion_protocol.py`, `test_csv_adapter.py`) covering Protocol conformance + CSV-specific behavior.
- Bybit adapter does NOT re-patch `fetchCurrencies` (RESEARCH.md gotcha line 809).
</verification>

<success_criteria>
- BACKBONE-02 satisfied: IngestionAdapter Protocol with 5 methods declared; 4 concrete adapters (OKX/Binance/Bybit/CSV) implement the contract structurally.
- BACKBONE-01 dataclass surface (KeySubmissionRequest, VerificationResult) defined and ready for consumption by P4 router.
- REUSE flag honored: services/exchange.py UNCHANGED; adapters delegate via `_fetch_raw_trades_*` wrappers.
- CSV v0 limitation documented: reconstruct_positions returns [] for CSV; mark prices not applicable.
- **MC-3:** `mypy --strict analytics-service/services/ingestion/` clean — Protocol signature drift caught at type-check, not at runtime. Wired into the test pipeline (analytics-service CI step).
</success_criteria>

<output>
After completion, create `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-03-SUMMARY.md`
</output>
