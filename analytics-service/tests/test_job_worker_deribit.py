"""job_worker deribit branch — the v1.9 NATIVE-unit wiring (80-03, NAT-05).

As of the v1.9 native switch the deribit branch reconstructs EVERY account —
USD-native included — in native units through the landed core: it builds a
``NativeLedger`` via ``build_deribit_native_ledger`` and computes ``(returns,
meta)`` via ``combine_native_ledger``. There is NO per-account dispatch flag; §4
SC-4 bit-identity (ship gate i) licenses routing every account the same way.

These tests pin the routing (no flag), the preserved honesty gates
(``assert_ledger_complete`` + the C2 equity-vs-activity floor run BEFORE combine),
and the typed permanent disposition: a ``LedgerValuationError`` (crawl) OR a
``NavReconstructionError`` (native-core structural refusal) is permanent FAILED +
a scrubbed terminal analytics stamp, never a retry-loop (T-80-10).

Network-free: every I/O primitive is a stub / AsyncMock.
"""
from __future__ import annotations

import re
from contextlib import ExitStack
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from services.deribit_ingest import CompletenessReport
from services.deribit_txn import LedgerValuationError
from services.external_flows import ExternalFlow
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from services.native_nav import (
    InceptionReconciliationError,
    NativeLedger,
    UnmarkableCurrencyError,
)

_RAW_EQUITY_USD = 100_000.0


def _deribit_ctx() -> tuple[MagicMock, dict]:
    """Mock allocator-key ctx + a capture of supabase upserts."""
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


def _stub_native_ledger(
    *, marks: dict[str, Any] | None = None, ccy: str = "USDC"
) -> NativeLedger:
    """A trivial NativeLedger stub. combine_native_ledger is MOCKED in these
    branch tests, so the ledger content is inert — ``marks`` lets a test signal a
    coin (branch-2) vs a USD-native (branch-1) account purely to prove the branch
    routes both the SAME way (no per-account flag)."""
    pnl = pd.Series(
        [1.0],
        index=pd.DatetimeIndex(["2024-05-01"]),
        dtype="float64",
        name="native_pnl",
    )
    return NativeLedger(
        native_pnl={ccy: pnl},
        terminal_native_equity={ccy: 1.0},
        marks=marks or {},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )


def _patches(
    ctx: MagicMock,
    *,
    report: CompletenessReport,
    combine_spy: MagicMock | None = None,
    ledger_side_effect: object = None,
    native_ledger: NativeLedger | None = None,
    equity: float | None = _RAW_EQUITY_USD,
    balance_error: bool = False,
    upnl: float = 0.0,
    upnl_unreadable: bool = False,
) -> tuple[list, MagicMock]:
    """Patch set for the NATIVE deribit branch. fetch_all_trades RAISES so any
    test that reaches combine proves the deribit branch never touched it (D-08).
    build_deribit_native_ledger returns ``(NativeLedger, CompletenessReport)`` and
    combine_native_ledger is a spy — the (returns, meta) it yields drives the
    downstream CSV write exactly as before (byte-shape identical, §9.2)."""
    two_day = pd.Series(
        [0.01, -0.02],
        index=pd.DatetimeIndex(["2024-05-01", "2024-05-02"]),
        dtype="float64",
    )
    combine = combine_spy or MagicMock(
        return_value=(two_day, {"used_heuristic_capital": False})
    )
    if ledger_side_effect is not None:
        ledger_mock: AsyncMock = AsyncMock(side_effect=ledger_side_effect)
    else:
        ledger_mock = AsyncMock(
            return_value=(native_ledger or _stub_native_ledger(), report)
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
            "services.deribit_ingest.build_deribit_native_ledger",
            new=ledger_mock,
        ),
        patch(
            # FLOW-04 (77-03) + MUST-2: the deribit branch reads the companion
            # 4-tuple (equity + session-uPnL wedge + unreadable flag) from ONE
            # get_account_summaries response — kept for C2 + the parity anchor.
            "services.deribit_ingest.fetch_deribit_account_equity_and_upnl_usd",
            new=AsyncMock(
                return_value=(equity, balance_error, upnl, upnl_unreadable)
            ),
        ),
        patch("services.broker_dailies.combine_native_ledger", new=combine),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
    ], combine


def _apply(patchers: list) -> ExitStack:
    stack = ExitStack()
    for p in patchers:
        stack.enter_context(p)
    return stack


