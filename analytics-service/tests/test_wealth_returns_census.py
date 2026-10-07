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
   not in the allowlist with its exact count and a reason. A docstring or a
   comment cannot satisfy or trip it: only code (identifiers and string
   constants) is counted.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any
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
# A PostgREST column list: identifiers, commas, spaces. Prose never fullmatches.
_COLUMN_LIST = re.compile(r"[a-z_]+(?:, ?[a-z_]+)+")

# file -> (count, reason). Counted on CODE only (an identifier, or a string
# constant naming the column), docstrings and comments excluded. Each reason says
# why the reference is not a value read that bypasses the boundary. A new
# reference, or a count that moves, fails the census naming the file and lines.
ALLOWED_RETURNS_SERIES_REFS: dict[str, tuple[int, str]] = {
    "routers/match.py": (
        2,
        "two select column lists: the candidate-universe read (engine metrics "
        "beside the curve) and the allocator-book read. Both feed "
        "daily_returns_from_row; no returns_series value is parsed here.",
    ),
    "routers/portfolio.py": (
        12,
        "six select column lists (compute, optimizer x2, bridge x2, verify), "
        "each naming daily_returns and data_quality_flags beside the curve and "
        "read through daily_returns_from_row; four log lines naming the column "
        "in text; the verify trim (_trim_returns_series applied to the "
        "'returns_series' key twice on one line, before the boundary, so a "
        "capped row reads exactly like the full one). No value is parsed here.",
    ),
    "routers/simulator.py": (
        1,
        "the candidate select column list, read through daily_returns_from_row.",
    ),
    "services/metrics.py": (
        6,
        "the WRITER: compute_all_metrics builds the stored curve (a local list "
        "of {date, value} points, its downsample, its cap, and the metrics-dict "
        "key). It produces the column, it does not read one.",
    ),
    "services/strategy_matching.py": (
        1,
        "the published-strategy select column list, read through "
        "daily_returns_from_row.",
    ),
}


def _is_docstring(node: ast.AST, docstrings: set[int]) -> bool:
    return id(node) in docstrings


def _code_references(path: Path) -> list[int]:
    """Line numbers of every code reference to the ``returns_series`` column in
    ``path``: an identifier, or a string constant naming it as a whole word.
    Docstrings are excluded (they are prose); comments never reach the AST."""
    tree = ast.parse(path.read_text())
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
    lines: list[int] = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            if not _is_docstring(n, docstrings) and _TOKEN.search(n.value):
                lines.append(n.lineno)
        elif isinstance(n, ast.Name) and n.id == "returns_series":
            lines.append(n.lineno)
        elif isinstance(n, ast.Attribute) and n.attr == "returns_series":
            lines.append(n.lineno)
        elif isinstance(n, ast.arg) and n.arg == "returns_series":
            lines.append(n.lineno)
        elif isinstance(n, ast.keyword) and n.arg == "returns_series":
            lines.append(n.lineno)
    return sorted(lines)


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
    found: dict[str, list[int]] = {}
    for f in _surface_files():
        lines = _code_references(f)
        if lines:
            found[f.relative_to(root).as_posix()] = lines

    problems: list[str] = []
    for rel, lines in sorted(found.items()):
        if rel not in ALLOWED_RETURNS_SERIES_REFS:
            problems.append(
                f"{rel}: {len(lines)} unlisted returns_series reference(s) at lines {lines}"
            )
        elif len(lines) != ALLOWED_RETURNS_SERIES_REFS[rel][0]:
            problems.append(
                f"{rel}: expected {ALLOWED_RETURNS_SERIES_REFS[rel][0]} "
                f"reference(s), found {len(lines)} at lines {lines}"
            )
    for rel in sorted(set(ALLOWED_RETURNS_SERIES_REFS) - set(found)):
        problems.append(f"{rel}: allowlisted but no reference found (stale entry)")
    assert not problems, (
        "returns_series is the cumulative wealth CURVE, not daily returns: read it "
        "through services.wealth_returns.daily_returns_from_row, or list the new "
        "reference with a count and a reason. " + " | ".join(problems)
    )


def test_every_allowlist_entry_carries_a_reason() -> None:
    for rel, (count, reason) in ALLOWED_RETURNS_SERIES_REFS.items():
        assert count > 0, rel
        assert len(reason.split()) >= 8, f"{rel}: the reason must say why it is not a bypass"


def test_a_file_that_selects_the_curve_also_reads_through_the_boundary() -> None:
    """A select naming ``returns_series`` is a stored-curve read: the file must
    call ``daily_returns_from_row`` and the select must name ``daily_returns``
    beside it, so the D-02 order (daily_returns first) is reachable."""
    root = _repo_root() / "analytics-service"
    problems: list[str] = []
    for f in _surface_files():
        rel = f.relative_to(root).as_posix()
        if rel == "services/metrics.py":
            continue  # the writer: no select
        tree = ast.parse(f.read_text())
        selects = [
            n for n in ast.walk(tree)
            if isinstance(n, ast.Constant)
            and isinstance(n.value, str)
            and _COLUMN_LIST.fullmatch(n.value)
            and _TOKEN.search(n.value)
        ]
        if not selects:
            continue
        if "daily_returns_from_row(" not in "\n".join(
            ln for ln in f.read_text().splitlines() if not _is_pure_comment(ln)
        ):
            problems.append(f"{rel}: selects returns_series but never calls daily_returns_from_row")
        for s in selects:
            if "daily_returns" not in str(s.value).replace("returns_series", ""):
                problems.append(f"{rel}:{s.lineno}: select names returns_series without daily_returns")
    assert not problems, "; ".join(problems)


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
