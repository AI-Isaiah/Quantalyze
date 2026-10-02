# Phase 16: Diagnostic Spike + Observability — Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 24 (12 new TS/Py, 4 modified TS/Py, 4 docs/CI, 4 cassette buckets)
**Analogs found:** 22 / 24 (2 use Sentry+structlog from research only — no in-repo analog)

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx` (NEW) | component | render-only client | `src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx` | exact (sibling envelope, same wizard tree) |
| `src/app/api/debug-key-flow/route.ts` (NEW) | controller | streaming SSE response | `src/app/api/admin/strategy-review/route.ts` (admin gate) + RESEARCH §Pattern 3 (SSE shape — no in-repo SSE precedent) | role-match (admin gate) + research-only (SSE) |
| `src/app/error.tsx` (MODIFIED) | error boundary | event-driven | existing `src/app/error.tsx` (extend in place — TODO marker on L20) | exact (already exists; replace TODO) |
| `src/app/global-error.tsx` (MODIFIED) | root error boundary | event-driven | existing `src/app/global-error.tsx` (extend in place — TODO marker on L19) | exact (already exists; replace TODO) |
| `src/lib/correlationId.ts` (NEW) | utility | request-response (helper) | `src/lib/csrf.ts` + `src/lib/timing-safe-compare.ts` (small leaf helpers) | role-match |
| `src/lib/envelope.ts` (NEW, Plan 6) | utility | transform | `src/lib/wizardErrors.ts` (`formatKeyError` builder) | exact (envelope wraps existing builder) |
| `src/app/api/webhooks/resend/route.ts` (NEW, Plan 5) | controller | event-driven (webhook in) | `src/app/api/admin/strategy-review/route.ts` (POST handler shape) | role-match |
| `src/lib/email.ts` (MODIFIED, Plan 5) | service | request-response | existing `src/lib/email.ts` (already calls `resend.emails.send`) | exact (extend in place) |
| `src/lib/analytics-client.ts:66` (MODIFIED, Plan 2) | service | request-response | existing `src/lib/analytics-client.ts` (`analyticsRequest` wrapper) | exact (single-line addition to existing seam) |
| `src/instrumentation.ts` (MODIFIED, Plan 3) | telemetry | event-driven | existing `src/instrumentation.ts` (`onRequestError`) | exact (already wires Sentry; surface `correlation_id` tag) |
| `analytics-service/services/logging_config.py` (NEW, Plan 2) | utility / middleware | event-driven (per-request bind) | `analytics-service/main.py:23-26` (root logging.basicConfig) + RESEARCH §Pattern 2 | partial (no structlog precedent in repo) |
| `analytics-service/sentry_init.py` (NEW or fold into main.py upgrade, Plan 3) | telemetry | event-driven | `analytics-service/main.py:28-40` (existing minimal sentry_sdk.init) | exact (upgrade in place) |
| `analytics-service/main.py` (MODIFIED, Plan 2 + Plan 3) | bootstrap | n/a | existing `analytics-service/main.py` (FastAPI app + middleware chain) | exact (extend in place) |
| `analytics-service/routers/debug_key_flow.py` (NEW, Plan 7) | controller | request-response | `analytics-service/routers/internal.py` (X-Internal-Token gate pattern) | role-match |
| `analytics-service/tests/test_trigger_rls_audit.py` (NEW, Plan 4) | test | integration | `analytics-service/tests/test_audit.py` (mock-based) + `analytics-service/tests/test_equity_reconstruction_live.py` (live-DB pattern) | role-match |
| `analytics-service/tests/test_logging_config.py` (NEW, Plan 2) | test | unit | `analytics-service/tests/test_audit.py` | role-match |
| `analytics-service/tests/test_sentry_init.py` (NEW, Plan 3) | test | unit | `analytics-service/tests/test_audit.py` | role-match |
| `analytics-service/tests/test_correlation_middleware.py` (NEW, Plan 2) | test | unit | `analytics-service/tests/test_audit.py` (mock + monkeypatch) | role-match |
| `analytics-service/tests/test_repro_key_flow.py` (NEW, Plan 8) | test | replay (vcrpy) | `analytics-service/tests/test_exchange_harness.py` (closest fixture-driven exchange test) | role-match |
| `analytics-service/tests/conftest_vcr.py` (NEW, Plan 8) | test fixture | replay setup | `analytics-service/tests/conftest.py` (existing fixture module) | role-match (sibling fixture file) |
| `analytics-service/tests/cassettes/{okx,binance,bybit}/{happy,auth-fail,rate-limit,schema-drift}.yaml` (NEW, Plan 8 — 12 files) | test fixture | record/replay | `analytics-service/tests/fixtures/golden_252d_input.parquet` (committed-binary fixture precedent) | role-match (committed deterministic fixture) |
| `analytics-service/requirements.txt` (MODIFIED) | config | n/a | existing `analytics-service/requirements.txt` (alphabetical-ish, version-pinned) | exact |
| `scripts/repro-key-flow.sh` (NEW, Plan 8) | script | shell | `scripts/check-banned-packages.mjs` (CI gate script) | role-match (different language; same exit-code contract) |
| `.github/workflows/ci.yml` (MODIFIED, Plan 1 — add OBSERV-12 presence-check step) | CI config | n/a | `.github/workflows/ci.yml` `frontend.steps[Check for banned packages]` (L22-23) | exact (add a sibling step) |
| `.planning/phase-16/{day-2-decision,posthog-mobile-audit,trigger-rls-audit}.md` (NEW, Plan 4/9/10) | docs | n/a | RESEARCH §1201 template scaffold; existing `.planning/phase-16/migration-drift-resolution.md` style | exact (template) |

## Pattern Assignments

### `src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx` (component, render-only client)

**Analog:** `src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx`
**Why this analog:** Sibling envelope component already in the wizard tree, also implements the structured-error contract (`{code, human_message, debug_context, correlation_id}`), already uses the locked visual treatment (`role="alert"`, `border-negative/30 bg-negative/5`, `<details>` for diagnostics). It even contains a Phase 16 / OBSERV-06 forward-marker comment (L13, L89) describing the exact shape this new file will adopt.

**`"use client"` + import order pattern** (CsvValidationEnvelope.tsx L1-2):
```tsx
"use client";

