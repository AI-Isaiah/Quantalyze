"""Phase 166 (D-14 / D-07): the quantstats AST gate and its printed census.

A HELPER, NOT A TEST MODULE. ``tests/test_qstats_gate.py`` and the
``pytest_terminal_summary`` hook in ``tests/conftest.py`` both import this one
implementation, so the gate that judges the tree and the census a CI reader sees
can never disagree. conftest never imports a ``test_*`` module.

WHAT IT JUDGES
--------------
Every production ``*.py`` under ``analytics-service/`` (see ``scanned_files``), with
stdlib ``ast`` only. Comments and string literals are invisible to ``ast`` by
construction, which is the line gate's exact failure mode inverted: the old gate
trusted the TEXT ``prepare_returns=False``; this one reads the keyword node.

Local aliases are resolved first: ``import quantstats [as X]`` and
``import quantstats.stats`` bind a quantstats alias; ``import quantstats.stats as X``
and ``from quantstats import stats [as X]`` bind a stats-namespace alias. Then:

- **Rule A, importer coverage.** A module that imports quantstats in any form and is
  not in ``COVERED_MODULES`` is a violation. A new importer cannot slip past the
  gate by living somewhere it does not look.
- **Rule B1, direct call.** ``<qs>.stats.<name>(...)`` is GREEN only if ``<name>`` is
  in ``KWARG_PROVEN`` AND it carries a ``prepare_returns`` keyword whose value is the
  constant ``False`` (``True``, a variable, or a ``**kwargs`` splat is RED), or
  ``<name>`` is in ``EXEMPT``.
- **Rule B2, aliased reference.** Any ``<qs>.stats.<name>`` that is not the ``func``
  of a call (``fn = qs.stats.x``, passed as an argument, stored in a table), and any
  bare reference to the stats namespace itself (``ns = qs.stats``), is RED: the call
  it later makes is invisible to B1.
- **Rule B3, attribute dispatch.** ``getattr(<stats or qs>, name)`` is RED. When the
  second argument is a loop variable over a module-level tuple/list literal, the
  dispatched names are read out of that table and reported (the pre-Phase-166
  ``compute_qstats_scalars`` shape over ``_QSTATS_SINGLE_ARG_SCALARS``).
- **Rule B4, preparers and utils.** Any reference to ``<qs>.utils`` / ``<qs>._utils``
  / ``<stats>._utils``, any attribute or name starting ``_prepare_`` reached from
  quantstats, and any ``from quantstats.stats import ...`` /
  ``from quantstats.utils import ...`` / ``from quantstats import utils`` is RED.
- **Rule B5, fail closed on every other quantstats surface** (Phase 166 review WR-01 /
  SFH HIGH-2). Any use of a quantstats alias other than ``<qs>.stats`` is RED:
  ``qs.reports``, ``qs.plots``, ``qs.extend_pandas()`` (which monkeypatches every
  guessing stats function onto pandas, so each later call is invisible), ``vars(qs)``,
  ``qs.__dict__``, passing ``qs`` as a value. So is every import shape the gate does
  not positively recognise: the ONLY green import forms are ``import quantstats [as X]``,
  ``import quantstats.stats [as X]`` and ``from quantstats import stats [as X]``. A star
  import, ``from quantstats import reports``, ``from quantstats.reports import ...`` and
  ``import quantstats.reports as R`` are RED.
- **Rule B6, string-named access.** A string constant naming quantstats
  (``"quantstats"`` or ``"quantstats.<sub>"``) passed as a call's first argument or
  used as a subscript (``importlib.import_module("quantstats")``,
  ``__import__("quantstats")``, ``sys.modules["quantstats"]``) is RED, and so is
  ``import_module`` / ``__import__`` with a non-constant first argument, because it
  cannot be proven not to load quantstats (no production module imports dynamically,
  measured 2026-09-24). A ``globals()`` / ``vars()`` / ``locals()``
  lookup of a quantstats alias by name (``globals()["qs"]``, ``globals().get("qs")``)
  is RED, and in a module that binds quantstats so is any such dict read with a
  COMPUTED key (``globals()["q" + "s"]``) or handed on as a value (``ns = globals()``).
- **Rule A', the alias reached through the MODULE OBJECT.** A quantstats name BOUND
  in a covered module (read from the covered module itself, ``quantstats_bindings``)
  reached through that module's object is RED. From an uncovered module that is a
  borrowed alias, which would bypass Rule A; inside a covered module it is a
  self-reference the B rules, which judge the bare alias name, cannot see. ``resolve``
  follows the module object through:

  - imports: ``from services.metrics import qs`` / ``*``, ``metrics.qs`` after
    ``from services import metrics``, ``services.metrics.qs``, the relative forms at
    any level;
  - run-time lookups with a constant name: ``importlib.import_module("services.metrics")``,
    ``__import__("services.metrics")``, ``sys.modules["services.metrics"]``,
    ``sys.modules[__name__]``;
  - namespace dicts: ``vars(metrics)[...]``, ``metrics.__dict__[...]`` and ``.get(...)``,
    ``getattr(metrics, "__dict__")``, and ``f.__globals__[...]`` for any function of a
    covered module (imported, or defined in it);
  - ``getattr(<module>, "qs")``;
  - plain rebinding, followed to a fixpoint: ``m = services.metrics``, ``m2 = metrics``,
    ``a, b = metrics, x``, ``(m := metrics)``, ``d = vars(metrics)``.

  A covered module's namespace read with a COMPUTED name (``getattr(metrics, name)``,
  ``vars(metrics)[name]``) or handed on as a value (``ns = metrics.__dict__``) is RED:
  it cannot be proven not to reach the alias. That closes round 1's one recorded
  limit.

KNOWN LIMITS, RECORDED (review round 2, WR-03 / SFH R2-LOW-4). A static walk cannot
follow a value through data flow it does not model. Each shape below reaches a
covered module's quantstats alias with ``nodes=0, violations=[]``; none exists in the
tree today (measured 2026-09-25: no production module uses ``__dict__`` of a covered
module, ``globals()``, ``vars()``, ``import_module``, ``__import__``, ``eval`` or
``exec``):

1. the module object passed through a value the walk does not follow: a function
   parameter or return value (``def f(m): return m.qs``), a container element
   (``[metrics][0].qs``), an object attribute (``self.m = metrics``), a ``for`` or
   ``with`` target, a starred or augmented assignment, or a default argument;
2. attribute access by anything other than ``getattr`` or ``.``:
   ``operator.attrgetter("qs")(metrics)``, ``metrics.__getattribute__("qs")``,
   ``object.__getattribute__(metrics, "qs")``, ``inspect.getmembers(metrics)``,
   ``inspect.getattr_static(metrics, "qs")``;
3. a module located by anything other than an import statement, ``import_module`` /
   ``__import__`` with a constant ABSOLUTE name, or ``sys.modules[<constant or
   __name__>]``: a relative ``import_module(".metrics", package="services")``,
   ``pkgutil.resolve_name("services.metrics:qs")``, ``runpy``, or a spec built by
   ``importlib.util`` and executed;
4. source text run at run time: ``eval``, ``exec``, ``compile`` (in ANY module,
   covered ones included: ``eval("qs.stats.sharpe(r)")`` is invisible to every rule).

WHY ``KWARG_PROVEN`` IS A SET OF LEAF FUNCTIONS, NOT A KEYWORD CHECK
--------------------------------------------------------------------
Phase 159 measured that ``cvar`` advertises ``prepare_returns=`` and does not honour
it transitively; research Q2 found the same for ``payoff_ratio``, ``win_loss_ratio``,
every dispatched scalar and every benchmark leg. A keyword on a function that does
not forward it closes nothing. So only named LEAF functions are allowlisted, and each
membership is pinned by a behavioural preparer-spy test (plan 166-08, parametrized
over ``sorted(KWARG_PROVEN)`` so an allowlisted leaf with no pin cannot exist).
``test_qstats_gate_kwarg_allowlist_is_not_stale`` holds the set equal to the leaves
the code actually calls.
"""

