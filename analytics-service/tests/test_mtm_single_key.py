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
  * ``test_non_options_deribit_authoritatively_nulls_by_basis`` /
    ``test_ccxt_venue_authoritatively_nulls_by_basis`` (Fable MED-HIGH) — kill
    dropping the authoritative NULL, which would strand a stale by-basis object on
    a single-key row.
  * ``test_composite_to_single_conversion_nulls_stale_by_basis`` /
    ``test_mtm_headline_flip_clears_stale_by_basis`` /
    ``test_terminal_failure_clears_stale_by_basis`` (Fable MED-HIGH) — kill the
    not-attempted / mtm-headline / failure-stamp arms leaving the column
    unwritten.
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
from services.stitch_composite import (
    MTM_REASON_SERIES_UNCOMPUTABLE,
    MTM_REASON_SUMMARY_COVERAGE,
)

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


def _find_failed_stamp(capture: dict) -> dict | None:
    """The terminal 'failed' strategy_analytics upsert payload (the derive's
    _stamp_deribit_analytics_failed / _mark_insufficient / _stamp_nav_failed
    stamps), distinguished by computation_status == 'failed'."""
    for name, payload, _conflict in capture["upserts"]:
        if (
            name == "strategy_analytics"
            and isinstance(payload, dict)
            and payload.get("computation_status") == "failed"
        ):
            return payload
    return None


_SEVEN_SCALARS = (
    "cumulative_return", "volatility", "max_drawdown",
    "cagr", "sharpe", "sortino", "calmar",
)


def _patch_benchmark(*, raises: bool = False) -> Any:
    """Patch the function-local ``from services.benchmark import
    get_benchmark_returns`` at its SOURCE. Default: return (None, True) so the
    real supabase-backed fetch is never hit. ``raises=True`` simulates a blip."""
    if raises:
        return patch(
            "services.benchmark.get_benchmark_returns",
            new=AsyncMock(side_effect=RuntimeError("benchmark fetch blip")),
        )
    return patch(
        "services.benchmark.get_benchmark_returns",
        new=AsyncMock(return_value=(None, True)),
    )


# ── Task 2: metrics compute + additive prestamp persistence ─────────────────

@pytest.mark.asyncio
async def test_finite_mtm_object_persisted() -> None:
    """Wave-0 gap 1: an options book whose MTM pass succeeds persists
    metrics_json_by_basis == {"mark_to_market": <seven-scalar dict>} with a FINITE
    cumulative_return and NO cash_settlement key. compute_all_metrics runs for real
    over the MTM series."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True), _report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    by_basis = prestamp.get("metrics_json_by_basis")
    assert isinstance(by_basis, dict), "must persist a metrics_json_by_basis object"
    assert set(by_basis.keys()) == {"mark_to_market"}, (
        "single-key by-basis must carry ONLY mark_to_market — a cash_settlement "
        "key would activate the recomputed cash overlay and risk SC-4 divergence"
    )
    mtm = by_basis["mark_to_market"]
    for _k in _SEVEN_SCALARS:
        assert _k in mtm, f"MTM object missing headline scalar {_k!r}"
    assert mtm["cumulative_return"] is not None
    assert pd.notna(mtm["cumulative_return"])
    # No degrade reason on the success path.
    assert "mtm_gated_reason" not in prestamp["data_quality_flags"]


@pytest.mark.asyncio
async def test_degraded_mtm_persists_null_and_reason() -> None:
    """Wave-0 gap 3: a degraded MTM pass persists metrics_json_by_basis IS None
    (SQL NULL — heals a stale key) AND data_quality_flags.mtm_gated_reason."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(
        reports,
        side_effects=[None, LedgerValuationError("summary hole mid-window")],
    )
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert "metrics_json_by_basis" in prestamp, (
        "an ATTEMPTED-but-degraded pass must WRITE the column (SQL NULL) to heal "
        "a stale mark_to_market key from a prior successful derive"
    )
    assert prestamp["metrics_json_by_basis"] is None
    assert prestamp["data_quality_flags"]["mtm_gated_reason"] == (
        MTM_REASON_SUMMARY_COVERAGE
    )


