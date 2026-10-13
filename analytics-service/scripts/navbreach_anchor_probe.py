"""Phase 166.3.1 NAVBREACH probe (D-01, orchestrator decision OQ-1): why does a
Deribit composite member's ``native_nav`` inception gate breach, measured on the
REAL member ledgers.

WHY: RESEARCH ranks H1 first. The anchor handed to the gate is the venue summary
``equity``. Deribit documents ``equity`` as ``balance`` plus the futures session
unrealized AND realized terms plus the options mark value, while the ledger books
session PnL only at the 08:00 UTC settlement. Our wedge strips the session
unrealized term and the options value and never reads the session realized term
at all, so an account that closed trades since the last settlement carries an
unbooked realized amount in the anchor. Whether that is the mechanism on THESE
accounts hinges on a live venue field no file in this repo reads today. A
synthetic replay proves the mechanism can exist; only this probe proves it is the
one that fired. If the residual is NOT explained by the summary fields it is venue
data (H3) and the phase stops for a founder decision.

WHAT IT DOES, per member and per pnl basis, with the worker's own code:
  1. reads the venue anchor ONCE (the single account-summaries call inside
     ``fetch_deribit_native_account_state``, captured by a recording wrapper; a
     second read raises, because two reads would reintroduce the skew this probe
     is measuring);
  2. builds the member ledger exactly as ``_reconstruct_deribit`` does;
  3. runs the REAL gate (``combine_native_ledger``) on four wedges: today's (the
     one the ledger ships with; since DERIBITWEDGE the cash basis ships
     ``equity - balance``), the realized-term-only candidate (the pre-DERIBITWEDGE
     component wedge plus the futures session RPL, built from the summary and never
     as a delta off today's, which would count the term twice), the full
     explicit-terms candidate (the realized term plus the H1b options correction)
     and the balance-anchored candidate (anchor = summary ``balance``), so a closure
     is attributed to ONE term;
  4. decomposes the residual against each venue summary field, and counts the
     ledger rows booked after the anchor read (H2). When there are any it rebuilds
     the ledger without them and re-runs the realized-term candidate.

Every verdict is ``pass``, ``breach:<ratio>`` or the refusal class name; every
other figure is a ratio, a boolean, a count or an hour. A venue field the summary
does not carry reads ``field-absent``, never ``0.0``.

REDACTION CONTRACT (the output is pasted into a tracked file in a public repo):
no balance, equity, PnL amount, key, secret, account or strategy identifier, and
no timestamp finer than the run date. The only path to stdout is ``emit_record``,
which refuses any key outside ``RECORD_KEYS`` / ``CURRENCY_KEYS``, any value
outside the declared vocabulary, and any float not already rounded to three
significant figures, then re-checks with ``assert_sanitized``. Logging is switched
off for the run, and a failure prints the exception TYPE only.

D-06: a ledger that fails to build also emits ``ledger_error_detail``: the
allow-listed exception class (``other`` for any class off the list) and, when the
message names exactly one known ledger field, that field (``Class:field``). The
message text, row ids and values are searched, never copied.

READ-ONLY: SELECTs against ``strategy_keys`` and ``api_keys`` and venue GET reads.
It does not call the allocator key preflight (whose circuit-breaker arm can write)
and the venue wrapper exposes read endpoints only. Keys are decrypted inside the
worker process and nowhere else.

USAGE (the id is typed on the command line only, never into a tracked file):
  # A. stream the committed file to the worker's interpreter, if the CLI forwards stdin
  railway ssh "cd /app && python - --strategy-id <id>" < analytics-service/scripts/navbreach_anchor_probe.py
  # B. once the file is deployed on the worker
  railway ssh "cd /app && python -m scripts.navbreach_anchor_probe --strategy-id <id>"
  # optional: --bases cash_settlement   (default measures all three bases)
Paste only the lines that start with ``{"`` (one per member and basis).

EXIT CODES
----------
  0  success, one JSON line per member and basis printed
  2  refused before any decrypt: no members, or a member that is not an active
     ``deribit`` key
  1  any other failure (the exception TYPE only on stderr)
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import logging
import math
import re
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

from scripts.deribit_ground_truth import assert_sanitized
from services.broker_dailies import combine_native_ledger
from services.deribit_ingest import (
    CurrencyEnumerationError,
    DeribitTransientReadError,
    LedgerCompletenessError,
    LedgerTruncatedError,
    ScopeAuthError,
    _combined_session_upl,
    assert_ledger_complete,
    build_deribit_native_ledger,
    fetch_deribit_native_account_state,
)
from services.deribit_txn import (
    PNL_BASIS_CASH_SETTLEMENT,
    PNL_BASIS_MARK_TO_MARKET,
    PNL_BASIS_SMOOTHED_MTM,
    LedgerValuationError,
    OptionRowFieldMissingError,
)
from services.external_flows import USD_FAMILY
from services.nav_twr import NavReconstructionError
from services.native_nav import (
    INCEPTION_NATIVE_DUST_REL,
    InceptionReconciliationError,
    _build_buckets,
    _roll_bucket,
)

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_REFUSED = 2

ALL_BASES: tuple[str, ...] = (
    PNL_BASIS_CASH_SETTLEMENT,
    PNL_BASIS_MARK_TO_MARKET,
    PNL_BASIS_SMOOTHED_MTM,
)

# Hard bound on each live crawl, so a slow venue read ends the probe instead of
# wedging a shell. The worker bounds its own crawls the same way.
CRAWL_TIMEOUT_S: float = 900.0

_USD_BUCKET = "USD"

# The only venue endpoints the wrapper will hand out: GET reads.
_READ_PREFIXES = ("private_get_get_", "public_get_")

# Every other build failure is a PERMANENT ledger error in the worker too
# (``_PERMANENT_LEDGER_ERRORS``): recorded by type, not measured.
_BUILD_ERRORS = (
    LedgerTruncatedError,
    CurrencyEnumerationError,
    ScopeAuthError,
    LedgerValuationError,
    NavReconstructionError,
    DeribitTransientReadError,
)

# Two venue fields are "equal" when they agree to float noise.
_FIELD_EQ_ABS = 1e-12
_FIELD_EQ_REL = 1e-9

FIELD_ABSENT = "field-absent"
NOT_RUN = "not-run"

# D-06: the detail beside ``build-error:<Type>``. Two closed vocabularies, and
# nothing else can reach stdout through it. The class name is emitted only when
# it is one of the build-error classes above (any other subclass reads
# ``other``); a field name only when the message names exactly one of these
# known ledger row / summary fields. The message itself is never kept: it embeds
# a row id and a repr of the offending value.
LEDGER_ERROR_CLASSES: frozenset[str] = frozenset(
    cls.__name__ for cls in (*_BUILD_ERRORS, OptionRowFieldMissingError)
)
LEDGER_ERROR_FIELDS: frozenset[str] = frozenset(
    {
        "commission",
        "position",
        "change",
        "timestamp",
        "price",
        "index_price",
        "amount",
        "balance",
        "equity",
        "currency",
        "instrument_name",
        "interest_pl",
        "session_upl",
        "options_value",
    }
)
OTHER = "other"
_FIELD_RES: dict[str, re.Pattern[str]] = {
    name: re.compile(rf"(?<![A-Za-z0-9_]){re.escape(name)}(?![A-Za-z0-9_])")
    for name in sorted(LEDGER_ERROR_FIELDS)
}


def classify_ledger_error(exc: BaseException) -> str:
    """The redacted detail for a failed ledger build: ``<Class>`` or
    ``<Class>:<field>``, or ``other`` for a class off the allow-list.

    The field is read only for the ledger-valuation family, and only when the
    message names EXACTLY ONE allow-listed field (two names is ambiguous, so
    neither is claimed). The message is searched, never copied."""
    name = type(exc).__name__
    if name not in LEDGER_ERROR_CLASSES:
        return OTHER
    if not isinstance(exc, LedgerValuationError):
        return name
    try:
        message = str(exc)
    except Exception:  # noqa: BLE001 - a hostile __str__ must not break the probe
        return name
    named = [f for f, pattern in _FIELD_RES.items() if pattern.search(message)]
    return f"{name}:{named[0]}" if len(named) == 1 else name


def _is_ledger_error_detail(x: Any) -> bool:
    if x is None:
        return True
    if not isinstance(x, str):
        return False
    parts = x.split(":")
    if len(parts) == 1:
        return parts[0] == OTHER or parts[0] in LEDGER_ERROR_CLASSES
    return len(parts) == 2 and parts[0] in LEDGER_ERROR_CLASSES and parts[1] in LEDGER_ERROR_FIELDS


# ---------------------------------------------------------------------------
# The declared output vocabulary. Anything outside it never reaches stdout.
# ---------------------------------------------------------------------------

RECORD_KEYS: tuple[str, ...] = (
    "member",
    "basis",
    "run_date",
    "hours_since_last_0800_utc",
    "rows_after_anchor",
    "quiet",
    "ledger",
    "ledger_error_detail",
    "gate_today",
    "gate_candidate_rpl_only",
    "gate_candidate_full",
    "gate_candidate_balance",
    "gate_candidate_rpl_only_preanchor",
    "candidate_anchor_equals_balance",
    "session_rpl_equals_futures_plus_options",
    "has_open_options_book",
    "options_session_upl_nonzero",
    "rpl_spelling_used",
    "summary_fields_partial",
    "has_futures_session_rpl_field",
    "has_session_rpl_field",
    "has_options_session_rpl_field",
    "has_balance_field",
    "has_options_session_upl_field",
    "has_session_funding_field",
    "currencies",
)

CURRENCY_KEYS: tuple[str, ...] = (
    "ccy",
    "resid_over_throughput",
    "resid_is_dust",
    "resid_over_futures_session_rpl",
    "resid_over_session_rpl",
    "resid_over_options_session_upl",
    "resid_over_session_funding",
    "candidate_anchor_equals_balance",
    "session_rpl_equals_futures_plus_options",
)

_NUM = r"[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?"
_GATE_RE = re.compile(
    rf"^(?:pass|not-run|field-absent|breach:(?:inf|{_NUM})|[A-Z][A-Za-z0-9]{{2,60}}Error)$"
)
_LEDGER_RE = re.compile(r"^(?:ok|ledger-incomplete|build-error:[A-Z][A-Za-z0-9]{2,60})$")
_LABEL_RE = re.compile(r"^m[0-9]{1,2}$")
_DATE_RE = re.compile(r"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")
_CCY_RE = re.compile(r"^[A-Z0-9]{2,12}$")
_BASES = frozenset(ALL_BASES)
_RPL_SPELLINGS = frozenset({"futures_session_rpl", "session_rpl", "none"})


def sig3(x: float) -> float | str:
    """Round to three significant figures; a non-finite value reads ``non-finite``."""
    if not math.isfinite(x):
        return "non-finite"
    return float(f"{x:.3g}")


def _is_bool(x: Any) -> bool:
    return isinstance(x, bool)


def _is_bool_or_absent(x: Any) -> bool:
    return isinstance(x, bool) or x == FIELD_ABSENT


def _is_count(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0


def _is_sig3_float(x: Any) -> bool:
    return (
        isinstance(x, float)
        and math.isfinite(x)
        and float(f"{x:.3g}") == x
    )


def _is_ratio(x: Any) -> bool:
    if x is None:
        return True
    if isinstance(x, str):
        return x in (FIELD_ABSENT, "non-finite")
    return _is_sig3_float(x)


def _is_hours(x: Any) -> bool:
    return isinstance(x, float) and math.isfinite(x) and 0.0 <= x < 24.0 and round(x, 1) == x


def _is_str_matching(pattern: re.Pattern[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and pattern.match(x) is not None


_RECORD_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "member": _is_str_matching(_LABEL_RE),
    "basis": lambda x: isinstance(x, str) and x in _BASES,
    "run_date": _is_str_matching(_DATE_RE),
    "hours_since_last_0800_utc": _is_hours,
    "rows_after_anchor": _is_count,
    "quiet": _is_bool,
    "ledger": _is_str_matching(_LEDGER_RE),
    "ledger_error_detail": _is_ledger_error_detail,
    "gate_today": _is_str_matching(_GATE_RE),
    "gate_candidate_rpl_only": _is_str_matching(_GATE_RE),
    "gate_candidate_full": _is_str_matching(_GATE_RE),
    "gate_candidate_balance": _is_str_matching(_GATE_RE),
    "gate_candidate_rpl_only_preanchor": _is_str_matching(_GATE_RE),
    "candidate_anchor_equals_balance": _is_bool_or_absent,
    "session_rpl_equals_futures_plus_options": _is_bool_or_absent,
    "has_open_options_book": _is_bool,
    "options_session_upl_nonzero": _is_bool,
    "rpl_spelling_used": lambda x: isinstance(x, str) and x in _RPL_SPELLINGS,
    "summary_fields_partial": _is_bool,
    "has_futures_session_rpl_field": _is_bool,
    "has_session_rpl_field": _is_bool,
    "has_options_session_rpl_field": _is_bool,
    "has_balance_field": _is_bool,
    "has_options_session_upl_field": _is_bool,
    "has_session_funding_field": _is_bool,
}

_CURRENCY_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "ccy": _is_str_matching(_CCY_RE),
    "resid_over_throughput": _is_ratio,
    "resid_is_dust": _is_bool,
    "resid_over_futures_session_rpl": _is_ratio,
    "resid_over_session_rpl": _is_ratio,
    "resid_over_options_session_upl": _is_ratio,
    "resid_over_session_funding": _is_ratio,
    "candidate_anchor_equals_balance": _is_bool_or_absent,
    "session_rpl_equals_futures_plus_options": _is_bool_or_absent,
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
    _check_keys("record", record, RECORD_KEYS)
    for key, check in _RECORD_VALIDATORS.items():
        if not check(record[key]):
            raise ValueError(f"record.{key}: value outside the declared vocabulary")
    currencies = record["currencies"]
    if not isinstance(currencies, list):
        raise ValueError("record.currencies: not a list")
    for i, entry in enumerate(currencies):
        if not isinstance(entry, Mapping):
            raise ValueError(f"record.currencies[{i}]: not a mapping")
        _check_keys(f"record.currencies[{i}]", entry, CURRENCY_KEYS)
        for key, check in _CURRENCY_VALIDATORS.items():
            if not check(entry[key]):
                raise ValueError(
                    f"record.currencies[{i}].{key}: value outside the declared vocabulary"
                )
    assert_sanitized(dict(record))


def emit_record(record: Mapping[str, Any]) -> str:
    """The ONLY path to stdout: validate, then serialize one compact JSON line."""
    validate_record(record)
    return json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False)


# ---------------------------------------------------------------------------
# Pure layer.
# ---------------------------------------------------------------------------


def hours_since_last_0800_utc(now_utc: datetime) -> float:
    """Hours since the most recent 08:00 UTC settlement, to one decimal."""
    now = now_utc.astimezone(timezone.utc)
    last = now.replace(hour=8, minute=0, second=0, microsecond=0)
    if last > now:
        last -= timedelta(days=1)
    return round((now - last).total_seconds() / 3600.0, 1)


def _num(summ: Mapping[str, Any], key: str) -> float | None:
    """A present, finite numeric summary field, else ``None`` (never ``0.0``)."""
    raw = summ.get(key)
    if raw is None or isinstance(raw, bool):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _ccy(summ: Mapping[str, Any]) -> str:
    return str(summ.get("currency", "")).upper()


def _bucket_code(ccy: str) -> str:
    return _USD_BUCKET if ccy in USD_FAMILY else ccy


def _same(a: float, b: float) -> bool:
    return abs(a - b) <= _FIELD_EQ_ABS + _FIELD_EQ_REL * max(abs(a), abs(b))


def _rpl(summ: Mapping[str, Any]) -> float | None:
    """The futures realized session term: ``futures_session_rpl``, else the legacy
    ``session_rpl``. ``None`` when neither is present."""
    value = _num(summ, "futures_session_rpl")
    return value if value is not None else _num(summ, "session_rpl")


def _gate(ledger: Any, wedge: Mapping[str, float], indexable: frozenset[str]) -> str:
    """Run the REAL gate on ``ledger`` with ``wedge`` as its terminal wedge."""
    try:
        combine_native_ledger(
            dataclasses.replace(ledger, terminal_upnl_native=dict(wedge)), indexable
        )
    except InceptionReconciliationError as exc:
        return f"breach:{float(exc.breach_ratio):.3g}"
    except NavReconstructionError as exc:
        return type(exc).__name__
    return "pass"


def _residuals(ledger: Any, indexable: frozenset[str]) -> dict[str, tuple[float, float]]:
    """Per rolled bucket ``(resid, throughput)``, mirroring
    ``_assert_inception_reconciled`` exactly: ``resid = B[d0] - pnl[d0] - flow[d0]``
    from the same bucket build and roll the gate uses, throughput = sum |pnl| +
    sum |flow qty|. A refusal while building the buckets returns nothing; the
    gate verdict already carries its class."""
    try:
        buckets = _build_buckets(ledger, indexable, "deribit")
    except NavReconstructionError:
        return {}
    out: dict[str, tuple[float, float]] = {}
    for bucket in buckets:
        if not _roll_bucket(bucket):
            continue
        d0 = bucket.balance.index[0]
        pnl0 = float(bucket.pnl_unioned.iloc[0])
        flow0 = (
            float(bucket.flow_qty.reindex([d0], fill_value=0.0).iloc[0])
            if not bucket.flow_qty.empty
            else 0.0
        )
        resid = float(bucket.balance.iloc[0]) - pnl0 - flow0
        throughput = float(bucket.pnl_unioned.abs().sum()) + float(bucket.flow_qty.abs().sum())
        out[bucket.code] = (resid, throughput)
    return out


@dataclasses.dataclass(frozen=True)
class _Wedges:
    rpl_only: dict[str, float]
    full: dict[str, float]
    balance: dict[str, float]


def _wedges(
    summaries: Sequence[Mapping[str, Any]], today: Mapping[str, float], basis: str
) -> _Wedges:
    """The three candidate terminal wedges, per currency code. A summary that lacks
    the realized term contributes no realized term to its OWN currency (rpl_only,
    full); whether the field is absent from the whole member is reported
    separately. A currency with no summary keeps today's wedge.

    Every candidate is built from the summary's explicit terms, never as a delta
    off ``today``. ``rpl_only`` is the PRE-DERIBITWEDGE component wedge (the
    combined session uPnL, plus ``options_value`` on the cash basis) plus the
    realized term. Since DERIBITWEDGE the shipped cash-basis wedge is
    ``equity - balance``, which already carries the realized term, so
    ``today + rpl`` would count it twice and report a breach no wedge ships."""
    rpl_only = dict(today)
    full = dict(today)
    balance = dict(today)
    for summ in summaries:
        ccy = _ccy(summ)
        if not ccy:
            continue
        equity = _num(summ, "equity") or 0.0
        combined, _read, _unreadable = _combined_session_upl(summ)
        options_session = _num(summ, "options_session_upl") or 0.0
        futures_upl = combined - options_session
        options_value = _num(summ, "options_value") or 0.0
        rpl = _rpl(summ)
        if basis == PNL_BASIS_CASH_SETTLEMENT:
            rpl_only[ccy] = combined + options_value + (rpl or 0.0)
            full[ccy] = futures_upl + (rpl or 0.0) + options_value
        else:
            rpl_only[ccy] = combined + (rpl or 0.0)
            full[ccy] = futures_upl + (rpl or 0.0) + options_session
        cash_balance = _num(summ, "balance")
        if cash_balance is not None:
            balance[ccy] = equity - cash_balance
    return _Wedges(rpl_only, full, balance)


_TRACKED_FIELDS = (
    "futures_session_rpl",
    "session_rpl",
    "options_session_rpl",
    "balance",
    "options_session_upl",
    "session_funding",
)


def _sum_field(group: Sequence[Mapping[str, Any]], key: str) -> float | None:
    values = [v for v in (_num(s, key) for s in group) if v is not None]
    return sum(values) if values else None


def _over(resid: float, denom: float | None) -> float | str | None:
    if denom is None:
        return FIELD_ABSENT
    if denom == 0.0:
        return None
    return sig3(resid / denom)


def _currency_raw(
    code: str,
    resid: float,
    throughput: float,
    group: Sequence[Mapping[str, Any]],
    full_wedge: Mapping[str, float],
) -> dict[str, Any]:
    """Everything measured for one bucket, amounts included. Nothing here is
    emitted: ``_project_currency`` is the redaction boundary."""
    return {
        "ccy": code,
        "resid": resid,
        "throughput": throughput,
        "equity": sum(_num(s, "equity") or 0.0 for s in group),
        "balance": _sum_field(group, "balance"),
        "full_wedge": sum(full_wedge.get(_ccy(s), 0.0) for s in group),
        "futures_session_rpl": _sum_field(group, "futures_session_rpl"),
        "session_rpl": _sum_field(group, "session_rpl"),
        "options_session_rpl": _sum_field(group, "options_session_rpl"),
        "options_session_upl": _sum_field(group, "options_session_upl"),
        "session_funding": _sum_field(group, "session_funding"),
    }


def _project_currency(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Raw amounts in, ratios and booleans out (the redaction boundary)."""
    resid = float(raw["resid"])
    throughput = float(raw["throughput"])
    floor = INCEPTION_NATIVE_DUST_REL * throughput
    balance = raw["balance"]
    if balance is None:
        anchor_is_balance: bool | str = FIELD_ABSENT
    else:
        anchor_is_balance = (
            abs(float(raw["equity"]) - float(raw["full_wedge"]) - float(balance)) <= floor
        )
    legs = (raw["session_rpl"], raw["futures_session_rpl"], raw["options_session_rpl"])
    if any(v is None for v in legs):
        rpl_identity: bool | str = FIELD_ABSENT
    else:
        rpl_identity = _same(float(legs[0]), float(legs[1]) + float(legs[2]))
    return {
        "ccy": raw["ccy"],
        "resid_over_throughput": _over(resid, throughput),
        "resid_is_dust": abs(resid) <= floor,
        "resid_over_futures_session_rpl": _over(resid, raw["futures_session_rpl"]),
        "resid_over_session_rpl": _over(resid, raw["session_rpl"]),
        "resid_over_options_session_upl": _over(resid, raw["options_session_upl"]),
        "resid_over_session_funding": _over(resid, raw["session_funding"]),
        "candidate_anchor_equals_balance": anchor_is_balance,
        "session_rpl_equals_futures_plus_options": rpl_identity,
    }


