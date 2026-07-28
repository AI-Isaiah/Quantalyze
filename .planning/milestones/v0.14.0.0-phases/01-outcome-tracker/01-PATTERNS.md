# Phase 1: Outcome Tracker — Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 13 new / 3 modified
**Analogs found:** 16 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/059_bridge_outcomes.sql` | migration (table + RLS + trigger + indexes) | CRUD | `supabase/migrations/037_user_notes.sql` | exact |
| `supabase/migrations/059_bridge_outcomes.sql` (dismissals section) | migration (TTL table + RLS) | CRUD | `supabase/migrations/037_user_notes.sql` | exact |
| `supabase/migrations/059_bridge_outcomes.sql` (cron + fn) | migration (pg_cron + SECURITY DEFINER SQL fn) | batch / scheduled | `supabase/migrations/056_retention_crons.sql` | exact |
| `src/app/api/bridge/outcome/route.ts` | API route (POST) | request-response | `src/app/api/admin/match/decisions/route.ts` + `src/app/api/intro/route.ts` | exact (auth + Zod hybrid) |
| `src/app/api/bridge/outcome/dismiss/route.ts` | API route (POST) | request-response | `src/app/api/admin/match/decisions/route.ts` | role-match |
| `src/app/api/bridge/outcome/route.test.ts` | unit test (route) | test | `src/app/api/intro/route.test.ts` | exact |
| `src/app/api/bridge/outcome/dismiss/route.test.ts` | unit test (route) | test | `src/app/api/intro/route.test.ts` | exact |
| `src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.tsx` | React client component | event-driven (UI) | `src/app/(dashboard)/allocations/components/UndoToast.tsx` + `AlertBanner.tsx` | role-match |
| `src/app/(dashboard)/allocations/components/AllocatedForm.tsx` | React client form | request-response | `UndoToast.tsx` shell + form fetch pattern from intro flow | role-match |
| `src/app/(dashboard)/allocations/components/RejectedForm.tsx` | React client form | request-response | `UndoToast.tsx` shell + form fetch pattern | role-match |
| `src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx` | React client component | display | `UndoToast.tsx` | role-match |
| `src/app/(dashboard)/allocations/AllocationDashboard.tsx` (EDIT) | React dashboard shell | UI composition | itself (lines 27-34 component imports area) | exact (self-edit) |
| `src/lib/queries.ts` (EXTEND `getMyAllocationDashboard`) | DAL query | CRUD (read fan-out) | `src/lib/queries.ts:584-705` existing `getMyAllocationDashboard` | exact (extend) |
| `src/lib/audit.ts` (EXTEND `AuditAction`) | type-only extension | — | `src/lib/audit.ts:85-124` existing union | exact (extend) |
| `src/lib/bridge-outcome-label.ts` + `.test.ts` | pure utility + unit test | transform | no codebase analog — use research-pattern (pure date+delta→label fn) | no-analog |
| `src/__tests__/bridge-outcomes-rls.test.ts` | live-DB integration test | test | `src/__tests__/audit-log-rls.test.ts` | exact |
| `src/__tests__/bridge-outcome-cron.test.ts` | live-DB integration test | test | `src/__tests__/audit-log-rls.test.ts` + `retention-crons.test.ts` | role-match |
| `e2e/bridge-outcome.spec.ts` | Playwright E2E | test | `e2e/bridge-flow.spec.ts` | role-match |
| `docs/runbooks/bridge-outcome-cron.md` | runbook | docs | `docs/runbooks/match-engine.md` | exact |

---

## Pattern Assignments

### `supabase/migrations/059_bridge_outcomes.sql` — table + RLS + trigger (migration, CRUD)

**Analog:** `supabase/migrations/037_user_notes.sql` (full file, 167 lines)

**Structure template** — migration 037 ships table + partial unique indexes + updated_at trigger + 4 RLS policies + self-verify DO block, all inside a single `BEGIN; ... COMMIT;`. Mirror this shape exactly.

**Table-creation pattern** (lines 26-47):
```sql
BEGIN;

