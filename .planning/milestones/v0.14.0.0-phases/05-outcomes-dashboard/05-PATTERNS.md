# Phase 5: Outcomes Dashboard — Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 21 (11 NEW + 10 MODIFY)
**Analogs found:** 21 / 21 (100% — exact or role-match)

> **REVISION NOTICE (2026-04-19):** §20 "Bridge banner callers" has been REPLACED — the D-20 threading flow is now admin-side (`SendIntroPanel` → `/api/admin/match/send-intro` → `send_intro_with_decision` RPC → `match_decisions.original_strategy_id`) rather than allocator-side prop chains. See the new §20 below for the corrected pattern. The migration target also moved from `bridge_outcomes` to `match_decisions`.
>
> Sections §1 (migration analog), §16 (queries.ts delta), §18 (route.ts delta), §19 (route.test.ts delta) reference the superseded column placement on `bridge_outcomes` and the superseded `POST /api/bridge/outcome` threading. **Authoritative sources** for the revised architecture are now:
> - `.planning/phases/05-outcomes-dashboard/05-01-PLAN.md`
> - `.planning/phases/05-outcomes-dashboard/05-01-TASKS.md`
> - `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` (D-20a..D-20d revised)
>
> The rest of this pattern map (§2–§15, §17, §21–§23, Shared Patterns A–E, Registration Ritual) remains applicable unchanged — those patterns are about widget composition / Recharts / test scaffolding / widget registry, which the revision does not affect.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/061_bridge_outcomes_original_strategy.sql` | migration (schema alter) | DDL | `supabase/migrations/059_bridge_outcomes.sql` | role-match (ALTER vs CREATE) |
| `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx` | widget container (client component) | request-response | `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx` | exact (table + expandable rows + WidgetProps) |
| `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesKPIStrip.tsx` | presentational component | pure-render | `src/app/(dashboard)/allocations/widgets/meta/CustomKpiStrip.tsx` | exact (KPI strip 3-col flex) |
| `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesTimelineRow.tsx` | row component + expand state | event-driven | PositionsTable `BannerSubRow` + `OutcomeRecordedRow` | role-match (sub-row pattern + pill copy) |
| `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesExpandedPanel.tsx` | expanded detail panel | request-response (lazy) | PositionsTable `BannerSubRow` (`<tr colSpan>`) | role-match (no pre-existing 3-col delta panel) |
| `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesSparkline.tsx` | Recharts sparkline wrapper | transform → render | `DrawdownChart.tsx` + `CumulativeVsBenchmark.tsx` | exact (hidden-axes + two-Line) |
| `src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx` | component test (Vitest+RTL) | test | `widgets/positions/positions.test.tsx` + `widgets/performance/performance.test.tsx` | exact |
| `src/lib/outcomes-kpi.ts` | pure math helper | transform | `src/lib/bridge-outcome-label.ts` | exact (pure fn + co-located test) |
| `src/lib/outcomes-kpi.test.ts` | unit test (Vitest) | test | `src/lib/bridge-outcome-label.test.ts` | exact (15-case table-driven) |
| `src/app/api/bridge/outcome/[id]/curves/route.ts` | route handler (GET, dynamic) | request-response | `src/app/api/strategies/draft/[id]/route.ts` + `src/app/api/bridge/outcome/route.ts` | role-match (GET dynamic `[id]` + admin-client for analytics) |
| `src/app/api/bridge/outcome/[id]/curves/route.test.ts` | route-handler test | test | `src/app/api/bridge/outcome/route.test.ts` | exact |
| `tests/fixtures/outcomes-kpi-parity.json` | test fixture | static data | `analytics-service/tests/fixtures/feedback_engine_v1_cold_golden.json` | role-match (different runtime — see Delta) |
| `src/__tests__/bridge-outcomes-schema.test.ts` | live-DB schema smoke test | test (HAS_LIVE_DB) | `src/__tests__/bridge-outcomes-rls.test.ts` | exact (live-DB pattern) |
| `src/lib/bridge-outcome-schema.ts` (MOD) | shared types + Zod | type-augment | self (extend `BridgeOutcome` type) | exact |
| `src/lib/bridge-outcome-label.ts` (MOD) | pure helpers | transform | self (add `deriveOutcomeStatusPill`) | exact |
| `src/lib/queries.ts` (MOD @ L599+) | server DAL (fan-out) | CRUD | self (`getMyAllocationDashboard` Promise.all) | exact |
| `src/lib/queries.my-allocation.test.ts` (MOD) | unit test | test | self (TC1–TC5 fan-out) | exact |
| `src/app/api/bridge/outcome/route.ts` (MOD) | route handler (POST) | request-response | self (extend Zod + upsert payload) | exact |
| `src/app/api/bridge/outcome/route.test.ts` (MOD) | route-handler test | test | self (add original_strategy_id assertions) | exact |
| `src/app/(dashboard)/allocations/components/{BridgeOutcomeBanner, AllocatedForm, RejectedForm}.tsx` (MOD) | banner + form callers | event-driven | self (thread prop) | exact |
| `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx` (MOD — thread prop) | table widget | request-response | self (BannerSubRow caller — pass `originalStrategyId`) | exact |
| `src/app/(dashboard)/allocations/AllocationDashboard.tsx` (MOD — prop thread) | dashboard shell | request-response | self (widgetData.strategies map) | exact |
| `src/app/(dashboard)/allocations/lib/widget-registry.ts` (MOD) | registry constant | config | self (append 8th category) | exact |
| `src/app/(dashboard)/allocations/widgets/index.ts` (MOD) | barrel | config | self (append lazy import) | exact |
| `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts` (MOD) | default-layout constant | config | self (bump LAYOUT_VERSION + append entry) | exact |

**Note on "insertBridgeOutcome helper":** the context brief references an `insertBridgeOutcome` helper in `src/lib/queries.ts`, but grep confirms **no such helper exists** — the INSERT is inline in `src/app/api/bridge/outcome/route.ts` (`.upsert({...})` at lines 132–151). The planner must extend that inline upsert payload (not a non-existent helper). This is flagged in the Modify section for `src/app/api/bridge/outcome/route.ts` below.

**Note on `MyAllocationDashboardPayload.outcomes` field:** the payload currently has no `outcomes` property (the Phase 1 fan-out populated `strategies[].existing_outcome` instead, one-per-holding). Phase 5 adds a SEPARATE top-level `outcomes: OutcomeRow[]` field carrying ALL of the allocator's outcomes (including those no longer in the portfolio), sorted `created_at DESC`. Do not conflate with the existing `strategies[].existing_outcome` per-row flag.

---

## Data Flow Position (Mermaid-style sequence)

```
USER → /allocations (Server Component)
  │
  ├──▶ getMyAllocationDashboard(user.id)  [src/lib/queries.ts:599]
  │      │
  │      └──▶ Promise.all([..., outcomes_fanout])   ←── Phase 5 ADDS this entry
  │             │                                       with strategies!fk(orig,id,name)
  │             │                                       + strategies!fk(repl,id,name) embeds
  │             ▼
  │      MyAllocationDashboardPayload { portfolio, analytics, strategies[], apiKeys[],
  │                                     alertCount, outcomes[] }  ←── NEW top-level
  │
  ▼
CLIENT: AllocationDashboard.tsx  [widgetData = useMemo(...)]
  │      │
  │      └──▶ widgetData.outcomes  ←── Phase 5 THREADS this property through
  │
  ▼
<DashboardGrid renderWidget={(id) => <Widget data={widgetData} .../>}>
  │
  ▼
<TileWrapper title="Bridge Outcomes">
  │
  └──▶ <OutcomesWidget data={widgetData} />  ←── Phase 5 NEW
           │
           ├──▶ computeOutcomeKPIs(data.outcomes)  [src/lib/outcomes-kpi.ts] ← NEW pure fn
           │      └──▶ <OutcomesKPIStrip kpis={...} />
           │
           ├──▶ data.outcomes.map(o => <OutcomesTimelineRow outcome={o} />)
           │      │
           │      └──▶ on caret click: setExpandedId(o.id)
           │             │
           │             ├──▶ cache.current.get(o.id) ?? fetch curves
           │             │         │
           │             │         ▼
           │             │    GET /api/bridge/outcome/[id]/curves  ← NEW dynamic route
           │             │         │
           │             │         ├──▶ withAuth + ctx.params (Next 16 async)
           │             │         ├──▶ user-scoped SELECT bridge_outcomes WHERE id=[id]
           │             │         │     AND allocator_id=auth.uid()  (RLS gate → 404 if not)
           │             │         ├──▶ admin SELECT strategy_analytics.returns_series
           │             │         │     FOR BOTH original_strategy_id + strategy_id
           │             │         ├──▶ rebase both to 100 at allocated_at
           │             │         └──▶ slice 180d window from allocated_at
           │             │
           │             └──▶ <OutcomesExpandedPanel curves={...}>
           │                      for win in [30,90,180]:
           │                        <delta number + <OutcomesSparkline points={...}>>
           │
           └──▶ (empty / loading / error / partial branches)
```

---

## Pattern Assignments

### 1. `supabase/migrations/061_bridge_outcomes_original_strategy.sql` (migration, DDL)

> **SUPERSEDED by revision 2026-04-19.** The authoritative migration file is `supabase/migrations/064_match_decisions_original_strategy.sql` (target table is `match_decisions`, not `bridge_outcomes`) + it additionally contains `CREATE OR REPLACE FUNCTION send_intro_with_decision` with a new `p_original_strategy_id UUID` parameter. See `05-01-TASKS.md` Task 5-01-W0-02 for the verbatim SQL. The analog + DO-block pattern notes below are still useful as STYLE reference (preamble, COMMENT convention, index creation pattern, self-verifying DO block), just applied against the new target table.

**Analog:** `supabase/migrations/059_bridge_outcomes.sql`

**Imports / preamble** (059 lines 1–37):
```sql
-- Migration 059: bridge_outcomes + bridge_outcome_dismissals tables
-- Sprint 8 Phase 1: Outcome Tracker — database foundation.
-- ...
BEGIN;
```

**FK + column-add pattern** (059 lines 45–53 — copy the `REFERENCES strategies(id) ON DELETE CASCADE` shape):
```sql
CREATE TABLE IF NOT EXISTS bridge_outcomes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  allocator_id          UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  strategy_id           UUID        NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  match_decision_id     UUID        REFERENCES match_decisions(id) ON DELETE SET NULL,
  kind                  TEXT        NOT NULL CHECK (kind IN ('allocated', 'rejected')),
  -- ...
);
```

**Comment convention** (059 lines 107–112):
```sql
COMMENT ON COLUMN bridge_outcomes.strategy_id IS
  'FK to strategies(id). Canonical single-column FK — never references portfolio_strategies(strategy_id) which has a composite PK.';
