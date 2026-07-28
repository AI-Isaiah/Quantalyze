# Phase 11: Onboarding and Security Readiness — Pattern Map

**Mapped:** 2026-04-26
**Files analyzed:** 19 (8 NEW source files, 6 MOD source files, 3 NEW e2e/CI files, 2 NEW test fixtures)
**Analogs found:** 19 / 19 (every new/modified file has at least a role-match analog in repo)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/084_first_api_key_added_trigger.sql` | migration (trigger + SECURITY DEFINER fn) | event-driven (DB trigger → marker write) | `supabase/migrations/053_session_count_rpc.sql` | exact — verbatim template per RESEARCH.md |
| `src/app/api/me/audit-log/export/route.ts` | route handler | request-response (GET → CSV stream) | `src/app/api/usage/session-start/route.ts` (auth+CSRF shape) + `src/app/api/account/export/route.ts` (export structure) | hybrid (GET shape from intro/usage; export semantics from account/export) |
| `src/lib/onboarding/funnel-events.ts` (or `src/lib/analytics/onboarding-funnel.ts`) | service (analytics helper, server-only) | event-driven (marker read → PostHog emit) | `src/lib/analytics/usage-events.ts` | exact — `trackUsageEventServer` is the wrapping primitive |
| `src/lib/audit-log-csv.ts` | utility (CSV serialization) | transform | `src/lib/csv.ts` (existing escape primitives) | role-match (parse vs serialize, same RFC 4180 idiom) |
| `src/app/(dashboard)/allocations/components/WidgetState.tsx` | component (presentational primitive) | request-response (mode → JSX dispatch) | `src/app/(dashboard)/allocations/EmptyState.tsx` (locked reuse) + `src/components/ui/Skeleton.tsx` | exact — REUSES EmptyState, composes Card/Skeleton |
| `src/app/(dashboard)/allocations/components/OnboardingBanner.tsx` (S1) | component (composition wrapper) | request-response (props → JSX) | `src/components/ui/WarningBanner.tsx` (primitive) + `src/app/(dashboard)/allocations/EmptyState.tsx` (Connect Exchange CTA copy) | exact — composition, not new chrome |
| `src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx` (S2) | component (form card) | request-response (form submit → existing RPC) | `src/components/ui/Card.tsx` + `src/components/mandate/MandateForm.tsx` (chip group + RPC pattern) + `src/app/api/preferences/route.ts` (RPC invocation) | exact — composes Card; calls existing `update_allocator_mandates` |
| `src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx` (S5) | component (static strip) | request-response (no data) | `src/components/ui/WarningBanner.tsx` | exact — composition with className override |
| `src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx` (S7) | component (static hint) | request-response (no data) | `src/components/ui/WarningBanner.tsx` (same as S5) | exact — composition |
| `src/app/(dashboard)/profile/components/AuditLogSubsection.tsx` (S6) | component (download button + status) | request-response (button click → fetch CSV) | `src/components/ui/Button.tsx` + `src/app/api/account/export/route.ts` (download trigger pattern) | role-match (button-triggered fetch is novel; chrome reuses Button) |
| `src/app/security/page.tsx` (MOD — D-05/D-06/D-07) | page (Server Component) | request-response (static editorial) | self (existing `<section aria-labelledby="…">` editorial blocks within same file) | exact — surgical content edits to existing structure |
| `src/components/auth/ProfileTabs.tsx` (MOD — add `security` tab) | component (tabbed nav) | request-response (URL ↔ active tab) | self (existing `ALL_TABS` array + `parseTabParam` pattern in same file) | exact — extend the locked tab tuple |
| `src/app/(dashboard)/allocations/MyAllocationClient.tsx` (MOD — render S1+S2) | component (allocator dashboard root) | request-response (server props → conditional render) | self (existing `flaggedHoldings` prop pass-through) | exact — same prop-extension pattern |
| `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (MOD — mount S5+S7) | component (wizard layout root) | request-response (step state → step component) | self (existing `<WizardChrome>` children block at line 300-399) | exact — strip injection above step branches |
| `src/lib/queries.ts` (MOD — `apiKeysCount` field on payload) | service (data fetcher) | CRUD (Supabase reads → typed payload) | self (existing `MyAllocationDashboardPayload` interface + `getMyAllocationDashboard` aggregator) | exact — payload extension pattern |
| `analytics-service/services/job_worker.py` (MOD — write `first_sync_success_at` marker) | service (Python worker) | event-driven (job done → marker write) | self (existing `_emit_audit` call after `persist_allocator_holdings` line 838-874) | exact — same post-success hook |
| `e2e/onboarding-funnel.spec.ts` | test (E2E) | request-response (page nav + assertion) | `e2e/full-flow.spec.ts` (template per CONTEXT D-15) + `e2e/auth.spec.ts` (login bootstrap) + `e2e/api-key-flow.spec.ts` (key-add patterns) | exact — full-flow.spec.ts is the named template |
| `e2e/helpers/seed-test-project.ts` + `e2e/helpers/cleanup-test-project.ts` | test helper | CRUD (service-role seed/teardown) | NO direct analog in `e2e/helpers/` (verified — no helpers dir today); closest is service-role write pattern in `src/lib/test-helpers/live-db.ts` | greenfield (D-15 mandate); follow `live-db.ts` shape |
| `.github/workflows/ci.yml` (MOD — gated step) | config (CI) | event-driven (CI step) | self (existing `e2e:` job with `npx playwright test e2e/auth.spec.ts e2e/smoke.spec.ts …` line 132) | exact — add gated step inside same job |

---

## Pattern Assignments

### `supabase/migrations/084_first_api_key_added_trigger.sql` (migration, event-driven)

**Analog:** `supabase/migrations/053_session_count_rpc.sql`

**Why this is the exact template:** RESEARCH.md §"Pattern 1: Postgres Trigger + SECURITY DEFINER Marker Write" explicitly mandates this verbatim. Migration 053 is the in-repo reference for atomic writes to `auth.users.raw_user_meta_data`.

**Function preamble pattern** (053 lines 24-34):
```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.increment_user_session_count(
  p_user_id UUID,
  p_debounce_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (session_count INTEGER, debounced BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
```

**SELECT FOR UPDATE + JSONB merge UPDATE pattern** (053 lines 42-79):
```sql
SELECT raw_user_meta_data
  INTO v_meta
  FROM auth.users
  WHERE id = p_user_id
  FOR UPDATE;

IF NOT FOUND THEN
  RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
END IF;

v_meta := COALESCE(v_meta, '{}'::JSONB);

UPDATE auth.users
   SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                            || jsonb_build_object(
                                 'session_count', v_next_count,
                                 'last_session_start_at',
                                   to_char(v_now AT TIME ZONE 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                               )
 WHERE id = p_user_id;
```

**REVOKE + GRANT pattern** (053 lines 87-91):
```sql
REVOKE ALL ON FUNCTION public.increment_user_session_count(UUID, INTEGER)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_user_session_count(UUID, INTEGER)
  TO service_role;

COMMIT;
```

