import logging
from fastapi import APIRouter, HTTPException
from models.schemas import ValidateKeyRequest, FetchTradesRequest
from services.exchange import create_exchange, validate_key_permissions, fetch_all_trades
import os
from supabase import create_client

router = APIRouter(prefix="/api", tags=["exchange"])
logger = logging.getLogger("quantalyze.analytics")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


@router.post("/validate-key")
async def validate_key(req: ValidateKeyRequest):
    """Validate that an API key is read-only and functional."""
    exchange = create_exchange(req.exchange, req.api_key, req.api_secret, req.passphrase)

    try:
        result = await validate_key_permissions(exchange)
    except Exception:
        raise HTTPException(status_code=500, detail="Key validation failed")
    finally:
        await exchange.close()

    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return {"valid": result["valid"], "read_only": result["read_only"]}


@router.post("/fetch-trades")
async def fetch_trades(req: FetchTradesRequest):
    """Fetch trades from exchange for a strategy (using stored API key)."""
    # Encryption not yet implemented. Block until it is.
    raise HTTPException(
        status_code=501,
        detail="Trade fetching is not yet available. API key encryption must be implemented first."
    )
