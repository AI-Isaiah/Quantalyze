"""SEAMRIM-09 — the raw-5xx census: every permanent 5xx raised outside the contract, pinned.

WHAT THIS PINS
--------------
Exactly which sites in this service construct an HTTP 5xx **without** going
through the error contract, and with which status. The set may only SHRINK. A
new raw 5xx — or a status change at an existing one — fails a named test on the
day it is written.

WHY A GUARD AND NOT A GREP
--------------------------
The 502/504 ban is real and strong, but it lives inside ``_validate`` in
``services/error_contract.py`` and is reachable only through ``service_error``
and ``service_error_response``. **A direct ``raise HTTPException(...)`` never
reaches it.** The gap is purely one of *reach*, and until this file nothing
measured the reach.

This test exists because of ledger row **M11**. In mutation run 1 of this
programme, flipping ``status_code=500`` to ``502`` at ``routers/portfolio.py``'s
``verify_strategy`` — the **anonymous public teaser**, reachable without a
session — left **both full suites byte-identical**. The closure receipt for that
class was a one-time ``grep … → empty``: a grep proves a state, only a guard
proves the state is held. A wrong status there is not cosmetic — the status line
alone decides whether a failure counts toward the TypeScript seam's **global**
breaker, so a 502 where a 500 belongs re-arms a global-outage harm.

THE QUARANTINE IS A ROSTER OF KNOWN OFFENDERS, AND MAY ONLY SHRINK
------------------------------------------------------------------
``QUARANTINE`` below is **hand-typed** — a roster, and therefore partial by
construction. That is acceptable *here and only here* because it enumerates
**known offenders** (which can only shrink as sites are re-homed onto
``service_error()``) rather than **protected sites** (where a silent omission
would be a hole), and because the comparison is ``==`` rather than containment.
The equality is deliberate, following ``test_limiter_identity.py``'s
``test_no_router_source_references_get_remote_address_except_the_quarantine``:
*a repair must not be able to leave a stale exemption behind.* If you re-home a
site, DELETE its row here.

⚠️ **A ``frozenset`` of ``(module, function, status)`` triples would NOT be
sufficient, and this is measured, not asserted.** The 12 sites collapse to only
**9 distinct triples**, because three functions each raise the same status
twice: ``cron.py``'s ``cron_sync``, ``exchange.py``'s ``fetch_trades`` and
``portfolio.py``'s ``verify_strategy``. Under a set equality, DELETING one of a
duplicated pair yields the same value as the correct tree — a broken tree and a
correct tree become indistinguishable. The quarantine is therefore a
multiplicity-preserving ``collections.Counter``, and
``test_the_quarantine_is_multiplicity_preserving`` asserts that in-test, so the
property survives a refactor that no comment could stop.

THE SCANNER'S PREDICATE, STATED IN FULL
---------------------------------------
Every count in this file is meaningless without the definition it was measured
under — a bare integer is unowned by construction. The predicate is:

    An ``ast.Call`` whose ``func`` is an **``ast.Name``** with
    ``id in {"HTTPException", "JSONResponse"}`` — i.e. a **direct constructor
    call by that bare name** — found by walking ``routers/**/*.py``,
    ``services/**/*.py`` and ``main.py``, skipping any path containing a
    ``tests`` segment. The status is resolved from a ``status_code=`` keyword,
    or failing that from the first positional argument, and is accepted only
    when it is an ``ast.Constant`` integer. Hits with a resolved literal status
    ``>= 500`` form the census.

Sites are keyed on ``(module basename, enclosing function name, status)`` and
**never on a line number**: this programme measured 19 line citations of which 5
were wrong, broken by three in-range commits — including one whose stated
purpose was *"a pointer cannot drift"*.

WHAT THIS CENSUS CANNOT SEE — asserted, not merely admitted
-----------------------------------------------------------
A guard that implies completeness it does not have is worse than none, so both
blind spots below are pinned by hand-typed constants that redden when they move.

(a) **Non-literal statuses.** ``status_code=SOME_CONSTANT`` or
    ``status_code=int("500")`` resolves to no literal and leaves the census
    while still putting the same status on the wire. Under the strict predicate
    above there are **3** such matched constructions, all legitimate
    pass-throughs of an already-validated status
    (``error_contract.py``'s ``service_error`` and ``service_error_response``,
    and ``main.py``'s ``venue_transient_exception_handler``).
    ⚠️ Under a **LOOSE** reading — *"any ``status_code=`` keyword anywhere, any
    callee"* — the answer is **4**. The fourth is
    ``VenueTransientHTTPException.__init__``'s ``super().__init__(status_code=…)``
    in ``services/error_contract.py``, whose ``func`` is an ``ast.Attribute``
    and not an ``ast.Name``, so it is not a matched *construction*. **Both
    numbers are honest; they measure different things.** This file pins 3 under
    the strict predicate, and that ``super().__init__`` is precisely the site
    that makes the ``ast.Name``-vs-``ast.Attribute`` distinction load-bearing.

(b) **Subclass constructions are not matched at all.** ``HTTPException``
    subclasses defined in-tree are constructed by their own name, which is not
    in the matched set. There is exactly **1** such subclass,
    ``VenueTransientHTTPException`` in ``services/error_contract.py``,
    constructed at **7** sites (``routers/exchange.py`` and
    ``routers/portfolio.py``), **all at status 424**. 424 is a 4xx and so
    outside this census's ``>= 500`` scope: **the gap is latent, not live.** It
    is additionally defended at runtime — that class's ``__init__`` refuses any
    status outside ``400 <= status_code < 500``. Both counts are pinned so that
    a new subclass, or a subclass site crossing 500, forces a decision here.

(c) **Anything outside the three scanned roots**, anything under a ``tests``
    path segment, and any exception constructed dynamically (``getattr``,
    a factory, a ``raise`` of a pre-built instance held in a variable).

OUT OF SCOPE, stated so it is not smuggled in
---------------------------------------------
Re-homing any quarantined site onto ``service_error()`` — deliberately NOT
bundled with the census (two fixes touching one file in a single pass have
reintroduced each other's bugs in this programme). The census is what makes a
later re-homing verifiable, one site at a time. Also out of scope: the raw 4xx
sites, and any change to ``error_contract.py``.
"""

