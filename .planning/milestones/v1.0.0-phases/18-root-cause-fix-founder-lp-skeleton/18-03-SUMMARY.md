---
phase: 18-root-cause-fix-founder-lp-skeleton
plan: 03
subsystem: cron / lp-report / resend / observability
tags:
  - cron
  - lp-report
  - resend
  - sentry
  - phase-18
dependency_graph:
  requires:
    - "src/lib/timing-safe-compare.ts (safeCompare)"
    - "src/lib/correlation-id.ts (getCorrelationId)"
    - "src/lib/supabase/admin.ts (createAdminClient)"
    - "src/app/api/factsheet/[id]/pdf/route.ts (internal fetch target)"
    - "process.env.INTERNAL_API_TOKEN (PR #120)"
    - "process.env.CRON_SECRET (existing)"
    - "process.env.RESEND_API_KEY (existing)"
  provides:
    - "GET/POST /api/cron/founder-lp-report (Vercel cron handler at 15 9 1 * *)"
    - "x-internal-token bypass on /api/factsheet/[id]/pdf publicIpLimiter (B4)"
    - "scripts/check-founder-lp-readiness.ts (npm-runnable preflight)"
    - "FOUNDER_LP_STRATEGY_ID + FOUNDER_LP_REPORT_TO env-var contract"
  affects:
    - "vercel.json (7 crons; soft cap 10)"
    - "package.json scripts (new check:founder-lp-readiness)"
tech_stack:
  added: []
  patterns:
    - "Vercel cron handler with auth-first ordering (mirrors sync-funding/route.ts)"
    - "Lazy import @sentry/nextjs in catch path"
    - "Resend with PDF attachment via Buffer.from(arrayBuffer) (Pitfall 6)"
    - "Dual-alert wrapper with independent try/catch per alert (Pitfall 7) + double-failure escalation (B4)"
    - "Single 503 retry honoring Retry-After header (W1)"
    - "AbortSignal.timeout(25_000) on internal fetch (Grok W4)"
    - "Strategy publication precheck via Supabase admin client (B1 + Grok W5)"
key_files:
  created:
    - "src/app/api/cron/founder-lp-report/route.ts"
    - "src/app/api/cron/founder-lp-report/route.test.ts"
    - "scripts/check-founder-lp-readiness.ts"
    - ".planning/phase-18/founder-lp-runbook.md (gitignored, local artifact)"
  modified:
    - "src/app/api/factsheet/[id]/pdf/route.ts (+ x-internal-token bypass)"
    - "vercel.json (+ 7th cron entry)"
    - ".env.example (+ FOUNDER_LP_STRATEGY_ID + FOUNDER_LP_REPORT_TO)"
    - "package.json (+ check:founder-lp-readiness script)"
decisions:
  - "Mock Resend with a real class (`class { emails = { send: sendMock } }`) instead of `vi.fn().mockImplementation(() => ({...}))` because `new Resend(...)` requires a constructor — closes RED → GREEN gap."
  - "Resend SDK Attachment uses camelCase `contentType`, not `content_type` — corrected during typecheck pass."
  - "Cron at `15 9 1 * *` (09:15 UTC, NOT 09:00) — Adversarial revision B4 moved it to dodge the existing 09:00 alert-digest collision."
  - "Factsheet `x-internal-token` bypass is additive — falls through to existing publicIpLimiter for unauthenticated callers (no public-surface change)."
  - "Vercel Workflow recommendation declined — single 10s 503 retry inside maxDuration=60 is well within Functions limits and matches existing repo retry patterns (email.ts L220-230)."
metrics:
  duration: "~12 minutes"
  completed_date: "2026-05-06"
  tasks_total: 3
  tasks_complete: 3
  tests_added: 10
  tests_passing: 16
---

# Phase 18 Plan 03: Founder LP Cron + Status-Published Runbook + Dual-Alert + Double-Failure Escalation Summary

Ships LP-01 + LP-02 in full: a Vercel cron at `/api/cron/founder-lp-report` that runs monthly (`15 9 1 * *`), reuses the existing `/api/factsheet/[id]/pdf` endpoint, emails the rendered PDF to the founder via Resend, and fails into a dual-alert (Sentry + Resend) path with a third-line `[CRON_DOUBLE_FAILURE]` console.error escalation when both alerts throw. All 8 adversarial revisions (B1/B4/W1/W2/W5/W7/Grok W4/Grok W5) baked in.

## Files Modified

### Created

