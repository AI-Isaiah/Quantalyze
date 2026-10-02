---
phase: 19
slug: unified-backbone-conditional-on-day-2-gate-commit
plan: 05
type: execute
wave: 3
depends_on: [19-02-migrations-103-107, 19-03-ingestion-adapter-protocol, 19-04-process-key-router, 19-06-idempotency-and-process-key-long]
files_modified:
  - src/lib/feature-flags.ts
  - src/app/api/verify-strategy/route.ts
  - src/app/api/verify-strategy/[id]/status/route.ts  # H-1 — status read repoint in PR-A
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/app/api/keys/sync/route.ts
  - src/app/api/strategies/csv-validate/route.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - tests/lib/feature-flags.test.ts
  - tests/integration/process-key-thin-adapters.test.ts
  - VERSION
  - package.json
autonomous: false
requirements: [BACKBONE-01, BACKBONE-04, BACKBONE-05, BACKBONE-10]
must_haves:
  truths:
    - "src/lib/feature-flags.ts ships ~40 LOC TS read seam (kill-switch row + env var, 30s in-process cache, fail-soft on Supabase outage per Pitfall 6)"
    - "All 5 entry routes (verify-strategy, keys/validate-and-encrypt, strategies/finalize-wizard, keys/sync, csv-validate+csv-finalize) gate behind isUnifiedBackboneActive() and delegate to ${ANALYTICS_BASE_URL}/process-key with Authorization: Bearer ${INTERNAL_API_TOKEN} when flag is on"
    - "Each thin adapter preserves the EXISTING legacy code path as a fallback function; flag=off → legacy path runs; flag=on → unified backbone delegation"
    - "VIEW-shim 4-PR sequence ships as 4 SEPARATE PRs (NOT 4 commits in 1 PR per Pitfall 10): commit (a) phase-19-shim-step-a, commit (b) phase-19-shim-step-b, commit (c) phase-19-shim-step-c, commit (d) phase-19-shim-step-d"
    - "scripts/check-phase-19-shim-commits.sh and scripts/verify-no-legacy-writes.sh enforce 4-PR convention + 24h zero-write verification"
    - "finalize-wizard's force-refresh permissions probe (route.ts:60-86 per RESEARCH Open Question 1) is RETAINED at the thin-adapter route layer for scope-broadening defense — moves OUTSIDE the legacy block but INSIDE the unified delegation"
    - "factsheet/[id]/pdf/route.ts is NOT modified — it stays a GET-side reader per Open Question 2 resolution; route-inventory marks it out of scope"
    - "VERSION + package.json bumped together in same commit (per memory: critical-regressions.test.ts will fail otherwise)"
  artifacts:
    - path: "src/lib/feature-flags.ts"
      provides: "Next.js feature flag read seam (mirrors analytics-service/services/feature_flags.py)"
      contains: "isUnifiedBackboneActive"
    - path: "src/app/api/verify-strategy/route.ts"
      provides: "Thin adapter for flow_type=teaser; commit (a) of shim repoints UPDATE to strategy_verifications"
      contains: "isUnifiedBackboneActive"
    - path: "src/app/api/keys/sync/route.ts"
      provides: "Thin adapter for flow_type=resync"
      contains: "flow_type: \"resync\""
    - path: "src/app/api/strategies/finalize-wizard/route.ts"
      provides: "Thin adapter for flow_type=onboard (finalize step) with force-refresh probe retained"
      contains: "isUnifiedBackboneActive"
    - path: "src/app/api/keys/validate-and-encrypt/route.ts"
      provides: "Thin adapter for flow_type=onboard (validate step)"
      contains: "isUnifiedBackboneActive"
    - path: "src/app/api/strategies/csv-validate/route.ts"
      provides: "Thin adapter for flow_type=csv (validate step) — re-routes from /csv/validate to /process-key"
      contains: "/process-key"
    - path: "src/app/api/strategies/csv-finalize/route.ts"
      provides: "Thin adapter for flow_type=csv (finalize step) — re-routes from /csv/finalize to /process-key"
      contains: "/process-key"
  key_links:
    - from: "5 thin adapter routes"
      to: "POST ${ANALYTICS_BASE_URL}/process-key"
      via: "fetch with Authorization: Bearer ${INTERNAL_API_TOKEN} + X-Correlation-Id"
      pattern: "/process-key"
    - from: "isUnifiedBackboneActive"
      to: "Supabase feature_flags table + PROCESS_KEY_UNIFIED_BACKBONE env var"
      via: "30s cache, kill-switch wins over env=on"
      pattern: "process_key_unified_backbone"
    - from: "phase-19-shim-step-a commit"
      to: "src/app/api/verify-strategy/route.ts:115"
      via: "UPDATE target repointed from verification_requests → strategy_verifications"
      pattern: "strategy_verifications"
---

<objective>
Ship the 5 thin Next.js adapters (BACKBONE-10 unification) + the TS feature
flag read seam (BACKBONE-05) + the VIEW-shim 4-PR sequence (BACKBONE-04).

This plan is Wave 3: depends on P2 (schema substrate), P3 (adapter Protocol),
P4 (router contract), P6 (process_key_long worker handler). Cannot ship until
all four foundations exist.

**Critical operational requirement:** the 4-PR VIEW-shim sequence MUST ship
as **4 separate Pull Requests**, NOT 4 commits in 1 PR (Pitfall 10 — squash-merge
collapses commits). Plan-checker enforces this via:
- commit message regex `^phase-19-shim-step-(a|b|c|d):`
- branch state at each PR — only one of a/b/c/d touched per PR
- commit timestamp delta — commit (b) flag-flip → commit (d) rename ≥168h calendar

