"""Phase 101 (MTM-01) — single-key Deribit mark_to_market second-pass wiring.

The single-key broker derive (``run_derive_broker_dailies_job``) historically
computed ONE ``pnl_basis`` (default ``cash_settlement``) and never wrote
``strategy_analytics.metrics_json_by_basis.mark_to_market`` — so an options-book
factsheet rendered seven "—". This module pins the additive second pass that
closes that gap, mirroring the composite dual-pass template:

  * SECOND ``mark_to_market`` ledger pass runs IFF (strategy-mode AND the cash
    headline basis AND ``has_option_activity``) — perp-only / ccxt / key-mode /
    MTM-configured-headline derives stay byte-identical (one crawl, no by-basis
    write) — SC-4 by construction.
  * a STRUCTURAL MTM reconstruction failure (pre-rollout straddle / summary hole)
    DEGRADES: the cash derive still completes DONE + upserts csv_daily_returns +
    enqueues compute_analytics_from_csv, and the prestamp carries
    ``mtm_gated_reason == "mtm_summary_coverage_incomplete"``;
  * a TRANSIENT error on the MTM crawl (a bare ``ValueError`` / a
    ``DeribitTransientReadError``) PROPAGATES so the whole derive retries — it is
    NEVER stamped as a permanent coverage reason.

Neuter-falsifiability (test → mutation it kills):
  * ``test_options_book_runs_second_mtm_pass_same_anchor`` — kills removing the
    second pass, or re-fetching the anchor for it (identity assert).
  * ``test_perp_only_book_runs_single_pass`` — kills dropping the
    ``has_option_activity`` guard (would double every perp crawl).
  * ``test_key_mode_never_runs_second_pass`` — kills dropping the
    ``not is_key_mode`` guard.
  * ``test_structural_mtm_failure_degrades_with_reason`` — kills removing the
    inner structural catch (the error would escalate to FAILED).
  * ``test_transient_valueerror_on_mtm_propagates`` — kills widening the catch to
    bare ``ValueError`` (a transient blip would be swallowed as a coverage reason).
  * ``test_transient_read_error_on_mtm_propagates`` — kills adding
    ``DeribitTransientReadError`` to the structural catch tuple.
  * ``test_finite_mtm_object_persisted`` (Task 2) — kills dropping the by-basis
    persist, or adding a ``cash_settlement`` key.
  * ``test_degraded_mtm_persists_null_and_reason`` (Task 2) — kills dropping the
    SQL-NULL heal / the reason stamp on degrade.
  * ``test_non_options_leaves_by_basis_untouched`` (Task 2) — kills writing the
    by-basis column on a non-options derive.
  * ``test_benchmark_failure_never_gates_mtm`` (Task 2) — kills gating MTM on the
    BTC benchmark fetch.
  * ``test_sc4_cash_parity_mtm_on_vs_off`` / ``test_sc4_cash_parity_mtm_degraded``
    (Task 3) — kill any mutation of the shared cash ledger/returns/meta.

Network-free: every I/O primitive is a stub / AsyncMock. The job imports its
Deribit primitives FUNCTION-LOCALLY, so we patch the SOURCE modules
(``services.deribit_ingest`` / ``services.broker_dailies`` / ``services.benchmark``).
"""
from __future__ import annotations

from contextlib import ExitStack
from typing import Any

import pandas as pd
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from services.deribit_ingest import (
    CompletenessReport,
    DeribitNativeAccountState,
    DeribitTransientReadError,
)
from services.deribit_txn import LedgerValuationError
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from services.native_nav import NativeLedger
from services.stitch_composite import MTM_REASON_SUMMARY_COVERAGE

_STRATEGY_ID = "strat-mtm-1"


