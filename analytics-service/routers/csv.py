"""
Phase 15 / CSV-01..CSV-02: FastAPI router for the CSV ingestion path.

POST /api/csv/validate (multipart) — validates an uploaded CSV against
the per-format pandera schema in services.csv_validator.

Cross-AI revision 2026-04-30: the previously-planned POST /api/csv/finalize
echo endpoint has been REMOVED. The Next.js layer calls the supabase
finalize RPC directly (since Phase 145 the folded
finalize_csv_strategy_with_returns) because that RPC is SECURITY DEFINER
and asserts auth.uid() = p_user_id; a service-role echo here would have
been dead code.
"""
import logging
from functools import partial
from typing import Any

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form

from services.csv_validator import UNSUPPORTED_FMT_MESSAGE, validate_csv
# PYAPI-03 — the canonical process-wide Limiter. This module used to declare its
# own ``Limiter(key_func=get_remote_address)``: keyed on the Railway EDGE ip
# (G-10/G-11) so the 30/hour budget was platform-wide, and with its own isolated
# ``memory://`` storage (G-3) invisible to ``app.state.limiter``. Same repair as
# the Phase-19/API-5 fix in services/rate_limit.py's docstring.
from services.rate_limit import limiter, tenant_or_platform_key

router = APIRouter(prefix="/api", tags=["csv"])
logger = logging.getLogger("quantalyze.analytics")

MAX_BYTES = 10 * 1024 * 1024  # 10 MB per CSV-02 rule 1
_READ_CHUNK_BYTES = 64 * 1024  # 64 KiB per await — bounded heap growth


async def _read_capped(file: UploadFile, cap: int) -> bytes:
    """Stream-read an UploadFile with an early abort once `cap` bytes are
    exceeded. Phase 15 / WR-01 fix: the prior implementation called
    `await file.read()` unbounded, which would fully realise hundreds of
    MB / GBs into memory before the size guard fired. A direct caller
    holding the analytics-service `SERVICE_KEY` could exploit that to
    DoS the pod regardless of the Next.js front-line cap. The streaming
    loop here aborts at the first 64 KiB chunk that pushes the running
    total past `cap`, so worst-case heap is `cap + chunk_size` bytes."""
    buf = bytearray()
    while True:
        chunk = await file.read(_READ_CHUNK_BYTES)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > cap:
            raise HTTPException(status_code=400, detail={
                "ok": False,
                "code": "CSV_FILE_TOO_LARGE",
                "human_message": "Maximum file size is 10 MB.",
                "debug_context": {"size_bytes": len(buf)},
                "correlation_id": None,
            })
    return bytes(buf)


@router.post("/csv/validate")
@limiter.limit(
    "30/hour", key_func=partial(tenant_or_platform_key, scope="csv_validate")
)
async def csv_validate(
    request: Request,
    file: UploadFile = File(...),
    fmt: str = Form(...),
    wizard_session_id: str = Form(...),
) -> dict[str, Any]:
    """Validate a CSV upload. Returns preview + pandera errors envelope.

    Thin HTTP wrapper. All work lives in services.csv_validator.validate_csv
    so a future worker tick (Phase 19) can reuse the same implementation.
    """
    raw = await _read_capped(file, MAX_BYTES)

    if fmt not in ("daily_returns", "daily_nav", "trades"):
        raise HTTPException(status_code=400, detail={
            "ok": False,
            "code": "CSV_INVALID_FORMAT",
            "human_message": UNSUPPORTED_FMT_MESSAGE,
            "debug_context": {"fmt_received": fmt},
            "correlation_id": None,
        })

    try:
        result = validate_csv(raw, fmt)
    except Exception as e:
        # 170.1 / D-10 — NEVER LOG OR RETURN THE EXCEPTION TEXT. A pandas /
        # pandera / int() message routinely carries the offending CELL
        # ("could not convert string to float: '<the cell>'"), which is
        # untrusted upload content that can hold PII. Log the exception TYPE
        # only; the client gets a fixed sentence.
        #
        # One arm, not two. The old `except ValueError` arm returned a 400 with
        # `str(e)`, but `validate_csv` raises ValueError for exactly one reason
        # (an unsupported fmt) and the pre-check above has already rejected
        # that with the fixed sentence, so a ValueError reaching here is an
        # internal fault, not a client error. 500 is the honest status.
        logger.error("[csv-validator] unexpected error: %s", type(e).__name__)
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
