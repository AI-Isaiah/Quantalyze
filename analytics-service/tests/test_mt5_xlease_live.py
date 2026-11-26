"""Phase 230 MT5NIGHTLY plan 07 - the cross-process MT5 terminal lease through real PostgREST.

``services.mt5_xlease`` talks to three database functions
(``acquire_/renew_/release_mt5_terminal_lease``). The unit suites drive it through a fake
backend, and ``supabase/tests/test_mt5_terminal_lease.sql`` drives the functions in one SQL
session. Neither can notice the two drifting apart: a renamed parameter, an answer that is
not a JSON boolean, or a lease that two real clients both win. This module is the join. It
calls the functions over HTTP, from several threads, exactly the way the production backend
does, on the private local-stack lane.

What it pins:

* the three RPCs answer Python booleans (``is True`` / ``is False``, never a truthy dict or
  ``None``), by the module's own RPC name constants, so a renamed function breaks here;
* of N concurrent clients racing one free terminal, EXACTLY ONE is granted, every round;
* a lease whose ttl has passed is taken over by another token, and the old token's renew
  then answers ``False`` (the holder learns it lost the lease);
* the production client (``_PostgrestXLeaseBackend``) wired to the lane, driven by
  ``mt5_concurrency.mt5_terminal_lease``, holds the row for the body and frees it after:
  the real end-to-end path from the context manager through PostgREST to the table.

Own rows only: every test uses a fresh random terminal digest and asserts only about it, so
nothing here depends on, or disturbs, any other row.

Gating. ``SUPABASE_TEST_URL`` / ``SUPABASE_TEST_SERVICE_KEY`` are the python CI job's export
of the local-stack lane. Unset locally the module skips; unset with ``CI == "true"`` it FAILS,
so a green ``python`` job ran it. A non-loopback host is refused before any write.

Schema cache. The lane replays the phase migration AFTER PostgREST built its schema cache, so
the first call to a replayed function answers ``PGRST202``. ``_warm_schema_cache`` asks once,
and on that code reloads the cache through ``LANE_DB_URL`` (the lane's loopback DSN, the same
export the metadata-merge live module uses) and asks again, before any test runs. The
production backend (``_PostgrestXLeaseBackend``) has no such retry by design: for it a missing
RPC is the loud in-process-only fallback, so without the warm-up the end-to-end test would read
"no lease row" instead of a missing function.
"""
from __future__ import annotations

import concurrent.futures
import os
import time
import uuid
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlparse

import psycopg
import pytest

try:
    from postgrest.exceptions import APIError
    from supabase import create_client
except ImportError:  # pragma: no cover
    create_client = None  # type: ignore[assignment]
    APIError = Exception  # type: ignore[assignment,misc]

from services import mt5_concurrency, mt5_xlease
from services.mt5_xlease import (
    XLEASE_ACQUIRE_RPC,
    XLEASE_RELEASE_RPC,
    XLEASE_RENEW_RPC,
    terminal_lease_digest,
)
from tests.live_db_dsn import _LOOPBACK_HOSTS, _in_ci, _require_loopback_dsn
from tests.live_db_transport import wrap_live_db_client

SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")
LANE_DB_URL = os.getenv("LANE_DB_URL")

_TABLE = "mt5_terminal_leases"
_TTL_S = 60
_RACERS = 8
_ROUNDS = 5


def _need_supabase() -> None:
    """Skip locally, fail in CI, refuse a non-loopback host."""
    if create_client is None:
        if _in_ci():
            pytest.fail("supabase-py is not installed in CI; the lease live test cannot run", pytrace=False)
        pytest.skip("supabase-py not installed in this environment")
    if not SUPABASE_URL or not SUPABASE_KEY:
        if _in_ci():
            pytest.fail(
                "Phase 230 lease live test cannot run: SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY "
                "are unset in CI. The python job exports the local-stack lane as those two variables.",
                pytrace=False,
            )
        pytest.skip("local-stack lane not configured (local dev)")
    host = urlparse(SUPABASE_URL).hostname
    if host not in _LOOPBACK_HOSTS:
        pytest.fail(
            f"Phase 230 lease live test refuses to write: SUPABASE_TEST_URL host is {host!r}, "
            "not a loopback lane.",
            pytrace=False,
        )


