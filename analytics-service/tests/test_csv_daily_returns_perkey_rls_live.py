"""Phase 35 (DAILIES-04) — Cross-tenant RLS for per-key csv_daily_returns rows.

Gated on TEST_SUPABASE_DB_URL (same gate as test_persist_csv_daily_returns_live).
CI without secrets skips cleanly with a verbose ``reason=`` (Rule 12).

This is the criterion-4 tenant-isolation gate. Migration 20260624120000 added a
new owner SELECT policy:

    CREATE POLICY csv_daily_returns_allocator_owner_select
      ON public.csv_daily_returns FOR SELECT TO authenticated
      USING (allocator_id = auth.uid());

The two-actor probe proves, at the CONTENT level (RLS fails SILENTLY to empty
rows — an error-code assertion would not catch a leak):

  1. Allocator A (authenticated) SEES A's own per-key row (positive control —
     the new policy admits the owner, it is not a blanket deny).
  2. Allocator A (authenticated) does NOT see allocator B's per-key row — B's
     specific seeded row id is ABSENT from A's result set (the cross-tenant
     assertion; mirrors the V4 / Phase-25 RLS-leak discipline).
  3. The strategy-owner policy does NOT leak per-key rows: a per-key row has
     ``strategy_id`` NULL, so ``NULL IN (subquery)`` is never TRUE — A sees
     B's per-key row through neither policy.
  4. Service-role still reads both A's and B's per-key rows (the worker write
     path bypasses RLS — unaffected).
"""
from __future__ import annotations

import os
import uuid
from typing import Iterator

import psycopg
import pytest
from psycopg.rows import dict_row

from tests.test_persist_csv_daily_returns_live import (
    _cleanup,
    _create_test_user,
    _set_authenticated,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_SUPABASE_DB_URL"),
    reason="Live test Supabase project not configured (TEST_SUPABASE_DB_URL unset). "
    "See MEMORY reference_test_supabase_project.md for the qmnijlgmdhviwzwfyzlc setup. "
    "This is the DAILIES-04 cross-tenant RLS gate for per-key csv_daily_returns rows.",
)


@pytest.fixture
def service_role_conn() -> Iterator[psycopg.Connection]:
    """psycopg connection (autocommit) against the TEST Supabase DSN."""
    dsn = os.environ["TEST_SUPABASE_DB_URL"]
    conn = psycopg.connect(dsn, row_factory=dict_row, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


def _create_test_api_key(
    conn: psycopg.Connection, owner_uid: str, *, exchange: str = "binance"
) -> str:
    """Insert an api_keys row owned by ``owner_uid``; return the new key id."""
    kid = str(uuid.uuid4())
    label = f"phase-35-rls-{uuid.uuid4().hex[:8]}"
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.api_keys "
            "(id, user_id, exchange, label, api_key_encrypted) "
            "VALUES (%s, %s, %s, %s, 'test-placeholder')",
            (kid, owner_uid, exchange, label),
        )
    return kid


def _seed_per_key_row(
    conn: psycopg.Connection,
    *,
    api_key_id: str,
    allocator_id: str,
    date: str,
    daily_return: float,
) -> int:
    """Service-role INSERT a per-key row; return its surrogate id.

    allocator_id MUST equal api_keys.user_id or the owner-coherence BEFORE
    trigger rejects the write — callers pass the key owner's uid (which is also
    the RLS owner this test isolates on).
    """
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.csv_daily_returns "
            "(api_key_id, allocator_id, strategy_id, date, daily_return) "
            "VALUES (%s, %s, NULL, %s, %s) RETURNING id",
            (api_key_id, allocator_id, date, daily_return),
        )
        row = cur.fetchone()
    assert row is not None
    return int(row["id"])


def _cleanup_keys(conn: psycopg.Connection, kids: list[str]) -> None:
    if not kids:
        return
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM public.csv_daily_returns WHERE api_key_id = ANY(%s)",
            (kids,),
        )
        cur.execute("DELETE FROM public.api_keys WHERE id = ANY(%s)", (kids,))


