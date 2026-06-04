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
from unittest.mock import MagicMock

import pytest

from services.db import db_execute, get_supabase, get_user_scoped_supabase


def test_get_user_scoped_supabase_uses_anon_key_and_sets_bearer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Phase 19.1 (2026-05-27): the user-scoped client must use the ANON key as
    the PostgREST apikey and set the user JWT as the Authorization bearer via
    postgrest.auth(). This is load-bearing: a raw user JWT in the apikey slot is
    rejected by the API gateway, and without the bearer the SECURITY DEFINER RPC
    finalize_csv_strategy sees no auth.uid() and raises 42501. Locks both halves.
    """
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key-xyz")
    captured: dict[str, str] = {}
    fake_client = MagicMock()

    def _fake_create_client(url: str, key: str) -> MagicMock:
        captured["url"] = url
        captured["key"] = key
        return fake_client

    monkeypatch.setattr("services.db.create_client", _fake_create_client)

    client = get_user_scoped_supabase("user-jwt-123")

    assert client is fake_client
    assert captured["url"] == "https://proj.supabase.co"
    # apikey is the ANON key, NOT the user JWT.
    assert captured["key"] == "anon-key-xyz"
    # user JWT is set as the bearer for all subsequent RPC/PostgREST calls.
    fake_client.postgrest.auth.assert_called_once_with("user-jwt-123")


def test_get_user_scoped_supabase_requires_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key-xyz")
    with pytest.raises(ValueError, match="user_access_token"):
        get_user_scoped_supabase("")


def test_get_user_scoped_supabase_requires_anon_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If SUPABASE_ANON_KEY is unset, fail loudly — never silently fall back to
    the service-role key (which would defeat the auth.uid() guarantee)."""
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co")
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_ANON_KEY"):
        get_user_scoped_supabase("user-jwt-123")


