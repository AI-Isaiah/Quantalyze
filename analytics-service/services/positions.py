"""Position polling per exchange via CCXT async.

Two public functions:
  fetch_positions(exchange_name, exchange) -> list[dict]
    Fetches current positions from a pre-constructed async CCXT exchange.
    Per-exchange implementations handle schema differences:
    - Binance futures: CCXT unified fetch_positions()
    - OKX hedge mode: dual-side (long + short per symbol) via unified API
    - Bybit: three reads (linear USDT, linear USDC, inverse), each CCXT first,
      fallback to raw V5 if critical fields are missing

  persist_position_snapshots(supabase_client, snapshots, strategy_id, snapshot_date) -> int
    Upserts into position_snapshots table with ON CONFLICT idempotency.

Internal helper:
  _parse_bybit_v5_positions(raw_response) -> list[dict]
    Parses raw Bybit V5 position list response into normalized dicts.
"""
from __future__ import annotations

import logging
import math
from typing import Any

from supabase import Client

from services.db import db_execute
from services.price_rule import usable_price

logger = logging.getLogger("quantalyze.analytics.positions")


def reported_pnl(raw: Any) -> float | None:
    """Return a venue's unrealized P&L as a float, or None when it reported none.

    167.1.1.2 D-05: a venue that says nothing about P&L (key absent, null, or a
    blank string) must NOT be stored as 0.0 -- that fabricates a real zero and
    readers could never tell the two apart. None means "the venue reported no
    P&L"; readers withhold it by name. A REPORTED zero (0, 0.0, "0") stays 0.0,
    and a non-empty non-numeric string still raises ValueError (fail loud).
    """
    if raw is None:
        return None
    if isinstance(raw, str) and not raw.strip():
        return None
    return float(raw)


class BybitPositionReadRefused(RuntimeError):
    """A Bybit position read that cannot be completed or priced, refused by name.

    The reason texts below are static on purpose: ``str(exc)`` can reach logs and the
    stored ``phase2_error_message``, so it carries no number and no venue text.
    """


BYBIT_UNPRICED_INVERSE_REASON = (
    "bybit position read refused: an inverse position has no usable mark price"
)
BYBIT_LIST_NOT_ENDED_REASON = (
    "bybit position read refused: the position list did not end within the page cap"
)
BYBIT_CURSOR_STUCK_REASON = (
    "bybit position read refused: the page cursor did not advance"
)
BYBIT_MALFORMED_REPLY_REASON = (
    "bybit position read refused: the answer has no position list"
)
BYBIT_UNREADABLE_INVERSE_VALUE_REASON = (
    "bybit position read refused: an inverse position has no usable value or unrealised pnl"
)
BYBIT_UNREADABLE_LINEAR_VALUE_REASON = (
    "bybit position read refused: an open position has no usable value or mark price"
)
BYBIT_UNREADABLE_SIZE_REASON = (
    "bybit position read refused: a position row has no readable size"
)

# A raw read that is still live after this many pages refuses (module constant, not
# Final, so a test can lower it). At 200 rows a page this is 5000 positions per category.
BYBIT_POSITION_RAW_PAGE_CAP: int = 25


