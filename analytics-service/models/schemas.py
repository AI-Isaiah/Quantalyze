import math
import re
import unicodedata
import uuid as _uuid_mod
from pydantic import BaseModel, ConfigDict, SecretStr, field_validator
from typing import Any, Literal, Optional


class ComputeRequest(BaseModel):
    strategy_id: str


class ValidateKeyRequest(BaseModel):
    exchange: str
    api_key: str
    api_secret: str
    passphrase: Optional[str] = None


class FetchTradesRequest(BaseModel):
    strategy_id: str


class HealthResponse(BaseModel):
    status: str
    version: str


def _validate_user_id(v: Optional[str]) -> Optional[str]:
    """Validate user_id when present: must be a non-empty UUID-formatted string.

    Red-team M-001: bare ``str`` accepted empty strings and whitespace-only
    values, giving a misleading 404 instead of a 422 at the boundary.  We
    mirror the ``VerifyStrategyRequest.email`` pattern and reject at the edge.

    Red-team C-001: ``user_id`` is now Optional so existing TS callers that
    do not yet forward it (``runPortfolioOptimizer``, ``computePortfolioAnalytics``)
    continue to receive a response rather than an immediate 422.  The router
    performs a best-effort ownership check when the field is present and logs a
    warning when it is absent — the defence-in-depth goal of NEW-C19-01 is
    preserved for the callers that DO supply it (bridge, simulator).
    """
    if v is None:
        return None
    s = v.strip()
    if not s:
        raise ValueError("user_id must not be empty")
    try:
        _uuid_mod.UUID(s)
    except ValueError as exc:
        raise ValueError(
            f"user_id must be a valid UUID (got {s!r})"
        ) from exc
    return s


def _validate_portfolio_id(v: str) -> str:
    """Validate a required portfolio_id: must be a non-empty UUID string.

    Audit H-0532 / H-0533: the DB column is ``portfolio_id UUID NOT NULL``
    (migration 010), but the request schemas accepted any string, so a
    malformed id flowed all the way to Supabase before failing with a
    generic postgres error instead of a clean 422 at the boundary. We mirror
    the ``_validate_user_id`` pattern (validate-and-return-str) rather than
    switching to the ``uuid.UUID`` type so every downstream consumer in
    routers/portfolio.py (``.eq("id", req.portfolio_id)``, audit
    ``entity_id=req.portfolio_id``, f-string logging) keeps receiving a
    ``str`` — the fix is at the edge, not a rippling type change.
    """
    if not isinstance(v, str):
        raise ValueError("portfolio_id must be a string")
    s = v.strip()
    if not s:
        raise ValueError("portfolio_id must not be empty")
    try:
        _uuid_mod.UUID(s)
    except ValueError as exc:
        raise ValueError(
            f"portfolio_id must be a valid UUID (got {s!r})"
        ) from exc
    return s


class PortfolioAnalyticsRequest(BaseModel):
    portfolio_id: str

    @field_validator("portfolio_id")
    @classmethod
    def _validate_portfolio_id_field(cls, v: str) -> str:
        return _validate_portfolio_id(v)
    # NEW-C19-01 + C-PR5-01 (audit-2026-05-07, follow-up to PR #347):
    # user_id supplied by the Next.js caller so this service can verify
    # the portfolio belongs to the requesting user. The X-Service-Key
    # middleware authenticates the CALLER (Next.js), not the end user;
    # this ownership check is the only defense against a service-key
    # holder passing an arbitrary portfolio_id. See trust-boundary
    # comment in BridgeRequest (which has always required user_id).
    #
    # Prior C-001 (red-team) relaxed this to ``Optional[str] = None`` for
    # legacy callers that hadn't been updated yet. The PR-5 security
    # review identified that relaxation as the C-PR5-01 attack surface
    # (any X-Service-Key holder could pass portfolio_id with no user_id
    # and the handler would drop the ownership filter). PR #347 closed
    # the same shape on /api/match/recompute via actor binding; this
    # change closes it here. TS-side `computePortfolioAnalytics` now
    # requires `actorId` so the route signature can't drift back.
    user_id: str

    @field_validator("user_id")
    @classmethod
    def _validate_user_id_field(cls, v: str) -> str:
        result = _validate_user_id(v)
        if result is None:
            raise ValueError("user_id is required for PortfolioAnalyticsRequest")
        return result