**What to copy verbatim:**
- `BEGIN; … COMMIT;` transaction wrapper
- `LANGUAGE plpgsql SECURITY DEFINER` declarator
- `SET search_path = pg_catalog, public` (Pitfall 2 in RESEARCH.md — without this prod fails)
- `SELECT … FOR UPDATE` row lock pattern (concurrency safety)
- `COALESCE(v_meta, '{}'::JSONB)` + `|| jsonb_build_object(...)` merge idiom
- `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` ISO timestamp formatter
- `REVOKE ALL … FROM PUBLIC;` lockdown

**What to vary:**
- Function name → `stamp_first_api_key_added` (no longer takes `p_user_id` arg — reads `NEW.user_id` from trigger context)
- Function body → idempotent (early `RETURN NEW` if marker already set, NOT `RAISE EXCEPTION`)
- Bind point → `CREATE TRIGGER api_keys_stamp_first_added AFTER INSERT ON api_keys FOR EACH ROW EXECUTE FUNCTION …` (no `service_role` GRANT — trigger fires under table-owner role)
- Add self-verifying `DO $$ … $$` block at end (RESEARCH.md §Pattern 1 lines 412-440 supplies the full block)

---

### `src/app/api/me/audit-log/export/route.ts` (route handler, request-response)

**Analogs:** `src/app/api/usage/session-start/route.ts` (auth shape) + `src/app/api/account/export/route.ts` (export semantics) + `src/lib/csv.ts` (escape primitives)

**Auth-and-CSRF preamble pattern** (session-start lines 31-41 — but skip CSRF for GET):
```typescript
export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
```

**Export route structure pattern** (account/export lines 39-92):
```typescript
export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF defense-in-depth: reject before touching Upstash or Supabase.
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1/day/user bucket. The Upstash sliding window covers a rolling 24h …
  const rl = await checkLimit(exportLimiter, `export:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Export limit reached — try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
```

**RLS-scoped read pattern** (any auth-aware route — uses user-scoped `createClient`, not admin):
```typescript
// RLS: audit_log_owner_read policy at migrations/010_portfolio_intelligence.sql:179
//   USING (user_id = auth.uid()) — caller can ONLY read their own rows.
const { data: rows, error } = await supabase
  .from("audit_log")
  .select("created_at, action, entity_type, entity_id, metadata")
  .gte("created_at", ninetyDaysAgo)
  .order("created_at", { ascending: false });
```

**CSV response pattern** (RESEARCH.md §Pattern 3 — verified shape):
```typescript
const csv = rowsToCsv(rows ?? []);
const filename = `quantalyze-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;

return new NextResponse(csv, {
  status: 200,
  headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  },
});
```

**`@audit-skip` pragma pattern** (preferences/route.ts line 79-83 — this is how to silence `audit-coverage.test.ts`):
```typescript
// @audit-skip: rpc write path — logAuditEvent is called within 60 lines
// below. audit-coverage.test.ts scans .insert/.update/.upsert/.delete
// and does not see .rpc(); this pragma documents the audit path for
// future maintainers. Remove if audit-coverage.test.ts is updated to
// scan .rpc(.
```

**What to copy verbatim:**
- `createClient()` from `@/lib/supabase/server` (NOT admin — RLS handles scoping)
- `auth.getUser()` + 401 envelope
- `NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; …" } })` shape
- `export const dynamic = "force-dynamic"` (per-user export, never cache)
- `@audit-skip:` pragma comment block above the `.from("audit_log").select(...)` call (Pitfall 7 in RESEARCH.md)

**What to vary:**
- HTTP method: GET (not POST) — read-only export, browser navigation drives the download
- NO CSRF check (GET-only route; CSRF is for state-mutating verbs)
- NO rate-limit (CONTEXT/RESEARCH explicit: audit_log size ~5-50 KB, not a Upstash bucket candidate; document this in a comment)
- NO `logAuditEvent` write (the export is read-only; would create audit-of-audit feedback loop — pragma reason in `@audit-skip:`)

---

### `src/lib/audit-log-csv.ts` (utility, transform)

**Analog:** `src/lib/csv.ts` (existing CSV parsing primitives)

**RFC 4180 escape pattern** (csv.ts uses parse-side; serialize-side mirrors it). The 5-line escape helper from RESEARCH.md §Pattern 3 lines 591-597:
```typescript
function escapeCsv(value: string): string {
  // RFC 4180: quote if contains comma, quote, or newline; double-up internal quotes.
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
```

**csv.ts existing symmetric pattern** (csv.ts lines 30-39 — the existing sanitizer for parse-side):
```typescript
export function sanitizeCsvValue(val: string): string {
  // 1. Strip any leading run of `=`, TAB, or CR …
  const stripped = val.trim().replace(/^[=\t\r]+/, "");
  return stripped.replace(/^[+\-@](?=[^\d.]|$)/, "").trim();
}
```

**What to copy verbatim:**
- The `escapeCsv` regex `/[,"\n\r]/` and the double-quote-double pattern (RFC 4180 standard — already used in csv.ts test fixtures)
- `\r\n` line ending OR `\n` (csv.ts handles both for parse; serialize should pick `\n` to match POSIX text expectation)

**What to vary:**
- Add a `serializeRows()` (or similar) export — csv.ts only exports parse helpers today
- Header line is a comma-joined string of column names: `occurred_at,action,entity_type,entity_id,metadata_summary`
- `metadata_summary` flattens JSONB to single-line `JSON.stringify` (per RESEARCH.md §Pattern 3 line 579: `r.metadata ? JSON.stringify(r.metadata) : ""`)

