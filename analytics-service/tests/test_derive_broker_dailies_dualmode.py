"""Phase 35 (DAILIES-02) — dual-mode run_derive_broker_dailies_job unit tests.

The handler branches on the job's identity axis:

  - key-mode (job carries api_key_id): _allocator_key_preflight, upsert
    {api_key_id, allocator_id=key.user_id, strategy_id:None} with
    on_conflict="api_key_id,date", NO compute_analytics_from_csv enqueue, NO
    strategy_analytics stamp;
  - strategy-mode (job carries strategy_id): byte-unchanged —
    _exchange_preflight, on_conflict="strategy_id,date", strategy_analytics <2-day
    stamp, compute_analytics_from_csv enqueue.

These mock the exchange fetchers + combine_realized_and_funding + the supabase
client (mirroring tests/test_job_worker.py::TestDeriveBrokerDailies). Each
assertion is mutation-falsifiable: it fails if the branch is neutered (e.g. if
key-mode upserts on strategy_id, or fires the CSV enqueue, or trusts a payload
allocator_id).
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import numpy as np
import pandas as pd
import pytest

from services.broker_dailies import combine_realized_and_funding
from services.deribit_txn import deribit_dated_external_flows_usd
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from services.metrics import periods_per_year_for_asset_class
from services.nav_twr import NavReconstructionError, reconstruct_nav_and_twr
from tests.fixtures.deribit_flow_fixtures import (
    BTC_INDEX_2026_03_14,
    BTC_INDEX_2026_03_16,
    BTC_INDEX_2026_03_17,
    DAY_DOMINATING,
    DAY_INVERSE_WITH_INDEX,
    DAY_PURE_FLOW,
    dominating_withdrawal_rows,
    inverse_flow_day_with_index_rows,
    pure_flow_no_trade_rows,
)


# MT5-12 (D-15/D-16): every combiner in broker_dailies.py stamps a
# `series_completeness` verdict on its meta, and the derive persist seam now
# REFUSES (permanent FAILED) a series whose meta lacks a recognised one. A
# combiner mock that omits the key is therefore no longer a faithful stand-in
# for the producer it replaces, so the mocks below carry the verdict the REAL
# function emits: `combine_realized_and_funding` (binance/bybit/okx) always
# stamps fill_derived_unproven; `combine_native_ledger` (deribit) stamps
# ledger_complete. Hand-typed literals — nothing here imports the registry.
_CCXT_VERDICT = "fill_derived_unproven"
_LEDGER_VERDICT = "ledger_complete"


def _two_day_returns() -> pd.Series:
    """A >=2-day dense daily-return series (the upsert path requires >=2)."""
    return pd.Series(
        [0.01, -0.02],
        index=pd.DatetimeIndex(["2024-05-01", "2024-05-02"]),
        dtype="float64",
    )


def _build_ctx(*, key_row: dict, strategy_row: dict | None) -> tuple[MagicMock, dict]:
    """Build a mock _ExchangeContext and a capture dict for table operations.

    capture records:
      - capture['upserts']: list of (table_name, payload, on_conflict)
      - capture['rpc_calls']: list of (rpc_name, payload)
    """
    capture: dict = {"upserts": [], "rpc_calls": [], "deletes": [], "ops": [], "updates": []}

    ctx = MagicMock()
    ctx.exchange = AsyncMock()
    # NAVMTM plan 19 (D-18, D-19): an OKX derive reads the account's open option positions once a
    # day. The deliberate default is "no options", so every OKX test that is not ABOUT option value
    # keeps its assertions; a bare AsyncMock would answer with a non-dict and refuse the mark.
    ctx.exchange.privateGetAccountPositions = AsyncMock(return_value={"data": []})
    ctx.supabase = MagicMock()
    ctx.strategy_row = strategy_row
    ctx.key_row = key_row

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
            # Record a chainable delete so the axis-reconciliation span DELETE
            # (bounded gte/lte on `date`, scoped by strategy_id/api_key_id) is
            # falsifiable — a neuter that keeps the upsert but drops the delete
            # leaves capture["deletes"] empty.
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

            def _in(col: str, val: object) -> MagicMock:
                # C3 topic H: the reconcile names the absent days explicitly.
                record["filters"][f"in:{col}"] = list(val)  # type: ignore[call-overload]
                return chain

            chain.eq.side_effect = _eq
            chain.gte.side_effect = _gte
            chain.lte.side_effect = _lte
            chain.in_.side_effect = _in
            chain.execute.return_value = MagicMock(data=[], count=0)
            return chain

        tbl.delete.side_effect = _delete

        def _update(payload: object, **kw: object) -> MagicMock:
            # Phase 186 R3-02: the refused derive marks its own compute_jobs row.
            record: dict = {"table": name, "payload": payload, "filters": {}}
            capture["updates"].append(record)
            capture["ops"].append(("update", name))
            chain = MagicMock()

            def _eq(col: str, val: object) -> MagicMock:
                record["filters"][f"eq:{col}"] = val
                return chain

            chain.eq.side_effect = _eq
            chain.execute.return_value = MagicMock(data=[payload])
            return chain

        tbl.update.side_effect = _update
        return tbl

    ctx.supabase.table.side_effect = _table

    def _rpc(name: str, payload: dict) -> MagicMock:
        capture["rpc_calls"].append((name, payload))
        capture["ops"].append(("rpc", name))
        stub = MagicMock()
        # Phase 191 D-07: the refusal-marker function answers ``True`` when it changed a row; the
        # derive counts the marker as written only on exactly that answer.
        stub.execute.return_value = MagicMock(
            data=True if name == "mark_compute_job_kept_figures" else 1
        )
        return stub

    ctx.supabase.rpc.side_effect = _rpc
    return ctx, capture


def _patches(ctx: MagicMock, *, key_mode: bool, returns: pd.Series) -> list:
    """Common patch set. In key-mode we patch _allocator_key_preflight; in
    strategy-mode _exchange_preflight. combine_realized_and_funding returns the
    given series + benign meta."""
    preflight_target = (
        "services.job_worker._allocator_key_preflight"
        if key_mode
        else "services.job_worker._exchange_preflight"
    )
    return [
        patch(preflight_target, new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.exchange.fetch_account_equity_usd",
            new=AsyncMock(return_value=(10000.0, False)),
        ),
        patch(
            "services.funding_fetch.fetch_funding_binance",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "services.broker_dailies.combine_realized_and_funding",
            new=MagicMock(
                return_value=(
                    returns,
                    {
                        "used_heuristic_capital": False,
                        "series_completeness": _CCXT_VERDICT,
                    },
                )
            ),
        ),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
    ]


class TestKeyMode:
    """Key-mode: api_key_id payload → per-key upsert, no strategy side-effects."""

    @pytest.mark.asyncio
    async def test_key_mode_upserts_api_key_shape_and_conflict_target(self) -> None:
        ctx, capture = _build_ctx(
            key_row={"id": "key-1", "exchange": "binance", "user_id": "alloc-1"},
            strategy_row=None,
        )
        job = {
            "id": "j-key",
            "kind": "derive_broker_dailies",
            "api_key_id": "key-1",
        }
        patches = _patches(ctx, key_mode=True, returns=_two_day_returns())
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE

        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1, (
            f"expected exactly one csv_daily_returns upsert; got {capture['upserts']!r}"
        )
        _name, payload, on_conflict = csv_upserts[0]
        # Conflict target is the per-key arbiter — NOT strategy_id,date.
        assert on_conflict == "api_key_id,date", (
            f"key-mode must upsert on_conflict='api_key_id,date'; got {on_conflict!r}"
        )
        assert isinstance(payload, list) and len(payload) == 2
        for row in payload:
            assert row["api_key_id"] == "key-1"
            # allocator_id is the AUTHORITATIVE key owner — proves it is read from
            # ctx.key_row['user_id'], never from the job payload (which has none).
            assert row["allocator_id"] == "alloc-1", (
                "allocator_id must come from key_row['user_id'] (authoritative), "
                f"got {row['allocator_id']!r}"
            )
            assert row["strategy_id"] is None
            assert "daily_return" in row and "date" in row

    @pytest.mark.asyncio
    async def test_key_mode_skips_csv_enqueue_and_strategy_analytics(self) -> None:
        ctx, capture = _build_ctx(
            key_row={"id": "key-2", "exchange": "binance", "user_id": "alloc-2"},
            strategy_row=None,
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-2"}
        patches = _patches(ctx, key_mode=True, returns=_two_day_returns())
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        # NO compute_analytics_from_csv enqueue (Pitfall 4 — that path is
        # strategy-keyed and would read strategy_id NULL → garbage). The 115.1
        # Option-B epilogue DOES enqueue the allocator-scoped
        # derive_allocator_equity compose (owner-scoped, correct — pinned in
        # test_derive_allocator_equity_job.py pin 7); only the forbidden
        # strategy-keyed CSV enqueue must be absent here.
        enqueues = [
            c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"
        ]
        assert [
            c for c in enqueues if c[1].get("p_kind") == "compute_analytics_from_csv"
        ] == [], (
            f"key-mode must NOT enqueue compute_analytics_from_csv; got {enqueues!r}"
        )
        # NO strategy_analytics stamp (there is no per-key analytics row).
        sa_upserts = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert sa_upserts == [], (
            f"key-mode must NOT stamp strategy_analytics; got {sa_upserts!r}"
        )

    @pytest.mark.asyncio
    async def test_key_mode_insufficient_history_no_strategy_analytics(self) -> None:
        """<2-day key-mode: no csv_daily_returns and no strategy_analytics write,
        returns DONE (there is no per-key analytics row to stamp). F1(a): it DOES
        now run the Option-B epilogue (persist key_inputs + enqueue the compose) so
        an idle/short key with real capital is visible to the compose core instead
        of silently understating a "Derived" curve."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-3", "exchange": "binance", "user_id": "alloc-3"},
            strategy_row=None,
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-3"}
        one_day = pd.Series(
            [0.01], index=pd.DatetimeIndex(["2024-05-01"]), dtype="float64"
        )
        patches = _patches(ctx, key_mode=True, returns=one_day)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        # NO csv_daily_returns and NO strategy_analytics write (<2 days).
        assert [
            u for u in capture["upserts"]
            if u[0] in ("csv_daily_returns", "strategy_analytics")
        ] == [], (
            "key-mode <2-day must NOT write csv_daily_returns OR strategy_analytics; "
            f"got {capture['upserts']!r}"
        )
        # F1(a): the Option-B key_inputs row IS persisted and the compose enqueued.
        ki_upserts = [
            u for u in capture["upserts"]
            if u[0] == "allocator_equity_derived"
            and any(
                str(r.get("kind", "")).startswith("key_inputs:")
                for r in ([u[1]] if isinstance(u[1], dict) else u[1])
            )
        ]
        assert len(ki_upserts) == 1, (
            f"key-mode <2-day must persist key_inputs (F1a); got {capture['upserts']!r}"
        )
        compose_enq = [
            c for c in capture["rpc_calls"]
            if c[0] == "enqueue_compute_job"
            and c[1].get("p_kind") == "derive_allocator_equity"
        ]
        assert len(compose_enq) == 1, (
            f"key-mode <2-day must enqueue the compose (F1a); got {capture['rpc_calls']!r}"
        )
        # No strategy-keyed CSV-analytics enqueue (that path stays absent).
        assert [
            c for c in capture["rpc_calls"]
            if c[1].get("p_kind") == "compute_analytics_from_csv"
        ] == []


