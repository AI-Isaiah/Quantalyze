import asyncio
import logging
import os
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

logger = logging.getLogger(__name__)

# NEW-C12-08: asyncio.to_thread posts work to Python's default ThreadPoolExecutor
# (min(32, cpu+4) workers) which can silently saturate when many handler timeouts
# leave zombie threads (asyncio.wait_for cancels the future but the underlying
# synchronous Supabase/ccxt call keeps running in its thread). A saturated pool
# makes EVERY db_execute across all loops block — a whole-worker stall with no
# operator signal.
#
# Fix: run all db_execute calls through a bounded module-level executor. The
# queue-depth alarm (logging a WARNING when usage exceeds 80%) gives operators
# a visible signal before full saturation.
#
# Sizing: 48 threads supports 5-job batches × 4 concurrent worker loops on a
# 4-core container with headroom for slow Supabase calls (typical latency
# < 200ms). Exceeding this bound raises RuntimeError from the loop, which
# classify_exception maps to transient — the job retries cleanly without
# silently blocking.
_DB_POOL_SIZE = int(os.getenv("DB_THREAD_POOL_SIZE", "48"))
_DB_EXECUTOR = ThreadPoolExecutor(max_workers=_DB_POOL_SIZE, thread_name_prefix="db-exec")


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """Module-level Supabase client singleton. Reuses connection pool."""
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def get_user_scoped_supabase(user_access_token: str) -> Client:
    """Build a per-request Supabase client that acts AS the end user.

    SECURITY DEFINER RPCs that enforce ``auth.uid() = p_user_id`` (e.g.
    ``finalize_csv_strategy``, migration 20260501055202) cannot be called with
    the module service-role client: service_role has no ``auth.uid()``, so the
    RPC raises 42501 "called without an auth session". This client carries the
    user's Supabase access token (forwarded by the Next.js route in the
    ``X-User-Access-Token`` header) so the RPC sees the real user.

    Construction mirrors the frontend's user client: the anon key is the
    PostgREST ``apikey`` (the API gateway requires a project key — a raw user
    JWT in that slot is rejected), and the user JWT is set as the
    ``Authorization: Bearer`` token via ``postgrest.auth()`` so PostgREST
    resolves ``role=authenticated`` and ``auth.uid()=sub``.

    NOT cached: the token is per-user and short-lived. Caller must pass a
    non-empty token.
    """
    url = os.getenv("SUPABASE_URL", "")
    anon = os.getenv("SUPABASE_ANON_KEY", "")
    if not url or not anon:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_ANON_KEY required for a user-scoped client"
        )
    if not user_access_token:
        raise ValueError("user_access_token is required for a user-scoped client")
    client = create_client(url, anon)
    # Sets `Authorization: Bearer <user jwt>` on all PostgREST/RPC calls.
    client.postgrest.auth(user_access_token)
    return client


async def db_execute(fn):
    """Run a synchronous Supabase call without blocking the async event loop.

    NEW-C12-08: uses the module-level bounded ThreadPoolExecutor (_DB_EXECUTOR)
    instead of the default thread pool. A fixed-size pool bounds the number of
    zombie threads that accumulate when asyncio.wait_for cancels a handler but
    the underlying synchronous Supabase/ccxt call keeps running in its thread.
    If the pool is fully occupied, the loop raises RuntimeError which
    classify_exception maps to 'transient' — the job retries cleanly rather
    than silently blocking the event loop.
    """
    # Emit a WARNING at 80% pool occupancy so operators can see thread saturation
    # before full blockage. _work_queue is a private attribute of ThreadPoolExecutor;
    # fall back silently if the CPython implementation changes.
    try:
        qsize = _DB_EXECUTOR._work_queue.qsize()  # type: ignore[attr-defined]
        if qsize > _DB_POOL_SIZE * 0.8:
            logger.warning(
                "db_execute: thread pool near saturation "
                "(queued=%d capacity=%d) — possible zombie threads from "
                "timed-out handlers (NEW-C12-08)",
                qsize, _DB_POOL_SIZE,
            )
    except AttributeError:
        pass
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_DB_EXECUTOR, fn)


