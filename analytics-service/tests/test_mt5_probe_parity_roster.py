"""153.6-05 / **PARITY-01 (guard half)** — the structural answer to ONE question:

    does a HAND-WRITTEN second copy of the MT5 probe body exist anywhere?

Plan 153.6-01 removed today's duplicates: `routers/exchange.py` and
`services/ingestion/mt5.py` each carried their own `_assert_expected_login` /
`_read_terminal` / `_probe` closures, the router's copy had three fixes the
worker's copy did not, and both now delegate to `services/mt5_probe.py`. That is
an extraction, and an extraction is a fact about TODAY. The property that has to
survive the NEXT author is *"nobody writes a fourth copy"* — which no amount of
deleting can establish. This file is the part that reds when somebody does.

⭐ **TWO GUARDS, TWO QUESTIONS. Do not ask either to do the other's job.**

| Guard | Question it answers | Can it catch a behavioural divergence? |
|---|---|---|
| this file (structural) | *"does a hand-written second copy of the probe body EXIST?"* | ❌ never — and it must not be asked to |
| `tests/test_mt5_validate_parity.py` (behavioural) | *"do the two paths DISPOSE of the same input identically?"* | ✅ that is its only job |

The split matters in both directions. Two hand-written copies that happen to
agree today pass every behavioural case and are exactly the state 153.3 shipped —
so the behavioural guard cannot see the risk. And a single shared body that
somebody breaks is invisible HERE, because one wrong copy is still one copy. Both
files cross-reference each other; the parity file names this one in its docstring.

⭐ `ast`, never a regex. Comments and docstrings are structurally ABSENT from an
AST, so the comment-inflation hazard that defeated `EMITTER_RE` (153-PATTERNS §2 —
"a scanner that matches nothing looks identical to a clean codebase") cannot arise
here, and no comment-stripping pass is needed. ⛔ Do not "simplify" this into a
grep: all three scanned files name `terminal_info`, `order_check` and `run_probe`
repeatedly in PROSE — `services/ingestion/mt5.py:225-239` is a nine-line comment
about the very closures it no longer has, and a grep would read that incident
record as the incident.

⛔ Source FILES are read by path and `ast.parse`d. Never `inspect.getsource` on an
imported module: importing `routers.exchange` loads it with the real slowapi
limiter and pollutes `sys.modules`, breaking `test_exchange_router_c0202`'s
stub-reload fixture downstream (the constraint `tests/test_exchange.py` records,
restated at `tests/test_mt5_abandon_roster.py:42-46`). That warning is directly
load-bearing here: `routers/exchange.py` is one of the three files scanned.

⛔ **EVERY FLOOR BELOW IS PER-FILE, AND THERE IS DELIBERATELY NO TOTAL.** Both
existing rosters (`test_mt5_abandon_roster.py`, `test_mt5_shutdown_roster.py`) pin
exactly ONE file, so the question never arose for them; this one spans three. A
floor summed across three files is a floor two healthy files can pay on behalf of
a collapsed third — a renamed module, a moved file, a predicate that stopped
matching in one place — and the collapsed file's assertions then pass vacuously
while the total looks fine. The per-file floors also make the failure MESSAGE name
which file went quiet, which a total cannot.

Anti-vacuity is the whole design, not a comment. This file's headline assertion is
"no unit outside `services/mt5_probe.py` calls a probe verb", and a predicate that
silently stopped matching satisfies it perfectly: an unfixed fourth copy and a
clean tree look identical from here. Hence the second kind of per-file floor —
`PROBE_VERB_UNITS_IN_HOME_FLOOR` — which asserts the predicate STILL FIRES in the
one module where it must, and which no unit count anywhere could substitute for.
"""
from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path

import pytest

# --------------------------------------------------------------------------- #
# The pins — hand-typed literals, MEASURED 2026-08-11 against the tree at
# 153.6-05 Task 3 (i.e. after plan 153.6-01 landed the extraction).
# --------------------------------------------------------------------------- #

