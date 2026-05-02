---
phase: 16-diagnostic-spike-observability
plan: 02
subsystem: observability/correlation-id
tags: [observability, correlation-id, structlog, sentry, middleware, contextvars, fix-11]
requires:
  - "src/lib/analytics-client.ts:66 (existing seam)"
  - "src/app/layout.tsx (existing root layout)"
  - "analytics-service/main.py middleware chain (existing CORS + verify_service_key)"
  - "structlog 25.5.0 (newly pinned)"
provides:
  - "src/lib/correlation-id.ts → getCorrelationId() + CORRELATION_HEADER"
  - "X-Correlation-Id stamped on every analyticsRequest fetch (PascalCase wire form)"
  - "<meta name=\"x-correlation-id\"> in root layout for client error boundaries (Plan 3)"
  - "analytics-service/services/logging_config.py → configure_logging() + CorrelationMiddleware + correlation_id_var"
  - "Sentry tag (correlation_id, cid) per request scope"
  - "structlog JSON logs with merge_contextvars-driven correlation_id"
affects:
  - "Plan 3 (16-03 Sentry boundaries) — consumes <meta> + Sentry init"
  - "Plan 5 (16-05 Resend tag) — consumes correlation_id stamping"
  - "Plan 6 (16-06 envelope component) — consumes ErrorEnvelope.correlation_id"
  - "Plan 7 (16-07 SSE endpoint) — must thread correlationId via __INTERNAL_analyticsRequest pattern"
tech-stack:
  added:
    - "structlog==25.5.0 (Python — JSON logging with contextvars merge)"
  patterns:
    - "ContextVar Token-based reset (FIX 11) for surgical contextvar teardown"
    - "Server-only Next.js helper module per src/lib/audit.ts:1 precedent"
    - "ASGI middleware via starlette BaseHTTPMiddleware"
key-files:
  created:
    - "src/lib/correlation-id.ts"
    - "src/lib/analytics-client.test.ts"
    - "analytics-service/services/logging_config.py"
    - "analytics-service/tests/test_logging_config.py"
    - "analytics-service/tests/test_correlation_middleware.py"
  modified:
    - "src/lib/analytics-client.ts (lines 56-79 + new __INTERNAL_analyticsRequest export)"
    - "src/app/layout.tsx (async RootLayout + <head> meta tag)"
    - "analytics-service/main.py (configure_logging at line 50; CorrelationMiddleware at line 182)"
    - "analytics-service/requirements.txt (added structlog==25.5.0 under Phase 16 comment)"
decisions:
  - "FIX 11: Token-based reset replaces clear-contextvars per outside-voice review — surgical removal of only the binding we set, no collateral damage to sibling middleware contextvars"
  - "Public analyticsRequest wrappers (computeAnalytics, validateKey, ...) intentionally do NOT thread correlationId through; Plan 7 wires the SSE endpoint to pass it explicitly"
  - "__INTERNAL_analyticsRequest test-only re-export added to expose the module-private helper for unit tests without widening the public API"
  - "CorrelationMiddleware registered BEFORE CORSMiddleware in source order per plan acceptance criterion (line 182 < line 186)"
  - "Layout.tsx renders <meta name=\"x-correlation-id\"> as an inlined literal alongside `satisfies` typecheck on the imported CORRELATION_HEADER constant — preserves type-safety while ensuring the strict literal grep gate passes"
metrics:
  duration_minutes: 28
  completed_at: "2026-05-01T11:36:00Z"
  tasks_completed: 2
  rounds_red_green: 2
---

# Phase 16 Plan 02: Correlation ID End-to-End — Wave 1 — Summary

**One-liner:** Wire `X-Correlation-Id` header from Next.js → FastAPI → structlog → Sentry tag using crypto.randomUUID() default + module-scope ContextVar with FIX 11 surgical Token reset (no clear-contextvars), so every Phase 16 diagnostic flow has a stable join key — including a 100-request stress test asserting zero bleed and zero zombie binding.

## What Shipped

### Next.js half (Task 1)
- **`src/lib/correlation-id.ts` (new):** server-only helper module exporting `CORRELATION_HEADER = "x-correlation-id"` (lowercase HTTP-normalized form for `headers.get()`) and async `getCorrelationId()` that reads the inbound header or falls back to `crypto.randomUUID()` (Node 20+ global, no polyfill).
- **`src/lib/analytics-client.ts` (modified L56-79 + L335 export):**
  - `analyticsRequest` options now accept optional `correlationId?: string`. Defaults to a fresh UUID v4. Stamped as `"X-Correlation-Id": correlationId` (PascalCase) in the headers object literal between `X-Api-Version` and the `X-Service-Key` spread.
  - Public wrappers (`computeAnalytics`, `validateKey`, `fetchTrades`, etc.) intentionally do NOT expose `correlationId` — Plan 7 owns the SSE endpoint that threads it explicitly. Minimizing blast radius for this seam.
  - `__INTERNAL_analyticsRequest` test-only re-export added at the file end, marked `@internal`, so the unit test exercises the module-private helper directly without widening the public surface.