**The 4-PR sequence:**
- **PR-A `phase-19-shim-step-a:`** — Migration 106 sentinel (already in P2 as
  the file but applied here) + repoint of `verify-strategy/route.ts:115` UPDATE
  from `verification_requests` to `strategy_verifications` AND status-read repoint
  of `verify-strategy/[id]/status/route.ts` SELECT. NO flag flip yet.

  **C-5 (NOT NULL + FK):** the original `verification_requests` UPDATE only set
  `public_token` + `expires_at` on an existing row. The new `strategy_verifications`
  schema requires `wizard_session_id NOT NULL`, `trust_tier NOT NULL`, `flow_type NOT NULL`,
  `source NOT NULL`, `strategy_id NOT NULL` (FK with ON DELETE CASCADE) per migration
  093 lines 79-93. PR-A's write path MUST construct an INSERT-or-UPDATE upsert that
  populates ALL required NOT NULLs with valid values, AND ensure the strategy_id FK
  resolves (create the parent strategy row first if absent). Without C-5, every
  teaser submission post-repoint produces SQLSTATE 23502 / 23503 violations.

  **H-1 (status read repoint):** `verify-strategy/[id]/status/route.ts` SELECTs
  `id, status, public_token, expires_at, results FROM verification_requests`.
  Post-PR-A the write goes to `strategy_verifications`, so without repointing the
  read in the same PR, status checks return 404 or stale data for the entire
  PR-C 7-day window. Repoint the SELECT to `strategy_verifications` (or its VIEW
  surface — but the VIEW only ships in PR-D so SELECTing the underlying table is
  required during PR-A→PR-D). Add a status round-trip integration test:
  POST /api/verify-strategy → GET /api/verify-strategy/{id}/status → assert 200
  with the public_token set by PR-A's write path.

  **Test (PR-A):** new vitest test file asserts (a) `.from("strategy_verifications").upsert({...})`
  with all 5 NOT NULL fields populated, (b) status round-trip POST→GET returns 200
  with matching public_token. Run against the test Supabase project with a real
  strategy_id FK target (via setup fixture).
- **PR-B `phase-19-shim-step-b:`** — Flip `PROCESS_KEY_UNIFIED_BACKBONE=on` on
  Vercel + Railway production. NO code changes; commit body documents the
  env-var rollout + records `flag_flipped_at` ISO-8601 UTC timestamp into
  `.planning/phase-19/stability-log.md`. Optional: a `vercel env add` script
  in `scripts/` for repeatability.
- **PR-C `phase-19-shim-step-c:`** — 7-calendar-day stability window VERIFICATION
  step. Commit lands ≥168h after commit (b). Founder runs
  `scripts/verify-no-legacy-writes.sh` (this plan ships it) which greps Supabase
  audit log + Sentry events for any write to `verification_requests` table since
  flag-flip; commit message records the verification timestamp + zero-writes
  evidence link. Daily updates `.planning/phase-19/stability-log.md` with
  Sentry error-envelope rate per day (must stay < 0.5% per BACKBONE-04 exit
  criteria). Daily `scripts/repro-key-flow.sh` cassette refresh per Theme 5.
- **PR-D `phase-19-shim-step-d:`** — Migration 107 (rename + VIEW + INSTEAD OF
  triggers) applied via Supabase MCP `mcp__supabase__apply_migration`. Old
  `verification_requests` table becomes read-only (90-day RLS retention); new
  writes only land in `strategy_verifications`.

**Other shim mechanics (per CONTEXT.md L23-26 + RESEARCH §P5 L1199-1213):**
- Each PR commit message MUST start with the literal prefix
  `phase-19-shim-step-{a|b|c|d}:`. The plan-checker grep at Phase 19 exit
  asserts: `git log --format='%s' phase-19-start..HEAD | grep -c '^phase-19-shim-step-[abcd]:'` returns 4.
- Each PR ships its own VERSION + package.json bump (memory: critical-regressions
  test fails on drift).

**Other notes (per RESEARCH §P5 L1192-1197):**
- `factsheet/[id]/pdf/route.ts` is GET-only and reads `strategies + strategy_analytics`
  — NOT modified per Open Question 2 resolution. The route-inventory marks it
  out of scope.
- `csv-validate` and `csv-finalize` are already thin post-Phase 15; this plan
  re-routes their internal target from `/csv/validate` and `/csv/finalize` on
  analytics-service to `/process-key` with `flow_type='csv'`.
- `finalize-wizard/route.ts:60-86` force-refresh permissions probe is RETAINED
  at the thin-adapter route layer per Open Question 1 — preserves scope-broadening
  defense, runs BEFORE the /process-key delegation.

Purpose: Ships the unified backbone to production behind a feature flag with
auto-rollback, 7-day stability window, and a documented manual fallback runbook
(P1 ships rollback-runbook.md). Wave 3 — last code-shipping plan.

Output: 7 thin adapter route files (1 new feature-flags.ts + 6 modified routes)
+ 2 vitest stub files + VERSION/package.json bumps + 1 verify-no-legacy-writes
script.

Tracking: BACKBONE-01 (delegate-to-/process-key shape), BACKBONE-04 (VIEW-shim
4-PR sequence), BACKBONE-05 (TS feature flag seam + 7-day stability),
BACKBONE-10 (5 routes become thin adapters).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md
@.planning/phase-19/route-inventory.md
@.planning/phase-19/migration-plan.md
@.planning/phase-19/rollback-runbook.md
@.planning/phase-19/stability-log.md
@DESIGN.md
@AGENTS.md
@CLAUDE.md
@src/lib/supabase/admin.ts
@src/lib/correlation-id.ts
@src/lib/timing-safe-compare.ts
@src/app/api/verify-strategy/route.ts
@src/app/api/keys/validate-and-encrypt/route.ts
@src/app/api/strategies/finalize-wizard/route.ts
@src/app/api/keys/sync/route.ts
@src/app/api/strategies/csv-validate/route.ts
@src/app/api/strategies/csv-finalize/route.ts