def _bybit_inverse_position(
    info: dict[str, Any], side: str, entry_price: float
) -> dict[str, Any]:
    """One inverse (coin-margined) Bybit position row, in USD, from the raw v5 row.

    Both read paths come here (the ccxt position's ``info`` IS the raw row), the way
    ``_normalize_deribit_position`` reads raw ``info`` and never ccxt's ``notional`` /
    ``unrealizedPnl``, which are coin amounts under USD field names. ``positionValue``
    and ``unrealisedPnl`` are in the settle coin, so both are converted at the SAME
    payload's ``markPrice`` (USD per coin); ``None`` P&L stays ``None`` (the venue
    reported none). A mark that is absent, blank, zero, negative or non-finite
    refuses the row by name, because a USD figure at no price would be invented. So does a
    ``positionValue`` that is absent, blank, non-finite or negative, and an
    ``unrealisedPnl`` that is non-finite: each would ship 0 or NaN as a USD figure.
    """
    raw_mark = info.get("markPrice")
    if raw_mark is None or (isinstance(raw_mark, str) and not raw_mark.strip()):
        raise BybitPositionReadRefused(BYBIT_UNPRICED_INVERSE_REASON)
    # The raw payload carries the mark as a string and ``usable_price`` rejects a
    # numeric string, so convert first (a non-numeric string still raises ValueError).
    mark = usable_price(float(raw_mark))
    if mark is None:
        raise BybitPositionReadRefused(BYBIT_UNPRICED_INVERSE_REASON)
    raw_value = info.get("positionValue")
    if raw_value is None or (isinstance(raw_value, str) and not raw_value.strip()):
        raise BybitPositionReadRefused(BYBIT_UNREADABLE_INVERSE_VALUE_REASON)
    size_base = float(raw_value)  # coin
    if not math.isfinite(size_base) or size_base < 0:
        raise BybitPositionReadRefused(BYBIT_UNREADABLE_INVERSE_VALUE_REASON)
    coin_pnl = reported_pnl(info.get("unrealisedPnl"))
    if coin_pnl is not None and not math.isfinite(coin_pnl):
        raise BybitPositionReadRefused(BYBIT_UNREADABLE_INVERSE_VALUE_REASON)
    return {
        "symbol": str(info.get("symbol", "")),
        "side": side,
        "size_base": size_base,
        "size_usd": size_base * mark,
        "entry_price": entry_price,
        "mark_price": mark,
        "unrealized_pnl": coin_pnl * mark if coin_pnl is not None else None,
        "exchange": "bybit",
    }


# ---------------------------------------------------------------------------
# Bybit V5 raw response parser
# ---------------------------------------------------------------------------

def _parse_bybit_v5_positions(
    raw_response: dict[str, Any], *, category: str = "linear_usdt"
) -> list[dict[str, Any]]:
    """Parse raw Bybit V5 position list response into normalized dicts.

    Expected response structure (from private_get_v5_position_list):
    {
        "result": {
            "list": [
                {
                    "symbol": "BTCUSDT",
                    "side": "Buy" | "Sell",
                    "size": "0.1",
                    "positionValue": "6100",
                    "avgPrice": "60000",
                    "markPrice": "61000",
                    "unrealisedPnl": "100",
                    ...
                },
            ]
        }
    }

    Maps Buy → long, Sell → short, None/empty → flat.
    Filters out zero-size positions.

    ``category`` is a ``_BYBIT_POSITION_READS`` label. ``inverse`` rows carry coin
    amounts and are converted to USD at the row's mark (``_bybit_inverse_position``);
    the two linear categories (USDC counted as USD, the stable rule) read as before.
    """
    # Both keys are required, never defaulted: a reply with no ``result`` or no ``list`` would
    # read as a flat category and the holdings poll would store a book with no derivative rows.
    result = raw_response.get("result") if isinstance(raw_response, dict) else None
    items = result.get("list") if isinstance(result, dict) else None
    if not isinstance(items, list):
        raise BybitPositionReadRefused(BYBIT_MALFORMED_REPLY_REASON)
    positions: list[dict[str, Any]] = []

    for item in items:
        size_raw = item.get("size")
        # An absent or blank size is unmeasured, not flat; a REPORTED zero ("0") is flat.
        if size_raw is None or (isinstance(size_raw, str) and not size_raw.strip()):
            raise BybitPositionReadRefused(BYBIT_UNREADABLE_SIZE_REASON)
        size_base = abs(float(size_raw))
        if not math.isfinite(size_base):
            raise BybitPositionReadRefused(BYBIT_UNREADABLE_SIZE_REASON)
        if size_base < 1e-12:
            continue

        raw_side = item.get("side", "")
        if raw_side == "Buy":
            side = "long"
        elif raw_side == "Sell":
            side = "short"
        else:
            side = "flat"

        if category == "inverse":
            positions.append(
                _bybit_inverse_position(item, side, float(item.get("avgPrice", 0)))
            )
            continue

        # An open position's value and mark are required, never defaulted to 0.
        raw_value = item.get("positionValue")
        raw_mark = item.get("markPrice")
        if (
            raw_value is None or (isinstance(raw_value, str) and not raw_value.strip())
            or raw_mark is None or (isinstance(raw_mark, str) and not raw_mark.strip())
        ):
            raise BybitPositionReadRefused(BYBIT_UNREADABLE_LINEAR_VALUE_REASON)
        positions.append({
            "symbol": item.get("symbol", ""),
            "side": side,
            "size_base": size_base,
            "size_usd": float(raw_value),
            "entry_price": float(item.get("avgPrice", 0)),
            "mark_price": float(raw_mark),
            "unrealized_pnl": reported_pnl(item.get("unrealisedPnl")),
            "exchange": "bybit",
        })

    return positions


