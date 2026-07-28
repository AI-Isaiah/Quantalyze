---
phase: 16-diagnostic-spike-observability
plan: 07
subsystem: api
tags: [sse, fastapi, fluid-compute, abort-signal, audit-log, rate-limit, csrf, admin-gate]

# Dependency graph
requires:
  - phase: 16-diagnostic-spike-observability
    provides: "audit-log infrastructure (Plan 02), correlation-id helper (Plan 02), error-envelope shape (Plan 06)"
provides:
  - "POST /api/debug-key-flow — admin-gated SSE endpoint that walks validate → encrypt → fetch-trades for a chosen broker"
  - "Internal /internal/debug-key-flow/{validate,encrypt,fetch-trades} FastAPI router (X-Internal-Token gated)"
  - "Best-effort 5/hour/admin in-memory rate limiter helper (checkDebugKeyFlowRateLimit)"
  - "Audit unions extended: AuditAction adds 'debug_key_flow.invoke', AuditEntityType adds 'debug_session'"
affects: [day-2-decision, OBSERV-08 (admin trigger UI), OBSERV-10 (validation), founder-gate]

# Tech tracking
tech-stack:
  added: []  # No new deps. Uses ReadableStream (Web standard), AbortSignal.any (Node 22+ stdlib), existing zod, supabase, structlog.
  patterns:
    - "SSE on Fluid Compute (runtime=nodejs, maxDuration=300, X-Accel-Buffering=no)"
    - "Per-step AbortSignal.any composition: client-disconnect ∨ 60s timeout"
    - "15s ': keepalive' SSE-comment heartbeat with cancel/finally cleanup"
    - "Audit-before-stream (Pattern E + Pattern F): forensic row survives stream abort"
    - "Lifecycle close-loop: cancel() emits second audit row metadata.status='client_aborted'"
    - "Inline admin gate (NOT wrapped via withAdminAuth) because withAdminAuth assumes JSON response — SSE needs hand-rolled Response"

key-files:
  created:
    - "src/app/api/debug-key-flow/route.ts"
    - "src/app/api/debug-key-flow/route.test.ts"
    - "src/app/api/debug-key-flow/rate-limit.ts"
    - "src/app/api/debug-key-flow/rate-limit.test.ts"
    - "analytics-service/routers/debug_key_flow.py"
    - "analytics-service/tests/test_debug_key_flow_router.py"
  modified:
    - "src/lib/audit.ts (AuditAction + AuditEntityType union extensions)"
    - "analytics-service/main.py (router registration after csv router)"

key-decisions:
  - "Inline admin gate (not withAdminAuth wrapper) — SSE responses are hand-rolled Response, not NextResponse.json"
  - "In-memory rate-limiter, NOT Upstash — 5/hour for ≤3 admins doesn't justify a Redis dep; escalation path documented at top of rate-limit.ts"
  - "Step bodies use placeholder summary dicts (preserve StepResponse shape) — real broker calls deferred to founder Task-5 [BLOCKING] checkpoint when DEBUG_KEY_FLOW_* env-blobs are staged"
  - "401 (not 403) on internal-token failure inside debug_key_flow.py — matches plan test contract; mirrors compare_digest pattern from existing routers/internal.py for the gate check itself"
  - "AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]) per outbound fetch — composes client-disconnect with hard per-step timeout so one hung broker cannot burn 300s budget"

patterns-established:
  - "SSE-with-heartbeat for long-lived diagnostic endpoints: setInterval clears in BOTH finally AND cancel()"
  - "Audit-before-stream Pattern E: log forensic row BEFORE ReadableStream.start() runs"
  - "Lifecycle close-loop Pattern: cancel() emits a SECOND audit row with metadata.status='client_aborted'"
  - "Per-step AbortSignal composition: AbortSignal.any([req.signal, AbortSignal.timeout(N)])"

requirements-completed: [OBSERV-07]

# Metrics
duration: 7min
completed: 2026-05-01
---

# Phase 16 Plan 07: Founder-Facing Diagnostic SSE Endpoint Summary

