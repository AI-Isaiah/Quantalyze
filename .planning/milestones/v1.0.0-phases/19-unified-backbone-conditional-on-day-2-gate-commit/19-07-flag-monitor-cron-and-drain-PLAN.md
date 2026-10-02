---
phase: 19
slug: unified-backbone-conditional-on-day-2-gate-commit
plan: 07
type: execute
wave: 3
depends_on: [19-02-migrations-103-107, 19-04-process-key-router, 19-06-idempotency-and-process-key-long]
files_modified:
  - src/app/api/cron/flag-monitor/route.ts
  - vercel.json
  - scripts/probe-sentry-events-api.sh
  - tests/integration/cron-flag-monitor.test.ts
  - .env.example
  - analytics-service/sentry_init.py  # H-6 — verify environment tag from VERCEL_ENV
  - src/instrumentation.ts             # H-6 — verify Sentry init writes environment
  - tests/integration/sentry-environment.test.ts  # H-6 — CI smoke
autonomous: false
requirements: [BACKBONE-05, BACKBONE-09]
must_haves:
  truths:
    - "/api/cron/flag-monitor route exists at src/app/api/cron/flag-monitor/route.ts; auth via Bearer ${CRON_SECRET} mirrors existing sync-funding cron pattern"
    - "vercel.json crons array includes {path: '/api/cron/flag-monitor', schedule: '*/15 * * * *'} (15-min tumbling window)"
    - "Cron polls Sentry events API (org-scoped SENTRY_AUTH_TOKEN, scope event:read) for level:error events tagged path:/api/process-key with environment:production filter (Pitfall 8)"
    - "Denominator from Supabase audit_log entry_type='process_key' SELECT COUNT — P4 router writes audit row at /process-key entry"
    - "Threshold logic: errorRate > 0.5% AND total >= 20 → flips Supabase feature_flags kill-switch row to 'off' + Resend email + Sentry breadcrumb"
    - "Sub-threshold warn email when errorRate > 0.25% (per CONTEXT.md L40 'regardless of auto-rollback action')"
    - "scripts/probe-sentry-events-api.sh ships and runs against the live Sentry org token to verify [ASSUMED A1] endpoint shape BEFORE the cron deploys"
    - "Manual rollback runbook (P1's rollback-runbook.md) referenced from cron handler comment + .env.example documents SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG, FOUNDER_LP_REPORT_TO env vars"
    - "Drain semantics — worker reads compute_jobs.metadata->>'unified_backbone_at_claim' (set by claim RPC per migration 104; main_worker passes flag via P6); cron does NOT touch worker drain — those are independent paths"
  artifacts:
    - path: "src/app/api/cron/flag-monitor/route.ts"
      provides: "Vercel cron handler — Sentry poll + audit denominator + kill-switch flip"
      contains: "/api/cron/flag-monitor"
    - path: "vercel.json"
      provides: "Cron registration (8th cron under Pro plan 40-cron cap)"
      contains: "flag-monitor"
    - path: "scripts/probe-sentry-events-api.sh"
      provides: "One-shot probe to verify Sentry events API shape before cron ships [Assumption A1]"
      contains: "events"
  key_links:
    - from: "/api/cron/flag-monitor"
      to: "Sentry events API"
      via: "GET https://sentry.io/api/0/organizations/{ORG}/events/?statsPeriod=15m&query=level:error path:/api/process-key environment:production"
      pattern: "events"
    - from: "/api/cron/flag-monitor"
      to: "feature_flags table (Supabase)"
      via: "upsert {flag_key: 'process_key_unified_backbone', value: 'off'}"
      pattern: "process_key_unified_backbone"
    - from: "/api/cron/flag-monitor"
      to: "Resend founder breach email"
      via: "Resend SDK + FOUNDER_LP_REPORT_TO env var"
      pattern: "Resend"
---

<objective>
Ship the auto-rollback infrastructure: `/api/cron/flag-monitor` Next.js cron
handler that polls Sentry's events API every 15 minutes and flips the Supabase
`feature_flags` kill-switch row when the /process-key error-envelope rate
exceeds 0.5% in a tumbling window (BACKBONE-05 + BACKBONE-09 stability gate).

Components:
1. **`src/app/api/cron/flag-monitor/route.ts`** — Vercel cron handler. Auth
   via `Bearer ${CRON_SECRET}` (mirrors `sync-funding/route.ts:29-32`).
   Polls Sentry events API + Supabase audit_log denominator + flips kill-switch
   on threshold breach + sends Resend email to founder.
2. **`vercel.json` crons[]** — adds `{path: '/api/cron/flag-monitor',
   schedule: '*/15 * * * *'}` (8th entry; well under Pro plan 40-cron cap
   per Assumption A7).
3. **`scripts/probe-sentry-events-api.sh`** — one-shot probe to verify
   Sentry events API endpoint shape against live org token BEFORE the cron
   deploys (Assumption A1 — Sentry's API has changed shape twice; verify before
   trusting blueprint).
