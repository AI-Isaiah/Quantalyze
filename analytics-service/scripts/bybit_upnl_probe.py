"""Phase 167.2.1.1 UPNLVENUES probe (D-01): on the LIVE Bybit keys, does the
wallet-balance response carry open-position profit in ``equity`` but not in
``walletBalance``, and does ccxt's ``parse_balance`` ``total`` follow the wallet
balance rather than the equity?

WHY: the fix in plan 01 rests on one reading of ccxt: for a Bybit V5 wallet
balance, ``fetch_balance()['total']`` is the coin ``walletBalance`` (realized
basis), NOT the coin ``equity`` (which adds the open uPnL). That reading is
settled from the pinned ccxt source and a synthetic payload; this probe confirms
it on real responses, once, after the fix is deployed. Assumption A2 rides along:
CONTRACT (classic) accounts are expected to behave like UNIFIED ones, so the
probe records which account type each key is and reads that type's response.

WHAT IT DOES, per active Bybit key, in ``created_at`` order, labelled k1..kN:
  1. reads the wallet balance ONCE (account type UNIFIED; one more read with
     CONTRACT only if the first raised a bad-request or exchange error, or came
     back with an empty list), then the linear USDT position list ONCE;
  2. runs ccxt's REAL ``parse_balance`` (on a credential-free client) on the same
     raw wallet response and compares its USDT ``total`` with the wallet balance;
  3. compares ``equity - walletBalance`` with the open uPnL on the USDT coin row,
     and ``totalEquity - totalWalletBalance`` with ``totalPerpUPL`` on the
     account row;
  4. records what would explain a legitimate mismatch (margin borrow, non-USDT
     coins, non-USDT uPnL) and whether the summed position uPnL matches
     ``totalPerpUPL`` (the check the reconstruct fix relies on).

A venue field the response lacks reads ``field-absent``, never 0.0 or False. A
key whose open uPnL is zero is recorded as NON-informative (``upnl_nonzero``
false, ``upnl_ratio`` field-absent), and the summary counts how many keys were
informative, so a run of flat keys cannot read as confirmation.

REDACTION CONTRACT (the output is pasted into a tracked file in a public repo):
no balance, equity, PnL amount, key, secret, account or strategy identifier, and
no timestamp finer than the run date. The only path to stdout is ``emit_record``,
which refuses any key outside ``KEY_RECORD_KEYS`` / ``SUMMARY_RECORD_KEYS``, any
value outside the declared vocabulary, and any float not already rounded to three
significant figures, then re-checks with ``assert_sanitized``. Logging is switched
off for the run. A failed read is recorded by an allow-listed exception CLASS
(the message is never copied: a ccxt message can carry a signed URL, an amount or
an id), and a run-level failure prints the exception TYPE only.

READ-ONLY: one SELECT on ``api_keys`` and two venue GET reads per key, handed out
by ``ReadOnlyBybitProxy`` (each at most once per distinct request; every other
attribute, ``close`` included, is an ``AttributeError``). No write call of any
kind is made, and the allocator key preflight (whose circuit-breaker arm can
write) is never invoked. Keys are decrypted inside the worker process and
nowhere else.

USAGE (run once on the worker after the deploy; it takes no arguments, so no
identifier is ever typed):
  railway ssh "cd /app && python -m scripts.bybit_upnl_probe"
Paste only the lines that start with ``{"`` (one per key, then one summary).

EXIT CODES
----------
  0  every key was read; one JSON line per key and a summary were printed
  1  any key's read failed (printed as a record, after every key and the
     summary), or any other failure (the exception TYPE only on stderr)
  2  refused before any decrypt: no active ``bybit`` key, or a selected row that
     is not an active ``bybit`` key
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import re
import sys
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import ccxt
import ccxt.async_support as ccxt_async

from scripts.deribit_ground_truth import assert_sanitized

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_REFUSED = 2

# Hard bound on each key's reads, so a slow venue ends the probe instead of
# wedging a shell.
READ_TIMEOUT_S: float = 60.0

FIELD_ABSENT = "field-absent"

# Two venue decimals are equal when they differ by at most one unit of Bybit's
# 8-decimal strings, or by at most a one-in-a-billion share of the larger one.
_FIELD_EQ_ABS = Decimal("0.00000001")
_FIELD_EQ_REL = Decimal("1e-9")

# The label k1..kN is two digits at most.
_MAX_KEYS = 99

FAILURE_CLASSES: tuple[str, ...] = (
    "none",
    "AuthenticationError",
    "PermissionDenied",
    "RateLimitExceeded",
    "RequestTimeout",
    "NetworkError",
    "BadRequest",
    "ExchangeError",
    "EmptyResponse",
    "Timeout",
    "other",
)
_ACCOUNT_TYPES: tuple[str, ...] = ("UNIFIED", "CONTRACT", "other", FIELD_ABSENT)

KEY_RECORD_KEYS: tuple[str, ...] = (
    "record",
    "key",
    "run_date",
    "read_ok",
    "positions_read_ok",
    "failure_class",
    "account_type",
    "ccxt_total_equals_wallet",
    "coin_equity_minus_wallet_equals_upnl",
    "account_equity_minus_wallet_equals_perp_upl",
    "upnl_ratio",
    "upnl_nonzero",
    "borrow_present",
    "non_usdt_coins_present",
    "non_usdt_upnl_present",
    "positions_upnl_matches_totalperpupl",
)
SUMMARY_RECORD_KEYS: tuple[str, ...] = (
    "record",
    "run_date",
    "keys",
    "keys_read",
    "keys_informative",
    "keys_identity_holds",
    "keys_ccxt_total_is_wallet",
)

# The measurements a failed read cannot supply.
_MEASUREMENT_KEYS: tuple[str, ...] = (
    "account_type",
    "ccxt_total_equals_wallet",
    "coin_equity_minus_wallet_equals_upnl",
    "account_equity_minus_wallet_equals_perp_upl",
    "upnl_ratio",
    "upnl_nonzero",
    "borrow_present",
    "non_usdt_coins_present",
    "non_usdt_upnl_present",
    "positions_upnl_matches_totalperpupl",
)

_LABEL_RE = re.compile(r"^k[0-9]{1,2}$")
_DATE_RE = re.compile(r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")


# ---------------------------------------------------------------------------
# Whitelist emitter. The ONLY path to stdout.
# ---------------------------------------------------------------------------


def sig3(x: float) -> float | str:
    """Round to three significant figures; a non-finite value reads ``non-finite``."""
    if not math.isfinite(x):
        return "non-finite"
    return float(f"{x:.3g}")


def _is_bool(x: Any) -> bool:
    return isinstance(x, bool)


def _is_bool_or_absent(x: Any) -> bool:
    return isinstance(x, bool) or (isinstance(x, str) and x == FIELD_ABSENT)


def _is_count(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0


def _is_sig3_float(x: Any) -> bool:
    return isinstance(x, float) and math.isfinite(x) and float(f"{x:.3g}") == x


def _is_ratio(x: Any) -> bool:
    if isinstance(x, str):
        return x == FIELD_ABSENT
    return _is_sig3_float(x)


def _is_str_matching(pattern: re.Pattern[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and pattern.match(x) is not None


def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed


_KEY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("key",)),
    "key": _is_str_matching(_LABEL_RE),
    "run_date": _is_str_matching(_DATE_RE),
    "read_ok": _is_bool,
    "positions_read_ok": _is_bool,
    "failure_class": _is_one_of(FAILURE_CLASSES),
    "account_type": _is_one_of(_ACCOUNT_TYPES),
    "ccxt_total_equals_wallet": _is_bool_or_absent,
    "coin_equity_minus_wallet_equals_upnl": _is_bool_or_absent,
    "account_equity_minus_wallet_equals_perp_upl": _is_bool_or_absent,
    "upnl_ratio": _is_ratio,
    "upnl_nonzero": _is_bool_or_absent,
    "borrow_present": _is_bool_or_absent,
    "non_usdt_coins_present": _is_bool_or_absent,
    "non_usdt_upnl_present": _is_bool_or_absent,
    "positions_upnl_matches_totalperpupl": _is_bool_or_absent,
}

_SUMMARY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "record": _is_one_of(("summary",)),
    "run_date": _is_str_matching(_DATE_RE),
    "keys": _is_count,
    "keys_read": _is_count,
    "keys_informative": _is_count,
    "keys_identity_holds": _is_count,
    "keys_ccxt_total_is_wallet": _is_count,
}


def _check_keys(path: str, got: Mapping[str, Any], want: Sequence[str]) -> None:
    extra = sorted(set(got) - set(want))
    missing = sorted(set(want) - set(got))
    if extra or missing:
        raise ValueError(f"{path}: keys differ from the whitelist extra={extra} missing={missing}")


def validate_record(record: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` unless ``record`` is exactly the declared vocabulary.

    The message names the PATH of the offending entry and never its value: an
    unredacted amount must not leak through its own rejection."""
    if not isinstance(record, Mapping):
        raise ValueError("record: not a mapping")
    kind = record.get("record")
    if kind == "key":
        want, validators = KEY_RECORD_KEYS, _KEY_VALIDATORS
    elif kind == "summary":
        want, validators = SUMMARY_RECORD_KEYS, _SUMMARY_VALIDATORS
    else:
        raise ValueError("record.record: value outside the declared vocabulary")
    _check_keys("record", record, want)
    for key, check in validators.items():
        if not check(record[key]):
            raise ValueError(f"record.{key}: value outside the declared vocabulary")
    assert_sanitized(dict(record))


