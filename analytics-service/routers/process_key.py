"""Phase 19 / BACKBONE-01 — unified key-submission RPC.

Wraps the IngestionAdapter Protocol (BACKBONE-02) and the
strategy_verifications state-machine RPC (BACKBONE-03 / migration 103).
Auth via INTERNAL_API_TOKEN (constant-time compare; mirrors
routers/internal.py:117).

Two execution modes
-------------------
  - SYNCHRONOUS (default for csv flow_type, teaser, internal_report):
    Runs the full 5-method pipeline inline, returns a VerificationResult-
    shaped dict.
  - QUEUED (for resync + onboard):
    Returns ``{queued, correlation_id, verification_id}`` synchronously;
    enqueues a process_key_long compute_job; the worker (P6) writes the
    result back to strategy_verifications. See BACKBONE-09 / P6.

NOTE — DO NOT add ``from __future__ import annotations`` to this module.
FastAPI 0.115.x (pinned in requirements.txt) inspects ``param.annotation``
(the raw, source-form annotation) to decide body-vs-query for a route
parameter. Under PEP-563 stringification, the BaseModel-typed ``body``
parameter becomes the string ``"_ProcessKeyBody"`` and FastAPI falls
back to treating it as a query parameter — every JSON-body POST then
422s with ``loc:["query","body"], "Field required"``. The Annotated
``Body()`` marker survives PEP-563 in newer fastapi but not in the
pinned version. Until fastapi is bumped (separate PR), this module
must keep annotations evaluated at function-definition time.
"""

import asyncio
import dataclasses
import os
import secrets
import time
import uuid
from typing import TYPE_CHECKING, Annotated, Any

import structlog
from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationInfo, field_validator, model_validator

from services import exchange as exchange_svc
from services.basis_series import derive_basis_series
from services.db import get_supabase, one, rows
from services.ingestion import get_adapter
from services.ingestion.adapter import FlowType, KeySubmissionRequest, Source, Trade
from services.ingestion.serde import metrics_to_jsonb as _metrics_to_jsonb
from services.closed_sets import CRYPTO_VENUES as _CRYPTO_VENUES
from services.closed_sets import sfox_enabled_server
from services.closed_sets import mt5_enabled_server
from services.metrics import periods_per_year_for_asset_class
# WIZFORM-ABANDON / D-40 — imported from the module that OWNS it
# (`services.mt5_client`, a leaf whose only in-tree import is `services.redact`),
# never through a re-export: a name reached through a re-export is a DIFFERENT
# binding and an `except` on it would still be a class match, but the import edge
# would be one nobody can reason about. Two `adapter.validate` call sites below
# had no enclosing try at all before this phase.
from services.mt5_client import Mt5SessionAbandoned
from services.rate_limit import limiter, platform_ceiling_key, tenant_rate_limit_key
from services.teaser_anchor import TEASER_ANCHOR_STRATEGY_ID

if TYPE_CHECKING:
    import pandas as pd

router = APIRouter(prefix="/process-key", tags=["process-key"])
log = structlog.get_logger("quantalyze.analytics.process_key")

# CT-8 (army2) — module-level strong-reference set for the I-perf-3
# fire-and-forget audit tasks. Per CPython docs, asyncio.create_task()
# only holds a WEAK reference to the returned Task; if the caller
# discards the reference and there are no other strong refs, the GC
# may collect the Task mid-flight and raise
#   RuntimeError: Task was destroyed but it is pending!
# losing the audit row silently. Holding a strong ref in this set —
# combined with task.add_done_callback(_audit_tasks.discard) — keeps
# the Task alive until completion and self-cleans on success.
_audit_tasks: set[asyncio.Task[None]] = set()


# ---------------------------------------------------------------------------
# Rate limiting (PYAPI-02 — RESEARCH Q1.2, mechanisms (a) + (c) + (d))
# ---------------------------------------------------------------------------
#
# API-5 keyed this route on a hash of the bearer token, which was the strongest
# identity available at the time: `X-User-Id` is unsigned client-controlled
# input, so composing it in let a caller mint a fresh bucket per request (the
# PR#241 bypass). But the bearer is a SINGLE SHARED platform token, so "one
# bucket per calling service" is in practice ONE 100/hour bucket for the entire
# platform — and Vercel caps the anonymous teaser at 10 req/60s per IP, i.e.
# 600/hour, so one anonymous IP drained the whole platform's window in about ten
# minutes (RESEARCH G-16 / X-3 / C-09).
#
# X-Tenant-Claim is the signed identity surface API-5's docstring was waiting
# for. The verification half lives in services/rate_limit.py so PYAPI-03 can
# re-key its nine IP-keyed routes onto the same mechanism instead of copying it.

#: Per-tenant window. Unchanged from the pre-fix number — what changes is that
#: it is now PER TENANT rather than per platform.
_PROCESS_KEY_TENANT_LIMIT = "100/hour"

#: The public teaser's shared window. Deliberately BELOW a tenant's (OPEN-3's
#: technical recommendation; founder-retunable): anonymous traffic is the
#: untrusted half and must not be able to consume a paying tenant's worth of
#: capacity. It is also the arm with the least recourse — an anonymous visitor
#: cannot be contacted, rate-limited by account, or billed.
_PROCESS_KEY_ANON_LIMIT = "30/hour"

#: The stacked backstop, keyed on the credential hash. Post-PYAPI-04 every
#: admitted caller presents the same INTERNAL_API_TOKEN, so this is one
#: platform-wide bucket — 5x the 100/hour the whole platform shared before this
#: phase, and the only thing standing between N tenants each inside their own
#: window and a collectively buried service.
_PROCESS_KEY_CEILING_LIMIT = "500/hour"


def _process_key_rate_limit_key(request: Request) -> str:
    """Per-identity limiter key for /process-key. See services/rate_limit.py.

    Returns ``process_key:t:<user_id>`` for a valid tenant claim,
    ``process_key:anon`` for the public teaser, and
    ``process_key:unverified:<credential-hash>`` (plus a WARN) when the claim is
    absent, malformed, expired or forged. NEVER raises — RESEARCH G-8.
    """
    return tenant_rate_limit_key(request, "process_key")


def _process_key_ceiling_key(request: Request) -> str:
    """Stacked platform-ceiling key for /process-key. NEVER raises."""
    return platform_ceiling_key(request, "process_key")


def _process_key_limit_for(key: str) -> str:
    """Size the per-identity window from the bucket the key function chose.

    slowapi supports a CALLABLE limit provider and passes it the key function's
    output when the provider declares a parameter named ``key``
    (``slowapi/wrappers.py`` ``LimitGroup.__iter__``). That is what lets one
    decorator serve two different sizes: ``exempt_when`` cannot see the request,
    and a second decorator whose key function returned ``""`` for non-anon
    traffic would make slowapi log an ERROR on every authenticated call.
    """
    return _PROCESS_KEY_ANON_LIMIT if key == "process_key:anon" else _PROCESS_KEY_TENANT_LIMIT


def _process_key_ceiling_limit_for(key: str) -> str:
    """The ceiling, as a callable provider so it is read per-request.

    Same size for every bucket; a provider rather than a literal so the two
    stacked limits are configured the same way and either can be exercised in a
    test without a five-hundred-request loop.
    """
    return _PROCESS_KEY_CEILING_LIMIT


# ---------------------------------------------------------------------------
# Request body
# ---------------------------------------------------------------------------


