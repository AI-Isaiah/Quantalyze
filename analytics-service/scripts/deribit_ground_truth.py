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
from collections import Counter
from collections.abc import Mapping
from typing import Any

from services.deribit_txn import classify_instrument
from services.key_permissions import _WRITE_SCOPE_SUFFIXES, scope_is_read_only
from services.redact import scrub_freeform_string, truncate_account_id

# ``_WRITE_SCOPE_SUFFIXES`` is re-exported here (unused directly since DRB-03
# relocated the gate to services.key_permissions) so the harness's public
# surface and any importer of the name stay valid — single definition lives in
# services.key_permissions now.
_ = _WRITE_SCOPE_SUFFIXES


def _redact_secret_values(text: str, *secrets: str | None) -> str:
    """Belt-and-braces (CR-1): scrub the freeform text AND explicitly replace
    the literal ``client_id`` / ``client_secret`` VALUES with ``[REDACTED]``.

    ``scrub_freeform_string`` only redacts ``key: value`` / JWT shapes. A ccxt
    error that echoes the raw credential inside a URL, JSON body, or bare token
    (no ``client_secret=`` prefix) would slip through. Substituting the known
    literal values first guarantees the credential never reaches stderr even if
    the exception format is one the freeform regex does not recognize.
    """
    out = str(scrub_freeform_string(str(text)))
    for secret in secrets:
        if secret:
            out = out.replace(secret, "[REDACTED]")
    # F3 belt: the evidence path re-checks with assert_sanitized; give the
    # error path the same guarantee. Literal replacement misses encoded forms
    # and the post-auth access_token (e.g. "Bearer <tok>" — the freeform value
    # capture stops at the space). If a token-like run survives, withhold the
    # text rather than leak it.
    try:
        assert_sanitized({"error": out})
    except Exception:  # noqa: BLE001 - any unsanitized residue -> withhold
        return "[error text withheld - unsanitized token detected]"
    return out

# ---------------------------------------------------------------------------
# Read-only scope gate (T-67-02) — fail loud BEFORE any data fetch.
# ---------------------------------------------------------------------------
# The scope gate (``_WRITE_SCOPE_SUFFIXES`` + ``scope_is_read_only``) now lives
# in services.key_permissions as a SINGLE definition (DRB-03) — production key
# validation must not depend on this scripts module. Both names are imported at
# the top of this file and keep their original semantics/call sites here.


# ---------------------------------------------------------------------------
# Transaction-log summary (THE phase question) — whitelisted fields only.
# ---------------------------------------------------------------------------

# The RESEARCH Pitfall 1 field set + the Phase-70 Wave-0 widening
# (index_price, mark_price, price, id, trade_id, user_seq — RESEARCH Pitfall 2/5):
# index_price/mark_price answer A1 (event-time coin->USD price presence on
# settlement rows), price/id/trade_id/user_seq expose the native funding-dedup
# axis and cashflow composition. Anything OUTSIDE this set (username, user_id,
# email, ...) MUST NOT enter a committed sample. "id" stays in _MASK_KEYS so it
# is MASKED at the sanitization boundary — masked presence is all A1/A4 need.
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
    # Phase-70 Wave-0 additions:
    "index_price",
    "mark_price",
    "price",
    "id",
    "trade_id",
    "user_seq",
    # Phase-70 re-probe (field-semantics): is realized cash in `cashflow` or in
    # `change`? Fees booked into `change` while `cashflow==0` would be silently
    # dropped by a cashflow-only sum. `fee` is the reconciler: if
    # change == cashflow - fee, the fee lives in `change` (dropped by cashflow).
    "change",
    "fee",
    "fee_balance",
)

# Per-type cap on whitelisted sample rows kept in the evidence JSON. A handful
# per type — kept kind-diverse — characterizes the row shape; the numeric stats
# (not the samples) answer A1/A3.
MAX_TXN_SAMPLES_PER_TYPE: int = 5