def emit_record(record: Mapping[str, Any]) -> str:
    """The ONLY path to stdout: validate, then serialize one compact JSON line."""
    validate_record(record)
    return json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False)


# ---------------------------------------------------------------------------
# Pure layer: what one wallet-balance response (and one position list) says.
# ---------------------------------------------------------------------------


def _dec(raw: Any) -> Decimal | None:
    """A present, finite venue number as a ``Decimal``, else ``None`` (never 0)."""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        text = str(raw)
    elif isinstance(raw, (str, Decimal)):
        text = str(raw).strip()
    else:
        return None
    if not text:
        return None
    try:
        value = Decimal(text)
    except InvalidOperation:
        return None
    return value if value.is_finite() else None


def _equal(a: Decimal, b: Decimal) -> bool:
    diff = abs(a - b)
    return diff <= _FIELD_EQ_ABS or diff <= _FIELD_EQ_REL * max(abs(a), abs(b))


def _account_row(resp: Any) -> Mapping[str, Any] | None:
    """The first account entry of a wallet-balance response, else ``None``."""
    result = resp.get("result") if isinstance(resp, Mapping) else None
    entries = result.get("list") if isinstance(result, Mapping) else None
    if not isinstance(entries, list):
        return None
    for entry in entries:
        if isinstance(entry, Mapping):
            return entry
    return None


