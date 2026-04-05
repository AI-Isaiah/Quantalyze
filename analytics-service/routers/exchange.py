import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from models.schemas import ValidateKeyRequest, FetchTradesRequest
from services.exchange import create_exchange, validate_key_permissions, fetch_all_trades
from services.encryption import encrypt_credentials, decrypt_credentials, get_kek, get_kek_version
from services.db import get_supabase, db_execute
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["exchange"])
logger = logging.getLogger("quantalyze.analytics")


class EncryptKeyRequest(BaseModel):
    exchange: str
    api_key: str
    api_secret: str
    passphrase: str | None = None


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


@router.post("/encrypt-key")
async def encrypt_key(req: EncryptKeyRequest):
    """Encrypt exchange credentials for storage. Returns encrypted fields to store in Supabase."""
    try:
        kek = get_kek()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Encryption not configured")

    encrypted = encrypt_credentials(req.api_key, req.api_secret, req.passphrase, kek)
    return encrypted


@router.post("/fetch-trades")
async def fetch_trades(req: FetchTradesRequest):
    """Fetch trades from exchange for a strategy using stored encrypted API key."""
    try:
        kek = get_kek()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Encryption not configured")

    supabase = get_supabase()

    # Look up strategy
    strategy_result = supabase.table("strategies").select("id, user_id, api_key_id").eq(
        "id", req.strategy_id
    ).single().execute()

    if not strategy_result.data or not strategy_result.data.get("api_key_id"):
        raise HTTPException(status_code=400, detail="Strategy has no connected API key")

    # Fetch encrypted API key
    api_key_row = supabase.table("api_keys").select("*").eq(
        "id", strategy_result.data["api_key_id"]
    ).single().execute()

    if not api_key_row.data:
        raise HTTPException(status_code=404, detail="API key not found")

    key_data = api_key_row.data

    # Decrypt credentials
    try:
        api_key, api_secret, passphrase = decrypt_credentials(key_data, kek)
    except Exception:
        logger.error("Failed to decrypt API key %s", key_data["id"])
        raise HTTPException(status_code=500, detail="Failed to decrypt credentials")

    exchange = create_exchange(key_data["exchange"], api_key, api_secret, passphrase)

    # Use last_sync_at to avoid re-fetching old trades
    since_ms = None
    if key_data.get("last_sync_at"):
        try:
            dt = datetime.fromisoformat(key_data["last_sync_at"].replace("Z", "+00:00"))
            since_ms = int(dt.timestamp() * 1000)
        except Exception:
            pass

    try:
        trades = await fetch_all_trades(exchange, since_ms=since_ms)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to fetch trades from exchange")
    finally:
        await exchange.close()

    # Store trades (upsert to avoid duplicates on re-sync)
    if trades:
        for batch_start in range(0, len(trades), 500):
            batch = trades[batch_start:batch_start + 500]
            supabase.table("trades").upsert(
                [{"strategy_id": req.strategy_id, **t} for t in batch],
                on_conflict="strategy_id,exchange,symbol,timestamp,side",
            ).execute()

        supabase.table("api_keys").update({
            "last_sync_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", key_data["id"]).execute()

    return {"trades_fetched": len(trades), "strategy_id": req.strategy_id}
