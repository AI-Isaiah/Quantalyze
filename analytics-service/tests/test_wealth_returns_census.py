"""Phase 164.6.6.2.2 plan 07: the write side and the read side agree, and no read
can bypass the boundary.

CR-01 survived because nothing compared a stored curve with what the readers did
with it. Two guards, both able to fail:

1. END TO END (D-05 + D-01): the flags and ``returns_series`` the REAL runner
   upserts, handed to ``daily_returns_from_row``, give back the daily returns the
   run was given for days 1..n (day 0 has no stored predecessor). Simple curve by
   difference, geometric curve by ratio. The runner runs unmocked past its
   Supabase client and the benchmark fetch: real ``derive_basis_series``, real
   ``compute_all_metrics``; a spy on ``compute_all_metrics`` captures the exact
   Series the run computed on, so the comparison is against what the run used,
   not against a copy of the fixture.
2. CENSUS (D-06): an AST scan of ``routers/`` and ``services/`` (everything but
   ``services/wealth_returns.py``) that fails when a second parser of the stored
   curve appears, or when a ``returns_series`` reference outside the boundary is
   not in the allowlist. Each reference is CLASSIFIED (a ``.select(...)`` string
   argument, a ``logger.<level>(...)`` string argument, or a site in an enumerated
   (file, enclosing function)), so swapping a log string for an inline curve
   parse fails on the new load, not only on a count (WR-04). Every select must
   also name ``daily_returns`` and ``data_quality_flags`` (WR-03). A docstring or
   a comment cannot satisfy or trip it: only code (identifiers and string
   constants) is counted.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.wealth_returns import daily_returns_from_row
from tests._scan_helpers import _is_pure_comment, _py_scan_files, _repo_root
from tests.test_csv_analytics_runner import (
    _ALLOC_CFG_SIMPLE_ACTIVE,
    _make_broker_supabase_mock,
)

# ---------------------------------------------------------------------------
# 1. End to end: runner write -> stored row -> boundary read
# ---------------------------------------------------------------------------

# Varied on purpose: a constant or alternating series could be matched by a
# wrong method (level, sign-flipped difference) by accident.
_RUN_RETURNS = [
    0.010, -0.020, 0.030, 0.004, -0.015, 0.025, -0.007, 0.012,
    -0.031, 0.018, 0.002, -0.009, 0.027, -0.013, 0.006,
]


def _daily_rows() -> list[dict[str, Any]]:
    return [
        {"date": f"2025-08-{i + 1:02d}", "daily_return": r}
        for i, r in enumerate(_RUN_RETURNS)
    ]


async def _run_and_capture(
    returns_denominator_config: object | None,
) -> tuple[dict[str, Any], pd.Series]:
    """Run the real runner; return the completed upsert payload and the returns
    Series ``compute_all_metrics`` was given."""
    from services import basis_series
    from services.analytics_runner import run_csv_strategy_analytics

    sb = _make_broker_supabase_mock(
        _daily_rows(),
        api_key_id="key-1",
        asset_class="crypto",
        returns_denominator_config=returns_denominator_config,
    )
    real_compute = basis_series.compute_all_metrics
    spy = MagicMock(side_effect=real_compute)
    with patch("services.analytics_runner.get_supabase", return_value=sb), \
         patch("services.analytics_runner.get_benchmark_returns",
               new=AsyncMock(return_value=(None, True))), \
         patch("services.basis_series.compute_all_metrics", new=spy):
        await run_csv_strategy_analytics("census-e2e-uuid")

    sa = sb.table("strategy_analytics")
    completed = [
        c.args[0] for c in sa.upsert.call_args_list
        if isinstance(c.args[0], dict)
        and str(c.args[0].get("computation_status", "")).startswith("complete")
    ]
    assert completed, "the runner wrote no completed analytics row"
    assert spy.call_args is not None, "compute_all_metrics was never called"
    fed = spy.call_args.args[0]
    assert isinstance(fed, pd.Series)
    return completed[0], fed


def _assert_read_back_is_the_runs_input(payload: dict[str, Any], fed: pd.Series) -> None:
    row = {
        "returns_series": payload["returns_series"],
        "data_quality_flags": payload["data_quality_flags"],
    }
    got = daily_returns_from_row(row, name="s")
    assert got is not None, "the boundary read nothing from the runner's own row"
    expected = fed.dropna().iloc[1:]
    assert len(expected) == len(_RUN_RETURNS) - 1, (
        "precondition: the run computed on every input day"
    )
    assert list(got.index) == list(expected.index), (
        "the boundary must return days 1..n (day 0 has no stored predecessor)"
    )
    assert got.to_numpy() == pytest.approx(expected.to_numpy(), abs=1e-12), (
        "the boundary did not invert the runner's curve: a stored curve read with "
        "the wrong method silently scales every blend downstream (CR-01)"
    )


@pytest.mark.asyncio
async def test_simple_curve_written_by_the_runner_reads_back_by_difference() -> None:
    payload, fed = await _run_and_capture(_ALLOC_CFG_SIMPLE_ACTIVE)
    assert payload["data_quality_flags"]["cumulative_method"] == "simple", (
        "precondition: this config stores a simple (additive) curve"
    )
    _assert_read_back_is_the_runs_input(payload, fed)


@pytest.mark.asyncio
async def test_geometric_curve_written_by_the_runner_reads_back_by_ratio() -> None:
    payload, fed = await _run_and_capture(None)
    assert payload["data_quality_flags"]["cumulative_method"] == "geometric"
    _assert_read_back_is_the_runs_input(payload, fed)


@pytest.mark.asyncio
async def test_the_two_methods_are_distinguishable_on_this_input() -> None:
    """The end-to-end pair is only evidence if the wrong method would have been
    caught: reading the simple curve by ratio (or the geometric one by
    difference) must NOT reproduce the run's returns on this input."""
    payload, fed = await _run_and_capture(_ALLOC_CFG_SIMPLE_ACTIVE)
    wrong_flags = dict(payload["data_quality_flags"], cumulative_method="geometric")
    wrong = daily_returns_from_row(
        {"returns_series": payload["returns_series"], "data_quality_flags": wrong_flags},
        name="s",
    )
    expected = fed.dropna().iloc[1:]
    assert wrong is not None
    assert not (
        len(wrong) == len(expected)
        and wrong.to_numpy() == pytest.approx(expected.to_numpy(), abs=1e-9)
    ), "the end-to-end oracle cannot tell a simple curve from a geometric one"