CREATE TABLE IF NOT EXISTS user_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  portfolio_id UUID REFERENCES portfolios ON DELETE CASCADE,
  content      TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 100000),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_notes IS '…see migration 037.';
```

Adapt for `bridge_outcomes`: columns per RESEARCH.md §Pattern 1 + the delta columns (`delta_30d`, `delta_90d`, `delta_180d`, `estimated_delta_bps`, `estimated_days`, `deltas_computed_at`, `needs_recompute`). Use `REFERENCES auth.users(id) ON DELETE CASCADE` for `allocator_id` (check against neighboring migrations — 037 uses `profiles`; match the convention of 054–058).

**Partial unique index pattern** (lines 54-61):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS user_notes_unique_per_portfolio
  ON user_notes (user_id, portfolio_id)
  WHERE portfolio_id IS NOT NULL;
```

Apply to `bridge_outcomes` as `UNIQUE (allocator_id, strategy_id)` (one outcome per allocator per strategy, enforcing D-17 "editable by owner" via UPDATE not repeated INSERT). Apply to `bridge_outcome_dismissals` as `UNIQUE (allocator_id, strategy_id)` per D-18.

**Touch-updated_at trigger** (lines 66-85):
```sql
CREATE OR REPLACE FUNCTION user_notes_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_notes_set_updated_at_trigger ON user_notes;
CREATE TRIGGER user_notes_set_updated_at_trigger
  BEFORE UPDATE ON user_notes
  FOR EACH ROW
  EXECUTE FUNCTION user_notes_set_updated_at();
```

Adapt: `bridge_outcomes_set_updated_at` + additionally flip `NEW.needs_recompute := TRUE` on the same trigger when `allocated_at` or `percent_allocated` changes (implements D-16 + D-17).

**Three-tier RLS pattern** (lines 93-110):
```sql
ALTER TABLE user_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notes_select_own ON user_notes;
CREATE POLICY user_notes_select_own ON user_notes FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_insert_own ON user_notes;
CREATE POLICY user_notes_insert_own ON user_notes FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_update_own ON user_notes;
CREATE POLICY user_notes_update_own ON user_notes FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_delete_own ON user_notes;
CREATE POLICY user_notes_delete_own ON user_notes FOR DELETE
  USING (user_id = auth.uid());
```

Adapt for `bridge_outcomes`: substitute `allocator_id` for `user_id`. **Omit DELETE policy** on `bridge_outcomes` (append-only per RESEARCH §Pattern 1). **Include DELETE policy** on `bridge_outcome_dismissals` per D-06 (owner-delete for explicit un-snooze if ever needed, plus retention).

**Admin-read addition** — use the migration 054 helper (from `supabase/migrations/056_retention_crons.sql:152-154`):
```sql
CREATE POLICY bridge_outcomes_admin_read ON bridge_outcomes FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']));
```

**Self-verifying DO block pattern** (lines 115-165):
```sql
DO $$
DECLARE
  v_rls_enabled BOOLEAN;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_notes'
  ) THEN
    RAISE EXCEPTION 'Migration 037 failed: user_notes table missing';
  END IF;
  -- …checks for each index, trigger, RLS, every policy…
  SELECT relrowsecurity INTO v_rls_enabled FROM pg_class
    WHERE relname = 'user_notes' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Migration 037 failed: RLS not enabled on user_notes';
  END IF;
  RAISE NOTICE 'Migration 037: …installed and verified.';
END
$$;
```

Adapt with assertions for both tables + all policies + the trigger + all indexes + the cron job (gated on `pg_extension extname='pg_cron'` per migration 056 pattern).

---

### `supabase/migrations/059_bridge_outcomes.sql` — pg_cron + SECURITY DEFINER fn (same file, scheduled-batch)