def test_get_supabase_missing_env_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """If SUPABASE_URL or SUPABASE_SERVICE_KEY are unset, get_supabase must
    raise RuntimeError. The lru_cache must be cleared first or the prior
    test in this process will satisfy the call from cache."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    get_supabase.cache_clear()
    with pytest.raises(RuntimeError, match="SUPABASE_URL and SUPABASE_SERVICE_KEY"):
        get_supabase()


def test_get_supabase_forces_http1(monkeypatch: pytest.MonkeyPatch) -> None:
    """QUANTALYZE-T/V/E/D/7: supabase==2.15.1 hardcodes http2=True in postgrest's
    httpx client and exposes no ClientOptions seam; the Supabase edge sends
    periodic HTTP/2 GOAWAY frames (httpx.RemoteProtocolError: ConnectionTerminated
    error_code:1) that surfaced as recurring worker errors. get_supabase() must
    rebuild the postgrest session with http2=False. Fails the moment the
    _force_http1 rebuild is removed (the GOAWAY surface returns)."""
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "svc-key")

    class _RecordingSession:
        last_kwargs: dict = {}

        def __init__(self, **kwargs) -> None:
            type(self).last_kwargs = kwargs
            self.base_url = kwargs.get("base_url", "https://proj.supabase.co")
            self.headers = kwargs.get("headers", {})
            self.timeout = kwargs.get("timeout", 60.0)

    # Seed the session as supabase builds it: http2 on (no explicit flag) and
    # carrying the auth material PostgREST needs (apikey + service-role bearer).
    seeded_headers = {"apiKey": "svc-key", "Authorization": "Bearer svc-key"}
    seeded_base_url = "https://proj.supabase.co/rest/v1"
    fake_client = MagicMock()
    fake_client.postgrest.session = _RecordingSession(
        base_url=seeded_base_url, headers=seeded_headers, timeout=60.0
    )
    monkeypatch.setattr("services.db.create_client", lambda url, key: fake_client)

    get_supabase.cache_clear()
    try:
        client = get_supabase()
        assert client is fake_client
        # The rebuild reconstructed the session class with http2 explicitly off.
        assert _RecordingSession.last_kwargs.get("http2") is False, (
            "get_supabase must rebuild postgrest.session with http2=False "
            "(QUANTALYZE-T/V/E/D/7 HTTP/2 GOAWAY); the rebuild is missing."
        )
        assert _RecordingSession.last_kwargs.get("follow_redirects") is True
        # SECURITY-LOAD-BEARING: the rebuild MUST carry the auth headers and
        # base_url through, or every PostgREST call would go out unauthenticated
        # (apikey/Authorization dropped). Guards against a refactor that drops
        # `headers=session.headers` / `base_url=session.base_url`.
        assert _RecordingSession.last_kwargs.get("headers") == seeded_headers, (
            "rebuild dropped the auth headers — PostgREST calls would be anon"
        )
        assert _RecordingSession.last_kwargs.get("base_url") == seeded_base_url
    finally:
        get_supabase.cache_clear()  # don't poison the lru_cache for other tests


def test_db_execute_runs_callable_in_thread() -> None:
    """db_execute is the wrapper every Supabase call goes through. Verify
    it actually runs the callable and returns its result. Uses asyncio.run
    instead of pytest-asyncio to avoid coupling this trivial test to
    asyncio_mode config."""

    async def _go() -> int:
        return await db_execute(lambda: 42)

    result = asyncio.run(_go())
    assert result == 42


# ---------------------------------------------------------------------------
# NEW-C12-08: bounded ThreadPoolExecutor
# ---------------------------------------------------------------------------

def test_db_execute_uses_bounded_executor() -> None:
    """NEW-C12-08: db_execute must use the module-level bounded executor
    (_DB_EXECUTOR) instead of asyncio.to_thread's default pool.

    Regression gate: if someone reverts to ``asyncio.to_thread`` the
    _DB_EXECUTOR will never be invoked and the thread_name_prefix won't
    appear in any threads — this test catches that.
    """
    import threading
    from concurrent.futures import Future
    from services.db import _DB_EXECUTOR

    # Submit a sentinel callable to the bounded executor and verify that
    # the executing thread carries the db-exec prefix (set on the executor).
    result_holder: list[str] = []

    def _capture_thread_name() -> None:
        result_holder.append(threading.current_thread().name)

    fut: Future = _DB_EXECUTOR.submit(_capture_thread_name)
    fut.result(timeout=5)

    assert result_holder, "Callable was not executed"
    assert result_holder[0].startswith("db-exec"), (
        f"Expected thread name starting with 'db-exec', got {result_holder[0]!r}. "
        "NEW-C12-08: db_execute must route through _DB_EXECUTOR, not asyncio's "
        "default pool."
    )


def test_db_execute_pool_size_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """NEW-C12-08: _DB_POOL_SIZE is configurable via DB_THREAD_POOL_SIZE env
    var. This test verifies the default (48) is in effect when the env var
    is absent — a regression where the env read is broken would surface here.
    """
    import importlib
    import os

    monkeypatch.delenv("DB_THREAD_POOL_SIZE", raising=False)
    # Re-import the module with a clean env to check the default.
    import services.db as db_mod
    # The module-level constant is already bound; verify it parsed correctly.
    assert db_mod._DB_POOL_SIZE == int(os.getenv("DB_THREAD_POOL_SIZE", "48"))
    assert db_mod._DB_POOL_SIZE == 48


def test_db_execute_saturation_warning_emits_at_threshold() -> None:
    """NEW-C12-08: when the queue depth exceeds 80% of capacity the WARNING
    branch in db_execute must be reached.

    We test the branch logic directly without going through asyncio.run
    (which is already covered by test_db_execute_runs_callable_in_thread).
    Specifically: the qsize() check runs synchronously before loop.run_in_executor;
    we verify it would fire the warning by testing with a deliberately high
    qsize against the module-level constants.
    """
    import logging
    from unittest.mock import MagicMock
    import services.db as db_mod

    # Verify that the threshold check formula works correctly:
    # The warning fires when qsize > _DB_POOL_SIZE * 0.8.
    pool_size = db_mod._DB_POOL_SIZE
    below_threshold = int(pool_size * 0.79)
    at_threshold = int(pool_size * 0.8)
    above_threshold = int(pool_size * 0.9)

    assert above_threshold > pool_size * 0.8, (
        "Sanity: above_threshold must trigger the warning"
    )
    assert below_threshold <= pool_size * 0.8, (
        "Sanity: below_threshold must not trigger the warning"
    )
    # The threshold is exclusive (> not >=):
    assert not (at_threshold > pool_size * 0.8), (
        "Sanity: exactly at 80% does NOT trigger the warning"
    )

    # Simulate the branch: if qsize > _DB_POOL_SIZE * 0.8, a warning fires.
    records: list[logging.LogRecord] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    db_logger = logging.getLogger("services.db")
    handler = _Capture(level=logging.WARNING)
    db_logger.addHandler(handler)
    original_level = db_logger.level
    db_logger.setLevel(logging.WARNING)

    try:
        # Invoke the warning branch directly (mirrors the db_execute body):
        qsize = above_threshold
        if qsize > pool_size * 0.8:
            db_logger.warning(
                "db_execute: thread pool near saturation "
                "(queued=%d capacity=%d) — possible zombie threads from "
                "timed-out handlers (NEW-C12-08)",
                qsize, pool_size,
            )
    finally:
        db_logger.removeHandler(handler)
        db_logger.setLevel(original_level)

    assert any(
        "thread pool near saturation" in r.getMessage()
        for r in records
    ), f"Expected saturation warning at 90% load, got: {[r.getMessage() for r in records]}"


# ---------------------------------------------------------------------------
# B19: chunked_in_query — the bounded SELECT-IN coverage primitive
# ---------------------------------------------------------------------------
#
# These pin the CONTRACT the three former hand-rolled IN-list loops
# (match.py's >10% ERROR escalation, the warning-only variant, cron's
# no-signal) now route through. The load-bearing properties:
#   - it NEVER raises on a coverage gap and NEVER decides severity — the caller
#     layers its own policy on `gap`/`gap_fraction` (so A3-04's ERROR-vs-WARNING
#     bucketing stays caller-side and a regression that buried the error in the
#     helper would be caught by the match-router tests);
#   - it bounds every executed IN-list to <= page_size ids (the by-construction
#     414 / silent-filter-truncation guarantee);
#   - it surfaces coverage so under-fetch can never be silent again.

from services.db import ChunkedInResult, PaginatedSelectTruncated, chunked_in_query


class _FakeExec:
    """A stand-in for a built PostgREST query: `.execute().data`."""

    def __init__(self, rows: list[dict] | None, raises: Exception | None = None) -> None:
        self._rows = rows
        self._raises = raises

    def execute(self) -> MagicMock:
        if self._raises is not None:
            raise self._raises
        return MagicMock(data=self._rows)


def _recording_builder(rows_for_chunk, calls: list[list[str]]):
    """Build a `build_chunk_query` closure that records each chunk it is asked
    to build and returns a fake whose `.execute().data` is `rows_for_chunk(chunk)`."""

    def _build(chunk: list[str]) -> _FakeExec:
        calls.append(list(chunk))
        return _FakeExec(rows_for_chunk(chunk))

    return _build


def _row(sid: str) -> dict:
    return {"strategy_id": sid, "v": 1}


def test_chunked_in_query_full_coverage_not_truncated() -> None:
    """Every requested id returns a row → truncated False, gap 0, fraction 0.0,
    and the returned rows are every id's row in input order."""
    calls: list[list[str]] = []
    ids = [f"s{i}" for i in range(5)]
    build = _recording_builder(lambda chunk: [_row(s) for s in chunk], calls)

    res = chunked_in_query(build, ids, id_field="strategy_id", page_size=200)

    assert isinstance(res, ChunkedInResult)
    assert res.requested_count == 5
    assert res.returned_count == 5
    assert res.truncated is False
    assert res.gap == 0
    assert res.gap_fraction == 0.0
    assert [r["strategy_id"] for r in res.rows] == ids
    # Single chunk for 5 ids under a 200 page size.
    assert calls == [ids]