@pytest.mark.asyncio
async def test_native_route_all_accounts_no_flag() -> None:
    """no-per-account-flag proof: BOTH a coin (branch-2, has marks) account AND a
    USD-native (branch-1, empty marks) account are reconstructed through
    combine_native_ledger with the SAME code path — no branch keyed on account
    type / currency composition. combine is called with the ledger
    build_deribit_native_ledger returned and indexable=report.indexable_currencies."""
    report = CompletenessReport(
        total_return_rows=2, indexable_currencies=frozenset({"BTC", "ETH"})
    )
    for ledger in (
        _stub_native_ledger(marks={"BTC": object()}, ccy="BTC"),  # coin
        _stub_native_ledger(ccy="USDC"),                          # USD-native
    ):
        ctx, _ = _deribit_ctx()
        patches, combine = _patches(ctx, report=report, native_ledger=ledger)
        with _apply(patches):
            result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
        assert result.outcome == DispatchOutcome.DONE
        combine.assert_called_once()
        args, kwargs = combine.call_args
        passed_ledger = kwargs.get("ledger", args[0] if args else None)
        passed_indexable = kwargs.get(
            "indexable", args[1] if len(args) > 1 else None
        )
        assert passed_ledger is ledger
        assert passed_indexable == frozenset({"BTC", "ETH"})


def test_no_per_account_dispatch_flag_source_scan() -> None:
    """Mutation-honest source scan: the deribit branch computes native returns
    UNCONDITIONALLY — there is no ``if <usd_native / coin> : legacy_path`` fork
    keyed on account type around the native combine. Reintroducing a per-account
    flag (e.g. combine_realized_and_funding taken for USD-native deribit) reddens."""
    src = Path(__file__).resolve().parents[1] / "services" / "job_worker.py"
    lines = src.read_text().splitlines()
    # Locate the deribit branch body.
    start = next(i for i, ln in enumerate(lines) if 'if venue == "deribit":' in ln)
    # The native combine call must appear in the branch, unconditionally.
    branch = "\n".join(lines[start:start + 200])
    assert "combine_native_ledger(" in branch
    # No account-type conditional gating the reconstruction path.
    assert not re.search(r"if\s+.*usd_native", branch)
    assert not re.search(r"if\s+.*is_coin", branch)


@pytest.mark.asyncio
async def test_completeness_gate_preserved_before_combine() -> None:
    """D-02 honesty gate preserved: assert_ledger_complete raising (a
    scope×currency never reached continuation=null) → FAILED and combine is NEVER
    reached — no partial track record. Neutering the gate call reddens."""
    from services.deribit_ingest import LedgerCompletenessError

    ctx, _ = _deribit_ctx()
    patches, combine = _patches(ctx, report=CompletenessReport(total_return_rows=2))
    with _apply(patches), patch(
        "services.deribit_ingest.assert_ledger_complete",
        new=MagicMock(side_effect=LedgerCompletenessError("main×BTC incomplete")),
    ):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    combine.assert_not_called()


@pytest.mark.asyncio
async def test_no_unvalued_inverse_flow_degrade_to_balance_error() -> None:
    """Fail-loud inheritance proof: an unvaluable inverse flow surfaces from the
    crawl as a permanent LedgerValuationError (caught at the ledger try) — NOT
    silently degraded to balance_error (the deleted F1 scalar's old behavior)."""
    ctx, _ = _deribit_ctx()
    patches, combine = _patches(
        ctx,
        report=CompletenessReport(),
        ledger_side_effect=LedgerValuationError(
            "external-flow Deribit row id=1 has no same-day index"
        ),
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    combine.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc",
    [
        UnmarkableCurrencyError(
            currency="BUIDL", venue="deribit", reason="no_usd_index",
            missing_day_count=4,
        ),
        InceptionReconciliationError(
            currencies=["BTC"], venue="deribit", breach_ratio=3.2,
        ),
    ],
    ids=["unmarkable", "inception"],
)
async def test_nav_reconstruction_error_permanent(exc: Exception) -> None:
    """NEW (v1.9 native switch, T-80-10): a NavReconstructionError subclass from
    combine_native_ledger is dispositioned PERMANENT — DispatchOutcome.FAILED,
    error_kind 'permanent', a scrubbed terminal strategy_analytics stamp, and NO
    retry — exactly the LedgerValuationError discipline. Catching it as transient
    (or not at all → generic 'unknown') reddens.

    Scrub proof: the raised error_message carries codes/counts/ratios only (the
    core errors are already leak-safe) — no raw balances."""
    ctx, capture = _deribit_ctx()
    combine = MagicMock(side_effect=exc)
    patches, _ = _patches(
        ctx, report=CompletenessReport(total_return_rows=2), combine_spy=combine
    )
    with _apply(patches), patch(
        "services.job_worker._exchange_preflight",
        new=AsyncMock(return_value=ctx),
    ):
        result = await run_derive_broker_dailies_job({"strategy_id": "s-drb"})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    # Terminal 'failed' analytics stamp so the wizard poller resolves (not an
    # infinite computing spinner).
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert stamps, "a native structural refusal must stamp strategy_analytics"
    assert stamps[0][1]["computation_status"] == "failed"
    # No raw balances leaked into the returned message.
    assert not re.search(r"\d{4,}\.\d", result.error_message or "")


