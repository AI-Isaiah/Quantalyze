import math
from pydantic import BaseModel, ConfigDict, field_validator
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


class PortfolioAnalyticsRequest(BaseModel):
    portfolio_id: str


class PortfolioOptimizerRequest(BaseModel):
    portfolio_id: str
    # Custom optimizer weights, keyed by strategy_id. Validated by the
    # field_validator below + the handler's per-portfolio key-scoping.
    # Audit 2026-05-07 H-0589: an unvalidated dict allowed NaN/Inf/string
    # values to propagate through numpy and corrupt optimizer_suggestions.
    weights: Optional[dict[str, float]] = None

    @field_validator("weights")
    @classmethod
    def _validate_weights(cls, v: Optional[dict]) -> Optional[dict]:
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
    user_id: str


class VerifyStrategyRequest(BaseModel):
    email: str
    exchange: str  # binance, okx, bybit
    api_key: str
    api_secret: str
    passphrase: Optional[str] = None  # OKX only


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
    # The four known outcomes after the audit-2026-05-07 H-0582 split.
    # Declared as Literal so the OpenAPI schema documents the enum and
    # typed-SDK consumers can switch on it (review API-3).
    matching_status: Optional[
        Literal["matched", "no_match", "matching_unavailable"]
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
