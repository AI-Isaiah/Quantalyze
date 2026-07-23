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
from services.native_nav import InceptionReconciliationError, NativeLedger
from services.nav_twr import NavReconstructionError
from services.stitch_composite import (
    MTM_REASON_ANCHOR_RACE,
    MTM_REASON_SERIES_UNCOMPUTABLE,
    MTM_REASON_SUMMARY_COVERAGE,
)

# Phase 134 (smoothed_mtm kill-switch): the smoothed THIRD pass ships DARK behind
# SMOOTHED_MTM_ENABLED (default OFF). Every test in this module was written when the
# pass ran unconditionally and asserts it runs (3 ledger crawls, a smoothed by-basis
# key, etc.), so the module opts the flag ON explicitly — the gate is VISIBLE here.
# The dark-launch (flag-OFF) assertions live below and override with a per-test
# `monkeypatch.delenv("SMOOTHED_MTM_ENABLED")` (the flag is read per-call at run time).
pytestmark = pytest.mark.usefixtures("smoothed_mtm_enabled")

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


def _report(
    *,
    has_option_activity: bool,
    pre_mark_retention_option_days: list[tuple[str, str]] | None = None,
) -> CompletenessReport:
    """A COMPLETE report (empty ``expected`` → assert_ledger_complete passes).

    ``pre_mark_retention_option_days`` (Phase 132, defaulted so every pre-existing
    caller is byte-unchanged) carries the smoothed-pass pre-retention bucket that
    promotes the job to complete_with_warnings."""
    return CompletenessReport(
        total_return_rows=2,
        indexable_currencies=frozenset({"BTC"}),
        has_option_activity=has_option_activity,
        pre_mark_retention_option_days=pre_mark_retention_option_days or [],
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
    # Phase 132: an options book now runs THREE passes (cash, mtm, smoothed_mtm) — the
    # third combine side-effect + report accommodate the additive smoothed pass. This
    # test still pins the SECOND (mark_to_market) pass; the third-pass anchor identity
    # is pinned by test_options_book_runs_third_smoothed_pass_same_anchor.
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    )):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert len(calls) == 3, "options book runs cash + mark_to_market + smoothed_mtm"
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
    # Phase 132: cash + the ATTEMPTED-then-degraded MTM pass + the smoothed pass.
    assert len(calls) == 3, "MTM pass must be ATTEMPTED before degrading"
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


# ── Phase 102 (deferred anchor-race resolution) — label-only classification ──


