"""
audit-2026-05-07 P97 / G12.A.2 — compute_jobs claim-token fencing.

Migration 117 adds `claim_token UUID` to compute_jobs and threads it through
the claim → mark_done / mark_failed lifecycle so a watchdog reclaim that
hands the row off to a new worker rejects the original worker's late mark
RPC with PostgreSQL `serialization_failure` (SQLSTATE 40001).

This file holds two tracks:

  1. **Live-DB integration tests** (preferred — scaffolded against
     SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY, the same env vars used
     by tests/test_drain_semantics.py and tests/test_compute_similarity_sql.py).
     These exercise the real RPCs and the real fence behavior. Auto-skip
     when the test Supabase project is not configured locally.

  2. **Mocked-client unit tests** (always-on regression for the
     dispatch_tick wiring). These verify that:
       (a) main_worker.dispatch_tick reads `claim_token` from the claimed
           job and forwards it as `p_claim_token` to mark_done/mark_failed;
       (b) on a raised PostgREST APIError(code='40001'), dispatch_tick logs
           LATE_MARK_IGNORED and does NOT propagate as a failure.

The live-DB track is the regression that proves the fence WORKS. The
mocked track is the always-on guard that the worker actually plumbs the
token through. INVEST-P97 §"File:line targets" item 5.

Verification of "test fails without the migration":
  * The live-DB tests run `mark_compute_job_done(job_id, p_claim_token=<old>)`
    after a watchdog re-claim. PRE-mig 117, mark_compute_job_done has only
    `p_job_id` so the call would either fail at the PostgREST layer (unknown
    parameter) or — if mig 117's mark RPC isn't loaded — silently mark the
    job done. Both are observable: the live test asserts SerializationError.
  * The mocked tests assert dispatch_tick PASSES `p_claim_token` in the RPC
    params dict and CATCHES a code='40001' APIError without re-raising.
    Pre-fix dispatch_tick didn't carry the token at all and would re-raise
    any APIError as a runtime failure.
"""
from __future__ import annotations

import os
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ----------------------------------------------------------------------------
# Mocked-client unit tests (always-on regression for dispatch_tick wiring)
# ----------------------------------------------------------------------------

from main_worker import _is_serialization_failure, dispatch_tick
from services.job_worker import DispatchOutcome, DispatchResult


try:
    from postgrest.exceptions import APIError
except ImportError:  # pragma: no cover — only when postgrest isn't on path
    class APIError(Exception):  # type: ignore[no-redef]
        def __init__(self, error: dict) -> None:
            super().__init__(error.get("message", ""))
            self.code = error.get("code")
            self.message = error.get("message")
            self.details = error.get("details")
            self.hint = error.get("hint")


class TestSerializationFailureDetector:
    """_is_serialization_failure must classify both:
      (a) PostgREST APIError with .code == '40001', and
      (b) bare exceptions whose str contains the SQLSTATE / our message
          (defense for transports that don't surface .code cleanly).
    """

    def test_apierror_with_code_40001_detected(self) -> None:
        exc = APIError({"code": "40001", "message": "preempted"})
        assert _is_serialization_failure(exc) is True

    def test_apierror_with_other_code_not_detected(self) -> None:
        exc = APIError({"code": "23505", "message": "unique violation"})
        assert _is_serialization_failure(exc) is False

    def test_bare_exception_with_40001_in_message_detected(self) -> None:
        exc = RuntimeError("PostgrestException: 40001 preempted by watchdog reclaim")
        assert _is_serialization_failure(exc) is True

    def test_bare_exception_with_message_text_detected(self) -> None:
        exc = RuntimeError("preempted by watchdog reclaim")
        assert _is_serialization_failure(exc) is True

    def test_unrelated_exception_not_detected(self) -> None:
        exc = RuntimeError("some other error")
        assert _is_serialization_failure(exc) is False


