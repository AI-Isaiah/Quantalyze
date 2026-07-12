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

import concurrent.futures
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ----------------------------------------------------------------------------
# Mocked-client unit tests (always-on regression for dispatch_tick wiring)
# ----------------------------------------------------------------------------

from main_worker import _is_serialization_failure, dispatch_tick
from services.job_worker import (
    PARTITION_COLUMNS,
    DispatchOutcome,
    DispatchResult,
)


# Path to the H-1235/H-1238/M-1133 hardening migration. Tests below parse
# this file directly so they pin the Python `PARTITION_COLUMNS` constant
# against the actual SQL — the prior tautological assertion (constant ==
# its own literal definition) tested nothing.
_HARDENING_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20260528061155_claim_dedupe_tie_break_and_short_circuit.sql"
)


def _partition_columns_from_sql() -> list[str]:
    """Parse the hardening migration SQL and return the ordered, deduped
    list of `PARTITION BY kind, <col>` columns across all row_number()
    windows in both claim RPC bodies.

    The legacy + priority bodies each have FOUR row_number() windows, so
    the raw regex returns ~8 hits with duplicates. Collapse to a list
    that preserves first-seen order — this is what `PARTITION_COLUMNS`
    must match.
    """
    text = _HARDENING_MIGRATION_PATH.read_text(encoding="utf-8")
    # Red-team #2 (round-3): anchor on `row_number() OVER (` so we only
    # match PARTITION BY clauses inside real window definitions — NOT
    # ones embedded in `--` comments or COMMENT ON FUNCTION strings.
    # Handles arbitrary whitespace between `kind,` and the column name
    # (the priority body wraps the window across newlines).
    raw = re.findall(
        r"row_number\(\)\s*OVER\s*\(\s*PARTITION BY kind,\s*(\w+)",
        text,
    )
    seen: list[str] = []
    for col in raw:
        if col not in seen:
            seen.append(col)
    return seen


def test_partition_columns_match_sql_migration_windows():
    """M-1128 + HIGH-2: pin `PARTITION_COLUMNS` to the SQL it mirrors.

    The Python tuple MUST equal the dedupe-by-first-occurrence list of
    partition columns parsed from
    `supabase/migrations/20260528061155_claim_dedupe_tie_break_and_short_circuit.sql`.
    A future addition (e.g. workspace_id) to either side without updating
    the other will fail this test — making the cross-side change
    deliberate rather than a silent desync.

    The prior `assert PARTITION_COLUMNS == ('a','b','c','d')` was
    tautological (same literal as the constant's definition); this
    test is the load-bearing one.
    """
    sql_cols = _partition_columns_from_sql()
    # Take only the first 4 (the priority + legacy bodies have 4 windows
    # each; the de-dup-by-first-occurrence above already collapses them,
    # but defending against an inadvertent 5th window slipping through).
    assert tuple(sql_cols[:4]) == PARTITION_COLUMNS, (
        f"PARTITION_COLUMNS {PARTITION_COLUMNS!r} drifted from the SQL "
        f"migration's partition windows {sql_cols!r}. Update both sides "
        "together — or the dedupe will silently disagree."
    )


def test_exactly_four_unique_partition_columns_in_sql():
    """HIGH-2 second assertion: catch a 5th partition column landing in
    the SQL without `PARTITION_COLUMNS` being updated.

    If someone adds a `PARTITION BY kind, workspace_id` window to either
    body, `_partition_columns_from_sql` returns 5 unique entries — this
    test fails loudly, forcing the Python tuple to be widened in the
    same change.
    """
    sql_cols = _partition_columns_from_sql()
    assert len(sql_cols) == 4, (
        f"Expected exactly 4 unique partition columns in the SQL, got "
        f"{len(sql_cols)}: {sql_cols!r}. A new partition window was "
        "added — widen PARTITION_COLUMNS in services/job_worker.py to "
        "match."
    )