**POST /api/debug-key-flow — admin-gated Fluid-Compute SSE endpoint that streams per-step JSON events (validate → encrypt → fetch-trades) against decrypted DEBUG_KEY_FLOW_* test creds; audit-row inserted BEFORE stream starts; 5/hour/admin best-effort rate limit; 60s per-step AbortSignal timeout; 15s keepalive heartbeat; cancel() closes audit lifecycle.**

## Performance

- **Duration:** ~7 minutes
- **Started:** 2026-05-01T10:24:00Z
- **Completed:** 2026-05-01T10:31:41Z
- **Tasks:** 4 of 5 complete (Task 5 is awaiting founder action; see "Awaiting Founder Action")
- **Files created:** 6
- **Files modified:** 2

## Accomplishments

- `/api/debug-key-flow` SSE handler shipped with all 11 must_have invariants enforced (admin gate, audit-before-stream, runtime=nodejs, maxDuration=300, X-Accel-Buffering=no, AbortSignal.any timeout, 15s heartbeat, cancel-cleanup, JSON event shape, audit-union extension, one-broker-per-call).
- Internal FastAPI router with 3 X-Internal-Token-gated endpoints (validate / encrypt / fetch-trades) reading DEBUG_KEY_FLOW_<BROKER>_{KEY,SECRET,PASSPHRASE} env-blobs and best-effort scrubbing creds before return.
- Best-effort in-memory 5/hour/admin rate-limiter with documented LIMITATIONS + ESCALATION PATH (Upstash deferred to v1.x stability window).
- Audit unions extended (`debug_key_flow.invoke` action, `debug_session` entity_type) with explicit Phase 16 / OBSERV-07 section headers preserving ADR-0023 invariant.
- 13 vitest tests + 7 pytest tests all green.

## Task Commits

Each task was committed atomically (--no-verify due to executor protocol):

1. **Task 1: Extend audit unions** — `b46f3a8` (feat)
2. **Task 2: Rate-limiter** — `b2e2ee7` (test, RED) → `cdb8047` (feat, GREEN)
3. **Task 3: Internal FastAPI router + main.py registration + tests** — `78ba0fa` (feat)
4. **Task 4: Next.js SSE route + tests** — `1433639` (test, RED) → `71283a4` (feat, GREEN)
5. **Task 5: Founder env-staging** — AWAITING (blocking checkpoint, see below)

## Files Created/Modified

- `src/lib/audit.ts` — AuditAction `+ "debug_key_flow.invoke"`; AuditEntityType `+ "debug_session"`; both behind a `// --- Phase 16 / OBSERV-07 ---` section comment.
- `src/app/api/debug-key-flow/route.ts` — SSE Route Handler (POST). 305 LOC. Inline CSRF + admin gate + Zod body parse + rate-limit + audit-before-stream. ReadableStream with start() (3-step fetch loop emitting per-step JSON frames with AbortSignal.any timeout, 15s heartbeat, finally clearInterval+close) and cancel() (clearInterval + best-effort client_aborted audit emission).
- `src/app/api/debug-key-flow/route.test.ts` — 9 vitest cases (cross-origin → 403, non-admin → 403, invalid body → 400, rate-limit → 429, success → 200+text/event-stream+X-Accel-Buffering=no, audit-before-stream ordering, frame shape, terminal envelope, heartbeat 15s setup+teardown).
- `src/app/api/debug-key-flow/rate-limit.ts` — `checkDebugKeyFlowRateLimit(userId, now?)` with module-scope Map<userId, {count, windowStart}>. Top-of-file LIMITATIONS + ESCALATION PATH block.
- `src/app/api/debug-key-flow/rate-limit.test.ts` — 4 vitest cases (first-call=4-remaining, 6th-rejected, per-user, hour-reset).
- `analytics-service/routers/debug_key_flow.py` — APIRouter prefix=/internal/debug-key-flow with /validate, /encrypt, /fetch-trades. X-Internal-Token timing-safe gate. Reads DEBUG_KEY_FLOW_* env-blobs; calls services.encryption.decrypt_credentials per blob (1-arg form per plan; production wiring deferred to founder gate). Step bodies use placeholder summary dicts that preserve StepResponse shape. Best-effort `creds = None` scrub before each return.
- `analytics-service/tests/test_debug_key_flow_router.py` — 7 pytest cases (missing/wrong header → 401, missing INTERNAL_API_TOKEN → 503, missing creds env → 503, present creds → 200 across all 3 step endpoints).
- `analytics-service/main.py` — Imports `debug_key_flow_router` and `app.include_router(debug_key_flow_router)` after the csv router. Phase 16 / OBSERV-07 comment.

