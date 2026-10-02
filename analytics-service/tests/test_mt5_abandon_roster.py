"""153.5-05 / **D-36** — the structural answer to ONE question:

    does every method that touches the MT5 session CARRY the abandon fence?

This is the STATIC complement to the WIZFORM-ABANDON fence. `Mt5Client` is the only
production reach into the shared MT5 session (no other module under
`analytics-service/` imports `mt5linux` or names `MetaTrader5`), so the whole
question lives inside ONE class — and the property that has to survive the NEXT
author is not "these seven methods are fenced today", it is "**no** session-touching
method is unfenced". A hand-listed roster cannot say that: a method written next
month is simply absent from it. So the roster is DERIVED from the source of
`services/mt5_client.py` and compared against hand-typed pins.

⭐ **TWO GUARDS, TWO QUESTIONS. Do not ask either to do the other's job.**

| Guard | Question it answers | Can it catch abandonment? |
|---|---|---|
| this file (D-36 static) | *"does every session-touching method CARRY the check?"* | ❌ never — and it must not be asked to |
| `tests/test_mt5_abandon_fence.py` (D-37, guard #16) | *"is the check ENFORCED when the lease has moved on?"* | ✅ that is its only job |

⛔ **Never extend this file with `to_thread`/`wait_for` proximity heuristics.**
Abandonment is a TEMPORAL property and every assertion here is a LEXICAL one. The
proof that static analysis cannot reach it already exists in this suite and is
concrete rather than theoretical: `test_mt5_shutdown_roster.py`'s
`test_every_restart_call_site_holds_the_terminal_lease` is **green on finding #5
today**, because the abandoned `restart` is written inside the `async with` and
merely RUNS outside it. A static approximation of a temporal property produces
false greens (the class this milestone has paid for sixteen times) or false reds
that get weakened until they are green again. The runtime half lives in
`tests/test_mt5_abandon_fence.py`; cross-referenced there, both ways.

⭐ `ast`, never a regex. Comments and docstrings are structurally ABSENT from an
AST, so the comment-inflation hazard that defeated `EMITTER_RE` (153-PATTERNS §2 —
"a scanner that matches nothing looks identical to a clean codebase") cannot arise
here, and no comment-stripping pass is needed. ⛔ Do not "simplify" this into a
grep: `mt5_client.py` names `self._mt5` and `_assert_live` dozens of times in
prose — in `_assert_live`'s own docstring, in the D-41 exemption comment, and in
`_teardown_transport`'s "`mt5_obj` is passed explicitly rather than read from
`self._mt5`" note, which a grep would read as a session touch inside the one
method that provably has none.

⛔ Source FILES are read by path and `ast.parse`d. Never `inspect.getsource` on an
imported module: importing `routers.exchange` loads it with the real slowapi
limiter and pollutes `sys.modules`, breaking `test_exchange_router_c0202`'s
stub-reload fixture downstream (the constraint `tests/test_exchange.py` records).

Anti-vacuity is explicit and load-bearing. A scanner whose predicate silently
stopped matching would derive an EMPTY touching set, and an empty set satisfies
"every touching method is fenced" perfectly — an unfenced class and a fully fenced
one look identical from here. Every floor below is a HAND-TYPED literal, never a
derived collection compared against its own `len()` (a size compared against its
own derivation cannot fail).
"""
from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path

import pytest

# --------------------------------------------------------------------------- #
# The pins — hand-typed literals, MEASURED 2026-08-11 against the tree at
# 153.5-05 Task 1 (i.e. after plans 01 and 02 landed the fence).
# --------------------------------------------------------------------------- #

#: The ONE file and the ONE class that reach the shared MT5 session.
CLIENT_RELPATH = "services/mt5_client.py"
CLIENT_CLASS = "Mt5Client"

#: The session handle, the fence, the construction-fence ContextVar and the epoch
#: reader — named ONCE each and used by both the predicates and their failure
#: messages, so a rename cannot leave a message describing a predicate that no
#: longer exists.
SESSION_ATTR = "_mt5"
GUARD_NAME = "_assert_live"
CONSTRUCTION_FENCE_VAR = "_MT5_LEASE_OCCUPANCY"
EPOCH_READER = "_mt5_epoch_for"