class _ProcessKeyBody(BaseModel):
    # FlowType / Source are the canonical Literal aliases shared with
    # services.ingestion.adapter.KeySubmissionRequest. Reusing them (rather
    # than a local regex pattern) keeps this body in lockstep with the adapter
    # contract and lets the values pass straight into KeySubmissionRequest
    # without a cast. Pydantic validates a Literal field by membership — the
    # same accept/reject set the prior `Field(pattern=...)` enforced.
    flow_type: FlowType
    source: Source
    context: dict[str, Any]

    # H-11 — per-flow_type source whitelist. Without this, a malicious caller
    # can send flow_type='teaser', source='csv' which routes to the CSV
    # adapter whose fetch_raw expects raw_bytes context — producing 500 +
    # traceback noise that consumes the cron's error budget and triggers
    # auto-rollback (DoS).
    #
    # P72 — `deribit` is admitted to `onboard` and `resync` ONLY (not
    # `teaser`/`internal_report`/`csv`). Deribit returns are ledger-backed and
    # its fill-based `compute_metrics` raises NotImplementedError by design, so
    # the synchronous teaser preview cannot serve it; the async onboard/resync
    # flows route Deribit through the broker-dailies ledger path
    # (run_process_key_long_job → derive_broker_dailies) instead.
    #
    # SFOX-05 — `sfox` is admitted to `onboard`/`resync` ONLY, for the SAME
    # reason: SfoxAdapter.compute_metrics/fetch_raw fail loud by design (returns
    # come from the balance-history usd_value series via the sfox broker-dailies
    # branch, NOT fills), so the synchronous teaser/internal_report/csv preview
    # cannot serve it. Admitting it here kills the phase-119 F2 422-on-source; the
    # async flows route sfox through run_process_key_long_job → derive_broker_dailies.
    #
    # MT5RECON-01 — `mt5` is admitted to `onboard`/`resync` ONLY, for the SAME
    # reason (Mt5Adapter.compute_metrics/fetch_raw fail loud by design; returns
    # come from the history_deals_get deal ledger via the mt5 broker-dailies
    # branch, NOT fills). It rides the SAME long-fetch tail and stays fully
    # founder-gated behind mt5_enabled_server until go-live.
    @field_validator("source")
    @classmethod
    def _validate_source_per_flow(cls, source: Source, info: ValidationInfo) -> Source:
        flow_type = info.data.get("flow_type")
        if flow_type is None:
            # If flow_type is absent or already invalid, let its own
            # validator surface the error rather than masking it here.
            return source
        # F2 (Phase 122 — STRUCTURAL worker gate): sFOX is founder-gated until
        # go-live. Fail CLOSED at the wire boundary — a sfox onboard/resync body
        # is REJECTED (422) BEFORE any compute_job is enqueued or any live
        # balance-history crawl runs, until SFOX_ENABLED=true is set on the
        # worker (lockstep with the Vercel server env — 121/122 runbook). Never a
        # live probe, never a false-verified draft. ccxt sources are unaffected.
        if source == "sfox" and not sfox_enabled_server():
            raise ValueError(
                "SFOX-F2: sFOX integration is not yet available "
                "(SFOX_ENABLED is off)."
            )
        # MT5RECON-01 (Phase 136 — the go-dark gate, verbatim mirror of the sfox
        # F2 seam above): mt5 is founder-gated until go-live (Phase 139). Fail
        # CLOSED at the wire boundary — an mt5 onboard/resync body is REJECTED
        # (422) BEFORE any compute_job is enqueued or any live RPyC deal read runs,
        # until MT5_ENABLED=true is set on the worker (lockstep with the Vercel
        # server env — the 135/139 runbook). Never a live probe, never a
        # false-verified draft. ccxt/deribit/sfox sources are unaffected.
        if source == "mt5" and not mt5_enabled_server():
            raise ValueError(
                "MT5-F2: MT5 integration is not yet available "
                "(MT5_ENABLED is off)."
            )
        valid: dict[str, set[str]] = {
            "teaser": {"okx", "binance", "bybit"},
            "onboard": {"okx", "binance", "bybit", "deribit", "sfox", "mt5"},
            "internal_report": {"okx", "binance", "bybit"},
            "resync": {"okx", "binance", "bybit", "deribit", "sfox", "mt5"},
            "csv": {"csv"},
        }
        allowed = valid.get(flow_type, set())
        if source not in allowed:
            raise ValueError(
                f"H-11: source={source!r} not allowed for flow_type={flow_type!r}; "
                f"allowed={sorted(allowed)}"
            )
        return source

    # I-API2 — per-flow_type required-keys assertion. Pre-fix, missing
    # context fields surfaced deep inside the adapter as KeyError 500s;
    # this model_validator surfaces them as a clean 422 at the wire
    # boundary. Validate-only flows (step='validate') skip the credential
    # / file-bytes assertion because those keys are still being collected
    # by the wizard step.
    @model_validator(mode="after")
    def _validate_per_flow_required_keys(self) -> "_ProcessKeyBody":
        ctx = self.context or {}
        step = ctx.get("step")

        # Validate-only and finalize-step flows have their own pre-strategy
        # branches in the route handler; skip the credential / file-bytes
        # assertion here so those branches can run.
        if step in {"validate", "finalize"}:
            return self

        # resync is excluded: it re-syncs an EXISTING strategy whose api_key is
        # already stored (api_key_id linkage), so the worker resolves
        # credentials server-side from the stored key — the /api/keys/sync body
        # carries no api_key/api_secret and no step. Pre-fix resync sat in this
        # set, so that credential-less body 422'd before any compute_job was
        # enqueued and the wizard "Verify data" step surfaced SYNC_FAILED with
        # zero analytics written. teaser (synchronous, reads creds from context
        # below) and onboard (may be a first-time connect; its callers pass
        # step=validate/finalize which is skipped above) still require creds.
        if self.flow_type in {"teaser", "onboard"}:
            missing = [k for k in ("api_key", "api_secret") if k not in ctx]
            if missing:
                raise ValueError(
                    f"flow_type={self.flow_type!r} requires context keys "
                    f"{missing!r}"
                )
        elif self.flow_type == "csv":
            # CSV needs raw_bytes_base64 (canonical) OR raw_bytes (legacy)
            # AND fmt AND wizard_session_id. internal_report has its own
            # set; keeping the strict check for csv only here keeps the
            # validator low-risk and tightly scoped.
            if "fmt" not in ctx:
                raise ValueError("flow_type='csv' requires context.fmt")
            if "wizard_session_id" not in ctx:
                raise ValueError(
                    "flow_type='csv' requires context.wizard_session_id"
                )
            if (
                "raw_bytes_base64" not in ctx
                and "raw_bytes" not in ctx
            ):
                raise ValueError(
                    "flow_type='csv' requires context.raw_bytes_base64 "
                    "(canonical) or context.raw_bytes (legacy)"
                )
        return self


# ---------------------------------------------------------------------------
# Auth (mirrors routers/internal.py:104-118)
# ---------------------------------------------------------------------------


def _verify_internal_token(request: Request) -> None:
    """Constant-time compare on Authorization header.

    Mirrors routers/internal.py:117 verbatim. The X-Internal-Token header
    is the wire shape used by the existing /internal/* surface, but the
    Phase 19 thin adapters (P5) post `Authorization: Bearer ${token}`
    (the standard idiom for cross-service calls between Vercel and
    Railway). We accept both shapes — the bearer form for the new
    callers and a bare token for any internal call that piggybacks on
    this seam — but always run the compare via secrets.compare_digest.
    """
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        log.error("INTERNAL_API_TOKEN not set", path="/process-key")
        raise HTTPException(
            status_code=403, detail="Internal API not configured"
        )
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        provided = auth[len("Bearer ") :]
    else:
        provided = auth
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


# PYAPI-10 (C-22, Phase 140.1) — the ONE discriminator on this route's 200
# surface. Two rules, and they hold for EVERY 200 `/process-key` can emit:
#
#   1. `ok` is present and is a JSON boolean.
#   2. when `ok` is false, `code` is a non-empty string.
#
# Before this, three of the then-six 200 shapes carried no discriminator at all
# and consumers classified replies by sniffing which fields happened to be
# present. The shapes, by behaviour: WIZARD_DUPLICATE (`_wizard_duplicate_reply`,
# TWO emitters), `queued:true`, validate-only success, csv-finalize success
# (branch deleted in Phase 145 — the route finalizes via the folded RPC now),
# synchronous success, and this envelope. `job_state` (PYAPI-09) rides the
# duplicate shape rather than existing as a parallel discriminator.
#
# This envelope is the route's OWN vocabulary (Phase 17 DESIGN-05: top-level
# `ok`/`code`/`human_message`, read directly off the body by the wizard's error
# renderer). It is deliberately NOT `services/error_contract.py`'s PYAPI-05
# envelope, which nests under `body.detail` and exists for the 5xx-capable seam
# routes — `/process-key` has zero explicit 5xx sites (STATUS_CONTRACT.md S-22).
# One route, one envelope: never a second parallel one.
# PYAPIFIX-02 (Phase 140.1.1) — the error codes THIS ROUTE mints itself, as
# opposed to the codes a venue probe produced. They are terminal by
# construction: no retry of an identical request changes the verdict (a caller
# does not become the owner of someone else's strategy by asking twice). They
# are enumerated so the probe-code derivation below cannot reach them.
#
# The two universes fail safe in OPPOSITE directions, which is why both are
# named rather than one blanket default: an unknown VENUE code must default
# RECOVERABLE (retry and succeed, rather than "go rotate credentials that were
# never broken"), while an unknown code from OUR OWN vocabulary must default
# TERMINAL. `_envelope_error` cannot tell the universes apart from the string,
# so the caller may also STATE the verdict outright — the 424 arm does.
#
# "VALIDATION_UNEXPECTED" sits here because the code string alone cannot say
# whether it was OUR fallback (a confirmed write-capable key with no scope code
# — permanent) or adapter-set (an unexpected exception during validate — may be
# transient). Terminal is the safe default; the 424 arm, the only place an
# adapter-set one can land, passes recoverable=True explicitly.
_ROUTE_TERMINAL_ERROR_CODES = frozenset(
    {
        "UNKNOWN",
        "CSV_FINALIZE_FAILED",
        "MISSING_STRATEGY_ID",
        "STRATEGY_NOT_OWNED",
        "VALIDATION_UNEXPECTED",
    }
)


def _envelope_error(
    code: str | None,
    msg: str | None,
    cid: str,
    vid: str | None,
    recoverable: bool | None = None,
) -> dict[str, Any]:
    """Phase 17 DESIGN-05 envelope. ok=False renders as wizard error UI.

    ``recoverable`` (PYAPIFIX-02): pass an explicit bool to STATE the verdict.
    Left as ``None`` it is DERIVED from ``code`` — a probe code that is in
    neither the shared permanent-code allow-list (``services/exchange.py``) nor
    this route's own vocabulary is a fault at the caller's VENUE and IS
    recoverable.

    Pre-140.1.1 the derivation was an allow-list of RECOVERABLE codes
    (``{RATE_LIMITED, EXCHANGE_UNAVAILABLE, NETWORK_UNAVAILABLE}``). It omitted
    ``PROBE_FAILED`` and ``DDOS_PROTECTION``, so those shipped ``recoverable:
    false`` beside the human copy "Try again in a moment." — one reply saying
    the opposite of itself. That shape fails UNSAFE: a code nobody remembered
    to list is reported terminal. Inverting it to an allow-list of PERMANENT
    codes makes the forgetful case retryable instead.
    """
    _code = code or "UNKNOWN"
    return {
        "ok": False,
        "code": _code,
        "human_message": msg or "Unknown error",
        "debug_context": {"verification_id": vid} if vid else {},
        "correlation_id": cid,
        "recoverable": (
            recoverable
            if recoverable is not None
            else (
                _code not in _ROUTE_TERMINAL_ERROR_CODES
                and _code not in exchange_svc.PERMANENT_VALIDATION_ERROR_CODES
            )
        ),
    }


