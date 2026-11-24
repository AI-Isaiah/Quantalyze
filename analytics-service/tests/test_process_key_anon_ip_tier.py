"""Phase 240 plan 02 / RLIM-01 (Python half) -- the per-IP anonymous tier on /process-key.

Before this phase every anonymous visitor of the public teaser shared ONE 30/hour
bucket (``process_key:anon``), so a single IP drained the window for everybody.
The TS teaser route now mints ``public:<32 hex>`` -- a keyed pseudonym of the client
IP -- and Python buckets each pseudonym on its own, with an aggregate anonymous
ceiling on top and the platform ceiling last.

What lives here, all over the REAL limiter stack on the REAL route:

* per-IP isolation: pseudonym A exhausting its window leaves pseudonym B admitted;
* the aggregate: anonymous traffic as a whole is capped, across pseudonyms;
* the stack order: a refused anonymous request spends no aggregate and no
  ceiling token (the hammer test; under the pre-240 order the tenant is refused);
* the exemption: tenant traffic never consumes an aggregate slot;
* the fault default of the exemption predicate (a fault refuses, never skips);
* 429 hygiene: no IP, pseudonym, claim or bucket key in a refusal.

Oracle discipline (programme non-negotiable #3): every expected status, count and
bucket string is a LITERAL typed here. Pseudonyms are computed from the stdlib,
never pasted from a captured value and never from the module under test.

The router module comes FROM ``tests.test_process_key``, never from a direct
import: that module pops ``routers.process_key`` from ``sys.modules`` and
re-imports it, so a direct import would be a second module object whose
decorators register a second set of limits on the shared limiter.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any

import pytest

from tests.test_process_key import (  # noqa: F401  (throttled_client is a fixture)
    _CLAIM_SECRET,
    _mint_claim,
    _post,
    process_key_router,
    throttled_client,
)

# Documentation-range addresses (RFC 5737 / RFC 3849): never a real client.
_IP_A = "192.0.2.10"
_IP_B = "192.0.2.20"
_IP_C = "198.51.100.30"
_IP_V6 = "2001:db8::1"


def _pseudonym(ip: str) -> str:
    """First 32 hex chars of HMAC-SHA256(secret, ``anon-ip:<ip>``): the TS construction."""
    return hmac.new(
        _CLAIM_SECRET.encode("utf-8"),
        f"anon-ip:{ip}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:32]


def _anon_claim(ip: str) -> str:
    return _mint_claim(f"public:{_pseudonym(ip)}")


def _admitted(resp: Any) -> bool:
    # raise_server_exceptions=False: an admitted request runs the real handler and
    # fails downstream (no DB in unit tests). Any non-429 means the limiter admitted.
    return bool(resp.status_code != 429)


# ---------------------------------------------------------------------------
# Task 1: per-IP isolation and the provider sizing
# ---------------------------------------------------------------------------


def test_the_pseudonym_fixtures_are_what_the_tests_assume() -> None:
    """Three distinct 32-lowercase-hex pseudonyms: a degenerate fixture would make
    every isolation assertion below vacuously true."""
    pseudonyms = {_pseudonym(ip) for ip in (_IP_A, _IP_B, _IP_C, _IP_V6)}
    assert len(pseudonyms) == 4
    for p in pseudonyms:
        assert len(p) == 32
        assert p == p.lower()
        int(p, 16)


def test_two_anonymous_visitors_from_different_ips_do_not_share_a_bucket(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """RLIM-01 tracer. Visitor A exhausts its window; visitor B (another IP) is admitted.

    Under the pre-240 grammar every anonymous claim shared ``process_key:anon``,
    so visitor B would be refused here by A's traffic. The tenant at the end
    proves the per-IP refusal also left paying traffic alone.
    """
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "3/hour")
    a = _anon_claim(_IP_A)
    b = _anon_claim(_IP_B)

    for i in range(3):
        assert _admitted(_post(throttled_client, a)), f"A's call {i + 1} of 3"
    assert _post(throttled_client, a).status_code == 429, (
        "A's 4th call must be refused: the per-IP window is shrunk to 3/hour"
    )

    assert _admitted(_post(throttled_client, b)), (
        "RLIM-01: visitor B has an untouched per-IP window and must be admitted "
        "while visitor A is refused. A shared anonymous bucket refuses both."
    )
    assert _admitted(_post(throttled_client, _mint_claim("tenant-a")))


def test_per_ip_boundary_nth_admitted_and_n_plus_one_refused(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Edge (boundary): with the limit at N=2, call 2 is admitted and call 3 refused."""
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "2/hour")
    a = _anon_claim(_IP_A)

    assert [_admitted(_post(throttled_client, a)) for _ in range(3)] == [True, True, False]