# ---------------------------------------------------------------------------
# 2. Census: every stored-curve read goes through the boundary
# ---------------------------------------------------------------------------

_BOUNDARY = "services/wealth_returns.py"
_TOKEN = re.compile(r"(?<![A-Za-z0-9_])returns_series(?![A-Za-z0-9_])")

# The three kinds of reference a router/service may hold to the stored column
# (WR-04: a bare count let a log string be swapped for an inline curve parse):
#   select - a string argument of a ``.select(...)`` call: the column is named so
#            its rows reach ``daily_returns_from_row``; nothing is parsed here.
#   log    - a string argument of a ``logger.<level>(...)`` call: prose.
#   site   - anything else (a ``row["returns_series"]`` / ``.get("returns_series")``
#            load, a dict key, a local name). A value read or write: allowed only
#            at an enumerated (file, enclosing function) site below.
KIND_SELECT = "select"
KIND_LOG = "log"
KIND_SITE = "site"
_LOG_RECEIVERS = {"logger", "log", "logging"}
_LOG_METHODS = {"debug", "info", "warning", "warn", "error", "exception", "critical", "log"}


@dataclass(frozen=True)
class _Allowance:
    selects: int
    logs: int
    # enclosing function -> number of site references there
    sites: Mapping[str, int]
    reason: str


