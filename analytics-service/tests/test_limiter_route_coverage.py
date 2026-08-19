"""B1 / RATE-03 — Python rate limiting is bypassable BY OMISSION. This closes it.

Phase 146.1 plan 02, from the founder-directed xhigh review of v1.19
(2026-08-18). **The defect:** a new FastAPI route that simply forgets
``@limiter.limit`` ships completely unlimited, and nothing in CI notices.

**The mechanism — why the existing gates cannot see it.**
``limiter._route_limits`` is populated at DECORATION time
(``slowapi/extension.py:669``: ``name = f"{func.__module__}.{func.__name__}"``).
An UNDECORATED route therefore never enters that dict at all. Every surviving
limiter gate iterates that dict, so its population IS the limited set and an
omission is *structurally invisible* to it — not "missed", but unreachable by
construction:

* ``test_limiter_identity.py:568-594`` ``test_rate_limited_route_set_is_a_literal``
  (the plan cites this as ``:567-594``; the ``def`` sits at 568) builds
  ``{name for name in rl.limiter._route_limits if name.startswith("routers.")}``
  and compares it to a literal. A route with no decorator contributes no name.
* ``test_limiter_identity.py:596-612``
  ``test_every_registered_router_limit_is_shared_or_quarantined`` iterates the
  same dict, asserting each REGISTERED limit keys correctly. It says nothing
  about routes that registered nothing.

Both are good gates for what they cover — limiter IDENTITY, i.e. which bucket a
limited route keys on. Neither covers COVERAGE, i.e. whether a route is limited
at all. This file supplies the missing half by deriving its population from the
**whole route surface** (``main.app.routes``) rather than from the limiter's own
registry, and partitioning it against an explicit quarantine roster.

**History — ⛔ do NOT resurrect ``test_match_routes_still_have_no_limiter``.**
That gate was an absence-tripwire pinning the two ``routers/match.py`` routes as
deliberately unlimited. It was DELETED in 146-02 because those routes gained
real ``30/minute`` limits (``routers/match.py:1625-1626, 1855-1856``; the
literal set at ``test_limiter_identity.py:576-583`` moved in the same commit).
Re-adding it would assert the opposite of the shipped posture. The general
successor is the roster below: an absence is now recorded as a quarantine ENTRY
with a reason, not as a bespoke test.

**Filename adjudication (recorded here so nobody re-opens it).**
``146.1-PATTERNS.md`` proposed ``test_route_limit_closure.py``;
``146.1-RESEARCH.md`` §2.5 proposed ``test_limiter_route_coverage.py``. RESEARCH
wins, and its reason is the one above: ``test_limiter_identity.py`` is scoped to
*identity*, *coverage* is a different property, and mixing them makes the
vacuity fences in both harder to reason about. PATTERNS' contribution was the
file's SHAPE, which this file follows in full. Both files run in the same
``python`` CI job, so nothing is lost by the split.

**Shape provenance.** This is a shape coming home rather than an import:
``src/lib/seam-ratelimit-posture.invariant.test.ts`` (the TypeScript analogue,
whose ``NO_LIMITER_QUARANTINE`` docblock at ``:205-219`` records that it borrowed
its shape FROM ``analytics-service/tests/test_limiter_identity.py``).

**Zero runtime effect, deliberately.** This file adds no framework-wide fallback
ceiling to the shared ``Limiter`` and installs no slowapi request middleware.
Both were considered and rejected in ``146.1-RESEARCH.md``'s Alternatives table:
a blanket fallback is a runtime behaviour change on 20 live routes including the
cron and internal surfaces — that is RATE-04-class work, which is founder
territory (D-146-4) and explicitly out of scope — and the middleware path
re-enters ``__evaluate_limits`` with ``in_middleware=True``, double-counting
against ``/process-key``'s dynamic limits. An enumeration gate is the structural
successor with no behavioural cost. **This file asserts that every route is
limited OR consciously quarantined; it says nothing about whether any limit is
the right NUMBER.**

⛔ Run from ``analytics-service/`` with ``python3``. A repo-root pytest run misses
the VCR cassettes and makes LIVE broker calls.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
from typing import Any

import pytest
from fastapi.routing import APIRoute

from services import rate_limit as rl


@pytest.fixture(autouse=True)
def _reset_limiter_buckets() -> Any:
    """Copied from ``test_limiter_identity.py:72-82``.

    The claimless platform bucket is PATH-keyed and shared across every test in
    the process, so drive-to-429 probes in sibling suites leak into this one and
    vice versa. Reset before AND after so test ordering never matters. (This
    file only reads registries, but the fixture costs nothing and removes a
    whole class of "it passes alone, reds in the suite" reports.)
    """
    rl.limiter.reset()
    yield
    rl.limiter.reset()


# ---------------------------------------------------------------------------
# Population derivation.
#
# ⚠️ THE WHOLE POINT: the population comes from `main.app.routes` — the entire
# registered surface — NEVER from `limiter._route_limits`. Deriving it from the
# limiter's own registry is precisely the self-referential shape that lets an
# undecorated route hide, and it is what the two sibling gates named in the
# module docstring do.
# ---------------------------------------------------------------------------


_PROBE_SRC = r"""
import json, sys
from fastapi.routing import APIRoute