#: ⭐ D-41, HALF ONE: session-touching methods that MUST NOT carry the fence.
#: Asserted for EXACT equality against (touching − guarded), so a new unfenced
#: method reds with zero pin edits — that is the whole point of the file.
#:
#: ⛔ DO NOT "finish the job" by fencing these. Since D-35 they touch only OUR OWN
#: rpyc socket, and a fenced teardown strands it — reintroducing precisely the
#: Pitfall-6 leak that `routers/exchange.py:899-948` exists to prevent, i.e. the
#: fix would cause the bug it is fixing. `__init__` is exempt from the METHOD
#: fence only: it is covered by the SEPARATE construction mechanism (D-36 AMENDED
#: (ii), the lease-occupancy ContextVar), which is asserted below as its own fact
#: rather than folded into this one.
EXEMPT_TOUCHING: frozenset[str] = frozenset({"__init__", "close", "release"})

#: ⭐ D-41, HALF TWO — and it is a DIFFERENT KIND of exemption, which is why it is
#: a separate pin rather than a fourth name above. `_teardown_transport` is on
#: D-41's exempt list, but it never reaches `self._mt5` at all: it takes the
#: connection as its `mt5_obj` PARAMETER (`restart()` disposes the STALE object
#: after the fresh one is swapped in, so reading `self._mt5` there would dispose
#: the wrong socket). It is therefore invisible to the touch predicate, and
#: collapsing the two exemptions into one set would silently widen
#: `EXEMPT_TOUCHING` by a name the derivation can never produce — an exemption
#: that could then absorb a REAL unfenced method of the same name-shape.
#:
#: If `_teardown_transport` ever starts reading `self._mt5`, it lands in the
#: derived touching set and reds `EXEMPT_TOUCHING`'s equality. That red is
#: CORRECT: the verb must still stay unfenced (Pitfall 6), but its exemption has
#: changed kind and must be re-cut here deliberately.
EXEMPT_BY_PARAMETER: frozenset[str] = frozenset({"_teardown_transport"})

#: ⭐ D-41's exempt roster, DERIVED from the two kinds rather than typed a second
#: time — the `_TEARDOWN_NAMES` mechanism from `test_mt5_shutdown_roster.py:113`.
#: ⛔ Never replace this with a literal: a hand-maintained second copy is precisely
#: how `shutdown` came to be pinned as a call but not as a reference in the sibling
#: roster.
D41_EXEMPT: frozenset[str] = EXEMPT_TOUCHING | EXEMPT_BY_PARAMETER

#: Measured 7: `login`, `account_info`, `terminal_info`, `history_deals_get`,
#: `order_check`, `_raise_last`, `restart`. Asserted as `>=`, deliberately: a NEW
#: session-touching method is admitted by CARRYING the fence, never by lowering
#: this floor.
GUARDED_METHOD_FLOOR = 7

#: ⛔ THE LOAD-BEARING FLOOR, and a HAND-TYPED literal on purpose. Measured 10
#: methods whose body reaches `self._mt5` (the 7 fenced ones plus `__init__`,
#: `close`, `release`); the floor is one below so ordinary growth never flaps.
#:
#: ⛔ NEVER compute this as `len(derived) - 1`. A size compared against its own
#: derivation cannot fail, which is the self-referential unfailable floor
#: `test_mt5_shutdown_roster.py:33-37` forbids — and here it would be worse than
#: useless: a collapsed predicate derives an EMPTY touching set, and an empty set
#: satisfies every other assertion in this file vacuously.
SESSION_TOUCH_FLOOR = 9

#: Anti-vacuity on the CLASS walk itself. Measured 15 `def`s in `Mt5Client`.
CLIENT_METHOD_FLOOR = 12

#: `restart` is the ONE method whose fence is positional as well as present
#: (finding #5): the entry `_assert_live` passes trivially — the legitimate heal
#: runs BEFORE the release that bumps — so the load-bearing check is the inline
#: epoch comparison immediately ahead of the ONE permitted `stale.shutdown()`.
POSITIONAL_FENCE_METHOD = "restart"
POSITIONAL_FENCED_CALL = "shutdown"

_ROOT = Path(__file__).resolve().parents[1]  # analytics-service/


