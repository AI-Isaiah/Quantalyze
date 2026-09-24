"""Phase 166 (D-14 / D-07, SC-2 / SC-3): the quantstats AST gate over every production module.

WHAT THIS REPLACES, AND WHY
---------------------------
Phase 159's RANK-05 region gate
(``test_rank05_no_unclosed_quantstats_call_survives_in_compute_all_metrics``) scanned
the SOURCE LINES of ``compute_all_metrics`` for ``qs.stats.<name>(`` and accepted a
line that contained the TEXT ``prepare_returns=False``. It reported clean over the
exact surface that was still open: it could not see the ``getattr(qs.stats, name)``
dispatch in ``compute_qstats_scalars``, it could not see ``_rolling_alpha_beta``'s
``rolling_greeks`` call (a different function), and it trusted keyword text that
``cvar`` proves is a lie (``cvar`` advertises ``prepare_returns=`` and does not
forward it). That gate is deleted in the same commit that lands this one, so there
is never a commit with no gate.

This gate walks the AST of EVERY production ``*.py`` under ``analytics-service/``
(``tests/``, virtualenvs and caches excluded) with the single scanner in
``tests/qstats_gate.py``. The scanner, its rules and its allowlists are documented
there. Plan 166-08 proves it able to fail at every call shape (needles, behavioural
preparer-spy pins for every ``KWARG_PROVEN`` leaf, real-file neuter drills).

ANTI-VACUITY (carried over from the old gate's docblock)
--------------------------------------------------------
``violations == []`` is ALSO what an empty scan produces. A rename, a moved module,
or a walk that stopped reading files would leave the gate judging NOTHING and
reporting a clean pass, which is a test that cannot fail. So the scan COUNTS the
quantstats nodes it examined and the importer modules it found, and both are
asserted: the gate is only meaningful while it is looking at the calls.
"""

from __future__ import annotations

import ast
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from tests.qstats_gate import (
    COVERED_MODULES,
    EXEMPT,
    IMPORT_SHAPES,
    KWARG_PROVEN,
    MIRRORED,
    SERVICE_ROOT,
    census_lines,
    mirror_rows,
    scan_source,
    scan_tree,
)


def test_qstats_gate_real_corpus_is_clean() -> None:
    """Every quantstats node in every production module is closed or exempt.

    "Every" is bounded by the shapes the gate recognises: Rules A, A', B1-B6 in
    ``tests/qstats_gate.py``, which fail CLOSED on any quantstats surface other
    than ``<qs>.stats`` and on any import form other than the three green ones.
    The one recorded limit is an attribute name computed at run time.
    """
    violations, _census, _nodes, _importers = scan_tree(SERVICE_ROOT)
    assert violations == [], (
        "quantstats nodes that are not a kwarg-closed allowlisted leaf, not the "
        "exempt drawdown_details, or that reach quantstats outside a covered "
        "module (the RANK-05 price guess is reopened at each of these):\n"
        + "\n".join(
            f"  {v.module}:{v.function}:{v.qs_name}:{v.lineno} [{v.shape}] {v.reason}"
            for v in violations
        )
    )


def test_qstats_gate_real_corpus_is_not_blind() -> None:
    """The scan must actually be looking at the quantstats calls it judges."""
    violations, census, nodes, importers = scan_tree(SERVICE_ROOT)
    assert nodes > 0, (
        "the scan found no quantstats node at all: blind, not clean. Zero nodes "
        "means the walk stopped reading services/metrics.py (rename, moved "
        "module, broken exclusion filter) and the gate is watching an empty room."
    )
    assert importers == COVERED_MODULES, (
        f"modules found importing quantstats {sorted(importers)} != COVERED_MODULES "
        f"{sorted(COVERED_MODULES)}: blind, not clean. A covered module the walk "
        "no longer finds is a module the gate no longer judges."
    )
    node_violations = [v for v in violations if v.shape not in IMPORT_SHAPES]
    assert len(census) + len(node_violations) == nodes, (
        f"{nodes} quantstats nodes scanned but {len(census)} census rows and "
        f"{len(node_violations)} node violations: a node was examined and "
        "neither passed nor failed"
    )


