"""Phase 167.2.1.1.2 ACCTREBUILD, plan 01 - live probe of the window replace.

The worker wrapper ``replace_equity_snapshots_window`` calls the SECURITY DEFINER
function ``replace_allocator_equity_snapshots_window`` through a real PostgREST. What
this proves, and the offline module cannot:

  1. D-01: only the window is replaced. A stored day older than the window keeps every
     column it had (``reconstructed_at`` included) while the days inside the window take
     the payload's values.
  2. D-03: the seam is recorded. One ``allocator_equity_derived`` row of kind
     ``snapshot_rebuild_boundary`` carries ``{"boundary_date": <window start>}`` when an
     older day is kept, and is gone when none is kept. This is also the proof that the
     definer write to the FORCE-RLS ``allocator_equity_derived`` table succeeds on the
     service-role call path (RESEARCH assumptions A1 and A2).
  3. D-02 / SC-4: a stored day inside the window that the payload does not carry makes
     the function RAISE inside its own transaction, the DELETE rolls back, and the
     worker sees ``ForcedRebuildRefusedError("history_days_unreproduced")``. Every row of
     both tables is identical afterwards.
  4. The probe refuses to run against anything but a loopback lane. It WRITES; it must
     never reach shared TEST or PROD.

Gating mirrors ``test_computed_at_now_literal_live.py``: skip locally when the lane env
is unset, ``pytest.fail`` when it is unset and ``CI == "true"`` (a silent skip in CI
would read as green while proving nothing). Every test makes its own throwaway auth user
under quantalyze.test and deletes it in ``finally``; both tables cascade from
``auth.users``. Dates are synthetic.
"""
from __future__ import annotations

import os
import uuid
from datetime import date
from typing import Any
from urllib.parse import urlparse

import pytest

try:
    from supabase import create_client
except ImportError:  # pragma: no cover
    create_client = None  # type: ignore[assignment]

from services import equity_reconstruction as er
from tests.live_db_transport import wrap_live_db_client

SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

WINDOW_START = date(2026, 3, 1)
BOUNDARY_KIND = "snapshot_rebuild_boundary"


def _require_loopback_lane(url: str | None) -> None:
    """``pytest.fail`` unless ``url`` names a loopback host.

    This probe writes rows. The lane URL comes from an env var that CI also points at
    shared TEST in other jobs, so the host is checked here, in the test, rather than
    trusted from the environment.
    """
    host = urlparse(url or "").hostname
    if host not in _LOOPBACK_HOSTS:
        pytest.fail(
            "test_replace_snapshots_window_live refuses to write: SUPABASE_TEST_URL "
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
                "167.2.1.1.2 live probe cannot run: SUPABASE_TEST_URL / "
                "SUPABASE_TEST_SERVICE_KEY are unset in CI. The python job exports "
                "the local-stack lane as those two variables.",
                pytrace=False,
            )
        pytest.skip("local-stack lane not configured (local dev)")


def _lane_client() -> Any:
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


def _new_user(admin: Any) -> str:
    tag = uuid.uuid4().hex[:10]
    created = admin.auth.admin.create_user(
        {
            "email": f"p167-2-1-1-2-{tag}@quantalyze.test",
            "password": uuid.uuid4().hex,
            "email_confirm": True,
        }
    )
    return str(created.user.id)


def _drop_user(admin: Any, user_id: str | None) -> None:
    if user_id is None:
        return
    try:
        admin.auth.admin.delete_user(user_id)
    except Exception:  # pragma: no cover - cleanup of our own row only
        pass


def _seed_snapshot(
    admin: Any,
    user_id: str,
    asof: str,
    value_usd: float,
    *,
    breakdown: dict[str, float] | None = None,
    history_depth_months: int | None = None,
    reconstructed_at: str | None = None,
) -> None:
    row: dict[str, Any] = {
        "allocator_id": user_id,
        "asof": asof,
        "value_usd": value_usd,
        "breakdown": breakdown,
        "source": "exchange_primary",
        "history_depth_months": history_depth_months,
    }
    if reconstructed_at is not None:
        row["reconstructed_at"] = reconstructed_at
    admin.table("allocator_equity_snapshots").insert(row).execute()


def _seed_derived(admin: Any, user_id: str, kind: str, payload: dict[str, Any]) -> None:
    admin.table("allocator_equity_derived").insert(
        {"allocator_id": user_id, "kind": kind, "payload": payload}
    ).execute()


def _snapshots(admin: Any, user_id: str) -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = (
        admin.table("allocator_equity_snapshots")
        .select("*")
        .eq("allocator_id", user_id)
        .order("asof")
        .execute()
        .data
    )
    return data


def _derived(admin: Any, user_id: str) -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = (
        admin.table("allocator_equity_derived")
        .select("*")
        .eq("allocator_id", user_id)
        .order("kind")
        .execute()
        .data
    )
    return data


def _payload(*days_and_values: tuple[str, float]) -> list[dict[str, Any]]:
    return [
        {
            "asof": asof,
            "value_usd": value,
            "breakdown": {"BTC": value},
            "source": "exchange_primary",
        }
        for asof, value in days_and_values
    ]