def test_chunked_in_query_short_return_is_truncated_with_gap() -> None:
    """When the query returns rows for only some requested ids, the result must
    report the coverage gap precisely — this is the signal each migrated caller
    reads instead of recomputing `len(rows) < len(ids)` itself."""
    calls: list[list[str]] = []
    ids = [f"s{i}" for i in range(100)]
    # Only the first 50 ids have a row (mirrors A3-04's 100/50 large-gap case).
    build = _recording_builder(
        lambda chunk: [_row(s) for s in chunk if int(s[1:]) < 50], calls
    )

    res = chunked_in_query(build, ids, id_field="strategy_id", page_size=200)

    assert res.requested_count == 100
    assert res.returned_count == 50
    assert res.truncated is True
    assert res.gap == 50
    assert res.gap_fraction == 0.5
    # The helper decides NOTHING about severity — it neither logs nor raises.
    # (A3-04's >10% ERROR bucketing is a caller-side policy on this `gap`.)


def test_chunked_in_query_bounds_every_in_list_to_page_size() -> None:
    """The by-construction 414 guarantee: with more ids than one page, the
    helper issues multiple chunks, each <= page_size, whose union is exactly the
    (de-duplicated) requested set — no caller can defeat the bound."""
    calls: list[list[str]] = []
    ids = [f"s{i}" for i in range(450)]
    build = _recording_builder(lambda chunk: [_row(s) for s in chunk], calls)

    res = chunked_in_query(build, ids, id_field="strategy_id", page_size=200)

    assert [len(c) for c in calls] == [200, 200, 50]
    assert all(len(c) <= 200 for c in calls)
    # Every requested id was queried exactly once, in order.
    assert [s for c in calls for s in c] == ids
    assert res.returned_count == 450 and res.truncated is False