@pytest.mark.asyncio
async def test_non_options_deribit_authoritatively_nulls_by_basis() -> None:
    """MED-HIGH (Fable): a perp-only Deribit derive is AUTHORITATIVE for the
    single-key row — it writes metrics_json_by_basis = SQL NULL (present in the
    payload, Python None) so no stale by-basis object can survive, and NO
    mtm_gated_reason. (Pre-Fable this left the column UNTOUCHED, which stranded a
    stale composite/MTM object — a wrong-money-number hazard for Phase 102.)"""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=False)]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert "metrics_json_by_basis" in prestamp and prestamp["metrics_json_by_basis"] is None, (
        "a non-options derive must AUTHORITATIVELY NULL the by-basis column, not "
        "leave it untouched (a stale object would otherwise survive)"
    )
    assert "mtm_gated_reason" not in prestamp["data_quality_flags"]


@pytest.mark.asyncio
async def test_ccxt_venue_authoritatively_nulls_by_basis() -> None:
    """MED-HIGH (Fable): a ccxt (binance) strategy derive never attempts the MTM
    pass, yet still AUTHORITATIVELY NULLs metrics_json_by_basis so a stale object
    from a prior composite era can't linger on the now-single-key ccxt row."""
    from tests.test_derive_broker_dailies_dualmode import (
        _build_ctx as _dm_ctx,
        _patches as _dm_patches,
        _two_day_returns,
    )

    ctx, capture = _dm_ctx(
        key_row={"id": "key-b", "exchange": "binance", "user_id": "user-1"},
        strategy_row={"id": "strat-1", "user_id": "user-1"},
    )
    patches = _dm_patches(ctx, key_mode=False, returns=_two_day_returns())
    with _apply(list(patches)):
        result = await run_derive_broker_dailies_job(
            {"kind": "derive_broker_dailies", "strategy_id": "strat-1"}
        )
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert "metrics_json_by_basis" in prestamp and prestamp["metrics_json_by_basis"] is None, (
        "a ccxt derive must AUTHORITATIVELY NULL the single-key by-basis column"
    )
    assert "mtm_gated_reason" not in prestamp["data_quality_flags"]


@pytest.mark.asyncio
async def test_benchmark_failure_never_gates_mtm() -> None:
    """A get_benchmark_returns blip must NOT gate MTM — the seven guaranteed
    scalars are benchmark-invariant, so a finite mark_to_market object still
    persists (computed with benchmark_rets=None)."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True), _report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark(raises=True)]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    by_basis = prestamp.get("metrics_json_by_basis")
    assert isinstance(by_basis, dict) and "mark_to_market" in by_basis
    assert pd.notna(by_basis["mark_to_market"]["cumulative_return"])
    assert "mtm_gated_reason" not in prestamp["data_quality_flags"]


# ── Task 3: SC-4 derive-level cash parity (falsifiable) ─────────────────────

def _cash_track(capture: dict) -> dict:
    """Extract EVERYTHING the cash track persists, for byte-equality comparison:
    the csv_daily_returns upsert payload lists, the reconcile-delete span filters,
    and the prestamp data_quality_flags. Deliberately EXCLUDES metrics_json_by_basis
    (an additive MTM-only column) — SC-4 protects the cash outputs, not the additive
    by-basis write."""
    csv_upserts = [
        payload for name, payload, _c in capture["upserts"]
        if name == "csv_daily_returns"
    ]
    csv_deletes = [
        d["filters"] for d in capture["deletes"]
        if d["table"] == "csv_daily_returns"
    ]
    prestamp = _find_prestamp(capture)
    dq = dict(prestamp["data_quality_flags"]) if prestamp else {}
    return {"csv_upserts": csv_upserts, "csv_deletes": csv_deletes, "dq_flags": dq}


async def _run_mtm_off() -> dict:
    """Run B: a perp-only book (has_option_activity=False) — the pre-Phase-101
    single-pass shape. The MTM pass is never attempted."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=False)]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    return _cash_track(capture)


