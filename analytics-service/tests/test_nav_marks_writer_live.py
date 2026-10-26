"""Phase 167.2.1.1.1 NAVMTM plan 06 - live PostgREST probe of the marks writer.

``write_nav_mark`` is correct only if a real PostgREST turns
``upsert(on_conflict="api_key_id,mark_day", ignore_duplicates=True)`` into ``INSERT ... ON
CONFLICT DO NOTHING`` against plan 01's table, so that (a) the first writer of a day keeps its
row, (b) the re-select returns THAT row to the loser, and (c) the worker's ``service_role``,
which holds INSERT and SELECT only, cannot change a stored mark. All three are properties of
Postgres + PostgREST + the migration, not of our code, so the offline tests
(``test_nav_marks_writer.py``, whose in-memory table is only a mirror) cannot prove them.
This probe does, against the same local-stack PostgREST image CI runs.

Own rows only: a throwaway auth user and one ``api_keys`` row, both deleted in ``finally``
(the marks cascade with the key). The probe WRITES, so it refuses any host that is not a
loopback lane (T-166.5-03 pattern).

Gating mirrors ``test_computed_at_now_literal_live.py``: skip locally when the lane env is
unset, ``pytest.fail`` when it is unset and ``CI == "true"``.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
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


def _require_loopback_lane(url: str | None) -> None:
    """``pytest.fail`` unless ``url`` names a loopback host. This probe writes rows, and the
    env var it reads is pointed at shared TEST by other CI jobs, so the host is checked here."""
    host = urlparse(url or "").hostname
    if host not in _LOOPBACK_HOSTS:
        pytest.fail(
            "test_nav_marks_writer_live refuses to write: SUPABASE_TEST_URL host is "
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
                "167.2.1.1.1 live probe cannot run: SUPABASE_TEST_URL / "
                "SUPABASE_TEST_SERVICE_KEY are unset in CI. The python job exports the "
                "local-stack lane as those two variables.",
                pytrace=False,
            )
        pytest.skip("local-stack lane not configured (local dev)")


def _lane_client():  # type: ignore[no-untyped-def]
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    session = client.postgrest.session
    # Same http2=False session rebuild as test_computed_at_now_literal_live (supabase-py
    # hardcodes http2=True; one multiplexed connection is a GOAWAY hazard).
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
            "email": f"p167-nm-{tag}@quantalyze.test",
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
                "exchange": "okx",
                "label": f"p167-nm-{tag}",
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


def _read(nav: float, when: datetime):  # type: ignore[no-untyped-def]
    from services.nav_marks import build_mark_read

    built = build_mark_read(
        venue="okx", marked_at=when, equity=nav, open_pnl=5.0,
        balance_error=False, upnl_unreadable=False,
    )
    assert not isinstance(built, str), built
    return built


def test_loopback_guard_refuses_every_non_lane_host() -> None:
    """The guard can fail: a remote host, an empty value and a look-alike hostname all trip
    it; the three loopback spellings pass."""
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


def test_write_nav_mark_inserts_then_keeps_the_first_row() -> None:
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()
    user_id = key_id = None
    try:
        user_id, key_id = _seed_key(admin)
        from services.nav_marks import write_nav_mark

        first_at = datetime(2026, 3, 2, 0, 10, 30, tzinfo=timezone.utc)
        later_at = datetime(2026, 3, 2, 0, 50, 0, tzinfo=timezone.utc)
        one = write_nav_mark(admin, _read(1050.0, first_at), api_key_id=key_id, allocator_id=user_id)
        two = write_nav_mark(admin, _read(1060.0, later_at), api_key_id=key_id, allocator_id=user_id)

        assert one == two, "the loser must be handed the winner's row"
        assert one.mark_day == "2026-03-01"
        assert one.nav_usd == 1050.0 and one.open_pnl_usd == 5.0
        assert one.venue == "okx" and one.native_unit == "USD" and one.nav_native == 1050.0
        # The database holds exactly one row, and it is the first writer's.
        rows = (
            admin.table("api_key_nav_marks").select("nav_usd,marked_at")
            .eq("api_key_id", key_id).execute().data
        )
        assert len(rows) == 1, rows
        assert float(rows[0]["nav_usd"]) == 1050.0
        assert datetime.fromisoformat(rows[0]["marked_at"]) == first_at
    finally:
        _cleanup(admin, user_id, key_id)


def test_service_role_cannot_update_a_stored_mark() -> None:
    """D-06 as a GRANT: service_role has SELECT and INSERT only, so an UPDATE is refused with
    42501 and the stored figure is unchanged."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()
    user_id = key_id = None
    try:
        user_id, key_id = _seed_key(admin)
        from services.nav_marks import write_nav_mark

        when = datetime(2026, 3, 2, 0, 10, 30, tzinfo=timezone.utc)
        write_nav_mark(admin, _read(1050.0, when), api_key_id=key_id, allocator_id=user_id)
        with pytest.raises(APIError) as excinfo:
            admin.table("api_key_nav_marks").update({"nav_usd": 1.0}).eq("api_key_id", key_id).execute()
        assert excinfo.value.code == "42501", (
            f"expected 42501 (insufficient_privilege) for a service_role UPDATE, got {excinfo.value.code!r}"
        )
        rows = admin.table("api_key_nav_marks").select("nav_usd").eq("api_key_id", key_id).execute().data
        assert [float(r["nav_usd"]) for r in rows] == [1050.0]
    finally:
        _cleanup(admin, user_id, key_id)
