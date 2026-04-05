from fastapi import APIRouter, HTTPException
from models.schemas import ValidateKeyRequest, FetchTradesRequest
from services.exchange import create_exchange, validate_key_permissions, fetch_all_trades
import os
from supabase import create_client

router = APIRouter(prefix="/api", tags=["exchange"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


@router.post("/validate-key")
async def validate_key(req: ValidateKeyRequest):
    """Validate that an API key is read-only and functional."""
    exchange = create_exchange(req.exchange, req.api_key, req.api_secret, req.passphrase)

    try:
        result = await validate_key_permissions(exchange)
    finally:
        await exchange.close()

    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return {"valid": result["valid"], "read_only": result["read_only"]}


@router.post("/fetch-trades")
async def fetch_trades(req: FetchTradesRequest):
    """Fetch trades from exchange for a strategy (using stored API key)."""
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Look up the strategy and its API key
    strategy = supabase.table("strategies").select("api_key_id").eq(
        "id", req.strategy_id
    ).single().execute()

    if not strategy.data or not strategy.data.get("api_key_id"):
        raise HTTPException(status_code=400, detail="Strategy has no connected API key")

    api_key_row = supabase.table("api_keys").select("*").eq(
        "id", strategy.data["api_key_id"]
    ).single().execute()

    if not api_key_row.data:
        raise HTTPException(status_code=404, detail="API key not found")

    key_data = api_key_row.data

    # TODO: Decrypt key_data using envelope encryption (DEK + KEK)
    # For now, this is a placeholder showing the data flow
    exchange = create_exchange(
        key_data["exchange"],
        key_data.get("api_key_encrypted", ""),  # Would be decrypted
        key_data.get("api_secret_encrypted", ""),  # Would be decrypted
        key_data.get("passphrase_encrypted"),  # Would be decrypted
    )

    try:
        trades = await fetch_all_trades(exchange)
    finally:
        await exchange.close()

    # Store trades in database
    if trades:
        supabase.table("trades").upsert(
            [{"strategy_id": req.strategy_id, **t} for t in trades],
        ).execute()

        # Update last_sync
        supabase.table("api_keys").update({
            "last_sync_at": "now()"
        }).eq("id", key_data["id"]).execute()

    return {"trades_fetched": len(trades), "strategy_id": req.strategy_id}
