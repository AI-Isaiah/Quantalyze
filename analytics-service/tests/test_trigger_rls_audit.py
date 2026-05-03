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
1,695 pytest tests and zero pgTAP fixtures). Tests skip on fork PRs / dev machines
where TEST_SUPABASE_DB_URL is unset.

Test caveat (per FIX 12): the test connects via TEST_SUPABASE_DB_URL on port 5432 where
`auth.uid()` returns NULL by default. This proves the load-bearing invariant
("triggers use NEW.user_id, never auth.uid()"). It does NOT distinguish service-role
JWT context from anon JWT context - that distinction would require explicit
`SET LOCAL request.jwt.claim.role TO 'service_role'`. The audit doc records this caveat.
"""

from __future__ import annotations

import os
import uuid
from typing import Iterator

import psycopg
import pytest
from psycopg.rows import dict_row


pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_SUPABASE_DB_URL"),
    reason="Live test Supabase project not configured (TEST_SUPABASE_DB_URL unset). "
    "See MEMORY reference_test_supabase_project.md for the qmnijlgmdhviwzwfyzlc setup.",
)


@pytest.fixture
def service_role_conn() -> Iterator[psycopg.Connection]:
    """Connection using the test-project DSN (auth.uid() returns NULL inside this context).

    DSN must point at the test Supabase project (qmnijlgmdhviwzwfyzlc); never production.

    Phase 16 fix: assert the load-bearing precondition before yielding. The
    suite below asserts that triggers use NEW.user_id (NOT auth.uid()) by
    verifying the trigger fires under a context where auth.uid() returns
    NULL. If TEST_SUPABASE_DB_URL ever points at a non-service-role DSN
    (e.g., a future authenticated-context test fixture), the SAME test
    code would still pass via auth.uid() — masking a regression. Sentinel
    here makes the assumption explicit and surfaces the misconfig at
    fixture-setup time, not at assertion time.
    """
    dsn = os.environ["TEST_SUPABASE_DB_URL"]
    conn = psycopg.connect(dsn, row_factory=dict_row, autocommit=True)
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
            cur.execute("DELETE FROM api_keys WHERE user_id = %s", (uid,))
            cur.execute("DELETE FROM compute_jobs WHERE user_id = %s", (uid,))
            cur.execute("DELETE FROM auth.users WHERE id = %s", (uid,))


class TestMigration084FirstApiKeyAddedTrigger:
    """OBSERV-10: stamp_first_api_key_added trigger uses NEW.user_id, not auth.uid()."""

    def test_trigger_fires_under_service_role(
        self, service_role_conn: psycopg.Connection, fresh_user_id: str
    ) -> None:
        with service_role_conn.cursor() as cur:
            cur.execute(
                "INSERT INTO api_keys (user_id, exchange, encrypted_key, dek_encrypted) "
                "VALUES (%s, 'okx', 'sentinel'::bytea, 'sentinel'::bytea)",
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
                    "INSERT INTO api_keys (user_id, exchange, encrypted_key, dek_encrypted) "
                    "VALUES (%s, 'okx', 'sentinel'::bytea, 'sentinel'::bytea)",
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
    """OBSERV-10: claim_compute_jobs_with_priority honors low-throttle when normal pending.

    Function signature (verified against supabase/migrations/086_compute_jobs_priority.sql L96-99):
      claim_compute_jobs_with_priority(p_batch_size INTEGER, p_worker_id TEXT) RETURNS SETOF compute_jobs

    Both args are required. Calling with one arg fails at the SQL layer with `function ...
    does not exist`. FIX 6 from the outside-voice review explicitly corrects the prior
    one-arg test invocation that would have failed at runtime.
    """

    def test_priority_claim_excludes_low_when_normal_pending(
        self, service_role_conn: psycopg.Connection, fresh_user_id: str
    ) -> None:
        with service_role_conn.cursor() as cur:
            cur.execute(
                "INSERT INTO compute_jobs (user_id, kind, priority, status, next_attempt_at) "
                "VALUES "
                "(%s, 'analytics', 'normal', 'pending', now()), "
                "(%s, 'analytics', 'normal', 'pending', now()), "
                "(%s, 'analytics', 'normal', 'pending', now()), "
                "(%s, 'analytics', 'low', 'pending', now()), "
                "(%s, 'analytics', 'low', 'pending', now())",
                (fresh_user_id,) * 5,
            )
            # FIX 6: BOTH args required - p_batch_size INTEGER, p_worker_id TEXT.
            cur.execute(
                "SELECT * FROM claim_compute_jobs_with_priority(%s, %s)",
                (5, "test-worker-phase-16"),
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
