"""Phase 166.5 (D-01, D-02, R-01) - census of every ``strategy_analytics`` payload
that names ``computed_at``.

WHY THIS EXISTS
---------------
``strategy_analytics.computed_at`` is the freshness every reader trusts: the
freshness chip, the factsheet cache key, the tearsheet badge, the PDF ETag, the
health score and the sort. Phase 166.5 makes the analytics runner the ONLY writer
of it (D-01), on exactly two finishes, from the DATABASE clock (D-02):

  * ``analytics_runner._mark_complete``     (CSV / stored-trades path)
  * ``job_worker.run_stitch_composite_job`` (``headline_payload``, composite path)

Each writes the string ``"now"``; Postgres reads that special timestamptz input as
the transaction start. Every property below protects one way that goes wrong:

  * a FAILURE payload that names the column would present a failed recompute as
    fresh (D-04: a failure leaves the date at the last good compute);
  * a stamp written while the row is ``computing`` would look fresh over an
    unfinished run, and 166.3.1's BEFORE UPDATE hold trigger would silently
    discard it anyway, so the writer would believe it had stamped;
  * a Python-clock value (``datetime.now().isoformat()``) skews against the
    ``compute_jobs.updated_at`` database clock (D-02);
  * a THIRD writer is a decision for the founder (D-01), not something a refactor
    may introduce quietly;
  * a payload naming the column with NO ``computation_status`` key is a write the
    census cannot classify. That is a failure of the rule, never a quiet pass.

The scan helpers are imported from the sibling censuses, not re-implemented: two
censuses that disagree about what a ``strategy_analytics`` write site is would be
the D-10 defect (copy-pasted scan helpers that diverged) in a new place.

``_scan_python().kept`` drops payloads without ``computation_status`` BY DESIGN
(partial data-quality-flag upserts). That is exactly the shape rule 3 must still
catch, so this module reads ``all_sites`` instead.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Final

import pytest

from tests._scan_helpers import _py_scan_files
from tests.test_computing_started_at_stamp import (  # noqa: PLC2701
    _STATUS_KEY,
    _collect_write_sites_in_text,
    _dict_value,
    _has_key,
    _scan_typescript,
    _ts_literal_at,
    _ts_payload_hits,
    _WriteSite,
)

_COLUMN: Final[str] = "computed_at"
_DB_CLOCK_LITERAL: Final[str] = "now"

# A success status is either one of these constants, or a variable that the
# surrounding function derived from the run's outcome. Only the two known
# variable names are accepted: a status held in any other variable could be a
# failure, so extending this set is an edit to the gate, not a quiet pass.
_SUCCESS_CONSTANTS: Final[frozenset[str]] = frozenset(
    {"complete", "complete_with_warnings"}
)
_SUCCESS_STATUS_NAMES: Final[frozenset[str]] = frozenset(
    {"csv_status", "composite_status"}
)

# (file, enclosing function, name the payload dict is bound to). The two real
# finishes. A third entry needs a founder decision under D-01.
_EXPECTED_SITES: Final[frozenset[tuple[str, str, str]]] = frozenset(
    {
        ("analytics_runner.py", "_mark_complete", "payload"),
        ("job_worker.py", "run_stitch_composite_job", "headline_payload"),
    }
)

_TS_COLUMN_KEY_RE: Final[re.Pattern[str]] = re.compile(r"\bcomputed_at\s*:")

Label = tuple[str, str, str]


def _site_label(source: str, name: str, site: _WriteSite) -> Label:
    """``(file basename, enclosing function, bound name)`` of the site's payload dict.

    Located by the dict node's position, so it works for the real files and for
    in-memory sources alike. The bound name is the assignment target when the
    dict is assigned (``payload = {...}``); ``<inline>`` for a literal passed
    straight to the write call.
    """
    tree = ast.parse(source)
    pos = (site.payload.lineno, site.payload.col_offset)
    found: list[tuple[str, str]] = []

    def visit(node: ast.AST, funcs: tuple[str, ...], bound: str | None) -> None:
        if found:
            return
        if isinstance(node, ast.Dict) and (node.lineno, node.col_offset) == pos:
            found.append((funcs[-1] if funcs else "<module>", bound or "<inline>"))
            return
        next_funcs = funcs
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            next_funcs = funcs + (node.name,)
        target: str | None = None
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
        ):
            target = node.targets[0].id
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            target = node.target.id
        for child in ast.iter_child_nodes(node):
            is_value = target is not None and child is getattr(node, "value", None)
            visit(child, next_funcs, target if is_value else None)

    visit(tree, (), None)
    assert found, f"{name}:{site.lineno}: could not locate the payload dict again"
    return (Path(name).name, found[0][0], found[0][1])


def _site_defects(site: _WriteSite, where: str) -> list[str]:
    """Every way ONE payload that names ``computed_at`` breaks the contract."""
    defects: list[str] = []
    value = _dict_value(site.payload, _COLUMN)
    if not (
        isinstance(value, ast.Constant)
        and isinstance(value.value, str)
        and value.value == _DB_CLOCK_LITERAL
    ):
        defects.append(
            f"{where}: {_COLUMN} must be the string constant {_DB_CLOCK_LITERAL!r} "
            "(the DATABASE clock, D-02), found "
            f"{ast.unparse(value) if value is not None else '<spread>'!r}"
        )
    if not _has_key(site.payload, _STATUS_KEY):
        defects.append(
            f"{where}: names {_COLUMN} with no {_STATUS_KEY} key, so the write cannot "
            "be classified as a success finish"
        )
        return defects
    status = _dict_value(site.payload, _STATUS_KEY)
    if isinstance(status, ast.Constant) and isinstance(status.value, str):
        if status.value not in _SUCCESS_CONSTANTS:
            defects.append(
                f"{where}: names {_COLUMN} with {_STATUS_KEY}={status.value!r}. Only a "
                "terminal success may stamp (D-04): a failure keeps the last good date, "
                "and 166.3.1's trigger discards a stamp written on 'failed' or 'computing'"
            )
    elif isinstance(status, ast.Name):
        if status.id not in _SUCCESS_STATUS_NAMES:
            defects.append(
                f"{where}: names {_COLUMN} with {_STATUS_KEY}=<{status.id}>, a variable "
                f"this census does not know to be a success ({sorted(_SUCCESS_STATUS_NAMES)}); "
                "extend the gate"
            )
    else:
        defects.append(
            f"{where}: names {_COLUMN} with an unrecognized {_STATUS_KEY} value form "
            f"({type(status).__name__ if status is not None else 'missing'}); "
            "an unclassified status never passes; extend the gate"
        )
    return defects


def _census(sources: dict[str, str]) -> list[Label]:
    """Apply the per-site rules to every ``computed_at``-naming payload in
    ``sources`` (name -> source text) and return the sites' labels.

    Raises ``AssertionError`` listing every per-site defect. The site-SET rule is
    separate (``_set_defect``) so it can be tested on its own.
    """
    labels: list[Label] = []
    defects: list[str] = []
    for name, source in sources.items():
        scan = _collect_write_sites_in_text(source, label=name)
        for site in scan.sites:
            if not _has_key(site.payload, _COLUMN):
                continue
            where = f"{name}:{site.lineno}"
            defects.extend(_site_defects(site, where))
            labels.append(_site_label(source, name, site))
    assert not defects, "computed_at stamp census:\n  " + "\n  ".join(defects)
    return labels


def _set_defect(labels: list[Label]) -> str | None:
    found = frozenset(labels)
    if len(labels) == len(_EXPECTED_SITES) and found == _EXPECTED_SITES:
        return None
    return (
        f"the stamping sites are {sorted(labels)}, expected exactly "
        f"{sorted(_EXPECTED_SITES)}. A third (or a moved) site that writes "
        f"strategy_analytics.{_COLUMN} needs a founder decision under D-01: the "
        "runner's two finishes are the only writers by design"
    )


def _real_sources() -> dict[str, str]:
    files = _py_scan_files()
    assert files, "the python scan found no files; path resolution is broken"
    return {str(p): p.read_text(encoding="utf-8") for p in files}


def test_python_computed_at_stamps_are_success_only_db_clock() -> None:
    labels = _census(_real_sources())
    assert labels, (
        "the python census found zero payloads naming computed_at: the scan or the "
        "writers moved, and every other assertion here would be vacuous"
    )


def test_python_computed_at_stamp_site_count() -> None:
    labels = _census(_real_sources())
    defect = _set_defect(labels)
    assert defect is None, defect


def test_typescript_strategy_analytics_payloads_never_name_computed_at() -> None:
    """D-01: the runner is the only writer. A Next.js route that wrote a
    strategy_analytics placeholder carrying ``computed_at`` would be a second one."""
    hits = _ts_payload_hits(_scan_typescript())
    assert hits, (
        "the typescript scan found zero strategy_analytics payload keys: the scan "
        "surface is broken, so 'never names computed_at' would hold vacuously"
    )
    offenders: list[str] = []
    for hit in hits:
        where, literal = _ts_literal_at(hit)
        if _TS_COLUMN_KEY_RE.search(literal):
            offenders.append(where)
    assert not offenders, (
        f"these TypeScript strategy_analytics payloads name {_COLUMN} (D-01 allows "
        "only the Python runner to write it):\n  " + "\n  ".join(offenders)
    )


# ---------------------------------------------------------------------------
# Self-test: every rule must be able to fire without editing the live tree.
# ---------------------------------------------------------------------------

_REAL_A = '''
def _mark_complete(supabase, csv_status):
    payload = {
        "strategy_id": "s",
        "computation_status": csv_status,
        "computed_at": "now",
    }
    supabase.table("strategy_analytics").upsert(payload, on_conflict="strategy_id").execute()
'''

_REAL_B = '''
def run_stitch_composite_job(supabase, composite_status):
    headline_payload = {
        "strategy_id": "s",
        "computation_status": composite_status,
        "computed_at": "now",
    }
    supabase.table("strategy_analytics").upsert(headline_payload, on_conflict="strategy_id").execute()
'''


def _writer(fn: str, payload_body: str) -> str:
    return f'''
def {fn}(supabase, csv_status):
    payload = {{
{payload_body}
    }}
    supabase.table("strategy_analytics").upsert(payload, on_conflict="strategy_id").execute()
'''


_PER_SITE_DEFECTS = {
    "failure status": _writer(
        "_mark_failed",
        '"computation_status": "failed", "computed_at": "now",',
    ),
    "python clock value": _writer(
        "_mark_complete",
        '"computation_status": csv_status,'
        ' "computed_at": datetime.now(timezone.utc).isoformat(),',
    ),
    "no status key": _writer(
        "_flag_only",
        '"strategy_id": "s", "computed_at": "now",',
    ),
    "computing entry shape": _writer(
        "_mark_computing",
        '"computation_status": "computing",'
        ' "computing_started_at": started_at, "computed_at": "now",',
    ),
    "unknown status variable": _writer(
        "_mark_maybe",
        '"computation_status": status, "computed_at": "now",',
    ),
}


@pytest.mark.parametrize(
    "case", sorted(_PER_SITE_DEFECTS), ids=sorted(_PER_SITE_DEFECTS)
)
def test_the_rules_fire_on_synthetic_defects(case: str) -> None:
    with pytest.raises(AssertionError, match="computed_at stamp census"):
        _census({"extra.py": _PER_SITE_DEFECTS[case]})


def test_the_site_count_rule_fires_on_a_third_site() -> None:
    third = _writer(
        "_extra_stamp", '"computation_status": csv_status, "computed_at": "now",'
    )
    labels = _census(
        {
            "analytics_runner.py": _REAL_A,
            "job_worker.py": _REAL_B,
            "extra.py": third,
        }
    )
    assert len(labels) == 3
    assert "founder decision" in (_set_defect(labels) or "")


def test_the_synthetic_harness_passes_the_two_real_shapes() -> None:
    """Positive control: the two sanctioned shapes, in the SAME harness, are clean.
    Without it, 'every defect case raises' would also be produced by a harness
    that rejects everything."""
    labels = _census({"analytics_runner.py": _REAL_A, "job_worker.py": _REAL_B})
    assert _set_defect(labels) is None