class PaginatedSelectTruncated(RuntimeError):
    """Raised when ``paginated_select`` exhausts its hard-cap of pages
    without seeing a short page (the natural-stop signal).

    Forces the caller to either raise to the operator or explicitly catch
    and accept a degraded path; pre-fix the helper silently sliced at 1M
    rows and returned what it had, so aggregates computed over a
    partially-loaded window reported stable-looking numbers from corrupt
    data.

    Carries ``page_count``, ``page_size``, and a ``hint`` string for log
    triage. Callers typically pass count-only hints (e.g.
    ``"compute_hit_rate n_allocators=N"``) but may pass single-strategy
    UUIDs (e.g. ``"position_snapshots strategy_id=<uuid>"``) when the
    query is per-strategy and the operator value of having the UUID
    in the error outweighs log cardinality. The hint flows into the
    client-visible 503 detail in `routers/match.py`, so callers must
    not embed multi-tenant or PII payloads.
    """

    def __init__(self, page_count: int, page_size: int, hint: str | None = None) -> None:
        self.page_count = page_count
        self.page_size = page_size
        self.hint = hint
        super().__init__(
            f"paginated_select hit hard cap of {page_count} pages "
            f"× {page_size} rows ({page_count * page_size:,} rows); "
            f"truncation would corrupt downstream aggregates"
            + (f" (hint: {hint})" if hint else "")
        )


def paginated_select(
    builder,
    order_by: tuple[tuple[str, bool], ...],
    page_size: int = 1000,
    hard_cap_pages: int = 1000,
    truncation_hint: str | None = None,
) -> list[dict[str, Any]]:
    """Drain a PostgREST SELECT in fixed-size pages via ``.range(start, end)``.

    Necessary because a single ``.limit(N)`` silently truncates beyond
    PostgREST's per-response ceiling (1000 rows by default on Supabase
    hosted), and at production scale our batched filter-by-id paths
    routinely exceed that.

    ``order_by`` is REQUIRED — Postgres gives no row-order guarantee
    without ORDER BY, so paginating without it can skip or duplicate rows
    across pages. Pass each ``(column, desc)`` in the order they should be
    applied. Composite shape lets callers ride specific indexes (e.g.
    ``(allocator_id, computed_at DESC)`` →
    ``idx_match_batches_allocator_recent``); UUIDv4 primary keys defeat
    such indexes (see audit-2026-05-07 ``#27`` for the motivating
    regression).

    ``hard_cap_pages`` is a sanity belt (1000 × 1000 = 1M rows). Hitting
    it raises ``PaginatedSelectTruncated`` instead of returning partial
    data; pass ``truncation_hint`` to annotate the exception with
    caller-side context.
    """
    if isinstance(order_by, str):
        # Pre-2026-05 the helper accepted a bare ``str`` for single-column
        # ASC. The current contract is composite-only; without this guard
        # a stray str would unpack character-by-character and surface as a
        # cryptic ``ValueError: not enough values to unpack`` from the
        # ``for column, desc`` loop below.
        raise TypeError(
            "paginated_select: order_by must be tuple[tuple[str, bool], ...]; "
            f"pass ((order_by, False),) for single-column ASC instead of {order_by!r}"
        )
    ordered = builder
    for column, desc in order_by:
        ordered = ordered.order(column, desc=desc)
    rows: list[dict[str, Any]] = []
    for page in range(hard_cap_pages):
        start = page * page_size
        end = start + page_size - 1
        result = ordered.range(start, end).execute()
        chunk = result.data or []
        rows.extend(chunk)
        if len(chunk) < page_size:
            return rows
    # Boundary peek: a dataset whose row count is EXACTLY
    # hard_cap_pages × page_size exits the loop on a final full page
    # without ever seeing a short page — yet every row was read. One
    # extra range() distinguishes "exact boundary" (peek empty) from
    # "real overflow" (peek non-empty) so the alarm only fires on the
    # latter.
    boundary_start = hard_cap_pages * page_size
    boundary_end = boundary_start + page_size - 1
    boundary_result = ordered.range(boundary_start, boundary_end).execute()
    boundary_chunk = boundary_result.data or []
    if not boundary_chunk:
        return rows
    logger.error(
        "paginated_select: hit hard cap of %d pages × %d rows — raising "
        "PaginatedSelectTruncated (hint=%s)",
        hard_cap_pages,
        page_size,
        truncation_hint,
    )
    raise PaginatedSelectTruncated(
        page_count=hard_cap_pages,
        page_size=page_size,
        hint=truncation_hint,
    )


