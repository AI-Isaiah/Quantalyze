# Phase 1: Outcome Tracker — Research

**Researched:** 2026-04-17
**Domain:** Next.js 16 App Router + Supabase (Postgres RLS) migration + POST route + inline banner UI + pg_cron delta job + audit logging
**Confidence:** HIGH (stack, patterns, RLS template) · MEDIUM (exact cron scheduling path) · MEDIUM (E2E CI wire-up)

## Summary

Phase 1 is almost entirely additive work against well-established patterns already proven in 58 applied migrations. Two new tables (`bridge_outcomes`, `bridge_outcome_dismissals`) follow the canonical three-tier RLS template (owner-* + admin-read via `current_user_has_app_role` + service_insert). A new POST `/api/bridge/outcome` route mirrors the existing match-decisions route almost verbatim (CSRF → auth → Zod → upsert → `logAuditEvent` → response). The banner UI drops into the existing `AllocationDashboard.tsx` grid shell. The trickiest surfaces are (a) the delta computation SQL — because `strategy_analytics.returns_series` stores a **cumulative equity curve** not raw daily returns, and (b) cron scheduling — the Vercel Hobby cap is already at 2/2 after commit 786e6c7, so the new daily cron **MUST** run via Supabase `pg_cron` (pattern: migrations 015, 056), not Vercel Cron.

**Primary recommendation:** Follow migration 037 (`user_notes`) as the exact template for the two new tables + RLS + trigger. Mirror `src/app/api/admin/match/decisions/route.ts` for the POST route handler shape. Schedule the daily delta job via `pg_cron` inside the outcome-tracker migration (pattern: migration 056), calling a SQL-resident SECURITY DEFINER function (no `pg_net` round-trip needed — delta math is pure Postgres against `strategy_analytics.returns_series`). Audit logging extends the existing `AuditAction` union with `bridge_outcome.record` and `bridge_outcome.update`, entity_type `bridge_outcome`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Banner UX**
- **D-01:** Row-integrated strip appears beneath each eligible Holdings row: text prompt "Did you act on this Bridge suggestion?" with `[Allocated]` `[Rejected]` `[×]` buttons. No card-above-table; no expand-to-open chip. Strip styling must align with DESIGN.md (DM Sans body, Geist Mono for numeric labels elsewhere).
- **D-02:** Banner surface is the **My Allocation Holdings widget** only (`src/app/(dashboard)/allocations/`). No standalone Bridge Outcomes page in Phase 1.
- **D-03:** Eligibility filter runs **server-side**: banner never renders unless the row has a matching `match_decisions.decision = 'sent_as_intro'` AND no existing `bridge_outcomes` row AND not currently snoozed. Client relies on the server list; no client-only filter fallback.
- **D-04:** OUTCOME-04 enforcement is strict: server-side join verification at list-time means banner is never shown for non-eligible rows. POST handler still performs belt-and-suspenders check and returns 403 with structured error if called for an ineligible strategy (defense in depth).

**Dismiss Behavior (server-side snooze)**
- **D-05:** Dismiss is **server-side with TTL**, not client sessionStorage.
- **D-06:** Add table `bridge_outcome_dismissals` (allocator_id, match_candidate_id or strategy_id reference, dismissed_at, expires_at). RLS: owner-read, owner-insert, owner-delete; admin-read; service-role-all.
- **D-07:** Snooze TTL = **24 hours**. Banner query excludes rows where a non-expired dismissal exists. No manual "undismiss" UI.

**Recording Form**
- **D-08:** Two separate flows (`[Allocated]` → allocated form; `[Rejected]` → rejected form). Forms render inline (replace the banner strip on that row, not a modal).
- **D-09:** Allocated fields: `percent_allocated` (required, 0.1–50%; if the allocator has `max_weight` set from Phase 2, soft-warn but do not block when exceeding it), `allocated_at` (date, required, not future, not >365d past), `note` (optional textarea, nullable). Client + server validation.
- **D-10:** Rejected fields: `rejection_reason` (required; enum: `mandate_conflict`, `already_owned`, `timing_wrong`, `underperforming_peers`, `other`), `note` (optional textarea; required when reason = `other`). Enum drives structured signal for Phase 4.
- **D-11:** Save behavior: inline replace + success toast. Status line example: `Recorded: Allocated 12% on 2026-04-17 • Estimated +1.2% (3d)`. Toast copy: "Outcome recorded".

**Estimated Delta Labels**
- **D-12:** Label progression follows exact days available: Day 0 → `Pending`; Days 1–29 → `Estimated: +X.X% (Nd)`; Day 30+ → `30-day: +X.X%`; Day 90 → `90-day: +X.X%`; Day 180 → `180-day: +X.X%`. Always show the most-mature label available.
- **D-13:** Color: green/red ONLY on realized windows (30d/90d/180d). Estimated + Pending are neutral.
- **D-14:** Row-level cron failure → keep user-facing label as **Pending**. Structured error goes to admin operational logs. `needs_recompute` stays `true` so next cron retry picks it up.

**Cron + needs_recompute**
- **D-15:** Daily cron `compute_bridge_outcome_deltas` runs once per day (schedule: 03:00 UTC). Idempotent guard: `WHERE delta_30d IS NULL OR needs_recompute = true`. Re-running same day produces identical values.
- **D-16:** `needs_recompute` flag is set `true` on every upsert to `bridge_outcomes`. Cron clears it after successful compute per row.

### Claude's Discretion
- Database column names, indexes, and constraint naming conventions — follow existing migration style (055–058 range).
- React component structure (separate `BridgeOutcomeBanner`, `AllocatedForm`, `RejectedForm` vs one composite — pick what matches existing allocations widget patterns).
- Toast library: reuse whatever the existing dashboard uses — do not introduce a new one.
- Error copy refinements within the spirit of D-11/D-14.
- Animation/transition specifics for banner → form → recorded-row inline replace.
- Banner visual treatment details (border color, padding, typography) — must follow DESIGN.md.