def test_qstats_gate_kwarg_allowlist_is_not_stale() -> None:
    """KWARG_PROVEN is exactly the leaves the code calls, minus the exemption.

    A leaf that stays allowlisted after its last call site is removed is a
    standing permission nobody is using, and the next site that reaches for it
    inherits a proof made for a different call. Equality, not containment.
    """
    _violations, census, _nodes, _importers = scan_tree(SERVICE_ROOT)
    called = {row.qs_name for row in census}
    assert set(EXEMPT) <= called, (
        f"exempt name(s) {sorted(set(EXEMPT) - called)} are no longer called; "
        "delete the exemption and its pin"
    )
    assert KWARG_PROVEN == frozenset(called - set(EXEMPT)), (
        f"KWARG_PROVEN {sorted(KWARG_PROVEN)} != leaves actually called "
        f"{sorted(called - set(EXEMPT))}"
    )
    assert not (KWARG_PROVEN & set(EXEMPT)), "a name cannot be both proven and exempt"


def test_qstats_gate_census_accounts_for_every_node() -> None:
    """D-07: every node has one census row with an arm, every mirror is present."""
    violations, census, nodes, _importers = scan_tree(SERVICE_ROOT)
    assert violations == []
    assert nodes > 0
    assert len(census) == nodes
    for row in census:
        assert row.arm in {"kwarg-proven", "exempt"}, row
        assert row.reason, row
    exempt_rows = [row for row in census if row.arm == "exempt"]
    assert [row.qs_name for row in exempt_rows] == ["drawdown_details"], exempt_rows

    rows = mirror_rows(SERVICE_ROOT)
    assert {row.qs_name for row in rows} == set(MIRRORED)
    assert len(rows) == len(MIRRORED) == 11
    for row in rows:
        assert row.arm == "inline", (
            f"mirror {row.function} for quantstats {row.qs_name} is not defined at "
            "module level in services/metrics.py (renamed or deleted mirror)"
        )

    # The mirror check reads the real module: a symbol that exists passes, one
    # that does not must not. Cross-check against the parsed module directly.
    tree = ast.parse((SERVICE_ROOT / "services" / "metrics.py").read_text(encoding="utf-8"))
    defined = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
    assert {sym for sym, _reason in MIRRORED.values()} <= defined

    lines = census_lines()
    assert lines[0].startswith("qstats-gate census:")
    assert lines[-1].startswith("qstats-gate reconciliation:")
    assert sum(" exempt " in line for line in lines) == 1
    assert sum(" inline " in line for line in lines) == 11


def test_qstats_gate_census_is_printed_on_a_real_run() -> None:
    """Pitfall 5: a census printed with print() is captured and invisible on green.

    Run a real pytest session in a subprocess and read its stdout, so the proof
    is the terminal output a CI reader actually sees, not the helper's return.
    """
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "tests/test_qstats_gate.py::test_qstats_gate_kwarg_allowlist_is_not_stale",
            "-q",
            "-p",
            "no:cacheprovider",
        ],
        cwd=SERVICE_ROOT,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    out_lines = proc.stdout.splitlines()
    assert any(line.startswith("qstats-gate census:") for line in out_lines), proc.stdout
    assert any(line.startswith("qstats-gate reconciliation:") for line in out_lines), proc.stdout


# ---------------------------------------------------------------------------
# Plan 166-08 (D-14 "proven able to fail"): permanent needles per call shape.
#
# Every needle goes through the SAME ``scan_source`` the real-corpus gate above
# uses, so a needle that passes proves the production rule, never a second copy
# of it. Each needle is its own collected case: a RED needle asserts the scanner
# names the module, the enclosing function and the quantstats name; a GREEN
# needle asserts the scanner stays silent on source that only LOOKS like a call.
# The needle module is named ``services/metrics.py`` (a covered module) so that a
# RED result is the call shape itself, not the importer rule.
# ---------------------------------------------------------------------------

NEEDLE_MODULE = "services/metrics.py"