#: The home of the ONE probe body. A unit here is allowed — required, in fact —
#: to call the terminal verbs directly; that is what makes it the home.
PROBE_HOME = "services/mt5_probe.py"

#: The two files that used to carry their own copy. Named individually rather
#: than globbed: a glob that stopped matching would silently scan nothing, and
#: "which files must be checked" is precisely the fact this roster is pinning.
CALLER_RELPATHS: tuple[str, ...] = (
    "routers/exchange.py",
    "services/ingestion/mt5.py",
)

#: ⛔ HAND-TYPED, never derived from a directory walk. Order is home-last only for
#: readability; nothing depends on it.
SCANNED_RELPATHS: tuple[str, ...] = CALLER_RELPATHS + (PROBE_HOME,)

#: The verbs the probe body reaches the terminal through — `Mt5Client` methods,
#: every one of them. A unit whose body CALLS one of these is executing probe
#: mechanics itself rather than delegating them.
#:
#: ⚠️ Why these four and not `release` / `close`: the callers legitimately own
#: session lifecycle (the router's Pitfall-6 `finally`, the adapter's close-
#: `finally`). Lifecycle is not probe mechanics, and pinning it here would red on
#: correct code.
PROBE_VERBS: frozenset[str] = frozenset(
    {"login", "account_info", "terminal_info", "order_check"}
)

#: The public surface of `services/mt5_probe.py`. A caller that names any of these
#: is DELEGATING, which is the whole point of the extraction.
DELEGATION_NAMES: frozenset[str] = frozenset(
    {"run_probe", "read_terminal", "assert_expected_login"}
)

#: ⛔ THE PER-FILE WALK FLOORS, hand-typed. MEASURED 2026-08-11: exchange.py 7
#: units, ingestion/mt5.py 8, mt5_probe.py 4. Each floor is one below its
#: measurement so ordinary growth never flaps.
#:
#: ⛔ NEVER compute any of these as `len(derived) - 1`. A size compared against its
#: own derivation cannot fail — the self-referential unfailable floor
#: `test_mt5_shutdown_roster.py:33-37` forbids and `test_mt5_abandon_roster.py:126`
#: restates — and here it would be worse than useless: a collapsed walk derives an
#: EMPTY unit set, and an empty set satisfies "no unit outside the home calls a
#: probe verb" vacuously and forever.
UNIT_FLOORS: dict[str, int] = {
    "routers/exchange.py": 6,
    "services/ingestion/mt5.py": 7,
    "services/mt5_probe.py": 3,
}

#: ⭐ THE FLOOR NO UNIT COUNT CAN SUBSTITUTE FOR. MEASURED 2026-08-11: exactly two
#: units in `services/mt5_probe.py` call a probe verb — `read_terminal`
#: (`terminal_info`) and `run_probe` (`login`, `account_info`, `order_check`).
#:
#: This is the anti-vacuity fence on the PREDICATE rather than on the walk. If
#: `_calls_probe_verb` ever stops matching — a rename, a re-spelling, a receiver
#: shape nobody anticipated — every unit count in this file stays exactly right
#: while the headline assertion goes green over nothing at all. Pinned at the
#: measured value, not one below: growth in the home module is a deliberate act
#: and re-cutting this number is the intended cost of it.
PROBE_VERB_UNITS_IN_HOME_FLOOR = 2

#: MEASURED 2026-08-11: one delegating unit per caller —
#: `_validate_mt5_key_probe` in the router, `Mt5Adapter.validate` in the adapter.
#: ⛔ A caller that drops to zero has either stopped validating MT5 at all or has
#: grown its own copy again; either way the extraction is gone.
DELEGATION_FLOORS: dict[str, int] = {
    "routers/exchange.py": 1,
    "services/ingestion/mt5.py": 1,
}

_ROOT = Path(__file__).resolve().parents[1]  # analytics-service/


# --------------------------------------------------------------------------- #
# The scanner
# --------------------------------------------------------------------------- #