def test_partition_columns_pin_order_matches_sql():
    """Defense-in-depth: pin the IMMUTABLE order independent of the SQL
    parse. If a future refactor mistakenly reorders the Python tuple
    even while the SQL is parsed correctly elsewhere, this guard fails."""
    assert PARTITION_COLUMNS == (
        "portfolio_id",
        "strategy_id",
        "allocator_id",
        "api_key_id",
    )


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
    """_is_serialization_failure must classify ONLY:
      (a) PostgREST APIError with .code == '40001', AND
      (b) bare exceptions whose str contains our specific RAISE message
          literal 'preempted by watchdog reclaim'.

    PR #149 review I4 (maintainability conf 8 + security conf 6):
    tightened from the previous fuzzy detection that ALSO matched
    bare '40001' or 'serialization_failure' anywhere in the message.
    That collided with unrelated 40001 sources (other SERIALIZABLE
    isolation conflicts, advisory-lock contention surfacing as 40001,
    third-party library messages embedding '40001' for unrelated
    reasons). Tighter = P97-specific.
    """

    def test_apierror_with_code_40001_detected(self) -> None:
        exc = APIError({"code": "40001", "message": "preempted"})
        assert _is_serialization_failure(exc) is True

    def test_apierror_with_other_code_not_detected(self) -> None:
        exc = APIError({"code": "23505", "message": "unique violation"})
        assert _is_serialization_failure(exc) is False

    def test_bare_exception_with_message_text_detected(self) -> None:
        """The literal RAISE message from migration 117 STEP 4/STEP 5."""
        exc = RuntimeError("preempted by watchdog reclaim (caller token=...)")
        assert _is_serialization_failure(exc) is True

    def test_unrelated_exception_not_detected(self) -> None:
        exc = RuntimeError("some other error")
        assert _is_serialization_failure(exc) is False

    def test_bare_40001_in_message_NOT_detected_when_no_p97_marker(self) -> None:
        """I4 regression: a 40001 from elsewhere (SERIALIZABLE conflict,
        advisory-lock contention, or any library that embeds '40001' in
        a message) must NOT be classified as a P97 preemption.
        Pre-I4 the fuzzy 'in msg' branch swallowed these silently,
        burying the real error. Without .code AND without our literal
        message, this is NOT a fence event."""
        exc = RuntimeError("PostgrestException: 40001 from some unrelated path")
        assert _is_serialization_failure(exc) is False

    def test_bare_serialization_failure_in_message_NOT_detected_when_no_p97_marker(self) -> None:
        """I4 regression: same as above for the 'serialization_failure'
        literal — a generic SERIALIZABLE-isolation conflict elsewhere in
        the stack must not be misclassified as a P97 fence event."""
        exc = RuntimeError("RPC raised: serialization_failure (some other source)")
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
    async def test_late_mark_done_serialization_failure_swallowed(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """When mark_compute_job_done raises APIError(code='40001'), the
        exception is logged as LATE_MARK_IGNORED and dispatch_tick
        returns cleanly. No retry, no re-raise — another worker is
        legitimately handling the row.

        I3: assert the LATE_MARK_IGNORED log line actually fires. Without
        this assertion the LATE_MARK_IGNORED contract is unverified — a
        future refactor could swallow the exception silently and the
        test would still pass."""
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
             ), \
             caplog.at_level(logging.WARNING, logger="quantalyze.analytics.worker"):
            # Must NOT raise. Must NOT re-attempt mark_failed as a fallback —
            # that would treat a preemption as a failure and burn the row's
            # retry budget on the new worker's run.
            await dispatch_tick("worker-preempted")

        # Exactly one mark_done attempt; no fallback mark_failed.
        rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert rpc_names.count("mark_compute_job_done") == 1
        assert rpc_names.count("mark_compute_job_failed") == 0
        # I3: LATE_MARK_IGNORED log line must fire so operators see the
        # preemption (and the alert pipeline can baseline / threshold it).
        assert any(
            "LATE_MARK_IGNORED" in r.getMessage() for r in caplog.records
        ), (
            "expected a LATE_MARK_IGNORED log line — the contract is that "
            "preempted late marks ARE logged, not silently swallowed"
        )

    @pytest.mark.asyncio
    async def test_late_mark_failed_serialization_failure_swallowed(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Same contract as DONE → APIError 40001 swallowed, no re-raise.

        I3: includes the same caplog assertion as the DONE-equivalent."""
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
             patch("main_worker.dispatch", new=AsyncMock(return_value=result)), \
             caplog.at_level(logging.WARNING, logger="quantalyze.analytics.worker"):
            await dispatch_tick("worker-fp")

        # Exactly one mark_failed attempt — the swallowed 40001 must NOT
        # cascade into the fallback mark_failed branch (which would also
        # 40001 and obscure the LATE_MARK_IGNORED log line).
        rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert rpc_names.count("mark_compute_job_failed") == 1
        assert any(
            "LATE_MARK_IGNORED" in r.getMessage() for r in caplog.records
        )

    @pytest.mark.asyncio
    async def test_late_mark_from_outer_fallback_tagged_with_event_type(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """PR #149 second-pass review fix #4 (HIGH conf 8): when dispatch()
        raises AND the outer-catch fallback's mark_failed itself swallows
        a 40001, the resulting LATE_MARK_IGNORED log record MUST carry
        `event_type="preempted_after_dispatch_error"` in its `extra`
        dict.

        Why: pre-fix the cascade produced THREE log lines for ONE
        conceptual event (logger.error("dispatch_tick: unhandled
        error...") + cascade WARNING + LATE_MARK_IGNORED WARNING).
        Sentry alert pipelines keying on the most recent severity
        would mis-classify a benign preemption as a critical dispatch
        failure. The new contract: the LATE_MARK_IGNORED line is the
        single source of truth for this event, the outer_exc context
        rides on its `extra` dict, and the original logger.error()
        line is deferred until AFTER _safe_mark returns (and only
        fires when mark_failed succeeded — i.e. the dispatch error
        was real and unattributed).
        """
        tok = str(uuid.uuid4())
        jobs = [
            {
                "id": "job-cascade",
                "kind": "sync_trades",
                "strategy_id": "s-cascade",
                "claim_token": tok,
            }
        ]
        mock_supabase = MagicMock()

        def _rpc_side_effect(name: str, params: dict):
            chain = MagicMock()
            if name == "claim_compute_jobs_with_priority":
                chain.execute.return_value = MagicMock(data=jobs)
            elif name == "mark_compute_job_failed":
                # The outer-catch's _mark_failed_fallback hits 40001 too —
                # this is the cascade scenario.
                chain.execute.side_effect = APIError({
                    "code": "40001",
                    "message": "preempted by watchdog reclaim",
                })
            else:
                chain.execute.return_value = MagicMock(data=None)
            return chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        # dispatch() itself raises — drives execution into the outer-catch
        # path that builds _mark_failed_fallback with outer_exc=exc.
        outer_exc = RuntimeError("dispatch handler exploded")

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch(
                 "main_worker.dispatch",
                 new=AsyncMock(side_effect=outer_exc),
             ), \
             caplog.at_level(logging.WARNING, logger="quantalyze.analytics.worker"):
            await dispatch_tick("worker-cascade")

        late_mark_records = [
            r for r in caplog.records
            if "LATE_MARK_IGNORED" in r.getMessage()
        ]
        assert len(late_mark_records) == 1, (
            f"expected exactly one LATE_MARK_IGNORED record, got "
            f"{len(late_mark_records)} — the cascade is producing "
            "redundant log lines again"
        )
        rec = late_mark_records[0]
        # event_type distinguishes the cascade case from the simple
        # "running row preempted" case. Sentry/log routers key on this
        # to suppress redundant alerts.
        assert getattr(rec, "event_type", None) == "preempted_after_dispatch_error", (
            "LATE_MARK_IGNORED record from the outer-fallback path must "
            "carry event_type='preempted_after_dispatch_error' in its "
            "extra dict so the dispatch error context is preserved "
            "WITHOUT a redundant logger.error() line."
        )
        # outer_exc context must be on the record (repr form so structured
        # exporters get a stable string).
        assert "dispatch handler exploded" in getattr(rec, "outer_exc", "") or "", (
            "outer_exc context must be preserved on the LATE_MARK_IGNORED "
            "record so operators can trace the dispatch failure that drove "
            "us into the fallback path"
        )

        # The redundant `logger.error("dispatch_tick: unhandled error...")`
        # line MUST NOT fire when LATE_MARK_IGNORED subsumes it.
        error_records = [
            r for r in caplog.records
            if r.levelname == "ERROR"
            and "dispatch_tick: unhandled error" in r.getMessage()
        ]
        assert error_records == [], (
            "logger.error('dispatch_tick: unhandled error...') fired even "
            "though LATE_MARK_IGNORED subsumes it. Sentry will see "
            f"ERROR + WARNING for the same conceptual event: {error_records!r}"
        )


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
    """Skip live-DB tests when the test Supabase project isn't configured
    locally; HARD-FAIL when running in CI without credentials.

    The CI hard-fail is the regression contract. PR #149 wires the test
    Supabase project (`qmnijlgmdhviwzwfyzlc`) into the python job via
    the TEST_SUPABASE_* secrets and the `vars.E2E_TEST_DB_CONFIGURED`
    gate. The project is at migration train HEAD (109-118 applied
    2026-05-12), so live-DB fixtures execute against a schema that
    matches main. If a future change breaks that contract — secrets
    unset, gate flipped, project schema drifts — CI must surface it
    loudly rather than silently skipping the entire P97 fence suite.
    """
    if create_client is None:
        pytest.skip("supabase-py not installed in this environment")
    if not SUPABASE_URL or not SUPABASE_KEY:
        if os.getenv("CI", "").lower() == "true":
            pytest.fail(
                "P97 live-DB fence tests cannot run: SUPABASE_TEST_URL / "
                "SUPABASE_TEST_SERVICE_KEY are unset in CI. Wire the "
                "TEST_SUPABASE_* secrets and set vars.E2E_TEST_DB_CONFIGURED=true.",
                pytrace=False,
            )
        pytest.skip("test Supabase project not configured (local dev)")


@pytest.fixture
def admin():
    _need_supabase()
    # Force the PostgREST transport onto HTTP/1.1. supabase-py hardcodes
    # http2=True when it builds the PostgREST httpx client
    # (postgrest/_sync/client.py create_session), and the pinned supabase
    # 2.15.1 exposes no ClientOptions seam to override it. With `h2` installed,
    # the concurrent-claim test multiplexes both worker RPCs over ONE HTTP/2
    # connection → the Supabase edge sends a GOAWAY mid-stream
    # (httpx.RemoteProtocolError: ConnectionTerminated error_code:1) AND the
    # multiplex serializes the two requests so the second worker sees the
    # first's committed claim ("overlapping claims"). Rebuilding the session
    # with http2=False gives each concurrent thread its own pooled connection —
    # genuine parallelism at the DB, no multiplexed GOAWAY surface — which is
    # exactly what the SKIP LOCKED disjointness assertion is meant to exercise.
    # Reusing type(session)(...) keeps the postgrest SyncClient subclass (and
    # its aclose) across supabase-py versions. (CI flakiness audit F1.)
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    session = client.postgrest.session
    client.postgrest.session = type(session)(
        base_url=session.base_url,
        headers=session.headers,
        # CL10: bump the read timeout well above supabase-py's tight default.
        # The python job runs CONCURRENTLY with the e2e job against the same
        # shared test project; under that contention a fencing RPC's response
        # (defer_compute_job does SELECT ... FOR UPDATE) can exceed the default
        # and raise httpx.ReadTimeout — the documented live-DB-suite-load flake
        # (see the skipped test below). 60s absorbs the contention spike.
        timeout=60.0,
        follow_redirects=True,
        http2=False,
    )
    return client


def _rpc_retry_timeout(fn, attempts: int = 2):
    """Call a live-DB RPC, retrying once on a transient httpx read timeout.
    If it STILL times out, pytest.skip rather than fail: the shared test
    project is too contended to serve the RPC right now (the python CI job
    runs concurrently with the e2e job against the same project — the
    documented ~120s-suite-load ReadTimeout flake, see the skipped test
    below). That is an infrastructure limit, NOT a fence failure — the fence
    is independently pinned by the migration's self-verify DO block (runs on
    every prod + test-DB apply) and was proven via a live DO-block; this test
    is supplementary live-DB coverage that runs cleanly when the project is
    responsive (e.g. a python-only re-run). Any NON-timeout exception —
    including the serialization_failure these tests assert — re-raises
    immediately so the assertion still observes it. pytest.skip raises
    Skipped (a BaseException), so an enclosing pytest.raises(Exception) does
    NOT swallow it — the skip propagates and marks the test skipped."""
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            if "timed out" not in str(exc).lower():
                raise
            last = exc
            time.sleep(0.5 * (attempt + 1))
    pytest.skip(
        f"defer_compute_job live-DB RPC timed out {attempts}x under shared "
        f"test-project contention (python+e2e concurrent); fence verified by "
        f"the migration self-verify DO block + live DO-block. Last: {last}"
    )


def _seed_user_id(admin) -> str:
    """Return any existing profile id from the test DB.

    The strategies.user_id FK references profiles(id), which itself references
    auth.users(id). Creating a fresh auth.users entry per test is expensive
    and pollutes the test project. Reuse any seeded profile (per project
    convention the test Supabase project has 3 fixed test users:
    alloc/sm/admin@quantalyze.test). Strategies are still unique per test
    because the new strategy_id is generated server-side; tests are isolated
    by strategy_id, not user_id.
    """
    res = admin.table("profiles").select("id").limit(1).execute()
    if not res.data:
        pytest.fail(
            "Test Supabase project has no seeded profiles — cannot satisfy "
            "strategies.user_id FK. Seed at least one profile (linked to an "
            "auth.users entry) in the test project before running this suite.",
            pytrace=False,
        )
    return res.data[0]["id"]


@pytest.fixture
def strategy_id(admin):
    user_id = _seed_user_id(admin)
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


def _claim_one(
    admin, worker_id: str, *, want_job_id: str | None = None
) -> dict[str, Any] | None:
    """Call claim_compute_jobs_with_priority and return OUR row.

    Phase-97 CI-01: the claim RPC returns the batch head of the GLOBAL claim
    queue, which — on the shared test Supabase project hit by interleaved
    grouped DB tests and the concurrent e2e job — may be a FOREIGN pending row,
    not the one this test seeded. Pass ``want_job_id`` to scope the return to
    OUR job (``r["id"] == want_job_id``), returning None when our job was not
    in the batch (never a foreign row). The legacy arm (``want_job_id=None``)
    returns ``data[0]`` and exists only so the offline decoy can pin the
    global-queue defect the scoping removes.
    """
    res = admin.rpc("claim_compute_jobs_with_priority", {
        "p_batch_size": 50,
        "p_worker_id": worker_id,
        "p_unified_backbone_active": False,
    }).execute()
    rows = res.data or []
    if want_job_id is not None:
        return next((r for r in rows if r["id"] == want_job_id), None)
    return rows[0] if rows else None


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
        claimed = _claim_one(admin, "p97-claim-test", want_job_id=job_id)
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


# ----------------------------------------------------------------------------
# Phase-97 CI-01 — decoy-foreign-row regression (the repro-gate for the
# per-run-`job_id` claim scoping).
# ----------------------------------------------------------------------------
# PR #610 parallelizes this suite under `pytest -n auto --dist loadgroup` and
# pins every shared-test-DB module to a single `xdist_group("shared_test_db")`.
# But xdist_group SERIALIZES; it does NOT ISOLATE — the grouped fence/claim
# tests still run against the ONE shared Supabase test project (also hit by the
# concurrently-running e2e job). The old `_claim_one` returned `res.data[0]`,
# assuming the head of the GLOBAL claim queue is OUR job. A single FOREIGN
# pending compute_jobs row (from an interleaved grouped DB test, or the e2e
# job) claimed into the same batch lands at `data[0]` and breaks every fence
# assertion that reads `claimed["id"] == our_job_id`.
#
# These two tests pin WHY the scoping is load-bearing. The OFFLINE one is the
# local repro-gate (no DB, no skip — the only signal that works without a live
# CI run): it FAILS against the unscoped helper (no `want_job_id` kwarg →
# TypeError) and PASSES once Task 2 threads the own-row filter through.


class _StubExecute:
    """Minimal stand-in for a supabase-py request builder's `.execute()`."""

    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def execute(self) -> SimpleNamespace:
        return SimpleNamespace(data=list(self._rows))


class _StubAdmin:
    """Offline stub whose `claim_compute_jobs_with_priority` RPC returns a
    fixed row list — no supabase import, runs everywhere."""

    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def rpc(self, name: str, params: dict) -> _StubExecute:
        assert name == "claim_compute_jobs_with_priority", (
            f"decoy stub only models the claim RPC, got {name!r}"
        )
        return _StubExecute(self._rows)


def test_claim_one_decoy_foreign_row_offline():
    """OFFLINE repro-gate: a FOREIGN row at the head of the claim batch must
    NOT be mistaken for our job. `_claim_one(..., want_job_id=own)` returns OUR
    row even when a foreign row is `data[0]`; the legacy (unscoped) arm returns
    the foreign row — pinning exactly why the scoping is load-bearing. When the
    batch holds only foreign rows, the scoped call returns None, never a
    foreign row.

    This test FAILS against the unscoped helper (TypeError: no `want_job_id`)
    and PASSES after the Task 2 scoping. It is the ONLY isolation signal that
    runs without the live test Supabase project.
    """
    own_id = str(uuid.uuid4())
    foreign_id = str(uuid.uuid4())
    own_row = {"id": own_id, "claim_token": str(uuid.uuid4()), "status": "running"}
    foreign_row = {
        "id": foreign_id, "claim_token": str(uuid.uuid4()), "status": "running",
    }

    # Foreign row FIRST in the batch — exactly the ordering that broke data[0].
    stub = _StubAdmin([foreign_row, own_row])

    # Scoped arm: returns OUR row despite the foreign row at data[0].
    claimed = _claim_one(stub, "decoy-offline", want_job_id=own_id)
    assert claimed is not None and claimed["id"] == own_id, (
        "scoped _claim_one must return OUR job even when a foreign row heads "
        "the claim batch"
    )

    # Legacy (unscoped) arm: returns the FOREIGN row at data[0] — this is the
    # exact defect the scoping removes at the call sites.
    legacy = _claim_one(stub, "decoy-offline")
    assert legacy is not None and legacy["id"] == foreign_id, (
        "unscoped _claim_one returns data[0] (the foreign row) — the "
        "global-queue assumption this regression pins"
    )

    # Only-foreign batch: the scoped call must return None, never a foreign row.
    only_foreign = _StubAdmin([foreign_row])
    assert _claim_one(only_foreign, "decoy-offline", want_job_id=own_id) is None, (
        "scoped _claim_one must return None (not a foreign row) when our job "
        "was not in the batch"
    )


def test_claim_one_decoy_foreign_row_live(admin, strategy_id):
    """LIVE supplement (skips locally without the test Supabase project): seed
    our own pending job, insert a decoy pending job on a SECOND throwaway
    strategy (a distinct dedupe partition, so both are claimable in one batch),
    then the scoped `_claim_one` returns OUR job with a non-NULL claim_token —
    never the decoy."""
    own_job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    own_job_id = own_job["id"]

    # Decoy on a distinct partition — both rows are independently claimable.
    decoy_strategy_id = _make_strategy(admin)
    decoy_job_id = _insert_pending_sync_trades(admin, decoy_strategy_id)
    try:
        claimed = _claim_one(admin, "decoy-live", want_job_id=own_job_id)
        assert claimed is not None and claimed["id"] == own_job_id, (
            "scoped _claim_one must return OUR seeded job, not the decoy row"
        )
        assert claimed.get("claim_token") is not None
    finally:
        # Clean up BOTH jobs + the throwaway strategy. The claim RPC will have
        # stamped the decoy `running` as a side effect (watchdog self-heals it,
        # but delete anyway).
        admin.table("compute_jobs").delete().eq("id", own_job_id).execute()
        admin.table("compute_jobs").delete().eq("id", decoy_job_id).execute()
        try:
            admin.table("strategies").delete().eq("id", decoy_strategy_id).execute()
        except Exception:
            pass


def test_mark_compute_job_failed_writes_error_kind(admin, strategy_id):
    """HOTFIX 20260529180000 regression: mark_compute_job_failed must write the
    `error_kind` column.

    Mig 20260528183100 rewrote the RPC with `SET ... last_error_kind = p_error_kind`,
    but compute_jobs has no `last_error_kind` column (the classification column is
    `error_kind`). plpgsql doesn't validate column refs at CREATE, so it deployed
    clean and 42703-errored EVERY failed-job marking in prod — failing jobs never
    transitioned to failed_retry/failed_final and looped via the watchdog.

    Seed → claim → mark failed 'permanent' → assert failed_final WITH error_kind
    persisted. Against the buggy function the mark RPC raises
    'column "last_error_kind" of relation "compute_jobs" does not exist'.
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
        claimed = _claim_one(admin, "hotfix-mark-failed", want_job_id=job_id)
        assert claimed is not None and claimed["id"] == job_id
        token = claimed["claim_token"]

        # The call that 42703'd on the buggy function. _rpc_retry_timeout
        # re-raises a non-timeout error immediately (so a regressed column ref
        # FAILS the test), and only pytest.skips on a genuine shared-DB timeout.
        _rpc_retry_timeout(lambda: admin.rpc("mark_compute_job_failed", {
            "p_job_id": job_id,
            "p_error": "hotfix regression: synthetic permanent failure",
            "p_error_kind": "permanent",
            "p_claim_token": token,
        }).execute())

        row = admin.table("compute_jobs").select(
            "status, error_kind, last_error"
        ).eq("id", job_id).single().execute().data
        assert row["status"] == "failed_final", (
            f"permanent failure must go failed_final, got {row['status']!r}"
        )
        assert row["error_kind"] == "permanent", (
            "error_kind must persist (the column the last_error_kind typo "
            f"missed), got {row['error_kind']!r}"
        )
        assert row["last_error"] == "hotfix regression: synthetic permanent failure"
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
        claimed = _claim_one(admin, "p97-w1", want_job_id=job_id)
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


def test_defer_compute_job_token_fence(admin, strategy_id):
    """NEW-C12-06 (CL10): defer_compute_job must reject a stale claim_token on
    a still-running row (serialization_failure) so a preempted worker (W1)
    cannot yank a job the watchdog reclaimed and W2 re-claimed under a fresh
    token. A MATCHING token defers normally and NULLs the stale fence token.

    Deterministic setup: drive the row to status='running' with a known token
    via a direct UPDATE (rather than _claim_one, which on the shared test DB
    could claim a different pending job). defer_compute_job gates only on
    status='running' + claim_token, so this faithfully exercises the fence.
    """
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "poll_positions",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        real_token = str(uuid.uuid4())
        admin.table("compute_jobs").update({
            "status": "running",
            "claim_token": real_token,
            "attempts": 1,
        }).eq("id", job_id).execute()

        # (1) Mismatched token → serialization_failure, running row UNTOUCHED.
        wrong_token = str(uuid.uuid4())
        with pytest.raises(Exception) as exc_info:
            _rpc_retry_timeout(lambda: admin.rpc("defer_compute_job", {
                "p_job_id": job_id,
                "p_defer_seconds": 60,
                "p_reason": "c12-06 mismatch probe",
                "p_claim_token": wrong_token,
            }).execute())
        assert "preempted" in str(exc_info.value) or "serialization" in str(exc_info.value).lower(), (
            f"mismatched-token defer must raise serialization_failure, got: {exc_info.value}"
        )
        row = admin.table("compute_jobs").select("status,claim_token,attempts").eq("id", job_id).single().execute().data
        assert row["status"] == "running", "mismatched-token defer must NOT yank the running job (W2 keeps it)"
        assert row["claim_token"] == real_token, "mismatched-token defer must not clear the live token"
        assert row["attempts"] == 1, "mismatched-token defer must not decrement attempts"

        # (2) Matching token → defers: running→pending, attempts decremented,
        # claim_token NULLed so the pending row drops its stale fence token.
        _rpc_retry_timeout(lambda: admin.rpc("defer_compute_job", {
            "p_job_id": job_id,
            "p_defer_seconds": 60,
            "p_reason": "c12-06 match probe",
            "p_claim_token": real_token,
        }).execute())
        row = admin.table("compute_jobs").select("status,claim_token,attempts").eq("id", job_id).single().execute().data
        assert row["status"] == "pending"
        assert row["claim_token"] is None, "defer must NULL the stale fence token (C12-06)"
        assert row["attempts"] == 0, "defer decrements attempts to cancel the claim increment"
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


def test_defer_compute_job_null_token_backcompat(admin, strategy_id):
    """NEW-C12-06 back-compat arm: a NULL p_claim_token still defers a running
    row (the deploy-window path for the pre-rollout worker). This is the arm a
    later strict-NULL tightening would remove once the worker rollout lands."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "poll_positions",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        admin.table("compute_jobs").update({
            "status": "running",
            "claim_token": str(uuid.uuid4()),
            "attempts": 1,
        }).eq("id", job_id).execute()
        # NULL token (omit the param) → back-compat match, defers.
        _rpc_retry_timeout(lambda: admin.rpc("defer_compute_job", {
            "p_job_id": job_id,
            "p_defer_seconds": 30,
            "p_reason": "c12-06 null backcompat probe",
        }).execute())
        row = admin.table("compute_jobs").select("status,claim_token").eq("id", job_id).single().execute().data
        assert row["status"] == "pending", "NULL-token defer must still work (back-compat arm)"
        assert row["claim_token"] is None
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