#: id -> (source, enclosing function, quantstats name the violation must carry,
#: substring its reason must carry). One entry per shape the gate claims to see.
RED_NEEDLES: dict[str, tuple[str, str, str, str]] = {
    "needle_direct_unclosed_call": (
        """
        import quantstats as qs
        def compute_all_metrics(r):
            return qs.stats.sharpe(r)
        """,
        "compute_all_metrics",
        "sharpe",
        "not a kwarg-proven leaf",
    ),
    "needle_prepare_returns_true": (
        """
        import quantstats as qs
        def compute_all_metrics(r):
            return qs.stats.volatility(r, prepare_returns=True)
        """,
        "compute_all_metrics",
        "volatility",
        "not the constant False",
    ),
    "needle_prepare_returns_variable": (
        """
        import quantstats as qs
        def compute_all_metrics(r, flag):
            return qs.stats.volatility(r, prepare_returns=flag)
        """,
        "compute_all_metrics",
        "volatility",
        "not the constant False",
    ),
    "needle_kwargs_splat": (
        """
        import quantstats as qs
        def compute_all_metrics(r, **kwargs):
            return qs.stats.volatility(r, **kwargs)
        """,
        "compute_all_metrics",
        "volatility",
        "**kwargs splat",
    ),
    "needle_cvar_keyword_that_lies": (
        """
        import quantstats as qs
        def compute_all_metrics(r):
            return qs.stats.cvar(r, prepare_returns=False)
        """,
        "compute_all_metrics",
        "cvar",
        "not a kwarg-proven leaf",
    ),
    "needle_payoff_ratio_keyword_that_lies": (
        """
        import quantstats as qs
        def _kelly_criterion(r):
            return qs.stats.payoff_ratio(r, prepare_returns=False)
        """,
        "_kelly_criterion",
        "payoff_ratio",
        "not a kwarg-proven leaf",
    ),
    "needle_attribute_dispatch_over_table": (
        """
        import quantstats as qs
        _QSTATS_SINGLE_ARG_SCALARS = (
            ("recovery_factor", "recovery_factor"),
            ("ulcer_index", "ulcer_index"),
        )
        def compute_qstats_scalars(r):
            out = {}
            for key, fn_name in _QSTATS_SINGLE_ARG_SCALARS:
                out[key] = getattr(qs.stats, fn_name)(r)
            return out
        """,
        "compute_qstats_scalars",
        "getattr",
        "dispatches: recovery_factor, ulcer_index",
    ),
    "needle_function_alias": (
        """
        import quantstats as qs
        def compute_all_metrics(r, b):
            fn = qs.stats.greeks
            return fn(r, b)
        """,
        "compute_all_metrics",
        "greeks",
        "referenced without being called",
    ),
    "needle_from_stats_import": (
        """
        from quantstats.stats import greeks
        def compute_all_metrics(r, b):
            return greeks(r, b)
        """,
        "<module>",
        "greeks",
        "hides the call from the gate",
    ),
    "needle_preparer_reference": (
        """
        import quantstats as qs
        def compute_all_metrics(r):
            return qs.utils._prepare_returns(r)
        """,
        "compute_all_metrics",
        "utils",
        "reaches the quantstats preparers",
    ),
    "needle_rolling_alpha_beta_bare_rolling_greeks": (
        """
        import quantstats as qs
        def _rolling_alpha_beta(r, b, window=90):
            return qs.stats.rolling_greeks(r, b, window)
        """,
        "_rolling_alpha_beta",
        "rolling_greeks",
        "not a kwarg-proven leaf",
    ),
    "needle_stats_namespace_import_alias": (
        """
        from quantstats import stats as S
        def compute_all_metrics(r):
            return S.sharpe(r)
        """,
        "compute_all_metrics",
        "sharpe",
        "not a kwarg-proven leaf",
    ),
    # Phase 166 review round 1 (WR-01 / SFH HIGH-2): every shape below returned
    # `violations=[]` and `nodes=0` before Rule B5/B6 existed (measured).
    "needle_reports_namespace": (
        """
        import quantstats as qs
        def compute_all_metrics(r):
            return qs.reports.metrics(r, mode="full", display=False)
        """,
        "compute_all_metrics",
        "reports",
        "outside qs.stats",
    ),
    "needle_plots_namespace": (
        """
        import quantstats as qs
        def compute_all_metrics(r):
            return qs.plots.snapshot(r)
        """,
        "compute_all_metrics",
        "plots",
        "outside qs.stats",
    ),
    "needle_extend_pandas": (
        """
        import quantstats as qs
        def compute_all_metrics(r):
            qs.extend_pandas()
            return r.max_drawdown()
        """,
        "compute_all_metrics",
        "extend_pandas",
        "monkeypatches every guessing stats function",
    ),
    "needle_qs_passed_as_a_value": (
        """
        import quantstats as qs
        def compute_all_metrics(r):
            return helper(qs, r)
        """,
        "compute_all_metrics",
        "helper()",
        "outside qs.stats",
    ),
    "needle_vars_of_the_alias": (
        """
        import quantstats as qs
        def compute_all_metrics(r):
            return vars(qs)["stats"].sharpe(r)
        """,
        "compute_all_metrics",
        "vars()",
        "outside qs.stats",
    ),
    "needle_globals_lookup_of_the_alias": (
        """
        import quantstats as qs
        def compute_all_metrics(r):
            return globals()["qs"].stats.sharpe(r)
        """,
        "compute_all_metrics",
        "globals()",
        "reaches a quantstats alias by name",
    ),
    "needle_star_import": (
        """
        from quantstats import *
        def compute_all_metrics(r):
            return stats.sharpe(r)
        """,
        "<module>",
        "*",
        "star import",
    ),
    "needle_from_quantstats_import_reports": (
        """
        from quantstats import reports
        def compute_all_metrics(r):
            return reports.metrics(r)
        """,
        "<module>",
        "reports",
        "only the stats namespace is judged",
    ),
    "needle_from_quantstats_submodule_import": (
        """
        from quantstats.reports import metrics
        def compute_all_metrics(r):
            return metrics(r)
        """,
        "<module>",
        "metrics",
        "only the stats namespace is judged",
    ),
    "needle_import_submodule_as_alias": (
        """
        import quantstats.reports as R
        def compute_all_metrics(r):
            return R.metrics(r)
        """,
        "<module>",
        "quantstats.reports",
        "only the stats namespace is judged",
    ),
    "needle_importlib_import_module": (
        """
        import importlib
        def compute_all_metrics(r):
            return importlib.import_module("quantstats").stats.sharpe(r)
        """,
        "compute_all_metrics",
        "quantstats",
        "reaches quantstats by name",
    ),
    "needle_dunder_import": (
        """
        def compute_all_metrics(r):
            return __import__("quantstats.stats").stats.sharpe(r)
        """,
        "compute_all_metrics",
        "quantstats.stats",
        "reaches quantstats by name",
    ),
    "needle_import_module_computed_name": (
        """
        import importlib
        def compute_all_metrics(r, name):
            return importlib.import_module(name).stats.sharpe(r)
        """,
        "compute_all_metrics",
        "import_module",
        "cannot be proven not to load quantstats",
    ),
    "needle_sys_modules_lookup": (
        """
        import sys
        def compute_all_metrics(r):
            return sys.modules["quantstats"].stats.sharpe(r)
        """,
        "compute_all_metrics",
        "quantstats",
        "reaches quantstats by name",
    ),
}


