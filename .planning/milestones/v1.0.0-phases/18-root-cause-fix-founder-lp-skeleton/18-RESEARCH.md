# Phase 18: Root-Cause Fix + Founder LP Skeleton — Research

**Researched:** 2026-05-06
**Domain:** Python PII redaction (mirror), Vercel cron + Resend PDF dogfood loop, traceability/docs maintenance
**Confidence:** HIGH

## Summary

Phase 18 has been narrowed dramatically by what already shipped in PRs #116–#122. The wizard root-cause fix (bridge race + missing `compute_analytics` chain link + validate-key swallow sites) and the Bug #1 forensic patch (correlation_id threaded into `compute_jobs.metadata` at `keys/sync` + `intro` + `compute_intro_snapshot` enqueue callsites) are already on `main`. CONTEXT.md reframes them as record-only traceability. What remains is mechanical: (1) a Python `redact.py` that mirrors the canonical TS `pii-scrub.ts` byte-for-byte at the API layer, wired into 3 boundaries; (2) a `/api/cron/founder-lp-report` cron that reuses the existing factsheet PDF endpoint and emails the founder via Resend with a Sentry+Resend dual-alert failure path; (3) four small artefact files under `.planning/phase-18/`; (4) a single ROADMAP/STATE/REQUIREMENTS doc edit pushing BACKBONE-06/-07 to Phase 19.

Every required pattern already exists in `main`: cron handler shape (cleanup-ack-tokens / sync-funding / reconcile-strategies), Resend `tags` + `correlation_id` round-trip via `src/lib/email.ts`, Sentry `before_send` PII walker in `analytics-service/sentry_init.py`, structlog processor pipeline in `services/logging_config.py`, and the TS↔file-text drift-test pattern in `tests/a11y/chart-contrast.test.ts`. Phase 18 is reuse, not invention.

**Primary recommendation:** Treat Phase 18 as four small plans (traceability + 10-team tracker, redact.py mirror, founder LP cron, doc-update + dogfood stub). Match every existing pattern exactly — none of these problems require new architecture. The single non-obvious element is the test-only Vercel cron-quota guard (`src/__tests__/vercel-cron-limits.test.ts`), which currently caps at 10 crons and requires numeric minute+hour — `0 9 1 * *` passes both checks (numeric minute=0, hour=9; we add the 7th cron to a soft cap of 10).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase 18 Plan Scope & In-Flight Reconciliation**

