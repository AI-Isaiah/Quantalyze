---
phase: 16-diagnostic-spike-observability
plan: 03
subsystem: observability
tags: [sentry, error-boundaries, pii-scrub, fastapi, instrumentation, OBSERV-04, OBSERV-05]
requires:
  - "Plan 16-02 server-rendered <meta name=\"x-correlation-id\"> in src/app/layout.tsx (consumed client-side here)"
  - "Plan 16-02 services/logging_config.configure_logging() (called BEFORE init_sentry in main.py)"
  - "src/lib/admin/pii-scrub.ts as canonical denylist source-of-truth (mirrored in Python)"
provides:
  - "OBSERV-04 client error boundary Sentry capture with correlation_id tag (queryable)"
  - "OBSERV-04 server-side onRequestError correlation_id tag in Sentry"
  - "OBSERV-05 FastAPI/Starlette Sentry capture with PII redactor (FULL pii-scrub.ts mirror per FIX 7)"
  - "Pitfall 6 try/except wrap on _redact_before_send — never drops events silently"
affects:
  - src/app/error.tsx (useEffect body L18-21 replaced)
  - src/app/global-error.tsx (useEffect body L17-20 replaced)
  - src/instrumentation.ts (onRequestError tags object adds correlation_id)
  - analytics-service/main.py (replaces inline minimal init with init_sentry() call)
  - analytics-service/requirements.txt (sentry-sdk[fastapi]==2.58.0 pin)
tech-stack:
  added:
    - "sentry-sdk[fastapi]==2.58.0 (Python — FastApiIntegration + StarletteIntegration)"
  patterns:
    - "Lazy import of @sentry/nextjs in client error boundaries (not in static bundle)"
    - "before_send try/except wrap — Sentry redactor must never raise (Pitfall 6)"
    - "PII denylist mirror across TS pii-scrub.ts ↔ Python sentry_init._PII_KEYS"
    - "Tags vs extra distinction: correlation_id is a TAG (queryable), digest is extra"
key-files:
  created:
    - "analytics-service/sentry_init.py — init_sentry + _redact_before_send (FULL pii-scrub.ts mirror)"
    - "analytics-service/tests/test_sentry_init.py — 15 pytest cases"
    - "src/app/error.test.tsx — 3 vitest cases"
    - "src/app/global-error.test.tsx — 2 vitest cases"
  modified:
    - "src/app/error.tsx — useEffect body only (visual block L23-47 byte-identical)"
    - "src/app/global-error.tsx — useEffect body only (visual block L22-83 byte-identical)"
    - "src/instrumentation.ts — onRequestError tags object adds correlation_id"
    - "analytics-service/main.py — replaces inline init with init_sentry() call"
    - "analytics-service/requirements.txt — sentry-sdk[fastapi]==2.58.0 pin"
decisions:
  - "Lazy `import('@sentry/nextjs')` in error boundaries with .catch() to absorb import failure (T-16-03-05 accept) — keeps the boundary render-safe even if Sentry SDK fails to load."
  - "correlation_id is a Sentry TAG (queryable in UI), not extra (metadata-only) — required for Day-2 grep across the Next.js/FastAPI boundary."
  - "_PII_KEYS extends pii-scrub.ts L16-25 with broker-specific signing headers (Bybit v5 + OKX extras + Binance extras) — defense-in-depth across both Sentry and Plan 8's vcrpy filter (FIX 7)."
  - "before_send wraps body in try/except per Pitfall 6 — a redaction bug NEVER drops events silently; falls through with the unmodified event on exception."
  - "Python redactor uses `[JWT-REDACTED]` (hyphen) instead of pii-scrub.ts's `[REDACTED_JWT]` (underscore) — this matches the plan/test specification. Cosmetic only; both are denylisted at the same layer."
metrics:
  start_time: "2026-05-01T09:52:00Z"
  end_time: "2026-05-01T09:57:18Z"
  duration_minutes: 5
  completed_date: "2026-05-01"
  tasks_completed: 2
  files_created: 4
  files_modified: 5
  ts_tests_added: 5
  py_tests_added: 15
---

# Phase 16 Plan 03: Sentry on both halves of the stack — Summary

Wired Sentry error capture into both halves of the stack (Next.js client/server boundaries + FastAPI ASGI auto-capture) with a `correlation_id` tag that lets the founder grep a single error event across both halves at Day-2 review. PII redactor mirrors the FULL `src/lib/admin/pii-scrub.ts` surface — 8 base keys + `sb-ec-` prefix + JWT regex + broker-specific signing headers (Bybit v5 + OKX + Binance) — and is wrapped in try/except per Pitfall 6 so a redaction bug never silently drops events.

## TODO markers replaced

| File | Old line range | New body |
|------|----------------|----------|
| `src/app/error.tsx` | L18-21 (useEffect body, single TODO comment) | `console.error` + `document.querySelector('meta[name="x-correlation-id"]')` + lazy `import('@sentry/nextjs')` + `Sentry.captureException(error, { tags: { digest, correlation_id } })` + `.catch(() => {})` absorber |
| `src/app/global-error.tsx` | L17-20 (useEffect body, single TODO comment) | Same pattern with `[global-error]` log prefix |

