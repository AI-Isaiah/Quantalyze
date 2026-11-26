"""Phase 222 ERRC-03 - the sync_trades enqueue-failure outcome, through the REAL bridge.

``run_sync_trades_job`` enqueues the follow-on analytics job at its tail. When
that enqueue fails the handler used to write a ``failed`` strategy_analytics row
and return DONE; ``mark_compute_job_done`` then ran the status bridge, which found
every job done and took branch (c): the row read ``complete`` with a NULL error and
no analytics (ROADMAP SC-3). The CONTEXT ERRC-03 ruling (option a, founder rulings
OQ2 and OQ4, 2026-11-25) is:

  * nothing published -> the handler returns FAILED / ``transient``. The row reads
    ``computing`` while retries remain (bridge branch (a)) and ``failed`` with the
    curated retries-exhausted sentence at the last attempt (branch (b)), never
    ``complete``;
  * something published -> the handler writes nothing and returns DONE, so a
    ``complete_with_warnings`` row keeps its status and its ``computation_warned``
    flag instead of being cleared by the failed write.

Why this has to be LIVE: the bridge (``sync_strategy_analytics_status``) and the mark
RPCs are plpgsql. An offline test can show the handler's return value, never what the
owner's row reads afterwards, and the row is the whole point.

What is real here: the handler (``run_sync_trades_job``), the publish read and the
five-key failed upsert (both go to the lane's strategy_analytics), the claim RPC, the
mark RPCs and the bridge. What is stubbed: the exchange fetch and the sync-persist RPC
(there is no api_keys or trades row on the lane for this user), and the enqueue RPC,
which raises. ``dispatch_tick``'s DONE / FAILED mapping is applied by hand in
``_drive`` with the real claim token, because ``dispatch_tick`` claims a global batch.

Gating mirrors ``test_computed_at_now_literal_live.py``: skip locally when the lane env
is unset, ``pytest.fail`` when it is unset and ``CI == "true"`` (a silent skip in CI
would read as green while proving nothing). The module WRITES, so it refuses any host
that is not loopback, and it writes only its own throwaway user, strategy and job rows.
``conftest.py`` groups any module naming ``SUPABASE_TEST_URL`` into ``shared_test_db``.

Phase 251 SYNCSTORE (plan 02) adds three arms, all CI-only (they skip locally):

  * ``test_reread_failure_after_a_zero_row_write_keeps_the_published_row`` (SC-5): the
    conditional failed-row write matches zero rows because a row was published after
    the first publish read, and the re-read then raises. The handler returns DONE and
    writes nothing, so the published row survives the mark RPC and the bridge.
  * ``test_a_clean_sync_removes_a_stored_refusal_key_and_keeps_the_rest`` pins
    RESEARCH assumption A1 at the real PostgREST upsert: the upsert REPLACES the jsonb
    ``data_quality_flags`` column, which is what makes plan 01's pop of a stale
    sync-owned refusal key work. The in-repo fake hard-codes that behaviour, so only
    this arm would catch it being false.
  * ``test_a_refused_first_sync_creates_a_row_carrying_only_the_refusal_key`` pins
    RESEARCH Q2: with no ``strategy_analytics`` row, a refused first sync's flag-only
    upsert creates one whose ``data_quality_flags`` is exactly the refusal key.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import urlparse

import pytest

try:
    from supabase import create_client
except ImportError:  # pragma: no cover
    create_client = None  # type: ignore[assignment]

from services import exchange as exchange_module
from services import job_worker
from services.job_worker import DispatchOutcome, DispatchResult, run_sync_trades_job
from tests.live_db_transport import wrap_live_db_client
from tests.test_compute_jobs_fencing import _claim_one, _insert_pending_sync_trades

SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

# computation_error_copy('transient') after Phase 222 plan 01, spelled LITERALLY. An
# equality against the SQL function would pass against a function that leaks its input.
_TRANSIENT_SENTENCE = (
    "Analytics could not complete after several automatic retries. "
    "Retry the sync, or use the contact form if it keeps failing."
)


def _require_loopback_lane(url: str | None) -> None:
    """``pytest.fail`` unless ``url`` names a loopback host (T-222-12).

    This module writes rows. The lane URL comes from an env var that CI also points at
    shared TEST in other jobs, so the host is checked here, in the test, rather than
    trusted from the environment.
    """
    host = urlparse(url or "").hostname
    if host not in _LOOPBACK_HOSTS:
        pytest.fail(
            "test_sync_trades_enqueue_failure_bridge_live refuses to write: "
            f"SUPABASE_TEST_URL host is {host!r}, not a loopback lane "
            f"({sorted(_LOOPBACK_HOSTS)}). Run it against the local-stack lane only "
            "(scripts/local-stack/run.sh up).",
            pytrace=False,
        )


def _need_supabase() -> None:
    if create_client is None:
        pytest.skip("supabase-py not installed in this environment")
    if not SUPABASE_URL or not SUPABASE_KEY:
        if os.getenv("CI", "").lower() == "true":
            pytest.fail(
                "222 sync_trades enqueue-failure bridge gate cannot run: "
                "SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY are unset in CI. The "
                "python job exports the local-stack lane as those two variables.",
                pytrace=False,
            )
        pytest.skip("local-stack lane not configured (local dev)")


def _lane_client():
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    session = client.postgrest.session
    # Same http2=False session rebuild as test_compute_jobs_fencing.admin (supabase-py
    # hardcodes http2=True; one multiplexed connection is a GOAWAY hazard).
    client.postgrest.session = type(session)(
        base_url=session.base_url,
        headers=session.headers,
        timeout=60.0,
        follow_redirects=True,
        http2=False,
    )
    return wrap_live_db_client(client)


def test_loopback_guard_refuses_every_non_lane_host() -> None:
    """The T-222-12 guard can fail: a remote host, an empty value and a look-alike
    hostname all trip it; the three loopback spellings pass."""
    for ok in (
        "http://127.0.0.1:54421",
        "http://localhost:54421",
        "http://[::1]:54421",
    ):
        _require_loopback_lane(ok)  # must not raise
    for bad in (
        "https://abcdefghijklmnop.supabase.co",
        "http://127.0.0.1.evil.example:54421",
        "",
        None,
    ):
        with pytest.raises(pytest.fail.Exception):
            _require_loopback_lane(bad)


class _HandlerSupabase:
    """The ctx.supabase the handler sees: strategy_analytics is the LANE's table
    (the publish read and the failed upsert are real); every other table and every
    RPC but the enqueue is an offline stub, because the lane holds no api_keys or
    trades for this user. The enqueue RPC raises: that is the fault under test."""

    def __init__(self, lane: Any) -> None:
        self._lane = lane

    def table(self, name: str) -> Any:
        if name == "strategy_analytics":
            return self._lane.table(name)
        stub = MagicMock()
        stub.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        return stub

    def rpc(self, name: str, _payload: dict[str, Any] | None = None) -> Any:
        if name == "enqueue_compute_job":
            raise RuntimeError("simulated enqueue infra failure")
        stub = MagicMock()
        stub.execute.return_value = MagicMock(data=5)
        return stub


def _drive(
    admin: Any,
    *,
    tag: str,
    seed_row: dict[str, Any] | None,
    attempts_before_claim: int | None = None,
    publish_race_row: dict[str, Any] | None = None,
    after_handler: dict[str, Any] | None = None,
    reread_raises: bool = False,
    daily_flags: dict[str, Any] | None = None,
) -> tuple[DispatchResult, dict[str, Any] | None, dict[str, Any]]:
    """Run the REAL handler and the REAL mark RPCs for one sync_trades job.

    ``attempts_before_claim`` is the job's ``attempts`` before the claim (the claim adds
    one). ``None`` means ``max_attempts - 1`` read from the row itself, so the claimed
    attempt is the LAST one and ``mark_compute_job_failed`` makes a transient failure
    final. Returns ``(DispatchResult, strategy_analytics row or None, compute_jobs row)``.

    ``publish_race_row`` (222-REVIEW SFH-01) simulates the race between the handler's
    publish read and its failed write: right after the handler's publish read returns,
    this row is written to strategy_analytics through the lane, so the handler decides
    from a read that is already stale. ``after_handler``, when given, receives the
    strategy_analytics row as the handler left it (``after_handler["row"]``), before
    the mark RPC and the bridge run; it also carries ``data_quality_flags``.

    ``reread_raises`` (251 SC-5) makes the SECOND ``_strategy_has_published_numbers``
    read raise ``RuntimeError("simulated re-read failure")``: the re-read the handler
    makes after its conditional failed-row write matched zero rows. ``daily_flags``
    (251) makes the stubbed daily read plant each ``key: value`` through the real
    ``services.exchange._record_dq_flag``, so the handler's own drain sees a refused
    (or otherwise flagged) read; ``None`` keeps a clean read.
    """
    user_id: str | None = None
    strategy_id: str | None = None
    try:
        created = admin.auth.admin.create_user(
            {
                "email": f"p222-{tag}-{uuid.uuid4().hex[:8]}@quantalyze.test",
                "password": uuid.uuid4().hex,
                "email_confirm": True,
            }
        )
        user_id = created.user.id
        strategy_id = (
            admin.table("strategies")
            .insert({"user_id": user_id, "name": f"p222-{tag}-{uuid.uuid4().hex[:6]}"})
            .execute()
            .data[0]["id"]
        )
        if seed_row is not None:
            admin.table("strategy_analytics").upsert(
                {"strategy_id": strategy_id, **seed_row}, on_conflict="strategy_id"
            ).execute()

        job_id = _insert_pending_sync_trades(admin, strategy_id)
        max_attempts = (
            admin.table("compute_jobs").select("max_attempts").eq("id", job_id)
            .single().execute().data["max_attempts"]
        )
        before = max_attempts - 1 if attempts_before_claim is None else attempts_before_claim
        admin.table("compute_jobs").update({"attempts": before}).eq("id", job_id).execute()
        claimed = _claim_one(admin, f"p222-{tag}", want_job_id=job_id, kind="sync_trades")
        assert claimed is not None, "the claim RPC did not return this test's own job"
        assert claimed["attempts"] == before + 1

        ctx = MagicMock()
        ctx.exchange = AsyncMock()
        ctx.supabase = _HandlerSupabase(admin)
        ctx.strategy_row = {"id": strategy_id, "user_id": user_id}
        ctx.key_row = {
            "id": str(uuid.uuid4()),
            "exchange": "okx",
            "last_sync_at": None,
            "user_id": user_id,
        }
        job = dict(claimed)

        real_read = job_worker.db_read_with_retry
        publish_reads = [0]

        async def _racing_read(fn: Any, *args: Any, **kwargs: Any) -> Any:
            is_publish_read = fn.__name__ == "_strategy_has_published_numbers"
            if is_publish_read:
                publish_reads[0] += 1
                if reread_raises and publish_reads[0] == 2:
                    raise RuntimeError("simulated re-read failure")
            out = await real_read(fn, *args, **kwargs)
            if publish_race_row is not None and is_publish_read:
                admin.table("strategy_analytics").upsert(
                    {"strategy_id": strategy_id, **publish_race_row},
                    on_conflict="strategy_id",
                ).execute()
            return out

        if daily_flags is None:
            daily_read: Any = AsyncMock(return_value=[{"test": "trade"}])
        else:

            async def daily_read(_exchange: Any, since_ms: Any = None) -> Any:
                # The real buffer, so the handler's own drain sees what production's does.
                for key, value in daily_flags.items():
                    exchange_module._record_dq_flag(key, value)
                return [{"test": "trade"}]

        with patch(
            "services.job_worker.db_read_with_retry", new=_racing_read
        ), patch(
            "services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)
        ), patch(
            "services.job_worker.fetch_all_trades", new=daily_read
        ), patch(
            "services.job_worker.fetch_usdt_balance",
            new=AsyncMock(return_value=10000.0),
        ), patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ), patch("services.job_worker._RAW_TRADE_INGESTION_ENABLED", False):
            result = asyncio.run(run_sync_trades_job(job))

        if after_handler is not None:
            after_handler["row"] = (
                admin.table("strategy_analytics")
                .select(
                    "computation_status, computation_warned, computation_error, "
                    "metrics_json, data_quality_flags"
                )
                .eq("strategy_id", strategy_id)
                .single()
                .execute()
                .data
            )

        # main_worker.dispatch_tick's mapping, with the real claim token.
        if result.outcome == DispatchOutcome.DONE:
            admin.rpc(
                "mark_compute_job_done",
                {"p_job_id": job_id, "p_claim_token": claimed["claim_token"]},
            ).execute()
        else:
            assert result.outcome == DispatchOutcome.FAILED, result
            admin.rpc(
                "mark_compute_job_failed",
                {
                    "p_job_id": job_id,
                    "p_error": result.error_message or "Unknown error",
                    "p_error_kind": result.error_kind or "unknown",
                    "p_claim_token": claimed["claim_token"],
                },
            ).execute()

        rows = (
            admin.table("strategy_analytics")
            .select("computation_status, computation_error, computation_warned, metrics_json")
            .eq("strategy_id", strategy_id)
            .execute()
            .data
        )
        job_row = (
            admin.table("compute_jobs").select("status, error_kind, attempts")
            .eq("id", job_id).single().execute().data
        )
        return result, (rows[0] if rows else None), job_row
    finally:
        # The strategy cascades to its compute_jobs, attempt-failure records and
        # strategy_analytics row.
        if strategy_id is not None:
            try:
                admin.table("strategies").delete().eq("id", strategy_id).execute()
            except Exception:  # pragma: no cover - cleanup of our own rows only
                pass
        if user_id is not None:
            try:
                admin.auth.admin.delete_user(user_id)
            except Exception:  # pragma: no cover
                pass


def test_nothing_published_ends_failed_with_the_retries_exhausted_sentence() -> None:
    """ROADMAP SC-3: no strategy_analytics row, enqueue fails on the LAST attempt ->
    the handler returns FAILED / transient, the job is ``failed_final`` and the row
    reads ``failed`` with the stored transient sentence. Pre-fix the handler returned
    DONE and the bridge's branch (c) left ``complete`` with a NULL error."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    result, row, job = _drive(admin, tag="nopub-last", seed_row=None)

    # The STORED truth first: it is what the owner reads, and it is the assertion that
    # names SC-3 (pre-fix: `complete` with a NULL error).
    assert row is not None, "the bridge/handler left no strategy_analytics row at all"
    assert row["computation_status"] == "failed", row
    assert row["computation_error"] == _TRANSIENT_SENTENCE, row
    assert job["status"] == "failed_final", job
    assert job["error_kind"] == "transient", job
    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "transient", result