class TestStrategyModeNonRegression:
    """Strategy-mode: byte-unchanged — strategy upsert + CSV enqueue still fire."""

    @pytest.mark.asyncio
    async def test_strategy_mode_unchanged_conflict_target_and_enqueue(self) -> None:
        ctx, capture = _build_ctx(
            key_row={"id": "key-s", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-1", "user_id": "user-1"},
        )
        job = {
            "id": "j-strat",
            "kind": "derive_broker_dailies",
            "strategy_id": "strat-1",
        }
        patches = _patches(ctx, key_mode=False, returns=_two_day_returns())
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE

        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1
        _name, payload, on_conflict = csv_upserts[0]
        # Strategy path is byte-unchanged: on_conflict stays strategy_id,date and
        # the payload carries strategy_id (no api_key_id/allocator_id keys).
        assert on_conflict == "strategy_id,date", (
            f"strategy-mode must keep on_conflict='strategy_id,date'; got {on_conflict!r}"
        )
        for row in payload:
            assert row["strategy_id"] == "strat-1"
            assert "api_key_id" not in row
            assert "allocator_id" not in row

        # The compute_analytics_from_csv enqueue still fires (non-regression).
        enqueues = [
            c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"
        ]
        assert len(enqueues) == 1, (
            f"strategy-mode must still enqueue compute_analytics_from_csv; "
            f"got {capture['rpc_calls']!r}"
        )
        assert enqueues[0][1]["p_kind"] == "compute_analytics_from_csv"
        assert enqueues[0][1]["p_strategy_id"] == "strat-1"

    @pytest.mark.asyncio
    async def test_strategy_mode_insufficient_history_stamps_failed(self) -> None:
        """Strategy-mode <2-day still stamps strategy_analytics='failed'
        (HIGH-2 behaviour preserved by the dual-mode edit)."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-s2", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-empty", "user_id": "user-1"},
        )
        job = {
            "id": "j",
            "kind": "derive_broker_dailies",
            "strategy_id": "strat-empty",
        }
        one_day = pd.Series(
            [0.01], index=pd.DatetimeIndex(["2024-05-01"]), dtype="float64"
        )
        patches = _patches(ctx, key_mode=False, returns=one_day)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        # F1 (161.1 silent-failure audit): FAILED, not DONE. This arm stamps a
        # terminal failure, and DONE routed the job to mark_compute_job_done →
        # sync_strategy_analytics_status branch (c), which NULLs
        # computation_error and stamps computed_at = now() — overwriting the very
        # stamp asserted below with a fresh-looking 'complete'. The stamp and the
        # outcome have to agree or only one of them survives the next RPC. See
        # tests/test_derive_silent_failure_f1_f4_f7.py for the end-to-end drive
        # through dispatch_tick.
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        sa_upserts = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert len(sa_upserts) == 1, (
            f"strategy-mode <2-day must stamp strategy_analytics; got {capture['upserts']!r}"
        )
        _name, payload, _oc = sa_upserts[0]
        assert payload["computation_status"] == "failed"
        assert payload["data_quality_flags"] == {"csv_source": True}
        # SI-02 (MEDIUM-2, v1.9): the terminal 'failed' stamp clears the
        # runner-owned computation_warned marker so the status bridge cannot
        # resurrect a stale complete_with_warnings over the failure. Neuter:
        # drop `"computation_warned": False` from the source stamp → reddens.
        assert payload.get("computation_warned") is False, (
            "derive <2-day 'failed' stamp must set computation_warned=False "
            "(SI-02 stale-marker resurrection guard)"
        )


def _patches_with_combine(
    ctx: MagicMock, *, key_mode: bool, combine_mock: MagicMock
) -> list:
    """Like ``_patches`` but takes an explicit combine mock (return_value OR
    side_effect) so a test can drive a NavReconstructionError raise or a
    NaN-bearing return series through the ONE broker call site at
    job_worker.py:2010."""
    preflight_target = (
        "services.job_worker._allocator_key_preflight"
        if key_mode
        else "services.job_worker._exchange_preflight"
    )
    return [
        patch(preflight_target, new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.exchange.fetch_account_equity_usd",
            new=AsyncMock(return_value=(10000.0, False)),
        ),
        patch(
            "services.funding_fetch.fetch_funding_binance",
            new=AsyncMock(return_value=[]),
        ),
        patch("services.broker_dailies.combine_realized_and_funding", new=combine_mock),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
    ]


class TestNavReconstructionErrorPermanentCatch:
    """Task 1 — a structural NAV/TWR reconstruction failure surfacing from
    combine_realized_and_funding (job_worker.py:2010) must land a TERMINAL
    permanent FAILED, not escape to the generic classifier and get retried
    forever as `unknown`. Mirrors the deribit LedgerValuationError disposition
    (:1916-1941). Strategy-mode stamps a scrubbed terminal `failed`; key-mode
    skips the stamp (no per-key analytics row, like the <2 branch)."""

    @pytest.mark.asyncio
    async def test_nav_error_permanent_strategy_mode_stamps_failed(self) -> None:
        ctx, capture = _build_ctx(
            key_row={"id": "key-nav", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-nav", "user_id": "user-1"},
        )
        job = {
            "id": "j-nav",
            "kind": "derive_broker_dailies",
            "strategy_id": "strat-nav",
        }
        # The message carries a denylisted `secret=` key-value pair to prove the
        # scrub_freeform_string pass actually runs before the stamp (T-74-03).
        combine = MagicMock(
            side_effect=NavReconstructionError(
                "nav_twr non-finite pnl=42.0 secret=hunter2 (row={'i': 0})"
            )
        )
        patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        # Terminal permanent failure — NOT a retried-forever unknown.
        assert result.outcome == DispatchOutcome.FAILED, (
            f"NavReconstructionError on the broker path must return FAILED; "
            f"got {result.outcome!r}"
        )
        assert result.error_kind == "permanent", (
            f"must be permanent (structural, non-retryable); got {result.error_kind!r}"
        )

        # Strategy-mode stamps a terminal 'failed' so the wizard poller reaches a
        # gate instead of an infinite spinner.
        sa_upserts = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert len(sa_upserts) == 1, (
            f"strategy-mode NAV fault must stamp strategy_analytics; got "
            f"{capture['upserts']!r}"
        )
        _name, payload, _oc = sa_upserts[0]
        assert payload["computation_status"] == "failed"
        assert payload["data_quality_flags"] == {"csv_source": True}
        # SI-02 (MEDIUM-2): the terminal NAV-fault 'failed' stamp clears the
        # runner-owned marker so the status bridge cannot resurrect a stale
        # complete_with_warnings over the failure.
        assert payload.get("computation_warned") is False, (
            "broker NAV-fault 'failed' stamp must set computation_warned=False "
            "(SI-02 stale-marker resurrection guard)"
        )
        # scrub_freeform_string redacts the denylisted `secret=` value.
        assert "hunter2" not in payload["computation_error"], (
            f"stamped computation_error must be scrubbed; got "
            f"{payload['computation_error']!r}"
        )
        # No csv_daily_returns write — the failure is BEFORE the upsert.
        assert [u for u in capture["upserts"] if u[0] == "csv_daily_returns"] == []
        # No CSV-analytics enqueue on a structural failure.
        assert capture["rpc_calls"] == []

    @pytest.mark.asyncio
    async def test_nav_error_permanent_key_mode_no_stamp(self) -> None:
        ctx, capture = _build_ctx(
            key_row={"id": "key-navk", "exchange": "binance", "user_id": "alloc-1"},
            strategy_row=None,
        )
        job = {
            "id": "j-navk",
            "kind": "derive_broker_dailies",
            "api_key_id": "key-navk",
        }
        combine = MagicMock(
            side_effect=NavReconstructionError("nav_twr non-finite pnl=7.0 (row={})")
        )
        patches = _patches_with_combine(ctx, key_mode=True, combine_mock=combine)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        # Key-mode has NO per-key analytics row — mirrors the <2 branch: no stamp,
        # no csv write, no enqueue.
        # The one write allowed is the mark seam's private refusal note (174 MARKPAUSE D-02): it
        # runs BEFORE the combine, on the mocked exchange's unreadable mark, and is owner-only.
        # Everything else (key_inputs, csv, analytics) must stay untouched.
        others = [
            u for u in capture["upserts"]
            if not (u[0] == "allocator_equity_derived"
                    and str(u[1].get("kind", "")).startswith("nav_mark_refusal:"))
        ]
        assert others == [], (
            f"key-mode NAV fault must not touch any table; got {capture['upserts']!r}"
        )
        assert capture["rpc_calls"] == []

    @pytest.mark.asyncio
    async def test_transient_valueerror_still_falls_through(self) -> None:
        """Mutation-honesty: the catch is NARROW to NavReconstructionError. A
        bare ValueError (transient network parse blip) must NOT be swallowed as
        permanent — it escapes to the generic dispatcher classifier so it stays
        retryable."""
        ctx, _capture = _build_ctx(
            key_row={"id": "key-t", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-t", "user_id": "user-1"},
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-t"}
        combine = MagicMock(side_effect=ValueError("transient parse blip"))
        patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            with pytest.raises(ValueError, match="transient parse blip"):
                await run_derive_broker_dailies_job(job)


class TestNaNSafeCsvDailyReturnsUpsert:
    """Task 2 — the csv_daily_returns upsert applies the 74-01 sink-(b) finding:
    a guarded-day NaN (estimated_start<=0 -> negative_nav_guard) is SKIPPED so
    the day is honestly ABSENT (no fabricated 0.0 magnitude, and no crash at the
    postgrest-py/httpx JSON encoder which rejects non-finite floats). Applied
    identically to both is_key_mode and strategy-mode payload builders."""

    @staticmethod
    def _nan_bearing_returns() -> pd.Series:
        """A >=2-day series in the exact shape the flow-aware core emits for an
        estimated_start<=0 account: a LEADING guarded day (NaN), an INTERIOR
        guarded day (NaN), and real returns on the rest."""
        idx = pd.DatetimeIndex(
            ["2024-05-01", "2024-05-02", "2024-05-03", "2024-05-04"]
        )
        return pd.Series(
            [np.nan, 0.01, np.nan, -0.02], index=idx, dtype="float64"
        )

    def _assert_honest_payload(self, payload: list[dict]) -> None:
        # Guarded days are ABSENT — only the 2 finite days survive.
        assert len(payload) == 2, (
            f"guarded-day NaN rows must be skipped (2 finite of 4 days); got "
            f"{payload!r}"
        )
        dates = sorted(row["date"] for row in payload)
        assert dates == ["2024-05-02", "2024-05-04"], (
            f"only the finite days may persist; got {dates!r}"
        )
        for row in payload:
            val = row["daily_return"]
            assert np.isfinite(val), (
                f"no NaN/inf may reach csv_daily_returns; got {val!r}"
            )
            # NEVER coerced to 0.0 — a guarded day is absent, not a fabricated
            # flat return.
            assert val != 0.0
        # The payload must survive the real httpx JSON encoder that rejects
        # non-finite floats (74-01 sink-(b) crash mechanism).
        httpx.Request("POST", "http://csv-daily-returns.local", json=payload)

    @pytest.mark.asyncio
    async def test_nan_upsert_skips_guarded_days_strategy_mode(self) -> None:
        ctx, capture = _build_ctx(
            key_row={"id": "key-n", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-n", "user_id": "user-1"},
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-n"}
        combine = MagicMock(
            return_value=(
                self._nan_bearing_returns(),
                {
                    "used_heuristic_capital": False,
                    "negative_nav_guard": True,
                    "series_completeness": _CCXT_VERDICT,
                },
            )
        )
        patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1
        _name, payload, _oc = csv_upserts[0]
        self._assert_honest_payload(payload)
        for row in payload:
            assert row["strategy_id"] == "strat-n"
        # The CSV-analytics enqueue still fires — the account is honest, not failed.
        enqueues = [c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"]
        assert len(enqueues) == 1

    @pytest.mark.asyncio
    async def test_nan_upsert_skips_guarded_days_key_mode(self) -> None:
        ctx, capture = _build_ctx(
            key_row={"id": "key-nk", "exchange": "binance", "user_id": "alloc-1"},
            strategy_row=None,
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-nk"}
        combine = MagicMock(
            return_value=(
                self._nan_bearing_returns(),
                {
                    "used_heuristic_capital": False,
                    "negative_nav_guard": True,
                    "series_completeness": _CCXT_VERDICT,
                },
            )
        )
        patches = _patches_with_combine(ctx, key_mode=True, combine_mock=combine)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1
        _name, payload, _oc = csv_upserts[0]
        self._assert_honest_payload(payload)
        for row in payload:
            assert row["api_key_id"] == "key-nk"
            assert row["allocator_id"] == "alloc-1"
            assert row["strategy_id"] is None


def _daily_pnl_record(day: str, pnl_usd: float) -> dict[str, object]:
    """A single ``daily_pnl``-shaped realized record (the exact shape
    ``combine_realized_and_funding`` feeds ``trades_to_daily_returns_with_status``:
    ``order_type='daily_pnl'``, ``side`` encodes the sign, ``price`` is the
    absolute USD). Places ``day`` (YYYY-MM-DD) into the reconstructed return
    window so a same-day dated flow lands ON the NAV timeline (not an orphan)."""
    return {
        "exchange": "",
        "symbol": "BTCUSDT",
        "side": "buy" if pnl_usd >= 0 else "sell",
        "price": abs(pnl_usd),
        "quantity": 1,
        "fee": 0,
        "fee_currency": "USDT",
        "timestamp": f"{day}T00:00:00+00:00",
        "order_type": "daily_pnl",
    }


def _cumulative_twr(returns: pd.Series) -> float:
    """Chain-linked cumulative return over the retained (non-NaN) days:
    ``Prod(1 + r) - 1``. Mirrors ``nav_twr.cumulative_twr`` locally so the
    dropped-flow proof compares a single scalar across the two flow scenarios."""
    retained = returns.dropna()
    return float((1.0 + retained).prod() - 1.0)


class TestLtp068AcceptanceSubNavPureFlow:
    """FLOW-02 acceptance (75-CONTEXT.md SC4, reconciled) — the NON-dominating
    case. A real BTC withdrawal, valued at ``change * same-day settlement index``
    on its actual UTC day, flows through the FULL honest seam
    (``deribit_dated_external_flows_usd`` -> ``combine_realized_and_funding``
    -> ``reconstruct_nav_and_twr``). On a sub-NAV pure-flow day (``|F| <
    NAV_{t-1}``, no trading) the day's ``r_t == 0`` (the flow-neutral TWR
    property proven in Phase 73), NOT a fabricated return.

    This is the honest replacement for the LTP068 +458% class: the ~$21k
    withdrawal is a correctly-signed, event-time-valued ``F_t`` that reduces NAV
    and yields a zero own-day return — it does NOT surface as a phantom +/- move.

    Every assertion is mutation-honest: a wrong-day / 1.0 / current-price
    valuation reddens the event-time proof, and DROPPING the flow from
    ``external_flows`` changes the reconstructed cumulative return (the flow is
    load-bearing, not silently dropped)."""

    def test_ltp068_sub_nav_pure_flow_yields_zero_return(self) -> None:
        # --- Event-time + sign proof. The scenario-2 fixture carries its OWN
        # same-day index-bearing settlement row (BTC_INDEX_2026_03_14); the
        # supplemental map is supplied too (own index wins — identical resolution
        # order to txn_rows_to_daily_records). The withdrawal (-0.5 BTC) values at
        # change * same-day index on its actual UTC day 2026-03-14.
        flows = deribit_dated_external_flows_usd(
            inverse_flow_day_with_index_rows(),
            supplemental_index={(DAY_INVERSE_WITH_INDEX, "BTC"): BTC_INDEX_2026_03_14},
        )
        assert len(flows) == 1
        (flow,) = flows
        assert flow.utc_day_iso == DAY_INVERSE_WITH_INDEX  # actual withdrawal day
        # Correctly signed (withdrawal -> NEGATIVE) and event-time valued.
        assert flow.usd_signed == pytest.approx(-0.5 * BTC_INDEX_2026_03_14)  # -21000
        assert flow.usd_signed < 0.0
        # Wrong-DAY index (a cross-time substitution) would value differently ->
        # the event-time proof is falsifiable, not incidental.
        assert flow.usd_signed != pytest.approx(-0.5 * BTC_INDEX_2026_03_16)

        # --- Flow-neutral proof. Anchor 100k with realized pnl [+1000 (03-13),
        # 0 (03-14)] reconstructs NAV_{03-13}=121000; |F|=21000 is STRICTLY under
        # it (no guard). On the pure-flow day the flow cancels in the numerator
        # (NAV_t - NAV_{t-1} == F_t) -> r_t == 0, status 'complete'.
        realized = [
            _daily_pnl_record("2026-03-13", 1000.0),
            _daily_pnl_record(DAY_INVERSE_WITH_INDEX, 0.0),  # no trading on flow day
        ]
        returns, meta = combine_realized_and_funding(
            realized, [], account_balance=100_000.0, external_flows=flows
        )
        assert returns.loc[DAY_INVERSE_WITH_INDEX] == pytest.approx(0.0, abs=1e-12)
        # No guard fired: a sub-NAV flow is a NORMAL day, surfaced as 'complete'.
        assert meta["computation_status_hint"] == "complete"
        assert "flow_dominated_guard" not in meta
        assert "negative_nav_guard" not in meta
        assert "dust_nav_guard" not in meta

        # --- Dropped-flow proof. Removing the dated flow changes the
        # reconstructed NAV timeline and hence the cumulative return: the flow is
        # LOAD-BEARING. (r_t on the zero-pnl day is 0 either way; the flow's
        # effect is on the NAV level / the trading day's denominator, so the
        # cumulative return is the honest place to pin it.)
        returns_no_flow, _ = combine_realized_and_funding(
            realized, [], account_balance=100_000.0, external_flows=[]
        )
        assert _cumulative_twr(returns) != pytest.approx(
            _cumulative_twr(returns_no_flow)
        ), "dropping the load-bearing flow must change the reconstructed result"


class TestLtp068AcceptanceDominatingWithdrawalIsMeasured:
    """FLOW-02 acceptance (75-CONTEXT.md SC4, reconciled; moved by 164.6.6.2.3 D-05) —
    the DOMINATING case. LTP068's motivating event was a ~$2.5M withdrawal that
    DWARFED prior-day capital. When the valued ``|F| >= NAV_{t-1}`` the withdrawal day
    is now MEASURED, never dropped: a flow of any size neither breaks the day nor
    warns (D-05). The Deribit flow carries a UTC day and no time of day, so the day
    is measured at day level (flow counted at the end of the day, D-07) and the
    ``flow_timing_day_level`` annotation says so; status stays ``complete``.

    The reference day: prior NAV 80000, a -90000 withdrawal, a +15000 same-day gain.
    ``r = (NAV_t - NAV_{t-1} - F_t) / NAV_{t-1} = (5000 - 80000 + 90000) / 80000
    = 15000 / 80000 = 0.1875``. It never fabricates a +/-100% day and never
    collapses to ``r_t == 0``.

    Boundary distinction (75-RESEARCH.md Pitfall 5 + Open Q2): the SAME machinery
    yields ``r_t == 0`` for a sub-NAV pure flow (``TestLtp068AcceptanceSubNavPureFlow``)
    and the gain over the prior capital for a dominating flow (here). BOTH outcomes
    are pinned so a future change cannot collapse them into one another.

    Mutation-honest: reinstating a flow-dominance guard turns the day back into NaN
    with the retired flag and ``complete_with_warnings``, and the ``0.1875``
    assertion reddens."""

    def test_ltp068_dominating_withdrawal_day_is_measured_at_day_level(self) -> None:
        # The scenario-4 fixture: a -2.0 BTC withdrawal valued via its OWN
        # same-day settlement index (BTC_INDEX_2026_03_16) -> -90000 USD on
        # 2026-03-16. The flow is fully valued; only its size is in question.
        flows = deribit_dated_external_flows_usd(dominating_withdrawal_rows())
        assert len(flows) == 1
        (flow,) = flows
        assert flow.utc_day_iso == DAY_DOMINATING
        assert flow.usd_signed == pytest.approx(-2.0 * BTC_INDEX_2026_03_16)  # -90000
        assert flow.usd_signed < 0.0

        # Realized pnl [+800 (03-15), +15000 (03-16)] with anchor 5000
        # reconstructs NAV_{03-15} = 5000 + 90000 - 15000 = 80000; the -90000
        # withdrawal on 03-16 has |F| = 90000 >= 80000. (The big same-day gain is
        # inherent to a dominating withdrawal: to withdraw MORE than prior-day
        # capital the day's intraday gains must have funded it.)
        realized = [
            _daily_pnl_record("2026-03-15", 800.0),  # a normal day
            _daily_pnl_record(DAY_DOMINATING, 15000.0),
        ]
        returns, meta = combine_realized_and_funding(
            realized, [], account_balance=5_000.0, external_flows=flows
        )

        # Measured: 15000 / 80000 = 0.1875 exactly (the flow cancels in the
        # numerator and the day's gain is divided by the capital that funded it).
        assert returns.loc[DAY_DOMINATING] == pytest.approx(0.1875, abs=1e-12)
        # The retired flag is gone and the day does not warn (D-05) ...
        assert "flow_dominated_guard" not in meta
        assert meta["computation_status_hint"] == "complete"
        # Boundary distinction: no guard of any kind fired.
        assert "negative_nav_guard" not in meta
        assert "dust_nav_guard" not in meta
        assert "pnl_dominated_guard" not in meta
        # The normal prior day is a healthy return: 800 / 79200 (NAV_{03-14} =
        # 80000 - 800), not a zero and not a NaN.
        assert returns.loc["2026-03-15"] == pytest.approx(800.0 / 79200.0, abs=1e-12)

        # D-07: the day-level rule is NAMED as an annotation: a Deribit flow has no
        # time of day, so it counts at the end of the day. Asserted on the wrapper's meta
        # (plan 04's present-only carry in ``transforms._merge_status_meta``) and again at
        # the core (``reconstruct_nav_and_twr``), where the annotation is produced.
        assert meta.get("flow_timing_day_level") is True
        assert "flow_timing_day_level_days" not in meta  # in-process count, never carried
        # D-15 (F1): |-90000| >= the 80000 prior NAV, so the kept day is annotated as one whose
        # end-of-day return can be extreme (never a guard: the status stays "complete").
        assert meta.get("flow_timing_day_level_large") is True
        assert "flow_timing_day_level_large_days" not in meta
        core_returns, core_meta = reconstruct_nav_and_twr(
            pd.Series(
                [800.0, 15000.0],
                index=pd.DatetimeIndex(["2026-03-15", DAY_DOMINATING]),
                name="daily_pnl",
            ),
            5_000.0,
            external_flows=flows,
        )
        assert core_returns.loc[pd.Timestamp(DAY_DOMINATING)] == pytest.approx(
            0.1875, abs=1e-12
        )
        assert core_meta.get("flow_timing_day_level") is True
        assert core_meta.get("flow_timing_day_level_large") is True
        assert "flow_dominated_guard" not in core_meta
        assert core_meta["computation_status_hint"] == "complete"


class TestLtp068PureFlowNoTradeDayUnioned:
    """HIGH-1 (75-05) — the GENUINELY-pure scenario 5 through the FULL honest seam
    (``deribit_dated_external_flows_usd`` -> ``combine_realized_and_funding`` ->
    ``reconstruct_nav_and_twr``) WITHOUT the ``_daily_pnl_record`` synthetic
    injection on the flow day.

    The flow day carries NO return-bearing row, so it is ABSENT from the pnl index
    (built from cash-bearing rows only). Pre-fix ``_align_flows`` orphan-rejects it
    -> ``NavReconstructionError`` -> the whole job permanently FAILED — the LTP068
    class where the MAJORITY of real flow-bearing accounts (initial deposit before
    the first trade, terminal/quiet-day withdrawal) could never compute. Post-fix
    the flow day is UNIONED as a zero-pnl NAV day and is flow-neutral: honest
    ``r_t == 0``, status ``complete``.

    Mutation-honest: reverting the HIGH-1 ``_union_flow_days`` call re-orphans the
    flow day and this test goes RED (``NavReconstructionError`` instead of
    ``r_t == 0``). The sub-NAV valuation (|F| < NAV_{t-1}) trips no guard, so the
    zero is the flow-neutral property, not a suppressed warning."""

    def test_pure_flow_no_trade_day_yields_zero_not_raise(self) -> None:
        # Scenario 5: a sub-NAV BTC withdrawal on a no-trade day, valued via the
        # C1-fetched same-day settlement index (the day carries no own index row).
        flows = deribit_dated_external_flows_usd(
            pure_flow_no_trade_rows(),
            supplemental_index={(DAY_PURE_FLOW, "BTC"): BTC_INDEX_2026_03_17},
        )
        assert len(flows) == 1
        (flow,) = flows
        assert flow.utc_day_iso == DAY_PURE_FLOW
        # Event-time valued (-0.1 BTC * same-day index) and correctly signed.
        assert flow.usd_signed == pytest.approx(-0.1 * BTC_INDEX_2026_03_17)  # -4100
        assert flow.usd_signed < 0.0

        # A real trade day EARLIER (2026-03-16); the flow day 2026-03-17 carries NO
        # pnl record — it is a GENUINE orphan against the pnl index (no synthetic
        # ``_daily_pnl_record`` injection to mask it).
        realized = [_daily_pnl_record("2026-03-16", 1000.0)]
        returns, meta = combine_realized_and_funding(
            realized, [], account_balance=100_000.0, external_flows=flows
        )

        # The no-trade flow day is unioned into the NAV timeline and is
        # flow-neutral: r_t == 0 (production yields an honest zero, not a raise).
        assert DAY_PURE_FLOW in {d.date().isoformat() for d in returns.index}
        assert returns.loc[DAY_PURE_FLOW] == pytest.approx(0.0, abs=1e-12)
        # A sub-NAV flow is a NORMAL day: no guard, honest 'complete'.
        assert meta["computation_status_hint"] == "complete"
        assert "negative_nav_guard" not in meta
        assert "flow_dominated_guard" not in meta
        assert "dust_nav_guard" not in meta


class TestDerivePersistReconcilesAxis:
    """MEDIUM-HIGH (v1.9) — the derive persist must be AUTHORITATIVE for the
    strategy's series WITHIN its reconstructed span, not upsert-only.

    An upsert-only persist never deletes: a day the CURRENT derive REFUSES
    (NaN -> skipped by the 74-04 policy) but a PRIOR derive wrote keeps its
    stale row. At load (run_csv_strategy_analytics) that day looks "present",
    the MEDIUM-1 NaN reinstatement does NOT fire, and cumulative_twr_segmented
    COMPOUNDS the stale return across a day this reconstruction refused -> the
    headline is BRIDGED across the stale value instead of suffix-only. At the
    v1.9 native cutover the native core's per-day DQ guards differ from the
    legacy USD rows that populated the table, so recomputed track records would
    silently mix stale legacy returns into refused days.

    The fix reconciles the axis so the stored span equals the fresh payload.
    Since C3 topic H it UPSERTS the payload first, then DELETES the span's
    calendar days the payload does not carry (an explicit `in` list, still
    bounded gte/lte on `date` to [returns.index.min, returns.index.max] and
    scoped by strategy_id/api_key_id), so no reader ever finds a rebuilt day
    absent. A refused interior/leading day becomes honestly ABSENT.

    SPAN bound (never delete legitimate out-of-scope history): the delete is
    RANGED gte/lte on the dense reconstructed calendar — a row OLDER than
    returns.index.min() (written by an earlier, wider-window retention derive)
    is strictly < span_start and CANNOT be reached. For a full_history Deribit
    derive [min,max] IS the whole series; for a retention-windowed ccxt derive it
    is only the reconstructed window.

    Neuter: keep the upsert-only persist (drop the span DELETE) -> capture
    ["deletes"] has no csv_daily_returns entry -> the refused-day assertions
    here redden.
    """

    @staticmethod
    def _refused_interior_returns() -> pd.Series:
        """A 3-day dense series with a REFUSED interior day (D = 2024-05-02, NaN).
        The fresh payload keeps 05-01 and 05-03; the derive REFUSES 05-02, so a
        stale prior 05-02 row must be reconciled away (deleted, not survive)."""
        idx = pd.DatetimeIndex(["2024-05-01", "2024-05-02", "2024-05-03"])
        return pd.Series([0.01, np.nan, -0.02], index=idx, dtype="float64")

    @pytest.mark.asyncio
    async def test_strategy_mode_span_delete_reconciles_refused_day(self) -> None:
        ctx, capture = _build_ctx(
            key_row={"id": "key-r", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-r", "user_id": "user-1"},
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-r"}
        combine = MagicMock(
            return_value=(
                self._refused_interior_returns(),
                {
                    "used_heuristic_capital": False,
                    "negative_nav_guard": True,
                    "series_completeness": _CCXT_VERDICT,
                },
            )
        )
        patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE

        # Exactly one authoritative span DELETE on csv_daily_returns.
        csv_deletes = [d for d in capture["deletes"] if d["table"] == "csv_daily_returns"]
        assert len(csv_deletes) == 1, (
            f"strategy derive must issue ONE csv_daily_returns span delete; "
            f"got {capture['deletes']!r}"
        )
        filters = csv_deletes[0]["filters"]
        # Scoped to the strategy axis (never a cross-strategy wipe).
        assert filters.get("eq:strategy_id") == "strat-r"
        assert "eq:api_key_id" not in filters
        # Bounded to the dense reconstructed span [min, max].
        span_start = filters.get("gte:date")
        span_end = filters.get("lte:date")
        assert span_start == "2024-05-01"
        assert span_end == "2024-05-03"
        # The REFUSED day D falls INSIDE the span -> its stale row is reconciled
        # away: it is the ONLY day the delete names (the payload omits it).
        assert span_start <= "2024-05-02" <= span_end
        assert filters.get("in:date") == ["2024-05-02"], (
            f"the delete must name exactly the refused day; got {filters!r}"
        )

        # Out-of-scope history (a day BEFORE span_start) is unreachable by the
        # ranged delete -> legitimate older rows from a wider-window derive survive.
        assert "2024-04-30" < span_start

        # The re-insert (upsert) restores ONLY the retained finite days; the
        # refused day D is honestly ABSENT (not bridged across a stale value).
        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1
        _name, payload, _oc = csv_upserts[0]
        upsert_dates = sorted(row["date"] for row in payload)
        assert upsert_dates == ["2024-05-01", "2024-05-03"], (
            f"refused day D must not be re-inserted; got {upsert_dates!r}"
        )

        # C3 topic H order: the upsert precedes the reconcile DELETE, so no
        # reader ever finds a rebuilt day absent. A crash between them leaves the
        # refused day's stale row present until the retry heals it; it can no
        # longer leave the span EMPTY. (The previous order, delete first, was
        # pinned here; the reader-level proof is tests/test_dailies_writer_no_hole.py.)
        ops = [o for o in capture["ops"] if o[1] == "csv_daily_returns"]
        assert ops == [("upsert", "csv_daily_returns"), ("delete", "csv_daily_returns")], (
            f"the upsert must precede the reconcile delete; got {ops!r}"
        )

    @pytest.mark.asyncio
    async def test_strategy_mode_clean_series_deletes_and_reinserts_all(self) -> None:
        """A day the fresh derive LEGITIMATELY still has is NOT lost: with no
        refused day the payload covers the whole span, so since C3 topic H there
        is nothing to delete and the upsert alone leaves the full clean payload
        present (no refused days -> nothing dropped)."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-c", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-c", "user_id": "user-1"},
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-c"}
        patches = _patches(ctx, key_mode=False, returns=_two_day_returns())
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        csv_deletes = [d for d in capture["deletes"] if d["table"] == "csv_daily_returns"]
        assert csv_deletes == [], (
            f"no day of the span is absent from the payload, so nothing may be "
            f"deleted; got {csv_deletes!r}"
        )
        # Both clean days are upserted -> retained history is preserved.
        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        _name, payload, _oc = csv_upserts[0]
        assert sorted(row["date"] for row in payload) == ["2024-05-01", "2024-05-02"]

    @pytest.mark.asyncio
    async def test_key_mode_span_delete_scoped_to_api_key_axis(self) -> None:
        """Key-mode reconciles on the per-key axis: the span delete is scoped by
        api_key_id (never strategy_id), mirroring the upsert conflict arbiter."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-rk", "exchange": "binance", "user_id": "alloc-1"},
            strategy_row=None,
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-rk"}
        combine = MagicMock(
            return_value=(
                self._refused_interior_returns(),
                {
                    "used_heuristic_capital": False,
                    "negative_nav_guard": True,
                    "series_completeness": _CCXT_VERDICT,
                },
            )
        )
        patches = _patches_with_combine(ctx, key_mode=True, combine_mock=combine)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        csv_deletes = [d for d in capture["deletes"] if d["table"] == "csv_daily_returns"]
        assert len(csv_deletes) == 1
        filters = csv_deletes[0]["filters"]
        assert filters.get("eq:api_key_id") == "key-rk", (
            f"key-mode span delete must scope on api_key_id; got {filters!r}"
        )
        assert "eq:strategy_id" not in filters
        assert filters.get("gte:date") == "2024-05-01"
        assert filters.get("lte:date") == "2024-05-03"


# ── Phase 104 (BB-01): additive DARK cash_settlement SERIES persist at the seam ──
# The single-key broker derive now ALSO persists the cash daily SERIES as a new
# strategy_analytics_series kind ("cash_settlement") beside the Phase-103 MTM block —
# SERIES-ONLY, additive, zero readers this phase. The authoritative cash SCALARS stay
# on the legacy analytics_runner path (SC-4 protected). Every assertion is
# mutation-falsifiable: drop the persist → the cash rpc/heal vanishes; make the
# identity contingent on the MTM benchmark fetch → Test 2 reddens; leak a
# cash_settlement key into the prestamp → Test 5 reddens.


def _cash_series_payload(capture: dict) -> dict | None:
    """The persisted cash_settlement series payload (schema/basis/rows/gap_spans/
    conventions) from the upsert_strategy_analytics_series_batch RPC, or None if the
    cash series was never upserted."""
    for name, payload in capture["rpc_calls"]:
        if name == "upsert_strategy_analytics_series_batch":
            p_kinds = payload.get("p_kinds", {})
            if "cash_settlement" in p_kinds:
                return p_kinds["cash_settlement"]
    return None


def _series_deletes_for_kind(capture: dict, kind: str) -> list[dict]:
    """strategy_analytics_series DELETEs filtered on the given kind (the heal arm)."""
    return [
        d for d in capture["deletes"]
        if d["table"] == "strategy_analytics_series"
        and d["filters"].get("eq:kind") == kind
    ]


def _interior_nan_returns() -> pd.Series:
    """A 4-day dense series with a single INTERIOR guard-day NaN (2024-05-02) —
    finite days 05-01, 05-03, 05-04, so the sparse cash series carries a clean
    interior gap_span at 05-02."""
    idx = pd.DatetimeIndex(["2024-05-01", "2024-05-02", "2024-05-03", "2024-05-04"])
    return pd.Series([0.01, np.nan, -0.02, 0.03], index=idx, dtype="float64")


class TestCashSettlementSeriesPersist:
    """The additive dark cash-series persist seam."""

    @pytest.mark.asyncio
    async def test_strategy_mode_persists_cash_settlement_series(self) -> None:
        """A clean strategy-mode derive fires the batch RPC with a cash_settlement
        payload whose rows are EXACTLY the finite (pd.notna) csv_daily_returns rows
        (round-trip identity by construction), whose gap_spans covers the interior
        guard-day, and whose conventions echo carries the asset-class periods_per_year
        + geometric/calendar + benchmark:'BTC' UNCONDITIONALLY."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-cash", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-cash", "user_id": "user-1"},
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-cash"}
        patches = _patches(ctx, key_mode=False, returns=_interior_nan_returns())
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        cash = _cash_series_payload(capture)
        assert cash is not None, "strategy-mode derive must persist a cash_settlement series"
        assert cash["schema"] == 2
        assert cash["basis"] == "cash_settlement"

        # rows == the finite csv_daily_returns rows (round-trip identity by construction)
        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1
        _n, csv_payload, _oc = csv_upserts[0]
        csv_rows = {r["date"]: r["daily_return"] for r in csv_payload}
        cash_rows = {r["date"]: r["return"] for r in cash["rows"]}
        assert cash_rows == csv_rows == {
            "2024-05-01": 0.01, "2024-05-03": -0.02, "2024-05-04": 0.03,
        }

        # gap_spans covers the interior guard-day (2024-05-02).
        assert cash["gap_spans"] == [{"start": "2024-05-02", "end": "2024-05-02"}]

        # conventions echo: asset-class periods + geometric/calendar + UNCONDITIONAL
        # benchmark identity (no denominator override on a plain strategy → geometric).
        assert cash["conventions"]["periods_per_year"] == periods_per_year_for_asset_class(None)
        assert cash["conventions"]["cumulative_method"] == "geometric"
        assert cash["conventions"]["day_basis"] == "calendar"
        assert cash["conventions"]["benchmark"] == "BTC"

    @pytest.mark.asyncio
    async def test_cash_identity_independent_of_mtm_benchmark_fetch(self) -> None:
        """Even when the MTM-side get_benchmark_returns('BTC') RAISES, the cash persist
        still fires AND its conventions echo benchmark=='BTC' — the cash derive passes
        benchmark_rets=None + an UNCONDITIONAL identity string, never the fetch result.
        Kills any mutation making the cash identity contingent on the MTM fetch.
        (Needs the Deribit options path so the MTM benchmark fetch actually runs.)"""
        from tests.test_mtm_single_key import (
            _STRATEGY_ID,
            _apply,
            _base_patches,
            _cash_series,
            _ctx,
            _mtm_series,
            _patch_benchmark,
            _recording_ledger,
            _report,
        )

        ctx, capture = _ctx(strategy_row={"asset_class": "crypto"})
        # Phase 132: an options book runs THREE passes (cash, mtm, smoothed_mtm); the
        # third combine side-effect feeds the additive smoothed pass.
        reports = [
            _report(has_option_activity=True),
            _report(has_option_activity=True),
            _report(has_option_activity=True),
        ]
        ledger_mock, _calls = _recording_ledger(reports)
        _deribit_meta = {
            "used_heuristic_capital": False,
            "series_completeness": _LEDGER_VERDICT,
        }
        combine = MagicMock(side_effect=[
            (_cash_series(), dict(_deribit_meta)),
            (_mtm_series(), dict(_deribit_meta)),
            (_mtm_series(), dict(_deribit_meta)),
        ])
        with _apply(_base_patches(
            ctx, key_mode=False, ledger_mock=ledger_mock, combine_mock=combine,
        ) + [_patch_benchmark(raises=True)]):
            result = await run_derive_broker_dailies_job({"strategy_id": _STRATEGY_ID})

        assert result.outcome == DispatchOutcome.DONE
        cash = _cash_series_payload(capture)
        assert cash is not None, (
            "cash_settlement series must persist even when the MTM benchmark fetch raises"
        )
        assert cash["conventions"]["benchmark"] == "BTC", (
            "the cash identity is an unconditional string, never contingent on the fetch"
        )

    @pytest.mark.asyncio
    async def test_derive_reject_heals_cash_series(self) -> None:
        """When derive_basis_series raises ValueError, the cash persist runs the DELETE
        (heal) arm (result=None) and the job still completes DONE — cash csv rows +
        prestamp + enqueue unaffected."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-h", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-h", "user_id": "user-1"},
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-h"}
        patches = _patches(ctx, key_mode=False, returns=_interior_nan_returns())
        raise_derive = patch(
            "services.basis_series.derive_basis_series",
            new=MagicMock(side_effect=ValueError("cash derive reject")),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], raise_derive:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        # cash heal: a DELETE on strategy_analytics_series filtered kind=cash_settlement
        cash_heals = _series_deletes_for_kind(capture, "cash_settlement")
        assert len(cash_heals) == 1, (
            f"a rejected cash derive must HEAL (delete) the stale series row; "
            f"got {capture['deletes']!r}"
        )
        assert cash_heals[0]["filters"].get("eq:strategy_id") == "strat-h"
        assert _cash_series_payload(capture) is None  # heal never upserts a cash row
        # cash neighbors unaffected: csv rows written + compute enqueued.
        assert [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert [c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"]

    @pytest.mark.asyncio
    async def test_key_mode_writes_no_cash_series(self) -> None:
        """A key-mode derive fires NO strategy_analytics_series write of any kind —
        neither a cash upsert nor a heal delete (the early-return pin at :2925)."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-km", "exchange": "binance", "user_id": "alloc-1"},
            strategy_row=None,
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-km"}
        patches = _patches(ctx, key_mode=True, returns=_two_day_returns())
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        assert _cash_series_payload(capture) is None
        assert not any(
            name == "upsert_strategy_analytics_series_batch"
            for name, _ in capture["rpc_calls"]
        )
        assert [d for d in capture["deletes"] if d["table"] == "strategy_analytics_series"] == []

    @pytest.mark.asyncio
    async def test_cash_persist_leaves_prestamp_and_csv_byte_unchanged(self) -> None:
        """The additive cash persist NEVER perturbs the cash neighbors: the strategy_
        analytics prestamp still writes metrics_json_by_basis (NO cash_settlement key
        ever) and the csv_daily_returns write is the dailies writer's own shape. The
        cash series lands ONLY in strategy_analytics_series, never in strategy_analytics
        or csv_daily_returns."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-b", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-b", "user_id": "user-1"},
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-b"}
        patches = _patches(ctx, key_mode=False, returns=_two_day_returns())
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        # A cash series WAS persisted (sanity — the seam fired).
        assert _cash_series_payload(capture) is not None

        # Prestamp: metrics_json_by_basis is authoritatively NULL on this ccxt derive
        # (unchanged) and carries NO cash_settlement key.
        sa_upserts = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert len(sa_upserts) == 1
        _n, prestamp, _oc = sa_upserts[0]
        assert "metrics_json_by_basis" in prestamp
        assert prestamp["metrics_json_by_basis"] is None, (
            "the prestamp by-basis write must stay byte-unchanged (no cash_settlement scalar)"
        )

        # csv_daily_returns: one upsert of the two clean days and, since C3 topic
        # H (upsert first, then delete only the span days the payload lacks), no
        # delete at all, because the clean payload covers the whole span.
        csv_deletes = [d for d in capture["deletes"] if d["table"] == "csv_daily_returns"]
        assert csv_deletes == []
        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1
        _n2, csv_payload, on_conflict = csv_upserts[0]
        assert on_conflict == "strategy_id,date"
        assert sorted(r["date"] for r in csv_payload) == ["2024-05-01", "2024-05-02"]


# ── Phase 115 (E2 / STITCH-01): deribit key-mode parity ─────────────────────
# The dual-mode key-mode upsert is VENUE-AGNOSTIC below the native branch: a
# deribit allocator key (native-ledger path) and a ccxt allocator key both land
# the SAME per-key payload shape (api_key_id + allocator_id=user_id + strategy_id
# None, on_conflict='api_key_id,date'). This co-locates a deribit key-mode case
# beside the ccxt ones so a future edit that forks the two upsert shapes reddens
# HERE. Reuses the native-ledger harness from test_mtm_single_key (the deribit
# branch mocks combine_native_ledger, not combine_realized_and_funding).


class TestStrategyModeDroppedRowFlag:
    """Founder decision D-12, review R3-03: a realized row the venue read dropped because it could
    not be read is FLAGGED on the strategy's data-quality flags and the strategy keeps publishing.
    The flag rides the prestamp, which replaces the column wholesale, so a clean re-read clears it."""

    @staticmethod
    async def _derive(flags: dict[str, object]) -> tuple[object, dict]:
        from services.exchange import _record_dq_flag, get_and_clear_last_dq_flags

        get_and_clear_last_dq_flags()
        ctx, capture = _build_ctx(
            key_row={"id": "key-b", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-b", "user_id": "user-1"},
        )

        async def _realized(*_a: object, **_k: object) -> list:
            for _flag, _value in flags.items():
                _record_dq_flag(_flag, _value)
            return []

        patches = _patches(ctx, key_mode=False, returns=_two_day_returns())
        patches[1] = patch("services.job_worker.fetch_all_trades", new=AsyncMock(side_effect=_realized))
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(
                {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-b"}
            )
        return result, capture

    @pytest.mark.asyncio
    async def test_a_dropped_row_is_flagged_on_the_prestamp_and_the_strategy_publishes(self) -> None:
        result, capture = await self._derive({"daily_pnl_malformed_binance": True})
        assert result.outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        (prestamp,) = [u[1] for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert prestamp["data_quality_flags"]["daily_pnl_malformed_binance"] is True
        # a flag, not a warning: it is not a member of the guard set that promotes the status
        from services.nav_twr import NAV_TWR_GUARD_KEYS

        assert "daily_pnl_malformed_binance" not in NAV_TWR_GUARD_KEYS
        assert [u for u in capture["upserts"] if u[0] == "csv_daily_returns"] != []

    @pytest.mark.asyncio
    async def test_a_clean_re_read_writes_no_flag_so_the_wholesale_prestamp_clears_it(self) -> None:
        result, capture = await self._derive({})
        assert result.outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        (prestamp,) = [u[1] for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert not [k for k in prestamp["data_quality_flags"] if k.startswith("daily_pnl_malformed_")]


class TestKeyModeDeribitParity:
    """A deribit allocator key produces the IDENTICAL per-key upsert shape as a
    ccxt allocator key — the dogfooding-gap consumer for an all-deribit allocator."""

    @pytest.mark.asyncio
    async def test_deribit_key_mode_matches_ccxt_key_mode_shape(self) -> None:
        from tests.test_mtm_single_key import (
            _apply,
            _base_patches,
            _cash_series,
            _ctx,
            _recording_ledger,
            _report,
        )

        ctx, capture = _ctx(strategy_row=None, key_mode=True)
        ctx.key_row = {
            "id": "key-drb-parity",
            "user_id": "alloc-parity",
            "exchange": "deribit",
        }
        ledger_mock, _calls = _recording_ledger([_report(has_option_activity=False)])
        combine = MagicMock(
            return_value=(
                _cash_series(),
                {
                    "used_heuristic_capital": False,
                    "series_completeness": _LEDGER_VERDICT,
                },
            )
        )
        with _apply(_base_patches(
            ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine,
        )):
            result = await run_derive_broker_dailies_job(
                {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-drb-parity"}
            )

        assert result.outcome == DispatchOutcome.DONE
        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1
        _name, payload, on_conflict = csv_upserts[0]
        # SAME per-key arbiter + payload shape as the ccxt key-mode case above
        # (TestKeyMode.test_key_mode_upserts_api_key_shape_and_conflict_target).
        assert on_conflict == "api_key_id,date"
        for row in payload:
            assert row["api_key_id"] == "key-drb-parity"
            assert row["allocator_id"] == "alloc-parity"
            assert row["strategy_id"] is None
        # Key-mode owns no strategy row: no strategy-keyed compute_analytics_from_csv
        # enqueue, no strategy_analytics. The 115.1 Option-B epilogue's allocator-
        # scoped derive_allocator_equity compose enqueue IS expected (owner-scoped).
        _km_enq = [c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"]
        assert [
            c for c in _km_enq if c[1].get("p_kind") == "compute_analytics_from_csv"
        ] == []
        assert [u for u in capture["upserts"] if u[0] == "strategy_analytics"] == []


# ── MT5-12 (Phase 142.2 plan 05): the series-completeness VERDICT seam ───────
# D-15/D-16. The publish gate stops asking a hardcoded venue list whether a daily
# series can be trusted and starts reading a producer-stamped verdict. That makes
# the derive persist seam the ONE chokepoint for producer 1: a fifth combiner
# added to the open-ended venue registry must state whether the inputs it
# consumed were whole, or its series never reaches csv_daily_returns.
#
# ⛔ The placement — BEFORE the reconcile-span DELETE, not merely before the
# upsert — is what these tests exist to pin. The DELETE fires first, so a refusal
# checked between DELETE and upsert would destroy the prior series and then
# decline to write a replacement: fail-loud converted into data loss. Every
# refusal case below asserts the DELETE was NEVER executed, which is a strictly
# stronger claim than "the job failed".


class TestSeriesCompletenessVerdictSeam:
    """Producer 1's fail-loud verdict gate at the derive persist seam."""

    @staticmethod
    def _unverdicted_combine(meta_extra: dict | None = None) -> MagicMock:
        """A combiner mock whose meta is otherwise benign but carries NO
        recognised verdict — i.e. what a newly-added fifth venue combiner that
        forgot to stamp would return."""
        meta: dict = {"used_heuristic_capital": False}
        if meta_extra:
            meta.update(meta_extra)
        return MagicMock(return_value=(_two_day_returns(), meta))

    @pytest.mark.asyncio
    async def test_missing_verdict_refuses_permanently_before_any_delete(self) -> None:
        ctx, capture = _build_ctx(
            key_row={"id": "key-v1", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-v1", "user_id": "user-1"},
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-v1"}
        patches = _patches_with_combine(
            ctx, key_mode=False, combine_mock=self._unverdicted_combine()
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        # PERMANENT: a combiner that does not stamp will not start stamping on a
        # retry, so retrying forever is a DoS (T-74-02), not a recovery.
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent", (
            f"an unstamped series is a structural defect, not transient; got "
            f"{result.error_kind!r}"
        )
        assert result.error_message is not None
        assert "MT5-12" in result.error_message

        # ⭐ THE LOAD-BEARING ASSERT — placement, not merely refusal. The
        # authoritative span DELETE must never have executed: a refusal costs the
        # strategy nothing. Neuter: move the verdict check below
        # `await db_execute(_reconcile_span_delete)` → this reddens while a
        # naive "the job failed" assertion would stay green.
        assert [
            d for d in capture["deletes"] if d["table"] == "csv_daily_returns"
        ] == [], (
            "the verdict refusal must precede the reconcile-span DELETE — an "
            "assert placed after it destroys the prior series then declines to "
            f"write a replacement; got {capture['deletes']!r}"
        )
        # Nothing at all touched the series table (no delete, no upsert).
        assert [o for o in capture["ops"] if o[1] == "csv_daily_returns"] == []

        # Strategy-mode terminal stamp: all four companion fields of the
        # `_dispose_broker_nav_error` idiom, so the wizard poller reaches a gate
        # and the reaper cannot re-fire on a stale `computing` stamp.
        sa_upserts = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert len(sa_upserts) == 1, (
            f"strategy-mode refusal must stamp exactly one terminal row; got "
            f"{capture['upserts']!r}"
        )
        _n, payload, on_conflict = sa_upserts[0]
        assert on_conflict == "strategy_id"
        assert payload["computation_status"] == "failed"
        assert payload["computation_warned"] is False, "SI-02 stale-marker guard"
        assert payload["computing_started_at"] is None, "JOB-01 reaper guard"
        assert payload["metrics_json_by_basis"] is None, "F-4 stale by-basis heal"
        # A refusal must NEVER invent a verdict of record — writing one here
        # would launder an unjudged series into the gate's allow-list.
        assert "series_completeness" not in payload

        # T-142.2-14: the message names the verdict and nothing else. No venue,
        # no account identifier, no magnitudes.
        assert "None" in result.error_message
        assert "binance" not in result.error_message
        assert "strat-v1" not in result.error_message

        # No downstream CSV-analytics enqueue: the pipeline stops here.
        assert [
            c for c in capture["rpc_calls"]
            if c[1].get("p_kind") == "compute_analytics_from_csv"
        ] == []

    @pytest.mark.asyncio
    async def test_unrecognised_verdict_string_is_refused_identically(self) -> None:
        """A typo'd or invented value is refused exactly like an omission — the
        gate trusts an ALLOW-LIST, never "some string is present"."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-v2", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-v2", "user_id": "user-1"},
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-v2"}
        combine = self._unverdicted_combine(
            {"series_completeness": "ledger_complete_ish"}
        )
        patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        assert result.error_message is not None
        assert "ledger_complete_ish" in result.error_message
        assert [
            d for d in capture["deletes"] if d["table"] == "csv_daily_returns"
        ] == []
        assert [o for o in capture["ops"] if o[1] == "csv_daily_returns"] == []

    @pytest.mark.asyncio
    async def test_user_column_carries_no_producer_internals(self) -> None:
        """WR-01 (162-REVIEW) — HONEST-01's message/detail split at THIS site.

        ``strategy_analytics.computation_error`` renders VERBATIM to the account
        holder (the portfolio dashboard's StaleWarning and the wizard failure
        envelope). This refusal used to stamp the developer sentence there: a
        repr of the producer's ``series_completeness`` value, plus "MT5-12: every
        daily-series producer must state whether the venue inputs it consumed
        were whole." — a rule number and a producer contract addressed to an
        engineer, rendered to a subscriber.

        ⭐ The claim pinned here is NOT "some substring vanished" — a reworded
        developer sentence would satisfy that and still be developer copy. It is
        that the user-visible sentence is INVARIANT to the producer's internals
        while the operator string still VARIES with them: drive the identical
        refusal twice with two DIFFERENT bogus verdicts and the stamped column
        must come out byte-identical, while ``DispatchResult.error_message``
        (→ ``compute_jobs.last_error``, admin-only) must still name the verdict
        it actually saw, each time.

        Part (3) is the same third part ``test_allocator_positions.py`` holds
        over ``api_keys.sync_error``: curating the write boundary must not become
        curating every surface, or a dishonest screen is traded for a blind
        operator.

        Neuter to redden: restore the pre-fix call — pass ``_detail`` back as the
        stamp's positional ``message`` argument.
        """

        async def _refuse_with(verdict: str, sid: str) -> tuple[object, str]:
            ctx, capture = _build_ctx(
                key_row={
                    "id": f"key-{sid}",
                    "exchange": "binance",
                    "user_id": "user-1",
                },
                strategy_row={"id": sid, "user_id": "user-1"},
            )
            job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": sid}
            patches = _patches_with_combine(
                ctx,
                key_mode=False,
                combine_mock=self._unverdicted_combine(
                    {"series_completeness": verdict}
                ),
            )
            with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
                result = await run_derive_broker_dailies_job(job)
            sa = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
            assert len(sa) == 1, (
                f"the refusal must stamp exactly one terminal row, or nothing "
                f"below is reading the user column; got {capture['upserts']!r}"
            )
            stamped = sa[0][1]["computation_error"]
            assert isinstance(stamped, str) and stamped, (
                "the refusal must still write a user-visible sentence — this "
                f"test is about WHAT it says, not about softening it: {stamped!r}"
            )
            return result, stamped

        result_a, copy_a = await _refuse_with("bogus_verdict_alpha", "strat-wr01a")
        result_b, copy_b = await _refuse_with("bogus_verdict_beta", "strat-wr01b")

        # (1) The user column does not move when only an internal moves.
        assert copy_a == copy_b, (
            "computation_error changed when the ONLY thing that changed was the "
            "producer's verdict value — a developer-audience internal is being "
            f"interpolated into the sentence the account holder reads: "
            f"{copy_a!r} vs {copy_b!r}"
        )

        # (2) And the internals are absent outright, not merely constant.
        for token in (
            "bogus_verdict_alpha",
            "bogus_verdict_beta",
            "series_completeness",
            "MT5-12",
        ):
            assert token not in copy_a, (
                f"{token!r} reached strategy_analytics.computation_error, which "
                f"the account holder reads verbatim: {copy_a!r}"
            )

        # (3) The DIAGNOSIS survives on the operator surface, per-verdict.
        assert result_a.error_message and result_b.error_message  # type: ignore[attr-defined]
        assert "bogus_verdict_alpha" in result_a.error_message  # type: ignore[attr-defined]
        assert "bogus_verdict_beta" in result_b.error_message  # type: ignore[attr-defined]
        for msg in (result_a.error_message, result_b.error_message):  # type: ignore[attr-defined]
            assert "MT5-12" in msg, (
                "the MT5-12 diagnosis must survive where an engineer reads it — "
                f"curating the user column must not blind the operator: {msg!r}"
            )
            assert "series_completeness" in msg

    @pytest.mark.asyncio
    async def test_key_mode_refuses_without_stamping_a_phantom_row(self) -> None:
        """The assert covers BOTH branches of the shared seam. Key-mode (allocator)
        owns no per-key strategy_analytics row, so it refuses WITHOUT stamping —
        a stamp there would write a phantom row keyed on an unbound strategy_id."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-v3", "exchange": "binance", "user_id": "alloc-v3"},
            strategy_row=None,
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "api_key_id": "key-v3"}
        patches = _patches_with_combine(
            ctx, key_mode=True, combine_mock=self._unverdicted_combine()
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        assert [u for u in capture["upserts"] if u[0] == "strategy_analytics"] == [], (
            f"key-mode has no per-key analytics row to stamp; got {capture['upserts']!r}"
        )
        assert [o for o in capture["ops"] if o[1] == "csv_daily_returns"] == []

    @pytest.mark.asyncio
    async def test_happy_path_prestamps_verdict_as_sibling_not_a_dq_flag(self) -> None:
        """The verdict rides `_prestamp_payload` as a TOP-LEVEL column and is NOT a
        member of data_quality_flags.

        Two independent reasons this matters, either one fatal:
          1. data_quality_flags is REPLACED wholesale on every write (and rebuilt
             again by analytics_runner.py:1439), so a verdict carried inside it is
             erased by the next analytics run.
          2. guard-key membership auto-promotes computation_status to
             `complete_with_warnings` — a status the publish gate PASSES. Routing
             a gating signal through the promotion channel is a fail-open (D-16).
        """
        ctx, capture = _build_ctx(
            key_row={"id": "key-v4", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": "strat-v4", "user_id": "user-1"},
        )
        job = {"id": "j", "kind": "derive_broker_dailies", "strategy_id": "strat-v4"}
        patches = _patches(ctx, key_mode=False, returns=_two_day_returns())
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await run_derive_broker_dailies_job(job)

        assert result.outcome == DispatchOutcome.DONE
        sa_upserts = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert len(sa_upserts) == 1
        _n, prestamp, _oc = sa_upserts[0]
        # Hand-typed literal: the ccxt combiner's real verdict, carried through
        # the seam unchanged (never re-judged by the worker).
        assert prestamp["series_completeness"] == "fill_derived_unproven"
        assert "series_completeness" not in prestamp["data_quality_flags"], (
            "the verdict must be a SIBLING of data_quality_flags, never a member "
            "— membership routes it through the wholesale-rebuild + "
            "complete_with_warnings promotion channel (fail-open)"
        )
        # And the series really was persisted (the happy path is not vacuous).
        assert len([u for u in capture["upserts"] if u[0] == "csv_daily_returns"]) == 1


# ── 164.6.6.2.3 plan 07 (D-01 / D-11): the ccxt derive passes the full-history verdict ──
# The verdict is the DQ-02 coverage terminus read on the account's P&L HISTORY (not on the
# fetched flows: the flow fetch starts at the retention floor, so a flow-based verdict would
# be True for every account). The REAL combine runs; the spy records what the derive handed
# it. Dates are relative to the live clock because the verdict is relative to it.


def _utc_day(days_before_now: int) -> str:
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) - timedelta(days=days_before_now)).date().isoformat()


