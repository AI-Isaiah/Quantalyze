"""PYAPI-03 — the IP-keyed limiter class, pinned closed.

Phase 140.1 plan 07. The defect: behind Railway's edge proxy
``slowapi.util.get_remote_address`` returns the EDGE ip, so a "per-IP" bucket is
in fact PLATFORM-WIDE (RESEARCH G-10/G-11). Nine decorated routes had it. Two
users running Scenario Composer could 429 each other on L-9's 20/minute.

**The class is IP KEYING (behaviour), not "private ``Limiter()``" (syntax).**
Enumerating by the syntax finds 3 modules / 8 routes and misses
``routers/optimizer.py``, which imports the shared limiter correctly and inherits
its default ``key_func`` by omission (RESEARCH X-4 / TRAP-5 — an under-count that
was latent inside the finding documenting TRAP-5).

Every assertion below pins a **literal**: the route path, the registry name, the
limit string, the scope, the bucket string. Nothing is read back out of the
limiter and compared to itself (programme non-negotiable #3 — 10 simultaneous
semantic mutations once produced a byte-identical green because every oracle was
self-referential).

Three gates:

1. :class:`TestPerRouteKeyIdentity` — the wiring. For each of L-1..L-9, the
   limit REGISTERED on the endpoint carries the shared tenant-or-platform key
   function bound to that route's scope. Asserting the module-level helper is
   the right shape would not prove any decorator invokes it.
2. :class:`TestBucketBehaviour` — the behaviour. A verified claim buckets to a
   tenant; a claimless caller buckets to the documented platform ceiling.
3. :class:`TestClassClosure` — the count. No source token ``get_remote_address``
   survives under ``routers/`` except the quarantined FINDING-10 site, and the
   set of rate-limited routes is a literal.
"""

from __future__ import annotations

import functools
import hashlib
import hmac
import pathlib
import time
import tokenize
from typing import Any

import pytest

# Import every router that registers a limit, so `limiter._route_limits` is
# fully populated no matter which tests pytest collected first.
import routers.csv  # noqa: F401
import routers.exchange  # noqa: F401
import routers.optimizer  # noqa: F401
import routers.portfolio  # noqa: F401
import routers.simulator  # noqa: F401
from services import rate_limit as rl

# ---------------------------------------------------------------------------
# The class, enumerated. LITERALS — copied from RESEARCH Q1.4's L-table, not
# derived from the code under test.
#
# (L-row, route path, slowapi registry name, limit string, expected scope)
#
# Limit strings are pinned so this file also proves PYAPI-03 changed IDENTITY
# ONLY. The value audit is RATE-04 / Phase 146; a plan that "fixed" the keying
# and quietly loosened a ceiling would go red here.
# ---------------------------------------------------------------------------

IP_KEYED_CLASS: list[tuple[str, str, str, str, str]] = [
    ("L-1", "/api/validate-key", "routers.exchange.validate_key", "100 per 1 hour", "validate_key"),
    ("L-2", "/api/encrypt-key", "routers.exchange.encrypt_key", "100 per 1 hour", "encrypt_key"),
    ("L-3", "/api/fetch-trades", "routers.exchange.fetch_trades", "10 per 1 hour", "fetch_trades"),
    ("L-4", "/api/csv/validate", "routers.csv.csv_validate", "30 per 1 hour", "csv_validate"),
    ("L-5", "/api/portfolio-analytics", "routers.portfolio.portfolio_analytics", "10 per 1 hour", "portfolio_analytics"),
    ("L-6", "/api/portfolio-optimizer", "routers.portfolio.portfolio_optimizer", "10 per 1 hour", "portfolio_optimizer"),
    ("L-7", "/api/portfolio-bridge", "routers.portfolio.portfolio_bridge", "10 per 1 hour", "portfolio_bridge"),
    ("L-8", "/api/verify-strategy", "routers.portfolio.verify_strategy", "5 per 1 hour", "verify_strategy"),
    ("L-9", "/api/optimize-weights", "routers.optimizer.optimize_weights_endpoint", "20 per 1 minute", "optimize_weights"),
]

#: The plan's count, as a literal. If a tenth route joins the class, the
#: enumeration above is stale and a checker must be told rather than the number
#: being quietly padded.
EXPECTED_CLASS_SIZE = 9

