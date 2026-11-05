"""Phase 191 REFUSALRACE plan 09 - live two-connection probe of the metadata merge functions.

``public.mark_compute_job_kept_figures`` (the derive's refusal marker) and
``public.retract_ledger_refresh_marker`` (a Sync's retraction of an inherited ledger-refresh
marker) each change ``compute_jobs.metadata`` with ONE ``UPDATE`` that merges into the column.
The writers they replace read the whole object, edited a key and wrote the whole object back,
so whichever write landed between the other's read and write was undone.

Why only a live probe can prove the fix. The SQL gate
(``supabase/tests/test_compute_job_metadata_merge.sql``) is one session: it proves key
preservation in every order and the single-statement shape, but a single session cannot
interleave two statements, so it is green on a read-then-replace body too. Offline doubles are
only mirrors of the design. The concurrency claim rests on PostgreSQL's READ COMMITTED rule: a
blocked ``UPDATE`` re-evaluates its WHERE clause and its SET expression against the row version
the lock holder committed. This module demonstrates that on the real database CI runs:

* two psycopg connections, connection A (a transaction) takes the row lock inside one function,
  connection B calls the other function and BLOCKS on that lock; the probe reads
  ``pg_stat_activity`` from a third connection and requires B's ``wait_event_type`` to be
  ``Lock`` BEFORE A commits, so the race is exercised, not assumed. Both orders run, plus a
  claim-style key seeded first. Every key must survive.
* a CONTROL in the same harness runs the OLD read-then-replace (read, let the marker commit,
  write the stale copy) and requires the marker to be LOST, so a passing race case means the
  merge and not a harness that cannot see a lost key.
* the same two functions are called through real PostgREST by the services' own rpc-name
  constants, pinning the answer shapes the callers rely on (the marker answers a Python ``True``
  or ``False``, the retraction a ``dict``).

Own rows only (one auth user, strategy and compute_jobs row per test, deleted in ``finally``)
and LOOPBACK ONLY: the probe writes, and refuses any DSN whose host is not a loopback lane. Before any
write it also asks the connected database for its own comment and refuses unless that is the stock
comment of a fresh local-stack database (see ``_require_stock_database_comment``).

Gating. ``LANE_DB_URL`` is the python CI job's export of the local-stack lane's loopback DSN
(``.github/workflows/ci.yml``, "Lane handoff"). It is deliberately NOT ``TEST_SUPABASE_DB_URL``,
which is the shared-TEST secret's name and would un-skip 20+ psycopg modules. Unset locally the
probe skips; unset with ``CI == "true"`` it FAILS, so a green ``python`` job ran the race. The
PostgREST half reads ``SUPABASE_TEST_URL`` / ``SUPABASE_TEST_SERVICE_KEY`` (also the lane's).
The loopback-guard tests need no database and run with everything unset.
"""
from __future__ import annotations

import concurrent.futures
import ipaddress
import os
import time
import uuid
from typing import Any
from urllib.parse import urlparse

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict
from psycopg.types.json import Jsonb

try:
    from postgrest.exceptions import APIError
    from supabase import create_client
except ImportError:  # pragma: no cover
    create_client = None  # type: ignore[assignment]
    APIError = Exception  # type: ignore[assignment,misc]

from services.ingestion.long_fetch import RETRACT_REFRESH_MARKER_RPC
from services.job_worker import MARK_KEPT_FIGURES_RPC, READ_REFUSAL_KEPT_FIGURES_KEY
from tests.live_db_transport import wrap_live_db_client

LANE_DB_URL = os.getenv("LANE_DB_URL")
SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
# What a fresh local-stack database answers to ``shobj_description`` (measured on a booted lane).
# PROD and TEST each carry a hand-set comment naming themselves in its place.
_LANE_DATABASE_COMMENT = "default administrative connection database"
_LOCK_WAIT_BUDGET_S = 10.0
_NEW_CORRELATION_ID = "corr-new"
_OLD_MARKER = "ledger-refresh"
_MEMBER_PROGRESS = {"done": 2, "total": 5}