_FUNC_NODES = (ast.FunctionDef, ast.AsyncFunctionDef)


def _called_name(node: ast.Call) -> str | None:
    """The bare name a Call invokes, for BOTH syntactic forms.

    `ast.Attribute` catches `mt5_probe.run_probe(...)` and `client.login(...)`;
    `ast.Name` catches the `from services.mt5_probe import run_probe` /
    `run_probe(...)` indirection both callers actually use. Matching only the
    first would make the shipped import style look like no delegation at all.
    """
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return None


def _calls_probe_verb(node: ast.AST) -> str | None:
    """A call of a probe verb ON SOME RECEIVER — `<anything>.terminal_info(...)`.

    ⭐ The RECEIVER is deliberately unconstrained. The probe body reaches the
    terminal through whatever handle it was given: `client.login(...)` in
    `mt5_probe.run_probe` today, but a hand-written copy would just as plausibly
    write `self._client.order_check(...)` or `mt5.terminal_info(...)`. Pinning the
    receiver name would let the next copy walk straight past this guard, which is
    the bare-reference hole `test_mt5_shutdown_roster.py:74-97` records.

    ⛔ ATTRIBUTE CALLS ONLY, and that is a considered narrowing rather than an
    oversight. All four verbs are `Mt5Client` METHODS; there is no module-level
    function of any of these names anywhere in the tree, so a bare `login(...)`
    in these three files is somebody's local helper and not a terminal round-trip.
    Widening to `ast.Name` would report `parse_mt5_credentials`-style helpers as
    probe copies and the roster would be weakened until it was green again.
    """
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in PROBE_VERBS
    ):
        return node.func.attr
    return None


@dataclass
class UnitScan:
    """One outermost `def` of a scanned file, and every fact the roster needs."""

    qualname: str
    relpath: str
    lineno: int
    #: probe verbs called anywhere in the body, NESTED CLOSURES INCLUDED — both
    #: callers wrap their delegation in a `def _probe()` closure, and the reported
    #: name is the OUTERMOST def because the mechanics belong to the VERB and not
    #: to whichever helper it happens to use this month (the same outermost rule
    #: as `test_mt5_abandon_roster.py:207-211`).
    probe_verbs: set[str] = field(default_factory=set)
    #: names from `services/mt5_probe.py`'s public surface called in the body
    delegates_to: set[str] = field(default_factory=set)

    @property
    def calls_probe_body(self) -> bool:
        return bool(self.probe_verbs)

    @property
    def delegates(self) -> bool:
        return bool(self.delegates_to)


def scan_source(source: str, relpath: str) -> dict[str, UnitScan]:
    """Parse ONE source string and return `{qualified name: UnitScan}` for every
    OUTERMOST function it defines.

    A "unit" is a `def`/`async def` that is not lexically nested inside another
    `def`. Class bodies are traversed (a `ClassDef` is not a `def`), so
    `Mt5Adapter.validate` is a unit and is reported under its qualified name —
    two classes in one file may legitimately carry same-named methods, and a bare
    name would silently merge them.

    Exposed separately from the file read so the self-tests can drive it against
    hand-written syntax. ⛔ Without that seam the predicates would only ever be
    exercised by the source they are meant to police, and one that returned
    "no copy here" unconditionally would be indistinguishable from a correct one.
    """
    tree = ast.parse(source, filename=relpath)
    out: dict[str, UnitScan] = {}

    def _collect(node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, _FUNC_NODES):
                scan = UnitScan(
                    qualname=prefix + child.name,
                    relpath=relpath,
                    lineno=child.lineno,
                )
                for sub in ast.walk(child):
                    verb = _calls_probe_verb(sub)
                    if verb is not None:
                        scan.probe_verbs.add(verb)
                    if isinstance(sub, ast.Call):
                        name = _called_name(sub)
                        if name in DELEGATION_NAMES:
                            scan.delegates_to.add(name)
                out[scan.qualname] = scan
                # ⛔ Do NOT descend for further UNITS: a nested closure's facts
                # belong to its outermost enclosing def (they were collected by
                # the `ast.walk` above).
            elif isinstance(child, ast.ClassDef):
                _collect(child, prefix + child.name + ".")
            else:
                _collect(child, prefix)

    _collect(tree, "")
    return out