```

**Index creation pattern** (059 lines 156–172):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS bridge_outcomes_unique_per_strategy
  ON bridge_outcomes (allocator_id, strategy_id);

CREATE INDEX IF NOT EXISTS bridge_outcomes_allocator_recent
  ON bridge_outcomes (allocator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bridge_outcomes_strategy_id
  ON bridge_outcomes (strategy_id);
```

**Self-verifying DO block** (059 lines 308–461 — trimmed):
```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bridge_outcomes_unique_per_strategy') THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes_unique_per_strategy index missing';
  END IF;
  -- ... repeat for every artifact
  RAISE NOTICE 'Migration 059: bridge_outcomes + bridge_outcome_dismissals installed and verified.';
END
$$;

COMMIT;
```

**Delta from analog (SUPERSEDED — see revision notice above):**
- Migration 061 is **ALTER TABLE** (not CREATE TABLE). Use `ALTER TABLE bridge_outcomes ADD COLUMN original_strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE;` — `NOT NULL` is safe because CONTEXT.md D-20a confirms `bridge_outcomes` is empty (no historical backfill needed).
- Add a single new index `CREATE INDEX IF NOT EXISTS bridge_outcomes_allocator_original_strategy ON bridge_outcomes (allocator_id, original_strategy_id);` per D-20b (for feedback-engine future path).
- Add `COMMENT ON COLUMN bridge_outcomes.original_strategy_id IS 'FK to strategies(id) naming the underperformer that this outcome''s replacement was introduced for. NOT NULL per D-20a (invariant: every bridge outcome names its underperformer). Empty table at migration time, so NOT NULL is safe without backfill.';`
- Self-verifying DO block checks: column exists, FK exists, new index exists.

---

### 2. `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx` (widget container, request-response)

**Analog:** `src/app/(dashboard)/allocations/widgets/positions/PositionsTable.tsx`

**Imports pattern** (PositionsTable lines 1–20):
```tsx
"use client";

import { useMemo, useState, useRef, useEffect, useCallback, Fragment } from "react";
import type { WidgetProps } from "../../lib/types";
// ...
import { BridgeOutcomeBanner } from "../../components/BridgeOutcomeBanner";
// ...
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";
```

**Top-level widget shape** (PositionsTable lines 365–538 — the `export default function` with `data: WidgetProps.data` destructure, rows useMemo, empty-state early-return, table scaffold):
```tsx
export default function PositionsTable({ data, width }: WidgetProps) {
  "use no memo";
  const rows = useMemo<PositionRow[]>(() => {
    if (!data?.strategies?.length) return [];
    const strats = data.strategies as Array<{...}>;
    return strats.map((row) => ({...}));
  }, [data]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#718096]">
        No positions data available
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* ... table scaffold ... */}
    </div>
  );
}
```

**Row-body + hover + expand pattern** (PositionsTable lines 505–534):
```tsx
<tbody>
  {table.getRowModel().rows.map((row) => (
    <Fragment key={row.id}>
      <tr
        className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8F9FA] transition-colors"
        style={{ height: 44 }}
      >
        {row.getVisibleCells().map((cell) => (
          <td key={cell.id} className="px-3 py-2 whitespace-nowrap"
              style={{ width: cell.column.getSize() }}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>
      {(row.original.eligible_for_outcome || row.original.existing_outcome) && (
        <BannerSubRow key={`banner-${row.original.strategy_id}`} ... />
      )}
    </Fragment>
  ))}
</tbody>
```

**Lazy-fetch cache via useRef** (no pre-existing exact analog — pattern comes from general React + UI-SPEC §Interaction Contract):
```tsx
const cache = useRef<Map<string, CurveData>>(new Map());
const [expandedId, setExpandedId] = useState<string | null>(null);
// On expand: if (!cache.current.has(id)) fetch(`/api/bridge/outcome/${id}/curves`)...
```

**Delta from analog:**
- Drop TanStack Table (no sort / column visibility / resize — see `OutcomesTimeline` in UI-SPEC §3 → "plain HTML `<table>`"). Simpler than PositionsTable.
- Replace `BannerSubRow` with `<OutcomesExpandedPanel outcomeId={o.id}/>` rendered via `{expandedId === o.id && <tr>...</tr>}`.
- No column-visibility dropdown, no responsive width logic — 5 fixed columns always visible at desktop width.
- State owned at widget level: `useState<string|null>(expandedId)` + `useRef<Map<string, CurveData>>(new Map())` for lazy-curve cache.
- Include KPI strip above the table (not present in PositionsTable).

---

### 3. `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesKPIStrip.tsx` (presentational, pure-render)

**Analog:** `src/app/(dashboard)/allocations/widgets/meta/CustomKpiStrip.tsx`