from __future__ import annotations

import ast
from collections import Counter
from pathlib import Path
from typing import NamedTuple

# ---------------------------------------------------------------------------
# Hand-typed expectations. Every one of these is a LITERAL, never read back out
# of the thing it measures — an oracle that derives its expected value from the
# subject agrees with itself forever.
# ---------------------------------------------------------------------------

CensusKey = tuple[str, str, int]

#: Known offenders: sites constructing a permanent/transient 5xx WITHOUT passing
#: through ``service_error`` / ``service_error_response``, and therefore without
#: passing ``_validate``. Keyed ``(module basename, enclosing function, status)``.
#: **May only shrink.** Re-home a site → delete its row.
QUARANTINE: Counter[CensusKey] = Counter(
    {
        ("analytics_runner.py", "run_csv_strategy_analytics", 500): 1,
        ("cron.py", "cron_sync", 500): 2,
        ("csv.py", "csv_validate", 500): 1,
        ("debug_key_flow.py", "_read_test_creds", 503): 1,
        ("debug_key_flow.py", "_verify_internal_token", 503): 1,
        ("exchange.py", "fetch_trades", 500): 2,
        ("exchange.py", "fetch_trades", 503): 1,
        ("main.py", "health", 503): 1,
        ("portfolio.py", "verify_strategy", 500): 2,
    }
)

#: Total construction SITES, which is deliberately larger than the number of
#: distinct triples. Hand-typed so that collapsing the Counter back to a set
#: cannot pass unnoticed.
EXPECTED_SITE_COUNT = 12
EXPECTED_TRIPLE_COUNT = 9

#: The triples that occur twice — the exact reason this is a Counter and not a
#: frozenset. Deleting one member of any of these pairs is invisible to a set.
EXPECTED_DUPLICATED_TRIPLES: frozenset[CensusKey] = frozenset(
    {
        ("cron.py", "cron_sync", 500),
        ("exchange.py", "fetch_trades", 500),
        ("portfolio.py", "verify_strategy", 500),
    }
)