def _stable_deposit(days_before_now: int, amount: float = 5000.0) -> dict[str, object]:
    """A USDT deposit row (valued 1.0, no price index needed) at noon UTC."""
    return {
        "id": f"dep-{days_before_now}",
        "type": "deposit",
        "currency": "USDT",
        "amount": amount,
        "timestamp": _utc_day(days_before_now) + "T12:00:00+00:00",
        "internal": None,
        "info": {},
    }


async def _ccxt_key_derive_with_real_combine(
    *,
    venue: str,
    realized: list[dict[str, object]],
    deposits: list[dict[str, object]],
    equity: float,
    dq_flags: Mapping[str, object] | None = None,
    funding_side_effect: BaseException | None = None,
    expect_raises: type[BaseException] | None = None,
    ctx_hook: Callable[[MagicMock], None] | None = None,
    unified: tuple[list[dict[str, object]], list[dict[str, object]]] | None = None,
    unified_side_effect: BaseException | None = None,
    job_extra: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Run a ccxt KEY-MODE derive with the REAL combine behind a spy. Returns what the
    derive handed the combine (``full_history``, ``external_flows``) and what came back.

    Phase 186 plan 09: ``dq_flags`` makes the patched realized read record those flags INSIDE
    the awaited read (RESEARCH Pitfall 1: that is where ``fetch_daily_pnl`` records them);
    ``funding_side_effect`` makes the venue's funding fetcher raise it; ``expect_raises`` runs
    the derive under ``pytest.raises`` and stores the exception as ``seen["raised"]``. The
    capture of every table write and rpc is ``seen["capture"]``, the fetcher mocks
    ``seen["mocks"]``, the exchange close ``seen["close"]``; ``ctx_hook`` may reshape the
    context's supabase stub before the derive runs.

    Phase 186 plan 10 (D-02): the Bybit branch reads the Unified edge. ``unified`` is the
    ``(deposits, withdrawals)`` that read returns (default none), ``unified_side_effect`` makes it
    raise; the mock is ``seen["mocks"]["unified"]``. It is ALWAYS patched, so no Bybit case can
    reach a live exchange."""
    import services.broker_dailies as _bd
    from services.exchange import _record_dq_flag, get_and_clear_last_dq_flags

    get_and_clear_last_dq_flags()

    real_combine = _bd.combine_realized_and_funding
    seen: dict[str, object] = {}

    def _spy(*args: object, **kwargs: object) -> tuple[pd.Series, dict]:
        returns, meta = real_combine(*args, **kwargs)  # type: ignore[arg-type]
        seen["full_history"] = kwargs.get("full_history", "ABSENT")
        seen["external_flows"] = list(kwargs.get("external_flows") or [])  # type: ignore[call-overload]
        seen["returns"] = returns
        seen["meta"] = meta
        return returns, meta

    ctx, _capture = _build_ctx(
        key_row={"id": "key-fh", "exchange": venue, "user_id": "alloc-fh"},
        strategy_row=None,
    )

    if ctx_hook is not None:
        ctx_hook(ctx)
    close_mock = AsyncMock()
    seen["close"] = close_mock

    async def _transfers(_ex: object, kind: str, _since: int, _now: int) -> list:
        return list(deposits) if kind == "deposits" else []

    async def _realized_read(*_a: object, **_k: object) -> list[dict[str, object]]:
        seen["realized_kwargs"] = dict(_k)
        for _flag, _value in (dq_flags or {}).items():
            _record_dq_flag(_flag, _value)
        return list(realized)

    def _funding_mock() -> AsyncMock:
        if funding_side_effect is not None:
            return AsyncMock(side_effect=funding_side_effect)
        return AsyncMock(return_value=[])

    mocks: dict[str, AsyncMock] = {
        "binance": _funding_mock(),
        "okx": _funding_mock(),
        "bybit": _funding_mock(),
        "transfers": AsyncMock(side_effect=_transfers),
        "unified": (
            AsyncMock(side_effect=unified_side_effect)
            if unified_side_effect is not None
            else AsyncMock(return_value=unified if unified is not None else ([], []))
        ),
    }
    seen["mocks"] = mocks
    seen["capture"] = _capture

    patches = [
        patch("services.job_worker._allocator_key_preflight", new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(side_effect=_realized_read)),
        patch("services.job_worker.aclose_exchange", new=close_mock),
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(equity, False, 0.0, False)),
        ),
        patch("services.funding_fetch.fetch_funding_binance", new=mocks["binance"]),
        patch("services.funding_fetch.fetch_funding_okx", new=mocks["okx"]),
        patch("services.funding_fetch.fetch_funding_bybit", new=mocks["bybit"]),
        patch("services.ccxt_flow_fetch.fetch_ccxt_transfers", new=mocks["transfers"]),
        patch("services.job_worker.fetch_bybit_unified_flows", new=mocks["unified"]),
        patch(
            "services.job_worker._resolve_ccxt_flow_price_index",
            new=AsyncMock(return_value={}),
        ),
        patch("services.broker_dailies.combine_realized_and_funding", new=_spy),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
    ]
    from contextlib import ExitStack

    job = {"id": "j-fh", "kind": "derive_broker_dailies", "api_key_id": "key-fh", **(job_extra or {})}
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        if expect_raises is not None:
            with pytest.raises(expect_raises) as _raised:
                await run_derive_broker_dailies_job(job)
            seen["raised"] = _raised.value
            return seen
        result = await run_derive_broker_dailies_job(job)
    seen["result"] = result
    return seen


def _day_zero_unflagged(seen: dict[str, object]) -> bool:
    meta = seen["meta"]
    return not (meta.get("dust_nav_guard") or meta.get("negative_nav_guard"))  # type: ignore[union-attr]


class TestCcxtFullHistoryVerdictThroughTheDerive:
    """D-11 on the single-key ccxt derive. Every case asserts the verdict the derive handed
    the combine AND the day-0 consequence, so neither a dropped keyword nor a wrong input
    can pass."""

    @pytest.mark.asyncio
    async def test_binance_first_deposit_on_day_zero_is_inception(self) -> None:
        """Binance has no deposit cap: full history. A 5000 deposit on day 0 onto a
        reconstructed zero base is the inception day: no return and no dust/negative flag.
        Neuter (drop the keyword in the derive) and the zero-base guard returns."""
        realized = [
            _daily_pnl_record(_utc_day(6), 0.0),
            _daily_pnl_record(_utc_day(5), 100.0),
            _daily_pnl_record(_utc_day(4), 50.0),
        ]
        seen = await _ccxt_key_derive_with_real_combine(
            venue="binance", realized=realized, deposits=[_stable_deposit(6)], equity=5150.0,
        )
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        assert seen["full_history"] is True
        returns = seen["returns"]
        assert returns.index[0] == pd.Timestamp(_utc_day(6))  # type: ignore[attr-defined]
        assert np.isnan(returns.iloc[0])  # type: ignore[attr-defined]
        assert _day_zero_unflagged(seen)

    @pytest.mark.asyncio
    async def test_okx_pnl_history_older_than_the_floor_is_not_full_history(self) -> None:
        """The production-reachable False case. OKX realized P&L reads the bills archive, so
        it starts 120 days ago, before the 90-day deposit floor, while every FETCHED flow
        (a deposit 30 days ago) sits inside the floor. A verdict on fetched flows would say
        True here; the P&L history says the account is older than the cap. Day 0 keeps
        today's behaviour: a real-capital base, measured."""
        from datetime import datetime, timezone

        from services.nav_twr import flow_retention_floor

        realized = [_daily_pnl_record(_utc_day(120 - i), 10.0) for i in range(0, 118)]
        seen = await _ccxt_key_derive_with_real_combine(
            venue="okx", realized=realized, deposits=[_stable_deposit(30, 1000.0)],
            equity=20_000.0,
        )
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        floor_iso = flow_retention_floor("okx", datetime.now(timezone.utc)).date().isoformat()  # type: ignore[union-attr]
        flows = seen["external_flows"]
        assert flows and all(f.utc_day_iso >= floor_iso for f in flows)  # type: ignore[attr-defined,union-attr]
        returns = seen["returns"]
        assert returns.index[0] == pd.Timestamp(_utc_day(120))  # type: ignore[attr-defined]
        assert seen["full_history"] is False
        assert not np.isnan(returns.iloc[0])  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_okx_history_inside_the_floor_with_a_day_zero_deposit_is_inception(self) -> None:
        realized = [_daily_pnl_record(_utc_day(30 - i), 0.0 if i == 0 else 10.0) for i in range(0, 25)]
        equity = 5000.0 + 10.0 * 24
        seen = await _ccxt_key_derive_with_real_combine(
            venue="okx", realized=realized, deposits=[_stable_deposit(30)], equity=equity,
        )
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        assert seen["full_history"] is True
        returns = seen["returns"]
        assert returns.index[0] == pd.Timestamp(_utc_day(30))  # type: ignore[attr-defined]
        assert np.isnan(returns.iloc[0])  # type: ignore[attr-defined]
        assert _day_zero_unflagged(seen)

    @pytest.mark.asyncio
    async def test_bybit_older_unfetched_deposit_keeps_todays_day_zero(self) -> None:
        """Bybit's P&L fetch bound equals its 365-day deposit floor, so its verdict is True
        for every account. What keeps an account whose first deposit is OLDER than the cap
        out of the inception rule is the core predicate: the older deposit is unfetched, so
        the day-0 base is real capital far above the tolerance. Day 0 is measured, exactly as
        today, even though a later top-up lands on it."""
        realized = [_daily_pnl_record(_utc_day(60 - i), 10.0) for i in range(0, 50)]
        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit", realized=realized, deposits=[_stable_deposit(60, 1000.0)],
            equity=20_000.0,
        )
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        assert seen["full_history"] is True
        returns = seen["returns"]
        assert returns.index[0] == pd.Timestamp(_utc_day(60))  # type: ignore[attr-defined]
        assert not np.isnan(returns.iloc[0])  # type: ignore[attr-defined]
        assert _day_zero_unflagged(seen)