def _in_ci() -> bool:
    return os.getenv("CI", "").lower() == "true"


# --------------------------------------------------------------------------------------
# Loopback guard (T-191-25): this probe writes, and a DSN env var is a thing other jobs point
# at shared TEST. No database is needed to run the guard itself.
# --------------------------------------------------------------------------------------
def _require_loopback_dsn(dsn: str | None) -> None:
    """``pytest.fail`` unless every host (and ``hostaddr``) in ``dsn`` is a loopback spelling.

    A DSN naming no host is refused too: libpq would fall back to a unix socket or to
    ``PGHOST`` from the environment, and the probe must write only where the DSN says."""
    try:
        params = conninfo_to_dict(dsn or "")
    except psycopg.ProgrammingError:
        params = {}
    hosts = [h.strip() for h in str(params.get("host", "")).split(",")]
    addrs = [a.strip() for a in str(params.get("hostaddr", "")).split(",") if a.strip()]
    bad = [h for h in hosts if h not in _LOOPBACK_HOSTS] + [
        a for a in addrs if a not in _LOOPBACK_HOSTS
    ]
    if not params.get("host") or bad:
        pytest.fail(
            "test_compute_job_metadata_merge_live refuses to write: LANE_DB_URL does not name "
            f"only loopback hosts (host={params.get('host')!r}, hostaddr={params.get('hostaddr')!r}; "
            f"allowed {sorted(_LOOPBACK_HOSTS)}). Run it against the local-stack lane only "
            "(scripts/local-stack/run.sh up).",
            pytrace=False,
        )


def _server_addr_is_lane(addr: Any) -> bool:
    """True for the addresses a lane's server can report for ``inet_server_addr()``: NULL (unix
    socket), loopback, or a private address. The Supabase CLI publishes Postgres through a
    docker port mapping, so a connection to 127.0.0.1 reports the container's bridge address
    (measured: a 172.x private address), never loopback. A public address is a remote server."""
    if addr is None:
        return True
    ip = ipaddress.ip_address(str(addr))
    return ip.is_loopback or ip.is_private


def _require_stock_database_comment(conn: Any) -> None:
    """``pytest.fail`` unless the connected database still carries the stock comment.

    This is the repo's database-identity query. PROD and TEST each overwrite the comment with one
    naming themselves, so either is refused, as is NULL or any other value. A hosted project
    reached through a localhost tunnel passes the host and address checks and is stopped here."""
    comment = conn.execute(
        "SELECT shobj_description(oid, 'pg_database') FROM pg_database "
        "WHERE datname = current_database()"
    ).fetchone()[0]
    if comment != _LANE_DATABASE_COMMENT:
        pytest.fail(
            "test_compute_job_metadata_merge_live refuses to write: the connected database's "
            f"comment is {comment!r}, not the stock {_LANE_DATABASE_COMMENT!r} of a local-stack "
            "lane.",
            pytrace=False,
        )


def _require_lane_server(conn: psycopg.Connection) -> None:
    """Second layer after the DSN host check: the server actually answering must be local, and
    the database must be the lane's own (stock comment)."""
    addr = conn.execute("SELECT inet_server_addr()").fetchone()[0]  # type: ignore[index]
    if not _server_addr_is_lane(addr):
        pytest.fail(
            f"test_compute_job_metadata_merge_live refuses to write: the connected server "
            f"reports {addr} (not loopback or a private lane address).",
            pytrace=False,
        )
    _require_stock_database_comment(conn)


def _dsn() -> str:
    """The lane DSN, or skip/fail per the gating rule in the module docstring."""
    if not LANE_DB_URL:
        if _in_ci():
            pytest.fail(
                "Phase 191 live probe cannot run: LANE_DB_URL is unset in CI. The python job's "
                "'Lane handoff' step exports it from the local-stack lane handoff.",
                pytrace=False,
            )
        pytest.skip("LANE_DB_URL unset (local dev): export it from scripts/local-stack/.stack-env")
    _require_loopback_dsn(LANE_DB_URL)
    return LANE_DB_URL


