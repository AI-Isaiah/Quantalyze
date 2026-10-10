"""Phase 170.2 (SC-5) — the benchmark-since census: every benchmark caller passes ``since=``.

WHAT THIS PINS
--------------
``services.benchmark.get_benchmark_returns(symbol, days=1000, *, since=None)`` reads a
trailing window of ``days`` unless ``since`` pulls its start back to the first date of
the series the caller is about to pair it with. A caller that omits ``since`` silently
reads the trailing 1000 days, and for any strategy or portfolio older than that the
alpha, beta, Treynor, R-squared and correlation history before the window is dropped
without an error (Phase 170.2 SC-5). The set of callers that pass ``since`` may only
GROW; the set that does not is exactly the cron's refresh, which has no series to
pair and wants the trailing window by design.

THE SCANNER'S PREDICATE, STATED IN FULL
---------------------------------------
Every count in this file is meaningless without the definition it was measured under:

    An ``ast.Call`` whose ``func`` is either an ``ast.Name`` with
    ``id == "get_benchmark_returns"`` or an ``ast.Attribute`` with
    ``attr == "get_benchmark_returns"`` (so ``benchmark_mod.get_benchmark_returns(...)``
    is seen too), found by walking ``_py_scan_files()`` (the two entrypoints plus
    ``services/``, ``routers/`` and ``scripts/``). A call PASSES ``since`` iff it carries
    a keyword named ``since`` whose value is NOT the literal ``None``. ``since=None`` is
    a trailing window written out in full, so it counts as NOT passing. A
    ``**kwargs`` splat is not a ``since`` keyword and counts as NOT passing: the
    census cannot see through it, so the call must name ``since`` itself.

Sites are keyed on ``(module basename, enclosing function name)`` and NEVER on a line
number. The ``def get_benchmark_returns`` itself and the ``from ... import`` line are
not ``ast.Call`` nodes, and a mention in a comment, docstring or string literal is
structurally invisible to ``ast``.

THE EXPECTATIONS ARE HAND-TYPED
-------------------------------
``EXPECTED_SINCE_SITES`` and ``EXPECTED_NO_SINCE_SITES`` are LITERALS typed from
``grep -rn "get_benchmark_returns(" services routers scripts``, never read back out of
the scan: an oracle that derives its expected value from the subject agrees with itself
forever. Both are ``collections.Counter`` so a function that calls twice (the derive job
reads the benchmark for the mark-to-market basis AND the smoothed basis) cannot lose
one of its calls unnoticed under a set equality.

WHAT THIS CENSUS CANNOT SEE
---------------------------
* A call through a name the scan does not match (``fn = get_benchmark_returns; fn("BTC")``,
  ``getattr``, a wrapper with another name). Nothing in the tree does that today.
* Whether the VALUE passed to ``since`` is the right date. That is pinned per site by
  the behavioural tests (``test_stitch_composite_job.py``,
  ``test_portfolio_benchmark_pairing.py``, ``test_benchmark_since.py``); this file pins
  only that no caller can drop the keyword unnoticed.
* Anything outside ``_py_scan_files()``.

PLAN 11 ADDED ITS SITE
----------------------
The one-time backfill script (``scripts/backfill_btc_benchmark.py``, plan 11 of this
phase) carries its own ``("backfill_btc_benchmark.py", "main")`` row in
``EXPECTED_SINCE_SITES``, added in the same commit as the script. Any further script
that calls ``get_benchmark_returns`` must do the same.
"""

from __future__ import annotations

import ast
from collections import Counter
from pathlib import Path
from typing import NamedTuple

from tests._scan_helpers import _py_scan_files

SiteKey = tuple[str, str]