<interfaces>
<!-- Existing helpers + endpoints this plan wires through. -->

From `analytics-service/routers/process_key.py` (P4):
- POST /process-key body: `{flow_type: 'teaser'|'onboard'|'internal_report'|'csv'|'resync', source: 'okx'|'binance'|'bybit'|'csv', context: dict}`
- Header: `Authorization: Bearer ${INTERNAL_API_TOKEN}`, `X-Correlation-Id: <uuid>`, `Content-Type: application/json`
- Response (sync): VerificationResult JSON; (queued): `{queued: true, verification_id, correlation_id}`
- 503 on flag off: `{detail: {code: 'UNIFIED_BACKBONE_DISABLED', human_message, correlation_id}}`

From `src/lib/correlation-id.ts`:
- `getCorrelationId(): Promise<string>` — auto-thread inbound x-correlation-id

From `src/lib/supabase/admin.ts`:
- `createAdminClient()` — service-role client for server-side reads of feature_flags

From `src/app/api/verify-strategy/route.ts:114-117` (PR-A modifies this):
- existing: `await admin.from("verification_requests").update({...}).eq("id", id);`
- target: `await admin.from("strategy_verifications").update({...}).eq("id", id);`
  (the public_token / status fields move to first-class columns added by migration 103)

From `src/app/api/strategies/finalize-wizard/route.ts:60-86` (force-refresh probe — Open Question 1):
- The probe block does an additional `GET /api/keys/[id]/permissions` BEFORE finalizing to defend against scope-broadening between Connect and Submit.
- This block stays at the thin-adapter layer (NOT pushed into IngestionAdapter.validate per Open Question 1 recommendation) — runs BEFORE /process-key fetch.

Memory rule: per `feedback_version_bump_both_files.md`, every commit on this
plan MUST update `VERSION` and `package.json` together.

Existing crons in `vercel.json` (NOT modified by this plan; P7 adds flag-monitor):
- warm-analytics, alert-digest, cleanup-wizard-drafts, sync-funding,
  reconcile-strategies, cleanup-ack-tokens, founder-lp-report
</interfaces>
</context>

<no_git_branch_ops>
You are running on branch `v1.0.0-phase-19-unified-backbone`. Do NOT run
`git checkout`, `git pull`, `git fetch`, `git switch`, `git reset`, or any other
command that changes branches or pulls remote state. No commits, no pushes
from this plan's executor — the 4 PRs are gated through human review per
`feedback_post_impl_workflow.md` and `feedback_ship_landdeploy_review_sections.md`
(use the project's standard `/ship` workflow for each PR).
If you need to verify the branch, use `git rev-parse --abbrev-ref HEAD` (read-only).
</no_git_branch_ops>

<tasks>

<task id="P5-1" type="auto" tdd="true">
  <name>Task 1: Write src/lib/feature-flags.ts (TS read seam — mirrors Python feature_flags.py)</name>
  <files>src/lib/feature-flags.ts, tests/lib/feature-flags.test.ts</files>
  <read_first>
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 1097-1135 — TS read seam blueprint)
    - src/lib/supabase/admin.ts (full file — createAdminClient signature)
    - vitest.config.ts (verify test config + coverage thresholds)
    - analytics-service/services/feature_flags.py (P4 Task 1 — mirror behavior)
  </read_first>
  <behavior>
    - Test 1 (test_env_on_kill_switch_off_returns_off): When env=on AND kill_switch=off, returns false (kill-switch wins).
    - Test 2 (test_env_on_kill_switch_on_returns_on): When env=on AND kill_switch=on (or no row), returns true.
    - Test 3 (test_env_off_kill_switch_on_returns_off): When env=off, returns false regardless.
    - Test 4 (test_supabase_outage_falls_back_to_env): When createAdminClient throws, function falls through to env value.
    - Test 5 (test_30s_cache): Two consecutive calls within 30s read from cache (mock supabase to count calls).
    - Test 6 (test_resetCacheForTests): _resetCacheForTests() clears the cache between tests.
  </behavior>
  <action>
Create `src/lib/feature-flags.ts`:

```typescript
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Phase 19 / BACKBONE-05 — Next.js feature flag read seam.
 *
 * Mirrors analytics-service/services/feature_flags.py. Reads Supabase
 * kill-switch row first; falls back to PROCESS_KEY_UNIFIED_BACKBONE env var
 * on outage. 30s in-process cache.
 *
 * Fail-soft: when Supabase is unreachable, env var decides. Sustained outages
 * surface in Sentry via the warn() log path.
 */

const CACHE_TTL_MS = 30_000;
let _cache: { value: boolean; expiresAt: number } | null = null;

export async function isUnifiedBackboneActive(): Promise<boolean> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.value;

  let killSwitchOff = false;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("feature_flags")
      .select("value")
      .eq("flag_key", "process_key_unified_backbone")
      .maybeSingle();
    if (data?.value === "off") killSwitchOff = true;
  } catch (err) {
    // Don't block on Supabase outage; fall through to env var.
    // Logged at WARN so Sentry sees sustained outages.
    console.warn("[feature-flags] kill-switch read failed:", err);
  }

  const envValue = process.env.PROCESS_KEY_UNIFIED_BACKBONE === "on";
  const value = envValue && !killSwitchOff;

  _cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/** Test-only: clear the in-process cache. Do NOT call from production code. */
export function _resetCacheForTests(): void {
  _cache = null;
}
```