class PortfolioOptimizerRequest(BaseModel):
    portfolio_id: str
    # NEW-C19-01 + C-PR5-01: see PortfolioAnalyticsRequest.user_id above.
    # The TS caller (src/lib/analytics-client.ts::runPortfolioOptimizer)
    # now requires `actorId` and forwards it as `user_id` from the
    # session-authenticated route. The Python handler's Optional branch
    # is the C-PR5-01 attack surface; tightening here forecloses it.
    user_id: str

    @field_validator("portfolio_id")
    @classmethod
    def _validate_portfolio_id_field(cls, v: str) -> str:
        return _validate_portfolio_id(v)

    @field_validator("user_id")
    @classmethod
    def _validate_user_id_field(cls, v: str) -> str:
        result = _validate_user_id(v)
        if result is None:
            raise ValueError("user_id is required for PortfolioOptimizerRequest")
        return result

    # Custom optimizer weights, keyed by strategy_id. Validated by the
    # field_validator below + the handler's per-portfolio key-scoping.
    # Audit 2026-05-07 H-0589: an unvalidated dict allowed NaN/Inf/string
    # values to propagate through numpy and corrupt optimizer_suggestions.
    weights: Optional[dict[str, float]] = None

    @field_validator("weights")
    @classmethod
    def _validate_weights(cls, v: Optional[dict[str, float]]) -> Optional[dict[str, float]]:
        if v is None:
            return None
        if not isinstance(v, dict):
            raise ValueError("weights must be a dict[str, float]")
        clean: dict[str, float] = {}
        for k, raw in v.items():
            if not isinstance(k, str):
                raise ValueError("weights keys must be strings (strategy_id)")
            try:
                val = float(raw)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"weight for {k!r} is not numeric: {raw!r}") from exc
            if math.isnan(val) or math.isinf(val):
                raise ValueError(f"weight for {k!r} must be finite (got {raw!r})")
            if val < 0:
                raise ValueError(f"weight for {k!r} must be non-negative (got {val})")
            clean[k] = val
        return clean


class BridgeRequest(BaseModel):
    portfolio_id: str
    underperformer_strategy_id: str
    # M-001 (red-team): UUID-validated, same boundary as PortfolioAnalyticsRequest.
    user_id: str

    @field_validator("portfolio_id")
    @classmethod
    def _validate_portfolio_id_field(cls, v: str) -> str:
        return _validate_portfolio_id(v)

    @field_validator("user_id")
    @classmethod
    def _validate_user_id_field(cls, v: str) -> str:
        result = _validate_user_id(v)
        if result is None:
            raise ValueError("user_id is required for BridgeRequest")
        return result


class VerifyStrategyRequest(BaseModel):
    # Audit H-0536: this endpoint does NOT persist the email — post-migration-107
    # ``verification_requests`` is a read-only VIEW backed by
    # ``strategy_verifications`` (which has no email column), and the Python
    # handler only owns the compute path (validate keys → fetch trades → score →
    # return metrics); the TS caller (src/app/api/verify-strategy/route.ts) does
    # the ``strategy_verifications`` upsert. ``req.email`` is consumed here only
    # as the per-email rate-limit key and the idempotency-cache key
    # (routers/portfolio.py). A bare ``str`` let control chars / oversized
    # payloads / junk poison those keys and waste an exchange handshake +
    # key-encryption first. Validated at the service edge to mirror+harden the
    # TS ``isValidEmail`` boundary (defense-in-depth, no new dependency).
    email: str
    # Audit H-0530: the three user-verifiable exchanges, matching the TS
    # boundary ``SUPPORTED_EXCHANGES = ['binance','okx','bybit']``. A bare
    # ``str`` let an out-of-domain value (e.g. ``deribit`` — which
    # ``create_exchange`` accepts) clear Pydantic and reach a live exchange
    # handshake before failing downstream. (The persisted store,
    # ``strategy_verifications.source``, also admits ``csv`` for ingestion, but
    # that is not a user-submitted verify exchange.) The Literal 422s the bad
    # value at the boundary.
    exchange: Literal["binance", "okx", "bybit"]
    # Audit H-0535: wrap credentials in SecretStr so they never leak into
    # ``repr(req)``, FastAPI validation-error messages, Sentry breadcrumbs, or
    # tracebacks (a bare ``str`` prints verbatim). The consumers in
    # routers/portfolio.py call ``.get_secret_value()`` at each use site
    # (``create_exchange``, the idempotency fingerprint). CRITICAL: the
    # ``_redact_credentials`` log scrubber must unwrap SecretStr before its
    # substring match — a SecretStr is NOT a ``str`` so an ``isinstance(_, str)``
    # guard would silently disable redaction and re-leak the secret.
    api_key: SecretStr
    api_secret: SecretStr
    passphrase: Optional[SecretStr] = None  # OKX only

    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: str) -> str:
        # Harden the TS boundary ``isValidEmail`` (/^[^\s@]+@[^\s@]+\.[^\s@]+$/):
        # exactly one ``@``, non-empty local + dotted domain, no interior
        # whitespace, and a final label (TLD) with no dot so a trailing dot
        # (``a@b.com.``) is rejected — it would otherwise yield a distinct
        # rate-limit/idempotency key for the same address. RFC-5321 caps the
        # addr-spec at 254 chars. The ``Cc`` check rejects every Unicode control
        # char — NUL, DEL, and the C1 range that the regex's ``[^\s@]`` would
        # otherwise admit (``\s`` already blocks CR/LF/tab).
        s = v.strip()
        if not s:
            raise ValueError("email must not be empty")
        if len(s) > 254:
            raise ValueError("email must be at most 254 characters")
        if any(unicodedata.category(ch) == "Cc" for ch in s):
            raise ValueError("email must not contain control characters")
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@.]+", s):
            raise ValueError("email is not a valid address")
        return s