# file -> allowance. Counted on CODE only (an identifier, or a string constant
# naming the column), docstrings and comments excluded. A reference whose KIND is
# not allowed (a select or log string is fine; a load is not unless its enclosing
# function is listed under ``sites``) fails the census naming the line, whatever
# the per-file total is. The counts stay as a secondary tripwire.
ALLOWED_RETURNS_SERIES_REFS: dict[str, _Allowance] = {
    "routers/match.py": _Allowance(
        selects=2,
        logs=0,
        sites={},
        reason=(
            "two select column lists: the candidate-universe read (engine metrics "
            "beside the curve) and the allocator-book read. Both feed "
            "daily_returns_from_row; no returns_series value is parsed here."
        ),
    ),
    "routers/portfolio.py": _Allowance(
        selects=6,
        logs=4,
        sites={"verify_strategy": 2},
        reason=(
            "six select column lists (compute, optimizer x2, bridge x2, verify), "
            "each naming daily_returns and data_quality_flags beside the curve and "
            "read through daily_returns_from_row; four log lines naming the column "
            "in text; the verify trim (_trim_returns_series applied to the "
            "'returns_series' key twice on one line, before the boundary, so a "
            "capped row reads exactly like the full one). No value is parsed here."
        ),
    ),
    "routers/simulator.py": _Allowance(
        selects=1,
        logs=0,
        sites={},
        reason="the candidate select column list, read through daily_returns_from_row.",
    ),
    "services/metrics.py": _Allowance(
        selects=0,
        logs=0,
        sites={"compute_all_metrics": 6},
        reason=(
            "the WRITER: compute_all_metrics builds the stored curve (a local list "
            "of {date, value} points, its downsample, its cap, and the metrics-dict "
            "key). It produces the column, it does not read one."
        ),
    ),
    "services/strategy_matching.py": _Allowance(
        selects=1,
        logs=0,
        sites={},
        reason=(
            "the published-strategy select column list, read through "
            "daily_returns_from_row."
        ),
    ),
}


class _Ref(NamedTuple):
    line: int
    kind: str
    function: str
    # the column list for a select, "" otherwise
    columns: str


def _parents(tree: ast.AST) -> dict[ast.AST, ast.AST]:
    return {c: p for p in ast.walk(tree) for c in ast.iter_child_nodes(p)}


def _docstring_ids(tree: ast.AST) -> set[int]:
    docstrings: set[int] = set()
    for n in ast.walk(tree):
        if (
            isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
            and n.body
            and isinstance(n.body[0], ast.Expr)
            and isinstance(n.body[0].value, ast.Constant)
            and isinstance(n.body[0].value.value, str)
        ):
            docstrings.add(id(n.body[0].value))
    return docstrings


def _reference_nodes(tree: ast.AST) -> list[ast.AST]:
    """Every code reference to the ``returns_series`` column: an identifier, or a
    string constant naming it as a whole word. Docstrings are excluded (prose);
    comments never reach the AST."""
    docstrings = _docstring_ids(tree)
    nodes: list[ast.AST] = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            if id(n) not in docstrings and _TOKEN.search(n.value):
                nodes.append(n)
        elif isinstance(n, ast.Name) and n.id == "returns_series":
            nodes.append(n)
        elif isinstance(n, ast.Attribute) and n.attr == "returns_series":
            nodes.append(n)
        elif isinstance(n, ast.arg) and n.arg == "returns_series":
            nodes.append(n)
        elif isinstance(n, ast.keyword) and n.arg == "returns_series":
            nodes.append(n)
    return nodes


def _classify_source(source: str) -> list[_Ref]:
    tree = ast.parse(source)
    parents = _parents(tree)
    refs: list[_Ref] = []
    for n in _reference_nodes(tree):
        parent = parents.get(n)
        kind = KIND_SITE
        columns = ""
        if (
            isinstance(n, ast.Constant)
            and isinstance(parent, ast.Call)
            and n in parent.args
            and isinstance(parent.func, ast.Attribute)
        ):
            func = parent.func
            if func.attr == "select":
                kind, columns = KIND_SELECT, str(n.value)
            elif (
                func.attr in _LOG_METHODS
                and isinstance(func.value, ast.Name)
                and func.value.id in _LOG_RECEIVERS
            ):
                kind = KIND_LOG
        function = "<module>"
        cur: ast.AST | None = parent
        while cur is not None:
            if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
                function = cur.name
                break
            cur = parents.get(cur)
        refs.append(_Ref(getattr(n, "lineno", 0), kind, function, columns))
    return sorted(refs)


