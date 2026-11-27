"""Phase 252 wave-2 measurement probe (CONTEXT Wave 2, "measure before promoting"): does the
EXISTING smoothed mark-to-market reconstruction compute for the Deribit member keys of a
composite whose published figure is withheld because it comes from the cash wallet of an
options book?

WHY: wave 1 withholds that figure under a named reason. Wave 2 switches the headline to market
price valuation only if a measurement passes criteria fixed BEFORE the run; if it does not, the
withhold stays and the result is recorded. This script is that measurement and nothing more. It
writes nothing, and it neither persists a series nor changes any switch. A promotion is a later
plan, written only if this run passes.

WHAT IT DOES, per Deribit member of one composite, on two bases:
  the SMOOTHED basis (market-price valuation: the one being judged), and
  the CASH basis (each option leg booked on the day its cash moves: printed for contrast only).
It builds each member ledger the way the composite member arm does (the ``_reconstruct_deribit``
closure of the persisting composite stitch job): parse the strategy's
``returns_denominator_config``, ``exclude_spot_extraction_for`` of it, ONE
``fetch_deribit_native_account_state`` read, ``build_deribit_native_ledger``,
``assert_ledger_complete``, then ``combine_native_ledger`` with the strategy's own config.

One deliberate difference: the probe does NOT request the allocated member's NAV twin
(``nav_twin``). The twin changes an allocated member's NAV base; it does not change the daily
option valuation that C1 to C4 judge, and asking for it would add a read the question does not
need.

PASS CRITERIA (stated before the run; structural, no magnitude bound: Phase 194 D-05). Each is
judged per member on the SMOOTHED basis. The code's own raises and its own completeness report
decide them; the probe never loosens a tolerance.
  C1  The valuation builds. ``build_deribit_native_ledger`` on the smoothed basis returns and
      ``assert_ledger_complete`` passes. Any ``LedgerValuationError``,
      ``OptionRowFieldMissingError``, ``NavReconstructionError``, ``LedgerCompletenessError`` or
      other build error is a FAIL. The smoothed assembly's own checks run inside the build: the
      cash-channel identity, the book-channel check and the summary cross-check.
  C2  Every held option has daily marks. The same build raises nothing from the daily-marks
      path. A transient read (``DeribitTransientReadError``) is a FAIL and is never retried; a
      structural hole raises from the hole guard and is a FAIL. C1 and C2 share one observation,
      the build outcome. The printed class name, and the field name the redacted detail adds
      when the message names one, tell which of them failed. Three smoothed-only refusals each
      have their own class (``OptionMarkHoleError`` for the daily-mark hole,
      ``OptionExerciseRowError`` and ``OptionExpiryRowError`` for the two row refusals), so the
      class name names the refusal and ``refusal_shape`` says where it fell (see below).
  C3  No cash-bucketed option days. The build's ``pre_mark_retention_option_days`` is empty. A
      non-empty list means those days fall back to the cash wallet inside a promoted headline,
      so the member fails. Limiting the promoted span to avoid them is a founder call, recorded
      and never taken by the probe.
  C4  The series reconciles. ``combine_native_ledger`` returns on the smoothed ledger. Its
      inception reconciliation is the telescoping identity at the code's own tolerance.
  C5  Report only, never a pass bound. Per member and basis: the count of days whose absolute
      return is at least ``PNL_DOM_RATIO`` (imported, never restated), the count above one half
      (the Phase 185 SC-4 reading, printed so it can be compared with 185), and the ordinals
      (0-based day index from the series start) of up to five days with the largest absolute
      return.
  C6  The measurement saw something. The member's smoothed crawl carries option activity (the
      completeness report's ``has_option_activity``) and its series is non-empty
      (``series_days`` above zero). A perp-only member, or a zero-day series, is a FAIL: C1 to C4
      all pass on an empty book, so without C6 a ``pass`` could rest on no evidence.
VERDICT: ``pass`` only when every member passes C1 to C4 and C6, and at least one judged member
carries option activity; otherwise ``fail`` with the count of failed members. A partial result is a ``fail``. The cash record is printed as ``contrast`` and
never gates.

REDACTION CONTRACT (the output is pasted into a tracked file in a public repo): ordinals,
counts, closed-vocabulary verdict words and exception class names only. No amount, return value,
date, key, account, strategy id or message text is printed; a failure prints the exception TYPE
only. The one structured field, ``refusal_shape``, is one of: ``null`` (the build did not raise
one of the three refusals, which covers every cash record and every successful build); a hole,
``{"kind": "hole", "vs_marks": <side of the instrument's fetched marks the missing day falls
on: no-marks | before-first-bar | between-bars | after-last-bar>, "vs_retention": <whether that
day is older than the hard retention cutoff: older | not-older | unknown>}``; a row refusal,
``{"kind": "exercise" | "expiry", "change": <absent | non-numeric | zero | nonzero>,
"position": <the same four words>, "siblings": {trade, delivery, assignment, expiry, exercise,
other: a count each}}`` (a census of every row on the refusing row's instrument, by type); or
``"unreadable"`` when one of the three fired but an attribute was off its closed set (the record
is still printed: a founder-gated run never exits 1 for want of a word).

WHAT THE READING CAN AND CANNOT SAY: the probe names the FIRST refusal per member only. The
position replay refuses before any mark is fetched, and the hole guard stops at the earliest
missing day of the first holed instrument in grid order. So a hole reading does not rule out a
row refusal later in the ledger, and an exercise or expiry reading says nothing about marks. The only path to stdout is ``emit_record``, which refuses any key outside ``RECORD_KEYS`` /
``VERDICT_KEYS``, any value outside its declared vocabulary and any float, then re-checks with
``assert_sanitized``. Logging is switched off for the run.

READ-ONLY: SELECTs on ``strategies``, ``strategy_keys`` and ``api_keys``, and venue GET reads
through ``RecordingProxy``. It does not call the allocator key preflight (whose circuit-breaker
arm can write), reads no environment variable, and imports nothing that persists. Keys are
decrypted inside the worker process and nowhere else.

USAGE (orchestrator-only, founder-gated, run AFTER the phase ships and the worker is deployed;
the id is typed on the command line and never written into a tracked file):
  railway ssh "cd /app && python -m scripts.deribit_options_smoothed_probe --strategy-id <id>"
Paste only the lines that start with ``{"``.

EXIT CODES
----------
  0  every member measured; the records and the verdict line are printed (the verdict itself
     may be ``fail``: a measured failure is a result, not an error)
  2  refused before any decrypt: no such strategy, no members, or a member whose key is not an
     active ``deribit`` key
  1  any other failure (the exception TYPE only on stderr), including a malformed
     ``returns_denominator_config``
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
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from scripts.deribit_ground_truth import assert_sanitized
from scripts.navbreach_anchor_probe import (
    _BUILD_ERRORS,
    LEDGER_ERROR_CLASSES,
    LEDGER_ERROR_FIELDS,
    OTHER,
    RecordingProxy,
    classify_ledger_error,
)
from services.allocated_capital import (
    ReturnsDenominatorConfig,
    ReturnsDenominatorConfigError,
    exclude_spot_extraction_for,
    parse_returns_denominator_config,
)
from services.broker_dailies import combine_native_ledger
from services.deribit_ingest import (
    LedgerCompletenessError,
    assert_ledger_complete,
    build_deribit_native_ledger,
    fetch_deribit_native_account_state,
)
from services.deribit_txn import (
    HOLE_VS_MARKS_WORDS,
    HOLE_VS_RETENTION_WORDS,
    PNL_BASIS_CASH_SETTLEMENT,
    PNL_BASIS_SMOOTHED_MTM,
    ROW_FIELD_SHAPE_WORDS,
    ROW_SIBLING_KEYS,
    OptionMarkHoleError,
)
from services.nav_twr import PNL_DOM_RATIO, NavReconstructionError
from services.native_nav import NativeLedger

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_REFUSED = 2

# Hard bound on each live crawl, so a slow venue read ends the probe instead of wedging a shell.
# The worker bounds its own crawls the same way.
CRAWL_TIMEOUT_S: float = 900.0

# The bases, judged first and contrast second. Each is built exactly once and never retried.
BASES: tuple[str, ...] = (PNL_BASIS_SMOOTHED_MTM, PNL_BASIS_CASH_SETTLEMENT)

# The Phase 185 SC-4 reading: a day whose absolute return is ABOVE one half. Report only (C5);
# it is the one number this script carries and it bounds nothing.
SC4_HALF_DAY_RETURN: float = 0.5
MAX_TOP_ORDINALS: int = 5

BUILD_OK = "ok"
BUILD_INCOMPLETE = "ledger-incomplete"
_BUILD_ERROR_PREFIX = "build-error:"
NOT_RUN = "not-run"
PASS = "pass"
FAIL = "fail"
CONTRAST = "contrast"
YES = "yes"
NO = "no"

# The classes a C4 refusal can be named by. Any other NavReconstructionError subclass reads as
# the base class, so the emitter can never be handed a name it does not know.
_C4_CLASSES: frozenset[str] = frozenset(
    {"NavReconstructionError", "InceptionReconciliationError", "UnmarkableCurrencyError"}
)


def _class_word(exc: BaseException) -> str:
    """The closed-vocabulary class word for a build error: its own name when allow-listed,
    otherwise ``other`` (a subclass off the list must not make the emitter refuse the record)."""
    name = type(exc).__name__
    return name if name in LEDGER_ERROR_CLASSES else OTHER


def _c4_word(exc: NavReconstructionError) -> str:
    name = type(exc).__name__
    return f"fail:{name if name in _C4_CLASSES else 'NavReconstructionError'}"


# ---------------------------------------------------------------------------
# The declared output vocabulary. Anything outside it never reaches stdout.
# ---------------------------------------------------------------------------

RECORD_KEYS: tuple[str, ...] = (
    "member",
    "basis",
    "build",
    "build_error_detail",
    "c3",
    "bucketed_days",
    "option_activity",
    "c4",
    "member_verdict",
    "series_days",
    "days_over_guard",
    "days_over_half",
    "top_ordinals",
    "refusal_shape",
)

VERDICT_KEYS: tuple[str, ...] = ("verdict", "members", "failed_members")

_LABEL_RE = re.compile(r"^m[0-9]{1,2}$")


def _is_count(x: Any) -> bool:
    # Range and kind only. The numeric TYPE rule (no float, ever) lives in one place,
    # ``_refuse_floats``, so there is one definition of it.
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x >= 0


def _is_build(x: Any) -> bool:
    if not isinstance(x, str):
        return False
    if x in (BUILD_OK, BUILD_INCOMPLETE):
        return True
    if not x.startswith(_BUILD_ERROR_PREFIX):
        return False
    word = x[len(_BUILD_ERROR_PREFIX) :]
    return word == OTHER or word in LEDGER_ERROR_CLASSES


def _is_detail(x: Any) -> bool:
    if x is None:
        return True
    if not isinstance(x, str):
        return False
    parts = x.split(":")
    if len(parts) == 1:
        return parts[0] == OTHER or parts[0] in LEDGER_ERROR_CLASSES
    return len(parts) == 2 and parts[0] in LEDGER_ERROR_CLASSES and parts[1] in LEDGER_ERROR_FIELDS


def _is_c4(x: Any) -> bool:
    if x in (PASS, NOT_RUN):
        return True
    return isinstance(x, str) and x.startswith("fail:") and x[len("fail:") :] in _C4_CLASSES


def _is_ordinals(x: Any) -> bool:
    return isinstance(x, list) and len(x) <= MAX_TOP_ORDINALS and all(_is_count(i) for i in x)


UNREADABLE = "unreadable"
_HOLE_SHAPE_KEYS: frozenset[str] = frozenset({"kind", "vs_marks", "vs_retention"})
_ROW_SHAPE_KEYS: frozenset[str] = frozenset({"kind", "change", "position", "siblings"})


def _is_word(x: Any, words: frozenset[str]) -> bool:
    # ``isinstance`` first: an unhashable value must read "not a word", never raise.
    return isinstance(x, str) and x in words


def _is_siblings(x: Any) -> bool:
    # ``type(v) is int`` refuses a bool (an ``int`` subclass); a float is refused here too.
    return (
        isinstance(x, Mapping)
        and set(x) == ROW_SIBLING_KEYS
        and all(type(v) is int and v >= 0 for v in x.values())
    )


def _is_refusal_shape(x: Any) -> bool:
    """Exactly the shapes the contract lists and nothing else: ``null``, ``"unreadable"``, a hole
    shape, or an exercise/expiry row shape. Never raises."""
    if x is None:
        return True
    if isinstance(x, str):
        return x == UNREADABLE
    if not isinstance(x, Mapping):
        return False
    kind = x.get("kind")
    if kind == "hole":
        return (
            set(x) == _HOLE_SHAPE_KEYS
            and _is_word(x.get("vs_marks"), HOLE_VS_MARKS_WORDS)
            and _is_word(x.get("vs_retention"), HOLE_VS_RETENTION_WORDS)
        )
    if kind in ("exercise", "expiry"):
        return (
            set(x) == _ROW_SHAPE_KEYS
            and _is_word(x.get("change"), ROW_FIELD_SHAPE_WORDS)
            and _is_word(x.get("position"), ROW_FIELD_SHAPE_WORDS)
            and _is_siblings(x.get("siblings"))
        )
    return False


_RECORD_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "member": lambda x: isinstance(x, str) and _LABEL_RE.match(x) is not None,
    "basis": lambda x: isinstance(x, str) and x in BASES,
    "build": _is_build,
    "build_error_detail": _is_detail,
    "c3": lambda x: x in (PASS, FAIL, NOT_RUN),
    "bucketed_days": _is_count,
    "option_activity": lambda x: x in (YES, NO),
    "c4": _is_c4,
    "member_verdict": lambda x: x in (PASS, FAIL, CONTRAST),
    "series_days": _is_count,
    "days_over_guard": _is_count,
    "days_over_half": _is_count,
    "top_ordinals": _is_ordinals,
    "refusal_shape": _is_refusal_shape,
}

_VERDICT_VALIDATORS: dict[str, Callable[[Any], bool]] = {
    "verdict": lambda x: x in (PASS, FAIL),
    "members": _is_count,
    "failed_members": _is_count,
}


def _refuse_floats(obj: Any, path: str = "record") -> None:
    """Raise unless ``obj`` carries no float at any depth. The path is named, the value never."""
    if isinstance(obj, float):
        raise ValueError(f"{path}: a float is never emitted")
    if isinstance(obj, Mapping):
        for key, value in obj.items():
            _refuse_floats(value, f"{path}.{key}")
    elif isinstance(obj, (list, tuple)):
        for index, value in enumerate(obj):
            _refuse_floats(value, f"{path}[{index}]")


def validate_record(record: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` unless ``record`` is exactly one declared line: a member record or
    the verdict line. The message names the PATH of the offending entry and never its value: an
    unredacted amount must not leak through its own rejection."""
    if not isinstance(record, Mapping):
        raise ValueError("record: not a mapping")
    _refuse_floats(record)
    is_verdict = set(record) == set(VERDICT_KEYS)
    keys, validators = (
        (VERDICT_KEYS, _VERDICT_VALIDATORS) if is_verdict else (RECORD_KEYS, _RECORD_VALIDATORS)
    )
    extra = sorted(set(record) - set(keys))
    missing = sorted(set(keys) - set(record))
    if extra or missing:
        raise ValueError(f"record: keys differ from the whitelist extra={extra} missing={missing}")
    for key, check in validators.items():
        if not check(record[key]):
            raise ValueError(f"record.{key}: value outside the declared vocabulary")
    assert_sanitized(dict(record))


