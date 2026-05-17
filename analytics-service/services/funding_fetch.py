"""Funding-fee ingestion for perpetual futures.

Three exchange-specific normalizers that fetch signed funding payments
from Binance (fapiPrivate_get_income with incomeType=FUNDING_FEE), OKX
(private_get_account_bills with type=8), and Bybit
(private_get_v5_account_transaction_log with SETTLEMENT type filter).

All three return a uniform list of dicts ready for UPSERT into the
funding_fees table (migration 044). The match_key column is computed
client-side as a deterministic bucket across the 8-hour funding cycle,
so repeated runs are idempotent via ON CONFLICT (match_key) DO NOTHING.

Why client-side match_key (not a DB generated column)?
  - Bybit rotates transaction IDs across responses; primary dedup on
    raw exchange IDs fails.
  - Binance/OKX/Bybit all pay funding on an 8-hour cycle (00:00, 08:00,
    16:00 UTC). Bucketing to that cadence gives one canonical row per
    window.
  - Python-computed key lets the backfill script and the sync_funding
    worker use the identical hashing logic with no DB dependency.

Shared upsert helpers (serialize_funding_row, upsert_funding_rows) live
here so both job_worker.py and scripts/backfill_funding.py use identical
serialization and conflict-resolution logic.

Symbol normalization note (M-0923 / M-0924, audit-2026-05-07): OKX
`instId` like ``BTC-USDT-SWAP`` is normalized to ``BTCUSDTSWAP`` here
and the trades pipeline (analytics-service/services/exchange.py) does
the same. Both producers MUST stay in sync — funding attribution joins
positions and funding rows by exact ``symbol`` string equality. A future
canonical ``normalize_symbol(exchange, raw)`` helper would deduplicate
this contract; tracked as a defense-in-depth backlog item.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, TypedDict

import ccxt.async_support as ccxt

from services.db import db_execute
from services.exchange import EXCHANGE_CLASSES, create_exchange

logger = logging.getLogger("quantalyze.analytics.funding_fetch")


# Binance's /income endpoint caps a single request at 1000 rows.
BINANCE_PAGE_SIZE = 1000
# OKX caps at 100 per page.
OKX_PAGE_SIZE = 100
# Bybit v5 transaction-log caps at 50 per page.
BYBIT_PAGE_SIZE = 50

# Safety cap on exchange pagination.
# Binance 1000/page, OKX 100/page, Bybit 50/page × MAX_PAGES=200 →
# caps at 200k, 20k, 10k rows respectively per fetch run.
MAX_PAGES = 200

# Batch size for UPSERT into funding_fees. Shared with job_worker.py and
# scripts/backfill_funding.py to keep all three callers consistent.
FUNDING_UPSERT_BATCH_SIZE = 100


class FundingFetchCeilingExceeded(RuntimeError):
    """Raised when a paginator exhausts ``MAX_PAGES`` while the exchange
    still indicates more data is available.

    Phase-4 red-team (audit-2026-05-07, finding red-team:289 conf=8): the
    Phase-2 hardening promoted every other partial-completion mode
    (page-N exception, OKX shape mismatch, missing endpoint) from
    silent-warn to re-raise. Hitting ``MAX_PAGES`` while the exchange
    still has more rows (Binance: full final page + advancing
    ``last_seen_ts``; OKX: full final page + non-empty ``after_id``;
    Bybit: non-empty ``nextPageCursor``) was the only remaining silent
    truncation. Bybit is the worst exposure — at limit=50 × 200 pages =
    10k rows per category, a multi-pair whale strategy backfilling
    >3 months easily exceeds it.
    Raising here lets ``run_sync_funding_job`` classify the job as
    transient-failed and Sentry surfaces the trace.
    """


# ---------------------------------------------------------------------------
# Row contract — TypedDict mirrors funding_fees columns (M-0929)
# ---------------------------------------------------------------------------


class FundingFeeRow(TypedDict):
    """Producer-side contract for one funding_fees row.

    Mirrors the table columns from migration 044 minus auto-generated
    ``id``/``created_at``. A producer typo in any key would previously
    silently insert a malformed row that failed downstream parsing — now
    callers using this TypedDict get a type-checker hit.
    """

    strategy_id: str
    exchange: str
    symbol: str
    amount: Decimal
    currency: str
    timestamp: datetime
    match_key: str
    raw_data: dict[str, Any]


# Whitelist of keys preserved from the raw exchange payload into
# funding_fees.raw_data. Defense-in-depth (L-0052 / M-0931): minimize
# accidental PII/secret echo and guarantee JSON-serializability across
# ccxt versions by limiting to known scalars / well-known IDs.
_RAW_DATA_WHITELIST: tuple[str, ...] = (
    # Binance fapiPrivate_get_income
    "tranId", "income", "incomeType", "asset", "time",
    # OKX private_get_account_bills (type=8)
    "billId", "instId", "pnl", "ccy", "ts",
    # Bybit private_get_v5_account_transaction_log
    "id", "funding", "change", "cashFlow", "transactionTime", "created_time",
    "category",
    # Shared across producers
    "symbol", "type", "currency",
)


def _sanitize_raw(value: Any) -> Any:
    """Recursively coerce a value to a JSON-serializable shape.

    Defends against ccxt response payloads carrying non-JSON-native types
    (Decimal, datetime, sets, ccxt internal classes) that would otherwise
    raise ``TypeError`` inside supabase-py's json.dumps and cause the
    enclosing upsert batch to fail (M-0931). The output is safe to feed
    into PostgREST as a JSONB column.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (set, frozenset, tuple, list)):
        return [_sanitize_raw(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _sanitize_raw(v) for k, v in value.items()}
    # Fallback: stringify ccxt internal classes / enums so the row still
    # round-trips. Better than dropping the row to errors[].
    return str(value)


def _extract_raw_data(raw_item: dict) -> dict[str, Any]:
    """Project ``raw_item`` onto the whitelist + sanitize each value.

    Keys not in ``_RAW_DATA_WHITELIST`` are dropped; values are passed
    through :func:`_sanitize_raw` so the result is always JSON-safe.
    """
    return {
        key: _sanitize_raw(raw_item.get(key))
        for key in _RAW_DATA_WHITELIST
        if key in raw_item
    }


# ---------------------------------------------------------------------------
# Match key — deterministic 8-hour bucket dedup
# ---------------------------------------------------------------------------


# H-1099: Per-exchange funding cadence. Binance has been progressively
# moving newer pairs to a 4-hour funding cycle (BTCDOMUSDT etc.), and a
# single pair can switch cadence mid-history. OKX and Bybit retain a
# documented 8-hour cycle for all perps. Bucketing every event to 8h
# silently collapsed half of Binance 4h-cycle events onto the same
# match_key, where ON CONFLICT DO NOTHING dropped the second one. Use a
# tighter bucket for exchanges that can run sub-8h cycles.
_FUNDING_BUCKET_HOURS: dict[str, int] = {
    "binance": 1,  # honour any cadence >= 1h Binance publishes
    "okx": 8,
    "bybit": 8,
}


def _bucket_8h(ts: datetime) -> str:
    """Round a UTC datetime down to its 8-hour funding window start.

    Windows: [00:00, 08:00), [08:00, 16:00), [16:00, 24:00) UTC.
    Returns an ISO-like string suitable for embedding in a match_key.

    Kept for the OKX dedup path (archive + recent endpoints overlap on
    the same event). For match_key construction prefer
    :func:`_bucket_for_exchange`.
    """
    return _bucket_for_exchange(ts, hours=8)


def _bucket_for_exchange(ts: datetime, hours: int) -> str:
    """Round a UTC datetime down to a ``hours``-wide window start.

    ``hours`` must be a divisor of 24 (1, 2, 3, 4, 6, 8, 12, 24); the
    funding cadences in scope (1h/4h/8h) all satisfy this.
    """
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    else:
        ts = ts.astimezone(timezone.utc)
    hour_bucket = (ts.hour // hours) * hours
    bucketed = ts.replace(hour=hour_bucket, minute=0, second=0, microsecond=0)
    return bucketed.strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _build_match_key(
    strategy_id: str, exchange: str, symbol: str, ts: datetime
) -> str:
    # Phase-4 red-team (audit-2026-05-07, finding red-team:194 conf=8):
    # the previous `_FUNDING_BUCKET_HOURS.get(exchange, 8)` silently
    # bucketed an unknown exchange at 8h — exactly the H-1099 latent bug
    # for any future sub-8h cadence (e.g. a 4h 'deribit'). Producers
    # MUST register their funding cadence before being added to
    # ``EXCHANGE_CLASSES``. The dispatcher at :func:`fetch_funding`
    # already raises ``ValueError`` for unsupported exchanges; mirror
    # that fail-loud contract here so a missing dict entry surfaces at
    # the producer rather than as silent 50% data loss months later.
    if exchange not in _FUNDING_BUCKET_HOURS:
        raise KeyError(
            f"Add {exchange!r} to _FUNDING_BUCKET_HOURS before fetching "
            f"its funding (no implicit 8h fallback — see H-1099)"
        )
    hours = _FUNDING_BUCKET_HOURS[exchange]
    return (
        f"{strategy_id}:{exchange}:{symbol}:"
        f"{_bucket_for_exchange(ts, hours=hours)}"
    )


def _normalize_funding_row(
    strategy_id: str,
    exchange: str,
    symbol: str,
    amount_raw: Any,
    ts_raw: Any,
    currency: str,
    raw_item: dict,
) -> "FundingFeeRow | None":
    """Build a uniform funding_fees row from raw exchange fields.

    Computes the match_key and handles Decimal conversion. Returns None on
    parse failure; callers MUST track the skipped row in
    ``dropped_normalize`` so the worker can surface a data-quality flag
    rather than silently UPSERTing partial coverage (M-0930).
    """
    if not symbol:
        return None
    if amount_raw is None:
        return None
    try:
        amount = Decimal(str(amount_raw))
    except Exception:
        return None

    ts = _parse_ts_ms(ts_raw)
    if ts is None:
        return None

    return FundingFeeRow(
        strategy_id=strategy_id,
        exchange=exchange,
        symbol=symbol,
        amount=amount,
        currency=currency or "USDT",
        timestamp=ts,
        match_key=_build_match_key(strategy_id, exchange, symbol, ts),
        raw_data=_extract_raw_data(raw_item),
    )


def _parse_ts_ms(value: Any) -> "datetime | None":
    """Parse an exchange timestamp (string or int millis) into UTC datetime.

    Returns None on parse failure so callers can skip the row.
    """
    if value is None:
        logger.warning("Failed to parse timestamp: %s", value)
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)
    if isinstance(value, str):
        if value.isdigit():
            return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            logger.warning("Failed to parse timestamp: %s", value)
            return None
    logger.warning("Failed to parse timestamp: %s", value)
    return None


# ---------------------------------------------------------------------------
# Binance
# ---------------------------------------------------------------------------

async def fetch_funding_binance(
    exchange: ccxt.Exchange,
    strategy_id: str,
    since_ms: int | None,
) -> list[FundingFeeRow]:
    """Fetch signed funding fees from Binance fapiPrivate_get_income.

    Uses incomeType=FUNDING_FEE filter (Binance enforces a 30-day max
    lookback window per-request — caller is expected to pass an
    appropriate since_ms; the 90-day backfill script paginates by
    rolling the time window forward).

    Signed amount: Binance returns `income` as a signed string — negative
    = paid, positive = received. Preserved verbatim via Decimal to avoid
    float drift.
    """
    rows: list[FundingFeeRow] = []
    current_since = since_ms
    last_seen_ts: int | None = None
    dropped = 0
    last_page_full = False

    for page_idx in range(MAX_PAGES):
        params: dict[str, Any] = {
            "incomeType": "FUNDING_FEE",
            "limit": BINANCE_PAGE_SIZE,
        }
        if current_since is not None:
            params["startTime"] = current_since

        try:
            data = await exchange.fapiPrivate_get_income(params)
        except Exception as exc:
            # C-0322 / H-1103: page-N failure silently truncated results and
            # the worker reported DONE with partial rows. Promote to error
            # log + re-raise so run_sync_funding_job classifies the job as
            # transient-failed and retries (Sentry catches the trace).
            logger.error(
                "Binance funding fetch failed page %d for strategy %s: %s",
                page_idx, strategy_id, exc,
            )
            raise

        if not data:
            last_page_full = False
            break

        last_page_full = len(data) >= BINANCE_PAGE_SIZE
        for item in data:
            # Defense-in-depth: filter by incomeType even though we asked
            # for FUNDING_FEE (some exchange variants return extras).
            if item.get("incomeType") != "FUNDING_FEE":
                continue

            row = _normalize_funding_row(
                strategy_id=strategy_id,
                exchange="binance",
                symbol=item.get("symbol") or "",
                amount_raw=item.get("income"),
                ts_raw=item.get("time"),
                currency=item.get("asset", "USDT") or "USDT",
                raw_item=item,
            )
            if row is None:
                dropped += 1
                continue

            rows.append(row)
            ts_ms = int(row["timestamp"].timestamp() * 1000)
            if last_seen_ts is None or ts_ms > last_seen_ts:
                last_seen_ts = ts_ms

        # Pagination: if we got a full page, advance startTime past the
        # last row's timestamp (+ 1ms to avoid re-reading the boundary).
        if len(data) < BINANCE_PAGE_SIZE:
            break
        if last_seen_ts is None:
            break
        current_since = last_seen_ts + 1
    else:
        # Phase-4 red-team (audit-2026-05-07, red-team:289 conf=8):
        # ``for ... else`` runs only when the loop exhausts the
        # ``range(MAX_PAGES)`` iterator without breaking. If the final
        # page was full (``last_page_full``), Binance still has more
        # rows past ``last_seen_ts`` and silently truncating here would
        # leave partial P&L attribution. Raise so the worker classifies
        # the job as transient-failed and retries with a tighter window.
        if last_page_full:
            logger.error(
                "Binance funding_fetch hit MAX_PAGES=%d ceiling for "
                "strategy %s with full final page (last_seen_ts=%s) — "
                "more rows remain",
                MAX_PAGES, strategy_id, last_seen_ts,
            )
            raise FundingFetchCeilingExceeded(
                f"Binance funding_fetch exhausted MAX_PAGES={MAX_PAGES} "
                f"with full final page; strategy {strategy_id} has "
                f"more funding history past last_seen_ts={last_seen_ts}"
            )

    # M-0930 / specialist:silent-failure-hunter: emit a structured warn
    # when normalize_funding_row dropped rows. Production filters at
    # WARN+; a non-zero count means a Binance field-shape regression.
    if dropped > 0:
        logger.warning(
            "binance funding_fetch: dropped %d malformed rows for "
            "strategy %s (kept %d)",
            dropped, strategy_id, len(rows),
        )
    logger.info(
        "binance funding_fetch: %d rows for strategy %s", len(rows), strategy_id
    )
    return rows


# ---------------------------------------------------------------------------
# OKX
# ---------------------------------------------------------------------------

async def fetch_funding_okx(
    exchange: ccxt.Exchange,
    strategy_id: str,
    since_ms: int | None,
) -> list[FundingFeeRow]:
    """Fetch signed funding fees from OKX private_get_account_bills type=8.

    OKX caps recent bills at 3 months; the archive endpoint
    (account/bills-archive) covers older history. We call the archive
    endpoint when since_ms is older than ~90 days.
    """
    rows: list[FundingFeeRow] = []
    # M-0930 / specialist:silent-failure-hunter: counter for rows that
    # _normalize_funding_row drops. Wrapped in a list so the nested
    # _paginate closure can mutate without a ``nonlocal`` declaration.
    nonlocal_dropped: list[int] = [0]
    three_months_ago_ms = int(
        (datetime.now(timezone.utc).timestamp() - 90 * 86400) * 1000
    )
    need_archive = since_ms is not None and since_ms < three_months_ago_ms

    async def _paginate(endpoint_name: str) -> None:
        endpoint = getattr(exchange, endpoint_name, None)
        if endpoint is None:
            # M-0925 / M-0926 / M-0927: silent return on missing endpoint
            # made ccxt version drift invisible — strategies with >90d
            # history silently lost their archive coverage. Raise so the
            # worker classifies as failed and on-call sees a Sentry trace.
            raise RuntimeError(
                f"OKX endpoint {endpoint_name} missing on ccxt "
                f"{getattr(ccxt, '__version__', 'unknown')} — funding "
                f"ingestion would be incomplete"
            )
        after_id = ""
        for page_idx in range(MAX_PAGES):
            params: dict[str, str] = {
                "type": "8",
                "limit": str(OKX_PAGE_SIZE),
            }
            if since_ms is not None:
                params["begin"] = str(since_ms)
            if after_id:
                params["after"] = after_id

            try:
                result = await endpoint(params)
            except Exception as exc:
                # C-0322 / H-1103: re-raise instead of silently returning
                # so partial pagination becomes a retryable job failure.
                logger.error(
                    "OKX %s funding fetch failed page %d for strategy %s: %s",
                    endpoint_name, page_idx, strategy_id, exc,
                )
                raise

            if not isinstance(result, dict):
                # M-0928: shape mismatch was a silent return; surface it
                # as a searchable error so we know when OKX changes the
                # response envelope (vs. the legit empty-data path below).
                logger.error(
                    "OKX %s returned unexpected shape for strategy %s: "
                    "type=%s",
                    endpoint_name, strategy_id, type(result).__name__,
                )
                raise RuntimeError(
                    f"OKX {endpoint_name} returned non-dict response: "
                    f"{type(result).__name__}"
                )
            data = result.get("data", [])
            if not isinstance(data, list):
                logger.error(
                    "OKX %s 'data' field is non-list for strategy %s: "
                    "type=%s",
                    endpoint_name, strategy_id, type(data).__name__,
                )
                raise RuntimeError(
                    f"OKX {endpoint_name} returned non-list 'data': "
                    f"{type(data).__name__}"
                )
            if not data:
                return

            for item in data:
                inst_id = item.get("instId", "") or ""
                symbol = inst_id.replace("-", "")
                row = _normalize_funding_row(
                    strategy_id=strategy_id,
                    exchange="okx",
                    symbol=symbol,
                    amount_raw=item.get("pnl"),
                    ts_raw=item.get("ts"),
                    currency=item.get("ccy", "USDT") or "USDT",
                    raw_item=item,
                )
                if row is None:
                    nonlocal_dropped[0] += 1
                    continue
                rows.append(row)

            after_id = data[-1].get("billId", "") or ""
            if len(data) < OKX_PAGE_SIZE or not after_id:
                return
        else:
            # Phase-4 red-team (audit-2026-05-07, red-team:289 conf=8):
            # exhausted MAX_PAGES while ``after_id`` still points at a
            # next page AND the final page was full. Promote the silent
            # truncation to a re-raise — symmetric with the post-Phase-2
            # philosophy that every other partial-completion path raises.
            logger.error(
                "OKX %s funding_fetch hit MAX_PAGES=%d ceiling for "
                "strategy %s with after_id=%s (more rows remain)",
                endpoint_name, MAX_PAGES, strategy_id, after_id,
            )
            raise FundingFetchCeilingExceeded(
                f"OKX {endpoint_name} exhausted MAX_PAGES={MAX_PAGES} "
                f"with cursor still active for strategy {strategy_id}"
            )

    await _paginate("private_get_account_bills")
    if need_archive:
        await _paginate("private_get_account_bills_archive")

    # Dedup by match_key (archive + recent may overlap)
    seen: set[str] = set()
    deduped: list[FundingFeeRow] = []
    for row in rows:
        if row["match_key"] in seen:
            continue
        seen.add(row["match_key"])
        deduped.append(row)

    if nonlocal_dropped[0] > 0:
        logger.warning(
            "okx funding_fetch: dropped %d malformed rows for "
            "strategy %s (kept %d, after dedup %d)",
            nonlocal_dropped[0], strategy_id, len(rows), len(deduped),
        )
    logger.info(
        "okx funding_fetch: %d rows (%d after dedup) for strategy %s",
        len(rows), len(deduped), strategy_id,
    )
    return deduped


# ---------------------------------------------------------------------------
# Bybit (new endpoint: v5/account/transaction-log)
# ---------------------------------------------------------------------------

async def fetch_funding_bybit(
    exchange: ccxt.Exchange,
    strategy_id: str,
    since_ms: int | None,
) -> list[FundingFeeRow]:
    """Fetch signed funding fees from Bybit v5/account/transaction-log.

    Filters for type=SETTLEMENT which covers perpetual funding settlements.
    Unlike private_get_v5_position_closed_pnl (which mixes realized trade
    P&L with funding into one number), this endpoint isolates funding only.

    Uses cursor-based pagination.
    """
    rows: list[FundingFeeRow] = []
    dropped = 0

    # M-0921: Bybit perpetuals split into 'linear' (USDT-quoted) and
    # 'inverse' (coin-margined like BTCUSD). The v5 API requires a
    # separate call per category — hard-coding 'linear' silently dropped
    # all funding for inverse-perp strategies. Iterate both.
    for category in ("linear", "inverse"):
        cursor = ""
        # H-S6-1 (specialist:red-team): the inverse-category call can
        # 4xx for accounts whose API key lacks 'inverse' permission. The
        # `linear` call has already succeeded by the time we reach
        # inverse, so killing the whole job would be a regression vs.
        # the pre-M-0921 contract (where inverse was never called).
        # Treat permission/argument errors on the inverse call as
        # category-not-enabled and continue. Anything else (auth on the
        # linear call, network errors, RateLimitExceeded) still raises.
        for page_idx in range(MAX_PAGES):
            params: dict[str, str] = {
                "category": category,
                "type": "SETTLEMENT",
                "limit": str(BYBIT_PAGE_SIZE),
            }
            if since_ms is not None and not cursor:
                params["startTime"] = str(since_ms)
            if cursor:
                params["cursor"] = cursor

            try:
                result = await exchange.private_get_v5_account_transaction_log(
                    params
                )
            except ccxt.BadRequest as exc:
                if category == "inverse" and page_idx == 0:
                    logger.warning(
                        "Bybit inverse category returned BadRequest for "
                        "strategy %s (likely API key lacks inverse "
                        "permission); skipping inverse: %s",
                        strategy_id, exc,
                    )
                    break
                logger.error(
                    "Bybit funding fetch BadRequest page %d category=%s "
                    "for strategy %s: %s",
                    page_idx, category, strategy_id, exc,
                )
                raise
            except ccxt.PermissionDenied as exc:
                if category == "inverse" and page_idx == 0:
                    logger.warning(
                        "Bybit inverse category PermissionDenied for "
                        "strategy %s; skipping inverse: %s",
                        strategy_id, exc,
                    )
                    break
                logger.error(
                    "Bybit funding fetch PermissionDenied page %d "
                    "category=%s for strategy %s: %s",
                    page_idx, category, strategy_id, exc,
                )
                raise
            except Exception as exc:
                # C-0322 / H-1103: was warn+break (partial truncation).
                # Re-raise so the worker classifies as transient-failed.
                logger.error(
                    "Bybit funding fetch failed page %d category=%s "
                    "for strategy %s: %s",
                    page_idx, category, strategy_id, exc,
                )
                raise

            # Phase-4 red-team (audit-2026-05-07, red-team:581 conf=8):
            # the previous duck-typed chain silently treated any non-dict
            # response, a non-dict ``result`` field, or a missing/None
            # ``list`` as "no items, break" — the exact silent-truncation
            # pattern that Phase-2 explicitly fixed for OKX (M-0928).
            # Bybit v5 returns ``{retCode: <non-zero>, retMsg: '...',
            # result: null}`` on auth/scope errors that ccxt does not
            # translate to a typed exception. Mirror the OKX hardening so
            # the worker fails loudly instead of reporting SUCCESS on
            # zero rows.
            if not isinstance(result, dict):
                logger.error(
                    "Bybit transaction-log returned unexpected shape "
                    "for strategy %s category=%s: type=%s",
                    strategy_id, category, type(result).__name__,
                )
                raise RuntimeError(
                    f"Bybit transaction-log returned non-dict response: "
                    f"{type(result).__name__}"
                )
            inner = result.get("result")
            if not isinstance(inner, dict):
                logger.error(
                    "Bybit transaction-log 'result' field is non-dict "
                    "for strategy %s category=%s: type=%s retCode=%s",
                    strategy_id, category, type(inner).__name__,
                    result.get("retCode"),
                )
                raise RuntimeError(
                    f"Bybit transaction-log returned non-dict 'result': "
                    f"{type(inner).__name__}"
                )
            items = inner.get("list", [])
            if not isinstance(items, list):
                logger.error(
                    "Bybit transaction-log 'result.list' is non-list for "
                    "strategy %s category=%s: type=%s",
                    strategy_id, category, type(items).__name__,
                )
                raise RuntimeError(
                    f"Bybit transaction-log returned non-list "
                    f"'result.list': {type(items).__name__}"
                )
            if not items:
                break

            for item in items:
                # H-1098 / M-0922: previous chain was
                # ``item.get('funding') or item.get('change') or item.get(
                # 'cashFlow') or '0'`` which (1) silently inserted a zero
                # placeholder when ALL three fields were missing
                # (poison-pill vs. the ON CONFLICT match_key dedup) and
                # (2) treated a legitimate numeric 0 as "missing" and
                # fell through to the next field. Use an explicit None
                # check so we distinguish "field missing entirely" from
                # "field present but zero".
                funding_raw: Any = None
                for key in ("funding", "change", "cashFlow"):
                    val = item.get(key)
                    if val is not None:
                        funding_raw = val
                        break
                if funding_raw is None:
                    # All three amount fields absent → skip rather than
                    # emit a zero placeholder that would block a future
                    # corrected row.
                    logger.warning(
                        "Bybit transaction-log row has no funding/change/"
                        "cashFlow field for strategy %s; skipping. "
                        "symbol=%s id=%s",
                        strategy_id,
                        item.get("symbol"),
                        item.get("id"),
                    )
                    continue
                row = _normalize_funding_row(
                    strategy_id=strategy_id,
                    exchange="bybit",
                    symbol=item.get("symbol", "") or "",
                    amount_raw=funding_raw,
                    ts_raw=(
                        item.get("transactionTime") or item.get("created_time")
                    ),
                    currency=item.get("currency", "USDT") or "USDT",
                    raw_item=item,
                )
                if row is None:
                    dropped += 1
                    continue
                rows.append(row)

            next_cursor = inner.get("nextPageCursor", "") or ""
            if not next_cursor:
                break
            cursor = next_cursor
        else:
            # Phase-4 red-team (audit-2026-05-07, red-team:289 conf=8):
            # exhausted MAX_PAGES while ``nextPageCursor`` still points
            # at more data. Bybit is the worst-case exposure (limit=50 ×
            # 200 pages = 10k rows per category) — multi-pair whale
            # strategies with >3 months of history hit this first.
            # Re-raise instead of silently moving on to the next
            # category and returning DONE with partial coverage.
            logger.error(
                "Bybit funding_fetch hit MAX_PAGES=%d ceiling for "
                "strategy %s category=%s with active cursor (more "
                "rows remain)",
                MAX_PAGES, strategy_id, category,
            )
            raise FundingFetchCeilingExceeded(
                f"Bybit funding_fetch exhausted MAX_PAGES={MAX_PAGES} "
                f"with cursor still active for strategy {strategy_id} "
                f"category={category}"
            )

    if dropped > 0:
        logger.warning(
            "bybit funding_fetch: dropped %d malformed rows for "
            "strategy %s (kept %d)",
            dropped, strategy_id, len(rows),
        )
    logger.info(
        "bybit funding_fetch: %d rows for strategy %s", len(rows), strategy_id
    )
    return rows


# ---------------------------------------------------------------------------
# Top-level dispatcher
# ---------------------------------------------------------------------------

async def fetch_funding(
    exchange_name: str,
    api_key: str,
    api_secret: str,
    strategy_id: str,
    since_ms: int | None,
    passphrase: str | None = None,
) -> list[FundingFeeRow]:
    """Convenience dispatcher that constructs the exchange, routes to the
    right normalizer, and closes the connection in a finally block.

    Raises ValueError for unsupported exchanges.
    """
    if exchange_name not in EXCHANGE_CLASSES:
        raise ValueError(f"Unsupported exchange for funding: {exchange_name}")

    exchange = create_exchange(exchange_name, api_key, api_secret, passphrase)
    try:
        if exchange_name == "binance":
            return await fetch_funding_binance(exchange, strategy_id, since_ms)
        if exchange_name == "okx":
            return await fetch_funding_okx(exchange, strategy_id, since_ms)
        if exchange_name == "bybit":
            return await fetch_funding_bybit(exchange, strategy_id, since_ms)
        raise ValueError(f"Unsupported exchange for funding: {exchange_name}")
    finally:
        try:
            await exchange.close()
        except Exception:  # pragma: no cover
            pass


# ---------------------------------------------------------------------------
# Shared upsert helpers — used by job_worker.py and scripts/backfill_funding.py
# ---------------------------------------------------------------------------


def serialize_funding_row(row: "FundingFeeRow | dict[str, Any]") -> dict[str, Any]:
    """Serialize a funding_fees row for JSON-safe UPSERT.

    Converts Decimal amounts to strings and datetime timestamps to ISO
    strings. Returns a new dict; does not mutate the input.

    Accepts either :class:`FundingFeeRow` (the new producer contract) or
    a plain dict for backward compatibility with backfill scripts that
    pre-date the TypedDict.
    """
    ts = row["timestamp"]
    if hasattr(ts, "isoformat"):
        ts = ts.isoformat()
    return {
        "strategy_id": row["strategy_id"],
        "exchange": row["exchange"],
        "symbol": row["symbol"],
        "amount": str(row["amount"]),
        "currency": row["currency"],
        "timestamp": ts,
        "match_key": row["match_key"],
        "raw_data": row.get("raw_data"),
    }


async def upsert_funding_rows(
    supabase,
    rows: list[dict],
    batch_size: int = FUNDING_UPSERT_BATCH_SIZE,
) -> dict:
    """Upsert funding rows into funding_fees in batches.

    Uses on_conflict='match_key' + ignore_duplicates=True so repeated
    runs over the same time window are no-ops at the DB layer (idempotent
    by design — Bybit fill_id rotation makes dedup on raw IDs unsafe).

    Returns {'inserted': N, 'skipped': 0, 'errors': []}.
    The 'skipped' count is not observable at the Python layer (PostgreSQL
    DO NOTHING is silent); callers should treat inserted as rows_attempted.
    """
    if not rows:
        return {"inserted": 0, "skipped": 0, "errors": []}

    errors: list[str] = []
    total = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        payload = [serialize_funding_row(r) for r in batch]

        def _upsert(rows_to_insert=payload):
            supabase.table("funding_fees").upsert(
                rows_to_insert,
                on_conflict="match_key",
                ignore_duplicates=True,
            ).execute()

        try:
            await db_execute(_upsert)
            total += len(batch)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc)[:200])
            logger.warning(
                "upsert_funding_rows batch %d failed: %s", i // batch_size, exc
            )

    return {"inserted": total, "skipped": 0, "errors": errors}