- PR #116 wizard root-cause fix (commit `3932842`) — record-only as Phase 18 traceability; NO re-plan. Regression artefact: `analytics-service/tests/test_job_worker.py:553 TestSyncTradesEnqueuesComputeAnalytics` + migration `099_mark_compute_job_atomic_status_bridge.sql` self-verifying invariant DO-block.
- Bug #1 forensic patch (commits `a48a92e` + `1960f54`) — verified at `src/app/api/keys/sync/route.ts:94`, `src/app/api/intro/route.ts:220`, plus follow-up `compute_intro_snapshot` thread in `src/app/api/intro/route.test.ts:265-291` ("Phase 18 Bug #1 follow-up"). NO re-plan.
- Bybit broker quirks (PRs #117–#120) — record-only traceability.
- BACKBONE-06 + BACKBONE-07 — pushed to **Phase 19** (Day-2 doc Section 5 wording superseded by CONTEXT.md decision).
- Phase 19 entry-prep artifacts (`route-inventory.md`, `migration-plan.md`) — Phase 19 day-0, NOT Phase 18.

**`redact.py` Mirror (FIX-04)**

- Module path: `analytics-service/services/redact.py` (REQ FIX-04 verbatim).
- API surface (snake_case mirror of TS exports): `scrub_pii(value: Any) -> Any`, `truncate_account_id(s: str) -> str`, `scrub_freeform_string(s: str) -> str`.
- Denylist: 8 keys (REQ FIX-04 verbatim) + TS additions (`api_key`, `api_secret`, `x-mbx-apikey`, `ok-access-sign`, `x-internal-token`). Prefix denylist: `sb-ec-`. Case-insensitive key match.
- JWT detector: anchored `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` (whole-string), substring `[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` (embedded).
- Sensitive `key:value` detector mirrors TS `SENSITIVE_KEY_VALUE` verbatim with `re.IGNORECASE`.
- Wire-up boundaries (3): Sentry `before_send` (replaces `_redact_before_send` placeholder per OBSERV-05), structlog processor in `services/logging_config.py`, audit-log writer in `services/audit.py`.
- Shared fixture corpus: `tests/fixtures/redact-corpus.json` (repo root). Loaded by both Vitest and pytest. Single source of truth.
- Drift-prevention test: `tests/lib/admin/pii-scrub-python-parity.test.ts` (Vitest) reads `analytics-service/services/redact.py` text via `fs.readFileSync` and asserts each TS denylist key appears verbatim. Same pattern as `tests/a11y/chart-contrast.test.ts` and the DESIGN-01 token-consistency test.
- Grep gate: Phase 18 exit — grep over Supabase log table after smoke run shows zero credential-shaped strings (REQ FIX-04 verbatim).

**Founder LP Cron (LP-01 / LP-02)**

- Cron route path: `/api/cron/founder-lp-report`.
- Schedule: `0 9 1 * *` (1st of month, 09:00 UTC). Registered in `vercel.json` `crons` array (NOT `vercel.ts` — repo currently uses `vercel.json`).
- Strategy ID source: `FOUNDER_LP_STRATEGY_ID` Vercel env var. No DB schema add.
- PDF generation: reuse `/api/factsheet/[id]/pdf` endpoint as-is (REQ LP-01 verbatim). Cron handler does an internal fetch with the founder strategy ID and forwards the bytes.
- Delivery: Resend email to founder (recipient = `FOUNDER_LP_REPORT_TO` env var; fallback to founder email).
- Failure handling — both alerts (silent failure prohibited per LP-02): Sentry capture with `tag: cron-failure` + `correlation_id`; Resend alert email to founder on any catch path.
- Auth: standard Vercel cron header check (`Authorization: Bearer ${CRON_SECRET}`).
- Test strategy: unit test mocks `fetch` for `/api/factsheet/[id]/pdf` + Resend client.

**Entry-Gate Files + Commitments**

- `metaworld-commitment.md`: SATISFIED 2026-05-06.
- `dogfood-commitment.md` (LP-03): Phase 18 final plan ships an empty stub file with a TODO for the founder to fill at /ship time. Claude does NOT author the verbal-in-writing commitment text.
- `team-status.md` (FIX-03): one row per onboarding team (team_name, source, wizard_run_correlation_id, status, notes). Linked from TODOS.md.
- `founder-okx-smoke.md` (FIX-02): captures `correlation_id`, `strategies.id`, `encrypted_key` decrypt round-trip evidence (NOT plaintext key — assertion + redacted ciphertext fingerprint), production-equivalent run timestamp.

### Claude's Discretion

- Exact slicing of plans across the 5 in-scope deliverables. Likely 4 plans:
  1. Traceability + FIX-02 founder OKX smoke + FIX-03 team-status tracker (small).
  2. FIX-04 `redact.py` mirror — Python module, wire-up at 3 boundaries, fixture corpus, parity test.
  3. LP-01/02 founder LP cron — route handler, env vars, vercel.json registration, Sentry + Resend wiring, tests.
  4. LP-03 dogfood-commitment.md stub + ROADMAP/STATE/REQUIREMENTS update reflecting BACKBONE-06/-07 push to Phase 19.
- Test file locations within established patterns (e.g., `analytics-service/tests/test_redact.py`, `src/app/api/cron/founder-lp-report/route.test.ts`).
- Whether the cron handler returns a structured response on success — recommended yes, with `correlation_id` + `pdf_bytes_emitted`.
- Resend template id (or inline HTML) and email body copy — defaults to a minimal `Founder LP report — {month}` subject + PDF attachment + correlation_id in body.
- Exact REQUIREMENTS.md / ROADMAP.md / STATE.md edits to push BACKBONE-06/-07 from Phase 18 to Phase 19.

### Deferred Ideas (OUT OF SCOPE)

- `src/lib/redact.ts` — anti-feature. Phase 18 ships ONLY the Python mirror.
- BACKBONE-06 + BACKBONE-07 — moved to Phase 19.
- Phase 19 entry-prep artifacts (`route-inventory.md` + `migration-plan.md`) — Phase 19 day-0.
- `vercel.ts` migration — repo currently uses `vercel.json`; out of scope for v1.0.0.
- Branded LP report design (Eltican Positron Dashboard reference) — v2 per UC-F.
- Multi-strategy bundle editor for fund-level LP report — v2 per LP-BRANDED-02.
- PDF storage in Supabase Blob / Vercel Blob — not needed for v1; Resend email is the dogfood-loop closure.
- Hypothesis #13 + #14 fixes (debug_key_flow placeholders) — already shipped via PRs #121 + #122.
- Bybit broker-quality SLA pattern — out of scope for v1.0.0.
- PostHog mobile fallback build — Phase 17 deferral remains (OBSERV-11 N=0).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FIX-01 | Root-cause fix at the source layer + regression test that fails without the fix | SATISFIED IN-FLIGHT via PR #116 (commit `3932842`) + `analytics-service/tests/test_job_worker.py:553 TestSyncTradesEnqueuesComputeAnalytics` + migration 099 DO-block. Phase 18 records this as traceability only — see "Traceability" plan. |
| FIX-02 | Founder's OKX test key passes wizard end-to-end in production-equivalent env | Plan-phase verifies live; commits evidence to `.planning/phase-18/founder-okx-smoke.md` (correlation_id + strategy id + redacted ciphertext fingerprint, NEVER plaintext). |
| FIX-03 | All 10 onboarding teams reach `published`/`validated` | Plan ships `.planning/phase-18/team-status.md` markdown table (team_name, source, correlation_id, status, notes); linked from TODOS.md; populated initial pass. |
| FIX-04 | Python `redact.py` mirror of `pii-scrub.ts` + 3 wire-up boundaries + 20-bad/5-good shared fixture + grep gate | `src/lib/admin/pii-scrub.ts` is canonical (162 LOC); `analytics-service/sentry_init.py` already has the denylist surface (matches OBSERV-05 placeholder); structlog config in `services/logging_config.py` ready for new processor; audit writer in `services/audit.py` ready for `scrub_pii` invocation. |
| LP-01 | Founder LP report cron emits monthly PDF via existing factsheet endpoint | Reuse `/api/factsheet/[id]/pdf` as-is. Strategy id from `FOUNDER_LP_STRATEGY_ID`. Schedule `0 9 1 * *` in `vercel.json`. Pattern matches `cleanup-ack-tokens` + `sync-funding` + `reconcile-strategies`. |
| LP-02 | Cron-failure surfaces alert (Sentry + Resend dual-alert; silent failure prohibited) | Sentry: lazy `import("@sentry/nextjs")` + `captureException` with `tag: cron-failure` + `correlation_id` (matches `src/app/error.tsx:25-35` pattern). Resend: dedicated alert email path that does NOT depend on the success path having run. |
| LP-03 | Phase 18 exit captures founder verbal-in-writing 14-day-LP commitment | Plan ships empty stub `.planning/phase-18/dogfood-commitment.md` with frontmatter `gate: phase-18-exit-dogfood-commitment`, `status: PENDING`, and a TODO line for the founder to paste at /ship time. Claude does NOT author the commitment text. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Python PII redaction (recursive walker, denylist, JWT detector) | API/Backend (Python analytics-service) | — | All 3 wire-up boundaries (Sentry `before_send`, structlog processor, audit writer) live in the Python service; `redact.py` is pure stdlib. |
| Sentry `before_send` redaction wiring | API/Backend (analytics-service) | — | `analytics-service/sentry_init.py` is the canonical Sentry init for FastAPI; OBSERV-05 placeholder lives there. |
| Structlog processor wiring | API/Backend (analytics-service) | — | `analytics-service/services/logging_config.py` configures structlog once at startup. |
| Audit-log writer redaction | API/Backend (analytics-service) | — | `analytics-service/services/audit.py` is the only Python writer to `audit_log` (via `log_audit_event_service` RPC). |
| Founder LP cron (route handler) | Frontend Server (Next.js Route Handler) | API/Backend (existing factsheet endpoint) | Vercel Cron dispatches GET to `/api/cron/founder-lp-report`; that handler internally fetches `/api/factsheet/[id]/pdf` (existing route) and forwards bytes via Resend. |
| LP cron failure-alert dual-path | Frontend Server (Next.js) | External (Sentry + Resend) | Cron handler catches its own exceptions and dispatches Sentry+Resend; both paths run server-side in the cron lambda. |
| TS↔Python denylist parity test | Test-tier (Vitest) | API/Backend (reads Python source as text) | Mirrors `tests/a11y/chart-contrast.test.ts` pattern: TS test reads sibling file via `fs.readFileSync` and asserts content invariants. No AST parsing, no Python execution. |
| Phase 18 traceability + 10-team + smoke + dogfood stub artefacts | Docs/planning | — | All 4 files live under `.planning/phase-18/` with the same frontmatter convention as `metaworld-commitment.md`. |
| ROADMAP/STATE/REQUIREMENTS edits | Docs/planning | — | Pure docs update; pushes BACKBONE-06/-07 from Phase 18 to Phase 19. |

## Project Constraints (from CLAUDE.md / AGENTS.md)

Authority equal to locked CONTEXT.md decisions:

- **Next.js 16 forks training data.** AGENTS.md: read `node_modules/next/dist/docs/` before writing Next-specific code. Honour deprecation notices. Middleware was renamed to `proxy`. Async `params` / `cookies()` / `headers()` are required.
- **Banned packages** (enforced by `src/__tests__/check-banned-packages.test.ts` + `scripts/check-banned-packages.mjs`): `axios`, `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai`. The LP cron uses native `fetch()` (Node 24 LTS on Vercel) — never `axios`.
- **DESIGN.md authority.** Visual / UI changes require DESIGN.md alignment. The LP cron has zero visual surface; Resend email body copy is plain text + minimal HTML; the existing factsheet endpoint is reused as-is so no design surface changes.
- **Test coverage.** Python `--cov-fail-under=80` (analytics-service). Vitest 60% floor / 80% target via `@vitest/coverage-v8`. New `redact.py` must come with full test coverage; new cron handler must come with route.test.ts.
- **No new mutation route without `logAuditEvent` (or `@audit-skip:` pragma).** `src/__tests__/audit-coverage.test.ts` enforces. The LP cron doesn't write user data — `@audit-skip: cron-triggered LP report dispatch, no user attribution` pragma applies.
- **`server-only` import** required on any module touching `createAdminClient` / `next/headers`. The cron handler imports `getCorrelationId` (already `server-only`) — no new annotation needed because route handlers are inherently server-side.
- **Bracketed log prefixes.** Every `console.error` / `console.warn` MUST start with `[<module-tag>]`, e.g. `[cron/founder-lp-report]`. Matches existing `[cron/sync-funding]`, `[cron/reconcile-strategies]`, `[email]`.
- **Cron quota guardrail.** `src/__tests__/vercel-cron-limits.test.ts` caps `vercel.json.crons` at 10 entries (currently 6) and requires numeric minute+hour — `0 9 1 * *` passes both. Test will run on the PR; passing is mandatory.
- **No git branch ops in research.** Research output is RESEARCH.md only; no source-code mutations.

## Standard Stack

### Core (already installed in repo — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `resend` | ^6.10.0 | Resend email client (LP success email + LP failure-alert email) | Already wired at `src/lib/email.ts`; supports `attachments[]` with `content` as Buffer or base64. `[VERIFIED: package.json]` |
| `@sentry/nextjs` | ^10.48.0 | Sentry capture for cron failures (`tag: cron-failure`) | Already wired in `src/instrumentation.ts` + `src/app/error.tsx` + `src/app/global-error.tsx`. Lazy `import("@sentry/nextjs")` keeps it out of static bundle. `[VERIFIED: codebase grep]` |
| Native `fetch()` | Node 24 LTS | Internal call from cron handler to `/api/factsheet/[id]/pdf` | Banned-packages list rejects `axios`; native `fetch` is the canonical pattern. `[VERIFIED: CLAUDE.md ban list]` |
| `@/lib/correlation-id` | repo-local | `getCorrelationId()` → cron tick gets fresh UUID v4 (no inbound header) | Sync-funding + reconcile-strategies use this exact fallback pattern. `[VERIFIED: src/lib/correlation-id.ts]` |
| `@/lib/timing-safe-compare` | repo-local | `safeCompare()` for `Authorization: Bearer ${CRON_SECRET}` check | Universal cron auth pattern in this repo. `[VERIFIED: existing crons]` |
| `@/lib/supabase/admin` | repo-local | `createAdminClient()` for any DB lookup the cron needs | Cron handlers always use admin client. `[VERIFIED: existing crons]` |

### Python supporting (analytics-service — pure stdlib for `redact.py`)

| Module | Version | Purpose | Why Standard |
|--------|---------|---------|--------------|
| `re` (stdlib) | py3.12+ | JWT shape regex + sensitive-key-value regex + denylist matching | Same approach as `sentry_init.py:79-81` placeholder. Zero runtime deps. `[VERIFIED: sentry_init.py]` |
| `typing` (stdlib) | py3.12+ | Type hints (`Any`, `Mapping`) | Convention in every `services/*.py`. `[VERIFIED: CONVENTIONS.md L17-18]` |
| `from __future__ import annotations` | py3.12+ | Required by repo convention at top of file | `[VERIFIED: CONVENTIONS.md L18]` |
| `structlog` | ==25.5.0 | Already initialized; `redact.py` registers as a NEW processor | Wired at `services/logging_config.py:40-50`. `[VERIFIED: requirements.txt + logging_config.py]` |
| `sentry_sdk[fastapi]` | ==2.58.0 | Already initialized at `sentry_init.py:194`; redact.py replaces the `_redact_before_send` body | `[VERIFIED: sentry_init.py]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `fetch()` for internal PDF call | `puppeteer-core` direct invocation in cron | Anti-pattern — bypasses the existing route's auth/rate-limit/error handling. CONTEXT.md locks "reuse `/api/factsheet/[id]/pdf` endpoint as-is". |
| Resend `attachments` | Upload to Vercel Blob, email link | Deferred per CONTEXT.md ("PDF storage in Supabase Blob / Vercel Blob — not needed for v1"). |
| `vercel.ts` cron config | `vercel.json` `crons` array | Locked by CONTEXT.md: repo uses `vercel.json`; `vercel.ts` migration is out of scope. |
| Python `pydantic` model for redact corpus | Plain JSON file | Plain JSON keeps the corpus runtime-agnostic — both Vitest and pytest can read it. CONTEXT.md locks shared `tests/fixtures/redact-corpus.json`. |
| `polished` / `lodash.set` for nested key access | Hand-roll recursive walker | TS pii-scrub.ts already hand-rolls; mirror approach in Python for parity + zero deps. |

**Installation:** No new packages required. Confirm Resend SDK supports `attachments[].content: Buffer | string` (verified — see Sources). `[CITED: resend.com/docs/api-reference/emails/send-email]`

**Version verification (run before plan locks):**
```bash
cat package.json | grep -E "\"resend\"|\"@sentry/nextjs\""
cat analytics-service/requirements.txt | grep -E "structlog|sentry-sdk"
```

## Architecture Patterns

### System Architecture Diagram

```
                    ┌────────────────────────────────────────────────┐
                    │         Vercel Cron Scheduler                  │
                    │  schedule: "0 9 1 * *"  (1st of month, 09:00) │
                    └─────────────┬──────────────────────────────────┘
                                  │ GET /api/cron/founder-lp-report
                                  │ Authorization: Bearer ${CRON_SECRET}
                                  ▼
              ┌───────────────────────────────────────────────────────┐
              │  src/app/api/cron/founder-lp-report/route.ts          │
              │  1. safeCompare(auth, expected)         → 401 on fail │
              │  2. correlation_id = await getCorrelationId()         │
              │  3. strategy_id = process.env.FOUNDER_LP_STRATEGY_ID  │
              │     → 5xx if missing                                  │
              │  4. internal fetch /api/factsheet/[id]/pdf  ── try ─┐ │
              │     - forward CRON_SECRET / cookie? NO; rate-limit  │ │
              │       allows public IP                              │ │
              │     - response is application/pdf bytes             │ │
              │     - read into Buffer                              │ │
              └─────────────────┬─────────────────────────┴─────────┴─┘
                                │ success                            │ catch
                                ▼                                    ▼
              ┌──────────────────────────────────┐    ┌───────────────────────────┐
              │  Resend success email             │    │ Sentry.captureException   │
              │  to: FOUNDER_LP_REPORT_TO         │    │   tag cron-failure        │
              │  subject: Founder LP report — Oct │    │   tag correlation_id      │
              │  attachments: [{filename, content}]│    │ + Resend FAILURE email    │
              │  tags: [{correlation_id}, {kind}] │    │   to: FOUNDER_LP_REPORT_TO│
              └─────────────┬─────────────────────┘    │   subject: LP cron FAILED │
                            │                          │   body: error_class +     │
                            ▼                          │         message +         │
              ┌──────────────────────────────────┐    │         correlation_id    │
              │  200 OK { ok, correlation_id,    │    └─────────┬─────────────────┘
              │           strategy_id, pdf_bytes } │              │
              └──────────────────────────────────┘                ▼
                                                       ┌───────────────────────────┐
                                                       │  500 { ok:false, ... }   │
                                                       └───────────────────────────┘

   ─────────────────────────────────────────────────────────────────────────────────

                                FastAPI / analytics-service redact.py

      ┌──────────────────────────────────────────────────────────────────────┐
      │  Inbound request → CorrelationMiddleware → uvicorn → router          │
      └─────────────┬────────────────────────────────────────────────────────┘
                    │
                    ├──→ Exception path
                    │     │
                    │     ▼  Sentry SDK → before_send hook
                    │        scrub_pii(event[req][headers/cookies/data/json])
                    │        scrub_pii(event[breadcrumbs][*][data])
                    │        scrub_pii(event[exception][*][stacktrace][*][vars])
                    │        scrub_pii(event[extra/contexts])
                    │
                    ├──→ Logging path
                    │     │
                    │     ▼  structlog processor pipeline
                    │        merge_contextvars → add_log_level → TimeStamper →
                    │        redact_processor (NEW: walks event_dict thru scrub_pii) →
                    │        dict_tracebacks → JSONRenderer
                    │
                    └──→ Audit path
                          │
                          ▼  log_audit_event(metadata=...)
                             metadata = scrub_pii(metadata)  (NEW)
                             RPC log_audit_event_service(p_metadata=...)
```

### Recommended Project Structure

New files (relative to repo root):

```
.planning/phase-18/
├── metaworld-commitment.md       # already exists — SATISFIED
├── dogfood-commitment.md         # NEW (LP-03 stub; founder fills at /ship)
├── team-status.md                # NEW (FIX-03 — 10-team tracker)
└── founder-okx-smoke.md          # NEW (FIX-02 evidence)

analytics-service/
├── services/
│   └── redact.py                 # NEW (FIX-04 — Python mirror of pii-scrub.ts)
└── tests/
    └── test_redact.py            # NEW (pytest — exercises shared corpus)

src/app/api/cron/founder-lp-report/
├── route.ts                      # NEW (LP-01/02 cron handler)
└── route.test.ts                 # NEW (Vitest — happy + Sentry + Resend dual-alert)

tests/
├── fixtures/
│   └── redact-corpus.json        # NEW (20-bad / 5-good shared corpus)
└── lib/admin/
    └── pii-scrub-python-parity.test.ts  # NEW (Vitest — TS↔Python denylist parity)
```

Edited files:

```
analytics-service/sentry_init.py          # _redact_before_send body swapped to call redact.scrub_pii (replaces the inline _scrub walker)
analytics-service/services/logging_config.py  # add redact processor to structlog.configure(processors=[...])
analytics-service/services/audit.py        # wrap metadata payload through scrub_pii before RPC call
src/lib/admin/pii-scrub.test.ts           # extend or sibling-suite to load shared corpus (optional — see Plan 2 discretion)
vercel.json                                # add { "path": "/api/cron/founder-lp-report", "schedule": "0 9 1 * *" }
.env.example                               # document FOUNDER_LP_STRATEGY_ID + FOUNDER_LP_REPORT_TO
.planning/REQUIREMENTS.md                  # BACKBONE-06/-07 row updates (Phase 18 → Phase 19) + Phase 18 success criterion adjustments
.planning/STATE.md                         # any Phase 18 boundary references that mention BACKBONE-06/-07
.planning/ROADMAP.md                       # Phase 18 / Phase 19 BACKBONE-06/-07 attribution
TODOS.md                                   # link to .planning/phase-18/team-status.md
```

### Pattern 1: Cron handler (timing-safe auth + correlation_id thread + structured response)

**What:** Vercel cron route handler with `Authorization: Bearer` auth, `correlation_id` tag generation per tick, structured success/failure JSON.

**When to use:** Every new `/api/cron/*` route in this repo.

**Example (canonical — derived from `sync-funding/route.ts` + `cleanup-ack-tokens/route.ts`):**

```typescript
// Source: src/app/api/cron/sync-funding/route.ts (verified pattern)
import { NextRequest, NextResponse } from "next/server";
import { safeCompare } from "@/lib/timing-safe-compare";
import { getCorrelationId } from "@/lib/correlation-id";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const correlation_id = await getCorrelationId();
  // ... do work ...
  return NextResponse.json({ ok: true, correlation_id, /* ... */ });
}

