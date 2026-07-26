"""PYAPIFIX-05 survivors #8–#11 — the four claim-parser guards, first tests ever.

Phase 140.1.1 plan 07. `services/rate_limit.py`'s `verify_tenant_claim` carries
four single-line guards that decide which bucket throttles a request. The Phase
140.1 review mutated all four; **all four survived, because none of them had a
test at all** — not a weak test, no test:

===========  ===========================================  ==========================
Survivor     Guard                                        Mutation that survived
===========  ===========================================  ==========================
**#8**       `:274` `len(raw) > _CLAIM_MAX_CHARS`         drop the length bound
**#9**       `:285` `raw.rsplit(".", 2)`                  `rsplit` -> `split`
**#10**      `:286` `if not payload: return None`         drop the empty-payload guard
**#11**      `:333` `if payload == ANON_PAYLOAD`          `==` -> `startswith`
             **and its sibling at `:417`**
===========  ===========================================  ==========================

⚠️ **#11 is ONE survivor at TWO sites.** `:333` is in `tenant_rate_limit_key`,
which serves `/process-key` only. `:417` is the byte-identical line in
`tenant_or_platform_key`, the key function for the **nine** ex-IP-keyed routes
(PYAPI-03's whole class). The review named only `:333`. Testing one site closes
one of two, which is the instances-not-classes failure mode the repair programme
exists to shut, so every #11 assertion below is made through **both** functions.

⚠️ **#8's guard is at `:274`, not `:150`.** `:150` is the *constant declaration*
`_CLAIM_MAX_CHARS: Final[int] = 512`; a test written against that line asserts a
constant equals itself. The behaviour lives at `:274`, and the behaviour is
"refuse to do HMAC work on an oversized header" — so the oracle spies on the
HMAC, not on the number.

Oracle discipline (programme non-negotiable #3). **Nothing in this file is
imported from `services.rate_limit` except the three functions under test.**
Not `ANON_PAYLOAD`, not `_CLAIM_MAX_CHARS`, not `_NO_CREDENTIAL`, not
`credential_hash`. Every expected bucket string, every boundary number and the
claim-minting recipe itself are LITERALS or stdlib re-implementations written
into this file. A claim minted by calling the verifier's own helpers would prove
only that the module agrees with itself.
"""

from __future__ import annotations

import hashlib
import hmac as stdlib_hmac
from typing import Any

import pytest

from services import rate_limit as rl

# ---------------------------------------------------------------------------
# Fixture recipe, re-implemented from the wire format documented in
# `verify_tenant_claim`'s docstring:
#
#     <payload>.<exp>.<hex-hmac-sha256>   MAC over "<payload>.<exp>",
#                                          key = INTERNAL_API_TOKEN
#
# Same idiom as `tests/test_process_key.py:3065-3099`, which pins the identical
# recipe cross-language. Never call `verify_tenant_claim` (or anything it calls)
# to build its own input.
# ---------------------------------------------------------------------------

_SECRET = "claim-parser-oracle-secret"

#: A fixed 10-digit epoch in 2050. Fixed, not `now + ttl`, so the minted claim's
#: LENGTH is deterministic — #8's fixture is sized to the byte.
_EXP = 2524608300

#: The scope these tests bind the key functions to. Deliberately not any real
#: route's scope, so a bucket string here can never be confused with production.
_SCOPE = "claimtest"

#: The path the `tenant_or_platform_key` claimless arm falls to.
_PATH = "/api/optimize-weights"

#: sha256("unauthenticated").hexdigest()[:16], computed by hand with stdlib.
#: "unauthenticated" is the sentinel `_credential` substitutes when a caller
#: presents no Authorization and no X-Service-Key — written out here rather than
#: imported, so a silent change to that sentinel reddens instead of hiding.
_NO_CREDENTIAL_HASH = "b6545eef9260416b"

#: The bucket a rejected claim must land in on `tenant_rate_limit_key`.
_UNVERIFIED_BUCKET = f"claimtest:unverified:{_NO_CREDENTIAL_HASH}"

#: ...and on `tenant_or_platform_key`, whose claimless arm is the platform ceiling.
_PLATFORM_BUCKET = "platform:/api/optimize-weights"