import main
from services import rate_limit as rl

# ⚠️ `app.routes` IS NOT A FLAT LIST OF ROUTES on the pinned FastAPI. Since
# 0.139 `include_router` is DEFERRED: each call appends one opaque
# `_IncludedRouter` placeholder to `app.routes` and the child routes are
# materialised only on demand. So `isinstance(r, APIRoute)` over `app.routes`
# sees ONLY the handlers decorated directly on `app` — MEASURED as 1 of 20
# under fastapi 0.139.0 (the pin, and what CI installs) versus 20 of 20 under
# 0.135.1. A local interpreter that has drifted behind the pin therefore
# passes this gate while CI fails it; that drift is what hid this for a day.
#
# `iter_route_contexts` is the flattener FastAPI's own `get_openapi` uses, and
# `.original_route` hands back the underlying APIRoute with its endpoint
# identity (`__module__`/`__name__`) intact — which is the join key into
# slowapi's registries. If a future FastAPI renames it, the fallback below
# returns the truncated surface and the MIN_API_ROUTES fence reddens rather
# than the gate silently agreeing with everything.
try:
    from fastapi.routing import iter_route_contexts as _iter_ctx
except ImportError:  # fastapi < 0.139 — `app.routes` is already flat
    _iter_ctx = None

if _iter_ctx is not None:
    _walk = [c.original_route for c in _iter_ctx(main.app.routes)]
    _enumeration = "iter_route_contexts"
else:
    _walk = list(main.app.routes)
    _enumeration = "app.routes"

derived = [
    f"{r.endpoint.__module__}.{r.endpoint.__name__}"
    for r in _walk
    if isinstance(r, APIRoute)
]
# Diagnostics: when this probe reports a truncated surface the ONLY place it
# has ever done so is CI, so it must carry enough context to diagnose itself
# from the log alone rather than costing another round-trip.
import os
diag = {
    "python": sys.version.split()[0],
    "cwd": os.getcwd(),
    "main_file": getattr(main, "__file__", None),
    "sys_path_head": sys.path[:3],
    # What the app ACTUALLY holds, by class name and path. If the count is right
    # but `derived` is short, the isinstance filter is the thing that is wrong
    # (two fastapi copies, or a custom route_class), not the registration.
    "app_route_classes": sorted(
        {type(r).__name__ for r in main.app.routes}
    ),
    "app_route_total": len(main.app.routes),
    "app_route_paths": sorted(
        getattr(r, "path", "?") for r in main.app.routes
    )[:30],
    "apiroute_module": APIRoute.__module__,
    "fastapi_file": __import__("fastapi").__file__,
    "fastapi_version": __import__("fastapi").__version__,
    # Which enumeration ran. A truncated surface reported as "app.routes" on a
    # modern fastapi means the flattener was renamed, not that routes vanished.
    "enumeration": _enumeration,
}
try:
    import routers as _routers_pkg
    diag["routers_pkg_file"] = getattr(_routers_pkg, "__file__", None)
    diag["routers_pkg_path"] = list(getattr(_routers_pkg, "__path__", []))
    per_router = {}
    for _name in ("cron","exchange","match","portfolio","optimizer",
                  "simulator","internal","csv","process_key","debug_key_flow"):
        try:
            _m = __import__(f"routers.{_name}", fromlist=["router"])
            _r = getattr(_m, "router", None)
            per_router[_name] = {
                "module_file": getattr(_m, "__file__", None),
                "type": type(_m).__name__,
                "router_type": type(_r).__name__,
                "n_routes": len(getattr(_r, "routes", [])),
            }
        except Exception as exc:  # noqa: BLE001 - diagnostics must not mask
            per_router[_name] = {"import_error": f"{type(exc).__name__}: {exc}"}
    diag["per_router"] = per_router
