"""153.3-06 / **D-35** — the structural answer to ONE question:

    can any caller reach `mt5.shutdown()` outside the terminal lease?

WHY this is a source-derived roster and not a list of paths (Rule 9). `mt5linux`
serves EVERY rpyc connection from ONE `ThreadedServer` process over ONE shared
`MetaTrader5` module instance holding ONE IPC pipe to ONE terminal
(`153-EVIDENCE-mt5-platform` §A2 / Correction C-1). One caller's `shutdown()` is
therefore every caller's `-10004 No IPC connection`. D-30 removed the call from the
request path; three more callers still reached it from the worker side, and
`main.py:83-91` runs the worker loops INSIDE the API process — one `await` from a
user's validate. D-35 deleted the teardown at the SINK (`Mt5Client.close`).

The property that has to survive the NEXT author is not "these four files are
clean" — it is "**no** file is dirty". A hand-listed roster (the shape of
`tests/test_exchange.py:83-122`, and the shape this milestone measured at 9/37
coverage) cannot say that: a new module is simply absent from it. So the roster is
DERIVED from the source of every production `.py` in `analytics-service/` and
compared against a hand-typed permitted set.

⭐ `ast`, never a regex. Comments and docstrings are structurally ABSENT from an
AST, so the comment-inflation hazard that defeated `EMITTER_RE` (153-PATTERNS §2 —
"a scanner that matches nothing looks identical to a clean codebase") cannot arise
here, and no comment-stripping pass is needed. ⛔ Do not "simplify" this into a
grep: a grep would count the word `shutdown` in this module's own docstrings, in
`mt5_client.py`'s D-35 rationale, and in every `# never call shutdown()` comment.

⛔ Source FILES are read by path and `ast.parse`d. Never `inspect.getsource` on an
imported module: importing `routers.exchange` loads it with the real slowapi
limiter and pollutes `sys.modules`, breaking `test_exchange_router_c0202`'s
stub-reload fixture downstream (the constraint `tests/test_exchange.py` records).

Anti-vacuity is explicit and load-bearing here, because after D-35 exactly ONE
`shutdown()` call node survives in the whole tree — so a scanner that had silently
stopped matching anything would produce a set indistinguishable from success. Every
floor below is a HAND-TYPED literal, never a derived collection compared against its
own `len()` (a size compared against its own derivation cannot fail).
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

# --------------------------------------------------------------------------- #
# The pins — hand-typed literals, measured 2026-08-09 against the tree at
# 153.3-06 Task 1.
# --------------------------------------------------------------------------- #

#: The ONE permitted `shutdown()` call site, as (relpath, enclosing function).
#:
#: WHY this one is permitted: `Mt5Client.restart()` is the deliberate heal of a
#: genuinely WEDGED IPC pipe (MT5CONC-01). With nobody else calling `shutdown()`,
#: it is the only way a wedged pipe is ever recovered — and destroying a pipe that
#: is already wedged is the point rather than the hazard. It is safe to keep
#: because every one of its call sites holds the terminal lease, which is not a
#: belief but the second assertion in this module.
PERMITTED_SHUTDOWN_SITES: frozenset[tuple[str, str]] = frozenset(
    {("services/mt5_client.py", "restart")}
)

#: Anti-vacuity floor on the WALK itself. Measured: 110 production `.py` files
#: (`tests/` excluded). The floor sits well under it so ordinary growth or pruning
#: never flaps, but a walk that collapsed to a handful — a moved root, a broken
#: `rglob`, an over-eager exclusion — reds instead of passing as a clean codebase.
SCANNED_FILE_FLOOR = 90

#: Measured: `allocator_positions.py` x2 (`:670`, `:684`) and `job_worker.py` x2
#: (`:3594`, `:3627`). Asserted as `>=`, deliberately: a NEW restart call site is
#: admitted by PASSING the lease check, never by lowering this floor.
EXPECTED_RESTART_SITES = 4

#: ⭐ THE INDIRECTION PIN. `restart` is also reached as a bare ATTRIBUTE reference —
#: `mt5_concurrency.py:88` passes `client.restart` to `asyncio.to_thread` — which is
#: an `ast.Attribute`, NOT an `ast.Call`, and is therefore invisible to the call
#: predicate below. Pinning the set of files that take such a reference means a new
#: indirection has to be admitted DELIBERATELY rather than walking past the guard.
#:
#: ⚠️ Measured, and it differs from the plan's expectation: `services/mt5_client.py`
#: is NOT in this set. It DEFINES `restart` (an `ast.FunctionDef`) and never takes a
#: reference to it, so no `ast.Attribute` named `restart` exists in that file. The
#: definition is pinned separately by `RESTART_DEFINITION_FILE`.
RESTART_ATTRIBUTE_REFERENCE_FILES: frozenset[str] = frozenset(
    {"services/mt5_concurrency.py"}
)

#: The single file that DEFINES the restart verb. Pinned so that "the definition
#: moved" is a deliberate act too.
RESTART_DEFINITION_FILE = "services/mt5_client.py"

#: The context managers that ARE the terminal lease. `_mt5_terminal_lock_for` is the
#: Phase-137 per-terminal `asyncio.Lock` registry (MT5CONC-02); `mt5_terminal_lease`
#: is plan 153.3-04's bounded wrapper over it.
_LEASE_CONTEXT_MANAGERS: frozenset[str] = frozenset(
    {"_mt5_terminal_lock_for", "mt5_terminal_lease"}
)

_SHUTDOWN_NAMES: frozenset[str] = frozenset({"shutdown"})
_RESTART_NAMES: frozenset[str] = frozenset({"restart", "_mt5_bounded_restart"})

_ROOT = Path(__file__).resolve().parents[1]  # analytics-service/


# --------------------------------------------------------------------------- #
# The scanner
# --------------------------------------------------------------------------- #


def _called_name(node: ast.Call) -> str | None:
    """The bare name a Call invokes, for BOTH syntactic forms.

    `ast.Attribute` catches `self._mt5.shutdown()`; `ast.Name` catches a
    `from x import shutdown` / `shutdown()` indirection. Matching only the first
    would let an import-and-call walk straight past this guard.
    """
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return None


def _is_lease_context(expr: ast.expr) -> bool:
    """True iff an `async with` item's context expression IS the terminal lease."""
    if not isinstance(expr, ast.Call):
        return False
    return _called_name(expr) in _LEASE_CONTEXT_MANAGERS


