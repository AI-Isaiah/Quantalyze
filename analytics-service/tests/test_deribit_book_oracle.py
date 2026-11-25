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
from pathlib import Path
from typing import Any, Callable

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


# ── the withheld classes, the key-set STOP and the verdict order ───────────────────────────────


def test_withheld_attribution_mismatch(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("withheld_attribution_mismatch.json", capsys)
    assert code == 1
    assert _lines(lines, "oracle-book:") == [
        "oracle-book: book=A published=4 explained=3 withheld=1 omitted=1 annotated=0"
    ]
    assert _lines(lines, "oracle-withheld:") == [
        "oracle-withheld: date=2025-01-04 reason=attribution_mismatch"
    ]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=STOP withheld_published=1 omission_unexplained=0 key_set=reproduced"
    ]


def test_withheld_no_stored_base_level(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("withheld_no_base_level.json", capsys)
    assert code == 1
    assert _lines(lines, "oracle-withheld:") == [
        "oracle-withheld: date=2025-01-05 reason=no_stored_base_level"
    ]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=STOP withheld_published=1 omission_unexplained=0 key_set=reproduced"
    ]


def test_withheld_key_basis_not_reproducible(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("withheld_key_basis.json", capsys)
    assert code == 1
    # The published value on 2025-01-03 equals the oracle's own: only the per-key identity fails.
    assert _lines(lines, "oracle-withheld:") == [
        "oracle-withheld: date=2025-01-03 reason=key_basis_not_reproducible"
    ]
    assert _lines(lines, "oracle-book:") == [
        "oracle-book: book=A published=4 explained=3 withheld=1 omitted=1 annotated=0"
    ]


def test_key_set_mismatch_withholds_every_published_day(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("key_set_mismatch.json", capsys)
    assert code == 1  # STOP, never VACUOUS: the key-set rule is decided first
    assert _lines(lines, "oracle-key-set:") == [
        "oracle-key-set: declared=2 n_keys=3 reproduced=no"
    ]
    assert _lines(lines, "oracle-withheld:") == [
        f"oracle-withheld: date=2025-01-0{d} reason=key_set_not_reproducible" for d in (2, 3, 4, 5)
    ]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=STOP withheld_published=4 omission_unexplained=0 key_set=not_reproduced"
    ]


def test_a_run_that_explains_nothing_is_vacuous_not_green(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("vacuous.json", capsys)
    assert code == 3
    assert _lines(lines, "oracle-key-set:") == ["oracle-key-set: declared=2 n_keys=2 reproduced=yes"]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=VACUOUS withheld_published=4 omission_unexplained=0 key_set=reproduced"
    ]


def test_withheld_names_come_from_the_closed_set(capsys: pytest.CaptureFixture[str]) -> None:
    for name in ("withheld_attribution_mismatch.json", "withheld_no_base_level.json",
                 "withheld_key_basis.json", "key_set_mismatch.json", "vacuous.json"):
        _, lines = _run(name, capsys)
        for line in _lines(lines, "oracle-withheld:"):
            assert line.rsplit("reason=", 1)[1] in oracle.WITHHELD_REASONS
        for line in _lines(lines, "oracle-omitted:"):
            assert line.rsplit("reason=", 1)[1] in oracle.OMITTED_REASONS


# ── the reading beyond the classes (hand-derived) ──────────────────────────────────────────────


def _variant(tmp_path: Path, mutate: Callable[[dict[str, Any]], None]) -> str:
    doc = json.loads((_FIXTURES / "explained_two_keys.json").read_text(encoding="utf-8"))
    mutate(doc)
    path = tmp_path / "variant.json"
    path.write_text(json.dumps(doc), encoding="utf-8")
    return str(path)


def test_cumulative_line_telescopes_to_the_hand_value(capsys: pytest.CaptureFixture[str]) -> None:
    # 1 + r(d) = (sum of previous levels + P) / sum of previous levels, so the product over d2..d5
    # telescopes: (1515/1500)(1490/1515)(1520/1490)(1685/1620) = 1520 * 1685 / (1500 * 1620)
    # = 2561200 / 2430000 = 1.0540, which reads x1.05 to three significant figures.
    code, lines = _run("explained_two_keys.json", capsys)
    assert code == 0
    assert _lines(lines, "oracle-cumulative:") == [
        "oracle-cumulative: published=x1.05 explained=x1.05 explained_unannotated=x1.05 "
        "published_without_big_days=x1.05"
    ]
    assert _lines(lines, "oracle-big-day:") == []


def test_big_day_and_degrade_lines(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    # k2's P on d5 becomes 500 (stamp 500/500 = 1.0, terminal 500 + 500 = 1000). Book d5 =
    # (40 + 500)/(1120 + 500) = 540/1620 = 1/3, above the 0.30 reporting threshold; k2 holds
    # 500/540 = 0.926 of the day's absolute P&L. Cumulative: d2..d4 telescope to 1520/1500 and
    # d5 multiplies by 4/3: published = explained = 1.3511 -> x1.35; without the big day 1.0133 -> x1.01.
    def mutate(doc: dict[str, Any]) -> None:
        k2 = doc["keys"]["k2"]
        k2["composed_day_pnl"][-1]["pnl_usd"] = 500
        k2["returns_stamp"][-1]["return"] = 1.0
        k2["realized_terminal_usd"] = 1000
        doc["book"]["returns"][-1]["r"] = 540 / 1620
        doc["book"]["flags"] = {"skipped_nonpositive_denominator": 2, "emptied_stretch": True}
        doc["book"]["degrade_reasons"] = ["window_truncated"]
        doc["book"]["no_capital_exited_keys"] = ["k2"]

    code = oracle.main(["--input", _variant(tmp_path, mutate)])
    lines = [line for line in capsys.readouterr().out.splitlines() if line]
    assert code == 0
    assert _lines(lines, "oracle-big-day:") == [
        "oracle-big-day: date=2025-01-05 r=0.333 key=k2 share=0.926 annotations=none"
    ]
    assert _lines(lines, "oracle-cumulative:") == [
        "oracle-cumulative: published=x1.35 explained=x1.35 explained_unannotated=x1.35 "
        "published_without_big_days=x1.01"
    ]
    assert _lines(lines, "oracle-degrade:") == [
        "oracle-degrade: kind=degrade_reason name=window_truncated",
        "oracle-degrade: kind=flag name=skipped_nonpositive_denominator count=2",
        "oracle-degrade: kind=flag name=emptied_stretch state=true",
        "oracle-degrade: kind=exit_list name=no_capital_exited_keys count=1",
    ]


# ── the strict loader and the redaction ────────────────────────────────────────────────────────


def test_loader_refuses_by_field_path_never_by_value(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    def unknown_key(doc: dict[str, Any]) -> None:
        doc["book"]["secret_identifier_value"] = 1

    def bad_day(doc: dict[str, Any]) -> None:
        doc["keys"]["k1"]["composed_day_pnl"][0]["utc_day_iso"] = "2025-13-45"

    def non_finite(doc: dict[str, Any]) -> None:
        doc["keys"]["k1"]["composed_flows"][0]["flow_usd"] = float("nan")

    def duplicate_day(doc: dict[str, Any]) -> None:
        rows = doc["book"]["returns"]
        rows.append(dict(rows[0]))

    for mutate, needle in (
        (unknown_key, "book: unknown field"),
        (bad_day, "keys.k1.composed_day_pnl[0].utc_day_iso: expected an ISO day"),
        (non_finite, "keys.k1.composed_flows[0].flow_usd: non-finite number"),
        (duplicate_day, "book.returns[4].date: duplicate day"),
    ):
        code = oracle.main(["--input", _variant(tmp_path, mutate)])
        captured = capsys.readouterr()
        assert code == 2
        assert captured.out == ""
        assert needle in captured.err
        assert "secret_identifier_value" not in captured.err
        assert "2025-13-45" not in captured.err


def test_year_slices_flatten_and_a_comment_is_ignored(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    def slice_it(doc: dict[str, Any]) -> None:
        rows = doc["book"]["returns"]
        doc["book"]["returns"] = [rows[:2], rows[2:]]
        doc["_comment"] = "a string"

    code = oracle.main(["--input", _variant(tmp_path, slice_it)])
    lines = [line for line in capsys.readouterr().out.splitlines() if line]
    assert code == 0
    assert _lines(lines, "oracle-verdict:")[0].startswith("oracle-verdict: verdict=CLEAN")


def test_a_non_string_comment_is_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code = oracle.main(["--input", _variant(tmp_path, lambda doc: doc.update(_comment=5))])
    assert code == 2
    assert "export._comment: expected a string" in capsys.readouterr().err