class TestPerKeyCrossTenantRls:
    """DAILIES-04 — allocator A cannot read allocator B's per-key dailies."""

    def test_owner_sees_own_but_not_others_per_key_rows(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner_a = _create_test_user(service_role_conn)
        owner_b = _create_test_user(service_role_conn)
        key_a = _create_test_api_key(service_role_conn, owner_a)
        key_b = _create_test_api_key(service_role_conn, owner_b)
        try:
            row_a_id = _seed_per_key_row(
                service_role_conn, api_key_id=key_a, allocator_id=owner_a,
                date="2024-04-01", daily_return=0.11,
            )
            row_b_id = _seed_per_key_row(
                service_role_conn, api_key_id=key_b, allocator_id=owner_b,
                date="2024-04-01", daily_return=0.22,
            )

            # Authenticated as A: must see A's row id, must NOT see B's row id.
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    _set_authenticated(cur, owner_a)
                    cur.execute(
                        "SELECT id FROM public.csv_daily_returns "
                        "WHERE api_key_id IS NOT NULL AND date = '2024-04-01'"
                    )
                    visible_ids = {r["id"] for r in cur.fetchall()}

            assert row_a_id in visible_ids, (
                "positive control failed: allocator A cannot see A's OWN per-key "
                "row — csv_daily_returns_allocator_owner_select must admit the "
                "owner (allocator_id = auth.uid()), not blanket-deny."
            )
            assert row_b_id not in visible_ids, (
                f"CROSS-TENANT LEAK: allocator A saw allocator B's per-key row "
                f"(id={row_b_id}). RLS fails silently to empty rows, so this "
                f"content-level absence is the real isolation proof. Visible ids "
                f"for A: {visible_ids!r}."
            )
        finally:
            _cleanup_keys(service_role_conn, [key_a, key_b])
            _cleanup(service_role_conn, uids=[owner_a, owner_b], sids=[])

    def test_strategy_owner_policy_does_not_leak_per_key_rows(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        """The existing strategy-owner policy is
        ``strategy_id IN (SELECT id FROM strategies WHERE user_id = auth.uid())``.
        A per-key row has strategy_id NULL, so ``NULL IN (...)`` is never TRUE —
        the strategy policy must not become a second (leaky) path to another
        allocator's per-key rows. Authenticate as a user who owns NO api_key but
        DOES own strategies, and assert they see zero per-key rows."""
        owner_keys = _create_test_user(service_role_conn)
        strat_only_user = _create_test_user(service_role_conn)
        key = _create_test_api_key(service_role_conn, owner_keys)
        try:
            row_id = _seed_per_key_row(
                service_role_conn, api_key_id=key, allocator_id=owner_keys,
                date="2024-04-02", daily_return=0.33,
            )
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    _set_authenticated(cur, strat_only_user)
                    cur.execute(
                        "SELECT id FROM public.csv_daily_returns "
                        "WHERE api_key_id IS NOT NULL AND date = '2024-04-02'"
                    )
                    visible_ids = {r["id"] for r in cur.fetchall()}
            assert row_id not in visible_ids, (
                "strategy-owner policy leaked a per-key row to a non-owner: "
                "NULL strategy_id must make the strategy policy non-matching for "
                "per-key rows."
            )
        finally:
            _cleanup_keys(service_role_conn, [key])
            _cleanup(
                service_role_conn, uids=[owner_keys, strat_only_user], sids=[]
            )

    def test_service_role_sees_both_per_key_rows(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        """The worker write/read path runs as service_role (bypasses RLS) — it
        must see both allocators' rows so the derive job + backfill are
        unaffected by the new owner policy."""
        owner_a = _create_test_user(service_role_conn)
        owner_b = _create_test_user(service_role_conn)
        key_a = _create_test_api_key(service_role_conn, owner_a)
        key_b = _create_test_api_key(service_role_conn, owner_b)
        try:
            row_a_id = _seed_per_key_row(
                service_role_conn, api_key_id=key_a, allocator_id=owner_a,
                date="2024-04-03", daily_return=0.44,
            )
            row_b_id = _seed_per_key_row(
                service_role_conn, api_key_id=key_b, allocator_id=owner_b,
                date="2024-04-03", daily_return=0.55,
            )
            # No _set_authenticated → stays service_role.
            with service_role_conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM public.csv_daily_returns "
                    "WHERE api_key_id IS NOT NULL AND date = '2024-04-03'"
                )
                visible_ids = {r["id"] for r in cur.fetchall()}
            assert {row_a_id, row_b_id} <= visible_ids, (
                f"service_role must read both allocators' per-key rows; "
                f"saw {visible_ids!r}"
            )
        finally:
            _cleanup_keys(service_role_conn, [key_a, key_b])
            _cleanup(service_role_conn, uids=[owner_a, owner_b], sids=[])