#: Callers that pass ``since=``. Keyed ``(module basename, enclosing function)``.
#: May only GROW. Plan 11's backfill script adds its row here.
EXPECTED_SINCE_SITES: Counter[SiteKey] = Counter(
    {
        # CSV runner: pairs BTC with the strategy's own return series.
        ("analytics_runner.py", "run_csv_strategy_analytics"): 1,
        # Broker derive: the mark-to-market basis AND the smoothed basis each read
        # the benchmark for their own series, so two calls in one function.
        ("job_worker.py", "run_derive_broker_dailies_job"): 2,
        # Composite stitch: pairs BTC with the stitched cash series.
        ("job_worker.py", "run_stitch_composite_job"): 1,
        # Portfolio compare: pairs BTC with the blended portfolio series.
        ("portfolio.py", "_compute_portfolio_analytics"): 1,
        # Plan 11: the one-time older-history backfill script. It passes the oldest
        # strategy return date (or --since) through the product's own fetch path.
        ("backfill_btc_benchmark.py", "main"): 1,
    }
)

#: Callers that do NOT pass ``since``. Exactly the cron refresh: it keeps the cache
#: warm over the trailing window and has no series of its own to pair.
EXPECTED_NO_SINCE_SITES: Counter[SiteKey] = Counter(
    {
        ("cron.py", "_benchmark_refresh_once"): 1,
    }
)

#: Vacuity fence. A scanner that matched nothing would agree with an empty roster
#: forever, so the scan must prove it saw the tree. Loose floor on purpose.
MIN_FILES_SCANNED = 30

_CALLEE = "get_benchmark_returns"


class BenchmarkCall(NamedTuple):
    """One ``get_benchmark_returns(...)`` call site."""

    module: str
    function: str
    passes_since: bool


