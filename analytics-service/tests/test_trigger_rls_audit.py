"""Phase 16 / OBSERV-10 - trigger / RLS audit under unified-pipeline service-role context.

Asserted invariants:
  1. Migration 084 stamp_first_api_key_added trigger fires when api_keys row is inserted
     by a service-role JWT (where auth.uid() returns NULL). The trigger uses NEW.user_id
     - a regression to auth.uid() would silently no-op (Pitfall 5).
  2. Migration 084 trigger is idempotent: a second api_key insert does NOT overwrite the
     original first_api_key_added_at stamp.
  3. Migration 085 stamp_first_bridge_surfaced RPC is single-fire: first call returns
     stamped:true with a timestamp; second call returns stamped:false with the same
     timestamp. Uses p_user_id argument, not auth.uid().
  4. Migration 086 claim_compute_jobs_with_priority(p_batch_size INTEGER, p_worker_id TEXT)
     honors the low-throttle rule: when normal/high pending rows exist, low priority rows
     are excluded from the claim batch. Function signature verified against migration
     086 L96-99 (FIX 6 - both positional args required).

Test framework: pytest + psycopg (Claude's Discretion per CONTEXT.md - codebase has
1,695 pytest tests and zero pgTAP fixtures). Phase 215: the module resolves its DSN through the
`live_db_dsn` fixture (`tests/live_db_dsn.py`), so it runs on the CI python job's private
local-stack lane via LANE_DB_URL. On a dev machine without the lane values it skips; under
CI=true without LANE_DB_URL it fails by name.

Test caveat (per FIX 12): the test connects via the lane DSN as the `postgres` role, where
`auth.uid()` returns NULL by default. This proves the load-bearing invariant
("triggers use NEW.user_id, never auth.uid()"). It does NOT distinguish service-role
JWT context from anon JWT context - that distinction would require explicit
`SET LOCAL request.jwt.claim.role TO 'service_role'`. The audit doc records this caveat.
"""

from __future__ import annotations

import uuid
from typing import Iterator

import psycopg
import pytest
from psycopg.rows import dict_row

from tests.live_db_dsn import connect_live_db


@pytest.fixture
def service_role_conn(live_db_dsn: str) -> Iterator[psycopg.Connection]:
    """Connection to the local-stack lane (auth.uid() returns NULL inside this context).

    The DSN is the lane's loopback DSN, checked by `connect_live_db` before any write; never
    shared TEST, never production.

    Phase 16 fix: assert the load-bearing precondition before yielding. The
    suite below asserts that triggers use NEW.user_id (NOT auth.uid()) by
    verifying the trigger fires under a context where auth.uid() returns
    NULL. If the lane DSN ever points at a non-service-role DSN
    (e.g., a future authenticated-context test fixture), the SAME test
    code would still pass via auth.uid() — masking a regression. Sentinel
    here makes the assumption explicit and surfaces the misconfig at
    fixture-setup time, not at assertion time.
    """
    conn = connect_live_db(live_db_dsn, autocommit=True, row_factory=dict_row)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT auth.uid() AS uid")
            row = cur.fetchone()
            assert row is not None and row["uid"] is None, (
                f"Test precondition failed: auth.uid()={row['uid'] if row else None!r}. "
                "Trigger audit suite REQUIRES service-role context where "
                "auth.uid() returns NULL — otherwise a regression to "
                "auth.uid() in the trigger body would silently pass."
            )
        yield conn
    finally:
        conn.close()


@pytest.fixture
def fresh_user_id(service_role_conn: psycopg.Connection) -> Iterator[str]:
    """Create an auth.users row, return its UUID, clean up after.

    Uses a unique email so parallel test runs do not collide.
    """
    uid = str(uuid.uuid4())
    email = f"trigger-audit-{uid[:8]}@quantalyze-test.invalid"
    with service_role_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) "
            "VALUES (%s, %s, '{}'::jsonb)",
            (uid, email),
        )
    try:
        yield uid
    finally:
        with service_role_conn.cursor() as cur:
            # compute_jobs has no user_id column (it targets a strategy): remove the user's
            # jobs through their strategies, then the strategies, before the auth user.
            cur.execute(
                "DELETE FROM compute_jobs WHERE strategy_id IN "
                "(SELECT id FROM strategies WHERE user_id = %s)",
                (uid,),
            )
            cur.execute("DELETE FROM strategies WHERE user_id = %s", (uid,))
            cur.execute("DELETE FROM api_keys WHERE user_id = %s", (uid,))
            cur.execute("DELETE FROM auth.users WHERE id = %s", (uid,))


class TestMigration084FirstApiKeyAddedTrigger:
    """OBSERV-10: stamp_first_api_key_added trigger uses NEW.user_id, not auth.uid()."""

    def test_trigger_fires_under_service_role(
        self, service_role_conn: psycopg.Connection, fresh_user_id: str
    ) -> None:
        with service_role_conn.cursor() as cur:
            cur.execute(
                "INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted) "
                "VALUES (%s, 'okx', 'trigger-audit', 'sentinel')",
                (fresh_user_id,),
            )
            cur.execute(
                "SELECT raw_user_meta_data->>'first_api_key_added_at' AS stamp "
                "FROM auth.users WHERE id = %s",
                (fresh_user_id,),
            )
            row = cur.fetchone()
        assert row is not None
        assert row["stamp"] is not None, (
            "Trigger did not stamp first_api_key_added_at - likely regressed to auth.uid() "
            "(returns NULL under service-role JWT - Pitfall 5)."
        )

    def test_trigger_is_idempotent(
        self, service_role_conn: psycopg.Connection, fresh_user_id: str
    ) -> None:
        def insert_and_read():
            with service_role_conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted) "
                    "VALUES (%s, 'okx', 'trigger-audit', 'sentinel')",
                    (fresh_user_id,),
                )
                cur.execute(
                    "SELECT raw_user_meta_data->>'first_api_key_added_at' AS stamp "
                    "FROM auth.users WHERE id = %s",
                    (fresh_user_id,),
                )
                return cur.fetchone()["stamp"]

        first = insert_and_read()
        second = insert_and_read()
        assert first == second, (
            f"Trigger is NOT idempotent: stamp changed from {first!r} to {second!r}"
        )