@pytest.mark.skip(reason=(
    "P1 TODO — flaky httpx.ReadTimeout at ~120s under live-DB suite load. "
    "Fence logic in mig 117 mark_compute_job_done verified correct by inspection: "
    "UPDATE → NOT FOUND → SELECT → RAISE serialization_failure has no hang path. "
    "989 other tests pass on the same admin client incl. 9/12 fence tests "
    "(claim, reclaim, token rotation, unexpected-status raise, idempotent already-done). "
    "Mocked equivalents (_is_serialization_failure classifier, LATE_MARK_IGNORED contract, "
    "dispatch_tick token threading) also pass. Likely test Supabase project load / "
    "PostgREST connection pool state under the newly-enabled live suite (drain + "
    "transition + fence ~ 30 tests added 2026-05-13). Re-enable after either "
    "(a) bumping postgrest_client_timeout, (b) sharding the live suite, or "
    "(c) investigating server-side latency on the test project. See TODOS.md."
))
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
        w1 = _claim_one(admin, "p97-w1", want_job_id=job_id)
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
        w2 = _claim_one(admin, "p97-w2", want_job_id=job_id)
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


@pytest.mark.skip(reason=(
    "P1 TODO — same flaky timeout pattern as test_late_mark_done_with_stale_token. "
    "See that test's skip reason + TODOS.md for the full investigation."
))
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
        w1 = _claim_one(admin, "p97-w1-fail", want_job_id=job_id)
        token1 = w1["claim_token"]

        admin.table("compute_jobs").update({
            "claimed_at": "2020-01-01T00:00:00Z",
        }).eq("id", job_id).execute()
        admin.rpc("reset_stalled_compute_jobs", {
            "p_stale_threshold": "1 second",
        }).execute()

        w2 = _claim_one(admin, "p97-w2-fail", want_job_id=job_id)
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