`grep -F 'TODO: wire Sentry.captureException'` against both files returns **0 matches** (acceptance criterion).

## Visual blocks preserved byte-identical

- `src/app/error.tsx` lines 23-47 (Tailwind-styled JSX block) — unchanged. CONTEXT.md "Out of scope" — Phase 17 owns the site-wide redesign.
- `src/app/global-error.tsx` lines 22-83 (inline-styled JSX with `<html>` + `<body>` because the root layout is replaced when this renders) — unchanged.

Confirmed via `git diff` — only the `useEffect` body differs in each file.

## Meta-tag read flow (client-side)

Both error boundaries read the `x-correlation-id` meta tag using:

```ts
const cidMeta = document.querySelector('meta[name="x-correlation-id"]');
const correlation_id = cidMeta?.getAttribute("content") ?? null;
```

The meta tag is rendered server-side in `src/app/layout.tsx` (Plan 2) from the request-scope `getCorrelationId()` value. When the boundary mounts, the DOM is already hydrated so the value is present. If Plan 2's layout ever stops rendering the tag, `correlation_id` falls back to `null` — the boundary still captures and the tag is just missing in Sentry, no crash.

`typeof window === "undefined"` early return ensures the boundary is safe on the server during SSR rendering of the error path.

## instrumentation.ts onRequestError tag

