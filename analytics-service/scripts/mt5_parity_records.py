"""Records CLI for the MT5 parity harness (PARITY-03, PARITY-04, success criterion 5).

A thin argparse wrapper; every decision lives in ``services.mt5_parity_capture`` and
``services.mt5_parity_findings``. Run from ``analytics-service/``::

    python3 -m scripts.mt5_parity_records seal --run-dir D
    python3 -m scripts.mt5_parity_records render-ordinal SQL_FILE ORDINAL
    python3 -m scripts.mt5_parity_records census --run-dir D --out F
    python3 -m scripts.mt5_parity_records findings --run-dir D --out F
    python3 -m scripts.mt5_parity_records scan [--profile record|fixture] PATH...

``census`` reads only the SEALED copies (census files and labels) and ``findings``
refuses a ``derived/surface-matrix.json`` whose top-level ``capture_manifest_sha256``
is not the sha256 hex of the bytes of ``sealed/manifest.json`` (the content of its
``.sha256`` sidecar).

The CLI derives no output path and writes only the ``--out`` it was given. ``census``
and ``findings`` scan their own rendering with the record profile and write nothing
when a rule hits.

Exit codes: 0 ok, 1 a scan hit, 2 an input refusal (exception class and message on
stderr), including a ``scan`` that found no file to scan: a scan over zero files
proves nothing, so it never exits 0.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from services.mt5_parity_capture import (
    CaptureRefused,
    _analytics_row,
    _read_verified,
    load_capture,
    render_per_ordinal,
    seal_capture,
)
from services.mt5_parity_findings import (
    FlagReading,
    Finding,
    LabelMissing,
    ScanProfile,
    classify_account_flags,
    classify_matrix,
    number_findings,
    render_census_markdown,
    render_findings_markdown,
    require_matching_labels,
    require_matching_manifest,
    scan_tracked_text,
)

EXIT_OK = 0
EXIT_SCAN_HIT = 1
EXIT_REFUSED = 2

_SCANNED_SUFFIXES = frozenset({".md", ".json", ".sql"})
_REFUSALS = (ValueError, CaptureRefused, OSError, KeyError, TypeError)


def _refuse(error: BaseException) -> int:
    print(f"{type(error).__name__}: {error}", file=sys.stderr)
    return EXIT_REFUSED


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _rows(path: Path) -> list[dict[str, Any]]:
    data = _read_json(path)
    if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
        raise ValueError(f"{path.name} is not a JSON array of row objects")
    return data


def _verified_rows(sealed: Path, name: str) -> list[dict[str, Any]]:
    """A sealed file, re-hashed against its sidecar and the manifest, as rows."""
    raw, digest = _read_verified(sealed, name)
    manifest = json.loads(_read_verified(sealed, "manifest.json")[0])
    if manifest["files"].get(name[: -len(".json")]) != digest:
        raise CaptureRefused(f"sealed file {name} is not the one the manifest lists")
    data = json.loads(raw)
    if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
        raise ValueError(f"{name} is not a JSON array of row objects")
    return data


def _write_scanned(out: Path, text: str) -> int:
    hits = scan_tracked_text(text, "record")
    if hits:
        for rule in hits:
            print(f"{out.name}: {rule}", file=sys.stderr)
        print("nothing written: the rendering breaks the tracked-text rules", file=sys.stderr)
        return EXIT_SCAN_HIT
    out.write_text(text, encoding="utf-8")
    return EXIT_OK


def _cmd_seal(args: argparse.Namespace) -> int:
    try:
        seal_capture(Path(args.run_dir))
    except _REFUSALS as error:
        return _refuse(error)
    print("sealed")
    return EXIT_OK


def _cmd_render_ordinal(args: argparse.Namespace) -> int:
    try:
        text = Path(args.sql_file).read_text(encoding="utf-8")
        print(render_per_ordinal(text, args.ordinal))
    except _REFUSALS as error:
        return _refuse(error)
    return EXIT_OK


def _cmd_census(args: argparse.Namespace) -> int:
    sealed = Path(args.run_dir) / "sealed"
    try:
        # Only the sealed, sha256-verified copies: a raw file edited after sealing is
        # never rendered into the tracked record.
        manifest = json.loads(_read_verified(sealed, "manifest.json")[0])
        labels = manifest["labels"]
        if not isinstance(labels, dict):
            raise ValueError("manifest labels are not an ordinal-to-label object")
        text = render_census_markdown(
            _verified_rows(sealed, "census-accounts.json"),
            _verified_rows(sealed, "census-edges.json"),
            labels,
        )
    except (*_REFUSALS, LabelMissing) as error:
        return _refuse(error)
    return _write_scanned(Path(args.out), text)


def _cmd_findings(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir)
    matrix_path = run_dir / "derived" / "surface-matrix.json"
    try:
        capture = load_capture(run_dir)
        if not matrix_path.exists():
            raise FileNotFoundError("derived/surface-matrix.json is absent: run the surface harness first")
        matrix = _read_json(matrix_path)
        if not isinstance(matrix, dict):
            raise ValueError("surface-matrix.json is not an object")
        require_matching_labels(matrix, capture.labels.values())
        require_matching_manifest(
            matrix, _read_verified(run_dir / "sealed", "manifest.json")[1]
        )
        # Provenance must agree: a synthetic capture rendered as a real record, or a real
        # capture rendered as a synthetic one, is a false parity pass either way.
        if capture.synthetic != (matrix.get("mode") == "synthetic"):
            raise CaptureRefused(
                f"capture synthetic={capture.synthetic} but the surface matrix mode is "
                f"{matrix.get('mode')!r}: the findings record refuses mixed provenance"
            )

        readings: list[FlagReading] = []
        findings: list[Finding] = []
        for ordinal, label in sorted(capture.labels.items(), key=lambda p: p[1]):
            row = _analytics_row(capture, ordinal)
            if row is None:
                findings.append(
                    Finding(
                        "", "flag", "analytics_row", label, "unknown",
                        "no single non-archived analytics row is captured for this account, "
                        "so its flags cannot be read",
                    )
                )
                continue
            account_readings, account_findings = classify_account_flags(label, row)
            readings.extend(account_readings)
            findings.extend(account_findings)
        matrix_findings, observations = classify_matrix(matrix)
        findings.extend(matrix_findings)
        mode = matrix.get("mode")
        text = render_findings_markdown(
            number_findings(findings), observations, readings, str(mode)
        )
    except (*_REFUSALS, LabelMissing) as error:
        return _refuse(error)
    return _write_scanned(Path(args.out), text)


def _scan_targets(paths: Sequence[str]) -> tuple[list[Path], int]:
    """The files to scan and how many files in a directory were skipped for suffix."""
    targets: list[Path] = []
    skipped = 0
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            files = sorted(p for p in path.rglob("*") if p.is_file())
            targets.extend(p for p in files if p.suffix in _SCANNED_SUFFIXES)
            skipped += sum(1 for p in files if p.suffix not in _SCANNED_SUFFIXES)
        elif path.is_file():
            targets.append(path)
        else:
            raise FileNotFoundError(f"{raw} is neither a file nor a directory")
    return targets, skipped


def _cmd_scan(args: argparse.Namespace) -> int:
    profile: ScanProfile = args.profile
    try:
        targets, skipped = _scan_targets(args.paths)
        if not targets:
            raise ValueError(
                f"no file to scan: {skipped} file(s) skipped for suffix, none of {sorted(_SCANNED_SUFFIXES)}"
            )
        hit = False
        for path in targets:
            for rule in scan_tracked_text(path.read_text(encoding="utf-8"), profile):
                print(f"{path}: {rule}")
                hit = True
    except _REFUSALS as error:
        return _refuse(error)
    print(f"scanned: {len(targets)} file(s), skipped for suffix: {skipped}")
    return EXIT_SCAN_HIT if hit else EXIT_OK


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mt5_parity_records", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    seal = sub.add_parser("seal", help="verify raw/ and write sealed/")
    seal.add_argument("--run-dir", required=True)
    seal.set_defaults(func=_cmd_seal)

    render = sub.add_parser("render-ordinal", help="print one committed statement for one ordinal")
    render.add_argument("sql_file")
    render.add_argument("ordinal")
    render.set_defaults(func=_cmd_render_ordinal)

    census = sub.add_parser("census", help="render the tracked census record")
    census.add_argument("--run-dir", required=True)
    census.add_argument("--out", required=True)
    census.set_defaults(func=_cmd_census)

    findings = sub.add_parser("findings", help="render the tracked findings record")
    findings.add_argument("--run-dir", required=True)
    findings.add_argument("--out", required=True)
    findings.set_defaults(func=_cmd_findings)

    scan = sub.add_parser("scan", help="scan tracked text for amounts, ids and home paths")
    scan.add_argument("--profile", choices=("record", "fixture"), default="record")
    scan.add_argument("paths", nargs="+")
    scan.set_defaults(func=_cmd_scan)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    code: int = args.func(args)
    return code


if __name__ == "__main__":
    sys.exit(main())