```
- First line is exact `"use client";` (double quotes, semicolon — matches CONVENTIONS.md §Directives).
- No React import needed (`jsx: "react-jsx"` per `tsconfig.json`).

**Props interface pattern** (CsvValidationEnvelope.tsx L15-24):
```tsx
interface CsvValidationEnvelopeProps {
  envelope: {
    code: string;
    human_message: string;
    debug_context: { ... };
    correlation_id: string | null;
  };
}
```
- Single `envelope` object prop (PropName + `Props` suffix per CONVENTIONS.md §Naming).
- New file widens shape to: `{ ok: false, code, human_message, debug_context: string[], correlation_id, recoverable }` plus optional `onRetry` / `onCancel` callbacks.

**Visual / a11y pattern** (CsvValidationEnvelope.tsx L62-93):
```tsx
<div
  role="alert"
  className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
  data-testid="wizard-csv-error"
  data-error-code={envelope.code}
>
  <p className="text-sm font-semibold text-negative">{...}</p>
  <p className="mt-1 text-xs text-text-secondary">{causeText}</p>
  {Object.entries(byRule).map(([rule, list]) => (
    <details key={rule} className="mt-2 text-xs">
      <summary className="cursor-pointer text-text-secondary">{...}</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text-muted">{...}</ul>
    </details>
  ))}
  <p className="mt-2 text-[11px] text-text-muted">
    correlation_id: {envelope.correlation_id ?? "—"}
  </p>
</div>
```
- Tailwind tokens only — `border-negative/30`, `bg-negative/5`, `text-text-secondary` (CONVENTIONS.md §Design System Conformance forbids hex colors).
- `<details>` + `<summary>` is the locked Phase 16 mechanism (no third-party accordion lib).
- Stable `data-testid` + `data-error-code` for E2E selectors.
- Trailing `correlation_id` line is the OBSERV-06 carrier marker.

**Copy-diagnostics button** (NOT in analog — research-only, see RESEARCH.md L690-722):
- Add `useState` import for `copied` state.
- `navigator.clipboard.writeText(JSON.stringify(envelope, null, 2))` per Anti-Pattern note in RESEARCH ("don't use deprecated `document.execCommand('copy')`").
- All `<button>` elements MUST be `type="button"` per RESEARCH Pitfall 9 (avoids accidental form submission inside ConnectKeyStep's form).
- ARIA-live `<span role="status" aria-live="polite">` echoes "Copied to clipboard".

**Button primitive import:** `import { Button } from "@/components/ui/Button";` (path alias per CONVENTIONS.md §Import Organization). Use `cn(...)` from `@/lib/utils` if className composition needed.

---

### `src/lib/envelope.ts` (utility, transform — Plan 6)

**Analog:** `src/lib/wizardErrors.ts` (`formatKeyError` already returns the source-of-truth `WizardErrorCopy` shape).

**Mapping** (per RESEARCH L728-746):
- `WizardErrorCopy.title` → `ErrorEnvelope.human_message`
- `WizardErrorCopy.fix[]` → `ErrorEnvelope.debug_context`
- `recoverable` derives from `WizardErrorCopy.actions.includes("clear_and_retry") || ... .includes("try_another_key")`
- `code` is the `WizardErrorCode` literal, `correlation_id` is the inbound parameter.

**Module-level conventions** (CONVENTIONS.md §Module Design):
- Kebab-case filename → already named `envelope.ts` (acceptable; `error-envelope.ts` would be more descriptive but `envelope.ts` matches `wizardErrors.ts` minimalist style).
- One concept per file. No barrel index re-exports. Import from specific module.
- File header JSDoc explains contract (mirror style of `src/lib/audit.ts:1-75`).

---

### `src/lib/correlationId.ts` (utility — Plan 2)

**Analogs:**
- `src/lib/csrf.ts` (small server-only request-scoped helper that reads `headers()`)
- `src/lib/timing-safe-compare.ts` (tiny leaf helper, single export)

**Server-only directive pattern** (`src/lib/audit.ts:1`):
```typescript
import "server-only";
```
- First line — required for any module that calls `next/headers` or could leak admin-side state into the client bundle.

**Header-read shape** (per RESEARCH §Pattern 1, L344-358):
```typescript
import "server-only";
import { headers } from "next/headers";

const HEADER = "x-correlation-id";