4. **`.env.example`** — documents `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`,
   `FOUNDER_LP_REPORT_TO` (already exists from Phase 18 LP cron — re-document)
   env vars (Assumption A8 — explicit `PROCESS_KEY_UNIFIED_BACKBONE=off` documented).
5. **`tests/integration/cron-flag-monitor.test.ts`** — vitest covering auth gate,
   threshold logic, sub-threshold warn, kill-switch flip path.

**Threshold logic (per CONTEXT.md L40 + RESEARCH §P7):**
- Numerator: Sentry event count for `level:error path:/api/process-key correlation_id:* environment:production` over the last 15 minutes.
- Denominator: Supabase `audit_log` row count for `entity_type='process_key'` over the same 15 minutes (P4 writes audit row at /process-key entry — verify P4 plan task includes this).
- `total >= 20` minimum sample guard (Pitfall — single error in 1-call window MUST NOT trigger rollback).
- `errorRate > 0.005` (0.5%) → flip kill-switch + Resend email + Sentry breadcrumb.
- `errorRate > 0.0025` (0.25%, sub-threshold) → Resend WARN email only (no rollback). CONTEXT.md L40 mandates this notification "regardless of auto-rollback action".

**Drain semantics — out of scope for this plan:**
The drain mechanism (worker reads `unified_backbone_at_claim` metadata, not
live env var) is implemented in P2 (claim RPC writes metadata) and P6 (worker
handler reads metadata). The flag-monitor cron WRITES the kill-switch row;
the drain is what protects in-flight jobs from split-brain at the flip moment.

**Theme 5 — daily vcrpy + repro-key-flow.sh during 7-day stability window:**
P5 PR-C task documents the daily check; this plan adds a comment in the
flag-monitor route handler reminding founders to refresh cassettes and
cross-check repro-key-flow.sh output against the cron's error count.