def _all_true_or_absent(values: Sequence[Any]) -> bool | str:
    """True iff every present reading is True; ``field-absent`` when none is
    present; False when any present reading is False."""
    present = [v for v in values if v != FIELD_ABSENT]
    if not present:
        return FIELD_ABSENT
    return all(v is True for v in present)


def _per_basis(value: int | Mapping[str, int], basis: str) -> int:
    return int(value[basis]) if isinstance(value, Mapping) else int(value)


def _indexable_for(
    value: frozenset[str] | Mapping[str, frozenset[str]], basis: str
) -> frozenset[str]:
    if isinstance(value, Mapping):
        return frozenset(value.get(basis, frozenset()))
    return frozenset(value)


def measure_member(
    summaries_raw: Sequence[Any],
    ledger_by_basis: Mapping[str, Any],
    indexable_currencies: frozenset[str] | Mapping[str, frozenset[str]],
    rows_after_anchor: int | Mapping[str, int],
    now_utc: datetime,
    *,
    preanchor_ledger_by_basis: Mapping[str, Any] | None = None,
    member: str = "m1",
) -> list[dict[str, Any]]:
    """One sanitized record per basis for one member.

    ``ledger_by_basis`` maps a basis to its ``NativeLedger`` or, when the ledger
    could not be built, to the status string (``ledger-incomplete`` or
    ``build-error:<Type>``), which is recorded and not measured."""
    summaries = [s for s in summaries_raw if isinstance(s, Mapping) and _ccy(s)]
    n = len(summaries)
    present = {k: sum(1 for s in summaries if _num(s, k) is not None) for k in _TRACKED_FIELDS}
    has_any_rpl = any(_rpl(s) is not None for s in summaries)
    spelling = (
        "futures_session_rpl"
        if any(_num(s, "futures_session_rpl") is not None for s in summaries)
        else ("session_rpl" if any(_num(s, "session_rpl") is not None for s in summaries) else "none")
    )
    has_balance = present["balance"] > 0
    partial = any(0 < count < n for count in present.values())
    open_book = any((_num(s, "options_value") or 0.0) != 0.0 for s in summaries)
    options_session_nonzero = any(
        (_num(s, "options_session_upl") or 0.0) != 0.0 for s in summaries
    )
    hours = hours_since_last_0800_utc(now_utc)
    run_date = now_utc.astimezone(timezone.utc).date().isoformat()

    records: list[dict[str, Any]] = []
    for basis, ledger in ledger_by_basis.items():
        indexable = _indexable_for(indexable_currencies, basis)
        measured = not isinstance(ledger, str)
        residuals = _residuals(ledger, indexable) if measured else {}
        if measured:
            today = dict(ledger.terminal_upnl_native)
            wedges = _wedges(summaries, today, basis)
            gate_today = _gate(ledger, today, indexable)
            gate_rpl = _gate(ledger, wedges.rpl_only, indexable) if has_any_rpl else FIELD_ABSENT
            gate_full = _gate(ledger, wedges.full, indexable) if has_any_rpl else FIELD_ABSENT
            gate_balance = _gate(ledger, wedges.balance, indexable) if has_balance else FIELD_ABSENT
            pre = (preanchor_ledger_by_basis or {}).get(basis)
            if pre is not None and not isinstance(pre, str) and has_any_rpl:
                pre_wedges = _wedges(summaries, dict(pre.terminal_upnl_native), basis)
                gate_pre = _gate(pre, pre_wedges.rpl_only, indexable)
            else:
                gate_pre = NOT_RUN
            ledger_status = "ok"
            ledger_detail = None
        else:
            wedges = _Wedges({}, {}, {})
            gate_today = gate_rpl = gate_full = gate_balance = gate_pre = NOT_RUN
            ledger_status = str(ledger)
            ledger_detail = getattr(ledger, "detail", None)

        currencies: list[dict[str, Any]] = []
        for code, (resid, throughput) in residuals.items():
            group = [s for s in summaries if _bucket_code(_ccy(s)) == code]
            raw = _currency_raw(code, resid, throughput, group, wedges.full)
            currencies.append(_project_currency(raw))

        # QUIET: every summary's realized term is zero, absent, or inside the
        # gate's own dust floor for its bucket (the gate cannot see it there).
        quiet = True
        for s in summaries:
            rpl = _rpl(s)
            if rpl is None:
                continue
            throughput = residuals.get(_bucket_code(_ccy(s)), (0.0, 0.0))[1]
            if abs(rpl) > INCEPTION_NATIVE_DUST_REL * throughput:
                quiet = False
                break

        records.append(
            {
                "member": member,
                "basis": basis,
                "run_date": run_date,
                "hours_since_last_0800_utc": hours,
                "rows_after_anchor": _per_basis(rows_after_anchor, basis),
                "quiet": quiet,
                "ledger": ledger_status,
                "ledger_error_detail": ledger_detail,
                "gate_today": gate_today,
                "gate_candidate_rpl_only": gate_rpl,
                "gate_candidate_full": gate_full,
                "gate_candidate_balance": gate_balance,
                "gate_candidate_rpl_only_preanchor": gate_pre,
                "candidate_anchor_equals_balance": _all_true_or_absent(
                    [c["candidate_anchor_equals_balance"] for c in currencies]
                ),
                "session_rpl_equals_futures_plus_options": _all_true_or_absent(
                    [c["session_rpl_equals_futures_plus_options"] for c in currencies]
                ),
                "has_open_options_book": open_book,
                "options_session_upl_nonzero": options_session_nonzero,
                "rpl_spelling_used": spelling,
                "summary_fields_partial": partial,
                "has_futures_session_rpl_field": any(
                    _num(s, "futures_session_rpl") is not None for s in summaries
                ),
                "has_session_rpl_field": present["session_rpl"] > 0,
                "has_options_session_rpl_field": present["options_session_rpl"] > 0,
                "has_balance_field": has_balance,
                "has_options_session_upl_field": present["options_session_upl"] > 0,
                "has_session_funding_field": present["session_funding"] > 0,
                "currencies": currencies,
            }
        )
    return records


