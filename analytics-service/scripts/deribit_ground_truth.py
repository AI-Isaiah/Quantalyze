"""Deribit ground-truth harness (DRB-01) — authed read-only evidence capture.

WHY: Phase 70 (DRB-04..07) must design Deribit dailies/funding against OBSERVED
fact, not a training-data guess. The single most consequential unknown is
whether Deribit funding is netted into realized PnL or appears as separate
transaction-log rows. ccxt's ``fetchFundingHistory`` is ``None`` for Deribit, so
funding/settlement data lives ONLY in the raw ``private/get_transaction_log``.
This harness authenticates a read-only LTP key, proves the key cannot trade
BEFORE any fetch, enumerates the account's settlement currencies, captures fully
paginated trades + transaction-log rows (whitelisted fields only), classifies
the instrument mix, and emits a single SANITIZED JSON object to stdout. The
recorded answers are committed to ``docs/deribit-ground-truth.md`` (Plan 67-03).

The script is a committed one-off (like ``scripts/probe_exchange_egress.py``) and
also becomes the Phase 70 fixture generator. It NEVER writes prod tables and
NEVER prints secrets.

USAGE
-----
  # From the running prod worker's Amsterdam egress (the authoritative run):
  railway ssh "cd /app && python -m scripts.deribit_ground_truth"

  # With explicit history bounds / safety caps:
  railway ssh "cd /app && python -m scripts.deribit_ground_truth --start-ms 1420070400000 --max-pages 500"

Credentials arrive via Railway env only (never a tracked file):
  DERIBIT_CLIENT_ID / DERIBIT_CLIENT_SECRET

RUNBOOK
-------
1. Founder sets DERIBIT_CLIENT_ID / DERIBIT_CLIENT_SECRET on the Railway worker
   (read-only LTP key; rotate after onboarding per ONB-02).
2. Confirm ``railway deployment list`` is green (flaky-main silently skips deploys).
3. Run the USAGE command; redirect stdout to a sanitized evidence JSON.
4. Populate docs/deribit-ground-truth.md from the captured answers (Plan 67-03).

EXIT CODES
----------
  0  success — sanitized JSON printed
  2  FAIL-LOUD: key scope exceeds read-only (no data fetched)
  3  missing DERIBIT_CLIENT_ID / DERIBIT_CLIENT_SECRET env vars
  1  any other failure (scrubbed message to stderr)
"""

from __future__ import annotations

import re
from typing import Any, Mapping

from services.redact import scrub_freeform_string, truncate_account_id

# ---------------------------------------------------------------------------
# Read-only scope gate (T-67-02) — fail loud BEFORE any data fetch.
# ---------------------------------------------------------------------------

# Deribit exposes write capability as :read_write / :read_trade scope suffixes.
# A read-only key carries only :read-suffixed grants (observed grounding fact:
# "trade:read account:read wallet:read custody:read block_trade:read").
_WRITE_SCOPE_SUFFIXES: tuple[str, ...] = (":read_write", ":read_trade")


def scope_is_read_only(scope: str) -> bool:
    """True iff a Deribit public/auth ``scope`` string is strictly read-only.

    Rejects (returns False) if ANY whitespace-split token is a write grant
    (ends with :read_write / :read_trade). Requires at least one :read-suffixed
    token — a scope with zero read grants is not a usable read-only key and
    must not silently pass the gate.
    """
    tokens = scope.split()
    if any(tok.endswith(_WRITE_SCOPE_SUFFIXES) for tok in tokens):
        return False
    return any(tok.endswith(":read") for tok in tokens)


# ---------------------------------------------------------------------------
# Transaction-log summary (THE phase question) — whitelisted fields only.
# ---------------------------------------------------------------------------

# Exactly the RESEARCH Pitfall 1 field set. Anything outside this set
# (username, user_id, email, ...) MUST NOT enter a committed sample.
_TXN_LOG_WHITELIST: tuple[str, ...] = (
    "type",
    "amount",
    "balance",
    "equity",
    "cashflow",
    "instrument_name",
    "side",
    "position",
    "timestamp",
    "currency",
)


def summarize_txn_log(rows: list[Mapping[str, Any]]) -> dict[str, Any]:
    """Aggregate transaction-log rows into distinct ``type`` counts + one
    whitelisted-field sample per type.

    The distinct ``type`` set + a per-type sample row is what resolves THE phase
    question (is funding netted into realized PnL or a separate row?). Samples
    carry ONLY the whitelisted fields so committing the evidence can never leak
    username/user_id/email (T-67-01).
    """
    type_counts: dict[str, int] = {}
    type_samples: dict[str, dict[str, Any]] = {}
    for row in rows:
        row_type = str(row.get("type", "unknown"))
        type_counts[row_type] = type_counts.get(row_type, 0) + 1
        if row_type not in type_samples:
            type_samples[row_type] = {
                field: row[field] for field in _TXN_LOG_WHITELIST if field in row
            }
    return {"type_counts": type_counts, "type_samples": type_samples}


