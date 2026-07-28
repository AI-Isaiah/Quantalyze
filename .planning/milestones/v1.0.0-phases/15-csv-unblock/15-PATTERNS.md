# Phase 15: CSV Unblock — Pattern Map

**Mapped:** 2026-04-30
**Files analyzed:** 10 new + 5 modified = 15 total
**Analogs found:** 15 / 15 (100%)
**Mode:** Read-only pattern extraction. No git or source mutations.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/093_strategy_verifications.sql` | migration | DDL + RLS | `supabase/migrations/070_allocator_equity_snapshots.sql` | exact (table + 3-tier RLS + TEXT CHECK + self-verify) |
| `analytics-service/services/csv_validator.py` | Python service | file-I/O / transform | `analytics-service/services/transforms.py` (pandas pipeline) + `analytics-service/services/metrics.py` (sanitize+safe-float pattern) | exact (pure logic, no FastAPI deps) |
| `analytics-service/routers/csv.py` (new router) | FastAPI route | request-response (multipart) | `analytics-service/routers/exchange.py` (`/encrypt-key`, `/validate-key`) + `analytics-service/routers/analytics.py` (thin wrapper) | role-match (no existing multipart-form route — see "No Analog Found") |
| `analytics-service/main.py` (extend) | FastAPI app config | wire-up | `analytics-service/main.py:42, 203-209` (existing `app.include_router(...)` calls) | exact (1-line addition) |
| `analytics-service/models/schemas.py` (extend) | Pydantic model | validation | `analytics-service/models/schemas.py:9-13` (`ValidateKeyRequest`) | exact |
| `src/lib/analytics-client.ts` (extend) | client wrapper | request-response | `src/lib/analytics-client.ts:149-167` (`validateKey`, `encryptKey`) | exact (add `validateCsv`, `finalizeCsv`) |
| `src/lib/analytics-schemas.ts` (extend) | Zod schemas | validation | `src/lib/analytics-schemas.ts:30-50` | exact (add `CsvValidateResponseSchema`, etc.) |
| `src/app/api/strategies/csv-validate/route.ts` (new) | Next route | request-response (multipart proxy) | `src/app/api/strategies/create-with-key/route.ts` | exact (withAuth + ratelimit + analyticsRequest pass-through) |
| `src/app/api/strategies/csv-finalize/route.ts` (new) | Next route | request-response | `src/app/api/strategies/finalize-wizard/route.ts` | exact (withAuth + RPC call + after() side-effects) |
| `src/components/strategy/TrustTierLabel.tsx` (new) | React component | static render | `src/components/strategy/SyncBadge.tsx`, `src/components/strategy/FreshnessBadge.tsx` | exact (small typed-prop label) |
| `src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx` (new) | wizard sub-step | event-driven (file → fetch) | `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` + `src/components/strategy/CsvUpload.tsx` (drop-zone visual) | exact (form submit + error envelope) |
| `src/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep.tsx` (new) | wizard sub-step | render data + advance | `src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` (read-only summary) | exact |
| `src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx` (new) | wizard sub-step | request-response | `src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` | exact |
| `src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx` (new) | error component | static render | `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:293-320` (error-envelope JSX block) | exact |
| `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx` (extend) | wizard chrome | UI state | `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx:13-18, 74` (STEPS array → prop) | exact (in-place extension) |
| `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (extend) | wizard state machine | state branching | `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx:52-57, 358-410` (4-step machine) | exact (add `?source=csv` branch) |
| `src/lib/wizard/localStorage.ts` (extend) | persistence helper | state ser/des | `src/lib/wizard/localStorage.ts:11-15` (WizardStepKey union) | exact (add `upload`, `preview` keys, or branch the union) |
| `src/components/strategy/StrategyHeader.tsx` (extend) | display | static render | `src/components/strategy/StrategyHeader.tsx:14-20` (existing flex row) | exact (insert `<TrustTierLabel>` at index 1) |
| `src/components/strategy/StrategyGrid.tsx` (extend) | display | static render | `src/components/strategy/StrategyGrid.tsx:84-89` (above `<SyncBadge>`) | exact |

---

## Pattern Assignments

### 1. `supabase/migrations/093_strategy_verifications.sql` (migration, DDL + RLS)

**Analog:** `supabase/migrations/070_allocator_equity_snapshots.sql`

The 070 migration is the closest precedent for: TEXT CHECK constraints, 3-tier RLS (owner / admin / service_role), `REFERENCES strategies(id) ON DELETE CASCADE`, secondary indexes, comprehensive self-verifying DO block. Migration 087 is also a useful precedent for `strategy_analytics_series` shape and self-verify DO patterns.

**Header / preamble pattern** (070 lines 1-77 + 087 lines 1-67):
```sql
-- Migration 093: strategy_verifications table
-- Phase 15 / CSV-01..CSV-03 — first-class flow_type='csv' adapter.
--
-- Why this migration exists
-- -------------------------
-- [explanation linked to phase plan]
--
-- What this migration does
-- ------------------------
-- 1. CREATE TABLE strategy_verifications — TEXT CHECK on status / trust_tier
--    / flow_type / source; FK to strategies(id) ON DELETE CASCADE.
-- 2. ENABLE ROW LEVEL SECURITY + 3-tier policies (owner SELECT, admin SELECT,
--    service_role ALL) mirroring migration 070 STEP 9.
-- 3. Self-verifying DO block — table + columns + PK + RLS + policies + RPC
--    invariants.

BEGIN;
SET lock_timeout = '3s';
```