export const GET = handle;
export const POST = handle;
```

`[VERIFIED: src/app/api/cron/sync-funding/route.ts]`

### Pattern 2: Sentry capture in non-route surface (lazy import)

**What:** Lazy `import("@sentry/nextjs")` keeps Sentry out of the static bundle and survives missing `SENTRY_DSN`.

**When to use:** Any catch path or error boundary outside `instrumentation.ts`.

**Example (canonical — from `src/app/error.tsx:23-37`):**

```typescript
// Source: src/app/error.tsx:23-37 (verified pattern)
import("@sentry/nextjs")
  .then((Sentry) => {
    Sentry.captureException(error, {
      tags: {
        "cron-failure": "founder-lp-report",
        correlation_id,
      },
      extra: {
        strategy_id,
        error_class: error?.name,
      },
    });
  })
  .catch(() => {
    // Sentry import failed — never block; the Resend alert still fires.
  });
```

`[VERIFIED: src/app/error.tsx]`

### Pattern 3: Resend send with attachment (success path) + dedicated failure-alert send (catch path)

**What:** Resend supports `attachments[]` with `content: Buffer | base64-string` + `filename`. The dual-alert pattern uses two separate `send` calls — one in the try (success) and one in the catch (failure), so one Resend outage doesn't suppress the other.

**Example (CITED from Resend docs + adapted to repo's email.ts conventions):**

```typescript
// Source: https://resend.com/docs/api-reference/emails/send-email
//        + adapted to src/lib/email.ts low-level send pattern
import { Resend } from "resend";
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

await resend?.emails.send({
  from: `${PLATFORM_NAME} <${PLATFORM_EMAIL}>`,
  to: process.env.FOUNDER_LP_REPORT_TO ?? process.env.ADMIN_EMAIL!,
  subject: `Founder LP report — ${monthLabel}`,
  html: `<p>Monthly LP factsheet attached.</p><p style="color:#666;font-size:12px;">correlation_id: ${correlation_id}</p>`,
  attachments: [{
    filename: `${strategy_name}-factsheet-${monthLabel}.pdf`,
    content: pdfBuffer,           // Buffer (preferred) — also accepts base64 string
    content_type: "application/pdf",
  }],
  tags: [
    { name: "correlation_id", value: correlation_id },
    { name: "kind", value: "founder_lp_report" },
  ],
});
```

`[CITED: resend.com/docs/api-reference/emails/send-email]`

**Note on `tags`:** the existing `src/lib/email.ts:206-209` already round-trips `correlation_id` via `tags`. The cron handler can either reuse the existing `send` low-level (and add `founder_lp_report` to the `NotificationType` union) OR call `resend.emails.send` directly (simpler — no need to widen the type union for one new caller). Discretion lives in CONTEXT.md.

### Pattern 4: Python recursive scrub walker (mirror of TS pii-scrub.ts)

**What:** Pure-stdlib recursive walker that mirrors the TS module exactly.

**When to use:** `analytics-service/services/redact.py` only. Zero runtime deps.

**Example (canonical — derived from `analytics-service/sentry_init.py:87-117` + `src/lib/admin/pii-scrub.ts`):**

```python
# Source: src/lib/admin/pii-scrub.ts + analytics-service/sentry_init.py
"""PII scrub mirror — mirrors src/lib/admin/pii-scrub.ts byte-for-byte at the API layer."""
from __future__ import annotations
import re
from typing import Any, Mapping

DENYLIST_EXACT: frozenset[str] = frozenset({
    "apikey", "apisecret", "api_key", "api_secret", "secret", "signature",
    "passphrase", "authorization", "x-mbx-apikey", "ok-access-sign",
    "x-internal-token",
})
DENYLIST_PREFIX: tuple[str, ...] = ("sb-ec-",)
JWT_SHAPE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
JWT_SUBSTRING = re.compile(r"[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")
SENSITIVE_KEY_VALUE = re.compile(
    r"\b((?:api[-_]?key|api[-_]?secret|x-mbx-apikey|ok-access-sign|secret|"
    r"passphrase|password|token|credential|cookie|session|authorization|bearer))"
    r"\s*[:=]+\s*['\"]?([^\s'\"]+)['\"]?",
    re.IGNORECASE,
)
REDACTED = "[REDACTED]"
REDACTED_JWT = "[REDACTED_JWT]"

