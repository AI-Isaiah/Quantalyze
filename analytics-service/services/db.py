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
    """Raised when ``paginated_select`` exhausts its hard-cap of pages
    without seeing a short page (the natural-stop signal).

    Forces the caller to either raise to the operator or explicitly catch
    and accept a degraded path; pre-fix the helper silently sliced at 1M
    rows and returned what it had, so aggregates computed over a
    partially-loaded window reported stable-looking numbers from corrupt
    data.

    ``hint`` is intentionally count-only (e.g. ``"compute_hit_rate
    n_allocators=N"``) — never raw UUIDs — so log volume stays bounded.
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
