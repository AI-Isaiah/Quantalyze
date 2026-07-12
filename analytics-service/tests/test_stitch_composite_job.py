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

import logging
from contextlib import ExitStack
from datetime import datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.deribit_ingest import (
    CompletenessReport,
    deribit_raw_rows_have_option_activity,
)
from services.native_nav import NativeLedger
from services.nav_twr import NavReconstructionError
from services.job_worker import DispatchOutcome, run_stitch_composite_job
from services.stitch_composite import MTM_REASON_OPTIONS


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


# ---------------------------------------------------------------------------
# Task 2 — run_stitch_composite_job harness (pure-stub supabase / exchange)
# ---------------------------------------------------------------------------

_STRATEGY_ID = "s-composite-1"

# A minimal VALID allocated-capital config so the by-basis metrics ride the
# arithmetic (simple) + active-day convention the composite reports on. The
# per-key reconstruction (combine_native_ledger) is MOCKED, so the schedule is
# never actually consulted — it only has to parse.
_TEST_CONFIG = {
    "denominator": "allocated_capital",
    "pnl_basis": "cash_settlement",
    "capital_schedule": [{"effective_from": "2024-01-01", "capital_usd": 1_000_000}],
    "metrics_basis": "active_day",
    "cumulative_method": "simple",
}


class _FakeQuery:
    def __init__(self, fake: "_FakeSupabase", table: str) -> None:
        self.fake = fake
        self.table = table
        self._op = "select"
        self._eqs: list[tuple[str, Any]] = []
        self._single = False
        self._maybe = False
        self._payload: Any = None
        self._conflict: str | None = None

    def select(self, *a: Any, **k: Any) -> "_FakeQuery":
        self._op = "select"
        return self

    def eq(self, col: str, val: Any) -> "_FakeQuery":
        self._eqs.append((col, val))
        return self

    def order(self, *a: Any, **k: Any) -> "_FakeQuery":
        return self

    def gte(self, *a: Any, **k: Any) -> "_FakeQuery":
        return self

    def lte(self, *a: Any, **k: Any) -> "_FakeQuery":
        return self

    def single(self) -> "_FakeQuery":
        self._single = True
        return self

    def maybe_single(self) -> "_FakeQuery":
        self._maybe = True
        return self

    def delete(self) -> "_FakeQuery":
        self._op = "delete"
        return self

    def upsert(self, payload: Any, on_conflict: str | None = None) -> "_FakeQuery":
        self._op = "upsert"
        self._payload = payload
        self._conflict = on_conflict
        return self

    def execute(self) -> SimpleNamespace:
        if self._op == "upsert":
            self.fake.upserts.append((self.table, self._payload, self._conflict))
            return SimpleNamespace(data=self._payload)
        if self._op == "delete":
            self.fake.deletes.append((self.table, list(self._eqs)))
            return SimpleNamespace(data=[])
        # select
        if self.table == "strategy_keys":
            return SimpleNamespace(data=list(self.fake.members))
        if self.table == "strategies":
            return SimpleNamespace(data=dict(self.fake.strategy_row))
        if self.table == "strategy_analytics":
            return SimpleNamespace(
                data={"data_quality_flags": dict(self.fake.existing_flags)}
            )
        return SimpleNamespace(data=None)


class _FakeSupabase:
    def __init__(
        self,
        *,
        members: list[dict[str, Any]],
        strategy_row: dict[str, Any] | None = None,
        existing_flags: dict[str, Any] | None = None,
        raise_on_rpc: str | None = None,
    ) -> None:
        self.members = members
        self.strategy_row = strategy_row if strategy_row is not None else {
            "id": _STRATEGY_ID, "asset_class": "crypto",
            "returns_denominator_config": _TEST_CONFIG,
        }
        self.existing_flags = existing_flags or {}
        self.upserts: list[tuple[str, Any, str | None]] = []
        self.deletes: list[tuple[str, list[tuple[str, Any]]]] = []
        self.rpc_calls: list[tuple[str, dict[str, Any]]] = []
        # PROG-02 fail-open harness: when set, .execute() on the named RPC raises
        # so a test can prove the progress side-channel never kills the stitch.
        self.raise_on_rpc = raise_on_rpc

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)

    def rpc(self, name: str, args: dict[str, Any]) -> SimpleNamespace:
        self.rpc_calls.append((name, args))
        if self.raise_on_rpc is not None and name == self.raise_on_rpc:
            def _boom() -> SimpleNamespace:
                raise RuntimeError(f"simulated {name} failure")
            return SimpleNamespace(execute=_boom)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=None))


def _member(seq: int, window_start: str, window_end: str | None) -> dict[str, Any]:
    return {
        "api_key_id": f"key-{seq}",
        "owner_id": "owner-1",
        "window_start": window_start,
        "window_end": window_end,
        "seq": seq,
    }


def _ctx(exchange_id: str = "deribit") -> MagicMock:
    ctx = MagicMock()
    ctx.exchange = AsyncMock()
    ctx.supabase = MagicMock()
    ctx.strategy_row = None
    ctx.key_row = {"id": "key-x", "user_id": "owner-1", "exchange": exchange_id}
    return ctx


def _stub_ledger() -> NativeLedger:
    return NativeLedger(
        native_pnl={"BTC": pd.Series([1.0], index=pd.DatetimeIndex(["2024-01-01"]))},
        terminal_native_equity={"BTC": 1.0},
        marks={},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )


def _returns(pairs: list[tuple[str, float]]) -> pd.Series:
    idx = pd.DatetimeIndex([d for d, _ in pairs]).as_unit("us")
    return pd.Series([v for _, v in pairs], index=idx, dtype="float64")


def _apply(patchers: list) -> ExitStack:
    stack = ExitStack()
    for p in patchers:
        stack.enter_context(p)
    return stack


# --- Plan 93-04: ccxt member reconstruction fixtures --------------------------
# The FETCH primitives are mocked at their SOURCE modules (the helper imports them
# function-locally, so patching the job_worker namespace would miss); the
# valuation/combine/terminus MATH runs REAL (the 92-02 Layer-3 pattern).


def _ccxt_realized(day: str, pnl: float) -> dict[str, Any]:
    """A daily-pnl realized record (mirrors services.exchange.fetch_daily_pnl /
    the test_broker_dailies fixture shape) — fed REAL to combine_realized_and_
    funding."""
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


def _ccxt_funding(day: str, amount: float) -> dict[str, Any]:
    return {
        "amount": amount,
        "timestamp": datetime.fromisoformat(f"{day}T08:00:00+00:00"),
    }


def _ccxt_fetch_patches(
    *,
    equity: tuple[Any, bool, float, bool] = (10_000.0, False, 0.0, False),
    realized: list[dict[str, Any]] | None = None,
    funding: list[dict[str, Any]] | None = None,
    deposits: list[dict[str, Any]] | None = None,
    withdrawals: list[dict[str, Any]] | None = None,
    price_index: dict[Any, float] | None = None,
    flows_raise: BaseException | None = None,
    fetch_raise: BaseException | None = None,
) -> list:
    """Patch the ccxt member reconstruction FETCH layer (Plan 93-04, Plan-checker
    Note 2 — SOURCE-module sites). ``flows_raise`` makes the REAL-math seam
    (``ccxt_rows_to_dated_flows``) raise a structural error → the member degrades;
    ``fetch_raise`` makes the equity fetch raise (e.g. a 429 / geo transient)."""
    _deposits = list(deposits or [])
    _withdrawals = list(withdrawals or [])

    async def _transfers(_exchange: Any, kind: str, _since: int, _now: int) -> list:
        return _deposits if kind == "deposits" else _withdrawals

    equity_mock = (
        AsyncMock(side_effect=fetch_raise)
        if fetch_raise is not None
        else AsyncMock(return_value=equity)
    )
    patches = [
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd", new=equity_mock
        ),
        patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=list(realized or [])),
        ),
        patch(
            "services.funding_fetch.fetch_funding_bybit",
            new=AsyncMock(return_value=list(funding or [])),
        ),
        patch(
            "services.funding_fetch.fetch_funding_binance",
            new=AsyncMock(return_value=list(funding or [])),
        ),
        patch(
            "services.funding_fetch.fetch_funding_okx",
            new=AsyncMock(return_value=list(funding or [])),
        ),
        patch(
            "services.ccxt_flow_fetch.fetch_ccxt_transfers",
            new=AsyncMock(side_effect=_transfers),
        ),
        patch(
            "services.job_worker._resolve_ccxt_flow_price_index",
            new=AsyncMock(return_value=dict(price_index or {})),
        ),
    ]
    if flows_raise is not None:
        patches.append(
            patch(
                "services.ccxt_flows.ccxt_rows_to_dated_flows",
                new=MagicMock(side_effect=flows_raise),
            )
        )
    return patches


def _deribit_patches(
    fake: _FakeSupabase,
    *,
    combine_returns: list[tuple[pd.Series, dict[str, Any]]],
    has_option_activity: bool,
    ctx_exchange: str = "deribit",
    csv_analytics: AsyncMock | None = None,
    preflight_side_effect: object = None,
) -> list:
    """Patch set driving run_stitch_composite_job over stubbed per-key ledgers.
    ``combine_returns`` is the (returns, meta) each combine_native_ledger call
    yields in seq order (cash pass, then MTM pass if the gate opens)."""
    report = CompletenessReport(
        total_return_rows=2,
        indexable_currencies=frozenset({"BTC"}),
        has_option_activity=has_option_activity,
    )
    if preflight_side_effect is not None:
        preflight = AsyncMock(side_effect=preflight_side_effect)
    else:
        preflight = AsyncMock(return_value=_ctx(ctx_exchange))
    return [
        patch("services.job_worker.get_supabase", new=MagicMock(return_value=fake)),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
        patch("services.job_worker._allocator_key_preflight", new=preflight),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.deribit_ingest.fetch_deribit_native_account_state",
            new=AsyncMock(return_value=MagicMock(
                balance_error=False, native_equity={"BTC": 1.0},
            )),
        ),
        patch(
            "services.deribit_ingest.build_deribit_native_ledger",
            new=AsyncMock(return_value=(_stub_ledger(), report)),
        ),
        patch("services.deribit_ingest.assert_ledger_complete", new=MagicMock()),
        patch(
            "services.broker_dailies.combine_native_ledger",
            new=MagicMock(side_effect=list(combine_returns)),
        ),
        patch(
            "services.analytics_runner.run_csv_strategy_analytics",
            new=csv_analytics or AsyncMock(return_value={"status": "complete"}),
        ),
        # F-2: run_stitch_composite_job fetches the BTC benchmark via a LOCAL
        # `from services.benchmark import get_benchmark_returns` — patch that so the
        # unit harness stays offline (default: unavailable; the asserted scalars are
        # benchmark-invariant).
        patch(
            "services.benchmark.get_benchmark_returns",
            new=AsyncMock(return_value=(None, True)),
        ),
    ]


def _by_basis(fake: _FakeSupabase) -> dict[str, Any] | None:
    """The metrics_json_by_basis object from the last strategy_analytics upsert
    that carried it (the additive by-basis write)."""
    for table, payload, _ in reversed(fake.upserts):
        if table == "strategy_analytics" and isinstance(payload, dict) \
                and "metrics_json_by_basis" in payload:
            return payload["metrics_json_by_basis"]
    return None


@pytest.mark.asyncio
async def test_zero_members_permanent_failed() -> None:
    """A composite with no strategy_keys members is structurally broken —
    permanent FAILED (never enqueued-forever), and a terminal analytics stamp."""
    fake = _FakeSupabase(members=[])
    with _apply(_deribit_patches(fake, combine_returns=[], has_option_activity=False)):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert any(u[0] == "strategy_analytics" for u in fake.upserts)


@pytest.mark.asyncio
async def test_declared_window_overlap_permanent_before_any_crawl() -> None:
    """Overlapping DECLARED windows fail loud BEFORE any exchange crawl —
    permanent, and build_deribit_native_ledger is never reached."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-15"),
        _member(2, "2024-02-01", None),  # overlaps seq 1
    ])
    ledger_spy = AsyncMock(return_value=(_stub_ledger(), CompletenessReport()))
    patches = _deribit_patches(fake, combine_returns=[], has_option_activity=False)
    with _apply(patches), patch(
        "services.deribit_ingest.build_deribit_native_ledger", new=ledger_spy
    ):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    ledger_spy.assert_not_called()


@pytest.mark.asyncio
async def test_happy_path_two_member_fanout_combined_scalars() -> None:
    """W-1 worker↔acceptance seam: drive run_stitch_composite_job end-to-end over
    two stubbed per-key ledgers through the REAL clip→overlap→arithmetic-stitch→
    gap-fill→compute_all_metrics orchestration and assert the combined scalars —
    arithmetic-sum cumulative (Σr) + inception-seeded maxDD. Option-active members
    keep the MTM gate CLOSED (cash-only)."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    meta: dict[str, Any] = {}
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, meta), (m2, meta)],
        has_option_activity=True,  # gate CLOSED → cash-only
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    by_basis = _by_basis(fake)
    assert by_basis is not None
    assert "cash_settlement" in by_basis
    assert "mark_to_market" not in by_basis  # gated off (option-active)
    cash = by_basis["cash_settlement"]
    assert cash["cumulative_return"] == pytest.approx(0.05)
    assert cash["max_drawdown"] == pytest.approx(-0.10)