def _is_denylisted_key(key: str) -> bool:
    if not isinstance(key, str): return False
    lower = key.lower()
    if lower in DENYLIST_EXACT: return True
    return any(lower.startswith(p) for p in DENYLIST_PREFIX)

def scrub_pii(value: Any) -> Any:
    if value is None: return value
    if isinstance(value, str):
        return REDACTED_JWT if JWT_SHAPE.match(value) else value
    if isinstance(value, (int, float, bool)): return value
    if isinstance(value, list): return [scrub_pii(v) for v in value]
    if isinstance(value, Mapping):
        return {k: REDACTED if _is_denylisted_key(k) else scrub_pii(v) for k, v in value.items()}
    return value

def truncate_account_id(s: str) -> str:
    if not isinstance(s, str): return s
    if len(s) < 8: return s
    return f"***{s[-4:]}"

def scrub_freeform_string(s: str) -> str:
    if not isinstance(s, str): return s
    pass1 = SENSITIVE_KEY_VALUE.sub(lambda m: f"{m.group(1)}: {REDACTED}", s)
    pass2 = scrub_pii(pass1) if isinstance(pass1, str) else pass1
    pass2_str = pass2 if isinstance(pass2, str) else str(pass2)
    return JWT_SUBSTRING.sub(REDACTED_JWT, pass2_str)
```

`[VERIFIED: src/lib/admin/pii-scrub.ts + sentry_init.py]`

### Pattern 5: TS↔file-text drift-prevention test (Vitest reads sibling Python file)

**What:** Vitest test reads `analytics-service/services/redact.py` text via `fs.readFileSync` and asserts every TS denylist key appears verbatim. No AST parsing, no Python execution.

**Example (canonical — from `tests/a11y/chart-contrast.test.ts:67-90`):**

```typescript
// Source: tests/a11y/chart-contrast.test.ts (verified pattern)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("redact.py mirrors pii-scrub.ts denylist verbatim", () => {
  const PY_FILE = resolve(process.cwd(), "analytics-service/services/redact.py");
  const TS_FILE = resolve(process.cwd(), "src/lib/admin/pii-scrub.ts");

  it("every TS DENYLIST_EXACT key appears in redact.py text", () => {
    const ts = readFileSync(TS_FILE, "utf8");
    const py = readFileSync(PY_FILE, "utf8");
    // Extract denylist keys from TS source between DENYLIST_EXACT braces.
    const match = ts.match(/DENYLIST_EXACT = new Set<string>\(\[([\s\S]*?)\]\)/);
    expect(match, "TS denylist block must be parseable").not.toBeNull();
    const keys = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(8);
    for (const key of keys) {
      expect(py, `redact.py must contain "${key}"`).toContain(`"${key}"`);
    }
  });

  it("DENYLIST_PREFIX (sb-ec-) appears in redact.py", () => {
    const py = readFileSync(PY_FILE, "utf8");
    expect(py).toContain("sb-ec-");
  });
});
```

`[VERIFIED: tests/a11y/chart-contrast.test.ts pattern]`

### Pattern 6: Shared 20-bad / 5-good fixture corpus (loaded by both runtimes)

**What:** Single JSON file at `tests/fixtures/redact-corpus.json` with shape `{"bad": [...20], "good": [...5]}`. Both Vitest and pytest load it.

**Shape:**

```json
{
  "bad": [
    {"name": "apiKey top-level", "input": {"apiKey": "abc123secret"}, "expectRedactedKeys": ["apiKey"]},
    {"name": "JWT bare", "input": "eyJhbG.eyJzdWI.SflKxw", "expectJwtRedacted": true},
    /* ... 18 more ... */
  ],
  "good": [
    {"name": "allocator name", "input": {"display_name": "Mary"}},
    {"name": "ISO timestamp", "input": {"created_at": "2026-05-06T12:00:00Z"}},
    /* ... 3 more ... */
  ]
}
```

**Pytest load (canonical):**

```python
# analytics-service/tests/test_redact.py
from pathlib import Path
import json

CORPUS = json.loads(
    (Path(__file__).resolve().parent.parent.parent / "tests" / "fixtures" / "redact-corpus.json").read_text()
)

class TestRedactCorpus:
    def test_redacts_all_20_bad_samples(self):
        from services.redact import scrub_pii
        for sample in CORPUS["bad"]:
            out = scrub_pii(sample["input"])
            # ... assertions per sample shape ...
```

`[VERIFIED: existing tests/fixtures/outcomes-kpi-parity.json shows this fixture-dir convention is repo-canonical]`

### Anti-Patterns to Avoid

- **Hand-rolling a parallel `src/lib/redact.ts`.** Anti-feature per CONTEXT.md + REQUIREMENTS.md ("`pii-scrub.ts` already exists with tested denylist; Phase 18 ships only the Python mirror").
- **Migrating `vercel.json` → `vercel.ts` as part of LP-01.** Out of scope. The cron MUST be added to `vercel.json` `crons` array.
- **Calling `puppeteer-core` directly from the cron handler.** Reuse `/api/factsheet/[id]/pdf` via internal `fetch`; modifying that route is forbidden.
- **Storing the founder's plaintext API key or KEK ciphertext in `founder-okx-smoke.md`.** Capture only `correlation_id`, `strategies.id`, and a redacted ciphertext fingerprint (e.g. SHA256 of ciphertext, last 8 chars). NEVER plaintext.
- **Authoring the `dogfood-commitment.md` body content.** Founder pastes verbatim at /ship time; LP-03 stub ships with `<TODO: founder fills in at /ship time>` marker.
- **Adding `axios`** anywhere in the cron handler. Banned by `src/__tests__/check-banned-packages.test.ts` — use native `fetch()`.
- **Skipping `@audit-skip:` pragma on the cron's mutation calls.** `src/__tests__/audit-coverage.test.ts` enforces. The LP cron does no user-attributable mutation, but if it ever writes to the DB the pragma + reason is mandatory.
- **Rebuilding the email retry / dispatch-audit machinery in the cron.** If the cron uses `src/lib/email.ts` `send` (low-level), the existing 3-attempt retry + `notification_dispatches` audit row + `correlation_chain_broken` Path B all come for free. Calling `resend.emails.send` directly is acceptable but loses those facilities — document the choice explicitly.
- **Treating the Sentry capture and the Resend alert as alternatives in the failure path.** Both must fire (LP-02 verbatim — "silent failure prohibited"). Each in its own try/catch so one outage doesn't suppress the other.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PII denylist + JWT detector + recursive walker | Yet-another-pii-scrub | Mirror `src/lib/admin/pii-scrub.ts` exactly in `redact.py` | The TS module has 162 LOC, edge-case-tested against 20-bad / 5-good corpus, used in production for OBSERV-04 + Phase 17 ErrorEnvelope. Re-deriving will introduce drift. |
| Resend retry + audit dispatch | Custom retry-with-backoff loop | Reuse `src/lib/email.ts` `send` (3 attempts, 500ms base, exponential backoff, `notification_dispatches` audit row, `correlation_chain_broken` Path B) | Already implements the OBSERV-03 round-trip; calling `resend.emails.send` directly skips this. Document the choice. |
| Cron-secret comparison | `===` string compare | `safeCompare()` from `@/lib/timing-safe-compare` | Constant-time compare prevents response-time side-channel probing. Universal repo pattern. |
| correlation_id minting on cron tick | Generate UUID inline | `getCorrelationId()` (server-only) | Cron requests have no inbound `x-correlation-id`; the helper falls back to `crypto.randomUUID()` cleanly. Matches sync-funding + reconcile-strategies. |
| Reading vercel.json cron count | grep / regex in shell | `src/__tests__/vercel-cron-limits.test.ts` already loads + asserts | Test runs every CI; new cron entry is checked automatically. |
| Generating the LP factsheet PDF | New puppeteer invocation in cron | `/api/factsheet/[id]/pdf` internal fetch | LP-01 verbatim: "no branded design dependency". Reuse keeps PDF rendering on a single call site with rate-limit + queue + browser-pool semantics. |
| Sentry init in cron handler | Inline `Sentry.init` | Trust `src/instrumentation.ts` did it; lazy `import("@sentry/nextjs")` and call `captureException` | Init runs once at boot; importing in the cron does NOT re-init. |
| Python structlog config | Building a parallel logger | Add `redact.py`'s processor to existing `services/logging_config.py:configure_logging()` processor pipeline | One init point; processors compose cleanly. |
| Sentry `before_send` body | Re-implement walker in `sentry_init.py` | Have `_redact_before_send` import `redact.scrub_pii` and call it on `event['request']`, `event['extra']`, `event['contexts']`, `event['breadcrumbs']`, `event['exception'].values[*].stacktrace.frames[*].vars` (all 5 surfaces already enumerated in `sentry_init.py:131-180`). | The existing `_scrub` walker becomes a thin shim around `redact.scrub_pii` — preserves all 5 capture surfaces. |

**Key insight:** Phase 18 is the **second** time we have written this denylist+walker (TS shipped Phase 16); the **third** time would be the warning sign. Mirror, don't re-derive.

## Runtime State Inventory

> Phase 18 deliverables are pure code/config additions (new files + new env vars + cron registration + 3 small wire-up edits + docs updates). No rename, no refactor, no migration.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB column adds, no string-key renames | None — verified by reviewing CONTEXT.md `## Decisions` (no migration mention) and REQUIREMENTS.md FIX/LP rows. |
| Live service config | **2 new Vercel env vars** required: `FOUNDER_LP_STRATEGY_ID` (UUID) + `FOUNDER_LP_REPORT_TO` (email; falls back to `ADMIN_EMAIL`) — must be set in Vercel UI at production + preview environments BEFORE the cron's first scheduled tick (`0 9 1 * *`). | Plan 3 includes a manual step / runbook entry to set both vars in Vercel UI; Phase 18 docs flag this as a /ship-time operator step. |
| OS-registered state | None — Vercel Cron is the scheduler; no Railway / pm2 / systemd registration touched. The cron is registered declaratively in `vercel.json` (read at deploy time). | None — verified by checking `vercel.json` cron pattern (deploy-time registration, no runtime registration). |
| Secrets/env vars | `CRON_SECRET` reused (no new secret); `RESEND_API_KEY` reused; `SENTRY_DSN` reused; `INTERNAL_API_TOKEN` not needed (cron→factsheet is a public-IP rate-limit-gated route, not an internal route). | None — verified by reading existing crons (`sync-funding`, `reconcile-strategies`, `cleanup-ack-tokens`) all use `CRON_SECRET` + `RESEND_API_KEY`. |
| Build artefacts / installed packages | None — no new npm or pip dep; `redact.py` is pure stdlib; cron handler uses already-installed `resend@^6.10.0` + `@sentry/nextjs@^10.48.0`. | None — verified via `package.json` + `analytics-service/requirements.txt` reads. |

