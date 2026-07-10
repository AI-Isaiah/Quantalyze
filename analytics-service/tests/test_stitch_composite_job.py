"""Phase 86 Plan 03 — the production stitch path.

Task 1: the additive ``has_option_activity`` crawl signal on
``CompletenessReport`` — the MTM-gate input ``services.stitch_composite.
mark_to_market_available`` reads (threaded per member by the worker). The
signal reads RAW ROW evidence (a ``options_settlement_summary``-typed row OR an
option-instrument row) so it fires under BOTH ``pnl_basis`` values — the gate is
about the BOOK, not the accrual basis (deribit_txn.py:603 semantics).

Task 2/3: ``run_stitch_composite_job`` fan-out → clip → fail-loud overlap →
arithmetic stitch → both-basis persist, and the dispatch branch. Pure-stub
supabase / exchange mocks (no live DB / creds); run with
``--no-file-parallelism`` if local contention flakes.
"""
from __future__ import annotations

from services.deribit_ingest import (
    CompletenessReport,
    deribit_raw_rows_have_option_activity,
)


# ---------------------------------------------------------------------------
# Task 1 — has_option_activity additive crawl signal
# ---------------------------------------------------------------------------

def test_option_activity_true_on_options_settlement_summary_type() -> None:
    """A ``options_settlement_summary``-typed row (Deribit's MTM channel) is
    option-book evidence regardless of instrument parsing — True."""
    rows = [
        {"type": "settlement", "instrument_name": "BTC-PERPETUAL", "change": 1.0},
        {"type": "options_settlement_summary", "instrument_name": "", "change": 0.0},
    ]
    assert deribit_raw_rows_have_option_activity(rows) is True


def test_option_activity_true_on_option_instrument_row_cash_basis() -> None:
    """The cash-basis fallback: under cash_settlement there is NO summary row,
    so an option is evidenced ONLY by its instrument name (``-C``/``-P``). A
    plain option ``trade`` row must still trip the signal."""
    rows = [
        {"type": "trade", "instrument_name": "BTC-27DEC24-100000-C", "change": 5.0},
    ]
    assert deribit_raw_rows_have_option_activity(rows) is True


def test_option_activity_false_for_perp_only() -> None:
    """A perp-only book (no option instruments, no summary rows) → False (the
    default) — MTM is admissible for such a member."""
    rows = [
        {"type": "trade", "instrument_name": "BTC-PERPETUAL", "change": 1.0},
        {"type": "settlement", "instrument_name": "ETH_USDC-PERPETUAL", "change": -2.0},
        {"type": "transfer", "instrument_name": "", "change": 10.0},
    ]
    assert deribit_raw_rows_have_option_activity(rows) is False


def test_option_activity_false_on_empty_crawl() -> None:
    assert deribit_raw_rows_have_option_activity([]) is False


def test_completeness_report_defaults_has_option_activity_false() -> None:
    """Additive field with a False default — every existing constructor call
    site (no kwarg) is byte-unaffected."""
    assert CompletenessReport().has_option_activity is False