def emit_record(record: Mapping[str, Any]) -> str:
    """The ONLY path to stdout: validate, then serialize one compact JSON line."""
    validate_record(record)
    return json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False)


# ---------------------------------------------------------------------------
# Pure layer.
# ---------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class BasisOutcome:
    """What one basis's build produced: its status word, the redacted error detail, and, when it
    built, the ledger with the crawl's indexable set and the cash-bucketed option-day count."""

    build: str
    detail: str | None = None
    ledger: NativeLedger | None = None
    indexable: frozenset[str] = frozenset()
    bucketed: int = 0
    option_activity: bool = False
    refusal_shape: Any = None


def _series_report(returns: Any) -> dict[str, Any]:
    """C5, from the series ``combine_native_ledger`` returned: counts and ordinals only. A NaN
    day (the funding day) is skipped, never counted or ranked."""
    finite = [
        (index, abs(float(value)))
        for index, value in enumerate(returns.tolist())
        if math.isfinite(float(value))
    ]
    ranked = sorted(finite, key=lambda pair: (-pair[1], pair[0]))
    return {
        "series_days": len(returns),
        "days_over_guard": sum(1 for _i, a in finite if a >= PNL_DOM_RATIO),
        "days_over_half": sum(1 for _i, a in finite if a > SC4_HALF_DAY_RETURN),
        "top_ordinals": [index for index, _a in ranked[:MAX_TOP_ORDINALS]],
    }