def test_ipv6_pseudonym_is_one_more_distinct_visitor(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An IPv6 client is hashed as given by the TS side; to Python it is one more
    32-hex pseudonym with its own window."""
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "1/hour")
    assert _admitted(_post(throttled_client, _anon_claim(_IP_A)))
    assert _post(throttled_client, _anon_claim(_IP_A)).status_code == 429
    assert _admitted(_post(throttled_client, _anon_claim(_IP_V6)))


def test_a_bare_public_claim_still_shares_the_one_legacy_bucket(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The legacy fallback (unknown client IP, claims minted before the TS change):
    every bare ``public`` visitor shares ONE bucket, exactly as at HEAD."""
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "2/hour")
    bare = _mint_claim("public")

    assert _admitted(_post(throttled_client, bare))
    assert _admitted(_post(throttled_client, bare))
    assert _post(throttled_client, bare).status_code == 429
    # ...and the shared legacy bucket does not swallow a per-IP pseudonym.
    assert _admitted(_post(throttled_client, _anon_claim(_IP_A)))


@pytest.mark.parametrize(
    "bad_suffix",
    [
        "a" * 31,
        "a" * 33,
        "A" * 32,
        "g" * 32,
        "",
    ],
    ids=["31-hex", "33-hex", "uppercase", "non-hex", "empty"],
)
def test_a_malformed_per_ip_suffix_shares_the_legacy_bucket_never_a_tenant_bucket(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch, bad_suffix: str
) -> None:
    """Edge (precision): a malformed ``public:`` suffix falls to the SHARED anon
    bucket. Two different malformed claims therefore exhaust ONE window, and the
    legacy bare claim shares it. Had either landed in a ``:t:`` tenant bucket it
    would have had the 100/hour tenant tier and this refusal would never fire."""
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "2/hour")
    malformed = _mint_claim(f"public:{bad_suffix}")

    assert _admitted(_post(throttled_client, malformed))
    assert _admitted(_post(throttled_client, _mint_claim("public")))
    assert _post(throttled_client, malformed).status_code == 429, (
        "a malformed per-IP suffix must share the legacy anonymous bucket with "
        "the bare claim, at the 30/hour (here 2/hour) anonymous tier"
    )


def test_limit_provider_sizes_every_anonymous_spelling_at_the_anon_tier() -> None:
    limit_for = process_key_router._process_key_limit_for
    anon = process_key_router._PROCESS_KEY_ANON_LIMIT

    assert limit_for("process_key:anon:" + "0123456789abcdef" * 2) == anon
    assert limit_for("process_key:anon") == anon
    assert limit_for("process_key:t:x") == process_key_router._PROCESS_KEY_TENANT_LIMIT
    # A tenant whose id merely starts with "anon" is a TENANT key, not an anon one.
    assert (
        limit_for("process_key:t:anon:x")
        == process_key_router._PROCESS_KEY_TENANT_LIMIT
    )


# ---------------------------------------------------------------------------
# Task 2: the stack order and the anonymous aggregate
# ---------------------------------------------------------------------------


def test_the_stack_evaluates_identity_then_aggregate_then_ceiling() -> None:
    """The evaluation order, as a LITERAL list read off the live limiter.

    slowapi evaluates the BOTTOM decorator first and stops at the first refusal,
    so the registered order is the evaluation order. Static string limits always
    run before callable ones, so a limit passed as a plain string would jump the
    queue and re-create the burn the hammer test below catches.
    """
    groups = process_key_router.limiter._dynamic_route_limits[
        "routers.process_key.process_key"
    ]
    assert [g.key_function.__name__ for g in groups] == [
        "_process_key_rate_limit_key",
        "_process_key_anon_aggregate_key",
        "_process_key_ceiling_key",
    ]