#: ``services/error_contract.py``'s ``_validate``: *"the only permanent 5xx in
#: this contract is 500, got {status_code}; a transient fault is 503, an
#: exchange fault is 424."* Every quarantined member must therefore be 500, OR
#: appear here with an explicit reason. This mapping makes a non-500 read as a
#: DECISION rather than as an unexplained exemption.
NON_500_REASONS: dict[CensusKey, str] = {
    ("main.py", "health", 503): (
        "/health answers 503 when the worker heartbeat is STALE while the web "
        "process itself is alive. 503 is the transient status uptime probes and "
        "load balancers act on; a 500 here would read as a crashed app. The "
        "service is degraded, not permanently broken."
    ),
    ("debug_key_flow.py", "_verify_internal_token", 503): (
        "INTERNAL_API_TOKEN is unset. A missing platform secret is an operator "
        "CONFIGURATION fault that is fixed by setting the variable and "
        "redeploying — transient by the contract's definition, not a permanent "
        "500. Testnet-only debug harness; not on any user path."
    ),
    ("debug_key_flow.py", "_read_test_creds", 503): (
        "DEBUG_KEY_FLOW_<BROKER>_{KEY,SECRET} are unset. Same class as the "
        "sibling above: absent testnet credentials on a debug-only router, "
        "resolved by configuration, so 503 rather than 500."
    ),
    ("exchange.py", "fetch_trades", 503): (
        "get_kek() raised — the KEK is not configured, so no stored key can be "
        "decrypted. Transient in the same configuration sense. ⚠️ NOTE THE "
        "INCONSISTENCY, recorded rather than silently normalised: cron.py's "
        "cron_sync raises 500 for the IDENTICAL KEK-missing condition, and says "
        "why in a comment (the cron runner only alarms on non-2xx). Two statuses "
        "for one fault is a real wrinkle to settle when these sites are re-homed "
        "onto service_error(); it is not this plan's to change."
    ),
}

#: BLIND SPOT (a), under the STRICT predicate in the module docstring: an
#: ``ast.Call`` with an ``ast.Name`` func in the matched set, carrying a
#: ``status_code=`` keyword whose value is not an integer literal.
#: ⚠️ The LOOSE reading ("any ``status_code=`` keyword, any callee") yields 4 —
#: the extra one being ``VenueTransientHTTPException.__init__``'s
#: ``super().__init__``, an ``ast.Attribute`` and therefore not a construction.
EXPECTED_NON_LITERAL_STATUS_SITES = 3
EXPECTED_NON_LITERAL_STATUS_SITES_UNDER_LOOSE_READING = 4

#: BLIND SPOT (b): in-tree ``HTTPException`` subclasses and their construction
#: sites. Latent, not live — every site is a 4xx today.
EXPECTED_HTTPEXCEPTION_SUBCLASSES = 1
#: 7 -> 8 (2026-08-09, Phase 153.3 / D-31): ``_validate_mt5_key`` gained a FOURTH
#: ``VenueTransientHTTPException(424)`` site — the capability-``undetermined``
#: refusal taken when the gateway terminal's trade-permission signal is
#: unreadable or the terminal is detached from the trade server. It reuses the
#: EXISTING transient arm (no new user-facing code is minted here; 153.1 owns the
#: TS code table), and it is a 4xx like every other site, so blind spot (b) stays
#: latent rather than live.
#: 8 -> 9 (2026-08-09, Phase 153.3-03 / D-03): the MT5 validate probe gained ONE
#: end-to-end deadline above its per-stage ceilings, and its expiry routes to the
#: SAME transient arm as a probe-stage timeout (a hung terminal is a hung terminal)
#: — a fifth ``VenueTransientHTTPException(424)`` construction, again a 4xx.
#: The three MT5 probe-arm sites now resolve to the enclosing ``_connect_and_probe``
#: rather than ``_validate_mt5_key``: connect+probe moved into one inner coroutine so
#: a single deadline could bound them. Same function, same arms, one scope deeper.
#: 9 -> 10 (2026-08-09, Phase 153.3-04 / D-29): the MT5 validate path now takes the
#: shared terminal lease with a BOUNDED acquisition wait, and a caller still queued
#: at that bound routes to the SAME transient arm — a busy terminal is recoverable
#: ("try again" is honest advice: it frees up) and is OUR infrastructure, never the
#: user's key. A sixth ``VenueTransientHTTPException(424)`` construction; no new
#: user-facing code is minted (153.1 owns the TS code table) and it is a 4xx like
#: every other site, so blind spot (b) stays LATENT rather than live.
EXPECTED_SUBCLASS_CONSTRUCTION_SITES = 10