def _refusal_shape(exc: BaseException) -> Any:
    """The closed ``refusal_shape`` of a build error: the shape of the refusal that fired when it
    is one of the three smoothed-only classes, ``None`` for any other error, and ``"unreadable"``
    when one of the three fired with an attribute off its closed set. Reads attributes only, and
    never raises: a record must still print."""
    if isinstance(exc, OptionMarkHoleError):
        hole = {
            "kind": "hole",
            "vs_marks": getattr(exc, "vs_marks", None),
            "vs_retention": getattr(exc, "vs_retention", None),
        }
        return hole if _is_refusal_shape(hole) else UNREADABLE
    return None


def _no_series() -> dict[str, Any]:
    return {"series_days": 0, "days_over_guard": 0, "days_over_half": 0, "top_ordinals": []}


def _measure_basis(
    label: str,
    basis: str,
    outcome: BasisOutcome,
    config: ReturnsDenominatorConfig | None,
) -> dict[str, Any]:
    c3 = c4 = NOT_RUN
    report = _no_series()
    if outcome.build == BUILD_OK and outcome.ledger is not None:
        c3 = PASS if outcome.bucketed == 0 else FAIL
        try:
            returns, _meta = combine_native_ledger(
                outcome.ledger, outcome.indexable, denominator_config=config
            )
        except NavReconstructionError as exc:
            c4 = _c4_word(exc)
        else:
            c4 = PASS
            report = _series_report(returns)
    if basis != PNL_BASIS_SMOOTHED_MTM:
        verdict = CONTRAST
    else:
        verdict = (
            PASS
            if (
                outcome.build == BUILD_OK
                and c3 == PASS
                and c4 == PASS
                and outcome.option_activity
                and report["series_days"] > 0
            )
            else FAIL
        )
    return {
        "member": label,
        "basis": basis,
        "build": outcome.build,
        "build_error_detail": outcome.detail,
        "c3": c3,
        "bucketed_days": outcome.bucketed,
        "option_activity": YES if outcome.option_activity else NO,
        "c4": c4,
        "member_verdict": verdict,
        "refusal_shape": outcome.refusal_shape,
        **report,
    }


