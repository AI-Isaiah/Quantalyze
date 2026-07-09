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

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import numpy as np
import pandas as pd
import pytest

from services.broker_dailies import combine_realized_and_funding
from services.deribit_txn import deribit_dated_external_flows_usd
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from services.nav_twr import NavReconstructionError
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
    capture: dict = {"upserts": [], "rpc_calls": [], "deletes": [], "ops": []}

    ctx = MagicMock()
    ctx.exchange = AsyncMock()
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
            new=MagicMock(return_value=(returns, {"used_heuristic_capital": False})),
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
        # strategy-keyed and would read strategy_id NULL → garbage).
        enqueues = [
            c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"
        ]
        assert enqueues == [], (
            f"key-mode must NOT enqueue compute_analytics_from_csv; got {enqueues!r}"
        )
        # NO strategy_analytics stamp (there is no per-key analytics row).
        sa_upserts = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
        assert sa_upserts == [], (
            f"key-mode must NOT stamp strategy_analytics; got {sa_upserts!r}"
        )

    @pytest.mark.asyncio
    async def test_key_mode_insufficient_history_no_strategy_analytics(self) -> None:
        """<2-day key-mode: no strategy_analytics write, returns DONE (there is
        no per-key analytics row to stamp)."""
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
        assert capture["upserts"] == [], (
            "key-mode <2-day must NOT write csv_daily_returns OR strategy_analytics; "
            f"got {capture['upserts']!r}"
        )
        assert capture["rpc_calls"] == []


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

        assert result.outcome == DispatchOutcome.DONE
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
        assert capture["upserts"] == [], (
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
                {"used_heuristic_capital": False, "negative_nav_guard": True},
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
                {"used_heuristic_capital": False, "negative_nav_guard": True},
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


class TestLtp068AcceptanceDominatingWithdrawal:
    """FLOW-02 acceptance (75-CONTEXT.md SC4, reconciled) — the DOMINATING case.
    LTP068's motivating event was a ~$2.5M withdrawal that DWARFED prior-day
    capital. When the valued ``|F| >= NAV_{t-1}`` (FLOW_DOM_RATIO=1.0) the
    chain-link is not interpretable, so ``reconstruct_nav_and_twr`` breaks the
    day (``r_t = NaN``) and raises ``flow_dominated_guard`` +
    ``complete_with_warnings`` — the CORRECT honest behavior. It never fabricates
    a +/-100% day and never collapses to ``r_t == 0``.

    Boundary distinction (the subtle SC4 point, 75-RESEARCH.md Pitfall 5 +
    Open Q2): the SAME machinery yields ``r_t == 0`` for a sub-NAV pure flow
    (``TestLtp068AcceptanceSubNavPureFlow``) and the guard for a dominating flow
    (here). BOTH reconciled outcomes are pinned so a future change cannot collapse
    them into one another.

    Mutation-honest: removing the guard would divide the dominating flow through
    a base it dwarfs and surface a fabricated magnitude instead of NaN -> the
    ``np.isnan`` assertion reddens."""

    def test_ltp068_dominating_withdrawal_trips_flow_dominated_guard(self) -> None:
        # The scenario-4 fixture: a -2.0 BTC withdrawal valued via its OWN
        # same-day settlement index (BTC_INDEX_2026_03_16) -> -90000 USD on
        # 2026-03-16. The guard is about MAGNITUDE, not a valuation failure, so
        # the flow is fully valued.
        flows = deribit_dated_external_flows_usd(dominating_withdrawal_rows())
        assert len(flows) == 1
        (flow,) = flows
        assert flow.utc_day_iso == DAY_DOMINATING
        assert flow.usd_signed == pytest.approx(-2.0 * BTC_INDEX_2026_03_16)  # -90000
        assert flow.usd_signed < 0.0

        # Realized pnl [+800 (03-15), +15000 (03-16)] with anchor 5000
        # reconstructs NAV_{03-15}=80000; the -90000 withdrawal on 03-16 has
        # |F|=90000 >= 80000 -> flow_dominated_guard. (The big same-day gain is
        # inherent to a dominating withdrawal: to withdraw MORE than prior-day
        # capital the day's intraday gains must have funded it — LTP068's LP
        # withdrew nearly the whole account after an up day.)
        realized = [
            _daily_pnl_record("2026-03-15", 800.0),  # a normal, non-guarded day
            _daily_pnl_record(DAY_DOMINATING, 15000.0),
        ]
        returns, meta = combine_realized_and_funding(
            realized, [], account_balance=5_000.0, external_flows=flows
        )

        # The dominating day is NaN (a break) — NOT r_t==0, NOT a fabricated
        # +/-100% magnitude. Removing the guard would compute a number here.
        assert np.isnan(returns.loc[DAY_DOMINATING])
        # The guard fired and it is a WARNING (honest, surfaced), not an error /
        # permanent fail — the day is flagged, never fabricated.
        assert meta.get("flow_dominated_guard") is True
        assert meta["computation_status_hint"] == "complete_with_warnings"
        # Boundary distinction: ONLY the flow-dominated guard fired here (the
        # sub-NAV case fires NO guard) — the two SC4 outcomes stay distinct.
        assert "negative_nav_guard" not in meta
        assert "dust_nav_guard" not in meta
        # The normal prior day is a healthy, non-guarded finite return.
        assert np.isfinite(returns.loc["2026-03-15"])
        assert returns.loc["2026-03-15"] != 0.0


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

    The fix reconciles the axis: DELETE the strategy's csv_daily_returns rows
    inside the derive's authoritative span [returns.index.min, returns.index.max]
    (bounded gte/lte on `date`, scoped by strategy_id/api_key_id), then re-insert
    the fresh payload. A refused interior/leading day becomes honestly ABSENT.

    SPAN bound (never delete legitimate out-of-scope history): the delete is a
    RANGED gte/lte on the dense reconstructed calendar — a row OLDER than
    returns.index.min() (written by an earlier, wider-window retention derive)
    is strictly < span_start and CANNOT be reached. For a full_history Deribit
    derive [min,max] IS the whole series; for a retention-windowed ccxt derive it
    is only the reconstructed window.

    Neuter: keep the upsert-only persist (drop the span DELETE) -> capture
    ["deletes"] has no csv_daily_returns entry -> every assertion here reddens.
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
                {"used_heuristic_capital": False, "negative_nav_guard": True},
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
        # away (deleted, then NOT re-inserted since the payload omits it).
        assert span_start <= "2024-05-02" <= span_end

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

        # Authoritative order: the span DELETE precedes the re-insert upsert so a
        # crash can only leave the span EMPTY (self-healing on retry), never a
        # half-stale mix.
        ops = [o for o in capture["ops"] if o[1] == "csv_daily_returns"]
        assert ops[0][0] == "delete", (
            f"span delete must precede the re-insert upsert; got {ops!r}"
        )

    @pytest.mark.asyncio
    async def test_strategy_mode_clean_series_deletes_and_reinserts_all(self) -> None:
        """A day the fresh derive LEGITIMATELY still has is NOT lost: the span
        delete + re-insert nets to the full clean payload present (no refused
        days -> nothing dropped)."""
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
        assert len(csv_deletes) == 1
        filters = csv_deletes[0]["filters"]
        assert filters.get("gte:date") == "2024-05-01"
        assert filters.get("lte:date") == "2024-05-02"
        # Both clean days are re-inserted -> retained history is preserved.
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
                {"used_heuristic_capital": False, "negative_nav_guard": True},
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
