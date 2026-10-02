# Phase 10: Scenario Builder and What-If — Pattern Map

**Mapped:** 2026-04-25
**Files analyzed:** 21 new/modified files
**Analogs found:** 20 / 21 (1 truly novel: `POST /api/allocator/scenario/commit/route.ts` — composite of two existing route patterns)

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `lib/scenario-state.ts` | lib / pure module | transform + localStorage persistence | `hooks/useDashboardConfig.ts` | role-match (localStorage idiom) |
| `lib/scenario-adapter.ts` | lib / pure adapter | pure projection (holdings → StrategyForBuilder[]) | `lib/holdings-adapter.ts` | exact |
| `lib/holding-outcome-adapter.ts` (EXTENDED) | lib / pure adapter | pure transform + synthetic shape | `lib/holding-outcome-adapter.ts` (self) | self-extend |
| `components/ScenarioComposer.tsx` | component | read + wiring | `ScenarioFlaggedHoldingsList.tsx` | role-match |
| `components/ScenarioCompositionList` (sub) | component | read + toggle/write state | `HoldingsTable.tsx` | role-match |
| `components/ScenarioFooter.tsx` | component | pure projection / display | `components/KpiStrip.tsx` (display primitive) | partial |
| `components/ScenarioCommitDrawer.tsx` | component | request-response (write) | `components/BridgeDrawer.tsx` | exact |
| `components/StrategyBrowseDrawer.tsx` | component | read + filter (client-side) | `components/BridgeDrawer.tsx` | exact |
| `components/KpiStrip.tsx` (EXTENDED) | component | pure projection (live + delta) | `components/KpiStrip.tsx` (self) | self-extend |
| `components/BridgeDrawer.tsx` (EXTENDED) | component | request-response | `components/BridgeDrawer.tsx` (self) | self-extend |
| `widgets/performance/EquityChart.tsx` (EXTENDED) | component | pure projection / SVG render | `widgets/performance/EquityChart.tsx` (self) | self-extend |
| `widgets/performance/DrawdownChart.tsx` (EXTENDED) | component | pure projection / chart render | `widgets/performance/DrawdownChart.tsx` (self) | self-extend |
| `AllocationsTabs.tsx` (EXTENDED) | component / wiring | wiring under feature flag | `AllocationsTabs.tsx` (self, lines 365–377) | self-extend |
| `src/lib/queries.ts` (EXTENDED) | lib / server query | CRUD read (SSR payload) | `src/lib/queries.ts` (self, equityDailyPoints derivation) | self-extend |
| `api/allocator/scenario/commit/route.ts` | route handler | request-response (write, transactional) | `api/match/decisions/holding/route.ts` + `api/bridge/outcome/route.ts` | composite |
| `supabase/migrations/080_match_decisions_kind_enum.sql` | migration | schema DDL | `supabase/migrations/072_match_decisions_original_holding_ref.sql` | exact |
| `ScenarioComposer.test.tsx` | test | unit / component | `ScenarioFlaggedHoldingsList.test.tsx` | role-match |
| `ScenarioCommitDrawer.test.tsx` | test | unit / component | `components/BridgeDrawer.test.tsx` | exact |
| `StrategyBrowseDrawer.test.tsx` | test | unit / component | `components/BridgeDrawer.test.tsx` | exact |
| `scenario-adapter.test.ts` | test | unit / pure | `lib/holdings-adapter.test.ts` | exact |
| `scenario-state.test.ts` + `.localStorage.test.ts` | test | unit / pure + localStorage | `hooks/useDashboardConfig.test.ts` | exact |

---

## Pattern Assignments

### `src/app/(dashboard)/allocations/lib/scenario-state.ts` (lib, localStorage persistence)

**Analog:** `src/app/(dashboard)/allocations/hooks/useDashboardConfig.ts`

**DON'T copy:** The hook shape (`useState` + `useEffect` persist pattern). `scenario-state.ts` is a **pure module** — no React, no hooks. The React integration (`useScenarioState`) is a thin wrapper layer. The localStorage load/save/clear helpers are the analog to the `loadLegacyConfig` / `persistLegacy` helpers in `useDashboardConfig.ts`.

**SSR-safe localStorage load pattern** (`useDashboardConfig.ts` lines 82–101):
```typescript
function loadLegacyConfig(): LegacyDashboardConfig {
  if (typeof window === "undefined") {
    return { tiles: LEGACY_DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION_LEGACY };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LegacyDashboardConfig;
      if (parsed.layoutVersion !== LAYOUT_VERSION_LEGACY) {
        return { tiles: LEGACY_DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION_LEGACY };
      }
      if (Array.isArray(parsed.tiles) && parsed.tiles.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Corrupted data — fall back to defaults.
  }
  return { tiles: LEGACY_DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION_LEGACY };
}
```

**SSR-safe localStorage write — silent quota swallow** (`useDashboardConfig.ts` lines 103–109):
```typescript
function persistLegacy(config: LegacyDashboardConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage full or unavailable — silently ignore.
  }
}
```

**Schema-version gate pattern** (`useDashboardConfig.ts` lines 296–320): On load, if `parsed.layoutVersion !== LAYOUT_VERSION`, return defaults (Voice-D8 reset-on-mismatch precedent). Apply the same check: if `parsed.schema_version !== SCENARIO_SCHEMA_VERSION`, return `null` (force default-init from live holdings).

**Adaptation notes:**
- Storage key: `"allocations.scenario_v0_15"` (not `"quantalyze-dashboard-config"`)
- Schema version field: `schema_version: number` (integer, not `layoutVersion`)
- No `useRef(hasMutated)` guard needed — `scenario-state.ts` is pure functions, not a hook. The caller (React component) decides when to persist.
- Add `init_holdings_fingerprint: string` field for staleness detection (no analog in `useDashboardConfig.ts` — new behavior).

---

### `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` (lib, pure projection)

**Analog:** `src/app/(dashboard)/allocations/lib/holdings-adapter.ts`

**Imports pattern** (`holdings-adapter.ts` lines 1–5, 22–23):
```typescript
/**
 * Pure TypeScript — no fetch, no side effects.
 * No network calls, no browser-storage / DOM access, no implicit time reads.
 */
import { buildHoldingRef } from "./holding-outcome-adapter";
```