# ---------------------------------------------------------------------------
# I/O layer. Venue reads and SELECTs only.
# ---------------------------------------------------------------------------


def _now_ms() -> int:
    return int(time.time() * 1000)


class RecordingProxy:
    """A read-only view of a venue client for the probe.

    * hands out GET read endpoints only (``private_get_get_*`` / ``public_get_*``);
      anything else, including ``close`` and every write endpoint, is an
      ``AttributeError``;
    * captures the ONE account-summaries response (a second call raises);
    * counts transaction-log rows whose timestamp is later than the anchor read
      (``rows_after_anchor``, a count: the rows themselves are never kept), and
      on a ``drop_after_anchor`` crawl withholds them, which rebuilds the ledger
      as it stood at the anchor instant."""

    def __init__(self, exchange: Any, *, clock_ms: Callable[[], int] = _now_ms) -> None:
        self._exchange = exchange
        self._clock_ms = clock_ms
        self.summaries: list[Any] | None = None
        self.anchor_read_ms: int | None = None
        self.rows_after_anchor = 0
        self._drop_after_anchor = False

    def mark_anchor_read(self) -> None:
        self.anchor_read_ms = self._clock_ms()

    def begin_crawl(self, *, drop_after_anchor: bool) -> None:
        self.rows_after_anchor = 0
        self._drop_after_anchor = drop_after_anchor

    def __getattr__(self, name: str) -> Any:
        if name.startswith(_READ_PREFIXES):
            return getattr(self._exchange, name)
        raise AttributeError(name)

    async def private_get_get_account_summaries(self, params: Any) -> Any:
        if self.summaries is not None:
            raise RuntimeError("second anchor read refused")
        resp = await self._exchange.private_get_get_account_summaries(params)
        result = resp.get("result") if isinstance(resp, Mapping) else None
        found = result.get("summaries") if isinstance(result, Mapping) else None
        self.summaries = list(found) if isinstance(found, Sequence) and not isinstance(found, str) else []
        return resp

    async def private_get_get_transaction_log(self, params: Any) -> Any:
        if self.anchor_read_ms is None:
            raise RuntimeError("transaction log read before the anchor read was marked")
        resp = await self._exchange.private_get_get_transaction_log(params)
        result = resp.get("result") if isinstance(resp, Mapping) else None
        logs = result.get("logs") if isinstance(result, Mapping) else None
        if not isinstance(logs, list):
            return resp
        kept: list[Any] = []
        for row in logs:
            ts = None
            if isinstance(row, Mapping):
                try:
                    ts = int(row.get("timestamp"))  # type: ignore[arg-type]
                except (TypeError, ValueError):
                    ts = None
            after = ts is not None and ts > self.anchor_read_ms
            if after:
                self.rows_after_anchor += 1
                if self._drop_after_anchor:
                    continue
            kept.append(row)
        if len(kept) == len(logs):
            return resp
        return {**resp, "result": {**result, "logs": kept}}