class TestCcxtFullHistoryVerdictHelper:
    """The shared helper itself: it reads the SAME combined input the combine receives."""

    def test_no_record_is_not_full_history(self) -> None:
        from datetime import datetime, timezone

        from services.job_worker import _ccxt_full_history_verdict

        assert _ccxt_full_history_verdict("binance", [], [], datetime.now(timezone.utc)) is False

    def test_the_earliest_of_realized_and_funding_decides(self) -> None:
        """A funding row older than every realized record is the account's first P&L day: it
        is part of the combined input the combine receives, so it must decide the verdict."""
        from datetime import datetime, timedelta, timezone

        from services.job_worker import _ccxt_full_history_verdict

        now = datetime.now(timezone.utc)
        realized = [_daily_pnl_record(_utc_day(30), 10.0)]
        old_funding = [
            {"amount": 1.0, "timestamp": now - timedelta(days=120)},
        ]
        assert _ccxt_full_history_verdict("okx", realized, [], now) is True
        assert _ccxt_full_history_verdict("okx", realized, old_funding, now) is False

    def test_the_day_is_keyed_in_utc_like_the_combine(self) -> None:
        """23:30 UTC on the floor's day is that day (on or after the floor), whatever the
        wall clock; one second before the floor's midnight is the day before (not covered)."""
        from datetime import datetime, timezone

        from services.job_worker import _ccxt_full_history_verdict
        from services.nav_twr import flow_retention_floor

        now = datetime(2026, 7, 6, 9, 0, tzinfo=timezone.utc)
        floor = flow_retention_floor("okx", now)
        assert floor is not None
        floor_day = floor.date().isoformat()
        on_floor = [{**_daily_pnl_record(floor_day, 1.0), "timestamp": floor_day + "T23:30:00+00:00"}]
        before = [{**_daily_pnl_record(floor_day, 1.0), "timestamp": (floor - pd.Timedelta(seconds=1)).isoformat()}]
        assert _ccxt_full_history_verdict("okx", on_floor, [], now) is True
        assert _ccxt_full_history_verdict("okx", before, [], now) is False