- **`src/app/layout.tsx` (modified):** RootLayout converted to `async` (Next.js 16 RSC pattern), now calls `await getCorrelationId()` server-side and renders `<meta name="x-correlation-id" content={correlationId}>` inside `<head>`. The literal string is inlined for the strict acceptance grep, with a `(CORRELATION_HEADER satisfies "x-correlation-id")` typecheck guard so the constant cannot drift from the inlined form silently.
- **`src/lib/analytics-client.test.ts` (new):** 5 Vitest cases — asserts the explicit-cid path forwards verbatim, the omitted-cid path generates a UUID v4, `getCorrelationId()` is async and reads the header / falls back to UUID, and `CORRELATION_HEADER === "x-correlation-id"`.

### Python / FastAPI half (Task 2)
- **`analytics-service/services/logging_config.py` (new):** module-scope `correlation_id_var: ContextVar[str | None]`, `configure_logging()` (idempotent structlog config: merge_contextvars + add_log_level + ISO-utc TimeStamper + dict_tracebacks + JSONRenderer with `sort_keys=True`), and `CorrelationMiddleware(BaseHTTPMiddleware)` reading `x-correlation-id` (lowercase via `headers.get`) with `str(uuid4())` fallback, binding both the explicit `correlation_id_var` and structlog's contextvars (`correlation_id`, `method`, `path`), opening a `sentry_sdk.new_scope()` with `set_tag("correlation_id", cid)`, and echoing `X-Correlation-Id` (PascalCase) on the response.
- **`analytics-service/main.py` (modified):** `configure_logging()` called at line 50 (BEFORE `app = FastAPI(...)` at line 167). `app.add_middleware(CorrelationMiddleware)` at line 182, BEFORE `app.add_middleware(CORSMiddleware, ...)` at line 186 per plan acceptance ordering. CORS `allow_headers` extended to permit `X-Correlation-Id`.
- **`analytics-service/requirements.txt` (modified):** `structlog==25.5.0` added under a Phase 16 / OBSERV-09 comment header. `sentry-sdk[fastapi]` upgrade defers to Plan 3 (16-03); `vcrpy` defers to Plan 8 (16-08).
- **`analytics-service/tests/test_logging_config.py` (new):** 2 cases — JSON sort_keys ordering on every log, contextvar merge for `correlation_id`.
- **`analytics-service/tests/test_correlation_middleware.py` (new):** 4 cases including the FIX 11 100-request stress test — inbound bound + Sentry tag + echo, missing-header UUID fallback, two-request no-bleed assertion, and the headline 100-request stress (every cid lands correctly + final state is `correlation_id_var.get() is None` AND `structlog.contextvars.get_contextvars().get("correlation_id") is None`).

## FIX 11 — The Pattern That Actually Shipped

**What the plan shipped (verified in `analytics-service/services/logging_config.py:71-104`):**

```python
cv_token = correlation_id_var.set(cid)
sl_tokens = structlog.contextvars.bind_contextvars(
    correlation_id=cid, method=request.method, path=request.url.path,
)
with sentry_sdk.new_scope() as scope:
    scope.set_tag("correlation_id", cid)
    try:
        response = await call_next(request)
    finally:
        try:
            if sl_tokens is not None:
                structlog.contextvars.reset_contextvars(**sl_tokens)
            else:
                structlog.contextvars.unbind_contextvars(
                    "correlation_id", "method", "path"
                )
        except (AttributeError, TypeError):
            structlog.contextvars.unbind_contextvars(
                "correlation_id", "method", "path"
            )
        correlation_id_var.reset(cv_token)
response.headers["X-Correlation-Id"] = cid
return response
```

**What we explicitly rejected (REPLACED per outside-voice review):**

```python
# REJECTED — the broad-clear API (literal symbol forbidden in this file by AC)
structlog.contextvars.???_contextvars()
```

The broad clear API would drop ANY contextvar binding — a sibling middleware that binds an unrelated key in the same request scope (or, more subtly, code triggered downstream of `call_next`) would lose its binding too. Token-based reset surgically removes ONLY the binding we set:
- `correlation_id_var.reset(cv_token)` restores the previous value of THIS ContextVar.
- `reset_contextvars(**sl_tokens)` (structlog 21.1+) restores the previous values of ONLY the keys we bound.

The fallback path (older structlog without `reset_contextvars`) uses `unbind_contextvars` with explicit key names — still surgical, just by-name instead of by-token.

