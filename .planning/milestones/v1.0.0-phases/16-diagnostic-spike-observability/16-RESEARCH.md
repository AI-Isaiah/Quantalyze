# Phase 16: Diagnostic Spike + Observability — Research

**Researched:** 2026-05-01
**Domain:** Cross-stack observability (Next.js 16 + FastAPI + Supabase + Resend) — correlation_id propagation, structured error envelopes, deterministic local-repro harness, trigger/RLS audit
**Confidence:** HIGH on stack/library APIs (Context7-verified); MEDIUM on Resend tag round-trip empirics (sources contradict); HIGH on architectural responsibility map (codebase grep-verified)

## Summary

Phase 16 is a pre-specified, plumbing-heavy diagnostic phase. The entry CONTEXT.md
already locks the 10-plan / 2-wave structure, the WizardErrorEnvelope shape, the SSE
event contract, the VCR cassette matrix (12 cassettes), the PostHog mobile criterion,
and the trigger-audit deliverable path. Research surfaces the **HOW**, not the
**WHAT** — library API quick-references, the empirical Resend tag-round-trip
verification protocol, the codebase seams confirmed by grep, and the validation
architecture that scaffolds VALIDATION.md.

Three findings warrant explicit planner attention:

1. **Resend tags webhook round-trip is empirically ambiguous.** The official
   Resend `resend-webhooks-ingester` boilerplate types `data.tags?: WebhookTag[]`
   (array of `{name, value}`), but third-party blog snippets show `tags` as a
   flat dict (`{ "category": "confirm_email" }`). Plan 5 MUST verify empirically
   against a live test send and fall back to `(correlation_id, resend_message_id)`
   mapping table as Pitfall 17 prescribes. `tags` is also `?optional` in the
   official types — even when sent, it may not appear on every event-type payload
   (the boilerplate's `email.delivered` fixture omits it).

2. **Next.js 16 App Router SSE has no first-class abstraction** — the canonical
   pattern (per `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
   lines 401-481) is a Web-API `ReadableStream` returned from a Route Handler.
   The Vercel knowledge-update injection clarifies Edge runtime is no longer
   recommended — Fluid Compute (default Node.js) is the right runtime for SSE,
   with graceful shutdown + request cancellation built-in. `text/event-stream`
   framing is hand-rolled (`data: ${json}\n\n`) — there is no `next/server`
   helper.

3. **Existing reusable assets are deeper than the autoplan implied.** The repo
   already has `src/lib/audit.ts` with `log_audit_event_service(p_user_id,
   p_action, p_entity_type, p_entity_id, p_metadata)` SECURITY DEFINER RPC
   (migration 058) — Plan 7 reuses this for `/api/debug-key-flow` audit (action
   `debug_key_flow.invoke`), no new audit table needed. Plan 4 trigger-audit
   should use **pytest+psycopg over pgTAP** (the codebase has 1,695 pytest tests
   and zero pgTAP fixtures — pgTAP would add a new tooling burden for one phase).

**Primary recommendation:** Wave 1 ships Plan 1 (CI presence-check), Plan 2
(correlation_id seam + structlog), Plan 3 (Sentry boundaries), Plan 4 (trigger
audit), Plan 9 (PostHog audit), Plan 10 (Day-2 scaffold) in parallel. Wave 2
ships Plan 5 → Plan 6 → Plan 7 → Plan 8 in dependency order. Empirical verifications
(Resend tag round-trip, PostHog mobile count) are the only items that require
external API calls during execution.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Plan slicing & wave structure:**
- 10 plans total, organized by REQ groups:
  - Plan 1 — OBSERV-12 file-presence assertion in CI
  - Plan 2 — correlation_id seam + structlog (OBSERV-01, OBSERV-02, OBSERV-09)
  - Plan 3 — Sentry boundaries (OBSERV-04 Next.js error.tsx + global-error.tsx; OBSERV-05 sentry-sdk[fastapi]==2.58.0)
  - Plan 4 — trigger / RLS audit + integration tests (OBSERV-10)
  - Plan 5 — Resend tag round-trip verification (OBSERV-03; tags-first with `(correlation_id, resend_message_id)` mapping fallback per Pitfall 17)
  - Plan 6 — WizardErrorEnvelope component + wizard step integration (OBSERV-06)
  - Plan 7 — `/api/debug-key-flow` SSE endpoint (OBSERV-07)
  - Plan 8 — vcrpy cassettes + `scripts/repro-key-flow.sh` (OBSERV-08)
  - Plan 9 — PostHog `wizard_start` mobile audit (OBSERV-11)
  - Plan 10 — Day-2 decision document scaffold (template only)
- 2 waves: Wave 1 (P1, P2, P3, P4, P9, P10 — parallelizable). Wave 2 (P5, P6, P7, P8 — depends on Wave 1).
- First plan to ship: Plan 1 (smallest diff, protects rest).

**WizardErrorEnvelope component:**
- Path: `src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx` (co-located with wizard).
- Props: single `envelope` object `{ok, code, human_message, debug_context, correlation_id, recoverable}` plus optional `onRetry` and `onCancel` callbacks.
- Copy-diagnostics: native `<details>` + `<summary>` + `<button>` calling `navigator.clipboard.writeText(JSON.stringify(envelope))`. ARIA-live "Copied" status. No third-party library.
- Phase 16 rollout: wizard error paths only — `ConnectKeyStep`, `SyncPreviewStep`, `SubmitStep`. Site-wide rollout deferred to Phase 17 per UC-D.

**`/api/debug-key-flow` SSE endpoint:**
- Auth gate: existing admin-role check via `withAdminAuth` helper + audit-log row inserted per invocation.
- Test credentials: env-var-encoded encrypted blobs per broker — `DEBUG_KEY_FLOW_OKX_KEY` / `DEBUG_KEY_FLOW_OKX_SECRET` / `DEBUG_KEY_FLOW_OKX_PASSPHRASE` (and same triple for Binance and Bybit), decrypted via the existing KEK env-var. Railway is the source of truth per Day-0.5 pre-flight result.
- SSE event shape: one JSON event per pipeline step — `{step: string, status: "started"|"ok"|"error", correlation_id: string, started_at: ISO8601, duration_ms?: number, error?: {code, human_message}}`. Terminal event `{step: "done", envelope}` closes stream with the final envelope.
- Rate limiting: 5 invocations/hour/admin user (in-memory counter; resets on cold start; will tighten if abused). Audit-log row is hard requirement regardless of rate-limit outcome.

**VCR cassettes + PostHog audit + trigger audit:**
- VCR cassette scope: per broker (OKX/Binance/Bybit) — happy + 3 failure modes (auth-fail HTTP 401 / rate-limit HTTP 429 / schema-drift HTTP 200 with unexpected payload). 12 cassettes total. Path: `analytics-service/tests/cassettes/{broker}/{scenario}.yaml`.
- VCR PII redaction: `vcrpy` `filter_headers` for `authorization`, `x-api-key`, `x-api-signature`, `x-passphrase` (case-insensitive) + `before_record_response` callback that strips `accountId`, `userId`, `email`, address-bearing fields via regex. CI smoke-test greps cassettes for known test secrets and fails on hit.
- PostHog mobile criterion: `properties.$device_type === 'Mobile'` over a trailing 30-day window. Cross-checked with `properties.$viewport_width < 768`. Output committed to `.planning/phase-16/posthog-mobile-audit.md` with summary line appended to TODOS.md per OBSERV-11.
- Trigger/RLS audit deliverable: `.planning/phase-16/trigger-rls-audit.md` documenting migrations 084/085/086 under unified-pipeline RLS context (service-role calls from Railway where `auth.uid()` returns NULL). Paired pgTAP or pytest integration tests assert each `stamp_first_*` RPC fires correctly via `NEW.user_id`, not `auth.uid()`.

**Day-2 decision document handling:** Pre-scaffold as Plan 10. Write `.planning/phase-16/day-2-decision.md` with empty-section template. Founder fills at the gate. Plan-checker validates template structure exists before Phase 18 entry.

### Claude's Discretion
- Exact file/symbol naming for new helper modules (correlation_id generator, envelope builder, structlog config) — follow established codebase conventions.
- Test framework choice for trigger audit (pgTAP vs pytest+psycopg) — whichever sits better next to existing analytics-service tests. **Research recommends pytest+psycopg** (codebase has 1,695 pytest tests, zero pgTAP — adopting pgTAP for one phase is a tooling burden).
- Audit-log table for `/api/debug-key-flow` invocations — reuse existing audit table if shape fits; otherwise extend with a `debug_key_flow_invocation` event kind. **Research confirms reuse of existing `audit_log` table** via `log_audit_event_service(action='debug_key_flow.invoke', entity_type='debug_session', entity_id=correlation_id, metadata={broker, admin_user_email, rate_limit_remaining})` — no new table or migration needed.

### Deferred Ideas (OUT OF SCOPE)
- Site-wide error envelope rollout — Phase 17 design contract.
- Actual fix to the wizard failure — Phase 18 (regression test that fails without the fix is required at that gate).
- Mobile-readable wizard fallback — Phase 17, conditional on Plan 9 PostHog audit count > 0 per DESIGN-04.
- Replacing existing `// TODO: wire Sentry.captureException` markers OUTSIDE the wizard error boundary path — Phase 18+ if relevant.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OBSERV-01 | `correlation_id` UUID injected at `src/lib/analytics-client.ts:66`; propagates as `x-correlation-id` header through every outbound fetch | Verified: line 66 is the `fetch(` call inside `analyticsRequest()`. Headers object literal is the seam. crypto.randomUUID() is Web-platform standard; works in Node.js 20+ runtime. |
| OBSERV-02 | FastAPI receives `correlation_id` via Sentry CorrelationMiddleware + structlog contextvar; every exception log line + every outbound DB/Resend call carries the value | structlog `contextvars.bind_contextvars(correlation_id=...)` pattern + `merge_contextvars` processor. Sentry `set_tag("correlation_id", ...)` inside the middleware. Both Context7-verified. |
| OBSERV-03 | Resend `tags` array carries `correlation_id` on send; webhook handlers read it from inbound payload (with custom-header fallback if `tags` round-trip empirically fails — verified during Phase 16) | Send shape verified from Resend API ref: array of `{name, value}` objects, ASCII a-z A-Z 0-9 _ - only, max 256 chars. Webhook shape ambiguous — official boilerplate types it as `WebhookTag[]` (optional), but blog snippets show flat dict. Pitfall 17 fallback strategy required. |
| OBSERV-04 | `@sentry/nextjs` framework hook (already in `src/instrumentation.ts`) extended into `src/app/error.tsx` + `src/app/global-error.tsx`; correlation_id surfaces as Sentry tag | `instrumentation.ts` already wires `register()` + `onRequestError()`. Phase 16 adds two new boundary files using `Sentry.captureException(error, {tags: {correlation_id}})`. |
| OBSERV-05 | `sentry-sdk[fastapi]==2.58.0` added to `analytics-service/requirements.txt`; init pattern mirrors `src/instrumentation.ts` | `analytics-service/main.py` already has `import sentry_sdk; sentry_sdk.init(...)` (line 33) — but missing the `[fastapi]` extra and `before_send` hook. Plan 3 upgrades existing init. |
| OBSERV-06 | User sees actionable structured error envelope on every wizard error path — no "Something went wrong" generic | `wizardErrors.ts` already source-of-truth (361 LOC, includes UNKNOWN fallback). Envelope mapper is `title → human_message`, `fix[] → debug_context`. Three step files already consume `formatKeyError` — drop-in replacement. |
| OBSERV-07 | Admin-gated `/api/debug-key-flow` SSE endpoint runs Path 1 + Path 2 + sync sequentially against test credentials and streams structured diagnostic JSON | `withAdminAuth` helper exists at `src/lib/api/withAdminAuth.ts`. SSE pattern is hand-rolled `ReadableStream` per Next.js 16 docs. Audit reuses `log_audit_event_service` RPC. |
| OBSERV-08 | `scripts/repro-key-flow.sh` runs the unified key flow against `vcrpy==8.1.1` cassettes for OKX/Binance/Bybit happy + failure paths without network access | vcrpy 8.1.1 verified on PyPI; `filter_headers` + `before_record_response` API confirmed via Context7. CI grep-for-secrets pattern is straightforward. |
| OBSERV-09 | `structlog==25.5.0` produces JSON-format logs from FastAPI with `correlation_id` in every record via contextvar | structlog `contextvars` module + `JSONRenderer` processor. Pinned with sentry-sdk + vcrpy in same requirements.txt edit. |
| OBSERV-10 | Migrations 084 + 085 + 086 audited under unified pipeline; integration tests assert each `stamp_first_*` RPC fires correctly; RLS context drift across Railway → Supabase boundary verified | Migration 084 (stamp_first_api_key_added trigger + stamp_first_sync_success RPC) and 085 (stamp_first_bridge_surfaced RPC) both use SECURITY DEFINER + `NEW.user_id` (NOT `auth.uid()`) — already correct. Audit verifies behavior under service-role client where `auth.uid()` returns NULL. Test pattern: pytest fixture inserts via service-role psycopg, asserts trigger fires + raw_user_meta_data updated. |
| OBSERV-11 | PostHog `wizard_start` mobile-device audit completes with documented count | PostHog API: `/api/projects/{project_id}/events?event=wizard_start&date_from=-30d&properties=[{key:"$device_type",value:"Mobile",operator:"exact"}]`. Plan 9 deliverable is a markdown doc + TODOS.md summary line — no production code change. |
| OBSERV-12 | `restore-e2e-fixtures` PR merged before any other Phase 16 instrumentation work — bit-for-bit pre-PR-#90 restore + presence-check assertion in CI | PR #111 already merged per STATE.md prep gate 1. Plan 1 ships ONLY the CI presence-check (3-file existence assertion with byte-count tolerance), not the restore itself. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `correlation_id` UUID generation | Browser (wizard click) | Frontend Server (analytics-client.ts) | UUID origin must be the entry point so a single ID threads the full call stack. crypto.randomUUID() is Web-standard and works in both browser and Node 20+. |
| `x-correlation-id` header propagation | Frontend Server (Next.js → FastAPI fetch) | API (FastAPI middleware) | Header injection happens at the fetch wrapper boundary; FastAPI middleware reads it on receive. |
| `correlation_id` log binding | API (FastAPI structlog contextvar) | — | structlog contextvar is request-scoped on the Python side; ASGI middleware sets it on request entry, clears on exit. |
| Sentry error capture | Frontend Server (error.tsx / global-error.tsx) + API (FastAPI ASGI integration) | — | Error boundaries are tier-local; correlation_id is the join key in the Sentry UI. |
| Wizard error envelope rendering | Browser (WizardErrorEnvelope.tsx client component) | Frontend Server (envelope shape contract) | Component is "use client" because it uses `<details>` interactivity + `navigator.clipboard`; envelope shape is defined server-side and validated by Zod. |
| `/api/debug-key-flow` SSE | Frontend Server (Next.js Route Handler streams) | API (delegates step execution to FastAPI internal endpoint) | Route Handler hand-rolls `ReadableStream` per Next.js 16 docs; admin auth + audit gate live in Next.js tier; per-step work delegates to FastAPI internal router. |
| VCR cassette replay | API (Python pytest harness) | — | Cassettes live alongside the existing pytest suite; vcrpy decorators wrap exchange-fetch test functions. |
| Trigger / RLS audit | Database (Postgres SECURITY DEFINER) + API (pytest integration tests via service-role psycopg) | — | Trigger semantics are Postgres-native; verification runs from the Python side under the same auth context the Railway worker uses in production. |
| Resend webhook handler | Frontend Server (Next.js Route Handler) | Database (correlation_id ↔ resend_message_id mapping table if fallback needed) | Webhook endpoint is HTTP-receive on the Vercel side; verification logic + DB mapping are server-side. |
| PostHog mobile audit | Frontend Server (one-shot script) | — | Read-only PostHog API call; output is a markdown doc; no production code change. |

## Standard Stack

### Core (new pins for Phase 16)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sentry-sdk[fastapi]` | `==2.58.0` | Python error tracking + ASGI middleware integration | [VERIFIED: locked in CONTEXT.md decisions]. Current sentry-sdk supports FastAPI auto-instrumentation, `before_send` hook for PII redaction, `set_tag()` for correlation_id. Existing `analytics-service/main.py:30-40` already initializes sentry_sdk — Phase 16 adds the `[fastapi]` extra + `before_send` callback. |
| `structlog` | `==25.5.0` | JSON-format structured logs with contextvar binding | [VERIFIED: locked in CONTEXT.md decisions]. `structlog.contextvars.merge_contextvars` processor + `bind_contextvars(correlation_id=...)` is the canonical pattern (Context7-verified, source: hynek/structlog). |
| `vcrpy` | `==8.1.1` | Record/replay HTTP fixtures for deterministic local-repro of broker calls | [VERIFIED: locked in CONTEXT.md decisions; pinned to 8.1.1 in CONTEXT.md `code_context`]. `filter_headers` + `before_record_response` API confirmed via Context7 (source: kevin1024/vcrpy). |

### Existing stack (no new pin — re-uses what's already here)

| Library | Version | Purpose | Phase 16 Usage |
|---------|---------|---------|----------------|
| `@sentry/nextjs` | `^10.48.0` | Next.js Sentry integration | Already wired in `src/instrumentation.ts`. Phase 16 adds `error.tsx` + `global-error.tsx` route boundaries + `correlation_id` tag injection. [VERIFIED: package.json line 21] |
| `next` | `^16.2.3` | Next.js 16 App Router | SSE route handler uses Web-API `ReadableStream` pattern (no `next/server` SSE helper exists). [VERIFIED: package.json + node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md L401-481] |
| `resend` | `^6.10.0` | Email send + webhook events | Plan 5 wires `tags: [{name: "correlation_id", value: cid}]` on send + new `/api/webhooks/resend` route handler. No SDK change required. [VERIFIED: package.json line 30] |
| `posthog-node` / `posthog-js` | `^5.29.2` / `^1.367.0` | Analytics events | Plan 9 reads `wizard_start` events via PostHog query API (read-only audit; no production code change). [VERIFIED: package.json] |
| `@supabase/supabase-js` | `^2.101.1` | Postgres client + auth | Plan 4 uses service-role client to insert into `api_keys` and observe trigger fire. Plan 7 uses `log_audit_event_service` RPC. [VERIFIED: package.json line 23] |
| `cryptography>=44.0` | `>=44.0` | Fernet envelope encryption (KEK + DEK) | Plan 7 reuses existing `encrypt_credentials` / `decrypt_credentials` from `analytics-service/services/encryption.py:55+` to decode the `DEBUG_KEY_FLOW_*` env-var blobs. [VERIFIED: requirements.txt line 16] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Recommendation |
|------------|-----------|----------|----------------|
| `vcrpy` | `pytest-recording`, `betamax`, `responses` | `pytest-recording` wraps vcrpy; betamax is requests-only; responses is mock-only (no record). | **Stay with vcrpy 8.1.1** — already locked in CONTEXT.md, ccxt uses `requests` underneath which vcrpy intercepts cleanly, and Pitfall 17 / Theme 5 require record-not-mock. |
| `structlog` | stdlib `logging` + JSON formatter | stdlib has no contextvar binding; would require a custom `Filter` per logger. | **Stay with structlog 25.5.0** — locked in CONTEXT.md; first-class contextvar support via `merge_contextvars` processor; one-line FastAPI middleware integration. |
| pgTAP for trigger audit | pytest+psycopg | pgTAP runs in-database (closer to Postgres semantics) but requires new tooling install (pgTAP extension on local + CI Postgres) and a `.sql` test format the team has zero existing fixtures for. pytest+psycopg sits next to 1,695 existing tests. | **Use pytest+psycopg** — matches Claude's Discretion in CONTEXT.md and codebase grain. |
| Hand-rolled SSE in Next.js | `ai` SDK `StreamingTextResponse` | The `ai` SDK is for LLM token streaming with a specific Vercel-AI protocol — wrong abstraction for per-step diagnostic JSON events. | **Hand-roll `ReadableStream`** per the Next.js 16 docs example (route.md L401-481). |
| New `audit_log` table | Reuse existing | Existing `audit_log` table already has shape `{user_id, action, entity_type, entity_id, metadata JSONB}` — perfect fit. New table would duplicate retention crons (migration 056). | **Reuse existing** via `log_audit_event_service` RPC with action `debug_key_flow.invoke`. [VERIFIED: src/lib/audit.ts L11-50] |

**Installation (single edit to `analytics-service/requirements.txt`):**

```diff
 fastapi==0.115.12
 uvicorn[standard]==0.34.2
 quantstats==0.0.81
 ccxt>=4.0
 pandas==2.2.3
 numpy==2.2.4
 pyarrow==18.1.0
 pydantic==2.11.3
 python-dotenv==1.1.0
 httpx==0.28.1
 slowapi==0.1.9
 supabase==2.15.1
 cryptography>=44.0
 pandera==0.20.4
 python-multipart==0.0.27
+# Phase 16 / OBSERV-05 + OBSERV-09 + OBSERV-08
+sentry-sdk[fastapi]==2.58.0
+structlog==25.5.0
+vcrpy==8.1.1
```

**Version verification:**

```bash
# Cross-check that all three pins are still current as of 2026-05-01
pip index versions sentry-sdk
pip index versions structlog
pip index versions vcrpy
```

[ASSUMED] The three pins in CONTEXT.md (sentry-sdk 2.58.0, structlog 25.5.0, vcrpy 8.1.1) reflect current PyPI state — verify with `pip index versions` at execution time. Pins are sourced from the CONTEXT.md decisions table; if any pin is stale, planner should flag for user confirmation before changing.

## Architecture Patterns

### System Architecture Diagram (correlation_id flow + observability planes)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BROWSER (wizard click)                          │
│   1. crypto.randomUUID() → correlation_id                               │
│   2. wizard step calls fetch('/api/strategies/create-with-key', {       │
│        headers: {'x-correlation-id': cid}                               │
│      })                                                                 │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                NEXT.JS 16 APP (Vercel Fluid Compute, Node)              │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ Route Handler (e.g., /api/strategies/create-with-key)       │       │
│  │   - reads x-correlation-id; falls back to crypto.randomUUID │       │
│  │   - calls analyticsRequest() — analytics-client.ts:66       │       │
│  │     header injection seam                                    │       │
│  └────────┬────────────────────────────────────────────────────┘       │
│           │                                                             │
│           ├──→ Sentry.setTag('correlation_id', cid)  [OBSERV-04]       │
│           │                                                             │
│           ├──→ analyticsRequest() adds x-correlation-id to fetch()      │
│           │                                                             │
│           └──→ /api/debug-key-flow SSE (admin-only, Plan 7):            │
│               returns Response(new ReadableStream(...), {                │
│                 headers: {'Content-Type': 'text/event-stream'}})        │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │  x-correlation-id header
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│            FASTAPI ANALYTICS SERVICE (Railway, Python 3.12)             │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │ CorrelationMiddleware (ASGI, runs first):                     │      │
│  │   1. cid = req.headers.get('x-correlation-id') or new uuid    │      │
│  │   2. structlog.contextvars.bind_contextvars(correlation_id=cid)│     │
│  │   3. sentry_sdk.set_tag('correlation_id', cid)                │      │
│  │   4. await call_next(request)                                  │      │
│  │   5. clear_contextvars()  (in finally)                         │      │
│  └──────┬─────────────────────────────────────────────────────────┘      │
│         │                                                                │
│         ├──→ structlog.get_logger().info(...) auto-includes cid         │
│         │                                                                │
│         ├──→ Supabase write: include cid in compute_jobs.metadata->     │
│         │     ('correlation_id') via JSONB || merge   [OBSERV-01 ack]   │
│         │                                                                │
│         └──→ Resend send (if any): tags=[{name:"correlation_id",        │
│              value: cid}]   [OBSERV-03 — Plan 5]                        │
└──────┬─────────────────────────────┬───────────────────┬────────────────┘
       │                             │                   │
       ▼                             ▼                   ▼
┌─────────────┐         ┌─────────────────────┐    ┌──────────────────┐
│   SUPABASE  │         │      RESEND          │    │     SENTRY        │
│   (Postgres)│         │  webhook → /api/     │    │  events tagged    │
│             │         │  webhooks/resend     │    │  with cid         │
│ audit_log   │         │  reads tags[] →      │    │  (queryable in    │
│ rows tagged │         │  finds correlation_id│    │  Sentry UI)       │
│ via         │         │  → updates outbound  │    │                   │
│ log_audit_  │         │  email status row    │    │                   │
│ event_      │         │                      │    │                   │
│ service()   │         │  FALLBACK if tags    │    │                   │
│ with        │         │  empirically fail:   │    │                   │
│ entity_id = │         │  (correlation_id,    │    │                   │
│ correlation │         │  resend_message_id)  │    │                   │
│ _id         │         │  mapping table       │    │                   │
│             │         │  Plan 5 verifies     │    │                   │
└─────────────┘         └──────────────────────┘    └───────────────────┘

CASSETTE LAYER (vcrpy, scripts/repro-key-flow.sh — Plan 8):
   tests/cassettes/{okx|binance|bybit}/{happy|auth-fail|rate-limit|schema-drift}.yaml
   → ccxt → Recorded HTTP responses replayed deterministically (zero network)
```

### Recommended Project Structure (additions only — existing structure preserved)

```
src/
├── lib/
│   ├── correlationId.ts            # NEW (Plan 2): generate + read x-correlation-id
│   ├── analytics-client.ts          # MODIFIED (Plan 2): header injection at line 66
│   └── envelope.ts                  # NEW (Plan 6): build envelope from wizardErrors copy
├── app/
│   ├── error.tsx                    # NEW (Plan 3): route-level error boundary
│   ├── global-error.tsx             # NEW (Plan 3): root-level error boundary
│   ├── (dashboard)/strategies/new/wizard/
│   │   ├── WizardErrorEnvelope.tsx  # NEW (Plan 6): structured envelope component
│   │   └── steps/
│   │       ├── ConnectKeyStep.tsx   # MODIFIED (Plan 6): replace inline error w/ envelope
│   │       ├── SyncPreviewStep.tsx  # MODIFIED (Plan 6)
│   │       └── SubmitStep.tsx       # MODIFIED (Plan 6)
│   └── api/
│       ├── debug-key-flow/
│       │   └── route.ts             # NEW (Plan 7): SSE Route Handler
│       └── webhooks/
│           └── resend/
│               └── route.ts         # NEW (Plan 5): webhook receiver

analytics-service/
├── requirements.txt                 # MODIFIED: pin sentry-sdk[fastapi], structlog, vcrpy
├── main.py                          # MODIFIED (Plan 3): upgrade Sentry init, add CorrelationMiddleware
├── services/
│   └── logging_config.py            # NEW (Plan 2): structlog configure() one-time setup
├── routers/
│   └── debug_key_flow.py            # NEW (Plan 7): per-step internal endpoints called by Next.js SSE
└── tests/
    ├── cassettes/                   # NEW (Plan 8)
    │   ├── okx/
    │   │   ├── happy.yaml
    │   │   ├── auth-fail.yaml
    │   │   ├── rate-limit.yaml
    │   │   └── schema-drift.yaml
    │   ├── binance/ (same 4)
    │   └── bybit/  (same 4)
    ├── conftest_vcr.py              # NEW (Plan 8): vcrpy VCR() singleton w/ filter_headers + before_record_response
    └── test_trigger_rls_audit.py    # NEW (Plan 4): pytest integration tests for migrations 084/085/086

scripts/
└── repro-key-flow.sh                # NEW (Plan 8): runs pytest cassette suite

.planning/phase-16/
├── trigger-rls-audit.md             # NEW (Plan 4 deliverable)
├── posthog-mobile-audit.md          # NEW (Plan 9 deliverable)
└── day-2-decision.md                # NEW (Plan 10 — empty template scaffold)

.github/workflows/
└── ci.yml                           # MODIFIED (Plan 1): add file-presence assertion job
```

### Pattern 1: correlation_id seam at `analytics-client.ts:66`

**What:** Generate a UUID at the wizard click (or read existing from inbound header), then inject as `x-correlation-id` on every outbound `fetch` to the analytics service.

**When to use:** Every outbound call from the Next.js tier to FastAPI. Single seam — line 66 of `src/lib/analytics-client.ts`.

**Example:**

```typescript
// Source: src/lib/correlationId.ts (NEW — Plan 2)
import "server-only";
import { headers } from "next/headers";

const HEADER = "x-correlation-id";

/**
 * Read inbound correlation_id from the current request headers, or
 * generate a fresh UUID if absent. Use this at the route-handler entry
 * for every API endpoint that calls into analytics-client.
 */
export async function getCorrelationId(): Promise<string> {
  const h = await headers();
  return h.get(HEADER) ?? crypto.randomUUID();
}

// Source: src/lib/analytics-client.ts:66 (MODIFIED — Plan 2)
async function analyticsRequest(
  path: string,
  body: Record<string, unknown> | null,
  options?: { timeoutMs?: number; method?: string; correlationId?: string },
) {
  const correlationId = options?.correlationId ?? crypto.randomUUID();
  res = await fetch(`${ANALYTICS_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Version": ANALYTICS_API_VERSION,
      "X-Correlation-Id": correlationId,                   // <-- NEW
      ...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY }),
    },
    // ... rest unchanged
  });
}
```

### Pattern 2: structlog + Sentry + correlation_id contextvar (FastAPI middleware)

**What:** ASGI middleware that binds `correlation_id` to a structlog contextvar AND a Sentry tag for the duration of the request. Both auto-include the value on every log line and every Sentry event captured during the request.

**When to use:** Every FastAPI service. Wires once in `analytics-service/main.py` next to the existing `slowapi` limiter.

**Example:**

```python
# Source: analytics-service/services/logging_config.py (NEW — Plan 2 + Plan 3)
import structlog
import sentry_sdk
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from uuid import uuid4

# Configure structlog ONCE at process startup (call from main.py lifespan)
def configure_logging() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,    # auto-inject correlation_id
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.dict_tracebacks,        # JSON-safe stacktraces
            structlog.processors.JSONRenderer(sort_keys=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO+
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
        # Sentry tag — propagates onto any captured exception in this request scope
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("correlation_id", cid)
            try:
                response = await call_next(request)
            finally:
                structlog.contextvars.clear_contextvars()
        # Echo header back so caller can grep against client-side log
        response.headers["x-correlation-id"] = cid
        return response

# Source: analytics-service/main.py (MODIFIED — Plan 2 + Plan 3)
from services.logging_config import configure_logging, CorrelationMiddleware

configure_logging()  # before any logger is created

app = FastAPI(lifespan=lifespan)
app.add_middleware(CorrelationMiddleware)            # FIRST — runs outermost

# Sentry init upgrade — Plan 3 adds before_send + integrations
if SENTRY_DSN:
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        traces_sample_rate=0.1,
        send_default_pii=False,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        before_send=_redact_before_send,            # PII scrub mirror
    )
```

[CITED: Context7 hynek/structlog — `merge_contextvars` + `bind_contextvars` pattern, JSONRenderer with sort_keys]
[CITED: Context7 getsentry/sentry-python — FastAPI integration + before_send hook]

### Pattern 3: Next.js 16 SSE Route Handler (hand-rolled `ReadableStream`)

**What:** Route Handler returns a `Response(new ReadableStream(...), { headers: { "Content-Type": "text/event-stream" } })`. Each event is encoded as `data: ${json}\n\n`. No `next/server` SSE helper exists.

**When to use:** Whenever the client needs progressive server output (not polling, not WebSockets). Requires dynamic rendering — guaranteed by reading `headers()` for auth.

**Example:**

```typescript
// Source: src/app/api/debug-key-flow/route.ts (NEW — Plan 7)
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";
import { logAuditEvent } from "@/lib/audit";
import { getCorrelationId } from "@/lib/correlationId";

// Force dynamic — admin gate reads cookies; SSE must not be cached
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // Fluid Compute (NOT edge — fetches to Railway)

interface SseEvent {
  step: string;
  status: "started" | "ok" | "error";
  correlation_id: string;
  started_at: string;
  duration_ms?: number;
  error?: { code: string; human_message: string };
}

const encoder = new TextEncoder();
function frame(event: SseEvent | { step: "done"; envelope: unknown }): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const correlationId = await getCorrelationId();
  const { broker } = await req.json();

  // Audit BEFORE the work — guarantees a row even if stream aborts
  logAuditEvent(supabase, {
    action: "debug_key_flow.invoke",
    entity_type: "debug_session",
    entity_id: correlationId,
    metadata: { broker, admin_user_id: user!.id },
  });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: validate-key
        controller.enqueue(frame({
          step: "validate_key",
          status: "started",
          correlation_id: correlationId,
          started_at: new Date().toISOString(),
        }));
        const t0 = Date.now();
        const result1 = await fetch(`${process.env.ANALYTICS_SERVICE_URL}/internal/debug-key-flow/validate`, {
          method: "POST",
          headers: { "x-correlation-id": correlationId, "x-internal-token": process.env.INTERNAL_API_TOKEN! },
          body: JSON.stringify({ broker }),
          signal: req.signal,            // honor client cancel under Fluid Compute
        });
        controller.enqueue(frame({
          step: "validate_key",
          status: result1.ok ? "ok" : "error",
          correlation_id: correlationId,
          started_at: new Date(t0).toISOString(),
          duration_ms: Date.now() - t0,
        }));

        // ... encrypt_key, fetch_trades steps follow same pattern ...

        // Terminal envelope
        const envelope = await result1.json();
        controller.enqueue(frame({ step: "done", envelope }));
      } catch (err) {
        controller.enqueue(frame({
          step: "stream_error",
          status: "error",
          correlation_id: correlationId,
          started_at: new Date().toISOString(),
          error: { code: "STREAM_ABORTED", human_message: String(err) },
        }));
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Client disconnected — no extra work needed; controller is auto-closed
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",       // disable any proxy buffering
    },
  });
}
```

[CITED: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md L401-481 — canonical ReadableStream pattern]
[VERIFIED: Vercel knowledge-update injection — Edge runtime is no longer recommended; Fluid Compute (Node.js default) supports graceful shutdown + request cancellation, which is exactly what SSE needs]

### Pattern 4: vcrpy 8.1.1 cassettes with PII scrubbing

**What:** A `vcr.VCR()` singleton configured with `filter_headers` (case-insensitive) AND a `before_record_response` callback that strips body fields. Pytest fixtures wrap test functions; cassette path follows `tests/cassettes/{broker}/{scenario}.yaml`.

**When to use:** Any test against a real third-party HTTP API where the recording must be checked into git.

**Example:**

```python
# Source: analytics-service/tests/conftest_vcr.py (NEW — Plan 8)
import json
import re
import vcr

# Headers to strip entirely (case-insensitive). vcrpy lowercases the keys.
_FILTER_HEADERS = [
    "authorization",
    "x-api-key",
    "x-api-signature",
    "x-passphrase",
    "x-mbx-apikey",
    "ok-access-sign",
    "ok-access-passphrase",
    "ok-access-key",
    "ok-access-timestamp",
]

# Body-level scrubbers — fields to redact before commit
_REDACT_BODY_KEYS = ["accountId", "userId", "email", "address", "ip", "ipAddress"]
_REDACT_VALUE = "[REDACTED]"

def _scrub_response(response):
    """Strip PII from JSON response bodies. Mirrors src/lib/admin/pii-scrub.ts denylist."""
    body_bytes = response.get("body", {}).get("string", b"")
    if not body_bytes:
        return response
    try:
        body = json.loads(body_bytes)
    except (ValueError, TypeError):
        return response

    def walk(obj):
        if isinstance(obj, dict):
            return {k: (_REDACT_VALUE if k.lower() in {x.lower() for x in _REDACT_BODY_KEYS} else walk(v))
                    for k, v in obj.items()}
        if isinstance(obj, list):
            return [walk(x) for x in obj]
        return obj

    response["body"]["string"] = json.dumps(walk(body)).encode()
    return response

phase16_vcr = vcr.VCR(
    cassette_library_dir="tests/cassettes",
    serializer="yaml",
    record_mode="once",                   # CI mode: replay-only; never re-record
    match_on=["method", "scheme", "host", "port", "path", "query"],
    filter_headers=_FILTER_HEADERS,
    before_record_response=_scrub_response,
)

# Usage in a test:
#   from tests.conftest_vcr import phase16_vcr
#   with phase16_vcr.use_cassette("okx/happy.yaml"):
#       result = exchange.fetch_balance()  # plays back recorded response
```

[CITED: Context7 kevin1024/vcrpy — `filter_headers` + `before_record_response` callback API]

**CI grep-for-secrets gate (Plan 8):**

```bash
# Source: scripts/repro-key-flow.sh (NEW — Plan 8) — final smoke test after replay
set -euo pipefail
cd analytics-service

# 1. Run the replay suite
pytest tests/test_repro_key_flow.py -x -q

# 2. CI gate: grep cassettes for ANY known DEBUG_KEY_FLOW_* env value
for var in DEBUG_KEY_FLOW_OKX_KEY DEBUG_KEY_FLOW_OKX_SECRET DEBUG_KEY_FLOW_OKX_PASSPHRASE \
           DEBUG_KEY_FLOW_BINANCE_KEY DEBUG_KEY_FLOW_BINANCE_SECRET \
           DEBUG_KEY_FLOW_BYBIT_KEY DEBUG_KEY_FLOW_BYBIT_SECRET; do
  val="${!var:-}"
  if [ -n "$val" ] && grep -r -F "$val" tests/cassettes/ 2>/dev/null; then
    echo "FAIL: $var leaked into cassettes"
    exit 1
  fi
done
echo "OK: no DEBUG_KEY_FLOW_* values found in cassettes"
```

### Pattern 5: WizardErrorEnvelope component

**What:** Single-prop client component that renders the RFC 9457-style envelope with native `<details>` + clipboard copy. Drop-in replacement for current inline `formatKeyError(...)` rendering blocks in the three wizard steps.

**When to use:** Anywhere a wizard step currently renders an error from `wizardErrors.ts`. Phase 16 scope: ConnectKeyStep, SyncPreviewStep, SubmitStep.

**Example:**

```typescript
// Source: src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.tsx (NEW — Plan 6)
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export interface ErrorEnvelope {
  ok: false;
  code: string;
  human_message: string;
  debug_context: string[];
  correlation_id: string;
  recoverable: boolean;
}

interface Props {
  envelope: ErrorEnvelope;
  onRetry?: () => void;
  onCancel?: () => void;
}

export function WizardErrorEnvelope({ envelope, onRetry, onCancel }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(envelope, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);  // browser blocked clipboard
    }
  }

  return (
    <div role="alert" aria-live="polite" className="...">
      <h3>{envelope.human_message}</h3>
      <ul>{envelope.debug_context.map((step, i) => <li key={i}>{step}</li>)}</ul>
      <details>
        <summary>Diagnostics</summary>
        <p>code: <code>{envelope.code}</code></p>
        <p>correlation_id: <code>{envelope.correlation_id}</code></p>
        <Button type="button" onClick={copyDiagnostics}>
          {copied ? "Copied" : "Copy diagnostics"}
        </Button>
        <span role="status" aria-live="polite">{copied ? "Copied to clipboard" : ""}</span>
      </details>
      <div>
        {envelope.recoverable && onRetry && <Button onClick={onRetry}>Retry</Button>}
        {onCancel && <Button onClick={onCancel} variant="ghost">Cancel</Button>}
      </div>
    </div>
  );
}
```

**Envelope builder bridges existing `wizardErrors.ts`:**

```typescript
// Source: src/lib/envelope.ts (NEW — Plan 6)
import { formatKeyError, type WizardErrorCode, type WizardErrorContext } from "./wizardErrors";
import type { ErrorEnvelope } from "@/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope";

export function buildEnvelope(
  code: WizardErrorCode,
  correlation_id: string,
  context?: WizardErrorContext,
): ErrorEnvelope {
  const copy = formatKeyError(code, context);
  return {
    ok: false,
    code,
    human_message: copy.title,                   // wizardErrors.title → envelope.human_message
    debug_context: copy.fix,                     // wizardErrors.fix[] → envelope.debug_context
    correlation_id,
    recoverable: copy.actions.includes("clear_and_retry") || copy.actions.includes("try_another_key"),
  };
}
```

[VERIFIED: src/lib/wizardErrors.ts — `WizardErrorCopy` shape exactly matches the mapping]

### Pattern 6: Trigger / RLS audit (pytest+psycopg under service-role context)

**What:** Pytest integration tests that connect to a test Supabase as service-role, INSERT into `api_keys` and call `stamp_first_*` RPCs, then assert (a) the trigger fires, (b) `auth.users.raw_user_meta_data` is updated correctly, (c) `auth.uid()` returns NULL inside the trigger function (proving idempotency uses `NEW.user_id`, not `auth.uid()`).

**When to use:** Phase 16 only — one-shot audit. Tests live alongside existing `analytics-service/tests/test_*.py` files.

**Example skeleton:**

```python
# Source: analytics-service/tests/test_trigger_rls_audit.py (NEW — Plan 4)
import os
import uuid
import pytest
import psycopg
from psycopg.rows import dict_row

# Use the test Supabase project (qmnijlgmdhviwzwfyzlc per reference_test_supabase_project.md)
DSN = os.environ["TEST_SUPABASE_DB_URL"]  # set in CI as a GH secret

@pytest.fixture
def service_role_conn():
    """Connection with service_role JWT (auth.uid() returns NULL)."""
    conn = psycopg.connect(DSN, row_factory=dict_row, autocommit=True)
    yield conn
    conn.close()

@pytest.fixture
def fresh_user_id(service_role_conn):
    """Create an auth.users row, return its UUID, clean up after."""
    uid = str(uuid.uuid4())
    with service_role_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (%s, %s, '{}'::jsonb)",
            (uid, f"trigger-audit-{uid[:8]}@quantalyze-test.com"),
        )
    yield uid
    with service_role_conn.cursor() as cur:
        cur.execute("DELETE FROM auth.users WHERE id = %s", (uid,))

def test_migration_084_stamp_first_api_key_added_fires_under_service_role(
    service_role_conn, fresh_user_id
):
    """OBSERV-10: trigger uses NEW.user_id (not auth.uid()) — fires under service-role."""
    with service_role_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO api_keys (user_id, exchange, encrypted_key, dek_encrypted) "
            "VALUES (%s, 'okx', 'sentinel'::bytea, 'sentinel'::bytea)",
            (fresh_user_id,),
        )
        cur.execute(
            "SELECT raw_user_meta_data->>'first_api_key_added_at' AS stamp "
            "FROM auth.users WHERE id = %s",
            (fresh_user_id,),
        )
        row = cur.fetchone()
    assert row["stamp"] is not None, "Trigger did not stamp first_api_key_added_at"

def test_migration_084_idempotent_on_second_insert(service_role_conn, fresh_user_id):
    """OBSERV-10: subsequent INSERTs do NOT overwrite the original stamp."""
    # ... same INSERT twice; assert stamp value identical ...
    pass

def test_migration_085_stamp_first_bridge_surfaced_returns_stamped_true_then_false(
    service_role_conn, fresh_user_id
):
    """OBSERV-10: RPC is single-fire — first call returns stamped:true, second false."""
    with service_role_conn.cursor() as cur:
        cur.execute("SELECT public.stamp_first_bridge_surfaced(%s) AS result", (fresh_user_id,))
        first = cur.fetchone()["result"]
        cur.execute("SELECT public.stamp_first_bridge_surfaced(%s) AS result", (fresh_user_id,))
        second = cur.fetchone()["result"]
    assert first["stamped"] is True
    assert second["stamped"] is False
    assert first["stamped_at"] == second["stamped_at"]

def test_migration_086_claim_compute_jobs_with_priority_throttle(service_role_conn):
    """OBSERV-10: priority='low' rows are skipped when normal/high pending."""
    # ... insert mixed-priority rows, claim batch, assert low rows excluded ...
    pass
```

[VERIFIED: migrations 084.sql L46-91 and 085.sql L58-118 use `NEW.user_id` / `p_user_id` — never `auth.uid()`. Audit confirms expected behavior.]

### Anti-Patterns to Avoid

- **Don't use Edge runtime for the SSE endpoint.** Vercel knowledge-update injection explicitly says Edge has compatibility issues; Fluid Compute (default Node) is the correct runtime. The fetch to Railway needs Node's networking.
- **Don't return a `Response` from a route that uses `text/event-stream` without `Cache-Control: no-cache`.** Vercel's edge cache will buffer the entire stream until completion otherwise.
- **Don't use `set_user(...)` in the Sentry CorrelationMiddleware.** `send_default_pii=False` should be respected — `set_tag("correlation_id", cid)` is sufficient and PII-safe.
- **Don't put structlog `configure()` inside the request middleware.** It must be called ONCE at process startup; calling per-request loses the cache and dramatically slows logging.
- **Don't write the cassette files via `record_mode="all"` in CI.** Use `record_mode="once"` (or `"none"` in CI) — `"all"` re-records on every test run and would silently leak secrets that bypassed `filter_headers`.
- **Don't import the WizardErrorEnvelope component from a Server Component.** It's a Client Component (uses `useState`, `navigator.clipboard`); only import from `"use client"` parents.
- **Don't fall back to "Something went wrong" anywhere.** The existing `WIZARD_ERROR_COPY.UNKNOWN` entry IS the fallback — render it through the envelope; never bypass.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | `Math.random().toString(36)` | `crypto.randomUUID()` | Web-platform standard; collision-resistant; works in Node 20+ and modern browsers. |
| HTTP record/replay | Custom mocking + jsonschema | `vcrpy==8.1.1` | Already locked. Handles cassette format, header filtering, body diffing, ccxt compatibility — months of edge cases solved. |
| Structured JSON logs with request context | Pass `correlation_id` arg to every `logger.info(...)` call manually | `structlog` `bind_contextvars` | Manual passing has 200+ call sites in analytics-service; one missed log line breaks the audit. Contextvar makes it automatic and async-safe. |
| Sentry-FastAPI ASGI wiring | Custom `BaseHTTPMiddleware` that catches and re-raises | `sentry_sdk[fastapi]` extra + `FastApiIntegration()` | Auto-captures unhandled exceptions, performance traces, request-tagged context. Hand-rolled would miss async context propagation. |
| SSE framing | Custom `\r\n\r\n`-delimited format with handshake | `data: ${json}\n\n` per RFC 6202 | EventSource API on browsers expects exact `data: ...\n\n` framing. Anything else fails silently. |
| Audit log table | New table `debug_key_flow_audits` | Existing `audit_log` + `log_audit_event_service` RPC | Already has retention crons (migration 056), append-only invariant (migration 049), GDPR export coverage (`gdpr-export.ts:98`). Reusing means zero new compliance surface. |
| Clipboard copy | `document.execCommand('copy')` | `navigator.clipboard.writeText(...)` | execCommand is deprecated; clipboard API is widely supported and async-safe. |
| Resend webhook signature verification | Hand-rolled HMAC | Resend SDK's official webhook helper (or Svix's) | Plan 5 must verify the SDK exposes a `verifyWebhook(payload, signature, secret)` helper before hand-rolling. |
| PostHog event query | Direct fetch + JSON parsing | PostHog `posthog-node` SDK or HogQL endpoint | Plan 9 is read-only; either approach works but the SDK handles auth + pagination. |

**Key insight:** Phase 16 is a deliberately library-heavy phase — the value is in *wiring*, not in *building*. Every "new module" in this research either glues two libraries together (e.g., CorrelationMiddleware) or provides a thin envelope around an existing repo module (e.g., `buildEnvelope` over `formatKeyError`). Resist any plan task that proposes a new framework-shaped abstraction.

## Runtime State Inventory

> Phase 16 is a *new instrumentation* phase, not a rename/refactor. The five categories below are checked for completeness — most are empty by design.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 16 ships no schema changes (per `.planning/phase-16/migration-drift-resolution.md` "No new migrations expected"). The new code reads/writes existing `audit_log` and `compute_jobs.metadata` JSONB columns. | None |
| Live service config | **Railway env vars to add (set BEFORE Plan 7 ships):** `DEBUG_KEY_FLOW_OKX_KEY`, `DEBUG_KEY_FLOW_OKX_SECRET`, `DEBUG_KEY_FLOW_OKX_PASSPHRASE`, `DEBUG_KEY_FLOW_BINANCE_KEY`, `DEBUG_KEY_FLOW_BINANCE_SECRET`, `DEBUG_KEY_FLOW_BYBIT_KEY`, `DEBUG_KEY_FLOW_BYBIT_SECRET`, `INTERNAL_API_TOKEN` (for the new `/internal/debug-key-flow/*` endpoint). **Vercel env vars to add:** `INTERNAL_API_TOKEN` (mirror), `RESEND_WEBHOOK_SECRET`. | Manual ops step — document in Plan 7 + Plan 5 prerequisites; founder runs `railway variables set` and `vercel env add` before deploy. |
| OS-registered state | None — no Windows Task Scheduler, no launchd, no systemd. Existing pg_cron jobs (migration 056) untouched. | None |
| Secrets / env vars | `SENTRY_DSN` already present (verified at `analytics-service/main.py:29`). New `DEBUG_KEY_FLOW_*` keys are NEW env vars; `INTERNAL_API_TOKEN` is REUSED (already used by `analytics-service/routers/internal.py`). `RESEND_WEBHOOK_SECRET` is NEW. | Document in Plan 5 + Plan 7. Verify `INTERNAL_API_TOKEN` is identical between Vercel and Railway — Plan 7 fails closed if not. |
| Build artifacts / installed packages | After `requirements.txt` edit (Plan 3), Railway must rebuild the analytics-service container so `sentry-sdk[fastapi]`, `structlog`, `vcrpy` install. Vercel side: no new top-level deps (Sentry already pinned). | Plan 3 acceptance includes a successful Railway redeploy with logs showing `[sentry] Initializing FastApiIntegration`. |

**Nothing found in category:** Stated explicitly above for "Stored data" and "OS-registered state" — verified by grep for new migration files in CONTEXT.md (none expected) and absence of any pg_cron / cron / launchd / Task Scheduler references in the locked plan list.

## Common Pitfalls

### Pitfall 1: Resend `tags` array shape mismatch on send vs webhook receive

**What goes wrong:** Plan 5 sends `tags: [{name: "correlation_id", value: cid}]` (array of objects per send-API spec). When the webhook fires, the handler reads `payload.data.tags` expecting the same array — but a third-party blog example shows Resend's webhook payload has `tags: { "category": "..." }` (flat dict). Other examples show `tags: [{name, value}]` matching send.

**Why it happens:** Resend's documentation page for webhook event types is stub-quality — neither `email.sent` nor `email.delivered` documents the full `data` field schema. The official `resend/resend-webhooks-ingester` boilerplate types `data.tags?: WebhookTag[]` but marks it optional and does NOT include `tags` in the `email.delivered` fixture. Empirical behavior is undocumented.

**How to avoid:** Plan 5 MUST include an empirical verification step: send a real test email with `tags: [{name: "correlation_id", value: "test-uuid-123"}]`, capture the resulting webhook payload from a temp endpoint (use https://webhook.site or a Vercel preview deploy), and assert the array shape round-trips. If it does, ship Path A (read `tags`). If it doesn't, ship Path B (`(correlation_id, resend_message_id)` mapping table — write at send time, read at webhook time).

**Warning signs:** Plan 5 acceptance checklist includes a screenshot or curl-output of an actual webhook payload received during development. If Plan 5 ships without that artifact, the round-trip is unverified and Pitfall 17 has not actually been mitigated.

### Pitfall 2: Next.js 16 Edge runtime is no longer recommended for SSE

**What goes wrong:** Training data may suggest `export const runtime = "edge"` for SSE endpoints. The Vercel knowledge-update (2026-02-27) explicitly says "Edge functions have compatibility issues. Instead use Fluid Compute (default) which runs in the same regions and has the same price."

**Why it happens:** Pre-2026 Vercel content recommended Edge for streaming workloads.

**How to avoid:** Plan 7 must use `export const runtime = "nodejs"` (or omit — that's the default under Fluid Compute). The fetch-to-Railway is the killing blow for Edge anyway: outbound fetches to internal Railway endpoints want Node networking. Confirm by checking the SSE test passes against `vercel dev` locally and a Vercel preview deploy.

**Warning signs:** If `vercel.json` or `vercel.ts` adds `runtime: "edge"` for the new route, fail Plan 7 review.

### Pitfall 3: structlog contextvar leaks across requests in async ASGI

**What goes wrong:** structlog's `contextvars` are Python `contextvars.ContextVar` — they DO propagate across asyncio tasks correctly, but if the middleware forgets to `clear_contextvars()` in `finally`, a subsequent request handled on the same worker can inherit the prior request's `correlation_id`.

**Why it happens:** The pattern in Context7 docs shows `clear_contextvars()` at the START of the request handler. In a middleware that wraps `call_next`, you need the clear in BOTH places (start, to bin any leaked state from a prior crash, AND finally, to leave a clean slate).

**How to avoid:** The Pattern 2 example above includes both. Plan 2 review checklist must explicitly verify `clear_contextvars()` is in the `finally:` block of the middleware.

**Warning signs:** Logs showing the same `correlation_id` on requests from different users, or the Sentry tag persisting across unrelated request scopes.

### Pitfall 4: vcrpy cassette secret leaks via response BODY (filter_headers covers headers only)

**What goes wrong:** Exchanges like OKX echo the user's API key prefix in the response body (e.g., `"apiKey": "abc1...***"`). `filter_headers` does NOT touch response bodies. Without a `before_record_response` callback that walks the JSON body, secrets can land in the cassette even with all the right header filters.

**Why it happens:** The `filter_post_data_parameters` and `filter_query_parameters` cover request-side; `filter_headers` covers headers; nothing in vcrpy auto-redacts response bodies.

**How to avoid:** Pattern 4 above includes the `_scrub_response` callback that walks JSON body keys. Plan 8 grep-for-secrets gate (cron of `scripts/repro-key-flow.sh`) is the belt-and-braces guard — even if scrubbing has a bug, the grep will catch known DEBUG_KEY_FLOW_* values.

**Warning signs:** Cassette diff in PR shows any string that looks like a key prefix or a JWT-shaped value.

### Pitfall 5: `auth.uid()` returns NULL inside SECURITY DEFINER trigger when called from service-role context

**What goes wrong:** A migration that uses `auth.uid()` inside a trigger function will return NULL when the INSERT runs under a service-role JWT (because no end-user JWT is on the wire). If the trigger logic depends on `auth.uid()` for the user reference, it would silently no-op or write the wrong row.

**Why it happens:** SECURITY DEFINER functions run with the *function owner's* permissions but `auth.uid()` reads from the *invoker's* JWT — and the service-role JWT has no `sub` claim that maps to `auth.uid()`.

**How to avoid:** Migrations 084 and 085 already do the right thing — they use `NEW.user_id` (trigger context) and `p_user_id` (RPC argument). Plan 4 verifies this empirically by inserting under service-role and asserting the trigger fires correctly. If a future migration breaks this pattern, the test catches it at PR time.

**Warning signs:** A test that inserts under user-context succeeds but the same test under service-role context fails or no-ops silently.

### Pitfall 6: Sentry `before_send` strips PII but breaks if it raises

**What goes wrong:** A `before_send` hook that crashes (e.g., on an unexpected event shape) drops the event silently. If the hook tries to access `event["request"]["headers"]` and headers is None, the AttributeError swallows the entire event.

**Why it happens:** Sentry SDK catches `before_send` exceptions and drops events to avoid breaking the host application — but this means PII redaction failures look like "Sentry just isn't capturing anything."

**How to avoid:** `_redact_before_send` must wrap its own logic in `try/except` and return the unmodified event on any error. Plan 3 review checklist asserts the hook has a `try/except` around the body and a unit test that feeds it a malformed event.

**Warning signs:** Sentry dashboard shows a sudden drop to zero events after a deploy — likely the `before_send` hook is crashing on every event.

### Pitfall 7: `crypto.randomUUID()` not available in older Node runtimes

**What goes wrong:** Projects pinned to Node 18 or earlier may not have `crypto.randomUUID()` globally available without explicit import.

**Why it happens:** It became a global in Node 19+; before that you had to `import { randomUUID } from "crypto"`.

**How to avoid:** This repo is on Node 20 (per CI config) and Vercel knowledge-update says Node 24 LTS is the current Vercel default. Both have `crypto.randomUUID()` global. Verify by running `node -e "console.log(crypto.randomUUID())"` in the Vercel runtime — should print a UUID without error.

**Warning signs:** A `ReferenceError: crypto is not defined` in production logs after Plan 2 ships.

### Pitfall 8: SSE clients see no events until the first chunk flushes through Vercel's proxy

**What goes wrong:** Vercel may buffer the first ~64KB of a streaming response by default. If the diagnostic flow takes 30s and emits one event every 5s but each event is only 200 bytes, the client may see nothing until the buffer fills.

**Why it happens:** Edge proxy buffering optimizes throughput; SSE wants the opposite (low-latency push).

**How to avoid:** Set `X-Accel-Buffering: no` in the response headers (included in Pattern 3 example). Test against a Vercel preview deploy, not just local — local Next dev server doesn't replicate the proxy.

**Warning signs:** SSE works locally but the client sees nothing in production until ~30s later when the stream completes.

### Pitfall 9: WizardErrorEnvelope `<details>` element inside a form silently submits the form when toggled

**What goes wrong:** In some browsers, clicking a `<summary>` inside a `<form>` element bubbles a synthetic submit event.

**Why it happens:** Spec-compliant behavior in some implementations.

**How to avoid:** Add `type="button"` to any nested `<button>` inside the envelope (already in Pattern 5 example). Plan 6 review checklist verifies the component renders correctly inside the wizard's existing form contexts (ConnectKeyStep wraps inputs in a form).

**Warning signs:** Clicking "Diagnostics" expands the panel AND triggers a wizard step retry.

## Code Examples

### Example 1: Sentry FastAPI init with before_send PII scrub

```python
# Source: analytics-service/main.py (UPGRADE — Plan 3)
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

# Mirror of src/lib/admin/pii-scrub.ts denylist
_PII_KEYS = {"apikey", "apisecret", "secret", "signature", "passphrase",
             "authorization", "x-mbx-apikey", "ok-access-sign"}

def _scrub(d):
    if not isinstance(d, dict):
        return d
    out = {}
    for k, v in d.items():
        if k.lower() in _PII_KEYS:
            out[k] = "[REDACTED]"
        elif isinstance(v, dict):
            out[k] = _scrub(v)
        elif isinstance(v, list):
            out[k] = [_scrub(x) for x in v]
        else:
            out[k] = v
    return out

def _redact_before_send(event, hint):
    try:
        if "request" in event and isinstance(event["request"].get("headers"), dict):
            event["request"]["headers"] = _scrub(event["request"]["headers"])
        if "extra" in event:
            event["extra"] = _scrub(event["extra"])
        return event
    except Exception:
        return event   # never break Sentry on a redaction bug

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        traces_sample_rate=0.1,
        send_default_pii=False,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        before_send=_redact_before_send,
        environment=os.getenv("RAILWAY_ENVIRONMENT_NAME", "development"),
    )
```

### Example 2: Resend send with correlation_id tag + webhook receiver

```typescript
// Source: src/lib/email.ts (MODIFIED — Plan 5)
const result = await resend.emails.send({
  from, to, subject, html,
  tags: [
    { name: "correlation_id", value: correlationId },
    { name: "kind", value: "submission_notify" },
  ],
});

// Plan 5 fallback: ALWAYS write the mapping row regardless of tag-round-trip outcome.
// Cheap insurance — Pitfall 17 says this fallback IS the spec-compliant safety net.
await supabase.from("resend_message_correlation").insert({
  resend_message_id: result.data?.id,
  correlation_id: correlationId,
  sent_at: new Date().toISOString(),
});
```

```typescript
// Source: src/app/api/webhooks/resend/route.ts (NEW — Plan 5)
import { NextResponse, type NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const payload = await req.json();
  // ... verify Resend signature with RESEND_WEBHOOK_SECRET ...

  // Path A (preferred): read correlation_id from tags array
  let cid: string | null = null;
  const tags = payload?.data?.tags;
  if (Array.isArray(tags)) {
    cid = tags.find((t: any) => t.name === "correlation_id")?.value ?? null;
  } else if (tags && typeof tags === "object") {
    cid = tags.correlation_id ?? null;          // dict-shape fallback (defensive)
  }

  // Path B (always-on fallback per Pitfall 17): look up by resend_message_id
  if (!cid && payload?.data?.email_id) {
    const { data } = await supabaseAdmin
      .from("resend_message_correlation")
      .select("correlation_id")
      .eq("resend_message_id", payload.data.email_id)
      .single();
    cid = data?.correlation_id ?? null;
  }

  if (!cid) {
    console.warn("[resend-webhook] correlation_id not recoverable", payload?.data?.email_id);
  }

  // Update audit row, emit Sentry breadcrumb tagged with cid, etc.
  return NextResponse.json({ ok: true });
}
```

### Example 3: Day-2 decision document scaffold (Plan 10 deliverable)

See full template in the **Day-2 Decision Document Template** section below.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Edge runtime for streaming endpoints | Fluid Compute (default Node.js) | Vercel knowledge-update 2026-02-27 | Plan 7 must use `export const runtime = "nodejs"` (or omit). |
| Hand-roll JSON loggers in Python | structlog with `JSONRenderer` + `merge_contextvars` | structlog 21+ (stable for years) | Plan 2 standard wiring; no migration risk. |
| `vault.secrets` / `pgsodium` for KEK storage | Railway env-var (existing pattern in this codebase) | Day-0.5 pre-flight 2026-05-01 | Phase 16 plans MUST NOT reference "Vault" — say "Railway env-var" or "KEK env-var". |
| Mock library (`responses`, manual jsonschema) for HTTP fixtures | `vcrpy` cassette record/replay | Theme 5 closure decision | Plan 8 ships cassettes, not mocks. |
| Sentry `traces_sample_rate=1.0` | `0.1` to bound cost | Both Sentry init blocks (Next.js + FastAPI) already on 0.1 | Plan 3 keeps existing rate; do not raise. |

**Deprecated/outdated in training data:**
- "Use `next/server` SSE helpers" — they don't exist; use Web-API `ReadableStream`.
- "Vercel charges per GB-second" — Vercel knowledge-update says Active CPU pricing now (CPU time + memory + invocations).
- "Node 18 is the current Vercel default" — Node 24 LTS is current default.
- "Supabase Vault is the canonical KEK store" — this codebase has never used Vault; Day-0.5 pre-flight document is the canonical correction.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Next.js dev/build/test | ✓ | 20+ (CI pin), Vercel runtime 24 LTS | — |
| Python | analytics-service tests + worker | ✓ | 3.12 (Dockerfile), 3.14+ (recommended local) | — |
| pip | requirements.txt install | ✓ | bundled | — |
| Supabase CLI | local migration apply | [ASSUMED ✓] | per `package.json` no Supabase CLI dep — operator runs `supabase db push` per Path C | — |
| psql / psycopg | trigger-audit pytest tests | ✓ | psycopg already a transitive dep via `supabase==2.15.1` | — |
| `pip` package: sentry-sdk | Plan 3 | ✗ (not in requirements.txt) | — | Adds via Plan 3 requirements.txt edit + Railway redeploy |
| `pip` package: structlog | Plan 2 | ✗ | — | Adds via Plan 2 requirements.txt edit |
| `pip` package: vcrpy | Plan 8 | ✗ | — | Adds via Plan 8 requirements.txt edit |
| Sentry DSN | OBSERV-04 + OBSERV-05 | [ASSUMED ✓] env-var present | — | Skip Sentry init if `SENTRY_DSN` env unset (existing guard in `instrumentation.ts:2` and `main.py:30`) |
| PostHog API key + project ID | Plan 9 audit | [ASSUMED ✓] env-var present (existing posthog-node usage) | — | Plan 9 documents "0" if PostHog unavailable; downstream DESIGN-04 ships 640px gate |
| Resend API key | Plan 5 send | ✓ already used by `src/lib/email.ts` | — | Plan 5 webhook receiver still ships even if test send is gated; verification step uses webhook.site as a temporary endpoint |
| Resend webhook signing secret | Plan 5 receiver | ✗ NEW env-var | — | Founder generates in Resend dashboard; `RESEND_WEBHOOK_SECRET` added to Vercel env |
| Test Supabase project (`qmnijlgmdhviwzwfyzlc`) | Plan 4 trigger-audit pytest | ✓ already wired per MEMORY reference | — | Tests gated by `TEST_SUPABASE_DB_URL` env; skipped if unset |
| `DEBUG_KEY_FLOW_*` env vars | Plan 7 SSE endpoint test runs | ✗ NEW env-vars | — | Founder encrypts test broker creds via existing KEK Fernet, sets blobs in Railway. Pre-flight script in Plan 7 verifies decrypt round-trips before endpoint goes live. |

**Missing dependencies with no fallback:**
- `RESEND_WEBHOOK_SECRET` — Plan 5 cannot ship verified webhook receipt without it. Founder action required.
- `DEBUG_KEY_FLOW_*` env vars — Plan 7 endpoint needs the test creds to actually exercise the flow. Founder action required.

**Missing dependencies with fallback:**
- All three new pip packages — straightforward `requirements.txt` edit + Railway redeploy.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (TypeScript) | Vitest 4.1.2 (config: `vitest.config.ts`) |
| Framework (E2E) | Playwright 1.59.1 (config: `playwright.config.ts`) |
| Framework (Python) | pytest with pytest-asyncio + pytest-cov (config: `analytics-service/pytest.ini`) |
| Quick run command (TS unit) | `npx vitest run src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.test.tsx` |
| Quick run command (Python) | `cd analytics-service && pytest tests/test_trigger_rls_audit.py -x` |
| Full TS suite | `npm test` |
| Full Python suite | `cd analytics-service && pytest --cov=. --cov-fail-under=80` |
| E2E suite | `npm run test:e2e` |
| Cassette replay | `bash scripts/repro-key-flow.sh` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBSERV-01 | correlation_id header injected at analytics-client.ts:66 on every outbound fetch | unit | `npx vitest run src/lib/analytics-client.test.ts` | ❌ Wave 0 |
| OBSERV-02 | FastAPI middleware binds correlation_id to structlog contextvar AND Sentry tag | unit (Python) | `cd analytics-service && pytest tests/test_correlation_middleware.py -x` | ❌ Wave 0 |
| OBSERV-03 | Resend send includes `tags: [{name:"correlation_id",value:cid}]`; webhook handler extracts via Path A or fallback Path B | unit + manual | `npx vitest run src/app/api/webhooks/resend/route.test.ts` + manual webhook capture | ❌ Wave 0 |
| OBSERV-04 | error.tsx + global-error.tsx call Sentry.captureException with correlation_id tag | unit | `npx vitest run src/app/error.test.tsx` | ❌ Wave 0 |
| OBSERV-05 | sentry-sdk[fastapi] init succeeds; before_send hook redacts PII from headers/extra | unit (Python) | `cd analytics-service && pytest tests/test_sentry_init.py -x` | ❌ Wave 0 |
| OBSERV-06 | WizardErrorEnvelope renders `human_message`, `<details>`, copy button; clipboard copy emits ARIA-live "Copied" | unit + RTL | `npx vitest run src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.test.tsx` | ❌ Wave 0 |
| OBSERV-07 | /api/debug-key-flow rejects non-admin; admin call streams per-step events; audit row inserted | unit + integration | `npx vitest run src/app/api/debug-key-flow/route.test.ts` + manual SSE smoke | ❌ Wave 0 |
| OBSERV-08 | scripts/repro-key-flow.sh runs all 12 cassettes in <30s with zero network; CI grep finds zero secrets | shell | `bash scripts/repro-key-flow.sh` | ❌ Wave 0 |
| OBSERV-09 | structlog JSON output includes correlation_id and timestamp on every record | unit (Python) | `cd analytics-service && pytest tests/test_logging_config.py -x` | ❌ Wave 0 |
| OBSERV-10 | stamp_first_api_key_added trigger fires under service-role; stamp_first_bridge_surfaced returns stamped:true once then stamped:false | integration (Python+psycopg) | `cd analytics-service && pytest tests/test_trigger_rls_audit.py -x` | ❌ Wave 0 |
| OBSERV-11 | PostHog query returns mobile wizard_start count for 30d window; doc committed to phase-16/posthog-mobile-audit.md | manual-only | (operator runs query, commits doc + TODOS.md line) | N/A (deliverable is markdown) |
| OBSERV-12 | CI job asserts presence of e2e/api-key-flow.spec.ts + scripts/seed-full-app-demo.ts + src/lib/observability.ts | shell (CI) | `.github/workflows/ci.yml` job `restore-fixtures-presence` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Quick run command for the directly-touched test (e.g., `npx vitest run src/lib/analytics-client.test.ts` after the analytics-client edit).
- **Per wave merge:** Full Vitest suite + Python pytest suite (`npm test && cd analytics-service && pytest -x`).
- **Phase gate:** Full TS + Python + E2E suites green; cassette replay green; CI presence-check green; trigger-audit integration tests green against test Supabase project.

### Wave 0 Gaps

- [ ] `src/lib/analytics-client.test.ts` — covers OBSERV-01 (fetch wrapper sends x-correlation-id)
- [ ] `analytics-service/tests/test_correlation_middleware.py` — covers OBSERV-02 (contextvar binding + Sentry tag)
- [ ] `src/app/api/webhooks/resend/route.test.ts` — covers OBSERV-03 (tag extraction + fallback path)
- [ ] `src/app/error.test.tsx` + `src/app/global-error.test.tsx` — covers OBSERV-04 (route boundary capture)
- [ ] `analytics-service/tests/test_sentry_init.py` — covers OBSERV-05 (before_send PII scrub)
- [ ] `src/app/(dashboard)/strategies/new/wizard/WizardErrorEnvelope.test.tsx` — covers OBSERV-06 (component contract)
- [ ] `src/app/api/debug-key-flow/route.test.ts` — covers OBSERV-07 (admin gate + SSE stream contract)
- [ ] `analytics-service/tests/test_repro_key_flow.py` + `analytics-service/tests/conftest_vcr.py` — covers OBSERV-08 (cassette replay harness)
- [ ] `analytics-service/tests/test_logging_config.py` — covers OBSERV-09 (structlog JSON renderer)
- [ ] `analytics-service/tests/test_trigger_rls_audit.py` — covers OBSERV-10 (trigger + RPC integration)
- [ ] CI job `restore-fixtures-presence` in `.github/workflows/ci.yml` — covers OBSERV-12

*(OBSERV-11 is a manual deliverable, not a test gap.)*

## Security Domain

> Security enforcement applies — Phase 16 ships an admin-gated SSE endpoint, a webhook receiver, and modifies the analytics-service Sentry hook (PII flow point).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuse existing Supabase Auth + admin role gate (`isAdminUser` + `withAdminAuth`); no new auth surface. |
| V3 Session Management | yes | SSE endpoint is per-request scoped; no persistent session state. Audit-log row anchors the session via correlation_id. |
| V4 Access Control | yes | `/api/debug-key-flow`: admin role + 5/hour rate limit + audit row mandatory. `/api/webhooks/resend`: HMAC signature verification via `RESEND_WEBHOOK_SECRET`. Non-admins receive 403 (NOT 404 — would leak existence). |
| V5 Input Validation | yes | Zod schemas on all envelope shapes; pydantic on FastAPI request bodies. SSE event payload size bounded (<4KB per event). |
| V6 Cryptography | yes | Reuse existing Fernet KEK (Railway env-var) for `DEBUG_KEY_FLOW_*` blob decrypt — never hand-roll. Webhook signature uses Resend's standard HMAC-SHA256 — never hand-roll. |

### Known Threat Patterns for {Next.js + FastAPI + Supabase + Resend}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key/secret leak via cassette commit | Information Disclosure | vcrpy `filter_headers` + `before_record_response` body scrub + CI grep gate (Pattern 4 above). Belt-and-braces. |
| Sentry event leaks PII (Authorization header, OKX api_key) | Information Disclosure | `send_default_pii=False` + `before_send` hook with `try/except` wrap (Pitfall 6) + denylist mirror of `pii-scrub.ts`. |
| Admin endpoint bypass via missing audit row on early-error path | Repudiation | Insert audit row BEFORE the work begins (Pattern 3 above puts `logAuditEvent` immediately after admin check, before stream start). |
| SSE endpoint abused for credential harvesting (admin account compromise) | Elevation of Privilege | 5 invocations/hour/admin in-memory rate limit + audit row enables forensic review + test creds are NEVER user-real keys (separate `DEBUG_KEY_FLOW_*` blobs). |
| Resend webhook spoofing | Tampering | HMAC-SHA256 signature verification with `RESEND_WEBHOOK_SECRET` BEFORE parsing payload. Reject + log signature failures. |
| `auth.uid()` returns NULL in trigger → no-op silently | Tampering | Plan 4 trigger-audit pytest tests prove `NEW.user_id` (not `auth.uid()`) is the canonical user reference; future migrations break loud, not quiet. |
| structlog contextvar bleeds correlation_id across requests | Information Disclosure | `clear_contextvars()` in middleware `finally:` (Pitfall 3). Plan 2 review checklist gates on this. |
| Webhook fallback table (`resend_message_correlation`) accumulates indefinitely | Other (resource) | Add a 90-day retention pg_cron job in Plan 5 (mirrors migration 056 pattern) OR document as a Phase 18 follow-up if retention can wait. |

## Day-2 Decision Document Template (Plan 10 scaffold)

Plan 10 ships an empty-template version of `.planning/phase-16/day-2-decision.md`. Plan-checker validates the structure exists before Phase 18 entry. The founder fills it at the gate.

**Required sections (founder fills at the gate):**

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
  - <correlation_id-2>
---

# Phase 16 Exit — Day-2 Decision Document

## TL;DR
<One sentence: SKIP / COMMIT / HOLD and the bottom-line reason.>

## Section 1 — Candidate Root Causes (ranked by evidence weight)

| # | Hypothesis | Evidence (correlation_id chain) | Weight | Refuted? |
|---|------------|--------------------------------|--------|----------|
| 1 | <e.g., OKX passphrase encoding> | <list correlation_ids that point here> | <HIGH/MED/LOW> | <yes/no + why> |
| 2 | <hypothesis> | <evidence> | <weight> | <yes/no> |
| ... | | | | |

**Top hypothesis (founder commit):** <name>

## Section 2 — Regression Test Snippet for the Chosen Fix

> The test MUST fail without the fix and pass with the fix. Phase 18 entry gate checks this snippet exists and is syntactically valid for the target test framework.

```<typescript|python>
// File: <path>
// Run: <command>
test('regression-<short>', async () => {
  // Arrange: reproduce the failing condition
  // Act: invoke the affected code path
  // Assert: behavior currently fails; will pass after Phase 18 fix
});
```

**Why this test gates the Phase 18 fix:** <one paragraph>

## Section 3 — Refutation of Each Phase 19 Task (only required if SKIP path chosen)

> If COMMIT, skip to Section 4. If SKIP, every Phase 19 task below MUST have an explicit refutation.

| Phase 19 REQ | Why Phase 19 Is NOT Needed Given the Day-2 Finding |
|--------------|---------------------------------------------------|
| BACKBONE-01 (POST /process-key) | <refutation> |
| BACKBONE-02 (IngestionAdapter) | <refutation> |
| BACKBONE-03 (strategy_verifications state machine) | <refutation> |
| BACKBONE-04 (4-PR VIEW-shim) | <refutation> |
| BACKBONE-05 (feature flag) | <refutation> |
| BACKBONE-06 (flag-monitor cron) | <refutation> |
| BACKBONE-07 (wizard_session_id idempotency) | <refutation> |
| BACKBONE-08 (long-fetch worker dispatch) | <refutation> |
| BACKBONE-09 (perp correctness) | <refutation> |
| BACKBONE-10 (route inventory) | <refutation> |
| FINGERPRINT-01 (JSONB fingerprint) | <refutation> |
| FINGERPRINT-02 (compute_similarity SQL) | <refutation> |

## Section 4 — Falsifiable SKIP / COMMIT / HOLD Criteria

**SKIP requires ALL three:**
- [ ] Single correlation_id chain points to ONE config or ONE single-LOC bug
- [ ] Fix has a regression test (Section 2) that fails without it
- [ ] No other failure mode unexplained in the diagnostic output

**COMMIT requires ANY ONE:**
- [ ] 2+ root causes surfaced
- [ ] Fix would touch ≥3 files in divergent paths
- [ ] No clean unit test possible (e.g., needs cross-tier coordination)

**HOLD requires ANY ONE:**
- [ ] Surfaced root cause is unfamiliar to the founder
- [ ] Founder cannot construct a regression test in <2h
- [ ] Founder is fatigued / not in a state to commit (24h re-evaluation)

## Section 5 — correlation_id Evidence Chain (full audit)

> Every correlation_id observed during the diagnostic spike, with the layer it surfaced in. This is the audit trail Phase 18 references.

| correlation_id | Origin (wizard click ts) | Next.js Sentry | Python Sentry | Supabase audit_log | compute_jobs.metadata | Resend webhook | Notes |
|----------------|-----------------------|----------------|---------------|--------------------|--------------------|----------------|-------|
| <uuid> | <ts> | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗/N/A | <observation> |

## Section 6 — Decision

**Final decision:** <SKIP | COMMIT | HOLD>

**Justification (one paragraph):**
<text>

**Next phase:**
- If SKIP: Phase 18 with single-fix scope; Phase 19 explicitly NOT entered. Milestone closes after Phase 18.
- If COMMIT: Phase 17 → Phase 18 → Phase 19 full sequence.
- If HOLD: re-evaluate in 24h; Phase 17 design work continues; Phase 18/19 deferred until HOLD lifts.

**Signed:** <founder name>
**Date:** <ISO8601>
```

## Library API Quick Reference

### sentry-sdk[fastapi] 2.58.0 — init pattern

```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),                 # gate: skip if absent
    traces_sample_rate=0.1,                       # 10% of transactions
    send_default_pii=False,                       # CRITICAL: don't auto-attach IPs/cookies
    integrations=[StarletteIntegration(), FastApiIntegration()],
    before_send=_redact_before_send,              # PII scrub mirror of pii-scrub.ts
    environment=os.getenv("RAILWAY_ENVIRONMENT_NAME", "development"),
)

# Per-request tag (inside CorrelationMiddleware):
with sentry_sdk.new_scope() as scope:
    scope.set_tag("correlation_id", cid)
    # ... handle request ...
```

### structlog 25.5.0 — configure + bind

```python
import structlog

# ONCE at process startup (call from main.py before app = FastAPI())
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,    # auto-include bound vars
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.dict_tracebacks,
        structlog.processors.JSONRenderer(sort_keys=True),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO and above
    cache_logger_on_first_use=True,
)

# Per-request (in middleware):
from structlog.contextvars import bind_contextvars, clear_contextvars
clear_contextvars()
bind_contextvars(correlation_id=cid, method=req.method, path=req.url.path)
try:
    response = await call_next(request)
finally:
    clear_contextvars()                            # CRITICAL: prevent leak

# In any module that wants to log:
import structlog
log = structlog.get_logger()
log.info("validate_key.started", broker="okx")    # auto-includes correlation_id
```

### vcrpy 8.1.1 — VCR singleton + use_cassette

```python
import vcr

phase16_vcr = vcr.VCR(
    cassette_library_dir="tests/cassettes",
    serializer="yaml",
    record_mode="once",                           # CI: replay-only; never re-record
    match_on=["method", "scheme", "host", "port", "path", "query"],
    filter_headers=[
        "authorization", "x-api-key", "x-api-signature", "x-passphrase",
        "x-mbx-apikey", "ok-access-sign", "ok-access-passphrase",
        "ok-access-key", "ok-access-timestamp",
    ],
    before_record_response=_scrub_response,       # body scrub
    before_record_request=lambda r: r,            # could drop /login etc.
)

# Pattern A: context manager
with phase16_vcr.use_cassette("okx/happy.yaml"):
    result = exchange.fetch_balance()

# Pattern B: pytest decorator (preferred for parametrized tests)
@phase16_vcr.use_cassette("okx/auth-fail.yaml")
def test_okx_auth_fail():
    with pytest.raises(ccxt.AuthenticationError):
        exchange.fetch_balance()
```

### Next.js 16 SSE — Route Handler skeleton

```typescript
export const dynamic = "force-dynamic";
export const runtime = "nodejs";   // Fluid Compute, NOT edge

const encoder = new TextEncoder();
const frame = (event: unknown) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

export async function POST(req: NextRequest) {
  // ... auth + audit BEFORE stream ...
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(frame({ step: "validate_key", status: "started", ... }));
      // ... do work ...
      controller.enqueue(frame({ step: "done", envelope }));
      controller.close();
    },
    cancel() { /* client disconnected */ },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

## Pitfalls Encountered

(See "Common Pitfalls" section above for the full nine pitfalls. Three are surfaced here as required by the orchestrator's Phase 16 prompt.)

### Pitfall A: Resend tag round-trip empirical ambiguity (Pitfall 17 from autoplan)

**Source ambiguity:** Official `resend/resend-webhooks-ingester` boilerplate types `data.tags?: WebhookTag[]` (array). Third-party blog snippets show `tags` as flat dict `{key: value}`. Resend's own webhook event-types docs page does NOT document the `data` schema. The fixture for `email.delivered` in the official boilerplate does NOT include `tags` at all — even when sent.

**Resolution:** Plan 5 mandatory empirical step — send a real email with `tags`, capture the webhook payload, document the actual shape in `.planning/phase-16/resend-tag-roundtrip-evidence.md`. Implement BOTH paths (read array, fall back to dict, fall back to mapping table). The mapping table is the load-bearing safety net — write it on every send, regardless of tag-shape outcome.

**Sources:** [resend/resend-webhooks-ingester](https://github.com/resend/resend-webhooks-ingester), [Resend webhook event types](https://resend.com/docs/dashboard/webhooks/event-types), [Svix blog Resend webhooks example](https://www.svix.com/blog/using-resend-webhooks-for-email-status-alerts/).

### Pitfall B: Next.js 16 SSE differs from training data

**Training-data drift:** Pre-2026 content recommends `runtime: "edge"` for streaming endpoints and references `next/server` SSE helpers. Neither is current.

**Resolution:** Use `runtime: "nodejs"` (or omit — Fluid Compute is default). Hand-roll `ReadableStream` per Next.js 16 official docs example (`route.md` L401-481, verified in local `node_modules/next/dist/docs/`). Set `X-Accel-Buffering: no` for proxy passthrough.

**Sources:** Local file `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (lines 401-481); Vercel knowledge-update injection 2026-02-27 (Edge functions deprecated for new code).

### Pitfall C: RLS context drift across Railway → Supabase boundary

**The drift:** Postgres `auth.uid()` returns NULL when the calling JWT is service-role (used by the Railway worker). Migrations 084/085 already use `NEW.user_id` and `p_user_id` (NOT `auth.uid()`) — but no test currently proves this empirically under service-role context. A future migration could regress quietly.

**Resolution:** Plan 4 ships `analytics-service/tests/test_trigger_rls_audit.py` with pytest+psycopg fixtures that connect using the service-role JWT, perform INSERT and RPC calls, and assert correct stamping. Test runs as part of the standard pytest suite, so any future regression fails the merge gate. Deliverable doc `.planning/phase-16/trigger-rls-audit.md` enumerates each migration + the corresponding test + the assertion under service-role context.

**Sources:** Verified in repo at `supabase/migrations/084_first_api_key_added_trigger.sql` (lines 46-101) and `supabase/migrations/085_stamp_first_bridge_surfaced.sql` (lines 58-118); existing service-role RPC pattern at `src/lib/audit.ts:11-50`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | sentry-sdk 2.58.0, structlog 25.5.0, vcrpy 8.1.1 are still current on PyPI as of 2026-05-01 | Standard Stack — Core | Pin would be stale; planner should run `pip index versions <pkg>` and update CONTEXT.md if drift > 1 minor version. Low risk — versions came from CONTEXT.md decisions table dated yesterday. |
| A2 | Supabase CLI is available locally (no explicit CLI dep in package.json) | Environment Availability | Plan 4 trigger-audit tests assume the operator can run migrations against the test Supabase project. If CLI is absent, founder installs `supabase` CLI manually before Plan 4 ships. |
| A3 | Sentry DSN env-var is already set in both Vercel and Railway production environments | Environment Availability | Without DSN, Sentry init silently no-ops (existing guard). OBSERV-04 + OBSERV-05 acceptance requires Sentry events visible in dashboard — if DSN is unset, plans degrade to no-op and acceptance fails. |
| A4 | PostHog `wizard_start` event has been firing throughout the trailing 30-day window | Phase Requirements (OBSERV-11) | If event was added recently or is misnamed, the audit returns 0 — which IS the documented zero-mobile signal per DESIGN-04. Plan 9 documents the result as observed regardless. Low risk. |
| A5 | The 8 unknown remote migration timestamps (DISCO-05) won't introduce a column rename that breaks the trigger-audit assertions | Pitfall C / Plan 4 | Migration drift resolution Path C (`.planning/phase-16/migration-drift-resolution.md`) defers reconciliation to v1.0.0 ship. Plan 4 tests against the LOCAL migration set — production remote may differ. Plan 4 acceptance includes "tests pass against test Supabase project" not "tests pass against production". Low risk for the audit, high risk for actual fix in Phase 18 — flag for Day-2 decision. |
| A6 | `INTERNAL_API_TOKEN` env-var is the same value in Vercel and Railway production | Plan 7 SSE endpoint | If they drift, Plan 7's fetch from Next.js → Railway internal endpoint returns 401 silently. Plan 7 startup script asserts both sides match (compare hash). |
| A7 | Resend tag values may contain `:` or `-` (UUID format) without API rejection | Pitfall A / Plan 5 | Resend docs say tags are limited to "ASCII letters (a–z, A–Z), numbers (0–9), underscores (_), or dashes (-)". UUIDs use `-` only — safe. But check `name` field constraint too — `correlation_id` is fine. |

**These assumptions need user confirmation:** A1, A2, A3 should be verified by the operator before execution. A5 is the highest-risk assumption — flag for Day-2 decision document explicitly.

## Open Questions

1. **Should the `resend_message_correlation` mapping table ship as a new migration in Phase 16, or does Plan 5 hold it back until empirical Path A succeeds?**
   - What we know: Path C migration policy says LOCAL-ONLY until v1.0.0 ship. Even a new migration here is fine.
   - What's unclear: Whether the table is needed at all (Path A may work fine).
   - Recommendation: Ship the migration + writer code unconditionally — the cost is one INSERT per email send (~0ms in practice). This is the load-bearing safety net per Pitfall 17. Read-time logic prefers `tags` and falls back to the table.

2. **Should `/api/debug-key-flow` SSE accept a `broker` parameter, or run all three brokers in one stream?**
   - What we know: CONTEXT.md says "Path 1 + Path 2 + sync sequentially against test credentials" — singular.
   - What's unclear: One-broker-per-call vs. all-three-per-call.
   - Recommendation: One-broker-per-call (admin picks broker via request body `{broker: "okx"|"binance"|"bybit"}`). Three sequential calls give the admin clearer per-broker observability and respects the 5/hour rate limit (one diagnostic session = up to 3 invocations).

3. **Where should `correlationId.ts` live — `src/lib/` or `src/lib/observability/`?**
   - What we know: `src/lib/observability.ts` exists (per OBSERV-12 restore). It's a 28-LOC file.
   - What's unclear: Whether to expand `observability.ts` or create a sibling.
   - Recommendation: Add the helper to `observability.ts` if shape fits; otherwise create `src/lib/correlation-id.ts` (kebab-case matches `pii-scrub.ts` precedent). Defer to existing `observability.ts` content review.

4. **Do we need a separate `RESEND_WEBHOOK_PATH_TOKEN` (URL-path secret) in addition to `RESEND_WEBHOOK_SECRET` (HMAC)?**
   - What we know: HMAC alone is the standard pattern.
   - What's unclear: Some teams use URL-path tokens as defense-in-depth.
   - Recommendation: HMAC alone is sufficient. The URL `/api/webhooks/resend` is fine; signature verification is the security boundary.

## Project Constraints (from CLAUDE.md)

Extracted from `./CLAUDE.md` and `./AGENTS.md` — Phase 16 plans MUST honor these:

- **Banned packages:** `axios` (use native `fetch()` or `undici`), `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai`. Phase 16 introduces no new TS deps so this is not a direct constraint, but `check-banned-packages.mjs` (existing CI) still enforces it.
- **Next.js 16 is breaking-change territory.** AGENTS.md explicitly says: *"This is NOT the Next.js you know"* and directs to `node_modules/next/dist/docs/` for canonical guidance. Plan 7 SSE pattern was verified against the local docs (`route.md` L401-481), not training data.
- **Plan mode by default for non-trivial work.** Phase 16 has 10 plans → full plan mode (already engaged via `/gsd-plan-phase`).
- **Subagent strategy.** Plans should keep main thread context clean — research already in this RESEARCH.md, so planner can reference instead of re-deriving.
- **Verification before completion.** Every plan must demonstrate working in actual environment — not just tests passing. Plan 7 in particular must show the SSE endpoint works in a Vercel preview, not just `vercel dev`.
- **Sequential fix-then-scan (lessons MEMORY).** Don't batch concerns across passes — fully fix one plan's review feedback before starting the next plan's review.
- **Always feature-branch + PR (lessons MEMORY).** Phase 16 work continues on `v1.0.0-api-key-rewrite-15-16` (already the active branch).
- **Write missing tests immediately (lessons MEMORY).** When a plan-checker or code-review catches a test gap, write the test on the spot. Don't defer.
- **Test coverage floor:** TS suite uses `@vitest/coverage-v8` with 60% line/function/branch/statement minimum (config: `vitest.config.ts`). Python suite enforces `--cov-fail-under=80`. Phase 16 new files must not regress these.
- **Design system: Always read DESIGN.md before any visual decisions.** WizardErrorEnvelope visual treatment (DM Sans + Geist Mono + 1px borders + 8px radius) MUST come from DESIGN.md. Per CONTEXT.md, Phase 16 ships the WIRING; Phase 17 locks the design contract — Plan 6 references the existing design tokens and the Phase 17 contract is forward-compatible.

## Sources

### Primary (HIGH confidence — Context7 / official docs / repo grep)

- **Context7 `kevin1024/vcrpy`** — `filter_headers`, `before_record_response`, `before_record_request` callback API; pytest integration patterns
- **Context7 `getsentry/sentry-python`** — FastAPI integration, `before_send` hook, `set_tag()` per-request scope
- **Context7 `hynek/structlog`** — `contextvars.bind_contextvars` / `merge_contextvars`, `JSONRenderer` processor, configure-once pattern
- Local `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (L401-481) — canonical `ReadableStream` SSE pattern for Next.js 16
- Local `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` — Route Handler conventions, runtime selection
- Repo `src/lib/wizardErrors.ts` — confirmed `WizardErrorCopy` shape mapping (title → human_message; fix[] → debug_context)
- Repo `src/lib/analytics-client.ts` (line 66) — confirmed correlation_id seam location
- Repo `src/instrumentation.ts` — confirmed existing Sentry framework hook
- Repo `src/lib/api/withAdminAuth.ts` — confirmed admin gate helper
- Repo `src/lib/audit.ts` (L11-120) — confirmed `log_audit_event_service` RPC pattern (audit table reuse)
- Repo `analytics-service/main.py` (L29-40) — confirmed existing Sentry init that needs upgrade
- Repo `supabase/migrations/084_first_api_key_added_trigger.sql` (L46-101) — confirmed `NEW.user_id` (not `auth.uid()`) pattern
- Repo `supabase/migrations/085_stamp_first_bridge_surfaced.sql` (L58-118) — confirmed `p_user_id` argument pattern
- Repo `.planning/phase-16/migration-drift-resolution.md` — Path C decision; "no new migrations expected"
- Repo `.planning/phase-16/vault-from-railway-preflight.md` — KEK env-var (NOT Vault) is the architecture reality
- Repo `package.json` — Next.js 16.2.3, @sentry/nextjs 10.48.0, resend 6.10.0, posthog versions
- Vercel knowledge-update injection (2026-02-27) — Edge runtime deprecated for new code; Fluid Compute is default; Node.js 24 LTS is current default; Vercel Functions support graceful shutdown + request cancellation

### Secondary (MEDIUM confidence — WebSearch + WebFetch verified against multiple sources)

- [Resend send-email API reference](https://resend.com/docs/api-reference/emails/send-email) — `tags: [{name, value}]` send shape; ASCII a-z A-Z 0-9 _ - constraint; 256-char max
- [resend/resend-webhooks-ingester GitHub](https://github.com/resend/resend-webhooks-ingester) (`src/types/webhook.ts` + `tests/helpers/fixtures.ts`) — `WebhookTag = {name, value}`, `data.tags?: WebhookTag[]` (optional, array shape)
- [Svix Resend webhooks example blog](https://www.svix.com/blog/using-resend-webhooks-for-email-status-alerts/) — example payloads
- [Inngest Resend webhook events guide](https://www.inngest.com/docs/guides/resend-webhook-events) — event-type list

### Tertiary (LOW confidence — single-source third-party blog; flagged for Plan 5 empirical verification)

- WebSearch result claiming `tags: { "category": "..." }` flat-dict shape in webhook payload — contradicts the official boilerplate types. Plan 5 MUST verify empirically before deciding which shape to read.

## Metadata

**Confidence breakdown:**
- Standard stack pins (sentry-sdk, structlog, vcrpy versions): MEDIUM — locked in CONTEXT.md by user, not re-verified against PyPI today (Assumption A1).
- Architecture (correlation_id flow, SSE pattern, middleware shape): HIGH — verified against local Next.js docs + Context7 library docs + repo grep.
- Pitfalls: HIGH — three core pitfalls (Resend ambiguity, Next.js 16 SSE drift, RLS drift) are sourced from multiple verified channels.
- Resend webhook tag shape: MEDIUM — primary source (official boilerplate types) + contradicting blog evidence; empirical verification required in Plan 5.
- Trigger audit pattern (pytest+psycopg vs pgTAP): HIGH — verified against existing 1,695-test pytest suite + zero pgTAP fixtures in repo.
- Reuse of existing audit_log table: HIGH — `log_audit_event_service` RPC + `entity_id` UUID column shape grep-verified.

**Research date:** 2026-05-01
**Valid until:** 2026-05-31 (Resend webhook payload shape may evolve — Plan 5 empirical step is the authoritative source after that date; Next.js 16 minor version may bump — re-check `node_modules/next/dist/docs/` if Next.js minor changes during execution)

## RESEARCH COMPLETE