class AnchorReadError(RuntimeError):
    """The account-summaries read produced no response the probe can measure."""


class _BuildFailure(str):
    """The ``build-error:<Type>`` status of a ledger that did not build, carrying
    the redacted ``detail`` (:func:`classify_ledger_error`). Still a ``str``, so
    every consumer that treats a string as "not built" is unchanged."""

    detail: str | None = None


async def _build_one(
    proxy: RecordingProxy,
    state: Any,
    basis: str,
    *,
    drop_after_anchor: bool,
    sleep: Callable[[float], Any],
    crawl_timeout_s: float,
) -> tuple[Any, frozenset[str], int]:
    """One ledger build exactly as ``_reconstruct_deribit`` does it. Returns the
    ledger (or its status string), the crawl's indexable set, and the count of
    rows booked after the anchor read."""
    from services.allocated_capital import exclude_spot_extraction_for

    proxy.begin_crawl(drop_after_anchor=drop_after_anchor)
    try:
        ledger, report = await asyncio.wait_for(
            build_deribit_native_ledger(
                proxy,
                account_state=state,
                pnl_basis=basis,
                exclude_spot_extraction=exclude_spot_extraction_for(None),
                sleep=sleep,
            ),
            timeout=crawl_timeout_s,
        )
        assert_ledger_complete(report)
    except LedgerCompletenessError:
        return "ledger-incomplete", frozenset(), proxy.rows_after_anchor
    except _BUILD_ERRORS as exc:
        failure = _BuildFailure(f"build-error:{type(exc).__name__}")
        failure.detail = classify_ledger_error(exc)
        return failure, frozenset(), proxy.rows_after_anchor
    return ledger, frozenset(report.indexable_currencies), proxy.rows_after_anchor