**TEXT CHECK pattern** (070 lines 88-105 — tightest precedent for `CHECK (col IN (...))`):
```sql
CREATE TABLE IF NOT EXISTS strategy_verifications (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id        UUID        NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  wizard_session_id  UUID        NOT NULL,  -- Phase 19 BACKBONE-07 adds UNIQUE INDEX
  status             TEXT        NOT NULL CHECK (status IN (
                       'draft','validated','metrics_captured',
                       'encrypted','report_queued','published'
                     )),
  trust_tier         TEXT        NOT NULL CHECK (trust_tier IN (
                       'api_verified','csv_uploaded','self_reported'
                     )),
  flow_type          TEXT        NOT NULL CHECK (flow_type IN (
                       'teaser','onboard','internal_report','csv','resync'
                     )),
  source             TEXT        NOT NULL CHECK (source IN (
                       'okx','binance','bybit','csv'
                     )),
  metrics_snapshot   JSONB,
  errors             JSONB,
  correlation_id     UUID,       -- Phase 16 / OBSERV-06 wires real values
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Index pattern** (070 lines 107-108):
```sql
CREATE INDEX IF NOT EXISTS strategy_verifications_strategy_id_idx
  ON strategy_verifications (strategy_id);
CREATE INDEX IF NOT EXISTS strategy_verifications_status_idx
  ON strategy_verifications (status);