export async function getCorrelationId(): Promise<string> {
  const h = await headers();
  return h.get(HEADER) ?? crypto.randomUUID();
}
```
- `await headers()` — mandatory for Next.js 16 async APIs (per AGENTS.md heads-up; CONVENTIONS.md §Route Handler Patterns L136-144 confirms async `params` precedent).
- `crypto.randomUUID()` is a Node 20+ global — repo is on Node 20 / Vercel 24 LTS (no polyfill needed; see RESEARCH Pitfall 7).
- Header name lower-case (HTTP convention; node fetch normalizes).

**Naming:** Filename `correlationId.ts` is camelCase. CONVENTIONS.md §Naming says lib modules are kebab-case (`alert-ack-token.ts`, `analytics-client.ts`). **Recommend `correlation-id.ts` to match repo convention.** RESEARCH.md uses `correlationId.ts` — flag this in Plan 2 review for the planner to decide.

---

### `src/lib/analytics-client.ts:66` (modified service, Plan 2)

**Analog:** itself — already has the `headers` object literal at L68-72.

**Current code** (analytics-client.ts L66-75):
```typescript
res = await fetch(`${ANALYTICS_URL}${path}`, {
  method,
  headers: {
    "Content-Type": "application/json",
    "X-Api-Version": ANALYTICS_API_VERSION,
    ...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY }),
  },
  ...(body !== null && { body: JSON.stringify(body) }),
  signal: AbortSignal.timeout(timeoutMs),
});
```

**Modification pattern** (per RESEARCH L360-376):
- Add `correlationId?: string` to the `options` parameter at L59.
- Resolve `const correlationId = options?.correlationId ?? crypto.randomUUID();` at top of function body.
- Add `"X-Correlation-Id": correlationId,` line to the headers object literal between `X-Api-Version` and the optional `X-Service-Key` spread.
- All exported wrappers (`computeAnalytics`, `fetchTrades`, `validateKey`, etc., L141+) accept an optional `correlationId` they thread through to `analyticsRequest`.
- Header name **`X-Correlation-Id`** (PascalCase-with-dashes per the existing `X-Api-Version` / `X-Service-Key` precedent at L70-71).

**Existing error class style to extend** (analytics-client.ts L26-46): `AnalyticsTimeoutError`, `AnalyticsUpstreamError` — preserve. No new error class needed for correlation_id propagation.

---

### `src/app/api/debug-key-flow/route.ts` (controller, SSE — Plan 7)

**Analogs:**
- `src/app/api/admin/strategy-review/route.ts` (admin gate via `withAdminAuth` + `logAuditEvent`)
- `src/lib/api/withAdminAuth.ts` (legacy admin-only wrapper — still pilot-active)
- RESEARCH §Pattern 3 L462-563 (SSE skeleton — no in-repo SSE precedent exists)

**Header / directive pattern** (CONVENTIONS.md §Route Handler Patterns + RESEARCH L470-473):
```typescript
import "server-only";
// ... other imports
export const dynamic = "force-dynamic";
export const runtime = "nodejs";  // Fluid Compute — NOT edge (RESEARCH Pitfall 2)
```

**Admin auth pattern** (`src/lib/api/withAdminAuth.ts` L14-44):
```typescript
const csrfError = assertSameOrigin(request as NextRequest);
if (csrfError) return csrfError;

const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();

if (!(await isAdminUser(supabase, user))) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
}
```
- 403 not 404 (per RESEARCH Security Domain L1184 — don't leak existence).
- `assertSameOrigin` from `@/lib/csrf` for CSRF defense-in-depth (mutating endpoints).

**Audit pattern** (`src/app/api/admin/strategy-review/route.ts` L57-90 + `src/lib/audit.ts` L62-71):
```typescript
const auditSupabase = await createClient();  // user-scoped client for auth.uid() resolution
logAuditEvent(auditSupabase, {
  action: "debug_key_flow.invoke",   // NEW action — extend AuditAction union in src/lib/audit.ts:85+
  entity_type: "debug_session",       // NEW entity — extend AuditEntityType in src/lib/audit.ts:151+
  entity_id: correlationId,
  metadata: { broker, admin_user_id: user!.id, rate_limit_remaining },
});
```
- **CRITICAL:** Add `"debug_key_flow.invoke"` to `AuditAction` union in `src/lib/audit.ts:85-141` AND `"debug_session"` to `AuditEntityType` union L151-184. ADR-0023 requires the two unions stay in sync.
- Audit BEFORE the work (RESEARCH L500-505) — guarantees a row even if the stream aborts.
- `logAuditEvent` is fire-and-forget; do NOT await (per `src/lib/audit.ts:60-71` JSDoc).

**SSE response pattern** (RESEARCH §Pattern 3 L506-562 — no in-repo precedent):
```typescript
const encoder = new TextEncoder();
const stream = new ReadableStream({
  async start(controller) {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      // ... per-step events ...
    } finally {
      controller.close();
    }
  },
  cancel() { /* client disconnect */ },
});

return new Response(stream, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",   // RESEARCH Pitfall 8 — disable Vercel proxy buffering
  },
});
```
- Hand-roll `data: ${json}\n\n` framing per RFC 6202 (no `next/server` SSE helper).
- Honor `req.signal` on outbound fetches so client cancel propagates to Railway.

**Rate-limit pattern** (in-memory counter — 5/hour/admin; CONVENTIONS.md §Route Handler Patterns L96-103 shows existing `checkLimit(userActionLimiter, ...)` Upstash pattern, but RESEARCH locks in-memory for Phase 16).

**Response-shape style** (CONVENTIONS.md §API Response Shape L150-162): Always `NextResponse.json(body, { status })`. Error: `{ error: "..." }`. Success status codes: 200, 403 (not 404), 429 (rate-limit), 503 (env not configured).

---

### `src/app/api/webhooks/resend/route.ts` (controller, webhook — Plan 5)

**Analog:** `src/app/api/admin/strategy-review/route.ts` (POST handler shape; admin-gated). Webhook-specific signature verification has NO in-repo precedent — research-only (RESEARCH L1037-1071).

**Webhook-specific pattern** (RESEARCH Example 2 L1038-1071):
- HMAC verify with `RESEND_WEBHOOK_SECRET` BEFORE parsing payload (RESEARCH Security Domain L1196).
- Path A: read `tags: [{name: "correlation_id", value: cid}]` array.
- Path B (always-on fallback per RESEARCH Pitfall 1): look up by `resend_message_id` in NEW `resend_message_correlation` table.
- Logger prefix `[resend-webhook]` per CONVENTIONS.md §Logging.

**Webhook auth NOTE:** This is NOT same-origin — `assertSameOrigin` MUST NOT be applied (Resend's webhook callback comes from external IP). Signature verification IS the auth. Document this in Plan 5 to prevent reviewer confusion.

---

### `src/app/error.tsx` + `src/app/global-error.tsx` (modified error boundaries — Plan 3)

**Analogs:** themselves — both already exist with TODO markers calling for Sentry wiring.

**Existing `error.tsx` shape** (L1-48, locked design — only modify L18-21):
```tsx
"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error);
    // TODO: wire Sentry.captureException(error) once observability is set up   <-- REPLACE THIS
  }, [error]);
  // ... visual block (DO NOT TOUCH per CONTEXT — site-wide rollout deferred to Phase 17)
}
```

**Modification (Plan 3)** — replace L18-21 useEffect body with:
```tsx
useEffect(() => {
  console.error("[error-boundary]", error);
  if (typeof window !== "undefined") {
    // dynamic import to avoid bundling Sentry into static pages that never render the boundary
    import("@sentry/nextjs").then((Sentry) => {
      Sentry.captureException(error, {
        tags: {
          digest: error.digest,
          correlation_id: getCorrelationIdFromMeta(),  // read from <meta name="x-correlation-id">
        },
      });
    });
  }
}, [error]);
```
- Mirror `src/instrumentation.ts:17-31` (which already does `await import("@sentry/nextjs")` lazy import + `Sentry.captureException(error, { tags, extra })`).
- `correlation_id` source: Plan 2 must arrange for Next.js to render a `<meta name="x-correlation-id" content="...">` tag in the root layout so client error boundaries can read it (or use a client-side context). Planner should pick the cleanest seam.

**`global-error.tsx`** — same modification at L17-20. Visual block (L23-82) is intentionally inline-styled because the root layout is replaced; do NOT touch the styling per CONTEXT.

**Logger prefix** preserved: `[error-boundary]` and `[global-error]` (CONVENTIONS.md §Logging).

---

### `src/instrumentation.ts` (modified, Plan 3)

**Analog:** itself — already wires Sentry init + `onRequestError`.

**Existing `onRequestError` shape** (L12-32):
```typescript
export async function onRequestError(
  error: { digest?: string },
  request: { path: string; method: string; headers: Record<string, string> },
  context: { ... },
) {
  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, {
      tags: { routerKind, routePath, routeType },
      extra: { path, method, digest },
    });
  }
}
```

**Plan 3 modification:** Add `correlation_id: request.headers["x-correlation-id"]` to the `tags` object (NOT `extra` — tags are queryable in the Sentry UI per RESEARCH §Architectural Responsibility Map L130).

---

### `analytics-service/main.py` (modified, Plan 2 + Plan 3)

**Analog:** itself.

**Existing Sentry init** (`analytics-service/main.py` L28-40):
```python
SENTRY_DSN = os.getenv("SENTRY_DSN")
if SENTRY_DSN:
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            traces_sample_rate=0.1,
            send_default_pii=False,
            before_send_transaction=lambda event, hint: event,
        )
    except ImportError:
        logging.getLogger("quantalyze.analytics").warning("SENTRY_DSN set but sentry-sdk not installed")
