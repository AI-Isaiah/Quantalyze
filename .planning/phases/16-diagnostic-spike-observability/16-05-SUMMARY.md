---
phase: 16-diagnostic-spike-observability
plan: 05
subsystem: notifications / observability
status: partial-complete-pending-checkpoint
tags: [observability, resend, webhook, svix, correlation-id, rls, OBSERV-03]
requires:
  - migration-098-applied-to-test-supabase  # checkpoint:human-action (Task 5)
  - RESEND_WEBHOOK_SECRET set in Vercel env  # production deploy gate (post-merge)
provides:
  - svix-verified-resend-webhook-handler
  - correlation_id-3-path-recovery-chain
  - resend_message_correlation-mapping-table
  - RLS-deny-anon-pytest-invariant
  - Path-B-best-effort-mapping-insert-with-1-retry
affects:
  - src/lib/email.ts (every send carries correlation_id tag + Path B insert)
  - notification_dispatches audit row contract unchanged
  - all 7 notify*/sendAlertDigest call sites inherit new behavior automatically
tech-stack:
  added:
    - svix ^1.92.2 (npm — Resend webhook signature verification)
  patterns:
    - "Webhook.verify(rawBody, headers) BEFORE JSON.parse (Pitfall 5 mitigation)"
    - "best-effort + 1-retry + structured-warning fallback (Path B / Pitfall 17)"
    - "always-200 webhook contract (Resend retry-storm safeguard)"
key-files:
  created:
    - supabase/migrations/098_resend_message_correlation.sql
    - src/app/api/webhooks/resend/route.ts
    - src/app/api/webhooks/resend/route.test.ts
    - analytics-service/tests/test_resend_correlation_rls.py
    - .planning/phase-16/resend-tag-roundtrip-evidence.md
  modified:
    - package.json + package-lock.json (added svix)
    - src/lib/email.ts (correlation_id tag + Path B mapping insert)
    - src/lib/email.test.ts (Rule 1 fix — server-only / next/headers mocks)
    - .planning/TODOS.md (OBSERV-03 line)
decisions:
  - "Migration slot 098 (NOT 095): 093-097 reserved for Phase 19 per STATE.md L107; first free slot after Phase 19 reservation block is 098. SQL header comment cites the reservation."
  - "Best-effort Path B insert with 1 retry on every successful send (RESEARCH Open Question 1 recommendation): cost ~0ms happy path; failure logs `correlation_chain_broken` but never blocks the user-facing send."
  - "Webhook returns 200 unconditionally once signature verifies — even on lookup failure or unrecoverable cid. Rationale: Resend retries on 5xx; we have already accepted the event."
  - "svix npm package's Webhook.verify() rather than hand-rolled HMAC. svix internally enforces ±5-min replay-window guard + constant-time signature comparison + multi-sig rotation."
  - "Empirical capture of the live Resend webhook payload deferred: RESEND_API_KEY is not exposed to the parallel-executor sandbox. Documented shape per Resend 2026-05 docs (dict form / Path A') is recorded; first production webhook fire will surface the actual shape via the [resend-webhook] correlation_id recovered log line."
metrics:
  tasks-completed: 6 of 7  # Task 5 = checkpoint:human-action (live Supabase push)
  vitest-cases-added: 7    # all passing
  pytest-cases-added: 2    # both skipped (no TEST_SUPABASE_DB_URL); will run live after Task 5
  commits: 8
  duration: ~10 min wall-clock
  completed-date: 2026-05-01
---

# Phase 16 Plan 05: Resend Tag Round-Trip Summary