#: Vacuity fence. A scanner that matched nothing would report agreement with the
#: quarantine forever, so the scan must prove it saw the tree. Loose floors on
#: purpose: their job is to catch "matched nothing", not to pin a tree size that
#: churns. Measured on the untouched tree: 88 files, 84 matched constructions of
#: which 72 are HTTPException at ANY status.
MIN_FILES_SCANNED = 30
MIN_HTTPEXCEPTION_CALLS_ANY_STATUS = 1

MATCHED_CONSTRUCTORS = frozenset({"HTTPException", "JSONResponse"})

SERVICE_ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# The scanner. ONE implementation, exercised both by the disk walk and by the
# needle self-test — a needle that tested a second copy of the logic would prove
# nothing about the scanner that produces the census.
# ---------------------------------------------------------------------------


class Construction(NamedTuple):
    """One matched ``HTTPException``/``JSONResponse`` construction."""

    module: str
    function: str
    constructor: str
    status: int | None
    """The literal status, or ``None`` when the ``status_code=`` value is not an
    integer literal (blind spot (a))."""


def _enclosing_function_resolver(tree: ast.AST) -> dict[ast.AST, str]:
    """Map every node to its enclosing ``def``/``async def`` name.

    ``ast`` carries no parent links, so build them once per module. Keying on
    the function name rather than on ``node.lineno`` is deliberate: line numbers
    are the citation class this programme measured rotting.
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


def _literal_int(node: ast.expr) -> int | None:
    """The node's value iff it is an integer literal. ``bool`` is not an int here."""
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        if isinstance(node.value, bool):
            return None
        return node.value
    return None


def scan_source(module_name: str, source: str) -> list[Construction]:
    """Every matched construction in ``source``, per the docstring's predicate.

    Matches an ``ast.Call`` whose ``func`` is an ``ast.Name`` in
    :data:`MATCHED_CONSTRUCTORS`. ``super().__init__(status_code=…)`` is an
    ``ast.Attribute`` and is therefore NOT matched — see blind spot (a).
    Because this parses, a ``# HTTPException(500)`` comment and a status inside
    a string are structurally invisible, and a ``status_code=`` on a
    CONTINUATION LINE is seen normally. A line-based grep gets both wrong, and
    getting the second one wrong is what produced this programme's earlier
    census of 9.
    """
    tree = ast.parse(source)
    enclosing = _enclosing_function_resolver(tree)

    found: list[Construction] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Name) or func.id not in MATCHED_CONSTRUCTORS:
            continue

        status: int | None = None
        keyword = next((kw for kw in node.keywords if kw.arg == "status_code"), None)
        if keyword is not None:
            status = _literal_int(keyword.value)
        elif node.args:
            status = _literal_int(node.args[0])

        found.append(
            Construction(
                module=module_name,
                function=enclosing[node],
                constructor=func.id,
                status=status,
            )
        )
    return found


def scanned_files() -> list[Path]:
    """``routers/**/*.py`` + ``services/**/*.py`` + ``main.py``, minus ``tests``."""
    paths: list[Path] = []
    for pattern in ("routers/**/*.py", "services/**/*.py"):
        paths.extend(SERVICE_ROOT.glob(pattern))
    paths.append(SERVICE_ROOT / "main.py")
    return sorted(
        {p for p in paths if "tests" not in p.relative_to(SERVICE_ROOT).parts}
    )


def scan_tree() -> tuple[list[Construction], int]:
    """All matched constructions across the scanned roots, and the file count."""
    files = scanned_files()
    found: list[Construction] = []
    for path in files:
        found.extend(scan_source(path.name, path.read_text(encoding="utf-8")))
    return found, len(files)


def derive_census() -> Counter[CensusKey]:
    """The multiplicity-preserving census of raw 5xx construction sites."""
    found, _ = scan_tree()
    return Counter(
        (c.module, c.function, c.status)
        for c in found
        if c.status is not None and c.status >= 500
    )


# ---------------------------------------------------------------------------
# Gate 1 — the census equals the quarantine, with multiplicity.
# ---------------------------------------------------------------------------


