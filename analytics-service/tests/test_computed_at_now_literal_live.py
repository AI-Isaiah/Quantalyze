"""Phase 166.5 (D-01, D-02, R-01) - live PostgREST probe of the ``now`` literal.

The analytics runner stamps ``strategy_analytics.computed_at`` by putting the
STRING ``"now"`` in its success payload (``analytics_runner._mark_complete`` and
the composite ``headline_payload``). That is only correct if a real PostgREST
turns the string into the DATABASE clock (the transaction start) when it upserts
over an existing row, and leaves the column alone when a payload omits the key.
Both are properties of Postgres + PostgREST, not of our code, so the offline
payload tests (``test_csv_analytics_runner``, ``test_stitch_composite_job``) cannot
prove them. This probe does, against the same PostgREST image CI runs.

Four things it pins, each of which would silently break the freshness date:
  1. ``"now"`` moves a 30-day-old row to the database's present (not to the
     Python clock, not left at the seed, not stored as text).
  2. Omitting the key leaves the date alone, on a ``complete`` write (which
     166.3.1's hold trigger does NOT touch, so this half is the PostgREST
     semantic itself) and on a ``computing`` write (which the trigger also holds).
  3. A malformed value is rejected with SQLSTATE 22007: the literal is
     type-checked by Postgres, never trusted as free text.
  4. The probe refuses to run against anything but a loopback lane. It WRITES;
     it must never reach shared TEST or PROD (T-166.5-03).

Gating mirrors ``test_compute_jobs_fencing.py``: skip locally when the lane env is
unset, ``pytest.fail`` when it is unset and ``CI == "true"`` (a silent skip in CI
would read as green while proving nothing).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
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
    """``pytest.fail`` unless ``url`` names a loopback host.

    This probe writes rows. The lane URL comes from an env var that CI also points
    at shared TEST in other jobs, so the host is checked here, in the test, rather
    than trusted from the environment.
    """
    host = urlparse(url or "").hostname
    if host not in _LOOPBACK_HOSTS:
        pytest.fail(
            "test_computed_at_now_literal_live refuses to write: SUPABASE_TEST_URL "
            f"host is {host!r}, not a loopback lane ({sorted(_LOOPBACK_HOSTS)}). "
            "Run it against the local-stack lane only (scripts/local-stack/run.sh up).",
            pytrace=False,
        )


def _need_supabase() -> None:
    if create_client is None:
        pytest.skip("supabase-py not installed in this environment")
    if not SUPABASE_URL or not SUPABASE_KEY:
        if os.getenv("CI", "").lower() == "true":
            pytest.fail(
                "166.5 live probe cannot run: SUPABASE_TEST_URL / "
                "SUPABASE_TEST_SERVICE_KEY are unset in CI. The python job exports "
                "the local-stack lane as those two variables.",
                pytrace=False,
            )
        pytest.skip("local-stack lane not configured (local dev)")


def _lane_client():
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    session = client.postgrest.session
    # Same http2=False session rebuild as test_compute_jobs_fencing.admin (supabase-py
    # hardcodes http2=True; one multiplexed connection is a GOAWAY hazard).
    client.postgrest.session = type(session)(
        base_url=session.base_url,
        headers=session.headers,
        timeout=60.0,
        follow_redirects=True,
        http2=False,
    )
    return wrap_live_db_client(client)


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def test_loopback_guard_refuses_every_non_lane_host() -> None:
    """The T-166.5-03 guard can fail: a remote host, an empty value and a
    look-alike hostname all trip it; the three loopback spellings pass."""
    for ok in (
        "http://127.0.0.1:54421",
        "http://localhost:54421",
        "http://[::1]:54421",
    ):
        _require_loopback_lane(ok)  # must not raise
    for bad in (
        "https://abcdefghijklmnop.supabase.co",
        "http://127.0.0.1.evil.example:54421",
        "",
        None,
    ):
        with pytest.raises(pytest.fail.Exception):
            _require_loopback_lane(bad)


def test_now_literal_stamps_the_database_clock_and_omission_holds() -> None:
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()

    tag = uuid.uuid4().hex[:10]
    user_id: str | None = None
    strategy_id: str | None = None
    try:
        # Own rows only: a throwaway auth user (the lane's auth.users trigger makes
        # the profile), one strategy, one strategy_analytics row.
        created = admin.auth.admin.create_user(
            {
                "email": f"p166-5-{tag}@quantalyze.test",
                "password": uuid.uuid4().hex,
                "email_confirm": True,
            }
        )
        user_id = created.user.id
        strategy = (
            admin.table("strategies")
            .insert({"user_id": user_id, "name": f"p166.5-now-literal-{tag}"})
            .execute()
        )
        strategy_id = strategy.data[0]["id"]
        # The DATABASE's clock, read back from a column it defaulted itself
        # (strategies.created_at DEFAULT now(), written in the insert above).
        db_clock = _parse(strategy.data[0]["created_at"])

        seed = datetime.now(timezone.utc) - timedelta(days=30)
        admin.table("strategy_analytics").upsert(
            {
                "strategy_id": strategy_id,
                "computation_status": "complete",
                "computed_at": seed.isoformat(),
            },
            on_conflict="strategy_id",
        ).execute()

        def _computed_at() -> str:
            rows = (
                admin.table("strategy_analytics")
                .select("computed_at")
                .eq("strategy_id", strategy_id)
                .execute()
                .data
            )
            assert len(rows) == 1, f"expected exactly this probe's one row, got {len(rows)}"
            return rows[0]["computed_at"]

        assert abs(_parse(_computed_at()) - seed) < timedelta(seconds=5), (
            "the seed did not land; the rest of the probe would measure nothing"
        )

        # (1) the literal moves the row to the DATABASE's present.
        admin.table("strategy_analytics").upsert(
            {
                "strategy_id": strategy_id,
                "computation_status": "complete",
                "computed_at": "now",
            },
            on_conflict="strategy_id",
        ).execute()
        stamped = _computed_at()
        stamped_dt = _parse(stamped)
        assert stamped_dt - seed > timedelta(days=29), (
            f"computed_at did not move off the 30-day-old seed: {stamped!r} vs seed {seed.isoformat()!r}"
        )
        assert timedelta(0) <= stamped_dt - db_clock < timedelta(seconds=120), (
            "the stamp must sit within 120 s after the database's own now() "
            f"(strategies.created_at {db_clock.isoformat()!r}), got {stamped!r}"
        )

        # (2) omission leaves the date alone, on a write the hold trigger ignores
        # (complete_with_warnings) and on one it also holds (computing).
        for status in ("complete_with_warnings", "computing"):
            admin.table("strategy_analytics").upsert(
                {"strategy_id": strategy_id, "computation_status": status},
                on_conflict="strategy_id",
            ).execute()
            assert _computed_at() == stamped, (
                f"an upsert omitting computed_at (status {status!r}) changed the date"
            )

        # (3) the literal is type-checked: a near-miss is a hard 22007, not text.
        with pytest.raises(APIError) as excinfo:
            admin.table("strategy_analytics").upsert(
                {"strategy_id": strategy_id, "computed_at": "nowish"},
                on_conflict="strategy_id",
            ).execute()
        assert excinfo.value.code == "22007", (
            f"expected SQLSTATE 22007 for a malformed timestamptz, got {excinfo.value.code!r}"
        )
        assert _computed_at() == stamped, "a rejected write must leave the date untouched"
    finally:
        if strategy_id is not None:
            try:
                admin.table("strategies").delete().eq("id", strategy_id).execute()
            except Exception:  # pragma: no cover - cleanup of our own rows only
                pass
        if user_id is not None:
            try:
                admin.auth.admin.delete_user(user_id)
            except Exception:  # pragma: no cover
                pass