def _connect(autocommit: bool) -> psycopg.Connection:
    conn = psycopg.connect(_dsn(), autocommit=autocommit)
    _require_lane_server(conn)
    return conn


def test_loopback_guard_refuses_non_loopback_dsn() -> None:
    """The guard can fail: a remote host, a look-alike hostname, a loopback host paired with a
    remote ``hostaddr``, a mixed host list, an empty value and a DSN with no host all trip it;
    the three loopback spellings pass. Without this test the guard could silently pass anything."""
    for ok in (
        "postgresql://postgres@127.0.0.1:54422/postgres",
        "postgresql://postgres@localhost:54422/postgres",
        "postgresql://postgres@[::1]:54422/postgres",
        "host=127.0.0.1 port=54422 dbname=postgres",
    ):
        _require_loopback_dsn(ok)  # must not raise
    for bad in (
        "postgresql://postgres@db.abcdefghijklmnop.supabase.co:5432/postgres",
        "postgresql://postgres@127.0.0.1.evil.example:54422/postgres",
        "host=127.0.0.1 hostaddr=203.0.113.9 dbname=postgres",
        "host=127.0.0.1,db.example.com dbname=postgres",
        "dbname=postgres",
        "",
        None,
    ):
        with pytest.raises(pytest.fail.Exception):
            _require_loopback_dsn(bad)


def test_server_address_guard_accepts_docker_bridge_and_refuses_public() -> None:
    """The post-connect address check accepts what a docker-published lane really reports (a
    private bridge address, loopback, NULL) and refuses a public address. It does NOT refuse a
    hosted project reached through a localhost tunnel (the server then reports its own address as
    seen from the tunnel's far side); ``_require_stock_database_comment`` does that."""
    for ok in (None, "127.0.0.1", "::1", "172.18.0.2", "10.0.0.5"):
        assert _server_addr_is_lane(ok), ok
    for bad in ("52.14.7.9", "8.8.8.8", "2606:4700:4700::1111"):
        assert not _server_addr_is_lane(bad), bad


class _FakeConn:
    """Answers the identity query with a fixed comment."""

    def __init__(self, comment: str | None) -> None:
        self._comment = comment

    def execute(self, _sql: str) -> "_FakeConn":
        return self

    def fetchone(self) -> tuple[str | None]:
        return (self._comment,)


def test_database_comment_guard_accepts_only_the_stock_lane_comment() -> None:
    """The identity check can fail: a PROD- or TEST-style self-naming comment, NULL (a marker that
    was lost) and an empty string are all refused; only the lane's stock comment passes. Without
    this test a hosted database behind a tunnel could pass unnoticed."""
    _require_stock_database_comment(_FakeConn(_LANE_DATABASE_COMMENT))  # must not raise
    for bad in ("quantalyze PRODUCTION - do not write", "quantalyze TEST (shared)", None, ""):
        with pytest.raises(pytest.fail.Exception):
            _require_stock_database_comment(_FakeConn(bad))


def test_unset_lane_dsn_fails_in_ci_and_skips_locally(monkeypatch: pytest.MonkeyPatch) -> None:
    """T-191-27: the gate that makes the probe unskippable in CI can itself fail."""
    monkeypatch.setitem(globals(), "LANE_DB_URL", None)
    monkeypatch.setenv("CI", "true")
    with pytest.raises(pytest.fail.Exception):
        _dsn()
    monkeypatch.setenv("CI", "false")
    with pytest.raises(pytest.skip.Exception):
        _dsn()