@pytest.mark.asyncio
async def test_inception_reconciliation_on_mtm_stamps_anchor_race() -> None:
    """RACE-1: an InceptionReconciliationError on the MTM (second) crawl — the
    same-anchor race where a mid-crawl event lands in the MTM rows but not the
    once-read anchor — DEGRADES with the DISTINCT transient reason
    ``mtm_anchor_race`` (NOT the permanent-sounding coverage reason), writes an
    authoritative SQL NULL for the by-basis object (stale-heal), and the CASH derive
    still COMPLETES DONE (cash rows upserted + compute job enqueued). Neuter: revert
    the isinstance branch to an unconditional MTM_REASON_SUMMARY_COVERAGE → RED."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True)]
    ledger_mock, calls = _recording_ledger(
        reports,
        side_effects=[
            None,
            InceptionReconciliationError(
                currencies=["BTC"], venue="deribit", breach_ratio=3.2,
            ),
        ],
    )
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    )):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE, (
        "a mid-crawl anchor race must DEGRADE (cash ships), never retry-to-failed"
    )
    # Phase 132: cash + the ATTEMPTED-then-degraded MTM pass + the smoothed pass.
    assert len(calls) == 3, "MTM pass must be ATTEMPTED before the race degrade"
    # cash still ships: csv rows upserted + compute job enqueued
    assert any(
        name == "csv_daily_returns" and op == "upsert"
        for op, name in capture["ops"]
    )
    assert any(rpc == "enqueue_compute_job" for rpc, _ in capture["rpc_calls"])
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    # the DISTINCT transient reason, NOT the coverage stamp
    assert prestamp["data_quality_flags"]["mtm_gated_reason"] == MTM_REASON_ANCHOR_RACE
    assert MTM_REASON_ANCHOR_RACE != MTM_REASON_SUMMARY_COVERAGE
    # Phase 132: MTM degraded (its key healed/absent) but the smoothed pass SUCCEEDED,
    # so the by-basis object carries smoothed_mtm — smoothing OPENS what MTM keeps
    # closed. (Pre-132 this was an authoritative SQL NULL.)
    assert set(prestamp["metrics_json_by_basis"]) == {"smoothed_mtm"}


@pytest.mark.asyncio
async def test_non_inception_structural_mtm_failure_keeps_coverage_reason() -> None:
    """RACE-2: a NON-inception structural failure (a plain NavReconstructionError,
    the parent class) still stamps the coverage reason
    ``mtm_summary_coverage_incomplete`` — the new anchor-race branch must NOT hijack
    every structural family, only the InceptionReconciliationError subclass. Neuter:
    drop the isinstance guard (classify ALL as anchor-race) → RED."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True)]
    ledger_mock, calls = _recording_ledger(
        reports,
        side_effects=[
            None,
            NavReconstructionError("schema-drifted flow amount (not an inception breach)"),
        ],
    )
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    )):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    # Phase 132: cash + the ATTEMPTED-then-degraded MTM pass + the smoothed pass.
    assert len(calls) == 3
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert prestamp["data_quality_flags"]["mtm_gated_reason"] == (
        MTM_REASON_SUMMARY_COVERAGE
    ), "a non-inception structural failure must keep the coverage reason"


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
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
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
    # Phase 132: an options book carries BOTH mark_to_market and smoothed_mtm; cash
    # is STILL absent (it would activate the recomputed cash overlay / SC-4 divergence).
    assert set(by_basis.keys()) == {"mark_to_market", "smoothed_mtm"}, (
        "single-key by-basis carries mark_to_market + smoothed_mtm (never a "
        "cash_settlement key, which would risk SC-4 divergence)"
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
    """Wave-0 gap 3 (Phase-132 contract): a degraded MTM pass HEALS its own
    mark_to_market key (absent from the by-basis object) AND stamps
    data_quality_flags.mtm_gated_reason. Post-132 the object is NOT NULL when the
    smoothed pass succeeds — smoothing opens what MTM keeps closed — so the invariant
    this test pins is 'mark_to_market absent + reason stamped', not 'object is NULL'
    (the NULL-heal-when-nothing-succeeds case is pinned by
    test_perp_only_skips_smoothed_pass_sc4)."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True)]
    ledger_mock, _calls = _recording_ledger(
        reports,
        side_effects=[None, LedgerValuationError("summary hole mid-window")],
    )
    combine = MagicMock(return_value=(_mtm_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert "metrics_json_by_basis" in prestamp, (
        "an ATTEMPTED-but-degraded pass must WRITE the column to heal a stale "
        "mark_to_market key from a prior successful derive"
    )
    # MTM degraded → its key is HEALED (absent); the smoothed pass succeeded → present.
    assert "mark_to_market" not in (prestamp["metrics_json_by_basis"] or {}), (
        "a degraded MTM pass must heal (omit) its mark_to_market key"
    )
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
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
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
    # Run A: options book, MTM + smoothed passes run + succeed (distinct MTM series).
    # Phase 132: the third combine side-effect feeds the additive smoothed pass; the
    # cash track (_cash_track) EXCLUDES metrics_json_by_basis, so cash parity is
    # unaffected by the third basis.
    ctx_a, cap_a = _ctx(strategy_row={"asset_class": "crypto"})
    reports_a = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_a, _ = _recording_ledger(reports_a)
    combine_a = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
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
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
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
    # Phase 132: options book → mark_to_market + smoothed_mtm.
    assert isinstance(by_basis, dict) and set(by_basis) == {
        "mark_to_market", "smoothed_mtm",
    }
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
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [
        _patch_benchmark(),
        # Phase 103: the compute now lives INSIDE derive_basis_series, which binds
        # compute_all_metrics via a from-import — patch the helper's bound name so
        # the ValueError propagates out of the shared route into the seam's degrade
        # arm (patching services.metrics.compute_all_metrics would miss it).
        patch(
            "services.basis_series.compute_all_metrics",
            new=MagicMock(side_effect=ValueError("interior chain-break")),
        ),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    # Phase 132: the global compute reject degrades BOTH mark_to_market AND smoothed_mtm
    # (the smoothed SCALAR compute degrades symmetrically — a math chain-break over an
    # honest series is NOT a marks/fabrication failure), so the by-basis object heals
    # to SQL NULL exactly as before.
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
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
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
        # Phase 103: the compute is now the one inside derive_basis_series — spy on
        # the helper's bound compute_all_metrics to observe the periods it receives.
        patch(
            "services.basis_series.compute_all_metrics",
            new=MagicMock(side_effect=_spy),
        ),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    # Phase 104 added an additive cash derive and Phase 132 a smoothed_mtm derive at
    # the SAME seam, each running compute_all_metrics (crypto → √365), so the spy sees
    # THREE entries: MTM (first), smoothed_mtm (second), cash (third). ALL MUST be 365
    # — dropping asset_class → [252, 252, 252] reddens.
    assert seen_periods == [365, 365, 365], (
        f"compute_all_metrics received periods_per_year={seen_periods} — a "
        "crypto/Deribit book MUST annualize the MTM, smoothed_mtm, and cash series "
        "on √365 (#597), not the 252 default; asset_class was dropped from the "
        "single-key _load_strategy select"
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
    # Phase 132: the MTM second-pass TIMEOUT degrades (its key absent) but the smoothed
    # THIRD pass still runs + succeeds → by-basis carries smoothed_mtm (pre-132: NULL).
    assert set(prestamp["metrics_json_by_basis"]) == {"smoothed_mtm"}
    assert prestamp["data_quality_flags"]["mtm_gated_reason"] == (
        MTM_REASON_SECOND_PASS_TIMEOUT
    ), "a bounded second-pass timeout must stamp the distinct timeout reason"


# ── Phase 103 (MTM-04): single-key seam routes through the shared derive ─────
# The MTM scalars AND the persisted mtm_daily_returns series row now come from the
# ONE shared services.basis_series.derive_basis_series call (Plan 103-01). These
# tests pin the WIRING (call-site invokes the helper, not a parallel inline
# compute) and the persist/heal matrix (success → row from the SAME result;
# degrade / not-attempted → delete the stale row). The seam imports the helper
# function-locally, so patching the SOURCE module attribute
# (services.basis_series.*) reaches the call-time binding.


@pytest.mark.asyncio
async def test_single_key_routes_through_shared_derive_and_persists() -> None:
    """WIRING: an options book whose MTM pass succeeds derives its scalars via
    derive_basis_series — called ONCE with (mtm_returns, benchmark_rets=None) and
    the crypto √365 / geometric / calendar conventions — and hands the SAME
    BasisSeriesResult to persist_basis_series(basis='mark_to_market'). Neutering the
    call site to a parallel inline compute would leave the spy uncalled → reddens."""
    import services.basis_series as _bs

    ctx, _capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    _real_derive = _bs.derive_basis_series
    _results: list[Any] = []

    def _derive_spy(*a: Any, **k: Any) -> Any:
        r = _real_derive(*a, **k)
        _results.append(r)
        return r

    derive_spy = MagicMock(side_effect=_derive_spy)
    persist_spy = MagicMock()
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [
        _patch_benchmark(),
        patch("services.basis_series.derive_basis_series", new=derive_spy),
        patch("services.basis_series.persist_basis_series", new=persist_spy),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    # Phase 104 added an additive cash_settlement derive+persist and Phase 132 a
    # smoothed_mtm derive+persist at the SAME seam, so the shared helper is now called
    # THREE times — MTM (first), smoothed_mtm (second), cash (third). The MTM wiring
    # this test pins is the FIRST call.
    assert derive_spy.call_count == 3
    _mtm_call = derive_spy.call_args_list[0]
    pd.testing.assert_series_equal(_mtm_call.args[0], _mtm_series())
    assert _mtm_call.args[1] is None, "benchmark_rets must be None (patched fetch → (None, True))"
    assert _mtm_call.kwargs["periods_per_year"] == 365, "crypto/Deribit MTM annualizes on √365"
    assert _mtm_call.kwargs["cumulative_method"] == "geometric"
    assert _mtm_call.kwargs["day_basis"] == "calendar"
    # persist got the EXACT BasisSeriesResult the MTM derive produced — never a
    # separately-computed object (that would bypass the anti-divergence guard). The
    # persist order is MTM (0), cash (1), smoothed_mtm (2).
    assert persist_spy.call_count == 3
    _mtm_persist = persist_spy.call_args_list[0]
    assert _mtm_persist.kwargs["basis"] == "mark_to_market"
    assert _mtm_persist.kwargs["result"] is _results[0]
    # the SECOND persist is the additive Phase-104 cash series (SERIES-ONLY, dark).
    _cash_persist = persist_spy.call_args_list[1]
    assert _cash_persist.kwargs["basis"] == "cash_settlement"
    # the THIRD persist is the additive Phase-132 smoothed_mtm series.
    _smoothed_persist = persist_spy.call_args_list[2]
    assert _smoothed_persist.kwargs["basis"] == "smoothed_mtm"


@pytest.mark.asyncio
async def test_single_key_derive_helper_valueerror_degrades_and_heals() -> None:
    """WIRING FALSIFIABILITY: patch derive_basis_series to RAISE ValueError → the
    seam degrades EXACTLY like the compute-reject path (DONE, SQL-NULL by-basis,
    SERIES_UNCOMPUTABLE reason) AND heals the stale series row
    (persist_basis_series(..., result=None)). Proves the seam INVOKES the helper —
    a parallel inline compute would ignore the patch and persist a live object."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    persist_spy = MagicMock()
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [
        _patch_benchmark(),
        patch(
            "services.basis_series.derive_basis_series",
            new=MagicMock(side_effect=ValueError("helper reject")),
        ),
        patch("services.basis_series.persist_basis_series", new=persist_spy),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert prestamp["metrics_json_by_basis"] is None
    assert prestamp["data_quality_flags"]["mtm_gated_reason"] == (
        MTM_REASON_SERIES_UNCOMPUTABLE
    )
    # The patched derive raises for the MTM, smoothed_mtm, AND the additive Phase-104
    # cash calls. ALL THREE heal (result=None): HIGH-02 (132 review) — the smoothed
    # persist guard keys on smoothed_ATTEMPTED (an option-activity signal, so SC-4's
    # no-RPC-on-a-no-option-key holds), and an attempted-but-degraded smoothed pass
    # must heal-DELETE the stale smoothed_mtm series row exactly like MTM/cash
    # (Pitfall 5: a stale money series must never outlive the scalar omission).
    assert persist_spy.call_count == 3
    assert all(c.kwargs["result"] is None for c in persist_spy.call_args_list), (
        "a degraded derive must HEAL the stale series row (result=None), never "
        "persist a stale object next to an authoritative-NULL scalar write"
    )
    assert {c.kwargs["basis"] for c in persist_spy.call_args_list} == {
        "mark_to_market", "cash_settlement", "smoothed_mtm",
    }


@pytest.mark.asyncio
async def test_single_key_not_attempted_heals_series_row() -> None:
    """HEAL matrix (not-attempted): a perp-only book never attempts the MTM pass,
    yet the seam AUTHORITATIVELY heals — persist_basis_series(..., result=None)
    deletes any stale mtm_daily_returns row, mirroring the by-basis SQL-NULL write.
    Neuter (gate the persist behind mtm_attempted) → the heal is skipped → reddens."""
    ctx, _capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=False)]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    persist_spy = MagicMock()
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [
        _patch_benchmark(),
        patch("services.basis_series.persist_basis_series", new=persist_spy),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    # Two persists now fire at the seam: the not-attempted MTM heal (result=None) and
    # the additive Phase-104 cash series (which DERIVES successfully → result present).
    assert persist_spy.call_count == 2
    _mtm_persist = next(
        c for c in persist_spy.call_args_list if c.kwargs["basis"] == "mark_to_market"
    )
    assert _mtm_persist.kwargs["result"] is None, (
        "a not-attempted MTM derive must heal (delete) the mark_to_market series row"
    )
    _cash_persist = next(
        c for c in persist_spy.call_args_list if c.kwargs["basis"] == "cash_settlement"
    )
    assert _cash_persist.kwargs["result"] is not None, (
        "the additive cash series persists its derived rows (not a heal) on a clean derive"
    )


# ── Phase 132 (SMTM-01): the additive smoothed_mtm THIRD pass ───────────────────
#
# The single-key sibling of the composite third pass. On a Deribit options book the
# derive now runs a THIRD ledger pass (pnl_basis="smoothed_mtm"), derives + persists
# a smoothed_mtm series (KIND_SMOOTHED_MTM), and writes
# metrics_json_by_basis["smoothed_mtm"] alongside mark_to_market. Gated on the SAME
# has_option_activity signal as the MTM pass (no new signal invented) — perp-only /
# key-mode / ccxt / MTM-configured-headline all skip it (SC-4). GLB-2 (v1.14): the
# smoothed pass now DEGRADES LIKE the MTM pass — a structural LedgerValuationError
# (holed marks — incl. the retention-STRADDLE / crawl-day cases) omits the additive
# smoothed key while the cash+MTM headline still ships DONE (never a silent two-basis
# fallback, and never a whole-job FAILED that destroys the healthy cash factsheet).


@pytest.mark.asyncio
async def test_options_book_runs_third_smoothed_pass_same_anchor() -> None:
    """Options book: build_deribit_native_ledger is called EXACTLY THREE times —
    cash, then mark_to_market, then smoothed_mtm — ALL on the SAME one-read
    account_state. The by-basis object carries BOTH mark_to_market and smoothed_mtm;
    the cash headline stays the un-persisted default. Neuter (drop the third pass /
    gate it off has_option_activity) → RED."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert len(calls) == 3, "options book must run a THIRD smoothed_mtm pass"
    assert calls[0]["pnl_basis"] == "cash_settlement"
    assert calls[1]["pnl_basis"] == "mark_to_market"
    assert calls[2]["pnl_basis"] == "smoothed_mtm"
    assert (
        calls[0]["account_state"] is calls[1]["account_state"]
        is calls[2]["account_state"]
    ), "all three passes must anchor on the SAME one-read account_state"
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    by_basis = prestamp.get("metrics_json_by_basis")
    assert isinstance(by_basis, dict)
    assert set(by_basis.keys()) == {"mark_to_market", "smoothed_mtm"}, (
        "an options book persists BOTH mark_to_market and smoothed_mtm; cash stays "
        "the un-persisted headline"
    )
    assert pd.notna(by_basis["smoothed_mtm"]["cumulative_return"])


@pytest.mark.asyncio
async def test_structural_smoothed_failure_degrades_keeps_cash_mtm() -> None:
    """GLB-2: a LedgerValuationError on the THIRD (smoothed) crawl DEGRADES — the
    derive still completes DONE with the cash headline + the mark_to_market by-basis
    key, and the smoothed_mtm key is OMITTED. This proves flipping SMOOTHED_MTM_ENABLED
    ON can never sink a healthy options book whose smoothed marks have a structural hole.
    Neuter the new smoothed structural-degrade catch (let the LedgerValuationError reach
    the outer permanent `except LedgerValuationError`) → RED: the job FAILS permanent and
    no by-basis object ships."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    # Raise ONLY on the third (smoothed) crawl — cash + mark_to_market build cleanly.
    ledger_mock, calls = _recording_ledger(
        reports,
        side_effects=[
            None,
            None,
            LedgerValuationError("expiry-day book-channel boundary: no smoothed mark"),
        ],
    )
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    # The smoothed structural failure DEGRADES — cash+MTM headline SURVIVES DONE.
    assert result.outcome == DispatchOutcome.DONE, (
        "a structural smoothed third-pass failure must DEGRADE (cash+MTM ship), "
        "never fail the whole derive"
    )
    assert len(calls) == 3, "all three crawls are attempted (cash, mtm, smoothed)"
    assert calls[2]["pnl_basis"] == "smoothed_mtm"
    # No terminal failed stamp — the healthy cash factsheet is untouched.
    assert _find_failed_stamp(capture) is None, (
        "a smoothed structural degrade must NOT stamp the analytics row failed"
    )
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    by_basis = prestamp.get("metrics_json_by_basis")
    assert isinstance(by_basis, dict)
    assert set(by_basis.keys()) == {"mark_to_market"}, (
        "the smoothed_mtm key is OMITTED on a structural degrade; mark_to_market "
        "(from the healthy second pass) survives"
    )


# ── Phase 134 (kill-switch): SMOOTHED_MTM_ENABLED off ⇒ smoothed pass is DARK ────

@pytest.mark.asyncio
async def test_smoothed_dark_launch_options_book_skips_third_pass(monkeypatch) -> None:
    """KILL-SWITCH (single-key): with SMOOTHED_MTM_ENABLED off (the dark default), an
    options book runs EXACTLY TWO crawls (cash + mark_to_market) — the smoothed THIRD
    pass is SKIPPED ENTIRELY: no third build_deribit_native_ledger call, and the
    by-basis object carries ONLY mark_to_market (no smoothed_mtm key). This proves the
    smoothed basis is fully dormant when dark. Neuter (drop the flag gate → smoothed
    runs unconditionally) → RED (3 calls, smoothed_mtm key appears)."""
    # Override the module-level `smoothed_mtm_enabled` opt-in: the flag is read
    # per-call at run time, so deleting it here forces the dark (OFF) path.
    monkeypatch.delenv("SMOOTHED_MTM_ENABLED", raising=False)
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert len(calls) == 2, (
        "dark launch: an options book runs ONLY cash + mark_to_market — the smoothed "
        "THIRD crawl must NOT run when SMOOTHED_MTM_ENABLED is off"
    )
    assert [c["pnl_basis"] for c in calls] == ["cash_settlement", "mark_to_market"]
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    by_basis = prestamp.get("metrics_json_by_basis")
    assert isinstance(by_basis, dict)
    assert set(by_basis.keys()) == {"mark_to_market"}, (
        "dark launch: NO smoothed_mtm by-basis key — the basis is fully dormant; "
        "cash/MTM are byte-identical to the pre-v1.14 two-pass path"
    )


# A strategy whose returns_denominator_config pins the HEADLINE basis to smoothed_mtm.
# allocated_capital._VALID_PNL_BASES accepts it (config parsing is flag-agnostic), so
# this is the RT-4 kill-switch-bypass vector: with the flag OFF it must NOT reach the
# headline crawl.
_SMOOTHED_HEADLINE_CONFIG = {
    "denominator": "allocated_capital",
    "pnl_basis": "smoothed_mtm",
    "metrics_basis": "active_day",
    "cumulative_method": "simple",
    "capital_schedule": [
        {"effective_from": "2024-01-01", "capital_usd": 100000.0},
    ],
}


@pytest.mark.asyncio
async def test_smoothed_headline_config_flag_off_fails_loud_no_crawl(monkeypatch) -> None:
    """RT-4 KILL-SWITCH BYPASS: a strategy configured with pnl_basis='smoothed_mtm'
    as its HEADLINE basis must NOT run the smoothed native-ledger crawl when
    SMOOTHED_MTM_ENABLED is off — the derive must FAIL LOUD PERMANENT before any crawl,
    never persist a smoothed headline into the cash slot. Without the guard the headline
    build_deribit_native_ledger would run in the smoothed basis (bypassing the flag) and
    the job would complete DONE → RED. The two additive-pass gates never even engage
    because the headline is smoothed (not cash), so the flag's only defence here is this
    headline guard."""
    monkeypatch.delenv("SMOOTHED_MTM_ENABLED", raising=False)
    ctx, capture = _ctx(
        strategy_row={
            "asset_class": "crypto",
            "returns_denominator_config": _SMOOTHED_HEADLINE_CONFIG,
        }
    )
    reports = [_report(has_option_activity=True)]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent", (
        "a smoothed_mtm headline behind the OFF kill-switch is a structural config "
        "refusal, never a retry"
    )
    assert result.error_message is not None
    assert "SMOOTHED_MTM_ENABLED" in result.error_message
    # The guard fires BEFORE any live crawl — no smoothed (or any) ledger build ran.
    assert calls == [], (
        "the headline smoothed crawl must NOT run when the flag is off — the guard "
        "must short-circuit before build_deribit_native_ledger"
    )
    # A terminal failed stamp lands so the poller reaches a gate; no by-basis object.
    failed = _find_failed_stamp(capture)
    assert failed is not None, "the kill-switch refusal must stamp a terminal failed row"
    assert not any(
        isinstance(p, dict) and p.get("metrics_json_by_basis")
        for _n, p, _c in capture["upserts"]
    ), "no smoothed by-basis object may ship on the kill-switch refusal"