**Analog:** `supabase/migrations/056_retention_crons.sql` lines 179-366

**Extension-gated scheduling block** (lines 179-209):
```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron extension not installed — skipping retention crons. Enable in Supabase Dashboard → Database → Extensions and re-run this migration.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit_log_hot_to_cold') THEN
    PERFORM cron.unschedule('audit_log_hot_to_cold');
  END IF;

  PERFORM cron.schedule(
    'audit_log_hot_to_cold',
    '0 3 * * *',
    $cron$
      …SQL body here…
    $cron$
  );
```

Adapt: schedule `compute_bridge_outcome_deltas` at `'0 3 * * *'` (D-15) with body `$cron$ SELECT public.compute_bridge_outcome_deltas(); $cron$`. The scheduling block also handles the local-dev "pg_cron missing" graceful skip.

**Self-verify cron presence** (lines 463-476):
```sql
IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
  RAISE NOTICE 'Migration 056 self-verify: pg_cron not installed, skipping cron.job assertions.';
ELSE
  FOREACH jobname_probe IN ARRAY expected_jobs LOOP
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = jobname_probe) THEN
      RAISE WARNING 'Migration 056 self-verify: cron.job % not registered', jobname_probe;
      missing_count := missing_count + 1;
    END IF;
  END LOOP;
```

Adapt: assert `compute_bridge_outcome_deltas` exists in `cron.job` when pg_cron is installed.

**Function body** — RESEARCH.md §Pattern 3 provides the canonical skeleton (lines 407-451). Key invariants:
- `SECURITY DEFINER` + `SET search_path = public, pg_catalog`.
- Idempotency guard `WHERE bo.kind = 'allocated' AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)` (D-15, D-19).
- Single `UPDATE … FROM computed` statement so `needs_recompute = FALSE` is set atomically with delta writes.
- Return `INT` row-count via `GET DIAGNOSTICS v_rows_updated = ROW_COUNT`.
- Two helper functions `extract_delta(jsonb, date, int) → NUMERIC` and `extract_estimated(jsonb, date) → RECORD` — write as SQL-language where possible, **verify** the exact JSONB shape of `strategy_analytics.returns_series` before finalizing (see RESEARCH Pitfall 1).

---

### `src/app/api/bridge/outcome/route.ts` (API route, POST, request-response)

**Analog (primary):** `src/app/api/admin/match/decisions/route.ts` (full file, 146 lines)
**Analog (secondary, for Zod + rate-limit + user-scoped auth):** `src/app/api/intro/route.ts`

**Imports pattern** (decisions/route.ts:1-6 + intro/route.ts:12-19):
```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
```

Do NOT import `createAdminClient` for Phase 1 POST — RESEARCH §Anti-Patterns explicitly forbids admin-client in the user-facing route; RLS `WITH CHECK (allocator_id = auth.uid())` is the authorization boundary.

**CSRF + auth + rate-limit preamble** (intro/route.ts:72-91):
```typescript
export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkLimit(userActionLimiter, `intro:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
```

Adapt the rate-limit key to `bridge_outcome:${user.id}`.

**Zod schema pattern** (intro/route.ts:40-46) — extended with `superRefine` per RESEARCH §Pattern 2:
```typescript
const BODY_SCHEMA = z.object({
  strategy_id: z.string().uuid(),
  kind: z.enum(["allocated", "rejected"]),
  percent_allocated: z.number().min(0.1).max(50).optional(),
  allocated_at: z.string().date().optional(),   // YYYY-MM-DD
  rejection_reason: z.enum([
    "mandate_conflict","already_owned","timing_wrong",
    "underperforming_peers","other",
  ]).optional(),
  note: z.string().max(2000).nullish(),
}).superRefine((val, ctx) => {
  // Cross-field: allocated requires percent+date; rejected requires reason;
  // note required when rejection_reason === 'other'.
});
```

**Zod parse + error mapping** (intro/route.ts:109-116):
```typescript
const parsed = BODY_SCHEMA.safeParse(await req.json().catch(() => null));
if (!parsed.success) {
  return NextResponse.json(
    { error: "Invalid request body", issues: parsed.error.issues },
    { status: 400 },
  );
}
```

**OUTCOME-04 eligibility verify pattern** (RESEARCH §Pattern 2 lines 337-350, derived from this route family):
```typescript
const { data: decision } = await supabase
  .from("match_decisions")
  .select("id")
  .eq("allocator_id", user.id)
  .eq("strategy_id", parsed.data.strategy_id)
  .eq("decision", "sent_as_intro")
  .maybeSingle();