# --------------------------------------------------------------------------- #
# The scanner
# --------------------------------------------------------------------------- #


def _called_name(node: ast.Call) -> str | None:
    """The bare name a Call invokes, for BOTH syntactic forms.

    `ast.Attribute` catches `self._assert_live(...)`; `ast.Name` catches a
    `from x import _assert_live` / `_assert_live()` indirection. Matching only the
    first would let an import-and-call walk straight past this guard — the same
    reason the sibling roster's `_called_name` covers both.
    """
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return None


def _reaches_session(node: ast.AST) -> bool:
    """`self._mt5` itself, in ANY context — Load, Store or Del.

    ⭐ The node matched is the `self._mt5` ATTRIBUTE, not a `self._mt5.<verb>()`
    call shape. That width is load-bearing and is the single most important line in
    this file: `restart()` reaches the session through a LOCAL ALIAS
    (`stale = self._mt5`, then `stale.shutdown()`), and finding #5 IS `restart`. A
    predicate narrowed to `self._mt5.<x>` would miss the one method the phase exists
    for — the direct descendant of the bare-reference hole
    (`test_mt5_shutdown_roster.py:74-97`), where a verb reached without being called
    was invisible to a call-shaped predicate. `test_selftest_the_alias_shape_is_a_touch`
    is the standing witness.
    """
    return (
        isinstance(node, ast.Attribute)
        and node.attr == SESSION_ATTR
        and isinstance(node.value, ast.Name)
        and node.value.id == "self"
    )


def _first_executable(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> ast.stmt | None:
    """The method's first statement with the docstring skipped."""
    body = list(fn.body)
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        body = body[1:]
    return body[0] if body else None


@dataclass
class MethodScan:
    """One `def` of the scanned class, and every fact the roster reasons about."""

    name: str
    lineno: int
    #: reaches `self._mt5` anywhere in its body, NESTED CLOSURES INCLUDED —
    #: `restart` wraps its whole body in `_reconnect_then_dispose_stale`, and the
    #: reported name is the OUTERMOST def because permission belongs to the VERB,
    #: not to whichever helper it happens to use this month (the same outermost
    #: rule as `test_mt5_shutdown_roster.py:166-173`).
    touches_session: bool = False
    #: carries a `_assert_live(...)` call anywhere in its body
    guarded: bool = False
    #: …and that call is the FIRST executable statement. A fence written AFTER a
    #: round-trip is not a fence: `login` would have already re-pointed the shared
    #: terminal onto another account by the time it refused.
    guard_is_first: bool = False
    #: line numbers of interest for the positional assertions
    epoch_compare_linenos: list[int] = field(default_factory=list)
    fenced_call_linenos: list[int] = field(default_factory=list)
    #: names read anywhere in the body — used for the construction-fence fact
    names_read: set[str] = field(default_factory=set)


def scan_source(source: str, relpath: str = CLIENT_RELPATH) -> dict[str, MethodScan]:
    """Parse ONE source string and return `{method name: MethodScan}` for the
    `Mt5Client` class it defines.

    Exposed separately from the file read so the self-tests can drive it against
    hand-written syntax — without that seam the predicates below would only ever be
    exercised by the source they are meant to police, and a predicate that returned
    "guarded" unconditionally would be indistinguishable from a correct one.
    """
    tree = ast.parse(source, filename=relpath)
    out: dict[str, MethodScan] = {}
    classes = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == CLIENT_CLASS
    ]
    for cls in classes:
        for member in cls.body:
            if not isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            scan = MethodScan(name=member.name, lineno=member.lineno)
            nodes = list(ast.walk(member))
            scan.touches_session = any(_reaches_session(n) for n in nodes)
            scan.guarded = any(
                isinstance(n, ast.Call) and _called_name(n) == GUARD_NAME
                for n in nodes
            )
            first = _first_executable(member)
            scan.guard_is_first = (
                isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Call)
                and _called_name(first.value) == GUARD_NAME
            )
            scan.names_read = {
                n.id for n in nodes if isinstance(n, ast.Name)
            }
            for node in nodes:
                if isinstance(node, ast.Compare) and any(
                    isinstance(sub, ast.Call) and _called_name(sub) == EPOCH_READER
                    for sub in ast.walk(node)
                ):
                    scan.epoch_compare_linenos.append(node.lineno)
                if (
                    isinstance(node, ast.Call)
                    and _called_name(node) == POSITIONAL_FENCED_CALL
                ):
                    scan.fenced_call_linenos.append(node.lineno)
            out[member.name] = scan
    return out