@pytest.mark.asyncio
async def test_smoothed_headline_config_flag_on_allowed() -> None:
    """RT-4 companion: with SMOOTHED_MTM_ENABLED ON (the module default) a strategy
    configured with pnl_basis='smoothed_mtm' as its HEADLINE basis is ALLOWED — the
    guard must NOT over-fire. The headline native-ledger crawl runs in the smoothed
    basis and the derive completes DONE (no permanent kill-switch refusal). This pins
    the guard's precise scope: it fires ONLY when the flag is off. (The additive MTM /
    smoothed passes never engage here — both require a CASH headline — so exactly ONE
    crawl runs, in the smoothed basis.)"""
    # The module-level `smoothed_mtm_enabled` fixture leaves the flag ON — no delenv.
    ctx, capture = _ctx(
        strategy_row={
            "asset_class": "crypto",
            "returns_denominator_config": _SMOOTHED_HEADLINE_CONFIG,
        }
    )
    reports = [_report(has_option_activity=True)]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE, (
        "a smoothed_mtm headline is admissible when the kill-switch is ON — the guard "
        "must not over-fire"
    )
    assert _find_failed_stamp(capture) is None, (
        "no kill-switch refusal may stamp failed when the flag is ON"
    )
    # Exactly ONE crawl, in the smoothed basis (the additive passes require a cash
    # headline, so neither the MTM nor the smoothed additive pass engages here).
    assert [c["pnl_basis"] for c in calls] == ["smoothed_mtm"], (
        "the headline crawl runs in the configured smoothed_mtm basis when the flag "
        "is ON"
    )