Then create `tests/lib/feature-flags.test.ts` (Vitest) with the 6 tests above. Use `vi.mock('@/lib/supabase/admin', ...)` to inject controlled responses; use `vi.spyOn(Date, 'now')` to mock the clock for the 30s cache test. Reset module state between tests via `_resetCacheForTests()` from `beforeEach`.

Test skeleton (use existing tests/lib/* pattern for layout):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isUnifiedBackboneActive, _resetCacheForTests } from "@/lib/feature-flags";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";

describe("isUnifiedBackboneActive", () => {
  beforeEach(() => {
    _resetCacheForTests();
    vi.clearAllMocks();
    delete process.env.PROCESS_KEY_UNIFIED_BACKBONE;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 6 tests follow...
});
```
  </action>
  <acceptance_criteria>
    - File `src/lib/feature-flags.ts` exists with `isUnifiedBackboneActive` async function
    - `grep -q 'export async function isUnifiedBackboneActive' src/lib/feature-flags.ts`
    - `grep -q 'CACHE_TTL_MS = 30_000' src/lib/feature-flags.ts`
    - `grep -q 'process_key_unified_backbone' src/lib/feature-flags.ts`
    - `grep -q 'PROCESS_KEY_UNIFIED_BACKBONE' src/lib/feature-flags.ts`
    - `grep -q '_resetCacheForTests' src/lib/feature-flags.ts`
    - File `tests/lib/feature-flags.test.ts` exists with 6 test functions
    - `npx vitest run tests/lib/feature-flags.test.ts` exits 0
  </acceptance_criteria>
  <automated>
    npx vitest run tests/lib/feature-flags.test.ts --reporter=basic
  </automated>
  <requirements>BACKBONE-04, BACKBONE-05</requirements>
</task>

<task id="P5-2" type="auto" tdd="true">
  <name>Task 2: Convert 5 entry routes to thin adapters with feature-flag gate (NOT yet PR-A repoint)</name>
  <files>src/app/api/verify-strategy/route.ts, src/app/api/keys/validate-and-encrypt/route.ts, src/app/api/strategies/finalize-wizard/route.ts, src/app/api/keys/sync/route.ts, src/app/api/strategies/csv-validate/route.ts, src/app/api/strategies/csv-finalize/route.ts, tests/integration/process-key-thin-adapters.test.ts</files>
  <read_first>
    - src/app/api/verify-strategy/route.ts (FULL file — preserve existing CSRF + IP rate-limit + verification_requests UPDATE at L114-117)
    - src/app/api/keys/validate-and-encrypt/route.ts (FULL file — short ~38 LOC; `withAuth` wrapper)
    - src/app/api/strategies/finalize-wizard/route.ts (FULL file — pay attention to L60-86 force-refresh permissions probe per Open Question 1)
    - src/app/api/keys/sync/route.ts (FULL file — USE_COMPUTE_JOBS_QUEUE flag + `after()` legacy path)
    - src/app/api/strategies/csv-validate/route.ts + csv-finalize/route.ts (Phase 15 thin shape)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 1137-1196 — thin adapter pattern + per-route notes; L1217-1221 csv special case + factsheet exclusion)
    - src/lib/correlation-id.ts (full file — getCorrelationId signature)
  </read_first>
  <behavior>
    - Test 1 (test_keys_sync_flag_on_delegates): With flag=on, POST /api/keys/sync sends fetch to ${ANALYTICS_BASE_URL}/process-key with flow_type=resync, X-Correlation-Id present, Authorization Bearer token.
    - Test 2 (test_keys_sync_flag_off_legacy): With flag=off, POST /api/keys/sync runs legacy path (existing route.ts L46-213 body — preserved).
    - Test 3 (test_finalize_wizard_force_refresh_runs_first): With flag=on, the force-refresh permissions probe at L60-86 runs BEFORE the /process-key delegation (verify call order via mock).
    - Test 4 (test_verify_strategy_flag_on_delegates_teaser): flag_type='teaser', source derived from request body (okx|binance|bybit).
    - Test 5 (test_keys_validate_and_encrypt_flag_on_delegates_onboard): flow_type='onboard'.
    - Test 6 (test_csv_validate_re_routes_to_process_key): flow_type='csv', source='csv'; existing /csv/validate target replaced by /process-key.
    - Test 7 (test_csv_finalize_re_routes_to_process_key): flow_type='csv', source='csv'; existing /csv/finalize target replaced.
  </behavior>
  <action>
**This task does NOT yet land PR-A's UPDATE repoint.** It only converts routes
to dual-path (legacy + unified) shape. PR-A is Task 3 below.

For each of the 5 entry routes (and the 2 csv routes), apply the SAME pattern:

1. Read the FULL existing file. Identify the existing handler's body — that's
   `legacy{Name}Handler`.
2. Add an `isUnifiedBackboneActive` import at top.
3. At handler entry, branch on `await isUnifiedBackboneActive()`. If `false`,
   call `legacy{Name}Handler(req, ...)`.
4. If `true`, fetch `${ANALYTICS_BASE_URL}/process-key` with the required
   `flow_type`, derive `source` from request payload, set `Authorization`
   bearer + `X-Correlation-Id`.
5. Pass-through response.

**Pattern (use for keys/sync, validate-and-encrypt, verify-strategy, finalize-wizard):**

```typescript
// Phase 19 / BACKBONE-{NN} — thin adapter pattern.
import { NextRequest, NextResponse } from "next/server";
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { getCorrelationId } from "@/lib/correlation-id";

const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN;

export const maxDuration = 300;

// Existing wrappers (e.g., withAuth) preserved verbatim.
export const POST = withAuth(async (req: NextRequest, user) => {
  // Phase 19 / BACKBONE-05 — gate behind flag.
  if (!(await isUnifiedBackboneActive())) {
    return await legacyKeysSyncHandler(req, user);
  }

  const body = await req.json();
  const correlationId = await getCorrelationId();
  const res = await fetch(`${ANALYTICS_URL}/process-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${INTERNAL_TOKEN}`,
      "X-Correlation-Id": correlationId,
    },
    body: JSON.stringify({
      flow_type: "resync",         // per-route: teaser | onboard | csv | resync
      source: body.source ?? "okx", // derive from body or strategies join
      context: {
        ...body,
        user_id: user.id,
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(err, { status: res.status });
  }
  return NextResponse.json(await res.json());
});

async function legacyKeysSyncHandler(req: NextRequest, user: any): Promise<NextResponse> {
  // ... existing handler body verbatim — copied from current route.ts ...
}
```

**Per-route specifics:**

| Route | flow_type | source | Special handling |
|-------|-----------|--------|------------------|
| `verify-strategy/route.ts` | `teaser` | from `body.exchange` (okx/binance/bybit) | Public unauthenticated route; preserve CSRF + IP rate-limit BEFORE flag check; legacy handler keeps existing flow |
| `keys/validate-and-encrypt/route.ts` | `onboard` | from `body.source` | `withAuth` wrapper preserved |
| `strategies/finalize-wizard/route.ts` | `onboard` | derived from `strategies.api_keys.exchange` SELECT | **Force-refresh permissions probe (route.ts:60-86) runs BEFORE the /process-key fetch in the unified path** — preserves scope-broadening defense per Open Question 1 |
| `keys/sync/route.ts` | `resync` | derived from `strategies.api_keys.exchange` | Existing USE_COMPUTE_JOBS_QUEUE legacy stays in `legacyKeysSyncHandler` |
| `strategies/csv-validate/route.ts` | `csv` | `csv` | Re-target from existing /csv/validate to /process-key; payload reshape: `{flow_type:'csv', source:'csv', context:{raw_bytes, fmt, ...}}` |
| `strategies/csv-finalize/route.ts` | `csv` | `csv` | Same; replaces /csv/finalize call |

**finalize-wizard probe specifics (Open Question 1 — RETAINED at thin-adapter layer):**

```typescript
export const POST = withAuth(async (req: NextRequest, user) => {
  if (!(await isUnifiedBackboneActive())) {
    return await legacyFinalizeWizardHandler(req, user);
  }

  // Phase 19 / Open Question 1 — force-refresh permissions probe RETAINED at the
  // thin-adapter layer for scope-broadening defense. Runs BEFORE /process-key
  // delegation. Body block copied from existing route.ts L60-86.
  // ... probe code verbatim, surfaces ProbeError envelope on failure ...

  // Then delegate
  const correlationId = await getCorrelationId();
  // ... fetch /process-key ...
});
```

**factsheet/[id]/pdf/route.ts is NOT modified** per Open Question 2 resolution
(GET-only PDF reader; reads strategies + strategy_analytics; no /process-key call needed).

Then create `tests/integration/process-key-thin-adapters.test.ts` (vitest) with the 7 test cases above. Use `vi.mock('@/lib/feature-flags')` to control flag state; mock `fetch` globally to inspect outbound calls; verify request shape (headers + body keys).
  </action>
  <acceptance_criteria>
    - All 6 entry-route files modified to import `isUnifiedBackboneActive` from `@/lib/feature-flags`
    - Each modified route file has both legacy fallback AND unified delegation paths
    - `grep -l 'isUnifiedBackboneActive' src/app/api/verify-strategy/route.ts src/app/api/keys/validate-and-encrypt/route.ts src/app/api/strategies/finalize-wizard/route.ts src/app/api/keys/sync/route.ts src/app/api/strategies/csv-validate/route.ts src/app/api/strategies/csv-finalize/route.ts | wc -l` returns 6
    - `grep -q 'flow_type: "resync"' src/app/api/keys/sync/route.ts`
    - `grep -q 'flow_type: "teaser"' src/app/api/verify-strategy/route.ts`
    - `grep -q 'flow_type: "onboard"' src/app/api/strategies/finalize-wizard/route.ts`
    - `grep -q 'flow_type: "onboard"' src/app/api/keys/validate-and-encrypt/route.ts`
    - `grep -q 'flow_type: "csv"' src/app/api/strategies/csv-validate/route.ts`
    - `grep -q 'flow_type: "csv"' src/app/api/strategies/csv-finalize/route.ts`
    - **factsheet/pdf NOT modified:** `! git diff --name-only main...HEAD | grep -q 'factsheet/.id./pdf/route.ts'` (this route is OUT OF SCOPE per Open Question 2)
    - `grep -q 'Phase 19 / Open Question 1' src/app/api/strategies/finalize-wizard/route.ts` (force-refresh probe retained at thin-adapter layer)
    - File `tests/integration/process-key-thin-adapters.test.ts` exists with 7 test functions
    - `npx vitest run tests/integration/process-key-thin-adapters.test.ts` exits 0
  </acceptance_criteria>
  <automated>
    bash -c 'grep -q isUnifiedBackboneActive src/app/api/keys/sync/route.ts && grep -q "flow_type: \"resync\"" src/app/api/keys/sync/route.ts && grep -q "flow_type: \"teaser\"" src/app/api/verify-strategy/route.ts && grep -q "flow_type: \"onboard\"" src/app/api/strategies/finalize-wizard/route.ts && grep -q "Phase 19 / Open Question 1" src/app/api/strategies/finalize-wizard/route.ts && grep -q "flow_type: \"csv\"" src/app/api/strategies/csv-validate/route.ts && test -f tests/integration/process-key-thin-adapters.test.ts && npx vitest run tests/integration/process-key-thin-adapters.test.ts --reporter=basic'
  </automated>
  <requirements>BACKBONE-01, BACKBONE-04, BACKBONE-10</requirements>
</task>

<task id="P5-3" type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Ship VIEW-shim 4-PR sequence (PR-A → PR-B → PR-C → PR-D)</name>
  <what-built>Tasks 1+2 produced the feature-flags module + dual-path thin adapters but did NOT yet repoint `verify-strategy/route.ts:115` UPDATE, did NOT flip the production flag, did NOT apply migration 107. Those are the load-bearing operational changes that ship as 4 separate PRs over ≥7 calendar days.</what-built>
  <how-to-verify>
The 4-PR sequence is executed by the human user via the project's standard `/ship` workflow, NOT by an AI executor in a single session. Each PR has its own commit-message convention `phase-19-shim-step-{a|b|c|d}:` enforced by `scripts/check-phase-19-shim-commits.sh`. Steps:

**PR-A (`phase-19-shim-step-a:`) — repoint UPDATE + repoint status read + apply migration 106 sentinel:**

**C-5 + H-1 mandate:** PR-A repoints BOTH the write (verify-strategy/route.ts:114-117) AND the read (verify-strategy/[id]/status/route.ts), AND constructs a row that satisfies all NOT NULL + FK constraints on `strategy_verifications`.

1. Edit `src/app/api/verify-strategy/route.ts` near L114-117. Convert the bare UPDATE to an INSERT-or-UPDATE upsert. Fields populated MUST include all 5 NOT NULLs from migration 093: `strategy_id`, `wizard_session_id`, `trust_tier`, `flow_type`, `source`. Example shape (adapt to actual route logic):

   ```typescript
   // C-5 — strategy_verifications has 5 NOT NULL fields + FK strategy_id ON DELETE CASCADE.
   // PR-A constructs a complete row before persist; missing any NOT NULL produces SQLSTATE 23502.
   const { data: strategy } = await admin
     .from("strategies")
     .select("id")
     .eq("id", body.strategy_id)
     .maybeSingle();
   if (!strategy) {
     return NextResponse.json(
       { error: "Strategy not found", code: "STRATEGY_NOT_FOUND" },
       { status: 404 },
     );
   }
   const { error: upsertError } = await admin
     .from("strategy_verifications")
     .upsert(
       {
         id: verificationId,                    // existing UUID from teaser session
         strategy_id: body.strategy_id,         // FK target — verified above
         wizard_session_id: body.wizard_session_id ?? crypto.randomUUID(),
         status: "validated",
         trust_tier: "self_reported",            // teaser flow uses self-reported
         flow_type: "teaser",
         source: body.exchange ?? "okx",
         public_token: publicToken,
         expires_at: expiresAt,
       },
       { onConflict: "id" },
     );
   if (upsertError) {
     console.error("[verify-strategy] PR-A upsert failed:", upsertError);
     return NextResponse.json({ error: "Failed to finalize verification" }, { status: 500 });
   }
   ```

2. Edit `src/app/api/verify-strategy/[id]/status/route.ts` (H-1): repoint the SELECT from `verification_requests` to `strategy_verifications`. Field selection unchanged: `id, status, public_token, expires_at, results` — but `results` maps to `metrics_snapshot` on the new table (the legacy column name is preserved through the migration 107 VIEW; pre-PR-D you must `select` `metrics_snapshot AS results` or rename the consumer's field reference).

3. Apply migration 106 via Supabase MCP: `mcp__supabase__apply_migration` with project_id `qmnijlgmdhviwzwfyzlc` (sentinel only — no schema change).

4. Add new vitest test files:
   - `tests/integration/phase-19-pra-write.test.ts` — posts a real teaser submission against the test Supabase project; asserts a complete `strategy_verifications` row lands with all 5 NOT NULLs populated and FK valid (C-5).
   - `tests/integration/phase-19-pra-status-roundtrip.test.ts` — POST → GET status → 200 with matching `public_token` (H-1 round-trip proof).

5. Bump VERSION + package.json (per memory rule).

6. Commit with subject `phase-19-shim-step-a: repoint verify-strategy upsert + status read + migration 106 sentinel`. Use `/ship` workflow → PR-A merges to main.

**PR-B (`phase-19-shim-step-b:`) — flip the flag:**
1. NO code changes in this PR (or only a config script).
2. On Vercel + Railway production, set `PROCESS_KEY_UNIFIED_BACKBONE=on`. Verify via `vercel env ls` + Railway dashboard.
3. Update `.planning/phase-19/stability-log.md` with the exact `flag_flipped_at` ISO-8601 UTC timestamp.
4. Bump VERSION + package.json.
5. Commit with subject `phase-19-shim-step-b: flip PROCESS_KEY_UNIFIED_BACKBONE=on production` and body listing the timestamp + the .env.example entries documenting the flag.
6. Use `/ship` → PR-B merges.

**PR-C (`phase-19-shim-step-c:`) — 7-day stability verification:**
1. Wait ≥168h calendar from PR-B's `flag_flipped_at` timestamp.
2. Each day during the wait, append a row to `.planning/phase-19/stability-log.md` with the Sentry error-envelope rate (must stay < 0.5%), and run `scripts/repro-key-flow.sh` against OKX + Bybit cassettes (Theme 5).
3. Run `scripts/verify-no-legacy-writes.sh` (this task ships it — see below). Greps Supabase audit log + Sentry events for any write to `verification_requests` table since `flag_flipped_at`. Output: zero rows = pass.
4. Bump VERSION + package.json (the bump itself is the deliverable for PR-C).
5. Commit with subject `phase-19-shim-step-c: verify zero legacy writes over 168h stability window`. Body links to the verification output + stability-log entries.
6. Use `/ship` → PR-C merges.

**PR-D (`phase-19-shim-step-d:`) — apply migration 107 (rename + VIEW + INSTEAD OF triggers):**
1. Apply migration 107 via Supabase MCP: `mcp__supabase__apply_migration` against `qmnijlgmdhviwzwfyzlc`. Migration body is the rename + VIEW + 3 INSTEAD OF triggers.
2. Run `mcp__supabase__execute_sql` to verify: `SELECT count(*) FROM information_schema.views WHERE table_name='verification_requests'` → 1; `SELECT count(*) FROM information_schema.tables WHERE table_name='verification_requests_legacy'` → 1.
3. Bump VERSION + package.json.
4. Commit with subject `phase-19-shim-step-d: rename + VIEW + INSTEAD OF triggers (migration 107)`.
5. Use `/ship` → PR-D merges.

**After all 4 PRs merge:**
- `bash scripts/check-phase-19-shim-commits.sh` exits 0 (4 commits with prefixes a/b/c/d in order).
- `git log --format='%s' --grep '^phase-19-shim-step' | wc -l` returns 4.

**Also as part of this task, ship `scripts/verify-no-legacy-writes.sh` AND a Postgres trigger logging legacy writes (H-8):**

**H-8 fix:** the original draft was advisory only — the founder ran the script daily during the stability window. This was insufficient because forgotten internal scripts, Phase 15 CSV codepath, or RLS bypasses could write to the legacy table without the script noticing. H-8 promotes the check to a CI gate AND adds a Postgres trigger that logs to `audit_log` on any direct write to `verification_requests` post-PR-B.

**(1) Postgres trigger ships in PR-B as a SQL migration sub-step (or as a separate migration `108_legacy_write_audit_trigger.sql`):**

```sql
-- H-8 — Phase 19 / BACKBONE-04 stability window write-detection trigger.
-- Logs to audit_log on any direct write to verification_requests post-PR-B.
-- Plan-checker reads audit_log entries during the 168h stability window;
-- a non-zero count blocks PR-D.
CREATE OR REPLACE FUNCTION verification_requests_post_phase19_write_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM log_audit_event(
    'verification_requests_legacy_write',
    NEW.id,
    NULL,  -- no correlation_id available at trigger boundary
    TG_OP,
    jsonb_build_object('triggered_at', now(), 'op', TG_OP)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verification_requests_post_phase19_audit ON verification_requests;
CREATE TRIGGER verification_requests_post_phase19_audit
  AFTER INSERT OR UPDATE OR DELETE ON verification_requests
  FOR EACH ROW
  EXECUTE FUNCTION verification_requests_post_phase19_write_audit();
```

(Ships in the migration body of PR-B's commit; no new migration slot is required if the migration plan slot 108 is reserved.)

**(2) `scripts/verify-no-legacy-writes.sh` updated to query audit_log via Supabase MCP:**

```bash
#!/usr/bin/env bash
# Phase 19 / BACKBONE-04 step (c) / H-8 — verify zero writes to verification_requests
# since flag_flipped_at timestamp. CI cron runs hourly during stability window.
set -euo pipefail

STABILITY_LOG=".planning/phase-19/stability-log.md"
if [[ ! -f "$STABILITY_LOG" ]]; then
  echo "FAIL: $STABILITY_LOG missing." >&2
  exit 1
fi

FLIP_TS=$(grep -E '^- \*\*flag_flipped_at:\*\*' "$STABILITY_LOG" | head -1 | sed -E 's/^- \*\*flag_flipped_at:\*\* +//')
if [[ -z "$FLIP_TS" || "$FLIP_TS" == "TODO"* ]]; then
  echo "FAIL: flag_flipped_at not yet recorded in $STABILITY_LOG; cannot proceed." >&2
  exit 2
fi

echo "Verifying no writes to verification_requests since $FLIP_TS"
# Use the H-8 trigger audit rows; this is now blocking, not advisory.
QUERY="SELECT count(*) AS cnt FROM audit_log WHERE entity_type='verification_requests_legacy_write' AND created_at > '$FLIP_TS'::timestamptz;"
echo "Run via Supabase MCP:"
echo "  mcp__supabase__execute_sql --project-id qmnijlgmdhviwzwfyzlc --query \"$QUERY\""
echo ""
echo "Expected output: count = 0. If non-zero, PR-D MUST NOT ship — investigate the write source via correlation_id grep + Sentry."
echo "Stability-log expectation: 168 contiguous clean hours with the count remaining 0."
echo "Cron entry should run this hourly via .github/workflows/phase-19-stability.yml during the stability window."
```

**(3) GitHub Actions cron `.github/workflows/phase-19-stability.yml`:**
```yaml
# H-8 — hourly CI cron during Phase 19 stability window.
# Blocks PR-D candidate if any legacy write detected in the 168h window.
name: Phase 19 stability — no legacy writes
on:
  schedule: [{cron: "0 * * * *"}]   # hourly
  workflow_dispatch:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash scripts/verify-no-legacy-writes.sh
        env:
          SUPABASE_PROJECT_ID: qmnijlgmdhviwzwfyzlc
```

**(4) PR-D blocking logic** — `scripts/check-phase-19-shim-commits.sh` already enforces 168h delta (H-7 fix). H-8 adds: PR-D candidate workflow runs `verify-no-legacy-writes.sh` AND asserts the cron has produced 168 contiguous green runs since `flag_flipped_at`. Encode the assertion as a CI step in the PR-D ship workflow.

Make script executable: `chmod +x scripts/verify-no-legacy-writes.sh`.
  </how-to-verify>
  <resume-signal>After PR-D merges and `bash scripts/check-phase-19-shim-commits.sh` exits 0, type "shim sequence complete". If the human discovers issues during the 7-day window (e.g., > 0.5% error rate, non-zero legacy writes), pause the shim and run `.planning/phase-19/rollback-runbook.md`.</resume-signal>
  <requirements>BACKBONE-04, BACKBONE-05, BACKBONE-10</requirements>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → Next.js thin adapter | wizard/cron payload; existing CSRF + IP rate-limit retained on public routes (verify-strategy) |
| Next.js → /process-key on Railway | INTERNAL_API_TOKEN bearer; X-Correlation-Id thread; HTTPS |
| Migration 107 → legacy verification_requests | one-shot rename + RLS; no rollback path without operational re-rename |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-23 | Tampering | feature-flag bypass via direct env access | mitigate | Both Vercel + Railway require `PROCESS_KEY_UNIFIED_BACKBONE=on` AND kill-switch row not 'off'; fail-closed on Supabase outage (treats outage as no kill-switch override; env decides — defensive default) |
| T-19-24 | Tampering | bypass /process-key auth via direct route call | mitigate | INTERNAL_API_TOKEN constant-time compare on /process-key router (P4); thin adapters always pass the bearer header from server-side env var (never client-exposed) |
| T-19-25 | Tampering | shim PR squash-merge collapses 4 commits | mitigate | scripts/check-phase-19-shim-commits.sh enforces commit-message convention; the 4 PRs are reviewed/merged separately per Pitfall 10; squash via GitHub default disabled in branch protection (verify before PR-A) |
| T-19-26 | Information disclosure | INTERNAL_API_TOKEN leakage in client bundle | mitigate | Server-only env var; thin adapter routes use it only inside route handlers (Edge runtime would expose to client — these routes use Node runtime per existing pattern) |
| T-19-27 | DoS | flag flip mid-execution split-brain (in-flight requests at flip time) | accept | Sync /process-key calls already past flag check at flip moment continue; cache TTL 30s means new requests pick up new flag within 30s; queued work uses drain semantics from migration 104 (P6 worker reads metadata snapshot, not live env) |
| T-19-28 | Tampering | finalize-wizard scope-broadening between Connect and Submit | mitigate | force-refresh permissions probe (route.ts:60-86) RETAINED at thin-adapter layer (Open Question 1) — runs BEFORE /process-key delegation in unified path; legacy path unchanged |
| T-19-29 | Repudiation | migration 107 rollback ambiguity | mitigate | rollback-runbook.md (P1 ships) documents 5-step manual rollback; 7-day stability window (PR-C) is the protective gate — only ship PR-D if zero legacy writes + < 0.5% error rate |
</threat_model>

<verification>
- All 8 modified files exist (1 new feature-flags.ts + 7 modified routes including the H-1 status route).
- factsheet/[id]/pdf/route.ts UNCHANGED (verify via git diff).
- `bash scripts/check-route-inventory.sh` exits 0 after Tasks 1+2 (route inventory still valid).
- `bash scripts/check-phase-19-shim-commits.sh` exits 0 ONLY AFTER all 4 PRs merge (Task 3 checkpoint completes manually); H-7 168h delta enforced in the script.
- `npx vitest run tests/lib/feature-flags.test.ts tests/integration/process-key-thin-adapters.test.ts tests/integration/phase-19-pra-write.test.ts tests/integration/phase-19-pra-status-roundtrip.test.ts` exits 0.
- `.planning/phase-19/stability-log.md` carries `flag_flipped_at` ISO-8601 UTC + 7+ daily rows after PR-C ships.
- VERSION + package.json bumped on every PR (verify via git log on each commit).
- **C-5:** test `tests/integration/phase-19-pra-write.test.ts` asserts a complete `strategy_verifications` row lands with all 5 NOT NULLs after a real teaser POST against the test Supabase project.
- **H-1:** test `tests/integration/phase-19-pra-status-roundtrip.test.ts` POST→GET round-trip returns 200 with matching public_token.
- **H-8:** Postgres trigger `verification_requests_post_phase19_audit` exists post-PR-B and `audit_log` has zero `entity_type='verification_requests_legacy_write'` rows during the 168h stability window; `.github/workflows/phase-19-stability.yml` cron runs hourly.
</verification>

<success_criteria>
- BACKBONE-01: 5 entry routes delegate to /process-key with canonical body shape when flag=on.
- BACKBONE-04: 4-PR shim sequence completes with `phase-19-shim-step-a/b/c/d:` commits in order; ≥168h delta between commit (b) and commit (d); zero writes to legacy verification_requests over the window.
- BACKBONE-05: Supabase kill-switch row + env var both gate the unified backbone; 30s in-process cache; manual rollback runbook documented.
- BACKBONE-10: All 5 routes (verify-strategy, keys/validate-and-encrypt, strategies/finalize-wizard, keys/sync, csv-validate, csv-finalize) become thin adapters. factsheet/pdf out of scope per Open Question 2.
- finalize-wizard force-refresh probe retained at thin-adapter layer (Open Question 1).
</success_criteria>

<output>
After completion, create `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-05-SUMMARY.md`
</output>