@pytest.mark.asyncio
async def test_gap_days_absent_from_csv_upsert_but_dense_for_metrics() -> None:
    """Pitfall 2: the calendar gap between the two member windows is ABSENT from
    the csv_daily_returns payload (never 0.0-written as flat performance), yet the
    metrics see a dense gap-filled series (cumulative still computes)."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-01-03"),
        _member(2, "2024-01-10", None),  # 6-day gap Jan-04..Jan-09
    ])
    m1 = _returns([("2024-01-01", 0.02), ("2024-01-02", 0.01)])
    m2 = _returns([("2024-01-10", 0.03), ("2024-01-11", -0.01)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    # The csv_daily_returns upsert payload carries ONLY the 4 real days.
    csv_rows = [
        row
        for table, payload, _ in fake.upserts
        if table == "csv_daily_returns" and isinstance(payload, list)
        for row in payload
    ]
    written_dates = {r["date"] for r in csv_rows}
    assert written_dates == {"2024-01-01", "2024-01-02", "2024-01-10", "2024-01-11"}
    assert "2024-01-05" not in written_dates  # gap day never written


@pytest.mark.asyncio
async def test_degenerate_under_two_day_composite_permanent_not_raised() -> None:
    """F2 (Phase 86): a near-fully-clipped / ≤1-day-history composite yields a
    stitched series with <2 PRESENT days. The <2-day guard must fire BEFORE
    _metrics_json_for → compute_all_metrics (which raises a BARE ValueError that
    classify_exception maps to RETRYABLE → retry-forever, wizard poller spins).

    Post-fix: the job RETURNS a permanent FAILED with a terminal 'failed' stamp,
    never raising. Neuter (drop the hoisted guard) → compute_all_metrics raises
    ValueError uncaught → this test reddens (the raise escapes)."""
    fake = _FakeSupabase(members=[_member(1, "2024-01-01", None)])
    m1 = _returns([("2024-01-01", 0.05)])  # exactly ONE present day
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {})], has_option_activity=True,
    )):
        # Must NOT raise — a degenerate composite is a classified permanent, not
        # an unclassified ValueError.
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    # Terminal 'failed' analytics stamp so the wizard poller reaches a gate.
    failed_stamps = [
        payload
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
        and isinstance(payload, dict)
        and payload.get("computation_status") == "failed"
    ]
    assert failed_stamps, "degenerate composite must stamp a terminal failed row"
    # The compute path must NOT have been reached — no csv_daily_returns write.
    assert not any(t == "csv_daily_returns" for t, _, _ in fake.upserts)


@pytest.mark.asyncio
async def test_mtm_admitted_perp_only_second_pass_writes_both_bases() -> None:
    """Perp-only members (no option activity, all deribit) → MTM gate OPEN → a
    SECOND ledger pass with pnl_basis='mark_to_market' → metrics_json_by_basis
    carries BOTH bases."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    # cash pass (m1, m2) then MTM pass (m1, m2) → 4 combine calls.
    build_spy = AsyncMock(return_value=(_stub_ledger(), CompletenessReport(
        total_return_rows=2, indexable_currencies=frozenset({"BTC"}),
        has_option_activity=False,
    )))
    patches = _deribit_patches(
        fake,
        combine_returns=[(m1, {}), (m2, {}), (m1, {}), (m2, {})],
        has_option_activity=False,  # gate OPEN
    )
    with _apply(patches), patch(
        "services.deribit_ingest.build_deribit_native_ledger", new=build_spy
    ):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    by_basis = _by_basis(fake)
    assert by_basis is not None
    assert set(by_basis) == {"cash_settlement", "mark_to_market"}
    # The second pass built the ledger with the MTM basis.
    mtm_calls = [
        c for c in build_spy.await_args_list
        if c.kwargs.get("pnl_basis") == "mark_to_market"
    ]
    assert mtm_calls, "MTM-admitted composite must run a mark_to_market ledger pass"