class TestCensusEqualsQuarantine:
    def test_the_derived_census_equals_the_hand_typed_quarantine(self) -> None:
        """The load-bearing assertion. ``==``, never containment.

        Containment would let a re-homed site rot in the roster forever. The
        equality forces the roster DOWN as the class closes.
        """
        census = derive_census()
        unexpected = census - QUARANTINE
        missing = QUARANTINE - census
        assert census == QUARANTINE, (
            "the raw 5xx census moved. "
            f"unexpected={sorted(unexpected.items())}, "
            f"missing={sorted(missing.items())}. "
            "A NEW entry means a 5xx is being raised outside the error "
            "contract, bypassing _validate's 502/504 ban — route it through "
            "service_error() instead. A MISSING entry means a site was repaired: "
            "SHRINK the QUARANTINE in this file to match, so the repair cannot "
            "leave a stale exemption behind. A CHANGED COUNT on an existing "
            "triple means one of a duplicated pair moved — that is exactly the "
            "case a frozenset cannot see."
        )

    def test_the_quarantine_is_multiplicity_preserving(self) -> None:
        """Guards the guard: a ``Counter``, never a set.

        Three triples occur twice, so under a ``frozenset`` a tree with one of
        ``cron.py``'s two sites DELETED compares equal to the correct tree. This
        assertion is in-test rather than a grep receipt on purpose — the module
        docstring above is *required* to explain why a set is insufficient, so
        any grep for "frozenset" would fire on the documentation it mandates.
        """
        assert isinstance(QUARANTINE, Counter), (
            "QUARANTINE must be a collections.Counter. A set or frozenset is "
            "satisfied by deleting one of a duplicated pair, so a broken tree "
            "and a correct one return the same value."
        )
        assert sum(QUARANTINE.values()) == EXPECTED_SITE_COUNT
        assert len(QUARANTINE) == EXPECTED_TRIPLE_COUNT
        assert sum(QUARANTINE.values()) > len(QUARANTINE), (
            "if sites ever equal triples, multiplicity has stopped mattering — "
            "re-derive before weakening this file to a set"
        )
        duplicated = {key for key, n in QUARANTINE.items() if n > 1}
        assert duplicated == set(EXPECTED_DUPLICATED_TRIPLES), (
            f"the duplicated triples changed: {sorted(duplicated)}"
        )

    def test_the_census_is_derived_by_multiplicity_from_the_tree_too(self) -> None:
        """The same two shape facts, measured on the TREE rather than the roster.

        Without this, the roster's shape is asserted only against itself.
        """
        census = derive_census()
        assert sum(census.values()) == EXPECTED_SITE_COUNT
        assert len(census) == EXPECTED_TRIPLE_COUNT
        assert {k for k, n in census.items() if n > 1} == set(
            EXPECTED_DUPLICATED_TRIPLES
        )


# ---------------------------------------------------------------------------
# Gate 2 — every quarantined status is 500, or a listed 503 with a reason.
# ---------------------------------------------------------------------------


