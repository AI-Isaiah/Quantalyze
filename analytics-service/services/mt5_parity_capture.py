"""Seal, load and read the MT5 parity capture (PARITY-03): OUR side of the comparison.

The capture is a set of raw JSON files the phase orchestrator writes after running
the committed SELECT-only capture SQL against PROD through the Supabase MCP. This
module never touches PROD, a database, a socket or the gateway: it turns a raw run
directory into a SEALED one (canonical JSON plus a sha256 per file, bound by a
manifest), refuses anything that does not add up, and reads the sealed rows back as
typed adapters for the compare engine.

WHAT THE SEAL REFUSES (every refusal raises ``CaptureRefused`` and names a file, an
ordinal, a slice or a column, never a value; the raw rows are PROD figures):

* ``bind-before`` and ``bind-after`` absent or different. A changed witness means a
  derive moved a row while the capture ran, so the files describe two moments.
* A capture file whose row keys are not the witness columns plus that file's extras.
* A ``row_count`` that disagrees with the rows actually loaded (an MCP truncation
  would otherwise read as a shorter record).
* A ``first_day`` / ``last_day`` that disagrees with the min and max of the day column.
* An ``<col>_len`` witness that is not aligned with, or does not equal, the lengths
  of the stored arrays.
* A required slice file (every ``CAPTURE_FILES`` entry, pinned equal to
  ``capture-contract.json``) that is absent, or that does not hold one witness row per
  bound ordinal. A result truncated at whole ordinals reads as a shorter record
  otherwise.
* A slice whose row count or newest timestamp disagrees with the ``bind-before``
  witness for that ordinal (``_BIND_WITNESS``).
* A NaN or infinity anywhere (``allow_nan=False``), a symlink, a file over 64 MiB, a
  path that resolves outside the run directory, an ordinal with no label.

``load_capture`` re-hashes every sealed slice and the manifest before it parses one.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from types import MappingProxyType
from typing import Any, Final, Literal

import pandas as pd

from services.wealth_returns import daily_returns_from_row

WITNESS_COLUMNS: Final[tuple[str, ...]] = (
    "key_ordinal",
    "slice_rows",
    "row_count",
    "first_day",
    "last_day",
)

MAX_RAW_FILE_BYTES: Final[int] = 64 * 1024 * 1024
EXCLUDED_LABEL: Final[str] = "excluded"
BUNDLE_VERSION: Final[int] = 1
MANIFEST_VERSION: Final[int] = 2

_ORDINAL_RE: Final[re.Pattern[str]] = re.compile(r"^k[0-9]{1,3}$")
_RAW_NAME_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.json$")
_PASSTHROUGH_FILES: Final[tuple[str, ...]] = ("census-accounts", "census-edges")

# slice -> (bind column holding its row count or None, bind column holding its newest
# timestamp, the slice-row column that timestamp is the max of). The columns are the
# ones ``bind.sql`` returns. keymap, strategy, series and btc have no bind witness:
# for those the seal can only require the file and one witness row per bound ordinal.
_BIND_WITNESS: Final[Mapping[str, tuple[str | None, str, str]]] = MappingProxyType(
    {
        "analytics": ("analytics_rows", "analytics_max_computed_at", "computed_at"),
        "marks": ("marks_count", "marks_max_created_at", "created_at"),
        "key_inputs": (None, "key_inputs_computed_at", "computed_at"),
        "returns": ("returns_count", "returns_max_updated_at", "updated_at"),
        "equity_curve": (None, "equity_curve_computed_at", "computed_at"),
        "holdings": (None, "holdings_max_updated_at", "updated_at"),
    }
)


class CaptureRefused(Exception):
    """The capture does not add up, or a sealed file moved. The sentence names a
    slice, a column, an ordinal or a witness, never a value."""


@dataclass(frozen=True, slots=True)
class SliceSpec:
    """What one capture SQL file returns for each MT5 key ordinal."""

    slice: str
    table: str
    day_column: str | None
    row_shape: Literal["whole_row", "columns"]
    columns: tuple[str, ...]
    extra_witness: tuple[str, ...]


_HOLDINGS_COLUMNS: Final[tuple[str, ...]] = (
    "id",
    "allocator_id",
    "api_key_id",
    "venue",
    "symbol",
    "asof",
    "holding_type",
    "side",
    "quantity",
    "value_usd",
    "entry_price",
    "mark_price",
    "unrealized_pnl_usd",
    "cost_basis_usd",
    "quantity_unit",
    "created_at",
    "updated_at",
)

_KEYMAP_COLUMNS: Final[tuple[str, ...]] = (
    "api_key_id",
    "allocator_id",
    "label",
    "account_currency",
    "strategy_id",
    "strategy_status",
    "asset_class",
    "key_created_at",
)

CAPTURE_FILES: Final[Mapping[str, SliceSpec]] = MappingProxyType(
    {
        "capture-keymap.sql": SliceSpec(
            "keymap", "api_keys", None, "columns", _KEYMAP_COLUMNS, ()
        ),
        "capture-strategy.sql": SliceSpec(
            "strategy", "strategies", None, "whole_row", (), ()
        ),
        "capture-analytics.sql": SliceSpec(
            "analytics",
            "strategy_analytics",
            None,
            "whole_row",
            (),
            ("returns_series_len", "daily_returns_len"),
        ),
        "capture-series.sql": SliceSpec(
            "series", "strategy_analytics_series", None, "whole_row", (), ()
        ),
        "capture-marks.sql": SliceSpec(
            "marks", "api_key_nav_marks", "mark_day", "whole_row", (), ()
        ),
        "capture-key-inputs.sql": SliceSpec(
            "key_inputs", "allocator_equity_derived", None, "whole_row", (), ()
        ),
        "capture-returns.sql": SliceSpec(
            "returns", "csv_daily_returns", "date", "whole_row", (), ()
        ),
        "capture-holdings.sql": SliceSpec(
            "holdings", "allocator_holdings", "asof", "columns", _HOLDINGS_COLUMNS, ()
        ),
        "capture-equity-curve.sql": SliceSpec(
            "equity_curve", "allocator_equity_derived", None, "whole_row", (), ()
        ),
        "capture-btc.sql": SliceSpec(
            "btc", "benchmark_prices", "date", "whole_row", (), ()
        ),
    }
)


@dataclass(frozen=True, slots=True)
class Capture:
    """A sealed capture, loaded. ``slices`` maps a slice name to every retained
    ordinal's rows (each row carries its ``key_ordinal``); an ordinal labelled
    ``excluded`` is not in it. ``computed_at`` maps an ordinal to its analytics
    row's ``computed_at``."""

    slices: Mapping[str, tuple[Mapping[str, Any], ...]]
    labels: Mapping[str, str]
    computed_at: Mapping[str, str]
    synthetic: bool = False