from __future__ import annotations

import ast
import os
from pathlib import Path
from typing import NamedTuple

SERVICE_ROOT = Path(__file__).resolve().parent.parent

#: Directory names never scanned: the test tree, virtualenvs, caches, vendored deps.
EXCLUDED_DIRS = frozenset(
    {"tests", ".venv", "venv", "__pycache__", "node_modules", "site-packages"}
)

#: The production modules allowed to import quantstats. Repo-relative to SERVICE_ROOT.
COVERED_MODULES = frozenset({"services/metrics.py"})

#: quantstats 0.0.81 LEAF functions whose ``prepare_returns=False`` is honoured all the
#: way down (research Q2 preparer-spy matrix). Held equal to the leaves the code calls.
KWARG_PROVEN = frozenset(
    {
        "volatility",
        "value_at_risk",
        "tail_ratio",
        "profit_factor",
        "win_rate",
        "avg_win",
        "avg_loss",
    }
)

#: Called WITHOUT the keyword on purpose. The one exemption (D-07).
EXEMPT: dict[str, str] = {
    "drawdown_details": (
        "consumes the drawdown curve, never a returns series; pinned by "
        "test_rank05_drawdown_details_is_heuristic_free"
    ),
}

#: quantstats functions the service no longer calls: replaced by an inline mirror in
#: services/metrics.py (0.0.81 minus the price guess). quantstats name -> (mirror, why).
MIRRORED: dict[str, tuple[str, str]] = {
    "recovery_factor": (
        "_recovery_factor",
        "max_drawdown (which runs _prepare_prices) is called without the kwarg",
    ),
    "ulcer_index": ("_ulcer_index", "no prepare_returns kwarg; to_drawdown_series guesses"),
    "ulcer_performance_index": (
        "_ulcer_performance_index",
        "no prepare_returns kwarg; ulcer_index and comp guess",
    ),
    "kelly_criterion": (
        "_kelly_criterion",
        "payoff_ratio/win_rate called without forwarding the kwarg",
    ),
    "probabilistic_ratio": (
        "_probabilistic_sharpe_ratio",
        "no prepare_returns kwarg; also D-16 non-excess kurtosis fix",
    ),
    "common_sense_ratio": (
        "_common_sense_ratio",
        "profit_factor/tail_ratio called without forwarding the kwarg",
    ),
    "cpc_index": (
        "_cpc_index",
        "profit_factor/win_rate/win_loss_ratio called without forwarding the kwarg",
    ),
    "serenity_index": (
        "_serenity_index",
        "no prepare_returns kwarg; to_drawdown_series and cvar guess",
    ),
    "r_squared": ("_r_squared", "benchmark leg runs _prepare_benchmark unconditionally"),
    "greeks": (
        "_greeks_no_guess",
        "benchmark leg runs _prepare_benchmark unconditionally; D-15 pairwise, None not 0.0",
    ),
    "rolling_greeks": (
        "_rolling_greeks",
        "benchmark leg runs _prepare_benchmark unconditionally; D-17 windowed alpha intercept",
    ),
}

