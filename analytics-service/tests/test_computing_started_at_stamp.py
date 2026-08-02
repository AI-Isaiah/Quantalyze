"""JOB-01 — the ``computing_started_at`` stamp/clear invariant, statically enforced.

The pg_cron reaper ``reap_strategy_analytics_stuck_computing`` (migration
``20260802120000``) keys EXCLUSIVELY on ``strategy_analytics.computing_started_at``
and never on ``computed_at``. Two consequences make this a build-time gate:

  * a writer that sets ``computation_status='computing'`` WITHOUT the stamp creates a
    row the reaper must skip forever (the NULL-stamp skip rule is deliberate — a NULL
    stamp is a writer bug, not a stranded job, and reaping it would be destructive);
  * an exit writer that fails to clear the stamp leaves a stale timestamp on a
    terminal row, which the reaper could later re-fire on.

Enforcement is STATIC, not runtime. A runtime ``CHECK`` constraint was rejected in
CONTEXT.md: a missed writer would then surface as a 23514 on the live money path
instead of a red build.

────────────────────────────────────────────────────────────────────────────
THIS FILE IS NOT THE WHOLE INVARIANT (research P-11)
────────────────────────────────────────────────────────────────────────────
It covers the two APPLICATION runtimes: Python (AST) and the Next.js API-route
surface (textual). The SQL runtime half — the ``sync_strategy_analytics_status``
bridge's branch (a) CONDITIONAL stamp, its branch (b)/(c) clears, and the reaper's
own ``SET`` list — is owned by
``supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql``, which asserts
against the DEPLOYED function bodies via ``pg_get_functiondef`` / ``cron.job.command``.
A Python-only gate is a FALSE PASS. Neither file alone is the invariant.

────────────────────────────────────────────────────────────────────────────
TypeScript scan boundary — stated honestly, deliberately NOT widened (W-8)
────────────────────────────────────────────────────────────────────────────
The TS surface scanned here is ``src/app/api/**/*.ts`` route handlers ONLY. All four
census write sites live there today. A FUTURE ``strategy_analytics.computation_status``
writer placed in a server action, in ``src/lib/``, or in a page component would be
OUTSIDE this gate's coverage. The discoverability pointer for that class is the
"Direct-writes audit (D.10)" census comment in ``src/app/api/keys/sync/route.ts``,
which names every writer including the SQL ones.

Widening the textual scan to all of ``src/`` was considered and REJECTED, because a
key-colon regex cannot distinguish a DB payload key from three benign shapes that
already exist in the repo:

  * ``src/lib/utils.ts`` ``EMPTY_ANALYTICS`` — an in-memory placeholder object
    literal, not a DB write. (It DOES carry ``computing_started_at: null``, added by
    plan 142-06, so it would pass — but it would be passing for the wrong reason.)
  * ``src/app/(dashboard)/portfolios/[id]/page.tsx:503`` — a ``portfolio_analytics``
    payload. This is the TypeScript twin of the ``routers/portfolio.py`` trap the
    Python half is chain-scoped to survive: a naive widen would flag the WRONG
    table's payload.
  * type-annotation members — ``src/lib/queries.ts:414,452`` and
    ``src/components/admin/AdminTabs.tsx:82`` declare ``computation_status`` as an
    interface/generic member. Only a real TS parser could tell those from payload
    keys, and this gate has no TS parser.

So the coverage claim is scoped: this file covers the API-route WRITER surface.

────────────────────────────────────────────────────────────────────────────
Why the Python half is CHAIN-scoped and not FUNCTION-scoped
────────────────────────────────────────────────────────────────────────────
``routers/portfolio.py::_compute_portfolio_analytics`` contains BOTH
``portfolio_analytics`` status dicts (``:651-652`` insert, ``:695-699`` update, using
the ``ComputationStatus.*.value`` Attribute form) AND a ``strategy_analytics``
``.select()`` (``:734``) in the SAME function. A function-scope rule would therefore
flag the wrong table's payloads and could never yield zero findings there. Scoping to
the WRITE call (``.insert``/``.upsert``/``.update``) whose attribute chain bottoms out
at ``.table("strategy_analytics")`` is what keeps that file clean;
``test_portfolio_router_has_zero_findings`` pins it.

Mechanism analogs: the chain-unwind is
``tests/test_verify_strategy_no_legacy_writes.py:34-98``; ``_repo_root`` /
``_is_pure_comment`` / ``_py_scan_files`` now live ONCE in
``tests/_scan_helpers.py`` (D-10 — this file donated the canonical wide-union
forms); the anti-vacuity assert idiom is ``tests/test_dark_path_deleted.py``.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Final, NamedTuple

# D-10: the path/hygiene/scan helpers live in ONE module. Three copies of
# ``_py_scan_files`` with three different file lists used to mean a gate could
# silently narrow its surface and keep reporting green.
from tests._scan_helpers import (
    _is_pure_comment,
    _py_scan_files,
    _rel,
    _repo_root,
)

# ---------------------------------------------------------------------------
# Contract constants
# ---------------------------------------------------------------------------

_TABLE: Final[str] = "strategy_analytics"
_STATUS_KEY: Final[str] = "computation_status"
_STAMP_KEY: Final[str] = "computing_started_at"

# Only these three PostgREST verbs mutate. Read verbs (.select/.eq/.in_/…) are NOT
# write sites and are ignored — that is the portfolio.py false-positive exclusion.
_WRITE_METHODS: Final[frozenset[str]] = frozenset({"insert", "upsert", "update"})

# The exit statuses. Reaching any of them means the row has LEFT 'computing', so the
# stamp must be cleared in the same payload.
_TERMINAL_STATUSES: Final[frozenset[str]] = frozenset(
    {"failed", "complete", "complete_with_warnings"}
)
_ENTRY_STATUS: Final[str] = "computing"

_EXTEND = "extend the gate"


# ---------------------------------------------------------------------------
# Python half — AST, chain-scoped to the WRITE call, with payload resolution
# ---------------------------------------------------------------------------


class _WriteSite(NamedTuple):
    """A resolved ``strategy_analytics`` write with its payload dict."""

    path: Path
    lineno: int
    payload: ast.Dict
    arm: str  # "literal" | "n1" | "n2"


def _write_target_table(call: ast.Call) -> str | None:
    """Return the table literal when ``call`` is a WRITE whose attribute chain
    bottoms out at ``.table("<literal>")``; otherwise ``None``.

    Chain-unwind copied from tests/test_verify_strategy_no_legacy_writes.py:74-86.
    ``supabase.table("x").upsert(p)`` and ``ctx.supabase.table("x").update(p)`` both
    resolve; ``.select(...)`` resolves the table but is rejected on the verb, and the
    trailing ``.execute()`` bottoms out at the ``.upsert`` call, not at ``.table``.
    """
    func = call.func
    if not isinstance(func, ast.Attribute) or func.attr not in _WRITE_METHODS:
        return None
    cursor: ast.expr = func
    while isinstance(cursor, ast.Attribute):
        cursor = cursor.value
    if not isinstance(cursor, ast.Call):
        return None
    inner = cursor.func
    if not (isinstance(inner, ast.Attribute) and inner.attr == "table"):
        return None
    if len(cursor.args) != 1 or not isinstance(cursor.args[0], ast.Constant):
        return None
    value = cursor.args[0].value
    return value if isinstance(value, str) else None


def _dict_bindings(scope: ast.AST, name: str) -> list[ast.expr]:
    """Every ``Assign``/``AnnAssign`` in ``scope``'s subtree that binds ``name``
    to a value.

    Subscript assignments (``payload["k"] = v``) and method calls
    (``payload.update(...)``) are deliberately NOT bindings: the status key is in
    the literal or nowhere, and both real census sites mutate their dict that way
    after construction.
    """
    found: list[ast.expr] = []
    for node in ast.walk(scope):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    found.append(node.value)
        elif isinstance(node, ast.AnnAssign):
            if (
                isinstance(node.target, ast.Name)
                and node.target.id == name
                and node.value is not None
            ):
                found.append(node.value)
    return found


def _param_default(
    func: ast.FunctionDef | ast.AsyncFunctionDef, name: str
) -> tuple[str, ast.expr | None] | None:
    """Resolve ``name`` against ``func``'s own parameter list.

    Returns ``("default", expr)``, ``("nodefault", None)``, ``("star", None)``, or
    ``None`` when ``name`` is not a parameter at all.

    ⚠️ ``args.defaults`` aligns to the TAIL of ``posonlyargs + args``, NOT
    index-parallel to it. The parameter at combined index ``i`` has a default iff
    ``i >= offset`` where ``offset = len(posonlyargs) + len(args) - len(defaults)``,
    and that default is ``defaults[i - offset]``. Today's ONLY parameter-default
    write site (``job_worker._prestamp_dq_flags``) is single-parameter, so
    ``defaults[i]`` would be coincidentally green at offset 0 — and would silently
    resolve the WRONG payload on the first multi-parameter write site. ``kw_defaults``
    DOES align 1:1 with ``kwonlyargs`` (a ``None`` entry means no default).
    """
    positional = list(func.args.posonlyargs) + list(func.args.args)
    defaults = list(func.args.defaults)
    offset = len(positional) - len(defaults)
    for index, arg in enumerate(positional):
        if arg.arg == name:
            if index >= offset:
                return ("default", defaults[index - offset])
            return ("nodefault", None)
    for kwarg, kwdefault in zip(func.args.kwonlyargs, func.args.kw_defaults):
        if kwarg.arg == name:
            if kwdefault is None:
                return ("nodefault", None)
            return ("default", kwdefault)
    for star in (func.args.vararg, func.args.kwarg):
        if star is not None and star.arg == name:
            return ("star", None)
    return None


_Scope = ast.Module | ast.FunctionDef | ast.AsyncFunctionDef


def _resolve_name(
    name: str,
    chain: tuple[_Scope, ...],
    upto: int,
    where: str,
) -> ast.Dict:
    """Resolve a ``Name`` payload to its dict literal.

    ``chain[0]`` is the module; ``chain[1:]`` are the enclosing ``(Async)FunctionDef``
    scopes, innermost LAST. ``upto`` is how many chain entries are visible; the walk
    runs innermost → outermost over ``chain[:upto]``.

    Two sub-arms per scope:
      * **n1 single-assignment** — exactly one Dict-valued binding of ``name`` in the
        scope's subtree.
      * **n2 parameter-default** — ``name`` is a parameter of THIS scope's own def, so
        resolve its default. A ``Name`` default resumes the n1 walk at the scope
        ENCLOSING the def, which is where defaults are evaluated.

    Every unresolvable shape FAILS LOUD. There is no silent-skip arm: a write site
    the gate cannot classify must redden the build, never pass unchecked.
    """
    for index in range(upto - 1, -1, -1):
        scope = chain[index]

        # ---- (n1) single-assignment in this scope ------------------------
        bindings = _dict_bindings(scope, name)
        if bindings:
            dict_bindings = [b for b in bindings if isinstance(b, ast.Dict)]
            if len(dict_bindings) == 1:
                return dict_bindings[0]
            if len(dict_bindings) > 1:
                raise AssertionError(
                    f"{where}: payload name {name!r} has {len(dict_bindings)} dict "
                    f"bindings in one scope — the gate cannot tell which one the "
                    f"write uses; {_EXTEND}."
                )
            raise AssertionError(
                f"{where}: payload name {name!r} is bound to a non-dict expression "
                f"({type(bindings[0]).__name__}); {_EXTEND}."
            )

        # ---- (n2) parameter default on this scope's own def --------------
        if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
            resolved = _param_default(scope, name)
            if resolved is not None:
                tag, node = resolved
                if tag == "star":
                    raise AssertionError(
                        f"{where}: payload name {name!r} is a *args/**kwargs "
                        f"parameter of {scope.name!r} — there is no default to "
                        f"resolve; {_EXTEND}."
                    )
                if tag == "nodefault":
                    raise AssertionError(
                        f"{where}: payload name {name!r} is a parameter of "
                        f"{scope.name!r} with NO default — the gate cannot see the "
                        f"caller's dict; {_EXTEND}."
                    )
                if isinstance(node, ast.Dict):
                    return node
                if isinstance(node, ast.Name):
                    # Defaults are evaluated in the ENCLOSING scope.
                    return _resolve_name(node.id, chain, index, where)
                raise AssertionError(
                    f"{where}: payload name {name!r} defaults to an unsupported "
                    f"expression ({type(node).__name__}); {_EXTEND}."
                )

    raise AssertionError(
        f"{where}: payload name {name!r} has zero resolvable bindings in any "
        f"enclosing scope (neither single-assignment nor parameter default); "
        f"{_EXTEND}."
    )


def _collect_write_sites(path: Path) -> list[_WriteSite]:
    """Every resolved ``strategy_analytics`` WRITE site in one file."""
    module = ast.parse(path.read_text(encoding="utf-8"))
    sites: list[_WriteSite] = []

    def visit(node: ast.AST, chain: tuple[_Scope, ...]) -> None:
        next_chain = chain
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            next_chain = chain + (node,)
        if isinstance(node, ast.Call) and _write_target_table(node) == _TABLE:
            where = f"{_rel(path)}:{node.lineno}"
            if not node.args:
                raise AssertionError(
                    f"{where}: {_TABLE} write has no positional payload argument; "
                    f"{_EXTEND}."
                )
            arg = node.args[0]
            if isinstance(arg, ast.Dict):
                sites.append(_WriteSite(path, node.lineno, arg, "literal"))
            elif isinstance(arg, ast.Name):
                # `chain` (not `next_chain`): a Call is never its own scope.
                visible = (module,) + chain
                # Distinguish which arm resolved it, for the liveness counters.
                arm = "n1"
                innermost = chain[-1] if chain else None
                if (
                    isinstance(innermost, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and not _dict_bindings(innermost, arg.id)
                    and _param_default(innermost, arg.id) is not None
                ):
                    arm = "n2"
                payload = _resolve_name(arg.id, visible, len(visible), where)
                sites.append(_WriteSite(path, node.lineno, payload, arm))
            else:
                raise AssertionError(
                    f"{where}: {_TABLE} write payload is a "
                    f"{type(arg).__name__}, which the gate cannot resolve to a "
                    f"dict literal; {_EXTEND}."
                )
        for child in ast.iter_child_nodes(node):
            visit(child, next_chain)

    visit(module, ())
    return sites


def _dict_value(node: ast.Dict, key: str) -> ast.expr | None:
    for k, v in zip(node.keys, node.values):
        if isinstance(k, ast.Constant) and k.value == key:
            return v
    return None


def _has_key(node: ast.Dict, key: str) -> bool:
    return any(
        isinstance(k, ast.Constant) and k.value == key for k in node.keys
    )


def _is_none(node: ast.expr | None) -> bool:
    return isinstance(node, ast.Constant) and node.value is None


class _PyScan(NamedTuple):
    all_sites: list[_WriteSite]
    kept: list[_WriteSite]  # sites whose payload carries computation_status


def _scan_python(files: list[Path]) -> _PyScan:
    all_sites: list[_WriteSite] = []
    for path in files:
        all_sites.extend(_collect_write_sites(path))
    # The three partial data_quality_flags upserts resolve to dicts WITHOUT a status
    # key and drop out HERE — untouched, exactly as the writer census requires.
    kept = [s for s in all_sites if _has_key(s.payload, _STATUS_KEY)]
    return _PyScan(all_sites, kept)


# ---------------------------------------------------------------------------
# Python half — the tests
# ---------------------------------------------------------------------------


def test_python_status_writers_stamp_and_clear() -> None:
    """Every Python ``strategy_analytics`` payload that writes ``computation_status``
    carries ``computing_started_at`` in the SAME dict, with the right value:
    an expression on the way IN to 'computing', ``None`` on every way OUT."""
    files = _py_scan_files()
    assert files, "the python scan found no files — path resolution is broken"

    scan = _scan_python(files)
    assert scan.kept, (
        "the python scan resolved zero computation_status payloads — the chain-scope "
        "rule or the scan surface is broken (it must find the analytics_runner and "
        "job_worker writers)"
    )

    missing: list[str] = []
    wrong: list[str] = []
    for site in scan.kept:
        where = f"{_rel(site.path)}:{site.lineno}"
        if not _has_key(site.payload, _STAMP_KEY):
            missing.append(where)
            continue
        status = _dict_value(site.payload, _STATUS_KEY)
        stamp = _dict_value(site.payload, _STAMP_KEY)

        if isinstance(status, ast.Constant) and isinstance(status.value, str):
            if status.value == _ENTRY_STATUS:
                if _is_none(stamp):
                    wrong.append(
                        f"{where}: writes '{_ENTRY_STATUS}' but sets "
                        f"{_STAMP_KEY}=None — the row would be unreapable forever "
                        f"(NULL-stamp skip rule). Stamp a client-side UTC ISO "
                        f"timestamp instead."
                    )
            elif status.value in _TERMINAL_STATUSES:
                if not _is_none(stamp):
                    wrong.append(
                        f"{where}: terminal '{status.value}' must clear "
                        f"{_STAMP_KEY} to None; a stale stamp on a terminal row can "
                        f"re-trigger the reaper."
                    )
            else:
                raise AssertionError(
                    f"{where}: unrecognized {_STATUS_KEY} literal "
                    f"{status.value!r} — {_EXTEND}."
                )
        elif isinstance(status, ast.Name):
            # csv_status / composite_status — both are EXIT writers by construction.
            if not _is_none(stamp):
                wrong.append(
                    f"{where}: variable-status exit writer ({status.id}) must clear "
                    f"{_STAMP_KEY} to None."
                )
        else:
            raise AssertionError(
                f"{where}: unrecognized {_STATUS_KEY} value form "
                f"{type(status).__name__} (e.g. ComputationStatus.FAILED.value) — "
                f"a new writer style must redden this gate, never pass "
                f"unclassified; {_EXTEND}."
            )

    assert not missing, (
        "JOB-01: these strategy_analytics status writers do NOT co-locate "
        f"{_STAMP_KEY} in their payload. The pg_cron reaper keys on that column, so "
        "a 'computing' write without it is unreapable forever and a terminal write "
        "without it leaves a stale stamp:\n  " + "\n  ".join(missing)
    )
    assert not wrong, (
        "JOB-01: these strategy_analytics status writers carry "
        f"{_STAMP_KEY} with the WRONG value:\n  " + "\n  ".join(wrong)
    )


def test_python_writer_census_counts() -> None:
    """Anti-vacuity. EXACT literal counts so a NEW writer forces a conscious update
    of this census rather than sliding in under a green gate.

    Census (verified 2026-08-02 against the post-142-01/142-02 tree):
      * 12 status-writing dicts — 6 in ``analytics_runner.py`` (1 entry + 5 exits)
        and 6 in ``job_worker.py`` (5 terminal 'failed' + the composite success
        headline). The would-be 13th, ``scripts/reset_stuck_computing_rows.py``, is
        GONE: plan 142-02 deleted that broken one-off, which is why plan 142-03
        depends on it.
      * 2 of those 12 are reached ONLY through the n1 ``ast.Name`` arm — the
        ``payload`` bound in ``analytics_runner._mark_complete`` and the
        ``headline_payload`` bound in the OUTER ``run_stitch_composite_job`` body but
        upserted inside the NESTED ``_write_headline_and_by_basis``. This count is
        the n1 liveness proof: chain-scoping alone would silently DROP both and still
        report a plausible-looking total of 10.
      * exactly 1 write site is classified through the n2 parameter-default arm —
        ``job_worker._prestamp_dq_flags(payload: dict[str, Any] = _prestamp_payload)``.
        It resolves to a dict with keys {strategy_id, data_quality_flags} and NO
        status key, so it DROPS OUT of the kept set. Counting it across ALL write
        sites rather than kept ones is therefore the only liveness proof n2 can have.
        Without this arm the gate FAILS LOUD on that correct, deliberately-untouched
        partial upsert.
      * exactly 1 kept dict carries the literal 'computing'. A SECOND entry writer
        must be a conscious decision, never an accident.

    (A third n1 resolution exists — ``csv_flag_payload`` in ``analytics_runner``'s
    sibling-upsert failure arm — but it is a partial data_quality_flags upsert with
    no status key, so it is not among the 12 and is not counted here.)
    """
    EXPECTED_STATUS_DICTS = 12
    EXPECTED_RUNNER_DICTS = 6
    EXPECTED_WORKER_DICTS = 6
    EXPECTED_KEPT_VIA_N1 = 2
    EXPECTED_SITES_VIA_N2 = 1
    EXPECTED_COMPUTING_DICTS = 1

    scan = _scan_python(_py_scan_files())

    assert len(scan.kept) == EXPECTED_STATUS_DICTS, (
        f"expected exactly {EXPECTED_STATUS_DICTS} python strategy_analytics "
        f"status-writing dicts, found {len(scan.kept)}:\n  "
        + "\n  ".join(f"{_rel(s.path)}:{s.lineno}" for s in scan.kept)
        + "\nA new status writer must update this census AND stamp/clear the "
        "reaper key."
    )

    per_file = {
        "analytics_runner.py": EXPECTED_RUNNER_DICTS,
        "job_worker.py": EXPECTED_WORKER_DICTS,
    }
    for filename, expected in per_file.items():
        actual = sum(1 for s in scan.kept if s.path.name == filename)
        assert actual == expected, (
            f"expected {expected} status dicts in {filename}, found {actual}"
        )

    kept_via_n1 = [s for s in scan.kept if s.arm == "n1"]
    assert len(kept_via_n1) == EXPECTED_KEPT_VIA_N1, (
        f"expected exactly {EXPECTED_KEPT_VIA_N1} kept payloads resolved through the "
        f"n1 ast.Name arm, found {len(kept_via_n1)}:\n  "
        + "\n  ".join(f"{_rel(s.path)}:{s.lineno}" for s in kept_via_n1)
        + "\nIf this drops to 0 the Name-resolution arm is dead and two real exit "
        "writers are invisible to the gate."
    )

    via_n2 = [s for s in scan.all_sites if s.arm == "n2"]
    assert len(via_n2) == EXPECTED_SITES_VIA_N2, (
        f"expected exactly {EXPECTED_SITES_VIA_N2} write site resolved through the "
        f"n2 parameter-default arm, found {len(via_n2)}:\n  "
        + "\n  ".join(f"{_rel(s.path)}:{s.lineno}" for s in via_n2)
        + "\nThis counter is n2's ONLY liveness proof — its one site resolves to a "
        "dict with no status key and drops out of the kept set."
    )

    computing = [
        s
        for s in scan.kept
        if isinstance(v := _dict_value(s.payload, _STATUS_KEY), ast.Constant)
        and v.value == _ENTRY_STATUS
    ]
    assert len(computing) == EXPECTED_COMPUTING_DICTS, (
        f"expected exactly {EXPECTED_COMPUTING_DICTS} python payload writing the "
        f"literal '{_ENTRY_STATUS}', found {len(computing)}:\n  "
        + "\n  ".join(f"{_rel(s.path)}:{s.lineno}" for s in computing)
        + "\nA second entry writer must be a conscious decision (and must stamp)."
    )


def test_portfolio_router_has_zero_findings() -> None:
    """The false-positive exclusion, asserted rather than assumed.

    ``routers/portfolio.py`` carries ``computation_status`` dicts for the
    ``portfolio_analytics`` table AND ``strategy_analytics`` ``.select()`` reads in
    the same functions. Chain-scoping on the write verb + table literal must yield
    ZERO ``strategy_analytics`` write sites there. If this ever fails, the scan has
    been loosened to function scope and is flagging the wrong table.
    """
    path = (_repo_root() / "analytics-service" / "routers" / "portfolio.py").resolve()
    assert path.exists(), f"expected analog file missing: {path}"

    sites = _collect_write_sites(path)
    assert sites == [], (
        "routers/portfolio.py must yield zero strategy_analytics WRITE sites — its "
        "computation_status payloads target portfolio_analytics and its "
        "strategy_analytics chains are .select() reads:\n  "
        + "\n  ".join(f"{_rel(s.path)}:{s.lineno}" for s in sites)
    )

    # Positive control: the file really does contain the shapes this test claims,
    # so a rename or a path break cannot make the zero above vacuous.
    source = path.read_text(encoding="utf-8")
    assert 'table("portfolio_analytics")' in source, (
        "portfolio.py no longer writes portfolio_analytics — this exclusion test is "
        "now vacuous; re-point it at whatever carries the same-function trap."
    )
    assert f'table("{_TABLE}")' in source, (
        "portfolio.py no longer touches strategy_analytics — this exclusion test is "
        "now vacuous."
    )


# ---------------------------------------------------------------------------
# TypeScript half — textual, anchored on object-literal PROPERTY KEYS
# ---------------------------------------------------------------------------

# Matches an object-literal property key `computation_status:`. Deliberately does
# NOT match the optional-property TYPE form `computation_status?:`
# (csv-finalize/route.ts:746) — the `?` sits between the name and the colon.
_TS_KEY_RE: Final[re.Pattern[str]] = re.compile(r"\bcomputation_status\s*:")


class _TsHit(NamedTuple):
    path: Path
    lineno: int


def _ts_scan_files() -> list[Path]:
    """``src/app/api/**/*.ts`` route handlers, excluding tests. See the module
    docstring for why this boundary is not widened."""
    api = _repo_root() / "src" / "app" / "api"
    return sorted(
        p
        for p in api.rglob("*.ts")
        if not p.name.endswith(".test.ts")
    )


def _ts_effective_lines(path: Path) -> list[str]:
    """File lines with pure-comment lines blanked out (line numbers preserved)."""
    return [
        "" if _is_pure_comment(line, lang="ts") else line
        for line in path.read_text(encoding="utf-8").splitlines()
    ]


def _enclosing_object_literal(text: str, pos: int, where: str) -> str:
    """The brace-matched object literal containing offset ``pos``.

    Scans BACK to the unbalanced ``{`` and FORWARD to its match. Anchoring on the
    literal rather than on a ``from("strategy_analytics")`` statement window is
    mandatory: the keys/sync failed payload is built inside ``compositeMemberCount``
    and passed as an ARGUMENT to ``stampCompositeFailedUnlessComplete``, whose
    ``from()`` calls are ~76 lines away — no window around a ``from()`` contains it,
    so the SC-5c mutation could never go RED. Window-scanning would also
    false-positive on three read-only ``.select()`` sites.
    """
    depth = 0
    start = -1
    for i in range(pos, -1, -1):
        ch = text[i]
        if ch == "}":
            depth += 1
        elif ch == "{":
            if depth == 0:
                start = i
                break
            depth -= 1
    if start < 0:
        raise AssertionError(
            f"{where}: could not find the enclosing object literal's opening brace; "
            f"{_EXTEND}."
        )
    depth = 0
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    raise AssertionError(
        f"{where}: enclosing object literal is unterminated; {_EXTEND}."
    )


def _scan_typescript() -> list[_TsHit]:
    hits: list[_TsHit] = []
    for path in _ts_scan_files():
        lines = _ts_effective_lines(path)
        for index, line in enumerate(lines):
            # `.select("computation_status")` carries no key-colon form after comment
            # stripping; excluded anyway for hygiene.
            if ".select(" in line:
                continue
            if _TS_KEY_RE.search(line):
                hits.append(_TsHit(path, index + 1))
    return hits


def test_typescript_route_payloads_clear_the_stamp() -> None:
    """Every ``computation_status`` payload key in an ``src/app/api`` route handler
    sits in an object literal that ALSO carries ``computing_started_at``.

    All four are terminal-'failed' placeholder writers, i.e. exit writers from
    'computing', so each must clear the reaper key.
    """
    files = _ts_scan_files()
    assert files, "the typescript scan found no files — path resolution is broken"

    hits = _scan_typescript()
    assert hits, (
        "the typescript scan found zero computation_status payload keys — the regex "
        "or the scan surface is broken (the four census sites must be found)"
    )

    offenders: list[str] = []
    for hit in hits:
        where = f"{_rel(hit.path)}:{hit.lineno}"
        text = "\n".join(_ts_effective_lines(hit.path))
        # Re-locate the hit inside the joined effective text.
        offset = sum(
            len(line) + 1
            for line in _ts_effective_lines(hit.path)[: hit.lineno - 1]
        )
        match = _TS_KEY_RE.search(text, offset)
        assert match is not None, f"{where}: internal offset mismatch; {_EXTEND}."
        literal = _enclosing_object_literal(text, match.start(), where)
        if _STAMP_KEY not in literal:
            offenders.append(where)

    assert not offenders, (
        "JOB-01: these Next.js API-route strategy_analytics payloads write "
        f"{_STATUS_KEY} without clearing {_STAMP_KEY} in the same object literal. "
        "They are exit writers from 'computing'; a stale stamp on a terminal row can "
        "re-trigger the pg_cron reaper:\n  " + "\n  ".join(offenders)
    )


def test_typescript_writer_census_counts() -> None:
    """Anti-vacuity for the TS half. Per-FILE counts (robust to line drift) plus the
    total, so a 5th payload site, a moved one, or a missing one all FAIL LOUD.

    Census (checker-verified, exactly 4 in non-test code):
      finalize-wizard/route.ts ×2 — the unknowable-membership stamp in
      ``compositeMemberCount`` and the composite-unsupported stamp;
      csv-finalize/route.ts ×1 — ``writeFailedStrategyAnalyticsPlaceholder``;
      keys/sync/route.ts ×1 — the ``stampCompositeFailedUnlessComplete`` argument.
    """
    EXPECTED_PER_FILE: Final[dict[str, int]] = {
        "src/app/api/strategies/finalize-wizard/route.ts": 2,
        "src/app/api/strategies/csv-finalize/route.ts": 1,
        "src/app/api/keys/sync/route.ts": 1,
    }
    EXPECTED_TOTAL = 4

    hits = _scan_typescript()
    actual: dict[str, int] = {}
    for hit in hits:
        key = _rel(hit.path)
        actual[key] = actual.get(key, 0) + 1

    unexpected = sorted(set(actual) - set(EXPECTED_PER_FILE))
    assert not unexpected, (
        "a computation_status payload key appeared in an API route the JOB-01 census "
        f"does not know about — it must stamp/clear too; {_EXTEND}:\n  "
        + "\n  ".join(
            f"{_rel(h.path)}:{h.lineno}"
            for h in hits
            if _rel(h.path) in unexpected
        )
    )
    for filename, expected in EXPECTED_PER_FILE.items():
        assert actual.get(filename, 0) == expected, (
            f"expected {expected} computation_status payload key(s) in {filename}, "
            f"found {actual.get(filename, 0)}. A moved or deleted writer must be a "
            "conscious census update."
        )
    assert len(hits) == EXPECTED_TOTAL, (
        f"expected exactly {EXPECTED_TOTAL} TS payload sites, found {len(hits)}"
    )