**One-liner:** Wires correlation_id end-to-end across the Resend send→webhook
boundary via tags array (Path A) + tags dict fallback (Path A') + a
best-effort `resend_message_correlation` mapping table (Path B), with a
Svix-verified webhook handler that always returns 200.

## Status

**PARTIAL: 6 of 7 tasks complete in this executor run.** Task 5 (apply
migration 098 to test Supabase via `supabase db push`) is a blocking
`checkpoint:human-action` task that requires live Supabase credentials
(`SUPABASE_ACCESS_TOKEN` for the `qmnijlgmdhviwzwfyzlc` test project).
Those credentials are not exposed to the parallel-executor sandbox by
design. See **Checkpoint Required** section below.

All other deliverables — code, tests, migration file, evidence doc —
are committed on this worktree branch. Once Task 5 is executed by the
orchestrator (or a fresh session with `SUPABASE_ACCESS_TOKEN` set), the
2 pytest cases at `analytics-service/tests/test_resend_correlation_rls.py`
will run against the live schema and lock the RLS invariant.

## What shipped

### Migration 098: `resend_message_correlation` (file ready, push pending)

Path: `supabase/migrations/098_resend_message_correlation.sql` (62 lines)

```
CREATE TABLE public.resend_message_correlation (
    id              bigserial PRIMARY KEY,
    correlation_id  uuid NOT NULL,
    resend_message_id text NOT NULL,
    sent_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT resend_message_correlation_unique_msg UNIQUE (resend_message_id)
);
-- 2 indexes (correlation_id, sent_at) + RLS-on (no policies = service-role only)
-- + GRANT SELECT/INSERT/DELETE to service_role
-- + 90-day retention pg_cron (guarded by pg_extension check)
```

**Slot rationale:** 093-097 reserved for Phase 19 per STATE.md L107
Phase-Internal Gates table. Phase 16 lands at first free slot above the
reservation block — 098. Header comment cites STATE.md so any future
reader understands the gap. Slots 095/096/097 remain reserved.

### `src/lib/email.ts` — correlation_id tag + Path B mapping insert

Every `resend.emails.send()` call in `send()` now carries:

```ts
tags: [
  { name: "correlation_id", value: correlationId },
  { name: "kind",           value: notificationType },
]
```

`correlationId` is resolved once per send (NOT per retry attempt) via
`getCorrelationId()` from `@/lib/correlation-id` — falls back to
`crypto.randomUUID()` if the call originates outside a request scope
(cron, etc.).

After a successful send, `insertCorrelationMapping()` writes a row into
`resend_message_correlation` with **1 retry** on transient failure
(150ms backoff). Both attempts failing logs a structured warning:

```
[email] correlation_chain_broken { resend_message_id, correlation_id, first_error, retry_error }
```

Sentry will pick this up via the existing `before_send` filter
(introduced in Plan 16-03, which lands in parallel). The send itself is
NEVER blocked by a mapping-insert failure — the email is already
delivered by Resend at that point.

### `/api/webhooks/resend` route (Svix-verified, 3-path extractor)

Path: `src/app/api/webhooks/resend/route.ts` (128 lines)

- `runtime = "nodejs"` (svix needs Node crypto — Pitfall 2)
- `dynamic = "force-dynamic"` (no static rendering of webhook responses)
- Reads `svix-id` / `svix-timestamp` / `svix-signature` headers
- Calls `Webhook.verify(rawBody, headers)` BEFORE parsing payload
  (Pitfall 5 — never JSON-parse before signature verify)
- 401 on missing OR invalid OR stale-timestamp signature (svix
  enforces ±5-min replay window internally)
- correlation_id extraction priority chain:
  - **Path A** (`tags-array`) — Resend canonical send-API shape
  - **Path A'** (`tags-dict`) — defensive fallback for the documented
    webhook payload shape per Resend 2026-05 docs
  - **Path B** (`mapping-table`) — best-effort safety net per Pitfall 17
- Logs which path delivered the cid (`console.info`) OR the
  unrecoverable case (`console.warn` — no throw, still 200)
- Always returns 200 once signature verifies — Resend retries on 5xx
  and we have already accepted the event

### Vitest test (`route.test.ts`) — 7 cases, all passing

```
✓ rejects missing svix-signature header with 401
✓ rejects invalid signature with 401
✓ rejects stale timestamp (>5 min old) with 401
✓ Path A: extracts correlation_id from tags array
✓ Path A': extracts correlation_id from tags dict (defensive fallback)
✓ Path B: falls back to mapping-table lookup when tags absent
✓ logs unrecoverable warning when no path delivers a cid (still 200)
```

Tests use a synthetic `whsec_` secret + `svix.Webhook.sign()` — the
real verify path is exercised, no signature stubbing.

### Pytest RLS assertion (`test_resend_correlation_rls.py`) — 2 cases

```
TestResendCorrelationRls
  test_service_role_can_select   — INSERT + SELECT roundtrip works
  test_anon_role_denied_select   — SET LOCAL ROLE anon → zero rows OR
                                    InsufficientPrivilege (both = pass)
```

Skipif gate via `TEST_SUPABASE_DB_URL`. Without env var: 2 SKIPPED in
~0.06s (verified locally). With env var + migration 098 applied
(Task 5 checkpoint): 2 PASSED.

### Empirical evidence doc

Path: `.planning/phase-16/resend-tag-roundtrip-evidence.md`

Documents the Resend webhook payload shape per their public 2026-05
docs (dict form — Path A'). Empirical capture against live Resend
traffic deferred to first production fire — production traffic with
the round-trip wired in will surface the actual shape via the
`[resend-webhook] correlation_id recovered` log line; the `path`
field of that log line records which of A / A' / B delivered the
cid for each real event.

## Checkpoint Required (Task 5)

**Type:** `checkpoint:human-action`
**Reason:** `supabase db push` against the `qmnijlgmdhviwzwfyzlc` test
project requires `SUPABASE_ACCESS_TOKEN` in the shell env. The
parallel-executor sandbox does not expose Supabase credentials. Auth
gates cannot be auto-resolved by the orchestrator (per `<auto_mode_detection>`).

**To resolve:**

1. Confirm `SUPABASE_ACCESS_TOKEN` is set: `echo "${SUPABASE_ACCESS_TOKEN:+set}"` returns `set`.
2. From repo root: `supabase db push --project-ref qmnijlgmdhviwzwfyzlc`
3. Verify migration 098 applied: `psql "$TEST_SUPABASE_DB_URL" -c "\\d public.resend_message_correlation"` shows the 4 columns + 2 indexes + RLS enabled.
4. Verify RLS denies anon: `psql "$TEST_SUPABASE_DB_URL" -c "SET ROLE anon; SELECT * FROM public.resend_message_correlation LIMIT 1;"` returns 0 rows OR a permission-denied error.
5. Run the live pytest assertion: `cd analytics-service && pytest tests/test_resend_correlation_rls.py -x -q` exits 0 with both tests PASSED (not SKIPPED).
6. If `supabase db push` fails with a drift error: investigate via `supabase db diff` per `.planning/phase-16/migration-drift-resolution.md` (Path C). Do NOT bypass with `--include-all` until reconciled.

**Resume signal:** type `applied` once migration 098 is on the test
project AND the manual RLS deny-anon check AND the pytest RLS
assertion both pass; describe any drift issue encountered.

## Verification

| Check                                     | Result                                       |
| ----------------------------------------- | -------------------------------------------- |
| TypeScript build (`npx tsc --noEmit`)     | clean (exit 0)                               |
| Vitest webhook tests (7 cases)            | 7 passed                                     |
| Vitest full suite (regression check)      | 276 files / 2705 tests passed; 0 failed      |
| Pytest RLS tests (no live DB)             | 2 skipped (skipif clean)                     |
| Pytest RLS tests (with live DB)           | DEFERRED to Task 5 checkpoint                |
| ESLint on changed files                   | clean                                        |
| Banned packages check (`axios`)           | none                                         |
| Migration 098 file shape                  | matches plan (RLS, GRANT, UNIQUE, pg_cron)   |
| 095/096/097 unused (Phase 19 reservation) | confirmed (`ls supabase/migrations/`)        |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `email.test.ts` regression after Task 2 import added**

- **Found during:** Task 2 verification / pre-summary regression check
- **Issue:** `import { getCorrelationId } from "@/lib/correlation-id"` in
  `src/lib/email.ts` (added by Task 2) transitively pulls in
  `import "server-only"` from `correlation-id.ts:1`. The vitest
  jsdom environment trips the `server-only` guard, breaking all 13
  existing email.test.ts cases.
- **Fix:** Added `/** @vitest-environment node */` pragma + two
  `vi.mock()` directives at the top of `email.test.ts` to no-op
  `server-only` and to stub `next/headers` so `getCorrelationId()`
  falls through to `crypto.randomUUID()` cleanly. Same pattern as
  the route.test.ts file in this repo.
- **Files modified:** `src/lib/email.test.ts`
- **Commit:** `82289fb`
- **Verification:** all 13 tests pass; full suite green

**2. [Rule 1 - Comment refactor] `assertSameOrigin` literal in route.ts comment**

- **Found during:** Task 3 acceptance-criteria automated check
- **Issue:** The plan's acceptance criterion is `grep -F 'assertSameOrigin' src/app/api/webhooks/resend/route.ts returns 0 matches`. My initial comment ("NEVER use assertSameOrigin (the webhook is cross-origin by design...)") had the literal substring — even though it documented why we DON'T use it.
- **Fix:** Rephrased the comment to use "CSRF / same-origin guards explicitly DO NOT apply here" — same intent, no literal-string collision with the acceptance grep.
- **Files modified:** `src/app/api/webhooks/resend/route.ts` (squashed into the GREEN commit `ccc1ce8`)

### Auth Gates / Deferred Steps

**1. RESEND_API_KEY unavailable in worktree → empirical capture deferred (Task 6 escape hatch path)**
- **Task:** 6 (`type="auto"`, NOT a checkpoint)
- **Plan-documented escape hatch:** "If the test send cannot be performed at execution time (no RESEND_API_KEY, no test inbox), fill the doc with ASSUMED values from RESEARCH and note explicitly: 'Empirical verification deferred...' Do NOT block this plan on the empirical step — Path B already protects production."
- **Action taken:** Wrote `.planning/phase-16/resend-tag-roundtrip-evidence.md` with the documented Resend 2026-05 payload shape + explicit deferral note + post-deploy verification plan. TODOS.md line records the deferral. Path B safety net means correlation chain is recoverable regardless of empirical confirmation.

**2. SUPABASE_ACCESS_TOKEN unavailable → migration push pending (Task 5 checkpoint)**
- **Task:** 5 (`type="checkpoint:human-action"`, BLOCKING)
- See "Checkpoint Required" section above.

## Threat Flags

None observed. The plan's `<threat_model>` already enumerated 9 STRIDE
threats (T-16-05-01 through T-16-05-09); all are mitigated by the
shipped code. No new surface beyond what the plan anticipated.

## TDD Gate Compliance

Two tasks were `tdd="true"` (Tasks 3 and 4). Task 3 followed the full
RED→GREEN cycle (separate commits `17467c3` test/RED and `ccc1ce8`
feat/GREEN). Task 4 lands as a single test commit (`651c4cd`); the
"GREEN" half is the SQL migration in `85cc8de` which already exists —
the pytest gates the SQL's RLS invariant via skipif until Task 5 brings
the schema live.

Gate sequence on git log:

| Commit    | Type | Subject                                                         |
| --------- | ---- | --------------------------------------------------------------- |
| `384f6be` | chore | add svix dependency for Resend webhook signature verification  |
| `85cc8de` | feat | add migration 098 resend_message_correlation table              |
| `1b6764d` | feat | wire correlation_id tag + Path B mapping insert into email.ts   |
| `17467c3` | test | add failing tests for /api/webhooks/resend (RED)                |
| `ccc1ce8` | feat | implement /api/webhooks/resend with Svix verify (GREEN)         |
| `651c4cd` | test | add RLS-deny pytest assertion for resend_message_correlation    |
| `e347021` | docs | document Resend tag round-trip shape (empirical capture deferred)|
| `82289fb` | fix  | mock server-only + next/headers in email.test.ts (Rule 1)       |

## Self-Check

**Files claimed created — verified:**

- ✓ supabase/migrations/098_resend_message_correlation.sql
- ✓ src/app/api/webhooks/resend/route.ts
- ✓ src/app/api/webhooks/resend/route.test.ts
- ✓ analytics-service/tests/test_resend_correlation_rls.py
- ✓ .planning/phase-16/resend-tag-roundtrip-evidence.md

**Files claimed modified — verified:**

- ✓ package.json + package-lock.json (svix added)
- ✓ src/lib/email.ts (correlation_id tag + Path B helper)
- ✓ src/lib/email.test.ts (server-only / next/headers mocks)
- ✓ .planning/TODOS.md (OBSERV-03 line)

**Commits claimed — verified via `git log --oneline 91a4ec9..HEAD`:** all 8 hashes present.

## Self-Check: PASSED

All claimed deliverables exist on disk; all 8 claimed commits exist in
the worktree branch history. Task 5 remains as a blocking
`checkpoint:human-action` requiring live Supabase credentials.