def _coin_rows(account: Mapping[str, Any] | None) -> list[Mapping[str, Any]] | None:
    coins = account.get("coin") if account is not None else None
    if not isinstance(coins, list):
        return None
    return [row for row in coins if isinstance(row, Mapping)]


def _usdt_row(coins: list[Mapping[str, Any]] | None) -> Mapping[str, Any] | None:
    for row in coins or []:
        if row.get("coin") == "USDT":
            return row
    return None


def _field(row: Mapping[str, Any] | None, name: str) -> Decimal | None:
    return _dec(row.get(name)) if row is not None else None


def _identity(total: Decimal | None, wallet: Decimal | None, delta: Decimal | None) -> bool | None:
    """Does ``total - wallet`` equal ``delta``? ``None`` when any input is absent."""
    if total is None or wallet is None or delta is None:
        return None
    return _equal(total - wallet, delta)


def _borrow_present(coins: list[Mapping[str, Any]] | None) -> bool | None:
    if coins is None:
        return None
    seen = False
    present = False
    for row in coins:
        for name in ("spotBorrow", "borrowAmount"):
            value = _dec(row.get(name))
            if value is not None:
                seen = True
                present = present or value != 0
    return present if seen else None


def _non_usdt_flags(
    coins: list[Mapping[str, Any]] | None,
) -> tuple[bool | None, bool | None]:
    """(a non-USDT coin is held, a non-USDT coin carries open uPnL)."""
    if coins is None:
        return None, None
    held = False
    held_unknown = False
    upnl_nonzero = False
    upnl_unknown = False
    for row in coins:
        if row.get("coin") == "USDT":
            continue
        wallet, equity, upnl = (_dec(row.get(n)) for n in ("walletBalance", "equity", "unrealisedPnl"))
        if any(v is not None and v != 0 for v in (wallet, equity, upnl)):
            held = True
        elif wallet is None and equity is None and upnl is None:
            held_unknown = True
        if upnl is None:
            upnl_unknown = True
        elif upnl != 0:
            upnl_nonzero = True
    return (
        True if held else (None if held_unknown else False),
        True if upnl_nonzero else (None if upnl_unknown else False),
    )