@pytest.fixture(scope="module")
def client_scan() -> dict[str, MethodScan]:
    """Scan `services/mt5_client.py` ONCE per module, by PATH — never by import."""
    return scan_source((_ROOT / CLIENT_RELPATH).read_text(), CLIENT_RELPATH)


def _touching(scan: dict[str, MethodScan]) -> set[str]:
    return {name for name, m in scan.items() if m.touches_session}


def _guarded(scan: dict[str, MethodScan]) -> set[str]:
    return {name for name, m in scan.items() if m.guarded}


# --------------------------------------------------------------------------- #
# 0. Anti-vacuity — the predicate spelled out in the message
# --------------------------------------------------------------------------- #


def test_the_scan_actually_read_the_client(client_scan: dict[str, MethodScan]) -> None:
    """⛔ THE LOAD-BEARING FLOOR. Every other assertion in this file is of the form
    "every derived X has property P", and a derivation that collapsed to the empty
    set satisfies all of them — an unfenced class and a fully fenced one would look
    identical from here."""
    assert len(client_scan) >= CLIENT_METHOD_FLOOR, (
        f"the class walk found only {len(client_scan)} methods on "
        f"{CLIENT_CLASS} (floor {CLIENT_METHOD_FLOOR}, measured 15). The "
        f"PREDICATE is: every ast.FunctionDef/AsyncFunctionDef in the body of the "
        f"ClassDef named {CLIENT_CLASS!r} in {CLIENT_RELPATH}. A collapsed walk — "
        "a renamed class, a moved file, a class nested somewhere the walk no "
        "longer reaches — passes every other assertion here vacuously."
    )

    touching = _touching(client_scan)
    assert len(touching) >= SESSION_TOUCH_FLOOR, (
        f"only {len(touching)} methods were derived as touching the MT5 session "
        f"(hand-typed floor {SESSION_TOUCH_FLOOR}, MEASURED 10 on 2026-08-11: "
        f"{sorted(touching)}). The PREDICATE is: the method's body — nested "
        f"closures included — contains an ast.Attribute whose attr is "
        f"{SESSION_ATTR!r} and whose value is ast.Name('self'), in ANY context "
        "(Load, Store or Del). Below the floor means the predicate stopped "
        "matching, not that the class stopped touching the session; ⛔ do NOT "
        "lower this floor to make it pass."
    )

    guarded = _guarded(client_scan)
    assert len(guarded) >= GUARDED_METHOD_FLOOR, (
        f"only {len(guarded)} methods carry the {GUARD_NAME}() fence "
        f"(floor {GUARDED_METHOD_FLOOR}, measured 7: login, account_info, "
        f"terminal_info, history_deals_get, order_check, _raise_last, restart); "
        f"derived {sorted(guarded)}. Either the fence was removed from a method "
        "that must carry it (WIZFORM-ABANDON / D-36 — a zombie thread then drives "
        "the next holder's terminal) or the guard predicate stopped matching."
    )


# --------------------------------------------------------------------------- #
# 1. THE ROSTER: every session-touching method carries the fence, and the only
#    ones that do not are D-41's exempt verbs — EXACTLY.
# --------------------------------------------------------------------------- #