@dataclass(frozen=True, slots=True)
class MarkReading:
    """One stored NAV mark in the account's own unit: the native columns when the
    mark carries a native unit, else the USD columns."""

    nav: float
    open_pnl: float
    marked_at: datetime
    unit: str


# --------------------------------------------------------------------------- seal


def seal_bytes(obj: object) -> tuple[bytes, str]:
    """Canonical JSON bytes and their sha256 hex digest. ``allow_nan=False`` makes a
    NaN or an infinity raise ``ValueError`` here instead of sealing it."""
    raw = json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        ensure_ascii=True,
    ).encode("ascii")
    return raw, hashlib.sha256(raw).hexdigest()


def _seal(obj: object, what: str) -> tuple[bytes, str]:
    try:
        return seal_bytes(obj)
    except ValueError:
        raise CaptureRefused(f"{what} carries a non-finite number") from None


def _refuse_constant(name: str) -> Any:
    raise ValueError(name)


def _checked_path(run_dir: Path, path: Path) -> Path:
    """``path`` if it is a regular file inside ``run_dir`` and not too large."""
    root = run_dir.resolve()
    if path.is_symlink():
        raise CaptureRefused(f"{path.name} is a symlink")
    resolved = path.resolve()
    if root != resolved and root not in resolved.parents:
        raise CaptureRefused(f"{path.name} resolves outside the run directory")
    if not resolved.is_file():
        raise CaptureRefused(f"{path.name} is not a regular file")
    if resolved.stat().st_size > MAX_RAW_FILE_BYTES:
        raise CaptureRefused(f"{path.name} is larger than the size limit")
    return resolved