@pytest.mark.asyncio
async def test_sc4_cash_parity_mtm_on_vs_off() -> None:
    """SC-4 (Wave-0 gap 2, derive level): the cash track is BYTE-IDENTICAL whether
    the MTM pass runs (run A, options book, succeeds) or is skipped (run B, perp-only).
    combine returns a DISTINCT MTM series, so a mutation that reassigns the cash
    `returns`/`meta`/`native_ledger` to the MTM pass would perturb the csv payload or
    the delete span and FAIL this test."""
    # Run A: options book, MTM pass runs + succeeds (distinct MTM series).
    ctx_a, cap_a = _ctx(strategy_row={"asset_class": "crypto"})
    reports_a = [_report(has_option_activity=True), _report(has_option_activity=True)]
    ledger_a, _ = _recording_ledger(reports_a)
    combine_a = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx_a, key_mode=False, ledger_mock=ledger_a, combine_mock=combine_a,
    ) + [_patch_benchmark()]):
        result_a = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result_a.outcome == DispatchOutcome.DONE
    track_a = _cash_track(cap_a)

    track_b = await _run_mtm_off()

    assert track_a["csv_upserts"] == track_b["csv_upserts"], (
        "MTM pass perturbed the csv_daily_returns cash payload — SC-4 breach"
    )
    assert track_a["csv_deletes"] == track_b["csv_deletes"], (
        "MTM pass perturbed the reconcile-delete span — SC-4 breach"
    )
    # On the success path neither run stamps mtm_gated_reason.
    assert "mtm_gated_reason" not in track_a["dq_flags"]
    assert track_a["dq_flags"] == track_b["dq_flags"], (
        "MTM pass perturbed the cash data_quality_flags — SC-4 breach"
    )


@pytest.mark.asyncio
async def test_sc4_cash_parity_mtm_degraded() -> None:
    """SC-4: when the MTM pass RAISES (degrade path) the cash track is STILL
    byte-identical to the MTM-off run — minus the additive mtm_gated_reason flag
    (asserted separately in Task 2). Proves a degrade cannot perturb cash outputs."""
    ctx_a, cap_a = _ctx(strategy_row={"asset_class": "crypto"})
    reports_a = [_report(has_option_activity=True)]
    ledger_a, _ = _recording_ledger(
        reports_a,
        side_effects=[None, LedgerValuationError("pre-rollout straddle")],
    )
    combine_a = MagicMock(
        return_value=(_cash_series(), {"used_heuristic_capital": False})
    )
    with _apply(_base_patches(
        ctx_a, key_mode=False, ledger_mock=ledger_a, combine_mock=combine_a,
    ) + [_patch_benchmark()]):
        result_a = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result_a.outcome == DispatchOutcome.DONE
    track_a = _cash_track(cap_a)

    track_b = await _run_mtm_off()

    assert track_a["csv_upserts"] == track_b["csv_upserts"]
    assert track_a["csv_deletes"] == track_b["csv_deletes"]
    # Pop the additive degrade-only flag; the rest of the cash DQ dict must match.
    dq_a = dict(track_a["dq_flags"])
    assert dq_a.pop("mtm_gated_reason", None) == MTM_REASON_SUMMARY_COVERAGE
    assert dq_a == track_b["dq_flags"], (
        "a degraded MTM pass perturbed the cash data_quality_flags beyond the "
        "additive mtm_gated_reason — SC-4 breach"
    )


# ── Convention + compute-degrade coverage ───────────────────────────────────

_ALLOC_CONFIG = {
    "denominator": "allocated_capital",
    # cash headline (so the additive MTM second pass still runs) + the allocated
    # simple/active conventions the MTM object must mirror.
    "pnl_basis": "cash_settlement",
    "metrics_basis": "active_day",
    "cumulative_method": "simple",
    "capital_schedule": [
        {"effective_from": "2024-01-01", "capital_usd": 100000.0},
    ],
}


