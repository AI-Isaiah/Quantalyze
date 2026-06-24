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

import pandas as pd
import pytest

from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job


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
    capture: dict = {"upserts": [], "rpc_calls": []}

    ctx = MagicMock()
    ctx.exchange = AsyncMock()
    ctx.supabase = MagicMock()
    ctx.strategy_row = strategy_row
    ctx.key_row = key_row

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