def _ctx(*, strategy_row: dict | None, key_mode: bool = False) -> tuple[MagicMock, dict]:
    """Strategy-mode (default) or key-mode Deribit ctx + a capture of every
    supabase table op (upserts / deletes) and rpc call."""
    capture: dict = {"upserts": [], "deletes": [], "rpc_calls": [], "ops": []}
    ctx = MagicMock()
    ctx.exchange = AsyncMock()
    ctx.supabase = MagicMock()
    ctx.strategy_row = strategy_row
    ctx.key_row = {
        "id": "key-drb",
        "user_id": "alloc-1",
        "exchange": "deribit",
    }

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _upsert(payload: object, **kw: object) -> MagicMock:
            capture["upserts"].append((name, payload, kw.get("on_conflict")))
            capture["ops"].append(("upsert", name))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub

        tbl.upsert.side_effect = _upsert

        def _delete(**kw: object) -> MagicMock:
            record: dict = {"table": name, "filters": {}}
            capture["deletes"].append(record)
            capture["ops"].append(("delete", name))
            chain = MagicMock()

            def _eq(col: str, val: object) -> MagicMock:
                record["filters"][f"eq:{col}"] = val
                return chain

            def _gte(col: str, val: object) -> MagicMock:
                record["filters"][f"gte:{col}"] = val
                return chain

            def _lte(col: str, val: object) -> MagicMock:
                record["filters"][f"lte:{col}"] = val
                return chain

            chain.eq.side_effect = _eq
            chain.gte.side_effect = _gte
            chain.lte.side_effect = _lte
            chain.execute.return_value = MagicMock(data=[], count=0)
            return chain

        tbl.delete.side_effect = _delete
        return tbl

    ctx.supabase.table.side_effect = _table

    def _rpc(name: str, payload: dict) -> MagicMock:
        capture["rpc_calls"].append((name, payload))
        stub = MagicMock()
        stub.execute.return_value = MagicMock(data=1)
        return stub

    ctx.supabase.rpc.side_effect = _rpc
    return ctx, capture


def _account_state() -> DeribitNativeAccountState:
    return DeribitNativeAccountState(
        native_equity={"BTC": 1.0},
        native_upnl={},
        collapsed_equity_usd=100_000.0,
        collapsed_upnl_usd=0.0,
        balance_error=False,
        upnl_unreadable=False,
        native_options_value={},
    )


def _stub_native_ledger() -> NativeLedger:
    pnl = pd.Series(
        [1.0],
        index=pd.DatetimeIndex(["2024-05-01"]),
        dtype="float64",
        name="native_pnl",
    )
    return NativeLedger(
        native_pnl={"BTC": pnl},
        terminal_native_equity={"BTC": 1.0},
        marks={},
        native_flows=[],
        terminal_upnl_native={},
        full_history=True,
    )


def _report(*, has_option_activity: bool) -> CompletenessReport:
    """A COMPLETE report (empty ``expected`` → assert_ledger_complete passes)."""
    return CompletenessReport(
        total_return_rows=2,
        indexable_currencies=frozenset({"BTC"}),
        has_option_activity=has_option_activity,
    )


def _cash_series() -> pd.Series:
    return pd.Series(
        [0.01, -0.02, 0.03],
        index=pd.DatetimeIndex(["2024-05-01", "2024-05-02", "2024-05-03"]),
        dtype="float64",
    )


def _mtm_series() -> pd.Series:
    """A DISTINCT >=2-day series so a cash/MTM reassignment is observable (SC-4
    falsifiability) and compute_all_metrics yields finite seven scalars."""
    idx = pd.date_range("2024-05-01", periods=30, freq="D")
    vals = [0.01, -0.015, 0.02, -0.01, 0.03] * 6
    return pd.Series(vals, index=idx, dtype="float64")


def _apply(patchers: list) -> ExitStack:
    stack = ExitStack()
    for p in patchers:
        stack.enter_context(p)
    return stack


def _base_patches(
    ctx: MagicMock,
    *,
    key_mode: bool,
    ledger_mock: AsyncMock,
    combine_mock: MagicMock,
    state_spy: AsyncMock | None = None,
) -> list:
    preflight = (
        "services.job_worker._allocator_key_preflight"
        if key_mode
        else "services.job_worker._exchange_preflight"
    )
    return [
        patch(preflight, new=AsyncMock(return_value=ctx)),
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
            "services.deribit_ingest.fetch_deribit_native_account_state",
            new=state_spy or AsyncMock(return_value=_account_state()),
        ),
        patch("services.broker_dailies.combine_native_ledger", new=combine_mock),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
    ]


def _recording_ledger(
    reports: list[CompletenessReport],
    *,
    side_effects: list[object] | None = None,
) -> tuple[AsyncMock, list]:
    """A build_deribit_native_ledger mock that RECORDS each call's pnl_basis +
    account_state identity. ``side_effects`` (optional, per-call) lets a test raise
    on the second (MTM) call."""
    calls: list[dict] = []

    async def _impl(exchange: Any, *, account_state: Any, pnl_basis: str,
                    exclude_spot_extraction: bool) -> Any:
        idx = len(calls)
        calls.append({"pnl_basis": pnl_basis, "account_state": account_state})
        if side_effects is not None and idx < len(side_effects):
            eff = side_effects[idx]
            if isinstance(eff, BaseException):
                raise eff
        report = reports[idx] if idx < len(reports) else reports[-1]
        return (_stub_native_ledger(), report)

    return AsyncMock(side_effect=_impl), calls