class TestDispatchTickThreadsClaimToken:
    """dispatch_tick MUST read claim_token from each claimed job and
    forward it to mark_compute_job_done / mark_compute_job_failed as
    `p_claim_token`. Without the token, the migration 117 fence is
    bypassed and Race A (audit P97 / G12.A.2) reopens.
    """

    @pytest.mark.asyncio
    async def test_mark_done_forwards_claim_token(self) -> None:
        """3 jobs, each with a distinct claim_token, all return DONE.
        mark_compute_job_done is called 3 times; each call carries the
        matching token in the params dict."""
        tokens = [str(uuid.uuid4()) for _ in range(3)]
        jobs = [
            {
                "id": f"job-{i}",
                "kind": "sync_trades",
                "strategy_id": f"s-{i}",
                "claim_token": tokens[i],
                "claimed_at": "2026-05-12T00:00:00Z",
            }
            for i in range(3)
        ]
        mock_supabase = MagicMock()

        def _rpc_side_effect(name: str, params: dict):
            chain = MagicMock()
            if name == "claim_compute_jobs_with_priority":
                chain.execute.return_value = MagicMock(data=jobs)
            else:
                chain.execute.return_value = MagicMock(data=None)
            return chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch(
                 "main_worker.dispatch",
                 new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
             ):
            await dispatch_tick("worker-fence-1")

        done_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "mark_compute_job_done"
        ]
        assert len(done_calls) == 3, (
            f"expected 3 mark_done calls, got {len(done_calls)}"
        )
        # Each call must thread its job's claim_token, not someone else's
        # and not None. Order is preserved (jobs iterated in claim order).
        for i, call in enumerate(done_calls):
            params = call.args[1]
            assert params["p_job_id"] == f"job-{i}"
            assert params["p_claim_token"] == tokens[i], (
                f"job {i}: expected p_claim_token={tokens[i]!r}, got "
                f"{params.get('p_claim_token')!r} — fence is bypassed"
            )

    @pytest.mark.asyncio
    async def test_mark_failed_forwards_claim_token(self) -> None:
        """A FAILED outcome routes through mark_compute_job_failed and the
        token must be forwarded the same way."""
        tok = str(uuid.uuid4())
        jobs = [
            {
                "id": "job-fail",
                "kind": "sync_trades",
                "strategy_id": "s-fail",
                "claim_token": tok,
            }
        ]
        mock_supabase = MagicMock()

        def _rpc_side_effect(name: str, params: dict):
            chain = MagicMock()
            if name == "claim_compute_jobs_with_priority":
                chain.execute.return_value = MagicMock(data=jobs)
            else:
                chain.execute.return_value = MagicMock(data=None)
            return chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        result = DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="exchange said no",
            error_kind="transient",
        )
        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock(return_value=result)):
            await dispatch_tick("worker-fence-fail")

        fail_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "mark_compute_job_failed"
        ]
        assert len(fail_calls) == 1
        params = fail_calls[0].args[1]
        assert params["p_job_id"] == "job-fail"
        assert params["p_claim_token"] == tok

    @pytest.mark.asyncio
    async def test_late_mark_done_serialization_failure_swallowed(self) -> None:
        """When mark_compute_job_done raises APIError(code='40001'), the
        exception is logged as LATE_MARK_IGNORED and dispatch_tick
        returns cleanly. No retry, no re-raise — another worker is
        legitimately handling the row."""
        tok = str(uuid.uuid4())
        jobs = [
            {
                "id": "job-preempted",
                "kind": "sync_trades",
                "strategy_id": "s-pre",
                "claim_token": tok,
            }
        ]
        mock_supabase = MagicMock()

        def _rpc_side_effect(name: str, params: dict):
            chain = MagicMock()
            if name == "claim_compute_jobs_with_priority":
                chain.execute.return_value = MagicMock(data=jobs)
            elif name == "mark_compute_job_done":
                chain.execute.side_effect = APIError({
                    "code": "40001",
                    "message": "preempted by watchdog reclaim",
                })
            else:
                chain.execute.return_value = MagicMock(data=None)
            return chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch(
                 "main_worker.dispatch",
                 new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
             ):
            # Must NOT raise. Must NOT re-attempt mark_failed as a fallback —
            # that would treat a preemption as a failure and burn the row's
            # retry budget on the new worker's run.
            await dispatch_tick("worker-preempted")

        # Exactly one mark_done attempt; no fallback mark_failed.
        rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert rpc_names.count("mark_compute_job_done") == 1
        assert rpc_names.count("mark_compute_job_failed") == 0

    @pytest.mark.asyncio
    async def test_late_mark_failed_serialization_failure_swallowed(self) -> None:
        """Same contract as DONE → APIError 40001 swallowed, no re-raise."""
        tok = str(uuid.uuid4())
        jobs = [
            {
                "id": "job-fail-preempted",
                "kind": "sync_trades",
                "strategy_id": "s-fp",
                "claim_token": tok,
            }
        ]
        mock_supabase = MagicMock()

        def _rpc_side_effect(name: str, params: dict):
            chain = MagicMock()
            if name == "claim_compute_jobs_with_priority":
                chain.execute.return_value = MagicMock(data=jobs)
            elif name == "mark_compute_job_failed":
                chain.execute.side_effect = APIError({
                    "code": "40001",
                    "message": "preempted by watchdog reclaim",
                })
            else:
                chain.execute.return_value = MagicMock(data=None)
            return chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        result = DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="x",
            error_kind="transient",
        )
        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock(return_value=result)):
            await dispatch_tick("worker-fp")

        # Exactly one mark_failed attempt — the swallowed 40001 must NOT
        # cascade into the fallback mark_failed branch (which would also
        # 40001 and obscure the LATE_MARK_IGNORED log line).
        rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert rpc_names.count("mark_compute_job_failed") == 1