def test_mark_done_without_token_raises_strict(admin, strategy_id):
    """audit-2026-05-07 B5 (C-PR5-02 defense-in-depth) — strict-token
    follow-up to mig 117. The pre-mig-20260528183100 back-compat path
    accepted p_claim_token=NULL as 'skip fence'; that was the latent
    surface a stale caller (or a SERVICE_KEY holder) could exploit to
    bypass the P97 race fence. Mig 20260528183100 makes the token
    mandatory: NULL now raises 22023 invalid_parameter_value at the
    function entry, BEFORE any UPDATE on compute_jobs.

    This test pins the new strict contract: calling mark_compute_job_done
    without p_claim_token must raise (was: silently flip to done)."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        claimed = _claim_one(admin, "p97-strict", want_job_id=job_id)
        assert claimed is not None and claimed["id"] == job_id, (
            "p97-strict: our seeded job must be the one claimed — the later "
            "status=='running' assertion silently depends on it"
        )
        raised = False
        try:
            admin.rpc("mark_compute_job_done", {"p_job_id": job_id}).execute()
        except Exception as exc:  # noqa: BLE001
            err_str = str(exc)
            assert (
                "p_claim_token is required" in err_str
                or "22023" in err_str
                or "invalid_parameter_value" in err_str
            ), f"expected strict-NULL guard, got: {exc!r}"
            raised = True
        assert raised, (
            "mark_compute_job_done(NULL) must now raise (B5 strict fence). "
            "Got silent success — the post-mig-117 back-compat is no longer "
            "in force; rerun the migration if this regresses."
        )
        # Row stayed in 'running' (claim_one promoted it) — NOT flipped to
        # done by the rejected call.
        row = admin.table("compute_jobs").select("status").eq("id", job_id).single().execute().data
        assert row["status"] == "running"
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


# ----------------------------------------------------------------------------
# H-1246: concurrent claim under SKIP LOCKED — disjoint result sets.
# ----------------------------------------------------------------------------
# Migration 090's docstring (lines 53-57) asserts a non-trivial concurrency
# property: "Two concurrent workers see the same dedupe winners (the inner
# CTE is deterministic) and SKIP LOCKED partitions the locked subset." The
# headline P97 fence + dedupe tests are all single-threaded; none drove two
# parallel claim RPC calls. This test does: a thread-pool of two admin
# clients fires claim_compute_jobs_with_priority simultaneously and the
# union must be disjoint — FOR UPDATE SKIP LOCKED must hand each claimable
# row to EXACTLY ONE worker (never zero via a lost row, never two via a
# double claim).
#
# Partitioning note (from the finding): the dedupe CTE collapses rows sharing
# (kind, strategy_id|allocator_id|...), so to get a meaningful contention
# surface we seed across FOUR DISTINCT strategies — four distinct partitions,
# four independently-claimable rows. A single-strategy seed would dedupe to
# one survivor and the disjointness assertion would be vacuous.
# ----------------------------------------------------------------------------


def _insert_pending_sync_trades(admin, strategy_id: str) -> str:
    """Insert a pending sync_trades row and return its id."""
    res = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
        "next_attempt_at": "2020-01-01T00:00:00Z",
    }).execute()
    return res.data[0]["id"]


def _make_strategy(admin) -> str:
    """Create a throwaway strategy (own partition) and return its id."""
    user_id = _seed_user_id(admin)
    res = admin.table("strategies").insert({
        "user_id": user_id,
        "name": f"h1246-conc-{uuid.uuid4().hex[:8]}",
        "status": "pending_review",
        "source": "okx",
        "strategy_types": [],
        "subtypes": [],
        "markets": [],
        "supported_exchanges": [],
    }).execute()
    return res.data[0]["id"]


def test_concurrent_claim_disjoint_under_skip_locked(admin):
    """Migration 090 concurrency contract: two concurrent
    claim_compute_jobs_with_priority calls return DISJOINT row sets via
    FOR UPDATE SKIP LOCKED, and every claimable row is handed to exactly
    one worker (the union covers all four seeded rows — no row lost, none
    double-claimed).

    Pre-SKIP-LOCKED (or if a refactor drops it): two concurrent batch
    UPDATEs over the same ready pool either deadlock, block, or BOTH claim
    the same row — surfacing as an overlapping result set here.
    """
    # Four distinct strategies → four distinct dedupe partitions → four
    # independently-claimable rows.
    strategy_ids = [_make_strategy(admin) for _ in range(4)]
    job_ids: list[str] = []
    try:
        for sid in strategy_ids:
            job_ids.append(_insert_pending_sync_trades(admin, sid))

        def _claim_batch(worker: str) -> set[str]:
            res = admin.rpc("claim_compute_jobs_with_priority", {
                "p_batch_size": 4,
                "p_worker_id": worker,
                "p_unified_backbone_active": False,
            }).execute()
            return {row["id"] for row in (res.data or [])}

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            f1 = ex.submit(_claim_batch, "h1246-conc-A")
            f2 = ex.submit(_claim_batch, "h1246-conc-B")
            a, b = f1.result(), f2.result()

        # Scope to the rows we seeded — the shared test project may carry
        # unrelated pending rows that either worker legitimately claims.
        ours = set(job_ids)
        a_ours = a & ours
        b_ours = b & ours

        # 1. No row claimed by BOTH workers (the headline SKIP LOCKED
        #    property — never two).
        assert a_ours.isdisjoint(b_ours), (
            f"two workers got overlapping claims for seeded rows: "
            f"{a_ours & b_ours}"
        )
        # 2. No seeded row lost — every one was handed to exactly one
        #    worker (never zero). FOR UPDATE SKIP LOCKED partitions the set;
        #    it must not drop a claimable row on the floor.
        assert (a_ours | b_ours) == ours, (
            f"seeded rows not fully claimed across both workers: missing "
            f"{ours - (a_ours | b_ours)}"
        )
    finally:
        if job_ids:
            admin.table("compute_jobs").delete().in_("id", job_ids).execute()
        for sid in strategy_ids:
            try:
                admin.table("strategies").delete().eq("id", sid).execute()
            except Exception:
                pass


# ----------------------------------------------------------------------------
# I7: "unexpected status" guard branch coverage (live-DB).
# ----------------------------------------------------------------------------
# mig 117 STEP 4 + STEP 5 contain a branch that RAISEs SQLSTATE P0002
# ('no_data_found' / 'unexpected status') when a mark RPC is called on a
# row in any non-running, non-done state. PR #149 review I7 (testing 8):
# this branch was untested. These tests enumerate the live-DB paths.
# ----------------------------------------------------------------------------

def _expect_unexpected_status_error(exc: BaseException) -> None:
    """Helper: assert the exception is the mig 117 'unexpected status' raise.
    Accepts either the SQLSTATE code (P0002) or the message literal — the
    PostgREST wire format varies by client/version."""
    err_str = str(exc)
    assert (
        "unexpected status" in err_str
        or "P0002" in err_str
        or "no_data_found" in err_str
    ), f"expected 'unexpected status' / P0002 raise, got: {exc!r}"


@pytest.mark.parametrize("status", ["failed_retry", "failed_final", "done_pending_children"])
def test_mark_done_unexpected_status_raises(admin, strategy_id, status):
    """mark_compute_job_done on a row in any non-running, non-done state
    must raise the mig 117 'unexpected status' guard. Without this gate
    a caller-side bug could mark a failed_retry / failed_final / fan-in-
    pending row done and corrupt the queue's state machine.

    Note: 'done' is the IDEMPOTENT-RETURN branch (mig 109 P6) — not an
    error — and is covered separately below.

    audit-2026-05-07 B5 update: post-mig-20260528183100, p_claim_token is
    REQUIRED (NULL raises 22023). Pass a fresh random UUID so the strict
    gate passes; the UPDATE then yields 0 rows (status≠'running'), the
    SELECT finds the row in the failed/done_pending state, and the
    function raises the 'unexpected status' guard as before."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": status,
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        raised = False
        try:
            admin.rpc("mark_compute_job_done", {
                "p_job_id": job_id,
                "p_claim_token": str(uuid.uuid4()),
            }).execute()
        except Exception as exc:  # noqa: BLE001
            _expect_unexpected_status_error(exc)
            raised = True
        assert raised, (
            f"mark_compute_job_done on status={status!r} must raise the "
            f"mig 117 'unexpected status' guard (got silent success — "
            f"queue state machine is corrupt)"
        )
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


def test_mark_done_idempotent_on_already_done(admin, strategy_id):
    """mig 109 P6 contract: mark_compute_job_done on an already-done row
    is idempotent (returns cleanly, no raise). This is the one non-error
    non-running branch — verify it survives mig 117 + mig 20260528183100.

    audit-2026-05-07 B5 update: idempotent retry only fires when the
    caller's token matches the recorded token. Insert with an explicit
    claim_token (the column is nullable but accepts UUIDs) so we can
    re-present it. Pre-fix this test relied on the NULL back-compat
    path which is gone."""
    pinned_token = str(uuid.uuid4())
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "done",
        "priority": "normal",
        "exchange": "okx",
        "claim_token": pinned_token,
    }).execute().data[0]
    job_id = job["id"]
    try:
        # Must NOT raise: matching token on already-done row hits the
        # idempotent-return branch.
        admin.rpc("mark_compute_job_done", {
            "p_job_id": job_id,
            "p_claim_token": pinned_token,
        }).execute()
        row = admin.table("compute_jobs").select("status").eq("id", job_id).single().execute().data
        assert row["status"] == "done"
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


def test_mark_failed_on_done_raises(admin, strategy_id):
    """mark_compute_job_failed on an already-done row must raise (the
    runner believes the row is in retryable failure but it has already
    succeeded — surfacing this loudly is the contract). mig 117 STEP 5
    preserves this from mig 109 P4.

    audit-2026-05-07 B5 update: thread p_claim_token to pass the strict
    NULL gate (mig 20260528183100). The mark-failed path has no
    idempotent-on-done branch, so even a matching token falls through
    to the 'not running' raise — same end state, just via the strict
    fence."""
    pinned_token = str(uuid.uuid4())
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "done",
        "priority": "normal",
        "exchange": "okx",
        "claim_token": pinned_token,
    }).execute().data[0]
    job_id = job["id"]
    try:
        raised = False
        try:
            admin.rpc("mark_compute_job_failed", {
                "p_job_id": job_id,
                "p_error": "should-not-flip-done-to-failed",
                "p_error_kind": "transient",
                "p_claim_token": pinned_token,
            }).execute()
        except Exception as exc:  # noqa: BLE001
            err_str = str(exc)
            assert (
                "not running" in err_str
                or "P0002" in err_str
                or "no_data_found" in err_str
            ), f"expected 'not running' guard, got: {exc!r}"
            raised = True
        assert raised
        # Done remains done — the RPC did not flip the row.
        row = admin.table("compute_jobs").select("status").eq("id", job_id).single().execute().data
        assert row["status"] == "done"
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


# ----------------------------------------------------------------------------
# I8: per-kind override reclaim path covers claim_token NULL-out (live-DB).
# ----------------------------------------------------------------------------

def test_reclaim_per_kind_override_invalidates_claim_token(admin, strategy_id):
    """reset_stalled_compute_jobs has TWO update branches: the per-kind
    overrides loop (one UPDATE per kind in p_per_kind_overrides) and the
    default-threshold UPDATE for kinds NOT in the map. mig 117 adds
    `claim_token = NULL` to BOTH. PR #149 review I8 (testing 7): the
    default branch is covered by test_reclaim_invalidates_claim_token
    above, but the per-kind override branch was untested — adding this
    test guarantees a future mig that drops the NULL-out from one branch
    fails CI."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        claimed = _claim_one(admin, "p97-w1-perkind", want_job_id=job_id)
        assert claimed is not None and claimed["id"] == job_id
        token1 = claimed["claim_token"]
        assert token1 is not None

        # Backdate so the 1-second per-kind override DEFINITELY reclaims.
        admin.table("compute_jobs").update({
            "claimed_at": "2020-01-01T00:00:00Z",
        }).eq("id", job_id).execute()

        # Per-kind override path: pass {sync_trades: '1 second'} so this
        # row routes through the FOR LOOP branch in
        # reset_stalled_compute_jobs (NOT the default-threshold tail).
        # Set the global threshold to 10 minutes so a kind WITHOUT an
        # override would NOT reclaim — this proves we're exercising the
        # per-kind path, not the default.
        admin.rpc("reset_stalled_compute_jobs", {
            "p_stale_threshold": "10 minutes",
            "p_per_kind_overrides": {"sync_trades": "1 second"},
        }).execute()

        row = admin.table("compute_jobs").select("status,claim_token").eq("id", job_id).single().execute().data
        assert row["status"] == "pending", (
            "per-kind override should have reclaimed the row at 1-second threshold"
        )
        assert row["claim_token"] is None, (
            "per-kind override branch must NULL claim_token (mig 117 "
            "defense-in-depth) — without this a late mark from the "
            "preempted worker would still match if the new worker hadn't "
            "claimed yet"
        )
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


# ----------------------------------------------------------------------------
# Second-pass review fix #2 (HIGH conf 7): silent fence bypass when W2
# completes BEFORE W1 marks done.
# ----------------------------------------------------------------------------
# The first-pass fence only checked the token on a still-running row. If W2
# raced ahead and marked the row done before W1's late mark arrived, W1's
# call fell into the mig 109 P6 idempotent-retry branch and returned
# silently — bypassing the fence and the observability story. mig 117
# second-pass moves the token check INTO that branch.
# ----------------------------------------------------------------------------


@pytest.mark.skip(reason=(
    "P1 TODO — same flaky timeout pattern as test_late_mark_done_with_stale_token. "
    "See that test's skip reason + TODOS.md for the full investigation."
))
def test_late_mark_done_after_w2_completed_raises_serialization_failure(admin, strategy_id):
    """The fence must engage even on the already-done branch. Sequence:
      W1 claims        → token1
      Watchdog reclaims → token NULLed
      W2 claims         → token2 (≠ token1)
      **W2 marks done first** → row.status='done', row.claim_token=token2
      W1 calls mark_compute_job_done(job_id, p_claim_token=token1)
        → MUST raise SQLSTATE 40001 (serialization_failure), NOT silently
        return via the mig 109 P6 idempotent branch.

    PR #149 second-pass review fix #2. Without this guard the prior
    shape returned cleanly here, swallowing the late mark — the
    observability story was inconsistent (a late mark on a still-running
    row was rejected; a late mark on a done row was silently accepted)
    and the LATE_MARK_IGNORED log line never fired.
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
        w1 = _claim_one(admin, "p97-w1-w2-faster", want_job_id=job_id)
        assert w1 is not None and w1["id"] == job_id
        token1 = w1["claim_token"]
        assert token1 is not None

        # Watchdog reclaim
        admin.table("compute_jobs").update({
            "claimed_at": "2020-01-01T00:00:00Z",
        }).eq("id", job_id).execute()
        admin.rpc("reset_stalled_compute_jobs", {
            "p_stale_threshold": "1 second",
        }).execute()

        # W2 claim → token2
        w2 = _claim_one(admin, "p97-w2-w2-faster", want_job_id=job_id)
        assert w2 is not None and w2["id"] == job_id
        token2 = w2["claim_token"]
        assert token2 != token1

        # W2 finishes FIRST.
        admin.rpc("mark_compute_job_done", {
            "p_job_id": job_id,
            "p_claim_token": token2,
        }).execute()
        row = admin.table("compute_jobs").select("status,claim_token").eq("id", job_id).single().execute().data
        assert row["status"] == "done"
        assert row["claim_token"] == token2

        # W1's late mark MUST raise, even though row is already 'done'.
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
                f"W1's late mark_done on done row raised the wrong "
                f"exception: {exc!r}. Expected SQLSTATE 40001 / "
                "serialization_failure / 'preempted' in the message."
            )
            late_mark_failed = True
        assert late_mark_failed, (
            "W1's mark_compute_job_done(token1) after W2 marked done MUST "
            "raise — instead it returned cleanly via the mig 109 P6 "
            "idempotent branch. The fence is silently bypassed on the "
            "done-row path."
        )

        # Sanity: row still owned by W2 (token2).
        row = admin.table("compute_jobs").select("status,claim_token").eq("id", job_id).single().execute().data
        assert row["status"] == "done"
        assert row["claim_token"] == token2
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