# ── Task 1: second-pass wiring ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_options_book_runs_second_mtm_pass_same_anchor() -> None:
    """Options book (strategy-mode, cash headline): build_deribit_native_ledger
    is called EXACTLY TWICE — cash then mark_to_market — and BOTH calls receive the
    SAME account_state object (80-06 one-anchor-read)."""
    ctx, _ = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True), _report(has_option_activity=True)]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    )):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert len(calls) == 2, "options book must run a SECOND mark_to_market pass"
    assert calls[0]["pnl_basis"] == "cash_settlement"
    assert calls[1]["pnl_basis"] == "mark_to_market"
    assert calls[0]["account_state"] is calls[1]["account_state"], (
        "both passes must anchor on the SAME one-read account_state"
    )


@pytest.mark.asyncio
async def test_perp_only_book_runs_single_pass() -> None:
    """Perp-only (has_option_activity=False): ONE cash crawl only — no second pass."""
    ctx, _ = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=False)]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    )):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert len(calls) == 1, "perp-only book must NOT run a second crawl"
    assert calls[0]["pnl_basis"] == "cash_settlement"


@pytest.mark.asyncio
async def test_key_mode_never_runs_second_pass() -> None:
    """Key-mode (api_key_id job) with options activity: still ONE crawl — key-mode
    owns no strategy_analytics row to persist a by-basis object into."""
    ctx, _ = _ctx(strategy_row=None, key_mode=True)
    reports = [_report(has_option_activity=True)]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine,
    )):
        result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.DONE
    assert len(calls) == 1, "key-mode must NOT run a second mark_to_market pass"


@pytest.mark.asyncio
async def test_structural_mtm_failure_degrades_with_reason() -> None:
    """LedgerValuationError on the MTM (second) crawl only: the derive still
    completes DONE, upserts csv_daily_returns, enqueues compute_analytics_from_csv,
    and stamps mtm_gated_reason — the structural failure DEGRADES, never crashes."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True)]
    ledger_mock, calls = _recording_ledger(
        reports,
        side_effects=[None, LedgerValuationError("pre-rollout straddle: no V0 anchor")],
    )
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    )):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert len(calls) == 2, "MTM pass must be ATTEMPTED before degrading"
    # csv_daily_returns cash rows still written
    assert any(
        name == "csv_daily_returns" and op == "upsert"
        for op, name in capture["ops"]
    )
    # compute_analytics_from_csv still enqueued
    assert any(
        rpc == "enqueue_compute_job" for rpc, _ in capture["rpc_calls"]
    )
    # the prestamp carries the degrade reason
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert prestamp["data_quality_flags"]["mtm_gated_reason"] == (
        MTM_REASON_SUMMARY_COVERAGE
    )


@pytest.mark.asyncio
async def test_transient_valueerror_on_mtm_propagates() -> None:
    """A bare ValueError (transient parse/network blip) on the MTM crawl must
    PROPAGATE — the whole derive retries, NO coverage reason is stamped. Fails if
    bare ValueError is (re-)added to the structural catch tuple."""
    ctx, _ = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(
        reports,
        side_effects=[None, ValueError("transient JSON decode")],
    )
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    )):
        with pytest.raises(ValueError):
            await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})


@pytest.mark.asyncio
async def test_transient_read_error_on_mtm_propagates() -> None:
    """A DeribitTransientReadError on the MTM crawl must PROPAGATE (retryable) —
    never be stamped as a permanent coverage reason."""
    ctx, _ = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(
        reports,
        side_effects=[None, DeribitTransientReadError("summaries read blip")],
    )
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    )):
        with pytest.raises(DeribitTransientReadError):
            await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})


def _find_prestamp(capture: dict) -> dict | None:
    """The strategy_analytics prestamp upsert payload (csv_source flag stamp) —
    distinguished from the failed-status stamps by presence of csv_source + absence
    of computation_status."""
    for name, payload, _conflict in capture["upserts"]:
        if (
            name == "strategy_analytics"
            and isinstance(payload, dict)
            and payload.get("data_quality_flags", {}).get("csv_source") is True
            and "computation_status" not in payload
        ):
            return payload
    return None