@pytest.mark.parametrize(
    ("source", "function", "qs_name", "reason"),
    list(RED_NEEDLES.values()),
    ids=list(RED_NEEDLES),
)
def test_qstats_gate_red_needle_is_named(
    source: str, function: str, qs_name: str, reason: str
) -> None:
    """Each shape the gate claims to see is reported, naming the site.

    A violation that did not carry the enclosing function and the quantstats
    name would be RED but useless: the reader could not find the site to fix.
    """
    violations, _census, _nodes = scan_source(NEEDLE_MODULE, textwrap.dedent(source))
    matching = [
        v
        for v in violations
        if v.module == NEEDLE_MODULE
        and v.function == function
        and v.qs_name == qs_name
        and reason in v.reason
    ]
    assert matching, (
        f"the gate did not name {NEEDLE_MODULE}:{function}:{qs_name} ({reason!r}); "
        f"it reported {violations}"
    )


def test_qstats_gate_importer_needle_names_the_uncovered_module(tmp_path: Path) -> None:
    """Rule A through ``scan_tree``: a new importer outside COVERED_MODULES is RED.

    The clean covered module beside it proves the violation is the importer rule
    and not something the covered module did.
    """
    services = tmp_path / "services"
    services.mkdir()
    (services / "metrics.py").write_text(
        "import quantstats as qs\n"
        "def compute_all_metrics(r):\n"
        "    return qs.stats.volatility(r, prepare_returns=False)\n",
        encoding="utf-8",
    )
    (services / "other.py").write_text("import quantstats\n", encoding="utf-8")

    violations, _census, _nodes, importers = scan_tree(tmp_path)
    assert importers == frozenset({"services/metrics.py", "services/other.py"})
    assert [(v.module, v.shape) for v in violations] == [
        ("services/other.py", "uncovered importer")
    ], violations


