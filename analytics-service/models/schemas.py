from pydantic import BaseModel
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
    weights: Optional[dict] = None  # Custom optimizer weights


class VerifyStrategyRequest(BaseModel):
    email: str
    exchange: str  # binance, okx, bybit
    api_key: str
    api_secret: str
    passphrase: Optional[str] = None  # OKX only