**Interface shape** (`holdings-adapter.ts` lines 35–96):
```typescript
export interface HoldingsAdapterInputs {
  holdingsSummary: Array<{
    venue: string;
    symbol: string;
    holding_type: "spot" | "derivative";
    quantity: number;
    value_usd: number;
    // ... additional fields
  }>;
  flaggedHoldings: Array<{ venue: string; symbol: string; ... }>;
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
  strategies: Array<{ id: string; name: string; ... }>;
  // Optional injectable inputs for testability (e.g. `now?: Date`)
}
```

**Pure transform body** (`holdings-adapter.ts` lines 120–218):
```typescript
export function toDesignHoldings(inputs: HoldingsAdapterInputs): DesignHoldingRow[] {
  const { holdingsSummary, flaggedHoldings, ... } = inputs;

  // Σ value_usd for weight denominator. Non-finite values treated as 0.
  const total = holdingsSummary.reduce(
    (sum, h) => sum + (Number.isFinite(h.value_usd) ? h.value_usd : 0),
    0,
  );

  // Index flaggedHoldings by ref for O(1) lookup.
  const flaggedByRef = new Map<string, AdapterFlag>();
  for (const f of flaggedHoldings) {
    flaggedByRef.set(buildHoldingRef(f), f);
  }

  return holdingsSummary.map((h): DesignHoldingRow => {
    const ref = buildHoldingRef(h);
    const weight = total > 0 ? h.value_usd / total : 0;
    // ...
    return { id: ref, ... };
  });
}
```

**Adaptation notes:**
- `scenario-adapter.ts` returns `{ strategies: StrategyForBuilder[]; state: ScenarioState }` (not `DesignHoldingRow[]`).
- The `buildHoldingRef` import already comes from `./holding-outcome-adapter` — reuse verbatim.
- Holdings MUST use `buildHoldingRef(h)` as the `id` field in `StrategyForBuilder`. Added strategies pass through their UUID `strategy.id` unchanged.
- Inject `minReturnDays?: number` (default 30) for the warm-up gate — mirror Phase 07 D-03 gate. Holdings with `daily_returns.length < minReturnDays` are excluded via `flatMap(() => [])`.
- `DON'T copy` the `holdingToStrategyId` optional map — scenario-adapter has no strategy-join; it produces the StrategyForBuilder set directly from holdings returns.

---

### `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` (EXTENDED — voluntary kinds)

**Analog:** `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` (self)

**Existing shape to extend** (lines 38–125 — ADD below `deriveEligibleForOutcome`):
```typescript
export function buildHoldingRef(h: Pick<FlaggedHolding, "venue" | "symbol" | "holding_type">): string {
  return `holding:${h.venue}:${h.symbol}:${h.holding_type}`;
}
// ... toBridgeOutcomeBannerProps, toAllocatedFormProps, toRejectedFormProps, deriveEligibleForOutcome
```

**New synthetic match_decision shape to add:**
```typescript
/** Synthetic match_decision shape for voluntary_remove — used by commit drawer. */
export interface VoluntaryRemoveDecisionShape {
  kind: "voluntary_remove";
  original_holding_ref: string;   // buildHoldingRef(holding)
  suggested_strategy_id: null;
  original_strategy_id: null;
}

/** Synthetic match_decision shape for voluntary_add — used by commit drawer. */
export interface VoluntaryAddDecisionShape {
  kind: "voluntary_add";
  original_holding_ref: null;
  original_strategy_id: null;
  suggested_strategy_id: string;  // strategy UUID
}

export function toVoluntaryRemoveDecision(
  h: Pick<FlaggedHolding, "venue" | "symbol" | "holding_type">,
): VoluntaryRemoveDecisionShape {
  return {
    kind: "voluntary_remove",
    original_holding_ref: buildHoldingRef(h),
    suggested_strategy_id: null,
    original_strategy_id: null,
  };
}

export function toVoluntaryAddDecision(strategyId: string): VoluntaryAddDecisionShape {
  return {
    kind: "voluntary_add",
    original_holding_ref: null,
    original_strategy_id: null,
    suggested_strategy_id: strategyId,
  };
}
```

**DON'T modify** the existing `FlaggedHolding` type, `buildHoldingRef`, or any of the four existing adapter functions — they are used unchanged by the v1 code path and by `ScenarioFlaggedHoldingsList.tsx`.

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (component, read + wiring)

**Analog:** `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx`

**Imports pattern** (`ScenarioFlaggedHoldingsList.tsx` lines 1–38):
```typescript
"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildHoldingRef,
  toBridgeOutcomeBannerProps,
  toAllocatedFormProps,
  toRejectedFormProps,
  deriveEligibleForOutcome,
  type FlaggedHolding,
} from "./lib/holding-outcome-adapter";
import { BridgeOutcomeBanner } from "./components/BridgeOutcomeBanner";
import { AllocatedForm } from "./components/AllocatedForm";
import { RejectedForm } from "./components/RejectedForm";
import { OutcomeRecordedRow } from "./components/OutcomeRecordedRow";
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";
import { sendBridgeIntro } from "@/lib/bridge/send-intro";
```

**Props interface pattern** (`ScenarioFlaggedHoldingsList.tsx` lines 39–45):
```typescript
export interface ScenarioFlaggedHoldingsListProps {
  flaggedHoldings: FlaggedHolding[];
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
  existingOutcomesByHoldingRef: Record<string, BridgeOutcome | null>;
  allocatorPreferences?: { max_weight?: number | null } | null;
}
```

**ScenarioComposer props will extend this pattern** with the Phase 10 payload fields:
```typescript
export interface ScenarioComposerProps {
  // From MyAllocationDashboardPayload (existing):
  flaggedHoldings: FlaggedHolding[];
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
  existingOutcomesByHoldingRef: Record<string, BridgeOutcome | null>;
  holdingsSummary: MyAllocationDashboardPayload["holdingsSummary"];
  strategies: MyAllocationDashboardPayload["strategies"];
  equityDailyPoints: DailyPoint[];
  snapshotCount: number;
  allKeysStale: boolean;
  // Phase 10 NEW:
  holdingReturnsByScopeRef: Record<string, DailyPoint[]>;
  allocatorId: string;
}
```