#: Rule A' (Phase 166 review WR-01): a module OUTSIDE COVERED_MODULES that borrows
#: the covered module's quantstats alias. Before Rule A' each returned no violation,
#: because a re-export is not an ``import quantstats``. id -> (source, function,
#: name the violation must carry, substring its reason must carry).
REEXPORT_MODULE = "services/other.py"
REEXPORT_NEEDLES: dict[str, tuple[str, str, str, str]] = {
    "reexport_from_import_of_the_alias": (
        """
        from services.metrics import qs
        def score(r):
            return qs.stats.sharpe(r)
        """,
        "<module>",
        "qs",
        "borrows a covered module's quantstats alias",
    ),
    "reexport_star_import_of_the_covered_module": (
        """
        from services.metrics import *
        def score(r):
            return qs.stats.sharpe(r)
        """,
        "<module>",
        "*",
        "borrows a covered module's quantstats alias",
    ),
    "reexport_relative_from_import": (
        """
        from .metrics import qs
        def score(r):
            return qs.stats.sharpe(r)
        """,
        "<module>",
        "qs",
        "borrows a covered module's quantstats alias",
    ),
    "reexport_module_attribute": (
        """
        from services import metrics
        def score(r):
            return metrics.qs.stats.sharpe(r)
        """,
        "score",
        "qs",
        "from an uncovered module",
    ),
    "reexport_relative_module_attribute": (
        """
        from . import metrics
        def score(r):
            return metrics.qs.stats.sharpe(r)
        """,
        "score",
        "qs",
        "from an uncovered module",
    ),
    "reexport_dotted_module_attribute": (
        """
        import services.metrics
        def score(r):
            return services.metrics.qs.stats.sharpe(r)
        """,
        "score",
        "qs",
        "from an uncovered module",
    ),
    "reexport_module_alias_attribute": (
        """
        import services.metrics as m
        def score(r):
            return m.qs.stats.sharpe(r)
        """,
        "score",
        "qs",
        "from an uncovered module",
    ),
    "reexport_getattr_on_the_module": (
        """
        from services import metrics
        def score(r):
            return getattr(metrics, "qs").stats.sharpe(r)
        """,
        "score",
        "qs",
        "from an uncovered module",
    ),
}


@pytest.mark.parametrize(
    ("source", "function", "qs_name", "reason"),
    list(REEXPORT_NEEDLES.values()),
    ids=list(REEXPORT_NEEDLES),
)
def test_qstats_gate_reexport_needle_is_named(
    source: str, function: str, qs_name: str, reason: str
) -> None:
    """Rule A' names each re-export shape, in the borrowing module.

    Without it any module could reach quantstats through ``services.metrics``'s
    own ``qs`` and bypass Rule A's importer coverage (D-14). The re-exported
    names are read from the real covered module, so this also proves that read.
    """
    violations, _census, _nodes = scan_source(REEXPORT_MODULE, textwrap.dedent(source))
    matching = [
        v
        for v in violations
        if v.module == REEXPORT_MODULE
        and v.function == function
        and v.qs_name == qs_name
        and reason in v.reason
    ]
    assert matching, (
        f"the gate did not name {REEXPORT_MODULE}:{function}:{qs_name} ({reason!r}); "
        f"it reported {violations}"
    )


