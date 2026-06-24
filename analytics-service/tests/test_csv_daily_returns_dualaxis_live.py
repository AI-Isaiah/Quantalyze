"""Phase 35 (DAILIES-01) — Live-DB tests for the dual-axis csv_daily_returns.

Gated on TEST_SUPABASE_DB_URL (same gate as test_persist_csv_daily_returns_live).
CI without secrets skips cleanly with a verbose ``reason=`` (Rule 12: silent
skips are a fail-loud violation).

After migration 20260624120000_csv_daily_returns_per_key_axis, csv_daily_returns
carries BOTH the existing strategy axis AND a new per-key axis:

  - surrogate PK ``id`` (BIGINT identity); ``strategy_id`` now NULLABLE;
  - ``api_key_id`` UUID FK→api_keys + ``allocator_id`` UUID FK→auth.users;
  - CHECK ``csv_daily_returns_source_xor`` = num_nonnulls(strategy_id, api_key_id)=1;
  - CHECK ``csv_daily_returns_per_key_allocator`` = api_key_id IS NULL OR allocator_id IS NOT NULL;
  - two NON-partial unique indexes ``csv_daily_returns_strategy_date_key`` and
    ``csv_daily_returns_api_key_date_key`` (NULLs-distinct keeps each row-type
    isolated AND keeps the bare ON CONFLICT upsert resolving).

These tests prove the load-bearing DDL behaviors that the unit tests (which mock
the DB) cannot: the NULLs-distinct coexistence on both axes, both upsert
arbiters resolving (no 42P10), and the three CHECK rejections (23514). They run
against the live PG17 TEST instance where the migration is applied.
"""
from __future__ import annotations

import os
import uuid
from typing import Iterator

import psycopg
import pytest
from psycopg.rows import dict_row

# Reuse the proven live-test harness from the persist suite — same TEST DSN,
# same auth.users/profiles seeding (the on_auth_user_created trigger creates the
# profiles row api_keys.user_id FK→profiles needs), same FK-safe teardown.
from tests.test_persist_csv_daily_returns_live import (
    _cleanup,
    _create_test_strategy,
    _create_test_user,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_SUPABASE_DB_URL"),
    reason="Live test Supabase project not configured (TEST_SUPABASE_DB_URL unset). "
    "See MEMORY reference_test_supabase_project.md for the qmnijlgmdhviwzwfyzlc setup. "
    "These tests pin the Phase 35 dual-axis csv_daily_returns DDL (DAILIES-01).",
)


@pytest.fixture
def service_role_conn() -> Iterator[psycopg.Connection]:
    """psycopg connection (autocommit) against the TEST Supabase DSN.

    DSN must point at qmnijlgmdhviwzwfyzlc; never production.
    """
    dsn = os.environ["TEST_SUPABASE_DB_URL"]
    conn = psycopg.connect(dsn, row_factory=dict_row, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


def _create_test_api_key(
    conn: psycopg.Connection, owner_uid: str, *, exchange: str = "binance"
) -> str:
    """Insert an api_keys row owned by ``owner_uid``; return the new key id.

    Supplies exactly the NOT NULL columns the live schema requires
    (user_id, exchange, label, api_key_encrypted) — every other column has a
    default (mirrors the migration fixtures, e.g. b5b_api_key_delete_atomicity).
    """
    kid = str(uuid.uuid4())
    label = f"phase-35-{uuid.uuid4().hex[:8]}"
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.api_keys "
            "(id, user_id, exchange, label, api_key_encrypted) "
            "VALUES (%s, %s, %s, %s, 'test-placeholder')",
            (kid, owner_uid, exchange, label),
        )
    return kid


def _cleanup_keys(conn: psycopg.Connection, kids: list[str]) -> None:
    """Delete per-key rows then the api_keys themselves (FK-safe).

    csv_daily_returns.api_key_id FK→api_keys ON DELETE CASCADE would clean the
    rows on the key delete, but we delete explicitly first so a partial failure
    still leaves no orphaned per-key rows.
    """
    if not kids:
        return
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM public.csv_daily_returns WHERE api_key_id = ANY(%s)",
            (kids,),
        )
        cur.execute("DELETE FROM public.api_keys WHERE id = ANY(%s)", (kids,))


def _insert_per_key_row(
    cur: psycopg.Cursor,
    *,
    api_key_id: str,
    allocator_id: str,
    date: str,
    daily_return: float,
) -> None:
    cur.execute(
        "INSERT INTO public.csv_daily_returns "
        "(api_key_id, allocator_id, strategy_id, date, daily_return) "
        "VALUES (%s, %s, NULL, %s, %s)",
        (api_key_id, allocator_id, date, daily_return),
    )