### Deferred Ideas (OUT OF SCOPE)
- Standalone Bridge Outcomes page (deferred to Phase 5 Outcomes Dashboard).
- Client-only sessionStorage dismiss (rejected in favor of server-side TTL).
- Retry button on cron-failed delta rows (rejected — admin-only concern; user sees Pending).
- Full column-level RLS on `bridge_outcomes` (deferred indefinitely — Postgres limitation; RPC pattern is sufficient).
- Cron observability dashboard / success rate chart — Phase 5 admin-facing work if needed.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OUTCOME-01 | Allocator can record outcome via inline banner on Holdings row | `AllocationDashboard.tsx` is insertion surface; new POST `/api/bridge/outcome` mirrors `admin/match/decisions/route.ts`; inline strip replaces row's sub-area (no modal). |
| OUTCOME-02 | Banner only for rows with prior `sent_as_intro` + no existing outcome (dismissible, reappears) | Server-side eligibility join (migration 011's `match_decisions.decision = 'sent_as_intro'` partial unique index); dismissals via new `bridge_outcome_dismissals` (TTL 24h per D-07). |
| OUTCOME-03 | `bridge_outcomes` enforces three-tier RLS (owner-select, owner-insert, admin-select, service-role-all) | Migration 037 (`user_notes`) is the exact owner-* template; admin-read pattern uses `current_user_has_app_role(ARRAY['admin'])` (migration 054); service-role bypasses RLS by default so no explicit `service_all` policy needed (pattern: every user-scoped table post-054). |
| OUTCOME-04 | Recording blocks if allocator never received strategy as Bridge intro | Server-side eligibility filter at list-time (D-03) AND defense-in-depth check inside POST route (D-04) joining `match_decisions` for `sent_as_intro`. |
| OUTCOME-05 | UI shows estimated delta immediately; label upgrades as windows complete | Delta SQL reads `strategy_analytics.returns_series` (JSONB cumulative equity array); label-progression logic lives client-side driven by row's `delta_30d` / `delta_90d` / `delta_180d` / `estimated_delta_bps` / `estimated_days` columns. |
| OUTCOME-06 | Daily cron computes 30/90/180d realized delta from `returns_series`; idempotent via `WHERE delta_30d IS NULL` | pg_cron schedule (Vercel Hobby cap at 2/2 — MUST be pg_cron, not Vercel); SECURITY DEFINER function does pure-SQL math against the JSONB equity curve. |
| OUTCOME-07 | Upsert triggers delta recomputation via `needs_recompute` flag | Add `needs_recompute BOOLEAN NOT NULL DEFAULT TRUE` column; cron `WHERE delta_30d IS NULL OR needs_recompute = TRUE`; after success, `UPDATE ... SET needs_recompute = FALSE`. |
| OUTCOME-08 | Every outcome recording + update logged via `log_audit_event` with `entity_type = 'bridge_outcome'` | Extend `AuditAction` union in `src/lib/audit.ts` with `bridge_outcome.record` + `bridge_outcome.update`; emit fire-and-forget via existing `logAuditEvent()` per ADR-0023. |
</phase_requirements>

## Project Constraints (from CLAUDE.md + AGENTS.md)

1. **Next.js 16 has breaking changes from training data.** AGENTS.md instructs: read `node_modules/next/dist/docs/` before writing Next code. Known differences: `middleware.ts` is now `proxy.ts`; route dynamic `params` are `Promise<{...}>` and must be awaited; `after()` comes from `next/server` (not a React hook); `"use cache"` exists but is rejected per ADR-0002. **Version verified:** `next@16.2.4` is latest (npm registry, 2026-04-17); project pins `^16.2.3` → resolves to 16.2.4. **[VERIFIED]**
2. **Banned packages** (CI-enforced): `axios`, `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai`. Use native `fetch()`. **[VERIFIED: scripts/check-banned-packages.mjs]**
3. **DESIGN.md conformance is mandatory.** DM Sans body, Geist Mono for numerics, teal `#1B6B5A` accent, institutional aesthetic. Banner styling must use Tailwind tokens (`bg-accent`, `text-positive`, `border-border`) not hardcoded hex. **[CITED: DESIGN.md]**
4. **No Server Actions** (`"use server"` is not used anywhere). Mutations land as `src/app/api/**/route.ts` route handlers. **[VERIFIED: CONVENTIONS.md]**
5. **Root-cause-obsession + simplicity-first** (global CLAUDE.md). Minimal diff. No bandaids.
6. **All commentary must be deterministic — no LLM-generated text.** Phase 1 has no LLM surface; remains compliant.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Outcome persistence + RLS | Database (Postgres) | — | Authoritative authorization lives in RLS per ADR-0001; the table IS the source of truth. |
| Outcome recording validation | API (Next route handler) | Database (RLS belt-and-suspenders) | Zod parsing + eligibility join + rate limit + CSRF live at the route; RLS `WITH CHECK (user_id = auth.uid())` backstops. |
| Eligibility query (banner visibility) | API / DAL (Server Component reading via Supabase) | Database (RLS) | Server Component on `/allocations` extends `getMyAllocationDashboard` with a JOIN against `match_decisions` + `bridge_outcomes` + `bridge_outcome_dismissals`. Client never filters. |
| Dismiss TTL | Database (`expires_at > now()`) | API (validates `match_decision` exists before insert) | TTL enforcement is `WHERE expires_at > now()` in the banner query — no cron needed to prune (old dismissals simply fail the predicate). |
| Daily delta computation | Database (pg_cron + SECURITY DEFINER function) | — | Pure SQL against `strategy_analytics.returns_series` JSONB; no Python round-trip; no Vercel-cron path (Hobby cap is 2/2). |
| Inline banner + forms | Browser / Client (React) | API (POST `/api/bridge/outcome`) | `"use client"` components inside `src/app/(dashboard)/allocations/`; form submit → fetch POST → re-render parent. |
| Audit logging | Database (`log_audit_event` SECURITY DEFINER) | API (fire-and-forget emitter) | `logAuditEvent(supabase, {...})` from route handler per ADR-0023. |

## Runtime State Inventory

> Phase 1 is greenfield (additive) — NOT a rename/refactor. This section is intentionally minimal.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — two NEW tables (`bridge_outcomes`, `bridge_outcome_dismissals`) + one NEW pg_cron job | No data migration. |
| Live service config | None. `vercel.json` has 2/2 crons (`warm-analytics`, `alert-digest`) — **CANNOT add a third.** New cron MUST be pg_cron inside Supabase. | No change to `vercel.json`. Register cron via migration. |
| OS-registered state | None | — |
| Secrets/env vars | None new. Existing `SUPABASE_SERVICE_ROLE_KEY` + `ADMIN_EMAIL` cover it. | — |
| Build artifacts | None | — |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `16.2.3` (project) / `16.2.4` (current on npm) | App Router + route handlers + `after()` for fire-and-forget audit | Already in project. **[VERIFIED: npm view next version → 16.2.4, 2026-04-17]** |
| `react` / `react-dom` | `19.2.4` | UI primitives | Already in project. Note: React 19 Compiler is active; some widgets use `"use no memo"` escape hatch. **[VERIFIED: package.json]** |
| `@supabase/ssr` | `^0.10.0` | Cookie-bridged server client for the route handler | Already in project; used by every authenticated route. **[VERIFIED]** |
| `@supabase/supabase-js` | `^2.101.1` | Admin client for cross-tenant queries (only used in server components here, never in the new route handler which is user-scoped) | Already in project. **[VERIFIED]** |
| `zod` | `^4.3.6` | Request body validation on POST `/api/bridge/outcome` | Canonical pattern — every route handler uses it. **[VERIFIED]** |
| Tailwind CSS v4 | `^4` | Banner styling via DESIGN.md tokens | Already in project. **[VERIFIED]** |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@upstash/ratelimit` | `^2.0.8` | Rate limit `POST /api/bridge/outcome` per allocator | Reuse `userActionLimiter` (sensitive write tier). **[VERIFIED: src/lib/ratelimit.ts]** |
| `vitest` + `@testing-library/react` | `^4.1.2` / `^16.3.2` | Route handler + component unit tests | Reuse `src/app/api/intro/route.test.ts` as the template. **[VERIFIED]** |
| `playwright` | `^1.59.1` | E2E banner-eligibility happy path | See Validation Architecture below — **CI wire-up required for any new spec** (CONCERNS.md: only 4/21 specs run in CI). **[VERIFIED]** |
| Project-internal `Modal` / `Card` / `Button` from `src/components/ui/` | — | Banner/form building blocks | Always prefer project primitives over ad-hoc div work. |
| Project toast (`UndoToast` inline + `role="alert"` pattern) | — | "Outcome recorded" confirmation | **NOTE:** The codebase has NO shared toast primitive — `UndoToast` is bespoke in `src/app/(dashboard)/allocations/components/UndoToast.tsx`. Admin UI uses native `alert()`/`confirm()` (CONCERNS.md LOW-03/04/05). **Recommendation: add a tiny `Toast` component next to `UndoToast` or reuse `UndoToast`'s shell** — do NOT introduce `sonner`/`react-hot-toast`/`react-toastify` (violates CLAUDE.md "simplicity first" + adds an unvetted dep). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pg_cron for delta computation | Vercel Cron | **Rejected.** Hobby cap is 2/2, and `src/__tests__/vercel-cron-limits.test.ts` fails the build on a 3rd entry. Upgrade to Pro is a separate decision (per `docs/runbooks/vercel-cron-upgrade.md`). |
| pg_cron with SQL-resident SECURITY DEFINER fn | pg_cron → `pg_net.http_post` → FastAPI | **Rejected.** Pure SQL against `returns_series` JSONB is simpler; no service-key plumbing; no extra failure surface. Analytics service is busy with compute_jobs dispatch. |
| SECURITY DEFINER RPC for user-side upsert | Regular INSERT through RLS | **For Phase 1, prefer regular INSERT.** Phase 2 uses SECURITY DEFINER for mandate writes because Phase 2 revokes direct UPDATE on `allocator_preferences`. Phase 1 does NOT revoke direct inserts on `bridge_outcomes` — the RLS `WITH CHECK (allocator_id = auth.uid())` is sufficient. If a future reviewer asks "why not SECURITY DEFINER here?", the answer is: no `REVOKE INSERT` is planned, so the RPC adds nothing. |
| New top-level `/bridge` route group | Keep banner inside `/allocations` | **D-02 locks this.** No standalone Bridge Outcomes page in Phase 1. |
| Server Action for form submit | Route handler | **Rejected per CONVENTIONS.md** — no `"use server"` anywhere. |

**Installation:** No new npm packages. No new Python packages. Phase 1 is code-only on top of the existing stack.

**Version verification (performed 2026-04-17):**
```bash
npm view next version  # → 16.2.4 (current); project pins ^16.2.3
```

## Architecture Patterns

### System Architecture Diagram

```
Allocator Browser
  │
  │ GET /allocations (SSR)
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Server Component: src/app/(dashboard)/allocations/page.tsx   │
│   ├─ createClient() + auth.getUser()                          │
│   └─ getMyAllocationDashboard(user.id)         ← extend here │
│         │                                                     │
│         ├─ portfolio_strategies + strategy_analytics          │
│         ├─ NEW: LEFT JOIN match_decisions (sent_as_intro)     │
│         ├─ NEW: LEFT JOIN bridge_outcomes (existing?)         │
│         ├─ NEW: LEFT JOIN bridge_outcome_dismissals           │
│         │                    WHERE expires_at > now()         │
│         └─ returns eligibility flag per row                   │
└───────────────────┬──────────────────────────────────────────┘
                    │ props
                    ▼
┌──────────────────────────────────────────────────────────────┐
│ "use client" AllocationDashboard.tsx → Holdings widget       │
│    ├─ renders row                                             │
│    └─ if eligible: renders <BridgeOutcomeBanner row={r}>     │
│           ├─ [Allocated] → <AllocatedForm>                    │
│           ├─ [Rejected]  → <RejectedForm>                     │
│           └─ [×]         → POST /api/bridge/outcome/dismiss   │
└──────────────────────────────┬───────────────────────────────┘
                               │ fetch POST (JSON body)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ src/app/api/bridge/outcome/route.ts (NEW)                    │
│    1. assertSameOrigin(req)              (CSRF)               │
│    2. supabase.auth.getUser()            (401 if null)        │
│    3. checkLimit(userActionLimiter, ...) (429)                │
│    4. Zod parse body                                          │
│    5. JOIN verify sent_as_intro exists   (403 if not)         │
│    6. INSERT INTO bridge_outcomes        (RLS WITH CHECK)     │
│    7. logAuditEvent({action: 'bridge_outcome.record', ...})   │
│    8. NextResponse.json({ success: true, outcome })           │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
                         Postgres (RLS)
                               │
                               │ (daily, 03:00 UTC)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ pg_cron: compute_bridge_outcome_deltas                        │
│    Runs SECURITY DEFINER SQL function                         │
│    FOR EACH row WHERE delta_30d IS NULL OR needs_recompute   │
│      ├─ Fetch strategy_analytics.returns_series (JSONB)       │
│      ├─ Compute delta_Nd from equity at allocated_at + Nd     │
│      ├─ UPDATE bridge_outcomes                                │
│      └─ SET needs_recompute = FALSE                           │
└──────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| File | Responsibility |
|------|----------------|
| `supabase/migrations/059_bridge_outcomes.sql` (NEW) | Create `bridge_outcomes` + `bridge_outcome_dismissals` + RLS + indexes + cron job + delta function |
| `src/lib/queries.ts` (EXTEND) | Extend `getMyAllocationDashboard` with eligibility JOINs |
| `src/lib/audit.ts` (EXTEND) | Add `bridge_outcome.record`, `bridge_outcome.update`, `bridge_outcome.dismiss` to `AuditAction` union |
| `src/app/api/bridge/outcome/route.ts` (NEW) | POST handler — record outcome |
| `src/app/api/bridge/outcome/dismiss/route.ts` (NEW) | POST handler — create TTL dismissal |
| `src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.tsx` (NEW) | Inline strip with the three buttons |
| `src/app/(dashboard)/allocations/components/AllocatedForm.tsx` (NEW) | Inline form for allocated flow |
| `src/app/(dashboard)/allocations/components/RejectedForm.tsx` (NEW) | Inline form for rejected flow |
| `src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx` (NEW) | Status line after successful record |
| Existing `UndoToast.tsx` pattern (REUSE/EXTEND) | Success toast primitive — copy the shell into a reusable `Toast.tsx` or keep an ad-hoc inline success toast |

### Recommended Project Structure

```
supabase/migrations/
└── 059_bridge_outcomes.sql          ← new

src/
├── app/
│   ├── api/
│   │   └── bridge/
│   │       └── outcome/
│   │           ├── route.ts          ← new (POST)
│   │           ├── route.test.ts     ← new
│   │           └── dismiss/
│   │               ├── route.ts      ← new (POST, body: { strategy_id } → insert dismissal)
│   │               └── route.test.ts ← new
│   └── (dashboard)/
│       └── allocations/
│           ├── AllocationDashboard.tsx  ← minor edit: thread eligibility into row render
│           └── components/
│               ├── BridgeOutcomeBanner.tsx  ← new
│               ├── AllocatedForm.tsx        ← new
│               ├── RejectedForm.tsx         ← new
│               └── OutcomeRecordedRow.tsx   ← new
└── lib/
    ├── audit.ts                      ← extend AuditAction union
    └── queries.ts                    ← extend getMyAllocationDashboard
```

### Pattern 1: Three-tier RLS template (mirror migration 037)

**What:** Owner-scoped SELECT/INSERT/UPDATE/DELETE via `user_id = auth.uid()` + admin-read via `current_user_has_app_role(ARRAY['admin'])` + service-role bypass (implicit via service-role JWT).
**When to use:** Every user-owned table post-054.

```sql
-- Source: supabase/migrations/037_user_notes.sql (verified local file)
ALTER TABLE bridge_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY bridge_outcomes_select_own ON bridge_outcomes FOR SELECT
  USING (allocator_id = auth.uid());

CREATE POLICY bridge_outcomes_insert_own ON bridge_outcomes FOR INSERT
  WITH CHECK (allocator_id = auth.uid());

CREATE POLICY bridge_outcomes_update_own ON bridge_outcomes FOR UPDATE
  USING (allocator_id = auth.uid())
  WITH CHECK (allocator_id = auth.uid());

-- No DELETE policy — outcomes are append-only (per institutional-audit principle).
-- If a user wants to "undo", they submit a corrective update; the audit trail
-- records both. Omitting DELETE eliminates the data-loss surface entirely.

-- Admin read — mirrors migration 054/056 pattern
CREATE POLICY bridge_outcomes_admin_read ON bridge_outcomes FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']));
```

**`service-role-all`** is implicit: service_role bypasses RLS by default in Supabase Postgres unless explicit DENY policies are added (ADR-0003). The cron function uses service-role (or SECURITY DEFINER owner) — no service_role policy needed. OUTCOME-03 language "service-role-all" is satisfied by this default; add an explicit comment in the migration noting this.

### Pattern 2: Route handler (mirror `intro/route.ts` + `admin/match/decisions/route.ts`)

**What:** CSRF → auth → rate-limit → Zod parse → DB work → audit → response.
**When to use:** Every mutation route.

```typescript
// Source: src/app/api/admin/match/decisions/route.ts (verified local file)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { checkLimit, userActionLimiter } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

const BODY_SCHEMA = z.object({
  strategy_id: z.string().uuid(),
  kind: z.enum(["allocated", "rejected"]),
  percent_allocated: z.number().min(0.1).max(50).optional(),
  allocated_at: z.string().date().optional(),   // YYYY-MM-DD
  rejection_reason: z.enum([
    "mandate_conflict", "already_owned", "timing_wrong",
    "underperforming_peers", "other",
  ]).optional(),
  note: z.string().max(2000).nullish(),
}).superRefine((val, ctx) => {
  // Cross-field: allocated requires percent+date; rejected requires reason
  // + note required when reason === 'other'
  // (full impl in plan)
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkLimit(userActionLimiter, `bridge_outcome:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const parsed = BODY_SCHEMA.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // OUTCOME-04 eligibility check — belt-and-suspenders over RLS
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

  const { data: inserted, error } = await supabase
    .from("bridge_outcomes")
    .insert({ allocator_id: user.id, /* ...mapped fields... */ })
    .select("id, delta_30d, delta_90d, delta_180d, estimated_delta_bps, estimated_days")
    .single();

  if (error) {
    console.error("[api/bridge/outcome] insert error:", error);
    return NextResponse.json({ error: "Failed to record outcome" }, { status: 500 });
  }

  logAuditEvent(supabase, {
    action: "bridge_outcome.record",
    entity_type: "bridge_outcome",
    entity_id: inserted.id as string,
    metadata: {
      strategy_id: parsed.data.strategy_id,
      kind: parsed.data.kind,
      percent_allocated: parsed.data.percent_allocated ?? null,
      rejection_reason: parsed.data.rejection_reason ?? null,
    },
  });

  return NextResponse.json({ success: true, outcome: inserted });
}
```

### Pattern 3: Daily pg_cron + SECURITY DEFINER delta function

**What:** Schedule once in the migration, run pure SQL, update rows, clear `needs_recompute`.
**When to use:** Hobby-plan Vercel + analytical work that fits in a SQL function (no CCXT, no Python).

```sql
-- Source template: supabase/migrations/056_retention_crons.sql (verified)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron missing — skipping bridge outcome cron schedule.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute_bridge_outcome_deltas') THEN
    PERFORM cron.unschedule('compute_bridge_outcome_deltas');
  END IF;

  PERFORM cron.schedule(
    'compute_bridge_outcome_deltas',
    '0 3 * * *',   -- 03:00 UTC, per D-15 (matches retention cron cluster)
    $cron$ SELECT public.compute_bridge_outcome_deltas(); $cron$
  );