```

**3-tier RLS policy pattern** (070 lines 391-413 verbatim — copy this block):
```sql
ALTER TABLE strategy_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_verifications_owner_select ON strategy_verifications;
CREATE POLICY strategy_verifications_owner_select ON strategy_verifications FOR SELECT
  USING (
    strategy_id IN (
      SELECT id FROM strategies WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS strategy_verifications_admin_select ON strategy_verifications;
CREATE POLICY strategy_verifications_admin_select ON strategy_verifications FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

-- Belt-and-suspenders explicit service_role policy (070 line 407 rationale —
-- service_role bypasses RLS by default, but explicit policy documents intent
-- and survives any future bypass-flip).
DROP POLICY IF EXISTS strategy_verifications_service_all ON strategy_verifications;
CREATE POLICY strategy_verifications_service_all ON strategy_verifications FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

**Self-verifying DO block pattern** (070 lines 416-643 + 087 lines 238-307):
```sql
DO $$
DECLARE
  v_column_count INT;
  v_rls_enabled  BOOLEAN;
  v_policy_count INT;
BEGIN
  -- (a) table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='strategy_verifications'
  ) THEN
    RAISE EXCEPTION 'Migration 093 failed: strategy_verifications table missing';
  END IF;

  -- (b) all expected columns present
  SELECT count(*) INTO v_column_count
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='strategy_verifications'
      AND column_name IN (
        'id','strategy_id','wizard_session_id','status','trust_tier',
        'flow_type','source','metrics_snapshot','errors','correlation_id',
        'created_at','updated_at'
      );
  IF v_column_count <> 12 THEN
    RAISE EXCEPTION
      'Migration 093 failed: expected 12 named columns, found %', v_column_count;
  END IF;

  -- (c) RLS enabled
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname='strategy_verifications'
      AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');
  IF NOT COALESCE(v_rls_enabled,false) THEN
    RAISE EXCEPTION 'Migration 093 failed: RLS not enabled on strategy_verifications';
  END IF;

  -- (d) 3 expected policies
  SELECT count(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname='public' AND tablename='strategy_verifications'
      AND policyname IN (
        'strategy_verifications_owner_select',
        'strategy_verifications_admin_select',
        'strategy_verifications_service_all'
      );
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION
      'Migration 093 failed: expected 3 RLS policies, found %', v_policy_count;
  END IF;

  RAISE NOTICE 'Migration 093: all assertions passed.';
END
$$;

COMMIT;
```

**Comments / COMMENT ON pattern** (070 lines 110-113 — every new table + column gets a one-line `COMMENT ON ... IS '...'` doc string anchored to phase + spec):
```sql
COMMENT ON TABLE strategy_verifications IS
  'Per-strategy verification tracking row. Phase 15 / CSV-01..CSV-03. Status state machine + trust-tier label; flow_type discriminates teaser/onboard/csv/internal_report/resync. Phase 19 BACKBONE-07 will add UNIQUE INDEX on wizard_session_id. See migration 093.';
```

---

### 2. `analytics-service/services/csv_validator.py` (Python service, file-I/O + transform)

**Analog:** `analytics-service/services/transforms.py` (pure pandas pipeline, no FastAPI deps) + `analytics-service/services/metrics.py:69-77` (`_safe_float`) + `analytics-service/services/metrics.py:80+` (`sanitize_metrics`).

There is no existing pandera validator — but `transforms.py` is the canonical "pure pandas, callable from both router and worker" service module. Match its structure: top-level `from __future__ import annotations`-style imports, typed `dict/list[dict]` signatures, NO direct FastAPI imports.

**Imports pattern** (transforms.py lines 1-3):
```python
import pandas as pd
import numpy as np
from typing import Any
```

For Phase 15 add `import pandera as pa` (already pinned in REQUIREMENTS).

**Function shape** (transforms.py lines 6-22 — typed signature + docstring + early-return for empty input):
```python
def validate_csv(
    raw_bytes: bytes,
    fmt: str,  # 'daily_returns' | 'daily_nav' | 'trades'
) -> dict[str, Any]:
    """Validate a CSV upload against the per-format pandera schema.

    Args:
        raw_bytes: file body from FastAPI UploadFile.read()
        fmt: format selector — one of 'daily_returns','daily_nav','trades'

    Returns:
        {
          'ok': bool,
          'preview': {
              'row_count': int,
              'date_range': [str, str],   # earliest, latest YYYY-MM-DD
              'columns_detected': list[str],
              'first_rows': list[dict],   # first 3
              'last_rows':  list[dict],   # last 3
          } | None,
          'errors': [{'rule': str, 'row': int, 'message': str}, ...],
          # Phase 16 / OBSERV-06 will add 'correlation_id' here.
        }
    """
    if not raw_bytes:
        return {'ok': False, 'preview': None,
                'errors': [{'rule': 'empty', 'row': 0,
                            'message': 'No file uploaded'}]}
    ...
```

**Pandera schema-per-format pattern** — model after the discriminator dispatch in `transforms.py:30` (`is_daily_pnl = df["order_type"].iloc[0] == "daily_pnl"`):
```python
SCHEMAS: dict[str, pa.DataFrameSchema] = {
    'daily_returns': pa.DataFrameSchema({
        'date': pa.Column(pa.DateTime, checks=pa.Check(
            lambda s: s.is_monotonic_increasing,
            error='monotonic_dates',
        )),
        'daily_return': pa.Column(float, checks=pa.Check.greater_than(
            -1.0, error='daily_return_lower_bound')),
        # currency + sharpe sentinel + trading-window rules below
    }),
    'daily_nav':     pa.DataFrameSchema({...}),
    'trades':        pa.DataFrameSchema({...}),
}
```

**Sanitize / safe-float pattern** (metrics.py lines 69-77 — copy verbatim for any numeric column coercion):
```python
def _safe_float(value: Any) -> float | None:
    """Convert to float, returning None for NaN/Inf values."""
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None
```

**No I/O / no DB calls inside this module.** Mirrors `transforms.py` — pure logic, callable from the router *and* (Phase 19) the worker. The router writes the `strategy_verifications` row.

---

### 3. `analytics-service/routers/csv.py` (FastAPI router, request-response + multipart)

**Closest analog:** `analytics-service/routers/exchange.py` (full POST + slowapi + try/finally + HTTPException pattern) + `analytics-service/routers/analytics.py` (thin wrapper that calls a service).

**No existing FastAPI route uses `UploadFile` / multipart in this codebase** — `python-multipart==0.0.27` is pinned in REQUIREMENTS specifically for Phase 15. The route below ports the json-body convention to a multipart body. See "No Analog Found — Multipart" below for the gap acknowledgment.

**Header / imports pattern** (exchange.py lines 1-14):
```python
import logging
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from slowapi import Limiter
from slowapi.util import get_remote_address
from services.csv_validator import validate_csv
from services.db import get_supabase

router = APIRouter(prefix="/api", tags=["csv"])
logger = logging.getLogger("quantalyze.analytics")
limiter = Limiter(key_func=get_remote_address)
```

**POST + slowapi + Pydantic body pattern** (exchange.py lines 24-49 verbatim shape — adapt to multipart):
```python
@router.post("/csv/validate")
@limiter.limit("30/hour")
async def csv_validate(
    request: Request,
    file: UploadFile = File(...),
    fmt: str = Form(...),
    wizard_session_id: str = Form(...),
):
    """Validate a CSV upload. Returns preview + pandera errors.

    Thin HTTP wrapper. All work lives in services.csv_validator.validate_csv
    so a future worker tick can reuse the same implementation.
    """
    # 10 MB defense-in-depth — Next.js intake also enforces, but the
    # analytics service must enforce independently per CSV-02.
    MAX_BYTES = 10 * 1024 * 1024
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=400, detail={
            "ok": False,
            "code": "CSV_FILE_TOO_LARGE",
            "human_message": "Maximum file size is 10 MB.",
            "debug_context": {"size_bytes": len(raw)},
            "correlation_id": None,  # Phase 16 / OBSERV-06 wires real values
        })

    if fmt not in ('daily_returns', 'daily_nav', 'trades'):
        raise HTTPException(status_code=400, detail={
            "ok": False, "code": "CSV_INVALID_FORMAT",
            "human_message": "fmt must be one of daily_returns, daily_nav, trades.",
            "debug_context": {"fmt_received": fmt}, "correlation_id": None,
        })

    result = validate_csv(raw, fmt)
    return result
```

**Error envelope shape** mirrors the wizardErrors discipline in src/lib/wizardErrors.ts and aligns with CONTEXT.md decision *"Error envelope shape (v0): `{ok: false, code, human_message, debug_context: {pandera_errors[]}, correlation_id: null}`"*.

**try/except → HTTPException pattern** (exchange.py lines 28-49 — every external dependency wrapped):
```python
try:
    result = validate_csv(raw, fmt)
except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))
except Exception as e:
    logger.error("CSV validation error: %s", str(e))
    raise HTTPException(status_code=500,
        detail="CSV validation failed. Please retry.")
```

**Wire the router into `main.py`** (main.py:42, 203-209) — one-line addition mirroring existing routers:
```python
# main.py:42 — extend the import
from routers import analytics, cron, exchange, internal, match, portfolio, simulator, csv
# main.py:209 — register
app.include_router(csv.router)
```

---

### 4. `analytics-service/models/schemas.py` (extend)

**Analog:** `analytics-service/models/schemas.py:9-13`:
```python
class ValidateKeyRequest(BaseModel):
    exchange: str
    api_key: str
    api_secret: str
    passphrase: Optional[str] = None
```

For Phase 15 add a Pydantic model only for **JSON body** routes (the multipart `csv/validate` route uses Form/File parameters, not a body model). The `csv-finalize` route uses JSON:
```python
class CsvFinalizeRequest(BaseModel):
    strategy_id: str
    wizard_session_id: str
    fmt: str  # 'daily_returns' | 'daily_nav' | 'trades'
```

---

### 5. `src/lib/analytics-client.ts` (extend) + `src/lib/analytics-schemas.ts` (extend)

**Analog:** `src/lib/analytics-client.ts:149-167` (`validateKey`, `encryptKey`).

**Function shape pattern** (analytics-client.ts:149-167 verbatim):
```typescript
export async function validateCsv(formData: FormData) {
  // CSV upload uses multipart/form-data — analyticsRequest assumes JSON,
  // so use a dedicated fetch path that mirrors the headers + timeout.
  const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";
  const SERVICE_KEY = process.env.ANALYTICS_SERVICE_KEY ?? "";
  const res = await fetch(`${ANALYTICS_URL}/api/csv/validate`, {
    method: "POST",
    headers: {
      "X-Api-Version": ANALYTICS_API_VERSION,
      ...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY }),
      // NO Content-Type — fetch sets the multipart boundary automatically
    },
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new AnalyticsUpstreamError(
      error?.human_message ?? error?.detail ?? "CSV validation failed",
      res.status,
    );
  }
  const data = await res.json();
  return parseResponse(CsvValidateResponseSchema, data, "/api/csv/validate");
}

export async function finalizeCsv(body: { strategy_id: string; wizard_session_id: string; fmt: string }) {
  const data = await analyticsRequest("/api/csv/finalize", body);
  return parseResponse(CsvFinalizeResponseSchema, data, "/api/csv/finalize");
}
```

**Zod schema pattern** (analytics-schemas.ts:30-35 — use `.passthrough()` style; the new `contract_version` style is an opt-in stricter mode and Phase 15 can land either, but matching the existing analytics-client for now is cheapest):
```typescript
export const CsvValidateResponseSchema = z.object({
  ok: z.boolean(),
  preview: z.object({
    row_count: z.number(),
    date_range: z.tuple([z.string(), z.string()]),
    columns_detected: z.array(z.string()),
    first_rows: z.array(z.record(z.string(), z.unknown())),
    last_rows:  z.array(z.record(z.string(), z.unknown())),
  }).nullable(),
  errors: z.array(z.object({
    rule: z.string(), row: z.number(), message: z.string(),
  })),
  correlation_id: z.string().nullable(),  // Phase 16 wires real values
}).passthrough();

export const CsvFinalizeResponseSchema = z.object({
  strategy_id: z.string(),
  status: z.string(),
}).passthrough();
```

---

### 6. `src/app/api/strategies/csv-validate/route.ts` (new Next route)

**Analog:** `src/app/api/strategies/create-with-key/route.ts` (full withAuth + ratelimit + analytics-client call + error mapping).

**Imports / wrapper** (create-with-key/route.ts:1-9):
```typescript
import { NextRequest, NextResponse } from "next/server";
import { validateCsv } from "@/lib/analytics-client";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import type { User } from "@supabase/supabase-js";
```

**Body of the route** (create-with-key/route.ts:28-65 verbatim shape — start of `withAuth` POST):
```typescript
export const POST = withAuth(async (req: NextRequest, user: User) => {
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-csv-validate:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { ok: false, code: "CSV_RATE_LIMIT", human_message: "Too many requests",
        debug_context: {}, correlation_id: null },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json(
      { ok: false, code: "CSV_INVALID_FORMAT",
        human_message: "Invalid multipart body",
        debug_context: {}, correlation_id: null },
      { status: 400 },
    );
  }

  // 10 MB cap at the Next.js edge (defense-in-depth — analytics service also enforces).
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, code: "CSV_INVALID_FORMAT",
        human_message: "Missing file field",
        debug_context: {}, correlation_id: null },
      { status: 400 },
    );
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { ok: false, code: "CSV_FILE_TOO_LARGE",
        human_message: "Maximum file size is 10 MB.",
        debug_context: { size_bytes: file.size }, correlation_id: null },
      { status: 400 },
    );
  }

  try {
    const result = await validateCsv(formData);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "CSV validation failed";
    console.error("[strategies/csv-validate] threw:", message);
    return NextResponse.json(
      { ok: false, code: "CSV_UPSTREAM_FAIL", human_message: message,
        debug_context: {}, correlation_id: null },
      { status: 502 },
    );
  }
});
```

---

### 7. `src/app/api/strategies/csv-finalize/route.ts` (new Next route)

**Analog:** `src/app/api/strategies/finalize-wizard/route.ts` (validation + RPC call + after() side-effects).

The Phase 15 finalize either (a) extends `finalize_wizard_strategy` to accept a `flow_type='csv'` discriminator OR (b) adds a sibling RPC `finalize_csv_strategy`. CONTEXT.md decisions punt on this — Plan-phase will pick. Both shapes share the same handler skeleton:

**withAuth + rate-limit + Zod-style validation** (finalize-wizard/route.ts:29-64):
```typescript
export const POST = withAuth(async (req: NextRequest, user: User) => {
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-csv-finalize:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { strategy_id, wizard_session_id, fmt } = body as Record<string, unknown>;
  if (!isUuid(strategy_id)) {
    return NextResponse.json({ error: "strategy_id must be a UUID" }, { status: 400 });
  }
  // ... validate fmt + wizard_session_id

  const supabase = await createClient();
  const { data: finalizedId, error } = await supabase.rpc(
    "finalize_csv_strategy",  // OR finalize_wizard_strategy with new params
    { p_strategy_id: strategy_id, p_user_id: user.id, p_fmt: fmt,
      p_wizard_session_id: wizard_session_id },
  );

  if (error) {
    console.error("[strategies/csv-finalize] RPC error:", error.message, error.code);
    if (error.code === "P0002" || error.code === "02000") {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Could not finalize CSV draft" }, { status: 500 });
  }

  // after() side-effects: notifyFounder + audit log
  // (finalize-wizard/route.ts:149-183 verbatim shape).
  return NextResponse.json({ strategy_id: finalizedId, status: "pending_review" });
});
```

---

### 8. `src/components/strategy/TrustTierLabel.tsx` (new)

**Analog:** `src/components/strategy/SyncBadge.tsx` (typed-prop label, no client state).

**Component shape** (SyncBadge.tsx:27-51 — almost verbatim):
```typescript
import { cn } from "@/lib/utils";

/**
 * Phase 15 v0 — plain muted text. Phase 17 / DESIGN-01 swaps internals
 * to a polished outline pill (#4A5568 neutral) without changing this
 * call signature. Callers must NOT depend on the rendered DOM.
 */
export const CSV_UPLOADED_LABEL = "CSV uploaded — verification pending";

type TrustTier = "api_verified" | "csv_uploaded" | "self_reported";

interface TrustTierLabelProps {
  trustTier: TrustTier | null | undefined;
  className?: string;
}

export function TrustTierLabel({ trustTier, className }: TrustTierLabelProps) {
  if (trustTier !== "csv_uploaded") return null;  // api_verified + self_reported render nothing in v0
  return (
    <span className={cn("text-xs text-text-muted", className)}>
      {CSV_UPLOADED_LABEL}
    </span>
  );
}
```

UI-SPEC §6 row 1 locks: `text-xs text-text-muted` (12px, weight 400, color `#64748B`); `CSV_UPLOADED_LABEL` exported alongside the component for tests + Phase 17 consumption.

**No `"use client"`** — it's a pure render. Matches `SyncBadge.tsx` (no directive) and `StrategyHeader.tsx` (no directive).

---

### 9. `src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx` (new)

**Analog:** `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` (full wizard sub-step shape) + `src/components/strategy/CsvUpload.tsx:202-234` (drop-zone visual contract).

**File header / `"use client"` directive** (ConnectKeyStep.tsx:1-11):
```typescript
"use client";

import { useCallback, useState, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import { CsvValidationEnvelope } from "./CsvValidationEnvelope";
```

**Section heading + subtitle pattern** (ConnectKeyStep.tsx:156-167 — exact spacing + typography):
```tsx
<section aria-labelledby="wizard-csv-upload-heading">
  <h2
    id="wizard-csv-upload-heading"
    className="font-sans text-2xl font-semibold text-text-primary"
  >
    Upload your track record
  </h2>
  <p className="mt-2 text-sm text-text-secondary">
    Pick a format and drop your CSV. We validate every row before creating
    your strategy. Max 10 MB.
  </p>
```

**Format-selector segmented-control pattern** (ConnectKeyStep.tsx:185-211 verbatim shape — exchange-card → format-card):
```tsx
<fieldset>
  <legend className="text-xs font-medium text-text-primary">Format</legend>
  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
    {FORMATS.map((f) => {
      const active = f.id === fmt;
      return (
        <button
          key={f.id}
          type="button"
          onClick={() => setFmt(f.id)}
          className={`rounded-md border px-4 py-3 text-left transition-colors ${
            active
              ? "border-accent bg-accent/5"
              : "border-border bg-white hover:border-accent/50"
          }`}
          aria-pressed={active}
          data-testid={`wizard-csv-fmt-${f.id}`}
        >
          <p className="text-sm font-semibold text-text-primary">{f.label}</p>
          <p className="mt-1 text-[11px] text-text-muted">{f.caption}</p>
        </button>
      );
    })}
  </div>
</fieldset>
```

**Drag-drop zone pattern** (CsvUpload.tsx:202-234 — copy verbatim, the visual is locked by UI-SPEC §11):
```tsx
<div
  className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent/50 transition-colors"
  onClick={() => fileInputRef.current?.click()}
  onDragOver={(e) => e.preventDefault()}
  onDrop={(e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) {
      const dt = new DataTransfer();
      dt.items.add(f);
      const input = fileInputRef.current!;
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }}
  role="button"
  tabIndex={0}
  aria-label="Upload CSV file. Drop a file or press Enter to browse."
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
  }}
>
  <p className="text-sm text-text-muted mb-1">
    Drop a CSV file here, or click to browse
  </p>
  <p className="text-xs text-text-muted">Required columns shown above. Max 10 MB.</p>
  <input
    ref={fileInputRef}
    type="file"
    accept=".csv"
    className="hidden"
    onChange={handleFileSelect}
  />
</div>
```

**Submit handler pattern** (ConnectKeyStep.tsx:98-152 — fetch + error code + telemetry):
```typescript
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  if (submitting) return;
  setSubmitting(true);

  try {
    const formData = new FormData();
    formData.append("file", file!);
    formData.append("fmt", fmt);
    formData.append("wizard_session_id", wizardSessionId);

    const res = await fetch("/api/strategies/csv-validate", {
      method: "POST",
      body: formData,
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      setEnvelope(data);
      trackForQuantsEventClient("wizard_error", {
        wizard_session_id: wizardSessionId,
        step: "csv_upload",
        code: data.code ?? "UNKNOWN",
      });
      setSubmitting(false);
      return;
    }
    onSuccess(data);  // advance to Preview
  } catch (err) {
    console.error("[wizard:CsvUploadStep] threw:", err);
    setSubmitting(false);
  }
}
```

**CTA pattern** (ConnectKeyStep.tsx:322-330):
```tsx
<Button
  type="submit"
  disabled={submitting || !file}
  data-testid="wizard-csv-validate-submit"
>
  {submitting ? "Validating…" : "Validate and continue"}
</Button>
```

---

### 10. `src/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep.tsx` (new)

**Analog:** `src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` (read-only summary `<dl>` + Back/Submit row).

**Card + metadata `<dl>` pattern** (SubmitStep.tsx:132-169 + reusable `SummaryRow` at lines 197-206 — copy verbatim, swap labels):
```tsx
<div className="mt-6 rounded-md border border-border bg-white">
  <dl className="divide-y divide-border">
    <SummaryRow label="Format" value={formatHumanLabel(preview.fmt)} />
    <SummaryRow label="Rows detected" value={`${preview.row_count} rows`} />
    <SummaryRow
      label="Date range"
      value={`${preview.date_range[0]} → ${preview.date_range[1]}`}
    />
    <SummaryRow
      label="Columns detected"
      value={preview.columns_detected.join(", ")}
    />
  </dl>
</div>
```

**SummaryRow** (SubmitStep.tsx:197-206 verbatim):
```tsx
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-4 py-3 md:grid-cols-[180px_1fr] md:gap-6">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
        {label}
      </dt>
      <dd className="text-xs text-text-secondary">{value}</dd>
    </div>
  );
}
```

**Preview table pattern** (CsvUpload.tsx:246-272 — `<table className="w-full text-xs">` + hairline `border-b border-border`):
```tsx
<div className="overflow-x-auto">
  <table className="w-full text-xs">
    <thead>
      <tr className="border-b border-border">
        {preview.columns_detected.map((h, i) => (
          <th key={i} className="px-2 py-1.5 text-left font-medium text-text-muted">{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {[...preview.first_rows, ...preview.last_rows].map((row, i) => (
        <tr key={i} className="border-b border-border/50">
          {preview.columns_detected.map((c, j) => (
            <td key={j} className="px-2 py-1.5 text-text-secondary font-metric tabular-nums">
              {String((row as Record<string, unknown>)[c] ?? "")}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

**Back / forward CTA row** (SubmitStep.tsx:181-192):
```tsx
<div className="mt-6 flex gap-3">
  <Button variant="secondary" type="button" onClick={onBack}>Back</Button>
  <Button onClick={onContinue} disabled={!validationPassed}>Submit strategy</Button>
</div>
```

---

### 11. `src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx` (new)

**Analog:** `src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` (entire file — Phase 15 mirrors it verbatim, swapping `fetch("/api/strategies/finalize-wizard")` → `fetch("/api/strategies/csv-finalize")` and the body shape).

**Submit handler pattern** (SubmitStep.tsx:47-97 verbatim — copy whole `handleSubmit` and adapt the body):
```typescript
const handleSubmit = useCallback(async () => {
  if (submitting) return;
  setErrorCode(null);
  setSubmitting(true);
  try {
    const res = await fetch("/api/strategies/csv-finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategy_id: strategyId,
        wizard_session_id: wizardSessionId,
        fmt,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorCode("UNKNOWN");
      setSubmitting(false);
      return;
    }
    onSubmitted(data.strategy_id ?? strategyId);
  } catch (err) {
    console.error("[wizard:CsvSubmitStep] threw:", err);
    setErrorCode("KEY_NETWORK_TIMEOUT");
    setSubmitting(false);
  }
}, [submitting, strategyId, wizardSessionId, fmt, onSubmitted]);
```

**Success redirect** is owned by `WizardClient` (WizardClient.tsx:211-222) — `handleSubmitSuccess` calls `clearWizardState()` then `router.push('/strategies/[id]?wizard_submitted=1')`. The CSV branch reuses this verbatim per UI-SPEC §7.5.

---

### 12. `src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx` (new)

**Analog:** `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:293-320` (the `errorCopy && <div role="alert">…</div>` block).

**Envelope shell pattern** (ConnectKeyStep.tsx:293-320 — copy verbatim, the visual is locked by UI-SPEC §7.3):
```tsx
interface CsvValidationEnvelopeProps {
  envelope: {
    code: string;
    human_message: string;
    debug_context: {
      pandera_errors?: { rule: string; row: number; message: string }[];
    };
    correlation_id: string | null;  // Phase 16 wires real values
  };
}

export function CsvValidationEnvelope({ envelope }: CsvValidationEnvelopeProps) {
  const errors = envelope.debug_context?.pandera_errors ?? [];
  const byRule = errors.reduce<Record<string, typeof errors>>((acc, e) => {
    (acc[e.rule] ??= []).push(e);
    return acc;
  }, {});
  const ruleCount = Object.keys(byRule).length;

  return (
    <div
      role="alert"
      className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
      data-testid="wizard-csv-error"
      data-error-code={envelope.code}
    >
      <p className="text-sm font-semibold text-negative">
        {errors.length > 0 ? `${errors.length} rows failed validation` : envelope.human_message}
      </p>
      <p className="mt-1 text-xs text-text-secondary">
        {ruleCount > 1
          ? `Across ${ruleCount} rule categories: ${Object.keys(byRule).join(", ")}.`
          : envelope.human_message}
      </p>
      {Object.entries(byRule).map(([rule, list]) => (
        <details key={rule} className="mt-2 text-xs">
          <summary className="cursor-pointer text-text-secondary">
            {RULE_LABELS[rule] ?? rule} ({list.length} rows)
          </summary>
          <ul className="mt-1 list-disc pl-5 space-y-0.5 text-text-muted">
            {list.map((e, i) => (
              <li key={i}>Row {e.row}: {e.message}</li>
            ))}
          </ul>
        </details>
      ))}
      {/* Phase 16 / OBSERV-06 carrier marker — DOM shape stable. */}
      <p className="mt-2 text-[11px] text-text-muted">
        correlation_id: {envelope.correlation_id ?? "—"}
      </p>
    </div>
  );
}
```

**Rule label map** (UI-SPEC §8.7 — copy table to a const):
```typescript
const RULE_LABELS: Record<string, string> = {
  monotonic_dates: "Dates must be strictly increasing",
  nav_non_zero: "NAV cannot be zero",
  daily_return_lower_bound: "Daily return cannot be ≤ -100%",
  daily_sharpe_sentinel: "Daily Sharpe > 10 looks unrealistic",
  trading_window: "Date falls outside your trading window",
  currency_usd_or_blank: "Currency must be USD or left blank",
  qty_price_positive: "Quantity and price must be positive",
};
```

---

### 13. `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx` (extend)

**Analog:** existing file — extend in place per UI-SPEC §6 row 6.

**Pattern:** lift the `STEPS` constant (lines 13-18) to an optional prop. Default fallback preserves the 4-step API branch verbatim.

**Current** (WizardChrome.tsx:13-18, 20-33):
```typescript
const STEPS: { key: WizardStepKey; label: string; number: string }[] = [
  { key: "connect_key", label: "Connect key", number: "01" },
  { key: "sync_preview", label: "Verify data", number: "02" },
  { key: "metadata", label: "Strategy profile", number: "03" },
  { key: "submit", label: "Submit", number: "04" },
];
```

**Phase 15 extension** (mirror the structure, accept new prop):
```typescript
const DEFAULT_STEPS: { key: WizardStepKey; label: string; number: string }[] = [
  { key: "connect_key", label: "Connect key", number: "01" },
  { key: "sync_preview", label: "Verify data", number: "02" },
  { key: "metadata", label: "Strategy profile", number: "03" },
  { key: "submit", label: "Submit", number: "04" },
];

export interface WizardChromeProps {
  currentStep: WizardStepKey;
  // ... existing props
  steps?: { key: WizardStepKey; label: string; number: string }[];
  totalSteps?: number;  // for the "01 / 03" caption pattern
}
```

**Stepper grid change** (WizardChrome.tsx:74) — make `grid-cols-N` dynamic. UI-SPEC §11 + §13 anchor 4: STEPS array comes from props, NOT chrome source.
```tsx
<div className={cn("grid border-b border-border", `grid-cols-${steps.length}`)}>
```

---

### 14. `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (extend)

**Analog:** existing file (WizardClient.tsx:52-57, 358-410 — the `STEP_INDEX` map + the `{step === "..." && ...}` render switch).

**Pattern:** read `?source=csv` via `useSearchParams`, branch the step union + render switch.

**Read query param** (Next 16 / `useSearchParams` shape — see existing usages in the codebase):
```typescript
import { useSearchParams } from "next/navigation";
const searchParams = useSearchParams();
const source = searchParams.get("source") === "csv" ? "csv" : "api";
```

**Step union extension** (WizardClient.tsx:52-57 + src/lib/wizard/localStorage.ts:11-15):
```typescript
// extend the WizardStepKey union — see Pattern 17 below.
const CSV_STEP_INDEX: Record<"upload" | "preview" | "submit", 1 | 2 | 3> = {
  upload: 1, preview: 2, submit: 3,
};
const STEP_INDEX_BY_SOURCE = source === "csv" ? CSV_STEP_INDEX : STEP_INDEX;
```

**Render-switch extension** (WizardClient.tsx:358-410 — add CSV branches alongside existing API branches):
```tsx
{source === "csv" ? (
  <>
    {step === "upload" && (
      <CsvUploadStep
        wizardSessionId={wizardSessionId}
        onSuccess={(payload) => { setStep("preview"); /* persist */ }}
      />
    )}
    {step === "preview" && uploadedFile && (
      <CsvPreviewStep
        preview={uploadedFile.preview}
        onBack={() => setStep("upload")}
        onContinue={() => setStep("submit")}
      />
    )}
    {step === "submit" && uploadedFile && strategyId && (
      <CsvSubmitStep
        strategyId={strategyId}
        wizardSessionId={wizardSessionId}
        fmt={uploadedFile.fmt}
        onSubmitted={handleSubmitSuccess}  // existing handler — same redirect path
        onBack={() => setStep("preview")}
      />
    )}
  </>
) : (
  /* existing 4-step API branch unchanged */
)}
```

**Reuse `handleSubmitSuccess`** (WizardClient.tsx:211-222) — same `clearWizardState()` + `router.push` path. UI-SPEC §7.5 locks this.

---

### 15. `src/lib/wizard/localStorage.ts` (extend)

**Analog:** lines 11-15 (`WizardStepKey` union).

**Pattern:** extend the union to admit the CSV branch keys. Validation array at line 73 must be updated in lockstep.
```typescript
export type WizardStepKey =
  | "connect_key" | "sync_preview" | "metadata" | "submit"  // API branch
  | "upload"     | "preview"      /* | "submit" */;          // CSV branch — submit is shared
```

Phase 15 should review whether `submit` is shared or distinct (`csv_submit`) — sharing is simpler for `WizardClient`'s `STEP_INDEX` collisions. CONTEXT.md doesn't lock this; planner picks.

---

### 16. `src/components/strategy/StrategyHeader.tsx` (extend)

**Analog:** existing file (StrategyHeader.tsx:14-20 — the flex row).

**Pattern:** insert at index 1 between `<h1>` and `<Badge>`. UI-SPEC §6 row 8 + §5 Layout row 7.
```tsx
<div className="flex items-center gap-3 mb-2">
  <h1 className="text-[32px] font-bold tracking-tight text-text-primary">
    {displayStrategyName(strategy)}
  </h1>
  <TrustTierLabel trustTier={(strategy as Strategy & { trust_tier?: string | null }).trust_tier ?? null} />
  <Badge label={strategy.status} type="status" />
</div>
```

The `Strategy` type at `src/lib/types.ts:35-72` does NOT yet have `trust_tier` — Phase 15 must add it (optional, `'api_verified' | 'csv_uploaded' | 'self_reported' | null`). Planner picks: extend `Strategy` interface OR cast at the call site. Migration 093 doesn't change the `strategies` table — `trust_tier` lives on `strategy_verifications`. Plan-phase resolves: either the `Strategy` row gets a denormalized `trust_tier` column, or `StrategyHeader` accepts a separate `trustTier` prop sourced from a `strategy_verifications` join.

---

### 17. `src/components/strategy/StrategyGrid.tsx` (extend)

**Analog:** existing file (StrategyGrid.tsx:84-89 — the existing `<SyncBadge>` placement).

**Pattern:** insert immediately above `<SyncBadge>`. UI-SPEC §6 row 9 + §5 Layout row 8.
```tsx
{/* Phase 15 / CSV-03: trust-tier label on marketplace tile */}
<TrustTierLabel
  trustTier={(s as StrategyWithAnalytics & { trust_tier?: string | null }).trust_tier ?? null}
  className="mb-1"
/>
{/* Sync freshness — existing */}
<SyncBadge ... />
```

---

## Shared Patterns

### S1. Withauth + rate-limit + audit log (Next routes)
**Source:** `src/app/api/strategies/finalize-wizard/route.ts:29-39, 145-183` + `src/lib/api/withAuth.ts:8-24`
**Apply to:** `csv-validate/route.ts`, `csv-finalize/route.ts`
```typescript
export const POST = withAuth(async (req, user) => {
  const rl = await checkLimit(userActionLimiter, `…:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  /* ... handler ... */
  // Fire-and-forget audit + side-effects via after()
});
```
`withAuth` already runs `assertSameOrigin` for non-GET methods (withAuth.ts:11-15) — no extra CSRF code needed.

### S2. Logger prefix discipline
**Source:** CONVENTIONS.md §Logging + every existing route
**Apply to:** every new module
```typescript
console.error("[strategies/csv-validate] …", { code, message });
console.error("[wizard:CsvUploadStep] threw:", err);
```
Python side: `logger = logging.getLogger("quantalyze.analytics")` with the `[csv-validator]` or similar bracketed module tag prefixed inline.

### S3. Error-envelope visual contract (wizard)
**Source:** `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:293-320`
**Apply to:** `CsvValidationEnvelope.tsx` (the dedicated component) — class names locked by UI-SPEC §7.3 + §11:
```
role="alert"
className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
title:    text-sm font-semibold text-negative
cause:    text-xs text-text-secondary
fix list: list-decimal text-xs text-text-secondary (or list-disc for per-row)
correlation_id slot: text-[11px] text-text-muted
```

### S4. Telemetry events
**Source:** `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:128-148, 175-180` (`trackForQuantsEventClient`)
**Apply to:** every CSV step
```typescript
trackForQuantsEventClient("wizard_step_view_1", { wizard_session_id, step: "upload" });
trackForQuantsEventClient("wizard_error", { wizard_session_id, step: "csv_upload", code });
trackForQuantsEventClient("wizard_step_complete_1", { wizard_session_id, strategy_id });
```

### S5. Self-verifying DO block in migrations
**Source:** `supabase/migrations/070_allocator_equity_snapshots.sql:416-643` (12 assertions a-l) + `supabase/migrations/087_strategy_analytics_series.sql:238-307` (7 assertions)
**Apply to:** migration 093 — minimum assertions: (a) table exists, (b) 12 columns present, (c) RLS enabled, (d) 3 named policies present, (e) PK on id, (f) FK to strategies(id), (g) optional service-role INSERT probe + cleanup.

### S6. SECURITY DEFINER RPC pattern (if planner adds new RPC for csv-finalize)
**Source:** `supabase/migrations/031_wizard_source_column.sql:118-194` (`create_wizard_strategy`) + `:202-…` (`finalize_wizard_strategy`)
**Apply to:** any new `finalize_csv_strategy` or `record_csv_verification` RPC
- `LANGUAGE plpgsql SECURITY DEFINER`
- `SET search_path = public, pg_catalog`
- Manual `IF v_auth_uid <> p_user_id THEN RAISE EXCEPTION` guard
- `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;`

### S7. Pure-logic services (Python)
**Source:** `analytics-service/services/transforms.py` (typed dict signatures, no FastAPI imports, no DB calls)
**Apply to:** `csv_validator.py`
- No `from fastapi import …`
- No `get_supabase()` calls — the router writes the verification row, the service returns the result dict
- `from __future__ import annotations` if needed for forward refs
- Module-level `SCHEMAS: dict[str, pa.DataFrameSchema]` constant

### S8. Analytics-client + Zod contract validation
**Source:** `src/lib/analytics-client.ts:54-137` (analyticsRequest + parseResponse) + `src/lib/analytics-schemas.ts:30-78`
**Apply to:** `validateCsv` + `finalizeCsv` exports + matching `Csv*ResponseSchema` Zod schemas.

### S9. Wizard-state localStorage discipline
**Source:** `src/lib/wizard/localStorage.ts` (lines 11-15 type union, line 73 validation array)
**Apply to:** any extension of `WizardStepKey` — ALL three locations (type union + validation array + `STEP_INDEX` in WizardClient) must be kept in lockstep.

### S10. `// TODO(phase-17): hoist into wizardErrors` carrier comments
**Source:** UI-SPEC §13 anchor 3
**Apply to:** every literal copy string in CsvUploadStep / CsvPreviewStep / CsvSubmitStep / CsvValidationEnvelope. Phase 17 / DESIGN-05 will absorb them into `wizardErrors.ts`. Don't pre-empt the move; just leave the TODO comment so the Phase 17 grep finds them.

