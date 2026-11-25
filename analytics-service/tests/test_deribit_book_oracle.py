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
  Plan 233-07 Task 1 (an emptied level is zero capital, as the compose counts it):
  19. ``test_emptied_level_is_zero_capital``: an emptied (dust) level is 0.0 in the levels the
      book sums, and a participant whose previous level is 0.0 adds 0.0 to the numerator AND the
      denominator, never its stored P&L. REVERT-PROOF: keeping the raw level on an emptied day, or
      letting that participant's P into the numerator, moves d4 off the hand value 10/1020.
  20. ``test_emptied_sole_key_and_carried_zero``: a day whose only participant carries zero capital
      is omitted ``skipped_nonpositive_denominator``, a carried emptied last level stays 0.0, and a
      day where a participant sat out and the denominator is exactly 0.0 is omitted
      ``missing_return_inside_coverage``. REVERT-PROOF: deleting the sat-out zero-denominator
      branch reads d7 as ``skipped_nonpositive_denominator``.
  21. ``test_emptied_last_day_anchor_decides``: an emptied last day stays 0.0 when the effective
      anchor is inside the band of the prior peak and takes the anchor otherwise.
      REVERT-PROOF: always taking the anchor on an emptied last day reads 1.5 as 1.5, not 0.0.
  Plan 233-07 Task 2 (a counted key with no stored basis, and PROD's payload shapes):
  22. ``test_counted_key_without_basis_is_withheld``: a counted key whose key_inputs row carries
      none of the four writer-basis arrays takes its level days from ``stored_return_days`` and
      withholds every published day it participates on as ``no_stored_base_level``.
      REVERT-PROOF: a roll that ignores ``stored_return_days`` leaves the key absent and d5 reads a
      plain mismatch or is reproduced without it.
  23. ``test_counted_key_with_no_day_is_refused``: a counted key with no day anywhere is refused
      by its ``declared.counted`` path, never silently absent. REVERT-PROOF: removing the refusal
      reads the export and the day as a plain ``attribution_mismatch``.
  24. ``test_production_shapes_load``: an export in PROD's own shapes (flags array, exit-list
      objects, full inputs, null slices) reads CLEAN. REVERT-PROOF: refusing the flags array
      exits 2 on the first PROD export.
  25. ``test_null_field_and_null_slice_read_as_absent``: null fields and null year slices are
      ABSENT, distinct from a present empty array. REVERT-PROOF: raising on a null slice exits 2.
  26. ``test_exit_lists_and_departures_must_agree``: an exit list and the declared departures must
      agree, by field path. REVERT-PROOF: removing the no-capital departure check lets a book whose
      exited key was never declared departed read as if it had been.
  27. ``test_exit_reason_copies_match_production``: the oracle's literal copies of the closed exit
      reasons equal production's (the only place production is imported besides the emptied
      constants).