# ── Phase 186 plan 09 (D-05, SC-2, SC-6): a truncated or failed read is refused by name ──
# "The run writes nothing for that key. Its last good stored days stay as they are, and the key
# is marked read incomplete by name." The tests below drive the REAL derive with a realized read
# that records its DQ flags inside the awaited read (where ``fetch_daily_pnl`` records them) and
# assert on every write the capture saw, not on a return value alone.

_SC2_APPROVED_STRATEGY_SENTENCE = (
    "We could not read this account's full history from the exchange, "
    "so these numbers stay at the last complete read."
)


def _healthy_okx_history() -> list[dict[str, object]]:
    return [_daily_pnl_record(_utc_day(10 - i), 10.0) for i in range(0, 8)]


def _read_incomplete_rows(capture: dict) -> list[dict]:
    return [
        u[1]
        for u in capture["upserts"]
        if u[0] == "allocator_equity_derived"
        and str(u[1].get("kind", "")).startswith("read_incomplete:")
    ]


def _key_inputs_rows(capture: dict) -> list[dict]:
    return [
        u[1]
        for u in capture["upserts"]
        if u[0] == "allocator_equity_derived" and str(u[1].get("kind", "")).startswith("key_inputs:")
    ]


def _writes_other_than_marker(capture: dict) -> list[tuple]:
    return [
        u
        for u in capture["upserts"]
        if not (
            u[0] == "allocator_equity_derived"
            and str(u[1].get("kind", "")).startswith(("read_incomplete:", "nav_mark_refusal:"))
        )
    ]


_COMPOSE_ENQUEUE = (
    "enqueue_compute_job",
    {"p_strategy_id": None, "p_allocator_id": "alloc-fh", "p_kind": "derive_allocator_equity"},
)


async def _refused_key_derive(
    venue: str, dq_flags: Mapping[str, object], **kw: object
) -> dict[str, object]:
    seen = await _ccxt_key_derive_with_real_combine(
        venue=venue,
        realized=_healthy_okx_history(),
        deposits=[],
        equity=5000.0,
        dq_flags=dq_flags,
        **kw,  # type: ignore[arg-type]
    )
    return seen


def _break_the_marker_write(ctx: MagicMock) -> None:
    """``ctx_hook``: the ``allocator_equity_derived`` upsert fails, so no marker can land."""
    original = ctx.supabase.table.side_effect

    def _table(name: str) -> MagicMock:
        tbl = original(name)
        if name == "allocator_equity_derived":
            tbl.upsert.side_effect = RuntimeError("db down")
        return tbl

    ctx.supabase.table.side_effect = _table


def _assert_nothing_written_but_the_marker(seen: dict[str, object]) -> None:
    capture = seen["capture"]
    assert _writes_other_than_marker(capture) == [], (  # type: ignore[arg-type]
        f"a refused key writes no series, key_inputs, nav mark or analytics: {capture['upserts']!r}"  # type: ignore[index]
    )
    mocks = seen["mocks"]
    for name in ("binance", "okx", "bybit", "transfers"):
        mocks[name].assert_not_awaited()  # type: ignore[index]