```

**Plan 3 upgrade pattern** (RESEARCH §Pattern 2 L438-449 + Example 1 L972-1014):
- Add `from sentry_sdk.integrations.fastapi import FastApiIntegration` and `from sentry_sdk.integrations.starlette import StarletteIntegration` imports.
- Add `integrations=[StarletteIntegration(), FastApiIntegration()]` kwarg.
- Add `before_send=_redact_before_send` kwarg.
- Add `environment=os.getenv("RAILWAY_ENVIRONMENT_NAME", "development")`.
- The `_redact_before_send` function MUST be wrapped in `try/except` returning the unmodified event on error (RESEARCH Pitfall 6) — preserves the existing "fail open" pattern (CONVENTIONS.md §Error Handling: "graceful degradation, audit emission" idiom).
- PII denylist mirrors `src/lib/admin/pii-scrub.ts` L16-25 (`apikey`, `apisecret`, `secret`, `signature`, `passphrase`, `authorization`, `x-mbx-apikey`, `ok-access-sign`).

**Existing CORS / middleware chain** (main.py L168-200):
```python
app.add_middleware(CORSMiddleware, ...)

@app.middleware("http")
async def verify_service_key(request: Request, call_next):
    # ...
    return await call_next(request)

app.include_router(analytics.router)
# ... other routers
```

**Plan 2 CorrelationMiddleware insertion point:** Add `app.add_middleware(CorrelationMiddleware)` BEFORE `app.add_middleware(CORSMiddleware, ...)` so it runs OUTERMOST (per RESEARCH Pitfall 3 — bind/clear contextvars at request boundary).

**Logger pattern preserved** (main.py L23-26): `logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format=...)` stays. structlog wraps stdlib logging; both can coexist.

---

### `analytics-service/services/logging_config.py` (NEW, Plan 2)

**Analog:** `analytics-service/main.py:23-26` (existing root logging.basicConfig — closest precedent for a one-shot configuration block).

**Module conventions** (CONVENTIONS.md §Naming + STRUCTURE.md analytics-service/services/):
- Filename `snake_case.py` ✓ (`logging_config.py`).
- `from __future__ import annotations` at top (CONVENTIONS.md §Language).
- One concept per file.

**Pattern** (RESEARCH §Pattern 2 L389-428 + Library Quick Reference L1336-1366):
```python
from __future__ import annotations
import structlog
import sentry_sdk
from starlette.middleware.base import BaseHTTPMiddleware
from uuid import uuid4

def configure_logging() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(sort_keys=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(20),
        cache_logger_on_first_use=True,
    )

class CorrelationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        cid = request.headers.get("x-correlation-id") or str(uuid4())
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            correlation_id=cid,
            method=request.method,
            path=request.url.path,
        )
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("correlation_id", cid)
            try:
                response = await call_next(request)
            finally:
                structlog.contextvars.clear_contextvars()  # CRITICAL — RESEARCH Pitfall 3
        response.headers["x-correlation-id"] = cid
        return response