def test_every_session_touching_method_carries_the_fence(
    client_scan: dict[str, MethodScan],
) -> None:
    """⭐ D-36. A method that reaches the shared MT5 session must refuse first if
    the lease it was spawned under has already been released.

    Reds without anybody hand-editing a roster: the exempt set is typed out here,
    the touching set is DERIVED from source, and a method added next month that
    reaches `self._mt5` by a verb nobody has thought of yet (`positions_get`, a
    future read) lands in the difference and reds with ZERO pin edits. That is the
    entire reason this file exists rather than a list of seven method names.
    """
    unfenced = sorted(_touching(client_scan) - _guarded(client_scan))
    assert set(unfenced) == EXEMPT_TOUCHING, (
        f"the session-touching methods WITHOUT the {GUARD_NAME}() fence are "
        f"{unfenced}, expected exactly {sorted(EXEMPT_TOUCHING)}.\n"
        "  * A NEW name in this list is an UNFENCED session touch: work abandoned "
        "by `asyncio.to_thread` + `wait_for` keeps running, and this method would "
        "drive the ONE shared MT5 IPC pipe under the NEXT lease holder "
        "(WIZFORM-ABANDON / D-36). Add `self."
        f"{GUARD_NAME}(\"<stage>\")` as its FIRST statement.\n"
        "  * A name MISSING from this list means an exempt verb was fenced. ⛔ Do "
        "NOT do that: since D-35 `close`/`release` touch only OUR OWN rpyc socket, "
        "and fencing them strands it — the Pitfall-6 leak "
        "`routers/exchange.py:899-948` exists to prevent, i.e. the fix causing the "
        "bug it is fixing. `__init__` is exempt from the METHOD fence because it "
        f"is covered by the {CONSTRUCTION_FENCE_VAR} construction mechanism "
        "instead (D-36 AMENDED (ii)), asserted separately below."
    )


def test_the_fence_is_the_first_executable_statement(
    client_scan: dict[str, MethodScan],
) -> None:
    """PRESENCE is not enough — POSITION is the property.

    A fence written after the round-trip refuses nothing that matters: `login()`
    would already have re-pointed the shared terminal onto another account, and
    `_raise_last()` would already have overwritten the live holder's `last_error`
    state. The fence must also sit ahead of `_guarded_read` (which would convert
    the refusal into a scrubbed `Mt5ClientError` — the absorption D-42 makes
    structurally impossible) and ahead of `_timed` (a refusal is not a round-trip
    and must not enter the D-32 `duration_ms` population).
    """
    late = sorted(
        name
        for name, m in client_scan.items()
        if m.guarded and not m.guard_is_first
    )
    assert not late, (
        f"{late} call {GUARD_NAME}() but not as the FIRST executable statement "
        "(the docstring does not count). A check that runs after the session was "
        "already touched is not a check: the touch it was supposed to refuse has "
        "landed on the shared terminal, and the refusal can additionally be "
        "rewritten into an `Mt5ClientError` by `_guarded_read` or timed into the "
        "D-32 population by `_timed`. If a genuine prologue is ever required, "
        "re-cut this predicate deliberately and say why — do not move the fence."
    )


def test_the_teardown_verb_reaches_the_session_only_through_its_parameter(
    client_scan: dict[str, MethodScan],
) -> None:
    """D-41's second KIND of exemption, asserted as its own fact.

    `_teardown_transport` is on D-41's exempt list but never appears in the derived
    touching set, because it takes the connection as `mt5_obj` rather than reading
    `self._mt5` — `restart()` disposes the STALE object after the fresh one has
    been swapped in, so reading the attribute there would close the wrong socket.

    Stating this separately keeps `EXEMPT_TOUCHING` honest: folding the name into
    that set would widen an exact-equality pin by a name the derivation can never
    produce, and a widened exemption is one that can absorb a real unfenced method.
    """
    assert D41_EXEMPT == EXEMPT_TOUCHING | EXEMPT_BY_PARAMETER
    for name in sorted(D41_EXEMPT):
        assert name in client_scan, (
            f"D-41 exempts {name!r} but {CLIENT_CLASS} has no such method — the "
            "exemption is pinning a name that no longer exists, so it can only "
            "ever silence a future method that happens to reuse it."
        )
        assert not client_scan[name].guarded, (
            f"{name} carries the {GUARD_NAME}() fence and MUST NOT (D-41). Since "
            "D-35 the teardown verbs touch only our own rpyc socket; fencing them "
            "strands it and reintroduces the Pitfall-6 leak. `__init__` is fenced "
            f"by {CONSTRUCTION_FENCE_VAR} instead."
        )

    for name in sorted(EXEMPT_BY_PARAMETER):
        assert not client_scan[name].touches_session, (
            f"{name} now reaches `self.{SESSION_ATTR}` directly. It must still stay "
            "UNFENCED (Pitfall 6) — but its exemption has changed KIND: move it "
            "from EXEMPT_BY_PARAMETER to EXEMPT_TOUCHING, deliberately, and say "
            "why it stopped taking the connection as a parameter."
        )