@pytest.fixture(scope="module")
def scans() -> dict[str, dict[str, UnitScan]]:
    """Scan the three files ONCE per module, by PATH — never by import."""
    return {
        rel: scan_source((_ROOT / rel).read_text(), rel) for rel in SCANNED_RELPATHS
    }


def _copies_outside_home(scans: dict[str, dict[str, UnitScan]]) -> list[str]:
    return sorted(
        f"{rel}::{u.qualname} (line {u.lineno}) calls {sorted(u.probe_verbs)}"
        for rel, units in scans.items()
        if rel != PROBE_HOME
        for u in units.values()
        if u.calls_probe_body
    )


# --------------------------------------------------------------------------- #
# 0. Anti-vacuity — PER FILE, with the predicate spelled out in the message
# --------------------------------------------------------------------------- #


def test_the_scan_actually_read_every_file(
    scans: dict[str, dict[str, UnitScan]],
) -> None:
    """⛔ THE LOAD-BEARING FLOORS, asserted INDEPENDENTLY PER FILE.

    Every other assertion in this file is of the form "no derived X has property
    P", and a derivation that collapsed to the empty set satisfies all of them. A
    single summed floor would let two healthy files pay for a third that went
    quiet; these three cannot.
    """
    assert set(scans) == set(SCANNED_RELPATHS), (
        f"the fixture scanned {sorted(scans)}, expected {sorted(SCANNED_RELPATHS)}"
    )
    for relpath in SCANNED_RELPATHS:
        units = scans[relpath]
        floor = UNIT_FLOORS[relpath]
        assert len(units) >= floor, (
            f"the walk of {relpath} found only {len(units)} outermost functions "
            f"(hand-typed floor {floor}; MEASURED 2026-08-11: exchange.py 7, "
            f"ingestion/mt5.py 8, mt5_probe.py 4). Derived: {sorted(units)}. The "
            "PREDICATE is: every ast.FunctionDef/AsyncFunctionDef that is not "
            "lexically nested inside another one, traversing ClassDef bodies. "
            "Below the floor means the walk stopped reading this file — a moved "
            "module, a renamed path, a parse that yielded nothing — and every "
            "assertion about this file below is then vacuous. ⛔ Do NOT lower "
            "this floor to make it pass."
        )


def test_the_probe_verb_predicate_still_fires_in_its_home(
    scans: dict[str, dict[str, UnitScan]],
) -> None:
    """⭐ THE ANTI-VACUITY FENCE ON THE PREDICATE, not on the walk — and the one
    fact no unit count in this file can substitute for.

    The headline assertion is "no unit OUTSIDE `services/mt5_probe.py` calls a
    probe verb". A `_calls_probe_verb` that silently stopped matching makes that
    true of every possible source, while all three per-file walk floors stay
    exactly right. The home module is where the predicate MUST fire, so pinning
    it there is what separates "no second copy exists" from "the scanner is
    broken".
    """
    home = scans[PROBE_HOME]
    firing = sorted(name for name, u in home.items() if u.calls_probe_body)
    assert len(firing) >= PROBE_VERB_UNITS_IN_HOME_FLOOR, (
        f"only {len(firing)} unit(s) in {PROBE_HOME} were derived as calling a "
        f"probe verb (hand-typed floor {PROBE_VERB_UNITS_IN_HOME_FLOOR}, MEASURED "
        f"2026-08-11: read_terminal + run_probe); derived {firing}. Either the "
        "probe body left this module — in which case find out where it WENT "
        "before touching this number — or `_calls_probe_verb` stopped matching, "
        f"in which case every other assertion here is now vacuous. PROBE_VERBS is "
        f"{sorted(PROBE_VERBS)} and the shape matched is "
        "`<any receiver>.<verb>(...)`."
    )
    # ...and the four verbs are all still reachable from this module, so a
    # predicate that degraded to matching ONE of them is caught too.
    reached = set().union(*(u.probe_verbs for u in home.values())) if home else set()
    assert reached == PROBE_VERBS, (
        f"{PROBE_HOME} reaches {sorted(reached)}, expected all of "
        f"{sorted(PROBE_VERBS)}. A verb that vanished from the home module is "
        "either genuinely gone from the probe (re-cut PROBE_VERBS deliberately "
        "and say why) or is now being called somewhere this roster does not scan."
    )


