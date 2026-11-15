"""Phase 16 / OBSERV-03 — RLS assertion for resend_message_correlation table.

Asserted invariants:
  1. service_role can INSERT and SELECT rows (the migration GRANTs
     SELECT/INSERT/DELETE).
  2. anon role cannot SELECT (no anon policy AND no anon GRANT — both layers
     deny). This proves the cross-tenant isolation property: even if an
     attacker brute-forces a correlation_id, they cannot read the mapping
     table from a public-facing context.

Migration under test: supabase/migrations/20260515113637_resend_message_correlation.sql
(Plan 16-05). Test framework mirrors analytics-service/tests/test_trigger_rls_audit.py (Plan 16-04
deliverable). Phase 215: the DSN comes from the ``live_db_dsn`` fixture (``tests/live_db_dsn.py``), so the
module runs on the CI python job's lane via LANE_DB_URL, skips locally without it and fails under CI=true.

Test caveat: psycopg's `SET LOCAL ROLE anon` switches the session role to
the `anon` Postgres role; whether the GRANT layer or the RLS layer denies
first depends on whether the role has table-level privileges. We accept
either outcome as a pass — both encode the same isolation property.
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
    """Connection to the local-stack lane. Service-role context.

    ``connect_live_db`` refuses anything but the lane before returning; never TEST, never production.
    """
    conn = connect_live_db(live_db_dsn, autocommit=True, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture
def fresh_mapping_row(
    service_role_conn: psycopg.Connection,
) -> Iterator[tuple[str, str]]:
    """Insert + clean up a single row keyed by a fresh resend_message_id.

    Uses a unique uuid-suffixed message_id so parallel test runs do not
    collide on the resend_message_id UNIQUE constraint.
    """
    cid = str(uuid.uuid4())
    rmid = f"test-msg-{uuid.uuid4().hex[:12]}"
    with service_role_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.resend_message_correlation "
            "(correlation_id, resend_message_id) VALUES (%s, %s)",
            (cid, rmid),
        )
    try:
        yield (cid, rmid)
    finally:
        with service_role_conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.resend_message_correlation "
                "WHERE resend_message_id = %s",
                (rmid,),
            )


class TestResendCorrelationRls:
    """OBSERV-03: service_role can read; anon cannot."""

    def test_service_role_can_select(
        self,
        service_role_conn: psycopg.Connection,
        fresh_mapping_row: tuple[str, str],
    ) -> None:
        cid, rmid = fresh_mapping_row
        with service_role_conn.cursor() as cur:
            cur.execute(
                "SELECT correlation_id::text AS cid "
                "FROM public.resend_message_correlation "
                "WHERE resend_message_id = %s",
                (rmid,),
            )
            row = cur.fetchone()
        assert row is not None, "service_role SELECT returned no row"
        assert row["cid"] == cid

    def test_anon_role_denied_select(
        self,
        service_role_conn: psycopg.Connection,
        fresh_mapping_row: tuple[str, str],
    ) -> None:
        _cid, rmid = fresh_mapping_row
        # Switch to anon role within the same session. Two layers should deny:
        #   (a) anon has NO GRANT on the table -> InsufficientPrivilege error.
        #   (b) RLS-enabled with no anon policy -> zero rows even if (a) bypassed.
        # Accept either outcome as a pass — both encode the same isolation property.
        #
        # Phase 16 fix: SET LOCAL is scoped to the current transaction. The
        # connection fixture uses autocommit=True so each execute() is its
        # own implicit transaction — SET LOCAL would be rolled back before
        # the SELECT runs, silently leaving the role at service_role and
        # masking the RLS deny path. Open an explicit transaction with
        # `conn.transaction()` so SET LOCAL takes effect for the SELECT.
        with service_role_conn.transaction():
            with service_role_conn.cursor() as cur:
                cur.execute("SET LOCAL request.jwt.claim.role TO 'anon'")
                try:
                    cur.execute("SET LOCAL ROLE anon")
                    # Sentinel — prove the role switch actually took effect
                    # before we trust the SELECT result. Under autocommit
                    # this assertion would fail (current_user stays
                    # service_role), surfacing the silent regression.
                    cur.execute("SELECT current_user AS who")
                    who = cur.fetchone()
                    assert who is not None and who["who"] == "anon", (
                        f"SET LOCAL ROLE anon did not take effect; "
                        f"current_user={who['who'] if who else None!r}. "
                        "Likely cause: missing transaction wrapper under "
                        "autocommit=True."
                    )
                    cur.execute(
                        "SELECT * FROM public.resend_message_correlation "
                        "WHERE resend_message_id = %s",
                        (rmid,),
                    )
                    rows = cur.fetchall()
                    assert rows == [], (
                        f"anon role read {len(rows)} rows from "
                        "resend_message_correlation — RLS / GRANT layer failed"
                    )
                except psycopg.errors.InsufficientPrivilege:
                    # GRANT layer denied first — also a pass.
                    pass
                # Note: NO `RESET ROLE` in finally. Inside `with conn.transaction()`,
                # SET LOCAL is transaction-scoped and reverts automatically on
                # COMMIT/ROLLBACK. Adding RESET ROLE here would itself raise
                # InFailedSqlTransaction whenever the SELECT raised
                # InsufficientPrivilege (the GRANT-deny production path) because
                # the transaction enters aborted state — and that exception is a
                # different class than the one the except clause catches, so it
                # would escape and fail the test on the very deny path it accepts.