**Full file** (CustomKpiStrip lines 1–61):
```tsx
"use client";

import type { WidgetProps } from "../../lib/types";
import { formatPercent, formatNumber } from "@/lib/utils";

interface KpiDef {
  label: string;
  key: string;
  format: (v: number | null | undefined) => string;
}

const KPI_DEFS: KpiDef[] = [
  { label: "TWR", key: "twr", format: formatPercent },
  { label: "Sharpe", key: "sharpe", format: (v) => formatNumber(v) },
  { label: "Max DD", key: "max_drawdown", format: formatPercent },
  { label: "CAGR", key: "cagr", format: formatPercent },
];

export function CustomKpiStrip({ data }: WidgetProps) {
  return (
    <div className="flex h-full items-center justify-around gap-2">
      {KPI_DEFS.map((kpi) => {
        const raw = resolve(data ?? {}, kpi.key);
        return (
          <div key={kpi.key} className="flex flex-col items-center px-3 py-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold"
                  style={{ color: "#718096" }}>
              {kpi.label}
            </span>
            <span className="font-mono text-sm tabular-nums font-medium"
                  style={{
                    color: raw == null ? "#718096"
                         : raw > 0 ? "#16A34A"
                         : raw < 0 ? "#DC2626"
                         : "#1A1A2E",
                  }}>
              {kpi.format(raw)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

**Delta from analog:**
- Switch label size from `text-[10px]` → `text-[11px]` per UI-SPEC Typography (11px all uppercase labels).
- Switch value size from `text-sm` → `text-[13px]` per UI-SPEC (DASHBOARD-02 locks 13px for Geist Mono numerics). UI-SPEC §Pre-Population Sources explicitly calls out this divergence.
- Add vertical hairline dividers `border-r border-[#E2E8F0]` on columns 1–2 (UI-SPEC §2).
- Receive computed KPIs as props (`{ total, winRate, avgDelta, pendingCount }`) rather than resolving from `WidgetProps.data` — keeps the strip pure and lets `computeOutcomeKPIs(outcomes)` from `src/lib/outcomes-kpi.ts` be tested in isolation.
- Add sub-label row under "AVG DELTA" per D-14: `"+2.3% · 3 pending"` in DM Sans 12px muted `#718096`, separator is Unicode middle-dot `·` (U+00B7).
- Win-rate color logic: `> 50% → #16A34A`, `< 50% → #DC2626`, else neutral (UI-SPEC §2 table).

---

### 4. `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesTimelineRow.tsx` (row + expand state, event-driven)

**Analogs:** `PositionsTable.tsx::BannerSubRow` (rows 280–353, expand-state-per-row pattern) + `src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx` (status-pill copy precedent)

**Per-row mode pattern** (BannerSubRow lines 280–353):
```tsx
type BannerMode = "banner" | "allocated" | "rejected" | "dismissed";

function BannerSubRow({ colSpan, strategyId, initialOutcome }: {...}) {
  const [mode, setMode] = useState<BannerMode>("banner");
  const [localOutcome, setLocalOutcome] = useState<BridgeOutcome | null>(initialOutcome);

  if (localOutcome) {
    return <tr><td colSpan={colSpan} className="p-0"><OutcomeRecordedRow outcome={localOutcome} /></td></tr>;
  }
  if (mode === "dismissed") return null;
  if (mode === "allocated") { return <tr><td colSpan={colSpan} className="p-0"><AllocatedForm ... /></td></tr>; }
  // ...
}
```

**Status-pill-copy reference** (OutcomeRecordedRow lines 13–69):
```tsx
export function OutcomeRecordedRow({ outcome }: OutcomeRecordedRowProps) {
  if (outcome.kind === "rejected") {
    const reasonLabel = outcome.rejection_reason
      ? REJECTION_REASON_LABELS[outcome.rejection_reason]
      : "Other";
    return (
      <div data-testid="outcome-recorded-row"
           className="flex items-center gap-2 border-t border-border bg-page px-4 py-3 text-sm font-sans text-text-primary">
        <span>{"Recorded: Rejected \u2014 "}{reasonLabel}</span>
      </div>
    );
  }

  const label = deriveOutcomeLabel({ kind: outcome.kind, allocated_at: outcome.allocated_at, ... });
  const toneClass = label.tone === "positive" ? "text-positive"
                  : label.tone === "negative" ? "text-negative"
                  : "text-text-primary";
  return (
    <div ...>
      <span>
        {"Recorded: Allocated "}
        <span className="font-metric tabular-nums">{outcome.percent_allocated}%</span>
        {" on "}
        <span className="font-metric tabular-nums">{outcome.allocated_at}</span>
        {" \u2022 "}
        <span className={`font-metric tabular-nums ${toneClass}`}>{label.value}</span>
      </span>
    </div>
  );
}
```

**Strategy-name-link reference** (PositionsTable lines 74–78 — strategy span, with UI-SPEC §3 upgrade to `<a>`):
```tsx
<span className="font-sans text-sm text-[#1A1A2E] truncate block max-w-[180px]">
  {info.getValue()}
</span>
```
Upgrade to anchor per UI-SPEC Interaction Contract:
```tsx
<a href={`/strategies/${strategyId}`}
   className="text-[#1A1A2E] hover:text-[#1B6B5A] transition-colors hover:underline truncate block">
  {name}
</a>
```

**Caret button pattern** (PositionsTable lines 237–248 — the gear-dropdown button shape; use as template for caret):
```tsx
<button type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center w-7 h-7 rounded border border-[#E2E8F0] bg-white text-[#718096] hover:text-[#1A1A2E] hover:bg-[#F8F9FA] transition-colors"
        aria-label="Toggle columns">
  {/* svg icon */}
</button>
```

**Delta from analog:**
- Mode state is only `"collapsed" | "expanded"` (vs BannerSubRow's 4 modes). A single expanded-id is tracked at the parent widget level (UI-SPEC Interaction §3: "one expanded row at a time").
- Status pill has 4 variants (UI-SPEC §4 table): Allocated-win / Allocated-loss / Allocated-pending / Rejected. Use `deriveOutcomeStatusPill()` helper (NEW in `src/lib/bridge-outcome-label.ts`) rather than replicating `OutcomeRecordedRow`'s branching inline.
- Caret uses Unicode `‹ / ›` glyph OR inline SVG chevron; 32px fixed column width; `aria-expanded` toggles.
- Full-row click does NOT navigate (D-04). Only `<a>` on strategy name triggers nav; only `<button>` caret triggers expand.
- Row emits `onToggle(id)` up to parent, which owns the `expandedId` state (matches React "lift state up" for mutually-exclusive expand).
- **Revision note:** consume the original-strategy name via `outcome.match_decision?.original_strategy.name` (nested embed from queries.ts) rather than a flat `outcome.original_strategy` field. When the nested embed is null, render em-dash per D-03 convention.

---

### 5. `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesExpandedPanel.tsx` (expanded detail, request-response lazy)

**Analog:** `PositionsTable.tsx::BannerSubRow` rows 280–353 (`<tr><td colSpan>` sub-row injection); no pre-existing 3-column delta panel in the codebase (this is genuinely new).

**Sub-row injection pattern** (PositionsTable lines 296–302):
```tsx
return (
  <tr>
    <td colSpan={colSpan} className="p-0">
      <OutcomeRecordedRow outcome={localOutcome} />
    </td>
  </tr>
);
```

**3-column grid pattern** (no exact analog — closest is the loading-skeleton grid in `ReplacementPanel.tsx:140–154` reused as the "3 cards side by side" layout template):
```tsx
<div className="space-y-3" aria-label="Loading candidates">
  {[1, 2, 3].map((i) => (
    <div key={i} className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="h-4 w-32 animate-pulse rounded bg-border" />
      </div>
    </div>
  ))}
</div>
```

**Lazy-fetch AbortController pattern** (ReplacementPanel lines 35–70):
```tsx
useEffect(() => {
  const controller = new AbortController();
  async function fetchCandidates() {
    try {
      const res = await fetch("/api/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId, underperformer_strategy_id: strategyId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Bridge request failed" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!controller.signal.aborted) setCandidates(data.candidates ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Failed to load candidates");
    }
  }
  fetchCandidates();
  return () => { controller.abort(); };
}, [portfolioId, strategyId]);
```

**Delta from analog:**
- Renders as `<tr><td colSpan={6}>` beneath parent row (colSpan=6 = caret + Original + Replacement + Date + Status + Best Delta columns).
- Inner layout is CSS grid `grid grid-cols-3 gap-4` with `bg-[#F8F9FA] px-3 py-4` wrapper per UI-SPEC §6.
- Per-column content (UI-SPEC §6): `"30d"|"90d"|"180d"` heading (DM Sans 11px semibold uppercase) + delta number (Geist Mono 13px tone-colored) + `<OutcomesSparkline>` (48px height) + 2-line legend.
- NULL-delta window (D-10): render `"Pending"` pill + `h-[48px] rounded bg-[#E2E8F0] animate-pulse` placeholder instead of sparkline.
- Lazy-fetch: receive `outcomeId` prop; AbortController + session-scoped `useRef<Map<string, CurveData>>` cache (owned by parent widget — passed in via props or context).
- On fetch error: sparkline cells show `"—"` muted + `"Retry"` microlink that refires the fetch (UI-SPEC Interaction Contract §5.8).

---

### 6. `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesSparkline.tsx` (Recharts wrapper, transform → render)

**Analogs:** `DrawdownChart.tsx` (hidden-axes + strokeWidth 1.5 precedent) + `CumulativeVsBenchmark.tsx` (two-series Line shape)

**Hidden-axes chart shape** (DrawdownChart lines 44–82 — adapt by removing axes/tooltip entirely):
```tsx
return (
  <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={drawdownData} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#718096" }} tickLine={false}
             axisLine={{ stroke: "#E2E8F0" }} tickFormatter={(d: string) => d.slice(5)}
             interval="preserveStartEnd" />
      <YAxis tick={{ fontSize: 11, fill: "#718096", fontFamily: "var(--font-geist-mono), monospace" }}
             tickLine={false} axisLine={false}
             tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
             domain={["dataMin", 0]} />
      <Tooltip formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Drawdown"]}
               contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }} />
      <Area type="monotone" dataKey="value" stroke="#DC2626" strokeWidth={1.5} fill="url(#dd-fill)" />
    </AreaChart>
  </ResponsiveContainer>
);
```

**Two-series LineChart shape** (CumulativeVsBenchmark lines 40–70):
```tsx
<ResponsiveContainer width="100%" height="100%">
  <LineChart data={cumulativeData} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#718096" }} tickLine={false}
           axisLine={{ stroke: "#E2E8F0" }} tickFormatter={(d: string) => d.slice(5)}
           interval="preserveStartEnd" />
    <YAxis tick={{ fontSize: 11, fill: "#718096", fontFamily: "var(--font-geist-mono), monospace" }}
           tickLine={false} axisLine={false}
           tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
    <Tooltip formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Portfolio"]}
             contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }} />
    <Line type="monotone" dataKey="portfolio" stroke="#1B6B5A" strokeWidth={2} dot={false} />
  </LineChart>
</ResponsiveContainer>
```

**Target pattern from UI-SPEC §7 (copy verbatim):**
```tsx
<ResponsiveContainer width="100%" height={48}>
  <LineChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
    <Line type="monotone" dataKey="original"    stroke="#94A3B8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
    <Line type="monotone" dataKey="replacement" stroke="#1B6B5A" strokeWidth={1.5} dot={false} isAnimationActive={false} />
    {/* NO XAxis, NO YAxis, NO Tooltip, NO Legend — sparkline style */}
  </LineChart>
</ResponsiveContainer>
```

**Delta from analog:**
- Drop all `<XAxis>`, `<YAxis>`, `<Tooltip>` (sparkline style; UI-SPEC §7).
- Height is hardcoded at `height={48}` (not `"100%"` — UI-SPEC §7 locks 48px).
- Margins tighten from `{ top: 8, right: 8, bottom: 20, left: 8 }` → `{ top: 2, right: 0, bottom: 2, left: 0 }` (UI-SPEC §7).
- `isAnimationActive={false}` required — data loaded lazily, animation would flash on expand.
- Two `<Line>` series: replacement = accent `#1B6B5A`, original = muted `#94A3B8` (D-08). Tone color NEVER applies to lines; tone only on the delta NUMBER above the sparkline.
- Prop shape: `points: Array<{ date: string; original: number; replacement: number }>` — rebased to 100 at `allocated_at` (D-09; assembled client-side from the `{ original, replacement }` response).

---

### 7. `src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx` (component test)

**Analogs:** `src/app/(dashboard)/allocations/widgets/positions/positions.test.tsx` + `src/app/(dashboard)/allocations/widgets/performance/performance.test.tsx`

**Mock-data factory pattern** (positions.test.tsx lines 13–52):
```tsx
function makeStrategy(overrides: { name: string; weight: number; allocated: number; cagr: number; sharpe: number }) {
  return {
    strategy_id: `strat-${overrides.name}`,
    current_weight: overrides.weight,
    allocated_amount: overrides.allocated,
    alias: null,
    strategy: {
      id: `strat-${overrides.name}`,
      name: overrides.name,
      codename: null,
      disclosure_tier: "institutional",
      strategy_types: [],
      markets: [],
      start_date: "2023-01-01",
      strategy_analytics: { daily_returns: [], cagr: overrides.cagr, sharpe: overrides.sharpe, ... },
    },
  };
}

const MOCK_DATA = {
  strategies: [
    makeStrategy({ name: "Alpha Momentum", weight: 0.4, allocated: 40000, cagr: 0.25, sharpe: 1.5 }),
    // ...
  ],
};
const WIDGET_PROPS = { data: MOCK_DATA, timeframe: "YTD", width: 800, height: 400 };
```

**Empty-state loop pattern** (performance.test.tsx lines 81–101):
```tsx
describe("Performance widgets — empty state", () => {
  const widgets = [
    { name: "EquityCurve", Component: EquityCurve, emptyText: /no equity curve/i },
    // ...
  ] as const;

  for (const { name, Component, emptyText } of widgets) {
    it(`${name} renders empty state without crashing`, () => {
      render(<Component {...baseProps} data={EMPTY_DATA} />);
      expect(screen.getByText(emptyText)).toBeInTheDocument();
    });
  }
});
```

**Barrel export assertion** (performance.test.tsx lines 192–208):
```tsx
describe("Barrel export", () => {
  it("re-exports all 10 widgets from index", async () => {
    const barrel = await import("./index");
    const exportedNames = Object.keys(barrel);
    expect(exportedNames).toContain("EquityCurve");
    // ...
    expect(exportedNames).toHaveLength(10);
  });
});
```

**Delta from analog:**
- Add a `fetch` mock (Recharts+lazy-fetch widget): `vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ original: [...], replacement: [...] }), { status: 200 }))`.
- Cases per RESEARCH.md §Acceptance table row matrix (DASHBOARD-01..06 — 12 cases, ~4 per component):
  - OutcomesWidget: renders 3 rows from 3 outcomes; empty state; loading state (5 skeleton rows); error state + retry button.
  - OutcomesKPIStrip: 3 values; win-rate color logic (>50% green, <50% red); sub-label `"+2.3% · 3 pending"` formatting.
  - OutcomesTimeline: 4 status-pill variants; strategy `<a>` anchors `/strategies/[id]`; em-dash "—" on rejected Best Delta column.
  - OutcomesExpandedPanel: clicking caret triggers exactly one fetch; second click of same row does not refetch (cache hit); pending-window shows pill + skeleton.

---

### 8. `src/lib/outcomes-kpi.ts` (pure math, transform)

**Analog:** `src/lib/bridge-outcome-label.ts` (pure-fn + co-located test, deterministic-override pattern)

**Shape** (bridge-outcome-label.ts lines 1–46):
```ts
// Translates a bridge_outcomes row into the D-12 label progression. Most-mature
// realized window wins. A needs_recompute=true row at day 30+ stays Pending
// (D-14) because the cron failed or the delta column is still null.

import { formatPercent } from "./utils";

export type OutcomeLabelInput = {
  kind: "allocated" | "rejected";
  allocated_at: string | null;
  delta_30d: number | null;
  delta_90d: number | null;
  delta_180d: number | null;
  estimated_delta_bps: number | null;
  estimated_days: number | null;
  needs_recompute: boolean;
  created_at: string;
  /** YYYY-MM-DD override for deterministic tests */
  today?: string;
};

export type OutcomeLabel = {
  label: "Pending" | "Estimated" | "30-day" | "90-day" | "180-day";
  value: string;
  tone: "neutral" | "positive" | "negative";
};
```

**Branch-based derivation pattern** (bridge-outcome-label.ts lines 46–88):
```ts
export function deriveOutcomeLabel(input: OutcomeLabelInput): OutcomeLabel {
  if (input.kind !== "allocated" || !input.allocated_at) return PENDING;

  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const days = diffInDays(today, input.allocated_at);

  if (days >= 180 && input.delta_180d !== null) {
    return { label: "180-day", value: `180-day: ${formatPercent(input.delta_180d, 1)}`, tone: toneOf(input.delta_180d) };
  }
  if (days >= 90 && input.delta_90d !== null) { /* ... */ }
  // ...
  return PENDING;
}
```

**Delta from analog:**
- Export a SINGLE pure function `computeOutcomeKPIs(outcomes: BridgeOutcome[]): { total, winRate, avgDelta, pendingCount }`.
- Implementation must mirror Phase 4 `feedback_engine.py` filter rules (D-11, D-21):
  1. `total = outcomes.length` (D-13 — all outcomes, regardless of kind/noise/pending).
  2. Win-rate denominator: `kind==="allocated" AND percent_allocated >= 1.0 AND at least one of (delta_30d, delta_90d, delta_180d) !== null`.
  3. Win-rate numerator: subset of denominator where most-mature non-NULL delta > 0 (reuse `deriveOutcomeLabel()` tone === "positive").
  4. `avgDelta = mean(most-mature non-NULL delta)` across the denominator set.
  5. `pendingCount = count(kind==="allocated" AND all three deltas null)`.
- Accept `today?: string` override for deterministic tests (mirror bridge-outcome-label convention).
- Co-located `outcomes-kpi.test.ts` with table-driven cases + one `"parity fixture"` case that reads `tests/fixtures/outcomes-kpi-parity.json` and asserts the full computed payload matches byte-for-byte.

---

### 9. `src/lib/outcomes-kpi.test.ts` (unit test)

**Analog:** `src/lib/bridge-outcome-label.test.ts` (15-case table-driven pure-fn test)

**Header + clock-override pattern** (bridge-outcome-label.test.ts lines 1–13):
```ts
import { describe, it, expect } from "vitest";
import { deriveOutcomeLabel } from "./bridge-outcome-label";

// Fixed clock override — all 15 cases use today: "2026-04-17" for determinism.
const TODAY = "2026-04-17";

function daysAgo(n: number): string {
  const d = new Date("2026-04-17T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
```

**Per-case pattern** (bridge-outcome-label.test.ts lines 14–30):
```ts
describe("deriveOutcomeLabel", () => {
  it("case 1 — day 0 Pending: allocated_at=today, no delta data", () => {
    const result = deriveOutcomeLabel({ kind: "allocated", allocated_at: TODAY, ... today: TODAY });
    expect(result).toEqual({ label: "Pending", value: "Pending", tone: "neutral" });
  });

  it("case 6 — 30-day: +4.3% — D-12 canonical realized (day 30 crosses)", () => {
    const result = deriveOutcomeLabel({ kind: "allocated", allocated_at: daysAgo(30), delta_30d: 0.043, ... });
    expect(result).toEqual({ label: "30-day", value: "30-day: +4.3%", tone: "positive" });
  });
});
```

**Delta from analog:**
- 8 cases minimum (per RESEARCH §Wave 0): empty outcomes → all-zeros; single allocated win; single allocated loss; mixed 3-win/1-loss = 75% winRate; allocated-pending-only excluded from denominator; <1% allocated excluded from denominator; rejected excluded; `"parity fixture"` case reading JSON fixture.
- Parity fixture case: `const fixture = await import("../../tests/fixtures/outcomes-kpi-parity.json"); expect(computeOutcomeKPIs(fixture.outcomes)).toEqual(fixture.expected);`

---

### 10. `src/app/api/bridge/outcome/[id]/curves/route.ts` (dynamic GET route)

**Analogs:** `src/app/api/strategies/draft/[id]/route.ts` (dynamic `[id]` + `ctx.params`) + `src/app/api/bridge/outcome/route.ts` (CSRF + withAuth + admin client + rate-limit pattern for bridge outcome writes)

**Dynamic-route auth + params pattern** (strategies/draft/[id] lines 22–68):
```ts
interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getAuthedUserIdOrError(
  req: NextRequest,
): Promise<{ userId: string } | NextResponse> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const csrfError = assertSameOrigin(req);
    if (csrfError) return csrfError;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return { userId: user.id };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const authResult = await getAuthedUserIdOrError(req);
  if (authResult instanceof NextResponse) return authResult;
  const userId = authResult.userId;

  const rl = await checkLimit(userActionLimiter, `strategies-draft-get:${userId}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("strategies")
    .select("id, user_id, source, status, ...")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  return NextResponse.json({ draft: data });
}
```

**Ownership-then-admin pattern** (bridge/outcome/route.ts lines 111–152):
```ts
// match_decisions has no allocator-self-SELECT RLS policy, so this check
// runs through the admin client. The .eq("allocator_id", user.id) is the
// ownership gate — it MUST stay inline with the query.
const admin = createAdminClient();
const { data: decision } = await admin
  .from("match_decisions")
  .select("id")
  .eq("allocator_id", user.id)
  .eq("strategy_id", parsed.data.strategy_id)
  .eq("decision", "sent_as_intro")
  .maybeSingle();
if (!decision) {
  return NextResponse.json({ error: "NOT_ELIGIBLE", reason: "..." }, { status: 403 });
}
```

**withAuth wrapper shape** (`src/lib/api/withAuth.ts` lines 8–24):
```ts
export function withAuth(handler: AuthenticatedHandler) {
  return async (req: NextRequest) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      const csrfError = assertSameOrigin(req);
      if (csrfError) return csrfError;
    }
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return handler(req, user);
  };
}
```

**Delta from analog:**
- `withAuth` signature takes `(req, user)` — no `ctx.params` forwarding (AuthenticatedHandler type in withAuth.ts line 6). Therefore this route **inlines auth** using the strategies/draft/[id] pattern (RESEARCH Pitfall 10 + `getAuthedUserIdOrError` helper shape). Do NOT use `withAuth` for dynamic-`[id]` routes.
- Rate-limit key: `bridge_outcome_curves:${userId}` via `userActionLimiter`.
- Step 1 (ownership): user-scoped `supabase.from("bridge_outcomes").select("id, strategy_id, match_decision_id, allocated_at").eq("id", id).maybeSingle()` — RLS enforces `allocator_id = auth.uid()`; 404 if null.
- Step 2 (original resolution — REVISED): admin client SELECT `match_decisions.original_strategy_id WHERE id = outcome.match_decision_id` if `match_decision_id` is non-null. If null (theoretical case per migration 059 ON DELETE SET NULL), skip — the original series is returned as `[]`.
- Step 3 (analytics): admin client SELECT `returns_series` for BOTH `outcome.strategy_id` AND `original_strategy_id` (when non-null) via `.in("strategy_id", [...])`. Up to two rows expected; if replacement missing, error → 500; if original missing, original=[] fallback.
- Step 4 (math): rebase both `returns_series` to 100 at `allocated_at`: `rebased[d] = 100 × equity_at(d) / equity_at(allocated_at)`. Slice to `allocated_at` .. `allocated_at + 180 days`.
- Response: `{ original: Array<{date, nav}>, replacement: Array<{date, nav}>, allocated_at: string }` (RESEARCH Q2).
- No audit event (read-only endpoint; no mutation). No `logAuditEvent` call.

---

### 11. `src/app/api/bridge/outcome/[id]/curves/route.test.ts` (route-handler test)

**Analog:** `src/app/api/bridge/outcome/route.test.ts`

**Test setup** (route.test.ts lines 17–130):
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb(); } };
});

const STATE = vi.hoisted(() => ({
  authUser: { id: "00000000-0000-0000-0000-000000000001", email: "alloc@test.sec" } as { id: string; email: string } | null,
  // ... outcome row + returns_series
  checkLimitResult: { success: true, retryAfter: 0 } as { success: boolean; retryAfter: number },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: STATE.authUser }, error: null }) },
    from: (table: string) => { /* ... */ },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => { /* ... */ } }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => STATE.checkLimitResult,
}));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/bridge/outcome", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

**Test-case pattern** (route.test.ts lines 163–197):
```ts
describe("POST /api/bridge/outcome", () => {
  it("TC1 — happy allocated: 200 + correct shape + bridge_outcome.record audit", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ strategy_id: STRAT_ID, kind: "allocated", percent_allocated: 12, allocated_at: ALLOCATED_AT, note: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.outcome).toMatchObject({ id: OUTCOME_ID, kind: "allocated" });
  });
});
```

**Delta from analog:**
- Method is GET (not POST); build request via `new NextRequest("http://localhost:3000/api/bridge/outcome/<id>/curves", { method: "GET" })`.
- Handler receives `ctx: { params: Promise<{ id: string }> }` — emulate by calling `await GET(req, { params: Promise.resolve({ id: OUTCOME_ID }) })`.
- Mock `bridge_outcomes` SELECT returning the outcome row for owner case; returning `null` for foreign-allocator-404 case.
- Mock admin SELECT on `match_decisions` returning `{ original_strategy_id }` (REVISED — adds this mock step between ownership check and returns_series fetch).
- Mock admin SELECT on `strategy_analytics` returning two returns_series rows (one for original, one for replacement).
- 7 cases (REVISED from 6): 401 unauth; 404 foreign allocator; 400 missing id; 200 happy-path shape; 200 rebase math (first point = 100); 429 rate-limit; 200 with match_decision_id=null returns original=[].

---

### 12. `tests/fixtures/outcomes-kpi-parity.json` (test fixture)

**Analog:** `analytics-service/tests/fixtures/feedback_engine_v1_cold_golden.json` (and the 2 siblings `ceiling` + `floor`). Note: these fixtures are currently empty placeholders (`{}`), so the structural analog is the *convention* (one folder per runtime, versioned filename), not the content.

**Directory decision:** `tests/fixtures/outcomes-kpi-parity.json` (repo-root `tests/fixtures/` directory — confirmed to NOT exist yet; planner creates it). Rationale: the fixture is shared between TypeScript (`src/lib/outcomes-kpi.test.ts`) and — per D-21 — a future Python parity assertion. Keeping it at repo root makes the Python import path trivial (`../tests/fixtures/outcomes-kpi-parity.json` from `analytics-service/tests/`).

**Alternative:** if the planner prefers per-runtime fixtures, mirror the Python convention at `src/lib/__fixtures__/outcomes-kpi-parity.json`. RESEARCH §Wave 0 calls the path `tests/fixtures/outcomes-kpi-parity.json` so that's the canonical name.

**Shape (genuinely new):**
```json
{
  "description": "Phase 5 D-21 cross-runtime parity fixture. Matches Phase 4 feedback_engine.py::_fetch_eligible_outcomes + _success_value filter rules. Mirrors from Python when Phase 4 D-08 filters change.",
  "outcomes": [
    {
      "id": "...", "kind": "allocated", "percent_allocated": 12.0, "allocated_at": "2026-01-01",
      "delta_30d": 0.043, "delta_90d": 0.081, "delta_180d": null,
      "estimated_delta_bps": null, "estimated_days": null,
      "needs_recompute": false, "created_at": "2026-01-01T00:00:00Z",
      "rejection_reason": null, "note": null
    }
    // ...
  ],
  "today": "2026-04-19",
  "expected": {
    "total": 5,
    "winRate": 0.6666666666666666,
    "avgDelta": 0.025,
    "pendingCount": 1
  }
}
```

**Delta from analog:**
- Different runtime — this is a JSON fixture consumed by TypeScript, not pytest. Keep shape minimal (array of outcomes + `today` override + `expected` KPI payload).
- Include a `description` top-level key quoting the D-21 parity contract so future editors understand the invariant ("if Phase 4 D-08 filters change, update this fixture in the same PR").

---

### 13. `src/__tests__/bridge-outcomes-schema.test.ts` (live-DB schema smoke)

> **SUPERSEDED by revision.** Authoritative file is `src/__tests__/match-decisions-schema.test.ts` (different target table). The HAS_LIVE_DB gate + `advertiseLiveDbSkipReason` scaffolding carries over verbatim from the analog below; only the assertions target `match_decisions.original_strategy_id` instead of `bridge_outcomes.original_strategy_id`.

**Analog:** `src/__tests__/bridge-outcomes-rls.test.ts` (Phase 1 precedent for HAS_LIVE_DB-gated + `advertiseLiveDbSkipReason` tests)

**Header + import pattern** (bridge-outcomes-rls.test.ts lines 1–38):
```ts
/**
 * Live-DB integration test — Migration 059 RLS policies on
 * bridge_outcomes + bridge_outcome_dismissals.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with `advertiseLiveDbSkipReason`) when those are absent
 * (standard CI without live DB).
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
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

**Gated-test + skip-advert pattern** (bridge-outcomes-rls.test.ts lines 151–227 + 505–508):
```ts
describe("Migration 059 — bridge_outcomes + bridge_outcome_dismissals RLS", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes: owner reads own row; foreign allocator reads 0 rows",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = { userIds: [], strategyIds: [] };
      try {
        // ... seed + assert
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // This test always runs (no skipIf) and advertises the skip reason when
  // HAS_LIVE_DB is false, so the test suite doesn't fail silently.
  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("bridge-outcomes-rls");
    expect(true).toBe(true);
  });
});
```

**Delta from analog (REVISED):**
- Topic is **schema** on `match_decisions`, not RLS. Assert: (a) `match_decisions.original_strategy_id` column exists; (b) it has `NOT NULL` constraint; (c) FK to `strategies(id)`; (d) `match_decisions_allocator_original_strategy` index exists on `(allocator_id, original_strategy_id)`; (e) the NEW 6-arg `send_intro_with_decision` RPC exists and the OLD 5-arg is dropped.
- Probe via `admin.from('information_schema.columns').select().eq('table_name', 'match_decisions').eq('column_name', 'original_strategy_id').single()` and `pg_class`/`pg_indexes`/`pg_proc` lookups (same pg_catalog introspection style as migration 059's DO block).
- Close with `advertiseLiveDbSkipReason("match-decisions-schema")` sentinel.

---

### 14. `src/lib/bridge-outcome-schema.ts` (MOD — extend type)

> **SUPERSEDED by revision.** The `BridgeOutcome` type is UNCHANGED by Phase 5 in the revised architecture — the underperformer field lives on `match_decisions`, not `bridge_outcomes`, and the dashboard payload carries the nested join result in the `OutcomeRow` type (defined in `src/lib/queries.ts`). Skip this section's "Delta" — it was the prior pass's incorrect plan.

**Analog (self):** existing file (lines 25–39 define `BridgeOutcome`)

**Existing type** (bridge-outcome-schema.ts lines 25–39):
```ts
export type BridgeOutcome = {
  id: string;
  kind: "allocated" | "rejected";
  percent_allocated: number | null;
  allocated_at: string | null;
  rejection_reason: RejectionReason | null;
  note: string | null;
  delta_30d: number | null;
  delta_90d: number | null;
  delta_180d: number | null;
  estimated_delta_bps: number | null;
  estimated_days: number | null;
  needs_recompute: boolean;
  created_at: string;
};
```

**Delta (insertion point — between line 38 `created_at: string;` and line 39 `};`) — SUPERSEDED:**
- Add required field `original_strategy_id: string;` on `BridgeOutcome` (reflects DB's `NOT NULL` constraint).
- No Zod schema change needed for `ALLOCATED_FIELDS` / `REJECTED_FIELDS` because `original_strategy_id` is passed at the top-level of the POST body (alongside `strategy_id`), not inside the kind-specific discriminant. The POST route's `BODY_SCHEMA` (in `src/app/api/bridge/outcome/route.ts:19`) is where it goes.

---

### 15. `src/lib/bridge-outcome-label.ts` (MOD — add `deriveOutcomeStatusPill`)

**Analog (self):** existing `deriveOutcomeLabel` function (lines 46–88)

**Existing function signature** (bridge-outcome-label.ts lines 22–46):
```ts
export type OutcomeLabel = {
  label: "Pending" | "Estimated" | "30-day" | "90-day" | "180-day";
  value: string;
  tone: "neutral" | "positive" | "negative";
};

// ...

export function deriveOutcomeLabel(input: OutcomeLabelInput): OutcomeLabel { /* ... */ }
```

**Delta (append new export at bottom of file):**
- Add export `deriveOutcomeStatusPill(outcome, today?)` returning `{ variant: "allocated-win" | "allocated-loss" | "allocated-pending" | "rejected", text: string, toneColor: string, bgColor: string }` per UI-SPEC §4 status-pill table.
- Reuse `deriveOutcomeLabel` internally for the win/loss/pending tier detection on `kind === "allocated"` rows.
- For `kind === "rejected"`: `text = \`Rejected — ${REJECTION_REASON_LABELS[outcome.rejection_reason ?? "other"]}\`` and tone = neutral.
- For `kind === "allocated"`: `text = \`Allocated ${outcome.percent_allocated}% — ${win|loss|pending}\``.
- Color tokens from UI-SPEC §4:
  - win: `text-#16A34A` bg-`rgba(22,163,74,0.10)`
  - loss: `text-#DC2626` bg-`rgba(220,38,38,0.08)`
  - pending: `text-#718096` bg-`rgba(148,163,184,0.10)`
  - rejected: same as pending.