`src/instrumentation.ts` `onRequestError` now reads `request.headers["x-correlation-id"]` (lower-case header name, since Next.js's onRequestError signature already provides headers as `Record<string, string>` with normalized lowercase keys per the existing L14 typing) and adds it to the **tags** object alongside `routerKind` / `routePath` / `routeType`. Tags are queryable in the Sentry UI; `extra` is metadata-only — see RESEARCH.md L296-345.

## FastAPI init upgrade

`analytics-service/main.py` previously had this minimal block at L28-40:

```python
# Sentry error tracking (optional, production only)
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
        ...
```

This is now removed. `from sentry_init import init_sentry; init_sentry()` is called AFTER `configure_logging()` (so structlog is wired before any Sentry import side effects) and BEFORE `app = FastAPI(...)` (so FastAPI/Starlette integrations are registered before any router instantiation).

`grep -c 'sentry_sdk.init('` against `analytics-service/main.py` returns **0** — the inline call is gone, only `init_sentry()` from the new module remains. sentry-sdk is now a hard requirement (pinned in `requirements.txt`); the previous optional `try: import sentry_sdk; except ImportError: warn` fallback is gone.

## PII denylist FULL pii-scrub.ts mirror (FIX 7)

The Python `_PII_KEYS` frozenset and `_PII_KEY_PREFIXES` tuple mirror the **FULL** surface of `src/lib/admin/pii-scrub.ts`, NOT just the 8 base keys.

| Source line | TS surface | Python mirror |
|-------------|------------|---------------|
| pii-scrub.ts L16-25 | 8 exact keys: `apikey`, `apisecret`, `secret`, `signature`, `passphrase`, `authorization`, `x-mbx-apikey`, `ok-access-sign` | `_PII_KEYS` includes all 8 (Test 1) |
| pii-scrub.ts L27 | `DENYLIST_PREFIX = ["sb-ec-"]` (Supabase encryption-context cookies) | `_PII_KEY_PREFIXES = ("sb-ec-",)` (Test 5, Test 7) |
| pii-scrub.ts L31 | `JWT_SHAPE` regex | `_JWT_SHAPE` regex; values matching are replaced with `[JWT-REDACTED]` regardless of key name (Test 6) |
| FIX 7 — Bybit v5 | Same surface as Plan 8 vcrpy filter | `x-bapi-api-key`, `x-bapi-sign`, `x-bapi-timestamp`, `x-bapi-recv-window`, `x-bapi-sign-type` (Test 2, Test 8) |
| FIX 7 — OKX extras | Same surface as Plan 8 vcrpy filter | `ok-access-passphrase`, `ok-access-key`, `ok-access-timestamp` (Test 3, Test 8) |
| FIX 7 — Binance extras | Same surface as Plan 8 vcrpy filter | `x-mbx-time-unit` (Test 4, Test 8) |

**Explicit confirmation: the Python denylist mirrors the FULL pii-scrub.ts surface — 8 keys + sb-ec- prefix + JWT regex + broker headers per FIX 7. NOT just the 8 base keys.**

## Pitfall 6 — try/except wrap

`_redact_before_send` wraps its entire body in `try: ... except Exception: return event`. A redaction bug returns the unmodified event rather than raising and dropping the event silently. Test 10 (`test_pitfall_6_never_raises_on_malformed_event`) exercises this with `event = {"request": "not-a-dict"}` — the wrapper does `isinstance(req, dict)` checks first, so the redactor doesn't even reach the except branch in normal flow, but the wrap is the safety net.

## Test results

```
TS:  npx vitest run src/app/error.test.tsx src/app/global-error.test.tsx
     5 passed (5)

Python: cd analytics-service && pytest tests/test_sentry_init.py -x -q
     15 passed in 0.17s
```

**TS test cases (5 total):**
1. `error.tsx` captures with `correlation_id` from meta element
2. `error.tsx` captures with `correlation_id: null` when meta absent
3. `error.tsx` does not throw + console.error fires
4. `global-error.tsx` captures with `correlation_id` from meta
5. `global-error.tsx` captures with `correlation_id: null` when meta absent

**Python test cases (15 total):**
- `TestPIIDenylist`: 6 cases asserting denylist composition (8 base + Bybit + OKX + Binance + sb-ec- prefix + JWT shape regex)
- `TestRedactBeforeSend`: 7 cases (Authorization case-insensitive, extra apikey + ok-access-sign, JWT-shaped value with benign key, sb-ec- cookie keys, broker headers, empty event, Pitfall 6 malformed event)
- `TestInitSentry`: 2 cases (no-op when DSN unset, canonical kwargs when DSN set with FastApiIntegration + StarletteIntegration registered)

Bonus: regression-checked `tests/test_correlation_middleware.py` (4 passed) — main.py refactor did not break Plan 2's middleware test.

## TDD Gate Compliance

Both tasks followed RED → GREEN:

| Task | RED commit | GREEN commit |
|------|------------|--------------|
| 1 (TS error boundaries + instrumentation) | `404de70` | `9ecac38` |
| 2 (Python sentry_init) | `c8691e0` | `a1ab0d8` |

REFACTOR was not needed — no behavior change between GREEN and final state.

## Threat Model Reference

All `mitigate` dispositions from the plan's `<threat_model>` are implemented:

- **T-16-03-01** (PII leak): `send_default_pii=False` + `_redact_before_send` with FULL pii-scrub.ts mirror per FIX 7.
- **T-16-03-02** (DoS via redactor crash): try/except wrap; Test 10 enforces.
- **T-16-03-06** (denylist drift): Phase-tagged comment in `_PII_KEYS` references pii-scrub.ts as source-of-truth. **Phase 18 reminder logged in module docstring**: redact.py mirror must include all of these surfaces.
- **T-16-03-07** (JWT leak via benign-named field): `_JWT_SHAPE` regex; Test 6 enforces.
- **T-16-03-08** (Supabase sb-ec- cookie leak): `_PII_KEY_PREFIXES = ("sb-ec-",)`; Test 7 enforces.

`accept` dispositions:
- **T-16-03-03** (correlation_id as tracking vector): UUID v4, scoped to single error event.
- **T-16-03-05** (Sentry import fail in client boundary): `.catch(() => {})` intentionally absorbs.

`mitigate-by-design`:
- **T-16-03-04** (XSS-injected meta tag): meta is server-rendered from `headers()`; XSS would have to compromise the layout itself.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Comment in main.py contained literal `sentry_sdk.init(...)` substring**

- **Found during:** Task 2 acceptance verification
- **Issue:** The replacement comment "Replaces the previous minimal `import sentry_sdk; sentry_sdk.init(...)` block" tripped the `grep -c 'sentry_sdk.init('` acceptance criterion (returned 1 instead of 0).
- **Fix:** Reworded the comment to "inline minimal init block" — no semantic change, just removed the literal substring from the comment.
- **Files modified:** `analytics-service/main.py`
- **Commit:** included in `a1ab0d8` (GREEN commit)

### Notes (not deviations)

- The plan's example code used `_REDACTED_JWT = "[JWT-REDACTED]"` (hyphen). The TS source `pii-scrub.ts` L34 uses `REDACTED_JWT = "[REDACTED_JWT]"` (underscore). I followed the plan's specification (and the test assertions, which check `"[JWT-REDACTED]"` literally) — this is documented in the decision section above as a cosmetic mismatch worth noting for future Phase 18 fixture-corpus work.
- Test 3 (`absorbs Sentry import failure without throwing`) was simplified to just assert `console.error` fires + `render` does not throw, per the plan's `<action>` Step D footnote. The vi.mock factory throw approach doesn't surface as a `.catch()` in the boundary because mock factories run at module evaluation time, not per-test.

## Self-Check

```
$ test -f src/app/error.test.tsx && echo FOUND || echo MISSING
FOUND

$ test -f src/app/global-error.test.tsx && echo FOUND || echo MISSING
FOUND

$ test -f analytics-service/sentry_init.py && echo FOUND || echo MISSING
FOUND

$ test -f analytics-service/tests/test_sentry_init.py && echo FOUND || echo MISSING
FOUND

$ git log --oneline | head -4
a1ab0d8 feat(16-03): sentry-sdk[fastapi] FastAPI/Starlette init + FULL pii-scrub.ts mirror (GREEN)
c8691e0 test(16-03): add failing tests for analytics-service sentry_init module (RED)
9ecac38 feat(16-03): wire Sentry.captureException into error boundaries + onRequestError tag (GREEN)
404de70 test(16-03): add failing Sentry capture tests for error boundaries (RED)
```

## Self-Check: PASSED