## Decisions Made

- **Inline admin gate, NOT withAdminAuth wrapper.** withAdminAuth assumes JSON body parsing + JSON response. SSE needs hand-rolled Response with text/event-stream + ReadableStream. Per PATTERNS.md the inline pattern is canonical for SSE routes.
- **In-memory rate limiter (NOT Upstash).** 5/hour limit for ≤3 admins does not justify Redis dep. Limitations documented in top-of-file comment block; escalation to Upstash deferred to v1.x stability window if abuse observed.
- **Placeholder step bodies in FastAPI router.** validate/encrypt/fetch-trades return canned summary dicts that preserve `StepResponse` shape. Real broker calls (services.exchange.validate_key_permissions / fetch_raw_trades / encryption.encrypt_credentials round-trip) wired at the [BLOCKING] founder Task-5 checkpoint when DEBUG_KEY_FLOW_* env-blobs become available. The placeholder layer means the SSE handler tests can run against the real internal router via 200-OK responses without needing real broker creds.
- **401 (not 403) on internal-token failure in debug_key_flow.py.** Plan test contract uses 401. The existing routers/internal.py uses 403. The two are intentionally different — the existing one is reused by external N+1 callers; this one is invoked only from /api/debug-key-flow which already enforced 403 at the admin gate, so 401 here distinguishes "Next.js layer auth' OK but internal token bad" from "no admin session at all".
- **AbortSignal.any composition** chosen over a wrapper helper because it's a 1-line stdlib idiom that exactly satisfies the must_have L25 contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Type bug] Widened mock signatures in route.test.ts**
- **Found during:** Task 4 (post-GREEN tsc --noEmit gate)
- **Issue:** `vi.fn(() => null)` and `vi.fn(() => ({ allowed, remaining }))` inferred narrow return types that rejected later `mockReturnValue(new Response(...))` and `{ retry_after_seconds: 60 }` calls with TS2554 / TS2353 errors.
- **Fix:** Added explicit generic on each `vi.fn<(args) => ResultType>(...)` so the mock can return the broader type. Added a local `RateLimitResultMock` interface mirroring `RateLimitResult` from rate-limit.ts to keep retry_after_seconds optional.
- **Files modified:** `src/app/api/debug-key-flow/route.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0; `npx vitest run src/app/api/debug-key-flow/` passes 13/13.
- **Committed in:** `71283a4` (Task 4 GREEN commit — caught and fixed in same task before commit)

---

**Total deviations:** 1 auto-fixed (1 type bug)
**Impact on plan:** Single test-only typing tightening; no behavior change. Plan as written did not type the mocks explicitly — fix unblocks repo-wide tsc.

## Issues Encountered

- The plan's acceptance grep `grep -F 'cross-instance slip' rate-limit.ts` is case-sensitive and fails against the plan's own example reference code which writes `Cross-instance slip` (capital C). Adjusted the comment to lowercase to satisfy the literal acceptance criterion. Recorded as minor plan-doc inconsistency rather than a deviation.
- Python `services.encryption.decrypt_credentials` actually takes `(encrypted_row: dict, kek: bytes) -> tuple[str, str, str|None]` — NOT the 1-arg `(blob: str) -> str` form the plan placeholder calls. The router was written to match the plan's test contract (1-arg mocked decrypt) and the placeholder summary dicts preserve StepResponse shape. Production wiring at the founder Task-5 checkpoint will need to either (a) wrap each blob as a single-row encrypted_row dict with `{api_key_encrypted: blob, dek_encrypted: ...}` shape OR (b) introduce a new helper in services/encryption.py that wraps `Fernet(kek).decrypt(blob.encode())` for single-blob env-var decryption. The plan's `<output>` block explicitly asks the executor to document the actual function names found — captured here for the founder.

## Awaiting Founder Action — Task 5 BLOCKING Checkpoint

Tasks 1-4 build cleanly and test green. **Task 5 cannot be executed by the agent** because it requires:

1. Real broker test API keys (OKX, Binance, Bybit) — held by the founder, not in any worktree.
2. `railway` CLI authenticated to the production project — agent has no Railway session.
3. `vercel` CLI authenticated to the same Vercel project — agent has no Vercel session.
4. INTERNAL_API_TOKEN parity verification across both platforms (the actual secret values).
5. Triggering a Railway redeploy + smoke-testing from a Vercel preview URL with an admin session cookie.

**Founder steps (verbatim from plan Task 5 — re-stated for the day-2-decision evidence chain):**

```bash
# 1. Encrypt each test cred via the existing KEK Fernet.
#    NOTE: services.encryption.encrypt_credentials takes 4 args
#    (api_key, api_secret, passphrase, kek) and returns a *dict* — NOT a
#    single Fernet blob. Either:
#      (a) Add a new helper services/encryption.py::encrypt_single_blob(plaintext, kek)
#          that returns Fernet(kek).encrypt(plaintext.encode()).decode() — set DEBUG_KEY_FLOW_* to those single blobs;
#      (b) OR set DEBUG_KEY_FLOW_<BROKER>_KEY to the JSON dump of the
#          encrypt_credentials() return dict and adjust _read_test_creds
#          in routers/debug_key_flow.py to call decrypt_credentials(json.loads(blob), kek) instead.
#    Recommendation: option (a) — minimal coupling, single blob per env var.
cd analytics-service
python -c "from cryptography.fernet import Fernet; import os; kek=os.environ['KEK'].encode(); print(Fernet(kek).encrypt(b'<okx-test-key>').decode())"
# Repeat for OKX_SECRET, OKX_PASSPHRASE, BINANCE_KEY, BINANCE_SECRET, BYBIT_KEY, BYBIT_SECRET (7 total)

