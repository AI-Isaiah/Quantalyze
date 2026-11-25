"""Phase 222 ALERTTRUTH, plan 02 (ERRC-01): no production string offers the legacy support pointer.

WHAT THIS PINS. ROADMAP SC-1 for ``analytics-service``: no string a user can read
sends them to the legacy support pointer (the two words ``contact`` and ``support``).
The five user-readable sentences name the contact form instead.

WHY AST AND NOT GREP. A raw grep both over-counts and under-counts. It trips on a
comment in ``services/job_worker.py`` (the derive handler explains the old wording)
and on docstrings, none of which a user ever reads. It also misses a phrase split
across two source lines (``"contact "`` then ``"support"``), which Python merges into
one literal at parse time. The ast scan reads exactly what Python will render:

- adjacent string literals merge into one ``ast.Constant``;
- implicitly concatenated f-strings merge into one ``JoinedStr`` whose literal
  parts between interpolations are ``ast.Constant`` nodes;
- ``#`` comments are not nodes at all.

BLIND SPOT. A phrase split across an f-string interpolation boundary
(``f"contact {x}support"``) is not one Constant, so it is not caught. No production
sentence is built that way, and the five pins below read the sentences themselves.

WHAT IT SCANS. Every tracked ``.py`` file under ``services/``, ``routers/``,
``models/`` and ``scripts/`` plus the four entry points, from ``git ls-files`` so a
new file is covered without an edit here. Docstrings are skipped, matching the
analog ``tests/test_legacy_table_not_named.py``.
"""

from __future__ import annotations

import ast
import re
import subprocess
from pathlib import Path

import pytest

ANALYTICS_ROOT = Path(__file__).resolve().parents[1]

SCAN_PATHSPECS = (
    "services",
    "routers",
    "models",
    "scripts",
    "main.py",
    "main_worker.py",
    "main_worker_healthz.py",
    "sentry_init.py",
)

# "The legacy support pointer": the two words, in any case, across any whitespace
# (a source-line split lands as a single space or newline in the merged literal).
LEGACY_POINTER = re.compile(r"contact\s+support", re.IGNORECASE)


def _tracked_python_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--", *SCAN_PATHSPECS],
        cwd=ANALYTICS_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return [ANALYTICS_ROOT / p for p in out.split("\0") if p.endswith(".py")]


def _docstring_constants(tree: ast.AST) -> set[int]:
    """ids of the Constant nodes that are module/class/function docstrings."""
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                ids.add(id(body[0].value))
    return ids


def _offences_in_source(source: str, label: str) -> list[str]:
    """``<label>:<line>`` for every non-docstring str Constant carrying the pointer."""
    tree = ast.parse(source, filename=label)
    docstrings = _docstring_constants(tree)
    found: list[str] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and id(node) not in docstrings
            and LEGACY_POINTER.search(node.value)
        ):
            found.append(f"{label}:{node.lineno}")
    return found


def _offences(path: Path) -> list[str]:
    rel = str(path.relative_to(ANALYTICS_ROOT))
    return _offences_in_source(path.read_text(encoding="utf-8"), rel)


def test_no_production_string_offers_the_legacy_support_pointer() -> None:
    files = _tracked_python_files()
    # The scan must be live: an empty or truncated list would pass vacuously.
    scanned = {str(p.relative_to(ANALYTICS_ROOT)) for p in files}
    assert "services/job_worker.py" in scanned, (
        "git ls-files did not list services/job_worker.py, so the scan is vacuous"
    )
    assert "main.py" in scanned and "main_worker.py" in scanned

    offences = [line for path in files for line in _offences(path)]
    assert not offences, (
        "a production string still offers the legacy support pointer; name the "
        "contact form instead (Phase 222 ERRC-01):\n  " + "\n  ".join(offences)
    )


def test_scanner_self_test_catches_split_and_fstring_literals_only() -> None:
    # A scanner that reports nothing passes the real scan vacuously, so prove it can
    # fire on the shapes the real code uses and stay quiet on the ones it must skip.
    source = (
        '"""Module docstring: contact support is mentioned here and is skipped."""\n'
        "\n"
        "def f(n: int) -> str:\n"
        '    """Function docstring: contact support, also skipped."""\n'
        "    # a comment that says contact support is not a node\n"
        "    split = (\n"
        '        "line one, contact "\n'
        '        "support if this persists"\n'
        "    )\n"
        "    piece = (\n"
        '        f"value {n}: "\n'
        '        f"form, Contact   Support."\n'
        "    )\n"
        '    clean = "Use the contact form if this persists."\n'
        "    return split + piece + clean\n"
    )
    found = _offences_in_source(source, "synthetic.py")
    # Exactly two: the line-split literal and the f-string literal piece. Line
    # numbers of merged literals are an ast detail, so assert the count and label.
    assert len(found) == 2, f"docstrings, comments and the clean sentence must not report: {found}"
    assert all(x.startswith("synthetic.py:") for x in found), found


# (file, function, expected clause). Hand-typed on purpose: an independent oracle
# of the wording, so a revert of any one sentence fails by name rather than being
# re-derived from the code it guards. Rows 6, 7, 8 and 10 of the UI-SPEC sentence
# register are DERIVED wording (RESEARCH A2); the member-cap clause is CONTEXT-locked.
SENTENCE_PINS = (
    (
        "services/exchange.py",
        "validate_key_permissions",
        "Key validation failed unexpectedly. Use the contact form if this persists.",
    ),
    (
        "services/csv_validator.py",
        "_maybe_auto_normalize_percent_form",
        "If your file was already in decimal form, use the contact form.",
    ),
    (
        "services/job_worker.py",
        "run_sync_trades_job",
        "Analytics enqueue failed during sync. The next scheduled sync will retry "
        "— use the contact form if this persists.",
    ),
    (
        "services/job_worker.py",
        "run_stitch_composite_job",
        "Reduce members or use the contact form to ask for a higher limit.",
    ),
    (
        "routers/portfolio.py",
        "verify_strategy",
        "Verification failed. Use the contact form if this persists.",
    ),
)


def _string_constants_in_function(path: Path, function: str) -> list[str]:
    """Every str Constant inside the named (async) function, at any depth.

    Joined-string pieces are concatenated per ``JoinedStr`` so an f-string sentence
    split around an interpolation is still read as the sentence it renders; the
    ``{...}`` holes become ``{}``.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    funcs = [
        n
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == function
    ]
    assert funcs, f"{path.relative_to(ANALYTICS_ROOT)}::{function} not found (pin is vacuous)"
    out: list[str] = []
    for fn in funcs:
        for node in ast.walk(fn):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                out.append(node.value)
            elif isinstance(node, ast.JoinedStr):
                out.append(
                    "".join(
                        v.value
                        if isinstance(v, ast.Constant) and isinstance(v.value, str)
                        else "{}"
                        for v in node.values
                    )
                )
    return out


@pytest.mark.parametrize(("rel", "function", "clause"), SENTENCE_PINS)
def test_each_sentence_names_the_contact_form_in_its_own_function(
    rel: str, function: str, clause: str
) -> None:
    assert "contact form" in clause and not LEGACY_POINTER.search(clause)
    constants = _string_constants_in_function(ANALYTICS_ROOT / rel, function)
    assert any(clause in c for c in constants), (
        f"{rel}::{function} no longer produces {clause!r}"
    )