# ---------------------------------------------------------------------------
# Response envelopes (audit H-0586 / H-0591)
# ---------------------------------------------------------------------------
# Previously each of /portfolio-analytics, /portfolio-optimizer, and
# /verify-strategy returned an ad-hoc untyped dict. Without a Pydantic
# response_model:
#   1. OpenAPI schema was empty so typed-SDK consumers couldn't share
#      a success supertype.
#   2. A refactor that dropped `analytics_id` from the response would
#      pass without any contract-level alarm.
#   3. The three sibling endpoints had divergent envelopes
#      (analytics_id vs verification_id vs suggestions).
#
# We model the response shapes here so FastAPI can serialize + validate
# them. We keep the existing field names rather than rewriting the wire
# format (TS callers depend on them), but we declare an `ok: True`
# discriminator + a common `portfolio_id` field where applicable so
# clients can share decoders. `extra="allow"` keeps existing inline
# metrics (twr/sharpe/etc.) compatible until a follow-up tightens them.


class PortfolioAnalyticsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool = True
    # Legacy compute-job phase string kept for backward compat with TS callers
    # ("complete" on success). `ok` is the new bool discriminator and is the
    # field new clients should branch on.
    status: str
    portfolio_id: str
    analytics_id: str


class PortfolioOptimizerResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool = True
    status: str
    portfolio_id: str
    suggestions: list[dict[str, Any]] = []
    persisted: bool = False


class VerifyStrategyResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool = True
    status: str
    verification_id: str
    matched_strategy_id: Optional[str] = None
    # The four known outcomes after the audit-2026-05-07 H-0582 split,
    # extended with `matching_partial` per audit-2026-05-07 red-team
    # (CRITICAL conf 7). Pre-fix, when the catalog exceeded
    # `_MATCH_CANDIDATE_LIMIT` and no peer was found within the
    # bounded recency slice, `matching_status='no_match'` was a false
    # negative — the user's actual peer might be just outside the
    # window. `matching_partial` signals "we only compared the
    # most-recent slice and didn't find one there". Declared as
    # Literal so the OpenAPI schema documents the enum and typed-SDK
    # consumers can switch on it (review API-3).
    matching_status: Optional[
        Literal["matched", "no_match", "matching_partial", "matching_unavailable"]
    ] = None
    # Set to True only when the response was served from the H-0592
    # idempotency cache on an Idempotency-Key retry (review API-5).
    idempotent_replay: Optional[bool] = None


class PortfolioBridgeResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool = True
    status: str
    portfolio_id: str
    underperformer_strategy_id: str
    candidates: list[dict[str, Any]] = []


# ── Phase 28 (OPT-01/02) — Weight Optimizer ─────────────────────────────────
# Stateless: the caller passes the draft-scoped strategies' daily-return series
# directly (no portfolio_id / DB read), so the endpoint is pure compute. The
# Next.js route is allocator-authed and forwards ONLY the caller's own series.


class OptimizerDailyPoint(BaseModel):
    """One daily-return point, mirroring the frontend `DailyPoint` { date, value }."""

    date: str
    value: float


class OptimizeWeightsRequest(BaseModel):
    # strategy_id -> its daily-return series (intersection-aligned server-side).
    series: dict[str, list[OptimizerDailyPoint]]
    objective: Literal["min_vol", "max_sharpe"] = "min_vol"


class OptimizeWeightsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool
    objective: str
    # The overlap N the optimizer fit on, and the strategy count k.
    n: int
    k: int
    # Suggested long-only, sum-to-1 weights {strategy_id: weight}, or None on a
    # degenerate / under-sampled input (the UI renders the honest empty state).
    weights: Optional[dict[str, float]] = None
    # ALWAYS true — these weights are fit IN-SAMPLE, never a forecast.
    in_sample: bool = True
    reason: str