- Co-located test: add ~8 cases to `src/lib/bridge-outcome-label.test.ts` asserting the 4 variants + percent rendering + reason-label passthrough.

---

### 16. `src/lib/queries.ts` (MOD — extend `getMyAllocationDashboard` fan-out @ L599+)

> **SUPERSEDED by revision.** The revised fan-out uses the **admin client** (match_decisions has no allocator-self-SELECT RLS) with a **nested embed** `match_decision:match_decisions!bridge_outcomes_match_decision_id_fkey(original_strategy:strategies!match_decisions_original_strategy_id_fkey(id, name))`, NOT the flat `strategies!bridge_outcomes_original_strategy_id_fkey(...)` embed shown in the delta below (that FK does not exist in the revised architecture — there is no `bridge_outcomes.original_strategy_id` column). See `05-01-TASKS.md` Task 5-01-W1-07 for the verbatim SELECT string + marshal code. The existing `Promise.all` shape and `existingOutcomesRes` preservation rule still apply — only the 8th fan-out entry and the marshal step change.

**Analog (self):** existing `Promise.all` fan-out (lines 628–703)

**Existing fan-out** (queries.ts lines 627–703):
```ts
const nowIso = new Date().toISOString();
const [
  analyticsRes,
  strategiesRes,
  apiKeys,
  alertsRes,
  sentAsIntroRes,
  existingOutcomesRes,
  activeDismissalsRes,
] = await Promise.all([
  admin.from("portfolio_analytics").select("*").eq("portfolio_id", portfolio.id)
       .order("computed_at", { ascending: false }).limit(1).maybeSingle(),
  admin.from("portfolio_strategies").select(`strategy_id, current_weight, allocated_amount, alias, strategy:strategies!inner (...)`)
       .eq("portfolio_id", portfolio.id).order("current_weight", { ascending: false }),
  getUserApiKeys(userId),
  supabase.from("portfolio_alerts").select("id, severity").eq("portfolio_id", portfolio.id).is("acknowledged_at", null),
  admin.from("match_decisions").select("strategy_id").eq("allocator_id", userId).eq("decision", "sent_as_intro"),
  supabase.from("bridge_outcomes")
    .select("id, strategy_id, kind, percent_allocated, allocated_at, rejection_reason, note, delta_30d, delta_90d, delta_180d, estimated_delta_bps, estimated_days, needs_recompute, created_at")
    .eq("allocator_id", userId),
  supabase.from("bridge_outcome_dismissals").select("strategy_id, expires_at")
    .eq("allocator_id", userId).gt("expires_at", nowIso),
]);
```