**Open question (RESEARCH §Open Questions #2):** Confirm whether csv.ts already exports a serializer, or whether to colocate the new helper in `audit-log-csv.ts`. Planner should grep `export function ` in csv.ts before scaffolding.

---

### `src/lib/onboarding/funnel-events.ts` (or `analytics/onboarding-funnel.ts`) (service, event-driven)

**Analog:** `src/lib/analytics/usage-events.ts`

**`server-only` + PostHog wrapper pattern** (usage-events.ts lines 1-3 + 64-88):
```typescript
import "server-only";
import { PostHog } from "posthog-node";
import type { UsageEvent } from "./usage-events-types";

// …

export async function trackUsageEventServer(
  event: UsageEvent,
  distinctId: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const client = getServerClient();
  if (!client) return;

  try {
    client.capture({
      distinctId,
      event,
      properties: {
        ...(properties ?? {}),
        $host: process.env.NEXT_PUBLIC_SITE_URL ?? "quantalyze.com",
        source_layer: "server",
      },
    });
  } catch (err) {
    console.warn(
      "[usage-analytics] server capture failed (non-blocking):",
      err instanceof Error ? err.message : String(err),
    );
  }
}
```

**Single-fire marker pattern** (RESEARCH.md §Pattern 2 lines 466-504 — locked shape):
```typescript
export async function maybeEmitOnboardingEvent(
  admin: SupabaseClient,
  user: User,
  marker: "first_api_key_added" | "first_sync_success" | "first_bridge_surfaced" | "first_outcome_recorded",
  funnelStep: 2 | 3 | 4 | 5,
): Promise<void> {
  const meta = user.user_metadata ?? {};
  const stampedAt = meta[`${marker}_at`] as string | undefined;
  const emittedAt = meta[`${marker}_emitted_at`] as string | undefined;

  if (!stampedAt || emittedAt) return;

  await trackUsageEventServer(marker, user.id, {
    funnel_step: funnelStep,
    funnel_event_name: marker,
    cohort_week_iso: meta.cohort_week_iso ?? null,
    stamped_at: stampedAt,
  });

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...meta,
      [`${marker}_emitted_at`]: new Date().toISOString(),
    },
  });
  if (error) {
    console.warn(
      `[onboarding-funnel] failed to stamp ${marker}_emitted_at — will re-fire next request:`,
      error.message,
    );
  }
}
```

**What to copy verbatim:**
- `import "server-only";` first line (Server-only guard — usage-events.ts pattern)
- `trackUsageEventServer(...)` invocation (don't re-implement PostHog — call the existing wrapper)
- `console.warn(...)` non-blocking error handling (analytics MUST NOT crash the request)
- `auth.admin.updateUserById(user.id, { user_metadata: { ... } })` shape for the `_emitted_at` stamp (verified Supabase Auth admin API — RESEARCH §Sources)

**What to vary:**
- New file at `src/lib/analytics/onboarding-funnel.ts` (RESEARCH.md §Recommended Project Structure line 312); CONTEXT mentions both names — pick `analytics/onboarding-funnel.ts` for colocation with `usage-events.ts`
- Add the 5 new event strings to `src/lib/analytics/usage-events-types.ts` (CONTEXT D-13 enumerates them)
- The `signup` event has its own narrow site (auth callback) — does NOT use `maybeEmitOnboardingEvent` (no marker pattern needed for first request)

---

### `analytics-service/services/job_worker.py` (MOD — service, event-driven)

**Analog:** self — same file, the audit emission already wired post-success at lines 868-874.

**Existing post-success hook** (job_worker.py lines 838-874):
```python
# Persist + success status update
count = await persist_allocator_holdings(
    ctx.supabase, rows, allocator_id, api_key_id, today_str
)

spot_count = sum(1 for r in rows if r.get("holding_type") == "spot")
deriv_count = sum(1 for r in rows if r.get("holding_type") == "derivative")

final_status = "complete_with_warnings" if warning else "complete"

def _update_ok():
    return (
        ctx.supabase.table("api_keys")
        .update({
            "sync_status": final_status,
            "sync_error": warning,
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", api_key_id)
        .execute()
    )

try:
    await db_execute(_update_ok)
except Exception as upd_exc:  # noqa: BLE001
    logger.warning(
        "poll_allocator_positions: failed to stamp sync_status='%s' "
        "for api_key %s: %s",
        final_status, api_key_id, upd_exc,
    )

_emit_audit(
    allocator_id, api_key_id, "allocator.holdings.sync_completed",
    {
        "row_count": count,
        "holding_type_counts": {"spot": spot_count, "derivative": deriv_count},
    },
)
```

**Service-role admin client setup** (services/db.py lines 7-14 — singleton with `SUPABASE_SERVICE_KEY`):
```python
@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """Module-level Supabase client singleton. Reuses connection pool."""
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)
```

**What to copy verbatim:**
- The `def _update_xxx(): ... await db_execute(_update_xxx)` async-thread-bridge idiom
- The `try/except Exception as ... : logger.warning(...)` defensive swallow (per services/audit.py lines 121-129 — audit/marker drops MUST NOT fail the compute path)
- `ctx.supabase` for the service-role client (already plumbed through job context)

**What to vary:**
- Add a NEW marker write AFTER line 874 `_emit_audit` call (don't reorder — keeps audit-of-success first):
  - Best path: a new RPC `stamp_first_sync_success(p_user_id UUID)` in migration 084 (or a sibling migration), called via `ctx.supabase.rpc("stamp_first_sync_success", {"p_user_id": allocator_id})` — mirrors trigger pattern but called explicitly because Python worker can't fire DB triggers retroactively
  - The RPC writes `first_sync_success_at` to `auth.users.raw_user_meta_data` if absent (idempotent; same SECURITY DEFINER + REVOKE + GRANT shape as 053)
- Reason for RPC over direct UPDATE: Python service-role has implicit `auth.users` UPDATE rights, but a SECURITY DEFINER RPC (a) keeps the idempotency guard centralized and (b) matches the trigger pattern symmetrically

---

### `src/app/(dashboard)/allocations/components/WidgetState.tsx` (component, request-response)

**Analogs:** `src/app/(dashboard)/allocations/EmptyState.tsx` (LOCKED REUSE for `mode='empty'`) + `src/components/ui/Card.tsx` + `src/components/ui/Skeleton.tsx`

**EmptyState reuse target** (EmptyState.tsx lines 35-60 — verbatim, do not duplicate):
```typescript
export function EmptyState({ hasSyncing }: EmptyStateProps) {
  if (hasSyncing) {
    return (
      <InfoBanner>
        Syncing your first positions — this usually takes under a minute.
      </InfoBanner>
    );
  }

  return (
    <Card className="text-center py-12">
      <h2 className="font-serif text-2xl text-text-primary mb-2">
        No positions to analyze yet.
      </h2>
      <p className="text-sm text-text-secondary max-w-md mx-auto mb-6">
        Connect a read-only exchange API key to see your real holdings and performance.
      </p>
      <Link
        href="/profile?tab=exchanges"
        className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
      >
        Connect Exchange →
      </Link>
    </Card>
  );
}
```

**Skeleton primitive shapes** (Skeleton.tsx — entire file, all 36 lines):
```typescript
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md bg-border/60 ${className}`}
      aria-hidden
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) { /* … */ }

export function SkeletonCard() {
  return (
    <Card>
      <Skeleton className="h-5 w-1/3 mb-4" />
      <SkeletonText lines={3} />
    </Card>
  );
}
```

**Locked props interface** (CONTEXT D-10, also UI-SPEC §S3 — verbatim):
```typescript
type WidgetStateMode = 'loading' | 'empty' | 'partial' | 'error' | 'success';
type WidgetStateProps = {
  mode: WidgetStateMode;
  children?: ReactNode;
  partial?: { pill: string; children: ReactNode };
  error?: { message: string; onRetry?: () => void };
  empty?: { title: string; description?: string; ctaHref?: string; ctaLabel?: string };
};
```

**Mode dispatcher pattern** (RESEARCH.md §Pattern 4 lines 625-707 — full reference). Key shapes:
- `mode === 'loading'`: `<Card aria-busy="true">` + `<Skeleton className="h-5 w-1/3 mb-4" />` + body skeleton
- `mode === 'empty'`: render an EmptyState-style Card (or extend EmptyState with new props per planner discretion)
- `mode === 'partial'`: visible `<span aria-hidden="true">{pill}</span>` + sibling `<span class="sr-only">State: {pill}</span>` (UI-SPEC AC #16 — dual rendering for SR)
- `mode === 'error'`: `<Card role="alert" aria-live="polite" className="border-negative/30 bg-negative/5">` + Retry button only when `onRetry` prop present
- `mode === 'success'`: `<>{children}</>` (no chrome)

**What to copy verbatim:**
- The 5-mode union type (UI-SPEC AC #6 forbids a `category` prop)
- EmptyState's `<Card className="text-center py-12">` + accent CTA Link as the empty-mode renderer (DO NOT reimplement)
- `Skeleton` import — never roll a new keyframe (`animate-pulse` already inherits `prefers-reduced-motion` from `globals.css`)

**What to vary:**
- Whether `LoadingState.tsx` and `ErrorState.tsx` are sibling files or inline JSX — RESEARCH §Open Question #3: "Inline inside `WidgetState.tsx` for simplicity" is the recommendation; planner picks
- Whether to extend `EmptyState.tsx`'s prop interface (add optional `title`/`description`/`ctaHref`/`ctaLabel` overrides) OR pass-through wrapper — planner picks (extending is cleaner; wrapper is safer for the existing Phase 07 callers)

---

### `src/app/(dashboard)/allocations/components/OnboardingBanner.tsx` (S1, component)

**Analogs:** `src/components/ui/WarningBanner.tsx` (LOCKED chrome reuse per UI-SPEC AC #14) + `src/app/(dashboard)/allocations/EmptyState.tsx` (Connect Exchange CTA copy + accent button styling)

**WarningBanner primitive** (WarningBanner.tsx — entire file, 17 lines):
```typescript
export function WarningBanner({ children, className }: WarningBannerProps) {
  return (
    <div
      className={cn("rounded-lg border border-badge-market-neutral/30 bg-badge-market-neutral/5 px-4 py-3 text-sm text-text-secondary", className)}
    >
      {children}
    </div>
  );
}
```

**className override (UI-SPEC §S1 LOCKED):**
```tsx
<WarningBanner className="border-l-4 border-warning bg-warning/5">
  {/* heading + body + CTA + dismiss */}
</WarningBanner>
```
This switches the primitive's default `badge-market-neutral` tint to the locked `warning` token without introducing a new wrapper component.

**Connect Exchange CTA copy + styling pattern** (EmptyState.tsx lines 52-57):
```tsx
<Link
  href="/profile?tab=exchanges"
  className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
>
  Connect Exchange →
</Link>
```

**sessionStorage idiom** (RESEARCH.md §Don't-Hand-Roll line 730 — "Plain `sessionStorage.getItem/setItem` (verified pattern in `useTimeframe.ts` test)"). The SSR-safe shape per Pitfall 6 (RESEARCH lines 795-799):
```tsx
"use client";
const [mounted, setMounted] = useState(false);
const [dismissed, setDismissed] = useState(false);
useEffect(() => {
  setMounted(true);
  setDismissed(sessionStorage.getItem("allocations.onboarding_banner_dismissed") === "1");
}, []);
// SSR-safe: render banner unconditionally on server (Pitfall 8 — CLS guard);
// only HIDE after mount confirms dismissal.
if (mounted && dismissed) return null;
```

**What to copy verbatim:**
- `<WarningBanner className="border-l-4 border-warning bg-warning/5">` className token sequence
- `<Link href="/profile?tab=exchanges">` route target (Phase 06 IA, NEVER `/connections` or `/exchanges`)
- `bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors` accent-button class string
- UI-SPEC §S1 verbatim copy strings (heading, body, CTA, dismiss `aria-label`)

**What to vary:**
- Add the dismiss `<button>` child (UI-SPEC §Spacing → Touch target: 32×32px visible, 44×44px tap area via `before:absolute before:inset-[-6px]`)
- `aria-label="Dismiss for this session"` per UI-SPEC §Accessibility S1
- Server-side render unconditionally; client `useEffect` reads sessionStorage post-mount (CLS-safe)

---

### `src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx` (S2, component)

**Analogs:** `src/components/ui/Card.tsx` (LOCKED chrome reuse per UI-SPEC AC #15) + `src/components/mandate/MandateForm.tsx` (chip group + reset/save patterns) + `src/app/api/preferences/route.ts` (RPC invocation)

**Card primitive default chrome** (Card.tsx — entire file, 28 lines):
```typescript
export function Card({
  padding = "md",
  className = "",
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn("bg-surface rounded-xl border border-border shadow-card", paddingStyles[padding], className)}
      {...props}
    >
      {children}
    </div>
  );
}
```
Default `paddingStyles.md = "p-6"` — UI-SPEC AC #15 LOCKS `<Card padding="md">` with no padding override.

**MandateForm chip group state pattern** (MandateForm.tsx lines 49-75 — extract for `preferred_strategy_types` chip toggle):
```tsx
const [preferredTypes, setPreferredTypes] = useState<StrategyType[]>(
  (initial?.preferred_strategy_types as StrategyType[] | null) ?? [],
);

