"""Phase 177 DERIBITFLOWS plan 03 - live PostgREST probe of the moved-flow price store.

``services.flow_price_store`` is correct only if a real PostgREST turns
``upsert(rows, on_conflict="api_key_id,instrument,minute_ms", ignore_duplicates=True)`` into
``INSERT ... ON CONFLICT DO NOTHING`` against plan 02's table, so that (a) the first writer of a
minute keeps its price, (b) the re-select hands the loser the winner's price, (c) the chunked
``in_`` read returns exactly the stored rows, and (d) the worker's ``service_role``, which holds
SELECT and INSERT only, cannot change a stored price. The list form of ``upsert`` and the
three-column ``on_conflict`` are unexercised elsewhere in this repo (RESEARCH A11; the existing
write-once form is the single-row, two-column ``write_nav_mark``). All of this is a property of
Postgres, PostgREST and the migration, not of our code, so the offline tests
(``test_flow_price_store.py``, whose in-memory table is only a mirror) cannot prove it. This probe
does, against the same local-stack PostgREST image CI runs.

Own rows only: a throwaway auth user and one ``api_keys`` row, both deleted in ``finally`` (the
price rows cascade with the key). The probe WRITES, so it refuses any host that is not a loopback
lane (T-177-15; the T-166.5-03 pattern).

Gating mirrors ``test_nav_marks_writer_live.py``: skip locally when the lane env is unset,
``pytest.fail`` when it is unset and ``CI == "true"``.
"""
from __future__ import annotations

import os
import uuid
from urllib.parse import urlparse

import pytest

try:
    from postgrest.exceptions import APIError
    from supabase import create_client
except ImportError:  # pragma: no cover
    create_client = None  # type: ignore[assignment]
    APIError = Exception  # type: ignore[assignment,misc]

from tests.live_db_transport import wrap_live_db_client

SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

BTC = "BTC_USDC-PERPETUAL"
#: 2026-03-11T00:05:00Z, a multiple of 60_000 (the table's minute grid CHECK).
M0 = 1_773_187_500_000
MINUTE = 60_000


def _require_loopback_lane(url: str | None) -> None:
    """``pytest.fail`` unless ``url`` names a loopback host. This probe writes rows, and the
    env var it reads is pointed at shared TEST by other CI jobs, so the host is checked here."""
    host = urlparse(url or "").hostname
    if host not in _LOOPBACK_HOSTS:
        pytest.fail(
            "test_flow_price_store_live refuses to write: SUPABASE_TEST_URL host is "
            f"{host!r}, not a loopback lane ({sorted(_LOOPBACK_HOSTS)}). Run it against the "
            "local-stack lane only (scripts/local-stack/run.sh up).",
            pytrace=False,
        )


def _need_supabase() -> None:
    if create_client is None:
        pytest.skip("supabase-py not installed in this environment")
    if not SUPABASE_URL or not SUPABASE_KEY:
        if os.getenv("CI", "").lower() == "true":
            pytest.fail(
                "177 flow-price store live probe cannot run: SUPABASE_TEST_URL / "
                "SUPABASE_TEST_SERVICE_KEY are unset in CI. The python job exports the "
                "local-stack lane as those two variables.",
                pytrace=False,
            )
        pytest.skip("local-stack lane not configured (local dev)")


def _lane_client():  # type: ignore[no-untyped-def]
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    session = client.postgrest.session
    # Same http2=False session rebuild as test_nav_marks_writer_live (supabase-py hardcodes
    # http2=True; one multiplexed connection is a GOAWAY hazard).
    client.postgrest.session = type(session)(
        base_url=session.base_url,
        headers=session.headers,
        timeout=60.0,
        follow_redirects=True,
        http2=False,
    )
    return wrap_live_db_client(client)


def _seed_key(admin):  # type: ignore[no-untyped-def]
    """A throwaway auth user and one api_keys row. Returns (user_id, key_id)."""
    tag = uuid.uuid4().hex[:10]
    created = admin.auth.admin.create_user(
        {
            "email": f"p177-fp-{tag}@quantalyze.test",
            "password": uuid.uuid4().hex,
            "email_confirm": True,
        }
    )
    user_id = created.user.id
    key = (
        admin.table("api_keys")
        .insert(
            {
                "user_id": user_id,
                "exchange": "deribit",
                "label": f"p177-fp-{tag}",
                "api_key_encrypted": "test-placeholder",
            }
        )
        .execute()
    )
    return user_id, key.data[0]["id"]


