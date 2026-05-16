import math
from pydantic import BaseModel, field_validator
from typing import Optional


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
