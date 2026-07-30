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
Simulator                   ``analytics-client.ts:363``                  —                see FINDING-10 below
``/process-key``            ``process-key-client.ts:151``                —                1 tenant + 1 ceiling token (Plan 06)
Key-permission badge        ``keys/[id]/permissions/route.ts:131``       —                1 of ``internal.py``'s hand-rolled
                                                                                         per-``key_id`` 10/min bucket
==========================  ==========================================  ===============  ================================================

**Limit VALUES above are unchanged by PYAPI-03** — it changes bucket IDENTITY
only. The value audit is RATE-04 / Phase 146.

⚠️ **FINDING-10 (not predicted by the plan).** ``routers/simulator.py:92``
``_simulator_rate_limit_key`` returns ``f"simulator:ip:{get_remote_address(...)}"``.
By BEHAVIOUR that is a tenth IP-keyed route; the plan's do-not-touch list calls it
"correctly user-keyed", which was true before the PR#241 follow-up reverted it (its
own docstring records the revert). It is left untouched here per the plan's explicit
scope fence, and ``tests/test_limiter_identity.py`` quarantines it with a literal
one-file allow-list so it cannot grow and cannot be forgotten. Its EFFECTIVE
per-tenant quota lives in-handler against ``req.user_id``
(``_check_simulator_user_rate``), so the IP key is a ceiling, not the quota — but
the ceiling is still platform-wide behind the edge proxy.

⚠️ **No limiter at all:** ``routers/match.py`` ``POST /api/match/recompute`` and
``GET /api/match/eval``, both seam-reachable (``analytics-client.ts:399,418``).
RATE-03 / Phase 146 owns adding one. Recorded here, not fixed here.

⚠️ **Storage is ``memory://`` and therefore per-replica** (ASSUMPTION-3). With N
Railway replicas every number above is N× looser and buckets reset unevenly on
rolling deploys.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Any, Final

import structlog
from fastapi import Request
from slowapi import Limiter

# ⚠️ PYAPI-03: ``slowapi.util.get_remote_address`` is deliberately NOT imported
# here any more. It was this module's singleton default, and
# ``routers/optimizer.py`` inherited it by omission — the L-9 defect. Nothing in
# ``analytics-service`` outside ``routers/simulator.py`` (FINDING-10) may key on
# it. Re-adding the import is how the class re-opens.

log = structlog.get_logger("quantalyze.analytics.rate_limit")

#: The forgery-resistant tenant identity. It MUST be a header: a slowapi
#: key function receives only the ``Request`` and the body is still un-awaited
#: at that point (RESEARCH G-7), so a body field is not readable. It must NOT
#: be ``X-User-Id``, which is unsigned client-controlled input (the PR#241
#: lesson: a caller could mint a fresh bucket per request, or drain a victim's).
TENANT_CLAIM_HEADER: Final[str] = "X-Tenant-Claim"

#: The payload the public teaser mints. Everything anonymous shares ONE bucket.
ANON_PAYLOAD: Final[str] = "public"

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


def tenant_rate_limit_key(request: Request, scope: str) -> str:
    """The per-tenant limiter key for ``scope``. NEVER raises.

    Implements RESEARCH Q1.2's bucket table verbatim:

    ==========================================  =================================
    valid claim, payload != "public"            ``<scope>:t:<user_id>``
    valid claim, payload == "public"            ``<scope>:anon``
    absent / malformed / bad MAC / expired      ``<scope>:unverified:<cred-hash>``
    ==========================================  =================================

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
        payload = verify_tenant_claim(request)
        if payload == ANON_PAYLOAD:
            return f"{scope}:anon"
        if payload is not None:
            return f"{scope}:t:{payload}"
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
    valid claim, payload != "public"            ``<scope>:t:<user_id>``
    valid claim, payload == "public"            ``<scope>:anon``
    no verifiable claim                         ``platform:<route-path>``
    ==========================================  =================================

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

    **This becomes per-tenant on its own.** ``src/lib/analytics-client.ts``
    mints no ``X-Tenant-Claim`` today (a recorded 140.2 obligation). The moment
    it does, the claim arms above fire and these routes acquire real per-tenant
    isolation with **no change to this function and no change to any decorator**
    — that is why the claimless case is a documented fallback rather than a
    hard-coded platform key.

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
        payload = verify_tenant_claim(request)
        if payload == ANON_PAYLOAD:
            return f"{scope}:anon"
        if payload is not None:
            return f"{scope}:t:{payload}"
        return _platform_bucket(request)
    except Exception:
        log.error(
            "rate_limit.tenant_or_platform_key_degraded", scope=scope, exc_info=True
        )
        return PLATFORM_DEGRADED_KEY