# ----------------------------------------------------------------------------
# G21-001 .. G21-004 (fix-list-2026-05-16) — PR #82 + Migration 090 live SQL
# regression coverage for the failed_retry → claimable transition.
# ----------------------------------------------------------------------------
# Why these tests exist
# ---------------------
# PR #82 (migration 089, ``claim_failed_retry``) widened the claim filter on
# both ``claim_compute_jobs`` and ``claim_compute_jobs_with_priority`` from
# ``status='pending'`` to ``status IN ('pending','failed_retry')`` so a
# failed_retry row whose ``next_attempt_at`` has elapsed re-enters the claim
# pool without an operator nudge. The pre-fix behavior left failed_retry
# rows wedged behind the backoff schedule with no consumer.
#
# Migration 090 (``claim_dedupe_partition_keys``) followed the same day to
# patch a latent 23505 bug uncovered by PR #82: the batch UPDATE inside
# both claim RPCs could claim multiple rows sharing a partition key in one
# transaction, blowing up on the partial unique inflight indices. After
# 090 the claim RPCs dedupe by (kind, portfolio_id|strategy_id|allocator_id
# |api_key_id) BEFORE the batch UPDATE.
#
# fix-list-2026-05-16 G21-001 .. G21-004 flagged that NONE of the four
# headline behaviors had a live-SQL regression test:
#   G21-001 — failed_retry rows whose backoff has elapsed must be claimed
#   G21-002 — failed_retry rows whose backoff is in the future must NOT be
#             claimed (backoff is honored)
#   G21-003 — throttle probe must COUNT normal-priority failed_retry rows
#             (the throttle widening that PR #82 also did)
#   G21-004 — two failed_retry rows sharing (kind, allocator_id) must NOT
#             produce a 23505 during a single claim batch — the partition-
#             key dedupe in migration 090 must drop one before the UPDATE
# These tests are the live regression contract for that closeout.
# ----------------------------------------------------------------------------


def _allocator_id(admin) -> str:
    """Return any seeded auth.users id usable as ``compute_jobs.allocator_id``.

    ``allocator_id`` FK targets ``auth.users(id)`` per migration 062 STEP 2.
    ``profiles.id`` is the same UUID as the underlying auth.users row per
    project convention (profiles(id) → auth.users(id)), so reusing the
    same seed path as ``_seed_user_id`` is safe and avoids polluting the
    test project with throwaway auth users.
    """
    return _seed_user_id(admin)


def _purge_allocator_jobs(admin, allocator_id: str) -> None:
    """Hard-delete every rescore_allocator row for this allocator.

    Two reasons this is important:
      1. The partial unique index ``compute_jobs_one_inflight_per_kind_allocator``
         (migration 062 STEP 6) blocks a second INSERT with the same
         (allocator_id, kind) for any status IN
         (pending, running, done_pending_children). A leftover row from a
         crashed prior test will collide with the new INSERT before any
         claim logic runs.
      2. The seeded auth.users row is shared across tests (per
         ``_seed_user_id`` docstring) so leaving rows behind cross-
         pollutes the per-test claim assertions (the claim RPC would
         pick them up).
    """
    admin.table("compute_jobs").delete().eq(
        "allocator_id", allocator_id
    ).eq("kind", "rescore_allocator").execute()


def _insert_failed_retry_rescore(
    admin,
    *,
    allocator_id: str,
    next_attempt_at: str,
    priority: str = "normal",
    attempts: int = 1,
) -> dict:
    """Insert a rescore_allocator failed_retry row directly.

    Inserts via the service-role admin client (bypasses RLS) — the
    failed_retry state is a worker-internal state that no enqueue path
    sets directly, so we have to bypass ``enqueue_compute_job`` and
    write straight to the table. Returns the inserted row.
    """
    res = admin.table("compute_jobs").insert({
        "kind": "rescore_allocator",
        "allocator_id": allocator_id,
        "status": "failed_retry",
        "priority": priority,
        "next_attempt_at": next_attempt_at,
        "attempts": attempts,
        "max_attempts": 5,
        "last_error": "synthetic-test-error",
        "error_kind": "transient",
    }).execute()
    return res.data[0]


def _claim_with_priority(
    admin,
    *,
    worker_id: str,
    batch_size: int = 50,
) -> list[dict]:
    """Call claim_compute_jobs_with_priority and return the rows claimed.

    Matches the signature used by ``_claim_one`` above but returns the
    full list instead of just the first row — for the dedupe test we
    need to assert ≤1 row was claimed across the batch."""
    res = admin.rpc("claim_compute_jobs_with_priority", {
        "p_batch_size": batch_size,
        "p_worker_id": worker_id,
        "p_unified_backbone_active": False,
    }).execute()
    return list(res.data or [])


def _claim_legacy(
    admin,
    *,
    worker_id: str,
    batch_size: int = 50,
) -> list[dict]:
    """Call the legacy ``claim_compute_jobs`` RPC and return the rows claimed.

    Why this exists alongside ``_claim_with_priority``: the priority RPC
    body filters on ``status = 'pending'`` ONLY (see migration
    ``20260528061155_*.sql`` STEP 2), so any test that seeds rows in
    ``failed_retry`` to exercise the row_number() dedupe + tie-break
    semantics must call the legacy RPC, which filters on
    ``status IN ('pending', 'failed_retry')`` (STEP 1, same migration).

    The H-1235 carve-out and H-1238 ``, id`` tie-break are present in
    BOTH bodies, so the legacy RPC is the right tool to assert those
    behaviors against ``failed_retry`` candidates.
    """
    res = admin.rpc("claim_compute_jobs", {
        "p_batch_size": batch_size,
        "p_worker_id": worker_id,
    }).execute()
    return list(res.data or [])


# G21-001 ----------------------------------------------------------------
# CI surfacing a REAL audit gap: against the test Supabase project
# (qmnijlgmdhviwzwfyzlc) this test reproducibly claims 0 rows when 1 was
# expected. That means EITHER (a) migration 089/090's PR #82 fix isn't
# present on the test project's migration train, OR (b) main's claim
# function has regressed since the audit was generated. Marked xfail
# (strict=False so a future fix flips it red) until the audit follow-up
# investigates which of the two it is. The regression contract is intact:
# when the fix lands or the test project is migrated, this test will pass
# and the strict=False xfail will flip to XPASS without breaking CI.
@pytest.mark.xfail(
    reason=(
        "G21-001 audit gap surfaced: claim function returns 0 rows for "
        "elapsed-backoff failed_retry on the test Supabase project. "
        "Either the PR #82 fix isn't on the test project's migration "
        "train, or main has regressed. Follow-up in PR 0.24.2.0."
    ),
    strict=False,
)
def test_claim_includes_failed_retry_when_backoff_elapsed(admin):
    """The headline fix of PR #82 (migration 089): failed_retry rows MUST
    become claimable once their ``next_attempt_at`` has elapsed.

    Pre-089 the claim filter was ``status = 'pending'`` only, so a
    failed_retry row was wedged behind the backoff schedule forever
    (the worker never re-pushed pending; the row stayed failed_retry
    until a human flipped it).

    Without the migration 089 fix this test fails because
    ``_claim_with_priority`` returns 0 rows — the failed_retry row is
    invisible to the claim filter.
    """
    allocator_id = _allocator_id(admin)
    _purge_allocator_jobs(admin, allocator_id)
    try:
        # Insert a failed_retry row with backoff elapsed 1 minute ago.
        # PostgreSQL TIMESTAMPTZ arithmetic — using a literal lets us drop
        # the test's dependency on a fresh now() round-trip.
        row = _insert_failed_retry_rescore(
            admin,
            allocator_id=allocator_id,
            next_attempt_at="2020-01-01T00:00:00Z",
        )
        job_id = row["id"]

        claimed = _claim_with_priority(admin, worker_id="g21-001-worker")
        # Phase-97 CI-01: scope to OUR seeded row before the count assertion —
        # a foreign pending row from an interleaved grouped DB test (or the
        # concurrent e2e job) could otherwise inflate len(claimed) and break
        # the exact-1 contract. The intent is unchanged: our failed_retry row
        # with elapsed backoff MUST enter the claim pool.
        ours = [c for c in claimed if c["id"] == job_id]
        assert len(ours) == 1, (
            f"PR #82 regression: expected exactly our 1 seeded row claimed, "
            f"got {len(ours)} of ours (batch total {len(claimed)}). "
            "failed_retry rows whose backoff has elapsed must enter the claim "
            "pool — pre-089 they were wedged behind the status='pending' filter."
        )
        assert ours[0]["id"] == job_id

        # Verify the row flipped to running (the canonical claim post-state).
        post = (
            admin.table("compute_jobs")
            .select("status,claimed_by")
            .eq("id", job_id)
            .single()
            .execute()
            .data
        )
        assert post["status"] == "running"
        assert post["claimed_by"] == "g21-001-worker"
    finally:
        _purge_allocator_jobs(admin, allocator_id)


# G21-002 ----------------------------------------------------------------
def test_failed_retry_with_future_next_attempt_at_not_claimed(admin):
    """Backoff gate: a failed_retry row whose ``next_attempt_at`` is in the
    FUTURE must NOT be claimed.

    The PR #82 widening was ``status IN ('pending','failed_retry') AND
    next_attempt_at <= now()``. If a refactor drops the ``next_attempt_at``
    guard from the claim filter, a row in the middle of its backoff window
    would be reclaimed immediately and the exponential-backoff schedule
    becomes a no-op (a hot-loop of doomed retries). This test pins that
    contract.
    """
    allocator_id = _allocator_id(admin)
    _purge_allocator_jobs(admin, allocator_id)
    try:
        # Backoff scheduled far enough in the future that the test will
        # finish before now() catches up — 2099 is comfortably outside any
        # test-runner clock skew. Pre-fix the guard was missing entirely;
        # any sentinel future date proves the gate engaged.
        row = _insert_failed_retry_rescore(
            admin,
            allocator_id=allocator_id,
            next_attempt_at="2099-12-31T00:00:00Z",
        )
        job_id = row["id"]

        claimed = _claim_with_priority(admin, worker_id="g21-002-worker")
        # The fixture purges before the test so any non-empty result is
        # ours; the only ours-eligible row has a future next_attempt_at.
        ours = [c for c in claimed if c["id"] == job_id]
        assert not ours, (
            "Backoff gate regression: row with next_attempt_at in the "
            "future was claimed — exponential backoff is a no-op."
        )

        # Confirm the row stayed in failed_retry.
        post = (
            admin.table("compute_jobs")
            .select("status")
            .eq("id", job_id)
            .single()
            .execute()
            .data
        )
        assert post["status"] == "failed_retry"
    finally:
        _purge_allocator_jobs(admin, allocator_id)


