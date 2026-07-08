"""Tests for services.broker_dailies — broker key full-history → daily-return
series → CSV route, and the OKX equity-read fix in services.exchange.

The load-bearing test is test_combine_funding_lifts_return_regression: it
encodes WHY funding must be in the series (it is the dominant return driver for
perp strategies; a realized-only series understates the truth — the live Bybit
key went +6.8% realized-only vs +28.8% with funding). It fails if a refactor
ever drops funding from the combined stream.
"""
from __future__ import annotations

import json
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


def test_gap_fill_preserves_guard_nan_days():
    """§6.2 FROZEN PIN (DQ-03): ``gap_fill_daily_returns`` fills MISSING calendar
    labels with 0.0 (equity flat), but a pre-existing guard-NaN day STAYS NaN —
    it must never be converted to 0.0 (that would silently un-break the chain
    and let a broken day compound as a flat 0%). ``reindex(fill_value=0.0)`` only
    fills newly-created labels, so today's behavior already complies; a refactor
    to ``.fillna(0)`` would flip this test RED."""
    idx = pd.DatetimeIndex(["2026-01-01", "2026-01-02", "2026-01-04"])
    returns = pd.Series([0.01, float("nan"), 0.02], index=idx, dtype="float64")
    filled = gap_fill_daily_returns(returns)
    # The MISSING calendar day (01-03) is filled 0.0 ...
    assert filled.loc["2026-01-03"] == 0.0
    # ... but the EXISTING guard-NaN day (01-02) STAYS NaN.
    assert pd.isna(filled.loc["2026-01-02"])
    # Index is gap-free ascending across the full span.
    assert list(filled.index) == list(
        pd.date_range("2026-01-01", "2026-01-04", freq="D")
    )


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


# --- combine_native_ledger (80-03 T1: the native sibling) ---------------------
# combine_native_ledger is the transforms-level counterpart of
# combine_realized_and_funding: it calls the landed native core
# (reconstruct_native_nav_and_twr, venue="deribit") and reuses
# gap_fill_daily_returns so the (returns, meta) shape is IDENTICAL to the legacy
# sibling — everything downstream (CSV route, compute_all_metrics, persistence,
# factsheet) is untouched by the switch (§9.2).


def _usd_native_ledger(
    pnl_by_day: dict[int, float],
    *,
    flows: list[tuple[int, float]] | None = None,
    ccy: str = "USDC",
):
    """A minimal all-USD-family NativeLedger (branch-1 only, marks empty, mark ≡
    1.0). ``terminal_native_equity`` is set residual-clean (Σ pnl + Σ flow) so the
    §5 inception gate reconciles to a ~0 pre-history balance (full_history=True)."""
    from services.external_flows import ExternalFlow
    from services.native_nav import NativeLedger

    base = pd.Timestamp("2026-01-01")
    ordered = sorted(pnl_by_day)
    pnl = pd.Series(
        [pnl_by_day[d] for d in ordered],
        index=pd.DatetimeIndex([base + pd.Timedelta(days=d) for d in ordered]),
        name="native_pnl",
    )
    flows = flows or []
    native_flows = [
        ExternalFlow(str((base + pd.Timedelta(days=d)).date()), u, ccy, u)
        for (d, u) in flows
    ]
    terminal = sum(pnl_by_day.values()) + sum(u for (_d, u) in flows)
    return NativeLedger(
        native_pnl={ccy: pnl},
        terminal_native_equity={ccy: terminal},
        marks={},
        native_flows=native_flows,
        terminal_upnl_native={},
        full_history=True,
    )


def test_combine_native_ledger_shape_parity():
    """combine_native_ledger returns the SAME (pd.Series, dict) shape
    combine_realized_and_funding returns — a gap-filled float Series on an
    ascending daily DatetimeIndex and a plain dict meta carrying the status hint."""
    from services.broker_dailies import combine_native_ledger

    ledger = _usd_native_ledger({0: 100_000.0, 1: 50_000.0, 2: -30_000.0})
    returns, meta = combine_native_ledger(ledger, frozenset())
    assert isinstance(returns, pd.Series)
    assert returns.dtype == "float64"
    assert isinstance(meta, dict)
    assert meta["computation_status_hint"] in ("complete", "complete_with_warnings")
    # Same ascending, gap-free daily index the CSV route requires.
    assert list(returns.index) == list(returns.index.sort_values())
    assert returns.index.freq is None or returns.index.inferred_freq == "D"