# --------------------------------------------------------------------------- #
# 2. The two mechanisms that are NOT a plain first-statement fence
# --------------------------------------------------------------------------- #


def test_restart_carries_both_checks_and_the_second_precedes_the_shutdown(
    client_scan: dict[str, MethodScan],
) -> None:
    """⭐ Finding #5, stated structurally. `restart` is the one method whose fence
    is POSITIONAL as well as present.

    The entry `_assert_live("restart")` passes trivially on the very path the
    defect lives on — the legitimate heal runs BEFORE the release that bumps the
    generation. What closes finding #5 is the SECOND check: an inline
    `_mt5_epoch_for(...)` comparison immediately ahead of the ONE permitted
    `stale.shutdown()`, inline rather than via `_assert_live` because three cleanup
    steps must run before the raise (`_assert_live` raises at once and would strand
    two sockets).

    ⚠️ This is a LEXICAL ordering claim and nothing more: "the comparison is
    WRITTEN before the shutdown". That the comparison is ENFORCED at runtime is
    `tests/test_mt5_abandon_fence.py`'s question, and the fenced-restart case in
    `tests/test_mt5_client_contract.py` is the behavioural proof.
    """
    restart = client_scan[POSITIONAL_FENCE_METHOD]
    assert restart.guarded and restart.guard_is_first, (
        f"{POSITIONAL_FENCE_METHOD} lost its ENTRY {GUARD_NAME}() check (check 1 "
        "of 2). It is the cheap half and closes almost nothing on its own, but "
        "without it an already-abandoned restart opens an rpyc socket nobody is "
        "left to close."
    )
    assert restart.epoch_compare_linenos, (
        f"{POSITIONAL_FENCE_METHOD} carries NO inline {EPOCH_READER}() comparison "
        "— check 2 of 2 is GONE, and it is the load-bearing one. Finding #5 is "
        "precisely the case where the entry check already passed and the damage "
        "happens later: `_mt5_bounded_restart` abandons this call at its ~10s "
        "bound, the caller unwinds and its lease bumps the generation, and this "
        "zombie arrives at the shared `stale.shutdown()` UNDER THE NEXT HOLDER — "
        "one ThreadedServer, one MetaTrader5 instance, one IPC pipe, so that late "
        "shutdown answers the next holder `-10004 No IPC connection`. An "
        "entry-check-only fix reads as a fix and closes nothing."
    )
    assert restart.fenced_call_linenos, (
        f"{POSITIONAL_FENCE_METHOD} no longer calls {POSITIONAL_FENCED_CALL}(). "
        "That is not automatically an improvement — with nobody calling it a "
        "genuinely wedged IPC pipe has no heal at all (MT5CONC-01). If the "
        "teardown moved, re-cut this pin rather than deleting it."
    )
    assert min(restart.epoch_compare_linenos) < min(restart.fenced_call_linenos), (
        f"the inline {EPOCH_READER}() comparison (line "
        f"{min(restart.epoch_compare_linenos)}) is written AFTER the "
        f"{POSITIONAL_FENCED_CALL}() call (line "
        f"{min(restart.fenced_call_linenos)}). A check that runs after the shared "
        "IPC pipe has already been torn down refuses nothing: the next holder has "
        "already lost its connection."
    )