@pytest.mark.asyncio
async def test_smoothed_headline_config_flag_on_allowed() -> None:
    """RT-4 companion: with SMOOTHED_MTM_ENABLED ON (module default), the SAME
    pnl_basis='smoothed_mtm' headline config IS admissible — the derive runs the
    headline native-ledger crawl in the smoothed basis and completes DONE. This proves
    the guard is a pure flag gate (it refuses ONLY when the flag is off), not a blanket
    ban on the basis. Exactly ONE crawl runs (a smoothed headline is not cash, so the
    additive MTM/smoothed passes — both gated on the cash headline — never engage)."""
    ctx, _capture = _ctx(
        strategy_row={
            "asset_class": "crypto",
            "returns_denominator_config": _SMOOTHED_HEADLINE_CONFIG,
        }
    )
    reports = [_report(has_option_activity=True)]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE, (
        "with the flag ON, a smoothed_mtm headline is admissible and completes"
    )
    assert len(calls) == 1, "a smoothed headline runs exactly one crawl (no additive passes)"
    assert calls[0]["pnl_basis"] == "smoothed_mtm", (
        "the headline crawl must run in the configured smoothed_mtm basis when allowed"
    )


@pytest.mark.asyncio
async def test_smoothed_dark_launch_mark_hole_cannot_fail_job(monkeypatch) -> None:
    """THE KILL-SWITCH POINT (single-key): a structural smoothed mark-hole
    (LedgerValuationError) CANNOT touch a job when the flag is off — the smoothed crawl
    is never even attempted, so the poisoned third side-effect never fires and the job
    completes DONE on its cash/MTM headline with only TWO crawls. (Since GLB-2 the same
    mark-hole DEGRADES rather than fails even when the flag is ON — see
    test_structural_smoothed_failure_degrades_keeps_cash_mtm — but the dark path proves
    the pass is skipped ENTIRELY, not merely degraded.) Neuter (remove the flag gate) →
    RED: the poisoned 3rd crawl fires (len(calls) == 3)."""
    monkeypatch.delenv("SMOOTHED_MTM_ENABLED", raising=False)
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, calls = _recording_ledger(
        reports,
        # cash ok, MTM ok — the THIRD (smoothed) side-effect is a structural mark-hole
        # that would fail the job loud IF the smoothed pass ran. Dark ⇒ it never runs.
        side_effects=[None, None, LedgerValuationError(
            "instrument BTC-27JUN25-100000-C straddles the mark-retention horizon"
        )],
    )
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE, (
        "dark launch: a smoothed structural mark-hole must NOT be able to fail a real "
        "prod job — the smoothed pass is skipped before any ledger build"
    )
    assert len(calls) == 2, "smoothed crawl (the poisoned 3rd) must never be attempted"


