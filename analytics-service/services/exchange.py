import asyncio
import ccxt.async_support as ccxt
import logging
from datetime import datetime, timezone
from typing import Any, Literal, TypedDict

logger = logging.getLogger("quantalyze.analytics")


# Audit-2026-05-07 G12.B.5 — overlap window for late-arriving exchange fills.
# Hardcoded to 1 hour (3_600_000 ms) because:
#   * CCXT timestamps are normalized to UTC, but exchange-side propagation lag
#     for fills (especially Binance futures) is documented up to ~30s; OKX has
#     observed multi-minute lag during high-volume windows.
#   * DST transitions don't affect UTC, but exchange timezone reporting can
#     drift around boundaries — the buffer absorbs that without changing the
#     dedup contract (partial unique index on exchange_fill_id is the source
#     of truth; see migration 039).
# Codified here so future changes are intentional, not buried as a magic
# number. Tests in test_exchange.py pin the contract.
OVERLAP_WINDOW_MS = 3_600_000


class ColdStartSymbolDiscoveryError(Exception):
    """Audit-2026-05-07 G12.B.1 — raised when Binance cold-start symbol
    discovery (fetch_positions fallback) fails or yields no symbols.

    Pre-fix, this branch silently returned an empty fills list and the
    caller treated the sync_trades job as success (allocator's Trade
    Volume tab stayed empty even with 90 days of trades on the account).
    Raising a typed exception lets the caller mark the job for retry
    instead of cementing a false-success state.
    """


class FillRow(TypedDict):
    """Audit-2026-05-07 G12.B.4 — shared shape for a single normalized
    fill row written into the ``trades`` table.

    Three branches build this dict today (OKX direct API, Bybit direct
    API, CCXT ``_normalize_fill``). Without a shared TypedDict, drift is
    inevitable — e.g. only OKX preserves ``posSide`` so only OKX-traded
    shorts are classified correctly downstream. ``_make_fill_dict`` is
    the single factory all three branches go through.

    Note: ``position_direction`` (long/short discriminator) is co-located
    inside ``raw_data['position_direction']`` rather than as a top-level
    column today — the ``trades`` table does not yet have that column,
    so adding it to the persist shape would break the upsert. A future
    migration can promote it.
    """
    exchange: str
    symbol: str
    side: str
    price: float
    quantity: float
    fee: float
    fee_currency: str
    timestamp: str
    order_type: str
    exchange_order_id: str
    exchange_fill_id: str
    is_fill: bool
    is_maker: bool
    cost: float
    raw_data: dict | None


# Audit-2026-05-07 G12.B.4 — whitelist for OKX's posSide field. Anything
# outside this set is logged + coerced to None so a malformed exchange
# response can't smuggle an invalid value into the typed column.
_OKX_VALID_POS_SIDES: frozenset[str] = frozenset({"long", "short", "net"})


def _make_fill_dict(
    *,
    exchange: str,
    symbol: str,
    side: str,
    price: float,
    quantity: float,
    fee: float,
    fee_currency: str,
    timestamp: str,
    exchange_order_id: str,
    exchange_fill_id: str,
    is_maker: bool,
    raw_data: dict | None,
    position_direction: Literal["long", "short"] | None = None,
    order_type: str = "fill",
) -> FillRow:
    """Audit-2026-05-07 G12.B.4 — single factory for the 16-key fill dict
    persisted to ``trades``. OKX/Bybit/CCXT branches all delegate here.

    Keeping construction in one place eliminates the drift risk flagged
    by G12.B.4/G12.B.7 (three near-identical builders). ``cost`` is
    computed from ``price * quantity`` so callers cannot accidentally
    pass an inconsistent value.

    ``position_direction`` is the typed long/short discriminator. The
    ``trades`` table does not yet have a dedicated column for it
    (a separate migration is required, out-of-scope for this audit
    batch); for now we co-locate the validated value into
    ``raw_data['position_direction']`` so downstream consumers
    (position_reconstruction) can read it via raw_data without a
    schema change. This keeps the persist path safe while still
    constraining the value upstream.
    """
    if position_direction is not None:
        raw_data = dict(raw_data) if raw_data is not None else {}
        raw_data["position_direction"] = position_direction
    return {
        "exchange": exchange,
        "symbol": symbol,
        "side": side,
        "price": price,
        "quantity": quantity,
        "fee": fee,
        "fee_currency": fee_currency,
        "timestamp": timestamp,
        "order_type": order_type,
        "exchange_order_id": exchange_order_id,
        "exchange_fill_id": exchange_fill_id,
        "is_fill": True,
        "is_maker": is_maker,
        "cost": price * quantity,
        "raw_data": raw_data,
    }


EXCHANGE_CLASSES: dict[str, type] = {
    "binance": ccxt.binance,
    "okx": ccxt.okx,
    "bybit": ccxt.bybit,
    "deribit": ccxt.deribit,   # Phase 06 — D-17 exchange coverage; derivative-side only per f3 Path B
}