**Existing type** (queries.ts lines 514–566 — `MyAllocationDashboardPayload`)

**Delta (SUPERSEDED):**
- Add a NEW 8th fan-out entry `outcomesFullRes` that reads all outcomes for the allocator with BOTH strategy names embedded via FK disambiguation — RESEARCH §Domain Model "Option A' exact SQL" adapted for Option C resolution (D-20):
  ```ts
  supabase.from("bridge_outcomes")
    .select(`
      id, strategy_id, original_strategy_id, match_decision_id, kind, percent_allocated,
      allocated_at, rejection_reason, note, delta_30d, delta_90d, delta_180d,
      estimated_delta_bps, estimated_days, needs_recompute, created_at,
      original_strategy:strategies!bridge_outcomes_original_strategy_id_fkey(id, name),
      replacement_strategy:strategies!bridge_outcomes_strategy_id_fkey(id, name)
    `)
    .eq("allocator_id", userId)
    .order("created_at", { ascending: false })
  ```
- Add a new top-level field on `MyAllocationDashboardPayload`: `outcomes: Array<OutcomeRow>` (see UI-SPEC §Data Contract for shape).
- Return the outcomes list in the payload: `return { portfolio, analytics, strategies, apiKeys, alertCount, outcomes }`.
- **Do NOT remove** the existing `existingOutcomesRes` fan-out entry — that still populates `strategies[i].existing_outcome` for the PositionsTable banner gate. `outcomes` is an ADDITIVE field.
- Note: `existingOutcomesRes` currently selects WITHOUT `original_strategy_id` — extend that SELECT list to include it so the BannerSubRow flow also has the new column available if needed.