```

**Type hints required** (CONVENTIONS.md §Language: "Type hints required on public service functions").

---

### `analytics-service/routers/debug_key_flow.py` (NEW, Plan 7 internal endpoint)

**Analog:** `analytics-service/routers/internal.py` (X-Internal-Token gate; called by Next.js with `INTERNAL_API_TOKEN` per existing pattern documented in main.py L184-191).

**Pattern (per analog at routers/internal.py — referenced by main.py L184-191):**
- `APIRouter(prefix="/internal/debug-key-flow")`.
- X-Internal-Token verified via `secrets.compare_digest` (mirrors main.py L197 `verify_service_key` pattern).
- Pydantic request model (CONVENTIONS.md §Language; STACK.md `pydantic==2.11.3`).
- Per-step endpoints (`/validate`, `/encrypt`, `/fetch-trades`) called sequentially by the Next.js SSE handler.
- Decryption reuses `analytics-service/services/encryption.py` `decrypt_credentials` for `DEBUG_KEY_FLOW_*` env-blob round-trip (RESEARCH §Standard Stack L157).

---

### `analytics-service/tests/test_trigger_rls_audit.py` (NEW, Plan 4)

**Analog:** `analytics-service/tests/test_audit.py` (mock + monkeypatch fire-and-forget pattern).

**Module-level conventions** (test_audit.py L1-30):
```python
"""Unit tests for analytics-service/services/audit.py.

Sprint 6 closeout Task 7.1b — ...

Asserted invariants:
  1. ...
  2. ...
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch
import pytest

from services import audit as audit_module
```
- Top-of-file docstring with sprint/phase reference + numbered invariants.
- `from __future__ import annotations` always.
- `pytest` + `unittest.mock` style (NOT `pytest-mock` exclusively).

**Live-DB / psycopg pattern (RESEARCH §Pattern 6 L760-829):**
- `psycopg.connect(DSN, row_factory=dict_row, autocommit=True)` — DSN sourced from `TEST_SUPABASE_DB_URL` env (per MEMORY reference: `qmnijlgmdhviwzwfyzlc` test project + 4 GH secrets/var wired).
- Test gated by `pytest.mark.skipif(not os.environ.get("TEST_SUPABASE_DB_URL"), ...)` — mirrors the `vars.E2E_TEST_DB_CONFIGURED == 'true'` gate pattern in `.github/workflows/ci.yml:188`.
- `fresh_user_id` fixture creates + cleans up an `auth.users` row.
- Each test asserts trigger fires under service-role context (where `auth.uid()` returns NULL), proving the migration uses `NEW.user_id` not `auth.uid()` (RESEARCH Pitfall 5).

**Naming:** `test_trigger_rls_audit.py` (snake_case, `test_` prefix per CONVENTIONS.md §Naming "Python tests `test_<module>.py`").

---

### `analytics-service/tests/test_logging_config.py` + `test_sentry_init.py` + `test_correlation_middleware.py` (NEW, Plan 2 + Plan 3)

**Analog:** `analytics-service/tests/test_audit.py` (mock-based unit test of fire-and-forget contract — closest match for testing a side-effect-only module).

**Test structure pattern** (test_audit.py L48-60):
```python
class TestLogAuditEventHappyPath:
    def test_calls_rpc_with_expected_shape(self, monkeypatch):
        supabase, rpc = _mock_supabase_with_rpc()
        monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

        log_audit_event(
            user_id=DUMMY_USER,
            action="bridge.score_candidates",
            ...
        )
```
- Class-grouped tests (`TestX` PascalCase + `test_y` snake_case methods).
- `monkeypatch.setattr` for module-scoped global replacement.
- Helper `_mock_supabase_with_rpc()` returns `(client, rpc_mock)` for assertion.
- `pytest_asyncio` via `asyncio_mode = auto` in `pytest.ini` (CONVENTIONS.md §Linting & Formatting) — async tests just `async def test_...`, no decorator needed.

**Sentry init test (research-only — RESEARCH Pitfall 6):** Feed a malformed event into `_redact_before_send`; assert it returns the original event without raising.

**Correlation middleware test:** Use `httpx.AsyncClient(app=app)` style (existing `httpx==0.28.1` dependency per requirements.txt:13). Send a request with `x-correlation-id`, assert response echoes header back AND structlog log line includes the cid.

---

### `analytics-service/tests/conftest_vcr.py` + `tests/cassettes/{broker}/{scenario}.yaml` (NEW, Plan 8)

**Analog for conftest_vcr.py:** `analytics-service/tests/conftest.py` (sibling fixture file; existing fixtures use `@pytest.fixture` + `Path(__file__).parent / "fixtures"` for paths).

**Analog for cassettes:** `analytics-service/tests/fixtures/golden_252d_input.parquet` (committed deterministic binary fixture precedent — STRUCTURE.md `analytics-service/tests/fixtures/`).

**Pattern (RESEARCH §Pattern 4 L578-633 + Library Quick Reference L1370-1395):**
```python
import json, re
import vcr

_FILTER_HEADERS = ["authorization", "x-api-key", "x-api-signature",
                   "x-passphrase", "x-mbx-apikey",
                   "ok-access-sign", "ok-access-passphrase",
                   "ok-access-key", "ok-access-timestamp"]

_REDACT_BODY_KEYS = ["accountId", "userId", "email", "address", "ip", "ipAddress"]
_REDACT_VALUE = "[REDACTED]"

def _scrub_response(response):
    """Mirrors src/lib/admin/pii-scrub.ts denylist."""
    # walk JSON body, replace denylisted keys with [REDACTED]

phase16_vcr = vcr.VCR(
    cassette_library_dir="tests/cassettes",
    serializer="yaml",
    record_mode="once",   # CI: replay-only
    match_on=["method", "scheme", "host", "port", "path", "query"],
    filter_headers=_FILTER_HEADERS,
    before_record_response=_scrub_response,
)
```

**PII denylist mirror** (`src/lib/admin/pii-scrub.ts` L16-25 — REUSE these exact key names):
- `apikey`, `apisecret`, `secret`, `signature`, `passphrase`, `authorization`, `x-mbx-apikey`, `ok-access-sign`.
- Add OKX-specific: `ok-access-key`, `ok-access-timestamp`, `ok-access-passphrase`, `x-passphrase`.

**Cassette path convention:** `tests/cassettes/{broker}/{scenario}.yaml` per CONTEXT.md decisions section. 12 files = 3 brokers × 4 scenarios.

---

### `scripts/repro-key-flow.sh` (NEW, Plan 8)

**Analog:** `scripts/check-banned-packages.mjs` (CI gate script — different language but same exit-code contract: 0 = pass, 1 = fail with stderr explanation).

**Shell convention:**
- `set -euo pipefail` first line (defensive shell — implied by other scripts; not enforced project-wide).
- Run from repo root or `cd analytics-service` early.
- Stable stderr prefix per CONVENTIONS.md §Logging — use `[repro-key-flow]` for any script-level diagnostics.
- Exit 1 on first failure with a clear single-line cause.

**Pattern** (RESEARCH L640-658):
```bash
#!/usr/bin/env bash
set -euo pipefail
cd analytics-service

# 1. Run the replay suite
pytest tests/test_repro_key_flow.py -x -q

# 2. CI gate: grep cassettes for ANY known DEBUG_KEY_FLOW_* env value
for var in DEBUG_KEY_FLOW_OKX_KEY DEBUG_KEY_FLOW_OKX_SECRET ...; do
  val="${!var:-}"
  if [ -n "$val" ] && grep -r -F "$val" tests/cassettes/ 2>/dev/null; then
    echo "FAIL: $var leaked into cassettes"
    exit 1
  fi
done
echo "OK: no DEBUG_KEY_FLOW_* values found in cassettes"
```

**README documentation:** Per CONTEXT.md §Specifics ("documented in repo README troubleshooting section"). Add a "Local repro of key flow" subsection to README.md pointing at this script.

---

### `analytics-service/requirements.txt` (MODIFIED)

**Analog:** itself — file is alphabetical-ish with phase-tagged section headers (e.g., L7-9 `# Phase 12 / WR-02:` and L17-19 `# Phase 15 / CSV-01..CSV-02`).

**Modification pattern** (RESEARCH L171-191 — exact diff):
```diff
 fastapi==0.115.12
 ... existing pins ...
 pandera==0.20.4
 python-multipart==0.0.27
+# Phase 16 / OBSERV-05 + OBSERV-09 + OBSERV-08
+sentry-sdk[fastapi]==2.58.0
+structlog==25.5.0
+vcrpy==8.1.1
```
- Phase-tagged comment header above the new pins (matches L7, L17 style).
- Exact `==` pinning for new deps (matches existing pin discipline; no `>=` except `ccxt>=4.0` and `cryptography>=44.0` legacy pins).

---

### `.github/workflows/ci.yml` (MODIFIED, Plan 1 — OBSERV-12 presence-check step)

**Analog:** `.github/workflows/ci.yml` `frontend` job, L22-23:
```yaml
      - name: Check for banned packages (supply-chain)
        run: node scripts/check-banned-packages.mjs
```

**Pattern:** Same job (`frontend`), insert a new step adjacent to the banned-packages step:
```yaml
      - name: OBSERV-12 — restore-e2e-fixtures presence assertion
        run: |
          test -f e2e/api-key-flow.spec.ts || { echo "OBSERV-12: e2e/api-key-flow.spec.ts missing"; exit 1; }
          test -f scripts/seed-full-app-demo.ts || { echo "OBSERV-12: scripts/seed-full-app-demo.ts missing"; exit 1; }
          test -f src/lib/observability.ts || { echo "OBSERV-12: src/lib/observability.ts missing"; exit 1; }
```

**Verified at pattern-mapping time** — all three files exist in the working tree (paths confirmed via `ls -la`):
- `e2e/api-key-flow.spec.ts` (9861 bytes)
- `scripts/seed-full-app-demo.ts` (59393 bytes)
- `src/lib/observability.ts` (927 bytes)

**Alternative:** wrap in a Vitest test under `src/__tests__/observ12-fixtures-presence.test.ts` (mirrors `src/__tests__/critical-regressions.test.ts` L46-52 — `readText("VERSION")` pattern). The Vitest version self-runs in `npm test` (already in CI L21) — no separate workflow step needed. **Recommend this latter approach** since it slots into the existing critical-regressions style and gates within the test suite.

---

### `.planning/phase-16/{day-2-decision,posthog-mobile-audit,trigger-rls-audit}.md` (NEW docs)

**Analog:** RESEARCH.md §1201-1310 (Day-2 template scaffold — fully specified) + sibling existing file `.planning/phase-16/migration-drift-resolution.md` for tone.

**Day-2 frontmatter pattern** (RESEARCH L1208-1218):
```markdown
---
gate: phase-16-exit-day-2-decision
status: <PENDING | SKIP | COMMIT | HOLD>
decided_at: "<ISO8601>"
decided_by: <name>
deliberation_started_at: "<ISO8601>"
deliberation_minutes: <integer, MUST be >= 120>
correlation_id_evidence_chain:
  - <correlation_id-1>
---
```

**Section structure:** TL;DR → Section 1 (Candidate Root Causes) → Section 2 (Regression Test Snippet) → Section 3 (Refutation, conditional on SKIP) → Section 4 (Falsifiable Criteria) → Section 5 (Evidence Chain table) → Section 6 (Decision).

**posthog-mobile-audit.md** + **trigger-rls-audit.md:** Plain markdown deliverables (no frontmatter required); summary line appended to TODOS.md per CONTEXT.md decisions L120-128.

---

## Shared Patterns

### A. server-only directive (apply to all NEW server-side TS modules)

**Source:** `src/lib/audit.ts:1`, `src/lib/api/withAdminAuth.ts:1`
**Apply to:** `src/lib/correlationId.ts`, `src/lib/envelope.ts`, `src/app/api/debug-key-flow/route.ts`, `src/app/api/webhooks/resend/route.ts`
```typescript
import "server-only";
```
First line, exact double-quotes. Tests neuter via `vi.mock("server-only", () => ({}));`.

### B. "use client" directive (apply to all NEW client components)

**Source:** `src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx:1`, `src/app/error.tsx:1`
**Apply to:** `src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx`
```tsx
"use client";
```
First line. No React import (`jsx: "react-jsx"`).

### C. Logger prefix convention

**Source:** CONVENTIONS.md §Logging L198-208; `src/lib/audit.ts:267,279`
**Apply to:** every NEW console/logger call site
- TS: `console.error("[<module-tag>] description:", { code, message });`
- Python: `logging.getLogger("quantalyze.<module>")` + stable bracketed prefix in message.
- New Phase 16 prefixes recommended: `[correlation-id]`, `[debug-key-flow]`, `[resend-webhook]`, `[repro-key-flow]`, `[error-boundary]` (preserved), `[global-error]` (preserved).
- Never log secrets / full request bodies — log structured context (ids, codes, messages) only.

### D. Path alias `@/` for intra-project imports

**Source:** CONVENTIONS.md §Import Organization; `tsconfig.json` paths
**Apply to:** every NEW TS module
```typescript
import { Button } from "@/components/ui/Button";
import { logAuditEvent } from "@/lib/audit";
import { isAdminUser } from "@/lib/admin";
```
Only sibling files in the same directory may use relative imports.

### E. Audit-action / entity-type union extension (CRITICAL for Plan 7)

**Source:** `src/lib/audit.ts:85-184` (AuditAction + AuditEntityType discriminated unions)
**Apply to:** any new audit-emitting route
- New `debug_key_flow.invoke` action MUST be added to the `AuditAction` union L85-141.
- New `debug_session` entity_type MUST be added to the `AuditEntityType` union L151-184.
- Per ADR-0023, action names are namespaced `subject.verb` and the union is the compile-time taxonomy enforcement.
- Mirror the Python side in `analytics-service/services/audit.py:56-61` if Plan 7 emits the audit from the FastAPI worker (current research-recommended path: emit from Next.js tier).

### F. Fire-and-forget audit emission

**Source:** `src/lib/audit.ts:60-71`, `src/lib/audit.ts:202-218`
**Apply to:** `src/app/api/debug-key-flow/route.ts`, `src/app/api/webhooks/resend/route.ts`, any NEW route that mutates state
```typescript
const supabase = await createClient();
logAuditEvent(supabase, {
  action: "debug_key_flow.invoke",
  entity_type: "debug_session",
  entity_id: correlationId,
  metadata: { broker, admin_user_id: user!.id },
});
return NextResponse.json({ success: true });   // do NOT await the audit call
```
- Returns void. Never await. Never let an audit failure 500 the request.

### G. CSRF defense for mutating routes

**Source:** `src/lib/api/withAdminAuth.ts:17-18`; CONVENTIONS.md §Route Handler Patterns L84-87
**Apply to:** `src/app/api/debug-key-flow/route.ts` (POST)
```typescript
const csrfError = assertSameOrigin(req as NextRequest);
if (csrfError) return csrfError;
```
- **EXCLUDE** `src/app/api/webhooks/resend/route.ts` — webhook callbacks are cross-origin by design; signature verification is the auth.

### H. Zod request validation

**Source:** CONVENTIONS.md §Route Handler Patterns L108-116
**Apply to:** any NEW route accepting a JSON body
```typescript
const SCHEMA = z.object({ broker: z.enum(["okx","binance","bybit"]) });
const rawBody = await req.json().catch(() => null);
const parsed = SCHEMA.safeParse(rawBody);
if (!parsed.success) {
  return NextResponse.json(
    { error: "Invalid request body", issues: parsed.error.issues },
    { status: 400 },
  );
}
```
- Schema name: SCREAMING_SNAKE or PascalCase + `_SCHEMA` suffix.
- Defined at module top.

### I. Sentry lazy import + tag pattern

**Source:** `src/instrumentation.ts:17-31`
**Apply to:** `src/app/error.tsx`, `src/app/global-error.tsx`
```typescript
const Sentry = await import("@sentry/nextjs");
Sentry.captureException(error, {
  tags: { correlation_id, ... },   // tags are queryable in Sentry UI
  extra: { ... },                   // extra is metadata-only
});
```
- Lazy `await import(...)` keeps Sentry out of the static bundle.
- Gate on `process.env.SENTRY_DSN` (preserved from existing `src/instrumentation.ts:2,17`).

### J. Python type hints + `from __future__ import annotations`

**Source:** CONVENTIONS.md §Language; `analytics-service/services/audit.py:45-48`
**Apply to:** every NEW Python module
```python
"""Module docstring with sprint/phase reference + invariants."""

from __future__ import annotations

from typing import Any  # if using Any
```

### K. Phase-tagged requirements pin comment

**Source:** `analytics-service/requirements.txt:7,17` (`# Phase 12 / WR-02:`, `# Phase 15 / CSV-01..CSV-02:`)
**Apply to:** any new pin in `requirements.txt`
```
# Phase 16 / OBSERV-05 + OBSERV-09 + OBSERV-08
sentry-sdk[fastapi]==2.58.0
```

### L. Test-file naming + co-location

**Source:** CONVENTIONS.md §Naming Patterns L42-43; STRUCTURE.md L478-483
**Apply to:** all NEW tests
- Unit TS: co-located `<file>.test.ts[x]` (e.g., `WizardErrorEnvelope.test.tsx` next to component).
- Integration TS: `src/__tests__/<name>.test.ts`.
- Python: `analytics-service/tests/test_<module>.py`.
- E2E: `e2e/<journey>.spec.ts`.

### M. Tailwind tokens only — no hex colors

**Source:** CONVENTIONS.md §Design System Conformance L246-260; `src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx` L65-94
**Apply to:** `src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx`
- Use semantic tokens: `border-negative/30`, `bg-negative/5`, `text-negative`, `text-text-secondary`, `text-text-muted`, `border-border`, `bg-page`, `text-accent`.
- Min-height `44px` on interactive buttons (touch target).
- Class concatenation via `cn(...)` from `@/lib/utils`.

### N. Skipif gate for live-DB / external-secret tests

**Source:** `.github/workflows/ci.yml:188` (`vars.E2E_TEST_DB_CONFIGURED == 'true'`)
**Apply to:** `analytics-service/tests/test_trigger_rls_audit.py`
```python
@pytest.mark.skipif(
    not os.environ.get("TEST_SUPABASE_DB_URL"),
    reason="Live test Supabase project not configured (TEST_SUPABASE_DB_URL unset)",
)
def test_migration_084_stamp_first_api_key_added_fires_under_service_role(...):
    ...
```
Mirrors `vars.E2E_TEST_DB_CONFIGURED == 'true'` precedent so tests self-skip on fork PRs.

### O. Branded comments referencing the phase / REQ

**Source:** CONVENTIONS.md §Comments & Documentation L218-228; `src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx:5-13` (`Phase 15 / CSV-01..CSV-02 — server validation error envelope ...`)
**Apply to:** every NEW Phase 16 file
- Top-of-file JSDoc block explaining contract + REQ ID(s) (e.g., `Phase 16 / OBSERV-06 — wizard error envelope component`).
- Inline comments reference the REQ that drives the non-obvious branch.

---

## No Analog Found

Files where the pattern is research-only (no in-repo precedent — planner consumes RESEARCH.md sections):

| File | Role | Data Flow | Reason | Authoritative Source |
|------|------|-----------|--------|---------------------|
| `src/app/api/debug-key-flow/route.ts` (SSE body) | controller | streaming SSE | No existing SSE Route Handler in `src/app/api/**`. Hand-rolled `ReadableStream` per Next.js 16 docs is the only pattern. | RESEARCH §Pattern 3 L454-563; Next.js 16 docs at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` L401-481 |
| `analytics-service/services/logging_config.py` | utility | event-driven (per-request bind) | structlog has zero existing usage in repo. RESEARCH §Pattern 2 + Library Quick Reference L1336-1366 are the only sources. | RESEARCH §Pattern 2 L389-428; Library Quick Reference L1336-1366 |
| `analytics-service/tests/conftest_vcr.py` + cassettes | test fixture | record/replay | No vcrpy usage in repo (existing `analytics-service/tests/test_exchange.py` uses inline mocks, not cassettes). | RESEARCH §Pattern 4 L578-633; Library Quick Reference L1370-1395 |
| `src/app/api/webhooks/resend/route.ts` (signature verify) | controller | webhook in | No existing webhook receiver in `src/app/api/**`. Resend signature verification has no in-repo precedent. | RESEARCH §Example 2 L1037-1071; RESEARCH §Common Pitfalls Pitfall 1 L876-885 |

---

## Phase-Specific Notes for the Planner

1. **WizardErrorEnvelope visual contract is locked** — the `CsvValidationEnvelope.tsx` analog already documents (L13, L89) the exact OBSERV-06 carrier-marker shape. Do NOT introduce a new visual treatment; mirror it. Phase 17 owns the global rollout per CONTEXT.md "Out of scope" + UC-D.

2. **`getCorrelationIdFromMeta` requires a server-side render hook** — Plan 3's `error.tsx` modification depends on the root layout rendering `<meta name="x-correlation-id" content="...">`. Plan 2 should add this to `src/app/layout.tsx` (NOT covered in CONTEXT.md explicitly — flag for planner discretion).

3. **Naming inconsistency to flag in Plan 2 review:** RESEARCH.md uses `correlationId.ts` (camelCase), CONVENTIONS.md says lib modules should be `correlation-id.ts` (kebab-case per `analytics-client.ts`, `alert-ack-token.ts`). Pick one and apply consistently across the file, the test file, and PATTERNS references.

4. **Audit union extension is a hard prerequisite** — Plan 7 cannot ship until `src/lib/audit.ts:85-184` adds `"debug_key_flow.invoke"` action and `"debug_session"` entity_type. ADR-0023 mandates the unions stay in sync; the typecheck fails otherwise.

5. **OBSERV-12 implementation choice (Plan 1):** Two valid analogs — (a) new GH workflow step adjacent to L22-23 banned-packages step, OR (b) Vitest test file in `src/__tests__/` mirroring `critical-regressions.test.ts`. Recommend (b) because it slots into existing `npm test` step in CI and follows the existing critical-regressions precedent. Either is acceptable.

6. **`scripts/repro-key-flow.sh` README documentation requirement** — CONTEXT.md §Specifics requires the script to be documented in the repo README troubleshooting section. Plan 8 should explicitly include the README edit as part of its diff.

7. **Webhook fallback table** — `resend_message_correlation` (Plan 5 fallback Path B per Pitfall 17) is a NEW table NOT in the migration audit list (CONTEXT only audits 084/085/086). Plan 5 needs a NEW migration `supabase/migrations/059_resend_message_correlation.sql` (next free number per STRUCTURE.md L457). Add this dependency note to the planner.

8. **`X-Correlation-Id` header casing** — preserve the PascalCase-with-dashes form on the wire (matching existing `X-Api-Version` / `X-Service-Key` precedent at `src/lib/analytics-client.ts:70-71`). Internally, use lower-case for `headers.get()` (HTTP normalization).

## Metadata

**Analog search scope:**
- `src/app/(dashboard)/strategies/new/wizard/**` (component analog tree)
- `src/lib/**` (utility analog tree)
- `src/app/api/admin/**` + `src/lib/api/**` (admin route + auth wrapper analogs)
- `src/app/error.tsx` + `src/app/global-error.tsx` + `src/instrumentation.ts` (existing boundaries)
- `analytics-service/{main.py, services/, routers/, tests/, requirements.txt}` (Python tier)
- `.github/workflows/ci.yml` + `scripts/` (CI + ops scripts)
- `.planning/codebase/{CONVENTIONS,STRUCTURE,STACK}.md` (cross-cutting conventions)

**Files scanned:** 24 analog files inspected; 3 cross-cutting docs read in full.

**Pattern extraction date:** 2026-05-01

**Key insight:** Phase 16 is library-heavy wiring on top of an unusually well-scaffolded codebase. 22 of 24 new/modified files have an exact or role-match analog in the existing tree. Only the SSE Route Handler, structlog/Sentry FastAPI middleware, vcrpy cassette harness, and Resend webhook receiver are research-only — and even those follow established repo conventions for module shape, naming, error handling, and audit. The planner can copy-paste the analog scaffolding for everything else.

## PATTERN MAPPING COMPLETE