---

## No Analog Found

These are gaps in the codebase that planner should address with NEW patterns rather than copying existing code:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `analytics-service/routers/csv.py` (multipart `UploadFile` + `Form` body) | FastAPI | request-response (multipart) | No existing router uses `UploadFile = File(...)` or `Form(...)` parameters. `python-multipart==0.0.27` is pinned in REQUIREMENTS specifically for Phase 15. The shape lifted from FastAPI docs is correct — the codebase just hasn't shipped a multipart route yet. |
| Pandera schemas (`SCHEMAS` dict in `csv_validator.py`) | Python | validation | No existing pandera usage. The `transforms.py` pipeline does pandas-only manual validation. Phase 15 introduces pandera as a fresh dependency. |
| Strategy `trust_tier` join surface | DAL | read | The `strategies` table has no `trust_tier` column (verified via `src/lib/types.ts:35-72` — no `trust_tier` field). The label data lives on `strategy_verifications.trust_tier`. Planner picks: (a) JOIN at read time in `getStrategyDetail` / `getStrategyGrid`, (b) denormalize a column onto `strategies` (Phase 19's job). For Phase 15 the cheapest move is to extend `getStrategyDetail` (and the equivalent factsheet read) with a left-join to `strategy_verifications`, exposing a `trust_tier` field on the returned object. |

---

## Match Quality Summary

- **Files with exact analog:** 17
- **Files with role-match analog:** 1 (`analytics-service/routers/csv.py` — FastAPI shape exact, multipart shape is new)
- **Files with no analog:** 1 (the pandera schemas — fresh library, no precedent)

## Key Cross-Cutting Patterns Identified

1. **Wizard sub-steps follow ConnectKeyStep's exact shape:** `"use client"` → `useState` for form/error/submitting → `useCallback` for handlers → `<section>` with `aria-labelledby` → typed-segmented buttons → form → `<div role="alert">` envelope → `<Button>` with `data-testid="wizard-…"`.
2. **Migrations follow 070's 10-step ordering:** table → RLS → indexes → comments → self-verifying DO block, all wrapped in `BEGIN ... COMMIT;` with `SET lock_timeout = '3s';`.
3. **Next routes follow `withAuth` + `checkLimit` + `analytics-client` + `after()` shape:** every mutation route. CSRF is automatic via `withAuth.ts:11-15`.
4. **Analytics-service routers are thin wrappers:** they parse Pydantic / Form / File, call a pure-logic service in `services/`, and return its dict directly. The service modules do NOT import FastAPI.
5. **Logging discipline:** `[bracketed-module]` prefix on every console.error / logger.error. Python uses `logging.getLogger("quantalyze.analytics")`.
6. **Trust tier label has a single source-of-truth string** (`CSV_UPLOADED_LABEL`) exported alongside the component for tests + Phase 17 promotion.

---

## Branch Safety

This pattern map performed **read-only** operations. No `git checkout`, no `git pull`, no source mutations. Branch state untouched (`v1.0.0-api-key-rewrite-15-16` per the prompt).

## Files Created

- `.planning/phases/15-csv-unblock/15-PATTERNS.md` (this file)