class TestRealizedReadRefusedByName:
    """SC-2 on the key-mode derive. RED on today's code: it returns DONE and upserts the
    series from a truncated read."""

    @pytest.mark.asyncio
    async def test_the_derive_asks_for_the_read_deadline_because_it_alone_drains_the_flags(
        self,
    ) -> None:
        """Review SFH-4. The deadline is opt-in on the realized read, and the per-key derive is the
        caller that drains the DQ flags and refuses on them, so it must pass it. Drop the keyword
        and a key too slow to read is no longer stopped at the budget: it runs into the 900 s
        envelope and is retried with no resume."""
        from services.exchange import DAILY_PNL_READ_DEADLINE_S

        seen = await _refused_key_derive("okx", {})
        assert seen["realized_kwargs"] == {  # type: ignore[comparison-overlap]
            "since_ms": None,
            "read_deadline_s": DAILY_PNL_READ_DEADLINE_S,
        }

    @pytest.mark.asyncio
    async def test_okx_truncation_refuses_the_key_and_writes_only_the_marker(self) -> None:
        seen = await _refused_key_derive("okx", {"daily_pnl_truncated_okx": True})
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "permanent"  # type: ignore[attr-defined]
        assert "daily_pnl_truncated_okx" in result.error_message  # type: ignore[attr-defined]
        capture = seen["capture"]
        markers = _read_incomplete_rows(capture)  # type: ignore[arg-type]
        assert len(markers) == 1
        marker = markers[0]
        # T-186-22: the owner is the key row's user_id, never the job payload.
        assert marker["allocator_id"] == "alloc-fh"
        assert marker["kind"] == "read_incomplete:key-fh"
        assert marker["payload"]["token"] == "daily_pnl_truncated_okx"
        assert marker["payload"]["first_seen_day"] == marker["payload"]["last_seen_day"]
        # The compose is told at once so the book can name the key.
        assert capture["rpc_calls"] == [  # type: ignore[index]
            (
                "enqueue_compute_job",
                {
                    "p_strategy_id": None,
                    "p_allocator_id": "alloc-fh",
                    "p_kind": "derive_allocator_equity",
                },
            )
        ]
        # SC-6 / T-186-23: no series, no key_inputs, no nav mark; nothing past the read ran.
        _assert_nothing_written_but_the_marker(seen)

    @pytest.mark.asyncio
    async def test_bybit_truncation_is_refused_permanently(self) -> None:
        seen = await _refused_key_derive("bybit", {"daily_pnl_truncated_bybit": True})
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "permanent"  # type: ignore[attr-defined]
        markers = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert [m["payload"]["token"] for m in markers] == ["daily_pnl_truncated_bybit"]
        _assert_nothing_written_but_the_marker(seen)

    @pytest.mark.asyncio
    async def test_binance_income_fallback_is_refused_permanently(self) -> None:
        seen = await _refused_key_derive("binance", {"daily_pnl_binance_income_fallback": True})
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "permanent"  # type: ignore[attr-defined]
        markers = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert [m["payload"]["token"] for m in markers] == ["daily_pnl_binance_income_fallback"]
        _assert_nothing_written_but_the_marker(seen)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("venue", "flag"),
        [("okx", "daily_pnl_deadline_okx"), ("bybit", "daily_pnl_deadline_bybit")],
    )
    async def test_a_deadline_hit_is_refused_by_name_but_as_transient_so_it_is_retried(
        self, venue: str, flag: str
    ) -> None:
        """Review WR-06. A cap hit is deterministic (the same history hits it again), a deadline
        hit is venue latency: a retry an hour later may read the key in full. The refusal is named
        with its own closed token and is TRANSIENT; refused permanently it dropped the key for the
        whole day (the next key-mode derive is the 05:30 fan-out)."""
        seen = await _refused_key_derive(venue, {flag: True})
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["payload"]["token"] == "read_deadline"
        _assert_nothing_written_but_the_marker(seen)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("venue", "flag"),
        [("okx", "daily_pnl_malformed_okx"), ("bybit", "daily_pnl_malformed_bybit")],
    )
    async def test_a_read_that_dropped_malformed_rows_is_not_refused_and_the_key_publishes(
        self, venue: str, flag: str
    ) -> None:
        """Founder decision D-12 (2026-11-04), reversing review SFH-5. A malformed row is the row's
        content, so a retry drops the same row and the key would be refused every day for as long
        as the row stays in the walk, with no one having counted how many production keys carry
        one. The row is stamped as a data-quality flag (``daily_pnl_malformed_*``, pinned in
        ``test_exchange_harness.py``) and the key keeps publishing, as it did before 186. RED
        before: the derive wrote only a ``read_malformed`` marker and no series."""
        seen = await _refused_key_derive(venue, {flag: True})
        result = seen["result"]
        assert result.outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        assert _read_incomplete_rows(seen["capture"]) == []  # type: ignore[arg-type]
        assert _writes_other_than_marker(seen["capture"]) != []  # type: ignore[arg-type]
        # Review R3-03: D-12 says the dropped row is recorded as a data-quality flag "rather than
        # only a log line". Key mode records it on the key's own owner-only ``key_inputs`` record
        # (never the publicly readable strategy_analytics.data_quality_flags), so the production
        # count is a SELECT over it. RED before: the derive drained the flag into the verdict and
        # dropped it, so nothing stored it.
        (key_inputs,) = _key_inputs_rows(seen["capture"])  # type: ignore[arg-type]
        assert key_inputs["payload"]["daily_pnl_malformed"] == [flag]
        assert [u for u in seen["capture"]["upserts"] if u[0] == "strategy_analytics"] == []  # type: ignore[index]

    @pytest.mark.asyncio
    async def test_a_clean_re_read_stores_no_malformed_flag(self) -> None:
        """The record is rewritten whole on every derive, so a clean re-read clears the flag."""
        seen = await _refused_key_derive("okx", {})
        (key_inputs,) = _key_inputs_rows(seen["capture"])  # type: ignore[arg-type]
        assert "daily_pnl_malformed" not in key_inputs["payload"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("attempts", [2, 3])
    async def test_a_deadline_hit_on_a_retry_is_refused_permanently(self, attempts: int) -> None:
        """Review R2-05. A deadline hit caused by volume (two heavy weeks of pages) is the same
        size on every retry, so retrying it burns every attempt of every day for nothing. It is
        transient on the FIRST attempt only (the test above); from the second it is permanent,
        still named ``read_deadline``. RED before: every attempt came back transient."""
        seen = await _refused_key_derive(
            "okx", {"daily_pnl_deadline_okx": True}, job_extra={"attempts": attempts, "max_attempts": 3}
        )
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "permanent"  # type: ignore[attr-defined]
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["payload"]["token"] == "read_deadline"
        _assert_nothing_written_but_the_marker(seen)

    @pytest.mark.asyncio
    async def test_a_deadline_hit_on_the_first_attempt_stays_transient(self) -> None:
        """The boundary of the test above: ``attempts`` 1 is the first attempt."""
        seen = await _refused_key_derive(
            "okx", {"daily_pnl_deadline_okx": True}, job_extra={"attempts": 1, "max_attempts": 3}
        )
        assert seen["result"].error_kind == "transient"  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_a_cap_hit_beside_a_deadline_hit_stays_permanent(self) -> None:
        """The cap is deterministic: a retry cannot shorten the history, so it wins."""
        seen = await _refused_key_derive(
            "okx", {"daily_pnl_deadline_okx": True, "daily_pnl_truncated_okx": True}
        )
        assert seen["result"].error_kind == "permanent"  # type: ignore[attr-defined]
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["payload"]["token"] == "daily_pnl_truncated_okx"

    @pytest.mark.asyncio
    async def test_a_refusal_whose_marker_write_failed_is_transient_so_the_retry_names_the_key(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Review SFH-2. ``_record_read_incomplete`` never raises, so a failed marker write used
        to leave a permanently refused key unnamed AND unretried until the next day's derive.
        The refusal stays a refusal (nothing else is written) but is transient, so the queue
        retries it and the retry writes the marker."""

        def _break_the_marker_write(ctx: MagicMock) -> None:
            original = ctx.supabase.table.side_effect

            def _table(name: str) -> MagicMock:
                tbl = original(name)
                if name == "allocator_equity_derived":
                    tbl.upsert.side_effect = RuntimeError("db down")
                return tbl

            ctx.supabase.table.side_effect = _table

        with caplog.at_level("WARNING"):
            seen = await _refused_key_derive(
                "okx", {"daily_pnl_truncated_okx": True}, ctx_hook=_break_the_marker_write
            )
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        assert "read incomplete marker not recorded" in caplog.text
        assert _writes_other_than_marker(seen["capture"]) == []  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_fetch_error_is_transient_and_names_the_class_only(self) -> None:
        seen = await _refused_key_derive(
            "okx",
            {
                "daily_pnl_fetch_error": True,
                "daily_pnl_fetch_error_class": "NetworkError",
            },
        )
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        assert "daily_pnl_fetch_error" in result.error_message  # type: ignore[attr-defined]
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["payload"]["token"] == "daily_pnl_fetch_error"
        assert marker["payload"]["error_class"] == "NetworkError"
        _assert_nothing_written_but_the_marker(seen)

    @pytest.mark.asyncio
    async def test_a_venue_message_in_the_class_slot_is_never_stored(self) -> None:
        """T-186-21: only an identifier-shaped class name survives; a signed URL does not."""
        leaky = "https://api.venue.example/v5?sign=abc123 failed"
        seen = await _refused_key_derive(
            "okx",
            {"daily_pnl_fetch_error": True, "daily_pnl_fetch_error_class": leaky},
        )
        result = seen["result"]
        assert "abc123" not in result.error_message  # type: ignore[attr-defined]
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert "abc123" not in repr(marker)

    @pytest.mark.asyncio
    async def test_a_rate_limited_read_defers_to_the_429_arm_and_marks_nothing(self) -> None:
        import ccxt

        stamp = AsyncMock()
        with patch("services.job_worker._stamp_429", new=stamp):
            seen = await _refused_key_derive(
                "okx",
                {
                    "daily_pnl_fetch_error": True,
                    "daily_pnl_fetch_error_class": "RateLimitExceeded",
                },
                expect_raises=ccxt.RateLimitExceeded,
            )
        assert isinstance(seen["raised"], ccxt.RateLimitExceeded)
        stamp.assert_awaited_once()
        assert seen["capture"]["upserts"] == []  # type: ignore[index]
        assert seen["capture"]["rpc_calls"] == []  # type: ignore[index]

    @pytest.mark.asyncio
    async def test_the_exchange_is_still_closed_on_a_refusal(self) -> None:
        seen = await _refused_key_derive("okx", {"daily_pnl_truncated_okx": True})
        assert seen["result"].outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        seen["close"].assert_awaited()  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_a_clean_read_is_not_refused(self) -> None:
        """The refusal is not vacuous: no flag, same history, the key derives."""
        seen = await _refused_key_derive("okx", {})
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        assert _read_incomplete_rows(seen["capture"]) == []  # type: ignore[arg-type]


class TestATimedOutReadIsNamed:
    """Review WR-03 / SFH-1. SC-2 says a failed read refuses the key BY NAME. A funding or flow
    read that timed out, or a derive that overran its 900 s envelope, returned a transient failure
    with no marker, so once the retries ran out the key was carried flat in the book and nobody
    was told. Each now records ``read_timeout`` and enqueues the compose; the outcome stays
    transient (a retry may well read the key)."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("venue", ["okx", "binance", "bybit"])
    async def test_a_funding_read_that_times_out_is_marked_and_the_book_is_told(
        self, venue: str
    ) -> None:
        import asyncio

        seen = await _ccxt_key_derive_with_real_combine(
            venue=venue,
            realized=_healthy_okx_history(),
            deposits=[],
            equity=5000.0,
            funding_side_effect=asyncio.TimeoutError(),
        )
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["kind"] == "read_incomplete:key-fh"
        assert marker["payload"]["token"] == "read_timeout"
        assert marker["payload"]["error_class"] == "TimeoutError"
        assert _COMPOSE_ENQUEUE in seen["capture"]["rpc_calls"]  # type: ignore[index]
        assert _writes_other_than_marker(seen["capture"]) == []  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_a_unified_flow_read_that_times_out_is_marked_and_the_book_is_told(self) -> None:
        import asyncio

        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit",
            realized=_internally_funded_history(),
            deposits=[],
            equity=15_500.0,
            unified_side_effect=asyncio.TimeoutError(),
        )
        assert seen["result"].error_kind == "transient"  # type: ignore[attr-defined]
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["payload"]["token"] == "read_timeout"
        assert _COMPOSE_ENQUEUE in seen["capture"]["rpc_calls"]  # type: ignore[index]
        assert _writes_other_than_marker(seen["capture"]) == []  # type: ignore[arg-type]

    @staticmethod
    async def _dispatch_overrun(job: dict) -> tuple[object, MagicMock, MagicMock]:
        import asyncio

        from services.job_worker import TIMEOUT_PER_KIND, dispatch

        async def _never_finishes(_job: dict) -> None:
            await asyncio.sleep(30)

        supabase = MagicMock()
        supabase.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
            data={"user_id": "alloc-fh"}
        )
        record = AsyncMock(return_value=True)
        enqueue = MagicMock()
        with (
            patch.dict(TIMEOUT_PER_KIND, {"derive_broker_dailies": 0.05}),
            patch("services.job_worker.run_derive_broker_dailies_job", new=_never_finishes),
            patch("services.job_worker.get_supabase", return_value=supabase),
            patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
            patch("services.job_worker._record_read_incomplete", new=record),
            patch("services.job_worker._enqueue_allocator_compose", new=enqueue),
        ):
            result = await dispatch(job)
        return result, record, enqueue

    @pytest.mark.asyncio
    async def test_a_key_mode_derive_that_overruns_its_budget_is_marked_and_the_book_is_told(
        self,
    ) -> None:
        result, record, enqueue = await self._dispatch_overrun(
            {"id": "j-1", "kind": "derive_broker_dailies", "api_key_id": "key-fh"}
        )
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        record.assert_awaited_once()
        kwargs = record.await_args.kwargs  # type: ignore[union-attr]
        # The owner is the key row's user_id, never a job-payload value.
        assert kwargs["allocator_id"] == "alloc-fh"
        assert kwargs["api_key_id"] == "key-fh"
        assert kwargs["token"] == "read_timeout"
        assert kwargs["error_class"] == "TimeoutError"
        enqueue.assert_called_once()
        assert enqueue.call_args.args[1] == "alloc-fh"

    @pytest.mark.asyncio
    async def test_an_overrun_whose_marker_did_not_land_is_logged_at_error(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Review SFH M1. The overrun is transient and retried, but a marker that never lands
        leaves the key unnamed; that is an ERROR, not only the marker writer's WARNING."""
        from services.job_worker import TIMEOUT_PER_KIND, dispatch
        import asyncio

        async def _never_finishes(_job: dict) -> None:
            await asyncio.sleep(30)

        supabase = MagicMock()
        supabase.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
            data={"user_id": "alloc-fh"}
        )
        with (
            patch.dict(TIMEOUT_PER_KIND, {"derive_broker_dailies": 0.05}),
            patch("services.job_worker.run_derive_broker_dailies_job", new=_never_finishes),
            patch("services.job_worker.get_supabase", return_value=supabase),
            patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
            patch("services.job_worker._record_read_incomplete", new=AsyncMock(return_value=False)),
            patch("services.job_worker._enqueue_allocator_compose", new=MagicMock()),
            caplog.at_level("WARNING"),
        ):
            result = await dispatch(
                {"id": "j-3", "kind": "derive_broker_dailies", "api_key_id": "key-fh"}
            )
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        errors = [r for r in caplog.records if r.levelname == "ERROR" and "overrun key not named" in r.getMessage()]
        assert len(errors) == 1
        assert "key-fh" in errors[0].getMessage()

    @pytest.mark.asyncio
    async def test_a_strategy_mode_overrun_marks_nobody(self) -> None:
        result, record, enqueue = await self._dispatch_overrun(
            {"id": "j-2", "kind": "derive_broker_dailies", "strategy_id": "strat-1"}
        )
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        record.assert_not_awaited()
        enqueue.assert_not_called()


class TestReadIncompleteMarkerHelpers:
    """``_record_read_incomplete`` / ``_clear_read_incomplete``: owner-only, closed tokens,
    never raising."""

    @staticmethod
    def _store() -> tuple[MagicMock, dict]:
        rows: dict[tuple[str, str], dict] = {}
        log: dict = {"upserts": [], "deletes": []}
        supa = MagicMock()

        def _table(name: str) -> MagicMock:
            assert name == "allocator_equity_derived"
            t = MagicMock()
            query: dict = {}

            def _select(*_a: object) -> MagicMock:
                return t

            def _eq(col: str, val: object) -> MagicMock:
                query[col] = val
                return t

            def _execute() -> MagicMock:
                key = (str(query.get("allocator_id")), str(query.get("kind")))
                if query.get("_delete"):
                    log["deletes"].append(key)
                    rows.pop(key, None)
                    return MagicMock(data=[])
                row = rows.get(key)
                return MagicMock(data=[row] if row else [])

            def _upsert(payload: dict, **_k: object) -> MagicMock:
                log["upserts"].append(payload)
                rows[(payload["allocator_id"], payload["kind"])] = payload
                stub = MagicMock()
                stub.execute.return_value = MagicMock(data=1)
                return stub

            def _delete() -> MagicMock:
                query["_delete"] = True
                return t

            t.select.side_effect = _select
            t.eq.side_effect = _eq
            t.limit.return_value = t
            t.execute.side_effect = _execute
            t.upsert.side_effect = _upsert
            t.delete.side_effect = _delete
            return t

        supa.table.side_effect = _table
        return supa, log

    @pytest.mark.asyncio
    async def test_a_second_refusal_keeps_first_seen_day_and_moves_last_seen_day(self) -> None:
        from services.job_worker import _record_read_incomplete

        supa, log = self._store()
        with patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())):
            await _record_read_incomplete(
                supa,
                allocator_id="a",
                api_key_id="k",
                token="daily_pnl_truncated_okx",
                error_class=None,
                day="2026-11-01",
            )
            await _record_read_incomplete(
                supa,
                allocator_id="a",
                api_key_id="k",
                token="daily_pnl_fetch_error",
                error_class="NetworkError",
                day="2026-11-03",
            )
        payload = log["upserts"][-1]["payload"]
        assert payload["first_seen_day"] == "2026-11-01"
        assert payload["last_seen_day"] == "2026-11-03"
        assert payload["token"] == "daily_pnl_fetch_error"
        assert payload["error_class"] == "NetworkError"

    @pytest.mark.asyncio
    async def test_a_token_outside_the_closed_set_writes_nothing(self, caplog: pytest.LogCaptureFixture) -> None:
        from services.job_worker import READ_INCOMPLETE_TOKENS, _record_read_incomplete

        assert "https://x.example/?sign=1" not in READ_INCOMPLETE_TOKENS
        supa, log = self._store()
        with patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())):
            await _record_read_incomplete(
                supa,
                allocator_id="a",
                api_key_id="k",
                token="https://x.example/?sign=1",
                error_class=None,
                day="2026-11-03",
            )
        assert log["upserts"] == []

    @pytest.mark.asyncio
    async def test_the_token_set_is_exactly_the_shipped_closed_set(self) -> None:
        from services.job_worker import READ_INCOMPLETE_KIND_PREFIX, READ_INCOMPLETE_TOKENS

        assert READ_INCOMPLETE_KIND_PREFIX == "read_incomplete:"
        assert READ_INCOMPLETE_TOKENS == frozenset(
            {
                "daily_pnl_fetch_error",
                "daily_pnl_truncated_okx",
                "daily_pnl_truncated_bybit",
                "daily_pnl_binance_income_fallback",
                "read_deadline",
                "read_timeout",
                "funding_truncated",
                "funding_fetch_error",
                "funding_rows_malformed",
                "bybit_unified_flow_error",
            }
        )

    @pytest.mark.asyncio
    async def test_record_and_clear_never_raise(self, caplog: pytest.LogCaptureFixture) -> None:
        from services.job_worker import _clear_read_incomplete, _record_read_incomplete

        broken = MagicMock()
        broken.table.side_effect = RuntimeError("signed-url-secret")
        with patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())):
            with caplog.at_level("WARNING"):
                await _record_read_incomplete(
                    broken,
                    allocator_id="a",
                    api_key_id="k",
                    token="funding_truncated",
                    error_class=None,
                    day="2026-11-03",
                )
                await _clear_read_incomplete(broken, allocator_id="a", api_key_id="k")
        text = caplog.text
        assert "RuntimeError" in text
        assert "signed-url-secret" not in text