# 2. Set in Railway:
railway variables set DEBUG_KEY_FLOW_OKX_KEY=<blob>
railway variables set DEBUG_KEY_FLOW_OKX_SECRET=<blob>
railway variables set DEBUG_KEY_FLOW_OKX_PASSPHRASE=<blob>
railway variables set DEBUG_KEY_FLOW_BINANCE_KEY=<blob>
railway variables set DEBUG_KEY_FLOW_BINANCE_SECRET=<blob>
railway variables set DEBUG_KEY_FLOW_BYBIT_KEY=<blob>
railway variables set DEBUG_KEY_FLOW_BYBIT_SECRET=<blob>

# 3. Verify INTERNAL_API_TOKEN parity (Assumption A6 in RESEARCH.md):
echo -n "$(railway variables get INTERNAL_API_TOKEN 2>/dev/null)" | shasum -a 256
echo -n "$(vercel env pull --yes && grep INTERNAL_API_TOKEN .env.local | cut -d= -f2-)" | shasum -a 256
# Hashes MUST match. If they differ, regenerate ONE token and set on BOTH.

# 4. If RESEND_WEBHOOK_SECRET is missing on Vercel (Plan 5 dep), set it.

# 5. Trigger Railway redeploy.

# 6. Smoke test from a Vercel preview deploy:
curl -sN -X POST "https://<preview-url>/api/debug-key-flow" \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-session-cookie>" \
  -H "Origin: https://<preview-url>" \
  -d '{"broker":"okx"}'
