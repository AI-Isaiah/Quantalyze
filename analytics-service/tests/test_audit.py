"""Unit tests for analytics-service/services/audit.py.

Sprint 6 closeout Task 7.1b — the fire-and-forget contract for the
Python cross-service audit emitter.

audit-2026-05-07 P907 + P908 superseded the blanket swallow-all contract.
The current contract is typed-exception dispatch:
  - permission_denied (SQLSTATE 42501) → re-raise (hard error).
  - httpx transient (Timeout / NetworkError / RemoteProtocolError) →
    Sentry + log + swallow.
  - anything else → Sentry + log + re-raise.

The new contract is fully covered by `test_audit_emit.py`. This file
keeps the orthogonal invariants:
  1. Happy path calls `log_audit_event_service` with the expected shape.
  2. NULL / empty user_id is caught at the Python layer (before the
     RPC) — nothing hits the wire and the log message is scrubbed.
  3. `metadata=None` default is normalized to `{}` on the RPC call.
  4. Payload scrubbing — `p_metadata` is redacted before the wire.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from unittest.mock import MagicMock

import pytest

from services import audit as audit_module
from services.audit import log_audit_event

DUMMY_USER = "00000000-0000-0000-0000-000000000001"
DUMMY_ENTITY = "00000000-0000-0000-0000-0000000000a0"


def _mock_supabase_with_rpc() -> tuple[MagicMock, MagicMock]:
    """Build a fake supabase client whose `.rpc(...).execute()` is mockable.

    Returns (supabase_client, rpc_method) so tests can assert on the rpc
    call args directly. The supabase-py shape is
    `supabase.rpc(name, params).execute()`, so we return a double that
    chains correctly.
    """
    execute_mock = MagicMock(return_value=MagicMock(data=None, error=None))
    rpc_result = MagicMock(execute=execute_mock)
    rpc_method = MagicMock(return_value=rpc_result)
    supabase = MagicMock(rpc=rpc_method)
    return supabase, rpc_method


class TestLogAuditEventHappyPath:
    def test_calls_rpc_with_expected_shape(self, monkeypatch):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        log_audit_event(
            user_id=DUMMY_USER,
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=DUMMY_ENTITY,
            metadata={"candidate_count": 5},
        )

        rpc.assert_called_once_with(
            "log_audit_event_service",
            {
                "p_user_id": DUMMY_USER,
                "p_action": "bridge.score_candidates",
                "p_entity_type": "bridge_run",
                "p_entity_id": DUMMY_ENTITY,
                "p_metadata": {"candidate_count": 5},
            },
        )

    def test_metadata_defaults_to_empty_dict(self, monkeypatch):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        log_audit_event(
            user_id=DUMMY_USER,
            action="simulator.run",
            entity_type="simulator_run",
            entity_id=DUMMY_ENTITY,
        )

        call_args = rpc.call_args[0]
        assert call_args[1]["p_metadata"] == {}

    def test_coerces_uuid_to_str(self, monkeypatch):
        """supabase-py accepts UUID objects but normalizing to str now
        means the payload is JSON-serializable even when metadata carries
        non-str fields downstream."""
        from uuid import UUID

        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        uid_obj = UUID(DUMMY_USER)
        eid_obj = UUID(DUMMY_ENTITY)
        log_audit_event(
            user_id=uid_obj,
            action="reconcile.compare",
            entity_type="reconcile_run",
            entity_id=eid_obj,
        )

        call_args = rpc.call_args[0]
        assert call_args[1]["p_user_id"] == DUMMY_USER
        assert call_args[1]["p_entity_id"] == DUMMY_ENTITY

    def test_returns_none_not_awaitable(self, monkeypatch):
        supabase, _rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        result = log_audit_event(
            user_id=DUMMY_USER,
            action="optimizer.run",
            entity_type="optimizer_run",
            entity_id=DUMMY_ENTITY,
        )
        assert result is None


# NOTE — `TestLogAuditEventSwallowsErrors` was removed as part of the
# audit-2026-05-07 P907 + P908 fix. The blanket swallow-all contract
# the class encoded is no longer correct; only httpx-transient errors
# are swallowed, and the typed-dispatch path is covered exhaustively in
# `test_audit_emit.py` (TestPermissionDeniedReRaises,
# TestTransientNetworkErrorsAreCapturedAndCounted,
# TestUnexpectedExceptionReRaises).


class TestLogAuditEventNullGuards:
    def test_none_user_id_logs_and_returns_without_rpc_call(
        self, monkeypatch, caplog
    ):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            log_audit_event(
                user_id=None,  # type: ignore[arg-type]
                action="bridge.score_candidates",
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        # RPC must NOT be called when user_id is None.
        rpc.assert_not_called()
        assert any(
            "NULL user_id" in rec.getMessage() for rec in caplog.records
        )

    def test_empty_string_user_id_logs_and_returns_without_rpc_call(
        self, monkeypatch, caplog
    ):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            log_audit_event(
                user_id="",
                action="bridge.score_candidates",
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        rpc.assert_not_called()
        assert any(
            "empty user_id" in rec.getMessage() for rec in caplog.records
        )


# ---------------------------------------------------------------------------
# Audit closure M-0734 — the two null-guard tests above couple to the log COPY
# ("NULL user_id" / "empty user_id"). A reworded log message would break them
# with no behavior change, and the substring checks can't distinguish the two
# branches from their effect. These tests pin the BEHAVIORAL contract (no RPC
# reaches the wire) for each guard input WITHOUT depending on log wording, and
# cover edge inputs the substring tests miss (literal "None" string → empty
# branch; whitespace-only → NOT guarded, reaches the RPC).
# ---------------------------------------------------------------------------


class TestLogAuditEventNullGuardsBehavioral:
    def test_none_user_id_suppresses_rpc_without_log_copy_coupling(
        self, monkeypatch
    ):
        """user_id=None → the RPC is never invoked (the contract that matters),
        asserted independent of the log message text."""
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)
        result = log_audit_event(
            user_id=None,  # type: ignore[arg-type]
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=DUMMY_ENTITY,
        )
        rpc.assert_not_called()
        assert result is None  # fire-and-forget contract

    def test_empty_string_user_id_suppresses_rpc_without_log_copy_coupling(
        self, monkeypatch
    ):
        """user_id="" → empty-guard branch → no RPC, asserted via behavior."""
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)
        log_audit_event(
            user_id="",
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=DUMMY_ENTITY,
        )
        rpc.assert_not_called()

    def test_literal_none_string_user_id_hits_empty_guard_no_rpc(
        self, monkeypatch
    ):
        """The empty-guard also catches the literal string "None" (str(None)
        coercion artefact) via `uid == "None"`. This distinguishes the empty
        branch from the None branch by INPUT, not by log copy."""
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)
        log_audit_event(
            user_id="None",
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=DUMMY_ENTITY,
        )
        rpc.assert_not_called()

    def test_whitespace_user_id_is_not_guarded_reaches_rpc(self, monkeypatch):
        """Current contract: the empty guard checks `not uid or uid == "None"`
        — it does NOT strip whitespace, so a whitespace-only user_id is treated
        as a real id and reaches the RPC. Pinning this proves the guard is the
        narrow None/empty check, not a broader blank-string filter; a future
        change that started stripping whitespace would have to update this."""
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)
        log_audit_event(
            user_id="   ",
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=DUMMY_ENTITY,
        )
        rpc.assert_called_once()


# ---------------------------------------------------------------------------
# Phase 18 / FIX-04 — Adversarial revision B3 + redact wire-up.
# audit.py uses stdlib `logging.getLogger("quantalyze.audit")` (NOT structlog),
# so the structlog processor pipeline does NOT cover its `logger.error` calls.
# Every formatter argument MUST pass through services.redact.scrub_pii directly.
# ---------------------------------------------------------------------------


class TestAuditPayloadScrubbed:
    """The RPC payload (`p_metadata`) must be scrubbed BEFORE the wire."""

    def test_audit_payload_scrubbed(self, monkeypatch):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        log_audit_event(
            user_id=DUMMY_USER,
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=DUMMY_ENTITY,
            metadata={"api_key": "leaky-key-AAA", "safe": "ok"},
        )

        call_args = rpc.call_args[0]
        sent_payload = call_args[1]["p_metadata"]
        # api_key MUST be redacted before the RPC executes.
        assert sent_payload["api_key"] == "[REDACTED]"
        # Non-sensitive fields preserved.
        assert sent_payload["safe"] == "ok"

    def test_audit_payload_scrubbed_nested(self, monkeypatch):
        """Nested credentials inside metadata are also redacted (recursive)."""
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        log_audit_event(
            user_id=DUMMY_USER,
            action="bridge.score_candidates",
            entity_type="bridge_run",
            entity_id=DUMMY_ENTITY,
            metadata={
                "broker": "okx",
                "creds": {"api_secret": "leaky", "passphrase": "leaky2"},
            },
        )

        call_args = rpc.call_args[0]
        sent = call_args[1]["p_metadata"]
        assert sent["broker"] == "okx"
        assert sent["creds"]["api_secret"] == "[REDACTED]"
        assert sent["creds"]["passphrase"] == "[REDACTED]"


class TestLoggerErrorScrubsPiiMetadata:
    """Adversarial revision 2026-05-06: B3 — every `logger.error` formatter arg
    in audit.py passes through scrub_pii before the message hits stderr.

    Three audit.py callsites are covered:
      1. NULL user_id branch (line ~88)
      2. Empty user_id branch (line ~100)
      3. RPC-throw branch (line ~125)
    """

    def test_null_user_id_action_arg_is_scrubbed(self, monkeypatch, caplog):
        # Inject a JWT-shaped action string — scrub_pii on a JWT-shape returns
        # the redaction token, proving the formatter arg passes through scrub_pii.
        jwt = "aaaaaaaaaa.bbbbbbbbbb.cccccccccc"
        supabase, _rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            log_audit_event(
                user_id=None,  # type: ignore[arg-type]
                action=jwt,
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        msg = caplog.records[0].getMessage()
        assert jwt not in msg, f"raw JWT leaked into log message: {msg!r}"
        assert "[REDACTED_JWT]" in msg or "[REDACTED]" in msg

    def test_empty_user_id_action_arg_is_scrubbed(self, monkeypatch, caplog):
        jwt = "ddddddddd0.eeeeeeeeee.ffffffffff"
        supabase, _rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            log_audit_event(
                user_id="",
                action=jwt,
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        msg = caplog.records[0].getMessage()
        assert jwt not in msg, f"raw JWT leaked into log message: {msg!r}"
        assert "[REDACTED_JWT]" in msg or "[REDACTED]" in msg

    def test_rpc_throw_branch_scrubs_args(self, monkeypatch, caplog):
        # When the RPC call throws an UNEXPECTED exception, the wrapper now
        # logs + Sentry-captures + re-raises (audit-2026-05-07 P907 + P908).
        # The log line emitted before the re-raise must still scrub PII in
        # every formatter arg (action/entity_type/entity_id/user_id/exc).
        jwt_action = "1234567890.0987654321.abcdefghij"
        rpc_method = MagicMock(side_effect=RuntimeError("network down"))
        supabase = MagicMock(rpc=rpc_method)
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            with pytest.raises(RuntimeError):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action=jwt_action,
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

        msg = caplog.records[-1].getMessage()
        assert jwt_action not in msg, f"raw JWT leaked: {msg!r}"
        assert "[REDACTED_JWT]" in msg or "[REDACTED]" in msg
        # Confirm we hit the RPC-throw branch.
        assert "log_audit_event_service call threw" in msg

    # Phase 18 / round-2 red team — `scrub_pii` on a non-JWT string is a
    # no-op; only `scrub_freeform_string` redacts substring `key=value` shapes.
    # The B3 commit originally used `scrub_pii(str(exc))` and was operationally
    # silent on the dominant Supabase-error-echo case. The cases below pin the
    # post-fix behavior.
    def test_rpc_throw_substring_leak_redacted(self, monkeypatch, caplog):
        """Supabase RPC error that echoes a `key=value` substring (NOT a JWT
        shape) must be redacted. This was leaking under the old `scrub_pii`
        wrapper that only matched whole-anchored JWTs. Under
        audit-2026-05-07 P907 + P908, an unexpected RuntimeError now
        re-raises after logging — the scrub of the log line still applies."""
        leaky_msg = "request body: {'metadata': 'api_key=PROD_LEAK_VALUE_42 ok'}"
        rpc_method = MagicMock(side_effect=RuntimeError(leaky_msg))
        supabase = MagicMock(rpc=rpc_method)
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            with pytest.raises(RuntimeError):
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.run",
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

        msg = caplog.records[-1].getMessage()
        assert "PROD_LEAK_VALUE_42" not in msg, (
            f"substring api_key=value leaked: {msg!r}"
        )
        assert "[REDACTED]" in msg
        assert "log_audit_event_service call threw" in msg

    def test_null_user_id_substring_leak_redacted(self, monkeypatch, caplog):
        """The NULL user_id branch logs `action` raw via formatter — a caller
        passing an action string with a `passphrase=value` substring must be
        redacted (e.g. a misuse where the caller stuffed credentials into
        action by mistake)."""
        supabase, _rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        leaky_action = "bridge.run passphrase=NULLBRANCH_LEAK_VALUE_99"
        with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
            log_audit_event(
                user_id=None,  # type: ignore[arg-type]
                action=leaky_action,
                entity_type="bridge_run",
                entity_id=DUMMY_ENTITY,
            )

        msg = caplog.records[0].getMessage()
        assert "NULLBRANCH_LEAK_VALUE_99" not in msg, (
            f"NULL-branch substring leaked: {msg!r}"
        )
        assert "[REDACTED]" in msg


# ---------------------------------------------------------------------------
# H-0771 — concurrency / thread-safety coverage for the fire-and-forget
# wrapper. audit.py:31-34 claims "Synchronous supabase-py call dispatched
# inside the caller's thread ... the service-role client is thread-safe."
# Every other test in this file drives the wrapper single-threaded, so that
# claim is untested. These tests exercise log_audit_event from many threads
# (and from an asyncio task pool via to_thread) and assert no emit is lost,
# no exception escapes, and every concurrent call reaches the RPC exactly
# once. A regression where get_supabase returns a non-thread-safe singleton
# or supabase-py raises on concurrent .execute() would surface here.
# ---------------------------------------------------------------------------


def _make_thread_recording_supabase(call_delay_s: float = 0.0):
    """Build a supabase double whose .rpc(...).execute() records the calling
    thread and (optionally) sleeps inside .execute() to force interleaving.

    Returns (supabase, recorded_payloads, recorded_threads). The recording
    lists are appended under a lock so the test harness itself never loses a
    record — any lost RPC then provably comes from the wrapper, not the mock.
    """
    lock = threading.Lock()
    recorded_payloads: list[dict] = []
    recorded_threads: list[int] = []

    def _execute():
        if call_delay_s:
            time.sleep(call_delay_s)
        with lock:
            recorded_threads.append(threading.get_ident())
        return MagicMock(data=None, error=None)

    def _rpc(_name, params):
        with lock:
            recorded_payloads.append(params)
        return MagicMock(execute=_execute)

    supabase = MagicMock()
    supabase.rpc.side_effect = _rpc
    return supabase, recorded_payloads, recorded_threads


class TestLogAuditEventConcurrency:
    """H-0771: the thread-safety contract in audit.py must actually hold."""

    def test_concurrent_threads_all_reach_rpc_exactly_once(self, monkeypatch):
        """50 threads each emit one event; the RPC must fire exactly 50 times,
        with 50 distinct entity_ids preserved and no exception escaping a
        worker thread. A non-thread-safe client or a lost-update bug would
        show up as < 50 recorded payloads or a captured exception."""
        # call_delay forces overlap so the threads genuinely contend inside
        # .execute() rather than each running to completion before the next
        # GIL release.
        supabase, payloads, threads = _make_thread_recording_supabase(
            call_delay_s=0.002
        )
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        n = 50
        errors: list[BaseException] = []
        errors_lock = threading.Lock()
        start = threading.Barrier(n)

        def _worker(i: int) -> None:
            start.wait()  # release all threads simultaneously
            try:
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.score_candidates",
                    entity_type="bridge_run",
                    entity_id=f"00000000-0000-0000-0000-{i:012d}",
                    metadata={"i": i},
                )
            except BaseException as exc:  # noqa: BLE001 — record, don't swallow silently
                with errors_lock:
                    errors.append(exc)

        workers = [threading.Thread(target=_worker, args=(i,)) for i in range(n)]
        for w in workers:
            w.start()
        for w in workers:
            w.join(timeout=10)

        assert not any(w.is_alive() for w in workers), "a worker thread hung"
        assert errors == [], f"worker thread(s) raised: {errors!r}"
        # Every concurrent emit must reach the RPC exactly once — no lost call.
        assert len(payloads) == n, (
            f"expected {n} RPC calls, recorded {len(payloads)} — an emit was "
            "lost under concurrency"
        )
        assert len(threads) == n
        # Distinct entity_ids prove no payload was overwritten/clobbered.
        seen_ids = {p["p_entity_id"] for p in payloads}
        assert len(seen_ids) == n, (
            f"expected {n} distinct entity_ids, saw {len(seen_ids)} — "
            "concurrent payloads collided"
        )
        # The work genuinely ran across multiple OS threads (not serialized
        # onto one), proving we exercised the cross-thread path.
        assert len({*threads}) > 1, "all calls ran on one thread — no real concurrency"

    def test_concurrent_asyncio_to_thread_gather(self, monkeypatch):
        """The wrapper is documented as the thing an async router calls without
        awaiting; routers offload it via asyncio.to_thread in some paths. Drive
        it through asyncio.gather(*to_thread(...)) and assert every emit lands.
        This is the asyncio-context coverage the audit flagged as absent."""
        supabase, payloads, _threads = _make_thread_recording_supabase(
            call_delay_s=0.001
        )
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        n = 30

        async def _drive() -> None:
            await asyncio.gather(
                *[
                    asyncio.to_thread(
                        log_audit_event,
                        DUMMY_USER,
                        "simulator.run",
                        "simulator_run",
                        f"00000000-0000-0000-0000-{i:012d}",
                        {"i": i},
                    )
                    for i in range(n)
                ]
            )

        asyncio.run(_drive())

        assert len(payloads) == n, (
            f"expected {n} RPC calls via to_thread gather, recorded {len(payloads)}"
        )
        assert len({p["p_entity_id"] for p in payloads}) == n

    def test_transient_counter_no_lost_updates_under_contention(self, monkeypatch):
        """The transient branch increments the module-level
        `audit_emit_transient_failures_total` counter (audit.py:284-285) on a
        read-modify-write with no lock. The counter is a metric used for
        alerting; lost updates would under-report Railway blips. Drive many
        concurrent transient failures and assert the counter equals the exact
        number of failures — pinning the no-lost-update contract."""
        import httpx

        class _TransientSupabase:
            def rpc(self, *_a, **_k):
                raise httpx.ConnectError("simulated railway blip")

        monkeypatch.setattr(audit_module, "get_supabase", lambda: _TransientSupabase())
        # Sentry is best-effort; the wrapper already wraps it in try/except, but
        # neutralize it so the test asserts on the counter alone.
        monkeypatch.setattr(audit_module.sentry_sdk, "set_tag", lambda *a, **k: None)
        monkeypatch.setattr(
            audit_module.sentry_sdk, "capture_exception", lambda *a, **k: None
        )
        monkeypatch.setattr(audit_module, "audit_emit_transient_failures_total", 0)

        n_threads = 8
        per_thread = 250
        total = n_threads * per_thread
        start = threading.Barrier(n_threads)

        def _worker() -> None:
            start.wait()
            for _ in range(per_thread):
                # transient branch swallows (returns) — never raises here.
                log_audit_event(
                    user_id=DUMMY_USER,
                    action="bridge.run",
                    entity_type="bridge_run",
                    entity_id=DUMMY_ENTITY,
                )

        workers = [threading.Thread(target=_worker) for _ in range(n_threads)]
        for w in workers:
            w.start()
        for w in workers:
            w.join(timeout=15)

        assert not any(w.is_alive() for w in workers), "a worker thread hung"
        assert audit_module.audit_emit_transient_failures_total == total, (
            f"transient counter lost updates: expected {total}, got "
            f"{audit_module.audit_emit_transient_failures_total}"
        )


# ---------------------------------------------------------------------------
# audit-2026-05-07 H-0656 / H-0657 / M-0660 — the Python `AuditAction` /
# `AuditEntityType` `Literal` unions in services/audit.py MUST stay in lockstep
# with the canonical TS source of truth (`src/lib/audit.ts`). There is no mypy
# gate on audit.py in CI, so the annotations alone have no runtime teeth — this
# sync test is what makes the cross-service taxonomy contract enforceable. It
# fails loudly the moment one side is edited without the other (the exact drift
# the findings flag: a typo'd / out-of-taxonomy action silently writing garbage
# to an append-only audit_log).
# ---------------------------------------------------------------------------


def _parse_ts_union(ts_source: str, type_name: str) -> set[str]:
    """Extract the string-literal members of a TS `export type X = ... ;` union.

    Parses the canonical `src/lib/audit.ts` without a TS toolchain: isolates the
    `export type <type_name> =` declaration up to its terminating `;`, strips
    `//` line comments (the union is heavily annotated), then collects every
    double-quoted literal. Returns the set of member strings.
    """
    import re

    decl_re = re.compile(
        r"export\s+type\s+" + re.escape(type_name) + r"\s*=(.*?);",
        re.DOTALL,
    )
    m = decl_re.search(ts_source)
    if m is None:
        raise AssertionError(
            f"could not locate `export type {type_name}` in src/lib/audit.ts"
        )
    body = m.group(1)
    # Drop `//` line comments so commented-out example values never leak in.
    body = re.sub(r"//[^\n]*", "", body)
    return set(re.findall(r'"([^"]+)"', body))


class TestAuditTaxonomySyncWithTypeScript:
    """The Python Literal vocabulary must equal the TS source-of-truth union."""

    def _ts_source(self) -> str:
        from pathlib import Path

        ts_path = (
            Path(__file__).resolve().parents[2] / "src" / "lib" / "audit.ts"
        )
        assert ts_path.exists(), (
            f"canonical TS taxonomy not found at {ts_path}; the sync test "
            "cannot verify the Python Literal unions against the source of truth"
        )
        return ts_path.read_text(encoding="utf-8")

    def test_action_literal_matches_ts_union(self):
        from typing import get_args

        ts_actions = _parse_ts_union(self._ts_source(), "AuditAction")
        py_actions = set(get_args(audit_module.AuditAction))

        assert py_actions == ts_actions, (
            "Python AuditAction Literal drifted from TS AuditAction union.\n"
            f"  in TS only (add to services/audit.py): {sorted(ts_actions - py_actions)}\n"
            f"  in Python only (add to src/lib/audit.ts or remove here): "
            f"{sorted(py_actions - ts_actions)}"
        )

    def test_entity_type_literal_matches_ts_union(self):
        from typing import get_args

        ts_entities = _parse_ts_union(self._ts_source(), "AuditEntityType")
        py_entities = set(get_args(audit_module.AuditEntityType))

        assert py_entities == ts_entities, (
            "Python AuditEntityType Literal drifted from TS AuditEntityType union.\n"
            f"  in TS only (add to services/audit.py): {sorted(ts_entities - py_entities)}\n"
            f"  in Python only (add to src/lib/audit.ts or remove here): "
            f"{sorted(py_entities - ts_entities)}"
        )

    def test_taxonomy_is_non_trivially_populated(self):
        """Guard against the parser silently returning empty sets (which would
        make the equality assertions vacuously pass on a broken parse)."""
        from typing import get_args

        # Lower bounds, not exact counts — exactness is covered above. These
        # only catch a regex/parse regression that returns {} on both sides.
        assert len(get_args(audit_module.AuditAction)) >= 40
        assert len(get_args(audit_module.AuditEntityType)) >= 20