class TestStrategyModeRefusal:
    """Strategy mode names the refusal and leaves the published series alone
    (``heal_series=False``); it writes no marker.

    Review WR-01. The founder-approved sentence says the numbers "stay at the last complete
    read", so it is stamped only where numbers exist to stay, and there it is written ERROR-ONLY
    (status, metrics and flags untouched). Where no published numbers exist the stamp is the
    failed one and carries no sentence at all (the approved one would promise numbers that were
    never there)."""

    @staticmethod
    async def _refuse(
        caplog: pytest.LogCaptureFixture,
        stored_row: dict | None,
        *,
        live_job_metadata: dict | None = None,
        claimed_job_metadata: dict | None = None,
        break_the_job_marker_write: bool = False,
        marker_rpc_answer: object = True,
        capture_into: dict | None = None,
        dq_flag: str = "daily_pnl_truncated_okx",
        attempts: tuple[int, int] | None = None,
    ) -> tuple[object, dict]:
        from services.exchange import _record_dq_flag, get_and_clear_last_dq_flags

        get_and_clear_last_dq_flags()
        ctx, capture = _build_ctx(
            key_row={"id": "key-st", "exchange": "okx", "user_id": "user-st"},
            strategy_row={"id": "strat-st", "user_id": "user-st"},
        )
        if capture_into is not None:
            # The lists are shared, so a caller whose derive raises can still read what was written.
            capture_into.update(capture)
        original_table = ctx.supabase.table.side_effect

        def _table(name: str) -> MagicMock:
            tbl = original_table(name)
            if name == "strategy_analytics":
                tbl.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = (
                    MagicMock(data=stored_row)
                )
            if name == "compute_jobs":
                tbl.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = (
                    MagicMock(data={"metadata": live_job_metadata})
                )
            return tbl

        ctx.supabase.table.side_effect = _table

        # Phase 191 D-03: the marker is one rpc, not a compute_jobs read and update. The knobs
        # drive THAT call: a raise is a write error, any other answer is what the function said.
        original_rpc = ctx.supabase.rpc.side_effect

        def _rpc(name: str, payload: dict) -> MagicMock:
            stub = original_rpc(name, payload)
            if name == "mark_compute_job_kept_figures":
                if break_the_job_marker_write:
                    stub.execute.side_effect = RuntimeError("db down")
                else:
                    stub.execute.return_value = MagicMock(data=marker_rpc_answer)
            return stub

        ctx.supabase.rpc.side_effect = _rpc

        async def _realized(*_a: object, **_k: object) -> list:
            _record_dq_flag(dq_flag, True)
            return _healthy_okx_history()

        patches = [
            patch("services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)),
            patch("services.job_worker.fetch_all_trades", new=AsyncMock(side_effect=_realized)),
            patch("services.job_worker.aclose_exchange", new=AsyncMock()),
            patch(
                "services.exchange.fetch_account_equity_and_upnl_usd",
                new=AsyncMock(return_value=(5000.0, False, 0.0, False)),
            ),
            patch("services.funding_fetch.fetch_funding_okx", new=AsyncMock(return_value=[])),
            patch(
                "services.job_worker.db_execute",
                new=AsyncMock(side_effect=lambda fn: fn()),
            ),
            patch(
                "services.job_worker.db_read_with_retry",
                new=AsyncMock(side_effect=lambda fn: fn()),
            ),
        ]
        from contextlib import ExitStack

        with ExitStack() as stack, caplog.at_level("WARNING"):
            for p in patches:
                stack.enter_context(p)
            result = await run_derive_broker_dailies_job(
                {
                    "id": "j-st",
                    "kind": "derive_broker_dailies",
                    "strategy_id": "strat-st",
                    **({"metadata": claimed_job_metadata} if claimed_job_metadata else {}),
                    **({"attempts": attempts[0], "max_attempts": attempts[1]} if attempts else {}),
                }
            )
        return result, capture

    @staticmethod
    def _assert_nothing_else_written(capture: dict) -> None:
        # heal_series=False: the published series is never deleted.
        assert [d for d in capture["deletes"] if d["table"] != "strategy_analytics"] == []
        assert [u for u in capture["upserts"] if u[0] == "csv_daily_returns"] == []
        assert [u for u in capture["upserts"] if u[0] == "allocator_equity_derived"] == []
        # The refusal marker is itself an rpc (Phase 191): it is the one write this helper allows.
        assert [c for c in capture["rpc_calls"] if c[0] != "mark_compute_job_kept_figures"] == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "stored_row",
        [
            pytest.param(
                {"computation_status": "complete", "metrics_json": {"a": 1}, "metrics_json_by_basis": None},
                id="complete",
            ),
            # The status bridge rewrites a published row to 'computing' while the follow-on job is
            # pending, so the numbers are the oracle, not the status. Review R3-01: the numbers are
            # the headline ``metrics_json``. The by-basis column is NULL on every path but a Deribit
            # options book, so this is the shape of every perp-only, ccxt or key-mode strategy.
            pytest.param(
                {"computation_status": "computing", "metrics_json": {"a": 1}, "metrics_json_by_basis": None},
                id="computing-over-published-headline-with-null-by-basis",
            ),
        ],
    )
    async def test_where_numbers_exist_the_refusal_is_error_only_and_keeps_them(
        self, caplog: pytest.LogCaptureFixture, stored_row: dict
    ) -> None:
        result, capture = await self._refuse(caplog, stored_row)
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "permanent"  # type: ignore[attr-defined]
        assert "daily_pnl_truncated_okx" in result.error_message  # type: ignore[attr-defined]
        sa = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert len(sa) == 1
        payload = sa[0][1]
        assert payload["computation_error"] == _SC2_APPROVED_STRATEGY_SENTENCE
        # Phase 186 D-11: the writer provenance naming this job is what the status bridge keeps
        # as the row's sentence (migration 20261105120000); the job's own marker, asserted below,
        # is what makes the bridge keep the status and the numbers.
        assert payload["computation_error_source"] == "writer"
        assert payload["computation_error_job_id"] == "j-st"
        # The sentence says the numbers stay, so the write must not touch them.
        for column in ("computation_status", "metrics_json_by_basis", "data_quality_flags"):
            assert column not in payload, column
        # detail rides the log line, never the curated column.
        assert "daily_pnl_truncated_okx" not in payload["computation_error"]
        assert "detail: daily_pnl_truncated_okx" in caplog.text
        self._assert_nothing_else_written(capture)
        # Review R3-02: the job carries its own marker, written BEFORE the sentence, so the status
        # bridge keeps the figures for as long as this failure is live (the row's provenance is
        # overwritten by the next sync and the next refusal).
        # Phase 191 D-03: ONE rpc carries the marker, and Python issues no compute_jobs update, so
        # no read-to-write window exists for a retraction or the claim's key to be undone in.
        assert capture["rpc_calls"] == [("mark_compute_job_kept_figures", {"p_job_id": "j-st"})]
        assert capture["updates"] == []
        ops = capture["ops"]
        assert ops.index(("rpc", "mark_compute_job_kept_figures")) < ops.index(
            ("upsert", "strategy_analytics")
        )

    @pytest.mark.asyncio
    async def test_the_job_marker_is_merged_into_the_live_metadata_not_written_over_it(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Phase 191 (the lost-write race). The merge now happens in ONE SQL statement, so what
        survives it is the database's business, proven by the SQL gate. What THIS side must guarantee
        is that no copy of the metadata travels from Python to the write: a copy read earlier goes
        stale the moment a retraction or the claim's key lands, and writing it back would undo them.
        So the payload is exactly the job id, even when the live row carries other keys."""
        live = {"unified_backbone_at_claim": True, "refresh_marker_retracted": "ledger-refresh"}
        _, capture = await self._refuse(
            caplog,
            {"computation_status": "complete", "metrics_json": {"a": 1}, "metrics_json_by_basis": None},
            live_job_metadata=live,
        )
        assert capture["rpc_calls"] == [("mark_compute_job_kept_figures", {"p_job_id": "j-st"})]
        assert capture["updates"] == []

    @pytest.mark.asyncio
    async def test_a_refusal_on_a_job_a_users_sync_now_took_over_is_marked_too(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Review R3-04. A user's Sync now folded into an in-flight marked refresh retracts the
        refresh marker on the live row. The refusal that follows is the answer that user is waiting
        for: it keeps the figures, writes the approved sentence and marks the job, so the bridge
        does not stamp the row failed under "these numbers stay"."""
        live = {"refresh_marker_retracted": "ledger-refresh"}
        result, capture = await self._refuse(
            caplog,
            {"computation_status": "complete", "metrics_json": {"a": 1}, "metrics_json_by_basis": None},
            live_job_metadata=live,
            claimed_job_metadata={"source": "ledger-refresh"},
        )
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert capture["rpc_calls"] == [("mark_compute_job_kept_figures", {"p_job_id": "j-st"})]
        assert capture["updates"] == []
        sa = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert len(sa) == 1
        assert sa[0][1]["computation_error"] == _SC2_APPROVED_STRATEGY_SENTENCE
        assert "computation_status" not in sa[0][1]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("dq_flag", "attempts"),
        [
            pytest.param("daily_pnl_fetch_error", (1, 3), id="transient-fetch-error-first-attempt"),
            pytest.param("daily_pnl_fetch_error", (2, 3), id="transient-fetch-error-middle-attempt"),
            pytest.param("daily_pnl_deadline_okx", (1, 3), id="first-attempt-deadline"),
        ],
    )
    async def test_a_retryable_refusal_over_published_figures_writes_nothing_to_the_row(
        self, caplog: pytest.LogCaptureFixture, dq_flag: str, attempts: tuple[int, int]
    ) -> None:
        """Review PR3-01 and R4-01. The marker means the refusal is FINAL, and the sentence follows
        it. A retryable refusal over published figures writes neither: not the marker (it would
        cross attempts and protect the job's later failure), and not the sentence (on a warned row
        the bridge keeps it through the retry, so a later non-refusal failure would keep "these
        numbers stay" over ``failed``). The retry decides alone."""
        result, capture = await self._refuse(
            caplog,
            {"computation_status": "complete", "metrics_json": {"a": 1}, "metrics_json_by_basis": None},
            dq_flag=dq_flag,
            attempts=attempts,
        )
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        assert capture["updates"] == []
        assert capture["rpc_calls"] == []
        assert [u for u in capture["upserts"] if u[0] == "strategy_analytics"] == []
        self._assert_nothing_else_written(capture)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("dq_flag", "attempts", "error_kind"),
        [
            pytest.param("daily_pnl_fetch_error", (3, 3), "transient", id="transient-on-the-last-attempt"),
            pytest.param("daily_pnl_deadline_okx", (2, 3), "permanent", id="repeat-deadline-is-permanent"),
            pytest.param("daily_pnl_truncated_okx", (1, 3), "permanent", id="permanent-on-the-first-attempt"),
        ],
    )
    async def test_a_final_refusal_writes_the_marker_before_the_sentence(
        self, caplog: pytest.LogCaptureFixture, dq_flag: str, attempts: tuple[int, int], error_kind: str
    ) -> None:
        """Review PR3-01, the other half: a refusal that is final (permanent, or transient on the
        last attempt, which ``mark_compute_job_failed`` makes ``failed_final``) is marked. Phase 191:
        the mark is one ``mark_compute_job_kept_figures`` rpc, not a compute_jobs update."""
        result, capture = await self._refuse(
            caplog,
            {"computation_status": "complete", "metrics_json": {"a": 1}, "metrics_json_by_basis": None},
            dq_flag=dq_flag,
            attempts=attempts,
        )
        assert result.error_kind == error_kind  # type: ignore[attr-defined]
        assert capture["rpc_calls"] == [("mark_compute_job_kept_figures", {"p_job_id": "j-st"})]
        assert capture["updates"] == []
        ops = capture["ops"]
        assert ops.index(("rpc", "mark_compute_job_kept_figures")) < ops.index(
            ("upsert", "strategy_analytics")
        )

    @pytest.mark.asyncio
    async def test_a_marker_that_did_not_land_fails_the_job_transient_and_writes_no_sentence(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """A sentence without its marker is the contradiction the bridge cannot undo: it would stamp
        the row failed under "these numbers stay". So the marker is written first, and if it cannot
        be written nothing is, and the queue retries. Phase 191: the write that fails is now the
        ``mark_compute_job_kept_figures`` rpc raising, and the stamp's op text rides the cause."""
        from services.job_worker import _STAMP_OP_REFUSAL_MARKER_WRITE, StampIOUnavailable

        with pytest.raises(StampIOUnavailable, match=_STAMP_OP_REFUSAL_MARKER_WRITE):
            await self._refuse(
                caplog,
                {"computation_status": "complete", "metrics_json": {"a": 1}, "metrics_json_by_basis": None},
                break_the_job_marker_write=True,
            )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "answer",
        [
            pytest.param(False, id="false-no-row-changed"),
            pytest.param(None, id="none-no-answer"),
            pytest.param(1, id="one-is-not-true"),
            pytest.param("true", id="string-true-is-not-true"),
        ],
    )
    async def test_a_marker_the_function_did_not_confirm_fails_the_job_transient_with_no_sentence(
        self, caplog: pytest.LogCaptureFixture, answer: object
    ) -> None:
        """Phase 191 D-07. The marker counts as written only when the function answers exactly
        ``True``. Before this phase a zero-row update was silent success, and the status bridge
        would then stamp ``failed`` over figures the refusal kept. Every other answer (``False`` is
        a job that is gone, ``None`` an empty body, ``1`` and ``"true"`` a changed contract) raises
        inside the stamp's closure, which ``_stamp_io`` files as ``StampIOUnavailable``
        (TRANSIENT), and neither the sentence nor anything else is written."""
        from services.job_worker import _STAMP_OP_REFUSAL_MARKER_WRITE, StampIOUnavailable

        captured: dict = {}
        with pytest.raises(StampIOUnavailable, match=_STAMP_OP_REFUSAL_MARKER_WRITE) as excinfo:
            await self._refuse(
                caplog,
                {"computation_status": "complete", "metrics_json": {"a": 1}, "metrics_json_by_basis": None},
                marker_rpc_answer=answer,
                capture_into=captured,
            )
        assert "did not confirm the marker write" in str(excinfo.value.__cause__)
        # No sentence, no series write, no second marker attempt.
        assert [u for u in captured["upserts"] if u[0] == "strategy_analytics"] == []
        assert captured["updates"] == []
        assert captured["rpc_calls"] == [("mark_compute_job_kept_figures", {"p_job_id": "j-st"})]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "stored_row",
        [
            pytest.param(None, id="no-row"),
            pytest.param(
                {"computation_status": "computing", "metrics_json": None, "metrics_json_by_basis": None},
                id="first-compute",
            ),
            # Review R3-01 (worker and bridge agree): by-basis alone is not figures, and a 'failed'
            # row is not published whatever it still carries.
            pytest.param(
                {"computation_status": "computing", "metrics_json": None, "metrics_json_by_basis": {"a": 1}},
                id="computing-with-only-a-by-basis-object",
            ),
            pytest.param(
                {"computation_status": "failed", "metrics_json": {"a": 1}, "metrics_json_by_basis": None},
                id="failed-row-with-stale-headline",
            ),
        ],
    )
    async def test_where_no_numbers_exist_the_failed_stamp_carries_no_promise(
        self, caplog: pytest.LogCaptureFixture, stored_row: dict | None
    ) -> None:
        result, capture = await self._refuse(caplog, stored_row)
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        sa = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert len(sa) == 1
        payload = sa[0][1]
        assert payload["computation_status"] == "failed"
        # Review R2-02: NO sentence and NO writer provenance are written. A writer sentence (even
        # an empty one) is kept by the status bridge over its per-kind curated copy, which left
        # every surface showing a bare "failed" with no cause. Asserted on what is WRITTEN: the
        # keys are present and None, so the upsert clears any earlier sentence and markers too.
        assert payload["computation_error"] is None
        assert payload["computation_error_source"] is None
        assert payload["computation_error_job_id"] is None
        assert "detail: daily_pnl_truncated_okx" in caplog.text
        self._assert_nothing_else_written(capture)
        # No figures to keep, so no marker: the bridge must stamp this one failed.
        assert capture["updates"] == []
        assert capture["rpc_calls"] == []