def _caller_owns_strategy(
    supabase: Any, strategy_id: str, user_id: Any
) -> bool:
    """PYAPI-01e / C-08 — does ``user_id`` own ``strategy_id``?

    Scoping the strategy_verifications reads by ``strategy_id`` (PYAPI-01d) is
    necessary but NOT sufficient, because ``context.strategy_id`` is entirely
    caller-supplied: a caller that supplies a FOREIGN strategy_id simply gets a
    read that is consistently foreign. This is the second layer.

    **Fails closed on a missing/blank user_id.** A row cannot be owned by
    nobody, so "no user_id" is a miss, not a bypass — otherwise the whole gate
    would be opt-out by omission. Every non-teaser production caller forwards
    ``context.user_id`` (``keys/sync/route.ts``,
    ``finalize-wizard/route.ts``, ``keys/validate-and-encrypt/route.ts``;
    csv-finalize left this seam in Phase 145 — the route calls the folded RPC
    directly), and the I-SEC2 warning below already flags the absent case —
    this promotes that warning to a refusal on the one path that then reads
    ANOTHER table by that caller-supplied id.

    ⭐ **THIS FILTER IS THE ONLY BELT, PERMANENTLY, AND THAT IS NOW A DECISION
    RATHER THAN A GAP.** Phase 146.1 / B2 (2026-08-18) settled the drop-vs-wire
    adjudication in favour of DROPPING: ``X-User-Access-Token`` is no longer
    forwarded by ANY Next route. It had two emitters (keys/sync,
    verify-strategy) and zero readers — ``get_user_scoped_supabase`` (db.py)
    has had no callers since Phase 145 deleted the csv-finalize branch that
    consumed it, and ``tests/test_process_key.py`` (~:2220) pins that non-use —
    so a live end-user JWT was crossing a service boundary and being read by
    nobody. The Phase 140.2 obligation to "forward it on every authenticated
    flow" is therefore DISCHARGED BY SUBSTITUTION: this explicit filter IS the
    substitute, already shipped and gated. See
    ``.planning/phases/140.1-.../140.1-TS-OBLIGATIONS.md`` TS-15 for the dated
    superseding note and the NOT-TAKEN option (b).

    ⛔ Do not "restore" the forward to make a 42501 go away. Wiring a genuinely
    user-scoped client is option (b): it needs the non-use gate flipped and an
    RLS analysis for every read that would newly run as the user rather than
    ``service_role``. It remains a founder call, which is why
    ``get_user_scoped_supabase`` was kept rather than deleted.

    Not wrapped in try/except on purpose: a lookup failure is a service-side
    fault, and answering 403 to it would blame the caller for our outage. The
    exception propagates, exactly like the draft INSERT below.
    """
    if not user_id or not isinstance(user_id, str):
        return False
    owned = one(
        supabase.table("strategies")
        .select("id")
        .eq("id", strategy_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return owned is not None


def _trade_to_dict(t: Trade | dict[str, Any]) -> dict[str, Any]:
    """Normalize a fetch_raw element to a plain dict for trades_to_daily_returns.

    fetch_raw is typed list[Trade] (dataclass instances); ``asdict()`` converts
    those. An element that is already a dict is passed through unchanged —
    preserving the inline comprehension's pre-migration defensive shape (never
    ``asdict()`` a non-dataclass).
    """
    if isinstance(t, dict):
        return t
    return dataclasses.asdict(t)


# Phase 105.1-01 (D1/D2/D4/D5/D6) — the sync-pipeline derive swap.
#
# The teaser/csv/internal_report return-based scalars used to come off the
# backbone (EquityCurveBuilder on a synthetic 100k-NAV curve at √252). They now
# route through derive_basis_series — the ONE backbone compute path — annualized
# by asset_class (#597 / D2). NOTHING is persisted (D1): derive is compute-only
# (basis_series.py:181 — persist_basis_series is a SEPARATE function this module
# NEVER calls; the archived `00000…0001` teaser anchor makes any series row
# unreadable + PK-colliding by construction).

# venue → asset_class is a property of the VENUE, not the flow: an api_key
# sourced from a crypto exchange is crypto regardless of flow_type. Only
# okx/binance/bybit are sync-eligible today (H-11 whitelist, :137-143); deribit
# is included defensively so a future H-11 admission of it classifies here too.
# A NEW sync-eligible venue MUST be classified in this set (grep the H-11
# whitelist above when admitting one).
# MD-01: `_CRYPTO_VENUES` now aliases the canonical `services.metrics.CRYPTO_VENUES`
# (imported above) so the teaser preview clock can never drift from the composite
# blend clock. Do NOT redefine a local literal here.

# D6 degrade contract: the five legacy landing-card enrichment keys null out
# together on any insufficient-history path (len<2 pre-check OR derive's <2
# FINITE-rows ValueError). Single literal so both arms emit an identical shape.
# The FOUR return-based snapshot keys (twr/sharpe/ytd/max_drawdown) are
# separately pre-nulled at the call site (see the swap block) — the builder's
# off-backbone values for them must NEVER persist (D1).
_LEGACY_NULL_ENRICHMENT: dict[str, Any] = {
    "return_24h": None,
    "return_mtd": None,
    "return_ytd": None,
    "equity_curve": None,
    "matched_strategy_id": None,
}


def _resolve_asset_class(
    source: str, strategy_id: str, supabase: Any
) -> str | None:
    """FLAG C — resolve the annualization asset_class for the sync derive.

    Branches on `source` (the axis H-11 already keys on — NOT flow_type, so the
    anti-cosplay doctrine at :470-473 stays intact):
      - a crypto exchange venue (okx/binance/bybit, deribit defensively) ⇒
        "crypto" WITHOUT a DB read — matches the #597 backfill convention that
        api_key-sourced rows are crypto.
      - source == "csv" ⇒ read `strategies.asset_class` for the REAL strategy_id
        present in every sync csv run (`process_key`'s `MISSING_STRATEGY_ID`
        422 guard returns before this helper is ever called when it is
        missing). This is the SAME signal finalize reads — the
        `periods_per_year_for_asset_class(_strategy_row.get("asset_class"))`
        call in `analytics_runner.run_csv_strategy_analytics` — keeping preview
        and finalize annualization on one clock.
    A missing/None row or any lookup failure ⇒ None (fail-soft to
    periods_per_year_for_asset_class(None) = 252, the DB column's own DEFAULT
    'traditional'). Reads ONLY asset_class; no value is echoed to the caller.
    """
    if source in _CRYPTO_VENUES:
        return "crypto"
    if source == "csv":
        try:
            resp = (
                supabase.table("strategies")
                .select("asset_class")
                .eq("id", strategy_id)
                .maybe_single()
                .execute()
            )
            data = getattr(resp, "data", None)
            if data:
                asset_class = data.get("asset_class")
                return asset_class if isinstance(asset_class, str) else None
        except Exception as exc:  # noqa: BLE001
            # Fail-soft to 252 (L2, Fable red team) — but log it: a transient
            # lookup failure for a crypto CSV strategy silently understates the
            # preview Sharpe by ~1.204× (√252 vs √365) vs finalize, with no
            # other signal.
            log.warning(
                "process_key.resolve_asset_class_failed",
                error=str(exc)[:200],
                strategy_id=strategy_id,
            )
            return None
    return None


def _derive_return_scalars(
    returns: "pd.Series", asset_class: str | None
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Derive the four return-based teaser scalars + equity_curve on the ONE
    backbone compute path (D1). Returns `(four_key_dict, equity_curve)`.

    Single `derive_basis_series` call, annualized by asset_class (#597 / D2 —
    crypto √365 / traditional √252). geometric + calendar are the analytics
    seam defaults (the `_cumulative_method` / `_day_basis` assignments in
    `analytics_runner.run_csv_strategy_analytics`); the teaser has no
    denominator_config and passes no scalar_returns/densify_policy (no
    byte-identity machinery — Pitfall 4).

    FLAG A: `ytd` lives in the NESTED result.metrics_json["metrics_json"]["ytd"]
    (metrics.py:846) — a top-level scalars["ytd"] KeyErrors. The other three are
    top-level (cumulative_return/sharpe/max_drawdown, metrics.py:1178-1189).

    equity_curve is a running geometric cumprod over the derive's series_rows
    (the persisted-truth sparse form) — coherent with cumulative_return by
    construction (absent gap days are the multiplicative identity).

    Raises `ValueError` when <2 finite rows survive sanitize
    (basis_series.py:225-228); the caller maps it onto the degrade arm (D6).
    """
    result = derive_basis_series(
        returns,
        None,
        periods_per_year=periods_per_year_for_asset_class(asset_class),
        cumulative_method="geometric",
        day_basis="calendar",
    )
    scalars = dict(result.metrics_json)
    four_keys = {
        "twr": scalars["cumulative_return"],
        "sharpe": scalars["sharpe"],
        # FLAG A: nested ytd — NOT scalars["ytd"] (that KeyErrors).
        "ytd": scalars["metrics_json"]["ytd"],
        "max_drawdown": scalars["max_drawdown"],
    }
    equity_curve: list[dict[str, Any]] = []
    value = 1.0
    for row in result.series_rows:
        value *= 1 + row["return"]
        equity_curve.append({"date": row["date"], "value": float(value)})
    return four_keys, equity_curve


def _is_long_fetch(body: _ProcessKeyBody) -> bool:
    """Heuristic per RESEARCH §P4 L1034-1045.

    teaser/csv/internal_report run inline (Vercel 300s ceiling sufficient);
    onboard + resync queue via worker dyno (BACKBONE-09).
    """
    return body.flow_type in {"onboard", "resync"}


# PYAPI-09 (Phase 140.1) — the WIZARD_DUPLICATE reply contract.
#
# `queued` used to mean "this call reached the enqueue statement", which is
# unobservable to the caller and was FALSE BY CONSTRUCTION on the duplicate
# path: that path returns ~170 lines above the enqueue. It now means:
#
#     a non-terminal compute_job exists for this verification at the moment
#     of reply
#
# — a predicate the caller can act on, and one this code makes TRUE rather than
# merely asserting. `job_state` names the three cases the old blanket
# `queued:false` collapsed into one (140.1-RESEARCH Q4):
#
#   "not_applicable" — no background job applies: a synchronous flow, or a
#                      verification that already finished
#   "running"        — a compute_job for this strategy is already in flight
#   "enqueued"       — a compute_job exists because this call put it there
#
# strategy_verifications statuses a long-fetch session can still be resumed
# from. Anything else is a FINISHED session: `_enqueue_compute_job_internal`
# dedupes only over non-terminal job statuses, so an unguarded re-enqueue there
# would mint a fresh job on every stray refresh and silently re-sync a
# verification the user already completed.
_RESUMABLE_VERIFICATION_STATUSES = frozenset({"draft"})

# compute_jobs statuses that mean "already being worked" rather than "waiting".
# Mirrors the non-terminal set _enqueue_compute_job_internal dedupes over
# (migrations/20260716090000...sql:181+) minus 'pending'.
_IN_FLIGHT_JOB_STATUSES = frozenset({"running", "done_pending_children"})


def _resume_duplicate_job(
    *,
    supabase: Any,
    body: _ProcessKeyBody,
    strategy_id: Any,
    existing: dict[str, Any],
    correlation_id: str,
) -> tuple[bool, str]:
    """Make an idempotent hit's ``(queued, job_state)`` true, and return it.

    This is the fix for C-19: re-calling ``enqueue_compute_job`` on the
    duplicate path is safe because the RPC already dedupes on
    ``(target, kind)`` over non-terminal statuses and returns the existing id
    instead of inserting — so a live job is not duplicated, and a MISSING job
    (the wedge: the draft INSERT committed, the enqueue never ran) is created.
    That behaviour is a shared RPC's, with many other callers, so it is pinned
    by ``supabase/tests/test_enqueue_compute_job_dedupe_non_terminal.sql``
    rather than assumed.

    The RPC failure is deliberately NOT swallowed — it propagates exactly as it
    does on the fresh enqueue below. Reporting ``queued`` for an enqueue that
    raised would re-create the same lie in a new place.
    """
    if not _is_long_fetch(body):
        return False, "not_applicable"
    if existing.get("status") not in _RESUMABLE_VERIFICATION_STATUSES:
        return False, "not_applicable"

    job_id = supabase.rpc(
        "enqueue_compute_job",
        {
            "p_strategy_id": strategy_id,
            "p_kind": "process_key_long",
            "p_metadata": {
                "correlation_id": correlation_id,
                "verification_id": existing["id"],
                "flow_type": body.flow_type,
                "source": body.source,
            },
        },
    ).execute().data
    log.info(
        "process_key.duplicate_resumed",
        verification_id=existing["id"],
        job_id=str(job_id),
    )

    # The RPC returns only the job id, so read the state back to label it. This
    # read is LABEL-ONLY: the RPC returning an id already establishes that a
    # non-terminal job exists, so a failure here cannot make `queued` wrong —
    # it can only cost precision between the two true labels. Degrade to
    # "enqueued" with a WARN rather than failing an otherwise-correct reply.
    job_state = "enqueued"
    if job_id:
        try:
            job = one(
                supabase.table("compute_jobs")
                .select("status")
                .eq("id", job_id)
                .maybe_single()
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "process_key.duplicate_job_state_read_failed",
                error=str(exc)[:200],
                job_id=str(job_id),
            )
            job = None
        if job is not None and job.get("status") in _IN_FLIGHT_JOB_STATUSES:
            job_state = "running"
    return True, job_state


def _wizard_duplicate_reply(
    *,
    existing: dict[str, Any],
    correlation_id: str,
    queued: bool,
    job_state: str,
) -> dict[str, Any]:
    """The single WIZARD_DUPLICATE body, shared by BOTH emitters.

    There are two of them — the pre-check and the 23505 race-winner arm — and
    they drifted apart in every prior fix to this contract. One builder means a
    future change to the shape cannot land on one arm only.

    Status 200 (NOT 409) per the API-7 spec: idempotency is a feature, not a
    failure — hence `ok: True` (PYAPI-10a). `code` is present alongside it
    because "this was a duplicate" is a condition worth naming even on a
    success; the contract is `code` MUST be a non-empty string when `ok` is
    false, not that it is absent when `ok` is true.
    """
    return {
        "ok": True,
        "code": "WIZARD_DUPLICATE",
        "idempotent": True,
        "verification_id": existing["id"],
        "status": existing["status"],
        "trust_tier": existing.get("trust_tier"),
        "correlation_id": correlation_id,
        "queued": queued,
        "job_state": job_state,
    }


async def _run_validate_only(
    *,
    body: "_ProcessKeyBody",
    correlation_id: str,
    started_at: float,
) -> dict[str, Any] | JSONResponse:
    """CR-02 — pre-strategy validation flow.

    Runs only `adapter.validate()` (no DB insert, no state-machine
    transitions, no fingerprint/encryption). Used by the two wizard steps
    that fire BEFORE a strategy_verifications row exists:
      - keys/validate-and-encrypt (onboard step 2, context.step='validate')
      - strategies/csv-validate    (CSV step 1, context.step='validate')

    Returns the same envelope shape both legacy callers were already
    consuming (`{ ok, code, human_message, debug_context, ... }` for failure;
    `{ valid: true, ... }` for success), so the thin adapters do not need
    to branch on the flow shape.

    ⚠️ The return type widened to include ``JSONResponse`` for the
    WIZFORM-ABANDON transient arm below, which needs a STATUS as well as a
    body. Every pre-existing return is untouched and still a bare dict at 200.
    """
    submission = KeySubmissionRequest(
        flow_type=body.flow_type,
        source=body.source,
        context=body.context,
    )
    adapter = get_adapter(body.source)
    try:
        val = await adapter.validate(submission)
    except Mt5SessionAbandoned:
        # ⭐ WIZFORM-ABANDON / D-40. Until this arm existed, `adapter.validate`
        # here had NO enclosing try at all (ast-verified), and
        # `Mt5SessionAbandoned` is a plain `Exception` by design (D-42, so no
        # credential-classify arm anywhere can absorb an operator fault into a
        # user verdict) — so it left as an unhandled BODYLESS 500 on the wizard's
        # own validate-and-encrypt leg. Under STATUS_CONTRACT R-1 a 500 means
        # SERVICE-PERMANENT, "do not retry", the exact inverse of the truth: the
        # next submission simply gets a fresh lease.
        #
        # ⚠️ On the genuinely abandoned path nobody awaits this call, so the arm
        # never runs (D-39 — the sink's WARNING is the signal). It exists for the
        # FALSE-POSITIVE path: a legitimate submission that trips the fence must
        # be told "transient, retry", never that its credentials are wrong.
        #
        # Disposition is the route's EXISTING venue-transient shape — the 424
        # FAILED_DEPENDENCY / `recoverable: True` envelope the synchronous
        # pipeline's own pre-gate emits (PYAPIFIX-02 H-1). ⛔ No new user-facing
        # code is minted (153.1 owns that table): `NETWORK_UNAVAILABLE` is an
        # existing venue code, absent from both permanent allow-lists, and the
        # copy is the ONE shared transient string this service already uses at
        # every arm of this class. ⛔ Never a 4xx blaming credentials or the
        # broker server, and never a 500 with `retryable: false`.
        #
        # The log names the decision only — no host, port, terminal key,
        # generation number or credential (WIZFORM-03 / T-134-01).
        log.warning(
            "process_key.validate_only_session_abandoned",
            source=body.source,
            correlation_id=correlation_id,
            duration_ms=int((time.monotonic() - started_at) * 1000),
        )
        return JSONResponse(
            status_code=424,
            content=_envelope_error(
                "NETWORK_UNAVAILABLE",
                exchange_svc.NETWORK_ERROR_DETAIL,
                correlation_id,
                None,
                recoverable=True,
            ),
        )
    duration_ms = int((time.monotonic() - started_at) * 1000)
    if not val.valid:
        log.info(
            "process_key.validate_only_failed",
            error_code=val.error_code,
            duration_ms=duration_ms,
        )
        return _envelope_error(
            val.error_code, val.human_message, correlation_id, None
        )
    log.info("process_key.validate_only_ok", duration_ms=duration_ms)
    envelope: dict[str, Any] = {
        "ok": True,
        "valid": True,
        "read_only": val.read_only,
        "correlation_id": correlation_id,
        "step": "validate",
    }
    # Phase 19.1 fix (2026-05-27) — surface the CSV preview + normalized
    # daily-return series the wizard's CsvUploadStep requires. It raises
    # CSV_UPSTREAM_FAIL when `preview` is absent and forwards
    # `daily_returns_series` to csv-finalize. Only the CSV adapter populates
    # these; the API-key validate-only flow leaves them None, so the keys are
    # omitted and that envelope is unchanged.
    if val.preview is not None:
        envelope["preview"] = val.preview
    if val.daily_returns_series is not None:
        envelope["daily_returns_series"] = val.daily_returns_series
    return envelope


# ---------------------------------------------------------------------------
# POST /process-key
# ---------------------------------------------------------------------------


@router.post("", response_model=None)
# TWO stacked limits, evaluated in ONE pass (RESEARCH G-9): functools.wraps
# keeps __module__.__name__ identical, so both land under the same endpoint name
# and the outermost wrapper evaluates the whole list before setting
# request.state._rate_limiting_complete. Inner = per-identity (tenant / anon /
# unverified); outer = the platform ceiling. Both are pinned by live-TestClient
# tests because RESEARCH read slowapi 0.1.9 while production pins 0.1.10
# (ASSUMPTION-1) — if a patch bump broke stacking, one limit would silently
# never evaluate.
@limiter.limit(_process_key_limit_for, key_func=_process_key_rate_limit_key)
@limiter.limit(_process_key_ceiling_limit_for, key_func=_process_key_ceiling_key)
async def process_key(
    request: Request,
    body: Annotated[_ProcessKeyBody, Body()],
) -> dict[str, Any] | JSONResponse:
    # `Annotated[_ProcessKeyBody, Body()]` — explicit Body marker. Without it,
    # `from __future__ import annotations` (line 18) stringifies the type hint
    # to "_ProcessKeyBody", and FastAPI 0.115.x's body-vs-query auto-detection
    # falls back to query, producing 422s with `loc:["query","body"]`. Newer
    # fastapi (0.135.x) auto-detects the BaseModel correctly, but the pinned
    # version in requirements.txt does not — and this is the request-body
    # contract surface, so explicit beats implicit.
    #
    # Slowapi inspects the function signature for a parameter literally named
    # `request` (or `websocket`) to attach the limiter context — see
    # slowapi/extension.py:713. Renaming this parameter from `req` to
    # `request` is non-negotiable; the closer-spelled `req` raised
    # `Exception: No "request" or "websocket" argument on function`.
    _verify_internal_token(request)

    # 2026-05-27 — the client-supplied correlation id flows into structured
    # logs AND the UUID column strategy_verifications.correlation_id. Accept it
    # only if it is a well-formed UUID; otherwise mint one. This prevents
    # log-shaping via an unbounded/newline header and the empty-string-into-
    # UUID-column insert failure. The TS client always sends a UUID, so this is
    # a no-op for the real caller.
    _raw_cid = request.headers.get("X-Correlation-Id", "")
    try:
        correlation_id = str(uuid.UUID(str(_raw_cid)))
    except (ValueError, AttributeError, TypeError):
        correlation_id = str(uuid.uuid4())
    started_at = time.monotonic()

    structlog.contextvars.bind_contextvars(
        correlation_id=correlation_id,
        flow_type=body.flow_type,
        source=body.source,
    )
    log.info("process_key.start")

    # CT-4 (army2) — emit a structured WARN when a non-teaser flow lacks
    # the X-User-Id header. The Vercel thin adapters MUST forward it (see
    # src/lib/process-key-client.ts) so the 100/hour rate-limit window
    # buckets per-tenant. teaser is the public/unauthenticated landing
    # form and intentionally passes 'public' as a shared anon bucket.
    # If a future caller drops the header, this WARN keeps it visible in
    # observability before cross-tenant burst can starve other tenants.
    if (
        body.flow_type != "teaser"
        and request.headers.get("X-User-Id") is None
    ):
        log.warning(
            "process_key.x_user_id_header_missing",
            flow_type=body.flow_type,
            source=body.source,
            wizard_session_id=body.context.get("wizard_session_id"),
        )

    # Phase 106 (Stage B): the unified backbone is permanent-on. The former
    # BACKBONE-04/05 feature-flag gate (503 UNIFIED_BACKBONE_DISABLED when the
    # kill-switch read off) is deleted — the kill-switch row is inert and its
    # reader is gone. The body below now runs unconditionally; a row-off state
    # is unreachable by construction (there is no legacy route to fall back to).
    supabase = get_supabase()

    # H-2 — write audit row at entry (after the flag gate) so the
    # flag-monitor cron's denominator is non-zero on the served path.
    # Without this row, the cron computes errorRate = errorCount/0 = 0 and
    # never trips even at 100% Sentry error rate. Use the existing
    # log_audit_event_service RPC (migration 058) so the service-role client
    # can write without auth.uid(). Audit-write failure is non-fatal — the
    # request continues — but we log so a sustained outage surfaces in
    # Sentry (cron P7 also alerts when the denominator stays at 0 for >2
    # windows). We intentionally write AFTER the flag gate so the cron
    # measures only requests that actually traversed the unified backbone;
    # flag-off rejections should not inflate the denominator.
    #
    # WR-06 fix: audit_log.entity_id is NOT NULL (migration 010 line 72) and
    # log_audit_event_service raises when p_entity_id is NULL (migration 058
    # line 105-106). For validate-only flows (CR-02), strategy_id is absent
    # because the wizard step happens before strategy creation; fall back to
    # wizard_session_id (a UUID, schema-compatible with the entity_id UUID
    # column). The cron's denominator query keys on entity_type='process_key'
    # only, so the entity_id sentinel does not affect the rollback math.
    # PR-X5 / D7 (2026-05-15) — unify the API key ingestion path. Teaser
    # submissions arrive from the public landing page without a
    # caller-owned strategy (the user is probing keys against the
    # universe of published strategies; no strategy exists yet) AND
    # without a wizard_session_id (no wizard — single-shot submission).
    #
    # Inject BOTH here, BEFORE audit_entity_id is computed below, so the
    # H-2 audit row write does not fail with NULL p_entity_id (which
    # log_audit_event_service raises). That keeps teaser submissions in
    # the flag-monitor cron's denominator post-flag-flip, preserving the
    # auto-rollback math.
    #
    # SECURITY (PR-X5 review fix): override UNCONDITIONALLY for teaser.
    # The TS handler at src/app/api/verify-strategy/route.ts is supposed
    # to allowlist context fields (post-X5), but if a future change
    # regresses and spreads the raw body again, an unauthenticated
    # attacker could POST `{strategy_id:<victim-uuid>,
    # wizard_session_id:<chosen>}` and bypass a fill-if-null injection,
    # writing an SV row anchored to an arbitrary strategy. Treating
    # teaser as anchor-less by definition closes that hole at the
    # backend boundary regardless of upstream input shape.
    #
    # NO downstream branches on `flow_type == 'teaser'` — that would be
    # unification cosplay. The fingerprint write on the sentinel and
    # reconstruct_positions(trades) on a discarded return value are both
    # harmless side effects, so they run unmodified.
    #
    # The injected wizard_session_id is a fresh uuid4 per submission;
    # teaser submissions are deliberately NOT idempotent (each landing-
    # page submission is a separate verification, so a fresh UUID
    # always misses the SELECT-pre-check below and writes a new row).
    if body.flow_type == "teaser":
        body.context["strategy_id"] = TEASER_ANCHOR_STRATEGY_ID
        body.context["wizard_session_id"] = str(uuid.uuid4())

    audit_entity_id = (
        body.context.get("strategy_id") or body.context.get("wizard_session_id")
    )

    # I-SEC2 — emit a structured warning when context.user_id is missing on
    # a non-public flow. The teaser flow_type is intentionally
    # unauthenticated and runs without a user_id (the public homepage form
    # can be submitted by anyone). For onboard / resync / csv / internal_report
    # the wizard ALWAYS has an auth session, so a missing user_id signals a
    # caller misconfiguration that the cron's audit-log denominator cannot
    # subsequently disambiguate.
    if (
        body.context.get("user_id") is None
        and body.flow_type != "teaser"
    ):
        log.warning(
            "process_key.user_id_missing",
            flow_type=body.flow_type,
            source=body.source,
            wizard_session_id=body.context.get("wizard_session_id"),
        )

    # I-perf-3 — fire-and-forget the audit row write. The RPC is
    # best-effort (non-fatal on failure; the request continues either
    # way), so adding its RTT to the synchronous /process-key path is
    # pure latency tax. Wrapping in asyncio.to_thread + create_task
    # detaches the write from the response path; failures still surface
    # via structlog WARN inside the helper. We intentionally do NOT
    # await the resulting task — that would re-serialize.
    #
    # CT-8 (army2) — hold a strong reference to the Task in
    # `_audit_tasks` and add a done_callback to discard it on
    # completion. Pre-fix the bare `asyncio.create_task(...)` discarded
    # the return value; CPython holds only a WEAK ref so the GC could
    # collect the Task mid-flight, raising
    #   RuntimeError: Task was destroyed but it is pending!
    # and silently losing the audit row.

    def _write_audit_sync() -> None:
        try:
            supabase.rpc(
                "log_audit_event_service",
                {
                    "p_user_id": body.context.get("user_id"),
                    "p_action": "process_key.entry",
                    "p_entity_type": "process_key",
                    "p_entity_id": audit_entity_id,
                    "p_metadata": {
                        "flow_type": body.flow_type,
                        "source": body.source,
                        "correlation_id": correlation_id,
                        "entity_id_source": (
                            "strategy_id"
                            if body.context.get("strategy_id")
                            else "wizard_session_id"
                        ),
                    },
                },
            ).execute()
        except Exception as exc:  # noqa: BLE001
            log.warning("process_key.audit_write_failed", error=str(exc))

    _audit_task = asyncio.create_task(asyncio.to_thread(_write_audit_sync))
    _audit_tasks.add(_audit_task)
    _audit_task.add_done_callback(_audit_tasks.discard)

    submission = KeySubmissionRequest(
        flow_type=body.flow_type,
        source=body.source,
        context=body.context,
    )

    # strategy_verifications.wizard_session_id is NOT NULL. The wizard-driven
    # flows (onboard/csv finalize) always supply one, but `resync` via
    # /api/keys/sync carries no wizard_session_id (it re-syncs an existing
    # strategy, not a wizard session) -- so the draft insert below 23502'd with
    # a NULL wizard_session_id once resync got past the validator. Mint a fresh
    # uuid4 when absent (same pattern teaser uses above).
    wizard_session_id = body.context.get("wizard_session_id") or str(uuid.uuid4())

    # PYAPI-09d (Phase 140.1) — idempotency-by-session is available ONLY to a
    # flow that CARRIES a caller-supplied wizard_session_id.
    #
    # resync (/api/keys/sync sends `context: {strategy_id, user_id}` only) and
    # teaser (its session id is overwritten with a fresh uuid4 above) both run
    # on a SERVER-MINTED id, so their duplicate arm was unreachable by luck — a
    # fresh uuid4 never matches — rather than by construction. That left
    # `keys/sync/route.ts:438`'s `WIZARD_DUPLICATE` branch as dead code which
    # nonetheless documented a reachable state. Make it unreachable by
    # construction instead: a server-minted session id never consults, and
    # never emits, the idempotent-hit path. Each resync/teaser submission is
    # its own verification; downstream sync_trades enqueues still dedupe on
    # (strategy_id, kind).
    idempotent_by_session = body.flow_type != "teaser" and bool(
        body.context.get("wizard_session_id")
    )

    # CR-02 fix (REVIEW.md 2026-05-08): two flag-on entry routes do NOT carry
    # strategy_id because the wizard step runs BEFORE the strategy row exists:
    #   - keys/validate-and-encrypt (onboard wizard step 2, context.step="validate")
    #   - strategies/csv-validate    (CSV wizard step 1, context.step="validate")
    # The pre-fix `body.context["strategy_id"]` lookup raised KeyError on every
    # such call. We treat `step=="validate"` AND missing strategy_id as the
    # pre-strategy validation flow: run only adapter.validate() and return the
    # envelope without persisting a strategy_verifications row. The eventual
    # full pipeline runs later via finalize-wizard / verify-strategy once a
    # strategy_id has been allocated.
    step = body.context.get("step")
    strategy_id = body.context.get("strategy_id")
    if strategy_id is None:
        if step == "validate":
            return await _run_validate_only(
                body=body,
                correlation_id=correlation_id,
                started_at=started_at,
            )
        # ⛔ Phase 145 (D-06 option i-b, obligation 2) — the csv-finalize
        # branch that lived here (API-3, Phase 19.1 token forwarding, the
        # SEAMRIM-03 23505 resolve arm and its CR-01 name check) was DELETED.
        # The Next.js route now calls the folded SECURITY DEFINER
        # `finalize_csv_strategy_with_returns` RPC directly on its SSR
        # user-scoped client (migration 20260819120000; the founder decision
        # is recorded in .planning/phases/145-job-csv-finalize-atomicity/
        # 145-DECISION.md). Leaving this branch live would have been a second
        # writer to strategies/csv_daily_returns — a drift bomb. The 23505
        # resolve arm and the CR-01 identity checks moved into the route
        # (csv-finalize/route.ts, resolveExistingStrategyOrRefuse). A
        # flow_type='csv' step='finalize' request now deliberately falls
        # through to the API-6 422 below: this service no longer finalizes
        # CSV strategies, and answering anything else here would silently
        # re-open the second-writer path.
        #
        # API-6 — Phase 17 DESIGN-05 envelope (top-level code/human_message,
        # not nested under `detail`). The wizard's error renderer reads the
        # envelope shape directly off the response body.
        return JSONResponse(
            status_code=422,
            content=_envelope_error(
                "MISSING_STRATEGY_ID",
                (
                    "context.strategy_id is required for this flow_type. "
                    "Validate-only flows must set context.step='validate'."
                ),
                correlation_id,
                None,
            ),
        )
    # 1) Ownership gate (PYAPI-01e / C-08, Phase 140.1).
    #
    # From here down the handler reads and writes rows keyed on the
    # caller-supplied `strategy_id`. Assert the caller owns it BEFORE the first
    # such read, so a foreign strategy_id can never produce a row — not even
    # one the reply then echoes. teaser is exempt: it has no tenant, and its
    # strategy_id is force-overwritten with TEASER_ANCHOR_STRATEGY_ID above, so
    # there is nothing caller-supplied left to check.
    if body.flow_type != "teaser" and not _caller_owns_strategy(
        supabase, strategy_id, body.context.get("user_id")
    ):
        log.warning(
            "process_key.strategy_not_owned",
            flow_type=body.flow_type,
            source=body.source,
            strategy_id=strategy_id,
        )
        return JSONResponse(
            status_code=403,
            content=_envelope_error(
                "STRATEGY_NOT_OWNED",
                "context.strategy_id is not owned by context.user_id.",
                correlation_id,
                None,
            ),
        )

    # 2) Idempotency check (BACKBONE-08): the wizard_session_id UNIQUE INDEX.
    #
    # POSITION IS LOAD-BEARING (Phase 140.1, C-19/C-20 + PYAPI-01d). This block
    # used to run ~150 lines earlier, above the `strategy_id is None` branch,
    # which caused two distinct defects:
    #   (a) there was no strategy_id in scope yet, so the read could only
    #       filter on the caller-supplied wizard_session_id — a platform-global
    #       key — and returned another tenant's row on any collision;
    #   (b) it short-circuited EVERY flow, including the then-live csv-finalize
    #       delegate (deleted in Phase 145). Once the finalize RPC had written
    #       an SV row carrying that session id, every later csv call for the
    #       session hit this return instead of the finalize branch — a plain
    #       double-submit, no timeout needed.
    # Running it here fixes both: `strategy_id` exists (so the read key equals
    # the DB's `UNIQUE (strategy_id, wizard_session_id)` key), and the arms
    # that write no SV row at all — validate-only, and since Phase 145 the
    # csv step='finalize' 422 refusal — have already returned above.
    if idempotent_by_session:
        existing = one(
            supabase.table("strategy_verifications")
            .select("*")
            .eq("strategy_id", strategy_id)
            .eq("wizard_session_id", wizard_session_id)
            .maybe_single()
            .execute()
        )
        # `.maybe_single().execute()` returns None (NOT a response object with
        # data=None) when zero rows match — which is the normal case for a
        # brand-new upload (no prior strategy_verifications row for this
        # wizard_session_id). The pre-fix `if existing.data:` therefore raised
        # `AttributeError: 'NoneType' object has no attribute 'data'` and 500'd
        # the ENTIRE ingestion for every first-time upload once the
        # unified-backbone flag was flipped on. Guard the None: absent row →
        # not idempotent → fall through to the normal insert path below.
        if existing:
            log.info(
                "process_key.idempotent_hit",
                verification_id=existing["id"],
            )
            # API-7 — emit WIZARD_DUPLICATE so the wizard renders the
            # idempotent-resume affordance. Pre-fix this path returned a
            # plain happy-shape dict and the wizard had no observable
            # signal that the row pre-existed.
            #
            # PYAPI-09a: it also returned a hardcoded `queued: False` without
            # ever reaching the enqueue below, so a session whose draft INSERT
            # committed but whose enqueue never ran was told "duplicate, not
            # queued" on every subsequent retry — forever, with no state from
            # which it could recover. Resume the job first, then report what is
            # actually true.
            _queued, _job_state = _resume_duplicate_job(
                supabase=supabase,
                body=body,
                strategy_id=strategy_id,
                existing=existing,
                correlation_id=correlation_id,
            )
            return _wizard_duplicate_reply(
                existing=existing,
                correlation_id=correlation_id,
                queued=_queued,
                job_state=_job_state,
            )

    # 2b) SEAM-06 (Phase 141) — resync draft-SV dedup against a duplicate submit.
    #
    # ⚠️ WHAT THIS GUARD IS FOR HAS BEEN CORRECTED TWICE; READ THE CORRECTION
    # BEFORE REASONING FROM IT (141.2 / D-03). It was introduced as the thing
    # that made resync safe to REPLAY: Phase 141 added a bounded Vercel->Railway
    # seam retry and allowlisted resync for it ONLY on the strength of this
    # pre-check. Phase 141.1 re-derived that claim and found it false. Phase
    # 141.2 acted on the finding and WITHDREW the retry: the TypeScript seam
    # registry now carries a NO verdict for resync, so no resync retry is issued
    # at all, and the sentence below that used to say this "closes the
    # SEQUENTIAL retry class" is gone rather than merely softened.
    #
    # This guard still earns its place — it is defense-in-depth against a
    # DUPLICATE SUBMIT (a user or client re-issuing the sync) — but it is not an
    # idempotency key and must never again be cited as one.
    #
    # resync runs on a SERVER-MINTED wizard_session_id (:1018), so it is
    # `idempotent_by_session == False` by construction — the :1351 block above
    # never fires for it. Without this guard a seam retry that re-reaches the
    # handler mints a SECOND draft strategy_verifications row for the same
    # strategy (the compute_job is already deduped by
    # compute_jobs_one_inflight_per_kind_strategy; this closes the SV-row half).
    #
    # Structurally MIRRORS the :1351 idempotent-by-session block: SELECT the
    # existing draft resync row, and on a hit resume its compute_job and return
    # the SAME WIZARD_DUPLICATE body both onboard emitters use — one builder, so
    # the cross-process contract (keys/sync/route.ts:563-599 already translates
    # WIZARD_DUPLICATE + queued) cannot drift. The draft window mirrors the
    # compute_jobs dedup's non-terminal restriction: a FINISHED (non-draft)
    # resync verification is a genuinely new sync, not a retry.
    #
    # TENANT SCOPE (PYAPI-01d): this runs strictly AFTER the :1316 ownership
    # gate, so `strategy_id` has already passed the strategies id+user_id check
    # (140.1-02). Scoping this read by strategy_id therefore carries the tenant
    # scope — no wizard_session_id / user_id echo of a foreign row is possible.
    #
    # SCOPE BOUND (documented residual, restated 141.2 / D-03): this guard does
    # NOT make a resync replay safe, and the original text here claiming it
    # closed the SEQUENTIAL retry class was the over-claim that kept a retry
    # grant alive after the evidence for it had been withdrawn. The filter is
    # status='draft', and the compute worker's tick advances the first draft
    # verification OUT of draft — so a second attempt arriving after that
    # transition matches nothing here and inserts a second draft row. What the
    # guard does close is the case where the first attempt's draft is still IN
    # draft when a duplicate submit arrives. A CONCURRENT two-tab race (both
    # SELECTs pass before either INSERT; distinct server-minted uuid4s, so
    # neither 23505s on the session index) can still mint two drafts. Both
    # residuals are OUT of scope here: no new
    # migration and no new unique index (PATTERNS records the migration path as
    # the scope decision deliberately NOT taken); this is an application-level
    # SELECT-then-guarded-INSERT. `.limit(1)` keeps `.maybe_single()` from
    # raising on that rare two-draft residual rather than papering over it.
    if body.flow_type == "resync":
        existing_resync = one(
            supabase.table("strategy_verifications")
            .select("*")
            .eq("strategy_id", strategy_id)
            .eq("flow_type", "resync")
            .eq("status", "draft")
            .limit(1)
            .maybe_single()
            .execute()
        )
        if existing_resync:
            log.info(
                "process_key.resync_draft_dedup_hit",
                verification_id=existing_resync["id"],
            )
            _queued, _job_state = _resume_duplicate_job(
                supabase=supabase,
                body=body,
                strategy_id=strategy_id,
                existing=existing_resync,
                correlation_id=correlation_id,
            )
            return _wizard_duplicate_reply(
                existing=existing_resync,
                correlation_id=correlation_id,
                queued=_queued,
                job_state=_job_state,
            )

    trust_tier = "csv_uploaded" if body.source == "csv" else "api_verified"
    try:
        draft_insert = (
            supabase.table("strategy_verifications")
            .insert(
                {
                    "strategy_id": strategy_id,
                    "wizard_session_id": wizard_session_id,
                    "status": "draft",
                    "trust_tier": trust_tier,
                    "flow_type": body.flow_type,
                    "source": body.source,
                    "correlation_id": correlation_id,
                }
            )
            .execute()
        )
        verification_id = rows(draft_insert)[0]["id"]
    except Exception as exc:
        # Pitfall 2 — TOCTOU race: SELECT pre-check passed but INSERT loses
        # to a concurrent insert from another wizard tab. Catch SQLSTATE
        # 23505 and return the row that actually won the race.
        msg = str(exc)
        if "23505" in msg or "duplicate key" in msg.lower():
            # PYAPI-09d — a server-minted session id has no idempotent identity
            # (see `idempotent_by_session` above), so a 23505 on such a request
            # is NOT a wizard duplicate: it is a real constraint violation from
            # some other index, and returning someone's row for it would be a
            # fabricated success. Surface the original error.
            if not idempotent_by_session:
                raise
            # PYAPI-01d — the SECOND read site of the cross-tenant class, and
            # the more reachable one: with `UNIQUE (strategy_id,
            # wizard_session_id)` live, this is the arm a genuine collision
            # takes. It MUST carry the same tenant scope as the pre-check —
            # filtering on wizard_session_id alone would re-fetch, and echo,
            # another strategy's row.
            #
            # Re-fetch the row that won the race. Use maybe_single (returns
            # None on zero rows) rather than single (raises PGRST116): if a
            # TOCTOU delete / RLS hide between the failed insert and this
            # re-select leaves no row, we must surface the ORIGINAL 23505
            # rather than mask it with a cryptic None-deref or PGRST116 500.
            race_winner = one(
                supabase.table("strategy_verifications")
                .select("*")
                .eq("strategy_id", strategy_id)
                .eq("wizard_session_id", wizard_session_id)
                .maybe_single()
                .execute()
            )
            if not race_winner:
                raise
            log.info(
                "process_key.idempotent_race_resolved",
                verification_id=race_winner["id"],
            )
            # API-7 — race-resolved idempotent hit emits WIZARD_DUPLICATE
            # for the same reason as the SELECT-pre-check path above, and is
            # enqueue-aware for the same reason (PYAPI-09a): losing the insert
            # race says nothing about whether the winner's job was ever
            # enqueued, so this arm must resume it too. Both emitters go
            # through one builder so the contract cannot drift between them.
            _queued, _job_state = _resume_duplicate_job(
                supabase=supabase,
                body=body,
                strategy_id=strategy_id,
                existing=race_winner,
                correlation_id=correlation_id,
            )
            return _wizard_duplicate_reply(
                existing=race_winner,
                correlation_id=correlation_id,
                queued=_queued,
                job_state=_job_state,
            )
        raise

    # 3) Long-fetch dispatch (BACKBONE-09) — onboard/resync go to worker dyno.
    if _is_long_fetch(body):
        supabase.rpc(
            "enqueue_compute_job",
            {
                "p_strategy_id": strategy_id,
                "p_kind": "process_key_long",
                "p_metadata": {
                    "correlation_id": correlation_id,
                    "verification_id": verification_id,
                    "flow_type": body.flow_type,
                    "source": body.source,
                },
            },
        ).execute()
        log.info("process_key.queued", verification_id=verification_id)
        return {
            # PYAPI-10a — accepting the session for the worker is a success.
            "ok": True,
            "queued": True,
            "verification_id": verification_id,
            "correlation_id": correlation_id,
        }

    # 4) Synchronous pipeline (teaser / csv / internal_report).
    adapter = get_adapter(body.source)

    # validate
    try:
        val = await adapter.validate(submission)
    except Mt5SessionAbandoned:
        # ⭐ WIZFORM-ABANDON / D-40 — the SECOND unguarded `adapter.validate`
        # site, and it is covered because the class is "an unguarded validate
        # call site", not "the one an author had in mind". See
        # `_run_validate_only`'s arm above for the full rationale; the
        # disposition is the SAME shape this function already emits ~40 lines
        # below at its PYAPIFIX-02 venue-transient pre-gate — 424 with
        # `recoverable` STATED rather than derived, and no new code minted.
        #
        # ⚠️ Not reachable by an mt5 body TODAY: `mt5` is admitted to
        # `onboard`/`resync` only (MT5RECON-01) and both are long-fetch, so they
        # return at the enqueue above. Written anyway — an instance fix at the
        # first site alone leaves this one open the day any lease-taking adapter
        # is admitted to a synchronous flow, and the wizard would then meet the
        # bodyless 500 this phase exists to remove.
        #
        # ⛔ NO `transition_strategy_verification` to 'draft' with an errors
        # array, unlike the scope-rejection arm below. That transition RECORDS A
        # VERDICT about the caller's key on their verification row; there is no
        # verdict here, because the terminal was never read. Leaving the row in
        # its current state is what makes an identical retry able to succeed.
        log.warning(
            "process_key.validate_session_abandoned",
            source=body.source,
            verification_id=verification_id,
            correlation_id=correlation_id,
        )
        return JSONResponse(
            status_code=424,
            content=_envelope_error(
                "NETWORK_UNAVAILABLE",
                exchange_svc.NETWORK_ERROR_DETAIL,
                correlation_id,
                verification_id,
                recoverable=True,
            ),
        )
    # Unified rejection gate: covers both ordinary validation failures
    # (not val.valid — e.g. AUTH_FAILED, PERMISSION_DENIED) and
    # NEW-C31-01: write-capable key scope violations that must be caught
    # BEFORE any encryption step. The read_only arm only blocks on
    # explicit False — None (CSV, scope not applicable) is not rejected.
    # The error_code arm fires even when read_only is True (IMP-2: a
    # broker that sets a scope error_code without clearing read_only=True
    # must still be rejected — see test "error_code_wins").
    _scope_rejected = (
        not val.valid
        or val.read_only is False
        or val.error_code in {"TRADE_SCOPE", "WITHDRAW_SCOPE"}
    )
    if _scope_rejected:
        # SF-2: use VALIDATION_UNEXPECTED as the fallback — it is a registered
        # WizardErrorCode (adapter.py:74) and has defined copy in wizardErrors.ts.
        # "VALIDATION_FAILED" is not registered and causes a silent blank wizard
        # error state when the frontend lookup returns undefined.
        _reject_code = val.error_code or "VALIDATION_UNEXPECTED"
        # SF-1: security-sensitive scope rejections must be observable in the
        # structlog stream so operators can detect regressions / anomalies.
        log.warning(
            "process_key.write_capable_key_rejected",
            reject_code=_reject_code,
            read_only=val.read_only,
            verification_id=verification_id,
            correlation_id=correlation_id,
        )
        # SF-3: wrap the RPC call so a Supabase failure does not replace the
        # security-correct envelope error with an unexpected 500. Best-effort
        # status transition: returning the error to the caller is more
        # important than atomicity with the DB state machine.
        try:
            supabase.rpc(
                "transition_strategy_verification",
                {
                    "p_verification_id": verification_id,
                    "p_new_status": "draft",
                    "p_metadata": {
                        "errors": [
                            {
                                "code": _reject_code,
                                "human_message": val.human_message,
                            }
                        ]
                    },
                },
            ).execute()
        except Exception as _rpc_err:
            log.error(
                "process_key.scope_rejection_rpc_failed",
                reject_code=_reject_code,
                verification_id=verification_id,
                correlation_id=correlation_id,
                error=str(_rpc_err),
            )
        # PYAPIFIX-02 (H-1, Phase 140.1.1) — VENUE-TRANSIENT PRE-GATE. This
        # MUST precede the 403 return below, mirroring long_fetch.py:296-319
        # where the transient escape comes first and the scope verdict second.
        #
        # The gate above fires on `read_only is False`, and
        # services/exchange.py derives read_only=False from the fail-CLOSED
        # {read:T, trade:T, withdraw:T} default whenever the permission probe
        # hit a network / WAF / exchange-5xx failure (DOGFOOD-3) — those scopes
        # are NOT evidence. Delivering that as 403 tells the caller their
        # credentials are at fault and that an identical retry cannot succeed,
        # when the truth is that their exchange blipped and a retry WOULD
        # succeed. 424 FAILED_DEPENDENCY is the UPSTREAM-TRANSIENT class
        # (STATUS_CONTRACT R-1): not the caller's fault, retry can succeed,
        # still 4xx and therefore breaker-inert.
        #
        # The condition is an ALLOW-LIST of PERMANENT codes defaulting to
        # transient, never a denylist of transient ones. A denylist fails
        # UNSAFE — a venue code nobody remembered to list becomes a permanent
        # credential accusation — and is literally the shape of the defect
        # being closed here. A caller-fault code must be NAMED in the shared
        # allow-list (services/exchange.py) to stay on the 403 path.
        #
        # `val.error_code is not None` keeps OUR OWN VALIDATION_UNEXPECTED
        # fallback on the permanent path: no error_code at all means the
        # adapter confirmed a write-capable key and had no scope code to name
        # it, which is a caller fault. An ADAPTER-set VALIDATION_UNEXPECTED may
        # be a transient exchange error and does escape here — the same
        # distinction long_fetch draws with `_is_unexpected_fallback`.
        if (
            val.error_code is not None
            and val.error_code
            not in exchange_svc.PERMANENT_VALIDATION_ERROR_CODES
        ):
            log.warning(
                "process_key.venue_transient_validation",
                reject_code=_reject_code,
                read_only=val.read_only,
                verification_id=verification_id,
                correlation_id=correlation_id,
            )
            # recoverable is STATED, not derived: everything reaching this arm
            # is retryable by construction — that is what selected the arm.
            # The envelope key set is identical to the 403 return below.
            return JSONResponse(
                status_code=424,
                content=_envelope_error(
                    _reject_code,
                    val.human_message,
                    correlation_id,
                    verification_id,
                    recoverable=True,
                ),
            )

        # PYAPI-10b (C-22, Phase 140.1) — this is a VERDICT about the caller's
        # credentials, and it used to be delivered as HTTP 200 with ok:false. A
        # consumer that branches on the status line alone — which TRAP-2 says it
        # may have to, since an unhandled fault is a bodyless 500 — read that as
        # "your write-capable key was accepted". 403 per PYAPI-05's CALLER class:
        # the caller's credentials are at fault, nothing of ours failed, an
        # identical retry cannot succeed, and a 4xx is breaker-inert.
        #
        # The gate above is deliberately unified, so this covers ordinary
        # validation failures (`not val.valid` — AUTH_FAILED, PERMISSION_DENIED,
        # a malformed CSV) as well as the two scope arms. They are all
        # caller-credential/input faults, and one return site means the security
        # arm cannot drift back to a success status while the others move.
        #
        # The body is unchanged: the route's own top-level DESIGN-05 envelope,
        # not error_contract's `body.detail` one. Same envelope as the 401/422
        # arms above, wrapped the same way.
        return JSONResponse(
            status_code=403,
            content=_envelope_error(
                _reject_code, val.human_message, correlation_id, verification_id
            ),
        )

    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "validated",
            "p_metadata": {},
        },
    ).execute()

    # fetch_raw
    trades = await adapter.fetch_raw(body.context)

    # compute_metrics
    metrics = adapter.compute_metrics(trades)

    # PR-X5 (2026-05-15) — Enrich metrics_snapshot with the legacy
    # verify_strategy response shape so the landing-page card
    # (src/components/landing/VerificationSection.tsx::VerificationResultData)
    # renders fully for every flow_type. Pre-X5 the unified pipeline
    # only persisted MetricsSnapshot fields (sharpe/twr/ytd/...),
    # missing return_24h/mtd, equity_curve, and matched_strategy_id —
    # the legacy verify_strategy (portfolio.py:1055-1063) computed all
    # of them. D7 unification: enrichment runs for ALL flow_types so the
    # SV row's metrics_snapshot column has the same shape regardless of
    # how the row was created.
    #
    # account_balance is None here (the unified adapter pipeline doesn't
    # fetch USDT balance — that's an exchange-API call the legacy path
    # makes via fetch_usdt_balance). trades_to_daily_returns falls back
    # to the heuristic-capital path documented in services/transforms.py
    # (degrades 5–10× on volatile strategies). Same fallback the legacy
    # path uses when fetch_usdt_balance fails — no regression vs status
    # quo. Wiring real balance is a follow-up that touches the adapter
    # Protocol.
    enriched_metrics_snapshot: dict[str, Any] = _metrics_to_jsonb(metrics)
    # Phase 105.1-01 (D1): the EquityCurveBuilder's return-based scalars
    # (twr/sharpe/ytd/max_drawdown) are DEAD — computed off the backbone, they
    # must NEVER persist. Pre-null them here so EVERY path below (success,
    # derive ValueError, len<2, or the best-effort generic except) leaves them
    # None unless the derive-backed override sets them. The builder now serves
    # ONLY trade-level stats (total_pnl/trade_count/win_rate — D5) and the
    # compute_fingerprint(trades, metrics) call at :973 (so `metrics` itself is
    # left intact).
    enriched_metrics_snapshot.update(
        {"twr": None, "sharpe": None, "ytd": None, "max_drawdown": None}
    )
    matched_strategy_id: str | None = None
    try:
        from services.portfolio_metrics import compute_period_returns
        from services.strategy_matching import find_matched_strategy
        from services.transforms import trades_to_daily_returns

        trades_as_dicts = [_trade_to_dict(t) for t in trades]
        returns = trades_to_daily_returns(
            trades_as_dicts, account_balance=None
        )
        # The len<2 pre-check guards None/empty PRE-sanitize; derive's ValueError
        # guards <2 FINITE rows POST-sanitize (basis_series.py:225-228) — two
        # different boundaries that share the ONE degrade-to-nulls arm (D6). The
        # four return-based snapshot keys are already pre-nulled above, so the
        # degrade path only needs to null the five legacy landing-card keys.
        if returns is not None and len(returns) >= 2:
            try:
                four_keys, equity_curve = _derive_return_scalars(
                    returns,
                    _resolve_asset_class(body.source, strategy_id, supabase),
                )
            except ValueError as exc:
                # D6: <2 FINITE returns after sanitize → same degrade arm as len<2.
                # Fail-loud (M2, Fable red team): compute_all_metrics also raises
                # ValueError on BUG-class conditions (non-monotonic index, unknown
                # convention, a pandas/quantstats regression) — without this line a
                # real bug would render every public teaser all-dashes with zero
                # signal, indistinguishable from a genuine <2-day-history degrade.
                log.warning(
                    "process_key.derive_return_scalars_degraded",
                    error=str(exc)[:200],
                    verification_id=verification_id,
                )
                enriched_metrics_snapshot.update(_LEGACY_NULL_ENRICHMENT)
            else:
                # Backbone-derived scalars FIRST (D5) so a later period-returns
                # or matching exception can never strand the builder values —
                # the four keys stay pre-nulled if this update never ran.
                enriched_metrics_snapshot.update(four_keys)
                period_returns = compute_period_returns(returns)
                matched_strategy_id = find_matched_strategy(returns, supabase)
                enriched_metrics_snapshot.update(
                    {
                        "return_24h": period_returns.get("return_24h"),
                        "return_mtd": period_returns.get("return_mtd"),
                        "return_ytd": period_returns.get("return_ytd"),
                        # equity_curve re-sourced from the SAME derived series
                        # the scalars derive from (D1 honesty condition c).
                        "equity_curve": equity_curve,
                        "matched_strategy_id": matched_strategy_id,
                    }
                )
        else:
            # Insufficient trade history — null out the legacy-shape fields so
            # the landing-page card explicitly renders dashes rather than
            # silently omitting the keys (the four snapshot keys are already
            # pre-nulled above).
            enriched_metrics_snapshot.update(_LEGACY_NULL_ENRICHMENT)
    except Exception as exc:  # noqa: BLE001
        # Enrichment is best-effort. If the pandas math or the matching
        # SELECT raises, persist the base MetricsSnapshot shape and let
        # the user see partial data rather than failing the entire
        # verification. Same precedent as the legacy verify_strategy's
        # try/except around find_matched_strategy (portfolio.py:1052).
        # Post-pre-null this can no longer persist off-backbone builder
        # scalars — the four return-based keys are already None here.
        # LW-01 (Fable code-review): the four scalars are applied BEFORE
        # find_matched_strategy/compute_period_returns (D5 ordering), so a raise
        # there would otherwise leave the 5 legacy keys ABSENT (a "scalars-present,
        # curve-absent" card) instead of the explicit-dashes contract the two inner
        # degrade arms uphold. Null them here too so every degrade path is uniform.
        enriched_metrics_snapshot.update(_LEGACY_NULL_ENRICHMENT)
        log.warning(
            "process_key.enrichment_failed",
            error=str(exc)[:200],
            verification_id=verification_id,
        )

    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "metrics_captured",
            "p_metadata": {"metrics_snapshot": enriched_metrics_snapshot},
        },
    ).execute()

    # encrypt_credentials (API path only)
    encrypted: dict[str, Any] | None = None
    if body.source != "csv":
        from services.encryption import encrypt_credentials, get_kek

        encrypted = encrypt_credentials(
            body.context["api_key"],
            body.context["api_secret"],
            body.context.get("passphrase"),
            get_kek(),
        )
    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "encrypted",
            "p_metadata": {"encrypted_credentials": encrypted}
            if encrypted
            else {},
        },
    ).execute()

    # compute_fingerprint + persist on strategies row
    fp = adapter.compute_fingerprint(trades, metrics)
    supabase.table("strategies").update({"fingerprint": fp.to_jsonb()}).eq(
        "id", strategy_id
    ).execute()

    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "report_queued",
            "p_metadata": {},
        },
    ).execute()

    # reconstruct_positions (BACKBONE-09 wiring); persisted in P8.
    await adapter.reconstruct_positions(trades)

    # Final transition
    supabase.rpc(
        "transition_strategy_verification",
        {
            "p_verification_id": verification_id,
            "p_new_status": "published",
            "p_metadata": {},
        },
    ).execute()

    duration_ms = int((time.monotonic() - started_at) * 1000)
    log.info(
        "process_key.complete",
        verification_id=verification_id,
        duration_ms=duration_ms,
    )

    return {
        # PYAPI-10a — the shape consumers used to SNIFF (they keyed on
        # `verification_id` being present: verify-strategy/route.ts:197-198,
        # csv-finalize/route.ts:1213-1214). `code` is an explicit null rather
        # than an absent key: this terminal success names no sub-condition, and
        # making the absence explicit means a consumer reading `body.code` on
        # the one shape it used to sniff never gets `undefined`.
        "ok": True,
        "code": None,
        "verification_id": verification_id,
        "status": "published",
        "trust_tier": trust_tier,
        # PR-X5 — return the enriched snapshot (with return_24h/mtd/ytd,
        # equity_curve, matched_strategy_id) so the response shape
        # mirrors the SV row's metrics_snapshot column. Mirrors the
        # legacy verify_strategy's `results` payload shape.
        "metrics_snapshot": enriched_metrics_snapshot,
        # PR-X5 — top-level matched_strategy_id matches the legacy
        # verify_strategy response shape (portfolio.py:1075). The TS
        # legacy handler at src/app/api/verify-strategy/route.ts already
        # folds it into metrics_snapshot when stamping the SV row;
        # unified callers can read either location.
        "matched_strategy_id": matched_strategy_id,
        "fingerprint": fp.to_jsonb(),
        "encrypted_credentials": encrypted,
        "errors": [],
        "correlation_id": correlation_id,
    }