@pytest.mark.asyncio
async def test_mtm_gated_reason_in_dq_flags_when_option_active() -> None:
    """An option-active member gates MTM off; the reason is carried in
    data_quality_flags for Phase 90 (never JSON null in the by-basis object)."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    by_basis = _by_basis(fake)
    assert by_basis is not None
    assert list(by_basis) == ["cash_settlement"]  # exactly one key, no null
    # Phase 102 MTM-02 (Option A, COMPOSE-2): an options-member composite persists
    # NO mark_to_market key (never a JSON null in the by-basis object) — the honest-
    # disabled contract, tied to the value-imported constant (rename-decouple guard).
    assert "mark_to_market" not in by_basis
    # mtm_gated_reason surfaced in the merged DQ flags.
    dq = None
    for table, payload, _ in reversed(fake.upserts):
        if table == "strategy_analytics" and isinstance(payload, dict) \
                and "data_quality_flags" in payload \
                and "metrics_json_by_basis" in payload:
            dq = payload["data_quality_flags"]
            break
    assert dq is not None
    assert dq.get("mtm_gated_reason") == MTM_REASON_OPTIONS == "unsmoothed_options_book"


@pytest.mark.asyncio
async def test_dq_flags_merge_preserves_existing_key() -> None:
    """The additive DQ-flag write MERGES (read-modify-write) — a pre-existing
    flag key set by the headline CSV run survives the composite coverage-mask
    merge, never replaced wholesale."""
    fake = _FakeSupabase(
        members=[
            _member(1, "2024-01-01", "2024-02-01"),
            _member(2, "2024-02-01", None),
        ],
        existing_flags={"csv_source": True, "benchmark_unavailable": True},
    )
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    dq = None
    for table, payload, _ in reversed(fake.upserts):
        if table == "strategy_analytics" and isinstance(payload, dict) \
                and "metrics_json_by_basis" in payload:
            dq = payload["data_quality_flags"]
            break
    assert dq is not None
    assert dq.get("benchmark_unavailable") is True  # preserved
    assert "per_key" in dq and "gap_day_count" in dq  # composite mask merged in


def _headline_row(fake: _FakeSupabase) -> dict[str, Any] | None:
    for table, payload, _ in reversed(fake.upserts):
        if (
            table == "strategy_analytics"
            and isinstance(payload, dict)
            and "metrics_json_by_basis" in payload
        ):
            return payload
    return None


@pytest.mark.asyncio
async def test_insufficient_window_short_composite_stamps_flag_status_unchanged() -> None:
    """HARD-04 (#67): a short-window composite (stitched span < 90 calendar days)
    persists data_quality_flags.insufficient_window == True, while the CAGR-site
    flag does NOT change computation_status — a clean short-window composite stays
    exact-string 'complete' (the flag is deliberately NOT a NAV_TWR_GUARD_KEYS
    member). Neuter the lift (drop the merged_flags set) → the flag is absent →
    this reddens."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    # ~32-calendar-day stitched span → under MIN_ANNUALIZATION_DAYS (90).
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    headline = _headline_row(fake)
    assert headline is not None
    assert headline["data_quality_flags"].get("insufficient_window") is True
    # Status invariant: the annotation flag never promotes computation_status.
    assert headline["computation_status"] == "complete"
    assert headline["computation_warned"] is False


@pytest.mark.asyncio
async def test_insufficient_window_drop_stale_on_long_restitch() -> None:
    """HARD-04 heal-on-re-stitch: a composite that GROWS past MIN_ANNUALIZATION_DAYS
    (stitched span >= 90 days) DROPS a pre-existing stale insufficient_window
    (mtm_gated_reason drop-stale mirror), while an unrelated seeded flag survives
    the merge. Neuter the else-branch pop → the stale flag lingers → this reddens."""
    fake = _FakeSupabase(
        members=[
            _member(1, "2024-01-01", "2024-04-14"),
            _member(2, "2024-04-15", None),
        ],
        existing_flags={
            "csv_source": True,
            "insufficient_window": True,   # stale from a prior short-window derive
            "benchmark_unavailable": True,  # unrelated — must survive the merge
        },
    )
    # ~106-calendar-day stitched span (2024-01-01 .. 2024-04-16) → >= 90.
    m1 = _returns([("2024-01-01", 0.02), ("2024-01-02", 0.01)])
    m2 = _returns([("2024-04-15", -0.01), ("2024-04-16", 0.015)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    headline = _headline_row(fake)
    assert headline is not None
    dq = headline["data_quality_flags"]
    assert "insufficient_window" not in dq  # healed (drop-stale)
    assert dq.get("benchmark_unavailable") is True  # unrelated key preserved


@pytest.mark.asyncio
async def test_member_guard_meta_promotes_complete_with_warnings() -> None:
    """Finding 3: run_stitch_composite_job previously DISCARDED each member's
    NavTWRMeta (`returns, _meta = combine_native_ledger(...)`). A composite built
    from a guard-day / heuristic-capital / chain-broken member must union those
    flags into the composite DQ flags and promote status to
    complete_with_warnings (mirror the single-key bridge). Neuter (drop the meta
    union) → the row stamps a clean 'complete' with no caveat → this reddens."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    # seq-1 member reconstructed with a chain-broken guard day + heuristic capital.
    with _apply(_deribit_patches(
        fake,
        combine_returns=[
            (m1, {"twr_chain_broken": True, "used_heuristic_capital": True}),
            (m2, {}),
        ],
        has_option_activity=True,  # gate CLOSED → single cash pass, metas honored
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    # The headline row carries complete_with_warnings + the unioned flags.
    headline = None
    for table, payload, _ in reversed(fake.upserts):
        if (
            table == "strategy_analytics"
            and isinstance(payload, dict)
            and "metrics_json_by_basis" in payload
        ):
            headline = payload
            break
    assert headline is not None
    assert headline["computation_status"] == "complete_with_warnings"
    assert headline["computation_warned"] is True
    dq = headline["data_quality_flags"]
    assert dq.get("twr_chain_broken") is True
    assert dq.get("used_heuristic_capital") is True


# ---------------------------------------------------------------------------
# HARD-05 (Phase 93) — remove the PERMANENT ccxt rejection; ccxt members DEGRADE
# ---------------------------------------------------------------------------


def _degraded_members(fake: _FakeSupabase) -> Any:
    """The degraded_members list from the persisted headline data_quality_flags
    (None if the key is absent)."""
    headline = _headline_row(fake)
    assert headline is not None
    return headline["data_quality_flags"].get("degraded_members")


@pytest.mark.asyncio
async def test_ccxt_member_degrades_not_permanent_fail() -> None:
    """HARD-05: a 2-member composite (seq 1 Deribit + seq 2 Bybit) NO LONGER fails
    PERMANENT on the venue check. The Deribit member stitches; the Bybit member whose
    honest reconstruction fails STRUCTURALLY DEGRADES out of the stitch with a
    machine-readable DQ reason, computation_status promotes to complete_with_warnings,
    and the ccxt member appears in per_key with n_days 0 (honest zero coverage). The
    stitched csv equals the Deribit-only stitch.

    Plan 93-04 contract update: the reason is now `reconstruction_failed` (the member
    ATTEMPTS reconstruction first — here the flow valuation raises structurally — and
    falls back to the 93-03 degrade channel), not the old unconditional
    `venue_reconstruction_unavailable`."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),   # deribit
        _member(2, "2024-02-01", None),           # bybit — reconstruction fails → degrades
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],   # ONLY the Deribit member reconstructs
        has_option_activity=True,     # gate CLOSED → single cash pass
        preflight_side_effect=[_ctx("deribit"), _ctx("bybit")],
    ) + _ccxt_fetch_patches(
        flows_raise=NavReconstructionError("unpriceable non-stable flow"),
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    headline = _headline_row(fake)
    assert headline is not None
    assert headline["computation_status"] == "complete_with_warnings"
    assert headline["computation_warned"] is True
    # The degrade record: fixed enum reason, closed keys.
    assert _degraded_members(fake) == [
        {"seq": 2, "venue": "bybit", "reason": "reconstruction_failed"},
    ]
    # per_key visibility: the degraded member is present with honest zero coverage.
    per_key = headline["data_quality_flags"]["per_key"]
    seq2 = next(e for e in per_key if e["seq"] == 2)
    assert seq2["n_days"] == 0
    assert seq2["first_day"] is None and seq2["last_day"] is None
    # The stitched csv is the Deribit-only stitch — the Bybit member contributes
    # zero rows.
    written_dates = {
        r["date"]
        for table, payload, _ in fake.upserts
        if table == "csv_daily_returns" and isinstance(payload, list)
        for r in payload
    }
    assert written_dates == {"2024-01-01", "2024-01-02"}


@pytest.mark.asyncio
async def test_all_ccxt_composite_permanent_no_member_reconstructed() -> None:
    """HARD-05 honest floor: a 1-member all-ccxt composite (single OKX member) has
    ZERO reconstructable members → PERMANENT FAILED with a scrubbed 'no member could
    be reconstructed' stamp (never an empty invented 'complete' track record). The
    zero-member floor stays fail-loud."""
    fake = _FakeSupabase(members=[_member(1, "2024-01-01", None)])  # okx
    with _apply(_deribit_patches(
        fake,
        combine_returns=[],           # nothing reconstructs
        has_option_activity=True,
        preflight_side_effect=[_ctx("okx")],
    ) + _ccxt_fetch_patches(
        # The single okx member ATTEMPTS reconstruction and fails structurally →
        # degrades → clipped_cash empty → the zero-reconstructed floor fails PERMANENT.
        flows_raise=NavReconstructionError("unpriceable non-stable flow"),
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    # Terminal 'failed' analytics stamp (poller reaches a gate); the compute path
    # (csv_daily_returns) is never reached.
    failed_stamps = [
        payload
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
        and isinstance(payload, dict)
        and payload.get("computation_status") == "failed"
    ]
    assert failed_stamps, "all-ccxt composite must stamp a terminal failed row"
    assert not any(t == "csv_daily_returns" for t, _, _ in fake.upserts)


@pytest.mark.asyncio
async def test_degraded_members_drop_stale_on_all_deribit_restitch() -> None:
    """HARD-05 drop-stale heal (insufficient_window / mtm_gated_reason mirror): a
    stale degraded_members list seeded from a prior derive is POPPED when an
    all-Deribit re-stitch produces zero degraded members, while an unrelated seeded
    flag survives the merge. Neuter the else-branch pop → the stale list lingers."""
    fake = _FakeSupabase(
        members=[
            _member(1, "2024-01-01", "2024-02-01"),
            _member(2, "2024-02-01", None),
        ],
        existing_flags={
            "csv_source": True,
            "degraded_members": [   # stale from a prior mixed derive
                {"seq": 2, "venue": "bybit", "reason": "venue_reconstruction_unavailable"},
            ],
            "benchmark_unavailable": True,  # unrelated — must survive
        },
    )
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    headline = _headline_row(fake)
    assert headline is not None
    dq = headline["data_quality_flags"]
    assert "degraded_members" not in dq  # healed (drop-stale)
    assert dq.get("benchmark_unavailable") is True  # unrelated key preserved


@pytest.mark.asyncio
async def test_degraded_member_leak_discipline_closed_keys_no_magnitude() -> None:
    """HARD-05 leak discipline (T-93-03-01): the persisted degrade entry contains
    EXACTLY {seq, venue, reason} with reason the fixed literal code — no '$', no
    USD-looking magnitude, no exception text. Pins the closed-key contract so a
    future edit can't smuggle account-size or raw error text into the flag."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),   # deribit
        _member(2, "2024-02-01", None),           # binance — degrades
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],
        has_option_activity=True,
        preflight_side_effect=[_ctx("deribit"), _ctx("binance")],
    ) + _ccxt_fetch_patches(
        flows_raise=NavReconstructionError("unpriceable non-stable flow"),
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    entries = _degraded_members(fake)
    assert entries == [
        {"seq": 2, "venue": "binance", "reason": "reconstruction_failed"},
    ]
    for entry in entries:
        assert set(entry) == {"seq", "venue", "reason"}  # EXACTLY these keys
        assert entry["reason"] == "reconstruction_failed"  # fixed literal
        # No account-size / exception text anywhere in the entry values.
        blob = repr(entry)
        assert "$" not in blob
        # No stray digits beyond the seq int (venue/reason are alpha-only).
        assert not any(ch.isdigit() for ch in str(entry["venue"]))
        assert not any(ch.isdigit() for ch in str(entry["reason"]))


@pytest.mark.asyncio
async def test_mtm_runs_on_deribit_remainder_with_degraded_ccxt_member() -> None:
    """Plan-checker Note 1: the MTM pass DOES run when a composite mixes a perp-only
    Deribit member with a degraded ccxt member. The ccxt member is `continue`d before
    its signal is appended, so member_signals is Deribit-only → mark_to_market_available
    can return True → the MTM second pass reconstructs the Deribit-only remainder and
    both bases are written. (This falsifies the naive rationale that MTM never runs for
    a composite containing a ccxt member.)"""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),   # deribit, perp-only
        _member(2, "2024-02-01", None),           # bybit — degrades
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    # cash pass reconstructs seq1 (1 combine) then MTM pass reconstructs seq1 (1
    # combine) = 2 combine calls; seq2 degrades both passes (no combine).
    build_spy = AsyncMock(return_value=(_stub_ledger(), CompletenessReport(
        total_return_rows=2, indexable_currencies=frozenset({"BTC"}),
        has_option_activity=False,
    )))
    patches = _deribit_patches(
        fake,
        combine_returns=[(m1, {}), (m1, {})],
        has_option_activity=False,   # gate OPEN on the Deribit remainder
        preflight_side_effect=[
            _ctx("deribit"), _ctx("bybit"),   # cash pass
            _ctx("deribit"), _ctx("bybit"),   # MTM pass
        ],
    ) + _ccxt_fetch_patches(
        # bybit reconstruction fails structurally on BOTH passes → degrades both →
        # member_signals stays Deribit-only → MTM admits the perp-only remainder.
        flows_raise=NavReconstructionError("unpriceable non-stable flow"),
    )
    with _apply(patches), patch(
        "services.deribit_ingest.build_deribit_native_ledger", new=build_spy
    ):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    by_basis = _by_basis(fake)
    assert by_basis is not None
    assert set(by_basis) == {"cash_settlement", "mark_to_market"}
    # The degrade record still rides through (from the authoritative cash pass).
    assert _degraded_members(fake) == [
        {"seq": 2, "venue": "bybit", "reason": "reconstruction_failed"},
    ]


@pytest.mark.asyncio
async def test_unknown_venue_member_still_permanent_fail() -> None:
    """A member on a venue OUTSIDE _COMPOSITE_CRYPTO_VENUES (a truly unknown
    exchange) is a STRUCTURAL error, not a degradable one — it stays PERMANENT
    FAILED with a terminal stamp (the degrade channel is scoped to the known ccxt
    crypto venues)."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),   # deribit
        _member(2, "2024-02-01", None),           # kraken — unknown, structural fail
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],
        has_option_activity=True,
        preflight_side_effect=[_ctx("deribit"), _ctx("kraken")],
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    failed_stamps = [
        payload
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
        and isinstance(payload, dict)
        and payload.get("computation_status") == "failed"
    ]
    assert failed_stamps, "unknown-venue member must stamp a terminal failed row"


# --- Plan 93-04: honest ccxt member reconstruction (Option A) ------------------
# The FETCH primitives are mocked (offline, no live keys / network); the
# valuation/combine/terminus MATH runs REAL. Recent (within-retention) member
# windows keep the DQ-02 flow-coverage terminus a no-op so the byte-consistency
# reference is combine+clip exactly.

_CCXT_REALIZED = [
    _ccxt_realized("2026-06-01", 120.0),
    _ccxt_realized("2026-06-02", -60.0),
    _ccxt_realized("2026-06-03", 90.0),
]
_CCXT_FUNDING = [_ccxt_funding("2026-06-01", 20.0)]


@pytest.mark.asyncio
async def test_ccxt_member_reconstructs_and_joins_stitch() -> None:
    """Plan 93-04 Test 1 (Option A happy path): a 2-member composite (seq 1 Deribit
    + seq 2 Bybit) where the Bybit member RECONSTRUCTS honestly through the shared
    derive primitives (combine_realized_and_funding runs REAL over mocked fetches)
    joins the stitch: NO degraded_members flag, seq-2 per_key n_days > 0, and the
    persisted csv carries rows inside the Bybit member's window.

    RED on pre-Task-1 code: the ccxt arm degraded the member unconditionally →
    degraded_members present + seq-2 n_days == 0 + no 2026-06 csv rows."""
    fake = _FakeSupabase(members=[
        _member(1, "2026-05-01", "2026-05-10"),   # deribit
        _member(2, "2026-06-01", None),           # bybit — reconstructs
    ])
    m1 = _returns([("2026-05-01", 0.02), ("2026-05-02", 0.01)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],   # ONLY the deribit combine is mocked
        has_option_activity=True,     # gate CLOSED → single cash pass
        preflight_side_effect=[_ctx("deribit"), _ctx("bybit")],
    ) + _ccxt_fetch_patches(
        realized=_CCXT_REALIZED,
        funding=_CCXT_FUNDING,
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    headline = _headline_row(fake)
    assert headline is not None
    dq = headline["data_quality_flags"]
    # The reconstructed member is NOT degraded — the empty degrade list is popped.
    assert "degraded_members" not in dq
    # seq-2 contributes real coverage (n_days > 0).
    seq2 = next(e for e in dq["per_key"] if e["seq"] == 2)
    assert seq2["n_days"] > 0
    # The persisted csv carries rows inside the Bybit window (2026-06).
    written_dates = {
        r["date"]
        for table, payload, _ in fake.upserts
        if table == "csv_daily_returns" and isinstance(payload, list)
        for r in payload
    }
    assert any(d.startswith("2026-06") for d in written_dates)


@pytest.mark.asyncio
async def test_ccxt_reconstructed_series_byte_consistent_with_primitives() -> None:
    """Plan 93-04 Test 2 (research A3 / SC-4 byte-consistency pin): the seq-2 rows
    persisted THROUGH the stitch equal, at rtol 1e-12, a reference series computed
    in-test by calling combine_realized_and_funding DIRECTLY on the SAME fixture
    inputs then clipping with clip_to_window. A forked / silently-divergent
    orchestration goes RED here."""
    from services.broker_dailies import combine_realized_and_funding
    from services.ccxt_flows import ccxt_rows_to_dated_flows
    from services.stitch_composite import clip_to_window

    fake = _FakeSupabase(members=[
        _member(1, "2026-05-01", "2026-05-10"),   # deribit
        _member(2, "2026-06-01", None),           # bybit — reconstructs
    ])
    m1 = _returns([("2026-05-01", 0.02), ("2026-05-02", 0.01)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],
        has_option_activity=True,
        preflight_side_effect=[_ctx("deribit"), _ctx("bybit")],
    ) + _ccxt_fetch_patches(
        realized=_CCXT_REALIZED,
        funding=_CCXT_FUNDING,
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE

    # Reference: the derive primitives called DIRECTLY on the SAME inputs the helper
    # composed (mirroring _reconstruct_ccxt_member — terminus is a no-op for a
    # within-retention window, so combine+clip is the exact reference).
    ref_flows = ccxt_rows_to_dated_flows([], venue="bybit", price_index={})
    ref_returns, _ = combine_realized_and_funding(
        list(_CCXT_REALIZED),
        list(_CCXT_FUNDING),
        account_balance=10_000.0,
        balance_error=False,
        external_flows=ref_flows,
        open_unrealized_usd=0.0,
    )
    ref_clipped = clip_to_window(ref_returns, "2026-06-01", None)
    ref_map = {
        ts.date().isoformat(): float(v)
        for ts, v in ref_clipped.items()
        if pd.notna(v)
    }
    assert ref_map, "reference must contribute at least one seq-2 day"

    persisted = {
        r["date"]: r["daily_return"]
        for table, payload, _ in fake.upserts
        if table == "csv_daily_returns" and isinstance(payload, list)
        for r in payload
        if r["date"] >= "2026-06-01"
    }
    assert set(persisted) == set(ref_map), (
        f"seq-2 persisted days {sorted(persisted)} != reference {sorted(ref_map)}"
    )
    for day, ref_val in ref_map.items():
        assert persisted[day] == pytest.approx(ref_val, rel=1e-12, abs=0.0), (
            f"byte-consistency broke on {day}: {persisted[day]} != {ref_val}"
        )


@pytest.mark.asyncio
async def test_ccxt_structural_failure_degrades_stitch_is_deribit_only() -> None:
    """Plan 93-04 Test 3 (structural failure → degrade): the Bybit member's flow
    valuation raises NavReconstructionError → the composite completes
    complete_with_warnings, the degrade record carries reason `reconstruction_failed`,
    and the stitched csv is the Deribit-only series (the Bybit member contributes
    zero rows)."""
    fake = _FakeSupabase(members=[
        _member(1, "2026-05-01", "2026-05-10"),   # deribit
        _member(2, "2026-06-01", None),           # bybit — reconstruction raises
    ])
    m1 = _returns([("2026-05-01", 0.02), ("2026-05-02", 0.01)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],
        has_option_activity=True,
        preflight_side_effect=[_ctx("deribit"), _ctx("bybit")],
    ) + _ccxt_fetch_patches(
        realized=_CCXT_REALIZED,
        flows_raise=NavReconstructionError("unpriceable non-stable flow"),
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    headline = _headline_row(fake)
    assert headline is not None
    assert headline["computation_status"] == "complete_with_warnings"
    assert _degraded_members(fake) == [
        {"seq": 2, "venue": "bybit", "reason": "reconstruction_failed"},
    ]
    written_dates = {
        r["date"]
        for table, payload, _ in fake.upserts
        if table == "csv_daily_returns" and isinstance(payload, list)
        for r in payload
    }
    assert written_dates == {"2026-05-01", "2026-05-02"}  # deribit-only


@pytest.mark.asyncio
async def test_ccxt_rate_limit_is_transient_not_a_degrade() -> None:
    """Plan 93-04 Test 4 (transient passthrough): a 429 on the Bybit member crawl is
    a whole-job TRANSIENT retry (mirroring the deribit arm) — _stamp_429 is called and
    NO degrade record is persisted (a rate limit is not a member defect)."""
    import ccxt

    fake = _FakeSupabase(members=[
        _member(1, "2026-05-01", "2026-05-10"),   # deribit
        _member(2, "2026-06-01", None),           # bybit — 429 during crawl
    ])
    m1 = _returns([("2026-05-01", 0.02), ("2026-05-02", 0.01)])
    stamp_429 = AsyncMock()
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],
        has_option_activity=True,
        preflight_side_effect=[_ctx("deribit"), _ctx("bybit")],
    ) + _ccxt_fetch_patches(
        fetch_raise=ccxt.RateLimitExceeded("429 too many requests"),
    ) + [patch("services.job_worker._stamp_429", new=stamp_429)]):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"   # whole-job retry
    stamp_429.assert_awaited_once()
    # No terminal degrade / failed stamp persisted for a transient.
    assert not any(
        isinstance(payload, dict)
        and payload.get("data_quality_flags", {}).get("degraded_members")
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
    )


@pytest.mark.asyncio
async def test_ccxt_member_guard_flag_unions_into_merged_flags() -> None:
    """Plan 93-04 Test 5 (guard-flag union): the reconstructed Bybit member carries a
    NAV_TWR_GUARD_KEYS flag (unrealized_pnl_unreadable — MUST-2, stamped by the helper
    on an unreadable wedge over a trustworthy anchor) → the flag unions into
    merged_flags via the EXISTING per-member meta loop and the status is
    complete_with_warnings (no new wiring)."""
    fake = _FakeSupabase(members=[
        _member(1, "2026-05-01", "2026-05-10"),   # deribit
        _member(2, "2026-06-01", None),           # bybit — reconstructs with a guard
    ])
    m1 = _returns([("2026-05-01", 0.02), ("2026-05-02", 0.01)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],
        has_option_activity=True,
        preflight_side_effect=[_ctx("deribit"), _ctx("bybit")],
    ) + _ccxt_fetch_patches(
        # Healthy anchor ($10k, no balance_error, above dust) with an UNREADABLE
        # open-uPnL field → the helper's MUST-2 stamp fires unrealized_pnl_unreadable.
        equity=(10_000.0, False, 0.0, True),
        realized=_CCXT_REALIZED,
        funding=_CCXT_FUNDING,
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    headline = _headline_row(fake)
    assert headline is not None
    assert headline["computation_status"] == "complete_with_warnings"
    # The member's guard flag surfaced in merged_flags by construction.
    assert headline["data_quality_flags"].get("unrealized_pnl_unreadable") is True
    # It reconstructed (joined the stitch), not degraded.
    assert "degraded_members" not in headline["data_quality_flags"]


# --- Phase 93.1 hardening: MTM/cash degraded-set divergence + seam pins ---------


@pytest.mark.asyncio
async def test_mtm_cash_degraded_member_divergence_fails_transient() -> None:
    """Phase 93.1 FIX 1 (MTM/cash degraded-set invariant ENFORCED, not assumed):
    each of the cash and MTM passes re-crawls every member LIVE, so a ccxt member can
    degrade in the cash pass but momentarily RECONSTRUCT in the MTM re-crawl (a
    same-UTC-day price now cached). If that happens the MTM basis would be computed
    over a DIFFERENT member set than the cash headline while the factsheet says
    "Key N excluded" — mismatched bases. The job must now FAIL LOUD TRANSIENT on the
    divergence rather than ship the mismatch (a re-run re-crawls both passes
    consistently). RED before the fix: the job returned DONE with both bases written
    over divergent member sets.

    `_reconstruct_ccxt_member` is a closure (not module-patchable), so the divergence
    is injected at the REAL-math flow seam: `ccxt_rows_to_dated_flows` raises on the
    FIRST (cash-pass seq-2) call and succeeds on the SECOND (MTM-pass seq-2) call, so
    seq 2 degrades in cash but reconstructs in MTM."""
    from services.ccxt_flows import ccxt_rows_to_dated_flows as _real_flows

    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),   # deribit, perp-only → MTM gate OPEN
        _member(2, "2024-02-01", None),           # bybit — degrades cash, reconstructs MTM
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    _flows_calls = {"n": 0}

    def _flows_side_effect(rows: Any, *, venue: str, price_index: Any) -> Any:
        _flows_calls["n"] += 1
        if _flows_calls["n"] == 1:
            # Cash pass seq-2: a transient live-read failure → seq 2 degrades.
            raise NavReconstructionError("cash-pass transient unpriceable flow")
        # MTM pass seq-2: the re-crawl now succeeds → seq 2 reconstructs.
        return _real_flows(rows, venue=venue, price_index=price_index)

    patches = _deribit_patches(
        fake,
        combine_returns=[(m1, {}), (m1, {})],   # cash seq1 + MTM seq1
        has_option_activity=False,              # perp-only → MTM gate OPEN
        preflight_side_effect=[
            _ctx("deribit"), _ctx("bybit"),     # cash pass
            _ctx("deribit"), _ctx("bybit"),     # MTM pass
        ],
    ) + _ccxt_fetch_patches(
        realized=_CCXT_REALIZED,
        funding=_CCXT_FUNDING,
    ) + [
        patch(
            "services.ccxt_flows.ccxt_rows_to_dated_flows",
            new=MagicMock(side_effect=_flows_side_effect),
        ),
    ]
    with _apply(patches):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"    # retryable — re-crawl re-converges
    assert result.error_message is not None and "diverge" in result.error_message
    # Both flow seams were hit exactly once per pass (cash raised, MTM succeeded).
    assert _flows_calls["n"] == 2
    # Fail-loud is TERMINAL-STAMP-FREE (transient): no headline / degrade persisted.
    assert _headline_row(fake) is None
    assert not any(
        isinstance(payload, dict)
        and payload.get("computation_status") == "failed"
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
    )


@pytest.mark.asyncio
async def test_ccxt_byte_consistent_with_real_flows_and_terminus_segmentation() -> None:
    """Phase 93.1 FIX 3 (byte-consistency at the two bug-prone seams): the existing
    byte-consistency pin used ZERO external flows and a within-retention window
    (terminus no-op), so the `ccxt_rows_to_dated_flows → combine_realized_and_funding
    (external_flows=...)` seam and the DQ-02 flow-coverage terminus segmentation were
    NOT byte-pinned in the reconstruct direction. This case drives BOTH: a REAL priced
    (stablecoin) deposit near the retention floor (non-empty external flows) AND a
    past-retention window that actually triggers terminus segmentation, asserting the
    reconstructed member series persisted THROUGH the stitch equals a direct-primitive
    reference (combine → terminus → clip) at rtol 1e-12.

    Dates are computed RELATIVE to the live retention floor so the segmentation fires
    deterministically regardless of the wall-clock date (the reference and the
    production path both call the real `datetime.now`, so they agree by construction)."""
    from datetime import timezone
    from services.broker_dailies import combine_realized_and_funding
    from services.ccxt_flows import ccxt_rows_to_dated_flows
    from services.stitch_composite import clip_to_window
    from services.nav_twr import (
        apply_flow_coverage_terminus,
        flow_coverage_gap_evidence,
        flow_coverage_terminus_day,
        flow_retention_floor,
        negative_nav_guard_pre_terminus,
    )

    now_utc = datetime.now(timezone.utc)
    floor = flow_retention_floor("bybit", now_utc)   # tz-aware midnight, now − 365d
    assert floor is not None
    _iso = lambda ts: ts.date().isoformat()  # noqa: E731
    pre1 = floor - pd.Timedelta(days=40)   # past-retention → segmented away
    pre2 = floor - pd.Timedelta(days=30)
    post1 = floor + pd.Timedelta(days=20)  # within retention → survives
    post2 = floor + pd.Timedelta(days=40)
    dep_day = floor + pd.Timedelta(days=3)  # boundary flow (≤ floor+7) → gap evidence
    floor_iso = _iso(floor)

    my_realized = [
        _ccxt_realized(_iso(pre1), 120.0),
        _ccxt_realized(_iso(pre2), -60.0),
        _ccxt_realized(_iso(post1), 90.0),
        _ccxt_realized(_iso(post2), 30.0),
    ]
    deposit_row = {
        "id": "dep-boundary",
        "type": "deposit",
        "currency": "USDT",              # stablecoin → valued 1.0, no price index needed
        "amount": 500.0,
        "timestamp": _iso(dep_day) + "T12:00:00+00:00",
        "internal": None,
        "info": {},
    }
    window_start = _iso(pre1)

    fake = _FakeSupabase(
        members=[
            _member(1, "2020-01-01", "2020-02-01"),   # deribit, disjoint far-past window
            _member(2, window_start, None),           # bybit — reconstructs w/ segmentation
        ],
        # GEOMETRIC/calendar convention (no allocated-capital override): the terminus
        # segmentation introduces interior NaN chain-breaks, which the geometric compute
        # honours (the simple/arithmetic Zavara path correctly REFUSES them — F-5).
        strategy_row={
            "id": _STRATEGY_ID, "asset_class": "crypto",
            "returns_denominator_config": None,
        },
    )
    m1 = _returns([("2020-01-01", 0.02), ("2020-01-02", 0.01)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],
        has_option_activity=True,          # gate CLOSED → single cash pass
        preflight_side_effect=[_ctx("deribit"), _ctx("bybit")],
    ) + _ccxt_fetch_patches(
        realized=my_realized,
        deposits=[deposit_row],
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE

    # Reference: the derive primitives called DIRECTLY on the SAME inputs the helper
    # composed — combine (with REAL external flows) → the evidence-gated terminus →
    # clip — mirroring _reconstruct_ccxt_member's exact sequence.
    ref_flows = ccxt_rows_to_dated_flows([deposit_row], venue="bybit", price_index={})
    assert ref_flows, "the external-flows seam must carry a real priced deposit"
    ref_returns, ref_meta = combine_realized_and_funding(
        list(my_realized), [],
        account_balance=10_000.0, balance_error=False,
        external_flows=ref_flows, open_unrealized_usd=0.0,
    )
    _pre_seg_present = int(ref_returns.notna().sum())
    now_naive = now_utc.replace(tzinfo=None)
    start = flow_coverage_terminus_day(
        "bybit", first_return_day=ref_returns.index[0], now_utc=now_naive
    )
    assert start is not None, "window must extend before retention → terminus candidate"
    guard_pre = negative_nav_guard_pre_terminus(
        ref_returns, terminus=start,
        negative_nav_guard_fired=bool(ref_meta.get("negative_nav_guard")),
    )
    assert flow_coverage_gap_evidence(
        external_flows=ref_flows, retention_floor=floor,
        pre_terminus_nav_guard_fired=guard_pre,
    ), "boundary flow near the retention floor must be gap-coverage evidence"
    ref_seg, ref_flags = apply_flow_coverage_terminus(ref_returns, start)
    assert ref_flags.get("flow_coverage_incomplete"), "terminus must actually segment"
    assert int(ref_seg.notna().sum()) < _pre_seg_present, "segmentation must drop days"
    ref_clipped = clip_to_window(ref_seg, window_start, None)
    ref_map = {
        ts.date().isoformat(): float(v)
        for ts, v in ref_clipped.items()
        if pd.notna(v)
    }
    assert ref_map, "reference must contribute at least one post-terminus day"
    assert all(day >= floor_iso for day in ref_map), "pre-terminus days must be NaN'd"

    persisted = {
        r["date"]: r["daily_return"]
        for table, payload, _ in fake.upserts
        if table == "csv_daily_returns" and isinstance(payload, list)
        for r in payload
        if r["date"] >= floor_iso   # isolate the seq-2 post-terminus region
    }
    assert set(persisted) == set(ref_map), (
        f"seq-2 persisted days {sorted(persisted)} != reference {sorted(ref_map)}"
    )
    for day, ref_val in ref_map.items():
        assert persisted[day] == pytest.approx(ref_val, rel=1e-12, abs=0.0), (
            f"byte-consistency broke on {day}: {persisted[day]} != {ref_val}"
        )


@pytest.mark.asyncio
async def test_ccxt_non_typed_reconstruction_bug_reraises_not_laundered_to_degrade() -> None:
    """Phase 93.1 FIX 4 (Rule 9 — the load-bearing anti-laundering guarantee): a
    GENUINE non-typed bug from `_reconstruct_ccxt_member` (a KeyError / AttributeError /
    generic ValueError — NOT a `_PERMANENT_LEDGER_ERRORS` member and NOT a 429/geo
    transient) must RE-RAISE (surface for classification), NEVER be laundered into a
    silent `reconstruction_failed` degrade that ships a wrong-but-quiet composite.

    `_reconstruct_ccxt_member` is a closure, so the non-typed bug is injected at a
    fetch primitive (the equity read raises `KeyError`); it propagates through the
    helper into the degrade routing, which catches ONLY the typed structural set and
    the 429/geo transients — a KeyError falls through `is_geo_blocked` (False) to the
    bare `raise`. RED-if-neutered: broadening the degrade `except` to `Exception`
    would launder this into a degrade → the job would return DONE and this
    `pytest.raises(KeyError)` would fail."""
    fake = _FakeSupabase(members=[
        _member(1, "2026-05-01", "2026-05-10"),   # deribit
        _member(2, "2026-06-01", None),           # bybit — equity read raises KeyError
    ])
    m1 = _returns([("2026-05-01", 0.02), ("2026-05-02", 0.01)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],
        has_option_activity=True,
        preflight_side_effect=[_ctx("deribit"), _ctx("bybit")],
    ) + _ccxt_fetch_patches(
        fetch_raise=KeyError("genuine non-typed reconstruction bug"),
    )):
        with pytest.raises(KeyError):
            await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    # NOT laundered: no reconstruction_failed degrade, no terminal failed stamp.
    assert not any(
        isinstance(payload, dict)
        and (
            payload.get("data_quality_flags", {}).get("degraded_members")
            or payload.get("computation_status") == "failed"
        )
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
    )


@pytest.mark.asyncio
async def test_ccxt_empty_reconstruction_degrades_insufficient_history_no_crash() -> None:
    """Phase 93.1 red-team HIGH FIX A: a ccxt member whose honest reconstruction
    yields an EMPTY series (brand-new / inactive account: no realized, no funding, no
    flows) must DEGRADE with reason `insufficient_history` — NOT crash the whole
    (healthy Deribit) composite, and NOT join the stitch as a silent 0-day 'complete'
    member. Mirrors the single-key derive short-circuit (run_derive_broker_dailies_job
    :2558) the composite ccxt arm previously omitted.

    RED before the fix: the empty series (a RangeIndex, not a DatetimeIndex) reaches
    `clip_to_window` at the append site (OUTSIDE the try), whose `>=` against a
    Timestamp raises `TypeError` → the whole composite fails ('unknown' → retried to
    failed_final). GREEN after: the guard raises `_CcxtMemberDegrade` inside the
    helper so the empty series never reaches clip_to_window."""
    fake = _FakeSupabase(members=[
        _member(1, "2026-05-01", "2026-05-10"),   # deribit, healthy
        _member(2, "2026-06-01", None),           # bybit — empty reconstruction
    ])
    m1 = _returns([("2026-05-01", 0.02), ("2026-05-02", 0.01)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],
        has_option_activity=True,          # gate CLOSED → single cash pass
        preflight_side_effect=[_ctx("deribit"), _ctx("bybit")],
    ) + _ccxt_fetch_patches(
        realized=[],   # brand-new account: no trades, no funding, no flows
        funding=[],
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    # Did NOT crash / fail the whole composite — it completed with a warning.
    assert result.outcome == DispatchOutcome.DONE
    assert _degraded_members(fake) == [
        {"seq": 2, "venue": "bybit", "reason": "insufficient_history"},
    ]
    headline = _headline_row(fake)
    assert headline is not None
    assert headline["computation_status"] == "complete_with_warnings"
    # The degraded member shows honest zero coverage (not a silent 0-day 'complete').
    seq2 = next(e for e in headline["data_quality_flags"]["per_key"] if e["seq"] == 2)
    assert seq2["n_days"] == 0
    # Only the Deribit member contributed persisted rows.
    written_dates = {
        r["date"]
        for table, payload, _ in fake.upserts
        if table == "csv_daily_returns" and isinstance(payload, list)
        for r in payload
    }
    assert written_dates == {"2026-05-01", "2026-05-02"}


@pytest.mark.asyncio
async def test_ccxt_realized_empty_funding_present_degrades_not_fabricated() -> None:
    """Phase 93.1 red-team HIGH FIX B: a ccxt member with an EMPTY realized/closed-PnL
    trade stream but PRESENT funding rows (the Bybit-INVERSE gap — closed PnL is fetched
    category='linear' only, so inverse realized is invisible) must DEGRADE with reason
    `realized_stream_unavailable` — NOT reconstruct a fabricated funding-only track that
    joins the stitch as a 'covered' member while 100% of its trading PnL is absent.

    The funding spans 3 days so the fabricated series would PASS the FIX-A `< 2 days`
    guard (isolating FIX B). RED before the fix: realized-empty + funding-present
    reconstructed a funding-only series that JOINED (seq-2 n_days > 0, no degrade,
    status complete_with_warnings via `used_heuristic_capital` — which misdescribes a
    100%-missing-PnL member). GREEN after: it degrades visibly instead."""
    fake = _FakeSupabase(members=[
        _member(1, "2026-05-01", "2026-05-10"),   # deribit, healthy
        _member(2, "2026-06-01", None),           # bybit inverse — realized invisible
    ])
    m1 = _returns([("2026-05-01", 0.02), ("2026-05-02", 0.01)])
    funding_only = [
        _ccxt_funding("2026-06-01", 20.0),
        _ccxt_funding("2026-06-02", -8.0),
        _ccxt_funding("2026-06-03", 12.0),
    ]
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],
        has_option_activity=True,
        preflight_side_effect=[_ctx("deribit"), _ctx("bybit")],
    ) + _ccxt_fetch_patches(
        realized=[],              # inverse closed-PnL invisible (category='linear' gap)
        funding=funding_only,     # 3 funding days → would clear the FIX-A <2 guard
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert _degraded_members(fake) == [
        {"seq": 2, "venue": "bybit", "reason": "realized_stream_unavailable"},
    ]
    headline = _headline_row(fake)
    assert headline is not None
    assert headline["computation_status"] == "complete_with_warnings"
    # The fabricated funding-only member did NOT join the stitch: zero coverage, and
    # NO 2026-06 rows fabricated into csv_daily_returns.
    seq2 = next(e for e in headline["data_quality_flags"]["per_key"] if e["seq"] == 2)
    assert seq2["n_days"] == 0
    written_dates = {
        r["date"]
        for table, payload, _ in fake.upserts
        if table == "csv_daily_returns" and isinstance(payload, list)
        for r in payload
    }
    assert not any(d.startswith("2026-06") for d in written_dates)


@pytest.mark.asyncio
async def test_ccxt_insufficient_history_degrade_consistent_across_mtm_passes() -> None:
    """Phase 93.1 FIX A/B x FIX 1 interaction: a FIX-A `insufficient_history` degrade
    must be CONSISTENT across the cash AND MTM passes so it does NOT trip the FIX-1
    MTM/cash degraded-set divergence fail-loud. The ccxt reconstruction is
    basis-independent (both passes run the SAME fetches + combine + terminus), so a
    member that degrades in cash degrades identically in MTM → the seq-sets match →
    the divergence check passes and the composite completes complete_with_warnings.

    Perp-only Deribit remainder keeps the MTM gate OPEN (mark_to_market_available true
    on the Deribit-only member_signals), so the MTM second pass actually runs."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),   # deribit, perp-only → MTM gate OPEN
        _member(2, "2024-02-01", None),           # bybit — empty reconstruction (FIX A)
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {}), (m1, {})],   # cash seq1 + MTM seq1
        has_option_activity=False,              # perp-only → gate OPEN
        preflight_side_effect=[
            _ctx("deribit"), _ctx("bybit"),     # cash pass
            _ctx("deribit"), _ctx("bybit"),     # MTM pass
        ],
    ) + _ccxt_fetch_patches(realized=[], funding=[])):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    # Consistent degrade across both passes → NO divergence fail-loud (would be
    # error_kind='transient' with 'diverge' in the message).
    assert result.outcome == DispatchOutcome.DONE
    by_basis = _by_basis(fake)
    assert by_basis is not None and set(by_basis) == {"cash_settlement", "mark_to_market"}
    assert _degraded_members(fake) == [
        {"seq": 2, "venue": "bybit", "reason": "insufficient_history"},
    ]


@pytest.mark.asyncio
async def test_permanent_preflight_failure_stamps_terminal_failed() -> None:
    """Finding 4: a PERMANENT member-key preflight failure (missing / inactive key)
    used to `return ctx` WITHOUT stamping strategy_analytics — the wizard poller
    then spins on 'pending' forever. Post-fix a terminal 'failed' is stamped so the
    poller reaches a gate. Neuter (drop the stamp) → no failed row → this reddens."""
    from services.job_worker import DispatchResult

    fake = _FakeSupabase(members=[_member(1, "2024-01-01", None)])
    inactive = DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message="run_stitch_composite_job: api_key key-1 is inactive",
        error_kind="permanent",
    )
    with _apply(_deribit_patches(
        fake,
        combine_returns=[],
        has_option_activity=True,
        preflight_side_effect=[inactive],
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    failed_stamps = [
        payload
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
        and isinstance(payload, dict)
        and payload.get("computation_status") == "failed"
    ]
    assert failed_stamps, (
        "permanent preflight failure must stamp a terminal 'failed' analytics row"
    )


@pytest.mark.asyncio
async def test_member_permanent_failure_blocks_publish_terminal_failed() -> None:
    """PUB-01 (Phase 87) — the publish-blocking contract, made EXPLICIT.

    A >=2-member composite where an EARLIER member reconstructs cleanly but a
    LATER member fails PERMANENTLY mid-fan-out (missing / inactive key) must fail
    the WHOLE stitch_composite job loud-permanent and stamp a terminal
    computation_status='failed' — NEVER a partial 'complete' that would let the
    composite publish with a silently-holed member ("all-N complete or nothing").

    That 'failed' stamp IS what blocks publish: it is the terminal state
    isComputedAnalytics (src/lib/closed-sets.ts:263-266) REJECTS, so the admin
    approve gate (src/app/api/admin/strategy-review/route.ts) returns 400/409 and
    the composite can never reach strategies.status='published'. A HARD member
    failure resolves to 'failed' (computation_warned False), NOT
    'complete_with_warnings' (which is a terminal SUCCESS the gate admits).

    Distinct from test_permanent_preflight_failure_stamps_terminal_failed (a
    SINGLE-member preflight failure): here member seq-1 is fully reconstructed
    BEFORE the seq-2 failure, proving the fail-loud fires MID-fan-out — not only
    on an empty / first-member composite.

    Neuter (executed once in development, recorded in 87-03-SUMMARY): removing the
    `await _stamp_failed(...)` in the preflight-FAILED permanent branch
    (job_worker.py:3105-3108) drops the terminal 'failed' row → the failed_stamps
    scan finds nothing → this reddens, proving the WIRING, not just the helper."""
    from services.job_worker import DispatchResult

    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    # seq-2 preflight fails PERMANENT mid-fan-out (missing / inactive member key),
    # AFTER seq-1 has already preflighted + reconstructed successfully.
    inactive = DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message="run_stitch_composite_job: api_key key-2 is inactive",
        error_kind="permanent",
    )
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],  # only the seq-1 member reconstructs
        has_option_activity=True,     # gate CLOSED → single cash pass
        preflight_side_effect=[_ctx("deribit"), inactive],
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})

    # The WHOLE job fails loud-permanent — never a partial success.
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"

    # Exactly the terminal-failed publish-blocking stamp (the failed_stamps scan).
    failed_stamps = [
        payload
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
        and isinstance(payload, dict)
        and payload.get("computation_status") == "failed"
    ]
    assert failed_stamps, (
        "member permanent-failure must stamp a terminal 'failed' analytics row "
        "(the state isComputedAnalytics rejects — this blocks publish)"
    )
    stamp = failed_stamps[-1]
    # A HARD failure is 'failed', not warnings — computation_warned must be False,
    # else the gate would admit it as a terminal success.
    assert stamp.get("computation_warned") is False
    # The composite marker the worker writes onto the terminal stamp.
    assert stamp.get("data_quality_flags", {}).get("composite") is True

    # The compute / publish-eligible path was NEVER reached — no csv_daily_returns
    # write, so no 'complete' could ever be stamped for this holed composite.
    assert not any(t == "csv_daily_returns" for t, _, _ in fake.upserts)


@pytest.mark.asyncio
async def test_deferred_preflight_does_not_stamp_failed() -> None:
    """Finding 4 (converse): a DEFERRED preflight (circuit-breaker cooldown) is
    legitimately retryable and must NOT be stamped 'failed' — a premature terminal
    stamp would mask a recoverable condition and abort a re-runnable job."""
    from services.job_worker import DispatchResult

    fake = _FakeSupabase(members=[_member(1, "2024-01-01", None)])
    deferred = DispatchResult(outcome=DispatchOutcome.DEFERRED)
    with _apply(_deribit_patches(
        fake,
        combine_returns=[],
        has_option_activity=True,
        preflight_side_effect=[deferred],
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DEFERRED
    assert not any(
        isinstance(payload, dict) and payload.get("computation_status") == "failed"
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
    ), "a DEFERRED (retryable) preflight must not stamp a terminal failed row"


@pytest.mark.asyncio
async def test_simple_basis_interior_nan_guard_permanent_not_unclassified() -> None:
    """F-5: under the allocated-capital ('simple') convention, an interior NaN guard
    day makes compute_all_metrics raise a BARE ValueError (arithmetic Σr cannot
    honour a chain-break). classify_exception would bucket that 'unknown' → retries
    burn the attempt budget before the terminal gate. The composite must catch it
    and stamp PERMANENT failed. Neuter (drop the ValueError catch) → the ValueError
    escapes uncaught → this reddens (the raise propagates out of the job)."""
    # _FakeSupabase default strategy_row carries _TEST_CONFIG (simple / active_day).
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-01-05"),
        _member(2, "2024-01-10", None),
    ])
    # m1 has an interior guard day (Jan-02 = NaN) that survives gap_fill as a
    # chain break; the simple-basis compute rejects it.
    m1 = _returns([("2024-01-01", 0.02), ("2024-01-02", float("nan")), ("2024-01-03", 0.01)])
    m2 = _returns([("2024-01-10", 0.03), ("2024-01-11", -0.01)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        # Must NOT raise — a bare ValueError becomes a classified permanent.
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert any(
        isinstance(p, dict) and p.get("computation_status") == "failed"
        for _t, p, _c in fake.upserts
    ), "simple-basis interior-NaN composite must stamp a terminal failed row"


@pytest.mark.asyncio
async def test_member_count_above_cap_permanent_before_any_crawl() -> None:
    """Finding 8: a composite whose member count exceeds the derive-timeout cap
    (4 for the default 20-min budget) would deterministically exceed the FIXED
    stitch_composite timeout and be retried FOREVER as 'transient'. It must fail
    LOUD PERMANENT with a terminal stamp BEFORE any exchange crawl. Neuter (drop
    the cap) → the job proceeds to crawl N members → this reddens (build called)."""
    from services.job_worker import _composite_max_members

    cap = _composite_max_members()
    fake = _FakeSupabase(members=[
        _member(i, f"2024-{i:02d}-01", f"2024-{i:02d}-15")
        for i in range(1, cap + 2)  # cap + 1 members (disjoint monthly windows)
    ])
    build_spy = AsyncMock(return_value=(_stub_ledger(), CompletenessReport()))
    patches = _deribit_patches(fake, combine_returns=[], has_option_activity=False)
    with _apply(patches), patch(
        "services.deribit_ingest.build_deribit_native_ledger", new=build_spy
    ):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    build_spy.assert_not_called()  # capped BEFORE any crawl
    failed_stamps = [
        payload
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
        and isinstance(payload, dict)
        and payload.get("computation_status") == "failed"
    ]
    assert failed_stamps, "over-cap composite must stamp a terminal failed row"


@pytest.mark.asyncio
async def test_dispatch_routes_stitch_composite_kind() -> None:
    """dispatch(kind='stitch_composite') routes to run_stitch_composite_job."""
    from services.job_worker import DispatchResult, dispatch

    handler = AsyncMock(
        return_value=DispatchResult(outcome=DispatchOutcome.DONE)
    )
    with patch("services.job_worker.run_stitch_composite_job", new=handler):
        result = await dispatch(
            {"kind": "stitch_composite", "strategy_id": _STRATEGY_ID}
        )
    handler.assert_awaited_once()
    assert result.outcome == DispatchOutcome.DONE


def test_no_verification_or_publish_status_write_source_scan() -> None:
    """M-3: run_stitch_composite_job must NEVER advance verification/publish
    status (no composite GA before Phase 87's gate). Source scan of the function
    body — reintroducing a verification_status / published write reddens."""
    import inspect

    src = inspect.getsource(run_stitch_composite_job)
    assert "verification_status" not in src
    assert "published" not in src


# ---------------------------------------------------------------------------
# M-2 — _stamp_failed read-modify-write preserves a published composite's mask
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stamp_failed_preserves_published_composite_coverage_mask() -> None:
    """M-2: keys/sync re-enqueues stitch_composite for an ALREADY-published
    composite on owner resync. A re-derive FAILURE stamps computation_status=
    'failed' but the live metrics_json_by_basis survives and keeps rendering the
    public factsheet. The old _stamp_failed wrote {csv_source, composite}
    WHOLESALE — dropping the live coverage-mask keys (per_key / gap_spans /
    gap_day_count / overlap_days / mtm_gated_reason) → deriveSegmentMarkers
    returns empty → real gap days render with NO FS-02 missing-segment
    annotation (no-invented-data regression). Post-fix _stamp_failed is
    read-modify-write: it MERGES the composite markers over the existing flags,
    preserving the mask. Neuter (restore the wholesale replace) → the mask keys
    vanish from the failed stamp → this reddens."""
    from services.job_worker import DispatchResult

    # A published composite's live coverage mask (what a prior successful derive
    # persisted onto data_quality_flags).
    live_mask = {
        "csv_source": True,
        "composite": True,
        "per_key": {"key-1": {"present": 40, "gap": 3}},
        "gap_spans": [["2024-01-10", "2024-01-12"]],
        "gap_day_count": 3,
        "overlap_days": 0,
        "mtm_gated_reason": "option_activity",
    }
    fake = _FakeSupabase(
        members=[_member(1, "2024-01-01", None)],
        existing_flags=live_mask,
    )
    # A PERMANENT re-derive failure (missing / inactive member key) drives
    # _stamp_failed on this published-composite row.
    inactive = DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message="run_stitch_composite_job: api_key key-1 is inactive",
        error_kind="permanent",
    )
    with _apply(_deribit_patches(
        fake,
        combine_returns=[],
        has_option_activity=True,
        preflight_side_effect=[inactive],
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})

    assert result.outcome == DispatchOutcome.FAILED
    failed_stamps = [
        payload
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
        and isinstance(payload, dict)
        and payload.get("computation_status") == "failed"
    ]
    assert failed_stamps, "re-derive failure must stamp a terminal 'failed' row"
    dq = failed_stamps[-1]["data_quality_flags"]
    # The coverage mask survives the failure stamp (the whole point of M-2).
    assert dq.get("per_key") == {"key-1": {"present": 40, "gap": 3}}
    assert dq.get("gap_spans") == [["2024-01-10", "2024-01-12"]]
    assert dq.get("gap_day_count") == 3
    assert dq.get("overlap_days") == 0
    assert dq.get("mtm_gated_reason") == "option_activity"
    # The composite markers are still present too.
    assert dq.get("csv_source") is True
    assert dq.get("composite") is True


@pytest.mark.asyncio
async def test_stamp_failed_first_derive_no_existing_row_falls_back() -> None:
    """M-2 converse: a FIRST-derive failure (no existing strategy_analytics row /
    no flags) stamps just {csv_source, composite} — the read-modify-write falls
    back to the current behavior, byte-unchanged for the never-published case."""
    from services.job_worker import DispatchResult

    fake = _FakeSupabase(
        members=[_member(1, "2024-01-01", None)],
        existing_flags={},  # no prior derive
    )
    inactive = DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message="run_stitch_composite_job: api_key key-1 is inactive",
        error_kind="permanent",
    )
    with _apply(_deribit_patches(
        fake,
        combine_returns=[],
        has_option_activity=True,
        preflight_side_effect=[inactive],
    )):
        await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})

    failed_stamps = [
        payload
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
        and isinstance(payload, dict)
        and payload.get("computation_status") == "failed"
    ]
    assert failed_stamps
    dq = failed_stamps[-1]["data_quality_flags"]
    assert dq == {"csv_source": True, "composite": True}


# ---------------------------------------------------------------------------
# M-1 — composite member 429 handling (defer parent job + stamp rate-limit)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_member_cooldown_defers_parent_job_no_keyerror() -> None:
    """M-1 part 1: member_job must carry the PARENT job's `id` + `claim_token`.
    _allocator_key_preflight → _check_circuit_breaker → _defer reads job["id"] /
    job.get("claim_token"). A member key with a live last_429_at cooldown drives
    the REAL circuit-breaker defer; pre-fix member_job lacked `id`, so _defer
    raised KeyError('id') → the 429 was misclassified and RETRIED instead of
    DEFERRED. Post-fix the parent stitch job is deferred cleanly. Neuter (drop
    id/claim_token from member_job) → _defer raises KeyError → this reddens (the
    job raises instead of returning DEFERRED)."""
    from services.job_worker import _check_circuit_breaker

    fake = _FakeSupabase(members=[_member(1, "2024-01-01", None)])
    defer_calls: list[dict[str, Any]] = []

    def _rpc(name: str, args: dict[str, Any]) -> SimpleNamespace:
        fake.rpc_calls.append((name, args))
        data: Any = None
        if name == "api_key_cooldown_remaining":
            data = 30  # live cooldown → circuit breaker trips
        elif name == "defer_compute_job":
            defer_calls.append(args)
        return SimpleNamespace(execute=lambda d=data: SimpleNamespace(data=d))

    fake.rpc = _rpc  # type: ignore[assignment]

    captured_jobs: list[dict[str, Any]] = []

    async def _preflight(job: dict[str, Any], handler_name: str) -> Any:
        # Exercise the REAL circuit-breaker path with the member_job the composite
        # built. A member key row carrying a live last_429_at trips the breaker.
        captured_jobs.append(job)
        key_row = {
            "id": "key-1",
            "exchange": "deribit",
            "last_429_at": "2024-01-01T00:00:00Z",
        }
        result = await _check_circuit_breaker(fake, job, key_row)
        return result if result is not None else _ctx("deribit")

    with _apply([
        patch("services.job_worker.get_supabase", new=MagicMock(return_value=fake)),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
        patch("services.job_worker._allocator_key_preflight", new=_preflight),
    ]):
        # No KeyError: the parent stitch job is deferred cleanly.
        result = await run_stitch_composite_job({
            "strategy_id": _STRATEGY_ID,
            "id": "job-parent-1",
            "claim_token": "tok-abc",
        })

    assert result.outcome == DispatchOutcome.DEFERRED
    # member_job carried the PARENT job's id + claim_token.
    assert captured_jobs, "preflight must have been invoked for the member"
    member_job = captured_jobs[0]
    assert member_job.get("id") == "job-parent-1"
    assert member_job.get("claim_token") == "tok-abc"
    # _defer fired against the PARENT job id (no KeyError, correct fencing).
    assert defer_calls, "the circuit breaker must have deferred the parent job"
    assert defer_calls[0]["p_job_id"] == "job-parent-1"
    assert defer_calls[0]["p_claim_token"] == "tok-abc"


@pytest.mark.asyncio
async def test_member_crawl_rate_limited_stamps_429_and_transient() -> None:
    """M-1 part 2: a member crawl raising ccxt.RateLimitExceeded must stamp
    api_keys.last_429_at for the MEMBER key (so the circuit breaker defers
    sibling jobs during the exchange cooldown) and classify the failure
    TRANSIENT. Pre-fix the member `except Exception` had NO RateLimitExceeded arm,
    so _stamp_429 was NEVER called on a member crawl (every other exchange-
    touching handler stamps it). Neuter (drop the new arm) → _stamp_429 uncalled
    (and the 429 re-raises unstamped) → this reddens."""
    import ccxt

    fake = _FakeSupabase(members=[_member(1, "2024-01-01", None)])
    stamp_spy = AsyncMock()
    with _apply(_deribit_patches(
        fake, combine_returns=[], has_option_activity=True,
    )), patch(
        "services.deribit_ingest.build_deribit_native_ledger",
        new=AsyncMock(side_effect=ccxt.RateLimitExceeded("429 too many requests")),
    ), patch(
        "services.job_worker._stamp_429", new=stamp_spy,
    ):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})

    # The 429 is classified TRANSIENT (retryable), not raised uncaught.
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    # _stamp_429 was invoked for the MEMBER key (default _ctx key_row id=key-x).
    stamp_spy.assert_awaited_once()
    stamped_key_row = stamp_spy.await_args.args[1]
    assert stamped_key_row["id"] == "key-x"


# ---------------------------------------------------------------------------
# Phase 92 HARD-01 (Layer 3) — worker persist on the P&L-dominated blow-up
# ledger, through the REAL native reconstruction (combine_native_ledger is NOT
# mocked here, unlike the other tests) so the pnl_dominated_guard source fix
# actually FIRES and its effect reaches persistence. denominator_config is None
# (returns_denominator_config=None) → the native path
# reconstruct_native_nav_and_twr → the guard. All quantities synthetic (T-92-01);
# fully offline (_FakeSupabase + patched crawl, no live DB / creds — Pitfall 6).
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_blowup_member_persists_finite_series_and_plausible_contribution() -> None:
    """The blow-up NativeLedger, driven through the worker's REAL native
    reconstruction (no combine_native_ledger mock), persists ONLY finite
    csv_daily_returns (the guarded ~17x/day day is ABSENT), a plausible per-key
    contribution compound, finite by-basis headline scalars, and lifts
    pnl_dominated_guard into data_quality_flags with a complete_with_warnings
    status.

    Mutation-honest: reverting the source guard re-admits day 3 (r ≈ 17.33) →
    the persisted rows carry it (reddens the |r| < PNL_DOM_RATIO and the < 5.0
    asserts), the contribution compound jumps from ~0.15 to ~21 (reddens < 10),
    and pnl_dominated_guard never lifts (reddens the flag/status asserts)."""
    import math

    from services.deribit_ingest import CompletenessReport
    from services.nav_twr import PNL_DOM_RATIO
    from tests.test_native_nav import _pnl_dominated_blowup_ledger

    fake = _FakeSupabase(
        members=[_member(1, "2024-01-01", None)],
        strategy_row={
            "id": _STRATEGY_ID,
            "asset_class": "crypto",
            # None → combine_native_ledger takes the NAV reconstruction path (the
            # blow-up path, research §a), NOT the allocated-capital branch.
            "returns_denominator_config": None,
        },
    )
    report = CompletenessReport(
        total_return_rows=7,
        indexable_currencies=frozenset({"BTC"}),
        has_option_activity=True,  # gate CLOSED → a single cash pass
    )
    # NOTE: combine_native_ledger is deliberately NOT patched — the REAL native
    # core runs so the pnl_dominated_guard actually fires on the blow-up ledger.
    patches = [
        patch("services.job_worker.get_supabase", new=MagicMock(return_value=fake)),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
        patch(
            "services.job_worker._allocator_key_preflight",
            new=AsyncMock(return_value=_ctx("deribit")),
        ),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.deribit_ingest.fetch_deribit_native_account_state",
            new=AsyncMock(return_value=MagicMock(
                balance_error=False, native_equity={"BTC": 0.567},
            )),
        ),
        patch(
            "services.deribit_ingest.build_deribit_native_ledger",
            new=AsyncMock(return_value=(_pnl_dominated_blowup_ledger(), report)),
        ),
        patch("services.deribit_ingest.assert_ledger_complete", new=MagicMock()),
        patch(
            "services.analytics_runner.run_csv_strategy_analytics",
            new=AsyncMock(return_value={"status": "complete"}),
        ),
        patch(
            "services.benchmark.get_benchmark_returns",
            new=AsyncMock(return_value=(None, True)),
        ),
    ]
    with _apply(patches):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE

    # (a) every persisted csv_daily_returns row is finite with |r| < PNL_DOM_RATIO
    # — the guarded ~17x/day day is NaN → honestly ABSENT, never written.
    csv_rows = [
        row
        for table, payload, _ in fake.upserts
        if table == "csv_daily_returns" and isinstance(payload, list)
        for row in payload
    ]
    assert csv_rows, "the stitched series must reach csv_daily_returns persistence"
    persisted = [float(r["daily_return"]) for r in csv_rows]
    assert all(math.isfinite(r) for r in persisted)
    assert all(abs(r) < PNL_DOM_RATIO for r in persisted)
    assert not any(abs(r) >= 5.0 for r in persisted)  # the exploded day is gone

    # (b) the geometric compound Π(1+r)−1 of the persisted rows — the exact
    # compositeAttribution per-key contribution basis (research §a) — is plausible
    # (< 10, i.e. < 1,000%), versus the live +1,489,363.8%. Pre-fix ≈ 21.
    compound = 1.0
    for r in persisted:
        compound *= 1.0 + r
    compound -= 1.0
    assert compound < 10.0

    # (c) metrics_json_by_basis["cash_settlement"] headline scalars are finite.
    by_basis = _by_basis(fake)
    assert by_basis is not None and "cash_settlement" in by_basis
    cash = by_basis["cash_settlement"]
    assert cash["cumulative_return"] is not None and math.isfinite(
        cash["cumulative_return"]
    )
    assert cash["cagr"] is not None and math.isfinite(cash["cagr"])

    # (d) data_quality_flags carries pnl_dominated_guard (the NAV_TWR_GUARD_KEYS
    # member lift) and computation_status is complete_with_warnings.
    analytics = [
        payload
        for table, payload, _ in fake.upserts
        if table == "strategy_analytics"
        and isinstance(payload, dict)
        and "data_quality_flags" in payload
    ]
    assert analytics, "a strategy_analytics headline row must be upserted"
    final = analytics[-1]
    assert final["data_quality_flags"].get("pnl_dominated_guard") is True
    assert final["computation_status"] == "complete_with_warnings"


# ---------------------------------------------------------------------------
# HARD-03 (#69 / Phase-90 LOW-2) — persist the RAW cumulative_method into
# data_quality_flags at stitch so the factsheet read-path can PREFER the frozen
# method over a live re-derive (chart↔headline drift kill). The persisted value
# is the WORKER vocabulary ("geometric"|"simple"), NEVER the resolved read-path
# basis ("arithmetic"/"geometric") — the "simple"→"arithmetic" map lives in
# exactly ONE place (the read side), so persisted and live-fallback share one
# rule and cannot diverge (research Pitfall 1).
# ---------------------------------------------------------------------------

def _persisted_dqf(fake: "_FakeSupabase") -> dict[str, Any]:
    """The data_quality_flags from the last strategy_analytics headline upsert."""
    for table, payload, _ in reversed(fake.upserts):
        if (
            table == "strategy_analytics"
            and isinstance(payload, dict)
            and "data_quality_flags" in payload
        ):
            return dict(payload["data_quality_flags"])
    raise AssertionError("no strategy_analytics headline upsert with DQ flags")


@pytest.mark.asyncio
async def test_persists_cumulative_method_geometric_for_null_config() -> None:
    """HARD-03: a default stitch (returns_denominator_config None → method
    "geometric") persists data_quality_flags["cumulative_method"] == "geometric".
    RED without the merged_flags["cumulative_method"] line (key absent)."""
    fake = _FakeSupabase(
        members=[
            _member(1, "2024-01-01", "2024-02-01"),
            _member(2, "2024-02-01", None),
        ],
        strategy_row={
            "id": _STRATEGY_ID,
            "asset_class": "crypto",
            "returns_denominator_config": None,  # → cumulative_method "geometric"
        },
    )
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert _persisted_dqf(fake)["cumulative_method"] == "geometric"


@pytest.mark.asyncio
async def test_persists_cumulative_method_simple_for_allocated_config() -> None:
    """HARD-03: a stitch whose strategies row carries returns_denominator_config
    with cumulative_method "simple" (the allocated-capital / Zavara override)
    persists data_quality_flags["cumulative_method"] == "simple" — the RAW worker
    string, NOT the resolved "arithmetic" read-path basis."""
    # Default _FakeSupabase strategy_row uses _TEST_CONFIG (cumulative_method
    # "simple"), so no override is needed.
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert _persisted_dqf(fake)["cumulative_method"] == "simple"


@pytest.mark.asyncio
async def test_persisted_cumulative_method_is_raw_worker_vocabulary() -> None:
    """HARD-03 Pitfall-1 vocabulary pin: whatever the config, the persisted value
    is the RAW worker enum ∈ {"geometric","simple"} and is NEVER the resolved
    read-path basis "arithmetic" — the translation belongs to the read side alone."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        result = await run_stitch_composite_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    persisted = _persisted_dqf(fake)["cumulative_method"]
    assert persisted in {"geometric", "simple"}
    assert persisted != "arithmetic"


# ---------------------------------------------------------------------------
# PROG-02 (plan 95-02) — TestMemberProgress: the worker publishes per-member
# stitch progress into compute_jobs.metadata via the claim-token-fenced
# set_compute_job_progress RPC, cash-pass-only, fail-open, secretless.
# ---------------------------------------------------------------------------

_PROG_JOB = {"strategy_id": _STRATEGY_ID, "id": "job-prog-1", "claim_token": "tok-prog-1"}

# The five ciphertext key names that must NEVER reach a progress payload (WIZ-01).
_FORBIDDEN_KEYS = frozenset({
    "api_key_encrypted", "api_secret_encrypted", "passphrase_encrypted",
    "dek_encrypted", "nonce",
})


def _ctx_secretful(exchange: str = "deribit", label: str | None = None) -> MagicMock:
    """A preflight ctx whose key_row mirrors the REAL api_keys row shape — it
    carries every ciphertext field. The worker must build progress entries
    FIELD-BY-FIELD and never spread this row (Test 5 proves no leak)."""
    ctx = MagicMock()
    ctx.exchange = AsyncMock()
    ctx.supabase = MagicMock()
    ctx.strategy_row = None
    key_row: dict[str, Any] = {
        "id": f"key-{exchange}",
        "user_id": "owner-1",
        "exchange": exchange,
        "api_key_encrypted": "CIPHERTEXT_KEY",
        "api_secret_encrypted": "CIPHERTEXT_SECRET",
        "passphrase_encrypted": "CIPHERTEXT_PASS",
        "dek_encrypted": "CIPHERTEXT_DEK",
        "nonce": "CIPHERTEXT_NONCE",
    }
    if label is not None:
        key_row["label"] = label
    ctx.key_row = key_row
    return ctx


def _progress_payloads(fake: _FakeSupabase) -> list[list[dict[str, Any]]]:
    """The p_progress array of every set_compute_job_progress RPC, in order."""
    return [
        args["p_progress"]
        for name, args in fake.rpc_calls
        if name == "set_compute_job_progress"
    ]


def _progress_calls(fake: _FakeSupabase) -> list[tuple[str, dict[str, Any]]]:
    return [(n, a) for n, a in fake.rpc_calls if n == "set_compute_job_progress"]


def _status_track(payloads: list[list[dict[str, Any]]], seq: int) -> list[str]:
    return [next(e for e in p if e["seq"] == seq)["status"] for p in payloads]


def _walk_keys(obj: Any) -> set[str]:
    """Every dict key appearing at ANY depth in a JSON-ish structure."""
    keys: set[str] = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            keys.add(str(k))
            keys |= _walk_keys(v)
    elif isinstance(obj, (list, tuple)):
        for it in obj:
            keys |= _walk_keys(it)
    return keys


@pytest.mark.asyncio
async def test_member_progress_writes_are_fenced_with_job_id_and_token() -> None:
    """Test 1: every set_compute_job_progress RPC carries p_job_id == job['id']
    and p_claim_token == job['claim_token'] (the fence the RPC enforces)."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    with _apply(_deribit_patches(
        fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        result = await run_stitch_composite_job(dict(_PROG_JOB))
    assert result.outcome == DispatchOutcome.DONE
    calls = _progress_calls(fake)
    assert calls, "expected the worker to publish member progress"
    for _name, args in calls:
        assert args["p_job_id"] == _PROG_JOB["id"]
        assert args["p_claim_token"] == _PROG_JOB["claim_token"]


@pytest.mark.asyncio
async def test_member_progress_payload_sequence_waiting_to_successful() -> None:
    """Test 2: first write is all-waiting; then per seq ascending an in_process
    then a successful write; the final payload is all-successful and the
    successful entry carries the resolved exchange + label."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {}), (m2, {})],
        has_option_activity=True,  # gate CLOSED → single cash pass
        preflight_side_effect=[
            _ctx_secretful("deribit", label="Main account"),
            _ctx_secretful("deribit", label=None),
        ],
    )):
        result = await run_stitch_composite_job(dict(_PROG_JOB))
    assert result.outcome == DispatchOutcome.DONE
    payloads = _progress_payloads(fake)
    # First write: every member waiting, exchange/label still null.
    assert payloads[0] == [
        {"seq": 1, "exchange": None, "label": None, "status": "waiting"},
        {"seq": 2, "exchange": None, "label": None, "status": "waiting"},
    ]
    # seq 1 advances waiting → in_process → successful, then stays successful.
    assert _status_track(payloads, 1) == [
        "waiting", "in_process", "successful", "successful", "successful",
    ]
    # seq 2 stays waiting until its turn, then in_process → successful.
    assert _status_track(payloads, 2) == [
        "waiting", "waiting", "waiting", "in_process", "successful",
    ]
    # Final payload: all successful, with resolved exchange + label backfilled.
    final = payloads[-1]
    assert all(e["status"] == "successful" for e in final)
    seq1 = next(e for e in final if e["seq"] == 1)
    assert seq1["exchange"] == "deribit"
    assert seq1["label"] == "Main account"
    seq2 = next(e for e in final if e["seq"] == 2)
    assert seq2["exchange"] == "deribit"
    assert seq2["label"] is None  # no label on the api_keys row → stays null


@pytest.mark.asyncio
async def test_member_progress_degraded_member_marked_degraded() -> None:
    """Test 3: a degraded ccxt member ends status 'degraded' for its seq while
    the reconstructable Deribit member ends 'successful'."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),   # deribit — reconstructs
        _member(2, "2024-02-01", None),           # bybit — degrades
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {})],   # only the Deribit member reconstructs
        has_option_activity=True,     # single cash pass
        preflight_side_effect=[_ctx_secretful("deribit"), _ctx_secretful("bybit")],
    ) + _ccxt_fetch_patches(
        flows_raise=NavReconstructionError("unpriceable non-stable flow"),
    )):
        result = await run_stitch_composite_job(dict(_PROG_JOB))
    assert result.outcome == DispatchOutcome.DONE
    final = _progress_payloads(fake)[-1]
    seq1 = next(e for e in final if e["seq"] == 1)
    seq2 = next(e for e in final if e["seq"] == 2)
    assert seq1["status"] == "successful"
    assert seq2["status"] == "degraded"
    assert seq2["exchange"] == "bybit"


@pytest.mark.asyncio
async def test_member_progress_not_written_on_mtm_second_pass() -> None:
    """Test 4 (SC-4 pass-scoping / Pitfall 1): with the MTM second pass
    admissible, progress is written ONLY on the cash pass — the per-member
    counter never restarts. For a 2-member run: 1 all-waiting + 2×(in_process,
    successful) = 5 writes, and the MTM pass adds ZERO."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    build_spy = AsyncMock(return_value=(_stub_ledger(), CompletenessReport(
        total_return_rows=2, indexable_currencies=frozenset({"BTC"}),
        has_option_activity=False,
    )))
    patches = _deribit_patches(
        fake,
        # cash pass (m1, m2) THEN MTM pass (m1, m2) → 4 combine calls.
        combine_returns=[(m1, {}), (m2, {}), (m1, {}), (m2, {})],
        has_option_activity=False,  # gate OPEN → MTM second pass runs
    )
    with _apply(patches), patch(
        "services.deribit_ingest.build_deribit_native_ledger", new=build_spy
    ):
        result = await run_stitch_composite_job(dict(_PROG_JOB))
    assert result.outcome == DispatchOutcome.DONE
    payloads = _progress_payloads(fake)
    # Exactly the cash-pass write count — the MTM pass is report_progress=False.
    assert len(payloads) == 5, (
        f"expected 5 cash-pass-only progress writes, got {len(payloads)} — the "
        "MTM pass leaked progress writes (counter restart, Pitfall 1)"
    )
    assert all(e["status"] == "successful" for e in payloads[-1])