**Expandable sub-row state machine pattern** (`ScenarioFlaggedHoldingsList.tsx` lines 184–294):
```typescript
const [expandedId, setExpandedId] = useState<string | null>(null);
const [localDecisionsByRef, setLocalDecisionsByRef] = useState<
  Record<string, { id: string } | null>
>({});
// one-open-at-a-time: setExpandedId(isExpanded ? null : ref)
```

**Card surface + table structure** (`ScenarioFlaggedHoldingsList.tsx` lines 199–295):
```typescript
return (
  <div className="overflow-x-auto rounded-lg border border-border bg-surface p-4">
    <table className="w-full font-sans text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
          {/* column headers */}
        </tr>
      </thead>
      <tbody>
        {flaggedHoldings.map((h) => {
          const ref = buildHoldingRef(h);
          return (
            <Fragment key={ref}>
              <tr className="border-b border-border transition-colors hover:bg-[#FAFBFC]">
                {/* row cells */}
              </tr>
              {isExpanded && (
                <tr><td colSpan={COL_SPAN} className="p-0">...</td></tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  </div>
);
```

**Adaptation notes:**
- `ScenarioComposer` has MORE sections above the composition list (KpiStrip, EquityChart, DrawdownChart, Bridge inline card). The `ScenarioFlaggedHoldingsList` is embedded inside the composer as the Bridge section — it is NOT rewritten, just wrapped.
- The composition list adds: toggle switch column, weight input (Geist Mono, right-aligned), per-row delta pill, Remove × for added strategies, Compare link for flagged holdings.
- `ScenarioComposer` manages `useScenarioState` (scenario draft) at the top level and passes derived `computeScenario()` result down to `KpiStrip` and `EquityChart`.

---

### `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx` (component, request-response)

**Analog:** `src/app/(dashboard)/allocations/components/BridgeDrawer.tsx`

**Full drawer shell pattern** (`BridgeDrawer.tsx` lines 22–299):
```typescript
"use client";

import { useEffect, useRef, useState } from "react";
// ...

export function BridgeDrawer({ isOpen, onClose, flaggedHoldings, ... }: BridgeDrawerProps) {
  const [stage, setStage] = useState<Stage>("browse");
  const drawerRef = useRef<HTMLDivElement>(null);

  // Reset state on close + Esc handler
  useEffect(() => {
    if (!isOpen) {
      setStage("browse");
      // ... reset other state
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop — click dismisses */}
      <div
        onClick={onClose}
        aria-hidden="true"
        data-testid="bridge-drawer-backdrop"
        style={{
          position: "fixed", inset: 0,
          background: "rgba(15,23,42,0.32)",
          zIndex: 100,
          animation: "bd-fade 160ms ease",
        }}
      />
      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-label="Bridge review"
        aria-modal="true"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: 620,          // ScenarioCommitDrawer = 720
          maxWidth: "96vw",
          background: "var(--surface, white)",
          boxShadow: "-8px 0 20px rgba(0,0,0,0.08)",
          zIndex: 101,
          animation: "bd-slide 220ms ease",
          overflowY: "auto",
          padding: 24,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-text-primary">
            {/* drawer title */}
          </div>
          <button type="button" onClick={onClose} aria-label="Close drawer"
            className="text-text-muted hover:text-text-primary">×</button>
        </div>
        {/* stage-dependent body */}
      </div>

      <style jsx>{`
        @keyframes bd-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bd-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
    </>
  );
}
```

**Submitting + error pattern** (`BridgeDrawer.tsx` lines 256–276):
```typescript
const [submitting, setSubmitting] = useState(false);
const [error, setError] = useState<string | null>(null);

async function handleSendIntro() {
  if (!selected) return;
  setSubmitting(true);
  setError(null);
  const result = await sendBridgeIntro({ ... });
  setSubmitting(false);
  if (!result.ok) {
    setError(result.error);
    return;
  }
  onClose();
}
// ...
<button type="button" onClick={handleSendIntro} disabled={submitting}
  className="self-start rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-50">
  {submitting ? "Sending…" : "Send intro"}
</button>
{error && <div role="alert" className="text-xs text-negative">{error}</div>}
```

**Adaptation notes for `ScenarioCommitDrawer`:**
- Width: `720` (not `620`).
- `aria-label="Commit scenario"`.
- No `stage` state machine — the commit drawer has a single view (diff sections, no confirm step).
- Body: 3 grouped sections — "Holdings removed" (red left-bar 4px), "Strategies added" (green left-bar 4px), "Weight changes" (muted left-bar 4px). Empty sections hidden.
- Each diff row embeds `<RejectedForm>` or `<AllocatedForm>` directly (multiple forms open simultaneously — commit drawer modality allows this unlike the Holdings table one-open-at-a-time constraint).
- Footer: "Submit all N decisions" primary button (`bg-accent`, disabled when any per-row form has errors). Pre-flight confirmation: "Submit N decisions? This will record N outcomes and feed the daily delta cron."
- Submit calls `POST /api/allocator/scenario/commit` (not `sendBridgeIntro`).
- On success: collapse to green "N decisions recorded" confirmation row (not `onClose()` immediately).

---

### `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` (component, read + filter)

**Analog:** `src/app/(dashboard)/allocations/components/BridgeDrawer.tsx`

Copy the **full drawer shell** from `BridgeDrawer.tsx` (same backdrop + panel + Esc handler + keyframe animations) — see excerpt above.

**Candidate card row pattern** (`BridgeDrawer.tsx` lines 195–221):
```typescript
<ul className="grid gap-2">
  {candidates.map((h) => {
    const ref = buildHoldingRef(h);
    return (
      <li key={ref}>
        <button
          type="button"
          onClick={() => { setSelectedRef(ref); setStage("confirm"); }}
          className="w-full rounded-md border border-border p-3 text-left hover:border-accent"
          data-testid={`bridge-candidate-${ref}`}
        >
          <div className="text-sm font-medium text-text-primary">
            {h.symbol} ({h.venue})
          </div>
          <div className="text-xs text-text-muted">
            candidate: {h.top_candidate_name}
          </div>
        </button>
      </li>
    );
  })}
