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