def _enclosing_function_resolver(tree: ast.AST) -> dict[ast.AST, str]:
    """Map every node to its enclosing ``def``/``async def`` name (``<module>`` if none).

    ``ast`` carries no parent links, so build them once per module. Keyed on the
    function name, never on ``lineno``: line numbers are the citation class this
    repo has measured rotting.
    """
    parent: dict[ast.AST, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parent[child] = node

    resolved: dict[ast.AST, str] = {}
    for node in ast.walk(tree):
        cursor: ast.AST | None = parent.get(node)
        name = "<module>"
        while cursor is not None:
            if isinstance(cursor, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = cursor.name
                break
            cursor = parent.get(cursor)
        resolved[node] = name
    return resolved


def _is_callee(func: ast.expr) -> bool:
    if isinstance(func, ast.Name):
        return func.id == _CALLEE
    if isinstance(func, ast.Attribute):
        return func.attr == _CALLEE
    return False


def _passes_since(call: ast.Call) -> bool:
    for kw in call.keywords:
        if kw.arg != "since":
            continue
        # ``since=None`` is the trailing window spelled out: not a pass.
        if isinstance(kw.value, ast.Constant) and kw.value.value is None:
            return False
        return True
    return False


def scan_source(module_name: str, source: str) -> list[BenchmarkCall]:
    """Every ``get_benchmark_returns`` call in ``source``, per the docstring's predicate."""
    tree = ast.parse(source)
    enclosing = _enclosing_function_resolver(tree)
    return [
        BenchmarkCall(module_name, enclosing[node], _passes_since(node))
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and _is_callee(node.func)
    ]


def scan_tree() -> tuple[list[BenchmarkCall], int]:
    """All calls across the scanned surface, and the file count."""
    files: list[Path] = _py_scan_files()
    found: list[BenchmarkCall] = []
    for path in files:
        found.extend(scan_source(path.name, path.read_text(encoding="utf-8")))
    return found, len(files)


def _derive(passes: bool) -> Counter[SiteKey]:
    found, _ = scan_tree()
    return Counter((c.module, c.function) for c in found if c.passes_since is passes)


class TestEveryBenchmarkCallerPassesSince:
    def test_every_benchmark_caller_passes_since(self) -> None:
        """The load-bearing assertion: ``==`` with multiplicity, never containment.

        A caller that drops ``since=`` moves from the first Counter to the second and
        both equalities redden, naming the file and function. Containment would let a
        removed caller rot in the roster forever.
        """
        with_since = _derive(True)
        without_since = _derive(False)

        unexpected_without = without_since - EXPECTED_NO_SINCE_SITES
        assert without_since == EXPECTED_NO_SINCE_SITES, (
            "a get_benchmark_returns caller does not pass since=. "
            f"unexpected (read a trailing window): {sorted(unexpected_without.items())}; "
            f"missing: {sorted((EXPECTED_NO_SINCE_SITES - without_since).items())}. "
            "Pass since= the first date of the series the call pairs the benchmark "
            "with (see services/analytics_runner.py :: run_csv_strategy_analytics). "
            "Only routers/cron.py :: _benchmark_refresh_once may omit it."
        )
        assert with_since == EXPECTED_SINCE_SITES, (
            "the set of get_benchmark_returns callers that pass since= moved. "
            f"unexpected={sorted((with_since - EXPECTED_SINCE_SITES).items())}, "
            f"missing={sorted((EXPECTED_SINCE_SITES - with_since).items())}. "
            "A NEW caller must add its (module, function) row to EXPECTED_SINCE_SITES "
            "in the same commit; a MISSING row means a caller was removed or renamed."
        )

    def test_the_expectations_are_multiplicity_preserving(self) -> None:
        """Guards the guard: both rosters are ``Counter`` and the duplicated site is real.

        The derive job calls twice (mark-to-market and smoothed basis). Under a set,
        deleting one of those two calls compares equal to the correct tree.
        """
        assert isinstance(EXPECTED_SINCE_SITES, Counter)
        assert isinstance(EXPECTED_NO_SINCE_SITES, Counter)
        assert sum(EXPECTED_SINCE_SITES.values()) > len(EXPECTED_SINCE_SITES), (
            "if sites ever equal distinct keys, multiplicity has stopped mattering — "
            "re-derive before weakening this file to a set"
        )
        assert EXPECTED_SINCE_SITES[("job_worker.py", "run_derive_broker_dailies_job")] == 2

    def test_the_scan_saw_the_tree(self) -> None:
        """Vacuity fence: a scanner that matched nothing agrees with nothing."""
        found, n_files = scan_tree()
        assert n_files >= MIN_FILES_SCANNED, f"scanned only {n_files} files"
        assert found, "the scan matched no get_benchmark_returns call at all"


class TestScannerNeedles:
    """The scanner is ONE implementation, exercised by the disk walk above and here, so a
    needle never tests a second copy of the logic."""

    def test_a_call_without_since_is_flagged(self) -> None:
        calls = scan_source("x.py", "async def f():\n    await get_benchmark_returns('BTC')\n")
        assert calls == [BenchmarkCall("x.py", "f", False)]

    def test_a_call_with_since_passes(self) -> None:
        calls = scan_source(
            "x.py", "async def f(d):\n    await get_benchmark_returns('BTC', since=d)\n"
        )
        assert calls == [BenchmarkCall("x.py", "f", True)]

    def test_since_none_is_not_a_pass(self) -> None:
        calls = scan_source(
            "x.py", "async def f():\n    await get_benchmark_returns('BTC', since=None)\n"
        )
        assert calls == [BenchmarkCall("x.py", "f", False)]

    def test_a_kwargs_splat_is_not_a_pass(self) -> None:
        calls = scan_source(
            "x.py", "async def f(kw):\n    await get_benchmark_returns('BTC', **kw)\n"
        )
        assert calls == [BenchmarkCall("x.py", "f", False)]

    def test_an_attribute_call_is_seen(self) -> None:
        calls = scan_source(
            "x.py", "async def f():\n    await mod.get_benchmark_returns('BTC')\n"
        )
        assert calls == [BenchmarkCall("x.py", "f", False)]

    def test_comments_strings_and_imports_are_invisible(self) -> None:
        src = (
            "from services.benchmark import get_benchmark_returns\n"
            "# get_benchmark_returns('BTC')\n"
            "DOC = \"get_benchmark_returns('BTC')\"\n"
            "def get_benchmark_returns(symbol): ...\n"
        )
        assert scan_source("x.py", src) == []

    def test_module_level_call_is_keyed_module(self) -> None:
        assert scan_source("x.py", "get_benchmark_returns('BTC')\n") == [
            BenchmarkCall("x.py", "<module>", False)
        ]