"""
from __future__ import annotations

import ast
import dataclasses
import json
import re
import uuid
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
        "oracle-book: book=A published=4 explained=4 withheld=0 omitted=1 annotated=1"
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
        "oracle-book: book=A published=4 explained=3 withheld=1 omitted=1 annotated=1"
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
        "oracle-book: book=A published=4 explained=3 withheld=1 omitted=1 annotated=1"
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


def _variant(
    tmp_path: Path, mutate: Callable[[dict[str, Any]], None], name: str = "explained_two_keys.json"
) -> str:
    doc = json.loads((_FIXTURES / name).read_text(encoding="utf-8"))
    mutate(doc)
    path = tmp_path / "variant.json"
    path.write_text(json.dumps(doc), encoding="utf-8")
    return str(path)


def test_cumulative_line_telescopes_to_the_hand_value(capsys: pytest.CaptureFixture[str]) -> None:
    # 1 + r(d) = (sum of previous levels + P) / sum of previous levels, so the product over d2..d5
    # telescopes: (1515/1500)(1490/1515)(1520/1490)(1685/1620) = 1520 * 1685 / (1500 * 1620)
    # = 2561200 / 2430000 = 1.0540, which reads x1.05 to three significant figures. The flow day
    # d4 (k1 carries a 100 flow) is annotated, so the product over the unannotated days d2, d3 and
    # d5 is (1515/1500)(1490/1515)(1685/1620) = 1490 * 1685 / (1500 * 1620) = 2510650 / 2430000
    # = 1.0332, which reads x1.03.
    code, lines = _run("explained_two_keys.json", capsys)
    assert code == 0
    assert _lines(lines, "oracle-cumulative:") == [
        "oracle-cumulative: published=x1.05 explained=x1.05 explained_unannotated=x1.03 "
        "published_without_big_days=x1.05"
    ]
    assert _lines(lines, "oracle-big-day:") == []


def test_big_day_and_degrade_lines(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    # k2's P on d5 becomes 500 (stamp 500/500 = 1.0, terminal 500 + 500 = 1000). Book d5 =
    # (40 + 500)/(1120 + 500) = 540/1620 = 1/3, above the 0.30 reporting threshold; k2 holds
    # 500/540 = 0.926 of the day's absolute P&L. Cumulative: d2..d4 telescope to 1520/1500 and
    # d5 multiplies by 4/3: published = explained = 1.3511 -> x1.35; without the big day 1.0133 -> x1.01.
    # The unannotated explained days are d2, d3, d5 (d4 is the flow day): (1515/1500)(1490/1515)(4/3)
    # = (1490/1500)(4/3) = 1.3244 -> x1.32.
    def mutate(doc: dict[str, Any]) -> None:
        k2 = doc["keys"]["k2"]
        k2["composed_day_pnl"][-1]["pnl_usd"] = 500
        k2["returns_stamp"][-1]["return"] = 1.0
        k2["realized_terminal_usd"] = 1000
        doc["book"]["returns"][-1]["r"] = 540 / 1620
        doc["book"]["flags"] = {"skipped_nonpositive_denominator": 2, "emptied_stretch": True}
        doc["book"]["degrade_reasons"] = ["window_truncated"]
        doc["book"]["no_capital_exited_keys"] = [{"api_key_id": "k2", "reason": "dust", "day": "2025-01-05"}]
        doc["declared"]["departed"] = {"k2": "2025-01-05"}

    code = oracle.main(["--input", _variant(tmp_path, mutate)])
    lines = [line for line in capsys.readouterr().out.splitlines() if line]
    assert code == 0
    assert _lines(lines, "oracle-big-day:") == [
        "oracle-big-day: date=2025-01-05 r=0.333 key=k2 share=0.926 annotations=none"
    ]
    assert _lines(lines, "oracle-cumulative:") == [
        "oracle-cumulative: published=x1.35 explained=x1.35 explained_unannotated=x1.32 "
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


# ── plan 233-05 Task 1: the remaining classes, annotations, carry and rotation ──────────────────
#
# Why each test matters (Rule 9):
#   9.  ``test_withheld_emptied_stretch``: a published day the oracle cannot reproduce because a
#       key sat in its emptied band is named for what it is, not as a plain mismatch.
#   10. ``test_omitted_days_each_carry_their_own_name``: each omitted reason fires on its own day
#       and the book still reads CLEAN, so an honest omission is never a STOP.
#   11. ``test_omission_unexplained_is_stop``: a day the oracle computes inside the published
#       window and the book lacks is the one omission that stops the reading.
#       REVERT-PROOF: classifying it ``outside_published_window`` turns the reading CLEAN.
#   12. ``test_capital_outside_base_is_named_and_never_nulled`` and
#       ``test_annotation_never_nulls_a_day``: an annotation names capital the base may not hold
#       and changes no class and no value (CONTEXT Q4, option (a)).
#       REVERT-PROOF: dropping the annotated days from the explained set.
#   13. ``test_carry_and_rotation``: an overlapped key that ended early carries its level with no
#       P&L, a disjoint handoff rotates the earlier key out.
#   14. ``test_emptied_constants_match_production``: the oracle's literal copies equal production's
#       (the only place production is imported).
#   15. ``test_closed_sets_are_exact`` and ``test_every_day_has_exactly_one_class``.


def test_withheld_emptied_stretch(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("withheld_emptied_stretch.json", capsys)
    assert code == 1
    assert _lines(lines, "oracle-book:") == [
        "oracle-book: book=A published=7 explained=5 withheld=2 omitted=1 annotated=0"
    ]
    assert _lines(lines, "oracle-withheld:") == [
        "oracle-withheld: date=2025-01-07 reason=emptied_stretch",
        "oracle-withheld: date=2025-01-08 reason=emptied_stretch",
    ]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=STOP withheld_published=2 omission_unexplained=0 key_set=reproduced"
    ]


def test_omitted_days_each_carry_their_own_name(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("omitted_days.json", capsys)
    assert code == 0
    assert _lines(lines, "oracle-omitted:") == [
        "oracle-omitted: date=2025-01-01 reason=no_stored_base_level",
        "oracle-omitted: date=2025-01-04 reason=skipped_nonpositive_denominator",
        "oracle-omitted: date=2025-01-05 reason=skipped_nonpositive_denominator",
        "oracle-omitted: date=2025-01-06 reason=missing_return_inside_coverage",
        "oracle-omitted: date=2025-01-09 reason=outside_published_window",
    ]
    assert _lines(lines, "oracle-book:") == [
        "oracle-book: book=A published=4 explained=4 withheld=0 omitted=5 annotated=1"
    ]
    assert _lines(lines, "oracle-annotation:") == [
        "oracle-annotation: name=key_sat_out days=1 explained_days=0 explained_cumulative=x1"
    ]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=CLEAN withheld_published=0 omission_unexplained=0 key_set=reproduced"
    ]


def test_omission_unexplained_is_stop(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("omission_unexplained.json", capsys)
    assert code == 1
    assert _lines(lines, "oracle-omitted:") == [
        "oracle-omitted: date=2025-01-01 reason=no_stored_base_level",
        "oracle-omitted: date=2025-01-04 reason=omission_unexplained",
    ]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=STOP withheld_published=0 omission_unexplained=1 key_set=reproduced"
    ]


def test_capital_outside_base_is_named_and_never_nulled(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("capital_outside_base.json", capsys)
    assert code == 0
    assert _lines(lines, "oracle-annotation:") == [
        "oracle-annotation: name=capital_outside_base_options_cash days=4 explained_days=4 explained_cumulative=x1.05",
        "oracle-annotation: name=capital_outside_base_flow_day days=1 explained_days=1 explained_cumulative=x1.02",
    ]
    # Hand: every day is annotated, so the unannotated explained cumulative is the empty product.
    assert _lines(lines, "oracle-cumulative:") == [
        "oracle-cumulative: published=x1.05 explained=x1.05 explained_unannotated=x1 published_without_big_days=x1.05"
    ]


def _analysis(name: str) -> oracle.Analysis:
    return oracle.analyse(oracle.load_export(str(_FIXTURES / name)))


def test_annotation_never_nulls_a_day() -> None:
    analysis = _analysis("capital_outside_base.json")
    annotated = set(analysis.classification.annotations)
    assert annotated == {"2025-01-02", "2025-01-03", "2025-01-04", "2025-01-05"}
    explained = {d.day for d in analysis.classification.days if d.kind == "explained"}
    assert annotated <= explained
    published = analysis.export.book.returns
    assert set(published) == explained
    pub_cum = 1.0
    exp_cum = 1.0
    for d in analysis.classification.days:
        if d.kind == "explained" and d.oracle is not None:
            pub_cum *= 1.0 + published[d.day]
            exp_cum *= 1.0 + d.oracle
    assert pub_cum == pytest.approx(exp_cum, rel=1e-9)


def test_carry_and_rotation(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("carry_and_rotation.json", capsys)
    assert code == 0
    assert _lines(lines, "oracle-book:") == [
        "oracle-book: book=A published=8 explained=8 withheld=0 omitted=1 annotated=0"
    ]
    assert _lines(lines, "oracle-withheld:") == []
    # The rotation is detected from coverage alone (nothing is declared in the export).
    analysis = _analysis("carry_and_rotation.json")
    levels = {label: oracle.roll_key_levels(analysis.export.keys[label]) for label in ("k1", "k2", "k3")}
    assert oracle._coverage_rotations(levels) == frozenset({"k1"})
    assert analysis.export.declared.departed == {}


def test_emptied_constants_match_production() -> None:
    # The ONLY place production is imported: the oracle keeps literal copies so it imports nothing
    # it judges, and this pin catches a copy that drifts from the founder's numbers.
    from services import allocator_equity_derive as derive

    assert oracle._EMPTIED_FRACTION == derive.EMPTIED_FRACTION
    assert oracle._EMPTIED_NEGATIVE_FRACTION == derive.EMPTIED_NEGATIVE_FRACTION
    assert oracle._EMPTIED_RESTART_FLOOR_USD == derive.EMPTIED_RESTART_FLOOR_USD


def test_closed_sets_are_exact() -> None:
    assert oracle.WITHHELD_REASONS == (
        "key_set_not_reproducible",
        "no_stored_base_level",
        "key_basis_not_reproducible",
        "emptied_stretch",
        "attribution_mismatch",
    )
    assert oracle.OMITTED_REASONS == (
        "no_stored_base_level",
        "skipped_nonpositive_denominator",
        "missing_return_inside_coverage",
        "nonfinite_return",
        "outside_published_window",
        "omission_unexplained",
    )
    assert oracle.ANNOTATIONS == (
        "capital_outside_base_options_cash",
        "capital_outside_base_flow_day",
        "key_sat_out",
    )
    assert len(set(oracle.WITHHELD_REASONS)) == 5
    assert len(set(oracle.OMITTED_REASONS)) == 6


def test_every_day_has_exactly_one_class() -> None:
    fixtures = sorted(p.name for p in _FIXTURES.glob("*.json"))
    assert len(fixtures) >= 11
    for name in fixtures:
        analysis = _analysis(name)
        classes = analysis.classification.days
        days = [d.day for d in classes]
        span = set(analysis.repro.union) | set(analysis.export.book.returns)
        assert len(days) == len(set(days)), f"{name}: a day carries two classes"
        assert set(days) == span, f"{name}: a day of the span has no class"
        for d in classes:
            assert d.kind in ("explained", "withheld", "omitted")
            if d.kind == "withheld":
                assert d.reason in oracle.WITHHELD_REASONS, name
                assert d.day in analysis.export.book.returns
            elif d.kind == "omitted":
                assert d.reason in oracle.OMITTED_REASONS, name
                assert d.day not in analysis.export.book.returns
            else:
                assert d.reason is None
                assert d.day in analysis.export.book.returns


# ── plan 233-05 Task 2: the reading cannot leak, and the orchestrator has its read-only SQL ─────
#
# Why each test matters (Rule 9):
#   16. ``test_emitter_refuses_values_outside_vocabulary``: the reading is pasted into a tracked
#       file on a public repository, so an id, an unrounded amount or free venue text must raise
#       instead of printing. REVERT-PROOF: a ``_render_val`` that accepts any value passes them.
#   17. ``test_print_sql_is_read_only_and_id_free`` and ``test_print_sql_takes_no_other_argument``:
#       the statements the orchestrator runs against PROD are SELECT or WITH only, carry
#       placeholders and no id, and the mode touches no export.
#   18. ``test_export_with_id_shaped_value_is_refused``: an export that was not labelled by hand
#       (an id anywhere, the ``_comment`` included) is refused by field path, never echoed.
#       REVERT-PROOF: removing the loader's id refusal lets the export through.


def test_emitter_refuses_values_outside_vocabulary() -> None:
    an_id = str(uuid.uuid4())
    for bad in (
        oracle.Val("label", an_id),
        oracle.Val("token", an_id),
        oracle.Val("token", "free text from a venue"),
        oracle.Val("token", "0.12345678901234"),
        oracle.Val("count", 1234.5678),
        oracle.Val("name", "not_in_any_closed_set"),
        oracle.Val("date", an_id),
    ):
        with pytest.raises((ValueError, oracle.ExportError)):
            oracle._render_rows([("oracle-book:", (("book", bad),))])
    # The vocabulary itself still renders (the refusal is not a blanket refusal).
    assert oracle._render_rows([("oracle-book:", (("book", oracle.Val("label", "A")),))]) == [
        "oracle-book: book=A"
    ]


_WRITE_WORDS = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|set|vacuum)\b",
    re.IGNORECASE,
)


def test_print_sql_is_read_only_and_id_free(capsys: pytest.CaptureFixture[str]) -> None:
    assert oracle.SQL_LABELS == (
        "book_curve",
        "book_key_kinds",
        "key_scalars",
        "key_array_by_year",
        "book_key_rows",
        "key_return_days",
    )
    assert oracle.main(["--print-sql"]) == 0
    text = capsys.readouterr().out
    assert text == oracle.print_sql()
    headers = re.findall(r"^-- oracle \((\w+)\):", text, re.MULTILINE)
    assert tuple(headers) == oracle.SQL_LABELS
    blocks = [b for b in text.split("\n\n") if b.strip()]
    assert len(blocks) == len(oracle.SQL_LABELS)
    placeholders = {"book_id", "key_kind", "key_id", "kind", "field", "from_day", "to_day"}
    for block in blocks:
        body = "\n".join(line for line in block.splitlines() if not line.startswith("--")).strip()
        assert re.match(r"(?i)^(select|with)\b", body), body
        assert body.endswith(";") and body.count(";") == 1, body
        assert not _WRITE_WORDS.search(body), body
        assert set(re.findall(r":'(\w+)'", body)) <= placeholders
    assert not oracle._UUID_RE.search(text)
    assert not oracle._LONG_DIGITS_RE.search(text)
    # The account identifier is only ever used to rank, never selected.
    assert text.count("venue_account_id") == 1
    assert "dense_rank() OVER (ORDER BY exchange, venue_account_id) AS account_group" in text


def test_print_sql_takes_no_other_argument(capsys: pytest.CaptureFixture[str]) -> None:
    assert oracle.main(["--print-sql", "--input", str(_FIXTURES / "explained_two_keys.json")]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "no other argument" in captured.err
    assert oracle.main(["--print-sql=no_such_label"]) == 2
    assert capsys.readouterr().out == ""
    assert oracle.main(["--print-sql=book_key_rows"]) == 0
    assert capsys.readouterr().out.count("-- oracle (") == 1


def test_export_with_id_shaped_value_is_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    an_id = str(uuid.uuid4())

    def in_comment(doc: dict[str, Any]) -> None:
        doc["_comment"] = f"copied from {an_id}"

    def in_flags(doc: dict[str, Any]) -> None:
        doc["book"]["flags"] = {"note": an_id}

    def as_key(doc: dict[str, Any]) -> None:
        doc["declared"]["stitch_parent"] = {an_id: "k1"}

    for mutate, expect in (
        (in_comment, "export._comment: id-shaped value refused"),
        (in_flags, "export.book.flags.note: id-shaped value refused"),
        (as_key, "export.declared.stitch_parent.<key>: id-shaped key refused"),
    ):
        code = oracle.main(["--input", _variant(tmp_path, mutate)])
        captured = capsys.readouterr()
        assert code == 2
        assert expect in captured.err
        assert an_id not in captured.err and an_id not in captured.out


# ── plan 233-07 Task 1: an emptied level is zero capital in both sums ──────────────────────────


def test_emptied_level_is_zero_capital(capsys: pytest.CaptureFixture[str]) -> None:
    # Hand derivation in the fixture's _comment: k2 is emptied on d3, d4 and d5, so the book sums
    # it at 0.0 there and the dust P of 0.25 on d4 never enters the numerator.
    code, lines = _run("emptied_zero_capital.json", capsys)
    assert code == 0
    assert _lines(lines, "oracle-book:") == [
        "oracle-book: book=A published=7 explained=7 withheld=0 omitted=1 annotated=2"
    ]
    assert _lines(lines, "oracle-withheld:") == []
    assert _lines(lines, "oracle-omitted:") == [
        "oracle-omitted: date=2025-01-01 reason=no_stored_base_level"
    ]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=CLEAN withheld_published=0 omission_unexplained=0 key_set=reproduced"
    ]
    k2 = oracle.roll_key_levels(oracle.load_export(str(_FIXTURES / "emptied_zero_capital.json")).keys["k2"])
    assert k2.emptied == frozenset({"2025-01-03", "2025-01-04", "2025-01-05"})
    assert k2.level is not None
    assert [k2.level[f"2025-01-0{n}"] for n in range(1, 9)] == [
        200.0, 200.0, 0.0, 0.0, 0.0, 300.75, 303.75, 306.75
    ]


def test_emptied_sole_key_and_carried_zero(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("emptied_sole_and_carried.json", capsys)
    assert code == 0
    assert _lines(lines, "oracle-book:") == [
        "oracle-book: book=A published=5 explained=5 withheld=0 omitted=3 annotated=2"
    ]
    assert _lines(lines, "oracle-withheld:") == []
    assert _lines(lines, "oracle-omitted:") == [
        "oracle-omitted: date=2025-01-01 reason=no_stored_base_level",
        "oracle-omitted: date=2025-01-04 reason=skipped_nonpositive_denominator",
        "oracle-omitted: date=2025-01-07 reason=missing_return_inside_coverage",
    ]
    assert _analysis("emptied_sole_and_carried.json").classification.annotations == {
        "2025-01-03": ("capital_outside_base_flow_day",),
        "2025-01-07": ("key_sat_out",),
    }
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=CLEAN withheld_published=0 omission_unexplained=0 key_set=reproduced"
    ]


def test_emptied_last_day_anchor_decides() -> None:
    base = oracle.load_export(str(_FIXTURES / "emptied_sole_and_carried.json")).keys["k2"]
    emptied = frozenset({"2025-01-03", "2025-01-04", "2025-01-05"})
    # null: the job's no-capital exit anchors at the realized terminal (0.75, in band); 1.5 is
    # inside the band of the prior peak 200 (ceiling 2); 50 is at or above the ceiling.
    for anchor, last in ((None, 0.0), (1.5, 0.0), (50.0, 50.0)):
        lv = oracle.roll_key_levels(dataclasses.replace(base, anchor_usd=anchor))
        assert lv.emptied == emptied, anchor
        assert lv.level is not None
        assert lv.level["2025-01-05"] == last, anchor
        assert lv.level["2025-01-03"] == 0.0 and lv.level["2025-01-04"] == 0.0, anchor
        assert lv.level["2025-01-01"] == 200.0 and lv.level["2025-01-02"] == 200.0, anchor
        assert lv.stamp_bad_days == frozenset(), anchor  # the identity ran on the raw levels


# ── plan 233-07 Task 2: a counted key with no stored basis, and PROD's payload shapes ──────────


def test_counted_key_without_basis_is_withheld(capsys: pytest.CaptureFixture[str]) -> None:
    # Hand derivation in the fixture's _comment: k2 joins on d4 and participates on d5 only, with
    # no writer basis, so d5 is withheld no_stored_base_level and d2..d4 (k1 alone) are explained.
    code, lines = _run("counted_key_without_basis.json", capsys)
    assert code == 1
    assert _lines(lines, "oracle-book:") == [
        "oracle-book: book=A published=4 explained=3 withheld=1 omitted=1 annotated=1"
    ]
    assert _lines(lines, "oracle-withheld:") == [
        "oracle-withheld: date=2025-01-05 reason=no_stored_base_level"
    ]
    assert _lines(lines, "oracle-omitted:") == [
        "oracle-omitted: date=2025-01-01 reason=no_stored_base_level"
    ]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=STOP withheld_published=1 omission_unexplained=0 key_set=reproduced"
    ]


def test_counted_key_with_no_day_is_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    arrays = ("composed_day_pnl", "composed_flows", "dropped_day_pnl", "returns_stamp")

    def null_arrays(doc: dict[str, Any]) -> None:
        del doc["keys"]["k2"]["stored_return_days"]

    def absent_arrays(doc: dict[str, Any]) -> None:
        del doc["keys"]["k2"]["stored_return_days"]
        for name in arrays:
            del doc["keys"]["k2"][name]

    for mutate in (null_arrays, absent_arrays):
        code = oracle.main(["--input", _variant(tmp_path, mutate, "counted_key_without_basis.json")])
        captured = capsys.readouterr()
        assert code == 2
        assert captured.out == ""
        assert "declared.counted[1]: counted key has no level day" in captured.err
        assert "525" not in captured.err

    def with_arrays(doc: dict[str, Any]) -> None:
        doc["keys"]["k2"]["stored_return_days"] = ["2025-01-02"]

    code = oracle.main(["--input", _variant(tmp_path, with_arrays)])
    captured = capsys.readouterr()
    assert code == 2
    assert "keys.k2.stored_return_days" in captured.err


def test_production_shapes_load(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = _run("production_shapes.json", capsys)
    assert code == 0
    assert _lines(lines, "oracle-book:") == [
        "oracle-book: book=A published=4 explained=4 withheld=0 omitted=1 annotated=1"
    ]
    assert _lines(lines, "oracle-omitted:") == [
        "oracle-omitted: date=2025-01-01 reason=no_stored_base_level"
    ]
    assert _lines(lines, "oracle-cumulative:") == [
        "oracle-cumulative: published=x1.05 explained=x1.05 explained_unannotated=x1.03 "
        "published_without_big_days=x1.05"
    ]
    assert _lines(lines, "oracle-degrade:") == [
        "oracle-degrade: kind=degrade_reason name=window_truncated",
        "oracle-degrade: kind=flag name=departed_history_included state=true",
        "oracle-degrade: kind=flag name=no_capital_key_exited state=true",
        "oracle-degrade: kind=flag name=writer_basis state=true",
        "oracle-degrade: kind=exit_list name=unpriced_native_keys count=1",
        "oracle-degrade: kind=exit_list name=no_capital_exited_keys count=1",
        "oracle-degrade: kind=exit_list name=failing_key_exits count=1",
    ]
    assert _lines(lines, "oracle-verdict:") == [
        "oracle-verdict: verdict=CLEAN withheld_published=0 omission_unexplained=0 key_set=reproduced"
    ]


def test_null_field_and_null_slice_read_as_absent(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    def nulls(doc: dict[str, Any]) -> None:
        doc["keys"]["k1"]["dropped_day_pnl"] = None
        doc["keys"]["k2"]["tiny_base_days"] = [None]
        rows = doc["book"]["returns"]
        doc["book"]["returns"] = [None, rows[:2], None, rows[2:]]

    code = oracle.main(["--input", _variant(tmp_path, nulls)])
    lines = [line for line in capsys.readouterr().out.splitlines() if line]
    assert code == 0
    assert _lines(lines, "oracle-verdict:")[0].startswith("oracle-verdict: verdict=CLEAN")
    # Absent is not empty: a null stamp (or a list of null slices) is "unavailable", an empty one
    # is present and has no day.
    assert oracle._load_key("k1", {"returns_stamp": [None]}).stamp is None
    assert oracle._load_key("k1", {"returns_stamp": None}).stamp is None
    assert oracle._load_key("k1", {"returns_stamp": [[]]}).stamp == {}
    assert oracle._load_key("k1", {"returns_stamp": []}).stamp == {}


def test_exit_lists_and_departures_must_agree(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    def no_departure(doc: dict[str, Any]) -> None:
        del doc["declared"]["departed"]

    def failing_day_disagrees(doc: dict[str, Any]) -> None:
        doc["book"]["failing_key_exits"] = [{"api_key_id": "k1", "reason": "read_incomplete", "day": "2025-01-03"}]
        doc["declared"]["departed"]["k1"] = "2025-01-04"

    def failing_null_day_names_counted(doc: dict[str, Any]) -> None:
        doc["book"]["failing_key_exits"] = [{"api_key_id": "k1", "reason": "read_incomplete", "day": None}]

    def reason_outside_set(doc: dict[str, Any]) -> None:
        doc["book"]["failing_key_exits"][0]["reason"] = "dust"

    def bare_label(doc: dict[str, Any]) -> None:
        doc["book"]["failing_key_exits"] = ["k3"]

    for mutate, needle in (
        (no_departure, "book.no_capital_exited_keys[0]: "),
        (failing_day_disagrees, "book.failing_key_exits[0]: "),
        (failing_null_day_names_counted, "book.failing_key_exits[0]: "),
        (reason_outside_set, "book.failing_key_exits[0].reason: "),
        (bare_label, "book.failing_key_exits[0]: expected an object"),
    ):
        code = oracle.main(["--input", _variant(tmp_path, mutate, "production_shapes.json")])
        captured = capsys.readouterr()
        assert code == 2, needle
        assert captured.out == ""
        assert needle in captured.err, captured.err
        assert "read_incomplete" not in captured.err and "2025-01-0" not in captured.err


def test_exit_reason_copies_match_production() -> None:
    from services import allocator_equity_compose as compose
    from services import equity_reconstruction as reconstruction

    assert oracle._FAILING_KEY_EXIT_REASONS == compose.FAILING_KEY_EXIT_REASONS
    assert oracle._NO_CAPITAL_EXIT_REASONS == reconstruction._NO_CAPITAL_ANCHOR_REASONS