def _positions_upnl_sum(positions_resp: Any) -> Decimal | None:
    """Summed open-position uPnL, or ``None`` when the list cannot be trusted
    (absent, a row without a number, or a further page the one read did not take)."""
    result = positions_resp.get("result") if isinstance(positions_resp, Mapping) else None
    if not isinstance(result, Mapping):
        return None
    entries = result.get("list")
    if not isinstance(entries, list):
        return None
    cursor = result.get("nextPageCursor")
    if isinstance(cursor, str) and cursor.strip():
        return None
    total = Decimal(0)
    for entry in entries:
        value = _dec(entry.get("unrealisedPnl")) if isinstance(entry, Mapping) else None
        if value is None:
            return None
        total += value
    return total


def _flag(value: bool | None) -> bool | str:
    return FIELD_ABSENT if value is None else value


def measure_key(
    label: str,
    run_date: str,
    wallet_resp: Mapping[str, Any],
    positions_resp: Mapping[str, Any] | None,
    ccxt_total_usdt: Any,
) -> dict[str, Any]:
    """The record for one key whose wallet balance was read. Pure: no I/O.

    ``positions_resp`` is ``None`` when the position read failed;
    ``ccxt_total_usdt`` is ccxt's own parsed USDT ``total`` (``None`` if it could
    not be parsed)."""
    account = _account_row(wallet_resp)
    coins = _coin_rows(account)
    usdt = _usdt_row(coins)

    wallet = _field(usdt, "walletBalance")
    equity = _field(usdt, "equity")
    upnl = _field(usdt, "unrealisedPnl")
    total_equity = _field(account, "totalEquity")
    total_wallet = _field(account, "totalWalletBalance")
    perp_upl = _field(account, "totalPerpUPL")

    raw_type = account.get("accountType") if account is not None else None
    if isinstance(raw_type, str) and raw_type:
        account_type = raw_type if raw_type in ("UNIFIED", "CONTRACT") else "other"
    else:
        account_type = FIELD_ABSENT

    parsed_total = _dec(ccxt_total_usdt)
    ccxt_total_is_wallet = (
        None if parsed_total is None or wallet is None else _equal(parsed_total, wallet)
    )

    ratio: float | str = FIELD_ABSENT
    if equity is not None and wallet is not None and upnl is not None and upnl != 0:
        shown = sig3(float((equity - wallet) / upnl))
        ratio = shown if isinstance(shown, float) else FIELD_ABSENT

    non_usdt_held, non_usdt_upnl = _non_usdt_flags(coins)

    positions_sum = _positions_upnl_sum(positions_resp)
    positions_match = (
        None if positions_sum is None or perp_upl is None else _equal(positions_sum, perp_upl)
    )

    return {
        "record": "key",
        "key": label,
        "run_date": run_date,
        "read_ok": True,
        "positions_read_ok": positions_resp is not None,
        "failure_class": "none",
        "account_type": account_type,
        "ccxt_total_equals_wallet": _flag(ccxt_total_is_wallet),
        "coin_equity_minus_wallet_equals_upnl": _flag(_identity(equity, wallet, upnl)),
        "account_equity_minus_wallet_equals_perp_upl": _flag(
            _identity(total_equity, total_wallet, perp_upl)
        ),
        "upnl_ratio": ratio,
        "upnl_nonzero": _flag(None if upnl is None else upnl != 0),
        "borrow_present": _flag(_borrow_present(coins)),
        "non_usdt_coins_present": _flag(non_usdt_held),
        "non_usdt_upnl_present": _flag(non_usdt_upnl),
        "positions_upnl_matches_totalperpupl": _flag(positions_match),
    }


def failed_record(label: str, run_date: str, failure_class: str) -> dict[str, Any]:
    """The record for a key whose wallet read failed: no measurement, one class."""
    record: dict[str, Any] = {
        "record": "key",
        "key": label,
        "run_date": run_date,
        "read_ok": False,
        "positions_read_ok": False,
        "failure_class": failure_class,
    }
    for name in _MEASUREMENT_KEYS:
        record[name] = FIELD_ABSENT
    return record