---

### 17. `src/lib/queries.my-allocation.test.ts` (MOD — extend test file)

**Analog (self):** existing TC1–TC5 outcome-eligibility cases (lines 464–562)

**Existing case pattern** (queries.my-allocation.test.ts lines 471–484):
```ts
it("TC1 — eligible row: sent_as_intro, no outcome, no active dismissal → eligible_for_outcome=true, existing_outcome=null", async () => {
  state.portfolioStrategies = [PS_S1 as unknown as typeof state.portfolioStrategies[number]];
  state.sentAsIntroDecisions = [{ strategy_id: "s1", allocator_id: "user-1", decision: "sent_as_intro" }];
  state.bridgeOutcomes = [];
  state.bridgeDismissals = [];

  const { getMyAllocationDashboard } = await import("./queries");
  const result = await getMyAllocationDashboard("user-1");

  const row = result.strategies.find((s) => s.strategy_id === "s1");
  expect(row).toBeDefined();
  expect(row!.eligible_for_outcome).toBe(true);
  expect(row!.existing_outcome).toBeNull();
});
```

**Delta:**
- Add ~3 new cases under a new `describe("getMyAllocationDashboard — outcomes top-level fan-out", ...)` block:
  - `TC6` — outcomes array contains all allocator outcomes sorted created_at DESC.
  - `TC7` — each outcome carries `match_decision.original_strategy: { id, name }` and `replacement_strategy: { id, name }` (asserts the nested embed — REVISED).
  - `TC8` — empty outcomes → empty array (not null).
  - `TC9` (REVISED) — outcome with `match_decision_id: null` has `match_decision === null` (em-dash case for UI D-03).
- Extend the mock `buildChain` to support the nested FK-disambiguated embed syntax (current mock only supports simple `.select()` with no embed parsing — update `rowsFor()` to merge a `strategies` lookup map into both the flat `replacement_strategy` field and the nested `match_decision.original_strategy` field).

---

### 18. `src/app/api/bridge/outcome/route.ts` (MOD — accept `original_strategy_id`)

> **SUPERSEDED by revision.** The `POST /api/bridge/outcome` route is UNCHANGED by Phase 5. The `original_strategy_id` is NOT accepted on this allocator-side route — it lives on `match_decisions` and is captured at admin-side intro-send time via `/api/admin/match/send-intro`. See §20 below for the corrected admin-side flow.

**Analog (self):** existing POST handler (lines 1–186)

**Existing Zod schema** (route.ts lines 19–90):
```ts
const BODY_SCHEMA = z
  .object({
    strategy_id: z.string().uuid(),
    kind: z.enum(["allocated", "rejected"]),
    percent_allocated: z.number().min(0.1).max(50).optional(),
    allocated_at: z.string().date().optional(),
    rejection_reason: z.enum(REJECTION_REASONS).optional(),
    note: z.string().max(2000).nullish(),
  })
  .superRefine((val, ctx) => { /* ... */ });
```

**Existing upsert** (route.ts lines 132–151):
```ts
const { data: inserted, error } = await supabase
  .from("bridge_outcomes")
  .upsert(
    {
      allocator_id: user.id,
      strategy_id: parsed.data.strategy_id,
      match_decision_id: decision.id,
      kind: parsed.data.kind,
      percent_allocated: parsed.data.percent_allocated ?? null,
      allocated_at: parsed.data.allocated_at ?? null,
      rejection_reason: parsed.data.rejection_reason ?? null,
      note: parsed.data.note ?? null,
      needs_recompute: true,
    },
    { onConflict: "allocator_id,strategy_id" },
  )
  .select("id, kind, percent_allocated, allocated_at, rejection_reason, note, delta_30d, delta_90d, delta_180d, estimated_delta_bps, estimated_days, needs_recompute, created_at, updated_at")
  .single();
```

**Delta (SUPERSEDED):**
- Add field `original_strategy_id: z.string().uuid(),` as a **required** top-level field on `BODY_SCHEMA` (mirrors DB NOT NULL constraint from migration 061).
- Insert payload: add `original_strategy_id: parsed.data.original_strategy_id,` to the upsert object.
- `.select(...)` projection: add `original_strategy_id` to the return-column list.
- Audit metadata: add `original_strategy_id: parsed.data.original_strategy_id,` to `logAuditEvent(...).metadata` — per audit-coverage test, every mutation's metadata object should carry the relevant identity.
- No new helper function needed — the brief's reference to an `insertBridgeOutcome` helper in `src/lib/queries.ts` is a misnomer; the upsert is inline here. Extend the inline upsert.

---

### 19. `src/app/api/bridge/outcome/route.test.ts` (MOD — original_strategy_id assertions)

> **SUPERSEDED by revision.** The allocator-side POST route is UNCHANGED by Phase 5; no new assertions go here. Wave 0 instead writes new tests on `src/app/api/bridge/outcome/[id]/curves/route.test.ts` (curves endpoint). The D-20b assertions (body validation + audit metadata) now belong on the admin send-intro route (§20 below).

**Analog (self):** existing TC1–TC7 cases (lines 163–370)

**Existing TC1 shape** (route.test.ts lines 164–197 — already shown above under file 11)

**Delta (SUPERSEDED):**
- Extend the `body` object passed to `makeRequest({...})` in TC1, TC2, TC3 with `original_strategy_id: "33333333-3333-4333-8333-333333333333"`.
- Extend `STATE.insertedRow` in `beforeEach` to include `original_strategy_id`.
- Add TC6c: `original_strategy_id` missing → 400 Zod error with `issues[0].path === ["original_strategy_id"]`.
- Extend audit assertions in TC1/TC2/TC3 to include `original_strategy_id` in `auditCall!.args.p_metadata.toMatchObject({...})`.

---

### 20. Admin send-intro threading (REVISED 2026-04-19 — `original_strategy_id` captured admin-side)

**Analogs:**
- `src/app/api/admin/match/send-intro/route.ts` (admin POST route — adds `original_strategy_id` body field + forwards as RPC parameter)
- `src/components/admin/SendIntroPanel.tsx` (admin slide-out — adds underperformer-source field per W1-02 decision)
- `supabase/migrations/011_perfect_match.sql` (existing `send_intro_with_decision` RPC — replaced in migration 064 with new 6-arg signature)

**Existing admin route body validation** (`src/app/api/admin/match/send-intro/route.ts` lines 32–51):
```typescript
let body: {
  allocator_id?: string;
  strategy_id?: string;
  candidate_id?: string | null;
  admin_note?: string;
};
try {
  body = await req.json();
} catch {
  return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
}

if (!body.allocator_id || typeof body.allocator_id !== "string") {
  return NextResponse.json({ error: "allocator_id is required" }, { status: 400 });
}
if (!body.strategy_id || typeof body.strategy_id !== "string") {
  return NextResponse.json({ error: "strategy_id is required" }, { status: 400 });
}
if (!body.admin_note || typeof body.admin_note !== "string") {
  return NextResponse.json({ error: "admin_note is required" }, { status: 400 });
}
```

**Existing RPC call** (route.ts lines 55–61):
```typescript
const { data, error } = await admin.rpc("send_intro_with_decision", {
  p_allocator_id: body.allocator_id,
  p_strategy_id: body.strategy_id,
  p_candidate_id: body.candidate_id ?? null,
  p_admin_note: body.admin_note,
  p_decided_by: user!.id,
});
```

**Existing admin UI submit handler** (`src/components/admin/SendIntroPanel.tsx` lines 28–61):
```tsx
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  if (!note.trim()) {
    setError("Note cannot be empty");
    return;
  }
  setSubmitting(true);
  setError(null);
  try {
    const res = await fetch("/api/admin/match/send-intro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allocator_id: allocatorId,
        strategy_id: candidate.strategy_id,
        candidate_id: candidate.id,
        admin_note: note.trim(),
      }),
    });
    // ...
  } catch (err) { /* ... */ }
}
```

**Gap finding (verified 2026-04-19):** `SendIntroPanel.tsx` does NOT currently carry an underperformer id in state. `CandidateRow` type has no such field. `grep -rn "underperformer" src/components/admin/` returns zero matches. The admin match queue flow (`AllocatorMatchQueue` → `SendIntroPanel`) is portfolio-unaware — admin recommends a strategy without naming what it replaces.

**Delta across 3 files (all admin-side):**

