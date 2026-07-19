"""SFOX-02 read pull: a thin worker-side orchestration that reads an sFOX
account's balances + trades + transactions through the Phase-118 read-only
`SfoxClient`.

Read-only is STRUCTURAL, not probed (CONTEXT A1 / SFOX-02): `SfoxClient` is a
GET-only adapter with no order/withdraw/transfer surface (118 WR-03), and this
module composes ONLY its three GET read methods. The isinstance guard below
asserts read-only AT THE INGESTION BOUNDARY — a future caller cannot smuggle a
write-capable object (e.g. a ccxt exchange with create_order) through here. This
is NOT a claim that the key's scope was probed read-only (sFOX exposes no
per-key scope endpoint); it is the honest structural guarantee that this code
path can only read.

Scope (Q3 / phase split): this is the READ PULL ONLY. Single-page reads — the
cursors are surfaced by SfoxClient but NOT crawled here; crawl orchestration
with asyncio.wait_for bounds is PHASE 120 (FLIPRETRY-01). No daily-return
reconstruction, no normalization, no DB writes, no ingestion _FACTORIES /
SUPPORTED_SOURCES registration — all phase 120.

Fail-loud (T-119-13 / no invented data): any leg raising SfoxApiError propagates
UNTOUCHED; there is no retry, no backoff, no silent catch, and no partial dict.
An empty account (all legs empty) returns honest empties, never a fabricated
row. The caller owns the client lifecycle (this module never calls aclose) —
mirroring how 119-02's validate branch owns its client.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd

from services.external_flows import USD_FAMILY, ExternalFlow
from services.sfox_client import _TRANSACTIONS_MAX_LIMIT, SfoxClient

# --- Phase-120 bounded crawl + typed-flow extraction (SFOX-05) -------------
#
# 119 reads a single page; 120 owns the crawl orchestration. Every crawl here
# is a GET-only composition of the client's read surface, bounded by a HARD
# request budget so a slow/looping venue can never spin forever. The additional
# asyncio.wait_for wall-clock bound wraps at the derive_broker_dailies worker
# seam (plan 120-03), where deribit's per-crawl budget also lives — a hang there
# becomes a classified transient failure, never a wedge of the sequential worker
# loop (FLIPRETRY-01 / the v1.11 rollback root cause). It deliberately does NOT
# wrap INSIDE these functions (the seam owns the wall clock).

# Hard page/request ceiling shared by both crawls. ~50 balance-history windows
# (daily granularity) or 50 transaction pages (up to 1000 rows each ≈ 50k rows)
# comfortably covers any real account back to inception while converting a
# runaway/looping crawl into a typed truncation instead of an unbounded spin.
_SFOX_CRAWL_MAX_REQUESTS = 50

# Balance-history granularity: daily buckets. The seconds value is the client
# `interval` wire param; the milliseconds value advances the crawl cursor.
_SFOX_BALANCE_HISTORY_INTERVAL_S = 86_400
_SFOX_BALANCE_HISTORY_INTERVAL_MS = 86_400_000

# A daily series should reach within ~2 days of the requested recent edge. A
# larger shortfall means the crawl stopped short (rate-limit / short page) and
# must fail loud rather than render as a complete-but-short series (Pitfall 4).
_SFOX_RECENT_EDGE_TOLERANCE_MS = 2 * _SFOX_BALANCE_HISTORY_INTERVAL_MS

# action -> external-flow sign. Deposit / credit are cash IN (+); withdraw /
# charge are cash OUT (-). buy/sell are INTERNAL rotations, never external flows.
_FLOW_SIGN: dict[str, float] = {
    "deposit": 1.0,
    "credit": 1.0,
    "withdraw": -1.0,
    "charge": -1.0,
}
_ROTATION_ACTIONS: frozenset[str] = frozenset({"buy", "sell"})


class SfoxCrawlTruncatedError(Exception):
    """A bounded crawl could not be proven complete: the hard request budget was
    exhausted before exhaustion, or the balance-history latest point stopped
    materially short of the requested recent edge. The sFOX analog of deribit's
    ``LedgerTruncatedError`` / ``assert_ledger_complete`` honesty gate — a
    silently-partial read must NEVER become a complete track record. Carries
    counts/timestamps only, never a credential (T-120-09)."""


class SfoxFlowValuationError(Exception):
    """A typed deposit/withdraw-class row could not be valued in USD from its OWN
    fields (a non-USD-family currency with no usable USD field, a malformed
    amount, or an unrecognized action). Fail loud, never guess a rate and never
    drop the row — a mis-valued or dropped flow silently corrupts the TWR (the
    ``LedgerValuationError`` fail-loud discipline). The non-USD-flow convention
    resolves empirically in the SFOX-06 founder ground-truth run."""


def _require_sfox_client(client: Any) -> None:
    """Assert the read-only ingestion boundary BEFORE any read: a non-SfoxClient
    object (e.g. a future ccxt exchange carrying write methods) is refused so a
    write-capable object can never be smuggled through a crawl."""
    if not isinstance(client, SfoxClient):
        raise TypeError(
            "sFOX crawls require a read-only SfoxClient at the ingestion boundary "
            f"(got {type(client).__name__}); a write-capable object must never be "
            "smuggled through this read pull."
        )


def _row_timestamp_ms(row: Any) -> int:
    """Epoch-ms timestamp of a balance-history row, fail-loud on a missing/bad
    field (a row we cannot date is unusable — never silently coerced to 0)."""
    try:
        return int(row["timestamp"])
    except (TypeError, ValueError, KeyError) as exc:
        raise SfoxCrawlTruncatedError(
            "sFOX balance-history row missing a usable integer timestamp"
        ) from exc


async def crawl_sfox_balance_history(
    client: SfoxClient,
    start_date_ms: int,
    end_date_ms: int | None = None,
) -> tuple[list[dict], int | None]:
    """Bounded GET crawl of the daily ``usd_value`` equity series.

    Pulls ``client.get_balance_history(interval=86400)`` windows, advancing the
    start cursor past the latest returned point, until the requested recent edge
    is reached or a window comes back empty. SERIAL awaits only (the client's
    per-endpoint rate gate makes parallel fanning a 429 trap). Bounded by the
    hard request budget; the wall-clock bound is added at the worker seam.

    Returns ``(rows, earliest_ms)``. ``earliest_ms`` is the observed earliest
    timestamp — the EMPIRICAL inception; an earliest point AFTER the requested
    ``start_date_ms`` is NOT an error (A1: docs-silent depth), it is surfaced to
    the caller. A latest point that stops MATERIALLY short of ``end_date_ms``
    RAISES ``SfoxCrawlTruncatedError`` (Pitfall 4). An empty account returns an
    honest ``([], None)`` — an empty read is not a truncation.
    """
    _require_sfox_client(client)

    rows: list[dict] = []
    cursor = int(start_date_ms)
    reached_edge = False
    for _ in range(_SFOX_CRAWL_MAX_REQUESTS):
        page = await client.get_balance_history(
            start_date_ms=cursor,
            end_date_ms=end_date_ms,
            interval=_SFOX_BALANCE_HISTORY_INTERVAL_S,
        )
        if not page:
            reached_edge = True
            break
        rows.extend(page)
        latest = max(_row_timestamp_ms(r) for r in page)
        if end_date_ms is not None and latest >= end_date_ms:
            reached_edge = True
            break
        next_cursor = latest + _SFOX_BALANCE_HISTORY_INTERVAL_MS
        if next_cursor <= cursor:
            # No forward progress (repeated boundary point) — stop rather than
            # burn the budget re-reading the same window.
            reached_edge = True
            break
        cursor = next_cursor

    if not reached_edge:
        raise SfoxCrawlTruncatedError(
            "sFOX balance-history crawl exhausted the request budget "
            f"({_SFOX_CRAWL_MAX_REQUESTS}) before reaching the requested edge"
        )

    if not rows:
        return [], None

    earliest = min(_row_timestamp_ms(r) for r in rows)
    latest = max(_row_timestamp_ms(r) for r in rows)
    if (
        end_date_ms is not None
        and (int(end_date_ms) - latest) > _SFOX_RECENT_EDGE_TOLERANCE_MS
    ):
        raise SfoxCrawlTruncatedError(
            "sFOX balance-history crawl stopped materially short of the requested "
            f"recent edge (latest={latest}, requested_end={int(end_date_ms)}) — "
            "refusing to render a truncated read as a complete-but-short series"
        )

    return rows, earliest


async def crawl_sfox_transactions(
    client: SfoxClient,
    from_ms: int,
    to_ms: int | None = None,
) -> list[dict]:
    """Bounded GET cursor crawl of the typed transaction ledger.

    Follows the ``after`` id cursor page-by-page to exhaustion via
    ``client.get_transactions`` at the client's ``_TRANSACTIONS_MAX_LIMIT`` page
    size (read, never hardcoded). SERIAL awaits only — the client enforces a
    strict 1 req / 10 s gate on this endpoint, so parallel fanning is a 429 trap
    (the 118 pitfall). Bounded by the hard request budget: a crawl that never
    exhausts RAISES ``SfoxCrawlTruncatedError`` rather than returning a silent
    partial. The wall-clock bound wraps at the worker seam.
    """
    _require_sfox_client(client)

    rows: list[dict] = []
    after: str | None = None
    for _ in range(_SFOX_CRAWL_MAX_REQUESTS):
        page = await client.get_transactions(
            from_ms=from_ms,
            to_ms=to_ms,
            limit=_TRANSACTIONS_MAX_LIMIT,
            after=after,
        )
        if not page:
            return rows
        rows.extend(page)
        after = str(page[-1]["id"])

    raise SfoxCrawlTruncatedError(
        "sFOX transactions crawl exhausted the request budget "
        f"({_SFOX_CRAWL_MAX_REQUESTS}) before the cursor reached exhaustion"
    )


def _utc_day_iso(ts_ms: Any) -> str:
    """UTC calendar day ('YYYY-MM-DD') of an epoch-ms timestamp — the shared
    ExternalFlow day-key. Fail loud on an undateable value."""
    try:
        return (
            datetime.fromtimestamp(int(ts_ms) / 1000, tz=timezone.utc)
            .date()
            .isoformat()
        )
    except (TypeError, ValueError, OverflowError, OSError) as exc:
        raise SfoxFlowValuationError(
            "sFOX flow row carries no usable UTC-day timestamp"
        ) from exc


def sfox_flows_by_day(
    transactions: list[dict],
) -> tuple[pd.Series, list[ExternalFlow]]:
    """Extract the signed daily USD external-flow series + ExternalFlow evidence
    from typed transaction rows.

    action -> sign: deposit +, credit +, withdraw -, charge -. buy/sell rows are
    INTERNAL rotations and are EXCLUDED (they move value between assets, they are
    not external cash). Same-UTC-day flows aggregate. A deposit/withdraw-class
    row whose USD value is not derivable from its OWN fields (a non-USD-family
    currency, a malformed amount, or an unrecognized action) RAISES
    ``SfoxFlowValuationError`` — never guessed, never dropped. An empty ledger
    yields honest empties.

    Returns ``(series, evidence)`` where ``series`` is a signed-USD Series on an
    ascending daily [us] DatetimeIndex (the shape ``chain_linked_twr`` aligns as
    the numerator flow F) and ``evidence`` is the ``list[ExternalFlow]`` the
    DQ-02 evidence shape (plan 120-03) threads downstream.
    """
    by_day: dict[str, float] = {}
    evidence: list[ExternalFlow] = []

    for row in transactions:
        action = str(row.get("action", "")).strip().lower()
        if action in _ROTATION_ACTIONS:
            continue
        sign = _FLOW_SIGN.get(action)
        if sign is None:
            raise SfoxFlowValuationError(
                f"unrecognized sFOX transaction action {action!r}; refusing to "
                "guess whether it is an external flow (evidence-first)"
            )

        currency = str(row.get("currency", "")).strip().upper()
        if currency not in USD_FAMILY:
            raise SfoxFlowValuationError(
                f"sFOX {action} flow in {currency!r} is not USD-family and carries "
                "no usable USD field; refusing to guess a conversion rate"
            )
        try:
            magnitude = abs(float(row["amount"]))
        except (TypeError, ValueError, KeyError) as exc:
            raise SfoxFlowValuationError(
                f"sFOX {action} flow carries no usable numeric amount"
            ) from exc

        iso = _utc_day_iso(row.get("timestamp"))
        usd_signed = sign * magnitude
        by_day[iso] = by_day.get(iso, 0.0) + usd_signed
        evidence.append(ExternalFlow(utc_day_iso=iso, usd_signed=usd_signed))

    if not by_day:
        return pd.Series(dtype="float64", name="flows"), evidence

    days = sorted(by_day)
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in days]).as_unit("us")
    series = pd.Series([by_day[d] for d in days], index=index, name="flows")
    return series, evidence


async def read_sfox_account(client: SfoxClient) -> dict:
    """Read an sFOX account's balances + trades + transactions in one pull.

    Composes exactly SfoxClient's three GET read methods (single-page; no cursor
    passed — phase 120 owns crawl orchestration) and returns
    ``{"balances": [...], "trades": [...], "transactions": [...]}``.

    Read-only is asserted at the ingestion boundary: a non-SfoxClient object is
    refused with TypeError before any read, so no write-capable object can be
    smuggled through this boundary. Any leg's SfoxApiError propagates (fail loud;
    the caller decides) — never a partial or fabricated result. The caller owns
    the client's session lifecycle; this function does not close it.
    """
    if not isinstance(client, SfoxClient):
        raise TypeError(
            "read_sfox_account requires a read-only SfoxClient at the ingestion "
            f"boundary (got {type(client).__name__}); a write-capable object "
            "must never be smuggled through this read pull."
        )

    balances = await client.get_balances()
    trades = await client.get_trades()
    transactions = await client.get_transactions()

    return {
        "balances": balances,
        "trades": trades,
        "transactions": transactions,
    }