@dataclass(frozen=True)
class ChunkedInResult:
    """Outcome of a bounded ``WHERE <id_field> IN (...)`` SELECT — see
    :func:`chunked_in_query`.

    ``truncated`` is a COVERAGE gap (``returned_count < requested_count``: some
    requested ids had no row), NOT the page-cap row overflow that
    :class:`PaginatedSelectTruncated` signals. The two are orthogonal: a chunk
    that itself overflows the 1M-row cap still raises
    ``PaginatedSelectTruncated`` (propagated unchanged), while ``truncated``
    only ever means missing-id coverage.

    The result carries ``gap`` / ``gap_fraction`` so the CALLER can layer its
    own severity policy (e.g. match's ">10%% of the universe → ERROR, else
    WARNING") on uniform counts. This helper never decides severity and never
    raises on a coverage gap — that separation is what lets the three former
    hand-rolled schemes (match's ERROR escalation, the warning-only variant,
    cron's no-signal) be expressed as one detection primitive + per-site policy
    without any of them regressing.
    """

    rows: list[dict[str, Any]]
    requested_count: int
    returned_count: int
    truncated: bool
    gap: int
    gap_fraction: float


def chunked_in_query(
    build_chunk_query: Callable[[list[str]], Any],
    ids: Iterable[str],
    *,
    id_field: str,
    page_size: int = 200,
) -> ChunkedInResult:
    """Run ``SELECT ... WHERE <id_field> IN (:ids)`` over an arbitrarily long
    id list by splitting it into ``<= page_size`` chunks.

    The by-construction guarantee: no caller can pass an id list long enough to
    overflow the PostgREST/nginx URL ceiling (HTTP 414) or be silently
    filter-truncated, because every executed IN-list is at most ``page_size``
    ids. And because the helper always compares requested vs returned ids, a
    coverage gap can never again be silent (the failure mode behind
    NEW-C08-02 / NEW-C08-03 / NEW-C32-01).

    ``build_chunk_query(chunk)`` returns a fresh PostgREST builder for ONE
    chunk — it owns the table, the column projection, ``.in_(id_field, chunk)``,
    and any ``.eq(...)`` / ``.order(...)``. The helper calls ``.execute()`` on
    it, concatenates ``.data`` across chunks (preserving chunk order), and
    counts coverage distinct-by-``id_field`` (matching how the migrated call
    sites dedup today).

    Requested ids are de-duplicated (first-seen order preserved) before
    chunking, so ``requested_count`` is the count of DISTINCT ids asked for and
    an empty input short-circuits to a clean zero result with no query issued.
    Exceptions from any chunk's ``.execute()`` — including
    :class:`PaginatedSelectTruncated` when a closure drains via
    :func:`paginated_select` — propagate unchanged; this helper never swallows
    a chunk failure into a partial result.
    """
    if page_size <= 0:
        raise ValueError(f"chunked_in_query: page_size must be positive, got {page_size}")
    unique_ids = list(dict.fromkeys(ids))
    requested_count = len(unique_ids)
    rows: list[dict[str, Any]] = []
    for _start in range(0, requested_count, page_size):
        _chunk = unique_ids[_start:_start + page_size]
        _page = build_chunk_query(_chunk).execute()
        rows.extend(_page.data or [])
    returned_count = len({row[id_field] for row in rows if id_field in row})
    gap = requested_count - returned_count
    return ChunkedInResult(
        rows=rows,
        requested_count=requested_count,
        returned_count=returned_count,
        truncated=gap > 0,
        gap=gap,
        gap_fraction=(gap / requested_count) if requested_count else 0.0,
    )