</ul>
```

**Adaptation notes for `StrategyBrowseDrawer`:**
- Width: `620` (same as `BridgeDrawer`).
- `aria-label="Browse verified strategies"`.
- No `stage` state machine — single view (search + filter pills + scrollable strategy list).
- Add search `<input>` (alias-substring filter, client-side, no server round-trip on filter change).
- Filter pills: markets (multi-select), strategy_types (multi-select) — use `Set<string>` toggle state.
- Mandate-fit pill per row: green (`≥0.7`), yellow (`0.4≤x<0.7`), red (`<0.4`) — computed client-side from strategy attributes vs allocator mandate preferences (NOT from strategies table column — see Pitfall 7 in RESEARCH.md).
- Drawer stays open after add (multi-add session) — no `onClose()` on add success.
- Empty state: "No strategies match your filters. Clear filters to see all verified strategies."
- Strategy data: full verified list loaded once on drawer open, filtered client-side. Source: `strategies[]` already on the `MyAllocationDashboardPayload` (or `getStrategiesByCategory` — planner confirms).

---

### `src/app/(dashboard)/allocations/components/KpiStrip.tsx` (EXTENDED — scenario mode)

**Analog:** `src/app/(dashboard)/allocations/components/KpiStrip.tsx` (self)

**Existing props + cell structure to preserve** (`KpiStrip.tsx` lines 35–71):
```typescript
interface KpiStripProps {
  analytics: any;
  metrics: ComputedMetrics;
  timeframe?: string;
  aum: number | null;
  snapshotCount?: number;    // defaults 30 → no warm-up render for untouched callers
  allKeysStale?: boolean;
  minHistoryDepthMonths?: number | null;
  activeVenues?: string[];
}
```

**warmupCopy + warmingUp gate to preserve verbatim** (`KpiStrip.tsx` lines 88–138):
```typescript
function warmupCopy(snapshotCount: number, minHistoryDepthMonths: number | null, activeVenues: string[]): string {
  if (minHistoryDepthMonths != null && minHistoryDepthMonths <= 3 && activeVenues.length > 0) {
    return `Only ${minHistoryDepthMonths} months of history available on ${activeVenues.join(", ")}`;
  }
  return `Warming up — need ${30 - snapshotCount} more days of synced data.`;
}
const warmingUp = snapshotCount < 30 && !allKeysStale;
const warmupHelper = warmingUp ? warmupCopy(snapshotCount, minHistoryDepthMonths, activeVenues) : null;
```

**Cell render loop to extend** (`KpiStrip.tsx` lines 240–271):
```typescript
return (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
    role="group" aria-label="Portfolio KPIs">
    {cells.map(({ label, raw, formatted, sub }) => (
      <div key={label} className="rounded-lg border border-border bg-surface p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </div>
        <div className={`mt-1 font-mono text-lg font-medium tabular-nums ${valueColorClass(...)}`}>
          {formatted}
        </div>
        {sub ? <div className="mt-1 text-xs text-text-secondary">{sub}</div> : null}
      </div>
    ))}
  </div>
);
```

**New props to ADD** (extend `KpiStripProps`):
```typescript
// ADD to KpiStripProps:
mode?: "live" | "scenario";   // default "live" — existing callers unaffected
scenarioMetrics?: ComputedMetrics | null;  // required when mode="scenario"
liveMetrics?: ComputedMetrics | null;      // required when mode="scenario"
```

**Delta pill direction map to ADD** (new constants in `KpiStrip.tsx`):
```typescript
type KpiDirection = "up-good" | "down-good";
const KPI_DIRECTION: Record<string, KpiDirection> = {
  twr: "up-good", cagr: "up-good", sharpe: "up-good",
  sortino: "up-good", aum: "up-good", score: "up-good",
  max_drawdown: "down-good", volatility: "down-good", avg_correlation: "down-good",
};
// Noise floor: |Δ| < 0.01 abs (Sharpe/Sortino) or |Δ| < 1% rel (TWR/CAGR/MaxDD/Vol)
function deltaPillClass(delta: number | null, direction: KpiDirection, noiseFloor: number): string {
  if (delta == null || Math.abs(delta) < noiseFloor) return "text-text-muted";
  const improved = direction === "up-good" ? delta > 0 : delta < 0;
  return improved ? "text-positive" : "text-negative";
}
```

**Rule:** When `mode === "scenario"` AND `warmingUp === true` for live baseline → suppress delta pills entirely (render `—` with no delta). The `warmingUp` gate and `warmupHelper` path execute FIRST, preserving `KpiStrip.warmup.test.tsx` invariants verbatim.

**Adaptation notes:**
- The existing Performance-tab `KpiStrip` call sites pass NO `mode` prop → default to `"live"` → zero behavior change.
- Delta pill renders BELOW the primary value inside the same `<div>` cell. Tooltip ("Live: {liveValue}") uses `title` attribute or an accessible `aria-describedby` pattern — keep it simple.
- Cell value in `mode="scenario"`: primary number = `scenarioMetrics[kpi]`; sub-line = delta pill; hover = live baseline.

---

### `src/app/(dashboard)/allocations/components/ScenarioFooter.tsx` (component, pure display)

**Analog:** `src/app/(dashboard)/allocations/components/KpiStrip.tsx` (display primitive structural pattern)

**No direct structural analog** — the sticky footer is a new primitive. Base it on the project's button + layout conventions extracted from `BridgeDrawer.tsx` and `KpiStrip.tsx`.

**Button accent pattern** (`BridgeDrawer.tsx` line 256):
```typescript
<button type="button" onClick={handleSendIntro} disabled={submitting}
  className="self-start rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-50">
  {submitting ? "Sending…" : "Send intro"}