def _code_references(path: Path) -> list[int]:
    """Line numbers of every code reference to the ``returns_series`` column."""
    return [r.line for r in _classify_source(path.read_text())]


def _kind_problems(rel: str, refs: list[_Ref], allowance: _Allowance) -> list[str]:
    """Why ``refs`` (one file's classified references) do not fit ``allowance``.
    Kind first (names the offending line), count second (the tripwire)."""
    problems: list[str] = []
    allowed_sites = dict(allowance.sites)
    for r in refs:
        if r.kind == KIND_SITE and r.function not in allowed_sites:
            problems.append(
                f"{rel}:{r.line}: an unclassified returns_series reference (not a select "
                f"or log argument) in {r.function}() - a load or write of the stored "
                f"curve outside the boundary, or a reworded select/log; read it through "
                f"daily_returns_from_row or enumerate the site"
            )
    by_kind = {
        KIND_SELECT: [r for r in refs if r.kind == KIND_SELECT],
        KIND_LOG: [r for r in refs if r.kind == KIND_LOG],
    }
    for kind, want in ((KIND_SELECT, allowance.selects), (KIND_LOG, allowance.logs)):
        got = by_kind[kind]
        if len(got) != want:
            problems.append(
                f"{rel}: expected {want} {kind} reference(s), found {len(got)} at "
                f"lines {[r.line for r in got]}"
            )
    for fn, want in allowed_sites.items():
        got_sites = [r for r in refs if r.kind == KIND_SITE and r.function == fn]
        if len(got_sites) != want:
            problems.append(
                f"{rel}: expected {want} site reference(s) in {fn}(), found "
                f"{len(got_sites)} at lines {[r.line for r in got_sites]}"
            )
    return problems


def _surface_files() -> list[Path]:
    """routers/** and services/** from the shared scan list, minus the boundary."""
    root = _repo_root() / "analytics-service"
    keep: list[Path] = []
    for f in _py_scan_files():
        rel = f.relative_to(root).as_posix()
        if rel.startswith(("routers/", "services/")) and rel != _BOUNDARY:
            keep.append(f)
    return keep


def test_the_surface_scanned_is_not_empty() -> None:
    """A census over zero files is green by construction (D-04's failure mode)."""
    rels = {f.relative_to(_repo_root() / "analytics-service").as_posix() for f in _surface_files()}
    assert "routers/portfolio.py" in rels
    assert "services/metrics.py" in rels
    assert _BOUNDARY not in rels
    assert len(rels) > 20


def test_no_second_parser_of_the_stored_curve_exists() -> None:
    """The deleted per-router copies must not come back, under that name or as a
    new function by another one that is spelled the same way."""
    root = _repo_root() / "analytics-service"
    offenders: list[str] = []
    for f in _surface_files():
        for n in ast.walk(ast.parse(f.read_text())):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in (
                "_records_to_series",
                "records_to_series",
            ):
                offenders.append(f"{f.relative_to(root).as_posix()}:{n.lineno} def {n.name}")
    assert not offenders, (
        "a parser of the stored curve was defined outside services/wealth_returns.py "
        "(CR-01: a second reader is a second chance to read levels as returns): "
        + "; ".join(offenders)
    )