1. **Migration 064** (`supabase/migrations/064_match_decisions_original_strategy.sql` — Task W0-02):
   - `ALTER TABLE match_decisions ADD COLUMN original_strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE`
   - `CREATE INDEX match_decisions_allocator_original_strategy ON match_decisions (allocator_id, original_strategy_id)`
   - `CREATE OR REPLACE FUNCTION send_intro_with_decision` with new 6-arg signature: `(p_allocator_id, p_strategy_id, p_original_strategy_id, p_candidate_id, p_admin_note, p_decided_by)` — `p_original_strategy_id` positioned 3rd for call-site clarity.
   - `DROP FUNCTION IF EXISTS send_intro_with_decision(UUID, UUID, UUID, TEXT, UUID)` — old 5-arg overload deleted atomically so stale callers fail loud.
   - All in one transaction.

2. **`src/app/api/admin/match/send-intro/route.ts`** (Task W1-03):
   - Extend body type: add `original_strategy_id?: string`.
   - Add validation block after `strategy_id` check: `if (!body.original_strategy_id || typeof body.original_strategy_id !== "string") { return NextResponse.json({ error: "original_strategy_id is required" }, { status: 400 }); }` — matches existing validation style (not Zod).
   - Extend RPC call: `p_original_strategy_id: body.original_strategy_id` (position 3 to match the new RPC signature).

3. **`src/components/admin/SendIntroPanel.tsx`** (Task W1-04 — depends on W1-02 decision):
   - W1-02 is a BLOCKING `checkpoint:decision` task: user picks one of:
     - **Option A:** Add holdings dropdown — fetch allocator's `portfolio_strategies`, render select, require pick before submit.
     - **Option B:** Add strategies autocomplete — admin picks any strategy id.
     - **Option C:** Defer Phase 5 + rollback migration 064.
   - SendIntroPanel state adds `const [originalStrategyId, setOriginalStrategyId] = useState<string | null>(null);` plus the UI per chosen option.
   - Disable Send button until `originalStrategyId` is non-null.
   - POST body gains `original_strategy_id: originalStrategyId` alongside the existing fields.

**Phase 5 read-side (Task W1-07):** `getMyAllocationDashboard` fan-out uses admin client with nested embed `match_decision:match_decisions!bridge_outcomes_match_decision_id_fkey(original_strategy:strategies!match_decisions_original_strategy_id_fkey(id, name))` — the underperformer name flows to the UI via a 1-FK hop on every outcome row.

**Phase 5 curves endpoint (Task W1-08):** `GET /api/bridge/outcome/[id]/curves` fetches `outcome.match_decision_id` from the user-scoped ownership gate, then admin-SELECTs `match_decisions.original_strategy_id`, then admin-SELECTs `strategy_analytics.returns_series` for both strategies. Graceful degradation: if `match_decision_id` is null, original series returns `[]`.

**STRICTLY FORBIDDEN (regression guard):**
- No `originalStrategyId = strategyId` tautology.
- No threading through `BridgeOutcomeBanner` / `AllocatedForm` / `RejectedForm` / `PositionsTable::BannerSubRow`.
- No new body field on `POST /api/bridge/outcome`.
- No change to `BridgeOutcome` type in `src/lib/bridge-outcome-schema.ts`.
- No column on `bridge_outcomes`.

**Note (audit trail):** the admin send-intro route already emits audit events via its existing code path. The new `original_strategy_id` naturally becomes part of the persisted `match_decisions` row (and thus queryable forensically). No additional audit-metadata changes are needed in `/api/bridge/outcome` (that route is unchanged).

---

### 21. `src/app/(dashboard)/allocations/lib/widget-registry.ts` (MOD — add `outcomes` category)

**Analog (self):** existing registry entries (lines 7–416) + `WIDGET_CATEGORIES` array (lines 422–431)

**Existing pattern** (widget-registry.ts lines 256–269):
```ts
"positions-table": {
  id: "positions-table",
  name: "Positions Table",
  category: "positions",
  icon: "▦",
  // Full-width default: the Positions Table is a wide data table and
  // looks broken when it sits alone in a half-width row with empty
  // whitespace to its right. Design review FINDING-009.
  defaultW: 12,
  defaultH: 4,
  description: "Live positions with entry price, PnL, and weight.",
  status: "ready",
},
```

**Existing categories array** (widget-registry.ts lines 422–431):
```ts
export const WIDGET_CATEGORIES = [
  { id: "performance" as const, name: "Performance", icon: "▲" },
  { id: "risk" as const, name: "Risk", icon: "◆" },
  { id: "allocation" as const, name: "Allocation", icon: "◉" },
  { id: "attribution" as const, name: "Attribution", icon: "▸" },
  { id: "positions" as const, name: "Positions", icon: "▦" },
  { id: "monitoring" as const, name: "Monitoring", icon: "●" },
  { id: "intelligence" as const, name: "Intelligence", icon: "◈" },
  { id: "meta" as const, name: "Meta", icon: "≡" },
];
```

**Delta (insert AFTER line 415 closing brace of `"quick-actions"` entry, BEFORE the closing `};` of WIDGET_REGISTRY at line 416):**
```ts
  // ── Outcomes (1) ─────────────────────────────────────────────────
  "outcomes-timeline": {
    id: "outcomes-timeline",
    name: "Bridge Outcomes",
    category: "outcomes",  // NEW 8th category
    icon: "◈",             // UI-SPEC §Widget Registration Contract
    defaultW: 12,          // D-18: full-width row
    defaultH: 5,           // D-18: KPI strip + ~8 rows
    description: "Timeline of recorded Bridge outcomes with win-rate KPIs and delta sparklines.",
    status: "ready",
  },
```

**Also extend** `WIDGET_CATEGORIES` array (insert after `meta` entry, line 430):
```ts
{ id: "outcomes" as const, name: "Outcomes", icon: "◈" },
```

**Also extend** `src/app/(dashboard)/allocations/lib/types.ts` line 21 — add `"outcomes"` to the `WidgetMeta.category` union:
```ts
category: "performance" | "risk" | "allocation" | "attribution" | "positions" | "monitoring" | "intelligence" | "meta" | "outcomes";
```

---

### 22. `src/app/(dashboard)/allocations/widgets/index.ts` (MOD — lazy barrel)

**Analog (self):** existing lazy imports grouped by category (lines 14–100)

**Existing pattern — default export** (widgets/index.ts lines 16–25):
```ts
export const WIDGET_COMPONENTS: Record<string, LazyWidget> = {
  // ── Performance (10) ────────────────────────────────────────────────
  "equity-curve": lazy(() => import("./performance/EquityCurve")),
  "drawdown-chart": lazy(() => import("./performance/DrawdownChart")),
  // ...
```

**Existing pattern — named export** (widgets/index.ts lines 67–69):
```ts
"portfolio-alerts": lazy(() =>
  import("./monitoring/PortfolioAlerts").then((m) => ({ default: m.PortfolioAlerts })),
),
```

**Delta (insert after the last `// ── Meta (3) ──...` block at line 100, BEFORE the closing `};`):**
```ts
  // ── Outcomes (1) ───────────────────────────────────────────────────
  "outcomes-timeline": lazy(() => import("./outcomes/OutcomesWidget")),
```

Pick **default export** path for `OutcomesWidget` (matches PositionsTable + all performance widgets) — `export default function OutcomesWidget({ data }: WidgetProps)`.

---

### 23. `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts` (MOD — DEFAULT_LAYOUT + LAYOUT_VERSION bump)

**Analog (self):** full file (lines 1–27)

**Existing constants:**
```ts
/**
 * Bump this version whenever the default GRID layout changes materially.
 * The useDashboardConfig hook compares this against the persisted version
 * and resets to defaults when it differs.
 */
export const LAYOUT_VERSION = 1;

export const DEFAULT_LAYOUT: TileConfig[] = [
  { i: "equity-curve-1",       widgetId: "equity-curve",       x: 0, y: 0,  w: 12, h: 4 },
  { i: "drawdown-chart-1",     widgetId: "drawdown-chart",     x: 0, y: 4,  w: 12, h: 4 },
  { i: "allocation-donut-1",   widgetId: "allocation-donut",   x: 0, y: 8,  w: 4,  h: 3 },
  { i: "correlation-matrix-1", widgetId: "correlation-matrix", x: 4, y: 8,  w: 4,  h: 3 },
  { i: "monthly-returns-1",    widgetId: "monthly-returns",    x: 8, y: 8,  w: 4,  h: 3 },
  { i: "positions-table-1",    widgetId: "positions-table",    x: 0, y: 11, w: 12, h: 4 },
  { i: "net-exposure-1",       widgetId: "net-exposure",       x: 0, y: 15, w: 12, h: 4 },
  { i: "trade-volume-1",       widgetId: "trade-volume",       x: 0, y: 19, w: 6,  h: 3 },
  { i: "exposure-by-asset-1",  widgetId: "exposure-by-asset",  x: 6, y: 19, w: 6,  h: 3 },
];
```

**Version-bump guard pattern** (`useDashboardConfig.ts` lines 18–21):
```ts
const parsed = JSON.parse(raw) as DashboardConfig;
// Reset to defaults when layout version changes (new widgets added)
if (parsed.layoutVersion !== LAYOUT_VERSION) {
  return { tiles: DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION };
}
```

**Delta:**
- Update `LAYOUT_VERSION = 1` → `LAYOUT_VERSION = 2` — triggers `useDashboardConfig.loadConfig()` to throw out persisted layouts and serve the fresh DEFAULT_LAYOUT on next page load (D-18: "existing allocators see the widget on their next page visit without manual setup").
- Update the top-of-file comment to note the Phase 5 reason: `"Sprint 8 Phase 5: bumped 1→2 to force Outcomes widget into existing layouts (D-18)."`
- Insert new tile entry at the END of `DEFAULT_LAYOUT` (after `exposure-by-asset-1` at y=19+3=22):
  ```ts
  { i: "outcomes-timeline-1", widgetId: "outcomes-timeline", x: 0, y: 22, w: 12, h: 5 },
  ```
- Use the kebab-case instance id `outcomes-timeline-1` matching the widgetId slug + `-1` suffix (mirrors `positions-table-1`, `equity-curve-1`).

---

## Shared Patterns (Cross-Cutting)

### A. Authentication + Authorization on Read

**Source:** `src/lib/api/withAuth.ts` + inline `ctx.params` pattern from `src/app/api/strategies/draft/[id]/route.ts`

**Apply to:** the new `/api/bridge/outcome/[id]/curves` route handler (file 10)

**Excerpt** (strategies/draft/[id]/route.ts lines 27–40):
```ts
async function getAuthedUserIdOrError(
  req: NextRequest,
): Promise<{ userId: string } | NextResponse> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const csrfError = assertSameOrigin(req);
    if (csrfError) return csrfError;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return { userId: user.id };
}
```