</button>
```

**Ghost button reset pattern** (derived from DESIGN.md — no exact analog; use `text-text-muted hover:text-negative border border-border hover:border-negative` for the destructive-reveal ghost style).

**Sticky positioning pattern** (NEW — no existing analog in codebase):
```typescript
// Sticky footer within tab content area. Uses `position: sticky; bottom: 0`
// (NOT position: fixed — must not escape the tab content area per D-12).
// Height: 56px per DESIGN.md. z-index: must be above composition rows but
// below drawers (zIndex: 10; drawers use zIndex: 100+).
<footer style={{
  position: "sticky",
  bottom: 0,
  height: 56,
  background: "var(--color-surface)",
  borderTop: "1px solid var(--color-border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 16px",
  zIndex: 10,
}}>
```

**Numeric delta summary** (Geist Mono 13px/500, dot-separated — match KpiStrip's mono style):
```typescript
<span style={{ fontFamily: "Geist Mono, monospace", fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
  +0.3 Sharpe · −4% Max DD
</span>
```

---

### `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` (EXTENDED — scenarioSeries)

**Analog:** `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` (self)

**Existing `OverlaySeries` type and `overlays` prop to extend** (`EquityChart.tsx` lines 45–58):
```typescript
export type OverlaySeries = {
  id: string;
  label: string;
  color: string;
  points: DailyPoint[];
};

type Props = {
  equityDailyPoints: DailyPoint[];
  benchmark?: DailyPoint[];
  overlays?: OverlaySeries[];     // existing holding overlays
  stale?: boolean;
  initialPeriod?: Period;
};
```

**Phase 10 extension — ADD `scenarioSeries` prop:**
```typescript
// ADD to Props:
scenarioSeries?: DailyPoint[] | null;
```

**How to wire scenario series:** Pass `scenarioSeries` as a new `OverlaySeries` entry in the existing `overlays` processing pipeline — OR wire as a dedicated second path if the 3-state toggle (Live/Scenario/Both) must independently show/hide the baseline vs scenario.

**Existing overlay normalization pattern** (`EquityChart.tsx` lines 207–235):
```typescript
const overlaySeries = useMemo(() => {
  if (visible.length === 0) return [];
  return overlays
    .map((o) => {
      if (!o.points || o.points.length === 0) return null;
      const m = new Map<string, number>();
      for (const p of o.points) m.set(p.date, p.value);
      let baseValue: number | null = null;
      for (const v of visible) {
        const ov = m.get(v.date);
        if (ov != null && ov > 0) { baseValue = ov; break; }
      }
      if (baseValue == null) return null;
      const series = visible.map((v) => {
        const ov = m.get(v.date);
        if (ov == null) return null;
        return Number((ov / (baseValue as number)).toFixed(6));
      });
      return { ...o, series };
    })
    .filter((x): x is OverlaySeries & { series: Array<number | null> } => x != null);
}, [overlays, visible]);
```

**Existing overlay SVG render** (`EquityChart.tsx` lines 679–689):
```typescript
{overlaySeries.map((o) => (
  <path key={o.id} d={toPath(o.series)} fill="none"
    stroke={o.color} strokeWidth={1.25} strokeOpacity={0.85} />
))}
```

**Legend swatch** (`EquityChart.tsx` lines 573–580):
```typescript
{overlaySeries.map((o) => (
  <LegendSwatch key={o.id} color={o.color} label={o.label} />
))}
```

**Adaptation notes:**
- **equity_curve return vs wealth conversion (CRITICAL — Pitfall 1 from RESEARCH.md):** `computeScenario().equity_curve` values are cumulative RETURN (0.18 = +18%). `EquityChart` expects cumulative WEALTH (starting at 1.0). Apply `{ date, value: point.value + 1 }` conversion before passing as `scenarioSeries`. Comment at `scenario.ts:398-402` documents this.
- The 3-state toggle "Live · Scenario · Both" is a new `visibilityMode` local state: `type VisibilityMode = "live" | "scenario" | "both"`. Default `"both"`. When `"live"`, skip rendering the scenario overlay path. When `"scenario"`, mute the live baseline path (or hide it). When `"both"`, render both.
- Live baseline line: `--color-chart-benchmark` (muted slate `#94A3B8`, strokeWidth 1.25). Scenario line: `--color-chart-strategy` (accent teal `#1B6B5A`, strokeWidth 1.5). Subtle fill `rgba(27, 107, 90, 0.06)` ONLY when `visibilityMode === "scenario"`.

---

### `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` (EXTENDED — scenarioSeries)

**Analog:** `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` (self)

**Existing `deriveSnapshotDrawdowns` export to reuse** (`DrawdownChart.tsx` lines 35–47):
```typescript
export function deriveSnapshotDrawdowns(
  points: DailyPoint[],
): { date: string; value: number }[] {
  if (points.length === 0) return [];
  let peak = Math.max(points[0].value, 0);
  const result: { date: string; value: number }[] = [];
  for (const d of points) {
    if (d.value > peak) peak = d.value;
    const dd = peak > 0 ? (d.value - peak) / peak : 0;
    result.push({ date: d.date, value: dd });
  }
  return result;
}
```

**Existing Recharts props interface** (`DrawdownChart.tsx` lines 24–26):
```typescript
interface DrawdownChartProps extends WidgetProps {
  equityDailyPoints?: DailyPoint[];
}
// ADD: scenarioDailyPoints?: DailyPoint[] | null;
```

**Adaptation notes:**
- `DrawdownChart` is a Recharts `<AreaChart>` (NOT SVG like `EquityChart`). Adding a scenario series requires a second `<Area>` component on the same `<AreaChart>`.
- Apply `deriveSnapshotDrawdowns(scenarioDailyPoints)` to get the scenario drawdown series. The scenario equity curve from `computeScenario()` is cumulative RETURN — convert to cumulative wealth (×1 + value) and multiply by scenario AUM before passing to `deriveSnapshotDrawdowns` (which expects cumulative USD values).
- Same 3-state toggle as `EquityChart` (Live / Scenario / Both). Can share a lifted state from `ScenarioComposer` or be independent local state per chart.

---

### `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (EXTENDED — wiring point)

**Analog:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (self, lines 365–377)

**Exact wiring point to branch** (`AllocationsTabs.tsx` lines 365–377):
```typescript
<div role="tabpanel" id="panel-scenario" aria-labelledby="tab-scenario"
  hidden={activeTab !== "scenario"}>
  {activeTab === "scenario" && (
    <ScenarioStub
      flaggedHoldings={props.flaggedHoldings}
      matchDecisionsByHoldingRef={props.matchDecisionsByHoldingRef}
    />
  )}
</div>
```

**`isUiV2` flag pattern** (`AllocationsTabs.tsx` lines 81–93):
```typescript
const UI_V2_STORAGE_KEY = "allocations.ui_v2";

function loadUiV2Flag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(UI_V2_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return false;
  } catch {
    return false;
  }
}
```

**Phase 10 branch (replace the scenario panel body):**
```typescript
{activeTab === "scenario" && (
  isUiV2
    ? <ScenarioComposer {...scenarioComposerProps} />   // Phase 10 — full composer
    : <ScenarioStub                                      // v1 path — UNCHANGED
        flaggedHoldings={props.flaggedHoldings}
        matchDecisionsByHoldingRef={props.matchDecisionsByHoldingRef}
      />
)}
```

**`isUiV2` state** (`AllocationsTabs.tsx` existing): already declared as `const [isUiV2, setIsUiV2] = useState(loadUiV2Flag)` — planner confirms exact line; search for `isUiV2` in the file.

**Adaptation notes:**
- `ScenarioComposer` needs ALL Phase 10 payload fields, including the new `holdingReturnsByScopeRef`. The `props` spread is `MyAllocationDashboardPayload` — after the payload type is extended, the composer reads the new field naturally.
- Also add `ScenarioComposer` to the `dynamic()` import list (pattern: copy `HoldingsTabPanel` dynamic import at lines 47–51) — the composer pulls in chart + form primitives that the Overview tab never needs.

---

### `src/lib/queries.ts` (EXTENDED — `holdingReturnsByScopeRef` payload field)

**Analog:** `src/lib/queries.ts` (self — `equityDailyPoints` derivation, lines 755–840)

**Existing parallel-prop derivation pattern** (`queries.ts` lines 755–840):
```typescript
// f7 adapter: DailyPoint[] for EquityCurve/DrawdownChart parallel-prop.
const equityDailyPoints = equitySnapshotsToDailyPoints(equitySnapshots, ...);
// ... packed into the final return object alongside the raw equitySnapshots
return {
  // ...
  equityDailyPoints,
  // ...
};
```

**`MyAllocationDashboardPayload` type extension** (ADD after line 687):
```typescript
/**
 * Phase 10 / D-04. Per-holding daily return series reconstructed from
 * allocator_equity_snapshots.breakdown JSONB. Keyed by scope_ref
 * "holding:{venue}:{symbol}:{holding_type}". Empty record when no
 * snapshots exist or no breakdown data is available.
 * Reconstruction: per-day per-symbol USD value differences → daily return.
 * One pass at SSR time — NOT in the component tree.
 */
holdingReturnsByScopeRef: Record<string, DailyPoint[]>;
```

**Reconstruction helper to add inside `getMyAllocationDashboard`** (from RESEARCH Pattern 3):
```typescript
function reconstructHoldingReturnsByScopeRef(
  equitySnapshots: Array<{ asof: string; breakdown: Record<string, number> | null }>,
  holdingsSummary: Array<{ symbol: string; venue: string; holding_type: string }>,
): Record<string, DailyPoint[]> {
  const symbolSeriesUSD = new Map<string, Array<{ asof: string; value: number }>>();
  for (const snap of equitySnapshots) {
    if (!snap.breakdown) continue;
    for (const [symbol, value] of Object.entries(snap.breakdown)) {
      if (!symbolSeriesUSD.has(symbol)) symbolSeriesUSD.set(symbol, []);
      symbolSeriesUSD.get(symbol)!.push({ asof: snap.asof, value });
    }
  }
  const result: Record<string, DailyPoint[]> = {};
  for (const h of holdingsSummary) {
    const scopeRef = `holding:${h.venue}:${h.symbol}:${h.holding_type}`;
    const series = symbolSeriesUSD.get(h.symbol);
    if (!series || series.length < 2) continue;
    series.sort((a, b) => a.asof.localeCompare(b.asof));
    const dailyReturns: DailyPoint[] = [];
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1].value;
      const curr = series[i].value;
      if (prev === 0) continue;
      dailyReturns.push({ date: series[i].asof, value: (curr - prev) / prev });
    }
    if (dailyReturns.length > 0) result[scopeRef] = dailyReturns;
  }
  return result;
}
```

**Adaptation notes:**
- Call `reconstructHoldingReturnsByScopeRef(equitySnapshots, holdingsSummary)` in the same location as the `equityDailyPoints` derivation — both run once per SSR invocation, after the snapshots query resolves.
- `breakdown` is keyed by symbol only (no venue disambiguation). For Phase 10, map symbol → ALL holdings with that symbol across venues (same approximation used by Phase 09 Python engine).

---

### `src/app/api/allocator/scenario/commit/route.ts` (route handler, transactional write)

**Analog (composite):**
1. `src/app/api/match/decisions/holding/route.ts` — admin client for `match_decisions` insert + ownership gate + `logAuditEvent`
2. `src/app/api/bridge/outcome/route.ts` — `withAuth` + `zod` validation + rate limiter + `createClient` for `bridge_outcomes`

**Auth + rate limiter pattern** (`bridge/outcome/route.ts` lines 1–10, 92–101):
```typescript
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

export const POST = withAuth(async (req: NextRequest, user: User): Promise<NextResponse> => {
  const supabase = await createClient();
  const rl = await checkLimit(userActionLimiter, `bridge_outcome:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  // ...
});
```

**Admin client ownership gate pattern** (`match/decisions/holding/route.ts` lines 111–131):
```typescript
// Uses admin client because match_decisions lacks allocator self-INSERT RLS.
// The ownership + strategy gates above use the authed client so RLS still
// enforces the trust boundary before the elevated insert runs.
const admin = createAdminClient();
const { data: inserted, error: insertErr } = await admin
  .from("match_decisions")
  .insert({
    allocator_id: user.id,      // MUST stay inline — explicit ownership gate
    strategy_id: top_candidate_strategy_id,
    // ...
  })
  .select("id")
  .single();