#: Violation shapes that describe an IMPORT statement, not a use of the namespace.
#: They are not counted as scanned quantstats nodes.
IMPORT_SHAPES = frozenset(
    {"uncovered importer", "from-import", "non-stats import", "re-export import"}
)

#: The dotted module name of each covered module (``services/metrics.py`` ->
#: ``services.metrics``), for Rule A'.
COVERED_DOTTED = frozenset(m[: -len(".py")].replace("/", ".") for m in COVERED_MODULES)

#: Calls whose first argument names a module to import at run time (Rule B6).
DYNAMIC_IMPORTERS = frozenset({"import_module", "__import__"})

#: Builtins that expose a namespace as a dict, so ``globals()["qs"]`` reaches an alias.
NAMESPACE_DICTS = frozenset({"globals", "vars", "locals"})

#: Phase-start measurement (166-RESEARCH P-2), kept beside the live counts so the
#: success criterion's "30" is answered, not silently re-counted.
PHASE_START_TEXT_OCCURRENCES = 30
PHASE_START_AST_NODES = 9


class Violation(NamedTuple):
    module: str
    function: str
    qs_name: str
    shape: str
    lineno: int
    reason: str


class CensusRow(NamedTuple):
    module: str
    function: str
    qs_name: str
    shape: str
    arm: str
    reason: str


def scanned_files(root: Path = SERVICE_ROOT) -> list[Path]:
    """Every production ``*.py`` under ``root``; excluded and hidden directories pruned."""
    found: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            d for d in dirnames if d not in EXCLUDED_DIRS and not d.startswith(".")
        )
        for name in sorted(filenames):
            if name.endswith(".py"):
                found.append(Path(dirpath) / name)
    return sorted(found)


def _enclosing_function_resolver(tree: ast.AST) -> dict[ast.AST, str]:
    """Map every node to its innermost enclosing function name (``<module>`` at top).

    Copied from ``tests/test_raw_5xx_census.py``: sites key on the function NAME,
    never a line number.
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


def _parent_map(tree: ast.AST) -> dict[ast.AST, ast.AST]:
    parent: dict[ast.AST, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parent[child] = node
    return parent


def _is_quantstats(module: str | None) -> bool:
    return module is not None and (module == "quantstats" or module.startswith("quantstats."))


def _module_level_tables(tree: ast.Module) -> dict[str, ast.expr]:
    """Module-level ``NAME = <tuple/list literal>`` (plain or annotated) assignments."""
    tables: dict[str, ast.expr] = {}
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and isinstance(stmt.value, (ast.Tuple, ast.List)):
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    tables[target.id] = stmt.value
        elif (
            isinstance(stmt, ast.AnnAssign)
            and isinstance(stmt.target, ast.Name)
            and isinstance(stmt.value, (ast.Tuple, ast.List))
        ):
            tables[stmt.target.id] = stmt.value
    return tables


def _dispatched_names(
    name: str, call: ast.Call, parent: dict[ast.AST, ast.AST], tables: dict[str, ast.expr]
) -> list[str]:
    """Resolve a getattr's loop-variable second argument to the table's string entries."""
    cursor: ast.AST | None = parent.get(call)
    while cursor is not None:
        if isinstance(cursor, (ast.For, ast.AsyncFor)) and isinstance(cursor.iter, ast.Name):
            table = tables.get(cursor.iter.id)
            if table is not None and isinstance(table, (ast.Tuple, ast.List)):
                target = cursor.target
                if isinstance(target, ast.Name) and target.id == name:
                    return [
                        e.value
                        for e in table.elts
                        if isinstance(e, ast.Constant) and isinstance(e.value, str)
                    ]
                if isinstance(target, ast.Tuple):
                    idx = next(
                        (
                            i
                            for i, t in enumerate(target.elts)
                            if isinstance(t, ast.Name) and t.id == name
                        ),
                        None,
                    )
                    if idx is not None:
                        out: list[str] = []
                        for e in table.elts:
                            if isinstance(e, (ast.Tuple, ast.List)) and idx < len(e.elts):
                                item = e.elts[idx]
                                if isinstance(item, ast.Constant) and isinstance(item.value, str):
                                    out.append(item.value)
                        return out
        cursor = parent.get(cursor)
    return []


def quantstats_bindings(source: str) -> frozenset[str]:
    """The module-level names a module binds to quantstats (``qs``, a stats alias, ...).

    Rule A' reads these from each covered module, so the re-export check follows
    the alias the covered module really uses instead of a hard-coded ``"qs"``.
    """
    bound: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if _is_quantstats(alias.name):
                    bound.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and _is_quantstats(node.module):
            for alias in node.names:
                bound.add(alias.asname or alias.name)
    return frozenset(bound)


def covered_bindings(root: Path = SERVICE_ROOT) -> frozenset[str]:
    """Union of ``quantstats_bindings`` over the covered modules present under ``root``."""
    names: set[str] = set()
    for module in COVERED_MODULES:
        path = root / module
        if path.is_file():
            names |= quantstats_bindings(path.read_text(encoding="utf-8"))
    return frozenset(names)


def _dotted(node: ast.AST) -> list[str] | None:
    """``a.b.c`` as ``["a", "b", "c"]`` for a pure Name/Attribute chain, else None."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return parts[::-1]


