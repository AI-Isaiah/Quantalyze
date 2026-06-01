import logging
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from models.schemas import ValidateKeyRequest, FetchTradesRequest
from services.exchange import create_exchange, validate_key_permissions, fetch_all_trades, parse_since_ms, fetch_usdt_balance
from services.encryption import encrypt_credentials, decrypt_credentials, get_kek, get_kek_version
from services.db import get_supabase, db_execute, one, rows
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
async def validate_key(request: Request, req: ValidateKeyRequest) -> dict[str, Any]:
    """Validate that an API key is read-only and functional.

    Phase 18 / observability: the swallowed ccxt exception classes are
    now logged via `logger.exception` so Railway logs surface the actual
    upstream error (e.g., `ccxt.PermissionDenied: 451 Unavailable`) with
    full traceback. User-facing `detail` strings are unchanged so the
    Next.js classifier in `/api/strategies/create-with-key` and the
    wizard envelope wording remain stable. (Pre-fix: a bare `except
    Exception:` discarded the ccxt class + message, leaving operators
    debug-blind on the recurring "code: UNKNOWN" wizard fail. Found
    2026-05-05 via Bybit E2E + Railway log archaeology.)
    """
    try:
        exchange = create_exchange(req.exchange, req.api_key, req.api_secret, req.passphrase)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "validate_key: create_exchange(%s) failed — %s: %s",
            req.exchange,
            type(e).__name__,
            e,
        )
        raise HTTPException(status_code=400, detail="Failed to initialize exchange connection")

    try:
        result = await validate_key_permissions(exchange)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "validate_key: validate_key_permissions raised on %s — %s: %s",
            req.exchange,
            type(e).__name__,
            e,
        )
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
async def encrypt_key(request: Request, req: EncryptKeyRequest) -> dict[str, Any]:
    """Encrypt exchange credentials for storage. Returns encrypted fields to store in Supabase."""
    try:
        kek = get_kek()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Encryption not configured")

    encrypted = encrypt_credentials(req.api_key, req.api_secret, req.passphrase, kek)
    return encrypted


@router.post("/fetch-trades")
@limiter.limit("10/hour")
async def fetch_trades(request: Request, req: FetchTradesRequest) -> dict[str, Any]:
    """Fetch trades from exchange for a strategy using stored encrypted API key."""
    try:
        kek = get_kek()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Encryption not configured")

    supabase = get_supabase()

    # Look up strategy
    strategy_result = one(supabase.table("strategies").select("id, user_id, api_key_id").eq(
        "id", req.strategy_id
    ).single().execute())

    if not strategy_result or not strategy_result.get("api_key_id"):
        raise HTTPException(status_code=400, detail="Strategy has no connected API key")

    # Fetch encrypted API key and verify ownership.
    #
    # C-0202 (audit-2026-05-07) — filter on is_active=True. A deactivated
    # key (user revoked, admin disabled, sole-source purge) must NOT be
    # usable by /fetch-trades; otherwise the deactivation gate becomes a
    # paper-only control. .single() returns no row when the filter rejects,
    # and the existing 404 below fires with an operator-safe message
    # (doesn't disclose that the key exists but is deactivated).
    api_key_row = one(supabase.table("api_keys").select("*").eq(
        "id", strategy_result["api_key_id"]
    ).eq("is_active", True).single().execute())

    if not api_key_row:
        raise HTTPException(status_code=404, detail="API key not found")

    # Verify the API key belongs to the same user as the strategy
    if api_key_row.get("user_id") != strategy_result.get("user_id"):
        raise HTTPException(status_code=403, detail="API key does not belong to strategy owner")

    key_data = api_key_row

    # Decrypt credentials
    try:
        api_key, api_secret, passphrase = decrypt_credentials(key_data, kek)
    except Exception:
        logger.error("Failed to decrypt API key %s", key_data["id"])
        raise HTTPException(status_code=500, detail="Failed to decrypt credentials")

    exchange = create_exchange(key_data["exchange"], api_key, api_secret, passphrase)
    since_ms = parse_since_ms(key_data.get("last_sync_at"))

    # PR #260 follow-up: if this strategy's existing trade history is below
    # the gate threshold, ignore `since_ms` and force a full-lookback walk.
    # A poisoned checkpoint scenario (e.g. v0.24.5.10's pre-fix Bybit code
    # advanced `last_sync_at` after a truncated 7-day pull) leaves stale
    # users in a state where every re-verify only walks `[last_sync_at..now]`
    # and the trades table can never accumulate enough history to pass the
    # gate. The data fix for known affected users went in directly; this
    # guard prevents the same pattern recurring from any future truncation
    # regression.
    if since_ms is not None:
        try:
            span = (
                supabase.table("trades")
                .select("timestamp")
                .eq("strategy_id", req.strategy_id)
                .order("timestamp", desc=False)
                .limit(1)
                .execute()
            )
            span_max = (
                supabase.table("trades")
                .select("timestamp")
                .eq("strategy_id", req.strategy_id)
                .order("timestamp", desc=True)
                .limit(1)
                .execute()
            )
            _span_rows = rows(span)
            _span_max_rows = rows(span_max)
            earliest = _span_rows[0]["timestamp"] if _span_rows else None
            latest = _span_max_rows[0]["timestamp"] if _span_max_rows else None
            if earliest and latest:
                from datetime import datetime as _dt

                e = _dt.fromisoformat(earliest.replace("Z", "+00:00"))
                lt = _dt.fromisoformat(latest.replace("Z", "+00:00"))
                span_days = (lt - e).total_seconds() / 86400.0
                STRATEGY_GATE_MIN_DAYS = 7
                if span_days < STRATEGY_GATE_MIN_DAYS:
                    logger.info(
                        "fetch-trades: trade-span %.2fd < %dd for strategy %s; ignoring stale since_ms checkpoint to walk full lookback",
                        span_days,
                        STRATEGY_GATE_MIN_DAYS,
                        req.strategy_id,
                    )
                    since_ms = None
        except Exception as e:
            # Best-effort guard. If the trade-table probe fails for any
            # reason (RLS shift, schema drift, network blip) we fall
            # through to the original since_ms — degrades to pre-guard
            # behaviour, never worse.
            logger.warning("fetch-trades clamp probe failed: %s", e)

    try:
        trades = await fetch_all_trades(exchange, since_ms=since_ms)
        account_balance = await fetch_usdt_balance(exchange)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to fetch trades from exchange")
    finally:
        await exchange.close()

    # Store trades atomically with advisory lock (prevents concurrent sync race).
    # Pass `trades` (list[dict]) directly — pre-serializing via json.dumps causes
    # PostgREST to cast the JSON string into a JSONB scalar string instead of a
    # JSONB array, which trips migration 007's `jsonb_array_elements(p_trades)`
    # with 22023 "cannot extract elements from a scalar". The supabase Python
    # client does the JSON serialization once on the request body.
    if trades:
        result = supabase.rpc("sync_trades", {
            "p_strategy_id": req.strategy_id,
            "p_trades": trades,
        }).execute()
        logger.info("Synced %s trades for strategy %s (atomic)", result.data, req.strategy_id)

    # Always advance the sync cursor (even when no new trades) to avoid re-fetching the same window
    update_data: dict[str, Any] = {"last_sync_at": datetime.now(timezone.utc).isoformat()}
    if account_balance is not None:
        update_data["account_balance_usdt"] = account_balance
    supabase.table("api_keys").update(update_data).eq("id", key_data["id"]).execute()

    return {"trades_fetched": len(trades), "strategy_id": req.strategy_id}