# --------------------------------------------------------------------------- #
# 1. THE ROSTER: the probe body exists ONCE, and both callers reach it
# --------------------------------------------------------------------------- #


def test_no_hand_written_second_copy_of_the_probe_body_exists(
    scans: dict[str, dict[str, UnitScan]],
) -> None:
    """⭐ THE QUESTION THIS FILE EXISTS FOR.

    Reds without anybody hand-editing a roster: the home is typed out here, the
    offending set is DERIVED from source, and a function written next month that
    reaches the terminal through a verb nobody has thought of yet lands in the
    difference with ZERO pin edits.

    WHY IT MATTERS (Rule 9). This is not a tidiness rule. 153.3 landed three fixes
    on the router's copy of exactly this body — the terminal short-circuit, the
    class-only broad arm, the operator-fault refusal — and NONE of them reached
    the worker's copy, because there were two copies and nothing said so. The
    worker consequently accused users' broker servers of a checkbox in our own
    gateway, and retried a permanent fault forever against the ONE shared
    terminal. A behavioural guard cannot see that risk: two copies that agree
    today pass every case it has.
    """
    offenders = _copies_outside_home(scans)
    assert offenders == [], (
        "a HAND-WRITTEN copy of the MT5 probe body exists outside "
        f"{PROBE_HOME}:\n  " + "\n  ".join(offenders) + "\n"
        "Call into `services.mt5_probe` instead. ⛔ Do NOT 'fix' this by adding "
        "the offending name to an exemption list: the exemption is the divergence "
        "— 153.3's three fixes landed on one copy of this body and never reached "
        "the other, which is the whole reason the module exists. If a call site "
        "genuinely needs different MECHANICS (as opposed to a different "
        "DISPOSITION, which stays at the call site by design), that is a change "
        "to the shared body, made once."
    )


def test_each_caller_delegates_to_the_shared_module(
    scans: dict[str, dict[str, UnitScan]],
) -> None:
    """The other half, and it is not implied by the first.

    "No caller writes probe mechanics" is satisfied perfectly by a caller that
    stopped validating MT5 altogether — and would also be satisfied on the day
    somebody moves the mechanics into a THIRD unscanned module. Asserting that
    each caller still reaches `services/mt5_probe.py` is what keeps the roster
    pointed at a live seam rather than at an absence.
    """
    for relpath in CALLER_RELPATHS:
        delegating = sorted(
            name for name, u in scans[relpath].items() if u.delegates
        )
        floor = DELEGATION_FLOORS[relpath]
        assert len(delegating) >= floor, (
            f"{relpath} has {len(delegating)} unit(s) delegating to "
            f"{PROBE_HOME} (hand-typed floor {floor}; MEASURED 2026-08-11: "
            "_validate_mt5_key_probe in the router, Mt5Adapter.validate in the "
            f"adapter); derived {delegating}. The names matched are "
            f"{sorted(DELEGATION_NAMES)}, in either the bare-import or the "
            "module-attribute call shape. Zero means the seam is gone — either "
            "the path stopped validating MT5, or its mechanics moved somewhere "
            "this roster does not scan, which is the same defect in a new place."
        )