if (!decision) {
  return NextResponse.json(
    { error: "NOT_ELIGIBLE", reason: "No sent_as_intro for this strategy" },
    { status: 403 },
  );
}
```

**Insert + upsert pattern** (decisions/route.ts:50-71) — D-17 requires editable outcomes, so prefer `upsert` on `(allocator_id, strategy_id)` unique index with `.onConflict`:
```typescript
const { data: inserted, error } = await supabase
  .from("bridge_outcomes")
  .upsert(
    { allocator_id: user.id, strategy_id, kind, percent_allocated, allocated_at, rejection_reason, note, needs_recompute: true },
    { onConflict: "allocator_id,strategy_id" },
  )
  .select("id, kind, delta_30d, delta_90d, delta_180d, estimated_delta_bps, estimated_days")
  .single();

if (error) {
  console.error("[api/bridge/outcome] insert error:", error);
  return NextResponse.json({ error: "Failed to record outcome" }, { status: 500 });
}
```

**Audit-emission pattern** (decisions/route.ts:76-87):
```typescript
if (inserted?.id) {
  logAuditEvent(supabase, {
    action: "bridge_outcome.record", // or "bridge_outcome.update" for upsert-update
    entity_type: "bridge_outcome",
    entity_id: inserted.id as string,
    metadata: {
      strategy_id: body.strategy_id,
      kind: body.kind,
      percent_allocated: body.percent_allocated ?? null,
      rejection_reason: body.rejection_reason ?? null,
    },
  });
}

return NextResponse.json({ success: true, outcome: inserted });
```

`logAuditEvent` is `void` — never `await` it. Keep the emission **inline** within 60 lines of the `.upsert`/`.insert` call so the `audit-coverage.test.ts` meta-test passes (RESEARCH Wave 0 Gaps).

---

### `src/app/api/bridge/outcome/dismiss/route.ts` (API route, POST)

**Analog:** `src/app/api/admin/match/decisions/route.ts` + `src/app/api/bridge/outcome/route.ts` (sibling to be written).

Same preamble (CSRF → auth → rate-limit → Zod). Body is tiny: `{ strategy_id: z.string().uuid() }`. Upsert into `bridge_outcome_dismissals` with `expires_at = now() + interval '24 hours'` (D-07). Emit `bridge_outcome.dismiss` audit event.

---

### `src/app/api/bridge/outcome/route.test.ts` (unit test)

**Analog:** `src/app/api/intro/route.test.ts` (verified first 80 lines)

**Boilerplate for vitest + next/server mocking** (intro/route.test.ts:14-37):
```typescript
// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts schedules the RPC via next/server's `after()`. In tests we
// run the callback synchronously so the emission can be observed via
// `STATE.rpcCalls`.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => { void cb(); },
  };
});
```

**`STATE` + supabase-client mock pattern** (intro/route.test.ts:39-80+):
```typescript
const STATE = vi.hoisted(() => ({
  authUser: { id: "00000000-0000-0000-0000-000000000001", email: "alloc@test.sec" },
  profileRole: "allocator" as const,
  insertedRow: null as { id: string } | null,
  contactInsertPayload: null as Record<string, unknown> | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: STATE.authUser }, error: null }) },
    rpc: async (name, args) => { STATE.rpcCalls.push({ name, args }); return { data: null, error: null }; },
    from: (table) => { /* conditionally return mock for each table */ },
  }),
}));
```

Test cases to cover:
- Happy path (allocated) → 200 + insert payload shape + `bridge_outcome.record` rpc call observed.
- Happy path (rejected) → 200 + `rejection_reason` persisted.
- 401 on no user.
- 403 on missing `sent_as_intro` row.
- 400 on Zod failure (missing percent_allocated for allocated kind).
- 429 on rate-limit (mock `checkLimit` to return `{ success: false }`).

---

### `src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.tsx` (React client component)

**Analog:** `src/app/(dashboard)/allocations/components/UndoToast.tsx` (full file, 65 lines) for the client-component shell + inline-styled affordance pattern. `AlertBanner.tsx` (peer in the same folder) for the DESIGN.md-token banner treatment.

**Client-component shell** (UndoToast.tsx:1-11):
```tsx
"use client";