```

**Audit event pattern** (`match/decisions/holding/route.ts` lines 134–143):
```typescript
logAuditEvent(supabase, {
  action: "match.decision_record",
  entity_type: "match_decision",
  entity_id: inserted.id,
  metadata: {
    original_holding_ref: holding_ref,
    top_candidate_strategy_id,
    source: "holding",
  },
});
return NextResponse.json({ match_decision_id: inserted.id }, { status: 201 });
```

**zod discriminated union pattern** (from RESEARCH Pattern 7):
```typescript
const CommitDiffSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("voluntary_remove"), holding_ref: z.string().regex(...), ... }),
  z.object({ kind: z.literal("voluntary_add"), strategy_id: z.string().uuid(), ... }),
  z.object({ kind: z.literal("voluntary_modify"), holding_ref: z.string().regex(...), ... }),
  z.object({ kind: z.literal("bridge_recommended"), holding_ref: z.string().regex(...), ... }),
]);
const CommitBodySchema = z.object({ diffs: z.array(CommitDiffSchema).min(1).max(50) });
```

**Adaptation notes:**
- Rate-limit key: `scenario_commit:${user.id}` (separate from `bridge_outcome:${user.id}`).
- Use `admin` (createAdminClient) for ALL `match_decisions` inserts. Use `supabase` (createClient) for `bridge_outcomes` inserts.
- Wrap ALL inserts in a logical transaction — use sequential `await` with early-return on any failure. Supabase JS does not expose explicit transaction BEGIN/COMMIT; use an RPC if true atomicity is required, or document the partial-commit risk. Planner decides.
- Audit event per diff: `action: "match.decision_record"`, `metadata: { kind, source: "scenario_commit" }`.

---

### `supabase/migrations/080_match_decisions_kind_enum.sql` (migration, DDL)

**Analog:** `supabase/migrations/072_match_decisions_original_holding_ref.sql`

**Migration shell pattern** (`072` lines 26–314):
```sql
BEGIN;
SET lock_timeout = '3s';

