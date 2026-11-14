"""Provenance-locked oracle intake for the MT5 parity harness (PARITY-01).

Every expected value the harness compares against is a ``Reading`` that carries
a provenance, and the provenance is one of exactly three labels: a number read
off the MT5 terminal, a number exported from an MT5 account report, or a number
printed on a broker statement. Anything else is the OTHER side of the
comparison: our own gateway read, the soak reconcile, a Quantalyze-derived
figure. Comparing against those would be the pipeline checking itself, so a
reading with any other provenance is refused by name before it becomes an
object.

PURE: stdlib only. No database, no gateway, no network. The refusal messages
name a field or a provenance label and never a figure (a label is not money; a
reading's value is).
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Final, Literal

PROVENANCE_VALUES: Final[frozenset[str]] = frozenset(
    {"terminal_reading", "terminal_report_export", "broker_statement"}
)

WORKSHEET_SCHEMA_VERSION: Final[int] = 1

_TOP_LEVEL_KEYS: Final[frozenset[str]] = frozenset(
    {"schema_version", "synthetic", "accounts"}
)
_ACCOUNT_KEYS: Final[frozenset[str]] = frozenset({"readings"})
_READING_KEYS: Final[frozenset[str]] = frozenset(
    {"id", "as_of", "value", "provenance"}
)


class ProvenanceRefused(ValueError):
    """A reading carries a provenance that is not one of ``PROVENANCE_VALUES``.

    The message names the refused value with ``repr()``: a provenance is a label,
    not money, so naming it is what lets the founder see WHICH source was refused.
    """


class WorksheetRefused(ValueError):
    """The worksheet file is malformed: an unknown key, a missing field, a
    non-finite number or a wrong type. The message names the key or the
    account label and reading id, never a value."""


def require_provenance(value: object) -> str:
    """The provenance, or ``ProvenanceRefused``.

    Exact membership only: no strip, no case-fold, no coercion. ``"Gateway "``
    and ``"BROKER_STATEMENT"`` are refused as surely as ``"gateway"``.
    """
    if isinstance(value, str) and value in PROVENANCE_VALUES:
        return value
    raise ProvenanceRefused(
        f"provenance {value!r} is not an allowed oracle source "
        f"(allowed: {', '.join(sorted(PROVENANCE_VALUES))})"
    )


@dataclass(frozen=True, slots=True)
class Reading:
    """One expected value: what it is (``id``), when it applies (``as_of``, an ISO
    day or None), the value, and where it came from."""

    id: str
    as_of: str | None
    value: float | str
    provenance: str


@dataclass(frozen=True, slots=True)
class Worksheet:
    """The founder's filled-in readings. ``synthetic`` marks a fixture, so a
    verdict built on it is a rehearsal and never a parity result."""

    synthetic: bool
    accounts: Mapping[str, tuple[Reading, ...]]


def _refuse_constant(name: str) -> Any:
    raise WorksheetRefused(f"worksheet carries a non-finite number ({name})")


def _expect_keys(obj: object, allowed: frozenset[str], where: str) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise WorksheetRefused(f"worksheet {where} is not an object")
    unknown = sorted(set(obj) - allowed)
    if unknown:
        raise WorksheetRefused(f"worksheet {where} has an unknown key: {unknown[0]!r}")
    missing = sorted(allowed - set(obj))
    if missing:
        raise WorksheetRefused(f"worksheet {where} is missing the field {missing[0]!r}")
    return obj


def _parse_reading(raw: object, label: str, index: int) -> Reading:
    where = f"account {label!r} reading #{index}"
    body = _expect_keys(raw, _READING_KEYS, where)
    reading_id = body["id"]
    if not isinstance(reading_id, str) or not reading_id:
        raise WorksheetRefused(f"worksheet {where} has no id")
    # Provenance FIRST: an unknown provenance must never become an object, and
    # the refusal must be the named provenance refusal, not a later type error.
    provenance = require_provenance(body["provenance"])
    as_of = body["as_of"]
    if as_of is not None:
        if not isinstance(as_of, str):
            raise WorksheetRefused(f"worksheet {where} as_of is not a string")
        try:
            date.fromisoformat(as_of)
        except ValueError:
            raise WorksheetRefused(
                f"worksheet {where} as_of is not an ISO day"
            ) from None
    value = body["value"]
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise WorksheetRefused(f"worksheet {where} value is not a number or a string")
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise WorksheetRefused(f"worksheet {where} value is not finite")
        value = float(value)
    return Reading(id=reading_id, as_of=as_of, value=value, provenance=provenance)


def load_worksheet(path: Path) -> Worksheet:
    """Read and validate a worksheet file (JSON, stdlib: ``pyyaml`` is only a
    transitive dependency of this service and is not imported)."""
    try:
        data = json.loads(
            path.read_text(encoding="utf-8"), parse_constant=_refuse_constant
        )
    except json.JSONDecodeError:
        raise WorksheetRefused("worksheet is not valid JSON") from None
    top = _expect_keys(data, _TOP_LEVEL_KEYS, "file")
    if top["schema_version"] != WORKSHEET_SCHEMA_VERSION or isinstance(
        top["schema_version"], bool
    ):
        raise WorksheetRefused("worksheet schema_version is not the supported version")
    if not isinstance(top["synthetic"], bool):
        raise WorksheetRefused("worksheet synthetic flag is not a boolean")
    accounts_raw = top["accounts"]
    if not isinstance(accounts_raw, dict):
        raise WorksheetRefused("worksheet accounts is not an object")
    accounts: dict[str, tuple[Reading, ...]] = {}
    for label, account in accounts_raw.items():
        body = _expect_keys(account, _ACCOUNT_KEYS, f"account {label!r}")
        readings = body["readings"]
        if not isinstance(readings, list):
            raise WorksheetRefused(f"worksheet account {label!r} readings is not a list")
        accounts[str(label)] = tuple(
            _parse_reading(r, str(label), i) for i, r in enumerate(readings)
        )
    return Worksheet(synthetic=top["synthetic"], accounts=accounts)


# --- the one list of required readings (PARITY-01) ---------------------------------
#
# ``docs/runbooks/mt5-parity/required-readings.json`` is read by the founder-session
# script (a test pins the script's Readings table to its ids) and by
# ``require_complete`` below. The path is always an argument: nothing here reads a
# file at import time.

REQUIRED_READINGS_SCHEMA_VERSION: Final[int] = 1

_READING_KINDS: Final[frozenset[str]] = frozenset({"money", "text", "instant", "sha256"})
_AS_OF_RULES: Final[frozenset[str]] = frozenset({"required", "forbidden"})
_REQUIRED_LIST_KEYS: Final[frozenset[str]] = frozenset({"schema_version", "readings"})
_REQUIRED_ENTRY_KEYS: Final[frozenset[str]] = frozenset(
    {"id", "kind", "provenance", "as_of", "min_count", "founder_prompt"}
)
_TRADE_MODES: Final[frozenset[str]] = frozenset({"real", "demo"})
_INSTANT_RE: Final[re.Pattern[str]] = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"
)
_SHA256_RE: Final[re.Pattern[str]] = re.compile(r"^[0-9a-f]{64}$")

_SHA256_READING_ID: Final[str] = "all_history_report_sha256"


class WorksheetIncomplete(ValueError):
    """The worksheet lacks required readings. The message lists EVERY missing
    reading id per account label (ids are names, not values)."""


class UnknownReading(ValueError):
    """A worksheet reading whose id is not in the required-readings list."""


class ReportBindingRefused(ValueError):
    """The Report bytes are not the file the worksheet recorded the sha256 of."""


@dataclass(frozen=True, slots=True)
class RequiredReading:
    """One reading the founder session collects and the intake requires.

    ``provenance`` is the allowed SUBSET of ``PROVENANCE_VALUES`` for this id;
    ``as_of`` says whether the reading must carry an ISO day or must not;
    ``min_count`` is how many readings (one per as-of day) an account must hold."""

    id: str
    kind: Literal["money", "text", "instant", "sha256"]
    provenance: frozenset[str]
    as_of: Literal["required", "forbidden"]
    min_count: int
    founder_prompt: str


def load_required_readings(path: Path) -> tuple[RequiredReading, ...]:
    """Read and validate the shared list. A provenance outside
    ``PROVENANCE_VALUES`` raises ``ProvenanceRefused``; a duplicate id, an unknown
    key or a wrong type raises ``WorksheetRefused``."""
    try:
        data = json.loads(
            path.read_text(encoding="utf-8"), parse_constant=_refuse_constant
        )
    except json.JSONDecodeError:
        raise WorksheetRefused("required-readings list is not valid JSON") from None
    top = _expect_keys(data, _REQUIRED_LIST_KEYS, "required-readings file")
    if top["schema_version"] != REQUIRED_READINGS_SCHEMA_VERSION or isinstance(
        top["schema_version"], bool
    ):
        raise WorksheetRefused("required-readings schema_version is not supported")
    entries = top["readings"]
    if not isinstance(entries, list) or not entries:
        raise WorksheetRefused("required-readings readings is not a non-empty list")
    out: list[RequiredReading] = []
    seen: set[str] = set()
    for index, raw in enumerate(entries):
        where = f"required reading #{index}"
        body = _expect_keys(raw, _REQUIRED_ENTRY_KEYS, where)
        reading_id = body["id"]
        if not isinstance(reading_id, str) or not reading_id:
            raise WorksheetRefused(f"{where} has no id")
        if reading_id in seen:
            raise WorksheetRefused(f"required-readings list repeats the id {reading_id!r}")
        seen.add(reading_id)
        kind = body["kind"]
        if kind not in _READING_KINDS:
            raise WorksheetRefused(f"{where} ({reading_id!r}) has an unknown kind")
        as_of = body["as_of"]
        if as_of not in _AS_OF_RULES:
            raise WorksheetRefused(f"{where} ({reading_id!r}) has an unknown as_of rule")
        min_count = body["min_count"]
        if isinstance(min_count, bool) or not isinstance(min_count, int) or min_count < 1:
            raise WorksheetRefused(f"{where} ({reading_id!r}) min_count is not >= 1")
        prompt = body["founder_prompt"]
        if not isinstance(prompt, str) or not prompt.strip():
            raise WorksheetRefused(f"{where} ({reading_id!r}) has no founder_prompt")
        provenance_raw = body["provenance"]
        if not isinstance(provenance_raw, list) or not provenance_raw:
            raise WorksheetRefused(f"{where} ({reading_id!r}) provenance is not a list")
        out.append(
            RequiredReading(
                id=reading_id,
                kind=kind,
                provenance=frozenset(require_provenance(p) for p in provenance_raw),
                as_of=as_of,
                min_count=min_count,
                founder_prompt=prompt,
            )
        )
    return tuple(out)


def _check_value(reading: Reading, spec: RequiredReading, label: str) -> None:
    where = f"account {label!r} reading {reading.id!r}"
    value = reading.value
    if spec.kind == "money":
        if isinstance(value, str) or not math.isfinite(value):
            raise WorksheetRefused(f"worksheet {where} is not a finite number")
    elif not isinstance(value, str):
        raise WorksheetRefused(f"worksheet {where} is not text")
    elif spec.kind == "text":
        if not value.strip():
            raise WorksheetRefused(f"worksheet {where} is empty text")
        if spec.id == "trade_mode" and value not in _TRADE_MODES:
            raise WorksheetRefused(f"worksheet {where} is not real or demo")
    elif spec.kind == "instant":
        try:
            if not _INSTANT_RE.match(value):
                raise ValueError(value)
            datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            raise WorksheetRefused(
                f"worksheet {where} is not an ISO-8601 UTC instant ending in Z"
            ) from None
    elif not _SHA256_RE.match(value):  # sha256
        raise WorksheetRefused(f"worksheet {where} is not 64 lowercase hex characters")


def require_complete(
    worksheet: Worksheet, required: tuple[RequiredReading, ...]
) -> None:
    """Raise unless every account holds every required reading, correctly.

    Per reading: the id must be in the list (``UnknownReading``), the provenance
    must be in THAT id's allowed subset (``ProvenanceRefused``), the as-of rule and
    the value kind must hold (``WorksheetRefused``). Missing readings are collected
    over every account and reported together (``WorksheetIncomplete``)."""
    by_id = {spec.id: spec for spec in required}
    if not worksheet.accounts:
        raise WorksheetIncomplete("worksheet has no accounts")
    missing: dict[str, list[str]] = {}
    for label, readings in worksheet.accounts.items():
        counts: dict[str, int] = {}
        keys: set[tuple[str, str | None]] = set()
        for reading in readings:
            spec = by_id.get(reading.id)
            if spec is None:
                raise UnknownReading(
                    f"account {label!r} carries a reading id that is not in the "
                    f"required-readings list: {reading.id!r}"
                )
            if reading.provenance not in spec.provenance:
                raise ProvenanceRefused(
                    f"provenance {reading.provenance!r} is not allowed for reading "
                    f"{reading.id!r} (allowed: {', '.join(sorted(spec.provenance))})"
                )
            if spec.as_of == "required" and reading.as_of is None:
                raise WorksheetRefused(
                    f"worksheet account {label!r} reading {reading.id!r} needs an as_of day"
                )
            if spec.as_of == "forbidden" and reading.as_of is not None:
                raise WorksheetRefused(
                    f"worksheet account {label!r} reading {reading.id!r} must not "
                    "carry an as_of day"
                )
            _check_value(reading, spec, label)
            key = (reading.id, reading.as_of)
            if key in keys:
                raise WorksheetRefused(
                    f"worksheet account {label!r} reading {reading.id!r} is given "
                    "twice for the same as_of"
                )
            keys.add(key)
            counts[reading.id] = counts.get(reading.id, 0) + 1
        absent = [
            spec.id for spec in required if counts.get(spec.id, 0) < spec.min_count
        ]
        if absent:
            missing[label] = absent
    if missing:
        detail = "; ".join(f"{label}: {', '.join(ids)}" for label, ids in missing.items())
        raise WorksheetIncomplete(f"worksheet is missing required readings ({detail})")


def bind_report(worksheet: Worksheet, label: str, report_bytes: bytes) -> None:
    """Refuse unless the sha256 of ``report_bytes`` equals the account's recorded
    ``all_history_report_sha256`` reading, so a Report edited or swapped after the
    founder's reading never reaches a comparison."""
    readings = worksheet.accounts.get(label)
    if readings is None:
        raise ReportBindingRefused(f"worksheet has no account {label!r}")
    recorded = [r for r in readings if r.id == _SHA256_READING_ID]
    if len(recorded) != 1 or not isinstance(recorded[0].value, str):
        raise ReportBindingRefused(
            f"account {label!r} must carry exactly one {_SHA256_READING_ID!r} reading"
        )
    if recorded[0].provenance != "terminal_report_export":
        raise ReportBindingRefused(
            f"account {label!r} {_SHA256_READING_ID!r} reading is not a terminal_report_export"
        )
    if hashlib.sha256(report_bytes).hexdigest() != recorded[0].value:
        raise ReportBindingRefused(
            f"the Report bytes do not match the sha256 recorded for account {label!r}"
        )