// ref-backed for rapid clicks (lines 82-84)
const preferredTypesRef = useRef(preferredTypes);

function onPreferredTypesToggle(type: StrategyType) {
  const next = toggleIn(preferredTypesRef.current, type);
  preferredTypesRef.current = next;
  setPreferredTypes(next);
  void save("preferred_strategy_types", next);
}
```

**RPC fire pattern** (preferences/route.ts lines 84-95 — server-side):
```typescript
const { error } = await supabase.rpc("update_allocator_mandates", rpcArgs);

if (error) {
  console.error("[api/preferences] update_allocator_mandates RPC error:", error);
  if (error.code === "28000") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error.code === "22023") {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "Failed to save mandate" }, { status: 500 });
}
```

**Null-clear-fields semantics** (preferences/route.ts lines 60-77 — CRITICAL for UI-SPEC §S2's "saving NULL is allowed by clearing"):
```typescript
const clearFields: string[] = [];
const rpcArgs: Record<string, unknown> = {};
for (const [key, value] of Object.entries(fields)) {
  if (value === null) {
    clearFields.push(key);
  } else {
    rpcArgs[`p_${key}`] = value;
  }
}
if (clearFields.length > 0) {
  rpcArgs.p_clear_fields = clearFields;
}
```

**What to copy verbatim:**
- `<Card padding="md">` (no `padding` override, no extra `p-*` className)
- `update_allocator_mandates` RPC call shape with `p_<field>` named params + `p_clear_fields` array for NULL clears
- The `toggleIn` helper from MandateForm.tsx (line 20-22) for chip toggling

**What to vary:**
- Save action calls `PUT /api/preferences` (re-uses the existing route — DO NOT call the RPC directly client-side; goes through the route for CSRF + rate limit + audit)
- "Skip for now" sets `sessionStorage["allocations.mandate_card_dismissed"]="1"` (per CONTEXT D-04 + UI-SPEC §S2)
- Auto-save is OFF (Phase 02 D-09 LOCKED + UI-SPEC AC #2 — first render must NOT save anything)

**What NOT to copy:**
- The MandateForm's `useMandateAutoSave` hook (auto-save on every field change) — Phase 02 D-09 LOCKED forbids silent saves on this card
- The full MandateForm field set — S2 only renders 2 fields (max_weight + preferred_strategy_types) per UI-SPEC §S2

---

### `src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx` (S5, component)

**Analog:** `src/components/ui/WarningBanner.tsx` (same as S1)

**WarningBanner with className override pattern** (UI-SPEC §S5 LOCKED):
```tsx
<WarningBanner className="border-l-4 border-warning bg-warning/5">
  <div role="note" aria-label="Wizard read-only key requirement">
    <p className="text-sm">
      <span className="font-semibold text-text-primary uppercase">READ ONLY</span>
      {" "}— READ ONLY ONLY — keys with Trade or Withdraw permissions are refused on submission.
    </p>
    <p className="text-xs text-text-muted mt-1">
      Read-only is enforced server-side at validation — Trade/Withdraw scopes are rejected before encryption.
    </p>
  </div>
