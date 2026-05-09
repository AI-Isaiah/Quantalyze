"""Phase 19 / BACKBONE-02 — IngestionAdapter Protocol package.

Five-method pipeline contract; concrete adapters live in this package
(okx.py, binance.py, bybit.py, csv_adapter.py). routers/process_key.py
(P4, Wave 2) orchestrates calls to these methods in sequence; the
state-machine RPC (transition_strategy_verification, migration 103) is
called between steps.

Existing primitives are WRAPPED, not rewritten: services/exchange.py
(629 LOC) is unchanged per ROADMAP REUSE flag; concrete adapters
delegate to its broker SDK fetchers without modification.

Per CONTEXT.md §IngestionAdapter:
  1. validate(req) -> ValidationResult
  2. fetch_raw(creds_or_file) -> list[Trade]
  3. compute_metrics(trades) -> MetricsSnapshot
  4. compute_fingerprint(trades, metrics) -> Fingerprint
  5. reconstruct_positions(trades) -> list[Position]
"""
from __future__ import annotations

from typing import Callable, Protocol, runtime_checkable

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
    """Phase 19 / BACKBONE-02 — five-method pipeline contract.

    Concrete impls live in this package as okx.py / binance.py /
    bybit.py / csv_adapter.py. routers/process_key.py (P4) orchestrates
    calls to these methods in sequence.

    NOTE: `@runtime_checkable` only verifies method *presence*, not
    signature shape. CI runs `mypy --strict services/ingestion/` (see
    Makefile `lint` target — MC-3 fix from 19-REVIEWS.md) to catch
    signature drift at type-check time before tests would notice.
    """

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult: ...

    async def fetch_raw(
        self, creds_or_file: dict[str, object]
    ) -> list[Trade]: ...

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot: ...

    def compute_fingerprint(
        self, trades: list[Trade], metrics: MetricsSnapshot
    ) -> Fingerprint: ...

    async def reconstruct_positions(
        self, trades: list[Trade]
    ) -> list[Position]: ...


# Adapter registry — keys are the canonical Source values; values are
# instantiated lazily on first lookup to avoid circular imports between
# the package __init__ and concrete adapter modules (each concrete
# adapter imports from .adapter, which is fine, but they also depend on
# services.exchange / services.csv_validator which pull in chunks of
# the wider analytics-service module graph).
SUPPORTED_SOURCES: tuple[str, ...] = ("okx", "binance", "bybit", "csv")
ADAPTERS: dict[str, IngestionAdapter] = {}


def _instantiate(source: str) -> IngestionAdapter:
    """Lazy import + construction. Keeps unknown-source rejection cheap
    (no broker adapter import on the unhappy path).

    M-11 — adapter registry as ``_FACTORIES`` lookup. Each value is a
    ``Callable[[], IngestionAdapter]`` that imports + constructs lazily
    so the unhappy-path import cost matches the previous if-branch
    chain. Adding a new adapter is now a one-line registry entry.
    """
    factory = _FACTORIES.get(source)
    if factory is None:
        raise ValueError(
            f"Unsupported source: {source!r}; valid: {list(SUPPORTED_SOURCES)}"
        )
    return factory()


def _make_okx_adapter() -> IngestionAdapter:
    from .okx import OkxAdapter

    return OkxAdapter()


def _make_binance_adapter() -> IngestionAdapter:
    from .binance import BinanceAdapter

    return BinanceAdapter()


def _make_bybit_adapter() -> IngestionAdapter:
    from .bybit import BybitAdapter

    return BybitAdapter()


def _make_csv_adapter() -> IngestionAdapter:
    from .csv_adapter import CsvAdapter

    return CsvAdapter()


# M-11 — adapter factory registry. New adapters slot in here without
# touching the dispatch chain.
_FACTORIES: dict[str, "Callable[[], IngestionAdapter]"] = {
    "okx": _make_okx_adapter,
    "binance": _make_binance_adapter,
    "bybit": _make_bybit_adapter,
    "csv": _make_csv_adapter,
}


def get_adapter(source: str) -> IngestionAdapter:
    """Resolve an adapter by `source` discriminator.

    Raises ValueError on unknown source BEFORE attempting any import,
    so the unhappy path never triggers concrete-adapter module loads.
    UC-B drops MT5/IBKR for v1.0.0; the supported allowlist is exactly
    `okx, binance, bybit, csv`.
    """
    if source not in SUPPORTED_SOURCES:
        raise ValueError(
            f"Unsupported source: {source!r}; valid: {list(SUPPORTED_SOURCES)}"
        )
    if source not in ADAPTERS:
        ADAPTERS[source] = _instantiate(source)
    return ADAPTERS[source]