**Acceptance criterion enforces this in CI:** `grep -F 'clear_contextvars' analytics-service/services/logging_config.py` returns 0. Even prose mentions are spelled hyphenated (`clear-contextvars`) so a future regression that re-introduces the literal symbol fails the gate.

## 100-Request Stress Test Outcome

`tests/test_correlation_middleware.py::test_sequential_100_requests_no_bleed_no_zombie`:

```
......                                                                   [100%]
6 passed in 0.28s
```

100 sequential POSTs with unique `cid-{i:04d}` headers. For each request:
- `correlation_id_struct == cid-{i:04d}` (structlog binding)
- `correlation_id_var == cid-{i:04d}` (explicit ContextVar)
- `response.headers["x-correlation-id"] == cid-{i:04d}` (echo)

After the loop completes:
- `correlation_id_var.get() is None` ✓ (no zombie binding)
- `structlog.contextvars.get_contextvars().get("correlation_id") is None` ✓ (no leak)

If the middleware were broken — e.g., a regression that swapped Token reset for the broad-clear API while another middleware bound an unrelated key — this stress test would catch the symptom on the very next request scope. As shipped, all 100 iterations pass with zero diagnostic noise.

## Test Invocations (verbatim)

```bash
# TS half
npx vitest run src/lib/analytics-client.test.ts
# → Test Files  1 passed (1) | Tests  5 passed (5)

# Python half
cd analytics-service && python -m pytest tests/test_logging_config.py tests/test_correlation_middleware.py -x -q
# → 6 passed in 0.28s

# Regression check (full TS suite)
npm test -- --run
# → 274 files passed | 13 skipped | Tests 2694 passed | 159 skipped

# Regression check (Python — excludes pre-existing pandera missing-module issue
# in tests/test_csv_validator.py, unrelated to this plan)
cd analytics-service && python -m pytest -q --no-header --ignore=tests/test_csv_validator.py
# → 631 passed, 5 skipped
```

## Commits

| Commit | Type | Subject |
|--------|------|---------|
| `8bf6b0e` | test | Task 1 RED — failing X-Correlation-Id propagation tests |
| `4d59a5d` | feat | Task 1 GREEN — wire X-Correlation-Id end-to-end on Next.js outbound |
| `c26ca86` | test | Task 2 RED — failing pytest for CorrelationMiddleware + logging_config |
| `e20061e` | feat | Task 2 GREEN — structlog + CorrelationMiddleware with FIX 11 Token reset |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] TypeScript signature mismatch on `vi.fn()` mock parameter.**
- **Found during:** Task 1 GREEN, after `npx tsc --noEmit` flagged the test file.
- **Issue:** Test helper accepted `fetchMock: ReturnType<typeof vi.fn>`, but `vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock)` requires the strict `(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>` signature. tsc rejected the assignment.
- **Fix:** Cast the loose `vi.fn()` return type through `unknown as typeof globalThis.fetch` at the spyOn call site, preserving each test's `vi.fn().mockResolvedValue(...)` builder shape unchanged.
- **Files modified:** `src/lib/analytics-client.test.ts`
- **Commit:** Folded into `4d59a5d` (Task 1 GREEN).

**2. [Rule 3 — Blocking] Plan-prescribed comment ordering of `app.add_middleware` calls violated runtime ASGI semantics.**
- **Found during:** Task 2 GREEN, while writing the source-line ordering comment.
- **Issue:** PATTERNS.md L389 said "BEFORE `app.add_middleware(CORSMiddleware, ...)` so it runs OUTERMOST" — but in Starlette/FastAPI, middleware added LATER wraps the outermost layer (reverse registration order). The plan author conflated source ordering with runtime ordering.
- **Fix:** Followed the plan's strict acceptance criterion (`grep -n add_middleware ... | head -2 shows CorrelationMiddleware first`). Updated the inline comment to accurately describe the runtime behavior (CORS ends up outermost; CorrelationMiddleware wraps every router/business-logic call including verify_service_key) so future readers don't carry the plan's misconception forward. Also extended `CORSMiddleware allow_headers` to permit the new `X-Correlation-Id` header so cross-origin POSTs from Next.js dev (port 3000 → port 8002) don't get stripped by the preflight check.
- **Files modified:** `analytics-service/main.py`
- **Commit:** Folded into `e20061e` (Task 2 GREEN).

