"""The parity engine reaches no database, gateway or network, and states its tolerance once.

Why these tests exist: the harness is the thing that decides whether our MT5 numbers are
right, so it must not be able to read what it is judging from the place that produced
it, nor reach the broker. Purity is therefore a property of the import CLOSURE, not of
one file: ``services/mt5_parity*.py`` import siblings, those import ``services.*``, and
any hop that lands on ``mt5_client``, ``db`` or a socket would break the rule. The scan
uses ``ast.walk`` so an import tucked inside a function body counts. The D-B tolerance
has exactly one definition (``MT5_PARITY_TOLERANCE``); a second copy of the number in
the engine, or a restated one in a test, is how two comparisons end up disagreeing.

Each scanner is shown able to fail on a fake package, and the closure is shown to reach
the modules the engine is known to rest on (anti-vacuity). Read by path and parsed:
nothing here imports the modules it scans. No network, no reload, no subprocess.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

from services.mt5_parity import MT5_PARITY_TOLERANCE

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SERVICES = SERVICE_ROOT / "services"
TESTS = SERVICE_ROOT / "tests"

FORBIDDEN_INTERNAL = frozenset(
    {
        "services.mt5_client",
        "services.mt5_read",
        "services.mt5_probe",
        "services.mt5_concurrency",
        "services.db",
        "services.nav_marks",
        "services.allocator_equity_derive",
    }
)
FORBIDDEN_EXTERNAL = frozenset(
    {
        "supabase",
        "postgrest",
        "httpx",
        "aiohttp",
        "ccxt",
        "mt5linux",
        "rpyc",
        "socket",
        "subprocess",
        "requests",
    }
)
_INTERNAL_ROOTS = ("services", "scripts")
# A relative import is recorded under this name: it cannot be resolved by the scan, so
# its presence is itself a failure.
_RELATIVE = ".relative"


# ----------------------------------------------------------------- the closure scan


def _module_file(root: Path, name: str) -> Path | None:
    """The file a dotted internal name resolves to, or None for an attribute."""
    base = root / name.replace(".", "/")
    if base.with_suffix(".py").is_file():
        return base.with_suffix(".py")
    if (base / "__init__.py").is_file():
        return base / "__init__.py"
    return None


def _imports_of(path: Path) -> tuple[list[str], set[str]]:
    """(internal candidate names, external top-level names) for one file. Every
    ``ast.walk`` node counts, so an import inside a function body is seen."""
    internal: list[str] = []
    external: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        names: list[str] = []
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                external.add(_RELATIVE)
                continue
            if node.module is None:
                continue
            # ``from services import mt5_client`` imports a MODULE: test it as a name too.
            names = [node.module] + [f"{node.module}.{alias.name}" for alias in node.names]
        for name in names:
            top = name.split(".")[0]
            if top in _INTERNAL_ROOTS:
                internal.append(name)
            elif top != "__future__":
                external.add(top)
    return internal, external


def closure(root: Path, starts: list[str]) -> tuple[set[str], set[str]]:
    """The internal modules reachable from ``starts`` and every external top-level
    package they import, following ``services.*`` and ``scripts.*`` only."""
    seen: set[str] = set()
    external: set[str] = set()
    stack = list(starts)
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        path = _module_file(root, name)
        if path is None:
            continue  # an attribute of a module already followed, not a module
        seen.add(name)
        internal, ext = _imports_of(path)
        external |= ext
        stack.extend(internal)
    return seen, external


def _engine_modules() -> list[str]:
    return sorted(f"services.{p.stem}" for p in SERVICES.glob("mt5_parity*.py"))


# ------------------------------------------------------------ the float-literal count


def count_float_literal(source: str, value: float) -> int:
    """How many float ``Constant`` nodes in ``source`` equal ``value``. Comments and
    string contents are invisible to ``ast``, which is the point."""
    return sum(
        1
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Constant)
        and isinstance(node.value, float)
        and not isinstance(node.value, bool)
        and node.value == value
    )


def _literal_sites(path: Path, value: float) -> list[int]:
    return [
        node.lineno
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if isinstance(node, ast.Constant)
        and isinstance(node.value, float)
        and node.value == value
    ]


# ------------------------------------------------------------------------- the glob


def test_the_glob_finds_every_engine_module() -> None:
    found = {name.removeprefix("services.") for name in _engine_modules()}
    assert {
        "mt5_parity",
        "mt5_parity_intake",
        "mt5_parity_capture",
        "mt5_parity_report",
        "mt5_parity_findings",
        "mt5_parity_proofs",
    } <= found


# ------------------------------------------------------------------------- purity


def test_the_engine_closure_reaches_no_database_gateway_or_network() -> None:
    seen, external = closure(SERVICE_ROOT, _engine_modules())
    reached = sorted(seen & FORBIDDEN_INTERNAL)
    assert not reached, f"the engine reaches {reached}"
    scripts = sorted(name for name in seen if name.split(".")[0] == "scripts")
    assert not scripts, f"the engine reaches the scripts package: {scripts}"
    assert _RELATIVE not in external, "a relative import cannot be followed by the scan"
    banned = sorted(external & FORBIDDEN_EXTERNAL)
    assert not banned, f"the engine imports {banned}"


def test_the_closure_reaches_the_modules_the_engine_rests_on() -> None:
    # Anti-vacuity: a closure that stopped at the first hop would pass the test above
    # without having looked at anything. D-D: the clock read belongs to Phase 155.1, so
    # the engine uses the pure clock and deal modules, never an Mt5Client.
    seen, _external = closure(SERVICE_ROOT, _engine_modules())
    for name in (
        "services.mt5_deals",
        "services.mt5_server_clock",
        "services.broker_dailies",
        "services.wealth_returns",
        "services.parity_diff",
    ):
        assert name in seen, f"the closure never reached {name}"
    assert set(_engine_modules()) <= seen


# --------------------------------------------------- the scanner can fail (fake tree)


def _fake_tree(tmp_path: Path, files: dict[str, str]) -> Path:
    (tmp_path / "services").mkdir()
    for name, body in files.items():
        (tmp_path / "services" / f"{name}.py").write_text(body, encoding="utf-8")
    return tmp_path


@pytest.mark.parametrize(
    "body",
    [
        "def lazy() -> None:\n    import services.db\n",
        "def lazy() -> None:\n    from services import db\n",
        "def lazy() -> None:\n    from services.db import get_client\n",
    ],
)
def test_the_scanner_sees_a_function_level_import_of_a_forbidden_module(
    tmp_path: Path, body: str
) -> None:
    root = _fake_tree(tmp_path, {"mt5_parity_fake": body, "db": "VALUE = 1\n"})
    seen, _external = closure(root, ["services.mt5_parity_fake"])
    assert "services.db" in seen
    assert seen & FORBIDDEN_INTERNAL == {"services.db"}


def test_the_scanner_follows_a_chain_and_names_an_external_package(tmp_path: Path) -> None:
    root = _fake_tree(
        tmp_path,
        {
            "mt5_parity_fake": "from services import middle\n",
            "middle": "def f() -> None:\n    import socket\n    import services.mt5_client\n",
            "mt5_client": "VALUE = 1\n",
        },
    )
    seen, external = closure(root, ["services.mt5_parity_fake"])
    assert {"services.middle", "services.mt5_client"} <= seen
    assert external == {"socket"}
    assert seen & FORBIDDEN_INTERNAL == {"services.mt5_client"}
    assert external & FORBIDDEN_EXTERNAL == {"socket"}


def test_the_scanner_flags_a_relative_import_and_a_scripts_module(tmp_path: Path) -> None:
    root = _fake_tree(tmp_path, {"mt5_parity_fake": "from . import db\nimport scripts.tool\n"})
    (root / "scripts").mkdir()
    (root / "scripts" / "tool.py").write_text("VALUE = 1\n", encoding="utf-8")
    seen, external = closure(root, ["services.mt5_parity_fake"])
    assert _RELATIVE in external
    assert "scripts.tool" in seen


def test_a_clean_fake_tree_is_clean(tmp_path: Path) -> None:
    root = _fake_tree(
        tmp_path, {"mt5_parity_fake": "import math\nfrom services import helper\n", "helper": "X = 1\n"}
    )
    seen, external = closure(root, ["services.mt5_parity_fake"])
    assert seen == {"services.mt5_parity_fake", "services.helper"}
    assert external == {"math"}
    assert not seen & FORBIDDEN_INTERNAL and not external & FORBIDDEN_EXTERNAL


# --------------------------------------------------------------- the one constant


def test_the_tolerance_literal_appears_once_and_it_is_the_constant_definition() -> None:
    sites: dict[str, list[int]] = {}
    for path in sorted(SERVICES.glob("mt5_parity*.py")):
        found = _literal_sites(path, MT5_PARITY_TOLERANCE)
        if found:
            sites[path.name] = found
    assert sum(len(v) for v in sites.values()) == 1, sites
    assert list(sites) == ["mt5_parity.py"], sites

    tree = ast.parse((SERVICES / "mt5_parity.py").read_text(encoding="utf-8"))
    definitions = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AnnAssign)
        and isinstance(node.target, ast.Name)
        and node.target.id == "MT5_PARITY_TOLERANCE"
    ]
    assert len(definitions) == 1
    value = definitions[0].value
    assert isinstance(value, ast.Constant) and value.value == MT5_PARITY_TOLERANCE
    assert sites["mt5_parity.py"] == [value.lineno]


def test_no_phase_test_restates_the_tolerance() -> None:
    files = sorted(TESTS.glob("test_mt5_parity*.py")) + [TESTS / "test_mt5_report_parser.py"]
    assert len(files) >= 8, "the test glob found too few files to mean anything"
    restated = {p.name: _literal_sites(p, MT5_PARITY_TOLERANCE) for p in files if p.is_file()}
    assert not {name: sites for name, sites in restated.items() if sites}, restated


def test_the_literal_counter_can_fail_and_ignores_comments_and_strings() -> None:
    value = MT5_PARITY_TOLERANCE
    two = "a = 0.01\nb = [0.01, 0.5]  # 0.01 in a comment\ns = 'a 0.01 string'\n"
    assert count_float_literal(two, value) == 2
    assert count_float_literal("a = 1\nb = 0.011\n", value) == 0
    assert count_float_literal("a = 0.01\n", value) == 1
    assert count_float_literal("flag = True\n", 1.0) == 0  # a bool is never a float literal