class _Scan(ast.NodeVisitor):
    """Walks ONE module, carrying the enclosing function name and whether the node
    is lexically inside an `async with` terminal lease.

    A recursive visitor rather than `lineno`/`end_lineno` containment arithmetic:
    it computes the same enclosure exactly, it cannot be fooled by a multi-line
    `with` item, and it makes the NESTED-FUNCTION rule explicit — entering a nested
    `def` RESETS the lease depth, because a closure defined inside a lease is not
    executed inside it (`Mt5Client.restart`'s own
    `_reconnect_then_dispose_stale` is exactly that shape). Resetting is the
    conservative direction: it can only ever make this test MORE likely to red.
    """

    def __init__(self, relpath: str) -> None:
        self.relpath = relpath
        #: (relpath, OUTERMOST enclosing def, lineno). ⭐ Outermost, not innermost:
        #: `Mt5Client.restart` wraps its body in a `_reconnect_then_dispose_stale`
        #: closure (plan 153.3-05's timed-stage bracket), and permission is granted
        #: to the VERB `restart`, not to whatever nested helper it happens to use
        #: this month. Pinning the innermost name would make this roster red on a
        #: pure refactor and — worse — would let a shutdown added to a NEW closure
        #: inside `close()` report an unfamiliar name instead of `close`. The full
        #: dotted chain is carried in `qualnames` for the failure message.
        self.shutdown_sites: list[tuple[str, str, int]] = []
        self.qualnames: dict[tuple[str, int], str] = {}
        #: (relpath, outermost enclosing def, lineno, lease_held)
        self.restart_sites: list[tuple[str, str, int, bool]] = []
        self.restart_attribute_refs: list[tuple[str, int]] = []
        self.defines_restart = False
        self._func_stack: list[str] = ["<module>"]
        self._lease_depth = 0

    # -- structure -------------------------------------------------------- #

    def _visit_function(
        self, node: ast.FunctionDef | ast.AsyncFunctionDef
    ) -> None:
        if node.name == "restart":
            self.defines_restart = True
        self._func_stack.append(node.name)
        outer_lease_depth, self._lease_depth = self._lease_depth, 0
        self.generic_visit(node)
        self._lease_depth = outer_lease_depth
        self._func_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        holds = any(_is_lease_context(item.context_expr) for item in node.items)
        if holds:
            self._lease_depth += 1
        self.generic_visit(node)
        if holds:
            self._lease_depth -= 1

    # -- the two derivations ---------------------------------------------- #

    def _enclosing(self) -> tuple[str, str]:
        """(outermost def, full dotted chain) for the node being visited."""
        chain = self._func_stack[1:] or ["<module>"]
        return chain[0], ".".join(chain)

    def visit_Call(self, node: ast.Call) -> None:
        name = _called_name(node)
        if name in _SHUTDOWN_NAMES:
            outer, qualname = self._enclosing()
            self.shutdown_sites.append((self.relpath, outer, node.lineno))
            self.qualnames[(self.relpath, node.lineno)] = qualname
        elif name in _RESTART_NAMES:
            outer, qualname = self._enclosing()
            self.restart_sites.append(
                (self.relpath, outer, node.lineno, self._lease_depth > 0)
            )
            self.qualnames[(self.relpath, node.lineno)] = qualname
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr == "restart":
            self.restart_attribute_refs.append((self.relpath, node.lineno))
        self.generic_visit(node)