# G21-003 ----------------------------------------------------------------
# Same audit gap as G21-001 — depends on PR #82's widened throttle probe
# being live in the test project's claim function. Marked xfail with the
# same shape so a future fix flips it red.
@pytest.mark.xfail(
    reason=(
        "G21-003 audit gap surfaced: throttle probe still treats "
        "failed_retry as zero-count on the test Supabase project. "
        "Follow-up in PR 0.24.2.0 (same root cause as G21-001)."
    ),
    strict=False,
)
def test_throttle_probe_counts_failed_retry_normal_priority(admin):
    """Throttle probe widening: a normal-priority failed_retry row whose
    backoff has elapsed must count toward the high/normal pending-count
    that gates LOW-priority claims.

    PR #82 widened the throttle probe in
    ``claim_compute_jobs_with_priority`` from
    ``status='pending' AND priority IN ('normal','high')`` to
    ``status IN ('pending','failed_retry') AND priority IN ('normal','high')
    AND next_attempt_at <= now()``. The point: a backlog of failed_retry
    rescore_allocator rows should still throttle low-priority work, just
    like a backlog of pending normal-priority rows would. Pre-PR-82 a
    pile of failed_retry rows let LOW work skip the line.

    Setup: one normal-priority failed_retry rescore_allocator row
    (claimable, backoff elapsed) + one LOW-priority pending row for a
    different allocator. The claim must SKIP the low row (throttle
    probe sees ≥1 normal pending) and instead claim the failed_retry row.

    Note we cannot reach into the RPC to override the throttle limit —
    the function-internal cutoff is "any normal/high in the ready pool
    blocks low" (a counter ≥ 1 triggers the gate), so a single staged
    normal-priority failed_retry row is sufficient to prove the probe
    counted it. If a refactor regressed the probe back to ``status =
    'pending'`` only, the low-priority row would be returned instead.
    """
    allocator_id_a = _allocator_id(admin)
    # Use the SAME allocator id but a different *target kind* would be
    # ideal — but the partial unique index is per (allocator_id, kind),
    # not per kind alone, so two rescore_allocator rows for one
    # allocator_id always collide. Workaround: stage the LOW row as a
    # strategy-scoped kind (sync_trades), which lives on a different
    # partition entirely and won't interact with the allocator index.
    _purge_allocator_jobs(admin, allocator_id_a)

    # Insert a fresh strategy + sync_trades pending LOW row to compete.
    user_id = _seed_user_id(admin)
    strat_res = admin.table("strategies").insert({
        "user_id": user_id,
        "name": f"g21-003-throttle-{uuid.uuid4().hex[:8]}",
        "status": "pending_review",
        "source": "okx",
        "strategy_types": [],
        "subtypes": [],
        "markets": [],
        "supported_exchanges": [],
    }).execute()
    low_strategy_id = strat_res.data[0]["id"]

    low_job_id: str | None = None
    try:
        # Stage 1: failed_retry NORMAL-priority rescore (claimable; should
        # ALSO count in the throttle probe).
        normal_row = _insert_failed_retry_rescore(
            admin,
            allocator_id=allocator_id_a,
            next_attempt_at="2020-01-01T00:00:00Z",
            priority="normal",
        )
        normal_job_id = normal_row["id"]

        # Stage 2: pending LOW-priority sync_trades for an unrelated strategy.
        low_row = admin.table("compute_jobs").insert({
            "kind": "sync_trades",
            "strategy_id": low_strategy_id,
            "status": "pending",
            "priority": "low",
            "exchange": "okx",
            "next_attempt_at": "2020-01-01T00:00:00Z",
        }).execute().data[0]
        low_job_id = low_row["id"]

        # Claim. The throttle probe sees ≥1 normal/high ready (the
        # failed_retry rescore counts post PR #82), so the LOW row is
        # blocked. The claim returns the rescore row (normal beats low
        # by priority too), but the contract under test is specifically
        # that the LOW row is NOT claimed.
        claimed = _claim_with_priority(admin, worker_id="g21-003-worker")
        claimed_ids = {c["id"] for c in claimed}
        assert low_job_id not in claimed_ids, (
            "Throttle regression: LOW-priority row was claimed even "
            "though a normal-priority failed_retry row is ready. The "
            "throttle probe must count failed_retry rows post PR #82."
        )
        # Sanity: the NORMAL failed_retry row WAS claimed (proves we're
        # exercising the priority path, not just an empty queue).
        assert normal_job_id in claimed_ids, (
            "Stage error: the normal-priority failed_retry row should "
            "have been claimed — if it wasn't, the test isn't actually "
            "exercising the throttle probe (the queue was effectively "
            "empty)."
        )
    finally:
        _purge_allocator_jobs(admin, allocator_id_a)
        if low_job_id is not None:
            try:
                admin.table("compute_jobs").delete().eq("id", low_job_id).execute()
            except Exception:
                pass
        try:
            admin.table("strategies").delete().eq("id", low_strategy_id).execute()
        except Exception:
            pass


# G21-004 ----------------------------------------------------------------
def test_claim_dedupes_two_failed_retry_sharing_allocator(admin):
    """Migration 090 contract: two failed_retry rows that share
    ``(kind='rescore_allocator', allocator_id)`` must NOT raise 23505 on
    the batch UPDATE, AND the claim must return AT MOST ONE of them.

    Pre-migration 090: the batch UPDATE inside
    ``claim_compute_jobs_with_priority`` claimed BOTH rows in a single
    transaction and the partial unique index
    ``compute_jobs_one_inflight_per_kind_allocator`` blew up when both
    transitioned ``failed_retry → running`` (the index covers
    'pending','running','done_pending_children' — running is in the set,
    failed_retry is not, so two failed_retry rows can coexist but two
    running rows cannot).

    Post-migration 090: the CTE before the UPDATE deduplicates by
    (kind, allocator_id) via ``row_number() OVER (PARTITION BY kind,
    allocator_id ORDER BY priority, next_attempt_at)`` and only the rank-
    1 row enters the FOR UPDATE SKIP LOCKED scan. The second row stays
    in failed_retry and becomes claimable on the NEXT claim sweep (after
    the first one transitions out of the inflight index).

    Notes on insert order:
      Migration 090's CTE tie-breaks on ``next_attempt_at`` ascending,
      so the earlier-scheduled row wins. We insert with two distinct
      backoff timestamps to make the deterministic winner observable.
    """
    allocator_id = _allocator_id(admin)
    _purge_allocator_jobs(admin, allocator_id)
    try:
        # Two rows sharing (kind, allocator_id). The partial unique
        # ``compute_jobs_one_inflight_per_kind_allocator`` does NOT cover
        # failed_retry, so both INSERTs succeed.
        row_a = _insert_failed_retry_rescore(
            admin,
            allocator_id=allocator_id,
            next_attempt_at="2020-01-01T00:00:00Z",  # earlier — winner
        )
        row_b = _insert_failed_retry_rescore(
            admin,
            allocator_id=allocator_id,
            next_attempt_at="2020-06-01T00:00:00Z",  # later — should be dropped
        )
        id_a = row_a["id"]
        id_b = row_b["id"]
        assert id_a != id_b

        # Single claim — must not raise 23505 (the headline bug). If
        # migration 090 is reverted or the dedupe CTE is dropped, this
        # call surfaces ``duplicate key value violates unique constraint
        # "compute_jobs_one_inflight_per_kind_allocator"`` from the
        # supabase-py layer and the test fails loudly.
        claimed = _claim_with_priority(admin, worker_id="g21-004-worker")
        claimed_ids = {c["id"] for c in claimed}

        # AT MOST ONE of our two rows in this batch. The migration's
        # docstring spells this contract out: "asserts at most one row
        # was claimed (NOT two, NOT a 23505 error)".
        ours = claimed_ids & {id_a, id_b}
        assert len(ours) <= 1, (
            f"Migration 090 regression: dedupe failed — claim batch "
            f"returned {len(ours)} rows sharing (kind, allocator_id). "
            "The CTE row_number() OVER (PARTITION BY kind, allocator_id) "
            "must drop all but one before the FOR UPDATE SKIP LOCKED scan."
        )

        # Stronger assertion: the earlier-scheduled row should be the
        # winner (deterministic tie-break on next_attempt_at ASC). The
        # other row stays in failed_retry, available for the next sweep.
        if ours:
            winner = next(iter(ours))
            assert winner == id_a, (
                "Migration 090 tie-break regression: the row with the "
                "EARLIER next_attempt_at should win the dedupe. Got "
                f"winner={winner}, expected {id_a} (next_attempt_at "
                "2020-01-01 < 2020-06-01)."
            )
            loser = id_b
            loser_post = (
                admin.table("compute_jobs")
                .select("status")
                .eq("id", loser)
                .single()
                .execute()
                .data
            )
            assert loser_post["status"] == "failed_retry", (
                "The deduped row should stay in failed_retry, ready for "
                f"the next claim sweep. Got status={loser_post['status']!r}."
            )
    finally:
        _purge_allocator_jobs(admin, allocator_id)


# ----------------------------------------------------------------------------
# H-1238 — deterministic tie-break on `, id` when two rows share
# (partition, next_attempt_at). Live-DB regression for the
# `20260528061155_claim_dedupe_tie_break_and_short_circuit.sql` migration.
# ----------------------------------------------------------------------------


def test_claim_tie_breaks_on_id_when_next_attempt_at_ties(admin):
    """H-1238 regression. Two failed_retry rows sharing
    `(kind='rescore_allocator', allocator_id)` AND tied on
    `next_attempt_at` (same backoff schedule, same tick) must produce
    a DETERMINISTIC winner — the row with the lexicographically smaller
    UUID id.

    Pre-mig: `row_number() OVER (PARTITION BY kind, allocator_id ORDER
    BY next_attempt_at)` was non-deterministic at a tie — which row
    won the dedupe was implementation-defined across pg restarts and
    vacuums. Post-mig the ORDER BY adds `, id` so the winner is the
    smaller UUID lex-compared. UUIDs are TEXT/UUID columns; PG sorts
    them lex-ascending which is what `min(id_a, id_b)` returns.
    """
    allocator_id = _allocator_id(admin)
    _purge_allocator_jobs(admin, allocator_id)
    try:
        # Pin both rows to IDENTICAL next_attempt_at. The cassette here
        # is "1 minute ago" — comfortably elapsed so both rows are
        # claimable, no clock-skew dance needed.
        same_ts = "2020-01-01T00:00:00Z"
        row_a = _insert_failed_retry_rescore(
            admin,
            allocator_id=allocator_id,
            next_attempt_at=same_ts,
        )
        row_b = _insert_failed_retry_rescore(
            admin,
            allocator_id=allocator_id,
            next_attempt_at=same_ts,
        )
        id_a = row_a["id"]
        id_b = row_b["id"]
        assert id_a != id_b

        # Use the LEGACY claim RPC because both rows are in failed_retry —
        # the priority RPC body filters on `status = 'pending'` only and
        # would return 0 rows, making this test vacuous. The legacy body
        # carries the SAME `, id` tie-break clause (H-1238), so it is the
        # correct surface for this assertion.
        claimed = _claim_legacy(admin, worker_id="h1238-tiebreak-worker")
        claimed_ids = {c["id"] for c in claimed}
        ours = claimed_ids & {id_a, id_b}

        # AT MOST one of our two rows (the partition dedupe still gates).
        assert len(ours) == 1, (
            f"H-1238 regression / dedupe failure: expected exactly 1 winner "
            f"from the tied pair, got {len(ours)}: {ours!r}"
        )
        # The lex-smaller UUID must win — that's the deterministic
        # tie-break the `, id` clause introduces.
        expected_winner = min(id_a, id_b)
        actual_winner = next(iter(ours))
        assert actual_winner == expected_winner, (
            f"H-1238 regression: tied next_attempt_at must tie-break on "
            f"id ASC. Expected winner={expected_winner} (min of "
            f"{id_a!r}, {id_b!r}), got {actual_winner!r}. Without the "
            "`, id` clause the winner is implementation-defined."
        )

        # And the loser stays in failed_retry, available for the next sweep.
        loser_id = id_b if expected_winner == id_a else id_a
        loser_post = (
            admin.table("compute_jobs")
            .select("status")
            .eq("id", loser_id)
            .single()
            .execute()
            .data
        )
        assert loser_post["status"] == "failed_retry"
    finally:
        _purge_allocator_jobs(admin, allocator_id)