-- STEP N: Description
-- (idempotent — ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, etc.)

-- Self-verifying DO block
DO $$
DECLARE
  v_some_check INT;
BEGIN
  -- (a) assertion ...
  SELECT COUNT(*) INTO v_some_check FROM ... WHERE ...;
  IF v_some_check > 0 THEN
    RAISE EXCEPTION 'Migration 072 assertion (a) failed: ...';
  END IF;

  -- All assertions passed
  RAISE NOTICE 'phaseN: ... deployed ✓';
  RAISE NOTICE 'Migration N: all M self-verification assertions (a-X) passed.';
END
$$;

COMMIT;
```

**Migration number:** 080 (next after 079 per `ls supabase/migrations/`).

**Steps to implement** (from RESEARCH Pattern 4):
1. CREATE TYPE `match_decision_kind` AS ENUM (`bridge_recommended`, `voluntary_remove`, `voluntary_add`, `voluntary_modify`)
2. ADD COLUMN `kind match_decision_kind` (nullable initially for backfill)
3. UPDATE all NULL rows → `'bridge_recommended'`
4. ALTER COLUMN `kind` SET NOT NULL; SET DEFAULT `'bridge_recommended'`
5. DROP CONSTRAINT `match_decisions_original_xor`
6. ADD CONSTRAINT per-kind invariant CHECKs (4 constraints — see RESEARCH Pattern 4)
7. Self-verifying DO block: assert (a) no NULL kind rows, (b) old XOR gone, (c) kind enum exists, (d) all 4 CHECK constraints present, (e) ADR-0023 sync note in NOTICE string.

**ADR-0023 sync:** Same-commit atomic update to `docs/architecture/adr-0023-audit-event-taxonomy.md` adding `match.decision.voluntary_remove` and `match.decision.voluntary_add` audit kinds (per Phase 09 D-14 precedent and CONTEXT §D-10/D-11).

---

### Test files

**`scenario-state.test.ts` + `scenario-state.localStorage.test.ts`**

**Analog:** `src/app/(dashboard)/allocations/hooks/useDashboardConfig.test.ts`

**`vi.stubGlobal` localStorage pattern** (from RESEARCH §Established Patterns + Phase 08 Plan 02):
```typescript
// vitest 4.1.2 reliable idiom for localStorage-dependent tests:
vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});
```

Key test cases to cover:
- Same-set-different-order holdings → same fingerprint (Pitfall 4 prevention)
- `schema_version` mismatch → `loadScenarioDraft()` returns `null`
- `setItem` throws (QuotaExceededError simulation) → `saveScenarioDraft()` swallows silently (Pitfall 3 prevention)
- SSR guard: `typeof window === "undefined"` path returns `null` / no-ops

**`scenario-adapter.test.ts`**

**Analog:** `src/app/(dashboard)/allocations/lib/holdings-adapter.test.ts`

Key assertions:
- Holdings with `daily_returns.length < 30` are excluded from output (warm-up gate)
- All holding IDs in output satisfy `/^holding:/` — no UUID-format holding IDs (Pitfall 2 prevention)
- Added strategy IDs are UUID-format — no `holding:` prefix
- Sum of weights over enabled rows = 1.0 after every toggle and add operation (Pitfall 8 prevention)
- Empty `holdingsSummary` → only `addedStrategies` in output

**`ScenarioCommitDrawer.test.tsx` + `StrategyBrowseDrawer.test.tsx`**

**Analog:** `src/app/(dashboard)/allocations/components/BridgeDrawer.test.tsx`

Copy the drawer test scaffold:
```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { ScenarioCommitDrawer } from "./ScenarioCommitDrawer";
// ...
test("closes on Esc key", async () => {
  const onClose = vi.fn();
  render(<ScenarioCommitDrawer isOpen onClose={onClose} diffs={[...]} />);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
test("closes on backdrop click", () => { ... });
test("does not render when isOpen=false", () => { ... });
```

---

## Shared Patterns

### Authentication — `withAuth` guard
**Source:** `src/lib/api/withAuth.ts` (line 8: `export function withAuth(handler: AuthenticatedHandler)`)
**Apply to:** `src/app/api/allocator/scenario/commit/route.ts`
```typescript
export const POST = withAuth(async (req: NextRequest, user: User): Promise<NextResponse> => {
  // user.id is the authenticated allocator's ID — guaranteed non-null by withAuth
```

### Admin client for match_decisions writes
**Source:** `src/app/api/match/decisions/holding/route.ts` lines 111–130
**Apply to:** `src/app/api/allocator/scenario/commit/route.ts`
```typescript
import { createAdminClient } from "@/lib/supabase/admin";
const admin = createAdminClient();
const { data: inserted } = await admin
  .from("match_decisions")
  .insert({ allocator_id: user.id, /* ... */ })
  .select("id").single();
// NOTE: .eq("allocator_id", user.id) ownership gate MUST be explicit —
// RLS on match_decisions does not enforce allocator self-write.
```

### Rate limiting
**Source:** `src/app/api/bridge/outcome/route.ts` lines 95–101
**Apply to:** `src/app/api/allocator/scenario/commit/route.ts`
```typescript
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
const rl = await checkLimit(userActionLimiter, `scenario_commit:${user.id}`);
if (!rl.success) {
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
  );
}
```

### Audit logging
**Source:** `src/app/api/match/decisions/holding/route.ts` lines 134–143
**Apply to:** `src/app/api/allocator/scenario/commit/route.ts` (per diff row)
```typescript
import { logAuditEvent } from "@/lib/audit";
logAuditEvent(supabase, {
  action: "match.decision_record",
  entity_type: "match_decision",
  entity_id: inserted.id,
  metadata: { kind, source: "scenario_commit" },
});
```

### Zod body validation pattern
**Source:** `src/app/api/bridge/outcome/route.ts` lines 19–110
**Apply to:** `src/app/api/allocator/scenario/commit/route.ts`
```typescript
const parsed = CommitBodySchema.safeParse(await req.json().catch(() => null));
if (!parsed.success) {
  return NextResponse.json(
    { error: "Invalid request body", issues: parsed.error.issues },
    { status: 400 },
  );
}
```

### localStorage SSR-safe read + write + silent quota swallow
**Source:** `src/app/(dashboard)/allocations/hooks/useDashboardConfig.ts` lines 82–109
**Apply to:** `lib/scenario-state.ts` (`loadScenarioDraft`, `saveScenarioDraft`, `clearScenarioDraft`)
```typescript
if (typeof window === "undefined") return null;   // SSR guard
try { ... localStorage.getItem(...) ... } catch { return null; }  // read
try { ... localStorage.setItem(...) ... } catch {}                // write (swallow quota)
```

### Design tokens — numeric values must use Geist Mono
**Source:** `KpiStrip.tsx` lines 259–263; `EquityChart.tsx` lines 495–508
**Apply to:** `ScenarioFooter.tsx` (delta summary), `ScenarioCommitDrawer.tsx` (weight values), `KpiStrip.tsx` (delta pills), all weight inputs in `ScenarioCompositionList`
```typescript
// CSS: fontFamily: "Geist Mono, monospace", fontVariantNumeric: "tabular-nums"
// Tailwind: className="font-mono tabular-nums"
```

### Drawer backdrop + panel + keyframe animations
**Source:** `src/app/(dashboard)/allocations/components/BridgeDrawer.tsx` lines 102–298
**Apply to:** `ScenarioCommitDrawer.tsx` (720px), `StrategyBrowseDrawer.tsx` (620px)

Same `bd-fade` / `bd-slide` keyframes, same `zIndex: 100` backdrop / `zIndex: 101` panel, same `position: fixed; top:0; right:0; bottom:0` panel positioning, same `role="dialog" aria-modal="true"`.

### `buildHoldingRef` scope_ref construction
**Source:** `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` line 38
**Apply to:** ALL Phase 10 files that key state by scope_ref
```typescript
export function buildHoldingRef(h: Pick<FlaggedHolding, "venue" | "symbol" | "holding_type">): string {
  return `holding:${h.venue}:${h.symbol}:${h.holding_type}`;
}
// NEVER hand-roll this string format anywhere in Phase 10.
```

### Self-verifying DO block migration pattern
**Source:** `supabase/migrations/072_match_decisions_original_holding_ref.sql` lines 187–312
**Apply to:** `supabase/migrations/080_match_decisions_kind_enum.sql`

Every assertion raises `EXCEPTION` on failure (triggers transaction rollback). Final block emits greppable `RAISE NOTICE 'phaseN: ... ✓'` strings. Migration is wrapped in `BEGIN; SET lock_timeout = '3s'; ... COMMIT;`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `components/ScenarioFooter.tsx` | component | pure display (sticky bar) | No existing sticky-footer component in codebase. Nearest primitives: `KpiStrip.tsx` (token usage), `BridgeDrawer.tsx` (button styles). Construct from project token primitives. |

---

## Critical DON'T-Copy Caveats

| File | Analog | What NOT to copy |
|------|--------|-----------------|
| `scenario-state.ts` | `useDashboardConfig.ts` | The `useRef(hasMutated)` observe-without-write guard — only needed in hooks that might mount against a foreign-version blob. `scenario-state.ts` is pure functions; the React wrapper controls when to persist. |
| `scenario-adapter.ts` | `holdings-adapter.ts` | The `holdingToStrategyId` optional map and `findStrategy()` lookup — scenario adapter does NOT join holdings to strategies. It only maps holdings → StrategyForBuilder. |
| `ScenarioCommitDrawer.tsx` | `BridgeDrawer.tsx` | The `stage` state machine (browse/confirm) — commit drawer has no multi-stage flow. Also do NOT copy the `sendBridgeIntro` call — commit drawer calls the new `POST /api/allocator/scenario/commit`. |
| `EquityChart.tsx` extension | `EquityChart.tsx` (self) | Do NOT pass `computeScenario().equity_curve` directly as `OverlaySeries.points`. Must convert: `{ date, value: point.value + 1 }` (return → wealth). See Pitfall 1 in RESEARCH.md. |
| `DrawdownChart.tsx` extension | `DrawdownChart.tsx` (self) | `deriveSnapshotDrawdowns()` expects cumulative USD values — NOT daily returns and NOT normalized 1.0-based wealth. Convert scenario equity curve: cumulative wealth × scenario AUM → USD series. |
| `holding-outcome-adapter.ts` | self | Do NOT modify the existing `FlaggedHolding` type, `buildHoldingRef`, or any of the four existing adapter functions. Extend by ADDING new types and functions only. |
| `src/lib/scenario.ts` | — | ZERO modifications allowed. This file is frozen (SCENARIO-05 complete, regression-pinned by `scenario.test.ts`). Any behavior change is a CI regression. Feed it via the adapter only. |
| `commit route.ts` | `bridge/outcome/route.ts` | Do NOT copy the `sent_as_intro` eligibility check — voluntary diffs are NOT gated on a prior intro. The commit route validates ownership differently per diff kind (holdings existence gate for `voluntary_remove`; strategy existence gate for `voluntary_add`). |

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/allocations/` (components, lib, hooks, widgets), `src/app/api/bridge/`, `src/app/api/match/`, `src/lib/`, `supabase/migrations/`
**Files scanned:** 20
**Pattern extraction date:** 2026-04-25