class EmptyResponseError(Exception):
    """The venue answered, but with no account entry to measure."""


def classify_failure(exc: BaseException) -> str:
    """The allow-listed class of a failed read. NEVER reads the message: a ccxt
    message can carry a signed URL, an amount or an id."""
    # Most specific first: ccxt's PermissionDenied is an AuthenticationError and
    # its RateLimitExceeded / RequestTimeout are NetworkErrors.
    if isinstance(exc, ccxt.PermissionDenied):
        return "PermissionDenied"
    if isinstance(exc, ccxt.AuthenticationError):
        return "AuthenticationError"
    if isinstance(exc, ccxt.RateLimitExceeded):
        return "RateLimitExceeded"
    if isinstance(exc, ccxt.RequestTimeout):
        return "RequestTimeout"
    if isinstance(exc, ccxt.NetworkError):
        return "NetworkError"
    if isinstance(exc, ccxt.BadRequest):
        return "BadRequest"
    if isinstance(exc, ccxt.ExchangeError):
        return "ExchangeError"
    if isinstance(exc, EmptyResponseError):
        return "EmptyResponse"
    if isinstance(exc, TimeoutError):
        return "Timeout"
    return "other"


def refusal_reason(key_row: Mapping[str, Any] | None) -> str | None:
    """Why a selected key row is not measurable, or ``None``."""
    if not key_row:
        return "missing"
    if key_row.get("exchange") != "bybit":
        return "not-bybit"
    if not key_row.get("is_active"):
        return "inactive"
    return None


def summarize(records: Sequence[Mapping[str, Any]], run_date: str) -> dict[str, Any]:
    """The summary line: counts only. ``keys_informative`` is the number of keys
    whose open uPnL is nonzero, the only keys whose identity proves anything."""
    informative = [r for r in records if r["upnl_nonzero"] is True]
    return {
        "record": "summary",
        "run_date": run_date,
        "keys": len(records),
        "keys_read": sum(1 for r in records if r["read_ok"] is True),
        "keys_informative": len(informative),
        "keys_identity_holds": sum(
            1 for r in informative if r["coin_equity_minus_wallet_equals_upnl"] is True
        ),
        "keys_ccxt_total_is_wallet": sum(
            1 for r in records if r["ccxt_total_equals_wallet"] is True
        ),
    }


# ---------------------------------------------------------------------------
# I/O layer. Venue GET reads and one SELECT only.
# ---------------------------------------------------------------------------


class ReadOnlyBybitProxy:
    """A read-only view of a venue client for the probe.

    * hands out exactly two GET endpoints, the wallet balance and the position
      list; every other attribute, ``close`` and every write endpoint included,
      is an ``AttributeError``;
    * serves each endpoint at most once per DISTINCT request: a second identical
      read raises, because a retry would hide a rate-limit or a flaky response
      behind a second answer."""

    def __init__(self, exchange: Any) -> None:
        self._exchange = exchange
        self._seen: set[tuple[str, str]] = set()

    def _once(self, endpoint: str, params: Mapping[str, Any]) -> None:
        marker = (endpoint, json.dumps(dict(params), sort_keys=True, default=str))
        if marker in self._seen:
            raise RuntimeError(f"second identical {endpoint} read refused")
        self._seen.add(marker)

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)

    async def private_get_v5_account_wallet_balance(self, params: Mapping[str, Any]) -> Any:
        self._once("wallet_balance", params)
        return await self._exchange.private_get_v5_account_wallet_balance(dict(params))

    async def private_get_v5_position_list(self, params: Mapping[str, Any]) -> Any:
        self._once("position_list", params)
        return await self._exchange.private_get_v5_position_list(dict(params))


async def _read_wallet(proxy: ReadOnlyBybitProxy) -> Mapping[str, Any]:
    """The wallet-balance response: UNIFIED, and CONTRACT only as a fallback."""
    resp: Any = None
    try:
        resp = await proxy.private_get_v5_account_wallet_balance({"accountType": "UNIFIED"})
    except ccxt.AuthenticationError:
        raise  # a CONTRACT read would be refused the same way
    except (ccxt.BadRequest, ccxt.ExchangeError):
        resp = None
    if _account_row(resp) is not None:
        return resp  # type: ignore[no-any-return]
    resp = await proxy.private_get_v5_account_wallet_balance({"accountType": "CONTRACT"})
    if _account_row(resp) is None:
        raise EmptyResponseError("no account entry")
    return resp  # type: ignore[no-any-return]