@pytest.mark.asyncio
async def test_member_progress_never_leaks_ciphertext() -> None:
    """Test 5 (WIZ-01 secretless boundary): no progress payload contains any of
    the five ciphertext key names at ANY depth, even though the preflight ctx
    key_row carries all of them."""
    fake = _FakeSupabase(members=[
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ])
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    with _apply(_deribit_patches(
        fake,
        combine_returns=[(m1, {}), (m2, {})],
        has_option_activity=True,
        preflight_side_effect=[
            _ctx_secretful("deribit", label="k1"),
            _ctx_secretful("deribit", label="k2"),
        ],
    )):
        result = await run_stitch_composite_job(dict(_PROG_JOB))
    assert result.outcome == DispatchOutcome.DONE
    payloads = _progress_payloads(fake)
    assert payloads, "expected progress writes to assert secretlessness against"
    for payload in payloads:
        leaked = _FORBIDDEN_KEYS & _walk_keys(payload)
        assert not leaked, f"progress payload leaked ciphertext keys: {leaked}"


@pytest.mark.asyncio
async def test_member_progress_write_failure_is_fail_open() -> None:
    """Test 6 (fail-open): when set_compute_job_progress raises, the stitch still
    completes with the SAME DispatchResult and the SAME by-basis metrics as the
    happy path — a progress-write blip must never kill a 20-minute stitch."""
    members = [
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ]
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])

    # Baseline: progress writes succeed.
    fake_ok = _FakeSupabase(members=[dict(m) for m in members])
    with _apply(_deribit_patches(
        fake_ok, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        result_ok = await run_stitch_composite_job(dict(_PROG_JOB))

    # Fault-injected: every set_compute_job_progress .execute() raises.
    fake_fail = _FakeSupabase(
        members=[dict(m) for m in members],
        raise_on_rpc="set_compute_job_progress",
    )
    with _apply(_deribit_patches(
        fake_fail, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
    )):
        result_fail = await run_stitch_composite_job(dict(_PROG_JOB))

    assert result_ok.outcome == DispatchOutcome.DONE
    assert result_fail.outcome == result_ok.outcome
    # The progress RPC WAS attempted (and raised) — proving the fail-open path ran.
    assert _progress_calls(fake_fail), "expected the worker to attempt a progress write"
    # The authoritative output is byte-identical to the happy path.
    assert _by_basis(fake_fail) == _by_basis(fake_ok)


class _FailFirstNProgress(_FakeSupabase):
    """A fake that raises on the FIRST ``fail_n`` set_compute_job_progress writes
    then succeeds — so a test can exercise a SINGLE transient blip (streak resets)
    vs a persistent outage. All other RPCs succeed."""

    def __init__(self, *, members: list[dict[str, Any]], fail_n: int) -> None:
        super().__init__(members=members)
        self._fail_n = fail_n
        self._prog_attempts = 0

    def rpc(self, name: str, args: dict[str, Any]) -> SimpleNamespace:
        self.rpc_calls.append((name, args))
        if name == "set_compute_job_progress":
            self._prog_attempts += 1
            if self._prog_attempts <= self._fail_n:
                def _boom() -> SimpleNamespace:
                    raise RuntimeError("simulated transient progress failure")
                return SimpleNamespace(execute=_boom)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=None))


