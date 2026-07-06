"""job_worker deribit branch — the honest-core wiring (75-03).

Proves the F1 scalar anchor correction is DELETED and dated external flows are
threaded into ``combine_realized_and_funding`` so they feed ONLY the core's
``F_t`` term (count-once). The equity anchor now flows into the core UNADJUSTED —
the backward NAV roll performs the one honest flow correction, never a second
scalar subtraction (no double-correction).

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


def _patches(
    ctx: MagicMock,
    *,
    report: CompletenessReport,
    combine_spy: MagicMock | None = None,
    ledger_side_effect: object = None,
    equity: float | None = _RAW_EQUITY_USD,
    balance_error: bool = False,
) -> tuple[list, MagicMock]:
    """Patch set for the deribit branch. fetch_all_trades RAISES so any test that
    reaches combine proves the deribit branch never touched it (D-08)."""
    two_day = pd.Series(
        [0.01, -0.02],
        index=pd.DatetimeIndex(["2024-05-01", "2024-05-02"]),
        dtype="float64",
    )
    combine = combine_spy or MagicMock(
        return_value=(two_day, {"used_heuristic_capital": False})
    )
    realized = [
        {"trade_date": "2024-05-01", "side": "buy", "price": 120.0},
        {"trade_date": "2024-05-02", "side": "sell", "price": 40.0},
    ]
    if ledger_side_effect is not None:
        ledger_mock: AsyncMock = AsyncMock(side_effect=ledger_side_effect)
    else:
        ledger_mock = AsyncMock(return_value=(realized, report))
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
            new=AsyncMock(return_value=(equity, balance_error)),
        ),
        patch("services.broker_dailies.combine_realized_and_funding", new=combine),
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
async def test_equity_anchor_flows_unadjusted_no_f1_subtraction() -> None:
    """F1-deletion proof: the equity passed to combine equals the RAW anchor
    (100k) — it is NOT reduced by any net flow. The dated flows total −628k; with
    the deleted F1 scalar the anchor would have been 100k − (−628k) = 728k. That
    728k value must NOT appear; the raw 100k must."""
    ctx, _ = _deribit_ctx()
    report = CompletenessReport(
        total_return_rows=2,
        dated_external_flows=[
            ExternalFlow("2024-05-01", -628_000.0),
        ],
    )
    combine_spy = MagicMock(
        return_value=(
            pd.Series([0.01, -0.02],
                      index=pd.DatetimeIndex(["2024-05-01", "2024-05-02"])),
            {"used_heuristic_capital": False},
        )
    )
    patches, combine = _patches(ctx, report=report, combine_spy=combine_spy)
    with _apply(patches):
        await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    _args, kwargs = combine.call_args
    assert kwargs["account_balance"] == pytest.approx(_RAW_EQUITY_USD)
    assert kwargs["account_balance"] != pytest.approx(728_000.0), (
        "equity must NOT be net-flow-adjusted by the deleted F1 scalar"
    )


@pytest.mark.asyncio
async def test_dated_flows_threaded_into_combine() -> None:
    """Threading proof: combine is called with
    external_flows=_completeness.dated_external_flows — the dated list reaches the
    core's F_t term."""
    ctx, _ = _deribit_ctx()
    flows = [
        ExternalFlow("2024-05-01", -628_000.0),
        ExternalFlow("2024-05-02", 12_000.0),
    ]
    report = CompletenessReport(total_return_rows=2, dated_external_flows=flows)
    patches, combine = _patches(ctx, report=report)
    with _apply(patches):
        await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    _args, kwargs = combine.call_args
    assert kwargs["external_flows"] == flows


@pytest.mark.asyncio
async def test_no_unvalued_inverse_flow_degrade_to_balance_error() -> None:
    """Fail-loud inheritance proof: an unvaluable inverse flow surfaces as a
    permanent LedgerValuationError (caught at the ledger try) — NOT silently
    degraded to balance_error (the deleted F1 scalar's old behavior)."""
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
async def test_c2_equity_vs_activity_floor_preserved() -> None:
    """C2-floor-preserved proof: a materially-funded account with ZERO
    return-bearing rows still fails loud (unchanged by the F1 deletion)."""
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
    equity, balance_error, upnl = await fetch_deribit_account_equity_and_upnl_usd(ex)
    assert equity == pytest.approx(80000.0)
    assert balance_error is False
    assert upnl == pytest.approx(12000.0)


@pytest.mark.asyncio
async def test_deribit_usd_family_session_upl_passthrough() -> None:
    """A USD-family currency's session_upl passes through as USD — no index
    multiply (mirrors the equity anchor's pass-through rule)."""
    from services.deribit_ingest import fetch_deribit_account_equity_and_upnl_usd

    ex = _FakeDeribitSummaries(
        summaries=[{"currency": "USDC", "equity": 50000.0, "session_upl": 1500.0}],
    )
    equity, balance_error, upnl = await fetch_deribit_account_equity_and_upnl_usd(ex)
    assert equity == pytest.approx(50000.0)
    assert balance_error is False
    assert upnl == pytest.approx(1500.0)


@pytest.mark.asyncio
async def test_deribit_missing_session_upl_fallback_zero() -> None:
    """A1 fallback: summaries with equity but NO session_upl key (or null) →
    wedge 0.0 (conservative, realized-basis terminal) — NEVER fabricated."""
    from services.deribit_ingest import fetch_deribit_account_equity_and_upnl_usd

    ex_absent = _FakeDeribitSummaries(
        summaries=[{"currency": "BTC", "equity": 2.0}],
        index_price={"BTC": 40000.0},
    )
    equity, balance_error, upnl = await fetch_deribit_account_equity_and_upnl_usd(
        ex_absent
    )
    assert equity == pytest.approx(80000.0)
    assert balance_error is False
    assert upnl == 0.0

    ex_null = _FakeDeribitSummaries(
        summaries=[{"currency": "BTC", "equity": 2.0, "session_upl": None}],
        index_price={"BTC": 40000.0},
    )
    _eq, _err, upnl_null = await fetch_deribit_account_equity_and_upnl_usd(ex_null)
    assert upnl_null == 0.0


@pytest.mark.asyncio
async def test_deribit_balance_error_wedge_zero() -> None:
    """A failed summaries read → (None, True, 0.0): no equity, balance error,
    wedge forced to 0.0."""
    from services.deribit_ingest import fetch_deribit_account_equity_and_upnl_usd

    ex = _FakeDeribitSummaries(summaries_exc=RuntimeError("network down"))
    equity, balance_error, upnl = await fetch_deribit_account_equity_and_upnl_usd(ex)
    assert equity is None
    assert balance_error is True
    assert upnl == 0.0


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
    equity, balance_error, upnl = await fetch_deribit_account_equity_and_upnl_usd(ex)
    assert equity is None
    assert balance_error is True
    assert upnl == 0.0