def test_every_returns_series_reference_outside_the_boundary_is_allowlisted() -> None:
    root = _repo_root() / "analytics-service"
    found: dict[str, list[_Ref]] = {}
    for f in _surface_files():
        refs = _classify_source(f.read_text())
        if refs:
            found[f.relative_to(root).as_posix()] = refs

    problems: list[str] = []
    for rel, refs in sorted(found.items()):
        if rel not in ALLOWED_RETURNS_SERIES_REFS:
            problems.append(
                f"{rel}: {len(refs)} unlisted returns_series reference(s) at lines "
                f"{[r.line for r in refs]}"
            )
        else:
            problems.extend(_kind_problems(rel, refs, ALLOWED_RETURNS_SERIES_REFS[rel]))
    for rel in sorted(set(ALLOWED_RETURNS_SERIES_REFS) - set(found)):
        problems.append(f"{rel}: allowlisted but no reference found (stale entry)")
    assert not problems, (
        "returns_series is the cumulative wealth CURVE, not daily returns: read it "
        "through services.wealth_returns.daily_returns_from_row, or list the new "
        "reference with its kind and a reason. " + " | ".join(problems)
    )


def test_a_swapped_log_string_for_an_inline_curve_parse_is_caught() -> None:
    """WR-04: the allowlist used to count references, so deleting the word from a
    log message and adding an inline parse in the same commit kept the total. The
    classifier must see the log reference vanish AND the new load appear."""
    allowance = _Allowance(selects=1, logs=1, sites={}, reason="x " * 10)
    clean = (
        "def f(sb, logger, missing):\n"
        "    sb.table('t').select('strategy_id, returns_series, daily_returns, "
        "data_quality_flags')\n"
        "    logger.warning('missing returns_series for %s', missing)\n"
    )
    swapped = (
        "def f(sb, logger, missing, row):\n"
        "    sb.table('t').select('strategy_id, returns_series, daily_returns, "
        "data_quality_flags')\n"
        "    logger.warning('missing curve for %s', missing)\n"
        "    return {r['date']: r['value'] for r in row['returns_series']}\n"
    )
    assert _kind_problems("x.py", _classify_source(clean), allowance) == []
    problems = _kind_problems("x.py", _classify_source(swapped), allowance)
    assert any("unclassified returns_series reference" in p and "f()" in p for p in problems), problems
    assert any("expected 1 log reference" in p for p in problems), problems


@pytest.mark.parametrize(
    "load",
    [
        "row['returns_series']",
        "row.get('returns_series')",
        "getattr(row, 'returns_series')",
        "returns_series",
    ],
)
def test_every_load_spelling_is_a_site_not_a_select_or_log(load: str) -> None:
    refs = _classify_source(f"def g(row, returns_series=None):\n    return {load}\n")
    assert refs and all(r.kind == KIND_SITE for r in refs), refs


def test_an_allowlisted_site_is_pinned_to_its_function() -> None:
    allowance = _Allowance(selects=0, logs=0, sites={"writer": 1}, reason="x " * 10)
    ok = "def writer(rows):\n    return {'returns_series': rows}\n"
    elsewhere = "def other(rows):\n    return {'returns_series': rows}\n"
    assert _kind_problems("m.py", _classify_source(ok), allowance) == []
    assert _kind_problems("m.py", _classify_source(elsewhere), allowance)


def test_every_allowlist_entry_carries_a_reason() -> None:
    for rel, allowance in ALLOWED_RETURNS_SERIES_REFS.items():
        total = allowance.selects + allowance.logs + sum(allowance.sites.values())
        assert total > 0, rel
        assert len(allowance.reason.split()) >= 8, (
            f"{rel}: the reason must say why it is not a bypass"
        )


def _select_refs() -> list[tuple[str, Path, _Ref]]:
    root = _repo_root() / "analytics-service"
    out: list[tuple[str, Path, _Ref]] = []
    for f in _surface_files():
        for r in _classify_source(f.read_text()):
            if r.kind == KIND_SELECT:
                out.append((f.relative_to(root).as_posix(), f, r))
    return out


def test_the_select_census_is_not_vacuous() -> None:
    """The two select guards below loop over this list; an empty one is green by
    construction (D-04's failure mode)."""
    assert len(_select_refs()) >= 10