#: FINDING-10. ``routers/simulator.py:_simulator_rate_limit_key`` returns
#: ``f"simulator:ip:{get_remote_address(request)}"`` — by BEHAVIOUR a TENTH
#: IP-keyed route. Plan 140.1-07's do-not-touch list describes it as "correctly
#: user-keyed", which was true until the PR#241 follow-up reverted it (the
#: function's own docstring records the revert; the effective per-tenant quota
#: moved in-handler to ``_check_simulator_user_rate`` against ``req.user_id``).
#: Left untouched here per the plan's explicit scope fence and QUARANTINED by a
#: literal one-file allow-list: nothing else under routers/ may key on the
#: request address, and if simulator is ever repaired this list must shrink.
IP_KEYED_QUARANTINE: frozenset[str] = frozenset({"simulator.py"})

ROUTERS_DIR = pathlib.Path(__file__).resolve().parent.parent / "routers"


def _registered_limits(registry_name: str) -> list[Any]:
    """Every slowapi ``Limit`` registered for one endpoint."""
    return list(rl.limiter._route_limits.get(registry_name, []))


def _mint_claim(payload: str, secret: str, ttl: int = 300) -> str:
    """An INDEPENDENT X-Tenant-Claim minter.

    Deliberately re-implements the wire format from
    ``services/rate_limit.py``'s docstring rather than calling any helper the
    verifier also uses — an oracle that signs with the code under test proves
    only that the code agrees with itself.
    """
    exp = int(time.time()) + ttl
    mac = hmac.new(
        secret.encode("utf-8"), f"{payload}.{exp}".encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"{payload}.{exp}.{mac}"


class _FakeRequest:
    """Minimal Request stand-in: headers plus ``url.path``.

    A key function may read headers only — the body is still un-awaited when
    slowapi calls it (RESEARCH G-7) — so this is the whole surface.
    """

    def __init__(self, path: str, headers: dict[str, str] | None = None) -> None:
        self.headers = dict(headers or {})
        self.url = type("_U", (), {"path": path})()


def _source_name_tokens(path: pathlib.Path) -> set[str]:
    """Every NAME token in a Python file.

    Tokenising rather than grepping is deliberate. The plan asks for a
    "non-comment" count, and ``grep -v '#'`` is both too weak (it drops whole
    lines that merely contain a ``#``) and too strong (a docstring naming the
    banned symbol — like the ones this repair *adds* to explain itself — would
    register as a live reference). NAME tokens are exactly the real references:
    comments and strings are other token types.
    """
    with path.open("rb") as fh:
        return {
            tok.string
            for tok in tokenize.tokenize(fh.readline)
            if tok.type == tokenize.NAME
        }


# ---------------------------------------------------------------------------
# Gate 1 — per-route key_func identity (the WIRING)
# ---------------------------------------------------------------------------


class TestPerRouteKeyIdentity:
    """One assertion per L-row, each naming its route path as a literal.

    These read the limit slowapi ACTUALLY REGISTERED for the endpoint. A test
    that inspected ``services.rate_limit.tenant_or_platform_key`` instead would
    stay green through a refactor that dropped every ``key_func=`` argument —
    the exact shape of L-9, where the helper existed and the decorator did not
    use it.
    """

    @pytest.mark.parametrize(
        "row,path,registry_name,limit_str,scope",
        IP_KEYED_CLASS,
        ids=[r[0] for r in IP_KEYED_CLASS],
    )
    def test_route_is_registered_at_its_literal_path(
        self, row: str, path: str, registry_name: str, limit_str: str, scope: str
    ) -> None:
        """The registry name and the URL path are the same endpoint.

        Without this the literal paths above would be decoration: every other
        assertion keys on ``registry_name``, and a renamed route would silently
        detach the two.
        """
        module_name, _, func_name = registry_name.rpartition(".")
        module = __import__(module_name, fromlist=["router"])
        matches = [r for r in module.router.routes if getattr(r, "name", None) == func_name]
        assert matches, f"{row}: no route named {func_name!r} in {module_name}"
        assert [r.path for r in matches] == [path], (
            f"{row}: {registry_name} is mounted at {[r.path for r in matches]}, "
            f"not the expected {path!r}"
        )

    @pytest.mark.parametrize(
        "row,path,registry_name,limit_str,scope",
        IP_KEYED_CLASS,
        ids=[r[0] for r in IP_KEYED_CLASS],
    )
    def test_route_key_func_is_not_get_remote_address(
        self, row: str, path: str, registry_name: str, limit_str: str, scope: str
    ) -> None:
        """PYAPI-03's headline: no decorated route keys on the request address."""
        from slowapi.util import get_remote_address

        limits = _registered_limits(registry_name)
        assert len(limits) == 1, (
            f"{row} {path}: expected exactly one registered limit, got {len(limits)}"
        )
        key_func = limits[0].key_func
        assert key_func is not get_remote_address, (
            f"{row} {path} still keys on get_remote_address. Behind Railway's "
            "edge proxy that is the EDGE ip, so this 'per-IP' bucket is "
            "platform-wide (G-10/G-11)."
        )
        # Also reject the singleton's default: reaching this key by OMISSION is
        # how L-9 happened, and the default is no longer IP-derived, so
        # `is not get_remote_address` alone would now pass vacuously for it.
        assert key_func is not rl.default_platform_key, (
            f"{row} {path} inherits the shared limiter's DEFAULT key rather than "
            "declaring one. That is L-9's exact failure mode — an identity "
            "decision acquired by omission."
        )

    @pytest.mark.parametrize(
        "row,path,registry_name,limit_str,scope",
        IP_KEYED_CLASS,
        ids=[r[0] for r in IP_KEYED_CLASS],
    )
    def test_route_key_func_is_shared_tenant_or_platform_with_its_scope(
        self, row: str, path: str, registry_name: str, limit_str: str, scope: str
    ) -> None:
        """The key is the SHARED function bound to this route's literal scope.

        Nine private copies of the same logic is the instances-vs-classes
        failure mode the repair programme exists to close, so "not IP-keyed" is
        not sufficient — it must be the one function.
        """
        key_func = _registered_limits(registry_name)[0].key_func
        assert isinstance(key_func, functools.partial), (
            f"{row} {path}: expected functools.partial(tenant_or_platform_key, "
            f"scope={scope!r}), got {key_func!r}"
        )
        assert key_func.func is rl.tenant_or_platform_key, (
            f"{row} {path} keys on {key_func.func!r}, not the shared "
            "services.rate_limit.tenant_or_platform_key"
        )
        assert key_func.keywords == {"scope": scope}, (
            f"{row} {path} is bound to {key_func.keywords!r}, expected "
            f"{{'scope': {scope!r}}}"
        )

    @pytest.mark.parametrize(
        "row,path,registry_name,limit_str,scope",
        IP_KEYED_CLASS,
        ids=[r[0] for r in IP_KEYED_CLASS],
    )
    def test_limit_value_is_unchanged_by_the_rekey(
        self, row: str, path: str, registry_name: str, limit_str: str, scope: str
    ) -> None:
        """PYAPI-03 changes bucket IDENTITY only.

        The limit VALUE audit is RATE-04 / Phase 146. A rekey that also loosened
        a ceiling — the easiest way to make a throttling complaint go away —
        would be invisible without this.
        """
        assert str(_registered_limits(registry_name)[0].limit) == limit_str, (
            f"{row} {path}: limit value changed to "
            f"{str(_registered_limits(registry_name)[0].limit)!r}; PYAPI-03 must "
            f"leave it at {limit_str!r} (RATE-04 owns values)."
        )

    def test_scopes_are_distinct_so_no_two_routes_share_a_bucket(self) -> None:
        """Nine routes, nine scopes.

        slowapi already namespaces buckets by endpoint (G-2), so a duplicated
        scope would NOT collapse two counters today — it would be a latent trap
        that fires the moment anything reads the key string on its own (a Redis
        migration, a metric, a log-based alert).
        """
        scopes = [row[4] for row in IP_KEYED_CLASS]
        assert len(set(scopes)) == len(scopes), f"duplicate scope in {scopes}"


# ---------------------------------------------------------------------------
# Gate 2 — bucket behaviour (the CONTRACT), driven through the REGISTERED
# key functions so it proves the decorators, not just the helper.
# ---------------------------------------------------------------------------

_L1_KEY_NAME = "routers.exchange.validate_key"
_L9_KEY_NAME = "routers.optimizer.optimize_weights_endpoint"
_SECRET = "identity-oracle-secret"


class TestBucketBehaviour:
    """The plan's behavioural oracle on L-9 and L-1, bucket strings as literals.

    Every expected value below is written out in full. Deriving one by calling
    ``tenant_or_platform_key`` and comparing would assert only that the function
    equals itself — the failure mode that let 10 simultaneous semantic mutations
    ship a byte-identical green (programme non-negotiable #3).
    """

    @pytest.fixture(autouse=True)
    def _secret(self, monkeypatch: Any) -> None:
        monkeypatch.setenv("INTERNAL_API_TOKEN", _SECRET)

    def test_l9_verified_claim_buckets_to_its_tenant(self) -> None:
        key_func = _registered_limits(_L9_KEY_NAME)[0].key_func
        req = _FakeRequest(
            "/api/optimize-weights",
            {"X-Tenant-Claim": _mint_claim("tenant-alpha", _SECRET)},
        )
        assert key_func(req) == "optimize_weights:t:tenant-alpha"

    def test_l9_claimless_caller_buckets_to_the_documented_platform_ceiling(self) -> None:
        """The literal the plan names.

        This is a CEILING and it is spelled like one. Until
        ``src/lib/analytics-client.ts`` mints ``X-Tenant-Claim`` (a 140.2
        obligation) every real Scenario-Composer request lands here — which is
        the same width it had before PYAPI-03, minus the per-client disguise.
        """
        key_func = _registered_limits(_L9_KEY_NAME)[0].key_func
        assert key_func(_FakeRequest("/api/optimize-weights")) == "platform:/api/optimize-weights"

    def test_l9_anonymous_claim_buckets_to_anon(self) -> None:
        key_func = _registered_limits(_L9_KEY_NAME)[0].key_func
        req = _FakeRequest(
            "/api/optimize-weights", {"X-Tenant-Claim": _mint_claim("public", _SECRET)}
        )
        assert key_func(req) == "optimize_weights:anon"

    def test_l1_verified_claim_buckets_to_its_tenant(self) -> None:
        key_func = _registered_limits(_L1_KEY_NAME)[0].key_func
        req = _FakeRequest(
            "/api/validate-key", {"X-Tenant-Claim": _mint_claim("tenant-alpha", _SECRET)}
        )
        assert key_func(req) == "validate_key:t:tenant-alpha"

    def test_l1_claimless_caller_buckets_to_the_documented_platform_ceiling(self) -> None:
        key_func = _registered_limits(_L1_KEY_NAME)[0].key_func
        assert key_func(_FakeRequest("/api/validate-key")) == "platform:/api/validate-key"

    def test_two_tenants_do_not_share_a_bucket_on_l9(self) -> None:
        """The whole point: one tenant can no longer 429 another.

        Pinned as two literals rather than ``!=`` so a key function that
        returned a constant per request would still be caught.
        """
        key_func = _registered_limits(_L9_KEY_NAME)[0].key_func
        alpha = _FakeRequest(
            "/api/optimize-weights", {"X-Tenant-Claim": _mint_claim("tenant-alpha", _SECRET)}
        )
        beta = _FakeRequest(
            "/api/optimize-weights", {"X-Tenant-Claim": _mint_claim("tenant-beta", _SECRET)}
        )
        assert key_func(alpha) == "optimize_weights:t:tenant-alpha"
        assert key_func(beta) == "optimize_weights:t:tenant-beta"

    def test_forged_claim_cannot_reach_a_tenant_bucket(self) -> None:
        """A claim minted with the WRONG secret falls to the platform ceiling.

        Separates "we parsed the shape" from "we checked the MAC". Without this,
        a verifier that skipped ``compare_digest`` entirely would pass every
        other test in this class.
        """
        key_func = _registered_limits(_L9_KEY_NAME)[0].key_func
        req = _FakeRequest(
            "/api/optimize-weights",
            {"X-Tenant-Claim": _mint_claim("tenant-victim", "the-wrong-secret")},
        )
        assert key_func(req) == "platform:/api/optimize-weights"

    def test_expired_claim_cannot_reach_a_tenant_bucket(self) -> None:
        """A captured claim is not a permanent credential."""
        key_func = _registered_limits(_L9_KEY_NAME)[0].key_func
        req = _FakeRequest(
            "/api/optimize-weights",
            {"X-Tenant-Claim": _mint_claim("tenant-victim", _SECRET, ttl=-10)},
        )
        assert key_func(req) == "platform:/api/optimize-weights"

    def test_platform_buckets_are_per_route_not_one_global_bucket(self) -> None:
        """L-1 and L-9 claimless traffic must not share a counter.

        slowapi namespaces by endpoint anyway (G-2), so this pins the KEY
        STRING — the thing a Redis migration, a metric or a log alert would
        read on its own.
        """
        l1 = _registered_limits(_L1_KEY_NAME)[0].key_func(_FakeRequest("/api/validate-key"))
        l9 = _registered_limits(_L9_KEY_NAME)[0].key_func(_FakeRequest("/api/optimize-weights"))
        assert l1 == "platform:/api/validate-key"
        assert l9 == "platform:/api/optimize-weights"

    @pytest.mark.parametrize(
        "headers",
        [
            {},
            {"X-Tenant-Claim": ""},
            {"X-Tenant-Claim": "a.b"},
            {"X-Tenant-Claim": "x." * 400},
            {"X-Tenant-Claim": "payload.not-a-number.deadbeef"},
            {"X-Tenant-Claim": "payload.9999999999.zz"},
        ],
        ids=["absent", "empty", "too-few-parts", "oversized", "non-numeric-exp", "bad-mac"],
    )
    def test_key_func_never_raises_on_hostile_input(self, headers: dict[str, str]) -> None:
        """G-8: slowapi re-raises whatever a key function throws.

        It escapes as a bodyless ``500 text/plain`` that 140.2's discriminator
        cannot classify and that feeds the breaker — turning a throttling
        concern into an outage signal.
        """
        key_func = _registered_limits(_L9_KEY_NAME)[0].key_func
        result = key_func(_FakeRequest("/api/optimize-weights", headers))
        assert isinstance(result, str) and result, "an empty key makes slowapi SKIP the limit"

    def test_key_func_never_raises_when_the_secret_is_unset(self, monkeypatch: Any) -> None:
        """An unset INTERNAL_API_TOKEN degrades to the ceiling, it does not 500."""
        monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
        key_func = _registered_limits(_L9_KEY_NAME)[0].key_func
        req = _FakeRequest(
            "/api/optimize-weights", {"X-Tenant-Claim": _mint_claim("tenant-alpha", _SECRET)}
        )
        assert key_func(req) == "platform:/api/optimize-weights"


# ---------------------------------------------------------------------------
# Gate 3 — class closure (the COUNT). Enumerate by BEHAVIOUR, state the count,
# and say how you searched, so a checker can reproduce it.
# ---------------------------------------------------------------------------


class TestClassClosure:
    """Nothing under ``routers/`` may key on the request address again.

    Counting gates, not spot checks: the standing programme lesson is that
    under-counts come from enumerating by the SYNTAX of a known instance rather
    than by BEHAVIOUR. A gate that only re-checked the nine known rows would
    have the same blind spot that missed L-9.
    """

    def test_the_enumerated_class_is_exactly_nine_routes(self) -> None:
        assert len(IP_KEYED_CLASS) == EXPECTED_CLASS_SIZE
        assert len({row[0] for row in IP_KEYED_CLASS}) == EXPECTED_CLASS_SIZE
        assert {row[0] for row in IP_KEYED_CLASS} == {f"L-{n}" for n in range(1, 10)}

    def test_no_router_source_references_get_remote_address_except_the_quarantine(self) -> None:
        """The behavioural gate, by source token.

        ``routers/simulator.py`` is the documented FINDING-10 quarantine — a
        route the plan's do-not-touch list calls "correctly user-keyed" while
        its key function returns ``simulator:ip:<address>``. It is reported, not
        folded in. If it is ever repaired, SHRINK this allow-list; the equality
        below is deliberate so a repair cannot leave a stale exemption behind.
        """
        offenders = {
            p.name
            for p in sorted(ROUTERS_DIR.glob("*.py"))
            if "get_remote_address" in _source_name_tokens(p)
        }
        assert offenders == IP_KEYED_QUARANTINE, (
            "routers/ get_remote_address references changed. Expected only the "
            f"FINDING-10 quarantine {sorted(IP_KEYED_QUARANTINE)}, found "
            f"{sorted(offenders)}."
        )

    def test_shared_limiter_module_no_longer_references_get_remote_address(self) -> None:
        """The singleton's default is where L-9 came from.

        Removing the symbol from ``services/rate_limit.py`` is what makes the
        omission un-makeable: a future undecorated route inherits
        ``default_platform_key``, not an IP.
        """
        module_path = ROUTERS_DIR.parent / "services" / "rate_limit.py"
        assert "get_remote_address" not in _source_name_tokens(module_path)

    def test_shared_limiter_default_key_is_not_ip_derived(self) -> None:
        from slowapi.util import get_remote_address

        assert rl.limiter._key_func is rl.default_platform_key
        assert rl.limiter._key_func is not get_remote_address

    def test_no_router_constructs_its_own_limiter(self) -> None:
        """Zero private ``Limiter()`` instances — by AST, not by grep.

        Each private instance also had its own isolated ``memory://`` storage
        (G-3), invisible to ``app.state.limiter``.
        """
        import ast

        constructions: list[str] = []
        for p in sorted(ROUTERS_DIR.glob("*.py")):
            for node in ast.walk(ast.parse(p.read_text(encoding="utf-8"))):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                name = (
                    func.id
                    if isinstance(func, ast.Name)
                    else func.attr if isinstance(func, ast.Attribute) else None
                )
                if name == "Limiter":
                    constructions.append(f"{p.name}:{node.lineno}")
        assert constructions == [], (
            f"private Limiter() construction(s) reintroduced: {constructions}"
        )

    def test_every_router_limiter_is_the_one_singleton(self) -> None:
        """Same Python object, not merely an equal one (API-5 invariant)."""
        for module in (routers.exchange, routers.csv, routers.portfolio,
                       routers.optimizer, routers.simulator):
            assert module.limiter is rl.limiter, f"{module.__name__} has a different Limiter"

    def test_rate_limited_route_set_is_a_literal(self) -> None:
        """A new rate-limited route cannot join the surface unnoticed.

        Registered STATIC limits only: ``/process-key`` uses slowapi's callable
        limit provider and therefore lives in ``_dynamic_route_limits``, which
        plan 140.1-06 owns and this file must not re-litigate.
        """
        expected = {row[2] for row in IP_KEYED_CLASS} | {
            # FINDING-10, quarantined: still IP-keyed, still not this plan's.
            "routers.simulator.portfolio_simulator",
        }
        registered = {
            name for name in rl.limiter._route_limits if name.startswith("routers.")
        }
        assert registered == expected, (
            "the set of statically rate-limited routes changed: "
            f"unexpected={sorted(registered - expected)}, "
            f"missing={sorted(expected - registered)}"
        )

    def test_every_registered_router_limit_is_shared_or_quarantined(self) -> None:
        """Behavioural sweep: no registered limit may key on the address.

        Independent of ``IP_KEYED_CLASS``, so it also covers a route someone
        adds without updating the table above.
        """
        from slowapi.util import get_remote_address

        for name, limits in rl.limiter._route_limits.items():
            if not name.startswith("routers."):
                continue
            for limit in limits:
                assert limit.key_func is not get_remote_address, f"{name} keys on the address"
                if name == "routers.simulator.portfolio_simulator":
                    continue  # FINDING-10 — reported, not fixed here
                assert isinstance(limit.key_func, functools.partial), name
                assert limit.key_func.func is rl.tenant_or_platform_key, name

    def test_match_routes_still_have_no_limiter(self) -> None:
        """RATE-03 / Phase 146's gap, recorded as an executable note.

        ``/api/match/recompute`` and ``/api/match/eval`` are seam-reachable
        (``analytics-client.ts:399,418``) and carry NO limiter at all. Adding one
        is out of scope here; this asserts the gap still has the shape Phase 146
        will be handed, and goes red the day someone closes it so the note gets
        deleted instead of rotting.
        """
        import routers.match  # noqa: F401

        assert not [n for n in rl.limiter._route_limits if n.startswith("routers.match.")]
        assert not [n for n in rl.limiter._dynamic_route_limits if n.startswith("routers.match.")]