import { useEffect, useRef } from "react";

interface UndoToastProps {
  widgetName: string;
  onUndo: () => void;
  onDismiss: () => void;
}

export function UndoToast({ widgetName, onUndo, onDismiss }: UndoToastProps) {
```

Adapt the props shape for banner (`strategyId`, `onAllocated`, `onRejected`, `onDismiss`).

**Existing neighborhood styling quirks** (UndoToast.tsx:28-47):
```tsx
<div
  className="flex items-center justify-between rounded-lg bg-white px-4 py-3 text-sm"
  style={{
    border: "1px solid #E2E8F0",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    color: "#1A1A2E",
  }}
>
```

**Important neighborhood deviation:** `UndoToast` inlines `#E2E8F0` / `#1B6B5A`. RESEARCH §Anti-Patterns and DESIGN.md require tokens (`border-border`, `text-positive`). Follow RESEARCH guidance: use Tailwind tokens for new components; only inline hex if mirroring the immediate neighbor is necessary for visual cohesion, and then flag for cleanup. Preferred banner shell per RESEARCH §Code Examples:
```tsx
<div
  role="region"
  aria-label="Record outcome for Bridge-introduced strategy"
  className="border-t border-border bg-page px-4 py-3 text-sm text-text-primary flex items-center gap-3"
>
```

---

### `src/app/(dashboard)/allocations/components/AllocatedForm.tsx` / `RejectedForm.tsx`

**Analog:** `UndoToast.tsx` for the shell; `src/app/api/intro/route.ts` call-pattern on the client side is the precedent for `fetch("/api/bridge/outcome", { method: "POST", body: JSON.stringify(...) })` submission. No existing inline-form analog in the allocations widget — closest is the intro modal in the dashboard (inferred from intro/route.ts consumers). Forms should:
- Keep all state local (`useState`).
- Mirror the Zod schema on the client for validation symmetry (D-09, D-10).
- Call `onRecorded(outcomeRow)` on success so `AllocationDashboard.tsx` can swap the row.
- Render DM Sans body text; Geist Mono only for numeric affordances per DESIGN.md + D-01.

---

### `src/app/(dashboard)/allocations/AllocationDashboard.tsx` (MODIFY)

**Analog:** itself. Lines 27-33 show the existing component-import block where `BridgeOutcomeBanner` etc. will be added:
```tsx
import { KpiStrip } from "./components/KpiStrip";
import { DashboardGrid } from "./components/DashboardGrid";
import { AddWidgetModal } from "./components/AddWidgetModal";
import { UndoToast } from "./components/UndoToast";
import { AlertBanner } from "./components/AlertBanner";
```

Lines 39-63 show the `StrategyRow` interface — extend with `eligible_for_outcome?: boolean` and `existing_outcome?: { ... } | null` to thread eligibility from the server query into the Holdings widget row render.

**Insertion surface:** the Holdings widget is rendered via `WIDGET_COMPONENTS` (line 32 import) — planner must locate the Holdings widget inside `./widgets/` (not in the analog lookup set for this file since RESEARCH §Recommended Project Structure says the banner is rendered *inside* the Holdings row, not as a peer to `KpiStrip`). Read the Holdings widget file before writing the patch.

---

### `src/lib/queries.ts` — EXTEND `getMyAllocationDashboard`

**Analog:** itself, lines 584-705.

**Existing fan-out pattern** (queries.ts:607-650):
```typescript
const [analyticsRes, strategiesRes, apiKeys, alertsRes] =
  await Promise.all([
    admin.from("portfolio_analytics").select("*").eq(...)...,
    admin.from("portfolio_strategies").select(`strategy_id, current_weight, …`).eq(...)...,
    getUserApiKeys(userId),
    supabase.from("portfolio_alerts").select("id, severity").eq(...).is(...)
  ]);
```

**Extension pattern** (RESEARCH.md §Code Examples lines 552-567) — add three more entries to the `Promise.all`:
```typescript
admin
  .from("match_decisions")
  .select("strategy_id")
  .eq("allocator_id", userId)
  .eq("decision", "sent_as_intro"),
admin
  .from("bridge_outcomes")
  .select("strategy_id, id, kind, percent_allocated, allocated_at, rejection_reason, note, delta_30d, delta_90d, delta_180d, estimated_delta_bps, estimated_days, needs_recompute, created_at")
  .eq("allocator_id", userId),
admin
  .from("bridge_outcome_dismissals")
  .select("strategy_id, expires_at")
  .eq("allocator_id", userId)
  .gt("expires_at", new Date().toISOString()),
```

Post-process into `Set<string>` per category, attach `eligible_for_outcome` + `existing_outcome` to each `strategies` row.

**`castRow` normalization pattern** (queries.ts:657-679):
```typescript
const strategies = (strategiesRes.data ?? []).map((row) => {
  const rawStrategy = castRow<{ strategy: unknown }>(row, "strategy-join").strategy;
  const strategy = (Array.isArray(rawStrategy) ? rawStrategy[0] : rawStrategy) as StrategyPayload;
  …
});
```

Reuse for the new joins; RESEARCH §Don't Hand-Roll points at `castRow` / `castRows` for all PostgREST type work.

---

### `src/lib/audit.ts` — EXTEND `AuditAction`

**Analog:** itself, lines 85-124.

**Existing union** (audit.ts:85-124):
```typescript
export type AuditAction =
  // --- 7.1a pilot -------------------------------------------------------
  | "api_key.decrypt"
  | "intro.send"
  …
```

**Extension** (RESEARCH §Code Examples lines 529-537):
```typescript
// --- Sprint 8 Phase 1 ---
| "bridge_outcome.record"
| "bridge_outcome.update"
| "bridge_outcome.dismiss";
```

And extend `AuditEntityType` (lines 134-159) with `"bridge_outcome"` + `"bridge_outcome_dismissal"`.

Update `docs/architecture/adr-0023-audit-event-taxonomy.md` in the same PR per RESEARCH §Code Examples.

---

### `src/__tests__/bridge-outcomes-rls.test.ts` (live-DB integration)

**Analog:** `src/__tests__/audit-log-rls.test.ts` (verified lines 1-80)

**Header + helper pattern** (audit-log-rls.test.ts:1-42):
```typescript
/**
 * Integration test — Migration 049 audit_log hardening.
 * …
 * Gate: requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
 * Skips gracefully in CI where those point to the placeholder…
 */

import { describe, it, expect } from "vitest";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
```

**Seed helper pattern** (audit-log-rls.test.ts:48-68):
```typescript
async function seedAuditRow(admin, userId, marker): Promise<string> {
  const { data, error } = await admin
    .from("audit_log")
    .insert({ user_id: userId, action: `__test_${marker}`, … })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed audit_log row…`);
  return data.id as string;
}
```

Test cases to cover (OUTCOME-03):
- Owner can SELECT own row.
- Other user cannot SELECT another allocator's row (zero rows returned).
- Admin (via `current_user_has_app_role`) can SELECT all rows.
- Owner INSERT with `allocator_id = auth.uid()` succeeds; with a spoofed id, `WITH CHECK` rejects.
- DELETE is not policied (assert 0 rows affected or an error) — append-only invariant.

---

### `src/__tests__/bridge-outcome-cron.test.ts` (live-DB integration)

**Analog:** `src/__tests__/audit-log-rls.test.ts` (structure) + `retention-crons.test.ts` (cron-function invocation pattern).

Seed `strategy_analytics.returns_series` fixture with a known equity curve, insert a `bridge_outcomes` row with `kind='allocated'`, `allocated_at`, and `needs_recompute=TRUE`. Call `admin.rpc("compute_bridge_outcome_deltas")`. Assert:
- `delta_30d` / `delta_90d` / `delta_180d` match hand-computed values (± ε).
- `needs_recompute` flipped to FALSE.
- Second invocation is a no-op (OUTCOME-06 / OUTCOME-07 idempotency).
- `rejected` rows are not touched (D-19).

---

### `e2e/bridge-outcome.spec.ts` (Playwright)

**Analog:** `e2e/bridge-flow.spec.ts` (verified first 60 lines)

**Structure pattern** (bridge-flow.spec.ts:1-46):
```typescript
import { test, expect } from "@playwright/test";

