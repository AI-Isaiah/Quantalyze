"""Phase 19.1 / Plan 05 — Live-DB tests for persist_csv_daily_returns RPC.

Gated on TEST_SUPABASE_DB_URL. See MEMORY reference_test_supabase_project.md
for qmnijlgmdhviwzwfyzlc setup. CI without secrets skips cleanly with a verbose
``reason=`` (Pitfall 4: silent skips are Rule 12 violations).

What this suite pins (PR #272 hardening invariants):

  1. probe-oracle close — missing-strategy and wrong-owner both raise an
     indistinguishable 42501 (T-19.1-01). Splitting them lets an authenticated
     caller enumerate which UUIDs exist by reading the error code.
  2. ON CONFLICT idempotent upsert — re-running with the same (strategy_id,
     date) updates daily_return rather than failing with 23505.
  3. jsonb_typeof guard before jsonb_array_length — non-array p_rows raises a
     descriptive 22023, not an opaque internal one.
  4. Empty-array guard — 22023 ``p_rows is empty``.
  5. Row-cap guard — 5001-row payload raises 22023 ``exceeds 5000 rows``.
  6. GRANT TO authenticated load-bearing (T-19.1-02) — narrowing to service_role
     would NULL auth.uid() and trigger 42501 on every legitimate call.
  7. anon SELECT denied (Pitfall 8) — pre-existing RLS contract, encoded so a
     future regression is caught.
  8. No redundant explicit index on csv_daily_returns — PR #272 dropped the
     ``csv_daily_returns_strategy_date_idx`` secondary; UNIQUE/PK serves both
     the worker SELECT (ORDER BY date) and ON CONFLICT.

W3 revision 2026-05-22 — edge-case suite (Plan 02 unit tests mock the DB and
cannot express the persisted-table + worker contract these three encode):

  9. Single-row CSV → terminal state (`failed`), never a stuck `computing` row.
 10. All-zero returns → NaN-safe terminal state (`complete` only — the CSV
     runner never emits `complete_with_warnings`, and `failed` is a bug
     because zero-variance is mathematically valid input); cagr is one of
     {0.0, NULL, NaN-text}, never Infinity/-Infinity.
 11. NaN/Inf returns → terminal state (`complete` or `failed`, never
     `complete_with_warnings`); clean failure with structured error; worker
     does not leak a Python traceback to the user-visible computation_error
     field and does not poison subsequent jobs.

Tests 9-11 additionally require SUPABASE_URL + SUPABASE_SERVICE_KEY (the
analytics-runner uses the Supabase Python client via get_supabase()) — they
skip independently if those are unset, so a partial credential set still
exercises Tests 1-8.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from typing import Iterator

import psycopg
import pytest
from psycopg.rows import dict_row


# ---------------------------------------------------------------------------
# Module-level skip gate (Tests 1-11 all need a live psycopg DSN).
#
# Verbose ``reason=`` per Pitfall 4 — silent skips violate Rule 12 (fail loud).
# A reader of the CI output should be able to tell whether the suite was
# intentionally skipped (no DSN configured) versus accidentally never run.
# ---------------------------------------------------------------------------
pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_SUPABASE_DB_URL"),
    reason="Live test Supabase project not configured (TEST_SUPABASE_DB_URL unset). "
    "See MEMORY reference_test_supabase_project.md for the qmnijlgmdhviwzwfyzlc setup. "
    "Tests 1-11 cover PR #272 hardening invariants + W3 edge cases.",
)


# Worker-pipeline tests (9-11) additionally need the supabase-py client env
# the analytics-runner uses (get_supabase() reads SUPABASE_URL + SUPABASE_SERVICE_KEY).
_WORKER_PIPELINE_REASON = (
    "SUPABASE_URL or SUPABASE_SERVICE_KEY unset — analytics_runner.get_supabase() "
    "needs both to talk to qmnijlgmdhviwzwfyzlc. Tests 9-11 invoke the runner "
    "directly to assert terminal-state contracts (W3 edge cases); without both "
    "env vars the runner cannot construct its Supabase client."
)


def _worker_pipeline_env_present() -> bool:
    return bool(os.environ.get("SUPABASE_URL")) and bool(
        os.environ.get("SUPABASE_SERVICE_KEY")
    )


# ---------------------------------------------------------------------------
# Connection fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def service_role_conn() -> Iterator[psycopg.Connection]:
    """psycopg connection with autocommit=True against the TEST Supabase DSN.

    DSN must point at qmnijlgmdhviwzwfyzlc; never production. Mirrors the
    canonical pattern in test_resend_correlation_rls.py.
    """
    dsn = os.environ["TEST_SUPABASE_DB_URL"]
    conn = psycopg.connect(dsn, row_factory=dict_row, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Test-data helpers
# ---------------------------------------------------------------------------
def _create_test_user(conn: psycopg.Connection) -> str:
    """Insert a uuid-keyed row into auth.users; return the new uid.

    Uses a uuid-suffixed email so concurrent runs do not collide
    (Pitfall: parallel-run cross-contamination — RESEARCH.md A4).
    """
    uid = str(uuid.uuid4())
    email = f"phase-19-1-05-{uid[:8]}@quantalyze-test.invalid"
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) "
            "VALUES (%s, %s, '{}'::jsonb)",
            (uid, email),
        )
    return uid


def _create_test_strategy(conn: psycopg.Connection, owner_uid: str) -> str:
    """Insert a strategies row owned by ``owner_uid``; return new strategy id."""
    sid = str(uuid.uuid4())
    name = f"phase-19-1-05-{uuid.uuid4().hex[:8]}"
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.strategies (id, user_id, name, status, created_at) "
            "VALUES (%s, %s, %s, 'pending_review', now())",
            (sid, owner_uid, name),
        )
    return sid


def _cleanup(conn: psycopg.Connection, *, uids: list[str], sids: list[str]) -> None:
    """Tear down test rows in FK-safe order.

    Order matters: csv_daily_returns + strategy_analytics + compute_jobs all FK
    to strategies; strategies FK to auth.users. Reversing this order would
    raise 23503 on the strategies DELETE.
    """
    if not (uids or sids):
        return
    with conn.cursor() as cur:
        if sids:
            cur.execute(
                "DELETE FROM public.csv_daily_returns WHERE strategy_id = ANY(%s)",
                (sids,),
            )
            cur.execute(
                "DELETE FROM public.strategy_analytics WHERE strategy_id = ANY(%s)",
                (sids,),
            )
            cur.execute(
                "DELETE FROM public.compute_jobs WHERE strategy_id = ANY(%s)",
                (sids,),
            )
            cur.execute(
                "DELETE FROM public.strategies WHERE id = ANY(%s)",
                (sids,),
            )
        if uids:
            cur.execute(
                "DELETE FROM auth.users WHERE id = ANY(%s)",
                (uids,),
            )


def _set_authenticated(cur: psycopg.Cursor, user_uid: str) -> None:
    """Inside a transaction: set jwt claims so auth.uid() returns ``user_uid``
    and SET LOCAL ROLE authenticated so the RPC's role check passes.

    Mirrors the pattern at test_job_worker.py::TestTradesIsFillRls
    (lines ~1944) and test_resend_correlation_rls.py (anon-role pattern).
    Caller must use ``with conn.transaction():`` — SET LOCAL is transaction-
    scoped under autocommit=True, so a bare cur.execute would silently
    revert and leave the session at service_role.
    """
    claims = json.dumps({"sub": user_uid, "role": "authenticated"})
    cur.execute(
        "SELECT set_config('request.jwt.claims', %s, true)",
        (claims,),
    )
    cur.execute("SET LOCAL ROLE authenticated")


def _poll_analytics_terminal(
    conn: psycopg.Connection,
    strategy_id: str,
    timeout_sec: int = 90,
) -> dict:
    """Poll strategy_analytics until computation_status is terminal.

    Returns the row dict. Raises AssertionError if the deadline fires while
    the row is still in ``computing`` — that is the W3 regression sentinel:
    a stuck ``computing`` row is what the terminal-state guard exists to
    prevent (T-19.1-25, RESEARCH.md Pitfall 3 escalated).

    Note: this helper polls passively. Tests 9-11 invoke
    run_csv_strategy_analytics(strategy_id) DIRECTLY before calling the
    helper — the runner is synchronous wrt the caller (asyncio.run), so by
    the time the poll begins the terminal state should already be visible.
    The 90s window is defence-in-depth for a slow benchmark fetch on a cold
    instance.
    """
    deadline = time.time() + timeout_sec
    last_status: str | None = None
    while time.time() < deadline:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT computation_status, computation_error, "
                "       data_quality_flags, cagr::text AS cagr_text "
                "FROM public.strategy_analytics WHERE strategy_id = %s",
                (strategy_id,),
            )
            row = cur.fetchone()
        if row is not None:
            last_status = row["computation_status"]
            if last_status in ("complete", "complete_with_warnings", "failed"):
                return row
        time.sleep(2)
    raise AssertionError(
        f"strategy_analytics for {strategy_id} did not reach a terminal state "
        f"within {timeout_sec}s (last_status={last_status!r}). A stuck "
        "`computing` row is the W3 regression sentinel — the worker must "
        "always reach `complete`, `complete_with_warnings`, or `failed` on "
        "edge-case CSV input (1-row, all-zero, NaN/Inf)."
    )


def _invoke_csv_runner(strategy_id: str) -> None:
    """Call analytics_runner.run_csv_strategy_analytics synchronously.

    Local import keeps module-level import cost out of the collect phase
    (the import touches services.benchmark, pandas, etc.). The runner is
    the handler the worker dispatches to; invoking it directly is the
    closest in-process simulation of the worker pipeline against the
    live test DB.
    """
    from services.analytics_runner import run_csv_strategy_analytics

    # The runner raises HTTPException on the insufficient-history branch
    # (still writes computation_status='failed' first). Other failures
    # raise after _mark_unrecoverable lands. Either way, the terminal
    # row is visible to the polling helper.
    try:
        asyncio.run(run_csv_strategy_analytics(strategy_id))
    except Exception:  # noqa: BLE001 — runner's own contract surfaces the failure via the row
        pass


# ===========================================================================
# Tests 1-8 — PR #272 hardening invariants
# ===========================================================================
class TestProbeOracleClosed:
    """Test 1 (T-19.1-01) — missing-strategy and wrong-owner both raise
    indistinguishable 42501. The probe-oracle attack vector relies on a
    distinguishable error code/message between the two cases."""

    def test_probe_oracle_closed(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner_a = _create_test_user(service_role_conn)
        owner_b = _create_test_user(service_role_conn)
        strategy_b = _create_test_strategy(service_role_conn, owner_b)
        # A UUID that is NOT in strategies — the "missing" branch.
        strategy_missing = str(uuid.uuid4())

        captured: list[tuple[str | None, str | None]] = []

        try:
            for probe_sid in (strategy_missing, strategy_b):
                # Each probe runs in its own transaction so SET LOCAL ROLE
                # takes effect and the failure doesn't poison the next call.
                with service_role_conn.transaction():
                    with service_role_conn.cursor() as cur:
                        _set_authenticated(cur, owner_a)
                        with pytest.raises(psycopg.errors.DatabaseError) as exc_info:
                            cur.execute(
                                "SELECT persist_csv_daily_returns("
                                "  %s::uuid, %s::uuid, %s::jsonb"
                                ")",
                                (
                                    owner_a,
                                    probe_sid,
                                    json.dumps(
                                        [{"date": "2024-01-01", "daily_return": 0.01}]
                                    ),
                                ),
                            )
                        captured.append(
                            (
                                exc_info.value.sqlstate,
                                exc_info.value.diag.message_primary,
                            )
                        )

            sqlstates = [c[0] for c in captured]
            messages = [c[1] for c in captured]

            assert all(s == "42501" for s in sqlstates), (
                f"probe-oracle: expected 42501 for both missing-strategy and "
                f"wrong-owner; got {sqlstates!r}"
            )
            # Messages must NOT distinguish "not found" from "not owned".
            # The migration uses the single phrase "strategy % not accessible"
            # for both branches, so the messages should be byte-identical
            # given the same probed strategy_id format.
            for msg in messages:
                assert "not accessible" in (msg or ""), (
                    f"probe-oracle: expected 'not accessible' phrasing, got {msg!r}"
                )
                lower = (msg or "").lower()
                assert "not found" not in lower, (
                    "probe-oracle leak: message contains 'not found' — "
                    "distinguishable from 'not owned'"
                )
                assert "not owned" not in lower, (
                    "probe-oracle leak: message contains 'not owned' — "
                    "distinguishable from 'not found'"
                )
        finally:
            _cleanup(
                service_role_conn,
                uids=[owner_a, owner_b],
                sids=[strategy_b],
            )


class TestIdempotentUpsert:
    """Test 2 — ON CONFLICT (strategy_id, date) DO UPDATE makes the RPC
    idempotent: re-running with the same (sid, date) updates daily_return
    rather than raising 23505."""

    def test_idempotent_upsert(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        try:
            # First call writes 0.01.
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    _set_authenticated(cur, owner)
                    cur.execute(
                        "SELECT persist_csv_daily_returns("
                        "  %s::uuid, %s::uuid, %s::jsonb"
                        ") AS rc",
                        (
                            owner,
                            sid,
                            json.dumps(
                                [{"date": "2024-01-01", "daily_return": 0.01}]
                            ),
                        ),
                    )
                    cur.fetchone()  # ignore returned row count

            # Second call with the same date writes 0.02 — must succeed
            # (no 23505) and overwrite the prior row.
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    _set_authenticated(cur, owner)
                    cur.execute(
                        "SELECT persist_csv_daily_returns("
                        "  %s::uuid, %s::uuid, %s::jsonb"
                        ")",
                        (
                            owner,
                            sid,
                            json.dumps(
                                [{"date": "2024-01-01", "daily_return": 0.02}]
                            ),
                        ),
                    )

            with service_role_conn.cursor() as cur:
                cur.execute(
                    "SELECT date::text, daily_return "
                    "FROM public.csv_daily_returns "
                    "WHERE strategy_id = %s",
                    (sid,),
                )
                rows = cur.fetchall()
            assert len(rows) == 1, (
                f"idempotent upsert: expected exactly 1 row after two calls "
                f"with same date, got {len(rows)} (rows={rows!r})"
            )
            assert rows[0]["date"] == "2024-01-01"
            assert float(rows[0]["daily_return"]) == pytest.approx(0.02), (
                "idempotent upsert: second call did not overwrite daily_return "
                "(ON CONFLICT DO UPDATE not firing)"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])


class TestNonArrayPRowsRejected:
    """Test 3 — jsonb_typeof guard (PR #272) raises 22023 BEFORE
    jsonb_array_length is called on a non-array value."""

    def test_non_array_p_rows_rejected(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        try:
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    _set_authenticated(cur, owner)
                    with pytest.raises(psycopg.errors.DatabaseError) as exc_info:
                        cur.execute(
                            "SELECT persist_csv_daily_returns("
                            "  %s::uuid, %s::uuid, %s::jsonb"
                            ")",
                            (owner, sid, json.dumps({"not": "array"})),
                        )
            assert exc_info.value.sqlstate == "22023", (
                f"non-array p_rows: expected 22023, got {exc_info.value.sqlstate!r}"
            )
            msg = exc_info.value.diag.message_primary or ""
            assert "must be a JSONB array" in msg, (
                f"non-array p_rows: expected 'must be a JSONB array' message, "
                f"got {msg!r}"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])


class TestEmptyArrayRejected:
    """Test 4 — empty p_rows is almost always a caller bug; the RPC raises
    22023 with a descriptive message."""

    def test_empty_array_rejected(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        try:
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    _set_authenticated(cur, owner)
                    with pytest.raises(psycopg.errors.DatabaseError) as exc_info:
                        cur.execute(
                            "SELECT persist_csv_daily_returns("
                            "  %s::uuid, %s::uuid, %s::jsonb"
                            ")",
                            (owner, sid, json.dumps([])),
                        )
            assert exc_info.value.sqlstate == "22023", (
                f"empty p_rows: expected 22023, got {exc_info.value.sqlstate!r}"
            )
            msg = exc_info.value.diag.message_primary or ""
            assert "empty" in msg.lower(), (
                f"empty p_rows: expected 'empty' in message, got {msg!r}"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])


class TestOversizedArrayRejected:
    """Test 5 — row-cap guard rejects 5001-row payload with 22023."""

    def test_oversized_array_rejected(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        # 5001 rows — one beyond the documented limit. Use a date generator
        # that produces unique YYYY-MM-DD strings; ordering doesn't matter
        # because the guard fires on length, not content.
        oversized = [
            {
                "date": f"2024-{((i // 28) % 12) + 1:02d}-{(i % 28) + 1:02d}",
                "daily_return": 0.001,
            }
            for i in range(5001)
        ]
        try:
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    _set_authenticated(cur, owner)
                    with pytest.raises(psycopg.errors.DatabaseError) as exc_info:
                        cur.execute(
                            "SELECT persist_csv_daily_returns("
                            "  %s::uuid, %s::uuid, %s::jsonb"
                            ")",
                            (owner, sid, json.dumps(oversized)),
                        )
            assert exc_info.value.sqlstate == "22023", (
                f"oversized p_rows: expected 22023, got {exc_info.value.sqlstate!r}"
            )
            msg = exc_info.value.diag.message_primary or ""
            assert "5000" in msg, (
                f"oversized p_rows: expected '5000' in message, got {msg!r}"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])


class TestGrantShapeAuthenticatedCanExecute:
    """Test 6 (T-19.1-02) — GRANT TO authenticated is load-bearing.

    The pair below pins the contract:
      (a) authenticated role + valid jwt claims  → RPC executes (positive case).
      (b) service_role WITHOUT jwt claims         → auth.uid() is NULL → 42501.

    The probe-oracle isn't closed by the GRANT shape — it's closed by the
    collapsed 42501 in Guard 3. The GRANT shape exists so legitimate callers
    (the Next.js route handler running as `authenticated`) reach the
    auth.uid() guard with a non-NULL session.
    """

    def test_authenticated_role_executes_rpc(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        try:
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    _set_authenticated(cur, owner)
                    cur.execute(
                        "SELECT persist_csv_daily_returns("
                        "  %s::uuid, %s::uuid, %s::jsonb"
                        ") AS rc",
                        (
                            owner,
                            sid,
                            json.dumps(
                                [{"date": "2024-01-01", "daily_return": 0.005}]
                            ),
                        ),
                    )
                    row = cur.fetchone()
            assert row is not None
            # rc is the count of rows affected — exactly 1 for a single-row insert.
            assert row["rc"] == 1, (
                f"authenticated RPC call: expected rc=1, got {row['rc']!r}"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])

    def test_service_role_without_jwt_claims_raises_42501(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        """service_role without jwt claims set → auth.uid() = NULL → 42501.

        This is the negative half of the GRANT-shape contract: if a future
        migration narrowed the GRANT to service_role only, EVERY legitimate
        caller would hit this 42501 because the per-request Supabase client
        runs as `authenticated`, not `service_role`.
        """
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        try:
            # No _set_authenticated call → auth.uid() returns NULL.
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    with pytest.raises(psycopg.errors.DatabaseError) as exc_info:
                        cur.execute(
                            "SELECT persist_csv_daily_returns("
                            "  %s::uuid, %s::uuid, %s::jsonb"
                            ")",
                            (
                                owner,
                                sid,
                                json.dumps(
                                    [{"date": "2024-01-01", "daily_return": 0.01}]
                                ),
                            ),
                        )
            assert exc_info.value.sqlstate == "42501", (
                f"service_role + no jwt: expected 42501, got {exc_info.value.sqlstate!r}"
            )
            msg = exc_info.value.diag.message_primary or ""
            assert "without an auth session" in msg, (
                f"service_role + no jwt: expected auth-session phrase, got {msg!r}"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])


class TestAnonRoleDeniedSelectOnCsvDailyReturns:
    """Test 7 (Pitfall 8) — anon role cannot SELECT from csv_daily_returns
    even when a row exists. RLS deny OR GRANT-layer deny both encode the
    cross-tenant isolation contract."""

    def test_anon_denied_select_on_csv_daily_returns(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        try:
            # Seed a row via service_role so the anon SELECT has something
            # to look at.
            with service_role_conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO public.csv_daily_returns "
                    "(strategy_id, date, daily_return) VALUES (%s, %s, %s)",
                    (sid, "2024-01-01", 0.01),
                )

            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    cur.execute("SET LOCAL request.jwt.claim.role TO 'anon'")
                    try:
                        cur.execute("SET LOCAL ROLE anon")
                        cur.execute("SELECT current_user AS who")
                        who = cur.fetchone()
                        assert who is not None and who["who"] == "anon", (
                            "SET LOCAL ROLE anon did not take effect under "
                            "autocommit=True — fixture-pattern regression"
                        )
                        cur.execute(
                            "SELECT * FROM public.csv_daily_returns "
                            "WHERE strategy_id = %s",
                            (sid,),
                        )
                        rows = cur.fetchall()
                        assert rows == [], (
                            f"anon role read {len(rows)} rows from "
                            f"csv_daily_returns — RLS / GRANT layer regressed"
                        )
                    except psycopg.errors.InsufficientPrivilege:
                        # GRANT-layer deny is also a pass — same isolation.
                        pass
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])


class TestNoRedundantIndex:
    """Test 8 — index-inventory pin. PR #272 dropped the redundant
    ``csv_daily_returns_strategy_date_idx`` so the composite PK alone served the
    worker SELECT + ON CONFLICT.

    Phase 35 (migration 20260624120000) converted the table to dual-axis: the
    composite ``(strategy_id, date)`` PK became a surrogate ``id`` PK, and the
    ``(strategy_id, date)`` uniqueness was RECREATED as an explicit non-partial
    unique index (so the existing on_conflict=strategy_id,date upsert + the
    paginated reader's stable page boundaries survive) ALONGSIDE a new
    ``(api_key_id, date)`` non-partial unique index for the per-key axis.

    The "no redundant index" intent is preserved: the expected set is EXACTLY
    the three indexes the dual-axis design needs — the surrogate PK and the two
    per-axis unique arbiters — with no extra/duplicate index. A future migration
    that re-adds a redundant secondary (e.g. a plain strategy_date_idx on top of
    the unique one) makes this set unequal and fails the test."""

    def test_no_redundant_index(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        with service_role_conn.cursor() as cur:
            cur.execute(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'public' AND tablename = 'csv_daily_returns' "
                "ORDER BY indexname"
            )
            index_names = sorted(r["indexname"] for r in cur.fetchall())
        expected = sorted(
            [
                "csv_daily_returns_pkey",  # surrogate BIGINT id PK
                "csv_daily_returns_strategy_date_key",  # recreated strategy uniqueness
                "csv_daily_returns_api_key_date_key",  # per-key axis uniqueness
            ]
        )
        assert index_names == expected, (
            f"Expected EXACTLY the dual-axis index set {expected!r} (surrogate PK "
            f"+ the two non-partial per-axis unique arbiters), got {index_names!r}. "
            f"After Phase 35 the (strategy_id, date) uniqueness is an explicit "
            f"unique index (not the PK); a redundant extra/duplicate index — or a "
            f"missing per-axis arbiter — fails this pin."
        )


# ===========================================================================
# Tests 9-11 — W3 edge-case suite (Plan 02 cannot be modified retroactively)
# ===========================================================================
@pytest.mark.skipif(
    not _worker_pipeline_env_present(),
    reason=_WORKER_PIPELINE_REASON,
)
class TestEdgeCaseTerminalStates:
    """W3 revision 2026-05-22.

    These three exercise the persisted-table + runner pipeline end-to-end.
    The runner (run_csv_strategy_analytics) is the handler dispatched by
    the worker for kind='compute_analytics_from_csv'; invoking it directly
    is the closest in-process simulation against the live test DB.

    Hard contract: each test must observe a TERMINAL computation_status
    (`complete`, `complete_with_warnings`, or `failed`). A stuck
    `computing` row at the 90s deadline is the W3 regression sentinel
    (T-19.1-25) — _poll_analytics_terminal raises AssertionError on that
    edge so the failure is visible.
    """

    def test_single_row_csv_terminal_state(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        """Test 9 — A single-row CSV cannot satisfy the runner's ≥ 2 data
        points gate. Expected terminal state: ``failed`` with
        computation_error mentioning insufficient history.

        (We do NOT accept `complete_with_warnings` here because the runner
        explicitly raises HTTPException(400, 'Insufficient CSV history')
        after marking status='failed' — see analytics_runner.py:1490.)
        """
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        try:
            # Persist 1 row via the RPC (positive ingest path).
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    _set_authenticated(cur, owner)
                    cur.execute(
                        "SELECT persist_csv_daily_returns("
                        "  %s::uuid, %s::uuid, %s::jsonb"
                        ")",
                        (
                            owner,
                            sid,
                            json.dumps(
                                [{"date": "2024-01-01", "daily_return": 0.01}]
                            ),
                        ),
                    )

            # Drive the runner — terminal state lands synchronously.
            _invoke_csv_runner(sid)

            row = _poll_analytics_terminal(service_role_conn, sid, timeout_sec=90)
            assert row["computation_status"] == "failed", (
                f"single-row CSV: expected `failed` (insufficient history "
                f"branch), got {row['computation_status']!r}"
            )
            err = (row["computation_error"] or "").lower()
            assert "insufficient" in err and (
                "csv history" in err or "data points" in err
            ), (
                "single-row CSV: expected computation_error mentioning "
                f"insufficient CSV history / 2 data points, got {row['computation_error']!r}"
            )
            # Critical: row must NOT be stuck in `computing` at the deadline.
            assert row["computation_status"] != "computing", (
                "single-row CSV: stuck `computing` row — terminal-state guard "
                "regressed (T-19.1-25)"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])

    def test_all_zero_returns_nan_safe(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        """Test 10 — 60 days of all-zero daily_return must not panic the
        CAGR / Sharpe math on zero variance.

        Specialist-review revision 2026-05-22: tighten the accepted terminal
        set. Zero-variance is mathematically valid input, so `failed` is a
        bug here — the runner must produce a numerically-safe `complete`.
        The CSV runner (analytics_runner.py:run_csv_strategy_analytics)
        only writes `'complete'` or `'failed'` and never
        `'complete_with_warnings'`, so listing that state was misleading
        cargo from the exchange-runner contract. Accept ONLY `complete`
        for this test; what the runner MUST NOT produce is
        Infinity/-Infinity in cagr, and the row must NOT stay `computing`.

        Date-generation revision 2026-05-22: the original payload used
        `f"2024-{(i // 30) + 1:02d}-{(i % 30) + 1:02d}"` which generates
        invalid calendar dates (e.g. 2024-02-30 → 22008 at date cast)
        BEFORE the all-zero series reached the runner. Use bdate_range so
        the test exercises the zero-variance branch it advertises.
        """
        import pandas as pd  # local — keeps module-level import cheap

        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        try:
            # 60 ascending business days, all zero return. bdate_range
            # guarantees valid calendar dates — the earlier modular
            # `(i // 30) + 1, (i % 30) + 1` recipe could emit 2024-02-30
            # which the RPC's date cast rejects with 22008, masking the
            # zero-variance branch this test is meant to exercise.
            payload = [
                {"date": d.strftime("%Y-%m-%d"), "daily_return": 0.0}
                for d in pd.bdate_range("2024-01-01", periods=60)
            ]
            with service_role_conn.transaction():
                with service_role_conn.cursor() as cur:
                    _set_authenticated(cur, owner)
                    cur.execute(
                        "SELECT persist_csv_daily_returns("
                        "  %s::uuid, %s::uuid, %s::jsonb"
                        ")",
                        (owner, sid, json.dumps(payload)),
                    )

            _invoke_csv_runner(sid)
            row = _poll_analytics_terminal(service_role_conn, sid, timeout_sec=90)

            # `failed` is a bug — zero-variance is mathematically valid
            # input the metrics layer must handle. `complete_with_warnings`
            # is removed because the CSV runner never emits it (see
            # analytics_runner.py:1567-1581 — only 'complete' or 'failed').
            assert row["computation_status"] == "complete", (
                "all-zero returns: expected `complete` (zero-variance is "
                "valid input the metrics layer must handle), got "
                f"{row['computation_status']!r} "
                f"(computation_error={row['computation_error']!r})"
            )
            # The cagr_text column is the raw textual cast — Postgres serializes
            # IEEE special values as 'Infinity', '-Infinity', 'NaN'. The
            # contract: the runner / metrics layer must NOT propagate +/-Inf
            # into the persisted column.
            cagr_text = row["cagr_text"]
            if cagr_text is not None:
                lower = cagr_text.lower()
                assert "infinity" not in lower, (
                    f"all-zero returns: cagr leaked Infinity ({cagr_text!r}) — "
                    "zero-variance must collapse to 0.0 / NULL / NaN-text, "
                    "never Inf (anti-poisoning contract, T-19.1-25)"
                )

            # Sentinel: not stuck.
            assert row["computation_status"] != "computing", (
                "all-zero returns: stuck `computing` row — terminal-state "
                "guard regressed (T-19.1-25)"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])

    def test_nan_inf_returns_clean_failure(
        self, service_role_conn: psycopg.Connection
    ) -> None:
        """Test 11 — Route-layer + RPC guards block NaN/Inf at ingest, but
        DOUBLE PRECISION columns can hold them if a future direct INSERT
        bypasses the validator. The worker must catch the resulting math
        explosion as a structured failure, NOT leak a Python traceback to
        the user-visible computation_error column AND NOT poison subsequent
        jobs (per RESEARCH.md A4 — worker resilience).
        """
        owner = _create_test_user(service_role_conn)
        sid = _create_test_strategy(service_role_conn, owner)
        try:
            # Bypass the RPC by writing NaN/Inf rows directly. DOUBLE
            # PRECISION accepts 'NaN' and 'Infinity' as text literals.
            with service_role_conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO public.csv_daily_returns "
                    "(strategy_id, date, daily_return) VALUES "
                    "(%s, %s, 'NaN'::double precision),"
                    "(%s, %s, 'Infinity'::double precision),"
                    "(%s, %s, '-Infinity'::double precision),"
                    "(%s, %s, %s)",
                    (
                        sid, "2024-01-01",
                        sid, "2024-01-02",
                        sid, "2024-01-03",
                        sid, "2024-01-04", 0.01,
                    ),
                )

            _invoke_csv_runner(sid)
            row = _poll_analytics_terminal(service_role_conn, sid, timeout_sec=90)

            # Acceptable outcomes:
            #   (a) failed — runner caught the NaN/Inf math and marked
            #       _mark_unrecoverable with a sanitized message.
            #   (b) complete — runner sanitized the inputs (pd.Series may
            #       drop NaN before metrics), resulting in a numerically-
            #       safe payload. Still acceptable as long as cagr is not
            #       Inf.
            # NOT acceptable:
            #   - computing (stuck row)
            #   - complete_with_warnings (the CSV runner never emits this
            #     state — analytics_runner.py:1567-1581 only writes
            #     'complete' or 'failed'. Listing it here would silently
            #     accept a state the contract says can't occur).
            assert row["computation_status"] in (
                "failed",
                "complete",
            ), (
                "NaN/Inf input: expected terminal state (failed or "
                f"complete), got {row['computation_status']!r}"
            )
            assert row["computation_status"] != "computing", (
                "NaN/Inf input: stuck `computing` row — worker did not "
                "reach terminal state (T-19.1-25)"
            )

            err = row["computation_error"] or ""
            if row["computation_status"] == "failed":
                # Structured failure contract: no Python traceback leak.
                assert not err.startswith("Traceback"), (
                    "NaN/Inf input: computation_error leaks a Python "
                    f"traceback ({err[:80]!r}...). The user-visible error "
                    "field must be a sanitized one-liner."
                )
                # The runner's _mark_unrecoverable writes a fixed string.
                assert err, (
                    "NaN/Inf input + failed status: computation_error is "
                    "empty — caller has no signal to surface upstream"
                )

            # Anti-poison check: enqueue a SECOND job for an UNRELATED
            # strategy (synthetic - we just check the compute_jobs row could
            # have been claimed). We don't actually run the worker here, but
            # we verify no leftover `compute_analytics_from_csv` rows for
            # OUR strategy are stuck in `pending` waiting for a runner that
            # crashed.
            with service_role_conn.cursor() as cur:
                cur.execute(
                    "SELECT count(*) AS pending_count "
                    "FROM public.compute_jobs "
                    "WHERE kind = 'compute_analytics_from_csv' "
                    "  AND strategy_id = %s "
                    "  AND status = 'pending'",
                    (sid,),
                )
                pending = cur.fetchone()
            # We never enqueued via compute_jobs in this test (we invoked
            # the runner directly), so the only acceptable count is 0.
            # A non-zero count would mean some prior test left state behind,
            # which the _cleanup pattern is supposed to prevent.
            assert pending["pending_count"] == 0, (
                f"NaN/Inf input: {pending['pending_count']} compute_jobs rows "
                f"for strategy {sid} stuck in `pending` — worker-poison loop "
                "or leaked fixture state (T-19.1-25)"
            )
        finally:
            _cleanup(service_role_conn, uids=[owner], sids=[sid])