def _as_float(value: Any) -> float | None:
    """Coerce a Deribit numeric field to float, or None if not numeric.

    Deribit/ccxt returns amount/cashflow/change/index_price/etc. as STRINGS
    (including scientific notation: "5.3e3", "-1.6328e-4"). ``float()`` parses
    all of these — mirroring the production ``float(row.get(...) or 0.0)``
    coercion so the harness stats measure the same values production sums.
    Booleans are rejected (``float(True)`` would silently become 1.0).
    """
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _sample_kind(sample: Mapping[str, Any]) -> str:
    """Instrument kind of a whitelisted sample, derived from its own
    ``instrument_name`` field (so page-merge can re-derive it without the raw
    row). Never raises."""
    return classify_instrument(str(sample.get("instrument_name", "")))


def _add_kind_diverse_sample(
    bucket: list[dict[str, Any]], sample: Mapping[str, Any], cap: int
) -> None:
    """Append ``sample`` to ``bucket`` in place, keeping at most ``cap`` entries
    and preferring distinct instrument kinds.

    While under the cap every sample is kept. Once full, a NEW-kind sample
    displaces the first entry whose kind is duplicated — so a late-appearing
    kind is never crowded out by a duplicate-kind flood and the evidence keeps
    at least one sample per observed kind (when kinds <= cap). Kind is derived
    from the sample's own whitelisted ``instrument_name``, so this is reusable
    when merging per-page summaries. Pure/never-raising.
    """
    entry = dict(sample)
    if len(bucket) < cap:
        bucket.append(entry)
        return
    kind = _sample_kind(entry)
    kinds = [_sample_kind(existing) for existing in bucket]
    if kind in kinds:
        return
    duplicated = Counter(kinds)
    for index, existing_kind in enumerate(kinds):
        if duplicated[existing_kind] > 1:
            bucket[index] = entry
            return