def _ccxt_usdt_total(parser: Any, wallet_resp: Mapping[str, Any]) -> Any:
    """ccxt's own parsed USDT ``total`` for this response, or ``None``."""
    try:
        parsed = parser.parse_balance(wallet_resp)
        usdt = parsed.get("USDT")
        return usdt.get("total") if isinstance(usdt, Mapping) else None
    except Exception:  # noqa: BLE001 - recorded as field-absent; the message is never read
        return None


async def measure_key_live(
    exchange: Any, label: str, run_date: str, parser: Any
) -> dict[str, Any]:
    """Read one key through the read-only wrapper and return its record.

    A failed wallet read raises (the caller records its class); a failed position
    read is recorded as ``positions_read_ok`` false and the key is still measured."""
    proxy = ReadOnlyBybitProxy(exchange)
    wallet_resp = await _read_wallet(proxy)
    positions_resp: Mapping[str, Any] | None
    try:
        positions_resp = await proxy.private_get_v5_position_list(
            {"category": "linear", "settleCoin": "USDT", "limit": 200}
        )
    except Exception:  # noqa: BLE001 - recorded as positions_read_ok false; message never read
        positions_resp = None
    if positions_resp is not None and not isinstance(positions_resp, Mapping):
        positions_resp = None
    return measure_key(
        label, run_date, wallet_resp, positions_resp, _ccxt_usdt_total(parser, wallet_resp)
    )


async def run() -> int:
    """Select the active Bybit keys, refuse before any decrypt, then measure each
    in ``created_at`` order and print one JSON line per key and a summary."""
    from services.db import db_execute, get_supabase, rows
    from services.encryption import decrypt_credentials, get_kek
    from services.exchange import aclose_exchange
    from services.job_worker import _make_exchange_client

    supabase = get_supabase()

    def _load_keys() -> Any:
        return (
            supabase.table("api_keys")
            .select("*")
            .eq("exchange", "bybit")
            .eq("is_active", True)
            .order("created_at")
            .execute()
        )

    key_rows = rows(await db_execute(_load_keys))
    if not key_rows:
        print("refused: no active bybit key", file=sys.stderr)
        return EXIT_REFUSED
    if len(key_rows) > _MAX_KEYS:
        print("refused: more active bybit keys than the label can carry", file=sys.stderr)
        return EXIT_REFUSED
    for index, key_row in enumerate(key_rows, start=1):
        reason = refusal_reason(key_row)
        if reason is not None:
            print(f"refused: key k{index} is not measurable ({reason})", file=sys.stderr)
            return EXIT_REFUSED

    kek = get_kek()
    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # A credential-free client, used only to run ccxt's own parse_balance.
    parser = ccxt_async.bybit({})
    records: list[dict[str, Any]] = []
    try:
        for index, key_row in enumerate(key_rows, start=1):
            label = f"k{index}"
            exchange: Any = None
            try:
                api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
                exchange = _make_exchange_client("bybit", api_key, api_secret, passphrase)
                record = await asyncio.wait_for(
                    measure_key_live(exchange, label, run_date, parser), READ_TIMEOUT_S
                )
            except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
                record = failed_record(label, run_date, classify_failure(exc))
            finally:
                if exchange is not None:
                    await aclose_exchange(exchange)
            records.append(record)
            print(emit_record(record), flush=True)
    finally:
        await parser.close()
    print(emit_record(summarize(records, run_date)), flush=True)
    failed = any(r["read_ok"] is not True or r["positions_read_ok"] is not True for r in records)
    return EXIT_FAILED if failed else EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="UPNLVENUES read-only Bybit equity probe (takes no arguments)"
    )
    parser.parse_args(argv)
    logging.disable(logging.CRITICAL)
    try:
        return asyncio.run(run())
    except Exception as exc:  # noqa: BLE001 - the TYPE only; a message can carry an id
        print(f"failed: {type(exc).__name__}", file=sys.stderr)
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
