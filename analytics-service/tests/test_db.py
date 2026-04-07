"""Tests for analytics-service/services/db.py.

Two tests cover the entire 19-line module. They look small but they're not
coverage farming:

1. The missing-env test catches the actual production failure mode (Railway
   forgets to set SUPABASE_URL → service fails to start). It also locks in
   the lru_cache footgun: get_supabase is `@lru_cache(maxsize=1)`, so any
   test that wants to verify the error path MUST call cache_clear() first
   or it will silently hit a cached client from a prior test in the same
   process.

2. The db_execute test exercises the asyncio.to_thread wrapper that every
   Supabase call goes through. If someone refactors that to call_soon or
   removes it entirely, the cron loop's "don't block the event loop"
   guarantee dies silently.
"""

import asyncio

import pytest

from services.db import db_execute, get_supabase


def test_get_supabase_missing_env_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """If SUPABASE_URL or SUPABASE_SERVICE_KEY are unset, get_supabase must
    raise RuntimeError. The lru_cache must be cleared first or the prior
    test in this process will satisfy the call from cache."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    get_supabase.cache_clear()
    with pytest.raises(RuntimeError, match="SUPABASE_URL and SUPABASE_SERVICE_KEY"):
        get_supabase()


def test_db_execute_runs_callable_in_thread() -> None:
    """db_execute is the wrapper every Supabase call goes through. Verify
    it actually runs the callable and returns its result. Uses asyncio.run
    instead of pytest-asyncio to avoid coupling this trivial test to
    asyncio_mode config."""

    async def _go() -> int:
        return await db_execute(lambda: 42)

    result = asyncio.run(_go())
    assert result == 42