- `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/cron/founder-lp-report/route.ts` (318 lines)
  - GET/POST handler delegating to a single `handle(req)` function
  - Auth FIRST → `getCorrelationId()` → config check → `checkStrategyReadiness()` → `fetchFactsheetPdfWithRetry()` → Resend send → `dualAlert()` on failure
- `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/cron/founder-lp-report/route.test.ts` (363 lines)
  - 10 it() blocks covering auth, happy path, Grok W5 precheck, PDF 4xx, W1 503 retry, Pitfall 7 Resend throw, W7 Sentry throw, B4 double-failure, ConfigError
- `/Users/helios-mammut/claude-projects/quantalyze/scripts/check-founder-lp-readiness.ts` (61 lines)
  - npm-runnable preflight that exits non-zero unless `strategies.status='published'` AND `strategy_analytics.computation_status='complete'`
- `/Users/helios-mammut/claude-projects/quantalyze/.planning/phase-18/founder-lp-runbook.md` (local artifact; `.planning/` is gitignored)
  - Founder pre-flight runbook with timestamp checklist and Supabase Studio SQL block

### Modified

- `/Users/helios-mammut/claude-projects/quantalyze/src/app/api/factsheet/[id]/pdf/route.ts`
  - Added `import { safeCompare } from "@/lib/timing-safe-compare";`
  - Wrapped existing `publicIpLimiter` block in `if (!isInternalCall) {...}` guarded by `safeCompare(req.headers.get("x-internal-token"), process.env.INTERNAL_API_TOKEN)`
- `/Users/helios-mammut/claude-projects/quantalyze/vercel.json`
  - Added 7th cron entry: `{ "path": "/api/cron/founder-lp-report", "schedule": "15 9 1 * *" }` (soft cap 10; JSON valid)
- `/Users/helios-mammut/claude-projects/quantalyze/.env.example`
  - Added `# ─── Founder LP report cron (Phase 18 / LP-01) ─` section documenting `FOUNDER_LP_STRATEGY_ID` + `FOUNDER_LP_REPORT_TO`
- `/Users/helios-mammut/claude-projects/quantalyze/package.json`
  - Added `"check:founder-lp-readiness": "tsx scripts/check-founder-lp-readiness.ts"` to scripts block

## Commits

| Task | Commit  | Message                                                                                |
| ---- | ------- | -------------------------------------------------------------------------------------- |
| 1    | `8ab2317` | `feat(phase-18-03): pre-flight runbook + readiness script (B1)`                        |
| 2    | `5557178` | `test(phase-18-03): RED — failing Vitest scaffold for founder LP cron (10 cases)`      |
| 3    | `9933b50` | `feat(phase-18-03): GREEN — founder LP cron + factsheet bypass + vercel.json + .env.example` |

## Acceptance per Task

### Task 1: Pre-flight runbook + readiness script (B1) — PASSED

- `.planning/phase-18/founder-lp-runbook.md` exists with `gate: phase-18-lp-cron-readiness-runbook`, `status: PENDING`, `requirement: LP-01`, the literal `status='published'`, `computation_status='complete'`, and the pre-flight checklist table
- `scripts/check-founder-lp-readiness.ts` exists, exits non-zero on missing env (2) or wrong status/analytics (1), exits 0 on green
- `package.json` `scripts.check:founder-lp-readiness` wired

### Task 2: Vitest test suite RED — PASSED

- 10 it() blocks (≥10 required)
- Mocks `@sentry/nextjs`, `resend`, `@/lib/supabase/admin`, `@/lib/correlation-id`; `vi.stubGlobal("fetch", ...)`
- Tests cover: 401 missing auth, 401 wrong CRON_SECRET, happy path with x-internal-token + AbortSignal, Grok W5 precheck short-circuit, PDF 4xx → dual-alert, W1 503 retry, Pitfall 7 Resend throw, W7 Sentry throw, B4 double-failure, ConfigError missing FOUNDER_LP_STRATEGY_ID
- 5 tests assert BOTH Sentry capture AND Resend ALERT email fire (dual-alert pattern)
- W7 uses `captureExceptionMock.mockImplementation(() => { throw new Error("sentry down") })` with SENTRY_DSN remaining set
- B4 spies on console.error and asserts `[CRON_DOUBLE_FAILURE]` literal
- Pre-implementation, vitest reports "Failed to resolve import './route'" — RED confirmed before Task 3

### Task 3: Implement cron route + factsheet bypass + vercel.json + .env.example (GREEN) — PASSED