async def measure_member_live(
    exchange: Any,
    label: str,
    bases: Sequence[str],
    now_utc: datetime,
    *,
    sleep: Callable[[float], Any] = asyncio.sleep,
    clock_ms: Callable[[], int] = _now_ms,
    crawl_timeout_s: float = CRAWL_TIMEOUT_S,
) -> list[dict[str, Any]]:
    """Measure one member against a live (or stubbed) venue client."""
    proxy = RecordingProxy(exchange, clock_ms=clock_ms)
    proxy.mark_anchor_read()
    state = await asyncio.wait_for(
        fetch_deribit_native_account_state(proxy, sleep=sleep), timeout=crawl_timeout_s
    )
    if proxy.summaries is None:
        raise AnchorReadError("no account-summaries response")

    ledgers: dict[str, Any] = {}
    indexable: dict[str, frozenset[str]] = {}
    after: dict[str, int] = {}
    preanchor: dict[str, Any] = {}
    for basis in bases:
        ledger, ind, count = await _build_one(
            proxy, state, basis, drop_after_anchor=False, sleep=sleep, crawl_timeout_s=crawl_timeout_s
        )
        ledgers[basis], indexable[basis], after[basis] = ledger, ind, count
        if count > 0 and not isinstance(ledger, str):
            pre, _ind, _count = await _build_one(
                proxy, state, basis, drop_after_anchor=True, sleep=sleep, crawl_timeout_s=crawl_timeout_s
            )
            preanchor[basis] = pre
    return measure_member(
        proxy.summaries,
        ledgers,
        indexable,
        after,
        now_utc,
        preanchor_ledger_by_basis=preanchor,
        member=label,
    )