_METRICS = {"sharpe": 1.25, "marker": "p222-published-figures"}


def test_published_complete_with_warnings_keeps_status_and_warned_flag() -> None:
    """OQ4 / T-222-10: the failed write that clears ``computation_warned`` is skipped for a
    published strategy, so after the DONE mark the bridge's branch (c) still reads
    ``complete_with_warnings`` and the warned flag survives, figures untouched."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    result, row, _job = _drive(
        admin,
        tag="pub-cww",
        seed_row={
            "computation_status": "complete_with_warnings",
            "computation_warned": True,
            "metrics_json": _METRICS,
        },
    )

    assert row is not None
    assert row["computation_status"] == "complete_with_warnings", row
    assert row["computation_warned"] is True, row
    assert row["computation_error"] is None, row
    assert row["metrics_json"] == _METRICS, row
    assert result.outcome == DispatchOutcome.DONE, result


def test_published_complete_stays_complete() -> None:
    """T-222-09: a plain published ``complete`` row is not unpublished by a failed
    enqueue, and its figures are unchanged."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    result, row, _job = _drive(
        admin,
        tag="pub-complete",
        seed_row={"computation_status": "complete", "metrics_json": _METRICS},
    )

    assert row is not None
    assert row["computation_status"] == "complete", row
    assert row["computation_error"] is None, row
    assert row["metrics_json"] == _METRICS, row
    assert result.outcome == DispatchOutcome.DONE, result