# ----------------------------------------------------------------------------
# Live-DB integration tests (skip when test Supabase isn't configured)
# ----------------------------------------------------------------------------

try:
    from supabase import create_client
except ImportError:  # pragma: no cover
    create_client = None  # type: ignore[assignment]


SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")


def _need_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY or create_client is None:
        pytest.skip("test Supabase project not configured")


@pytest.fixture
def admin():
    _need_supabase()
    return create_client(SUPABASE_URL, SUPABASE_KEY)


@pytest.fixture
def strategy_id(admin):
    user_id = str(uuid.uuid4())
    res = admin.table("strategies").insert({
        "user_id": user_id,
        "name": f"p97-fence-test-{uuid.uuid4().hex[:8]}",
        "status": "pending_review",
        "source": "okx",
        "strategy_types": [],
        "subtypes": [],
        "markets": [],
        "supported_exchanges": [],
    }).execute()
    sid = res.data[0]["id"]
    yield sid
    try:
        admin.table("strategies").delete().eq("id", sid).execute()
    except Exception:
        pass


def _claim_one(admin, worker_id: str) -> dict[str, Any] | None:
    """Call claim_compute_jobs_with_priority and return the first row, or
    None if nothing was claimed."""
    res = admin.rpc("claim_compute_jobs_with_priority", {
        "p_batch_size": 50,
        "p_worker_id": worker_id,
        "p_unified_backbone_active": False,
    }).execute()
    return res.data[0] if res.data else None


def test_claim_stamps_claim_token(admin, strategy_id):
    """A fresh claim writes a non-NULL UUID into compute_jobs.claim_token."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        claimed = _claim_one(admin, "p97-claim-test")
        assert claimed is not None and claimed["id"] == job_id
        assert claimed.get("claim_token") is not None, (
            "claim RPC must populate claim_token on every claim"
        )
        # Round-trip verification — the row in the DB matches the returned
        # row, so subsequent mark calls can use the value safely.
        row = admin.table("compute_jobs").select("claim_token").eq("id", job_id).single().execute().data
        assert row["claim_token"] == claimed["claim_token"]
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


def test_reclaim_invalidates_claim_token(admin, strategy_id):
    """reset_stalled_compute_jobs (watchdog) must NULL the claim_token on
    reclaim — defense in depth before the next worker stamps a new one."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        claimed = _claim_one(admin, "p97-w1")
        assert claimed is not None
        token1 = claimed["claim_token"]
        assert token1 is not None

        # Backdate claimed_at past every plausible threshold (1 hour) so
        # reset_stalled_compute_jobs DEFINITELY reclaims this row regardless
        # of per-kind override drift.
        admin.table("compute_jobs").update({
            "claimed_at": "2020-01-01T00:00:00Z",
        }).eq("id", job_id).execute()

        # Watchdog kick — use 1-second threshold so the backdated row reclaims.
        admin.rpc("reset_stalled_compute_jobs", {
            "p_stale_threshold": "1 second",
        }).execute()

        row = admin.table("compute_jobs").select("status,claim_token").eq("id", job_id).single().execute().data
        assert row["status"] == "pending"
        assert row["claim_token"] is None, (
            "reset_stalled_compute_jobs must NULL claim_token on reclaim "
            "(P97 fence defense in depth)"
        )
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


