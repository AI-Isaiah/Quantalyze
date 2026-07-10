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

from contextlib import ExitStack
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
from services.job_worker import DispatchOutcome, run_stitch_composite_job


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

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)

    def rpc(self, name: str, args: dict[str, Any]) -> SimpleNamespace:
        self.rpc_calls.append((name, args))
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
    # mtm_gated_reason surfaced in the merged DQ flags.
    dq = None
    for table, payload, _ in reversed(fake.upserts):
        if table == "strategy_analytics" and isinstance(payload, dict) \
                and "data_quality_flags" in payload \
                and "metrics_json_by_basis" in payload:
            dq = payload["data_quality_flags"]
            break
    assert dq is not None
    assert dq.get("mtm_gated_reason") == "unsmoothed_options_book"


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