class TestQuarantinedStatuses:
    """⚠️ Every assertion here reads the status off the **derived census**, never
    off ``QUARANTINE``.

    This is not a stylistic choice, it is a defect that ledger row **M95**
    caught in this very file. The first draft iterated the hand-typed roster:
    ``[key for key in QUARANTINE if key[2] != 500 …]``. Under the M95 mutation
    (a real ``status_code=500 → 502`` at ``portfolio.py``'s ``verify_strategy``)
    those assertions stayed **GREEN** — the roster still said 500, so they were
    comparing the roster to itself and could not fail for any change to the
    tree. A status gate that reads its expected value out of the roster is the
    self-referential oracle this programme keeps re-learning. Deriving first
    makes the gate LIVE.
    """

    def test_every_raw_5xx_site_in_the_tree_is_500_or_carries_an_explicit_reason(
        self,
    ) -> None:
        """``_validate``: *the only permanent 5xx in this contract is 500.*

        A 502 or 504 raised raw is the M11 defect: the TypeScript seam's
        **global** breaker keys on the status line, so the wrong 5xx re-arms a
        global-outage harm that a 500 would not.
        """
        undocumented = sorted(
            key
            for key in derive_census()
            if key[2] != 500 and key not in NON_500_REASONS
        )
        assert undocumented == [], (
            "a raw 5xx site carries a non-500 status with no recorded reason: "
            f"{undocumented}. error_contract._validate: 'the only permanent 5xx "
            "in this contract is 500, got {status}; a transient fault is 503, an "
            "exchange fault is 424'. Either re-home the site onto "
            "service_error(), or add its reason to NON_500_REASONS as a decision."
        )

    def test_no_raw_5xx_site_in_the_tree_uses_a_banned_5xx(self) -> None:
        """502 and 504 are banned outright — no reason string can license one.

        This is the assertion that speaks directly to ledger row M11.
        """
        banned = sorted(key for key in derive_census() if key[2] in (502, 504))
        assert banned == [], (
            f"BANNED 5xx status raised raw: {banned}. _validate refuses 502/504 "
            "for every caller that reaches it, and a direct raise must not "
            "smuggle one past it: the seam's global breaker counts a 502 that a "
            "500 would not. This is ledger row M11's defect, now guarded."
        )

    def test_the_only_non_500_status_in_use_is_503(self) -> None:
        """Positive counterpart: pin what the tree DOES contain, not only what it must not.

        A negative-only oracle goes vacuous the moment the population empties.
        """
        statuses = {key[2] for key in derive_census()}
        assert statuses == {500, 503}, (
            f"the set of raw 5xx statuses in the tree changed: {sorted(statuses)}"
        )

    def test_no_reason_is_recorded_for_a_site_that_no_longer_exists(self) -> None:
        """The exemption list may not outlive the sites it exempts.

        Same discipline as the QUARANTINE equality: a repair must not be able to
        leave a stale exemption behind.
        """
        census = derive_census()
        assert set(NON_500_REASONS) == {key for key in census if key[2] != 500}, (
            "NON_500_REASONS has drifted from the tree's non-500 sites: "
            f"stale={sorted(set(NON_500_REASONS) - set(census))}, "
            f"unexplained={sorted(k for k in census if k[2] != 500 and k not in NON_500_REASONS)}"
        )
        for key, reason in NON_500_REASONS.items():
            assert reason.strip(), f"empty reason recorded for {key}"


# ---------------------------------------------------------------------------
# Gate 3 — the needle proves itself, in BOTH polarities.
# ---------------------------------------------------------------------------