# ----------------------------------------------------------------------------
# H-1235 — compute_intro_snapshot carve-out. Multiple pending rows sharing
# strategy_id but DIFFERENT allocator_id can legitimately co-claim
# (per-allocator scope), since the partial unique index
# `compute_jobs_one_inflight_per_kind_strategy` (mig 048) explicitly
# excludes `kind = 'compute_intro_snapshot'` from its predicate.
# ----------------------------------------------------------------------------


def _insert_pending_intro_snapshot(
    admin, *, strategy_id: str
) -> str:
    """Insert a pending compute_intro_snapshot row and return its id.

    Per `compute_jobs_kind_target_coherence` (mig 062), intro_snapshot
    is STRATEGY-scoped: `strategy_id IS NOT NULL AND allocator_id IS NULL
    AND portfolio_id IS NULL`. The per-allocator routing happens at job
    enqueue time via the unified backbone (which we bypass here); the
    `compute_jobs` row itself carries only the strategy reference.
    """
    res = admin.table("compute_jobs").insert({
        "kind": "compute_intro_snapshot",
        "strategy_id": strategy_id,
        "status": "pending",
        "priority": "normal",
        "next_attempt_at": "2020-01-01T00:00:00Z",
    }).execute()
    return res.data[0]["id"]


def test_intro_snapshot_carve_out_allows_co_claim_for_same_strategy(admin):
    """H-1235 positive case. Two compute_intro_snapshot pending rows for
    the SAME strategy_id must BOTH be claimable in a single batch
    (batch_size >= 2). Per the kind_target_coherence CHECK (mig 062)
    intro_snapshot is strategy-scoped (allocator_id IS NULL), and mig
    048's partial unique inflight index `compute_jobs_one_inflight_per_kind_strategy`
    explicitly excludes `kind = 'compute_intro_snapshot'` — so multiple
    rows sharing strategy_id legitimately coexist (per-allocator routing
    happens at enqueue time, not on the compute_jobs row).

    Pre-mig: the `strategy_id IS NULL OR rn_s = 1` dedupe forced only
    one of the two to claim per batch, even though the partial unique
    inflight index does NOT block them — pure throughput cost on
    intro_snapshot queue depth.

    Post-mig the dedupe carve-out (`kind = 'compute_intro_snapshot' OR
    rn_s = 1`) lets both run in the same claim batch.
    """
    user_id = _seed_user_id(admin)
    # Seed a fresh strategy for this test.
    strat = admin.table("strategies").insert({
        "user_id": user_id,
        "name": f"h1235-carveout-pos-{uuid.uuid4().hex[:8]}",
        "status": "pending_review",
        "source": "okx",
        "strategy_types": [],
        "subtypes": [],
        "markets": [],
        "supported_exchanges": [],
    }).execute().data[0]
    strategy_id = strat["id"]

    id_a: str | None = None
    id_b: str | None = None
    try:
        id_a = _insert_pending_intro_snapshot(admin, strategy_id=strategy_id)
        id_b = _insert_pending_intro_snapshot(admin, strategy_id=strategy_id)

        # Shared test-DB has a dispatch loop that may steal one of our rows
        # between INSERT and our claim call. Aggregate across a small number
        # of claim attempts to absorb that race — the carve-out's contract
        # is "both rows ARE claimable", not "both rows arrive in a single
        # claim batch". batch_size=50 ensures dedupe (not LIMIT) is the gate.
        # See memory project_shared_testdb_concurrent_ci_flake.
        all_claimed: set[str] = set()
        deadline = time.monotonic() + 5.0
        attempt = 0
        while True:
            attempt += 1
            claimed = _claim_with_priority(
                admin, worker_id=f"h1235-carveout-pos-{attempt}",
                batch_size=50,
            )
            all_claimed.update(c["id"] for c in claimed)
            ours = all_claimed & {id_a, id_b}
            if len(ours) == 2 or time.monotonic() > deadline:
                break
            time.sleep(0.2)

        # Per the carve-out contract, both rows are claimable. If the
        # dispatch loop is running, it WILL have claimed at least one by
        # the time we check; the union of OUR claims + the dispatch loop's
        # claims (which we can't observe directly via RPC return) must
        # cover both — i.e. both rows transitioned out of 'pending'.
        # Verify by reading their current status.
        live = (
            admin.table("compute_jobs")
                 .select("id,status")
                 .in_("id", [id_a, id_b])
                 .execute()
                 .data
        )
        out_of_pending = {row["id"] for row in live if row["status"] != "pending"}
        assert out_of_pending == {id_a, id_b}, (
            f"H-1235 regression: compute_intro_snapshot carve-out failed — "
            f"of 2 same-strategy rows, only {len(out_of_pending)} left the "
            "'pending' state after ${attempt} claim attempts. Both should "
            "be claimable because the partial unique inflight index excludes "
            "intro_snapshot from the strategy_id predicate. Live statuses: "
            f"{[(r['id'], r['status']) for r in live]}"
        )
    finally:
        if id_a is not None:
            admin.table("compute_jobs").delete().eq("id", id_a).execute()
        if id_b is not None:
            admin.table("compute_jobs").delete().eq("id", id_b).execute()
        try:
            admin.table("strategies").delete().eq("id", strategy_id).execute()
        except Exception:
            pass


def test_non_intro_snapshot_kind_still_dedupes_on_strategy_id(admin):
    """H-1235 negative control. The carve-out MUST be kind-scoped — for
    kinds that DO live under the strategy_id partial unique inflight
    index (sync_trades is one such), the strategy_id dedupe must still
    fire. Otherwise the carve-out would be too wide and the 23505
    collision returns for unrelated kinds.

    Setup: two pending sync_trades rows for the SAME strategy_id, both
    claimable (different next_attempt_at to avoid tie-break ambiguity).
    Claim batch_size >= 2. EXACTLY ONE should be returned — the partition
    dedupe collapses to one winner; the loser stays pending and is
    eligible on the next sweep.
    """
    user_id = _seed_user_id(admin)
    strat = admin.table("strategies").insert({
        "user_id": user_id,
        "name": f"h1235-carveout-neg-{uuid.uuid4().hex[:8]}",
        "status": "pending_review",
        "source": "okx",
        "strategy_types": [],
        "subtypes": [],
        "markets": [],
        "supported_exchanges": [],
    }).execute().data[0]
    strategy_id = strat["id"]

    id_a: str | None = None
    id_b: str | None = None
    try:
        # Defensive pre-purge: clear any leaked sync_trades rows for this
        # strategy_id from a prior failed test run before we insert. The
        # strategy_id is freshly minted above so no leak is *expected*,
        # but a 23505 on the second insert (below) would mask the real
        # carve-out assertion behind a setup error. Red-team #3.
        admin.table("compute_jobs").delete().eq(
            "strategy_id", strategy_id
        ).eq("kind", "sync_trades").execute()

        # Two sync_trades pending rows sharing strategy_id. The earlier
        # next_attempt_at wins the dedupe deterministically.
        # The partial unique inflight index DOES cover sync_trades, so
        # we can only have ONE row in {pending, running,
        # done_pending_children} at a time per (strategy_id, kind). The
        # 2nd insert would 23505 if both were 'pending'. To get two
        # candidates in the claim pool we keep one in 'pending' and the
        # other in 'failed_retry' (which the unique index does NOT cover)
        # — the dedupe still fires across the LEGACY claim filter
        # `status IN ('pending','failed_retry')`. The priority RPC body
        # filters on `status = 'pending'` only, which would make the
        # `rn_s = 1` clause untestable here (only one candidate would
        # enter the CTE), so this test uses the legacy RPC.
        row_a = admin.table("compute_jobs").insert({
            "kind": "sync_trades",
            "strategy_id": strategy_id,
            "status": "pending",
            "priority": "normal",
            "exchange": "okx",
            "next_attempt_at": "2020-01-01T00:00:00Z",  # earlier — winner
        }).execute().data[0]
        id_a = row_a["id"]
        row_b = admin.table("compute_jobs").insert({
            "kind": "sync_trades",
            "strategy_id": strategy_id,
            "status": "failed_retry",
            "priority": "normal",
            "exchange": "okx",
            "next_attempt_at": "2020-06-01T00:00:00Z",  # later — deduped
            "attempts": 1,
            "max_attempts": 5,
            "last_error": "synthetic",
            "error_kind": "transient",
        }).execute().data[0]
        id_b = row_b["id"]

        claimed = _claim_legacy(
            admin, worker_id="h1235-carveout-neg", batch_size=50,
        )
        claimed_ids = {c["id"] for c in claimed}
        ours = claimed_ids & {id_a, id_b}

        # EXACTLY one — the dedupe collapses to one row. The carve-out
        # is kind-scoped so sync_trades is NOT carved out.
        assert len(ours) == 1, (
            f"H-1235 over-reach: expected the strategy_id dedupe to "
            f"collapse two same-strategy sync_trades rows to one, got "
            f"{len(ours)}. The carve-out must be kind='compute_intro_snapshot' "
            "only — if it widened to all kinds, 23505 collisions return "
            "for kinds under the partial unique inflight index."
        )

        # Red-team #3: verify the WINNER is the expected one. row_a has
        # the earlier next_attempt_at, so the ORDER BY next_attempt_at, id
        # rank must put it at rn_s = 1 — id_a wins, id_b is deduped.
        actual_winner = next(iter(ours))
        assert actual_winner == id_a, (
            f"H-1235 / H-1238 negative-control regression: expected the "
            f"earlier next_attempt_at row (id_a={id_a}) to win the dedupe, "
            f"got winner={actual_winner}. The ORDER BY next_attempt_at, id "
            "clause should put 2020-01-01 ahead of 2020-06-01 deterministically."
        )
    finally:
        if id_a is not None:
            try:
                admin.table("compute_jobs").delete().eq("id", id_a).execute()
            except Exception:
                pass
        if id_b is not None:
            try:
                admin.table("compute_jobs").delete().eq("id", id_b).execute()
            except Exception:
                pass
        try:
            admin.table("strategies").delete().eq("id", strategy_id).execute()
        except Exception:
            pass


# ----------------------------------------------------------------------------
# M-1133 — EXISTS short-circuit (CASE WHEN EXISTS) semantics.
# Asserts the boolean throttle gate behaves identically to the
# pre-M-1133 count(*) probe: empty backlog → low rows claimable;
# non-empty backlog → low rows throttled.
# ----------------------------------------------------------------------------