def scan_source(source: str, relpath: str) -> _Scan:
    """Parse ONE source string and return its derivations. Exposed separately from
    the tree walk so the self-tests can drive it against hand-written syntax."""
    scan = _Scan(relpath)
    scan.visit(ast.parse(source, filename=relpath))
    return scan


def _production_py_files() -> list[Path]:
    """Every production `.py` under `analytics-service/`.

    `scripts/` IS included: an operator script that shuts the shared terminal down
    is exactly as destructive as a service that does. `tests/` is excluded (this
    module's own doubles legitimately define `shutdown`), as are any vendored
    `.venv` / `site-packages` trees.
    """
    out: list[Path] = []
    for path in sorted(_ROOT.rglob("*.py")):
        parts = set(path.relative_to(_ROOT).parts)
        if parts & {"tests", ".venv", "venv", "site-packages", "__pycache__"}:
            continue
        out.append(path)
    return out


@pytest.fixture(scope="module")
def tree_scan() -> list[_Scan]:
    """Scan the whole production tree ONCE per module."""
    scans: list[_Scan] = []
    for path in _production_py_files():
        rel = path.relative_to(_ROOT).as_posix()
        scans.append(scan_source(path.read_text(), rel))
    return scans


# --------------------------------------------------------------------------- #
# 4. Anti-vacuity — the predicate spelled out in the message (PATTERNS §2)
# --------------------------------------------------------------------------- #