# ---------------------------------------------------------------------------
# Unified position normalizer from CCXT schema
# ---------------------------------------------------------------------------

def _normalize_deribit_position(pos: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize a Deribit derivative position (Phase 71 / DRB-09).

    Deribit INVERTS the linear CCXT assumption, so we read the raw ``info``
    fields (authoritative, matching the /private/get_position docs) rather
    than the unified ``contracts``/``notional``/``unrealizedPnl`` which CCXT
    maps in a Deribit-specific way:

      size            = position size in QUOTE ccy (USD/USDC) for futures/perps,
                        in BASE ccy (contracts) for options.
      size_currency   = position size in BASE ccy (BTC/ETH) — futures only.
      floating_profit_loss = unrealized PnL in the SETTLE ccy: BTC/ETH for
                        coin-settled (inverse) instruments, USDC for linear.
      average_price / mark_price / index_price = USD for perps/futures. For
                        options mark/average are the per-contract PREMIUM (in the
                        coin for inverse, USDC for linear); we convert them coin→
                        USD at the index so every emitted price/value field is USD.

    Inverse (coin-settled) PnL is converted coin→USD at ``index_price`` (the
    same convention the P70 ledger uses); linear (USDC-settled) PnL already ≈
    USD and passes through. Options report USD market VALUE (contracts ×
    premium), not underlying notional. Combos are value-loud-skipped. Returns
    None for a zero / flat position.
    """
    info = pos.get("info") or {}
    if not info:
        # A Deribit position with no raw payload is an unexpected shape —
        # fail loud rather than silently mis-normalize (no invented data).
        raise ValueError("deribit position missing raw 'info' payload")

    direction = str(info.get("direction") or "").lower()
    size = float(info.get("size") or 0)
    if direction == "zero" or size == 0:
        return None
    if direction == "buy":
        side = "long"
    elif direction == "sell":
        side = "short"
    else:  # missing direction — fall back to the sign of size
        side = "short" if size < 0 else "long"

    kind = str(info.get("kind") or "").lower()
    # Combos (future_combo / option_combo) are multi-leg; their size / price
    # fields don't follow the single-instrument convention, so value-loud-skip
    # them (contained by _normalize_ccxt_positions) rather than mis-value.
    if "combo" in kind:
        raise ValueError(
            f"deribit combo instrument {info.get('instrument_name')!r} "
            "(multi-leg) is not yet valued for the holdings panel"
        )
    option_style = kind == "option"

    index_price = float(info.get("index_price") or 0)
    mark_price = float(info.get("mark_price") or 0)
    average_price = float(info.get("average_price") or 0)

    # Coin-vs-USD settlement is decided by the SINGLE-SOURCE, instrument-name
    # classifier (deribit_txn) — NOT the ccxt-symbol shape. instrument_name is
    # always present in the raw Deribit payload, whereas pos["symbol"] can
    # degrade to the bare instrument name for an unresolved market (no ':'),
    # which would silently mis-read a coin-settled position as linear and
    # understate its uPnL ~index×. The classifier also FAILS LOUD on an unknown
    # coin-margined currency (mirroring the ledger's guard), and that raise is
    # contained per-position by _normalize_ccxt_positions.
    from services.deribit_txn import classify_instrument_settlement

    name = str(info.get("instrument_name") or pos.get("symbol") or "")
    coin_settled, _base = classify_instrument_settlement(name)

    if coin_settled:
        # coin→USD rate: index_price is the underlying spot. mark_price is a
        # valid BTC/USD rate for perps/futures but NOT for options (there it
        # is the premium in coin), so only fall back to mark for non-options.
        if index_price > 0:
            rate = index_price
        elif (not option_style) and mark_price > 0:
            rate = mark_price
        else:
            raise ValueError(
                "deribit inverse position: no usable index_price for coin→USD "
                f"conversion (index={index_price}, mark={mark_price})"
            )
        coin_pnl = reported_pnl(info.get("floating_profit_loss"))
        unrealized_pnl = coin_pnl * rate if coin_pnl is not None else None
    else:
        # Linear (USDC-settled): PnL already ≈ USD.
        rate = 0.0
        unrealized_pnl = reported_pnl(info.get("floating_profit_loss"))

    if option_style:
        # Options: `size` is the base-ccy contract count; mark/average are the
        # per-contract PREMIUM (in the coin for inverse, in USDC for linear).
        # USD market VALUE = contracts × premium, converted coin→USD at the
        # index for coin-settled (px_to_usd=rate=index), pass-through for linear
        # (px_to_usd=1). This reports the position's worth, NOT the underlying
        # notional (contracts × index) — that overstated value_usd ~50× (WR-01).
        px_to_usd = rate if coin_settled else 1.0
        entry_price = average_price * px_to_usd
        mark_price_usd = mark_price * px_to_usd
        size_base = abs(size)
        size_usd = abs(size) * mark_price_usd
        mark_out = mark_price_usd
    else:
        # Futures/perps (+ future_combo handled above): `size` is the quote-ccy
        # notional; `size_currency` is the base-ccy coin amount. Prices are USD.
        entry_price = average_price
        size_base = abs(float(info.get("size_currency") or 0))
        size_usd = abs(size)
        mark_out = mark_price

    symbol = info.get("instrument_name") or str(pos.get("symbol") or "")

    return {
        "symbol": symbol,
        "side": side,
        "size_base": size_base,
        "size_usd": size_usd,
        "entry_price": entry_price,
        "mark_price": mark_out,
        "unrealized_pnl": unrealized_pnl,
        "exchange": "deribit",
    }


def _normalize_ccxt_position(
    pos: dict[str, Any], exchange_name: str, *, bybit_category: str | None = None
) -> dict[str, Any] | None:
    """Normalize a single CCXT unified position dict to our schema.

    Returns None if position has zero size (filtered out by caller).

    ``bybit_category`` (one of the ``_BYBIT_POSITION_READS`` labels) matters for
    Bybit only. A USDC-settled linear position takes its symbol from the raw
    venue id: stripping the ccxt symbol ``BTC/USDC:USDC`` would give ``BTCUSDCC``.
    A missing or ``linear_usdt`` category is today's behaviour, unchanged.
    """
    # Deribit inverts the linear CCXT mapping (coin-settled contracts, PnL in
    # the coin) — normalize it from the raw `info` fields, never the linear path.
    if exchange_name == "deribit":
        return _normalize_deribit_position(pos)

    # Bybit: ccxt reads a blank or absent raw ``size`` as zero contracts, which the flat filter
    # below would drop. An unmeasured size is not flat; a reported "0" still is.
    if exchange_name == "bybit":
        raw_size = (pos.get("info") or {}).get("size")
        if raw_size is None or (isinstance(raw_size, str) and not raw_size.strip()):
            raise BybitPositionReadRefused(BYBIT_UNREADABLE_SIZE_REASON)

    # CCXT unified: contracts * contractSize = base quantity
    contracts = pos.get("contracts") or 0
    contract_size = pos.get("contractSize") or 1
    size_base = abs(float(contracts) * float(contract_size))

    if exchange_name == "bybit" and not math.isfinite(size_base):
        raise BybitPositionReadRefused(BYBIT_UNREADABLE_SIZE_REASON)
    if size_base < 1e-12:
        return None

    # Side mapping: CCXT unified uses "long" / "short" / None
    raw_side = pos.get("side", "")
    if raw_side in ("long", "short"):
        side = raw_side
    else:
        side = "flat"

    # Bybit inverse (coin-margined): ccxt's notional and unrealizedPnl are coin
    # amounts, so the row is built from the raw ``info`` in USD instead.
    if exchange_name == "bybit" and bybit_category == "inverse":
        return _bybit_inverse_position(
            pos.get("info") or {}, side, float(pos.get("entryPrice") or 0)
        )

    # Bybit linear: the raw positionValue and the markPrice are required on an open position,
    # never defaulted to 0 below. The raw ``info`` row is read, not ccxt's ``notional``: from
    # ccxt 4.5.89 a blank positionValue is back-filled as contracts x markPrice, so ccxt's own
    # field can no longer tell "reported" from "derived".
    if exchange_name == "bybit":
        raw_value = (pos.get("info") or {}).get("positionValue")
        if (
            raw_value is None or (isinstance(raw_value, str) and not raw_value.strip())
            or pos.get("markPrice") is None
        ):
            raise BybitPositionReadRefused(BYBIT_UNREADABLE_LINEAR_VALUE_REASON)

    # Symbol: strip the funding/settlement suffix for display
    # "BTC/USDT:USDT" → "BTCUSDT"
    symbol = pos.get("symbol", "")
    symbol = symbol.replace("/", "").replace(":USDT", "").replace(":USD", "")
    if exchange_name == "bybit" and bybit_category == "linear_usdc":
        symbol = str((pos.get("info") or {}).get("symbol") or symbol)

    return {
        "symbol": symbol,
        "side": side,
        "size_base": size_base,
        "size_usd": float(pos.get("notional") or 0),
        "entry_price": float(pos.get("entryPrice") or 0),
        "mark_price": float(pos.get("markPrice") or 0),
        "unrealized_pnl": reported_pnl(pos.get("unrealizedPnl")),
        "exchange": exchange_name,
    }


# ccxt's Bybit parser nulls an exact-zero P&L (omit_zero), so a CCXT None is
# ambiguous between "absent" and "zero". That is why ANY None here routes to
# the raw V5 string, the only Bybit source that can say "reported 0" versus
# "not reported" (167.1.1.2 RESEARCH finding 1). Do not relax this check.
# From ccxt 4.5.89 the parser derives the P&L from mark and entry instead of
# nulling it, so the raw row's own ``unrealisedPnl`` is checked too: a blank or
# zero raw value routes to the raw read on every ccxt version.
def _bybit_ccxt_has_critical_fields(positions: list[dict[str, Any]]) -> bool:
    """Check if Bybit CCXT positions have all critical fields populated.

    If any position is missing markPrice, entryPrice, or unrealizedPnl,
    we need to fall back to the raw V5 API.
    """
    def raw_pnl_is_reported_nonzero(pos: dict[str, Any]) -> bool:
        info = pos.get("info") or {}
        if "unrealisedPnl" not in info:
            return True  # no raw row to judge by: ccxt's own field decides
        raw = reported_pnl(info["unrealisedPnl"])
        return raw is not None and raw != 0

    return all(
        pos.get("markPrice") is not None
        and pos.get("entryPrice") is not None
        and pos.get("unrealizedPnl") is not None
        and raw_pnl_is_reported_nonzero(pos)
        for pos in positions
    )


# ---------------------------------------------------------------------------
# Internal: batch normalize CCXT positions
# ---------------------------------------------------------------------------

def _normalize_ccxt_positions(
    raw: list[dict[str, Any]], exchange_name: str, *, bybit_category: str | None = None
) -> list[dict[str, Any]]:
    """Normalize a list of CCXT unified positions, filtering out zero-size.

    Deribit ONLY: a single un-normalizable position (fails the coin→USD guard —
    no usable index_price, unknown coin-margined currency, or a combo leg) is
    SKIPPED with a loud log rather than aborting the whole batch, so one
    anomalous instrument can't hide every other position the account holds
    ("the allocator sees their positions"). We skip, never invent a value; the
    anomaly is surfaced via the log/telemetry, not a wrong number.

    Other venues keep their existing FAIL-LOUD semantics — the Deribit branch is
    the only normalizer that raises by design, and a malformed Bybit/OKX row
    should still abort loudly (never be silently dropped, WR-03), so we don't
    swallow their exceptions.
    """
    if exchange_name != "deribit":
        return [
            n for pos in raw
            if (n := _normalize_ccxt_position(
                pos, exchange_name, bybit_category=bybit_category
            )) is not None
        ]

    out: list[dict[str, Any]] = []
    for pos in raw:
        try:
            n = _normalize_ccxt_position(pos, exchange_name)
        except ValueError as exc:
            logger.warning(
                "positions: skipping un-normalizable deribit position instrument=%r: %s",
                (pos.get("info") or {}).get("instrument_name") or pos.get("symbol"),
                exc,
            )
            continue
        if n is not None:
            out.append(n)
    return out


# ---------------------------------------------------------------------------
# Public: fetch_positions
# ---------------------------------------------------------------------------

async def fetch_positions(exchange_name: str, exchange: Any) -> list[dict[str, Any]]:
    """Fetch current positions from exchange via async CCXT.

    The exchange must already be constructed (via create_exchange) with
    valid decrypted credentials.

    Per-exchange implementations:
    - Binance futures: exchange.fetch_positions() (CCXT unified schema)
    - OKX hedge mode: exchange.fetch_positions() — dual-side returns
      separate long/short entries per symbol
    - Bybit: exchange.fetch_positions() first. If critical fields are missing
      (entryPrice, markPrice, unrealizedPnl), fall back to raw
      exchange.private_get_v5_position_list.

    Returns normalized dicts, filtering out zero-size positions.
    """
    if exchange_name == "bybit":
        return await _fetch_positions_bybit(exchange)

    # Binance and OKX both use the CCXT unified fetch_positions
    raw_positions = await exchange.fetch_positions()
    return _normalize_ccxt_positions(raw_positions, exchange_name)


# The three position reads the poll makes (VREAD-02): label, the params
# ccxt's ``fetch_positions(None, params)`` takes, and the raw V5 request params.
# ccxt's default is linear USDT only, so USDC-settled perps and inverse contracts
# never reached holdings (or their uPnL, the derivative leg of AUM).
# NOT every list a key can hold: Bybit option positions (``category=option``,
# USDC-settled) are not read, so their exposure and uPnL are absent from holdings
# and snapshots. That gap is decided, not forgotten: census row C28.
_BYBIT_POSITION_READS: tuple[tuple[str, dict[str, str], dict[str, str]], ...] = (
    ("linear_usdt", {"settleCoin": "USDT"}, {"category": "linear", "settleCoin": "USDT"}),
    ("linear_usdc", {"settleCoin": "USDC"}, {"category": "linear", "settleCoin": "USDC"}),
    ("inverse", {"subType": "inverse"}, {"category": "inverse"}),
)

# Bybit's position list answers at most 200 rows a page (default 20). Module constant,
# not Final, so a test can lower it.
BYBIT_POSITION_PAGE_LIMIT: int = 200


async def _read_bybit_positions_raw(
    exchange: Any, label: str, raw_params: dict[str, str]
) -> list[dict[str, Any]]:
    """One category read on the raw V5 path: ``limit`` sent, ``nextPageCursor`` followed.

    Without ``limit`` Bybit answers its default page of 20, so a 21st position was
    cut silently. An empty page ends the list. Refuses by name when the list is still
    live after ``BYBIT_POSITION_RAW_PAGE_CAP`` pages, or when a page that carries rows
    answers the cursor it was sent. Reads the two page constants at call time.
    """
    positions: list[dict[str, Any]] = []
    cursor = ""
    for _ in range(BYBIT_POSITION_RAW_PAGE_CAP):
        params = {**raw_params, "limit": str(BYBIT_POSITION_PAGE_LIMIT)}
        if cursor:
            params["cursor"] = cursor
        raw_response = await exchange.private_get_v5_position_list(params)
        page = _parse_bybit_v5_positions(raw_response, category=label)
        result = raw_response["result"]  # the parse above refused a reply without it
        positions.extend(page)
        next_cursor = result.get("nextPageCursor") or ""
        if not next_cursor or not result.get("list"):
            return positions
        if next_cursor == cursor:
            raise BybitPositionReadRefused(BYBIT_CURSOR_STUCK_REASON)
        cursor = next_cursor
    raise BybitPositionReadRefused(BYBIT_LIST_NOT_ENDED_REASON)


async def _fetch_positions_bybit(exchange: Any) -> list[dict[str, Any]]:
    """Bybit-specific: per category, CCXT unified first, fall back to raw V5.

    A category whose ccxt rows are present, below a full page and carry every
    critical field ships its ccxt rows. Any other category (empty, a None field, or
    a full page of ``BYBIT_POSITION_PAGE_LIMIT`` that cannot be told from a truncated
    one) is read on the raw cursor path. Every sub-read is awaited without a swallow,
    so one failed category propagates and no category's rows ship alone (never a
    silent partial). A flat account costs three ccxt plus three raw calls per poll.
    """
    positions: list[dict[str, Any]] = []
    for label, ccxt_params, raw_params in _BYBIT_POSITION_READS:
        raw_positions = await exchange.fetch_positions(None, dict(ccxt_params))

        # Check if CCXT returned complete data
        if (
            raw_positions
            and len(raw_positions) < BYBIT_POSITION_PAGE_LIMIT
            and _bybit_ccxt_has_critical_fields(raw_positions)
        ):
            positions.extend(
                _normalize_ccxt_positions(raw_positions, "bybit", bybit_category=label)
            )
            continue

        # Fallback: raw V5 API
        logger.info(
            "Bybit CCXT positions missing critical fields or a full page, "
            "falling back to V5 API"
        )
        positions.extend(await _read_bybit_positions_raw(exchange, label, raw_params))
    return positions


# ---------------------------------------------------------------------------
# Public: persist_position_snapshots
# ---------------------------------------------------------------------------

async def persist_position_snapshots(
    supabase_client: Client,
    snapshots: list[dict[str, Any]],
    strategy_id: str,
    snapshot_date: str,
) -> int:
    """Upsert snapshots into position_snapshots table.

    Uses ON CONFLICT (strategy_id, snapshot_date, symbol, side) DO UPDATE
    to be idempotent. Returns count of rows upserted.
    """
    if not snapshots:
        return 0

    rows = [
        {**snap, "strategy_id": strategy_id, "snapshot_date": snapshot_date}
        for snap in snapshots
    ]

    def _upsert() -> None:
        supabase_client.table("position_snapshots").upsert(
            rows,
            on_conflict="strategy_id,snapshot_date,symbol,side",
        ).execute()

    await db_execute(_upsert)
    return len(rows)