## Common Pitfalls

### Pitfall 1: Cron-quota guardrail accepts numeric minute+hour, but adversarial review must check 7-of-10 soft cap

**What goes wrong:** `vercel.json.crons` array gains a 7th entry. `src/__tests__/vercel-cron-limits.test.ts` caps at 10 — passes. But Vercel Pro plan has 40 crons max; another phase that adds crons may push us toward the soft cap.

**Why it happens:** Hobby-era trauma (production silently stopped twice when Hobby's hard cap of 2 was breached) is the reason for the soft cap.

**How to avoid:** No action needed for Phase 18 (7 crons ≤ 10 soft cap). Document in plan.

**Warning signs:** CI fails at `vercel-cron-limits.test.ts`. Pre-commit `vercel.json` review is the canonical defense.

`[VERIFIED: src/__tests__/vercel-cron-limits.test.ts]`

### Pitfall 2: `0 9 1 * *` — day-of-month vs day-of-week semantics

**What goes wrong:** Operators may misread `0 9 1 * *` as "9:00 every day" or "9:00 every Monday".

**Why it happens:** Cron 5-field syntax: `minute hour day-of-month month day-of-week`. `1` in field 3 = day-of-month=1 (1st of month). Field 5 (`*`) = any day-of-week. Field 4 (`*`) = any month. So: 09:00 UTC on the 1st of every month.

**How to avoid:** Add an explicit comment in `vercel.json` (use `_comment` keys at the cron-entry level — Vercel ignores unknown keys) OR document inline in `route.ts`'s top-of-file docstring. The latter matches `cleanup-ack-tokens/route.ts:5-16` (every cron in this repo has a comment block explaining schedule rationale).

**Warning signs:** A cron tick fires daily instead of monthly → operator paranoid that bandwidth costs spike. Test by checking `cron.next` schedules in Vercel project UI before /ship.

`[CITED: vercel.com/docs/cron-jobs]`

### Pitfall 3: Internal `fetch()` to `/api/factsheet/[id]/pdf` hits the public-IP rate limiter

**What goes wrong:** The factsheet endpoint applies `publicIpLimiter` (`src/app/api/factsheet/[id]/pdf/route.ts:27-33`) keyed on the requester IP. Cron runs in a different lambda from previous requests; the IP is a Vercel-assigned address that may be shared. If the limiter is sized too tight, the cron's monthly call may 429.

**Why it happens:** Public-facing cache + scraping protection. Cron is server-to-server but goes through the same edge.

**How to avoid:** Build the cron's internal-fetch URL using `process.env.NEXT_PUBLIC_APP_URL` (or the Vercel preview URL) — do NOT use `localhost`. Confirm with a manual smoke at /ship time. If 429 ever fires, the alert path catches it (Sentry + Resend) and we re-fire next month — not a silent failure.

**Alternative:** Pass an internal token / signed-token header to bypass the public limiter. Out of scope for v1; document for v2 if 429 ever observed.

**Warning signs:** Sentry `cron-failure` event with HTTP 429 in the metadata.

`[VERIFIED: src/app/api/factsheet/[id]/pdf/route.ts]`

### Pitfall 4: `_redact_before_send` import collision when `redact.py` defines `scrub_pii`

**What goes wrong:** The current `sentry_init.py` defines a private `_scrub` walker. Replacing the body with `from services.redact import scrub_pii` is fine — but `sentry_init.py` is loaded at process bootstrap; if `redact.py` ever imports `sentry_init` (transitively, through structlog config) you'd get a circular import.

**Why it happens:** structlog processors live close to Sentry init; a future "log Sentry-side breadcrumbs" addition could couple them.

**How to avoid:** Keep `redact.py` import-free except for stdlib (`re`, `typing`). NEVER import `sentry_sdk` or `structlog` in `redact.py` — it's a leaf module.

**Warning signs:** ImportError at process boot; `pytest analytics-service/tests/` fails to collect.

`[VERIFIED: redact.py is required by CONTEXT.md to have zero runtime dependencies]`

### Pitfall 5: Drift-prevention parity test loads stale TS denylist after Phase 19 adds keys

**What goes wrong:** Phase 19 adds a new TS denylist entry (e.g. `flow_type: api_verified` ratchets a new wire-form key). Vitest parity test passes (TS regex extracts new key, asserts in `redact.py` text), but `redact.py` doesn't actually have it — test passes incorrectly because the regex didn't capture the new entry.

**Why it happens:** The drift test parses TS source via regex, not AST. New comments / formatting / multi-line entries can break regex extraction silently.

**How to avoid:** Test extracts the denylist set, asserts `keys.length > 8` (current minimum). When TS adds a new key, the count check ensures the test sees it; if `redact.py` doesn't have it, the per-key `expect(py).toContain(...)` assertion fails. Plus a "minimum count" assertion catches a regression where the regex extraction silently captures zero entries.

**Warning signs:** Vitest parity test passes locally, fails in CI; or test passes but a manual grep shows missing keys.

`[VERIFIED: pattern from tests/a11y/chart-contrast.test.ts]`

### Pitfall 6: Resend `attachments[].content` Buffer vs base64 mismatch

**What goes wrong:** Reading `Response.arrayBuffer()` from the internal fetch returns an `ArrayBuffer`. Resend's SDK accepts `Buffer | string`. Passing `ArrayBuffer` directly is ambiguous in v6.10.0 — converting via `Buffer.from(await response.arrayBuffer())` is the safe path.

**Why it happens:** SDK type inferences (`Buffer | string`) may accept `ArrayBuffer` due to TS structural typing but fail at runtime when the underlying HTTP request encodes the body.

**How to avoid:** `const pdfBuffer = Buffer.from(await response.arrayBuffer());` then `attachments: [{ filename, content: pdfBuffer, content_type: "application/pdf" }]`. Tests assert `Buffer.isBuffer(content) === true`.

**Warning signs:** Resend API returns 400 with "invalid attachment encoding" — visible in dispatch_audit row's `error` column or Sentry `cron-failure` event.

`[CITED: resend.com/docs/api-reference/emails/send-email]`

### Pitfall 7: LP-02 dual-alert conflation — Sentry succeeds, Resend fails silently

**What goes wrong:** The catch path fires `Sentry.captureException` THEN `resend.emails.send`. If Resend's dispatch throws (network, 5xx, auth), the Sentry capture has already completed but the email never goes — operator sees Sentry alert but never gets the email.

**Why it happens:** Naive try/catch covers both calls; one of them throwing aborts the second.

**How to avoid:** Each alert in its OWN try/catch. Pattern:
```typescript
try { await sentryCapture(error); } catch { /* never block */ }
try { await resendAlert(error); } catch { /* never block */ }
```

**Warning signs:** Phase 18 SC-4 verification finds Sentry tagged `cron-failure` events without matching Resend `notification_dispatches` row at the same timestamp.

`[VERIFIED: src/app/error.tsx:35 — exact pattern]`

### Pitfall 8: founder-okx-smoke.md inadvertently leaks the test KEK ciphertext

**What goes wrong:** Founder pastes the entire encrypted_key column value as evidence. `encrypted_key` is the Fernet ciphertext (KEK-encrypted DEK + ciphered plaintext). Anyone with KEK access (Railway env var) can decrypt — committing it to git is a long-tail leak.

**Why it happens:** "evidence" feels like "show the data".

**How to avoid:** Spec the file shape verbatim — only commit (1) `correlation_id` (UUID, not sensitive); (2) `strategies.id` (UUID); (3) SHA256 hash of the ciphertext + last 8 chars; (4) timestamp; (5) assertion text "decrypt round-trip succeeded". NEVER commit ciphertext bytes or plaintext.

**Warning signs:** PR review surfaces a 100+ char base64-shape string in the .md file.

`[VERIFIED: CONTEXT.md L158 specifies "redacted ciphertext fingerprint"]`

### Pitfall 9: Pushing BACKBONE-06/-07 from Phase 18 to Phase 19 without updating ROADMAP.md L162-176 + Day-2 doc Section 5

**What goes wrong:** REQUIREMENTS.md row updated to "Phase 19", but ROADMAP.md still lists BACKBONE-06/-07 under Phase 18 success criteria; or Day-2 doc Section 5 explicitly lists them as "IN" under Phase 18.

**Why it happens:** 3 source-of-truth docs (REQUIREMENTS.md / ROADMAP.md / STATE.md) + 1 supporting doc (Day-2 decision) all reference the phase boundary.

**How to avoid:** Plan 4 includes an explicit grep gate: `grep -rn "BACKBONE-06\|BACKBONE-07" .planning/` and confirm every occurrence reads "Phase 19" (not "Phase 18"). Day-2 doc Section 5 is REVISED — already reflects the move; don't re-edit.

Note: Day-2 doc Section 5 (line 116-117) currently says "IN (Phase 18)" for BACKBONE-06/-07. CONTEXT.md L23 explicitly supersedes this; the plan-checker should flag this superseded-but-not-deleted text and point readers to CONTEXT.md as the canonical source.

**Warning signs:** Plan-checker flags inconsistent phase attribution.

`[VERIFIED: REQUIREMENTS.md L216-217, ROADMAP.md L78, Day-2 doc L116-117, CONTEXT.md L23]`

### Pitfall 10: Founder dogfood-commitment stub gets auto-filled by Claude during plan execution

**What goes wrong:** Plan task says "create file" and a Claude task helpfully fills in the `<TODO>` block with placeholder text. The whole point of LP-03 is **founder-owned text** — auto-fill defeats the verbal-in-writing accountability mechanism.

**Why it happens:** Default helpfulness; "TODO" feels like an instruction to fill.

**How to avoid:** Plan task explicitly forbids auto-fill. Stub frontmatter `status: PENDING` is the canary; gate-checker before /ship asserts the stub still has `<TODO: founder fills in at /ship time>` literal AND `status: PENDING`. After founder fills, status flips to SATISFIED and the literal is gone — that's the gate transition.

**Warning signs:** PR diff shows non-empty commitment text written by Claude, not by founder.

`[VERIFIED: CONTEXT.md L77-90 specifies the stub format verbatim + the rationale]`

## Code Examples

### Founder LP cron handler (skeleton)

```typescript
// Source: src/app/api/cron/sync-funding/route.ts + src/app/error.tsx + src/lib/email.ts
// File: src/app/api/cron/founder-lp-report/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { safeCompare } from "@/lib/timing-safe-compare";
import { getCorrelationId } from "@/lib/correlation-id";

export const dynamic = "force-dynamic";
export const maxDuration = 60;  // PDF gen + email send

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const PLATFORM_NAME = process.env.PLATFORM_NAME ?? "Quantalyze";
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL ?? "notifications@quantalyze.com";

async function captureSentry(error: unknown, ctx: Record<string, unknown>): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, {
      tags: { "cron-failure": "founder-lp-report", correlation_id: ctx.correlation_id as string },
      extra: ctx,
    });
  } catch { /* never block alerts */ }
}

async function sendFailureAlert(
  resend: Resend | null,
  to: string,
  ctx: { correlation_id: string; error_class: string; error_message: string },
): Promise<void> {
  if (!resend) return;
  try {
    await resend.emails.send({
      from: `${PLATFORM_NAME} <${PLATFORM_EMAIL}>`,
      to,
      subject: `[ALERT] Founder LP cron FAILED — ${new Date().toISOString().slice(0, 10)}`,
      html: `<p>The founder LP report cron failed. correlation_id=${ctx.correlation_id}</p>
             <pre style="font-family:monospace;">${ctx.error_class}: ${ctx.error_message}</pre>`,
      tags: [
        { name: "correlation_id", value: ctx.correlation_id },
        { name: "kind", value: "cron_failure_alert" },
      ],
    });
  } catch (err) {
    console.error("[cron/founder-lp-report] resend alert failed (escalation broken):", err);
  }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const correlation_id = await getCorrelationId();

  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized", correlation_id }, { status: 401 });
  }

  const strategy_id = process.env.FOUNDER_LP_STRATEGY_ID;
  const recipient = process.env.FOUNDER_LP_REPORT_TO ?? process.env.ADMIN_EMAIL ?? "";
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

  if (!strategy_id || !recipient || !resend) {
    const ctx = {
      correlation_id,
      error_class: "ConfigError",
      error_message: `missing FOUNDER_LP_STRATEGY_ID=${!!strategy_id} FOUNDER_LP_REPORT_TO=${!!recipient} RESEND_API_KEY=${!!resend}`,
    };
    await captureSentry(new Error(ctx.error_message), ctx);
    if (resend && recipient) await sendFailureAlert(resend, recipient, ctx);
    return NextResponse.json({ ok: false, ...ctx }, { status: 500 });
  }

  try {
    // Fetch the existing factsheet PDF endpoint (LP-01 reuse-as-is).
    const pdfRes = await fetch(`${APP_URL}/api/factsheet/${encodeURIComponent(strategy_id)}/pdf`, {
      headers: { "x-correlation-id": correlation_id },
    });
    if (!pdfRes.ok) {
      throw new Error(`factsheet PDF fetch failed: ${pdfRes.status} ${pdfRes.statusText}`);
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const monthLabel = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

    await resend.emails.send({
      from: `${PLATFORM_NAME} <${PLATFORM_EMAIL}>`,
      to: recipient,
      subject: `Founder LP report — ${monthLabel}`,
      html: `<p>Monthly LP factsheet attached.</p>
             <p style="color:#666;font-size:12px;">correlation_id: ${correlation_id}</p>`,
      attachments: [{
        filename: `founder-lp-${monthLabel.replace(/\s/g, "-")}.pdf`,
        content: pdfBuffer,
        content_type: "application/pdf",
      }],
      tags: [
        { name: "correlation_id", value: correlation_id },
        { name: "kind", value: "founder_lp_report" },
      ],
    });

    return NextResponse.json({
      ok: true,
      correlation_id,
      strategy_id,
      pdf_bytes: pdfBuffer.length,
      sent_to: recipient,
    });
  } catch (err) {
    const ctx = {
      correlation_id,
      strategy_id,
      error_class: err instanceof Error ? err.constructor.name : "UnknownError",
      error_message: err instanceof Error ? err.message : String(err),
    };
    console.error("[cron/founder-lp-report] failure:", ctx);
    await captureSentry(err, ctx);
    await sendFailureAlert(resend, recipient, ctx);
    return NextResponse.json({ ok: false, ...ctx }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
```

`[VERIFIED: pattern composed from sync-funding/route.ts + cleanup-ack-tokens/route.ts + alert-digest/route.ts + error.tsx Sentry pattern]`

### `redact.py` Sentry wire-up replacement

```python
# Source: analytics-service/sentry_init.py:120-182 (current placeholder)
# After Phase 18:
from __future__ import annotations
import os
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from services.redact import scrub_pii, scrub_freeform_string

def _redact_before_send(event: dict[str, Any], hint: dict[str, Any] | None) -> dict[str, Any]:
    """Sentry before_send hook. NEVER raises (Pitfall 6 — drops events silently)."""
    try:
        if isinstance(event.get("request"), dict):
            req = event["request"]
            for key in ("headers", "cookies", "data", "json"):
                if key in req and isinstance(req[key], (dict, list)):
                    req[key] = scrub_pii(req[key])
            if isinstance(req.get("query_string"), str):
                req["query_string"] = scrub_freeform_string(req["query_string"])
        for top in ("extra", "contexts"):
            if isinstance(event.get(top), dict):
                event[top] = scrub_pii(event[top])
        # ... breadcrumbs + exception frames vars (existing code, with _scrub → scrub_pii) ...
        return event
    except Exception:
        return event
```

`[VERIFIED: existing sentry_init.py:120-182 surface enumeration]`

### `redact.py` structlog processor wire-up

```python
# Source: analytics-service/services/logging_config.py:38-50
# After Phase 18 — add redact processor between merge_contextvars and JSONRenderer:
from services.redact import scrub_pii

def _redact_processor(_logger, _method_name, event_dict):
    """Walk event_dict through scrub_pii. Never raises — logging path must not break."""
    try:
        return scrub_pii(event_dict)
    except Exception:
        return event_dict

def configure_logging() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            _redact_processor,                                  # NEW
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(sort_keys=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(20),
        cache_logger_on_first_use=True,
    )
```

`[VERIFIED: pattern aligned with existing logging_config.py:40-50]`

### `redact.py` audit-writer wire-up

```python
# Source: analytics-service/services/audit.py:108-120
# After Phase 18 — pass metadata through scrub_pii BEFORE the RPC:
from services.redact import scrub_pii

def log_audit_event(user_id, action, entity_type, entity_id, metadata=None):
    # ... null guards unchanged ...
    payload = scrub_pii(metadata if metadata is not None else {})
    try:
        supabase = get_supabase()
        supabase.rpc("log_audit_event_service", {
            "p_user_id": uid,
            "p_action": action,
            "p_entity_type": entity_type,
            "p_entity_id": eid,
            "p_metadata": payload,
        }).execute()
    except Exception as exc:
        logger.error("[audit] log_audit_event_service call threw (dropping): ...")
```

`[VERIFIED: existing audit.py:107-120]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline `_scrub` walker in `sentry_init.py` (87-117) | Mirror `pii-scrub.ts` in `redact.py`; `_redact_before_send` becomes a thin shim | Phase 18 (this) | Single source of truth for denylist; future TS additions ratchet via parity test |
| `vercel.json` cron registration (current) | `vercel.ts` typed config | NOT YET — explicitly out of scope for v1.0.0 per CONTEXT.md L168 | Future tooling-upgrade PR; bundle with TS5→6, ESLint 10 etc. |
| Custom redact in 3 places (TS) | One canonical `pii-scrub.ts` (Phase 16/17) + Python mirror (Phase 18) | Phase 16 introduced canonical; Phase 18 adds Python parity | Drift-prevention test ratchets |
| Inline retry+attachment-encoding logic in cron | Reuse `src/lib/email.ts` `send` (3-attempt retry + audit + correlation) OR direct `resend.emails.send` (simpler, no retry) | Phase 18 (claude's discretion, see CONTEXT.md L101-105) | Trade-off documented in plan |

**Deprecated/outdated:**
- The original auto-draft Day-2 decision (HOLD) — superseded by REVISED 2026-05-06 verdict (COMMIT). Day-2 doc Section 5's "BACKBONE-06/-07 IN Phase 18" is **superseded** by CONTEXT.md L22-23.
- `_scrub` private walker in `sentry_init.py` — to be replaced by `redact.scrub_pii` import.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Resend SDK v6.10.0 accepts `attachments[].content` as a Node `Buffer` (not just base64 string) | Code Examples + Pattern 3 | LOW — Resend docs explicitly state "passed as a buffer or Base64 string". Verified via WebFetch. If wrong, fall back to `pdfBuffer.toString("base64")` — one-line change. `[CITED: resend.com/docs/api-reference/emails/send-email]` |
| A2 | The cron's internal fetch to `/api/factsheet/[id]/pdf` will not 429 against `publicIpLimiter` once a month | Pitfall 3 | MEDIUM — if it does, the failure-alert path fires (Sentry+Resend) and we re-fire next month. Plan should include a manual smoke at /ship time. |
| A3 | Vercel Pro plan's 40-cron limit is well above the soft 10-cron cap; Phase 18 adds the 7th cron | Pitfall 1 | LOW — `src/__tests__/vercel-cron-limits.test.ts:9-10` documents Pro tier (40 max). |
| A4 | `getCorrelationId()` in a cron context (no inbound `x-correlation-id`) returns a fresh UUID — no exception | Code Examples | LOW — `src/lib/correlation-id.ts:32-45` falls back to `crypto.randomUUID()` when header is null. Verified. |
| A5 | The dogfood-commitment.md frontmatter `status: PENDING` is recognized by the gate-checker | LP-03 stub format | LOW — matches `metaworld-commitment.md` SATISFIED frontmatter precedent. The stub's gate ID `phase-18-exit-dogfood-commitment` is used by the /ship-time gate-checker per LP-03 + CONTEXT.md L77-90. |
| A6 | The shared corpus `tests/fixtures/redact-corpus.json` schema is known to both Vitest and pytest, with `expectRedactedKeys` + `expectJwtRedacted` flags matching the existing TS test shape | Pattern 6 | LOW — TS test at `src/lib/admin/pii-scrub.test.ts:16-79` has 20 inline samples in this exact shape. CONTEXT.md L57 specifies this shape. |
| A7 | Sentry tag value max length isn't exceeded by `correlation_id` (UUID v4 = 36 chars) | Code Examples | LOW — Sentry tags accept up to 200 chars. UUID v4 well within. |
| A8 | Day-2 doc Section 5 listing BACKBONE-06/-07 as "IN (Phase 18)" is acceptable as superseded text once CONTEXT.md is the canonical source | Pitfall 9 | MEDIUM — plan-checker may flag the contradiction. Plan 4's doc-update pass should add an explicit "REVISED 2026-05-06: superseded by CONTEXT.md" header to Day-2 Section 5, OR just remove those rows from Section 5. |

## Open Questions

1. **Should the cron handler reuse `src/lib/email.ts` `send` low-level (free retry+dispatch-audit+correlation_chain_broken) or call `resend.emails.send` directly (simpler, no NotificationType union widening)?**
   - What we know: `email.ts` `send()` is `async`-only and requires `NotificationType` union widening. Direct SDK call is one fewer abstraction but loses the OBSERV-03 round-trip (Path A `tags` still present manually; Path B `notification_dispatches` row not written).
   - What's unclear: which downstream observability (alert-digest dashboards, dispatch funnels) depends on the `notification_dispatches` row.
   - Recommendation: Plan 3 picks ONE approach and documents the choice. Default: direct SDK call (simpler, lower diff surface; the cron does its own correlation_id + tags so OBSERV-03 Path A is preserved). Document in plan that we lose Path B for this caller.

2. **Should `tests/fixtures/redact-corpus.json` extend the existing TS test (refactor + extract)?**
   - What we know: The TS test (`src/lib/admin/pii-scrub.test.ts`) has 20 inline samples in this exact shape.
   - What's unclear: refactoring TS test to load from JSON adds churn outside the Phase 18 boundary. Keeping inline samples + new shared corpus is cleaner.
   - Recommendation: Plan 2 ships shared corpus as NEW (not refactor). Optionally: TS test gets a sibling test that loads the corpus too, for parity.

3. **How are the new Vercel env vars (`FOUNDER_LP_STRATEGY_ID` + `FOUNDER_LP_REPORT_TO`) staged before the first cron tick?**
   - What we know: New env vars must be set in Vercel UI for production environment; cron's first scheduled tick is `0 9 1 * *` after deploy.
   - What's unclear: whether the founder sets them before or after PR merge.
   - Recommendation: Plan 3 includes a runbook entry / TODOS.md gate. /ship-time checklist asserts both env vars are set in Vercel UI BEFORE deploy. Missing-config path is handled gracefully (cron returns 500 with structured error + Sentry/Resend dual-alert).

4. **Day-2 doc Section 5 still lists BACKBONE-06/-07 as Phase 18 IN — should Plan 4 edit that doc to reflect the move?**
   - What we know: CONTEXT.md L22-23 explicitly supersedes Day-2 Section 5.
   - What's unclear: whether Day-2 doc edits are in-scope for Plan 4 (docs update) or whether they're considered immutable historical record.
   - Recommendation: Plan 4 adds a 1-line "REVISED 2026-05-06 — supersedes Section 5 below per CONTEXT.md" header to Day-2 Section 5, NOT a body edit. Keeps the historical record while pointing at the canonical source.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `resend` npm package | LP-01/02 cron handler | ✓ | ^6.10.0 (verified `package.json`) | — |
| `@sentry/nextjs` | LP-02 Sentry capture | ✓ | ^10.48.0 (verified `package.json`) | If `SENTRY_DSN` unset → no-op (intended); Resend alert still fires. |
| `puppeteer-core` + `@sparticuz/chromium` | `/api/factsheet/[id]/pdf` (existing endpoint, reused) | ✓ | ^24.40.0 / ^133.0.0 | — |
| `structlog` | `redact.py` processor wire-up | ✓ | ==25.5.0 (analytics-service/requirements.txt) | — |
| `sentry-sdk[fastapi]` | `redact.py` Sentry wire-up | ✓ | ==2.58.0 (analytics-service/requirements.txt) | — |
| `RESEND_API_KEY` env | LP success + failure emails | ✓ (production) | — | Missing → cron logs `[email] Resend not configured` and audit row marked failed; Sentry capture still fires. |
| `CRON_SECRET` env | Cron auth | ✓ (production) | — | Missing → 401 (intended). |
| `FOUNDER_LP_STRATEGY_ID` env | LP-01 strategy lookup | ✗ — NEW VAR (must be staged before first cron tick) | — | Missing → cron returns 500 with `ConfigError` + Sentry+Resend dual-alert. |
| `FOUNDER_LP_REPORT_TO` env | LP success+failure recipient | ✗ — NEW VAR (must be staged) | — | Missing → fall back to `process.env.ADMIN_EMAIL`. |
| `NEXT_PUBLIC_APP_URL` env | Internal fetch URL for `/api/factsheet/[id]/pdf` | ✓ (production) | — | Missing → fall back to `http://localhost:3000` (dev only); production cron MUST have this set. |
| `SENTRY_DSN` env | Sentry capture | ✓ (production) | — | Missing → captureSentry no-op (intended); Resend alert still fires. |
| Python 3.12+ runtime | `redact.py` execution | ✓ | 3.12-slim Docker base | — |
| Vercel Pro plan | 40-cron capacity | ✓ (since 2026-04-29) | — | — |

**Missing dependencies with no fallback:** none — all blocking deps are in place.

**Missing dependencies with fallback:**
- `FOUNDER_LP_STRATEGY_ID` + `FOUNDER_LP_REPORT_TO` are net-new env vars that must be staged in Vercel UI before first cron tick. Cron handler has graceful degradation (5xx + dual-alert) if missing.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Frontend framework | Vitest 4.1.2 + jsdom + @testing-library/react |
| Frontend config file | `vitest.config.ts` (existing) |
| Frontend quick run | `npm test -- src/app/api/cron/founder-lp-report/route.test.ts` |
| Frontend full suite | `npm test` (114 baseline tests + new Phase 18 additions) |
| Coverage gate | `@vitest/coverage-v8` 60% floor / 80% target (see CLAUDE.md) |
| Python framework | pytest + pytest-asyncio + pytest-cov |
| Python config file | `analytics-service/pytest.ini` |
| Python quick run | `cd analytics-service && pytest tests/test_redact.py -x` |
| Python full suite | `cd analytics-service && pytest --cov=services --cov-fail-under=80` |
| Python coverage gate | `--cov-fail-under=80` (CI-blocking, mandatory) |
| Drift parity test | `npm test -- tests/lib/admin/pii-scrub-python-parity.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FIX-01 | PR #116 + Bug #1 patch traceability (no new test — existing regressions cover) | unit | `cd analytics-service && pytest tests/test_job_worker.py::TestSyncTradesEnqueuesComputeAnalytics -x` | ✅ exists at `analytics-service/tests/test_job_worker.py:553` |
| FIX-01 | Bug #1 forensic patch — correlation_id threaded through compute_jobs.metadata | unit | `npm test -- src/app/api/keys/sync/route.test.ts src/app/api/intro/route.test.ts` | ✅ exists |
| FIX-02 | Founder OKX smoke — manual verification, evidence file commit | manual + file-presence | grep -q "decrypt round-trip succeeded" .planning/phase-18/founder-okx-smoke.md | ❌ Wave 0 — file is NEW |
| FIX-03 | 10-team tracker — markdown table presence | file-presence | `npm test -- src/__tests__/...` (optional file-presence test) | ❌ Wave 0 — file is NEW |
| FIX-04 | scrub_pii mirrors pii-scrub.ts behavior over 20-bad / 5-good corpus | unit | `cd analytics-service && pytest tests/test_redact.py -x` | ❌ Wave 0 — test is NEW |
| FIX-04 | Vitest TS↔Python denylist parity | unit | `npm test -- tests/lib/admin/pii-scrub-python-parity.test.ts` | ❌ Wave 0 — test is NEW |
| FIX-04 | Sentry before_send still drops events on internal error | unit | `cd analytics-service && pytest tests/test_sentry_init.py -k redact -x` (existing; ratchet to use new redact module) | ✅ exists |
| FIX-04 | Audit-log writer scrubs metadata before RPC | unit | `cd analytics-service && pytest tests/test_audit.py -k scrub -x` | Wave 0 — extend existing |
| FIX-04 | Grep gate over Supabase log table = 0 PII strings | manual | post-smoke grep against `audit_log` table | Manual + runbook |
| LP-01 | Cron handler 401 on missing/invalid CRON_SECRET | unit | `npm test -- src/app/api/cron/founder-lp-report/route.test.ts -t "401"` | ❌ Wave 0 — NEW |
| LP-01 | Cron handler happy path: fetches PDF, sends Resend email with attachment | unit | `npm test -- src/app/api/cron/founder-lp-report/route.test.ts -t "happy"` | ❌ Wave 0 — NEW |
| LP-01 | Vercel cron entry valid + within 10-cron soft cap | regression-guard | `npm test -- src/__tests__/vercel-cron-limits.test.ts` | ✅ exists (will run on PR) |
| LP-02 | Failure path: Sentry capture + Resend alert email both fire | unit | `npm test -- src/app/api/cron/founder-lp-report/route.test.ts -t "failure path"` | ❌ Wave 0 — NEW |
| LP-02 | Failure-path: each alert in its own try/catch (Sentry throw doesn't suppress Resend) | unit | `npm test -- src/app/api/cron/founder-lp-report/route.test.ts -t "Sentry throw"` | ❌ Wave 0 — NEW |
| LP-03 | dogfood-commitment.md stub presence + status=PENDING | file-presence | `grep -q "status: PENDING" .planning/phase-18/dogfood-commitment.md` | ❌ Wave 0 — NEW |
| BACKBONE-06/-07 doc-update | REQUIREMENTS.md + ROADMAP.md + STATE.md attribute to Phase 19 | regression-guard | `grep -E "BACKBONE-0[67]" .planning/REQUIREMENTS.md .planning/ROADMAP.md .planning/STATE.md \| grep -v "Phase 19"` returns nothing | ❌ Wave 0 — manual grep gate |

### Sampling Rate

- **Per task commit:** `npm test -- <changed test file>` + `cd analytics-service && pytest tests/test_redact.py -x` (when redact.py touched)
- **Per wave merge:** `npm test && cd analytics-service && pytest --cov=services --cov-fail-under=80`
- **Phase gate:** Full suite green + Vercel cron-quota guard pass + manual founder-okx-smoke evidence committed before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `analytics-service/services/redact.py` — covers FIX-04
- [ ] `analytics-service/tests/test_redact.py` — covers FIX-04
- [ ] `tests/fixtures/redact-corpus.json` — shared 20-bad / 5-good corpus
- [ ] `tests/lib/admin/pii-scrub-python-parity.test.ts` — covers FIX-04 drift
- [ ] `src/app/api/cron/founder-lp-report/route.ts` + `route.test.ts` — covers LP-01/LP-02
- [ ] `.planning/phase-18/dogfood-commitment.md` — covers LP-03
- [ ] `.planning/phase-18/team-status.md` — covers FIX-03
- [ ] `.planning/phase-18/founder-okx-smoke.md` — covers FIX-02
- [ ] `vercel.json` — cron entry addition (covered by `vercel-cron-limits.test.ts`)
- [ ] `.env.example` — new env vars documented
- [ ] `analytics-service/sentry_init.py` — `_redact_before_send` body swap (existing tests ratchet)
- [ ] `analytics-service/services/logging_config.py` — processor pipeline addition (extend existing tests)
- [ ] `analytics-service/services/audit.py` — metadata scrub call (extend existing test_audit.py)
- [ ] `.planning/REQUIREMENTS.md` + `.planning/ROADMAP.md` + `.planning/STATE.md` — BACKBONE-06/-07 phase attribution updates
- [ ] `TODOS.md` — link to team-status.md

Framework install: none required (all in place).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | YES | CRON_SECRET via `safeCompare()` (timing-safe constant-time compare); Vercel cron signature header. |
| V3 Session Management | NO | Cron is stateless server-to-server. |
| V4 Access Control | YES | Cron handler refuses non-Bearer-CRON_SECRET requests with 401; service-role admin client used for any DB lookup. |
| V5 Input Validation | YES | `FOUNDER_LP_STRATEGY_ID` is server-trusted (Vercel env), but the value is `encodeURIComponent()`-encoded into the internal fetch URL. Resend recipient sanitized via existing `safeSubject()` if reused; minimal HTML body uses no user input. |
| V6 Cryptography | NO | No new cryptographic primitives. KEK encryption (Fernet) reused as-is by `/api/factsheet/[id]/pdf` (no change). |
| V7 Error Handling & Logging | YES | Structured envelope on all error paths; `redact.py` strips PII from Sentry + structlog + audit before egress. |
| V8 Data Protection | YES | `redact.py` extends the existing TS denylist (8+ keys) to the Python boundary. Grep gate: zero credential-shaped strings in Supabase log table after smoke. |
| V9 Communication | YES | Internal fetch uses HTTPS to `NEXT_PUBLIC_APP_URL`. Outbound Resend uses HTTPS by default. |
| V12 Files and Resources | YES | PDF attachment ≤ 40MB Resend cap; existing factsheet endpoint enforces this implicitly via puppeteer slot semaphore. |
| V14 Configuration | YES | New env vars (`FOUNDER_LP_STRATEGY_ID` + `FOUNDER_LP_REPORT_TO`) documented in `.env.example`; missing-config path produces structured 5xx + dual-alert (no silent failure per LP-02). |

### Known Threat Patterns for {Vercel Cron + Python redact + Resend stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CRON_SECRET timing leak | Spoofing | `safeCompare()` (timing-safe) — universal repo pattern. |
| PII leak via Sentry breadcrumb / structlog event_dict / audit_log payload | Information Disclosure | `redact.py` `scrub_pii` walker on all 3 boundaries; drift-prevention parity test ratchets denylist. |
| JWT exfil via freeform error message | Information Disclosure | `scrub_freeform_string` 3-pass redaction at copy-diagnostics surface (already in TS; mirror in Python). |
| Internal-token exfil in HTTP breadcrumb | Information Disclosure | `x-internal-token` on the explicit denylist (per OBSERV-07). |
| Exchange account ID full disclosure in admin UI | Information Disclosure | `truncate_account_id` mirror — `***<last4>` for ≥8-char strings. |
| Cron-failure silently swallowed | Denial of Service / Information Disclosure | Dual-alert (Sentry + Resend) per LP-02. Each in its own try/catch (Pitfall 7). |
| Founder LP plaintext key leak in `founder-okx-smoke.md` | Information Disclosure | Spec restricts evidence to correlation_id + strategy id + ciphertext SHA256 fingerprint; NEVER plaintext or raw ciphertext (Pitfall 8). |
| Resend tag value max-length overflow | Tampering / Bypass | UUID v4 = 36 chars (well under 200-char limit); explicit type assertion at runtime. |

## Sources

### Primary (HIGH confidence)
- `src/lib/admin/pii-scrub.ts` — canonical TS module to mirror (162 LOC, fully tested)
- `src/lib/admin/pii-scrub.test.ts` — 20-bad / 5-good shape that the shared corpus mirrors
- `src/app/api/cron/sync-funding/route.ts` — canonical cron handler (auth + correlation_id + RPC)
- `src/app/api/cron/reconcile-strategies/route.ts` — canonical cron handler (correlation_id + structured response)
- `src/app/api/cron/cleanup-ack-tokens/route.ts` — minimal cron handler shape
- `src/app/api/cron/cleanup-wizard-drafts/route.ts` — cron handler with comment-block convention
- `src/app/api/alert-digest/route.ts` — Resend cron pattern (~170 LOC end-to-end including dispatch audit)
- `src/app/api/factsheet/[id]/pdf/route.ts` — existing PDF endpoint reused as-is
- `src/lib/email.ts` — Resend `send` low-level + dispatch audit + correlation_chain_broken Path B
- `src/lib/correlation-id.ts` — `getCorrelationId()` + UUID v4 fallback
- `src/lib/timing-safe-compare.ts` — `safeCompare()` cron auth pattern
- `src/instrumentation.ts` — Sentry init + `onRequestError` framework hook
- `src/app/error.tsx` + `src/app/global-error.tsx` — lazy Sentry import pattern
- `analytics-service/sentry_init.py` — current `_redact_before_send` placeholder + 5-surface enumeration
- `analytics-service/services/logging_config.py` — structlog processor pipeline
- `analytics-service/services/audit.py` — Python audit RPC writer
- `vercel.json` — cron registration target (currently 6 entries; 7th = `founder-lp-report`)
- `tests/a11y/chart-contrast.test.ts` — TS↔file-text drift-prevention pattern
- `src/__tests__/vercel-cron-limits.test.ts` — cron-quota guardrail
- `.planning/phases/18-root-cause-fix-founder-lp-skeleton/18-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md` (FIX-01..04, LP-01..03, BACKBONE-06/-07 attribution)
- `.planning/STATE.md` (waves, gates, BACKBONE-06/-07 references)
- `.planning/ROADMAP.md` Phase 18/19 boundary
- `.planning/phase-16/day-2-decision.md` (REVISED 2026-05-06; COMMIT verdict)
- `.planning/phase-18/metaworld-commitment.md` (SATISFIED entry-gate)
- `.planning/codebase/CONVENTIONS.md` + `STACK.md` + `STRUCTURE.md` + `TESTING.md`
- `CLAUDE.md` (project) + `AGENTS.md` (Next.js 16 fork warning)

### Secondary (MEDIUM confidence)
- WebFetch from resend.com/docs/api-reference/emails/send-email — `attachments[].content` accepts `Buffer | base64 string`; 40MB total cap [CITED: 2026-05-06]

### Tertiary (LOW confidence)
- None — every Phase 18 claim is grounded in either repo source code or Resend's official current docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every required dep is already installed and active in the repo at known-good versions.
- Architecture: HIGH — Phase 18 is mirror + reuse, not new architecture. Every pattern has a sibling in `main`.
- Pitfalls: HIGH — repo testing infrastructure (`vercel-cron-limits.test.ts`, `audit-coverage.test.ts`, `check-banned-packages.test.ts`) catches the most likely regressions automatically.
- Test map: HIGH — every requirement has a known automated command and known file-presence check.

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (Phase 18 cron schedule fires `0 9 1 * *` — first prod tick is 2026-06-01; planning + execution + verification window comfortably inside the validity period).