def summarize_txn_log(rows: list[Mapping[str, Any]]) -> dict[str, Any]:
    """Aggregate transaction-log rows into distinct ``type`` counts, capped
    kind-diverse per-type samples, and the Wave-0 numeric stats.

    Returns:
      - ``type_counts``: distinct ``type`` -> row count.
      - ``type_samples``: ``type`` -> list of up to ``MAX_TXN_SAMPLES_PER_TYPE``
        whitelisted-field samples (kind-diverse). Samples carry ONLY whitelisted
        fields so committing the evidence can never leak username/user_id/email
        (T-70-01).
      - ``settlement_price_stats``: over ``type=settlement`` rows,
        ``{total, index_price_present, mark_price_present}`` — the NUMERIC A1
        answer (never trust a single sample for "is the field populated").
      - ``trade_cashflow_stats``: per classify-kind over ``type=trade`` rows,
        ``{total, cashflow_nonzero}`` — the NUMERIC A3 answer (inverse-perp
        double-count risk).
      - ``txn_trade_row_count``: count of ``type=="trade"`` rows — the txn-log
        completeness stream (Pitfall 5: the honesty anchor, distinct from the
        under-returning trades endpoint).
      - ``per_type_field_stats``: per distinct ``type``,
        ``{total, cashflow_nonzero, change_nonzero, cashflow_ne_change}`` — the
        re-probe field-semantics answer. ``cashflow_ne_change`` counts rows
        where BOTH ``cashflow`` and ``change`` are numeric and differ beyond a
        tiny epsilon: if it is nonzero for a cash-bearing type (esp. ``trade``),
        realized cash (fees) lives in ``change`` and a cashflow-only sum drops
        it. Also settles ``negative_balance_fee`` / ``options_settlement_summary``
        cash-bearing-vs-informational (nonzero counts ⇒ cash-bearing).

    Pure and never-raising on malformed rows (untrusted exchange input).
    """
    type_counts: dict[str, int] = {}
    type_samples: dict[str, list[dict[str, Any]]] = {}
    settlement_price_stats: dict[str, int] = {
        "total": 0,
        "index_price_present": 0,
        "mark_price_present": 0,
    }
    trade_cashflow_stats: dict[str, dict[str, int]] = {}
    per_type_field_stats: dict[str, dict[str, float]] = {}
    cashflow_ne_change_samples: dict[str, list[dict[str, Any]]] = {}
    txn_trade_row_count = 0

    for row in rows:
        if not isinstance(row, Mapping):
            continue
        row_type = str(row.get("type", "unknown"))
        type_counts[row_type] = type_counts.get(row_type, 0) + 1

        sample = {field: row[field] for field in _TXN_LOG_WHITELIST if field in row}
        _add_kind_diverse_sample(
            type_samples.setdefault(row_type, []), sample, MAX_TXN_SAMPLES_PER_TYPE
        )

        # Re-probe: keep a few WHITELISTED samples of rows where cashflow != change
        # so the divergence can be root-caused (is `change` == `cashflow - fee`?).
        _cf = _as_float(row.get("cashflow"))
        _ch = _as_float(row.get("change"))
        if (
            _cf is not None
            and _ch is not None
            and abs(_cf - _ch) > 1e-12
            and len(cashflow_ne_change_samples.setdefault(row_type, [])) < 8
        ):
            cashflow_ne_change_samples[row_type].append(sample)

        field_stats = per_type_field_stats.setdefault(
            row_type,
            {
                "total": 0,
                "cashflow_nonzero": 0,
                "change_nonzero": 0,
                "cashflow_ne_change": 0,
                # Aggregate magnitudes: (change_sum - cashflow_sum) is the total
                # FEE this row-type contributes — i.e. how much a cashflow-only
                # daily sum OVER-states the return by dropping fees.
                "cashflow_sum": 0.0,
                "change_sum": 0.0,
            },
        )
        field_stats["total"] += 1
        # Deribit returns numeric fields as STRINGS (incl. sci-notation, e.g.
        # "5.3e3", "-1.6328e-4"); coerce exactly as production float() does so the
        # nonzero/differ counts reflect real cash, not a str-vs-number artifact.
        cf = _as_float(row.get("cashflow"))
        ch = _as_float(row.get("change"))
        if cf is not None and cf != 0:
            field_stats["cashflow_nonzero"] += 1
        if ch is not None and ch != 0:
            field_stats["change_nonzero"] += 1
        if cf is not None and ch is not None and abs(cf - ch) > 1e-12:
            field_stats["cashflow_ne_change"] += 1
        if cf is not None:
            field_stats["cashflow_sum"] += cf
        if ch is not None:
            field_stats["change_sum"] += ch

        if row_type == "settlement":
            settlement_price_stats["total"] += 1
            if row.get("index_price") is not None:
                settlement_price_stats["index_price_present"] += 1
            if row.get("mark_price") is not None:
                settlement_price_stats["mark_price_present"] += 1
        elif row_type == "trade":
            txn_trade_row_count += 1
            kind = classify_instrument(str(row.get("instrument_name", "")))
            stats = trade_cashflow_stats.setdefault(
                kind, {"total": 0, "cashflow_nonzero": 0}
            )
            stats["total"] += 1
            cashflow = row.get("cashflow")
            if isinstance(cashflow, (int, float)) and cashflow != 0:
                stats["cashflow_nonzero"] += 1

    return {
        "type_counts": type_counts,
        "type_samples": type_samples,
        "settlement_price_stats": settlement_price_stats,
        "trade_cashflow_stats": trade_cashflow_stats,
        "per_type_field_stats": per_type_field_stats,
        "cashflow_ne_change_samples": cashflow_ne_change_samples,
        "txn_trade_row_count": txn_trade_row_count,
    }


# ---------------------------------------------------------------------------
# Instrument classification — inverse / linear / option / future.
# ---------------------------------------------------------------------------
# `classify_instrument` (+ `_LINEAR_MARGIN_MARKERS` / `_FUTURE_EXPIRY_RE`) now
# live as a SINGLE definition in services.deribit_txn (D-05) — the same
# scope-gate lift already applied to services.key_permissions. Production
# Deribit money-math (Phase 70) must not depend on this scripts module, so the
# canonical classifier is imported at the top of this file; the harness keeps
# its original call sites (_sample_kind, summarize_txn_log, _paginate_trades).


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
    {"username", "user_id", "email", "system_name", "id", "login"}
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