class TestFundingReadRefusedByName:
    """D-05 'realized or funding read': the funding half."""

    @pytest.mark.asyncio
    async def test_a_funding_page_ceiling_is_refused_permanently(self) -> None:
        from services.funding_fetch import FundingFetchCeilingExceeded

        seen = await _ccxt_key_derive_with_real_combine(
            venue="okx",
            realized=_healthy_okx_history(),
            deposits=[],
            equity=5000.0,
            funding_side_effect=FundingFetchCeilingExceeded("okx funding hit its page ceiling"),
        )
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "permanent"  # type: ignore[attr-defined]
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["payload"]["token"] == "funding_truncated"
        assert _writes_other_than_marker(seen["capture"]) == []  # type: ignore[arg-type]
        seen["mocks"]["transfers"].assert_not_awaited()  # type: ignore[index]

    @pytest.mark.asyncio
    async def test_malformed_funding_rows_are_refused_and_asked_for_with_raise(self) -> None:
        from services.funding_fetch import FundingRowsMalformed

        seen = await _ccxt_key_derive_with_real_combine(
            venue="okx",
            realized=_healthy_okx_history(),
            deposits=[],
            equity=5000.0,
            funding_side_effect=FundingRowsMalformed("okx funding read dropped 2 malformed row(s)"),
        )
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "permanent"  # type: ignore[attr-defined]
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["payload"]["token"] == "funding_rows_malformed"
        okx = seen["mocks"]["okx"]  # type: ignore[index]
        assert okx.await_args.kwargs.get("on_malformed") == "raise"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("venue", ["binance", "okx", "bybit"])
    async def test_every_venue_funding_call_passes_on_malformed_raise(self, venue: str) -> None:
        seen = await _ccxt_key_derive_with_real_combine(
            venue=venue, realized=_healthy_okx_history(), deposits=[], equity=5000.0,
        )
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        mock = seen["mocks"][venue]  # type: ignore[index]
        assert mock.await_args.kwargs.get("on_malformed") == "raise"

    @pytest.mark.asyncio
    async def test_another_funding_exception_is_named_and_propagates_unchanged(self) -> None:
        import ccxt

        boom = ccxt.NetworkError("funding page failed")
        seen = await _ccxt_key_derive_with_real_combine(
            venue="okx",
            realized=_healthy_okx_history(),
            deposits=[],
            equity=5000.0,
            funding_side_effect=boom,
            expect_raises=ccxt.NetworkError,
        )
        # The dispatcher's classification is exactly today's: the SAME object arrives.
        assert seen["raised"] is boom
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["payload"]["token"] == "funding_fetch_error"
        # Review WR-02: the compose is told at once, so a single-key book names the key now and
        # not after the next day's compose (the re-raised failure is permanent for some classes).
        assert _COMPOSE_ENQUEUE in seen["capture"]["rpc_calls"]  # type: ignore[index]
        assert marker["payload"]["error_class"] == "NetworkError"
        assert _writes_other_than_marker(seen["capture"]) == []  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_a_funding_failure_whose_marker_did_not_land_is_transient_not_the_permanent_reraise(
        self,
    ) -> None:
        """Review R2-06 (SFH-2 at a site the first fix did not touch). A funding exception that
        classifies PERMANENT, with the marker write failing at the same moment, was re-raised as
        permanent: the key stayed unnamed and never retried until the next day's derive. It now
        comes back as a transient failure so the retry writes the marker. RED before: the
        original exception was raised."""
        import ccxt

        from services.job_worker import classify_exception

        boom = ccxt.AuthenticationError("funding key refused")
        assert classify_exception(boom)[0] == "permanent"  # the case that matters
        seen = await _ccxt_key_derive_with_real_combine(
            venue="okx",
            realized=_healthy_okx_history(),
            deposits=[],
            equity=5000.0,
            funding_side_effect=boom,
            ctx_hook=_break_the_marker_write,
        )
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        assert "AuthenticationError" in result.error_message  # type: ignore[attr-defined]
        assert "funding key refused" not in result.error_message  # type: ignore[attr-defined]
        assert _writes_other_than_marker(seen["capture"]) == []  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_a_funding_rate_limit_is_not_marked(self) -> None:
        import ccxt

        stamp = AsyncMock()
        with patch("services.job_worker._stamp_429", new=stamp):
            seen = await _ccxt_key_derive_with_real_combine(
                venue="okx",
                realized=_healthy_okx_history(),
                deposits=[],
                equity=5000.0,
                funding_side_effect=ccxt.RateLimitExceeded("slow down"),
                expect_raises=ccxt.RateLimitExceeded,
            )
        stamp.assert_awaited_once()
        assert _read_incomplete_rows(seen["capture"]) == []  # type: ignore[arg-type]


class TestMarkerClearedOnACleanDerive:
    @pytest.mark.asyncio
    async def test_a_clean_key_mode_derive_deletes_the_marker_after_key_inputs(self) -> None:
        seen = await _ccxt_key_derive_with_real_combine(
            venue="okx", realized=_healthy_okx_history(), deposits=[], equity=5000.0,
        )
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        capture = seen["capture"]
        deletes = [
            d
            for d in capture["deletes"]  # type: ignore[index]
            if d["table"] == "allocator_equity_derived"
            and d["filters"].get("eq:kind") == "read_incomplete:key-fh"
        ]
        assert len(deletes) == 1
        assert deletes[0]["filters"]["eq:allocator_id"] == "alloc-fh"
        ops = capture["ops"]  # type: ignore[index]
        key_inputs_at = max(
            i
            for i, op in enumerate(ops)
            if op == ("upsert", "allocator_equity_derived")
            and any(
                u[0] == "allocator_equity_derived" and str(u[1].get("kind", "")).startswith("key_inputs:")
                for u in capture["upserts"]  # type: ignore[index]
            )
        )
        delete_at = max(i for i, op in enumerate(ops) if op == ("delete", "allocator_equity_derived"))
        assert delete_at > key_inputs_at

    @pytest.mark.asyncio
    async def test_a_failing_delete_warns_and_the_derive_still_returns_done(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        def _break_the_delete(ctx: MagicMock) -> None:
            original = ctx.supabase.table.side_effect

            def _table(name: str) -> MagicMock:
                tbl = original(name)
                if name == "allocator_equity_derived":
                    tbl.delete.side_effect = RuntimeError("db down")
                return tbl

            ctx.supabase.table.side_effect = _table

        with caplog.at_level("WARNING"):
            seen = await _ccxt_key_derive_with_real_combine(
                venue="okx",
                realized=_healthy_okx_history(),
                deposits=[],
                equity=5000.0,
                ctx_hook=_break_the_delete,
            )
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        assert "read incomplete marker not cleared" in caplog.text
        assert "RuntimeError" in caplog.text


# ── Phase 186 plan 10 (SC-3, D-02): the Bybit derive counts Unified-edge transfers as flows ──
# Source recorded by 186-04 (`g2-flow-final: replace`): the key's flows for Bybit are the Unified
# TRANSFER rows ONLY, never beside the on-chain reads (a deposit to FUND plus its FUND-to-UNIFIED
# move would count twice). The anchor is the Unified wallet balance, so money crossing ITS edge
# is the capital flow.


def _unified_transfer_in(days_before_now: int, amount: float = 5000.0) -> dict[str, object]:
    """The shape ``fetch_bybit_unified_flows`` returns: int-ms timestamp, upper-case currency,
    absolute amount, ``fee`` None, no ``info`` (an internal or sub-account transfer)."""
    from datetime import datetime, timezone

    day = datetime.fromisoformat(_utc_day(days_before_now)).replace(
        hour=12, tzinfo=timezone.utc
    )
    return {
        "id": f"uni-{days_before_now}",
        "type": "deposit",
        "currency": "USDT",
        "amount": amount,
        "timestamp": int(day.timestamp() * 1000),
        "fee": None,
    }


def _internally_funded_history() -> list[dict[str, object]]:
    """Days 1..5 of +100 each (k days back = 10 - k); day 3 is `_utc_day(7)`."""
    return [_daily_pnl_record(_utc_day(10 - k), 100.0) for k in range(1, 6)]


class TestBybitUnifiedTransfersAreFlows:
    """An internally funded Bybit account: P&L +100 a day, a 5,000 TRANSFER_IN on day 3, anchor
    15,500 after day 5. The oracles are written from those inputs and the combine's documented
    flow timing (`nav_twr.reconstruct_nav`: NAV_{t-1} = NAV_t - pnl_t - F_t, a flow counted at the
    END of its day), never read back through the combine."""

    @pytest.mark.asyncio
    async def test_the_transfer_reaches_the_combine_and_the_key_inputs(self) -> None:
        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit",
            realized=_internally_funded_history(),
            deposits=[],
            equity=15_500.0,
            unified=([_unified_transfer_in(7)], []),
        )
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        flows = seen["external_flows"]
        assert [(f.utc_day_iso, f.usd_signed) for f in flows] == [  # type: ignore[attr-defined,union-attr]
            (_utc_day(7), 5000.0)
        ]
        (key_inputs,) = [
            u[1]
            for u in seen["capture"]["upserts"]  # type: ignore[index]
            if u[0] == "allocator_equity_derived"
            and str(u[1].get("kind", "")).startswith("key_inputs:")
        ]
        assert key_inputs["payload"]["flows"] == [
            {"utc_day_iso": _utc_day(7), "usd_signed": 5000.0}
        ]
        unified = seen["mocks"]["unified"]  # type: ignore[index]
        unified.assert_awaited_once()
        since_ms, now_ms = unified.await_args.args[1:]
        assert isinstance(since_ms, int) and isinstance(now_ms, int) and since_ms < now_ms

    @pytest.mark.asyncio
    async def test_oracle_a_cumulative_twr_starts_from_the_unfunded_base(self) -> None:
        """NAV_5 = 15,500; NAV_4 = 15,400; NAV_3 = 15,300; NAV_2 = 15,300 - 100 - 5,000 = 10,200;
        NAV_1 = 10,100; NAV_0 = 10,000. Each day's factor is (NAV_t - F_t) / NAV_{t-1}:
        10,100/10,000 * 10,200/10,100 * 10,300/10,200 * 15,400/15,300 * 15,500/15,400, which
        telescopes to 10,300/10,000 * 15,500/15,300. With no flow the base is NAV_0 = 15,000 and
        the cumulative is 15,500/15,000 - 1: every day before the transfer is understated."""
        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit",
            realized=_internally_funded_history(),
            deposits=[],
            equity=15_500.0,
            unified=([_unified_transfer_in(7)], []),
        )
        returns = seen["returns"].dropna()  # type: ignore[attr-defined]
        assert len(returns) == 5
        expected = (10_300 / 10_000) * (15_500 / 15_300) - 1
        no_flow_value = 15_500 / 15_000 - 1
        assert abs(expected - no_flow_value) > 0.01  # the oracle can tell the two apart
        assert float((1.0 + returns).prod() - 1.0) == pytest.approx(expected, abs=1e-9)

    @pytest.mark.asyncio
    async def test_oracle_b_the_marks_show_no_pnl_spike_on_the_transfer_day(self) -> None:
        """Day marks that jump by the transfer (10,000 / 10,100 / 15,200 / 15,300 / 15,400).
        Day 3: base = 10,100, return = (15,200 - 10,100 - 5,000) / 10,100 = 100 / 10,100 < 1%.
        With the flow missing the same call reads (15,200 - 10,100) / 10,100 = about +50.5%."""
        from services.nav_marks_apply import AppliedMark, apply_marks

        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit",
            realized=_internally_funded_history(),
            deposits=[],
            equity=15_500.0,
            unified=([_unified_transfer_in(7)], []),
        )
        navs = (10_000.0, 10_100.0, 15_200.0, 15_300.0, 15_400.0)
        marks = [
            AppliedMark(day=_utc_day(10 - k), nav=nav, open_pnl=0.0)
            for k, nav in zip(range(1, 6), navs)
        ]
        flows_by_day: dict[str, float] = {}
        for f in seen["external_flows"]:  # type: ignore[attr-defined,union-attr]
            flows_by_day[f.utc_day_iso] = flows_by_day.get(f.utc_day_iso, 0.0) + f.usd_signed
        returns = seen["returns"]  # type: ignore[assignment]
        day3 = pd.Timestamp(_utc_day(7))

        with_flows = apply_marks(returns, flows_by_day, marks).returns  # type: ignore[arg-type]
        spike = apply_marks(returns, {}, marks).returns  # type: ignore[arg-type]
        assert spike.loc[day3] >= 0.4  # the spike a missing flow makes
        assert with_flows.loc[day3] <= 0.01 + 1e-9

    @pytest.mark.asyncio
    async def test_unified_rows_replace_the_on_chain_reads_and_count_once(self) -> None:
        """`g2-flow-final: replace` (186-04, no on-chain rows on PROD): an on-chain deposit
        that also reaches the key's fixtures is NOT read for Bybit. The deposit that lands in the
        Unified wallet counts exactly once, whatever the on-chain log says."""
        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit",
            realized=_internally_funded_history(),
            deposits=[_stable_deposit(7, 1234.0)],
            equity=15_500.0,
            unified=([_unified_transfer_in(7)], []),
        )
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        flows = seen["external_flows"]
        assert [(f.utc_day_iso, f.usd_signed) for f in flows] == [  # type: ignore[attr-defined,union-attr]
            (_utc_day(7), 5000.0)
        ]
        seen["mocks"]["transfers"].assert_not_awaited()  # type: ignore[index]

    @pytest.mark.asyncio
    async def test_a_unified_withdrawal_is_a_negative_flow(self) -> None:
        withdrawal = {**_unified_transfer_in(7, 300.0), "id": "uni-out", "type": "withdrawal"}
        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit",
            realized=_internally_funded_history(),
            deposits=[],
            equity=15_500.0,
            unified=([], [withdrawal]),
        )
        flows = seen["external_flows"]
        assert [(f.utc_day_iso, f.usd_signed) for f in flows] == [  # type: ignore[attr-defined,union-attr]
            (_utc_day(7), -300.0)
        ]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("venue", ["okx", "binance"])
    async def test_other_venues_keep_the_on_chain_reads_and_never_read_unified(
        self, venue: str
    ) -> None:
        seen = await _ccxt_key_derive_with_real_combine(
            venue=venue,
            realized=_healthy_okx_history(),
            deposits=[_stable_deposit(8, 1000.0)],
            equity=5000.0,
            unified=([_unified_transfer_in(7)], []),
        )
        assert seen["result"].outcome == DispatchOutcome.DONE  # type: ignore[attr-defined]
        seen["mocks"]["unified"].assert_not_awaited()  # type: ignore[index]
        assert seen["mocks"]["transfers"].await_count == 2  # type: ignore[index]
        flows = seen["external_flows"]
        assert [(f.utc_day_iso, f.usd_signed) for f in flows] == [  # type: ignore[attr-defined,union-attr]
            (_utc_day(8), 1000.0)
        ]


class TestBybitUnifiedReadFailureIsNamed:
    """A Unified read that fails is named, not silent (T-186-26): key mode records
    `read_incomplete:<key>` with token `bybit_unified_flow_error` and the CLASS NAME only, and the
    SAME exception propagates so `classify_exception` keeps `BybitUnifiedFlowReadError` permanent
    exactly as before. `g2-non-uta: none-on-prod` (186-04): no account-type read exists."""

    @pytest.mark.asyncio
    async def test_the_reader_refusal_is_marked_and_propagates_unchanged(self) -> None:
        from services.bybit_unified_flows import BybitUnifiedFlowReadError
        from services.job_worker import classify_exception

        boom = BybitUnifiedFlowReadError("Bybit Unified flow read refused: the answer is not an object")
        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit",
            realized=_internally_funded_history(),
            deposits=[],
            equity=15_500.0,
            unified_side_effect=boom,
            expect_raises=BybitUnifiedFlowReadError,
        )
        assert seen["raised"] is boom
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["kind"] == "read_incomplete:key-fh"
        assert marker["payload"]["token"] == "bybit_unified_flow_error"
        assert marker["payload"]["error_class"] == "BybitUnifiedFlowReadError"
        assert "answer is not an object" not in str(marker)  # the venue text never reaches the row
        assert _writes_other_than_marker(seen["capture"]) == []  # type: ignore[arg-type]
        kind, _detail = classify_exception(boom)
        assert kind == "permanent"

    @pytest.mark.asyncio
    async def test_another_unified_exception_is_named_and_propagates_unchanged(self) -> None:
        import ccxt

        boom = ccxt.NetworkError("transaction-log page failed")
        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit",
            realized=_internally_funded_history(),
            deposits=[],
            equity=15_500.0,
            unified_side_effect=boom,
            expect_raises=ccxt.NetworkError,
        )
        assert seen["raised"] is boom
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["payload"]["token"] == "bybit_unified_flow_error"
        assert marker["payload"]["error_class"] == "NetworkError"
        assert _writes_other_than_marker(seen["capture"]) == []  # type: ignore[arg-type]
        # Review WR-02: the book is told at once (BybitUnifiedFlowReadError is permanent and gets
        # no later derive, so without this a single-Bybit-key book never names the key).
        assert _COMPOSE_ENQUEUE in seen["capture"]["rpc_calls"]  # type: ignore[index]

    @pytest.mark.asyncio
    async def test_a_reader_refusal_whose_marker_did_not_land_is_transient_not_the_permanent_reraise(
        self,
    ) -> None:
        """Review R2-06. ``BybitUnifiedFlowReadError`` classifies permanent, so with the marker
        write failing the key was left unnamed and unretried. It now comes back transient so the
        retry writes the marker. RED before: the original exception was raised."""
        from services.bybit_unified_flows import BybitUnifiedFlowReadError
        from services.job_worker import classify_exception

        boom = BybitUnifiedFlowReadError("Bybit Unified flow read refused: the answer is not an object")
        assert classify_exception(boom)[0] == "permanent"
        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit",
            realized=_internally_funded_history(),
            deposits=[],
            equity=15_500.0,
            unified_side_effect=boom,
            ctx_hook=_break_the_marker_write,
        )
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        assert "BybitUnifiedFlowReadError" in result.error_message  # type: ignore[attr-defined]
        assert "the answer is not an object" not in result.error_message  # type: ignore[attr-defined]
        assert _writes_other_than_marker(seen["capture"]) == []  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_a_unified_rate_limit_is_not_marked(self) -> None:
        import ccxt

        stamp = AsyncMock()
        with patch("services.job_worker._stamp_429", new=stamp):
            seen = await _ccxt_key_derive_with_real_combine(
                venue="bybit",
                realized=_internally_funded_history(),
                deposits=[],
                equity=15_500.0,
                unified_side_effect=ccxt.RateLimitExceeded("slow down"),
                expect_raises=ccxt.RateLimitExceeded,
            )
        stamp.assert_awaited_once()
        assert _read_incomplete_rows(seen["capture"]) == []  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_a_unified_timeout_stays_transient_but_is_now_named_read_timeout(self) -> None:
        """Review WR-03 reverses the plan-10 choice to leave a timeout unmarked: the retry
        budget is unchanged (transient), but a key whose retries run out is no longer anonymous."""
        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit",
            realized=_internally_funded_history(),
            deposits=[],
            equity=15_500.0,
            unified_side_effect=TimeoutError("bound"),
        )
        result = seen["result"]
        assert result.outcome == DispatchOutcome.FAILED  # type: ignore[attr-defined]
        assert result.error_kind == "transient"  # type: ignore[attr-defined]
        (marker,) = _read_incomplete_rows(seen["capture"])  # type: ignore[arg-type]
        assert marker["payload"]["token"] == "read_timeout"

    def test_the_token_is_in_the_closed_set(self) -> None:
        from services.job_worker import READ_INCOMPLETE_TOKENS

        assert "bybit_unified_flow_error" in READ_INCOMPLETE_TOKENS