@pytest.mark.asyncio
async def test_member_progress_persistent_outage_escalates_to_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """SF-2b: N CONSECUTIVE set_compute_job_progress failures within one stitch
    escalate from warning to error-level (a systemic frozen-heartbeat outage is
    visible, not buried). Stays fail-open — the stitch still completes."""
    from services.job_worker import _MEMBER_PROGRESS_MAX_CONSECUTIVE_FAILURES

    members = [
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ]
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    # Every progress write raises → the consecutive streak climbs past the cap.
    fake = _FakeSupabase(
        members=[dict(m) for m in members],
        raise_on_rpc="set_compute_job_progress",
    )
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
        with _apply(_deribit_patches(
            fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
        )):
            result = await run_stitch_composite_job(dict(_PROG_JOB))

    # Fail-open: the stitch still completed despite every heartbeat write failing.
    assert result.outcome == DispatchOutcome.DONE
    # There ARE enough writes to cross the threshold (5 cash-pass writes ≥ 3).
    assert len(_progress_calls(fake)) >= _MEMBER_PROGRESS_MAX_CONSECUTIVE_FAILURES
    error_records = [
        r for r in caplog.records
        if r.name == "quantalyze.analytics.job_worker"
        and r.levelno == logging.ERROR
    ]
    assert error_records, "expected an error-level escalation on a persistent outage"
    assert any("CONSECUTIVELY" in r.getMessage() for r in error_records)