- `route.ts` exports `GET` + `POST` (both bound to same `handle`)
- Auth `if` block precedes the `getCorrelationId()` call (W5)
- Imports `@/lib/timing-safe-compare`, `@/lib/correlation-id`, `@/lib/supabase/admin`, `next/server`, `resend`
- `await import("@sentry/nextjs")` (lazy) — confirmed
- Native `fetch()` only — no axios import; banned-packages test passes
- `@audit-skip:` pragma on JSDoc — confirmed
- `[cron/founder-lp-report]` log prefix — 5 occurrences
- `[CRON_DOUBLE_FAILURE]` literal — 5 occurrences (3 in code paths + 2 in JSDoc/test references)
- `Buffer.from(await pdfRes.arrayBuffer())` for attachment encoding (Pitfall 6) — confirmed
- `AbortSignal.timeout(25_000)` on internal fetch (Grok W4) — confirmed
- `x-internal-token` header on internal fetch (B4) — confirmed
- `checkStrategyReadiness` precheck calling `createAdminClient` (B1 + Grok W5) — confirmed
- `fetchFactsheetPdfWithRetry` retries once on 503 honoring Retry-After (W1) — confirmed
- `dualAlert` wrapper with independent try/catch per alert (Pitfall 7 + B4 escalation) — confirmed
- File contains documentation comment "Vercel cron does not pass x-correlation-id; cron always generates a fresh UUID v4 per tick" (W2) — confirmed
- `src/app/api/factsheet/[id]/pdf/route.ts` imports `safeCompare`; x-internal-token bypass guards `publicIpLimiter` (B4) — confirmed
- `vercel.json` `crons` array contains `{ "path": "/api/cron/founder-lp-report", "schedule": "15 9 1 * *" }` (B4 schedule)
- `vercel.json` parses as valid JSON (Grok W2): `node -e "JSON.parse(...)"` exits 0
- `vercel.json` `crons` array length 7 (≤ 10 soft cap)
- `.env.example` contains both `FOUNDER_LP_STRATEGY_ID=` and `FOUNDER_LP_REPORT_TO=`
- All Vitest suites pass: 10/10 cron tests + cron-quota guard + banned-packages guard (16 total)

## Test Counts

- **Cron route tests:** 10 it() blocks, all green (route.test.ts)
- **Cron-quota guard:** 2 tests passing (vercel-cron-limits.test.ts)
- **Banned-packages guard:** 4 tests passing (check-banned-packages.test.ts)
- **Total verified:** 16 tests passing

## Vercel.json Cron Count Change

- Before: 6 crons
- After: 7 crons (added founder-lp-report)
- Schedule: `15 9 1 * *` (1st of month 09:15 UTC) — moved from `0 9 1 * *` per Adversarial revision B4 to avoid colliding with alert-digest at `0 9 * * *`
- Soft cap: 10; current 7 leaves 3 free
- JSON validity: confirmed via `JSON.parse(readFileSync('vercel.json'))`

## Factsheet Route Bypass Diff Summary (B4)

```diff
+ import { safeCompare } from "@/lib/timing-safe-compare";

+ const internalToken = req.headers.get("x-internal-token");
+ const internalEnv = process.env.INTERNAL_API_TOKEN;
+ const isInternalCall =
+   internalToken !== null &&
+   typeof internalEnv === "string" &&
+   internalEnv.length > 0 &&
+   safeCompare(internalToken, internalEnv);
+
+ if (!isInternalCall) {
    const ip = getClientIp(req.headers);
    const rl = await checkLimit(publicIpLimiter, `pdf:${ip}`);
    if (!rl.success) { ... return 429 ... }
+ }
```

The bypass is additive — public callers without `x-internal-token` see no behavior change.

## /ship-time Runbook (founder action list)