class TestMigration085StampFirstBridgeSurfaced:
    """OBSERV-10: stamp_first_bridge_surfaced RPC uses p_user_id, not auth.uid()."""

    def test_rpc_stamps_once_then_no_op(
        self, service_role_conn: psycopg.Connection, fresh_user_id: str
    ) -> None:
        with service_role_conn.cursor() as cur:
            cur.execute(
                "SELECT public.stamp_first_bridge_surfaced(%s) AS result",
                (fresh_user_id,),
            )
            first = cur.fetchone()["result"]
            cur.execute(
                "SELECT public.stamp_first_bridge_surfaced(%s) AS result",
                (fresh_user_id,),
            )
            second = cur.fetchone()["result"]
        assert first["stamped"] is True, f"First RPC call did not stamp: {first!r}"
        assert second["stamped"] is False, f"Second RPC call should be no-op: {second!r}"
        assert first["stamped_at"] == second["stamped_at"], (
            "RPC overwrote the original stamp - invariant violated"
        )


class TestMigration086ComputeJobsPriority:
    """OBSERV-10 (+ Phase 19 / BACKBONE-05): claim_compute_jobs_with_priority
    honors low-throttle when normal pending, and stamps the unified-backbone
    snapshot at claim time.

    Function signature (migration 086 + extended in migration 104 — Phase 19):
      claim_compute_jobs_with_priority(
          p_batch_size INTEGER,
          p_worker_id TEXT,
          p_unified_backbone_active BOOLEAN DEFAULT NULL  -- migration 104
      ) RETURNS SETOF compute_jobs

    Migration 104 added the third arg with DEFAULT NULL for backward
    compatibility, but the H-5 caller-enumeration audit for Phase 19 P6
    requires every call site to pass it explicitly so a future signature
    change cannot silently swallow an old caller.
    """

    def test_priority_claim_excludes_low_when_normal_pending(
        self, service_role_conn: psycopg.Connection, fresh_user_id: str
    ) -> None:
        with service_role_conn.cursor() as cur:
            # 2026-11-15 (Phase 215): compute_jobs has no user_id column and kind 'analytics'
            # is no longer a kind; a job targets a strategy (compute_jobs_kind_target_coherence)
            # and the claim dedupes per target, so each of the 5 jobs gets its own strategy.
            strategy_ids = [str(uuid.uuid4()) for _ in range(5)]
            for sid in strategy_ids:
                cur.execute(
                    "INSERT INTO strategies (id, user_id, name, status) "
                    "VALUES (%s, %s, %s, 'pending_review')",
                    (sid, fresh_user_id, f"trigger-audit-{sid[:8]}"),
                )
            for sid, priority in zip(strategy_ids, ("normal",) * 3 + ("low",) * 2):
                cur.execute(
                    "INSERT INTO compute_jobs (strategy_id, kind, priority, status, next_attempt_at) "
                    "VALUES (%s, 'compute_analytics', %s, 'pending', now())",
                    (sid, priority),
                )
            # Phase 19 / H-5 — pass all three args explicitly (the third
            # is BOOLEAN, DEFAULT NULL since migration 104). Passing TRUE
            # mirrors normal worker behavior post-flag-flip; the
            # priority-throttle assertion below is invariant under the
            # third arg.
            #
            # 2026-11-15 (Phase 215 TESTREACH plan 02): this module now runs on the CI
            # python job's private lane (LANE_DB_URL) and the claim is SCOPED. The lane holds
            # only this suite's rows, but a database that also carried foreign `normal`
            # backlog would fill a batch of 5 with it and read `priorities.count("normal")`
            # as 5, so the call uses the 5-arg overload and claims ONLY kind 'compute_analytics'
            # (`p_kind_include TEXT[]`, migrations 20260719073701 and 20260927120000).
            # Arg 4 binds a Python list as TEXT[]; arg 5 (`p_kind_exclude`) stays NULL.
            cur.execute(
                "SELECT * FROM claim_compute_jobs_with_priority(%s, %s, %s, %s::text[], NULL)",
                (5, "test-worker-phase-16", True, ["compute_analytics"]),
            )
            claimed = cur.fetchall()
        priorities = [row["priority"] for row in claimed]
        # Per migration 086 L141-153: low rows are excluded when normal pending.
        # Expect: 3 normal claimed; 0 low claimed.
        assert "low" not in priorities, (
            f"Priority='low' rows claimed while normal pending: {priorities!r}"
        )
        assert priorities.count("normal") == 3, (
            f"Expected 3 normal rows claimed; got {priorities.count('normal')}: {priorities!r}"
        )
