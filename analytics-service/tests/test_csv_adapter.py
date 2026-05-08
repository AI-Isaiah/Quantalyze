"""Phase 19 / BACKBONE-02 — CsvAdapter behavior tests.

Covers the CSV-specific contract:
  1. validate() returns ValidationResult with read_only=None on a valid
     daily_returns CSV (the field is N/A for file-format validation).
  2. validate() returns ValidationResult with valid=False + a populated
     error_code when the file fails the pandera schema (e.g. nav==0).
  3. reconstruct_positions() returns [] regardless of trade count — v0
     limitation per CONTEXT.md L83 (mark prices not applicable; open
     positions assumed flat at upload time).
  4. CsvAdapter passes the runtime_checkable Protocol isinstance check.
"""
from __future__ import annotations


VALID_DAILY_RETURNS_CSV = (
    b"date,daily_return\n"
    b"2025-01-02,0.0103\n"
    b"2025-01-03,-0.0042\n"
    b"2025-01-04,0.0211\n"
    b"2025-01-05,-0.0007\n"
)

# nav_non_zero rule fires for the 0.0 value below; this also exercises
# the SchemaErrors → ValidationResult error_code mapping path.
INVALID_DAILY_NAV_CSV = (
    b"date,nav\n"
    b"2025-01-02,1000.0\n"
    b"2025-01-03,0.0\n"
)


async def test_validate_returns_none_read_only() -> None:
    from services.ingestion.adapter import KeySubmissionRequest
    from services.ingestion.csv_adapter import CsvAdapter

    adapter = CsvAdapter()
    req = KeySubmissionRequest(
        flow_type="csv",
        source="csv",
        context={
            "raw_bytes": VALID_DAILY_RETURNS_CSV,
            "fmt": "daily_returns",
            "strategy_id": "test-strategy",
            "wizard_session_id": "test-session",
            "user_id": "test-user",
        },
    )

    result = await adapter.validate(req)

    assert result.valid is True, f"expected valid=True, got {result}"
    assert result.read_only is None, (
        "CSV validate must return read_only=None — the field is N/A for "
        "file-format validation."
    )
    assert result.error_code is None
    assert result.human_message is None


async def test_validate_returns_error_on_invalid_format() -> None:
    from services.ingestion.adapter import KeySubmissionRequest
    from services.ingestion.csv_adapter import CsvAdapter

    adapter = CsvAdapter()
    req = KeySubmissionRequest(
        flow_type="csv",
        source="csv",
        context={
            "raw_bytes": INVALID_DAILY_NAV_CSV,
            "fmt": "daily_nav",
            "strategy_id": "test-strategy",
            "wizard_session_id": "test-session",
            "user_id": "test-user",
        },
    )

    result = await adapter.validate(req)

    assert result.valid is False
    assert result.read_only is None  # always None for CSV
    assert result.error_code is not None, (
        "Invalid CSV must surface a non-null error_code (CSV_VALIDATION_FAILED "
        "or the first specific rule name)."
    )
    # debug_context carries the per-rule violation list so wizardErrors.ts
    # can map to a granular human message.
    assert result.debug_context is not None
    assert "violations" in result.debug_context


async def test_reconstruct_positions_empty() -> None:
    from datetime import datetime, timezone

    from services.ingestion.adapter import Trade
    from services.ingestion.csv_adapter import CsvAdapter

    adapter = CsvAdapter()

    trades = [
        Trade(
            exchange="csv",
            symbol="BTC/USDT",
            side="buy",
            price=50000.0,
            quantity=0.1,
            fee=2.5,
            fee_currency="USD",
            timestamp=datetime(2025, 1, 1, tzinfo=timezone.utc),
            order_type="csv",
            is_fill=True,
        )
    ]

    positions = await adapter.reconstruct_positions(trades)

    # v0 limitation per CONTEXT.md L83: mark prices not applicable; open
    # positions assumed flat at upload time. Adapter must return [] for
    # any trade list (even a non-empty one) until v2 ships CSV
    # mark-snapshot support.
    assert positions == []


def test_csv_adapter_protocol_conforms() -> None:
    from services.ingestion import IngestionAdapter
    from services.ingestion.csv_adapter import CsvAdapter

    assert isinstance(CsvAdapter(), IngestionAdapter)
    assert CsvAdapter.SOURCE == "csv"