END $$;
```

The function itself (sketch):

```sql
CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_rows_updated INT := 0;
BEGIN
  WITH candidates AS (
    SELECT bo.id, bo.strategy_id, bo.allocated_at, sa.returns_series
    FROM bridge_outcomes bo
    JOIN strategy_analytics sa ON sa.strategy_id = bo.strategy_id
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
  ),
  computed AS (
    -- returns_series is JSONB array of {date: 'YYYY-MM-DD', value: float}
    -- where `value` is the cumulative equity curve (NOT daily return).
    -- delta_Nd = (equity_at(allocated_at + N) / equity_at(allocated_at)) - 1
    -- Pending window when equity_at(allocated_at + N) does not yet exist.
    SELECT
      c.id,
      extract_delta(c.returns_series, c.allocated_at, 30)  AS delta_30d,
      extract_delta(c.returns_series, c.allocated_at, 90)  AS delta_90d,
      extract_delta(c.returns_series, c.allocated_at, 180) AS delta_180d,
      extract_estimated(c.returns_series, c.allocated_at)  AS est_bps_and_days
    FROM candidates c
  )
  UPDATE bridge_outcomes bo
    SET delta_30d             = computed.delta_30d,
        delta_90d             = computed.delta_90d,
        delta_180d            = computed.delta_180d,
        estimated_delta_bps   = (computed.est_bps_and_days).bps,
        estimated_days        = (computed.est_bps_and_days).days,
        deltas_computed_at    = now(),
        needs_recompute       = FALSE
    FROM computed
    WHERE bo.id = computed.id;
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated;
END;
$$;
```

`extract_delta(jsonb, date, int) → NUMERIC` and `extract_estimated(jsonb, date) → RECORD` are two tiny helper functions the migration ships. Writing them as SQL-language (not plpgsql) where possible is simpler and faster. **Planner: verify the exact JSONB shape by running `SELECT jsonb_typeof(returns_series), returns_series->0 FROM strategy_analytics LIMIT 1;` before writing the extractor** — training knowledge says `[{date, value}, ...]` (confirmed by reading `analytics-service/services/metrics.py` lines 74-78) but the shape invariant is not enforced by a CHECK constraint.

### Anti-Patterns to Avoid

- **Sprinkling `export const dynamic = "force-dynamic"` on the route.** Only add when required. POST handlers don't need it.
- **Calling `createAdminClient()` in the user-facing POST route.** The whole point of RLS is that `createClient()` with the user's JWT enforces `allocator_id = auth.uid()`. Admin client in this route would defeat the defense.
- **Adding a third Vercel cron entry.** `src/__tests__/vercel-cron-limits.test.ts` fails the build.
- **Hardcoding hex colors in banner JSX.** DESIGN.md tokens only. (Exception: the few places existing allocations code inlined `#E2E8F0` — mirror that locally to stay consistent with the neighborhood but flag for a broader cleanup.)
- **Introducing `sonner` / `react-hot-toast` / any new toast library.** Project has no shared toast primitive; fix that in-tree rather than adding a dep.
- **Using `cookies()` / `headers()` synchronously.** Next 16 made these async.
- **Awaiting `logAuditEvent`.** It returns `void` by design (fire-and-forget via `after()`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audit logging | Manual `INSERT INTO audit_log` | `logAuditEvent(supabase, {...})` from `src/lib/audit.ts` | SECURITY DEFINER RPC handles attribution spoof-proofness + `after()` non-blocking emission + stable `[audit]` log prefix. Per ADR-0023. |
| CSRF check | Manual header comparison | `assertSameOrigin(req)` from `src/lib/csrf.ts` | Already handles `NEXT_PUBLIC_SITE_URL` + `NEXT_PUBLIC_VERCEL_URL` + localhost matrix. Consistent with 33 other mutations. |
| Rate limiting | Manual counter in-memory | `checkLimit(userActionLimiter, key)` from `src/lib/ratelimit.ts` | Upstash-backed, graceful-degrades to fail-open if env missing. |
| Scheduled work on Vercel Hobby | Adding to `vercel.json` crons | pg_cron inside the migration | Hobby cap is 2/2; CI test fails a 3rd. |
| Row-level dismiss across tabs | Client `sessionStorage` | `bridge_outcome_dismissals` table + `WHERE expires_at > now()` | D-05 locks server-side TTL. |
| Class concat | String concatenation | `cn(...)` from `src/lib/utils.ts` | Project convention. |
| SupabaseClient type work | `any` + casts | `castRow` / `castRows` from `src/lib/supabase/cast.ts` | Project pattern, visible in `match.ts`. |
| UUID generation in SQL | Manual | `gen_random_uuid()` + `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | Standard pattern across all 58 migrations. |
| Daily-cadence cleanup of expired dismissals | pg_cron purger | NOTHING — the `WHERE expires_at > now()` predicate at query time already skips expired rows | Table will accumulate rows; acceptable at this scale (one row per dismiss per 24h per allocator). Add a follow-up retention cron only if row count becomes problematic. |

**Key insight:** Phase 1 is 90% boilerplate assembly. The only genuinely novel work is the JSONB equity-curve delta math (~40 lines of SQL). Everything else is "apply existing template X to new entity Y."

## Common Pitfalls

### Pitfall 1: Assuming `returns_series` holds daily returns
**What goes wrong:** Planner writes `SUM(daily_return) FROM returns_series OVER N days` → wrong numbers.
**Why it happens:** The name "returns_series" is misleading. `analytics-service/services/metrics.py:74-82` constructs it from `cumulative = (1 + returns).cumprod() - 1` — it is the **cumulative equity curve** relative to the series start, shape `[{date, value}, ...]`.
**How to avoid:** `delta_Nd = (value_at(allocated_at + N) / value_at(allocated_at)) - 1` against cumulative values. Or equivalently if indexing from the equity curve normalized to 1.0: `delta = equity[t+N] - equity[t]` when equity = `1 + cumulative_return`. Planner must verify the exact formula against a real row.
**Warning signs:** Numbers are ~2–3 orders of magnitude too small (because you averaged daily returns); numbers match across all time horizons (because you used a cumulative value incorrectly).

### Pitfall 2: Timezone mismatch between `allocated_at` (DATE) and `returns_series[].date` (TEXT 'YYYY-MM-DD')
**What goes wrong:** Date arithmetic straddles UTC boundaries inconsistently.
**Why it happens:** `returns_series[].date` is a text 'YYYY-MM-DD' in UTC (generated via `d.strftime("%Y-%m-%d")` in Python). `bridge_outcomes.allocated_at` should be stored as `DATE` (not `TIMESTAMPTZ`) to match the JSONB key space.
**How to avoid:** Use `DATE` type for `allocated_at`. Convert in SQL with `(allocated_at + interval 'N days')::text` when probing the JSONB. Never mix `TIMESTAMPTZ` into the delta math.
**Warning signs:** Off-by-one-day deltas; inconsistent results when the allocator submits late at night UTC.

### Pitfall 3: Cron DOES NOT fit on Vercel Hobby
**What goes wrong:** Someone adds a 3rd entry to `vercel.json` `crons`. Production deploy halts silently (Hobby-plan policy redirect occurs at build-verification time).
**Why it happens:** Intuition: "it's a Next cron, so it goes in vercel.json." Reality: `vercel.json` has 2/2 already; `src/__tests__/vercel-cron-limits.test.ts` blocks a 3rd at build time.
**How to avoid:** Schedule via `pg_cron` in the migration. See migration 056 for the exact pattern.
**Warning signs:** `vercel.json` has 3 entries; the cron-limits vitest fails.

### Pitfall 4: Eligibility query N+1
**What goes wrong:** Adding three separate selects (`match_decisions`, `bridge_outcomes`, `bridge_outcome_dismissals`) multiplies dashboard load time.
**Why it happens:** Each table is small but naive fetching compounds.
**How to avoid:** Single LEFT JOIN query in `getMyAllocationDashboard` that returns per-strategy flags (`is_eligible`, `has_outcome`, `is_snoozed`). See match.ts fan-out pattern (parallel Promise.all).
**Warning signs:** `/allocations` page shows banner flicker on render; dashboard page-load time regresses.

### Pitfall 5: Missing `server-only` import on the new route helper
**What goes wrong:** If banner eligibility helpers land in `src/lib/` and touch the admin client, a client bundle can end up referencing service-role code.
**How to avoid:** Any new helper under `src/lib/` that reads via admin client MUST start with `import "server-only";`. Match the pattern in `src/lib/admin/match.ts:1`.
**Warning signs:** Vercel build error "`SUPABASE_SERVICE_ROLE_KEY` is not defined on the browser"; tests fail with the `"server-only"` runtime throw.

### Pitfall 6: Forgetting to flip `needs_recompute = FALSE` in the cron
**What goes wrong:** Cron runs, computes, never clears the flag, re-computes every single row every single day forever.
**How to avoid:** `UPDATE ... SET needs_recompute = FALSE` is part of the same statement that writes the deltas. The cron idempotency test must cover the "second run is a no-op" assertion.

### Pitfall 7: Audit emission from a non-request scope
**What goes wrong:** If someone later calls `logAuditEvent` from a cron route or a Server Component, `after()` throws.
**Why it happens:** `after()` is request-scoped in Next 16.
**How to avoid:** `src/lib/audit.ts` already has a `queueMicrotask` fallback. The new route handler is always in request scope — no issue for Phase 1. Just note it so Phase 4/5 don't trip.

### Pitfall 8: `date.pipe(z.coerce)` footgun in Zod v4
**What goes wrong:** Zod v4 tightened coercion; `z.string().date()` is the canonical ISO-date validator (YYYY-MM-DD). Using `z.date()` expects a native `Date`, which JSON cannot carry.
**How to avoid:** `z.string().date()` for the form field; parse to `Date` only inside the handler if you need arithmetic. Otherwise pass through to Postgres which will coerce the string into DATE.

## Code Examples

### Extending `AuditAction` (src/lib/audit.ts)

```typescript
// Source: src/lib/audit.ts (verified local file) + ADR-0023 §4
export type AuditAction =
  // ...existing...
  // --- Sprint 8 Phase 1 ---
  | "bridge_outcome.record"
  | "bridge_outcome.update"
  | "bridge_outcome.dismiss";
```

Update ADR-0023 entity-type table in the same PR:

| Action | entity_type | entity_id source | Metadata keys |
|--------|-------------|------------------|---------------|
| `bridge_outcome.record` | `bridge_outcome` | the inserted `bridge_outcomes.id` | strategy_id, kind, percent_allocated?, rejection_reason? |
| `bridge_outcome.update` | `bridge_outcome` | the updated `bridge_outcomes.id` | fields_changed |
| `bridge_outcome.dismiss` | `bridge_outcome_dismissal` | inserted `bridge_outcome_dismissals.id` | strategy_id, expires_at |

### Banner eligibility extension to `getMyAllocationDashboard`

```typescript
// Source template: src/lib/queries.ts (verified) lines 584-720
// Extend the Promise.all fan-out with:
admin
  .from("match_decisions")
  .select("strategy_id")
  .eq("allocator_id", userId)
  .eq("decision", "sent_as_intro"),
admin
  .from("bridge_outcomes")
  .select("strategy_id")
  .eq("allocator_id", userId),
admin
  .from("bridge_outcome_dismissals")
  .select("strategy_id, expires_at")
  .eq("allocator_id", userId)
  .gt("expires_at", new Date().toISOString()),
// ...then post-process into a Set<string> per category and attach
// `eligible_for_outcome: boolean` to each strategy row.
```

### Banner component shell (must use DESIGN.md tokens)

```tsx
// "use client"
// Source: DESIGN.md tokens + UndoToast.tsx (verified)
export function BridgeOutcomeBanner({ strategyId, onDismiss, onRecorded }: Props) {
  return (
    <div
      role="region"
      aria-label="Record outcome for Bridge-introduced strategy"
      className="border-t border-border bg-page px-4 py-3 text-sm text-text-primary flex items-center gap-3"
    >
      <span>Did you act on this Bridge suggestion?</span>
      <button type="button" className="..." /* Allocated button per DESIGN.md Primary */>
        Allocated
      </button>
      <button type="button" className="..." /* Rejected button per DESIGN.md Secondary */>
        Rejected
      </button>
      <button type="button" aria-label="Dismiss for 24 hours" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` | `src/proxy.ts` | Next 16 | Not in scope for Phase 1; noted for planner hygiene. |
| Hand-written audit inserts | `log_audit_event` SECURITY DEFINER RPC | Sprint 6 Task 7.1a (migration 049) | Phase 1 uses the RPC exclusively. |
| RLS `is_admin=true` column | `current_user_has_app_role(['admin'])` helper | Sprint 6 Task 7.2 (migration 054) | Admin-read policy must use the helper, not the legacy column. |
| Third Vercel cron | pg_cron in a migration | Commit 786e6c7 (2026-04-15) trimmed crons to Hobby cap | Phase 1 MUST use pg_cron. |
| Native `alert()` confirmations | (deferred) — no toast library introduced | — | Phase 1 does NOT introduce a new toast dep (CLAUDE.md simplicity). Build a tiny inline toast or extend `UndoToast`'s shell. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| pg_cron | Daily delta job | ✓ (production Supabase) | — | Migration 056 DO-block NOTICE skip pattern — if extension missing locally, migration applies without registering the cron. |
| pg_net | — | ✓ | — | Not needed Phase 1 (no HTTP out of Postgres). |
| `log_audit_event` RPC | OUTCOME-08 | ✓ | Migration 049 | — |
| `current_user_has_app_role` SQL helper | Admin-read policy | ✓ | Migration 054 | — |
| Upstash Redis | Route rate-limit | ✓ (optional) | — | Fails open if env missing (`src/lib/ratelimit.ts`) — acceptable. |
| Supabase service role key | Cron function (SECURITY DEFINER runs as owner — no service key needed) | ✓ | — | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None blocking.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (unit + route) · Playwright 1.59 (E2E) · pytest (not applicable Phase 1) |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `npm test -- src/app/api/bridge` (scoped) |
| Full suite command | `npm run typecheck && npm run lint && npm test && npm run test:e2e -- --grep bridge-outcome` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OUTCOME-01 | POST records outcome + returns success | route (unit) | `npx vitest run src/app/api/bridge/outcome/route.test.ts` | ❌ Wave 0 |
| OUTCOME-02 | Eligibility query excludes non-`sent_as_intro` / snoozed / already-outcomed | unit (pure) | `npx vitest run src/lib/queries.my-allocation.test.ts` (extend) | ❌ extend in Wave 0 |
| OUTCOME-03 | RLS: owner read own / admin read all / non-owner blocked | live-DB integration | `HAS_LIVE_DB=true npx vitest run src/__tests__/bridge-outcomes-rls.test.ts` | ❌ Wave 0 |
| OUTCOME-03 | Migration 059 self-verify DO block | migration smoke | applied at `supabase db reset` time | migration is the test |
| OUTCOME-04 | POST returns 403 when no `sent_as_intro` row exists | route (unit) | same route.test.ts | ❌ Wave 0 |
| OUTCOME-05 | Label progression logic (Pending / Estimated / 30d / 90d / 180d) | unit (pure) | `npx vitest run src/lib/bridge-outcome-label.test.ts` | ❌ Wave 0 (new helper file) |
| OUTCOME-06 | Cron function math against fixture `returns_series` | live-DB integration | `HAS_LIVE_DB=true npx vitest run src/__tests__/bridge-outcome-cron.test.ts` | ❌ Wave 0 |
| OUTCOME-06 | Cron idempotency (re-run → same values, zero row changes) | live-DB integration | same cron test | ❌ Wave 0 |
| OUTCOME-07 | Upsert flips `needs_recompute=true`; cron clears to false | live-DB integration | same cron test | ❌ Wave 0 |
| OUTCOME-08 | `logAuditEvent` emitted with `entity_type='bridge_outcome'` on POST success | route (unit) via mocked RPC call log | extend `audit-coverage.test.ts` (meta-grep) + inline route test | ❌ Wave 0 |
| E2E | Banner visible → click Allocated → fill form → success toast → row replaced | Playwright | `npx playwright test e2e/bridge-outcome.spec.ts` | ❌ Wave 0 (CI wire-up required) |

### Sampling Rate

- **Per task commit:** `npm run typecheck && npm test -- src/app/api/bridge src/lib/queries` (< 30s)
- **Per wave merge:** Full Vitest suite + the one E2E spec (with seeded DB if available)
- **Phase gate:** Full suite green; RLS live-DB test run against staging; migration `self-verify` DO block passes at apply time; E2E spec green in CI (requires CI wire-up, see Wave 0 gaps).

### Wave 0 Gaps

- [ ] `src/app/api/bridge/outcome/route.test.ts` — covers OUTCOME-01, OUTCOME-04, OUTCOME-08 (audit emission via mocked `log_audit_event` RPC)
- [ ] `src/app/api/bridge/outcome/dismiss/route.test.ts` — covers dismiss TTL behavior
- [ ] `src/lib/bridge-outcome-label.ts` + `.test.ts` — covers OUTCOME-05 label progression (pure function, ~15 test cases covering day-0 through day-181)
- [ ] `src/lib/queries.my-allocation.test.ts` — extend for OUTCOME-02 eligibility filter (add 3 cases: eligible, already-outcomed, snoozed)
- [ ] `src/__tests__/bridge-outcomes-rls.test.ts` — live-DB gated (`HAS_LIVE_DB`); verifies OUTCOME-03 three-tier policy
- [ ] `src/__tests__/bridge-outcome-cron.test.ts` — live-DB gated; calls `compute_bridge_outcome_deltas()` against seeded `strategy_analytics.returns_series`; asserts OUTCOME-06 math AND OUTCOME-07 idempotency
- [ ] `e2e/bridge-outcome.spec.ts` — new Playwright spec for the banner → form → record flow
- [ ] **CI wire-up:** CONCERNS.md notes only 4/21 Playwright specs run in CI. The new spec MUST either be added to the CI-runnable subset (current: auth, smoke, demo-public, demo-founder-view) with a mock-env build, OR the seeded-Supabase CI path (currently deferred) must be stood up. **Decision required in planning:** either write the spec as "no-backend smoke" (stub the fetch, verify pure UI flow) to fit the current 4-spec CI budget, or stand up the seeded-Supabase CI. The former is lower-cost for Phase 1; the latter is the right long-term fix. Recommend: ship the spec, mark it CI-gated on `HAS_SEEDED_SUPABASE`, document the follow-up.
- [ ] **Audit-coverage meta-test update:** `src/__tests__/audit-coverage.test.ts` greps route.ts files for `.insert/.update/.delete` within 60 lines of `logAuditEvent`. The new route must land with the emission inline; planner should verify the pattern matches or add an `@audit-skip:` pragma if a helper indirection is used.
- [ ] **Cron-limits meta-test:** Will automatically verify `vercel.json` stays at 2 crons (no code change needed if we use pg_cron — mentioned here so the planner doesn't drift).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth via `@supabase/ssr`; `supabase.auth.getUser()` at route boundary (authoritative per ADR-0022). |
| V3 Session Management | yes | Supabase SameSite=Lax cookies; CSRF defense-in-depth via `assertSameOrigin()`. |
| V4 Access Control | yes | Postgres RLS (owner-* policies) + belt-and-suspenders `match_decisions` join check in the route (D-04). |
| V5 Input Validation | yes | Zod schema on request body; DB `CHECK` constraints on `percent_allocated` range, `rejection_reason` enum, `allocated_at` not-future. |
| V6 Cryptography | N/A | No new secrets, no new encrypted material. Outcome rows are non-sensitive business data. |
| V7 Error Handling | yes | Stable error codes (`NOT_ELIGIBLE`), no raw upstream messages leaked. |
| V10 Malicious Code | yes | Banned-packages CI gate covers new deps (none added). |
| V14 Configuration | yes | pg_cron scheduling; no new env vars. |

### Known Threat Patterns for Next.js + Supabase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Spoofed `allocator_id` in POST body | Spoofing | Ignore body `allocator_id`; always derive from `auth.getUser()`. Route MUST NOT accept allocator_id as input. |
| Cross-allocator read of another's outcome | Information Disclosure | RLS `USING (allocator_id = auth.uid())` + live-DB test. |
| Outcome recorded for a strategy the allocator never got introduced to (replay / forged row) | Tampering | OUTCOME-04 join-verification at route layer AND at the DB via an additional CHECK that references `match_decisions` via a trigger — however, triggers add complexity; the route-level check + an index-backed join at read-time is sufficient for Phase 1. Phase 2+ could consider a FOREIGN KEY to `match_decisions(id)` if strict. |
| CSRF on POST (someone tricks an allocator's browser) | Tampering | `assertSameOrigin` (existing defense); SameSite=Lax cookie (existing defense). |
| Rate-limit bypass / spam | Denial of Service | `userActionLimiter` via Upstash. |
| Log injection via free-text `note` | Tampering (logs) | Never template `note` into log strings; always pass as structured metadata field. |
| Admin audit tampering | Repudiation | `audit_log` append-only (migration 049) — deny UPDATE/DELETE policies + REVOKE. |
| PII leakage through admin-read | Information Disclosure | `note` text can contain allocator-written content. Admin read is gated by `current_user_has_app_role(['admin'])`. Acceptable per existing admin-access pattern. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `strategy_analytics.returns_series` JSONB is an ARRAY of `{date: 'YYYY-MM-DD', value: float}` where `value` is the cumulative equity curve (NOT daily returns). | Delta math | **[VERIFIED]** via direct read of `analytics-service/services/metrics.py:74-82`. No risk — verified by source. |
| A2 | pg_cron is installed and enabled on the production Supabase instance. | Cron scheduling | **[VERIFIED]** by existence of migrations 013, 015, 056 all using pg_cron successfully in production. |
| A3 | Admin-read of user-owned tables in 2026-04 and later uses `current_user_has_app_role(['admin'])` helper, not `profiles.is_admin`. | RLS admin policy | **[VERIFIED]** migration 054 + migration 056 both use the helper. |
| A4 | Upstash env vars are set in production; rate-limiter is live (not fail-open). | Route protection | **[ASSUMED]** — `.env.example` lists them as optional. Planner should confirm with user; if fail-open is the prod state, that's acceptable for Phase 1 but noted in PROJECT.md. |
| A5 | CI Playwright wire-up for new specs is scoped work (est. 0.5–1 day). | E2E gap | **[ASSUMED]** per CONCERNS.md "1 day" estimate. Not blocking Phase 1 — ship the spec, mark CI-gated. |
| A6 | `match_decisions.decision = 'sent_as_intro'` is the canonical "was introduced" signal. No other table needs joining. | OUTCOME-04 | **[VERIFIED]** via migration 011 + `send_intro_with_decision` RPC. |
| A7 | `note` textarea max length = 2000 chars is sensible (matches `intro.message` schema). | Zod validation | **[ASSUMED]** — matches pattern in `src/app/api/intro/route.ts`; planner may refine. |
| A8 | Phase 2 `max_weight` may or may not be shipped by the time Phase 1 lands; `allocator_preferences.max_weight` column may be NULL. | D-09 soft-warn | **[VERIFIED by CONTEXT.md D-09]** — banner must NOT hard-depend on Phase 2. |
| A9 | Outcome rows are append-only (no user-facing DELETE, no UPDATE except by cron to set deltas + by user to edit within a short window — TBD). | RLS UPDATE policy | **[ASSUMED]** — D-11 suggests a single "Recorded" row. Planner should decide: (a) no updates at all — users submit corrective records; or (b) allow UPDATE within N minutes. Recommend option (a) for simplicity + institutional-audit feel. Needs user confirmation. |

**Open assumption for user confirmation:** A9 — is a recorded outcome immutable from the user side, or do we allow edits within a short window? Current decisions log is silent. Recommend immutable + "contact admin to correct" UX.

## Open Questions (RESOLVED)

All four questions below were resolved by CONTEXT.md's post-research Clarifications section (D-17..D-20) before planning.

1. **Immutability of recorded outcomes (A9 above)** — **RESOLVED via D-17.** Outcomes are **editable by owner** — allocator may re-record; every update sets `needs_recompute=TRUE` and writes a new audit event. Migration 059 RLS grants owner-UPDATE; route upsert uses `onConflict:"allocator_id,strategy_id"`.

2. **Dismissal dedupe key** — **RESOLVED via D-18.** Dedupe on `strategy_id` (partial unique index `(allocator_id, strategy_id)`), not `match_candidate_id`.

3. **Seeded CI Supabase** — **RESOLVED via D-20.** Defer seeded CI; ship Phase 1 E2E gated on `HAS_SEEDED_SUPABASE` env var. Unit / RLS / contract tests run in CI unconditionally.

4. **Deltas for `rejected` outcomes** — **RESOLVED via D-19.** Cron only processes `kind='allocated'` rows. Rejected rows are Phase 4 feedback-engine input; their delta fields remain NULL by design.

## Sources

### Primary (HIGH confidence — read + verified in this research session)
- `supabase/migrations/001_initial_schema.sql` — `strategy_analytics` schema, confirmed `returns_series` JSONB column
- `supabase/migrations/011_perfect_match.sql` — `match_decisions` + `match_candidates` tables + `send_intro_with_decision` RPC
- `supabase/migrations/037_user_notes.sql` — canonical owner-scoped RLS template (this is the mirror for 059)
- `supabase/migrations/049_audit_log_hardening.sql` — `log_audit_event` RPC contract
- `supabase/migrations/054_user_app_roles.sql` — `current_user_has_app_role` helper pattern
- `supabase/migrations/056_retention_crons.sql` — pg_cron scheduling pattern
- `supabase/migrations/058_log_audit_event_service.sql` — service-role audit variant (not used Phase 1, noted)
- `analytics-service/services/metrics.py:60-90` — confirmed `returns_series` is cumulative equity `[{date, value}]`
- `src/app/api/admin/match/decisions/route.ts` — route-handler template
- `src/app/api/admin/match/send-intro/route.ts` — route-handler with RPC pattern
- `src/app/api/intro/route.ts` + `route.test.ts` — route + test template
- `src/lib/audit.ts` — `AuditAction` union + `logAuditEvent` contract
- `src/lib/admin/match.ts` — admin fan-out pattern (for eligibility fan-out)
- `src/lib/queries.ts` (`getMyAllocationDashboard`) — extension surface
- `src/app/(dashboard)/allocations/AllocationDashboard.tsx` + `page.tsx` — insertion surface
- `src/app/(dashboard)/allocations/components/UndoToast.tsx` — toast shell pattern
- `src/__tests__/vercel-cron-limits.test.ts` — Hobby-plan 2/2 cap enforcement
- `vercel.json` — confirms 2/2 crons used
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — audit taxonomy + extension procedure
- `.planning/codebase/{ARCHITECTURE,CONVENTIONS,STACK,STRUCTURE,TESTING,CONCERNS}.md` — all cross-referenced
- `DESIGN.md` — design tokens for banner/form
- `CLAUDE.md`, `AGENTS.md` — project directives

### Secondary (MEDIUM confidence)
- npm registry `next@16.2.4` version check (2026-04-17)
- `docs/runbooks/match-engine.md` — operational patterns (background context only)
- `docs/superpowers/specs/2026-04-10-my-allocation-dashboard.md` — widget layout

### Tertiary (LOW confidence)
- None — no WebSearch-only claims in this research. Every claim is sourced to a file in the repo or a verified npm lookup.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is already in `package.json`; no new deps.
- Architecture: HIGH — migration template 037, route template `admin/match/decisions`, cron template 056 all verified.
- Pitfalls: HIGH — Pitfall 1 (cumulative-not-daily) and Pitfall 3 (Hobby-cron cap) are the two that would sink a plan; both verified by reading source.
- Test architecture: MEDIUM — most Vitest patterns are HIGH confidence; the E2E CI wire-up is the one open gap (explicitly flagged).
- Validation: HIGH — existing meta-tests (`audit-coverage`, `vercel-cron-limits`) will catch the main regressions automatically.

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days — stack is stable; revisit if Next or Supabase ships a major version).