def test_the_aggregate_refuses_past_its_size_across_pseudonyms(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Edge (boundary): per-IP 3/hour, aggregate 4/hour. A x3 and B x1 are admitted
    (4 anonymous calls), pseudonym C, with a virgin per-IP window, is refused by the
    aggregate alone, and a tenant is untouched."""
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "3/hour")
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_AGGREGATE_LIMIT", "4/hour")
    a, b, c = _anon_claim(_IP_A), _anon_claim(_IP_B), _anon_claim(_IP_C)

    for i in range(3):
        assert _admitted(_post(throttled_client, a)), f"A call {i + 1}"
    assert _admitted(_post(throttled_client, b)), "B call 1: aggregate at 4 of 4"
    assert _post(throttled_client, c).status_code == 429, (
        "the 5th anonymous call, from a pseudonym with an untouched per-IP window, "
        "can only be refused by the anonymous aggregate"
    )
    assert _admitted(_post(throttled_client, _mint_claim("tenant-a")))


def test_a_hammering_pseudonym_burns_no_aggregate_and_no_ceiling_token(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """RLIM-01 fairness. Per-IP 2/hour, aggregate 4/hour, ceiling 6/hour.

    Pseudonym A sends 10: two admitted, eight refused. If the refused eight spent
    an aggregate token, B's two calls below would hit the aggregate (2 + 8 > 4); if
    they spent a ceiling token the tenant's two would hit the ceiling. Admitted
    calls total 2 (A) + 2 (B) + 2 (tenant) = 6 = the ceiling, so any burn by a
    refused call shows up as a refusal here. Under the pre-240 order (ceiling
    evaluated first) the tenant is refused.
    """
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "2/hour")
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_AGGREGATE_LIMIT", "4/hour")
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_CEILING_LIMIT", "6/hour")

    a = _anon_claim(_IP_A)
    assert [_post(throttled_client, a).status_code == 429 for _ in range(10)] == (
        [False, False] + [True] * 8
    )

    b = _anon_claim(_IP_B)
    assert _admitted(_post(throttled_client, b)), "B 1: aggregate would be full if A burned it"
    assert _admitted(_post(throttled_client, b)), "B 2"

    tenant = _mint_claim("tenant-a")
    assert _admitted(_post(throttled_client, tenant)), (
        "tenant 1: refused means A's refused calls spent ceiling tokens"
    )
    assert _admitted(_post(throttled_client, tenant)), "tenant 2"


def test_tenant_calls_never_consume_an_aggregate_slot(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Tenant and unverified traffic is exempt from the aggregate: with it shrunk to
    1/hour, five tenant calls are all admitted and the one anonymous call after them
    still is, because no tenant call spent the slot."""
    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_AGGREGATE_LIMIT", "1/hour")

    tenant = _mint_claim("tenant-a")
    for i in range(5):
        assert _admitted(_post(throttled_client, tenant)), f"tenant call {i + 1}"
    assert _admitted(_post(throttled_client, _anon_claim(_IP_A))), (
        "a tenant call spent the one aggregate slot"
    )
    assert _post(throttled_client, _anon_claim(_IP_B)).status_code == 429


def test_the_exemption_predicate_refuses_rather_than_skips_on_a_fault(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """G-8 / T-240-07: an exempt_when that raises becomes a bodyless 500, and one
    that defaults to exempt would silently skip a limit on a fault. On a fault the
    predicate answers 'not exempt' (False), and raises nothing."""

    def _boom(request: Any) -> Any:
        raise RuntimeError("classifier fault")

    monkeypatch.setattr(process_key_router, "classify_tenant_claim", _boom)
    assert process_key_router._process_key_not_anonymous(object()) is False


def test_the_exemption_predicate_is_true_only_for_non_anonymous_claims(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import MagicMock

    monkeypatch.setenv("INTERNAL_API_TOKEN", _CLAIM_SECRET)

    def _request(claim: str | None) -> Any:
        r = MagicMock()
        r.headers = {"X-Tenant-Claim": claim} if claim is not None else {}
        return r

    exempt = process_key_router._process_key_not_anonymous
    assert exempt(_request(_mint_claim("tenant-a"))) is True
    assert exempt(_request(None)) is True  # unverified: not anonymous
    assert exempt(_request(_mint_claim("public"))) is False
    assert exempt(_request(_anon_claim(_IP_A))) is False
    assert exempt(_request(_mint_claim("public:" + "Z" * 32))) is False


def test_the_aggregate_provider_declares_no_key_parameter() -> None:
    """A provider that declares ``key`` makes slowapi run the key function for every
    request, exempt or not (RESEARCH Pattern 2 item 6)."""
    import inspect

    assert not inspect.signature(
        process_key_router._process_key_anon_aggregate_limit
    ).parameters


def test_the_aggregate_key_is_the_distinct_never_empty_spelling() -> None:
    key = process_key_router._process_key_anon_aggregate_key(object())
    assert key == "process_key:anon-all"


# ---------------------------------------------------------------------------
# Task 3: 429 hygiene
# ---------------------------------------------------------------------------


def test_a_per_ip_refusal_leaks_no_identity_in_body_headers_or_the_handler_log(
    throttled_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """T-240-08: no IP, pseudonym, claim or bucket key in a 429's body or headers, nor
    in the app handler's ``request.rate_limited`` log line.

    CONTEXT narrowed UI-SPEC section 3's "or log line" to response bodies and ruled
    "No logging filter": slowapi's own ``ratelimit ... exceeded`` library warning
    prints the bucket key and may carry the keyed pseudonym. That line is
    stdlib-logged by the library, is not under test here, and is recorded, not
    filtered. What this test pins is everything THIS service writes or sends.
    """
    from structlog.testing import capture_logs

    monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "1/hour")
    claim = _anon_claim(_IP_A)
    pseudonym = _pseudonym(_IP_A)
    assert _admitted(_post(throttled_client, claim))

    with capture_logs() as logs:
        refused = _post(throttled_client, claim)

    assert refused.status_code == 429
    assert any(e["event"] == "request.rate_limited" for e in logs), logs
    forbidden = (pseudonym, "process_key:anon", claim, _IP_A)
    surfaces = {
        "body": refused.text,
        "headers": " ".join(f"{k}: {v}" for k, v in refused.headers.items()),
        "handler log": repr(logs),
    }
    for where, text in surfaces.items():
        for needle in forbidden:
            assert needle not in text, f"{needle!r} leaked into the 429 {where}"