def _namespace_read_by_constant(call: ast.Call, parent: dict[ast.AST, ast.AST]) -> bool:
    """True when a namespace-dict call (``globals()``) is only read by a CONSTANT key.

    ``globals()["x"]`` and ``globals().get("x")`` qualify. A computed key, or the
    dict handed on as a value (``ns = globals()``, ``f(vars())``), does not.
    """
    par = parent.get(call)
    if isinstance(par, ast.Subscript) and par.value is call:
        return isinstance(par.slice, ast.Constant)
    if isinstance(par, ast.Attribute) and par.value is call and par.attr == "get":
        get_call = parent.get(par)
        return (
            isinstance(get_call, ast.Call)
            and get_call.func is par
            and bool(get_call.args)
            and isinstance(get_call.args[0], ast.Constant)
        )
    return False


def _resolve_from(module_name: str, node: ast.ImportFrom) -> str:
    """The absolute dotted module an ``ImportFrom`` reads, relative levels resolved."""
    if not node.level:
        return node.module or ""
    package = module_name[: -len(".py")].split("/")[:-1]
    base = package[: len(package) - (node.level - 1)] if node.level > 1 else package
    return ".".join(base + (node.module.split(".") if node.module else []))


def scan_source(
    module_name: str, source: str, reexported: frozenset[str] | None = None
) -> tuple[list[Violation], list[CensusRow], int]:
    """Judge one module's source. Returns (violations, census rows, scanned node count).

    ``scanned`` counts every USE of quantstats (namespace attribute, getattr on it,
    bare namespace reference, utils/preparer reference, any other quantstats
    surface, string-named access, a re-exported alias). Import statements are judged
    (Rule A, from-imports, Rule A' re-export imports) but are not uses, so they are
    not counted.

    ``reexported`` is the set of quantstats names bound in the covered modules
    (Rule A'). ``None`` reads it from the real covered modules under SERVICE_ROOT.
    """
    if reexported is None:
        reexported = covered_bindings(SERVICE_ROOT)
    tree = ast.parse(source, filename=module_name)
    enclosing = _enclosing_function_resolver(tree)
    parent = _parent_map(tree)
    tables = _module_level_tables(tree)

    violations: list[Violation] = []
    placed: list[tuple[int, int, CensusRow]] = []
    scanned = 0

    qs_aliases: set[str] = set()
    stats_aliases: set[str] = set()
    utils_aliases: set[str] = set()
    imports_quantstats = False
    first_import_line = 0

    def violate(node: ast.AST, qs_name: str, shape: str, reason: str) -> None:
        violations.append(
            Violation(
                module_name,
                enclosing.get(node, "<module>"),
                qs_name,
                shape,
                getattr(node, "lineno", 0),
                reason,
            )
        )

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if not _is_quantstats(alias.name):
                    continue
                imports_quantstats = True
                first_import_line = first_import_line or node.lineno
                if alias.asname is None:
                    # `import quantstats` / `import quantstats.stats` bind `quantstats`.
                    qs_aliases.add("quantstats")
                elif alias.name == "quantstats":
                    qs_aliases.add(alias.asname)
                elif alias.name == "quantstats.stats":
                    stats_aliases.add(alias.asname)
                elif alias.name in ("quantstats.utils", "quantstats._utils"):
                    utils_aliases.add(alias.asname)
                    violate(node, alias.name, "from-import", "imports the quantstats preparers")
                else:
                    violate(
                        node,
                        alias.name,
                        "non-stats import",
                        f"import {alias.name} as {alias.asname}: only the stats namespace "
                        "is judged, and this one runs the preparers out of the gate's sight",
                    )
        elif isinstance(node, ast.ImportFrom) and _is_quantstats(node.module):
            imports_quantstats = True
            first_import_line = first_import_line or node.lineno
            for alias in node.names:
                bound = alias.asname or alias.name
                if node.module == "quantstats" and alias.name == "stats":
                    stats_aliases.add(bound)
                elif node.module == "quantstats" and alias.name in ("utils", "_utils"):
                    utils_aliases.add(bound)
                    violate(node, alias.name, "from-import", "imports the quantstats preparers")
                elif node.module in ("quantstats.stats", "quantstats.utils", "quantstats._utils"):
                    violate(
                        node,
                        alias.name,
                        "from-import",
                        f"from {node.module} import {alias.name} hides the call from the gate",
                    )
                elif alias.name.startswith("_prepare_"):
                    violate(node, alias.name, "from-import", "imports a quantstats preparer")
                elif alias.name == "*":
                    violate(
                        node,
                        "*",
                        "from-import",
                        f"a star import from {node.module} binds quantstats names the "
                        "gate cannot see",
                    )
                else:
                    violate(
                        node,
                        alias.name,
                        "from-import",
                        f"from {node.module} import {alias.name}: only the stats namespace "
                        "is judged, and this one runs the preparers out of the gate's sight",
                    )

    if imports_quantstats and module_name not in COVERED_MODULES:
        violations.append(
            Violation(
                module_name,
                "<module>",
                "quantstats",
                "uncovered importer",
                first_import_line,
                "imports quantstats but is not in COVERED_MODULES",
            )
        )

    # Module-object resolution (Rule A' and B6, review round 2 WR-03 / SFH
    # R2-LOW-4). ``module_aliases`` maps a local name to the dotted paths it may
    # hold: imports, module-level defs (``<module>.<name>``, so a function's
    # ``__globals__`` is known to be its module's namespace), and every plain
    # ``name = <resolvable expr>`` assignment, followed to a fixpoint. Flow- and
    # scope-insensitive on purpose: a name that MAY hold a covered module is
    # treated as holding it (fail closed).
    own_dotted = module_name[: -len(".py")].replace("/", ".")
    module_aliases: dict[str, set[str]] = {}

    def bind(name: str, paths: set[str]) -> bool:
        before = module_aliases.setdefault(name, set())
        grown = paths - before
        before |= grown
        return bool(grown)

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    bind(alias.asname, {alias.name})
                else:
                    root_name = alias.name.split(".")[0]
                    bind(root_name, {root_name})
        elif isinstance(node, ast.ImportFrom):
            source_module = _resolve_from(module_name, node)
            for alias in node.names:
                if alias.name != "*":
                    bind(
                        alias.asname or alias.name,
                        {f"{source_module}.{alias.name}" if source_module else alias.name},
                    )
    for stmt in tree.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bind(stmt.name, {f"{own_dotted}.{stmt.name}"})

    def ns_owner(path: str) -> str | None:
        """The module whose namespace dict ``path`` names, or None."""
        if path.endswith(".__dict__"):
            return path[: -len(".__dict__")]
        if path.endswith(".__globals__"):
            function = path[: -len(".__globals__")]
            covered = [c for c in COVERED_DOTTED if function.startswith(c + ".")]
            return max(covered, key=len) if covered else function.rsplit(".", 1)[0]
        return None

    def const_key(expr: ast.AST | None) -> str | None:
        if isinstance(expr, ast.Constant) and isinstance(expr.value, str):
            return expr.value
        if isinstance(expr, ast.Name) and expr.id == "__name__":
            return own_dotted
        return None

    def resolve(expr: ast.AST, depth: int = 0) -> set[str]:
        """The dotted paths ``expr`` may evaluate to, for module-shaped expressions."""
        if depth > 50:
            return set()
        if isinstance(expr, ast.Name):
            return set(module_aliases.get(expr.id, ()))
        if isinstance(expr, ast.Attribute):
            return {f"{p}.{expr.attr}" for p in resolve(expr.value, depth + 1)}
        if isinstance(expr, ast.NamedExpr):
            return resolve(expr.value, depth + 1)
        if isinstance(expr, ast.Subscript):
            key = const_key(expr.slice)
            if key is None:
                return set()
            out: set[str] = set()
            for p in resolve(expr.value, depth + 1):
                if p == "sys.modules":
                    out.add(key)
                owner = ns_owner(p)
                if owner is not None:
                    out.add(f"{owner}.{key}")
            return out
        if isinstance(expr, ast.Call):
            func = expr.func
            fname = (
                func.id if isinstance(func, ast.Name)
                else func.attr if isinstance(func, ast.Attribute) else ""
            )
            first = expr.args[0] if expr.args else None
            if fname == "import_module":
                key = const_key(first)
                return {key} if key else set()
            if fname == "__import__":
                key = const_key(first)
                return {key.split(".")[0], key} if key else set()
            if fname == "getattr" and isinstance(func, ast.Name) and len(expr.args) > 1:
                key = const_key(expr.args[1])
                if key is None or first is None:
                    return set()
                return {f"{p}.{key}" for p in resolve(first, depth + 1)}
            if fname == "vars" and isinstance(func, ast.Name) and len(expr.args) == 1:
                return {f"{p}.__dict__" for p in resolve(expr.args[0], depth + 1)}
            if fname == "get" and isinstance(func, ast.Attribute):
                key = const_key(first)
                if key is None:
                    return set()
                owners = {ns_owner(p) for p in resolve(func.value, depth + 1)}
                return {f"{o}.{key}" for o in owners if o is not None}
        return set()

    # Propagate plain aliases (`m = services.metrics`, `d = vars(metrics)`,
    # `a, b = metrics, x`, `(m := metrics)`) to a fixpoint.
    changed = True
    while changed:
        changed = False
        for node in ast.walk(tree):
            pairs: list[tuple[ast.AST, ast.AST]] = []
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if (
                        isinstance(target, (ast.Tuple, ast.List))
                        and isinstance(node.value, (ast.Tuple, ast.List))
                        and len(target.elts) == len(node.value.elts)
                    ):
                        pairs.extend(zip(target.elts, node.value.elts))
                    else:
                        pairs.append((target, node.value))
            elif isinstance(node, (ast.AnnAssign, ast.NamedExpr)) and node.value is not None:
                pairs.append((node.target, node.value))
            for target, value in pairs:
                if isinstance(target, ast.Name):
                    paths = resolve(value)
                    if paths and bind(target.id, paths):
                        changed = True

    def is_qs(node: ast.AST) -> bool:
        return isinstance(node, ast.Name) and node.id in qs_aliases

    def is_stats_ns(node: ast.AST) -> bool:
        if isinstance(node, ast.Name):
            return node.id in stats_aliases
        return isinstance(node, ast.Attribute) and node.attr == "stats" and is_qs(node.value)

    def roots_at_quantstats(node: ast.AST) -> bool:
        while isinstance(node, ast.Attribute):
            node = node.value
        return isinstance(node, ast.Name) and (
            node.id in qs_aliases or node.id in stats_aliases or node.id in utils_aliases
        )

    handled: set[int] = set()

    # B3 first: getattr over the namespace consumes its first argument.
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "getattr"
            and node.args
            and (is_stats_ns(node.args[0]) or is_qs(node.args[0]))
        ):
            scanned += 1
            handled.add(id(node.args[0]))
            dispatched: list[str] = []
            if len(node.args) > 1:
                arg = node.args[1]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    dispatched = [arg.value]
                elif isinstance(arg, ast.Name):
                    dispatched = _dispatched_names(arg.id, node, parent, tables)
            names = ", ".join(dispatched) if dispatched else "unresolved"
            violate(
                node,
                "getattr",
                "attribute dispatch",
                f"getattr over the quantstats namespace dispatches: {names}",
            )

    for node in ast.walk(tree):
        # B4: utils / preparer references.
        if isinstance(node, ast.Attribute) and (
            (node.attr in ("utils", "_utils") and (is_qs(node.value) or is_stats_ns(node.value)))
            or (node.attr.startswith("_prepare_") and roots_at_quantstats(node.value))
        ):
            scanned += 1
            handled.add(id(node.value))
            violate(node, node.attr, "preparer reference", "reaches the quantstats preparers")
            continue
        if isinstance(node, ast.Name) and node.id in utils_aliases:
            scanned += 1
            violate(node, node.id, "preparer reference", "reaches the quantstats preparers")
            continue

        if isinstance(node, ast.Attribute) and is_stats_ns(node.value):
            handled.add(id(node.value))
            scanned += 1
            name = node.attr
            call = parent.get(node)
            if not (isinstance(call, ast.Call) and call.func is node):
                violate(
                    node,
                    name,
                    "aliased reference",
                    "a quantstats function referenced without being called here; "
                    "the call it later makes is invisible to the gate",
                )
                continue
            func_name = enclosing.get(node, "<module>")
            if name in EXEMPT:
                placed.append(
                    (
                        call.lineno,
                        call.col_offset,
                        CensusRow(module_name, func_name, name, "call", "exempt", EXEMPT[name]),
                    )
                )
                continue
            if name not in KWARG_PROVEN:
                violate(
                    call,
                    name,
                    "call",
                    "not a kwarg-proven leaf; prepare_returns=False is not honoured "
                    "transitively (or the function has no such keyword)",
                )
                continue
            if any(kw.arg is None for kw in call.keywords):
                violate(call, name, "call", "**kwargs splat: prepare_returns cannot be proven")
                continue
            kw = next((k for k in call.keywords if k.arg == "prepare_returns"), None)
            if kw is None:
                violate(call, name, "call", "missing prepare_returns=False")
                continue
            if not (isinstance(kw.value, ast.Constant) and kw.value.value is False):
                violate(call, name, "call", "prepare_returns is not the constant False")
                continue
            placed.append(
                (
                    call.lineno,
                    call.col_offset,
                    CensusRow(
                        module_name,
                        func_name,
                        name,
                        "call",
                        "kwarg-proven",
                        "prepare_returns=False on a leaf that honours it",
                    ),
                )
            )

    # B2 for the namespace itself: `ns = qs.stats`, `f(qs.stats)`, a bare stats alias.
    for node in ast.walk(tree):
        if id(node) in handled or not is_stats_ns(node):
            continue
        if isinstance(parent.get(node), ast.Attribute):
            continue
        scanned += 1
        violate(
            node,
            "stats",
            "aliased reference",
            "the quantstats stats namespace escapes as a value; its calls are invisible",
        )

    # B5: fail closed on any quantstats alias use that is not `<qs>.stats` and was
    # not already judged (getattr's first argument, `<qs>.utils`).
    for node in ast.walk(tree):
        if not is_qs(node) or id(node) in handled:
            continue
        par = parent.get(node)
        if isinstance(par, ast.Attribute) and par.value is node and par.attr == "stats":
            continue
        scanned += 1
        assert isinstance(node, ast.Name)
        if isinstance(par, ast.Attribute):
            surface = par.attr
        elif isinstance(par, ast.Call) and isinstance(par.func, ast.Name) and node in par.args:
            surface = f"{par.func.id}()"
        else:
            surface = node.id
        detail = (
            "monkeypatches every guessing stats function onto pandas, so each later "
            "call is invisible"
            if surface == "extend_pandas"
            else "runs the quantstats preparers out of the gate's sight"
        )
        violate(
            node,
            surface,
            "non-stats namespace",
            f"quantstats reached outside qs.stats ({surface}): {detail}",
        )

    # B6: string-named access to quantstats, and dynamic imports it cannot rule out.
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            fname = (
                func.id
                if isinstance(func, ast.Name)
                else func.attr if isinstance(func, ast.Attribute) else ""
            )
            first = node.args[0] if node.args else None
            first_str = (
                first.value
                if isinstance(first, ast.Constant) and isinstance(first.value, str)
                else None
            )
            if first_str is not None and _is_quantstats(first_str):
                scanned += 1
                violate(
                    node,
                    first_str,
                    "string-named access",
                    f"{fname or 'a call'}({first_str!r}) reaches quantstats by name, "
                    "out of the gate's sight",
                )
            elif fname in DYNAMIC_IMPORTERS and first_str is None:
                scanned += 1
                violate(
                    node,
                    fname,
                    "string-named access",
                    f"{fname}() with a computed module name cannot be proven not to load "
                    "quantstats",
                )
            elif (
                fname in NAMESPACE_DICTS
                and isinstance(func, ast.Name)
                and isinstance(parent.get(node), (ast.Subscript, ast.Attribute))
            ):
                par = parent.get(node)
                key: object = None
                if isinstance(par, ast.Subscript) and isinstance(par.slice, ast.Constant):
                    key = par.slice.value
                elif isinstance(par, ast.Attribute) and par.attr == "get":
                    call = parent.get(par)
                    if (
                        isinstance(call, ast.Call)
                        and call.args
                        and isinstance(call.args[0], ast.Constant)
                    ):
                        key = call.args[0].value
                if key in (qs_aliases | stats_aliases | utils_aliases):
                    scanned += 1
                    violate(
                        node,
                        f"{fname}()",
                        "string-named access",
                        f"{fname}()[{key!r}] reaches a quantstats alias by name, out of "
                        "the gate's sight",
                    )
            # Review round 2 (SFH R2-LOW-4): in a module that binds quantstats, a
            # namespace dict read with a COMPUTED key (`globals()["q" + "s"]`) or
            # handed on as a value (`ns = globals()`) cannot be proven not to
            # reach an alias.
            if (
                fname in NAMESPACE_DICTS
                and isinstance(func, ast.Name)
                and not node.args
                and (qs_aliases or stats_aliases or utils_aliases)
                and not _namespace_read_by_constant(node, parent)
            ):
                scanned += 1
                violate(
                    node,
                    f"{fname}()",
                    "string-named access",
                    f"{fname}() read with a computed key, or passed on as a value, in a "
                    "module that binds quantstats: it cannot be proven not to reach the alias",
                )
        elif (
            isinstance(node, ast.Subscript)
            and isinstance(node.slice, ast.Constant)
            and isinstance(node.slice.value, str)
            and _is_quantstats(node.slice.value)
        ):
            scanned += 1
            violate(
                node,
                node.slice.value,
                "string-named access",
                f"[{node.slice.value!r}] reaches quantstats by name (sys.modules), out of "
                "the gate's sight",
            )

    # Rule A': a covered module's quantstats alias reached THROUGH THE MODULE
    # OBJECT. In an uncovered module that is a borrowed alias (the gate does not
    # judge the module). In a covered module it is a self-reference
    # (`getattr(sys.modules[__name__], "qs")`, `f.__globals__["qs"]`) that the
    # B rules, which judge the bare alias name, cannot see. Review round 2
    # (WR-03 / SFH R2-LOW-4) widened the shapes from dotted names and
    # `getattr` to everything ``resolve`` follows.
    covered_module = module_name in COVERED_MODULES
    bindings = reexported | qs_aliases | stats_aliases | utils_aliases
    where = (
        "through the module object, out of the gate's sight"
        if covered_module
        else "from an uncovered module; the gate does not judge this module"
    )
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            source_module = _resolve_from(module_name, node)
            for alias in node.names:
                if source_module in COVERED_DOTTED and (
                    alias.name == "*" or alias.name in bindings
                ):
                    violate(
                        node,
                        alias.name,
                        "re-export import",
                        f"from {source_module} import {alias.name} borrows a covered "
                        "module's quantstats alias; the gate does not judge this module",
                    )

    def covered_namespace(paths: set[str]) -> bool:
        return any(
            (owner := ns_owner(p)) is not None and owner in COVERED_DOTTED for p in paths
        )

    if bindings:
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Attribute, ast.Subscript, ast.Call, ast.Name)):
                continue
            if isinstance(node, ast.Name) and not isinstance(node.ctx, ast.Load):
                continue
            paths = resolve(node)
            hits = sorted(
                p.rsplit(".", 1)[1]
                for p in paths
                if "." in p
                and p.rsplit(".", 1)[0] in COVERED_DOTTED
                and p.rsplit(".", 1)[1] in bindings
            )
            if hits and not isinstance(node, ast.Name):
                scanned += 1
                violate(
                    node,
                    hits[0],
                    "re-export",
                    f"reaches the covered module's quantstats alias {hits[0]!r} {where}",
                )
                continue
            par = parent.get(node)
            computed = False
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "getattr"
                and len(node.args) > 1
                and const_key(node.args[1]) is None
                and any(p in COVERED_DOTTED for p in resolve(node.args[0]))
            ):
                computed = True
            elif covered_namespace(paths):
                get_call = parent.get(par) if isinstance(par, ast.Attribute) else None
                if isinstance(par, ast.Subscript) and par.value is node:
                    computed = const_key(par.slice) is None
                elif (
                    isinstance(par, ast.Attribute)
                    and par.attr == "get"
                    and isinstance(get_call, ast.Call)
                    and get_call.func is par
                ):
                    computed = const_key(get_call.args[0] if get_call.args else None) is None
                else:
                    computed = True
            if computed:
                scanned += 1
                violate(
                    node,
                    "<computed>",
                    "re-export",
                    "a covered module's namespace is read with a computed name, or handed "
                    f"on as a value, so it cannot be proven not to reach its quantstats alias "
                    f"{where}",
                )

    violations.sort(key=lambda v: v.lineno)
    census = [row for _line, _col, row in sorted(placed, key=lambda t: (t[0], t[1]))]
    return violations, census, scanned