def test_construction_is_fenced_by_the_occupancy_contextvar(
    client_scan: dict[str, MethodScan],
) -> None:
    """`__init__` is exempt from the METHOD fence and covered by a DIFFERENT
    mechanism — two facts, asserted as two assertions rather than conflated.

    D-36 AMENDED (ii): in findings #6a/#6b the zombie is parked inside `__init__`'s
    blocking connect and makes no subsequent session call, so there is no method
    for `_assert_live` to sit in front of. `asyncio.to_thread` copies the caller's
    `contextvars.Context` at spawn, so the abandoned thread carries the OLD
    lease-occupancy token while the registry moves on — which is what lets the
    constructor tell a zombie from a live caller. ⛔ A construction-time epoch
    SNAPSHOT was rejected: it false-positives on `job_worker._make_mt5_session`,
    which builds its client in preflight, outside and before any lease.
    """
    init = client_scan["__init__"]
    assert not init.guarded, (
        f"__init__ now calls {GUARD_NAME}(). It must NOT: the epoch binds LAZILY "
        "on first touch precisely so a PREFLIGHT construction — outside any lease "
        "— is not refused because an unrelated lease released in that window."
    )
    assert CONSTRUCTION_FENCE_VAR in init.names_read, (
        f"__init__ no longer reads {CONSTRUCTION_FENCE_VAR}, so CONSTRUCTION is "
        "unfenced (findings #6a/#6b). A connect-stage timeout then orphans an rpyc "
        "session against the gateway's ThreadedServer with no owner and no reaper: "
        "`routers/exchange.py`'s Pitfall-6 `finally` sees `client is None` and "
        "releases NOTHING, and the adapter's connect sits deliberately outside its "
        "close-`finally`."
    )


# --------------------------------------------------------------------------- #
# 3. SELF-TESTS — the predicates have teeth, in BOTH directions
# --------------------------------------------------------------------------- #


def test_selftest_predicates_report_guarded_and_unguarded() -> None:
    """⭐ THE MOST IMPORTANT CASE IN THE FILE.

    A guarded synthetic and an UNGUARDED one are driven through ONE call, and both
    verdicts are asserted. ⛔ Without the unguarded half, "every session-touching
    method carries the fence" is indistinguishable from a predicate that returns
    "guarded" unconditionally — the whole roster would then be a fixture that can
    never red, which is the exact shape of the bug it exists to catch.
    """
    src = (
        "class Mt5Client:\n"
        "    def guarded_read(self):\n"
        '        """A fenced read."""\n'
        '        self._assert_live("guarded_read")\n'
        "        return self._mt5.account_info()\n"
        "\n"
        "    def forgotten_read(self):\n"
        '        """The method somebody writes next month."""\n'
        "        return self._mt5.positions_get()\n"
    )
    scan = scan_source(src, "synthetic/a.py")
    verdicts = {name: (m.touches_session, m.guarded) for name, m in scan.items()}
    assert verdicts == {
        "guarded_read": (True, True),
        "forgotten_read": (True, False),
    }, verdicts

    # …and the roster's own arithmetic REPORTS the forgotten one.
    assert _touching(scan) - _guarded(scan) == {"forgotten_read"}


def test_selftest_the_alias_shape_is_a_touch() -> None:
    """⭐ THE ALIAS TRAP, stated as a case — and it is `restart`'s real shape.

    `restart()` reaches the session as `stale = self._mt5` and then calls
    `stale.shutdown()`. A predicate narrowed to `self._mt5.<verb>()` call shapes
    sees NO touch here and would exempt the one method finding #5 is about. The
    predicate therefore matches the `self._mt5` ATTRIBUTE itself, in any context,
    and this synthetic is the standing witness that a future narrowing reds.
    """
    src = (
        "class Mt5Client:\n"
        "    def aliased(self):\n"
        "        stale = self._mt5\n"
        "        stale.shutdown()\n"
        "\n"
        "    def stores(self):\n"
        "        self._mt5 = self._connect()\n"
    )
    scan = scan_source(src, "synthetic/b.py")
    # BOTH shapes count: the Load on the RHS of the alias, and the Store.
    assert {name: m.touches_session for name, m in scan.items()} == {
        "aliased": True,
        "stores": True,
    }


def test_selftest_a_touch_inside_a_nested_closure_is_still_the_method_s(
) -> None:
    """`restart` wraps its whole body in `_reconnect_then_dispose_stale`. The touch
    is reported against the OUTERMOST def, because permission belongs to the VERB
    and not to whichever helper it happens to use this month — and because a
    roster that reported `_reconnect_then_dispose_stale` would red on a pure
    refactor while going blind to the method it was actually asked about."""
    src = (
        "class Mt5Client:\n"
        "    def restart(self):\n"
        "        def _inner():\n"
        "            stale = self._mt5\n"
        "            stale.shutdown()\n"
        "        self._timed('restart', _inner)\n"
    )
    scan = scan_source(src, "synthetic/c.py")
    assert set(scan) == {"restart"}, scan
    assert scan["restart"].touches_session