def _lane_client() -> Any:
    assert create_client is not None and SUPABASE_URL and SUPABASE_KEY  # _need_supabase ran
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


def _digest() -> str:
    """A fresh terminal digest nobody else holds."""
    return terminal_lease_digest(f"p230-live-{uuid.uuid4()}")


def _reload_schema_cache() -> None:
    """``NOTIFY pgrst, 'reload schema'`` through the lane DSN, then give PostgREST a moment."""
    if not LANE_DB_URL:
        pytest.fail(
            "Phase 230 lease live test: PostgREST does not see the lease functions yet and "
            "LANE_DB_URL is unset, so the schema cache cannot be reloaded. The python job's "
            "'Lane handoff' step exports it.",
            pytrace=False,
        )
    _require_loopback_dsn(LANE_DB_URL)
    with psycopg.connect(LANE_DB_URL, autocommit=True) as conn:
        conn.execute("NOTIFY pgrst, 'reload schema'")
    time.sleep(2.0)


def _rpc(client: Any, name: str, params: dict[str, Any]) -> Any:
    """Call ``name`` through PostgREST and return the answer's ``data``. A function created
    after PostgREST built its schema cache answers ``PGRST202``; reload the cache once and retry."""
    try:
        return client.rpc(name, params).execute().data
    except APIError as exc:
        if getattr(exc, "code", None) != "PGRST202":
            raise
    _reload_schema_cache()
    return client.rpc(name, params).execute().data


def _acquire(client: Any, digest: str, token: uuid.UUID, ttl_s: int = _TTL_S) -> Any:
    return _rpc(
        client,
        XLEASE_ACQUIRE_RPC,
        {
            "p_terminal_digest": digest,
            "p_owner_token": str(token),
            "p_holder": "unattributed",
            "p_site": "live_test",
            "p_ttl_s": ttl_s,
        },
    )


def _renew(client: Any, digest: str, token: uuid.UUID, ttl_s: int = _TTL_S) -> Any:
    return _rpc(
        client,
        XLEASE_RENEW_RPC,
        {"p_terminal_digest": digest, "p_owner_token": str(token), "p_ttl_s": ttl_s},
    )


def _release(client: Any, digest: str, token: uuid.UUID) -> Any:
    return _rpc(
        client,
        XLEASE_RELEASE_RPC,
        {"p_terminal_digest": digest, "p_owner_token": str(token)},
    )


def _owner_token(client: Any, digest: str) -> str | None:
    """The row's owner_token, or the sentinel string 'ROW-ABSENT' when no row exists."""
    rows = client.table(_TABLE).select("owner_token").eq("terminal_digest", digest).execute().data
    if not rows:
        return "ROW-ABSENT"
    return rows[0]["owner_token"]  # type: ignore[no-any-return]


@pytest.fixture(scope="module")
def _warm_schema_cache() -> None:
    """Make PostgREST see the lease functions before any test (module docstring, "Schema
    cache"). A release by a random token on a random digest changes nothing and answers False;
    the reload it may trigger covers all three functions."""
    _need_supabase()
    assert _release(_lane_client(), _digest(), uuid.uuid4()) is False


@pytest.fixture
def lane(_warm_schema_cache: None) -> Any:
    _need_supabase()
    return _lane_client()