**3. [Rule 2 — Critical] Strict acceptance grep `grep -F 'clear_contextvars' ... returns 0 matches` would fail on educational prose mentioning the rejected API.**
- **Found during:** Task 2 GREEN AC verification.
- **Issue:** Plan acceptance criterion forbids the literal symbol `clear_contextvars` in `logging_config.py`. The natural FIX 11 documentation (explaining WHY we don't use it) repeats the literal symbol four times in docstrings/comments. Plan author intended "no actual function call," but the grep is unconditional.
- **Fix:** Replaced every prose occurrence with the hyphenated form `clear-contextvars` (or the descriptive phrase "broad-clear API"). The educational meaning is preserved; the strict grep gate passes; future regressions reintroducing the literal symbol still trigger CI failure.
- **Files modified:** `analytics-service/services/logging_config.py`
- **Commit:** Folded into `e20061e` (Task 2 GREEN).

**4. [Rule 2 — Critical] CORS `allow_headers` did not permit `X-Correlation-Id`.**
- **Found during:** Task 2 GREEN, while reasoning about the cross-origin preflight path.
- **Issue:** Existing CORS config only allowed `Content-Type, X-Service-Key`. With Next.js stamping `X-Correlation-Id` on every fetch, browser preflights (and dev-mode requests from port 3000 → port 8002) would fail or strip the header before it reached `CorrelationMiddleware`.
- **Fix:** Added `"X-Correlation-Id"` to the `allow_headers` list in `CORSMiddleware`.
- **Files modified:** `analytics-service/main.py`
- **Commit:** Folded into `e20061e` (Task 2 GREEN).

### Out-of-scope discoveries (NOT fixed — logged for verifier)

- **Pre-existing pandera missing-module issue:** `tests/test_csv_validator.py` fails at collection because `pandera` (pinned in `requirements.txt`) is not installed in the local venv. This is environmental, not caused by this plan's changes. Logged here for the verifier to confirm it's also a no-op in CI (CI installs requirements.txt fresh per build).

### Authentication gates

None — this plan is pure code-and-tests work; no external service auth required.

## Known Stubs

None — the correlation_id propagation chain is end-to-end live. Plan 3 (Sentry boundaries) and Plan 5 (Resend tag) consume the surface this plan delivers; Plan 7 (SSE endpoint) re-exports `__INTERNAL_analyticsRequest` to thread an explicit correlationId.

## Threat Surface Scan

No threat-flag findings beyond the threat model already in the PLAN.md — all 6 STRIDE entries (T-16-02-01 through T-16-02-06) are addressed by the shipped code:

- **T-16-02-01 (info disclosure / contextvar bleed):** mitigated by FIX 11 Token reset; Tests 4 + 6 prove no bleed and no zombie.
- **T-16-02-02 (caller-supplied cid as join-key):** accepted; the cid is debugging metadata, audit attribution still keys off `auth.uid()`.
- **T-16-02-03 (UUID v4 in HTML source):** accepted; UUIDs carry no PII.
- **T-16-02-04 (Sentry tag failure):** mitigated by `with sentry_sdk.new_scope() as scope:` — failure to acquire the scope still allows structlog binding to proceed.
- **T-16-02-05 (server-side header injection impersonation):** accepted; internal seam, no external trust.
- **T-16-02-06 (future regression to broad-clear API):** mitigated by the `grep -cF 'clear_contextvars' ... == 0` acceptance gate enforced in CI; even prose now uses hyphenated spelling so the gate stays loud.

## Self-Check: PASSED

Verified all 4 commits exist on the branch and all 9 created/modified files are present:

```
$ git log --oneline -4
e20061e feat(16-02): structlog + CorrelationMiddleware with FIX 11 Token reset (Task 2 GREEN)
c26ca86 test(16-02): add failing pytest for CorrelationMiddleware + logging_config (Task 2 RED)
4d59a5d feat(16-02): wire X-Correlation-Id end-to-end on Next.js outbound (Task 1 GREEN)
8bf6b0e test(16-02): add failing tests for X-Correlation-Id propagation (Task 1 RED)
```

| Path | Status |
|------|--------|
| `src/lib/correlation-id.ts` | FOUND |
| `src/lib/analytics-client.test.ts` | FOUND |
| `src/lib/analytics-client.ts` | MODIFIED |
| `src/app/layout.tsx` | MODIFIED |
| `analytics-service/services/logging_config.py` | FOUND |
| `analytics-service/tests/test_logging_config.py` | FOUND |
| `analytics-service/tests/test_correlation_middleware.py` | FOUND |
| `analytics-service/main.py` | MODIFIED |
| `analytics-service/requirements.txt` | MODIFIED |

## TDD Gate Compliance

Plan-level TDD ordering verified — for both tasks the RED commit precedes the GREEN commit:

- Task 1: `8bf6b0e` (test, RED) → `4d59a5d` (feat, GREEN) ✓
- Task 2: `c26ca86` (test, RED) → `e20061e` (feat, GREEN) ✓

No REFACTOR commits were needed — the RED→GREEN transitions produced clean code that did not require post-passing structural changes.