def test_computing_with_figures_keeps_them_and_resolves_to_complete() -> None:
    """OQ4: a ``computing`` row that already carries ``metrics_json`` counts as published.
    The handler returns DONE with no write, and the bridge resolves the row to
    ``complete`` with the figures untouched and no error."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    result, row, _job = _drive(
        admin,
        tag="pub-computing",
        seed_row={"computation_status": "computing", "metrics_json": _METRICS},
    )

    assert row is not None
    assert row["computation_status"] == "complete", row
    assert row["computation_error"] is None, row
    assert row["metrics_json"] == _METRICS, row
    assert result.outcome == DispatchOutcome.DONE, result


def test_nothing_published_on_a_first_attempt_retries_and_reads_computing() -> None:
    """OQ2: with retries remaining the job reads ``failed_retry`` and the row reads
    ``computing`` (bridge branch (a)), never ``complete`` and not yet ``failed``."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    result, row, job = _drive(
        admin, tag="nopub-first", seed_row=None, attempts_before_claim=0
    )

    assert row is not None
    assert row["computation_status"] == "computing", row
    assert job["status"] == "failed_retry", job
    assert job["error_kind"] == "transient", job
    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "transient", result


def test_a_failed_row_with_old_figures_is_not_published_and_ends_failed() -> None:
    """222-REVIEW WR-01: a strategy that was published and whose LATER recompute failed
    reads ``failed`` with its old ``metrics_json`` still in place (the bridge's branch (b)
    only touches the status and error columns). That is NOT published, so on the last
    attempt the handler returns FAILED / transient and the row ends ``failed`` with the
    stored transient sentence. A publish predicate collapsed to "has metrics_json" would
    return DONE, the bridge's branch (c) would resurrect the row to ``complete`` with
    stale figures and a NULL error, and this is the assertion that fails."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    result, row, job = _drive(
        admin,
        tag="failed-figures",
        seed_row={"computation_status": "failed", "metrics_json": _METRICS},
    )

    assert row is not None
    assert row["computation_status"] == "failed", row
    assert row["computation_error"] == _TRANSIENT_SENTENCE, row
    assert row["metrics_json"] == _METRICS, row
    assert job["status"] == "failed_final", job
    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "transient", result


def test_a_row_published_between_the_read_and_the_write_is_not_overwritten() -> None:
    """222-REVIEW SFH-01 / R2-WR-01: the publish read and the failed write are separate
    round trips. Here nothing is published at the read (no row) and a
    ``complete_with_warnings`` row lands before the write. The failed write is
    conditional on nothing being published, so the row the handler leaves is the
    published one, warned flag and figures intact (an unconditional upsert would
    overwrite it with ``failed`` and ``computation_warned = false``).

    It runs as the LAST attempt and asserts the row AFTER the mark RPC and the bridge:
    the skipped write alone is not enough, because a handler that still returned FAILED
    sends ``failed_final`` to the bridge's branch (b), which writes ``failed`` over the
    row published in between. The handler must re-read, see the row, and return DONE
    so the bridge takes branch (c)."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    left: dict[str, Any] = {}
    result, row, job = _drive(
        admin,
        tag="race",
        seed_row=None,
        publish_race_row={
            "computation_status": "complete_with_warnings",
            "computation_warned": True,
            "metrics_json": _METRICS,
        },
        after_handler=left,
    )

    # The handler's own write left the published row alone.
    assert left["row"]["computation_status"] == "complete_with_warnings", left["row"]
    assert left["row"]["computation_warned"] is True, left["row"]
    # And so did the mark RPC and the bridge, which is what the owner reads.
    assert row is not None
    assert row["computation_status"] == "complete_with_warnings", row
    assert row["computation_warned"] is True, row
    assert row["computation_error"] is None, row
    assert row["metrics_json"] == _METRICS, row
    assert result.outcome == DispatchOutcome.DONE, result
    assert job["status"] == "done", job