def _read_rows(run_dir: Path, path: Path) -> list[dict[str, Any]]:
    resolved = _checked_path(run_dir, path)
    try:
        data = json.loads(
            resolved.read_text(encoding="utf-8"), parse_constant=_refuse_constant
        )
    except ValueError:
        raise CaptureRefused(
            f"{path.name} is not valid JSON or carries a non-finite number"
        ) from None
    if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
        raise CaptureRefused(f"{path.name} is not a JSON array of row objects")
    return data


def _day_of(value: Any) -> str | None:
    return None if value is None else str(value)[:10]


def _check_witness_row(
    stem: str, spec: SliceSpec, row: Mapping[str, Any]
) -> list[dict[str, Any]]:
    """Refusals 2-5 for one ordinal's witness row. Returns its ``slice_rows``."""
    ordinal = row.get("key_ordinal")
    if not isinstance(ordinal, str) or not _ORDINAL_RE.match(ordinal):
        raise CaptureRefused(f"{stem} has a row without a valid key_ordinal")
    expected = set(WITNESS_COLUMNS) | set(spec.extra_witness)
    if set(row) != expected:
        raise CaptureRefused(
            f"{stem} {ordinal} witness columns are not the contract columns"
        )
    slice_rows = row["slice_rows"]
    if not isinstance(slice_rows, list) or not all(
        isinstance(r, dict) for r in slice_rows
    ):
        raise CaptureRefused(f"{stem} {ordinal} slice_rows is not an array of rows")
    row_count = row["row_count"]
    if isinstance(row_count, bool) or row_count != len(slice_rows):
        raise CaptureRefused(f"{stem} {ordinal} row_count disagrees with the rows loaded")
    if spec.day_column is not None:
        days = sorted(
            d for d in (_day_of(r.get(spec.day_column)) for r in slice_rows) if d
        )
        first = days[0] if days else None
        last = days[-1] if days else None
        if _day_of(row["first_day"]) != first or _day_of(row["last_day"]) != last:
            raise CaptureRefused(
                f"{stem} {ordinal} first_day/last_day disagree with column {spec.day_column}"
            )
    if spec.row_shape == "columns":
        for r in slice_rows:
            if set(r) != set(spec.columns):
                raise CaptureRefused(
                    f"{stem} {ordinal} rows do not carry the contract columns"
                )
    for name in spec.extra_witness:
        column = name[: -len("_len")]
        lens = row[name]
        if not isinstance(lens, list) or len(lens) != len(slice_rows):
            raise CaptureRefused(f"{stem} {ordinal} witness {name} is not aligned with the rows")
        for stored, witnessed in zip(slice_rows, lens, strict=True):
            value = stored.get(column)
            want = len(value) if isinstance(value, list) else None
            if witnessed != want:
                raise CaptureRefused(f"{stem} {ordinal} witness {name} disagrees with the stored array")
    return slice_rows