# Per-instrument-kind cap on whitelisted sample rows kept in the evidence JSON
# (IN-4). A handful per kind is enough to characterize the shape; the counts,
# not the samples, answer THE phase question.
MAX_SAMPLES_PER_KIND: int = 3


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


def _build_history_params(
    base: Mapping[str, Any], subaccount_id: int | None
) -> dict[str, Any]:
    """Return a copy of ``base`` request params, adding ``subaccount_id`` ONLY
    when a non-None sub id is passed (the main scope omits it — Deribit rejects
    a null subaccount_id). Pure/I/O-free so the A2 inclusion rule is unit-
    testable without a network round-trip. Never mutates ``base``.
    """
    params = dict(base)
    if subaccount_id is not None:
        params["subaccount_id"] = subaccount_id
    return params


async def _paginate_trades(
    ex: Any,
    ccy: str,
    *,
    start_ms: int,
    end_ms: int,
    count: int,
    max_pages: int,
    subaccount_id: int | None = None,
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
    boundary_overlap_stall = False
    instrument_kinds: dict[str, int] = {}
    samples: dict[str, list[dict[str, Any]]] = {}
    seen: set[str] = set()
    cursor = start_ms
    while True:
        if pages_used >= max_pages:
            max_pages_hit = True
            break
        resp = await ex.private_get_get_user_trades_by_currency_and_time(
            _build_history_params(
                {
                    "currency": ccy,
                    "kind": "any",
                    # Pass ONLY start_timestamp (ascending). Passing BOTH bounds
                    # anchors the count-truncated page at end_timestamp (newest
                    # `count`), so advancing start_timestamp=last_ts collapses the
                    # window → has_more=false after ONE page (the BTC one-page
                    # stall, P70 Wave-0 docs re-research). One bound + sorting=asc
                    # walks forward from the cursor.
                    "start_timestamp": cursor,
                    "count": min(count, 1000),
                    # `historical=true` fetches full history; default (false)
                    # returns ONLY the last 24h. `include_old` is a legacy no-op.
                    "historical": "true",
                    "sorting": "asc",
                },
                subaccount_id,
            )
        )
        result = resp.get("result", {}) if isinstance(resp, dict) else {}
        trades = result.get("trades", []) or []
        pages_used += 1
        if not trades:
            break
        new_in_page = 0
        for trade in trades:
            trade_id = str(trade.get("trade_id", ""))
            if trade_id and trade_id in seen:
                continue
            if trade_id:
                seen.add(trade_id)
            new_in_page += 1
            trade_count += 1
            kind = classify_instrument(str(trade.get("instrument_name", "")))
            instrument_kinds[kind] = instrument_kinds.get(kind, 0) + 1
            bucket = samples.setdefault(kind, [])
            if len(bucket) < MAX_SAMPLES_PER_KIND:
                bucket.append(
                    {f: trade[f] for f in _TXN_LOG_WHITELIST if f in trade}
                )
        page_full = len(trades) >= min(count, 1000)
        has_more = bool(result.get("has_more", False))
        last_ts = trades[-1].get("timestamp")
        # IN-8 same-ms cluster stall guard: cursor advances to last_ts
        # (inclusive), so a same-millisecond cluster LARGER than `count` pins
        # last_ts == cursor and every page re-fetches the identical rows —
        # ZERO new trade_ids — forever (until max_pages). If a full page adds
        # no new ids yet the server still claims has_more and cannot advance
        # the cursor, stop: advancing past last_ts would SKIP the rest of the
        # cluster (a boundary-overlap data loss), so we surface the stall in
        # the evidence rather than silently truncate or spin.
        if (has_more or page_full) and new_in_page == 0 and last_ts == cursor:
            boundary_overlap_stall = True
            break
        # `has_more` has no documented reliability guarantee and can come back
        # false prematurely; also continue while a page came back FULL (docs
        # re-research). Stop only on a genuinely short page.
        if (not has_more and not page_full) or not isinstance(
            last_ts, int
        ) or last_ts < cursor:
            break
        cursor = last_ts
    return {
        "trade_count": trade_count,
        "pages_used": pages_used,
        "max_pages_hit": max_pages_hit,
        "boundary_overlap_stall": boundary_overlap_stall,
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
    subaccount_id: int | None = None,
) -> dict[str, Any]:
    """Fully paginate the transaction log for one currency, following the
    ``continuation`` token, merging each page through ``summarize_txn_log``.

    The realized/funding partition (A3), the event-time price presence (A1) and
    the txn-log completeness stream (``txn_trade_row_count`` — the Pitfall 5
    honesty anchor) all fall out of the merged per-page summaries.
    """
    type_counts: dict[str, int] = {}
    type_samples: dict[str, list[dict[str, Any]]] = {}
    settlement_price_stats: dict[str, int] = {
        "total": 0,
        "index_price_present": 0,
        "mark_price_present": 0,
    }
    trade_cashflow_stats: dict[str, dict[str, int]] = {}
    per_type_field_stats: dict[str, dict[str, float]] = {}
    cashflow_ne_change_samples: dict[str, list[dict[str, Any]]] = {}
    txn_trade_row_count = 0
    pages_used = 0
    max_pages_hit = False
    continuation: str | None = None
    while True:
        if pages_used >= max_pages:
            max_pages_hit = True
            break
        params = _build_history_params(
            {
                "currency": ccy,
                "start_timestamp": start_ms,
                "end_timestamp": end_ms,
                # get_transaction_log documented max count is 250; sending 1000
                # over-caps and a client treating a short page as the last page
                # stops early (the P70 Wave-0 under-fetch). Clamp to 250 and
                # follow `continuation` to null.
                "count": min(count, 250),
            },
            subaccount_id,
        )
        if continuation:
            params["continuation"] = continuation
        resp = await ex.private_get_get_transaction_log(params)
        result = resp.get("result", {}) if isinstance(resp, dict) else {}
        logs = result.get("logs", []) or []
        pages_used += 1
        page = summarize_txn_log(logs)
        for row_type, row_count in page["type_counts"].items():
            type_counts[row_type] = type_counts.get(row_type, 0) + row_count
        for row_type, samples in page["type_samples"].items():
            bucket = type_samples.setdefault(row_type, [])
            for sample in samples:
                _add_kind_diverse_sample(bucket, sample, MAX_TXN_SAMPLES_PER_TYPE)
        for stat_key, stat_value in page["settlement_price_stats"].items():
            settlement_price_stats[stat_key] += stat_value
        for kind, kind_stats in page["trade_cashflow_stats"].items():
            dest = trade_cashflow_stats.setdefault(
                kind, {"total": 0, "cashflow_nonzero": 0}
            )
            dest["total"] += kind_stats["total"]
            dest["cashflow_nonzero"] += kind_stats["cashflow_nonzero"]
        for row_type, fstats in page["per_type_field_stats"].items():
            dest_f = per_type_field_stats.setdefault(
                row_type,
                {
                    "total": 0,
                    "cashflow_nonzero": 0,
                    "change_nonzero": 0,
                    "cashflow_ne_change": 0,
                    "cashflow_sum": 0.0,
                    "change_sum": 0.0,
                },
            )
            for k, v in fstats.items():
                dest_f[k] += v
        for row_type, samples in page.get("cashflow_ne_change_samples", {}).items():
            bucket = cashflow_ne_change_samples.setdefault(row_type, [])
            for sample in samples:
                if len(bucket) < 8:
                    bucket.append(sample)
        txn_trade_row_count += page["txn_trade_row_count"]
        continuation = result.get("continuation")
        if not continuation or not logs:
            break
    return {
        "txn_log_type_summary": {
            "type_counts": type_counts,
            "type_samples": type_samples,
            "settlement_price_stats": settlement_price_stats,
            "trade_cashflow_stats": trade_cashflow_stats,
            "per_type_field_stats": per_type_field_stats,
            "cashflow_ne_change_samples": cashflow_ne_change_samples,
        },
        "txn_trade_row_count": txn_trade_row_count,
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
        # CR-1 belt-and-braces: the auth call is the ONE place the raw
        # credentials cross the wire, so an error here is the likeliest to echo
        # them back. Re-raise with the literal client_id/client_secret values
        # stripped so nothing downstream (incl. main()'s except) can leak them.
        try:
            auth = await ex.public_get_auth(
                {
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                }
            )
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                _redact_secret_values(str(exc), client_id, client_secret)
            ) from None
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

        # 3. Enumerate subaccounts (D-01) — the raw ids drive the fetch loop but
        # NEVER enter the evidence (scopes are labelled by ordinal "main"/"sub_N"
        # — defense in depth on top of masking). get_subaccounts requires only
        # account:read; an error here IS a signal (record, continue main-only).
        sub_ids: list[int] = []
        try:
            subs = await ex.private_get_get_subaccounts({"with_portfolio": "false"})
            subs_result = subs.get("result", []) if isinstance(subs, dict) else []
            result_list = subs_result if isinstance(subs_result, list) else []
            for entry_obj in result_list:
                if not isinstance(entry_obj, dict):
                    continue
                # Deribit subaccount id is an int; tolerate a digit-string form.
                raw_id = entry_obj.get("id")
                if isinstance(raw_id, int):
                    sub_ids.append(raw_id)
                elif isinstance(raw_id, str) and raw_id.isdigit():
                    sub_ids.append(int(raw_id))
            # Diagnostic (structural only — field NAMES + top-level response keys,
            # never any value): tells us the real shape when count looks wrong.
            evidence["subaccounts_observation"] = {
                "count": len(sub_ids),
                "sees_any": len(sub_ids) > 0,
                "_diag_result_len": len(result_list),
                "_diag_entry_keys": sorted(result_list[0].keys())
                if result_list and isinstance(result_list[0], dict)
                else [],
                "_diag_id_type": type(result_list[0].get("id")).__name__
                if result_list and isinstance(result_list[0], dict)
                else None,
                "_diag_response_keys": sorted(subs.keys())
                if isinstance(subs, dict)
                else [],
            }
        except Exception as exc:  # noqa: BLE001
            _record_exc("get_subaccounts", exc)
            evidence["subaccounts_observation"] = {
                "count": 0,
                "sees_any": False,
                "note": "not permitted",
                "error": str(scrub_freeform_string(str(exc))),
            }

        # scopes = main (None) + every enumerated subaccount, labelled by ordinal.
        scopes: list[tuple[str, int | None]] = [("main", None)]
        for ordinal, raw_sid in enumerate(sub_ids, start=1):
            scopes.append((f"sub_{ordinal}", raw_sid))

        # 4. Per-scope × per-currency full-pagination capture of BOTH streams
        # (trades endpoint + txn-log) plus per-account equity. A2 (subaccount
        # reach) and the Pitfall-5 honesty anchor both fall out of these counts.
        capture_ccys = held or available
        per_scope: dict[str, Any] = {}
        instrument_mix: dict[str, int] = {}
        instrument_samples: dict[str, list[dict[str, Any]]] = {}
        account_equity: dict[str, Any] = {}
        total_trades_all_scopes = 0
        total_txn_trade_rows_all_scopes = 0

        for scope_label, sid in scopes:
            per_currency: dict[str, Any] = {}
            scope_equity: dict[str, Any] = {}
            scope_trade_total = 0
            scope_txn_trade_total = 0

            # Per-account USD equity anchor (numeric-only figures — the value
            # 70-06's dailies anchor + revert-proof shape test rely on).
            for ccy in capture_ccys:
                try:
                    summ = await ex.private_get_get_account_summary(
                        _build_history_params({"currency": ccy}, sid)
                    )
                    summ_result = (
                        summ.get("result", {}) if isinstance(summ, dict) else {}
                    )
                    figures = {
                        field: summ_result[field]
                        for field in (
                            "equity",
                            "equity_usd",
                            "margin_balance",
                            "balance",
                        )
                        if isinstance(summ_result.get(field), (int, float))
                    }
                    if figures:
                        scope_equity[ccy] = figures
                except Exception as exc:  # noqa: BLE001
                    _record_exc(f"account_summary:{scope_label}:{ccy}", exc)
            account_equity[scope_label] = scope_equity

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
                        subaccount_id=sid,
                    )
                    entry["trade_count"] = trades["trade_count"]
                    entry["trade_pages_used"] = trades["pages_used"]
                    entry["trade_max_pages_hit"] = trades["max_pages_hit"]
                    entry["trade_boundary_overlap_stall"] = trades[
                        "boundary_overlap_stall"
                    ]
                    scope_trade_total += trades["trade_count"]
                    total_trades_all_scopes += trades["trade_count"]
                    for kind, kcount in trades["instrument_kinds"].items():
                        instrument_mix[kind] = instrument_mix.get(kind, 0) + kcount
                    for kind, kslist in trades["instrument_samples"].items():
                        dest = instrument_samples.setdefault(kind, [])
                        for sample in kslist:
                            if len(dest) < MAX_SAMPLES_PER_KIND:
                                dest.append(sample)
                except Exception as exc:  # noqa: BLE001
                    _record_exc(f"user_trades:{scope_label}:{ccy}", exc)
                try:
                    txn = await _paginate_txn_log(
                        ex,
                        ccy,
                        start_ms=start_ms,
                        end_ms=end_ms,
                        count=count,
                        max_pages=max_pages,
                        subaccount_id=sid,
                    )
                    entry["txn_log_type_summary"] = txn["txn_log_type_summary"]
                    entry["txn_trade_row_count"] = txn["txn_trade_row_count"]
                    entry["txn_pages_used"] = txn["pages_used"]
                    entry["txn_max_pages_hit"] = txn["max_pages_hit"]
                    scope_txn_trade_total += txn["txn_trade_row_count"]
                    total_txn_trade_rows_all_scopes += txn["txn_trade_row_count"]
                except Exception as exc:  # noqa: BLE001
                    _record_exc(f"transaction_log:{scope_label}:{ccy}", exc)
                per_currency[ccy] = entry

            per_scope[scope_label] = {
                "per_currency": per_currency,
                "scope_trade_total": scope_trade_total,
                "scope_txn_trade_total": scope_txn_trade_total,
            }

        evidence["per_scope"] = per_scope
        evidence["account_equity"] = account_equity
        evidence["instrument_mix"] = {
            "counts": instrument_mix,
            "samples": instrument_samples,
        }
        # BOTH streams reconciled per-run: the trades endpoint under-returns vs
        # the txn-log type=trade count (Pitfall 5), so the checkpoint records
        # WHICH stream matches the known 18,778/21,014/61,248 as the D-02 anchor.
        evidence["history_completeness"] = {
            "total_trades_all_scopes": total_trades_all_scopes,
            "total_txn_trade_rows_all_scopes": total_txn_trade_rows_all_scopes,
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
        # CR-1 belt-and-braces: scrub key:value shapes AND strip the literal
        # client_id/client_secret values before anything reaches stderr.
        print(
            "ERROR: " + _redact_secret_values(str(exc), client_id, client_secret),
            file=sys.stderr,
        )
        return 1

    clean = sanitize_evidence(evidence)
    assert_sanitized(clean)
    print(json.dumps(clean, indent=2, default=str))
    return 0


if __name__ == "__main__":
    import sys as _sys

    _sys.exit(main())
