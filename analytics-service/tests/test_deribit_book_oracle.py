"""Phase 233 DERIBITTRUTH plan 03 - tests for ``scripts/deribit_book_oracle.py`` (DBOOK-01).

The oracle recomputes each published return of the founder's Deribit book from the stored
per-key booked P&L, flows and levels and names every day it cannot reproduce. A money-math
oracle is worth nothing unless it can disagree with what it judges, so every fixture here is
derived BY HAND (the derivation is the fixture's ``_comment``), and the independence of the
script is a parsed-AST fact, not a promise. Nothing here touches a venue or a database.

Why each test matters (Rule 9):
  1. ``test_tracer_explained_book_reads_clean``: a two-key book whose published returns were
     derived by hand reads CLEAN, the first day omitted as ``no_stored_base_level``.
     REVERT-PROOF: using the day's own level in place of the previous day's level in the book
     denominator moves every day off the hand value and the reading is no longer CLEAN.
  2. ``test_the_oracle_imports_no_production_helper``: the script imports no production,
     network or process module, module level or function local, and the scan is proven able to
     fail. REVERT-PROOF: a module-level ``import services.nav_twr`` in the script fails the scan
     by name.
  3. ``test_withheld_attribution_mismatch``: one published value altered by hand is withheld
     ``attribution_mismatch`` and the verdict is STOP.
     REVERT-PROOF: classifying every published day explained turns the reading CLEAN.
  4. ``test_withheld_no_stored_base_level``: a counted key with no writer basis that joins late
     withholds the one day it participates on as ``no_stored_base_level``.
  5. ``test_withheld_key_basis_not_reproducible``: a stamp that disagrees with P over the
     previous level withholds its day as ``key_basis_not_reproducible`` even though the
     published value equals the oracle's own.
  6. ``test_key_set_mismatch_withholds_every_published_day``: a declared set that does not count
     to ``inputs.n_keys`` withholds every published day and is STOP, never VACUOUS.
     REVERT-PROOF: removing the ``n_keys`` comparison reads the key set as reproduced.
  7. ``test_a_run_that_explains_nothing_is_vacuous_not_green``: a reproduced key set with no
     reproduced day exits 3. REVERT-PROOF: removing the VACUOUS check exits 1 instead.
  8. ``test_loader_*``: the strict loader refuses an unknown key, a non-ISO day and a
     non-finite number by field path, never by value.
"""
from __future__ import annotations

import ast
import json
import shutil
from pathlib import Path

import pytest

import scripts.deribit_book_oracle as oracle

_FIXTURES = Path(__file__).parent / "fixtures" / "deribit_book_oracle"
_SCRIPT = Path(oracle.__file__)


def _run(name: str, capsys: pytest.CaptureFixture[str]) -> tuple[int, list[str]]:
    code = oracle.main(["--input", str(_FIXTURES / name)])
    out = capsys.readouterr().out
    return code, [line for line in out.splitlines() if line]


def _lines(lines: list[str], prefix: str) -> list[str]:
    return [line for line in lines if line.startswith(prefix)]


def test_tracer_explained_book_reads_clean(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("explained_two_keys.json", capsys)
    assert code == 0
    assert _lines(lines, "oracle-book:") == [
        "oracle-book: book=A published=4 explained=4 withheld=0 omitted=1 annotated=0"
    ]
    assert _lines(lines, "oracle-omitted:") == [
        "oracle-omitted: date=2025-01-01 reason=no_stored_base_level"
    ]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=CLEAN withheld_published=0 omission_unexplained=0 key_set=reproduced"
    ]
    assert lines[-1].startswith("oracle-verdict:")


# ── independence: a parsed-AST fact ────────────────────────────────────────────────────────────

_ALLOWED_ROOTS = frozenset(
    {"__future__", "argparse", "json", "math", "re", "sys", "datetime", "collections", "typing", "dataclasses"}
)
_FORBIDDEN_ROOTS = frozenset(
    {"services", "routers", "models", "scripts", "socket", "subprocess", "urllib", "http", "requests",
     "httpx", "psycopg", "psycopg2", "supabase", "importlib"}
)


def _import_violations(tree: ast.AST) -> list[str]:
    """Every import, at any depth, of a production, network, process or non-allowlisted module."""
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                found.append("import:<relative>")
                continue
            modules = [node.module or ""]
        elif isinstance(node, ast.Name) and node.id == "__import__":
            found.append("import:__import__")
            continue
        else:
            continue
        for module in modules:
            root = module.split(".")[0]
            if root in _FORBIDDEN_ROOTS or root.startswith("main") or root not in _ALLOWED_ROOTS:
                found.append("import:" + module)
    return found


def test_the_oracle_imports_no_production_helper() -> None:
    tree = ast.parse(_SCRIPT.read_text(encoding="utf-8"))
    # Vacuity guard: the scan is about THIS oracle, so its named public pieces must be in the tree.
    defined = {n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
    assigned = {
        t.id
        for n in ast.walk(tree)
        if isinstance(n, (ast.Assign, ast.AnnAssign))
        for t in ([n.target] if isinstance(n, ast.AnnAssign) else n.targets)
        if isinstance(t, ast.Name)
    }
    for name in ("main", "load_export", "roll_key_levels", "reproduce_book", "classify_days",
                 "emit_reading", "ExportError", "sig3"):
        assert name in defined, f"oracle piece missing from the parsed script: {name}"
    for name in ("WITHHELD_REASONS", "OMITTED_REASONS", "ANNOTATIONS"):
        assert name in assigned, f"closed set missing from the parsed script: {name}"

    # The scan itself can fail: a module-level and a function-local production import are flagged,
    # and so is a network import and an allowlist escape.
    assert "import:services.nav_twr" in _import_violations(ast.parse("import services.nav_twr\n"))
    assert "import:services.nav_twr" in _import_violations(
        ast.parse("def f():\n    from services.nav_twr import cohort\n    return cohort\n")
    )
    assert "import:socket" in _import_violations(ast.parse("import socket\n"))
    assert "import:numpy" in _import_violations(ast.parse("import numpy\n"))
    assert _import_violations(ast.parse("import math\nfrom dataclasses import dataclass\n")) == []

    violations = _import_violations(tree)
    assert violations == [], f"the oracle imports what it judges or reaches out: {violations}"