def test_qstats_gate_reexport_green_needle_is_silent() -> None:
    """Legitimate uses of the covered module from elsewhere are not re-exports.

    Every router imports ``services.metrics`` for its functions; only the
    quantstats alias it binds is off limits.
    """
    source = textwrap.dedent(
        """
        import services.metrics
        import services.metrics as m
        from services import metrics
        from services.metrics import compute_all_metrics
        from . import metrics as sibling
        def score(r):
            return (
                compute_all_metrics(r),
                m.compute_all_metrics(r),
                metrics.sharpe_vol_status_from_backbone(r),
                services.metrics.compute_qstats_scalars(r, None),
                sibling.compute_all_metrics(r),
                getattr(metrics, "compute_all_metrics"),
            )
        """
    )
    assert scan_source(REEXPORT_MODULE, source) == ([], [], 0)


def test_qstats_gate_reexport_through_scan_tree_reads_the_covered_alias(tmp_path: Path) -> None:
    """Rule A' through ``scan_tree``: the borrowed name is read from the covered
    module ITSELF. A covered module aliasing quantstats as ``Q`` makes ``Q`` the
    off-limits name, and ``qs`` (which it no longer binds) stops being one."""
    services = tmp_path / "services"
    services.mkdir()
    (services / "metrics.py").write_text(
        "import quantstats as Q\n"
        "def compute_all_metrics(r):\n"
        "    return Q.stats.volatility(r, prepare_returns=False)\n",
        encoding="utf-8",
    )
    (services / "other.py").write_text(
        "from services.metrics import Q, qs\n", encoding="utf-8"
    )
    violations, _census, _nodes, importers = scan_tree(tmp_path)
    assert importers == frozenset({"services/metrics.py"})
    assert [(v.module, v.qs_name, v.shape) for v in violations] == [
        ("services/other.py", "Q", "re-export import")
    ], violations


GREEN_NEEDLES: dict[str, str] = {
    "needle_green_clean_module": """
        import quantstats as qs
        def compute_all_metrics(r, dd):
            vol = qs.stats.volatility(r, prepare_returns=False)
            var = qs.stats.value_at_risk(r, prepare_returns=False)
            tail = qs.stats.tail_ratio(r, prepare_returns=False)
            pf = qs.stats.profit_factor(r, prepare_returns=False)
            wr = qs.stats.win_rate(r, prepare_returns=False)
            aw = qs.stats.avg_win(r, prepare_returns=False)
            al = qs.stats.avg_loss(r, prepare_returns=False)
            details = qs.stats.drawdown_details(dd)
            return vol, var, tail, pf, wr, aw, al, details
        """,
    "needle_green_commented_out_call": """
        import quantstats as qs
        def compute_all_metrics(r):
            # sharpe = qs.stats.sharpe(r)
            return qs.stats.volatility(r, prepare_returns=False)
        """,
    "needle_green_string_literal_call": """
        import quantstats as qs
        def compute_all_metrics(r):
            note = "qs.stats.sharpe(r) guesses the price path; getattr(qs.stats, name)"
            return note, qs.stats.volatility(r, prepare_returns=False)
        """,
}


@pytest.mark.parametrize("source", list(GREEN_NEEDLES.values()), ids=list(GREEN_NEEDLES))
def test_qstats_gate_green_needle_is_silent(source: str) -> None:
    """Closed calls, comments and string literals are not violations.

    The line gate this replaced matched TEXT, so a comment could satisfy or trip
    it. The AST gate must stay silent here, and must still be LOOKING: the clean
    call in each needle is counted as a node with a census row.
    """
    violations, census, nodes = scan_source(NEEDLE_MODULE, textwrap.dedent(source))
    assert violations == [], violations
    assert nodes > 0 and len(census) == nodes, (nodes, census)


# ---------------------------------------------------------------------------
# Plan 166-08 (D-03 / research F-5): KWARG_PROVEN is proven by BEHAVIOUR.
#
# The gate trusts ``prepare_returns=False`` only on the leaves in KWARG_PROVEN.
# That trust is a claim about quantstats' code, not about the keyword's text:
# ``cvar`` and ``payoff_ratio`` both accept the keyword and still reach a
# preparer. So each allowlisted leaf is called on the RANK-05 trigger fixture
# (an all-winning series whose +150% first day trips both preparer guesses)
# with both preparers spied, and must reach neither. The pins are parametrized
# over ``sorted(KWARG_PROVEN)``, so an allowlisted leaf with no pin cannot exist.
# The calibration rows run the SAME spy on the two known non-honouring
# functions and must see a call: a spy that could not see one would pass every
# pin vacuously.
# ---------------------------------------------------------------------------