def _cleanup(admin, user_id, key_id) -> None:  # type: ignore[no-untyped-def]
    if key_id is not None:
        try:
            admin.table("api_keys").delete().eq("id", key_id).execute()
        except Exception:  # pragma: no cover - cleanup of our own rows only
            pass
    if user_id is not None:
        try:
            admin.auth.admin.delete_user(user_id)
        except Exception:  # pragma: no cover
            pass


def _rows(admin, key_id):  # type: ignore[no-untyped-def]
    return (
        admin.table("api_key_flow_prices")
        .select("instrument,minute_ms,price,source")
        .eq("api_key_id", key_id)
        .order("minute_ms")
        .execute()
        .data
    )


def test_flow_price_store_live_loopback_guard_refuses_remote_hosts() -> None:
    """The guard can fail: a remote host, an empty value and a look-alike hostname all trip it;
    the three loopback spellings pass. No lane is needed."""
    for ok in ("http://127.0.0.1:54421", "http://localhost:54421", "http://[::1]:54421"):
        _require_loopback_lane(ok)  # must not raise
    for bad in (
        "https://abcdefghijklmnop.supabase.co",
        "http://127.0.0.1.evil.example:54421",
        "",
        None,
    ):
        with pytest.raises(pytest.fail.Exception):
            _require_loopback_lane(bad)


def test_flow_price_store_live_list_upsert_keeps_the_first_price() -> None:
    """Two minutes are written in one list upsert; one of them is written again with another price.
    The second call returns the FIRST price for it (the re-select), and the table holds exactly two
    rows, the first writer's."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()
    user_id = key_id = None
    try:
        user_id, key_id = _seed_key(admin)
        from services.flow_price_store import write_flow_prices

        first = write_flow_prices(admin, key_id, {(BTC, M0): 101_000.0, (BTC, M0 + MINUTE): 101_100.0})
        assert first == {(BTC, M0): 101_000.0, (BTC, M0 + MINUTE): 101_100.0}
        again = write_flow_prices(admin, key_id, {(BTC, M0): 99_999.0})
        assert again == {(BTC, M0): 101_000.0}, "the loser must be handed the winner's price"
        rows = _rows(admin, key_id)
        assert [(r["instrument"], int(r["minute_ms"]), float(r["price"]), r["source"]) for r in rows] == [
            (BTC, M0, 101_000.0, "deribit_perp_1m_open"),
            (BTC, M0 + MINUTE, 101_100.0, "deribit_perp_1m_open"),
        ]
    finally:
        _cleanup(admin, user_id, key_id)


def test_flow_price_store_live_in_read_returns_the_chunk() -> None:
    """The ``in_`` read returns exactly the stored rows asked for, typed as floats, and a key with
    no row is absent. 120 minutes cross the chunk boundary (two upserts of 100 and 20 rows, two
    reads of 100 and 20 minutes) and come back whole."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()
    user_id = key_id = None
    try:
        user_id, key_id = _seed_key(admin)
        from services.flow_price_store import read_flow_prices, write_flow_prices

        write_flow_prices(admin, key_id, {(BTC, M0): 101_000.0, (BTC, M0 + MINUTE): 101_100.0})
        got = read_flow_prices(admin, key_id, [(BTC, M0), (BTC, M0 + MINUTE), (BTC, M0 + 5 * MINUTE)])
        assert got == {(BTC, M0): 101_000.0, (BTC, M0 + MINUTE): 101_100.0}
        assert all(isinstance(price, float) for price in got.values())

        many = {(BTC, M0 + (10 + i) * MINUTE): 100_000.0 + i for i in range(120)}
        assert write_flow_prices(admin, key_id, many) == many
        assert read_flow_prices(admin, key_id, list(many)) == many
        assert len(_rows(admin, key_id)) == 122
    finally:
        _cleanup(admin, user_id, key_id)


def test_flow_price_store_live_service_role_cannot_update() -> None:
    """Write-once as a GRANT: service_role has SELECT and INSERT only, so an UPDATE of a stored
    price is refused with 42501 and the stored price is unchanged."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()
    user_id = key_id = None
    try:
        user_id, key_id = _seed_key(admin)
        from services.flow_price_store import write_flow_prices

        write_flow_prices(admin, key_id, {(BTC, M0): 101_000.0})
        with pytest.raises(APIError) as excinfo:
            admin.table("api_key_flow_prices").update({"price": 1.0}).eq("api_key_id", key_id).execute()
        assert excinfo.value.code == "42501", (
            f"expected 42501 (insufficient_privilege) for a service_role UPDATE, got {excinfo.value.code!r}"
        )
        assert [float(r["price"]) for r in _rows(admin, key_id)] == [101_000.0]
    finally:
        _cleanup(admin, user_id, key_id)