def _insert_strategy_row(
    cur: psycopg.Cursor, *, strategy_id: str, date: str, daily_return: float
) -> None:
    cur.execute(
        "INSERT INTO public.csv_daily_returns "
        "(strategy_id, date, daily_return) VALUES (%s, %s, %s)",
        (strategy_id, date, daily_return),
    )


class TestNullsDistinctCoexistence:
    """DAILIES-01 — the two NON-partial unique indexes rely on PG's default
    NULLs-distinct semantics so each row-type is isolated: many per-key rows
    (strategy_id NULL) coexist on the same date, and many strategy rows
    (api_key_id NULL) coexist on the same date."""

    def test_two_per_key_rows_same_date_diff_key_coexist(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        key_a = _create_test_api_key(service_role_conn, owner)
        key_b = _create_test_api_key(service_role_conn, owner)
        try:
            with service_role_conn.cursor() as cur:
                # Same date, DIFFERENT api_key_id — must NOT collide on
                # csv_daily_returns_api_key_date_key (strategy_id is NULL on both,
                # but NULLs are distinct so the index keys on (api_key, date)).
                _insert_per_key_row(
                    cur, api_key_id=key_a, allocator_id=owner,
                    date="2024-03-01", daily_return=0.01,
                )
                _insert_per_key_row(
                    cur, api_key_id=key_b, allocator_id=owner,
                    date="2024-03-01", daily_return=0.02,
                )
                cur.execute(
                    "SELECT api_key_id, daily_return FROM public.csv_daily_returns "
                    "WHERE api_key_id = ANY(%s) AND date = '2024-03-01' "
                    "ORDER BY daily_return",
                    ([key_a, key_b],),
                )
                rows = cur.fetchall()
            assert len(rows) == 2, (
                f"two per-key rows (same date, different api_key_id) must coexist "
                f"under the NON-partial NULLs-distinct unique index; got {rows!r}"
            )
            assert {r["api_key_id"] for r in rows} == {
                uuid.UUID(key_a),
                uuid.UUID(key_b),
            }
        finally:
            _cleanup_keys(service_role_conn, [key_a, key_b])
            _cleanup(service_role_conn, uids=[owner], sids=[])

    def test_two_strategy_rows_same_date_diff_strategy_coexist(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        sid_a = _create_test_strategy(service_role_conn, owner)
        sid_b = _create_test_strategy(service_role_conn, owner)
        try:
            with service_role_conn.cursor() as cur:
                # Same date, DIFFERENT strategy_id — must NOT collide on
                # csv_daily_returns_strategy_date_key (api_key_id is NULL on both).
                _insert_strategy_row(
                    cur, strategy_id=sid_a, date="2024-03-02", daily_return=0.03,
                )
                _insert_strategy_row(
                    cur, strategy_id=sid_b, date="2024-03-02", daily_return=0.04,
                )
                cur.execute(
                    "SELECT strategy_id FROM public.csv_daily_returns "
                    "WHERE strategy_id = ANY(%s) AND date = '2024-03-02'",
                    ([sid_a, sid_b],),
                )
                rows = cur.fetchall()
            assert len(rows) == 2, (
                f"two strategy rows (same date, different strategy_id) must coexist; "
                f"got {rows!r}"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid_a, sid_b])


class TestUpsertArbitersResolve:
    """DAILIES-01 / strategy non-regression — both bare ON CONFLICT targets
    resolve against the non-partial unique indexes (no 42P10), and a re-insert
    UPDATEs rather than duplicating."""

    def test_strategy_upsert_arbiter_survives(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        try:
            with service_role_conn.cursor() as cur:
                # First insert, then an ON CONFLICT (strategy_id, date) DO UPDATE —
                # resolves against csv_daily_returns_strategy_date_key. A dropped
                # uniqueness would either 42P10 here or silently duplicate.
                _insert_strategy_row(
                    cur, strategy_id=sid, date="2024-03-03", daily_return=0.05,
                )
                cur.execute(
                    "INSERT INTO public.csv_daily_returns "
                    "(strategy_id, date, daily_return) VALUES (%s, %s, %s) "
                    "ON CONFLICT (strategy_id, date) DO UPDATE "
                    "SET daily_return = EXCLUDED.daily_return",
                    (sid, "2024-03-03", 0.09),
                )
                cur.execute(
                    "SELECT count(*) AS n, max(daily_return) AS dr "
                    "FROM public.csv_daily_returns "
                    "WHERE strategy_id = %s AND date = '2024-03-03'",
                    (sid,),
                )
                row = cur.fetchone()
            assert row is not None and row["n"] == 1, (
                "strategy ON CONFLICT (strategy_id, date) must UPDATE not duplicate"
            )
            assert row["dr"] == pytest.approx(0.09), (
                "the second write must update daily_return (arbiter resolved)"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])

    def test_per_key_upsert_arbiter_resolves(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        key = _create_test_api_key(service_role_conn, owner)
        try:
            with service_role_conn.cursor() as cur:
                _insert_per_key_row(
                    cur, api_key_id=key, allocator_id=owner,
                    date="2024-03-04", daily_return=0.06,
                )
                # ON CONFLICT (api_key_id, date) must resolve against
                # csv_daily_returns_api_key_date_key — this is the exact arbiter
                # the dual-mode derive job's on_conflict="api_key_id,date" uses.
                cur.execute(
                    "INSERT INTO public.csv_daily_returns "
                    "(api_key_id, allocator_id, strategy_id, date, daily_return) "
                    "VALUES (%s, %s, NULL, %s, %s) "
                    "ON CONFLICT (api_key_id, date) DO UPDATE "
                    "SET daily_return = EXCLUDED.daily_return",
                    (key, owner, "2024-03-04", 0.07),
                )
                cur.execute(
                    "SELECT count(*) AS n, max(daily_return) AS dr "
                    "FROM public.csv_daily_returns "
                    "WHERE api_key_id = %s AND date = '2024-03-04'",
                    (key,),
                )
                row = cur.fetchone()
            assert row is not None and row["n"] == 1, (
                "per-key ON CONFLICT (api_key_id, date) must UPDATE not duplicate"
            )
            assert row["dr"] == pytest.approx(0.07)
        finally:
            _cleanup_keys(service_role_conn, [key])
            _cleanup(service_role_conn, uids=[owner], sids=[])


class TestCheckConstraintsReject:
    """DAILIES-01 — the XOR and per-key-allocator CHECKs reject malformed rows
    at write time (23514)."""

    def test_xor_rejects_both_axes_set(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        key = _create_test_api_key(service_role_conn, owner)
        try:
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    with pytest.raises(psycopg.errors.CheckViolation) as exc:
                        cur.execute(
                            "INSERT INTO public.csv_daily_returns "
                            "(strategy_id, api_key_id, allocator_id, date, daily_return) "
                            "VALUES (%s, %s, %s, %s, %s)",
                            (sid, key, owner, "2024-03-05", 0.01),
                        )
            # num_nonnulls(strategy_id, api_key_id) = 2 → fails the XOR.
            assert "csv_daily_returns_source_xor" in str(exc.value), (
                f"both-axes-set must violate the XOR check; got {exc.value!r}"
            )
        finally:
            _cleanup_keys(service_role_conn, [key])
            _cleanup(service_role_conn, uids=[owner], sids=[sid])

    def test_xor_rejects_neither_axis_set(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        try:
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    with pytest.raises(psycopg.errors.CheckViolation) as exc:
                        cur.execute(
                            "INSERT INTO public.csv_daily_returns "
                            "(strategy_id, api_key_id, allocator_id, date, daily_return) "
                            "VALUES (NULL, NULL, NULL, %s, %s)",
                            ("2024-03-06", 0.01),
                        )
            # num_nonnulls(NULL, NULL) = 0 → fails the XOR.
            assert "csv_daily_returns_source_xor" in str(exc.value), (
                f"neither-axis-set must violate the XOR check; got {exc.value!r}"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[])

    def test_per_key_row_missing_allocator_rejected(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        key = _create_test_api_key(service_role_conn, owner)
        try:
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    with pytest.raises(psycopg.errors.CheckViolation) as exc:
                        # api_key_id set but allocator_id NULL — violates
                        # csv_daily_returns_per_key_allocator. (The owner-coherence
                        # BEFORE trigger also guards allocator_id, but the CHECK is
                        # the constraint this test pins.)
                        cur.execute(
                            "INSERT INTO public.csv_daily_returns "
                            "(api_key_id, allocator_id, strategy_id, date, daily_return) "
                            "VALUES (%s, NULL, NULL, %s, %s)",
                            (key, "2024-03-07", 0.01),
                        )
            assert "csv_daily_returns_per_key_allocator" in str(exc.value), (
                f"per-key row without allocator must violate the per-key CHECK; "
                f"got {exc.value!r}"
            )
        finally:
            _cleanup_keys(service_role_conn, [key])
            _cleanup(service_role_conn, uids=[owner], sids=[])