def _mint(payload: str, secret: str = _SECRET) -> str:
    """A correctly-signed claim for `payload`. Pure stdlib, zero imports from
    the module under test."""
    mac = stdlib_hmac.new(
        secret.encode("utf-8"),
        f"{payload}.{_EXP}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload}.{_EXP}.{mac}"


class _FakeRequest:
    """Minimal Request stand-in: headers plus `url.path`.

    A slowapi key function receives only the Request and the body is still
    un-awaited when it runs (RESEARCH G-7), so this is the whole surface.
    """

    def __init__(self, headers: dict[str, str] | None = None, path: str = _PATH) -> None:
        self.headers = dict(headers or {})
        self.url = type("_U", (), {"path": path})()


def _req(claim: str | None) -> _FakeRequest:
    return _FakeRequest({"X-Tenant-Claim": claim} if claim is not None else {})


@pytest.fixture(autouse=True)
def _secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_TOKEN", _SECRET)


class _HmacSpy:
    """A stand-in for `services.rate_limit`'s `hmac` MODULE attribute.

    Substituting the module attribute rather than patching stdlib `hmac.new`
    globally (plan 06's `_FakeClock` idiom): the substitution is then complete —
    `rate_limit` uses exactly `hmac.new` and `hmac.compare_digest` and nothing
    else — and scoped to the one module, so this file's own minter is unaffected
    even if it ran under the patch.
    """

    def __init__(self) -> None:
        self.new_calls = 0

    def new(self, *args: Any, **kwargs: Any) -> Any:
        self.new_calls += 1
        return stdlib_hmac.new(*args, **kwargs)

    def compare_digest(self, a: Any, b: Any) -> bool:
        return stdlib_hmac.compare_digest(a, b)


# ---------------------------------------------------------------------------
# Sanity: the fixtures are the shape the tests below claim they are. Without
# this, an oversized fixture that quietly stopped being oversized (or a claim
# that stopped verifying) would make every assertion below vacuously true.
# ---------------------------------------------------------------------------


def test_the_fixtures_are_the_shape_these_tests_assume() -> None:
    """A well-formed claim of EXACTLY 513 chars, and a verifying control."""
    assert len(_mint("a" * 437)) == 513, (
        "the #8 fixture must be exactly 513 chars — one past the documented "
        "512-char bound — so it tests the boundary and not merely 'something big'"
    )
    # The control: a claim of ordinary size verifies. If this ever fails, every
    # 'rejected' assertion below is meaningless because nothing verifies at all.
    assert rl.verify_tenant_claim(_req(_mint("tenant-alpha"))) == "tenant-alpha"


# ---------------------------------------------------------------------------
# Survivor #8 — the 512-char bound (guard at rate_limit.py:274)
# ---------------------------------------------------------------------------


class TestOversizedClaimIsRefusedBeforeAnyHmacWork:
    """The guard's PURPOSE is to refuse HMAC work, so that is the oracle.

    ⚠️ Asserting only `verify_tenant_claim(...) is None` would NOT catch the
    mutation. Drop the bound and a 513-char string of junk still returns None —
    `rsplit(".", 2)` raises ValueError on an unparseable header and the
    never-raise `except` swallows it. The fixture is therefore a **correctly
    minted, fully valid, merely oversized** claim: with the guard it is refused
    without touching the MAC; without the guard it verifies and is ACCEPTED.
    Both assertions below then redden, for two independent reasons.
    """

    #: 437 payload chars + "." + 10 exp chars + "." + 64 mac chars = 513.
    #: One past the documented 512-char bound, which is written here as a
    #: literal and never imported.
    OVERSIZED_PAYLOAD = "a" * 437

    def test_a_513_char_claim_is_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        spy = _HmacSpy()
        monkeypatch.setattr(rl, "hmac", spy)

        claim = _mint(self.OVERSIZED_PAYLOAD)
        assert len(claim) == 513

        assert rl.verify_tenant_claim(_req(claim)) is None, (
            "a 513-char claim was ACCEPTED. The length bound at rate_limit.py:274 "
            "is the only thing standing between an attacker and unbounded "
            "server-side HMAC work per request."
        )

    def test_no_hmac_work_happens_on_an_oversized_claim(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The guard is a refusal to COMPUTE, not merely a refusal to trust."""
        claim = _mint(self.OVERSIZED_PAYLOAD)  # minted BEFORE the spy is installed

        spy = _HmacSpy()
        monkeypatch.setattr(rl, "hmac", spy)
        rl.verify_tenant_claim(_req(claim))

        assert spy.new_calls == 0, (
            f"verify_tenant_claim ran hmac.new {spy.new_calls} time(s) on a "
            "513-char header. The bound exists so an oversized header costs a "
            "length check, not a SHA-256 over the whole thing."
        )

    def test_a_normal_length_claim_still_reaches_the_hmac(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The negative control, INSIDE the class.

        Without it, a 'fix' that refused every claim — or a spy that never
        counted — would satisfy both assertions above. This is the row that
        proves the zero above is a decision rather than an accident.
        """
        claim = _mint("tenant-alpha")

        spy = _HmacSpy()
        monkeypatch.setattr(rl, "hmac", spy)
        assert rl.verify_tenant_claim(_req(claim)) == "tenant-alpha"

        assert spy.new_calls == 1, (
            f"an ordinary claim must be MAC-checked exactly once, got "
            f"{spy.new_calls}"
        )


# ---------------------------------------------------------------------------
# Survivor #9 — rsplit, not split (rate_limit.py:285)
# ---------------------------------------------------------------------------


class TestDottedPayloadParsesFromTheRIGHT:
    """`rsplit(".", 2)` is the only parse that stays unambiguous when a payload
    contains a dot — the module's own comment says so, and nothing enforced it.

    A tenant id is a uuid today, so no CURRENT caller trips this. That is
    exactly why it survived, and exactly why it matters: the day any minter
    starts putting an email, a hostname or a namespaced id in the payload,
    `split` silently drops every dotted tenant into the shared `:unverified:`
    bucket — one bucket for all of them — and nothing anywhere goes red.
    """

    DOTTED_PAYLOAD = "a.b.c"

    def test_a_dotted_payload_reaches_its_own_tenant_bucket(self) -> None:
        assert (
            rl.tenant_rate_limit_key(_req(_mint(self.DOTTED_PAYLOAD)), scope=_SCOPE)
            == "claimtest:t:a.b.c"
        )

    def test_a_dotted_payload_verifies_to_itself_whole(self) -> None:
        """Below the bucket: the parse must return the payload UNTRUNCATED.

        A left-split returns `"a"`, which is a DIFFERENT tenant — so this is
        not a formatting nicety, it is one tenant's traffic counted against
        another's quota.
        """
        assert rl.verify_tenant_claim(_req(_mint(self.DOTTED_PAYLOAD))) == "a.b.c"

    def test_a_dotted_payload_reaches_its_tenant_bucket_on_the_nine_route_key(
        self,
    ) -> None:
        """Same claim, the other key function — `tenant_or_platform_key` calls
        the same verifier, so the parse defect reaches all nine routes too."""
        assert (
            rl.tenant_or_platform_key(_req(_mint(self.DOTTED_PAYLOAD)), scope=_SCOPE)
            == "claimtest:t:a.b.c"
        )


# ---------------------------------------------------------------------------
# Survivor #10 — the empty-payload guard (rate_limit.py:286)
# ---------------------------------------------------------------------------


class TestEmptyPayloadNeverReachesATenantBucket:
    """A claim with a VALID MAC over an EMPTY payload.

    This is the one an attacker can actually mint the moment any minter is
    driven by user-controlled input that can be empty. Drop the guard and
    `verify_tenant_claim` returns `""`, which is not None, so
    `tenant_rate_limit_key` takes the tenant arm and hands back the bucket
    `"claimtest:t:"` — a real, shared, tenant-shaped bucket belonging to no
    tenant, that every empty-payload caller collides in.
    """

    def test_an_empty_payload_falls_to_the_unverified_bucket(self) -> None:
        bucket = rl.tenant_rate_limit_key(_req(_mint("")), scope=_SCOPE)
        assert bucket == _UNVERIFIED_BUCKET
        assert bucket != "claimtest:t:", (
            "an empty payload was admitted to a TENANT bucket. The guard at "
            "rate_limit.py:286 is what keeps a valid-MAC-empty-payload claim "
            "out of the tenant namespace."
        )

    def test_an_empty_payload_falls_to_the_platform_ceiling_on_the_nine_route_key(
        self,
    ) -> None:
        bucket = rl.tenant_or_platform_key(_req(_mint("")), scope=_SCOPE)
        assert bucket == _PLATFORM_BUCKET
        assert bucket != "claimtest:t:"

    def test_an_empty_payload_does_not_verify(self) -> None:
        """The guard's own return value, pinned directly — the MAC is genuinely
        valid here, so `None` can only come from the emptiness check."""
        assert rl.verify_tenant_claim(_req(_mint(""))) is None


# ---------------------------------------------------------------------------
# Survivor #11 — `==` ANON, not `startswith` — AT BOTH SITES
# (rate_limit.py:333 in tenant_rate_limit_key, :417 in tenant_or_platform_key)
# ---------------------------------------------------------------------------


class TestPublicPrefixedPayloadIsNotAnonymous:
    """`payload == "public"` must stay an EQUALITY at both key functions.

    Under `startswith`, every tenant whose id begins with "public" — a
    `public-...` namespace, a `publications` team, a uuid that happens to start
    that way — is silently merged into the ONE anonymous bucket the public
    teaser shares with every unauthenticated visitor on the internet. That is a
    cross-tenant denial of service: the teaser's traffic exhausts a paying
    tenant's quota, and the tenant's own identity is what put them there.

    ⚠️ Asserted through **both** functions. `:333` serves `/process-key`;
    `:417` is the byte-identical line in `tenant_or_platform_key`, the key
    function for the nine ex-IP-keyed routes. The review named only `:333`.
    """

    PREFIXED_PAYLOAD = "public-enemy"
    ANON_PAYLOAD_LITERAL = "public"

    def test_a_public_prefixed_payload_keeps_its_own_bucket_on_process_key(
        self,
    ) -> None:
        """Site 1 of 2 — `tenant_rate_limit_key` (rate_limit.py:333)."""
        bucket = rl.tenant_rate_limit_key(
            _req(_mint(self.PREFIXED_PAYLOAD)), scope=_SCOPE
        )
        assert bucket == "claimtest:t:public-enemy", (
            f"got {bucket!r}. A prefix match on the anonymous payload merges "
            "every 'public*' tenant into the shared teaser bucket."
        )
        assert bucket != "claimtest:anon"

    def test_a_public_prefixed_payload_keeps_its_own_bucket_on_the_nine_routes(
        self,
    ) -> None:
        """Site 2 of 2 — `tenant_or_platform_key` (rate_limit.py:417).

        This is the site the review did not name, and the one nine routes key
        on. Closing only site 1 would be 1 of 2.
        """
        bucket = rl.tenant_or_platform_key(
            _req(_mint(self.PREFIXED_PAYLOAD)), scope=_SCOPE
        )
        assert bucket == "claimtest:t:public-enemy", (
            f"got {bucket!r} from tenant_or_platform_key — the key function for "
            "all nine PYAPI-03 routes."
        )
        assert bucket != "claimtest:anon"

    def test_the_exact_anon_payload_still_buckets_to_anon_on_process_key(self) -> None:
        """The positive control, INSIDE the class.

        Without it, deleting the anonymous arm entirely would satisfy both
        assertions above — a 'fix' that gave every teaser visitor a private
        bucket, i.e. no anonymous ceiling at all.
        """
        assert (
            rl.tenant_rate_limit_key(
                _req(_mint(self.ANON_PAYLOAD_LITERAL)), scope=_SCOPE
            )
            == "claimtest:anon"
        )

    def test_the_exact_anon_payload_still_buckets_to_anon_on_the_nine_routes(
        self,
    ) -> None:
        assert (
            rl.tenant_or_platform_key(
                _req(_mint(self.ANON_PAYLOAD_LITERAL)), scope=_SCOPE
            )
            == "claimtest:anon"
        )