# ---------------------------------------------------------------------------
# Instrument classification — inverse / linear / option / future.
# ---------------------------------------------------------------------------

# Deribit linear (USDC/USDT-margined) instruments carry the quote currency via
# an underscore segment (e.g. BTC_USDC-PERPETUAL); inverse (coin-margined) do
# not (e.g. BTC-PERPETUAL).
_LINEAR_MARGIN_MARKERS: tuple[str, ...] = ("_USDC", "_USDT", "_EURR")
# A dated-expiry future tail, e.g. "-27MAR26".
_FUTURE_EXPIRY_RE: re.Pattern[str] = re.compile(r"-\d{1,2}[A-Z]{3}\d{2}$")


def classify_instrument(instrument_name: str) -> str:
    """Classify a Deribit instrument name. Never raises on unknown input.

    Returns one of: ``inverse_perpetual``, ``linear_perpetual``, ``option``,
    ``future``, ``unknown``. Untrusted exchange input (T-67-04) is classified,
    not crashed on.
    """
    if not isinstance(instrument_name, str) or not instrument_name:
        return "unknown"
    name = instrument_name.upper()
    is_linear = any(marker in name for marker in _LINEAR_MARGIN_MARKERS)
    if name.endswith(("-C", "-P")):
        return "option"
    if name.endswith("-PERPETUAL"):
        return "linear_perpetual" if is_linear else "inverse_perpetual"
    if _FUTURE_EXPIRY_RE.search(name):
        return "future"
    return "unknown"


# ---------------------------------------------------------------------------
# Sanitization boundary (T-67-01 / T-67-03) — stdout -> tracked git artifact.
# ---------------------------------------------------------------------------

# Case-insensitive substring match: any key containing one of these is a secret
# and its entry is REMOVED entirely from the evidence.
_DENY_KEY_SUBSTRINGS: tuple[str, ...] = (
    "secret",
    "token",
    "api_key",
    "apikey",
    "password",
)
# Keys whose string value is masked via truncate_account_id (***<last4>).
_MASK_KEYS: frozenset[str] = frozenset(
    {"username", "user_id", "email", "system_name", "id"}
)
# Email + long-opaque-token shapes flagged by assert_sanitized as unmasked leaks.
_EMAIL_RE: re.Pattern[str] = re.compile(
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
)
_LONG_TOKEN_RE: re.Pattern[str] = re.compile(r"[A-Za-z0-9+/=_-]{40,}")


def _is_deny_key(key: Any) -> bool:
    if not isinstance(key, str):
        return False
    low = key.lower()
    return any(sub in low for sub in _DENY_KEY_SUBSTRINGS)


def sanitize_evidence(obj: Any) -> Any:
    """Recursively sanitize an evidence object before printing/committing.

    - deny-keyed entries (secret/token/api_key/apikey/password substrings) are
      REMOVED entirely;
    - mask-keyed string values (username/user_id/email/system_name/id) are
      masked via truncate_account_id;
    - every remaining string passes through scrub_freeform_string (ccxt embeds
      ``&signature=<HMAC>`` in error URLs).

    Reuses services.redact masking — never reimplements it. Non-mutating.
    """
    if isinstance(obj, Mapping):
        out: dict[str, Any] = {}
        for key, value in obj.items():
            if _is_deny_key(key):
                continue
            if isinstance(key, str) and key.lower() in _MASK_KEYS and isinstance(
                value, str
            ):
                out[key] = truncate_account_id(value)
            else:
                out[key] = sanitize_evidence(value)
        return out
    if isinstance(obj, list):
        return [sanitize_evidence(item) for item in obj]
    if isinstance(obj, str):
        return scrub_freeform_string(obj)
    return obj