def test_combine_native_ledger_gap_fill_reused():
    """gap_fill_daily_returns is reused: a ledger with an activity GAP (days 0,1,3
    — no day 2) yields a returns Series REINDEXED to every calendar day, the day-2
    hole filled 0.0. Mutation (a): skipping gap_fill drops day 2 and reddens."""
    from services.broker_dailies import combine_native_ledger

    ledger = _usd_native_ledger({0: 100_000.0, 1: 50_000.0, 3: -30_000.0})
    returns, _ = combine_native_ledger(ledger, frozenset())
    day2 = pd.Timestamp("2026-01-03")  # base 2026-01-01 + 2 days
    assert day2 in returns.index, "gap_fill must reindex the missing calendar day"
    assert returns.loc[day2] == 0.0


def test_combine_native_ledger_empty_is_noop():
    """An empty core return yields an empty Series (gap_fill no-op)."""
    from services.broker_dailies import combine_native_ledger
    from services.native_nav import NativeLedger

    empty = NativeLedger(
        native_pnl={},
        terminal_native_equity={},
        marks={},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )
    returns, meta = combine_native_ledger(empty, frozenset())
    assert returns.empty
    assert isinstance(meta, dict)


def test_combine_native_ledger_threads_venue_deribit():
    """The core is called with venue="deribit" (it rides only into exception
    metadata, G2). Neutering the venue kwarg reddens this."""
    from unittest.mock import MagicMock, patch

    import services.broker_dailies as bd

    ledger = _usd_native_ledger({0: 100_000.0, 1: 50_000.0})
    spy = MagicMock(
        return_value=(pd.Series(dtype="float64", name="returns"), {})
    )
    with patch.object(bd, "reconstruct_native_nav_and_twr", spy):
        bd.combine_native_ledger(ledger, frozenset())
    _args, kwargs = spy.call_args
    assert kwargs["venue"] == "deribit"
    assert kwargs["indexable_currencies"] == frozenset()


