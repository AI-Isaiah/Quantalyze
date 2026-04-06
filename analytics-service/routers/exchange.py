import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from models.schemas import ValidateKeyRequest, FetchTradesRequest
from services.exchange import create_exchange, validate_key_permissions, fetch_all_trades
from services.encryption import encrypt_credentials, decrypt_credentials, get_kek, get_kek_version
from services.db import get_supabase, db_execute
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["exchange"])
logger = logging.getLogger("quantalyze.analytics")
limiter = Limiter(key_func=get_remote_address)


class EncryptKeyRequest(BaseModel):
    exchange: str
    api_key: str
    api_secret: str
    passphrase: str | None = None


@router.post("/validate-key")
@limiter.limit("100/hour")
async def validate_key(request: Request, req: ValidateKeyRequest):
    """Validate that an API key is read-only and functional."""
    try:
        exchange = create_exchange(req.exchange, req.api_key, req.api_secret, req.passphrase)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to initialize exchange connection")

    try:
        result = await validate_key_permissions(exchange)
    except Exception as e:
        logger.error("Key validation error: %s", str(e))
        raise HTTPException(status_code=500, detail="Key validation failed. Please check your credentials.")
    finally:
        try:
            await exchange.close()
        except Exception:
            pass

    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return {"valid": result["valid"], "read_only": result["read_only"]}


@router.post("/encrypt-key")
@limiter.limit("100/hour")
async def encrypt_key(request: Request, req: EncryptKeyRequest):
    """Encrypt exchange credentials for storage. Returns encrypted fields to store in Supabase."""
    try:
        kek = get_kek()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Encryption not configured")

    encrypted = encrypt_credentials(req.api_key, req.api_secret, req.passphrase, kek)
    return encrypted


@router.post("/fetch-trades")
@limiter.limit("10/hour")
async def fetch_trades(request: Request, req: FetchTradesRequest):
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

    # Fetch encrypted API key and verify ownership
    api_key_row = supabase.table("api_keys").select("*").eq(
        "id", strategy_result.data["api_key_id"]
    ).single().execute()

    if not api_key_row.data:
        raise HTTPException(status_code=404, detail="API key not found")

    # Verify the API key belongs to the same user as the strategy
    if api_key_row.data.get("user_id") != strategy_result.data.get("user_id"):
        raise HTTPException(status_code=403, detail="API key does not belong to strategy owner")

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

        # Fetch account balance for accurate capital estimation
        account_balance = None
        try:
            balance = await exchange.fetch_balance()
            # Get total USDT equivalent balance
            usdt_total = balance.get("total", {}).get("USDT", 0)
            if usdt_total and float(usdt_total) > 0:
                account_balance = float(usdt_total)
                logger.info("Fetched account balance: %.2f USDT", account_balance)
        except Exception as e:
            logger.warning("Could not fetch account balance: %s", str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to fetch trades from exchange")
    finally:
        await exchange.close()

    # Store trades atomically with advisory lock (prevents concurrent sync race)
    if trades:
        import json as _json
        trades_json = _json.dumps(trades, default=str)

        result = supabase.rpc("sync_trades", {
            "p_strategy_id": req.strategy_id,
            "p_trades": trades_json,
        }).execute()
        logger.info("Synced %s trades for strategy %s (atomic)", result.data, req.strategy_id)

        update_data: dict = {"last_sync_at": datetime.now(timezone.utc).isoformat()}
        if account_balance is not None:
            update_data["account_balance_usdt"] = account_balance
        supabase.table("api_keys").update(update_data).eq("id", key_data["id"]).execute()

    return {"trades_fetched": len(trades), "strategy_id": req.strategy_id}