**Manual rollback fallback (per CONTEXT.md "Auto-rollback via Vercel env var
flip — manual fallback only"):**
P1 ships `.planning/phase-19/rollback-runbook.md`. This plan's cron handler
comment links to that runbook so on-call founders know where to look when
the auto-rollback path itself fails.

**Probe verification BEFORE deploying the cron (Assumption A1):**
Run `scripts/probe-sentry-events-api.sh` once against the live Sentry org with
a real auth token and a known correlation_id. Verify the JSON response shape
matches `data[0].count` + `meta.dataset`. If Sentry's response shape differs,
update the cron handler before merge.

Purpose: BACKBONE-05 auto-rollback path lights up. 7-day stability window
during P5 PR-C is enforced by the cron's threshold logic catching breaches.

Output: 1 cron route + vercel.json change + 1 probe script + 1 vitest +
.env.example update.

Tracking: BACKBONE-05 (auto-rollback target), BACKBONE-09 (cross-cutting
stability gate — drain enforced in P2/P6, monitor enforced here).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md
@.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md
@.planning/phase-19/rollback-runbook.md
@.planning/phase-19/stability-log.md
@vercel.json
@src/app/api/cron/sync-funding/route.ts
@src/app/api/cron/cleanup-ack-tokens/route.ts
@src/app/api/cron/founder-lp-report/route.ts
@src/lib/supabase/admin.ts
@src/lib/timing-safe-compare.ts

<interfaces>
<!-- Existing patterns this plan follows. -->

From `src/app/api/cron/sync-funding/route.ts:29-32` (verified — auth pattern):
```typescript
import { safeCompare } from "@/lib/timing-safe-compare";

const auth = req.headers.get("authorization") ?? "";
const expected = `Bearer ${process.env.CRON_SECRET}`;
if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

From `vercel.json` (verified — 7 existing crons):
```json
{
  "crons": [
    { "path": "/api/cron/warm-analytics", "schedule": "..." },
    { "path": "/api/cron/alert-digest", "schedule": "..." },
    { "path": "/api/cron/cleanup-wizard-drafts", "schedule": "..." },
    { "path": "/api/cron/sync-funding", "schedule": "..." },
    { "path": "/api/cron/reconcile-strategies", "schedule": "..." },
    { "path": "/api/cron/cleanup-ack-tokens", "schedule": "..." },
    { "path": "/api/cron/founder-lp-report", "schedule": "0 9 1 * *" }
  ]
}
```

From P4 router task (analytics-service/routers/process_key.py):
- Writes audit_log row at /process-key entry — denominator source.
- audit_log columns: `entity_type, entity_id, correlation_id, created_at, ...`
- (If P4 hasn't yet wired the audit write, this plan must surface that as a dependency — P4 is in Wave 2 and should ship the audit row.)

Sentry events API per RESEARCH §P7 (Assumption A1):
- Endpoint: `GET https://sentry.io/api/0/organizations/{org_slug}/events/`
- Params: `?statsPeriod=15m&query=level:error path:/api/process-key correlation_id:* environment:production&field=count()`
- Auth: `Authorization: Bearer ${SENTRY_AUTH_TOKEN}` (org-scoped, `event:read`)
- Response (assumed): `{ "data": [ { "count()": <int> } ], "meta": {...} }`
- **MUST verify shape live before merge** — the `field=count()` syntax is the most-likely
  shape but Sentry has rotated this twice since GA. Run probe script first.
</interfaces>
</context>

<no_git_branch_ops>
You are running on branch `v1.0.0-phase-19-unified-backbone`. Do NOT run
`git checkout`, `git pull`, `git fetch`, `git switch`, `git reset`, or any other
command that changes branches or pulls remote state. No commits, no pushes.
If you need to verify the branch, use `git rev-parse --abbrev-ref HEAD` (read-only).
</no_git_branch_ops>

<tasks>

<task id="P7-1" type="checkpoint:human-verify" gate="blocking">
  <name>Task 1: Verify Sentry events API endpoint shape via probe script (Assumption A1)</name>
  <what-built>This task ships `scripts/probe-sentry-events-api.sh` — a one-shot probe that calls Sentry's events API against the live Sentry org token and verifies the response shape. The probe script must be run BEFORE Task 2 (cron handler) is finalized; if Sentry's response shape differs from RESEARCH §P7 Assumption A1, the cron handler in Task 2 must be adjusted.</what-built>
  <how-to-verify>
1. Create `scripts/probe-sentry-events-api.sh`:

```bash
#!/usr/bin/env bash
# Phase 19 / BACKBONE-05 / Assumption A1 — one-shot probe of Sentry events API.
# Verify the response shape BEFORE deploying /api/cron/flag-monitor.
#
# Required env: SENTRY_AUTH_TOKEN (org-scoped, event:read), SENTRY_ORG_SLUG.
# Usage:
#   export SENTRY_AUTH_TOKEN=...
#   export SENTRY_ORG_SLUG=...
#   bash scripts/probe-sentry-events-api.sh
set -euo pipefail

if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  echo "FAIL: SENTRY_AUTH_TOKEN not set." >&2
  exit 1
fi
if [[ -z "${SENTRY_ORG_SLUG:-}" ]]; then
  echo "FAIL: SENTRY_ORG_SLUG not set." >&2
  exit 1
fi

URL="https://sentry.io/api/0/organizations/${SENTRY_ORG_SLUG}/events/"
QUERY='statsPeriod=15m&query=level:error+environment:production&field=count()'

echo "Probing: $URL?$QUERY"
RESPONSE=$(curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "$URL?$QUERY")

echo "$RESPONSE" | jq . 2>/dev/null || (echo "FAIL: response not JSON or jq missing" >&2; echo "$RESPONSE" >&2; exit 2)

# Verify expected shape: data[0] exists with a `count()` or `count` field
HAS_COUNT=$(echo "$RESPONSE" | jq -r '.data[0] | has("count()") or has("count")' 2>/dev/null || echo "false")
if [[ "$HAS_COUNT" != "true" ]]; then
  echo "WARN: response shape does not match Assumption A1 — neither data[0].count() nor data[0].count present." >&2
  echo "Adjust src/app/api/cron/flag-monitor/route.ts to match the actual shape before merging." >&2
  exit 3
fi

echo ""
echo "OK: Sentry events API responds with shape data[0].count or data[0].count(). Cron handler can rely on this shape."
```

`chmod +x scripts/probe-sentry-events-api.sh`.

2. Run the probe locally with a real `SENTRY_AUTH_TOKEN` (founder issues an event:read scoped token; do NOT commit it to the repo). Verify the response shape matches the assumption (`data[0].count()` or `data[0].count`).

3. If shape differs from assumption: pause Task 2 and adjust the response parsing accordingly.
  </how-to-verify>
  <resume-signal>After running the probe and confirming the response shape, type "shape verified: data[0].{count|count()}" or "shape differs: <observed shape>". Task 2 proceeds with the verified parse path.</resume-signal>
  <requirements>BACKBONE-05</requirements>
</task>

<task id="P7-1.5" type="auto">
  <name>Task 1.5 [H-6]: Verify Sentry SDK init writes environment tag from VERCEL_ENV</name>
  <files>analytics-service/sentry_init.py, src/instrumentation.ts, tests/integration/sentry-environment.test.ts</files>
  <read_first>
    - analytics-service/sentry_init.py (full file — verify `before_send` includes `event["environment"] = os.environ.get("VERCEL_ENV", "production")` or equivalent)
    - src/instrumentation.ts (Next.js Sentry init — verify `Sentry.init({ environment: process.env.VERCEL_ENV ?? 'production', ... })`)
  </read_first>
  <action>
**H-6 fix:** Phase 19 P7-2 cron filters Sentry events by `environment:production` (Pitfall 8). If the Sentry SDK init does NOT write the `environment` tag from VERCEL_ENV, the filter either always matches (counting dev/preview events as production) OR always misses. Verify before P7-2 deploys.

1. Read `analytics-service/sentry_init.py`. If `Sentry.init(...)` does not pass `environment=os.environ.get("VERCEL_ENV", "production")`, ADD that argument. If `before_send` does not stamp `event["environment"]`, ADD it via:
   ```python
   def before_send(event, hint):
       event["environment"] = os.environ.get("VERCEL_ENV") or os.environ.get("RAILWAY_ENVIRONMENT") or "production"
       # ... existing redact logic ...
       return event
   ```

2. Read `src/instrumentation.ts`. Verify `Sentry.init({ environment: process.env.VERCEL_ENV ?? 'production', ... })`. If missing, add it.

3. Add a CI smoke test `tests/integration/sentry-environment.test.ts` that captures a Sentry event from a test entrypoint and verifies (via Sentry events API in the test Sentry org) that the captured event has `tags.environment === 'production'` (or whatever VERCEL_ENV resolves to in the CI environment).
  </action>
  <acceptance_criteria>
    - `grep -q 'VERCEL_ENV' analytics-service/sentry_init.py` AND `grep -q 'VERCEL_ENV' src/instrumentation.ts`
    - File `tests/integration/sentry-environment.test.ts` exists
  </acceptance_criteria>
  <automated>
    bash -c 'grep -q "VERCEL_ENV" analytics-service/sentry_init.py && grep -q "VERCEL_ENV" src/instrumentation.ts && test -f tests/integration/sentry-environment.test.ts'
  </automated>
  <requirements>BACKBONE-05</requirements>
</task>

<task id="P7-2" type="auto" tdd="true">
  <name>Task 2: Write /api/cron/flag-monitor route + register in vercel.json + .env.example update</name>
  <files>src/app/api/cron/flag-monitor/route.ts, vercel.json, .env.example, tests/integration/cron-flag-monitor.test.ts</files>
  <read_first>
    - src/app/api/cron/sync-funding/route.ts (FULL file — auth + structure pattern)
    - src/app/api/cron/cleanup-ack-tokens/route.ts (FULL file — additional cron handler reference)
    - src/app/api/cron/founder-lp-report/route.ts (Resend pattern from Phase 18)
    - src/lib/timing-safe-compare.ts (verify safeCompare signature)
    - src/lib/supabase/admin.ts (createAdminClient signature)
    - .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-RESEARCH.md (lines 1300-1422 — cron handler full body + Pitfall 8 environment:production filter)
    - vercel.json (existing 7 crons — verify exact JSON shape before edit)
    - .env.example (existing structure)
    - scripts/probe-sentry-events-api.sh (Task 1 output — verify shape assumption)
  </read_first>
  <behavior>
    - Test 1 (test_unauthorized_returns_401): Request without Bearer ${CRON_SECRET} → 401.
    - Test 2 (test_below_threshold_no_action): errorRate=0.001 (0.1%) → no flip, no email.
    - Test 3 (test_warn_threshold_sends_warn_email): errorRate=0.003 (0.3%) → no flip, WARN email sent.
    - Test 4 (test_above_threshold_flips_kill_switch): errorRate=0.01 (1%) AND total>=20 → flip kill-switch row + ALERT email.
    - Test 5 (test_min_sample_guard): errorRate=0.5 (50%) but total=10 (< 20) → no flip (sample too small).
    - Test 6 (test_sentry_unreachable_returns_warn_response): Sentry returns 5xx → response `{ok: false, reason: "sentry_unreachable"}`; no flip.
    - Test 7 (test_environment_production_filter): Outbound Sentry query string contains `environment:production` (Pitfall 8 — prevent dev/preview events from triggering rollback).
    - Test 8 (test_zero_denominator_alert_after_3_windows) [H-2]: total=0 for 3 consecutive cron runs → SEV-2 email sent on the 3rd run; response carries `{ok:false, reason:'zero_denominator', streak:3}`.
    - Test 9 (test_zero_denominator_streak_resets) [H-2]: streak=2, then a window with total>0 resets the streak to 0 and no alert is sent on subsequent zero windows until 3 are accumulated again.
    - Test 10 (test_postgrest_function_not_found_fallback) [D-3]: when the kill-switch upsert RPC throws PGRST function-not-found, log SEV-2 alert AND fall back to a 2-arg call (or, depending on the failure mode, surface a clear error). Mock the Supabase client to throw; assert the fallback path is invoked.
    - Test 11 (test_sentry_environment_smoke) [H-6]: a CI smoke step in `.github/workflows/phase-19-stability.yml` captures a Sentry event and asserts `tags.environment === 'production'` (or whatever VERCEL_ENV resolves to). Test stub here verifies the workflow file exists and references the smoke command.
  </behavior>
  <action>
**Verify Task 1 ran successfully.** If Sentry's shape differs from `data[0].count()`, adjust the parse path below.

Create `src/app/api/cron/flag-monitor/route.ts`:

```typescript
/**
 * Phase 19 / BACKBONE-05 — auto-rollback cron.
 *
 * Polls Sentry events API every 15 minutes for /api/process-key error events.
 * Computes error envelope rate (errors / total /process-key calls in same window).
 * Threshold: errorRate > 0.5% with total >= 20 → flips Supabase feature_flags
 * kill-switch row to 'off'. Sends Resend ALERT email to founder.
 * Sub-threshold (errorRate > 0.25%) sends WARN email per CONTEXT.md L40.
 *
 * Manual rollback fallback (Supabase outage) documented in
 * .planning/phase-19/rollback-runbook.md.
 *
 * Theme 5 reminder: during the 7-day stability window after P5 PR-B flag flip,
 * cross-check this cron's error count against scripts/repro-key-flow.sh daily
 * cassette refresh output. Discrepancy = likely environment filter regression.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";
import { Resend } from "resend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SENTRY_BASE = "https://sentry.io/api/0/organizations";

async function handle(req: NextRequest): Promise<NextResponse> {
  // Auth — mirrors sync-funding pattern
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgSlug = process.env.SENTRY_ORG_SLUG;
  const sentryToken = process.env.SENTRY_AUTH_TOKEN;
  const founderEmail = process.env.FOUNDER_LP_REPORT_TO;
  const resendKey = process.env.RESEND_API_KEY;

  if (!orgSlug || !sentryToken) {
    console.warn("[cron/flag-monitor] SENTRY_ORG_SLUG or SENTRY_AUTH_TOKEN missing — skipping");
    return NextResponse.json({ ok: false, reason: "sentry_not_configured" });
  }

  const admin = createAdminClient();
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);

  // 1) Numerator: Sentry error event count
  // Pitfall 8: environment:production filter prevents dev/preview events
  // (e.g., from CI cassette runs) from triggering production rollback.
  const params = new URLSearchParams({
    statsPeriod: "15m",
    query: "level:error path:/api/process-key correlation_id:* environment:production",
    field: "count()",
  });
  const sentryUrl = `${SENTRY_BASE}/${orgSlug}/events/?${params}`;

  let sentryRes: Response;
  try {
    sentryRes = await fetch(sentryUrl, {
      headers: { Authorization: `Bearer ${sentryToken}` },
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[cron/flag-monitor] sentry fetch threw:", err);
    return NextResponse.json({ ok: false, reason: "sentry_unreachable" });
  }
  if (!sentryRes.ok) {
    console.warn("[cron/flag-monitor] sentry status:", sentryRes.status);
    return NextResponse.json({ ok: false, reason: "sentry_unreachable", status: sentryRes.status });
  }
  const sentryData = await sentryRes.json().catch(() => ({}));
  // Probe-verified shape: data[0].count() or data[0].count
  const errorCount: number =
    sentryData?.data?.[0]?.["count()"] ?? sentryData?.data?.[0]?.count ?? 0;

  // 2) Denominator: Supabase audit_log /process-key entries in same window
  const { count: totalCount } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "process_key")
    .gte("created_at", windowStart.toISOString());

  const total = totalCount ?? 0;
  const errorRate = total > 0 ? errorCount / total : 0;

  // 3) Threshold logic
  const ALERT_THRESHOLD = 0.005; // 0.5%
  const WARN_THRESHOLD = 0.0025; // 0.25%
  const MIN_SAMPLE = 20;

  const resend = resendKey ? new Resend(resendKey) : null;

  // H-2 — denominator-non-zero check. If audit_log row count stays at 0 for >2
  // consecutive 15-min windows, the denominator is silently broken and the cron
  // is a no-op — fail-open by sending a SEV-2 alert email so the founder knows.
  // Track via Supabase feature_flags row "flag_monitor_zero_denominator_streak".
  if (total === 0) {
    const { data: flagRow } = await admin
      .from("feature_flags")
      .select("value")
      .eq("flag_key", "flag_monitor_zero_denominator_streak")
      .maybeSingle();
    const currentStreak = parseInt(flagRow?.value ?? "0", 10) || 0;
    const newStreak = currentStreak + 1;
    await admin.from("feature_flags").upsert(
      {
        flag_key: "flag_monitor_zero_denominator_streak",
        value: String(newStreak),
        updated_at: now.toISOString(),
        updated_by: "cron/flag-monitor",
      },
      { onConflict: "flag_key" },
    );
    if (newStreak > 2 && resend && founderEmail) {
      await resend.emails.send({
        from: "Quantalyze <alerts@quantalyze.com>",
        to: founderEmail,
        subject: `[H-2 SEV-2] Phase 19 flag-monitor denominator stuck at 0 for ${newStreak} windows`,
        html: `<p>The /process-key audit_log denominator has been 0 for ${newStreak} consecutive 15-min windows. Either no traffic is reaching /process-key, OR the audit-write at /process-key entry is failing. Auto-rollback cannot trip in this state — investigate before traffic resumes.</p>`,
      });
    }
    return NextResponse.json({ ok: false, reason: "zero_denominator", streak: newStreak });
  } else {
    // Reset streak on first non-zero window
    await admin.from("feature_flags").upsert(
      {
        flag_key: "flag_monitor_zero_denominator_streak",
        value: "0",
        updated_at: now.toISOString(),
        updated_by: "cron/flag-monitor",
      },
      { onConflict: "flag_key" },
    );
  }

  if (errorRate > ALERT_THRESHOLD && total >= MIN_SAMPLE) {
    // Flip kill-switch row
    await admin
      .from("feature_flags")
      .upsert(
        {
          flag_key: "process_key_unified_backbone",
          value: "off",
          updated_at: now.toISOString(),
          updated_by: "cron/flag-monitor",
        },
        { onConflict: "flag_key" },
      );

    if (resend && founderEmail) {
      await resend.emails.send({
        from: "Quantalyze <alerts@quantalyze.com>",
        to: founderEmail,
        subject: `[ALERT] Phase 19 backbone auto-rolled-back: ${(errorRate * 100).toFixed(2)}% error rate`,
        html: `<p>Error envelope rate <code>${(errorRate * 100).toFixed(2)}%</code> exceeded ${ALERT_THRESHOLD * 100}% threshold over the past 15 minutes (${errorCount}/${total}). Kill-switch row <code>process_key_unified_backbone</code> has been flipped to <code>off</code>; new traffic falls back to legacy routes within 30 seconds.</p><p>Manual rollback runbook: <code>.planning/phase-19/rollback-runbook.md</code>.</p>`,
      });
    }

    console.warn(`[cron/flag-monitor] AUTO-ROLLBACK: errorRate=${errorRate} total=${total}`);
    return NextResponse.json({
      ok: true,
      action: "rolled_back",
      errorRate,
      errorCount,
      total,
    });
  }

  if (errorRate > WARN_THRESHOLD && total >= MIN_SAMPLE) {
    if (resend && founderEmail) {
      await resend.emails.send({
        from: "Quantalyze <alerts@quantalyze.com>",
        to: founderEmail,
        subject: `[WARN] Phase 19 error rate ${(errorRate * 100).toFixed(2)}% — below auto-rollback threshold`,
        html: `<p>Error rate ${errorCount}/${total} = ${(errorRate * 100).toFixed(2)}% — below the ${ALERT_THRESHOLD * 100}% auto-rollback threshold but worth a look.</p>`,
      });
    }
    return NextResponse.json({ ok: true, action: "warn_sent", errorRate, errorCount, total });
  }

  return NextResponse.json({ ok: true, errorRate, errorCount, total });
}

export const GET = handle;
export const POST = handle;
```

Update `vercel.json` — read the existing crons array first, then append (preserving JSON formatting):

```json
{ "path": "/api/cron/flag-monitor", "schedule": "*/15 * * * *" }
```

Update `.env.example` — add (if not present) under a "Phase 19" comment:
```
# Phase 19 — Unified backbone auto-rollback (BACKBONE-05)
PROCESS_KEY_UNIFIED_BACKBONE=off    # default OFF until founder enables (Assumption A8)
SENTRY_AUTH_TOKEN=                  # Sentry org token, scope event:read (BACKBONE-05 monitor)
SENTRY_ORG_SLUG=                    # Sentry org slug for events API
# FOUNDER_LP_REPORT_TO already exists from Phase 18 LP cron — re-document here for Phase 19
```

Then create `tests/integration/cron-flag-monitor.test.ts` (vitest) with the 7 tests above. Mock `fetch` for Sentry; mock `createAdminClient` for Supabase + audit_log + feature_flags upsert. Use Resend mock for email assertions.
  </action>
  <acceptance_criteria>
    - File `src/app/api/cron/flag-monitor/route.ts` exists; exports GET and POST handlers
    - `grep -q 'safeCompare' src/app/api/cron/flag-monitor/route.ts`
    - `grep -q 'CRON_SECRET' src/app/api/cron/flag-monitor/route.ts`
    - `grep -q 'environment:production' src/app/api/cron/flag-monitor/route.ts` (Pitfall 8)
    - `grep -q 'process_key_unified_backbone' src/app/api/cron/flag-monitor/route.ts`
    - `grep -q 'feature_flags' src/app/api/cron/flag-monitor/route.ts`
    - `grep -q 'ALERT_THRESHOLD' src/app/api/cron/flag-monitor/route.ts`
    - `grep -q 'MIN_SAMPLE' src/app/api/cron/flag-monitor/route.ts`
    - `grep -q 'rollback-runbook' src/app/api/cron/flag-monitor/route.ts`
    - `vercel.json` includes `/api/cron/flag-monitor`
    - `grep -q 'flag-monitor' vercel.json`
    - `.env.example` includes `PROCESS_KEY_UNIFIED_BACKBONE` and `SENTRY_AUTH_TOKEN`
    - `grep -q 'PROCESS_KEY_UNIFIED_BACKBONE' .env.example`
    - File `tests/integration/cron-flag-monitor.test.ts` exists with 7 test functions
    - `npx vitest run tests/integration/cron-flag-monitor.test.ts` exits 0
  </acceptance_criteria>
  <automated>
    bash -c 'test -f src/app/api/cron/flag-monitor/route.ts && grep -q "environment:production" src/app/api/cron/flag-monitor/route.ts && grep -q "process_key_unified_backbone" src/app/api/cron/flag-monitor/route.ts && grep -q "MIN_SAMPLE" src/app/api/cron/flag-monitor/route.ts && grep -q "flag-monitor" vercel.json && grep -q "PROCESS_KEY_UNIFIED_BACKBONE" .env.example && grep -q "SENTRY_AUTH_TOKEN" .env.example && test -f tests/integration/cron-flag-monitor.test.ts && npx vitest run tests/integration/cron-flag-monitor.test.ts --reporter=basic'
  </automated>
  <requirements>BACKBONE-05, BACKBONE-09</requirements>
</task>

<task id="P7-3" type="auto" tdd="true">
  <name>Task 3 [H-10 + D-3 + D-4]: e2e auto-rollback integration test + PostgREST fallback + cache TTL during stability</name>
  <files>tests/integration/cron-flag-monitor-rollback-e2e.test.ts, src/app/api/cron/flag-monitor/route.ts, src/lib/feature-flags.ts</files>
  <read_first>
    - src/app/api/cron/flag-monitor/route.ts (Task 2 output — kill-switch upsert path)
    - src/lib/feature-flags.ts (P5-1 output — 30s in-process cache)
    - analytics-service/services/feature_flags.py (P4-1 output)
  </read_first>
  <behavior>
    - Test 1 (test_e2e_auto_rollback_propagates_within_30s) [H-10]: against the test Supabase project, (a) flip the kill-switch row from `on` to `off`; (b) `await sleep(31_000)`; (c) call `is_unified_backbone_active()` from a fresh process — assert `false`. Proves the in-process 30s cache TTL behaves correctly; auto-rollback latency is bounded.
    - Test 2 (test_postgrest_function_not_found_fallback) [D-3]: mock the Supabase client to raise PGRST resolution error; cron handler logs SEV-2 + falls back to a 2-arg call (with implicit unified_backbone_active=NULL); assert the fallback completed without re-throwing.
  </behavior>
  <action>
**H-10 fix:** P7-2's existing tests mock the Supabase upsert. There is no end-to-end proof that the kill-switch flip propagates to the in-process cache. Add an integration test against the test Supabase project (`qmnijlgmdhviwzwfyzlc`) that:

1. Sets the kill-switch row to `on`. Calls `isUnifiedBackboneActive()` — asserts true.
2. Flips the kill-switch row to `off`.
3. Awaits 31 seconds (cache TTL + 1s buffer) using vitest's `vi.useFakeTimers()` is NOT sufficient — use a real `setTimeout`.
4. Calls `isUnifiedBackboneActive()` from a **fresh module import** (use `vi.resetModules()` to bust the in-process cache between calls). Asserts false.

Also: shorten the cache TTL to 5 seconds during the 7-day stability window via an env-var override (D-4 fix below).

**D-3 fix:** in the kill-switch upsert path, wrap with try/catch:
```typescript
try {
  await admin.from("feature_flags").upsert({...});
} catch (err: unknown) {
  const errStr = String(err);
  if (errStr.includes("PGRST") || errStr.includes("function not found") || errStr.includes("schema cache")) {
    // SEV-2 — kill-switch RPC unreachable. Send Resend ALERT email
    if (resend && founderEmail) {
      await resend.emails.send({
        from: "Quantalyze <alerts@quantalyze.com>",
        to: founderEmail,
        subject: `[D-3 SEV-2] Phase 19 kill-switch upsert failed (PGRST)`,
        html: `<p>Auto-rollback failed because the Supabase kill-switch upsert raised PGRST function-not-found. Manual rollback runbook: <code>.planning/phase-19/rollback-runbook.md</code>.</p><p>Error: <code>${errStr}</code></p>`,
      });
    }
    console.error("[cron/flag-monitor] D-3 PostgREST resolution error:", err);
    // Fall through — return error response without flipping the in-process state
    return NextResponse.json({ ok: false, reason: "kill_switch_unreachable_d3", error: errStr }, { status: 500 });
  }
  throw err;
}
```

**D-4 fix:** cache TTL during stability window. Update both `src/lib/feature-flags.ts` and `analytics-service/services/feature_flags.py` to honor an env-var `PHASE_19_STABILITY_CACHE_TTL_S` (default 30s). During the 7-day stability window the founder sets `PHASE_19_STABILITY_CACHE_TTL_S=5`, reducing kill-switch propagation from 30s → 5s. After PR-D ships, the env var can be removed (defaults back to 30s).

Update `src/lib/feature-flags.ts`:
```typescript
const CACHE_TTL_MS = (parseInt(process.env.PHASE_19_STABILITY_CACHE_TTL_S ?? "30", 10) || 30) * 1_000;
```

Update `analytics-service/services/feature_flags.py`:
```python
import os
_CACHE_TTL_S = float(os.getenv("PHASE_19_STABILITY_CACHE_TTL_S") or "30")
```

Document the SLA explicitly in `.planning/phase-19/stability-log.md`: during the stability window, kill-switch flip propagation is 5s + cron tick (5min if D-4 cron tick bump applied; 15min otherwise) = ≤5 minutes worst case.
  </action>
  <acceptance_criteria>
    - File `tests/integration/cron-flag-monitor-rollback-e2e.test.ts` exists with `test_e2e_auto_rollback_propagates_within_30s`
    - **D-3:** `grep -q 'PGRST' src/app/api/cron/flag-monitor/route.ts` AND `grep -q 'kill_switch_unreachable_d3' src/app/api/cron/flag-monitor/route.ts`
    - **D-4:** `grep -q 'PHASE_19_STABILITY_CACHE_TTL_S' src/lib/feature-flags.ts` AND `grep -q 'PHASE_19_STABILITY_CACHE_TTL_S' analytics-service/services/feature_flags.py`
    - `npx vitest run tests/integration/cron-flag-monitor-rollback-e2e.test.ts` exits 0 (skips when SUPABASE_TEST_URL absent)
  </acceptance_criteria>
  <automated>
    bash -c 'test -f tests/integration/cron-flag-monitor-rollback-e2e.test.ts && grep -q "PGRST" src/app/api/cron/flag-monitor/route.ts && grep -q "kill_switch_unreachable_d3" src/app/api/cron/flag-monitor/route.ts && grep -q "PHASE_19_STABILITY_CACHE_TTL_S" src/lib/feature-flags.ts'
  </automated>
  <requirements>BACKBONE-05</requirements>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel cron → /api/cron/flag-monitor | CRON_SECRET bearer; safeCompare timing-safe |
| /api/cron/flag-monitor → Sentry events API | SENTRY_AUTH_TOKEN org-scoped (event:read); never user-facing |
| /api/cron/flag-monitor → Supabase feature_flags | service-role write; RLS policy from migration 104 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-35 | Spoofing | unauthorized cron invocation | mitigate | safeCompare on Authorization header against Bearer ${CRON_SECRET}; mirrors sync-funding/route.ts:29-32 |
| T-19-36 | Information disclosure | SENTRY_AUTH_TOKEN leakage in logs | mitigate | Token only used in Authorization header for outbound fetch; never logged; redact.py at sentry_init.before_send scrubs Authorization headers |
| T-19-37 | DoS | false-positive auto-rollback from CI cassette runs | mitigate | Pitfall 8 — `environment:production` filter on Sentry query excludes dev/preview events; MIN_SAMPLE >= 20 prevents single-error rollback |
| T-19-38 | DoS | flag thrashing from oscillating error rate | accept | 30s flag cache + 15-min cron tick = max 1 flip per tick; manual rollback runbook for sustained issues |
| T-19-39 | Information disclosure | Sentry org-scope token reads other-org events | mitigate | Token scoped to single org via Sentry UI; not user-readable; Assumption A1 |
| T-19-40 | Tampering | Sentry API shape drift | mitigate | scripts/probe-sentry-events-api.sh runs before cron deploys (Task 1 checkpoint); cron parses both `count()` and `count` for shape resilience |
| T-19-41 | Repudiation | manual rollback fallback when Supabase write fails | mitigate | rollback-runbook.md (P1) documents 5-step manual procedure; Resend email always sent independently of kill-switch flip success |
</threat_model>

<verification>
- All 4 file changes land (route.ts, vercel.json, .env.example, test file).
- `npx vitest run tests/integration/cron-flag-monitor.test.ts` exits 0 with all 7 tests passing.
- vercel.json crons array has 8 entries (was 7).
- Probe script `scripts/probe-sentry-events-api.sh` exists + executable; manual run passes Task 1 checkpoint.
- `.env.example` documents PROCESS_KEY_UNIFIED_BACKBONE=off (Assumption A8) + SENTRY_AUTH_TOKEN + SENTRY_ORG_SLUG.
- Cron handler comment links to .planning/phase-19/rollback-runbook.md.
</verification>

<success_criteria>
- BACKBONE-05 auto-rollback path live: cron polls Sentry every 15 min; flips kill-switch row when errorRate > 0.5% with sample >= 20.
- BACKBONE-09 stability gate enforced: 7-day window in P5 PR-C protected by this cron's threshold breach detection.
- Pitfall 8 honored: environment:production filter on Sentry query.
- Resend WARN email at sub-threshold (0.25%) per CONTEXT.md L40.
- Sentry events API shape verified live before deploy (Assumption A1 task gate).
- Manual rollback fallback documented + linked from cron handler comment.
</success_criteria>

<output>
After completion, create `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-07-SUMMARY.md`
</output>