def _module_name(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def scan_tree(
    root: Path = SERVICE_ROOT,
) -> tuple[list[Violation], list[CensusRow], int, frozenset[str]]:
    """Scan every production module. Returns (violations, census, nodes, importers found)."""
    violations: list[Violation] = []
    census: list[CensusRow] = []
    nodes = 0
    importers: set[str] = set()
    reexported = covered_bindings(root)
    for path in scanned_files(root):
        source = path.read_text(encoding="utf-8")
        module = _module_name(path, root)
        tree = ast.parse(source, filename=module)
        if any(
            (isinstance(n, ast.Import) and any(_is_quantstats(a.name) for a in n.names))
            or (isinstance(n, ast.ImportFrom) and _is_quantstats(n.module))
            for n in ast.walk(tree)
        ):
            importers.add(module)
        v, c, s = scan_source(module, source, reexported)
        violations.extend(v)
        census.extend(c)
        nodes += s
    return violations, census, nodes, frozenset(importers)


#: The one module whose text the reconciliation line counts (D-07, research P-2).
RECONCILED_MODULE = "services/metrics.py"


def mirror_rows(root: Path = SERVICE_ROOT) -> list[CensusRow]:
    """One ``inline`` census row per ``MIRRORED`` entry, verified against the real module.

    The arm is ``inline`` only when the mirror is a module-level function of
    ``services/metrics.py``; a renamed or deleted mirror is printed as ``MISSING``
    (and ``test_qstats_gate_census_accounts_for_every_node`` turns RED on it).
    """
    tree = ast.parse((root / RECONCILED_MODULE).read_text(encoding="utf-8"))
    defined = {n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    return [
        CensusRow(
            RECONCILED_MODULE,
            mirror,
            qs_name,
            "mirror",
            "inline" if mirror in defined else "MISSING",
            reason,
        )
        for qs_name, (mirror, reason) in sorted(MIRRORED.items())
    ]


def census_lines(root: Path = SERVICE_ROOT) -> list[str]:
    """The lines ``pytest_terminal_summary`` writes on every run, green or red (D-07).

    Header, one row per quantstats node, one row per mirror, any violations, then the
    30-vs-9 reconciliation. A pure function of source text, so the xdist controller
    computes it directly with no worker aggregation.
    """
    violations, census, nodes, importers = scan_tree(root)
    mirrors = mirror_rows(root)
    rows = census + mirrors
    arms = {arm: sum(r.arm == arm for r in rows) for arm in ("kwarg-proven", "exempt", "inline")}
    lines = [
        "qstats-gate census: "
        f"{nodes} quantstats node(s) in {', '.join(sorted(importers)) or 'NO module'}, "
        f"{len(mirrors)} mirror(s), {len(violations)} violation(s); "
        f"arms kwarg-proven={arms['kwarg-proven']} exempt={arms['exempt']} "
        f"inline={arms['inline']}"
    ]
    lines.extend(
        f"  {r.module} | {r.function} | {r.qs_name} | {r.shape} | {r.arm} | {r.reason}"
        for r in rows
    )
    lines.extend(
        f"  VIOLATION {v.module}:{v.function}:{v.qs_name}:{v.lineno} | {v.shape} | {v.reason}"
        for v in violations
    )
    text = (root / RECONCILED_MODULE).read_text(encoding="utf-8")
    module_nodes = scan_source(RECONCILED_MODULE, text)[2]
    lines.append(
        "qstats-gate reconciliation: "
        f"{RECONCILED_MODULE} has {text.count('qs.stats.')} text occurrence(s) of "
        f"'qs.stats.' vs {module_nodes} AST quantstats node(s); the text count "
        "includes comments and docstrings, which cannot call anything "
        f"(phase start: {PHASE_START_TEXT_OCCURRENCES} vs {PHASE_START_AST_NODES})"
    )
    return lines


def safe_census_lines(root: Path = SERVICE_ROOT) -> list[str]:
    """``census_lines`` for the ``pytest_terminal_summary`` hook, which must never raise.

    Review IN-06: ``census_lines`` parses every production ``*.py`` on every pytest
    run. One half-written or non-UTF-8 file made the terminal-summary hook raise,
    which turns the whole session into an INTERNALERROR and hides the real test
    outcome behind a census stack trace. Here that failure becomes one NAMED line
    instead. The gate itself still fails loudly: ``tests/test_qstats_gate.py`` runs
    the same ``scan_tree`` inside tests, where a parse failure is an ordinary
    test failure.
    """
    try:
        return census_lines(root)
    except Exception as exc:  # noqa: BLE001 - reported, never swallowed
        return [
            f"qstats-gate census: FAILED TO BUILD ({exc!r}); the gate tests in "
            "tests/test_qstats_gate.py fail on the same cause"
        ]