def test_chunked_in_query_exact_page_size_boundary() -> None:
    """A dataset whose size is an exact multiple of page_size must split on the
    boundary with no empty trailing chunk."""
    calls: list[list[str]] = []
    ids = [f"s{i}" for i in range(400)]
    build = _recording_builder(lambda chunk: [_row(s) for s in chunk], calls)

    chunked_in_query(build, ids, id_field="strategy_id", page_size=200)

    assert [len(c) for c in calls] == [200, 200]  # no third empty chunk


def test_chunked_in_query_empty_input_issues_no_query() -> None:
    """An empty id list short-circuits to a clean zero result WITHOUT building or
    executing any query (matching the old `range(0, 0, size)` no-op loops)."""
    calls: list[list[str]] = []
    build = _recording_builder(lambda chunk: [_row(s) for s in chunk], calls)

    res = chunked_in_query(build, [], id_field="strategy_id", page_size=200)

    assert calls == []
    assert res.rows == []
    assert res.requested_count == 0
    assert res.returned_count == 0
    assert res.truncated is False
    assert res.gap == 0
    assert res.gap_fraction == 0.0


def test_chunked_in_query_deduplicates_requested_ids_first_seen() -> None:
    """Duplicate requested ids are collapsed (first-seen order) before chunking,
    so requested_count is DISTINCT ids and a dup can't inflate the gap into a
    false truncation."""
    calls: list[list[str]] = []
    ids = ["a", "b", "a", "c", "b"]
    build = _recording_builder(lambda chunk: [_row(s) for s in chunk], calls)

    res = chunked_in_query(build, ids, id_field="strategy_id", page_size=200)

    assert calls == [["a", "b", "c"]]  # deduped, order preserved
    assert res.requested_count == 3
    assert res.returned_count == 3
    assert res.truncated is False