@pytest.mark.asyncio
async def test_member_progress_single_blip_stays_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """SF-2b: a SINGLE transient set_compute_job_progress failure self-heals on the
    next boundary (streak resets) and stays at warning — it must NOT escalate to
    error-level."""
    members = [
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ]
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    # Only the FIRST progress write fails; the rest succeed → streak never ≥ 3.
    fake = _FailFirstNProgress(members=[dict(m) for m in members], fail_n=1)
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
        with _apply(_deribit_patches(
            fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
        )):
            result = await run_stitch_composite_job(dict(_PROG_JOB))

    assert result.outcome == DispatchOutcome.DONE
    jw_records = [
        r for r in caplog.records if r.name == "quantalyze.analytics.job_worker"
    ]
    warnings = [r for r in jw_records if r.levelno == logging.WARNING]
    errors = [r for r in jw_records if r.levelno == logging.ERROR]
    # The single blip logged a warning …
    assert warnings, "expected a warning for the single transient failure"
    # … and did NOT escalate to error.
    assert not errors, "a single transient blip must not escalate to error-level"


class _FenceFalseProgress(_FakeSupabase):
    """A fake whose set_compute_job_progress RETURNS false (a fenced NO-OP: this
    run lost its claim token — a watchdog reclaim + re-claim rotated/NULLed the
    token) on EVERY call, and NEVER raises. Models mid-stitch preemption. All
    other RPCs succeed (data=None) exactly like the base fake."""

    def rpc(self, name: str, args: dict[str, Any]) -> SimpleNamespace:
        self.rpc_calls.append((name, args))
        if name == "set_compute_job_progress":
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=False))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=None))