def test_selftest_prose_is_ignored() -> None:
    """This is what a grep could not do.

    The session handle and the fence name appear in a docstring, a comment and a
    plain string literal, and NOTHING is called. Comments and docstrings are
    structurally absent from an AST, so the method is reported as neither touching
    nor guarded. `mt5_client.py` is full of exactly this prose — `_assert_live`'s
    own docstring names `self._mt5`, and `_teardown_transport`'s explains why it
    does NOT read it — so a grep-based roster would report the one provably
    untouching method as a session toucher, and would report every exempt verb as
    fenced.
    """
    src = (
        "class Mt5Client:\n"
        "    def prose_only(self):\n"
        '        """Never read self._mt5 here — call self._assert_live first."""\n'
        "        # self._mt5.account_info() would need self._assert_live()\n"
        '        msg = "self._mt5 / self._assert_live()"\n'
        "        return msg\n"
    )
    scan = scan_source(src, "synthetic/d.py")
    assert scan["prose_only"].touches_session is False
    assert scan["prose_only"].guarded is False


def test_selftest_a_late_fence_is_reported_as_late() -> None:
    """The POSITION predicate has teeth too: a fence written after the round-trip
    is detected as present-but-not-first, so `test_the_fence_is_the_first_
    executable_statement` cannot be satisfied by merely mentioning the guard."""
    src = (
        "class Mt5Client:\n"
        "    def late(self):\n"
        "        info = self._mt5.account_info()\n"
        '        self._assert_live("late")\n'
        "        return info\n"
        "\n"
        "    def early(self):\n"
        '        self._assert_live("early")\n'
        "        return self._mt5.account_info()\n"
    )
    scan = scan_source(src, "synthetic/e.py")
    assert {name: (m.guarded, m.guard_is_first) for name, m in scan.items()} == {
        "late": (True, False),
        "early": (True, True),
    }


def test_selftest_the_guard_predicate_sees_a_bare_name_call() -> None:
    """A `from services.mt5_client import _assert_live; _assert_live(...)`
    indirection counts as the fence too — matching only `ast.Attribute` would make
    the simplest re-spelling look like a missing guard and invite somebody to
    "fix" it by adding a second, duplicate check."""
    src = (
        "class Mt5Client:\n"
        "    def odd(self):\n"
        '        _assert_live(self, "odd")\n'
        "        return self._mt5.account_info()\n"
    )
    scan = scan_source(src, "synthetic/f.py")
    assert scan["odd"].guarded and scan["odd"].guard_is_first


def test_selftest_the_positional_predicates_have_teeth() -> None:
    """The `restart` assertions are driven against synthetics in BOTH orders, so
    "the epoch comparison precedes the shutdown" cannot be a claim that is true of
    every possible source."""
    good = (
        "class Mt5Client:\n"
        "    def restart(self):\n"
        "        def _inner():\n"
        "            stale = self._mt5\n"
        "            if self._epoch != _mt5_epoch_for(self.terminal_key):\n"
        "                raise Mt5SessionAbandoned('restart')\n"
        "            stale.shutdown()\n"
        "        _inner()\n"
    )
    bad = (
        "class Mt5Client:\n"
        "    def restart(self):\n"
        "        def _inner():\n"
        "            stale = self._mt5\n"
        "            stale.shutdown()\n"
        "            if self._epoch != _mt5_epoch_for(self.terminal_key):\n"
        "                raise Mt5SessionAbandoned('restart')\n"
        "        _inner()\n"
    )
    good_scan = scan_source(good, "synthetic/g.py")["restart"]
    bad_scan = scan_source(bad, "synthetic/h.py")["restart"]
    assert min(good_scan.epoch_compare_linenos) < min(good_scan.fenced_call_linenos)
    assert min(bad_scan.epoch_compare_linenos) > min(bad_scan.fenced_call_linenos)


def test_selftest_the_scan_finds_the_class_it_is_pointed_at() -> None:
    """A source with no `Mt5Client` yields an EMPTY scan rather than a silent pass
    — which is exactly why `test_the_scan_actually_read_the_client`'s method floor
    is the first assertion in this file."""
    assert scan_source("class Other:\n    def f(self):\n        return 1\n", "x.py") == {}