def test_the_walk_actually_walked_the_tree(tree_scan: list[_Scan]) -> None:
    """⛔ The load-bearing floor. A scanner that matched nothing looks EXACTLY like
    a clean codebase, and after D-35 the expected population is one single call
    node — so "found zero" is one silent breakage away from "all clear"."""
    assert len(tree_scan) >= SCANNED_FILE_FLOOR, (
        f"the production walk found only {len(tree_scan)} .py files under {_ROOT} "
        f"(floor {SCANNED_FILE_FLOOR}, measured 110). The PREDICATE is: every "
        "*.py under analytics-service/ whose path contains no 'tests', '.venv', "
        "'venv', 'site-packages' or '__pycache__' segment. A collapsed walk "
        "passes every other assertion in this file vacuously."
    )

    shutdown_sites = [s for scan in tree_scan for s in scan.shutdown_sites]
    assert len(shutdown_sites) >= 1, (
        "the scanner found ZERO shutdown() call nodes anywhere in "
        f"{len(tree_scan)} files. Exactly ONE is expected "
        f"({sorted(PERMITTED_SHUTDOWN_SITES)}). Zero does not mean the tree got "
        "cleaner — it means the ast predicate (ast.Call whose func is an "
        "ast.Attribute or ast.Name named 'shutdown') stopped matching, and every "
        "roster assertion here is now vacuous."
    )

    restart_sites = [s for scan in tree_scan for s in scan.restart_sites]
    assert len(restart_sites) >= EXPECTED_RESTART_SITES, (
        f"the scanner found {len(restart_sites)} restart call sites, below the "
        f"hand-typed floor of {EXPECTED_RESTART_SITES} (allocator_positions.py x2, "
        "job_worker.py x2). Either the recovery wiring was deleted or the "
        "predicate stopped matching; ⛔ do NOT lower this floor to make it pass."
    )

    assert any(scan.defines_restart for scan in tree_scan), (
        "no module defines a `restart` function — the scanner is not looking at "
        "the tree it thinks it is."
    )


# --------------------------------------------------------------------------- #
# 1. The roster: the derived shutdown sites EQUAL the hand-typed permitted set
# --------------------------------------------------------------------------- #


def test_no_caller_reaches_shutdown_outside_the_permitted_site(
    tree_scan: list[_Scan],
) -> None:
    """⭐ D-35. `mt5.shutdown()` may be called from `Mt5Client.restart()` and
    NOWHERE else in analytics-service.

    Reds without anybody hand-editing a roster: the permitted set is typed out
    here, the actual set is derived from source, and a new call site in ANY file —
    including one that does not exist yet — makes the two differ.
    """
    sites = sorted(
        {(rel, func) for scan in tree_scan for rel, func, _ in scan.shutdown_sites}
    )
    located = {
        (rel, func): (line, scan.qualnames[(rel, line)])
        for scan in tree_scan
        for rel, func, line in scan.shutdown_sites
    }

    forbidden = [s for s in sites if s not in PERMITTED_SHUTDOWN_SITES]
    assert not forbidden, (
        "FORBIDDEN shutdown() call site(s): "
        + ", ".join(
            f"{rel}:{located[(rel, func)][0]} in {located[(rel, func)][1]}()"
            for rel, func in forbidden
        )
        + ". shutdown() tears down the ONE shared MT5 IPC pipe for every concurrent "
        "caller (-10004 No IPC connection); it is permitted only inside the "
        "lease-held restart() heal (153.3 / D-35). Release your transport with "
        "Mt5Client.close() instead — it closes our rpyc socket and touches nothing "
        "shared."
    )

    missing = sorted(PERMITTED_SHUTDOWN_SITES - set(sites))
    assert not missing, (
        f"the PERMITTED shutdown site(s) {missing} are GONE. That is not an "
        "improvement: with nobody calling shutdown(), a genuinely wedged IPC pipe "
        "has no heal at all (MT5CONC-01). If this was deliberate, re-cut the pin."
    )


# --------------------------------------------------------------------------- #
# 2. Every restart call site is lease-held
# --------------------------------------------------------------------------- #