1. Confirm 3 env vars staged in Vercel UI: `FOUNDER_LP_STRATEGY_ID`, `FOUNDER_LP_REPORT_TO` (`INTERNAL_API_TOKEN` already present from PR #120).
2. Founder flips `strategies.status='published'` for the founder strategy via Supabase Studio SQL (block in `.planning/phase-18/founder-lp-runbook.md`).
3. Run `npm run check:founder-lp-readiness` locally (with `vercel env pull --environment=production`) — must exit 0.
4. After PR merges, manually trigger the cron once via Vercel Dashboard → Project → Crons → `/api/cron/founder-lp-report` → "Run Now". Confirm Resend email + PDF attachment delivery.
5. Mark gate `status: COMPLETE` in `founder-lp-runbook.md` with timestamps.

## Deviations from Plan

### Auto-fixed during execution (Rule 1 — bugs)

**1. [Rule 1 - Bug] Resend mock in test file used non-constructor function**

- **Found during:** Task 3 (running test suite GREEN check)
- **Issue:** Plan skeleton suggested `Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } }))`, but `new Resend(KEY)` rejects a non-constructor function with `TypeError: () => ... is not a constructor`. 8 of 10 tests failed with this error.
- **Fix:** Replaced with a real class — `Resend: class { emails = { send: sendMock } }` — so `new Resend(...)` resolves cleanly. `sendMock` is still a shared `vi.fn()` so tests can configure per-call resolutions.
- **Files modified:** `src/app/api/cron/founder-lp-report/route.test.ts`
- **Commit:** `9933b50`

**2. [Rule 1 - Bug] Resend SDK Attachment property is `contentType` (camelCase), not `content_type`**

- **Found during:** Task 3 typecheck pass after writing `route.ts`
- **Issue:** Plan skeleton used `content_type: "application/pdf"`. TypeScript flagged: `Object literal may only specify known properties, but 'content_type' does not exist in type 'Attachment'. Did you mean to write 'contentType'?`
- **Fix:** Changed to `contentType: "application/pdf"` in both `route.ts` and the matching test assertion in `route.test.ts`.
- **Files modified:** `src/app/api/cron/founder-lp-report/route.ts`, `src/app/api/cron/founder-lp-report/route.test.ts`
- **Commit:** `9933b50`

### Auto-handled (Rule 2 — missing critical functionality)

None — the plan was complete with respect to threat model, error handling, observability, and security.

### Skipped recommendations

- Vercel-functions PostToolUse validator recommended migrating the cron to Vercel Workflow because the W1 503-retry path uses a `setTimeout` for the Retry-After wait. Declined: the wait is bounded by `Math.max(1, parseInt(retryAfterRaw))` × 1000 ms with `maxDuration = 60`, well within Functions limits, and matches the existing repo retry pattern in `src/lib/email.ts` L220-230. Migrating to Workflow would change the request shape and break the test contract for single-GET semantics.
- next-cache-components / routing-middleware / vercel-storage / next-upgrade / bootstrap skill suggestions: not applicable — this plan adds a route handler that mirrors existing cron patterns, edits one entry in the existing `crons` array of `vercel.json`, and edits `.env.example` documentation. No cache components, no middleware, no new storage backend, no Next.js upgrade, no project bootstrap.

## Authentication Gates

None encountered during execution — all operations local-filesystem + npm + git.

## Threat Flags

No new security-relevant surface introduced beyond what the threat model documents:

- `T-18-10` (cron auth) — `safeCompare` against `Bearer ${CRON_SECRET}` → mitigated
- `T-18-11` (vercel.json tampering) — cron-limits guard + JSON validity → mitigated
- `T-18-12` (LP cron failure invisibility) — dual-alert + B4 double-failure escalation → mitigated
- `T-18-13` (PDF content disclosure) — accepted (founder is the recipient)
- `T-18-14` (publicIpLimiter DoS) — x-internal-token bypass for internal cron → mitigated
- `T-18-14b` (x-internal-token spoofing) — safeCompare against `INTERNAL_API_TOKEN` (constant time) → mitigated
- `T-18-15` (axios introduction) — banned-packages guard + native fetch → mitigated
- `T-18-16` (correlation_id PII) — UUID v4 carries no PII → accepted
- `T-18-16b` (cron lambda timeout on slow factsheet) — AbortSignal.timeout(25_000) → mitigated
- `T-18-16c` (strategy not published) — checkStrategyReadiness precheck + runbook + readiness script → mitigated

## Self-Check: PASSED

- `src/app/api/cron/founder-lp-report/route.ts` — FOUND
- `src/app/api/cron/founder-lp-report/route.test.ts` — FOUND
- `scripts/check-founder-lp-readiness.ts` — FOUND
- `.planning/phase-18/founder-lp-runbook.md` — FOUND (local; `.planning/` is gitignored)
- vercel.json contains `"/api/cron/founder-lp-report"` — FOUND
- `.env.example` contains `FOUNDER_LP_STRATEGY_ID` + `FOUNDER_LP_REPORT_TO` — FOUND
- Commit `8ab2317` (Task 1) — FOUND
- Commit `5557178` (Task 2 RED) — FOUND
- Commit `9933b50` (Task 3 GREEN) — FOUND