def test_the_home_module_is_the_one_that_owns_the_mechanics(
    scans: dict[str, dict[str, UnitScan]],
) -> None:
    """Stated as its own fact so the roster's SHAPE cannot be satisfied by moving
    the body to a fourth module and leaving `mt5_probe.py` an empty shim.

    (`SCANNED_RELPATHS` is hand-typed for the same reason: a glob that stopped
    matching would scan nothing and pass.)"""
    home_callers = {
        name for name, u in scans[PROBE_HOME].items() if u.calls_probe_body
    }
    assert "run_probe" in home_callers and "read_terminal" in home_callers, (
        f"{PROBE_HOME} no longer contains the probe mechanics; units calling a "
        f"probe verb there are {sorted(home_callers)}. If the body moved, re-cut "
        "PROBE_HOME and SCANNED_RELPATHS deliberately — do not delete this pin."
    )


# --------------------------------------------------------------------------- #
# 2. SELF-TESTS — the predicates have teeth, in BOTH directions
# --------------------------------------------------------------------------- #


def test_selftest_a_copy_and_a_delegation_are_told_apart() -> None:
    """⭐ THE MOST IMPORTANT CASE IN THE FILE.

    A DELEGATING synthetic and a hand-COPIED one are driven through ONE call, and
    both verdicts are asserted. ⛔ Without the copied half, "no second copy
    exists" is indistinguishable from a predicate that returns "clean"
    unconditionally — the whole roster would then be a fixture that can never red,
    which is the exact shape of the bug it exists to catch.
    """
    src = (
        "def delegating_caller(client):\n"
        '    """What both call sites do today."""\n'
        "    def _probe():\n"
        "        return run_probe(client, login=1, investor_pw='x', server='y',\n"
        "                         log_prefix='p')\n"
        "    return _probe()\n"
        "\n"
        "def hand_written_copy(client):\n"
        '    """The fourth copy somebody writes next month."""\n'
        "    client.login(1, 'x', 'y')\n"
        "    info = client.account_info()\n"
        "    terminal = client.terminal_info()\n"
        "    return client.order_check({})\n"
    )
    scan = scan_source(src, "synthetic/a.py")
    verdicts = {
        name: (u.calls_probe_body, u.delegates) for name, u in scan.items()
    }
    assert verdicts == {
        "delegating_caller": (False, True),
        "hand_written_copy": (True, False),
    }, verdicts

    # ...and the roster's own arithmetic REPORTS the copy and only the copy.
    offenders = _copies_outside_home({"synthetic/a.py": scan})
    assert len(offenders) == 1 and "hand_written_copy" in offenders[0], offenders
    assert scan["hand_written_copy"].probe_verbs == PROBE_VERBS


def test_selftest_prose_is_ignored() -> None:
    """This is what a grep could not do.

    All four probe verbs appear in a docstring, a comment and a plain string
    literal, and NOTHING is called. Comments and docstrings are structurally
    absent from an AST, so the unit is reported as neither copying nor delegating.
    `services/ingestion/mt5.py:225-239` is exactly this shape — a nine-line
    comment naming the `_read_terminal` / `_probe` closures it no longer has — so
    a grep-based roster would report the incident record as the incident.
    """
    src = (
        "def prose_only(client):\n"
        '    """Never call client.terminal_info() here — use run_probe."""\n'
        "    # client.login(...) / client.order_check(...) belong in mt5_probe\n"
        '    msg = "client.account_info() / client.terminal_info()"\n'
        "    return msg\n"
    )
    scan = scan_source(src, "synthetic/b.py")
    assert scan["prose_only"].calls_probe_body is False
    assert scan["prose_only"].delegates is False


def test_selftest_a_verb_inside_a_nested_closure_is_the_outermost_def_s() -> None:
    """⭐ THE SHAPE BOTH CALL SITES ACTUALLY HAVE.

    The probe is wrapped in a `def _probe()` closure at both sites (it is handed
    to `asyncio.to_thread`), so a roster that reported the CLOSURE would name
    `_probe` in both files and go blind to the enclosing verb — and would red on a
    pure refactor that renamed the closure. The facts belong to the outermost
    enclosing def, which is where the permission lives.

    ⚠️ This is also why the roster keys on the BODY and never on the NAME `_probe`
    (153.6-01's own finding): both callers legitimately retain a thin `_probe`
    that only forwards, and a name-keyed roster would red on working code.
    """
    src = (
        "def outer(client):\n"
        "    def _probe():\n"
        "        return client.order_check({})\n"
        "    return _probe()\n"
    )
    scan = scan_source(src, "synthetic/c.py")
    assert set(scan) == {"outer"}, scan
    assert scan["outer"].probe_verbs == {"order_check"}