@pytest.mark.asyncio
async def test_member_progress_fence_false_latches_off_and_logs_once(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """SF-2b claim-token drift: set_compute_job_progress RETURNS false (fenced
    no-op = this run lost its claim token). The worker must HONOUR the RPC's
    documented 'false => stop writing' contract: (1) it does NOT treat the false
    as a successful write and keep going, (2) it STOPS issuing further progress
    writes for the rest of the run (a re-claimed worker owns the heartbeat), and
    (3) it logs the preemption EXACTLY ONCE — WITHOUT escalating to the SF-2b
    outage error (false is expected preemption, not a write outage). The stitch
    stays authoritative and completes.

    RED before the fix: the returned boolean was discarded, so a fenced false
    counted as a clean write — the worker kept writing (many RPC calls) and
    never logged the preemption."""
    members = [
        _member(1, "2024-01-01", "2024-02-01"),
        _member(2, "2024-02-01", None),
    ]
    m1 = _returns([("2024-01-01", 0.10), ("2024-01-02", 0.05)])
    m2 = _returns([("2024-02-01", -0.04), ("2024-02-02", -0.06)])
    fake = _FenceFalseProgress(members=[dict(m) for m in members])
    with caplog.at_level(logging.INFO, logger="quantalyze.analytics.job_worker"):
        with _apply(_deribit_patches(
            fake, combine_returns=[(m1, {}), (m2, {})], has_option_activity=True,
        )):
            result = await run_stitch_composite_job(dict(_PROG_JOB))

    # Fail-open + authoritative: the stitch still completed.
    assert result.outcome == DispatchOutcome.DONE
    # (2) STOPPED after the first fenced write — the latch short-circuits every
    # subsequent _write_member_progress. Without the fix the worker would keep
    # writing (>= 5 cash-pass calls, as the happy-path sequence test shows).
    prog_calls = _progress_calls(fake)
    assert len(prog_calls) == 1, (
        "a fenced false must latch OFF further progress writes; got "
        f"{len(prog_calls)} calls"
    )
    jw_records = [
        r for r in caplog.records if r.name == "quantalyze.analytics.job_worker"
    ]
    # (3) Logged the preemption EXACTLY ONCE, at info-level …
    preemption_logs = [
        r for r in jw_records
        if r.levelno == logging.INFO and "returned false" in r.getMessage()
    ]
    assert len(preemption_logs) == 1, (
        "expected exactly one info-level preemption log for the fenced false; "
        f"got {len(preemption_logs)}"
    )
    # (1) … and did NOT escalate to the SF-2b outage error (expected preemption,
    # not a write outage — the failure counter must not be driven by a false).
    errors = [r for r in jw_records if r.levelno == logging.ERROR]
    assert not errors, "a fenced false is preemption, not an outage — must not escalate"
