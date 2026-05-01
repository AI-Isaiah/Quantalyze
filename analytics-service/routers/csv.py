"""
Phase 15 / CSV-01..CSV-02: FastAPI router for the CSV ingestion path.

POST /api/csv/validate (multipart) — validates an uploaded CSV against
the per-format pandera schema in services.csv_validator.

Cross-AI revision 2026-04-30: the previously-planned POST /api/csv/finalize
echo endpoint has been REMOVED. The Next.js layer calls the supabase
finalize_csv_strategy RPC directly because that RPC is SECURITY DEFINER
and asserts auth.uid() = p_user_id; a service-role echo here would have
been dead code.
"""
import logging
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from slowapi import Limiter
from slowapi.util import get_remote_address

from services.csv_validator import validate_csv

router = APIRouter(prefix="/api", tags=["csv"])
logger = logging.getLogger("quantalyze.analytics")
limiter = Limiter(key_func=get_remote_address)

MAX_BYTES = 10 * 1024 * 1024  # 10 MB per CSV-02 rule 1


@router.post("/csv/validate")
@limiter.limit("30/hour")
async def csv_validate(
    request: Request,
    file: UploadFile = File(...),
    fmt: str = Form(...),
    wizard_session_id: str = Form(...),
):
    """Validate a CSV upload. Returns preview + pandera errors envelope.

    Thin HTTP wrapper. All work lives in services.csv_validator.validate_csv
    so a future worker tick (Phase 19) can reuse the same implementation.
    """
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=400, detail={
            "ok": False,
            "code": "CSV_FILE_TOO_LARGE",
            "human_message": "Maximum file size is 10 MB.",
            "debug_context": {"size_bytes": len(raw)},
            "correlation_id": None,
        })

    if fmt not in ("daily_returns", "daily_nav", "trades"):
        raise HTTPException(status_code=400, detail={
            "ok": False,
            "code": "CSV_INVALID_FORMAT",
            "human_message": "fmt must be one of daily_returns, daily_nav, trades.",
            "debug_context": {"fmt_received": fmt},
            "correlation_id": None,
        })

    try:
        result = validate_csv(raw, fmt)
    except ValueError as e:
        # Cross-AI revision 2026-04-30: log only the rule key / message,
        # never the file contents.
        logger.warning("[csv-validator] ValueError: %s", e)
        raise HTTPException(status_code=400, detail={
            "ok": False,
            "code": "CSV_VALIDATION_FAILED",
            "human_message": str(e),
            "debug_context": {},
            "correlation_id": None,
        })
    except Exception as e:
        logger.error("[csv-validator] unexpected error: %s", e)
        raise HTTPException(status_code=500, detail={
            "ok": False,
            "code": "CSV_UPSTREAM_FAIL",
            "human_message": "CSV validation failed. Please retry.",
            "debug_context": {},
            "correlation_id": None,
        })

    # 200 OK even when ok=False — the envelope itself carries the error
    # detail. The Next.js client distinguishes by the envelope's `ok` field.
    return result