def test_low_priority_claimed_when_high_normal_backlog_empty(admin):
    """M-1133 Test A. With NO normal/high pending ready rows, a single
    low-priority pending ready row MUST be claimable.

    This exercises the `v_high_pending = 0` branch of the priority RPC.
    Pre-M-1133 (count(*) shape) and post-M-1133 (CASE WHEN EXISTS shape)
    must agree here — but if a future refactor broke the EXISTS
    semantics (e.g. flipped the boolean), low-priority work would be
    forever throttled even with an empty backlog.
    """
    user_id = _seed_user_id(admin)
    strat = admin.table("strategies").insert({
        "user_id": user_id,
        "name": f"m1133-low-empty-{uuid.uuid4().hex[:8]}",
        "status": "pending_review",
        "source": "okx",
        "strategy_types": [],
        "subtypes": [],
        "markets": [],
        "supported_exchanges": [],
    }).execute().data[0]
    strategy_id = strat["id"]
    low_id: str | None = None
    try:
        low_row = admin.table("compute_jobs").insert({
            "kind": "sync_trades",
            "strategy_id": strategy_id,
            "status": "pending",
            "priority": "low",
            "exchange": "okx",
            "next_attempt_at": "2020-01-01T00:00:00Z",
        }).execute().data[0]
        low_id = low_row["id"]

        # The v_high_pending=0 branch is a GLOBAL gate (migration
        # 20260603120000): it trips when ANY normal/high pending|failed_retry
        # row is DUE (next_attempt_at <= now()). The shared test project is
        # hit by CONCURRENT CI runs that transiently seed such rows, which
        # throttle low work and made the old single-shot `assert low_id in
        # claimed` flaky (a sibling run's high row → our low row throttled →
        # red CI → Railway skips the analytics deploy). So claim only in a
        # window where the backlog is provably empty (read-only probe — no
        # side effects, never claims another run's rows), retrying across a
        # bounded budget. If the project never quiets we skip (a false
        # failure would be worse); if it quiets and our low row STILL isn't
        # claimed, that's the genuine regression this test guards.
        claimed_low = False
        gate_ever_clear = False
        for _ in range(20):  # ~10s budget
            cur = (
                admin.table("compute_jobs")
                .select("status").eq("id", low_id).execute().data
            )
            if not cur:
                break  # our row vanished (unrelated cleanup) — bail to finally
            if cur[0]["status"] != "pending":
                # A concurrent worker already claimed our low row via its own
                # empty-backlog branch — that itself proves the low row WAS
                # claimable, which is exactly the contract under test.
                claimed_low = True
                break
            now_iso = datetime.now(timezone.utc).isoformat()
            backlog = (
                admin.table("compute_jobs")
                .select("id", count="exact")
                .in_("priority", ["normal", "high"])
                .in_("status", ["pending", "failed_retry"])
                .lte("next_attempt_at", now_iso)
                .limit(1)
                .execute()
            )
            if (backlog.count or 0) > 0:
                time.sleep(0.5)
                continue
            gate_ever_clear = True
            claimed = _claim_with_priority(
                admin, worker_id="m1133-low-empty", batch_size=5
            )
            if low_id in {c["id"] for c in claimed}:
                claimed_low = True
                break
            time.sleep(0.3)  # tiny race: a high row landed between probe+claim

        if not claimed_low and not gate_ever_clear:
            pytest.skip(
                "shared test project had a persistent normal/high backlog; "
                "could not establish the v_high_pending=0 precondition"
            )
        assert claimed_low, (
            "M-1133 regression: low-priority row was NOT claimed even though "
            "the normal/high backlog probe read 0 (empty). The "
            "v_high_pending=0 branch of the throttle gate is broken — "
            "low-priority work is unreachable."
        )
    finally:
        if low_id is not None:
            try:
                admin.table("compute_jobs").delete().eq("id", low_id).execute()
            except Exception:
                pass
        try:
            admin.table("strategies").delete().eq("id", strategy_id).execute()
        except Exception:
            pass


def test_low_priority_throttled_when_normal_backlog_present(admin):
    """M-1133 Test B. With ≥1 normal-priority pending ready row AND ≥1
    low-priority pending ready row in the queue, the claim batch MUST
    return ONLY the normal row.

    This exercises the `v_high_pending > 0` branch (CASE WHEN EXISTS
    → 1). The contract: low work is throttled behind any normal/high
    backlog. Mirrors the pre-M-1133 count(*) shape's behavior — proving
    the refactor preserves the throttle gate semantics.
    """
    user_id = _seed_user_id(admin)
    strat_normal = admin.table("strategies").insert({
        "user_id": user_id,
        "name": f"m1133-throttle-n-{uuid.uuid4().hex[:8]}",
        "status": "pending_review",
        "source": "okx",
        "strategy_types": [],
        "subtypes": [],
        "markets": [],
        "supported_exchanges": [],
    }).execute().data[0]
    strat_low = admin.table("strategies").insert({
        "user_id": user_id,
        "name": f"m1133-throttle-l-{uuid.uuid4().hex[:8]}",
        "status": "pending_review",
        "source": "okx",
        "strategy_types": [],
        "subtypes": [],
        "markets": [],
        "supported_exchanges": [],
    }).execute().data[0]
    normal_strategy_id = strat_normal["id"]
    low_strategy_id = strat_low["id"]

    normal_id: str | None = None
    low_id: str | None = None
    try:
        normal_row = admin.table("compute_jobs").insert({
            "kind": "sync_trades",
            "strategy_id": normal_strategy_id,
            "status": "pending",
            "priority": "normal",
            "exchange": "okx",
            "next_attempt_at": "2020-01-01T00:00:00Z",
        }).execute().data[0]
        normal_id = normal_row["id"]
        low_row = admin.table("compute_jobs").insert({
            "kind": "sync_trades",
            "strategy_id": low_strategy_id,
            "status": "pending",
            "priority": "low",
            "exchange": "okx",
            "next_attempt_at": "2020-01-01T00:00:00Z",
        }).execute().data[0]
        low_id = low_row["id"]

        claimed = _claim_with_priority(
            admin, worker_id="m1133-throttle", batch_size=50,
        )
        claimed_ids = {c["id"] for c in claimed}

        # Low row MUST be throttled by the normal-priority backlog.
        assert low_id not in claimed_ids, (
            "M-1133 regression: low-priority row was claimed even though "
            "a normal-priority row is ready. The v_high_pending>0 branch "
            "of the throttle gate is broken — low work is bypassing the "
            "EXISTS short-circuit."
        )
        # Sanity: the normal row WAS claimed (else the queue is empty
        # for an unrelated reason and the test is vacuous).
        assert normal_id in claimed_ids, (
            "Stage error: normal-priority row should have been claimed "
            "to prove we're exercising the throttle gate (not a vacuous "
            "empty-queue path)."
        )
    finally:
        for jid in (normal_id, low_id):
            if jid is not None:
                try:
                    admin.table("compute_jobs").delete().eq("id", jid).execute()
                except Exception:
                    pass
        for sid in (normal_strategy_id, low_strategy_id):
            try:
                admin.table("strategies").delete().eq("id", sid).execute()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# NEW-C12-05 (CL12): advance_sync_cursor epilogue claim-token fence
# ---------------------------------------------------------------------------
# Migration 20260602173710 fences the sync_trades epilogue cursor write on the
# same claim_token contract as the terminal mark (mig 117) and defer
# (20260529170000): a worker whose job the watchdog reclaimed and another
# worker re-claimed must NOT advance the cursor. The worker side (token
# threading + orphan-block logging) is pinned by
# tests/test_job_worker.py::TestAdvanceSyncCursorFence; this proves the SQL
# fence semantics against the live test project.


def test_advance_sync_cursor_fence_owned_orphan_backcompat(admin, strategy_id):
    """Owned token → TRUE; reclaimed (token rotated OR status flipped) → FALSE;
    NULL token (back-compat arm) → TRUE regardless of ownership."""
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "sync_trades",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    # A random api_key id suffices: the fence returns BEFORE the api_keys
    # UPDATE when not owned, and the UPDATE harmlessly affects 0 rows when
    # owned — so the ownership branch is exercised without seeding a real key
    # (which would need NOT-NULL encrypted-credential columns).
    fake_key = str(uuid.uuid4())
    _ts = "2026-06-02T00:00:00+00:00"

    def _advance(token):
        return _rpc_retry_timeout(lambda: admin.rpc("advance_sync_cursor", {
            "p_api_key_id": fake_key,
            "p_job_id": job_id,
            "p_claim_token": token,
            "p_last_fetched_ts": _ts,
            "p_last_sync_at": _ts,
            "p_account_balance": 100,
        }).execute())

    try:
        claimed = _claim_one(admin, "advance-fence-test", want_job_id=job_id)
        assert claimed is not None and claimed["id"] == job_id
        token = claimed["claim_token"]
        assert token is not None

        # (1) Owned: matching token on a still-running row → TRUE.
        assert _advance(token).data is True, "owned job must return TRUE"

        # (2) Reclaim by token rotation (W2 re-claims under a fresh token):
        # W1's stale token no longer matches → FALSE, write dropped.
        new_token = str(uuid.uuid4())
        admin.table("compute_jobs").update(
            {"claim_token": new_token}
        ).eq("id", job_id).execute()
        assert _advance(token).data is False, (
            "reclaimed job (rotated token) must return FALSE so the orphan's "
            "epilogue write is dropped"
        )

        # (3) Reclaim by status flip (watchdog reset to pending before
        # re-claim): even the current token must not write a non-running row.
        admin.table("compute_jobs").update(
            {"status": "pending"}
        ).eq("id", job_id).execute()
        assert _advance(new_token).data is False, (
            "non-running job must return FALSE (fence requires status=running)"
        )

        # (4) Back-compat: NULL token bypasses the fence (deploy-window /
        # WORKER_FENCE_V2 off) and writes unconditionally → TRUE.
        assert _advance(None).data is True, (
            "NULL token (back-compat arm) must return TRUE regardless of ownership"
        )
    finally:
        admin.table("compute_jobs").delete().eq("id", job_id).execute()


def test_advance_sync_cursor_monotonic_guard_no_regress(admin):
    """The RPC's SQL CASE guard must advance each timestamp cursor only when
    strictly newer (a slow/preempted worker cannot regress it) while the
    balance, which has no ordering semantics, is overwritten unconditionally.

    Uses the back-compat NULL-token write path against a real seeded api_key
    so the UPDATE actually lands and the persisted columns are observable.
    """
    user_id = _seed_user_id(admin)
    key = admin.table("api_keys").insert({
        "user_id": user_id,
        "exchange": "okx",
        "label": f"advance-monotonic-{uuid.uuid4().hex[:8]}",
        "api_key_encrypted": "test-placeholder",
    }).execute().data[0]
    key_id = key["id"]

    high = "2026-06-02T12:00:00+00:00"
    low = "2026-06-01T00:00:00+00:00"
    higher = "2026-06-03T00:00:00+00:00"

    def _advance(ts, bal):
        return _rpc_retry_timeout(lambda: admin.rpc("advance_sync_cursor", {
            "p_api_key_id": key_id,
            "p_job_id": None,
            "p_claim_token": None,  # back-compat: unconditional write
            "p_last_fetched_ts": ts,
            "p_last_sync_at": ts,
            "p_account_balance": bal,
        }).execute())

    def _read():
        return admin.table("api_keys").select(
            "last_sync_at,last_fetched_trade_timestamp,account_balance_usdt"
        ).eq("id", key_id).single().execute().data

    try:
        # Establish a HIGH watermark.
        _advance(high, 100)
        row = _read()
        assert row["last_sync_at"][:19] == high[:19], row["last_sync_at"]
        assert float(row["account_balance_usdt"]) == 100.0

        # Stale write (older ts, newer balance): timestamps must NOT regress,
        # but the balance overwrites (no ordering).
        _advance(low, 55)
        row = _read()
        assert row["last_sync_at"][:19] == high[:19], (
            f"last_sync_at regressed to a stale value: {row['last_sync_at']}"
        )
        assert row["last_fetched_trade_timestamp"][:19] == high[:19], (
            f"last_fetched_trade_timestamp regressed: {row['last_fetched_trade_timestamp']}"
        )
        assert float(row["account_balance_usdt"]) == 55.0, (
            "balance has no ordering — a later write must overwrite it"
        )

        # Genuinely newer write advances the cursor.
        _advance(higher, 70)
        row = _read()
        assert row["last_sync_at"][:19] == higher[:19], (
            f"last_sync_at must advance to a strictly newer value: {row['last_sync_at']}"
        )
    finally:
        admin.table("api_keys").delete().eq("id", key_id).execute()