def _preparer_calls(monkeypatch: pytest.MonkeyPatch, name: str) -> list[str]:
    """Call ``quantstats.stats.<name>(trigger, prepare_returns=False)``; return preparer hits.

    quantstats 0.0.81's stats functions reach the preparers as attributes of
    ``quantstats.utils`` at call time, so patching that module's attributes is
    what the library itself looks up.
    """
    import quantstats as qs
    from quantstats import utils as qs_utils

    from tests.test_metrics import _rank05_trigger_series

    assert qs.stats._utils is qs_utils, "quantstats.stats no longer reaches the preparers via utils"
    calls: list[str] = []
    real_returns = qs_utils._prepare_returns
    real_prices = qs_utils._prepare_prices

    def spy_returns(*args: object, **kwargs: object) -> object:
        calls.append("_prepare_returns")
        return real_returns(*args, **kwargs)

    def spy_prices(*args: object, **kwargs: object) -> object:
        calls.append("_prepare_prices")
        return real_prices(*args, **kwargs)

    monkeypatch.setattr(qs_utils, "_prepare_returns", spy_returns)
    monkeypatch.setattr(qs_utils, "_prepare_prices", spy_prices)
    getattr(qs.stats, name)(_rank05_trigger_series(), prepare_returns=False)
    return calls


@pytest.mark.parametrize("name", sorted(KWARG_PROVEN))
def test_qstats_gate_kwarg_proven_leaf_never_reaches_a_preparer(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An allowlisted leaf called with prepare_returns=False never runs a preparer."""
    calls = _preparer_calls(monkeypatch, name)
    assert calls == [], (
        f"{name}(prepare_returns=False) still reached {calls} on the trigger fixture: "
        "it is not a closure, and KWARG_PROVEN must not allowlist it"
    )


@pytest.mark.parametrize("name", ["cvar", "payoff_ratio"])
def test_qstats_gate_calibration_non_honouring_functions_do_reach_a_preparer(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The spy sees a function that accepts the keyword and drops it.

    Expected RED for the pin above, kept as its own GREEN row: if quantstats ever
    fixes these, the row fails and the fix gets read, rather than the spy
    silently losing its only proof that it can fail.
    """
    assert name not in KWARG_PROVEN
    calls = _preparer_calls(monkeypatch, name)
    assert calls, (
        f"{name}(prepare_returns=False) reached no preparer: either quantstats now "
        "honours the keyword (re-measure; it may join KWARG_PROVEN) or the spy is blind"
    )


def test_qstats_gate_census_that_cannot_be_built_is_a_named_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review IN-06: the census runs in ``pytest_terminal_summary`` on every run.

    A production file that does not parse used to make that hook raise, which
    turns the session into an INTERNALERROR and hides every real test result.
    It must become one named line instead, and it must do so through the hook
    itself, not just the helper.
    """
    from tests import conftest, qstats_gate

    services = tmp_path / "services"
    services.mkdir()
    (services / "metrics.py").write_text("def half_written(:\n", encoding="utf-8")
    with pytest.raises(SyntaxError):
        census_lines(tmp_path)
    [line] = qstats_gate.safe_census_lines(tmp_path)
    assert line.startswith("qstats-gate census: FAILED TO BUILD (SyntaxError("), line

    def broken(root: Path = SERVICE_ROOT) -> list[str]:
        raise UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte")

    monkeypatch.setattr(qstats_gate, "census_lines", broken)

    class Reporter:
        def __init__(self) -> None:
            self.lines: list[str] = []

        def write_line(self, line: str) -> None:
            self.lines.append(line)

    reporter = Reporter()
    conftest.pytest_terminal_summary(reporter)
    failed = [x for x in reporter.lines if x.startswith("qstats-gate census: FAILED TO BUILD")]
    assert len(failed) == 1 and "UnicodeDecodeError" in failed[0], reporter.lines
