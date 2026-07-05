"""Tests for services.broker_dailies — broker key full-history → daily-return
series → CSV route, and the OKX equity-read fix in services.exchange.

The load-bearing test is test_combine_funding_lifts_return_regression: it
encodes WHY funding must be in the series (it is the dominant return driver for
perp strategies; a realized-only series understates the truth — the live Bybit
key went +6.8% realized-only vs +28.8% with funding). It fails if a refactor
ever drops funding from the combined stream.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import pytest

from services.broker_dailies import (
    combine_realized_and_funding,
    funding_rows_to_daily_pnl_records,
    gap_fill_daily_returns,
)
from services.exchange import fetch_okx_total_equity_usd
from services.metrics import compute_all_metrics


def _funding_row(day: str, amount: float):
    return {
        "amount": amount,
        "timestamp": datetime.fromisoformat(f"{day}T08:00:00+00:00"),
    }


def _realized_record(day: str, pnl: float):
    """Shape mirrors services.exchange.fetch_daily_pnl output."""
    return {
        "exchange": "bybit",
        "symbol": "PORTFOLIO",
        "side": "buy" if pnl >= 0 else "sell",
        "price": abs(pnl),
        "quantity": 1,
        "fee": 0,
        "fee_currency": "USDT",
        "timestamp": f"{day}T00:00:00+00:00",
        "order_type": "daily_pnl",
    }


# --- funding_rows_to_daily_pnl_records ----------------------------------------

def test_funding_aggregates_by_day_with_sign_encoding():
    rows = [
        _funding_row("2026-01-01", 10.0),
        _funding_row("2026-01-01", 5.0),     # same day → summed to +15
        _funding_row("2026-01-02", -3.0),    # net negative day
    ]
    out = funding_rows_to_daily_pnl_records(rows)
    assert len(out) == 2
    by_day = {r["timestamp"][:10]: r for r in out}
    assert by_day["2026-01-01"]["side"] == "buy"      # net positive
    assert by_day["2026-01-01"]["price"] == pytest.approx(15.0)
    assert by_day["2026-01-02"]["side"] == "sell"     # net negative
    assert by_day["2026-01-02"]["price"] == pytest.approx(3.0)
    # Every emitted record must be daily_pnl-shaped so the combined stream
    # flows through trades_to_daily_returns_with_status unchanged.
    assert all(r["order_type"] == "daily_pnl" for r in out)


def test_funding_skips_unparseable_timestamp_and_amount():
    rows = [
        {"amount": 5.0, "timestamp": None},          # dropped: no day
        {"amount": "nope", "timestamp": datetime(2026, 1, 1, tzinfo=timezone.utc)},  # dropped: bad amount
        _funding_row("2026-01-03", 7.0),             # kept
    ]
    out = funding_rows_to_daily_pnl_records(rows)
    assert len(out) == 1
    assert out[0]["timestamp"][:10] == "2026-01-03"


def test_funding_naive_timestamp_treated_as_utc():
    rows = [{"amount": 4.0, "timestamp": datetime(2026, 1, 5, 23, 30)}]  # tz-naive
    out = funding_rows_to_daily_pnl_records(rows)
    assert out[0]["timestamp"][:10] == "2026-01-05"


# --- gap_fill_daily_returns ---------------------------------------------------

def test_gap_fill_inserts_zero_return_calendar_days():
    sparse = pd.Series(
        [0.01, -0.02],
        index=pd.DatetimeIndex(["2026-01-01", "2026-01-04"]),
        dtype="float64",
    )
    filled = gap_fill_daily_returns(sparse)
    # Jan 1,2,3,4 — the two gap days fill with 0.0
    assert list(filled.index) == list(pd.date_range("2026-01-01", "2026-01-04", freq="D"))
    assert filled.loc["2026-01-02"] == 0.0
    assert filled.loc["2026-01-03"] == 0.0
    assert filled.index.is_monotonic_increasing
    # Gap-filled series must satisfy compute_all_metrics' index/dtype contract.
    assert isinstance(filled.index, pd.DatetimeIndex)
    assert pd.api.types.is_float_dtype(filled)


def test_gap_fill_empty_is_noop():
    empty = pd.Series(dtype="float64")
    assert gap_fill_daily_returns(empty).empty


# --- combine_realized_and_funding (the regression) ----------------------------

def test_combine_funding_lifts_return_regression():
    """Funding is the dominant return driver for perp strategies; a
    realized-only series understates the truth. With a fixed equity anchor,
    adding funding MUST raise the cumulative return. This mirrors the live
    Bybit key (+6.8% realized-only → +28.8% with funding)."""
    days = [f"2026-01-{d:02d}" for d in range(1, 21)]
    realized = [_realized_record(d, 50.0) for d in days]     # +50/day trading
    funding = [_funding_row(d, 150.0) for d in days]         # +150/day funding (dominant)
    equity = 100_000.0

    r_only, _ = combine_realized_and_funding(realized, [], equity)
    r_both, meta = combine_realized_and_funding(realized, funding, equity)

    cum_only = compute_all_metrics(r_only).metrics_json["cumulative_return"]
    cum_both = compute_all_metrics(r_both).metrics_json["cumulative_return"]

    assert cum_both > cum_only, (
        f"funding must lift cumulative return: realized-only={cum_only}, "
        f"with-funding={cum_both}"
    )
    # Real equity anchor → no heuristic-capital fallback.
    assert meta["used_heuristic_capital"] is False
    # ~+4000 booked on a derived base ≈ 96k → roughly +4%; sanity floor.
    assert cum_both > 0.03


def test_combine_empty_returns_empty_series():
    returns, _ = combine_realized_and_funding([], [], account_balance=100_000.0)
    assert returns.empty


# --- fetch_okx_total_equity_usd (the OKX read fix) ----------------------------

class _FakeOKX:
    def __init__(self, response):
        self._response = response

    async def private_get_account_balance(self):
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


async def test_okx_equity_parses_totaleq():
    ex = _FakeOKX({"code": "0", "data": [{"totalEq": "194982.35"}]})
    assert await fetch_okx_total_equity_usd(ex) == pytest.approx(194982.35)


async def test_okx_equity_none_on_empty_or_bad():
    assert await fetch_okx_total_equity_usd(_FakeOKX({"data": []})) is None
    assert await fetch_okx_total_equity_usd(_FakeOKX({"data": [{"totalEq": "oops"}]})) is None
    assert await fetch_okx_total_equity_usd(_FakeOKX({"data": [{"totalEq": "0"}]})) is None
    assert await fetch_okx_total_equity_usd(_FakeOKX(RuntimeError("boom"))) is None


# --- OKX funding archive window (the HIGH-1 anchor-corruption regression) -----

class _FakeOKXBills:
    """Records which OKX bills endpoint(s) were hit; returns empty data."""

    def __init__(self):
        self.calls: list[str] = []

    async def private_get_account_bills(self, params):
        self.calls.append("recent")
        return {"code": "0", "data": []}

    async def private_get_account_bills_archive(self, params):
        self.calls.append("archive")
        return {"code": "0", "data": []}


async def test_okx_funding_fetches_archive_on_full_history():
    """since_ms=None means full history. The recent /account/bills endpoint
    only retains ~90 days, so the archive endpoint MUST also be hit — else OKX
    funding older than 90 days is silently dropped while realized PnL spans
    inception, corrupting the equity anchor (HIGH-1)."""
    from services.funding_fetch import fetch_funding_okx

    ex = _FakeOKXBills()
    await fetch_funding_okx(ex, "strat-okx", since_ms=None)
    assert "archive" in ex.calls, (
        f"archive endpoint must be fetched for full history; got {ex.calls}"
    )


async def test_okx_funding_skips_archive_for_recent_window():
    """An incremental sync (recent since_ms) must NOT pay for the archive —
    the original behaviour is preserved for the sync_funding caller."""
    import time

    from services.funding_fetch import fetch_funding_okx

    recent_ms = int((time.time() - 10 * 86400) * 1000)  # 10 days ago
    ex = _FakeOKXBills()
    await fetch_funding_okx(ex, "strat-okx", since_ms=recent_ms)
    assert ex.calls == ["recent"], (
        f"archive must be skipped for a recent window; got {ex.calls}"
    )


# --- Deribit ONE-path branch (P70 70-05, DRB-07/DRB-08) -----------------------
#
# The deribit venue branch of run_derive_broker_dailies_job sources realized
# returns from the ONE txn-log ledger pass (70-03), passes EMPTY funding to
# combine (funding is inside the ledger settlement cash delta — count-once),
# runs the re-anchored D-02 ledger-completeness gate BEFORE any upsert, and
# anchors to a USD-denominated equity figure. These tests are revert-proof:
# each fails if the branch is neutered (calls fetch_all_trades, wires a funding
# stream, skips the gate, or anchors to a coin/non-USD base).
from unittest.mock import AsyncMock, MagicMock, patch  # noqa: E402

from services.deribit_ingest import (  # noqa: E402
    CompletenessReport,
    LedgerCompletenessError,
    LedgerTruncatedError,
)
from services.deribit_txn import (  # noqa: E402
    deribit_equity_to_usd,
    txn_rows_to_daily_records,
)
from services.job_worker import (  # noqa: E402
    DispatchOutcome,
    run_derive_broker_dailies_job,
)


def _deribit_ctx() -> tuple[MagicMock, dict]:
    """Mock allocator-key ctx + a capture of csv_daily_returns upserts."""
    capture: dict = {"upserts": []}
    ctx = MagicMock()
    ctx.exchange = AsyncMock()
    ctx.supabase = MagicMock()
    ctx.key_row = {"id": "key-drb", "user_id": "alloc-1", "exchange": "deribit"}

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _upsert(payload: object, **kw: object) -> MagicMock:
            capture["upserts"].append((name, payload, kw.get("on_conflict")))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub

        tbl.upsert.side_effect = _upsert
        return tbl

    ctx.supabase.table.side_effect = _table
    return ctx, capture


def _deribit_ledger_records() -> list[dict]:
    """A >=2-day funding-inclusive ledger daily_pnl record set (70-03 shape)."""
    return txn_rows_to_daily_records(
        [
            {"type": "settlement", "currency": "USDC", "cashflow": 120.0,
             "instrument_name": "BTC_USDC-PERPETUAL", "timestamp": 1_714_521_600_000},
            {"type": "settlement", "currency": "USDC", "cashflow": -40.0,
             "instrument_name": "BTC_USDC-PERPETUAL", "timestamp": 1_714_608_000_000},
        ]
    )


def _deribit_patches(
    ctx: MagicMock,
    *,
    records: list[dict],
    report: CompletenessReport | None = None,
    combine_spy: MagicMock | None = None,
    ledger_side_effect: object = None,
) -> list:
    """Patch set for the deribit branch. fetch_all_trades RAISES so any test
    that reaches DONE proves the deribit branch never touched it (D-08)."""
    two_day = pd.Series(
        [0.01, -0.02],
        index=pd.DatetimeIndex(["2024-05-01", "2024-05-02"]),
        dtype="float64",
    )
    combine = combine_spy or MagicMock(
        return_value=(two_day, {"used_heuristic_capital": False})
    )
    if ledger_side_effect is not None:
        ledger_mock = AsyncMock(side_effect=ledger_side_effect)
    else:
        ledger_mock = AsyncMock(
            return_value=(records, report or CompletenessReport())
        )
    return [
        patch(
            "services.job_worker._allocator_key_preflight",
            new=AsyncMock(return_value=ctx),
        ),
        patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(side_effect=AssertionError(
                "deribit branch must NOT call fetch_all_trades (D-08)"
            )),
        ),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.deribit_ingest.fetch_deribit_ledger_daily_records",
            new=ledger_mock,
        ),
        patch(
            "services.deribit_ingest.fetch_deribit_account_equity_usd",
            new=AsyncMock(return_value=(100_000.0, False)),
        ),
        patch("services.broker_dailies.combine_realized_and_funding", new=combine),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
    ], combine


@pytest.mark.asyncio
async def test_deribit_branch_sources_from_ledger():
    """The deribit branch produces dailies from the ledger records WITHOUT ever
    calling fetch_all_trades (patched to raise) — realized comes from the
    txn-log cash deltas (D-08)."""
    ctx, capture = _deribit_ctx()
    patches, _ = _deribit_patches(ctx, records=_deribit_ledger_records())
    with _apply(patches):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.DONE
    assert capture["upserts"], "ledger dailies must upsert csv_daily_returns"
    assert capture["upserts"][0][0] == "csv_daily_returns"


@pytest.mark.asyncio
async def test_deribit_passes_empty_funding():
    """The branch calls combine with funding_rows == [] (funding is inside the
    ledger settlement sum — count-once). Wiring a funding stream turns this red."""
    ctx, _ = _deribit_ctx()
    spy = MagicMock(
        return_value=(
            pd.Series(
                [0.01, -0.02],
                index=pd.DatetimeIndex(["2024-05-01", "2024-05-02"]),
                dtype="float64",
            ),
            {"used_heuristic_capital": False},
        )
    )
    patches, combine = _deribit_patches(
        ctx, records=_deribit_ledger_records(), combine_spy=spy
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.DONE
    # Second positional arg to combine_realized_and_funding is funding_rows.
    _args, _kw = combine.call_args
    funding_arg = _args[1] if len(_args) > 1 else _kw.get("funding_rows")
    assert funding_arg == [], (
        f"deribit funding must be EMPTY (inside the settlement sum); got {funding_arg!r}"
    )
    # The realized (first) arg is the ledger records, not fetch_all_trades output.
    assert _args[0] == _deribit_ledger_records()


@pytest.mark.asyncio
async def test_deribit_completeness_gate_fails_loud():
    """assert_ledger_complete raising (a scope×currency never reached
    continuation=null) → job FAILED and NO csv_daily_returns upsert (no partial
    track record). Neutering the gate call turns this red."""
    ctx, capture = _deribit_ctx()
    patches, _ = _deribit_patches(ctx, records=_deribit_ledger_records())
    with _apply(patches), patch(
        "services.deribit_ingest.assert_ledger_complete",
        new=MagicMock(side_effect=LedgerCompletenessError("main×BTC incomplete")),
    ):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.FAILED
    assert capture["upserts"] == [], "a partial ledger must NOT upsert dailies"


@pytest.mark.asyncio
async def test_deribit_ledger_truncation_fails_loud():
    """A truncated crawl (LedgerTruncatedError from the producer) → job FAILED,
    no upsert — a truncated crawl never renders as a complete track record."""
    ctx, capture = _deribit_ctx()
    patches, _ = _deribit_patches(
        ctx,
        records=[],
        ledger_side_effect=LedgerTruncatedError("main×BTC truncated at continuation"),
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.FAILED
    assert capture["upserts"] == [], "a truncated ledger must NOT upsert dailies"


def test_deribit_equity_anchor_is_usd():
    """The equity anchor is USD-denominated: a coin-margined equity is scaled by
    its event/mark index into USD, NOT left as the raw coin quantity. Reverting
    the anchor to a coin/non-USD base mis-scales and turns this red."""
    summaries = [
        {"currency": "BTC", "equity": 2.0},   # coin-margined: 2 BTC
        {"currency": "USDC", "equity": 5_000.0},  # USD-family: passes through
    ]
    index_prices = {"BTC": 50_000.0}
    usd = deribit_equity_to_usd(summaries, index_prices)
    # 2 BTC * 50,000 + 5,000 USDC = 105,000 USD — a USD figure, NOT the raw
    # coin quantity (2.0) nor a coin/USDC-only partial.
    assert usd == pytest.approx(105_000.0)
    assert usd > 100.0, "anchor must be USD-scaled, never a raw coin quantity"


def _apply(patchers: list):
    """Enter a list of patch() context managers as one ExitStack."""
    from contextlib import ExitStack

    stack = ExitStack()
    for p in patchers:
        stack.enter_context(p)
    return stack