@pytest.mark.asyncio
async def test_c2_equity_vs_activity_floor_preserved() -> None:
    """C2-floor-preserved proof: a materially-funded account with ZERO
    return-bearing rows still fails loud BEFORE combine (unchanged by the native
    switch)."""
    ctx, _ = _deribit_ctx()
    patches, combine = _patches(
        ctx,
        report=CompletenessReport(total_return_rows=0),
        equity=_RAW_EQUITY_USD,
    )
    with _apply(patches):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.FAILED
    combine.assert_not_called()


def test_f1_scalar_region_source_scan() -> None:
    """No-double-correction proof (mutation-honest source scan): the F1 scalar
    subtraction cannot be reintroduced — neither the net-scalar fields nor an
    ``equity = equity - ...external_flow`` line appear anywhere in the active
    (non-comment) source of job_worker.py."""
    src = Path(__file__).resolve().parents[1] / "services" / "job_worker.py"
    active = [
        line for line in src.read_text().splitlines()
        if not line.lstrip().startswith("#")
    ]
    body = "\n".join(active)
    assert "saw_unvalued_inverse_flow" not in body
    assert "net_external_flow_usd" not in body
    assert not re.search(r"equity\s*=\s*equity\s*-\s*.*external_flow", body)


# ===========================================================================
# Phase 77-02 / SC-1 — Deribit session-uPnL companion (FLOW-04).
#
# session_upl rides the SAME get_account_summaries response + same
# index_prices as the equity anchor. An absent/uncertain field falls back to
# wedge 0.0 (A1 — NEVER fabricated). [ASSUMED A1]: session_upl.
# ===========================================================================


class _FakeDeribitSummaries:
    """Stub deribit exchange for the account-summaries + index-price reads."""

    def __init__(
        self,
        *,
        summaries: Any = None,
        index_price: Any = None,
        summaries_exc: BaseException | None = None,
    ) -> None:
        self._summaries = summaries
        self._index_price = index_price  # dict ccy->price OR a single float
        self._summaries_exc = summaries_exc

    async def private_get_get_account_summaries(self, params: dict[str, Any]) -> Any:
        if self._summaries_exc is not None:
            raise self._summaries_exc
        return {"result": {"summaries": self._summaries}}

    async def public_get_get_index_price(self, params: dict[str, Any]) -> Any:
        ccy = str(params["index_name"]).split("_")[0].upper()
        price = (
            self._index_price.get(ccy)
            if isinstance(self._index_price, dict)
            else self._index_price
        )
        if price is None:
            raise RuntimeError("no index for " + ccy)
        return {"result": {"index_price": price}}


@pytest.mark.asyncio
async def test_deribit_session_upl_valued_usd() -> None:
    """session_upl rides the SAME summaries response + same index_prices as
    the equity anchor: 0.3 BTC uPnL x 40000 = 12000 USD wedge, equity 80000."""
    from services.deribit_ingest import fetch_deribit_account_equity_and_upnl_usd

    ex = _FakeDeribitSummaries(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": 0.3}],
        index_price={"BTC": 40000.0},
    )
    equity, balance_error, upnl, unreadable = (
        await fetch_deribit_account_equity_and_upnl_usd(ex)
    )
    assert equity == pytest.approx(80000.0)
    assert balance_error is False
    assert upnl == pytest.approx(12000.0)
    # A present, numeric session_upl is readable (MUST-2).
    assert unreadable is False