def measure_member(
    label: str,
    outcomes: Mapping[str, BasisOutcome],
    config: ReturnsDenominatorConfig | None,
) -> list[dict[str, Any]]:
    """One record per basis for one member (pure: no I/O). The smoothed record carries the
    verdict; the cash record is ``contrast``."""
    return [_measure_basis(label, basis, outcome, config) for basis, outcome in outcomes.items()]


def verdict_record(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """The one verdict line: ``pass`` only when at least one member was judged, at least one
    judged member carries option activity, and every judged member passed C1 to C4 and C6."""
    judged = [r for r in records if r["basis"] == PNL_BASIS_SMOOTHED_MTM]
    failed = sum(1 for r in judged if r["member_verdict"] != PASS)
    has_activity = any(r["option_activity"] == YES for r in judged)
    return {
        "verdict": PASS if has_activity and failed == 0 else FAIL,
        "members": len(judged),
        "failed_members": failed,
    }


# ---------------------------------------------------------------------------
# I/O layer. Venue GET reads and SELECTs only.
# ---------------------------------------------------------------------------


async def _build_basis(
    proxy: RecordingProxy,
    state: Any,
    basis: str,
    config: ReturnsDenominatorConfig | None,
    *,
    sleep: Callable[[float], Any],
    crawl_timeout_s: float,
) -> BasisOutcome:
    """One build, exactly as the composite member arm makes it, bounded and never retried."""
    proxy.begin_crawl(drop_after_anchor=False)
    try:
        ledger, report = await asyncio.wait_for(
            build_deribit_native_ledger(
                proxy,
                account_state=state,
                pnl_basis=basis,
                exclude_spot_extraction=exclude_spot_extraction_for(config),
                sleep=sleep,
            ),
            timeout=crawl_timeout_s,
        )
        assert_ledger_complete(report)
    except LedgerCompletenessError:
        return BasisOutcome(BUILD_INCOMPLETE)
    except _BUILD_ERRORS as exc:
        return BasisOutcome(
            f"{_BUILD_ERROR_PREFIX}{_class_word(exc)}",
            detail=classify_ledger_error(exc),
            refusal_shape=_refusal_shape(exc),
        )
    return BasisOutcome(
        BUILD_OK,
        ledger=ledger,
        indexable=frozenset(report.indexable_currencies),
        bucketed=len(report.pre_mark_retention_option_days),
        option_activity=report.has_option_activity,
    )


async def measure_member_live(
    exchange: Any,
    label: str,
    config: ReturnsDenominatorConfig | None,
    *,
    sleep: Callable[[float], Any] = asyncio.sleep,
    crawl_timeout_s: float = CRAWL_TIMEOUT_S,
) -> list[dict[str, Any]]:
    """Measure one member against a live (or stubbed) venue client: one anchor read, then each
    basis built once. The client is wrapped so only GET reads are reachable.

    No combine-off-loop here: the probe has no heartbeat to protect."""
    proxy = RecordingProxy(exchange)
    proxy.mark_anchor_read()
    state = await asyncio.wait_for(
        fetch_deribit_native_account_state(proxy, sleep=sleep), timeout=crawl_timeout_s
    )
    outcomes: dict[str, BasisOutcome] = {}
    for basis in BASES:
        outcomes[basis] = await _build_basis(
            proxy, state, basis, config, sleep=sleep, crawl_timeout_s=crawl_timeout_s
        )
    return measure_member(label, outcomes, config)


def refusal_reason(key_row: Mapping[str, Any]) -> str | None:
    """Why a member's key row is not measurable, or ``None``."""
    if key_row.get("exchange") != "deribit":
        return "not-deribit"
    if not key_row.get("is_active"):
        return "inactive"
    return None


async def run(strategy_id: str) -> int:
    """Read the composite, refuse before any decrypt, then measure each member in ``seq`` order
    and print one JSON line per member and basis, then the verdict line."""
    from services.db import db_execute, get_supabase, one, rows
    from services.encryption import decrypt_credentials, get_kek
    from services.exchange import aclose_exchange
    from services.job_worker import _make_exchange_client

    supabase = get_supabase()

    def _load_strategy() -> Any:
        return (
            supabase.table("strategies")
            .select("id, returns_denominator_config")
            .eq("id", strategy_id)
            .maybe_single()
            .execute()
        )

    strategy = one(await db_execute(_load_strategy))
    if strategy is None:
        print("refused: no such strategy", file=sys.stderr)
        return EXIT_REFUSED
    try:
        config = parse_returns_denominator_config(strategy.get("returns_denominator_config"))
    except ReturnsDenominatorConfigError as exc:
        # The TYPE only: the message embeds the offending values.
        print(f"failed: {type(exc).__name__}", file=sys.stderr)
        return EXIT_FAILED

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
        if reason is not None or not key_row:
            print(f"refused: member m{index} is not measurable ({reason})", file=sys.stderr)
            return EXIT_REFUSED
        key_rows.append(dict(key_row))

    kek = get_kek()
    all_records: list[dict[str, Any]] = []
    for index, key_row in enumerate(key_rows, start=1):
        api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
        exchange = _make_exchange_client("deribit", api_key, api_secret, passphrase)
        try:
            records = await measure_member_live(exchange, f"m{index}", config)
        finally:
            await aclose_exchange(exchange)
        for record in records:
            print(emit_record(record), flush=True)
        all_records.extend(records)
    print(emit_record(verdict_record(all_records)), flush=True)
    return EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deribit options smoothed-valuation read-only probe")
    parser.add_argument("--strategy-id", required=True)
    args = parser.parse_args(argv)
    logging.disable(logging.CRITICAL)
    try:
        return asyncio.run(run(args.strategy_id))
    except Exception as exc:  # noqa: BLE001 - the TYPE only; a message can carry an id
        print(f"failed: {type(exc).__name__}", file=sys.stderr)
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