def test_combine_native_ledger_propagates_typed_error():
    """A core NavReconstructionError subclass propagates OUT unchanged (typed) —
    NOT swallowed, NOT converted to a bare ValueError or an empty series. Mutation
    (b): catching+zeroing the core error here reddens (the callsite dispositions
    it, never combine_native_ledger)."""
    from unittest.mock import MagicMock, patch

    import services.broker_dailies as bd
    from services.native_nav import UnmarkableCurrencyError

    ledger = _usd_native_ledger({0: 100_000.0})
    exc = UnmarkableCurrencyError(
        currency="BUIDL", venue="deribit", reason="no_usd_index", missing_day_count=3
    )
    with patch.object(
        bd, "reconstruct_native_nav_and_twr", MagicMock(side_effect=exc)
    ):
        with pytest.raises(UnmarkableCurrencyError) as ei:
            bd.combine_native_ledger(ledger, frozenset())
    assert ei.value is exc


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
    LedgerValuationError,
    deribit_equity_to_usd,
    txn_rows_to_daily_records,
)
from services.job_worker import (  # noqa: E402
    DispatchOutcome,
    dispatch,
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
            {"type": "settlement", "currency": "USDC", "change": 120.0,
             "instrument_name": "BTC_USDC-PERPETUAL", "timestamp": 1_714_521_600_000},
            {"type": "settlement", "currency": "USDC", "change": -40.0,
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
            return_value=(
                records,
                # Default report is consistent with `records`: a nonzero
                # return-row count so the C2 equity-vs-activity floor does not
                # trip when the fixture supplies realized records.
                report or CompletenessReport(total_return_rows=len(records)),
            )
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
            # FLOW-04 (77-03) + MUST-2: the deribit branch reads the companion
            # 4-tuple (equity + session-uPnL wedge + unreadable flag) from ONE
            # get_account_summaries response.
            "services.deribit_ingest.fetch_deribit_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(100_000.0, False, 0.0, False)),
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


@pytest.mark.asyncio
async def test_deribit_currency_enumeration_fails_loud():
    """pr-test #2: an unenumerable currency universe (CurrencyEnumerationError
    from the producer) → job FAILED, no upsert — never a silently-empty track
    record. Dropping it from the except tuple turns this red."""
    from services.deribit_ingest import CurrencyEnumerationError

    ctx, capture = _deribit_ctx()
    patches, _ = _deribit_patches(
        ctx,
        records=[],
        ledger_side_effect=CurrencyEnumerationError("get_currencies unreadable"),
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.FAILED
    assert capture["upserts"] == []


@pytest.mark.asyncio
async def test_deribit_scope_auth_error_is_clean_permanent_failed():
    """W-1: a >1-funded-subaccount key raises ScopeAuthError out of
    enumerate_scopes; the deribit branch must classify it as a clean
    DispatchResult(FAILED, permanent) — never an unclassified propagation — and
    write no partial track record."""
    from services.deribit_ingest import ScopeAuthError

    ctx, capture = _deribit_ctx()
    patches, _ = _deribit_patches(
        ctx,
        records=[],
        ledger_side_effect=ScopeAuthError("2 funded subaccounts — use per-sub keys"),
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert capture["upserts"] == []


@pytest.mark.asyncio
async def test_deribit_material_equity_zero_rows_fails_loud():
    """C2: a materially-funded account (equity 100k) whose ledger produced ZERO
    return-bearing rows is an empty-but-green ledger — fail loud, no upsert,
    never a clean DONE. Neutering the floor turns this red."""
    ctx, capture = _deribit_ctx()
    patches, _ = _deribit_patches(
        ctx,
        records=[],  # zero realized records
        report=CompletenessReport(total_return_rows=0),  # and zero return rows
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.FAILED
    assert capture["upserts"] == []


@pytest.mark.asyncio
async def test_deribit_strategy_mode_ledger_incomplete_stamps_failed():
    """P72 (Test C): in STRATEGY-mode a deribit ledger-incompleteness failure
    must stamp strategy_analytics.computation_status='failed' BEFORE returning
    FAILED/permanent.

    The wizard's SyncPreviewStep polls strategy_analytics for a terminal state;
    without the stamp the poller spins on a never-arriving 'complete' until it
    times out to SYNC_FAILED. The stamp gives it a loud, terminal
    GATE_ANALYTICS_FAILED gate instead. A partial ledger must still write NO
    csv_daily_returns (no partial track record). Key-mode has no per-key
    strategy_analytics row, so the stamp is strategy-mode only.
    """
    ctx, capture = _deribit_ctx()
    patches, _ = _deribit_patches(
        ctx,
        records=[],
        ledger_side_effect=LedgerCompletenessError("main×BTC incomplete"),
    )
    with _apply(patches), patch(
        "services.job_worker._exchange_preflight",
        new=AsyncMock(return_value=ctx),
    ):
        result = await run_derive_broker_dailies_job({"strategy_id": "s-drb"})

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    # No partial track record.
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"]), (
        "a partial ledger must NOT upsert csv_daily_returns"
    )
    # But a terminal 'failed' analytics stamp so the wizard gate resolves.
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert stamps, (
        "strategy-mode ledger-fail must stamp strategy_analytics so the wizard "
        "poller reaches a terminal gate instead of spinning"
    )
    payload, on_conflict = stamps[0][1], stamps[0][2]
    assert payload["strategy_id"] == "s-drb"
    assert payload["computation_status"] == "failed"
    assert payload["data_quality_flags"] == {"csv_source": True}
    assert on_conflict == "strategy_id"


@pytest.mark.asyncio
async def test_deribit_ledger_valueerror_is_permanent_and_stamps_failed():
    """Fix A (P72 canary): a row→USD conversion ValueError escaping the ledger
    pass (a coin cash row still unvaluable after the settlement-index fallback,
    schema drift, or an unknown type/currency) is STRUCTURAL — it must fail
    PERMANENT (never the transient 'unknown' that burns 3 retries) AND stamp
    strategy_analytics 'failed' so the wizard reaches a terminal gate instead of
    an infinite 'computing' spinner.

    Revert-proof: remove the new `except LedgerValuationError` clause in the
    deribit branch (so the typed error escapes the narrow tuple except →
    classified transient 'unknown', no analytics stamp) and this reddens on BOTH
    the permanent-kind and the stamp assertions.
    """
    ctx, capture = _deribit_ctx()
    patches, _ = _deribit_patches(
        ctx,
        records=[],
        # A TYPED structural valuation failure (subclass of ValueError) — the
        # permanent-and-stamp path is keyed on the TYPE, not on ValueError.
        ledger_side_effect=LedgerValuationError(
            "inverse Deribit row id=654 has no event-time index_price and no "
            "same-day currency index fallback"
        ),
    )
    with _apply(patches), patch(
        "services.job_worker._exchange_preflight",
        new=AsyncMock(return_value=ctx),
    ):
        result = await run_derive_broker_dailies_job({"strategy_id": "s-drb"})

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    # No partial track record.
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"]), (
        "an unvaluable ledger row must NOT upsert csv_daily_returns"
    )
    # Terminal 'failed' analytics stamp so the wizard poller resolves.
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert stamps, (
        "a ledger LedgerValuationError must stamp strategy_analytics so the wizard "
        "poller reaches a terminal gate instead of spinning on 'computing'"
    )
    assert stamps[0][1]["computation_status"] == "failed"


@pytest.mark.parametrize(
    "network_exc",
    [
        RuntimeError("network down"),
        # json.JSONDecodeError SUBCLASSES ValueError — a garbled-200 parse error
        # escaping ccxt. The pre-Fix `except ValueError` would have caught it and
        # marked the strategy PERMANENT (never retried) + stamped 'failed'; the
        # narrowed `except LedgerValuationError` must let it fall through to the
        # transient/unknown classifier so a transient blip is retried.
        json.JSONDecodeError("Expecting value", "", 0),
    ],
    ids=["runtime_error", "json_decode_error"],
)
@pytest.mark.asyncio
async def test_deribit_network_valueerror_is_not_permanent_and_no_stamp(
    network_exc: Exception,
) -> None:
    """Fix 1 boundary: a NETWORK-style error from the ledger crawl that is NOT a
    LedgerValuationError (a bare RuntimeError, or a json.JSONDecodeError — itself
    a ValueError subclass) must NOT be caught by the deribit branch's narrowed
    `except LedgerValuationError`. It falls through to the outer generic
    classifier → transient/unknown (RETRIED), and writes NO strategy_analytics
    'failed' stamp.

    Routed through `dispatch` so the propagated error is classified into a
    DispatchResult.error_kind (the classifier lives in dispatch, not the handler).

    Revert-proof: widen the clause back to `except ValueError` and the
    json.JSONDecodeError case reddens on BOTH assertions — it would be swallowed
    as permanent and stamp 'failed'.
    """
    ctx, capture = _deribit_ctx()
    patches, _ = _deribit_patches(
        ctx,
        records=[],
        ledger_side_effect=network_exc,
    )
    with _apply(patches), patch(
        "services.job_worker._exchange_preflight",
        new=AsyncMock(return_value=ctx),
    ), patch(
        "services.job_worker.sync_strategy_analytics_status",
        new=AsyncMock(),
    ):
        result = await dispatch(
            {"kind": "derive_broker_dailies", "strategy_id": "s-drb"}
        )

    assert result.outcome == DispatchOutcome.FAILED
    # NOT permanent — a transient/unknown network condition must be retried, never
    # burned into a permanent strategy failure.
    assert result.error_kind != "permanent"
    # And NO terminal 'failed' analytics stamp — a transient blip must not render
    # the strategy permanently failed to the wizard.
    assert not any(u[0] == "strategy_analytics" for u in capture["upserts"]), (
        "a transient network error must NOT stamp strategy_analytics 'failed'"
    )


@pytest.mark.asyncio
async def test_deribit_material_equity_zero_rows_strategy_mode_stamps_failed():
    """P72 (Test C, companion): the material-equity/zero-rows fail-loud branch
    must ALSO stamp strategy_analytics='failed' in strategy-mode before returning
    FAILED — same wizard-gate rationale as the ledger-incomplete branch."""
    ctx, capture = _deribit_ctx()
    patches, _ = _deribit_patches(
        ctx,
        records=[],  # zero realized records
        report=CompletenessReport(total_return_rows=0),  # zero return rows
    )
    with _apply(patches), patch(
        "services.job_worker._exchange_preflight",
        new=AsyncMock(return_value=ctx),
    ):
        result = await run_derive_broker_dailies_job({"strategy_id": "s-drb"})

    assert result.outcome == DispatchOutcome.FAILED
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert stamps, "material-equity-empty strategy-mode fail must stamp failed"
    assert stamps[0][1]["computation_status"] == "failed"


# NOTE (75-03): the two former F1-scalar tests — `test_deribit_anchor_subtracts_
# net_external_flow` and `test_deribit_unvalued_inverse_flow_flags_heuristic` —
# were DELETED with the F1 scalar anchor correction they pinned. The equity anchor
# now flows into the honest core UNADJUSTED and dated external flows feed ONLY the
# core's F_t term (count-once, no double-correction). Their replacements live in
# tests/test_job_worker_deribit.py (F1-deletion + threading + no-double-correction
# + fail-loud-inheritance proofs).


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


def test_deribit_equity_anchor_values_any_resolvable_currency():
    """F3: the EQUITY anchor (unlike the ledger cash conversion) values EVERY
    held currency with a resolvable {ccy}_usd index — a live LTP account holds
    e.g. SOL dust, and dropping it (or failing loud) would wrongly force
    heuristic capital for the whole track record."""
    usd = deribit_equity_to_usd(
        [{"currency": "SOL", "equity": 10.0}, {"currency": "USDC", "equity": 5.0}],
        {"SOL": 150.0},
    )
    assert usd == pytest.approx(10.0 * 150.0 + 5.0)


def test_deribit_equity_anchor_missing_index_fails_loud():
    """A nonzero coin equity with NO resolvable index MUST raise (→ heuristic
    capital upstream), never anchor on a raw coin quantity. A zero balance in an
    un-indexed currency is skipped (no index needed)."""
    with pytest.raises(ValueError):
        deribit_equity_to_usd([{"currency": "SOL", "equity": 0.004}], {})
    # zero-equity un-indexed currency contributes 0, no raise:
    assert deribit_equity_to_usd([{"currency": "SOL", "equity": 0.0}], {}) == 0.0


def test_deribit_equity_anchor_rejects_non_positive_index():
    """A zero/negative index price on a coin-margined equity MUST raise, never
    value equity at <=0."""
    with pytest.raises(ValueError):
        deribit_equity_to_usd([{"currency": "BTC", "equity": 2.0}], {"BTC": 0.0})


def _apply(patchers: list):
    """Enter a list of patch() context managers as one ExitStack."""
    from contextlib import ExitStack

    stack = ExitStack()
    for p in patchers:
        stack.enter_context(p)
    return stack


# --- DRB-08 ONE-path shape parity (deribit vs bybit through compute_all_metrics)


def _deribit_multiday_ledger_records() -> list[dict]:
    """Synthetic deribit ledger daily_records (>=2 days) incl one inverse
    coin→USD settlement day and one option-delivery day."""
    return txn_rows_to_daily_records(
        [
            # Day 1 — inverse (coin-margined) settlement: 0.002 BTC * 50,000 = +100 USD
            {"type": "settlement", "currency": "BTC", "change": 0.002,
             "index_price": 50_000.0, "instrument_name": "BTC-PERPETUAL",
             "timestamp": 1_714_521_600_000},
            # Day 2 — option delivery, linear USDC settlement: +30 USD
            {"type": "delivery", "currency": "USDC", "change": 30.0,
             "instrument_name": "BTC-9MAY25-60000-C",
             "timestamp": 1_714_608_000_000},
            # Day 3 — linear USDC perp settlement: -45 USD
            {"type": "settlement", "currency": "USDC", "change": -45.0,
             "instrument_name": "BTC_USDC-PERPETUAL",
             "timestamp": 1_714_694_400_000},
        ]
    )


def test_deribit_one_path_shape():
    """DRB-08 / D-15(e) pin: deribit ledger records + EMPTY funding flow through
    combine_realized_and_funding → compute_all_metrics with a shape IDENTICAL to
    the bybit fixture. The metrics dict key set must match exactly — a
    Deribit-specific dailies/metrics path would diverge the keys and turn red."""
    drb_records = _deribit_multiday_ledger_records()
    drb_returns, _ = combine_realized_and_funding(
        drb_records, [], account_balance=100_000.0
    )
    # compute_all_metrics' input contract: ascending gap-free DatetimeIndex, float64.
    assert isinstance(drb_returns.index, pd.DatetimeIndex)
    assert drb_returns.index.is_monotonic_increasing
    assert pd.api.types.is_float_dtype(drb_returns)

    # Equivalent bybit fixture through the SAME path (realized + funding).
    days = ["2024-05-01", "2024-05-02", "2024-05-03"]
    bybit_realized = [_realized_record(d, 60.0) for d in days]
    bybit_funding = [_funding_row(d, 20.0) for d in days]
    bybit_returns, _ = combine_realized_and_funding(
        bybit_realized, bybit_funding, account_balance=100_000.0
    )

    drb_keys = set(compute_all_metrics(drb_returns).metrics_json.keys())
    bybit_keys = set(compute_all_metrics(bybit_returns).metrics_json.keys())
    assert drb_keys == bybit_keys, (
        "deribit dailies must share the bybit metrics key set (ONE path, no fork); "
        f"deribit-only={drb_keys - bybit_keys} bybit-only={bybit_keys - drb_keys}"
    )


def test_deribit_no_specific_metrics_path():
    """Structural pin: deribit ledger daily_records are the SAME daily_pnl shape
    bybit emits, so they go through combine_realized_and_funding unchanged (no
    bespoke deribit function). A forked shape would break this parity."""
    drb_records = _deribit_multiday_ledger_records()
    bybit_record = _realized_record("2024-05-01", 60.0)
    for rec in drb_records:
        assert rec["order_type"] == "daily_pnl"
        assert set(rec.keys()) == set(bybit_record.keys()), (
            "deribit ledger record shape must equal bybit's daily_pnl record shape"
        )
    # Empty funding → combine emits exactly the realized day-buckets, no funding rows.
    returns, _ = combine_realized_and_funding(
        drb_records, [], account_balance=100_000.0
    )
    assert not returns.empty


# --- Phase 74 Wave 0 byte-identity snapshot pin ------------------------------
# Freeze TODAY's EXACT gap-filled returns Series for the broker realized+funding
# combine path on a flow-less, estimated_start>0 fixture. This pins the broker
# call site (broker_dailies.py:130 -> job_worker.py:2010) so Wave 2's param
# threading is proven byte-identical. MUST stay GREEN across the whole phase.
def test_byte_identical_combine_snapshot():
    """combine_realized_and_funding byte-identity pin (rtol 1e-12).

    Fixture: realized daily_pnl on 02-01/02-02/02-05 + funding on 02-01/02-03,
    account_balance=180k (Σpnl well under it -> estimated_start>0, no
    heuristic/guard). Asserts the exact gap-filled returns AND the gap-fill
    invariant: every calendar day in [first,last] present (02-04 is inserted),
    no-activity days == 0.0."""
    realized = [
        _realized_record("2026-02-01", 800.0),
        _realized_record("2026-02-02", -350.0),
        _realized_record("2026-02-05", 600.0),
    ]
    funding = [
        _funding_row("2026-02-01", 120.0),
        _funding_row("2026-02-03", -80.0),
    ]
    returns, meta = combine_realized_and_funding(
        realized, funding, account_balance=180_000.0
    )

    expected_index = pd.DatetimeIndex(
        ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"]
    )
    expected_values = [
        0.005142250293443631,
        -0.001946282600233554,
        -0.0004457321149988857,
        0.0,
        0.0033444816053511705,
    ]
    expected = pd.Series(expected_values, index=expected_index)

    pd.testing.assert_series_equal(
        returns, expected, check_exact=False, rtol=1e-12,
        check_freq=False, check_names=False,
    )

    # Gap-fill invariant: dense calendar over [first, last] with 02-04 present
    # and equal to a flat 0.0 no-activity return.
    assert list(returns.index) == list(expected_index), (
        "gap_fill must produce a dense calendar over [first, last]"
    )
    assert float(returns.loc["2026-02-04"]) == 0.0, (
        "a no-activity calendar day must gap-fill to a flat 0.0 return"
    )
    # Real-balance path: no heuristic, no guard -> 'complete'.
    assert meta["used_heuristic_capital"] is False
    assert meta["computation_status_hint"] == "complete"


def test_external_flows_param_threads_through_combine_to_core():
    """74-02 Task 3 (updated for 75-05 HIGH-1): the external_flows kwarg passed to
    combine_realized_and_funding is THREADED all the way to the honest core
    (trades_to_daily_returns_with_status -> reconstruct_nav_and_twr). We prove the
    WIRE, not flow valuation (that is Phase 75).

    Pre-HIGH-1 this test proved the wire via the orphan-raise: an off-window flow
    was rejected by _align_flows. HIGH-1 deliberately removes that behavior — a
    flow on a day with no realized/funding row is now UNIONED into the NAV
    timeline (never orphaned, never lost). So the wire is proven the correct,
    stronger way instead: passing a boundary/quiet-day flow (a) ADDS its day to
    the reconstructed index (placed, not dropped) and (b) is LOAD-BEARING — the
    shared trading day's reconstructed return differs from the no-flow run.

    Mutation-honest: dropping the thread (external_flows not forwarded to the
    core) makes the with/without runs identical AND the unioned day absent -> RED.
    Pre-wiring, external_flows was an unknown kwarg (TypeError). The default
    (external_flows=None) path is unchanged (test_byte_identical_combine_snapshot).
    """
    from services.broker_dailies import combine_realized_and_funding

    realized = [
        {
            "exchange": "", "symbol": "BTCUSDT", "side": "buy", "price": 500.0,
            "quantity": 1, "fee": 0, "fee_currency": "USDT",
            "timestamp": "2026-01-01T00:00:00+00:00", "order_type": "daily_pnl",
        },
        {
            "exchange": "", "symbol": "BTCUSDT", "side": "buy", "price": 300.0,
            "quantity": 1, "fee": 0, "fee_currency": "USDT",
            "timestamp": "2026-01-02T00:00:00+00:00", "order_type": "daily_pnl",
        },
    ]
    # A sub-NAV withdrawal on 2026-01-03 — a day with NO realized/funding row.
    # HIGH-1 unions it into the NAV timeline rather than orphan-raising.
    flow_day = pd.Timestamp("2026-01-03")
    with_flow, _ = combine_realized_and_funding(
        realized, [], account_balance=100_000.0,
        external_flows=[("2026-01-03", -5000.0)],
    )
    without_flow, _ = combine_realized_and_funding(
        realized, [], account_balance=100_000.0, external_flows=None,
    )
    # (a) The flow day reached the core and was PLACED (unioned in), not dropped.
    assert flow_day in with_flow.index
    assert flow_day not in without_flow.index
    # (b) The flow is LOAD-BEARING: a shared trading day's reconstructed return
    # differs from the no-flow run (the param genuinely reached the reconstruction,
    # not silently ignored).
    shared_day = pd.Timestamp("2026-01-01")
    assert with_flow.loc[shared_day] != pytest.approx(without_flow.loc[shared_day])