# --------------------------------------------------------------------------------------
# Seeding: own rows only, deleted in finally.
# --------------------------------------------------------------------------------------
def _seed_job(conn: psycopg.Connection) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """One user, one strategy and one compute_jobs row whose metadata holds a ledger-refresh
    `source`, an old `correlation_id`, `member_progress` and a claim-style key. Returns
    (user_id, strategy_id, job_id). `conn` must be autocommit so the rows are visible to the
    other connections."""
    user_id, job_id = uuid.uuid4(), uuid.uuid4()
    conn.execute(
        "INSERT INTO auth.users (id, email) VALUES (%s, %s)",
        (user_id, f"p191-live-{user_id}@invalid.local"),
    )
    conn.execute(
        "INSERT INTO public.profiles (id, display_name) VALUES (%s, 'p191') "
        "ON CONFLICT (id) DO NOTHING",
        (user_id,),
    )
    strategy_id = conn.execute(
        "INSERT INTO public.strategies (user_id, name) VALUES (%s, 'p191-live') RETURNING id",
        (user_id,),
    ).fetchone()[0]  # type: ignore[index]
    conn.execute(
        "INSERT INTO public.compute_jobs (id, kind, strategy_id, status, metadata) "
        "VALUES (%s, 'compute_analytics', %s, 'pending', %s)",
        (
            job_id,
            strategy_id,
            Jsonb(
                {
                    "source": _OLD_MARKER,
                    "correlation_id": "corr-old",
                    "member_progress": _MEMBER_PROGRESS,
                    "unified_backbone_at_claim": "true",
                }
            ),
        ),
    )
    return user_id, strategy_id, job_id


def _cleanup(conn: psycopg.Connection, user_id: uuid.UUID, strategy_id: uuid.UUID, job_id: uuid.UUID) -> None:
    conn.execute("DELETE FROM public.compute_jobs WHERE id = %s", (job_id,))
    conn.execute("DELETE FROM public.strategies WHERE id = %s", (strategy_id,))
    conn.execute("DELETE FROM public.profiles WHERE id = %s", (user_id,))
    conn.execute("DELETE FROM auth.users WHERE id = %s", (user_id,))


def _metadata(conn: psycopg.Connection, job_id: uuid.UUID) -> dict[str, Any]:
    row = conn.execute("SELECT metadata FROM public.compute_jobs WHERE id = %s", (job_id,)).fetchone()
    assert row is not None, "the seeded job vanished"
    return dict(row[0])


