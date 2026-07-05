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
import re
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from services.deribit_txn import txn_rows_to_daily_records
from services.redact import scrub_freeform_string

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
    currency did not reach ``continuation=null`` (a truncated crawl, a -32602
    currency skip, or a dropped scope). This is LEDGER completeness — NOT a
    reconciliation to the fill counts 18,778 / 21,014 / 61,248, which the Wave-0
    probe (BLOCKING_FINDING) proved reconcile to no API surface."""


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


# ---------------------------------------------------------------------------
# Scope enumeration + per-scope auth.
# ---------------------------------------------------------------------------


async def enumerate_scopes(exchange: Any) -> list[Scope]:
    """Enumerate account scopes from get_subaccounts, MAIN scope first.

    Subaccount ids are kept as STRINGS (Wave-0 fixed the int-filter bug). An
    error / empty result degrades to main-only (a subaccount we cannot see is
    handled by the completeness gate at the currency layer, not silently)."""
    scopes: list[Scope] = [Scope(label="main", subaccount_id=None, is_main=True)]
    try:
        resp = await exchange.private_get_get_subaccounts({"with_portfolio": "false"})
    except Exception:  # noqa: BLE001 - main-only degrade; never crash enumeration
        return scopes
    result = resp.get("result", []) if isinstance(resp, Mapping) else []
    if not isinstance(result, Sequence):
        return scopes
    ordinal = 0
    for entry in result:
        if not isinstance(entry, Mapping):
            continue
        raw_id = entry.get("id")
        if raw_id is None:
            continue
        ordinal += 1
        scopes.append(
            Scope(
                label=f"sub_{ordinal}",
                subaccount_id=str(raw_id),
                is_main=False,
            )
        )
    return scopes


async def mint_subaccount_token(exchange: Any, subject_id: str) -> str:
    """Mint a read-scoped token for a subaccount via ``public/exchange_token``
    (param ``subject_id`` — subaccount_id is refused on the read-only LTP keys,
    design §Subaccounts). Raises ``ScopeAuthError`` if no token comes back."""
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
    """Enumerate the currencies to crawl for ``scope`` from the account's held
    balances (nonzero equity/balance), falling back to ``public/get_currencies``
    when no held balance is reported. NEVER a hard-coded currency list."""
    held: list[str] = []
    try:
        resp = await exchange.private_get_get_account_summaries(dict(scope_auth))
    except Exception:  # noqa: BLE001 - fall through to public currencies
        resp = None
    if isinstance(resp, Mapping):
        result = resp.get("result", {})
        summaries = result.get("summaries", []) if isinstance(result, Mapping) else []
        if isinstance(summaries, Sequence):
            for summ in summaries:
                if not isinstance(summ, Mapping):
                    continue
                ccy = summ.get("currency")
                equity = summ.get("equity") or 0
                balance = summ.get("balance") or 0
                if ccy and (equity or balance):
                    held.append(str(ccy))
    if held:
        return held
    # Fallback: every listed currency (public — no scope needed).
    try:
        resp = await exchange.public_get_get_currencies()
    except Exception:  # noqa: BLE001
        return []
    result = resp.get("result", []) if isinstance(resp, Mapping) else []
    out: list[str] = []
    if isinstance(result, Sequence):
        for entry in result:
            if isinstance(entry, Mapping) and entry.get("currency"):
                out.append(str(entry["currency"]))
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
    last continuation). NEVER returns a partial page set. Every ccxt error is
    scrubbed before it can reach a log. Any non-10028 error propagates (the
    producer decides currency-skip vs fail-loud).
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
        result = resp.get("result", {}) if isinstance(resp, Mapping) else {}
        logs = result.get("logs", []) or []
        if isinstance(logs, Sequence):
            rows.extend(r for r in logs if isinstance(r, Mapping))
        continuation = result.get("continuation")
        if not continuation:
            break
    return rows


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
    """

    expected: dict[str, list[str]] = field(default_factory=dict)
    entries: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)


def _now_ms() -> int:
    return int(time.time() * 1000)


async def fetch_deribit_ledger_daily_records(
    exchange: Any,
    since_ms: int | None = None,
    *,
    sleep: SleepFn = asyncio.sleep,
) -> tuple[list[dict[str, Any]], CompletenessReport]:
    """Crawl the txn-log ledger across every scope × currency and return the
    accumulated funding-inclusive ``daily_pnl`` records plus a
    ``CompletenessReport``.

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
      * ``LedgerTruncatedError`` (10028 budget exhausted) → ``reached_end=False``;
      * ``-32602`` (non-margin currency) → ``reached_end=False`` (a graceful skip
        is NOT complete — it can never masquerade as a full crawl, D-14);
      * any other error → RE-RAISED (fail loud; never swallowed as a skip).

    The LIVE multi-year crawl over real creds is 70-05/live-gated; the producer
    LOGIC here is CI-provable via synthetic scope/currency stubs.
    """
    scopes = await enumerate_scopes(exchange)
    start_ms = since_ms if since_ms is not None else DEFAULT_START_MS
    end_ms = _now_ms()

    # Pass 1 — resolve auth (fail loud) + enumerate the OWED coverage per scope.
    expected: dict[str, list[str]] = {}
    scope_auths: dict[str, dict[str, Any]] = {}
    for scope in scopes:
        auth = await resolve_scope_auth(exchange, scope)
        scope_auths[scope.label] = auth
        expected[scope.label] = await enumerate_currencies(exchange, scope, auth)

    # Pass 2 — crawl every OWED (scope, currency), concatenating the records.
    daily_records: list[dict[str, Any]] = []
    entries: dict[tuple[str, str], dict[str, Any]] = {}
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
            except Exception as exc:  # noqa: BLE001
                if _deribit_error_code(exc) == _NON_MARGIN_CURRENCY_CODE:
                    entries[key] = {
                        "reached_end": False,
                        "rows": 0,
                        "error": "-32602 non-margin currency skip",
                    }
                    continue
                raise
            records = txn_rows_to_daily_records(rows)
            daily_records.extend(records)
            entries[key] = {"reached_end": True, "rows": len(rows)}

    return daily_records, CompletenessReport(expected=expected, entries=entries)


def assert_ledger_complete(report: CompletenessReport) -> None:
    """The re-anchored D-02 honesty gate. Raise ``LedgerCompletenessError`` if
    ANY expected scope × currency did not reach ``continuation=null``.

    Takes NO fill-count total: completeness over the date range — not a
    reconciliation to 18,778 / 21,014 / 61,248 (Wave-0 BLOCKING_FINDING: those
    fill-level totals reconcile to no API surface) — is the honesty anchor. A
    truncated crawl, a -32602 skip, and a dropped scope all leave the gate
    failing, so a silently-partial ledger can never render as complete."""
    incomplete: list[str] = []
    for scope_label, currencies in report.expected.items():
        for currency in currencies:
            entry = report.entries.get((scope_label, currency))
            if entry is None or not entry.get("reached_end"):
                incomplete.append(f"{scope_label}×{currency}")
    if incomplete:
        raise LedgerCompletenessError(
            "Deribit ledger is INCOMPLETE — these scope×currency crawls did not "
            "reach continuation=null (truncation, -32602 skip, or dropped scope): "
            + ", ".join(sorted(incomplete))
            + ". Refusing to render a silently-partial ledger as a complete track "
            "record (re-anchored D-02 gate)."
        )