class TestNeedleSelfTest:
    """The negative half is the load-bearing one.

    A scanner that flagged a commented-out raise, or a legitimate 4xx, would be
    "fixed" by weakening it — and the weakened version would then miss the real
    thing. Both polarities are asserted against the SAME ``scan_source`` the
    census uses.
    """

    @staticmethod
    def _five_xx(source: str) -> list[Construction]:
        return [
            c
            for c in scan_source("needle.py", source)
            if c.status is not None and c.status >= 500
        ]

    def test_positive_a_single_line_keyword_raise_is_detected(self) -> None:
        source = (
            "from fastapi import HTTPException\n"
            "def handler():\n"
            "    raise HTTPException(status_code=500, detail='boom')\n"
        )
        found = self._five_xx(source)
        assert found == [Construction("needle.py", "handler", "HTTPException", 500)]

    def test_positive_a_status_on_a_CONTINUATION_LINE_is_detected(self) -> None:
        """The shape a LINE-BASED grep misses.

        Two real sites are written this way — ``cron.py``'s ``cron_sync`` and
        ``debug_key_flow.py``'s ``_read_test_creds`` — and missing them is
        precisely how this programme's earlier census came back as 9 instead of
        12. ``ast`` sees the call, not the line.
        """
        source = (
            "from fastapi import HTTPException\n"
            "def handler():\n"
            "    raise HTTPException(\n"
            "        status_code=500,\n"
            "        detail='boom',\n"
            "    )\n"
        )
        found = self._five_xx(source)
        assert found == [Construction("needle.py", "handler", "HTTPException", 500)]

    def test_positive_a_POSITIONAL_status_is_detected(self) -> None:
        source = (
            "from fastapi import HTTPException\n"
            "def handler():\n"
            "    raise HTTPException(503)\n"
        )
        found = self._five_xx(source)
        assert found == [Construction("needle.py", "handler", "HTTPException", 503)]

    def test_negative_a_COMMENTED_OUT_raise_is_NOT_detected(self) -> None:
        """``services/job_worker.py`` carries exactly this shape inside a ``#`` comment.

        A grep counts it; the parser cannot see it. If this ever flipped to
        detected, the "fix" would be to weaken the scan.
        """
        source = (
            "def handler():\n"
            "    # raise HTTPException(500)  # historical note, do not restore\n"
            "    return None\n"
        )
        assert self._five_xx(source) == []
        assert scan_source("needle.py", source) == []

    def test_negative_a_legitimate_4xx_is_NOT_detected(self) -> None:
        """71 raw 4xx sites exist and are deliberately out of scope.

        A scanner that swept them in would be unusable and would be relaxed
        until it caught nothing.
        """
        source = (
            "from fastapi import HTTPException\n"
            "def handler():\n"
            "    raise HTTPException(status_code=404, detail='nope')\n"
        )
        assert self._five_xx(source) == []
        assert len(scan_source("needle.py", source)) == 1, (
            "the 404 must still be SEEN as a construction — it is only excluded "
            "by the >= 500 filter. If it stopped being seen, the scanner broke "
            "rather than the filter working."
        )

    def test_negative_a_super_init_status_code_is_NOT_a_matched_construction(self) -> None:
        """Blind spot (a), made concrete — the ``ast.Name`` vs ``ast.Attribute`` line.

        This is the shape of ``VenueTransientHTTPException.__init__`` in
        ``services/error_contract.py``, and it is the whole difference between
        the strict count of 3 and the loose count of 4.
        """
        source = (
            "class VenueTransient(HTTPException):\n"
            "    def __init__(self, status_code, detail):\n"
            "        super().__init__(status_code=status_code, detail=detail)\n"
        )
        assert scan_source("needle.py", source) == []

    def test_negative_a_string_mentioning_the_constructor_is_NOT_detected(self) -> None:
        source = (
            "def handler():\n"
            "    return 'raise HTTPException(status_code=500)'\n"
        )
        assert scan_source("needle.py", source) == []


# ---------------------------------------------------------------------------
# Gate 4 — the scan is not vacuous.
# ---------------------------------------------------------------------------


class TestVacuityFence:
    def test_the_scan_actually_visited_the_tree(self) -> None:
        """A scanner matching nothing agrees with any quarantine, forever."""
        found, file_count = scan_tree()
        assert file_count >= MIN_FILES_SCANNED, (
            f"only {file_count} files scanned — the roots or the tests filter "
            "broke, and an empty scan agrees with the quarantine by accident"
        )
        http_exception_calls = [
            c for c in found if c.constructor == "HTTPException"
        ]
        assert len(http_exception_calls) >= MIN_HTTPEXCEPTION_CALLS_ANY_STATUS, (
            "the scanner found no HTTPException construction at ANY status. It "
            "is matching nothing, so every equality above is vacuously true."
        )

    def test_the_scan_sees_far_more_than_the_5xx_it_reports(self) -> None:
        """Positive counterpart: the >= 500 filter is doing real work.

        If the census total ever equalled the total number of constructions, the
        filter has stopped filtering and the agreement below means nothing.
        """
        found, _ = scan_tree()
        assert len(found) > EXPECTED_SITE_COUNT


# ---------------------------------------------------------------------------
# Gate 5 — the blind spots are ASSERTED, not implied.
# ---------------------------------------------------------------------------