def test_selftest_the_receiver_shape_does_not_matter() -> None:
    """The verb is what makes it a probe copy, not the handle it arrives on.

    A hand-written copy is as likely to write `self._client.login(...)` or
    `mt5.terminal_info(...)` as `client.login(...)`. A predicate pinned to the
    receiver name would let the next copy walk straight past — the bare-reference
    hole `test_mt5_shutdown_roster.py:74-97` records, in a new costume.
    """
    src = (
        "class Adapter:\n"
        "    def via_attribute(self):\n"
        "        return self._client.login(1, 'x', 'y')\n"
        "\n"
        "    def via_alias(self):\n"
        "        mt5 = self._client\n"
        "        return mt5.terminal_info()\n"
        "\n"
        "def via_parameter(handed_in):\n"
        "    return handed_in.account_info()\n"
    )
    scan = scan_source(src, "synthetic/d.py")
    assert {name: sorted(u.probe_verbs) for name, u in scan.items()} == {
        "Adapter.via_attribute": ["login"],
        "Adapter.via_alias": ["terminal_info"],
        "via_parameter": ["account_info"],
    }


def test_selftest_the_delegation_predicate_sees_both_import_shapes() -> None:
    """`from services.mt5_probe import run_probe` + `run_probe(...)` is what both
    callers ship; `mt5_probe.run_probe(...)` is the equally valid re-spelling.
    Matching only one would make a legitimate style change look like the seam had
    been deleted, and invite somebody to "fix" it by writing a copy."""
    src = (
        "def bare_name(client):\n"
        "    return run_probe(client)\n"
        "\n"
        "def module_attribute(client):\n"
        "    return mt5_probe.run_probe(client)\n"
        "\n"
        "def reads_the_terminal(client):\n"
        "    return read_terminal(client, log_prefix='p')\n"
        "\n"
        "def unrelated(client):\n"
        "    return other.run(client)\n"
    )
    scan = scan_source(src, "synthetic/e.py")
    assert {name: u.delegates for name, u in scan.items()} == {
        "bare_name": True,
        "module_attribute": True,
        "reads_the_terminal": True,
        "unrelated": False,
    }


def test_selftest_class_methods_are_units_under_their_qualified_name() -> None:
    """`Mt5Adapter.validate` is the real delegating unit on the worker path, so a
    walk that skipped ClassDef bodies would find nothing there — and
    `DELEGATION_FLOORS` would then red for the wrong reason. Qualified because two
    classes in one file may carry same-named methods and a bare name merges them
    silently."""
    src = (
        "class A:\n"
        "    def validate(self, client):\n"
        "        return client.login(1, 'x', 'y')\n"
        "\n"
        "class B:\n"
        "    def validate(self, client):\n"
        "        return run_probe(client)\n"
    )
    scan = scan_source(src, "synthetic/f.py")
    assert set(scan) == {"A.validate", "B.validate"}, scan
    assert scan["A.validate"].calls_probe_body is True
    assert scan["B.validate"].calls_probe_body is False
    assert scan["B.validate"].delegates is True


def test_selftest_an_empty_source_yields_an_empty_scan() -> None:
    """A file that parses to nothing yields NO units rather than a silent pass —
    which is exactly why `test_the_scan_actually_read_every_file`'s PER-FILE
    floors are the first assertions in this file, and why there is no total."""
    assert scan_source("", "synthetic/g.py") == {}
    assert scan_source("X = 1\n", "synthetic/h.py") == {}