def test_every_restart_call_site_holds_the_terminal_lease(
    tree_scan: list[_Scan],
) -> None:
    """The surviving teardown is safe ONLY because no concurrent caller can be
    attached when it fires — i.e. because every path to it holds the terminal.

    This is what turns "all four call sites happen to be inside a lock today" into
    a structural property. Note this is the ONLY thing standing between the
    permitted `shutdown()` and the exact cross-tenant `-10004` D-35 closed.
    """
    unheld = [
        (rel, scan.qualnames[(rel, line)], line)
        for scan in tree_scan
        for rel, _func, line, held in scan.restart_sites
        if not held
    ]
    assert not unheld, (
        "restart() call site(s) NOT lexically inside an `async with` terminal "
        "lease: "
        + ", ".join(f"{rel}:{line} in {func}()" for rel, func, line in unheld)
        + f". restart() performs the one permitted mt5.shutdown(); the terminal "
        f"must be HELD for the whole duration of a teardown, or a concurrent "
        f"caller loses its IPC pipe mid-read. Wrap the call in "
        f"`async with {' / '.join(sorted(_LEASE_CONTEXT_MANAGERS))}(...)`."
    )


# --------------------------------------------------------------------------- #
# 3. The indirection pin — `client.restart` as a bare attribute reference
# --------------------------------------------------------------------------- #


def test_restart_is_reached_by_reference_only_where_we_expect(
    tree_scan: list[_Scan],
) -> None:
    """`mt5_concurrency.py:88` passes `client.restart` to `asyncio.to_thread` — an
    `ast.Attribute`, not an `ast.Call`, so the roster predicate above is blind to
    it. Without this pin, a new `to_thread(client.restart)` anywhere would reach the
    one permitted teardown with no lease check applied to it at all."""
    referencing = {
        rel for scan in tree_scan for rel, _ in scan.restart_attribute_refs
    }
    assert referencing == RESTART_ATTRIBUTE_REFERENCE_FILES, (
        f"files taking a bare `.restart` reference changed: {sorted(referencing)} "
        f"!= {sorted(RESTART_ATTRIBUTE_REFERENCE_FILES)}. A reference can be handed "
        "to to_thread/gather and invoked far from any lease. Admit a new one here "
        "deliberately, having checked it is lease-held at the point it RUNS."
    )

    definers = {scan.relpath for scan in tree_scan if scan.defines_restart}
    assert definers == {RESTART_DEFINITION_FILE}, (
        f"`restart` is defined in {sorted(definers)}, expected "
        f"{[RESTART_DEFINITION_FILE]} — a second definition means a second "
        "teardown verb the roster above was never asked about."
    )


# --------------------------------------------------------------------------- #
# 5. SELF-TEST — the scanner reads a shutdown out of REAL syntax
# --------------------------------------------------------------------------- #


def test_selftest_scanner_finds_a_shutdown_in_real_syntax() -> None:
    """(i) Given a call, the scanner returns it with its enclosing function name."""
    src = (
        "class C:\n"
        "    def teardown(self):\n"
        "        conn = self._conn\n"
        "        conn.shutdown()\n"
    )
    scan = scan_source(src, "synthetic/a.py")
    assert [(rel, func) for rel, func, _ in scan.shutdown_sites] == [
        ("synthetic/a.py", "teardown")
    ]


def test_selftest_scanner_ignores_shutdown_in_prose() -> None:
    """(ii) Given the WORD in a comment, a docstring and a plain string literal and
    NO call, the scanner returns nothing — it matches calls, not text.

    This is what a grep could not do, and why `EMITTER_RE`'s comment-inflation
    failure class cannot recur here.
    """
    src = (
        "def f():\n"
        '    """Never call shutdown() here — see D-35."""\n'
        "    # shutdown() would destroy the shared pipe\n"
        '    msg = "shutdown()"\n'
        "    return msg\n"
    )
    scan = scan_source(src, "synthetic/b.py")
    assert scan.shutdown_sites == []