class TestBlindSpotsArePinned:
    def test_non_literal_statuses_on_matched_constructors_are_exactly_three(self) -> None:
        """Blind spot (a), under the STRICT predicate. See the module docstring.

        A quarantined site whose literal is hoisted to a constant or wrapped
        (``status_code=int("500")``) keeps raising the same status on the wire
        while vanishing from the census. That looks like a tidy-up in review, so
        the count is pinned: a fourth one forces a decision here.
        """
        found, _ = scan_tree()
        non_literal = sorted(
            (c.module, c.function, c.constructor) for c in found if c.status is None
        )
        assert len(non_literal) == EXPECTED_NON_LITERAL_STATUS_SITES, (
            f"non-literal statuses on MATCHED constructors moved: {non_literal}. "
            "The census can only see integer literals, so each of these is a "
            "site whose status it cannot check. The three known ones are "
            "legitimate pass-throughs of an already-validated status. A NEW one "
            "is a raw 5xx made invisible to this census — resolve it, or route "
            "the site through service_error(). ⚠️ The number is 3 under the "
            "STRICT predicate (an ast.Call with an ast.Name func in "
            "{HTTPException, JSONResponse}); a LOOSE 'any status_code= keyword, "
            "any callee' reading gives 4, the fourth being "
            "VenueTransientHTTPException.__init__'s super().__init__, which is "
            "an ast.Attribute and not a construction. Do not reconcile the two "
            "by changing the predicate."
        )
        assert (
            EXPECTED_NON_LITERAL_STATUS_SITES_UNDER_LOOSE_READING
            == EXPECTED_NON_LITERAL_STATUS_SITES + 1
        ), "the strict/loose gap is the single super().__init__; if it moved, re-measure both"

    def test_the_three_known_non_literal_sites_are_the_contract_pass_throughs(self) -> None:
        """Positive counterpart: name them, so the count is not just a number.

        All three hand-typed. Each hands on a status ``_validate`` has already
        checked, which is why they are acceptable rather than merely tolerated.
        """
        found, _ = scan_tree()
        non_literal = {
            (c.module, c.function, c.constructor) for c in found if c.status is None
        }
        assert non_literal == {
            ("error_contract.py", "service_error", "HTTPException"),
            ("error_contract.py", "service_error_response", "JSONResponse"),
            ("main.py", "venue_transient_exception_handler", "JSONResponse"),
        }, f"the non-literal sites are no longer the known pass-throughs: {sorted(non_literal)}"

    def test_httpexception_subclasses_and_their_sites_are_pinned(self) -> None:
        """Blind spot (b): LATENT, not live — and it must stay that way visibly.

        A subclass is constructed by its own name, which the scanner does not
        match. Today the one in-tree subclass is only ever built at 424, so
        nothing is hidden. A subclass site acquiring a >= 500 literal would be
        invisible to the census, so both counts are pinned here.
        """
        subclasses: list[tuple[str, str]] = []
        for path in scanned_files():
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.ClassDef):
                    continue
                for base in node.bases:
                    base_name = (
                        base.id
                        if isinstance(base, ast.Name)
                        else base.attr if isinstance(base, ast.Attribute) else None
                    )
                    if base_name == "HTTPException":
                        subclasses.append((path.name, node.name))

        assert len(subclasses) == EXPECTED_HTTPEXCEPTION_SUBCLASSES, (
            f"in-tree HTTPException subclasses moved: {sorted(subclasses)}. Each "
            "one is a constructor name this census does NOT match."
        )
        assert subclasses == [("error_contract.py", "VenueTransientHTTPException")]

        subclass_names = {name for _, name in subclasses}
        sites: list[tuple[str, str, int | None]] = []
        for path in scanned_files():
            tree = ast.parse(path.read_text(encoding="utf-8"))
            enclosing = _enclosing_function_resolver(tree)
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                if not isinstance(func, ast.Name) or func.id not in subclass_names:
                    continue
                status: int | None = None
                keyword = next(
                    (kw for kw in node.keywords if kw.arg == "status_code"), None
                )
                if keyword is not None:
                    status = _literal_int(keyword.value)
                elif node.args:
                    status = _literal_int(node.args[0])
                sites.append((path.name, enclosing[node], status))

        assert len(sites) == EXPECTED_SUBCLASS_CONSTRUCTION_SITES, (
            f"HTTPException-subclass construction sites moved: {sorted(sites)}"
        )
        five_xx = sorted(s for s in sites if s[2] is None or s[2] >= 500)
        assert five_xx == [], (
            f"a subclass site is now >= 500 (or non-literal): {five_xx}. This is "
            "a raw permanent 5xx the census CANNOT SEE, because the scanner "
            "matches only HTTPException/JSONResponse by bare name. Route it "
            "through service_error(), or widen MATCHED_CONSTRUCTORS and add the "
            "site to QUARANTINE."
        )
        assert {s[2] for s in sites} == {424}, (
            "every VenueTransientHTTPException construction is expected to be a "
            "424; its own __init__ refuses anything outside 400..499"
        )