test.describe("Bridge flow", () => {
  test("InsightStrip renders on the demo page", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("networkidle");
    const insightSection = page.getByRole("region", { name: "Portfolio insights" });
    await expect(insightSection).toBeVisible();
  });
  …
});
```

**CI gating** per D-20: wrap the whole `test.describe` in `test.skip(!process.env.HAS_SEEDED_SUPABASE, "requires seeded Supabase CI")`. Happy-path scenario: login as seeded allocator → navigate `/allocations` → banner visible on eligible row → click `[Allocated]` → fill form → submit → expect `Recorded: Allocated …` status line.

---

### `docs/runbooks/bridge-outcome-cron.md` (runbook, docs)

**Analog:** `docs/runbooks/match-engine.md` (verified first 60 lines)

**Structure template** (match-engine.md:1-35):
```markdown
# Match Engine Runbook

Operational guide for the Perfect Match Engine (founder-amplifier). See the implementation plan at `docs/superpowers/plans/…`.

## Overview
- **What it does:** …
- **Who sees it:** …

## Deploy checklist
1. Migration 011 applied to staging: …
2. …

## Common issues
### Engine returning empty queues for everyone
1. **Kill switch?** …
2. …
```

Adapt sections: Overview (cron schedule, what it computes, where logs land), Deploy checklist (migration 059 applied + self-verify notice emitted + `SELECT cron.jobname FROM cron.job WHERE jobname = 'compute_bridge_outcome_deltas'`), Common issues (pg_cron missing; `needs_recompute` never clears; JSONB shape drift; rejected rows computed in error).

---

## Shared Patterns

### Shared: CSRF + auth + rate-limit preamble
**Source:** `src/app/api/intro/route.ts:72-91` + `src/app/api/admin/match/decisions/route.ts:15-24`
**Apply to:** `src/app/api/bridge/outcome/route.ts`, `src/app/api/bridge/outcome/dismiss/route.ts`

```typescript
const csrfError = assertSameOrigin(req);
if (csrfError) return csrfError;

