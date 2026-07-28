# Phase 07: Demo-Mode Purge — Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 11 new/modified files
**Analogs found:** 11 / 11

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/070_allocator_equity_snapshots.sql` | migration | writes allocator data | `supabase/migrations/066_allocator_holdings.sql` | exact |
| `analytics-service/services/equity_reconstruction.py` | python-worker | reads/writes allocator data | `analytics-service/services/allocator_positions.py` | exact |
| `analytics-service/services/job_worker.py` (modify) | python-worker | event-driven dispatch | same file — existing `dispatch()` + `TIMEOUT_PER_KIND` | exact |
| `analytics-service/services/scheduled_tasks.py` (modify) | python-worker | batch / cron enqueue | same file — existing `enqueue_reconcile_strategies_tick` | exact |
| `src/lib/queries.ts` (modify) | nextjs-server-query | reads allocator data | same file — existing `getMyAllocationDashboard` / `getUserApiKeys` | exact |
| `src/app/(dashboard)/allocations/page.tsx` (modify) | nextjs-server-component | reads allocator data | `src/app/(dashboard)/profile/page.tsx` | exact |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (new) | nextjs-client-component | UI-only | `src/components/auth/ProfileTabs.tsx` | exact |
| `src/app/(dashboard)/allocations/EmptyState.tsx` (new) | nextjs-client-component | UI-only | existing empty-state block in `allocations/page.tsx` lines 36–66 | role-match |
| `src/app/(dashboard)/allocations/ScenarioStub.tsx` (new) | nextjs-client-component | UI-only | any existing `<Card>` usage | role-match |
| `src/components/auth/OnboardingWizard.tsx` (verify only) | nextjs-client-component | pure | same file — `handleComplete` lines | exact |
| `src/__tests__/seed-integrity.test.ts` (extend) | test | pure | same file — existing describe blocks | exact |

---

## Pattern Assignments

### `supabase/migrations/070_allocator_equity_snapshots.sql` (migration)

**Analog:** `supabase/migrations/066_allocator_holdings.sql`

**Table DDL pattern** (lines 89–156):
```sql
CREATE TABLE IF NOT EXISTS allocator_holdings (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  allocator_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id          UUID        NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
  venue               TEXT        NOT NULL,
  symbol              TEXT        NOT NULL,
  asof                DATE        NOT NULL,
  holding_type        TEXT        NOT NULL CHECK (holding_type IN ('spot','derivative')),
  -- ... columns ...
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS allocator_holdings_owner_venue_symbol_asof_key
  ON allocator_holdings (allocator_id, venue, symbol, asof);

CREATE INDEX IF NOT EXISTS allocator_holdings_allocator_asof_desc_idx
  ON allocator_holdings (allocator_id, asof DESC);
```
For `allocator_equity_snapshots`, the PK is `(allocator_id, asof)` — no surrogate UUID needed, no `api_key_id` FK (snapshots are allocator-scoped, not per-key). Add a DESC index on `(allocator_id, asof DESC)` mirroring the line 151 pattern. Add `token_price_history` table in the same migration (no RLS — service-role writes only, no authenticated reads needed).

**Owner-coherence trigger pattern** (lines 190–218):
```sql
CREATE OR REPLACE FUNCTION enforce_allocator_holdings_owner_coherence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_expected_owner UUID;
BEGIN
  SELECT user_id INTO v_expected_owner
    FROM api_keys
    WHERE id = NEW.api_key_id;
  IF v_expected_owner IS NULL THEN
    RAISE EXCEPTION
      'allocator_holdings.api_key_id (%) does not reference an existing api_keys row',
      NEW.api_key_id;
  END IF;
  IF NEW.allocator_id IS DISTINCT FROM v_expected_owner THEN
    RAISE EXCEPTION
      'allocator_holdings.allocator_id (%) must match api_keys.user_id (%) for api_key_id %',
      ...
```
For `allocator_equity_snapshots`, since there is no `api_key_id` FK, the coherence check is simpler — assert `NEW.allocator_id` is a real `auth.users.id`. A CHECK constraint or a lighter trigger is sufficient. Mirror the SECURITY DEFINER + pinned `search_path` pattern regardless.

**3-tier RLS pattern** (lines 703–724):
```sql
ALTER TABLE allocator_holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allocator_holdings_owner_select ON allocator_holdings;
CREATE POLICY allocator_holdings_owner_select ON allocator_holdings FOR SELECT
  USING (allocator_id = auth.uid());

DROP POLICY IF EXISTS allocator_holdings_admin_select ON allocator_holdings;
CREATE POLICY allocator_holdings_admin_select ON allocator_holdings FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

DROP POLICY IF EXISTS allocator_holdings_service_all ON allocator_holdings;
CREATE POLICY allocator_holdings_service_all ON allocator_holdings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- NOTE: No INSERT/UPDATE/DELETE policy for authenticated — worker is sole
-- producer via service_role.
```
Copy verbatim, substituting `allocator_equity_snapshots` for `allocator_holdings`.

**Cron enqueue function pattern** (lines 613–697):
```sql
CREATE OR REPLACE FUNCTION enqueue_poll_allocator_positions_for_all_keys()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_api_key_id      UUID;
  v_enqueued        INTEGER := 0;
  v_job_id          UUID;
  v_jitter          INTERVAL;
  v_run_at          TIMESTAMPTZ;
  v_idempotency_key TEXT;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_allocator_polling')) THEN
    RETURN 0;
  END IF;

  FOR v_api_key_id IN
    SELECT id FROM api_keys
    WHERE is_active = true
      AND sync_status IS DISTINCT FROM 'revoked'
  LOOP
    BEGIN
      v_jitter := (random() * interval '600 seconds');
      v_run_at := now() + v_jitter;
      v_idempotency_key := 'daily-alloc-'
        || to_char(v_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        || '-' || v_api_key_id::text;

      v_job_id := enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'poll_allocator_positions',
        p_idempotency_key := v_idempotency_key,
        p_api_key_id      := v_api_key_id,
        p_run_at          := v_run_at
      );
      IF v_job_id IS NOT NULL THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  PERFORM pg_advisory_unlock(hashtext('daily_allocator_polling'));
  RETURN v_enqueued;
END;
$$;
```
`enqueue_refresh_allocator_equity_for_all` iterates `allocator_id` values from allocators that have at least one row in `allocator_equity_snapshots` (initial reconstruction complete). Uses a distinct advisory lock hashtext (`'daily_equity_refresh'`). Idempotency key prefix: `'daily-equity-'`. Scheduled at `0 5 * * *` (05:00 UTC — after 04:00 `poll-allocator-positions` completes).

**pg_cron schedule pattern** (lines 686–697):
```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poll-allocator-positions') THEN
      PERFORM cron.unschedule('poll-allocator-positions');
    END IF;
    PERFORM cron.schedule('poll-allocator-positions', '0 4 * * *',
      $cron$SELECT enqueue_poll_allocator_positions_for_all_keys();$cron$);
    RAISE NOTICE 'Scheduled poll-allocator-positions at 04:00 UTC';
  ELSE
    RAISE NOTICE 'pg_cron extension not present — skipping schedule (local dev)';
  END IF;
END$$;
```
New cron job name: `'refresh-allocator-equity'`, schedule `'0 5 * * *'`.

**Job-kind registration pattern** (from migration 066 Step 3, line 279):
```sql
INSERT INTO compute_job_kinds (name) VALUES ('reconstruct_allocator_history')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO compute_job_kinds (name) VALUES ('refresh_allocator_equity_daily')
  ON CONFLICT (name) DO NOTHING;
```
The `compute_jobs_kind_target_coherence` CHECK constraint must be extended. `reconstruct_allocator_history` requires `api_key_id IS NOT NULL` (mirrors `poll_allocator_positions`). `refresh_allocator_equity_daily` is allocator-scoped — if enqueued with `allocator_id` rather than `api_key_id`, the coherence constraint needs a new branch for that kind. Check the exact CHECK expression in migration 066 before writing the new migration.

---

### `analytics-service/services/equity_reconstruction.py` (python-worker)

**Analog:** `analytics-service/services/allocator_positions.py`

**Module-level imports + docstring pattern** (lines 1–45):
```python
"""Allocator-side holdings ingestion (Phase 06, INGEST-03 / INGEST-04 / INGEST-05).
...
"""
from __future__ import annotations

import json
from typing import Any

import ccxt.async_support as ccxt

from services.db import db_execute
from services.positions import fetch_positions
```
Replace with:
```python
"""Phase 07 historical equity reconstruction (D-01 / D-02).

Two job kinds:
  reconstruct_allocator_history — full backfill on first key connect.
  refresh_allocator_equity_daily — incremental one-day delta via cron.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from typing import Any

import ccxt.async_support as ccxt

from services.db import db_execute, get_supabase

logger = logging.getLogger("quantalyze.analytics.equity_reconstruction")
```

**Exception-to-status mapping pattern** (lines 75–92):
```python
def _map_exception_to_sync_status(exc: Exception) -> str:
    if isinstance(exc, (ccxt.AuthenticationError, ccxt.PermissionDenied)):
        return "revoked"
    if isinstance(exc, ccxt.RateLimitExceeded):
        return "rate_limited"
    return "error"
```
Copy verbatim. Equity reconstruction uses the same status values for `api_keys.sync_status` — auth failure → `revoked`, 429 → `rate_limited`, everything else → `error`.

**Idempotent upsert pattern** (lines 255–276):
```python
async def persist_allocator_holdings(
    supabase_client: Any,
    holdings: list[dict],
    allocator_id: str,
    api_key_id: str,
    asof_date: str,
) -> int:
    if not holdings:
        return 0

    rows = [
        {
            **h,
            "allocator_id": allocator_id,
            "api_key_id": api_key_id,
            "asof": asof_date,
        }
        for h in holdings
    ]

    def _upsert():
        return supabase_client.table("allocator_holdings").upsert(
            rows,
            on_conflict="allocator_id,venue,symbol,asof",
        ).execute()

    await db_execute(_upsert)
    return len(rows)
```
`persist_equity_snapshots` follows the same shape. `on_conflict` value is `"allocator_id,asof"` (the PK of `allocator_equity_snapshots`). Each row is `{ allocator_id, asof, value_usd, breakdown, source, reconstructed_at }`.

**STABLECOINS constant and raw-payload cap patterns** (lines 47–72): Use `RAW_PAYLOAD_CAP_BYTES = 4096` and `_cap_raw_payload` for the `breakdown` JSONB to keep snapshot rows bounded. The breakdown is per-symbol so large portfolios could otherwise produce unbounded JSON.

**Job handler entry-point pattern** — from `job_worker.py` lines 732–880:
```python
async def run_poll_allocator_positions_job(job: dict) -> DispatchResult:
    from services.allocator_positions import (
        fetch_allocator_holdings,
        persist_allocator_holdings,
        _map_exception_to_sync_status,
    )

    ctx = await _allocator_key_preflight(job, "run_poll_allocator_positions_job")
    if isinstance(ctx, DispatchResult):
        return ctx

    api_key_id = job["api_key_id"]
    allocator_id = ctx.key_row["user_id"]
    venue = ctx.key_row["exchange"]
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        try:
            rows, warning = await fetch_allocator_holdings(venue, ctx.exchange)
        except ccxt.RateLimitExceeded as exc:
            await _stamp_429(ctx.supabase, ctx.key_row)
            # ... stamp sync_status='rate_limited', _emit_audit, return FAILED
        except Exception as exc:
            # ... stamp sync_status=_map_exception_to_sync_status(exc), return FAILED
    finally:
        try:
            await ctx.exchange.close()
        except Exception:
            pass

    count = await persist_allocator_holdings(...)
    # ... stamp sync_status='complete'/'complete_with_warnings', _emit_audit
    return DispatchResult(outcome=DispatchOutcome.DONE)
```
`run_reconstruct_allocator_history_job` uses the same pre-flight + try/finally/close + audit emit structure. The main difference is fetching `fetch_my_trades`, `fetch_deposits_and_withdrawals`, and `fetch_ohlcv` in a loop rather than `fetch_allocator_holdings`.

---

### `analytics-service/services/job_worker.py` (modify — dispatch + TIMEOUT_PER_KIND)

**Analog:** same file — existing `TIMEOUT_PER_KIND` (lines 123–133) and `dispatch()` elif chain (lines 1432–1449).

**TIMEOUT_PER_KIND addition** (lines 123–133):
```python
TIMEOUT_PER_KIND: dict[str, float] = {
    "sync_trades": 15 * 60,
    "compute_analytics": 15 * 60,
    "compute_portfolio": 10 * 60,
    "poll_positions": 3 * 60,
    "sync_funding": 3 * 60,
    "reconcile_strategy": 5 * 60,
    "compute_intro_snapshot": 2 * 60,
    "rescore_allocator": 5 * 60,
    "poll_allocator_positions": 3 * 60,
    # ADD:
    "reconstruct_allocator_history": 30 * 60,   # 30 min — full backfill
    "refresh_allocator_equity_daily": 3 * 60,   # 3 min — one day delta
}
```

**dispatch() elif addition** (lines 1432–1451):
```python
elif kind == "poll_allocator_positions":
    handler = run_poll_allocator_positions_job
# ADD after the above:
elif kind == "reconstruct_allocator_history":
    handler = run_reconstruct_allocator_history_job
elif kind == "refresh_allocator_equity_daily":
    handler = run_refresh_allocator_equity_daily_job
```
Both new handlers are lazy-imported inside `job_worker.py` via a local `from services.equity_reconstruction import ...` inside the handler function — same pattern as `run_compute_analytics_job` (line 604: `from services.analytics_runner import run_strategy_analytics`).

**_allocator_key_preflight pattern** (lines 376–438): Copy this function signature directly into `equity_reconstruction.py` as a re-export, or call it from `job_worker.py` before delegating to the handler — same pattern as `run_poll_allocator_positions_job` at line 755: `ctx = await _allocator_key_preflight(job, "run_poll_allocator_positions_job")`.

---

### `analytics-service/services/scheduled_tasks.py` (modify — add daily refresh enqueue)

**Analog:** same file — `enqueue_reconcile_strategies_tick` (lines 100–138).

**Existing enqueue tick pattern** (lines 100–138):
```python
async def enqueue_reconcile_strategies_tick() -> dict[str, int]:
    supabase = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    def _fetch():
        return (
            supabase.from_("strategies")
            .select("id, api_keys!inner(exchange, is_active, last_sync_at)")
            .eq("api_keys.is_active", True)
            .in_("api_keys.exchange", list(PERP_EXCHANGES))
            .gt("api_keys.last_sync_at", cutoff)
            .execute()
        )

    fetch_result = await db_execute(_fetch)
    rows = fetch_result.data or []
    strategy_ids = [r["id"] for r in rows]

    if not strategy_ids:
        logger.info("[scheduled/reconcile_strategy] no candidates")
        return {"enqueued": 0, "failed": 0, "total_candidates": 0}

    enqueued, errors = await db_execute(
        lambda: _enqueue_each(supabase, strategy_ids, "reconcile_strategy")
    )
    logger.info(
        "[scheduled/reconcile_strategy] enqueued=%d failed=%d total=%d",
        enqueued, len(errors), len(strategy_ids),
    )
    return {"enqueued": enqueued, "failed": len(errors), "total_candidates": len(strategy_ids)}
```
`enqueue_refresh_allocator_equity_tick` adapts this shape. Key differences:
- Candidates are `allocator_id` values from `allocator_equity_snapshots` (distinct — initial reconstruction done), joined to confirm at least one active `api_keys` row synced within 24h.
- Enqueue kind: `"refresh_allocator_equity_daily"`.
- The `_enqueue_each` helper uses `enqueue_compute_job` with `p_allocator_id` (not `p_strategy_id`) — check the existing migration 066 RPC signature.

Note: `scheduled_tasks.py` currently does not contain an allocator-level daily enqueue tick. The Phase 06 cron is Postgres-side (pg_cron calling the SQL function directly). Adding a Python-side tick in `scheduled_tasks.py` is optional if pg_cron handles it entirely — coordinate with Plan 07-01 to avoid double-enqueue.

---

### `src/lib/queries.ts` (modify — `getMyAllocationDashboard` rewire)

**Analog:** same file — existing `getMyAllocationDashboard` (lines 639–740+) and `getUserApiKeys` (lines 609–637).

**Existing parallel fetch pattern** (lines 668–714):
```typescript
const nowIso = new Date().toISOString();
const [
  analyticsRes,
  strategiesRes,
  apiKeys,
  alertsRes,
  // ... more
] = await Promise.all([
  admin.from("portfolio_analytics").select("*").eq("portfolio_id", portfolio.id)
    .order("computed_at", { ascending: false }).limit(1).maybeSingle(),
  admin.from("portfolio_strategies").select(`...`).eq("portfolio_id", portfolio.id)
    .order("current_weight", { ascending: false }),
  getUserApiKeys(userId),
  supabase.from("portfolio_alerts").select("id, severity")
    .eq("portfolio_id", portfolio.id).is("acknowledged_at", null),
  // ...
]);
```
Phase 07 extends `Promise.all` to add:
- `supabase.from("allocator_equity_snapshots").select("asof, value_usd, breakdown, source").eq("allocator_id", userId).order("asof", { ascending: true })`
- `supabase.from("allocator_holdings").select("symbol, quantity, mark_price, value_usd, venue, holding_type").eq("allocator_id", userId).eq("asof", todayStr)` (or max asof)
- Count query (use `{ count: 'exact', head: true }`) for snapshot count — no rows fetched
- Active keys staleness check (from RESEARCH.md Section 7)

**Warm-up COUNT pattern** (from RESEARCH.md Section 3D):
```typescript
const { count } = await supabase
  .from('allocator_equity_snapshots')
  .select('*', { count: 'exact', head: true })
  .eq('allocator_id', userId);

const snapshotCount = count ?? 0;
const warmingUp = snapshotCount < 30;
```

**Staleness check pattern** (from RESEARCH.md Section 3E):
```typescript
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const { data: activeKeys } = await supabase
  .from('api_keys')
  .select('last_sync_at, is_active')
  .eq('user_id', userId)
  .eq('is_active', true);

const allKeysStale = (activeKeys ?? []).length > 0 &&
  (activeKeys ?? []).every(k => !k.last_sync_at || k.last_sync_at < cutoff);

const lastSyncAt = (activeKeys ?? []).reduce<string | null>((max, k) => {
  if (!k.last_sync_at) return max;
  return !max || k.last_sync_at > max ? k.last_sync_at : max;
}, null);
```

**getUserApiKeys hasSyncing pattern** — extend the existing return shape:
```typescript
const hasSyncing = (apiKeys).some(
  k => k.sync_status === 'syncing' && k.is_active
);
```

**Early-return (no portfolio) pattern** (lines 646–657):
```typescript
if (!portfolio) {
  return {
    portfolio: null,
    analytics: null,
    strategies: [],
    apiKeys: await getUserApiKeys(userId),
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [] as OutcomeRow[],
  };
}
```
Phase 07: the early return is no longer keyed on `!portfolio` — it's possible to have an allocator with no portfolio but WITH api_keys + snapshots. The function should always fetch `equitySnapshots`, `holdingsSummary`, `snapshotCount`, `allKeysStale`, and `lastSyncAt` regardless of portfolio presence. Existing portfolio/analytics/strategies/outcomes fields remain unchanged for bridge/outcome widgets.

---

### `src/app/(dashboard)/allocations/page.tsx` (modify — Suspense wrap)

**Analog:** `src/app/(dashboard)/profile/page.tsx` (lines 1–74)

**Server component auth + data fetch pattern** (lines 13–57):
```typescript
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/onboarding");

  const isAllocator = profile.role === "allocator" || profile.role === "both";
  // ...parallel fetches...
  return (
    <>
      <PageHeader title="Profile Settings" description="..." actions={<SignOutButton />} />
      <ProfileTabs profile={profile} ... />
    </>
  );
}
```
Phase 07 `page.tsx` follows the same shape. Key difference: wrap the client component in `<Suspense fallback={<div />}>` because `AllocationsTabs` uses `useSearchParams` (RESEARCH.md Section 8 / Pitfall 2).

**Suspense requirement** (from RESEARCH.md Section 8):
```tsx
import { Suspense } from "react";
import { AllocationsTabs } from "./AllocationsTabs";

export default async function MyAllocationPage() {
  // ...server-side fetches...
  return (
    <main className="max-w-[1280px] mx-auto p-6 pb-20">
      <PageHeader title="My Allocation" description="..." />
      <Suspense fallback={<div />}>
        <AllocationsTabs
          equitySnapshots={equitySnapshots}
          holdingsSummary={holdingsSummary}
          snapshotCount={snapshotCount}
          allKeysStale={allKeysStale}
          lastSyncAt={lastSyncAt}
          hasSyncing={hasSyncing}
          apiKeys={apiKeys}
          // bridge/outcome props retained unchanged
          portfolio={portfolio}
          analytics={analytics}
          strategies={strategies}
          alertCount={alertCount}
          outcomes={outcomes}
        />
      </Suspense>
    </main>
  );
}
```
The existing `page.tsx` currently renders `<AllocationDashboard>` as a direct server-rendered client component without a Suspense boundary — add the boundary here.

---

### `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (new client component)

**Analog:** `src/components/auth/ProfileTabs.tsx` (lines 1–109)

**Imports pattern** (lines 1–16):
```typescript
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
```

**Tab constant + parseTabParam pattern** (lines 17–37):
```typescript
const ALL_TABS = [
  { key: "personal", label: "Personal Info" },
  { key: "mandate", label: "Mandate", allocatorOnly: true },
  // ...
] as const;

type TabKey = (typeof ALL_TABS)[number]["key"];
const VALID_TAB_KEYS = ALL_TABS.map((t) => t.key) as readonly TabKey[];

function parseTabParam(raw: string | null, isAllocator: boolean): TabKey {
  if (!raw) return "personal";
  if (!(VALID_TAB_KEYS as readonly string[]).includes(raw)) return "personal";
  // ...
  return raw as TabKey;
}
```
Phase 07 simplification — only 2 tabs, no `allocatorOnly` flag needed:
```typescript
const TABS = [
  { key: "performance", label: "Performance" },
  { key: "scenario", label: "Scenario" },
] as const;

type TabKey = typeof TABS[number]["key"];

function parseTab(raw: string | null): TabKey {
  if (raw === "scenario") return "scenario";
  return "performance"; // default + invalid fallback (D-04)
}
```

**URL sync via useEffect + router.replace pattern** (lines 58–68):
```typescript
useEffect(() => {
  const current = searchParams.get("tab");
  const next = activeTab === "personal" ? null : activeTab;
  if (current === next) return;
  const params = new URLSearchParams(searchParams.toString());
  if (next) params.set("tab", next);
  else params.delete("tab");
  const qs = params.toString();
  router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
}, [activeTab, searchParams, router, pathname]);
```
For `AllocationsTabs`, when `activeTab === "performance"` delete the param (clean URL); when `"scenario"` set it. The `useEffect` approach (not `onClick`) ensures the URL stays in sync even if `activeTab` is set from an external source.

**Tab button render pattern** (lines 74–89):
```tsx
<div className="flex gap-1 border-b border-border mb-6">
  {tabs.map((tab) => (
    <button
      key={tab.key}
      onClick={() => setActiveTab(tab.key)}
      className={cn(
        "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
        activeTab === tab.key
          ? "border-accent text-text-primary"
          : "border-transparent text-text-muted hover:text-text-secondary",
      )}
    >
      {tab.label}
    </button>
  ))}
</div>
```
Exact classes from ProfileTabs.tsx. UI-SPEC.md confirms the same tokens: `px-4 py-2.5`, `border-b-2 -mb-px`, `border-accent text-accent` for active (note: UI-SPEC uses `text-accent` not `text-text-primary` for active tab label — follow UI-SPEC, not the ProfileTabs.tsx literal).

**5s polling pattern** — add inside `AllocationsTabs` for the Performance tab only (Phase 06 precedent, inherited per CONTEXT.md):
```typescript
const router = useRouter();
useEffect(() => {
  if (activeTab !== "performance") return;
  const id = setInterval(() => {
    if (document.visibilityState === "visible") router.refresh();
  }, 5000);
  return () => clearInterval(id);
}, [activeTab, router]);
```

---

### `src/app/(dashboard)/allocations/EmptyState.tsx` (new client component)

**Analog:** existing empty-state block in `allocations/page.tsx` lines 36–66 + UI-SPEC.md § Empty state

**Existing empty-state Card pattern** (page.tsx lines 36–66):
```tsx
<Card className="text-center py-12">
  <p className="text-text-muted mb-4">
    No exchange connections yet. Add a read-only API key...
  </p>
  <Link
    href="/strategies"
    className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
  >
    Browse Strategies
  </Link>
  <p className="mt-4 text-[13px] text-text-muted">
    <Link href="/security" className="text-accent underline-offset-4 hover:underline">
      Review our security posture →
    </Link>
  </p>
</Card>
```
Phase 07 `EmptyState` uses the same `Card`, `py-12`, and `bg-accent` CTA button pattern. Copy verbatim, substituting:
- Heading: `<h2>` Instrument Serif 24px `"No positions to analyze yet."`
- Sub-line: DM Sans 14px `text-text-secondary`
- CTA: `href="/profile?tab=exchanges"`, label `"Connect Exchange →"`, same `bg-accent` classes
- No secondary link needed on the empty state (only on the Notices card per D-09)

**InfoBanner (first-sync) pattern** — rendered inside `EmptyState` when `hasSyncing === true` before showing the centred card:
```tsx
import { InfoBanner } from "@/components/ui/InfoBanner";
// ...
{hasSyncing && (
  <InfoBanner>
    Syncing your first positions — this usually takes under a minute.
  </InfoBanner>
)}
```
Reference existing usage of `InfoBanner` in the codebase for the exact prop shape.

---

### `src/app/(dashboard)/allocations/ScenarioStub.tsx` (new client component)

**Analog:** Any existing `<Card>` usage in the codebase

**Scenario stub pattern** (from RESEARCH.md Section 8):
```tsx
import { Card } from "@/components/ui/Card";

export function ScenarioStub() {
  return (
    <Card className="py-12 text-center">
      <h2 className="font-serif text-2xl text-text-primary mb-2">
        Scenario builder coming soon
      </h2>
      <p className="text-sm text-text-secondary max-w-md mx-auto">
        Model what-if outcomes by adding or removing strategies and holdings
        from your live composition. Available in the next update.
      </p>
    </Card>
  );
}
```
Zero logic, zero `useEffect`, zero dynamic imports. Safe under Strict Mode double-invocation.

---

### `src/components/auth/OnboardingWizard.tsx` (verify only — PURGE-05)

**Analog:** same file (verified in RESEARCH.md Section 5)

`handleComplete()` calls only `supabase.from("profiles").update(...)` then redirects. There are NO portfolio inserts, no `allocator_holdings` inserts, no seed-portfolio triggers in the file (143 lines, zero insert calls). PURGE-05 deliverable is a comment + a new test asserting the absence of inserts — no code deletion.

---

### `src/__tests__/seed-integrity.test.ts` (extend — PURGE-01 / PURGE-06)

**Analog:** same file — existing describe block structure (lines 1–96)

**Existing import-scan test structure** (lines 1–30):
```typescript
import { describe, expect, it } from "vitest";
import { ALLOCATOR_ACTIVE_ID, isDemoPortfolioId } from "@/lib/demo";
// ...

describe("seed allocator UUIDs match src/lib/demo.ts", () => {
  it("ALLOCATOR_ACTIVE matches", () => {
    expect(SEED_ALLOCATOR_ACTIVE).toBe(ALLOCATOR_ACTIVE_ID);
  });
```
Add a new `describe` block for PURGE-01 / PURGE-06 that performs a static scan (file system glob + regex) to assert no file under `src/app/(dashboard)/` or `src/lib/` (excluding `src/lib/demo.ts` and `src/lib/demo.test.ts`) imports from `@/lib/demo` or references `ALLOCATOR_ACTIVE_ID`:
```typescript
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";

describe("PURGE-01 / PURGE-06: seed IDs not in authenticated paths", () => {
  it("no file under src/app/(dashboard)/ imports from @/lib/demo", () => {
    // glob src/app/(dashboard)/**/*.{ts,tsx}
    // for each file: assert file content does not match /ALLOCATOR_ACTIVE_ID|isDemoPortfolioId|from.*@\/lib\/demo/
  });

  it("src/lib/queries.ts does not import from @/lib/demo", () => {
    const content = readFileSync(resolve(__dirname, "../../src/lib/queries.ts"), "utf-8");
    expect(content).not.toMatch(/ALLOCATOR_ACTIVE_ID|isDemoPortfolioId/);
    expect(content).not.toMatch(/from.*['"]@\/lib\/demo['"]/);
  });
});
```

---

## Shared Patterns

### Authentication (server component)
**Source:** `src/app/(dashboard)/profile/page.tsx` lines 13–19
**Apply to:** `allocations/page.tsx`
```typescript
export const dynamic = "force-dynamic";

const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/login");
```

### Supabase parallel fetch
**Source:** `src/lib/queries.ts` lines 668–714
**Apply to:** `getMyAllocationDashboard` extension
```typescript
const [result1, result2, result3] = await Promise.all([
  supabase.from("table_a").select("...").eq("user_id", userId),
  supabase.from("table_b").select("...").eq("allocator_id", userId),
  supabase.from("table_c").select("*", { count: "exact", head: true }).eq("allocator_id", userId),
]);
```

### Worker error classification + audit
**Source:** `analytics-service/services/job_worker.py` lines 140–184, 441–462
**Apply to:** `equity_reconstruction.py` handlers
```python
from services.job_worker import classify_exception, _stamp_429, _emit_audit, DispatchOutcome, DispatchResult
# On RateLimitExceeded:
await _stamp_429(ctx.supabase, ctx.key_row)
error_kind, msg = classify_exception(exc)
_emit_audit(allocator_id, api_key_id, "allocator.equity.reconstruct_failed", {...})
return DispatchResult(outcome=DispatchOutcome.FAILED, error_message=msg[:500], error_kind=error_kind)
```

### Worker exchange close pattern
**Source:** `analytics-service/services/job_worker.py` lines 829–833
**Apply to:** `equity_reconstruction.py` handlers
```python
finally:
    try:
        await ctx.exchange.close()
    except Exception:  # pragma: no cover - defensive cleanup
        pass
```

### Lazy deferred import in dispatch handlers
**Source:** `analytics-service/services/job_worker.py` lines 749–750, 604–606
**Apply to:** new handlers in `job_worker.py`
```python
elif kind == "reconstruct_allocator_history":
    from services.equity_reconstruction import run_reconstruct_allocator_history_job
    handler = run_reconstruct_allocator_history_job
```

### db_execute wrapper
**Source:** `analytics-service/services/allocator_positions.py` lines 269–275
**Apply to:** all supabase reads/writes in `equity_reconstruction.py`
```python
def _upsert():
    return supabase_client.table("allocator_equity_snapshots").upsert(
        rows,
        on_conflict="allocator_id,asof",
    ).execute()

await db_execute(_upsert)
```

### Tab URL sync (client component)
**Source:** `src/components/auth/ProfileTabs.tsx` lines 54–68
**Apply to:** `AllocationsTabs.tsx`
```typescript
const searchParams = useSearchParams();
const initialTab = parseTabParam(searchParams.get("tab"), isAllocator);
const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

useEffect(() => {
  const current = searchParams.get("tab");
  const next = activeTab === "personal" ? null : activeTab;
  if (current === next) return;
  const params = new URLSearchParams(searchParams.toString());
  if (next) params.set("tab", next);
  else params.delete("tab");
  const qs = params.toString();
  router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
}, [activeTab, searchParams, router, pathname]);
```

### Supabase service_role write (Python)
**Source:** `analytics-service/services/allocator_positions.py` lines 241–276
**Apply to:** `equity_reconstruction.py` persist functions
The worker always writes via `get_supabase()` which returns the service-role client. RLS is bypassed at the client level AND explicitly permitted by the `service_role FOR ALL` policy. No user-scoped client is ever used for writes.

---

## No Analog Found

No files in Phase 07 are without analog. All patterns have direct matches in the codebase.

---

## Critical Pitfalls (from RESEARCH.md — must reference in each plan)

| Pitfall | Affected File | Mitigation |
|---------|--------------|------------|
| OKX 3-month trade cap treated as error | `equity_reconstruction.py` | On empty page when `since < 90_days_ago`, log `"OKX trade history capped at 3 months"` and break cleanly |
| `useSearchParams` without `<Suspense>` | `allocations/page.tsx` | Wrap `<AllocationsTabs>` in `<Suspense fallback={<div />}>` |
| Missing `TIMEOUT_PER_KIND` entry | `job_worker.py` | Add both new kinds in same commit as handlers |
| `formatPercent(null)` returns `"0.00%"` | `src/lib/utils.ts` | Verify and fix before touching KpiStrip |
| Equity snapshots written with wrong `allocator_id` | `equity_reconstruction.py` | Derive `allocator_id` from `key_row["user_id"]`, mirror the owner-coherence trigger check |
| `refresh_allocator_equity_daily` runs before `poll-allocator-positions` | migration 070 pg_cron | Schedule at `0 5 * * *` (05:00 UTC), one hour after 04:00 holdings cron |

---

## Metadata

**Analog search scope:** `src/`, `analytics-service/`, `supabase/migrations/`
**Files scanned:** 11 primary analogs read in full
**Pattern extraction date:** 2026-04-20
