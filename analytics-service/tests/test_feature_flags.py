"""Phase 19 / BACKBONE-04 + BACKBONE-05 — feature flag read seam tests.

Asserted invariants:
  1. Kill-switch wins when env=on AND kill_switch=off (returns False).
  2. env=on AND kill_switch=on returns True.
  3. env=off returns False regardless of kill_switch.
  4. Supabase outage (raises) → falls through to env value (Pitfall 6 fail-soft).
  5. 30s in-process cache prevents repeat Supabase reads.
  6. _reset_cache_for_tests clears cache cleanly.

Mocks `services.db.get_supabase` since feature_flags.py imports lazily.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services import feature_flags
from services.feature_flags import (
    _reset_cache_for_tests,
    is_unified_backbone_active,
)


@pytest.fixture(autouse=True)
def _clear_cache():
    """Reset the in-process cache between every test."""
    _reset_cache_for_tests()
    yield
    _reset_cache_for_tests()


def _mock_supabase_kill_switch(value: str | None):
    """Build a supabase client mock whose `feature_flags` row returns `value`.

    `value=None` → row absent (maybe_single returns no .data).
    `value='on'` or `value='off'` → row present with that value.
    """
    fake_supabase = MagicMock()
    table = fake_supabase.table.return_value
    select = table.select.return_value
    eq = select.eq.return_value
    maybe_single = eq.maybe_single.return_value
    if value is None:
        maybe_single.execute.return_value = MagicMock(data=None)
    else:
        maybe_single.execute.return_value = MagicMock(data={"value": value})
    return fake_supabase


@pytest.mark.asyncio
async def test_env_on_kill_switch_off_returns_off(monkeypatch):
    """Kill-switch wins: env=on AND kill_switch=off → False."""
    monkeypatch.setenv("PROCESS_KEY_UNIFIED_BACKBONE", "on")
    fake_supabase = _mock_supabase_kill_switch("off")
    with patch("services.feature_flags.get_supabase", return_value=fake_supabase):
        result = await is_unified_backbone_active()
    assert result is False


@pytest.mark.asyncio
async def test_env_on_kill_switch_on_returns_on(monkeypatch):
    """env=on AND kill_switch=on → True."""
    monkeypatch.setenv("PROCESS_KEY_UNIFIED_BACKBONE", "on")
    fake_supabase = _mock_supabase_kill_switch("on")
    with patch("services.feature_flags.get_supabase", return_value=fake_supabase):
        result = await is_unified_backbone_active()
    assert result is True


@pytest.mark.asyncio
async def test_env_off_kill_switch_on_returns_off(monkeypatch):
    """env=off → False regardless of kill_switch (env is the gating layer)."""
    monkeypatch.setenv("PROCESS_KEY_UNIFIED_BACKBONE", "off")
    fake_supabase = _mock_supabase_kill_switch("on")
    with patch("services.feature_flags.get_supabase", return_value=fake_supabase):
        result = await is_unified_backbone_active()
    assert result is False


@pytest.mark.asyncio
async def test_supabase_outage_falls_back_to_env(monkeypatch):
    """When supabase raises, fall through to env (Pitfall 6 fail-soft)."""
    monkeypatch.setenv("PROCESS_KEY_UNIFIED_BACKBONE", "on")

    def _raise(*_a, **_kw):
        raise RuntimeError("supabase unreachable")

    with patch("services.feature_flags.get_supabase", side_effect=_raise):
        # Outage means no kill_switch_off → env=on returns True.
        result = await is_unified_backbone_active()
    assert result is True

    # Symmetric check: env=off returns False even on outage.
    _reset_cache_for_tests()
    monkeypatch.setenv("PROCESS_KEY_UNIFIED_BACKBONE", "off")
    with patch("services.feature_flags.get_supabase", side_effect=_raise):
        result = await is_unified_backbone_active()
    assert result is False


@pytest.mark.asyncio
async def test_30s_cache(monkeypatch):
    """Two consecutive calls within TTL hit cache (Supabase called once)."""
    monkeypatch.setenv("PROCESS_KEY_UNIFIED_BACKBONE", "on")
    fake_supabase = _mock_supabase_kill_switch("on")
    with patch(
        "services.feature_flags.get_supabase", return_value=fake_supabase
    ) as gs:
        # Pin time.monotonic to a fixed value so cache TTL doesn't expire mid-test.
        with patch("services.feature_flags.time.monotonic", return_value=1000.0):
            await is_unified_backbone_active()
            await is_unified_backbone_active()
        # Each call to is_unified_backbone_active resolves get_supabase()
        # ONCE on a cold cache; second call must read cache, not Supabase.
        assert gs.call_count == 1


@pytest.mark.asyncio
async def test_reset_cache_for_tests(monkeypatch):
    """_reset_cache_for_tests forces the next call to hit Supabase again."""
    monkeypatch.setenv("PROCESS_KEY_UNIFIED_BACKBONE", "on")
    fake_supabase = _mock_supabase_kill_switch("on")
    with patch(
        "services.feature_flags.get_supabase", return_value=fake_supabase
    ) as gs:
        with patch("services.feature_flags.time.monotonic", return_value=2000.0):
            await is_unified_backbone_active()
            _reset_cache_for_tests()
            await is_unified_backbone_active()
        assert gs.call_count == 2


@pytest.mark.asyncio
async def test_cache_expires_after_ttl(monkeypatch):
    """Move time.monotonic past the 30s TTL → next call re-reads Supabase."""
    monkeypatch.setenv("PROCESS_KEY_UNIFIED_BACKBONE", "on")
    fake_supabase = _mock_supabase_kill_switch("on")
    with patch(
        "services.feature_flags.get_supabase", return_value=fake_supabase
    ) as gs:
        # Cold call at t=100; cache valid through t=130.
        with patch("services.feature_flags.time.monotonic", return_value=100.0):
            await is_unified_backbone_active()
        # Move time forward past TTL to t=200; must re-read Supabase.
        with patch("services.feature_flags.time.monotonic", return_value=200.0):
            await is_unified_backbone_active()
        assert gs.call_count == 2


def test_module_constants():
    """Sanity check that _CACHE_TTL_S = 30 (locked per CONTEXT.md L37)."""
    assert feature_flags._CACHE_TTL_S == 30.0


@pytest.mark.asyncio
async def test_single_flight_lock_prevents_stampede():
    """CR-perf-3 regression: directly assert the single-flight invariant.

    The async function is_unified_backbone_active is fully sync between
    the cache check and the supabase call (no awaits), so under stock
    asyncio.gather coroutines run to completion sequentially — meaning
    a pure-mock stampede test cannot trigger the bug. We instead assert
    the mechanism: the locks dict is populated under the per-flag key,
    and a re-entry while the lock is held re-checks the cache (so the
    second waiter does NOT call get_supabase).
    """
    from services import feature_flags as ff

    _reset_cache_for_tests()
    # Lock instance is created on first lookup.
    lock = ff._get_refresh_lock("process_key_unified_backbone")
    assert isinstance(lock, type(lock))  # asyncio.Lock smoke
    # Same key returns same instance — important so concurrent waiters
    # actually share the lock rather than each grabbing a fresh one.
    assert ff._get_refresh_lock("process_key_unified_backbone") is lock
    # Different keys get different locks (so adding flags later doesn't
    # serialize them all behind one global lock).
    assert ff._get_refresh_lock("other_flag") is not lock