def refusal_reason(key_row: Mapping[str, Any]) -> str | None:
    """Why a member's key row is not measurable, or ``None``."""
    if key_row.get("exchange") != "deribit":
        return "not-deribit"
    if not key_row.get("is_active"):
        return "inactive"
    return None


async def run(strategy_id: str, bases: Sequence[str]) -> int:
    """Read the composite's members, refuse before any decrypt, then measure each
    member in ``seq`` order and print one JSON line per member and basis."""
    from services.db import db_execute, get_supabase, one, rows
    from services.encryption import decrypt_credentials, get_kek
    from services.exchange import aclose_exchange
    from services.job_worker import _make_exchange_client

    supabase = get_supabase()

    def _load_members() -> Any:
        return (
            supabase.table("strategy_keys")
            .select("api_key_id, seq")
            .eq("strategy_id", strategy_id)
            .order("seq")
            .execute()
        )

    members = rows(await db_execute(_load_members))
    if not members:
        print("refused: the composite has no members", file=sys.stderr)
        return EXIT_REFUSED

    key_rows: list[dict[str, Any]] = []
    for index, member in enumerate(members, start=1):
        api_key_id = member["api_key_id"]

        def _load_key(api_key_id: Any = api_key_id) -> Any:
            return supabase.table("api_keys").select("*").eq("id", api_key_id).maybe_single().execute()

        key_row = one(await db_execute(_load_key))
        reason = refusal_reason(key_row) if key_row else "missing"
        if reason is not None:
            print(f"refused: member m{index} is not measurable ({reason})", file=sys.stderr)
            return EXIT_REFUSED
        key_rows.append(dict(key_row))  # type: ignore[arg-type]

    kek = get_kek()
    now_utc = datetime.now(timezone.utc)
    for index, key_row in enumerate(key_rows, start=1):
        api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
        exchange = _make_exchange_client("deribit", api_key, api_secret, passphrase)
        try:
            records = await measure_member_live(exchange, f"m{index}", bases, now_utc)
        finally:
            await aclose_exchange(exchange)
        for record in records:
            print(emit_record(record), flush=True)
    return EXIT_OK


def _parse_bases(text: str) -> tuple[str, ...]:
    bases = tuple(b.strip() for b in text.split(",") if b.strip())
    unknown = [b for b in bases if b not in _BASES]
    if not bases or unknown:
        raise argparse.ArgumentTypeError(f"bases must be a subset of {sorted(_BASES)}")
    return bases


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NAVBREACH read-only anchor probe")
    parser.add_argument("--strategy-id", required=True)
    parser.add_argument("--bases", type=_parse_bases, default=ALL_BASES)
    args = parser.parse_args(argv)
    logging.disable(logging.CRITICAL)
    try:
        return asyncio.run(run(args.strategy_id, args.bases))
    except Exception as exc:  # noqa: BLE001 - the TYPE only; a message can carry an id
        print(f"failed: {type(exc).__name__}", file=sys.stderr)
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