def test_loopback_guard_refuses_every_non_lane_host() -> None:
    """The guard can fail: a remote host, an empty value and a look-alike hostname all
    trip it; the three loopback spellings pass."""
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


async def test_window_replace_keeps_older_days_and_records_the_boundary() -> None:
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()
    user_id: str | None = None
    try:
        user_id = _new_user(admin)
        _seed_snapshot(
            admin, user_id, "2026-02-20", 5.0,
            breakdown={"ETH": 1.0}, history_depth_months=24,
            reconstructed_at="2026-02-21T00:00:00+00:00",
        )
        for day in ("2026-03-01", "2026-03-02", "2026-03-03"):
            _seed_snapshot(admin, user_id, day, 1.0)
        older_before = [r for r in _snapshots(admin, user_id) if r["asof"] == "2026-02-20"]
        assert len(older_before) == 1, "the older seed row did not land"
        assert older_before[0]["history_depth_months"] == 24
        assert older_before[0]["breakdown"] == {"ETH": 1.0}

        inserted = await er.replace_equity_snapshots_window(
            admin,
            _payload(("2026-03-01", 11.0), ("2026-03-02", 12.0), ("2026-03-03", 13.0)),
            user_id,
            3,
            WINDOW_START,
        )

        assert inserted == 3
        after = _snapshots(admin, user_id)
        assert [r["asof"] for r in after] == [
            "2026-02-20", "2026-03-01", "2026-03-02", "2026-03-03",
        ]
        # D-01: the older row is byte-identical, every column, reconstructed_at included.
        assert after[0] == older_before[0]
        # The window took the payload, and the per-row depth rule of the full replace.
        assert [r["value_usd"] for r in after[1:]] == [11.0, 12.0, 13.0]
        assert [r["history_depth_months"] for r in after[1:]] == [3, 3, 3]
        # D-03: one boundary row, the window start, nothing invented.
        derived = _derived(admin, user_id)
        assert [(d["kind"], d["payload"]) for d in derived] == [
            (BOUNDARY_KIND, {"boundary_date": "2026-03-01"})
        ]
    finally:
        _drop_user(admin, user_id)


async def test_an_unreproduced_stored_day_refuses_and_writes_nothing() -> None:
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()
    user_id: str | None = None
    try:
        user_id = _new_user(admin)
        _seed_snapshot(
            admin, user_id, "2026-02-20", 5.0,
            breakdown={"ETH": 1.0}, history_depth_months=24,
            reconstructed_at="2026-02-21T00:00:00+00:00",
        )
        for day in ("2026-03-01", "2026-03-02", "2026-03-03"):
            _seed_snapshot(admin, user_id, day, 1.0)
        # The day a late daily refresh wrote after the worker built its payload.
        _seed_snapshot(admin, user_id, "2026-03-04", 2.0)
        # A boundary from an earlier rebuild, so a refusal that leaked into the
        # boundary step would be visible as a changed date.
        _seed_derived(admin, user_id, BOUNDARY_KIND, {"boundary_date": "2026-01-01"})
        snapshots_before = _snapshots(admin, user_id)
        derived_before = _derived(admin, user_id)
        assert len(snapshots_before) == 5 and len(derived_before) == 1

        with pytest.raises(er.ForcedRebuildRefusedError) as caught:
            await er.replace_equity_snapshots_window(
                admin,
                _payload(("2026-03-01", 11.0), ("2026-03-02", 12.0), ("2026-03-03", 13.0)),
                user_id,
                3,
                WINDOW_START,
            )

        assert caught.value.reason == "history_days_unreproduced"
        # The DELETE rolled back: every row of both tables is exactly what it was.
        assert _snapshots(admin, user_id) == snapshots_before
        assert _derived(admin, user_id) == derived_before
    finally:
        _drop_user(admin, user_id)


async def test_no_kept_older_day_means_no_boundary_row() -> None:
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()
    user_id: str | None = None
    try:
        user_id = _new_user(admin)
        for day in ("2026-03-01", "2026-03-02"):
            _seed_snapshot(admin, user_id, day, 1.0)
        _seed_derived(admin, user_id, BOUNDARY_KIND, {"boundary_date": "2026-01-01"})
        # A row of another kind: only the boundary kind may be touched.
        _seed_derived(admin, user_id, "equity_curve", {"curve": []})

        inserted = await er.replace_equity_snapshots_window(
            admin,
            _payload(("2026-03-01", 21.0), ("2026-03-02", 22.0)),
            user_id,
            3,
            WINDOW_START,
        )

        assert inserted == 2
        assert [(r["asof"], r["value_usd"]) for r in _snapshots(admin, user_id)] == [
            ("2026-03-01", 21.0),
            ("2026-03-02", 22.0),
        ]
        assert [(d["kind"], d["payload"]) for d in _derived(admin, user_id)] == [
            ("equity_curve", {"curve": []})
        ]
    finally:
        _drop_user(admin, user_id)
