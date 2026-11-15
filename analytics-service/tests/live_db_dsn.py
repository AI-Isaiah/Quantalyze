"""Phase 215 TESTREACH plan 02 - one resolver and one set of write guards for the psycopg live-DB modules.

Seven test modules used to read the shared-TEST DSN variable directly and skip when it was unset.
The CI ``python`` job exports the local-stack lane's loopback DSN as ``LANE_DB_URL`` ON PURPOSE
(``.github/workflows/ci.yml``, "Lane handoff") and never exports the shared-TEST name, so those
cases ran nowhere. They resolve through ``resolve_live_db_dsn`` now.

The rules, in one place:

* ``LANE_DB_URL`` set: it must name only loopback hosts (``_require_loopback_dsn``). After
  connecting, ``connect_live_db`` also requires the answering server to be a lane address and the
  database comment to be the stock lane comment, before any statement that writes.
* ``LANE_DB_URL`` unset and ``CI`` not ``"true"``: ``pytest.skip`` (a developer run).
* ``LANE_DB_URL`` unset and ``CI == "true"``: ``pytest.fail``. A DSN-needing module never skips in
  CI, so the defect this phase removes (a silent skip) cannot come back as one.
* NO fallback to the shared-TEST variable on any path, local or CI. A fallback would leave a write
  path to shared TEST without a marker check (CLAUDE.md "Which database am I on"); the lane is the
  only database these writing modules are meant to touch. ``SHARED_TEST_DSN_VAR`` names that
  variable for the pin in ``tests/test_live_db_reach_roster.py`` and for this docstring only. It is
  never read from the environment.
"""
from __future__ import annotations

import ipaddress
import os
from typing import Any
from urllib.parse import urlparse

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict

LANE_DSN_VAR = "LANE_DB_URL"
# The shared-TEST secret's name. Referenced by the roster scan; NEVER an environment read.
SHARED_TEST_DSN_VAR = "TEST_SUPABASE_DB_URL"

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
# What a fresh local-stack database answers to ``shobj_description`` (measured on a booted lane).
# PROD and TEST each carry a hand-set comment naming themselves in its place.
_LANE_DATABASE_COMMENT = "default administrative connection database"


def _in_ci() -> bool:
    return os.getenv("CI", "").lower() == "true"


# --------------------------------------------------------------------------------------
# Loopback guard (T-191-25): these modules write, and a DSN env var is a thing other jobs point
# at shared TEST. No database is needed to run the guard itself.
# --------------------------------------------------------------------------------------
def _require_loopback_dsn(dsn: str | None) -> None:
    """``pytest.fail`` unless every host (and ``hostaddr``) in ``dsn`` is a loopback spelling.

    A DSN naming no host is refused too: libpq would fall back to a unix socket or to
    ``PGHOST`` from the environment, and a writing module must write only where the DSN says."""
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
            "a live-DB test refuses to write: LANE_DB_URL does not name "
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
            "a live-DB test refuses to write: the connected database's "
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
            f"a live-DB test refuses to write: the connected server "
            f"reports {addr} (not loopback or a private lane address).",
            pytrace=False,
        )
    _require_stock_database_comment(conn)


def resolve_live_db_dsn() -> str:
    """The lane DSN, or skip/fail per the module docstring. Reads the environment at call time."""
    dsn = os.getenv(LANE_DSN_VAR)
    if not dsn:
        if _in_ci():
            pytest.fail(
                "a live-DB test cannot run: LANE_DB_URL is unset in CI. The python job's "
                "'Lane handoff' step exports it from the local-stack lane handoff.",
                pytrace=False,
            )
        pytest.skip(
            "LANE_DB_URL unset (local dev): boot the lane with scripts/local-stack/run.sh up "
            "and export the lane values from scripts/local-stack/.stack-env"
        )
    _require_loopback_dsn(dsn)
    return dsn


def resolve_lane_postgrest() -> tuple[str, str]:
    """The lane's PostgREST URL and service key (``SUPABASE_TEST_URL`` / ``SUPABASE_TEST_SERVICE_KEY``,
    which the python job exports from the same lane handoff), or skip/fail by the same rule as
    ``resolve_live_db_dsn``. A URL whose host is not loopback is refused: the caller writes."""
    url = os.getenv("SUPABASE_TEST_URL")
    key = os.getenv("SUPABASE_TEST_SERVICE_KEY")
    if not url or not key:
        if _in_ci():
            pytest.fail(
                "a live-DB test cannot run: SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY are "
                "unset in CI. The python job's 'Lane handoff' step exports the local-stack lane "
                "as those two variables.",
                pytrace=False,
            )
        pytest.skip(
            "SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY unset (local dev): boot the lane "
            "with scripts/local-stack/run.sh up and export the lane values from "
            "scripts/local-stack/.stack-env"
        )
    host = urlparse(url).hostname
    if host not in _LOOPBACK_HOSTS:
        pytest.fail(
            f"a live-DB test refuses to write: SUPABASE_TEST_URL host is {host!r}, not a "
            "loopback lane.",
            pytrace=False,
        )
    return url, key


def connect_live_db(dsn: str, *, autocommit: bool, row_factory: Any = None) -> psycopg.Connection:
    """Connect to the lane and run the connection-time guards before returning, so no caller can
    issue a write on a connection that was not proven to be the lane. The guards read tuples, so a
    caller's ``row_factory`` is applied only after they pass."""
    conn = psycopg.connect(dsn, autocommit=autocommit)
    try:
        _require_lane_server(conn)
    except BaseException:
        conn.close()
        raise
    if row_factory is not None:
        conn.row_factory = row_factory
    return conn