def assert_sanitized(obj: Any, _path: str = "") -> None:
    """Re-walk ``obj`` and raise ValueError (naming the offending path) if any
    secret survives sanitization.

    Fails on: a deny-key still present, an unmasked email-shaped value, or a
    40+ char base64/hex-looking opaque token. Reused by Plans 67-03/67-04 to
    verify REAL artifacts before commit. Passes silently on sanitized input.
    """
    if isinstance(obj, Mapping):
        for key, value in obj.items():
            key_path = f"{_path}/{key}"
            if _is_deny_key(key):
                raise ValueError(f"unsanitized deny-key at {key_path}")
            assert_sanitized(value, key_path)
    elif isinstance(obj, list):
        for index, value in enumerate(obj):
            assert_sanitized(value, f"{_path}/{index}")
    elif isinstance(obj, str):
        if _EMAIL_RE.search(obj):
            raise ValueError(f"unmasked email-shaped value at {_path or '/'}")
        if _LONG_TOKEN_RE.search(obj):
            raise ValueError(f"long token-shaped value at {_path or '/'}")


# ---------------------------------------------------------------------------
# Async harness — authed read-only fetch (I/O layer; ccxt imported lazily so
# the pure-logic layer above stays import-light and network-free).
# ---------------------------------------------------------------------------

# 2015-01-01 UTC in ms — full Deribit history by default.
DEFAULT_START_MS: int = 1_420_070_400_000
DEFAULT_MAX_PAGES: int = 500
DEFAULT_COUNT: int = 1000


class ScopeViolationError(RuntimeError):
    """Raised when the Deribit key scope exceeds read-only (exit code 2)."""