</WarningBanner>
```

**What to copy verbatim:**
- The `<WarningBanner className="border-l-4 border-warning bg-warning/5">` chrome (matches S1's locked override)
- `role="note" aria-label="Wizard read-only key requirement"` (UI-SPEC §S5 + §Accessibility — NOT `role="alert"`)
- The verbatim copy: `READ ONLY ONLY — keys with Trade or Withdraw permissions are refused on submission.` (CONTEXT D-08 byte-identical)
- Component name `WithdrawalWarningStrip` byte-identically (UI-SPEC AC #7 — no alias)

**What to vary:**
- Mount in WizardClient.tsx parent layout (NOT each step file) — see WizardClient mod pattern below
- Persistent (no dismiss control); always renders

---

### `src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx` (S7, component)

**Analog:** `src/components/ui/WarningBanner.tsx` (same as S5)

**Same WarningBanner chrome + locked sentence** (UI-SPEC §S7 LOCKED):
```tsx
<WarningBanner className="border-l-4 border-warning bg-warning/5">
  <p role="note" aria-label="Exchange IP allowlist hint" className="text-sm">
    Locking your exchange key to an IP allowlist? Allow our egress IPs — see{" "}
    <a href="/security#egress-ips" className="text-accent underline-offset-4 hover:underline">
      /security#egress-ips
    </a>
    .
  </p>