@pytest.mark.asyncio
async def test_smoothed_persisted_when_mtm_degrades() -> None:
    """THE FEATURE VALUE: the MTM pass structurally DEGRADES (LedgerValuationError →
    mtm_gated_reason, by-basis mark_to_market absent) yet the smoothed pass SUCCEEDS,
    so by-basis == {"smoothed_mtm"} (NOT None). Smoothing is exactly the fix for the
    un-smoothed book that MTM honestly gates off. Neuter (skip smoothed when MTM
    degrades / fall back to None) → RED."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, calls = _recording_ledger(
        reports,
        # cash ok, MTM raises (degrades), smoothed (idx 2) ok
        side_effects=[None, LedgerValuationError("summary hole mid-window")],
    )
    combine = MagicMock(return_value=(_mtm_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert len(calls) == 3, "smoothed pass must run EVEN WHEN MTM degrades"
    assert calls[2]["pnl_basis"] == "smoothed_mtm"
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    by_basis = prestamp.get("metrics_json_by_basis")
    assert isinstance(by_basis, dict), (
        "a degraded-MTM + successful-smoothed book must persist a by-basis object, "
        "NOT NULL — smoothing opens what MTM keeps closed"
    )
    assert set(by_basis.keys()) == {"smoothed_mtm"}, (
        "MTM degraded → its key is absent; smoothed succeeded → its key is present"
    )
    # the MTM degrade reason still stamps (MTM stays honestly gated off)
    assert prestamp["data_quality_flags"]["mtm_gated_reason"] == (
        MTM_REASON_SUMMARY_COVERAGE
    )


@pytest.mark.asyncio
async def test_perp_only_skips_smoothed_pass_sc4() -> None:
    """Perp-only (has_option_activity=False): ONE cash crawl only — NO smoothed pass,
    NO smoothed series persist (SC-4: no option activity ⇒ no smoothed artifacts),
    by-basis authoritatively NULL. Neuter (run smoothed unconditionally) → RED."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=False)]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    persist_spy = MagicMock()
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [
        _patch_benchmark(),
        patch("services.basis_series.persist_basis_series", new=persist_spy),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert len(calls) == 1, "perp-only book must NOT run a smoothed crawl"
    # NO smoothed series persist AT ALL (not even a heal) — byte-identical to pre-phase
    assert all(
        c.kwargs["basis"] != "smoothed_mtm" for c in persist_spy.call_args_list
    ), "a no-option key must persist NO smoothed_mtm artifacts (SC-4)"
    prestamp = _find_prestamp(capture)
    assert prestamp is not None and prestamp["metrics_json_by_basis"] is None


@pytest.mark.asyncio
async def test_smoothed_series_persisted_via_smoothed_kind() -> None:
    """The smoothed pass persists its derived series through persist_basis_series with
    basis="smoothed_mtm" (KIND_SMOOTHED_MTM), a fresh result (not a heal) on success.
    Neuter (drop the smoothed series persist) → RED."""
    ctx, _capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    persist_spy = MagicMock()
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [
        _patch_benchmark(),
        patch("services.basis_series.persist_basis_series", new=persist_spy),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    _smoothed_persist = next(
        (c for c in persist_spy.call_args_list
         if c.kwargs["basis"] == "smoothed_mtm"),
        None,
    )
    assert _smoothed_persist is not None, "smoothed pass must persist a smoothed_mtm series"
    assert _smoothed_persist.kwargs["result"] is not None, (
        "a successful smoothed pass persists its derived rows (not a heal)"
    )


@pytest.mark.asyncio
async def test_pre_mark_retention_stamps_complete_with_warnings() -> None:
    """The smoothed completeness report's pre_mark_retention_option_days bucket
    (marks aged past the retention horizon → those days fell back to cash-basis)
    stamps the pre_mark_retention_option_dailies warn flag via the existing
    NAV_TWR_GUARD_KEYS mechanism → complete_with_warnings. Neuter (drop the stamp /
    unregister the key) → RED."""
    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(
            has_option_activity=True,
            pre_mark_retention_option_days=[("BTC", "2022-01-03")],
        ),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert prestamp["data_quality_flags"].get("pre_mark_retention_option_dailies") is True, (
        "the pre-retention bucket must stamp the warn flag (complete_with_warnings)"
    )


@pytest.mark.asyncio
async def test_smoothed_third_pass_timeout_degrades_not_failed_final() -> None:
    """HIGH-01 (132 review) — FIX-2 sibling for the THIRD pass: the smoothed crawl is
    bounded to a slice of the REMAINING derive budget (the SAME machinery as the MTM
    second pass). If it times out it must DEGRADE (skip — the by-basis simply lacks
    smoothed_mtm) with the timeout attributed to the SMOOTHED pass — the cash headline
    and the already-computed MTM object still ship DONE. It must NEVER escape to the
    outer cash-pass TimeoutError arm as a transient that retries the WHOLE derive to
    failed_final (total factsheet loss on a large options book). Simulated by the
    THIRD (smoothed) ledger crawl raising asyncio.TimeoutError (what wait_for
    propagates on expiry). Neuter (drop the smoothed-local TimeoutError arm) → the
    outer arm returns FAILED/transient blaming the cash pass → reddens."""
    import asyncio as _asyncio

    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, calls = _recording_ledger(
        reports, side_effects=[None, None, _asyncio.TimeoutError()]
    )
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE, (
        "a smoothed third-pass timeout must DEGRADE (cash ships DONE), never escape "
        "as a transient that retries the whole derive to failed_final"
    )
    assert len(calls) == 3, "the smoothed crawl was attempted (then timed out)"
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    # MTM succeeded; ONLY smoothed degrades (its key absent — honest omission).
    assert set(prestamp["metrics_json_by_basis"]) == {"mark_to_market"}
    assert "mtm_gated_reason" not in prestamp["data_quality_flags"], (
        "a SMOOTHED-pass timeout must not be mis-attributed to the MTM pass"
    )


@pytest.mark.asyncio
async def test_smoothed_third_pass_insufficient_budget_skips_cash_ships() -> None:
    """HIGH-01 (132 review) — the refusal floor: when the cash crawl legitimately
    consumed (nearly) the whole 15-min derive budget, the smoothed third pass must
    REFUSE to start (same 60s floor as the MTM second pass), never launch a
    full-history crawl bounded at the fixed 810s that the outer wait_for is
    guaranteed to kill first (transient → 3 identical attempts → failed_final).
    Budget exhaustion simulated by shrinking TIMEOUT_PER_KIND['derive_broker_dailies']
    to 1s — both additive passes fall below their floor and refuse; ONLY the cash
    crawl runs and the derive completes DONE. Neuter (keep the fixed
    _BROKER_CRAWL_TIMEOUT_S bound with no remaining-budget check) → the smoothed
    crawl STARTS (2 ledger calls, smoothed_mtm persisted) → reddens."""
    from services.stitch_composite import MTM_REASON_SECOND_PASS_TIMEOUT

    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [_report(has_option_activity=True)]
    ledger_mock, calls = _recording_ledger(reports)
    combine = MagicMock(return_value=(_cash_series(), {"used_heuristic_capital": False}))
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [
        _patch_benchmark(),
        patch.dict(
            "services.job_worker.TIMEOUT_PER_KIND",
            {"derive_broker_dailies": 1.0},
        ),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE, (
        "an exhausted budget must DEGRADE the additive passes, never sink the derive"
    )
    assert len(calls) == 1, (
        "below the budget floor NEITHER additive pass may start a full-history "
        "crawl — only the cash crawl runs"
    )
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    assert prestamp["metrics_json_by_basis"] is None, (
        "no additive basis is persisted when both passes refuse on the budget floor"
    )
    # The MTM refusal stamps its distinct machine reason (pre-existing FIX-2).
    assert prestamp["data_quality_flags"]["mtm_gated_reason"] == (
        MTM_REASON_SECOND_PASS_TIMEOUT
    )


@pytest.mark.asyncio
async def test_smoothed_combine_runs_off_event_loop() -> None:
    """LOW-03 (132 review) — WEDGE-01 class: the smoothed third pass's SYNCHRONOUS
    CPU-bound combine_native_ledger (options ledgers are the largest books) must run
    OFF the shared event-loop thread via asyncio.to_thread, like the composite arm —
    a third on-loop full-book pandas combine linearly extends the heartbeat-
    starvation window that got Eclipse's worker 503-restarted mid-job. Proven by
    THREAD IDENTITY (Rule 9): the smoothed (third) combine executes in a worker
    thread. The cash/MTM combines are byte-frozen pre-existing on-loop code — this
    test deliberately does NOT pin them either way, so a future WEDGE-01 sweep that
    offloads them cannot redden it. Run the smoothed combine inline on the loop (the
    pre-fix code) → idents match → reddens."""
    import threading

    loop_thread_id = threading.get_ident()
    seen_threads: list[int] = []
    _outs = [
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ]

    def _combine(*_a: Any, **_k: Any) -> tuple[pd.Series, dict[str, Any]]:
        seen_threads.append(threading.get_ident())
        return _outs[len(seen_threads) - 1]

    ctx, _capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock,
        combine_mock=MagicMock(side_effect=_combine),
    ) + [_patch_benchmark()]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE
    assert len(seen_threads) == 3, "cash, MTM, and smoothed combines all ran"
    assert seen_threads[2] != loop_thread_id, (
        "the smoothed third-pass combine_native_ledger ran ON the event-loop "
        "thread — it MUST be offloaded via asyncio.to_thread (WEDGE-01) so "
        "CPU-bound pandas cannot starve the healthz heartbeat"
    )


@pytest.mark.asyncio
async def test_smoothed_scalar_degrade_heals_series_row() -> None:
    """HIGH-02 (132 review) — Pitfall-5: an ATTEMPTED smoothed pass whose SCALAR
    compute degrades (derive_basis_series ValueError on the smoothed series only)
    must heal-DELETE the smoothed_mtm series row
    (persist_basis_series(basis='smoothed_mtm', result=None)). Otherwise a prior
    successful derive's smoothed_mtm_daily_returns money-series row survives
    indefinitely while the authoritative by-basis scalar says ABSENT — a stale
    real-looking series in a table consumers read by bare (strategy_id, kind).
    smoothed_attempted is only ever True on option-activity keys, so the heal RPC
    never fires on a no-option key (SC-4 preserved — pinned separately by
    test_perp_only_skips_smoothed_pass_sc4). Neuter (re-guard the persist on a
    computed object) → no smoothed persist call → reddens."""
    import services.basis_series as _bs

    ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
    reports = [
        _report(has_option_activity=True),
        _report(has_option_activity=True),
        _report(has_option_activity=True),
    ]
    ledger_mock, _calls = _recording_ledger(reports)
    combine = MagicMock(side_effect=[
        (_cash_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
        (_mtm_series(), {"used_heuristic_capital": False}),
    ])
    _real_derive = _bs.derive_basis_series
    _derive_calls: list[int] = []

    def _derive_reject_smoothed_only(*a: Any, **k: Any) -> Any:
        # Seam call order: MTM (1st), smoothed_mtm (2nd), cash (3rd).
        _derive_calls.append(1)
        if len(_derive_calls) == 2:
            raise ValueError("smoothed interior chain-break")
        return _real_derive(*a, **k)

    persist_spy = MagicMock()
    with _apply(_base_patches(
        ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
    ) + [
        _patch_benchmark(),
        patch(
            "services.basis_series.derive_basis_series",
            new=MagicMock(side_effect=_derive_reject_smoothed_only),
        ),
        patch("services.basis_series.persist_basis_series", new=persist_spy),
    ]):
        result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})
    assert result.outcome == DispatchOutcome.DONE, (
        "a smoothed scalar compute-reject degrades (honest omission), never fails "
        "the cash headline"
    )
    prestamp = _find_prestamp(capture)
    assert prestamp is not None
    # MTM shipped; smoothed honestly ABSENT (scalar degraded).
    assert set(prestamp["metrics_json_by_basis"]) == {"mark_to_market"}
    # THE HEAL: the attempted-but-degraded smoothed pass deletes any stale series row.
    _smoothed_persists = [
        c for c in persist_spy.call_args_list if c.kwargs["basis"] == "smoothed_mtm"
    ]
    assert len(_smoothed_persists) == 1, (
        "an ATTEMPTED smoothed pass must always reach the smoothed series persist "
        "(fresh row on success, heal-DELETE on degrade)"
    )
    assert _smoothed_persists[0].kwargs["result"] is None, (
        "attempted-but-degraded must heal-DELETE (result=None) — a stale smoothed "
        "money series must never outlive the by-basis scalar omission (Pitfall 5)"
    )