def _egress_country() -> tuple[str, int | None]:
    """Best-effort egress country via ipinfo (mirrors probe_exchange_egress).

    Never raises; returns ("?", None) on any transport failure.
    """
    import json as _json
    import urllib.error
    import urllib.request

    req = urllib.request.Request(
        "https://ipinfo.io/json",
        headers={"User-Agent": "quantalyze-deribit-gt/1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read(400).decode("utf-8", "replace")
            status = resp.status
        data = _json.loads(body)
        country = data.get("country", "?") if isinstance(data, dict) else "?"
        return str(country), status
    except Exception:  # noqa: BLE001 - egress probe is best-effort metadata
        return "?", None


async def _paginate_trades(
    ex: Any,
    ccy: str,
    *,
    start_ms: int,
    end_ms: int,
    count: int,
    max_pages: int,
) -> dict[str, Any]:
    """Fully paginate user trades for one currency, following ``has_more``.

    Advances ``start_timestamp`` to the last trade's timestamp (inclusive) and
    dedupes by ``trade_id`` so no trade sharing a millisecond boundary is
    skipped — Phase 70 verifies these counts against 18,778 / 21,014 / 61,248,
    so completeness beats avoiding a small re-fetch overlap.
    """
    trade_count = 0
    pages_used = 0
    max_pages_hit = False
    instrument_kinds: dict[str, int] = {}
    samples: dict[str, list[dict[str, Any]]] = {}
    seen: set[str] = set()
    cursor = start_ms
    while True:
        if pages_used >= max_pages:
            max_pages_hit = True
            break
        resp = await ex.private_get_get_user_trades_by_currency_and_time(
            {
                "currency": ccy,
                "kind": "any",
                "start_timestamp": cursor,
                "end_timestamp": end_ms,
                "count": count,
                "include_old": "true",
                "sorting": "asc",
            }
        )
        result = resp.get("result", {}) if isinstance(resp, dict) else {}
        trades = result.get("trades", []) or []
        pages_used += 1
        if not trades:
            break
        for trade in trades:
            trade_id = str(trade.get("trade_id", ""))
            if trade_id and trade_id in seen:
                continue
            if trade_id:
                seen.add(trade_id)
            trade_count += 1
            kind = classify_instrument(str(trade.get("instrument_name", "")))
            instrument_kinds[kind] = instrument_kinds.get(kind, 0) + 1
            bucket = samples.setdefault(kind, [])
            if len(bucket) < 3:
                bucket.append(
                    {f: trade[f] for f in _TXN_LOG_WHITELIST if f in trade}
                )
        has_more = bool(result.get("has_more", False))
        last_ts = trades[-1].get("timestamp")
        if not has_more or not isinstance(last_ts, int) or last_ts < cursor:
            break
        cursor = last_ts
    return {
        "trade_count": trade_count,
        "pages_used": pages_used,
        "max_pages_hit": max_pages_hit,
        "instrument_kinds": instrument_kinds,
        "instrument_samples": samples,
    }


async def _paginate_txn_log(
    ex: Any,
    ccy: str,
    *,
    start_ms: int,
    end_ms: int,
    count: int,
    max_pages: int,
) -> dict[str, Any]:
    """Fully paginate the transaction log for one currency, following the
    ``continuation`` token, merging each page through ``summarize_txn_log``.

    THE phase question falls out of the merged distinct ``type`` counts +
    per-type whitelisted sample.
    """
    type_counts: dict[str, int] = {}
    type_samples: dict[str, dict[str, Any]] = {}
    pages_used = 0
    max_pages_hit = False
    continuation: str | None = None
    while True:
        if pages_used >= max_pages:
            max_pages_hit = True
            break
        params: dict[str, Any] = {
            "currency": ccy,
            "start_timestamp": start_ms,
            "end_timestamp": end_ms,
            "count": count,
        }
        if continuation:
            params["continuation"] = continuation
        resp = await ex.private_get_get_transaction_log(params)
        result = resp.get("result", {}) if isinstance(resp, dict) else {}
        logs = result.get("logs", []) or []
        pages_used += 1
        page = summarize_txn_log(logs)
        for row_type, row_count in page["type_counts"].items():
            type_counts[row_type] = type_counts.get(row_type, 0) + row_count
        for row_type, sample in page["type_samples"].items():
            type_samples.setdefault(row_type, sample)
        continuation = result.get("continuation")
        if not continuation or not logs:
            break
    return {
        "txn_log_type_summary": {
            "type_counts": type_counts,
            "type_samples": type_samples,
        },
        "pages_used": pages_used,
        "max_pages_hit": max_pages_hit,
    }


async def run(
    client_id: str,
    client_secret: str,
    *,
    start_ms: int,
    end_ms: int,
    max_pages: int,
    count: int,
) -> dict[str, Any]:
    """Authenticate read-only, enumerate currencies, capture fully-paginated
    trades + transaction log, and return a (pre-sanitization) evidence dict.

    Raises ScopeViolationError if the key scope exceeds read-only — BEFORE any
    private call (T-67-02). The caller sanitizes the returned dict.
    """
    # Lazy imports: keep the pure-logic layer (imported by the unit tests)
    # free of ccxt / services.exchange so those tests stay I/O-free.
    import ccxt

    from datetime import datetime, timezone

    from services.exchange import aclose_exchange, create_exchange
    from services.geo_block import is_geo_blocked

    egress_country, egress_status = _egress_country()
    geo_observations: list[dict[str, Any]] = []

    def _record_exc(context: str, exc: Exception) -> None:
        scrubbed = str(scrub_freeform_string(str(exc)))
        entry: dict[str, Any] = {"context": context, "error": scrubbed}
        if is_geo_blocked(exc):
            entry["geo_blocked"] = True
            entry["marker_candidate"] = scrubbed[:200]
        geo_observations.append(entry)

    evidence: dict[str, Any] = {
        "run_meta": {
            "utc": datetime.now(timezone.utc).isoformat(),
            "ccxt_version": str(getattr(ccxt, "__version__", "unknown")),
            "egress_country": egress_country,
            "egress_ipinfo_status": egress_status,
            "args": {
                "start_ms": start_ms,
                "end_ms": end_ms,
                "max_pages": max_pages,
                "count": count,
            },
        },
    }

    ex: Any = create_exchange("deribit", client_id, client_secret)
    try:
        # 1. Read-only scope gate — FAIL LOUD before any private fetch.
        auth = await ex.public_get_auth(
            {
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
            }
        )
        auth_result = auth.get("result", {}) if isinstance(auth, dict) else {}
        scope = str(auth_result.get("scope", ""))
        evidence["scope"] = scope
        if not scope_is_read_only(scope):
            raise ScopeViolationError(
                "FAIL-LOUD: Deribit key is not read-only (scope has write grant): "
                + scope
            )

        # 2. Enumerate currencies; hold-set = currencies with nonzero balance.
        available: list[str] = []
        try:
            ccy_resp = await ex.public_get_get_currencies()
            ccy_result = (
                ccy_resp.get("result", []) if isinstance(ccy_resp, dict) else []
            )
            available = [
                str(entry.get("currency"))
                for entry in ccy_result
                if isinstance(entry, dict) and entry.get("currency")
            ]
        except Exception as exc:  # noqa: BLE001
            _record_exc("get_currencies", exc)

        held: list[str] = []
        for ccy in available:
            try:
                summ = await ex.private_get_get_account_summary({"currency": ccy})
                summ_result = (
                    summ.get("result", {}) if isinstance(summ, dict) else {}
                )
                equity = summ_result.get("equity") or 0
                balance = summ_result.get("balance") or 0
                if equity or balance:
                    held.append(ccy)
            except Exception as exc:  # noqa: BLE001
                _record_exc(f"account_summary:{ccy}", exc)
        evidence["currencies"] = {"available": available, "held": held}

        # 3. Per-currency full-pagination capture of trades + transaction log.
        per_currency: dict[str, Any] = {}
        instrument_mix: dict[str, int] = {}
        instrument_samples: dict[str, list[dict[str, Any]]] = {}
        capture_ccys = held or available
        for ccy in capture_ccys:
            entry: dict[str, Any] = {}
            try:
                trades = await _paginate_trades(
                    ex,
                    ccy,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    count=count,
                    max_pages=max_pages,
                )
                entry["trade_count"] = trades["trade_count"]
                entry["trade_pages_used"] = trades["pages_used"]
                entry["trade_max_pages_hit"] = trades["max_pages_hit"]
                for kind, kcount in trades["instrument_kinds"].items():
                    instrument_mix[kind] = instrument_mix.get(kind, 0) + kcount
                for kind, kslist in trades["instrument_samples"].items():
                    dest = instrument_samples.setdefault(kind, [])
                    for sample in kslist:
                        if len(dest) < 3:
                            dest.append(sample)
            except Exception as exc:  # noqa: BLE001
                _record_exc(f"user_trades:{ccy}", exc)
            try:
                txn = await _paginate_txn_log(
                    ex,
                    ccy,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    count=count,
                    max_pages=max_pages,
                )
                entry["txn_log_type_summary"] = txn["txn_log_type_summary"]
                entry["txn_pages_used"] = txn["pages_used"]
                entry["txn_max_pages_hit"] = txn["max_pages_hit"]
            except Exception as exc:  # noqa: BLE001
                _record_exc(f"transaction_log:{ccy}", exc)
            per_currency[ccy] = entry
        evidence["per_currency"] = per_currency
        evidence["instrument_mix"] = {
            "counts": instrument_mix,
            "samples": instrument_samples,
        }

        # 4. Subaccount structure (bonus, Phase 72; count-only, masked).
        try:
            subs = await ex.private_get_get_subaccounts({"with_portfolio": "true"})
            subs_result = subs.get("result", []) if isinstance(subs, dict) else []
            sub_count = len(subs_result) if isinstance(subs_result, list) else 0
            evidence["subaccounts_observation"] = {
                "count": sub_count,
                "sees_any": sub_count > 0,
            }
        except Exception as exc:  # noqa: BLE001
            evidence["subaccounts_observation"] = {
                "count": 0,
                "sees_any": False,
                "note": "not permitted",
                "error": str(scrub_freeform_string(str(exc))),
            }
    finally:
        await aclose_exchange(ex)

    # 5. Geo-block observation. Amsterdam egress → no block expected.
    if any(o.get("geo_blocked") for o in geo_observations):
        evidence["geo_block_observation"] = {
            "blocked": True,
            "observations": geo_observations,
        }
    else:
        evidence["geo_block_observation"] = {
            "blocked": False,
            "note": (
                "no block observed from Amsterdam egress — marker deferred to "
                "observed-on-block; classifier is the fail-safe"
            ),
            "errors": geo_observations,
        }

    return evidence


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint. Prints ONE sanitized JSON object to stdout on success.

    Exit codes: 0 success, 2 scope violation, 3 missing env vars, 1 other.
    """
    import argparse
    import asyncio
    import json
    import os
    import sys
    import time

    parser = argparse.ArgumentParser(
        description="Deribit read-only ground-truth harness (DRB-01)."
    )
    parser.add_argument("--start-ms", type=int, default=DEFAULT_START_MS)
    parser.add_argument("--end-ms", type=int, default=None)
    parser.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES)
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT)
    args = parser.parse_args(argv)

    client_id = os.getenv("DERIBIT_CLIENT_ID")
    client_secret = os.getenv("DERIBIT_CLIENT_SECRET")
    if not client_id or not client_secret:
        print(
            "ERROR: DERIBIT_CLIENT_ID and DERIBIT_CLIENT_SECRET must be set "
            "(Railway env only; values are never printed).",
            file=sys.stderr,
        )
        return 3

    end_ms = args.end_ms if args.end_ms is not None else int(time.time() * 1000)
    try:
        evidence = asyncio.run(
            run(
                client_id,
                client_secret,
                start_ms=args.start_ms,
                end_ms=end_ms,
                max_pages=args.max_pages,
                count=args.count,
            )
        )
    except ScopeViolationError as exc:
        # Scope strings are not secrets — print the fail-loud reason verbatim.
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print("ERROR: " + str(scrub_freeform_string(str(exc))), file=sys.stderr)
        return 1

    clean = sanitize_evidence(evidence)
    assert_sanitized(clean)
    print(json.dumps(clean, indent=2, default=str))
    return 0


if __name__ == "__main__":
    import sys as _sys

    _sys.exit(main())
