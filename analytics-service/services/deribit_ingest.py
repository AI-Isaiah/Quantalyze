"""Deribit ledger I/O — the transaction-log cash-delta ledger backbone (P70 70-03).

This module is the AUTHORITATIVE realized-cash source for Deribit daily returns
(LOCKED design: ``analytics-service/docs/deribit-ingestion-design.md``). It owns
the raw ``private/get_transaction_log`` crawl (count=250, ``continuation`` → null),
per-scope auth (subaccount reads via ``public/exchange_token``), account-driven
currency enumeration, and the re-anchored **D-02 honesty gate** — ledger
COMPLETENESS over the date range, NOT reconciliation to the fill counts
(18,778 / 21,014 / 61,248), which the Wave-0 probe proved reconcile to no API
surface.

Money math (coin→USD, funding-inclusive daily bucketing) is DELIBERATELY not
here — that is ``services.deribit_txn`` (70-02, pure/I-O-free). This module only
performs I/O and feeds the rows through ``txn_rows_to_daily_records``.

The single corruption risk of the phase is a SILENTLY-PARTIAL ledger — an
under-fetched crawl (rate-limit truncation or a skipped scope) that renders as a
complete track record. Two guards make that impossible:

* ``paginate_txn_log`` RAISES ``LedgerTruncatedError`` when the 10028 retry budget
  is exhausted before ``continuation=null`` — it NEVER returns partial pages.
* ``assert_ledger_complete`` RAISES ``LedgerCompletenessError`` if ANY expected
  scope × currency did not reach ``continuation=null`` (truncation, a -32602 skip,
  or a dropped scope all leave the gate failing).
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import AbstractSet, Any

import ccxt
import pandas as pd

from services.deribit_txn import (
    _INVERSE_CURRENCIES,
    _NATIVE_OPTIONS_SUMMARY_TYPES,
    DEFAULT_PNL_BASIS,
    LedgerValuationError,
    PNL_BASIS_MARK_TO_MARKET,
    PNL_BASIS_SMOOTHED_MTM,
    _day_ccy_own_index,
    _iter_utc_days,
    _option_activity_after_coverage,
    _pre_coverage_option_days,
    _row_is_cash_bearing,
    assert_balance_identity,
    classify_instrument,
    deribit_dated_external_flows_usd,
    inverse_days_needing_index,
    option_mtm_daily,
    replay_option_positions,
    txn_rows_to_daily_records,
    txn_rows_to_native_daily,
)
from services.external_flows import USD_FAMILY, ExternalFlow
from services.native_nav import NativeLedger
from services.redact import scrub_freeform_string

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rate-limit pacing / backoff constants (design §"Rate limits (10028)").
# get_transaction_log is special: cost 10,000, pool 80,000, ~1 req/s, burst 8.
# ---------------------------------------------------------------------------

# Documented max page size — count=1000 over-caps and truncates (Wave-0 root cause).
LEDGER_PAGE_COUNT: int = 250
# Pace between successful pages (~1 req/s).
LEDGER_PACE_SECONDS: float = 1.0
# Exponential backoff base for 10028; wait = base * 2**(retry-1) → 1, 2, 4, …
LEDGER_BACKOFF_BASE_SECONDS: float = 1.0
# Max consecutive 10028 retries for a single page before failing loud.
LEDGER_MAX_RETRIES: int = 8

# A TRANSIENT public-read blip (network/timeout/5xx → ccxt.NetworkError) on a
# settlement-index or index-price probe is RETRYABLE: retry with backoff, then
# raise DeribitTransientReadError. Reuses the txn-log read discipline's budget +
# backoff base so the ONE read-retry policy governs every Deribit public read.
PUBLIC_READ_MAX_RETRIES: int = LEDGER_MAX_RETRIES
PUBLIC_READ_BACKOFF_BASE_SECONDS: float = LEDGER_BACKOFF_BASE_SECONDS

# Deribit error codes.
_RATE_LIMIT_CODE: int = 10028
_NON_MARGIN_CURRENCY_CODE: int = -32602

SleepFn = Callable[[float], Awaitable[None]]


# ---------------------------------------------------------------------------
# Exceptions — every one is a FAIL-LOUD signal, never swallowed.
# ---------------------------------------------------------------------------


class LedgerTruncatedError(RuntimeError):
    """A scope × currency crawl could not reach ``continuation=null`` before the
    10028 retry budget was exhausted. Raised INSTEAD of returning partial pages
    (the silent-under-fetch corruption risk the D-02 gate exists to catch)."""


class ScopeAuthError(RuntimeError):
    """A scope's read auth could not be resolved (no subaccount token could be
    minted). A scope we cannot authenticate is a silent under-fetch, so this
    fails loud rather than skipping the scope."""


class LedgerCompletenessError(RuntimeError):
    """The re-anchored D-02 honesty gate. Raised when ANY expected scope ×
    currency did not reach ``continuation=null`` (a truncated crawl or a dropped
    scope). This is LEDGER completeness — NOT a reconciliation to the fill counts
    18,778 / 21,014 / 61,248, which the Wave-0 probe (BLOCKING_FINDING) proved
    reconcile to no API surface."""


class CurrencyEnumerationError(RuntimeError):
    """``public/get_currencies`` could not be read, so the authoritative,
    balance-INDEPENDENT currency universe cannot be established. Enumerating from
    held balances would drop any currency that HELD history but is now
    zero-balance, and the gate graded against that set is blind to the drop — so
    enumeration fails loud rather than under-anchor the expected coverage."""


class DeribitTransientReadError(RuntimeError):
    """A ``get_account_summaries`` anchor read FAILED/came back empty (I/O), so
    there is NO native anchor to reconstruct from. This is a TRANSIENT read
    condition — NOT a structural refusal — so it must NEVER be dispositioned
    permanent: a blank read that silently built a ZERO-anchor ledger would roll
    every bucket back from 0.0 and the ``full_history`` §5 inception gate would
    false-refuse ``InceptionReconciliationError`` (permanent, no retry) on a mere
    network blip. Deliberately a NON-``ValueError`` / non-``NavReconstructionError``
    type so it escapes the deribit permanent except chain to the generic
    retryable dispatcher (which retries). An unvaluable COLLAPSE (a held coin with
    no USD index) keeps the readable native maps and is left to the core's
    structural refusal — it is NOT this transient case."""


# 2015-01-01 UTC in ms — full Deribit history default (txn-log spans 2023→2026).
DEFAULT_START_MS: int = 1_420_070_400_000


# ---------------------------------------------------------------------------
# Scope model.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Scope:
    """One account scope to crawl. ``subaccount_id`` is a STRING (Wave-0: Deribit
    get_subaccounts returns id as a string); ``None`` for the main scope."""

    label: str
    subaccount_id: str | None
    is_main: bool


# ---------------------------------------------------------------------------
# Error-code extraction — never leaks credentials into logs.
# ---------------------------------------------------------------------------


def _deribit_error_code(exc: BaseException) -> int | None:
    """Best-effort Deribit error code from a ccxt exception. Checks a ``.code``
    attribute first, then a numeric run in the (scrubbed) message. Never raises."""
    code = getattr(exc, "code", None)
    if isinstance(code, int):
        return code
    text = str(scrub_freeform_string(str(exc)))
    match = re.search(r"(-?\d{4,5})", text)
    return int(match.group(1)) if match else None


def _deribit_real_code(exc: BaseException) -> int | None:
    """The Deribit error code from an authoritative ``.code`` INTEGER attribute
    ONLY — never a regex-scraped message run. Used for the -32602 "no wallet"
    reclassification (P70 review H1): treating a currency crawl as complete-empty
    must not rest on a 4-5-digit substring that merely happens to appear in an
    unrelated scrubbed message. ``bool`` is rejected (it is an ``int`` subclass)."""
    code = getattr(exc, "code", None)
    if isinstance(code, bool):
        return None
    return code if isinstance(code, int) else None


def _is_transient_read_error(exc: BaseException) -> bool:
    """True when a PUBLIC-read exception is a TRANSIENT network condition
    (network/timeout/5xx/rate-limit), NOT a benign STRUCTURAL response.

    A genuinely-absent index / "no data" is a business response the exchange
    RETURNED — ccxt raises it as ``ExchangeError`` / ``BadSymbol`` / ``BadRequest``,
    none of which subclass ``NetworkError`` → this returns ``False`` → the reader
    keeps its honest structural behaviour (skip the currency / return the
    accumulated map, never retried forever). Only a ``ccxt.NetworkError`` (which
    covers ``RequestTimeout``, ``RateLimitExceeded``, ``ExchangeNotAvailable`` and
    ``DDoSProtection``) is transient → ``True`` → retry with backoff, then raise
    ``DeribitTransientReadError`` on exhaustion. This is EXACTLY the platform
    ``classify_exception`` transient bucket (``job_worker.py``), so the read-retry
    policy and the job-level dispatcher agree on what "transient" means."""
    return isinstance(exc, ccxt.NetworkError)


# ---------------------------------------------------------------------------
# Scope enumeration + per-scope auth.
# ---------------------------------------------------------------------------


def _subaccount_is_funded(entry: Mapping[str, Any]) -> bool:
    """True if a ``get_subaccounts(with_portfolio=true)`` entry holds ANY nonzero
    equity in any currency. Never raises (untrusted exchange input; string-typed
    numerics coerced)."""
    portfolio = entry.get("portfolio")
    if not isinstance(portfolio, Mapping):
        return False
    for pdata in portfolio.values():
        if not isinstance(pdata, Mapping):
            continue
        raw = pdata.get("equity")
        if raw is None or isinstance(raw, bool):
            continue
        try:
            if float(raw) != 0.0:
                return True
        except (TypeError, ValueError):
            continue
    return False


async def enumerate_scopes(exchange: Any) -> list[Scope]:
    """The scope set to crawl: the key's OWN authenticated account — a single
    scope — with a runtime CHECK that the single-scope premise actually holds.

    P70 live evidence (drb03, 2026-07-05): each LTP read-only key authenticates
    AS one Deribit subaccount and its ``get_account_summaries`` / txn-log /
    trades already return that account's COMPLETE data. ``get_subaccounts``
    returns an empty ``type=main`` parent shell plus the key's own account, and
    the key's own equity is byte-identical to that account's portfolio (acct2
    USDC 622,923.41; acct3 USDT 232,500 — both match exactly). The sibling
    subaccounts are NOT separately reachable (``public/exchange_token`` returns
    BadRequest for client-credentials keys — it needs an OAuth refresh_token).

    Review F-2/C1: rather than TRUST that provisioning contract silently, VERIFY
    it. If ``get_subaccounts(with_portfolio=true)`` shows MORE THAN ONE funded
    account, this key is a parent with separately-funded children a single-scope
    crawl would silently miss → FAIL LOUD (``ScopeAuthError``): use one read-only
    key per subaccount. ``<=1`` funded account (the key's own, or none) is the
    safe single-scope case. A ``get_subaccounts`` read error is non-fatal — the
    key's OWN account still crawls correctly and the equity-vs-rows floor
    (job_worker) is the backstop; the check is skipped, not the crawl."""
    scope = [Scope(label="main", subaccount_id=None, is_main=True)]
    try:
        resp = await exchange.private_get_get_subaccounts({"with_portfolio": "true"})
    except Exception as exc:  # noqa: BLE001 - verification only; crawl is unaffected
        logger.warning(
            "deribit enumerate_scopes: get_subaccounts check skipped (%s); "
            "proceeding single-scope",
            scrub_freeform_string(str(exc)),
        )
        return scope
    result = resp.get("result", []) if isinstance(resp, Mapping) else []
    if not isinstance(result, Sequence):
        return scope
    funded = sum(
        1 for e in result if isinstance(e, Mapping) and _subaccount_is_funded(e)
    )
    if funded > 1:
        raise ScopeAuthError(
            f"Deribit key sees {funded} FUNDED subaccounts — a single-scope crawl "
            "would silently miss the siblings (they are not reachable via "
            "exchange_token). Provision one read-only key PER subaccount (design "
            "§Subaccounts / P72) rather than a parent-account key."
        )
    return scope


async def mint_subaccount_token(exchange: Any, subject_id: str) -> str:
    """Mint a read-scoped token for a subaccount via ``public/exchange_token``
    (param ``subject_id`` — subaccount_id is refused on the read-only LTP keys,
    design §Subaccounts). Raises ``ScopeAuthError`` if no token comes back.

    ⚠️ CURRENTLY UNREACHABLE under single-scope enumeration (``enumerate_scopes``
    returns only the key's own ``main`` scope — the LTP key IS its own subaccount,
    drb03). ``public/exchange_token`` was also live-proven to return BadRequest
    for client-credentials keys (it needs an OAuth refresh_token). RETAINED for a
    possible P72 provisioning revisit; kept tested so the contract stays valid."""
    try:
        resp = await exchange.public_get_exchange_token({"subject_id": subject_id})
    except Exception as exc:  # noqa: BLE001 - fail loud, scrubbed
        raise ScopeAuthError(
            f"exchange_token mint failed for subject_id={subject_id!r}: "
            f"{scrub_freeform_string(str(exc))}"
        ) from None
    result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
    token = result.get("access_token") if isinstance(result, Mapping) else None
    if not token or not isinstance(token, str):
        raise ScopeAuthError(
            f"exchange_token returned no access_token for subject_id={subject_id!r}"
        )
    return token


async def resolve_scope_auth(exchange: Any, scope: Scope) -> dict[str, Any]:
    """Resolve the per-request auth params for ``scope``.

    * main scope → ``{}`` (the key signs itself);
    * subaccount scope → mint a read token via ``public/exchange_token`` and
      pass it as an ``access_token`` request param.

    A subaccount scope whose token cannot be minted FAILS LOUD (ScopeAuthError)
    — a silently-skipped scope is a silent under-fetch (T-70-08)."""
    if scope.is_main or scope.subaccount_id is None:
        return {}
    token = await mint_subaccount_token(exchange, scope.subaccount_id)
    return {"access_token": token}


# ---------------------------------------------------------------------------
# Currency enumeration — from the account, never hard-coded.
# ---------------------------------------------------------------------------


async def enumerate_currencies(
    exchange: Any, scope: Scope, scope_auth: Mapping[str, Any]
) -> list[str]:
    """The AUTHORITATIVE, balance-INDEPENDENT currency universe to crawl — every
    wallet currency listed by ``public/get_currencies``.

    Deliberately NOT derived from held balances: a currency that HELD history but
    is now zero-balance would be dropped, and the completeness gate — graded
    against the same held-derived set — would be blind to the gap (the
    self-referential-gate class). Crawling the full public set instead, a
    currency the account never funded surfaces at the crawl as empty (or a
    per-currency ``-32602`` "no wallet") and is recorded complete-empty there.

    A read error, a non-list result, or an empty list FAILS LOUD
    (``CurrencyEnumerationError``): without the authoritative universe the gate
    cannot prove completeness. ``public/get_currencies`` needs no scope/auth —
    ``scope``/``scope_auth`` are kept for signature stability and are the SAME
    set for every scope (the tradeable universe is account-wide)."""
    try:
        resp = await exchange.public_get_get_currencies()
    except Exception as exc:  # noqa: BLE001 - fail loud, never a silent []
        raise CurrencyEnumerationError(
            "Deribit public/get_currencies failed; cannot establish the "
            f"authoritative currency universe: {scrub_freeform_string(str(exc))}."
        ) from None
    result = resp.get("result", []) if isinstance(resp, Mapping) else None
    out: list[str] = []
    if isinstance(result, Sequence):
        for entry in result:
            if isinstance(entry, Mapping) and entry.get("currency"):
                out.append(str(entry["currency"]))
    if not out:
        raise CurrencyEnumerationError(
            "Deribit public/get_currencies returned no currencies; refusing an "
            "empty currency universe (the gate cannot prove completeness against "
            "an empty expected set)."
        )
    return out


# ---------------------------------------------------------------------------
# The ledger paginator — count=250, continuation→null, pace + backoff, fail loud.
# ---------------------------------------------------------------------------


async def paginate_txn_log(
    exchange: Any,
    scope_label: str,
    currency: str,
    start_ms: int,
    end_ms: int,
    scope_auth: Mapping[str, Any],
    *,
    sleep: SleepFn = asyncio.sleep,
    max_retries: int = LEDGER_MAX_RETRIES,
    pace_seconds: float = LEDGER_PACE_SECONDS,
) -> list[Mapping[str, Any]]:
    """Fully crawl ``private/get_transaction_log`` for one scope × currency.

    count=250, follow ``continuation`` to null, accumulate rows ONCE. Paced to
    ~1 req/s (``sleep`` awaited between pages — injected for CI) and exponential-
    backoff on 10028 up to ``max_retries``. If the budget is exhausted before
    ``continuation=null`` → raise ``LedgerTruncatedError`` (scope + currency +
    last continuation). NEVER returns a partial page set: a structurally-degraded
    200 (non-Mapping body/result or non-list ``logs``) raises rather than being
    read as end-of-history (F-1). A FIRST-page ``-32602`` (no wallet for this
    currency, authoritative ``.code`` only) returns ``[]``; a ``-32602`` after
    rows were fetched propagates (fail loud — never drop real rows, F-3). Every
    other non-10028 error propagates. All ccxt errors are scrubbed before logging.
    """
    rows: list[Mapping[str, Any]] = []
    continuation: Any = None
    is_first_page = True
    while True:
        params: dict[str, Any] = {
            "currency": currency,
            "start_timestamp": start_ms,
            "end_timestamp": end_ms,
            "count": LEDGER_PAGE_COUNT,
        }
        params.update(scope_auth)
        if continuation:
            params["continuation"] = continuation

        # Pace ~1 req/s between page requests (not before the first).
        if not is_first_page:
            await sleep(pace_seconds)

        retries = 0
        while True:
            try:
                resp = await exchange.private_get_get_transaction_log(params)
                break
            except Exception as exc:  # noqa: BLE001
                # -32602 "no wallet for this currency" (F-3/H1): honor as an
                # empty crawl ONLY on the FIRST page with zero rows fetched, and
                # ONLY from an authoritative integer .code (never a regex-scraped
                # one). A -32602 AFTER rows exist, or on a continuation page,
                # would DROP already-fetched data → must fail loud. The full
                # public-currency universe includes currencies never funded; those
                # legitimately -32602 on page 1.
                if (
                    _deribit_real_code(exc) == _NON_MARGIN_CURRENCY_CODE
                    and is_first_page
                    and not rows
                ):
                    return []
                if _deribit_error_code(exc) != _RATE_LIMIT_CODE:
                    # Non-rate-limit error: surface it (scrubbed) to the caller.
                    raise
                retries += 1
                if retries > max_retries:
                    raise LedgerTruncatedError(
                        f"ledger crawl truncated for scope={scope_label!r} "
                        f"currency={currency!r} at continuation={continuation!r}: "
                        f"10028 retry budget ({max_retries}) exhausted — refusing "
                        f"a silently-partial ledger"
                    ) from None
                await sleep(LEDGER_BACKOFF_BASE_SECONDS * (2 ** (retries - 1)))

        is_first_page = False
        # F-1: a well-formed done response is a Mapping result with a `logs` LIST
        # and a (null/int) `continuation`. A STRUCTURALLY-DEGRADED 200 (non-Mapping
        # body/result, or `logs` not a list — a proxy/gateway artifact or an API
        # shape change) must NOT be read as end-of-history: that would silently
        # truncate the ledger and pass the completeness gate. Fail loud instead.
        if not isinstance(resp, Mapping) or not isinstance(resp.get("result"), Mapping):
            raise LedgerTruncatedError(
                f"ledger crawl for scope={scope_label!r} currency={currency!r} got a "
                "structurally-degraded response (non-Mapping body/result) — refusing "
                "to treat it as end-of-history"
            )
        result = resp["result"]
        logs = result.get("logs", [])
        if not isinstance(logs, Sequence) or isinstance(logs, (str, bytes)):
            raise LedgerTruncatedError(
                f"ledger crawl for scope={scope_label!r} currency={currency!r} got a "
                "non-list `logs` field — refusing to treat a degraded page as done"
            )
        rows.extend(r for r in logs if isinstance(r, Mapping))
        continuation = result.get("continuation")
        if not continuation:
            break
    return rows


# ---------------------------------------------------------------------------
# Same-day settlement (delivery-price) index — the quiet-day inverse fallback.
# public/get_delivery_prices publishes a SAME-DAY settlement mark per UTC day;
# it is inside D-07's event window (NOT a period-end/current price), so it is a
# legitimate same-time-basis fallback for a coin cash row on a day the ledger
# itself carries no index (e.g. a negative_balance_fee on a quiet day).
# ---------------------------------------------------------------------------

# Documented max page size for get_delivery_prices (paginated newest-first by
# offset; response result.data = [{date, delivery_price}], result.records_total).
DELIVERY_PRICES_PAGE_COUNT: int = 100
# ponytail: a defensive hard page cap so a delivery-price crawl can NEVER spin
# forever on a misbehaving endpoint — 60×100 = 6,000 days (~16y) far exceeds
# Deribit's history; we always stop far earlier at exhaustion or oldest_day.
DELIVERY_PRICES_MAX_PAGES: int = 60


async def fetch_deribit_settlement_index(
    exchange: Any,
    currency: str,
    *,
    oldest_day: str,
    sleep: SleepFn = asyncio.sleep,
    max_retries: int = PUBLIC_READ_MAX_RETRIES,
) -> dict[str, float]:
    """Per-UTC-day USD settlement index for ``currency`` from the PUBLIC
    ``public/get_delivery_prices`` endpoint (``index_name={ccy}_usd``).

    Pages by ``offset`` newest-first, accumulating ``{date_iso: delivery_price}``
    for every ``delivery_price > 0``, and STOPS at the first of: a short page
    (< ``count`` rows → history exhausted), the map reaching back to
    ``oldest_day`` (``min(dates) <= oldest_day``), or the defensive
    ``DELIVERY_PRICES_MAX_PAGES`` cap. Paces ``sleep`` between pages (mirrors
    ``paginate_txn_log``'s ``LEDGER_PACE_SECONDS``).

    This is a SAME-DAY settlement mark → D-07-compliant same-time-basis fallback,
    NOT a period-end/current price. Read-error discipline (red-team HIGH-2): a
    GENUINE benign "no data" (the exchange RESPONDED — a non-``NetworkError`` ccxt
    error) is NON-fatal to correctness — the aggregator still fails loud (Fix A) if a
    needed day stays unvalued — so it returns whatever was accumulated rather than
    crashing the crawl. A TRANSIENT read (network/timeout/5xx → ``ccxt.NetworkError``)
    is instead RETRIED with backoff and, on ``max_retries`` exhaustion, raises
    ``DeribitTransientReadError`` (retryable) — NEVER a silently-truncated partial map
    that looks complete-but-sparse (which the core would refuse PERMANENTLY as
    ``missing_daily_marks`` on a mere blip). Every ccxt error is scrubbed before
    logging.
    """
    index_name = f"{currency.lower()}_usd"
    prices: dict[str, float] = {}
    for page in range(DELIVERY_PRICES_MAX_PAGES):
        if page:
            await sleep(LEDGER_PACE_SECONDS)
        params: dict[str, Any] = {
            "index_name": index_name,
            "offset": page * DELIVERY_PRICES_PAGE_COUNT,
            "count": DELIVERY_PRICES_PAGE_COUNT,
        }
        # A TRANSIENT read (network/timeout/5xx → ccxt.NetworkError) is RETRYABLE:
        # retry the SAME offset with backoff, then RAISE DeribitTransientReadError on
        # exhaustion — NEVER return a silently-truncated partial map that looks
        # complete-but-sparse (which would drive a PERMANENT missing_daily_marks core
        # refusal on a mere blip). A GENUINE benign "no data" (the exchange
        # RESPONDED — ExchangeError/BadSymbol) returns the accumulated map as before;
        # the own-index union + honest core refusal handle a real gap.
        retries = 0
        while True:
            try:
                resp = await exchange.public_get_get_delivery_prices(params)
                break
            except Exception as exc:  # noqa: BLE001
                if _is_transient_read_error(exc):
                    retries += 1
                    if retries > max_retries:
                        raise DeribitTransientReadError(
                            "deribit get_delivery_prices transient read budget "
                            f"({max_retries}) exhausted for index_name={index_name} "
                            f"offset={params['offset']} — refusing a silently-partial "
                            "settlement map (retryable)"
                        ) from None
                    await sleep(
                        PUBLIC_READ_BACKOFF_BASE_SECONDS * (2 ** (retries - 1))
                    )
                    continue
                logger.warning(
                    "deribit get_delivery_prices structural no-data for "
                    "index_name=%s offset=%s (%s); returning %d accumulated day(s)",
                    index_name,
                    params["offset"],
                    scrub_freeform_string(str(exc)),
                    len(prices),
                )
                return prices
        result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
        data = result.get("data", []) if isinstance(result, Mapping) else []
        if not isinstance(data, Sequence) or isinstance(data, (str, bytes)):
            return prices
        for entry in data:
            if not isinstance(entry, Mapping):
                continue
            date = entry.get("date")
            raw_price = entry.get("delivery_price")
            if not date or raw_price is None:
                continue
            try:
                price = float(raw_price)
            except (TypeError, ValueError):
                continue
            if price > 0:
                prices.setdefault(str(date), price)
        # ponytail: gate exhaustion on a RAW empty page, not `< count` — decouples
        # termination from the exact `count` ceiling (verified 100 live: count=1000
        # clamps to 100, records_total ~2537) so a future page-size change can
        # never truncate the crawl to page 1. The common case still stops early on
        # the oldest-day / MAX_PAGES guards below.
        if len(data) == 0:
            break  # empty page — history exhausted
        if prices and min(prices) <= oldest_day:
            break  # accumulated back to the oldest needed day (newest-first)
    return prices


# The linear USDC-quoted perpetual whose DAILY CLOSE is the lowest-precedence
# {ccy}_usd mark fill (80-04) for INDEXED coins whose get_delivery_prices series
# is SPARSE. Deribit names it "{CCY}_USDC-PERPETUAL" (e.g. SOL_USDC-PERPETUAL);
# NEVER the bare "{CCY}-PERPETUAL" (that is the COIN-margined perp, quoted in coin
# — its "price" is ~1.0-scaled and is NOT a USD mark).
_PERP_DAILY_INSTRUMENT_SUFFIX = "_USDC-PERPETUAL"
_PERP_DAILY_RESOLUTION = "1D"


async def fetch_deribit_perp_daily_index(
    exchange: Any,
    currency: str,
    *,
    oldest_day: str,
    sleep: SleepFn = asyncio.sleep,
    max_retries: int = PUBLIC_READ_MAX_RETRIES,
) -> dict[str, float]:
    """Per-UTC-day USD mark for ``currency`` from the DAILY CLOSE of Deribit's
    linear ``{ccy}_USDC-PERPETUAL`` via the PUBLIC ``get_tradingview_chart_data``
    endpoint (``resolution=1D``), for ``[oldest_day 00:00 UTC, now]``.

    The LOWEST-precedence dense-daily mark fill (80-04). An INDEXED coin whose
    ``get_delivery_prices`` feed is SPARSE (SOL: 553 gappy dates across 2022-2026,
    absent through 2025-07/08) leaves the native roll's carry-forward / quiet-flow
    days unmarked, so the core refuses ``missing_daily_marks`` on days the coin
    genuinely carries value. This same-exchange, same-UTC-day close fills those
    days: it is a D-07-compliant same-time-basis mark (NOT a period-end/current
    price), and the DAILY close matches the daily boundary at which the native core
    marks NAV *and* flows (``native_nav.py`` values a flow as ``qty x mark(day)``),
    so no intraday basis mismatch is introduced. It NEVER wins over a real own-row
    ``index_price`` or a same-day ``delivery_price`` (the callers union it beneath
    both), so a currency whose delivery feed is already dense-daily (BTC/ETH) is
    byte-identically unaffected (SC-4).

    Read-error discipline mirrors :func:`fetch_deribit_settlement_index`: a TRANSIENT
    read (``ccxt.NetworkError``) is retried with exponential backoff and, on
    ``max_retries`` exhaustion, RAISES ``DeribitTransientReadError`` (retryable) —
    NEVER a silently-partial map. A GENUINE benign no-data (the exchange RESPONDED —
    e.g. ``BadSymbol`` for a coin with no USDC perp, or ``status != "ok"``) returns
    ``{}`` so the honest union + the core's fail-loud refusal handle a real gap. A
    1D series spans at most a few thousand points, so ONE request suffices (no
    pagination). Every ccxt error is scrubbed before logging.
    """
    instrument = f"{currency.upper()}{_PERP_DAILY_INSTRUMENT_SUFFIX}"
    start_ms = int(pd.Timestamp(oldest_day, tz="UTC").timestamp() * 1000)
    end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    params: dict[str, Any] = {
        "instrument_name": instrument,
        "start_timestamp": start_ms,
        "end_timestamp": end_ms,
        "resolution": _PERP_DAILY_RESOLUTION,
    }
    retries = 0
    while True:
        try:
            resp = await exchange.public_get_get_tradingview_chart_data(params)
            break
        except Exception as exc:  # noqa: BLE001
            if _is_transient_read_error(exc):
                retries += 1
                if retries > max_retries:
                    raise DeribitTransientReadError(
                        "deribit get_tradingview_chart_data transient read budget "
                        f"({max_retries}) exhausted for instrument={instrument} — "
                        "refusing a silently-partial daily-mark map (retryable)"
                    ) from None
                await sleep(PUBLIC_READ_BACKOFF_BASE_SECONDS * (2 ** (retries - 1)))
                continue
            logger.warning(
                "deribit get_tradingview_chart_data structural no-data for "
                "instrument=%s (%s); returning no daily marks",
                instrument,
                scrub_freeform_string(str(exc)),
            )
            return {}
    result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
    if not isinstance(result, Mapping) or result.get("status") != "ok":
        return {}
    ticks = result.get("ticks", [])
    close = result.get("close", [])
    if (
        not isinstance(ticks, Sequence)
        or isinstance(ticks, (str, bytes))
        or not isinstance(close, Sequence)
        or isinstance(close, (str, bytes))
        or len(ticks) != len(close)
    ):
        return {}
    prices: dict[str, float] = {}
    for raw_ts, raw_price in zip(ticks, close):
        try:
            ts_ms = int(raw_ts)
            price = float(raw_price)
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue
        day = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime(
            "%Y-%m-%d"
        )
        # One 1D bar per UTC day; setdefault keeps the FIRST (defensive vs a dupe).
        prices.setdefault(day, price)
    return prices


async def fetch_deribit_option_daily_marks(
    exchange: Any,
    instrument: str,
    *,
    oldest_day: str,
    newest_day: str,
    sleep: SleepFn = asyncio.sleep,
    max_retries: int = PUBLIC_READ_MAX_RETRIES,
) -> dict[str, float]:
    """Per-UTC-day mark for a single OPTION ``instrument`` from the DAILY CLOSE of
    Deribit's public ``get_tradingview_chart_data`` endpoint (``resolution=1D``),
    for ``[oldest_day 00:00 UTC, newest_day 24:00 UTC]``.

    Greenfield clone of :func:`fetch_deribit_perp_daily_index` (same public
    endpoint, same tick→UTC-day dedupe, same read-error discipline) with two
    deliberate differences for the daily-option-MTM (``smoothed_mtm``) basis:

    * The ``instrument`` name is taken VERBATIM — no suffix synthesis. Callers pass
      the exact expired-option instrument (e.g. ``BTC-27JUN25-100000-C``), the
      1D-chart source PROVEN to serve daily closes for long-expired options
      (Phase 131 probe: 4 expired BTC options, status=ok, 401 daily bars each).
    * An EXPLICIT ``newest_day`` caps the fetched span at the instrument's
      expiry — never fetch past expiry (a position cannot outlive its expiry, and
      the source only lists a bar within the instrument's life).

    This function stays an HONEST fetch, exactly like its sibling: a TRANSIENT read
    is retried with exponential backoff and RAISES ``DeribitTransientReadError`` on
    ``max_retries`` exhaustion (retryable) — NEVER a silently-partial map; a GENUINE
    benign no-data (the exchange RESPONDED — ``BadSymbol`` or ``status != "ok"``)
    returns ``{}``. The STRUCTURAL-gap / fail-loud decision (a hole inside a listed
    instrument's held life → ``LedgerValuationError``) belongs to the CALLER
    (``option_mtm_daily`` in ``deribit_txn.py``), not to this fetch. A 1D series
    spans at most a few thousand points, so ONE request suffices (no pagination).
    Every ccxt error is scrubbed before logging.
    """
    start_ms = int(pd.Timestamp(oldest_day, tz="UTC").timestamp() * 1000)
    # CR-01: Deribit stamps 1D bars at 08:00 UTC (M7 evidence: bar_stamp_utc
    # 08:00), so ``newest_day``'s OWN bar lives at ``newest_day 08:00`` — PAST a
    # midnight end bound. End at ``newest_day + 24h`` so the newest needed bar is
    # always covered (the sibling perp fetcher achieves the same by ending at
    # ``now()``); the NEXT day's 08:00 bar stays excluded, so the expiry cap is
    # preserved. With the old ``newest_day 00:00`` bound a single open position
    # (window ``[T, T]``) returned ZERO bars and the D-07 hole guard hard-failed
    # a perfectly healthy account.
    end_ms = (
        int(pd.Timestamp(newest_day, tz="UTC").timestamp() * 1000)
        + 24 * 3600 * 1000
    )
    params: dict[str, Any] = {
        "instrument_name": instrument,
        "start_timestamp": start_ms,
        "end_timestamp": end_ms,
        "resolution": _PERP_DAILY_RESOLUTION,
    }
    retries = 0
    while True:
        try:
            resp = await exchange.public_get_get_tradingview_chart_data(params)
            break
        except Exception as exc:  # noqa: BLE001
            if _is_transient_read_error(exc):
                retries += 1
                if retries > max_retries:
                    raise DeribitTransientReadError(
                        "deribit get_tradingview_chart_data transient read budget "
                        f"({max_retries}) exhausted for instrument={instrument} — "
                        "refusing a silently-partial daily-mark map (retryable)"
                    ) from None
                await sleep(PUBLIC_READ_BACKOFF_BASE_SECONDS * (2 ** (retries - 1)))
                continue
            logger.warning(
                "deribit get_tradingview_chart_data structural no-data for "
                "instrument=%s (%s); returning no daily marks",
                instrument,
                scrub_freeform_string(str(exc)),
            )
            return {}
    result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
    if not isinstance(result, Mapping) or result.get("status") != "ok":
        return {}
    ticks = result.get("ticks", [])
    close = result.get("close", [])
    if (
        not isinstance(ticks, Sequence)
        or isinstance(ticks, (str, bytes))
        or not isinstance(close, Sequence)
        or isinstance(close, (str, bytes))
        or len(ticks) != len(close)
    ):
        return {}
    marks: dict[str, float] = {}
    for raw_ts, raw_price in zip(ticks, close):
        try:
            ts_ms = int(raw_ts)
            price = float(raw_price)
        except (TypeError, ValueError):
            continue
        # WR-04: unlike the perp-INDEX sibling (where a non-positive price is
        # nonsense), a 0.0 daily close on a deep-OTM option near expiry is
        # economically LEGITIMATE — dropping it would delete the day from the
        # marks map and the D-07 hole guard would hard-fail a held worthless
        # position with a misleading "missing bar" message. Keep 0.0 (the
        # premium collapse is real ΔMTM); only a NEGATIVE close (impossible for
        # an option price) is dropped.
        if price < 0:
            continue
        day = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime(
            "%Y-%m-%d"
        )
        # One 1D bar per UTC day; setdefault keeps the FIRST (defensive vs a dupe).
        marks.setdefault(day, price)
    return marks


def _price_map_has_gap(
    price_map: Mapping[str, float], oldest_day: str, newest_day: str
) -> bool:
    """Does ``price_map`` fail to cover EVERY calendar day in the REQUIRED span
    ``[oldest_day, newest_day]`` — i.e. is it sparse (SOL) rather than dense-daily
    (BTC/ETH)? Empty, not reaching back to ``oldest_day``, not reaching up to
    ``newest_day``, or holed anywhere between all count as a gap. The span is the
    currency's own activity range (oldest activity day → newest day it can be
    required, i.e. its last ledger day, or today if a nonzero terminal balance
    carries forward), NOT ``[min(map), max(map)]`` — a single delivery day at the
    span start has no INTERNAL gap yet leaves every later carry-forward day
    unmarked. Used to decide whether the ``{ccy}_USDC-PERPETUAL`` daily-close fill
    is needed, so a dense-delivery coin (BTC/ETH) triggers NO perp fetch (SC-4)."""
    if not price_map:
        return True
    days = sorted(price_map)
    if days[0] > oldest_day or days[-1] < newest_day:
        return True  # doesn't span the full required range
    for day in pd.date_range(oldest_day, newest_day, freq="D"):
        if day.strftime("%Y-%m-%d") not in price_map:
            return True
    return False


# ---------------------------------------------------------------------------
# The scope×currency producer + the re-anchored D-02 completeness gate.
# ---------------------------------------------------------------------------


@dataclass
class CompletenessReport:
    """Per (scope, currency) crawl status over the date range.

    ``expected`` maps each enumerated scope label → its enumerated currencies
    (the full coverage the crawl OWES). ``entries`` maps (scope, currency) →
    ``{reached_end, rows, error?}`` recorded by the crawl. The gate compares the
    two: a scope that was expected but never crawled (dropped loop) leaves its
    ``expected`` pairs without a ``reached_end=True`` entry and the gate raises.

    ``dated_external_flows`` is the honest per-UTC-day ``list[ExternalFlow]`` of
    every external-flow row (transfer/deposit/withdrawal/reward) valued at its
    event-time USD (linear pass-through; inverse coin × same-day settlement index)
    via ``deribit_dated_external_flows_usd`` — the ONE honest valuation path. It
    feeds ONLY the NAV/TWR core's ``F_t`` term (never the realized sum, from which
    ``_EXTERNAL_FLOW_TYPES`` are structurally excluded → count-once), replacing the
    retired net-scalar anchor correction (F1). A withdrawal is NEGATIVE, a deposit
    POSITIVE; an unvaluable inverse flow FAILS LOUD (LedgerValuationError) rather
    than being silently degraded to heuristic capital.
    ``total_return_rows`` is the count of return-bearing rows across the crawl —
    used for the equity-vs-activity floor (C2: material equity + zero rows is a
    silently-empty green ledger).
    """

    expected: dict[str, list[str]] = field(default_factory=dict)
    entries: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    dated_external_flows: list[ExternalFlow] = field(default_factory=list)
    total_return_rows: int = 0
    # The per-job ``indexable_currencies`` set resolved ONCE by the crawl
    # (``build_deribit_indexable_currencies``): the static floor ∪ every
    # enumerated non-USD-family currency whose ``{ccy}_usd`` index resolves. It is
    # threaded here (a crawl artifact, exactly like ``dated_external_flows`` /
    # ``total_return_rows``) so the native job path (80-03) can pass the EXACT set
    # the ledger's marks were built against to ``reconstruct_native_nav_and_twr``,
    # never re-probing (which could drift and mis-classify a currency).
    indexable_currencies: frozenset[str] = field(default_factory=frozenset)
    # Phase 82 (MARK_TO_MARKET basis only) — sorted-unique ``(currency, utc_day)``
    # buckets carrying option rows OUTSIDE their currency's summary coverage window
    # (pre-rollout / trailing-edge cash fallback). A crawl artifact (like
    # ``dated_external_flows``) computed in ``build_deribit_native_ledger`` from the
    # raw rows; the worker stamps it as the ``pre_summary_rollout_option_dailies``
    # warning (Q6). Empty for perp-only / fully-covered accounts — and ALWAYS empty
    # under CASH_SETTLEMENT (the DEFAULT / shipped basis), where there is no summary
    # channel and no "pre-coverage fallback" (every option row books its raw cash
    # ``change`` by design), so the adapter suppresses this list entirely.
    pre_coverage_option_days: list[tuple[str, str]] = field(default_factory=list)
    # Phase 131 (SMOOTHED_MTM basis only) — sorted-unique ``(currency, utc_day)``
    # buckets for option instruments whose ENTIRE listed life predates the venue's
    # ~2.5yr 1D-chart retention horizon (wholly-empty marks response AND expiry
    # older than the horizon). Those instruments contribute NO daily ΔMTM (their
    # days stay cash-basis ``change``); the worker stamps this as the
    # ``pre_mark_retention_option_dailies`` warning (complete_with_warnings) in
    # 131-02. A crawl artifact computed in ``build_deribit_native_ledger`` from the
    # raw rows + the per-instrument marks probe. Empty for perp-only / fully-marked
    # accounts — and ALWAYS empty under cash_settlement / mark_to_market (no ΔMTM
    # channel, so no retention partition), keeping those bases byte-identical
    # (SC-4). A retention-STRADDLING instrument (partial marks) is NEVER bucketed
    # here — its head hole fails the ledger build loud (the D-07 consequence).
    pre_mark_retention_option_days: list[tuple[str, str]] = field(
        default_factory=list
    )
    # CR-01 — sorted currencies EXEMPTED from the strict balance-identity guard
    # because their option book is provably OPEN at crawl (nonzero
    # ``native_options_value``) or has trailing option activity past the last
    # summary. Surfaced for logs / the acceptance harness ONLY; an open book is the
    # normal state (§5 ``_assert_inception_reconciled`` is the authoritative
    # reconciliation), so this is NOT a warning and never promotes the status.
    balance_identity_open_option_ccys: list[str] = field(default_factory=list)
    # Phase 86 (COMP-04) — the MTM-gate signal consumed by
    # ``services.stitch_composite.mark_to_market_available`` (threaded per member
    # by ``run_stitch_composite_job``). True iff the crawl's RAW rows carry option
    # evidence — a ``options_settlement_summary``-typed row (deribit_txn.py:603, the
    # MTM channel) OR an option-instrument row (``-C``/``-P``). Read from RAW rows,
    # NOT the basis-dependent classification, so an un-smoothed options book is
    # detected under CASH_SETTLEMENT too (summary rows may be ABSENT pre-rollout /
    # on the cash basis — the instrument-name fallback covers that case). Default
    # False (perp-only / USD-native) — additive, no existing constructor changes.
    has_option_activity: bool = False


def deribit_raw_rows_have_option_activity(
    raw_rows: Sequence[Mapping[str, Any]],
) -> bool:
    """True iff ANY raw crawl row is option-book evidence: a
    ``options_settlement_summary``-typed row (the MTM channel — present only under
    MARK_TO_MARKET / post-rollout) OR an option-instrument row (``-C``/``-P``,
    the cash-basis fallback since summary rows may be absent). Basis-agnostic — it
    reads the BOOK, never the accrual classification (deribit_txn.py:603). Pure /
    never raises on untrusted exchange input (T-70-05): a non-Mapping row is
    skipped and ``classify_instrument`` never raises."""
    for row in raw_rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) in _NATIVE_OPTIONS_SUMMARY_TYPES:
            return True
        if classify_instrument(str(row.get("instrument_name", ""))) == "option":
            return True
    return False


def _now_ms() -> int:
    return int(time.time() * 1000)


async def build_deribit_indexable_currencies(
    exchange: Any,
    currencies: Sequence[str],
    *,
    static_floor: AbstractSet[str] = _INVERSE_CURRENCIES,
    sleep: SleepFn = asyncio.sleep,
    max_retries: int = PUBLIC_READ_MAX_RETRIES,
) -> frozenset[str]:
    """The real per-job ``indexable_currencies`` set (contract §7.2): the static
    floor UNIONED with every enumerated non-USD-family currency whose ``{ccy}_usd``
    index resolves finite-positive on ``public/get_index_price``.

    The floor (``_INVERSE_CURRENCIES`` = BTC/ETH) is the degraded-mode default —
    currencies known-resolvable WITHOUT a probe — NEVER the ceiling. SOL is
    indexable because ``sol_usd`` resolves; a tokenized-fund wallet (BUIDL/USYC)
    is NOT because its probe raises / has no index, so it keeps failing loud at the
    census consumers (§7.2 branch-3 by construction). This heals the key-1 SOL
    crash on the existing USD-space path (79-CONTEXT G6, revised).

    Probe discipline (mirrors the verbatim shape at the equity anchor's
    ``public_get_get_index_price`` read): USD-family AND static-floor members are
    NEVER probed (BTC/ETH are members by the floor; USDC/USDT are linear), each
    remaining currency is probed AT MOST ONCE (per-job cache, the
    ``settlement_index_cache`` discipline), an unresolvable/raising probe or a
    non-finite/≤0 ``index_price`` leaves the currency OUT. A raised ccxt error is
    scrubbed before logging (leak discipline, ``scrub_freeform_string``).
    """
    probed: set[str] = set()
    seen: set[str] = set()  # per-job: probe each currency at most once
    for currency in currencies:
        ccy = str(currency).upper()
        # USD-family are linear (never index-multiplied); static-floor members are
        # already indexable by definition — neither is ever probed. `seen` makes a
        # duplicated universe entry cost at most one probe.
        if ccy in USD_FAMILY or ccy in static_floor or ccy in seen:
            continue
        seen.add(ccy)
        # A TRANSIENT probe (network/timeout/5xx → ccxt.NetworkError) is RETRYABLE:
        # retry with backoff, then RAISE DeribitTransientReadError on exhaustion —
        # NEVER silently drop a possibly-INDEXED currency to UNMARKABLE (a real
        # INDEXED coin mis-classified UNMARKABLE → permanent core refuse on a mere
        # blip). A GENUINE "index not found" (ExchangeError/BadSymbol — the exchange
        # RESPONDED) leaves the currency OUT (genuinely not indexable), as before.
        retries = 0
        resp: Any = None
        while True:
            try:
                resp = await exchange.public_get_get_index_price(
                    {"index_name": f"{ccy.lower()}_usd"}
                )
                break
            except Exception as exc:  # noqa: BLE001
                if _is_transient_read_error(exc):
                    retries += 1
                    if retries > max_retries:
                        raise DeribitTransientReadError(
                            "deribit get_index_price transient probe budget "
                            f"({max_retries}) exhausted for "
                            f"index_name={ccy.lower()}_usd — refusing to drop a "
                            "possibly-indexed currency to UNMARKABLE (retryable)"
                        ) from None
                    await sleep(
                        PUBLIC_READ_BACKOFF_BASE_SECONDS * (2 ** (retries - 1))
                    )
                    continue
                logger.debug(
                    "deribit indexable probe: %s_usd unresolved (%s)",
                    ccy.lower(),
                    scrub_freeform_string(str(exc)),
                )
                resp = None
                break
        if resp is None:
            continue
        result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
        raw = result.get("index_price") if isinstance(result, Mapping) else None
        if raw is None:
            continue
        try:
            price = float(raw)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(price) or price <= 0:
            continue
        probed.add(ccy)
    return frozenset(static_floor | probed)


async def _crawl_deribit_ledger(
    exchange: Any,
    since_ms: int | None = None,
    *,
    sleep: SleepFn = asyncio.sleep,
) -> tuple[
    list[dict[str, Any]],
    list[Mapping[str, Any]],
    frozenset[str],
    CompletenessReport,
]:
    """Crawl the txn-log ledger across every scope × currency ONCE, returning
    ``(daily_records, raw_rows, indexable, report)``.

    This is the SHARED crawl both the USD-space
    :func:`fetch_deribit_ledger_daily_records` (which discards ``raw_rows`` /
    ``indexable``) and the native-unit :func:`build_deribit_native_ledger` (which
    reads ``raw_rows`` for ``txn_rows_to_native_daily`` + ``report`` for the
    4-field native flows + ``indexable`` for the marks planner) delegate to — so
    the completeness accounting and the per-job ``indexable`` build happen exactly
    ONCE, never duplicated. ``raw_rows`` is the flat concatenation of every
    (scope, currency) ``paginate_txn_log`` page batch (native pnl is an
    order-independent per-(day,ccy) sum, so flat concatenation is lossless).

    For each scope: resolve its auth (fail loud on an unresolvable scope) and
    enumerate its currencies from the account. Then crawl every (scope, currency)
    via ``paginate_txn_log``, feed the rows through ``txn_rows_to_daily_records``
    (70-02, the funding-inclusive single sum), and CONCATENATE every scope's
    records into ONE flat list — records are sign-encoded (``side`` = sign,
    ``price`` = abs USD), so abs-summing opposite-sign same-day scopes would net
    them WRONG (+100 and −30 → 130, not +70). ``trades_to_daily_returns_with_status``
    decodes side→sign and bucket-sums per UTC day, so concatenation preserves
    each record's signed contribution.

    Crawl outcomes recorded in the report:
      * success → ``reached_end=True``;
      * ``LedgerTruncatedError`` (10028 budget exhausted) → ``reached_end=False``
        (incomplete — the gate raises);
      * ``-32602`` (no wallet for this currency) → ``reached_end=True, rows=0``
        (complete-empty: the authoritative universe includes currencies this
        scope never funded; a currency WITH history returns rows, not -32602);
      * any other error → RE-RAISED (fail loud; never swallowed as a skip).

    The LIVE multi-year crawl over real creds is 70-05/live-gated; the producer
    LOGIC here is CI-provable via synthetic scope/currency stubs.
    """
    scopes = await enumerate_scopes(exchange)
    start_ms = since_ms if since_ms is not None else DEFAULT_START_MS
    end_ms = _now_ms()

    # Pass 1 — the AUTHORITATIVE OWED coverage: the balance-independent public
    # currency universe (enumerated ONCE — account-wide) crawled across EVERY
    # enumerated scope. Both enumerations fail loud, so `expected` can never be a
    # silently-truncated set the gate would then be blind to.
    currencies = await enumerate_currencies(exchange, scopes[0], {})
    # Build the REAL indexable set ONCE per job (79-CONTEXT G6, revised): the
    # static floor ∪ every enumerated currency whose {ccy}_usd index resolves. This
    # is threaded live into the :636 supplemental-index gate AND every downstream
    # census consumer (inverse_days_needing_index / txn_rows_to_daily_records /
    # deribit_dated_external_flows_usd) so SOL heals on the existing USD-space path
    # — records returned, no LedgerValuationError — while an un-indexable currency
    # (BUIDL / an unresolvable probe) still refuses loudly. Once-per-job, mirroring
    # the settlement_index_cache discipline below.
    indexable = await build_deribit_indexable_currencies(
        exchange, currencies, static_floor=_INVERSE_CURRENCIES, sleep=sleep
    )
    expected: dict[str, list[str]] = {}
    scope_auths: dict[str, dict[str, Any]] = {}
    for scope in scopes:
        auth = await resolve_scope_auth(exchange, scope)
        scope_auths[scope.label] = auth
        expected[scope.label] = list(currencies)

    # Pass 2 — crawl every OWED (scope, currency), concatenating the records.
    daily_records: list[dict[str, Any]] = []
    raw_rows_all: list[Mapping[str, Any]] = []
    entries: dict[tuple[str, str], dict[str, Any]] = {}
    dated_external_flows: list[ExternalFlow] = []
    total_return_rows = 0
    # Per-currency same-day settlement-index cache (fetched ONCE per inverse
    # currency, reused across every scope) — public/get_delivery_prices is
    # account-wide, so multiple scopes share the same {date: price} map.
    settlement_index_cache: dict[str, dict[str, float]] = {}
    # 80-04: per-currency {ccy}_USDC-PERPETUAL daily-close cache, the lowest-
    # precedence fill for needed days a SPARSE delivery feed (SOL) can't cover.
    perp_daily_cache: dict[str, dict[str, float]] = {}
    for scope in scopes:
        auth = scope_auths[scope.label]
        for currency in expected[scope.label]:
            key = (scope.label, currency)
            try:
                rows = await paginate_txn_log(
                    exchange,
                    scope.label,
                    currency,
                    start_ms,
                    end_ms,
                    auth,
                    sleep=sleep,
                )
            except LedgerTruncatedError as exc:
                entries[key] = {
                    "reached_end": False,
                    "rows": 0,
                    "error": str(scrub_freeform_string(str(exc))),
                }
                continue
            # Any other error propagates → fail loud (never a silent skip). A
            # first-page -32602 "no wallet" is absorbed INSIDE paginate_txn_log
            # (returns [] → recorded complete-empty below); a -32602 AFTER rows
            # were fetched escapes here and fails loud (F-3: never drop real rows).
            #
            # P72: an INVERSE (coin-margined) currency may carry a quiet-day cash
            # row (e.g. a negative_balance_fee) on a day with no OWN same-day
            # index — supply the SAME-DAY settlement index (public/get_delivery_
            # prices) so it values D-07-compliantly instead of failing loud. Fetch
            # ONCE per currency (cached across scopes) and only when such days
            # exist; own-row/ledger index always wins inside the aggregator.
            supplemental: dict[tuple[str, str], float] | None = None
            ccy_upper = currency.upper()
            if ccy_upper in indexable:
                needed = {
                    (d, c)
                    for (d, c) in inverse_days_needing_index(
                        rows, indexable_currencies=indexable
                    )
                    if c == ccy_upper
                }
                if needed:
                    needed_min = min(d for (d, _c) in needed)
                    # (Re)fetch when the cache is absent, empty, or too SHALLOW for
                    # this scope's oldest needed day. A later multi-subaccount scope
                    # needing an OLDER quiet day than the first scope's anchor must
                    # not get a too-shallow cache hit → its row would fail loud even
                    # though the settlement history exists (M1 latent trap). A too-
                    # shallow map is replaced by a deeper fetch from offset 0 (cheap);
                    # the `not cached` guard keeps min({}) from ever running. The
                    # cache is keyed by the UPPERCASED currency (FIX 3) so a lowercase
                    # code can never cause a miss / duplicate fetch.
                    cached = settlement_index_cache.get(ccy_upper)
                    if cached is None or not cached or min(cached) > needed_min:
                        settlement_index_cache[ccy_upper] = (
                            await fetch_deribit_settlement_index(
                                exchange,
                                currency,
                                oldest_day=needed_min,
                                sleep=sleep,
                            )
                        )
                    price_map = settlement_index_cache[ccy_upper]
                    supplemental = {
                        (d, c): price_map[d]
                        for (d, c) in needed
                        if d in price_map
                    }
                    # 80-04 sparse-delivery fill: needed quiet-day rows whose day the
                    # delivery feed lacks (SOL — sparse/absent through the flow days)
                    # value against the {ccy}_USDC-PERPETUAL DAILY CLOSE instead of
                    # failing loud. LOWEST precedence: only days STILL uncovered by
                    # own-row (wins in the aggregator) and delivery (placed above) are
                    # filled, so a dense-delivery coin (BTC/ETH) never enters here and
                    # stays byte-identical (SC-4). Fetched ONCE per currency, cached
                    # across scopes; keyed by UPPERCASED currency (mirrors delivery).
                    still_needed = {
                        (d, c) for (d, c) in needed if (d, c) not in supplemental
                    }
                    if still_needed:
                        still_min = min(d for (d, _c) in still_needed)
                        perp_cached = perp_daily_cache.get(ccy_upper)
                        if (
                            perp_cached is None
                            or not perp_cached
                            or min(perp_cached) > still_min
                        ):
                            perp_daily_cache[ccy_upper] = (
                                await fetch_deribit_perp_daily_index(
                                    exchange,
                                    currency,
                                    oldest_day=still_min,
                                    sleep=sleep,
                                )
                            )
                        perp_map = perp_daily_cache[ccy_upper]
                        for (d, c) in still_needed:
                            if d in perp_map:
                                supplemental[(d, c)] = perp_map[d]
            records = txn_rows_to_daily_records(
                rows,
                supplemental_index=supplemental,
                indexable_currencies=indexable,
            )
            daily_records.extend(records)
            # Retain the RAW rows (flat) for the native-unit adapter's
            # txn_rows_to_native_daily — a per-(day,ccy) sum that is order- and
            # batch-independent, so flat concatenation across scopes is lossless.
            raw_rows_all.extend(r for r in rows if isinstance(r, Mapping))
            # Accumulate the honest DATED external flows (for the core's F_t term)
            # and the return-bearing row count (for the C2 equity-vs-activity floor).
            # The SAME `supplemental` settlement-index map built for
            # txn_rows_to_daily_records feeds the dated producer — the 75-02 Finding
            # C1 extension of inverse_days_needing_index already widened it to cover
            # inverse external-flow quiet days, so a quiet-day coin withdrawal values
            # against its same-day index instead of failing the whole job. Flow rows
            # are _EXTERNAL_FLOW_TYPES (⊆ INFORMATIONAL_TYPES), so they are excluded
            # from the realized `records` above — count-once by construction.
            dated_external_flows.extend(
                deribit_dated_external_flows_usd(
                    rows,
                    supplemental_index=supplemental,
                    indexable_currencies=indexable,
                )
            )
            # Cash-bearing membership (incl. the Phase 128 trading-reason
            # `correction`, which counts toward the C2 equity-vs-activity floor) is
            # the SINGLE source of truth in `_row_is_cash_bearing` — call it rather
            # than re-deriving the predicate here, so this floor count can never
            # drift out of sync with the USD aggregator that backs it (IN-02).
            total_return_rows += sum(
                1 for r in rows if isinstance(r, Mapping) and _row_is_cash_bearing(r)
            )
            # An empty crawl (no-wallet currency) is legitimately complete-empty.
            entries[key] = {
                "reached_end": True,
                "rows": len(rows),
                **({"note": "no wallet for currency"} if not rows else {}),
            }

    return daily_records, raw_rows_all, indexable, CompletenessReport(
        expected=expected,
        entries=entries,
        dated_external_flows=dated_external_flows,
        total_return_rows=total_return_rows,
        indexable_currencies=indexable,
    )


async def fetch_deribit_ledger_daily_records(
    exchange: Any,
    since_ms: int | None = None,
    *,
    sleep: SleepFn = asyncio.sleep,
) -> tuple[list[dict[str, Any]], CompletenessReport]:
    """Crawl the txn-log ledger across every scope × currency and return the
    accumulated funding-inclusive ``daily_pnl`` records plus a
    ``CompletenessReport`` (the USD-space entry point — byte-identical to the
    pre-80-02 behaviour). Thin delegate to :func:`_crawl_deribit_ledger`, which is
    now shared with the native-unit adapter; the raw rows + indexable set the
    native path needs are discarded here.
    """
    daily_records, _raw_rows, _indexable, report = await _crawl_deribit_ledger(
        exchange, since_ms, sleep=sleep
    )
    return daily_records, report


def _combined_session_upl(summ: Mapping[str, Any]) -> tuple[float, bool, bool]:
    """The COMBINED per-currency session open-uPnL wedge for one account-summary
    entry: futures + options session unrealized (§2 Q5, Task 2b).

    Deribit structures the legacy ``session_upl`` as FUTURES-only; an open options
    book's session unrealized lives in ``options_session_upl``. Reading only
    ``session_upl`` (the pre-fix behaviour) drops the options component, so an
    open-options-book anchor would structurally breach the §5 inception gate
    (``terminal_native − upnl`` = equity − wedge must be settled-equity, and the
    equity INCLUDES the option book's mark; the wedge must therefore include the
    option book's session move).

    Read defensively so the wedge captures BOTH channels for an open options book
    while staying BYTE-IDENTICAL for perp-only accounts:
      * futures/base component — an explicit ``futures_session_upl`` is preferred,
        else the legacy ``session_upl`` (consulting exactly ONE so a layout that
        carries both, equal, never double-counts);
      * options component — ``options_session_upl``, additive when present
        (ABSENT on perp-only summaries → 0.0 → wedge value unchanged → SC-4).

    Returns ``(combined_upl, read_any, component_unreadable)`` where ``read_any`` is
    True iff AT LEAST ONE component read as a present numeric (the MUST-2 unreadable
    signal: a wholly absent/garbled wedge is 'unreadable', a genuine flat 0.0 is
    'read'). Absent / null / non-numeric components coerce to 0.0 each — never
    fabricated (T-77-05).

    F1 (specialist-silentfailure HIGH): ``read_any`` is a single OR-accumulator
    across BOTH legs, so on an OPEN option book a readable futures leg would MASK
    an absent/garbled options wedge (silently coercing the options component to
    0.0 with no signal). ``options_unreadable`` is tracked PER COMPONENT: True iff
    this summary shows an OPEN option book (``options_value != 0.0``) yet the
    ``options_session_upl`` component was absent / non-numeric. The caller lifts it
    into ``unrealized_pnl_unreadable`` (→ ``complete_with_warnings``) so a
    renamed/garbled options wedge field is LOUD, never a silent 0-wedge
    overstatement on an account that actually holds open options.

    F3 (regression from the F1 fix — SYMMETRIC futures leg): the F1 fix added the
    PER-COMPONENT unreadable signal for the OPTIONS leg only. A GARBLED
    (present-but-non-numeric) futures ``session_upl`` / ``futures_session_upl``
    hits the ``except (TypeError, ValueError)`` below, contributing 0.0 with the
    futures leg NOT read; a readable ``options_session_upl`` then set
    ``read_any=True`` and the account-level unreadable signal never fired — a
    silently-zeroed FUTURES wedge shipped clean (pre-F1 the single ``read_any``
    flagged it). ``futures_unreadable`` distinguishes GARBLED (schema drift →
    unreadable) from ABSENT (benign → 0.0) for the futures leg too. The third
    return element is the COMBINED component-unreadable flag
    (``options_unreadable or futures_unreadable``): a garbled value in EITHER leg
    raises it, and the caller lifts it into ``unrealized_pnl_unreadable``. The
    wedge VALUE is unchanged (still 0.0 for a garbled/absent field — never
    fabricated); a clean perp-only account (numeric or absent ``session_upl``, no
    ``options_value``) stays byte-identical — no new flag, no value change (SC-4).

    NOTE (§6 live-anchor follow-up): the exact field layout of
    ``get_account_summaries`` for an OPEN options book is not verifiable at the
    probe account's flat terminal (``session_upl == 0``); this defensive combined
    read is implemented now so an open-book anchor does not structurally breach
    the gate, and the first live open-options anchor is watched at §5 (a breach
    there is a loud stop, never a silent 0-wedge overstatement)."""
    read_any = False
    total = 0.0
    futures_unreadable = False
    # Futures/base component — the preferred ``futures_session_upl`` else the
    # legacy ``session_upl`` (exactly one SUCCESSFUL read consulted so a layout
    # carrying both, equal, never double-counts). F2: a PRESENT-but-null preferred
    # field is NOT a read — fall through (``continue``) to the next spelling rather
    # than break on mere key presence (which silently dropped a real fallback
    # value). Break only after a successful numeric read, or on a genuine
    # non-numeric (a garbled value is its own signal, not an 'absent' field).
    for key in ("futures_session_upl", "session_upl"):
        if key not in summ:
            continue
        raw = summ.get(key)
        if raw is None:
            continue  # present-but-null → consult the next spelling (F2)
        try:
            total += float(raw)
            read_any = True
            break  # successful numeric read — stop (never double-count spellings)
        except (TypeError, ValueError):
            # F3: a GARBLED (present-but-non-numeric) futures wedge is schema drift,
            # SYMMETRIC to the options leg — surface it as unreadable rather than
            # silently coercing to a 0.0 wedge with no signal (a readable options
            # leg would otherwise mask it). 0.0 contribution (never fabricate); stop
            # (a garbled value is its own signal, not an 'absent' field — an ABSENT
            # field never reaches here, so it stays benign).
            futures_unreadable = True
            break
    # Options component (new) — additive when present. Track its OWN readability
    # (F1) so a readable futures leg cannot mask a missing options wedge.
    options_read = False
    raw_opt = summ.get("options_session_upl")
    if raw_opt is not None:
        try:
            total += float(raw_opt)
            read_any = True
            options_read = True
        except (TypeError, ValueError):
            pass  # non-numeric → 0.0 contribution (never fabricate)
    # F1: an OPEN option book (options_value != 0) whose options wedge component
    # was absent/non-numeric is UNREADABLE — surfaced so the futures leg does NOT
    # suppress the options-leg unreadable signal.
    try:
        opt_value = float(summ.get("options_value", 0.0) or 0.0)
    except (TypeError, ValueError):
        opt_value = 0.0
    options_unreadable = (opt_value != 0.0) and not options_read
    # F1 + F3: the COMBINED component-unreadable flag — a garbled value in EITHER
    # the options leg (open book, absent/garbled wedge) OR the futures leg (garbled
    # present-but-non-numeric wedge) raises it. The caller lifts it into
    # ``unrealized_pnl_unreadable`` (→ ``complete_with_warnings``).
    return total, read_any, (options_unreadable or futures_unreadable)


def _deribit_session_upl_to_usd(
    summaries: Sequence[Any],
    index_prices: Mapping[str, float],
) -> tuple[float, bool]:
    """Sum the per-currency Deribit session open-uPnL wedge into USD, reusing
    the EXACT conversion rule of ``deribit_equity_to_usd``.

    [ASSUMED A1]: ``session_upl`` is the Deribit account-summary open-unrealized
    component (the session unrealized PnL). An absent / null / non-numeric field
    coerces to a 0.0 contribution — NEVER a fabricated value (T-77-05).
    USD-family currencies pass through as USD; a non-linear currency's coin uPnL
    is multiplied by its ``{ccy}_usd`` index.

    A non-linear currency carrying a wedge but no resolvable index contributes
    0.0 rather than raising — the equity anchor (computed FIRST) already fails
    loud for any held currency lacking an index, so this path is only reached
    for the warning-only wedge on a base the anchor already validated; refusing
    to fabricate a USD figure for an unvaluable wedge is the honest default.

    MUST-2 (specialist-silentfailure HIGH-1): returns ``(wedge_usd, unreadable)``.
    Because ``session_upl`` is an ``[ASSUMED A1]`` field NAME, a wrong/renamed
    field would be absent on EVERY summary and silently coalesce to a 0.0 wedge —
    indistinguishable from a genuinely flat book, disabling FLOW-04 for every
    Deribit account with no signal. ``unreadable`` is True when there WERE
    summaries to read but the field was present-and-numeric on NONE of them (a
    wrong field name or a fully-garbled response). A book that is genuinely flat
    reports ``session_upl == 0`` — a PRESENT numeric read — so ``unreadable`` is
    False and the account stays clean ``complete``. The caller raises
    ``unrealized_pnl_unreadable`` (→ ``complete_with_warnings``) so a wrong field
    name is LOUD, not a silent overstatement.
    """
    from services.deribit_txn import _LINEAR_CURRENCIES

    total = 0.0
    saw_summary = False
    read_any = False
    component_unreadable_any = False
    for summ in summaries:
        if not isinstance(summ, Mapping):
            continue
        ccy = str(summ.get("currency", "")).upper()
        if not ccy:
            continue
        saw_summary = True
        # Task 2b: COMBINED futures + options session uPnL (§2 Q5) — not the
        # futures-only legacy read. read_component is the MUST-2 unreadable signal
        # (True iff any wedge component was a present numeric, even a flat 0.0).
        # F1+F3: component_unreadable flags a garbled/absent wedge in EITHER leg —
        # an OPEN book's absent/garbled options wedge (F1) OR a garbled
        # present-but-non-numeric futures wedge (F3) — while the other leg read
        # (must not be masked).
        upl, read_component, component_unreadable = _combined_session_upl(summ)
        if read_component:
            read_any = True
        if component_unreadable:
            component_unreadable_any = True
        if upl == 0.0:
            continue
        if ccy in _LINEAR_CURRENCIES:
            total += upl  # already USD
            continue
        price = index_prices.get(ccy)
        if price is None:
            continue  # unvaluable wedge → 0.0 contribution (never fabricate)
        total += upl * float(price)
    # Unreadable when there were summaries yet not a single one carried a readable
    # session_upl (the wrong-field-name / garbled-response signal), OR (F1) an OPEN
    # option book carried a readable futures leg but an absent/garbled options
    # wedge, OR (F3) a readable options leg masked a GARBLED futures wedge — a
    # garbled/absent component in EITHER leg must not be suppressed by the other.
    return total, ((saw_summary and not read_any) or component_unreadable_any)


@dataclass(frozen=True)
class DeribitNativeAccountState:
    """The Deribit account anchor read in BOTH channels from ONE
    ``get_account_summaries`` response (D5):

      * ``native_equity`` / ``native_upnl`` — per-UPPERCASE-ccy NATIVE units
        (``equity`` / ``session_upl`` verbatim, NEVER index-multiplied); the
        additive channel the 79 native core consumes. ``session_upl`` absent /
        null / non-numeric coerces to ``0.0`` for that currency (never
        fabricated), matching ``_deribit_session_upl_to_usd``'s [ASSUMED A1].
      * ``collapsed_equity_usd`` / ``collapsed_upnl_usd`` + ``upnl_unreadable`` —
        the LEGACY collapsed USD anchor/wedge (``deribit_equity_to_usd`` /
        ``_deribit_session_upl_to_usd``), kept byte-identical for the 80-04 parity
        panel.
      * ``balance_error`` — the DQ flag: a failed/empty summaries read or an
        unvaluable held currency (``deribit_equity_to_usd`` raises).

    App A #6 (D6) holds BY CONSTRUCTION: an unvaluable coin ``session_upl`` is
    SILENTLY zeroed in ``collapsed_upnl_usd`` (the legacy path) but PRESERVED raw
    in ``native_upnl`` — the native core value-gate is what refuses it, not the
    adapter. A FAILED read yields EMPTY native maps; an unvaluable COLLAPSE keeps
    the (readable) native maps while flagging ``balance_error``.
    """

    native_equity: Mapping[str, float]
    native_upnl: Mapping[str, float]
    collapsed_equity_usd: float | None
    collapsed_upnl_usd: float
    balance_error: bool
    upnl_unreadable: bool
    # CR-01 — per-UPPERCASE-ccy ``options_value`` read off the SAME summaries
    # response (D5): the NATIVE-unit mark of the currency's OPEN option book. A
    # nonzero value proves the option book is OPEN at crawl, so the STRICT
    # balance-identity guard (which closes only for a FLAT-at-settlement book) is
    # exempted for that currency and the §5 inception gate becomes the
    # authoritative reconciliation. Absent on perp-only summaries → 0.0 (never
    # fabricated; SC-4 byte-safe). A failed/empty read yields an EMPTY map.
    native_options_value: Mapping[str, float]
    # Phase 131 (SMOOTHED_MTM book-channel cross-check) — per-UPPERCASE-ccy
    # ``options_session_upl`` read off the SAME summaries response (D5): the OPEN
    # option book's CURRENT-session unrealized P&L, in NATIVE units. The book-channel
    # guard reconciles the replayed settled book ``Book(last settlement)`` against the
    # anchor's SETTLED book = ``native_options_value[c] − native_options_session_upl[c]``
    # (the daily marks are 08:00-settlement closes, so they exclude the current
    # session's unrealized move — which lives here). Absent on perp-only summaries →
    # 0.0 (never fabricated; SC-4 byte-safe). Defaulted so every existing positional
    # constructor stays valid. A failed/empty read yields an EMPTY map (→ 0.0).
    native_options_session_upl: Mapping[str, float] = field(default_factory=dict)


async def fetch_deribit_native_account_state(
    exchange: Any,
    *,
    sleep: SleepFn = asyncio.sleep,
    max_retries: int = PUBLIC_READ_MAX_RETRIES,
) -> DeribitNativeAccountState:
    """Read the Deribit account anchor in native + collapsed channels from ONE
    ``get_account_summaries`` response (D5) — the SINGLE summaries fetch and the
    SINGLE code path both ``fetch_deribit_account_equity_and_upnl_usd`` (legacy
    4-tuple) and ``build_deribit_native_ledger`` (native maps) delegate to.

    The native maps are read STRAIGHT off each summary (``equity`` /
    ``session_upl``) in NATIVE units — no ``{ccy}_usd`` multiply. The collapsed
    anchor/wedge reuse the SAME resolved ``index_prices`` (one probe per held
    non-linear currency) so there is NO second fetch of anything. Read-error
    discipline (red-team LOW-1): a TRANSIENT collapsed-anchor probe blip
    (network/timeout/5xx → ``ccxt.NetworkError``) is RETRIED with backoff and, on
    ``max_retries`` exhaustion, raises ``DeribitTransientReadError`` (retryable) —
    it is NEVER swallowed into ``balance_error=True`` (which would let the caller
    proceed to a silent clean ``complete`` that skips the collapsed-anchor DQ
    checks). A GENUINE unvaluable collapse (a held coin whose ``{ccy}_usd`` index
    genuinely does not resolve) still flags ``balance_error`` honestly. Leak: no raw
    equity/upnl values are logged.
    """
    from services.deribit_txn import _LINEAR_CURRENCIES, deribit_equity_to_usd

    empty: dict[str, float] = {}
    try:
        resp = await exchange.private_get_get_account_summaries({})
    except Exception:  # noqa: BLE001 - a failed read is a DQ flag, not a crash
        return DeribitNativeAccountState(empty, {}, None, 0.0, True, False, {})
    result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
    summaries = result.get("summaries", []) if isinstance(result, Mapping) else []
    if not isinstance(summaries, Sequence) or not summaries:
        return DeribitNativeAccountState({}, {}, None, 0.0, True, False, {})

    # Native per-currency maps read from the SAME summaries (D5) — NEVER index-
    # multiplied. session_upl absent/null/non-numeric → 0.0 (never fabricated).
    native_equity: dict[str, float] = {}
    native_upnl: dict[str, float] = {}
    native_options_value: dict[str, float] = {}
    native_options_session_upl: dict[str, float] = {}
    for summ in summaries:
        if not isinstance(summ, Mapping):
            continue
        ccy = str(summ.get("currency", "")).upper()
        if not ccy:
            continue
        native_equity[ccy] = float(summ.get("equity", 0.0) or 0.0)
        # Task 2b: COMBINED futures + options session uPnL (§2 Q5), byte-safe for
        # perp-only (options component absent → 0.0 → unchanged value → SC-4).
        upl, _read, _component_unread = _combined_session_upl(summ)
        native_upnl[ccy] = upl
        # CR-01: the open-option-book mark read off the SAME response. Absent on
        # perp-only summaries → 0.0 (never fabricated; SC-4). A nonzero value
        # exempts this currency from the STRICT balance-identity guard (§5 becomes
        # authoritative on the open book).
        native_options_value[ccy] = float(summ.get("options_value", 0.0) or 0.0)
        # Phase 131: the options-only session uPnL, read STRAIGHT off the SAME
        # response (NOT the combined futures+options wedge above). Feeds the
        # SMOOTHED_MTM book-channel settled-book anchor decomposition. Absent →
        # 0.0 (never fabricated; SC-4 byte-safe).
        native_options_session_upl[ccy] = float(
            summ.get("options_session_upl", 0.0) or 0.0
        )

    # Resolve one {ccy}_usd index per held non-linear currency for the COLLAPSED
    # anchor/wedge only (the native maps above never touch these).
    index_prices: dict[str, float] = {}
    for summ in summaries:
        if not isinstance(summ, Mapping):
            continue
        ccy = str(summ.get("currency", "")).upper()
        if not ccy or ccy in _LINEAR_CURRENCIES:
            continue
        # LOW-1: a TRANSIENT collapsed-anchor probe blip (network/timeout/5xx →
        # ccxt.NetworkError) is RETRYABLE: retry with backoff, then RAISE
        # DeribitTransientReadError on exhaustion — NEVER silently swallow it into
        # balance_error=True and proceed to a silent clean 'complete' (skipping the
        # C2 / FLOW-04 / uPnL-unreadable DQ checks the caller gates on
        # ``not balance_error``, where the legacy path degraded to
        # complete_with_warnings). A retry likely restores the index → FULL DQ. A
        # GENUINE unvaluable collapse (the index genuinely does not resolve →
        # ExchangeError/BadSymbol) still ``continue``s → the wedge stays out and the
        # collapse below flags balance_error honestly (the core's structural refusal
        # handles it, never an infinite retry).
        retries = 0
        ip: Any = None
        while True:
            try:
                ip = await exchange.public_get_get_index_price(
                    {"index_name": f"{ccy.lower()}_usd"}
                )
                break
            except Exception as exc:  # noqa: BLE001
                if _is_transient_read_error(exc):
                    retries += 1
                    if retries > max_retries:
                        raise DeribitTransientReadError(
                            "deribit get_index_price transient collapsed-anchor "
                            f"probe budget ({max_retries}) exhausted for "
                            f"index_name={ccy.lower()}_usd — refusing a silent-clean "
                            "complete that would skip the collapsed-anchor DQ checks "
                            "(retryable)"
                        ) from None
                    await sleep(
                        PUBLIC_READ_BACKOFF_BASE_SECONDS * (2 ** (retries - 1))
                    )
                    continue
                # Genuine missing index → gate below flags balance_error honestly.
                ip = None
                break
        if ip is None:
            continue
        ipr = ip.get("result", {}) if isinstance(ip, Mapping) else {}
        price = ipr.get("index_price") if isinstance(ipr, Mapping) else None
        if price is not None:
            try:
                index_prices[ccy] = float(price)
            except (TypeError, ValueError):
                continue

    try:
        equity = deribit_equity_to_usd(summaries, index_prices)
    except ValueError:
        # A coin-margined currency with no resolvable USD index → refuse a
        # coin/non-USD collapsed anchor; flag heuristic capital rather than
        # mis-scale. The NATIVE maps stay (they need no index); the wedge inherits
        # the same fail-loud collapsed disposition (never fabricated).
        return DeribitNativeAccountState(
            native_equity, native_upnl, None, 0.0, True, False,
            native_options_value,
            native_options_session_upl,
        )
    open_unrealized_usd, upnl_unreadable = _deribit_session_upl_to_usd(
        summaries, index_prices
    )
    return DeribitNativeAccountState(
        native_equity,
        native_upnl,
        equity,
        open_unrealized_usd,
        False,
        upnl_unreadable,
        native_options_value,
        native_options_session_upl,
    )


async def fetch_deribit_account_equity_and_upnl_usd(
    exchange: Any,
) -> tuple[float | None, bool, float, bool]:
    """Total Deribit account equity in USD (the initial-capital anchor) AND the
    companion session open-uPnL wedge, both from ONE ``get_account_summaries``
    response + the SAME resolved index_prices (SC-1) — no new fetch.

    Thin collapsed-4-tuple delegate to :func:`fetch_deribit_native_account_state`
    (byte-identical to the pre-80-02 body): reads
    ``private/get_account_summaries``; each coin-margined currency's coin equity
    is converted at its USD index price (``public/get_index_price`` with
    ``index_name={ccy}_usd``) while USD-family currencies pass through. The money
    math is the pure ``deribit_txn.deribit_equity_to_usd`` — NEVER anchor to a raw
    coin quantity (the anchor-shift class mis-scales every return). The open-uPnL
    wedge sums ``session_upl`` [ASSUMED A1] from the SAME summaries with the SAME
    index_prices; an absent/uncertain field → wedge 0.0 (fallback, never
    fabricated).

    Returns ``(equity, balance_error, open_unrealized_usd, upnl_unreadable)``. A
    failed read or an unvaluable held currency → ``(None, True, 0.0, False)``
    (the wedge inherits the anchor's fail-loud disposition — never fabricated on
    an unvaluable base, and ``unreadable`` is moot on a failed anchor). MUST-2:
    ``upnl_unreadable`` is True when the anchor read cleanly but ``session_upl``
    was absent/unreadable on EVERY summary — the caller surfaces
    ``unrealized_pnl_unreadable`` so a wrong assumed field name is LOUD.
    """
    state = await fetch_deribit_native_account_state(exchange)
    return (
        state.collapsed_equity_usd,
        state.balance_error,
        state.collapsed_upnl_usd,
        state.upnl_unreadable,
    )


async def fetch_deribit_account_equity_usd(
    exchange: Any,
) -> tuple[float | None, bool]:
    """Total Deribit account equity in USD (the initial-capital anchor).

    Thin 2-tuple-preserving delegate to
    :func:`fetch_deribit_account_equity_and_upnl_usd` (equity + balance_error
    elements only) so existing callers/tests are byte-identical.

    Returns ``(equity, balance_error)`` mirroring ``fetch_account_equity_usd``:
    ``balance_error=True`` means the read failed (caller flags heuristic
    capital). ``fetch_account_equity_usd`` (services.exchange) does NOT cover
    deribit — coin-margined USDT balance is not USD equity — so this is the
    deribit-specific anchor.
    """
    equity, balance_error, _upnl, _unreadable = (
        await fetch_deribit_account_equity_and_upnl_usd(exchange)
    )
    return equity, balance_error


# ---------------------------------------------------------------------------
# 80-02 — the native-unit venue adapter: assemble a NativeLedger from existing
# Deribit parts for the landed Phase-79 core. Writes NO reconstruction math.
# ---------------------------------------------------------------------------


def _today_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _native_daily_to_series(day_map: Mapping[str, float]) -> pd.Series:
    """D9: convert the pandas-pure ``{utc_day_iso: native_pnl}`` dict
    (``txn_rows_to_native_daily`` output) into a float Series on a tz-naive
    midnight ASCENDING ``DatetimeIndex`` — the ``NativeLedger.native_pnl`` shape.
    This conversion lives HERE (not in the AST-pandas-pure ``deribit_txn.py``)."""
    if not day_map:
        return pd.Series(dtype=float, name="native_pnl")
    days = sorted(day_map)
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in days])
    return pd.Series(
        [day_map[d] for d in days], index=index, dtype=float, name="native_pnl"
    )


def _marks_series(price_map: Mapping[str, float]) -> pd.Series:
    """A dense daily USD mark Series on a tz-naive midnight ascending
    ``DatetimeIndex`` from a ``{utc_day_iso: delivery_price}`` map — NEVER
    forward-filled (the map is already dense from ``public/get_delivery_prices``;
    a genuine gap stays a gap so the core's ``missing_daily_marks`` refusal fires)."""
    days = sorted(price_map)
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in days])
    return pd.Series(
        [price_map[d] for d in days], index=index, dtype=float, name="mark"
    )


async def _build_dense_native_marks(
    exchange: Any,
    *,
    indexable: AbstractSet[str],
    native_pnl: Mapping[str, pd.Series],
    native_flows: Sequence[ExternalFlow],
    terminal_native_equity: Mapping[str, float],
    terminal_upnl_native: Mapping[str, float],
    raw_rows: Sequence[Mapping[str, Any]],
    sleep: SleepFn = asyncio.sleep,
) -> dict[str, pd.Series]:
    """The DENSE daily settlement-mark planner (D4). For every INDEXED currency
    carrying nonzero native value (pnl, equity, wedge, or flow), build a DENSE
    daily ``{ccy}_usd`` mark Series across ``[oldest activity day, today]`` as the
    UNION of two REAL same-day sources — NOT pruned to event days (the core carries
    balances forward and needs a mark on every carry-forward day) and NEVER
    forward-filled/fabricated (a genuine publish gap stays a gap → the core's
    ``missing_daily_marks`` refusal fires, T-80-05):

      1. the per-event OWN-ROW ``index_price`` a settlement/cash row carries, via
         :func:`_day_ccy_own_index` — EXACTLY the same-day index the USD leg trusts
         (``txn_rows_to_daily_records`` / ``deribit_dated_external_flows_usd``); and
      2. the ``public/get_delivery_prices`` supplemental (via
         :func:`fetch_deribit_settlement_index`) for quiet/settlement days the
         ledger itself carries no own index on.

    HIGH-1: without the own-row leg, native marks came ONLY from
    ``get_delivery_prices`` — a strictly NARROWER endpoint than the USD path's
    coverage. A currency classified INDEXED (``{ccy}_usd`` resolves on
    ``get_index_price``) whose ``get_delivery_prices`` is empty (SOL, an explicit
    target) or gappy on an event day (BTC/ETH) was FALSE-refused
    ``missing_daily_marks`` by the core, even though the USD path values it via each
    row's own ``index_price``. Unioning the own-row index restores coverage on
    EVENT days to match the USD path exactly (each row's own same-day index).

    But the equivalence is NOT total: the native roll additionally needs a mark on
    every non-event CARRY-FORWARD day (the core carries balances forward and values
    them daily), which the USD leg — dated per realized event only — never required.
    Carry-forward-day density therefore rests on the ``get_delivery_prices`` feed,
    and a SPARSE-feed INDEXED coin can still refuse ``missing_daily_marks`` on a
    quiet day where the USD path valued it. This is VALIDATED against real coin keys
    at the 80-04 parity gate; if it manifests it is resolved there with a documented
    fallback/guard (NOT here — no fallback is added now, ahead of real data). Own-row
    index WINS on a day both sources carry (identical precedence to
    ``deribit_txn.py`` — the ledger's own same-day index always wins); a day present
    in NEITHER stays absent so the core refuses it honestly. Marks are NEVER filled —
    only the union of two genuine same-day marks.

    USD-family currencies get NO marks entry (their mark is the literal ``1.0`` in
    the core, §4.1). An UNINDEXABLE currency gets NONE either — the adapter never
    fabricates a ``1.0`` mark; the core value-gates and refuses it downstream.
    ``indexable`` is DISJOINT from USD-family (§3.2), so ``ccy in indexable`` ⟺ the
    currency is a branch-2 INDEXED coin. LOW-2: a value-carrying INDEXED currency
    whose MERGED map is still empty is OMITTED (no key) so ``marks.get(code)`` is
    ``None`` and the F-1 build-time invariant (``native_nav.py:406``) fires the clean
    ``missing_daily_marks`` refusal at ``_build_buckets`` — never an empty Series
    that defers the refusal to ``_value_over_calendar``."""
    value_ccys: set[str] = set()
    oldest_day: dict[str, str] = {}
    # Newest day a ccy can be REQUIRED (its last ledger day, or today if a nonzero
    # terminal balance carries forward) — the upper bound of the sparse-delivery gap
    # check so the perp fill covers the whole carry-forward span, not just [min,max].
    newest_day: dict[str, str] = {}
    today_iso = _today_utc_iso()

    def _note(ccy: str, day_oldest: str | None, day_newest: str | None) -> None:
        value_ccys.add(ccy)
        if day_oldest is not None:
            prev = oldest_day.get(ccy)
            oldest_day[ccy] = day_oldest if prev is None else min(prev, day_oldest)
        if day_newest is not None:
            prevn = newest_day.get(ccy)
            newest_day[ccy] = day_newest if prevn is None else max(prevn, day_newest)

    for ccy, series in native_pnl.items():
        if ccy not in indexable or series.empty:
            continue
        if bool((series.to_numpy(dtype=float) != 0.0).any()):
            _note(
                ccy,
                str(series.index[0].strftime("%Y-%m-%d")),
                str(series.index[-1].strftime("%Y-%m-%d")),
            )
    for flow in native_flows:
        ccy = flow.currency
        if ccy not in indexable:
            continue
        qty = flow.quantity
        if float(flow.usd_signed) != 0.0 or (qty is not None and float(qty) != 0.0):
            _note(ccy, flow.utc_day_iso, flow.utc_day_iso)
    for source in (terminal_native_equity, terminal_upnl_native):
        for ccy, val in source.items():
            if ccy in indexable and float(val) != 0.0:
                # A nonzero terminal balance carries forward to TODAY → the newest
                # required day is today (no oldest contribution — no ledger day).
                _note(ccy, None, today_iso)

    marks: dict[str, pd.Series] = {}
    if not value_ccys:
        return marks
    # The per-event OWN-ROW same-day index (leg 1), computed ONCE over the flat
    # raw rows via the EXACT resolution the USD leg trusts (_day_ccy_own_index —
    # end-of-day index_price per (day, ccy), seeded only for indexable currencies).
    # Grouped by UPPERCASE currency into a {day: price} map so it can be UNIONED
    # with each currency's delivery-price supplemental (leg 2) below.
    own_index = _day_ccy_own_index(raw_rows, indexable_currencies=indexable)
    own_by_ccy: dict[str, dict[str, float]] = {}
    for (day, ccy), price in own_index.items():
        own_by_ccy.setdefault(ccy, {})[day] = price
    # A currency carrying value ONLY via the anchor/wedge (no ledger day) spans from
    # the earliest day any indexed currency carries, so its dense mark series still
    # covers the whole reconstruction; today's date if nothing carries a day.
    global_oldest = min(oldest_day.values()) if oldest_day else _today_utc_iso()
    for ccy in sorted(value_ccys):
        delivery = await fetch_deribit_settlement_index(
            exchange, ccy, oldest_day=oldest_day.get(ccy, global_oldest), sleep=sleep
        )
        # UNION of two REAL same-day sources — the delivery-price supplemental for
        # quiet days OVERLAID by the own-row index (which WINS on a shared day,
        # mirroring deribit_txn's own-index-wins precedence). NEVER a fabricated /
        # forward-filled day: a day in NEITHER source stays absent so the core
        # refuses it honestly. This gives native marks coverage identical to the
        # USD path (HIGH-1).
        merged = {**delivery, **own_by_ccy.get(ccy, {})}
        # 80-04 sparse-delivery fill: an INDEXED coin whose delivery ∪ own union is
        # gappy across its carry-forward span (SOL — get_delivery_prices is sparse
        # and no same-day trade seeds an own index) refuses missing_daily_marks even
        # though it genuinely carries value. Fill the gaps with the
        # {ccy}_USDC-PERPETUAL DAILY CLOSE — same-exchange same-UTC-day, LOWEST
        # precedence (delivery/own already placed WIN on any shared day). Fetched
        # ONLY when a gap exists, so a dense-delivery coin (BTC/ETH) triggers no
        # perp fetch and stays byte-identical (SC-4).
        span_oldest = oldest_day.get(ccy, global_oldest)
        span_newest = newest_day.get(ccy, span_oldest)
        if _price_map_has_gap(merged, span_oldest, span_newest):
            perp = await fetch_deribit_perp_daily_index(
                exchange, ccy, oldest_day=span_oldest, sleep=sleep
            )
            merged = {**perp, **merged}
        if not merged:
            # LOW-2: no mark from ANY source for a value-carrying INDEXED
            # currency → OMIT the key (no empty Series) so the F-1 build-time
            # invariant refuses it cleanly at _build_buckets.
            continue
        marks[ccy] = _marks_series(merged)
    return marks


# Phase 131 — Deribit's public ``get_tradingview_chart_data`` 1D series retains
# roughly 2.5 years of daily bars for expired option instruments (M7 live probe:
# 401 daily bars each on Dec-24…Sep-25-expiry BTC options). An instrument whose
# WHOLE listed life predates this horizon returns a wholly-empty 1D response —
# that is the ONLY case that stays cash-basis (bounded fallback, Q4). An
# instrument expiring INSIDE the horizon with no bars is a STRUCTURAL hole →
# fail loud (never a silent cash fallback). ~2.5yr = 913 days.
_OPTION_MARK_RETENTION_DAYS: int = 913
# The dated-expiry segment of a Deribit option name, e.g. ``BTC-27JUN25-100000-C``
# / ``BTC_USDC-27MAR26-50000-P`` → ``27JUN25``. Mid-name (unlike the ``$``-anchored
# future tail ``_FUTURE_EXPIRY_RE`` in deribit_txn) because the option carries a
# strike + right suffix after the expiry.
_OPTION_EXPIRY_RE: re.Pattern[str] = re.compile(r"-(\d{1,2}[A-Z]{3}\d{2})-")
# IN-02: Deribit's month tokens are ENGLISH constants — never parse them with
# ``strptime(%b)``, which consults the process locale (de_DE: MAR/OCT/DEC fail →
# expiry None → the pre-retention partition can never bucket and old
# wholly-empty instruments hard-fail instead of warning). No other services/
# code uses ``%b``.
_OPTION_EXPIRY_MONTHS: dict[str, int] = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def _option_expiry_iso(instrument: str) -> str | None:
    """The UTC-day ISO expiry (``YYYY-MM-DD``) parsed from a Deribit option
    instrument name, or ``None`` if the name carries no dated-expiry segment.
    Never guessed — the expiry caps the marks fetch span (never fetch past it) and
    keys the pre-retention partition. Locale-independent (explicit English month
    map — IN-02). Pure / never raises on untrusted input."""
    match = _OPTION_EXPIRY_RE.search(instrument.upper())
    if match is None:
        return None
    token = match.group(1)  # e.g. "27JUN25": day (1-2 digits), month, 2-digit year
    month = _OPTION_EXPIRY_MONTHS.get(token[-5:-2])
    if month is None:
        return None
    try:
        return date(2000 + int(token[-2:]), month, int(token[:-5])).isoformat()
    except ValueError:
        return None


def _last_settled_option_mark_day() -> str:
    """The UTC-day KEY of the most recent COMPLETED Deribit 1D option bar.

    Deribit stamps a 1D bar at ``D 08:00 UTC`` (its settlement boundary — M7
    evidence) and the bar COMPLETES at the NEXT boundary, ``D+1 08:00``; its close
    is then the venue's settled mark for that boundary — the same settled basis
    the anchor's ``options_value − options_session_upl`` decomposes to. The most
    recent completed bar is therefore stamped ``(most recent 08:00 boundary) −
    24h``. Capping an OPEN instrument's marks window here (CR-02) keeps the
    current PARTIAL bar — whose live close still carries ``options_session_upl``
    — OUT of the terminal book, so the book channel reconciles exactly at the
    settled boundary."""
    now = datetime.now(timezone.utc)
    boundary = now.replace(hour=8, minute=0, second=0, microsecond=0)
    if now < boundary:
        boundary -= timedelta(days=1)
    return (boundary - timedelta(days=1)).strftime("%Y-%m-%d")


async def _build_smoothed_option_mtm(
    exchange: Any,
    raw_rows: Sequence[Mapping[str, Any]],
    *,
    sleep: SleepFn,
) -> tuple[dict[str, dict[str, float]], dict[str, float], list[tuple[str, str]]]:
    """SMOOTHED_MTM ΔMTM channel (Task 4). Replay the option book, fetch each held
    instrument's daily marks (ONE expiry-capped request per instrument), partition
    off the pre-retention instruments (wholly-empty marks AND expiry older than the
    ~2.5yr horizon → cash-basis bucket), and feed the rest to the PURE
    ``option_mtm_daily`` (which fails loud on any hole inside a listed life —
    including retention STRADDLERS, whose partial marks are never bucketed).

    Returns ``(delta_mtm, terminal_book, pre_mark_retention_option_days)``. The
    terminal book feeds the Task-5 book-channel anchor guard. Pure-core fail-loud
    (``LedgerValuationError``) propagates verbatim — never swallowed."""
    positions = replay_option_positions(raw_rows)
    if not positions:
        return {}, {}, []
    today = _today_utc_iso()
    retention_cutoff = (
        datetime.strptime(today, "%Y-%m-%d")
        - timedelta(days=_OPTION_MARK_RETENTION_DAYS)
    ).date().isoformat()

    kept_positions: dict[str, Mapping[str, Any]] = {}
    marks: dict[str, dict[str, float]] = {}
    pre_retention: set[tuple[str, str]] = set()
    last_settled = _last_settled_option_mark_day()
    for instrument in sorted(positions):
        info = positions[instrument]
        first_day = str(info["first_day"])
        last_day = str(info["last_day"])
        expiry = _option_expiry_iso(instrument)
        # CR-02: an instrument whose FINAL replayed position is nonzero is OPEN —
        # it stays exposed through the CURRENT settlement, not just its last
        # event day. Fetch its marks through the last SETTLED bar day so (a) the
        # ΔMTM series carries the book on every held day after the last trade
        # (no silent truncation) and (b) the terminal book lands at the SAME
        # settled boundary the anchor decomposes to — this also covers the days a
        # LATER-trading sibling instrument extends the global grid across (a
        # last-EVENT window there produced a spurious D-07 hole naming a healthy
        # instrument). A CLOSED instrument (final position 0) still ends at its
        # last event day. Never fetch past expiry either way (a position cannot
        # outlive its expiry; the source only lists bars within the life). A
        # same-day event past the last settled bar can still pull the window onto
        # the current PARTIAL bar — the book channel then judges it (fail-loud,
        # never silent).
        event_positions = info["positions"]
        # IN-03: an instrument with NO nonzero end-of-day position (opened and
        # closed intraday, never held across a settlement) needs NO daily marks
        # — it can contribute nothing to the ΔMTM book and can never hole. Skip
        # the fetch entirely and NEVER bucket it as pre-retention: its cash legs
        # already carry the full P&L, so a complete_with_warnings stamp would be
        # spurious.
        if not any(float(v) != 0.0 for v in event_positions.values()):
            continue
        terminal_pos = float(event_positions[max(event_positions)])
        newest = last_day if terminal_pos == 0.0 else max(last_day, last_settled)
        if expiry is not None:
            newest = min(newest, expiry)
        instr_marks = await fetch_deribit_option_daily_marks(
            exchange, instrument, oldest_day=first_day, newest_day=newest, sleep=sleep
        )
        # Partition on WHOLLY-empty AND expiry-past-retention (both required). Any
        # other empty/holed response — in-retention wholly-empty, OR a straddler's
        # PARTIAL (nonempty) marks — is KEPT so ``option_mtm_daily`` fails loud on
        # the structural hole (D-07). A straddler is never wholly-empty (it returns
        # partial marks) → never bucketed here.
        if not instr_marks and expiry is not None and expiry < retention_cutoff:
            ccy = str(info["currency"]).upper()
            for day in info["positions"]:
                pre_retention.add((ccy, day))
            continue
        kept_positions[instrument] = info
        marks[instrument] = instr_marks

    # NF-01: cap the ΔMTM grid at the last SETTLED bar day so a sibling
    # instrument's crawl-day event (delivery/settlement/trade → last_day = today)
    # cannot drag the dense grid onto TODAY, where another OPEN instrument still
    # carries a nonzero position with no settled mark (a spurious D-07 hole
    # naming the healthy instrument). The crawl-day cash already books on the
    # cash channel; that day is simply never MTM-marked.
    delta_mtm, terminal_book = option_mtm_daily(
        kept_positions, marks, last_settled_day=last_settled
    )
    return delta_mtm, terminal_book, sorted(pre_retention)


async def build_deribit_native_ledger(
    exchange: Any,
    since_ms: int | None = None,
    *,
    account_state: DeribitNativeAccountState | None = None,
    sleep: SleepFn = asyncio.sleep,
    pnl_basis: str = DEFAULT_PNL_BASIS,
    exclude_spot_extraction: bool = False,
) -> tuple[NativeLedger, CompletenessReport]:
    """Assemble a :class:`~services.native_nav.NativeLedger` for the landed Phase-79
    native core from existing Deribit parts + the 80-01 siblings (NAT-04). It
    writes NO reconstruction math — the core rolls, values, and refuses.

    Six fields, all per-currency native:
      * ``native_pnl`` — ``txn_rows_to_native_daily`` over the crawl's RAW rows,
        each ``{day: native_change}`` dict converted to a tz-naive midnight Series
        (D9).
      * ``terminal_native_equity`` / ``terminal_upnl_native`` — the per-currency
        native anchor + wedge from the ONE ``get_account_summaries`` response
        (:func:`fetch_deribit_native_account_state`). The caller threads its
        already-read ``account_state`` in (D5 one-read: the core anchor + the
        caller's materiality/C2 basis judge the SAME response); a standalone /
        test caller omits it and this reads the anchor itself. The unmarkable-wedge
        App A #6 refusal is delivered BY CONSTRUCTION — the raw native
        ``session_upl`` is passed through and the core's value-gate refuses it.
      * ``marks`` — a DENSE daily ``{ccy}_usd`` settlement-index Series per INDEXED
        nonzero currency (:func:`_build_dense_native_marks`); USD-family absent.
      * ``native_flows`` — the crawl's 4-field ``(day, ccy)`` dated flows, reused
        verbatim from ``report.dated_external_flows`` (never recomputed).
      * ``full_history=True`` — Deribit's txn-log reaches inception, so the §5
        inception gate reconciles against a pre-history balance of 0.

    Returns ``(NativeLedger, CompletenessReport)``; the caller still runs
    :func:`assert_ledger_complete` on the report (the adapter never swallows it).
    The collapsed USD anchor stays available via
    :func:`fetch_deribit_native_account_state` for the 80-04 parity panel.
    Leak: no raw balances/marks/flows logged."""
    # WR-05: the smoothed replay reconstructs ABSOLUTE option positions from the
    # signed post-trade ``position`` field, so it is only correct over the FULL
    # history (Deribit's txn-log reaches inception — ``full_history=True``
    # below). A ``since_ms``-cropped crawl would see positions only from the
    # first in-window row: earlier held days silently unmarked, the first
    # in-window day absorbing a book jump, and the option-activity gate (ANY
    # option-evidence row) disagreeing with the replay (trade/delivery rows
    # only) — terminal_book {} vs a nonzero venue anchor. Fail loud before
    # crawling rather than misattribute; the other bases keep accepting
    # ``since_ms`` (SC-4).
    if pnl_basis == PNL_BASIS_SMOOTHED_MTM and since_ms is not None:
        raise LedgerValuationError(
            "smoothed_mtm requires a full-history crawl (since_ms=None): the "
            "option-book replay reconstructs absolute positions from the signed "
            "post-trade position field and a cropped window would silently "
            "mis-state the daily MTM"
        )
    _daily_records, raw_rows, indexable, report = await _crawl_deribit_ledger(
        exchange, since_ms, sleep=sleep
    )
    # Keep the plain (day, ccy)-keyed native dict for the balance-identity guard
    # (which reconciles against Σchange over cash-bearing rows) BEFORE the
    # pd.Series conversion. ``pnl_basis`` (cash_settlement DEFAULT — zavara-
    # validated — or mark_to_market) is threaded through per strategy/account.
    # ``exclude_spot_extraction`` (Bug B) is TRUE only on the ALLOCATED / Zavara
    # path (a non-None ``returns_denominator_config``); it drops net-extraction
    # spot legs from native_pnl. On the NAV path it is FALSE so spot legs are
    # RETAINED verbatim and the §5 inception reconciliation closes. The guard below
    # is called in the SAME mode so the reference Σchange never drifts from native_pnl.
    native_daily = txn_rows_to_native_daily(
        raw_rows, pnl_basis=pnl_basis, exclude_spot_extraction=exclude_spot_extraction
    )
    # ``native_daily`` is the CASH channel (option rows on FULL change; summary
    # inert). It is the reference the STRICT balance-identity cash channel reconciles
    # against (Σ==Σchange) BELOW — so keep it pre-merge. Under SMOOTHED_MTM the
    # per-(day,ccy) ΔMTM book is merged into a SEPARATE ``series_daily`` dict that
    # feeds the native_pnl series (and thus the dense-mark span); the book channel
    # reconciles the ΔMTM terminal book against the anchor (Task 5). For every other
    # basis ``series_daily is native_daily`` → byte-identical (SC-4).
    series_daily = native_daily
    smoothed_terminal_book: dict[str, float] = {}
    smoothed_delta_mtm: dict[str, dict[str, float]] = {}
    if pnl_basis == PNL_BASIS_SMOOTHED_MTM and deribit_raw_rows_have_option_activity(
        raw_rows
    ):
        smoothed_delta_mtm, smoothed_terminal_book, pre_retention = (
            await _build_smoothed_option_mtm(exchange, raw_rows, sleep=sleep)
        )
        report.pre_mark_retention_option_days = pre_retention
        series_daily = {ccy: dict(days) for ccy, days in native_daily.items()}
        for ccy, day_map in smoothed_delta_mtm.items():
            bucket = series_daily.setdefault(ccy, {})
            for day, change in day_map.items():
                bucket[day] = bucket.get(day, 0.0) + change
    native_pnl: dict[str, pd.Series] = {
        ccy: _native_daily_to_series(day_map)
        for ccy, day_map in series_daily.items()
    }
    native_flows = report.dated_external_flows
    # Phase 86 (COMP-04) MTM-gate signal — additive crawl artifact set from the RAW
    # rows (like dated_external_flows / pre_coverage_option_days). Basis-agnostic:
    # an options book is flagged under BOTH pnl_basis values so
    # ``mark_to_market_available`` gates a composite's MTM off honestly.
    report.has_option_activity = deribit_raw_rows_have_option_activity(raw_rows)
    # HIGH-1/MEDIUM-1 (D5 one-read): use the anchor the caller already read from
    # the SAME get_account_summaries response so the core's anchor + the caller's
    # materiality/C2 basis judge ONE response. Standalone / test callers pass
    # nothing → fall back to a self-contained read (no behaviour change for them).
    state = (
        account_state
        if account_state is not None
        else await fetch_deribit_native_account_state(exchange)
    )
    marks = await _build_dense_native_marks(
        exchange,
        indexable=indexable,
        native_pnl=native_pnl,
        native_flows=native_flows,
        terminal_native_equity=state.native_equity,
        terminal_upnl_native=state.native_upnl,
        raw_rows=raw_rows,
        sleep=sleep,
    )
    # Phase 82 MANDATORY fail-loud reconcile guard (§1): per currency the computed
    # realized total MUST equal Σchange over cash-bearing rows, to
    # max($1-equiv native floor, 1e-4·throughput). The $1-equivalent NATIVE floor
    # is derived from the anchor mark the adapter already holds: USD-family ≈ 1.0
    # native/$1; an indexed coin ≈ 1/terminal_mark. Closes by construction. Under
    # CASH_SETTLEMENT (the DEFAULT / shipped basis) it is a plain Σ==Σ that catches a
    # dropped/mis-summed cash row (the ONLY reconciliation there — B1: no open-option
    # exemption). The mid-window-missing-summary breach it also catches is
    # MARK_TO_MARKET-specific (an open-options session whose premium dropped with no
    # summary carrying it) — either way a LedgerValuationError STOP, never a shipped
    # wrong number.
    native_floor: dict[str, float] = {}
    for ccy in set(native_daily) | {str(c).upper() for c in state.native_equity}:
        if ccy in USD_FAMILY:
            native_floor[ccy] = 1.0
            continue
        mark_series = marks.get(ccy)
        if mark_series is not None and len(mark_series) > 0:
            anchor_mark = float(mark_series.iloc[-1])
            if anchor_mark > 0:
                native_floor[ccy] = 1.0 / anchor_mark
        # else: no mark (a value-carrying no-mark coin fails at native_nav's own
        # mark refusal); rely on the relative 1e-4·throughput term (floor 0.0).
    # CR-01 / B1 (BASIS-SCOPED): exempt provably-OPEN option currencies from the
    # STRICT guard ONLY under mark_to_market. There the summary channel re-attributes
    # option P&L across held days and the open book's terminal MTM is a legitimate
    # residual the flat-at-settlement identity cannot close — so the exemption is
    # needed and §5 (NAV path) is the authoritative backstop. Under CASH_SETTLEMENT
    # (the DEFAULT / Zavara basis) EVERY option row books its FULL cash ``change``
    # (coverage_windows are never consulted), so the strict Σnative==Σchange identity
    # closes EXACTLY and MUST run on open-option currencies too — it is the ONLY
    # fail-loud reconciliation on the allocated/cash_settlement path (``combine_native_ledger``
    # returns the allocated metrics BEFORE ``reconstruct_native_nav_and_twr``, so §5
    # never runs there). Exempting a currency here would silently ship a wrong
    # factsheet on a dropped/mis-summed BTC cash row. Hence: no exemption under
    # cash_settlement.
    open_opt = (
        frozenset(c for c, v in state.native_options_value.items() if v != 0.0)
        | _option_activity_after_coverage(raw_rows)
        if pnl_basis == PNL_BASIS_MARK_TO_MARKET
        else frozenset()
    )
    # ``native_daily`` here is the PRE-merge CASH channel (option rows on full
    # change), so the strict cash-channel identity closes Σ==Σchange exactly under
    # every basis. Under SMOOTHED_MTM the additional book + summary cross-check
    # channels reconcile the ΔMTM terminal book against the venue anchor's settled
    # book and police the summary stream (all inert / None for the other bases →
    # byte-identical, SC-4).
    assert_balance_identity(
        raw_rows, native_daily, native_floor=native_floor, open_option_ccys=open_opt,
        exclude_spot_extraction=exclude_spot_extraction, pnl_basis=pnl_basis,
        terminal_book=(
            smoothed_terminal_book
            if pnl_basis == PNL_BASIS_SMOOTHED_MTM
            else None
        ),
        native_options_value=state.native_options_value,
        native_options_session_upl=state.native_options_session_upl,
        option_delta_mtm=smoothed_delta_mtm,
    )
    # Surface the exempted currencies for logs/harness (an open book is the NORMAL
    # state — §5 guards it — so this is NOT promoted to complete_with_warnings;
    # trailing/pre-rollout activity is separately stamped below).
    report.balance_identity_open_option_ccys = sorted(open_opt)
    # Q6 (MARK_TO_MARKET ONLY): option rows outside their currency's summary
    # coverage window fall back to cash-basis `change` (premium noise persists — no
    # summary channel to reshape them). Surface the affected buckets so the worker
    # stamps complete_with_warnings (never silently ship pre-rollout noise as clean
    # under MTM). Under CASH_SETTLEMENT (the DEFAULT) EVERY option row books its
    # raw cash `change` on its settlement day BY DESIGN — there is no summary
    # channel and no "pre-coverage fallback", so this warning would be spurious;
    # suppress it (judgment call b).
    report.pre_coverage_option_days = (
        _pre_coverage_option_days(raw_rows)
        if pnl_basis == PNL_BASIS_MARK_TO_MARKET
        else []
    )
    # H1 (BLOCKER): under CASH_SETTLEMENT the OPEN option book's settled mark
    # (``native_options_value``) is INCLUDED in the venue-reported ``equity``
    # (terminal_native_equity) but is NOT in the cash-only ``native_pnl`` and NOT in
    # the session-uPnL wedge — so §5 (`_assert_inception_reconciled`) would strand it
    # as an unexplained residual and fail a perfectly healthy open-options NAV
    # account PERMANENT (the shipped NAV+options+cash_settlement §5 combination had
    # ZERO coverage). Value the open book INTO the terminal wedge so the reconciliation
    # closes: terminal_equity == Σnative_pnl + Σflow + wedge, with wedge = session
    # uPnL + open-book MTM. Like the session-uPnL wedge, this open-MTM is stripped
    # from the realized-basis NAV backward roll (consistent with the existing
    # unrealized-stripping design). Perp-only / no-open-book accounts have
    # ``options_value`` == 0 ⇒ wedge unchanged ⇒ byte-identical (SC-4).
    #
    # Under MARK_TO_MARKET the open book's value is ALREADY carried INTO native_pnl by
    # the summary channel, so adding it to the wedge would DOUBLE-COUNT — keep the
    # wedge = session uPnL only there (unchanged).
    #
    # WR-01: SMOOTHED_MTM joins the MARK_TO_MARKET arm for the same reason — the
    # ΔMTM merge already carries the SETTLED open book into native_pnl
    # (terminal_book == options_value − options_session_upl, book-channel-guarded
    # above), so re-adding options_value would double-count it and strand a §5
    # residual ≈ options_value on every healthy open-book account. From the M5
    # anchor identity (equity − combined_session_upl == cash + options_value −
    # options_session_upl): Σnative_pnl = cash′ + options_value −
    # options_session_upl ⇒ required wedge = equity − Σflow − Σnative_pnl =
    # futures_session_upl + options_session_upl — exactly the COMBINED session
    # uPnL that ``state.native_upnl`` already reads (the two legs the settled
    # daily marks exclude). §5 then closes exactly (pinned by the open-book
    # smoothed §5-through test).
    if pnl_basis in (PNL_BASIS_MARK_TO_MARKET, PNL_BASIS_SMOOTHED_MTM):
        terminal_upnl_native: Mapping[str, float] = state.native_upnl
    else:
        _wedge_ccys = (
            {str(c).upper() for c in state.native_upnl}
            | {str(c).upper() for c in state.native_options_value}
        )
        terminal_upnl_native = {
            c: float(state.native_upnl.get(c, 0.0))
            + float(state.native_options_value.get(c, 0.0))
            for c in _wedge_ccys
        }
    ledger = NativeLedger(
        native_pnl=native_pnl,
        terminal_native_equity=state.native_equity,
        marks=marks,
        native_flows=native_flows,
        terminal_upnl_native=terminal_upnl_native,
        full_history=True,
    )
    return ledger, report


def assert_ledger_complete(report: CompletenessReport) -> None:
    """The re-anchored D-02 honesty gate. Raise ``LedgerCompletenessError`` if
    ANY expected scope × currency did not reach ``continuation=null``.

    Takes NO fill-count total: completeness over the date range — not a
    reconciliation to 18,778 / 21,014 / 61,248 (Wave-0 BLOCKING_FINDING: those
    fill-level totals reconcile to no API surface) — is the honesty anchor. A
    truncated crawl and a dropped scope leave the gate failing, so a silently-
    partial ledger can never render as complete. ``expected`` is anchored on the
    enumeration-INDEPENDENT truth (authoritative subaccount set + full public
    currency universe, both fail-loud), so under-enumeration cannot slip past."""
    incomplete: list[str] = []
    for scope_label, currencies in report.expected.items():
        for currency in currencies:
            entry = report.entries.get((scope_label, currency))
            if entry is None or not entry.get("reached_end"):
                incomplete.append(f"{scope_label}×{currency}")
    if incomplete:
        raise LedgerCompletenessError(
            "Deribit ledger is INCOMPLETE — these scope×currency crawls did not "
            "reach continuation=null (truncation or dropped scope): "
            + ", ".join(sorted(incomplete))
            + ". Refusing to render a silently-partial ledger as a complete track "
            "record (re-anchored D-02 gate)."
        )


# ===========================================================================
# SECONDARY trades axis (70-04, DRB-04) — execution detail + an ADVISORY
# fill-count cross-check. This is NOT the returns source and NOT the D-02
# honesty gate: realized returns come from the txn-log ledger above
# (fetch_deribit_ledger_daily_records / assert_ledger_complete). Fills are
# fetched via the id-cursor ``private/get_user_trades_by_currency`` endpoint —
# NOT ``_and_time`` (passing both bounds one-page-stalls; Wave-0 bug #2) — and
# mapped to the shared ``FillRow`` with ``exchange_fill_id = trade_id`` so
# ``diff_strategy_fills`` dedups on (exchange, exchange_fill_id) and re-fetch
# is idempotent.
# ===========================================================================

# Documented max page size for the trades endpoint.
TRADES_PAGE_COUNT: int = 1000
# Non-matching reads pace ~20 req/s (cost 500, pool 50,000, refill 10,000/s).
TRADES_PACE_SECONDS: float = 0.05
# Exponential backoff base for 10028 on the trades endpoint.
TRADES_BACKOFF_BASE_SECONDS: float = 1.0
# Max consecutive 10028 retries for a single trades page before surfacing.
TRADES_MAX_RETRIES: int = 8


def _build_trades_params(
    currency: str,
    count: int,
    *,
    start_id: str | None = None,
    historical: bool = True,
    sorting: str = "asc",
) -> dict[str, Any]:
    """Pure params builder for ``private/get_user_trades_by_currency``.

    ALWAYS sends ``historical=true`` (Wave-0 bug #1: without it the endpoint
    caps at the last 24h — 674 vs 2,962 for acct3) and ``sorting=asc`` so the
    id-cursor advances forward. ``start_id`` is present ONLY when advancing past
    the first page — the initial page carries no cursor.
    """
    params: dict[str, Any] = {
        "currency": currency,
        "count": count,
        "sorting": sorting,
    }
    if historical:
        params["historical"] = "true"
    if start_id is not None:
        params["start_id"] = start_id
    return params


async def paginate_trades_id_cursor(
    exchange: Any,
    currency: str,
    scope_auth: Mapping[str, Any],
    *,
    count: int = TRADES_PAGE_COUNT,
    start_id: str | None = None,
    sleep: SleepFn = asyncio.sleep,
    max_retries: int = TRADES_MAX_RETRIES,
    pace_seconds: float = TRADES_PACE_SECONDS,
) -> list[dict[str, Any]]:
    """Fetch all trades for one scope × currency via the id-cursor endpoint.

    Advances ``start_id`` = last trade_id (EXCLUSIVE) each page and continues
    while ``has_more`` OR the page is FULL (``len==count``) — ``has_more`` has no
    documented reliability guarantee (Wave-0), so relying on it alone drops rows
    on a full-but-``has_more=false`` page. Stops ONLY when a page is BOTH
    not-full AND ``has_more=false``. Rows are accumulated once; a ``seen`` guard
    drops any re-included boundary trade_id (start_id is exclusive but the API
    may re-serve it). 10028 backs off up to ``max_retries``; any other error
    propagates so the producer can decide currency-skip (-32602) vs fail-loud.
    Every ccxt error is scrubbed before it can reach a log.
    """
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    cursor = start_id
    is_first_page = True
    while True:
        params = _build_trades_params(currency, count, start_id=cursor)
        params.update(scope_auth)

        if not is_first_page:
            await sleep(pace_seconds)

        retries = 0
        while True:
            try:
                resp = await exchange.private_get_get_user_trades_by_currency(params)
                break
            except Exception as exc:  # noqa: BLE001
                if _deribit_error_code(exc) != _RATE_LIMIT_CODE:
                    raise
                retries += 1
                if retries > max_retries:
                    raise
                await sleep(TRADES_BACKOFF_BASE_SECONDS * (2 ** (retries - 1)))

        is_first_page = False
        result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
        raw_trades = result.get("trades", []) or []
        has_more = bool(result.get("has_more"))

        page_trades = [t for t in raw_trades if isinstance(t, Mapping)]
        page_len = len(page_trades)
        last_id: str | None = None
        for trade in page_trades:
            tid = trade.get("trade_id")
            tid_str = str(tid) if tid is not None else None
            if tid_str is not None:
                last_id = tid_str
                if tid_str in seen:
                    continue
                seen.add(tid_str)
            rows.append(dict(trade))

        page_full = page_len == count
        if not page_full and not has_more:
            break
        if last_id is None:
            # No trade_id to advance on — refuse to spin forever on a full page
            # that carries no cursor (defensive; a real page always has ids).
            break
        cursor = last_id
    return rows


def _trade_to_fillrow(trade: Mapping[str, Any]) -> dict[str, Any]:
    """Map one raw Deribit trade → the shared ``FillRow`` (built via the
    canonical ``_make_fill_dict`` factory, NEVER hand-rolled).

    ``exchange_fill_id = trade_id`` is the primary dedup axis for
    ``diff_strategy_fills``; ``side`` comes from Deribit's ``direction``. Money
    fields flow through the factory's Decimal→exact-string chokepoint (H-0669).
    """
    from services.exchange import _make_fill_dict

    trade_id = str(trade.get("trade_id", "") or "")
    instrument = str(trade.get("instrument_name", "") or "")
    side = str(trade.get("direction", "") or "").lower()
    price = trade.get("price", 0) or 0
    amount = trade.get("amount", 0) or 0
    fee = trade.get("fee", 0) or 0
    fee_currency = str(trade.get("fee_currency", "") or "")
    ts_ms = int(trade.get("timestamp", 0) or 0)
    ts_iso = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()
    return dict(
        _make_fill_dict(
            exchange="deribit",
            symbol=instrument,
            side=side,
            price=price,
            quantity=amount,
            fee=fee,
            fee_currency=fee_currency,
            timestamp=ts_iso,
            exchange_order_id=str(trade.get("order_id", "") or ""),
            exchange_fill_id=trade_id,
            is_maker=bool(trade.get("post_only", False)),
            raw_data=dict(trade),
            position_direction=None,
        )
    )


async def fetch_deribit_fills(
    exchange: Any,
    since_ms: int | None = None,
    *,
    sleep: SleepFn = asyncio.sleep,
) -> list[dict[str, Any]]:
    """Fetch execution-detail fills across every scope × currency (SECONDARY
    axis). Reuses the 70-03 per-scope auth (``resolve_scope_auth`` → subaccount
    reads via ``public/exchange_token``) so subaccount fills are reachable
    despite ``subaccount_id`` being refused on the read-only LTP keys.

    A ``-32602`` (non-margin currency for the wallet type) skips THAT currency
    (scrubbed-logged, never swallowed silently) while other currencies still
    fetch. Any other error propagates. ``since_ms`` is accepted for signature
    parity with the other ``_fetch_raw_trades_*`` producers; the id-cursor crawl
    is full-history (``historical=true``) and dedups downstream on
    ``exchange_fill_id``. 70-06's adapter imports this.
    """
    scopes = await enumerate_scopes(exchange)
    fills: list[dict[str, Any]] = []
    for scope in scopes:
        auth = await resolve_scope_auth(exchange, scope)
        # enumerate_currencies FAILS LOUD (CurrencyEnumerationError) on an
        # unenumerable universe — intentional and consistent with the returns
        # path: fills is an execution-detail / advisory-cross-check axis, and an
        # unenumerable universe means we cannot honestly bound coverage, so it
        # surfaces (classified by the ingestion dispatcher) rather than silently
        # returning an empty fill set.
        currencies = await enumerate_currencies(exchange, scope, auth)
        for currency in currencies:
            try:
                trades = await paginate_trades_id_cursor(
                    exchange, currency, auth, sleep=sleep
                )
            except Exception as exc:  # noqa: BLE001
                if _deribit_error_code(exc) == _NON_MARGIN_CURRENCY_CODE:
                    logger.warning(
                        "fetch_deribit_fills: skipping scope=%s currency=%s "
                        "(-32602 non-margin currency): %s",
                        scope.label,
                        currency,
                        scrub_freeform_string(str(exc)),
                    )
                    continue
                raise
            for trade in trades:
                fills.append(_trade_to_fillrow(trade))
    return fills


# ---------------------------------------------------------------------------
# ADVISORY fill-count cross-check — NOT the honesty gate.
# ---------------------------------------------------------------------------

# The three LTP account fill totals observed out-of-band. Wave-0 BLOCKING_FINDING:
# these figures reconcile to NO API surface (they appear to count fills/legs, not
# transaction-log rows), so they are an OPTIONAL cross-check ONLY. The
# returns-completeness honesty gate is ``assert_ledger_complete`` (70-03), NEVER
# this fill count. Keyed by account label for bookkeeping — do NOT wire any of
# these into a fail-loud gate.
KNOWN_TRADE_TOTALS: dict[str, int] = {
    "ltp_1": 18_778,
    "ltp_2": 21_014,
    "ltp_3": 61_248,
}


def reconcile_fill_count(fetched_total: int, known_total: int) -> dict[str, Any]:
    """ADVISORY fill-count cross-check — RETURNS a diff report and NEVER raises.

    This is DELIBERATELY not a gate. The Wave-0 BLOCKING_FINDING proved the known
    fill totals (18,778 / 21,014 / 61,248) reconcile to NO API surface, so a
    shortfall here is advisory evidence only — it is emitted as a WARN-severity
    report, never a ``DeribitCountGateError`` (no such type exists by design). The
    returns-completeness honesty gate is ``assert_ledger_complete`` (70-03, ledger
    COMPLETENESS over the date range), NOT this count. A caller may log/record the
    report; it must never mistake a fill-count shortfall for the ledger gate.
    """
    shortfall = max(known_total - fetched_total, 0)
    reconciles = fetched_total == known_total
    return {
        "fetched_total": fetched_total,
        "known_total": known_total,
        "diff": fetched_total - known_total,
        "shortfall": shortfall,
        "reconciles": reconciles,
        "advisory": True,
        "severity": "info" if reconciles else "warn",
        "note": (
            "ADVISORY ONLY — fill totals reconcile to no API surface (Wave-0 "
            "BLOCKING_FINDING). The returns honesty gate is ledger completeness "
            "(assert_ledger_complete, 70-03), NEVER this fill count."
        ),
    }