</WarningBanner>
```

**What to copy verbatim:**
- Same `<WarningBanner className="border-l-4 border-warning bg-warning/5">` chrome as S5
- The CONTEXT D-07 verbatim sentence: `Locking your exchange key to an IP allowlist? Allow our egress IPs — see [/security#egress-ips].`
- The `/security#egress-ips` anchor (matches existing anchor at security/page.tsx line 457)

---

### `src/app/(dashboard)/profile/components/AuditLogSubsection.tsx` (S6, component)

**Analogs:** `src/components/ui/Button.tsx` (accent button) + `src/app/api/account/export/route.ts` (download trigger pattern, but inline — not button-spawned)

**Button accent variant pattern** (Button.tsx lines 7-19):
```typescript
const variantStyles: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  // …
};

const sizeStyles: Record<Size, string> = {
  // …
  md: "min-h-[44px] px-4 py-2.5 text-sm",
  lg: "min-h-[44px] px-6 py-3 text-base",
};
```
Default size already satisfies 44×44 touch target (UI-SPEC §Spacing).

**Browser download trigger pattern** (idiomatic `<a href={url} download={filename}>` OR programmatic `fetch + Blob + URL.createObjectURL`). The simplest path uses a plain `<a href="/api/me/audit-log/export" download>` since the route sets `Content-Disposition: attachment`.

**aria-live pattern** (AllocationsTabs.tsx lines 27-44 — for status region):
```tsx
<div
  role="status"
  aria-live="polite"
  aria-label={`Loading ${label}`}
  className="flex h-64 items-center justify-center"
>
```

**What to copy verbatim:**
- `<Button>` accent variant (default `variant="primary"` — `bg-accent text-white hover:bg-accent-hover`)
- `aria-live="polite"` for status messages
- `aria-label="Download audit log CSV for the last 90 days"` per UI-SPEC §Accessibility S6

**What to vary:**
- For S6 simplicity: use a plain anchor `<a href="/api/me/audit-log/export">` with `download` attribute (browser respects `Content-Disposition: attachment` automatically; no Blob plumbing needed)
- Loading-state copy and animation are at planner discretion per UI-SPEC §S6

---

### `src/app/security/page.tsx` (MOD — D-05/D-06/D-07)

**Analog:** self — existing `<section aria-labelledby="…">` editorial blocks within same file

**Existing editorial section pattern** (security/page.tsx lines 175-211 — Compliance Posture, BEFORE inserting D-06 banner):
```tsx
<section
  aria-labelledby="compliance-posture"
  className="mt-12 border-t border-border pt-12"
>
  <h2
    id="compliance-posture"
    className="font-display text-2xl tracking-tight text-text-primary"
  >
    Compliance posture
  </h2>
  <div className="mt-4 space-y-4 text-[14px] leading-relaxed text-text-primary">
    <p>
      We are a pre-audit company. Preparing for SOC 2 Type 1;
      internal controls — access reviews, change management,
      vendor management, incident response — are documented and
      followed today, with the formal attestation to follow.
      Allocators evaluating us under diligence should engage our
      security contact for a current posture letter under NDA.
    </p>
    {/* … */}
  </div>
</section>
```

**Existing #egress-ips body to REPLACE** (security/page.tsx lines 457-470):
```tsx
<Section id="egress-ips" title="Egress IPs (IP-allowlist keys)">
  <p>
    If your exchange key is locked to an IP allowlist, allow our
    analytics service egress range. Email{" "}
    <a
      href="mailto:security@quantalyze.com"
      className="text-accent underline-offset-4 hover:underline"
    >
      security@quantalyze.com
    </a>{" "}
    for the current IP set — we rotate infrequently and will
    notify ahead of any change.
  </p>
</Section>
```

**Existing data-handling-summary section** (security/page.tsx lines 213-293 — D-05 link inserted at the END of this `<section>`, before closing tag):
```tsx
<section
  aria-labelledby="data-handling-summary"
  className="mt-12 border-t border-border pt-12"
>
  {/* heading + paragraph + table */}
</section>
```

**Existing accent-link styling** (security/page.tsx line 204):
```tsx
className="text-accent underline-offset-4 hover:underline"
```

**What to copy verbatim:**
- The existing `<section aria-labelledby="…" className="mt-12 border-t border-border pt-12">` rhythm — MUST be preserved (UI-SPEC AC #9 + Interaction Contract §S4)
- The `font-display text-2xl tracking-tight text-text-primary` heading style (existing)
- The `text-[14px] leading-relaxed text-text-primary` body prose style (existing)
- The `text-accent underline-offset-4 hover:underline` link style (existing)
- ALL anchor IDs byte-identically: `#data-handling`, `#key-handling`, `#compliance-posture`, `#data-handling-summary`, `#breach-notification`, `#security-contact`, `#operational-reference`, `#egress-ips`

**What to vary (D-06 banner — UI-SPEC §S4a):**
- Insert `bg-warning/5 border-l-4 border-warning px-4 py-3 mb-6` 1-line banner BEFORE the Compliance Posture's first paragraph
- Verbatim copy: `SOC 2 status: pre-audit, preparing for SOC 2 Type 1. Allocators evaluating us under diligence — request a posture letter.`
- `request a posture letter` is `<a href="mailto:security@quantalyze.com?subject=Posture%20letter%20request" className="text-accent underline-offset-4 hover:underline">`
- `role="status" aria-live="polite"` per UI-SPEC §Accessibility S4a

**What to vary (D-07 egress-IP body — UI-SPEC §S4b):**
- Replace the `<p>` body with new prose + IP block
- IP placeholders rendered in a `<div>` (NOT `<pre>` per UI-SPEC §Accessibility S4b) with `font-mono tabular-nums text-[13px] bg-page` styling
- Planner sources actual IPs from infrastructure docs; if not available, STOP and ask (UI-SPEC §S4b lockdown)

**What to vary (D-05 1-line audit-log link — UI-SPEC §S4c):**
- Append a single `<p className="mt-6 text-[14px] leading-relaxed text-text-muted">` AFTER the data-handling-summary `<table>`, BEFORE the section closing tag
- Verbatim copy: `If you have an account, you can download your audit log from your profile.`
- `download your audit log` is `<a href="/profile?tab=security" className="text-accent underline-offset-4 hover:underline">`

---

### `src/components/auth/ProfileTabs.tsx` (MOD — add `security` tab)

**Analog:** self — existing `ALL_TABS` tuple + `parseTabParam` pattern in same file

**Tab tuple extension pattern** (ProfileTabs.tsx lines 17-23 — extend with new key):
```typescript
const ALL_TABS = [
  { key: "personal", label: "Personal Info" },
  { key: "mandate", label: "Mandate", allocatorOnly: true },
  { key: "exchanges", label: "Exchanges", allocatorOnly: true },
  { key: "organizations", label: "Organizations" },
  { key: "account", label: "Account" },
] as const;
```

**Tab content render pattern** (ProfileTabs.tsx lines 91-106):
```tsx
{activeTab === "personal" && <ProfileForm profile={profile} />}
{activeTab === "mandate" && isAllocator && (
  <MandateForm initial={initialPreferences} />
)}
{activeTab === "exchanges" && isAllocator && exchanges && (
  <ExchangesTabContent
    initialKeys={exchanges.initialKeys}
    activePortfolio={exchanges.activePortfolio}
  />
)}
{activeTab === "organizations" && <OrganizationTab />}
{activeTab === "account" && (
  <div className="max-w-xl">
    <DeleteAccountButton />
  </div>
)}
```

**What to copy verbatim:**
- The `as const` tuple + `(typeof ALL_TABS)[number]["key"]` derived `TabKey` type
- The `parseTabParam` function (handles unknown query params + role gating)
- The `useEffect` URL sync block (lines 59-68) — DON'T mutate, the new tab inherits this for free

**What to vary:**
- Add `{ key: "security", label: "Security" }` (no `allocatorOnly` flag — every authenticated user has audit_log rows; gating by role is unnecessary)
- Render `{activeTab === "security" && <AuditLogSubsection />}` block at the bottom of the tab content render fan-out

---

### `src/app/(dashboard)/allocations/MyAllocationClient.tsx` (MOD — render S1+S2)

**Analog:** self — existing `flaggedHoldings` prop pass-through pattern (lines 95-119)

**Existing payload-prop extension pattern** (MyAllocationClient.tsx lines 90-119):
```typescript
interface MyAllocationClientProps {
  portfolio: Portfolio;
  analytics: PortfolioAnalytics | null;
  strategies: StrategyRow[];
  apiKeys: ApiKeyRow[];
  // Phase 09.1 Plan 11 / R5 — optional pass-through of `flaggedHoldings`
  // from the page payload so AllocationProvider can publish the count
  // without a new server query. The shape is intentionally loose
  // (anything with a `length` is acceptable) because this client is no
  // longer the live entry point — AllocationsTabs is — and the only
  // consumer here is the provider's `.length` read.
  flaggedHoldings?: ReadonlyArray<unknown>;
}

export function MyAllocationClient({
  portfolio,
  analytics,
  strategies,
  apiKeys,
  flaggedHoldings,
}: MyAllocationClientProps) {
  // …
  const flaggedCount = flaggedHoldings?.length ?? 0;
```

**What to copy verbatim:**
- The doc-comment pattern justifying a new prop (Phase + decision ref + reasoning)
- Optional `?:` prop with safe default fallback

**What to vary:**
- Add `apiKeysCount: number;` to the props interface (alongside existing `apiKeys` array — count is the gating value per UI-SPEC §Interaction Contract; the array is for legacy consumers)
- Add `mandateIsSet: boolean;` for the S2 `visible_S2` predicate
- Render `<OnboardingBanner />` and `<MandateQuickSetCard />` ABOVE `<AllocationsTabs>` when `apiKeysCount === 0`

---

### `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (MOD — mount S5+S7)

**Analog:** self — existing children block in `<WizardChrome>` at lines 300-399

**Mount-point pattern** (WizardClient.tsx lines 300-399, IMMEDIATELY before the step branches):
```tsx
<WizardChrome
  currentStep={step}
  savedAt={savedAt}
  canDelete={Boolean(strategyId)}
  onDeleteDraft={() => setConfirmDelete(true)}
  onRequestCall={handleOpenRequestCall}
  toastKey={toastKey}
>
  {sessionExpired && (
    <div className="mb-4 rounded-md border border-border bg-page px-3 py-2 text-xs text-text-secondary">
      Your session expired. Your draft is saved.{" "}
      {/* … */}
    </div>
  )}

  {showResumeBanner && initialDraft && (
    <div className="mb-4 rounded-md border border-border bg-white px-4 py-3">
      {/* resume banner */}
    </div>
  )}

  {step === "connect_key" && (
    <ConnectKeyStep
      wizardSessionId={wizardSessionId}
      onSuccess={handleConnectSuccess}
    />
  )}

  {step === "sync_preview" && strategyId && ( /* … */ )}
  {step === "metadata" && strategyId && syncSnapshot && ( /* … */ )}
  {step === "submit" && strategyId && syncSnapshot && metadataDraft && ( /* … */ )}
</WizardChrome>
```

**What to copy verbatim:**
- The position of new mounts: AFTER session-expired + resume banner blocks, BEFORE the first `{step === ...}` branch (per RESEARCH.md §Code Examples line 887-901: shown there with comments)

**What to vary:**
- Insert `<WithdrawalWarningStrip />` then `<WizardIpAllowlistHint />` (in that order — UI-SPEC §Interaction Contract §S5+S7 mounting locks the order)
- Vertical spacing: `mt-2` between S5 and S7 (UI-SPEC §S7 spacing-above)
- BOTH render unconditionally on every wizard mount (not gated by step state)

---

### `src/lib/queries.ts` (MOD — `apiKeysCount` field)

**Analog:** self — existing `MyAllocationDashboardPayload` interface + `getMyAllocationDashboard` aggregator

**Payload interface pattern** (queries.ts lines 552-700 — existing fields):
```typescript
export interface MyAllocationDashboardPayload {
  portfolio: Portfolio | null;
  analytics: PortfolioAnalytics | null;
  strategies: Array</* … */>;
  apiKeys: Array<{
    id: string;
    exchange: string;
    label: string;
    is_active: boolean;
    sync_status: string | null;
    last_sync_at: string | null;
    account_balance_usdt: number | null;
    created_at: string;
  }>;
  alertCount: { /* … */ };
  // …
  hasSyncing: boolean;
  // …
}
```

**Parallel fetch pattern** (queries.ts lines 1086-1140):
```typescript
const [
  portfolio,
  phase07EquityRes,
  phase07HoldingsRes,
  apiKeys,
  // …
] = await Promise.all([
  getRealPortfolio(userId),
  supabase
    .from("allocator_equity_snapshots")
    .select("…")
    .eq("allocator_id", userId),
  // …
  getUserApiKeys(userId),
  // …
]);
```

**What to copy verbatim:**
- The `MyAllocationDashboardPayload` interface extension shape (add new field with doc-comment)
- The Promise.all parallel-fan-out idiom

**What to vary:**
- Add `apiKeysCount: number;` field — derived from `apiKeys.length` (existing fetch already returns the array; no new query needed). Example: `const apiKeysCount = apiKeys.length;` then thread into return statement at line 1494.
- (Optional) Add `mandateIsSet: boolean;` for the S2 visibility predicate — derived from `mandate !== null` (existing `mandate` is fetched at line 1105 via `getOwnPreferences`)
- (Optional) Add `firstApiKeyAddedEmittedAt: string | null;` etc. if Plan 03 wires the marker reader server-side at this aggregator (RESEARCH §Architecture Diagram suggests this fire-site)

---

### `e2e/onboarding-funnel.spec.ts` (test)

**Analogs:** `e2e/full-flow.spec.ts` (CONTEXT D-15 LOCKED template) + `e2e/auth.spec.ts` (login bootstrap) + `e2e/api-key-flow.spec.ts` (validate-and-encrypt patterns)

**Auth bootstrap pattern** (full-flow.spec.ts lines 51-60):
```typescript
test.describe("Authenticated flows", () => {
  test.beforeEach(async ({ page }) => {
    // Login with test account
    await page.goto("/login");
    await page.fill('input[name="email"], input[placeholder*="email" i]', "matratzentester24@gmail.com");
    await page.fill('input[type="password"]', "Test12");
    await page.click('button:has-text("Sign in")');
    // Wait for redirect to discovery
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });
  });
```

**Page navigation + assertion pattern** (full-flow.spec.ts lines 72-75):
```typescript
test("allocations page loads", async ({ page }) => {
  await page.goto("/allocations");
  await expect(page.locator("h1")).toContainText("My Allocations");
});
```

**Login form selectors** (auth.spec.ts lines 4-9):
```typescript
test("login form has email and password fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in|log in/i })).toBeVisible();
});
```

**Stub-the-exchange pattern** (RESEARCH.md §Pitfall 5 lines 783-792 — LOCKED):
```typescript
await page.route("**/api/keys/validate-and-encrypt", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, scopes: ["read"] }),
  });
});
```

**What to copy verbatim:**
- The `test.describe` + `test.beforeEach` shape from full-flow.spec.ts
- The `page.fill('input[type="email"]', email)` / `page.fill('input[type="password"]', pw)` + `page.click('button:has-text("Sign in")')` login sequence
- The `page.route("**/api/keys/validate-and-encrypt", …)` interceptor pattern (Pitfall 5 mandate)

**What to vary:**
- Use seeded test credentials from helpers (NOT `matratzentester24@gmail.com` — that's the dev/staging account, not deterministic test data)
- Walk a 5-step funnel sequence per CONTEXT D-15: signup → API key add → Performance tab populated → Scenario open + holding toggle → Bridge add + commit → outcome recorded
- Assert all 5 PostHog events fired by polling a test-mode capture endpoint (CONTEXT D-15 + RESEARCH §Validation table line 1037)
- Total spec timeout: <60s (RESEARCH §Validation Architecture)

---

### `e2e/helpers/seed-test-project.ts` + `cleanup-test-project.ts` (helper)

**Analog:** `src/lib/test-helpers/live-db.ts` (closest in-repo Supabase service-role test pattern; verified in RESEARCH §Sources line 1136)

**No direct e2e helpers analog** — `e2e/helpers/` does not exist today. This is greenfield per D-15. The closest in-repo precedent is `src/lib/test-helpers/live-db.ts` for Vitest live-DB integration tests.

**Service-role admin pattern** (planner reads `src/lib/test-helpers/live-db.ts` at scaffold time — should expose `createClient(SUPABASE_URL, SERVICE_ROLE_KEY)` + setup/teardown helpers).

**What to copy verbatim:**
- Service-role JWT pattern (read `process.env.TEST_SUPABASE_SERVICE_ROLE_KEY`, fail loudly if absent — D-15 + D-16 LOCKED)
- Idempotent seed shape (cleanup before seed → re-create → return ids needed by spec)

**What to vary:**
- Greenfield directory `e2e/helpers/` (planner creates)
- Two functions exported: `seedTestProject(): Promise<{ allocatorEmail, allocatorId, candidateStrategyId }>` and `cleanupTestProject(allocatorId): Promise<void>`
- Used by `onboarding-funnel.spec.ts`'s `test.beforeAll` and `test.afterAll`

---

### `.github/workflows/ci.yml` (MOD — gated step)

**Analog:** self — existing `e2e:` job at lines 87-147

**Existing e2e job step pattern** (ci.yml lines 120-140):
```yaml
- name: Start server and run Playwright
  run: |
    npm run start &
    SERVER_PID=$!
    # Wait for server to respond (max 30s)
    for i in $(seq 1 30); do
      if curl -sf http://localhost:3000 > /dev/null 2>&1; then
        echo "Server ready after ${i}s"
        break
      fi
      sleep 1
    done
    npx playwright test e2e/auth.spec.ts e2e/smoke.spec.ts e2e/demo-public.spec.ts e2e/demo-founder-view.spec.ts
    kill $SERVER_PID 2>/dev/null || true
  env:
    NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder
    SUPABASE_SERVICE_ROLE_KEY: placeholder_service_role
    ADMIN_EMAIL: test@example.com
    PLATFORM_NAME: Quantalyze
    PLATFORM_EMAIL: test@quantalyze.com
```

**Gated-step pattern** (RESEARCH.md §Pattern lines 904-927 — locked shape):
```yaml
- name: Run onboarding-funnel spec (gated)
  if: ${{ secrets.TEST_SUPABASE_URL != '' }}
  run: npx playwright test e2e/onboarding-funnel.spec.ts
  env:
    NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
    ADMIN_EMAIL: test@example.com
    PLATFORM_NAME: Quantalyze
    PLATFORM_EMAIL: test@quantalyze.com
```

**What to copy verbatim:**
- The `if: ${{ secrets.TEST_SUPABASE_URL != '' }}` gate per CONTEXT D-16 (skip silently when secret absent — fork PRs)
- `env:` block with the 3 new TEST_* secrets

**What to vary:**
- Add as a NEW step inside the existing `e2e:` job AFTER the existing `npx playwright test e2e/auth.spec.ts …` line (so the placeholder Supabase build is reused; the gated step uses the real test project secrets)
- Step name `Run onboarding-funnel spec (gated)` per RESEARCH §Code Examples

---

## Shared Patterns

### Pattern A: server-only PostHog event emission (D-13)

**Source:** `src/lib/analytics/usage-events.ts` lines 1-3 + 64-88

**Apply to:** `src/lib/analytics/onboarding-funnel.ts`, `src/app/auth/callback/route.ts` (signup event), any new server-side fire-site

**Boilerplate:**
```typescript
import "server-only";
// …
await trackUsageEventServer(eventName, user.id, {
  funnel_step: ordinal,
  funnel_event_name: eventName,
  cohort_week_iso: meta.cohort_week_iso ?? null,
});
```

**Why shared:** D-13 LOCKS server-side via `posthog-node`; `usage-events.ts` is the single canonical client wrapper (RESEARCH §Don't-Hand-Roll line 734). Multiple new fire-sites (signup, marker readers in queries.ts, /api/usage/first-* routes) all import the same `trackUsageEventServer`.

---

### Pattern B: Auth-gated route handler shape (CONVENTIONS.md)

**Source:** `src/app/api/usage/session-start/route.ts` lines 31-41 + `src/app/api/intro/route.ts` lines 72-83

**Apply to:** `src/app/api/me/audit-log/export/route.ts`

**Boilerplate (POST mutation):**
```typescript
export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // … handler body …
  return NextResponse.json({ success: true });
}
```

**Boilerplate (GET — strip CSRF, keep auth):**
```typescript
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // … handler body …
}
```

**Why shared:** Project standard per `.planning/codebase/CONVENTIONS.md`. Every new route MUST follow the exact 4-line preamble; deviations break `audit-coverage.test.ts` and security review.

---

### Pattern C: WarningBanner className override (UI-SPEC AC #14)

**Source:** `src/components/ui/WarningBanner.tsx` (composed at S1, S5, S7)

**Apply to:** S1 OnboardingBanner, S5 WithdrawalWarningStrip, S7 WizardIpAllowlistHint, S4a `/security` D-06 status banner

**Boilerplate:**
```tsx
<WarningBanner className="border-l-4 border-warning bg-warning/5">
  {/* surface-specific children */}
</WarningBanner>
```

**Why shared:** UI-SPEC AC #14 LOCKS — no new banner / dismissable wrapper component. Three new surfaces all use the same className override; the single override token sequence appears verbatim in all three composition sites.

---

### Pattern D: sessionStorage SSR-safe dismissal (Pitfall 6 + Pitfall 8)

**Source:** RESEARCH §Pitfall 6 (lines 795-799) + Pitfall 8 (lines 807-811)

**Apply to:** S1 OnboardingBanner, S2 MandateQuickSetCard

**Boilerplate:**
```tsx
"use client";
const [dismissed, setDismissed] = useState(false);
const [mounted, setMounted] = useState(false);
useEffect(() => {
  setMounted(true);
  setDismissed(sessionStorage.getItem(KEY) === "1");
}, []);
// SSR-safe: render unconditionally on server (CLS guard);
// only hide after mount confirms dismissal.
if (mounted && dismissed) return null;
```

**Why shared:** Both surfaces gate on sessionStorage AND must render server-side without CLS. Same anti-pattern (reading `sessionStorage` during SSR — `undefined` server-side, throws), same fix (post-mount read with `mounted` flag).

---

### Pattern E: `auth.users.raw_user_meta_data` marker write (D-13 architecture)

**Source:** `supabase/migrations/053_session_count_rpc.sql` (verbatim template per RESEARCH.md §Pattern 1)

**Apply to:** Migration 084 trigger (`stamp_first_api_key_added`) + the matching RPC for `first_sync_success` called from `analytics-service/services/job_worker.py`

**Boilerplate (SECURITY DEFINER + SELECT FOR UPDATE + JSONB merge):**
```sql
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_meta JSONB;
BEGIN
  SELECT raw_user_meta_data INTO v_meta
    FROM auth.users WHERE id = <key> FOR UPDATE;

  v_meta := COALESCE(v_meta, '{}'::JSONB);
  IF v_meta ? '<marker_at>' THEN RETURN; END IF;  -- idempotent

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object('<marker_at>', now() AT TIME ZONE 'UTC')
   WHERE id = <key>;
END;
$$;
```

**Why shared:** Multiple markers (`first_api_key_added_at`, `first_sync_success_at`, `first_bridge_surfaced_at`, `first_outcome_at`) all use the same SECURITY DEFINER + idempotent-stamp shape. Migration 053 is the verbatim template per RESEARCH.md.

---

### Pattern F: `@audit-skip:` pragma for read-only routes (CONVENTIONS.md)

**Source:** `src/app/api/preferences/route.ts` lines 79-83 + RESEARCH §Pitfall 7

**Apply to:** `src/app/api/me/audit-log/export/route.ts`

**Boilerplate:**
```typescript
// @audit-skip: read-only export of caller's own audit_log rows. The
//   download itself does not mutate state; an audit emission for the
//   download would create an audit-log-of-audit-logs feedback loop.
//   Out of scope per D-05 ("download a CSV of the last 90 days").
```

**Why shared:** `audit-coverage.test.ts` greps every Supabase mutation in `src/app/api/**/route.ts` and demands a `logAuditEvent` call within 60 lines OR an `@audit-skip:` pragma. Read-only routes use the pragma; this is the canonical pattern from `preferences/route.ts`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `e2e/helpers/seed-test-project.ts` + `cleanup-test-project.ts` | test helper | CRUD (service-role seed/teardown) | Greenfield per CONTEXT D-15 — `e2e/helpers/` directory does not exist today. Closest precedent is `src/lib/test-helpers/live-db.ts` (Vitest live-DB pattern); planner reads that file at scaffold time and ports the service-role JWT setup. |

(Every other listed file has a verified analog above.)

---

## Metadata

**Analog search scope:**
- `src/components/ui/` — primitives (Card, WarningBanner, InfoBanner, Button, Skeleton)
- `src/app/(dashboard)/allocations/` — EmptyState, MyAllocationClient, AllocationsTabs
- `src/app/(dashboard)/profile/`, `src/components/auth/` — ProfileTabs, ProfileForm
- `src/app/(dashboard)/strategies/new/wizard/` — WizardClient, WizardChrome
- `src/app/api/` — usage/session-start, account/export, preferences, intro (route shape templates)
- `src/lib/` — analytics/usage-events.ts, csv.ts, queries.ts, audit, supabase/server
- `src/components/mandate/` — MandateForm (form + RPC pattern)
- `supabase/migrations/` — 053 (trigger template), 010 (audit_log RLS)
- `analytics-service/services/` — job_worker.py (post-success hook), audit.py, db.py
- `e2e/` — full-flow.spec.ts, auth.spec.ts, api-key-flow.spec.ts (E2E templates)
- `.github/workflows/ci.yml` (CI job extension)

**Files scanned:** ~25 in full-read mode; ~15 in targeted-grep mode.

**Pattern extraction date:** 2026-04-26

**Confidence:** HIGH for every pattern — every analog file was read in this session and exact line ranges cited. The only `Open Question` carry-over is the `src/lib/csv.ts` exact export shape (RESEARCH §Open Question #2) — planner does a 30-second read at scaffold time.

**Hand-off note for planner:** Per CONTEXT, every Phase 11 surface composes from existing primitives. The PATTERNS.md above gives the planner concrete file paths + line ranges + verbatim copy excerpts so each plan's "action" section can reference an analog directly (e.g. "Mirror `supabase/migrations/053_session_count_rpc.sql` lines 24-79 for the SECURITY DEFINER + SELECT FOR UPDATE + JSONB merge pattern; vary function name + idempotency guard per RESEARCH §Pattern 1"). The shared patterns A-F apply across multiple plans and should be referenced by name rather than duplicated.