def _check_bind_witness(
    stem: str,
    spec: SliceSpec,
    ordinal: str,
    bind_row: Mapping[str, Any],
    slice_rows: list[dict[str, Any]],
) -> None:
    """The slice's row count and newest timestamp must equal ``bind-before``'s."""
    columns = _BIND_WITNESS.get(spec.slice)
    if columns is None:
        return
    count_column, max_column, row_column = columns
    if count_column is not None:
        if count_column not in bind_row:
            raise CaptureRefused(f"bind witness {ordinal} has no column {count_column}")
        if bind_row[count_column] != len(slice_rows):
            raise CaptureRefused(
                f"{stem} {ordinal} row count disagrees with bind witness {count_column}"
            )
    if max_column not in bind_row:
        raise CaptureRefused(f"bind witness {ordinal} has no column {max_column}")
    stamps = [parse_utc(r.get(row_column), row_column) for r in slice_rows]
    newest = max(stamps) if stamps else None
    bound = bind_row[max_column]
    if (None if bound is None else parse_utc(bound, max_column)) != newest:
        raise CaptureRefused(
            f"{stem} {ordinal} newest {row_column} disagrees with bind witness {max_column}"
        )


def _merge_fallbacks(
    run_dir: Path, stem: str, rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Replace an ordinal's row with ``raw/<stem>.<kN>.json`` where that exists."""
    raw_dir = run_dir / "raw"
    merged = list(rows)
    for fallback in sorted(raw_dir.glob(f"{stem}.k*.json")):
        ordinal = fallback.name[len(stem) + 1 : -len(".json")]
        if not _ORDINAL_RE.match(ordinal):
            raise CaptureRefused(f"{fallback.name} is not a per-ordinal fallback name")
        replacement = _read_rows(run_dir, fallback)
        if len(replacement) != 1 or replacement[0].get("key_ordinal") != ordinal:
            raise CaptureRefused(f"{fallback.name} is not one row for its own ordinal")
        merged = [r for r in merged if r.get("key_ordinal") != ordinal]
        merged.append(replacement[0])
    return merged


def _write_sealed(sealed: Path, name: str, obj: object) -> str:
    raw, digest = _seal(obj, name)
    (sealed / name).write_bytes(raw)
    (sealed / f"{name}.sha256").write_text(digest, encoding="ascii")
    return digest


def seal_capture(run_dir: Path) -> Path:
    """Verify ``run_dir/raw`` and write ``run_dir/sealed``; return the sealed dir."""
    raw_dir = run_dir / "raw"
    before = _read_rows(run_dir, raw_dir / "bind-before.json") if (
        raw_dir / "bind-before.json"
    ).exists() else None
    after = _read_rows(run_dir, raw_dir / "bind-after.json") if (
        raw_dir / "bind-after.json"
    ).exists() else None
    if before is None or after is None:
        raise CaptureRefused("bind-before or bind-after is absent")
    if before != after:
        raise CaptureRefused("bind-before and bind-after differ: a row moved mid-capture")
    bound: dict[str, dict[str, Any]] = {}
    for bind_row in before:
        key = bind_row.get("key_ordinal")
        if not isinstance(key, str) or not _ORDINAL_RE.match(key) or key in bound:
            raise CaptureRefused("bind-before has a row without a valid, unique key_ordinal")
        bound[key] = bind_row

    labels_path = run_dir / "labels.json"
    if not labels_path.exists():
        raise CaptureRefused("labels.json is absent")
    try:
        labels = json.loads(_checked_path(run_dir, labels_path).read_text(encoding="utf-8"))
    except ValueError:
        raise CaptureRefused("labels.json is not valid JSON") from None
    if not isinstance(labels, dict) or not all(
        isinstance(k, str) and isinstance(v, str) and v for k, v in labels.items()
    ):
        raise CaptureRefused("labels.json is not an ordinal-to-label object")

    # Provenance travels with the capture, not with the CLI flag that loaded it: a bundle
    # materialised by ``load_bundle`` leaves ``provenance.json``; a real run dir has none.
    synthetic = False
    provenance_path = run_dir / "provenance.json"
    if provenance_path.exists():
        try:
            provenance = json.loads(_checked_path(run_dir, provenance_path).read_text(encoding="utf-8"))
        except ValueError:
            raise CaptureRefused("provenance.json is not valid JSON") from None
        if not isinstance(provenance, dict) or set(provenance) != {"synthetic"} or not isinstance(
            provenance["synthetic"], bool
        ):
            raise CaptureRefused('provenance.json is not exactly {"synthetic": <true or false>}')
        synthetic = provenance["synthetic"]

    sealed = run_dir / "sealed"
    sealed.mkdir(exist_ok=True)
    files: dict[str, str] = {}
    seen_ordinals: set[str] = set()

    for file_name, spec in CAPTURE_FILES.items():
        stem = file_name[: -len(".sql")]
        main = raw_dir / f"{stem}.json"
        if not main.exists():
            raise CaptureRefused(f"{stem} is absent")
        witness_rows = _merge_fallbacks(run_dir, stem, _read_rows(run_dir, main))
        flat: list[dict[str, Any]] = []
        witnesses: list[dict[str, Any]] = []
        ordinals_here: set[str] = set()
        for witness in sorted(witness_rows, key=lambda r: str(r.get("key_ordinal"))):
            slice_rows = _check_witness_row(stem, spec, witness)
            ordinal = str(witness["key_ordinal"])
            if ordinal in ordinals_here:
                raise CaptureRefused(f"{stem} {ordinal} appears twice")
            ordinals_here.add(ordinal)
            if ordinal in bound:
                _check_bind_witness(stem, spec, ordinal, bound[ordinal], slice_rows)
            for r in slice_rows:
                if "key_ordinal" in r:
                    raise CaptureRefused(f"{stem} {ordinal} rows already carry key_ordinal")
                flat.append({**r, "key_ordinal": ordinal})
            witnesses.append({k: v for k, v in witness.items() if k != "slice_rows"})
        if ordinals_here != set(bound):
            raise CaptureRefused(f"{stem} does not carry exactly the bound ordinals")
        seen_ordinals |= ordinals_here
        files[spec.slice] = _write_sealed(
            sealed,
            f"{spec.slice}.json",
            {"slice": spec.slice, "table": spec.table, "rows": flat, "witness": witnesses},
        )

    for stem in ("bind-before", "bind-after", *_PASSTHROUGH_FILES):
        path = raw_dir / f"{stem}.json"
        if path.exists():
            files[stem] = _write_sealed(sealed, f"{stem}.json", _read_rows(run_dir, path))

    unlabelled = sorted(seen_ordinals - set(labels))
    if unlabelled:
        raise CaptureRefused(f"ordinal {unlabelled[0]} has no label in labels.json")

    _write_sealed(
        sealed,
        "manifest.json",
        {
            "manifest_version": MANIFEST_VERSION,
            "synthetic": synthetic,
            "files": files,
            "labels": labels,
            "bind": {"equal": True},
        },
    )
    return sealed


# --------------------------------------------------------------------------- load


def _read_verified(sealed: Path, name: str) -> tuple[bytes, str]:
    path = sealed / name
    sidecar = sealed / f"{name}.sha256"
    if not path.is_file() or not sidecar.is_file():
        raise CaptureRefused(f"sealed file {name} or its sha256 is absent")
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if sidecar.read_text(encoding="ascii").strip() != digest:
        raise CaptureRefused(f"sealed file {name} no longer matches its sha256")
    return raw, digest


def load_capture(run_dir: Path) -> Capture:
    """Verify every sealed file against its sha256 and the manifest, then load."""
    sealed = run_dir / "sealed"
    raw_manifest, _ = _read_verified(sealed, "manifest.json")
    manifest = json.loads(raw_manifest)
    if manifest.get("manifest_version") != MANIFEST_VERSION:
        raise CaptureRefused(
            f"sealed manifest is not version {MANIFEST_VERSION}: seal the run directory again"
        )
    if not isinstance(manifest.get("synthetic"), bool):
        raise CaptureRefused("sealed manifest does not say whether the capture is synthetic")
    required = {spec.slice for spec in CAPTURE_FILES.values()}
    missing = sorted(required - set(manifest["files"]))
    if missing:
        raise CaptureRefused(f"sealed manifest does not list slice {missing[0]}")
    labels: dict[str, str] = dict(manifest["labels"])
    slices: dict[str, tuple[Mapping[str, Any], ...]] = {}
    for name, listed in manifest["files"].items():
        raw, digest = _read_verified(sealed, f"{name}.json")
        if digest != listed:
            raise CaptureRefused(f"sealed slice {name} disagrees with the manifest")
        if name in {spec.slice for spec in CAPTURE_FILES.values()}:
            body = json.loads(raw)
            slices[name] = tuple(
                MappingProxyType(r)
                for r in body["rows"]
                if labels.get(r["key_ordinal"]) != EXCLUDED_LABEL
            )
    kept = {o: label for o, label in labels.items() if label != EXCLUDED_LABEL}
    capture = Capture(slices=MappingProxyType(slices), labels=MappingProxyType(kept), computed_at={})
    stamps: dict[str, str] = {}
    for ordinal in kept:
        row = _analytics_row(capture, ordinal)
        if row is not None and isinstance(row.get("computed_at"), str):
            stamps[ordinal] = row["computed_at"]
    return Capture(
        slices=capture.slices,
        labels=capture.labels,
        computed_at=MappingProxyType(stamps),
        synthetic=manifest["synthetic"],
    )


def load_bundle(bundle_path: Path, into: Path) -> Path:
    """Materialise a bundle fixture into a raw run directory; return ``into``.

    A bundle is a fixture format only: it must say ``synthetic: true``, so a real
    capture can never arrive through it."""
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    if (
        not isinstance(bundle, dict)
        or bundle.get("bundle_version") != BUNDLE_VERSION
        or bundle.get("synthetic") is not True
    ):
        raise CaptureRefused("bundle is not a synthetic version-1 bundle")
    raw = bundle.get("raw")
    labels = bundle.get("labels")
    if not isinstance(raw, dict) or not isinstance(labels, dict):
        raise CaptureRefused("bundle has no raw files or no labels")
    raw_dir = into / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in raw.items():
        if not isinstance(name, str) or not _RAW_NAME_RE.match(name):
            raise CaptureRefused("bundle names a raw file that is not a plain file name")
        (raw_dir / name).write_text(json.dumps(rows, sort_keys=True), encoding="utf-8")
    (into / "labels.json").write_text(json.dumps(labels, sort_keys=True), encoding="utf-8")
    (into / "provenance.json").write_text(json.dumps({"synthetic": True}), encoding="utf-8")
    return into


# ------------------------------------------------------------------- our-side adapters


def account_rows(
    capture: Capture, ordinal: str, slice_name: str
) -> tuple[Mapping[str, Any], ...]:
    """Every row of ``slice_name`` for one ordinal (empty if the slice is absent)."""
    return tuple(
        r for r in capture.slices.get(slice_name, ()) if r.get("key_ordinal") == ordinal
    )


def _num(value: Any, column: str) -> float:
    """A stored numeric as a finite float. ``numeric`` arrives as a JSON number or a
    string; a bool or a non-finite value is refused naming the column."""
    if isinstance(value, bool):
        raise CaptureRefused(f"column {column} is a boolean, not a number")
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise CaptureRefused(f"column {column} is not numeric") from None
    if not math.isfinite(result):
        raise CaptureRefused(f"column {column} is not finite")
    return result


def parse_utc(value: Any, column: str) -> datetime:
    """An ISO timestamp as an aware UTC datetime. A naive one is refused."""
    if not isinstance(value, str):
        raise CaptureRefused(f"column {column} is not a timestamp string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise CaptureRefused(f"column {column} is not an ISO timestamp") from None
    if parsed.tzinfo is None:
        raise CaptureRefused(f"column {column} carries no UTC offset")
    return parsed.astimezone(timezone.utc)


def our_mark(capture: Capture, ordinal: str, mark_day: date) -> MarkReading | None:
    """The stored NAV mark of ``mark_day``, or None when there is not exactly one."""
    rows = [
        r
        for r in account_rows(capture, ordinal, "marks")
        if _day_of(r.get("mark_day")) == mark_day.isoformat()
    ]
    if len(rows) != 1:
        return None
    row = rows[0]
    unit = row.get("native_unit")
    if unit is not None:
        nav = _num(row.get("nav_native"), "nav_native")
        open_pnl = _num(row.get("open_pnl_native"), "open_pnl_native")
        unit_text = str(unit)
    else:
        nav = _num(row.get("nav_usd"), "nav_usd")
        open_pnl = _num(row.get("open_pnl_usd"), "open_pnl_usd")
        unit_text = "USD"
    return MarkReading(
        nav=nav,
        open_pnl=open_pnl,
        marked_at=parse_utc(row.get("marked_at"), "marked_at"),
        unit=unit_text,
    )


def _live_strategy_ids(capture: Capture, ordinal: str) -> set[str]:
    """The ids of this ordinal's strategies that are not archived, from the strategy
    slice and the key map."""
    ids = {
        str(r["id"])
        for r in account_rows(capture, ordinal, "strategy")
        if r.get("status") != "archived" and r.get("id") is not None
    }
    for r in account_rows(capture, ordinal, "keymap"):
        if r.get("strategy_status") != "archived" and r.get("strategy_id") is not None:
            ids.add(str(r["strategy_id"]))
    return ids


def _analytics_row(capture: Capture, ordinal: str) -> Mapping[str, Any] | None:
    live = _live_strategy_ids(capture, ordinal)
    rows = [
        r
        for r in account_rows(capture, ordinal, "analytics")
        if str(r.get("strategy_id")) in live
    ]
    return rows[0] if len(rows) == 1 else None


def our_daily_returns(capture: Capture, ordinal: str) -> pd.Series | None:
    """Our stored daily returns for the ordinal, read through
    ``daily_returns_from_row`` (never an inline ratio). None when the ordinal has
    zero or several non-archived analytics rows: not measurable."""
    row = _analytics_row(capture, ordinal)
    if row is None:
        return None
    return daily_returns_from_row(row, name=ordinal)


def our_key_inputs(capture: Capture, ordinal: str) -> Mapping[str, Any] | None:
    """The ordinal's ``key_inputs:<api_key_id>`` payload, or None when there is not
    exactly one such row."""
    keymap = account_rows(capture, ordinal, "keymap")
    if len(keymap) != 1:
        return None
    kind = f"key_inputs:{keymap[0].get('api_key_id')}"
    rows = [r for r in account_rows(capture, ordinal, "key_inputs") if r.get("kind") == kind]
    if len(rows) != 1:
        return None
    payload = rows[0].get("payload")
    return payload if isinstance(payload, Mapping) else None


# ------------------------------------------------------------ per-ordinal fallback


def render_per_ordinal(statement: str, ordinal: str) -> str:
    """``SELECT * FROM (<statement without its final ;>) AS q WHERE q.key_ordinal = '<kN>';``

    The ONLY form the orchestrator may use when one MCP result is truncated: it
    re-runs a committed statement for a single ordinal and never edits the file. The
    ordinal is checked against ``^k[0-9]{1,3}$`` before it is interpolated, and the
    statement must be one statement ending in a single ``;``."""
    if not _ORDINAL_RE.match(ordinal):
        raise ValueError("ordinal is not of the form k<digits>")
    body = statement.rstrip()
    if not body.endswith(";"):
        raise ValueError("statement does not end with a semicolon")
    inner = body[:-1]
    if ";" in inner:
        raise ValueError("statement holds more than one semicolon")
    return f"SELECT * FROM ({inner}) AS q WHERE q.key_ordinal = '{ordinal}';"