# Expect: text/event-stream with per-step JSON events ending in {"step":"done","envelope":{...}}.
# Heartbeat lines beginning with `: keepalive` should appear every 15s while the stream is open.
```

**Resume signal:** Founder types "staged" once all 7 env vars are set, INTERNAL_API_TOKEN hashes match across platforms, and the smoke-test SSE returns at least one event with `status:ok` or `status:error` (NOT 503 / 401).

## TDD Gate Compliance

This plan is `type: execute`, not `type: tdd`, so plan-level RED/GREEN gate enforcement does not apply. However Tasks 2 and 4 are individually marked `tdd="true"` and were executed RED-then-GREEN with separate commits:

- Task 2: RED `b2e2ee7` (test) → GREEN `cdb8047` (feat) — confirmed via `npx vitest run src/app/api/debug-key-flow/rate-limit.test.ts` failing in RED, passing in GREEN.
- Task 4: RED `1433639` (test) → GREEN `71283a4` (feat) — confirmed via 9-test failure in RED (Cannot find module ./route), 9-test pass in GREEN.

## Threat Surface Notes

The Plan 7 implementation matches the threat_model in PLAN.md exactly:

- **T-16-07-01** (info disclosure of broker creds): test creds are SEPARATE blobs; never logged in plaintext; scrubbed via `creds = None` before each return.
- **T-16-07-02** (repudiation on stream abort): audit row inserted BEFORE ReadableStream.start() — verified by Test 6 (audit_called_at < first_enqueue_at). Lifecycle close-loop: cancel() emits second audit row with metadata.status='client_aborted'.
- **T-16-07-03** (privilege escalation via 404 oracle): both missing-auth AND non-admin return 403 with `{error: "Unauthorized"}` — Tests 1-2 enforce.
- **T-16-07-04 / T-16-07-06** (DoS / rate-limit bypass): in-memory limiter caps at 5/hour/userId per warm instance. Cross-instance slip documented at top of rate-limit.ts.
- **T-16-07-05** (long-lived SSE survives admin role revocation): bounded by maxDuration=300; permission check at request entry only — risk window ≤300s, accepted.
- **T-16-07-10** (one hung broker burns 300s budget): AbortSignal.any composition caps each step at 60s — verified via grep.
- **T-16-07-11** (proxy idle timeout closes SSE): 15s `: keepalive` heartbeat; clearInterval in BOTH finally AND cancel().

No threat flags — no surface introduced beyond what threat_model in PLAN.md already covers.

## Self-Check

Verifying claimed artifacts exist:

- src/app/api/debug-key-flow/route.ts → FOUND
- src/app/api/debug-key-flow/route.test.ts → FOUND
- src/app/api/debug-key-flow/rate-limit.ts → FOUND
- src/app/api/debug-key-flow/rate-limit.test.ts → FOUND
- analytics-service/routers/debug_key_flow.py → FOUND
- analytics-service/tests/test_debug_key_flow_router.py → FOUND
- src/lib/audit.ts (modified) → FOUND
- analytics-service/main.py (modified) → FOUND

Verifying claimed commits exist:

- b46f3a8 (Task 1) → FOUND
- b2e2ee7 (Task 2 RED) → FOUND
- cdb8047 (Task 2 GREEN) → FOUND
- 78ba0fa (Task 3) → FOUND
- 1433639 (Task 4 RED) → FOUND
- 71283a4 (Task 4 GREEN) → FOUND

## Self-Check: PASSED

## Next Phase Readiness

- The Next.js SSE handler is fully implemented + tested. The internal FastAPI router responds with placeholder StepResponse summaries until the founder stages env-blobs.
- OBSERV-08 (admin trigger UI) can begin in parallel — the SSE event shape is locked: per-step `{step, status, correlation_id, started_at, duration_ms?, error?}` + terminal `{step:"done", envelope:{ok,code,human_message,debug_context,correlation_id,recoverable}}` + 15s `: keepalive` SSE comment.
- After founder unblocks Task 5, the executor follow-up is to (a) implement the chosen single-blob decrypt helper in services/encryption.py and (b) replace the 3 placeholder summary dicts with real validate_key_permissions / encryption round-trip / fetch_raw_trades calls. The StepResponse shape stays identical, so this is non-breaking for the Next.js SSE client.

---
*Phase: 16-diagnostic-spike-observability*
*Completed: 2026-05-01 (Tasks 1-4; Task 5 awaits founder env-staging)*