def _expected_after_both(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    want: dict[str, Any] = {
        READ_REFUSAL_KEPT_FIGURES_KEY: True,
        "refresh_marker_retracted": _OLD_MARKER,
        "correlation_id": _NEW_CORRELATION_ID,
        "member_progress": _MEMBER_PROGRESS,
        "unified_backbone_at_claim": "true",
    }
    want.update(extra or {})
    return want


# --------------------------------------------------------------------------------------
# The race.
# --------------------------------------------------------------------------------------
_CALL_MARKER = f"SELECT public.{MARK_KEPT_FIGURES_RPC}(%s)"
_CALL_RETRACT = f"SELECT public.{RETRACT_REFRESH_MARKER_RPC}(%s, %s)"


def _race(holder_sql: str, holder_args: tuple[Any, ...], blocked_sql: str, blocked_args: tuple[Any, ...]) -> tuple[Any, Any, float]:
    """Connection A runs ``holder_sql`` in an open transaction (the row stays locked), connection
    B runs ``blocked_sql`` in a thread, a third connection waits until B's backend reports a
    ``Lock`` wait, then A commits and B finishes. Returns (holder answer, blocked answer, seconds
    B waited on the lock). Fails if B never blocks: the race was not exercised."""
    conn_a = _connect(autocommit=False)
    conn_b = _connect(autocommit=True)
    conn_m = _connect(autocommit=True)
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        conn_a.execute("SET LOCAL ROLE service_role")
        holder_answer = conn_a.execute(holder_sql, holder_args).fetchone()[0]  # type: ignore[index]

        conn_b.execute("SET ROLE service_role")
        conn_b.execute("SET lock_timeout = '20s'")
        b_pid = conn_b.execute("SELECT pg_backend_pid()").fetchone()[0]  # type: ignore[index]
        started = time.monotonic()
        future = pool.submit(lambda: conn_b.execute(blocked_sql, blocked_args).fetchone()[0])  # type: ignore[index]

        waited_on_lock = None
        deadline = started + _LOCK_WAIT_BUDGET_S
        while time.monotonic() < deadline:
            if future.done():
                break
            row = conn_m.execute(
                "SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s", (b_pid,)
            ).fetchone()
            if row and row[0] == "Lock":
                waited_on_lock = time.monotonic() - started
                break
            time.sleep(0.05)
        if waited_on_lock is None:
            pytest.fail(
                "the race was NOT exercised: connection B did not block on a Lock while A held "
                f"the row (B finished early: {future.done()}). A probe that never waits proves "
                "nothing about interleaving.",
                pytrace=False,
            )
        conn_a.commit()
        blocked_answer = future.result(timeout=30)
        return holder_answer, blocked_answer, waited_on_lock
    finally:
        # Closing A rolls back anything uncommitted, which also releases B on a failure path.
        conn_a.close()
        pool.shutdown(wait=True)
        conn_b.close()
        conn_m.close()


def test_marker_holds_the_lock_and_the_blocked_retraction_keeps_the_marker() -> None:
    """Marker commits first while the retraction waits on its lock. The retraction must apply
    to the COMMITTED row, so `read_refusal_kept_figures` survives alongside the retraction's
    own keys and the claim-style key. A read-then-replace retraction would write back the copy
    it read before the marker and lose the marker."""
    admin = _connect(autocommit=True)
    ids = _seed_job(admin)
    try:
        held, blocked, waited = _race(
            _CALL_MARKER, (ids[2],), _CALL_RETRACT, (ids[2], _NEW_CORRELATION_ID)
        )
        print(f"lock-wait: marker-holding/retraction-blocked {waited:.3f}s")
        assert held is True
        assert blocked["outcome"] == "retracted" and blocked["marker"] == _OLD_MARKER, blocked
        meta = _metadata(admin, ids[2])
        assert meta == _expected_after_both(), meta
        assert "source" not in meta
    finally:
        _cleanup(admin, *ids)
        admin.close()


def test_retraction_holds_the_lock_and_the_blocked_marker_keeps_the_retraction() -> None:
    """The mirror order: the retraction commits first while the marker waits. The marker must
    merge into the retracted row, so the retraction's keys (and no `source`) survive. A
    read-then-replace marker would write back the pre-retraction copy and bring `source`
    back, re-arming a marker the retraction had just disarmed."""
    admin = _connect(autocommit=True)
    ids = _seed_job(admin)
    try:
        held, blocked, waited = _race(
            _CALL_RETRACT, (ids[2], _NEW_CORRELATION_ID), _CALL_MARKER, (ids[2],)
        )
        print(f"lock-wait: retraction-holding/marker-blocked {waited:.3f}s")
        assert held["outcome"] == "retracted" and held["marker"] == _OLD_MARKER, held
        assert blocked is True
        meta = _metadata(admin, ids[2])
        assert meta == _expected_after_both(), meta
        assert "source" not in meta
    finally:
        _cleanup(admin, *ids)
        admin.close()


def test_control_read_then_replace_loses_the_marker() -> None:
    """The harness can see a lost key. B does what the old retraction did: read the metadata,
    wait while the marker commits, then write the stale copy (minus `source`, plus the
    retraction keys) back with a plain UPDATE. The marker MUST be gone; if it survives, the
    race cases above would pass even on a racy body because the harness is blind."""
    admin = _connect(autocommit=True)
    ids = _seed_job(admin)
    reader = _connect(autocommit=True)
    try:
        reader.execute("SET ROLE service_role")
        stale = _metadata(reader, ids[2])
        admin.execute("SET ROLE service_role")
        assert admin.execute(_CALL_MARKER, (ids[2],)).fetchone()[0] is True  # type: ignore[index]
        admin.execute("RESET ROLE")
        assert _metadata(admin, ids[2]).get(READ_REFUSAL_KEPT_FIGURES_KEY) is True

        written = {k: v for k, v in stale.items() if k != "source"}
        written["refresh_marker_retracted"] = stale["source"]
        written["correlation_id"] = _NEW_CORRELATION_ID
        reader.execute(
            "UPDATE public.compute_jobs SET metadata = %s WHERE id = %s", (Jsonb(written), ids[2])
        )
        final = _metadata(admin, ids[2])
        assert READ_REFUSAL_KEPT_FIGURES_KEY not in final, (
            "the control did not lose the marker: this harness cannot see a lost write, so a "
            f"passing race case would prove nothing. metadata={final}"
        )
    finally:
        reader.close()
        _cleanup(admin, *ids)
        admin.close()


# --------------------------------------------------------------------------------------
# PostgREST: the answer shapes the Python callers depend on.
# --------------------------------------------------------------------------------------
def _need_supabase() -> None:
    if create_client is None:
        if _in_ci():
            pytest.fail("supabase-py is not installed in CI; the PostgREST half cannot run", pytrace=False)
        pytest.skip("supabase-py not installed in this environment")
    if not SUPABASE_URL or not SUPABASE_KEY:
        if _in_ci():
            pytest.fail(
                "Phase 191 live probe cannot run: SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY "
                "are unset in CI. The python job exports the local-stack lane as those two "
                "variables.",
                pytrace=False,
            )
        pytest.skip("local-stack lane not configured (local dev)")
    host = urlparse(SUPABASE_URL).hostname
    if host not in _LOOPBACK_HOSTS:
        pytest.fail(
            f"Phase 191 live probe refuses to write: SUPABASE_TEST_URL host is {host!r}, not a "
            "loopback lane.",
            pytrace=False,
        )


def _lane_client():  # type: ignore[no-untyped-def]
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    session = client.postgrest.session
    # Same http2=False session rebuild as the other live modules (supabase-py hardcodes
    # http2=True; one multiplexed connection is a GOAWAY hazard).
    client.postgrest.session = type(session)(
        base_url=session.base_url,
        headers=session.headers,
        timeout=60.0,
        follow_redirects=True,
        http2=False,
    )
    return wrap_live_db_client(client)


def _rpc(client, name: str, params: dict[str, Any]):  # type: ignore[no-untyped-def]
    """Call ``name`` through PostgREST. A function created after PostgREST built its schema cache
    answers PGRST202; reload the cache once through the lane DSN and retry."""
    try:
        return client.rpc(name, params).execute()
    except APIError as exc:
        if getattr(exc, "code", None) != "PGRST202":
            raise
    reload_conn = _connect(autocommit=True)
    try:
        reload_conn.execute("NOTIFY pgrst, 'reload schema'")
    finally:
        reload_conn.close()
    time.sleep(2.0)
    return client.rpc(name, params).execute()


def test_postgrest_answers_the_shapes_the_callers_rely_on() -> None:
    """D-07: the marker answers a Python ``True`` for a seeded job (the caller treats anything
    else as an unconfirmed write) and ``False`` for an unknown id; the retraction answers a dict
    whose ``outcome`` is ``no_row`` for an unknown id. Called by the services' own constants so
    a renamed function breaks here."""
    _need_supabase()
    client = _lane_client()
    unknown = str(uuid.uuid4())
    marker_unknown = _rpc(client, MARK_KEPT_FIGURES_RPC, {"p_job_id": unknown})
    assert marker_unknown.data is False, marker_unknown.data
    retract_unknown = _rpc(
        client,
        RETRACT_REFRESH_MARKER_RPC,
        {"p_job_id": unknown, "p_correlation_id": _NEW_CORRELATION_ID},
    )
    assert isinstance(retract_unknown.data, dict), retract_unknown.data
    assert retract_unknown.data == {"outcome": "no_row"}, retract_unknown.data

    admin = _connect(autocommit=True)
    ids = _seed_job(admin)
    try:
        marker = _rpc(client, MARK_KEPT_FIGURES_RPC, {"p_job_id": str(ids[2])})
        assert marker.data is True, marker.data
        assert _metadata(admin, ids[2]).get(READ_REFUSAL_KEPT_FIGURES_KEY) is True
        retract = _rpc(
            client,
            RETRACT_REFRESH_MARKER_RPC,
            {"p_job_id": str(ids[2]), "p_correlation_id": _NEW_CORRELATION_ID},
        )
        assert isinstance(retract.data, dict) and retract.data["outcome"] == "retracted", retract.data
        assert _metadata(admin, ids[2]) == _expected_after_both()
    finally:
        _cleanup(admin, *ids)
        admin.close()