@pytest.mark.asyncio
async def test_deribit_usd_family_session_upl_passthrough() -> None:
    """A USD-family currency's session_upl passes through as USD — no index
    multiply (mirrors the equity anchor's pass-through rule)."""
    from services.deribit_ingest import fetch_deribit_account_equity_and_upnl_usd

    ex = _FakeDeribitSummaries(
        summaries=[{"currency": "USDC", "equity": 50000.0, "session_upl": 1500.0}],
    )
    equity, balance_error, upnl, unreadable = (
        await fetch_deribit_account_equity_and_upnl_usd(ex)
    )
    assert equity == pytest.approx(50000.0)
    assert balance_error is False
    assert upnl == pytest.approx(1500.0)
    assert unreadable is False


@pytest.mark.asyncio
async def test_deribit_missing_session_upl_fallback_zero_but_flagged_unreadable(
) -> None:
    """MUST-2: summaries with equity but NO session_upl key (or null on every
    summary) → wedge 0.0 (never fabricated) AND ``unreadable`` True. A wrong
    ``[ASSUMED A1]`` field name is absent on every summary and would otherwise
    silently coalesce to a flat 0.0 wedge — disabling FLOW-04 for every Deribit
    account with no signal. Mutation-honest: reverting _deribit_session_upl_to_usd
    to a bare float turns the ``unreadable is True`` assertions RED.

    A genuinely flat book reports session_upl == 0 (a PRESENT numeric read) →
    unreadable False, so it stays clean `complete`.
    """
    from services.deribit_ingest import fetch_deribit_account_equity_and_upnl_usd

    ex_absent = _FakeDeribitSummaries(
        summaries=[{"currency": "BTC", "equity": 2.0}],
        index_price={"BTC": 40000.0},
    )
    equity, balance_error, upnl, unreadable = (
        await fetch_deribit_account_equity_and_upnl_usd(ex_absent)
    )
    assert equity == pytest.approx(80000.0)
    assert balance_error is False
    assert upnl == 0.0
    assert unreadable is True, "absent session_upl on every summary must flag unreadable"

    ex_null = _FakeDeribitSummaries(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": None}],
        index_price={"BTC": 40000.0},
    )
    _eq, _err, upnl_null, unreadable_null = (
        await fetch_deribit_account_equity_and_upnl_usd(ex_null)
    )
    assert upnl_null == 0.0
    assert unreadable_null is True

    # A PRESENT numeric 0.0 session_upl is a genuinely flat book — readable.
    ex_flat = _FakeDeribitSummaries(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": 0.0}],
        index_price={"BTC": 40000.0},
    )
    _eqf, _errf, upnl_flat, unreadable_flat = (
        await fetch_deribit_account_equity_and_upnl_usd(ex_flat)
    )
    assert upnl_flat == 0.0
    assert unreadable_flat is False, "present-0 session_upl is a clean flat book"


@pytest.mark.asyncio
async def test_deribit_balance_error_wedge_zero() -> None:
    """A failed summaries read → (None, True, 0.0): no equity, balance error,
    wedge forced to 0.0."""
    from services.deribit_ingest import fetch_deribit_account_equity_and_upnl_usd

    ex = _FakeDeribitSummaries(summaries_exc=RuntimeError("network down"))
    equity, balance_error, upnl, unreadable = (
        await fetch_deribit_account_equity_and_upnl_usd(ex)
    )
    assert equity is None
    assert balance_error is True
    assert upnl == 0.0
    # A failed anchor read → unreadable is moot/False (balance_error is the flag).
    assert unreadable is False


@pytest.mark.asyncio
async def test_deribit_no_index_upnl_balance_error() -> None:
    """A held non-linear currency carrying uPnL but no resolvable USD index →
    the equity anchor fails loud; the wedge path inherits (None, True, 0.0) —
    the wedge is NOT fabricated on an unvaluable base."""
    from services.deribit_ingest import fetch_deribit_account_equity_and_upnl_usd

    ex = _FakeDeribitSummaries(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": 0.3}],
        index_price=None,  # index resolution fails for BTC
    )
    equity, balance_error, upnl, unreadable = (
        await fetch_deribit_account_equity_and_upnl_usd(ex)
    )
    assert equity is None
    assert balance_error is True
    assert upnl == 0.0
    assert unreadable is False