def create_exchange(exchange_name: str, api_key: str, api_secret: str, passphrase: str | None = None) -> ccxt.Exchange:
    """Create a CCXT exchange instance with read-only credentials."""
    cls = EXCHANGE_CLASSES.get(exchange_name)
    if not cls:
        raise ValueError(f"Unsupported exchange: {exchange_name}")

    config: dict[str, Any] = {
        "apiKey": api_key,
        "secret": api_secret,
        "enableRateLimit": True,
    }
    if passphrase:
        config["password"] = passphrase

    exchange = cls(config)

    if exchange_name == "bybit":
        # ccxt's bybit `load_markets()` calls `fetch_currencies()`, which hits
        # `GET /v5/asset/coin/query-info`. That endpoint requires the
        # Wallet > Account Transfer scope; a pure read-only key gets 403,
        # which ccxt re-raises as `RateLimitExceeded`. Currency precision
        # data isn't used for validation OR trade fetching, so we disable
        # the call. Confirmed 2026-05-05 against a live Bybit read-only key
        # via Railway log archaeology (correlation_id
        # 10792caf-1d0b-4ed1-8a30-8ac66e03bbf9).
        exchange.has["fetchCurrencies"] = False

    return exchange


async def validate_key_permissions(exchange: ccxt.Exchange) -> dict[str, Any]:
    """Validate that the API key is functional using safe read-only operations.

    Public shape: ``{valid, read_only, error, error_code, markets_loaded,
    markets_error, probe_error}``. ``error_code`` is a stable discriminator
    (e.g. ``"AUTH_FAILED"``, ``"PERMISSION_DENIED"``, ``"RATE_LIMITED"``,
    ``"NETWORK_UNAVAILABLE"``, ``"VALIDATION_UNEXPECTED"``) so the Next layer
    can route to a precise envelope without parsing the human-readable
    ``error`` string. Sprint 5 Task 5.8 moved the per-exchange permission
    probes into ``services.key_permissions``; ``read_only`` here is derived
    from the triple as ``read and not trade and not withdraw``.
    """
    from services.key_permissions import detect_permissions

    result: dict[str, Any] = {
        "valid": False,
        "read_only": False,
        "error": None,
        "error_code": None,
        # Defense-in-depth markers: callers (e.g. trade fetch) can correlate
        # later failures back to a load_markets that didn't actually load.
        "markets_loaded": False,
        "markets_error": None,
    }

    try:
        try:
            await exchange.load_markets()
            result["markets_loaded"] = True
        except (ccxt.RateLimitExceeded, ccxt.PermissionDenied) as load_exc:
            # Documented swallow-path: Bybit's read-only key triggers
            # /v5/asset/coin/query-info → 403, which ccxt re-raises as
            # RateLimitExceeded. Also covers documented PermissionDenied
            # for keys without scope on the markets-meta endpoint.
            # `fetch_balance()` is the real validation, and per-exchange
            # permission probes don't depend on markets being loaded.
            logger.warning(
                "validate_key_permissions: load_markets failed on %s — %s: %s; "
                "continuing with fetch_balance (markets_loaded=False)",
                exchange.id,
                type(load_exc).__name__,
                load_exc,
            )
            result["markets_error"] = (
                f"{type(load_exc).__name__}: {load_exc}"
            )
        # Note: every other exception class (NetworkError, AuthenticationError,
        # ExchangeNotAvailable, etc.) is intentionally allowed to propagate
        # to the outer handler so it lands in the right error_code branch
        # below — the outer handler is the single classification surface.
        await exchange.fetch_balance()
        result["valid"] = True
    # IMPORTANT: order matters. ccxt's hierarchy is:
    #   PermissionDenied ⊂ AuthenticationError ⊂ ExchangeError
    #   RateLimitExceeded, DDoSProtection, ExchangeNotAvailable ⊂ NetworkError
    # Subclasses MUST be checked before their superclasses or every
    # PermissionDenied/RateLimit/DDoS will land on the wrong branch.
    except ccxt.PermissionDenied as exc:
        # Right credentials, wrong scope (or IP allowlist mismatch on
        # exchanges that map IP-block to PermissionDenied). Must precede
        # AuthenticationError because PermissionDenied subclasses it.
        logger.exception(
            "validate_key_permissions: ccxt.PermissionDenied on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = (
            "Key denied permission. Confirm the key has read-only scope "
            "and that your IP allowlist includes our service."
        )
        result["error_code"] = "PERMISSION_DENIED"
        return result
    except ccxt.AuthenticationError as exc:
        # Genuine bad credentials, signature mismatch, expired key.
        logger.exception(
            "validate_key_permissions: ccxt.AuthenticationError on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = "Authentication failed. Check your API key and secret."
        result["error_code"] = "AUTH_FAILED"
        return result
    except ccxt.DDoSProtection as exc:
        # Cloudflare / WAF block — distinct from a genuine rate-limit
        # because retrying immediately won't help (typically a geo / ASN
        # block on the egress IP). Must precede NetworkError /
        # RateLimitExceeded since DDoSProtection subclasses NetworkError.
        logger.exception(
            "validate_key_permissions: ccxt.DDoSProtection on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = (
            "Exchange blocked the validation request at the edge "
            "(DDoS / WAF protection). Check region / IP allowlist."
        )
        result["error_code"] = "DDOS_PROTECTION"
        return result
    except ccxt.RateLimitExceeded as exc:
        # Real rate-limit OR (per-exchange) the documented Bybit quirk
        # where 403 on a scoped endpoint surfaces as RateLimitExceeded.
        # Must precede NetworkError since RateLimitExceeded subclasses it.
        logger.exception(
            "validate_key_permissions: ccxt.RateLimitExceeded on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = (
            "Exchange rate-limited the validation request. Wait a moment "
            "and try again — repeated failures may indicate a missing "
            "read scope."
        )
        result["error_code"] = "RATE_LIMITED"
        return result
    except ccxt.ExchangeNotAvailable as exc:
        # Exchange is down (5xx, maintenance window, regional outage).
        # Must precede NetworkError since ExchangeNotAvailable subclasses it.
        logger.exception(
            "validate_key_permissions: ccxt.ExchangeNotAvailable on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = (
            "Exchange is currently unavailable. Try again in a few minutes."
        )
        result["error_code"] = "EXCHANGE_UNAVAILABLE"
        return result
    except ccxt.NetworkError as exc:
        # Transport-level (timeout, DNS, TLS, connection reset). Not a
        # credential problem. Backstop for the network family.
        logger.exception(
            "validate_key_permissions: ccxt.NetworkError on %s — %s",
            exchange.id,
            exc,
        )
        result["error"] = (
            "Network error reaching the exchange. Check connectivity "
            "and try again."
        )
        result["error_code"] = "NETWORK_UNAVAILABLE"
        return result
    except Exception as exc:  # noqa: BLE001
        # Phase 18 root-cause for the recurring "code: UNKNOWN, please
        # verify your credentials" wizard fail (found 2026-05-05 via
        # Bybit E2E + Railway log archaeology). Pre-fix the bare `except`
        # lost the ccxt error class + body and misdiagnosed every infra
        # failure as bad credentials. The discriminating ccxt branches
        # above now route specific failures; this catch-all stays as a
        # backstop for unexpected ccxt subclasses or stdlib exceptions
        # (e.g. ValueError from a malformed response). It carries a
        # distinct error_code so the Next layer can render an "unexpected"
        # envelope rather than misleading the user with a "verify
        # credentials" message.
        logger.exception(
            "validate_key_permissions: unexpected error on %s — %s: %s",
            exchange.id,
            type(exc).__name__,
            exc,
        )
        result["error"] = (
            "Key validation failed unexpectedly. Contact support if this "
            "persists."
        )
        result["error_code"] = "VALIDATION_UNEXPECTED"
        return result

    if exchange.id not in EXCHANGE_CLASSES:
        result["error"] = "Unsupported exchange for permission verification."
        result["error_code"] = "UNSUPPORTED_EXCHANGE"
        return result

    # Pre-store path: no api_key_id yet, bypass cache.
    perms = await detect_permissions(exchange, api_key_id=None)
    has_withdraw = perms.get("withdraw", False)
    has_trade = perms.get("trade", False)
    has_read = perms.get("read", False)
    probe_error = perms.get("probe_error", False)

    result["read_only"] = bool(has_read and not has_trade and not has_withdraw)
    # Surface the transient flag so callers can avoid persisting a
    # fail-CLOSED default as if it were a real probe result.
    result["probe_error"] = bool(probe_error)

    if has_withdraw:
        result["error"] = "Key has withdrawal permissions. Please use a read-only key."
        result["error_code"] = "WITHDRAW_SCOPE"
    elif has_trade:
        result["error"] = "Key has trading permissions. Please use a read-only key."
        result["error_code"] = "TRADE_SCOPE"

    return result


async def fetch_daily_pnl(exchange: ccxt.Exchange, since_ms: int | None = None) -> list[dict[str, Any]]:
    """Fetch daily PnL from the exchange account bills/ledger.

    Instead of scanning every trading pair for individual trades (200+ API calls),
    this fetches account-level P&L history directly. Much faster and gives us
    exactly what we need for analytics: daily profit/loss.
    """
    daily_pnl: list[dict[str, Any]] = []

    try:
        if exchange.id == "okx":
            # OKX: fetch account bills (P&L history) with pagination for full history
            from datetime import datetime, timezone, timedelta
            all_bills: list[dict] = []

            # Fetch bills across all instrument types, paginate for full history
            for inst_type in ["SWAP", "FUTURES", "SPOT", "MARGIN"]:
                after_id = ""
                type_count = 0

                for page in range(100):
                    params: dict[str, str] = {"instType": inst_type, "limit": "100"}
                    if since_ms:
                        params["begin"] = str(since_ms)
                    if after_id:
                        params["after"] = after_id

                    try:
                        bills = await exchange.private_get_account_bills(params)
                        data = bills.get("data", [])
                        if not data:
                            break
                        all_bills.extend(data)
                        type_count += len(data)
                        after_id = data[-1].get("billId", "")
                        if len(data) < 100:
                            break
                    except Exception as e:
                        logger.warning("OKX bills fetch failed for %s page %d: %s", inst_type, page, str(e))
                        break

                if type_count > 0:
                    logger.info("OKX %s: fetched %d bills", inst_type, type_count)

            # Fetch bills-archive for older history (>3 months)
            # Only fetch archive if we need data older than 90 days
            archive_bills: list[dict] = []
            three_months_ago_ms = int((datetime.now(timezone.utc) - timedelta(days=90)).timestamp() * 1000)
            should_fetch_archive = since_ms is None or since_ms < three_months_ago_ms
            if not should_fetch_archive:
                logger.info("OKX: skipping archive API (since_ms is within 3 months)")
            else:
                logger.info("OKX: fetching archive API for older history...")
                for inst_type in ["SWAP", "FUTURES", "SPOT", "MARGIN"]:
                    after_id = ""
                    type_count = 0
                    for page in range(100):
                        params: dict[str, str] = {"instType": inst_type, "limit": "100"}
                        if since_ms:
                            params["begin"] = str(since_ms)
                        if after_id:
                            params["after"] = after_id
                        try:
                            bills = await exchange.private_get_account_bills_archive(params)
                            data = bills.get("data", [])
                            if not data:
                                break
                            archive_bills.extend(data)
                            type_count += len(data)
                            after_id = data[-1].get("billId", "")
                            if len(data) < 100:
                                break
                        except Exception as e:
                            logger.warning("OKX archive failed for %s: %s", inst_type, str(e))
                            break
                    if type_count > 0:
                        logger.info("OKX archive %s: fetched %d bills", inst_type, type_count)

            # Merge recent + archive and deduplicate by billId
            merged_bills = all_bills + archive_bills
            seen_ids: set[str] = set()
            unique_bills: list[dict] = []
            for bill in merged_bills:
                bid = bill.get("billId", "")
                if bid and bid not in seen_ids:
                    seen_ids.add(bid)
                    unique_bills.append(bill)
                elif not bid:
                    logger.warning("OKX bill missing billId, cannot deduplicate: %s", bill.get("ts", "unknown"))
                    unique_bills.append(bill)
            all_bills = unique_bills

            logger.info(
                "OKX total: %d bills (%d recent + %d archive, %d after dedup)",
                len(all_bills), len(merged_bills) - len(archive_bills),
                len(archive_bills), len(all_bills)
            )

            # Aggregate bills into daily PnL
            from collections import defaultdict
            daily_totals: dict[str, float] = defaultdict(float)

            for bill in all_bills:
                pnl_val = float(bill.get("pnl", 0)) + float(bill.get("fee", 0))
                ts_raw = bill.get("ts", "")
                if ts_raw and ts_raw.isdigit():
                    dt = datetime.fromtimestamp(int(ts_raw) / 1000, tz=timezone.utc)
                    day_key = dt.strftime("%Y-%m-%d")
                    daily_totals[day_key] += pnl_val

            logger.info(
                "OKX: %d bills aggregated to %d daily PnL entries",
                len(all_bills), len(daily_totals)
            )

            for day, pnl in sorted(daily_totals.items()):
                daily_pnl.append({
                    "exchange": "okx",
                    "symbol": "PORTFOLIO",
                    "side": "buy" if pnl >= 0 else "sell",
                    "price": abs(pnl),
                    "quantity": 1,
                    "fee": 0,
                    "fee_currency": "USDT",
                    "timestamp": f"{day}T00:00:00+00:00",
                    "order_type": "daily_pnl",
                })

        elif exchange.id == "binance":
            # Binance: fetch income history (futures P&L)
            try:
                params = {"limit": 1000}
                if since_ms:
                    params["startTime"] = since_ms
                income = await exchange.fapiPrivate_get_income(params)
                for item in income:
                    # Sprint 5.6 cutover: FUNDING_FEE no longer routes into
                    # daily_pnl. Funding is ingested separately via
                    # services.funding_fetch → funding_fees table.
                    # See migration 044 for the forward-only rationale.
                    if item.get("incomeType") in ("REALIZED_PNL", "COMMISSION"):
                        daily_pnl.append({
                            "exchange": "binance",
                            "symbol": item.get("symbol", "PORTFOLIO"),
                            "side": "buy" if float(item.get("income", 0)) >= 0 else "sell",
                            "price": abs(float(item.get("income", 0))),
                            "quantity": 1,
                            "fee": 0,
                            "fee_currency": "USDT",
                            "timestamp": item.get("time", ""),
                            "order_type": "daily_pnl",
                        })
                for entry in daily_pnl:
                    if entry["timestamp"] and str(entry["timestamp"]).isdigit():
                        from datetime import datetime, timezone
                        ts = int(entry["timestamp"]) / 1000
                        entry["timestamp"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except Exception:
                # Fallback: fetch spot trades for BTC only
                trades = await exchange.fetch_my_trades("BTC/USDT", since=since_ms, limit=1000)
                for t in trades:
                    daily_pnl.append({
                        "exchange": "binance", "symbol": t["symbol"],
                        "side": t["side"], "price": t["price"],
                        "quantity": t["amount"],
                        "fee": t.get("fee", {}).get("cost"),
                        "fee_currency": t.get("fee", {}).get("currency"),
                        "timestamp": t["datetime"], "order_type": t.get("type"),
                    })

        elif exchange.id == "bybit":
            # Bybit: fetch closed PnL
            try:
                params = {"category": "linear", "limit": 200}
                result = await exchange.private_get_v5_position_closed_pnl(params)
                items = result.get("result", {}).get("list", [])
                for item in items:
                    daily_pnl.append({
                        "exchange": "bybit",
                        "symbol": item.get("symbol", "PORTFOLIO"),
                        "side": "buy" if float(item.get("closedPnl", 0)) >= 0 else "sell",
                        "price": abs(float(item.get("closedPnl", 0))),
                        "quantity": 1,
                        "fee": 0,
                        "fee_currency": "USDT",
                        "timestamp": item.get("createdTime", ""),
                        "order_type": "daily_pnl",
                    })
                for entry in daily_pnl:
                    if entry["timestamp"] and str(entry["timestamp"]).isdigit():
                        from datetime import datetime, timezone
                        ts = int(entry["timestamp"]) / 1000
                        entry["timestamp"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except Exception:
                pass

    except Exception as e:
        logger.error("fetch_daily_pnl failed: %s", str(e))

    return daily_pnl


async def fetch_raw_trades(
    exchange: ccxt.Exchange,
    strategy_id: str,
    supabase,
    since_ms: int | None = None,
) -> list[dict[str, Any]]:
    """Fetch raw fill-level trades from the exchange.

    Returns a list of dicts normalized to the trades table schema with
    is_fill=True. Overlap window: subtracts 1 hour from since_ms for
    late-arriving fills; dedup is handled by the DB partial unique index.
    """
    from services.db import db_execute

    fills: list[dict[str, Any]] = []

    # Apply overlap window for late-arriving fills (see OVERLAP_WINDOW_MS).
    effective_since = None
    if since_ms is not None:
        effective_since = since_ms - OVERLAP_WINDOW_MS

    try:
        if exchange.id == "binance":
            fills = await _fetch_raw_trades_binance(
                exchange, strategy_id, supabase, effective_since
            )
        elif exchange.id == "okx":
            fills = await _fetch_raw_trades_okx(exchange, effective_since)
        elif exchange.id == "bybit":
            fills = await _fetch_raw_trades_bybit(exchange, effective_since)
        else:
            logger.warning("fetch_raw_trades: unsupported exchange %s", exchange.id)
    except Exception as e:
        logger.error("fetch_raw_trades failed for %s: %s", exchange.id, str(e))
        raise

    logger.info(
        "fetch_raw_trades: %d fills from %s for strategy %s",
        len(fills), exchange.id, strategy_id,
    )
    return fills


async def _fetch_raw_trades_binance(
    exchange: ccxt.Exchange,
    strategy_id: str,
    supabase,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """Binance: per-symbol iteration using fetch_my_trades."""
    from services.db import db_execute

    # Get symbol list: DISTINCT symbols from trades + position_snapshots
    def _get_symbols():
        trade_syms = (
            supabase.table("trades")
            .select("symbol")
            .eq("strategy_id", strategy_id)
            .eq("is_fill", True)
            .execute()
        )
        pos_syms = (
            supabase.table("position_snapshots")
            .select("symbol")
            .eq("strategy_id", strategy_id)
            .execute()
        )
        symbols = set()
        for row in trade_syms.data or []:
            if row.get("symbol"):
                symbols.add(row["symbol"])
        for row in pos_syms.data or []:
            if row.get("symbol"):
                symbols.add(row["symbol"])
        return list(symbols)

    symbols = await db_execute(_get_symbols)

    # Cold start: fetch current positions to get symbols.
    #
    # Audit-2026-05-07 G12.B.1 — pre-fix this except branch silently
    # logged and continued with symbols=[]. The caller saw an empty fills
    # list and treated the sync as "0 fills, success", so an allocator
    # with 90 days of trades got an empty Trade Volume tab. Now we raise
    # a typed ColdStartSymbolDiscoveryError so the caller can mark the
    # sync_trades job for retry.
    is_cold_start = not symbols
    if is_cold_start:
        try:
            positions = await exchange.fetch_positions()
            for pos in positions:
                sym = pos.get("symbol")
                contracts = pos.get("contracts") or 0
                if sym and float(contracts) > 0:
                    symbols.append(sym)
            # Deduplicate
            symbols = list(set(symbols))
            logger.info(
                "Binance cold start: discovered %d symbols from positions", len(symbols)
            )
        except Exception as e:
            logger.warning("Binance cold start position fetch failed: %s", str(e))
            raise ColdStartSymbolDiscoveryError(str(e)) from e

        # G12.B.1 closed-position edge case: fetch_positions only returns
        # currently-open positions, so a strategy that closed everything
        # yesterday discovers 0 symbols. There's no `update_strategy_analytics`
        # helper available at this layer; raise the typed error so the
        # caller can stamp `cold_start_pending=true` (TODO: G12.B.8 covers
        # the broader closed-position-history backfill via account-history
        # endpoints — out of scope for this batch).
        if not symbols:
            raise ColdStartSymbolDiscoveryError(
                "no symbols discovered on cold start; closed-position history "
                "requires manual seed"
            )

    # Audit-2026-05-07 G12.B.3 — fan-out per-symbol fetch with bounded
    # concurrency (Semaphore=5) instead of a sequential for-loop. CCXT's
    # per-instance rate limiter is shared across coroutines and still
    # throttles correctly; the semaphore caps in-flight requests so we
    # don't trip 429s. ~5x speedup vs. the sequential path that motivated
    # the 5→15 minute TIMEOUT_PER_KIND['sync_trades'] bump.
    sem = asyncio.Semaphore(5)

    async def _fetch_one(symbol: str):
        # Normalize symbol for CCXT: BTCUSDT -> BTC/USDT:USDT
        ccxt_symbol = symbol
        if "/" not in ccxt_symbol:
            if hasattr(exchange, "markets") and exchange.markets:
                for mkt_symbol, _mkt in exchange.markets.items():
                    normalized = (
                        mkt_symbol.replace("/", "")
                        .replace(":USDT", "")
                        .replace(":USD", "")
                    )
                    if normalized == symbol:
                        ccxt_symbol = mkt_symbol
                        break

        async with sem:
            return symbol, await exchange.fetch_my_trades(
                ccxt_symbol, since=since_ms, limit=1000
            )

    tasks = [_fetch_one(s) for s in symbols]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    fills: list[dict[str, Any]] = []
    for idx, item in enumerate(results):
        if isinstance(item, BaseException):
            # Match prior log shape so existing log-archaeology queries
            # (correlation_id grep on "Binance fetch_my_trades failed for")
            # continue to fire.
            symbol = symbols[idx] if idx < len(symbols) else "<unknown>"
            logger.warning(
                "Binance fetch_my_trades failed for %s: %s", symbol, str(item)
            )
            continue
        _symbol, trades = item
        for t in trades:
            fills.append(_normalize_fill(t, exchange.id))

    return fills


async def _fetch_raw_trades_okx(
    exchange: ccxt.Exchange,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """OKX: private_get_trade_fills_history with cursor-based pagination."""
    fills: list[dict[str, Any]] = []
    cursor = ""
    prev_cursor = ""
    natural_break = False

    PAGE_CAP = 100
    for page in range(PAGE_CAP):
        params: dict[str, str] = {"instType": "SWAP", "limit": "100"}
        if cursor:
            params["before"] = cursor
        if since_ms and not cursor:
            params["begin"] = str(since_ms)

        try:
            result = await exchange.private_get_trade_fills_history(params)
            data = result.get("data", [])
            if not data:
                natural_break = True
                break

            for fill in data:
                ts_raw = fill.get("ts", "")
                if ts_raw and ts_raw.isdigit():
                    ts_dt = datetime.fromtimestamp(
                        int(ts_raw) / 1000, tz=timezone.utc
                    )
                else:
                    ts_dt = datetime.now(timezone.utc)

                symbol = fill.get("instId", "").replace("-", "")
                side = fill.get("side", "").lower()
                price = float(fill.get("fillPx", 0))
                amount = float(fill.get("fillSz", 0))
                fee = abs(float(fill.get("fee", 0)))
                fee_currency = fill.get("feeCcy", "USDT")
                is_maker = fill.get("execType", "") == "M"

                raw_data = dict(fill)
                # Audit-2026-05-07 G12.B.4 — populate position_direction
                # via whitelist instead of raw passthrough. OKX's posSide
                # is documented as long/short/net, but anything else
                # would silently land in the typed column. Reject and
                # log so contract violations are visible.
                pos_side_raw = fill.get("posSide")
                position_direction: Literal["long", "short"] | None = None
                if pos_side_raw is None or pos_side_raw == "":
                    position_direction = None
                elif pos_side_raw in _OKX_VALID_POS_SIDES:
                    # Preserve raw_data alignment with prior behavior.
                    raw_data["posSide"] = pos_side_raw
                    if pos_side_raw == "net":
                        # 'net' is one-way mode — direction is implied by
                        # side, not a long/short hedge flag.
                        position_direction = None
                    else:
                        position_direction = pos_side_raw  # "long" | "short"
                else:
                    logger.warning(
                        "invalid posSide value=%s, using None", pos_side_raw
                    )
                    position_direction = None

                fills.append(_make_fill_dict(
                    exchange="okx",
                    symbol=symbol,
                    side=side,
                    price=price,
                    quantity=amount,
                    fee=fee,
                    fee_currency=fee_currency,
                    timestamp=ts_dt.isoformat(),
                    exchange_order_id=fill.get("ordId", ""),
                    exchange_fill_id=fill.get("tradeId", ""),
                    is_maker=is_maker,
                    raw_data=raw_data,
                    position_direction=position_direction,
                ))

            new_cursor = data[-1].get("tradeId", "")

            # Audit-2026-05-07 G12.B.6 — stuck-cursor guard. If the
            # exchange returns the same trailing tradeId twice, we'd
            # otherwise loop until the page cap and yield 100 pages of
            # duplicates. Empty tradeId is also a hard stop (the next
            # request would re-issue with no `before`, restarting from
            # the most recent).
            if not new_cursor:
                logger.warning(
                    "Pagination stuck on cursor=%s for exchange=okx; terminating early",
                    new_cursor,
                )
                natural_break = True
                break
            if prev_cursor and new_cursor == prev_cursor:
                logger.warning(
                    "Pagination stuck on cursor=%s for exchange=okx; terminating early",
                    new_cursor,
                )
                natural_break = True
                break

            prev_cursor = new_cursor
            cursor = new_cursor

            if len(data) < 100:
                natural_break = True
                break
        except Exception as e:
            logger.warning("OKX fills fetch failed page %d: %s", page, str(e))
            break

    if not natural_break:
        # Audit-2026-05-07 G12.B.6 — exhausted the 100-page cap without a
        # natural break. Surface as a warning so possible truncation is
        # visible in operator logs.
        logger.warning(
            "Pagination hit %d-page cap for okx; possible truncation",
            PAGE_CAP,
        )

    return fills


async def _fetch_raw_trades_bybit(
    exchange: ccxt.Exchange,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """Bybit: private_get_v5_execution_list with cursor-based pagination."""
    fills: list[dict[str, Any]] = []
    cursor = ""
    natural_break = False

    PAGE_CAP = 100
    for page in range(PAGE_CAP):
        params: dict[str, str] = {"category": "linear", "limit": "100"}
        if cursor:
            params["cursor"] = cursor
        if since_ms and not cursor:
            params["startTime"] = str(since_ms)

        try:
            result = await exchange.private_get_v5_execution_list(params)
            items = result.get("result", {}).get("list", [])
            if not items:
                natural_break = True
                break

            for fill in items:
                ts_raw = fill.get("execTime", "")
                if ts_raw and ts_raw.isdigit():
                    ts_dt = datetime.fromtimestamp(
                        int(ts_raw) / 1000, tz=timezone.utc
                    )
                else:
                    ts_dt = datetime.now(timezone.utc)

                symbol = fill.get("symbol", "")
                side = fill.get("side", "").lower()
                price = float(fill.get("execPrice", 0))
                amount = float(fill.get("execQty", 0))
                fee = abs(float(fill.get("execFee", 0)))
                fee_currency = fill.get("feeCurrency", "USDT")
                # Audit-2026-05-07 G12.B.9 — Bybit V5 sometimes returns
                # boolean true/false (post JSON decode) and sometimes
                # capital "True"/"TRUE". Strict string equality silently
                # mis-classifies maker fills as taker, distorting the
                # maker_ratio analytic + fee analysis. Accept either
                # boolean True or any case-insensitive "true" string.
                _raw_is_maker = fill.get("isMaker")
                is_maker = _raw_is_maker is True or (
                    isinstance(_raw_is_maker, str)
                    and _raw_is_maker.lower() == "true"
                )

                fills.append(_make_fill_dict(
                    exchange="bybit",
                    symbol=symbol,
                    side=side,
                    price=price,
                    quantity=amount,
                    fee=fee,
                    fee_currency=fee_currency,
                    timestamp=ts_dt.isoformat(),
                    exchange_order_id=fill.get("orderId", ""),
                    exchange_fill_id=fill.get("execId", ""),
                    is_maker=is_maker,
                    raw_data=dict(fill),
                    # Audit-2026-05-07 G12.B.4 — Bybit-side direction
                    # derivation (closeOnTrigger, hedge mode flag) is
                    # not in this batch's scope. Leave None; downstream
                    # consumers fall back to side-based inference.
                    position_direction=None,
                ))

            next_cursor = result.get("result", {}).get("nextPageCursor", "")
            # Audit-2026-05-07 G12.B.6 — stuck-cursor guard. If Bybit
            # returns the SAME nextPageCursor on a subsequent call, we'd
            # otherwise loop until the page cap. Falsy nextPageCursor is
            # the documented natural-stop condition.
            if not next_cursor:
                natural_break = True
                break
            if next_cursor == cursor:
                logger.warning(
                    "Pagination stuck on cursor=%s for exchange=bybit; terminating early",
                    next_cursor,
                )
                natural_break = True
                break
            cursor = next_cursor
        except Exception as e:
            logger.warning("Bybit execution list failed page %d: %s", page, str(e))
            break

    if not natural_break:
        # Audit-2026-05-07 G12.B.6 — exhausted the 100-page cap without a
        # natural break.
        logger.warning(
            "Pagination hit %d-page cap for bybit; possible truncation",
            PAGE_CAP,
        )

    return fills


def _normalize_fill(trade: dict, exchange_id: str) -> FillRow:
    """Normalize a CCXT unified trade to our fill dict shape.

    Audit-2026-05-07 G12.B.4/G12.B.7 — delegates the dict construction
    to ``_make_fill_dict`` so the OKX, Bybit, and CCXT branches all
    share a single 16-key contract.
    """
    fee_info = trade.get("fee") or {}
    fee_cost = abs(float(fee_info.get("cost", 0) or 0))
    fee_currency = fee_info.get("currency", "USDT") or "USDT"
    price = float(trade.get("price", 0))
    amount = float(trade.get("amount", 0))

    return _make_fill_dict(
        exchange=exchange_id,
        symbol=(trade.get("symbol", "")
                .replace("/", "").replace(":USDT", "").replace(":USD", "")),
        side=trade.get("side", ""),
        price=price,
        quantity=amount,
        fee=fee_cost,
        fee_currency=fee_currency,
        timestamp=trade.get("datetime", ""),
        exchange_order_id=trade.get("order", ""),
        exchange_fill_id=trade.get("id", ""),
        is_maker=trade.get("takerOrMaker") == "maker",
        raw_data=trade.get("info"),
        position_direction=None,
    )


async def fetch_all_trades(exchange: ccxt.Exchange, symbol: str | None = None, since_ms: int | None = None) -> list[dict[str, Any]]:
    """Fetch daily PnL from exchange. Uses account-level APIs instead of
    scanning individual trading pairs (which is 200+ API calls on OKX)."""
    return await fetch_daily_pnl(exchange, since_ms)


def parse_since_ms(
    last_sync_at: str | None,
    preferred: str | None = None,
) -> int | None:
    """Parse an ISO timestamp to milliseconds epoch.

    When `preferred` is provided and non-null, it is used in place of
    `last_sync_at`. This is how sync_trades resumes from the
    `last_fetched_trade_timestamp` partial-success checkpoint (migration 045)
    while keeping `last_sync_at` fallback behavior for callers that haven't
    adopted the new cursor.
    """
    value = preferred if preferred is not None else last_sync_at
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception as exc:
        # Audit-2026-05-07 #10: returning None silently means "fetch from
        # the beginning of time" to fetch_all_trades, which burns API
        # quota and can collide with sync_trades' DELETE+INSERT (audit
        # item #2). Log the bad value so an operator can spot a malformed
        # ISO timestamp on api_keys.last_sync_at instead of debugging a
        # quiet full-history refetch.
        logger.warning(
            "parse_since_ms: failed to parse %r — caller will refetch from start: %s",
            value, exc,
        )
        return None


async def fetch_usdt_balance(exchange: ccxt.Exchange) -> float | None:
    """Fetch total USDT balance from exchange. Returns None on failure."""
    try:
        balance = await exchange.fetch_balance()
        usdt_total = balance.get("total", {}).get("USDT", 0)
        if usdt_total and float(usdt_total) > 0:
            return float(usdt_total)
    except Exception as e:
        logger.warning("Could not fetch account balance: %s", str(e))
    return None


# ---------------------------------------------------------------------------
# Phase 19 / BACKBONE-06 — fetch_mark_prices for open-perp valuation.
# ---------------------------------------------------------------------------
# 60s in-process cache prevents fan-out hammering the broker on every
# equity-curve recompute. Mirrors the existing in-process cache pattern
# elsewhere in services/ (e.g. key_permissions._FAIL_CLOSED).
import time

_MARK_PRICE_CACHE: dict[str, tuple[float, float]] = {}
_MARK_PRICE_TTL_S = 60.0


async def fetch_mark_prices(
    exchange: ccxt.Exchange,
    instruments: list[str],
) -> dict[str, float]:
    """Phase 19 / BACKBONE-06. Fetch current mark prices for open perp instruments.

    60s in-process cache prevents fan-out hammering on equity-curve
    recompute. Returns ``{symbol: price}`` for every requested symbol that
    has a mark; symbols missing on the exchange are absent from the dict
    (caller decides what to do — typical CSV path supplies an empty list).

    Per-exchange branches:
      * OKX:     ``public_get_public_mark_price({"instId": sym})`` →
                 ``data[0].markPx``.
      * Binance: ``fapiPublic_get_premiumindex()`` (mark-price endpoint;
                 returns a list keyed by ``symbol`` + ``markPrice``).
      * Bybit:   ``private_get_v5_market_tickers({"category": "linear"})``
                 → ``result.list[*].markPrice``.

    Failures are logged at warning level; the symbol simply does not appear
    in the returned dict. The caller should fall back to the entry price
    or treat the open position as flat.
    """
    now = time.monotonic()
    result: dict[str, float] = {}
    to_fetch: list[str] = []
    for sym in instruments or []:
        cached = _MARK_PRICE_CACHE.get(sym)
        if cached and cached[1] > now:
            result[sym] = cached[0]
        else:
            to_fetch.append(sym)

    if not to_fetch:
        return result

    if exchange.id == "okx":
        # CR-perf-1 — wrap per-symbol calls in asyncio.gather so a portfolio
        # with N open perps takes ~one round-trip instead of N sequential
        # ones. OKX has no instType-wide batch endpoint that returns a
        # single-shot list of mark prices, so we still fan out one request
        # per symbol — but in parallel. return_exceptions=True keeps a
        # single failed symbol from torpedoing the whole batch.
        import asyncio

        async def _fetch_one(sym: str):
            try:
                resp = await exchange.public_get_public_mark_price(
                    {"instId": sym}
                )
                rows = (resp or {}).get("data") or []
                if not rows:
                    return sym, None
                return sym, float(rows[0]["markPx"])
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "fetch_mark_prices OKX failed for %s: %s", sym, exc
                )
                return sym, None

        gathered = await asyncio.gather(
            *(_fetch_one(s) for s in to_fetch), return_exceptions=False
        )
        for sym, price in gathered:
            if price is None:
                continue
            result[sym] = price
            _MARK_PRICE_CACHE[sym] = (price, now + _MARK_PRICE_TTL_S)
    elif exchange.id == "binance":
        try:
            resp = await exchange.fapiPublic_get_premiumindex()
            rows = resp if isinstance(resp, list) else []
            wanted = set(to_fetch)
            for row in rows:
                sym = row.get("symbol")
                if sym in wanted:
                    try:
                        price = float(row["markPrice"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    result[sym] = price
                    _MARK_PRICE_CACHE[sym] = (
                        price,
                        now + _MARK_PRICE_TTL_S,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning("fetch_mark_prices Binance failed: %s", exc)
    elif exchange.id == "bybit":
        try:
            resp = await exchange.private_get_v5_market_tickers(
                {"category": "linear"}
            )
            tickers = (resp or {}).get("result", {}).get("list", []) or []
            wanted = set(to_fetch)
            for row in tickers:
                sym = row.get("symbol")
                if sym in wanted:
                    try:
                        price = float(row["markPrice"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    result[sym] = price
                    _MARK_PRICE_CACHE[sym] = (
                        price,
                        now + _MARK_PRICE_TTL_S,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning("fetch_mark_prices Bybit failed: %s", exc)
    else:
        logger.warning(
            "fetch_mark_prices: unknown exchange.id=%s", exchange.id
        )

    return result


def _reset_mark_price_cache_for_tests() -> None:
    """Test-only helper: clear the in-process mark-price cache."""
    _MARK_PRICE_CACHE.clear()