**Ownership-then-analytics admin pattern** (bridge/outcome/route.ts lines 111–121):
```ts
// match_decisions has no allocator-self-SELECT RLS policy, so this check
// runs through the admin client. The .eq("allocator_id", user.id) is the
// ownership gate — it MUST stay inline with the query.
const admin = createAdminClient();
const { data: decision } = await admin.from("match_decisions").select("id")
  .eq("allocator_id", user.id).eq("strategy_id", parsed.data.strategy_id)
  .eq("decision", "sent_as_intro").maybeSingle();
```

**Invariant:** for the curves endpoint, FIRST prove ownership via user-scoped client (RLS gate) on `bridge_outcomes`, THEN use admin client for both `match_decisions.original_strategy_id` AND `strategy_analytics.returns_series` (admin-only per ADR-0003 §b convention and match_decisions RLS policy).

---

### B. Error Handling + Response Shape

**Source:** `src/app/api/bridge/outcome/route.ts`

**Apply to:** the new `/api/bridge/outcome/[id]/curves` route handler (file 10)

**Excerpt** (bridge/outcome/route.ts lines 96–108):
```ts
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
```

**DB error pattern** (bridge/outcome/route.ts lines 153–159):
```ts
if (error || !inserted) {
  console.error("[api/bridge/outcome] upsert error:", error);
  return NextResponse.json({ error: "Failed to record outcome" }, { status: 500 });
}
```

**Invariant:** every `NextResponse.json(...)` error payload is shaped `{ error: string }` (+ optional `issues` for Zod). Every log line is prefixed with `[api/bridge/outcome/...]` for log-aggregation grep (CONVENTIONS.md §Logging).

---

### C. Typography + Color Tokens (no hex in JSX)

**Source:** DESIGN.md via TileWrapper + DrawdownChart + PositionsTable

**Apply to:** all 5 new widget components (OutcomesWidget, OutcomesKPIStrip, OutcomesTimelineRow, OutcomesExpandedPanel, OutcomesSparkline)

**Color palette locked values** (used directly in Recharts `stroke={...}` and inline `style={{ color }}` — NOT in Tailwind classes where tokens exist):
```
#1B6B5A — accent (replacement sparkline line, CTA)
#94A3B8 — muted (original sparkline line)
#16A34A — positive (delta > 0, win pill)
#DC2626 — negative (delta < 0, loss pill)
#718096 — text-muted (labels, pending pill)
#E2E8F0 — border (table dividers, skeleton)
#F8F9FA — page bg (row hover, header bg)
#1A1A2E — text-primary (body, neutral KPI)
```

**Typography classes (UI-SPEC §Typography):**
- `font-mono text-[13px] tabular-nums font-medium` — KPI numbers, delta numbers (DASHBOARD-02 13px)
- `font-sans text-sm` — body + strategy names + dates (DASHBOARD-03 14px)
- `text-[11px] uppercase tracking-wider font-semibold` — table headers, KPI labels
- `text-xs font-medium` — KPI sub-label + caption (12px)
- `font-metric tabular-nums` — in-line percentage in status pill (OutcomeRecordedRow precedent)

**Invariant:** NEVER hardcode hex in a Tailwind class string (`bg-[#1B6B5A]` is allowed only where no token exists — e.g., semi-transparent pills `rgba(22,163,74,0.10)`). DESIGN.md and CONVENTIONS.md §Design System Conformance forbid hex except for the above palette values.

---

### D. Widget Error Boundary

**Source:** `src/app/(dashboard)/allocations/components/TileWrapper.tsx` lines 17–40 (`WidgetErrorBoundary` class component)

**Apply to:** all widgets automatically — TileWrapper wraps every tile via `<WidgetErrorBoundary>{children}</WidgetErrorBoundary>` (TileWrapper.tsx line 136). Phase 5 does NOT duplicate this; the widget's own render-time JS errors are caught by the existing boundary. Phase 5's data-fetch ERROR state (the `"Could not load outcomes"` + retry UI) is a SEPARATE concern handled within the widget's render branches.

**Excerpt** (TileWrapper.tsx lines 17–40):
```tsx
class WidgetErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): ErrorBoundaryState { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center rounded-md p-4 text-center text-sm"
             style={{ backgroundColor: "rgba(220, 38, 38, 0.06)", color: "#DC2626" }}>
          Widget error — try removing and re-adding.
        </div>
      );
    }
    return this.props.children;
  }
}
```

**Invariant:** do NOT add a second error boundary in OutcomesWidget. Implement the data-level error UI as a render branch: `if (fetchError) return <DataErrorState onRetry={...} />`.

---

### E. Vitest + RTL Test Scaffolding

**Source:** `.planning/codebase/TESTING.md` §Vitest Test Structure + existing `src/app/api/bridge/outcome/route.test.ts` + `src/lib/bridge-outcome-label.test.ts`

**Apply to:** all NEW test files (route.test.ts, outcomes.test.tsx, outcomes-kpi.test.ts, match-decisions-schema.test.ts)

**Canonical route-handler test header** (from TESTING.md line 123–135 + bridge/outcome/route.test.ts lines 17–44):
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// 1. Neuter server-only imports (audit.ts has `import "server-only"`)
vi.mock("server-only", () => ({}));

// 2. Neuter next/server's `after()` so emissions run synchronously in tests
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb(); } };
});

// 3. Hoisted mutable state
const STATE = vi.hoisted(() => ({
  authUser: { id: "...", email: "..." } as {...} | null,
  // ...
}));

// 4. Mock Supabase clients inline
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({...}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({...}) }));
vi.mock("@/lib/ratelimit", () => ({ userActionLimiter: null, checkLimit: async () => STATE.checkLimitResult }));
```

**Invariant:** never import directly from `vi.mock()`'d modules — always `await import("./route")` inside each `it` block to force fresh module evaluation per test.

---

## Registration Ritual — Adding a New Widget (4-File Change)

To add a new widget to the My Allocation dashboard, modify these 4 files in order:

### File 1: `src/app/(dashboard)/allocations/lib/widget-registry.ts`

**Insertion point:** inside `WIDGET_REGISTRY`, after the last entry of the chosen category (or add a new `// ── CategoryName (N) ──` section before the closing `};` at line 416).

**1-line excerpt (model):**
```ts
// widget-registry.ts:256
"positions-table": { id: "positions-table", name: "Positions Table", category: "positions", icon: "▦", defaultW: 12, defaultH: 4, description: "...", status: "ready" },
```

**If new category:** also append to `WIDGET_CATEGORIES` (line 430) AND extend `WidgetMeta.category` union in `lib/types.ts` line 21.

---

### File 2: `src/app/(dashboard)/allocations/widgets/index.ts`

**Insertion point:** inside `WIDGET_COMPONENTS`, after the last entry of the matching category (or add a new `// ── CategoryName (N) ──` section before the closing `};` at line 100).

**1-line excerpt (model — default export):**
```ts
// widgets/index.ts:16
"equity-curve": lazy(() => import("./performance/EquityCurve")),
```

**1-line excerpt (model — named export):**
```ts
// widgets/index.ts:67-69
"portfolio-alerts": lazy(() => import("./monitoring/PortfolioAlerts").then((m) => ({ default: m.PortfolioAlerts }))),
```

---

### File 3: `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts`

**Insertion point:** append to the `DEFAULT_LAYOUT` array (before the closing `];` at line 26).

**1-line excerpt (model):**
```ts
// dashboard-defaults.ts:22
{ i: "positions-table-1", widgetId: "positions-table", x: 0, y: 11, w: 12, h: 4 },
```

**CRITICAL:** bump `LAYOUT_VERSION` on line 11 (`export const LAYOUT_VERSION = 1;` → `= 2`) so `useDashboardConfig.loadConfig()` resets persisted layouts on next page load. Without this bump, existing users will NOT see the new widget in their grid.

---

### File 4: Create the widget component file

Per-category subdirectory convention: `src/app/(dashboard)/allocations/widgets/<category>/<Component>.tsx`.

For Phase 5: `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx`.

**Export convention:** `export default function OutcomesWidget({ data }: WidgetProps) { ... }` — default export matches PositionsTable and all 10 performance widgets. Named export + `.then((m) => ({ default: m.Named }))` is the alternative used by meta + monitoring + intelligence + risk widgets.

---

## No Analog Found

None. Every file in the Phase 5 scope has a role-match or exact-match analog already in the repo. The largest "greenfield" pattern is `OutcomesExpandedPanel.tsx`'s 3-column delta panel layout — but the sub-row injection wrapper (`<tr><td colSpan>`) has a strong analog in `PositionsTable.BannerSubRow`, and the 3-column loading-card grid has a structural echo in `ReplacementPanel.tsx:140–154`.

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/allocations/widgets/**`, `src/app/api/bridge/**`, `src/lib/*bridge*`, `src/lib/queries*`, `src/__tests__/*bridge*`, `supabase/migrations/059_*`, `supabase/migrations/060_*`, `supabase/migrations/011_*` (send_intro_with_decision RPC source), `src/app/api/admin/match/send-intro/**`, `src/components/admin/SendIntroPanel.tsx`.

**Files scanned:** 28 source files + 9 test files + 3 migrations + 8 planning docs = 48 files (original pass); plus 3 admin files for the revision (send-intro route, SendIntroPanel, AllocatorMatchQueue).

**Pattern extraction date:** 2026-04-19
**§20 + top banner revised:** 2026-04-19 (admin-side threading; column placement correction to `match_decisions`; superseded sections §1/§13/§14/§16/§18/§19 annotated inline)

**Planner references (canonical):**
- `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` (D-01..D-21; D-20a–d REVISED 2026-04-19)
- `.planning/phases/05-outcomes-dashboard/05-RESEARCH.md` §Technical Approach + §Recommended Plan Breakdown
- `.planning/phases/05-outcomes-dashboard/05-UI-SPEC.md` (design contract)
- `.planning/phases/05-outcomes-dashboard/05-01-PLAN.md` (authoritative — post-revision)
- `.planning/phases/05-outcomes-dashboard/05-01-TASKS.md` (authoritative — post-revision)
- `.planning/codebase/CONVENTIONS.md` §Route Handler Patterns + §Design System Conformance
- `.planning/codebase/TESTING.md` §Vitest Test Structure

## PATTERN MAPPING COMPLETE