def test_late_mark_done_with_stale_token_raises_serialization_failure(admin, strategy_id):
    """The headline P97 / G12.A.2 regression. Sequence:
      W1 claims → token1
      Watchdog reclaims → token NULLed
      W2 claims → token2 (≠ token1)
      W1 calls mark_compute_job_done(job_id, p_claim_token=token1)
        → MUST raise SQLSTATE 40001 (serialization_failure)
      W2 calls mark_compute_job_done(job_id, p_claim_token=token2)
        → succeeds, row → done.
    """
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        # W1 claim
        w1 = _claim_one(admin, "p97-w1")
        assert w1 is not None and w1["id"] == job_id
        token1 = w1["claim_token"]
        assert token1 is not None

        # Backdate + watchdog reclaim
        admin.table("compute_jobs").update({
            "claimed_at": "2020-01-01T00:00:00Z",
        }).eq("id", job_id).execute()
        admin.rpc("reset_stalled_compute_jobs", {
            "p_stale_threshold": "1 second",
        }).execute()

        # W2 claim
        w2 = _claim_one(admin, "p97-w2")
        assert w2 is not None and w2["id"] == job_id
        token2 = w2["claim_token"]
        assert token2 is not None
        assert token2 != token1, (
            "claim_token must rotate on every claim — both workers got the "
            "same UUID, fence is broken"
        )

        # W1's late mark MUST raise. We don't depend on a specific exception
        # class because supabase-py wraps PostgREST errors in APIError (whose
        # .code is '40001') and the wire-level message also embeds the SQLSTATE.
        # Either signal proves the fence engaged.
        late_mark_failed = False
        try:
            admin.rpc("mark_compute_job_done", {
                "p_job_id": job_id,
                "p_claim_token": token1,
            }).execute()
        except Exception as exc:  # noqa: BLE001
            err_str = str(exc)
            assert (
                "40001" in err_str
                or "serialization_failure" in err_str
                or "preempted" in err_str
            ), (
                f"W1's late mark_done raised the wrong exception: {exc!r}. "
                "Expected SQLSTATE 40001 / serialization_failure / "
                "'preempted' in the message."
            )
            late_mark_failed = True
        assert late_mark_failed, (
            "W1's mark_compute_job_done(token1) MUST raise after watchdog "
            "reclaim + W2 claim — instead it returned cleanly, meaning the "
            "P97 fence is bypassed and W2's run can be marked done by W1."
        )

        # Sanity: row is still W2's running run, not flipped to done.
        row = admin.table("compute_jobs").select("status,claim_token").eq("id", job_id).single().execute().data
        assert row["status"] == "running"
        assert row["claim_token"] == token2

        # W2's mark_done SUCCEEDS with its matching token.
        admin.rpc("mark_compute_job_done", {
            "p_job_id": job_id,
            "p_claim_token": token2,
        }).execute()
        row = admin.table("compute_jobs").select("status").eq("id", job_id).single().execute().data
        assert row["status"] == "done"
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


def test_late_mark_failed_with_stale_token_raises_serialization_failure(admin, strategy_id):
    """Same contract as mark_done — mark_failed must reject the prior
    worker's stale token after a watchdog reclaim + new claim."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        w1 = _claim_one(admin, "p97-w1-fail")
        token1 = w1["claim_token"]

        admin.table("compute_jobs").update({
            "claimed_at": "2020-01-01T00:00:00Z",
        }).eq("id", job_id).execute()
        admin.rpc("reset_stalled_compute_jobs", {
            "p_stale_threshold": "1 second",
        }).execute()

        w2 = _claim_one(admin, "p97-w2-fail")
        token2 = w2["claim_token"]
        assert token2 != token1

        late_mark_failed = False
        try:
            admin.rpc("mark_compute_job_failed", {
                "p_job_id": job_id,
                "p_error": "stale-worker-late-fail",
                "p_error_kind": "transient",
                "p_claim_token": token1,
            }).execute()
        except Exception as exc:  # noqa: BLE001
            err_str = str(exc)
            assert (
                "40001" in err_str
                or "serialization_failure" in err_str
                or "preempted" in err_str
            ), f"W1's late mark_failed raised the wrong exception: {exc!r}"
            late_mark_failed = True
        assert late_mark_failed, (
            "W1's mark_compute_job_failed(token1) MUST raise after watchdog "
            "reclaim + W2 claim"
        )
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


def test_mark_done_without_token_back_compat(admin, strategy_id):
    """Pre-mig-117 callers passed only p_job_id. The new RPC defaults
    p_claim_token to NULL and treats NULL as 'skip fence' so the rollout
    is non-breaking. Verify a token-less mark_done still flips the row."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        _claim_one(admin, "p97-back-compat")
        # Token-less call — emulates a legacy caller (Edge Function, manual
        # admin runbook, etc.) that hasn't been updated to mig 117.
        admin.rpc("mark_compute_job_done", {"p_job_id": job_id}).execute()
        row = admin.table("compute_jobs").select("status").eq("id", job_id).single().execute().data
        assert row["status"] == "done"
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()