except Exception as exc:  # noqa: BLE001
    diag["routers_pkg_error"] = f"{type(exc).__name__}: {exc}"

print(json.dumps({
    "derived": sorted(derived),
    "static": sorted(rl.limiter._route_limits),
    "dynamic": {k: len(v) for k, v in rl.limiter._dynamic_route_limits.items()},
    "diag": diag,
}))
"""

_probe_cache: dict[str, Any] | None = None


def _probe() -> dict[str, Any]:
    """Enumerate the route/limit surface in a CLEAN interpreter.

    ⚠️ THIS RUNS IN A SUBPROCESS ON PURPOSE, and the reason is measured, not
    stylistic. Importing ``main`` in-process makes this gate a hostage to
    whatever every previously-collected test module did to ``sys.modules``.
    Concretely: a sibling installs ``MagicMock()`` entries for modules it does
    not want to import for real, a ``MagicMock`` ITERATES AS EMPTY
    (``list(iter(MagicMock())) == []``), and ``FastAPI.include_router``
    iterates ``router.routes`` — so if ``main`` is first imported under those
    stubs, all ten ``include_router`` calls at ``main.py:811-825`` add ZERO
    routes and the crippled ``app`` is cached for the rest of the session.

    That pollution risk is real but it is NOT what reddened CI. The observed
    "1 route instead of 20" was the deferred-``include_router`` change in the
    pinned fastapi 0.139 (see the enumeration note in ``_PROBE_SRC``); this
    subprocess was already in place and did not fix it, which is precisely how
    that hypothesis got falsified. The isolation is kept on its own merits —
    it removes a whole class of order-dependent failure from a 5000-test
    session — not as a remedy for the version gap.

    A fresh interpreter also measures the surface the way PRODUCTION builds
    it, which is what this gate is about.

    ⛔ Do not "optimise" this back to a plain ``import main``. The anti-vacuity
    fence below is what catches the failure, and a truncated surface makes the
    coverage partition agree with everything.
    """
    global _probe_cache
    if _probe_cache is None:
        proc = subprocess.run(
            [sys.executable, "-c", _PROBE_SRC],
            cwd=str(pathlib.Path(__file__).resolve().parents[1]),
            capture_output=True,
            text=True,
            timeout=180,
        )
        assert proc.returncode == 0, (
            "the clean-interpreter probe failed to import the app. This is a "
            "REAL failure, not a harness quirk: production imports `main` the "
            f"same way.\nstdout={proc.stdout}\nstderr={proc.stderr}"
        )
        _probe_cache = json.loads(proc.stdout.strip().splitlines()[-1])
    return _probe_cache


def _api_routes() -> list[str]:
    """Every real API endpoint key on the app, from the clean-interpreter probe.

    ⛔ Never filter by path prefix. A prefix denylist is an open-ended string
    match that a future author extends "just for this one route", which is how a
    coverage gate quietly becomes an opt-out list. The probe already excludes
    FastAPI's four built-in doc routes structurally, by `isinstance(r, APIRoute)`
    — they are plain `starlette.routing.Route` objects.
    """
    return _probe()["derived"]


def _endpoint_key(route: APIRoute) -> str:
    """The join key between a route and the limiter registries.

    slowapi keys ``_route_limits`` by ``f"{func.__module__}.{func.__name__}"`` of
    the UNDECORATED handler (``slowapi/extension.py:669``), and its decorator
    wraps with ``functools.wraps`` (``:721``, ``:753``), so the endpoint FastAPI
    registers preserves both attributes. That makes this expression the exact
    join key. [MEASURED by probe against the installed slowapi 0.1.10.]
    """
    endpoint = route.endpoint
    return f"{endpoint.__module__}.{endpoint.__name__}"


def _derived_keys() -> set[str]:
    return set(_api_routes())


def _limited_keys() -> set[str]:
    """Every endpoint key carrying at least one registered limit.

    The UNION of both registries is deliberate. slowapi routes CALLABLE limit
    providers to ``_dynamic_route_limits`` instead of ``_route_limits``
    (``extension.py:707-709``); reading only the latter would report
    ``/process-key`` — the busiest ingestion route on the service — as
    unlimited. The dynamic arm is ALSO pinned separately below, so a refactor
    that flattens it into a static limit stays visible.
    """
    probe = _probe()
    return set(probe["static"]) | set(probe["dynamic"])


# ---------------------------------------------------------------------------
# The quarantine roster.
#
# HAND-TYPED, one entry per deliberately-unlimited route, each carrying a file
# anchor and a reason. It is NOT derived from anything: deriving both sides
# would be two readers of the same dict agreeing with each other, which is not
# evidence (`seam-ratelimit-posture.invariant.test.ts:172-179`).
#
# ⛔ COMPARED BY EQUALITY, NEVER CONTAINMENT — the reason, in substance from
# `seam-ratelimit-posture.invariant.test.ts:205-219`: a containment check would
# let a stale exemption outlive the thing it exempted, and a NEW entry appearing
# in the unlimited partition means an UNLIMITED ROUTE — decide whether that is
# intended and write the reason down beside this roster.
#
# SHRINK INSTRUCTION: if any route below is ever given a real limit, DELETE its
# entry here IN THE SAME COMMIT. The equality is deliberate precisely so that a
# repair cannot leave a stale exemption behind
# (`test_limiter_identity.py:484-486`).
# ---------------------------------------------------------------------------

NO_LIMITER_QUARANTINE: frozenset[str] = frozenset(
    {
        # `main.py:828-829` — Railway liveness probe (`healthcheckPath=/health`).
        # Limiting it would let request volume trigger pod restarts, which is
        # strictly worse than the DoS surface of an unauthenticated 200/503.
        "main.health",
        # `routers/cron.py:595-596` — cron surface, service-key gated. Called on
        # a schedule by trusted infrastructure, not by users.
        "routers.cron.cron_sync",
        # `routers/match.py:1921-1922` — cron surface, service-key gated. This
        # one is EXPLICITLY DECLARED unlimited in prose:
        # `services/rate_limit.py:113-114` — "POST /api/match/cron-recompute
        # deliberately stays unlimited: cron surface, service-key gated". The
        # sibling `/api/match/recompute` (user-facing) DID gain 30/minute in
        # 146-02; these two are a discriminating pair, not an oversight.
        "routers.match.cron_recompute",
        # `routers/debug_key_flow.py:119-120` — Phase 16 / OBSERV-07 admin-gated
        # diagnostic SSE, founder-only, mounted at `main.py:824-825`.
        "routers.debug_key_flow.validate_key",
        # `routers/debug_key_flow.py:165-166` — same admin-gated SSE surface.
        "routers.debug_key_flow.encrypt_key",
        # `routers/debug_key_flow.py:202-203` — same admin-gated SSE surface.
        "routers.debug_key_flow.fetch_trades",
        # `routers/internal.py:184-185` — NOT unprotected: it carries a
        # hand-rolled per-`key_id` 10/min token bucket (`_consume_rate_limit` at
        # `:125`, consumed at `:231`). It is quarantined from the slowapi
        # partition because its ceiling lives in a different mechanism, not
        # because it has none. ⚠️ If that bespoke bucket is ever deleted, this
        # entry becomes a lie — the reason is written here so a reader can check
        # it, which a bare exemption list could not support.
        "routers.internal.get_key_permissions",
    }
)

# The vacuity fence's bounds. Deliberately LOOSER than the measured population
# (20 APIRoute, 13 limited, this session) so ordinary growth does not redden the
# file. What they exist to catch is a walk that stopped walking or a join key
# that stopped joining — either of which makes every set assertion below
# trivially true.
MIN_API_ROUTES = 18
MIN_LIMITED_ROUTES = 10


class TestRouteLimitCoverage:
    """Every registered route is rate-limited, or consciously quarantined."""

    def test_the_walk_is_not_vacuous(self) -> None:
        """⚠️ ASSERTED FIRST, and it is not a formality.

        Every other assertion in this file is a statement about a DERIVED
        population. If the derivation returns nothing — a moved app object, a
        renamed registry, an import that silently half-failed — the set
        equalities below all pass against the empty set. A guard that scans
        nothing agrees with everything, forever.
        """
        routes = _api_routes()
        assert len(routes) >= MIN_API_ROUTES, (
            f"DIAG={json.dumps(_probe().get('diag', {}), indent=2)}\n"
            f"the APIRoute walk found only {len(routes)} routes (expected at "
            f"least {MIN_API_ROUTES}). `main.app.routes` moved, or `main` no "
            "longer performs every `include_router`, so the coverage partition "
            "below is measuring a truncated surface and agrees with everything. "
            "Re-anchor this gate, do not delete it."
        )

        limited_here = _derived_keys() & _limited_keys()
        assert len(limited_here) >= MIN_LIMITED_ROUTES, (
            f"only {len(limited_here)} of {len(routes)} routes joined to a "
            f"registered limit (expected at least {MIN_LIMITED_ROUTES}). The "
            "endpoint->registry join key stopped matching — most likely a "
            "slowapi upgrade changed the `module.qualname` key format, or a new "
            "decorator without `functools.wraps` is masking `__name__`. Every "
            "route would now look unlimited. Re-anchor this gate, do not "
            "delete it."
        )

    def test_the_unlimited_partition_equals_the_quarantine(self) -> None:
        """THE GATE. A new undecorated route reddens here, by name.

        ⛔ EQUALITY, not containment. Both directions carry information:

        * ``unexpected=`` — a route that is UNLIMITED and not quarantined. Either
          decorate it, or add it to the roster above WITH A REASON. Do not
          silence it by widening a containment check.
        * ``missing=`` — a quarantine entry whose route no longer appears
          unlimited (it gained a limit, was renamed, or was deleted). The
          exemption has outlived the thing it exempted and must be removed. A
          containment check would swallow this direction entirely, which is why
          it is not one.
        """
        unlimited = _derived_keys() - _limited_keys()
        assert unlimited == NO_LIMITER_QUARANTINE, (
            "the set of registered routes with NO registered rate limit "
            "changed: "
            f"unexpected={sorted(unlimited - NO_LIMITER_QUARANTINE)}, "
            f"missing={sorted(NO_LIMITER_QUARANTINE - unlimited)}. "
            "`unexpected` means a route ships UNLIMITED - give it a "
            "`@limiter.limit`, or quarantine it above with a file anchor and a "
            "stated reason. `missing` means a stale exemption outlived its "
            "route - delete that roster entry in the same commit as the repair."
        )

    def test_the_partition_is_total(self) -> None:
        """Every derived key is in exactly one of {limited, quarantined}.

        Stated as set algebra rather than membership tests so that neither half
        can be satisfied by an accident of iteration order, and so a key cannot
        be double-counted into looking classified when it is in both.
        """
        derived = _derived_keys()
        limited = _limited_keys()

        in_both = derived & limited & NO_LIMITER_QUARANTINE
        assert in_both == set(), (
            f"route(s) {sorted(in_both)} are BOTH rate-limited and quarantined "
            "as unlimited. The quarantine entry is stale - the route was given "
            "a real limit. Delete the roster entry."
        )

        in_neither = derived - limited - NO_LIMITER_QUARANTINE
        assert in_neither == set(), (
            f"route(s) {sorted(in_neither)} are neither rate-limited nor "
            "quarantined. This is the bypass-by-omission defect this file "
            "exists to catch."
        )

        classified = (derived & limited) | (derived & NO_LIMITER_QUARANTINE)
        assert classified == derived, (
            "the two partitions do not sum to the derived population: "
            f"unclassified={sorted(derived - classified)}"
        )

    def test_the_dynamic_limit_arm_still_holds_process_key(self) -> None:
        """``/process-key``'s CALLABLE limits, pinned in their OWN registry.

        Asserted against ``_dynamic_route_limits`` specifically rather than
        against the union used by the partition above. Reason: converting these
        to static limits, or dropping one of the two, leaves the union — and so
        the partition — completely unchanged. Only a registry-specific assertion
        can see it.

        Two limits under ONE key (``routers/process_key.py:871, 880-881``)
        [MEASURED: ``len(_dynamic_route_limits["routers.process_key.process_key"])
        == 2``]. The count is pinned because dropping one of a pair is exactly
        the kind of edit that reads as a no-op in review.
        """
        dynamic = _probe()["dynamic"]
        key = "routers.process_key.process_key"
        assert key in dynamic, (
            f"{key} is no longer in the CALLABLE-limit registry. Its limits were "
            "converted to static, renamed, or dropped. If converted, this "
            "assertion must move to `_route_limits` in the same commit; if "
            "dropped, the busiest ingestion route on the service just went "
            "unlimited. Re-anchor this gate, do not delete it."
        )
        # The probe returns the COUNT per key (the limit objects themselves do
        # not survive a process boundary). The count is the property being
        # pinned, so nothing is lost.
        assert dynamic[key] == 2, (
            f"{key} carries {dynamic[key]} callable limit(s), expected 2 "
            "(`routers/process_key.py:871, 880-881`). One of the pair was "
            "removed - confirm that is intended and update this literal."
        )
