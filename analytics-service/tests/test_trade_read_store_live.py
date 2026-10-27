"""Phase 171 READCEILING plan 11 - live PostgREST probe of the resumable trade-read store.

``services.trade_read_store`` keeps each complete 7-day window of a Bybit trade read as
positional JSON arrays in a ``jsonb`` column and reads them back for the replay. That is correct
only if the real stack hands back EXACTLY what went in: every float equal, every ``None`` kept,
the order kept, and a full 5,000-trade chunk accepted in one request. It also needs the real
primary keys (the upserts), the real grants (``service_role`` UPDATE for the counters and DELETE
for the purges) and the real foreign key to ``api_keys``. All of that is a property of
Postgres, PostgREST and plan 03's migration, not of our code, so the offline tests
(``test_trade_read_store.py``, whose fake client is only a mirror) cannot prove it. This probe
does, against the same local-stack PostgREST image CI runs (RESEARCH Pitfall 8: assert it in a
test, do not assume it).

Own rows only: a throwaway auth user and one ``api_keys`` row per key the test needs, all
deleted in ``finally`` (the store rows cascade with the key). The probe WRITES, so it refuses
any host that is not a loopback lane (T-171-28; the T-166.5-03 pattern).

Gating mirrors ``test_nav_marks_writer_live.py``: skip locally when the lane env is unset,
``pytest.fail`` when it is unset and ``CI == "true"``.

Every ``store.begin_claim`` a test calls is asserted to have returned a ``ReadState``: the store
turns a raised call into ``None`` (its fault disposition), so an assertion made after a ``None``
would pass on a fault.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import pytest

try:
    from supabase import create_client
except ImportError:  # pragma: no cover
    create_client = None  # type: ignore[assignment]

from services import trade_read_store as store
from tests.live_db_transport import wrap_live_db_client

SUPABASE_URL = os.getenv("SUPABASE_TEST_URL")
SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

#: The seven stored fields, in the order the contract fixes. Written out here on purpose: the
#: expectation below must not be derived from the store's own projection code.
_FIELDS = ("timestamp", "symbol", "side", "amount", "price", "cost", "fee")

_WEEK_MS = 7 * 24 * 3600 * 1000


def _require_loopback_lane(url: str | None) -> None:
    """``pytest.fail`` unless ``url`` names a loopback host. This probe writes rows, and the
    env var it reads is pointed at shared TEST by other CI jobs, so the host is checked here."""
    host = urlparse(url or "").hostname
    if host not in _LOOPBACK_HOSTS:
        pytest.fail(
            "test_trade_read_store_live refuses to write: SUPABASE_TEST_URL host is "
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
                "171 trade-read store live probe cannot run: SUPABASE_TEST_URL / "
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
            "email": f"p171-tr-{tag}@quantalyze.test",
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
                "label": f"p171-tr-{tag}",
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


async def _claim(admin, key_id, *, since_ms: int, job_id: str | None) -> store.ReadState:  # type: ignore[no-untyped-def]
    """``store.begin_claim`` that insists on a real answer: a ``None`` is the store's fault
    disposition, and every assertion made after it would be vacuous."""
    state = await store.begin_claim(admin, key_id, venue="bybit", since_ms=since_ms, job_id=job_id)
    assert state is not None, "begin_claim answered None: the store faulted against the real tables"
    assert isinstance(state, store.ReadState)
    return state


def _state_row(admin, key_id):  # type: ignore[no-untyped-def]
    rows = (
        admin.table(store.STATE_TABLE)
        .select("claims,stalled_claims,read_version,last_job_id")
        .eq("api_key_id", key_id)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _window_rows(admin, key_id):  # type: ignore[no-untyped-def]
    return (
        admin.table(store.WINDOW_TABLE)
        .select("window_start_ms,chunk_index")
        .eq("api_key_id", key_id)
        .execute()
        .data
    )


# Doubles that stress a decimal round trip: long and short decimal forms, both extremes of the
# double range, a negative zero, and values that are not exactly representable.
_EXTREME_VALUES = (
    0.1,
    1e-05,
    123456.789012345,
    2.2250738585072014e-308,
    1.7976931348623157e308,
    -0.0,
    0.30000000000000004,
    5e-324,
    1.0,
    100.0,
)


def _build_trades(n: int) -> list[dict]:
    """``n`` ccxt-shaped trades. The numeric fields cycle through the extreme values at
    different strides, and every field the store keeps as ``None`` is ``None`` somewhere."""
    trades: list[dict] = []
    for i in range(n):
        ex = _EXTREME_VALUES
        fee_shape = i % 4
        fee: object
        if fee_shape == 0:
            fee = {"cost": ex[(i + 3) % len(ex)], "currency": "USDT"}
        elif fee_shape == 1:
            fee = {"cost": None, "currency": "USDT"}
        elif fee_shape == 2:
            fee = ex[(i + 5) % len(ex)]
        else:
            fee = None
        trades.append(
            {
                "timestamp": 1_700_000_000_000 + i,
                "symbol": None if i % 97 == 0 else f"SYM{i % 7}/USDT:USDT",
                "side": None if i % 89 == 0 else ("buy" if i % 2 == 0 else "sell"),
                "amount": None if i % 83 == 0 else ex[i % len(ex)],
                "price": None if i % 79 == 0 else ex[(i + 1) % len(ex)],
                "cost": None if i % 73 == 0 else ex[(i + 2) % len(ex)],
                "fee": fee,
            }
        )
    return trades


def _expected(trade: dict) -> tuple:
    """The seven values a stored trade must give back, built straight from the ccxt dict.
    The fee is reduced the way the replay reduces it (a dict becomes ``cost or 0.0``); a float
    or ``None`` fee stays as it is."""
    fee = trade["fee"]
    if isinstance(fee, dict):
        fee = fee.get("cost") or 0.0
    return (
        trade["timestamp"], trade["symbol"], trade["side"],
        trade["amount"], trade["price"], trade["cost"], fee,
    )


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


async def test_a_stored_window_round_trips_through_postgrest() -> None:
    """RESEARCH Pitfall 8: a window of 5,001 trades (one full 5,000-trade chunk and a chunk of
    1) stored through the real PostgREST into plan 03's real tables reads back as exactly the
    trades that went in: every float equal, every ``None`` kept, the order kept."""
    _need_supabase()
    _require_loopback_lane(SUPABASE_URL)
    admin = _lane_client()
    user_id = key_id = None
    try:
        user_id, key_id = _seed_key(admin)
        originals = _build_trades(store.STORE_CHUNK_TRADES + 1)
        start_ms = 1_700_000_000_000
        end_ms = start_ms + _WEEK_MS

        # The largest chunk's JSON, so the SUMMARY can quote what one request carries.
        largest = json.dumps([store.project_trade(t) for t in originals[: store.STORE_CHUNK_TRADES]])
        print(f"largest chunk JSON bytes: {len(largest.encode('utf-8'))}")

        assert await store.save_window(admin, key_id, start_ms, end_ms, originals) is True

        state = await _claim(admin, key_id, since_ms=start_ms, job_id=str(uuid.uuid4()))
        assert set(state.stored) == {start_ms}, state.stored
        meta = state.stored[start_ms]
        assert (meta.chunk_count, meta.n_trades) == (2, len(originals))

        loaded = await store.load_window(admin, key_id, meta)
        assert loaded is not None, "load_window answered None: the stored window was unusable"
        assert len(loaded) == len(originals)
        widened = 0
        for index, (trade, back) in enumerate(zip(originals, loaded, strict=True)):
            want = _expected(trade)
            got = tuple(back[f] for f in _FIELDS)
            for name, w, g in zip(_FIELDS, want, got, strict=True):
                # A None must come back as None, not as 0 or an empty value that == nothing.
                assert (w is None) == (g is None), f"trade {index} field {name}: None changed"
                if type(g) is int and type(w) is float:
                    # MEASURED PostgREST/jsonb property (Phase 171 plan 11): jsonb stores a
                    # number as an exact decimal, so a double written in exponent form with no
                    # fraction (json.dumps writes 1e+16 and above that way) comes back as a
                    # JSON integer literal, which Python parses as ``int``. The value is the
                    # same double once converted (float(int) rounds to the nearest double, and
                    # the shortest-repr digits padded with zeros round-trip), and the replay
                    # converts every amount, price and cost with ``float(...)``. The band is
                    # pinned: only |value| >= 1e16 may change type, and float() must equal it.
                    assert abs(w) >= 1e16 and float(g) == w, (
                        f"trade {index} field {name}: stored {w!r}, read back int {g!r}"
                    )
                    widened += 1
                else:
                    assert type(g) is type(w) and w == g, (
                        f"trade {index} field {name}: stored {w!r}, read back {g!r}"
                    )
        print(f"values read back as int and equal after float(): {widened} (all >= 1e16)")
    finally:
        _cleanup(admin, user_id, key_id)