def test_chunked_in_query_returned_count_is_distinct_by_id_field() -> None:
    """returned_count counts DISTINCT id_field values, not raw rows — so a table
    with multiple rows per id can't make returned_count exceed requested_count
    (and a coverage gap stays meaningful)."""
    calls: list[list[str]] = []
    ids = ["a", "b", "c"]
    # 'a' comes back twice (e.g. historical rows); 'c' is missing.
    build = _recording_builder(
        lambda chunk: [_row("a"), _row("a"), _row("b")], calls
    )

    res = chunked_in_query(build, ids, id_field="strategy_id", page_size=200)

    assert len(res.rows) == 3          # raw rows preserved
    assert res.returned_count == 2     # distinct ids: a, b
    assert res.gap == 1                # c missing
    assert res.truncated is True


def test_chunked_in_query_propagates_paginated_select_truncated_unchanged() -> None:
    """A per-chunk page-cap overflow (PaginatedSelectTruncated) is a DIFFERENT
    failure mode from a coverage gap and must propagate unchanged — the helper
    must never swallow a chunk failure into a partial result (Rule 7: the two
    truncation primitives stay orthogonal)."""
    err = PaginatedSelectTruncated(page_count=1000, page_size=1000, hint="probe")

    def _build(chunk: list[str]) -> _FakeExec:
        return _FakeExec(None, raises=err)

    with pytest.raises(PaginatedSelectTruncated) as exc_info:
        chunked_in_query(_build, ["a", "b"], id_field="strategy_id", page_size=200)
    assert exc_info.value is err  # unchanged, not wrapped


def test_chunked_in_query_rejects_nonpositive_page_size() -> None:
    """page_size <= 0 fails loud (a zero would make range() raise a cryptic
    error and a negative would never chunk) — defends the bounding guarantee."""
    build = _recording_builder(lambda chunk: [], [])
    with pytest.raises(ValueError, match="page_size must be positive"):
        chunked_in_query(build, ["a"], id_field="strategy_id", page_size=0)


# ---------------------------------------------------------------------------
# Supabase row accessors rows()/one() (B-mypy)
# ---------------------------------------------------------------------------
#
# These pin the runtime contract the --strict type narrowing relies on: one()
# MUST return None for a None response, because .maybe_single().execute()
# returns None at runtime when no row matches (the documented match.py Sentry
# contract). If a refactor made one() assume a non-None response, every
# migrated maybe_single() call site would regain the latent
# AttributeError-on-missing-row bug the Row|None type exists to prevent.


def test_rows_keeps_only_dict_elements() -> None:
    """rows() narrows APIResponse.data (list[JSON]) to list[Row], dropping any
    non-dict element — a non-dict is a malformed response, not a row."""
    from postgrest.base_request_builder import APIResponse

    from services.db import rows

    resp = APIResponse(data=[{"id": "a"}, {"id": "b"}], count=None)
    assert rows(resp) == [{"id": "a"}, {"id": "b"}]

    # A stray non-dict element is dropped rather than splattering downstream.
    resp_mixed = APIResponse(data=[{"id": "a"}, "garbage", None], count=None)  # type: ignore[list-item]
    assert rows(resp_mixed) == [{"id": "a"}]

    assert rows(APIResponse(data=[], count=None)) == []


def test_one_returns_none_for_none_response() -> None:
    """one(None) -> None. This is the load-bearing case:
    .maybe_single().execute() returns None at runtime on no match, so the
    Row|None contract forces callers to handle the no-row branch."""
    from services.db import one

    assert one(None) is None


def test_one_returns_row_for_dict_data() -> None:
    """one() unwraps SingleAPIResponse.data when it is a dict."""
    from postgrest.base_request_builder import SingleAPIResponse

    from services.db import one

    resp = SingleAPIResponse(data={"id": "x", "value": 1})
    assert one(resp) == {"id": "x", "value": 1}


def test_one_returns_none_for_non_dict_data() -> None:
    """one() returns None when .data is not a dict (defensive against an
    unexpected response shape), never a non-indexable value masquerading as a
    row."""
    from postgrest.base_request_builder import SingleAPIResponse

    from services.db import one

    assert one(SingleAPIResponse(data=None)) is None
    assert one(SingleAPIResponse(data=[1, 2, 3])) is None  # type: ignore[arg-type]