const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const rl = await checkLimit(userActionLimiter, `bridge_outcome:${user.id}`);
if (!rl.success) {
  return NextResponse.json({ error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
}
```

### Shared: Audit emission (fire-and-forget)
**Source:** `src/lib/audit.ts:178-193` + `src/app/api/admin/match/decisions/route.ts:76-87`
**Apply to:** both bridge outcome routes

```typescript
logAuditEvent(supabase, {
  action: "bridge_outcome.record",
  entity_type: "bridge_outcome",
  entity_id: inserted.id as string,
  metadata: { /* structured fields, never free-text interpolation */ },
});
```
Never `await`; keep call inline within ~60 lines of the mutation so `audit-coverage.test.ts` passes.

### Shared: Three-tier RLS (owner-select/insert/update + admin-select)
**Source:** `supabase/migrations/037_user_notes.sql:93-110` + `supabase/migrations/056_retention_crons.sql:152-154`
**Apply to:** `bridge_outcomes`, `bridge_outcome_dismissals`

Service-role bypass is implicit (no explicit policy). Admin-read uses `public.current_user_has_app_role(ARRAY['admin'])`, not the legacy `profiles.is_admin` column.

### Shared: Zod safe-parse + issue pass-through
**Source:** `src/app/api/intro/route.ts:109-116`
**Apply to:** both bridge outcome routes

```typescript
const parsed = BODY_SCHEMA.safeParse(await req.json().catch(() => null));
if (!parsed.success) {
  return NextResponse.json(
    { error: "Invalid request body", issues: parsed.error.issues },
    { status: 400 },
  );
}
```

### Shared: Self-verifying migration DO block
**Source:** `supabase/migrations/037_user_notes.sql:115-165` + `supabase/migrations/056_retention_crons.sql:376-480`
**Apply to:** `supabase/migrations/059_bridge_outcomes.sql`

Every migration terminates in a DO block asserting tables, indexes, triggers, RLS enabled, every named policy, and (pg_cron-gated) every cron job. A missing artifact raises EXCEPTION → transaction rollback.

### Shared: Route-test vitest mocking of `server-only` + `after`
**Source:** `src/app/api/intro/route.test.ts:14-37`
**Apply to:** `src/app/api/bridge/outcome/route.test.ts` + dismiss variant

### Shared: Live-DB gate helper
**Source:** `src/__tests__/audit-log-rls.test.ts:31-42` (imports from `@/lib/test-helpers/live-db`)
**Apply to:** `src/__tests__/bridge-outcomes-rls.test.ts`, `src/__tests__/bridge-outcome-cron.test.ts`

Use `HAS_LIVE_DB`, `createLiveAdminClient`, `createTestUser`, `cleanupLiveDbRow`, `advertiseLiveDbSkipReason` to gate and clean up.

---

## No Analog Found

| File | Role | Data Flow | Reason / Fallback |
|------|------|-----------|-------------------|
| `src/lib/bridge-outcome-label.ts` + `.test.ts` | pure utility (date+delta→label) | transform | No existing pure-label helper in codebase. Use RESEARCH D-12 spec directly: inputs `{ allocated_at, delta_30d, delta_90d, delta_180d, estimated_delta_bps, estimated_days, today }` → output `{ label: 'Pending' \| 'Estimated' \| '30-day' \| '90-day' \| '180-day', value: string, tone: 'neutral' \| 'positive' \| 'negative' }`. Test cases: day 0, day 1, day 29, day 30, day 89, day 90, day 179, day 180, day 181, cron-failed (all null, days>=30 → Pending per D-14). ~15 cases. |

---

## Metadata

**Analog search scope:**
- `supabase/migrations/` (all)
- `src/app/api/` (admin/match/*, intro, bridge/*)
- `src/app/(dashboard)/allocations/` (full tree)
- `src/lib/` (queries.ts, audit.ts)
- `src/__tests__/` (live-DB + RLS tests)
- `e2e/` (bridge + auth specs)
- `docs/runbooks/` (runbook style)

**Files scanned (directly read or grep-verified):** 12
**Pattern extraction date:** 2026-04-17