def test_a_file_that_selects_the_curve_also_reads_through_the_boundary() -> None:
    """A select naming ``returns_series`` is a stored-curve read: the file must
    call ``daily_returns_from_row`` and the select must name ``daily_returns``
    beside it, so the D-02 order (daily_returns first) is reachable."""
    problems: list[str] = []
    seen_files: set[Path] = set()
    for rel, f, ref in _select_refs():
        if f not in seen_files:
            seen_files.add(f)
            if "daily_returns_from_row(" not in "\n".join(
                ln for ln in f.read_text().splitlines() if not _is_pure_comment(ln)
            ):
                problems.append(
                    f"{rel}: selects returns_series but never calls daily_returns_from_row"
                )
        cols = {c.strip() for c in ref.columns.split(",")}
        if "daily_returns" not in cols:
            problems.append(f"{rel}:{ref.line}: select names returns_series without daily_returns")
    assert not problems, "; ".join(problems)


def test_every_select_of_the_curve_also_names_the_method_flags() -> None:
    """WR-03: the curve method is read from ``data_quality_flags`` on the SAME row.
    A select that omits the column makes ``curve_method_from_flags(None)`` read
    geometric silently, so every simple curve on that path is read by ratio (D-05
    keeps the absent-stamp default; the select is where the stamp is lost)."""
    problems = [
        f"{rel}:{ref.line}: select names returns_series without data_quality_flags "
        "(the curve method is unreadable on this path)"
        for rel, _f, ref in _select_refs()
        if "data_quality_flags" not in {c.strip() for c in ref.columns.split(",")}
    ]
    assert not problems, "; ".join(problems)


# WR-02: the router calls to ``daily_returns_from_row`` that do NOT hand their
# series to the native -> USD converter next, so they read absent days deleted.
# Every other router call must ask for ``keep_absent=True``: without it an absent
# day vanishes and the converter prices the day after it over the whole gap.
#
# Phase 164.6.6.2.1 (D-04, D-10): empty now. ``verify_strategy``'s correlation read
# of the existing book was the one entry; it converts its BTC-unit candidates to
# USD (after the memory-cap trim), so it keeps absent days like every other read.
_ROUTER_CALLS_THAT_DO_NOT_CONVERT: dict[str, int] = {}


def test_every_converting_router_read_keeps_absent_days_for_the_converter() -> None:
    root = _repo_root() / "analytics-service"
    seen_without: dict[str, int] = {}
    seen_with = 0
    for f in _surface_files():
        rel = f.relative_to(root).as_posix()
        if not rel.startswith("routers/"):
            continue
        for n in ast.walk(ast.parse(f.read_text())):
            if not (
                isinstance(n, ast.Call)
                and isinstance(n.func, ast.Name)
                and n.func.id == "daily_returns_from_row"
            ):
                continue
            keeps = any(
                kw.arg == "keep_absent"
                and isinstance(kw.value, ast.Constant)
                and kw.value.value is True
                for kw in n.keywords
            )
            if keeps:
                seen_with += 1
            else:
                seen_without[rel] = seen_without.get(rel, 0) + 1
    assert seen_with > 0, "no converting router read found: the scan covers nothing"
    assert seen_without == _ROUTER_CALLS_THAT_DO_NOT_CONVERT, (
        "a router read of a stored row that feeds the native -> USD converter must "
        "pass keep_absent=True (WR-02), or be listed here as a read that never "
        f"converts. Reads without it: {seen_without}"
    )


def test_no_comment_or_docstring_names_the_deleted_parser() -> None:
    """``_records_to_series`` is deleted; prose still calling it the live parser
    sends the next reader looking for code that is gone. Cite the public
    ``services.wealth_returns.records_to_series`` instead. Scans every line (code,
    comment and docstring) under ``services/`` and ``routers/``."""
    root = _repo_root() / "analytics-service"
    hits: list[str] = []
    for f in _surface_files():
        for i, line in enumerate(f.read_text().splitlines(), 1):
            if "_records_to_series" in line:
                hits.append(f"{f.relative_to(root).as_posix()}:{i}")
    assert not hits, "stale prose naming the deleted _records_to_series: " + ", ".join(hits)