def test_rpc_answers_are_python_booleans(lane: Any) -> None:
    """Every answer is a real ``True`` or ``False``. The client turns the answer into a grant
    with ``result.data is True``, so a truthy non-boolean would read as a refusal and a
    ``None`` as an outage."""
    digest = _digest()
    holder, other = uuid.uuid4(), uuid.uuid4()

    assert _acquire(lane, digest, holder) is True
    assert _acquire(lane, digest, other) is False, "a second token must not win a held lease"

    assert _renew(lane, digest, holder) is True
    assert _renew(lane, digest, other) is False, "a foreign token must not extend the lease"

    assert _release(lane, digest, other) is False, "a foreign release must be refused"
    assert _owner_token(lane, digest) == str(holder), "a refused release must not free the row"
    assert _release(lane, digest, holder) is True
    assert _owner_token(lane, digest) is None, "the holder's release must free the row"


def test_exactly_one_of_n_clients_wins_each_round(lane: Any) -> None:
    """The mutual-exclusion claim, over real HTTP: 8 independent clients race one free terminal
    and exactly one is granted, five rounds running. A lease that granted two would put two
    accounts on the one Wine terminal at once, which is the incident this phase exists for."""
    digest = _digest()
    clients = [_lane_client() for _ in range(_RACERS)]
    tokens = [uuid.uuid4() for _ in range(_RACERS)]

    with concurrent.futures.ThreadPoolExecutor(max_workers=_RACERS) as pool:
        for round_no in range(_ROUNDS):
            answers = list(
                pool.map(lambda i: _acquire(clients[i], digest, tokens[i]), range(_RACERS))
            )
            assert all(a is True or a is False for a in answers), answers
            winners = [i for i, a in enumerate(answers) if a is True]
            assert len(winners) == 1, f"round {round_no}: {len(winners)} clients won: {answers}"
            assert _release(clients[winners[0]], digest, tokens[winners[0]]) is True
            assert _owner_token(lane, digest) is None, f"round {round_no}: the release did not free the row"


def test_a_one_second_lease_expires_and_is_taken_over(lane: Any) -> None:
    """Expiry is the database's clock: after the ttl passes a different token is granted the
    lease, and the first token's renew answers ``False``, which is how a stalled holder learns
    it lost the terminal."""
    digest = _digest()
    first, second = uuid.uuid4(), uuid.uuid4()

    assert _acquire(lane, digest, first, ttl_s=1) is True
    assert _acquire(lane, digest, second) is False, "the lease is still live inside its ttl"
    time.sleep(1.5)
    assert _acquire(lane, digest, second) is True, "an expired lease must be taken over"
    assert _renew(lane, digest, first) is False, "the displaced holder's renew must be refused"
    assert _owner_token(lane, digest) == str(second)

    assert _release(lane, digest, second) is True


@pytest.fixture
def lane_backend(lane: Any) -> Iterator[Any]:
    """The production backend pointed at the lane for the test, the previous one restored after
    (conftest installs a granting default, so this must always restore)."""
    previous = mt5_xlease.set_xlease_backend_for_tests(
        mt5_xlease._PostgrestXLeaseBackend(client=lane)
    )
    try:
        yield lane
    finally:
        mt5_xlease.set_xlease_backend_for_tests(previous)


async def test_the_production_client_holds_a_row_during_the_body(lane_backend: Any) -> None:
    """The end-to-end path: ``mt5_terminal_lease`` takes the in-process lock, then the database
    lease through the production client, runs the body, and releases. Inside the body the lane
    row for the terminal's digest has an owner; afterwards it does not."""
    terminal_key = f"p230-live-{uuid.uuid4()}:18812"
    digest = terminal_lease_digest(terminal_key)
    assert _owner_token(lane_backend, digest) == "ROW-ABSENT", "a fresh digest must have no row"

    async with mt5_concurrency.mt5_terminal_lease(terminal_key):
        inside = _owner_token(lane_backend, digest)
        assert inside not in (None, "ROW-ABSENT"), (
            f"the body ran without holding a lease row (owner_token={inside!r})"
        )
        uuid.UUID(str(inside))  # an actual token, not a placeholder

    assert _owner_token(lane_backend, digest) is None, "the lease row was not freed after the body"