def test_reread_failure_after_a_zero_row_write_keeps_the_published_row() -> None:
    """251 SC-5 / T-251-09: nothing is published at the first read (no row), a
    ``complete_with_warnings`` row lands before the failed write, so the conditional
    write matches zero rows, and the re-read then RAISES. The handler returns DONE and
    writes nothing: an unreadable state is not "nothing published" (T-222-13).

    It runs as the LAST attempt on purpose. Before the fix the re-read's raise was
    swallowed by a shared ``try`` and the handler returned FAILED; the last attempt
    made that ``failed_final``, and bridge branch (b) wrote ``failed`` over the
    published row. The row is therefore asserted AFTER the mark RPC and the bridge."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    left: dict[str, Any] = {}
    result, row, job = _drive(
        admin,
        tag="reread-raises",
        seed_row=None,
        publish_race_row={
            "computation_status": "complete_with_warnings",
            "computation_warned": True,
            "metrics_json": _METRICS,
        },
        reread_raises=True,
        after_handler=left,
    )

    assert result.outcome == DispatchOutcome.DONE, result
    assert job["status"] == "done", job
    assert left["row"]["computation_status"] == "complete_with_warnings", left["row"]
    assert row is not None
    assert row["computation_status"] == "complete_with_warnings", row
    assert row["computation_warned"] is True, row
    assert row["computation_error"] is None, row
    assert row["metrics_json"] == _METRICS, row


def test_a_clean_sync_removes_a_stored_refusal_key_and_keeps_the_rest() -> None:
    """251 RESEARCH assumption A1, the load-bearing fact behind plan 01's pop: the real
    PostgREST upsert REPLACES the jsonb ``data_quality_flags`` column, so omitting a
    stale sync-owned refusal key from the payload removes it. The mocked fake hard-codes
    that, so nothing else would catch it being false (a deep merge would leave the
    owned keys on the row forever).

    The stored flags hold two sync-owned refusal keys (``daily_pnl_non_usd_okx`` and
    ``daily_pnl_fetch_error_class``) plus ``daily_pnl_malformed_okx`` (the derive's,
    never popped) and an unrelated key. A clean read leaves exactly the last two. The seeded row reads ``pending``, which is "nothing published", so the
    tail's conditional write applies and the outcome is FAILED. The flags are read
    BEFORE the mark RPC, so the bridge cannot affect them."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    left: dict[str, Any] = {}
    result, _row, _job = _drive(
        admin,
        tag="a1-pop",
        seed_row={
            "data_quality_flags": {
                "daily_pnl_non_usd_okx": True,
                "daily_pnl_fetch_error_class": "NetworkError",
                "daily_pnl_malformed_okx": True,
                "p251_unrelated_marker": "kept",
            }
        },
        after_handler=left,
    )

    assert left["row"]["data_quality_flags"] == {
        "daily_pnl_malformed_okx": True,
        "p251_unrelated_marker": "kept",
    }, left["row"]
    assert result.outcome == DispatchOutcome.FAILED, result


def test_a_refused_first_sync_creates_a_row_carrying_only_the_refusal_key() -> None:
    """251 RESEARCH Q2: a refused first sync has no ``strategy_analytics`` row, and the
    handler's flag-only upsert creates one whose ``data_quality_flags`` is exactly the
    refusal key. The row it creates reads ``pending``, so the tail's conditional write
    (the enqueue is failing here) matches it and the row reads ``failed``."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    left: dict[str, Any] = {}
    result, _row, _job = _drive(
        admin,
        tag="q2-first",
        seed_row=None,
        daily_flags={"daily_pnl_non_usd_okx": True},
        after_handler=left,
    )

    assert left["row"]["data_quality_flags"] == {"daily_pnl_non_usd_okx": True}, left["row"]
    assert left["row"]["computation_status"] == "failed", left["row"]
    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "transient", result