def test_selftest_scanner_matches_the_known_present_site(
    tree_scan: list[_Scan],
) -> None:
    """(iii) Against the REAL tree, the site we can point at IS found. Proves the
    scanner is wired to the actual source, not merely to synthetic strings."""
    sites = {(rel, func) for scan in tree_scan for rel, func, _ in scan.shutdown_sites}
    for expected in PERMITTED_SHUTDOWN_SITES:
        assert expected in sites, (
            f"{expected} is not in the derived set {sorted(sites)} — the scanner "
            "cannot see a site that is demonstrably there."
        )


def test_selftest_scanner_sees_a_bare_name_call() -> None:
    """A `from x import shutdown; shutdown()` indirection is caught too — matching
    only `ast.Attribute` would let the simplest bypass through."""
    src = "from mt5 import shutdown\n\n\ndef g():\n    shutdown()\n"
    scan = scan_source(src, "synthetic/c.py")
    assert [func for _, func, _ in scan.shutdown_sites] == ["g"]


# --------------------------------------------------------------------------- #
# 6. SELF-TEST — the LEASE predicate has teeth
# --------------------------------------------------------------------------- #


def test_selftest_lease_predicate_reports_held_and_not_held() -> None:
    """⛔ Without this, "every restart site holds the lease" is indistinguishable
    from a predicate that returns True unconditionally.

    A deliberately UNHELD synthetic site is included, and the assertion is that the
    scanner reports exactly one of each — with the right function names, so a
    predicate that reported the pair in the wrong order would red too.
    """
    src = (
        "async def held(client, key):\n"
        "    async with _mt5_terminal_lock_for(key):\n"
        "        await _mt5_bounded_restart(client)\n"
        "\n"
        "\n"
        "async def not_held(client):\n"
        "    await _mt5_bounded_restart(client)\n"
    )
    scan = scan_source(src, "synthetic/d.py")
    verdicts = {func: held for _, func, _, held in scan.restart_sites}
    assert verdicts == {"held": True, "not_held": False}, verdicts


def test_selftest_lease_predicate_rejects_a_non_lease_context_manager() -> None:
    """Any `async with` must not count — only the terminal lease does. A predicate
    that merely asked "is this inside some async with?" would pass every site that
    holds an unrelated session, connection or transaction."""
    src = (
        "async def wrong_lock(client, key):\n"
        "    async with some_other_lock(key):\n"
        "        await _mt5_bounded_restart(client)\n"
    )
    scan = scan_source(src, "synthetic/e.py")
    assert [held for _, _, _, held in scan.restart_sites] == [False]


def test_selftest_lease_predicate_accepts_the_wave_04_lease_wrapper() -> None:
    """Both lease context managers are honoured: the Phase-137 lock registry and
    plan 153.3-04's bounded `mt5_terminal_lease` wrapper over it."""
    src = (
        "async def leased(client, key):\n"
        "    async with mt5_terminal_lease(key, wait_s=None):\n"
        "        await _mt5_bounded_restart(client)\n"
    )
    scan = scan_source(src, "synthetic/f.py")
    assert [held for _, _, _, held in scan.restart_sites] == [True]


def test_selftest_a_closure_defined_inside_a_lease_is_not_counted_as_held() -> None:
    """The nested-function rule, stated as a case. A closure DEFINED inside a lease
    may be handed to `to_thread` and RUN long after the lease is released, so the
    scanner resets its lease depth at every function boundary. Conservative by
    design — it can only make this suite redder, never greener."""
    src = (
        "async def outer(client, key):\n"
        "    async with _mt5_terminal_lock_for(key):\n"
        "        def later():\n"
        "            client.restart()\n"
        "        return later\n"
    )
    scan = scan_source(src, "synthetic/g.py")
    assert [(func, held) for _, func, _, held in scan.restart_sites] == [
        ("outer", False)
    ]
    # …and the full chain names the closure, so the failure message stays readable.
    assert list(scan.qualnames.values()) == ["outer.later"]
