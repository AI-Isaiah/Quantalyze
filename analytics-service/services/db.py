import asyncio
import logging
import os
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """Module-level Supabase client singleton. Reuses connection pool."""
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


async def db_execute(fn):
    """Run a synchronous Supabase call without blocking the async event loop."""
    return await asyncio.to_thread(fn)


class PaginatedSelectTruncated(RuntimeError):
    """Audit-2026-05-07 #52 — raised when ``_paginated_select`` exhausts its
    hard-cap of pages without seeing a short page (the natural-stop signal).

    Pre-fix the helper silently sliced at 1M rows and returned what it had,
    so hit-rate metrics computed over a partially-loaded window reported
    stable-looking numbers from corrupt data. Surfacing as a typed exception
    forces the caller to either (a) raise to the operator (default), or
    (b) explicitly catch and decide a degraded path is acceptable.

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
            f"_paginated_select hit hard cap of {page_count} pages "
            f"× {page_size} rows ({page_count * page_size:,} rows); "
            f"truncation would corrupt downstream aggregates"
            + (f" (hint: {hint})" if hint else "")
        )


def _paginated_select(
    builder,
    order_by: str | tuple[tuple[str, bool], ...],
    page_size: int = 1000,
    hard_cap_pages: int = 1000,
    truncation_hint: str | None = None,
) -> list[dict[str, Any]]:
    """Drain a PostgREST SELECT in fixed-size pages via `.range(start, end)`.

    The batched hit-rate path filters `match_batches` / `match_candidates`
    by lists of ids, and at real production scale either result set can
    exceed PostgREST's per-response limit (1000 rows by default on
    Supabase hosted, sometimes lower). A single `.limit(N)` would silently
    truncate beyond that ceiling — pagination keeps us correct at every
    scale.

    ``order_by`` is REQUIRED: Postgres makes no guarantee about row order
    without an explicit ORDER BY, so paginating without it can skip or
    duplicate rows across pages. Callers must pass a stable sort key.
    Two shapes are accepted:

      * ``str`` — single-column ascending sort (legacy shape).
      * ``tuple[tuple[str, bool], ...]`` — composite sort, where each
        ``(column, desc)`` tuple is applied in order. Use the composite
        shape when the caller wants the helper's pagination to ride a
        specific composite Postgres index (e.g. ``match_batches`` ->
        ``idx_match_batches_allocator_recent`` is keyed
        ``(allocator_id, computed_at DESC)``). UUIDv4 primary keys defeat
        such indexes — see audit-2026-05-07 ``#27`` for the regression
        that motivated this signature.

    ``hard_cap_pages`` is a sanity belt: 1000 pages × 1000 rows = 1M rows
    per query. Pre-fix (audit-2026-05-07 ``#52``) hitting this limit
    logged a warning and silently returned partial data. We now raise
    ``PaginatedSelectTruncated`` so the caller cannot accidentally
    aggregate over a truncated window. Pass ``truncation_hint`` to
    annotate the exception with caller-side context (e.g. the table
    name + filter values).
    """
    rows: list[dict[str, Any]] = []
    if isinstance(order_by, str):
        ordered = builder.order(order_by)
    else:
        ordered = builder
        for column, desc in order_by:
            ordered = ordered.order(column, desc=desc)
    for page in range(hard_cap_pages):
        start = page * page_size
        end = start + page_size - 1
        result = ordered.range(start, end).execute()
        chunk = result.data or []
        rows.extend(chunk)
        if len(chunk) < page_size:
            return rows
    # Audit-2026-05-07 red-team follow-up: a dataset whose row count is
    # EXACTLY hard_cap_pages × page_size has the loop exhausting on a
    # final full page without ever seeing a short page — yet every row
    # was read. Peek one more page before raising so the truncation
    # alarm only fires on actual truncation. Reading 1 extra page on
    # the rare boundary case is cheap; falsely failing a 1M-row strategy
    # is not.
    boundary_start = hard_cap_pages * page_size
    boundary_end = boundary_start + page_size - 1
    boundary_result = ordered.range(boundary_start, boundary_end).execute()
    boundary_chunk = boundary_result.data or []
    if not boundary_chunk:
        return rows
    logger.error(
        "_paginated_select: hit hard cap of %d pages × %d rows — raising "
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