@pytest.mark.asyncio
async def test_mtm_object_uses_allocated_capital_conventions() -> None:
    """An allocated-capital strategy (Zavara-style simple/active override) still
    persists a finite mark_to_market object — proving the MTM compute reads the
    override's cumulative_method/day_basis (not the geometric/calendar default)."""
    ctx, capture = _ctx(
        strategy_row={
            "asset_class": "crypto",
            "returns_denominator_config": _ALLOC_CONFIG,
        }
    )
    reports = [_report(has_option_activity=True), _report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    by_basis = prestamp.get("metrics_json_by_basis")
    assert isinstance(by_basis, dict) and set(by_basis) == {"mark_to_market"}
    assert pd.notna(by_basis["mark_to_market"]["cumulative_return"])


@pytest.mark.asyncio
async def test_mtm_compute_valueerror_degrades() -> None:
    """FINDING 2 regression: a compute_all_metrics ValueError (e.g. a simple-basis
    interior chain-break) on the MTM object DEGRADES: the derive still completes
    DONE, persists SQL NULL, and stamps the SERIES-UNCOMPUTABLE reason — the cash
    headline is never failed by an MTM compute rejection. This is a math
    chain-break, NOT a settlement-summary coverage hole, so it MUST stamp
    ``mtm_series_uncomputable`` (distinct from the crawl-level coverage-hole
    reason ``mtm_summary_coverage_incomplete``, asserted by
    ``test_degraded_mtm_persists_null_and_reason``). Fails if the compute-level
    except is removed (job would raise) OR if the branch mislabels the reason as
    the coverage constant. Neuter: revert the stamp to MTM_REASON_SUMMARY_COVERAGE
    → this assert reddens."""
    # The two reasons are genuinely distinct machine constants.
    assert MTM_REASON_SERIES_UNCOMPUTABLE != MTM_REASON_SUMMARY_COVERAGE
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True), _report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [
        _patch_benchmark(),
        patch(
            "services.metrics.compute_all_metrics",
            new=MagicMock(side_effect=ValueError("interior chain-break")),
        ),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert prestamp["metrics_json_by_basis"] is None
    assert prestamp["data_quality_flags"]["mtm_gated_reason"] == (
        MTM_REASON_SERIES_UNCOMPUTABLE
    ), (
        "the compute-degrade branch (math chain-break) must stamp the "
        "SERIES-UNCOMPUTABLE reason, NOT the settlement coverage-hole reason"
    )


# ── FINDING 1: asset-class annualization clock (#597 √365 crypto) ────────────

def _projecting_strategy_supabase() -> MagicMock:
    """A supabase mock that simulates postgrest COLUMN PROJECTION for the
    strategies select: ``.table('strategies').select(cols)`` returns ONLY the
    columns named in ``cols`` (comma-separated), projected off a full crypto row.

    This exercises the REAL ``_load_strategy_and_key`` select STRING — exactly as
    postgrest behaves in production, where a column absent from the select is
    absent from the returned row. If ``asset_class`` is dropped from the
    strategies select (job_worker.py:441), the projected strategy_row will not
    carry it, and ``periods_per_year_for_asset_class(None)`` falls back to 252.
    The api_keys ``select('*')`` returns the full owner-matched Deribit key."""
    full_strategy = {
        "id": _STRATEGY_ID,
        "user_id": "alloc-1",
        "api_key_id": "key-drb",
        "asset_class": "crypto",
        "returns_denominator_config": None,
    }
    key_row = {"id": "key-drb", "user_id": "alloc-1", "exchange": "deribit"}
    sb = MagicMock()

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _select(cols: str) -> MagicMock:
            chain = MagicMock()

            def _execute() -> MagicMock:
                if name == "strategies":
                    requested = {c.strip() for c in cols.split(",")}
                    projected = {
                        k: v for k, v in full_strategy.items() if k in requested
                    }
                    return MagicMock(data=projected)
                return MagicMock(data=dict(key_row))

            chain.eq.return_value = chain
            chain.maybe_single.return_value = chain
            chain.execute.side_effect = _execute
            return chain

        tbl.select.side_effect = _select
        return tbl

    sb.table.side_effect = _table
    return sb


@pytest.mark.asyncio
async def test_mtm_periods_uses_crypto_clock_from_real_select() -> None:
    """FINDING 1 regression (#597 ship-blocker): the single-key MTM object MUST
    annualize on the crypto √365 clock. ``ctx.strategy_row`` is built from the
    REAL ``_load_strategy_and_key`` select (postgrest column projection) — NOT an
    injected ``{"asset_class": "crypto"}`` dict, which masks the production select
    and is exactly why the bug shipped. If ``asset_class`` is dropped from the
    strategies select at job_worker.py:441, the projected row lacks it,
    ``periods_per_year_for_asset_class(None)`` returns the 252 default, and the
    ``compute_all_metrics`` call receives 252 instead of 365 — this reddens.
    Neuters: revert the select to omit ``asset_class`` → seen_periods == [252]."""
    from services.job_worker import _load_strategy_and_key

    # Build the strategy_row through the PRODUCTION select string (projected).
    sb = _projecting_strategy_supabase()
    with patch(
        "services.job_worker.db_execute",
        new=AsyncMock(side_effect=lambda fn: fn()),
    ):
        strategy_row, key_row, err = await _load_strategy_and_key(sb, _STRATEGY_ID)
    assert err is None and strategy_row is not None
    assert strategy_row.get("asset_class") == "crypto", (
        "the _load_strategy_and_key select dropped asset_class — the MTM object "
        "would annualize on the 252 default instead of the crypto √365 clock (#597)"
    )

    # Run the derive with that REAL projected strategy_row; capture the periods
    # the MTM compute_all_metrics receives.
    ctx, _capture = _ctx(strategy_row=strategy_row)
    reports = [_report(has_option_activity=True), _report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])

    from services import metrics as _metrics_mod

    _real_compute = _metrics_mod.compute_all_metrics
    seen_periods: list[int] = []

    def _spy(*args: Any, **kw: Any) -> Any:
        seen_periods.append(kw.get("periods_per_year"))
        return _real_compute(*args, **kw)

    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [
        _patch_benchmark(),
        patch("services.metrics.compute_all_metrics", new=MagicMock(side_effect=_spy)),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert seen_periods == [365], (
        f"MTM compute_all_metrics received periods_per_year={seen_periods} — a "
        "crypto/Deribit book MUST annualize on √365 (#597), not the 252 default; "
        "asset_class was dropped from the single-key _load_strategy select"
    )


# ── FABLE MED-HIGH: metrics_json_by_basis is AUTHORITATIVE on the broker route ──
# A single-key broker-derive row's only legitimate by-basis content is the
# mark_to_market key this path writes; every other terminal shape must clear the
# column to SQL NULL so no stale composite-shaped or frozen MTM object survives
# (Phase 102 would render it as a wrong money number).

# An allocated-capital config whose HEADLINE basis is already mark_to_market — so
# the additive second pass is SKIPPED (the pnl_basis == DEFAULT_PNL_BASIS gate is
# False) even for an options book. mtm_attempted stays False.
_MTM_HEADLINE_CONFIG = {
    "denominator": "allocated_capital",
    "pnl_basis": "mark_to_market",
    "metrics_basis": "active_day",
    "cumulative_method": "simple",
    "capital_schedule": [
        {"effective_from": "2024-01-01", "capital_usd": 100000.0},
    ],
}


def _one_day_series() -> pd.Series:
    """A <2-interpretable-day series → the derive's insufficient-history short
    circuit (_mark_insufficient stamps computation_status='failed')."""
    return pd.Series(
        [0.01],
        index=pd.DatetimeIndex(["2024-05-01"]),
        dtype="float64",
    )


@pytest.mark.asyncio
async def test_composite_to_single_conversion_nulls_stale_by_basis() -> None:
    """FABLE MED-HIGH regression (trigger a): a strategy reconfigured composite →
    single-key broker (new key, perp-only Deribit) must AUTHORITATIVELY NULL
    metrics_json_by_basis so the stale composite {cash_settlement, mark_to_market}
    object cannot linger next to the fresh single-key headline. The prestamp must
    write the column as SQL NULL (present, Python None) — NOT omit it (omission is
    exactly what stranded the stale object). Neuter: revert the authoritative NULL
    → the column is absent from the prestamp → `in` assert reddens."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=False)]  # perp-only → mtm_attempted=False
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert "metrics_json_by_basis" in prestamp, (
        "the not-attempted arm must WRITE metrics_json_by_basis (authoritative "
        "clear), not omit it — omission strands the stale composite object"
    )
    assert prestamp["metrics_json_by_basis"] is None


@pytest.mark.asyncio
async def test_mtm_headline_flip_clears_stale_by_basis() -> None:
    """FABLE MED-HIGH regression (trigger b): an OPTIONS book whose
    returns_denominator_config.pnl_basis is flipped to mark_to_market skips the
    additive second pass (mtm_attempted=False), so a prior successful MTM object
    would freeze forever. The derive must AUTHORITATIVELY NULL metrics_json_by_basis
    so the frozen object is cleared. Neuter: revert → column omitted → reddens."""
    ctx, capture = _ctx(
        strategy_row={
            "asset_class": "crypto",
            "returns_denominator_config": _MTM_HEADLINE_CONFIG,
        }
    )
    # Options book, but the MTM-headline gate skips the second pass → ONE ledger
    # call, ONE combine. mtm_attempted=False.
    reports = [_report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    # The second (MTM) pass must NOT have run (only the cash pass crawled).
    assert len(_calls) == 1, "MTM-headline book must not attempt the additive pass"
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert "metrics_json_by_basis" in prestamp, (
        "the mtm-headline (not-attempted) arm must WRITE the authoritative NULL"
    )
    assert prestamp["metrics_json_by_basis"] is None


@pytest.mark.asyncio
async def test_terminal_failure_clears_stale_by_basis() -> None:
    """FABLE MED-HIGH regression (F-4): a terminal failure stamp (here the
    insufficient-history short circuit) on a strategy row that may carry a prior
    by-basis object must AUTHORITATIVELY NULL metrics_json_by_basis so a stale
    object cannot render as a live-looking money number on a now-FAILED row.
    Neuter: drop the metrics_json_by_basis=None from the failure stamp → the key
    is absent → the `in` assert reddens."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=False)]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_one_day_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    # Insufficient-history is a terminal DONE-with-failed-status short circuit.
    assert result.outcome == DispatchOutcome.DONE
    failed = _find_failed_stamp(capture)
    assert failed is not None, "expected a computation_status='failed' stamp"
    assert "metrics_json_by_basis" in failed, (
        "a terminal failure stamp must clear metrics_json_by_basis so a stale "
        "object can't render on a FAILED row"
    )
    assert failed["metrics_json_by_basis"] is None


# ── FIX 2 (Fable): the bounded MTM second pass degrades LOUD on timeout ──────

@pytest.mark.asyncio
async def test_mtm_second_pass_timeout_degrades_loud_not_failed_final() -> None:
    """FIX-2 regression: the additive MTM second pass is a FULL-HISTORY crawl bounded
    (asyncio.wait_for) to a fraction of the REMAINING derive budget. If it times out
    it must DEGRADE LOUD with the distinct ``mtm_second_pass_timeout`` reason — the
    cash headline still ships DONE and metrics_json_by_basis is authoritatively NULL
    — NEVER escape as a transient that retries the WHOLE derive to failed_final and
    sinks the healthy cash headline. Simulated by the SECOND (MTM) ledger crawl
    raising asyncio.TimeoutError (what wait_for propagates on expiry).
    Neuter: remove the ``except asyncio.TimeoutError`` arm → the TimeoutError
    propagates out of the handler (result is not DONE / raises) → reddens."""
    import asyncio as _asyncio

    from services.stitch_composite import MTM_REASON_SECOND_PASS_TIMEOUT

    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True), _report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(
        reports, side_effects=[None, _asyncio.TimeoutError()]
    )
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE, (
        "an MTM second-pass timeout must DEGRADE (cash ships DONE), never fail the "
        "whole derive to a retried transient"
    )
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert prestamp["metrics_json_by_basis"] is None
    assert prestamp["data_quality_flags"]["mtm_gated_reason"] == (
        MTM_REASON_SECOND_PASS_TIMEOUT
    ), "a bounded second-pass timeout must stamp the distinct timeout reason"
