"""Shared slowapi Limiter for analytics-service.

Phase 19 / API-5 fix — there used to be two Limiter() instances in the
process: one in `main.py` (registered as ``app.state.limiter`` and the
target of slowapi's ``RateLimitExceeded`` handler) and another in
``routers/process_key.py`` (the one the ``@limiter.limit(...)`` decorator
on ``process_key()`` referenced). slowapi resolves rate-limit storage via
the *decorator's* Limiter instance — so the metrics, in-memory counts
and (eventually) Redis-backed storage on ``app.state.limiter`` were
never shared with the route's actual limit. This module owns the single
canonical Limiter so any router that needs rate-limiting imports from
here and ``main.py`` registers the same instance on ``app.state``.

Per-route limiters MAY override the key function (e.g. process_key
keys on the bearer token + user_id rather than remote IP) by calling
``Limiter.limit(..., key_func=...)`` at decoration time without losing
the shared storage.

Phase 140.1 / PYAPI-02 — the shared KEY FUNCTIONS
-------------------------------------------------
This module now also owns the two key functions the platform buckets on.
They are ``scope``-parameterised on purpose: PYAPI-03 has to re-key nine
IP-keyed routes (``exchange.py``, ``csv.py``, ``portfolio.py``,
``optimizer.py``) onto the same mechanism, and a per-router copy of this
logic is the instances-vs-classes failure mode the programme exists to
close. A router adopts them as::

    from functools import partial
    from services.rate_limit import limiter, tenant_rate_limit_key

    @limiter.limit("20/minute",
                   key_func=partial(tenant_rate_limit_key, scope="optimize_weights"))

``functools.partial`` is safe here: slowapi decides whether to pass the
request by checking for a parameter literally named ``request`` on the key
function (``slowapi/extension.py`` ``__evaluate_limits``), and ``partial``
preserves it.

⚠️ Routes with NO tenant claim on the wire land, correctly, in the
``<scope>:unverified:<credential-hash>`` arm. For a route authenticated by the
single shared ``X-Service-Key`` that is ONE platform-wide bucket — which is what
those nine routes effectively have today anyway (RESEARCH G-10/G-11: behind
Railway's edge ``get_remote_address`` collapses to the proxy IP), except it is
now honestly named instead of wearing a per-client disguise.

**Never introduce a new IP-derived key.** That is the defect, not the fix.

Phase 140.1 / PYAPI-03 — the IP-keyed class, CLOSED
---------------------------------------------------
Nine decorated routes keyed on ``get_remote_address``. Behind Railway's edge
proxy that is the EDGE IP, so every one of them was a PLATFORM-WIDE bucket
wearing a per-client disguise (G-10/G-11). Three routers also declared their own
``Limiter()`` — each with its own isolated ``memory://`` storage (G-3), so they
did not even share counters with ``app.state.limiter``.

⚠️ **The class is IP KEYING (behaviour), not "private ``Limiter()``" (syntax).**
Enumerating by the syntax finds 3 modules / 8 routes and MISSES
``routers/optimizer.py``, which imports THIS singleton and silently inherits its
default ``key_func``. That under-count is the instance-vs-class failure mode the
repair programme exists to close (RESEARCH X-4 / TRAP-5) — it was latent inside
the finding that documents TRAP-5.

The structural fix for the silent-inheritance half is that this module's
singleton no longer defaults to an IP key at all: see
:func:`default_platform_key`. A future undecorated route can no longer acquire
L-9's defect by omission.

Token cost per user-visible flow (RESEARCH Q1.4)
------------------------------------------------
Buckets are keyed on (key, **endpoint**) — G-2 — so two routes never share a
counter even when their keys are byte-identical. "Bucket" below is the key
string this module returns; the endpoint half is slowapi's.

==========================  ==========================================  ===============  ================================================
Flow                        TS entry                                    Routes spent     Cost
==========================  ==========================================  ===============  ================================================
Key connect (wizard)        ``keys/validate-and-encrypt/route.ts``       L-1 **and** L-2  **2 tokens from two SEPARATE 100/hour buckets**
                            ``:243,256``                                                 — not one shared pool (RESEARCH X-5)
Scenario optimize           ``analytics-client.ts:280``                  L-9              1 of **20/minute** — the tightest ceiling on
                                                                                         the seam, and the worst number on this table
Bridge                      ``analytics-client.ts:338``                  L-7              1 of 10/hour
Portfolio optimizer         ``analytics-client.ts:320``                  L-6              1 of 10/hour
Portfolio analytics         *(zero callers — ``resilient-fetch.ts:203``  L-5              1 of 10/hour
                            has the budget row, nothing calls it)*
Fetch trades                *(no TS caller)*                             L-3              1 of 10/hour
CSV validate (Python)       *(no TS caller — ``csv-validate/route.ts``   L-4              1 of 30/hour
                            ``:206`` goes via ``/process-key``)*
Verify strategy (Python)    *(no TS caller — the teaser goes via         L-8              1 of 5/hour
                            ``/process-key``)*
Simulator                   ``analytics-client.ts:363``                  —                1 of 20/hour, scope ``simulator``, keyed by
                                                                                         ``tenant_or_platform_key`` (Phase 163 SEC-05)
``/process-key``            ``process-key-client.ts:151``                —                1 per-identity token, plus 1 anonymous-aggregate
                                                                                         token when anonymous, plus 1 platform-ceiling
                                                                                         token; a refused call spends none of the later ones
CSV validate via            ``csv-validate/route.ts`` through            —                1 token of the per-user **60/minute** csv tier
``/process-key``            ``postProcessKey``, signed ``csv:<uuid>``                     (``process_key:csv:<uuid>``), **no** ceiling token
Key-permission badge        ``keys/[id]/permissions/route.ts:131``       —                1 of ``internal.py``'s hand-rolled
                                                                                         per-``key_id`` 10/min bucket
==========================  ==========================================  ===============  ================================================

**Limit VALUES above are unchanged by PYAPI-03** — it changes bucket IDENTITY
only. The value audit is RATE-04 / Phase 146.

⚠️ **FINDING-10, CLOSED (measured at Phase 240).** ``routers/simulator.py`` was a
tenth IP-keyed route: its key function returned the proxy-visible request address.
Phase 163 SEC-05 re-keyed it: the simulator route is now decorated with
``partial(tenant_or_platform_key, scope="simulator")``, the old
``_simulator_rate_limit_key`` is deleted, and ``tests/test_limiter_identity.py``
pins the quarantine EMPTY, for ``routers/`` and, since Phase 240 (RLIM-01), for
every non-test module in ``analytics-service``. Its per-tenant quota still lives
in-handler (``_check_simulator_user_rate``); the decorator limit is the ceiling.

Phase 146-02 / RATE-03 — the match gap, CLOSED: ``routers/match.py``
``POST /api/match/recompute`` and ``GET /api/match/eval`` now carry
``30/minute`` limits keyed by ``partial(tenant_or_platform_key, scope=...)``
(scopes ``match_recompute`` / ``match_eval``). ``POST /api/match/cron-recompute``
deliberately stays unlimited: cron surface, service-key gated (requirements
decision #7 analogy; A2 recorded OUT of scope).

⚠️ **Storage is ``memory://`` and therefore per-replica** (ASSUMPTION-3). With N
Railway replicas every number above is N× looser and buckets reset unevenly on
rolling deploys.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import time
from typing import Any, Final, Literal, NamedTuple

import structlog
from fastapi import Request
from slowapi import Limiter

# ⚠️ PYAPI-03: ``slowapi.util.get_remote_address`` is deliberately NOT imported
# here any more. It was this module's singleton default, and
# ``routers/optimizer.py`` inherited it by omission — the L-9 defect. Nothing in
# ``analytics-service`` may key on it (behind Railway's edge it is the proxy's IP,
# one platform-wide bucket wearing a per-client disguise). Re-adding the import is
# how the class re-opens; ``tests/test_limiter_identity.py`` scans every non-test
# module for the name and pins the quarantine empty.

log = structlog.get_logger("quantalyze.analytics.rate_limit")

#: The forgery-resistant tenant identity. It MUST be a header: a slowapi
#: key function receives only the ``Request`` and the body is still un-awaited
#: at that point (RESEARCH G-7), so a body field is not readable. It must NOT
#: be ``X-User-Id``, which is unsigned client-controlled input (the PR#241
#: lesson: a caller could mint a fresh bucket per request, or drain a victim's).
TENANT_CLAIM_HEADER: Final[str] = "X-Tenant-Claim"

#: The bare anonymous payload. Since Phase 240 (RLIM-01) this is the LEGACY
#: FALLBACK: the teaser mints it only when the client IP is unknown, and claims
#: minted before the per-IP change still carry it. Everything that presents it
#: shares ONE bucket. A known client IP is a per-IP pseudonym instead, minted as
#: ``ANON_IP_PAYLOAD_PREFIX`` + 32 lowercase hex.
ANON_PAYLOAD: Final[str] = "public"

#: Prefix of the per-IP anonymous payload: ``public:<32 lowercase hex>``, where the
#: hex is a keyed HMAC of the client IP computed at Vercel. The prefix is RESERVED:
#: a payload that starts with it is always anonymous, and a malformed one falls to
#: the shared anonymous bucket, never to a tenant bucket.
ANON_IP_PAYLOAD_PREFIX: Final[str] = "public:"

#: Exactly 32 lowercase hex characters after the prefix, matched as a whole
#: (``fullmatch`` only) and ASCII-only so Unicode digits are not hex.
_ANON_IP_PAYLOAD_RE: Final[re.Pattern[str]] = re.compile(
    r"public:([0-9a-f]{32})", re.ASCII
)


#: Prefix of the CSV-scoped payload: ``csv:<canonical lowercase uuid>``. The TS
#: ``postProcessKey`` signs it into the claim when ``flow_type`` is
#: ``"csv"`` (Phase 240 RLIM-02), so the scope is covered by the HMAC and is
#: never read from an unsigned header or the request body.
CSV_PAYLOAD_PREFIX: Final[str] = "csv:"

#: ``csv:`` plus a canonical lowercase uuid (8-4-4-4-12 hex groups joined by
#: hyphens), matched as a whole (``fullmatch`` only) and ASCII-only so Unicode
#: digits are not hex. Anything else that starts with the prefix is a plain tenant
#: payload: it gets the tenant tier and NO platform-ceiling exemption.
_CSV_PAYLOAD_RE: Final[re.Pattern[str]] = re.compile(
    r"csv:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", re.ASCII
)


def anon_bucket_key(scope: str) -> str:
    """The ONE spelling of the shared anonymous bucket's limiter key.

    Used by both key functions below, by ``/process-key``'s limit provider and by
    the saturation alert in ``services/app_error_handlers.py``, so the bucket and
    everything that reasons about it cannot drift apart.
    """
    return f"{scope}:anon"


def anon_ip_bucket_key(scope: str, digest: str) -> str:
    """The ONE spelling of a per-IP anonymous bucket: the shared key plus the digest.

    ``digest`` is the 32 lowercase hex characters the classifier extracted. It is
    built on :func:`anon_bucket_key` so the provider's prefix test and the alert's
    key comparison cannot drift from it.
    """
    return f"{anon_bucket_key(scope)}:{digest}"


def csv_bucket_key(scope: str, user_id: str) -> str:
    """The ONE spelling of a CSV-scoped per-user bucket: ``<scope>:csv:<user_id>``.

    ``user_id`` is the canonical lowercase uuid the classifier extracted. The prefix
    is disjoint from every other arm (``:t:``, ``:anon``, ``:unverified:``), so a
    tenant id can never land here and ``/process-key``'s limit provider can size it
    by prefix alone. Called with an empty ``user_id`` it yields the prefix itself.
    """
    return f"{scope}:csv:{user_id}"


def anon_aggregate_key(scope: str) -> str:
    """The ONE spelling of the anonymous AGGREGATE bucket's limiter key.

    ``<scope>:anon-all``, a distinct spelling on purpose: ``limits`` storage keys
    include the amount, so reusing the shared anonymous key for a second limit
    would be a second counter under a confusing name (RESEARCH Pattern 2 item 8).
    Used by ``/process-key``'s aggregate limit and by the saturation alert.
    """
    return f"{scope}:anon-all"


class ClaimClass(NamedTuple):
    """What a verified claim payload is, as the limiter sees it.

    ``kind``: ``anon`` is the shared anonymous bucket (the bare payload, or a
    malformed per-IP payload); ``anon_ip`` is a well-formed per-IP pseudonym with
    ``value`` the 32 hex; ``csv`` is a strictly well-formed ``csv:<uuid>`` payload
    with ``value`` the uuid; ``tenant`` is any other verified payload (a malformed
    ``csv:`` payload included) with ``value`` the payload; ``unverified`` is a claim
    that is absent, forged or expired.
    """

    kind: Literal["anon", "anon_ip", "csv", "tenant", "unverified"]
    value: str | None


#: Refuse to do HMAC work on an oversized header. A claim is
#: ``<uuid>.<10-digit-epoch>.<64-hex>`` ≈ 110 chars; 512 is generous.
_CLAIM_MAX_CHARS: Final[int] = 512

#: Hashed into the key when a caller presents no credential at all, so the
#: no-credential bucket is stable rather than empty (an empty key makes slowapi
#: SKIP the limit entirely — ``__evaluate_limits``' ``if all(args)``).
_NO_CREDENTIAL: Final[str] = "unauthenticated"

#: Prefix of the DELIBERATE platform ceiling. Read this literally: a key that
#: starts with it is one bucket for the whole platform, on purpose, because the
#: caller presented no verifiable tenant identity. That is materially different
#: from the accidental platform bucket PYAPI-03 removes — an IP key behind a
#: proxy LOOKS per-client and is not.
PLATFORM_BUCKET_PREFIX: Final[str] = "platform:"

#: The bucket a key function falls to when it cannot even read the path. Never
#: empty — an empty key makes slowapi skip the limit entirely.
PLATFORM_DEGRADED_KEY: Final[str] = "platform:degraded"


def _platform_bucket(request: Request) -> str:
    """``platform:<route-path>`` — the documented ceiling. NEVER raises.

    One bucket per endpoint, shared by every caller that presents no verified
    tenant claim. It is named for what it is so nobody has to re-derive it from
    proxy semantics three years from now.

    ⚠️ This is a CEILING, not a per-tenant quota. It is the honest spelling of
    what the nine PYAPI-03 routes already had; the defect being repaired is that
    ``get_remote_address`` spelled the same thing as if it were per-client.
    """
    try:
        path: Any = request.url.path
        # Defensive isinstance for the same reason as :func:`_header`: these
        # functions are driven with hostile and mocked inputs in tests, and a
        # key function may not raise (G-8).
        return f"{PLATFORM_BUCKET_PREFIX}{path}" if isinstance(path, str) and path else PLATFORM_DEGRADED_KEY
    except Exception:
        log.error("rate_limit.platform_bucket_degraded", exc_info=True)
        return PLATFORM_DEGRADED_KEY


def default_platform_key(request: Request) -> str:
    """The shared :data:`limiter`'s default key. NEVER IP-derived, NEVER raises.

    **This function exists to make L-9 structurally impossible.** The singleton
    used to default to ``get_remote_address``; ``routers/optimizer.py`` imported
    the singleton correctly, declared ``@limiter.limit("20/minute")`` with no
    ``key_func``, and thereby acquired the IP-keying defect by OMISSION — which
    is why enumerating the class by "private ``Limiter()``" missed it entirely
    (RESEARCH X-4 / TRAP-5).

    The default is deliberately the CONSERVATIVE choice — one documented
    platform bucket — and NOT a per-tenant key: a route that wants tenant
    isolation must name its scope explicitly via
    ``key_func=partial(tenant_or_platform_key, scope=...)``. Silent inheritance
    of an identity decision is the bug; making the inherited value nicer would
    not have fixed it.
    """
    return _platform_bucket(request)


# Single canonical Limiter for the whole process. Imported by main.py for
# ``app.state.limiter = limiter`` AND by every router that uses
# ``@limiter.limit(...)``. Declared HERE, below its key function, because the
# default is now a real function in this module rather than a slowapi import.
limiter: Limiter = Limiter(key_func=default_platform_key)


def _header(request: Request, name: str) -> str:
    """Read a header as a ``str``, or ``""``. Tolerates hostile input.

    Header values reaching a real Starlette ``Request`` are always ``str``, but
    this is defensive on purpose — see :func:`tenant_rate_limit_key`'s
    never-raise contract, and the unit tests that drive these functions with
    bytes and ints.
    """
    value: Any = request.headers.get(name)
    return value if isinstance(value, str) else ""


def _credential(request: Request) -> str:
    """The secret this caller authenticated with, in cleartext.

    ``Authorization: Bearer <token>`` is the ``/process-key`` shape; the bare
    header and ``X-Service-Key`` cover the rest of the surface PYAPI-03 will
    adopt. Never returned to a caller and never logged — only hashed.
    """
    auth = _header(request, "Authorization")
    token = auth[len("Bearer ") :] if auth.startswith("Bearer ") else auth
    return token or _header(request, "X-Service-Key") or _NO_CREDENTIAL


def credential_hash(request: Request) -> str:
    """A stable 16-char SHA-256 prefix of the caller's credential.

    Hashed because the key string is printed verbatim into slowapi's throttle
    log line (``"ratelimit %s (%s) exceeded at endpoint: %s"``), and a raw
    bearer token in observability output is a credential leak.
    """
    return hashlib.sha256(_credential(request).encode("utf-8")).hexdigest()[:16]


def verify_tenant_claim(request: Request) -> str | None:
    """Return the HMAC-verified claim payload, or ``None``. NEVER raises.

    Wire format ``<payload>.<exp>.<hex-hmac-sha256>``, where the MAC covers
    ``"<payload>.<exp>"`` and the key is ``INTERNAL_API_TOKEN``.

    **No new secret and no new library** (RESEARCH G-15 / Q1.1(a)):
    ``INTERNAL_API_TOKEN`` is the secret this endpoint already authenticates
    with, present on both sides today, so the claim adds ZERO new trust surface
    — if it leaks, the attacker already holds full ``/process-key`` auth and the
    limiter is not the marginal loss. Verifying a Supabase JWT instead would
    need a new production secret AND a TS change on four routes AND still could
    not serve the teaser, which has no JWT by construction (G-13/G-14).

    ``hmac.compare_digest`` for the comparison, mirroring
    ``routers/process_key.py:_verify_internal_token``'s discipline.

    ``exp`` is enforced so a claim captured once — from a log, a proxy, a
    replayed request — is not a permanent tenant-bucket credential.
    """
    try:
        raw = _header(request, TENANT_CLAIM_HEADER)
        if not raw or len(raw) > _CLAIM_MAX_CHARS:
            return None
        secret = os.getenv("INTERNAL_API_TOKEN")
        if not secret:
            # Unverifiable, not forged. Post-PYAPI-04 the middleware already
            # answers 500 INTERNAL_TOKEN_UNCONFIGURED in this state, so this
            # arm is unreachable through the full app — it exists so this
            # function keeps its never-raise contract standalone.
            return None
        # rsplit, not split: it is the only parse that stays unambiguous if a
        # payload ever contains a dot. `exp` and the MAC never do.
        payload, exp_raw, provided_mac = raw.rsplit(".", 2)
        if not payload:
            return None
        if int(exp_raw) < int(time.time()):
            return None
        expected_mac = hmac.new(
            secret.encode("utf-8"),
            f"{payload}.{exp_raw}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(provided_mac, expected_mac):
            return None
        return payload
    except Exception:
        # ValueError from rsplit-unpack or int(); UnicodeError; AttributeError
        # on a hostile header type. ALL of them mean "not a valid claim", and
        # NONE of them may escape — see tenant_rate_limit_key.
        return None


def classify_tenant_claim(request: Request) -> ClaimClass:
    """Classify the request's verified claim. NEVER raises, NEVER logs.

    The ONE place a verified payload becomes a bucket kind; both key functions and
    ``/process-key``'s aggregate-exemption predicate go through it. It does not log
    because a predicate calls it too, so the key functions keep their own WARNs.
    """
    try:
        payload = verify_tenant_claim(request)
        if payload is None:
            return ClaimClass("unverified", None)
        if payload == ANON_PAYLOAD:
            return ClaimClass("anon", None)
        if payload.startswith(ANON_IP_PAYLOAD_PREFIX):
            # Reserved prefix: a malformed per-IP payload is still anonymous.
            matched = _ANON_IP_PAYLOAD_RE.fullmatch(payload)
            if matched is not None:
                return ClaimClass("anon_ip", matched.group(1))
            return ClaimClass("anon", None)
        csv_match = _CSV_PAYLOAD_RE.fullmatch(payload)
        if csv_match is not None:
            return ClaimClass("csv", csv_match.group(1))
        # A payload that starts with ``csv:`` but is not a canonical lowercase uuid
        # falls through to here: a plain tenant, with no ceiling exemption.
        return ClaimClass("tenant", payload)
    except Exception:
        log.error("rate_limit.classify_claim_degraded", exc_info=True)
        return ClaimClass("unverified", None)


def tenant_rate_limit_key(request: Request, scope: str) -> str:
    """The per-tenant limiter key for ``scope``. NEVER raises.

    Implements RESEARCH Q1.2's bucket table verbatim:

    ==========================================  =================================
    valid claim, payload "public:<32 hex>"      ``<scope>:anon:<32 hex>``
    valid claim, payload == "public"            ``<scope>:anon``
    valid claim, any other "public:" payload    ``<scope>:anon``
    valid claim, payload "csv:<lowercase uuid>" ``<scope>:csv:<uuid>``
    valid claim, any other payload              ``<scope>:t:<user_id>``
    absent / malformed / bad MAC / expired      ``<scope>:unverified:<cred-hash>``
    ==========================================  =================================

    The ``public:`` prefix is RESERVED (Phase 240 / RLIM-01): exactly 32 lowercase
    hex characters after it are a per-IP pseudonym; anything else after it is the
    shared anonymous bucket and can never reach a ``:t:`` tenant bucket.

    The ``csv:`` scope (Phase 240 / RLIM-02) is STRICT: only ``csv:`` plus a canonical
    lowercase uuid is csv-scoped. A malformed ``csv:`` payload is an ordinary tenant
    payload (``<scope>:t:csv:...``), so it gets the tenant tier and no exemption.

    **Why it must never raise** (RESEARCH G-8): slowapi re-raises whatever a key
    function throws out of ``_check_request_limit`` (``swallow_errors`` is
    ``False``), so it escapes to Starlette's ``ServerErrorMiddleware`` — a
    bodyless ``500 text/plain`` that 140.2's discriminator must then classify
    with no JSON at all, and that feeds the breaker. Turning a throttling
    concern into that is the exact defect class this programme closes.

    **Why the fallback degrades rather than refuses:** a caller that stops
    sending the header (a rotation, a rolled-back deploy, a new route that has
    not adopted the mint) keeps working on today's token-hash behaviour, and the
    WARN makes it visible BEFORE it can starve anyone. Refusing here would turn
    a header regression into an outage. Post-PYAPI-04 this bucket is reachable
    only by holders of ``INTERNAL_API_TOKEN``, so it means exactly "a trusted
    caller forgot the header" — never "an anonymous caller got a bucket".
    """
    try:
        claim = classify_tenant_claim(request)
        if claim.kind == "anon":
            return anon_bucket_key(scope)
        if claim.kind == "anon_ip" and claim.value is not None:
            return anon_ip_bucket_key(scope, claim.value)
        if claim.kind == "csv" and claim.value is not None:
            return csv_bucket_key(scope, claim.value)
        if claim.kind == "tenant":
            return f"{scope}:t:{claim.value}"
        log.warning(
            "rate_limit.tenant_claim_unverified",
            scope=scope,
            # PYAPI-06 discipline: presence, never content. Absent means a
            # caller stopped minting (config/rotation); present means the claim
            # failed verification (expired, tampered, wrong secret) — an
            # operator has to be able to tell those apart from the log alone.
            claim_present=bool(_header(request, TENANT_CLAIM_HEADER)),
        )
        return f"{scope}:unverified:{credential_hash(request)}"
    except Exception:
        log.error("rate_limit.key_func_degraded", scope=scope, exc_info=True)
        return f"{scope}:unverified:fallback"


def platform_ceiling_key(request: Request, scope: str) -> str:
    """The stacked platform-ceiling key for ``scope``. NEVER raises.

    Keyed on the credential hash. Post-PYAPI-04 every admitted ``/process-key``
    caller presents the SAME ``INTERNAL_API_TOKEN``, so this is ONE
    platform-wide bucket by construction — that is the intent. It is the
    backstop for the case the per-identity buckets cannot cover: N distinct
    tenants (or a flood of unverified callers) each staying inside their own
    window while collectively burying the service.

    Distinct from the ``:unverified:`` arm despite sharing the hash, so the two
    limits can never collapse into one counter.
    """
    try:
        return f"{scope}:ceiling:{credential_hash(request)}"
    except Exception:
        log.error("rate_limit.ceiling_key_func_degraded", scope=scope, exc_info=True)
        return f"{scope}:ceiling:fallback"


def tenant_or_platform_key(request: Request, scope: str) -> str:
    """PYAPI-03's key for the nine ex-IP-keyed routes. NEVER raises.

    ==========================================  =================================
    valid claim, payload "public:<32 hex>"      ``<scope>:anon`` (shared; see below)
    valid claim, payload == "public"            ``<scope>:anon``
    valid claim, any other "public:" payload    ``<scope>:anon``
    valid claim, payload "csv:<lowercase uuid>" ``<scope>:csv:<uuid>``
    valid claim, any other payload              ``<scope>:t:<user_id>``
    no verifiable claim                         ``platform:<route-path>``
    ==========================================  =================================

    The ``public:`` prefix is reserved, and the ``csv:`` scope is strict, exactly as
    in :func:`tenant_rate_limit_key`.

    **Phase 240 (RLIM-01 review): a per-IP pseudonym does NOT get its own
    bucket here.** Only ``/process-key`` stacks an aggregate anonymous ceiling
    over its per-IP buckets. These routes carry one limit each, so a per-IP
    bucket would let N addresses spend N windows with nothing above them. Every
    anonymous claim on these routes therefore folds into the ONE shared
    ``<scope>:anon`` bucket, as it did before the per-IP tier existed.

    Adopted as::

        @limiter.limit("20/minute",
                       key_func=partial(tenant_or_platform_key,
                                        scope="optimize_weights"))

    **Why the claimless arm is ``platform:<path>`` and not**
    :func:`tenant_rate_limit_key`'s ``<scope>:unverified:<credential-hash>``:
    every one of these nine routes authenticates with the SAME shared
    ``X-Service-Key`` (``main.verify_service_key``), so hashing the credential
    yields exactly one bucket anyway — with a name that implies otherwise. This
    plan's whole subject is buckets whose NAME lies about their width, so the
    fallback is spelled as the platform ceiling it is. ``/process-key`` keeps the
    credential-hash form because there the credential genuinely varies per
    caller class.

    **This IS per-tenant now.** ⚠️ CORRECTED 2026-08-26 (phase 163 review): this
    paragraph used to say ``src/lib/analytics-client.ts`` mints no
    ``X-Tenant-Claim``, describing the 140.2 obligation as outstanding. That is
    FALSE at HEAD — ``analytics-client.ts:468`` sets the header
    UNCONDITIONALLY in ``analyticsRequest``'s shared header block, so every
    route reached through that wrapper arrives WITH a claim and the claim arms
    above fire on real traffic.

    The design point the old wording was making still stands, and is now
    demonstrated rather than promised: the claimless case remains a documented
    fallback rather than a hard-coded platform key, which is why the transition
    needed **no change to this function and no change to any decorator**.

    **No WARN on the claimless arm**, deliberately — unlike
    :func:`tenant_rate_limit_key`, where an absent claim means "a caller that
    SHOULD be minting stopped". Here the claimless case is the expected steady
    state until 140.2 lands, so warning would emit one line per request on the
    busiest routes on the seam and train operators to ignore the signal.

    Never-raise contract, verbatim from :func:`tenant_rate_limit_key`: slowapi
    re-raises whatever a key function throws (``swallow_errors`` is ``False``),
    so it escapes as a bodyless ``500 text/plain`` that 140.2's discriminator
    cannot classify and that feeds the breaker (G-8).
    """
    try:
        claim = classify_tenant_claim(request)
        if claim.kind in ("anon", "anon_ip"):
            return anon_bucket_key(scope)
        if claim.kind == "csv" and claim.value is not None:
            return csv_bucket_key(scope, claim.value)
        if claim.kind == "tenant":
            return f"{scope}:t:{claim.value}"
        return _platform_bucket(request)
    except Exception:
        log.error(
            "rate_limit.tenant_or_platform_key_degraded", scope=scope, exc_info=True
        )
        return PLATFORM_DEGRADED_KEY
